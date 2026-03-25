"""Suno API music generation service."""
import asyncio
import io
import logging
from datetime import datetime

import httpx

from ..config import settings
from ..database.minio import get_minio

logger = logging.getLogger(__name__)

SUNO_GENERATE_URL = "{base}/api/v1/generate"
SUNO_STATUS_URL = "{base}/api/v1/generate/record-info"

SUNO_VOCAL_MAP = {
    "male_warm": {"style": "soft male vocal, warm, smooth", "gender": "m"},
    "male_powerful": {"style": "powerful male vocal, belted, strong", "gender": "m"},
    "male_husky": {"style": "raspy male vocal, husky, gritty", "gender": "m"},
    "male_soft": {"style": "gentle male vocal, soft, intimate", "gender": "m"},
    "female_warm": {"style": "soft female vocal, breathy, warm", "gender": "f"},
    "female_powerful": {"style": "powerful female vocal, belted, strong", "gender": "f"},
    "female_husky": {"style": "raspy female vocal, husky, sultry", "gender": "f"},
    "female_sweet": {"style": "sweet female vocal, melodic, warm", "gender": "f"},
}


def _ensure_lyrics_structure(lyrics: str) -> str:
    """가사에 [Verse]/[Chorus] 같은 구조 태그가 없으면 자동 추가."""
    if not lyrics or not lyrics.strip():
        return lyrics
    tags = ['[verse', '[chorus', '[bridge', '[intro', '[outro', '[pre-chorus', '[hook']
    if any(tag in lyrics.lower() for tag in tags):
        return lyrics  # 이미 있음
    lines = [l for l in lyrics.strip().split('\n') if l.strip()]
    if len(lines) <= 4:
        return f"[Verse]\n{lyrics.strip()}"
    # 4줄씩 verse, 그 다음 4줄 chorus 반복
    structured = []
    section = 0
    for i, line in enumerate(lines):
        if i % 4 == 0:
            tag = "[Verse]" if section % 2 == 0 else "[Chorus]"
            structured.append(f"\n{tag}")
            section += 1
        structured.append(line)
    return '\n'.join(structured).strip()


async def generate_music_suno(
    generation_id: str,
    lyrics: str = None,
    genre: str = None,
    mood: str = None,
    style: str = None,
    vocal: str = None,
    title: str = None,
    mongo_db=None,
    persona_id: str = None,
) -> dict:
    """Generate music using Suno API."""

    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    base_url = settings.suno_api_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }

    # Build style string
    style_parts = []
    if genre:
        style_parts.append(genre)
    if mood:
        style_parts.append(mood)
    if style:
        style_parts.append(style)

    # Vocal style from SUNO_VOCAL_MAP
    vocal_info = SUNO_VOCAL_MAP.get(vocal) if vocal else None
    if vocal_info:
        style_parts.append(vocal_info["style"])
    elif vocal and vocal.lower() != "instrumental":
        style_parts.append("vocal")

    style_str = ", ".join(style_parts) if style_parts else "pop"

    # Determine if instrumental
    is_instrumental = bool(vocal and vocal.lower() == "instrumental")

    # Build prompt - if custom mode with lyrics, include them
    use_custom = bool(lyrics and lyrics.strip())
    prompt_text = _ensure_lyrics_structure(lyrics.strip()) if use_custom else (title or "A beautiful song")

    # Request body
    body = {
        "prompt": prompt_text,
        "model": "V5",
        "customMode": use_custom,
        "instrumental": is_instrumental,
        "style": style_str[:1000],  # V5 limit
        "callBackUrl": "https://localhost/callback",  # Required by API, unused (we poll instead)
    }
    if title and use_custom:
        body["title"] = title[:80]
    if vocal_info:
        body["vocalGender"] = vocal_info["gender"]

    # If a Suno Voice Persona is selected, include it in the request
    if persona_id:
        body["personaId"] = persona_id

    # Update progress: starting
    await _update_progress(mongo_db, generation_id, 10, "processing")

    # Step 1: Submit generation request
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_url}/api/v1/generate",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        result = resp.json()

    if result.get("code") != 200:
        raise ValueError(f"Suno API 오류: {result.get('msg', 'Unknown error')}")

    task_id = result["data"]["taskId"]
    logger.info("Suno: generation %s started, taskId=%s", generation_id, task_id)

    # Update progress: submitted
    await _update_progress(mongo_db, generation_id, 20, "processing")

    # Step 2: Poll for completion (max ~5 min)
    audio_url = None
    suno_data = None
    status_data = None

    for poll_attempt in range(60):  # 60 * 5s = 5 min
        await asyncio.sleep(5)

        async with httpx.AsyncClient(timeout=30) as client:
            status_resp = await client.get(
                f"{base_url}/api/v1/generate/record-info",
                headers=headers,
                params={"taskId": task_id},
            )
            status_resp.raise_for_status()
            status_data = status_resp.json()

        status = status_data.get("data", {}).get("status", "")

        if status == "FAILED":
            raise ValueError("Suno 음악 생성에 실패했습니다.")

        # Update progress based on status
        if status == "TEXT_SUCCESS":
            await _update_progress(mongo_db, generation_id, 40, "processing")
        elif status == "FIRST_SUCCESS":
            await _update_progress(mongo_db, generation_id, 70, "processing")
        elif status == "SUCCESS":
            suno_songs = status_data["data"]["response"]["sunoData"]
            if suno_songs:
                suno_data = suno_songs[0]  # Use first of 2 generated songs
                audio_url = suno_data.get("audioUrl")
            break
        else:
            # PENDING or other - gradually increase progress
            progress = min(20 + poll_attempt, 60)
            await _update_progress(mongo_db, generation_id, progress, "processing")

    if not audio_url:
        raise ValueError("Suno 음악 생성 시간이 초과되었습니다.")

    # Step 3: Download audio and upload to MinIO
    await _update_progress(mongo_db, generation_id, 85, "processing")

    async with httpx.AsyncClient(timeout=120) as client:
        audio_resp = await client.get(audio_url)
        audio_resp.raise_for_status()
        audio_bytes = audio_resp.content

    # Upload to MinIO
    minio_client = get_minio()
    object_name = f"generated/{generation_id}/suno_output.mp3"

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(audio_bytes),
        length=len(audio_bytes),
        content_type="audio/mpeg",
    )

    # Collect all output files (both songs if available)
    output_files = [object_name]
    all_suno_songs = status_data["data"]["response"].get("sunoData", [])
    if len(all_suno_songs) > 1:
        second = all_suno_songs[1]
        second_url = second.get("audioUrl")
        if second_url:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    audio2_resp = await client.get(second_url)
                    audio2_resp.raise_for_status()
                second_object = f"generated/{generation_id}/suno_output_2.mp3"
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=second_object,
                    data=io.BytesIO(audio2_resp.content),
                    length=len(audio2_resp.content),
                    content_type="audio/mpeg",
                )
                output_files.append(second_object)
            except Exception as e:
                logger.warning("Suno: failed to download second track: %s", e)

    # Update MongoDB
    await _update_progress(mongo_db, generation_id, 100, "completed", {
        "result_audio_url": object_name,
        "output_files": output_files,
        "completed_at": datetime.utcnow(),
    })

    logger.info("Suno: generation %s completed, object=%s", generation_id, object_name)
    return {"result_audio_url": object_name, "output_files": output_files}


async def _update_progress(mongo_db, generation_id: str, progress: int, status: str, extra: dict = None):
    """Update generation progress in MongoDB."""
    from bson import ObjectId
    update = {
        "progress": progress,
        "status": status,
        "updated_at": datetime.utcnow(),
    }
    if extra:
        update.update(extra)
    await mongo_db.generations.update_one(
        {"_id": ObjectId(generation_id)},
        {"$set": update},
    )
