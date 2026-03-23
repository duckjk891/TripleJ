"""
AI Character Sheet Generator using Google Gemini REST API.
Generates photorealistic character sheet from a reference photo.
"""

import base64

import httpx

from ..config import settings

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)


async def generate_character_sheet(
    photo_bytes: bytes,
    mime_type: str = "image/jpeg",
) -> bytes:
    """Generate photorealistic character sheet from reference photo.

    Returns PNG bytes of the character sheet image.
    """
    photo_b64 = base64.b64encode(photo_bytes).decode("utf-8")

    prompt = (
        "Based on the person in this reference photo, create a photorealistic CHARACTER MODEL SHEET. "
        "The sheet MUST include the following views of the SAME person, "
        "arranged in a clean grid layout on a single image:\n\n"
        "ROW 1 — Angles:\n"
        "1. Front-facing portrait (head and shoulders)\n"
        "2. Left 3/4 profile (45-degree)\n"
        "3. Right profile (side view)\n"
        "4. Rear view (back of head and body)\n\n"
        "ROW 2 — Full Body & Poses:\n"
        "5. Full body standing pose (front, neutral)\n"
        "6. Sitting pose (casual, on a chair or stool)\n"
        "7. Walking pose (mid-stride, natural movement)\n\n"
        "ROW 3 — Expressions:\n"
        "8. Smiling / happy expression close-up\n"
        "9. Sad / melancholic expression close-up\n"
        "10. Surprised / shocked expression close-up\n"
        "11. Serious / determined expression close-up\n\n"
        "ROW 4 — Detail Close-ups & Color Palette:\n"
        "12. Hand detail close-up (both hands, fingers clearly visible, natural pose)\n"
        "13. Eye detail close-up (both eyes, iris color and shape)\n"
        "14. Lip detail close-up\n"
        "15. Color palette swatches: HAIR color, SKIN tone, EYE color, SHIRT/clothing color\n\n"
        "CRITICAL REQUIREMENTS:\n"
        "- MUST be photorealistic style — like real photographs taken with a high-end camera\n"
        "- Do NOT use anime, cartoon, illustration, or any stylized art style\n"
        "- Maintain IDENTICAL appearance (face, hair, skin tone, body type, clothing) across ALL views\n"
        "- Use neutral studio-like background (light gray or off-white)\n"
        "- High quality, sharp details, realistic lighting and shadows\n"
        "- Label each view with small text at the bottom of each cell\n"
        "- Include a SCALE indicator next to the full body view\n"
        "- Title at the top: 'CHARACTER MODEL SHEET'\n"
        "- Output as a single combined image in landscape orientation"
    )

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {
                    "inlineData": {
                        "mimeType": mime_type,
                        "data": photo_b64,
                    }
                },
            ]
        }],
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
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini response")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])

    raise ValueError("No image generated from Gemini response")
