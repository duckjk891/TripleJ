"""AIDOL 로고 PNG 생성 스크립트.

- 가로 1200 / 세로 480, 투명 배경
- "AIDOL" 진한 흰색 Helvetica Bold + 절제된 보라 글로우 + 하단 그라데이션 라인
- 어두운 보라/네이비 스플래시 위에 또렷하게 보이도록
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 480
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 280, index=1)  # Bold

text = "AIDOL"
tmp_draw = ImageDraw.Draw(img)
bbox = tmp_draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
x = (W - tw) // 2 - bbox[0]
y = (H - th) // 2 - bbox[1] - 30

# 1) 보라 글로우 (절제)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).text((x, y), text, fill=(150, 100, 255, 180), font=font)
glow = glow.filter(ImageFilter.GaussianBlur(radius=18))
img.alpha_composite(glow)

# 2) 메인 텍스트 (순백)
ImageDraw.Draw(img).text((x, y), text, fill=(255, 255, 255, 255), font=font)

# 3) 하단 그라데이션 라인 (보라 → 분홍)
line_y = y + th + 50
line_w = int(tw * 0.6)
line_x = (W - line_w) // 2
line_h = 10
grad = Image.new("RGBA", (line_w, line_h), (0, 0, 0, 0))
for i in range(line_w):
    t = i / max(line_w - 1, 1)
    r = int(150 * (1 - t) + 255 * t)
    g = int(100 * (1 - t) + 140 * t)
    b = int(255 * (1 - t) + 200 * t)
    for j in range(line_h):
        grad.putpixel((i, j), (r, g, b, 255))
mask = Image.new("L", (line_w, line_h), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, line_w - 1, line_h - 1), radius=line_h // 2, fill=255)
img.paste(grad, (line_x, line_y), mask)

out = "/Users/pearl/TripleJ/2_housing/assets/aidol-logo.png"
img.save(out)
print("saved", out, img.size)
