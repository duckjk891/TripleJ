"""
v17.3 — Pre-MV Phase 3 영상 프롬프트 템플릿 (4개 모델).

9004 의 `mv_generator.py` 에 있는 4개 `VIDEO_PROMPT_*_CHARACTER` 시스템 템플릿을
그대로 이식한 뒤, **신랑+신부 두 명을 동시에 다루는 식전영상 컨텍스트에 맞춰
복수 표현 보강 문장**을 prompt 합성부에서 prepend/append.

`compose_video_prompt(...)` 가 모델별 최종 영문 prompt 문자열을 반환한다.
- system 템플릿 자체는 video LLM 호출용이 아니라, 안전·구조 가이드(사람이 읽기 용)다.
- 실제 모델 호출에 들어가는 prompt 본문은 각 generator 가 만든다 — 이 모듈은
  pipeline-level 의 "복수 인물 보강 + 안전 어휘 가이드" 문장만 prompt 앞뒤로 끼워 넣어 준다.

추적자: 모델별 generator 가 prompt_len 만 로깅. 내용 자체는 로깅하지 않는다.

FREE(no-character) 변형은 본 모듈에 두지 않는다 — 식전영상은 항상 신랑/신부 중
최소 한 명 이상이 포함되도록 Phase 1 에서 보장되었기 때문 (사용자 합의 v17.3).
"""

from __future__ import annotations

import re as _re
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────
# 9004 이식 — VIDEO_PROMPT_*_CHARACTER 4종 (원본 그대로)
# 식전영상 컨텍스트에선 the bride and the groom 둘 다 처리해야 하므로 본 템플릿의
# "the main character / the subject" 표기는 보강 문장에서 명시적으로 두 인물을 다룬다.
# ──────────────────────────────────────────────────────────────────────────

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


# ──────────────────────────────────────────────────────────────────────────
# 복수 인물 보강 문장 (single character → bride+groom 두 명).
# 신랑·신부 둘 다 보여야 하는 식전영상 컨텍스트에서, 4개 템플릿 안의
# "the main character / the subject" 표현이 단수로 해석되지 않도록
# 모델에 직접 가는 prompt 의 앞쪽에 prepend 한다.
# ──────────────────────────────────────────────────────────────────────────

PLURAL_REINFORCEMENT_BOTH = (
    "Subjects: the bride and the groom — both must visually match their reference sheets, "
    "including wardrobe, hair, and facial identity. Keep their composition consistent and "
    "treat them as the two main subjects of this clip."
)

PLURAL_REINFORCEMENT_BRIDE_ONLY = (
    "Subject: the bride — she must visually match her reference sheet, including wardrobe and "
    "hair. Do not introduce another person who is not visible in the scene image."
)

PLURAL_REINFORCEMENT_GROOM_ONLY = (
    "Subject: the groom — he must visually match his reference sheet, including wardrobe and "
    "hair. Do not introduce another person who is not visible in the scene image."
)


def _reinforcement_for_scene(scene: dict) -> str:
    """ref_sheet_ids 로 신랑/신부 동시/한 명 여부를 파악해 보강 문장 선택."""
    refs = list((scene or {}).get("ref_sheet_ids") or [])
    has_groom = any((r or "").startswith("groom_") for r in refs)
    has_bride = any((r or "").startswith("bride_") for r in refs)
    if has_groom and has_bride:
        return PLURAL_REINFORCEMENT_BOTH
    if has_bride:
        return PLURAL_REINFORCEMENT_BRIDE_ONLY
    if has_groom:
        return PLURAL_REINFORCEMENT_GROOM_ONLY
    # ref 시트 정보가 없으면 기본은 둘 다 — Phase 1 에서 최소 한 명 보장.
    return PLURAL_REINFORCEMENT_BOTH


# ──────────────────────────────────────────────────────────────────────────
# 모델별 prompt 합성
#
# generator 가 실제 API body 의 prompt 필드에 채워 넣는 문자열을 만든다.
# 9004 generator 들이 쓰던 합성 골격을 따르되, "복수 인물 보강" 문장을 가장 앞에
# prepend 하여 모델이 "subject = single" 로 오해하지 않도록 한다.
# ──────────────────────────────────────────────────────────────────────────

def _clean(text: Optional[str]) -> str:
    return (text or "").strip()


def _collapse_ws(text: str) -> str:
    return _re.sub(r"\s{2,}", " ", text or "").strip()


def compose_video_prompt(
    *,
    video_model: str,
    scene: dict,
    duration: float,
) -> str:
    """모델별 영상 API 에 들어갈 최종 prompt 문자열.

    Args:
      video_model:  "veo" | "kling" | "seedance" | "grok".
      scene:        pre_mv_jobs.scenes[N-1] 원소.
                    필수: image_prompt(영문), description(영문), video_prompt(영문),
                          use_seconds, ref_sheet_ids.
      duration:     실제 영상 모델에 요청할 길이(초) — 모델별 클램프 후 값.

    Returns:
      모델 호출용 prompt 문자열. 1단락 영문.
    """
    image_prompt = _clean(scene.get("image_prompt"))
    description = _clean(scene.get("description"))
    video_prompt = _clean(scene.get("video_prompt"))
    reinforcement = _reinforcement_for_scene(scene)

    # 공통 prefix: 두 인물 보강 + 컨텍스트(MV scene) — 모든 모델 동일.
    prefix = (
        "A cinematic wedding pre-roll music-video scene. {plural}"
    ).format(plural=reinforcement)

    if video_model == "veo":
        # Veo — natural director language.
        action_line = ("Action: " + description) if description else (
            "Action: natural cinematic motion in the scene."
        )
        if not action_line.endswith("."):
            action_line += "."
        camera_line = ("The camera " + video_prompt) if video_prompt else (
            "The camera moves smoothly with a cinematic motion"
        )
        if not camera_line.endswith("."):
            camera_line += "."
        body = (
            "{prefix} "
            "Subject and Context: {image} "
            "{action} "
            "{camera} "
            "Style: cinematic wedding film, soft natural lighting, "
            "warm pastel color grade, preserve composition and colors."
        ).format(
            prefix=prefix,
            image=image_prompt or "(see reference image)",
            action=action_line,
            camera=camera_line,
        )
        return _collapse_ws(body)

    if video_model == "kling":
        # Kling — 6-slot, technical shot-list.
        movement_line = ("Subject action: " + description + ".") if description else ""
        camera_line = ("Camera: " + video_prompt + ".") if video_prompt else (
            "Camera: smooth cinematic movement."
        )
        body = (
            "{prefix} "
            "Subject: {image} "
            "{movement} "
            "{camera} "
            "Lighting: soft natural light with warm pastel grade. "
            "Preserve composition and colors of the reference image."
        ).format(
            prefix=prefix,
            image=image_prompt or "(see reference image)",
            movement=movement_line,
            camera=camera_line,
        )
        return _collapse_ws(body)

    if video_model == "seedance":
        # Seedance — 6-step + Constraints.
        action_line = ("Action: " + description + ".") if description else (
            "Action: natural cinematic motion in the scene."
        )
        camera_line = ("Camera: " + video_prompt + ".") if video_prompt else (
            "Camera: smooth cinematic movement."
        )
        body = (
            "{prefix} "
            "Subject and Scene: {image} "
            "{action} "
            "{camera} "
            "Style: cinematic pastel grade, soft natural wedding lighting, "
            "preserve composition and colors. "
            "Constraints: no text, no watermark, no glamour portrait framing."
        ).format(
            prefix=prefix,
            image=image_prompt or "(see reference image)",
            action=action_line,
            camera=camera_line,
        )
        return _collapse_ws(body)

    if video_model == "grok":
        # Grok — 앞 20단어 우선 (motion-first), image-to-video 라 묘사 X.
        motion_first = description or "Natural cinematic motion between the bride and groom."
        camera_line = ("Camera: " + video_prompt + ".") if video_prompt else (
            "Camera: smooth cinematic movement."
        )
        body = (
            "{plural} {motion} {camera} "
            "Style: cinematic wedding film, soft natural lighting, warm pastel grade, "
            "preserve composition and colors. Avoid glamour portrait framing."
        ).format(
            plural=reinforcement,
            motion=motion_first,
            camera=camera_line,
        )
        return _collapse_ws(body)

    raise ValueError("unsupported video_model: {}".format(video_model))


# 호출자가 video_prompt 의 안전 어휘 점검에 쓸 수 있는 트리거 문구 셋 (참고용).
SAFETY_TRIGGER_PHRASES = (
    "alone faces camera directly",
    "alone faces camera",
    "alone facing camera",
    "mouth open",
    "singing with mouth open",
    "singing the chorus joyfully",
    "sparkling eyes",
    "expressive eyes",
    "bright expressive eyes",
    "bright smile",
    "joyful expression",
    "joyful gesture",
    "hair lifted by a gentle breeze",
    "hair lifting in the wind",
    "hair lifting",
    "slight head sway",
    "rhythmic shoulder movement",
    "shoulder sway",
    "hands lightly raised in a joyful gesture",
    "eyes closed, breathing in the scent",
    "drowning in a soft pink-petal storm",
    "K-pop MV grade",
    "K-pop MV",
)


def sanitize_for_seedance(prompt: str) -> str:
    """Seedance filter 가 가장 엄격 — 알려진 트리거 문구를 안전 어휘로 치환.

    출력 길이 변화는 미미 (각 트리거 → 신중한 대체어). 9004 의 sanitize 패턴 단순화.
    """
    if not prompt:
        return ""
    out = prompt
    replacements = {
        "alone faces camera directly": "framed in a medium close-up",
        "alone faces camera": "framed in a medium close-up",
        "alone facing camera": "framed in a medium close-up",
        "singing with mouth open": "softly mouthing the lyrics",
        "singing the chorus joyfully": "softly mouthing the lyrics",
        "mouth open": "softly mouthing",
        "sparkling eyes": "soft warm expression",
        "bright expressive eyes": "soft warm expression",
        "expressive eyes": "soft warm expression",
        "bright smile": "subtle smile",
        "joyful expression": "warm expression",
        "joyful gesture": "natural gesture",
        "hair lifted by a gentle breeze": "soft breeze drifts in the air",
        "hair lifting in the wind": "soft breeze drifts in the air",
        "hair lifting": "soft breeze drifts in the air",
        "slight head sway": "natural pose",
        "rhythmic shoulder movement": "natural pose",
        "shoulder sway": "natural pose",
        "hands lightly raised in a joyful gesture": "hands resting naturally",
        "eyes closed, breathing in the scent": "with a gentle expression",
        "drowning in a soft pink-petal storm": "surrounded by gently drifting petals",
        "K-pop MV grade": "cinematic pastel grade",
        "K-pop MV": "cinematic music video",
    }
    for needle, repl in replacements.items():
        out = _re.sub(_re.escape(needle), repl, out, flags=_re.IGNORECASE)
    return _collapse_ws(out)
