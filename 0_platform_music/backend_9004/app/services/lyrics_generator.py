"""
Lyrics generation service using OpenAI ChatGPT API and Anthropic Claude API.
Takes a user prompt and generates structured lyrics with section tags.
Supports model selection: single model or dual-model comparison.
"""

import asyncio
import json
import logging

import anthropic
from openai import AsyncOpenAI

from ..config import settings
from ..constants.categories import CATEGORIES, CATEGORY_SET

logger = logging.getLogger(__name__)

# 프롬프트에 그대로 박을 고정 카테고리 목록 문자열.
_CATEGORIES_PROMPT_LIST = ", ".join(CATEGORIES)

_client = None
_anthropic_client = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def _first_text_block(resp) -> str:
    """v75 — Anthropic adaptive-thinking 응답의 첫 text 블록을 안전 추출.

    `content` 가 `[ThinkingBlock, TextBlock]` 순서일 때 `content[0].text` 가
    깨지는 회귀를 막는다. thinking 비활성 응답에서도 동일 동작.
    """
    try:
        for block in getattr(resp, "content", []) or []:
            if getattr(block, "type", None) == "text":
                return (getattr(block, "text", None) or "")
    except Exception:
        return ""
    return ""


SYSTEM_PROMPT_SOLO = """You are a professional songwriter specializing in writing lyrics optimized for Suno AI music generation.

## OUTPUT FORMAT
Output ONLY the lyrics with Suno-compatible metatags. No explanations, no commentary.

## SECTION TAGS (Required)
Use these Suno metatags to structure the song:
- [Intro] - Opening (instrumental or short vocal)
- [Verse] or [Verse 1], [Verse 2] - Main story sections
- [Pre-Chorus] - Tension builder before chorus
- [Chorus] - The hook, most memorable part
- [Bridge] - Contrast section, new perspective
- [Outro] - Closing section
- [Hook] - Short, catchy phrase
- [Break] - Pause in rhythm
- [Interlude] - Musical passage between sections

## VOCAL DIRECTION IN TAGS (Recommended)
Add vocal style hints inside section tags to guide Suno's vocal performance:
- [Verse: soft, whispered] - Gentle, intimate delivery
- [Chorus: belting, powerful] - Full voice, emotional peak
- [Bridge: falsetto, airy] - Light, high register
- [Verse: spoken word] - Rap or spoken delivery
- [Chorus: harmonized, layered] - Multi-voice chorus effect
- [Outro: fading, gentle hum] - Soft fade out

Choose vocal directions that match the genre and mood naturally.

## PERFORMANCE HINTS (Use sparingly in lyrics)
Place these inline within lyrics for Suno vocal effects:
- (ad-lib) - Improvised vocal fills
- (harmonize) - Harmony vocal layer
- (whisper) - Whispered delivery
- (spoken) - Spoken word, not sung
- (falsetto) - High register vocal
- (echo) - Echo/reverb effect feel

## GENRE-SPECIFIC GUIDELINES
Match the lyrics structure and language style to the genre:
- **발라드/Ballad**: Lyrical, emotional, flowing sentences. Focus on heartfelt storytelling. Use [Verse]-[Pre-Chorus]-[Chorus]-[Bridge] structure.
- **K-Pop/Pop**: Catchy, repetitive chorus hooks. Mix Korean with occasional English phrases. Add [Hook] sections. Use rhythmic syllable patterns.
- **Hip-hop/Rap**: Strong rhyme schemes, wordplay, rhythmic flow. Use [Verse: rap flow] tag. Include internal rhymes and syllable-dense lines.
- **Rock/Metal**: Raw, powerful lyrics. Direct emotional expression. Use [Chorus: belting, raw] for intense sections.
- **Electronic/Lo-fi/Ambient**: Minimalist, atmospheric lyrics. Short phrases, repetitive patterns. Fewer sections, more [Interlude] and [Break].
- **R&B/Soul**: Smooth, melodic flow. Romantic or introspective themes. Use [Verse: smooth, silky] and [Chorus: soulful].
- **Jazz/Folk/Indie**: Poetic, narrative-driven. Storytelling focus. Longer verses, unique metaphors.

## MOOD GUIDELINES
Adjust tone and word choice based on mood:
- **Energetic/Happy/Funky**: Upbeat vocabulary, exclamations, dynamic rhythm
- **Chill/Peaceful/Dreamy**: Soft imagery, nature metaphors, calm pacing
- **Dark/Aggressive**: Intense imagery, sharp consonants, urgent pacing
- **Sad/Nostalgic**: Past tense reflections, longing, gentle pain
- **Epic/Cinematic**: Grand scale imagery, building intensity, dramatic arcs
- **Romantic**: Intimate details, warmth, tender expressions

## STRUCTURAL RULES
1. Each section: 2-4 lines
2. Minimum structure: [Intro] + 2x[Verse] + [Pre-Chorus] + [Chorus] + [Bridge] + [Outro]
3. Keep each line concise: under 25 characters for Korean, under 50 for English
4. Total lyrics must stay under 3000 characters (Suno limit)
5. Separate sections with a blank line
6. Do NOT include any text outside of section tags and lyrics
7. Make lyrics emotionally resonant, singable, and rhythmically natural
8. If language is Korean, write primarily in Korean with occasional English OK for K-Pop/Pop genres

## OUTPUT — RETURN A SINGLE JSON OBJECT ONLY
Output EXACTLY one JSON object and nothing else (no markdown, no code fences, no commentary).
The object MUST have these keys:
{
  "title": "a short, catchy song title (1-5 words), matching the lyrics language",
  "lyrics": "the full lyrics including the Suno section tags ([Verse], [Chorus], etc.) and line breaks as \\n",
  "categories": ["...selected from the fixed list below..."]
}

### categories rules
- Choose ONLY from this fixed list (use the EXACT Korean strings, copy them verbatim):
  {categories}
- Base your choice on the lyrics, the song description/prompt, the genre, and the mood.
- Pick however many fit — you may pick zero, one, or several. Do NOT invent new categories or translate them.
- "categories" must be a JSON array of strings (use [] if none fit).

Put the full lyrics (with all section tags and newlines) inside the "lyrics" string. Do NOT place anything outside the JSON object.
"""


SYSTEM_PROMPT_DUET = """You are a professional songwriter specializing in writing DUET lyrics optimized for Suno AI music generation.

## OUTPUT FORMAT
The song MUST start with this exact line:
[This song is a duet featuring one male vocalist and one female vocalist]
===

Then output the lyrics. No explanations, no commentary.

## CRITICAL: LINE-BY-LINE VOCAL LABELS
Every lyric line MUST start with [Female], [Male], or [Both] label. This is the most important rule.

Example:
[Verse]
[Female] 오늘도 너를 생각해
[Female] 바람이 불어오는 거리에서

[Verse]
[Male] 나도 같은 하늘 아래
[Male] 너를 떠올리고 있어

[Chorus]
[Both] 함께라면 괜찮아
[Both] 우리 둘이 함께라면

## SECTION TAGS
Use standard section tags WITHOUT vocalist specification:
- [Intro]
- [Verse]
- [Pre-Chorus]
- [Chorus]
- [Bridge]
- [Outro]

Do NOT put vocalist info in section tags. Put [Female], [Male], [Both] at the start of each lyric line instead.

## DUET STRUCTURE RULES
1. Male and female parts should alternate naturally across verses
2. Chorus lines should mostly use [Both]
3. Bridge can be either voice for contrast
4. Each section: 2-4 lines
5. Minimum structure: [Intro] + [Verse] + [Verse] + [Pre-Chorus] + [Chorus] + [Verse] + [Chorus] + [Bridge] + [Chorus] + [Outro]
6. Keep each line concise: under 25 characters for Korean, under 50 for English
7. Total lyrics must stay under 3000 characters (Suno limit)
8. Separate sections with a blank line
9. Do NOT include vocal style hints (soft, warm etc.) in the lyrics — those go in the style field

## GENRE-SPECIFIC GUIDELINES
- **발라드/Ballad**: Emotional duet conversation. He-said-she-said storytelling.
- **K-Pop/Pop**: Catchy hooks with call-and-response between voices.
- **R&B/Soul**: Smooth alternating vocals with harmonized chorus.
- **Rock**: Powerful alternating verses building to combined chorus.

## LANGUAGE
If language is Korean, write primarily in Korean with occasional English OK for K-Pop/Pop genres.

## OUTPUT — RETURN A SINGLE JSON OBJECT ONLY
Output EXACTLY one JSON object and nothing else (no markdown, no code fences, no commentary).
The object MUST have these keys:
{
  "title": "a short, catchy song title (1-5 words), matching the lyrics language",
  "lyrics": "the full duet lyrics: the required leading '[This song is a duet...]\\n===' line, all section tags ([Verse], [Chorus], etc.), and every lyric line prefixed with [Female]/[Male]/[Both], with line breaks as \\n",
  "categories": ["...selected from the fixed list below..."]
}

### categories rules
- Choose ONLY from this fixed list (use the EXACT Korean strings, copy them verbatim):
  {categories}
- Base your choice on the lyrics, the song description/prompt, the genre, and the mood.
- Pick however many fit — you may pick zero, one, or several. Do NOT invent new categories or translate them.
- "categories" must be a JSON array of strings (use [] if none fit).

Put the full lyrics (duet header line + section tags + per-line vocal labels + newlines) inside the "lyrics" string. Do NOT place anything outside the JSON object.
"""


def _system_prompt_for(duet: bool) -> str:
    """Return the system prompt with the fixed category list injected.

    The base prompts contain a literal ``{categories}`` token which we replace
    via ``str.replace`` (not ``.format``, since the prompt body contains literal
    JSON braces).
    """
    base = SYSTEM_PROMPT_DUET if duet else SYSTEM_PROMPT_SOLO
    return base.replace("{categories}", _CATEGORIES_PROMPT_LIST)


def _parse_lyrics_json(raw_text: str) -> dict:
    """Defensively parse the LLM's JSON output into clean fields.

    Steps:
      1. strip code fences (```json ... ```)
      2. slice from the first '{' to the last '}'
      3. json.loads; on failure, retry once after removing trailing commas
      4. fallback to {"title": "", "lyrics": raw, "categories": []} if all fail
      5. coerce title/lyrics to strings (defaults when missing)
      6. intersect categories with CATEGORY_SET (dedupe, preserve order)

    Never raises — always returns a usable dict.
    """
    raw = (raw_text or "").strip()

    # 1) strip code fences
    text = raw
    if text.startswith("```"):
        # drop the opening fence line (``` or ```json) and a trailing fence
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl + 1:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    text = text.strip()

    # 2) slice first { .. last }
    start = text.find("{")
    end = text.rfind("}")
    candidate = text[start:end + 1] if (start != -1 and end != -1 and end > start) else text

    parse_ok = True
    parsed = None
    try:
        parsed = json.loads(candidate)
    except Exception:
        # 3) retry after a light correction: remove trailing commas before } or ]
        import re as _re
        repaired = _re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            parsed = json.loads(repaired)
        except Exception:
            parse_ok = False
            parsed = None

    if not isinstance(parsed, dict):
        # 4) fallback — treat the whole thing as raw lyrics
        parse_ok = False
        parsed = {"title": "", "lyrics": raw, "categories": []}

    # 5) coerce title/lyrics to strings
    title = parsed.get("title")
    title = title.strip() if isinstance(title, str) else ""
    lyrics = parsed.get("lyrics")
    if isinstance(lyrics, str):
        lyrics = lyrics.strip()
    else:
        # lyrics missing/non-string → fall back to raw text so we never lose output
        lyrics = raw if not parse_ok else ""

    # 6) whitelist + dedupe categories, preserve order
    raw_cats = parsed.get("categories")
    categories = []
    if isinstance(raw_cats, list):
        seen = set()
        for c in raw_cats:
            if isinstance(c, str):
                c = c.strip()
                if c in CATEGORY_SET and c not in seen:
                    seen.add(c)
                    categories.append(c)

    return {
        "title": title,
        "lyrics": lyrics,
        "categories": categories,
        "_parse_ok": parse_ok,
    }


def _build_user_message(
    prompt: str, genre: str, mood: str, style: str,
    duration_minutes: int, duet: bool,
    duet_main_vocal_style: str, duet_sub_vocal_style: str,
    language: str,
) -> str:
    """Build user message for lyrics generation (shared by OpenAI and Claude paths)."""
    user_message = f"곡 설명: {prompt}"
    if genre:
        user_message += f"\n장르: {genre}"
    if mood:
        user_message += f"\n분위기: {mood}"
    if style:
        user_message += f"\n스타일: {style}"
    if language == "en":
        user_message += "\nWrite lyrics in English."
    else:
        user_message += "\n한국어로 가사를 작성해주세요."

    duration_guide = {
        1: "약 1분 분량의 가사를 작성해주세요. 최소 구성: Intro + Verse 1개 + Chorus + Outro.",
        2: "약 2분 분량의 가사를 작성해주세요. 최소 구성: Intro + Verse 2개 + Chorus 반복 + Outro. 가사를 충분히 길게 작성해주세요.",
        3: "약 3분 분량의 충분히 긴 가사를 작성해주세요. 최소 구성: Intro + Verse 3개 이상 + Pre-Chorus + Chorus 반복 + Bridge + Outro. 각 섹션의 가사를 3~4줄로 충분히 작성해주세요.",
    }
    guide = duration_guide.get(duration_minutes, duration_guide[2])
    user_message += f"\n{guide}"

    if duet and (duet_main_vocal_style or duet_sub_vocal_style):
        user_message += "\n\n듀엣 보컬 가이드:"
        if duet_main_vocal_style:
            user_message += f"\n- 주 보컬 느낌: {duet_main_vocal_style} (이 느낌에 맞는 파트를 배분해주세요)"
        if duet_sub_vocal_style:
            user_message += f"\n- 상대 보컬 느낌: {duet_sub_vocal_style} (이 느낌에 맞는 파트를 배분해주세요)"

    return user_message


async def _generate_lyrics_openai(
    prompt: str, genre: str, mood: str, style: str,
    duration_minutes: int, duet: bool,
    duet_main_vocal_style: str, duet_sub_vocal_style: str,
    language: str,
    model_name: str = None,
) -> dict:
    """Generate lyrics using OpenAI ChatGPT."""
    client = _get_client()
    model = model_name or settings.openai_model

    system_prompt = _system_prompt_for(duet)
    user_message = _build_user_message(
        prompt, genre, mood, style, duration_minutes, duet,
        duet_main_vocal_style, duet_sub_vocal_style, language,
    )

    logger.info(
        "[ReasoningOn] stage=lyrics_json model=%s reasoning_effort=high",
        model,
    )
    # v77 — 단일 호출로 title+lyrics+categories 를 JSON 한 번에 산출.
    # response_format=json_object 로 JSON 강제 (지원 모델). 미지원 시 시스템프롬프트가 백업.
    try:
        lyrics_response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
            # v75 — gpt-5: temperature default(1) 만 허용 → 제거. max_tokens → max_completion_tokens.
            # v75.2 — reasoning 토큰까지 한도에서 차감되므로 16000 으로 상향.
            max_completion_tokens=16000,
            reasoning_effort="high",
        )
    except Exception as e:
        # response_format 미지원 등으로 실패하면 JSON 강제 없이 재시도(프롬프트로만 JSON 유도).
        logger.warning(
            "[lyrics] model=%s json_object request failed (%s); retrying without response_format",
            model, str(e)[:120],
        )
        lyrics_response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            max_completion_tokens=16000,
            reasoning_effort="high",
        )

    raw = (lyrics_response.choices[0].message.content or "").strip()
    parsed = _parse_lyrics_json(raw)

    log = logger.warning if not parsed["_parse_ok"] else logger.info
    log(
        "[lyrics] model=%s parse_ok=%s cats=%s lyrics_len=%d",
        model, parsed["_parse_ok"], parsed["categories"], len(parsed["lyrics"]),
    )

    return {
        "title": parsed["title"],
        "lyrics": parsed["lyrics"],
        "categories": parsed["categories"],
        "model": model,
    }


async def _generate_lyrics_claude(
    prompt: str, genre: str, mood: str, style: str,
    duration_minutes: int, duet: bool,
    duet_main_vocal_style: str, duet_sub_vocal_style: str,
    language: str,
    model_name: str = "claude-opus-4-6",
) -> dict:
    """Generate lyrics using Anthropic Claude."""
    client = _get_anthropic_client()
    model = model_name

    system_prompt = _system_prompt_for(duet)
    user_message = _build_user_message(
        prompt, genre, mood, style, duration_minutes, duet,
        duet_main_vocal_style, duet_sub_vocal_style, language,
    )

    # v77 — 단일 호출로 title+lyrics+categories 를 JSON 한 번에 산출.
    # Claude 는 response_format 미지원 → 시스템프롬프트로 JSON 강제.
    # v161 — system 전체가 고정(카테고리 리스트 포함 상수)이므로 1블록 + cache_control.
    # 실측 ~1.2-1.5k tok < opus-4-6 최소 4096 → 캐싱 비적용(길이 미달) 예상이나
    # 마커는 무과금·무해 — 모델 상향 시 자동 활성. [cache] 로그의 create=0 이 증거.
    from .claude_cache import cached_system, log_cache_usage

    lyrics_kwargs = {
        "model": model,
        "system": cached_system(system_prompt),
        "messages": [{"role": "user", "content": user_message}],
        # v75.2 — adaptive thinking 토큰까지 한도에서 차감되므로 16000 으로 상향.
        "max_tokens": 16000,
        # v75 — adaptive thinking + high effort.
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }
    logger.info(
        "[ThinkingOn] stage=lyrics_json model=%s effort=high",
        model,
    )
    lyrics_response = await client.messages.create(**lyrics_kwargs)
    log_cache_usage("lyrics_json", model, getattr(lyrics_response, "usage", None))

    raw = _first_text_block(lyrics_response).strip()
    parsed = _parse_lyrics_json(raw)

    log = logger.warning if not parsed["_parse_ok"] else logger.info
    log(
        "[lyrics] model=%s parse_ok=%s cats=%s lyrics_len=%d",
        model, parsed["_parse_ok"], parsed["categories"], len(parsed["lyrics"]),
    )

    return {
        "title": parsed["title"],
        "lyrics": parsed["lyrics"],
        "categories": parsed["categories"],
        "model": model,
    }


async def generate_lyrics(
    prompt: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    duration_minutes: int = 2,
    duet: bool = False,
    duet_main_vocal_style: str = None,
    duet_sub_vocal_style: str = None,
    language: str = "ko",
    models: list = None,
) -> dict:
    """
    Generate lyrics from a user prompt.

    Args:
        models: List of model names to use. If None or empty, uses default OpenAI model.
                 Supported: "gpt-4o-mini", "claude-opus-4-6", etc.
                 If two models given, runs both in parallel and returns comparison results.

    Returns:
        Single model: {"title": ..., "lyrics": ..., "categories": [...], "model": "gpt-4o-mini"}
        Both models: {"results": [{"title":..., "lyrics":..., "categories":[...], "model":"gpt-4o-mini"}, {...}]}
        categories is always a list filtered against the fixed 10-item whitelist.
    """
    common_args = dict(
        prompt=prompt,
        genre=genre,
        mood=mood,
        style=style,
        duration_minutes=duration_minutes,
        duet=duet,
        duet_main_vocal_style=duet_main_vocal_style,
        duet_sub_vocal_style=duet_sub_vocal_style,
        language=language,
    )

    # Default behavior: use existing OpenAI model (backward compatible)
    if not models:
        result = await _generate_lyrics_openai(**common_args)
        return result

    def _make_task(model_name: str):
        if model_name.startswith("claude-"):
            return _generate_lyrics_claude(**common_args, model_name=model_name)
        else:
            return _generate_lyrics_openai(**common_args, model_name=model_name)

    if len(models) == 1:
        return await _make_task(models[0])

    # Two models: run in parallel
    results = await asyncio.gather(
        _make_task(models[0]),
        _make_task(models[1]),
        return_exceptions=True,
    )

    # Filter out exceptions, return successful results
    valid_results = []
    for r in results:
        if isinstance(r, Exception):
            continue
        valid_results.append(r)

    if len(valid_results) == 0:
        raise RuntimeError("All model calls failed")
    if len(valid_results) == 1:
        return valid_results[0]

    return {"results": valid_results}
