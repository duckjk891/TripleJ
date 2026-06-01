"""AIDOL 앱 아이콘 PNG 생성.

두 가지 출력:
  - assets/icon.png         : iOS / fallback (1024x1024, 그라데이션 배경 + AIDOL)
  - assets/adaptive-icon.png: Android adaptive icon foreground (1024x1024)
                              가운데 65% 안전 영역에 글씨 + 배경 같이 그림.

스플래시와 같은 보라/네이비 톤 그라데이션.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 1024


def linear_gradient(w: int, h: int, top, bot) -> Image.Image:
    """위→아래 선형 그라데이션 RGBA Image."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(top[0] * (1 - t) + bot[0] * t)
        g = int(top[1] * (1 - t) + bot[1] * t)
        b = int(top[2] * (1 - t) + bot[2] * t)
        ImageDraw.Draw(img).line([(0, y), (w, y)], fill=(r, g, b, 255))
    return img


def draw_logo(img: Image.Image, text: str = "AIDOL", scale: float = 1.0) -> None:
    """img 중앙에 AIDOL 로고 텍스트.

    색상은 스플래시 폰트와 동일하게 colors.accent.primary (#a855f7 = 168,85,247).
    하단 라인 없음, 글로우 없음 — 순수 텍스트만.
    """
    W, H = img.size
    base_font_size = int(360 * scale)
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", base_font_size, index=1)

    tmp = ImageDraw.Draw(img)
    bbox = tmp.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (W - tw) // 2 - bbox[0]
    y = (H - th) // 2 - bbox[1]

    # 스플래시 폰트 색 — colors.accent.primary = #a855f7
    ImageDraw.Draw(img).text((x, y), text, fill=(168, 85, 247, 255), font=font)


# 1) iOS / fallback 아이콘 — 글씨가 양 옆 짤리지 않도록 scale 0.65
icon = linear_gradient(SIZE, SIZE, (28, 14, 74), (76, 29, 149))  # deep navy → purple
draw_logo(icon, "AIDOL", scale=0.65)
icon.save("/Users/pearl/TripleJ/2_housing/assets/icon.png")
print("saved assets/icon.png")

# 2) Android adaptive icon foreground — OS가 마스크/패딩 추가하니까 더 작게
adaptive = linear_gradient(SIZE, SIZE, (28, 14, 74), (76, 29, 149))
draw_logo(adaptive, "AIDOL", scale=0.5)
adaptive.save("/Users/pearl/TripleJ/2_housing/assets/adaptive-icon.png")
print("saved assets/adaptive-icon.png")

# 3) 스플래시 아이콘 같이 갱신 (선택 — 스플래시 가운데 작은 로고)
splash = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))  # 투명 배경
draw_logo(splash, "AIDOL", scale=0.7)
splash.save("/Users/pearl/TripleJ/2_housing/assets/splash-icon.png")
print("saved assets/splash-icon.png")
