# TESTPLAN_v3 — 팀: aidol-parity (test-designer)

> 2단계 게이트(1단계 unit·api → 2단계 e2e). 모바일 → E2E는 **Expo Web + Playwright**로 치환.
> 두 위치 동일 비치(2_housing + claude_skills_outputs/team-dev).

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
