# 「분신술」 1분 이내 티저 — 구간·5컷 디렉팅 프롬프트 (2026-11-03)

- 곡: 「분신술」 · 아티스트 진주 (30대 중반 여성) · 걸스 힙합 · 145 BPM · 1분 40초 (track 6ac98a0d2d98f000091eb49e)
- 목소리는 0.6초부터 84.9초까지 나와요. 85초 뒤 약 15초는 반주만 있는 마무리예요.
- 구간 시간은 서버에 저장된 가사 시간 정보 기준이에요. 음원은 외부로 보내지 않았어요.
- 화면은 9:16 세로예요. 기존 SNS 영상 규칙에 맞춰 위 9%와 아래 20%는 비워 둬요.
  - 위 9%는 숏폼 앱 아이콘이 덮는 자리예요.
  - 아래 20%는 가사 자막 자리예요.
- 그림체는 지금 커버와 캐릭터 시트처럼 실사 사진풍으로 해요.

---

## 1. 쓸 구간 후보 (1분 이내)

> 기준: 노래 구간은 56초 이하예요. SNS 영상 끝 장면 3초까지 합쳐도 **60초를 넘지 않아요.**

| 안 | 구간 | 길이 | 들어가는 부분 | 장점 | 아쉬운 점 |
|---|---|---|---|---|---|
| **A (추천)** | **15.6초 → 71.5초** | 56초 (끝 장면 포함 59초) | "개발은 기술, 버그는 전술" 랩 → "clone myself, 분신술" → 점점 고조 → 후렴 → 3절 → 후렴 → "본체는 벌써 퇴근, 끝" | 시작 3초 안에 제목 가사 "분신술"이 나오고, 후렴 두 번 뒤 "끝"으로 깔끔하게 끝나요. | "불 켜진 사무실"과 "행정은 마술" 줄은 빠져요. |
| B (이야기형) | 0.0초 → 55.9초 | 56초 (끝 장면 포함 59초) | 처음부터 "오늘도 불 켜진 사무실" → 분신술 랩 → 후렴 → 3절 → "나 좀 멋진 거, 나도 알아" | 출근 → 분신 → 해결 순서로 이야기가 다 보여요. 끝이 자신만만한 한마디예요. | 후렴이 한 번만 나와요. |
| C (훅 먼저) | 29.6초 → 85.5초 | 56초 (끝 장면 포함 59초) | "나를 Ctrl+C, 또 Ctrl+V"로 시작 → 3절 → 후렴 → 헷갈리는 브리지 → 퇴근 → "(펑!)" | 첫 1초부터 가장 귀에 남는 훅이 나오고, "펑!"으로 끝나서 반전이 있어요. | 분신술 랩 부분(제목 가사)이 빠져요. |

> 추천 이유: 티저는 첫 3초에 제목이 들려야 기억에 남아요. A는 "~술" 라임 랩 중간에서 시작해서 3초 만에 "분신술"이 나와요. 쇼츠에서 끝까지 보게 하려면 C(훅 먼저)도 좋은 대안이에요.

### 안 A의 5컷 시간표

| 컷 | 구간 | 가사 |
|---|---|---|
| 1 | 15.6 – 20.9 | 개발은 기술, 버그는 전술 / 영업은 화술, 기획은 예술 / clone myself, 분신술 |
| 2 | 20.9 – 27.6 | 손이 모자라? 늘리면 돼 / 손가락 딱, 펑 하면 clone / 문제 있어? 전부 가져와 / 접수 완료, 다음 다음 |
| 3 | 27.6 – 42.6 | (후렴) 나야나 손만 대면 끝 / 나를 Ctrl+C, 또 Ctrl+V … 여기도 나, 저기도 나 |
| 4 | 42.7 – 55.9 | 점심 전에 민원 정리 / 오후엔 demo, 미팅 콜 / … / 나 좀 멋진 거, 나도 알아 |
| 5 | 55.9 – 71.5 | (후렴) … 회의도 나, 보고도 나 / 본체는 벌써 퇴근, 끝 |

(B·C 시간표는 맨 아래에 있어요.)

---

## 2. 모든 컷에 붙이는 공통 문구 (인물·화풍 고정용)

캐릭터 시트 이미지를 **참고 이미지(레퍼런스)로 꼭 같이 넣고**, 아래 문구를 매 컷 프롬프트 앞에 그대로 붙여요. 옷은 진주 캐릭터에 쓴 상품 그대로예요. 상품이 노출되는 거라 컷마다 같아야 해요.

**인물 고정 (영문)**
```
The same Korean woman in every frame, mid-30s, long dark-brown wavy hair past the shoulders, soft natural makeup, gentle confident smile.
Outfit (identical in every frame): ivory oversized wool V-neck pullover, brown wrap maxi skirt with a front slit, ivory pointed-toe ankle boots, small blue-gray crescent shoulder bag.
All clones are the exact same person with the exact same face, hair and outfit.
```

**화면 고정 (영문)**
```
Vertical 9:16, photorealistic cinematic still, 35mm film look, shallow depth of field, high detail skin texture.
Keep the top 9% and bottom 20% of the frame free of faces and important objects (space for UI and subtitles); main subject centered.
```

**빼는 것 (네거티브)**
```
different faces between clones, changed outfit, extra fingers, distorted hands, text, letters, logos, watermark, brand names, cartoon, anime, oversaturated
```

> 팁: 분신이 여러 명 나오는 컷은 얼굴이 조금씩 달라지기 쉬워요. 분신은 4~6명까지만 넣고, 뒤쪽 분신은 살짝 흐리게(초점 밖) 하라고 적으면 덜 어색해요.

---

## 3. 디렉팅 안 (안 A 구간 기준)

### 안 ① 「야근 사무실 실사 코미디」: 지금 커버의 연장선 (추천)
밤의 고층 사무실이에요. 진주가 혼자 일하다가 분신을 만들어 모든 일을 처리하고, 마지막에 본체만 먼저 퇴근해요. 커버와 같은 세계라 곡과 바로 연결되고, 상품 옷도 가장 자연스럽게 보여요.
- 색감: 따뜻한 스탠드 조명 + 창밖 푸른 야경

**컷 1 · 15.6–20.9 · 분신술 랩**
- 장면: 진주 4명이 각자 일을 해요. 서류에 도장(행정), 노트북 코드(개발), 전화(영업), 화이트보드(기획). 가운데 본체가 카메라를 보며 윙크해요.
- 카메라: 정면 미디엄 와이드, 눈높이
```
Night-time open office in a Seoul high-rise, city lights through floor-to-ceiling windows. Four identical clones of the woman each doing a different job at once: stamping documents, typing code on a laptop, talking on the phone, drawing a plan on a whiteboard. The original stands in the center facing the camera with a playful wink. Medium-wide frontal shot, eye level, warm desk lamps against cool blue window light.
```

**컷 2 · 20.9–27.6 · 손가락 딱, 펑 하면 clone**
- 장면: 진주가 손가락을 튕기는 순간이에요. 옆에서 하얀 연기와 종이가 터지며 분신이 새로 나타나요.
- 카메라: 손과 얼굴 클로즈업, 살짝 아래에서
```
Close-up of the woman snapping her fingers with a confident smirk; right beside her a burst of soft white smoke and flying papers reveals a new clone of herself appearing mid-pose. Slight low angle, motion-frozen papers in the air, warm key light, cool rim light.
```

**컷 3 · 27.6–42.6 · 후렴 Ctrl+C, Ctrl+V**
- 장면: 사무실 책상 줄을 따라 똑같은 진주가 끝까지 줄지어 앉아 있어요. 다 같은 자세로 키보드를 쳐요. 맨 앞의 본체만 카메라를 봐요.
- 카메라: 책상 줄을 따라 깊게 보는 원근 구도(복사·붙여넣기 느낌)
```
Symmetrical one-point perspective down a long row of office desks; identical clones of the woman sit at every desk in the exact same pose, typing in sync, repeating into the distance like copy-and-paste. The original in the foreground looks straight into the camera, sharp focus; clones behind gradually soft focus. Cool blue night light, warm lamps on each desk.
```

**컷 4 · 42.7–55.9 · 민원·데모·미팅 / 나 좀 멋진 거**
- 장면: 유리 회의실 안에서 분신 하나는 발표하고, 하나는 통화하고, 하나는 민원 서류를 정리해요. 유리 밖 복도의 본체는 커피를 들고 자신만만하게 걸어가요.
- 카메라: 유리 너머로 보는 옆 트래킹 느낌, 미디엄 샷
```
Glass-walled meeting room at night: inside, one clone presents a demo on a screen, one is on a video call, one sorts a stack of complaint files. Outside the glass in the corridor, the original walks past holding a coffee cup with a proud, self-satisfied smile. Medium side shot through glass with reflections, cinematic.
```

**컷 5 · 55.9–71.5 · 회의도 나, 보고도 나 / 본체는 벌써 퇴근, 끝**
- 장면: 뒤쪽 사무실에서는 분신들이 아직 일하고 있어요. 앞쪽 본체는 파란 가방을 메고 엘리베이터 앞에서 뒤돌아 손을 흔들어요. 문이 닫히기 직전이에요.
- 카메라: 엘리베이터 안에서 바깥을 보는 구도
```
View from inside an elevator looking out: in the background the lit office where clones are still working at their desks; in the foreground the original woman, blue-gray crescent bag on her shoulder, turns back and gives a cheerful little wave as the elevator doors begin to close. Warm elevator light vs cool office light, end-of-day relief.
```

---

### 안 ② 「K-pop 퍼포먼스형」: 분신들이 백댄서
사무실을 무대 세트처럼 꾸며요. 분신들이 군무를 추는 뮤직비디오 느낌이에요. 걸스 힙합 장르, 145 BPM과 가장 잘 맞고 숏폼에서 눈에 잘 띄어요.
- 색감: 보라(MAIDOL 색) · 핑크 네온 + 사무실 형광등

**컷 1 · 분신술 랩:** 진주가 책상 위에 서서 랩 포즈를 해요. 뒤의 분신 4명이 각자 소품(도장·노트북·전화·마커)을 들고 같은 포즈를 해요.
```
Stylized office turned into a music-video stage, purple and pink neon strips along the ceiling. The woman stands on top of a desk in a confident hip-hop pose, four clones behind her strike the same pose each holding a prop: a stamp, a laptop, a phone, a marker. Low angle, wide, dramatic backlight haze.
```

**컷 2 · 손가락 딱, 펑:** 손가락을 튕기는 순간, 보라색 빛과 함께 분신이 양옆으로 쫙 펼쳐져요.
```
The woman snaps her fingers at the camera; a flash of violet light and her clones fan out symmetrically on both sides like a dance formation reveal. Frontal medium shot, light streaks, glossy floor reflections.
```

**컷 3 · 후렴:** 6명이 V자 대형으로 서서 같은 손동작(복사·붙여넣기)을 해요. 본체가 맨 앞 가운데예요.
```
Six identical clones in a V-formation in the office aisle, all doing the same sharp choreography move, the original at the front center. Centered symmetrical wide shot, purple neon and white fluorescent lights, slight smoke, high energy.
```

**컷 4 · 3절 / 나 좀 멋진 거:** 회의 테이블 위를 런웨이처럼 걸어오는 본체예요. 양옆 의자에 앉은 분신들이 박수를 쳐요.
```
The original walks down a long meeting table like a runway toward the camera, clones seated on both sides clapping and cheering. Low angle long-lens shot, pink-violet rim light, confident stride, skirt in motion.
```

**컷 5 · 본체는 벌써 퇴근:** 무대 조명이 꺼진 사무실 문 앞이에요. 본체가 가방을 메고 뒤돌아 손 키스를 날려요. 뒤에서 분신들이 고개를 숙여 인사해요.
```
Stage lights fading in the office; at the exit door the original, bag on shoulder, looks back over her shoulder and blows a kiss; behind her the clones take a synchronized bow in silhouette. Backlit, violet afterglow, ending-scene mood.
```

---

### 안 ③ 「사무실 분신술 패러디」: 연기 펑, 손 모양 수인
옛날 무협·닌자 영화의 분신술을 사무실로 가져와요. 웃기고 기억에 남지만, 분위기가 가장 코믹해요. 특정 만화 캐릭터, 의상, 표식은 쓰지 않아요.
- 색감: 수묵 느낌의 회색 연기 + 따뜻한 사무실 빛

**컷 1 · 분신술 랩:** 진주가 책상 앞에서 두 손을 모아 손 모양(수인)을 만들어요. 책상 위 서류가 바람에 날려요.
```
The woman sits at her office desk with both hands pressed together in a dramatic hand-seal gesture, eyes closed in focus; papers lift into the air around her as if a gust of power. Frontal medium close-up, ink-wash style grey smoke curling at the edges, warm office light.
```

**컷 2 · 펑 하면 clone:** "펑!" 회색 연기 구름 4개가 터지고, 그 안에서 분신이 하나씩 나와요.
```
Four puffs of thick grey smoke explode around the desk, each revealing an identical clone mid-landing in an action pose; the original in the center with an amused grin. Wide shot, frozen-motion smoke, dynamic diagonal composition.
```

**컷 3 · 후렴:** 사무실 파티션 위에 분신들이 무술 자세로 한 줄로 서 있어요. 모두 손에 서류, 노트북, 전화를 들었어요.
```
Clones of the woman stand in a line on top of office cubicle partitions in martial-arts stances, each holding office items like weapons: a folder, a laptop, a phone, a stapler. The original in front with crossed arms. Low angle wide shot, dramatic light beams through blinds.
```

**컷 4 · 3절:** 분신들이 아주 빠르게 일을 처리해서 잔상이 남아요. 본체는 가운데에서 여유롭게 커피를 마셔요.
```
Motion-blur afterimages of clones zipping between desks finishing tasks at superhuman speed, papers swirling; in the sharp center the original calmly sips coffee, unbothered. Medium shot, long exposure look, warm and grey tones.
```

**컷 5 · 본체는 벌써 퇴근:** 퇴근하는 본체 뒤에서 분신들이 "펑" 연기로 하나씩 사라져요.
```
At the office exit at night, the original walks away with her bag on her shoulder, looking back with a satisfied smile; behind her the clones vanish one by one into puffs of grey smoke. Wide shot, cool night light, smoke dissolving into the dark.
```

---

## 4. 다른 구간을 고를 때의 컷 시간표

**안 B (0.0 → 55.9)**
1. 0.0–13.8 불 켜진 사무실 · 메일이 산처럼 · 커피 한 모금 mode on: 혼자인 진주
2. 13.8–20.9 분신술 랩: 분신 등장
3. 20.9–27.6 손가락 딱, 펑
4. 27.6–42.6 후렴 Ctrl+C·V
5. 42.7–55.9 3절 "점심 전에 민원 정리 … 나 좀 멋진 거, 나도 알아"

**안 C (29.6 → 85.5)**
1. 29.6–42.6 후렴 "나를 Ctrl+C, 또 Ctrl+V"부터: 줄지은 분신(훅으로 시작)
2. 42.7–55.9 3절: 민원·데모·미팅
3. 55.9–71.3 후렴 2 + 본체는 벌써 퇴근
4. 71.3–77.9 브리지 "누가 나인지 진짜인지": 거울과 유리에 비친 여러 진주, 혼란스러운 표정
5. 77.9–85.5 아웃트로 "분신들아, 불 끄고 와 / 본체는 먼저 간다 (펑!)": 사무실 불이 꺼지고 연기 "펑"

브리지 컷 예시 (C의 4번):
```
The woman stands between two facing mirrors in a dim office restroom; infinite reflections of herself, some reflections smiling while she looks puzzled, questioning which one is real. Medium shot, cool teal light, subtle surreal mood.
```

---

## 5. 영상으로 만들 때 메모
- 컷 하나가 약 7~15초예요. 이미지를 영상으로 움직일 때는 컷 3·5처럼 긴 컷은 두 번 나눠 움직여도 돼요. 예: 천천히 앞으로 다가가기, 옆으로 흐르기.
- 박자: 145 BPM이라 한 마디가 약 1.66초예요. 컷 전환은 가사 줄이 바뀌는 시점에 맞추면 박자와도 맞아요.
- SNS 영상 끝 장면 3초(MAIDOL 로고 · 내 이야기로 노래 만들기 · MAIDOL 검색)는 그대로 붙여요. 링크나 화살표는 넣지 않아요.
