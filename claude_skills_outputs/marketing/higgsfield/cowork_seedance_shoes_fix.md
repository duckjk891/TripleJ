# 채팅 생성 지시서 — L22 「둠칫, 내일도 시작해」 운동화 벗기 장면 다시 만들기 (2026-11-12)

- 자리: 아웃트로 첫 장면, 노래 190.91–194.25초(약 3.3초). 바로 뒤가 거울 하이파이브(194.25초~)예요.
- 고칠 점: 지금 장면(C22 앞부분)은 현관 전체를 멀리서 찍어서 인물이 작고, **얼굴이 선명하지 않아요**. 첫 0.3초에 카메라가 빠르게 줌아웃되는 문제도 있었어요.
  → **얼굴이 크게 보이는 가까운 화면(무릎~머리)**, 카메라는 거의 고정(줌아웃 없음)으로 바꿔요.
- 규칙은 `cowork_seedance_brief_v2.md`와 같아요. MCP 도구로만 생성하고, `use_unlim: true`가 거절되면 크레딧으로 다시 보내지 말고 멈춰요. 노래·음성 파일은 올리지 않아요.

## generate_video params
```json
{
  "model": "seedance_2_5",
  "mode": "omni_reference",
  "duration": 4,
  "resolution": "480p",
  "aspect_ratio": "16:9",
  "generate_audio": false,
  "bitrate_mode": "high",
  "use_unlim": true,
  "medias": [
    {"value": "ea27b530-5eaf-4890-a1dd-b906bd90213f", "role": "image_references"},
    {"value": "f83026d6-36f6-43a2-9df5-54faa55e9865", "role": "image_references"},
    {"value": "73e07797-fcba-4e75-ac2d-99b03394d3ec", "role": "image_references"}
  ]
}
```

## prompt
```
ABSOLUTELY NO TEXT ANYWHERE: no letters, no words, no Korean or English characters, no numbers, no prices, no signs or signboards, no labels, no logos, no captions, no speech bubbles, no writing on any surface, screen, clothing, wall or object. Every sign, board, screen and label is blank or shows pictures only.

One continuous shot, 4 seconds, a warm happy moment for a bright pop music video.

STYLE: exactly the comic style of the reference images, drawn even bolder: thick black ink outlines, hard two-tone cel shading with no soft gradients, highly saturated punchy pop colors, high contrast, manga halftone dots, big speed lines, impact bursts, sparkles, stars and lightning on every action, crisp sharp lines, a fully animated 2D cartoon, not photorealistic, not soft anime lighting.

CHARACTER: the woman from the FIRST reference image (the cover), with exactly her face and body: a slim adult Korean woman in her early thirties, soft pretty feminine face, large brown eyes, glossy side-parted chin-length brown bob tucked behind one ear, small earring, adult proportions with long legs; not a child, not a boy, not chibi, not stocky. Outfit: oversized black T-shirt, black shorts with white swirl and star prints, white socks. The other two reference images are only for the drawing style and effects; do not copy their faces or body shapes. Keep her face, hair and body proportions identical in every frame, even in effort poses.

CAMERA: a close medium shot from the front at her eye level, framed from her knees to just above her head, so her face is large, clear and sharply drawn in every frame. The camera stays almost still with only a very slow gentle push-in; no zoom-out, no pull-back, no fast camera moves, no cut.

[Shot] 0-4s - Back home after the workout, in a warm, softly lit entryway with the front door closed behind her. At the start she already stands in white socks, and her black sneakers sit neatly side by side on the floor in front of her feet. She looks down at the sneakers with a satisfied little nod, then raises both arms high in a big happy full-body stretch, rising onto her toes, eyes closing with a bright, relieved smile, a few soft sparkles popping around her. Her face stays clearly visible and well lit the whole time.

RULES: She shows warm, happy expressions and makes no sound. Nobody sings, talks, shouts or lip-syncs. No other people. No extra arms or hands: exactly two arms. The sneakers stay on the floor; they are never thrown, kicked, carried or put back on. No soft blur, no muted colors, no realistic lighting. Audio: completely silent, no music, no voices, no screams, no sound effects.

ABSOLUTELY NO TEXT ANYWHERE: no letters, no words, no Korean or English characters, no numbers, no prices, no signs or signboards, no labels, no logos, no captions, no speech bubbles, no writing on any surface, screen, clothing, wall or object. Every sign, board, screen and label is blank or shows pictures only.
```

## 끝나면
- 클립 이름 `C22shoes`와 job_id를 알려 주세요. Claude Code에서 받아 AI 업스케일(Real-ESRGAN)한 뒤 아웃트로 첫 장면 자리(`edit_song.py`의 L22 첫 줄)에 바꿔 넣어요.
