# 공유 링크로 MAIDOL 앱 열기 + 추천 링크 설치 보상 — 설정 안내 (v3.391, 2026-10-21)

## 지금 문제
- 카톡에서 곡·크루·초대 링크를 누르면 앱이 설치돼 있어도 **브라우저(웹)** 로 열린다.
- 링크 주소는 전부 `https://api.maidol.ai.kr/…` 입니다(곡 `/track/{id}`, 크루 `/club/{id}?i=…`, 게시물 `/feed/{id}`, 초대 `/invite/{코드}`).
  메일의 메시지함 링크만 `https://app.maidol.ai.kr/app?open=dm`.
- 초대 링크로 들어온 사람이 Play 스토어에서 앱을 **새로 설치**하면 추천코드가 사라져 보상이 안 들어간다.

## 앱 쪽(v3.391 — 시험 APK에 포함, 끝)
- 안드로이드 App Links(`autoVerify`)·iOS 유니버설 링크 등록: `api.maidol.ai.kr` 의 `/track/ /club/ /feed/ /invite/`, `app.maidol.ai.kr/app`.
- 앱이 받는 것: 곡(재생)·크루(초대코드 포함)·게시물·`?open=dm`(메시지함)·초대 `/invite/{코드}` 또는 `?ref=` → 추천코드 7일 보관 → 가입 화면 추천코드 칸에 자동 입력.
- **설치 전 링크 → 설치 후 첫 실행**: Play 설치 리퍼러(`referrer=ref%3D{코드}`)를 읽어 같은 방식으로 보관(expo-application).
- 아래 서버·도메인 설정이 끝나기 전에도 앱은 안전합니다(확인 파일이 없으면 지금처럼 브라우저로 열릴 뿐).

## 대표님 확인이 필요한 것 (1개)
**Play 앱 서명 키 SHA-256**: Play Console → MAIDOL → 설정 → 앱 무결성(App integrity) → "앱 서명" 탭 →
**앱 서명 키 인증서**의 *SHA-256 인증서 지문* 복사 → Claude 에게 전달.
(EAS 키 SHA-256 `01:97:53:47:…:56:A3` 는 시험 APK 에서 직접 뽑아 확인함 — SHA-1 이 기존 기록 `84:5C:A9:BB:…` 과 일치)

## 운영 반영(대표님 승인 후 — 서버·도메인 변경)

### A. 확인 파일 올리기
| 도메인 | 파일 | 방법 |
|---|---|---|
| api.maidol.ai.kr | `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` | EC2 nginx — `nginx_api_wellknown.conf` 를 api server 블록에 추가, 파일은 `/home/ubuntu/maidol/well-known/` 에 (`assetlinks.json`, `aasa_api.json` → 이름 `apple-app-site-association`). `sudo nginx -t && sudo systemctl reload nginx` (앱 서버 재기동 없음) |
| app.maidol.ai.kr | 같은 두 파일 | `homepage/maidol/app-worker/_worker.js` 에 `worker_wellknown.patch` 적용(JSON 은 `assetlinks.json`·`aasa_app.json` 내용) → `APP_BRANCH=mvtest ./deploy.sh app` 로 미리보기 확인 → 운영 배포 |

확인: `curl -s https://api.maidol.ai.kr/.well-known/assetlinks.json` 이 JSON(200, `application/json`, 리다이렉트 없음)으로 나와야 함.
구글 확인 도구: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://api.maidol.ai.kr&relation=delegate_permission/common.handle_all_urls`

### B. 카톡 안 브라우저 대응(공유 랜딩 페이지 — 서버 HTML 수정)
카톡은 링크를 **자기 앱 안 브라우저**로 열어서 App Links 가 작동하지 않습니다. 랜딩 페이지에서 안드로이드면 `intent://` 로 앱을 엽니다.
- `/track/{id}`·`/club/{id}`·`/feed/{id}` (지금은 웹으로 바로 이동): 안드로이드 UA 이면 먼저
  `intent://track/{id}?s={s}#Intent;scheme=aidol;package=com.maidol.app;S.browser_fallback_url={지금 가던 웹 주소(인코딩)};end`
  로 이동 → 앱 있으면 앱, 없으면 지금처럼 웹. iOS 는 유니버설 링크가 처리(파일 A 반영 후).
- `/invite/{코드}` (지금 "모바일 앱은 곧 출시돼요" — 문구가 오래됨):
  - [Google Play에서 받기] = `https://play.google.com/store/apps/details?id=com.maidol.app&referrer=ref%3D{코드}`
    → **설치 후 첫 실행 때 앱이 코드를 읽어 가입 화면에 자동 입력**(추천 보상).
  - [이미 설치했다면 앱 열기] = 안드로이드 `intent://invite/{코드}#Intent;scheme=aidol;package=com.maidol.app;S.browser_fallback_url={Play 링크(인코딩)};end`,
    iOS `aidol://invite/{코드}`.
  - [웹에서 바로 시작하기] 는 그대로(`https://app.maidol.ai.kr/?ref={코드}` 로 코드 전달 권장).

### C. 확인 순서(시험 APK 설치 후)
1. 위 A 반영 → 설정 > 애플리케이션 > MAIDOL > 기본으로 열기 > "지원되는 링크"에 `api.maidol.ai.kr`·`app.maidol.ai.kr` 이 **확인됨**으로 보이는지.
   (시험 APK 는 EAS 키, 스토어 앱은 Play 키로 확인 — 두 지문이 모두 파일에 있어야 둘 다 됨)
2. 크롬에서 곡 링크 → 앱으로 열림. 카톡 링크 → (B 반영 후) 앱으로 열림.
3. 앱 삭제 → 초대 링크의 [Google Play에서 받기] → 설치 → 첫 실행 → 가입 화면 추천코드 칸이 채워져 있는지.
   (시험 APK 는 Play 에서 받는 게 아니라 이 단계는 스토어 1.3.3 출시 후, 또는 Play 내부 테스트 트랙에서 확인)
