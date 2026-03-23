"""
AI Cover Image Generator using Google Gemini REST API.
Generates album cover art from song metadata.

Uses httpx to call the Gemini API directly (avoids google-genai SDK
which requires Python >= 3.9).
"""
import base64

import httpx

from ..config import settings

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)


async def generate_cover_image(
    title: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    character_image_bytes: bytes = None,
) -> bytes:
    """Generate album cover image using Gemini. Returns PNG bytes."""

    # Build prompt
    prompt_parts = ["Create a beautiful album cover art image."]
    prompt_parts.append('Song title: "{}"'.format(title))
    if genre:
        prompt_parts.append("Genre: {}".format(genre))
    if mood:
        prompt_parts.append("Mood/atmosphere: {}".format(mood))
    if style:
        prompt_parts.append("Visual style: {}".format(style))
    prompt_parts.append(
        "The image MUST be in photorealistic style — like a real photograph "
        "taken with a high-end camera. Use realistic lighting, textures, and "
        "depth of field. The image should be square (1:1 aspect ratio), "
        "visually striking, suitable as a music album cover. "
        "Do NOT include any text or letters in the image."
    )

    if character_image_bytes:
        prompt_parts.append(
            "IMPORTANT: The provided character reference sheet shows the main character. "
            "Feature this person prominently in the album cover as the main subject. "
            "Maintain the person's exact appearance (face, hair, features) from the reference. "
            "The character must be photorealistic, not illustrated or stylized."
        )

    prompt = " ".join(prompt_parts)

    # Build request parts
    request_parts = [{"text": prompt}]

    if character_image_bytes:
        char_b64 = base64.b64encode(character_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": char_b64,
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
            GEMINI_API_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini API error (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()

    # Extract image from response
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini response")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])

    raise ValueError("No image generated from Gemini response")
