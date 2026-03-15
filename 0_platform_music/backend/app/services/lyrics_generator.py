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


SYSTEM_PROMPT = """You are a professional songwriter and lyricist.
Generate song lyrics based on the user's description.

Rules:
1. Use section tags: [Verse], [Chorus], [Bridge], [Outro], [Intro], [Pre-Chorus]
2. Each section should have 2-4 lines
3. Include at least 2 verses and 1 chorus
4. Match the mood, genre, and theme described by the user
5. If the user specifies a language, write in that language. Default to Korean.
6. Keep each line concise (under 30 characters for Korean, under 60 for English)
7. Make the lyrics emotionally resonant and singable
8. Separate sections with a blank line

Output ONLY the lyrics with section tags. No explanations or commentary."""


async def generate_lyrics(
    prompt: str,
    genre: str = None,
    mood: str = None,
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
    if language == "en":
        user_message += "\nWrite lyrics in English."
    else:
        user_message += "\n한국어로 가사를 작성해주세요."

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
