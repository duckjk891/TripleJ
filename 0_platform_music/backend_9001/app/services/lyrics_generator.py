"""
Lyrics generation service using OpenAI ChatGPT API.
Takes a user prompt and generates structured lyrics with section tags.
"""

from openai import AsyncOpenAI

from ..config import settings

_client = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


SYSTEM_PROMPT = """You are a professional songwriter specializing in writing lyrics optimized for Suno AI music generation.

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
"""


async def generate_lyrics(
    prompt: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    duration_minutes: int = 2,
    language: str = "ko",
) -> dict:
    """
    Generate lyrics from a user prompt using ChatGPT.

    Returns:
        dict with 'lyrics' (str) and 'title' (str)
    """
    client = _get_client()

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

    # 음악 길이에 따른 가사 분량 가이드
    duration_guide = {
        1: "약 1분 분량의 가사를 작성해주세요. 최소 구성: Intro + Verse 1개 + Chorus + Outro.",
        2: "약 2분 분량의 가사를 작성해주세요. 최소 구성: Intro + Verse 2개 + Chorus 반복 + Outro. 가사를 충분히 길게 작성해주세요.",
        3: "약 3분 분량의 충분히 긴 가사를 작성해주세요. 최소 구성: Intro + Verse 3개 이상 + Pre-Chorus + Chorus 반복 + Bridge + Outro. 각 섹션의 가사를 3~4줄로 충분히 작성해주세요.",
    }
    guide = duration_guide.get(duration_minutes, duration_guide[2])
    user_message += f"\n{guide}"

    # Generate lyrics
    lyrics_response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        temperature=0.8,
        max_tokens=1500,
    )

    lyrics = lyrics_response.choices[0].message.content.strip()

    # Generate title
    title_response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {
                "role": "system",
                "content": "Generate a short, catchy song title (1-5 words) for the following lyrics. "
                "Output ONLY the title, nothing else. Match the language of the lyrics.",
            },
            {"role": "user", "content": lyrics},
        ],
        temperature=0.7,
        max_tokens=50,
    )

    title = title_response.choices[0].message.content.strip().strip('"\'')

    return {
        "title": title,
        "lyrics": lyrics,
    }
