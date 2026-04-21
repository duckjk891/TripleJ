"""
AI Music Video Generator - Enhanced 20-Scene Pipeline.

Pipeline:
  1. Split lyrics into ~20 scenes (ChatGPT)
  2. Generate scene images (Gemini)
  3. Generate scene videos from images (Veo 3.1)
  4. Concatenate all clips into final video (ffmpeg)

Uses httpx for Google API calls, OpenAI SDK for ChatGPT.
"""

import asyncio
import base64
import io
import json
import logging
import math
import os
import shutil
import tempfile
from datetime import datetime
from typing import List, Optional

import anthropic
import httpx

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

# ── API URLs ──────────────────────────────────────────────────────────────────

GEMINI_IMAGE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)

VEO31_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "veo-3.1-fast-generate-preview:predictLongRunning"
)

VEO_OPERATION_URL = (
    "https://generativelanguage.googleapis.com/v1beta/{}"
)

GEMINI_AUDIO_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

GEMINI_VIDEO_PROMPT_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-pro:generateContent"
)

# ── Video Prompt Templates (4 variants) ──────────────────────────────────────

VIDEO_PROMPT_VEO_CHARACTER = """\
You are an elite music video cinematographer planning camera movement for Google Veo 3.1.

Analyze the scene image — subject position, lighting, depth, emotion — then write a \
cinematic camera direction in natural, descriptive language.

Veo style guide:
- Write as a film director giving natural instructions, not technical specs
- Describe the feel and flow: "The camera drifts slowly toward her face as warm light catches the tears"
- Blend movements naturally — Veo interprets mood and merges motions smoothly
- 3-6 sentences, 100-150 words ideal
- Place camera movement first, then subject action, then atmospheric details

Character rules:
- The main character's appearance must remain consistent with the reference image
- Mention specific wardrobe/hair details to help Veo maintain identity across shots
- For lipsync scenes: slow, intimate camera movement, close-up on face

Output plain English text only. No JSON, no bullet points.
"""

VIDEO_PROMPT_VEO_FREE = """\
You are an elite music video cinematographer planning camera movement for Google Veo 3.1.

Analyze the scene image — subject position, lighting, depth, emotion — then write a \
cinematic camera direction in natural, descriptive language.

Veo style guide:
- Write as a film director giving natural instructions, not technical specs
- Describe the feel and flow: "The camera sweeps across the rain-soaked street, pulling back to reveal the empty bench"
- Blend movements naturally — Veo interprets mood and merges motions smoothly
- 3-6 sentences, 100-150 words ideal
- Place camera movement first, then environmental action, then atmospheric details
- Any artistic style is welcome — match the visual tone of the image

For lipsync scenes: slow, intimate camera movement, close-up on face.

Output plain English text only. No JSON, no bullet points.
"""

VIDEO_PROMPT_KLING_CHARACTER = """\
You are an elite music video cinematographer planning camera movement for Kling 3.0 Omni.

Analyze the scene image — subject position, lighting, depth, emotion — then write \
precise, structured camera directions that Kling can execute literally.

Kling style guide:
- Write as a technical shot list with specific parameters
- Specify: camera type, direction, speed, duration (e.g., "tracking shot, left to right, slow, 5 seconds")
- Kling executes multi-phase movements sequentially — list them in order
- Include exact angles when relevant (e.g., "45-degree low angle")
- Keep prompt structured: Camera → Subject Action → Environment → Texture/Grain

Character rules:
- Reference <<<image_N>>> for character consistency
- The character in the reference must appear prominently with exact same appearance
- Specify character's physical actions precisely (e.g., "turns head 90 degrees to the left over 2 seconds")
- For lipsync scenes: static camera or very slow dolly, frontal angle, focus locked on face

Output plain English text only. No JSON.
"""

VIDEO_PROMPT_KLING_FREE = """\
You are an elite music video cinematographer planning camera movement for Kling 3.0 Omni.

Analyze the scene image — subject position, lighting, depth, emotion — then write \
precise, structured camera directions that Kling can execute literally.

Kling style guide:
- Write as a technical shot list with specific parameters
- Specify: camera type, direction, speed, duration (e.g., "tracking shot, left to right, slow, 5 seconds")
- Kling executes multi-phase movements sequentially — list them in order
- Include exact angles when relevant (e.g., "45-degree low angle")
- Keep prompt structured: Camera → Subject/Environment Action → Lighting → Texture/Grain
- Any visual style is welcome — match the artistic tone of the image

For lipsync scenes: static camera or very slow dolly, frontal angle, focus locked on face.

Output plain English text only. No JSON.
"""


VIDEO_PROMPT_SEEDANCE_CHARACTER = """\
You are an elite music video cinematographer planning camera movement for Seedance 2.0.

Analyze the scene image then write a director-style camera direction.

Seedance style guide:
- Structure: [Action] + [Scene] + [Style] + [Camera]
- 60-100 words total
- ONE camera instruction only (no multi-phase movements)
- Use pacing words (slow, smooth, gentle, dynamic) instead of technical parameters
- Lighting in one concise line
- End with "Preserve composition and colors."

Character rules:
- The main character must maintain exact appearance from the reference
- Specify character actions precisely
- For lipsync: static or gentle dolly, focus on face

Output plain English text only. No JSON.
"""

VIDEO_PROMPT_SEEDANCE_FREE = """\
You are an elite music video cinematographer planning camera movement for Seedance 2.0.

Analyze the scene image then write a director-style camera direction.

Seedance style guide:
- Structure: [Action] + [Scene] + [Style] + [Camera]
- 60-100 words total
- ONE camera instruction only (no multi-phase movements)
- Use pacing words (slow, smooth, gentle, dynamic) instead of technical parameters
- Lighting in one concise line
- Any visual style welcome
- End with "Preserve composition and colors."

For lipsync: static or gentle dolly, focus on face.

Output plain English text only. No JSON.
"""


def _select_video_prompt_template(video_model: str, has_character: bool) -> str:
    """Select the appropriate video prompt system template."""
    if video_model == "veo":
        return VIDEO_PROMPT_VEO_CHARACTER if has_character else VIDEO_PROMPT_VEO_FREE
    elif video_model == "seedance":
        return VIDEO_PROMPT_SEEDANCE_CHARACTER if has_character else VIDEO_PROMPT_SEEDANCE_FREE
    else:  # kling
        return VIDEO_PROMPT_KLING_CHARACTER if has_character else VIDEO_PROMPT_KLING_FREE


async def generate_video_prompts_from_images(
    image_bytes: bytes,
    image_prompt: str = "",
    scene_type: str = "drama",
    lyrics_segment: str = "",
    scene_number: int = 1,
    model: str = "gemini-2.5-pro",
    video_model: str = "veo",
    has_character: bool = False,
) -> str:
    """Multimodal로 씬 이미지를 분석하여 video_prompt를 생성한다.

    Args:
        image_bytes: 생성된 씬 이미지 (PNG)
        image_prompt: 해당 씬의 image_prompt 텍스트
        scene_type: "drama" 또는 "lipsync"
        lyrics_segment: 해당 씬의 가사
        scene_number: 씬 번호
        model: 사용할 모델 (기본값 "gemini-2.5-pro", "claude-*" 지원)

    Returns:
        video_prompt 문자열 (plain text, 2-3 sentences)
    """
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    system_prompt = _select_video_prompt_template(video_model, has_character)

    user_text = (
        f"Scene {scene_number} | Type: {scene_type}\n"
        f"Image prompt used: {image_prompt}\n"
    )
    if lyrics_segment:
        user_text += f"Lyrics: {lyrics_segment}\n"
    user_text += (
        "\nAnalyze this scene image and write the optimal camera movement direction "
        "for a music video clip. Output 2-3 sentences of plain text."
    )

    if model.startswith("claude-"):
        # ── Claude (Anthropic) path ──
        try:
            anthropic_client = _get_anthropic_client()

            user_content = [
                {"type": "text", "text": user_text},
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": image_b64,
                    },
                },
            ]

            claude_kwargs = {
                "model": model,
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_content}],
            }
            if "opus-4-7" not in model:
                claude_kwargs["temperature"] = 0.7
            response = await anthropic_client.messages.create(**claude_kwargs)

            video_prompt = response.content[0].text.strip()
            if video_prompt:
                logger.info("Phase2.5: scene %d video_prompt generated via %s (%d chars)", scene_number, model, len(video_prompt))
                return video_prompt

            logger.warning("Phase2.5: scene %d — empty response from %s", scene_number, model)
            return "Smooth cinematic camera movement, slow dolly forward."

        except Exception as e:
            logger.warning("Phase2.5: scene %d %s call failed: %s", scene_number, model, e)
            return "Smooth cinematic camera movement, slow dolly forward."

    else:
        # ── Gemini path (default) ──
        payload = {
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "contents": [{"parts": [
                {"text": user_text},
                {"inlineData": {"mimeType": "image/png", "data": image_b64}},
            ]}],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 1024,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    GEMINI_VIDEO_PROMPT_URL,
                    params={"key": settings.google_api_key},
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

            # Extract text from Gemini response
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    video_prompt = parts[0].get("text", "").strip()
                    if video_prompt:
                        logger.info("Phase2.5: scene %d video_prompt generated (%d chars)", scene_number, len(video_prompt))
                        return video_prompt

            logger.warning("Phase2.5: scene %d — empty response from Gemini", scene_number)
            return "Smooth cinematic camera movement, slow dolly forward."

        except Exception as e:
            logger.warning("Phase2.5: scene %d Gemini call failed: %s", scene_number, e)
            return "Smooth cinematic camera movement, slow dolly forward."


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_openai_client():
    """Get or create the AsyncOpenAI client (singleton)."""
    from .lyrics_generator import _get_client
    return _get_client()


_mv_anthropic_client = None


def _get_anthropic_client():
    """Get or create the AsyncAnthropic client (singleton)."""
    global _mv_anthropic_client
    if _mv_anthropic_client is None:
        _mv_anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _mv_anthropic_client


def _get_ffmpeg_path() -> Optional[str]:
    """Get ffmpeg binary path. Checks PATH first, then imageio-ffmpeg."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def _ffmpeg_available() -> bool:
    """Check whether ffmpeg is available."""
    return _get_ffmpeg_path() is not None


# ── 0. Analyze Music Structure (Gemini Audio) ────────────────────────────────


MUSIC_STRUCTURE_PROMPT = """\
You are a music structure analyzer. Analyze the provided audio file and identify its structural sections.

For each section, provide:
- "label": section label (e.g., "Intro", "Verse1", "Chorus1", "Bridge", "Outro", etc.)
- "start": start time in seconds (float, 1 decimal)
- "end": end time in seconds (float, 1 decimal)
- "mood": brief mood/atmosphere description of this section (in Korean, 2-5 words, e.g., "잔잔한 피아노", "강렬한 드럼 비트")

Output ONLY a JSON array, no markdown fences, no extra text:
[
  {"label": "Intro", "start": 0.0, "end": 12.5, "mood": "잔잔한 피아노"},
  {"label": "Verse1", "start": 12.5, "end": 38.0, "mood": "차분한 기타 멜로디"},
  ...
]

Rules:
- Cover the entire duration of the audio from start to end.
- Sections must be contiguous (no gaps).
- Use standard music section labels.
- Be precise with timestamps.
- Output valid JSON only.
"""


async def analyze_music_structure(
    audio_bytes: bytes,
    mime_type: str = "audio/mp3",
    lyrics_sections: list[str] = None,
) -> List[dict]:
    """Send audio to Gemini and get music structure sections.

    If lyrics_sections is provided, Gemini is asked to find timestamps
    for those exact sections in order (lyrics-section-master mode).
    Otherwise falls back to free-form analysis (legacy behaviour).

    Returns list of {"label", "start", "end", "mood"}.
    """
    # Choose prompt: lyrics-guided or free-form
    if lyrics_sections:
        section_list = "\n".join(
            "{}. {}".format(i + 1, tag) for i, tag in enumerate(lyrics_sections)
        )
        prompt_text = (
            "Analyze the audio and find the exact timestamps for each of the following sections IN ORDER:\n"
            "{}\n\n"
            "Return JSON array. Each object must have:\n"
            "- \"label\": the exact section name as listed above (do NOT rename or skip any)\n"
            "- \"start\": start time in seconds\n"
            "- \"end\": end time in seconds\n"
            "- \"mood\": brief mood description in Korean (2-5 words)\n\n"
            "The sections must appear in the given order and cover the entire audio duration.\n"
            "Output ONLY valid JSON, no markdown."
        ).format(section_list)
    else:
        prompt_text = MUSIC_STRUCTURE_PROMPT

    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt_text},
                {
                    "inlineData": {
                        "mimeType": mime_type,
                        "data": audio_b64,
                    }
                },
            ]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 4000,
        },
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            GEMINI_AUDIO_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code == 429:
        logger.warning("Gemini audio analysis 429, waiting 30s before retry...")
        await asyncio.sleep(30)
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                GEMINI_AUDIO_URL,
                params={"key": settings.google_api_key},
                json=payload,
            )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini 음악 구조 분석 실패 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini 음악 구조 분석: 응답에 후보가 없습니다.")

    parts = candidates[0].get("content", {}).get("parts", [])
    raw_text = ""
    for part in parts:
        if part.get("text"):
            raw_text += part["text"]

    raw_text = raw_text.strip()

    # Strip markdown code fences if present
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1] if "\n" in raw_text else raw_text[3:]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
        raw_text = raw_text.strip()

    sections = json.loads(raw_text)

    if not isinstance(sections, list) or len(sections) == 0:
        raise ValueError("Gemini가 유효한 섹션 목록을 반환하지 않았습니다.")

    # Validate and clean sections
    for s in sections:
        s["start"] = float(s.get("start", 0))
        s["end"] = float(s.get("end", 0))
        if not s.get("label"):
            s["label"] = "Unknown"
        if not s.get("mood"):
            s["mood"] = ""

    # Validate lyrics-section alignment when lyrics_sections was provided
    if lyrics_sections:
        returned_labels = [s["label"] for s in sections]
        if len(returned_labels) != len(lyrics_sections):
            logger.warning(
                "Gemini returned %d sections but lyrics have %d sections. "
                "Returned: %s / Expected: %s",
                len(returned_labels), len(lyrics_sections),
                returned_labels, lyrics_sections,
            )
        else:
            mismatched = [
                (i, exp, got)
                for i, (exp, got) in enumerate(zip(lyrics_sections, returned_labels))
                if exp != got
            ]
            if mismatched:
                logger.warning(
                    "Gemini section labels mismatch (forcing to lyrics tags): %s",
                    mismatched,
                )
                # Force labels to match lyrics section tags
                for i, exp, _got in mismatched:
                    sections[i]["label"] = exp

    logger.info("Music structure analysis: %d sections found", len(sections))
    return sections


# ── 0.5 Trim Video Clip (ffmpeg) ─────────────────────────────────────────────


async def trim_video_clip(input_path: str, output_path: str, duration: float) -> bool:
    """Trim a video clip to the specified duration using ffmpeg.

    Returns True if successful, False otherwise.
    """
    ffmpeg_bin = _get_ffmpeg_path()
    if not ffmpeg_bin:
        logger.warning("ffmpeg not available for trimming, skipping trim")
        return False

    proc = await asyncio.create_subprocess_exec(
        ffmpeg_bin, "-y",
        "-i", input_path,
        "-t", str(duration),
        "-c", "copy",
        output_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        logger.warning(
            "ffmpeg trim failed (returncode %d): %s",
            proc.returncode, stderr.decode()[:300],
        )
        return False

    return True


# ── 0.9 Generate MV Scenario (ChatGPT) ─────────────────────────────────────


def _build_scenario_prompts(title, genre, mood, lyrics, character_name):
    """Build system and user prompts for MV scenario generation."""
    system_prompt = (
        "You are a professional music video director and screenplay writer. "
        "Given a song's title, genre, mood, and lyrics, write a short novel-style scenario "
        "for the music video. Write it as a vivid short story (500-1000 characters in Korean). "
        "Describe the narrative arc: setting, characters, key moments, and emotional progression. "
        "Do NOT break it into scenes or numbers. Write it as flowing prose like a short novel synopsis. "
        "Focus on visual storytelling - describe what the CAMERA would see, not abstract emotions.\n\n"
        "IMPORTANT: Only the main character (protagonist) is the singer/vocalist in this music video. "
        "Other characters may appear in story scenes but they NEVER sing, rap, or lip-sync. "
        "During chorus and rap sections, ONLY the main character performs."
    )

    user_parts = []
    user_parts.append("제목: {}".format(title))
    if genre:
        user_parts.append("장르: {}".format(genre))
    if mood:
        user_parts.append("분위기: {}".format(mood))
    if character_name:
        user_parts.append("주인공 이름: {} (이 캐릭터를 주인공으로 사용해주세요)".format(character_name))
    else:
        user_parts.append("주인공: 특정 캐릭터 없음 (일반적인 인물로 묘사)")
    if lyrics:
        user_parts.append("가사:\n{}".format(lyrics[:3000]))

    user_prompt = "\n".join(user_parts)
    return system_prompt, user_prompt


# ── Drama Scenario Prompt (PLAN.md v30) ──────────────────────────────────────

def _build_drama_scenario_prompts(
    title,
    genre,
    mood,
    lyrics,
    vocal_gender=None,
    relationship=None,
    has_user_character=False,
    has_cover_person=False,
):
    """Build system/user prompts for drama-style MV scenario generation.

    Returns a system + user prompt pair that instructs the LLM to emit a strict
    JSON document with `characters`, `locations`, and `scenario` fields.
    """
    # ── character1 gender rule (forced by vocal_gender) ──
    vg = (vocal_gender or "").strip().lower() or None
    if vg == "female":
        c1_gender_rule = (
            "character1.gender는 반드시 \"female\"이어야 합니다. 절대 변경하지 마세요. "
            "남성으로 묘사하지 마세요."
        )
        opposite_gender = "male"
    elif vg == "male":
        c1_gender_rule = (
            "character1.gender는 반드시 \"male\"이어야 합니다. 절대 변경하지 마세요. "
            "여성으로 묘사하지 마세요."
        )
        opposite_gender = "female"
    elif vg == "neutral":
        c1_gender_rule = (
            "character1.gender는 \"neutral\"로 설정하고, 성별이 모호한 중성적인 인물로 "
            "묘사하세요. 한국어 이름도 중성적인 이름을 사용하세요."
        )
        opposite_gender = None
    else:
        c1_gender_rule = (
            "character1.gender는 \"female\" 또는 \"male\" 중 이야기에 맞게 선택하세요."
        )
        opposite_gender = None

    # ── character1 appearance rule ──
    if has_user_character:
        c1_look_rule = (
            "사용자가 제공한 캐릭터 시트의 외형(헤어스타일, 의상, 분위기 등)을 따르세요. "
            "description에는 그 캐릭터의 특징을 자연스러운 한국어로 요약하세요."
        )
    elif has_cover_person:
        c1_look_rule = (
            "커버 이미지에 등장하는 인물의 외형(헤어스타일, 의상, 분위기 등)을 참조하여 "
            "description을 작성하세요."
        )
    else:
        c1_look_rule = (
            "제공된 vocal_gender, 장르, 분위기를 바탕으로 자유롭게 외형을 설계하세요."
        )

    # ── character2 rule ──
    rel = (relationship or "").strip().lower() or None
    if rel == "ex_lover":
        if opposite_gender:
            c2_rule = (
                "character2를 반드시 포함하세요. character2.gender는 반드시 \"{}\" 이어야 "
                "합니다 (character1과 반대 성별). role은 \"옛 연인\", 둘은 과거에 연인이었지만 "
                "지금은 헤어진 관계로 묘사하세요."
            ).format(opposite_gender)
        else:
            c2_rule = (
                "character2를 반드시 포함하세요. role은 \"옛 연인\", 둘은 과거에 연인이었지만 "
                "지금은 헤어진 관계로 묘사하세요. gender는 이야기에 맞게 선택하세요."
            )
    elif rel == "friend":
        c2_rule = (
            "character2를 포함하세요. role은 \"친구\"로, character1의 오랜 친구로 자연스럽게 "
            "묘사하세요. gender는 AI가 이야기에 맞게 자유롭게 결정합니다."
        )
    elif rel == "colleague":
        c2_rule = (
            "character2를 포함하세요. role은 \"동료\"로, 같은 직장/활동 영역에서 만난 동료로 "
            "묘사하세요. gender는 AI가 이야기에 맞게 자유롭게 결정합니다."
        )
    elif rel == "family":
        c2_rule = (
            "character2를 포함하세요. role은 \"가족\" (부모/형제/자매 등 중 하나를 선택)로, "
            "혈연/가족 관계로 자연스럽게 묘사하세요. gender는 AI가 이야기에 맞게 자유롭게 "
            "결정합니다."
        )
    else:
        c2_rule = (
            "character2는 생략하세요 (단독 주인공 서사). characters 객체에 character2 키를 "
            "포함하지 마세요."
        )

    system_prompt = (
        "당신은 음악 비디오 감독이자 단편영화 시나리오 작가입니다. "
        "인물(인물 메타데이터) + 사건(스토리) + 감정의 흐름을 갖춘 단편영화식 서사를 작성하세요.\n\n"
        "## 출력 규칙 (엄격)\n"
        "- 반드시 아래 형식의 **JSON only** 로 응답하세요. 마크다운 코드 펜스(```), 설명, "
        "머리말/꼬리말 일체 금지. JSON 그 자체만 출력하세요.\n"
        "- 모든 한국어 텍스트(이름/설명/본문)는 자연스러운 한국어로 작성하세요.\n"
        "- scenario 본문에는 characters/locations에 정의한 이름을 직접 사용하세요. "
        "\"주인공\", \"그녀\", \"장소1\" 같은 플레이스홀더 표현은 금지합니다.\n"
        "- scenario 본문 길이는 한국어로 500~1000자를 유지하세요. 번호 매기지 말고 산문으로 쓰세요.\n\n"
        "## character1 규칙 (절대 준수)\n"
        "- {c1_gender_rule}\n"
        "- {c1_look_rule}\n"
        "- role은 \"주인공\"으로 설정하세요.\n"
        "- name은 한국식 이름(이지훈, 김수민 등)으로 설정하세요.\n"
        "- description은 외모/의상/분위기를 1-2문장의 한국어로 작성하세요.\n\n"
        "## character2 규칙\n"
        "- {c2_rule}\n"
        "- character2가 포함되는 경우, name은 한국식 이름, description은 외모/의상/분위기를 "
        "1-2문장의 한국어로 작성하세요.\n\n"
        "## locations 규칙\n"
        "- 이야기에 필요한 만큼만 1~3개의 장소를 정의하세요 (location1, location2, location3).\n"
        "- 각 장소의 description은 분위기/조명/디테일을 1-2문장의 한국어로 작성하세요.\n\n"
        "## 창작 규칙\n"
        "- 뮤직비디오의 주연(가창자)은 오직 character1입니다. 다른 인물은 노래/랩/립싱크를 "
        "하지 않습니다.\n"
        "- 영상이 보여줄 장면, 즉 카메라가 포착할 시각 요소 중심으로 쓰세요.\n\n"
        "## 출력 형식 (이 구조를 그대로 따르세요)\n"
        "{{\n"
        "  \"characters\": {{\n"
        "    \"character1\": {{\"name\": \"한국이름\", \"gender\": \"female|male|neutral\", \"role\": \"주인공\", \"description\": \"외모/의상/분위기 1-2문장 (한국어)\"}},\n"
        "    \"character2\": {{\"name\": \"한국이름\", \"gender\": \"female|male\", \"role\": \"옛 연인\", \"description\": \"...\"}}\n"
        "  }},\n"
        "  \"locations\": {{\n"
        "    \"location1\": {{\"name\": \"장소이름\", \"description\": \"분위기/조명/디테일 1-2문장 (한국어)\"}},\n"
        "    \"location2\": {{\"name\": \"...\", \"description\": \"...\"}}\n"
        "  }},\n"
        "  \"scenario\": \"단편영화식 서사 본문 500-1000자 (한국어). 등장인물 이름과 장소 이름을 직접 사용. 예: '지훈은 5년 전 헤어진 옛 연인 수민이 자주 가던 재즈 카페로 들어선다...'\"\n"
        "}}"
    ).format(
        c1_gender_rule=c1_gender_rule,
        c1_look_rule=c1_look_rule,
        c2_rule=c2_rule,
    )

    user_parts = []
    user_parts.append("제목: {}".format(title))
    if genre:
        user_parts.append("장르: {}".format(genre))
    if mood:
        user_parts.append("분위기: {}".format(mood))
    user_parts.append("vocal_gender: {}".format(vg or "지정 없음"))
    user_parts.append("relationship: {}".format(rel or "없음 (단독 주인공)"))
    user_parts.append(
        "사용자 캐릭터 시트 제공 여부: {}".format("예" if has_user_character else "아니오")
    )
    user_parts.append(
        "커버 이미지 인물 참조 여부: {}".format("예" if has_cover_person else "아니오")
    )
    if lyrics:
        user_parts.append("가사:\n{}".format(lyrics[:3000]))
    user_parts.append(
        "\n위 조건을 바탕으로 위에서 지정한 JSON 스키마대로만 응답하세요."
    )

    user_prompt = "\n".join(user_parts)
    return system_prompt, user_prompt


def _parse_drama_scenario_json(text: str) -> dict:
    """Parse LLM response into drama scenario dict.

    Tries strict json.loads first; falls back to extracting the largest JSON
    object substring. Returns a dict with keys {characters, locations, scenario}.
    Raises ValueError on unrecoverable failure.
    """
    if not text:
        raise ValueError("Empty scenario response")

    text = text.strip()
    # Strip markdown code fences if any snuck through
    if text.startswith("```"):
        # remove opening fence line
        _lines = text.split("\n", 1)
        text = _lines[1] if len(_lines) > 1 else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()
        # also strip "json" language marker if present as first word
        if text.startswith("json\n") or text.startswith("json\r\n"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
            text = text.strip()

    try:
        data = json.loads(text)
    except Exception:
        # Fallback: try to find the outermost {...} block
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            snippet = text[start:end + 1]
            try:
                data = json.loads(snippet)
            except Exception as inner_exc:
                raise ValueError(
                    "Failed to parse drama scenario JSON: {}".format(str(inner_exc)[:200])
                )
        else:
            raise ValueError("No JSON object found in drama scenario response")

    if not isinstance(data, dict):
        raise ValueError("Drama scenario JSON is not an object")

    # Minimal validation / normalization
    characters = data.get("characters") or {}
    locations = data.get("locations") or {}
    scenario = data.get("scenario") or ""
    if not isinstance(scenario, str):
        scenario = str(scenario)
    scenario = scenario.strip()
    if len(scenario) < 50:
        raise ValueError(
            "Drama scenario body too short ({} chars)".format(len(scenario))
        )

    return {
        "characters": characters if isinstance(characters, dict) else {},
        "locations": locations if isinstance(locations, dict) else {},
        "scenario": scenario,
    }


def _build_scenario_prompts_dispatch(
    scenario_style,
    title,
    genre,
    mood,
    lyrics,
    character_name,
    vocal_gender,
    relationship,
    has_user_character,
    has_cover_person,
):
    """Dispatch to drama prompt builder.

    Non-drama styles fall back to drama with a warning (PLAN.md v30 구현1).
    Returns (system_prompt, user_prompt, is_drama).
    """
    style = (scenario_style or "drama").strip().lower() or "drama"
    if style != "drama":
        logger.warning(
            "scenario_style '%s' not implemented — falling back to drama prompt",
            style,
        )
        style = "drama"
    system_prompt, user_prompt = _build_drama_scenario_prompts(
        title=title,
        genre=genre,
        mood=mood,
        lyrics=lyrics,
        vocal_gender=vocal_gender,
        relationship=relationship,
        has_user_character=has_user_character,
        has_cover_person=has_cover_person,
    )
    return system_prompt, user_prompt, True


async def _generate_scenario_openai(
    title, genre, mood, lyrics, character_name, model_name=None,
    scenario_style="drama", vocal_gender=None, relationship=None,
    has_user_character=False, has_cover_person=False,
):
    """Generate MV scenario using OpenAI. Returns dict for drama, str otherwise."""
    client = _get_openai_client()
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(
        scenario_style, title, genre, mood, lyrics, character_name,
        vocal_gender, relationship, has_user_character, has_cover_person,
    )
    model = model_name or settings.openai_model

    create_kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.8,
        "max_tokens": 2500,
    }
    if is_drama:
        # Force strict JSON output
        create_kwargs["response_format"] = {"type": "json_object"}

    resp = await client.chat.completions.create(**create_kwargs)
    raw = resp.choices[0].message.content.strip()

    if is_drama:
        parsed = _parse_drama_scenario_json(raw)
        logger.info(
            "MV drama scenario generated (OpenAI %s): %d chars body, %d chars, %d locations",
            model, len(parsed["scenario"]),
            len(parsed.get("characters", {})), len(parsed.get("locations", {})),
        )
        return parsed

    logger.info("MV scenario generated (OpenAI %s): %d chars", model, len(raw))
    return raw


async def _generate_scenario_claude(
    title, genre, mood, lyrics, character_name, model_name="claude-opus-4-6",
    scenario_style="drama", vocal_gender=None, relationship=None,
    has_user_character=False, has_cover_person=False,
):
    """Generate MV scenario using Anthropic Claude. Returns dict for drama, str otherwise."""
    client = _get_anthropic_client()
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(
        scenario_style, title, genre, mood, lyrics, character_name,
        vocal_gender, relationship, has_user_character, has_cover_person,
    )

    scenario_kwargs = {
        "model": model_name,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
        "max_tokens": 2500,
    }
    if "opus-4-7" not in model_name:
        scenario_kwargs["temperature"] = 0.8
    resp = await client.messages.create(**scenario_kwargs)

    raw = resp.content[0].text.strip()

    if is_drama:
        parsed = _parse_drama_scenario_json(raw)
        logger.info(
            "MV drama scenario generated (Claude %s): %d chars body",
            model_name, len(parsed["scenario"]),
        )
        return parsed

    logger.info("MV scenario generated (Claude %s): %d chars", model_name, len(raw))
    return raw


async def _generate_scenario_gemini(
    title, genre, mood, lyrics, character_name,
    scenario_style="drama", vocal_gender=None, relationship=None,
    has_user_character=False, has_cover_person=False,
):
    """Generate MV scenario using Google Gemini 2.5 Pro. Returns dict for drama, str otherwise."""
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(
        scenario_style, title, genre, mood, lyrics, character_name,
        vocal_gender, relationship, has_user_character, has_cover_person,
    )

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"

    generation_config = {
        "temperature": 0.8,
        "maxOutputTokens": 2500,
    }
    if is_drama:
        # Gemini supports response_mime_type for JSON
        generation_config["responseMimeType"] = "application/json"

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": generation_config,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            url,
            params={"key": settings.google_api_key},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini scenario generation returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    raw = ""
    for part in parts:
        if part.get("text"):
            raw += part["text"]

    raw = raw.strip()

    if is_drama:
        parsed = _parse_drama_scenario_json(raw)
        logger.info(
            "MV drama scenario generated (Gemini): %d chars body",
            len(parsed["scenario"]),
        )
        return parsed

    logger.info("MV scenario generated (Gemini): %d chars", len(raw))
    return raw


async def generate_mv_scenario(
    title: str,
    genre: str = None,
    mood: str = None,
    lyrics: str = None,
    character_name: str = None,
    models: list = None,
    scenario_style: str = "drama",
    vocal_gender: Optional[str] = None,
    relationship: Optional[str] = None,
    has_user_character: bool = False,
    has_cover_person: bool = False,
):
    """Generate an MV scenario.

    Drama style (default) returns a structured dict with characters/locations/scenario.
    Non-drama styles currently fall back to drama.

    Args:
        models: List of model names. If None, uses default OpenAI model.
                 Supported: OpenAI models, "claude-opus-4-*", "gemini-*".
                 If two models given, runs both in parallel.
        scenario_style: "drama" (only implemented), or falls back to drama.
        vocal_gender: "female"/"male"/"neutral" or None — forced onto character1.
        relationship: "ex_lover"/"friend"/"colleague"/"family" or None —
            controls character2 presence and rules.
        has_user_character: True if user uploaded a character sheet (external ref).
        has_cover_person: True if cover image contains a person to reference.

    Returns:
        Single model (drama): dict {characters, locations, scenario}
        Single model (non-drama / fallback): currently dict via drama fallback
        Both models: {"results": [{"meta": dict, "scenario": str, "model": str}, ...]}
    """
    common_args = dict(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
        character_name=character_name,
        scenario_style=scenario_style,
        vocal_gender=vocal_gender,
        relationship=relationship,
        has_user_character=has_user_character,
        has_cover_person=has_cover_person,
    )

    if not models:
        return await _generate_scenario_openai(**common_args)

    async def _run(model_name):
        if model_name.startswith("claude-"):
            result = await _generate_scenario_claude(**common_args, model_name=model_name)
        elif model_name.startswith("gemini-"):
            result = await _generate_scenario_gemini(**common_args)
        else:  # gpt-*
            result = await _generate_scenario_openai(**common_args, model_name=model_name)
        # Normalize return shape
        if isinstance(result, dict):
            # drama: {characters, locations, scenario}
            return {
                "meta": result,
                "scenario": result.get("scenario", ""),
                "model": model_name,
            }
        # plain string (non-drama legacy path — currently unused but future-proof)
        return {
            "meta": {"characters": {}, "locations": {}, "scenario": result},
            "scenario": result,
            "model": model_name,
        }

    if len(models) == 1:
        result = await _run(models[0])
        return result["meta"]  # dict for single-model runs

    # Two models: run in parallel
    results = await asyncio.gather(
        _run(models[0]),
        _run(models[1]),
        return_exceptions=True,
    )

    valid_results = [r for r in results if not isinstance(r, Exception)]
    if len(valid_results) == 0:
        raise RuntimeError("All scenario generation calls failed")
    if len(valid_results) == 1:
        return valid_results[0]["meta"]

    return {"results": valid_results}


# ── 1. Split Lyrics into Scenes (ChatGPT) ────────────────────────────────────

SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE = """\
Split the following song lyrics into approximately {scene_count} scenes for a music video.
For each scene, provide TWO separate prompts:
1. image_prompt: A vivid visual description for AI image generation (camera composition, lighting, color)
2. video_prompt: Camera movement and motion instructions for AI video generation

IMPORTANT: First, design an overall story arc for the music video:
- Introduction (first 2-3 scenes): Set the scene, introduce the mood/character/setting.
- Development (next scenes): Build the narrative, show progression and emotional deepening.
- Climax (2-3 scenes near the end): Peak emotional moment, most intense visuals.
- Resolution (final 1-2 scenes): Conclude the story, provide emotional closure.

Then distribute the lyrics across these scenes following this narrative structure.
Each scene should naturally flow into the next, creating a cohesive visual story.

IMPORTANT VISUAL STYLE:
- Do NOT include scenes where the character looks directly at the camera or sings/lip-syncs to camera.
- Instead, focus entirely on cinematic storytelling: the character living through the narrative, \
showing emotions through actions and expressions naturally, not performing to an audience.
- Use varied cinematic angles: wide establishing shots, close-ups of hands/expressions, \
over-the-shoulder shots, silhouettes, reflections, and atmospheric montages.

For image_prompt, include specific camera composition:
- Shot type: extreme wide, wide, medium, close-up, extreme close-up
- Camera angle: eye-level, low angle, high angle, bird's eye, dutch angle
- Lighting: natural, golden hour, backlit, rim light, neon, harsh shadows
- Depth of field: shallow bokeh, deep focus, rack focus subject
- Color palette: warm/cool tones, specific colors

For video_prompt, include specific camera movement:
- Camera motion: tracking shot, pan left/right, tilt up/down, dolly in/out, crane, steadicam, handheld
- Speed: slow motion, normal speed, time-lapse
- Transition: fade, dissolve, cut, whip pan
- Subject movement: walking toward/away, turning, reaching out

{scenario_context}

Each scene must include a "scene_type" field:
- "drama": cinematic storytelling scene (character NOT looking at camera)
- "lipsync": character faces camera directly, singing/performing (close-up face shot)

scene_type rules (priority-based):
- If ANY section has label containing "Rap", "rap", "Hip-hop", or "Hiphop": ONLY those Rap sections get scene_type "lipsync". All Chorus sections become "drama".
- If NO Rap sections exist: Chorus sections get scene_type "lipsync".
- All other sections (Intro, Verse, Bridge, Outro): always "drama".

For "lipsync" scenes:
- ONLY the main character (protagonist from the character sheet) appears in the scene. NO other people, NO other characters.
- image_prompt MUST describe the main character ALONE, facing camera directly, frontal close-up
- The main character should appear to be singing or rapping with mouth open
- Do NOT include any other person, couple, group, or background characters in lipsync scenes
- For Rap: intense expression, rhythmic head movement
- For Chorus (when no rap): emotional singing expression

For "drama" scenes:
- The main character and other characters may appear together for storytelling
- But ONLY the main character is the singer - other characters never sing or perform

Output ONLY a JSON array with objects like:
[
  {{"scene_number": 1, "scene_type": "drama", "image_prompt": "English image prompt...", "video_prompt": "English video prompt...", "description_ko": "한글 장면 설명 (2-3문장)", "lyrics_segment": "lyrics text ..."}},
  ...
]

Rules:
- Aim for approximately {scene_count} scenes (minimum {scene_min}, maximum {scene_max}).
- Each image_prompt should be 1-3 sentences of vivid, cinematic imagery with specific camera/lighting details.
- Each video_prompt should specify camera movement and motion details.
- "description_ko": A Korean-language description of the scene (2-3 sentences). Describe what is visually happening in this scene in natural Korean. This is shown to Korean-speaking users, NOT used for image generation.
- Distribute lyrics evenly across scenes.
- If some sections are instrumental/intro/outro, create atmospheric visual scenes.
- For "drama" scenes: NEVER describe the character singing, performing, or looking at the camera.
- For "lipsync" scenes: character MUST face the camera directly in a close-up shot.
- Ensure visual continuity: maintain consistent setting, lighting, and character appearance across scenes.
- Output valid JSON only, no markdown fences, no extra text.
"""

SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE = """\
Generate approximately {scene_count} scenes for a music video based on the given song metadata.
Since no lyrics are provided, create vivid visual scenes that match the title, genre, \
and mood of the song.
For each scene, provide TWO separate prompts:
1. image_prompt: A vivid visual description for AI image generation (camera composition, lighting, color)
2. video_prompt: Camera movement and motion instructions for AI video generation

IMPORTANT: Design an overall story arc for the music video:
- Introduction (first 2-3 scenes): Set the scene, introduce the mood/character/setting.
- Development (next scenes): Build the narrative, show progression and emotional deepening.
- Climax (2-3 scenes near the end): Peak emotional moment, most intense visuals.
- Resolution (final 1-2 scenes): Conclude the story, provide emotional closure.

Each scene should naturally flow into the next, creating a cohesive visual story.

IMPORTANT VISUAL STYLE:
- Do NOT include scenes where the character looks directly at the camera or sings/lip-syncs to camera.
- Instead, focus entirely on cinematic storytelling: the character living through the narrative, \
showing emotions through actions and expressions naturally, not performing to an audience.
- Use varied cinematic angles: wide establishing shots, close-ups of hands/expressions, \
over-the-shoulder shots, silhouettes, reflections, and atmospheric montages.

For image_prompt, include specific camera composition:
- Shot type: extreme wide, wide, medium, close-up, extreme close-up
- Camera angle: eye-level, low angle, high angle, bird's eye, dutch angle
- Lighting: natural, golden hour, backlit, rim light, neon, harsh shadows
- Depth of field: shallow bokeh, deep focus, rack focus subject
- Color palette: warm/cool tones, specific colors

For video_prompt, include specific camera movement:
- Camera motion: tracking shot, pan left/right, tilt up/down, dolly in/out, crane, steadicam, handheld
- Speed: slow motion, normal speed, time-lapse
- Transition: fade, dissolve, cut, whip pan
- Subject movement: walking toward/away, turning, reaching out

{scenario_context}

Each scene must include a "scene_type" field:
- "drama": cinematic storytelling scene (character NOT looking at camera)
- "lipsync": character faces camera directly, singing/performing (close-up face shot)

scene_type rules (priority-based):
- If ANY section has label containing "Rap", "rap", "Hip-hop", or "Hiphop": ONLY those Rap sections get scene_type "lipsync". All Chorus sections become "drama".
- If NO Rap sections exist: Chorus sections get scene_type "lipsync".
- All other sections (Intro, Verse, Bridge, Outro): always "drama".

For "lipsync" scenes:
- ONLY the main character (protagonist from the character sheet) appears in the scene. NO other people, NO other characters.
- image_prompt MUST describe the main character ALONE, facing camera directly, frontal close-up
- The main character should appear to be singing or rapping with mouth open
- Do NOT include any other person, couple, group, or background characters in lipsync scenes
- For Rap: intense expression, rhythmic head movement
- For Chorus (when no rap): emotional singing expression

For "drama" scenes:
- The main character and other characters may appear together for storytelling
- But ONLY the main character is the singer - other characters never sing or perform

Output ONLY a JSON array with objects like:
[
  {{"scene_number": 1, "scene_type": "drama", "image_prompt": "English image prompt...", "video_prompt": "English video prompt...", "description_ko": "한글 장면 설명 (2-3문장)", "lyrics_segment": ""}},
  ...
]

Rules:
- Create exactly {scene_count} scenes.
- Each image_prompt should be 1-3 sentences of vivid, cinematic imagery with specific camera/lighting details.
- Each video_prompt should specify camera movement and motion details.
- "description_ko": A Korean-language description of the scene (2-3 sentences). Describe what is visually happening in this scene in natural Korean. This is shown to Korean-speaking users, NOT used for image generation.
- The scenes should tell a visual story that fits the genre and mood.
- For "drama" scenes: NEVER describe the character singing, performing, or looking at the camera.
- For "lipsync" scenes: character MUST face the camera directly in a close-up shot.
- Ensure visual continuity: maintain consistent setting, lighting, and character appearance across scenes.
- Output valid JSON only, no markdown fences, no extra text.
"""

# ── Section-aware scene planning prompt (used when music_sections available) ──

SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE = """\
You are a music video scene planner. You will be given:
1. Music structure sections with timestamps and mood
2. Song lyrics (if available)
3. Song metadata (title, genre, mood)

For each music section, compute:
- clip_count = ceil(section_duration / 10)
- use_seconds = section_duration / clip_count

Then for each clip, create TWO separate prompts:
1. image_prompt: A vivid visual description for AI image generation (camera composition, lighting, color)
2. video_prompt: Camera movement and motion instructions for AI video generation

IMPORTANT VISUAL STYLE:
- Do NOT include scenes where the character looks directly at the camera or sings/lip-syncs to camera.
- Focus entirely on cinematic storytelling: the character living through the narrative, \
showing emotions through actions and expressions naturally.
- Use varied cinematic angles: wide shots, close-ups, over-the-shoulder, silhouettes, reflections.
- Maintain visual continuity across all clips.

For image_prompt, include specific camera composition:
- Shot type: extreme wide, wide, medium, close-up, extreme close-up
- Camera angle: eye-level, low angle, high angle, bird's eye, dutch angle
- Lighting: natural, golden hour, backlit, rim light, neon, harsh shadows
- Depth of field: shallow bokeh, deep focus, rack focus subject
- Color palette: warm/cool tones, specific colors

For video_prompt, include specific camera movement:
- Camera motion: tracking shot, pan left/right, tilt up/down, dolly in/out, crane, steadicam, handheld
- Speed: slow motion, normal speed, time-lapse
- Transition: fade, dissolve, cut, whip pan
- Subject movement: walking toward/away, turning, reaching out

{scenario_context}

Output ONLY a JSON array of section objects:
[
  {{
    "section": "Intro",
    "section_start": 0.0,
    "section_end": 13.0,
    "section_mood": "빗소리, 차분한 피아노",
    "clips": [
      {{
        "clip_number": 1,
        "use_seconds": 6.5,
        "image_prompt": "Rain-drenched city skyline at twilight, extreme wide shot, high angle...",
        "video_prompt": "Slow dolly in toward the city, gentle rain particles falling...",
        "description_ko": "황혼 무렵 비에 젖은 도시 스카이라인이 펼쳐진다. 높은 곳에서 내려다보는 극광각 쇼트로 도시의 웅장함과 고독함이 동시에 느껴진다.",
        "lyrics_segment": "",
        "mood": "빗소리, 차분한 피아노"
      }}
    ]
  }}
]

Each clip must include a "scene_type" field:
- "drama": cinematic storytelling scene (character NOT looking at camera)
- "lipsync": character faces camera directly, singing/performing (close-up face shot)

scene_type rules (priority-based):
- If ANY section has label containing "Rap", "rap", "Hip-hop", or "Hiphop": ONLY those Rap sections get scene_type "lipsync". All Chorus sections become "drama".
- If NO Rap sections exist: Chorus sections get scene_type "lipsync".
- All other sections (Intro, Verse, Bridge, Outro): always "drama".

For "lipsync" clips:
- ONLY the main character (protagonist from the character sheet) appears in the scene. NO other people, NO other characters.
- image_prompt MUST describe the main character ALONE, facing camera directly, frontal close-up
- The main character should appear to be singing or rapping with mouth open
- Do NOT include any other person, couple, group, or background characters in lipsync scenes
- For Rap: intense expression, rhythmic head movement
- For Chorus (when no rap): emotional singing expression

For "drama" clips:
- The main character and other characters may appear together for storytelling
- But ONLY the main character is the singer - other characters never sing or perform

SECTION FIELD RULES (CRITICAL — violations will be rejected):
- The "section" field in each output object MUST match EXACTLY one of the music_sections labels provided in the input.
- Do NOT invent, rename, merge, or skip any section. Use the label strings EXACTLY as given (e.g., "Chorus", NOT "Chorus1", "Post-Chorus", "Chorus 2", etc.).
- Your job is ONLY to decide clip_count and use_seconds for each given section; the section list itself is fixed.
- If a section needs multiple clips, every clip shares the same "section" value.

{{available_sections_block}}

Rules:
- Each clip's use_seconds must sum up to the section duration (within 0.5s tolerance).
- Distribute lyrics across clips according to their timing in each section.
- For instrumental sections (Intro/Outro/Bridge), create atmospheric visual scenes with empty lyrics_segment.
- Each clip image_prompt: 1-3 sentences of vivid, cinematic imagery in English with specific camera/lighting details.
- Each clip video_prompt: specify camera movement and motion details.
- "description_ko": A Korean-language description of the scene (2-3 sentences). Describe what is visually happening in this scene in natural Korean. This is shown to Korean-speaking users, NOT used for image generation.
- Reflect each section's mood in the clip descriptions.
- For "drama" clips: NEVER describe the character singing, performing, or looking at the camera.
- For "lipsync" clips: character MUST face the camera directly in a close-up shot.
- Output valid JSON only, no markdown fences, no extra text.
"""


async def split_lyrics_into_scenes(
    lyrics: Optional[str],
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    scene_count: int = 20,
    user_scene_prompt: Optional[str] = None,
    music_sections: Optional[List[dict]] = None,
    scenario: Optional[str] = None,
) -> List[dict]:
    """Use ChatGPT to split lyrics into visual scenes.

    If music_sections is provided, uses section-aware planning that produces
    clips synced to music structure. Otherwise falls back to flat scene list.

    Returns list of scene dicts with image_prompt, video_prompt, lyrics_segment.
    When music_sections is used, each scene dict also includes:
    use_seconds, section, section_mood.
    """
    client = _get_openai_client()

    # ── Section-aware planning path ──
    if music_sections and len(music_sections) > 0:
        return await _split_with_music_sections(
            client, lyrics, title, genre, mood,
            user_scene_prompt, music_sections, scenario,
        )

    # ── Legacy path (no music sections) ──
    scene_min = max(scene_count - 5, 3)
    scene_max = scene_count + 5

    # Build scenario context for prompt templates
    scenario_context = ""
    if scenario:
        scenario_context = (
            "MV SCENARIO (follow this narrative):\n{}\n\n"
            "Based on this scenario, distribute the story across scenes. "
            "Each scene should follow the narrative arc described above."
        ).format(scenario)

    prompt_vars = {
        "scene_count": scene_count,
        "scene_min": scene_min,
        "scene_max": scene_max,
        "scenario_context": scenario_context,
    }

    if lyrics and lyrics.strip():
        system_prompt = SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE.format(**prompt_vars)
        user_message = "Title: {}\n".format(title)
        if genre:
            user_message += "Genre: {}\n".format(genre)
        if mood:
            user_message += "Mood: {}\n".format(mood)
        user_message += "\nLyrics:\n{}".format(lyrics)
    else:
        system_prompt = SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE.format(**prompt_vars)
        user_message = "Title: {}\n".format(title)
        if genre:
            user_message += "Genre: {}\n".format(genre)
        if mood:
            user_message += "Mood: {}\n".format(mood)

    # Append user scene direction if provided
    if user_scene_prompt and user_scene_prompt.strip():
        system_prompt += (
            "\n\nAdditional user direction for scene imagery: \"{}\"\n"
            "Incorporate this direction into each scene's visual description."
        ).format(user_scene_prompt.strip())

    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_tokens=4000,
    )

    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    scenes = json.loads(raw)

    if not isinstance(scenes, list) or len(scenes) == 0:
        raise ValueError("ChatGPT가 유효한 장면 목록을 생성하지 못했습니다.")

    return scenes


async def _split_with_music_sections(
    client,
    lyrics: Optional[str],
    title: str,
    genre: Optional[str],
    mood: Optional[str],
    user_scene_prompt: Optional[str],
    music_sections: List[dict],
    scenario: Optional[str] = None,
) -> List[dict]:
    """Section-aware scene planning using music structure.

    Returns flat list of scene dicts with image_prompt, video_prompt,
    use_seconds, section, section_mood.
    """
    # Build scenario context
    scenario_context = ""
    if scenario:
        scenario_context = (
            "MV SCENARIO (follow this narrative):\n{}\n\n"
            "Based on this scenario, distribute the story across scenes. "
            "Each scene should follow the narrative arc described above."
        ).format(scenario)

    # Extract available section tags from lyrics for prompt enforcement
    available_sections_block = ""
    if lyrics and lyrics.strip():
        import re as _re
        _section_tags = _re.findall(r'\[([^\]]+)\]', lyrics)
        # Clean: take base name before ":"
        _clean_tags = list(dict.fromkeys(
            tag.split(":")[0].strip() for tag in _section_tags
        ))
        if _clean_tags:
            available_sections_block = (
                "Available section tags from lyrics (use ONLY these): "
                + ", ".join('"{}"'.format(t) for t in _clean_tags)
            )

    system_prompt = SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE.format(
        scenario_context=scenario_context,
    ).replace("{{available_sections_block}}", available_sections_block)

    if user_scene_prompt and user_scene_prompt.strip():
        system_prompt += (
            "\n\nAdditional user direction for scene imagery: \"{}\"\n"
            "Incorporate this direction into each clip's visual description."
        ).format(user_scene_prompt.strip())

    # Build user message with all context
    user_message = "Title: {}\n".format(title)
    if genre:
        user_message += "Genre: {}\n".format(genre)
    if mood:
        user_message += "Mood: {}\n".format(mood)

    user_message += "\n## Music Structure Sections:\n"
    user_message += json.dumps(music_sections, ensure_ascii=False, indent=2)

    if lyrics and lyrics.strip():
        user_message += "\n\n## Lyrics:\n{}".format(lyrics)
    else:
        user_message += "\n\n(No lyrics — create atmospheric visual scenes for all sections)"

    # Calculate total expected clips for max_tokens sizing
    total_clips = 0
    for sec in music_sections:
        dur = sec["end"] - sec["start"]
        total_clips += math.ceil(dur / 10)

    max_tokens = min(max(total_clips * 500, 8000), 32000)

    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_tokens=max_tokens,
    )

    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    section_plans = json.loads(raw)

    if not isinstance(section_plans, list) or len(section_plans) == 0:
        raise ValueError("ChatGPT가 유효한 섹션별 씬 계획을 생성하지 못했습니다.")

    # Flatten section clips into a flat scene list
    flat_scenes = []
    scene_number = 1
    for sec_plan in section_plans:
        section_label = sec_plan.get("section", "Unknown")
        section_start = float(sec_plan.get("section_start", 0))
        section_end = float(sec_plan.get("section_end", 0))
        section_mood = sec_plan.get("section_mood", "")

        clips = sec_plan.get("clips", [])
        if not clips:
            # Fallback: create one clip for the whole section
            dur = section_end - section_start
            clips = [{
                "clip_number": 1,
                "use_seconds": dur,
                "image_prompt": "Atmospheric scene for {} section".format(section_label),
                "video_prompt": "Slow dolly in, atmospheric ambient movement",
                "lyrics_segment": "",
                "mood": section_mood,
            }]

        # ── 보정 2: GPT 클립 use_seconds 합을 Gemini 섹션 길이에 맞춤 ──
        section_duration = section_end - section_start
        if section_duration > 0 and clips:
            gpt_total = sum(float(c.get("use_seconds", 10)) for c in clips)
            if gpt_total > 0 and abs(gpt_total - section_duration) > 0.1:
                correction_ratio = section_duration / gpt_total
                logger.info(
                    "Section '%s': correcting clip timing ratio=%.4f (gpt=%.1f, section=%.1f)",
                    section_label, correction_ratio, gpt_total, section_duration,
                )
                for c in clips:
                    c["use_seconds"] = round(float(c.get("use_seconds", 10)) * correction_ratio, 2)

        clip_count = len(clips)
        for clip_idx, clip in enumerate(clips):
            # Support both new (image_prompt/video_prompt) and old (description) format
            image_prompt = clip.get("image_prompt") or clip.get("description", "")
            video_prompt = clip.get("video_prompt", "")

            # Determine scene_type: from clip, or infer from section label
            clip_scene_type = clip.get("scene_type", "")
            if not clip_scene_type:
                clip_scene_type = "lipsync" if section_label.lower().startswith("chorus") else "drama"

            # 씬 섹션 네이밍: 클립 1개면 "Verse 1", 여러개면 "Verse 1-1", "Verse 1-2"
            if clip_count > 1:
                scene_section = "{}-{}".format(section_label, clip_idx + 1)
            else:
                scene_section = section_label

            flat_scenes.append({
                "scene_number": scene_number,
                "description": image_prompt,  # backward compat
                "image_prompt": image_prompt,
                "video_prompt": video_prompt,
                "description_ko": clip.get("description_ko", ""),
                "lyrics_segment": clip.get("lyrics_segment", ""),
                "use_seconds": float(clip.get("use_seconds", 10)),
                "section": scene_section,
                "section_start": section_start,
                "section_end": section_end,
                "section_mood": section_mood,
                "clip_mood": clip.get("mood", section_mood),
                "scene_type": clip_scene_type,
            })
            scene_number += 1

    if len(flat_scenes) == 0:
        raise ValueError("ChatGPT가 유효한 장면 목록을 생성하지 못했습니다.")

    logger.info(
        "Section-aware planning: %d sections → %d clips",
        len(section_plans), len(flat_scenes),
    )
    return flat_scenes


# ── 1b. Generate Scene Prompts Only (v10.0) ────────────────────────────────


SCENE_PROMPT_ONLY_SYSTEM = """\
You are an elite music video cinematographer and director of photography (DP) \
with 20 years of experience shooting award-winning music videos. \
You think in terms of lenses, light, and emotion. \
You will receive a list of scenes with their section name, duration, lyrics, and scene_type. \
Your job is ONLY to generate visual prompts for each scene. Do NOT change the scene structure.

For each scene, provide:
1. image_prompt: A comprehensive cinematic description for AI image generation (English, 2-4 sentences). \
   Must include ALL of the following elements:
2. description_ko: Korean description of the scene (2-3 sentences)
3. video_image_prompt: A scene description optimized for the target video generation model (English).
{video_image_prompt_guide}

IMPORTANT VISUAL STYLE:
- Do NOT include scenes where the character looks directly at the camera or sings/lip-syncs to camera (EXCEPT for "lipsync" scene_type).
- Focus entirely on cinematic storytelling: the character living through the narrative, \
showing emotions through actions and expressions naturally.
- Use varied cinematic techniques across scenes — avoid repeating the same lens/angle/movement combo.
- Maintain visual continuity across all scenes.

══════════════════════════════════════════════════
 image_prompt MUST include ALL of these elements:
══════════════════════════════════════════════════

1. LENS & FOCAL LENGTH (mandatory — vary across scenes):
   - Wide: 16mm, 24mm, 35mm (environment, isolation, context)
   - Standard: 50mm (natural perspective, everyday feel)
   - Telephoto: 85mm, 100mm, 135mm (compression, intimacy, emotion)
   - Macro: 100mm macro (extreme detail — tears, fingers, textures)
   - Anamorphic: anamorphic lens with oval bokeh and horizontal flare (cinematic widescreen feel)
   Example: "Shot on 85mm f/1.4 lens with creamy bokeh"

2. SHOT TYPE:
   - Extreme wide, wide, medium wide, medium, medium close-up, close-up, extreme close-up, insert/detail shot

3. CAMERA ANGLE:
   - Eye-level, low angle, high angle, bird's eye, worm's eye, dutch/tilted angle, over-the-shoulder, POV

4. LIGHTING (be specific about direction and quality):
   - Type: natural, artificial, mixed
   - Quality: soft/diffused, hard/harsh, dappled
   - Direction: front, side, back, rim, top, under
   - Source: golden hour sun, overcast sky, neon signs, candles, window light, streetlamp, moonlight
   - Effect: lens flare, god rays, silhouette, chiaroscuro
   Example: "Warm golden hour backlight creating a rim light around her hair, soft fill from a reflector"

5. DEPTH OF FIELD & FOCUS:
   - Shallow (f/1.4-2.8): subject sharp, background melted into bokeh
   - Medium (f/4-5.6): subject and partial background in focus
   - Deep (f/8-16): everything sharp
   - Focus technique: rack focus from foreground to subject, pull focus to reveal, split diopter
   Example: "Shallow depth of field at f/1.8, rack focus from the rain-streaked window to her face"

6. COLOR PALETTE & GRADE:
   - Temperature: warm, cool, neutral
   - Specific tones: teal and orange, desaturated pastels, high contrast monochrome, neon-lit cyberpunk
   - Film stock reference: Kodak Portra 400 warmth, Fuji Velvia saturation, bleach bypass
   Example: "Cool blue-teal tones with warm skin highlights, reminiscent of Kodak Vision3 500T"

7. SCENE CONTENT & EMOTION:
   - What the character is doing (specific actions, gestures, expressions)
   - Environment and set details
   - Props and wardrobe details if relevant
   - Emotional tone conveyed through body language

══════════════════════════════════════════════════
 scene_type rules:
══════════════════════════════════════════════════

- "drama": cinematic storytelling scene. Character NOT looking at camera. Focus on narrative actions and emotions.
- "lipsync": character faces camera directly, singing/performing. ONLY the main character appears, close-up frontal shot, mouth open singing.

For "lipsync" scenes:
- MUST use `@character1` variable reference for the protagonist (do NOT use raw name or "the main character" / "the singer" / "she" / "he"). The character1 sheet is auto-attached only when the `@character1` token literally appears in image_prompt.
- image_prompt MUST describe @character1 ALONE, facing camera directly, frontal close-up or medium close-up
- Use 50mm or 85mm lens for flattering facial proportions
- @character1 should appear to be singing or rapping with mouth open
- Do NOT include any other person in lipsync scenes (no @character2, no extras)
- Lighting should emphasize the face: key light at 45 degrees, subtle fill, hair/rim light

For "drama" scenes:
- NEVER describe the character singing, performing, or looking at the camera
- Vary lenses across drama scenes — don't use the same focal length for consecutive scenes
- When the scenario describes a recurring character or location, MUST use the `@characterN` / `@locationN` variable reference instead of the raw name. The system attaches matching asset sheets only when the variable token literally appears in image_prompt.

{scenario_context}

══════════════════════════════════════════════════
 VARIABLE REFERENCES (caption-free consistency):
══════════════════════════════════════════════════

When referring to recurring characters or locations in image_prompt or video_image_prompt, \
USE VARIABLE REFERENCES instead of raw names. This lets the system automatically attach \
pre-generated character/location sheets to guarantee visual consistency.

- Characters: use @character1, @character2 (not "John", not "the woman")
- Locations: use @location1, @location2, @location3 (not "cafe", not "his bedroom")
- Example: "@character1 sits alone at @location1, looking out the window as @character2 approaches from behind."
- Example: "Close-up of @character1's face inside @location2, warm lamp light on her cheek."
- The variable must match exactly one of the available references listed below.
- If a variable reference appears in image_prompt, the corresponding asset sheet will be \
attached to the image generator automatically — do NOT repeat physical descriptions of the \
character/location in that prompt.

{asset_refs_line}

IMPORTANT distinction between image_prompt and video_image_prompt:
- image_prompt is for AI IMAGE generation (Gemini/NanoBanana): include technical specs like lens focal length, f-stop, bokeh, specific lighting setup, color grade reference
- video_image_prompt is for AI VIDEO generation context (Veo/Kling): describe the scene naturally as a director would, focusing on what's happening, mood, environment, and character actions — NO camera technical specs

Output ONLY a JSON array matching the input scene order:
[
  {{"scene_number": 1, "image_prompt": "...", "video_image_prompt": "...", "description_ko": "..."}},
  ...
]

Output valid JSON only, no markdown fences, no extra text.
"""


VIDEO_IMAGE_PROMPT_GUIDE_VEO = """\
   video_image_prompt is for Google Veo 3.1. Write in natural, cinematic language:
   - Describe as a film director giving instructions, focus on mood and emotion
   - Blend movements naturally (Veo interprets and merges motions smoothly)
   - 3-6 sentences, 100-150 words
   - Do NOT include technical specs (no lens mm, no f-stops, no bokeh)
   Example: "A woman sits at a cafe table, gazing through a rain-streaked window. Warm golden light wraps around her as afternoon sun filters through the glass, casting soft shadows across her face."
"""

VIDEO_IMAGE_PROMPT_GUIDE_KLING = """\
   video_image_prompt is for Kling 3.0 Omni. Write as a structured technical shot description:
   - Format: Camera -> Subject Action -> Environment -> Texture
   - Specify directions, speeds, durations explicitly
   - Multi-phase actions listed sequentially (Kling executes them in order)
   - Do NOT include technical specs (no lens mm, no f-stops, no bokeh)
   Example: "Scene: woman at cafe table, center frame, seated. Subject action: slowly lifts coffee cup with right hand over 3 seconds. Environment: warm interior, rain on glass, soft lamp light from upper left. Texture: film grain, shallow depth of field."
"""

VIDEO_IMAGE_PROMPT_GUIDE_SEEDANCE = """\
   video_image_prompt is for Seedance 2.0. Write as a director's instruction:
   - Structure: [Action] + [Scene] + [Style] + [Camera]
   - 60-100 words
   - ONE camera instruction only (no complex multi-phase movements)
   - Use pacing words (slow/smooth/gentle) instead of technical parameters
   - Lighting in one concise line
   - End with "Preserve composition and colors."
   - Do NOT include technical specs (no lens mm, no f-stops, no bokeh)
   Example: "Woman slowly lifts a white coffee cup at a cafe table, gazing through rain-streaked window. Warm golden afternoon light, soft shadows. Gentle dolly-in. Preserve composition and colors."
"""


def _get_video_image_prompt_guide(video_model: str) -> str:
    """Return the video_image_prompt guide for the selected video model."""
    if video_model == "veo":
        return VIDEO_IMAGE_PROMPT_GUIDE_VEO
    elif video_model == "seedance":
        return VIDEO_IMAGE_PROMPT_GUIDE_SEEDANCE
    else:  # kling
        return VIDEO_IMAGE_PROMPT_GUIDE_KLING


def _build_scene_prompt_messages(
    scenes_input, title, genre, mood, scenario, user_scene_prompt,
    video_model="veo", asset_keys=None,
):
    """Build system and user messages for scene prompt generation."""
    scenario_context = ""
    if scenario:
        scenario_context = (
            "MV SCENARIO (follow this narrative):\n{}\n\n"
            "Based on this scenario, distribute the story across scenes. "
            "Each scene should follow the narrative arc described above."
        ).format(scenario)

    if asset_keys:
        asset_refs_line = "Available references for this MV: {}".format(
            ", ".join("@{}".format(k) for k in asset_keys)
        )
    else:
        asset_refs_line = (
            "(No pre-generated asset references for this MV — describe characters "
            "and locations with plain text.)"
        )

    system_prompt = SCENE_PROMPT_ONLY_SYSTEM.format(
        scenario_context=scenario_context,
        video_image_prompt_guide=_get_video_image_prompt_guide(video_model),
        asset_refs_line=asset_refs_line,
    )

    if user_scene_prompt and user_scene_prompt.strip():
        system_prompt += (
            "\n\nAdditional user direction for scene imagery: \"{}\"\n"
            "Incorporate this direction into each scene's visual description."
        ).format(user_scene_prompt.strip())

    user_message = "Title: {}\n".format(title)
    if genre:
        user_message += "Genre: {}\n".format(genre)
    if mood:
        user_message += "Mood: {}\n".format(mood)
    user_message += "\n## Scenes to generate prompts for:\n"
    user_message += json.dumps(scenes_input, ensure_ascii=False, indent=2)

    return system_prompt, user_message


def _parse_scene_prompts_raw(raw: str) -> list:
    """Parse raw JSON response from scene prompt generation."""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    result = json.loads(raw)

    if not isinstance(result, list) or len(result) == 0:
        raise ValueError("AI가 유효한 프롬프트 목록을 생성하지 못했습니다.")

    return result


async def _generate_scene_prompts_openai(
    scenes_input, title, genre, mood, scenario, user_scene_prompt, model_name=None,
    video_model="veo", asset_keys=None,
):
    """Generate scene prompts using OpenAI."""
    client = _get_openai_client()
    model = model_name or settings.openai_model
    system_prompt, user_message = _build_scene_prompt_messages(
        scenes_input, title, genre, mood, scenario, user_scene_prompt,
        video_model=video_model, asset_keys=asset_keys,
    )

    max_tokens = min(max(len(scenes_input) * 500, 8000), 32000)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_tokens=max_tokens,
    )

    raw = response.choices[0].message.content.strip()
    result = _parse_scene_prompts_raw(raw)
    logger.info(
        "generate_scene_prompts_only (OpenAI %s): %d prompts generated for %d scenes",
        model, len(result), len(scenes_input),
    )
    return result


async def _generate_scene_prompts_claude(
    scenes_input, title, genre, mood, scenario, user_scene_prompt, model_name="claude-opus-4-6",
    video_model="veo", asset_keys=None,
):
    """Generate scene prompts using Anthropic Claude."""
    client = _get_anthropic_client()
    system_prompt, user_message = _build_scene_prompt_messages(
        scenes_input, title, genre, mood, scenario, user_scene_prompt,
        video_model=video_model, asset_keys=asset_keys,
    )

    max_tokens = min(max(len(scenes_input) * 500, 8000), 32000)

    scene_kwargs = {
        "model": model_name,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": max_tokens,
    }
    if "opus-4-7" not in model_name:
        scene_kwargs["temperature"] = 0.7
    response = await client.messages.create(**scene_kwargs)

    raw = response.content[0].text.strip()
    result = _parse_scene_prompts_raw(raw)
    logger.info(
        "generate_scene_prompts_only (Claude %s): %d prompts generated for %d scenes",
        model_name, len(result), len(scenes_input),
    )
    return result


async def generate_scene_prompts_only(
    scenes_input: List[dict],
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    scenario: Optional[str] = None,
    user_scene_prompt: Optional[str] = None,
    models: list = None,
    video_model: str = "veo",
    asset_keys: Optional[list] = None,
) -> list:
    """GPT에게 씬 목록을 전달하고 image_prompt, description_ko만 받는다.

    video_prompt는 Phase 2.5에서 Gemini 2.5 Pro가 이미지를 보고 생성한다.

    Args:
        scenes_input: [{"scene_number", "section", "duration", "lyrics", "scene_type"}, ...]
        title: 곡 제목
        genre: 장르
        mood: 분위기
        scenario: MV 시나리오
        user_scene_prompt: 사용자 씬 지시
        models: List of model names. If None, uses default OpenAI model.
                 If contains "gpt-5.4", uses that for OpenAI call.
                 If two models given, runs both in parallel.
        video_model: Target video generation model ("veo", "kling", "seedance")

    Returns:
        Single model: [{"scene_number", "image_prompt", "description_ko"}, ...] (backward compatible)
        Both models: {"results": [{"prompts": [...], "model": "gpt-4o-mini"}, {"prompts": [...], "model": "gpt-5.4"}]}
    """
    common_args = dict(
        scenes_input=scenes_input,
        title=title,
        genre=genre,
        mood=mood,
        scenario=scenario,
        user_scene_prompt=user_scene_prompt,
        video_model=video_model,
        asset_keys=asset_keys,
    )

    if not models:
        return await _generate_scene_prompts_openai(**common_args)

    async def _run(model_name):
        if model_name.startswith("claude-"):
            prompts = await _generate_scene_prompts_claude(**common_args, model_name=model_name)
        else:  # gpt-*
            prompts = await _generate_scene_prompts_openai(**common_args, model_name=model_name)
        return {"prompts": prompts, "model": model_name}

    if len(models) == 1:
        result = await _run(models[0])
        return result["prompts"]

    # Two models: run in parallel
    results = await asyncio.gather(
        _run(models[0]),
        _run(models[1]),
        return_exceptions=True,
    )

    valid_results = [r for r in results if not isinstance(r, Exception)]
    if len(valid_results) == 0:
        raise RuntimeError("All scene prompt generation calls failed")
    if len(valid_results) == 1:
        return valid_results[0]["prompts"]

    return {"results": valid_results}


# ── 2. Generate Scene Image (Gemini) ─────────────────────────────────────────


async def generate_scene_image(
    scene_description: str,
    style_prompt: str = "",
    cover_image_bytes: Optional[bytes] = None,
    character_image_bytes: Optional[bytes] = None,
    scene_type: str = "drama",
    reference_images: Optional[list] = None,
) -> bytes:
    """Generate a single scene image using Gemini. Returns PNG bytes.

    If cover_image_bytes is provided, it is included as a reference so
    that Gemini produces images in a visually consistent style.
    If character_image_bytes is provided, the character appears in the scene.
    If reference_images (list of bytes) is provided, each image is attached as
    additional inlineData (character/location sheet references resolved from
    @character1/@location1 variable references in the prompt).
    """

    prompt_parts = [scene_description]
    if style_prompt:
        prompt_parts.append(style_prompt)
    prompt_parts.append(
        "cinematic widescreen 16:9 aspect ratio, music video still frame, "
        "no text or letters"
    )

    if cover_image_bytes:
        prompt_parts.append(
            "IMPORTANT: Match the visual style, color palette, and artistic "
            "mood of the provided reference image exactly. The scene should "
            "look like it belongs in the same music video as the reference."
        )

    if character_image_bytes:
        if scene_type == "lipsync":
            prompt_parts.append(
                "IMPORTANT: ONLY the main character from the provided character reference sheet appears in this scene. "
                "NO other people or characters. The main character is ALONE, facing the camera, singing/performing. "
                "Maintain their exact appearance (face, hair, features) from the reference. "
                "Photorealistic style only."
            )
        else:
            prompt_parts.append(
                "IMPORTANT: The provided character reference sheet shows the main character "
                "of this music video. This character MUST appear prominently in this scene, "
                "maintaining their exact appearance (face, hair, features) from the reference. "
                "Photorealistic style only — no anime, cartoon, or illustration."
            )

    if reference_images:
        prompt_parts.append(
            "Additional character/location reference sheets are attached. "
            "Characters referenced as @character1, @character2 must match the attached "
            "character sheets exactly (face, hair, outfit). Locations referenced as "
            "@location1, @location2, @location3 must match the attached location "
            "establishing shots (setting, lighting, atmosphere)."
        )

    prompt = ". ".join(prompt_parts)

    # Build request parts
    request_parts: list = [{"text": prompt}]

    # Include cover image as reference for style consistency
    if cover_image_bytes:
        cover_b64 = base64.b64encode(cover_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": cover_b64,
            }
        })

    # Include character sheet as reference
    if character_image_bytes:
        char_b64 = base64.b64encode(character_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": char_b64,
            }
        })

    # Include additional reference images (character/location assets)
    if reference_images:
        for ref_bytes in reference_images:
            if not ref_bytes:
                continue
            ref_b64 = base64.b64encode(ref_bytes).decode("utf-8")
            request_parts.append({
                "inlineData": {
                    "mimeType": "image/png",
                    "data": ref_b64,
                }
            })

    payload = {
        "contents": [{"parts": request_parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            GEMINI_IMAGE_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code == 429:
        # Rate limited — wait and retry once
        logger.warning("Gemini 429 rate limit, waiting 30s before retry...")
        await asyncio.sleep(30)
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                GEMINI_IMAGE_URL,
                params={"key": settings.google_api_key},
                json=payload,
            )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini 이미지 생성 실패 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini 응답에 후보가 없습니다.")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])

    raise ValueError("Gemini 응답에서 이미지를 찾을 수 없습니다.")


# ── 3. Start Scene Video Generation ──────────────────────────────────────────

async def start_scene_video(
    scene_description: str,
    image_bytes: Optional[bytes] = None,
    video_prompt: str = None,
    lyrics_segment: str = None,
    scene_type: str = "drama",
) -> str:
    """Start video generation. Tries Veo 3.1 with image, falls back to Veo 2 text-only.

    Returns operation_name.
    """

    # Music video context prefix
    mv_context = "A cinematic scene from a professional music video. "

    if scene_type == "lipsync" and lyrics_segment:
        # Lipsync scene: include lyrics for Veo to sync mouth movements
        if video_prompt:
            prompt = "{}{}. Camera/Motion: {}. The character is singing these lyrics with synchronized lip movements: \"{}\"".format(
                mv_context, scene_description, video_prompt, lyrics_segment
            )
        else:
            prompt = "{}{}. The character faces the camera and sings these lyrics with perfectly synchronized lip movements, close-up shot: \"{}\"".format(
                mv_context, scene_description, lyrics_segment
            )
    else:
        # Drama scene: regular cinematic
        if video_prompt:
            prompt = "{}{}. Camera/Motion: {}".format(mv_context, scene_description, video_prompt)
        else:
            prompt = "{}{}, smooth cinematic camera movement".format(mv_context, scene_description)

    if image_bytes:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        # referenceImages requires: 16:9 aspect ratio + 8 second duration
        payload = {
            "instances": [
                {
                    "prompt": prompt,
                    "referenceImages": [
                        {
                            "image": {
                                "bytesBase64Encoded": image_b64,
                                "mimeType": "image/png",
                            },
                            "referenceType": "asset",
                        }
                    ],
                }
            ],
            "parameters": {
                "aspectRatio": "16:9",
                "durationSeconds": 8,
            },
        }
    else:
        # Text-only fallback (no image)
        payload = {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "aspectRatio": "16:9",
                "durationSeconds": 8,
            },
        }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            VEO31_GENERATE_URL,
            headers={"x-goog-api-key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Veo 3.1 API 오류 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    operation_name = data.get("name")
    if not operation_name:
        raise ValueError("Veo 3.1 응답에서 operation name을 찾을 수 없습니다.")

    logger.info("Veo 3.1 accepted: %s", operation_name)
    return operation_name


# ── 4. Check Scene Video Status ──────────────────────────────────────────────


async def check_scene_video_status(operation_name: str) -> dict:
    """Check Veo video generation status.

    Returns {"done": bool, "video_uri": str or None, "error": str or None}
    """
    url = VEO_OPERATION_URL.format(operation_name)

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            url,
            headers={"x-goog-api-key": settings.google_api_key},
        )

    if resp.status_code != 200:
        return {
            "done": True,
            "video_uri": None,
            "error": "상태 확인 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            ),
        }

    data = resp.json()

    if not data.get("done"):
        return {"done": False, "video_uri": None, "error": None}

    error = data.get("error")
    if error:
        return {
            "done": True,
            "video_uri": None,
            "error": error.get("message", "알 수 없는 오류가 발생했습니다."),
        }

    response_data = data.get("response", {})
    generated = response_data.get("generateVideoResponse", {})
    samples = generated.get("generatedSamples", [])

    if not samples:
        return {
            "done": True,
            "video_uri": None,
            "error": "생성된 비디오가 없습니다.",
        }

    video_uri = samples[0].get("video", {}).get("uri")
    if not video_uri:
        return {
            "done": True,
            "video_uri": None,
            "error": "비디오 URI를 찾을 수 없습니다.",
        }

    return {"done": True, "video_uri": video_uri, "error": None}


# ── 5. Download Video ────────────────────────────────────────────────────────


async def download_video(video_uri: str) -> bytes:
    """Download video from Google's temporary URI. Returns mp4 bytes."""

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(
            video_uri,
            headers={"x-goog-api-key": settings.google_api_key},
        )

    if resp.status_code != 200:
        raise ValueError(
            "비디오 다운로드 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            )
        )

    return resp.content


# ── 6. Concatenate Videos (ffmpeg) ────────────────────────────────────────────


async def concatenate_videos(video_paths: List[str], output_path: str) -> None:
    """Concatenate video clips using ffmpeg.

    Tries copy mode first; falls back to re-encoding if that fails.
    """
    ffmpeg_bin = _get_ffmpeg_path()
    if not ffmpeg_bin:
        raise RuntimeError(
            "ffmpeg가 설치되어 있지 않습니다. 비디오 합치기를 할 수 없습니다."
        )

    # Create concat list file
    concat_list_path = output_path + ".concat.txt"
    with open(concat_list_path, "w") as f:
        for vp in video_paths:
            f.write("file '{}'\n".format(vp))

    try:
        # Attempt stream-copy (fast, no re-encode)
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy",
            output_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.warning(
                "ffmpeg copy mode failed, falling back to re-encode: %s",
                stderr.decode()[:500],
            )
            # Fallback: re-encode with libx264
            proc2 = await asyncio.create_subprocess_exec(
                ffmpeg_bin, "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list_path,
                "-c:v", "libx264", "-preset", "fast",
                "-movflags", "+faststart",
                output_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr2 = await proc2.communicate()

            if proc2.returncode != 0:
                raise RuntimeError(
                    "ffmpeg 비디오 합치기 실패: {}".format(stderr2.decode()[:500])
                )
    finally:
        # Clean up concat list
        if os.path.exists(concat_list_path):
            os.remove(concat_list_path)


# ── 7. Main Orchestrator ─────────────────────────────────────────────────────


async def _update_job(mongo_db, job_id, update: dict) -> None:
    """Helper to update mv_jobs document."""
    update["updated_at"] = datetime.utcnow()
    await mongo_db.mv_jobs.update_one(
        {"_id": job_id},
        {"$set": update},
    )


async def _generate_single_scene_video(
    scene: dict,
    scene_idx: int,
    image_bytes: bytes,
    tmpdir: str,
) -> Optional[str]:
    """Generate video for a single scene with retry + 429 backoff.

    Returns local file path or None.
    Raises QuotaExhaustedError if all retries fail with 429.
    """

    max_retries = 5
    # Very long backoffs for 429: 3min, 5min, 7min, 10min, 15min
    rate_limit_backoffs = [180, 300, 420, 600, 900]

    consecutive_429 = 0

    for attempt in range(max_retries):
        try:
            operation_name = await start_scene_video(
                scene.get("image_prompt") or scene.get("description", ""),
                image_bytes,
                video_prompt=scene.get("video_prompt"),
            )
            consecutive_429 = 0  # API accepted the request

            # Poll until done (max ~10 minutes per scene)
            for _ in range(120):  # 120 * 5s = 10 min
                await asyncio.sleep(5)
                status = await check_scene_video_status(operation_name)

                if status["done"]:
                    break
            else:
                logger.warning("Scene %d timed out", scene_idx)
                if attempt < max_retries - 1:
                    continue
                return None

            if status.get("error"):
                logger.warning(
                    "Scene %d error: %s", scene_idx, status["error"]
                )
                if attempt < max_retries - 1:
                    continue
                return None

            # Download video
            video_bytes = await download_video(status["video_uri"])
            video_path = os.path.join(tmpdir, "scene_{:03d}.mp4".format(scene_idx))
            with open(video_path, "wb") as f:
                f.write(video_bytes)
            return video_path

        except Exception as e:
            error_str = str(e)
            is_rate_limit = "429" in error_str

            if is_rate_limit:
                consecutive_429 += 1
                backoff = rate_limit_backoffs[min(attempt, len(rate_limit_backoffs) - 1)]
                logger.warning(
                    "Scene %d attempt %d: 429 rate limit — waiting %ds (%.1f min)",
                    scene_idx, attempt + 1, backoff, backoff / 60,
                )
            else:
                consecutive_429 = 0
                backoff = 10 * (attempt + 1)
                logger.warning(
                    "Scene %d attempt %d failed: %s — waiting %ds",
                    scene_idx, attempt + 1, error_str[:200], backoff,
                )

            if attempt < max_retries - 1:
                await asyncio.sleep(backoff)
                continue

            # All retries exhausted
            if consecutive_429 >= max_retries:
                raise _QuotaExhaustedError(
                    "Scene {} — {} consecutive 429 errors".format(
                        scene_idx, consecutive_429
                    )
                )
            return None

    return None


class _QuotaExhaustedError(Exception):
    """Raised when API quota appears fully exhausted."""
    pass


async def run_mv_pipeline(
    job_id,
    title: str,
    genre: Optional[str],
    mood: Optional[str],
    lyrics: Optional[str],
    cover_image_bytes: Optional[bytes],
    mongo_db,
) -> None:
    """Main MV generation orchestrator. Runs as a background task.

    Updates MongoDB mv_jobs document with progress throughout.
    """

    tmpdir = tempfile.mkdtemp(prefix="mv_pipeline_")

    try:
        # ── Step 1: Split lyrics into scenes ──
        await _update_job(mongo_db, job_id, {
            "status": "splitting",
            "progress": 2,
        })

        try:
            scenes = await split_lyrics_into_scenes(lyrics, title, genre, mood)
        except Exception as e:
            logger.error("Failed to split lyrics: %s", e)
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "장면 분할 실패: {}".format(str(e)[:300]),
            })
            return

        total_scenes = len(scenes)
        await _update_job(mongo_db, job_id, {
            "progress": 5,
            "total_scenes": total_scenes,
        })

        logger.info("Job %s: split into %d scenes", job_id, total_scenes)

        # ── Step 2: Generate scene images (sequential) ──
        await _update_job(mongo_db, job_id, {
            "status": "generating_images",
        })

        scene_images: List[Optional[bytes]] = []
        scene_thumbnails: List[str] = []
        minio_client = get_minio()
        progress_per_image = 40.0 / total_scenes  # 5% -> 45%

        for i, scene in enumerate(scenes):
            try:
                img_bytes = await generate_scene_image(
                    scene["description"],
                    cover_image_bytes=cover_image_bytes,
                    scene_type=scene.get("scene_type", "drama"),
                )
                scene_images.append(img_bytes)

                # Save thumbnail to MinIO
                thumb_object = "mv/thumbnails/{}/{:03d}.png".format(
                    str(job_id), i
                )
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=thumb_object,
                    data=io.BytesIO(img_bytes),
                    length=len(img_bytes),
                    content_type="image/png",
                )
                scene_thumbnails.append(thumb_object)

            except Exception as e:
                logger.warning("Scene %d image generation failed: %s", i, e)
                scene_images.append(None)
                scene_thumbnails.append("")

            # Delay between image requests to avoid Gemini rate limits
            if i < total_scenes - 1:
                await asyncio.sleep(3)

            progress = int(5 + (i + 1) * progress_per_image)
            await _update_job(mongo_db, job_id, {
                "progress": min(progress, 45),
                "scene_thumbnails": scene_thumbnails,
            })

        # Check if enough images were generated
        valid_image_count = sum(1 for img in scene_images if img is not None)
        if valid_image_count < total_scenes * 0.5:
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "이미지 생성 실패율이 50%를 초과했습니다. ({}/{} 성공)".format(
                    valid_image_count, total_scenes
                ),
            })
            return

        # ── Step 3 & 4: Generate videos sequentially ──
        await _update_job(mongo_db, job_id, {
            "status": "generating_videos",
            "progress": 45,
        })

        # Process each scene video one at a time to avoid 429 rate limits
        video_paths_map = {}
        completed_count = 0
        consecutive_failures = 0

        for i, (scene, img) in enumerate(zip(scenes, scene_images)):
            if img is None:
                continue

            try:
                video_path = await _generate_single_scene_video(
                    scene, i, img, tmpdir
                )
            except _QuotaExhaustedError as e:
                logger.error("Job %s: Quota exhausted at scene %d: %s", job_id, i, e)
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": (
                        "API 할당량이 소진되었습니다. 잠시 후 다시 시도해주세요. "
                        "({}/{} 씬 완료)".format(completed_count, total_scenes)
                    ),
                    "completed_scenes": completed_count,
                })
                return

            if video_path:
                video_paths_map[i] = video_path
                completed_count += 1
                consecutive_failures = 0

                # Breathing room for API before next scene
                await asyncio.sleep(15)
            else:
                consecutive_failures += 1
                # If 3 scenes in a row fail, likely quota issue — stop early
                if consecutive_failures >= 3:
                    logger.error(
                        "Job %s: %d consecutive failures, stopping early", job_id, consecutive_failures
                    )
                    await _update_job(mongo_db, job_id, {
                        "status": "failed",
                        "error_message": (
                            "연속 {}개 씬 실패 — API 할당량 소진 추정. "
                            "잠시 후 다시 시도해주세요. ({}/{} 씬 완료)".format(
                                consecutive_failures, completed_count, total_scenes
                            )
                        ),
                        "completed_scenes": completed_count,
                    })
                    return

            # Update progress: 45-85% range
            progress = int(45 + (completed_count / valid_image_count) * 40)
            await _update_job(mongo_db, job_id, {
                "progress": min(progress, 85),
                "completed_scenes": completed_count,
            })

        logger.info(
            "Job %s: %d/%d videos completed", job_id, completed_count, total_scenes
        )

        # Check if enough videos succeeded (30% minimum, at least 3)
        if completed_count < max(total_scenes * 0.3, 3):
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "비디오 생성 실패율이 70%를 초과했습니다. ({}/{} 성공)".format(
                    completed_count, total_scenes
                ),
            })
            return

        if completed_count == 0:
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "모든 장면의 비디오 생성에 실패했습니다.",
            })
            return

        # Sort video paths by scene index
        ordered_video_paths = [
            video_paths_map[idx]
            for idx in sorted(video_paths_map.keys())
        ]

        # ── Step 5 & 6: Concatenate videos ──
        await _update_job(mongo_db, job_id, {
            "status": "concatenating",
            "progress": 90,
        })

        if not _ffmpeg_available():
            # If only one video, skip concat
            if len(ordered_video_paths) == 1:
                final_video_path = ordered_video_paths[0]
            else:
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "ffmpeg가 설치되어 있지 않아 비디오를 합칠 수 없습니다.",
                })
                return
        elif len(ordered_video_paths) == 1:
            final_video_path = ordered_video_paths[0]
        else:
            final_video_path = os.path.join(tmpdir, "final_output.mp4")
            try:
                await concatenate_videos(ordered_video_paths, final_video_path)
            except Exception as e:
                logger.error("Concatenation failed: %s", e)
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "비디오 합치기 실패: {}".format(str(e)[:300]),
                })
                return

        await _update_job(mongo_db, job_id, {"progress": 95})

        # ── Step 7: Upload final video to MinIO ──
        final_object_name = "mv/generated/{}/{}.mp4".format(
            str(job_id), "final"
        )

        with open(final_video_path, "rb") as f:
            video_data = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=final_object_name,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        await _update_job(mongo_db, job_id, {
            "status": "completed",
            "progress": 100,
            "completed_scenes": completed_count,
            "result_video_url": final_object_name,
        })

        logger.info("Job %s: MV pipeline completed successfully", job_id)

    except Exception as e:
        logger.error("MV pipeline unexpected error for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "예상치 못한 오류가 발생했습니다: {}".format(str(e)[:300]),
        })

    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
