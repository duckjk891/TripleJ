# 채팅 생성 지시서 — L6 「샐러드에 닭가슴살」 장면 다시 만들기 (2026-11-12)

- 자리: L6 세 번째 장면, 노래 42.33–44.24초(약 1.9초). 편집에서 4초 클립 중 잘 나온 2초 정도만 잘라 써요.
- 고칠 점: 지금 장면은 그릇에 닭가슴살이 안 보이고 콩 같은 것만 담겨 있어요. 앉아서 거의 움직이지 않아서 운동처럼 보이지도 않아요. → 닭가슴살이 또렷한 샐러드 + 확실한 러시안 트위스트 동작으로 바꿔요.
- 규칙은 `cowork_seedance_brief_v2.md`와 같아요. MCP 도구로만 생성하고, `use_unlim: true`가 거절되면 크레딧으로 다시 보내지 말고 멈춰요. 첫 생성 전후 `balance`를 확인하고, 노래·음성 파일은 올리지 않아요.

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

One continuous shot, 4 seconds, a fast and funny workout moment for a bright pop music video.

STYLE: exactly the comic style of the reference images, drawn even bolder: thick black ink outlines, hard two-tone cel shading with no soft gradients, highly saturated punchy pop colors, high contrast, manga halftone dots, big speed lines, impact bursts, sparkles, stars and lightning on every action, crisp sharp lines, a fully animated 2D cartoon, not photorealistic, not soft anime lighting.

CHARACTER: the woman from the FIRST reference image (the cover), with exactly her face and body: a slim adult Korean woman in her early thirties, soft pretty feminine face, large brown eyes, glossy side-parted chin-length brown bob tucked behind one ear, small earring, adult proportions with long legs; not a child, not a boy, not chibi, not stocky. Outfit: oversized black T-shirt, black shorts with white swirl and star prints, white socks, black sneakers. The other two reference images are only for the drawing style and effects; do not copy their faces or body shapes. Keep her face, hair and body proportions identical in every frame, even in effort poses.

MOTION: snappy, bouncy cartoon animation, quick anticipation and overshoot on every move, big comic expressions and effects, small camera shakes on the beat, nothing slow or floaty; the bounce is in the motion and effects only, her face and body proportions never change.

[Shot] 0-4s - Medium-wide side-angle view on a bright exercise mat. She sits in a V-sit with her knees bent and her feet lifted off the floor, holding a big clear glass bowl with both hands in front of her chest. The bowl is clearly a fresh green salad: crisp lettuce, cherry tomatoes and cucumber, topped with thick slices of golden grilled chicken breast with grill marks that are easy to see. She does a Russian twist with the bowl: she twists her upper body fully to the left, then fully to the right, then left and right again, four quick twists on the beat, the bowl swinging from side to side. The salad and chicken slices stay in the bowl and bounce a little with each twist. Her face strains with effort, then breaks into a proud grin on the last twist, as sparkles burst around the chicken slices.

RULES: She shows big comic effort faces and gestures but makes no sound. Nobody sings, talks, shouts or lip-syncs. No other people. No extra arms or hands: exactly two arms, both hands always holding the one bowl. Only one bowl, no fork, no other food. No soft blur, no muted colors, no realistic lighting. Audio: completely silent, no music, no voices, no screams, no sound effects.

ABSOLUTELY NO TEXT ANYWHERE: no letters, no words, no Korean or English characters, no numbers, no prices, no signs or signboards, no labels, no logos, no captions, no speech bubbles, no writing on any surface, screen, clothing, wall or object. Every sign, board, screen and label is blank or shows pictures only.
```

## 끝나면
- 클립 이름 `C6salad`와 job_id를 알려 주세요. Claude Code에서 받아 720p로 업스케일하고, L6 세 번째 장면 자리(`edit_full.py`의 `FILE_OVERRIDE`)에 끼워 넣어요.
