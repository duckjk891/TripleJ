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
SUNO_UPLOAD_COVER_URL = "{base}/api/v1/generate/upload-cover"
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
    prompt: str = None,
    mongo_db=None,
    persona_id: str = None,
    negative_tags: str = None,
    style_weight: float = None,
    weirdness: float = None,
    audio_weight: float = None,
    persona_model: str = None,
    bpm: int = None,
    key: str = None,
    reference_audio_url: str = None,
) -> dict:
    """Generate music using Suno API."""

    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    base_url = settings.suno_api_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }

    # Build style string (구조화된 값만 사용, 자연어 prompt는 제외)
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

    if bpm:
        style_parts.append(f"{bpm} BPM")
    if key:
        style_parts.append(f"{key}")

    style_str = ", ".join(style_parts) if style_parts else "pop"
    logger.info("Suno style string: %s", style_str)

    # Determine if instrumental
    is_instrumental = bool(vocal and vocal.lower() == "instrumental")

    # Build prompt - if custom mode with lyrics, include them
    use_custom = bool(lyrics and lyrics.strip())
    prompt_text = _ensure_lyrics_structure(lyrics.strip()) if use_custom else (title or "A beautiful song")

    # Determine whether to use upload-cover endpoint (reference audio)
    use_upload_cover = bool(reference_audio_url)

    # Request body
    body = {
        "prompt": prompt_text,
        "model": "V5_5" if use_upload_cover else "V5",
        "customMode": use_custom,
        "instrumental": is_instrumental,
        "style": style_str[:1000],  # V5 limit
        "callBackUrl": "https://localhost/callback",  # Required by API, unused (we poll instead)
    }

    # Add uploadUrl for reference audio (upload-cover endpoint)
    if use_upload_cover:
        body["uploadUrl"] = reference_audio_url

    if title and use_custom:
        body["title"] = title[:80]
    if vocal_info:
        body["vocalGender"] = vocal_info["gender"]

    # If a Suno Voice Persona is selected, include it in the request
    if persona_id:
        body["personaId"] = persona_id

    # Add optional advanced parameters
    if negative_tags:
        body["negativeTags"] = negative_tags
    if style_weight is not None:
        body["styleWeight"] = style_weight
    if weirdness is not None:
        body["weirdnessConstraint"] = weirdness
    if audio_weight is not None:
        body["audioWeight"] = audio_weight
    if persona_model:
        body["personaModel"] = persona_model

    # Update progress: starting
    await _update_progress(mongo_db, generation_id, 10, "processing")

    # Step 1: Submit generation request
    generate_endpoint = (
        f"{base_url}/api/v1/generate/upload-cover"
        if use_upload_cover
        else f"{base_url}/api/v1/generate"
    )
    logger.info(
        "Suno: using %s endpoint for generation %s (reference_audio=%s)",
        "upload-cover" if use_upload_cover else "generate",
        generation_id,
        bool(reference_audio_url),
    )

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            generate_endpoint,
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
