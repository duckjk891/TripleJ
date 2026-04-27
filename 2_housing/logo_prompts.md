# PANN 로고 AI 생성 프롬프트 모음

## 사용법
- **Midjourney / DALL-E 3 / Stable Diffusion** 등 이미지 생성 AI에 아래 프롬프트 중 하나를 입력
- 결과물 5~10장 생성 → 마음에 드는 로고 1~2개 선정
- 벡터 변환(Illustrator/Figma) 또는 SVG Trace로 PNG → SVG 전환 후 앱 적용 권장
- 최종 파일 필요 사이즈:
  - 앱 아이콘: 1024×1024 PNG (expo 요구)
  - SplashScreen 로고: 512×512 PNG (투명 배경)
  - 헤더 아이콘: 64×64 PNG
  - SVG: 무제한

---

## 브랜드 컨셉 요약 (프롬프트에 반영)

- **이름**: PANN (판, 그리스 신)
- **상징 악기**: **팬플루트(Pan flute / Syrinx)** — 갈대 파이프 5~7개 수직으로 묶은 형태
- **분위기**: 황혼(Twilight), 신화적, 모던, 미니멀
- **컬러**: 보라 그라데이션 (Pan 보라 `#a855f7` → Apollo 금빛 `#fbbf24`)
- **서사**: Pan이 태양신 Apollo와 음악 대결을 벌인 신화

---

## 프롬프트 V1 — 미니멀 실루엣 (추천)

```
minimalist logo, pan flute silhouette with 5 vertical reed pipes,
purple to gold gradient, twilight aesthetic, sacred geometry,
flat design, no text, centered composition, clean lines,
dark background, greek mythology inspired, modern mobile app icon,
transparent background, vector art, 4k
```

### 변형
- "5 vertical reed pipes" → "7 vertical pipes of descending height" (본래 팬플루트 형태)
- "purple to gold gradient" → "deep purple to lavender gradient" (더 은은하게)

---

## 프롬프트 V2 — 신화적 아이덴티티 (스토리)

```
stylized logo for music app named PANN, pan flute instrument held
by greek god Pan silhouette, twilight purple and gold color palette,
minimalist vector art, modern mobile app icon, symbolic and mystical,
no text, centered, transparent background, 4k vector
```

---

## 프롬프트 V3 — 추상 + 음파

```
abstract logo combining pan flute pipes with sound waves,
purple gradient from deep violet #4c1d95 to vibrant magenta #c026d3,
with golden accent #fbbf24 at the top, minimalist geometric design,
for music production app, flat vector, no text, centered,
transparent background, clean modern aesthetic, 4k
```

---

## 프롬프트 V4 — 타이포 포함 (워드마크)

```
wordmark logo for "PANN" music platform, sans-serif modern typography
like Poppins or Syne, letter P stylized to resemble pan flute pipes,
purple to gold gradient fill, minimalist, centered composition,
transparent background, mobile app branding, 4k vector art
```

### 변형
- "letter P stylized to..." → "letter N stylized to resemble reed pipes"
- Poppins 대신 "DM Sans", "Syne", "Space Grotesk" 등

---

## 프롬프트 V5 — 황혼 분위기 강조

```
logo for PANN music app, pan flute silhouette emerging from a twilight
horizon, sun setting behind, purple to gold sky gradient,
half-circle horizon line, minimalist greek mythology inspired,
no text, clean vector, centered, transparent background,
modern mobile app icon, 4k
```

---

## 추천 진행 순서

1. **V1 프롬프트 먼저 시도** (가장 안전, 미니멀)
   - Midjourney: `/imagine [프롬프트 V1]`
   - DALL-E 3: ChatGPT Plus에서 프롬프트 그대로
2. 결과 10장 생성 → 2~3개 후보 선정
3. **V3 또는 V5로 한 번 더 생성** (분위기 차별화 후보)
4. 최종 1개 선택 → 벡터화 (https://www.vectorizer.ai 등 무료 툴)
5. SVG → PNG 변환 (투명 배경, 1024×1024)
6. `2_housing/assets/logo/` 폴더에 저장
7. 요청하면 SplashScreen/Header/앱 아이콘에 적용해 드립니다.

---

## 컬러 HEX 참조 (AI에게 정확히 전달용)

| 역할 | HEX | 설명 |
|------|-----|------|
| 메인 보라 | `#a855f7` | Pan 보라 (포인트) |
| 깊은 보라 | `#4c1d95` | 그라데이션 시작 |
| 비비드 마젠타 | `#c026d3` | 그라데이션 중간 |
| 라벤더 | `#e879f9` | 그라데이션 끝 |
| 아폴론 금빛 | `#fbbf24` | 보조 포인트 |
| 한밤 배경 | `#0d0820` | 로고 배경용 |

---

## 참고 이미지 검색 키워드

AI 생성 전 영감이 필요하면 아래 키워드로 검색해보세요:

- "pan flute logo vector"
- "syrinx instrument minimalist"
- "twilight music brand"
- "greek mythology modern logo"
- "purple gold music app icon"
