# TESTPLAN_v3 — 팀: aidol-parity (test-designer)

> 2단계 게이트(1단계 unit·api → 2단계 e2e). 모바일 → E2E는 **Expo Web + Playwright**로 치환.
> 두 위치 동일 비치(2_housing + claude_skills_outputs/team-dev).

---

## v3.5 — 2026-08-13 — 화면 통일 스윕 #2 (색 토큰화) 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | Splash·Agency·ArtistDetail·Settings tsc 에러 0 | [unit] | PASS |
| U2 | 실 하드코딩 HEX(#2a2a3e·#4c1d95·#1e0e4a·레거시레드) 제거 | [unit/정적] | PASS |
| R1(회귀) | 레이아웃/로직/그라데이션 시각 등가(토큰값 근사) | [unit] | PASS(색 참조만 변경) |

주: 순수 색-토큰 스왑이라 렌더 E2E는 다음 통합 스윕에서 일괄 재확인.

---

## v3.4 — 2026-08-13 — 화면 통일 스윕 #1 (MyMusic·Playlist) 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | MyMusic·Playlist tsc 에러 0 | [unit] | PASS |
| U2 | MyMusic 하드코딩 HEX 제거(토큰화) | [unit] | PASS(#2a2a3e·레거시 rgba 제거) |
| E1 | 플레이리스트 탭 → EmptyState+Button 렌더 | [e2e] | PASS |
| E2 | 마이뮤직 탭 렌더 | [e2e] | PASS |
| E3 | 콘솔/네트워크 에러 | [e2e] | 0/0 |
| R1(회귀) | 로그인 후 리스트/성장카드/모달 로직 무변경 | [unit] | PASS(로직 미수정) |

---

## v3.3 — 2026-08-13 — PlayerScreen 리스킨 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | PlayerScreen tsc 에러 0 | [unit] | PASS |
| E1 | 차트→트랙 탭→Player 진입, 실화면 렌더(제목/아티스트/컨트롤/액션 AppText) | [e2e] | PASS |
| E2 | "가사·상세정보" 열기 → 탭이 Tag 칩으로 렌더, 콘텐츠 표시 | [e2e] | PASS |
| E3 | 콘솔/네트워크 에러 수집 | [e2e] | 0/0 |
| R1(회귀) | 오디오/슬라이더/셔플·반복/상세시트 로직 무변경 → 동작 보존 | [unit] | PASS(로직 미수정) |

---

## v3.2 — 2026-08-13 — 버그픽스: 재생 지속(중복 사운드) 검증

| # | 시나리오 (Given/When/Then) | 태그 | 결과 |
|---|---|---|---|
| U1 | Given PlayerScreen 수정 / When tsc / Then 에러 0 | [unit] | PASS |
| E1 | Given 앱→차트 / When 첫 트랙 탭해 Player 진입 / Then `Audio` 인스턴스 **정확히 1개** 생성(계측) | [e2e] | PASS(1개) |
| E2 | Given Player 진입 / When routeTrack 효과 / Then 최초 실행 스킵 가드 로그 1회 | [e2e] | PASS |
| E3 | Given Player / When 화면 렌더 / Then "Now Playing" 표시 | [e2e] | PASS |
| R1(회귀) | 곡 전환(prev/next)·미니↔풀 전환 시 사운드 1개 유지 | [e2e] | 설계상 보존(단일 생성 경로) |

주: 헤드리스 오토플레이 차단 → 실제 소리 재생은 미검증. 인스턴스 수(고아 발생)로 핵심 검증. 네이티브 실기기 확인 권장.

---

## v3.1 — 2026-08-13 — Wave 0 (공용 컴포넌트 + ChartScreen 리스킨)

### 1단계 — [unit] / [api]
| # | 시나리오 (Given/When/Then) | 태그 | 결과 |
|---|---|---|---|
| U1 | Given 공용 컴포넌트 9종 / When `tsc --noEmit --strict` / Then 타입에러 0 | [unit] | PASS |
| U2 | Given ChartScreen 리스킨 / When 프로젝트 tsc / Then ChartScreen·ui 에러 0 (전체 0) | [unit] | PASS |
| U3 | Given 컴포넌트 스타일 / When 코드 검사 / Then 원시 HEX·매직넘버 없이 토큰만 사용 | [unit] | PASS(신규 ui 토큰화) |
| A1 | Given 9004 / When `GET /api/charts/top100` / Then 200 + 트랙 배열 | [api] | PASS(실데이터 렌더 확인) |
| A2 | Given 9004 health / When `GET /api/health` / Then 200 | [api] | PASS |

### 2단계 — [e2e(web)]
| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| E1 | Given Expo Web 부팅 / When 앱 로드 / Then 번들 성공(797모듈)·HTTP 200·마운트 | [e2e] | PASS |
| E2 | Given 앱 화면 / When "차트" 탭 클릭 / Then ChartScreen 렌더(칩 필터+랭킹 리스트) | [e2e] | PASS(clicked:차트) |
| E3 | Given ChartScreen / When 실데이터 로드 / Then 랭킹곡·장르칩·재생수 표시 | [e2e] | PASS(TOP100 10곡+) |
| E4 | Given 렌더 / When 콘솔·네트워크 수집 / Then 콘솔 에러 0·4xx/5xx 0 | [e2e] | PASS(ERRORS 0) |
| E5(증적) | 스크린샷 저장 | [e2e] | /tmp/aidol_boot.png, /tmp/aidol_chart.png |

### 회귀 [regression]
| R1 | 기존 창작 플로우(맵/작사/작곡) 화면 — 웹 번들에 포함·컴파일 성공(전체 tsc 0, 번들 성공) | [e2e] | PASS(간접: 전체 번들·타입 0) |

> 주: R1 개별 화면 클릭 회귀는 Wave 1 이후 화면 추가 시 확대. 현재 ChartScreen 외 화면 미변경.
