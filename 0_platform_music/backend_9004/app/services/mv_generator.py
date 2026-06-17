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
import re
import shutil
import tempfile
from datetime import datetime
from typing import Dict, List, Optional

import anthropic
import httpx

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from .location_prompt import anchor_clause

logger = logging.getLogger(__name__)


# ── v64: Video prompt safety sanitizer ───────────────────────────────────────
# Seedance / Veo / Kling 의 output content filter (partner_validation_failed)
# 를 사전 회피하기 위한 단어 치환 dict. LLM 시스템 프롬프트 가이드(Layer 1)
# 가 무시한 표현을 정적 후처리(Layer 2)에서 한 번 더 잡는다.
# 적용 위치: mv_pipeline.py 의 영상 호출 직전 (image_prompt / video_prompt /
# description 3개 슬롯). Mongo 원본은 변경하지 않는다.
_VIDEO_PROMPT_UNSAFE_PATTERNS = [
    # 순서 중요 — 긴 매칭이 먼저 와야 부분 매칭 충돌 방지.
    # v65: 새로 발견된 트리거 9개 추가 — 3 모델 (Veo/Kling/Seedance) 모두 대응.
    (r"singing the chorus with mouth open",  "softly mouthing the chorus lyrics"),
    (r"singing the chorus joyfully",         "softly mouthing the chorus"),
    (r"eyes closed,?\s*breathing in the scent", "with a gentle expression"),
    (r"alone faces? camera directly",        "framed in a medium close-up"),
    (r"alone,?\s*facing camera",             "framed in a medium close-up"),
    (r"alone faces? camera",                 "framed in a medium close-up"),
    (r"hands lightly raised in a joyful gesture", "hands resting naturally"),
    (r"hair lifted by a gentle breeze",      "soft breeze drifts in the air"),
    (r"hair lifting in the (wind|breeze)",   "soft breeze in the air"),
    (r"hair lifting",                        "soft breeze in the air"),
    (r"drowning in a soft pink-?petal storm", "surrounded by gently drifting petals"),
    (r"drowning in (a )?(soft )?pink-?petal storm", "surrounded by gently drifting petals"),
    (r"slight head sway",                    ""),
    (r"rhythmic shoulder (movement|sway)",   ""),
    (r"shoulder sway",                       ""),
    (r"mouth open",                          "softly mouthing the lyrics"),
    (r"bright expressive eyes",              "soft warm expression"),
    (r"expressive eyes",                     "soft warm expression"),
    (r"sparkling eyes",                      "soft warm expression"),
    (r"bright smile",                        "subtle smile"),
    (r"joyful expression",                   "warm expression"),
    (r"joyful gesture",                      "natural pose"),
    (r"K-?pop MV grade",                     "cinematic pastel grade"),
    (r"K-?pop MV",                           "cinematic music video"),
]


def sanitize_video_prompt(text: Optional[str]) -> str:
    """v64 — 영상 모델에 전달되는 prompt 의 위험 표현을 안전 표현으로 치환.

    Layer 2 of the 2-stage safety net:
      Layer 1 = LLM 시스템 프롬프트 가이드 (예방)
      Layer 2 = 이 함수 (사후 정정)

    Args:
        text: 영상 모델에 보낼 prompt 텍스트 (image_prompt / video_prompt /
              description 어느 슬롯이든 통과 가능). None/빈 문자열이면 그대로.

    Returns:
        치환된 문자열. case-insensitive regex 적용 후 연속 공백 정리.
    """
    if not text:
        return text or ""
    out = text
    hits = []
    for pat, repl in _VIDEO_PROMPT_UNSAFE_PATTERNS:
        new = re.sub(pat, repl, out, flags=re.IGNORECASE)
        if new != out:
            hits.append(pat)
            out = new
    # 빈 치환으로 생긴 연속 공백 / 양끝 공백 정리.
    out = re.sub(r"\s{2,}", " ", out).strip()
    if hits:
        logger.info(
            "[PromptSanitize] replaced=%d patterns=%s in_len=%d out_len=%d",
            len(hits), hits, len(text), len(out),
        )
    return out


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

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into concrete camera \
behaviour and subject motion. Avoid generic verbs (walks, sits, drinks); pick a movement \
that visually expresses the motivation and the emotion shift.

Veo style guide:
- Write as a film director giving natural instructions, not technical specs
- Describe the feel and flow: "The camera drifts slowly toward her face as warm light catches the tears"
- Blend movements naturally — Veo interprets mood and merges motions smoothly
- 3-6 sentences, 100-150 words ideal
- Place camera movement first, then subject action, then atmospheric details

Character rules:
- The main character's appearance must remain consistent with the reference image
- PRESERVE the wardrobe / outfit (top, bottom, shoes, accessories) from the reference
- Mention specific wardrobe/hair details to help Veo maintain identity across shots
- For lipsync scenes: slow, intimate camera movement, close-up on face

Duration awareness:
This clip is exactly {duration:.1f} seconds long. Design the camera move so it begins, \
develops, and resolves within that exact duration. ≤3s = single fast motion. \
4-6s = single moderate move. 7-10s = slow move with subtle subject motion.

## v67 — Veo 3.1 recommended prompt structure
Follow this 5-slot structure for best results:
- [Cinematography]   shot type, camera movement, lens
- [Subject]          who/what (appearance only)
- [Action]           what the subject does (Action / description slot)
- [Context]          location, time of day, background
- [Style & Ambiance] lighting, palette, mood
Place camera movement in a SEPARATE sentence from the subject action.
Length: 3-6 sentences, 100-150 words.

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
The downstream video model (Veo / Kling / Seedance — all three) runs an automated safety \
filter that inspects the GENERATED video frames. Violations cause hard rejection. STRICT:
- Describe the subject by APPEARANCE only — no attractiveness emphasis, no allure language, \
no glamour adjectives.
- NEVER write any of these trigger phrases (each has been observed to cause rejection):
  "alone faces camera directly", "alone faces camera", "alone facing camera", "mouth open", \
"singing with mouth open", "singing the chorus joyfully", "sparkling eyes", "expressive eyes", \
"bright expressive eyes", "bright smile", "joyful expression", "joyful gesture", \
"hair lifted by a gentle breeze", "hair lifting in the wind", "hair lifting", \
"slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"hands lightly raised in a joyful gesture", "eyes closed, breathing in the scent", \
"drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
- ALWAYS prefer neutral cinematic alternatives: "framed in a medium close-up", "softly \
mouthing the lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze \
drifts in the air", "hands resting naturally", "surrounded by gently drifting petals", \
"with a gentle expression", "cinematic pastel grade".
- Place camera movement in a separate sentence from subject motion (Veo best practice).
- Keep motion descriptions restrained — avoid dramatic body movement combined with extreme close-ups.
- Provide sufficient visual context (lighting, wardrobe, background) so the scene reads as \
a cinematic film shot, not a glamour portrait.

Output plain English text only. No JSON, no bullet points.
"""

VIDEO_PROMPT_VEO_FREE = """\
You are an elite music video cinematographer planning camera movement for Google Veo 3.1.

Analyze the scene image — subject position, lighting, depth, emotion — then write a \
cinematic camera direction in natural, descriptive language.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into concrete camera \
behaviour and environmental motion. Avoid generic verbs (walks, sits, drinks); choose movement \
that visually expresses the motivation and the emotion shift.

Veo style guide:
- Write as a film director giving natural instructions, not technical specs
- Describe the feel and flow: "The camera sweeps across the rain-soaked street, pulling back to reveal the empty bench"
- Blend movements naturally — Veo interprets mood and merges motions smoothly
- 3-6 sentences, 100-150 words ideal
- Place camera movement first, then environmental action, then atmospheric details
- Any artistic style is welcome — match the visual tone of the image

For lipsync scenes: slow, intimate camera movement, close-up on face.

Duration awareness:
This clip is exactly {duration:.1f} seconds long. Design the camera move so it begins, \
develops, and resolves within that exact duration. ≤3s = single fast motion. \
4-6s = single moderate move. 7-10s = slow move with subtle environmental motion.

## v67 — Veo 3.1 recommended prompt structure
5-slot structure: [Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance].
Place camera movement in a SEPARATE sentence from environmental action.
Length: 3-6 sentences, 100-150 words.

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
The downstream video model (Veo / Kling / Seedance — all three) runs an automated safety \
filter on GENERATED frames. Violations cause hard rejection. STRICT:
- Keep environmental and atmospheric descriptions neutral and cinematic.
- NEVER write any of these trigger phrases: "alone faces camera directly", "alone faces \
camera", "alone facing camera", "mouth open", "singing with mouth open", "singing the chorus \
joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", "bright smile", \
"joyful expression", "joyful gesture", "hair lifted by a gentle breeze", "hair lifting in the \
wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"hands lightly raised in a joyful gesture", "eyes closed, breathing in the scent", \
"drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
- ALWAYS prefer neutral cinematic alternatives: "framed in a medium close-up", "soft warm \
expression", "subtle smile", "natural pose", "soft breeze drifts in the air", "surrounded by \
gently drifting petals", "with a gentle expression", "cinematic pastel grade".
- Place camera movement in a separate sentence from environmental action.
- Provide sufficient visual context (lighting, location, atmosphere) for a cinematic film shot.

Output plain English text only. No JSON, no bullet points.
"""

VIDEO_PROMPT_KLING_CHARACTER = """\
You are an elite music video cinematographer planning camera movement for Kling 3.0 Omni.

Analyze the scene image — subject position, lighting, depth, emotion — then write \
precise, structured camera directions that Kling can execute literally.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into concrete subject \
movement and camera parameters. Avoid generic verbs (walks, sits, drinks); pick movements that \
literally execute the motivation and the emotion shift.

Kling style guide:
- Write as a technical shot list with specific parameters
- Specify: camera type, direction, speed, duration (e.g., "tracking shot, left to right, slow, 5 seconds")
- Kling executes multi-phase movements sequentially — list them in order
- Include exact angles when relevant (e.g., "45-degree low angle")
- Keep prompt structured: Camera → Subject Action → Environment → Texture/Grain

Character rules:
- Reference <<<image_N>>> for character consistency
- The character in the reference must appear prominently with exact same appearance
- PRESERVE the wardrobe / outfit (top, bottom, shoes, accessories) from the reference
- Specify character's physical actions precisely (e.g., "turns head 90 degrees to the left over 2 seconds")
- For lipsync scenes: static camera or very slow dolly, frontal angle, focus locked on face

Duration budget:
Clip duration: {duration:.1f} seconds. Constrain motion: ≤3s → 1 fast move (whip/crash zoom). \
4-6s → 1 medium move (dolly/tracking). 7-10s → 1 slow move + minor subject action. \
Specify timings within this budget.

## v67 — Kling 3.0 Omni recommended prompt structure
6-slot order (one sentence each works best):
  Subject → Subject Detail → Movement → Scene/Environment → Camera → Lighting/Atmosphere
Use explicit motion verbs (tracking, panning, freezing, push-in).
Reference characters via <<<image_N>>> tags (provided as image_list).
Length: 3-6 sentences.

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
Kling inspects both inputs and GENERATED frames. STRICT:
- Describe the subject by APPEARANCE only — no allure/attractiveness emphasis.
- NEVER write any of these trigger phrases: "alone faces camera directly", "alone faces \
camera", "alone facing camera", "mouth open", "singing with mouth open", "singing the chorus \
joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", "bright smile", \
"joyful expression", "joyful gesture", "hair lifted by a gentle breeze", "hair lifting in the \
wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"hands lightly raised in a joyful gesture", "eyes closed, breathing in the scent", \
"drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
- ALWAYS prefer neutral alternatives: "framed in a medium close-up", "softly mouthing the \
lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze drifts in the \
air", "hands resting naturally", "surrounded by gently drifting petals", "with a gentle \
expression", "cinematic pastel grade".
- Keep body motion restrained when paired with close-up framing.
- Provide sufficient cinematic context (lighting, wardrobe, background).

Output plain English text only. No JSON.
"""

VIDEO_PROMPT_KLING_FREE = """\
You are an elite music video cinematographer planning camera movement for Kling 3.0 Omni.

Analyze the scene image — subject position, lighting, depth, emotion — then write \
precise, structured camera directions that Kling can execute literally.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into concrete subject \
or environmental movement and camera parameters. Avoid generic verbs (walks, sits, drinks); \
choose movements that literally execute the motivation and the emotion shift.

Kling style guide:
- Write as a technical shot list with specific parameters
- Specify: camera type, direction, speed, duration (e.g., "tracking shot, left to right, slow, 5 seconds")
- Kling executes multi-phase movements sequentially — list them in order
- Include exact angles when relevant (e.g., "45-degree low angle")
- Keep prompt structured: Camera → Subject/Environment Action → Lighting → Texture/Grain
- Any visual style is welcome — match the artistic tone of the image

For lipsync scenes: static camera or very slow dolly, frontal angle, focus locked on face.

Duration budget:
Clip duration: {duration:.1f} seconds. Constrain motion: ≤3s → 1 fast move (whip/crash zoom). \
4-6s → 1 medium move (dolly/tracking). 7-10s → 1 slow move + minor environmental action. \
Specify timings within this budget.

## v67 — Kling 3.0 Omni recommended prompt structure
6-slot order: Subject → Subject Detail → Movement → Scene/Environment → Camera → Lighting.
Use explicit motion verbs (tracking, panning, freezing, push-in).
Length: 3-6 sentences.

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
Kling inspects both inputs and GENERATED frames. STRICT:
- Keep environmental and atmospheric descriptions neutral and cinematic.
- NEVER write any of these trigger phrases: "alone faces camera directly", "alone faces \
camera", "alone facing camera", "mouth open", "singing with mouth open", "singing the chorus \
joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", "bright smile", \
"joyful expression", "joyful gesture", "hair lifted by a gentle breeze", "hair lifting in the \
wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"eyes closed, breathing in the scent", "drowning in a soft pink-petal storm", "K-pop MV \
grade", "K-pop MV".
- ALWAYS prefer cinematic alternatives: "framed in a medium close-up", "soft warm expression", \
"subtle smile", "natural pose", "soft breeze drifts in the air", "surrounded by gently \
drifting petals", "with a gentle expression", "cinematic pastel grade".
- Provide sufficient cinematic context for a film shot, not a glamour portrait.

Output plain English text only. No JSON.
"""


VIDEO_PROMPT_SEEDANCE_CHARACTER = """\
You are an elite music video cinematographer planning camera movement for Seedance 2.0.

Analyze the scene image then write a director-style camera direction.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into one concrete \
movement that visually expresses the motivation and the emotion shift. Avoid generic verbs \
(walks, sits, drinks).

Seedance style guide:
- Structure: [Action] + [Scene] + [Style] + [Camera]
- 60-100 words total
- ONE camera instruction only (no multi-phase movements)
- Use pacing words (slow, smooth, gentle, dynamic) instead of technical parameters
- Lighting in one concise line
- End with "Preserve composition and colors."

Character rules:
- The main character must maintain exact appearance from the reference
- PRESERVE the wardrobe / outfit (top, bottom, shoes, accessories) from the reference
- Specify character actions precisely
- For lipsync: static or gentle dolly, focus on face

Duration: {duration:.1f}s. ≤3s: one fast motion. 4-6s: one medium move. \
7-10s: slow move + subtle subject action. Stay within this budget.

## v67 — Seedance 2.0 official 6-step formula
Subject → Action → Environment → Camera → Style → Constraints (one sentence each).
- Lighting description has the biggest impact on output quality.
- ALWAYS include Constraints (negative guidance) such as
  "no text, no watermark, no glamour portrait framing".
- Length: 30-100 words.

## v65 — Content safety guidelines (CRITICAL — Seedance partner_validation_failed prevention)
Seedance's output content filter is the strictest of the three backends — \
partner_validation_failed errors are common with glamour/portrait framing. STRICT:
- Describe the subject by APPEARANCE only — NO allure/attractiveness/glamour emphasis.
- NEVER write any of these trigger phrases (each has been observed to cause rejection):
"alone faces camera directly", "alone faces camera", "alone facing camera", "mouth open", \
"singing with mouth open", "singing the chorus joyfully", "sparkling eyes", "expressive eyes", \
"bright expressive eyes", "bright smile", "joyful expression", "joyful gesture", \
"hair lifted by a gentle breeze", "hair lifting in the wind", "hair lifting", \
"slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"hands lightly raised in a joyful gesture", "eyes closed, breathing in the scent", \
"drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
- ALWAYS prefer neutral cinematic alternatives: "framed in a medium close-up", "softly \
mouthing the lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze \
drifts in the air", "hands resting naturally", "surrounded by gently drifting petals", \
"with a gentle expression", "cinematic pastel grade".
- Keep body motion restrained when paired with close-up framing — a glamour music-video portrait \
combo is the most likely rejection pattern.
- Place camera in [Camera] block at the end (not blended with subject action).
- Provide sufficient cinematic context — lighting + wardrobe + background — so the scene reads \
as a film shot, not a portrait/glamour close-up.

Output plain English text only. No JSON.
"""

VIDEO_PROMPT_SEEDANCE_FREE = """\
You are an elite music video cinematographer planning camera movement for Seedance 2.0.

Analyze the scene image then write a director-style camera direction.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into one concrete \
movement that visually expresses the motivation and the emotion shift. Avoid generic verbs \
(walks, sits, drinks).

Seedance style guide:
- Structure: [Action] + [Scene] + [Style] + [Camera]
- 60-100 words total
- ONE camera instruction only (no multi-phase movements)
- Use pacing words (slow, smooth, gentle, dynamic) instead of technical parameters
- Lighting in one concise line
- Any visual style welcome
- End with "Preserve composition and colors."

For lipsync: static or gentle dolly, focus on face.

Duration: {duration:.1f}s. ≤3s: one fast motion. 4-6s: one medium move. \
7-10s: slow move + subtle subject action. Stay within this budget.

## v67 — Seedance 2.0 official 6-step formula
Subject → Action → Environment → Camera → Style → Constraints.
- Lighting description has the biggest impact on output quality.
- ALWAYS include Constraints (negative guidance).
- Length: 30-100 words.

## v65 — Content safety guidelines (CRITICAL — Seedance partner_validation_failed prevention)
Seedance's output content filter is the strictest of the three backends. STRICT:
- Keep environmental descriptions neutral and cinematic.
- NEVER write any of these trigger phrases: "alone faces camera directly", "alone faces \
camera", "alone facing camera", "mouth open", "singing with mouth open", "singing the chorus \
joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", "bright smile", \
"joyful expression", "joyful gesture", "hair lifted by a gentle breeze", "hair lifting in the \
wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"eyes closed, breathing in the scent", "drowning in a soft pink-petal storm", "K-pop MV \
grade", "K-pop MV".
- ALWAYS prefer cinematic alternatives: "framed in a medium close-up", "soft warm expression", \
"subtle smile", "natural pose", "soft breeze drifts in the air", "surrounded by gently \
drifting petals", "with a gentle expression", "cinematic pastel grade".
- Provide sufficient cinematic context (lighting, atmosphere, environment).

Output plain English text only. No JSON.
"""


# v66: Grok Imagine Video — xAI 직접 API. content policy 가 Seedance 대비 느슨하나
# 그래도 v65 안전 가이드 동일 적용 (3 모델 통일 정책).

VIDEO_PROMPT_GROK_CHARACTER = """\
You are an elite music video cinematographer planning camera movement for xAI Grok Imagine Video.

Analyze the scene image — subject position, lighting, depth, emotion — then write a \
cinematic camera direction in natural, descriptive language.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into concrete camera \
behaviour and subject motion. Avoid generic verbs (walks, sits, drinks); pick a movement \
that visually expresses the motivation and the emotion shift.

Grok style guide:
- Write as a film director giving natural instructions, descriptive language.
- 3-6 sentences, 100-150 words ideal.
- Place camera movement first, then subject action, then atmospheric details.
- The main character's appearance must remain consistent with the reference image.
- PRESERVE the wardrobe / outfit (top, bottom, shoes, accessories) from the reference.
- For lipsync scenes: slow, intimate camera movement, close-up on face.

Duration awareness:
This clip is exactly {duration:.1f} seconds long (Grok max 10s). Design the camera move so it \
begins, develops, and resolves within that exact duration. ≤3s = single fast motion. \
4-6s = single moderate move. 7-10s = slow move with subtle subject motion.

## v67 — Grok Imagine Video recommended prompt structure
Grok prioritizes the FIRST 20-30 WORDS of the prompt — place PRIMARY MOTION at the START.
For image-to-video, do NOT re-describe the visible image — focus only on motion,
camera, and atmosphere change.
Structure: [Motion/Action] + [Camera] + [Style] + (optional) Audio direction.
Length: 6-30s (we cap 10s).

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
The downstream video model (Veo / Kling / Seedance / Grok — all four) runs an automated safety \
filter on GENERATED frames. STRICT:
- Describe the subject by APPEARANCE only — no attractiveness emphasis, no allure language.
- NEVER write any of these trigger phrases: "alone faces camera directly", "alone faces \
camera", "alone facing camera", "mouth open", "singing with mouth open", "singing the chorus \
joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", "bright smile", \
"joyful expression", "joyful gesture", "hair lifted by a gentle breeze", "hair lifting in the \
wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"hands lightly raised in a joyful gesture", "eyes closed, breathing in the scent", \
"drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
- ALWAYS prefer neutral cinematic alternatives: "framed in a medium close-up", "softly \
mouthing the lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze \
drifts in the air", "hands resting naturally", "surrounded by gently drifting petals", \
"with a gentle expression", "cinematic pastel grade".
- Place camera movement in a separate sentence from subject motion.
- Keep motion descriptions restrained — avoid dramatic body movement combined with extreme close-ups.
- Provide sufficient visual context (lighting, wardrobe, background) so the scene reads as \
a cinematic film shot, not a glamour portrait.

Output plain English text only. No JSON, no bullet points.
"""

VIDEO_PROMPT_GROK_FREE = """\
You are an elite music video cinematographer planning camera movement for xAI Grok Imagine Video.

Analyze the scene image — subject position, lighting, depth, emotion — then write a \
cinematic camera direction in natural, descriptive language.

## Story Context (event-driven — use this to shape motion and emotion)
{scene_event_block}

## Overall Emotional Core of the song
{emotional_core}

Translate the trigger / protagonist_action / motivation / emotion_shift into concrete camera \
behaviour and environmental motion. Choose movement that visually expresses the motivation and \
the emotion shift.

Grok style guide:
- Write as a film director giving natural instructions.
- 3-6 sentences, 100-150 words ideal.
- Place camera movement first, then environmental action, then atmospheric details.
- Any artistic style is welcome — match the visual tone of the image.

For lipsync scenes: slow, intimate camera movement, close-up on face.

Duration awareness:
This clip is exactly {duration:.1f} seconds long (Grok max 10s). Design the camera move so it \
begins, develops, and resolves within that exact duration. ≤3s = single fast motion. \
4-6s = single moderate move. 7-10s = slow move with subtle environmental motion.

## v67 — Grok Imagine Video recommended prompt structure
Grok prioritizes the FIRST 20-30 WORDS — place PRIMARY MOTION at the START.
For image-to-video, do NOT re-describe the visible image — focus on motion,
camera, and atmosphere change only.
Structure: [Motion/Action] + [Camera] + [Style] + (optional) Audio direction.

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
The downstream video model runs an automated safety filter on GENERATED frames. STRICT:
- Keep environmental and atmospheric descriptions neutral and cinematic.
- NEVER write any of these trigger phrases: "alone faces camera directly", "alone faces \
camera", "alone facing camera", "mouth open", "singing with mouth open", "singing the chorus \
joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", "bright smile", \
"joyful expression", "joyful gesture", "hair lifted by a gentle breeze", "hair lifting in the \
wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", "shoulder sway", \
"eyes closed, breathing in the scent", "drowning in a soft pink-petal storm", "K-pop MV \
grade", "K-pop MV".
- ALWAYS prefer cinematic alternatives: "framed in a medium close-up", "soft warm expression", \
"subtle smile", "natural pose", "soft breeze drifts in the air", "surrounded by gently \
drifting petals", "with a gentle expression", "cinematic pastel grade".
- Place camera movement in a separate sentence from environmental action.
- Provide sufficient visual context (lighting, location, atmosphere) for a cinematic film shot.

Output plain English text only. No JSON, no bullet points.
"""


def _select_video_prompt_template(video_model: str, has_character: bool) -> str:
    """Select the appropriate video prompt system template."""
    if video_model == "veo":
        return VIDEO_PROMPT_VEO_CHARACTER if has_character else VIDEO_PROMPT_VEO_FREE
    elif video_model == "seedance":
        return VIDEO_PROMPT_SEEDANCE_CHARACTER if has_character else VIDEO_PROMPT_SEEDANCE_FREE
    elif video_model == "grok":
        return VIDEO_PROMPT_GROK_CHARACTER if has_character else VIDEO_PROMPT_GROK_FREE
    else:  # kling
        return VIDEO_PROMPT_KLING_CHARACTER if has_character else VIDEO_PROMPT_KLING_FREE


def _format_scene_event_block(scene_event: Optional[dict]) -> str:
    """Format a single event dict into a human-readable bullet block for video_prompt context.

    Returns a multi-line string with `- Trigger: ...`, `- Protagonist action: ...`, etc.
    Returns "(no specific event mapped — improvise from the image)" when scene_event is None
    or empty so the rest of the system prompt still flows naturally.

    v45: introduced for B5/B6 — gives the per-clip cinematographer LLM the trigger /
    protagonist_action / motivation / emotion_shift / props context that drives motion
    beyond generic walk/sit verbs.
    """
    if not scene_event or not isinstance(scene_event, dict):
        return "(no specific event mapped — improvise camera and motion from the image)"

    def _val(key, default=""):
        v = scene_event.get(key, default)
        if v is None:
            return default
        if isinstance(v, (list, tuple)):
            return ", ".join(str(x) for x in v if x is not None and str(x).strip())
        return str(v).strip()

    trigger = _val("trigger") or "(unspecified)"
    action = _val("protagonist_action") or "(unspecified)"
    motivation = _val("motivation") or "(unspecified)"
    emotion_shift = _val("emotion_shift") or "(unspecified)"
    other_chars_raw = scene_event.get("other_characters") or []
    if isinstance(other_chars_raw, (list, tuple)):
        other_chars_clean = [str(x).strip() for x in other_chars_raw if x is not None and str(x).strip()]
    else:
        other_chars_clean = [str(other_chars_raw).strip()] if str(other_chars_raw).strip() else []
    other_chars = ", ".join(other_chars_clean) if other_chars_clean else "(none)"
    props = _val("props") or "(none)"

    lines = [
        "- Trigger: {}".format(trigger),
        "- Protagonist action: {}".format(action),
        "- Motivation: {}".format(motivation),
        "- Other characters: {}".format(other_chars),
        "- Emotion shift: {}".format(emotion_shift),
        "- Props in scene: {}".format(props),
    ]
    return "\n".join(lines)


def _compress_image_for_vision(
    image_bytes: bytes,
    max_side: int = 1024,
    jpeg_quality: int = 85,
) -> tuple[bytes, str]:
    """v60 — Claude/Gemini vision 첨부용 이미지 압축.

    Anthropic Claude vision API 는 base64 인코딩 후 5MB(5,242,880 bytes) 제한.
    2K PNG 자산이 base64 후 8~10MB 가 되어 모든 씬 호출이 400 으로 거부되는 문제 해결.

    원본 디스크/Mongo 의 이미지는 영향 받지 않음. 메모리에서만 다운스케일.

    Args:
        image_bytes: 원본 PNG bytes
        max_side: 가로/세로 중 긴 변의 최대 픽셀 (기본 1024)
        jpeg_quality: JPEG 품질 (기본 85)

    Returns:
        (compressed_bytes, media_type) — 압축된 JPEG bytes 와 "image/jpeg".
        압축 실패 시 (image_bytes, "image/png") 로 원본 반환 (호출자가 그대로 첨부 시도).
    """
    try:
        from PIL import Image
        import io as _io
        with _io.BytesIO(image_bytes) as inp:
            img = Image.open(inp)
            img.load()
        # RGBA / palette 등을 JPEG 저장 가능한 RGB 로 변환
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        out = _io.BytesIO()
        img.save(out, format="JPEG", quality=jpeg_quality, optimize=True)
        compressed = out.getvalue()
        logger.info(
            "[Phase2.5Img] compressed original=%d → jpeg=%d bytes (max_side=%d, q=%d)",
            len(image_bytes), len(compressed), max_side, jpeg_quality,
        )
        return compressed, "image/jpeg"
    except Exception as e:
        logger.warning(
            "[Phase2.5Img] compression failed (%s) — sending original bytes",
            "{}: {}".format(type(e).__name__, str(e)[:160]),
        )
        return image_bytes, "image/png"


async def extract_character_description_from_cover(cover_bytes: Optional[bytes]) -> str:
    """v63 — 커버 이미지에 인물이 있으면 외형·분위기를 영문 1~2 문장 description 으로 추출.

    Gemini 2.5 Pro multimodal 호출. 인물이 없거나 호출 실패 시 빈 문자열 반환.
    호출자는 이 값을 character1_meta["description"] 에 미리 박아서
    시나리오 LLM 호출 시 "변경 금지" 룰로 사용 (LLM 받아쓰기).

    name/age/personality 는 추출하지 않음 — 시나리오 LLM 이 곡 맥락 기반으로 결정.

    Returns:
        영문 description 문자열 또는 "" (인물 없음 / 실패 / 비활성)
    """
    if not cover_bytes:
        logger.info("[CoverDescExtract] no cover bytes — returning empty")
        return ""
    try:
        compressed, media_type = _compress_image_for_vision(cover_bytes)
        image_b64 = base64.b64encode(compressed).decode("utf-8")
        system_prompt = (
            "You are a casting director analyzing an album cover image. Identify whether "
            "the cover features a clearly visible single main human subject (the would-be "
            "protagonist of a music video). If yes, output ONE to TWO concise English "
            "sentences describing ONLY their physical appearance and overall vibe — face "
            "shape, hair (color/length/style), build, wardrobe top-level style, lighting "
            "mood. Do NOT speculate about name, age, personality, or backstory. Do NOT "
            "mention attractiveness or glamour. Use neutral cinematic language.\n\n"
            "If the cover has NO clearly visible human subject (landscape, abstract, "
            "object only, or only background figures), output exactly: NO_PERSON\n\n"
            "Output the description sentences only (or NO_PERSON), no JSON, no preface."
        )
        user_text = "Analyze this cover image."
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"parts": [
                {"text": user_text},
                {"inlineData": {"mimeType": media_type, "data": image_b64}},
            ]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 256},
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                GEMINI_VIDEO_PROMPT_URL,
                params={"key": settings.google_api_key},
                json=payload,
            )
        if resp.status_code != 200:
            logger.warning(
                "[CoverDescExtract] HTTP %d — returning empty. body=%s",
                resp.status_code, resp.text[:200],
            )
            return ""
        data = resp.json()
        candidates = data.get("candidates", []) or []
        if not candidates:
            logger.warning("[CoverDescExtract] no candidates — returning empty")
            return ""
        parts = candidates[0].get("content", {}).get("parts", []) or []
        text = (parts[0].get("text") if parts else "") or ""
        text = text.strip()
        if not text or text.upper().startswith("NO_PERSON"):
            logger.info("[CoverDescExtract] no person detected — returning empty")
            return ""
        logger.info(
            "[CoverDescExtract] extracted len=%d preview=%s",
            len(text), text[:80].replace("\n", " "),
        )
        return text
    except Exception as e:
        logger.exception(
            "[CoverDescExtract] failed: %s",
            "{}: {}".format(type(e).__name__, str(e)[:160]),
        )
        return ""


async def generate_video_prompts_from_images(
    image_bytes: bytes,
    image_prompt: str = "",
    scene_type: str = "drama",
    lyrics_segment: str = "",
    scene_number: int = 1,
    model: str = "gemini-2.5-pro",
    video_model: str = "veo",
    has_character: bool = False,
    duration: float = 5.0,
    scene_event: Optional[dict] = None,
    emotional_core: Optional[str] = None,
) -> str:
    """Multimodal로 씬 이미지를 분석하여 video_prompt를 생성한다.

    Args:
        image_bytes: 생성된 씬 이미지 (PNG)
        image_prompt: 해당 씬의 image_prompt 텍스트
        scene_type: "drama" 또는 "lipsync"
        lyrics_segment: 해당 씬의 가사
        scene_number: 씬 번호
        model: 사용할 모델 (기본값 "gemini-2.5-pro", "claude-*" 지원)
        scene_event: v45 — 해당 씬에 매핑된 event dict (trigger/protagonist_action/
            motivation/other_characters/emotion_shift/props). None 이면 generic context.
        emotional_core: v45 — 곡 전체 emotional core 표현 (예: "그리움 60% + 후회 25% +
            결심 15%"). None 이면 빈 문자열로 주입되어 템플릿 흐름이 자연스럽게 유지됨.

    Returns:
        video_prompt 문자열 (plain text, 2-3 sentences)
    """
    # v60: Claude vision 5MB 제한 우회 위해 1024 thumbnail + JPEG q85 압축. 원본 무변경.
    compressed_bytes, compressed_media_type = _compress_image_for_vision(image_bytes)
    image_b64 = base64.b64encode(compressed_bytes).decode("utf-8")
    system_prompt = _select_video_prompt_template(video_model, has_character)
    # Inject duration + v45 event/emotion context.
    # Templates contain {duration:.1f}, {scene_event_block}, {emotional_core} placeholders.
    scene_event_block = _format_scene_event_block(scene_event)
    emotional_core_str = (emotional_core or "").strip() or "(not specified)"
    try:
        system_prompt = system_prompt.format(
            duration=float(duration),
            scene_event_block=scene_event_block,
            emotional_core=emotional_core_str,
        )
    except (KeyError, IndexError, ValueError) as _fmt_err:
        logger.warning(
            "video_prompt: format failed (%s) — using template as-is",
            _fmt_err,
        )

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
                        "media_type": compressed_media_type,  # v60: image/jpeg or image/png
                        "data": image_b64,
                    },
                },
            ]

            claude_kwargs = {
                "model": model,
                # v75.2 — adaptive thinking 토큰까지 한도에서 차감되므로 16000 으로 상향.
                "max_tokens": 16000,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_content}],
                # v75 — adaptive thinking + high effort, no temperature for all Claude paths.
                "thinking": {"type": "adaptive"},
                "output_config": {"effort": "high"},
            }
            logger.info(
                "[ThinkingOn] stage=video_prompt model=%s effort=high scene=%d",
                model, scene_number,
            )
            response = await anthropic_client.messages.create(**claude_kwargs)

            video_prompt = _first_text_block(response).strip()
            if video_prompt:
                logger.info("Phase2.5: scene %d video_prompt generated via %s (%d chars)", scene_number, model, len(video_prompt))
                return video_prompt

            logger.warning("Phase2.5: scene %d — empty response from %s", scene_number, model)
            return ""  # v60: 빈 문자열 반환 → 호출자가 Phase 1b 의 video_prompt 유지

        except Exception as e:
            logger.warning("Phase2.5: scene %d %s call failed: %s", scene_number, model, e)
            return ""  # v60: 빈 문자열 반환 → 호출자가 Phase 1b 의 video_prompt 유지

    else:
        # ── Gemini path (default) ──
        payload = {
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "contents": [{"parts": [
                {"text": user_text},
                {"inlineData": {"mimeType": compressed_media_type, "data": image_b64}},
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
            return ""  # v60: 빈 문자열 → Phase 1b 의 video_prompt 유지

        except Exception as e:
            logger.warning("Phase2.5: scene %d Gemini call failed: %s", scene_number, e)
            return ""  # v60: 빈 문자열 → Phase 1b 의 video_prompt 유지


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_openai_client():
    """Get or create the AsyncOpenAI client (singleton)."""
    from .lyrics_generator import _get_client
    return _get_client()


def _claude_temp_cap(t: float) -> float:
    """v50 — Anthropic Claude API caps temperature at 1.0. Apply this before
    passing temperature to Claude SDK calls (other providers can use higher
    values like 1.1 directly). Returns min(t, 1.0).

    Caller logs `[ClaudeTempCap] requested=%.2f capped=%.2f` only when the
    cap actually fires (requested != capped) — i.e. when the input was >1.0.

    v75 — Function preserved for signature compatibility but no longer called
    by any Claude path (temperature is no longer sent with adaptive thinking).
    """
    return min(float(t), 1.0)


def _first_text_block(resp) -> str:
    """v75 — Anthropic adaptive thinking 응답 안전 추출.

    `messages.create(..., thinking={"type":"adaptive"}, ...)` 응답의
    `content` 는 `[ThinkingBlock(type="thinking"), TextBlock(type="text")]`
    순서로 옴. 첫 인덱스가 항상 text 가 아니므로 `resp.content[0].text`
    패턴은 AttributeError. 본 헬퍼는 첫 `type=="text"` 블록의 `text`를 반환
    하며, 없으면 빈 문자열을 돌려준다. thinking 비활성 응답에서도 동일하게
    동작 (BC 보장).
    """
    try:
        for block in getattr(resp, "content", []) or []:
            if getattr(block, "type", None) == "text":
                return (getattr(block, "text", None) or "")
    except Exception:
        return ""
    return ""


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


# ── 0.85 Stage 1 — Brainstorm (v45) ────────────────────────────────────────
#
# v45: 시나리오 LLM 을 2단계로 분리. Stage 1 (이 섹션) 은 톤이 다른 4개 후보
# 시나리오 스케치를 빠르게 생성. Stage 2 (Beat Sheet) 가 그 후보를 받아 풀
# 구조화된 시나리오를 만든다.


# ── v47 plot archetype enum (SSOT — backend = frontend label map) ────────────
#
# 4개 brainstorm 후보가 "톤만 다르고 플롯은 비슷" 한 v45/v46 결과를 해결하기 위해
# v47 에서 도입. LLM 이 곡의 가사·장르·무드를 분석해 이 7개 메뉴 중 4개를 자율
# 선택하고, 각 후보의 plot_archetype 은 모두 달라야 한다.
PLOT_ARCHETYPES = (
    "chance_encounter",        # 우연한 만남 → 첫눈에 반함 → 결단
    "reunion",                 # 오랜만의 재회 → 흔들리는 마음 → 결정
    "farewell",                # 이별/작별 → 그리움 → 의미 새기기
    "pursuit_of_dream",        # 자기 도전 / 성취 / 좌절과 회복
    "subtle_growth",           # 소소한 일상 사건 → 깨달음 / 성장
    "support_and_friendship",  # 친구·가족과의 작은 사건 → 유대 강화
    "inner_resolution",        # 내적 갈등 → 결단 (관계가 아닌 자기 자신과의 대결)
)

PLOT_ARCHETYPES_SET = set(PLOT_ARCHETYPES)


# ── v48 — 곡 톤·장르 → archetype 가중치 자동 매칭 (SSOT) ─────────────────────
#
# v47 에서 4개 brainstorm 후보 archetype 다양성(ABSOLUTE RULE) 을 강제했지만, LLM 이
# 4개 archetype 을 완전 자율로 선택 — 곡 톤과 미스매치 가능. v48 의 핵심: 곡 메타
# (title / genre / mood / lyrics) 를 결정론적으로 분석해 archetype 별 가중치를 계산
# → Stage 1 brainstorm system prompt 에 가이드 hint 형태로 주입.
#
# 가중치는 우선순위 가이드일 뿐, v47 의 ABSOLUTE RULE (4개 distinct) 는 유지.
#
# 외부화 가능 구조: 향후 환경변수 ARCHETYPE_WEIGHTS_PATH 또는 settings 객체에서 로드해
# 아래 4개 사전을 deep-merge 가능. 이번 v48 에선 코드 SSOT 로 시작.

ARCHETYPE_GENRE_WEIGHTS = {
    "ballad": {
        "reunion": 0.9, "farewell": 0.9, "chance_encounter": 0.5,
        "inner_resolution": 0.6, "pursuit_of_dream": 0.2,
        "subtle_growth": 0.3, "support_and_friendship": 0.3,
    },
    "dance": {
        "chance_encounter": 0.9, "support_and_friendship": 0.7,
        "subtle_growth": 0.5, "reunion": 0.3, "farewell": 0.3,
        "pursuit_of_dream": 0.4, "inner_resolution": 0.3,
    },
    "hiphop": {
        "pursuit_of_dream": 0.9, "inner_resolution": 0.7,
        "chance_encounter": 0.5, "reunion": 0.3, "farewell": 0.3,
        "subtle_growth": 0.4, "support_and_friendship": 0.3,
    },
    "rnb": {
        "reunion": 0.8, "chance_encounter": 0.7, "farewell": 0.6,
        "inner_resolution": 0.5, "subtle_growth": 0.4,
        "pursuit_of_dream": 0.4, "support_and_friendship": 0.4,
    },
    "rock": {
        "pursuit_of_dream": 0.8, "inner_resolution": 0.7,
        "chance_encounter": 0.4, "reunion": 0.4, "farewell": 0.4,
        "subtle_growth": 0.4, "support_and_friendship": 0.4,
    },
    "acoustic": {
        "subtle_growth": 0.8, "inner_resolution": 0.6, "reunion": 0.6,
        "farewell": 0.5, "chance_encounter": 0.4,
        "pursuit_of_dream": 0.4, "support_and_friendship": 0.4,
    },
    "city_pop": {
        "chance_encounter": 0.7, "reunion": 0.6, "subtle_growth": 0.6,
        "farewell": 0.4, "pursuit_of_dream": 0.4,
        "inner_resolution": 0.4, "support_and_friendship": 0.4,
    },
    "k_pop": {
        "chance_encounter": 0.7, "pursuit_of_dream": 0.6,
        "support_and_friendship": 0.6, "reunion": 0.4, "farewell": 0.4,
        "subtle_growth": 0.4, "inner_resolution": 0.4,
    },
}

# 알 수 없는 장르 → 모든 archetype 균등 0.4 (가중치 의미 약화 + mood/lyrics 가산이 결정)
ARCHETYPE_GENRE_FALLBACK = {a: 0.4 for a in PLOT_ARCHETYPES}

# 장르 별칭 정규화 — LLM/사용자 자유 입력 → 사전 키 매핑.
# 키는 lower 처리 후 검색.
ARCHETYPE_GENRE_ALIASES = {
    "발라드": "ballad", "ballad": "ballad",
    "댄스": "dance", "edm": "dance", "dance": "dance", "house": "dance", "트로피컬": "dance",
    "힙합": "hiphop", "hip-hop": "hiphop", "hiphop": "hiphop", "rap": "hiphop", "랩": "hiphop",
    "알앤비": "rnb", "r&b": "rnb", "rnb": "rnb", "soul": "rnb", "소울": "rnb",
    "록": "rock", "rock": "rock", "metal": "rock", "punk": "rock", "락": "rock",
    "어쿠스틱": "acoustic", "acoustic": "acoustic", "folk": "acoustic", "포크": "acoustic",
    "시티팝": "city_pop", "city pop": "city_pop", "city_pop": "city_pop", "citypop": "city_pop",
    "케이팝": "k_pop", "k-pop": "k_pop", "kpop": "k_pop", "k_pop": "k_pop", "pop": "k_pop", "팝": "k_pop",
}

# mood × archetype 추가 가중치 (가산)
ARCHETYPE_MOOD_BONUS = {
    "romantic":    {"chance_encounter": 0.3, "reunion": 0.2},
    "sad":         {"farewell": 0.3, "reunion": 0.2, "inner_resolution": 0.2},
    "energetic":   {"pursuit_of_dream": 0.3, "support_and_friendship": 0.2},
    "nostalgic":   {"reunion": 0.3, "farewell": 0.2, "subtle_growth": 0.2},
    "hopeful":     {"pursuit_of_dream": 0.3, "subtle_growth": 0.2},
    "melancholic": {"farewell": 0.3, "inner_resolution": 0.2},
    "warm":        {"support_and_friendship": 0.3, "subtle_growth": 0.2},
    "dreamy":      {"chance_encounter": 0.2, "subtle_growth": 0.2},
}

# 무드 별칭 — 한국어/영어 자유 입력을 정규화 키로
ARCHETYPE_MOOD_ALIASES = {
    "로맨틱": "romantic", "사랑": "romantic", "설렘": "romantic", "romantic": "romantic",
    "슬픈": "sad", "슬픔": "sad", "우울": "sad", "sad": "sad",
    "신나는": "energetic", "활기": "energetic", "에너지": "energetic", "energetic": "energetic",
    "그리운": "nostalgic", "추억": "nostalgic", "회상": "nostalgic", "nostalgic": "nostalgic",
    "희망": "hopeful", "밝은": "hopeful", "hopeful": "hopeful",
    "쓸쓸": "melancholic", "고독": "melancholic", "melancholic": "melancholic",
    "따뜻": "warm", "포근": "warm", "warm": "warm",
    "몽환": "dreamy", "환상": "dreamy", "dreamy": "dreamy",
}

# 가사 키워드 보너스 (부분 문자열 검사). archetype 별 +0.2 가산 (한 archetype 당 1회).
ARCHETYPE_LYRICS_KEYWORDS = {
    "farewell":               ["헤어졌", "이별", "안녕", "잘 가", "보내줘"],
    "reunion":                ["다시 만나", "오랜만", "그때", "다시 봐", "또 만나"],
    "chance_encounter":       ["처음 본", "낯선", "마주친", "스쳐", "우연"],
    "pursuit_of_dream":       ["포기 안", "나아가", "꿈", "도전", "달려"],
    "support_and_friendship": ["친구", "가족", "엄마", "아빠", "동료"],
    "inner_resolution":       ["혼자", "나만의", "내 안", "스스로", "결심"],
    # subtle_growth — 키워드 가산 없음 (mood/genre 만으로)
}


def _compute_archetype_weights(
    title: Optional[str] = None,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    lyrics: Optional[str] = None,
) -> Dict[str, float]:
    """v48 — 곡 메타 분석 결과 archetype 가중치 dict 반환 (합=1.0 정규화).

    7개 archetype 모두 포함. 알 수 없는 장르/무드/빈 입력 → fallback (균등 분포).

    알고리즘:
      1. base = ARCHETYPE_GENRE_WEIGHTS[genre_norm] 또는 fallback (균등 0.4)
      2. mood 가산 = ARCHETYPE_MOOD_BONUS[mood_norm]
      3. lyrics 가산 = ARCHETYPE_LYRICS_KEYWORDS 부분 문자열 매칭 시 +0.2
      4. 정규화 (sum=1.0)
    """
    # 1) genre 정규화 + base
    genre_raw = (genre or "").strip()
    genre_norm = ARCHETYPE_GENRE_ALIASES.get(genre_raw.lower(), None)
    if genre_norm and genre_norm in ARCHETYPE_GENRE_WEIGHTS:
        base = dict(ARCHETYPE_GENRE_WEIGHTS[genre_norm])
    else:
        base = dict(ARCHETYPE_GENRE_FALLBACK)
        if genre_raw:
            logger.info(
                "[ArchetypeWeights] unknown genre=%r — using fallback (uniform 0.4)",
                genre_raw[:40],
            )

    # 누락 archetype 키는 0.3 으로 채움 (안전 — 사전이 7개 모두 포함하지 않을 경우)
    weights = {a: float(base.get(a, 0.3)) for a in PLOT_ARCHETYPES}

    # 2) mood 가산
    mood_raw = (mood or "").strip()
    mood_norm = ARCHETYPE_MOOD_ALIASES.get(mood_raw.lower(), None)
    if mood_norm and mood_norm in ARCHETYPE_MOOD_BONUS:
        for arche, bonus in ARCHETYPE_MOOD_BONUS[mood_norm].items():
            if arche in weights:
                weights[arche] += float(bonus)

    # 3) lyrics 가산 (부분 문자열 매칭 — 한 archetype 당 +0.2 한 번)
    lyrics_text = (lyrics or "")
    if lyrics_text:
        for arche, kws in ARCHETYPE_LYRICS_KEYWORDS.items():
            if any(kw in lyrics_text for kw in kws):
                weights[arche] = weights.get(arche, 0.0) + 0.2

    # 4) 정규화
    total = sum(weights.values())
    if total > 1e-9:
        weights = {k: v / total for k, v in weights.items()}
    else:
        # 비정상 입력 방어 — 모든 가중치가 0/음수일 때 균등 분포
        logger.warning("[ArchetypeWeights] non-positive total — using uniform")
        weights = {a: 1.0 / len(PLOT_ARCHETYPES) for a in PLOT_ARCHETYPES}

    # 빈 입력 경고 (모두 None/empty)
    if not genre_raw and not mood_raw and not lyrics_text:
        logger.warning(
            "[ArchetypeWeights] empty input (no genre/mood/lyrics) — weights ≈ uniform"
        )

    # 추적자 로그 — 상위 3개 archetype + 가중치만 (전체 dict 길이 ↑ 방지)
    top3 = sorted(weights.items(), key=lambda kv: kv[1], reverse=True)[:3]
    logger.info(
        "[ArchetypeWeights] computed title=%r genre=%s mood=%s lyrics_len=%d top3=%s",
        (title or "")[:30],
        genre_norm or "-",
        mood_norm or "-",
        len(lyrics_text),
        [(k, round(v, 3)) for k, v in top3],
    )

    return weights


def _format_archetype_weights_guide(weights: Dict[str, float]) -> str:
    """v48 — weights dict → Stage 1 system prompt 에 append 할 가이드 텍스트.

    출력 예:
      ## v48 — 곡 톤·장르 분석 결과 (archetype 가이드 가중치)
      아래는 곡 정보 기반 archetype 추천 가중치(높은 순):
      - reunion: 0.85
      - farewell: 0.78
      ...

      가중치가 높은 archetype 을 **우선 고려**하되, archetype 다양성 ABSOLUTE RULE 은
      그대로 유지하세요 (4개 모두 다른 archetype). 가중치 0.5 이상 archetype 중에서
      최소 2개를 포함시키는 것을 권장합니다 (강제는 아님).
    """
    if not weights:
        return ""
    sorted_items = sorted(weights.items(), key=lambda kv: kv[1], reverse=True)
    lines = [
        "",
        "## v48 — 곡 톤·장르 분석 결과 (archetype 가이드 가중치)",
        "아래는 곡 정보 기반 archetype 추천 가중치(높은 순):",
    ]
    for arche, w in sorted_items:
        lines.append("  - {}: {:.2f}".format(arche, w))
    lines.append("")
    lines.append(
        "가중치가 높은 archetype 을 **우선 고려**하되, archetype 다양성 ABSOLUTE RULE 은 "
        "그대로 유지하세요 (4개 모두 다른 archetype). 가중치 0.5 이상 archetype 중에서 "
        "최소 2개를 포함시키는 것을 권장합니다 (강제는 아님)."
    )
    return "\n".join(lines)


# v50 — Anti-example block (Stage 1 + Stage 2 공유 SSOT).
# 시스템 프롬프트의 마지막에 append 되어 LLM 이 예시의 구체 단어를 그대로 모방하지
# 않도록 차단한다. archetype 정의·few-shot 예시·trigger/motif 예시에 등장하는
# 구체 인물 이름·소품·공간·행동을 모두 금지 단어 리스트에 명시.
#
# v50.1 — 학습 데이터 자생성 클리셰(군중 인물) 차단 단락 추가:
#   (B) 일반 가드: 메타에 명시되지 않은 군중을 임의로 등장시키지 말 것.
#   (A) 구체 클리셰: 교복 학생/벚꽃놀이 군중/웨딩 하객 등 stock 표현 명시 금지.
# 이 두 단락은 기존 4리스트와 마무리 문장 사이에 빈 줄로 시각적 분리하여 삽입.
ANTI_EXAMPLE_BLOCK = (
    "\n## ⚠ 예시 단어 사용 금지 (모방 방지)\n"
    "위 예시들은 패턴·톤 학습용입니다. 다음 단어/이름/소품/행동은\n"
    "예시에 등장하더라도 그대로 사용하지 마세요:\n\n"
    "- 인물 이름: 이지훈, 김수민, 박서준, 정민호, 한동훈\n"
    "- 소품: 머리핀, 옛 LP, 젖은 코트, 스니커즈, 운동화 끈\n"
    "- 공간: 재즈 카페, 백스테이지, 옛 동네 골목\n"
    "- 구체 행동: 머리핀 돌려주기, 어깨 두드림, 주먹 쥐기, 번호 주기\n"
    "\n"
    "### v50.1 — 군중 인물 임의 등장 금지\n"
    "- 입력 곡 가사·캐릭터·장소 메타에 명시되지 않은 인물 무리(학생 단체·\n"
    "  관광객 무리·길거리 행인 단체·웨딩 하객 등)을 임의로 등장시키지 마세요.\n"
    "- 다른 인물이 필요하면 relationship 또는 user_event_seed 에 명시된\n"
    "  캐릭터만 사용하세요. 분위기 채우기용 군중 묘사는 금지.\n"
    "- 클리셰 인물·행동: 교복 입은 학생들, 까르르 웃는 학생, 단체 셀카,\n"
    "  까페 옆자리 손님 단체, 봄나들이 가족 무리, 벚꽃놀이 군중,\n"
    "  지나가다 박수 쳐주는 행인, 우산 쓰고 웃는 연인 무리.\n\n"
    "대신 입력 곡의 가사·분위기·캐릭터·장소에 어울리는\n"
    "새 인물 이름·새 소품·새 공간·새 행동을 만들어 주세요.\n\n"
    "소설가가 매번 새 인물·새 무대를 창작하듯,\n"
    "이 시나리오에서도 예시와 다른 단어로 채워야 합니다.\n"
)


BRAINSTORM_SYSTEM_PROMPT = (
    "당신은 뮤직비디오 시나리오 브레인스토머입니다. 입력으로 들어온 곡 정보(제목/"
    "장르/분위기/관계/가사) 를 바탕으로 **서로 다른 4개의 plot archetype 을 가진 "
    "후보 시나리오 스케치** 를 JSON 으로만 출력하세요.\n\n"
    "## v47 — ABSOLUTE RULE: plot archetype 다양성 (절대 준수)\n"
    "4개 후보의 `plot_archetype` 은 **모두 달라야 합니다**. 같은 archetype 을 두 번 "
    "사용하지 마세요. 톤(밝은/잔잔한/몽환적 등) 만 다르고 플롯이 비슷하면 안 됩니다 "
    "— 진짜 서사 구조가 다른 4개 후보를 만드세요.\n\n"
    "## archetype 메뉴 (LLM 자율 선택 — 4개 골라 사용)\n"
    "  - `chance_encounter` — 예상 못한 만남에서 시작되는 감정 변화와 능동적 결단\n"
    "  - `reunion` — 시간이 지난 뒤 다시 마주친 인연이 흔드는 마음과 새 결정\n"
    "  - `farewell` — 관계의 끝과 그 뒤에 남는 흔적·의미의 재구성\n"
    "  - `pursuit_of_dream` — 자기 자신을 향한 도전과 그 과정의 굴곡 (성취·좌절·회복)\n"
    "  - `subtle_growth` — 평범한 일상의 작은 사건을 통한 내면의 변화·깨달음\n"
    "  - `support_and_friendship` — 가까운 사람과의 사건을 통한 연결의 깊어짐\n"
    "  - `inner_resolution` — 타인이 아닌 자기 자신과의 대결로 도달하는 결단\n\n"
    "곡의 가사·장르·무드를 분석해서 가장 어울리는 4개 archetype 을 골라, 각각 다른 "
    "사건 시퀀스로 작성하세요. archetype 은 위 영어 enum 값 그대로 출력하세요 "
    "(번역하지 말 것).\n\n"
    "## 출력 규칙\n"
    "- JSON only. 코드 펜스(```), 머리말, 설명 일체 금지.\n"
    "- `candidates` 배열은 정확히 4개 객체.\n"
    "- 각 후보는 가사가 있으면 가사의 내용과 직접 연결되어야 합니다. 가사가 없으면 "
    "제목·장르·분위기에서 추정.\n"
    "- `tone` 은 한국어 색감 표현 (예: \"차분한 회상\", \"역동적 결심\"). 후보별로 "
    "다양하면 좋지만 archetype 이 다르면 톤이 비슷해도 OK.\n"
    "- `key_events` 는 **4~6개**의 짧은 한국어 문장 (각 ≤30자). **사건·트리거·갈등 "
    "중심.**\n"
    "- `premise_summary` 는 이 후보의 핵심 전제를 ≤80자 한 줄로.\n"
    "- `central_conflict` 는 이 후보의 핵심 갈등을 ≤80자 한 줄로.\n"
    "- `mood_arc` 은 한 문장으로 감정 흐름 요약 (예: \"평온 → 동요 → 격정 → 수용\").\n\n"
    "## v47 — ABSOLUTE RULE: key_events 사건성\n"
    "각 후보의 `key_events` 는 \"주인공 캐릭터의 인생·관계·결정에 변화를 일으키는 "
    "사건\" 중심이어야 합니다. **4개 후보의 평균 사건성 비율이 50% 이상**이어야 합니다 "
    "(후보 개별 0% 가 있어도 다른 후보가 보완 가능). 자연 현상(꽃잎·바람·햇살·하늘 등) "
    "단독 묘사는 배경 디테일로만, key_event 단독으로 채우지 마세요.\n"
    "- 사건성 예시: 새 인물의 등장, [예측 못한 형태의] 마주침, [관계 인물의] 연결 신호, "
    "[의미 있는 물건의] 발견, [관계 인물의] 부탁·거절·고백, 결단을 요구하는 상황, "
    "주인공 캐릭터의 능동적 결정.\n"
    "- 자연 현상 예시: \"꽃잎이 떨어진다\", \"바람이 분다\", \"햇살이 비친다\". 이런 "
    "묘사는 secondary detail (배경) 로만 사용.\n\n"
    "## v46 — relationship 자율 판단 (relationship 입력값이 없을 때만 적용)\n"
    "사용자가 관계를 명시하지 않은 경우, 곡 분위기에 따라 자율적으로 판단하세요. "
    "이 판단은 archetype 선택과 자연스럽게 연결됩니다:\n"
    "  - 사랑/외로움/그리움/설렘 → `chance_encounter`/`reunion`/`farewell` 등\n"
    "  - 우정/축제/응원 → `support_and_friendship`/`subtle_growth`\n"
    "  - 단독 자기 성찰/도전 → `pursuit_of_dream`/`inner_resolution`\n"
    "(Stage 2 가 최종 결정자이므로 여기서는 후보 단계의 자유로운 발산.)\n\n"
    "## 출력 스키마 (이 구조 그대로)\n"
    "{\n"
    "  \"candidates\": [\n"
    "    {\n"
    "      \"tone\": \"한국어 톤 표현\",\n"
    "      \"plot_archetype\": \"<위 7개 enum 중 하나>\",\n"
    "      \"premise_summary\": \"이 후보의 핵심 전제 (≤80자)\",\n"
    "      \"key_events\": [\"사건 1\", \"사건 2\", \"사건 3\", \"사건 4\"],\n"
    "      \"central_conflict\": \"이 후보의 핵심 갈등 (≤80자)\",\n"
    "      \"mood_arc\": \"감정 흐름 한 문장\"\n"
    "    }\n"
    "    // ... 정확히 4개, 모두 다른 plot_archetype\n"
    "  ]\n"
    "}\n"
)
# Note: v50 — ANTI_EXAMPLE_BLOCK is appended at the END of the system prompt
# inside `_build_brainstorm_prompts`, after weights guide + user_event_seed
# block. This keeps the anti-example block as the final instruction (LLM
# attention is strongest on the most recent text).


def _format_user_event_seed_block_stage1(user_event_seed: Optional[str]) -> str:
    """v60 — Stage 1 brainstorm system prompt 에 append 할 시드 블록 생성.

    시드가 truthy 일 때만 텍스트 반환, 아니면 빈 문자열 (= 시스템 프롬프트 변경 없음).

    v60 변경: v49 에서 "4개 중 1개만 시드 기반, 나머지 3개는 시드 무시" 였던 룰을
    "4개 모두 시드 기반 + 3차원(magical_mechanism / character_dynamics / progression)
    중 둘 이상에서 변주" 로 재설계. 사용자 시드가 있을 때 후보가 시드와 무관한 방향
    으로 흐르는 문제를 해소.

    SSOT — Stage 2 의 시드 블록은 별개 (narrative/events 에 시드 통합 가이드).
    """
    seed = (user_event_seed or "").strip()
    if not seed:
        return ""
    return (
        "\n## 사용자 시드 — 4개 후보 모두에 핵심 사건/세계관으로 반영\n"
        "사용자가 시나리오에 포함되기를 원하는 핵심 사건/세계관:\n"
        "> \"{}\"\n\n"
        "지침 (ABSOLUTE — 4개 후보 전부 적용):\n"
        "- 4개 brainstorm 후보 **모두** 위 시드를 핵심 inciting incident 또는 "
        "주요 전개로 삼아 구성하세요. 시드와 무관한 후보를 만들지 마세요.\n"
        "- 시드의 핵심 키워드(인물·장소·환타지 컨셉·행동) 를 4개 후보의 "
        "`premise_summary` 와 `key_events` 양쪽에 모두 명시적으로 반영하세요.\n"
        "- 4개 후보는 다음 세 차원 중 **둘 이상에서 서로 다르게** 변주하세요:\n"
        "  ① magical_mechanism (마법/판타지 메커니즘):\n"
        "     예) 거대화 / 축소화 / 변신 / 시간이동 / 의식 공유 / 환각 / "
        "변신한 동물 동행 / 영혼 분리 등\n"
        "  ② character_dynamics (주인공 ↔ 시드 인물 관계 역학):\n"
        "     예) 가이드-탐험가 / 연인 / 의식 공유 / 보호자-피보호자 / "
        "스승-제자 / 라이벌-동료 / 익명 동행 등\n"
        "  ③ progression (전개·구성 방식):\n"
        "     예) 공간 순회 / 시간축 점프 / 한 장소 깊이 탐구 / 작은 디테일 모음 / "
        "감정 곡선 중심 / 액션 중심 등\n"
        "- archetype 다양성(v47 ABSOLUTE RULE — 4 distinct plot_archetype) 은 "
        "위 세 차원과 독립적으로 유지하세요. 시드 + archetype 둘 다 다양해야 합니다.\n"
        "- 시드의 분위기/장르(예: \"환타지 여행\" 이면 fantasy_adventure, "
        "\"우연한 만남\" 이면 chance_encounter 우선) 와 어울리는 archetype 셋을 "
        "선택하되 4개가 모두 달라야 합니다.\n"
    ).format(seed)


def _build_brainstorm_prompts(
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    lyrics: Optional[str] = None,
    vocal_gender: Optional[str] = None,
    relationship: Optional[str] = None,
    archetype_weights: Optional[Dict[str, float]] = None,
    user_event_seed: Optional[str] = None,
):
    """Build system + user prompts for Stage 1 (brainstorm).

    v46: relationship=None 일 때 LLM 이 자율 판단하도록 추가 안내. 시스템 프롬프트는
    BRAINSTORM_SYSTEM_PROMPT 에 이미 포함됨. 여기서는 user 프롬프트에 명시적 hint
    한 줄 추가 + 트레이서 로그.

    v48: archetype_weights (Optional) 주어지면 시스템 프롬프트 끝에 가이드 텍스트
    append. 가중치는 우선순위 hint 일 뿐, v47 ABSOLUTE RULE (4 distinct) 은 유지.

    v49: user_event_seed (Optional, ≤300자) 가 truthy 일 때 시스템 프롬프트 끝
    (가중치 가이드 다음) 에 시드 블록 append. 시드 None/빈 문자열 → v48 byte-level
    동일 출력. 본문은 시스템 프롬프트 안에서만 사용 — 로그에는 길이(seed_len) 만.
    """
    user_parts = []
    user_parts.append("제목: {}".format(title))
    if genre:
        user_parts.append("장르: {}".format(genre))
    if mood:
        user_parts.append("분위기: {}".format(mood))
    user_parts.append("vocal_gender: {}".format((vocal_gender or "지정 없음").strip()))
    rel_text = (relationship or "").strip() or None
    if rel_text:
        user_parts.append("relationship: {}".format(rel_text))
    else:
        user_parts.append(
            "relationship: 없음 (자율 판단 — 위 시스템 프롬프트의 v46 자율 판단 룰을 따르세요)"
        )
    if lyrics:
        user_parts.append("가사:\n{}".format(lyrics[:3000]))
    user_parts.append(
        "\n위 정보를 바탕으로 **서로 다른 4개의 plot_archetype** 을 가진 후보 시나리오 "
        "스케치를 JSON 으로만 출력하세요. 4개 후보의 plot_archetype 은 모두 달라야 하고, "
        "key_events 는 후보 평균 50% 이상이 사건성(인물 등장·결정·만남) 이어야 합니다."
    )

    # v48: 시스템 프롬프트에 archetype 가중치 가이드 append (있을 때만)
    system_prompt = BRAINSTORM_SYSTEM_PROMPT
    weights_top3 = None
    if archetype_weights:
        guide = _format_archetype_weights_guide(archetype_weights)
        if guide:
            system_prompt = BRAINSTORM_SYSTEM_PROMPT + "\n" + guide
        weights_top3 = sorted(
            archetype_weights.items(), key=lambda kv: kv[1], reverse=True,
        )[:3]

    # v49: 사용자 사건 시드 블록 append (truthy 일 때만 — None/빈 문자열 → v48 byte-level 동일).
    seed_block = _format_user_event_seed_block_stage1(user_event_seed)
    if seed_block:
        system_prompt = system_prompt + seed_block

    # v50: anti-example 블록은 항상 가장 마지막에 append (가중치/시드보다 뒤).
    # LLM attention 이 가장 최근 instruction 에 강하게 걸리므로 모방 차단의 핵심.
    system_prompt = system_prompt + ANTI_EXAMPLE_BLOCK

    # v46/v47/v48/v49: trace log — 시스템·유저 프롬프트가 아닌 메타데이터만 (시드 본문 X, len 만).
    seed_len = len((user_event_seed or "").strip()) if user_event_seed else 0
    logger.info(
        "[PromptBuild] stage=1 rel=%s vg=%s genre=%s lyrics_len=%d v47=archetype_diversity "
        "v48_weights_top3=%s seed_len=%d",
        rel_text or "auto",
        (vocal_gender or "").strip() or "auto",
        (genre or "").strip() or "-",
        len(lyrics or ""),
        ([(k, round(v, 3)) for k, v in weights_top3] if weights_top3 else "off"),
        seed_len,
    )
    return system_prompt, "\n".join(user_parts)


def _parse_brainstorm_json(text: str) -> dict:
    """Parse brainstorm LLM output into {candidates: [...]} dict.

    Tries strict json.loads first; falls back to extracting the largest JSON object
    substring. Raises ValueError on unrecoverable failure or when candidates count
    is not 4 (after best-effort recovery — accepts 3~5 with warning, but rejects <2).
    """
    if not text:
        raise ValueError("Empty brainstorm response")

    text = text.strip()
    if text.startswith("```"):
        _lines = text.split("\n", 1)
        text = _lines[1] if len(_lines) > 1 else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()
        if text.startswith("json\n") or text.startswith("json\r\n"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
            text = text.strip()

    try:
        data = json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(text[start:end + 1])
            except Exception as inner:
                raise ValueError("Failed to parse brainstorm JSON: {}".format(str(inner)[:200]))
        else:
            raise ValueError("No JSON object found in brainstorm response")

    if not isinstance(data, dict):
        raise ValueError("Brainstorm JSON is not an object")

    cands = data.get("candidates") or []
    if not isinstance(cands, list):
        raise ValueError("Brainstorm 'candidates' is not a list")
    # Normalize each candidate to safe shape
    # v47 — extract plot_archetype / premise_summary / central_conflict in addition
    # to the legacy v45 fields. Unknown archetype → None + warning. Missing fields
    # → empty strings (옛 도큐먼트 호환).
    normalized = []
    seen_tones = set()
    invalid_archetypes = 0
    archetype_seen_list = []
    for c in cands:
        if not isinstance(c, dict):
            continue
        tone = (c.get("tone") or "").strip()
        if not tone or tone in seen_tones:
            # Keep but mark — duplicate tones allowed only if we have <4
            pass
        seen_tones.add(tone)
        ev_raw = c.get("key_events") or []
        if not isinstance(ev_raw, list):
            ev_raw = [str(ev_raw)]
        key_events = [str(x).strip() for x in ev_raw if x is not None and str(x).strip()]

        # v47: plot_archetype (whitelist) + premise_summary + central_conflict
        archetype_raw = (c.get("plot_archetype") or "").strip().lower()
        if archetype_raw and archetype_raw not in PLOT_ARCHETYPES_SET:
            logger.warning(
                "[BrainstormParse] dropping invalid archetype '%s' (not in whitelist)",
                archetype_raw[:40],
            )
            archetype_raw = None
            invalid_archetypes += 1
        elif not archetype_raw:
            archetype_raw = None
        archetype_seen_list.append(archetype_raw)

        premise_summary = (c.get("premise_summary") or "").strip()
        if len(premise_summary) > 200:
            premise_summary = premise_summary[:200]
        central_conflict = (c.get("central_conflict") or "").strip()
        if len(central_conflict) > 200:
            central_conflict = central_conflict[:200]

        normalized.append({
            "tone": tone or "(unspecified)",
            "mood_arc": (c.get("mood_arc") or "").strip(),
            "key_events": key_events,
            "setting_hint": (c.get("setting_hint") or "").strip(),  # v45 호환 (Optional)
            # v47 신규
            "plot_archetype": archetype_raw,
            "premise_summary": premise_summary,
            "central_conflict": central_conflict,
        })

    if len(normalized) < 2:
        raise ValueError(
            "Brainstorm produced too few candidates ({})".format(len(normalized))
        )

    # v47: parse-time summary log (caller binds mv_job_id at higher level)
    archetype_uniq = sorted({a for a in archetype_seen_list if a})
    logger.info(
        "[BrainstormParse] candidates=%d archetypes=%s missing_arche=%d invalid=%d",
        len(normalized), archetype_uniq,
        sum(1 for a in archetype_seen_list if not a),
        invalid_archetypes,
    )

    return {"candidates": normalized}


async def _generate_brainstorm_openai(
    title, genre, mood, lyrics, vocal_gender, relationship, model_name=None,
    temperature: float = 0.95,
    archetype_weights: Optional[Dict[str, float]] = None,
    user_event_seed: Optional[str] = None,
):
    client = _get_openai_client()
    system_prompt, user_prompt = _build_brainstorm_prompts(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
        vocal_gender=vocal_gender, relationship=relationship,
        archetype_weights=archetype_weights,
        user_event_seed=user_event_seed,
    )
    model = model_name or settings.openai_model
    create_kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        # v75 — gpt-5 series: temperature 강제 default(1) → 인자 제거.
        # v75 — gpt-5 series: max_tokens → max_completion_tokens.
        # v75.2 — reasoning 토큰까지 한도에서 차감되므로 16000 으로 상향.
        "max_completion_tokens": 16000,
        "response_format": {"type": "json_object"},
        "reasoning_effort": "high",
    }
    logger.info(
        "[ReasoningOn] stage=brainstorm model=%s reasoning_effort=high (temp=%.2f dropped) max_completion_tokens=16000",
        model, temperature,
    )
    resp = await client.chat.completions.create(**create_kwargs)
    raw = resp.choices[0].message.content.strip()
    parsed = _parse_brainstorm_json(raw)
    logger.info(
        "MV brainstorm generated (OpenAI %s, temp=%.2f): %d candidates",
        model, temperature, len(parsed["candidates"]),
    )
    return parsed


async def _generate_brainstorm_claude(
    title, genre, mood, lyrics, vocal_gender, relationship, model_name="claude-opus-4-6",
    temperature: float = 0.95,
    archetype_weights: Optional[Dict[str, float]] = None,
    user_event_seed: Optional[str] = None,
):
    client = _get_anthropic_client()
    system_prompt, user_prompt = _build_brainstorm_prompts(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
        vocal_gender=vocal_gender, relationship=relationship,
        archetype_weights=archetype_weights,
        user_event_seed=user_event_seed,
    )
    # v50 — Anthropic Claude API caps temperature at 1.0. Apply cap before send.
    capped_temp = _claude_temp_cap(temperature)
    if capped_temp != float(temperature):
        logger.info(
            "[ClaudeTempCap] requested=%.2f capped=%.2f model=%s stage=brainstorm",
            float(temperature), capped_temp, model_name,
        )
    kwargs = {
        "model": model_name,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
        # v75.2 — adaptive thinking 토큰까지 한도에서 차감되므로 16000 으로 상향.
        "max_tokens": 16000,
        # v75 — adaptive thinking + high effort; temperature dropped for all Claude.
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }
    logger.info(
        "[ThinkingOn] stage=brainstorm model=%s effort=high (capped_temp=%.2f dropped)",
        model_name, capped_temp,
    )
    resp = await client.messages.create(**kwargs)
    raw = _first_text_block(resp).strip()
    parsed = _parse_brainstorm_json(raw)
    logger.info(
        "MV brainstorm generated (Claude %s, temp=%.2f capped=%.2f): %d candidates",
        model_name, float(temperature), capped_temp, len(parsed["candidates"]),
    )
    return parsed


async def _generate_brainstorm_gemini(
    title, genre, mood, lyrics, vocal_gender, relationship,
    temperature: float = 0.95,
    archetype_weights: Optional[Dict[str, float]] = None,
    user_event_seed: Optional[str] = None,
):
    system_prompt, user_prompt = _build_brainstorm_prompts(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
        vocal_gender=vocal_gender, relationship=relationship,
        archetype_weights=archetype_weights,
        user_event_seed=user_event_seed,
    )
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.5-pro:generateContent"
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 1500,
            "responseMimeType": "application/json",
        },
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            url, params={"key": settings.google_api_key}, json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini brainstorm returned no candidates")
    parts = candidates[0].get("content", {}).get("parts", [])
    raw = "".join(p.get("text", "") for p in parts).strip()
    parsed = _parse_brainstorm_json(raw)
    logger.info(
        "MV brainstorm generated (Gemini, temp=%.2f): %d candidates",
        temperature, len(parsed["candidates"]),
    )
    return parsed


# ── v47 — Brainstorm validation: archetype diversity + key_events eventful avg ──


class BrainstormDiversityError(ValueError):
    """v47 — raised when brainstorm candidates fail v47 archetype diversity OR
    key_events eventful ratio average constraint. Caller (`generate_mv_brainstorm`)
    catches this once and retries with bumped temperature.
    """
    pass


def _validate_brainstorm_candidates(parsed: dict) -> dict:
    """v47 — validate parsed brainstorm output for archetype diversity + eventful avg.

    Returns a metrics dict {count, archetypes, archetype_unique, missing_archetype,
    eventful_avg, eventful_per_candidate, soft_failures}. Raises
    BrainstormDiversityError when a hard rule is violated (so the caller can retry).

    Hard rules:
      - At least 3 candidates have a non-null `plot_archetype` AND those archetypes
        are all distinct (4 distinct preferred but 3 allowed when one is missing).
      - Average eventful_ratio across candidates ≥ 0.5 (using `_count_eventful_triggers`
        on key_events as pseudo-events).

    Adapter: `key_events` (list[str]) → list of {"trigger": str, "other_characters": []}
    so we can reuse the v46 helper without forking the keyword logic.
    """
    cands = (parsed or {}).get("candidates") or []
    archetypes = []
    eventful_per = []
    for c in cands:
        a = c.get("plot_archetype") if isinstance(c, dict) else None
        archetypes.append(a)
        ke = c.get("key_events") if isinstance(c, dict) else None
        ev_list = [
            {"trigger": str(x), "other_characters": []}
            for x in (ke or []) if x is not None and str(x).strip()
        ]
        m = _count_eventful_triggers(ev_list)
        eventful_per.append(m["eventful_ratio"])

    valid_archetypes = [a for a in archetypes if a]
    archetype_unique = (
        len(valid_archetypes) >= 3
        and len(set(valid_archetypes)) == len(valid_archetypes)
    )
    eventful_avg = (sum(eventful_per) / len(eventful_per)) if eventful_per else 0.0
    missing_archetype = sum(1 for a in archetypes if not a)

    metrics = {
        "count": len(cands),
        "archetypes": archetypes,
        "archetype_unique": archetype_unique,
        "missing_archetype": missing_archetype,
        "eventful_avg": eventful_avg,
        "eventful_per_candidate": eventful_per,
    }

    logger.info(
        "[BrainstormValidate] count=%d archetypes=%s unique=%s missing=%d eventful_avg=%.2f per=%s",
        metrics["count"], archetypes, archetype_unique, missing_archetype,
        eventful_avg, ["{:.2f}".format(r) for r in eventful_per],
    )

    if not archetype_unique:
        raise BrainstormDiversityError(
            "archetype diversity failed (archetypes={}, missing={})".format(
                archetypes, missing_archetype,
            )
        )
    if eventful_avg + 1e-6 < 0.5:
        raise BrainstormDiversityError(
            "key_events eventful avg {:.2f} < required 0.50 per={}".format(
                eventful_avg, ["{:.2f}".format(r) for r in eventful_per],
            )
        )

    return metrics


async def _dispatch_brainstorm_once(
    title, genre, mood, lyrics, vocal_gender, relationship,
    model_name: Optional[str], temperature: float,
    archetype_weights: Optional[Dict[str, float]] = None,
    user_event_seed: Optional[str] = None,
) -> dict:
    """Single-attempt dispatcher used by `generate_mv_brainstorm` retry loop.

    v48: archetype_weights 를 통과시켜 system prompt 가이드 주입.
    v49: user_event_seed 를 통과시켜 system prompt 시드 블록 주입 (선택).
    """
    common = dict(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
        vocal_gender=vocal_gender, relationship=relationship,
        archetype_weights=archetype_weights,
        user_event_seed=user_event_seed,
    )
    chosen = (model_name or "").strip()
    if chosen.startswith("claude-"):
        return await _generate_brainstorm_claude(
            **common, model_name=chosen, temperature=temperature,
        )
    if chosen.startswith("gemini-"):
        return await _generate_brainstorm_gemini(**common, temperature=temperature)
    if chosen:
        return await _generate_brainstorm_openai(
            **common, model_name=chosen, temperature=temperature,
        )
    return await _generate_brainstorm_openai(**common, temperature=temperature)


async def generate_mv_brainstorm(
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    lyrics: Optional[str] = None,
    vocal_gender: Optional[str] = None,
    relationship: Optional[str] = None,
    model_name: Optional[str] = None,
    user_event_seed: Optional[str] = None,
) -> dict:
    """Stage 1 of v45/v47 scenario pipeline — produce 4 brainstorm candidates.

    v47: 1회 retry 루프 추가. 첫 시도 temperature 0.95, 검증 실패 시 1.0 으로 재시도.
    검증 = archetype 다양성 + key_events 사건성 평균 (≥0.5). 두 번째도 실패 시 soft 통과
    (warning + 결과 그대로 반환, diagnostics 에 soft 표시 — caller 가 통째 폐기 안 함).

    v48: 진입 시 archetype 가중치 1회 계산. retry 루프 안에서 같은 weights 재사용
    (재계산 X). 결과 dict 에 `archetype_weights` 키로 함께 반환 → caller(mv_pipeline)
    가 영속화. weights 는 Stage 1 system prompt 에 가이드 hint 로 주입되며, v47
    ABSOLUTE RULE 은 그대로 유지.

    v49: user_event_seed (Optional, ≤300자) 가 truthy 일 때 Stage 1 system prompt 끝
    (가중치 가이드 다음) 에 시드 블록 append. retry 루프 안에서 같은 시드 재사용.
    시드 None/빈 문자열 → v48 byte-level 동일.

    model_name: when None, uses default OpenAI model. Supports "claude-*", "gemini-*",
    or any OpenAI chat completion model id. Single model only (no dual-model brainstorm
    — caller may run Stage 2 with multiple models, but Stage 1 stays light).

    Returns: {"candidates": [{tone, plot_archetype, premise_summary, key_events,
              central_conflict, mood_arc, setting_hint?}, …], "diagnostics": {...},
              "archetype_weights": {arche: float}}
    """
    last_err: Optional[Exception] = None
    last_parsed: Optional[dict] = None
    last_metrics: Optional[dict] = None

    # v48: 가중치 1회 계산 (retry 안에서 재사용)
    archetype_weights = _compute_archetype_weights(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
    )
    _w_top3 = sorted(archetype_weights.items(), key=lambda kv: kv[1], reverse=True)[:3]
    # v49: 진입 시 시드 길이만 1회 로그 (본문 미출력 — PII 보호).
    _seed_len = len((user_event_seed or "").strip()) if user_event_seed else 0
    logger.info(
        "[BrainstormGen] archetype_weights computed top3=%s seed_len=%d",
        [(k, round(v, 3)) for k, v in _w_top3], _seed_len,
    )

    for attempt in range(2):
        # v50 — temperature 상향 (창의성 회복).
        # 첫 시도 1.0, retry 1.1 (OpenAI/Gemini). Claude 는 1.0 캡 — 호출 직전
        # `_claude_temp_cap(temperature)` 로 적용 (`_generate_brainstorm_claude`).
        temperature = 1.0 if attempt == 0 else 1.1
        try:
            logger.info(
                "[BrainstormGen] attempt=%d temp=%.2f model=%s seed_len=%d",
                attempt + 1, temperature, (model_name or "(default)"), _seed_len,
            )
            parsed = await _dispatch_brainstorm_once(
                title=title, genre=genre, mood=mood, lyrics=lyrics,
                vocal_gender=vocal_gender, relationship=relationship,
                model_name=model_name, temperature=temperature,
                archetype_weights=archetype_weights,
                user_event_seed=user_event_seed,
            )
            last_parsed = parsed
            try:
                metrics = _validate_brainstorm_candidates(parsed)
                # Success — attach diagnostics + v48 weights and return
                parsed["diagnostics"] = {
                    "attempts": attempt + 1,
                    "soft": False,
                    "archetypes": metrics["archetypes"],
                    "eventful_avg": metrics["eventful_avg"],
                    "eventful_per_candidate": metrics["eventful_per_candidate"],
                }
                parsed["archetype_weights"] = archetype_weights
                logger.info(
                    "[BrainstormGen] OK attempt=%d archetypes=%s eventful_avg=%.2f weights_top1=%s",
                    attempt + 1, metrics["archetypes"], metrics["eventful_avg"],
                    _w_top3[0] if _w_top3 else "-",
                )
                return parsed
            except BrainstormDiversityError as div_err:
                last_err = div_err
                last_metrics = None
                logger.warning(
                    "[BrainstormValidate] attempt=%d failed (%s) — %s",
                    attempt + 1, str(div_err)[:160],
                    "retrying" if attempt == 0 else "soft pass",
                )
        except Exception as e:
            last_err = e
            last_parsed = None
            last_metrics = None
            logger.warning(
                "[BrainstormGen] attempt=%d errored (%s) — %s",
                attempt + 1, str(e)[:160],
                "retrying" if attempt == 0 else "raising",
            )

    # Both attempts failed validation. If we have a parsed result, soft-pass it
    # (caller's pipeline already tolerates None, but a soft result is more useful
    # than nothing). Otherwise, re-raise the last exception.
    if last_parsed is not None:
        # Re-run the validator in non-raising mode to capture metrics for diagnostics.
        try:
            cands = last_parsed.get("candidates") or []
            archetypes_seen = [
                c.get("plot_archetype") if isinstance(c, dict) else None
                for c in cands
            ]
            ev_list_per = []
            for c in cands:
                ke = c.get("key_events") if isinstance(c, dict) else None
                ev_list = [
                    {"trigger": str(x), "other_characters": []}
                    for x in (ke or []) if x is not None and str(x).strip()
                ]
                ev_list_per.append(_count_eventful_triggers(ev_list)["eventful_ratio"])
            ev_avg = (sum(ev_list_per) / len(ev_list_per)) if ev_list_per else 0.0
        except Exception:
            archetypes_seen, ev_list_per, ev_avg = [], [], 0.0
        last_parsed["diagnostics"] = {
            "attempts": 2,
            "soft": True,
            "soft_reason": (str(last_err)[:200] if last_err else "unknown"),
            "archetypes": archetypes_seen,
            "eventful_avg": ev_avg,
            "eventful_per_candidate": ev_list_per,
        }
        last_parsed["archetype_weights"] = archetype_weights
        logger.warning(
            "[BrainstormGen] soft-pass after 2 attempts archetypes=%s eventful_avg=%.2f reason=%s",
            archetypes_seen, ev_avg, (str(last_err)[:120] if last_err else "n/a"),
        )
        return last_parsed
    # Neither attempt produced a parseable result — re-raise.
    raise last_err if last_err else RuntimeError("brainstorm failed without exception")


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


# ── Drama Scenario Prompt (PLAN.md v30 / v45 expanded) ──────────────────────


# v45: Few-shot 예시 3 곡 (발라드 / 댄스 / 힙합) — narrative + events 미니 샘플.
# 가사 자체는 placeholder. 시스템 프롬프트에 인라인되어 LLM 에 톤·스케일·구조를
# 보여주는 용도. 그대로 베끼지 말고 입력 곡에 맞춰 재창작하라고 시스템 프롬프트에 명시.
DRAMA_FEW_SHOT_EXAMPLES = """
## Few-shot 예시 (참고만, 그대로 베끼지 말 것)

### 예시 1 — 발라드 / 옛 인연의 우연한 재회 / 비 오는 실내 공간
narrative 핵심 줄거리: 헤어진 옛 인연을 잊지 못한 주인공이 두 사람의 추억이 깃든
실내 공간으로 무의식적으로 향하고, 그곳에서 비를 피해 들어온 상대와 우연히 재회한다.
침묵 속에서 두 사람은 한때 서로의 것이었던 작은 소품을 마지막으로 주고받고,
주인공은 그 소품을 손에 쥔 채 비 속으로 천천히 걸어 나간다.
events 핵심: 1)비를 피해 추억의 공간으로 → 2)옛 곡이 흐름 → 3)상대 등장 → 4)침묵의
대치 → 5)작은 소품을 테이블에 놓음 → 6)상대가 소품을 다시 쥐어 줌 → 7)공간을 나서며
빗속으로 → 8)비가 멎고 정면을 응시.
Motif: 첫 event "[작은 소품 = 미련의 상징]" → 마지막 event "같은 소품 = [작별의 흔적]"
(자기 자조의 흔적 → 의미 새겨진 작별의 표식).

### 예시 2 — 댄스 / 친구의 격려 / 첫 단독 공연 직전 무대 뒤 공간
narrative 핵심 줄거리: 첫 단독 공연을 앞둔 신인 주인공이 무대 뒤 공간에서 친구의 격려를
받고, 무대에 올라 관객과 호흡한 뒤, 공연 후 높은 장소에서 환호의 여운을 받아낸다.
events 핵심: 1)거울 앞 긴장 → 2)친구의 응원 행동 → 3)스태프 호출 → 4)무대 등장 직전
호흡 → 5)첫 비트에 폭발 → 6)관객의 손짓에 호응 → 7)무대 끝 인사 → 8)높은 장소에서
친구와 포옹.
Motif: 첫 event "[작은 신체 소품 = 긴장의 상징]" → 마지막 event "같은 소품 = [안도의
상징]" (긴장의 흔적 → 성취의 안도).

### 예시 3 — 힙합 / 단독 / 자기 결심
narrative 핵심 줄거리: 자기 도전을 굳히는 주인공이 익숙한 거리를 걷고, 거울 앞에서 자기를
다잡고, 작업 공간에서 곡을 작업하고, 높은 장소에서 결심을 새로 다진다.
events 핵심: 1)익숙한 거리 회상 → 2)거울 앞 자기 응시 → 3)노트 펼치기 → 4)헤드폰
쓰고 비트 듣기 → 5)작업 공간에서 첫 녹음 → 6)녹음 중 결의 표현 → 7)높은 장소의 야경
→ 8)정면을 향한 단호한 시선.
other_characters 는 모두 빈 배열 (단독 주인공).
Motif: 첫 event "[과거의 흔적이 묻은 작은 소품]" → 마지막 event "같은 소품의 변화된
모습 = [새 출발의 상징]" (과거의 흔적 → 새로운 출발의 상징).
"""


def _format_user_event_seed_block_stage2(user_event_seed: Optional[str]) -> str:
    """v49 — Stage 2 drama scenario system prompt 에 inject 할 시드 블록.

    Stage 1 과 의도적으로 다름: Stage 1 은 "4개 후보 중 1개 시드 반영", Stage 2 는
    "narrative/events 통합 + inciting incident/climax 위치". 시드 None/빈 문자열 →
    빈 문자열 반환 (시스템 프롬프트 변경 없음 — v48 byte-level 동일).
    """
    seed = (user_event_seed or "").strip()
    if not seed:
        return ""
    return (
        "## 사용자 시드 — 시나리오 핵심 사건\n"
        "사용자가 명시한 핵심 사건: \"{}\"\n\n"
        "지침:\n"
        "- 위 시드를 narrative 의 핵심 plot 에 자연스럽게 통합하세요 "
        "(단순 나열 X, 인물 동기와 연결).\n"
        "- events 배열에 시드의 사건이 1~2개 event 로 명시되어야 합니다 "
        "(trigger / protagonist_action / motivation 모두 시드 키워드 반영).\n"
        "- 시드는 inciting incident 또는 climax 의 위치에 배치 (도입 또는 절정).\n"
        "- 시드와 무관한 brainstorm 후보는 선택하지 마세요 "
        "(Stage 1 에서 시드 후보를 우선 채택).\n\n"
    ).format(seed)


def _build_drama_scenario_prompts(
    title,
    genre,
    mood,
    lyrics,
    vocal_gender=None,
    relationship=None,
    has_user_character=False,
    has_cover_person=False,
    character1_meta=None,
    location_name=None,
    brainstorm_candidates=None,
    audio_duration_sec=None,
    user_event_seed=None,
):
    """Build system/user prompts for drama-style MV scenario generation.

    v45: Stage 2 (Beat Sheet) — outputs not just the legacy {characters, locations,
    scenario} but a full structured doc with narrative (1500~2500 chars), separated
    fields (premise/character_states/central_conflict/emotional_core/narrative_arc),
    and an events[] array. Forced chain-of-thought order. Few-shot 3 examples inlined.

    Args:
        brainstorm_candidates (optional): output of generate_mv_brainstorm() —
            {"candidates": [...×4]}. Injected into the user prompt so Stage 2 can pick
            or blend the most fitting tone.
        audio_duration_sec (optional): used to derive the required event count
            (audio_min × 3, min 6, max 18). When None, falls back to "8~12".

    character1_meta (optional): {"name": str, "age": str, "personality_tags": list[str],
    "personality_text": str} — when provided with non-empty values, the LLM is instructed
    to use those exact values for character1 and not invent new ones.
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
    # v46: rel 정규화는 라우트 단에서 이미 끝났음. 내부에선 영어 enum 만 흐름.
    # 허용: lover, crush, friend, family, none, ex_lover(레거시), colleague(레거시), None
    # `none` (= 사용자가 단독 명시) 와 None (= 자동/미명시) 는 의미 다름:
    #   - none : 단독 주인공 강제, 자율 판단 금지
    #   - None : 자율 판단 (auto_infer_rule 발동)
    rel = (relationship or "").strip().lower() or None
    if rel == "":
        rel = None

    auto_infer_rule = ""  # 시스템 프롬프트에 주입할 자율 판단 가이드 (rel is None 일 때만)

    if rel == "lover":
        if opposite_gender:
            c2_rule = (
                "character2를 반드시 포함하세요. character2.gender는 반드시 \"{}\" 이어야 "
                "합니다 (character1과 반대 성별). role은 \"연인\", 현재 사귀고 있는 친밀한 "
                "연인 관계로 묘사하세요."
            ).format(opposite_gender)
        else:
            c2_rule = (
                "character2를 반드시 포함하세요. role은 \"연인\", 현재 사귀고 있는 친밀한 "
                "연인 관계로 묘사하세요. gender는 이야기에 맞게 선택하세요."
            )
    elif rel == "ex_lover":
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
    elif rel == "crush":
        c2_rule = (
            "character2를 반드시 포함하세요. role은 \"짝사랑 대상\"으로, character1이 마음을 "
            "품고 있으나 아직 마음을 전하지 못한 인물로 묘사하세요. gender는 이야기에 맞게 "
            "선택하세요. 둘 사이엔 망설임·거리·바라봄 같은 미묘한 톤이 있어야 합니다."
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
    elif rel == "none":
        c2_rule = (
            "사용자가 \"등장인물 없음(단독 주인공 캐릭터)\" 을 명시했습니다. character2는 "
            "생략하세요. characters 객체에 character2 키를 포함하지 마세요."
        )
    else:
        # rel is None → 자율 판단
        c2_rule = (
            "사용자가 관계를 명시하지 않았습니다. 아래 \"## v46 자율 판단 룰\" 에 따라 "
            "곡 분위기로 character2 포함 여부와 역할을 자율 결정하세요. 결정 결과는 "
            "출력 JSON 의 `inferred_relationship` 필드에 영어 enum 으로 명시해야 합니다."
        )
        auto_infer_rule = (
            "## v46 자율 판단 룰 (relationship 미명시 시)\n"
            "사용자가 관계를 명시하지 않은 경우, 곡의 가사·장르·무드를 분석하여 다음 중 "
            "하나로 자율 판단하세요:\n"
            "  - 곡 분위기가 사랑/외로움/그리움/설렘\n"
            "      → character2 를 \"우연한 만남\" 또는 \"잠재적 짝사랑 대상\" 으로 추가\n"
            "      → inferred_relationship: \"stranger\" 또는 \"crush\"\n"
            "  - 곡 분위기가 우정/축제/응원\n"
            "      → character2 를 \"친구\" 로 추가\n"
            "      → inferred_relationship: \"friend\"\n"
            "  - 곡 분위기가 가족/추억\n"
            "      → character2 를 \"가족 구성원\" 으로 추가\n"
            "      → inferred_relationship: \"family\"\n"
            "  - 곡 분위기가 단독 자기 성찰/도전\n"
            "      → character2 미생성 (단독 주인공 캐릭터)\n"
            "      → inferred_relationship: \"self\"\n"
            "자율 판단한 결과는 출력 JSON 최상위 `inferred_relationship` 필드에 영어 enum "
            "(`stranger | crush | friend | family | self`) 으로 명시하세요. 사용자가 관계를 "
            "명시한 경우(즉 위 character2 규칙이 \"반드시 포함\"/\"반드시 생략\" 인 경우) "
            "이 필드는 출력하지 않거나 null 로 두세요.\n\n"
        )

    # ── character1 meta (name/age/personality/description) injection ──
    meta = character1_meta or {}
    meta_name = (meta.get("name") or "").strip() if isinstance(meta, dict) else ""
    meta_age = (meta.get("age") or "").strip() if isinstance(meta, dict) else ""
    meta_tags_raw = meta.get("personality_tags") if isinstance(meta, dict) else None
    meta_tags = [t.strip() for t in (meta_tags_raw or []) if isinstance(t, str) and t.strip()]
    meta_text = (meta.get("personality_text") or "").strip() if isinstance(meta, dict) else ""
    # v63: description 키 추가 — 커버 인물 vision 추출 결과를 미리 박는 슬롯.
    meta_description = (meta.get("description") or "").strip() if isinstance(meta, dict) else ""
    has_any_meta = bool(meta_name or meta_age or meta_tags or meta_text or meta_description)

    if has_any_meta:
        c1_meta_lines = [
            "## character1 메타 (사용자 지정 — 절대 변경 금지)",
            "- 사용자가 아래 값을 직접 지정했습니다. character1의 해당 필드는 "
            "이 값 그대로 사용하세요. 다른 값으로 대체하지 마세요.",
        ]
        if meta_name:
            c1_meta_lines.append("- name: \"{}\" (그대로 사용)".format(meta_name))
        if meta_age:
            c1_meta_lines.append("- age: \"{}\" (자유 텍스트, 그대로 사용)".format(meta_age))
        if meta_description:
            # v63: 커버 인물 vision 추출 description. 시나리오 LLM 은 이 description 을
            # 그대로 character1.description 에 사용하고, 외형 묘사를 새로 만들지 않는다.
            c1_meta_lines.append(
                "- description: \"{}\" — character1.description 은 이 영문 문장을 그대로 "
                "한국어로 번역해서 출력하세요. 외형(헤어/의상/체형/분위기) 묘사를 "
                "새로 만들거나 다른 외형으로 바꾸지 마세요. 다른 메타(나이/성격)는 "
                "이 외형과 자연스럽게 어울리게 자유롭게 작성해도 됩니다.".format(meta_description)
            )
        if meta_tags or meta_text:
            c1_meta_lines.append(
                "- personality.tags: {} / personality.text: \"{}\" "
                "— 이 태그들과 자유 설명을 뉘앙스 힌트로 결합해 장면/표정/행동 묘사에 "
                "자연스럽게 반영하세요. tags와 text 값 자체는 변경하지 말고 그대로 출력하세요.".format(
                    meta_tags, meta_text,
                )
            )
        c1_meta_block = "\n".join(c1_meta_lines) + "\n\n"
    else:
        c1_meta_block = (
            "## character1 메타 (AI 생성)\n"
            "- character1.age는 자유 텍스트로 이야기와 분위기에 어울리게 생성하세요 "
            "(예: \"20대 중반\", \"17살\", \"30대 초반\").\n"
            "- character1.personality는 {\"tags\": [...], \"text\": \"...\"} 형태로, "
            "태그 1~5개와 1-2문장의 자유 설명을 이야기/분위기에 맞게 생성하세요.\n\n"
        )

    c2_meta_block = (
        "## character2 메타 (AI 생성)\n"
        "- character2가 포함될 때 age(자유 텍스트)와 personality(tags + text)를 "
        "이야기의 관계/분위기에 맞게 생성하세요.\n\n"
    )

    # v42: user-supplied location anchor (regression-safe — empty string when absent).
    _loc_anchor = anchor_clause("phase1_scenario", location_name)
    user_location_anchor_block = (_loc_anchor + "\n") if _loc_anchor else ""

    # ── v45: relationship → other_characters 빈도 룰 (v46: lover/crush 추가) ──
    if rel in ("lover", "ex_lover"):
        other_chars_rule = (
            "relationship={} 이므로, 전체 events 의 **50% 이상**에서 "
            "other_characters 가 비어있지 않아야 합니다 (character2 와의 상호작용)."
        ).format(rel)
    elif rel == "crush":
        other_chars_rule = (
            "relationship=crush 이므로, 전체 events 의 **40% 이상**에서 "
            "other_characters 가 비어있지 않아야 합니다 (character2 가 시야에 들어오는 "
            "장면 — 멀리서 바라봄 / 우연히 마주침 / 같은 공간에 있음 등)."
        )
    elif rel in ("friend", "colleague", "family"):
        other_chars_rule = (
            "relationship={} 이므로, 전체 events 의 **30% 이상**에서 "
            "other_characters 가 비어있지 않아야 합니다 (character2 와의 상호작용)."
        ).format(rel)
    elif rel == "none":
        other_chars_rule = (
            "사용자가 \"등장인물 없음\" 을 명시했으므로, 모든 events 의 "
            "other_characters 는 **반드시 빈 배열 []** 이어야 합니다."
        )
    else:
        # rel is None — 자율 판단. 자율 결정에 따라 비율은 inferred_relationship 에 맞춰 정하세요.
        other_chars_rule = (
            "relationship 미명시 (자율 판단). inferred_relationship 결정에 따라 다음 비율을 "
            "지키세요:\n"
            "  - inferred_relationship in {stranger, crush, friend, family} → 위 룰과 동일 "
            "(stranger/crush=40%+, friend/family=30%+ events 에서 other_characters 비지 않음).\n"
            "  - inferred_relationship == self → 모든 events 의 other_characters 는 빈 배열 []."
        )

    # ── v45: events 개수 가이드 ──
    if isinstance(audio_duration_sec, (int, float)) and audio_duration_sec > 0:
        _audio_min = audio_duration_sec / 60.0
        _evt_target = max(6, min(18, round(_audio_min * 3)))
        events_count_rule = (
            "events 개수는 정확히 **{}개** 로 작성하세요 (오디오 길이 {:.1f}분 × 3, "
            "최소 6, 최대 18 적용)."
        ).format(_evt_target, _audio_min)
    else:
        events_count_rule = (
            "events 개수는 8~12개로 작성하세요 (오디오 길이 정보가 없을 때 기본값)."
        )

    system_prompt = (
        "당신은 음악 비디오 감독이자 단편영화 시나리오 작가입니다. "
        "인물(인물 메타데이터) + 사건(스토리) + 감정의 흐름을 갖춘 단편영화식 서사를 작성하세요.\n\n"
        "## 출력 규칙 (엄격)\n"
        "- 반드시 아래 형식의 **JSON only** 로 응답하세요. 마크다운 코드 펜스(```), 설명, "
        "머리말/꼬리말 일체 금지. JSON 그 자체만 출력하세요.\n"
        "- 모든 한국어 텍스트(이름/설명/본문)는 자연스러운 한국어로 작성하세요.\n"
        "- narrative 와 scenario 본문에는 characters/locations에 정의한 이름을 직접 사용하세요. "
        "\"주인공\", \"그녀\", \"장소1\" 같은 플레이스홀더 표현은 금지합니다.\n\n"
        "## v46 — ABSOLUTE RULE: 사건 비율 60% (절대 준수)\n"
        "전체 events 중 **최소 60%** 는 \"주인공 캐릭터의 인생·관계·결정에 변화를 일으키는 "
        "사건\" 을 trigger 로 가져야 합니다.\n"
        "자연 현상(꽃잎·바람·햇살·하늘·노을·구름·별·태양·달·비·눈·계절·시간·공기·햇빛 등) "
        "**만** trigger 로 사용하는 events 는 **40% 이하** 로 제한하세요.\n"
        "사건성 trigger 의 예:\n"
        "  - 새로운 인물의 등장 / 우연한 마주침\n"
        "  - 옛 인연의 신호(메시지·전화·소문)\n"
        "  - [의미 있는 물건의] 발견 / [관계 인물의] 부탁·거절·고백·관계 변화 통보\n"
        "  - 결단을 요구하는 상황 / 마감·기한\n"
        "  - 주인공 캐릭터의 능동적 결정 (현재 상태에서 벗어나는 행동, 누군가에게 적극적으로 닿는 행동 등)\n"
        "자연 현상은 secondary detail (배경) 로만 사용하세요. 자연 현상 단독으로 trigger 를 "
        "채우지 마세요. 예: trigger=[관계 인물]이 [일상 공간]에서 [예측 못한 형태로 접촉] + "
        "props=[입력 곡과 어울리는 작은 소품] (자연 현상은 props 로 이동).\n\n"
        "{auto_infer_rule}"
        "{user_event_seed_block}"
        "## v45 작성 순서 (절대 준수 — chain-of-thought)\n"
        "아래 4단계를 **반드시 이 순서로** 머릿속에서 수행한 뒤, 결과를 한 번의 JSON 으로 출력하세요.\n\n"
        "**1단계 — narrative 작성 (먼저!)**\n"
        "- 단편소설처럼 자연스러운 한국어 산문으로 작성. 길이는 **1500~2500자**.\n"
        "- 배경, 인물, 갈등, 사건, 감정 변화를 **모두** 포함.\n"
        "- 카메라가 포착할 시각 요소 중심. 추상적 감정만 늘어놓지 말 것.\n"
        "- 등장인물 이름과 장소 이름을 직접 사용 (\"주인공/그녀\" 같은 플레이스홀더 금지).\n\n"
        "**2단계 — narrative 에서 분리 필드 추출**\n"
        "- premise: 배경 서사 (한국어 1~2문장. 입력 곡에 맞는 새 인물 이름·새 상황으로 작성).\n"
        "- character_states: {{ character1: \"내적 상태/동기\", character2: \"...\" }} (등장 인물별 dict).\n"
        "- central_conflict: 핵심 갈등을 **한 문장**으로.\n"
        "- emotional_core: 감정 비율 표현. 예: \"그리움 60% + 후회 25% + 결심 15%\".\n"
        "- narrative_arc: {{ setup: \"...\", trigger: \"...\", climax: \"...\", resolution: \"...\" }} (4-Act 구조).\n\n"
        "**3단계 — events 배열 구성 (narrative 의 사건 시퀀스 추출)**\n"
        "- {events_count_rule}\n"
        "- 각 event 객체는 아래 9 필드를 모두 가져야 합니다:\n"
        "    order(int), section(\"Intro|Verse1|PreChorus|Chorus1|Verse2|Chorus2|Bridge|Outro\" 등),\n"
        "    setting(\"@location1\" 형태 — locations 키와 일치),\n"
        "    trigger (v46 강화) — \"주인공 캐릭터의 인생·관계·결정에 변화를 일으키는 사건\". "
        "자연 현상(꽃잎·바람·햇살 등) 만 단독으로 trigger 가 되면 안 됨. 인물 등장·결정·"
        "신호·발견·만남 같은 사건성 표현이 우선,\n"
        "    protagonist_action(주인공 캐릭터의 능동적 행동 — 단순 \"걷는다/앉는다\" 금지),\n"
        "    motivation(왜 이 행동을 하는가 — premise/character_states 와 직접 연결),\n"
        "    other_characters([\"@character2\", ...] 또는 빈 배열),\n"
        "    emotion_shift(\"이전 감정 → 이후 감정\"),\n"
        "    props([\"소품1\", \"소품2\"]).\n"
        "- **사건 비율 60% 룰**: 위 ABSOLUTE RULE 을 다시 한 번 확인하세요. events 의 60% 이상이 "
        "사건성 trigger 여야 합니다.\n"
        "- {other_chars_rule}\n"
        "- **Motif 회수 필수**: 첫 event 의 props 중 하나가 마지막 event 의 props 에 다시 등장해야 합니다. "
        "단, 의미는 변환되어야 합니다. 예: 첫 씬 [입력 곡 정서에 맞는 작은 소품 = 감정 1] → "
        "마지막 씬 같은 소품 = [감정 2 — 의미가 변환됨].\n\n"
        "**4단계 — Self-verify (출력 직전 자체 검증)**\n"
        "- narrative ↔ premise/character_states/central_conflict/emotional_core/narrative_arc 일관성.\n"
        "- events 가 narrative 의 사건 시퀀스를 따라가는가.\n"
        "- **사건 비율 60% 룰 충족 (v46 추가 — 자연 현상 단독 trigger ≤ 40%)**.\n"
        "- other_characters 비율 충족 (3단계 룰).\n"
        "- motif 회수 충족 (첫·마지막 event props 교집합 ≥ 1, 의미 변환).\n"
        "- (자율 판단인 경우) inferred_relationship 결정 결과가 character2 포함 여부와 일치.\n"
        "- 부족하면 출력 전에 보정한 뒤 최종 JSON 한 번만 출력.\n\n"
        "## character1 규칙 (절대 준수)\n"
        "- {c1_gender_rule}\n"
        "- {c1_look_rule}\n"
        "- role은 \"주인공\"으로 설정하세요.\n"
        "- name은 한국식 이름으로 설정하되, 위 anti-example 블록의 금지 이름과 다른 새 이름을 만드세요.\n"
        "- description은 외모/의상/분위기를 1-2문장의 한국어로 작성하세요.\n\n"
        "{c1_meta_block}"
        "## character2 규칙\n"
        "- {c2_rule}\n"
        "- character2가 포함되는 경우, name은 한국식 이름, description은 외모/의상/분위기를 "
        "1-2문장의 한국어로 작성하세요.\n\n"
        "{c2_meta_block}"
        "## locations 규칙\n"
        "- 이야기에 필요한 만큼만 1~3개의 장소를 정의하세요 (location1, location2, location3).\n"
        "- 각 장소의 description은 분위기/조명/디테일을 1-2문장의 한국어로 작성하세요.\n"
        "{user_location_anchor_block}\n"
        "## 창작 규칙\n"
        "- 뮤직비디오의 주연(가창자)은 오직 character1입니다. 다른 인물은 노래/랩/립싱크를 "
        "하지 않습니다.\n"
        "- 영상이 보여줄 장면, 즉 카메라가 포착할 시각 요소 중심으로 쓰세요.\n\n"
        "{few_shot_examples}\n"
        "## 출력 형식 (이 구조를 그대로 따르세요)\n"
        "{{\n"
        "  \"characters\": {{\n"
        "    \"character1\": {{\"name\": \"한국이름\", \"gender\": \"female|male|neutral\", \"age\": \"자유 텍스트 나이\", \"personality\": {{\"tags\": [\"태그1\"], \"text\": \"성격/분위기\"}}, \"role\": \"주인공\", \"description\": \"외모/의상/분위기 1-2문장\"}},\n"
        "    \"character2\": {{\"name\": \"한국이름\", \"gender\": \"female|male\", \"age\": \"자유 텍스트\", \"personality\": {{\"tags\": [\"태그1\"], \"text\": \"...\"}}, \"role\": \"옛 연인 등\", \"description\": \"...\"}}\n"
        "  }},\n"
        "  \"locations\": {{\n"
        "    \"location1\": {{\"name\": \"장소이름\", \"description\": \"...\"}},\n"
        "    \"location2\": {{\"name\": \"...\", \"description\": \"...\"}}\n"
        "  }},\n"
        "  \"narrative\": \"1500~2500자 한국어 산문 (1단계 결과)\",\n"
        "  \"premise\": \"배경 서사 한 단락\",\n"
        "  \"character_states\": {{\"character1\": \"내적 상태\", \"character2\": \"내적 상태\"}},\n"
        "  \"central_conflict\": \"핵심 갈등 한 문장\",\n"
        "  \"emotional_core\": \"감정 비율 표현\",\n"
        "  \"narrative_arc\": {{\"setup\": \"...\", \"trigger\": \"...\", \"climax\": \"...\", \"resolution\": \"...\"}},\n"
        "  \"inferred_relationship\": \"stranger | crush | friend | family | self | null\",\n"
        "  \"selected_archetype\": \"chance_encounter | reunion | farewell | pursuit_of_dream | subtle_growth | support_and_friendship | inner_resolution | null\",\n"
        "  \"events\": [\n"
        "    {{\"order\": 1, \"section\": \"Intro\", \"setting\": \"@location1\", \"trigger\": \"...\", \"protagonist_action\": \"...\", \"motivation\": \"...\", \"other_characters\": [], \"emotion_shift\": \"... → ...\", \"props\": [\"...\"]}}\n"
        "    /* ... events_count_rule 만큼 ... */\n"
        "  ],\n"
        "  \"scenario\": \"하위호환용 본문 — narrative 의 첫 600~800자 또는 narrative 그대로 (한국어)\"\n"
        "}}\n\n"
        "주의: `inferred_relationship` 은 사용자가 relationship 을 명시하지 않은 경우(자율 판단) "
        "에만 영어 enum 값으로 채우고, 명시한 경우엔 null 또는 생략하세요.\n"
        "v47 — `selected_archetype` 은 위 브레인스토밍 후보 중 어떤 plot_archetype 의 흐름을 "
        "본 시나리오에 채택했는지 영어 enum 으로 표시하세요. 후보들을 혼합한 경우 가장 큰 비중의 "
        "archetype 을 고르거나 null 로 두어도 됩니다."
    ).format(
        c1_gender_rule=c1_gender_rule,
        c1_look_rule=c1_look_rule,
        c2_rule=c2_rule,
        c1_meta_block=c1_meta_block,
        c2_meta_block=c2_meta_block,
        user_location_anchor_block=user_location_anchor_block,
        events_count_rule=events_count_rule,
        other_chars_rule=other_chars_rule,
        few_shot_examples=DRAMA_FEW_SHOT_EXAMPLES,
        auto_infer_rule=auto_infer_rule,
        # v49: 시드 블록 (truthy 일 때만 텍스트, 아니면 빈 문자열 → v48 byte-level 동일).
        user_event_seed_block=_format_user_event_seed_block_stage2(user_event_seed),
    )
    # v50 — append anti-example block at the very end (LLM attention is strongest
    # on the most recent instruction). Stage 1 / Stage 2 share the same SSOT.
    system_prompt = system_prompt + ANTI_EXAMPLE_BLOCK

    user_parts = []
    user_parts.append("제목: {}".format(title))
    if genre:
        user_parts.append("장르: {}".format(genre))
    if mood:
        user_parts.append("분위기: {}".format(mood))
    user_parts.append("vocal_gender: {}".format(vg or "지정 없음"))
    if rel is None:
        user_parts.append(
            "relationship: 미명시 (자율 판단 — 위 \"v46 자율 판단 룰\" 에 따라 곡 분위기로 "
            "결정하고 inferred_relationship 필드로 결과 명시)"
        )
    else:
        user_parts.append("relationship: {} (사용자 명시 — inferred_relationship 은 null)".format(rel))
    user_parts.append(
        "사용자 캐릭터 시트 제공 여부: {}".format("예" if has_user_character else "아니오")
    )
    user_parts.append(
        "커버 이미지 인물 참조 여부: {}".format("예" if has_cover_person else "아니오")
    )
    if isinstance(audio_duration_sec, (int, float)) and audio_duration_sec > 0:
        user_parts.append(
            "audio_duration_sec: {:.1f} (events 개수 산정에 사용)".format(float(audio_duration_sec))
        )

    # v45: brainstorm 후보 (Stage 1 결과) 주입
    if brainstorm_candidates:
        try:
            _brain_json = json.dumps(brainstorm_candidates, ensure_ascii=False, indent=2)
            user_parts.append(
                "## 브레인스토밍 후보 (Stage 1 결과 — 가장 적합한 1개를 선택하거나 혼합하세요)\n{}".format(
                    _brain_json
                )
            )
        except Exception:
            pass

    if lyrics:
        user_parts.append("가사:\n{}".format(lyrics[:3000]))
    user_parts.append(
        "\n위 조건과 브레인스토밍 후보를 바탕으로, 4단계 chain-of-thought 순서를 지켜 "
        "**최종 JSON 한 번만** 응답하세요. JSON 외 어떤 텍스트도 출력하지 마세요."
    )

    user_prompt = "\n".join(user_parts)
    # v46/v49: trace log — 시크릿/가사 본문 제외, 메타데이터만. v49: seed_len 추가 (본문 X).
    _seed_len_s2 = len((user_event_seed or "").strip()) if user_event_seed else 0
    logger.info(
        "[PromptBuild] stage=2 rel=%s vg=%s has_brainstorm=%s has_user_char=%s has_cover_person=%s "
        "audio_sec=%s lyrics_len=%d seed_len=%d",
        rel or "auto",
        vg or "auto",
        bool(brainstorm_candidates),
        bool(has_user_character),
        bool(has_cover_person),
        ("{:.1f}".format(audio_duration_sec) if isinstance(audio_duration_sec, (int, float)) and audio_duration_sec else "n/a"),
        len(lyrics or ""),
        _seed_len_s2,
    )
    return system_prompt, user_prompt


class RetryableScenarioError(ValueError):
    """v45 — raised when scenario passes JSON parse but fails v45 semantic checks
    (event count, motif recall, other_characters ratio, narrative length).

    v46 — additionally raised when eventful trigger ratio < 60%.

    Caller (mv_pipeline Phase 0) catches this and retries once with adjusted
    temperature/seed before falling back to the legacy v30 schema.
    """
    pass


# ── v46 — Eventful trigger heuristics (A) ─────────────────────────────────────
#
# 시나리오 LLM 의 trigger 텍스트가 "주인공 캐릭터의 인생·관계·결정에 변화를 일으키는
# 사건" 인지(eventful) 아니면 자연 현상 단독(natural) 인지 판단한다. v45 결과 분석에서
# trigger 가 모두 꽃잎/햇살/바람 같은 자연 현상이면 "사건" 이 아니라 "감정 일기" 라는
# 진단을 받았기에 60% 이상 사건성으로 강제한다.

NATURAL_PHENOMENA_KEYWORDS = (
    "꽃잎", "벚꽃", "꽃비", "낙엽", "단풍", "바람", "햇살", "햇빛", "햇볕",
    "하늘", "노을", "황혼", "구름", "별", "별빛", "은하", "태양", "해", "달",
    "달빛", "비", "빗방울", "빗물", "소나기", "장맛비", "눈", "눈송이",
    "함박눈", "서리", "이슬", "안개", "운무", "그림자", "그늘", "공기",
    "계절", "시간", "세월", "여명", "새벽", "황금빛",
)

EVENTFUL_KEYWORDS = (
    # 인물 등장/만남
    "만남", "만난", "마주", "재회", "조우", "스쳐", "지나친다",
    # 헤어짐/이별
    "헤어", "이별", "작별",
    # 통신/신호
    "전화", "통화", "벨이", "메시지", "문자", "톡", "편지", "쪽지", "엽서",
    # 감정 행동
    "고백", "거절", "부탁", "사과", "용서", "초대", "초청", "약속", "다툼",
    "싸움", "포옹", "안긴", "키스", "입맞", "악수", "손을 잡", "손을 잡았",
    # 결정/행동
    "결단", "결심", "결정", "선언", "선언한다", "포기", "다짐",
    # 발견/상실
    "발견", "찾았", "찾는", "잃어버", "놓쳤",
    # 이동/경로
    "도착", "떠남", "떠난", "출발", "귀가", "이사", "여행", "방문", "들어선",
    "들어온", "들어왔",
    # 외부 사건
    "선물", "초대장", "경고", "소식", "소문", "통보", "알림", "공연", "오디션",
    "마감", "기한",
    # 등장
    "등장", "나타", "들어왔", "들어선", "들어온",
)


def _classify_trigger_kind(trigger_text: str, other_characters=None) -> str:
    """Classify a trigger string as 'eventful' or 'natural'.

    Heuristic (보수적 — 애매하면 eventful 로):
      1) other_characters 가 비어있지 않으면 → eventful (인물 사건)
      2) EVENTFUL_KEYWORDS 중 하나라도 매치 → eventful
      3) NATURAL_PHENOMENA_KEYWORDS 만 매치 → natural
      4) 둘 다 매치 안 → eventful (LLM 신뢰)
      5) 빈 문자열 → 'unknown' (validator 에서 따로 처리)
    """
    text = (trigger_text or "").strip()
    if not text:
        return "unknown"

    # 1) other_characters 비어있지 않으면 무조건 eventful
    if other_characters and isinstance(other_characters, list):
        if any(str(x).strip() for x in other_characters if x is not None):
            return "eventful"

    text_lower = text.lower()

    # 2) eventful 키워드 매치
    for kw in EVENTFUL_KEYWORDS:
        if kw in text_lower:
            return "eventful"

    # 3) natural 키워드 매치 (eventful 키워드가 없을 때만 도달)
    for kw in NATURAL_PHENOMENA_KEYWORDS:
        if kw in text_lower:
            return "natural"

    # 4) 어느 키워드도 매치 안 → 보수적으로 eventful (LLM 신뢰)
    return "eventful"


def _count_eventful_triggers(events: list) -> dict:
    """Count eventful vs natural triggers in events array.

    Returns {eventful, natural, unknown, total, eventful_ratio, samples} where
    samples is a small list of (kind, trigger_text[:60]) for log/debug.
    """
    eventful = 0
    natural = 0
    unknown = 0
    samples = []
    total = 0
    if isinstance(events, list):
        for ev in events:
            if not isinstance(ev, dict):
                continue
            total += 1
            tr = ev.get("trigger") or ""
            oc = ev.get("other_characters") or []
            kind = _classify_trigger_kind(tr, oc)
            if kind == "eventful":
                eventful += 1
            elif kind == "natural":
                natural += 1
            else:
                unknown += 1
            if len(samples) < 6:
                samples.append((kind, str(tr)[:60]))
    ratio = (eventful / total) if total else 0.0
    return {
        "eventful": eventful,
        "natural": natural,
        "unknown": unknown,
        "total": total,
        "eventful_ratio": ratio,
        "samples": samples,
    }


def _validate_scenario_events(
    events: list,
    relationship: Optional[str],
    expected_event_count: Optional[int] = None,
    strict: bool = True,
) -> dict:
    """v45 — validate events array semantically.

    Returns metrics dict {count, other_chars_ratio, motif_props, has_motif_recall,
    relationship_required_ratio, ratio_ok, soft_failures}. Raises
    RetryableScenarioError when a hard-fail constraint is violated.

    strict=True (default): violation of any hard rule → raise.
    strict=False (soft mode): violations are recorded into metrics["soft_failures"]
        and a warning is logged, but no exception is raised. Used by pipeline on
        the final retry to allow graceful degradation when small models fail spec.
    """
    soft_failures = []

    def _fail(msg):
        if strict:
            raise RetryableScenarioError(msg)
        soft_failures.append(msg)

    if not isinstance(events, list):
        if strict:
            raise RetryableScenarioError("scenario_events is not a list")
        events = []
        soft_failures.append("scenario_events is not a list")

    n = len(events)
    if n < 6:
        _fail("scenario_events count too low ({} < 6)".format(n))

    # ── Event-count tolerance: ±1 from expected (when known) ──
    if isinstance(expected_event_count, int) and expected_event_count > 0:
        if abs(n - expected_event_count) > 1 and not (6 <= n <= 18):
            _fail("scenario_events count {} not within tolerance of expected {}".format(
                n, expected_event_count
            ))

    # ── other_characters ratio per relationship ──
    # v46: lover/crush/none 추가. 자율 판단(rel is None) 일 때는 검사 스킵 — LLM 의
    # inferred_relationship 결정에 맡긴다.
    rel = (relationship or "").strip().lower() or None
    rel_is_explicit_none = (rel == "none")  # 사용자 명시 단독
    rel_is_auto = (rel is None)             # 자율 판단

    if rel in ("lover", "ex_lover"):
        required_ratio = 0.50
    elif rel == "crush":
        required_ratio = 0.40
    elif rel in ("friend", "colleague", "family"):
        required_ratio = 0.30
    else:
        # rel_is_explicit_none or rel_is_auto
        required_ratio = 0.0

    populated = 0
    for ev in events:
        if not isinstance(ev, dict):
            continue
        oc = ev.get("other_characters") or []
        if isinstance(oc, list) and any(str(x).strip() for x in oc if x is not None):
            populated += 1
    actual_ratio = populated / n if n else 0.0

    if rel_is_explicit_none:
        if populated > 0:
            _fail("explicit none (단독 주인공) but {} of {} events have other_characters".format(
                populated, n
            ))
    elif rel_is_auto:
        # 자율 판단 — populated > 0 이어도 OK (LLM 이 stranger/crush/friend/family 로 결정 가능),
        # populated == 0 이어도 OK (self 로 결정). 비율 검사 skip.
        pass
    else:
        if actual_ratio + 1e-6 < required_ratio:
            _fail("other_characters ratio {:.2f} < required {:.2f} for relationship={}".format(
                actual_ratio, required_ratio, rel
            ))

    # ── v46: Eventful trigger ratio ≥ 60% (A) ──
    eventful_metrics = _count_eventful_triggers(events)
    eventful_ratio = eventful_metrics["eventful_ratio"]
    EVENTFUL_REQUIRED = 0.60
    logger.info(
        "[EventfulCount] eventful=%d natural=%d unknown=%d total=%d ratio=%.2f",
        eventful_metrics["eventful"], eventful_metrics["natural"],
        eventful_metrics["unknown"], eventful_metrics["total"], eventful_ratio,
    )
    if n > 0 and eventful_ratio + 1e-6 < EVENTFUL_REQUIRED:
        _fail(
            "eventful trigger ratio {:.2f} < required {:.2f} ({} of {} eventful, {} natural)".format(
                eventful_ratio, EVENTFUL_REQUIRED,
                eventful_metrics["eventful"], n, eventful_metrics["natural"],
            )
        )

    # ── Motif recall: first event props ∩ last event props ≥ 1 ──
    def _props_set(ev):
        p = ev.get("props") if isinstance(ev, dict) else None
        if not isinstance(p, list):
            return set()
        return {str(x).strip() for x in p if x is not None and str(x).strip()}

    first_props = _props_set(events[0]) if n > 0 else set()
    last_props = _props_set(events[-1]) if n > 0 else set()
    motif_intersection = first_props & last_props
    has_motif = bool(motif_intersection)
    if not has_motif:
        _fail("motif recall failed — first props {} ∩ last props {} = empty".format(
            sorted(first_props), sorted(last_props)
        ))

    if soft_failures and not strict:
        logger.warning(
            "v45 soft-mode parser passed with %d unmet constraint(s): %s",
            len(soft_failures), "; ".join(soft_failures),
        )

    return {
        "count": n,
        "other_chars_populated": populated,
        "other_chars_ratio": actual_ratio,
        "required_ratio": required_ratio,
        "motif_props": sorted(motif_intersection),
        "has_motif_recall": has_motif,
        # v46
        "eventful": eventful_metrics["eventful"],
        "natural": eventful_metrics["natural"],
        "eventful_ratio": eventful_ratio,
        "eventful_required": EVENTFUL_REQUIRED,
        "eventful_samples": eventful_metrics["samples"],
        "ratio_ok": not soft_failures or strict,
        "soft_failures": soft_failures,
    }


def _parse_drama_scenario_json(
    text: str,
    relationship: Optional[str] = None,
    expected_event_count: Optional[int] = None,
    require_v45: bool = True,
    strict: bool = True,
) -> dict:
    """Parse LLM response into drama scenario dict.

    Tries strict json.loads first; falls back to extracting the largest JSON
    object substring.

    v45 (require_v45=True, default): validates narrative (1500~2500 chars),
    separated fields presence, events schema + count + relationship ratio +
    motif recall. Returns dict with v45 keys
    {characters, locations, scenario, narrative, premise, character_states,
    central_conflict, emotional_core, narrative_arc, events, _v45_metrics}.
    Raises RetryableScenarioError on v45 semantic failures so caller can retry.

    v30 fallback (require_v45=False): legacy minimal schema
    {characters, locations, scenario}. Used only for backward-compat or fallback.

    Raises ValueError on unrecoverable JSON failure.
    """
    if not text:
        raise ValueError("Empty scenario response")

    text = text.strip()
    # Strip markdown code fences if any snuck through
    if text.startswith("```"):
        _lines = text.split("\n", 1)
        text = _lines[1] if len(_lines) > 1 else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()
        if text.startswith("json\n") or text.startswith("json\r\n"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
            text = text.strip()

    try:
        data = json.loads(text)
    except Exception:
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

    # ── Common fields (v30 + v45) ──
    characters = data.get("characters") or {}
    locations = data.get("locations") or {}
    scenario = data.get("scenario") or ""
    if not isinstance(scenario, str):
        scenario = str(scenario)
    scenario = scenario.strip()

    # Normalize character age/personality
    normalized_chars = {}
    if isinstance(characters, dict):
        for ckey, cinfo in characters.items():
            if not isinstance(cinfo, dict):
                continue
            age_val = cinfo.get("age") or ""
            if not isinstance(age_val, str):
                age_val = str(age_val)
            pers = cinfo.get("personality")
            if isinstance(pers, dict):
                p_tags_raw = pers.get("tags") or []
                p_tags = [t for t in p_tags_raw if isinstance(t, str) and t.strip()]
                p_text = pers.get("text") or ""
                if not isinstance(p_text, str):
                    p_text = str(p_text)
            elif isinstance(pers, str):
                p_tags = []
                p_text = pers
            else:
                p_tags = []
                p_text = ""
            cinfo["age"] = age_val.strip()
            cinfo["personality"] = {"tags": p_tags, "text": p_text.strip()}
            normalized_chars[ckey] = cinfo

    # ── v45 fields ──
    narrative = (data.get("narrative") or "").strip()
    if not isinstance(narrative, str):
        narrative = str(narrative)

    premise = str(data.get("premise") or "").strip()
    character_states = data.get("character_states") or {}
    if not isinstance(character_states, dict):
        character_states = {}
    central_conflict = str(data.get("central_conflict") or "").strip()
    emotional_core = str(data.get("emotional_core") or "").strip()
    narrative_arc = data.get("narrative_arc") or {}
    if not isinstance(narrative_arc, dict):
        narrative_arc = {}
    events = data.get("events") or []
    if not isinstance(events, list):
        events = []

    # ── v46: inferred_relationship 파싱 ──
    # 사용자가 relationship 을 명시하지 않았을 때 LLM 이 자율 판단해 채우는 필드.
    # 명시한 경우 LLM 은 null 또는 미출력 → 정규화 결과도 None.
    _infer_raw = data.get("inferred_relationship")
    if isinstance(_infer_raw, str):
        _infer = _infer_raw.strip().lower() or None
    else:
        _infer = None
    _ALLOWED_INFER = {"stranger", "crush", "friend", "family", "self"}
    if _infer is not None and _infer not in _ALLOWED_INFER:
        # LLM 이 한국어로 채웠거나 이상한 값 → drop. 무리한 매핑은 안 함.
        logger.warning(
            "[ScenarioParse] inferred_relationship '%s' not in allowed enum, dropping",
            _infer_raw,
        )
        _infer = None
    inferred_relationship = _infer
    logger.info(
        "[ScenarioParse] inferred_relationship=%s (user_relationship=%s)",
        inferred_relationship or "null",
        (relationship or "auto"),
    )

    # ── v47: selected_archetype 파싱 ──
    # Stage 2 가 brainstorm 후보 중 어떤 archetype 의 흐름을 골랐는지 표시. 옵셔널 필드.
    _arche_raw = data.get("selected_archetype")
    if isinstance(_arche_raw, str):
        _arche = _arche_raw.strip().lower() or None
    else:
        _arche = None
    if _arche is not None and _arche not in PLOT_ARCHETYPES_SET:
        logger.warning(
            "[Stage2Select] selected_archetype '%s' not in whitelist, dropping",
            _arche_raw,
        )
        _arche = None
    selected_archetype = _arche
    logger.info(
        "[Stage2Select] selected_archetype=%s",
        selected_archetype or "null",
    )

    # ── v45 semantic validation ──
    if require_v45:
        # narrative length check.
        # Spec target = 1500~2500자. But real-world small LLMs (e.g. gpt-4o-mini) often
        # undershoot on Korean prose length even with explicit length instruction —
        # they tend to land in the 300~500 char range. To avoid gate-keeping behind
        # a length the small models cannot meet, we only hard-fail truly empty-ish
        # narratives (<300자); the prompt still asks for 1500~2500 so larger models
        # (gpt-5.4 / claude-opus-4-* / gemini-2.5-pro) reliably produce in-range output.
        # The legacy v30 path (require_v45=False) keeps its own ≥50 char minimum below.
        soft_failures_top = []

        def _top_fail(msg):
            if strict:
                raise RetryableScenarioError(msg)
            soft_failures_top.append(msg)

        if len(narrative) < 300:
            _top_fail("narrative too short ({} chars, expected ≥1500 — accepting ≥300 with retry)".format(
                len(narrative)
            ))
        # If narrative > 2500 we accept (LLMs sometimes overshoot — not a hard fail).
        # Separated fields presence
        missing = [
            n for (n, v) in [
                ("premise", premise),
                ("central_conflict", central_conflict),
                ("emotional_core", emotional_core),
            ] if not v
        ]
        if missing:
            _top_fail("missing required v45 fields: {}".format(missing))
        if not narrative_arc or not isinstance(narrative_arc, dict):
            _top_fail("narrative_arc missing or invalid")

        # events validation
        metrics = _validate_scenario_events(
            events, relationship=relationship,
            expected_event_count=expected_event_count,
            strict=strict,
        )
        if soft_failures_top:
            metrics.setdefault("soft_failures", []).extend(soft_failures_top)

        # Backward-compat: if scenario body is empty, derive from narrative head
        if not scenario or len(scenario) < 50:
            scenario = narrative[:800].strip() if narrative else scenario

        if len(scenario) < 50:
            raise RetryableScenarioError(
                "Drama scenario body too short ({} chars)".format(len(scenario))
            )

        return {
            "characters": normalized_chars,
            "locations": locations if isinstance(locations, dict) else {},
            "scenario": scenario,
            # v45 fields
            "narrative": narrative,
            "premise": premise,
            "character_states": character_states,
            "central_conflict": central_conflict,
            "emotional_core": emotional_core,
            "narrative_arc": narrative_arc,
            "events": events,
            # v46
            "inferred_relationship": inferred_relationship,
            # v47
            "selected_archetype": selected_archetype,
            "_v45_metrics": metrics,
        }

    # ── v30 legacy fallback ──
    if len(scenario) < 50:
        raise ValueError(
            "Drama scenario body too short ({} chars)".format(len(scenario))
        )

    return {
        "characters": normalized_chars,
        "locations": locations if isinstance(locations, dict) else {},
        "scenario": scenario,
        # v46 — legacy 경로도 빈 값으로 일관 키 유지 (caller 가 .get 으로 안전하게 읽도록)
        "inferred_relationship": inferred_relationship,
        # v47
        "selected_archetype": selected_archetype,
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
    character1_meta=None,
    location_name=None,
    brainstorm_candidates=None,
    audio_duration_sec=None,
    user_event_seed=None,
):
    """Dispatch to drama prompt builder.

    Non-drama styles fall back to drama with a warning (PLAN.md v30 구현1).
    v45: brainstorm_candidates + audio_duration_sec are forwarded for
    Stage 2 Beat Sheet generation.
    v49: user_event_seed (Optional, ≤300자) — drama prompt 안에 시드 블록 inject.
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
        character1_meta=character1_meta,
        location_name=location_name,
        brainstorm_candidates=brainstorm_candidates,
        audio_duration_sec=audio_duration_sec,
        user_event_seed=user_event_seed,
    )
    return system_prompt, user_prompt, True


def _expected_event_count(audio_duration_sec):
    """v45 — derive expected events count from audio duration."""
    try:
        if audio_duration_sec and float(audio_duration_sec) > 0:
            n = round(float(audio_duration_sec) / 60.0 * 3)
            return max(6, min(18, n))
    except Exception:
        pass
    return None


async def _generate_scenario_openai(
    title, genre, mood, lyrics, character_name, model_name=None,
    scenario_style="drama", vocal_gender=None, relationship=None,
    has_user_character=False, has_cover_person=False,
    character1_meta=None, location_name=None,
    brainstorm_candidates=None, audio_duration_sec=None,
    user_event_seed=None,
    temperature: float = 0.85, strict: bool = True,
):
    """Generate MV scenario using OpenAI. Returns dict for drama, str otherwise."""
    client = _get_openai_client()
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(
        scenario_style, title, genre, mood, lyrics, character_name,
        vocal_gender, relationship, has_user_character, has_cover_person,
        character1_meta=character1_meta,
        location_name=location_name,
        brainstorm_candidates=brainstorm_candidates,
        audio_duration_sec=audio_duration_sec,
        user_event_seed=user_event_seed,
    )
    model = model_name or settings.openai_model

    create_kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        # v75 — gpt-5 series: temperature default(1) 만 허용 → 인자 제거.
        # v75 — gpt-5 series: max_tokens → max_completion_tokens.
        # v75.1 — reasoning_effort=high 시 reasoning 토큰이 max_completion_tokens 에서
        # 차감되므로 8000 으로는 drama JSON 본문이 0 토큰 잘려나가 빈 응답이 됨
        # (라이브 검증에서 finish_reason=length 확인). 32000 으로 확대해 reasoning
        # headroom 충분 확보 (drama JSON 본문 자체는 ~3000자 ≤ 1.5k 토큰).
        "max_completion_tokens": 32000,
        "reasoning_effort": "high",
    }
    if is_drama:
        create_kwargs["response_format"] = {"type": "json_object"}

    logger.info(
        "[ReasoningOn] stage=scenario model=%s reasoning_effort=high drama=%s (temp=%.2f dropped) max_completion_tokens=32000",
        model, is_drama, float(temperature),
    )
    resp = await client.chat.completions.create(**create_kwargs)
    raw = resp.choices[0].message.content.strip()

    if is_drama:
        parsed = _parse_drama_scenario_json(
            raw,
            relationship=relationship,
            expected_event_count=_expected_event_count(audio_duration_sec),
            require_v45=True,
            strict=strict,
        )
        logger.info(
            "MV drama scenario generated (OpenAI %s): narrative=%d, events=%d, body=%d",
            model, len(parsed.get("narrative", "")),
            len(parsed.get("events", [])), len(parsed["scenario"]),
        )
        return parsed

    logger.info("MV scenario generated (OpenAI %s): %d chars", model, len(raw))
    return raw


async def _generate_scenario_claude(
    title, genre, mood, lyrics, character_name, model_name="claude-opus-4-6",
    scenario_style="drama", vocal_gender=None, relationship=None,
    has_user_character=False, has_cover_person=False,
    character1_meta=None, location_name=None,
    brainstorm_candidates=None, audio_duration_sec=None,
    user_event_seed=None,
    temperature: float = 0.85, strict: bool = True,
):
    """Generate MV scenario using Anthropic Claude. Returns dict for drama, str otherwise."""
    client = _get_anthropic_client()
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(
        scenario_style, title, genre, mood, lyrics, character_name,
        vocal_gender, relationship, has_user_character, has_cover_person,
        character1_meta=character1_meta,
        location_name=location_name,
        brainstorm_candidates=brainstorm_candidates,
        audio_duration_sec=audio_duration_sec,
        user_event_seed=user_event_seed,
    )

    # v50 — Anthropic Claude API caps temperature at 1.0. Apply cap before send.
    capped_temp = _claude_temp_cap(temperature)
    if capped_temp != float(temperature):
        logger.info(
            "[ClaudeTempCap] requested=%.2f capped=%.2f model=%s stage=scenario",
            float(temperature), capped_temp, model_name,
        )
    scenario_kwargs = {
        "model": model_name,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
        # v75.1 — adaptive thinking + effort=high 시 thinking 토큰이 max_tokens 에서
        # 차감되어 8000 으로는 본 응답 텍스트가 0 토큰 잘려나가 빈 응답이 됨
        # (라이브 검증: stop_reason=max_tokens, content=[]). Anthropic 공식 권장
        # 65535+ 시작값 가이드 참고하여 32000 으로 확대 (JSON 본문 ≤ 1.5k 토큰 + thinking headroom).
        # v75.1 — Anthropic SDK 가 max_tokens 큰 경우 non-streaming 호출을 ValueError 로 차단
        # ("Streaming is required for operations that may take longer than 10 minutes") →
        # `_generate_scene_prompts_claude` (v58.1) 와 동일한 stream + text_stream 패턴으로 전환.
        "max_tokens": 32000,
        # v75 — adaptive thinking + high effort.
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }
    logger.info(
        "[ThinkingOn] stage=scenario model=%s effort=high (capped_temp=%.2f dropped) max_tokens=32000 stream=on",
        model_name, capped_temp,
    )
    # v75.1 — streaming 모드. text_stream 은 TextBlock chunk 만 yield 하므로 thinking 블록 무시.
    _raw_parts: List[str] = []
    async with client.messages.stream(**scenario_kwargs) as _stream:
        async for _chunk in _stream.text_stream:
            _raw_parts.append(_chunk)
    raw = "".join(_raw_parts).strip()

    if is_drama:
        parsed = _parse_drama_scenario_json(
            raw,
            relationship=relationship,
            expected_event_count=_expected_event_count(audio_duration_sec),
            require_v45=True,
            strict=strict,
        )
        logger.info(
            "MV drama scenario generated (Claude %s): narrative=%d, events=%d, body=%d",
            model_name, len(parsed.get("narrative", "")),
            len(parsed.get("events", [])), len(parsed["scenario"]),
        )
        return parsed

    logger.info("MV scenario generated (Claude %s): %d chars", model_name, len(raw))
    return raw


async def _generate_scenario_gemini(
    title, genre, mood, lyrics, character_name,
    scenario_style="drama", vocal_gender=None, relationship=None,
    has_user_character=False, has_cover_person=False,
    character1_meta=None, location_name=None,
    brainstorm_candidates=None, audio_duration_sec=None,
    user_event_seed=None,
    temperature: float = 0.85, strict: bool = True,
):
    """Generate MV scenario using Google Gemini 2.5 Pro. Returns dict for drama, str otherwise."""
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(
        scenario_style, title, genre, mood, lyrics, character_name,
        vocal_gender, relationship, has_user_character, has_cover_person,
        character1_meta=character1_meta,
        location_name=location_name,
        brainstorm_candidates=brainstorm_candidates,
        audio_duration_sec=audio_duration_sec,
        user_event_seed=user_event_seed,
    )

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"

    generation_config = {
        "temperature": float(temperature),
        "maxOutputTokens": 8000,  # v45 enlarged
    }
    if is_drama:
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
        parsed = _parse_drama_scenario_json(
            raw,
            relationship=relationship,
            expected_event_count=_expected_event_count(audio_duration_sec),
            require_v45=True,
            strict=strict,
        )
        logger.info(
            "MV drama scenario generated (Gemini): narrative=%d, events=%d, body=%d",
            len(parsed.get("narrative", "")),
            len(parsed.get("events", [])), len(parsed["scenario"]),
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
    character1_meta: Optional[dict] = None,
    location_name: Optional[str] = None,
    brainstorm_candidates: Optional[dict] = None,
    audio_duration_sec: Optional[float] = None,
    user_event_seed: Optional[str] = None,
    temperature: float = 0.85,
    strict: bool = True,
):
    """Generate an MV scenario (Stage 2 — Beat Sheet, in v45 terms).

    Drama style (default) returns a structured dict with characters/locations/
    scenario PLUS v45 fields {narrative, premise, character_states,
    central_conflict, emotional_core, narrative_arc, events, _v45_metrics}.
    Non-drama styles currently fall back to drama.

    Args:
        models: List of model names. If None, uses default OpenAI model.
                 Supported: OpenAI models, "claude-opus-4-*", "gemini-*".
                 If two models given, runs both in parallel.
        brainstorm_candidates (v45): Stage 1 brainstorm output dict
            ({"candidates": [...]}) — passed to Stage 2 user prompt so the LLM
            can pick or blend the most fitting tone.
        audio_duration_sec (v45): used to derive required events count
            (audio_min × 3, min 6, max 18). When None, defaults to 8~12.
        temperature (v45): for retry path — caller may bump from 0.8 → 0.95
            on a RetryableScenarioError to nudge the LLM out of the failed mode.
    """
    # v49: 진입 시 시드 길이만 1회 로그 (본문 미출력 — PII 보호).
    _seed_len_entry = len((user_event_seed or "").strip()) if user_event_seed else 0
    logger.info(
        "[Stage2Gen] entry models=%s temp=%.2f strict=%s seed_len=%d has_brainstorm=%s",
        models or "(default)", temperature, strict, _seed_len_entry,
        bool(brainstorm_candidates),
    )

    common_args = dict(
        title=title, genre=genre, mood=mood, lyrics=lyrics,
        character_name=character_name,
        scenario_style=scenario_style,
        vocal_gender=vocal_gender,
        relationship=relationship,
        has_user_character=has_user_character,
        has_cover_person=has_cover_person,
        character1_meta=character1_meta,
        location_name=location_name,
        brainstorm_candidates=brainstorm_candidates,
        audio_duration_sec=audio_duration_sec,
        user_event_seed=user_event_seed,
        temperature=temperature,
        strict=strict,
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

PRIORITY OVERRIDE: If the user's `scene_prompt` (free-form direction) explicitly contradicts any rule below, follow the user's direction first.

For each scene, provide THREE separate fields with STRICTLY DISTINCT roles (v60):
1. description: WHAT IS HAPPENING and WHY — action beats, micro-motion, emotional intent, internal context.
   - NEVER include visual composition (camera, lighting, color) — those belong in image_prompt.
   - NEVER include camera motion — that belongs in video_prompt.
   - Example: "She is writing a farewell letter to a former lover; her hand presses the pen slowly and heavily, pausing between sentences with quiet restrained sorrow." (2-3 sentences)
   - This is fed to the VIDEO generation model alongside image_prompt to inform micro-movement, pacing, expression.
2. image_prompt: A vivid VISUAL description for AI image generation — camera composition, lighting, color, framing only.
   - Stays purely visual. No emotional adjectives like "sorrowful" — translate emotion into visible cues (downcast eyes, slumped posture).
3. video_prompt: Camera movement and motion instructions ONLY — for AI video generation.
   - One camera move per clip. No subject action descriptions (those belong in description).

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

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
Both `image_prompt` and `video_prompt` are forwarded to downstream AI video models (Veo / \
Kling / Seedance — all three) whose output filters reject glamour/portrait framing. STRICT:
NEVER write any of these trigger phrases in EITHER prompt: "alone faces camera directly", \
"alone faces camera", "alone facing camera", "mouth open", "singing with mouth open", \
"singing the chorus joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", \
"bright smile", "joyful expression", "joyful gesture", "hair lifted by a gentle breeze", \
"hair lifting in the wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", \
"shoulder sway", "hands lightly raised in a joyful gesture", "eyes closed, breathing in the \
scent", "drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
ALWAYS prefer cinematic alternatives: "framed in a medium close-up", "softly mouthing the \
lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze drifts in the \
air", "hands resting naturally", "surrounded by gently drifting petals", "with a gentle \
expression", "cinematic pastel grade". Describe subjects by appearance — no allure emphasis. \
Provide sufficient cinematic context (lighting/wardrobe/background) so the scene reads as a \
film shot, not a glamour portrait.

{scenario_context}

{user_location_anchor_rule}

Each scene must include a "scene_type" field:
- "drama": cinematic storytelling scene (character NOT looking at camera)
- "lipsync": character faces camera directly, singing/performing (close-up face shot)

scene_type rules (priority-based):
- If ANY section has label containing "Rap", "rap", "Hip-hop", or "Hiphop": ONLY those Rap sections get scene_type "lipsync". All Chorus sections become "drama".
- If NO Rap sections exist: Chorus sections get scene_type "lipsync".
- All other sections (Intro, Verse, Bridge, Outro): always "drama".

## ABSOLUTE RULE — PROTAGONIST INTRO SHOT (주인공샷 / 보컬샷)

When a character (especially `@character1` the protagonist/vocalist) FIRST appears in the MV:
- That scene MUST be a STATIC CLOSE-UP of the character.
- Subject motion must be MINIMAL (slight head tilt or breath OK; no walking/dancing/running).
- Only camera movement allowed: gentle zoom-in or slow dolly forward.
- This rule applies ONCE per character (their first scene only).
- From the SECOND appearance onward, the character may take any action.

Why: this establishes character identity firmly so subsequent action shots maintain visual consistency. Skipping the intro shot causes appearance drift across scenes.

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
  {{"scene_number": 1, "scene_type": "drama", "description": "English action/emotion/intent description (2-3 sentences)...", "image_prompt": "English image prompt (visual only)...", "video_prompt": "English video prompt (camera motion only)...", "description_ko": "한글 행동/감정/맥락 설명 (2-3문장)", "image_prompt_ko": "한글 이미지 프롬프트 (영어 image_prompt 의 자연스러운 한국어 번역)", "video_prompt_ko": "한글 영상 프롬프트 (영어 video_prompt 의 자연스러운 한국어 번역)", "lyrics_segment": "lyrics text ..."}},
  ...
]

Rules:
- Aim for approximately {scene_count} scenes (minimum {scene_min}, maximum {scene_max}).
- "description" (English) — 2-3 sentences of what is HAPPENING and WHY (action, micro-motion, emotional intent, internal context). NO visual composition, NO camera motion. This text is given to the VIDEO generation model alongside image_prompt to drive subtle motion and expression.
- "image_prompt" (English) — 1-3 sentences of purely VISUAL imagery with specific camera/lighting/color details. No emotional adjectives — translate emotion into visible cues only.
- "video_prompt" (English) — camera movement and motion details ONLY (no subject action — that lives in description).
- "description_ko" — natural Korean rendering of `description` (행동·감정·맥락), 2-3 sentences. Used both for display to Korean users AND for traceability of the English `description` semantics.
- "image_prompt_ko" and "video_prompt_ko" — natural Korean translation of image_prompt and video_prompt respectively. Preserve cinematography terms (shot type / camera angle / lighting / camera motion) in standard Korean visual/film vocabulary. Used ONLY for display to Korean-speaking users; downstream image/video LLM calls always use the English prompts.
- For each scene, output BOTH English (`description`, `image_prompt`, `video_prompt`) AND Korean (`description_ko`, `image_prompt_ko`, `video_prompt_ko`) versions in the same JSON object — six fields total per scene.
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
For each scene, provide THREE separate fields with STRICTLY DISTINCT roles (v60):
1. description: WHAT IS HAPPENING and WHY — action beats, micro-motion, emotional intent (2-3 sentences). NO visual composition, NO camera motion.
2. image_prompt: A vivid VISUAL description — camera composition, lighting, color, framing only.
3. video_prompt: Camera movement and motion instructions ONLY (no subject action).

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

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
Both `image_prompt` and `video_prompt` are forwarded to downstream AI video models (Veo / \
Kling / Seedance — all three) whose output filters reject glamour/portrait framing. STRICT:
NEVER write any of these trigger phrases in EITHER prompt: "alone faces camera directly", \
"alone faces camera", "alone facing camera", "mouth open", "singing with mouth open", \
"singing the chorus joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", \
"bright smile", "joyful expression", "joyful gesture", "hair lifted by a gentle breeze", \
"hair lifting in the wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", \
"shoulder sway", "hands lightly raised in a joyful gesture", "eyes closed, breathing in the \
scent", "drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
ALWAYS prefer cinematic alternatives: "framed in a medium close-up", "softly mouthing the \
lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze drifts in the \
air", "hands resting naturally", "surrounded by gently drifting petals", "with a gentle \
expression", "cinematic pastel grade". Describe subjects by appearance — no allure emphasis. \
Provide sufficient cinematic context (lighting/wardrobe/background) so the scene reads as a \
film shot, not a glamour portrait.

{scenario_context}

{user_location_anchor_rule}

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
  {{"scene_number": 1, "scene_type": "drama", "description": "English action/emotion/intent description (2-3 sentences)...", "image_prompt": "English image prompt (visual only)...", "video_prompt": "English video prompt (camera motion only)...", "description_ko": "한글 행동/감정/맥락 설명 (2-3문장)", "image_prompt_ko": "한글 이미지 프롬프트 (영어 image_prompt 의 자연스러운 한국어 번역)", "video_prompt_ko": "한글 영상 프롬프트 (영어 video_prompt 의 자연스러운 한국어 번역)", "lyrics_segment": ""}},
  ...
]

Rules:
- Create exactly {scene_count} scenes.
- "description" (English) — 2-3 sentences of what is HAPPENING and WHY (action, micro-motion, emotional intent). NO visual composition, NO camera motion. This text is given to the VIDEO generation model alongside image_prompt to drive subtle motion and expression.
- "image_prompt" (English) — 1-3 sentences of purely VISUAL imagery with specific camera/lighting/color details. No emotional adjectives — translate emotion into visible cues only.
- "video_prompt" (English) — camera movement and motion details ONLY (no subject action — that lives in description).
- "description_ko" — natural Korean rendering of `description` (행동·감정·맥락), 2-3 sentences.
- "image_prompt_ko" and "video_prompt_ko" — natural Korean translation of image_prompt and video_prompt respectively. Preserve cinematography terms (shot type / camera angle / lighting / camera motion) in standard Korean visual/film vocabulary. Used ONLY for display to Korean-speaking users; downstream image/video LLM calls always use the English prompts.
- For each scene, output BOTH English (`description`, `image_prompt`, `video_prompt`) AND Korean (`description_ko`, `image_prompt_ko`, `video_prompt_ko`) versions in the same JSON object — six fields total per scene.
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

Then for each clip, create THREE separate fields with STRICTLY DISTINCT roles (v60):
1. description: WHAT IS HAPPENING and WHY — action beats, micro-motion, emotional intent, internal context (2-3 sentences). NO visual composition, NO camera motion.
2. image_prompt: A vivid VISUAL description for AI image generation — camera composition, lighting, color, framing only.
3. video_prompt: Camera movement and motion instructions ONLY — no subject action descriptions.

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

## v65 — Content safety guidelines (CRITICAL — output filters WILL reject violations)
Both `image_prompt` and `video_prompt` are forwarded to downstream AI video models (Veo / \
Kling / Seedance — all three) whose output filters reject glamour/portrait framing. STRICT:
NEVER write any of these trigger phrases in EITHER prompt: "alone faces camera directly", \
"alone faces camera", "alone facing camera", "mouth open", "singing with mouth open", \
"singing the chorus joyfully", "sparkling eyes", "expressive eyes", "bright expressive eyes", \
"bright smile", "joyful expression", "joyful gesture", "hair lifted by a gentle breeze", \
"hair lifting in the wind", "hair lifting", "slight head sway", "rhythmic shoulder movement", \
"shoulder sway", "hands lightly raised in a joyful gesture", "eyes closed, breathing in the \
scent", "drowning in a soft pink-petal storm", "K-pop MV grade", "K-pop MV".
ALWAYS prefer cinematic alternatives: "framed in a medium close-up", "softly mouthing the \
lyrics", "soft warm expression", "subtle smile", "natural pose", "soft breeze drifts in the \
air", "hands resting naturally", "surrounded by gently drifting petals", "with a gentle \
expression", "cinematic pastel grade". Describe subjects by appearance — no allure emphasis. \
Provide sufficient cinematic context (lighting/wardrobe/background) so the scene reads as a \
film shot, not a glamour portrait.

{scenario_context}

{user_location_anchor_rule}

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
        "description": "The opening establishing moment — the city is quiet under steady drizzle, no figures yet; the world is waiting for the protagonist to enter, holding a feeling of restrained anticipation.",
        "image_prompt": "Rain-drenched city skyline at twilight, extreme wide shot, high angle...",
        "video_prompt": "Slow dolly in toward the city, gentle rain particles falling...",
        "description_ko": "도시는 잔잔한 비 아래 조용히 가라앉아 있고 아직 인물은 등장하지 않는다. 주인공의 진입을 기다리는 듯한 절제된 기대감이 흐른다.",
        "image_prompt_ko": "황혼 녘 비에 흠뻑 젖은 도시 스카이라인, 극광각 쇼트, 하이앵글…",
        "video_prompt_ko": "도시를 향해 천천히 돌리 인, 부드럽게 내리는 빗방울…",
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
- "description" (English) — 2-3 sentences of what is HAPPENING and WHY (action, micro-motion, emotional intent). NO visual composition, NO camera motion. Fed to the VIDEO model alongside image_prompt to drive subtle motion and expression.
- "image_prompt" (English) — 1-3 sentences of purely VISUAL imagery in English with specific camera/lighting/color details. No emotional adjectives — translate emotion into visible cues.
- "video_prompt" (English) — camera movement and motion details ONLY (no subject action — that lives in description).
- "description_ko" — natural Korean rendering of `description` (행동·감정·맥락), 2-3 sentences.
- "image_prompt_ko" and "video_prompt_ko" — natural Korean translation of image_prompt and video_prompt respectively. Preserve cinematography terms (shot type / camera angle / lighting / camera motion) in standard Korean visual/film vocabulary. Used ONLY for display to Korean-speaking users; downstream image/video LLM calls always use the English prompts.
- For each clip, output BOTH English (`description`, `image_prompt`, `video_prompt`) AND Korean (`description_ko`, `image_prompt_ko`, `video_prompt_ko`) versions in the same JSON object — six fields total per clip.
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
    location_name: Optional[str] = None,
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
            location_name=location_name,
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
        "user_location_anchor_rule": anchor_clause("phase1_scenes", location_name),
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

    logger.info(
        "[ReasoningOn] stage=scene_split_legacy model=%s reasoning_effort=high",
        settings.openai_model,
    )
    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        # v75 — gpt-5: temperature default(1) 만 허용 → 인자 제거. max_tokens → max_completion_tokens.
        # v75.2 — reasoning 토큰까지 한도에서 차감되므로 16000 으로 상향.
        max_completion_tokens=16000,
        reasoning_effort="high",
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

    # v56 — Ensure 6 fields per scene; backfill empty for missing _ko keys.
    # Lazy translation (GET handler) will fill them on first read.
    _v56_missing_ko = 0
    _v56_total = 0
    for _s in scenes:
        if not isinstance(_s, dict):
            continue
        _v56_total += 1
        for _k in ("description_ko", "image_prompt_ko", "video_prompt_ko"):
            if _k not in _s or _s.get(_k) is None:
                _s[_k] = ""
                _v56_missing_ko += 1
        # v60: 영어 description 도 LLM 결과 우선. 비었을 때만 image_prompt 미러링.
        _llm_desc_en = (_s.get("description") or "").strip()
        if not _llm_desc_en:
            _s["description"] = _s.get("image_prompt") or ""
    logger.info(
        "[SceneSplitParse] fields=%d missing=%d (legacy_flat)",
        _v56_total * 3, _v56_missing_ko,
    )
    if _v56_missing_ko == 0 and _v56_total > 0:
        logger.info("[SceneSplit] ko=Y en=Y count=%d", _v56_total)
    elif _v56_total > 0:
        logger.warning(
            "[SceneSplit] missing ko count=%d total_ko_slots=%d",
            _v56_missing_ko, _v56_total * 3,
        )

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
    location_name: Optional[str] = None,
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
        user_location_anchor_rule=anchor_clause("phase1_scenes", location_name),
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

    # v56: 영어+한국어 6필드 동시 출력으로 토큰 ~2배 — 씬당 500→1200.
    # v75.2 — gpt-5 는 출력 한계 ≥128k. reasoning 토큰 차감 대비 cap 32000 으로 상향.
    max_tokens = min(max(total_clips * 1200, 16000), 32000)

    logger.info(
        "[ReasoningOn] stage=scene_split_section_aware model=%s reasoning_effort=high max_completion_tokens=%d",
        settings.openai_model, max_tokens,
    )
    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        # v75 — gpt-5: temperature default(1) 만 허용 → 제거. max_tokens → max_completion_tokens.
        max_completion_tokens=max_tokens,
        reasoning_effort="high",
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

            # v60: 영어 description 은 LLM 이 만든 행동/감정/맥락 텍스트 우선.
            # 옛 잡(영어 description 없음) 호환용으로 빈 값일 때만 image_prompt 미러링.
            llm_description_en = (clip.get("description") or "").strip()
            flat_scenes.append({
                "scene_number": scene_number,
                "description": llm_description_en or image_prompt,
                "image_prompt": image_prompt,
                "video_prompt": video_prompt,
                "description_ko": clip.get("description_ko", "") or "",
                # v56 — Korean prompts (mirror of English image_prompt / video_prompt).
                # Empty default → lazy translation will fill on first GET.
                "image_prompt_ko": clip.get("image_prompt_ko", "") or "",
                "video_prompt_ko": clip.get("video_prompt_ko", "") or "",
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
    # v56 — ko fields fill diagnostic
    _v56_missing_ko = sum(
        1 for s in flat_scenes for k in ("description_ko", "image_prompt_ko", "video_prompt_ko")
        if not (s.get(k) or "").strip()
    )
    _v56_total_ko = len(flat_scenes) * 3
    logger.info(
        "[SceneSplitParse] fields=%d missing=%d (section_aware)",
        _v56_total_ko, _v56_missing_ko,
    )
    if _v56_missing_ko == 0 and flat_scenes:
        logger.info("[SceneSplit] ko=Y en=Y count=%d", len(flat_scenes))
    elif flat_scenes:
        logger.warning(
            "[SceneSplit] missing ko count=%d total_ko_slots=%d",
            _v56_missing_ko, _v56_total_ko,
        )
    return flat_scenes


# ── v37: Scene character-tag sanitizer ──────────────────────────────────────

_HANGUL_INITIAL_TO_LATIN = {
    "ㄱ": "g", "ㄲ": "kk", "ㄴ": "n", "ㄷ": "d", "ㄸ": "tt",
    "ㄹ": "r", "ㅁ": "m", "ㅂ": "b", "ㅃ": "pp", "ㅅ": "s",
    "ㅆ": "ss", "ㅇ": "", "ㅈ": "j", "ㅉ": "jj", "ㅊ": "ch",
    "ㅋ": "k", "ㅌ": "t", "ㅍ": "p", "ㅎ": "h",
}
_HANGUL_VOWEL_TO_LATIN = {
    "ㅏ": "a", "ㅐ": "ae", "ㅑ": "ya", "ㅒ": "yae", "ㅓ": "eo",
    "ㅔ": "e", "ㅕ": "yeo", "ㅖ": "ye", "ㅗ": "o", "ㅘ": "wa",
    "ㅙ": "wae", "ㅚ": "oe", "ㅛ": "yo", "ㅜ": "u", "ㅝ": "wo",
    "ㅞ": "we", "ㅟ": "wi", "ㅠ": "yu", "ㅡ": "eu", "ㅢ": "ui", "ㅣ": "i",
}
_HANGUL_FINAL_TO_LATIN = {
    "": "", "ㄱ": "k", "ㄲ": "k", "ㄳ": "k", "ㄴ": "n", "ㄵ": "n",
    "ㄶ": "n", "ㄷ": "t", "ㄹ": "l", "ㄺ": "k", "ㄻ": "m", "ㄼ": "l",
    "ㄽ": "l", "ㄾ": "l", "ㄿ": "p", "ㅀ": "l", "ㅁ": "m", "ㅂ": "p",
    "ㅄ": "p", "ㅅ": "t", "ㅆ": "t", "ㅇ": "ng", "ㅈ": "t", "ㅊ": "t",
    "ㅋ": "k", "ㅌ": "t", "ㅍ": "p", "ㅎ": "h",
}
_HANGUL_INITIALS = list(_HANGUL_INITIAL_TO_LATIN.keys())
_HANGUL_VOWELS = list(_HANGUL_VOWEL_TO_LATIN.keys())
_HANGUL_FINALS = [
    "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ",
    "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ",
    "ㅋ", "ㅌ", "ㅍ", "ㅎ",
]


def _romanize_hangul_syllable(ch: str) -> Optional[tuple]:
    """Return (initial_latin, vowel_latin, final_latin) for a single Hangul syllable, else None."""
    code = ord(ch)
    if not (0xAC00 <= code <= 0xD7A3):
        return None
    base = code - 0xAC00
    initial_idx = base // (21 * 28)
    vowel_idx = (base % (21 * 28)) // 28
    final_idx = base % 28
    return (
        _HANGUL_INITIAL_TO_LATIN[_HANGUL_INITIALS[initial_idx]],
        _HANGUL_VOWEL_TO_LATIN[_HANGUL_VOWELS[vowel_idx]],
        _HANGUL_FINAL_TO_LATIN[_HANGUL_FINALS[final_idx]],
    )


def _romanize_korean_name(name: str) -> List[str]:
    """Generate plausible romanization variants for a Korean name.

    For "한지유" returns variants like ["Han Jiyu", "Han Ji-yu", "Hanjiyu", "Jiyu"].
    Heuristic only — covers the common revised-romanization patterns; not exhaustive.
    """
    syllables = []
    for ch in name:
        rom = _romanize_hangul_syllable(ch)
        if rom is None:
            continue
        syllables.append(rom)

    if not syllables:
        return []

    parts = ["{}{}{}".format(i, v, f).capitalize() for (i, v, f) in syllables]
    if not parts:
        return []

    variants = set()
    if len(parts) >= 2:
        family = parts[0]
        given_joined = "".join(p.lower() for p in parts[1:]).capitalize()
        given_hyphen = "-".join(p.lower() for p in parts[1:])
        given_hyphen_cap = parts[1] + (("-" + "-".join(p.lower() for p in parts[2:])) if len(parts) > 2 else "")
        variants.add("{} {}".format(family, given_joined))
        variants.add("{} {}".format(family, given_hyphen))
        variants.add("{} {}".format(family, given_hyphen_cap))
        variants.add("{}{}".format(family, given_joined))
        variants.add(given_joined)
    else:
        variants.add(parts[0])

    return [v for v in variants if v]


_PROTECT_TOKEN_PREFIX = "\x00V37PROT"
_PROTECT_TOKEN_SUFFIX = "\x00"

_ROLE_PHRASES_SINGLE_CHAR = [
    "the main character",
    "the protagonist",
    "the singer",
    "the artist",
]


def _replace_whole_word(text: str, needle: str, replacement: str) -> tuple:
    """Whole-word, case-insensitive replace. Returns (count, new_text).

    The `(?<!@)` lookbehind protects already-tagged tokens like `@character1`; the
    `(?<!\\w)` / `(?!\\w)` boundaries prevent partial substring matches so we never
    rewrite the middle of an unrelated word.
    """
    if not needle:
        return 0, text
    pattern = re.compile(
        r"(?<!@)(?<!\w)" + re.escape(needle) + r"(?!\w)",
        re.IGNORECASE,
    )
    new_text, n = pattern.subn(replacement, text)
    return n, new_text


def _protect_existing_tags(text: str) -> tuple:
    """Replace `@characterN` / `@locationN` tokens with sentinels so naive replacements
    cannot corrupt them. Returns (protected_text, mapping)."""
    mapping = {}
    counter = [0]

    def _sub(m):
        token = m.group(0)
        counter[0] += 1
        key = "{}{}{}".format(_PROTECT_TOKEN_PREFIX, counter[0], _PROTECT_TOKEN_SUFFIX)
        mapping[key] = token
        return key

    protected = re.sub(r"@(?:character|location)\d+", _sub, text)
    return protected, mapping


def _restore_protected_tags(text: str, mapping: dict) -> str:
    for key, token in mapping.items():
        text = text.replace(key, token)
    return text


def sanitize_scene_character_tags(scenes: list, characters_meta: dict) -> dict:
    """Replace raw character names / role phrases with `@characterN` tokens in scene prompts.

    Idempotent: re-running on already-sanitized scenes is a no-op.

    Args:
        scenes: list of scene dicts (will be mutated in-place); each dict may have
                `image_prompt` and `video_image_prompt` string fields.
        characters_meta: mapping like `{"character1": {"name": "한지유", ...}, ...}`.

    Returns:
        Metrics dict: `{"scenes_scanned", "scenes_modified", "replacements_by_name"}`.
    """
    metrics = {
        "scenes_scanned": 0,
        "scenes_modified": 0,
        "replacements_by_name": {},
    }

    if not scenes:
        return metrics

    name_to_tag = []
    for key, info in (characters_meta or {}).items():
        if not isinstance(info, dict):
            continue
        if not isinstance(key, str) or not key.startswith("character"):
            continue
        tag = "@" + key
        raw_name = (info.get("name") or "").strip()
        variants = set()
        if raw_name:
            variants.add(raw_name)
            variants.update(_romanize_korean_name(raw_name))
        variants = sorted([v for v in variants if v], key=len, reverse=True)
        if variants:
            name_to_tag.append((tag, variants))

    single_char = len(name_to_tag) == 1
    role_phrase_tag = name_to_tag[0][0] if single_char else None

    for scene in scenes:
        metrics["scenes_scanned"] += 1
        modified = False

        for field in ("image_prompt", "video_image_prompt"):
            original = scene.get(field) or ""
            if not original:
                continue

            protected, prot_map = _protect_existing_tags(original)
            text = protected

            for tag, variants in name_to_tag:
                for variant in variants:
                    n, text = _replace_whole_word(text, variant, tag)
                    if n:
                        metrics["replacements_by_name"][variant] = (
                            metrics["replacements_by_name"].get(variant, 0) + n
                        )

            if single_char and role_phrase_tag:
                for phrase in _ROLE_PHRASES_SINGLE_CHAR:
                    n, text = _replace_whole_word(text, phrase, role_phrase_tag)
                    if n:
                        metrics["replacements_by_name"][phrase] = (
                            metrics["replacements_by_name"].get(phrase, 0) + n
                        )

            text = _restore_protected_tags(text, prot_map)

            if text != original:
                scene[field] = text
                modified = True

        if modified:
            metrics["scenes_modified"] += 1

    logger.info("v37 sanitizer applied: %s", metrics)
    return metrics


# ── 1b. Generate Scene Prompts Only (v10.0) ────────────────────────────────


SCENE_PROMPT_ONLY_SYSTEM = """\
You are an elite music video cinematographer and director of photography (DP) \
with 20 years of experience shooting award-winning music videos. \
You think in terms of lenses, light, and emotion. \
You will receive a list of scenes with their section name, duration, lyrics, and scene_type. \
Your job is ONLY to generate visual prompts for each scene. Do NOT change the scene structure.

PRIORITY OVERRIDE: If the user's `scene_prompt` (free-form direction) explicitly contradicts any rule below, follow the user's direction first.

For each scene, provide:
1. image_prompt: A comprehensive cinematic description for AI image generation (English, 2-4 sentences). \
   Must include ALL of the following elements:
2. description_ko: Korean description of the scene (2-3 sentences)
3. image_prompt_ko: A natural Korean translation of `image_prompt` (1-3 sentences). \
   Preserve cinematography terms (shot type / camera angle / lighting / camera motion / lens / depth of field) \
   in standard Korean visual/film vocabulary. This is shown ONLY to Korean-speaking users; downstream image \
   generation always uses the English `image_prompt`.
4. video_image_prompt: A scene description optimized for the target video generation model (English).
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

## ABSOLUTE RULE — PROTAGONIST INTRO SHOT (주인공샷 / 보컬샷)

When a character (especially `@character1` the protagonist/vocalist) FIRST appears in the MV:
- That scene MUST be a STATIC CLOSE-UP of the character.
- Subject motion must be MINIMAL (slight head tilt or breath OK; no walking/dancing/running).
- Only camera movement allowed: gentle zoom-in or slow dolly forward.
- This rule applies ONCE per character (their first scene only).
- From the SECOND appearance onward, the character may take any action.

Why: this establishes character identity firmly so subsequent action shots maintain visual consistency. Skipping the intro shot causes appearance drift across scenes.

══════════════════════════════════════════════════
 ABSOLUTE RULE — CHARACTER REFERENCES (NON-NEGOTIABLE):
══════════════════════════════════════════════════

In BOTH `image_prompt` AND `video_image_prompt`, you MUST refer to recurring characters \
ONLY by their variable token (`@character1`, `@character2`, …). The character sheet is \
auto-attached at image-gen time ONLY when the literal `@characterN` token appears in the \
prompt — any other form silently breaks visual consistency.

FORBIDDEN forms (NEVER write these to refer to a recurring character):
- Korean names (e.g. 한지유, 지유, 민서)
- Romanized names (e.g. Han Jiyu, Han Ji-yu, Hanjiyu, Jiyu, Minseo)
- Pronouns (she, he, her, him, they, them)
- Role labels (the singer, the main character, the artist, the protagonist, the woman, \
the man, the girl, the boy)

CORRECT example:
  "@character1 walks through a neon-lit alley, looking back over her shoulder, 35mm lens, \
shallow depth of field."

WRONG example (DO NOT EMIT):
  "Han Jiyu walks through a neon-lit alley, the singer looking back over her shoulder."

This rule is ABSOLUTE and applies to EVERY scene of EVERY scene_type. Output that violates \
it will be rejected.

For "lipsync" scenes:
- image_prompt MUST describe @character1 ALONE, facing camera directly, frontal close-up or medium close-up
- Use 50mm or 85mm lens for flattering facial proportions
- @character1 should appear to be singing or rapping with mouth open
- Do NOT include any other person in lipsync scenes (no @character2, no extras)
- Lighting should emphasize the face: key light at 45 degrees, subtle fill, hair/rim light

For "drama" scenes:
- NEVER describe the character singing, performing, or looking at the camera
- Vary lenses across drama scenes — don't use the same focal length for consecutive scenes
- Recurring characters and locations MUST appear as `@characterN` / `@locationN` tokens (see ABSOLUTE RULE above).

{scenario_context}

{user_location_anchor_rule}

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
  {{"scene_number": 1, "image_prompt": "...", "video_image_prompt": "...", "description_ko": "...", "image_prompt_ko": "한국어 image_prompt 번역..."}},
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
    video_model="veo", asset_keys=None, location_name=None,
    narrative=None, scenario_events=None, emotional_core=None,
    premise=None, character_states=None,
):
    """Build system and user messages for scene prompt generation.

    v45 additions:
        narrative: full 1500~2500자 산문 (primary context — replaces legacy `scenario`).
        scenario_events: list[dict] — event sequence to map onto scenes.
        emotional_core: overall emotional core (e.g. "그리움 60% + 후회 25% + 결심 15%").
        premise / character_states: separated fields supplied for LLM ground-truth.
    """
    # v45 — narrative 우선, 없으면 legacy scenario 본문 사용 (하위호환)
    primary_text = (narrative or scenario or "").strip()
    scenario_context_parts = []
    if primary_text:
        scenario_context_parts.append(
            "## MV NARRATIVE (primary — read this first to understand tone, motivation, emotion flow)\n{}".format(
                primary_text
            )
        )
    if premise:
        scenario_context_parts.append("## Premise\n{}".format(premise))
    if character_states and isinstance(character_states, dict):
        try:
            cs_lines = ["{}: {}".format(k, v) for k, v in character_states.items()]
            scenario_context_parts.append("## Character states\n" + "\n".join(cs_lines))
        except Exception:
            pass
    if emotional_core:
        scenario_context_parts.append("## Emotional core\n{}".format(emotional_core))

    if scenario_events and isinstance(scenario_events, list) and len(scenario_events) > 0:
        try:
            ev_json = json.dumps(scenario_events, ensure_ascii=False, indent=2)
        except Exception:
            ev_json = str(scenario_events)
        scenario_context_parts.append(
            "## EVENT-SCENE MAPPING — events to map onto scenes\n"
            "Read the narrative above carefully so you understand each event's tone, "
            "the protagonist's motivation, and the emotion shift. Then assign **the most "
            "fitting event** to each scene by output field `event_index` (0-based int "
            "into this events array, or null when no single event fits). Express each "
            "event's `motivation` and `emotion_shift` through concrete visual storytelling "
            "(specific actions, expressions, props, lighting). DO NOT just list generic "
            "verbs (walks, sits, drinks) — pick a visual that literally embodies the "
            "motivation and the emotion shift.\n\n"
            "events:\n{}".format(ev_json)
        )

    scenario_context = "\n\n".join(scenario_context_parts)

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
        user_location_anchor_rule=anchor_clause("phase1_scenes", location_name),
        video_image_prompt_guide=_get_video_image_prompt_guide(video_model),
        asset_refs_line=asset_refs_line,
    )

    # v45 — append explicit instruction that the JSON output for each scene must contain event_index.
    if scenario_events:
        system_prompt += (
            "\n\n## v45 OUTPUT REQUIREMENT (event_index)\n"
            "Each scene object in your JSON output MUST include the field "
            "`event_index` (integer 0-based into the events array above, or null). "
            "Pick the single best-fitting event for each scene and use its motivation "
            "and emotion_shift to drive the visual choices. If no event clearly fits "
            "(e.g. an instrumental establishing shot), output null."
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
    video_model="veo", asset_keys=None, location_name=None,
    narrative=None, scenario_events=None, emotional_core=None,
    premise=None, character_states=None,
):
    """Generate scene prompts using OpenAI."""
    client = _get_openai_client()
    model = model_name or settings.openai_model
    system_prompt, user_message = _build_scene_prompt_messages(
        scenes_input, title, genre, mood, scenario, user_scene_prompt,
        video_model=video_model, asset_keys=asset_keys, location_name=location_name,
        narrative=narrative, scenario_events=scenario_events,
        emotional_core=emotional_core, premise=premise,
        character_states=character_states,
    )

    # v56: 영어+한국어 6필드 동시 출력으로 토큰 ~2배 — 씬당 500→1200.
    # v75.2 — gpt-5 는 출력 한계 ≥128k. reasoning 토큰 차감 대비 cap 64000 으로 상향.
    max_tokens = min(max(len(scenes_input) * 1200, 16000), 64000)

    logger.info(
        "[ReasoningOn] stage=scene_prompts model=%s reasoning_effort=high max_completion_tokens=%d scenes=%d",
        model, max_tokens, len(scenes_input),
    )
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        # v75 — gpt-5: temperature default(1) 만 허용 → 제거. max_tokens → max_completion_tokens.
        max_completion_tokens=max_tokens,
        reasoning_effort="high",
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
    video_model="veo", asset_keys=None, location_name=None,
    narrative=None, scenario_events=None, emotional_core=None,
    premise=None, character_states=None,
):
    """Generate scene prompts using Anthropic Claude."""
    client = _get_anthropic_client()
    system_prompt, user_message = _build_scene_prompt_messages(
        scenes_input, title, genre, mood, scenario, user_scene_prompt,
        video_model=video_model, asset_keys=asset_keys, location_name=location_name,
        narrative=narrative, scenario_events=scenario_events,
        emotional_core=emotional_core, premise=premise,
        character_states=character_states,
    )

    # v56: 영어+한국어 6필드 — 씬당 1200, 64K cap (Claude 모델 한계)
    # v58.1: Anthropic SDK 가 max_tokens 큰 경우 streaming 강제 — async stream 모드로 호출
    max_tokens = min(max(len(scenes_input) * 1200, 16000), 64000)

    scene_kwargs = {
        "model": model_name,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": max_tokens,
        # v75 — adaptive thinking + high effort (stream mode; text_stream yields only text blocks).
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }
    logger.info(
        "[ThinkingOn] stage=scene_prompts model=%s effort=high max_tokens=%d",
        model_name, max_tokens,
    )
    # v58.1: streaming 모드 — chunk 누적해서 최종 텍스트 조립
    raw_parts = []
    async with client.messages.stream(**scene_kwargs) as stream:
        async for text_chunk in stream.text_stream:
            raw_parts.append(text_chunk)
    raw = "".join(raw_parts).strip()
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
    location_name: Optional[str] = None,
    narrative: Optional[str] = None,
    scenario_events: Optional[list] = None,
    emotional_core: Optional[str] = None,
    premise: Optional[str] = None,
    character_states: Optional[dict] = None,
) -> list:
    """GPT에게 씬 목록을 전달하고 image_prompt, description_ko만 받는다.

    video_prompt는 Phase 2.5에서 Gemini 2.5 Pro가 이미지를 보고 생성한다.

    v45 — narrative + scenario_events + emotional_core + premise + character_states 인자
    추가. 이들은 system prompt 의 scenario_context 블록에 함께 주입되어, scene-split LLM
    이 narrative 정독 → events 매핑 → motivation/emotion_shift 를 visual storytelling 으로
    표현하도록 안내한다. 출력 씬 객체에 `event_index` 필드 강제 (events 가 비어있지 않은
    경우).

    Args:
        scenes_input: [{"scene_number", "section", "duration", "lyrics", "scene_type"}, ...]
        title: 곡 제목
        genre: 장르
        mood: 분위기
        scenario: legacy 시나리오 본문 (하위호환 — narrative 가 None 일 때 사용).
        user_scene_prompt: 사용자 씬 지시
        models: List of model names. If None, uses default OpenAI model.
                 If contains "gpt-5.4", uses that for OpenAI call.
                 If two models given, runs both in parallel.
        video_model: Target video generation model ("veo", "kling", "seedance")
        narrative: v45 — full 1500~2500자 산문. 우선 사용 (scenario 보다).
        scenario_events: v45 — events list (event_index 매핑 대상).
        emotional_core: v45 — 곡 전체 감정 core.
        premise / character_states: v45 — 분리 필드.

    Returns:
        Single model: [{"scene_number", "image_prompt", "description_ko", "event_index"?}, ...]
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
        location_name=location_name,
        narrative=narrative,
        scenario_events=scenario_events,
        emotional_core=emotional_core,
        premise=premise,
        character_states=character_states,
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
    user_location_image_bytes: Optional[bytes] = None,
    user_location_name: Optional[str] = None,
    image_model: str = "nb_pro",
    scene_number: Optional[int] = None,
) -> bytes:
    """Generate a single scene image using Gemini. Returns PNG bytes.

    If cover_image_bytes is provided, it is included as a reference so
    that Gemini produces images in a visually consistent style.
    If character_image_bytes is provided, the character appears in the scene.
    If reference_images (list of bytes) is provided, each image is attached as
    additional inlineData (character/location sheet references resolved from
    @character1/@location1 variable references in the prompt).

    v42: When user_location_name is provided, an extra anchor clause is
    appended so the scene matches the user-specified setting. The bytes are
    typically already attached via reference_images (Phase 1.5 자산 경로);
    user_location_image_bytes serves as a safety-net only when no
    reference_images list is supplied.
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

    # v42: append user-location anchor clause whenever a name was provided
    # (Phase 1.5 already attaches the bytes via reference_images / @location1).
    if user_location_name:
        _user_loc_clause = anchor_clause("phase2_image", user_location_name)
        if _user_loc_clause:
            prompt_parts.append(_user_loc_clause)

    prompt = ". ".join(prompt_parts)

    # v55: branch by image_model. nb_pro keeps Gemini path; gpt_image_2 forwards
    # prompt + ref bytes (cover + character + reference_images + user_location)
    # to OpenAI GPT Image 2.
    logger.info(
        "[SceneImage] image_model=%s scene_number=%s",
        image_model,
        scene_number if scene_number is not None else "?",
    )
    if image_model == "gpt_image_2":
        from .openai_image import generate_image as _openai_generate_image

        _refs: list = []
        if cover_image_bytes:
            _refs.append(cover_image_bytes)
        if character_image_bytes:
            _refs.append(character_image_bytes)
        if reference_images:
            for _b in reference_images:
                if _b:
                    _refs.append(_b)
        if user_location_image_bytes and not reference_images:
            _refs.append(user_location_image_bytes)
        return await _openai_generate_image(
            prompt=prompt, ref_images=_refs or None, size="2048x2048", quality="high"
        )

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

    # v42 safety net: when caller did not provide reference_images but did
    # provide user_location_image_bytes, attach it directly so the model still
    # has the user's location PNG.
    if user_location_image_bytes and not reference_images:
        loc_b64 = base64.b64encode(user_location_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": loc_b64,
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
    description: Optional[str] = None,
) -> str:
    """Start video generation. Tries Veo 3.1 with image, falls back to Veo 2 text-only.

    v67: Veo 공식 권장 구조 — [Cinematography] + [Subject] + [Action] + [Context] + [Style&Ambiance].
    카메라는 별도 sentence 로 분리 (Veo best practice).

    Args:
        scene_description: image_prompt (cinematography + subject + context 통합)
        description:        v60 행동/감정/맥락 (Action 슬롯)
        video_prompt:       카메라 워크
        lyrics_segment:     lipsync 가사
        scene_type:         drama | lipsync
    """
    desc_clean = (description or "").strip()
    camera_text = (video_prompt or "").strip()

    if scene_type == "lipsync" and lyrics_segment:
        # Lipsync — Subject + Action(lyrics sync) + Camera 별도 + Style
        camera_line = ("The camera holds " + camera_text + ".") if camera_text else "The camera holds a gentle steady framing on the face."
        prompt = (
            "{subject} "
            "Action: The character softly mouths these lyrics with synchronized lip movements: \"{lyrics}\". "
            "{camera} "
            "Style: cinematic music video, soft natural lighting, preserve composition and colors."
        ).format(
            subject=scene_description.rstrip(". "),
            lyrics=lyrics_segment,
            camera=camera_line,
        )
    else:
        # Drama — Cinematography(이미지) + Subject 통합 + Action(description) + Camera 별도 + Style
        action_line = ("Action: " + desc_clean) if desc_clean else "Action: natural cinematic motion in the scene."
        if not action_line.endswith("."):
            action_line += "."
        camera_line = ("The camera " + camera_text + ".") if camera_text else "The camera moves smoothly with a cinematic motion."
        prompt = (
            "{subject} "
            "{action} "
            "{camera} "
            "Style: cinematic music video, soft natural lighting, preserve composition and colors."
        ).format(
            subject=scene_description.rstrip(". "),
            action=action_line,
            camera=camera_line,
        )

    import re as _re
    prompt = _re.sub(r"\s{2,}", " ", prompt).strip()

    logger.info(
        "[VeoProm] subject_len=%d action_len=%d camera_len=%d type=%s",
        len(scene_description or ""), len(desc_clean), len(camera_text), scene_type,
    )

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
