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
    user_prompt: str = None,
    prompt_model: str = None,
) -> bytes:
    """Generate album cover image using Gemini. Returns PNG bytes.

    If prompt_model is a Claude model, uses it to generate a richer prompt
    before sending to Gemini for image generation.
    """

    # ── Optional: AI-enhanced prompt via Claude ──
    enhanced_prompt = None
    if prompt_model and prompt_model.startswith("claude-"):
        from .mv_generator import _get_anthropic_client
        anthropic_client = _get_anthropic_client()

        basic_info = f'Song title: "{title}"'
        if genre:
            basic_info += f"\nGenre: {genre}"
        if mood:
            basic_info += f"\nMood: {mood}"
        if user_prompt:
            basic_info += f"\nUser direction: {user_prompt}"

        enhance_system = (
            "You are a world-class album cover art director. "
            "Given song metadata and optional user direction, write a detailed, vivid prompt "
            "for an AI image generator to create a stunning album cover. "
            "Include specific details about composition, lighting, color palette, atmosphere, and visual elements. "
            "Output ONLY the image generation prompt, nothing else. 2-4 sentences, English."
        )
        if character_image_bytes:
            enhance_system += " The cover must be photorealistic since it includes a character reference."
        else:
            enhance_system += " You may use any artistic style that fits the song's mood."
        enhance_system += " The image must NOT contain any text or letters."

        try:
            response = await anthropic_client.messages.create(
                model=prompt_model,
                max_tokens=500,
                system=enhance_system,
                messages=[{"role": "user", "content": basic_info}],
                temperature=0.8,
            )
            enhanced_prompt = response.content[0].text.strip() or None
        except Exception:
            enhanced_prompt = None  # Fall through to standard prompt building

    # If Claude generated an enhanced prompt, use it directly; otherwise build programmatically
    if enhanced_prompt:
        prompt = enhanced_prompt
    else:
        # Build prompt — two distinct paths based on character sheet usage
        prompt_parts = ["Create a beautiful album cover art image."]
        prompt_parts.append('Song title: "{}"'.format(title))
        if genre:
            prompt_parts.append("Genre: {}".format(genre))
        if mood:
            prompt_parts.append("Mood/atmosphere: {}".format(mood))

        if character_image_bytes:
            # [A] With character sheet — enforce photorealistic style
            prompt_parts.append(
                "The image MUST be in photorealistic style — like a real photograph "
                "taken with a high-end camera. Use realistic lighting, textures, and "
                "depth of field. The image should be square (1:1 aspect ratio), "
                "visually striking, suitable as a music album cover. "
                "Do NOT include any text or letters in the image."
            )
            prompt_parts.append(
                "IMPORTANT: The provided character reference sheet shows the main character. "
                "Feature this person prominently in the album cover as the main subject. "
                "Maintain the person's exact appearance (face, hair, features) from the reference. "
                "The character must be photorealistic, not illustrated or stylized."
            )
            prompt_parts.append(
                "Use cinematic photography techniques: choose an appropriate focal length "
                "(50mm for natural, 85mm for portrait, 35mm for environmental), "
                "apply professional lighting (key light, fill, rim/hair light), "
                "and use intentional depth of field to separate subject from background."
            )
            if user_prompt:
                prompt_parts.append("Additional direction: {}".format(user_prompt))
        else:
            # [B] Without character sheet — user can request any style
            if style:
                prompt_parts.append("Visual style: {}".format(style))
            prompt_parts.append(
                "The image should be square (1:1 aspect ratio), "
                "visually striking, suitable as a music album cover. "
                "Do NOT include any text or letters in the image."
            )
            prompt_parts.append(
                "Use intentional composition and artistic techniques: consider focal length, "
                "depth of field, lighting direction and quality, and color palette "
                "to create a visually compelling image."
            )
            if user_prompt:
                prompt_parts.append("Style and direction: {}".format(user_prompt))

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

    if character_image_bytes:
        system_text = (
            "You are a world-class album cover art director and photographer. "
            "You specialize in creating iconic, visually striking album covers "
            "that capture the essence of music through photorealistic imagery. "
            "You have deep expertise in composition, focal length, depth of field, "
            "lighting, color theory, and visual storytelling for the music industry."
        )
    else:
        system_text = (
            "You are a world-class album cover art director and visual artist. "
            "You specialize in creating iconic, visually striking album covers "
            "in any artistic style the user requests — photorealistic, anime, illustration, "
            "watercolor, cyberpunk, minimalist, abstract, or any other style. "
            "You have deep expertise in composition, focal length, depth of field, "
            "lighting, color theory, and visual storytelling for the music industry."
        )

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_text}]
        },
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
