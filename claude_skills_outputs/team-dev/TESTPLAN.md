# TESTPLAN — 팀: TripleJ-Studio-Dev (test-designer)

> 이전 기록은 TESTPLAN_v3.md 참조.

---

## v3.191 — 수정일 2026-09-19 — PlayerScreen 안전 영역 수정 (RN 코어 SafeAreaView → safe-area-context insets)

### 변경 요약 (테스트 대상)
- 파일: `2_housing/screens/PlayerScreen.tsx` (단일 파일 UI 레이아웃 변경, 서버 무관 → [api] 해당 없음)
- RN 코어 `SafeAreaView`(iOS 전용, Android no-op) 제거 → `react-native-safe-area-context`의 `useSafeAreaInsets()` + 루트 `View`에 `paddingTop: insets.top` / `paddingBottom: insets.bottom`
- 재생목록 `Modal`의 `queueSheet`에 하단 인셋 보강 (Modal은 루트 패딩을 상속하지 않으므로 시트 자체에 적용 필요)
- 배경: `app.json` android `edgeToEdgeEnabled: true` → Android에서 헤더가 상태바와, 하단 토글(`swipeUpButton`)이 제스처 바와 겹치던 문제

### 코드 기준점 (변경 전 좌표 — 정적 검증 시 대조)
- import 블록 `react-native`에 `SafeAreaView` 포함(구 12행), 루트 JSX `<SafeAreaView style={styles.container}>`(구 791행) / 닫힘(구 1299행)
- `queueSheet` 스타일: `padding: spacing.xl, paddingBottom: spacing.xxl`(구 1519~1523행)
- 커버 크기: `coverH = Math.max(180, Math.min(winW - 48, winH - 460))`(구 769행)
- 상세패널: `KeyboardAvoidingView`(iOS `padding` / Android undefined)(구 1027~1031행)
- `package.json`: `react-native-safe-area-context ~5.6.0` 이미 의존성 존재

---

### 1단계 — [unit] 정적·코드 레벨 검증 (에뮬레이터 불필요, 머지 게이트)

#### U-1. [unit] 타입 무결성
- Given: v3.191 변경이 반영된 워킹트리
- When: `2_housing`에서 `npx tsc --noEmit` 실행
- Then: 오류 0건 (PASS 기준: exit 0)

#### U-2. [unit] 코어 SafeAreaView 완전 제거 (정상)
- Given: `screens/PlayerScreen.tsx`
- When: `grep -n "SafeAreaView" screens/PlayerScreen.tsx`
- Then: `react-native` import 블록·JSX 어디에도 `SafeAreaView` 없음(0건). 루트가 일반 `View`로 교체되어 있음

#### U-3. [unit] 인셋 배선 존재 (정상)
- Given: 동일 파일
- When: `grep -n "useSafeAreaInsets\|react-native-safe-area-context" screens/PlayerScreen.tsx`
- Then: ① `import { useSafeAreaInsets } from 'react-native-safe-area-context'` ② 컴포넌트 본문에서 `const insets = useSafeAreaInsets()` 호출(훅 규칙: 최상위, 조건부 아님) ③ 루트 컨테이너 style에 `paddingTop: insets.top`과 `paddingBottom: insets.bottom` 둘 다 존재

#### U-4. [unit] SafeAreaProvider 전제 확인 (실패 케이스 예방)
- Given: 앱 루트(App.tsx 또는 내비게이션 루트)
- When: `grep -rn "SafeAreaProvider" App.tsx app/ navigation/ 2>/dev/null` (2_housing 기준)
- Then: Provider가 트리 상위에 존재. **없으면 FAIL** — `useSafeAreaInsets`가 초기값 0을 반환해 수정 자체가 무효(Android에서 증상 재발). NavigationContainer 내장 provider 사용 시 그 근거를 기록

#### U-5. [unit] queueSheet 하단 인셋 보강 (정상)
- Given: 재생목록 Modal(`queueSheet`)
- When: JSX에서 `styles.queueSheet`에 인라인으로 하단 인셋이 합성되는지 확인 (예: `[styles.queueSheet, { paddingBottom: spacing.xxl + insets.bottom }]` 또는 `Math.max(spacing.xxl, insets.bottom + spacing.md)` 류)
- Then: 시트의 최종 하단 패딩 ≥ `insets.bottom`. StyleSheet 정적 정의에만 상수로 남아 있고 JSX 합성이 없으면 FAIL (Modal은 루트 View 패딩 밖에 그려짐)

#### U-6. [unit] 이중 여백 금지 (경계 — iOS 회귀 지점 2번)
- Given: 변경 diff (`git diff -- screens/PlayerScreen.tsx`)
- When: 인셋 적용 지점을 전수 확인
- Then: ① 루트에 insets를 주면서 동시에 SafeAreaView(코어든 context판이든)로 또 감싸지 않음 ② `header.paddingTop`(기존 10)·`swipeUpButton.paddingBottom`(기존 18) 같은 기존 상수 패딩에 insets를 **중복 가산**해 상단/하단이 과도해지지 않음(가산했다면 상수를 줄인 근거가 diff에 있어야 함) ③ 상세패널(showDetails)·재생목록 시트에서 insets가 루트+자식에 겹으로 들어가지 않음

#### U-7. [unit] 인셋 0 기기 무회귀 (경계)
- Given: `insets = {top:0, bottom:0}`인 환경(웹 빌드, Android 3버튼 내비, 구형 무노치 기기)
- When: 적용식을 수식으로 검토 (예: `paddingBottom: insets.bottom` → 0)
- Then: 인셋 0일 때 레이아웃이 변경 전과 동일. `insets.bottom || 16` 같은 고정 폴백으로 0-인셋 기기에 유령 여백을 만들지 않음. 반대로 웹에서 `useSafeAreaInsets` 호출이 크래시하지 않음(safe-area-context는 웹 지원 — tsc·번들만으로 확인 가능, 의심 시 `npx expo export --platform web` 스모크)

#### U-8. [unit] coverH 산식 정합 (경계 — 회귀 지점 5번)
- Given: `coverH = Math.max(180, Math.min(winW - 48, winH - 460))`, `useWindowDimensions()`는 edge-to-edge에서 인셋 포함 전체 높이를 반환
- When: 작은 기기 수치 대입 검토 — 예: 640×360(구형 소형), 732×412(중형), 두 경우 모두 insets.top≈24~48, insets.bottom≈24(제스처 바) 가정
  - 640 기기: winH-460=180 → coverH=180(하한 발동). 패딩 추가로 가용 세로가 (top+bottom)≈48~72px 줄어든 상태에서 "커버(180)+트랙정보+재생바+컨트롤+액션+토글"이 세로 합산으로 winH-insets 안에 드는지 산술 확인
- Then: ① 상수 460이 insets를 이중으로 반영하도록 수정되지 않았음(산식 원형 유지 또는 변경 시 근거 기록) ② 하한 180 유지 ③ 산술상 오버플로가 나면 `flex:1` 스페이서(구 1010행)가 0으로 수축하고 토글은 일반 플로우 마지막 요소로 잔존 — 토글이 화면 밖으로 밀리는 경우 FAIL로 기록하고 E-5에서 실측

#### U-9. [unit] 변경 범위 격리 (회귀 지점 6번)
- Given: `git diff --stat` (v3.191 커밋 범위)
- When: 변경 파일 목록 확인
- Then: `screens/PlayerScreen.tsx` 외에 MiniPlayer·동영상 탭 컴포넌트(`LyricSyncView` 등)·`playerStore`·`services/playback`(큐 자동재생) 파일 무변경. 다른 파일이 섞였으면 해당 파일 회귀 시나리오를 별도 추가

#### U-10. [unit] KAV·인셋 상호작용 (경계 — 회귀 지점 3번의 정적 절반)
- Given: showDetails 패널 = `KeyboardAvoidingView behavior=padding(iOS)` + 루트 paddingBottom: insets.bottom
- When: 코드 검토 — KAV가 루트 패딩 **안쪽**에 있는지, `keyboardVerticalOffset` 추가 여부
- Then: iOS에서 키보드가 열릴 때 "insets.bottom + 키보드 높이"가 이중 가산되어 댓글 입력창 아래 유령 띠가 생기는 구조가 아님(키보드 높이에는 하단 인셋이 이미 포함됨 — offset을 넣었다면 근거 필수). Android는 behavior undefined 유지 확인

---

### 2단계 — [e2e] 핵심 사용자 여정 (Maestro 기준)

> 공통 전제: Android 에뮬레이터는 **제스처 내비게이션 + edge-to-edge** 프로파일(API 34+ 권장), iOS는 노치 기기(iPhone 15 시뮬레이터 등). 로그인 불요 — 샘플/공개 트랙으로 진행, 실계정 크리덴셜 사용 금지.
> 에뮬레이터 부재 시: 각 시나리오의 "정적 대체 검증"으로 다운그레이드하고, 최종 판정은 **사용자 실기기 확인 요청**(Android 제스처 기기 1대 + iPhone 노치 기기 1대 스크린샷)으로 대체한다.

#### E-1. [e2e] Android edge-to-edge — 플레이어 상·하단 안전 영역 (핵심 여정 1/2, planner 항목 1)
- Given: Android(edge-to-edge, 제스처 바) 홈/차트에서 임의 곡 존재
- When: 곡 탭 → PlayerScreen 진입
- Then(Maestro): `assertVisible: "Now Playing"` + chevron-down(accessibilityLabel "미니플레이어로 내려가기") 탭 가능 — 상태바에 가려지지 않음(스크린샷에서 헤더 y ≥ 상태바 높이). 스크롤 없이 `assertVisible: "가사 · 프롬프트 · 착장 · 댓글"` — 토글 전체가 제스처 바 위에 노출되고 탭 반응
- 정적 대체 검증: U-3(루트 insets.top/bottom) + U-6(이중 가산 없음) PASS를 근거로 하고, 사용자 실기기에서 "플레이어 최초 화면 풀샷 1장(상단 헤더·하단 토글 포함)" 요청

#### E-2. [e2e] 재생목록 Modal — 하단 가림·드래그 재정렬 (핵심 여정 2/2, planner 항목 4)
- Given: E-1 이어서, 큐에 곡 3곡 이상(담기 버튼으로 추가 — 비회원 첫 담기 시 안내 팝업 "계속 담기" 선택)
- When: 액션 행 "재생목록" 탭 → 시트 오픈
- Then(Maestro): ① 시트 최하단 항목의 제목·≡ 손잡이·삭제 버튼이 제스처 바에 겹치지 않고 완전 노출 ② ≡ 손잡이 long-press 드래그로 1↔2 순서 교체 → 목록 순서 갱신 확인(재정렬 회귀) ③ 배경 탭으로 닫힘 정상
- 실패 케이스: 큐 0곡 상태에서 열기 → "재생목록이 비어있어요" 문구가 시트 안(인셋 위)에 표시, 레이아웃 깨짐 없음
- 정적 대체 검증: U-5(queueSheet 인셋 합성) + `DraggableQueue` 파일 무변경(U-9). 사용자 실기기에서 "재생목록 시트 하단 스크린샷" 요청

#### E-3. [e2e] showDetails 상세패널 회귀 (planner 항목 3)
- Given: PlayerScreen 표시 중
- When: 하단 토글 탭 → 상세패널 확장 → 탭 4종(가사/프롬프트/착장/댓글) 순회 → 댓글 탭에서 입력창 포커스
- Then(Maestro): ① 상단 미니바(2px 진행바+커버40+⏮▶⏭+재생목록)가 상태바 아래 안전 영역 안에 렌더 ② 탭 전환 각각 콘텐츠 표시 ③ 키보드가 올라와도 댓글 입력창이 키보드 바로 위에 위치(KAV) — 입력 후 전송 버튼 첫 탭에 반응(keyboardShouldPersistTaps 회귀) ④ 핸들 탭 → 큰 플레이어 복귀, 하단 토글 재노출
- 실패 케이스: 키보드 연 채 핸들로 복귀 → 레이아웃 잔여 오프셋 없음
- 정적 대체 검증: U-10(KAV 구조) + diff에서 detailWrap/miniPlayerWrap 스타일 비변경 확인

#### E-4. [e2e] iOS 노치 — 이중 여백 없음 (planner 항목 2)
- Given: iPhone 노치 시뮬레이터, PlayerScreen 진입
- When: ① 기본 화면 ② 상세패널 열기 ③ 재생목록 시트 열기
- Then: 각 상태에서 상단 여백이 노치 높이 + 기존 헤더 패딩(10) 수준 — 코어 SafeAreaView 시절 대비 위로 밀리거나 두 배로 벌어지지 않음(before/after 스크린샷 픽셀 비교, 허용 오차 ±4px). 재생목록 시트 하단도 홈 인디케이터와 겹침·과잉 여백 모두 없음
- 정적 대체 검증: U-6(이중 여백 금지 diff 검토)이 1차 게이트. 사용자 iPhone 실기기 스크린샷 3장(기본/상세/재생목록) 요청

#### E-5. [e2e] 소형 기기 — 하단 토글 밀림 (경계, planner 항목 5)
- Given: 소형 프로파일 에뮬레이터(예: 640×360dp 또는 Nexus One급) + edge-to-edge
- When: PlayerScreen 진입(노래 탭, coverH 하한 180 발동 조건)
- Then: 스크롤 없이 하단 토글 완전 노출(제스처 바 위). 커버·재생바·컨트롤·액션 행이 겹치지 않음
- 정적 대체 검증: U-8 산술 검토 결과 첨부. 실기기 확보 불가 시 "소형 기기 사용자 제보 대기" 항목으로 REPORT에 명시

#### E-6. [e2e] 주변 회귀 스모크 — 미니플레이어·동영상 탭·큐 자동재생 (planner 항목 6)
- Given: PlayerScreen에서 재생 중
- When: ① chevron-down으로 내려가 탭바 위 미니플레이어 확인 ② 재진입 후 "동영상" 탭 전환 ③ (짧은 곡으로) 곡 종료까지 대기
- Then: ① 미니플레이어 위치·진행바·재생/일시정지 정상(이 화면은 이번 변경 범위 밖 — 위치 불변) ② 동영상 탭 정사각 프레임(coverH×coverH)이 노래 탭 커버와 동일 크기·위치, MV/가사싱크/빈 안내 3분기 렌더 ③ didJustFinish → 다음 곡 자동재생·재생바 이어짐(v3.99 BUG-2 회귀 방어)
- 정적 대체 검증: U-9(변경 범위 격리) — MiniPlayer·playback 서비스 diff 0이면 ①③은 코드 근거로 PASS 처리 가능, ②는 E-1 스크린샷에서 동영상 탭 1장 추가 요청

---

### 판정 기준
- 머지 게이트(필수): U-1 ~ U-10 전부 PASS
- 릴리즈 게이트: E-1 ~ E-4 PASS (에뮬레이터 부재 시 각 항목 "정적 대체 검증 PASS + 사용자 실기기 스크린샷 확인"으로 대체 가능, 대체 시 REPORT에 다운그레이드 사실 명기)
- E-5·E-6은 회귀 스모크 — FAIL 시 릴리즈 보류가 아닌 후속 픽스 티켓으로 분류 가능(단 E-6 ③ 자동재생 FAIL은 릴리즈 보류)

### 태그 집계
- [unit] 10건 (U-1~U-10: 정상 3 / 경계 4 / 실패 예방 1 / 회귀 2)
- [api] 0건 (순수 UI 레이아웃 변경 — 해당 없음)
- [e2e] 6건 (핵심 여정 E-1·E-2, 회귀 E-3·E-6, 플랫폼 경계 E-4·E-5 — 전 항목 정적 대체 검증 병기)

---

### 실행 결과 (tester, 2026-09-19)

#### 1차 게이트 [unit] — 10/10 PASS (머지 게이트 통과)

| 항목 | 판정 | 근거 |
|---|---|---|
| U-1 타입 무결성 | PASS | `npx tsc --noEmit` exit 0, 오류 0건 |
| U-2 코어 SafeAreaView 제거 | PASS | import·JSX 0건. 유일한 grep 히트는 167행 설명 주석. 루트 `<View>` 교체 확인(797행) |
| U-3 인셋 배선 | PASS | import 19행, `const insets = useSafeAreaInsets()` 168행(컴포넌트 최상위·무조건 호출), 루트 `paddingTop: insets.top` + `paddingBottom: insets.bottom` 797행 |
| U-4 SafeAreaProvider 전제 | PASS | `App.tsx:29` import, `App.tsx:483~551` 트리 최상위 래핑 |
| U-5 queueSheet 인셋 보강 | PASS | 1280행 `[styles.queueSheet, { paddingBottom: insets.bottom + spacing.xxl }]` — 인라인이 정적 paddingBottom(1529행) override, 최종 하단 패딩 ≥ insets.bottom |
| U-6 이중 여백 금지 | PASS | diff 11+/4- 전수 검토: SafeAreaView 재래핑 없음, `header.paddingTop:10`(1337행)·`swipeUpButton.paddingBottom:18`(1565행) 상수 무변경·insets 미가산, insets 사용처는 170(로그)/797(루트)/1280(Modal 시트) 3곳뿐 — Modal은 루트 패딩 밖 렌더이므로 겹침 아님 |
| U-7 인셋 0 무회귀 | PASS | 적용식 전부 순수 `insets.*` (고정 폴백 없음). insets=0 → 루트 패딩 0, queueSheet paddingBottom = spacing.xxl = 변경 전과 동일. 웹: safe-area-context 웹 지원 + tsc 통과 |
| U-8 coverH 산식 정합 | PASS(주의) | 775행 산식 원형 유지(상수 460·하한 180 무변경, insets 이중 반영 없음). 단 산술상 640dp급 소형기기는 winH-460=180으로 슬랙 0이므로 인셋 패딩(48~72px)만큼 세로 부족 가능 — swipeUpButton은 일반 플로우(절대배치 아님, 1561행) → E-5 실측 필요로 이관 |
| U-9 변경 범위 격리 | PASS | `git status --short -- screens/` = PlayerScreen.tsx 단독. MiniPlayer.tsx·LyricSyncView.tsx·DraggableQueue.tsx·playerStore.ts·services/playback.ts 전부 무변경. (stores/levelUpQueueStore.ts M은 레벨업 알림 큐 — 재생 큐와 무관한 기존 작업 잔여) |
| U-10 KAV·인셋 상호작용 | PASS | KAV(1034행)는 루트 패딩 안쪽, `keyboardVerticalOffset` 미추가, iOS `behavior='padding'`/Android undefined 유지(1036행) — 이중 가산 구조 아님 |

#### 2단계 [e2e] — 환경 부재로 전 항목 정적 대체 검증 수행

환경: `adb`·`maestro`·`emulator` 미설치, Android SDK/AVD 없음, Xcode 시뮬레이터 없음 → 계획된 다운그레이드 절차 적용(설치 시도 안 함).

| 항목 | 실행 방식 | 판정 | 근거/잔여 |
|---|---|---|---|
| E-1 Android edge-to-edge 상·하단 | 정적 대체 | PASS(정적) | U-3+U-6 PASS. 실기기 풀샷 1장 필요 |
| E-2 재생목록 Modal 하단·재정렬 | 정적 대체 | PASS(정적) | U-5 PASS + DraggableQueue 무변경(U-9). 빈 큐 문구(1288행)는 인셋 적용된 시트(1280행) 내부. 실기기 시트 하단 샷 필요 |
| E-3 showDetails 상세패널 회귀 | 정적 대체 | PASS(정적) | U-10 PASS + detailWrap(1625행)·miniPlayerWrap(1631행) diff 무변경 |
| E-4 iOS 노치 이중 여백 | 정적 대체 | PASS(정적) | U-6 PASS. 픽셀 비교 불가 — iPhone 실기기 샷 3장 필요 |
| E-5 소형 기기 토글 밀림 | 정적 대체 | UNVERIFIED | U-8 산술: 640dp 기기에서 최대 ~72px 세로 부족 가능(토글 절대배치 아님). 소형 실기기 실측 또는 사용자 제보 대기 |
| E-6 미니플레이어·동영상탭·자동재생 | 정적 대체 | ①③ PASS(정적) / ② UNVERIFIED | MiniPlayer·playback diff 0 → ①③ 코드 근거 PASS. ② 동영상 탭은 실기기 샷 1장 필요 |

#### 디버그 로그 확인
- `[PlayerScreen] safe-area insets` 존재 확인: PlayerScreen.tsx 170행, `__DEV__` 가드 하 `console.info` — 정상.

#### 종합
- 머지 게이트: **통과** (U-1~U-10 전부 PASS). 버그 0건.
- 릴리즈 게이트: 정적 대체 PASS — 사용자 실기기 스크린샷 확인 후 확정 (다운그레이드 사실 명기).
- 실기기 확인 요청 목록: ① Android 제스처 기기 — 플레이어 최초 화면 풀샷(헤더+하단 토글) ② 동일 기기 — 재생목록 시트 하단 샷 ③ iPhone 노치 기기 — 기본/상세패널/재생목록 3장 ④ (가능 시) 소형 기기 — 하단 토글 노출 여부 ⑤ Android — 동영상 탭 1장
