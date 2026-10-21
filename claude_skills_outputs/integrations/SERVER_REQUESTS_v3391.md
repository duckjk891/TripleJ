# v3.391 운영 반영 대기 목록 (대표님 승인 필요 — 서버·도메인·OTA·스토어)

| # | 무엇 | 어디 | 왜 | 앱 재기동 |
|---|---|---|---|---|
| 1 | `/api/app/version` 응답에 `android.min_build`·`android.latest_build`(iOS 동일) 그대로 내려주기 + Mongo `app_config{_id:'app_version'}` 에 값 넣기 | 서버 routes/app_version.py | 같은 1.3.x 버전 안에서도 빌드 번호로 필수·선택 업데이트 안내 | 서버 재기동 1회(다른 배포와 묶기) |
| 2 | 1.3.3 스토어 출시 후 `android.latest`=`1.3.3`(선택 업데이트 안내) | Mongo app_config | 1.3.2 사용자에게 "새 버전" 안내(1.3.1 이하는 게이트가 없어 안내 불가 — 스토어 자동 업데이트에 의존) | 없음 |
| 3 | `/.well-known/assetlinks.json`·`apple-app-site-association` | api.maidol.ai.kr nginx | 곡·크루·게시물·초대 링크가 앱으로 열리게(App Links·유니버설 링크) | nginx reload 만 |
| 4 | 같은 두 파일 | app.maidol.ai.kr(_worker.js) | 메일 `…/app?open=dm` 링크가 앱으로 | 웹 배포 |
| 5 | 공유 랜딩 `intent://` 앱 열기 + 초대 랜딩 Play 링크 `referrer=ref%3D{코드}`, "앱 곧 출시" 문구 교체 | 서버 랜딩 HTML(track·club·feed·invite) | 카톡 안 브라우저에서도 앱으로, **설치 후 추천 보상** | 서버 재기동 1회 |
| 6 | Play 앱 서명 키 SHA-256 알려 주기 | Play Console > 앱 무결성 | 3·4 파일에 넣을 값(스토어 앱 확인용) | — |
| 7 | 첫 OTA 시험 1건(채널 preview — 시험 앱만) | `scripts/ota_update.sh preview` | OTA 동작 확인 | — |
| 8 | 1.3.3 스토어 제출(Play·App Store) | EAS production 빌드·제출 | OTA 를 쓰려면 스토어 앱이 1.3.3 이어야 함 | — |

자세한 내용: `OTA_UPDATE_GUIDE.md`, `app_links/APP_LINKS_SETUP.md`, 시험 순서 `APP_TEST_v3391_v3392.md`.
