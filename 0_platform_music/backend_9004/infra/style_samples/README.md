# 화풍 샘플 이미지 (style_samples)

가상화(그림/만화 화풍) 캐릭터시트 생성 시 reference 로 사용되는 번들 샘플 이미지.

| 파일 | preset key | 라벨 | art_style_label |
|------|-----------|------|-----------------|
| `webtoon.png` | `webtoon` | 웹툰 | Korean webtoon style |
| `anime.png`   | `anime`   | 애니 | Japanese anime style |
| `manga90.png` | `manga90` | 90년대 만화 | 1990s retro manga style |

서빙 엔드포인트: `GET /api/character/style-sample/{key}`
목록 엔드포인트: `GET /api/character/style-samples`

## 주의
현재 포함된 PNG 3종은 **단색 더미 플레이스홀더**(Pillow 미설치 환경에서도 생성 가능하도록
순수 파이썬으로 만든 256x256 단색+줄무늬 이미지)다. 실제 서비스에서는 **저작권 안전한
화풍 예시 이미지**로 교체해야 한다. 파일명/key 만 유지하면 라우트 수정 없이 교체 가능하다.
