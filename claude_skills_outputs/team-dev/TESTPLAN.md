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

---

## v3.192 — 수정일 2026-09-20 — duration 방어 보정 + Marquee 네이티브 1줄 수정 + 백엔드 duration 수정요청 문서

### 변경 요약 (테스트 대상)
1. **duration 방어 보정** — `2_housing/screens/PlayerScreen.tsx`(onPlaybackStatusUpdate + recordPlayIfNeeded) / `2_housing/services/playback.ts`(createAsync status 콜백): `effectiveDuration = max(engine durationMillis, positionMillis, api duration_sec*1000)`. 배경: 냥냥냥(Xing 헤더 없는 VBR MP3)은 엔진·API 모두 91초로 오판, 실제 157.86초 → 진행바가 1:31에 조기 고정. 70% 재생기록도 동일 기준. 괴리 5초+ 시 `__DEV__` 경고 로그.
2. **Marquee 네이티브 수정** — `2_housing/components/Marquee.tsx`: 측정 트랙을 `horizontal ScrollView(scrollEnabled=false)`로 감싸 자연폭 측정 + `numberOfLines={1}`. 긴 제목("더 나오려는 것을 막는 것일뿐" 등)이 네이티브에서 개행 → 하단 컨트롤 밀림 해소. **웹 무회귀 요건**(NOWRAP·useNativeDriver 웹 분기 보존).
3. **백엔드 수정요청 문서 신규** — `2_housing/백엔드_요청_트랙duration.md` (코드 아님 — 존재·내용 검증만. 작성 시점 현재 미존재 확인됨).
- **변경 금지**: 큐 자동 추가 동작(이슈 C — `ChartScreen.tsx:177 addToQueue`, `playerStore.addToQueue` 중복 거부) 무변경 확인 대상.

### 코드 기준점 (변경 전 좌표 — 정적 검증 시 대조)
- `screens/PlayerScreen.tsx`: `PLAY_RECORD_RATIO = 0.7`(339행), `recordPlayIfNeeded(positionMillis, durationMillis)`(340~351행, `recordedTrackRef` 186행 — 트랙당 1회 가드), `onPlaybackStatusUpdate`(353행) 내 `setDuration(status.durationMillis || 0)`(360~361행)·`recordPlayIfNeeded(..., status.durationMillis || 0)`(365행), 제목 Marquee(868행 `variant="title1" center`)
- `services/playback.ts`: `loadAndPlayTrack` createAsync 콜백(98~115행) 내 `s.setDuration(status.durationMillis || 0)`(103행) — **여기도 보정 필요**(미니/인라인 재생 경로)
- `components/Marquee.tsx`: 컨테이너 onLayout(47행)·텍스트 onLayout(54행) 측정, `overflow = textW > containerW + 1`(26행), `copy: { flexShrink: 0, ...NOWRAP }`(73행, NOWRAP은 웹 전용 19행), `useNativeDriver: Platform.OS !== 'web'`(39행)
- `components/TrackRow.tsx`: 65행 `<Marquee text={track.title} .../>`(차트 행)
- 트랙 스키마: `duration_sec?: number`(PlayerScreen 99행 — optional, 없는 트랙 존재 가능)

---

### 1단계 — [unit] 정적·코드 레벨 검증 (에뮬레이터 불필요, 머지 게이트)

> 재생 엔진(expo-av) 실동작이 필요한 검증은 2단계로 분리. 1단계는 보정식·배선·경계 케이스를 코드 레벨(식 대입·grep·diff)로 판정한다. `effectiveDuration` 계산이 순수 함수/식으로 분리돼 있으면 표의 케이스를 그대로 대입 검토, 인라인이면 코드 리딩으로 동치 확인.

#### U-1. [unit] 타입 무결성
- Given: v3.192 변경이 반영된 워킹트리
- When: `2_housing`에서 `npx tsc --noEmit`
- Then: 오류 0건 (exit 0)

#### U-2. [unit] 보정식 이중 배선 (정상 — 핵심)
- Given: `screens/PlayerScreen.tsx` + `services/playback.ts`
- When: `grep -n "effectiveDuration\|duration_sec" screens/PlayerScreen.tsx services/playback.ts`
- Then: **두 파일 모두** status 콜백에서 `max(status.durationMillis, status.positionMillis, track.duration_sec*1000)` 동치의 보정값으로 `setDuration`을 호출. 한쪽(특히 playback.ts 103행 경로 — 미니플레이어/피드 재생)만 고치고 다른 쪽이 `status.durationMillis || 0` 원형으로 남아 있으면 FAIL

#### U-3. [unit] 경계 — engine duration null/undefined/0
- Given: 보정식에 `status.durationMillis = undefined`(스트리밍 초기 상태에서 실제 발생), `= null`, `= 0` 각각 대입
- When: `positionMillis = 3000`, `duration_sec = 91` 가정
- Then: `effectiveDuration = 91000` (api 폴백). `undefined`가 `Math.max`에 직접 들어가 `NaN`이 되는 구조면 FAIL — `?? 0` 또는 `|| 0` 정규화 후 max 필수. NaN이 setDuration에 흘러가면 진행바 분모가 깨진다

#### U-4. [unit] 경계 — 시작 직후 position=0 + 메타데이터 전무
- Given: `durationMillis = 0/undefined`, `positionMillis = 0`, `duration_sec` 없음(optional 필드 — 구 업로드 트랙)
- When: 보정식 대입
- Then: `effectiveDuration = 0` → 기존 `setDuration(0)`과 동일 거동(진행바 0/0 가드는 기존 로직 유지), `recordPlayIfNeeded`는 341행 `durationMillis <= 0` 가드로 무기록. 0 대신 NaN/음수가 나오면 FAIL

#### U-5. [unit] 경계 — 3값 대소 조합 매트릭스
- Given: 보정식에 아래 조합 대입 (단위 ms)
  | # | engine | position | api*1000 | 기대 effectiveDuration | 비고 |
  |---|---|---|---|---|---|
  | a | 91000 | 45000 | 91000 | 91000 | 냥냥냥 전반부 — 보정 무발동 |
  | b | 91000 | 95000 | 91000 | 95000 | 냥냥냥 91초 초과 — position 추종 확장 |
  | c | 91000 | 150000 | 157860 | 157860 | 백엔드 수정 후 — api가 상한 제공 |
  | d | 144000 | 30000 | 144000 | 144000 | 정상곡(사랑의 김장) — 무해성 |
  | e | 144000 | 30000 | 0/없음 | 144000 | api 결측 정상곡 — 무해성 |
  | f | 91000 | 100000 | 157860 | 157860 | position이 api보다 작고 engine보다 클 때 |
  | g | 157860 | 100000 | 91000 | 157860 | api가 과소일 때 engine 우선 |
- Then: 전 행 일치. 특히 d·e에서 **정상곡 duration이 1ms도 변하지 않음**(보정 무해성 — planner 항목 2의 코드 레벨 절반)

#### U-6. [unit] 경계 — seek 점프와 단조성
- Given: 사용자가 seek로 `positionMillis`를 96000 → 40000으로 되돌린 직후의 status
- When: 보정식이 **status 단발 입력만** 쓰는지, 이전 확장값을 상태로 유지하는지 확인
- Then: 구현 방식 판정 기록 — ① status 단발식이면 position 40000에서 effectiveDuration이 91000으로 **수축**해 진행바 총시간이 뒤로 줄어드는 깜빡임 발생 가능(수축 허용 여부를 diff 주석/구현 근거로 확인; `max(이전 duration, ...)` 래칫이면 수축 없음) ② 래칫 구현이면 U-7의 곡 전환 리셋이 필수 짝 — 둘 다 없으면 FAIL. 진행바 ratio(`position/duration`)가 1을 초과하는 프레임이 구조적으로 불가능한지 확인

#### U-7. [unit] 경계 — 곡 전환 시 상태 리셋
- Given: 냥냥냥(확장된 duration ≈157s) 재생 중 → 다음 곡(91s 정상곡) 전환 (didJustFinish 자동·수동 스킵·큐 탭 3경로)
- When: 전환 경로에서 duration 관련 상태(래칫 ref/스토어 duration)가 리셋되는지 코드 추적 — PlayerScreen didJustFinish(366행~)·`loadAndPlayTrack` 진입부·`playTrackAtIndex`
- Then: 새 곡 첫 status에서 이전 곡의 확장값(157s)이 **잔존해 max에 섞이지 않음**. 잔존하면 다음 곡 총시간이 157s로 표시되는 회귀 — FAIL. `recordedTrackRef`는 트랙 id 비교(343행)라 리셋 불요이나, 보정용 ref를 새로 추가했다면 곡 전환 시 초기화 코드 필수

#### U-8. [unit] 70% 재생기록 기준 통일 (정상 + 한계 명시)
- Given: `recordPlayIfNeeded` 호출부(365행)와 시그니처
- When: 보정 후 코드 확인
- Then: ① 기록 판정 분모가 `effectiveDuration`(setDuration에 넣는 값과 동일 기준)으로 통일 — 진행바와 기록이 다른 duration을 보면 FAIL ② `recordedTrackRef` 트랙당 1회 가드 유지, `durationMillis <= 0` 가드 유지 ③ **한계 명시(REPORT 기재 의무)**: 백엔드 미수정 상태의 냥냥냥은 engine·api 모두 91s이므로 position 63.7s(=91×0.7) 시점 조기 기록이 **보정만으로는 해소되지 않음**(입력 3값 중 어느 것도 157.86을 모름). 이는 버그가 아니라 백엔드 수정(문서 U-12) 대기 항목 — 보정의 책임 범위는 "과소 duration으로 인한 진행바 고정 + 정상곡 기록 무변화"까지

#### U-9. [unit] 괴리 경고 로그 (정상)
- Given: 보정식 인접 코드
- When: `grep -n "__DEV__" screens/PlayerScreen.tsx services/playback.ts` 중 duration 관련 신규 로그 확인
- Then: `effectiveDuration - durationMillis > 5000`(5초+) 조건에서만 경고 출력, `__DEV__` 가드 필수(프로덕션 무로그), 매 status 틱(≈500ms)마다 반복 출력되지 않도록 1회성 가드(트랙당) 권장 — 무가드 반복 로그면 PASS(주의)로 기록. 로그에 트랙 제목 등만 — 사용자 식별정보 금지

#### U-10. [unit] Marquee 구조 변경 (정상)
- Given: `components/Marquee.tsx`
- When: `grep -n "ScrollView\|numberOfLines\|scrollEnabled" components/Marquee.tsx`
- Then: ① 측정 트랙이 `horizontal` + `scrollEnabled={false}` ScrollView로 래핑 ② 표시 텍스트에 `numberOfLines={1}` ③ 텍스트 onLayout 측정(구 54행)과 overflow 판정식(구 26행 `textW > containerW + 1`) 로직 보존 ④ `showsHorizontalScrollIndicator={false}` 권장(없으면 PASS(주의))

#### U-11. [unit] Marquee 웹 무회귀 (경계 — 명시 요건)
- Given: 동일 파일 diff
- When: 웹 분기 3종 확인
- Then: ① `NOWRAP`(19행 `whiteSpace: 'nowrap'` 웹 전용) 유지 ② `useNativeDriver: Platform.OS !== 'web'`(39행) 유지 ③ ScrollView 래핑이 웹에서 스크롤바·포커스 트랩을 만들지 않는 구조(scrollEnabled=false + indicator 숨김). 검증: `npx tsc --noEmit` + (의심 시) `npx expo export --platform web` 스모크 빌드 성공. 짧은 텍스트(overflow=false) 경로에서 `center` prop 정렬(48행) 보존 — 플레이어 제목 가운데 정렬 회귀 방지

#### U-12. [unit] 백엔드 수정요청 문서 존재·내용 (정상)
- Given: `2_housing/백엔드_요청_트랙duration.md` (현재 미존재 — 신규 생성 확인)
- When: `test -f` + 내용 리뷰
- Then: ① 파일 존재 ② 필수 내용: 증상(냥냥냥 duration_sec=91 vs 실제 157.86초), 원인(Xing/Info 헤더 없는 VBR MP3 — 첫 프레임 비트레이트×파일크기 추정 오차), 요청사항(전수 재스캔 또는 해당 트랙 duration_sec 갱신 — 정확 산출 방법 제안 포함), 앱 측 임시 보정(v3.192)의 한계(70% 조기 기록은 서버 수정 필요) ③ 코드 변경 아님 — 이 문서로 인한 앱 diff 없음 ④ 민감정보(계정·토큰·개인 이메일·실사용자 데이터) 미포함

#### U-13. [unit] 변경 범위 격리 + 이슈 C 무변경 (회귀)
- Given: `git diff --stat` (v3.192 커밋 범위)
- When: 변경 파일 목록 확인
- Then: ① 코드 변경은 `screens/PlayerScreen.tsx`·`services/playback.ts`·`components/Marquee.tsx` 3파일 + 신규 문서 1건으로 한정 ② **이슈 C**: `screens/ChartScreen.tsx`(177행 `addToQueue`)·`stores/playerStore.ts`(88행~ addToQueue 중복 거부 로직)·`components/TrackRow.tsx` diff 0 — 큐 자동 누적 추가(중복 방지) 동작 코드 무변경 ③ `autoContinueWithRelated`(playback.ts 31~82행) 무변경 — 관련곡 이어듣기 회귀 방지. 다른 파일이 섞였으면 해당 회귀 시나리오 추가

---

### [api] 보조 검증

#### A-1. [api] 트랙 duration_sec 스키마·냥냥냥 현황 확인 (보정 입력값 근거)
- Given: 로컬/개발 백엔드 기동 상태
- When: `GET /api/tracks/{냥냥냥 id}` (또는 차트 응답에서 해당 트랙)
- Then: ① `duration_sec` 필드 존재·number 타입 ② 백엔드 미수정 시점 값 = 91 기록(보정식 c/f 케이스의 전제 데이터) ③ **백엔드 수정 후 재실행 항목**: 값이 158(±1)로 갱신되면 E-1의 "수정 후" 분기 실측 개시. 서버 미기동 시 스키마 grep(`duration_sec` — 백엔드 serializer)으로 대체하고 UNVERIFIED(환경) 기록

---

### 2단계 — [e2e] 핵심 사용자 여정

> 공통 전제: v3.191과 동일(Android 제스처+edge-to-edge / iOS 노치, 실계정 크리덴셜 금지, 샘플·공개 트랙 사용). 에뮬레이터 부재 시 각 항목 "정적 대체 검증"으로 다운그레이드 + 사용자 실기기 확인 요청(v3.191 관행).

#### E-1. [e2e] 냥냥냥 재생 — 진행바 조기 고정 해소 (핵심 여정 1/3, planner 항목 1)
- Given: 냥냥냥 트랙 재생 시작 (백엔드 **미수정** 상태)
- When: 1:31(91s) 경과 지점까지 재생 지속
- Then: ① 총시간 표시가 1:31에 **박히지 않고** position이 91s를 넘는 순간부터 재생 진행에 따라 확장(1:32, 1:33, …) ② 진행바 thumb이 우측 끝에 고정되어 떨리지 않음(ratio ≤ 1 유지) ③ 재생이 91s에서 끊기지 않고 실제 끝(≈2:38)까지 지속 ④ `__DEV__` 콘솔에 괴리 경고 1건
- **백엔드 미수정 한계 명시**: 이 상태에서 검증 가능한 것은 "position 초과 시 확장"뿐. 총시간 2:38 선표시·가사 싱크 끝까지·임의 지점 seek 정확도는 **백엔드 duration_sec 갱신 후**(A-1 ③ 확인 후) 재실측 항목으로 분리 기록
- 정적 대체 검증: U-2(이중 배선)+U-5 b행(확장식)+U-6(ratio ≤ 1 구조) PASS 근거. 사용자 실기기에서 "냥냥냥 1:31 초과 시점 스크린샷(총시간 표시 포함) + 끝까지 재생 여부" 요청

#### E-2. [e2e] 정상곡 무해성 — 사랑의 김장(144s) (planner 항목 2)
- Given: duration 정상 트랙(사랑의 김장 144s 등) 재생
- When: 시작 직후·중반·종료 직전 3시점 관찰
- Then: 총시간 2:24 고정 표시(변경 전과 동일), 진행바·시간 라벨 이상 없음, 괴리 경고 로그 없음
- 정적 대체 검증: U-5 d·e행 PASS. 실기기 요청 불요(위험도 낮음 — 정적으로 종결 가능)

#### E-3. [e2e] 70% 재생기록 — 트랙당 1회·중복 없음 (planner 항목 3)
- Given: 정상곡 재생 + `__DEV__` 콘솔 관찰
- When: ① 70% 지점 통과 ② seek로 70% 앞뒤 왕복 3회 ③ 같은 곡 이어서 끝까지
- Then: `[PlayerScreen] 70% 재생 기록` 로그·`POST /charts/record-play` **정확히 1회**(네트워크 로그 확인), seek 왕복에도 중복 발화 없음. 곡을 바꿨다가 같은 곡 재진입 시 재기록 여부는 기존 정책(recordedTrackRef 생존 범위) 그대로 — 변경되었으면 FAIL
- 정적 대체 검증: U-8 ①② PASS + `recordedTrackRef` 가드 diff 무변경. 냥냥냥 조기 기록 건은 U-8 ③ 한계로 REPORT 이관

#### E-4. [e2e] 긴 제목 플레이어 — 1줄 마퀴·레이아웃 무밀림 (핵심 여정 2/3, planner 항목 4)
- Given: 긴 제목 곡("더 나오려는 것을 막는 것일뿐" 등) PlayerScreen 진입 (네이티브)
- When: 진입 직후 + 5초 관찰
- Then: ① 제목이 **1줄** 유지(개행 없음) + 좌우 흐름 애니메이션 반복 ② 제목 아래 아티스트·재생바·컨트롤·하단 토글이 변경 전 위치 — 하단 컨트롤/토글 잘림·밀림 없음(v3.191 E-1 스크린샷과 비교) ③ 짧은 제목 곡으로 전환 → 애니메이션 **없이** 정적 가운데 정렬(center prop) ④ 마퀴 영역 좌우 스와이프해도 수동 스크롤되지 않음(scrollEnabled=false)
- 정적 대체 검증: U-10(구조)+U-11 ③(center 보존) PASS. 사용자 실기기 "긴 제목 곡 플레이어 풀샷 + 짧은 제목 곡 1장" 요청

#### E-5. [e2e] 차트 TrackRow 마퀴 + 웹 무회귀 (핵심 여정 3/3, planner 항목 5)
- Given: ① 네이티브 차트 화면에 긴 제목 곡 노출 ② 웹 빌드(`expo start --web` 또는 export) 동일 화면
- When: 차트 리스트 스크롤·정지 관찰
- Then: ① 네이티브 TrackRow 제목 1줄 마퀴, 행 높이 불변(개행으로 행이 두꺼워지지 않음) ② 웹: 기존과 동일하게 마퀴 동작(nowrap·JS 드라이버), 스크롤바 미노출, 리스트 세로 스크롤 방해 없음
- 정적 대체 검증: U-10+U-11 PASS + `npx expo export --platform web` 빌드 성공. 웹은 로컬 브라우저로 실측 가능(에뮬레이터 불요) — **웹 실측은 다운그레이드 대상 아님**, 네이티브 절반만 실기기 샷 요청

#### E-6. [e2e] v3.191 안전영역 무회귀 (planner 항목 6)
- Given: Android 제스처 기기(또는 정적 대체) PlayerScreen
- When: ① 기본 화면 ② 하단 토글로 상세패널 ③ 재생목록 시트
- Then: 헤더 상태바 겹침 없음·하단 토글 제스처 바 위 노출·시트 하단 인셋 유지 — v3.191 E-1·E-2·E-3 기준 동일
- 정적 대체 검증: v3.192 diff에서 PlayerScreen의 insets 배선 3곳(19·168·797·1280행 상당)이 **건드려지지 않았는지** diff 라인 대조(duration·Marquee 변경이 레이아웃 코드와 교차하지 않음). 교차 시에만 실기기 재확인 요청

#### E-7. [e2e] 이슈 C 무변경 — 차트 클릭 큐 누적 (planner 항목 7)
- Given: 차트 화면, 빈 큐(또는 기존 큐 확인)
- When: ① 곡 A 탭 → 재생 ② 곡 B 탭 ③ 곡 A 다시 탭
- Then: ① A 재생 + 큐에 A ② B 재생 + 큐 [A, B] 누적(교체 아님) ③ A 중복 추가 없음(addToQueue false 경로) — 재생목록 시트에서 큐 내용으로 확인. 변경 전과 완전 동일 동작
- 정적 대체 검증: U-13 ②(ChartScreen 177행·playerStore addToQueue diff 0) PASS면 코드 근거로 PASS 처리 가능

---

### 판정 기준
- 머지 게이트(필수): U-1 ~ U-13 전부 PASS (PASS(주의) 허용 항목: U-9 반복 로그, U-10 ④)
- 릴리즈 게이트: E-1(미수정 분기)·E-4·E-5(웹 절반 실측 필수) PASS. 에뮬레이터 부재 시 정적 대체 PASS + 사용자 실기기 확인으로 대체(REPORT에 다운그레이드 명기, v3.191 관행)
- E-2·E-3·E-6·E-7은 회귀 스모크 — 정적 대체로 종결 가능. 단 E-3 중복 기록 FAIL·E-7 큐 동작 변경 FAIL은 릴리즈 보류
- 후속(백엔드 수정 후): A-1 ③ 재확인 → E-1 "수정 후" 분기(총시간 2:38 선표시, 가사 끝까지, seek 정확) 재실측 — 본 버전 게이트에는 미포함

### 태그 집계
- [unit] 13건 (U-1~U-13: 정상 5 / 경계 6 / 회귀 2 — duration 보정 경계 케이스 U-3~U-7 매트릭스 포함)
- [api] 1건 (A-1: duration_sec 스키마·냥냥냥 현황 — 백엔드 수정 후 재실행 항목 겸용)
- [e2e] 7건 (핵심 여정 E-1·E-4·E-5, 무해성 E-2, 기록 E-3, 무회귀 E-6·E-7 — 전 항목 정적 대체 검증 병기, E-5 웹 절반은 로컬 실측 가능)

---

### v3.192 테스트 결과 (tester — 2026-09-20 실행)

> 실행 환경: 에뮬레이터/adb/maestro 부재 확인(adb·emulator·maestro not found, 부팅된 iOS 시뮬레이터 없음) → e2e 네이티브 항목은 계획된 "정적 대체 검증"으로 다운그레이드. 웹은 `expo export --platform web` 실빌드 + 로컬 서빙 브라우저 실측 수행.

#### [unit] 판정 표 (머지 게이트)

| 항목 | 판정 | 근거 요약 |
|---|---|---|
| U-1 타입 무결성 | PASS | `npx tsc --noEmit` exit 0, 오류 0건 |
| U-2 보정식 이중 배선 | PASS | PlayerScreen.tsx:365~367 + playback.ts:108~110 두 콜백 모두 `Math.max(engine, position, apiSec*1000)` → `setDuration(effectiveDuration)`. 원형 `status.durationMillis \|\| 0` 잔존 없음 |
| U-3 engine null/undefined/0 | PASS | PlayerScreen `?? 0`·playback `\|\| 0` 정규화 후 max → (und/null/0, 3000, 91000)=91000. NaN 유입 불가 |
| U-4 전무 케이스 | PASS | max(0,0,0)=0 → setDuration(0) 기존 거동. recordPlayIfNeeded 342행 `!durationMillis \|\| <=0` 가드로 무기록 |
| U-5 3값 매트릭스 a~g | PASS | 전 행 일치(a 91000/b 95000/c 157860/d 144000/e 144000/f 157860/g 157860). d·e 정상곡 duration 불변(무해성) — 양 파일 동일식 |
| U-6 seek 되감기 | PASS(주의) | **status 단발식(래칫 아님)** 확정. 96000→40000 되감기 시 max(91000,40000,91000)=91000으로 **수축 발생**(총시간 라벨 1:36→1:31 복귀 깜빡임 — 오판 트랙+확장 후 되감기에서만). ratio≤1은 구조 보장(duration=max(...,position)≥position, 동일 status 틱에서 position·duration 동시 갱신). FAIL 조건(래칫인데 리셋 없음)에 비해당. 주의: 수축 허용을 명시한 주석은 없음(주석은 "실시간 확장"만 언급) |
| U-7 곡 전환 리셋 | PASS | 래칫 상태 없음 → 이전 확장값이 max에 섞일 경로 자체가 없음. 3경로(didJustFinish 394행·switchToTrack 718행·playback playTrackAtIndex→loadAndPlayTrack) 모두 사운드 생성 **전에** `playTrackAtIndex`가 store.track 교체 → 새 곡 첫 status의 `liveTrack.duration_sec`은 새 곡 값. durationWarnedRef/durationWarnedTrackId는 트랙 id 비교식이라 리셋 불요 |
| U-8 70% 기준 통일 | PASS | ① 385행 `recordPlayIfNeeded(status.positionMillis, effectiveDuration)` — setDuration과 동일 분모 ② recordedTrackRef(344행)·durationMillis<=0(342행) 가드 무변경 ③ **한계(REPORT 기재)**: 백엔드 미수정 냥냥냥은 3값 모두 91000 → 63.7s 조기 기록 잔존(보정 입력 중 어느 것도 157.86 미인지 — 문서 U-12 백엔드 수정 대기) |
| U-9 괴리 경고 로그 | PASS | 양 파일 `__DEV__` 가드 + `effectiveDuration-engineDurationMs >= 5000` + 트랙당 1회 가드(PlayerScreen durationWarnedRef 187행 / playback durationWarnedTrackId 23행). 로그 내용 trackId·apiSec·engineMs·positionMs — 개인정보 없음 |
| U-10 Marquee 구조 | PASS | horizontal+scrollEnabled={false} ScrollView 래핑(52~57행), numberOfLines={1} 양쪽 카피(63·72행), 텍스트 onLayout(65행)·overflow 판정식(29행 `textW > containerW + 1`) 보존, showsHorizontalScrollIndicator={false}(55행) 포함 — ④까지 충족 |
| U-11 Marquee 웹 무회귀 | PASS | NOWRAP 웹 전용(22행)·useNativeDriver `Platform.OS !== 'web'`(42행) 유지. `expo export --platform web` 성공 + 브라우저 실측: 스크롤바 미노출·세로 스크롤 정상. center 경로: scrollContent/track flexGrow:1(84~85행)로 짧은 텍스트 시 컨테이너 폭 유지 → center 정렬 보존 |
| U-12 백엔드 문서 | **FAIL(경미 — 문서 1줄 보강)** | 파일 존재 ✓, 증상(91 vs 157.86) ✓, 원인(Xing/Info 없는 VBR — 첫 프레임 320kbps CBR 추정=91.26s 역산 일치) ✓, 요청(재먹싱+duration 158 갱신·ffprobe 실측 파이프라인·전수 5초+ 괴리 점검) ✓, 민감정보 없음 ✓, 코드 diff 없음 ✓. **누락**: 필수 내용 중 "앱 보정 한계 — 70% 재생기록 조기 발화(63.7s)는 서버 수정 필요" 미기재(15행은 seek 정확도·엔진 인식만 언급) |
| U-13 변경 범위 격리 | PASS(주의) | v3.192 diff: PlayerScreen.tsx(+24/-4)·playback.ts(+18/-1)·Marquee.tsx(+34/-20) + 신규 문서 1건. **이슈 C 대상 ChartScreen.tsx·playerStore.ts·TrackRow.tsx diff 0** ✓. autoContinueWithRelated(34~85행) 무변경 ✓. 주의: 워킹트리에 v3.192와 무관한 기존 변경 잔존(app.json 번들ID·eas.json·metro.config.js·package.json/lock·authService.ts 주석 1줄·다수 mode-only 변경) — **커밋 시 4파일로 스코프 한정 필요** |

#### [api] 판정 표

| 항목 | 판정 | 실행 방식 |
|---|---|---|
| A-1 duration_sec 현황 | PASS | 공개 무인증 `GET https://api.maidol.ai.kr/api/tracks/6aa3ec295f11b57ba518f5e8` 200 → `duration_sec: 91` (int) — 백엔드 미수정 기준값 실측 확인(U-5 c/f 전제 성립). ③ 백엔드 수정 후 158(±1) 재확인 항목으로 존치 |

#### [e2e] 판정 표 (에뮬레이터 부재 — 정적 대체, v3.191 관행)

| 항목 | 판정 | 실행 방식 |
|---|---|---|
| E-1 냥냥냥 확장 | PASS(정적 대체) | U-2+U-5 b행+U-6(ratio≤1 구조) 근거. 실기기 확인 요청 잔여 |
| E-2 정상곡 무해성 | PASS(정적 종결) | U-5 d·e행 — 실기기 불요 |
| E-3 70% 기록 1회 | PASS(정적 종결) | U-8 ①② + recordedTrackRef diff 무변경. 냥냥냥 조기 기록은 U-8 ③ 한계로 이관 |
| E-4 긴 제목 1줄 마퀴 | PASS(정적 대체) | U-10+U-11(center 보존) 근거. 실기기 스크린샷 요청 잔여 |
| E-5 차트 마퀴+웹 | 웹 절반 **PASS(실측)** / 네이티브 절반 정적 대체 | 웹: export 빌드 서빙 → 375px 모바일 뷰포트에서 TOP100 3위 "더 나오려는 것을 막는 것일뿐" **1줄 마퀴 애니메이션 동작 실측**(두 시점 스크린샷에서 텍스트 위치 이동 확인), 행 높이 균일(개행 없음), 가로 스크롤바 미노출, 세로 리스트 스크롤 정상, 콘솔 에러 0건 |
| E-6 안전영역 무회귀 | PASS(정적 종결) | PlayerScreen diff가 184~188행(ref 선언)·357~385행(status 콜백)에 한정 — insets 배선 코드 미접촉 |
| E-7 이슈 C 무변경 | PASS(정적 종결) | U-13 ② diff 0 근거 |

#### 발견 이슈
1. **[U-12 FAIL — app-dev 조치]** `2_housing/백엔드_요청_트랙duration.md` 15행 부근에 앱 보정 한계 1줄 추가: "70% 재생기록(별 적립)도 duration_sec=91 기준으로 63.7초에 조기 발화 — 서버 duration 갱신 전까지 해소 불가". 코드 변경 아님.
2. **[U-6 주의 — 기록만, 수정 불요]** seek 되감기 시 총시간 라벨 수축(1:36→1:31) 깜빡임 가능 — duration 오판 트랙에서 91s 초과 재생 후 되감을 때만. 래칫 미채택의 트레이드오프(래칫이면 곡 전환 리셋 필요)로 허용 판정. 원하면 주석 1줄로 의도 명시 권장.
3. **[U-13 주의 — 커밋 위생]** v3.192 커밋은 `screens/PlayerScreen.tsx`·`services/playback.ts`·`components/Marquee.tsx`·`백엔드_요청_트랙duration.md` 4파일로 한정할 것(워킹트리의 무관 변경 혼입 방지).

#### 1차 게이트 판정
- **조건부 통과**: U-1~U-11·U-13 PASS(허용 범위 내 주의 2건 — U-6은 U-9 유형의 기록성 주의로 처리). **U-12 경미 FAIL 1건**(문서 1줄 누락 — 코드 무관)만 보강되면 머지 게이트 충족. 릴리즈 게이트는 E-5 웹 절반 실측 PASS 확보, E-1·E-4 네이티브는 실기기 확인 대기.

#### 실기기 확인 요청 (사용자 안내)
1. 냥냥냥 재생: 1:31을 넘겨 계속 재생되는지 + 총시간 표시가 1:32, 1:33…으로 늘어나는 순간 스크린샷 1장, 끝(≈2:38)까지 재생되는지 여부
2. 긴 제목 곡("더 나오려는 것을 막는 것일뿐") 플레이어 화면 풀샷 1장(제목 1줄 흐름 + 하단 컨트롤 위치) + 짧은 제목 곡 1장(가운데 정렬 확인)
3. 차트 화면에서 긴 제목 행이 1줄로 흐르는지(행 높이 불변) 확인

## v3.193 — 수정일 2026-09-20

> 대상: NowPlaying 좋아요 서버 연동(A) · 담기→플레이리스트 담기(B) · 액션행 정렬 통일(C) · 비로그인 CTA 통일(E) · 스플래시 타이포 축소(F) · 상단바 로고 분절(G) + 무변경 확인(D) + v3.191/v3.192 무회귀(H).
> 실행 환경 관행(v3.191~192 계승): 에뮬레이터/adb/maestro 부재 → [e2e]는 각 항목에 "정적 대체 검증"을 병기하고, 네이티브 실측은 실기기 확인 요청으로 이관. 코드 경로는 `/Users/pearl/TripleJ/2_housing` 기준.
> 변경 허용 파일(격리 기준): `screens/PlayerScreen.tsx`, `screens/PlaylistScreen.tsx`, `screens/SearchScreen.tsx`, `screens/SplashScreen.tsx`, `App.tsx` — 이 5개 외 diff는 FAIL(단 v3.192 커밋 잔여분은 제외 판단).

### [unit] 정적 검증 (머지 게이트)

**U-1. 타입 무결성 [unit]**
- Given: v3.193 변경이 적용된 워킹트리.
- When: `cd 2_housing && npx tsc --noEmit`.
- Then: exit 0, 오류 0건. (특히 B의 `trackIds: string[]` — `track.id`가 number일 가능성 대비 `[String(track.id)]` 변환 여부가 여기서 걸러짐.)

**U-2. (A) 로컬 좋아요 state 완전 제거 [unit]**
- Given: 변경 전 기준 `PlayerScreen.tsx:182` `const [isLiked, setIsLiked] = useState(false);`, `:1000` `setIsLiked(!isLiked)`.
- When: `grep -n "setIsLiked\|\[isLiked" screens/PlayerScreen.tsx`.
- Then: **0건**. `isLiked`라는 식별자가 남는다면 `useLikesStore` 파생값(예: `const liked = useLikesStore(...)`)만 허용 — `useState` 기반 잔존은 FAIL.

**U-3. (A) useLikesStore 배선 3점 세트 [unit]**
- Given: `stores/likesStore.ts`의 공개 API — `liked: Record<string,boolean>`, `sync(trackIds)`, `toggle(trackId)`(낙관적+롤백+busy 가드 내장).
- When: PlayerScreen에서 ① 구독 `useLikesStore((s)=>!!s.liked[trackId])`(또는 `s.isLiked(trackId)` 동등식), ② trackId effect 내 로그인 시 `sync([trackId])`, ③ 하트 onPress 로그인 분기 `toggle(trackId)` / 비로그인 `showAlert('알림','로그인 후 이용할 수 있습니다.')`(착장 위시 관행) 존재를 grep으로 확인.
- Then: 3점 모두 존재. 하트 렌더는 store 값만 참조(로컬 낙관적 state 중복 관리 금지 — 스토어가 낙관적 반영 담당). 로그 추적자 `[PlayerScreen] 좋아요 toggle` 존재.

**U-4. (A·경계) 네트워크 실패 롤백 — store 로직 무변경 정적 검증 [unit]**
- Given: `likesStore.ts` toggle의 catch 절 — 실패 시 `liked[trackId]=prev` 롤백, 단 `next && status===400`(이미 좋아요 중복)은 성공 취급, `busy` 가드로 중복 클릭 차단, sync의 401은 조용히 무시.
- When: `git diff -- stores/likesStore.ts`.
- Then: **diff 0건**(v3.193은 소비자만 추가, 스토어 무변경). 이것으로 "네트워크 실패 시 하트 롤백"·"401 시 무소음"·"연타 방지"가 기존 검증 범위로 보장됨. diff가 있으면 롤백/중복 시나리오 재검증 필요로 승격.

**U-5. (A·경계) trackId 전환 시 sync 재호출 [unit]**
- Given: 큐에서 다음 곡으로 전환하면 PlayerScreen은 언마운트 없이 trackId만 바뀜.
- When: sync를 호출하는 effect의 의존성 배열 확인.
- Then: `[trackId]`(또는 trackId 포함) — 곡 전환마다 새 곡 좋아요 상태 조회. 댓글 수 조회 effect(:245-257)와 동일 패턴이면 PASS. 의존성 `[]`(마운트 1회)면 FAIL(전환 곡 하트 오표시).

**U-6. (B) PlaylistPickerSheet 마운트·prop 타입 일치 [unit]**
- Given: `components/PlaylistPickerSheet.tsx:11-17` — `{ visible: boolean; trackIds: string[]; onClose: () => void }`.
- When: PlayerScreen 모달 구역(:1282-1298 인근)에 `<PlaylistPickerSheet visible={showPlaylistPicker} trackIds={[String(track.id)]} onClose={...} />` 렌더 여부 확인 + import 확인.
- Then: 3개 prop 모두 배선, trackIds는 문자열 배열 1개. `showPlaylistPicker` state 추가 확인. track이 null일 수 있는 시점 가드(옵셔널/조건부 렌더) 존재.

**U-7. (B·경계) 담기 onPress 회원/비회원 분기 [unit]**
- Given: 기존 비회원 폴백 GuestQueueNoticeModal(:1283-1292)과 '계속 담기'=큐 담기 흐름.
- When: 담기 버튼 onPress 분기 코드 확인.
- Then: 로그인 → `setShowPlaylistPicker(true)`(+로그 `[PlayerScreen] 담기 → PlaylistPicker`), 비로그인 → 기존 GuestQueueNoticeModal 경로 **그대로**(모달 컴포넌트·문구 diff 0). 기존 `addCurrentToQueue`가 비회원 폴백('계속 담기')에서만 살아있고 회원 경로에서 호출되지 않음.

**U-8. (B·경계) 중복 플레이리스트 담기 — 기존 시트 동작 확인 [unit]**
- Given: PlaylistPickerSheet는 `POST /playlists/{id}/tracks`로 담기(:40 인근 trackIds 루프).
- When: `git diff -- components/PlaylistPickerSheet.tsx` + 시트의 중복/실패 처리 코드 열람(성공·실패 안내 로직).
- Then: **diff 0건**(재사용, 무변경). 같은 곡을 같은 플레이리스트에 2회 담기 시의 처리(서버 4xx 허용 또는 안내)는 기존 컴포넌트 책임 — ⋮ 액션시트·'모두 담기'에서 이미 운용 중인 코드와 동일 경로임을 확인하면 신규 회귀 없음으로 판정.

**U-9. (C) 아이콘 벡터 24 통일 + height 28 박스 [unit]**
- Given: 변경 전 혼재 — 좋아요/담기 텍스트 글리프(♥/♡/+, title2 라인박스 ≈32px), 댓글 23, 재생목록 24, 신고 22.
- When: actionsRow 구간(:996-1034 인근) grep — ① 텍스트 글리프 `'♥'|'♡'|>\+<` **0건**, ② 좋아요 `MaterialCommunityIcons heart/heart-outline` size 24(liked 시 accent), 담기 Feather(`folder-plus` 또는 `plus`) 24, 댓글·재생목록·신고 Feather **모두 size={24}**(23·22 잔존 0건), ③ `actionIconBox` 스타일 `{ height: 28, alignItems:'center', justifyContent:'center' }` 정의 + 5버튼 전부 래핑.
- Then: ①②③ 전부 충족. 라벨 `actionLabelSpacing` 공통 유지(라벨 시작 Y 동일화의 두 축).

**U-10. (C·경계) 본인 곡 4버튼 레이아웃 [unit]**
- Given: 신고 버튼은 `!isMyTrack` 조건부(:1028-1033) — 본인 곡은 4버튼.
- When: 조건부 렌더 유지 여부 + actionsRow의 정렬 방식(justify/space 계열) diff 확인.
- Then: `!isMyTrack` 조건 무변경. 아이콘 박스 통일이 버튼 개수와 무관하게 적용(박스가 버튼 내부 요소이므로 4/5버튼 모두 라벨 Y 동일). 5버튼일 때 360dp 오버플로는 E-4에서 검증.

**U-11. (E) CTA 통일 — PlaylistScreen icon 제거 + SearchScreen 오버레이 교체 [unit]**
- Given: 기준 스펙 = `MapScreen.tsx` styles.loginOverlay(:992-997, absoluteFill·rgba(0,0,0,0.75)·center) + 아이콘 없는 LoginPrompt. 변경 전 PlaylistScreen `icon="♫"`(:223), SearchScreen은 flex 잔여공간 중앙 + title 없음(:231-238, styles.loginCta:318).
- When: ① `grep -n 'icon=' screens/PlaylistScreen.tsx` → LoginPrompt icon prop **0건**(title·desc·onPress만), ② SearchScreen gated 분기가 absoluteFill 딤 오버레이(TouchableOpacity, rgba(0,0,0,0.75), center, 배경 탭 `setGated(false)`)로 교체, ③ `LoginPrompt title="AI 음악 검색"` + 기존 desc 유지, ④ 기존 `styles.loginCta`(flex 중앙) 사용처 제거.
- Then: ①~④ 충족 + MapScreen·FeedScreen·LoginPrompt.tsx **diff 0건**(기준 화면 무접촉). 상단바 헤더 타이틀 '검색'(App.tsx:355)은 무변경(범위 밖 — G 항목과 혼동 금지). 로그 `[SearchScreen] 미로그인 게이트` 유지.

**U-12. (F) 스플래시 폰트 수치 [unit]**
- Given: 변경 전 `SplashScreen.tsx` styles.word fontSize 56/lineHeight 74/letterSpacing 6, styles.title 52/60/3.
- When: 수치 grep.
- Then: word **40/54**(letterSpacing 6 유지), title **36/44**(letterSpacing 3 유지). fontWeight '900'·색상·wordAi/titleAi(accent) 무변경. 심볼(64×66)·subtitle·애니메이션 타이밍 코드 diff 0(축소 외 무접촉 — 타이밍 회귀 방지의 정적 근거). lineHeight ≥ fontSize×1.2 유지로 글리프 상하 잘림 없음.

**U-13. (G) LogoTitle 분절 구조 [unit]**
- Given: 변경 전 `App.tsx:249-251` — 전체 `tone="accent"` MAIDOL. 목표 = 스플래시 2막(:87-89)과 동일한 M(흰)+AI(accent)+DOL(흰).
- When: LogoTitle 함수 확인.
- Then: 외곽 `AppText variant="title2"`는 tone 미지정(기본 primary=흰) 또는 명시 primary, 내부 중첩 `<AppText variant="title2" tone="accent">AI</AppText>`만 accent, 텍스트가 정확히 `M`+`AI`+`DOL` 3분절. letterSpacing 1·variant 기존 유지(크기 회귀 금지). `tone="accent"`가 외곽에 잔존하면 FAIL.

**U-14. (D) 토글 라벨 무변경 확인 [unit]**
- Given: D는 사용자 결정 대기 — 이번 릴리즈 변경 금지.
- When: `grep -n "가사 · 프롬프트 · 착장 · 댓글" screens/PlayerScreen.tsx` + 탭 라벨 객체(:1108) `{ lyrics:'가사', prompt:'프롬프트', outfit:'착장', comments:'댓글' }` 확인.
- Then: 두 곳 모두 **원문 그대로 1건씩 존재**, diff 0. 변경돼 있으면 범위 위반 FAIL.

**U-15. (H) v3.192 마퀴 무회귀 [unit]**
- Given: 차트 마퀴는 v3.192 `components/Marquee.tsx`(수평 ScrollView+numberOfLines=1)로 완결, TrackRow가 공용.
- When: `git diff -- components/Marquee.tsx components/TrackRow.tsx` (v3.192 반영 상태 기준).
- Then: v3.193에 의한 추가 diff **0건**. 사용자 폰 미적용 증상은 미배포가 원인이므로 코드 변경 없이 v3.193 빌드 포함으로 해소 — 릴리즈 노트에 명시.

**U-16. diff 범위 격리 [unit]**
- Given: 변경 매트릭스 5파일(PlayerScreen·PlaylistScreen·SearchScreen·SplashScreen·App.tsx).
- When: `git status`/`git diff --stat`으로 v3.193 변경분 목록화.
- Then: 5파일 외 v3.193 기인 diff 0건. 특히 `stores/likesStore.ts`·`components/PlaylistPickerSheet.tsx`·`components/LoginPrompt.tsx`·`components/Marquee.tsx`·`services/playback.ts`·`screens/MapScreen.tsx`·`screens/FeedScreen.tsx` 무접촉. (주의 계승: 워킹트리에 v3.192 이전 무관 변경 잔존 — 커밋 시 5파일 스코프 한정.)

### [api] 엔드포인트 검증

**A-1. likes 엔드포인트 — 무인증 거동만 실측, 인증 시나리오는 스킵 [api]**
- Given: `GET /likes/check?song_ids=`·`POST/DELETE /likes/{id}`는 로그인 토큰 필요(스토어가 401을 조용히 처리하는 설계).
- When: 공개 무인증으로 `GET https://api.maidol.ai.kr/api/likes/check?song_ids=<임의id>` 1회 호출.
- Then: **401**(또는 403) 확인 — 비로그인 하트 비활성 유지의 서버측 전제 성립. **POST/DELETE 및 인증 상태 조회는 명시적 스킵**: 테스트 계정 토큰이 로컬에 없고 실사용자 자격증명 사용은 금지(민감정보 원칙). 서버 계약 자체는 기존 likesStore 운용(차트 ⋮ 좋아요)으로 프로덕션 검증 완료 — v3.193은 신규 엔드포인트 0건.

**A-2. playlists 엔드포인트 — 스킵 사유 명시 [api]**
- Given: `GET /playlists/`·`POST /playlists/`·`POST /playlists/{id}/tracks` 전부 기존재(PlaylistPickerSheet가 ⋮ 액션시트·'모두 담기'에서 이미 사용 중), v3.193 신규 API 없음.
- When: 공개 무인증 `GET /api/playlists/` 1회로 401 확인만 수행.
- Then: 401 확인 시 PASS. **인증 CRUD 시나리오(생성·담기·중복 담기)는 스킵** — 사유: 인증 필요 + 쓰기 부수효과(실서버에 테스트 플레이리스트 생성) 금지. 정적 대체는 U-8(시트 무변경 diff 0).

### [e2e] 핵심 여정 (각 항목 정적 대체 검증 병기 — 에뮬레이터 부재 관행)

**E-1. 좋아요 유지·상호반영 여정 [e2e]**
- Given: 로그인 상태, 차트에서 곡 재생 → NowPlaying.
- When: 하트 탭(채워짐·accent) → 미니플레이어로 내림 → 재진입 → 앱 재시작 후 재진입. 이어서 차트 ⋮ 액션시트에서 같은 곡 좋아요 해제 → NowPlaying 재확인.
- Then: 재진입·재시작 후에도 하트 유지(서버 sync 복원), ⋮ 해제가 NowPlaying 하트에 즉시(전역 스토어) 또는 재진입 sync 시 반영 — 양방향 일관.
- 정적 대체: U-2(로컬 state 0건)+U-3(구독·sync·toggle 배선)+U-4(스토어 무변경). 전역 zustand 단일 소스이므로 상호반영은 구조적으로 보장 — 실기기는 스크린샷 확인 요청으로 이관.

**E-2. 비로그인 하트 탭 (경계) [e2e]**
- Given: 비로그인 상태, NowPlaying 진입.
- When: 하트 탭.
- Then: '로그인 후 이용할 수 있습니다' 얼럿 1회, 하트 시각 상태 무변화, 네트워크 요청 0건(콘솔에 `[likesStore] toggle` 미출력).
- 정적 대체: U-3 ③ 분기(비로그인 경로에 toggle 호출 없음을 코드로 확인) + sync는 401 무소음(U-4).

**E-3. 담기 여정 — 회원 시트/비회원 폴백 [e2e]**
- Given: (a) 로그인 / (b) 비로그인, NowPlaying.
- When: '담기' 탭. (a) 기존 플레이리스트 선택 담기 → 같은 플레이리스트에 한 번 더 담기(중복) → '새 플레이리스트 만들기'로도 담기. (b) 담기 탭.
- Then: (a) PlaylistPickerSheet 표시("플레이리스트에 담기" 단수 문구), 담기 성공 안내, 중복 시 크래시 없이 기존 처리(안내/무시), 플레이리스트 화면에서 곡 확인. 큐에는 **추가되지 않음**(회원 경로에서 addCurrentToQueue 미호출). (b) 기존 GuestQueueNoticeModal 그대로 — '계속 담기' 시 큐 추가 폴백 동작.
- 정적 대체: U-6(마운트·prop)+U-7(분기)+U-8(시트 diff 0 — 중복 처리 기존 검증분 승계).

**E-4. 액션행 정렬·360dp 오버플로 (경계 포함) [e2e]**
- Given: 타인 곡(5버튼)과 본인 곡(4버튼, 신고 숨김), 소형 기기(폭 360dp) 포함.
- When: NowPlaying 액션행 육안/스크린샷 확인.
- Then: 5개 라벨('좋아요·댓글·담기·재생목록·신고')의 상단 Y가 픽셀 단위 동일, 아이콘 5종 모두 동일 크기(24) 체감, 360dp에서 줄바꿈·잘림·가로 오버플로 없음, 본인 곡 4버튼도 정렬 동일.
- 정적 대체: U-9(24 통일+height 28 박스)+U-10(조건부 유지). 오버플로는 라벨 최장('재생목록' 4자 caption)×5 + 기존 actionsRow 정렬 방식 무변경으로 v3.178 이후 실배포에서 검증된 폭 — 아이콘 박스는 폭 불변(높이만 고정)이므로 신규 오버플로 요인 없음을 diff로 확인.

**E-5. 비로그인 CTA Y좌표 일치 3화면 [e2e]**
- Given: 비로그인 상태.
- When: 작업실(기준)·플레이리스트·검색 3화면 진입, 같은 기기에서 스크린샷 3장 → 타이틀("AI 음악 작업실"/"나만의 플레이리스트"/"AI 음악 검색") 상단 Y 비교. 검색 화면에서 딤 배경 탭.
- Then: 3화면 타이틀 Y 오차 ≤ 수 px(콘텐츠 영역 차이 허용), 검색은 딤 오버레이 스타일이 작업실과 동일(0.75 딤), 배경 탭 시 게이트 닫힘(검색바·MoodBar 노출 유지). 플레이리스트는 ♫ 아이콘 부재로 그룹 구성이 작업실과 동일.
- 정적 대체: U-11 — 세 화면이 동일 LoginPrompt(아이콘 없음·title+desc+버튼) + 동일 앵커(absoluteFill center / flex center)를 쓰므로 그룹 내부 오프셋 소멸이 스타일 수치로 증명됨. 검색의 세로 중심 이동은 flex 잔여공간 중앙→absoluteFill 중앙 교체로 구조 보장.

**E-6. 스플래시 축소·타이밍 무회귀 + 로고 분절 [e2e]**
- Given: 콜드 스타트.
- When: 스플래시 1막(MY/AI/IDOL)→2막(심볼+MAIDOL) 관찰 → 홈 진입 후 상단바 로고 확인.
- Then: 1막 40pt·2막 36pt로 축소 렌더(잘림·겹침 없음), 막 전환 타이밍·페이드 기존과 동일, 2막 심볼 대비 로고 비중 육안 과대 시에만 심볼 56 미세조정(허용 범위). 상단바 로고 M(흰)+AI(보라)+DOL(흰), 크기·자간 기존 동일.
- 정적 대체: U-12(수치+애니메이션 코드 무접촉)+U-13(분절 구조). 타이밍 무회귀는 styles 외 diff 0건이 근거.

**E-7. v3.191·v3.192 무회귀 [e2e]**
- Given: v3.193 빌드.
- When: ① NowPlaying 상·하단이 상태바/제스처바와 겹치지 않는지(v3.191 인셋), ② 냥냥냥 재생 시 총시간 확장 방어 동작(v3.192 duration), ③ 긴 제목 곡("더 나오려는 것을 막는 것일뿐") 플레이어·차트 1줄 마퀴(v3.192).
- Then: 3항목 모두 기존 동작 유지. 특히 (C) 액션행 박스 변경이 세로 공간을 바꾸므로 하단 토글(절대배치) 겹침 없는지 확인.
- 정적 대체: ① PlayerScreen diff가 액션행·좋아요·담기 구간에 한정되고 insets 배선 미접촉(grep `useSafeAreaInsets` 무변경), ② `services/playback.ts`·duration 보정 구간 diff 0, ③ U-15(Marquee·TrackRow diff 0).

### 태그 집계
- [unit] 16건 (U-1~U-16: 배선·수치·구조 검증 9 / 경계 5(U-4 롤백, U-5 trackId 전환, U-7 비회원 분기, U-8 중복 담기, U-10 본인 곡) / 무변경·격리 2(U-14 D, U-15~16))
- [api] 2건 (A-1 likes·A-2 playlists — 무인증 401 실측만, 인증·쓰기 시나리오는 자격증명 부재+실서버 부수효과 금지로 명시적 스킵, 정적 대체 병기)
- [e2e] 7건 (E-1~E-3 핵심 여정, E-4~E-6 시각 검증, E-7 무회귀 — 전 항목 정적 대체 검증 병기, 실기기 확인 요청 이관 전제)

### 설계 주의점 (tester·app-dev 참고)
1. **U-3/E-1**: 하트 낙관적 반영은 likesStore가 담당 — PlayerScreen에 별도 로컬 낙관 state를 두면 이중 소스로 v3.193 이전 버그가 재발한다. 렌더는 store 구독값 단일 참조 필수.
2. **U-5**: sync effect 의존성에 trackId 누락 시 곡 전환에서 이전 곡 하트가 그대로 보이는 회귀 — grep만으로 놓치기 쉬우니 effect 블록 열람 필수.
3. **U-6**: `track.id` 타입이 화면 경로별로 string/number 혼재 가능 — `String()` 캐스팅 없으면 tsc(U-1)에서 걸리지 않고 런타임 join만 이상해질 수 있으므로 명시 확인.
4. **E-3**: 회원 경로에서 큐 추가가 사라지는 것은 **의도된 스펙 변경**(큐는 곡 클릭 시 자동 추가 — v3.192 분석) — "담았는데 재생목록에 없다"는 QA 오탐 주의.
5. **A-1/A-2**: 실서버 쓰기 호출 절대 금지(테스트 플레이리스트/좋아요 오염). 무인증 401 프로브 2회만 허용.

### v3.193 테스트 결과 (tester, 2026-09-20)

**환경**: 정적 검증 + 무인증 API 프로브. 에뮬레이터/adb/maestro 부재 → e2e 전 항목 정적 대체 검증. `npx tsc --noEmit` exit 0.

| ID | 항목 | 판정 | 근거 요약 |
|---|---|---|---|
| U-1 | 타입 무결성 | PASS | tsc exit 0, 오류 0건 |
| U-2 | 로컬 좋아요 state 제거 | PASS | `setIsLiked`/`[isLiked` 0건. `isLiked`는 store 파생값만(:249) |
| U-3 | useLikesStore 배선 3점 | PASS | ①구독 `useLikesStore((s)=>!!s.liked[trackIdForComments])`(:249) ②sync effect(:250-254, 로그인 가드) ③toggle 로그인 분기+비로그인 showAlert(:255-266). 렌더 단일 소스(:1031·1033 store값만). 로그는 `[PlayerScreen] toggle like`(:261) — 계획 문구와 다르나 기능 동등 |
| U-4 | likesStore 무변경 | PASS | `git diff -- stores/likesStore.ts` 0건 — 롤백·400 중복 성공취급·busy 가드·401 무소음 기존 검증 승계 |
| U-5 | trackId 전환 sync 재호출 | PASS | 의존성 `[trackIdForComments, user]`(:254) — 곡 전환·로그인 전환 모두 재조회 |
| U-6 | PlaylistPickerSheet 마운트·타입 | PASS | import(:34), `visible/trackIds/onClose` 3prop 배선(:1334-1338), `track?.id ? [String(track.id)] : []` — String() 캐스팅+null 방어 동시 충족 |
| U-7 | 담기 회원/비회원 분기 | PASS | 회원→`setShowPlaylistPicker(true)`(:806-811, `track?.id` 방어), 비회원→기존 guestNoticeAck/GuestQueueNoticeModal 경로 그대로(:813-818), `addCurrentToQueue`는 비회원 폴백('계속 담기' :1329, ack후 :818)만 호출. GuestQueueNoticeModal diff 0. 로그는 `open playlist picker` — 문구 상이·기능 동등 |
| U-8 | 중복 담기 기존 시트 승계 | PASS | `git diff -- components/PlaylistPickerSheet.tsx` 0건. addAll이 중복 실패 skip+안내(added/failed 집계) 기존 로직 그대로 |
| U-9 | 아이콘 24 통일+height28 박스 | PASS | 액션행 텍스트 글리프(♥/♡/+) 0건, heart/heart-outline 24(liked시 accent), folder-plus/message-circle/list/flag 전부 24(액션행 내 22·23 잔존 0 — :1290/1295/1352의 22는 착장레일·모달 X로 범위 밖), `actionIconBox {height:28, center}`(:1396) 5버튼 전부 래핑 |
| U-10 | 본인 곡 4버튼 | PASS | `!isMyTrack` 조건 무변경(:1066), actionsRow 스타일 diff 0 — 박스는 버튼 내부 요소로 4/5버튼 무관 |
| U-11 | CTA 통일 | PASS | PlaylistScreen LoginPrompt icon prop 제거(diff -1줄뿐, :264 EmptyState icon="♫"는 로그인 상태 빈목록용으로 범위 밖), SearchScreen absoluteFill+rgba(0,0,0,0.75)+center 오버레이(MapScreen :992-997과 수치 동일)+배경탭 setGated(false)+title="AI 음악 검색"+기존 desc 유지+loginCta 스타일 삭제. MapScreen·FeedScreen·LoginPrompt.tsx diff 0. 로그 `[SearchScreen] 미로그인 게이트`(:89) 유지 |
| U-12 | 스플래시 수치 | PASS | word 40/54(letterSpacing 6 유지), title 36/44(letterSpacing 3 유지), fontWeight 900·wordAi/titleAi·심볼 64×66·애니메이션 무접촉(diff 4줄×2뿐). lineHeight/fontSize = 1.35·1.22 ≥1.2 |
| U-13 | LogoTitle 분절 | PASS | 외곽 AppText title2 tone 미지정(기본 primary), 내부 `<AppText variant="title2" tone="accent">AI</AppText>`만 accent, M+AI+DOL 3분절, letterSpacing 1 유지. 외곽 tone="accent" 제거 확인(diff) |
| U-14 | (D) 토글 라벨 무변경 | PASS | '가사 · 프롬프트 · 착장 · 댓글'(:1087)·labels 객체(:1148) 원문 1건씩, diff 0 |
| U-15 | (H) 마퀴 무회귀 | PASS | Marquee.tsx·TrackRow.tsx diff 0 |
| U-16 | diff 범위 격리 | PASS(주의) | v3.193 기인 diff는 5파일 한정. 가드 7파일(likesStore·PlaylistPickerSheet·LoginPrompt·Marquee·playback·MapScreen·FeedScreen) 전부 diff 0. 잔존 무관 diff: eas.json·metro.config.js·package(-lock).json·authService.ts(주석 1줄)·바이너리 자산 다수 — v3.193 이전 잔존분으로 판단, 커밋 시 5파일 스코프 한정 필수 |
| A-1 | likes 무인증 401 | PASS | `GET /api/likes/check?song_ids=…` → **401**. POST/DELETE·인증 조회 스킵(토큰 부재+실서버 쓰기 금지, 계획 명시) |
| A-2 | playlists 무인증 401 | PASS | `GET /api/playlists/` → **401**. 인증 CRUD 스킵(쓰기 부수효과 금지) — 정적 대체 U-8 diff 0 |
| E-1 | 좋아요 유지·상호반영 | PASS(정적) | U-2+U-3+U-4 — 전역 zustand 단일 소스로 구조 보장. 실기기 이관 |
| E-2 | 비로그인 하트 탭 | PASS(정적) | 비로그인 경로 toggle 미호출·showAlert만(:257-260), sync도 user 가드(:252)로 요청 0건 |
| E-3 | 담기 여정 | PASS(정적) | U-6+U-7+U-8. 회원 경로 addCurrentToQueue 미호출 = 의도된 스펙(주의점 4) |
| E-4 | 액션행 정렬·360dp | PASS(정적) | U-9+U-10. actionsRow 정렬 방식 diff 0 — 박스는 높이만 고정, 폭 요인 무변경 |
| E-5 | CTA Y좌표 3화면 | PASS(정적) | U-11 — 동일 LoginPrompt(아이콘 無)+동일 오버레이 수치. 실기기 스크린샷 이관 |
| E-6 | 스플래시·로고 | PASS(정적) | U-12(수치+타이밍 무접촉)+U-13 |
| E-7 | v3.191/192 무회귀 | PASS(정적) | ①PlayerScreen diff에 useSafeAreaInsets/인셋 배선 무접촉(diff 전문 확인) ②services/playback.ts diff 0, duration 보정 구간 무접촉 ③Marquee·TrackRow diff 0. 액션행 박스(height 28)는 기존 title2 라인박스(~32px)보다 작아 세로 공간 증가 없음 → 하단 토글 겹침 요인 없음 |

**집계**: unit 16/16 PASS · api 2/2 PASS · e2e 7/7 PASS(정적 대체) — **1차 게이트 통과**.

**경미 편차(수정 불요)**: 로그 추적자 문구 2건이 계획과 상이하나 기능 동등 — `[PlayerScreen] toggle like`(계획: `좋아요 toggle`), `[PlayerScreen] open playlist picker`(계획: `담기 → PlaylistPicker`).

**실기기 확인 잔여**(빌드 배포 후):
1. E-1 하트 유지·차트 ⋮ 상호반영 스크린샷
2. E-3(a) 시트 담기·중복 담기·새 플레이리스트 실동작
3. E-4 360dp 5버튼 라벨 Y 정렬·오버플로
4. E-5 3화면 CTA Y좌표 비교 스크린샷
5. E-6 스플래시 축소 체감·심볼 대비(필요시 심볼 56 미세조정)
6. E-7 냥냥냥 duration·긴 제목 마퀴·인셋 실측

## v3.194 — 수정일 2026-09-20

대상: /Users/pearl/TripleJ/2_housing (React Native Expo). 범위 = (A) 소셜 로그인 프리플라이트 제거·detail 검증·openAuthSessionAsync+딥링크 콜백(조건부)·백엔드 요청 문서, (B) 네이버 버튼 제거, (C) 이모지 아이콘 1차 ~25곳 벡터 교체(⭐ 재화·콘텐츠 문자열 제외), (D) SplashScreen 응원봉 심볼 제거. 검증 기조: [unit] 정적 검증 위주(에뮬레이터 부재 관행 승계), [api] 무인증 프로브만, [e2e] 정적 대체 병기 — 단 OAuth 실왕복은 **콘솔 설정+실기기 필요 → UNVERIFIED-예정** 처리 기준을 본문에 명시.

### [unit] 정적 검증

**U-1. 타입 무결성 [unit]**
- Given: v3.194 전체 반영 워킹트리.
- When: `npx tsc --noEmit`.
- Then: exit 0, 오류 0건. 특히 (C) EmptyState/LoginPrompt icon prop 타입 확장 후 전 호출부(2차 목록 미교체 화면 포함) 통과.

**U-2. (B) PROVIDERS naver 0건 + 주석 갱신 [unit]**
- Given: `components/auth/SocialLoginButtons.tsx` — 현행 :15에 naver 항목, :1 주석 "3종(구글/카카오/네이버)", `components/auth/AuthPanel.tsx:2` 주석에 "네이버".
- When: `grep -n "naver\|네이버" components/auth/SocialLoginButtons.tsx components/auth/AuthPanel.tsx`.
- Then: PROVIDERS 배열 내 naver 항목 **0건**, 두 파일 주석의 "3종"·"네이버" 표기 갱신(2종 또는 구글/카카오). 백엔드 `/auth/oauth/naver/*` 라우트는 무접촉(서버 diff 0 — UI만 제거 스펙).

**U-3. (A-2) 프리플라이트 api.get 잔존 0건 [unit]**
- Given: 현행 SocialLoginButtons.tsx:27 `await api.get(\`/auth/oauth/${provider}/login\`)` 프리플라이트(RN XHR이 302를 앱 안에서 따라가 서버 state를 선점/소모하는 유해 호출 — PLAN A-2).
- When: `grep -n "api.get" components/auth/SocialLoginButtons.tsx` + 파일 전문 열람.
- Then: `api.get(...oauth...)` **잔존 0건** — 버튼 탭 → 즉시 브라우저/AuthSession 오픈 1회로 단순화. `api` import가 미사용으로 남으면 제거 확인(tsc가 noUnusedLocals 미설정 시 못 잡음 — grep으로 별도 확인, 주의점 3). `BACKEND_BASE_URL` import는 유지.

**U-4. (A-2) 서버 detail 표출 검증 가드 [unit]**
- Given: 현행 :33-35는 `err?.response?.data?.detail || ...error`를 무검증 alert 표출 — "null 에 접근할 수 없습니다" 노출 경로 후보 1순위.
- When: 오류 표출 분기 코드 열람.
- Then: detail이 ① `typeof === 'string'` ② 길이 ≤ 80자(계획 기준)일 때만 표출, 아니면 고정 안내문("소셜 로그인에 실패했습니다…" 계열)으로 대체. null/undefined/객체가 문자열화되어 alert에 찍히는 경로 0건.

**U-5. (A-2) openURL/AuthSession 실패 시 사용자 alert [unit]**
- Given: 현행 :40-41은 `Linking.openURL` reject 시 `console.error`만(사용자 무안내).
- When: 실패 catch 분기 열람.
- Then: 브라우저 오픈 실패 시 `showAlert` 사용자 안내 존재. busy 상태는 finally에서 해제(무한 busy 금지 — 재탭 가능).

**U-6. (A-3, 조건부) openAuthSessionAsync 전환 + null 가드 [unit]**
- Given: PLAN A-3 — 백엔드 응답 확인 시에만 같은 버전 내 전환, 미준비 시 문서만 발행하고 전환 코드는 이월.
- When: [전환 반영 시] SocialLoginButtons.tsx 열람 + `grep -n "openAuthSessionAsync\|expo-web-browser" components/ App.tsx`.
- Then: ① `expo-web-browser` import + package.json 의존성 추가, ② `WebBrowser.openAuthSessionAsync(loginUrl, 'aidol://oauth/callback')`(스킴 `aidol`은 app.json 기존재 — 확인), ③ **null 가드**: `result?.type === 'success' && result.url`일 때만 토큰 파싱 → `useAuthStore.getState().loginWithToken(token)`(stores/authStore.ts:82 기존재 확인), ④ cancel/dismiss 시 조용히 복귀 — 에러 alert 호출 0건. [미전환 시] 본 항목 N/A 판정 + U-8(문서)만으로 A-3 게이트 — E-1/E-2는 자동 UNVERIFIED-예정.

**U-7. (A-3) App.tsx 콜백 가드 확장 [unit]**
- Given: 현행 App.tsx:442 `useOAuthCallback`은 `Platform.OS !== 'web'` 조기 return(네이티브 무경로), :467 linking config는 FeedDetail만.
- When: App.tsx의 useOAuthCallback·linking 블록 열람.
- Then: ① [전환 반영 시] 콜드 스타트 딥링크 `aidol://oauth/callback#token=` 처리 경로 존재(linking config 라우트 추가 또는 `Linking.getInitialURL`/`addEventListener` 파싱) + hash·token null 가드(match 실패 시 무동작·무크래시), ② 웹 경로(기존 useOAuthCallback)는 동작 무변경 — 해시 토큰 즉시 제거(replaceState) 로직 보존, ③ 기존 `FeedDetail: 'feed/:feedId'` 라우트·prefixes(`aidol://`·BACKEND_BASE_URL) 보존. [미전환 시] ①은 N/A, ②③만 무변경 diff 0으로 확인.

**U-8. (A-3) 백엔드 요청 문서 발행 [unit]**
- Given: 지시 명칭 2안 — PLAN: `백엔드_요청_소셜로그인_앱복귀.md` / 팀 지시: `백엔드_요청_oauth콜백.md` (동일 실체, 파일명은 app-dev 산출 기준으로 판정).
- When: `ls`로 문서 존재 확인 + 전문 열람.
- Then: 문서 1건 존재하고 다음 명세 포함 — ① `/auth/oauth/{p}/login?client=app` 시 최종 리다이렉트 `aidol://oauth/callback#token=JWT`, ② redirect를 따라가지 않는 상태 조회용 별도 status 엔드포인트 요청(503 안내 대체 — PLAN A-2 수정안 1), ③ `frontend_url` env 미설정 시 `null/oauth/callback` 리다이렉트 가능성 확인 요청("null" 문구 후보 — A-4).

**U-9. (C) 1차 교체 목록 — 파일:라인별 글리프 0건 + 벡터 존재 [unit]**
- Given: PLAN C 1차 목록(라인 번호는 교체 전 기준 — 교체 후 시프트 허용, 글리프 grep은 파일 단위).
- When: 아래 각 파일에 대해 대상 글리프 grep(0건 기대) + Feather/MCI 컴포넌트 grep(존재 기대). ⭐ 및 콘텐츠 문자열은 검사 대상 제외.
- Then: 전 항목 충족 —
  - `components/MiniPlayer.tsx`: ♪·❚❚·▶·✕ 0건 → Feather music/pause/play/x
  - `screens/PlayerScreen.tsx`: :910 ♪(커버 플레이스홀더)·:1123 ❚❚·▶(상단 미니바) 0건 (⋯ 파일 내 다른 벡터 하트류는 v3.193 완료분 — 무접촉)
  - `screens/ChartScreen.tsx`: ♪(204·265)·▶(216)·←(317)·✕(331)·📊(304)·🔍(355)·🎵(357) 0건 → arrow-left/x 등 벡터
  - `screens/PlaylistScreen.tsx`: ♫(181·264)·←(233) 0건
  - `components/DraggableQueue.tsx`: ▶(93) 0건 / `components/TrackRow.tsx`: ♪(34) 0건
  - `screens/SearchScreen.tsx`: 🎧(247)·🔍(272)·🎵(274) 0건
  - `screens/FeedScreen.tsx`: :275 LoginPrompt `icon="👥"` 0건 → 벡터 또는 prop 제거
  - `components/auth/AuthPanel.tsx`: :417 ✓ → Feather check (미충족 '·'는 현행 유지 허용)
  - `components/AppShareModal.tsx`(:82)·`components/StarGuideModal.tsx`(:50)·`components/AttendanceModal.tsx`(:88): ✕ 0건
  - `components/StarGuideModal.tsx`(:16-21): 🎉🛡️👥📅🎧🚀 0건 → gift/shield/users/calendar/headphones/rocket 계열
  - `components/AttendanceModal.tsx`(:123): ✅/🎁/🔒 0건 → check-circle/gift/lock
  - 색·크기: 교체 벡터가 기존 텍스트 스타일의 color/fontSize에 상응(대표 3곳 스팟 열람 — MiniPlayer 재생/닫기, ChartScreen 뒤로가기).

**U-10. (C) ⭐ 보존 + 콘텐츠 문자열 무접촉 (경계) [unit]**
- Given: 교체 금지 목록 — ⭐ 재화 표기 전부(ChartScreen:283, GuestQueueNoticeModal:25, 각종 비용 문구), 콘텐츠 문자열(ArtistCodyScreen.tsx:401-412 AI 프롬프트 ✓/❌, FeedCard.tsx:207 공유 메시지 🎁, 가사·대화 텍스트).
- When: `grep -rn "⭐"` 결과의 v3.194 전후 diff 비교 + ArtistCodyScreen·FeedCard·GuestQueueNoticeModal `git diff` 확인. ⭐ 검사 시 VS16 변형(⭐️) 포함 grep(주의점 5).
- Then: ⭐ 출현 건수 **감소 0건**(전부 보존), 위 3파일 diff 0(또는 C와 무관한 diff 없음). AttendanceModal :67·:134 문구 내 ✅는 2차 목록 — 이번 버전 무접촉 확인(‌:123 아이콘 3종만 교체).

**U-11. (C) EmptyState/LoginPrompt icon prop 확장 [unit]**
- Given: `components/ui/EmptyState.tsx` `icon?: string`(Text 렌더), `components/LoginPrompt.tsx` `icon?: string`(:17·27).
- When: 두 파일 열람 + 전 호출부 grep(`icon=`).
- Then: prop이 `ReactNode`(또는 Feather name) 수용으로 확장, **string 전달 시 기존 Text 렌더 하위호환 유지**(2차 미교체 화면의 문자열 호출부가 남아있어도 렌더 무손상 — 주의점 6), 1차 목록 호출부는 벡터 전달로 전환.

**U-12. (D) 스플래시 심볼 제거 3점 + 애니메이션 무변경 [unit]**
- Given: `screens/SplashScreen.tsx` — :24 `const SYMBOL = require('../assets/branding/maidol_symbol.png')`, :85 `<Image source={SYMBOL} style={styles.symbol} />`, :119 `symbol` 스타일(64×66).
- When: `grep -n "SYMBOL\|symbol\|maidol_symbol" screens/SplashScreen.tsx` + `git diff -- screens/SplashScreen.tsx` 전문.
- Then: ① require·Image·symbol 스타일 **3점 모두 0건**, ② 에셋 `assets/branding/maidol_symbol.png`는 디스크 보존(삭제 금지 — 재사용 대비), ③ diff가 위 3점 삭제에 한정 — `act2Opacity`/`act2Scale`/4000ms 타이밍·1막 lineAnims·act1Opacity 무접촉, ④ v3.193 타이포 수치 보존: word 40/54·title 36/44·letterSpacing 6/3·fontWeight 900, ⑤ `logoRow.marginBottom: 16` 유지, `styles.act`(absoluteFill center)가 재중앙 정렬 담당 — 별도 레이아웃 보정 diff 없음(있다면 사유 주석 확인).

**U-13. 무회귀 diff 가드 — v3.191/192/193 [unit]**
- Given: (C)가 PlayerScreen·SearchScreen·FeedScreen 등 v3.193 접촉 파일과 겹침(주의점 1).
- When: `git diff` 파일·라인 단위 검사.
- Then:
  - **v3.191(안전영역)**: PlayerScreen diff에 `useSafeAreaInsets`/인셋 배선 라인 무접촉(grep 무변경).
  - **v3.192(duration/마퀴)**: `services/playback.ts` diff 0, `components/Marquee.tsx` diff 0, TrackRow diff는 :34 ♪ 교체 1점 한정(마퀴/레이아웃 라인 무접촉).
  - **v3.193(좋아요/담기/CTA/로고)**: `stores/likesStore.ts`·`components/PlaylistPickerSheet.tsx` diff 0. PlayerScreen 하트(1030-1034·1256)·담기 분기(806-811)·actionIconBox(:1396) 라인 무접촉 — diff는 :910·:1123 글리프 교체 한정. SearchScreen diff는 아이콘 3점 한정(absoluteFill 0.75 딤 오버레이·setGated 배선 무접촉). FeedScreen diff는 :275 icon prop 한정. LogoTitle(M+AI+DOL 분절) diff 0. SplashScreen 타이포 수치 무변경(U-12 ④와 교차).

**U-14. diff 범위 격리 [unit]**
- Given: v3.194 대상 파일 = SocialLoginButtons·AuthPanel·App.tsx·SplashScreen + (C) 1차 목록 파일들 + EmptyState·LoginPrompt + 백엔드 요청 문서 + [전환 시] package.json(expo-web-browser).
- When: `git status`/`git diff --stat`으로 목록화.
- Then: 위 목록 외 v3.194 기인 diff 0건. (주의 계승: 워킹트리에 v3.193 이전 무관 잔존 diff — eas.json·metro.config.js·package(-lock).json·바이너리 자산 등 — 커밋 시 v3.194 스코프 한정 필수.)

**U-15. 버전 문자열 [unit]**
- Given: 변경 파일 헤더 주석 관례.
- When: 변경 파일 상단 주석·버전 표기 grep.
- Then: v3.194·수정일 2026-09-20 표기 정합.

### [api] 엔드포인트 검증 (무인증 프로브만)

**API-1. 구글 OAuth login 엔드포인트 무인증 프로브 [api]**
- Given: `GET https://api.maidol.ai.kr/api/auth/oauth/google/login` — redirect **미추적** 필수(`curl -sI --max-redirs 0` 또는 axios maxRedirects:0). 서버 state를 생성할 수 있으므로 **1회 한정**(주의점 4).
- When: 무인증 1회 호출, status·Location·body만 기록.
- Then: ① 302면 Location이 `accounts.google.com` 도메인(정상 배선) — Location에 `null` 문자열 포함 시 `frontend_url` env 미설정 증거로 백엔드 팀 즉시 전달(A-4), ② 503이면 JSON detail이 사용자용 문자열인지 확인(80자 이내·"null" 아님 — U-4 서버측 짝). **콜백 URL(`/callback`) 직접 호출 금지**(state 오염).

**API-2. 카카오 OAuth login 엔드포인트 무인증 프로브 [api]**
- Given/When: API-1과 동일 절차, `/auth/oauth/kakao/login`, 1회 한정.
- Then: 302 시 Location이 `kauth.kakao.com` 도메인. KOE101("앱 관리자 설정 오류")은 서버가 아닌 카카오 콘솔 설정 사안 — 프로브로는 302 배선까지만 판정하고 콘솔 항목(로그인 활성화 ON·Redirect URI·Web 플랫폼 등록)은 tester 체크리스트로 이관(A-4).

**API-3. 네이버 라우트 존치 확인 [api]**
- Given: (B)는 UI만 제거 — 백엔드 `/auth/oauth/naver/*` 무접촉 스펙.
- When: `GET /api/auth/oauth/naver/login` 무인증 1회(redirect 미추적).
- Then: 404가 **아님**(302 또는 503) — 서버측 우발 제거 없음 확인. 인증·쓰기·콜백 시나리오는 전부 스킵(자격증명 부재+state 오염 금지).

### [e2e] 핵심 여정 (각 항목 정적 대체 검증 병기)

> **UNVERIFIED-예정 처리 기준(공통)**: OAuth 실왕복(E-1·E-2)은 ① 구글/카카오 개발자 콘솔 설정(테스트 사용자 등록 또는 프로덕션 게시, Redirect URI `https://api.maidol.ai.kr/api/auth/oauth/{p}/callback` 등록, 카카오 로그인 활성화 ON) ② 실기기 APK 빌드 ③ [전환 반영 시] 백엔드 `client=app` 지원 — 3조건 충족 전에는 실행 불가. 조건 미충족 시 판정은 **UNVERIFIED-예정**(FAIL 아님)으로 기록하고 정적 대체(U-3~U-8) PASS + 콘솔 설정 체크리스트 전달로 게이트 통과. 백엔드 미준비로 openAuthSessionAsync 미전환이면 E-1·E-2의 "앱 자동 복귀" 절은 자동 UNVERIFIED-예정.

**E-1. 구글 로그인 왕복 [e2e]**
- Given: 실기기 APK, 콘솔 3조건 충족(위 기준).
- When: 로그인 화면 → "Google 로 계속하기" 탭 → 브라우저/AuthSession 1회 오픈 → 구글 계정 인증 → 앱 복귀.
- Then: ① 탭 즉시 브라우저 **1회만** 오픈 — 이중 요청(프리플라이트) 없음(리모트 로거 `/_logs/frontend`·네트워크 로그로 `/auth/oauth/google/login` GET이 브라우저 1건뿐인지 확인), ② [전환 시] 인증 성공 → 앱 자동 복귀 → 설정 화면 프로필 표시(로그인 상태), 콜드 스타트 딥링크 `aidol://oauth/callback#token=`도 처리, ③ 실패 시 alert가 사용자용 문장(원시 오류/"null" 노출 금지), ④ "메일 창" 재현 없음 — 고객센터 링크 오탭 가설은 tester가 kimpearl@lotusai.co.kr 수신함 빈 메일로 별도 검증(PLAN A-1).
- 정적 대체: U-3(프리플라이트 0건)+U-4(detail 가드)+U-6(null 가드·loginWithToken 배선)+U-7(콜백 가드)+API-1(302 배선). 미충족 시 UNVERIFIED-예정.

**E-2. 카카오 로그인 왕복 [e2e]**
- Given/When: E-1과 동일 여정, 카카오 버튼. 콘솔 선행조건: 카카오 로그인 활성화 ON + Redirect URI + Web 플랫폼 등록.
- Then: "앱 관리자 설정 오류"(KOE101) 미재현, 인증 성공 → 앱 복귀 → 로그인 반영. 나머지 판정 E-1과 동일.
- 정적 대체: E-1과 동일 세트 + API-2. 미충족 시 UNVERIFIED-예정(콘솔 설정은 코드 밖 — 체크리스트 전달로 완료 처리).

**E-3. 로그인 취소·복귀 (경계) [e2e]**
- Given: 실기기, 소셜 버튼 탭 → 브라우저 오픈 상태.
- When: 인증 미완료로 뒤로가기/닫기 → 앱 복귀 → 같은 버튼 재탭.
- Then: 복귀 시 에러 alert 0건·무한 busy 없음(버튼 스피너 해제)·크래시 없음, 재탭 시 브라우저 재오픈 정상.
- 정적 대체: U-5(finally busy 해제)+U-6 ④(cancel/dismiss 무알럿 분기). 실기기 미가용 시 정적 대체로 PASS 판정 가능(콘솔 설정 불요 항목 — UNVERIFIED 아님).

**E-4. 스플래시 콜드 스타트 [e2e]**
- Given: 콜드 스타트(앱 완전 종료 후 실행).
- When: 스플래시 1막(MY/AI/IDOL) → 2막 관찰.
- Then: 2막에 응원봉 심볼 **미노출**, MAIDOL 로고 행+서브타이틀("당신의 1인 기획사")이 자연 중앙 정렬(빈 공간·위 치우침 없음), 1막→2막 페이드/스케일 전환 기존 동일, 4초 후 MainTabs 진입 정상. 네이티브 스플래시(splash-icon.png, 보라 MAIDOL 텍스트)는 원래 응원봉 없음 — 무변경 확인.
- 정적 대체: U-12(3점 제거+애니메이션·타이밍 diff 무접촉+absoluteFill center 재정렬 구조). 실기기는 스크린샷 확인 요청으로 이관.

**E-5. 아이콘 화면 스팟체크 [e2e]**
- Given: 실기기 Android(이모지 렌더 차이가 드러나는 환경), 로그인/비로그인 각 1회.
- When: 미니플레이어·플레이어·차트·플레이리스트·검색·피드 CTA·로그인 화면·공유/출석/스타 모달 스크린샷.
- Then: ① 1차 교체 화면에 이모지·텍스트 글리프 아이콘 잔존 0(스크린샷 대조), ② ⭐ 재화 표기는 그대로(차트 비용·출석 보상·스타 가이드 금액), ③ 교체 아이콘의 크기·색이 주변 텍스트와 정합(과대/과소 없음), ④ **기능 무회귀**: 미니플레이어 재생/일시정지/닫기(아이콘 교체 후) 동작 동일, 차트 뒤로가기·검색 진입 정상, 모달 ✕→x 닫기 정상, ⑤ 하트는 v3.193 벡터 그대로 — 구 빌드(4a313a5)의 이모지 하트가 재빌드로 해소됐는지 확인(코드 무변경 — 빌드 산출물 검증).
- 정적 대체: U-9(파일별 글리프 0+벡터 존재)+U-10(⭐ 보존)+U-11(prop 확장). 동작 무회귀는 교체가 렌더 노드 치환뿐(핸들러 무접촉)임을 diff로 확인.

**E-6. v3.191~193 무회귀 스팟 [e2e]**
- Given: v3.194 빌드.
- When: ① NowPlaying 상·하단 상태바/제스처바 겹침(3.191), ② 냥냥냥 등 VBR 곡 진행바 조기 고정 없음·긴 제목 마퀴 1줄(3.192), ③ 좋아요 서버 연동(재시작 후 유지)·담기→PlaylistPickerSheet·비로그인 CTA 3화면 Y 일치·상단바 로고 M+AI(보라)+DOL(3.193).
- Then: 전 항목 기존 동작 유지. 특히 (C) 교체가 스친 PlayerScreen·SearchScreen·FeedScreen에서 v3.193 동작 무손상.
- 정적 대체: U-13(파일·라인 단위 diff 가드). 실기기 확인 요청 이관.

### 태그 집계
- [unit] 15건 (U-1~U-15: A 배선·가드 6(U-3~U-8, 이 중 U-6·U-7 일부는 백엔드 준비 조건부) / B 1(U-2) / C 3(U-9~U-11, 경계 1=U-10 ⭐ 보존) / D 1(U-12) / 무회귀·격리·버전 4(U-13~U-15, U-1))
- [api] 3건 (API-1~3 — 무인증·redirect 미추적 프로브 각 1회만. 콜백 호출·인증·쓰기 전면 스킵: state 오염+자격증명 부재. 정적 대체 병기)
- [e2e] 6건 (E-1·E-2 OAuth 왕복 — 콘솔 설정+실기기+백엔드 3조건 미충족 시 **UNVERIFIED-예정** 기준 명시 / E-3 취소 경계 / E-4 스플래시 / E-5 아이콘 스팟체크 / E-6 무회귀 — 전 항목 정적 대체 검증 병기)

### 설계 주의점 (tester·app-dev 참고)
1. **(C)×v3.193 파일 중첩**: PlayerScreen·SearchScreen·FeedScreen·TrackRow는 v3.193 접촉 파일 — 아이콘 교체 diff가 하트 배선(:1030-1034)·담기 분기(:806-811)·CTA 오버레이·마퀴 라인에 침투하지 않는지 **라인 단위**로 확인(U-13). 파일 단위 diff 0 가드는 이번 버전에 못 씀.
2. **A-3 조건 분기**: openAuthSessionAsync 전환은 백엔드 `client=app` 준비 확인 후에만 — 미전환 상태에서 U-6·U-7 ①을 FAIL로 찍지 말 것(N/A). 반대로 전환됐는데 백엔드 미준비면 복귀 URL이 영원히 안 와서 세션이 dismiss로만 끝남 — 이 조합은 FAIL(스펙 위반)로 기록.
3. **미사용 import 잔존**: 프리플라이트 제거 후 `api` import가 남아도 tsc는 통과할 수 있음(noUnusedLocals 설정 확인) — U-3에서 grep으로 별도 판정.
4. **OAuth 프로브 부수효과**: `/login` GET은 서버측 OAuth state를 생성/소모할 수 있음 — 프로브는 redirect 미추적·항목당 1회 한정, `/callback` 직접 호출 절대 금지. PLAN A-2의 "프리플라이트가 state를 선점"한 것과 같은 오염을 테스트가 재현하지 말 것.
5. **⭐ grep 유니코드**: ⭐(U+2B50)와 ⭐️(U+2B50+VS16)를 모두 커버하는 grep 필요. 하트도 동일 — ♥(U+2665)·❤️ 변형 구분. 글리프 검사는 파일별 개별 문자로 수행(정규식 클래스에 이모지 뭉치면 누락 위험).
6. **EmptyState/LoginPrompt 하위호환**: 2차 목록 화면(AgencyProfile·ArtistDetail 등)이 여전히 문자열 icon을 넘김 — prop 확장이 string 렌더를 깨면 이번 버전 범위 밖 화면이 무더기 회귀. string→기존 Text 렌더 유지 필수(U-11).
7. **"메일 창"·"null" 출처 확정은 코드 밖**: A-1 빈 메일 수신함 확인, `/_logs/frontend` 서버 로그의 `[API Error] /auth/oauth/google/login` 본문 확인, `eas credentials` SHA-1 확인(실행은 tester/사용자)은 테스트플랜 판정 항목이 아닌 tester 체크리스트 — E-1 ④에 참조만 연결.

### v3.194 테스트 결과 (tester, 2026-09-20)

| 항목 | 판정 | 근거 요약 |
|---|---|---|
| U-1 타입 무결성 | PASS | `npx tsc --noEmit` exit 0·오류 0건 (icon prop ReactNode 확장 포함 전 호출부 통과) |
| U-2 naver 0건+주석 | PASS | PROVIDERS 2종(google/kakao)만. "naver/네이버"는 두 파일 모두 "v3.194 네이버 제거" 주석뿐. 백엔드 라우트 무접촉(API-3 존치 확인) |
| U-3 프리플라이트 0건 | PASS | `api.get` 코드 0건(주석 1건뿐)·`api` import 제거·`BACKEND_BASE_URL`만 import. noUnusedLocals 미설정 → grep으로 판정(주의점 3 이행) |
| U-4 detail 검증 가드 | PASS | `sanitizeServerMessage`: string+trim>0+길이≤80만 노출, 아니면 고정 문구. decodeURIComponent도 try/catch — null/객체 문자열화 노출 경로 0건 |
| U-5 오픈 실패 alert+busy | PASS | 웹 openURL `.catch`→showAlert, 네이티브 catch→showAlert, `finally { setBusy(null) }` — 무한 busy 없음 |
| U-6 openAuthSessionAsync+null 가드 | PASS(조건부) | ①import+package.json `~15.0.11` ②`openAuthSessionAsync(loginUrl+'?client=app', 'aidol://oauth/callback')`·스킴 aidol=app.json:5 기존재 ③`result?.type==='success' && result.url` 가드+`loginWithToken`(authStore:82) 배선 ④cancel/dismiss 무알럿. **주의점 2 조합 미해소**: 백엔드 client=app 준비 미확인 상태 전환 — 단 미수신 시 dismiss 조용복귀로 현행 UX와 동일(악화 없음)·문서 발행 완료. 백엔드 미지원 확정 시 주의점 2에 따라 FAIL 전환 대상 |
| U-7 App.tsx 콜백 가드 확장 | PASS | ①네이티브 getInitialURL+url 리스너, url null·`oauth/callback` 미포함·token match 실패 시 무동작, `handledTokenRef` dedupe ②웹 경로 로직 무변경(replaceState 보존, 로그 프리픽스만 [SocialLogin]) ③FeedDetail 라우트·prefixes(aidol://·BACKEND_BASE_URL) 보존 |
| U-8 백엔드 요청 문서 | PASS | `백엔드_요청_소셜로그인_앱복귀.md`(PLAN 명칭안) 존재. ①client=app→`aidol://oauth/callback#token=JWT` ②status 엔드포인트 요청(§3) ③frontend_url null 점검(§4) + 실패 시 #error= 복귀(§2)까지 포함 |
| U-9 1차 글리프 0건+벡터 | PASS | 12개 파일 전부 렌더 글리프 0건(잔존 hit는 주석/문구뿐)·Feather 벡터 존재. 색·크기 정합 스팟 3곳 확인(MiniPlayer play/x 16/18 primary/muted, ChartScreen arrow-left 22 primary, PlayerScreen 커버 64 border.subtle=구 스타일 동일). PlayerScreen ⏮⏭·MiniPlayer ⏮⏭도 함께 교체(계획 초과분·무해) |
| U-10 ⭐ 보존 경계 | PASS | ⭐ 출현 HEAD 111→워킹 113(감소 0·증가 2는 신규 주석). VS16 변형 0건. ArtistCodyScreen·FeedCard·GuestQueueNoticeModal diff 0. AttendanceModal :68/:70/:142 문구 이모지 무접촉(:123 아이콘 3종만 교체) |
| U-11 icon prop 확장 | PASS | 두 파일 모두 `icon?: ReactNode`+`typeof icon === 'string'`→기존 Text 렌더 하위호환. 1차 호출부 전부 벡터 전달 전환. LoginPrompt 현 호출부 5곳은 icon 미전달(무영향) |
| U-12 스플래시 심볼 3점 | PASS | require·Image·symbol 스타일 3점 0건+Image import 제거. 에셋 디스크 보존. diff는 3점+주석 한정 — act2Opacity/Scale·4000ms·lineAnims 무접촉, 타이포 40/54·36/44·ls6/3·900·logoRow mb16 보존, styles.act absoluteFill center 재중앙(별도 레이아웃 diff 없음) |
| U-13 무회귀 diff 가드 | PASS | v3.191: PlayerScreen 인셋 라인 diff 0. v3.192: playback.ts·Marquee diff 0, TrackRow :34 1점 한정. v3.193: likesStore·PlaylistPickerSheet·LogoTitle diff 0, PlayerScreen 하트/담기/actionIconBox 무접촉(diff=:910·:1119-1131 글리프+사(死)스타일 3건 제거 한정), SearchScreen 3점 한정(딤 오버레이·setGated 무접촉), FeedScreen :275 한정 |
| U-14 diff 범위 격리 | **FAIL** | app.json diff가 expo-web-browser plugin 추가 외 변경 포함: bundleId/package `com.triplej.studio→com.maidol.app`·expo-media-library plugin·EOF 개행. (정황상 v3.182 이후 잔존 diff — expo-media-library 의존성은 기커밋, app.json 최종 커밋=v3.182 — 이나 게이트 규칙상 FAIL.) package.json도 expo·constants·file-system 패치 범프 동반(expo install 부수 — 허용 범위 판단). 그 외 eas.json·metro.config.js·authService.ts 주석 1줄·바이너리 에셋 등 잔존 diff 계승 — 커밋 시 v3.194 스코프 한정 필수 |
| U-15 버전 문자열 | PASS | 변경 파일 주석 v3.194 표기 정합(SocialLoginButtons·AuthPanel·App.tsx·SplashScreen·MiniPlayer·PlayerScreen·AttendanceModal·EmptyState·LoginPrompt), 문서 작성일 2026-09-20 |
| API-1 google login 프로브 | PASS | 302 → `accounts.google.com/o/oauth2/v2/auth`, redirect_uri=`api.maidol.ai.kr/api/auth/oauth/google/callback`, state 발급 정상, Location에 "null" 없음 |
| API-2 kakao login 프로브 | PASS | 302 → `kauth.kakao.com/oauth/authorize`, redirect_uri 정상, scope=account_email+profile_nickname+profile_image, "null" 없음. KOE101 여부는 콘솔 사안 → 체크리스트 이관 |
| API-3 naver 라우트 존치 | PASS | 503(404 아님) — 라우트 존치, 서버측 우발 제거 없음. detail="naver 소셜 로그인은 현재 사용할 수 없습니다…"(사용자용 문자열·80자 이내·"null" 아님 — U-4 서버측 짝도 양호) |
| E-1 구글 왕복 | UNVERIFIED-예정 | 3조건(콘솔 설정·실기기 APK·백엔드 client=app) 미충족. 정적 대체 U-3·U-4·U-6·U-7+API-1 전부 PASS → 기준상 게이트 통과 처리 |
| E-2 카카오 왕복 | UNVERIFIED-예정 | 동일 기준 + API-2 PASS. 카카오 콘솔 체크리스트(로그인 활성화 ON·Redirect URI·Web 플랫폼) 잔여 목록 전달 |
| E-3 취소·복귀 경계 | PASS(정적 대체) | U-5(finally busy 해제)+U-6④(cancel/dismiss 무알럿) — 콘솔 설정 불요 항목 기준 적용 |
| E-4 스플래시 콜드 스타트 | PASS(정적 대체) | U-12 충족(3점 제거·타이밍/애니 무접촉·absoluteFill center 자동 재중앙). 실기기 스크린샷 확인 이관 |
| E-5 아이콘 스팟체크 | PASS(정적 대체) | U-9+U-10+U-11 충족, diff상 교체 전부 렌더 노드 치환뿐(핸들러·disabled·accessibilityLabel 무접촉). 실기기 Android 스팟 이관 |
| E-6 v3.191~193 무회귀 | PASS(정적 대체) | U-13 라인 단위 가드 충족. 실기기 확인 이관 |

**게이트 판정: 조건부 통과** — 코드 품질 게이트(U-1~U-13·U-15, API 3건, E 정적 대체) 전부 PASS. 유일 FAIL = U-14(커밋 스코프): 코드 결함 아님, **커밋 시 app.json은 expo-web-browser plugin 라인만 스테이징**(bundleId 변경·expo-media-library plugin·eas.json·metro.config.js·authService.ts 등 잔존분은 별도 커밋으로 분리 또는 리드 승인 후 동반 커밋 명시) 조건으로 통과. U-6 조건부: 백엔드 client=app 지원 확인을 릴리스 노트에 미해결로 명기.

**프로브 기록**: google 프로브가 도구 호출 중복으로 GET 2회 발생(state 2건 생성 — 소모 없음·콜백 미호출로 오염 없음, 이후 kakao·naver는 각 1회 준수). /callback 직접 호출 0회.

## v3.195 — 수정일 2026-09-20
해당 없음 — 분석·DB 정리 전용 사이클(코드 수정 없음). DB 실행분 검증은 REPORT v3.195 사후 검증 항목으로 갈음.

## v3.196 — 수정일 2026-09-21

> 대상: (A) 하단 시트 안전영역 인셋 4곳 신규(TrackActionSheet·PlaylistPickerSheet·TrackShareDownloadSheet·ArtistCodyScreen 착장 시트) + 기적용 2곳(PlayerScreen queueSheet·PurchaseModal) **이중 패딩 금지** · (B) PlaylistPickerSheet KAV behavior 양 플랫폼 padding + KAV 없는 입력 모달 4곳 신규(PlaylistScreen 이름변경·AlbumDetailScreen 앨범수정·ArtistResultScreen 프로필수정·SettingsScreen 회원탈퇴) · (참고) 냥냥냥 duration은 서버 데이터 수정으로 기해결 — API 실측 1건으로 확인.
> 실행 환경 관행(v3.191~194 계승): 에뮬레이터/adb/maestro 부재 → [e2e]는 각 항목에 "정적 대체 검증"을 병기하고 실기기 실측은 확인 요청으로 이관. 코드 경로는 `/Users/pearl/TripleJ/2_housing` 기준. 라인 번호는 **변경 전** 워킹트리 실측 기준(적용 후 ±수 라인 이동 허용).
> 변경 허용 파일(격리 기준): `components/TrackActionSheet.tsx`, `components/PlaylistPickerSheet.tsx`, `components/TrackShareDownloadSheet.tsx`, `screens/ArtistCodyScreen.tsx`, `screens/PlaylistScreen.tsx`, `screens/AlbumDetailScreen.tsx`, `screens/ArtistResultScreen.tsx`, `screens/SettingsScreen.tsx` 8개. P2-4·P5 보조 착수 시에만 `ReportModal.tsx`/`AppealModal.tsx`/`AlbumCreateModal.tsx`/`ChartScreen.tsx`/`DmChatScreen.tsx`/`FeedScreen.tsx` 추가 허용(U-9). **PlayerScreen.tsx·PurchaseModal.tsx는 diff 0 필수**(U-6). 그 외 diff는 FAIL(v3.194 U-14에서 지적된 app.json 등 기왕 잔존분은 제외 판단 계승).

### [unit] 정적 검증 (머지 게이트)

**U-1. 타입 무결성 [unit]**
- Given: v3.196 변경이 적용된 워킹트리.
- When: `cd 2_housing && npx tsc --noEmit`.
- Then: exit 0, 오류 0건. (KAV import 추가·insets 배선이 전 파일에서 타입 통과. 단 미사용 import 잔존은 tsc가 못 잡을 수 있음 — noUnusedLocals 미설정, U-7에서 grep 별도 판정.)

**U-2. (A) TrackActionSheet 인셋 배선 [unit]**
- Given: 변경 전 `components/TrackActionSheet.tsx:91` `<View style={styles.sheet}>`, styles.sheet(:158) `padding: spacing.xl` 고정(하단 인셋 없음).
- When: ① `grep -n "useSafeAreaInsets" components/TrackActionSheet.tsx` — import(react-native-safe-area-context)+컴포넌트 내 `const insets = useSafeAreaInsets()` 선언, ② 시트 View의 style이 배열 병합 `[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]` 형태, ③ "Modal은 루트 인셋 미상속" 취지 주석 존재(PlayerScreen:1348 관행).
- Then: ①~③ 전부 존재. **인라인 병합만 인정** — StyleSheet.create 안에 insets를 넣는 형태는 렌더 시점 값이라 불가능(발견 시 FAIL). static `padding: spacing.xl`은 shorthand이므로 배열 뒤 인라인 paddingBottom이 override — 병합 순서(인라인이 뒤) 확인. 시트 내부 액션 행·헤드 스타일(:159-176) diff 무접촉.

**U-3. (A) PlaylistPickerSheet 인셋 배선 [unit]**
- Given: 변경 전 `components/PlaylistPickerSheet.tsx:88` 시트 TouchableOpacity `style={styles.sheet}`, styles.sheet(:122) 하단 인셋 없음.
- When: U-2와 동일 3점 확인(`paddingBottom: insets.bottom + spacing.xl`).
- Then: 3점 충족. **v3.193 접촉 파일 — 라인 단위 격리**: 이 파일의 diff가 (인셋 1개소 + U-7 behavior 1개소)에 한정되고, trackIds POST 루프(`/playlists/{id}/tracks`, :40 인근)·새 플레이리스트 생성·성공/실패 안내 로직·prop 시그니처(`visible/trackIds/onClose`) 무접촉.

**U-4. (A) TrackShareDownloadSheet 인셋 배선 [unit]**
- Given: 변경 전 `components/TrackShareDownloadSheet.tsx:158` 시트 `style={styles.sheet}`, styles.sheet(:189) `paddingBottom: spacing.xxl ?? spacing.xl` 고정.
- When: U-2와 동일 확인, 단 가산 기준은 `insets.bottom + spacing.xxl`(PLAN P3-5).
- Then: 배선 존재 + static paddingBottom과 인라인이 **중복 가산되지 않는 구조**(인라인 override 또는 static 제거 중 택일 — 둘 다 남아도 override라 시각 결과는 동일하나, static의 `?? spacing.xl` 표기가 함께 정리됐는지 기록). busy 중 backdrop 닫기 차단(:157 `!busy && onClose()`) 무접촉.

**U-5. (A) ArtistCodyScreen 착장 시트 인셋 [unit]**
- Given: `screens/ArtistCodyScreen.tsx` — insets는 :150에 **기존재**(신규 import 아님), 착장 아이템 선택 Modal(:761)의 modalBox(:1087)는 maxHeight '80%'만 있고 하단 인셋 없음.
- When: 아이템 선택 Modal 내 modalBox 사용처의 style 배열에 `paddingBottom: insets.bottom`(+기존 내부 패딩 유지) 병합 확인. `grep -c "useSafeAreaInsets" screens/ArtistCodyScreen.tsx` = import 1·호출 1(중복 훅 호출 신설 금지).
- Then: 병합 존재. 같은 파일의 ScrollView `automaticallyAdjustKeyboardInsets`(:624, v3.182 정상군) 라인 무접촉. modalBox 내부 FlatList/그리드가 있다면 마지막 행 가림은 paddingBottom으로 해소되는 구조(contentContainerStyle 별도 필요 여부 열람 기록).

**U-6. (A·핵심 경계) 기적용 2곳 이중 패딩 금지 — diff 0 [unit]**
- Given: PlayerScreen queueSheet(:1346-1349)는 v3.191에서 `paddingBottom: insets.bottom + spacing.xxl` 기적용, PurchaseModal(:43)은 `16 + insets.bottom` 기적용. PLAN 명시 "손대지 말 것".
- When: `git diff -- screens/PlayerScreen.tsx components/PurchaseModal.tsx`.
- Then: **diff 0건이 기준**. diff 발견 시 즉시 FAIL이 원칙이나, 사유 확인 후 아래 라인 단위 검증으로 승격 판정: queueSheet 인셋 라인(:1348-1349)·PurchaseModal(:43) **변경은 무조건 FAIL**(이중 적용/재수정 금지 명령 위반). PlayerScreen은 v3.191(인셋)·v3.192(marquee·duration 방어)·v3.193(하트 :1030-1034·담기 :806-811·actionIconBox)·v3.194(아이콘 벡터) 4개 버전 접촉 파일 — 그 외 라인이라도 접촉 시 해당 버전 회귀 재검증 필요로 승격(U-11과 연동).

**U-7. (B) PlaylistPickerSheet KAV behavior 양 플랫폼 공통화 [unit]**
- Given: 변경 전 :86 `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` (v3.182 — Android는 Modal 별도 window라 resize 미보장인데 undefined).
- When: ① `grep -n "behavior=" components/PlaylistPickerSheet.tsx` → 플랫폼 삼항 **0건**, `behavior="padding"` 존재(KAV `style={{flex:1}}`·`pointerEvents="box-none"` 유지), ② `Platform` import가 다른 사용처 없이 잔존하면 제거됐는지 grep(잔존 시 경미 — 기록만).
- Then: ① 충족. iOS 동작은 기존과 동일(padding 유지)이므로 iOS 회귀 없음이 정적으로 보장됨.

**U-8. (B) 입력 모달 4곳 KAV 신규 구조 [unit]**
- Given: 기준 패턴 = ReportModal.tsx:77 `<KeyboardAvoidingView style={{ flex: 1 }} behavior=... pointerEvents="box-none">`가 Modal 직하를 감싸고 :140에서 닫힘. 신규 4곳은 현재 KAV 전무 — ① PlaylistScreen 이름변경(:269, autoFocus 있음·센터 배치), ② AlbumDetailScreen 앨범수정(:447, multiline 포함), ③ ArtistResultScreen 프로필수정(:1406, TextInput 3필드 :1421/:1429/:1451), ④ SettingsScreen 회원탈퇴(:645, 센터 배치).
- When: 4파일 각각 해당 Modal 직하에 `KeyboardAvoidingView` — `flex:1`+`behavior="padding"`(신규는 처음부터 플랫폼 공통, 삼항 금지)+`pointerEvents="box-none"` — 로 기존 backdrop/card 전체를 감싸고 닫는 태그가 Modal 닫기 직전에 위치하는지 구조 확인. 같은 파일의 **다른** Modal(예: ArtistResultScreen :1229 시트·ZoomModal :1592, SettingsScreen :706 프로필편집)은 무접촉.
- Then: 4곳 전부 충족. PlaylistScreen `autoFocus`·backdrop 탭 닫기(TouchableOpacity onPress) 유지, AlbumDetail multiline TextInput 속성 무변경, SettingsScreen 탈퇴 확인 로직(비밀번호/문구 입력·버튼 핸들러) diff 무접촉 — **KAV 래핑 외 내부 diff 0**.

**U-9. (조건부) P2-4 KAV 통일·P5 보조 [unit]**
- Given: PLAN상 ReportModal/AppealModal/AlbumCreateModal의 `behavior="padding"` 통일은 "Android 실기기에서 P2-3 가림 해소 확인 후", P5(ChartScreen 죽은 스타일 삭제·검색 FlatList 패딩·DmChat inputBar 인셋·FeedCard)는 "시간 남으면".
- When: 각 파일 `git diff` 유무 확인.
- Then: **미적용이면 N/A(FAIL 아님)** — 잔여 목록으로 기록. 적용됐다면: ⓐ 3개 모달은 behavior 삼항→"padding" 1줄 diff 한정(각 파일 그 외 diff 0), ⓑ ChartScreen은 :445-447 `sheetBackdrop`/`sheet` 스타일 삭제 시 `grep -n "styles.sheet" screens/ChartScreen.tsx` 사용처 0건 재확인(살아있는 참조 삭제 금지) + 검색 FlatList `contentContainerStyle` paddingBottom에 insets 가산, ⓒ DmChat은 inputBar 하단 여백 1개소 한정.

**U-10. diff 범위 격리 [unit]**
- Given: 변경 허용 파일 목록(전문 헤더) + v3.194 U-14 잔존 diff(app.json bundleId·eas.json·metro.config.js 등)는 7f1c245에서 커밋 정리됨.
- When: `git status --short` + `git diff --stat` (2_housing 스코프).
- Then: 허용 목록(+U-9 조건부 파일) 외 diff 0. 바이너리·에셋·설정 파일 diff 0. 커밋 시 v3.196 스코프 파일만 스테이징.

**U-11. v3.191~195 무회귀 라인 검사 [unit]**
- Given: 이번 접촉 파일과 기왕 버전의 중첩 — PlaylistPickerSheet(v3.193 담기 대상)·PlayerScreen(v3.191/192/193/194)·SettingsScreen(v3.182 프로필편집 ScrollView)·ArtistCodyScreen(v3.182 키보드 정상군·v3.195 착장 분석 대상).
- When: ① v3.191: PlayerScreen 인셋 라인 diff 0(U-6과 동일 근거 재사용), ② v3.192: `git diff -- services/playback.ts components/Marquee.tsx`(또는 marquee 소재 파일) 0건, ③ v3.193: `git diff -- stores/likesStore.ts App.tsx` 0건 + PlaylistPickerSheet diff가 U-3/U-7 2개소 한정(라인 단위 — POST 루프·안내 로직 무접촉), ④ v3.194: `git diff -- components/SocialLoginButtons.tsx components/AuthPanel.tsx screens/SplashScreen.tsx` 0건, ⑤ v3.182 정상군: PlayerScreen 상세패널 KAV(:1096)·SettingsScreen 프로필편집 ScrollView(:715 인근)·ArtistCodyScreen :624 무접촉.
- Then: ①~⑤ 전부 충족. 위반 시 해당 버전 TESTPLAN 항목 재실행으로 승격.

**U-12. 웹 무회귀 정적 근거 [unit]**
- Given: 웹에서 `useSafeAreaInsets().bottom === 0` → 전 변경이 no-op, KAV behavior="padding"은 웹에서 무동작(RN Web KAV는 사실상 pass-through).
- When: 신규 훅 호출 4곳이 모두 컴포넌트 함수 본문 최상위(조건부/콜백 내 훅 호출 금지 — lint 규칙 위반 여부)이고, SafeAreaProvider(App.tsx 루트, v3.191 기존재) 하위에서만 렌더되는 컴포넌트인지 확인.
- Then: 훅 규칙 위반 0건. 웹 전용 분기 코드 신설 **없음**(인셋 0으로 자연 no-op이 스펙 — Platform.OS==='web' 분기 발견 시 과대설계로 기록).

### [api] 실측 검증

**API-1. 냥냥냥 duration_sec 서버 수정 확인 [api]**
- Given: v3.195에서 서버 데이터 직접 수정 완료(duration_sec 91→163, 파일 재먹싱 — 코드 변경 아님). 무인증 공개 엔드포인트.
- When: `curl -s https://api.maidol.ai.kr/api/tracks/6aa3ec295f11b57ba518f5e8 | jq .` — **GET 1회만**, 쓰기·재시도 금지.
- Then: 200 + 응답의 `duration_sec === 163`(91 잔존 시 FAIL — 서버 수정 미반영). 파일 재먹싱 자체(실제 오디오 길이)는 API로 판정 불가 — 스트림 실측은 E-5 ②로 이관(v3.192 방어 보정이 있어 duration_sec만 맞으면 진행바는 정상). 응답의 다른 필드(제목·아티스트) 상식 점검만 기록.

### [e2e] 핵심 여정 (실기기 이관 + 정적 대체 병기)

**E-1. 차트 ⋮ 시트 하단 노출 [e2e]**
- Given: Android 실기기 **제스처 내비게이션** 모드, 차트 화면.
- When: 임의 곡의 ⋮ 탭 → TrackActionSheet 오픈.
- Then: 마지막 액션 행이 제스처 바 위로 완전 노출·오탭 없이 탭 가능. 이어서 시스템 설정에서 **3버튼 내비**로 전환 후 재확인 — 3버튼은 insets.bottom이 내비바 높이(~48dp)로 커지므로 가림 0 + 여백 과다가 극단적이지 않은지(가림만 없으면 PASS, 과다 여백은 기록). iOS 홈 인디케이터 기기 동일 확인. 검색·플레이리스트 진입 경로의 같은 시트도 스팟 1회(공용 컴포넌트라 대표성 있음).
- 정적 대체: U-2(배선)+U-6(기준 사례 queueSheet와 동일 패턴임을 diff로 확인). 실기기 미가용 시 정적 대체로 PASS 판정 가능.

**E-2. 담기 시트 + 새 플레이리스트 입력 [e2e]**
- Given: Android 실기기 제스처 내비, 로그인 상태, NowPlaying(또는 ⋮→담기).
- When: ① 담기 → PlaylistPickerSheet 오픈 — 마지막 항목/버튼 가림 확인, ② "새 플레이리스트" 입력 탭 → 키보드 오픈.
- Then: ① 하단 버튼 제스처 바 위 완전 노출, ② **입력창+만들기 버튼이 키보드 바로 위 노출**(이번 버전 핵심 — 변경 전 Android는 behavior undefined로 가림 재현 지점), 입력·생성·닫기(backdrop 탭 포함) 정상, 생성된 플레이리스트에 곡 담김. 키보드 열림 중 insets.bottom 가산이 겹쳐 여백이 어색하면 기록(PLAN의 선택 최적화 판단 자료 — FAIL 아님). iOS에서 기존과 동일 동작(회귀 없음) 1회.
- 정적 대체: U-3+U-7. **P2-4 확산(ReportModal 등 3곳)은 본 항목 실측 PASS가 선행 조건** — 실측 불가 시 P2-4는 착수 보류가 정답(U-9 N/A).

**E-3. 공유/다운로드 시트·착장 시트 하단 노출 [e2e]**
- Given: Android 실기기 제스처 내비.
- When: ① 곡 공유/다운로드 시트 오픈 → mp3 항목(최하단), ② ArtistCody 착장 카테고리 탭 → 아이템 선택 시트 최하단 행.
- Then: 두 시트 모두 최하단 요소 가림 0. 착장 시트는 maxHeight 80% 상태에서 스크롤 끝까지 내렸을 때 마지막 행 완전 노출.
- 정적 대체: U-4+U-5.

**E-4. 입력 모달 4곳 키보드 [e2e]**
- Given: Android 실기기(키보드 가림이 재현되는 환경), 각 화면 진입 가능한 계정 상태.
- When/Then: ① PlaylistScreen 이름변경 — autoFocus로 즉시 키보드 오픈, 입력창+변경/취소 버튼 미가림(autoFocus+KAV 조합의 첫 프레임 점프가 있으면 기록), ② AlbumDetailScreen 앨범수정 — **multiline 설명 필드(최하단)** 포커스 시 미가림, ③ ArtistResultScreen 프로필수정 — **3필드 중 최하단(:1451)** 포커스 시 미가림, ④ SettingsScreen 회원탈퇴 — 입력 포커스 시 모달이 위로 밀려 미가림, 단 위로 밀린 상태에서 **탈퇴(위험 액션) 버튼 위치가 직전 탭 위치와 겹쳐 오탭 유발하지 않는지** 확인. 4곳 모두 키보드 닫기(뒤로가기) 후 모달 원위치·취소/확인 정상.
- 정적 대체: U-8. 센터 배치 모달(①④)은 behavior="padding"로 전체가 위로 이동하는 방식 — 가림 잔존 시 필드별 scrollTo 필요로 승격 기록.

**E-5. 정상군·v3.191~195 무회귀 스팟 [e2e]**
- Given: v3.196 빌드.
- When/Then: ① **queueSheet 이중 패딩 육안**: NowPlaying 재생목록 시트 하단 여백이 v3.191 당시와 동일(과다 여백 = 이중 적용 신호 → U-6 재검), PurchaseModal 동일, ② **냥냥냥 재생**: 진행바가 2:43(163s) 기준으로 자연 진행·조기 고정 없음(API-1과 정합 — v3.192 방어 보정 위에서 실측), ③ 키보드 정상군: PlayerScreen 댓글 입력(v3.182)·DM 채팅·가사/작곡 입력 화면 기존 동작 그대로, ④ v3.193 담기 플로우(로그인 담기→시트·비로그인→GuestQueueNoticeModal)·좋아요 유지, ⑤ v3.194 소셜 로그인 버튼 표시·스플래시, ⑥ 웹 빌드 1회: 시트 4곳+입력 모달 4곳 표시·닫기 동일(인셋 0 no-op 확인).
- 정적 대체: U-6+U-11+U-12+API-1. 실기기 확인 요청 이관.

### 태그 집계
- [unit] 12건 (U-1~U-12: A 인셋 4(U-2~U-5)+이중 패딩 경계 1(U-6) / B KAV 2(U-7·U-8) / 조건부 1(U-9, 미적용 시 N/A) / 격리·무회귀·웹 4(U-1·U-10·U-11·U-12))
- [api] 1건 (API-1 — 무인증 공개 GET 1회, duration_sec=163 실측. 쓰기·콜백 전면 스킵)
- [e2e] 5건 (E-1 차트 ⋮ 시트(제스처/3버튼 구분) / E-2 담기 시트+입력(P2-4 선행 조건) / E-3 공유·착장 시트 / E-4 입력 모달 4곳 / E-5 무회귀 스팟 — 전 항목 정적 대체 병기)

### 설계 주의점 (tester·app-dev 참고)
1. **StyleSheet 병합 방향만 인정**: insets는 렌더 시점 값 — `StyleSheet.create` 안에 넣는 코드는 성립 불가. 반드시 `[styles.sheet, { paddingBottom: insets.bottom + ... }]` 인라인 병합(배열 뒤가 우선이라 static `padding` shorthand를 override). static에 paddingBottom을 남겨둬도 시각 결과는 동일하나 이중 표기라 기록 대상.
2. **이중 패딩의 두 얼굴**: ⓐ 기적용 2곳(PlayerScreen·PurchaseModal) 재수정 = 무조건 FAIL(U-6), ⓑ PlaylistPickerSheet에서 키보드 열림 중 KAV padding+insets 가산이 **겹치는 것은 스펙상 허용**(PLAN의 "선택 최적화" 미적용 상태) — E-2에서 어색함 관찰 기록만, FAIL 아님. 둘을 혼동해 ⓑ를 FAIL로 찍지 말 것.
3. **3버튼 내비 판정 기준**: 3버튼 모드는 insets.bottom이 커져 여백이 과다해 보일 수 있으나 판정은 "가림 0"만 — 여백 미학은 기록. 제스처/3버튼 두 모드를 반드시 구분 실측(E-1).
4. **PlayerScreen은 diff 0이 기준**: v3.191~194 4개 버전 접촉 파일이라 이번에 파일 단위 diff 0 가드를 **쓸 수 있는 마지막 기회** — diff가 하나라도 있으면 U-6/U-11의 라인 단위 검사로 승격되고 판정 비용이 급증. app-dev는 이 파일을 열지도 말 것.
5. **P2-4는 실측 게이트 뒤에 있음**: ReportModal 3종 behavior 통일은 E-2 Android 실측 PASS가 선행 조건(PLAN 명시). 실기기 미가용 사이클에서는 U-9를 N/A로 두고 잔여 목록으로 이월 — 정적 대체만으로 P2-4를 착수/판정하지 말 것. Android Modal+edgeToEdge에서 behavior="padding"이 기기별 이중 이동(과잉 점프)을 일으키는 변형 사례가 알려져 있어 실측 근거가 필요.
6. **입력 모달 4곳은 "래핑 외 diff 0"**: KAV는 Modal 직하 1겹 래핑이 전부 — 내부 backdrop 탭 닫기·autoFocus·multiline·탈퇴 확인 로직에 diff가 침투하면 FAIL. 특히 SettingsScreen 회원탈퇴는 위험 액션이라 핸들러 라인 무접촉을 라인 단위로 확인(U-8).
7. **같은 파일의 다른 모달 오염 주의**: ArtistResultScreen(:1229 시트·:1592 ZoomModal)·SettingsScreen(:706 프로필편집)에는 이번 대상이 아닌 Modal이 공존 — grep 히트를 대상 모달로 오인해 엉뚱한 곳에 KAV를 감았는지 라인 범위로 교차 확인.
8. **API-1 한계**: duration_sec=163은 메타데이터 검증일 뿐, 재먹싱된 실제 오디오 길이는 스트림 실측(E-5 ②)에서만 확인 가능. 단 v3.192 방어 보정(엔진값·위치·API 최대값)이 살아 있으므로(U-11 ②) 메타만 맞으면 진행바 회귀 위험은 낮음 — API 1회로 게이트 통과 처리하고 실측은 이관.

### 실행 결과 — 2026-09-21 (tester)

> 실행 환경: 에뮬레이터/adb/maestro 부재 → [e2e] 전 항목 정적 대체 검증(관행 계승). 코드 기준 `/Users/pearl/TripleJ/2_housing` 워킹트리. 콘텐츠 변경 파일 11개 실측(앱-dev 보고와 일치): TrackActionSheet·PlaylistPickerSheet·TrackShareDownloadSheet·MiniPlayer / ArtistCody·Playlist·AlbumDetail·ArtistResult·Settings·Chart·PlayerScreen. 그 외 M 표시는 전부 100644→100755 모드 변경(바이너리 콘텐츠 diff 0 — 기왕 잔존분 계승, 제외 판단).

| 항목 | 판정 | 근거 요약 |
|------|------|-----------|
| U-1 타입 무결성 | PASS | `npx tsc --noEmit` exit 0, 오류 0건 |
| U-2 TrackActionSheet 인셋 | PASS | import :7·훅 :40(주석 포함)·인라인 배열 병합 :94 `[styles.sheet, {paddingBottom: insets.bottom + spacing.xl}]`. StyleSheet.create 내 insets 0건. 액션 행/헤드 스타일 무접촉 |
| U-3 PlaylistPickerSheet 인셋 | PASS | 3점 충족(:5/:19/:87-88). diff가 인셋 1+behavior 1(+import 정리)에 한정 — trackIds POST 루프·생성/안내 로직·prop 시그니처 무접촉 |
| U-4 TrackShareDownloadSheet 인셋 | PASS(기록) | 인라인 `insets.bottom + spacing.xxl`(:162) 배선. **기록**: static styles.sheet(:192) `paddingBottom: spacing.xxl ?? spacing.xl` 표기 잔존 — 인라인 override로 시각 동일(이중 가산 아님), 차기 정리 후보. busy backdrop(:160) 무접촉 |
| U-5 ArtistCodyScreen 착장 시트 인셋 | PASS(기록) | modalBox 배열 병합 `paddingBottom: insets.bottom`(:769). useSafeAreaInsets = import 1(:19)+호출 1(:150), 중복 훅 신설 없음. :624 정상군 무접촉. **열람 기록**: 내부 FlatList(2열, :814)는 박스 패딩으로 마지막 행 해소되는 구조 — contentContainerStyle 별도 불요 판단 |
| U-6 기적용 2곳 이중 패딩 금지 | PASS(승격 경유) | PurchaseModal diff 0. PlayerScreen은 파일 diff 존재(P6 미니바 아이콘 :1120-1129 한정)로 라인 단위 승격 — queueSheet 인셋 라인(:1348-1351)·상세패널 KAV(:1096) 무접촉 확인. 무조건 FAIL 조건(기적용 라인 변경) 미해당. 접촉 사유는 U-P6에서 별도 판정 |
| U-7 KAV behavior 공통화 | PASS | 플랫폼 삼항 0건, `behavior="padding"`(:88), `style={{flex:1}}`·`pointerEvents="box-none"` 유지. Platform import 제거 완료(잔존 0건) |
| U-8 입력 모달 4곳 KAV | PASS | 4곳(Playlist :270, AlbumDetail :448, ArtistResult :1413, Settings :652) Modal 직하 KAV `flex:1`+`behavior="padding"`+`box-none` 래핑, 닫는 태그 Modal 닫기 직전. 래핑 외 내부 diff 0(autoFocus·multiline·탈퇴 핸들러 무접촉). 같은 파일 타 모달(ArtistResult :1229 시트/ZoomModal, Settings 프로필편집) 무접촉 |
| U-9 조건부 P2-4·P5 | N/A + PASS(부분) | P2-4(ReportModal·AppealModal·AlbumCreateModal)·DmChat·FeedCard: diff 0 = **미적용 → N/A(정상, E-2 실측 선행 조건 미충족)**. P5 중 ChartScreen만 착수: ⓑ 판정 — 삭제된 sheet 스타일 12줄의 사용처 `grep styles.sheet` 0건(죽은 코드 확인), 검색 FlatList `contentContainerStyle paddingBottom: insets.bottom + spacing.xl` 가산(:344), insets 기존재(:63). ChartScreen 그 외 diff 0 |
| U-10 diff 범위 격리 | PASS(조건부) | 허용 8파일 중 6 + ChartScreen(U-9 허용) 접촉. **목록 외 2파일(MiniPlayer·PlayerScreen)은 P6 신규 스코프** — U-P6 임시 편성으로 판정 이관(아래). 바이너리·에셋·설정 콘텐츠 diff 0(모드 변경만, 기왕 잔존). 커밋 시 11파일 명시 스테이징 필요 |
| U-11 v3.191~195 무회귀 | PASS | ① queueSheet 인셋 라인 diff 0 ② playback.ts·marquee 0 ③ likesStore·App.tsx 0 + PlaylistPickerSheet 2개소 한정 ④ SocialLoginButtons·AuthPanel·SplashScreen 0, v3.194 벡터화 라인(:1030·:1259) 무접촉 ⑤ :1096 KAV·Settings 프로필편집 ScrollView·ArtistCody :624 무접촉 |
| U-12 웹 무회귀 정적 근거 | PASS | 신규 훅 4곳 전부 컴포넌트 본문 최상위(조건부/콜백 내 0건). SafeAreaProvider(App.tsx :512) 하위 렌더. 웹 전용 분기 신설 0건(TrackShareDownloadSheet :98은 기존재 코드) |
| **U-P6 (임시 편성) 미니바 MCI 전환** | PASS | MiniPlayer: MCI import(:3)·play/pause size 20(:98), 대형 아님(36px 원 유지). PlayerScreen: MCI import 기존재(:25)·:1126 size 16. marginLeft 조건부 스타일 잔존 **0건**(양 파일 grep — 주석 언급만). 대형 버튼 playTriangle `marginLeft: 4`(:1580) 무변경. 광학 보정 근거(MCI 글리프 bbox) 주석 병기됨. 시각 균형은 실기기 육안 이관 |
| API-1 냥냥냥 duration_sec | PASS | GET 1회, 200. `duration_sec: 163`(91 아님). 제목 "냥냥냥"·artist_name "진주"·bpm 120 상식 정합. beats 배열 끝 161.15s로 163s와 정합 |
| E-1 차트 ⋮ 시트 | PASS(정적 대체) | U-2+U-6 — queueSheet(v3.191)와 동일 패턴 확인. 제스처/3버튼 실측 이관 |
| E-2 담기 시트+입력 | PASS(정적 대체) | U-3+U-7. Android 실측 PASS 전까지 P2-4 착수 보류 유지(U-9 N/A와 정합) |
| E-3 공유/착장 시트 | PASS(정적 대체) | U-4+U-5 |
| E-4 입력 모달 4곳 키보드 | PASS(정적 대체) | U-8. 센터 모달(①④) 첫 프레임 점프·탈퇴 버튼 오탭 여부는 실측 이관 |
| E-5 무회귀 스팟 | PASS(정적 대체) | U-6+U-11+U-12+API-1 |

**집계**: PASS 17 / FAIL 0 / N/A 1(U-9 P2-4분 — 조건부 규칙상 정상). **게이트: PASS(머지 가능)**.

**실기기 잔여(이관)**: ① E-1 제스처/3버튼 내비 시트 하단 노출 ② E-2 Android 키보드 위 입력창 노출(→PASS 시 P2-4 착수 게이트 해제) ③ E-3 두 시트 최하단 행 ④ E-4 4개 모달 키보드+탈퇴 버튼 오탭 ⑤ E-5 ① 이중 패딩 육안·② 냥냥냥 2:43 진행바 실측·③~⑥ 정상군/웹 1회 ⑥ U-P6 미니바 아이콘 시각 균형(20px/16px) 육안.

## v3.197 — 수정일 2026-09-21

> 대상: BT/화면꺼짐 상태 다음곡 자동재생 실패 + 재생버튼 무반응 복구 불능 수정(PLAN.md v3.197 T1~T6) — ① 다음 곡 프리로드(잔여 ≤20초 트리거·shuffle 인덱스 핀·`shouldPlay:false`) ② didJustFinish 2계통(playback.ts·PlayerScreen) 프리로드 스왑 우선 전환 ③ 재생버튼 2곳(PlayerScreen togglePlayPause·MiniPlayer togglePlay) 죽은 객체 재로드 폴백 ④ `status.error` 분기 신설 2곳 ⑤ AppState 'active' 리컨사일(자동 재재생 금지) ⑥ [BTDebug] warn 레벨 원격 계측.
> 실행 환경 관행(v3.191~196 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 정적 대체 병기 + 실기기 실측 이관. 특히 이번 버전의 핵심 시나리오(BT/차량·화면꺼짐·비행기모드)는 **에뮬레이터로도 재현 불가 — 실기기 전용**임을 각 항목에 명시. 코드 경로 `/Users/pearl/TripleJ/2_housing`, 라인 번호는 **변경 전** 워킹트리 실측 기준(적용 후 ±수십 라인 이동 허용 — PlayerScreen은 이번에 diff가 필연이므로 "diff 0 가드" 불가, 라인 단위 무침투 검사로만 판정).
> 변경 허용 파일(격리 기준): `services/playback.ts`, `screens/PlayerScreen.tsx`, `components/MiniPlayer.tsx`, `App.tsx`(T4를 playback.ts init 함수로 두면 App.tsx는 호출 1줄 또는 diff 0) 4개. **app.json은 diff 0 필수**(T6 — 확인만), `services/audioMode.ts`·`services/remoteLogger.ts`·`stores/playerStore.ts` diff 0(재호출·기존 API 사용만, 수정 금지가 PLAN 전제). 그 외 diff는 FAIL.

### [unit] 정적 검증 (머지 게이트)

**U-1. 타입 무결성 [unit]**
- Given: v3.197 변경이 적용된 워킹트리.
- When: `cd 2_housing && npx tsc --noEmit`.
- Then: exit 0, 오류 0건. (신규 export `preloadNext`/`consumePreloaded` 시그니처, AppState 타입, getStatusAsync 반환 내로잉이 전부 타입 통과.)

**U-2. 프리로드 모듈 구조 [unit]**
- Given: PLAN T1 — `services/playback.ts` 모듈 스코프 `nextPreload = { trackId, sound, pinnedIdx, gen }`. 변경 전 getNextIndex()는 shuffle 시 **호출마다 랜덤**(stores/playerStore.ts:178-183).
- When: ① `grep -n "preloadNext\|consumePreloaded\|nextPreload" services/playback.ts` — export 2건+보관 구조 존재, ② 트리거 조건이 "남은 시간 ≤ 20초(20000ms) 또는 position/duration ≥ 85%"이고 **duration은 effectiveDuration(보정값) 기준**인지, ③ 곡당 1회 가드(이미 preload된 trackId/gen이면 재시도 안 함), ④ createAsync 옵션이 `{ shouldPlay: false }`인지(`shouldPlay: true` 발견 시 즉시 FAIL — 프리로드 곡이 겹쳐 소리 남), ⑤ 프리로드 시점에 `getNextIndex()`를 **1회 호출해 pinnedIdx로 핀**하고, didJustFinish 소비 시 getNextIndex() **재호출이 없는지**(재호출 발견 시 FAIL — shuffle에서 프리로드 곡≠실제 전환 곡 불일치).
- Then: ①~⑤ 전부 충족. 트리거 호출부가 양쪽 상태 콜백(playback.ts:101-·PlayerScreen onPlaybackStatusUpdate) 모두에 배선.

**U-3. 프리로드 해제·폐기 경로 — 메모리 누수 경계 [unit]**
- Given: 프리로드 sound는 스왑 소비 전까지 고아 후보 — 해제 누락 시 곡마다 네이티브 사운드 객체 누적(장시간 연속재생에서 OOM/이중 재생).
- When: ① **스왑 성공 시**: consumePreloaded가 반환한 뒤 nextPreload 슬롯이 비워지는지(null 리셋), 스왑으로 대체된 **이전 곡 sound의 unloadAsync 호출이 존재**하는지, ② **폐기 시**: 수동 스킵·큐 편집(remove/reorder)·셔플/반복 토글·미니플레이어 닫기(cleanup) 경로에서 프리로드 sound `unloadAsync()` 후 버리는 코드 존재 — 기존 loadGen 세대 토큰(playback.ts:11-17)에 연동해 stale gen이면 소비 거부하는지, ③ **매치 실패 시**: consumePreloaded(expectedTrackId) 불일치 반환 경로에서도 보유 sound를 unload 후 null 반환(unload 없이 버리면 누수), ④ `grep -c "unloadAsync" services/playback.ts` — 변경 전 대비 증가분이 위 경로들과 1:1 대응(설명 불가한 감소는 FAIL).
- Then: ①~④ 전부 충족. "폐기인데 unload 누락" 0건이 판정 기준.

**U-4. 2계통 didJustFinish 스왑 우선 배선 [unit]**
- Given: 변경 전 didJustFinish 2계통 — `services/playback.ts:121-129`(loadAndPlayTrack 재귀), `screens/PlayerScreen.tsx:410-443`(자체 unload→createAsync). 한쪽만 배선하면 로더 소유권에 따라 증상 잔존.
- When: ① 두 계통 **모두** didJustFinish 최초 분기에서 `consumePreloaded(...)`를 먼저 시도하고 null이면 기존 createAsync/loadAndPlayTrack 폴백인지 grep 교차 확인, ② 스왑 경로에서 반환된 sound에 즉시 `playAsync()`+상태 콜백 부착이 있는지 — **콜백 부착 시 v3.192 effectiveDuration 보정 경로를 타는지**(프리로드 곡만 보정 누락되면 냥냥냥류 VBR 회귀), ③ PlayerScreen 폴백 catch(변경 전 :440-442)에서 `soundRef.current = null` + `store.setSound(null)` + `setIsPlaying(false)` + [BTDebug] warn, playback.ts catch(변경 전 :142-144)에서 `setSound(null)`+`setIsPlaying(false)`+warn, unload 직후(변경 전 :91-93) setSound(null)로 죽은 참조 창 제거, ④ autoContinueWithRelated 주입 로더(PlayerScreen 변경 전 :451-471)에도 실패 시 동일 참조 정리.
- Then: ①~④ 충족. "2계통 중 1곳만 배선" 발견 시 FAIL.

**U-5. 재생버튼 2곳 getStatusAsync 폴백 [unit]**
- Given: 변경 전 `PlayerScreen.tsx:727-734` togglePlayPause — `if (!soundRef.current) return;` 후 호출뿐(try/catch·isLoaded 검사 전무), `components/MiniPlayer.tsx:22-31` togglePlay — 동일 + 낙관적 setIsPlaying.
- When: 두 함수 각각 ① try/catch 존재, ② `getStatusAsync()`로 isLoaded 확인 → 미로드/에러/참조 null이면 `applyPlaybackAudioMode()` 재호출 후 현재 store.track 재로드(PlayerScreen은 loadAndPlay, MiniPlayer는 loadAndPlayTrack) 폴백, ③ playAsync 실패 catch에서도 동일 폴백 + [BTDebug] warn, ④ MiniPlayer의 **낙관적 setIsPlaying 제거**(성공 후 상태 콜백 반영 — 선(先)토글 잔존 시 FAIL), ⑤ `grep -n "applyPlaybackAudioMode" services/audioMode.ts` export 기존재 확인(audioMode.ts 자체는 diff 0).
- Then: 2곳 × ①~④ 전부 충족. "폴백은 넣었는데 한쪽 화면만" 발견 시 FAIL.

**U-6. status.error 분기 신설 2곳 [unit]**
- Given: 변경 전 상태 콜백이 `if (status.isLoaded)` 단독 분기(PlayerScreen.tsx:377, playback.ts:102) — `{isLoaded:false, error}` 무음 무시(grep 실측 처리 0건, PLAN H2).
- When: 두 콜백 각각 `else if (!status.isLoaded && status.error)` 분기 존재 — `console.warn('[BTDebug] ...')` + `setIsPlaying(false)` (자동 재로드/재재생 호출 **없음** — 복구는 재생버튼 1탭이 스펙).
- Then: 2곳 충족. 분기 안에서 playAsync/createAsync 호출 발견 시 FAIL(리컨사일 원칙 위반 — U-7과 동일 사유).

**U-7. AppState 리컨사일 — 등록/해제 쌍 + 자동 재재생 금지 [unit]**
- Given: PLAN T4 — 변경 전 App.tsx에 AppState 구독 없음(사용처는 remoteLogger.ts:276 flush뿐). 'active' 복귀 시 sound 죽음 감지 → 상태 정합만.
- When: ① `grep -n "AppState.addEventListener" App.tsx services/playback.ts` — 신규 구독 1곳, 반환 subscription의 `.remove()`가 정리 경로(useEffect cleanup 또는 대응 teardown)에 **쌍으로** 존재(해제 누락 = 리스너 누수 FAIL), ② 리컨사일 본문: store.sound 존재 && isPlaying=true && `getStatusAsync()`가 !isLoaded/error → `setIsPlaying(false)` + 참조 정리 + `[BTDebug] reconcile` warn, ③ 본문에 `playAsync`/`loadAndPlayTrack` 호출 **0건**(자동 재재생 금지 — 운전 중 돌발 재생 방지, PLAN 명시. 발견 시 즉시 FAIL), ④ remoteLogger.ts:276 기존 flush 구독 무접촉.
- Then: ①~④ 충족.

**U-8. [BTDebug] warn 레벨 + 민감정보 0건 [unit]**
- Given: remoteLogger는 **warn/error만 프로덕션 후킹**(remoteLogger.ts:218-219), info/log는 DEV 전용(:220-222) — [BTDebug]를 console.info/log로 찍으면 출시 빌드에서 서버에 안 감(H1 확진 불가 = 이번 계측의 존재 이유 소멸).
- When: ① `grep -rn "BTDebug" services/ screens/ components/ App.tsx` — 전 출력이 `console.warn`(또는 console.error)인지 전수 확인, `console.info('[BTDebug'`·`console.log('[BTDebug'` **0건**, ② 계측 포인트 커버리지: didJustFinish 진입(`{trackId, nextIdx, appState, preloadHit}`)·프리로드 시작/성공/실패·전환 createAsync 실패·재생버튼 폴백 발동(화면 구분)·status.error 분기·autoContinueWithRelated 실패·AppState 리컨사일 — PLAN T5 목록 전부 존재, ③ 로그 페이로드에 토큰·이메일·사용자명·전체 URI(presigned 쿼리 포함) **0건** — trackId·인덱스·appState·불리언·에러 코드/메시지 요약만 허용.
- Then: ①~③ 충족. ①이 하나라도 info/log면 FAIL.

**U-9. 경계 케이스 정적 검증 [unit]**
- Given: 프리로드·핀 구조가 새로 생기며 흔들리는 4개 경계.
- When/Then:
  - ⓐ **마지막 곡(다음 곡 없음)**: getNextIndex() < 0(반복 off 큐 소진)이면 프리로드 **미시도**(nextPreload 생성 0) — didJustFinish는 기존 autoContinueWithRelated 경로 그대로(related 프리페치는 PLAN상 보류 — 신설 발견 시 범위 초과 기록). 핀 없는 상태에서 consumePreloaded가 안전하게 null 반환.
  - ⓑ **큐 1곡 + repeat one**: pinnedIdx = 현재 인덱스(자기 자신) — 같은 uri로 sound 2개(현재+프리로드) 공존 구간이 생기는 구조인지 확인, 스왑 시 이전 sound unload가 ⓐ보다 특히 중요(동일 곡 이중 발성 위험). repeat one이 프리로드 대상에서 제외되는 설계라면 그 분기 존재로 대체 판정(어느 쪽이든 명시적 처리 필요 — 무처리 FAIL).
  - ⓒ **프리로드 중 수동 곡 변경**: 수동 스킵/곡 클릭(playTrackNow)/큐 편집/셔플·반복 토글 각 경로에서 U-3 ②의 폐기가 실제 배선돼 있고, 폐기 후 도착하는 **늦은 createAsync resolve**(프리로드 비동기 완료)가 stale gen 검사로 버려지는지(loadGen 비교 후 unload) — 검사 없으면 늦게 도착한 sound가 영구 고아.
  - ⓓ **프리로드 실패 시 네트워크 폴백**: preloadNext의 catch가 nextPreload를 오염 없이 비우고([BTDebug] warn만), didJustFinish는 consumePreloaded null → 기존 createAsync 경로로 **기능 저하 없이** 진행(프리로드 실패가 전환 자체를 막으면 FAIL — 프리로드는 최적화이지 의존성이 아님).

**U-10. diff 범위 격리 [unit]**
- Given: 전문 헤더의 변경 허용 4파일.
- When: `git status --short` + `git diff --stat`(2_housing 스코프).
- Then: 허용 목록 외 diff 0. 특히 `app.json`(T6 확인만)·`services/audioMode.ts`·`services/remoteLogger.ts`·`stores/playerStore.ts`·`stores/`·백엔드 디렉토리 diff 0. 바이너리·에셋 콘텐츠 diff 0(기왕 잔존 모드 변경 100644→100755는 v3.196 관행 계승 제외). 커밋 시 스코프 파일만 명시 스테이징.

**U-11. v3.191~196 무회귀 라인 검사 [unit]**
- Given: PlayerScreen·playback.ts는 이번에 diff가 필연(v3.196의 "diff 0 가드"는 이번 버전부터 불가) → **라인 단위 무침투 검사로 전환**. 라인 번호는 변경 전 실측(지시서 참조 라인 중 인셋 :797·duration :356-390은 구버전 기준 — 아래 실측 라인으로 재확정).
- When/Then:
  - ① v3.192 duration 보정 **무침투**: PlayerScreen 보정 블록(:383-399 — effectiveDuration Math.max 3인자·durationWarnedRef) 및 playback.ts 보정 블록(:106-122 — apiDurationMs·engineDurationMs·durationWarnedTrackId) 라인 diff 0. 단 U-2 ②·U-4 ②가 이 값을 **읽는 것**은 허용 — 수정만 금지.
  - ② v3.191 인셋 무침투: PlayerScreen 컨테이너 인셋(:848)·queueSheet 인셋(:1351 `insets.bottom + spacing.xxl`) diff 0.
  - ③ v3.196 미니바 MCI 아이콘 무침투: PlayerScreen :1123-1126(MCI play/pause size 16 주석 포함)·MiniPlayer MCI(:3 import·:98 size 20) diff 0 — MiniPlayer는 togglePlay(:22-31)만 접촉 허용.
  - ④ v3.192 record-play 무회귀: recordPlayIfNeeded(:361-374, 70%·곡당 1회) diff 0 + **프리로드 스왑 곡에서도 recordedTrackRef가 새 trackId로 정상 동작하는 구조**(스왑 경로가 기존 전환과 동일하게 store.track을 갱신하는지 — 이중/누락 기록 경계).
  - ⑤ v3.193~194: `git diff -- stores/likesStore.ts components/PlaylistPickerSheet.tsx components/SocialLoginButtons.tsx components/AuthPanel.tsx screens/SplashScreen.tsx` 0건.
  - ⑥ v3.196 시트/KAV 무침투: PlayerScreen 상세패널 KAV(:1096 인근)·v3.196 접촉 8파일(TrackActionSheet 등) diff 0.
  - 위반 시 해당 버전 TESTPLAN 항목 재실행으로 승격.

### [api] 실측 검증

**API-1. [BTDebug] 원격 로그 파이프라인 — 출시 후 이관 [api]**
- Given: remoteLogger 전송 조건 — 로그인 필수(remoteLogger.ts:153), 백그라운드 진입 flush(:276-281)+5초 인터벌, 큐 cap 200. 계측의 최종 목적 = 사용자 주행 로그로 H1 확진.
- When: **이번 사이클 실측 없음(설계상 이관)** — 출시 후 오케스트레이터가 서버 `/api/_logs/frontend`에서 `[BTDebug]` 검색(백엔드 로그 조회 권한 소관, tester는 호출 금지). 프론트 측 사전 조건은 U-8이 정적으로 대체.
- Then: 이관 항목으로 기록. tester가 이번 사이클에 로그 API를 직접 호출하면 스코프 위반(쓰기 계열 접근 금지 관행).

### [e2e] 핵심 여정 (정적 대체 병기 · 실기기 전용 구분)

**E-1. 일반 자동 전환 — 포그라운드 [e2e] (웹/에뮬 실측 가능성 있음)**
- Given: 큐 2곡+, 앱 포그라운드. 순차/shuffle/repeat all·one 각 모드.
- When: 곡 말미 20초 구간 통과 → 곡 종료.
- Then: 프리로드 히트 시에도 ① 다음 곡이 끊김 없이 전환(shuffle은 **프리로드된 바로 그 곡**으로 — 핀 검증), ② 재생바 0부터 시작·총시간 = 새 곡 duration(이전 곡 duration 잔상 없음 — U-4 ② 연동), ③ 70% record-play 곡당 1회 유지(이중 기록 없음). **웹 실측 검토**: 웹은 getAudioUri가 presigned 비동기 경로(PlayerScreen 변경 전 :479-491)라 프리로드 분기가 네이티브와 다를 수 있음 — 웹에서 프리로드가 동작하면 전환·재생바·record-play 3점 실측, 네이티브 한정 플래그면 "웹 = 기존 경로 무회귀"만 확인. 정적 대체: U-2+U-4+U-11 ④.
- 정적 대체: U-2·U-4·U-9 ⓑ.

**E-2. 수동 개입 직후 곡 종료 — 핀 폐기 [e2e] (웹/에뮬 실측 가능성 있음)**
- Given: 곡 말미 20초 이내(프리로드 생성 이후), 큐 3곡+.
- When: ① 수동 스킵, ② 큐에서 다음 곡 제거/순서 변경, ③ 셔플 토글 — 각각 수행 후 곡 종료까지 재생.
- Then: 폐기된 핀이 아닌 **현시점 올바른 다음 곡**으로 전환(잘못된 곡 재생 = FAIL), 이중 발성(고아 사운드) 없음, 이후 미니 닫기→재클릭 기존 복구 경로 정상. 웹 실측 가능 시 ①~③ 각 1회.
- 정적 대체: U-3+U-9 ⓒ.

**E-3. 화면꺼짐 연속재생 [e2e] — 실기기 전용(에뮬 재현 불가)**
- Given: Android APK 실기기(iOS 병행 권장), 로그인 상태(BTDebug 전송 전제), 큐 3곡+.
- When: 재생 시작 → 화면 끄고(잠금) 방치, 곡 종료 3회 이상 통과.
- Then: 매 전환 자동재생 성공(핵심 시나리오 — v3.197의 존재 이유). 실패 시에도 앱 복귀 후 서버에 [BTDebug] didJustFinish/프리로드 로그 도달 확인(API-1 연동).
- 정적 대체(한계 명시): U-2~U-4는 배선만 보장 — cached-app freezer/Doze 거동은 정적 검증 불가, **본 항목은 대체 불가·실측 필수**로 이관.

**E-4. BT/차량 + 화면꺼짐 [e2e] — 실기기 전용(BT 하드웨어 필수)**
- Given: BT 스피커 또는 차량 헤드유닛 연결, E-3과 동일 조건.
- When: E-3 시나리오 반복 + ② 재생 중 BT 연결 해제(이어폰/차량 끊기) ③ 전화 수신 인터럽션 → 통화 종료.
- Then: ① 화면꺼짐+BT 연속 전환 성공, ②③ 일시정지 후 **재생버튼 1탭** 복구(미니 닫기 불요). 실패 케이스는 [BTDebug] 서버 로그로 원인 채증.
- 정적 대체: U-5+U-6+U-7(복구 배선만) — BT 라우팅 자체는 대체 불가, 실측 이관.

**E-5. 전환 실패 유도 → 재생버튼 1탭 복구 [e2e] — 실기기 전용(비행기모드)**
- Given: 실기기, 곡 말미 재생 중.
- When: 곡 종료 직전 비행기모드 ON → 전환 실패 유도 → 비행기모드 OFF → 재생버튼 1탭. 미니플레이어·풀 플레이어 **각각** 수행.
- Then: 두 화면 모두 미니 닫기 없이 현재 곡 재로드·재생(처음부터 재생 허용 — position 복원은 1차 스펙 아님). 무반응(변경 전 증상) = FAIL. status.error/[BTDebug] 폴백 로그 발생 확인. 프리로드가 이미 성공해 있던 경우 비행기모드에서도 전환 자체가 성공할 수 있음 — 그 경우 프리로드 미생성 시점(곡 초반 스킵 직후)으로 재시도해 실패를 유도.
- 정적 대체: U-5+U-6+U-9 ⓓ.

**E-6. 공격적 절전 기기 + 계측 도달 [e2e] — 실기기 전용**
- Given: 배터리 최적화(절전) 켠 삼성/샤오미류, 로그인 상태.
- When: 화면 꺼짐 연속재생 시도(성공 여부 무관).
- Then: 실패하더라도 앱 복귀 시 [BTDebug] 로그가 서버 도달(H1 확진 데이터 확보가 본 항목의 목적 — PLAN 5장 "한계 잔존" 인정 범위, 전환 실패 자체는 이 기기군에서 FAIL 아님·기록만). 필요 시 "앱 배터리 최적화 제외" 안내 문구 검토를 잔여로 기록.
- 정적 대체: U-8(레벨·커버리지)+API-1(이관).

### 태그 집계
- [unit] 11건 (U-1 tsc / U-2 프리로드 구조 / U-3 해제·누수 경계 / U-4 2계통 스왑 배선 / U-5 재생버튼 2곳 / U-6 error 분기 2곳 / U-7 AppState 쌍+재재생 금지 / U-8 BTDebug warn·민감정보 / U-9 경계 4케이스 / U-10 diff 격리 / U-11 v3.191~196 무회귀)
- [api] 1건 (API-1 — 이번 사이클 실측 0회, 출시 후 서버 로그 조회로 이관·오케스트레이터 소관)
- [e2e] 6건 (E-1·E-2 웹/에뮬 실측 가능성 검토 병기 / E-3~E-6 **실기기 전용** — E-3은 정적 대체 불가 명시, 전 항목 정적 대체 또는 이관 사유 병기)

### 설계 주의점 (tester·app-dev 참고)
1. **shuffle 핀이 이번 버전의 1급 불변식**: getNextIndex()는 호출마다 랜덤(playerStore.ts:178-183) — 프리로드 시점 핀(pinnedIdx) 후 didJustFinish에서 **재호출하면 프리로드 곡과 실제 전환 곡이 갈라진다**. U-2 ⑤가 grep으로 재호출 0건을 못 박는 이유. 수동 개입 시엔 핀 폐기가 유일한 정답(핀 재계산 아님).
2. **자동 재재생 금지는 안전 요구사항**: U-6·U-7의 "분기 안 playAsync 0건"은 코드 취향이 아니라 **운전 중 돌발 재생 방지**(PLAN T4 명시). 리컨사일·error 분기에서 재생을 살리려는 선의의 diff가 들어오면 즉시 FAIL로 처리할 것.
3. **프리로드는 최적화이지 의존성이 아님**: U-9 ⓓ — consumePreloaded null → 기존 createAsync 폴백이 항상 살아 있어야 한다. 프리로드 실패가 전환을 막는 구조(예: preload 완료를 await하고 didJustFinish 진행)가 최악의 회귀.
4. **unload 대차대조표로 누수 판정**: 사운드 소유권이 3곳 분산(playback.ts/PlayerScreen soundRef/store — PLAN 5장)인 상태에 프리로드 슬롯이 4번째로 추가된다. U-3 ④처럼 unloadAsync 증가분을 경로별로 1:1 대응시켜 "폐기인데 unload 없음"을 찾는 방식이 grep으로 가능한 유일한 누수 검사. 특히 U-9 ⓒ의 늦은 resolve(stale gen) 고아가 가장 놓치기 쉽다.
5. **[BTDebug]는 console.warn이 아니면 무의미**: remoteLogger 프로덕션 후킹이 warn/error 한정(remoteLogger.ts:218-222)이고 이번 계측의 목적이 출시 후 H1 확진이므로, info로 찍힌 [BTDebug] 1건은 "사소한 레벨 실수"가 아니라 **계측 전체의 목적 상실** — U-8 ①을 전수 grep으로. 로그인 필수(:153) 전제도 실기기 시나리오(E-3~E-6) Given에 반드시 포함.
6. **PlayerScreen "diff 0 시대" 종료 — 라인 번호 재실측 필수**: v3.196까지는 PlayerScreen diff 0 가드가 가능했으나 이번엔 onPlaybackStatusUpdate·didJustFinish·togglePlayPause가 정면 수정 대상. 지시서의 참조 라인 일부(인셋 :797, duration :356-390)는 구버전 기준으로 실측과 어긋남 — U-11의 실측 라인(:383-399·:848·:1351·:1123-1126·:361-374, playback.ts :106-122)을 기준으로 하되, 적용 후 라인 이동이 크므로 tester는 **앵커 문자열**(effectiveDuration·queueSheet·MaterialCommunityIcons 등)으로 재탐색 후 무침투를 판정할 것.
7. **duration 보정은 "읽기 허용·수정 금지"**: 프리로드 트리거(U-2 ②)와 스왑 콜백(U-4 ②)이 effectiveDuration을 **참조**하는 것은 스펙이고, 보정 블록 자체를 고치는 것은 v3.192 회귀다. U-11 ①에서 이 둘을 혼동해 정당한 참조 추가를 FAIL로 찍지 말 것.
8. **record-play 이중 기록 경계**: 프리로드 스왑은 "콜백 부착 시점"이 기존 경로와 달라진다 — recordedTrackRef 리셋·store.track 갱신 순서가 어긋나면 70% 기록이 이전 곡 tid로 남거나 이중 기록된다(U-11 ④). E-1 ③에서 웹 실측 가능하면 곡당 1회를 실제로 세어볼 것.
9. **repeat one은 명시적 설계 확인 대상**: 큐 1곡 반복(U-9 ⓑ)은 "같은 곡 sound 2개 공존"이라는 프리로드의 특수 케이스 — 지원이든 제외든 코드에 명시적 분기가 있어야 하며, 무처리(우연히 동작)면 이중 발성 시한폭탄으로 FAIL.

### 실행 결과 — 2026-09-21 (tester)

> 실행 환경: 에뮬레이터/adb/maestro 부재(관행 계승) → [e2e]는 정적 대체 + 실기기 이관. 워킹트리 실측: 콘텐츠 diff는 허용 4파일뿐 — App.tsx(+4)·MiniPlayer.tsx(+32/-9)·PlayerScreen.tsx(+147/-57)·playback.ts(+239/-35). 그 외 M 표시 75건은 전부 100644→100755 모드 변경(콘텐츠 diff 0 — v3.196 관행 계승 제외). `app.json`·`services/audioMode.ts`·`utils/remoteLogger.ts`(계획서의 services/ 표기는 실경로 utils/)·`stores/playerStore.ts` diff 0.

| 항목 | 판정 | 근거 요약 |
|------|------|-----------|
| U-1 타입 무결성 | PASS | `npx tsc --noEmit` exit 0, 오류 0건 |
| U-2 프리로드 모듈 구조 | PASS | ① export maybePreloadNext/consumePreloaded/discardPreloaded + NextPreload 슬롯(playback.ts:44-58) ② 트리거 `remaining ≤ 20000 ∥ ratio ≥ 0.85`(:77-78), 호출 양쪽 모두 effectiveDuration 전달(playback.ts:225, PlayerScreen:413) ③ 곡당 1회 가드 forTrackId(:80)+preloadInFlight(:79) ④ `{shouldPlay:false}`(:94), shouldPlay:true 0건 ⑤ 핀 1회 호출(:82), didJustFinish 소비 경로 getNextIndex 재호출 0건(재호출은 프리로드 미스 폴백 분기에만 존재 — 스펙 적합). 양쪽 상태 콜백 배선 확인 |
| U-3 프리로드 해제·폐기 | PASS(기록 2) | ① 스왑 성공 시 슬롯 null 리셋(consumePreloaded 진입 즉시 :119) + 이전 sound unload(playback.ts:271-273, PlayerScreen:440) ② 수동 스킵(switchToTrack:826·loadAndPlayTrack:284)·미니 닫기(invalidatePlayback:22)·재핀(:85)에 discardPreloaded 직접 배선. 큐 편집·셔플/반복 토글은 **핀 스냅샷(fromIndex/shuffle/repeat/트랙 id) 소비 시점 무효화+unload**(:122-131)로 대체 — 슬롯 상한 1개라 누적 불가, "폐기인데 unload 누락" 0건 기준 충족 ③ 매치 실패 시 unload 후 null(:129) ④ unloadAsync 2→8: 증가 6건 = discard·stale-resolve(:98)·consume-invalid·스왑gen불일치(:265)·스왑성공old(:272)·스왑실패(:276) 1:1 대응. **기록①**: resetOnLogout(playerStore — 수정금지 파일) 경로는 프리로드 미폐기 — 로그아웃 시 최대 1개 사운드가 다음 로드/닫기까지 잔존(상한 1, 차기 authService 측 invalidatePlayback 호출 검토). **기록②**: preload 실패 시 다음 상태 콜백 주기에 재시도됨(곡당 1회 가드는 성공 슬롯 기준) — 오프라인에서 말미 20초간 [BTDebug] preload fail 반복 warn 가능(큐 cap 200 내, 차기 실패 백오프 검토) |
| U-4 2계통 스왑 배선 | PASS | ① 두 계통 모두 didJustFinish 최초 분기에서 consumePreloaded 우선(playback.ts:228, PlayerScreen:421), null → 기존 loadAndPlayTrack/advanceViaNetwork 폴백 ② 스왑 sound에 즉시 콜백 부착+playAsync — playback.ts는 makeStatusCallback(v3.192 보정 내장 :209-223), PlayerScreen은 onPlaybackStatusUpdate 재부착(:428, liveTrack 기반 보정 경로 동일) ③ PlayerScreen 폴백 catch 참조 정리 3점+warn(advanceViaNetwork:528-534), playback.ts catch(:308-312), unload 직전 setSound(null)(:288) ④ 주입 로더 catch 정리(:484-491). 2계통 편배선 없음 |
| U-5 재생버튼 2곳 폴백 | PASS | PlayerScreen togglePlayPause(:797-818)·MiniPlayer togglePlay(:29-54) 각각 ① try/catch ② getStatusAsync isLoaded 확인→미로드/null이면 loadAndPlay/loadAndPlayTrack(내부 applyPlaybackAudioMode 재호출) ③ catch에서도 동일 폴백+[BTDebug] warn(src 구분) ④ MiniPlayer 낙관적 setIsPlaying 제거 확인(destructure에서도 sound/setIsPlaying 제거) ⑤ applyPlaybackAudioMode export 기존재(audioMode.ts:10, diff 0) |
| U-6 status.error 분기 2곳 | PASS | playback.ts makeStatusCallback else-if(:245-250)·PlayerScreen(:496-502) — warn+setIsPlaying(false)만. 분기 내 playAsync/createAsync 0건(자동 재재생 금지 준수) |
| **U-7 AppState 리컨사일** | **FAIL(①)** / ②③④ PASS | ① **구독 해제 쌍 부재**: playback.ts:336 addEventListener 반환 subscription 미보관·`.remove()` 0건(App.tsx:483 remove는 별개 기존 리스너). reconcilerInited 가드로 프로덕션 실누수는 1개 상한이나 계획 기준 "해제 누락 = FAIL" 해당(dev fast-refresh 시 모듈 재로드마다 잔존 리스너 누적) — 수정 지시 아래 ② 본문: sound&&isPlaying→getStatusAsync !isLoaded→setIsPlaying(false)+setSound(null)+reconcile warn(:341-347), catch도 동일 정리(:353-358) ③ 본문 playAsync/loadAndPlayTrack 0건 ④ remoteLogger flush 구독(utils/remoteLogger.ts:276) 무접촉 |
| U-8 BTDebug warn·민감정보 | PASS(기록 1) | ① 전수 grep 30건 중 출력 28건 전부 console.warn(주석 2건 제외), info/log 0건 ② 커버리지: didJustFinish 2계통({trackId,nextIdx,appState,preloadHit})·preload start/ready/fail/stale/invalid·swap ok/fail·transition/load/switchToTrack fail·play button recover(src Player/Mini)·toggle fail·sound error 2계통·related fail/related load fail·reconcile 3종 — PLAN T5 전부 존재 ③ 페이로드 필드 trackId/인덱스/appState/불리언/err.message 요약만 — 토큰·이메일·사용자명·stream-proxy/presigned URI 0건. **기록**: err?.message 원문 pass-through라 웹 presigned 실패 메시지에 URL이 실릴 이론적 여지(네이티브 proxy URL은 무쿼리라 민감도 낮음) — 차기 message 절단/화이트리스트 검토 |
| U-9 경계 4케이스 | PASS | ⓐ pinnedIdx<0→next null→미시도(:83-84), related 프리페치 신설 없음(보류 명시 주석), 슬롯 비었을 때 consume null 안전(:118) ⓑ repeat one: getNextIndex=currentIndex 핀 → 동일 uri 2 sound 공존 구조 — 스냅샷에 repeat 포함+양 스왑 경로 old unload 확인으로 명시적 처리 인정(전용 분기는 없으나 forTrackId 가드·스냅샷 검증·unload가 이중 발성 구조 차단) ⓒ 수동 변경: 스킵/playTrackNow/미니 닫기는 즉시 폐기+loadGen 증가, 늦은 resolve는 gen 검사 후 unload(:96-100), 큐 편집·토글은 소비 시점 스냅샷 거부+unload — 영구 고아 0 ⓓ preloadNext catch는 warn만·슬롯 오염 없음(:104-105), consume null→기존 createAsync 경로 무저하(프리로드 await 의존 0건) |
| U-10 diff 범위 격리 | PASS | 콘텐츠 diff = 허용 4파일뿐(위 전제 참조). app.json·audioMode·remoteLogger·playerStore·stores/·백엔드 diff 0. 바이너리 콘텐츠 diff 0(모드 변경만). 커밋 시 4파일 명시 스테이징 |
| U-11 v3.191~196 무회귀 | PASS | 앵커 재탐색 기준(라인 이동 반영): ① v3.192 보정 블록 무침투 — PlayerScreen :385-407(durationWarnedRef·Math.max 3인자)·playback.ts makeStatusCallback 내 보정(:209-223, 팩토리 승격으로 이동만·로직 동일) diff는 참조 추가(maybePreloadNext 인자)뿐 ② 인셋: queueSheet `insets.bottom + spacing.xxl`(:1441) 무접촉(diff hunk 최종 :844 이전 종료) ③ MCI: PlayerScreen :1216 size 16·MiniPlayer :121 size 20 무접촉(MiniPlayer diff는 togglePlay+렌더 조건 한정) ④ recordPlayIfNeeded(:365-376) diff 0 + 스왑 경로 playTrackAtIndex→store.track 갱신 후 콜백 부착이라 recordedTrackRef 새 tid 정상(이중/누락 구조 없음) ⑤ likesStore·PlaylistPickerSheet·SocialLoginButtons·AuthPanel·SplashScreen diff 0 ⑥ KAV(:1186)·TrackActionSheet 등 v3.196 8파일 diff 0 |
| API-1 BTDebug 파이프라인 | N/A(이관) | 설계상 출시 후 오케스트레이터 소관(서버 `/api/_logs/frontend` 검색). tester 호출 0회(스코프 준수). 사전 조건은 U-8로 정적 대체 — remoteLogger warn/error 프로덕션 후킹(:218-219)·로그인 전제(:153) 확인 |
| E-1 일반 자동 전환 | PASS(정적 대체) | 웹 실측 가능성 검토 결과: maybePreloadNext 첫 줄 `Platform.OS==='web'` return(:75) → 웹에서 슬롯이 채워질 수 없어 consumePreloaded 항상 null = 기존 네트워크 경로와 로직 등가(+warn 1줄) — "기존 경로 무회귀"는 정적으로 판정 완료, 프리로드 히트 실측은 웹에서 불가능하므로 실기기 이관. 정적 근거: U-2+U-4+U-9ⓑ+U-11④ |
| E-2 수동 개입 직후 종료 | PASS(정적 대체) | 동일 사유(웹 프리로드 비활성 → 핀 폐기 시나리오 자체가 네이티브 전용). 정적 근거: U-3+U-9ⓒ — 스킵 즉시 폐기·큐편집/토글 스냅샷 거부·늦은 resolve gen 폐기 전 경로 배선 확인. 실기기 ①②③ 이관 |
| E-3 화면꺼짐 연속재생 | 이관(실기기 전용) | 정적 대체 불가 명시 항목 — cached-app freezer/Doze 거동은 실기기에서만. U-2~U-4 배선만 보장 |
| E-4 BT/차량+화면꺼짐 | 이관(실기기 전용) | BT 하드웨어 필수. 복구 배선은 U-5+U-6+U-7(②③)로 정적 확인 |
| E-5 비행기모드 복구 | 이관(실기기 전용) | U-5+U-6+U-9ⓓ로 배선 확인. 무반응 재현 여부는 실측 필수 |
| E-6 공격적 절전+계측 도달 | 이관(실기기 전용) | U-8+API-1(이관). 로그인 전제 Given 유지 |

**FAIL 상세 및 수정 지시 (U-7 ①)**: `services/playback.ts` initPlaybackReconciler가 `AppState.addEventListener` 반환 subscription을 버림 — 해제 경로 0. 수정: 모듈 스코프 `let reconcilerSub: { remove(): void } | null = null;`로 보관, `if (reconcilerSub) return;`을 가드로 사용(reconcilerInited 불리언 대체), `export function teardownPlaybackReconciler(){ reconcilerSub?.remove(); reconcilerSub = null; }` 추가 후 App.tsx `useEffect(() => { initPlaybackReconciler(); return () => teardownPlaybackReconciler(); }, []);`로 쌍 완성. 접촉 파일은 허용 목록 내(playback.ts·App.tsx) — U-7 ①만 재검하면 게이트 해제(타 항목 재검 불요).

**편차 판정 2건**:
① MiniPlayer 렌더 조건 `!sound` 제거 — **수용**. v3.197 설계(전환 실패 시 setSound(null) 정리)와 `!sound` 숨김은 양립 불가: 유지하면 실패 순간 미니플레이어가 사라져 "재생버튼 1탭 복구" 스펙 자체가 소멸. 부수효과(로그인 큐 복원 시 일시정지 미니 노출)는 restoreQueueFor가 `isPlaying:false`로 세팅해 자동 재생 0 — 안전 요구사항(자동 재재생 금지) 위반 없음, 재생은 사용자 탭에서만 발생(togglePlay→loadAndPlayTrack).
② 리컨사일 "로드됐지만 시스템 정지" UI 정합화 분기 — **수용**. 본문은 `setIsPlaying(false)` 1줄뿐, playAsync/재로드 0건으로 자동 재재생 금지 준수. 재생 아이콘·무음 불일치를 해소하는 순수 정합화로 T4 취지에 부합.

**집계**: PASS 15 / FAIL 1(U-7 ① — 국소 수정 후 재검 1건으로 해제) / N/A·이관 5(API-1, E-3~E-6). **게이트: 조건부 FAIL(머지 보류)** — U-7 ① 구독 해제 쌍 배선 후 U-7 단건 재검으로 PASS 전환 가능(그 외 안전 요구사항·핀 불변식·누수 대차대조표 전부 충족).

**실기기 잔여(이관)**: ① E-3 화면꺼짐 연속재생 3회+(Android APK 로그인 상태 — v3.197 존재 이유, 최우선) ② E-4 **차량 테스트**: 차량 헤드유닛/BT 스피커 연결 후 화면꺼짐 연속 전환 + 주행 중 BT 끊김·전화 인터럽션 후 "재생버튼 1탭" 복구 확인(운전자 외 동승자가 조작할 것 — 자동 재재생 금지가 지켜지는지, 즉 통화 종료·복귀 시 **저절로 소리가 나지 않는지**를 특히 관찰) ③ E-5 비행기모드 전환 실패 유도→미니/풀 각각 1탭 복구(프리로드 선성공 시 곡 초반 스킵 직후로 재시도) ④ E-6 절전 기기(삼성/샤오미)에서 [BTDebug] 서버 도달 확인(실패해도 기록만) ⑤ E-1/E-2 프리로드 히트 실측(셔플 핀 곡 일치·재생바 리셋·record-play 곡당 1회) ⑥ API-1 출시 후 서버 로그 [BTDebug] 검색(오케스트레이터 소관).

## v3.198 — 수정일 2026-09-21

> 대상: PLAN.md v3.198 — (A) `stores/playerStore.ts` 비영속 `sessionActive` 플래그(setSound truthy에서 true, resetOnLogout·restoreQueueFor에서 false) + `components/MiniPlayer.tsx` 렌더 조건 `if (!track || (!hasSound && !sessionActive)) return null;`(불리언 셀렉터) — 로그인 복원 큐 미니 숨김과 v3.197 "재생버튼 1탭 복구" 양립. (B) `components/PlaylistPickerSheet.tsx` KAV behavior iOS 전용 복귀 + Android `keyboardDidShow/Hide` 수동 패딩(`max(0, kbHeight - insets.bottom)`, hide 시 0 강제 리셋, 리스너 등록/해제 쌍). (C) 백엔드(EC2 backend_9004) `GET /invite/{code}` HTML 랜딩 + `/static` StaticFiles 마운트 + OG 태그(og:image 1200×630 절대 URL) + Play 스토어 CTA + 무효 코드 404 HTML. (D) 인스타/페북 버튼 — **코드 무변경, 답변만**(AppShareModal.tsx:66-74 세 버튼 모두 RN Share.share 네이티브 시트 — 검증 대상은 "diff 0"뿐).
> 실행 환경 관행(v3.191~197 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 정적 대체 병기 + 실기기 실측 이관. 앱 코드 경로 `/Users/pearl/TripleJ/2_housing`, 라인 번호는 **변경 전** PLAN 실측 기준(적용 후 이동 허용 — 앵커 문자열로 재탐색). 백엔드 [api]는 **배포 후 오케스트레이터가 curl로 실행**(tester는 EC2/배포 접근 금지 관행 — 본 문서는 명령·판정 기준만 제공).
> 변경 허용 파일(격리 기준): 앱 = `stores/playerStore.ts`, `components/MiniPlayer.tsx`, `components/PlaylistPickerSheet.tsx`, `app.json`(버전 v3.198) 4개. 백엔드(EC2 소스, 로컬 워킹트리 diff 아님) = `app/main.py`, `app/routes/referral.py`, `app/static/og/*.png`(신규). **`components/AppShareModal.tsx`·`services/playback.ts`·`screens/PlayerScreen.tsx`·`App.tsx`·Report/Appeal/AlbumCreate/DmChat 4개 KAV 모달은 diff 0 필수.** 그 외 diff는 FAIL.

### [unit] 정적 검증 (머지 게이트)

**U-1. 타입 무결성 [unit]**
- Given: v3.198 앱 변경(A·B)이 적용된 워킹트리.
- When: `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: exit 0, 오류 0건. (sessionActive 상태 타입, Keyboard 리스너/EmitterSubscription 타입, kbPad state 타입이 전부 통과.)

**U-2. sessionActive 플래그 배선 3점 + 비영속 보장 [unit]**
- Given: PLAN §1 — 재생 시작점이 3곳+(playback.ts:268·306, PlayerScreen.tsx:431·476·520·578)에 분산 → 호출부가 아닌 **스토어 setter 한 곳**에서 걸어야 누락이 없다.
- When: `grep -n "sessionActive" stores/playerStore.ts components/MiniPlayer.tsx` 후 3점 확인 —
  - ① **set true**: `setSound`(변경 전 :82)가 `sound ? { sound, sessionActive: true } : { sound }` 형태 — **truthy일 때만** true(setSound(null) 정리 경로에서 true로 바뀌거나 false로 리셋되면 FAIL — 전자는 복원 큐 숨김 실패, 후자는 v3.197 복구 경로 소멸). setSound **호출부**(playback.ts/PlayerScreen)에 sessionActive 직접 set이 있으면 FAIL(단일 지점 원칙 위반).
  - ② **set false**: `resetOnLogout`(:126-130)과 `restoreQueueFor`(:145-151)의 set 객체에 `sessionActive: false` 포함. restoreQueueFor는 **저장 큐가 없어 early-return하는 분기에서도** 리셋되는지 확인(계정 전환 시 이전 세션 플래그 잔존 방지 — resetOnLogout이 선행 커버하면 그 배선 확인으로 대체 판정). cleanup(:205)의 리셋은 선택(track null로 어차피 숨음 — 있으면 무해, 없어도 PASS).
  - ③ **비영속**: partialize(변경 전 :217-222)가 화이트리스트 방식임을 확인하고 `sessionActive`가 목록에 **없는지**(영속되면 재기동 시 true 복원 → 수정 자체가 무효화되는 최악 회귀). 초기값 false.
- Then: ①~③ 전부 충족.

**U-3. MiniPlayer 렌더 조건식 — 숨김·복구 시나리오 양립 [unit]**
- Given: 변경 전 `components/MiniPlayer.tsx:24` `if (!track) return null;`(v3.197에서 `!sound` 제거 — 복구 경로 확보의 대가로 복원 큐 미니가 노출된 것이 이번 버그).
- When: ① 조건이 `if (!track || (!hasSound && !sessionActive)) return null;` 와 논리 동치인지, ② sound 구독이 `usePlayerStore((s) => !!s.sound)` **불리언 셀렉터**인지 — sound 객체 자체 구독(`(s) => s.sound`) 발견 시 FAIL(v3.197이 제거한 리렌더 소음 재도입, MiniPlayer.tsx:15 주석 취지 위반), ③ 진리표 4행 정적 추적:
  - ⓐ track만(복원 큐: sound null, sessionActive false) → **숨김**(수정 목표)
  - ⓑ 세션 중 전환 실패(track 有, sound null, sessionActive true) → **노출 유지**(v3.197 복구 보존 — 이 행이 깨지면 즉시 FAIL)
  - ⓒ 재생 중(sound 有) → 노출(sessionActive 값 무관)
  - ⓓ cleanup 후(track null) → 숨김
  ④ v3.197 주석(:22-23) 갱신 — 복구 경로 보존 의도 명시(주석 미갱신은 기록만, FAIL 아님).
- Then: ①~③ 충족(③은 4행 전부).

**U-4. PlaylistPickerSheet Android 수동 패딩 — 리스너 쌍·0 리셋 [unit]**
- Given: 변경 전 `components/PlaylistPickerSheet.tsx:88` KAV 양플랫폼 `behavior="padding"`(v3.196) — Android Modal에서 hide 후 패딩 잔차 + 시트 자체 `paddingBottom: insets.bottom + spacing.xl`(:91)과 이중 계상.
- When: ① `Keyboard.addListener('keyboardDidShow', ...)` 핸들러가 `Math.max(0, e.endCoordinates.height - insets.bottom)` 로 kbPad set(음수 방지 max(0,·) 필수 — 없으면 인셋 큰 기기에서 음수 패딩 FAIL), ② `'keyboardDidHide'` 핸들러가 **무조건 `setKbPad(0)`**(조건부 리셋이면 잔존 간격 구조 재발 — FAIL), ③ 리스너 **등록/해제 쌍**: addListener 2건의 반환 subscription이 보관되고 cleanup(useEffect return 또는 visible false 분기)에서 `.remove()` 2건 대응 — 등록만 있고 해제 0건이면 FAIL(시트 개폐마다 리스너 누적), `visible` 의존 effect라면 visible false 전환 시에도 해제+kbPad 0 리셋 확인(닫힌 채 키보드 이벤트 수신 방지 + 다음 오픈 시 stale 패딩 방지), ④ 시트 컨테이너 패딩이 `insets.bottom + spacing.xl + kbPad` 합산형이고 Android에서 KAV 키보드 패딩과 **중복 적용되지 않는지**(behavior undefined이므로 KAV는 Android에서 무동작 — ⑤와 연동), ⑤ 리스너 등록이 `Platform.OS === 'android'` 한정(iOS에서 KAV padding과 수동 패딩이 겹치면 이중 계상 역수입 — FAIL).
- Then: ①~⑤ 전부 충족.

**U-5. iOS 분기 보존 + 타 KAV 4곳 무접촉 [unit]**
- Given: PLAN §2 — v3.196의 나머지 적용처는 전부 iOS 전용이라 이번 버그와 무관, 수정 범위는 담기 시트 1곳.
- When: ① PlaylistPickerSheet KAV `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` 복귀(KAV 컴포넌트 자체는 유지 — 제거하고 iOS까지 수동 패딩으로 바꾸면 범위 초과 FAIL), ② `git diff -- components/ReportModal.tsx components/AppealModal.tsx components/AlbumCreateModal.tsx screens/DmChatScreen.tsx` **0건**, ③ `keyboardVerticalOffset={-insets.bottom}` 류 차선책 잔재 0건(PLAN이 비권장 명시 — 발견 시 설계 불일치 기록).
- Then: ①~③ 충족.

**U-6. diff 범위 격리 [unit]**
- Given: 전문 헤더의 변경 허용 앱 4파일.
- When: `git status --short` + `git diff --stat`(2_housing 스코프).
- Then: 콘텐츠 diff가 `stores/playerStore.ts`·`components/MiniPlayer.tsx`·`components/PlaylistPickerSheet.tsx`·`app.json`(버전 v3.198 1줄) 4파일뿐. 특히 **(D) `components/AppShareModal.tsx` diff 0**(답변만이 스펙 — 문구 수정 유혹 포함 일체 불가), v3.197 접촉 4파일(`services/playback.ts`·`screens/PlayerScreen.tsx`·`App.tsx`) diff 0 — **단 App.tsx는 v3.197 FAIL 후속(U-7 teardown 쌍 배선)이 별도 커밋으로 선행됐을 수 있음: 그 diff는 v3.197 재검 소관으로 분리 판정하고 v3.198 스코프에 혼입 금지**. 모드 변경(100644→100755)은 v3.196 관행 계승 제외. 커밋 시 4파일 명시 스테이징.

**U-7. v3.191~197 무회귀 — MiniPlayer 라인 단위(v3.194/196/197 접촉 파일) [unit]**
- Given: MiniPlayer.tsx는 v3.194(이모지→MCI 벡터화)·v3.196(미니 재생 아이콘 MCI 채움형 size 20)·v3.197(togglePlay 재로드 폴백 + 렌더 조건 완화) 3개 버전이 겹겹이 접촉한 파일 — 이번 diff는 **렌더 조건 1줄 + 셀렉터/구독부**로 한정돼야 한다. playerStore.ts는 v3.197에서 diff 0이 전제였던 파일 — 이번에 처음 열리므로 침투면 최소 확인.
- When/Then (앵커 문자열 재탐색 기준):
  - ① **v3.197 togglePlay 폴백 무침투**: MiniPlayer togglePlay 내 try/catch·getStatusAsync·loadAndPlayTrack 폴백·[BTDebug] warn·낙관적 setIsPlaying 부재 — v3.197 U-5 합격 형상 그대로(diff hunk가 togglePlay 본문을 스치면 v3.197 U-5 재실행 승격).
  - ② **v3.194/196 MCI 무침투**: MiniPlayer MCI import·재생/일시정지 아이콘 size 20(채움형) 라인 diff 0.
  - ③ **playerStore 침투면**: diff가 sessionActive 신설(초기값·타입)·setSound·resetOnLogout·restoreQueueFor 4개 지점뿐인지 — getNextIndex(:178-183 셔플 랜덤, v3.197 핀 불변식의 전제)·savedQueues 구조·partialize 기존 항목·cleanup의 기존 동작 diff 0(sessionActive 추가 제외).
  - ④ **v3.197 프리로드/리컨사일 무접촉**: `git diff -- services/playback.ts screens/PlayerScreen.tsx` 0건(U-6과 교차 — App.tsx 예외 규정 동일).
  - ⑤ **v3.193 담기 흐름 전제**: PlaylistPickerSheet diff가 KAV behavior·키보드 리스너·패딩 계산부에 한정 — 플레이리스트 목록 로직·추가 API 호출부·TrackActionSheet 진입 연동 diff 0.
  - ⑥ **v3.192 duration·v3.194 소셜 로그인 스팟**: `git diff -- components/SocialLoginButtons.tsx components/AuthPanel.tsx` 0건, PlayerScreen 무접촉으로 duration 보정은 ④에 포섭.
  - 위반 시 해당 버전 TESTPLAN 항목 재실행으로 승격.

### [api] 실측 검증 — **배포 후 오케스트레이터 실행**(tester 호출 금지, 판정 기준만 본 문서 소관)

**API-1. 유효 초대 코드 랜딩 — 200 + HTML + OG 태그 [api]**
- Given: docker build→컨테이너 교체(:9006) 배포 완료, 유효 코드 1건 확보(예: 기존 실측 코드 `7VFU` — 변경 전 실측은 404 JSON이었음).
- When: `curl -sS -D - https://api.maidol.ai.kr/invite/7VFU -o /tmp/invite.html` 후 본문 검사.
- Then: ① HTTP **200** + `Content-Type: text/html`(변경 전 404 `{"detail":"Not Found"}` JSON에서 전환 확인), ② 본문에 `og:title`(MAIDOL 초대장 + 닉네임)·`og:description`(추천코드 포함)·**`og:image`(https:// 절대 URL — 상대 경로면 카톡 카드 미렌더로 FAIL)**·`og:image:width` 1200·`og:image:height` 630·`twitter:card summary_large_image` 전부 존재, ③ Play 스토어 CTA `https://play.google.com/store/apps/details?id=com.maidol.app` 존재, ④ 코드/닉네임이 HTML-escape 출력(원시 `<` 미노출 — `curl "https://api.maidol.ai.kr/invite/%3Cscript%3E"` 로 무효코드 응답에 `<script>` 원문이 반사되지 않는지 XSS 스팟), ⑤ `curl -I`(HEAD)도 200(카카오 스크래퍼 프리플라이트 — Starlette GET 라우트 자동 대응 확인).

**API-2. OG 정적 이미지 서빙 [api]**
- Given: `/static` StaticFiles 마운트 + `app/static/og/` 이미지 반입 완료.
- When: `curl -sS -o /tmp/og.png -w "%{http_code} %{content_type}\n" https://api.maidol.ai.kr/static/og/beta-event-og.png` — **주의(파일명 이원화)**: 오케스트레이터 지시는 `beta-event-og.png`, PLAN §3-1 초안은 `invite_og.png`로 상이. **1차 판정 기준은 API-1 ②에서 실제 og:image 태그가 가리키는 URL**이며, 그 URL로 재curl한다(두 파일명 다 있으면 둘 다 확인).
- Then: ① HTTP 200 + `image/png`, ② 다운로드 파일이 유효 PNG이고 규격 1200×630(`file /tmp/og.png` 또는 `sips -g pixelWidth -g pixelHeight`), ③ og:image URL과 실서빙 URL 일치(불일치 = 카톡 카드 빈 이미지 — FAIL).

**API-3. 무효 코드 처리 + 기존 API 무회귀 [api]**
- Given: 존재하지 않는 코드(예: `ZZZZ99`).
- When/Then:
  - ① `curl -sS -D - https://api.maidol.ai.kr/invite/ZZZZ99` → **404 + HTML**(JSON 아님) + 본문에 "유효하지 않은 초대코드" 안내 + **Play 스토어 CTA는 여전히 존재**(공유 링크가 죽은 경험 방지 — PLAN §3-3 ok=False 설계. CTA 없는 404면 FAIL).
  - ② 기존 JSON API 무회귀: `curl https://api.maidol.ai.kr/api/referral/invite/7VFU` → 변경 전과 동일 JSON 200(프리픽스 라우터와 신규 public_router 충돌 없음), `/api/referral/my-code` 등 기존 라우트 스팟 1건.
  - ③ `/static` 마운트가 기존 admin_static·API 경로를 가리지 않는지(`/api/...` 아무 기존 엔드포인트 1건 200 스팟).
  - ④ 카카오 OG 캐시 초기화: https://developers.kakao.com/tool/debugger/sharing 에서 `https://api.maidol.ai.kr/invite/7VFU` 재스크랩(기존 404 캐시 잔존 시 E-5 실기기 판정이 오염 — **E-5보다 반드시 선행**).

### [e2e] 핵심 여정 (정적 대체 병기 · 실기기 이관)

**E-1. 자동로그인 콜드 스타트 — 미니 미노출 [e2e] — 실기기(APK) 이관**
- Given: 자동로그인 상태(저장 토큰 유효) + 해당 계정 savedQueues에 복원 큐 존재(과거 재생 이력), 앱 완전 종료(최근 앱에서 제거).
- When: 앱 콜드 스타트 → 홈 도달.
- Then: 하단 미니플레이어 **미노출**(변경 전 증상 = 일시정지 미니 노출 = FAIL). 이후 MyMusic 등에서 큐가 살아 있는지(곡 탭 시 즉시 재생) 확인 — 복원 자체를 죽여서 숨긴 것이면 FAIL(스펙은 "숨김"이지 "복원 제거"가 아님).
- 정적 대체: U-2 ②③ + U-3 ③ⓐ (restoreQueueFor가 track 복원 + sessionActive false → 조건식 숨김).

**E-2. 재생 후 노출 → 로그아웃/닫기 후 미노출 [e2e] — 실기기 이관**
- Given: E-1 직후 상태.
- When/Then: ① 곡 재생 시작 → 미니 **노출**(setSound truthy → sessionActive true), 다른 탭 이동에도 유지 ② 미니 닫기(cleanup) → 미노출 ③ 로그아웃 → 재로그인(동일/타 계정 각 1회) → 미니 **미노출**(resetOnLogout+restoreQueueFor 이중 리셋 검증 — 타 계정에서 이전 계정 세션 플래그 잔존 시 FAIL) ④ 재생 중 앱 재시작(콜드) → 미노출(sessionActive 비영속 검증 — 노출되면 partialize 오염 FAIL).
- 정적 대체: U-2 ①②③ + U-3 ③ⓒⓓ.

**E-3. 세션 중 sound null — 미니 유지 + 1탭 복구(v3.197 회귀) [e2e] — 실기기 전용(BT/비행기모드)**
- Given: 실기기, 곡 재생 중(sessionActive true 상태).
- When: v3.197 E-5와 동일하게 곡 말미 비행기모드 ON으로 전환 실패 유도(또는 BT 끊김) → sound가 정리(null)된 상태 도달 → 비행기모드 OFF.
- Then: 미니플레이어가 **사라지지 않고 유지**(v3.198 조건식의 `sessionActive` 항이 지키는 핵심 — 사라지면 이번 수정이 v3.197을 죽인 것, 즉시 FAIL) + 재생버튼 **1탭** 재로드·재생(v3.197 복구 경로 그대로). 화면꺼짐 연속재생(v3.197 E-3) 1사이클 스팟 병행.
- 정적 대체: U-3 ③ⓑ(진리표) + U-7 ①(togglePlay 폴백 무침투). BT/비행기모드 거동 자체는 대체 불가 — 실측 필수.

**E-4. 담기 시트 키보드 개폐 3회 — 간격 0 [e2e] — 실기기(Android) 이관 + iOS 무변경 확인**
- Given: Android APK 실기기(제스처 내비게이션 기기 우선 — 잔존 간격이 제스처 바 높이였음), 재생 중 곡 1개.
- When: 담기(플레이리스트에 추가) 시트 진입 — **두 진입 경로 각각**(v3.193: TrackActionSheet 경유 + 기존 직접 진입) — "새 플레이리스트" 입력창 포커스(키보드 열림) → 닫기(뒤로가기 / 빈 곳 탭 각각) — **연속 3회 반복**.
- Then: ① 매회 닫힌 직후 시트 하단 간격 **0**(잔존 간격 1px이라도 육안 확인되면 FAIL — 변경 전 증상), ② 키보드 열림 중 입력창 가림 없음(v3.196 회귀 — 수동 패딩이 KAV를 대체하고도 가림 재발하면 FAIL), ③ 제스처 바와 시트 버튼 겹침 없음(v3.191/196 회귀), ④ 3회 반복 후에도 열고 닫는 반응 지연 없음(리스너 누적 간접 징후), ⑤ iOS 실기기(또는 시뮬레이터) 동일 시나리오 — v3.196 KAV 동작 그대로(변화 감지 시 U-5 위반). Report/Appeal/AlbumCreate 모달 키보드 스팟 각 1회.
- 정적 대체: U-4 ①~⑤ + U-5. Android Modal 키보드 프레임 타이밍은 정적 검증 불가 — 간격 0 최종 판정은 실측 필수.

**E-5. 초대 링크 실기기 여정 — 카톡 카드·스토어 이동·코드 복사 [e2e] — 실기기 이관(API-3 ④ 캐시 초기화 선행 필수)**
- Given: 배포 + API-1~3 PASS + 카카오 스크랩 캐시 초기화 완료.
- When/Then: ① 앱 공유 모달 → 카카오톡 공유 → 수신 채팅방에서 링크가 **이미지 카드**(1200×630 이미지 + 제목/설명)로 렌더(텍스트 단독 링크면 FAIL — 캐시 초기화 재확인 후 재판정) ② 카드 탭 → 랜딩 표시(다크 톤·닉네임·코드) → [Google Play에서 다운로드] 탭 → Play 스토어 앱 상세 도달 ③ [코드 복사] 탭 → 클립보드에 코드(Android Chrome / iOS Safari 각각 — execCommand 폴백 검증) ④ "이미 설치했다면 열기"(aidol://) — 설치 기기에서 앱 전환(best-effort, 실패는 기록만·FAIL 아님) ⑤ 앱 쪽 무회귀: 공유 문구(shareTextBase/Full)가 변경 전과 동일(U-6 AppShareModal diff 0의 실측 대응) + 인스타/페북 버튼이 종전대로 네이티브 공유 시트를 띄움(D — 동작 변화 없음 확인만).
- 정적 대체: API-1~3(서버 측) + U-6(앱 무변경). 카톡 카드 렌더·클립보드는 실측 필수.

### 태그 집계
- [unit] 7건 (U-1 tsc / U-2 sessionActive 3점+비영속 / U-3 렌더 조건 진리표 4행 / U-4 Android 수동 패딩·리스너 쌍 / U-5 iOS 분기·타 KAV 무접촉 / U-6 diff 격리 / U-7 v3.191~197 무회귀 — MiniPlayer 라인 단위)
- [api] 3건 (API-1 유효 코드 200+HTML+OG / API-2 정적 OG 이미지 / API-3 무효 코드 404 HTML+CTA·기존 API 무회귀 — **3건 전부 배포 후 오케스트레이터 실행**, tester 호출 금지)
- [e2e] 5건 (E-1 콜드 스타트 미노출 / E-2 재생 후 노출·리셋 / E-3 sound null 유지+1탭 복구 — 실기기 전용 / E-4 키보드 개폐 3회 간격 0 / E-5 카톡 카드 여정 — 전 항목 정적 대체 병기 + 실기기 이관)

### 설계 주의점 (tester·app-dev·backend-dev·오케스트레이터 참고)
1. **sessionActive는 setter 단일 지점이 생명**: 재생 시작점이 6곳+에 분산돼 있어 호출부 배선은 반드시 누락이 생긴다. setSound 안에서만 true가 되는 구조(U-2 ①)가 유일하게 안전하고, 역으로 **setSound(null)에서 false로 리셋하면 v3.197 복구가 즉사**한다(전환 실패 정리 경로가 setSound(null)을 부르므로). truthy-set / null-무변경의 비대칭이 스펙 그 자체다.
2. **진리표 ⓑ행이 v3.197과의 양립 조건**: `!track || (!hasSound && !sessionActive)` 에서 AND가 OR로 바뀌거나 `!sound` 단독 복귀가 섞이면, 컴파일도 되고 E-1도 통과하지만 **E-3(전환 실패 시 미니 유지)만 죽는다** — 정적 검증에서 조건식을 문자 그대로가 아니라 진리표(U-3 ③)로 판정하는 이유. 리뷰 시 이 한 줄은 diff 문자열 비교가 아닌 4행 추적 필수.
3. **sound는 불리언 셀렉터로만**: v3.197이 리렌더 소음 때문에 MiniPlayer에서 sound 객체 구독을 걷어냈다(MiniPlayer.tsx:15 주석). 이번에 `!!s.sound`로 재구독하는 것은 허용이지만 객체 구독 복귀는 회귀다 — grep으로 `(s) => s.sound` 패턴 0건 확인.
4. **키보드 hide 리셋은 무조건 0**: Android 잔존 간격의 근본 원인이 "닫힘 프레임 계산 잔차"이므로, hide 핸들러가 계산값으로 리셋하면(예: `setKbPad(잔여 계산)`) 버그를 그대로 재수입한다. `setKbPad(0)` 리터럴이어야 하고(U-4 ②), 리스너 해제 시점(visible false·언마운트)에도 0 리셋을 병행해야 다음 오픈이 stale 패딩으로 시작하지 않는다.
5. **리스너 쌍은 keyboardDidShow/Hide 2건 × remove 2건**: `keyboardWillShow`는 Android에서 발화하지 않으므로 Did 계열이어야 하고, subscription 2건 보관→cleanup에서 2건 remove가 1:1 대응이어야 한다(v3.197 U-7 ①에서 AppState 구독 해제 누락으로 FAIL 났던 동일 유형 — 이번 사이클에서 같은 실수 반복 여부를 최우선 grep).
6. **OG 이미지 파일명 이원화 주의**: 오케스트레이터 지시는 `/static/og/beta-event-og.png`, PLAN §3-1 초안은 `invite_og.png`. backend-dev가 어느 쪽을 택하든 **판정 기준은 "HTML의 og:image URL = 실서빙 200 URL" 일치**(API-2)다. 파일명만 보고 PASS/FAIL을 찍지 말 것. og:image는 절대 URL 필수 — 상대 경로는 curl 200이어도 카톡 카드가 안 뜬다.
7. **카카오 스크랩 캐시가 E-5의 숨은 전제**: 변경 전 404가 이미 스크랩 캐시됐을 가능성이 높다. 캐시 초기화(API-3 ④) 없이 실기기 카드 판정을 하면 서버가 완벽해도 FAIL로 오판한다 — E-5 Given에 캐시 초기화 완료를 명시한 이유. 카드 미렌더 시 서버 재검보다 캐시 재확인이 먼저다.
8. **무효 코드 404에도 CTA는 산다**: API-3 ①의 "404인데 스토어 버튼 존재"는 모순이 아니라 설계(PLAN §3-3 — 공유 링크가 죽은 경험 방지). 404 = FAIL로 기계 판정하는 스크립트를 쓰면 안 되고, 상태코드와 본문 CTA를 분리 판정할 것. 역으로 무효 코드에 200 + 정상 초대장 렌더면 그것이 FAIL.
9. **App.tsx diff의 출처 분리**: v3.197 게이트가 U-7 ①(AppState 구독 해제) 수정 대기 중 조건부 FAIL 상태다. v3.198 검증 시점의 App.tsx diff는 그 후속 수정일 수 있으므로, v3.198 스코프 위반으로 오판하지 말고 커밋 단위로 분리해 v3.197 U-7 단건 재검과 v3.198 U-6을 각각 판정할 것(한 커밋에 섞여 들어오면 격리 원칙상 분리 커밋 요구).
10. **(D)는 "검증하지 않는 것"이 검증**: 인스타/페북 버튼은 답변만이 산출물이다. AppShareModal.tsx diff 0(U-6)과 E-5 ⑤의 "종전 동작 그대로" 확인이 전부이며, 여기에 개선 diff(버튼 통합·스토리 연동 등)가 섞여 오면 범위 초과 FAIL — PLAN이 별도 과제로 명시했다.

### 실행 결과 — 2026-09-21 (tester, HEAD 5d7db37 기준 워킹트리)

| 항목 | 판정 | 근거 요약 |
|---|---|---|
| U-1 tsc | **PASS** | `npx tsc --noEmit` exit 0, 오류 0건 |
| U-2 sessionActive 3점+비영속 | **PASS** | ① setSound `sound ? { sound, sessionActive: true } : { sound }`(:90) — truthy만 true, null 무변경(비대칭 스펙 충족). sessionActive 참조는 playerStore·MiniPlayer 2파일뿐 — 호출부 직접 set 0건 ② resetOnLogout(:138)·restoreQueueFor 복원 분기(:160) false 포함. 승계 분기(보관 목록 없음)는 미리셋 — resetOnLogout 선행 배선 확인으로 대체 판정(계획 명시 경로). cleanup(:216) 리셋 있음(선택 — 무해) ③ partialize(:228-233) 화이트리스트 4항목에 sessionActive 없음, 초기값 false(:85) |
| U-3 렌더 조건 진리표 | **PASS** | ① `if (!track \|\| (!hasSound && !sessionActive)) return null;`(:28) 스펙 문자 동치 ② `usePlayerStore((s) => !!s.sound)` 불리언 셀렉터(:19), `(s) => s.sound` 객체 구독 0건 ③ 진리표 ⓐ숨김/ⓑ노출유지/ⓒ노출/ⓓ숨김 4행 전부 충족 ④ 주석(:25-27) 복구 보존 의도 갱신됨. __DEV__ 로그 1건(:29) |
| U-4 Android 수동 패딩 | **PASS** | ① `Math.max(0, e.endCoordinates.height - insets.bottom)`(:34) ② hide 핸들러 `setKbPad(0)` 리터럴 무조건(:36) ③ showSub/hideSub 2건 보관 → effect cleanup에서 `.remove()` 2건 + `setKbPad(0)`(:37), visible false 시 early-return 분기도 0 리셋(:31) — stale 패딩 불가 ④ 시트 `insets.bottom + spacing.xl + kbPad` 합산(:108), Android KAV behavior undefined → 이중 계상 없음 ⑤ `Platform.OS !== 'android'` early-return으로 iOS 미등록. keyboardDid 계열(Will 0건) |
| U-5 iOS 분기·타 KAV 무접촉 | **PASS** | ① KAV 유지 + `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`(:104) ② Report/Appeal/AlbumCreate/DmChat 4파일 diff 0 ③ PlaylistPickerSheet 내 keyboardVerticalOffset 0건(타 화면 기존분은 무접촉) |
| U-6 diff 격리 | **FAIL(조건부)** | 허용 3파일(playerStore·MiniPlayer·PlaylistPickerSheet) 외 **콘텐츠 diff 2건 검출**: ① `App.tsx` +1줄(tabBarLabelStyle lineHeight 14) — 주의점 9의 v3.197 U-7 후속이 **아님**(v3.197 픽스는 HEAD에 이미 커밋됨 — App.tsx:483,510 확인). ② `screens/ChartScreen.tsx` 1줄(기본 탭 top100→new). 둘 다 v3.198 스코프 밖. app.json 버전 갱신은 보류(스토어 versionName 영향) — 계획 편차로 기록. PNG 등 75건은 전부 mode change(100644→100755)만 — v3.196 관행 제외. AppShareModal·playback.ts·PlayerScreen diff 0 |
| U-7 v3.191~197 무회귀 | **PASS** | ① MiniPlayer diff 단일 hunk(:15-31 셀렉터·조건부)뿐 — togglePlay 본문(try/catch·getStatusAsync·loadAndPlayTrack 폴백·[BTDebug]·낙관적 토글 부재) v3.197 합격 형상 그대로 ② MCI import·size 20 라인 diff 0 ③ playerStore diff = 인터페이스/초기값/setSound/resetOnLogout/restoreQueueFor/cleanup(sessionActive 추가만) — getNextIndex·savedQueues·partialize 기존 항목 diff 0 ④ playback.ts·PlayerScreen.tsx diff 0 ⑤ PlaylistPickerSheet diff = import·kbPad effect·KAV behavior·패딩 계산부만 — 목록/추가 API 로직 diff 0 ⑥ SocialLoginButtons·AuthPanel diff 0 |
| API-1 유효 코드 랜딩 | **PASS** | 오케스트레이터 배포 검증 인용 + tester 스팟 재확인: GET /invite/7VFU → 200 text/html, og:image 절대 URL(https://api.maidol.ai.kr/static/og/invite_og.png)·1200×630·twitter summary_large_image·Play CTA 존재, HEAD 200 |
| API-2 OG 이미지 서빙 | **PASS** | 스팟 재확인: og:image 실 URL(invite_og.png) 200 image/png, sips 실측 1200×630, og:image URL=실서빙 URL 일치. 별칭 beta-event-og.png도 200(파일명 이원화 양쪽 서빙 — 주의점 6 기준 충족) |
| API-3 무효 코드·무회귀 | **PASS** | 스팟 재확인: /invite/ZZZZ99 → 404 text/html + "유효하지 않은 초대코드예요" + Play CTA 존재. /invite/%3Cscript%3E → 입력 미반사(본문 script는 페이지 자체 copyCode 스크립트, execCommand 폴백 포함) — XSS 스팟 통과. /api/referral/invite/7VFU → 200 application/json 무회귀. ④ 카카오 스크랩 캐시 초기화는 실기기 E-5 선행 절차로 잔여 |
| E-1 콜드 스타트 미노출 | **PASS(정적)** — 실기기 이관 | U-2 ②③ + U-3 ③ⓐ 충족(restoreQueueFor가 track 복원 + sessionActive false → 조건식 숨김, 복원 자체는 유지) |
| E-2 재생 후 노출→리셋 | **PASS(정적)** — 실기기 이관 | U-2 ①②③ + U-3 ③ⓒⓓ 충족(재생 시 truthy setSound→노출, cleanup·로그아웃·재로그인·비영속 4경로 전부 정적 커버) |
| E-3 sound null 유지+1탭 복구 | **PASS(정적)** — **실기기 전용(실측 필수)** | U-3 ③ⓑ(track 有·sound null·sessionActive true → 노출 유지) + U-7 ①(togglePlay 폴백 무침투). BT/비행기모드 실거동은 대체 불가 |
| E-4 키보드 개폐 3회 간격 0 | **PASS(정적)** — 실기기(Android) 이관 | U-4 ①~⑤ + U-5 충족(hide 무조건 0 리셋 + 해제 시 0 리셋 — 잔존 간격 구조적 불가). Android Modal 키보드 프레임 타이밍 실측 필수 |
| E-5 카톡 카드 여정 | **PASS(정적)** — 실기기 이관(캐시 초기화 선행) | API-1~3 PASS + U-6 중 AppShareModal diff 0(D 스펙 = 무변경 그 자체). 카톡 카드 렌더·클립보드·스토어 이동 실측 필수 |

**게이트 판정: 조건부 PASS** — v3.198 구현 자체(A·B·C·D)는 unit 6/7 + api 3/3 전부 충족. 유일 결격은 U-6 스코프 혼입 2건(App.tsx lineHeight·ChartScreen 기본 탭 — 기능 무해하나 격리 원칙 위반). **커밋 시 3파일(stores/playerStore.ts·components/MiniPlayer.tsx·components/PlaylistPickerSheet.tsx) 명시 스테이징으로 분리하면 즉시 PASS** — App.tsx·ChartScreen 2건은 별도 커밋(자체 승인 절차) 또는 revert 처리. app.json 버전 보류는 계획 편차 기록(스테이징 목록에서 제외).

**실기기 잔여(APK)**: E-1(콜드 스타트 미노출+큐 생존) / E-2(노출·닫기·로그아웃/재로그인·재시작 4경로) / E-3(비행기모드·BT — 실측 필수) / E-4(Android 키보드 3회 개폐 간격 0 + iOS 무변경 + Report/Appeal/AlbumCreate 스팟) / E-5(카카오 디버거 캐시 초기화 → 카톡 카드·CTA·코드복사·aidol:// — API-3 ④ 선행 필수).

---

## v3.199 — 수정일 2026-09-21

> 대상: PLAN.md v3.199 — 작업실 UX 4종. (A) Avatar seed 팔레트 통일: `components/ui/Avatar.tsx` seedColor(:22-27, FALLBACK_PALETTE 8색 :17-20) named export 승격 → `screens/SettingsScreen.tsx` 폴백 배경(:463-470 폴백 분기, avatarCircle 고정 `colors.accent.primary` :938-946) 팔레트 교체 + `screens/AgencyProfileScreen.tsx` profileBox(:153-171)에 Avatar(64) 폴백 이니셜 신설 + `screens/UserChannelScreen.tsx:238` `seed={authorId}` 1줄. (B) `screens/DialogueScreen.tsx`·`LyricsInputScreen.tsx`·`ComposerInputScreen.tsx` — useFocusEffect로 부모 탭 헤더 headerLeft back 주입 + blur/unmount 시 `headerLeft: undefined` 복원(MapScreen:283이 기본값). (C) `screens/MapScreen.tsx:261-287` headerTitle — `useWindowDimensions` 기반 `nameMaxWidth = Math.max(90, winW - (user ? 260 : 150))` 명시 폭 View + `components/Marquee.tsx`(무수정, container `width:'100%'` :82라 부모 명시 폭 필수) + ⓘ는 마퀴 밖 고정, deps에 winW 추가. (D) `screens/LyricsInputScreen.tsx` user 버블 edit-2 아이콘 조건부 렌더(기준: VideoDirectorScreen:411 — `size={11} color="rgba(255,255,255,0.7)" marginLeft:6`, 동작 :188-223은 기존) + `screens/ComposerInputScreen.tsx` 재선택 기능 이식(step 기록·버블 TouchableOpacity·handleReselect/handleReselectChoice 스텝 0~2·모달·아이콘).
> 실행 환경 관행(v3.191~198 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 정적 대체 병기 + 실기기 실측 이관. 앱 코드 경로 `/Users/pearl/TripleJ/2_housing`, 라인 번호는 **변경 전** 실측 기준(적용 후 이동 허용 — 앵커 문자열로 재탐색). 백엔드 무변경 — [api] 0건. 검증 증적에 실계정 토큰·이메일·개인 식별 정보 기재 금지(계정은 "계정A/계정B" 익명 표기).
> 변경 허용 파일(격리 기준): `components/ui/Avatar.tsx`, `screens/SettingsScreen.tsx`, `screens/AgencyProfileScreen.tsx`, `screens/UserChannelScreen.tsx`, `screens/DialogueScreen.tsx`, `screens/LyricsInputScreen.tsx`, `screens/ComposerInputScreen.tsx`, `screens/MapScreen.tsx` 8개(+ 커밋 관례상 버전 표기는 커밋 메시지 — app.json 갱신 시 계획 편차 기록). **v3.198 미커밋 3파일(`stores/playerStore.ts`·`components/MiniPlayer.tsx`·`components/PlaylistPickerSheet.tsx`) 및 backend 무접촉 필수**(§U-8 기준선 스냅숏 판정). `components/Marquee.tsx`·`screens/VideoDirectorScreen.tsx`·`App.tsx` diff 0. 그 외 콘텐츠 diff는 FAIL.

### [unit] 정적 검증 (머지 게이트)

**U-1. 타입 무결성 [unit]**
- Given: v3.199 A~D 전부 적용된 워킹트리(v3.198 미커밋분 포함 상태 그대로).
- When: `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: exit 0, 오류 0건. (seedColor named export 시그니처, useFocusEffect 콜백 타입, ComposerInput ChatMessage `step?: number` 확장, useWindowDimensions 전부 통과.)

**U-2. seedColor 결정성 + 8색 분산 + 알고리즘 불변 [unit]**
- Given: seedColor는 v3.181부터 "같은 계정 = 언제나 같은 색"이 스펙의 본질 — export 승격 과정에서 해시식·팔레트가 1글자라도 바뀌면 **기존 전 사용자의 색이 조용히 전부 바뀐다**(렌더 테스트는 전부 통과하면서 식별성만 파괴되는 최악 회귀).
- When: ① `components/ui/Avatar.tsx` diff가 **`export` 키워드 추가(또는 동등한 named export 구문)뿐**인지 — FALLBACK_PALETTE 8항목 hex값·순서(:17-20), 해시식 `h * 31 + charCodeAt >>> 0`·`h % length`(:22-27), 이니셜 로직(:33) diff 0. ② 결정성·분산 실측(정적 대체 겸용): 스크래치에서 `node -e` 원라이너로 seedColor 로직 복사 실행 — 같은 입력 100회 호출 결과 동일(결정성), 서로 다른 seed 40개(예: user1~user40)가 **8색 전부에 최소 1회씩 분포**(분산 — 7색 이하만 나오면 해시/모듈로 변형 의심으로 ①로 회귀 판정). ③ `grep -rn "seedColor" screens/ components/` — import처가 SettingsScreen 1곳(+Avatar 내부)뿐인지, 각 호출이 `seedColor(user.id, user.nickname)` 형태로 **seed 우선·name 폴백** 인자 순서를 지키는지(인자 역순이면 닉네임 변경 시 색 변경 — v3.181 취지 위반 FAIL).
- Then: ①~③ 전부 충족.

**U-3. A 두 화면 배선 + UserChannel seed 1줄 [unit]**
- Given: 구멍 2곳(AgencyProfile 아바타 부재 / Settings 고정 단색) + 소소 1건(UserChannel seed 미전달).
- When/Then (앵커 재탐색 기준):
  - ① **AgencyProfileScreen**: profileBox 내 companyLabel **위** 중앙에 `<Avatar name={uploaderNickname} seed={uploaderId || uploaderNickname} size={64} />` — Avatar는 `components/ui` 공용 import(신규 컴포넌트·인라인 재구현 발견 시 FAIL — PLAN이 재사용 명시). uploaderId 부재(구형 곡) 시 uploaderNickname 폴백 배선 확인.
  - ② **SettingsScreen**: avatarCircle 배경이 **폴백 분기에서만** `seedColor(user.id, user.nickname)` — 판정 3점: ⓐ `user.profile_image` 있는 경우 이미지 렌더 경로 diff 0(이미지 위 배경색은 클리핑돼 무해하나 Image 분기 로직 변형은 FAIL) ⓑ avatarBusy 스피너·avatarEditBadge 구조 diff 0(자체 구현 유지가 스펙 — Avatar 컴포넌트 통째 교체 발견 시 범위 초과 FAIL) ⓒ 정적 StyleSheet의 `backgroundColor: colors.accent.primary`(:941)가 제거되거나 인라인 style로 오버라이드되는지 — StyleSheet에 남긴 채 인라인 미적용이면 고정 보라 잔존 FAIL.
  - ③ **UserChannelScreen:238**: `seed={authorId}` 추가 — 해당 화면의 authorId 변수 실존(다른 이름이면 앵커 재탐색), 그 외 props(uri·name·size 80) diff 0.
- Then: ①~③ 전부 충족.

**U-4. B headerLeft 주입/복원 쌍 — 3화면 × (focus 주입 + blur 복원) [unit]**
- Given: 탭 헤더는 MapScreen useLayoutEffect(:261-287)가 소유하며 `headerLeft: undefined`(:283)가 기본 형상. **함정**: Map 복귀 시 MapScreen useLayoutEffect는 deps(`navigation, user?.company_name, user, showTutorial`) 불변이면 재실행되지 않는다 → 자식 화면의 blur cleanup이 **유일한 복원 경로**. cleanup 누락 시 컴파일·주입 데모 전부 통과하고 화살표만 영구 잔존한다.
- When: `grep -n "headerLeft\|useFocusEffect\|getParent" screens/DialogueScreen.tsx screens/LyricsInputScreen.tsx screens/ComposerInputScreen.tsx` 후 화면별 판정 —
  - ① **주입**: 각 화면에 `useFocusEffect(useCallback(...))` 내 `navigation.getParent()?.setOptions({ headerLeft: () => <TouchableOpacity onPress={goBack} ...><Feather name="arrow-left" size={22} .../></TouchableOpacity> })` — 아이콘 arrow-left·size 22·marginLeft 12·accessibilityLabel(stackHeader 관행) 확인. `useCallback` 래핑 없으면 매 렌더 setOptions 재호출 — 동작은 하나 기록(FAIL 아님).
  - ② **복원(핵심 FAIL 게이트)**: 각 useFocusEffect 콜백이 **cleanup 함수를 return**하고 그 안에서 `parent?.setOptions({ headerLeft: undefined })` — **3화면 각각 주입 1 : 복원 1 쌍이 1:1 대응**. 쌍이 하나라도 깨지면(주입만 있고 return 없음 / cleanup이 빈 함수 / headerLeft가 아닌 다른 키 복원) **잔존 화살표 = 즉시 FAIL**. `null` 복원도 FAIL(MapScreen 기본형은 `undefined` — null은 react-navigation에서 "headerLeft 없음 강제"로 의미가 다름, 문자 그대로 undefined 확인).
  - ③ **화면 내 오버레이 버튼 부재**: 절대배치 back 버튼 추가 발견 시 설계 불일치 기록(PLAN §2 비권장 명시).
  - ④ **탭 재탭 리셋 무회귀**: App.tsx:369-372 리스너 diff 0(App.tsx 자체가 허용 파일 밖 — U-8과 교차).
- Then: ①·② 3화면 전부 + ③·④ 충족.

**U-5. C 헤더 엔터명 — 명시 폭 + Marquee + ⓘ 밖 고정 [unit]**
- Given: Marquee container는 `width:'100%'`(:82)라 부모 명시 폭 없이는 측정이 무의미(bottom-tabs headerTitle 컨테이너는 폭 제약이 느슨). ⓘ가 마퀴 안으로 들어가면 긴 이름에서 텍스트와 함께 흘러가 탭 불가 지점이 생긴다.
- When: MapScreen.tsx headerTitle 렌더부 판정 —
  - ① `useWindowDimensions()` 사용 + `nameMaxWidth` 계산에 **하한 `Math.max(90, …)`** 존재(근사 상수 260/150은 ±30 허용 — 판정은 수식이 아니라 E-3 비침범 실측이 최종, 하한 부재만 정적 FAIL: 소형 기기에서 폭 0 이하 → 마퀴 미렌더).
  - ② 엔터명이 `<View style={{ width: nameMaxWidth }}><Marquee text={user?.company_name || '작업실'} style={{ fontSize:17, fontWeight:'700', ... }} /></View>` — 기존 `numberOfLines={1}` Text 직렌더 제거, **명시 width**(maxWidth 단독이면 Marquee '100%'가 내용폭 기준이 돼 측정 불안정 — width 고정 확인).
  - ③ **ⓘ TouchableOpacity가 마퀴 View 형제 노드**(같은 row, gap 6) — Marquee의 text prop이나 자식으로 들어가 있으면 FAIL. hitSlop·onPress(setShowTutorialHint/setShowTutorial) diff 0.
  - ④ useLayoutEffect deps 배열에 winW(또는 useWindowDimensions 반환값) 추가 — 미추가 시 회전/폴드 전개에서 stale 폭(기록, 실기기 회전 실측 이관).
  - ⑤ headerTitleAlign 'left'·headerRight `<HomeHeaderActions />`·headerLeft: undefined 기본형 diff 0(B의 주입은 자식 화면 소관 — MapScreen 자체에 headerLeft 렌더 함수가 생기면 소유권 혼선 FAIL).
  - ⑥ `git diff -- components/Marquee.tsx` **0건**(PlayerScreen 제목 등 공용 — v3.192 측정판·v3.159 center 정렬 무회귀를 diff 0으로 포섭).
- Then: ①~⑥ 전부 충족(④는 기록 허용).

**U-6. D LyricsInput — edit-2 조건부 렌더 [unit]**
- Given: 재선택 **동작**(:188-223)과 모달은 기존 완성분 — 이번 diff는 어포던스(아이콘)뿐이어야 한다. 자유입력 답변은 :189-190 no-op이므로 아이콘이 붙으면 "탭해도 무반응" 거짓 어포던스.
- When: ① user 버블 내 `<Feather name="edit-2" size={11} color="rgba(255,255,255,0.7)" style={{ marginLeft: 6 }} />` — VideoDirector:411 스펙과 **속성 단위 동일**(size·color·margin 상이하면 기록, 아이콘명 상이는 FAIL). ② 노출 조건이 `msg.type === 'user' && msg.step != null && STEPS[msg.step]?.choices?.length` 와 논리 동치 — 진리표 3행: ⓐ 선택 답변(step 有·choices 有) → 표시 ⓑ 자유입력 답변(choices 無 또는 length 0) → **미표시**(표시되면 FAIL) ⓒ director 메시지 → 미표시. ③ 버블 내부 row 배치(텍스트+아이콘 alignItems center) — 아이콘이 텍스트 줄바꿈을 유발하지 않는 구조. ④ 기존 handleReselect/handleReselectChoice(:188-223)·재선택 모달·onPress 조건(:307) diff 0(동작부를 건드리면 v3.110 매핑 회귀면 확대 — U-9로 승격).
- Then: ①~④ 충족(②는 3행 전부).

**U-7. D ComposerInput — 재선택 이식 실동작 배선 [unit]**
- Given: 변경 전 user 버블은 plain View(:185-199)로 탭 불가·수정 기능 부재. **아이콘만 붙이고 핸들러 미배선이면 거짓 어포던스 = 즉시 FAIL**(사용자가 이미 "선택하면 수정할 수 있잖아"로 오인 중인 지점 — 이 항목의 존재 이유).
- When/Then:
  - ① **step 기록**: ChatMessage 타입에 step 필드 + user push 지점(변경 전 :111·:138 앵커)에서 현재 스텝 기록 — 기록 없이는 어느 답변을 수정할지 식별 불가.
  - ② **탭 배선**: user 버블이 TouchableOpacity(또는 Pressable)로 전환되고 `onPress`가 **handleReselect(msg.step)를 실제 호출** — onPress가 빈 함수·console.log·TODO면 FAIL. director 버블은 비터치 유지.
  - ③ **핸들러 실체**: handleReselect가 스텝 0(genre)·1(mood)·2(vocal)만 모달 오픈, **3·4(freeText)는 no-op**(choices 부재 가드) — LyricsInput :189-190 패턴 동형. handleReselectChoice가 ⓐ 해당 로컬 state(genre/mood/vocal) 갱신 ⓑ chatHistory 내 해당 user 버블 텍스트 갱신 **양쪽 모두** — state만 갱신하면 화면 버블이 옛값(시각 불일치), chatHistory만 갱신하면 최종 프롬프트가 옛값(**기능 불일치 — 완료 시점 조립 :118-123이 state 기준이므로 이쪽이 치명**). 한쪽 누락 = FAIL.
  - ④ **모달**: LyricsInput 모달(:402-419)·styles 이식 — 열림 조건·choices 소스가 ComposerInput STEPS 기준인지(LyricsInput STEPS를 잘못 참조하면 작사 선택지가 뜨는 오배선 — grep으로 STEPS 참조 대상 확인).
  - ⑤ **아이콘**: U-6 ①·② 동일 스펙·동일 조건식(스텝 0~2 답변만 표시, 자유입력 2종 미표시).
  - ⑥ **VideoDirectorScreen.tsx diff 0**(기준 화면 무변경 — v3.182 무회귀를 diff 0으로 포섭).
- Then: ①~⑥ 전부 충족.

**U-8. diff 격리 — v3.198 미커밋 3파일 기준선 스냅숏 판정 [unit]**
- Given: **워킹트리가 이미 dirty 상태로 착수한다**(v3.198 합격분 3파일 미커밋 — 착수 시점 실측 확인됨). 따라서 `git status`/`git diff` 단독으로는 v3.198분과 v3.199 혼입을 구분할 수 없다 — 기준선 스냅숏이 유일한 판정 수단.
- When: ① **착수 전**(app-dev 첫 수정 전) `git diff -- stores/playerStore.ts components/MiniPlayer.tsx components/PlaylistPickerSheet.tsx | shasum` 기준선 캡처(오케스트레이터 또는 tester 선행 절차 — 누락 시 차선책: v3.198 실행 결과표의 합격 형상 앵커와 hunk 단위 대조). ② **완료 후** 동일 명령 재실행 — 해시 일치 = 무접촉 확증. **불일치 = 즉시 FAIL**(v3.198 합격 형상 오염 — v3.198 U-2~U-5 전체 재실행 승격). ③ `git status --short` + `git diff --stat`(2_housing 스코프): 콘텐츠 diff가 v3.198 3파일 + **허용 8파일**뿐인지. `components/Marquee.tsx`·`screens/VideoDirectorScreen.tsx`·`App.tsx`·`components/ui/index.ts`(Avatar 이미 export 시) 및 그 외 일체 diff 0 — **v3.198 U-6에서 검출된 기존 혼입 2건(App.tsx lineHeight·ChartScreen 기본 탭)이 아직 워킹트리에 남아 있으면 v3.199 위반으로 오판하지 말고 v3.198 잔여 처리 소관으로 분리 판정**(단 v3.199 커밋에 혼입되면 FAIL). ④ backend 디렉토리 무접촉. ⑤ 커밋 시 허용 8파일 명시 스테이징(v3.198 3파일과 별도 커밋 — 한 커밋 혼합 시 격리 원칙상 분리 요구).
- Then: ①~⑤ 전부 충족.

**U-9. v3.191~198 무회귀 — 접촉 파일 라인 단위 [unit]**
- Given: 이번 접촉 8파일 중 이력 중첩 지점 — Avatar.tsx(v3.181 팔레트), SettingsScreen(v3.92 이미지 업로드/삭제·클리핑), MapScreen(v3.75 헤더 액션·튜토리얼 ⓘ), LyricsInput(v3.110 스텝 매핑), Marquee 소비처(v3.192·v3.159).
- When/Then (앵커 문자열 재탐색):
  - ① **v3.92**: SettingsScreen 아바타 업로드 핸들러·삭제·`overflow:'hidden'` 클리핑 주석 라인 diff 0(배경색 라인 제외).
  - ② **v3.181**: U-2 ①로 포섭(해시·팔레트 불변) + 기존 Avatar 적용처(DmChatScreen:164·DmInboxScreen:145,242·TrackComments:128,171·FeedCard:325) diff 0.
  - ③ **v3.75/튜토리얼**: MapScreen headerRight HomeHeaderActions·showTutorial 상태 배선·튜토리얼 오버레이 diff 0(U-5 ⑤ 교차).
  - ④ **v3.110**: LyricsInput STEPS 정의·handleReselectChoice 내 스텝→state 매핑 diff 0(U-6 ④ 교차).
  - ⑤ **v3.192/v3.159**: Marquee.tsx diff 0(U-5 ⑥)으로 PlayerScreen 제목 마퀴·center 정렬 무회귀 포섭 — PlayerScreen.tsx 자체도 diff 0(허용 파일 밖).
  - ⑥ **v3.198(병행 사이클)**: U-8 ①② 해시 판정으로 포섭 — 별도 라인 검증 불요.
  - ⑦ **B 신규 3화면 침투면**: DialogueScreen diff가 useFocusEffect 블록(+필요 import)뿐인지 — 대화 진행 로직(:224·:262 navigate 분기, :244 goBack)·타이핑 연출 diff 0. LyricsInput·ComposerInput도 각각 B(헤더)·D(아이콘/이식) 외 diff 0.
  - 위반 시 해당 버전 TESTPLAN 항목 재실행으로 승격.

### [e2e] 핵심 여정 (정적 대체 병기 · 실기기 이관)

**E-1. A — 아바타 팔레트 여정 [e2e] — 실기기(APK) 이관**
- Given: 프로필 이미지 미설정 계정A·계정B(색 대조용, 익명 표기) + 이미지 설정 계정C + 구형 곡(uploader_id 없음) 1곡.
- When/Then: ① 계정A 설정 화면 — 아바타가 이니셜+**팔레트색**(고정 보라 `#7C5CBF`가 아닐 수도, 우연히 그 색일 수도 — 판정은 "계정B와 상이" + 재실행 불변으로) ② 앱 완전 재시작 2회 — 같은 색 유지(결정성 실측) ③ 구형 곡 Player → 기획사명 탭 → AgencyProfile: 이니셜 아바타(64) 노출(변경 전 = 아무것도 없음) ④ 계정A의 UserChannel·피드·DM·댓글 아바타가 **전부 같은 색**(seed 통일 실측 — UserChannel만 다르면 U-3 ③ 오배선) ⑤ 계정C: 이미지 그대로 + 업로드/삭제 1사이클(v3.92 무회귀) ⑥ 닉네임 변경 후에도 색 불변(seed=id 우선 실증).
- 정적 대체: U-2 ②(node 결정성·분산 실측) + U-3 + U-9 ①②.

**E-2. B — 디렉터 대화 back 여정 [e2e] — 실기기 이관**
- Given: 로그인 상태, 작업실 탭.
- When/Then: ① 디렉터 탭 → 대화 진입: 탭 헤더 좌측 화살표 노출 → 탭 → Map 복귀 ② **복귀 직후 헤더 좌측 화살표 잔존 없음**(cleanup 실증 — 잔존 시 즉시 FAIL, 본 여정의 핵심 판정) ③ Android HW back으로도 동일(복귀+잔존 없음) ④ 대화 → 작사 입력 → 작곡 입력 순 연속 전환 후 Map 복귀 — 최종 상태 화살표 없음(3화면 주입/복원 쌍 연쇄 — 전환 순서 레이스 실측) ⑤ 하단 작업실 탭 재탭 리셋 무회귀 ⑥ 작사/작곡 화면 각각 화살표 탭 back 동작(확인 팝업 없이 즉시 — 스펙).
- 정적 대체: U-4(3쌍 배선) — 단 ④의 화면 간 연속 전환 시 focus/blur 발화 순서는 정적 판정 불가, 실측 필수.

**E-3. C — 긴 엔터명 마퀴 여정 [e2e] — 실기기 이관(360dp 소형 포함)**
- Given: 기획사명 3종 — 짧은 이름(4자) / 20자+ 긴 이름("○○○○○○○○○○ 엔터테인먼트" 자동 접미 포함) / 비로그인.
- When/Then: ① 짧은 이름: 정적 표시(흐르지 않음) + ⓘ 탭 → 튜토리얼 토글 정상 ② 긴 이름: 텍스트 흐름 + **우측 6요소(별 배지·출석·초대·알림·DM·마이페이지) 침범/겹침 없음** + ⓘ가 흐르지 않고 고정 위치에서 탭 가능 ③ 360dp 소형 기기(또는 해상도 축소): 이름 영역 최소폭 확보(하한 90px — 마퀴 미렌더/음수 폭 없음) ④ 비로그인: '작업실' 정적 표시 ⑤ 화면 회전(지원 시): 폭 재계산 ⑥ PlayerScreen 긴 제목 마퀴 무회귀(v3.192 흐름 + v3.159 짧은 제목 center).
- 정적 대체: U-5 + U-9 ⑤. 겹침·흐름 판정은 육안 실측 필수(정적으로는 근사 상수의 타당성만 확인).

**E-4. D — 선택값 수정 여정 (작사·작곡) [e2e] — 실기기 이관**
- Given: 작사·작곡 각 1회 대화 완주 준비.
- When/Then: ① 작사: 선택형 답변 버블에만 연필 표시, 자유입력 답변엔 미표시 → 선택형 버블 탭 → 재선택 모달 → 다른 값 선택 → 버블 텍스트 즉시 갱신 + 이후 생성 결과에 새 값 반영(v3.110 매핑 무회귀) ② 작곡: 장르 답변 탭 → 재선택(**작곡 선택지가 뜨는지** — 작사 선택지면 U-7 ④ 오배선) → 분위기·보컬 동일 → **완료 시 최종 프롬프트에 수정값 반영**(state 갱신 실증 — 버블만 바뀌고 결과가 옛값이면 U-7 ③ ⓐ 누락) ③ 작곡 자유입력 2종(스텝 3·4): 연필 미표시 + 탭 무반응 아님이 아니라 **탭 자체가 비활성**(TouchableOpacity 조건 분기 확인) ④ 영상 디렉터: 기존 수정 흐름 1사이클(v3.182 무회귀 — 기준 화면 무변경 확증).
- 정적 대체: U-6·U-7·U-9 ④ + VideoDirector diff 0(U-7 ⑥). 최종 프롬프트 반영은 완주 실측이 확실 — 정적으로는 조립부(:118-123) state 참조 확인까지.

### 태그 집계
- [unit] 9건 (U-1 tsc / U-2 seedColor 결정성·8색 분산·알고리즘 불변 / U-3 A 두 화면+UserChannel 배선 / U-4 B headerLeft 주입·복원 3쌍 / U-5 C 명시 폭+Marquee+ⓘ 밖 고정 / U-6 D LyricsInput 아이콘 조건부 / U-7 D ComposerInput 이식 실동작 / U-8 diff 격리 — v3.198 기준선 스냅숏 / U-9 v3.191~198 무회귀 라인 단위)
- [api] 0건 (백엔드 무변경)
- [e2e] 4건 (E-1 아바타 팔레트 / E-2 대화 back·잔존 없음 / E-3 긴 엔터명 마퀴·비침범 / E-4 선택값 수정 — 전 항목 정적 대체 병기 + 실기기 이관)

### 설계 주의점 (tester·app-dev·오케스트레이터 참고)
1. **U-8 기준선 스냅숏이 이번 사이클의 전제 조건**: 워킹트리가 v3.198 미커밋분으로 이미 dirty인 채 착수한다. app-dev 첫 수정 **전에** 3파일 diff 해시를 캡처하지 않으면 사후에 무접촉을 증명할 수단이 없다 — 오케스트레이터는 착수 지시와 동시에 캡처를 선행시킬 것. 캡처를 놓쳤다면 v3.198 실행 결과표의 합격 앵커(예: MiniPlayer `:28` 조건식, playerStore `:90` setSound)와 hunk 대조가 차선.
2. **headerLeft 복원은 blur cleanup만이 경로**: MapScreen useLayoutEffect는 deps 불변이면 Map 복귀 시 재실행되지 않는다(:287 deps 실측). "Map이 돌아오면 어차피 덮어쓰겠지"는 성립하지 않으며, cleanup 누락은 정적 데모·단건 왕복에서도 우연히 통과할 수 있다 — 판정은 코드의 **return cleanup 존재**(U-4 ②)로, 실측은 **복귀 직후 잔존 없음**(E-2 ②)으로 이중화했다. 복원값은 `undefined` 문자 그대로 — `null`은 의미가 다르다.
3. **3화면 연속 전환은 focus/blur 발화 순서 레이스**: Dialogue→LyricsInput 직행 시 이전 화면 blur cleanup과 다음 화면 focus 주입의 순서는 react-navigation 내부 사정이다. 최종 상태 판정("3화면 중 하나라도 focus면 화살표 있음, Map이면 없음")으로 설계했고 순서 자체는 판정하지 않는다 — E-2 ④가 이를 실측한다. 만약 중간에 화살표가 깜빡이는 프레임이 보이면 기록만(FAIL 아님).
4. **seedColor는 "안 바뀐 것"이 합격**: export 승격이라는 한 단어짜리 diff가 스펙이다. 리팩터링 유혹(팔레트 확장·해시 개선)이 섞이면 전 사용자 색이 조용히 바뀐다 — U-2 ①이 hex값 단위로 못 박는 이유. 분산 실측(U-2 ②)은 40개 seed로 8색 전부 커버를 요구하는데, 31-곱 해시 특성상 충분히 나온다 — 안 나오면 분포 문제가 아니라 코드 변형을 의심할 것.
5. **Settings는 색 함수만 재사용, 컴포넌트는 그대로**: 편집 배지·스피너 때문에 자체 구현 유지가 스펙(PLAN §1 방안 2). Avatar 컴포넌트로 통째 교체하면 배지 절대배치·클리핑(v3.92)이 연쇄로 흔들린다 — U-3 ② ⓑ가 범위 초과 FAIL로 잡는다. 또 StyleSheet 정적 색을 지우지 않고 인라인만 더하는 방식/지우고 인라인만 쓰는 방식 둘 다 허용이지만, **정적 색이 이기는 배치**(인라인이 스프레드 순서상 앞)면 고정 보라 잔존 — ⓒ의 취지.
6. **UserChannel seed 추가는 1회성 색 변경을 유발**: 기존엔 name 해시였으므로, seed={authorId} 적용 직후 일부 사용자의 채널 아바타 색이 한 번 바뀐다. 이는 버그가 아니라 v3.181 정합화의 대가(이후 닉네임을 바꿔도 불변) — E-1 ④에서 "다른 화면과 색이 달라졌다"는 리포트가 오면 이 항목으로 설명하고 PASS 처리.
7. **Marquee는 부모가 폭을 줘야 산다**: container `width:'100%'`(:82) 때문에 headerTitle처럼 폭 제약이 느슨한 자리에선 명시 width View가 필수다(U-5 ②). maxWidth만 주면 내용폭 기준으로 줄어들어 측정이 흔들린다. 근사 상수(260/150)는 실기기 겹침 실측(E-3 ②)이 최종 판정이고 정적으로는 하한 90만 FAIL 게이트 — 상수 숫자로 PASS/FAIL을 찍지 말 것.
8. **ⓘ는 흐르면 안 되는 요소**: 마퀴 안에 넣으면 긴 이름에서 화면 밖으로 흘러가 튜토리얼 진입이 간헐 불가가 된다(재현이 어려운 유형의 버그). U-5 ③이 형제 노드 배치를 구조로 강제하고, E-3 ②가 "흐르는 중에도 ⓘ 고정 탭 가능"을 실측한다.
9. **D의 두 화면은 판정 기준이 정반대**: LyricsInput은 동작이 이미 있으므로 "아이콘만 추가됐는지"(동작부 diff 0)가 합격이고, ComposerInput은 동작이 없으므로 "아이콘 전에 동작이 이식됐는지"가 합격이다. **아이콘만 이식된 ComposerInput = 거짓 어포던스 = 이번 사이클 유일의 즉사급 UX FAIL**(U-7 ②). 역으로 LyricsInput 동작부를 "개선"하는 diff도 FAIL(U-6 ④).
10. **ComposerInput 수정은 state·chatHistory 양쪽 갱신이 정합 조건**: 최종 프롬프트는 완료 시점 state로 조립(:118-123)되므로 state 누락은 기능 버그(결과가 옛값), chatHistory 누락은 시각 버그(버블이 옛값)다. 정적(U-7 ③)은 양쪽 갱신 코드 존재를, 실측(E-4 ②)은 최종 프롬프트 반영을 본다 — 어느 한쪽만 통과하면 합격이 아니다.
11. **증적의 민감정보 금지**: E-1의 계정 대조는 "계정A/계정B" 익명 표기로 기록하고, 스크린샷 증적에서 실닉네임·이메일·토큰이 노출되면 마스킹 후 첨부. node 실측(U-2 ②)의 seed 입력도 합성 문자열만 사용(실사용자 id 금지).

### 실행 결과 — v3.199 (tester, 2026-09-21)

> 기준선: HEAD 5f27144(v3.198 커밋 완료) — U-8의 "미커밋 3파일 스냅숏" 전제는 해소됨(3파일 diff 0 = 무접촉 동치 확증). tsc 0건 실측. 안전 분류기 미검토 전제로 diff 전수 열람 수행 — 수상 코드 혼입 없음(9파일 diff 전량이 UI 배선·스타일뿐, 네트워크/저장/외부 전송성 코드 無).

| 항목 | 판정 | 근거 요약 |
|---|---|---|
| U-1 tsc | **PASS** | `npx tsc --noEmit` exit 0, 오류 0건 |
| U-2 seedColor 불변·결정성·분산 | **PASS** | ① diff = `export` 키워드 + 주석 2줄뿐(팔레트 8 hex·`h*31+charCodeAt>>>0`·`h%length`·이니셜 diff 0) ② node 실측: 동일 입력 100회 동일, 합성 seed 40개 → 8색 전부 커버(8/8), seed 우선(name 무시)·name 폴백 확인 ③ import처 SettingsScreen 1곳뿐, `seedColor(String(user.id), user.nickname)` seed 우선 순서 준수 |
| U-3 A 배선 | **PASS** | ① AgencyProfile: 공용 `components/ui` Avatar import, companyLabel 위 중앙 `name={uploaderNickname} seed={uploaderId \|\| uploaderNickname} size={64}`, uploaderId?: string 폴백 배선 ✓(avatarWrap 스타일 1건 추가 — 허용 범위) ② Settings: 인라인 조건부(`!user.profile_image`)로만 적용, Image 분기·avatarBusy 스피너·editBadge diff 0, StyleSheet 정적 색 잔존하나 RN 배열 스타일 후순위 인라인이 승리(ⓒ 충족) ③ UserChannel: `seed={authorId ? String(authorId) : undefined}`(스펙 동치·타입 안전), uri/name/size 80 diff 0 |
| U-4 B 주입/복원 3쌍 | **PASS** | 3화면 전부 `useFocusEffect(useCallback(...))` 주입 + cleanup return에서 `headerLeft: undefined` 문자 그대로 복원(null 아님) — 1:1 쌍 완전. arrow-left·22·marginLeft 12·accessibilityLabel ✓. 오버레이 back 버튼 無. App.tsx 콘텐츠 diff 0(재탭 리스너 무접촉) |
| U-5 C 명시 폭+Marquee+ⓘ | **PASS** | ① useWindowDimensions(:198) 기반, 하한 `Math.max(90,…)` 존재 ② `<View style={{width:nameMaxWidth}}><Marquee/></View>` — 기존 numberOfLines Text 제거, width 고정 ③ ⓘ는 마퀴 View의 형제 노드(row·gap 6), hitSlop/onPress diff 0 ④ deps에 nameMaxWidth(winW 파생) 추가 ✓ ⑤ headerLeft: undefined(:292)·headerRight·Align diff 0 ⑥ Marquee.tsx 콘텐츠 diff 0 |
| U-6 D LyricsInput 아이콘 | **PASS** | ① edit-2 11px rgba(255,255,255,0.7) marginLeft 6 — VideoDirector:411 속성 단위 동일 ② 조건 `user && step!=null && STEPS[step]?.choices?.length` 삼항 — 진리표 3행 충족(자유입력·director 미표시) ③ userBubble row+alignItems center, userText flexShrink:1 ④ handleReselect/handleReselectChoice·모달·onPress 조건 diff 0 |
| U-7 D ComposerInput 이식 | **PASS** | ① ChatMessage `step?: number` + user push 2지점 step 기록 ② user 버블 TouchableOpacity + onPress→handleReselect(msg.step) 실호출 ③ 스텝 0/1/2만 모달(choices 가드), 3·4 no-op, handleReselectChoice가 로컬 state(+store.setGenre/setMood — processAnswer 동형)와 chatHistory **양쪽** 갱신 ④ 모달 choices = ComposerInput 자기 STEPS(교차 import 無) ⑤ 아이콘 U-6 동일 스펙+동일 조건(+!isComplete) ⑥ VideoDirectorScreen 콘텐츠 diff 0 |
| U-8 diff 격리 | **PASS** | v3.198 3파일(playerStore·MiniPlayer·PlaylistPickerSheet) HEAD 대비 diff 0(커밋 완료로 스냅숏 대조 동치 충족). 콘텐츠 diff = 허용 8파일 + `components/ui/index.ts` 1줄(하기 기록 참조). Marquee·VideoDirector·App·PlayerScreen·ChartScreen·app.json 전부 콘텐츠 diff 0. backend 무접촉. 그 외 M 75건은 **mode-only**(바이너리 콘텐츠 변경 0 실측 — 7f1c245 계열 환경 잔여, 분리 판정). 스코프 외 저장소 dirty(0_platform·1_MV_wedding 등)는 mtime 2026-06월 — 기존분, v3.199 무관 |
| U-9 무회귀 | **PASS** | ① v3.92 업로드/삭제/클리핑 diff 0 ② 팔레트 불변+Avatar 소비처(DmChat·DmInbox·TrackComments·FeedCard) diff 0 ③ v3.75 HomeHeaderActions·튜토리얼 diff 0 ④ v3.110 STEPS·매핑 diff 0 ⑤ Marquee·PlayerScreen diff 0 ⑥ U-8 포섭 ⑦ Dialogue diff = import+useFocusEffect 블록만(대화 로직 diff 0) |
| E-1 아바타 팔레트 | 정적 PASS · **실기기 이관** | U-2 ②·U-3·U-9 ①② 충족. 잔여: 계정A/B 색 대조·재시작 결정성·구형 곡 AgencyProfile·닉변 불변·계정C 업로드 1사이클 |
| E-2 대화 back | 정적 PASS · **실기기 이관** | U-4 3쌍 충족. 잔여: 복귀 직후 잔존 없음·HW back·3화면 연속 전환 레이스·재탭 리셋 |
| E-3 긴 엔터명 | 정적 PASS · **실기기 이관** | U-5 충족. 잔여: 우측 6요소 비침범 육안·360dp·회전·PlayerScreen 마퀴 |
| E-4 선택값 수정 | 정적 PASS · **실기기 이관** | U-6·U-7 충족(조립부 :144-153 state 참조 확인). 잔여: 최종 프롬프트 수정값 반영 완주·작곡 선택지 오배선 육안·VideoDirector 1사이클 |

**편차 판정 (app-dev 신고 3건)**
1. ComposerInput `!isComplete` 게이트 — **승인**. 완료 시 프롬프트가 setTimeout 클로저 state로 즉시 조립·저장되어 사후 수정 반영 경로가 없음 — 거짓 어포던스 방지로 설계 주의점 §9 취지와 정합(LyricsInput과 동작 차이는 조립 시점 차이에서 기인).
2. userText `flexShrink: 1` — **승인**. 버블 row 전환의 필연 보완(긴 자유입력 오버플로 방지), 양 화면 동일 적용.
3. back 라벨 이원화("작업실로 돌아가기"/"뒤로") — **승인·기록**. 접근성 의미 정확성 향상, 스펙 위반 아님.

**기록 (비FAIL)**
- `components/ui/index.ts` 1줄: 허용 8파일 밖이나 seedColor named export의 barrel 노출에 필연·최소(기존 라인에 `, seedColor` 추가뿐). Settings가 barrel import 관행을 따르므로 직접 경로 import보다 타당 — 커밋 대상 포함 권고(9파일).
- ComposerInput director 버블도 TouchableOpacity로 래핑됨 — 도너 LyricsInput과 동형 패턴(activeOpacity 1·onPress 타입 가드로 완전 비활성), 회귀 아님.
- ComposerInput activeOpacity 조건이 도너보다 엄격(choices·isComplete 검사) — 자유입력 버블 탭 시 시각 피드백도 없음(E-4 ③ 취지에 오히려 부합).
- handleReselect 내 `__DEV__` console.info 1건 — 무해.
- Avatar.tsx 주석 2줄 추가 — 동작 무영향.
- 커밋 시 mode-only 75건 제외, 콘텐츠 9파일 명시 스테이징 권고.

**게이트 판정: PASS** — [unit] 9/9 PASS, [api] 0건, [e2e] 4건 정적 대체 전부 PASS(실기기 실측 이관). 머지(커밋) 진행 가능.

## v3.200 — 수정일 2026-09-21

> 대상: PLAN.md v3.200 — Phase 0 창작 기록 계층 1차 슬라이스 + ② 창작 모드 분기. 요구사항 원문 `/Users/pearl/Downloads/Phase0_창작기록계층_개발요구사항.md`(§15 E2E·§3.4/§4.4/§5.6/§6.4/§7.5 수용 기준·부록 B). **백엔드는 이미 서버 배포 완료**(creation_log.py 해시 체인 자기검증 통과·sessions.py·suno_generator 전문/SHA-256·generate.py 하위호환·tracks.py FINALIZE 훅·PG `creation_log` 스키마 lifespan 멱등 생성 — 배포 로그 확인됨). 앱은 10파일: 신규 `services/creationLogService.ts`(272줄) + `stores/musicStore.ts`(creationSessionId·creationMode) + `services/musicService.ts`(session_id/lyrics_version_id 동봉) + `screens/MusicResultScreen.tsx`(LISTEN/CANDIDATE_SELECT 계측·track_type·flush 3지점·발매 고지) + `screens/LyricsResultScreen.tsx`·`screens/MusicGenerationScreen.tsx`(가사 버전 커밋) + `components/TrackShareDownloadSheet.tsx`·`constants/consentTexts.ts`·`screens/SettingsScreen.tsx`(F6 고지) + `screens/DialogueScreen.tsx`(②모드 토글 — **구현이 PLAN §3 1안(MusicResult 카드)에서 작사 디렉터 모드 토글로 변경 확정**, copyright_ready 실선택 가능).
> 실행 환경 관행: 에뮬레이터/maestro 부재 → [e2e] 실기기 이관+정적 대체 병기. **실사용 스모크는 실제 곡 생성 = Suno 실과금이라 사용자 실기기 테스트로 이관**(A-3에 검증 SQL/명령 명시 — 생성 1회면 충분). [unit-서버]는 **오케스트레이터가 배포 서버 ssh 읽기로만** 실행(코드 수정·재시작 금지, 9004만). **중대 실측: 로컬 백엔드 워크트리 `/Users/pearl/TripleJ-backend/0_platform_music/backend_9004`에는 v3.200 파일이 없다**(app/services/creation_log.py·app/routes/sessions.py 부재, tracks.py track_type 부재) — 서버 코드로만 검증하고, 서버→git 동기화 잔무를 결과에 기록할 것. 라인 번호는 diff 실측 기준(적용 후 이동 허용 — 앵커 문자열 재탐색). 증적에 실계정·토큰·개인정보 금지.
> 변경 허용 파일(격리 기준): 위 10파일(9 tracked M + creationLogService.ts untracked ??). 그 외 2_housing 콘텐츠 diff 0 — 대량 M은 mode-only/바이너리 잡음(v3.199 U-8 관행: 분리 판정, 커밋 명시 스테이징). backend 로컬 워크트리 무접촉.

### [unit] 앱 정적 검증 (머지 게이트)

**U-1. 타입 무결성 [unit]**
- When: `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: exit 0. (creationLogService 신규 모듈 export 4종 시그니처, musicStore creationMode 리터럴 유니언 `'standard'|'copyright'`, QueuedEvent target 옵셔널 스프레드, SettingsScreen policy 유니언 `'ai'` 확장 전부 통과.)

**U-2. 이벤트 계약 — 6필드 고정·봉투형·500 분할·순서 보존 [unit]**
- Given: 배포 서버 §12 엄격 검증(미정의 필드 400·배열 직송 400)이므로 **앱이 보내는 형태가 계약의 전부**다. 필드 하나만 새어도 이벤트 전량 폐기된다.
- When/Then (`services/creationLogService.ts` 실측):
  - ① **6필드 고정**: `QueuedEvent`(:26-33)가 `event_id, client_seq, type, client_ts, target?, payload` 정확히 6종 — `actor`/`seq`/`server_ts`/해시류 **부재**(서버 부여 — :25 주석). enqueue(:217-224)의 스프레드가 `...(target ? { target } : {})` — target 없을 때 `target: undefined` 키 자체가 안 실리는지(undefined 키 직렬화는 axios가 제거하나, null 전송은 400 위험 — null 대입 발견 시 FAIL).
  - ② **봉투형**: `sendBatch`(:157) body가 `{ events }` — 배열 직송·`{data:...}` 등 다른 키 0건. lyrics(:255-259)는 `source, text, prev_version_id` **3필드 정확히**(여분 필드 400 — trimmed 텍스트·prev null 처리 확인). sessions(:96-107)는 관대 스키마 전제라 5필드+주석(creation_mode 미전송 근거 :103-106 주석 실존 — 전송 발견 시 400 리스크 FAIL).
  - ③ **500 분할**: `MAX_BATCH_SIZE = 500`(:144), 초과 시 재귀 분할(:148-154)이 **순차 for-await**(병렬 Promise.all이면 순서 붕괴 FAIL)이고 slice 경계가 무손실(0..500, 500..1000)인지.
  - ④ **client_seq 단조·순서**: `++clientSeq`(:219) enqueue 시점 부여 — 세션 생성 성공 시 0 리셋(:111)·endCreationSession 리셋(:133). 세션 미확보 중 연속 logCreationEvent 호출은 동일 `sessionStartPromise`(:93)의 `.then(enqueue)`(:231)로 등록 순서대로 실행 — **enqueue가 promise 등록 순서를 보존**하는 구조인지(각 호출이 독자적으로 ensureCreationSession을 새로 만들면 경합 FAIL). flush 경합: `flushCreationEvents`(:177-192)가 진행 중 `flushing`을 먼저 await(:179) 후 새 배치 전송 — 배치 간 역전 불가 구조 확인.
  - ⑤ **재시도**: `MAX_SEND_ATTEMPTS=3`(:47) 백오프 1s/2s(:170), **400·409는 즉시 폐기**(:165-168 — FINALIZED 세션·스키마 거부에 재시도는 무의미+서버 부하), 소진 시 폐기(:173 — 오프라인 영속 큐 후속 명시 주석).
- Then: ①~⑤ 전부 충족.

**U-3. no-op 게이트 — 기록이 기능을 절대 막지 않는다 [unit]**
- Given: 문서 원칙(§3.4 취지)+PLAN A1 — 서버 미배포(404)/비로그인(401)이면 이번 실행 동안 무해 no-op. **기록 코드가 재생·생성·발매 경로에서 예외를 전파하면 그 자체가 이번 슬라이스 최악 결함**(기록하려다 본기능 파괴).
- When/Then:
  - ① `gateIfUnavailable`(:66-72): 404·401만 `disabled=true` — 5xx/네트워크 오류는 게이트하지 않음(일시 오류 — 재시도로). 게이트 후 전 진입점(:90 ensure·:213 logEvent·:245 commitLyrics) 즉시 return.
  - ② 비로그인 사전 차단: `useAuthStore.getState().token` 부재 시 **요청 없이** null(:92) — 401 왕복으로 게이트를 태우지 않음(로그인 후 같은 실행에서 기록 재개 가능 여부와 직결 — ①의 401 게이트는 "토큰 있는데 401"인 이상 상태만).
  - ③ **호출부 전수 비차단 감사**: 계측·커밋 호출 11지점 전부 (a) fire-and-forget `.catch()` — MusicResult flush cleanup(:287-293)·LyricsResult 3지점·MusicGeneration 2지점, 또는 (b) try/catch 삼킴 — musicService(:253-262)·MusicResult 발매 전 flush 2곳("발매는 계속" 주석), 또는 (c) 동기 void — logCreationEvent. **await가 catch 없이 본기능 경로에 노출된 지점 0건**(1건이라도 있으면 FAIL). 특히 musicService의 `await ensureCreationSession()`이 try 블록 안(:250-262)인지 — 밖이면 세션 API 500에서 곡 생성 자체가 죽는다.
  - ④ 발매 전 `await flushCreationEvents()`(:432-437·커버 경유 동일)의 타임아웃 상한: api 15s×최대 3회 백오프 = 최악 ~51s 발매 지연 가능 — sendBatch 실패 경로가 발매를 잡아두는 시간을 실측 산정해 기록(설계 주의점 5 — FAIL 아님, 수치 기록).
- Then: ①~③ 충족, ④ 기록.

**U-4. 세션 생명주기 — idempotent·종료 2경로·store 동기화 [unit]**
- When/Then (`creationLogService.ts` + 호출부):
  - ① **idempotent**: `ensureCreationSession` — `sessionId` 존재 시 즉시 반환(:91), 동시 호출은 단일 `sessionStartPromise` 공유(:93-126, finally에서 null 복원). MusicGeneration mount(:154-159)와 LyricsResult ai_draft 커밋이 겹쳐도 POST /sessions 1회.
  - ② **종료 2경로**: MusicResult 발매 성공 직후 `endCreationSession()` — handleSave(:459-460)와 커버 경유(:521-524) **양쪽 모두**(한쪽 누락 시 다음 곡이 FINALIZED 세션에 이벤트 → 409 폐기 연쇄). 종료가 `lyricsStore.reset()`과 같은 성공 블록 안(실패 시 세션 유지 — 재시도 발매 가능)인지.
  - ③ **store 동기화**: 세션 확보 시 `useMusicStore.setCreationSessionId(id)`(:114), 종료 시 null(:138) — MusicResult 발매 payload가 읽는 `store.creationSessionId`(:426)와 모듈 상태 `sessionId`가 어긋나는 경로 없음(둘 다 같은 지점에서만 쓰기).
  - ④ **알려진 한계 기록(FAIL 아님)**: 발매 없이 새 곡을 시작하면 이전 세션이 이어진다(모듈 상태 잔존 — ABANDONED 30일 배치는 후속, PLAN §2). 곡 경계 혼입 가능성을 결과에 기록하고 실기기 스모크 SQL(A-3)에서 세션-곡 대응을 확인.
- Then: ①~③ 충족, ④ 기록.

**U-5. 가사 버전 커밋 지점·dedupe·생성 동봉 [unit]**
- Given: §7.4 커밋 시점(키 입력마다 금지) + §7.5 "FINALIZE.lyrics_version_id 텍스트 = 생성 요청 가사" — 커밋 지점 누락은 소급 불가 유실, dedupe 부재는 버전 오염.
- When/Then:
  - ① **커밋 5지점 실존**: (a) LyricsResult mount `ai_draft`(:49-59, hasError 가드·빈 가사 스킵) (b) LyricsResult '완료' 토글 `user_edit`(:208-218 — `isEditingLyrics`일 때만) (c) LyricsResult 작곡 진입 handleSaveAndCompose `user_edit`(:106-110) (d) MusicGeneration 가사 확인 `user_edit`(:338-343, trim) (e) musicService 생성 직전 `user_edit`(:250-257) + `lyricsVersionId || getLastLyricsVersionId()` 폴백.
  - ② **dedupe**: `lastLyricsText === trimmed`면 서버 호출 없이 기존 id 반환(:248-251) — 무수정 사용자의 (b)~(e) 연쇄가 버전 1개(ai_draft)로 수렴하는지 논리 확인. 체인: `prev_version_id: lastLyricsVersionId || null`(:258) — ai_draft가 루트(prev null), 이후 순차 연결.
  - ③ **생성 body 동봉**: musicService body에 `session_id`·`lyrics_version_id`(:295-297, undefined 시 키 생략) — 발매 payload에도 동일 쌍+`getLastLyricsVersionId()`(:427-428). Wondera 경로(generateWithWondera)는 이번 미계측 — 동봉 코드가 Suno 경로에만 있는지(있어야 정상 — Wondera 확장은 후속 기록).
  - ④ **엣지 기록**: mount 시 generatedLyrics 공백이면 ai_draft 미커밋 → 첫 user_edit이 루트가 됨(:247 빈 텍스트는 기존 id 반환) / 보관함 가사(lyricsSource) 직행 시 source가 'user_edit'으로 기록됨 — 둘 다 FAIL 아닌 알려진 한계로 기록(origin 태깅 후속).
- Then: ①~③ 충족, ④ 기록.

**U-6. MusicResult 계측 — LISTEN/CANDIDATE_SELECT/flush [unit]**
- Given: §6.2/§6.3/§6.4 — "A 전체·B 10초·A select" 재구성 가능해야 하고, 명시적 선택만 기록한다.
- When/Then (`screens/MusicResultScreen.tsx`):
  - ① **candidate_id 규약**: `candidateId(index) = "${store.generationId}:v${index}"`(:138-140) — 백엔드 GEN_RESPONSE `f"{gen_id}:v{index}"`와 문자열 규약 일치. **주석 자인 리스크**(:137 "generationId가 트랙 id로 덮인 경우"): 폴링 완료 후 generationId가 result_track_id로 치환되는 경로가 실존하는지 grep(`setGenerationId` 호출처 전수) — 치환 후 계측 이벤트의 candidate_id는 서버 후보와 불일치(FINALIZE 훅은 경고만이라 발매는 통과) → 실존 시 **알려진 결함으로 기록**하고 A-3 SQL에 대조 항목 포함(수정은 후속 사이클 — 이번 게이트 FAIL 아님, 단 결과 보고 필수).
  - ② **LISTEN 4지점**: 재생 toggle play/pause(:328-337, position 동봉), 자연 종료 ended(:206-208 — didJustFinish 분기), variant 전환 시 재생 중이던 후보 pause(:348)+전환 후 자동 재생 play(:220-222, 위치 0), seek 미기록(진행바 비인터랙티브 — :143-145 주석 근거 확인). **stale closure 검사**: ended를 기록하는 onPlaybackStatusUpdate 콜백의 봉인 effect가 selectedVariant 변화에 재등록되는지(deps 확인 — 재등록 없으면 B 청취 종료가 A로 기록되는 오귀속, FAIL).
  - ③ **CANDIDATE_SELECT**: `action:'select'`만(:159 — reject/unselect 미기록 주석 §6.3 정합, rating류 예약 필드 미전송). 기록 지점 2종: 카드 탭 handleVariantSelect(:358-360)+발매 직전(:431·커버 경유) — 중복 select 허용(마지막이 최종, §6.3 위반 아님 — 기록).
  - ④ **flush 3지점**: 화면 이탈 cleanup(:287-293), 발매 직전 await(:432-437), 커버 경유 발매 직전(:505-510) — 발매 flush가 **upload-from-generation POST보다 앞**(청취·선택이 체인에서 FINALIZE 앞에 놓임 — 순서 역전 시 §6.4 재구성 훼손 FAIL).
  - ⑤ **track_type**: `store.creationMode === 'copyright' ? 'copyright_ready' : 'standard'`(:423·커버 경유 :502) — 서버 화이트리스트 2값과 정합. `grep -rn "copyright_intent" /Users/pearl/TripleJ/2_housing --include="*.ts" --include="*.tsx"` **0건**(초안 값 잔존 검사), `grep -rn "track_type" 2_housing` 결과가 위 2지점+주석뿐.
- Then: ①은 grep 결과에 따라 기록/통과, ②~⑤ 충족.

**U-7. ② 모드 토글 — lyricist 한정·문구 금지선 [unit]**
- Given: 구현은 PLAN §3 1안이 아닌 **작사 디렉터 대화 상단 토글**(2안 조기 반영 — 사용자 원구상 "생성 시점부터 분기"). copyright_ready가 실선택 가능해졌으므로 **문구 금지선(F7 §9)이 유일한 법적 가드**다.
- When/Then (`screens/DialogueScreen.tsx`):
  - ① **lyricist 한정**: modeBar 렌더 조건 `directorType === 'lyricist'`(:440) — 작곡·아티스트·영상 등 타 디렉터 대화에 미노출. handleCreationModeSelect(:208-219)는 동일 모드 재탭 no-op.
  - ② **1회 안내**: `copyrightModeNoticeShown` 모듈 플래그(:74) — copyright 최초 선택 시만 showAlert(**앱 내 다이얼로그 — 시스템 Alert 발견 시 즉시 FAIL**, app-popup-design-rule). 본문(:214-216)이 사실 서술만: "과정이 기록됩니다"·"증빙 자료 생성 기능은 정식 프로모션 때 제공 예정".
  - ③ **문구 금지선 grep(핵심 게이트)**: `grep -rn "등록 가능\|등록을 보장\|등록 보장\|등록이 보장\|등록이 인정\|등록 인정\|특허" screens/DialogueScreen.tsx screens/MusicResultScreen.tsx constants/consentTexts.ts components/TrackShareDownloadSheet.tsx screens/SettingsScreen.tsx stores/musicStore.ts` → **노출 문자열 0건**(주석 내 존재는 허용 — 노출 여부로 판정). "저작권 등록 모드" 라벨 자체는 단정 표현이 아니라 통과시키되, 사용자 카피 리뷰 대상으로 기록(설계 주의점 8).
  - ④ **칩·간섭**: copyright 모드에서만 recChip(:463-468) — 점은 벡터 View(이모지 금지 준수), modeBar `pointerEvents="box-none"`(:441)+zIndex 30 — 대화 탭 전진·v3.199 headerLeft(부모 스택 헤더)와 히트 영역 비간섭(정적: 절대배치 top 12가 헤더 밖·오버레이 탭 영역과 분리 구조 확인, 실측은 E-3).
  - ⑤ **sticky 기록**: creationMode는 리셋 없음(musicStore 주석 :43-44 자인) — 한 번 copyright 선택 후 **다음 곡도 조용히 copyright_ready로 발매**됨. 토글 UI는 작사 대화에만 있어 작곡 직행 흐름에선 되돌릴 접점이 없다 — FAIL 아닌 **UX 리스크 기록**(설계 주의점 7, 실기기 E-3 ⑤에서 확인).
- Then: ①~④ 충족(③ 0건 필수), ⑤ 기록.

**U-8. F6 고지 3지점 [unit]**
- When/Then:
  - ① **공유/다운로드 시트**: TrackShareDownloadSheet 타이틀 아래 "이 곡의 음성은 AI로 합성되었습니다."(caption·muted — 전 곡 공통 근거 주석 v3.171 뱃지 전제) + styles.sub 마진 xs 조정이 레이아웃 회귀 없는지(aiNotice가 marginBottom md 승계).
  - ② **발매 완료**: handleSave 성공 showAlert가 `store.vocal` 분기(:461-466) — 보컬 곡만 2줄째 고지(§8 "보컬 포함 곡" 요건 정합·inst 곡 불필요 고지 억제). 커버 경유 발매 완료 알림에도 동일 분기 존재 여부 확인 — 부재 시 경로 간 고지 불일치 **기록**(법정 고지 커버리지 갭 — 후속 수정 권고).
  - ③ **설정 상시 확인**: SettingsScreen policy 유니언 'ai' + 앱 정보 섹션 "AI 생성 고지" 행(:601-608) → PolicySheet 재사용, title/body 삼항이 로그인·비로그인 **양쪽 PolicySheet 인스턴스 모두** 확장됨(:875-880·:893-899 — 한쪽만이면 시트 열린 채 상태 전환 시 잘못된 본문). consentTexts `AI_GENERATION_NOTICE`(:216-225)가 `CONSENTS.overseas.body` 전문 재사용 + 신설 요약 2줄이 사실 서술만.
- Then: ①·③ 충족, ② 분기 확인+커버 경유 기록.

**U-9. diff 격리 [unit]**
- When: ① `cd /Users/pearl/TripleJ/2_housing && git diff --stat -- .` — **콘텐츠 diff가 허용 9 tracked 파일뿐**(그 외 전부 `| 0` mode-only 또는 바이너리 — v3.199 관행대로 분리 판정, v3.200 위반 아님). ② `git status --porcelain -- . | grep '^??'`에 `services/creationLogService.ts` — **커밋 스테이징에 반드시 포함**(untracked라 diff에 안 잡혀 누락되기 쉬움 — 누락 커밋 = 앱 전 화면 import 깨짐 즉시 FAIL급). ③ 백엔드: 로컬 `/Users/pearl/TripleJ-backend` 콘텐츠 diff 0(v3.200 백엔드는 서버 직배포 — 로컬 접촉 시 발산 오염). ④ 커밋은 허용 10파일 명시 스테이징(mode-only 제외).
- Then: ①~④ 충족.

**U-10. v3.191~199 무회귀 — 접촉 파일 라인 단위 [unit]**
- Given: 이번 접촉 파일들의 이력 중첩 — MusicResultScreen(v3.93 A/B·v3.104 커버 보관함·BUG-3 보상 가드), DialogueScreen(v3.199 headerLeft 주입/복원), SettingsScreen(v3.199 seedColor·v3.92 아바타), LyricsResult(v3.127 서버 가사 자산), MusicGeneration(v3.94 피로도), TrackShareDownloadSheet(v3.196 insets), musicService(v3.177 V6 기본 모델·v3.91 참고 음악).
- When/Then (앵커 재탐색):
  - ① **v3.93/v3.104/BUG-3**: MusicResult A/B 비교 조건·variants 조회·pendingPlayRef 전환 로직·libraryCover 소비·grantReleaseRewards 호출 위치 diff 0(계측은 삽입만 — 기존 라인 수정 발견 시 FAIL). 발매 payload 기존 필드(variant_index·lyrics_id·cover_object_name) diff 0.
  - ② **v3.199 B**: DialogueScreen useFocusEffect headerLeft 주입+cleanup 쌍 diff 0(이번 diff는 import showAlert+모드 토글 블록+styles뿐인지 hunk 전수). LyricsInput·ComposerInput 무접촉(허용 파일 밖).
  - ③ **v3.199 A**: SettingsScreen seedColor import·아바타 폴백 diff 0 — 이번 diff는 policy 유니언+행 1개+PolicySheet 삼항 2곳뿐.
  - ④ **v3.127/v3.94**: LyricsResult handleSaveToBook·중복 저장 가드 diff 0 / MusicGeneration 피로도 게이트·대화 시퀀스 diff 0(세션 useEffect·가사 커밋 삽입만).
  - ⑤ **v3.177/v3.91**: musicService suno_model V6 기본·reference_audio_* 필드 diff 0(session_id 2필드 추가만). generateWithWondera 무변경.
  - ⑥ **v3.196**: TrackShareDownloadSheet KAV/insets 구조 diff 0(고지 1줄+마진뿐).
  - 위반 시 해당 버전 TESTPLAN 항목 재실행 승격.

### [unit-서버] 배포 서버 정적 검증 — 오케스트레이터 ssh 읽기 전용

> 실행 주체: 오케스트레이터(기존 서버 접속 절차·backend_9004만·읽기 전용 — cat/grep/python 검증 스크립트만, 재시작·수정 금지). 로컬 워크트리엔 해당 파일이 없으므로 반드시 원격에서 읽는다.

**S-1. 해시 체인 구현 = 부록 B 문자 그대로 [unit-서버]**
- When: 서버 `app/services/creation_log.py` 열람 — ① `canonical`: `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")` **파라미터 3종 문자 일치**(ensure_ascii=True로 바꾸면 한글 payload 해시가 문서 참조 구현과 달라져 외부 검증기와 영구 불일치 — 1글자 게이트). ② `event_hash`: material이 `"\n".join([session_id, str(seq), type, actor, server_ts, payload_hash, prev_hash])` — **7항 순서·구분자 `\n` 고정**, server_ts 직렬화 형식(ISO 문자열)이 저장값과 동일 소스인지(재직렬화 경로가 둘이면 검증 불일치). ③ 첫 이벤트 prev_hash `"0"*64`, 세션 FINALIZE 시 root_hash = 마지막 event_hash. ④ `user_id_hash = SHA256(user_id + salt)` — salt는 `CREATION_LOG_SALT` env 참조(하드코딩 fallback 값이 있으면 기록 — 배포 .env 설정 여부는 A-2 인용과 대조). ⑤ 자기검증(배포 시 통과 보고됨)이 코드에 어떤 형태로 있는지 인용 확보(재해시 왕복 함수 — A-3 검증 스크립트가 이것을 재사용 가능한지 확인).
- Then: ①~③ 문자 일치 필수, ④·⑤ 확인·인용.

**S-2. append 직렬화·불변 보장 [unit-서버]**
- When: ① append 경로에 **세션 단위 PG advisory lock**(`pg_advisory_xact_lock` 계열, 키=세션 id 해시) — seq 부여·prev_hash 읽기·INSERT가 한 락 구간 안(락 밖 seq 계산이면 동시 배치에서 UNIQUE 충돌 또는 체인 분기). ② DDL: events `UNIQUE(session_id, seq)`+§5.4 최소 컬럼 전부, sessions·lyrics_versions 컬럼 §5.4/§7.3 대비(criteria_version·parent_session_id 예약 필드 포함), lifespan `CREATE ... IF NOT EXISTS` 멱등. ③ `event_id` 중복 수신 무시(idempotent) 구현 — ON CONFLICT 또는 사전 SELECT. ④ UPDATE/DELETE 권한 분리(§5.4)는 이번 비범위(PLAN 후속) — 미구현이 정상, 구현 시도 흔적이 있으면 오히려 prod 승인 규칙 위반으로 기록.
- Then: ①~③ 충족, ④ 비범위 확인.

**S-3. API 계약 — 관대/엄격 이원화·409·FINALIZE 검증 이원화 [unit-서버]**
- When: 서버 `app/routes/sessions.py` — ① POST /sessions: 관대 스키마(구버전·확장 수용 — extra 허용), import_blocked **false 고정**(§4.3 실측 근거: 참고 음악 업로드 존재 — true 하드코딩 발견 시 허위 플래그 FAIL). ② POST /sessions/{id}/events: 봉투형 `{"events":[...]}` 필수, 이벤트 모델 **extra forbid**(Pydantic `model_config`/`Config` extra 금지 확인), type 화이트리스트(LISTEN/CANDIDATE_SELECT/LYRIC_EDIT — 앱이 SESSION_START류를 보내면 400), 배치 ≤500 검증, **FINALIZED 세션 409**(§15-5), client_seq 기준 서버 seq 부여. ③ POST /sessions/{id}/lyrics: `source·text·prev_version_id` 3필드, origin_summary NULL(후속). ④ **FINALIZE 검증 이원화**: sessions.py(또는 finalize API)의 candidate 존재 검증은 엄격(§4.4), tracks.py upload-from-generation **훅은 경고 기록 후 발매 진행**(구버전 호환 — 발매 차단 코드 발견 시 하위호환 FAIL). ⑤ tracks.py track_type 화이트리스트 `{'standard','copyright_ready'}` — 그 외 값 거부 또는 standard 폴백 어느 쪽인지 인용(앱 U-6 ⑤와 대조), 미전송(구버전) 시 기본 'standard'.
- Then: ①~⑤ 충족·인용.

**S-4. generate/suno_generator — 전문·해시·실패 기록 [unit-서버]**
- When: ① generate.py create가 session_id optional — 무세션 요청 시 **서버 자동 세션 생성**(SESSION_START 서버 기록, 구버전 앱 정상 — §4.4 "세션 없이 거부"의 의도적 완화 근거 주석 확인). ② 엔진 호출 직전 GEN_REQUEST(request_body_hash — seed·callBackUrl·시각류 제외 canonical, is_regeneration_of 소급용), 폴링 완료 후 generations doc에 `suno_request_body`·`suno_response_raw`·variant별 `audio_sha256`·`requested_at/responded_at` $set. ③ **audio_sha256이 MinIO put 직전 원본 bytes 기준**(재인코딩·변환 경로 부재 — §3.1 재인코딩 금지 유지). ④ **실패·타임아웃도 GEN_RESPONSE(status=failed)**(§3.3 — 성공 경로에만 이벤트가 있으면 FAIL). candidates `candidate_id = f"{gen_id}:v{index}"` — 앱 U-6 ① 규약과 문자 일치. ⑤ 오디오 저장 실패 시 응답 보류·재시도(§3.3 "앱에는 갔는데 원본은 없는 상태 금지") 처리 여부 — 미구현이면 기록(후속 후보).
- Then: ①~④ 충족, ⑤ 확인·기록.

### [api] — 오케스트레이터 실행 명시 + 실사용 스모크 이관

**A-1. 무인증 401 [api] — 완료(재확인만)**
- 배포 직후 오케스트레이터 실측 완료 보고 인용: 무인증 POST /api/sessions → 401. 재확인 1회: `curl -s -o /dev/null -w '%{http_code}' -X POST https://<9004 베이스>/api/sessions -H 'Content-Type: application/json' -d '{}'` → 401(토큰 없이 절대 기록 불가 확증).

**A-2. 스키마 배포 확인 [api] — 완료(인용)**
- 배포 로그 인용으로 갈음: lifespan에서 PG `creation_log` 스키마(sessions·events·lyrics_versions) 멱등 생성 확인됨. 결과표에 해당 로그 라인 인용을 남길 것 + `CREATION_LOG_SALT` env 설정 확인(S-1 ④ 대조 — salt 미설정 fallback 가동이면 기록).

**A-3. 실사용 스모크 — 실기기 이관(Suno 실과금) + 검증 SQL/명령 [api]**
- **이관 사유**: 곡 생성 1회 = Suno 실비용. 오케스트레이터가 곡을 굽지 않는다 — 사용자 실기기에서 생성 1회(작사→작곡→A/B 청취→발매) 후, 오케스트레이터가 아래를 서버에서 실행해 체인을 검증한다.
- **검증 절차(생성·발매 1회 후)**:
  1. 세션·체인 존재: `SELECT session_id, status, root_hash, final_candidate_id, final_lyrics_version_id, import_blocked FROM creation_log.sessions ORDER BY started_at DESC LIMIT 3;` → 최신 세션 status=FINALIZED·root_hash NOT NULL·import_blocked=false.
  2. 이벤트 시퀀스: `SELECT seq, type, actor, left(prev_hash,8) AS prev8, left(event_hash,8) AS hash8, client_ts, server_ts FROM creation_log.events WHERE session_id='<위 id>' ORDER BY seq;` → seq 1..N 무결점(구멍 0), 순서: SESSION_START(1, prev8='00000000') → GEN_REQUEST → GEN_RESPONSE → LISTEN들 → CANDIDATE_SELECT → (LYRIC_EDIT들 산재) → FINALIZE(마지막), 각 행 prev8 = 직전 행 hash8.
  3. 재해시 대조(부록 B): `SELECT json_agg(row_to_json(e) ORDER BY seq) FROM creation_log.events e WHERE session_id='<id>';` 출력을 부록 B `verify_chain` 스크립트(문서 :400-421 그대로, 또는 S-1 ⑤에서 확보한 서버 자기검증 함수 재사용)에 투입 → `(True, None)` + 마지막 event_hash == sessions.root_hash. **주의: server_ts는 저장된 문자열 표현 그대로 투입**(재포맷 시 거짓 불일치 — S-1 ② 확인 사항).
  4. 가사 체인: `SELECT lyrics_version_id, prev_version_id, source, left(md5(text),8), created_at FROM creation_log.lyrics_versions WHERE session_id='<id>' ORDER BY created_at;` → 루트 source='ai_draft'(prev NULL)·이후 user_edit 연결, FINALIZE payload의 lyrics_version_id가 마지막 버전과 일치(§7.5).
  5. Mongo 전문: `mongosh aimu --eval 'db.generations.find({session_id:"<id>"},{suno_request_body:1,suno_response_raw:1,"variants.audio_sha256":1,requested_at:1,responded_at:1,track_type:1}).pretty()'` → 전문 2종·variant별 sha256·타임스탬프 존재. tracks doc의 track_type이 앱 선택 모드와 일치.
  6. **candidate_id 대조(U-6 ① 연동)**: LISTEN/CANDIDATE_SELECT payload의 candidate_id들이 GEN_RESPONSE candidates[].candidate_id 집합에 전부 포함되는지 — 불일치 발견 시 U-6 ①의 generationId 치환 결함 실증(결과 보고·후속 수정 발제).
- 실패 생성(엔진 실패·타임아웃) 케이스: 실기기에서 의도 유발이 어려우므로 **자연 발생 대기**(발생 시 GEN_RESPONSE status=failed 행 확인) — S-4 ④ 정적 확인으로 갈음.

### [e2e] §15 시나리오 축약판 — 실기기 이관 + 정적 대체 병기

**E-1. §15 시나리오 1 축약판 — 청취·선택·가사·발매 전 과정 재구성 [e2e] — 실기기+서버 검증 조합**
- 원문 축약(과금 최소화 — 생성 3회→1회, 재생성 생략): 새 곡(작사 디렉터) → AI 가사 초안 → 가사 3행 이상 수정('완료' 토글) → 작곡 대화 → 생성 1회(후보 2개) → **후보 A 끝까지 청취 → B 10초만 청취 → A 카드 선택** → 발매.
- 기대(서버 A-3 절차로 판정): 세션 1개 FINALIZED, 이벤트 대략 10~20건, 가사 버전 ≥2(ai_draft→user_edit), LISTEN 재구성 "A 전체(play→ended), B 부분(play→pause ~10s), A select"(§6.4), FINALIZE.candidate_id=A·trigger='publish', 체인 재해시 전량 일치. 재청취 시 play~ended 구간 2개로 구분.
- 정적 대체: U-2·U-5·U-6 + S-1~S-4(계측 지점·체인 구현의 코드 실존으로 갈음). **§15-2(오프라인 큐)·§15-3/4(변조 검출 F9)는 이번 슬라이스 비범위**(메모리 큐 유실 허용·F9 후속 — PLAN §2) — 시도하지 말고 후속 이월 명기.

**E-2. §15 시나리오 5 — FINALIZED 세션 409 [e2e] — 서버 단독 실행 가능**
- When: E-1 완료 후 오케스트레이터가 FINALIZED 세션에 이벤트 업로드: `curl -X POST .../api/sessions/<id>/events -H 'Authorization: Bearer <테스트 계정 토큰>' -d '{"events":[{"event_id":"<uuid>","client_seq":999,"type":"LISTEN","client_ts":"<now>","payload":{"candidate_id":"x","action":"play","position_ms":0}}]}'` (토큰은 사용자 제공 테스트 계정 — 증적에 마스킹).
- Then: **409** + 체인 불변(A-3 ③ 재실행 시 동일 root_hash). 앱 측 대응: U-2 ⑤(409 즉시 폐기·재시도 없음)로 앱이 409 폭주를 만들지 않음을 정적 확인. 발매 후 화면 잔류 중 pause 등 늦은 이벤트가 409로 소실되는 것은 알려진 한계(endCreationSession이 큐를 비워 실제 발생 희박 — 기록).

**E-3. ② 모드 토글 여정 [e2e] — 실기기 이관 + 정적 대체 병기**
- When/Then: ① 작사 디렉터 진입 — 상단 토글(일반/저작권 등록) 노출·기본 '일반', **타 디렉터(작곡·영상 등) 대화엔 미노출** ② 저작권 등록 탭 — 앱 내 다이얼로그 1회 안내(문구가 U-7 ③ 금지선 준수·재탭 시 안내 재출현 없음)·"창작 과정 기록 중" 칩 점등 ③ 토글이 대화 진행·v3.199 뒤로가기 화살표와 히트 간섭 없음(대화 탭 전진 정상) ④ 그 상태로 발매 → A-3 ⑤에서 track_type='copyright_ready' 확인, 일반 모드 곡은 'standard' ⑤ **sticky 실측**: 발매 후 새 곡 시작 — 모드가 copyright로 남아 있는지 확인하고 사용자에게 의도 부합 여부 질의(U-7 ⑤ 연동 — 비의도면 후속 리셋 정책 발제) ⑥ F6: 공유 시트 고지 1줄·보컬 곡 발매 완료 고지·설정>앱 정보>AI 생성 고지 열람.
- 정적 대체: U-7·U-8 전 항목.

### 태그 집계
- [unit] 10건 (U-1 tsc / U-2 이벤트 계약 6필드·봉투·500분할·순서 / U-3 no-op 게이트·기능 비차단 전수 / U-4 세션 생명주기 / U-5 가사 커밋 5지점·dedupe / U-6 MusicResult 계측·candidate_id·flush / U-7 모드 토글·문구 금지선 / U-8 F6 고지 3지점 / U-9 diff 격리·untracked 스테이징 / U-10 v3.191~199 무회귀)
- [unit-서버] 4건 (S-1 부록 B 문자 일치·salt / S-2 advisory lock·DDL·idempotent / S-3 API 관대·엄격·409·FINALIZE 이원화·track_type / S-4 generate 전문·SHA-256·실패 기록) — 전부 오케스트레이터 ssh 읽기 전용
- [api] 3건 (A-1 무인증 401 완료+재확인 / A-2 스키마 배포 인용 / A-3 실사용 스모크 — Suno 과금으로 실기기 이관, 검증 SQL 6단계 명시)
- [e2e] 3건 (E-1 §15 시나리오 1 축약 — 실기기+서버 SQL 조합 / E-2 §15 시나리오 5 — 409, 서버 단독 / E-3 모드 토글 여정 — 실기기 이관+정적 대체)

### 설계 주의점 (tester·오케스트레이터·사용자 참고)
1. **로컬 백엔드 워크트리에 v3.200 코드가 없다(실측)**: `/Users/pearl/TripleJ-backend/.../backend_9004`에 creation_log.py·sessions.py 부재, tracks.py에 track_type 부재. [unit-서버] 전 항목은 **배포 서버 원격 읽기**로만 유효하고, 로컬 diff·grep으로 대신하면 전부 거짓 통과가 된다. 서버 편집분의 git 반영(backend 브랜치 동기화) 잔무를 결과 보고에 반드시 포함할 것.
2. **canonical 1글자가 전체를 가른다**: S-1 ①의 `ensure_ascii=False`·separators가 부록 B와 다르면 한글 payload에서 해시가 갈려 "구현은 일관되게 틀린" 상태가 된다 — 자기검증은 통과하면서 외부(문서 기준) 검증기와는 영구 불일치. 판정은 반드시 **문서 부록 B 원문과의 문자 대조**로, 서버 자기검증 통과 보고를 근거로 삼지 말 것. server_ts 문자열 표현도 동일 원리(저장값 그대로 재해시 — A-3 ③ 주의).
3. **candidate_id 치환 리스크는 이번 사이클의 1순위 관찰 대상**: 앱 주석이 스스로 "generationId가 트랙 id로 덮인 경우"를 인정한다(U-6 ①). 덮인 뒤의 LISTEN/SELECT는 서버 후보 집합과 불일치하고, FINALIZE 훅이 경고만 하므로 **아무 에러 없이 재구성만 조용히 깨진다**. 정적(setGenerationId 호출처 grep)과 실측(A-3 ⑥ 대조)을 반드시 둘 다 수행하고, 불일치 실증 시 후속 수정(계측용 원본 gen_id 별도 보관)을 발제할 것.
4. **"기록이 기능을 막지 않는다"가 제1 불변식**: U-3 ③의 호출부 전수 감사가 이번 계획의 핵심 게이트다. 이번 diff는 재생·발매·가사 편집이라는 대표 수익 경로 한복판에 11개 계측점을 심었다 — catch 없는 await 1개가 곧 "기록하려다 발매를 죽이는" 사고다(hot-reload 가사 유실 사고의 교훈: 사용자 생성물 경로는 방어 우선).
5. **발매 전 flush의 최악 지연 ~51초**: await flush(15s 타임아웃×3회+백오프)가 발매 버튼과 스피너 사이에 있다. 서버 장애 시 발매가 이만큼 늦어질 수 있다 — FAIL 기준은 아니나(발매 자체는 결국 진행) 수치를 결과에 남겨 후속(타임아웃 단축 또는 비동기화) 판단 근거로 삼을 것.
6. **§15의 2·3·4번 시나리오는 의도적 비범위**: 오프라인 영속 큐(§15-2)는 메모리 큐 슬라이스라 유실 허용이 확정 사양이고, 변조 검출(§15-3/4)은 F9(후속)의 몫이다. 이걸 이번에 검증하려 들면 사양에 없는 FAIL을 만든다 — E-1에 명기해 둔 이유. 반대로 **§15-5(409)는 이번 범위**이고 서버 단독으로 싸게 실측 가능하다(E-2).
7. **creationMode sticky는 설계 선택이지만 접점이 비대칭**: 켜는 토글은 작사 대화에만 있는데 효과(track_type)는 모든 발매에 미친다. 작사 없이 작곡 직행하는 곡도 이전 선택을 승계한다 — E-3 ⑤에서 사용자 의도를 확인하고, 비의도면 "발매 시 유형 표시/변경" 후속(PLAN §3 1안의 카드 UI)을 발제.
8. **문구 금지선은 노출 문자열 기준으로 판정**: 주석·변수명의 '저작권'은 무해하다. grep 히트를 노출/비노출로 분류해 판정할 것. "저작권 등록 모드"라는 라벨 자체는 단정 표현이 아니라 통과시키되, '등록'이라는 단어가 주는 기대 수준을 사용자 카피 리뷰 대상으로 기록(안내 팝업이 "제공 예정"으로 눌러주고 있는 구조까지 세트로 인용).
9. **untracked 신규 파일이 커밋 누락 1순위**: creationLogService.ts는 `git diff`에 안 잡힌다(U-9 ②). 9파일만 스테이징하면 앱이 import 실패로 전면 깨진 채 커밋된다 — frontend 자동 push 규칙과 결합하면 깨진 코드가 즉시 원격에 올라간다. 커밋 전 `git status --porcelain -- 2_housing | grep '^??'` 확인을 절차화할 것.
10. **테스트 비용 경계**: 곡 생성이 곧 과금이므로 [api]/[e2e]의 생성 횟수는 총 1~2회로 설계했다(E-1 축약이 A-3 스모크를 겸함 — 별도 생성 금지). is_regeneration_of(§3.4 "3회 생성" 수용 기준)는 request_body_hash가 이번부터 쌓이므로 **소급 판정 가능** — 실측은 후속 사이클로 미루고 이번엔 해시 저장 존재(S-4 ②)만 본다.

### v3.200 테스트 결과 (tester, 2026-09-21)

| 항목 | 판정 | 근거 요약 |
|---|---|---|
| U-1 타입 무결성 | PASS | `npx tsc --noEmit` exit 0, 오류 출력 0줄 |
| U-2 이벤트 계약(앱 측 형태) | PASS* | 6필드 정확(QueuedEvent :26-33, actor/seq/server_ts 부재)·target 조건부 스프레드(:222, null 대입 없음)·봉투형 `{events}`(:157)·lyrics 3필드(:255-259, trim+prev null)·sessions 5필드+creation_mode 미전송 주석(:103-106)·500 분할 순차 for-await 무손실(:148-153)·`++clientSeq`(:219)+리셋 2곳(:111/:133)·단일 sessionStartPromise 공유(:93)로 등록 순서 보존·flush 선행 배치 await(:179)·재시도 3회 백오프 1s/2s(:170)·400/409 즉시 폐기(:164-168). *단 서버 대조에서 X-1 계약 불일치 발견(아래) — 앱 측 형태 자체는 계획 명세와 일치 |
| U-3 no-op 게이트 | PASS | 404/401만 게이트(:66-72)+진입점 3곳 즉시 return·비로그인 사전 차단(:92, 요청 없이 null)·**호출부 11지점 전수: catch 없는 await 0건** — (a) fire-and-forget .catch 6곳(LyricsResult 3·MusicGeneration 2·MusicResult cleanup) (b) try/catch 3곳(musicService :252-260 — `await ensureCreationSession()` try 안, MusicResult 발매 flush 2곳) (c) 동기 void 2곳. ④ 발매 전 flush 최악 지연 실측 산정: 1배치 = 15s×3회+백오프 1+2s = **~48s**, 선행 배치 진행 중이면 이론상 ~96s (설계 주의점 5 — 수치 기록, FAIL 아님) |
| U-4 세션 생명주기 | PASS | idempotent(:91 즉시 반환·:93 promise 공유)·종료 2경로 모두 성공 블록 안(handleSave :458-460, 커버 경유 :523-525 — 실패 시 세션 유지)·store 동기화 쓰기 2지점뿐(:114/:138). ④ 기록: 발매 없이 새 곡 시작 시 이전 세션 승계(ABANDONED 배치 후속) — A-3 ①에서 세션-곡 대응 확인 |
| U-5 가사 커밋 | PASS | 5지점 실존: ai_draft mount(:51-58, hasError·빈 가사 가드)/완료 토글(:211-216, isEditingLyrics 시만)/handleSaveAndCompose(:107-110)/MusicGeneration 확인(:340-343, trim)/musicService 직전(:253-257)+getLastLyricsVersionId 폴백. dedupe(:248-251)·체인 prev(:258)·생성 body 동봉(:296-297, undefined 생략)·발매 payload 동일 쌍(:425-426/:504-505). Wondera 미계측(Suno 경로만 — 정상). ④ 엣지 2건 기록(빈 초안 시 user_edit 루트/보관함 가사 source 문제 — origin 태깅 후속) |
| U-6 MusicResult 계측 | PASS(① 결함 기록) | ① **generationId 치환 실존 확정**: MusicLoadingScreen :139·:278 `if (trackId) store.setGenerationId(trackId)` — status.result_track_id 존재 시 트랙 id로 덮임 → 이후 candidate_id가 서버 후보 집합과 불일치(발매는 FINALIZE 훅 경고만으로 통과). 신규 생성 직후엔 result_track_id 부재라 정상 경로 무손상 — **알려진 결함 기록, A-3 ⑥ 대조 필수, 후속: 계측용 원본 gen_id 별도 보관**. ② LISTEN 4지점(:328-337/:205-208/:349·:359 pause/:217-223 자동 play)+seek 미기록 주석(:145-146)+stale closure 없음(effect deps :246에 selectedVariant 포함, mounted 가드 :201) ③ select만(:159)·2지점(:360/:432·:508) ④ flush 3지점, 발매 flush가 upload POST(:440/:514)보다 선행 ⑤ track_type 2지점뿐(:423/:503)·copyright_intent 0건 |
| U-7 모드 토글 | PASS | lyricist 한정(:440)·재탭 no-op(:209)·1회 안내 모듈 플래그(:74)+showAlert(utils/appAlert — 앱 내 다이얼로그 ✓)·본문 사실 서술만(:214-216)·**금지선 grep 히트 1건 = :73 주석(비노출) → 노출 문자열 0건 PASS**·recChip 벡터 점(:464-467)·modeBar box-none+zIndex 30, top 12 절대배치(헤더는 부모 스택 — 간섭 없음, 실측은 E-3). ⑤ sticky 기록: musicStore :45 주석 자인 — 작곡 직행 시 되돌릴 접점 없음(E-3 ⑤ 사용자 질의) |
| U-8 F6 고지 | PASS(② 갭 기록) | ① 시트 고지 1줄(:170-171 caption/muted)+sub 마진 md→xs·aiNotice md(레이아웃 회귀 없음 — 순수 삽입+마진 1건) ② handleSave vocal 분기(:462-466) ✓ / **커버 경유 발매는 완료 알림 자체가 없어 고지 부재 — 법정 고지 커버리지 갭 기록(후속 수정 권고)** ③ policy 'ai' 유니언(:435)+행(:601-607)+PolicySheet 양쪽 삼항(:877-879/:898-900)·AI_GENERATION_NOTICE = overseas.body 전문 재사용+요약 2줄 사실 서술(:217-225) |
| U-9 diff 격리 | PASS | ① 콘텐츠 diff = 허용 9 tracked 파일뿐(그 외 75건 전부 mode-only `|0`/바이너리 — v3.199 관행 분리 판정) ② `?? 2_housing/services/creationLogService.ts` 확인(untracked 총 668건 중 커밋 대상은 이 1건 — **명시 스테이징 필수**) ③ 로컬 TripleJ-backend `git status --porcelain` 콘텐츠 변경 0 ④ 커밋 시 10파일 명시 스테이징 절차 확인 |
| U-10 무회귀 | PASS | 3화면 diff에서 삭제/수정 기존 라인 3건뿐: LyricsResult import 확장·완료 토글 onPress 계측 래핑(setIsEditingLyrics 토글 보존)·MusicResult showAlert vocal 분기(F6 의도 변경). v3.93/104/BUG-3(A/B·variants·pendingPlayRef·libraryCover·grantReleaseRewards·기존 payload 필드)·v3.199 A/B(headerLeft·seedColor)·v3.127/94·v3.177/91(suno_model·reference_audio_* 무접촉, generateWithWondera 무변경)·v3.196(KAV/insets) 전부 diff 0 |
| S-1 부록 B 문자 대조 | PASS | ① canonical `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")` — 부록 B :404와 **문자 일치** ② event_hash material 7항 `"\n".join([session_id, str(seq), etype, actor, server_ts, payload_hash, prev_hash])` 순서·구분자 일치, server_ts는 `ts_str()`(UTC `%Y-%m-%dT%H:%M:%S.%fZ` μs 6자리 고정) 단일 소스 — 기록·검증 왕복 바이트 동일 설계 ③ GENESIS `"0"*64`·finalize root_hash=마지막 event_hash ④ salt = settings.creation_log_salt(.env `CREATION_LOG_SALT=` **설정 확인됨** — jwt_secret 폴백 코드는 존재하나 미가동) ⑤ verify_chain(events)이 모듈에 참고 구현 그대로 존재(호출처 없음 — 배포 자기검증은 1회성 스크립트였던 것으로 보임). **A-3 ③ 주의 보강: server_ts는 TIMESTAMPTZ 저장이므로 SQL 출력 문자열이 아니라 서버 `ts_str(dt)` 재변환으로 투입할 것**(PG 텍스트 표기와 해시용 표기가 다름 — 서버측 python에서 creation_log.verify_chain 재사용 권장) |
| S-2 직렬화·불변 | PASS | ① `pg_advisory_xact_lock(hashtext($1), hashtext('creation_log'))` 세션 키 — append_event/append_batch/finalize/commit_lyrics/create_session 전부 트랜잭션+락 구간 안에서 seq 계산·prev 읽기·INSERT ② DDL: events UNIQUE(session_id,seq)+§5.4 13컬럼 전부, sessions에 parent_session_id·criteria_version 예약 포함, lyrics_versions §7.3 대비, CREATE IF NOT EXISTS 멱등 ③ event_id 사전 SELECT dup 체크(락 안 — idempotent) ④ UPDATE/DELETE 권한 분리 미구현 확인(주석으로 후속 명시 — 정상, prod 승인 규칙 준수. events엔 INSERT만, sessions UPDATE는 finalize 설계 범위) |
| S-3 API 계약 | PASS | ① POST /sessions 관대(CreateSessionBody extra 기본 ignore — 앱의 import_blocked/criteria_version 여분 필드 무해 흡수)·import_blocked FALSE 리터럴 INSERT(§4.3 실측 근거 주석) ② events 봉투 필수+EventItem `model_config={"extra":"forbid"}`+raw dict 엄격 검증·타입 화이트리스트 4종(SESSION_START류 400)·≤500·FINALIZED 409 선행·client_seq 정렬 후 서버 seq ③ lyrics 3필드+client_ts 옵션, origin_summary null ④ FINALIZE 이원화: sessions.py `strict_candidate=True` / tracks.py 훅 `strict_candidate=False`+전체 try/except(발매 절대 비차단) ⑤ track_type 화이트리스트 `("standard","copyright_ready")` 그 외 **standard 폴백**(tracks.py :2185), 미전송 기본 standard(:1897) — 앱 2값과 정합 |
| S-4 generate 전문·해시 | PASS(⑤ 기록) | ① session_id optional(:115)+ensure_session 자동 생성(:667-676/:829-834, FINALIZED면 parent 연결 새 세션 — §4.4 완화 근거 주석) ② 엔진 전송 직전 GEN_REQUEST(request_body_hash — REQUEST_HASH_EXCLUDE={"callBackUrl"}, is_regeneration_of·lyrics_input_version_id 동봉)+suno_request_body/hash/requested_at $set·응답 후 suno_response_raw/responded_at/variant별 audio_sha256 $set ③ audio_sha256 = 엔진 수신 바이트 그대로 MinIO put 직전 계산(재인코딩 없음 주석 §16-2) ④ 실패·타임아웃 GEN_RESPONSE status=failed(generate.py :375-392)·candidate_id `f"{generation_id}:v{index}"` 앱 규약과 문자 일치 ⑤ 오디오 다운로드/저장 실패 시 raise → 생성 자체가 failed 처리(스트림 URL 미발급이라 "앱엔 갔는데 원본 없음" 불성립) — 보류·재시도 로직은 미구현, 후속 후보 기록 |
| **X-1 앱↔서버 이벤트 계약 대조** | **FAIL** | **LISTEN/CANDIDATE_SELECT의 candidate_id 위치 불일치 — 이벤트 전량 400 폐기 확정.** 앱(MusicResultScreen :147-151/:159)은 payload에 `candidate_id`를 넣고 target을 아예 안 보냄. 서버(sessions.py)는 ALLOWED_PAYLOAD_KEYS에 candidate_id가 없어 "unknown fields" 400 + `target.candidate_id is required`. 400은 앱이 즉시 폐기(U-2 ⑤)하므로 **기능 무손상·조용한 계측 전멸**(문서 §5.2 정본은 target.candidate_id — 서버가 옳고 앱이 위반). 수정 지시 아래 |
| A-1 무인증 401 | PASS | `POST https://api.maidol.ai.kr/api/sessions` (무인증, `{}`) → **401** 재확인 실측 |
| A-2 스키마 배포 | PASS | docker `maidol-app` 로그 인용: `[migration] creation_log schema ensured`. `.env`에 `CREATION_LOG_SALT=` 존재 확인(값 비출력) — S-1 ④ 폴백 미가동 |
| A-3 실사용 스모크 | 실기기 이관 | 검증 SQL/명령 6단계는 계획에 완전 — 단 ③ 재해시는 위 S-1 판정대로 **서버측 python에서 creation_log.verify_chain+ts_str 재사용**으로 실행할 것(SQL 문자열 직투입 시 거짓 불일치). ⑥ candidate_id 대조는 U-6 ①·X-1 수정 후 실측 필수 |
| E-1 §15-1 축약 | 실기기 이관 | 정적 대체(U-2·U-5·U-6·S-1~S-4) 완료 — 단 **X-1 수정 전에는 LISTEN/SELECT가 서버에 한 건도 안 남아 §6.4 재구성이 성립 불가**. 수정 커밋 후 실기기 1회 생성 진행. §15-2/3/4는 비범위 이월 명기 |
| E-2 §15-5 409 | 부분 실측+정적 | 서버 코드: FINALIZED 체크가 검증·기록보다 선행(sessions.py upload_events) → 409 반환 확정. 무인증·임의 세션 안전 실측: events 엔드포인트 401(인증 선행) 확인. 실세션 409 실측은 E-1 완료 후(테스트 계정 토큰 필요 — 프로덕션 데이터 조작 금지 원칙 준수, 이번 미실행). 앱 409 즉시 폐기(:165-168) 정적 확인 — 409 폭주 없음 |
| E-3 모드 토글 여정 | 실기기 이관 | 정적 대체(U-7·U-8) 완료. 실기기에서 ①~⑥ + sticky 의도 질의(⑤) 수행 |

**게이트 판정: FAIL(조건부) — X-1 수정(앱 2함수, ~4줄) 후 U-2·U-6 해당부 재판정 시 PASS 전환 가능. X-1 미수정 커밋 금지(계측 목적 전멸 상태로 배포됨).**

**X-1 수정 지시(developer)**: `2_housing/screens/MusicResultScreen.tsx` — ① logListen(:142-152): `logCreationEvent('LISTEN', { action, position_ms: ... }, { candidate_id: cid })` — candidate_id를 payload에서 제거하고 3번째 인자 target으로 이동 ② logCandidateSelect(:154-160): `logCreationEvent('CANDIDATE_SELECT', { action: 'select' }, { candidate_id: cid })` 동일 이동. creationLogService의 target 스프레드(:222)·서버 ALLOWED_TARGET_KEYS(candidate_id/segment/item)와 즉시 정합. 수정 후 `npx tsc --noEmit` + U-2 ①(target 조건부 스프레드) 재확인만으로 충분.

**잔여·후속 기록**: ① 서버 v3.200 코드(creation_log.py·sessions.py·generate.py·suno_generator.py·tracks.py·main.py·config.py)가 로컬 TripleJ-backend 워크트리/backend 브랜치에 미반영 — **서버→git 동기화 잔무**(배포 실코드가 유일본인 상태) ② U-6 ① generationId 치환 결함(계측용 원본 gen_id 별도 보관 후속) ③ 커버 경유 발매 F6 고지 부재 ④ creationMode sticky UX(E-3 ⑤ 질의) ⑤ 발매 전 flush 최악 ~48s(선행 배치 시 ~96s) — 타임아웃 단축/비동기화 후속 판단 ⑥ 오디오 저장 실패 보류·재시도(S-4 ⑤) ⑦ "저작권 등록 모드" 라벨 카피 리뷰(설계 주의점 8).

## v3.201 — 수정일 2026-09-21

> 대상: PLAN.md v3.201(:3215-3281) — (A) `components/PlaylistPickerSheet.tsx` 입력 가림 근본 수정: kbPad를 paddingBottom(:108)→sheet **marginBottom**(시트 전체 리프트)으로 이동, kbPad>0 시 `maxHeight` 동적 클램프(`winH - kbHeight - 24` 이하, useWindowDimensions), 목록(:113-122) ScrollView(maxHeight ~240) 전환, kbPad 로직(:27-38)을 `hooks/useAndroidKeyboardLift.ts` 공용 훅으로 추출. (B) 재선택 모달 자유 입력: `screens/LyricsInputScreen.tsx` 모달(:432-452)·`screens/ComposerInputScreen.tsx` 모달(:338-356)에 입력 행 추가, 제출은 **기존 `handleReselectChoice(trim)`(Lyrics :219-248 / Composer :185-209) 재사용**(신규 분기 금지), Lyrics 노출 제외 스텝 {2,8,9}(:393 메인 플로우와 동치), autoFocus 금지, A 훅으로 키보드 리프트. (C) 헤더 뒤로가기 경합: 3화면(Dialogue :104-106·LyricsInput :143·ComposerInput :100) blur cleanup의 `headerLeft: undefined` 제거 → "focused-screen-writes-only" 불변식, `screens/MapScreen.tsx` :292 `headerLeft: undefined` payload 키 삭제 + :296 deps의 `user` identity 제거 + 자체 useFocusEffect focus 클리어 신설. iOS transparentModal(App.tsx :184) 검증 항목화.
> **전제(계획 §0)**: 구현은 **v3.200 커밋 후 착수** — 본 계획의 라인 번호는 계획 시점 워킹트리 실측(앵커 병기, 커밋 후 이동 허용 — 앵커 문자열 재탐색). 특히 DialogueScreen은 v3.200(+113줄 모드 토글)과 같은 파일이라 커밋 후 라인 전면 이동 확실 — **라인이 아니라 앵커로만 판정**.
> 실행 환경 관행(v3.191~200 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 정적 대체 병기 + 실기기 실측 이관. 앱 코드 경로 `/Users/pearl/TripleJ/2_housing`. 백엔드 무접촉 — [api] 0건. 증적에 실계정 토큰·개인 식별 정보 기재 금지.
> 변경 허용 파일(격리 기준): `hooks/useAndroidKeyboardLift.ts`(**신설** — hooks/ 디렉토리 자체가 신설), `components/PlaylistPickerSheet.tsx`, `screens/LyricsInputScreen.tsx`, `screens/ComposerInputScreen.tsx`, `screens/DialogueScreen.tsx`, `screens/MapScreen.tsx` 6개. `App.tsx`(§3-3 iOS 대응 적용 시에만 :184 presentation 1건 허용 — 적용 시 커밋 메시지 명기 필수, 미적용이면 diff 0). 그 외 콘텐츠 diff는 FAIL.

### [unit] 정적 검증 (머지 게이트)

**U-1. 선행 게이트 — v3.200 커밋 확인 + 타입 무결성 [unit]**
- Given: 계획 §0 — v3.200 미커밋 상태에서 착수하면 diff 격리(U-10)가 성립 불가.
- When: ① 착수 전 `git log --oneline -1` + `git status --short`(2_housing 스코프)로 **v3.200 커밋 완료·클린 기준선** 확인(v3.200 4파일 — creationLogService·DialogueScreen·musicStore·musicService — 이 워킹트리에 미커밋으로 남아 있으면 **착수 금지, 오케스트레이터 반려**). ② 완료 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: ① 클린 기준선 확증 ② exit 0, 오류 0건(훅 시그니처, ScrollView 전환, reselectInput state, useFocusEffect 콜백 전부 통과).

**U-2. [공통] useAndroidKeyboardLift 훅 추출 — 로직 문자 동일성 + 배선 교체 [unit]**
- Given: 추출 원본은 PlaylistPickerSheet :27-38(앵커 `keyboardDidShow`/`v3.197 U-7 교훈` 주석). **추출 과정에서 1글자라도 로직이 변형되면 v3.198 합격 형상이 조용히 깨진다** — 이 항목이 v3.198 무회귀의 본체.
- When: `hooks/useAndroidKeyboardLift.ts` 신설분과 원본 대조 —
  - ① **4요소 문자 대조**: ⓐ `Platform.OS !== 'android' || !visible` 게이트(비충족 시 `setKbPad(0); return`) ⓑ show: `setKbPad(Math.max(0, e.endCoordinates.height - insets.bottom))` — **`Math.max(0, …)` 하한과 `- insets.bottom` 이중 계상 해소 항 보존**(어느 한쪽 탈락 = FAIL) ⓒ hide: `setKbPad(0)` ⓓ cleanup: `showSub.remove(); hideSub.remove(); setKbPad(0)` **3요소 전부**(리스너 쌍 해제 + 언마운트 리셋 — v3.197 U-7 교훈 주석 승계 확인).
  - ② **hide→0 리셋 보존(v3.198 무회귀 핵심 FAIL 게이트)**: `keyboardDidHide` 리스너가 무조건 0으로 리셋하는지 — 조건부 리셋·디바운스·애니메이션 지연 등 어떤 변형이든 발견 시 **즉시 FAIL**(v3.198 "잔존 간격 구조적 불가" 보장 파괴).
  - ③ **deps**: `[visible, insets.bottom]` 동치(훅 인자로 받는 형태면 해당 인자 — insets를 훅 내부 useSafeAreaInsets로 흡수해도 허용, 단 deps 누락은 FAIL).
  - ④ **배선 교체**: PlaylistPickerSheet에서 인라인 :27-38 블록 **삭제** + `useAndroidKeyboardLift(visible)` 호출로 대체 — 인라인 로직과 훅이 **공존**하면(이중 리스너) FAIL. iOS에서 훅 반환값 항상 0(KAV 소관 불변) 확인.
- Then: ①~④ 전부 충족.

**U-3. [A] kbPad 적용 위치 — paddingBottom→marginBottom 이동 [unit]**
- Given: 근본 원인(계획 §1)은 paddingBottom 합산이 maxHeight '60%' 클램프에 걸려 입력행이 시트 경계 밖으로 밀리는 것 — 위치 이동이 수정의 본질.
- When: sheet 스타일 배선 판정(앵커 `styles.sheet`) —
  - ① **paddingBottom에서 kbPad 제거**: `paddingBottom: insets.bottom + spacing.xl` **원복**(kbPad 항 잔존 시 이중 리프트 FAIL — 제스처 바 보강 목적은 유지).
  - ② **marginBottom: kbPad** 적용(sheet 인라인 style) — kbPad=0이면 marginBottom 0 = 기존 형상과 픽셀 동일(hide 시 잔존 간격 구조적 불가 유지, U-2 ②와 교차).
  - ③ **iOS 경로 무변경**: KAV `behavior: Platform.OS === 'ios' ? 'padding' : undefined`(:104) diff 0 + Modal 내 **Android KAV padding 재도입 금지**(v3.196→198 기각 경로 — behavior 삼항에 android 분기가 생기면 즉시 FAIL, 계획 §1-3 명시 금지).
  - ④ backdrop `justifyContent:'flex-end'`(:142)·`onPress={onClose}`·sheet 내부 TouchableOpacity 전파 차단 diff 0.
- Then: ①~④ 전부 충족.

**U-4. [A] maxHeight 동적 클램프 — 수식·경계 [unit]**
- Given: 키보드(~40%) + 시트(≤60%) = 화면 상한 100% 극단 보강(계획 §1-1 엣지). 수식이 틀리면 두 가지 역결함 — 과소 클램프(여전히 가림) 또는 과대 클램프(시트가 비정상 축소).
- When: ① `useWindowDimensions()` 도입 + kbPad>0일 때 sheet `maxHeight`가 `winH - kbHeight - 24`(±8px 동등 상수 허용) **이하**로 클램프되는 인라인 style — kbHeight는 훅이 노출하는 원시 키보드 높이 또는 `kbPad + insets.bottom` 동치식(kbPad 단독 사용이면 insets.bottom만큼 과대 허용 — 기록, 실기기 E-1 최종). ② **kbPad=0(키보드 닫힘) 시 기존 `maxHeight: '60%'` 복원** — 클램프가 상시 적용돼 '60%'를 대체해버리면 키보드 없는 평시 시트가 길어지는 회귀(FAIL). ③ 수식 검산(정적): winH=800, kbHeight=320 가정 → 클램프 456 = 60%(480)보다 작아 유효 발동; winH=640, kbHeight=256 → 360 < 384 발동 — 두 케이스 모두 `클램프값 + kbHeight + 24 ≤ winH` 항등 성립 확인.
- Then: ①~③ 충족(① kbPad 단독식은 기록 허용).

**U-5. [A] 목록 ScrollView 전환 — 키·성능·구조 [unit]**
- Given: 비스크롤 View(:113-122)가 길면 키보드 무관하게 입력행이 밀리는 잠재 결함 동시 해소(계획 §1-2). RN에서 map 렌더 전환 시 key 소실·중첩 터치 충돌이 상투적 회귀 지점.
- When: ① `styles.list` View → `ScrollView`(maxHeight ~240, ±40 허용) 전환 — **`key={pl.id}` 보존**(index 키로 바뀌면 담기 직후 목록 갱신 시 재사용 오류 — FAIL). ② 항목 TouchableOpacity `disabled={busy}`·`onPress={() => handlePick(pl.id)}` diff 0. ③ ScrollView가 backdrop TouchableOpacity 내부라 스크롤 제스처가 시트 닫기로 오전파되지 않는 구조(`keyboardShouldPersistTaps` 지정 여부 확인 — 미지정 시 입력 중 항목 탭이 키보드만 닫는 2탭 문제, **`handled` 이상 권장** — 부재는 기록·실기기 E-1 확인). ④ 성능: 목록 상한이 사용자 플레이리스트 수(수십 규모)라 FlatList 불요 — FlatList로 과잉 전환했으면 범위 초과 기록(FAIL 아님). ⑤ createRow(라벨 :123 + 입력행 :124-133)는 **ScrollView 밖** 시트 하단 고정 — 스크롤 내부로 들어가면 "목록 길 때 입력행 접근에 스크롤 필요" 재발(FAIL).
- Then: ①~⑤ 충족(③④ 기록 허용).

**U-6. [B] 자유입력 제출 경로 동일성 — 신규 분기 금지 [unit]**
- Given: 계획 §2-1 — 제출은 기존 선택지 탭과 **완전히 동일한 검증·반영 경로**여야 한다. 별도 핸들러를 신설하면 store 매핑·chatHistory 교체·모달 닫기 3동작 중 하나가 어긋나는 순간 v3.110 매핑 회귀면이 열린다.
- When: 두 화면 각각 —
  - ① **제출 배선**: 확인 버튼 onPress가 `handleReselectChoice(reselectInput.trim())` **직접 호출** — 래퍼 함수는 trim+호출+리셋만 허용. `handleReselectChoice`와 별개로 store를 만지거나 chatHistory를 직접 조작하는 **신규 핸들러 신설 = 즉시 FAIL**(grep으로 `handleReselectSubmit|reselectCustom` 류 신설 함수의 본문에 setState(store)·chatHistory 조작이 있는지 검사).
  - ② **기존 함수 무변경**: `handleReselectChoice`(Lyrics :219-248 / Composer :185-209 앵커)·`handleReselect` 오픈 가드(Lyrics :213-217 / Composer :174-182) **diff 0** — 자유입력 수용을 위해 기존 함수에 분기를 추가했으면 FAIL(기존 함수는 이미 임의 문자열 수용 구조).
  - ③ **빈값 규칙**: 확인 버튼 disabled 조건이 `!reselectInput.trim()` — `handleCustomSubmit`(Lyrics :254-258)과 동일 규칙. 공백만 입력 후 제출 불가.
  - ④ **리셋**: 모달 닫힘 경로 **전부**(제출 성공·취소 버튼·backdrop 탭·onRequestClose)에서 `reselectInput` 리셋 — 한 경로라도 누락 시 다음 오픈에 이전 입력 잔존(FAIL). `setReselectStep(null)` 지점 grep으로 전수 확인.
- Then: ①~④ 두 화면 전부 충족.

**U-7. [B] 노출 제외 스텝 집합 — boolean 오매핑 방지 진리표 [unit]**
- Given: Lyrics step 2(듀엣)·8(랩)·9(길이)는 enum 매핑(`choice==='듀엣'`, `'포함'`, durationMap) — 자유 텍스트가 들어가면 **항상 false/기본값으로 조용히 오매핑**된다(컴파일·렌더 전부 통과하는 최악 유형). 메인 플로우 :393(`step !== 2 && step !== 8 && step !== 9`)과의 동치가 유일한 방어선.
- When: ① **LyricsInput**: 입력 행 노출 조건이 `reselectStep !== 2 && reselectStep !== 8 && reselectStep !== 9`(또는 Set 동치) — **:393과 집합 문자 동일**(:393의 `v3.129 인덱스 시프트` 주석 근거 — 상수화해 양쪽이 한 소스를 참조하면 최선, 각자 리터럴이면 집합 일치 확인). 진리표 4행: ⓐ step 0(주제 등 자유 허용) → 입력 행 표시 ⓑ step 2 → **미표시**(표시 시 FAIL) ⓒ step 8·9 → 미표시 ⓓ 선택지 ScrollView는 전 스텝 표시 유지. ② **ComposerInput**: 재선택 대상 스텝 0(genre)·1(mood)·2(vocal) **전부 입력 행 노출**(제외 없음 — 계획 §2-2, 메인 입력행 전 스텝 노출과 동치). Lyrics의 제외 집합을 복붙해 Composer에 남기면 vocal(2) 스텝 입력이 사라지는 오이식 — 발견 시 FAIL. ③ 제외 판정이 `STEPS[reselectStep]?.choices` 존재 여부 같은 **간접 조건으로 대체됐으면 FAIL**(세 스텝 모두 choices가 있어 판별 불가 — 명시 집합만 유효).
- Then: ①~③ 충족(진리표 전 행).

**U-8. [B] autoFocus 금지 + 모달 키보드 리프트 [unit]**
- Given: 계획 §2-3 — 선택지 탭이 1차 UX(모달 오픈 즉시 키보드 팝업 방지). 모달은 중앙 정렬이라 시트(A)와 리프트 적용면이 다르다.
- When: 두 화면 각각 — ① 재선택 TextInput에 `autoFocus` **부재**(존재 시 FAIL). ② `reselectContainer`에 `marginBottom: kbPad`(useAndroidKeyboardLift 반환값 — 중앙 정렬이라 kbPad>0 시 위로 밀림). 훅 인자 visible = `reselectStep != null`(모달 열림과 게이트 동기 — `visible` prop 오전달로 상시 리스너면 기록). ③ iOS: 모달 내부 KAV(`behavior:'padding'`) 래핑 — v3.196 입력 모달 관행(Android는 kbPad 담당·KAV behavior undefined, U-3 ③ 금지 규칙과 교차). ④ 입력 행 위치: 선택지 ScrollView **아래**·취소 버튼 **위**(계획 §2-1 배치), 메인 inputRow(:394-427) 스타일 재사용(신규 스타일 전면 정의는 기록). ⑤ edit-2 어포던스·안내 문구 diff 0(계획 §2-4 — 자유입력 스텝 말풍선은 여전히 재선택 비대상, v3.199 "거짓 어포던스 금지" 유지).
- Then: ①~⑤ 두 화면 전부 충족(②게이트·④스타일은 기록 허용).

**U-9. [C] focused-screen-writes-only — cleanup 제거 + Map focus 클리어 [unit]**
- Given: 주 원인은 blur cleanup(`headerLeft: undefined`)이 다음 화면의 focus 주입 **이후에** 실행되는 경합(계획 §3 원인 1). 수정 후 불변식: **쓰기 지점 = 3화면 focus(set) + Map focus(clear) 정확히 4곳뿐**. 단 cleanup을 제거하면 v3.199 U-4가 FAIL로 규정했던 "잔존 화살표"의 방어 주체가 Map focus 클리어로 **이관**된다 — 이관이 완결됐는지가 본 항목의 핵심.
- When: `grep -n "headerLeft" screens/DialogueScreen.tsx screens/LyricsInputScreen.tsx screens/ComposerInputScreen.tsx screens/MapScreen.tsx` 전수 판정 —
  - ① **3화면 cleanup 제거**: 각 useFocusEffect의 return cleanup에서 `headerLeft: undefined` **부재** — cleanup 자체가 다른 정리(리스너 등)를 하면 유지 허용, headerLeft 키만 금지. 잔존 발견 = 경합 미해소 FAIL. focus 시 set(arrow-left·size 22·getParent 경로)은 v3.199 형상 유지.
  - ② **잔존 방지 논리 완결(핵심 FAIL 게이트)**: MapScreen에 **useFocusEffect 신설** + 콜백에서 `navigation.getParent()?.setOptions({ headerLeft: undefined })` — 3화면 어디서든 Map으로 복귀하면 Map이 focus를 받으므로 클리어가 **반드시 실행**됨(경로 논증: Studio 스택 내 3화면→Map 복귀는 전부 pop/navigate로 Map focus 발화; 탭 이탈 후 재진입도 Map focus 발화 — v3.199 U-4의 "deps 불변이면 useLayoutEffect 재실행 안 됨" 함정을 focus 이벤트가 우회). 클리어가 useLayoutEffect 안에만 있고 useFocusEffect가 없으면 **FAIL**(이관 미완 — 화살표 영구 잔존 경로 부활). 클리어 값은 `undefined` 문자 그대로(`null`이면 v3.199 U-4 ② 판정 준용 FAIL).
  - ③ **쓰기 지점 전수 = 4곳**: grep 결과에서 setOptions payload에 headerLeft를 넣는 지점이 3화면 focus set + Map focus clear 외 **0건**(주석·타입 제외). 5곳 이상이면 불변식 위반 FAIL.
- Then: ①~③ 전부 충족.

**U-10. [C] MapScreen — payload 키 삭제 + deps 와이프 제거 [unit]**
- Given: 부 원인(계획 §3 원인 2) — useLayoutEffect payload의 `headerLeft: undefined`(:292)와 deps의 `user` 객체 identity(:296)가 결합해, transparentModal 아래 마운트 유지 중인 Map이 user 갱신 시 대화 도중 화살표를 지운다.
- When: ① useLayoutEffect setOptions payload에서 `headerLeft` **키 자체 삭제**(:292 앵커 — `headerLeft: undefined,` 라인 부재; 키를 남기면 U-9 ②의 focus 클리어와 무관하게 와이프 경로 존속 FAIL). ② deps 배열(:296 앵커 `v3.199(C): 회전/폭 변화 반영` 주석)에서 **`user` 단독 identity 제거** — `user?.company_name`(헤더 타이틀 실사용 값)은 유지, `nameMaxWidth`·`showTutorial`·`navigation` 유지. `user` 잔존 시 FAIL. ③ 헤더 타이틀 렌더가 user의 company_name 외 필드를 참조하면 해당 파생 프리미티브를 deps에 개별 추가했는지 확인(lint 경고 무음 처리로 때웠으면 기록). ④ v3.199(C) 형상 무회귀: nameMaxWidth `Math.max(90, …)` 하한·Marquee 명시 폭 View·ⓘ 형제 노드·headerRight HomeHeaderActions diff 0(U-13 교차).
- Then: ①~④ 충족(③ 기록 허용).

**U-11. [C] iOS transparentModal 검증 항목화 [unit]**
- Given: 계획 §3 원인 3·수정안 3 — iOS에서 Dialogue의 `presentation:'transparentModal'`(App.tsx :184)이 탭 헤더를 덮으면 화살표 이전에 헤더 자체가 안 보인다. 이번 커밋의 기본 스코프는 **검증 항목화**(코드 변경은 조건부).
- When: ① App.tsx :184 diff 판정 — **무변경이 기본**. 변경됐다면 `presentation:'card'`+fade 전환(계획 1안)인지 + 커밋 메시지에 iOS 검증 근거 명기됐는지(명기 없는 변경 = 계획 편차 FAIL). ② 변경 시 추가 판정: Android 동작 무회귀 전제(transparentModal→card는 Map 언마운트 여부가 바뀜 — MapScreen 상태 유실·U-9 ② focus 클리어 타이밍 재검토 필요, 해당 커밋에서 본 절 전체 재판정). ③ 오버레이 대안(계획 2안) 적용 시: iOS 한정 분기 + v3.200 modeBar(top:12/left:16)와 간섭 회피(우측 시프트) 확인. ④ 미변경(기본)이면: E-3에 "iOS 시뮬레이터에서 Dialogue 중 탭 헤더 노출 여부 보고" 항목 이관 명기로 충족.
- Then: ①(+해당 시 ②③) 또는 ④ 충족.

**U-12. diff 격리 — 허용 6파일 + hooks/ 신설 [unit]**
- Given: v3.200 커밋 선행(U-1 ①)으로 이번엔 클린 기준선에서 출발 — v3.199 U-8 같은 스냅숏 판정 불요, 순수 diff 판정 가능.
- When: ① `git status --short` + `git diff --stat`(2_housing 스코프): 콘텐츠 diff가 허용 6파일뿐(App.tsx는 U-11 ① 조건부). ② untracked에 `hooks/useAndroidKeyboardLift.ts` 확인 — **신설 디렉토리라 명시 스테이징 필수**(v3.200 U-9 ② 교훈 승계: `git add hooks/useAndroidKeyboardLift.ts` 누락 시 훅 없는 커밋 = 빌드 깨짐). ③ v3.200 산출물 무접촉: `services/creationLogService.ts`·`stores/musicStore.ts`·`services/musicService.ts` diff 0. ④ backend 디렉토리 무접촉. ⑤ 커밋 시 6(+1 조건부)파일 명시 스테이징.
- Then: ①~⑤ 전부 충족.

**U-13. v3.191~200 무회귀 — 접촉 파일 라인 단위 [unit]**
- Given: 접촉 파일 이력 중첩 — PlaylistPickerSheet(v3.196 인셋·v3.198 kbPad), LyricsInput(v3.110 스텝 매핑·v3.129 인덱스·v3.199 D edit-2), ComposerInput(v3.199 D 이식), DialogueScreen(**v3.199 B + v3.200 모드 토글 — 같은 파일 2이력 접촉**), MapScreen(v3.75 헤더·v3.199 C).
- When/Then (앵커 재탐색):
  - ① **v3.196**: PlaylistPickerSheet `insets.bottom + spacing.xl` 보강 유지(U-3 ①) + 시트 4곳 중 나머지 3곳(queueSheet 등) diff 0.
  - ② **v3.198**: kbPad hide→0 리셋(U-2 ②로 포섭) + `stores/playerStore.ts`·`components/MiniPlayer.tsx` diff 0(sessionActive 미니플레이어 무접촉).
  - ③ **v3.110/129**: LyricsInput STEPS 정의·:393 제외 집합 원본·`handleReselectChoice` 스텝→store 매핑 diff 0(U-6 ② 교차).
  - ④ **v3.199 B/D**: 3화면 focus 주입부(arrow-left·size 22) 형상 유지(cleanup 3줄 제거 외 diff 0 — U-9 ①), edit-2 조건식·VideoDirectorScreen diff 0.
  - ⑤ **v3.200(같은 파일 정밀 판정)**: DialogueScreen diff가 **useFocusEffect cleanup 내 `headerLeft: undefined` 라인 제거뿐**인지 — v3.200 산출물인 모드 토글 useFocusEffect 인근·modeBar JSX·modeBar 스타일·저작권 고지 1회 노출 로직에 diff가 1줄이라도 걸리면 FAIL(계획 §4-0 "v3.200 주석·로직 삭제 금지"). 같은 useFocusEffect 블록에 두 이력이 공존할 수 있으므로 hunk 단위가 아니라 **라인 단위**로 귀속 판정.
  - ⑥ **v3.199 A/C**: Avatar/seedColor 무접촉(허용 파일 밖 diff 0으로 포섭), MapScreen v3.199 C 형상은 U-10 ④.

### [e2e] 실기기 실측 이관 + 정적 대체

**E-1. [A] 담기 시트 입력 키보드 위 노출 [e2e]** — Android 실기기: ① 플레이리스트 0개·10개 두 케이스에서 새 플레이리스트 입력 탭 → **입력행+만들기 버튼이 키보드 위에 완전 노출**(10개 케이스가 종전 재현 경로 — 시트 60% 클램프 확인) ② 키보드 닫기 → 간격 잔존 없음, 백 제스처 키보드 해제→시트 재오픈 반복 ×5 패딩 누적 없음(v3.198 무회귀) ③ 목록 10개 스크롤로 전 항목 접근 + 입력행 상시 노출 + 입력 중 항목 탭 1회 반응(U-5 ③) ④ iOS: 기존 KAV 동작 무회귀. **정적 대체**: U-2~U-5(위치 이동·클램프 수식 검산·ScrollView 구조) 완료로 갈음, 실측은 이관.

**E-2. [B] 재선택 자유입력 여정 [e2e]** — 실기기: ① LyricsInput — 답변 말풍선 탭 → 선택지+직접 입력 노출, **듀엣·랩·길이 스텝은 입력 행 없음**(U-7 진리표 실측), 자유 텍스트 제출 → 말풍선 텍스트 교체 + LyricsPromptReview 최종 프롬프트 반영 ② ComposerInput — 스텝 0·1·2 전부 입력 행 노출, 제출 → 말풍선+작곡 요약 반영 ③ 빈값·공백만 제출 불가, 취소/backdrop 닫기 → 미반영·재오픈 시 입력 비어 있음(U-6 ④ 실측) ④ 모달 입력 중 키보드가 입력창을 가리지 않음(Android, 중앙 모달 리프트) + 오픈 즉시 키보드 미팝업(autoFocus 부재). **정적 대체**: U-6~U-8 완료로 갈음.

**E-3. [C] 대화 3화면 back 왕복 + 잔존 없음 [e2e]** — Android 실기기: ① Map→디렉터 대화→작사(→별도로 작곡 플로우) 각 **진입 직후·체류 중** 헤더 ← 상시 노출(경합 수정의 본체 — 진입 직후 소실 재현 여부가 판정) ② ← 탭 동작: Dialogue→Map, LyricsInput→Dialogue ③ Map 복귀 시 화살표 소멸·잔존 무(U-9 ② focus 클리어 실측) ④ 대화 중 설정에서 프로필 변경 후 복귀 → 화살표 유지(원인 2 회귀 확인 — deps 와이프 제거 실측) ⑤ Studio 탭 이탈→재진입(tabPress 리셋) 후 Map 화살표 무 ⑥ 왕복 ×5 반복 잔존/소실 무 ⑦ ArtistInput ‹ 무회귀 ⑧ **iOS 시뮬레이터: Dialogue 중 탭 헤더 노출 여부 보고**(U-11 ④ 이관 — 미노출 시 계획 §3-3 후속 발동). **정적 대체**: U-9~U-11(쓰기 지점 4곳 전수·이관 완결 논증) 완료로 갈음.

**게이트**: U-1~U-13 전부 PASS 시 머지 허용(E-1~E-3은 실기기 이관 — 정적 대체 완료를 조건으로 비차단). U-2 ②(hide 0 리셋)·U-6 ①(신규 핸들러)·U-7 ①(제외 집합)·U-9 ②(focus 클리어 이관)·U-13 ⑤(v3.200 라인 침범) 중 1건이라도 FAIL이면 커밋 금지.

### v3.201 테스트 결과 (tester, 2026-09-21)

기준선: HEAD d8f0b4a(v3.200 커밋 완료) + 워킹트리 v3.201 변경분. 콘텐츠 diff 5파일(PlaylistPickerSheet 27/20·ComposerInput 69/22·Dialogue 5/5·LyricsInput 74/25·Map 15/2) + untracked `hooks/useAndroidKeyboardLift.ts`. 그 외 M 표시 다수는 전부 mode-only(100644→100755, 콘텐츠 0/0) — 기존 워킹트리 상태, 이번 커밋 스테이징 제외.

#### [unit] 판정 표 (머지 게이트)

| 항목 | 판정 | 근거 요약 |
|---|---|---|
| U-1 선행 게이트 + tsc | **PASS** | ① HEAD d8f0b4a=v3.200 커밋, creationLogService·musicStore·musicService·DialogueScreen v3.200분 콘텐츠 diff 0 ② `npx tsc --noEmit` exit 0 |
| U-2 훅 추출 문자 동일성 | **PASS** | ① ⓐ`Platform.OS !== 'android' \|\| !visible` 게이트+`setKbPad(0); return` ⓑshow `Math.max(0, e.endCoordinates.height - insets.bottom)` 이중 계상 해소 항 보존 ⓒhide 무조건 `setKbPad(0)` ⓓcleanup `showSub.remove(); hideSub.remove(); setKbPad(0)` 3요소+v3.197 U-7 교훈 주석 승계 ② **hide→0 무조건 리셋 확인(게이트)** — 조건부/디바운스 변형 없음 ③ deps `[visible, insets.bottom]`(insets는 훅 내부 useSafeAreaInsets 흡수 — 허용형) ④ 인라인 :27-38 블록 삭제+`useAndroidKeyboardLift(visible)` 단독(공존 없음), `Keyboard` import 제거, iOS 반환 항상 0 |
| U-3 kbPad 위치 이동 | **PASS** | ① `paddingBottom: insets.bottom + spacing.xl` 원복(kbPad 항 제거) ② sheet 인라인 `marginBottom: kbPad` ③ KAV `behavior: ios ? 'padding' : undefined` 무변경, Android padding 재도입 없음 ④ backdrop flex-end(:149)·onPress={onClose}·내부 TouchableOpacity 전파 차단 diff 0 |
| U-4 maxHeight 동적 클램프 | **PASS** | ① `kbPad > 0 && { maxHeight: Math.min(winH * 0.6, winH - (kbPad + insets.bottom) - 24) }` — kbHeight=`kbPad+insets.bottom` 동치식(과대 허용 없음, kbPad 단독식 아님) ② kbPad=0 시 조건 false → styles.sheet `maxHeight:'60%'`(:150) 복원 ③ 검산: 800/320→min(480,456)=456 발동, 640/256→min(384,360)=360 발동, 항등 `클램프+kbHeight+24≤winH` 성립 |
| U-5 목록 ScrollView | **PASS** | ① `ScrollView style={[styles.list, {maxHeight: 240}]}`·`key={pl.id}` 보존 ② `disabled={busy}`·`onPress={() => handlePick(pl.id)}` diff 0 ③ `keyboardShouldPersistTaps="handled"` 지정(권장 충족), sheet TouchableOpacity(onPress noop) 내부라 backdrop 오전파 차단 ④ FlatList 과잉 전환 없음 ⑤ label+createRow는 ScrollView 밖 시트 하단 고정 |
| U-6 제출 경로 동일성 | **PASS(주석)** | ① 두 화면 `handleReselectInputSubmit` = trim→빈값 가드→`handleReselectChoice(text)` 직접 호출 — store/chatHistory 직접 조작 0건(`__DEV__` console.info 1줄은 로깅뿐, 허용 범위 판단) ② `handleReselect` 오픈 가드 diff 0; `handleReselectChoice` 매핑·chatHistory 교체 로직 diff 0, 단 말미에 무조건 `setReselectInput('')` 1줄 추가 — 자유입력 수용 분기 아님, ④ 제출 성공 경로 리셋 요구의 유일한 충족 수단이라 허용 판정(아래 편차 주석) ③ `disabled={!reselectInput.trim()}` 두 화면 일치 ④ 리셋 전수: 제출 성공/선택지 탭(handleReselectChoice 말미)·취소·backdrop·onRequestClose(전부 closeReselect) — setReselectStep(null) 지점 grep 전수 대응 확인 |
| U-7 제외 집합 진리표 | **PASS** | ① Lyrics 입력 행 조건 `reselectStep !== 2 && reselectStep !== 8 && reselectStep !== 9` — 메인 플로우(현 :413, 앵커 이동) `step !== 2 && step !== 8 && step !== 9`와 집합 문자 동일(각자 리터럴, 일치 확인). 진리표: step0 표시/step2 미표시/step8·9 미표시/선택지 ScrollView 전 스텝 표시 ② Composer 전 스텝(0·1·2) 노출 — 제외 집합 오이식 없음 ③ 간접 조건(choices 존재 판별) 아님, 명시 리터럴 |
| U-8 autoFocus·모달 리프트 | **PASS** | ① autoFocus 부재(두 화면) ② `reselectContainer`에 `marginBottom: reselectKbPad`, 훅 인자 `reselectStep != null`(모달 열림 동기) ③ Modal 내부 KAV `behavior: ios ? 'padding' : undefined` 래핑(Android는 kbPad 담당) ④ 입력 행 = 선택지 ScrollView 아래·취소 위, styles.inputRow/textInput/sendButton(Disabled) 메인 스타일 재사용 ⑤ edit-2 조건식·안내 문구 diff 0 |
| U-9 focused-writes-only | **PASS** | ① 3화면 cleanup의 headerLeft 라인 제거(return cleanup 자체 삭제 — 다른 정리 없던 블록) ② **Map useFocusEffect 신설 + `navigation.getParent()?.setOptions({ headerLeft: undefined })`(게이트)** — 3화면→Map 복귀·탭 재진입 전부 Map focus 발화로 클리어 보장, 값 `undefined` 문자 그대로 ③ grep 전수: headerLeft 쓰기 지점 = Dialogue:97·Lyrics:139·Composer:96(set) + Map:307(clear) 정확히 4곳, 나머지는 주석 |
| U-10 MapScreen 와이프 제거 | **PASS(기록)** | ① payload `headerLeft: undefined,` 라인 부재(키 삭제) ② deps `[navigation, user?.company_name, !!user, showTutorial, nameMaxWidth]` — user 단독 identity 제거 ③ 클로저의 user 사용은 truthiness(ⓘ 노출)+company_name뿐 → `!!user`로 충족; **기록**: deps 내 `!!user` 표현식은 react-hooks/exhaustive-deps 경고 대상(무음 처리 주석은 없음 — 경고 발생 시 CI lint 정책 확인 요) ④ nameMaxWidth `Math.max(90, …)`·Marquee 명시 폭·ⓘ 형제·headerRight diff 0 |
| U-11 iOS transparentModal | **PASS** | ① App.tsx diff 0(무변경 기본 경로) ④ E-3 ⑧ "iOS 시뮬레이터 Dialogue 중 탭 헤더 노출 여부 보고" 이관 명기로 충족 |
| U-12 diff 격리 | **PASS** | ① 콘텐츠 diff = 허용 5파일뿐(App.tsx 무변경) ② untracked `hooks/useAndroidKeyboardLift.ts`(hooks/ 내 유일 파일) — **명시 스테이징 필수** ③ v3.200 산출물 3파일 콘텐츠 diff 0 ④ backend 무접촉 ⑤ 스테이징 목록 아래 확정(mode-only 파일 다수는 제외) |
| U-13 무회귀 라인 단위 | **PASS** | ① queueSheet 등 타 시트 diff 0 ② playerStore·MiniPlayer diff 0 ③ STEPS·메인 제외 집합(:413)·handleReselectChoice 스텝 매핑 diff 0(말미 리셋 1줄만 — U-6 ② 주석 참조) ④ 3화면 focus 주입부 arrow-left·size 22 유지, edit-2·VideoDirectorScreen diff 0 ⑤ **DialogueScreen 5/5 라인 전수 귀속(게이트)**: 삭제 5 = v3.199(B) 주석 2 + cleanup 3, 추가 5 = v3.201(C) 주석 — 전부 v3.199(B) useFocusEffect 블록(:85-107) 내, v3.200 산출물(모드 토글 :205·modeBar :441/:485·저작권 고지 :72) 침범 0줄 ⑥ Avatar/seedColor 무접촉 |

#### 편차 판정 (app-dev 신고 3건)

1. **iOS transparentModal 미적용**: 계획 기본 스코프(검증 항목화)와 일치 — App.tsx diff 0 확인, U-11 ④ 경로 PASS. E-3 ⑧로 이관.
2. **재선택 모달 중앙정렬 리프트 절반**: 정적 확인 결과 실재하는 제약 — reselectOverlay `justifyContent:'center'`에서 컨테이너 `marginBottom: kbPad`는 유효 상향이 약 kbPad/2. 최악 케이스(컨테이너 maxHeight 60% 만재 + 소형 기기)에서 하단 ~24px 겹침 가능 수식상 존재. 코드 FAIL 아님(가림 대상은 입력 행이 아닌 취소 버튼 하단 여백부터) — **E-2 ④ 실기기 실측 필수 항목으로 명기**. 미흡 시 후속: overlay justifyContent를 kbPad>0 시 'flex-end'+여백 전환 또는 marginBottom 2배 보정.
3. **keyboardShouldPersistTaps="handled" 보강(PLAN 미명시)**: U-5 ③이 "handled 이상 권장"으로 이미 요구 — 계획 정합 판정, 편차 아님. 재선택 모달 선택지 ScrollView에도 동일 적용(입력 중 선택지 탭 1회 반응) — 이득 방향.

추가 주석(신규 발견, FAIL 아님): U-6 ②의 "기존 함수 diff 0" 대비 `handleReselectChoice` 말미 `setReselectInput('')` 1줄 추가 — U-6 ④(제출 성공 경로 리셋)와의 상충을 리셋 쪽으로 해소한 구현. 무조건 실행·매핑/검증/chatHistory 로직 무변경이라 "자유입력 수용 분기" 금지 취지 위반 아님으로 판정.

#### [e2e] 정적 대체 + 실기기 이관

| 항목 | 정적 대체 | 실기기 잔여 |
|---|---|---|
| E-1 담기 시트 키보드 | U-2~U-5 PASS로 갈음 | ① 목록 0/10개 입력행 키보드 위 노출 ② 닫기 잔존 무·재오픈 ×5 누적 무 ③ 목록 스크롤+입력 중 항목 1탭 반응 ④ iOS KAV 무회귀 |
| E-2 재선택 자유입력 | U-6~U-8 PASS로 갈음 | ① Lyrics 듀엣·랩·길이 입력행 부재+제출 반영(LyricsPromptReview) ② Composer 0·1·2 전부 노출+요약 반영 ③ 빈값 불가·닫기 미반영·재오픈 공백 ④ **중앙 모달 리프트 절반 이슈(편차 2)**: Android에서 키보드 열림 중 입력행 가림 여부 — 소형 기기(≤640dp)+선택지 만재 케이스 우선 |
| E-3 헤더 back 왕복 | U-9~U-11 PASS로 갈음 | ①~⑦ 진입 직후 소실 무·Map 복귀 잔존 무·프로필 변경 유지·탭 재진입·×5 왕복·ArtistInput ⑧ **iOS 시뮬레이터 Dialogue 탭 헤더 노출 보고(U-11 ④ 이관)** |

#### 게이트 판정

**U-1~U-13 전 항목 PASS — 머지 허용.** 5대 게이트(U-2 ② hide 0 리셋 / U-6 ① 신규 핸들러 금지 / U-7 ① 제외 집합 / U-9 ② focus 클리어 이관 / U-13 ⑤ v3.200 라인 침범) 전부 통과. E-1~E-3은 정적 대체 완료로 비차단, 실기기 이관.

**커밋 스테이징 확정(6파일 — mode-only 변경 파일 스테이징 금지)**
```
git add 2_housing/hooks/useAndroidKeyboardLift.ts \
        2_housing/components/PlaylistPickerSheet.tsx \
        2_housing/screens/LyricsInputScreen.tsx \
        2_housing/screens/ComposerInputScreen.tsx \
        2_housing/screens/DialogueScreen.tsx \
        2_housing/screens/MapScreen.tsx
```
App.tsx 미변경 — 스테이징 제외(U-11 기본 경로).

## v3.202 — 수정일 2026-09-21

> 대상: PLAN.md v3.202(:3282-3306) — 실기기 10건, 앱 전용·백엔드 무변경. 슬라이스 9개: (A-lite) `services/playback.ts` 프리로드 조기화(이중 트리거)+실패 백오프(곡당 3회/10s), (B) LyricsInput 재선택 모달 flex-end 전환+클램프 / ReportModal·AppealModal·AlbumCreateModal 3곳 translateY(-kbPad) 리프트, (C) consentTexts `COPYRIGHT_RECORD_GUIDE` 상수+recChip 탭→PolicySheet, (D) MapScreen nameMaxWidth 300/90 산식+flexShrink 안전망 2키, (E/F) MusicGenerationScreen performRewind 비파괴 값 치환, (G) 아티스트 게이트(:418) 제거+0명 showAlert 분기, (H) CoverGenerationScreen fix 1~5, (I-lite) ERR_NETWORK 시 cover-sessions 폴링 복구, (J) 연주곡 경로 개통+**ComposerInputScreen 삭제**.
> **구현 편성**: 2개 조 병행 — **1조**: playback(A)·LyricsInput 재선택 모달(B안1)·MusicGeneration(E/F·G·J 스킵체인)·ComposeLyricsPick/ComposerSelect/MusicLoading/musicService/musicStore(J)·App.tsx(J 삭제)·ComposerInputScreen 삭제 / **2조**: ReportModal·AppealModal·AlbumCreateModal(B안2)·consentTexts+DialogueScreen(C)·MapScreen(D)·CoverGeneration(H·I-lite)·musicStore(H 영속 필드). **`stores/musicStore.ts`는 두 조 공유 접점**(1조 J instrumental 필드 + 2조 H cover* 필드) — U-17에서 hunk 귀속 판정.
> 실행 환경 관행(v3.191~201 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 정적 대체 병기 + 실기기 실측 이관. 특히 **A(Doze)는 에뮬/시뮬 재현 불가**(Doze 네트워크 차단은 실기기 절전 상태 전용) — [unit] 정적 논증이 머지 게이트의 전부. 앱 코드 경로 `/Users/pearl/TripleJ/2_housing`. **백엔드 무접촉 — [api]는 "서버 무변경 확인" 1건뿐, 연주곡 실생성 1회는 Suno 실과금이라 실기기 이관.** 증적에 실계정 토큰·개인 식별 정보 기재 금지.
> 변경 허용 파일(격리 기준): 1조 — `services/playback.ts`, `screens/LyricsInputScreen.tsx`, `screens/MusicGenerationScreen.tsx`, `screens/ComposeLyricsPickScreen.tsx`, `screens/ComposerSelectScreen.tsx`, `screens/MusicLoadingScreen.tsx`, `services/musicService.ts`, `App.tsx`(J 삭제 3곳만), **`screens/ComposerInputScreen.tsx` 삭제** / 2조 — `components/ReportModal.tsx`, `components/AppealModal.tsx`, `components/AlbumCreateModal.tsx`, `constants/consentTexts.ts`, `screens/DialogueScreen.tsx`(C recChip·alert만), `screens/MapScreen.tsx`(D 2줄대), `screens/CoverGenerationScreen.tsx` / 공유 — `stores/musicStore.ts`. VOCAL_OPTIONS 소비처(`screens/ArtistResultScreen.tsx`·`screens/VoiceManageScreen.tsx`)는 **원칙 무접촉**(U-15 ⑤ 파급 판정 결과에 따라 가드 1줄만 조건부 허용 — 적용 시 커밋 메시지 명기). 그 외 콘텐츠 diff는 FAIL.

### [unit] 정적 검증 (머지 게이트)

**U-1. 선행 게이트 — v3.201 커밋 확인 + 타입 무결성 [unit]**
- Given: v3.201 6파일(훅 포함)이 미커밋으로 남으면 이번 diff 귀속 판정(U-17) 성립 불가. 또한 J가 ComposerInputScreen을 삭제하므로 **v3.201(B) 이식분이 커밋에 먼저 존재해야 "삭제"의 이력이 남는다**(스쿼시로 이식+삭제가 상쇄되면 REPORT 정정 근거 소실).
- When: ① `git log --oneline -1` + `git status --short`(2_housing 스코프)로 v3.201 커밋 완료·클린 기준선 확인(미커밋 시 착수 금지·반려). ② 1조·2조 산출물 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: ① 클린 기준선 ② exit 0 — 특히 **ComposerInputScreen 삭제 후 잔존 참조 0건이 tsc로 전수 보증**되는지(U-16과 교차).

**U-2. [A] 프리로드 이중 트리거 배선 — 조기화 [unit]**
- Given: 원인 확정(계획) — 프리로드 창(20s/85%)이 Doze 진입보다 늦어 히트율 저하. 수정 = ① 현재 곡 **로드 성공 직후** 즉시 1회 ② **잔여 60s 전** 트리거 추가, 기존 20s/85% 창 유지(3중이 아니라 "기존 창 + 조기 2트리거"의 합집합).
- When: `services/playback.ts` 판정(앵커 `maybePreloadNext` :74, 호출부 :225) — ① 곡 로드 성공 경로(현재 곡 사운드 로드 완료 콜백/then)에서 maybePreloadNext 계열 호출 **신설 1건**(로드 실패 경로에서는 미호출). ② 상태 콜백 호출부에 잔여 `durationMillis - positionMillis <= 60_000` 조건 추가 또는 maybePreloadNext 내부 창 확장 — 기존 `20s/85%` 상수 **삭제·변경 금지**(창 합집합 확장만 허용, 축소 발견 시 FAIL). ③ `preloadInFlight`(:59) 가드가 신설 트리거에도 동일 적용(로드 직후 트리거와 창 트리거가 동시 발화해도 중복 로드 불가 논증). ④ 프리로드 대상 산출이 기존 next 선정 로직(셔플 핀 포함) **재사용** — 별도 next 계산 신설 시 FAIL(v3.197 핀과 이원화되면 스왑 검증 5중이 깨짐).
- Then: ①~④ 전부 충족.

**U-3. [A] 실패 백오프 — 곡당 3회/10s + 폭주 제거 [unit]**
- Given: 원인 확정 — 실패 시 상태 콜백 주기(~초당 8회)마다 재시도 폭주. `preloadInFlight`는 **동시성 가드일 뿐 재시도 간격 가드가 아니다**(실패 즉시 false 복원 :107 → 다음 틱 재발화).
- When: ① **재시도 상한**: 곡(trackId) 단위 실패 카운터 ≤ **3회** — 4회째 시도 경로가 코드상 차단되는지(카운터 비교 연산자 경계 `< 3` vs `<= 3` 명시 확인). ② **간격**: 직전 실패 시각 기록 + `Date.now() - lastFailAt < 10_000` 류 가드 — **실패 catch에서 즉발 재호출(setTimeout 0·재귀 호출) 0건**(grep: catch 블록 내 maybePreloadNext/재시도 함수 호출 부재 — 발견 시 즉시 FAIL, 폭주 재발). ③ **카운터 리셋 경로**: 현재 곡 변경 시·프리로드 성공 시 카운터/시각 초기화(리셋 누락 시 다음 곡에서 이월 차단되는 역결함 — FAIL). ④ 백오프 상태가 모듈 변수면 트랙 전환 시 초기화 지점 명시, per-track Map이면 곡 종료 시 정리(누수 기록). ⑤ [BTDebug] 로그: 기존 `preload start/ready/fail/stale discard/invalid discard/swap ok/swap fail` 문자열 유지 + 백오프 발동 로그 추가 권장(부재는 기록).
- Then: ①~③ 충족(④⑤ 기록 허용).

**U-4. [A] v3.197 무침투 — 셔플 핀·5중 검증·didJustFinish 분기 [unit]**
- Given: 접촉 파일이 v3.197 산출물(프리로드 셔플 핀 pinnedIdx·5중 스왑 검증·status.error 분기·AppState 리컨사일)과 동일 — 조기화·백오프는 **트리거 시점/횟수만** 바꿔야 하고 스왑·검증·핀 로직은 diff 0이어야 한다.
- When: ① pinnedIdx 산출·전달·`preload stale discard`(:99)·`preload invalid discard`(:130) 검증 경로 diff 0. ② didJustFinish 분기(:230 preloadHit true/:235 false)·스왑 성공/폴백(:270/:275) diff 0. ③ status.error 분기·AppState 리컨사일·재생버튼 재로드 폴백(v3.197) diff 0. ④ `stores/playerStore.ts`·`components/MiniPlayer.tsx` diff 0(v3.198 sessionActive 무접촉).
- Then: ①~④ 전부 충족 — **①② 중 1줄이라도 침범 시 FAIL 게이트**.

**U-5. [B안1] Lyrics 재선택 모달 — flex-end 전환 + 클램프 (담기 시트 패턴 문자 대조) [unit]**
- Given: v3.201 편차 2 확정 — center 정렬에서 marginBottom 리프트는 유효 상향 kbPad/2(Yoga 산식). 수정 = 담기 시트 **검증 완료 패턴**(flex-end+marginBottom+동적 maxHeight)으로 전환. 검증 준거가 이미 PASS한 PlaylistPickerSheet 형상이므로 **문자 대조가 곧 판정**.
- When: `screens/LyricsInputScreen.tsx`(앵커 `reselectOverlay` :644) — ① `justifyContent: 'center'`(:647) → `'flex-end'` (상시 또는 kbPad>0 조건부 — 상시 전환이면 키보드 없을 때도 하단 시트화되는 UX 변화라 **계획 B안1의 채택 형태를 커밋 메시지로 확인**, 조건부면 두 상태 스타일 분기 정합 확인). ② 컨테이너 `marginBottom: reselectKbPad` 유지(v3.201 이식분 — 이제 flex-end라 전량 유효). ③ **동적 maxHeight 클램프 — PlaylistPickerSheet 형상 문자 대조**: `kbPad > 0 && { maxHeight: Math.min(winH * 0.6, winH - (kbPad + insets.bottom) - 24) }` 동치식(v3.201 U-4 PASS 형상 — kbPad 단독식·상수 편차 ±8 허용, `Math.max` 오기 시 FAIL). ④ 검산 2행: winH=640·kbHeight=256 → 유효 상향 = kbPad 전량(center의 절반 손실 소멸) + 클램프 360 발동, `클램프+kbHeight+24 ≤ winH` 항등. ⑤ v3.201 합격 형상 무회귀: 제출 경로 `handleReselectChoice` 직접 호출·제외 집합 {2,8,9}·autoFocus 부재·리셋 전수(closeReselect) **diff 0**(정렬·클램프 외 로직 접촉 시 FAIL).
- Then: ①~⑤ 전부 충족.

**U-6. [B안2] 모달 3곳 — useAndroidKeyboardLift + translateY(-kbPad) + 클램프 [unit]**
- Given: ReportModal/AppealModal/AlbumCreateModal은 Android 회피 전무(원인 확정 — 동종 3곳). center 유지 + **translateY 리프트**(B안2)는 marginBottom과 달리 Yoga 재배치 없이 전량 상향 — 단 위로 밀린 만큼 **상단 클리핑** 위험이 생겨 클램프 병행이 필수.
- When: 3파일 각각 — ① `useAndroidKeyboardLift(visible)` 호출(각 모달의 visible prop과 게이트 동기 — 상시 리스너면 기록). ② 컨테이너 `transform: [{ translateY: -kbPad }]` (부호 **음수** — 양수면 키보드 쪽으로 내려가는 역결함 FAIL) — 절반 보정(`-kbPad/2`)이면 center 산식상 잔여 가림 존속으로 FAIL(원인 확정의 kbPad/2 손실은 marginBottom 경로 얘기고 translateY는 전량 반영이므로 보정 불요). ③ **클램프**: `maxHeight ≤ winH - kbPad - 상단여백` 동치식 또는 translateY 상한 클램프(`Math.min(kbPad, 컨테이너 상단 여유)`) — 둘 다 부재면 소형 기기에서 모달 상단이 status bar 밖으로 나가는 코드 경로 존재 = FAIL. ④ iOS 경로 무변경: 훅이 iOS에서 0 반환(불변) → transform 무효과 논증 + 기존 KAV/정렬 diff 0. ⑤ 3파일 간 구현 형상 동일(한 곳만 marginBottom 방식이거나 클램프 누락 등 이형 발견 시 해당 파일 FAIL). ⑥ 각 모달의 기존 기능 배선(신고 제출·이의 제출·앨범 생성 핸들러) diff 0.
- Then: ①~⑥ 전부 충족.

**U-7. [B] v3.201 담기 시트 무회귀 [unit]**
- Given: B 슬라이스가 같은 훅을 3+1곳으로 확장 — 훅 본체를 만지면 v3.201 합격 형상(담기 시트)이 조용히 깨진다.
- When: ① `hooks/useAndroidKeyboardLift.ts` **diff 0**(시그니처 확장 필요 시 — 예: 원시 kbHeight 노출 — 기존 반환 계약 불변 + 추가만 허용, 기존 호출 3곳 재검증 조건). ② `components/PlaylistPickerSheet.tsx` diff 0(marginBottom·클램프·ScrollView·keyboardShouldPersistTaps v3.201 형상). ③ 훅 hide→0 무조건 리셋(v3.201 U-2 ② 게이트) 존속.
- Then: ①~③ 충족 — ③ 침범 시 즉시 FAIL.

**U-8. [C] COPYRIGHT_RECORD_GUIDE 상수 — 문구 금지선 grep [unit]**
- Given: 계획 §3 — 가이드는 **사실 서술**만("창작 과정이 기록됩니다" 류), 법적 효력 보장 어휘 금지. 문구는 코드가 아니라서 tsc가 못 잡는다 — grep이 유일 게이트.
- When: `constants/consentTexts.ts` — ① `COPYRIGHT_RECORD_GUIDE` 상수 신설(기존 consentTexts 파일 관행의 export 형태 일치). ② **금지어 grep 4건 = 0건**: 상수 문자열 내 `등록 가능`·`보장`·`인정`·`특허` 각 0건(조사 변형 포함 육안 재확인 — "등록될 수 있"·"보장되"·"인정받" 류 우회 표현도 취지 위반으로 FAIL). ③ 사실 서술 구성 확인: 기록 대상(대화·선택·가사 버전)·기록 목적·"법적 효력을 보장하지 않는다" 류 한계 고지 포함(한계 고지 부재는 기록·오케스트레이터 문구 검토 회부). ④ 기존 consentTexts 기존 상수 diff 0.
- Then: ①②④ 충족(③ 기록 허용) — **② 1건이라도 검출 시 커밋 금지**.

**U-9. [C] recChip 탭 배선 + PolicySheet 재사용 — 신규 컴포넌트 0 [unit]**
- Given: recChip(:464)은 현재 정적 View. 수정 = TouchableOpacity화+info 아이콘 → **기존 PolicySheet**(components/PolicySheet.tsx)로 가이드 표시 + 모드 alert에 '자세히 보기'. DialogueScreen은 v3.200(모드 토글)·v3.201(C cleanup) 2이력 위 3번째 접촉 — 라인 귀속 정밀 판정 대상.
- When: ① recChip View→TouchableOpacity(또는 Touchable 래핑) + info 계열 아이콘 추가, onPress → PolicySheet 오픈 state 배선. ② **PolicySheet 재사용 확인**: import가 `components/PolicySheet`이고 **신규 시트/모달 컴포넌트 파일 0개**(`git status` untracked에 컴포넌트 0 — 신설 발견 시 FAIL, 계획 명시 "신규 컴포넌트 0"). PolicySheet props 계약(제목/본문 전달 형태)이 기존 사용처와 동형인지. ③ 모드 전환 alert(v3.200 산출물)에 '자세히 보기' 버튼 추가 — **showAlert(앱 내 다이얼로그) 유지, RN `Alert.alert` 도입 0건**(grep — 발견 시 즉시 FAIL, 앱 전역 규칙). '자세히 보기' onPress → 동일 가이드 표시. ④ 세그먼트/토글 라벨 문자열 **무변경**(라벨 재검토는 후속·사용자 결정 — 변경 발견 시 계획 편차 FAIL). ⑤ 재열람 가능 논증: 동일 모드 재탭 no-op 가드는 유지하되 recChip 탭이 가드 밖 경로로 가이드 도달(가드 안에 넣으면 재열람 불가 재발 — FAIL). ⑥ **v3.200/201 라인 무침범**: diff가 recChip JSX·recChip 스타일·alert 버튼 추가에 국한 — 모드 토글 useFocusEffect·modeBar 위치·저작권 1회 고지 로직·v3.201 headerLeft focus 주입에 1줄이라도 걸리면 FAIL(라인 단위 귀속).
- Then: ①~⑥ 전부 충족.

**U-10. [D] MapScreen — 300/90 산식 + flexShrink 안전망 2키 [unit]**
- Given: 원인 확정 — 현행 `Math.max(90, screenWidth - (user ? 260 : 150))`(:266)이 화살표 38px 미반영·HomeHeaderActions 실측 208~229px 대비 여유 −1~+20px. 수정 산식 = `(user ? 300 : 90)`.
- When: ① :266 산식이 `Math.max(90, screenWidth - (user ? 300 : 90))` **정확 일치**(하한 90 유지 — 260→300·150→90 두 상수 동시 교체, 한쪽만 바뀌면 FAIL). ② 검산: winW=360·user 존재 → 60 → 하한 90 발동(마퀴 스크롤 담당); winW=412 → 112 — 실측 최대 229px + 화살표 38 + 여유 대비 우측 침범 불가 논증(229+38=267 ≤ 300 확인 — **300이 실측 상한을 덮는지가 산식의 본질**). ③ 안전망 2키: setOptions payload에 `headerRightContainerStyle: { flexShrink: 0 }`·`headerTitleContainerStyle: { flexShrink: 1 }` — **이 2키 외 헤더 컨테이너 스타일 키 추가 금지**(레이아웃 부작용 면 최소화). ④ v3.199/201 무회귀: deps `[navigation, user?.company_name, !!user, showTutorial, nameMaxWidth]` 유지(nameMaxWidth 값 변화로 재실행 — 산식 교체와 정합), headerLeft **payload 키 부재** 유지·focus 클리어(v3.201 U-9 ②) diff 0, Marquee 명시 폭 View(:275)가 nameMaxWidth 참조 유지.
- Then: ①~④ 전부 충족.

**U-11. [E/F] performRewind 비파괴 값 치환 — 절단 0건 + 에코 쌍 + 이후 보존 [unit]**
- Given: 원인 확정 — MusicGenerationScreen performRewind(:290)의 `...prev.slice(0, idx)`(:307)가 설계상 파괴적 절단(재선택 지점 이후 대화 전량 소실 + 디렉터 구값 에코 잔존이 E의 본체). 수정 = **map 치환**: 해당 user 버블 텍스트 교체 + **직후 디렉터 에코 버블도 새 값으로 치환**, 이후 메시지·스텝 전량 보존.
- When: ① **절단 0건**: performRewind 본문에서 `prev.slice(0,`·`splice`·length 재할당 등 배열 절단 연산 **0건**(grep — :344 editedLyrics preview slice·:467 입력 30자 slice는 무관 라인, 대상은 메시지 배열 조작만). ② **치환 쌍**: `prev.map(...)` 형태로 ⓐ idx의 user 버블 text→새 값 ⓑ **idx 직후 인접 디렉터 버블 중 구값을 에코하는 버블**의 해당 구간 치환(에코 식별 방식 명시 — 인덱스 idx+1 고정이면 "디렉터 버블이 2개 연속인 스텝" 반례 존재 여부 확인, 구값 문자열 포함 검색이면 짧은 값('여성' 등)의 오치환 위험 판정 — 어느 쪽이든 **식별 규칙이 코드에 명시**돼야 하고 암묵 idx+1이면 스텝별 반례 전수 논증 요구). ③ **이후 보존 논증**: map은 길이 불변 — 치환 대상 외 메시지 참조 동일성 유지 확인. step state·이후 스텝의 store 값이 초기화되지 않는지(기존 rewind의 개별 필드 초기화 루프가 "target 스텝 값만 새 값 세팅"으로 전환 — **target 이후 스텝 필드 초기화 코드 잔존 시 FAIL**, 비파괴 취지 정면 위반). ④ 재선택 다이얼로그(:318 '다시 선택' onPress) 배선이 새 시그니처와 정합(새 값 전달 경로 — 값 입력이 선행되는 UI 흐름 확인). ⑤ 최종 프롬프트 정합: 치환된 store 값이 생성 파라미터에 반영(요약/프롬프트 조립부가 store를 읽는 경로 무변경이면 자동 충족 — 로컬 state 이원화 발견 시 FAIL).
- Then: ①~⑤ 전부 충족 — ①③이 FAIL 게이트.

**U-12. [G] 아티스트 게이트 제거 — 0명 분기 showAlert + 대화 보존 [unit]**
- Given: :418 `if (list.length > 0)` 게이트가 0명 사용자에게 '아티스트로 만들기' 선택지 자체를 숨김. 수정 = 선택지 상시 노출 → 0명 선택 시 showAlert [취소/이동].
- When: ① :418 게이트가 선택지 **노출 조건에서 제거**(0명에도 렌더) — 단 list 로드 실패(undefined)와 0명([]) 구분 처리 확인(로드 전 탭 시 분기 오작동 여부). ② 0명 선택 시 `showAlert('아티스트가 아직 없어요', …)` — 문구 계획 동일·버튼 [취소/이동] 2개·**RN Alert 금지**(U-9 ③과 동일 grep). ③ '이동' onPress → 아티스트 디렉터 navigation(Dialogue artist 파라미터 형상은 기존 Map→Dialogue 진입 코드와 동형 — 신규 라우트 문자열 오타는 tsc가 못 잡으므로 기존 호출부와 문자 대조). ④ **대화 보존**: 이동 경로에서 MusicGeneration 대화 상태(chatHistory·step·store 값) reset 호출 **0건** — navigate(스택 push)인지 replace인지 확인, replace면 복귀 시 대화 소실로 FAIL. ⑤ 1명 이상 사용자의 기존 흐름 diff 0(게이트 제거가 기존 분기 순서를 바꾸지 않는지).
- Then: ①~⑤ 전부 충족.

**U-13. [H] CoverGeneration fix 1~5 [unit]**
- Given: 원인 확정 5건 — ① stale closure(handleTrackSelect :633이 이전 렌더 클로저의 스텝 함수 호출 → 가사반영 질문 step 1.75 스킵) ② doRegenerate(:899) 전체 와이프+step 2 강등 ③ performRewind(:598) 파괴적 절단+result 모드 탭 불가 ④ coverExtras 모듈 상태(:51 resetCoverExtras) 화면과 유리 ⑤ 실패 finally(:352 등)가 coverTrackId 클리어 → 재개 불가.
- When:
  - **fix1 stale closure**: handleTrackSelect가 참조하던 클로저 함수에 **track을 인자로 전달**(state 경유 제거) — 수정 후 해당 함수 시그니처에 track 파라미터 존재 + 호출부 전달 + 함수 본문의 구 state 참조 제거(인자와 state 혼용 잔존 시 FAIL). 가사반영 질문(step 1.75) 도달 조건이 "아티스트 유무와 무관"해졌는지 분기 논증.
  - **fix2**: step-2 자유입력 영역에 '가사 내용 기반으로 생성' 버튼 — 기존 선택지와 **동일 핸들러 경로**(신규 생성 파이프 분기 금지, v3.201 U-6 취지 준용).
  - **fix3**: doRegenerate 본문에서 메시지 배열 와이프(setMessages([...초기]) 류)·step 2 강등 **제거** → 기존 대화에 디렉터 메시지 **append** + 직전 스텝 복귀. `resetCoverExtras()` 호출이 **명시적 '처음부터' 경로에만** 잔존(doRegenerate·실패 경로에서 호출 0건 — grep 전수, :180 hasPendingGeneration 분기의 기존 호출은 재진입 초기화라 유지 판정). 429·일반 실패 공통 경로 확인(:337 onCancel → doRegenerate 배선이 와이프 없는 새 형상으로).
  - **fix4**: performRewind(:598) — U-11과 **동일 패턴 문자 대조**(절단 0건·치환 쌍·이후 보존). + result 모드에서 말풍선 탭 가드 제거(재선택 다이얼로그 :620 도달 가능) — result 모드 치환 후 재생성 트리거 경로 정합.
  - **fix5**: 대화 상태의 zustand 이동 — `stores/musicStore.ts`에 `coverMessages/coverStep/coverExtras/coverLyrics*` 필드 신설(모듈 변수 :51 coverExtras류 → store 이관, **화면 로컬 state와 이중 소스 잔존 시 FAIL** — 원인 ④ 재발). AsyncStorage persist를 새로 붙였다면 범위 초과 기록+재시작 부활 검토 회부(계획의 '영속'은 화면 언마운트 생존 의미로 해석 — hot-reload 유실 이력 메모리 취지와 정합 확인). 실패 finally에서 `coverTrackId`(및 재개 필수 필드) 클리어 **제거** — 클리어는 **성공 경로에만**(grep: finally 블록 내 coverTrackId 클리어 0건, :352-354 주석의 기존 부분 보호와 정합). store 리셋 경로(생성 완료·명시적 새로 시작)에 신설 필드 포함.
- Then: fix1~5 전부 충족 — fix3(resetCoverExtras 잔존)·fix5(finally 클리어 잔존)가 FAIL 게이트.

**U-14. [I-lite] ERR_NETWORK 폴링 복구 — 15s×12·재차감 없음 [unit]**
- Given: 실측 — 서버는 150~180s 동기 처리 완료+별 차감했는데 클라이언트 연결 단절(11/44/153s)로 실패 표시 → 고아. 복구 = 실패 확정 전 `GET /upload/cover-sessions` 폴링으로 완성본 회수(**백엔드 무변경**).
- When: ① 발동 조건: catch에서 `ERR_NETWORK`/타임아웃 **판별 분기**(code/message 판정 — 4xx/5xx 응답 오류는 기존 즉시 오류 유지, 전 오류 폴링화는 과잉으로 FAIL). ② 폴링 파라미터: **15s 간격 × 최대 12회**(총 ~180s = 서버 처리 상한과 정합 — 상수 2개 명시, 하드루프·즉발 재시도 0건). ③ 완성본 식별: cover-sessions 목록에서 **이번 요청 귀속 판정 기준**이 코드에 명시(요청 시각 이후 created_at + trackId/스타일 일치 등 — 기준 부재로 "남의 최신 커버" 오귀속 가능하면 FAIL). ④ **재차감 없음**: 발견 시 성공 처리 경로가 기존 성공 핸들러 **재사용**(이미지 URL 반영·mode 전환)이고 **생성 API 재호출 0건**(doGenerate 재진입 발견 시 즉시 FAIL — 별 재차감). ⑤ 미발견(12회 소진) 시 기존 오류 UI 폴백 + 폴링 중 대기 문구 표시(state 배선). ⑥ 폴링 중 취소/언마운트 시 타이머 정리(clearTimeout/interval — 누락 시 언마운트 후 setState 경고, 기록). ⑦ `services/coverLibraryService.ts`의 기존 list 함수 재사용(:56 — 신규 API 함수 신설이면 기록, 서버 스펙 동일 확인).
- Then: ①~⑤ 충족(⑥⑦ 기록 허용) — ④가 FAIL 게이트.

**U-15. [J] 연주곡 경로 개통 — 진입 2위치·게이트 예외·스킵 체인·배선 4점 [unit]**
- Given: 원인 확정 — vocal='' → 'instrumental' 서버 배선(musicService :268)은 있으나 앱 경로 2중 단절(MusicLoading :210 `store.vocal || undefined`가 ''를 undefined로 삼킴 + VOCAL_OPTIONS(:43 `['남성','여성']`)에 선택지 부재). 수정은 신규 store 필드 `instrumental` 기준으로 전 구간 배선.
- When:
  - ① **진입 카드 2위치**: `ComposeLyricsPickScreen` — 목록 위 + 빈 상태(가사 0개) 양쪽에 '가사 없이 만들기(연주곡)' 카드. onPress = `setLyrics('') + setInstrumental(true) + replace('ComposerSelect')` 3동작(순서 무관·전부 존재 — replace라 뒤로가기 시 Pick 미복귀 확인). **일반 가사 선택 경로에 `setInstrumental(false)` 리셋 존재**(누락 시 연주곡 1회 후 일반 생성이 전부 연주곡화되는 끈적 상태 — FAIL 게이트).
  - ② **게이트 예외 2곳**: ComposerSelectScreen 가사 하드 블록에 `|| store.instrumental` 예외. ComposeLyricsPick 빈 상태('돌아가기'만)는 ①의 카드 추가로 해소 — 두 화면 외 제3의 가사 게이트 grep(`lyrics`가 빈값일 때 차단하는 조건 전수 — MusicGeneration 진입부 포함) 0건 확인.
  - ③ **스킵 체인**: MusicGenerationScreen — instrumental 시 **가사확인 스텝 + 보컬 스텝** 스킵. 스텝 인덱스가 배열 기반이면 **시프트 여부 판정**(v3.129 인덱스 시프트 사고 전례 — 스킵이 "인덱스 건너뛰기"인지 "배열 재구성"인지 확인, 재구성이면 재선택 제외 집합·performRewind idx 매핑 전부 재검증 필요 = 해당 시 U-11 재판정). 스킵된 스텝의 store 필드가 미정의로 남을 때 후속 조립 안전(undefined 가드).
  - ④ **VOCAL_OPTIONS**: 'Instrumental (연주곡)' 추가(가사 있어도 무보컬 선택 가능 — 선택 시 instrumental=true 세팅인지 vocal 문자열 매핑인지 배선 방식 명시). **⑤ export 파급 판정(신규 발견 리스크)**: VOCAL_OPTIONS는 `ArtistResultScreen.tsx`(:32·:1287)·`VoiceManageScreen.tsx`(:19)가 import — 아티스트 보컬 설정 UI에 'Instrumental'이 노출되면 **오파급 FAIL**(아티스트는 연주곡 개념 무관). 해소 형태: MusicGeneration 로컬 확장 배열 사용 또는 소비처 filter — 어느 쪽이든 소비처 2화면 렌더 결과 불변 논증 필수.
  - ⑥ **MusicLoading :210**: `store.vocal || undefined` → instrumental 반영 형태로 수정(`store.instrumental ? '' : (store.vocal || undefined)` 또는 params.instrumental 직접 전달 — musicService :268의 `params.vocal === '' ? 'instrumental'` 기존 배선과 정합, **이중 번역(앱 'instrumental' 문자열을 vocal에 직접 넣는 등)으로 서버 값이 'instrumental'/'') 불일치되면 FAIL**).
  - ⑦ **musicService**: `params.instrumental` 명시 처리 + 연주곡 프롬프트 문장(작곡.md:67 문구 대조) — 기존 :268 폴백과 신설 명시 처리의 우선순위 명확(둘 다 참일 때 단일 결과).
  - ⑧ **musicStore**: `instrumental` 필드 + **리셋 경로 전수**(생성 완료 리셋·새로 시작·claimQueue류 초기화 — 기존 리셋 함수 grep으로 필드 포함 확인, 1곳이라도 누락 시 ①의 끈적 상태 재발).
- Then: ①~⑧ 전부 충족 — ①리셋·⑤파급·⑥번역이 FAIL 게이트.

**U-16. [J] ComposerInputScreen 삭제 — 등록 3곳 제거 + 참조 0건 [unit]**
- Given: v3.131부터 도달 불가 죽은 화면(라이브 작곡 대화 = MusicGenerationScreen) — v3.199 D·v3.201 B 이식분이 죽은 코드에 감(REPORT 정정 대상). 삭제 누락 3곳 중 1곳만 남아도 tsc 오류 또는 죽은 등록 잔존.
- When: ① `screens/ComposerInputScreen.tsx` **파일 삭제**(`git status`에 D). ② App.tsx **등록 3곳 제거**: import(:61)·StudioStackParamList `ComposerInput: undefined;`(:106)·`<StudioStack.Screen name="ComposerInput" …>`(:199) — 3곳 전부 부재. ③ **전역 참조 grep 0건**: `grep -rn "ComposerInput" --include="*.ts*"`(node_modules 제외) = 0건 — navigation.navigate('ComposerInput') 류 문자열 잔존은 tsc가 못 잡는 런타임 크래시 경로(발견 시 FAIL). ④ tsc exit 0(U-1 ②와 교차 — param 타입 삭제로 기존 `NativeStackScreenProps<any,'ComposerInput'>` 참조가 파일과 함께 소멸했는지). ⑤ **REPORT 정정 기록**: REPORT.md에 "v3.199 D(재선택 edit-2)·v3.201 B(자유입력 이식) 중 ComposerInputScreen 분은 죽은 코드였고 v3.202에서 삭제로 폐기" 명기 — v3.201 테스트 결과의 Composer 관련 PASS 항목(U-6~U-8 Composer 절반)이 **라이브 화면 검증이 아니었음**을 주석(테스트플랜 이력 정합). LyricsInputScreen 분은 라이브 — 유지 명확화.
- Then: ①~⑤ 전부 충족.

**U-17. diff 격리 — 1조/2조 파일 목록 + musicStore 공유 접점 [unit]**
- Given: 2개 조 병행 — 접촉 파일이 겹치는 곳은 `stores/musicStore.ts` 1개(1조 J instrumental / 2조 H cover* 필드)뿐이어야 한다.
- When: ① `git status --short` + `git diff --stat`(2_housing): 콘텐츠 diff = 헤더의 허용 목록(1조 8파일+삭제 1 / 2조 7파일 / 공유 1) 내 — VOCAL_OPTIONS 소비처 2화면은 U-15 ⑤ 판정 결과에 따른 조건부(적용 시 커밋 메시지 명기). ② **musicStore hunk 귀속**: diff hunk를 J(instrumental)·H(cover*)로 전수 귀속 — 어느 쪽도 아닌 hunk 발견 시 FAIL. 두 조가 같은 리셋 함수를 수정하면 충돌 병합 결과 필드 누락 여부 정밀 확인(U-15 ⑧·U-13 fix5 교차). ③ DialogueScreen diff = 2조 C분만(1조 접촉 금지). ④ App.tsx diff = J 삭제 3곳만(다른 라우트 무접촉). ⑤ backend·`0_platform` 디렉토리 무접촉. ⑥ 커밋 전략 확인: 1조/2조 커밋 분리든 단일이든 스테이징 목록 명시(mode-only 파일 제외 관행 유지).
- Then: ①~⑥ 전부 충족.

**U-18. v3.191~201 무회귀 — 라이브/죽은 코드 구분 + 라인 귀속 [unit]**
- Given: 접촉 파일 이력 최다 중첩 버전 — MusicGeneration(v3.110/129 스텝·v3.199 D)·Cover(v3.93 재개·v3.189류 보관함)·Dialogue(v3.199 B+v3.200+v3.201 C)·Map(v3.199 C+v3.201)·LyricsInput(v3.201 B)·playback(v3.197)·PlaylistPicker(v3.196/198/201).
- When/Then (앵커 재탐색):
  - ① **v3.197**: U-4로 포섭(셔플 핀·5중 검증·didJustFinish 분기 diff 0).
  - ② **v3.196/198/201 시트·훅**: U-7로 포섭.
  - ③ **v3.110/129**: MusicGeneration STEPS 정의·스텝→store 매핑 — E/F 치환·J 스킵이 매핑 인덱스를 움직였는지(U-15 ③ 교차, 시프트 발견 시 재선택·rewind 전 경로 재판정).
  - ④ **v3.199 B/C/D + v3.200 + v3.201**: DialogueScreen — C(recChip) diff의 라인 귀속(U-9 ⑥). MapScreen — D 산식·안전망 외 diff 0(U-10 ④). 3화면 headerLeft focus 주입·Map focus 클리어 diff 0.
  - ⑤ **v3.200 계측**: creationLogService 무접촉 — E/F 치환·J 스킵이 LISTEN/CANDIDATE_SELECT·가사 버전 커밋 호출부를 지나치는 경로 변화 여부 확인(치환 시 계측 재발화 중복 기록이면 기록·비차단).
  - ⑥ **죽은/라이브 구분 명시**: 이번 무회귀 판정 대상에서 **ComposerInputScreen 관련 이력(v3.199 D 일부·v3.201 B Composer분)은 제외**(삭제로 폐기 — U-16 ⑤ REPORT 정정과 정합). 반대로 LyricsInput v3.201 B분은 라이브 — U-5 ⑤로 무회귀 판정. "삭제된 파일의 이력 항목을 FAIL로 오판"하지 않도록 tester에 명시.
  - ⑦ **v3.93/189 커버 재개**: hasPendingGeneration(:110)·재진입 배선 — fix5 store 이관 후에도 재개 분기 판정식이 신설 필드 기준으로 동작(구 모듈 변수 참조 잔존 시 FAIL).

### [e2e] 실기기 실측 이관 + 정적 대체

**E-1. [A] 배경 재생 Doze 전환 [e2e] — 실기기 전용**: Android 실기기(전원 분리·화면 꺼짐·Doze 유도 15분+): ① 곡 자연 종료 시 다음 곡 전환(프리로드 히트 — [BTDebug] preloadHit:true) ② 차량 BT 환경 재현(가능 시) ③ 프리로드 실패 유도(비행기 모드 토글) 후 [BTDebug] 로그에서 재시도 ≤3회·간격 ≥10s 실측(폭주 재발 = FAIL) ④ 셔플 모드에서 핀 일치. **에뮬 재현 불가 — 정적 대체**: U-2~U-4 완료로 갈음. Doze 실측은 사용자 실기기 이관(원격 [BTDebug] 로그 회수 경로 기존 관행).

**E-2. [J] 연주곡 여정 [e2e] — Suno 실과금 1회, 실기기 이관**: ① ComposeLyricsPick 목록 위+빈 상태 카드 → ComposerSelect(가사 게이트 통과) → MusicGeneration에서 가사확인·보컬 스텝 미노출 → MusicLoading → **생성 1회 실행(과금 인지 하에)** → 서버 요청 payload vocal='instrumental' 확인([BTDebug]/네트워크 로그) → 결과물 무보컬 청취 확인 ② 가사 있는 일반 플로우에서 VOCAL_OPTIONS 'Instrumental (연주곡)' 선택 경로 1회 ③ 연주곡 직후 일반 생성 1회 — instrumental 리셋 확인(U-15 ① 끈적 상태 실측) ④ ArtistResult·VoiceManage 보컬 설정 UI에 'Instrumental' 미노출(U-15 ⑤ 실측). **정적 대체**: U-15·U-16 완료로 갈음(과금 항목이므로 ①은 사용자 판단 하 1회만).

**E-3. [H/I] 커버 실패 복구 여정 [e2e] — 실기기 이관**: ① 커버 생성 중 기내 모드로 ERR_NETWORK 유도 → 대기 문구 노출 → 네트워크 복원 → 폴링이 완성본 회수(별 잔액 **재차감 없음** — 생성 전후 잔액 대조) ② 12회 소진 케이스 → 기존 오류 UI ③ 생성 실패 후 앱 재진입 → coverTrackId 잔존으로 재개 가능(fix5) ④ doRegenerate(다시 생성) → 대화 보존+디렉터 메시지 append(와이프 무) ⑤ 아티스트 0명 계정에서 가사반영 질문 도달(fix1). **정적 대체**: U-13·U-14 완료로 갈음.

**E-4. [B/E/F/G] 재선택 비파괴 여정 [e2e] — 실기기 이관**: ① MusicGeneration 재선택 → 해당 user 버블+디렉터 에코만 새 값, 이후 대화 보존, 최종 프롬프트 반영 ② Cover result 모드에서 말풍선 탭 → 재선택 가능 ③ Lyrics 재선택 모달 소형 기기(≤640dp) 키보드 열림 — 입력행 완전 노출(v3.201 편차 2 해소 실측) ④ Report/Appeal/AlbumCreate 3모달 키보드 가림 무+상단 클리핑 무 ⑤ 아티스트 0명 → '아티스트로 만들기' 탭 → 앱 내 팝업 → 이동 → 복귀 시 작곡 대화 보존 ⑥ recChip 탭 → PolicySheet 가이드, 모드 alert '자세히 보기'. **정적 대체**: U-5·U-6·U-9·U-11·U-12 완료로 갈음.

### [api] 서버 무변경 확인

**A-1. 백엔드 무접촉 + 기존 API 계약 내 소비 [api]**: ① 이번 diff에 서버 코드·`0_platform` 무접촉(U-17 ⑤ 포섭 — [api] 신규 테스트 0건의 근거). ② I-lite가 소비하는 `GET /upload/cover-sessions`는 기존 엔드포인트(coverLibraryService :56) — 요청 파라미터가 기존 스펙(page/limit) 내인지 확인(신규 쿼리 추가 시 서버 계약 위반 FAIL). ③ J의 vocal='instrumental'은 musicService :268에 기왕 존재하던 서버 계약 — 신규 필드 전송 없음 확인. **연주곡 실생성 검증은 Suno 과금이라 E-2 ①로 이관.**

**게이트**: U-1~U-18 전부 PASS 시 머지 허용(E-1~E-4·A-1 실측분은 실기기 이관 — 정적 대체 완료 조건으로 비차단). 핵심 FAIL 게이트 9건 — U-3 ②(재시도 즉발 0건) / U-4 ①②(v3.197 침범) / U-7 ③(훅 hide 0 리셋) / U-8 ②(금지어 4종) / U-11 ①③(절단 0건·이후 스텝 초기화 잔존) / U-13 fix3·fix5(resetCoverExtras 오호출·finally 클리어 잔존) / U-14 ④(생성 재호출=재차감) / U-15 ①⑤⑥(instrumental 리셋·VOCAL_OPTIONS 파급·서버 값 번역) / U-16 ③(ComposerInput 참조 잔존) — 1건이라도 FAIL이면 커밋 금지.

### v3.202 테스트 결과 (tester, 2026-09-21)

| ID | 판정 | 근거 요약 |
|----|------|-----------|
| U-1 | PASS | v3.201 커밋 e48a7ee 완료·2_housing 콘텐츠 diff=v3.202분만(그 외 전부 mode-only) / `npx tsc --noEmit` exit 0 |
| U-2 | **FAIL(②)** | ①✓ eager 트리거 2곳(loadAndPlayTrack 성공·preload 스왑 성공 — 실패 경로 미호출) ③✓ preloadInFlight 공통 가드 ④✓ getNextIndex 핀 재사용. **② 잔여 60s 트리거/창 확장 부재** — 백오프 가드가 20s/85% 창 게이트 **뒤**에 있어 eager 1회 실패 시 다음 재시도가 종곡 20s 전까지 지연(중간 재시도 기회 소실, 계획 '조기 2트리거' 미충족) |
| U-3 | PASS (게이트) | ① `count >= 3` 차단 = 총 3회 정확 ② catch 내 즉발 재호출/setTimeout/재귀 **0건** ③ 성공 시 null·forTrackId 미스매치로 곡 전환 자동 리셋 ④ 모듈 변수 자연 무효 주석 명시 ⑤ 기존 BTDebug 문자열 유지+retry/max 필드 추가 |
| U-4 | PASS (게이트) | 핀 산출·stale/invalid discard·didJustFinish 분기·스왑 성공/폴백·playerStore·MiniPlayer diff 0. `forTrackId: curId` 치환은 값 동일 리팩터(동기 시점 String화), eager 호출 추가는 트리거 신설로 침범 아님 |
| U-5 | PASS | ① center→flex-end **상시** 전환(+overlay paddingBottom insets.bottom+24) — **커밋 메시지에 채택 형태 명기 필요** ② marginBottom 유지 ③ PlaylistPickerSheet :109와 문자 동치 ④ 검산: winH=640·kbH=256 → 클램프 360, 360+256+24=640 항등 성립 ⑤ handleReselectChoice·제외집합·closeReselect diff 0 |
| U-6 | PASS(편차 기록) | ①visible 게이트 ✓ ②**편차**: -kbPad 전량 대신 `-(kbPad+insets.bottom)/2` = **-kbH/2 재중앙식**. 검산: 가시영역 [0, winH-kbH] 중앙으로 가려면 필요 상향 = winH/2-(winH-kbH)/2 = **kbH/2 = (kbPad+insets.bottom)/2 정확 일치**. translateY는 post-layout 1:1 반영이라 v3.201 '절반 손실'(Yoga margin 분배)과 무관 — 클램프(maxHeight ≤ winH-kbH-insets.top-24 = 가시영역-24)와 결합 시 상하 클리핑 0 증명. 계획 문언(-kbPad)보다 우월(과리프트로 인한 상단 클리핑 원천 차단) — 오케스트레이터 확인 권고 ③✓ ④iOS kbPad=0→무효과 ⑤3파일 완전 동형 ⑥핸들러 diff 0. 기록: Math.max(240,…) 하한이 초소형 기기(가시영역<264)에서 미세 넘침 허용 |
| U-7 | PASS (게이트) | 훅·PlaylistPickerSheet diff 0, hide→무조건 0 리셋 존속 |
| U-8 | PASS (게이트) | ② 금지어 4종+우회 변형 grep **0건** ①{label,body} 관행 일치 ④기존 상수 diff 0. **기록(③)**: "법적 효력을 보장하지 않는다" 류 한계 고지 부재 — 오케스트레이터 문구 검토 회부(부정형 '보장하지 않음'도 grep '보장'에 걸리는 딜레마 있음 — "법적 효력이 자동으로 생기는 것은 아닙니다" 류 권고) |
| U-9 | PASS | ①Touchable+Feather info+onPress ✓ ②PolicySheet 재사용(props visible/title/body/onClose 동형)·신규 컴포넌트 0(untracked는 기존 scratchpad뿐) ③showAlert '자세히 보기'·RN Alert 0건 ④라벨 무변경 ⑤recChip 탭 = no-op 가드 밖 경로 ⑥diff가 import·state·alert 버튼·recChip JSX·시트 렌더에 국한(v3.200/201 라인 무침범) |
| U-10 | PASS | ① `Math.max(90, screenWidth - (user ? 300 : 90))` 정확 일치 ②360→90 발동·412→112·267≤300 ✓ ③안전망 정확히 2키 ④deps 5요소 유지·headerLeft 키 부재·focus 클리어·Marquee nameMaxWidth 참조 유지 |
| U-11 | PASS (게이트) | ①performRewind·commitExchange에 slice/splice/length 절단 0건(:412·:532 slice는 무관 라인) ②치환 쌍: user 버블 text만 교체(step 보존)+에코는 **echoOfStep===target 메타 매치**(코드 명시·암묵 idx+1 아님) — 에코 수 불일치 시 초과분 보존 정책 주석화 ③구 필드 초기화 루프 전면 삭제·핸들러가 새 값 세팅(step12 자동스킵도 되감기 중 차단) ④다이얼로그 문구 비파괴로 갱신·값 입력 선행 ⑤로컬 state 이원화 없음. 기록: step12 자동스킵 버블은 step 태그 없어 되감기 대상 제외(설계 정합) |
| U-12 | PASS | ①게이트 제거—조회 실패도 0명 취급으로 단계 진행(로드 전 탭 불가: await 후 step 200) ②showAlert+[취소/이동] ③Dialogue push params가 MapScreen 형상과 문자 대조 일치(role 문자열·y=340 동일, 동일 StudioStack 라우트) ④navigate=push·reset 0건·focus 시 refreshArtists ⑤기존 ≥1명 흐름 동일(건너뛰기 번호 산식만 0명 대응) |
| U-13 | PASS(편차 1) (게이트 2건 통과) | fix1 ✓ track 인자 전달+인자 우선(state 폴백은 무인자 호출부용 — handleTrackSelect가 store도 선기록해 stale 원천 제거)·1.75 도달 아티스트 무관 / fix2 ✓ handleLyricsUse(2) 동일 핸들러(신규 파이프 0) — 기록: 성공 시 디렉터 확인 버블 없음+라벨 '생성'이나 실제 동작은 발췌 반영 후 step2 잔류 / fix3 ✓ 와이프 제거→append+마지막 답변 스텝 복귀, **resetCoverExtras 호출 = mount 신규시작·앨범모드(false)·곡변경(step0)만 — doRegenerate·실패 경로 0건** / fix4 ✓ 비파괴 치환+result 탭 개방(mode==='loading'만 차단) — **편차**: step 0(곡 변경)만 slice 파괴 유지(전용 경고 다이얼로그 병행, 곡 변경 시 이후 선택 전부 무효라 논리 타당 — 오케스트레이터 승인 요) / fix5 ✓ coverMessages/coverStep/coverExtrasSnapshot/coverLyrics* store 이관(applyExtras 단일 통로 미러+마운트 hydrate — 직접 대입 잔존 0), AsyncStorage 미도입(언마운트 생존 의미 정합), **finally 블록 자체 삭제·clearCoverContext는 성공 2경로만**, 실패는 coverStyle만 해제(hasPendingGeneration=coverTrackId&&coverStyle 강화판과 정합) |
| U-14 | PASS (게이트 통과) | ①`!err.response && (ERR_NETWORK|ECONNABORTED|/network|timeout/)` — 4xx/5xx 제외 ✓ ②15000×12 상수 명시·선대기 후 폴링 ③귀속 기준 코드+주석 명시(t0−120s·cover_object_name·최신 1건) — **권고**: 120s 창 내 직전 생성 오귀속 이론상 가능(세션 row에 track_id 있으면 매치 추가) ④**생성 API 재호출 0건**·fetchBalance로 잔액 동기화만 ⑤12회 소진→기존 오류 UI+recoveryNotice 배선 ⑥기록: 언마운트 시 폴링 중단 없음(최대 3분 setState 경고 가능) ⑦기록: coverLibraryService 함수 대신 api 직호출(동일 엔드포인트·page/limit 스펙 내) |
| U-15 | PASS (게이트 3건 통과) | ①카드 단일 배치가 목록 위+빈 상태 겸용(entries 무관 상시)·3동작+900ms replace·**handlePick setInstrumental(false) 존재** ②ComposerSelect 2곳 예외+제3 가사 게이트 grep 0건 ③조건 분기 스킵(배열 재구성 없음 — 인덱스 시프트 0, U-11 재판정 불요)·proceedGenerate가 보컬/페르소나 명시 공백 ④INSTRUMENTAL_OPTION 로컬 상수+렌더 시 확장·선택=setInstrumental(true) 플래그 방식 ⑤**VOCAL_OPTIONS 배열 무변경·소비처 2화면 diff 0**(렌더 불변 자동 충족) ⑥**MusicLoading `store.instrumental ? '' : (store.vocal||undefined)`+instrumental 플래그 → musicService 단일 번역 `'instrumental'`**(이중 번역 없음) ⑦연주곡 프롬프트 = 작곡.md:67 문자 일치 — 기록: 구 암묵 폴백(vocal===''→) 제거(죽은 분기 정리, 우선순위 단일화) ⑧reset()=initialState(instrumental:false 포함)+진입 정규화(ComposeLyricsPick·ComposerSelect — LyricsResult:112/LyricsBook:150 모두 setLyrics 선행 확인, 끈적 누수 경로 부재). 기록: ComposerSelect 정규화가 lyricsStore.generatedLyrics 단독 케이스 미검(현 진입 4경로 전부 musicStore.lyrics 세팅이라 실경로 없음 — 방어적 보강 권고). isDuet+instrumental 동시 전송 가능(서버 영향 미미, E-2 실측) |
| U-16 | **FAIL(③⑤)** | ①파일 삭제 D ✓ ②App.tsx 3곳 제거 ✓ ④tsc 0 ✓. **③ FAIL: `screens/DialogueScreen.tsx:68` 로컬 StudioStackParamList에 `ComposerInput: undefined;` 잔존** — 이 타입 키가 살아있는 한 DialogueScreen에서 navigate('ComposerInput')이 타입 통과 후 런타임 크래시하는 문이 열려 있음(게이트 정의 그대로). 부수(비차단 기록): App.tsx:61·ComposerSelect:65 삭제 주석, MapScreen:310 이력 주석의 'ComposerInput' 문자열. **⑤ FAIL: REPORT.md·REPORT_v3.md에 v3.202 정정 기록(죽은 코드 폐기·v3.201 Composer PASS 항목 주석) 미기재** |
| U-17 | PASS(편차 1) | ①콘텐츠 diff = 허용 목록 내 + **`types/index.ts`(+2, MusicParams.instrumental — 허용 목록 외이나 J 배선 필수분)** → 커밋 메시지 명기 조건부 ②musicStore hunk 전수 귀속: J=instrumental 6 hunk / H=cover* 타입·필드·액션 — 무귀속 hunk 0, 공유 리셋 함수 수정 없음 ③DialogueScreen diff=C분만 ④App.tsx=J 3곳만 ⑤0_platform 156건 전부 mode change 100644→100755(콘텐츠 0)·서버 코드 무접촉 ⑥스테이징 목록 하단 확정 |
| U-18 | PASS | ①U-4 ②U-7 포섭 ③스텝 번호 체계 유지(조건 분기) — 매핑 인덱스 불변 ④DialogueScreen C 귀속·MapScreen D 국한·headerLeft/focus diff 0 ⑤creationLogService 무접촉(diff 0) ⑥Composer 이력 제외 적용·LyricsInput B분은 U-5 ⑤로 무회귀 확인 ⑦hasPendingGeneration 강화판이 신설 store 필드 기준 — 구 모듈 변수 참조 잔존 0. 기록: clearCoverContext가 앨범 모드 성공 시 coverCharacterObjectName 미정리(구 finally는 무조건 정리) — 유령 포함 엣지, E-3 실측 항목에 추가 |
| E-1~E-4 | 정적 대체 완료 | 실기기 이관(하단 목록) |
| A-1 | PASS | ①0_platform·백엔드 콘텐츠 diff 0(mode-only뿐) ②cover-sessions page=1/limit=5 기존 스펙 내 ③body에 신규 필드 없음 — instrumental은 앱 내부 파라미터, 서버 전송은 기존 vocal='instrumental'뿐 |

**게이트 판정: 커밋 금지.** 핵심 FAIL 게이트 9건 중 **U-16 ③ 1건 FAIL**(DialogueScreen:68 ComposerInput 타입 키 잔존). 비핵심 FAIL 2건: U-2 ②(60s 조기 트리거 부재), U-16 ⑤(REPORT 정정 미기재).

**수정 지시 (3건 — 완료 후 재판정 없이 커밋 가능, 모두 기계적 수정)**
1. [1조] `screens/DialogueScreen.tsx:68` `  ComposerInput: undefined;` 1줄 삭제 (tsc 재확인 — navigate 호출부 0건이라 안전).
2. [1조] `services/playback.ts` — 창 합집합 확장: `PRELOAD_EARLY_LEAD_MS = 60_000` 상수 신설 후 비-eager 게이트를 `if (remaining > PRELOAD_LEAD_MS && remaining > PRELOAD_EARLY_LEAD_MS && positionMillis / durationMillis < PRELOAD_RATIO) return;` 형태(또는 동치 union)로 — 기존 20s/85% 상수 삭제·변경 금지, 백오프(10s 간격·3회)는 그대로 이 확장 창 안에서 동작.
3. [양조] REPORT.md(v3.202 절)에 정정 기록: "v3.199 D(재선택 edit-2)·v3.201 B(자유입력 이식) 중 ComposerInputScreen 분은 죽은 코드였고 v3.202에서 삭제로 폐기 — v3.201 U-6~U-8의 Composer 관련 PASS는 라이브 화면 검증이 아니었음. LyricsInputScreen 분은 라이브 유지."

**커밋 메시지 명기 사항**: ① U-5 B안1 = 상시 flex-end 채택 ② U-6 리프트 산식 = 재중앙 -(kbPad+insets.bottom)/2 (계획 -kbPad 대비 편차·수학 검산 완료) ③ types/index.ts 허용 목록 외 접촉(MusicParams.instrumental) ④ U-13 fix4 step 0(곡 변경) 파괴 유지(경고 다이얼로그 병행).

**커밋 스테이징 목록 (2_housing/, mode-only 파일 제외 관행 유지)**: App.tsx / types/index.ts / stores/musicStore.ts / services/playback.ts / services/musicService.ts / hooks 무 / screens/ComposeLyricsPickScreen.tsx / screens/ComposerSelectScreen.tsx / screens/CoverGenerationScreen.tsx / screens/DialogueScreen.tsx / screens/LyricsInputScreen.tsx / screens/MapScreen.tsx / screens/MusicGenerationScreen.tsx / screens/MusicLoadingScreen.tsx / **screens/ComposerInputScreen.tsx (삭제 D)** / components/ReportModal.tsx / components/AppealModal.tsx / components/AlbumCreateModal.tsx / constants/consentTexts.ts + 산출물(PLAN/REPORT/TESTPLAN). 그 외 M(assets·문서 등 mode-only)·untracked(scratchpad·이식 로드맵 md) 제외.

**실기기 이관 잔여**: E-1 ①③④(Doze 프리로드 히트·백오프 ≤3회/≥10s 실측·셔플 핀) / E-2 ①~④(연주곡 실생성 1회 — Suno 과금 사용자 판단·payload vocal='instrumental'·끈적 리셋·소비처 미노출) / E-3 ①~⑤(폴링 회수·잔액 재차감 없음 대조·12회 소진·재개·append·0명 1.75 도달 + **앨범 모드 성공 후 다음 트랙 커버에 아티스트 유령 포함 여부**) / E-4 ①~⑥(비파괴 재선택·result 탭·소형기기 키보드 3모달+재선택 모달·0명 CTA 왕복 보존·recChip 시트).

## v3.203 — 수정일 2026-09-22

> 대상: PLAN.md v3.203 — **연주곡(instrumental) 파이프라인 완성: 곡 길이 지정 + 백엔드 게이트 개통**. 백엔드(**prod 직접 배포**): `generate.py:636` will_start_music 게이트가 연주곡(vocal='instrumental', lyrics='')을 시작하도록 수정, `suno_generator.py` use_custom instrumental 예외 + **Suno V6 duration 파라미터(10~360초) 전달 신설 — 연주곡+V6 교집합 한정**. 앱: 연주곡이면 작곡 디렉터 질문 **5개 한정**(장르→분위기→**곡 길이(신규 step 310, 1~6분+자동)**→참고곡→BPM→완료), 아티스트/보컬/내목소리/제외/자유도/실험/참고음세기/키 **8종 질문 제거**. ComposeLyricsPickScreen 잔존 제목 클리어. `musicStore.durationSec` 신설, musicService body `duration = instrumental && durationSec ? durationSec : 120`. 되감기(비파괴 치환·echoOfStep — v3.202 U-11 합격 구조)에 step 310 편승.
> **회귀 지뢰(이번 사이클 최우선 게이트)**: 앱은 종전부터 **전 곡 duration:120 고정 전송** — 백엔드가 이 값을 일반곡에도 Suno로 흘리면 **서비스 전 곡 2분 클램프**(전면 회귀). duration의 Suno 전달은 **연주곡+V6에서, 사용자가 길이를 지정한 경우에만** 성립해야 한다(판별식이 A-3 ⑤의 본체).
> 실행 환경 관행(v3.191~202 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 **코드 정적 검증 대체 병기 + 실기기 수동 절차 이관**. 앱 코드 `/Users/pearl/TripleJ/2_housing`, 백엔드 워크트리 `/Users/pearl/TripleJ-backend`(prod 반영은 rsync — **A-3 PASS 전 배포 금지, 배포 직후 A-5 스모크 필수**). 백엔드 unit은 **서버 컨테이너 내 python으로 함수 직접 호출 또는 curl 기반 [api]**로 수행. **시크릿·실계정 크리덴셜 기재 금지**(계정은 `TEST_USER_EMAIL` 플레이스홀더로만 표기), **실사용자 데이터 접근 금지 — Suno 실호출 스모크(E-3)는 테스트 계정을 신규 생성**해 수행하고 compose 15⭐ 과금은 1회만 허용. 모든 실측 증적에 추적자 **gen_id**(생성 요청 ID)를 병기해 앱 로그↔서버 로그↔결과물을 단일 사슬로 귀속한다.

### [unit] 앱 정적 검증 (머지 게이트)

**U-1. 선행 게이트 — v3.202 커밋 기준선 + 타입 무결성 [unit]**
- Given: v3.202 수정 지시 3건(DialogueScreen:68 타입 키 삭제·playback 60s 창 확장·REPORT 정정) 반영 커밋이 선행돼야 이번 diff 귀속 판정(U-8)이 성립.
- When: ① `git log --oneline -1` + `git status --short`(2_housing 스코프)로 클린 기준선 확인(미커밋 시 착수 금지·반려). ② 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: ① 클린 기준선 ② exit 0.

**U-2. [항목1] 연주곡 질문 체인 — step 310 신설 + 잉여 8종 도달 불가 [unit]**
- Given: 연주곡이면 디렉터 질문 5개 한정. 스킵은 v3.202 U-15 ③ 합격 형상(조건 분기 스킵·배열 재구성 금지·인덱스 시프트 0)을 계승해야 한다 — 재구성 발견 시 재선택 제외 집합·performRewind idx 매핑 전부 재판정(v3.129 시프트 사고 전례).
- When: `screens/MusicGenerationScreen.tsx` — ① instrumental 경로 스텝 체인이 **제목확인→장르→분위기→step 310(곡 길이)→참고곡→BPM→완료** 순서로 코드상 성립(각 스텝의 next 판정 분기 추적). ② 잉여 8종(아티스트·보컬·내목소리·제외·자유도·실험·참고음세기·키) 스텝이 instrumental 경로에서 **도달 불가 논증**(각 스텝 진입 게이트 grep 전수 — 1종이라도 도달 경로 잔존 시 FAIL). ③ step 310 선택지 = **1~6분 + '자동'**(7개), 각 핸들러가 durationSec 60/120/180/240/300/360 · '자동'→null 세팅(값 매핑 표 문자 확인). ④ 스킵된 스텝의 store 필드가 undefined로 남을 때 프롬프트/요약 조립부 안전(undefined 가드 — 크래시·"undefined" 문자열 노출 0). ⑤ 배열 기반이면 시프트 여부 판정(재구성 시 U-5 재판정).
- Then: ①~④ 전부 충족(⑤ 조건부).

**U-3. [항목2] durationSec 배선 — 저장·body 조립·자동 분기 [unit]**
- Given: `musicStore.durationSec` 신설, musicService body `duration = instrumental && durationSec ? durationSec : 120`. 일반곡 body는 **기존 계약(120 고정) 불변**이어야 앱 쪽 회귀 0.
- When: ① `stores/musicStore.ts` — `durationSec: number | null` 필드 + **리셋 경로 전수**(reset()/initialState·새로 시작·진입 정규화 — v3.202 U-15 ⑧ 관례로 기존 리셋 함수 grep, 1곳 누락 시 이전 선택 길이가 다음 곡에 이월되는 끈적 상태 FAIL). ② `services/musicService.ts` body 조립식이 `instrumental && durationSec ? durationSec : 120` 동치 — **비연주곡 분기 결과가 모든 입력에서 120**(기존 전송값과 비트 동일) 논증. ③ 3분 선택 → durationSec=180 → body duration=180 경로 추적(스텝 핸들러→store→body 3점 연결). ④ '자동' → durationSec=null → body duration=120(연주곡인데도 120 — 서버 판별식과의 정합은 A-3 ⑤에서 교차 판정). ⑤ [BTDebug] 로그에 duration·gen_id 병기 기록 존재(부재 시 기록 — E-3 실측 추적용).
- Then: ①~④ 전부 충족(⑤ 기록 허용) — ①②가 FAIL 게이트.

**U-4. [항목3] 가사 기반 연주곡 — 보컬 스텝 Instrumental 선택 체인 [unit]**
- Given: 가사가 있어도 보컬 스텝에서 Instrumental 선택 시 무보컬 생성. v3.202 U-15 합격 배선(INSTRUMENTAL_OPTION 로컬 확장·musicService 단일 번역 'instrumental') 위에 step 310이 끼어든다.
- When: ① 보컬 스텝 Instrumental 선택 시 instrumental=true + **lyrics 클리어 0건**(가사 유지 — setLyrics('') 호출 발견 시 FAIL). ② 선택 후 체인 = **곡 길이(310)→참고곡→BPM→완료**(내목소리·키 등 보컬계 후속 질문 미노출 논증). ③ 서버 값 번역이 **musicService 단일 지점**의 'instrumental' 유지(v3.202 U-15 ⑥ — 앱 문자열을 vocal에 직접 넣는 이중 번역 발견 시 FAIL). ④ VOCAL_OPTIONS 원배열 무변경·소비처 2화면(ArtistResult·VoiceManage) diff 0 존속(v3.202 U-15 ⑤ 무회귀).
- Then: ①~④ 전부 충족.

**U-5. [항목4] 되감기 회귀 — step 310 편승 + Instrumental 해제 시 durationSec null [unit]**
- Given: v3.202 U-11 합격 구조(map 치환·echoOfStep 메타 매치·절단 0건)에 step 310이 편승. 보컬 재선택으로 연주곡이 해제되면 곡 길이 값은 **의미를 잃으므로 반드시 null**이어야 한다(잔존 시 다음 일반곡 body에 오염 가능).
- When: ① step 310 버블 재선택 = 비파괴 치환: performRewind에 slice/splice/length 절단 **0건 존속**(grep — v3.202 U-11 ① 문자 대조), user 버블+echoOfStep===310 에코 치환 쌍, durationSec 새 값 반영, 이후 대화·스텝 보존. ② **보컬 스텝 Instrumental→성별 재선택 시**: instrumental=false 해제 + **durationSec=null** + 곡 길이(310) 버블·에코의 처리 정책이 코드에 명시(잔존 에코 값이 최종 프롬프트/body에 반영되는 경로가 남으면 FAIL — 표시 잔존 자체는 정책 주석화로 허용). ③ 역방향(성별→Instrumental 재선택) 시: instrumental=true 재진입 + 보컬계 후속 store 값(내목소리·키 등)이 body에 실리지 않는 논증. ④ 재선택 제외 집합·기존 스텝의 되감기 배선 diff 0(v3.202 형상).
- Then: ①~③ 충족(④ 교차) — **② durationSec null 누락 = FAIL 게이트**.

**U-6. [항목5] 일반(가사) 흐름 회귀 0 [unit]**
- Given: 이번 diff는 연주곡 분기 신설이 전부여야 하고, 비연주곡 경로는 스텝 순서·질문 문구·body까지 diff 0이어야 한다.
- When: ① STEPS 정의·스텝→store 매핑에서 비연주곡 경로의 순서·문구 **무변경**(v3.110/129 앵커 — 신설 310이 일반 경로 next 판정에 개입하지 않는 분기 논증). ② body duration=120 불변(U-3 ② 포섭). ③ 일반 경로 되감기·재선택·step12 자동스킵 diff 0. ④ Suno에 duration 미전달은 서버 게이트 소관 — [api] A-3 ②로 교차(앱 단독으로는 판정 불가 명시).
- Then: ①~③ 전부 충족 — ①이 FAIL 게이트.

**U-7. ComposeLyricsPickScreen 잔존 제목 클리어 [unit]**
- Given: 연주곡 카드 진입 시 직전 가사 선택의 제목이 store에 잔존해 연주곡 산출물에 오염되는 결함.
- When: ① 연주곡 카드 onPress 3동작(setLyrics('')+setInstrumental(true)+replace — v3.202 U-15 ① 형상)에 **제목 클리어 추가**(setTitle('') 류) 확인. ② 일반 가사 선택 경로(handlePick)의 제목 세팅·setInstrumental(false) 리셋 무회귀. ③ 클리어가 연주곡 경로에만 국한(일반 경로 제목까지 지우면 역결함 FAIL).
- Then: ①~③ 전부 충족.

**U-8. diff 격리 + v3.202 무회귀 [unit]**
- Given: 접촉 예상 — 앱: `screens/MusicGenerationScreen.tsx`·`screens/ComposeLyricsPickScreen.tsx`·`stores/musicStore.ts`·`services/musicService.ts`(+`types/index.ts` durationSec 타입 필요분) / 백엔드: `generate.py`·`suno_generator.py` 2파일.
- When: ① `git status --short`+`git diff --stat`: 콘텐츠 diff가 위 목록 내(목록 외 접촉 시 커밋 메시지 명기 조건부 — v3.202 U-17 관례). ② musicStore hunk 전수 귀속: durationSec분과 기존 instrumental/cover* 필드 무접촉(공유 리셋 함수 수정 시 v3.202 신설 필드 누락 여부 정밀 확인). ③ v3.202 합격 형상 무회귀: playback 60s 창·LyricsInput flex-end·모달 3곳 리프트·CoverGeneration fix1~5·MapScreen 산식 — 전부 **diff 0**. ④ `0_platform` 무접촉. ⑤ 백엔드 diff가 generate.py 게이트+suno_generator.py 2파일에 국한(타 라우터·모델 접촉 시 FAIL).
- Then: ①~⑤ 전부 충족.

### [api] 백엔드 unit·계약 (서버 컨테이너 python 직호출 / curl — 머지·배포 게이트)

**A-1. will_start_music 3케이스 — 연주곡 True·draft False·기존 동일 [api]**
- Given: `generate.py:636` 게이트 수정. 최대 리스크는 "빈 가사" 판정 완화가 **초안(draft) 저장까지 생성 시작**시켜 의도치 않은 과금을 일으키는 것.
- When: 서버 컨테이너 내 python으로 게이트 함수/판정식 직접 호출(불가 시 스테이징 성격의 curl 대체 — 단 실생성 트리거는 E-3 1회로 제한하므로 판정식 단위 검증 우선):
  - ⓐ vocal='instrumental', lyrics='' → **True**(연주곡 시작 — 과금 발생 경로임을 케이스에 명기).
  - ⓑ 빈 가사 + 빈 보컬(연주곡 의도 아님, draft 저장류) → **False**(초안 유지 — True로 뒤집히면 **과금 사고 FAIL 게이트**). instrumental 판별이 vocal 값 명시 매치인지, "빈 가사면 전부" 완화인지 판정식 문자 확인.
  - ⓒ 가사 있음(일반곡) → 기존과 **동일 판정**(수정 전후 진리표 대조 — 기존 True/False 케이스 각 1점 이상).
- Then: 3케이스 전부 + 기대 로그: ⓐ에서 `[generate] instrumental start gen_id=<id>` 출력 배선 존재 — **ⓑ가 FAIL 게이트**.

**A-2. use_custom instrumental 예외 + prompt_text 빈가사 폴백 [api]**
- Given: `suno_generator.py` — 종전 use_custom은 가사 존재를 전제. 연주곡은 lyrics=''이므로 예외 없이는 non-custom 경로로 굴러떨어져 스타일·BPM 지정이 소실된다.
- When: ① use_custom 판정에 instrumental 예외 존재(연주곡이면 가사 없어도 custom 성립) + **비연주곡 판정 diff 0**(예외가 일반곡 판정을 건드리면 FAIL). ② prompt_text 조립: lyrics='' 시 빈 문자열/None으로 Suno에 전달되지 않는 폴백(스타일 서술 폴백 문구 확인 — Suno 400/거절 방지). ③ personaModel 등 보이스 필드가 연주곡에서 미전송(무보컬인데 voice_persona 실리면 모순 — 발견 시 기록·판정 회부).
- Then: ①② 충족(③ 기록 허용).

**A-3. duration 게이트 — 클램프(10~360)·비V6 미전달·비연주곡 미전달 [api] — 회귀 지뢰 게이트**
- Given: 앱은 전 곡 duration:120 고정 전송(기존 계약). Suno 전달은 연주곡+V6+사용자 지정에서만.
- When: 함수 직호출로 페이로드 조립 결과 검사:
  - ① **클램프 경계 5점**: 입력 9→10, 10→10, 180→180, 360→360, 361→360 (min/max 연산자 경계 확인 — `<` vs `<=` 오차 판정).
  - ② **비연주곡 미전달**: 일반곡 + body duration=120 → Suno 페이로드에 duration 키 **부재**(dict 조립 코드 grep + 조립 결과 실검사 — **키 존재 시 즉시 FAIL: 서비스 전 곡 2분 클램프 회귀**).
  - ③ **비V6 미전달**: 연주곡 + 비V6 모델 → duration 미전달(V6 판별 문자열이 suno-model-version-policy의 V6 표기와 일치하는지).
  - ④ 연주곡+V6+180 → duration=180 전달 + 로그 `[suno] customMode=True instrumental=True duration=180 gen_id=<id>` 배선.
  - ⑤ **'자동' 판별식**: 연주곡+V6+body 120(자동) → Suno duration **미포함**이 계획 확정치 — 서버가 무엇으로 "지정 안 함"을 판별하는지 코드 명시 확인(120을 기본값 간주라면 "사용자가 일부러 2분 선택" 케이스와의 충돌을 판정·주석화, 별도 필드/None 전달이면 앱 U-3 ④와 계약 정합 대조). **판별 기준 부재로 자동 선택이 120초 강제 클램프되면 FAIL**.
- Then: ①~⑤ 전부 충족 — **②⑤가 FAIL 게이트**.

**A-4. 인접 회귀 — 창작기록·참고음악·429·발매 폴백 [api]**
- Given: [항목8] — 연주곡 신설 경로가 기존 계측·게이트를 우회하거나 null을 흘리면 안 된다.
- When: ① 창작기록 GEN_REQUEST/GEN_RESPONSE(v3.200)가 **연주곡 생성에도 기록**(gen_id 귀속 — 게이트 수정으로 계측 호출부를 지나치는 경로 신설 여부 diff 추적) + 일반곡 기록 diff 0. ② 참고음악 업로드 엔드포인트 기존 스펙 정상(연주곡 참고곡 스텝이 동일 소비 — 신규 파라미터 0). ③ **429 피로 게이트 존속**: 연주곡 요청도 동일 게이트 통과(instrumental 분기가 게이트 앞단에서 갈라져 우회하면 FAIL). ④ 연주곡 발매 시 아티스트명 폴백: 아티스트 스텝 스킵으로 artist 미지정 → 발매 track의 표기 명칭이 폴백 적용(null/undefined 노출 0 — 폴백 문자열 확인).
- Then: ①~④ 전부 충족 — ③이 FAIL 게이트.

**A-5. 배포 스모크 — health·기존 API·기동 로그 [api]**
- Given: [항목9] prod 직접 배포(rsync) — A-1~A-3 PASS 후에만 배포, 배포 직후 즉시 실행.
- When: ① `curl <prod>/health` → 200. ② 기존 API 3종: 로그인(테스트 계정 TEST_USER_EMAIL)·차트·트랙 목록 → 200 + 응답 스키마 기존형(필드 누락 0). ③ 서버 기동 로그 traceback/import 오류 0(연주곡 미관련 경로 기동 실패 즉시 검출). ④ 배포 직후 실트래픽 로그에서 일반곡 Suno 호출 grep → duration 키 부재 재확인(A-3 ② prod 실측 — **가장 값싼 회귀 지뢰 조기 경보**).
- Then: ①~④ 전부 충족 — FAIL 시 즉시 롤백(rsync 이전본) 후 원인 회부.

### [e2e] 핵심 여정 (정적 대체 + 실기기 수동 절차 이관)

**E-1. [항목1] 연주곡 카드 진입 여정 [e2e]** — 정적 대체: U-2·U-3·U-7 완료로 갈음. 실기기 수동 절차: 테스트 계정 로그인 → 작업실 → ComposeLyricsPick **연주곡 카드**(목록 위·빈 상태 양 위치) → 제목확인→장르→분위기→곡 길이(3분)→참고곡→BPM→완료 순서 육안 확인 + **잉여 8종 질문 미노출** 전수 체크리스트. 이전 가사 제목 잔존 오염 무(U-7 실측). 생성 실행은 과금이므로 여기서 중단 — 실생성·payload는 E-3에 통합.

**E-2. [항목3] 가사 기반 연주곡 여정 [e2e]** — 정적 대체: U-4 완료로 갈음. 실기기 수동 절차: 가사 선택 → 일반 체인 진행 → 보컬 스텝에서 **Instrumental** 선택 → 곡 길이→참고곡→BPM→완료, 가사가 요약/미리보기에 유지되는지 + 보컬계 후속 질문 미노출. [BTDebug] 조립 로그로 vocal='instrumental'·가사 유지 확인(생성 미실행 — 실호출 payload는 E-3 관례 준용).

**E-3. [항목7] Suno 실호출 스모크 — 1회 한정 [e2e]**
- Given: **테스트 계정 신규 생성**(TEST_USER_EMAIL 플레이스홀더 — 실사용자 계정·데이터 접근 금지, 증적에 토큰·개인 식별 정보 기재 금지), compose 15⭐ 과금 허용 1회.
- When: 연주곡 경로로 **Jazz·로맨틱·3분(180s)·BPM90** → 생성 1회 실행 → 완료 대기.
- Then: ① 상태 **completed**. ② 서버 로그 사슬: `[generate] instrumental start gen_id=<id>` → `[suno] customMode=True instrumental=True duration=180 gen_id=<id>` — **동일 gen_id로 앱 [BTDebug] duration=180 로그와 3점 대조**. ③ 결과물 청취: 무보컬 + 재생 길이 ≈180s(±허용 오차 실측 기록 — Suno duration의 실효 정밀도가 이번 최초 데이터). ④ 별 잔액 정확히 −15(생성 전후 잔액 대조 — 재차감 0). ⑤ 창작기록 GEN_REQUEST/RESPONSE row 생성(A-4 ① 실측 교차). ⑥ **실패 시**: 환불 로그 + 잔액 원복 확인(실패도 판정 데이터 — 환불 미발동 시 FAIL 회부). '자동' 케이스 실측(추가 15⭐)은 사용자 판단 하 선택 — 미실행 시 U-3 ④·A-3 ⑤ 정적 판정으로 갈음.

**E-4. [항목5] 일반 흐름 회귀 여정 [e2e]** — 정적 대체: U-6·A-3 ② 완료로 갈음. 실기기 수동 절차: 일반 가사 곡 흐름 전 스텝 순서·질문 육안 불변(v3.202 대비 스크린 대조) + 되감기 1회 정상. 실생성 추가 과금 없이 **배포 후 실트래픽 서버 로그 grep으로 일반곡 Suno duration 키 부재 확인**(A-5 ④와 동일 증적 공유) — 기존 사용자 곡이 2분 클램프되지 않는지 배포 직후 최우선 감시.

**게이트**: U-1~U-8 + A-1~A-4 전부 PASS 시 머지 허용, **A-1~A-3 PASS 전 prod 배포 금지**, 배포 직후 A-5 필수(FAIL 시 즉시 롤백). E-1~E-4는 정적 대체 완료 조건으로 비차단(실기기·실과금분은 사용자 판단 하 이관, 단 E-3 스모크 1회는 이번 사이클 완료 조건). 핵심 FAIL 게이트 8건 — **A-1 ⓑ**(draft 오발사=과금 사고) / **A-3 ②**(일반곡 duration 전달=전 곡 2분 클램프) / **A-3 ⑤**(자동 판별식 부재) / **A-4 ③**(429 게이트 우회) / **U-3 ①②**(durationSec 리셋 누락·일반곡 body 120 불변) / **U-5 ②**(Instrumental 해제 시 durationSec null 누락) / **U-6 ①**(일반 스텝 순서·문구 침범) — 1건이라도 FAIL이면 커밋·배포 금지.

## v3.204 — 수정일 2026-09-22

> 대상: PLAN.md v3.204 — **디렉터 대화 편집 UX 통일(작사 방식) + 커버 질문 순서·중복 버튼 정리 + 미세조정 오류 복구 + 후보 재생바 시크 + 튜토리얼 오버레이 신설**. ① MusicResultScreen 진행바 2곳(:618~631 비교 카드·:655~672 단일 플레이어)을 `@react-native-community/slider`로 교체 — PlayerScreen 검증 패턴(isSeekingRef·seekValue·onSlidingComplete→setPositionAsync) 이식, LISTEN `{action:'seek', from_ms, to_ms}`를 onSlidingComplete에서만 1회 기록. ② CoverGeneration step 2의 '가사 내용 기반으로 생성' 버튼 + handleLyricsUse fromStep 분기 제거(1.75로 일원화). ③ 커버 세부 질문 체인 재배선: '직접'→**배경(1.85)→구도(1.8)→(인물 시)표정(1.82)→색감(1.9)**→자유(2) — **스텝 번호 불변**, 배선·echoOfStep만 교체. ④ 신규 `components/AnswerEditModal.tsx`(작사 재선택 모달 추출)로 작곡·이미지 답변 편집 통일 — 확인 팝업 삭제, 선택지형=즉시 편집 모달(rewindRef 세팅·setStep 안 함), 복합형=무확인 되감기+수정 배너(취소 복귀), 이미지 step 0만 확인 팝업 유지, **작사 회귀 0**. ⑤ refine 이중 제출 가드(refineSubmitGuardRef) + ERR_NETWORK 시 `GET /upload/cover-history/{id}` 폴링(15s×12) 회수 — **재요청 없음=재차감 없음**. ⑥ 신규 `components/TutorialOverlay.tsx` + 6화면(Chart/Playlist/Feed/Search/Map/Player) AsyncStorage `maidol_tutorial_seen_v1:<screenKey>` 1회 노출, Map 인라인 Modal 이관·ⓘ 재노출.
> **이번 사이클 서버 무변경(읽기 전용 — 쓰기 권한 차단)**: 백엔드 diff 0이 그 자체로 게이트. [api]는 기존 계약의 **읽기 전용 확인**(LISTEN seek 수용·cover-history 스키마)에 한정하고, refine 경합·환불은 서버 백로그(이번 판정 대상 아님).
> 실행 환경 관행(v3.191~203 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 **코드 정적 검증 대체 병기 + 실기기 수동 절차 이관**. 앱 코드 `/Users/pearl/TripleJ/2_housing`(frontend, 직전 0b4d59d v3.203). **시크릿·실계정 크리덴셜 기재 금지**(계정은 `TEST_USER_EMAIL` 플레이스홀더로만 표기), 실사용자 데이터 접근 금지. LISTEN seek·refine 실측 증적에는 generation_id/cover_session_id를 병기해 앱 로그↔서버 응답을 귀속한다.

### [unit] 앱 정적 검증 (머지 게이트 — 이번 사이클 피라미드 본체)

**U-1. 선행 게이트 — v3.203 커밋 기준선 + 타입 무결성 [unit]**
- Given: 직전 커밋 0b4d59d(v3.203) 클린 기준선 위에서만 이번 diff 귀속 판정(U-9)이 성립. 2조→1조 순차(CoverGenerationScreen 공유) 관계로 조별 커밋 사이에도 재실행.
- When: ① `git log --oneline -1` + `git status --short`(2_housing 스코프)로 클린 기준선 확인(미커밋 잔존 시 착수 금지·반려). ② 각 조 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: ① 클린 기준선 ② exit 0.

**U-2. [항목1] MusicResult 시크 — Slider 2곳 + LISTEN seek 1회 기록 [unit]**
- Given: 진행바 2곳 모두 비인터랙티브 View 폭 %였음. PlayerScreen 검증 관행(:24 import·:866 handleSeek·:880 isSeekingRef·:188 seekValue) 이식이 스펙 — PanResponder 자체 구현 발견 시 스펙 위반 반려. logListen :145~146 예약 주석("시킹 UI 도입 시 from_ms/to_ms와 함께 seek 기록")의 이행이며, 서버 sessions.py:34는 seek 허용·:129~130 from_ms/to_ms **음이 아닌 정수 필수**(위반=400).
- When: `screens/MusicResultScreen.tsx` — ① 비교 카드·단일 플레이어 진행바가 둘 다 Slider로 교체(2곳 전수 — 1곳만 교체 시 FAIL). ② 드래그 중 콜백 튐 방지: onSlidingStart→isSeekingRef 세팅 + 상태 콜백(:205 position 갱신)이 시킹 중 Slider value를 덮지 않는 가드, onSlidingComplete→setPositionAsync 배선(PlayerScreen 형상과 구조 대조). ③ **탭 시크**(드래그 없이 바 탭)도 onSlidingComplete 경로로 수렴하는지. ④ **일시정지 중 시크**: isPlaying 게이트 없이 위치만 이동(재생 강제 시작 0건). ⑤ variant 전환 직후: 전환 시 sound 재생성(:196~214)과 이전 variant의 pending seek가 새 sound에 오발사되지 않는 가드(sound 참조 동일성 확인). ⑥ **duration 비유한/0 → Slider disabled**(:368~369 가드 연장 — maximumValue에 Infinity/NaN 유입 경로 0건 논증). ⑦ LISTEN seek 기록이 **onSlidingComplete 1곳에만** 존재(드래그 중·상태 콜백에서 호출 0건 — 폭주 방지), payload `{action:'seek', from_ms, to_ms}` 둘 다 `Math.round`류 정수화 + 음수 클램프(0 미만 유입 시 0 — 서버 400 방지). ⑧ 기존 play/pause/ended 계측 호출부 diff 0.
- Then: ①~⑧ 전부 충족 — **⑦ 정수·비음수 보장(400 방지)이 FAIL 게이트**.

**U-3. [항목2] step 2 '가사 기반' 버튼 제거 [unit]**
- Given: step 1.75가 트랙 모드에서 항상 노출(:605 albumMode/무트랙만 예외)이므로 step 2의 중복 버튼(v3.202 H-②)은 근거 소멸 — 버튼 + `handleLyricsUse(fromStep=2)` 분기(:742~743·:784) 제거 확정.
- When: `screens/CoverGenerationScreen.tsx` — ① step 2 렌더(:1662~1668 상당)에서 '가사 내용 기반으로 생성' 버튼 **부재**(트랙 모드 — 1.75에서 '반영' 답한 케이스·'직접' 답한 케이스 양쪽 렌더 경로 추적). ② handleLyricsUse가 1.75 전용으로 단순화(fromStep 파라미터·early return 분기 제거 — 잔존 데드코드 발견 시 기록). ③ step 2 기존 구성 존속: 스타일 칩·자유 서술 입력·'이대로 만들기' 무변경. ④ 1.75 '반영' 선택 시 가사 발췌가 doGenerate payload에 실리는 기존 경로 diff 0(버튼 제거가 payload 조립을 건드리면 FAIL). ⑤ 앨범 모드(가사 없음) step 2도 정상(버튼은 원래 트랙 전용이었는지 — 앨범 경로 회귀 0).
- Then: ①~④ 전부 충족(⑤ 교차).

**U-4. [항목3] 세부 질문 재배선 — 배경→구도, 스텝 번호 불변 [unit]**
- Given: 스텝 식별자(1.8=구도·1.82=표정·1.85=배경·1.9=색감)는 렌더 스위치·performRewind·영속 coverStep이 전부 값 기준으로 물려 있으므로 **번호 재할당은 금지**(배선·echoOfStep만 교체). echoOfStep 갱신 누락 = 비파괴 되감기 에코 치환 실패.
- When: ① 체인 추적: 1.75 '직접' → `proceedToBg`류(1.85) → 배경 3출구(`handleBgPhoto`/`handleBgText`/`handleBgSkip`) **모두** next=구도(1.8) → `handleShotPick` — 인물 포함이면 표정(1.82)→색감(1.9), **인물 미포함이면 표정 스킵**→색감(1.9) → `proceedToFinal`(2). ② **스텝 번호 불변**: 1.8/1.82/1.85/1.9의 의미 재할당 0건(grep — 렌더 스위치 :1550~1629 case 값과 질문 문구 쌍이 종전과 동일). ③ echoOfStep 갱신 전수: 각 질문 버블의 echoOfStep이 **새 선행 스텝**과 일치(구도 질문 에코=1.85 답변에 귀속 등 — proceedToPalette의 1.85 하드코딩(:725) 파라미터화, 구 proceedToShot의 echoOfStep 미부여 해소 확인). ④ 버블 편집으로 **배경만 교체** 시(U-6 배선 경유) 이후 구도·표정·색감 대화 보존(비파괴 치환 — slice/절단 0건). ⑤ 앨범 모드/무트랙 직행(:605)도 배경부터 시작. ⑥ handleLyricsSkip 되감기 분기(:794~800)의 재진입점이 배경(1.85)으로 교체. ⑦ doGenerate payload(:404~409) 필드 매핑은 개별 필드라 순서 무관 — 배경/구도/표정/색감 각 답이 종전과 동일 필드에 실림(스왑 오염 0).
- Then: ①~⑦ 전부 충족 — **② 스텝 번호 변경 발견 = 즉시 FAIL 게이트**(영속 coverStep·되감기 전면 오염).

**U-5. [항목4-a] AnswerEditModal 추출 — 작사 완전 회귀 0 [unit] — FAIL 게이트**
- Given: 작사 재선택 모달(LyricsInputScreen :455~518 + reselect* 스타일)은 v3.201 자유 입력·v3.202 flex-end+키보드 리프트+동적 maxHeight까지 합격 형상 — 추출 치환 후 **동작·스타일 diff 0**이 목표이자 게이트.
- When: ① `components/AnswerEditModal.tsx` props 계약 = `visible, title, choices, freeText?, extraActions?, onPick(text), onCancel` + `useAndroidKeyboardLift`·동적 maxHeight 내장(스펙 문자 대조). ② LyricsInputScreen 치환부: 마크업 구조·스타일 값이 추출 전과 **동일**(JSX 트리·스타일 객체 diff — 오버레이 flex-end·자유 입력 행·취소 버튼·듀엣/랩/길이 자유입력 비노출 원칙(:492) 전부 존속). ③ handleReselect(:220)→모달→handleReselectChoice(:226~256) 흐름 무변경: store 반영 + 해당 user 버블 text만 교체(비파괴)·확인 팝업 0건. ④ 작사 화면의 다른 hunk 0(치환 외 접촉 시 귀속 판정).
- Then: ①~④ 전부 충족 — **②③ 작사 동작·스타일 회귀가 이번 사이클 제1 FAIL 게이트**(기준 구현이 깨지면 통일의 근거 자체가 소멸).

**U-6. [항목4-b] 작곡·이미지 편집 배선 — 선택지형 모달·복합형 배너 [unit]**
- Given: 종전 handleUserBubbleTap(작곡 :374~381·이미지 :856~870)의 showAlert 확인 팝업("이 답변만 다시 고를까요?")은 사용자가 금지한 UX — 삭제. 선택지형은 rewindRef만 세팅(**setStep 안 함** — 하단 입력 영역 유지)하고 모달, onPick은 **기존 스텝 핸들러 그대로 호출** → commitExchange(:298~324)/commitRewindAnswer(:569~581)의 되감기 분기가 치환·복귀를 자동 수행(신규 커밋 경로 금지).
- When: ① showAlert 확인 팝업 호출 **삭제**(양 화면 grep — 단 이미지 step 0 제외). ② 선택지형 스텝 집합 문자 대조: 작곡 3·100·4·101·220·300·301·310·11·302 / 이미지 1·1.5·1.7·1.75·1.8·1.82·1.85·1.9·2 → 탭 시 rewindRef={idx,target,resumeStep} 세팅+모달 오픈, setStep 호출 0건. ③ onPick→기존 핸들러(handleGenrePick·handleShotPick 등) 호출 → 비파괴 치환(user 버블+echoOfStep 에코 쌍 교체·절단 0건)+resumeStep 복귀. ④ **onCancel = rewindRef=null·상태 무변화**(버블·store·step 전부 원상 — 탭만 하고 취소 시 diff 0). ⑤ **연쇄 되감기**: 이미지 1(포함/빼고)→1.5(슬롯), 작곡 302→300 — 핸들러 후 rewindRef 생존 시 모달 스텝을 rewindRef.target으로 갱신해 연속 노출(체인 단절·모달 닫힘 후 방치 0). ⑥ 복합형(작곡 0·1·5·6·7·8·9·10·200·210·12) → **확인 팝업 없이** performRewind 즉시 + 입력 영역 상단 수정 배너("○○ 답변을 수정 중이에요"+[취소]) — 취소 시 rewindRef=null·setStep(resumeStep) 복귀. ⑦ 이미지 step 0(곡 변경)만 확인 팝업 유지 + 기존 파괴적 초기화(:826~847) 무변경. ⑧ freeText 허용 스텝만 자유 입력 노출(작곡 300·301·4·101, 이미지 1.8·1.82·1.85·1.9·2 — enum 매핑 스텝 비노출), extraActions 배선(배경 '사진 올리기'·의상 '꾸미기 가기'). ⑨ result 모드(생성 완료 후 재진입) 버블 탭 동작: 편집 진입이 성립하거나 명시적 차단 — 크래시·무반응 방치 0.
- Then: ①~⑨ 전부 충족 — ④⑤가 사고 다발 지점(집중 판정).

**U-7. [항목5] refine 이중 제출 가드 + cover-history 폴링 회수 [unit] — FAIL 게이트(재차감)**
- Given: 프로덕션 실측(9/22 03:05, ref 0fe9dfe0→540904a6) — refine 실소요 132~141초에 클라이언트 단절 → 앱 '실패' 표시 → 재시도 → **차감 반복·결과 유실 루프**. 기존 refining 가드(:1079)는 ⭐ confirm await(:1090~1096) **앞**만 검사 — confirm 대기 중 Enter(:1380)·적용 버튼(:1384) 재진입 구멍. v3.202 I-lite 폴링(:324~361)은 doGenerate 전용이라 refine 미커버. **서버 무변경 — 회수는 GET /upload/cover-history/{id}(upload.py:1103) 재사용.**
- When: ① **이중 제출 봉인**: refineSubmitGuardRef가 confirm await **이전**에 세팅되고 취소/완료/실패 전 경로에서 해제(경로 전수 — 해제 누락 시 영구 잠김 역결함 FAIL). confirm 대기 중 Enter·버튼 재진입 시 요청 0건·confirm 중복 0건 논증. ② 실패 catch 분기: `isRecoverableNetErr`(ERR_NETWORK/timeout 류)일 때만 폴링 진입, 그 외(4xx 등)는 기존 실패 처리 유지. ③ 폴링 스펙: 요청 **직전** currentVersion을 기준선 캡처 → 15s×최대 12회 `GET /upload/cover-history/{coverSessionId}` → `current_version > 기준선`이면 회수(objectName·history·version state 갱신 + fetchBalance()) — **재요청 호출 0건 = 재차감 0**(폴링 루프 내 POST /upload/refine-cover 부재 grep). ④ 폴링 중 refineHint = '연결이 불안정했어요. 서버에서 완성본을 확인하고 있어요…' 표시·성공 시 해제. ⑤ 회수 실패(12회 소진) 시에만 실패 알럿 + '별이 이미 사용됐다면 버전 기록에 잠시 후 나타날 수 있어요' 1줄 추가(showAlert — 시스템 Alert 금지 규칙 준수). ⑥ 정상 성공 경로 회귀: 버전 증가·차감 1회·이력 갱신 diff 0. ⑦ revert·버전 내비게이션(이전/다음 버전 보기) 회귀 0 — 폴링 회수로 채운 버전에서도 동작. ⑧ doGenerate I-lite 폴링(:324~361) **무접촉**(U-9 ③ 교차).
- Then: ①~⑦ 전부 충족(⑧ 교차) — **①(가드 구멍 잔존)·③(폴링 내 재요청 존재=재차감)이 FAIL 게이트**.

**U-8. [항목6] TutorialOverlay — 1회 노출·플래그 독립·Map 이관 [unit]**
- Given: 신규 공용 오버레이(RN Modal transparent·fade·statusBarTranslucent + 딤 + 하단 카드). AsyncStorage `maidol_tutorial_seen_v1:<screenKey>` — try/catch, **읽기 실패 시 미노출**(오탐 노출보다 안전). showAlert 규칙과 별개인 전용 오버레이(메모리 규칙 예외 — 시스템 Alert 아님).
- When: ① `components/TutorialOverlay.tsx`: props `screenKey, steps:{title,desc}[]` + [다음]/마지막 [시작하기]/[건너뛰기]/진행 도트, `show()` 명령형 재노출(ref), 닫힘(건너뛰기 **포함**) 시 플래그 기록 — 기록 경로 전수(건너뛰기만 기록 누락 시 매번 재노출 FAIL). ② AsyncStorage 읽기·쓰기 try/catch + 읽기 실패 시 미노출 논증(`.catch(() => {})` 관행 — authStore.ts:4 형상). ③ 6화면 장착 전수: Chart·Playlist·Feed·Search·Map·Player — screenKey가 화면별 **상이**(플래그 독립 — 키 중복 시 한 화면 열람이 타 화면을 잠그는 FAIL). ④ **Map 이관**: 기존 인라인 Modal(:736~760)·showTutorial state 삭제 + ⓘ 버튼(:286)이 `overlay.show()`로 재배선(4항목 steps 이관 — 내용 유실 0), 재노출은 열람 플래그와 무관하게 동작. ⑤ 문구 검수: **이모지 0건(⭐ 예외)·'AIDOL' 노출 0건**·MAIDOL 표기·기능 중심 단문(PLAN 화면별 골자와 부합). ⑥ Modal 내 KAV 부재(v3.201~202 교훈 — 입력 없음)·safe-area 인셋 직접 처리. ⑦ 비로그인 게이트 간섭 0: Chart·Search는 비로그인 진입 가능 화면 — 오버레이가 로그인 팝업·차단과 겹치지 않는 조건 논증(z-order·노출 타이밍). ⑧ Android 백버튼: Modal onRequestClose 배선(닫힘=건너뛰기 취급·플래그 기록 — 앱 종료 오발 0).
- Then: ①~⑧ 전부 충족 — ①(건너뛰기 미기록)·③(키 충돌)이 주요 함정.

**U-9. diff 격리 + v3.202/v3.203 무회귀 + coverStep 구순서 영속 호환 [unit] — FAIL 게이트**
- Given: 접촉 예상 — `screens/MusicResultScreen.tsx`·`components/AnswerEditModal.tsx`(신규)·`components/TutorialOverlay.tsx`(신규)·`screens/LyricsInputScreen.tsx`·`screens/MusicGenerationScreen.tsx`·`screens/CoverGenerationScreen.tsx`·탭 6화면(Chart/Playlist/Feed/Search/Map/Player) — **서버 파일 접촉 0**(읽기 전용 사이클).
- When: ① `git status --short`+`git diff --stat`: 콘텐츠 diff가 위 목록 내(목록 외 접촉 시 커밋 메시지 명기 조건부 — 관례). **백엔드·0_platform 무접촉**(1건이라도 서버 diff 발견 시 즉시 FAIL — 쓰기 차단 위반). ② v3.203 무회귀: 연주곡 체인(제목→장르→분위기→310→참고곡→BPM)·step 310 되감기·durationSec 배선·ComposeLyricsPick 제목 클리어 — 전부 diff 0(작곡 편집 배선(U-6)이 310 선택지형 모달에 편승하는 것은 허용, 체인·store 배선 변경은 불허). ③ v3.202 무회귀: I-lite doGenerate 폴링(:324~361) diff 0·coverStep 영속·CoverGeneration fix1~5·모달 키보드 리프트 — 폴링 신설(U-7)이 I-lite 코드를 공유 리팩토링했다면 doGenerate 경로 재판정. ④ **coverStep 구순서 영속 복원 호환(필수)**: 구순서(구도→표정→배경→색감) 진행 중 저장된 coverStep=1.8/1.82/1.85/1.9 각각을 새 코드가 복원하는 시나리오 전수 — 스텝 번호 불변(U-4 ②)이므로 해당 스텝 렌더는 성립해야 하고, 복원 후 next는 **새 배선**을 따름(예: 구순서 1.8 복원 → 표정/색감으로 진행 → 배경 미답 상태로 payload 도달 시 undefined 가드·미포함 처리 — 크래시·'undefined' 문자열 노출 0 논증). 데드엔드(복원 후 어느 출구로도 2에 못 가는 스텝) 0건. ⑤ 발매 플로우(커버 확정→발매)·429 피로 게이트(앱 측 대응 UI) diff 0. ⑥ MusicResult 기존 재생 로직(:196~214 sound 생성·variant 전환·ended 처리) — Slider 교체 외 hunk 0.
- Then: ①~⑥ 전부 충족 — **①(서버 diff)·④(구순서 복원 크래시/데드엔드)가 FAIL 게이트**.

### [api] 서버 읽기 전용 계약 확인 (최소 — 이번 사이클 서버 무변경)

**A-1. LISTEN seek 수용 + cover-history 스키마 + 429 게이트 존속 [api]**
- Given: 서버는 무변경이므로 "앱이 의존하는 기존 계약이 실제로 그 형상인가"만 curl로 확정(계약 오독이 앱 구현을 오염시키는 것 방지). 테스트 계정(`TEST_USER_EMAIL`)만 사용, 실사용자 데이터 접근·서버 쓰기 금지(LISTEN 기록·조회는 테스트 계정 자기 데이터 한정).
- When: ① LISTEN seek 1건 실전송: 테스트 계정 세션으로 `{action:'seek', from_ms: 1000, to_ms: 45000}` POST → **2xx**(400 없음) — 경계 보강: from_ms=0 케이스 1건 추가(음이 아닌 정수 계약의 하한 실측). 소수/음수는 앱이 원천 차단(U-2 ⑦)하므로 서버 거절 실측은 참고용 1건만. ② `GET /upload/cover-history/{cover_session_id}`(테스트 계정 소유 세션) → 200 + `current_version`·`cover_object_name`·`cover_refine_history` 필드 존재(U-7 폴링이 파싱하는 키 전수 대조). ③ 429 피로 게이트 존속 확인은 **읽기 전용 한계**로 실호출 유발 금지 — 코드 실측(생성 계열 엔드포인트 게이트 배선 grep, ssh 읽기)으로 갈음. ④ refine-cover 실호출 0건(과금·서버 부하 — U-7은 정적+E-3 수동으로만).
- Then: ①② 충족(③ 코드 확인 갈음, ④ 준수) — ②의 키 부재 발견 시 U-7 구현 착수 전 계약 재협의(FAIL 아님·차단).

### [e2e] 핵심 여정 (정적 대체 + 실기기 수동 절차 이관)

**E-1. [항목1] 후보 시크 여정 [e2e]** — 정적 대체: U-2 완료로 갈음. 실기기 수동 절차: 테스트 계정 → 작곡 완료 화면(후보 2곡) → ⓐ 비교 카드 진행바 드래그 시크·탭 시크 ⓑ 일시정지 상태에서 시크(위치만 이동·자동 재생 없음) ⓒ variant 전환 직후 즉시 시크(이전 곡 위치 오염 없음) ⓓ 단일 플레이어 진행바 동일 4점 ⓔ 드래그 중 썸 튐 없음(콜백 억제 체감) ⓕ [BTDebug]/서버에서 seek LISTEN **정확히 1건**(from_ms/to_ms 정수·드래그 1회당 1건) ⓖ 기존 재생/일시정지/곡 끝 동작 무변.

**E-2. [항목2·3·4] 커버 디렉터 여정 [e2e]** — 정적 대체: U-3·U-4·U-6 완료로 갈음. 실기기 수동 절차: 트랙 모드 진입 → 1.75 '직접' → **배경→구도→(인물 포함 시)표정→색감→자유 서술** 순서 육안 + 인물 미포함 재실행 시 표정 스킵 + 배경 3출구(사진/텍스트/건너뛰기) 각각 다음=구도 확인 → step 2에서 '가사 기반' 버튼 **부재** 확인 → 배경 답변 버블 탭 → **확인 팝업 없이** 즉시 편집 모달 → 다른 값 선택 → 배경만 교체·이후 대화 보존 육안 → 곡(step 0) 버블 탭 → 확인 팝업 노출(유일 예외) 확인. 작곡 화면에서 선택지형(장르) 즉시 모달·복합형(제목) 배너+취소 복귀·연쇄(302→300) 연속 모달 각 1회. **작사 화면 재선택 3종(선택지/자유 입력/취소) 종전과 동일 체감** — 회귀 의심 시 즉시 U-5 재판정.

**E-3. [항목5] refine 단절 복구 여정 [e2e]** — 정적 대체: U-7 완료로 갈음(폴링·가드는 코드 논증이 본체). 실기기 수동 절차(⭐5 × 1~2회 과금 — 테스트 계정 한정): ⓐ 정상 refine 1회 → 성공·버전 +1·잔액 −5 정확(재차감 0). ⓑ (선택 — 사용자 판단 하) refine 요청 직후 기내 모드 토글로 단절 재현 → '서버에서 완성본을 확인하고 있어요…' 힌트 → 회선 복구 후 폴링 회수로 새 버전 채택·**잔액 추가 차감 0**·fetchBalance 동기화 확인. ⓒ confirm 팝업 대기 중 Enter·적용 버튼 연타 → confirm 1개·요청 1건. ⓑ 미실행 시 U-7 ③ 정적 판정 + 배포 후 프로덕션 로그의 동일 세션 이중 차감 재발 여부 관찰(9/22 패턴 grep)로 갈음.

**E-4. [항목6] 튜토리얼 클린 설치 여정 [e2e]** — 정적 대체: U-8 완료로 갈음. 실기기 수동 절차: **앱 데이터 삭제(클린 설치 상당)** → 6화면(차트→플레이리스트→피드→검색→작업실 지도→플레이어) 순회 — 각 최초 진입 시 1회 노출·[다음] 진행·마지막 [시작하기] 닫힘, 1개 화면은 [건너뛰기]로 닫기 → **전 화면 재진입 시 미노출**(건너뛰기 화면 포함) → 앱 완전 재시작 후에도 미노출(영속) → Map ⓘ 탭 → 재노출 정상 → 비로그인 상태로 차트·검색 진입 — 오버레이·로그인 유도 겹침 없음 → Android 백버튼으로 닫기 1회(앱 종료 아님·재진입 미노출) → 전 카드 문구에 이모지·AIDOL 0건 육안.

**게이트**: U-1~U-9 + A-1 전부 PASS 시 머지 허용(frontend 자동 push 관례 — 서버 배포 없음). E-1~E-4는 정적 대체 완료 조건으로 비차단(실기기·실과금분은 사용자 판단 하 이관). 핵심 FAIL 게이트 6건 — **U-5 ②③**(작사 재선택 모달 회귀 — 기준 구현 파손) / **U-9 ④**(coverStep 구순서 영속 복원 크래시·데드엔드) / **U-7 ①③**(refine 이중 제출 구멍·폴링 내 재요청=재차감) / **U-2 ⑦**(LISTEN seek 비정수·음수 유입=서버 400) / **U-4 ②**(스텝 번호 재할당 — 영속·되감기 전면 오염) / **U-9 ①**(서버 파일 diff — 읽기 전용 위반) — 1건이라도 FAIL이면 커밋 금지. 서버 백로그 3건(refine 버전 경합·이중 차감 환불·장시간 POST 비동기화)은 이번 판정 대상 아님 — 차기 사이클 사용자 승인 후 별도 TESTPLAN.

## v3.205 — 수정일 2026-09-22

> 대상: PLAN.md v3.205 — **문의 DM 입력바 가림 수정 + 백그라운드 다음곡(로컬 프리다운로드) + BT 메타데이터 판정 + 공지 3건 등록 + 꾸미기 성별 자동 필터**. ① DmChatScreen 컨테이너 `paddingBottom: insets.bottom` + 신규 `hooks/useKeyboardOverlapLift.ts`(겹침 실측 리프트 — API 34↓ 겹침 0→리프트 0, API 35+ edge-to-edge 겹침만큼) → inputBar `marginBottom`. ② playback.ts 프리로드를 **로컬 풀 프리다운로드**(`expo-file-system/legacy` downloadAsync → `file://` createAsync)로 교체 + 파일 수명 관리(discard/스왑 소비/기동 purge) + AppState active 복귀 재트리거. ③ **코드 이관 보류 판정**(expo-av로는 BT 메타데이터 불가 — 차기 expo-audio 스파이크) + audioMode.ts:46 웹 폴백 'AIDOL'→'MAIDOL' 1줄. ④ 공지 3건 브로드캐스트 — **서버 파일 무수정, 컨테이너 python으로 프로덕션 데이터 쓰기(전 유저 DM, 비가역)**. ⑤ ArtistCodyScreen 아티스트 성별 자동 필터 + '전체 보기' 토글.
> **이번 사이클 서버 파일 무변경**(쓰기 권한 차단 — 읽기·API 호출·컨테이너 python만). ④는 파일이 아니라 **데이터 쓰기**이므로 [api]로 검증하되, **사용자 원고 승인 전 실행 금지가 전 시나리오의 전제조건**(A-1). EAS 재빌드 불필요(전 항목 JS).
> 실행 환경 관행(v3.191~204 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 **코드 정적 검증 대체 병기 + 실기기 수동 절차 이관**. 앱 코드 `/Users/pearl/TripleJ/2_housing`(frontend, 직전 9670ccb v3.203/204 합격 형상). **시크릿·실계정 크리덴셜 기재 금지**(계정은 `TEST_USER_EMAIL` 플레이스홀더로만 표기), 실사용자 데이터 접근 금지 — 단 ④ 브로드캐스트는 성격상 전 유저 도달(승인이 곧 게이트). 프리로드 실측 증적에는 trackId + `[BTDebug]` 로그 타임스탬프를, 공지 증적에는 notice_id를 병기해 앱↔서버↔mongo를 귀속한다.

### [unit] 앱 정적 검증 (머지 게이트)

**U-1. 선행 게이트 — v3.204 커밋 기준선 + 타입 무결성 [unit]**
- Given: 직전 커밋 9670ccb(v3.203/204 합격 형상) 클린 기준선 위에서만 이번 diff 귀속 판정(U-9)이 성립. 1조·2조 병렬(파일 겹침 없음)이라 조별 커밋 후에도 재실행.
- When: ① `git log --oneline -1` + `git status --short`(2_housing 스코프)로 클린 기준선 확인(미커밋 잔존 시 착수 금지·반려). ② 각 조 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: ① 클린 기준선 ② exit 0.

**U-2. [항목①] DmChat 하단 정비 — insets.bottom + 진입 경로·프리필 [unit]**
- Given: app.json edge-to-edge(:35)로 입력바(:266~271, margin ~16px)가 내비바(3버튼 ~48px/제스처 ~24px)에 깔림 — 컨테이너(:158)는 paddingTop만 적용. 진입 경로는 설정→문의하기→`startCsInquiry`(SettingsScreen.tsx:364~385)→`navigate('DmChat', { conversation, prefill })`.
- When: `screens/DmChatScreen.tsx` — ① 컨테이너에 `paddingBottom: insets.bottom` 추가(제스처·3버튼 공통 해결 논증 — insets 값이 두 모드 모두에서 내비바 높이를 반환). ② 프리필 `'[오류신고: 사유] '` 배선 diff 0(startCsInquiry→DmChat 파라미터 체인 무변경). ③ 수신 pending 대화(입력바 숨김 상태) 렌더 경로: paddingBottom 추가가 숨김 레이아웃을 깨지 않음(입력바 부재 시에도 이중 여백·잘림 0 논증). ④ iOS: 기존 KAV behavior='padding' 경로 무변경(iOS diff는 paddingBottom뿐 — KAV와 insets.bottom 합산으로 과잉 여백이 생기는 경로 여부 판정·주석화).
- Then: ①~④ 전부 충족.

**U-3. [항목①] useKeyboardOverlapLift 훅 — 겹침 실측·이중 보정 구조적 불가 [unit] — FAIL 게이트**
- Given: 기존 `useAndroidKeyboardLift`(v3.201~202)는 Modal 전용 셈법(kbHeight − insets.bottom) — 전체 화면에 쓰면 API 34↓(adjustResize 동작 기기)에서 이중 보정. 신규 훅은 `keyboardDidShow`의 `endCoordinates.screenY`와 대상 뷰 `measureInWindow` 하단의 **실측 겹침만큼만** 리프트가 스펙.
- When: 신규 `hooks/useKeyboardOverlapLift.ts` — ① Android 한정 가드(`Platform.OS !== 'android'` 시 0 고정/리스너 미등록). ② 리프트 산식이 **겹침 실측**(뷰 하단 − 키보드 상단, 음수면 0 클램프) — 고정치/kbHeight 직접 사용 발견 시 스펙 위반 FAIL. **이중 보정 구조적 불가 논증**: 창이 이미 리사이즈된 기기는 measureInWindow 하단이 키보드 위 → 겹침 0 → 리프트 0(코드 경로로 성립하는지 문자 확인). ③ `keyboardDidHide` 시 0 리셋 + 리스너 등록/해제 쌍(cleanup — v3.201 관행 계승, 해제 누락 시 화면 이탈 후 setState 경고·누수 FAIL). ④ 반환값이 inputBar **`marginBottom`에만** 적용 — paddingBottom 합산 0건(v3.201 §1 교훈 — grep으로 합산 경로 부재 확인). ⑤ 기존 `useAndroidKeyboardLift.ts` diff 0(모달 3곳 소비처 무회귀 — U-9 교차). ⑥ measureInWindow 타이밍: keyboardDidShow 시점 측정이 레이아웃 완료 후인지(ref 미준비 시 0 처리 — 크래시 0).
- Then: ①~⑥ 전부 충족 — **②(이중 보정 성립 경로 잔존)·④(paddingBottom 합산)가 FAIL 게이트**.

**U-4. [항목②] 로컬 풀 프리다운로드 배선 — legacy downloadAsync + file:// 스왑 [unit]**
- Given: 종전 프리로드는 원격 URI createAsync(버퍼 창만 수신 — playback.ts:122~125)라 Doze 단절 시 미버퍼 구간에서 사망. 로컬 파일이면 스왑 후 재생에 네트워크 불필요가 이번 구조 해결의 본체.
- When: `services/playback.ts` — ① import가 `expo-file-system/legacy`(ArtistLoadingScreen.tsx:15~16 관행 — v19 신 API에 downloadAsync 없음, 신 API import 발견 시 FAIL). ② `maybePreloadNext` 경로(:119~146 상당): `downloadAsync(streamProxyUrl, cacheDirectory + 'preload/' + trackId + '.mp3')` **완료 후** `createAsync({uri: 로컬 file://}, {shouldPlay:false})` — 다운로드 미완 상태로 createAsync에 원격 URI가 흘러드는 경로 0건. ③ NextPreload에 `fileUri` 보관(스왑·정리에서 참조 가능). ④ `[BTDebug]` 로그: `preload download start` / `done(bytes)` / `fail` + swap 로그 `local:true` 배선(E-2 실측 추적자). ⑤ PlayerScreen.tsx 무수정(스왑 사운드 생성이 playback.ts 내부라 투명 — 접촉 발견 시 귀속 판정). ⑥ 스왑 후 재생 경로에 네트워크 참조 0 논증(로컬 fileUri 사운드 그대로 재생 — 원격 재로드 경로가 남아 있으면 기내 모드 게이트(E-2) 정적 선행 FAIL).
- Then: ①~⑥ 전부 충족 — **⑥이 기내 모드 이어재생 게이트의 정적 선행 판정**.

**U-5. [항목②] 프리로드 파일 수명 — 소비·폐기·purge 전수, 누수 0 [unit] — FAIL 게이트**
- Given: 캐시 파일은 곡당 수 MB — 삭제 경로 1곳이라도 누락되면 기기 저장소가 단조 증가(누수). PLAN 확정 규칙: discard 시 삭제·새 다운로드 전 이전 파일 삭제·스왑 소비분은 해당 곡 재생 종료 시 삭제·기동 시 preload/ 일괄 purge 1회.
- When: ① `discardPreloaded`(:74 상당)에서 unload와 **함께 deleteAsync**(idempotent — 파일 부재 시 무해 처리). ② 새 다운로드 시작 전 이전 preload 파일 삭제(연속 스킵 시 파일 2개 공존 구간 0). ③ 스왑 소비된 파일은 해당 곡 **didJustFinish/새 로드 시** 삭제(재생 중 삭제로 file:// 사운드가 죽는 역결함 0 — 삭제 시점이 재생 종료 이후임을 경로 추적). ④ 앱 기동 시 `preload/` 디렉터리 일괄 purge 1회 — initPlaybackReconciler 편승 확인(고아 파일 회수). ⑤ 다운로드 도중 `loadGen` 변경 시 파일 삭제 후 중단(경합 — 스킵 연타 시나리오 코드 논증). ⑥ **삭제 경로 전수표 작성**: 수동 스킵/미니플레이어 닫기/셔플 토글/큐 교체/앱 재시작 각각이 위 ①~⑤ 중 어느 경로로 파일을 회수하는지 매핑 — 어느 시나리오도 회수 경로 없음 = 누수 FAIL. ⑦ 캐시 디렉터리가 preload 전용(다른 캐시와 분리 — 타 용도 사용 금지 관리 결정 준수).
- Then: ①~⑦ 전부 충족 — **⑥(회수 경로 없는 시나리오 존재 = 캐시 누수)가 FAIL 게이트**.

**U-6. [항목②] 백오프·원격 폴백·reconciler 재트리거 회귀 [unit]**
- Given: 다운로드 실패는 기존 preloadFail 백오프(곡당 3회·10s)에 그대로 계상, didJustFinish 미스 시 네트워크 폴백 경로 불변, AppState active 복귀 시 프리로드 재트리거 1줄이 스펙.
- When: ① 다운로드 실패(downloadAsync throw/비200) → 기존 백오프 카운터 계상(신규 실패 유형이 백오프를 우회해 무한 재시도하면 FAIL). ② didJustFinish 시 프리로드 부재 → 기존 원격 즉시 로드 폴백 diff 0(로컬화가 폴백 경로를 지우면 오프라인 아닌 일반 실패에서 재생 중단). ③ initPlaybackReconciler(:378~ 상당) AppState 'active' 복귀: 재생 중 + 프리로드 부재 시 `maybePreloadNext(..., {eager:true})` 재트리거 — 조건 가드(재생 중 아님/이미 프리로드 존재 시 미호출) 확인. ④ v3.202 60s 프리로드 창·조기화·백오프 형상 diff 0(로컬화 치환 외 로직 무변경). ⑤ duration 보정(v3.192)·reconciler·LISTEN 계측 무접촉.
- Then: ①~⑤ 전부 충족.

**U-7. [항목③] 이관 보류 판정 검증 — 코드 무변경 + MAIDOL 폴백 + AIDOL grep 0 [unit] — FAIL 게이트**
- Given: ③은 "expo-av로는 불가" 판정 보고가 산출물 — 코드 변경은 audioMode.ts:46 웹 폴백 문자열 1줄뿐이어야 한다. 노출 문자열 AIDOL 금지는 상시 브랜딩 게이트(maidol-branding).
- When: ① `services/audioMode.ts` diff가 :46 `'AIDOL'`→`'MAIDOL'` **1줄뿐**(updateMediaSession의 `Platform.OS !== 'web'` 즉시 return(:40)·주석(:5~6) 무변경 — 네이티브 미디어세션을 흉내내는 신규 코드 발견 시 이관 보류 판정 위반으로 반려). ② 웹 경로 논증: 미디어세션 artist 폴백이 'MAIDOL'로 노출(웹 빌드 실행 불가 시 코드 문자 확인으로 갈음·실측은 E-4 이관). ③ **노출 문자열 'AIDOL' 전역 grep 0**: `2_housing/` 사용자 노출 문자열 전수(`grep -rn "AIDOL"` 후 MAIDOL 부분매치 제외 정밀 판독 — 식별자/키 이름은 비노출로 구분 기록). ④ playback.ts의 [BTDebug] 로그 이름 유지(기존 이름 삭제·개명 0 — 차기 이관 스파이크의 실측 연속성).
- Then: ①~④ 전부 충족 — **③(노출 AIDOL 1건 이상)이 FAIL 게이트**.

**U-8. [항목⑤] 성별 자동 필터 — 헬퍼 폴백·기본 ON·토글·안전 폴백 [unit]**
- Given: 서버 /ads/active는 gender 필터 파라미터 없음(앱 측 적용), ArtistCodyScreen에 수동 성별 드릴 레벨(:66)과 genderMatches(:74~80, '공용'·미지정 양쪽 포함)는 기존 존재. 성별 판별 실패 시 **필터 미적용(전체 노출)**이 안전 원칙.
- When: `screens/ArtistCodyScreen.tsx` — ① 성별 해석 헬퍼: apiResult.gender → characterTaskStore.pendingGender → artistProfileStore.profiles[slot].gender 순 폴백 + 정규화(trim 후 '남' 시작→'남', '여' 시작→'여', 그 외/부재→null) — 순서·정규화 규칙 문자 대조(자유 입력 '여자아이돌' 같은 비정형이 '여'로 정규화되는지 케이스 표). ② null 아니면 피커 목록에 기존 `genderMatches` **기본 적용**(신규 매칭 함수 재작성 발견 시 이중 규칙 FAIL — :74 재사용 확인). ③ 토글 칩: 피커 헤더(전체|위시리스트 탭 행)에 기본 `"○성용만"`(활성) ↔ `"전체 보기"`, **피커 열 때마다 기본 ON 복귀**(토글 상태가 세션/영속에 남아 재진입 시 OFF 유지되면 FAIL). ④ null이면 칩 미노출 + 필터 미적용(전량 노출). ⑤ 적용 카테고리 **상의·하의·신발 한정**(실데이터 근거) — 무데이터 카테고리(악세서리 등)는 무필터(전량 사라지는 사고 방지 논증). ⑥ SAMPLE_ITEMS(무광고 폴백)는 gender 없음 → genderMatches '공용' 취급 자연 통과(필터 ON에서도 빈 화면 0). ⑦ 드릴다운 5단계 체인(:65~68)·수동 성별 레벨·위시리스트 탭 **불변** — 자동 필터는 openPicker 결과·드릴 소스 목록 선적용, 드릴 패싯 수치도 필터 후 기준(일관성). ⑧ 필터 후 0건 시 빈 상태 안내 렌더(크래시·빈 백지 0 — '전체 보기' 유도 문구 여부 기록). ⑨ 로그 `[ArtistCody] 성별 자동 필터` { g, cat, before, after } 배선.
- Then: ①~⑨ 전부 충족 — **⑦(위시리스트·드릴다운 파괴)이 FAIL 게이트**.

**U-9. diff 격리 + v3.203/204 무회귀 [unit] — FAIL 게이트**
- Given: 접촉 예상 — `screens/DmChatScreen.tsx`·`hooks/useKeyboardOverlapLift.ts`(신규)·`screens/ArtistCodyScreen.tsx`·`services/playback.ts`·`services/audioMode.ts` 5파일. **서버 파일 접촉 0**(쓰기 차단 — ④는 데이터 쓰기이지 파일 아님).
- When: ① `git status --short`+`git diff --stat`: 콘텐츠 diff가 위 목록 내(목록 외 접촉 시 커밋 메시지 명기 조건부 — 관례). **백엔드·0_platform 무접촉**(서버 diff 1건 = 즉시 FAIL). ② 공지 등록 스크립트가 **커밋에 미포함**(scratchpad 한정 — 관리 결정, git 추적 발견 시 FAIL) + 스크립트/증적에 크리덴셜·토큰 출력 0. ③ v3.204 무회귀: AnswerEditModal 3화면 배선·MusicResult Slider 2곳·refine 가드+폴링·TutorialOverlay 6화면 — 전부 diff 0. ④ v3.203 무회귀: 연주곡 체인·step 310·durationSec 배선·ComposeLyricsPick 제목 클리어 — diff 0. ⑤ 기존 `useAndroidKeyboardLift` 소비처(모달 3곳) diff 0(U-3 ⑤ 교차). ⑥ DmChat 기존 `[DmChat]` 로그·dmSocket 배선 무변경.
- Then: ①~⑥ 전부 충족 — **①(서버 파일 diff)·②(스크립트 커밋/시크릿)가 FAIL 게이트**.

### [api] 공지 브로드캐스트(프로덕션 데이터 쓰기) + 서버 무변경 확인

**A-1. [항목④] 발송 전 게이트 — 사용자 원고 승인 + diff 0 검수 [api] — FAIL 게이트(무승인 발송)**
- Given: 브로드캐스트는 **전 유저 1:1 DM fan-out, 비가역**. PLAN 확정 절차: notice-ops가 원고 검수 후 컨테이너 python(`sudo docker exec -i maidol-app python - <<'PY'`)으로 admin_cs 핸들러 시퀀스 재현(create_notice → broadcast_message → 이력 상태 갱신). **전제조건: 사용자가 원고 3건을 명시 승인하기 전에는 어떤 발송 실행도 금지** — 이 승인이 본 시나리오의 Given이며, 승인 없이는 A-1 이하 전부 착수 불가(대기 상태로 보고).
- When: ① 발송 스크립트의 본문 3건이 PLAN.md v3.205 §4 확정 원고와 **diff 0**(한 글자 불변 — 프로그램적 문자열 비교, 육안 금지). ② 원고 정적 검수: 이모지 0(⭐ 예외 규칙 무관 — 원고에 ⭐ 없음)·'AIDOL' 0·MAIDOL 표기·저작권 단정 문구 없음(공지 2 창작 기록 항목의 "법적 저작권 등록이나 권리 보장을 의미하지는 않습니다" 존속)·링크/개인정보 없음·각 2000자 이내(MAX_TEXT_LEN=2000, dm_service.py). ③ 스크립트 요건: official_id는 `official_account_email` SELECT(services/official.py 시드 기준), audience='all'(화이트리스트 `all|users|customers` 내), 등록 순서 3→2→1(받은편지함 최상단=공지 1), 건당 30초 이상 간격(Redis 락 생략 보상), sent/failed 집계 출력 저장, 크리덴셜·토큰 출력 0. ④ 서버 파일 mtime/diff 무변경 사전 스냅샷(ssh 읽기 — A-3 대조 기준).
- Then: ①~④ 전부 충족 + **사용자 승인 기록 확보 후에만** 발송 실행 — **승인 전 발송 실행 1건 = 최상위 FAIL 게이트(비가역 사고)**.

**A-2. [항목④] 발송 후 검증 — DM 3건 수신·순서·본문 diff 0 + notices 이력 + CS 답장 회귀 [api]**
- Given: 앱 공지 화면 = official 계정과의 DM 대화(별도 공지 목록 없음). 검증 계정은 **테스트 일반 계정**(`TEST_USER_EMAIL` — 실사용자 데이터 접근 금지, 자기 수신함만 조회).
- When: ① 테스트 일반 계정 API로 official 대화 조회 → 신규 DM **정확히 3건** 수신, 상단부터 문의 방법→FAQ→베타 안내 순서(등록 3→2→1 역순 효과). ② 수신 본문 3건 각각 PLAN 원고와 **프로그램적 diff 0**(fan-out 과정 변형·절단 0 — notice_id 병기 증적). ③ mongo `notices` 3건(컨테이너 python **읽기 전용** 조회): status 완료, sent>0, failed 집계 기록(failed>0이면 수치·사유 기록 — 판정 회부, FAIL 아님·보고 사안). ④ **공지 답장 CS 접수 회귀**: 테스트 계정이 공지 대화방에 답장 1건 → 기존 CS 접수 흐름 정상(official 대화 스레드 유지·오류 0) — 공지 1 본문의 "이 대화방에 바로 답장을 보내셔도 접수됩니다" 문구가 실동작과 일치하는지(불일치 시 원고·기능 중 어느 쪽 수정인지 판정 회부). ⑤ 서버 `[admin-cs]`/`[dm-broadcast]` 로그에 3건 발송 흔적 + traceback 0.
- Then: ①~⑤ 전부 충족 — ②(본문 변형)·④(답장 접수 파손)가 집중 판정.

**A-3. 서버 파일 무변경 + 기존 API 스모크 [api]**
- Given: 이번 사이클 서버 파일 배포 없음 — ④ 실행(컨테이너 python)이 파일을 건드리지 않았음을 사후 확정.
- When: ① A-1 ④ 스냅샷 대비 backend_9004 파일 무변경(ssh 읽기 — mtime/체크섬 대조). ② `curl <prod>/health` → 200 + 기존 API 2종(차트·트랙 목록) 200·스키마 기존형. ③ `GET /business/ads/active` 응답에 gender 필드 존속(⑤ 앱 필터의 계약 전제 — 필드 소실 시 U-8 재협의 차단). ④ docker 컨테이너 재시작·재생성 0(uptime 확인 — 공지 실행이 컨테이너를 건드리지 않았음).
- Then: ①~④ 전부 충족 — ①이 FAIL 게이트(서버 무변경 위반).

### [e2e] 핵심 여정 (정적 대체 + 실기기 수동 절차 이관)

**E-1. [항목①] 문의 DM 입력바 여정 [e2e]** — 정적 대체: U-2·U-3 완료로 갈음. 실기기 수동 절차: 설정 → 문의하기(오류 신고) → 사유 선택 → DmChat 진입(프리필 `[오류신고: 사유] ` 확인) → ⓐ **Android API 35**(제스처·3버튼 각각): 진입 직후 입력바 전체 노출(내비바에 안 깔림), 입력 포커스 시 입력바가 키보드 위 완전 노출, 키보드 닫힘 후 **잔존 간격 0** ⓑ **Android API 34**: 동일 3점 + **이중 보정 간격 없음**(겹침 0→리프트 0 실측 — U-3 ②의 실기기 확증) ⓒ **iOS**: 기존 KAV 동작 회귀 0(과잉 여백 없음) ⓓ 수신 pending 대화(입력바 숨김) 레이아웃 회귀 0 ⓔ 장문 입력·연속 전송 중 리프트 안정(전송 후 튐 없음).

**E-2. [항목②] 기내 모드 이어재생 + 캐시 수명 + 장시간 연속 재생 [e2e] — 핵심 FAIL 게이트**
- Given: 로컬 풀 프리다운로드의 존재 이유 = "화면 꺼진 뒤 첫 전환"의 구조적 해결. 정적 대체: U-4 ⑥(스왑 경로 네트워크 참조 0)·U-5(수명 전수표)로 머지 게이트는 갈음하되, **기내 모드 실측은 이번 사이클 완료 조건**(개발 클라이언트/대표 단말 중 가용 수단으로 tester 또는 사용자 실기기 수행).
- When/Then:
  - ⓐ 큐 2곡 이상 재생 → `[BTDebug] preload download start` → `done(bytes)` 로그 + 캐시 `preload/` 파일 실재·크기>0(트랙과 대조).
  - ⓑ **핵심**: preload done 확인 후 **기내 모드**(네트워크 완전 차단) → 현재 곡 자연 종료 → **다음 곡 정상 이어재생** + swap 로그 `local:true` — **실패 시 이번 사이클 ② 전체 FAIL**(원격 참조 잔존 = 구조 해결 불성립).
  - ⓒ 파일 수명 실측: 수동 스킵/미니플레이어 닫기/셔플 토글 각각 후 preload/ 파일 삭제 확인, 앱 재시작 시 purge 1회 로그 — 시나리오 종료 시점 preload/ 잔존 파일 0(**고아 1건 이상 = 캐시 누수 FAIL**).
  - ⓓ 다운로드 실패 시뮬(서버 차단/기내 모드 중 프리로드 시도) → 백오프 3회·10s 계상 + 회선 복구 후 정상화, didJustFinish 미스 시 원격 폴백 회귀.
  - ⓔ **실기기 화면 끄고 1시간 연속 재생(대표 단말 — 사용자 이관)**: 전환 성공률 기록, **N+2곡 연쇄 성립 여부 실측 보고**(Doze 중 백그라운드 다운로드 가부는 기기별 — 성공률 저하는 FAIL이 아니라 **정직 보고 항목**: 차기 expo-audio/RNTP 이관 필요성의 실측 근거로 기록). AppState active 복귀 시 재트리거 로그(놓친 다운로드 회수) 동반 확인.

**E-3. [항목⑤] 성별 필터 여정 [e2e]** — 정적 대체: U-8 완료로 갈음. 실기기 수동 절차: **남성 아티스트**로 꾸미기 진입 → 상의/하의/신발 피커 기본 상태에서 '여성용' 미노출·'공용' 노출·칩 "남성용만" 활성 → '전체 보기' 탭 → 전량 노출 → 피커 닫고 재진입 → **필터 기본 복귀** → **여성 아티스트** 교차(남성용 미노출) → **성별 미상**(구계정/자유 입력 비정형) → 칩 미노출·전량 노출 → 악세서리 등 무데이터 카테고리 전량 노출 → 필터 후 0건 케이스 안내 문구 확인 → 드릴다운 5단계(수동 성별 레벨 포함)·위시리스트 탭·SAMPLE 폴백 각 1회 회귀 0 → `[ArtistCody] 성별 자동 필터` 로그 {g, cat, before, after} 수치 합리성 대조(실데이터: 상의 남 69/여 87/공용 1 등).

**E-4. [항목③·인접] 판정 확인 + v3.204/203 스모크 [e2e]** — 정적 대체: U-7(③)·U-9(무회귀)로 갈음. 실기기 수동 절차: ⓐ BT/차량 메타데이터는 **이번 사이클 개선 없음이 정상**(이관 보류 판정) — 사용자 안내 문구로 보고서에 명기(개선 기대 오해 방지), 웹 빌드 가용 시 미디어세션 artist 'MAIDOL' 표기 1회 확인. ⓑ v3.204 스모크: AnswerEditModal(작사 재선택 1회·작곡 선택지형 모달 1회)·MusicResult 진행바 시크 1회·튜토리얼 1화면 재노출(Map ⓘ). ⓒ v3.203 스모크: 연주곡 카드 진입 → 5질문 체인 육안 + 곡 길이 스텝 존속(생성 미실행 — 과금 0). ⓓ 공지 수신 육안(A-2와 증적 공유): 받은편지함 최상단 공지 1, 본문 렌더 깨짐 0.

**게이트**: U-1~U-9 + A-3 전부 PASS 시 머지 허용(frontend 자동 push 관례 — 서버 파일 배포 없음). A-1·A-2(공지)는 머지와 독립 트랙 — **사용자 원고 승인 전 실행 금지가 절대 전제**, 승인 대기 중이면 "대기"로 보고하고 나머지 게이트만 진행. E-1~E-4는 정적 대체 완료 조건으로 비차단(실기기·기내 모드 실측은 이관하되 **E-2 ⓑ 기내 모드 이어재생은 이번 사이클 완료 조건**, E-2 ⓔ 연쇄 한계는 정직 보고 항목). 핵심 FAIL 게이트 6건 — **A-1**(사용자 무승인 공지 발송 = 비가역 사고) / **E-2 ⓑ·U-4 ⑥**(기내 모드 이어재생 실패 = 로컬화 구조 불성립) / **U-5 ⑥·E-2 ⓒ**(프리로드 캐시 누수 — 회수 경로 없는 시나리오/고아 파일) / **U-3 ②④**(DmChat 이중 보정 성립·paddingBottom 합산) / **U-8 ⑦**(성별 필터가 위시리스트·드릴다운 파괴) / **U-7 ③**(노출 문자열 AIDOL ≥1건) — 여기에 **U-9 ①**(서버 파일 diff = 쓰기 차단 위반) 포함 시 7건, 1건이라도 FAIL이면 커밋·발송 금지. 차기 이관(expo-audio 스파이크)은 이번 판정 대상 아님 — E-2 ⓔ 실측 수치가 그 착수 근거 데이터.

## v3.205 ④ 개정 (2026-09-22)

> **대상**: PLAN.md 「v3.205 ④ 개정 (2026-09-22)」 — 사용자 지시로 항목 ④가 **DM 브로드캐스트 → official 채널 공지 글**로 개정. 공지 3건을 official(`maidol_official`) 계정의 feeds `kind=community` 글로 등록(컨테이너 python insert — 서버 파일 무수정)하고, 앱 수정 3건(FeedCard 공지 배지 · 설정 '공지사항' 진입 · UserChannel `initialTab`)으로 채널 열람 동선을 만든다.
> **폐기 표기**: 기존 v3.205 섹션의 **A-1(발송 전 게이트)·A-2(DM 수신 검증)는 사용자 지시로 DM 방식 폐기 — 본 개정 섹션으로 대체**(DM 브로드캐스트 미실행 — admin_cs/dm_service 코드는 운영 도구로 존치하나 이번 사이클 호출 0). A-3(서버 파일 무변경 스냅샷 대조)·U-1~U-9·E-1~E-4는 존속하며, 본 개정의 신규 시나리오(RA/RU/RE)가 그 위에 추가된다. 스냅샷 기준(구 A-1 ④)은 신규 RA-1 Given으로 승계.
> **전제 계승**: 서버 파일 무수정(쓰기 차단 — 읽기·API 호출·컨테이너 python 데이터 작업만), EAS 재빌드 불필요(전 항목 JS), [e2e]는 정적 검증 대체 병기 + 실기기 수동 절차 이관. **시크릿·실계정 크리덴셜 기재 금지 — 테스트 계정은 `TEST_USER_EMAIL` 플레이스홀더로만 표기**, 검증은 자기 계정 데이터 한정. 증적에는 feed_id(리허설 포함)를 병기해 앱↔API↔mongo를 귀속한다.

### [api] 공지 채널 글 등록 — 리허설 게이트 → 본 등록 검증

**RA-0. 사용자 최종 go 승인 게이트 [api] — 최상위 FAIL 게이트**
- Given: 공지 글 등록은 프로덕션 mongo 쓰기(feeds insert + notifications 팬아웃)이며, 등록 즉시 전 유저 타임라인·알림에 노출되는 "사실상 발행 행위"(삭제로 회수 가능하나 이미 열람된 노출은 회수 불가). PLAN 확정 절차상 리허설→사용자 go→본 등록 순서.
- When: 등록 스크립트(scratchpad 전용, 커밋 금지 — U-9 ② 계승) 실행 전 사용자 승인 기록 확인. 승인 대기 중이면 RA-1 이하 전부 "대기"로 보고하고 정적 검증([unit] RU군)만 진행.
- Then: **사용자 최종 go 승인 전 본 등록 실행 1건 = 최상위 FAIL(비가역 사고). 리허설을 포함한 모든 프로덕션 쓰기는 승인 후에만 실행한다.**

**RA-1. 리허설 글 등록→조회→삭제→흔적 0 [api] — 본 등록 전 필수 게이트 + FAIL 게이트(회수 불능)**
- Given: RA-0 승인 완료. 본 등록 전에 등록·삭제 경로를 실데이터로 검증하는 것이 PLAN 확정 절차(리허설 본문 "MAIDOL 공지 채널 점검 글입니다.", **팬아웃 없이** insert). 서버 파일 mtime/체크섬 사전 스냅샷 확보(ssh 읽기 — 구 A-1 ④ 승계, A-3 대조 기준).
- When: ① 컨테이너 python으로 리허설 글 1건 insert(official_id는 `settings.official_account_email` SELECT — services/official.py 시드 기준, doc 형상은 feeds.py:322~337 create_feed 핸들러 그대로: kind=community·title None·blocks 텍스트 1건·is_public True) → feed_id 기록. ② `GET /api/feeds/user/{official_id}?kind=community`로 노출 확인(1건, 본문 일치). ③ `purge_feed_document` 호출로 삭제. ④ **흔적 0 검증**: feeds 재조회 0건 + mongo `feeds`/`comments`/`likes`에서 해당 feed_id 잔존 문서 0 + `notifications`에 target_id=리허설 feed_id 문서 0(팬아웃 미실행 확인 겸) + 타임라인(`GET /api/feeds/timeline`) 재조회에서 미노출.
- Then: ①~④ 전부 충족해야 본 등록(RA-2) 착수 가능. **삭제 후 잔존 흔적 ≥1건 = FAIL(회수 불능 판정 — 본 등록 금지, 판정 회부)**. 크리덴셜·토큰 출력 0(위반 시 U-9 ② FAIL 준용).

**RA-2. 본 등록 3건 — feeds 조회 본문 diff 0·작성자 official·kind=community [api]**
- Given: RA-0 승인 + RA-1 PASS. 원고는 PLAN 「v3.205 ④ 개정」 확정 채널 글 버전 3건(공지 1 문의 방법 / 공지 2 FAQ / 공지 3 베타 안내 — 본문 1행 = 제목 라인). 등록 순서 3→2→1(커뮤니티 탭 created_at DESC — "문의 방법 안내"가 최상단), 건당 30초 이상 간격.
- When: 등록 후 ① `GET /api/feeds/user/{official_id}?kind=community` → **정확히 3건**(리허설 잔존 0 재확인), 최상단부터 [문의 방법 안내 / FAQ / 베타 안내] 순서. ② 각 본문을 PLAN 확정 원고와 **프로그램적 문자열 비교 diff 0**(한 글자 불변, 육안 금지). ③ 문서 필드: author_id=official_id·author_nickname="maidol_official"·**kind=community**·title null·is_public true·bgm_track_id null. ④ 원고 정적 검수 존속: 이모지 0·'AIDOL' 0·MAIDOL 표기·저작권 단정 문구 없음(공지 2의 "법적 저작권 등록이나 권리 보장을 의미하지는 않습니다" 존속)·링크/개인정보 0·본문 합계 각 ≤10,000자(feeds.py community 검증 한도). ⑤ feed_id 3건을 증적에 기록(RE군 실기기 검증과 귀속 공유).
- Then: ①~⑤ 전부 충족 — ②(본문 변형)·③(작성자/kind 불일치)가 집중 판정.

**RA-3. 알림 문서 팬아웃 집계 [api] — 팬아웃 포함 결정 시**
- Given: 알림 팬아웃 포함 여부는 사용자 결정 사안(기본안: 포함 — 인앱 알림 한정, OS 푸시 아님). **제외 결정 시 본 시나리오는 N/A로 기록**하고 notifications에 신규 문서 0을 역검증.
- When(포함 시): ① 스크립트가 `push_notifications_bulk(ntype="feed", actor_id=official_id, actor_nickname="maidol_official", target_id=feed_id, preview=본문 1행)`를 글 3건 각각에 대해 호출 — sent/failed 집계 로그 저장. ② mongo `notifications` **읽기 전용** 조회: target_id∈{feed_id 3건} 문서 수 = 팔로워 수 × 3(실측 기준 215×3=645±, official 자신 제외 계산 — users 증감 반영해 재계산 대조). ③ failed>0이면 수치·사유 기록(판정 회부, 즉시 FAIL 아님·보고 사안). ④ `TEST_USER_EMAIL` 계정 알림함 API로 "maidol_official님이 새 피드를 올렸어요" 3건 수신 확인.
- Then: ①~④(또는 제외 시 역검증) 충족.

**RA-4. 타임라인 팔로잉 부스트 노출 [api]**
- Given: `GET /api/feeds/timeline`은 팔로잉 작성자 글 +1000 부스트(feeds.py:38 TIMELINE_FOLLOWING_BOOST), 전 유저가 official 디폴트 팔로우(가입 맞팔+startup 백필+언팔 403).
- When: ① `TEST_USER_EMAIL` 계정 토큰으로 timeline 조회 → 공지 3건이 최상단 블록에 노출. ② 각 항목 kind=community·author official 확인. ③ 기존 community 글(무신사 비즈 계정 1건) 표시 회귀 0 — 목록에서 소실·오염 없음.
- Then: ①~③ 전부 충족.

**RA-5. DELETE 회수 경로 존재 확인 [api] — 정적(호출 없음)**
- Given: 공지는 삭제로 회수 가능해야 "사실상 발행"의 사후 대응이 성립(PLAN F4 실측: `DELETE /api/feeds/{feed_id}` feeds.py:683~697 author-only + purge_feed_document 연쇄 정리, 알림은 `notifications.delete_many({"target_id": feed_id})` 별도 회수).
- When: ① 프로덕션 코드 읽기로 위 두 경로의 존재·시그니처 확인(RA-1 리허설이 purge 경로의 실동작 증적 — 교차 참조). ② 회수 절차(글 purge + 알림 delete_many + 한계: 기열람 노출 회수 불가)를 증적 문서에 runbook 1절로 기록. **본 공지에 대한 삭제 실행은 하지 않는다**(회수는 사용자 지시 시에만).
- Then: ①~② 충족 — 회수 경로 부재 판명 시 판정 회부(등록 중지).

### [unit]/[api] 앱 3파일 정적 검증 (머지 게이트 — 데이터 작업과 독립 트랙)

**RU-1. FeedCard '공지' 배지 — official+community 한정 조건 [unit]**
- Given: components/feed/FeedCard.tsx에 kind 구분 배지 없음(현행 — 타임라인에서 공지가 일반 피드와 시각적 동일). 스펙: `feed.kind === 'community'` 시 카드 헤더 '공지' 텍스트 배지(액센트 보더 칩, 이모지·아이콘 0), 표시 전용·레이아웃 비파괴.
- When: ① 배지 렌더 조건이 kind=community 판정에 배선 — **일반 유저의 feed 글(kind=feed)에서 배지가 뜨는 경로 0건** 논증(조건식 문자 확인). ② 실노출 형상 판정: 현행 community 작성자는 official·비즈 계정뿐이므로 "official+community 글에만 배지"가 실데이터상 성립 — 단 일반 유저도 community 작성이 가능하면(FeedCompose 경로 확인) 배지가 kind 기준으로 그 글에도 뜨는 사양임을 명기(사양 확정: kind 기준인지 author=official 병행 조건인지 PLAN 확정 스펙 B-1과 문자 대조 — 불일치 시 판정 회부). ③ 배지 문자열에 이모지·'AIDOL' 0. ④ 타임라인·채널·마이페이지 3소비처 공통 적용 + 기존 카드 레이아웃(좋아요·댓글·작성자 탭) diff 무영향 논증.
- Then: ①~④ 전부 충족 — ①(일반 feed 글 배지 오노출 경로)이 판정 중심.

**RU-2. 설정 '공지사항' 진입 행 — API 경유 해석 [unit]/[api]**
- Given: 공지 전용 진입 메뉴 부재(현행). 스펙: screens/SettingsScreen.tsx '문의하기(오류 신고)' 행 위에 '공지사항' 행 → `GET /dm/official`로 official_id 해석 → `navigation.navigate('UserChannel', { authorId, name: 'maidol_official', initialTab: 'community' })`, 실패 시 showAlert(시스템 Alert 금지).
- When: [unit] ① official_id가 하드코딩이 아니라 **`GET /dm/official` API 경유**로 해석되는지 배선 확인(하드코딩 발견 시 FAIL — 환경별 id 상이). ② 실패 분기: API 오류/타임아웃 시 showAlert 경로 + 내비게이션 미발생(크래시 0). ③ 로그 `[Settings] 공지사항 진입` 배선. ④ 기존 '문의하기(오류 신고)'(startCsInquiry) 행 diff 0 — 설정→문의 DM 흐름 무회귀(구 E-1과 교차). [api] ⑤ 프로덕션 `GET /dm/official`(routes/dm.py:109~122) 응답 `{official_id, nickname}` 스키마·로그인 유저 접근 가능 실측(읽기 전용 — 계약 전제 확인).
- Then: ①~⑤ 전부 충족.

**RU-3. UserChannel initialTab 하위 호환 [unit] — FAIL 게이트(기존 진입 회귀)**
- Given: 스펙: App.tsx:145 RootStack 파라미터 타입 `initialTab?: 'music'|'artists'|'feed'|'community'` + UserChannelScreen.tsx:38,46 `useState<Tab>(route.params?.initialTab ?? 'music')`. 기존 진입 5경로(FeedScreen:229·FeedDetailScreen:208·AlbumDetailScreen:368·PlayerScreen:1034·NotificationsScreen:102)는 파라미터 미지정.
- When: ① 파라미터가 **optional**이고 기본값 'music' 폴백 — 기존 5개 진입 호출부 diff 0(파라미터 추가 강제 없음)을 grep 전수 확인. ② 타입 유니온이 실제 Tab 타입과 일치(불일치 시 tsc 게이트 — U-1 ② 편승). ③ initialTab='community' 전달 시 커뮤니티 탭 초기 선택 + 탭 전환 로직·isSelf '새 공지 작성' 버튼 노출 조건 diff 0. ④ `npx tsc --noEmit` exit 0(U-1 재실행에 본 3파일 포함).
- Then: ①~④ 전부 충족 — **①(기존 진입 경로 1곳이라도 동작 변경) = FAIL 게이트**.

**RU-4. 개정분 diff 격리 + 기존 v3.205 합격 형상 무회귀 [unit] — FAIL 게이트**
- Given: 개정 접촉 예상 3파일 — `components/feed/FeedCard.tsx`·`screens/SettingsScreen.tsx`·`screens/UserChannelScreen.tsx`(+`App.tsx` 타입 1줄). 기존 v3.205 합격 형상 5파일(`screens/DmChatScreen.tsx`·`hooks/useKeyboardOverlapLift.ts`·`screens/ArtistCodyScreen.tsx`·`services/playback.ts`·`services/audioMode.ts`)은 U-1~U-9 판정 완료 형상.
- When: ① `git status --short`+`git diff --stat`: 개정분 콘텐츠 diff가 위 3+1파일 내(목록 외 접촉 시 커밋 메시지 명기 조건부). ② **기존 v3.205 합격 5파일 diff 0**(개정 작업이 playback·DmChat 등을 건드리면 기합격 판정 무효 — 재검 회부). ③ 서버 파일·0_platform 무접촉(U-9 ① 계승 — 서버 diff 1건 = 즉시 FAIL). ④ 공지 등록·리허설 스크립트 git 미추적(scratchpad 한정 — U-9 ② 계승) + 스크립트/증적 내 크리덴셜·토큰·실계정 이메일 0(`TEST_USER_EMAIL` 표기만).
- Then: ①~④ 전부 충족 — **②(기존 합격 형상 회귀)·③(서버 파일 diff)·④(스크립트 커밋/시크릿)가 FAIL 게이트**.

### [e2e] 실기기 수동 절차 (정적 대체: RU-1~RU-4 완료로 머지 게이트 갈음)

**RE-1. 설정→공지사항→official 채널 직행 [e2e]**
- 실기기 수동 절차(`TEST_USER_EMAIL` 일반 계정): 설정 → '공지사항' 행 탭 → official UserChannel이 **커뮤니티 탭으로 직행**(music 탭 경유 없음) → 공지 3건 노출(최상단 "문의 방법 안내") + 각 카드 '공지' 배지 → 타 유저 채널이므로 '새 공지 작성' 버튼 미노출(읽기 전용) → 뒤로가기 후 재진입 1회 재현. 네트워크 차단 상태에서 '공지사항' 탭 시 showAlert 노출·크래시 0.

**RE-2. 피드 탭 최상단 공지 3장 + 배지 [e2e]**
- 실기기 수동 절차: 피드 탭 진입 → **최상단 블록에 공지 3장 노출**(팔로잉 부스트) + '공지' 배지 → 작성자 영역 탭 → official UserChannel 진입(기존 경로 — music 탭 시작 불변, RE-3와 교차) → 공지 카드 좋아요·댓글 1회 정상(회귀) → 본문 렌더 깨짐 0(줄바꿈 목록 FAQ 포함). 알림함: "maidol_official님이 새 피드를 올렸어요" 3건(팬아웃 포함 시), 탭 시 피드 탭 이동.

**RE-3. 일반 유저 글 배지 미노출 + 기존 진입 회귀 0 [e2e] — FAIL 게이트**
- 실기기 수동 절차: ① 타임라인의 **일반 유저 글(kind=feed)에 '공지' 배지 미노출** 전수 육안(배지 오노출 1건 = RU-1 ① 실기기 확증 FAIL). ② 기존 community 글(무신사) 표시 회귀 0 — 배지는 kind 기준 사양대로 노출 여부 기록(RU-1 ② 판정과 일치 확인). ③ **기존 UserChannel 진입 회귀 0**: 타임라인 작성자 탭·피드 상세·앨범 상세·플레이어·팔로우 알림 5경로 각 1회 → 전부 music 탭 시작 불변. ④ 본인 채널 진입 시 isSelf '새 공지 작성' 버튼 존속. ⑤ FeedCompose 일반 유저 글 작성 1회 정상(회귀).

**RE-4. 문의 DM 흐름 교차 회귀 [e2e]**
- 실기기 수동 절차: 설정 → '문의하기(오류 신고)' → 사유 선택 → official DM 대화 정상 진입(프리필 `[오류신고: 사유] ` — 구 E-1과 증적 공유). 공지가 채널 글로 이동했어도 CS DM 경로는 무변경임을 확인 — '공지사항' 행 신설이 '문의하기' 행 동작·위치를 깨지 않음.

### 개정 게이트 요약

- **머지 게이트(앱 3파일)**: RU-1~RU-4 + U-1(tsc 재실행) 전부 PASS 시 머지 허용 — 데이터 작업(RA군)과 독립 트랙(병렬 가능).
- **데이터 게이트(공지 등록)**: **RA-0 사용자 최종 go 승인이 절대 전제 — 승인 전 본 등록 실행 = 최상위 FAIL(리허설 포함 프로덕션 쓰기는 승인 후에만)**. 승인 후 RA-1 리허설 PASS(흔적 0) → RA-2 본 등록 → RA-3/RA-4 검증 → A-3(서버 파일 무변경 스냅샷 대조) 순서.
- **핵심 FAIL 게이트 5건**: ① **RA-0**(무승인 프로덕션 쓰기) ② **RA-1 ④**(리허설 삭제 후 잔존 흔적 ≥1 = 회수 불능 — 본 등록 금지) ③ **RU-4 ②**(기존 v3.205 합격 형상 5파일 회귀) ④ **RU-4 ③ / U-9 ①**(서버 파일 diff = 쓰기 차단 위반) ⑤ **RU-3 ① / RE-3 ③**(기존 UserChannel 진입 회귀). 1건이라도 FAIL이면 커밋·등록 금지.
- 폐기된 구 A-1·A-2는 실행하지 않는다(DM 브로드캐스트 미실행 — "대기"가 아니라 폐기). RE군 실기기 절차는 비차단 이관 항목이나 RE-3 ①③은 배지·하위 호환의 실기기 확증으로 PASS 기록 필수.

## v3.206 (2026-09-22) — 아티스트 꾸미기 카테고리 개편(악세서리·잠금)·모자/가방 착용 방식 커스텀

> 대상: PLAN.md v3.206 — **카테고리 그리드 개편(활성 4종 상의/하의/신발/악세서리 + 잠금 4종 헤어스타일/헤어컬러/안경/문신 Feather lock) + 악세서리 피커 [모자|가방] 서브탭(전체 조회 후 클라이언트 필터, 모자·가방 동시 선택) + 착용 방식 커스텀(모자: 바로/거꾸로/비스듬히 쓰기, 가방: 손에 들기/크로스로 메기/어깨에 메기 — CAT_OPTIONS→fmt() 직렬화 + 【착용 방식 해석】 1줄)**. 변경은 `2_housing/screens/ArtistCodyScreen.tsx` **1파일 한정**(약 150~200라인 패치). **이번 사이클 서버 무수정·무배포·무재기동** — 서버 검증은 프로덕션 `https://api.maidol.ai.kr` **무인증 GET 실측만**(쓰기·ssh 파일 접촉 0).
> 실행 환경 관행(v3.191~205 계승): 에뮬레이터/adb/maestro 부재 전제 → [e2e]는 **코드 정적 검증 대체 병기 + 실기기 수동 절차 이관**. 앱 코드 `/Users/pearl/TripleJ/2_housing`(frontend, v3.205+④개정 합격 형상 기준선). **시크릿·실계정 크리덴셜 기재 금지**(계정 표기는 `TEST_USER_EMAIL` 플레이스홀더만), 실사용자 데이터 접근 금지. 프로덕션 실측 기준치(PLAN F2): 전체 조회 455건 = 상의 157·하의 145·신발 153, 모자·가방·악세서리·장소 active 0건.

### [unit] 앱 정적 검증 (머지 게이트)

**U-1. 선행 게이트 — v3.205 합격 형상 기준선 + 타입 무결성 [unit]**
- Given: 직전 v3.205(+④개정) 합격 형상 클린 기준선 위에서만 이번 diff 귀속 판정(U-6)이 성립. 이번 접촉 예상은 ArtistCodyScreen.tsx 1파일뿐.
- When: ① `git log --oneline -1` + `git status --short`(2_housing 스코프)로 클린 기준선 확인(미커밋 잔존 시 착수 금지·반려). ② 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`.
- Then: ① 클린 기준선 ② **exit 0** — Cat 타입 재정의('상의'|'하의'|'신발'|'모자'|'가방')가 selected/itemOptions/CAT_OPTIONS/fmt 등 파일 내 전 소비처와 정합함을 컴파일로 확정.

**U-2. 카테고리 그리드 — 활성 4장 + 잠금 4장·Feather lock·이모지 0 [unit] — FAIL 게이트(이모지 아이콘)**
- Given: 현행 그리드는 Cat 8종 카드 전부 활성(2열 `styles.catCard`, :668-690 상당). 스펙 A: 활성 4장(상의·하의·신발·**악세서리**) + 잠금 4장(`LOCKED_CATS = ['헤어스타일','헤어컬러','안경','문신']`) 순 렌더, 잠금 아이콘은 **Feather "lock" 벡터**(AttendanceModal.tsx:130 관행), 이모지 금지.
- When: ① 렌더 조건 배선: 활성 카드가 정확히 4장(악세서리 카드 1장이 '모자'·'가방' 두 슬롯 요약 겸용 — 부제 "모자·가방 고르기"/선택 시 두 아이템명 병기) + 잠금 카드가 LOCKED_CATS 4장, 그 외 카드 0장 — 헤어스타일 등이 활성 카드로 남는 경로 0건 문자 확인. ② 잠금 아이콘이 `<Feather name="lock" …>`(muted 색·흐린 스타일) — **이모지 문자 0건 전역 grep**: `grep -rn` ArtistCodyScreen.tsx 대상 유니코드 이모지(🔒 등 U+1F300~1FAFF·U+2600~27BF 대역) 검출 0 + 잠금 카드 관련 문자열에 이모지 부재 정밀 판독(파일 전체 신규 diff 기준). 발견 1건 = FAIL. ③ 잠금 카드 탭 동작: onPress → `showAlert('준비 중', …)` **1회성 안내만**(시스템 Alert 금지 관행 — Alert.alert 호출 0건), `openPicker` 미호출(피커 오픈 경로 0건 논증), onLongPress 무동작(기존 선택 해제 롱프레스가 잠금 카드에 배선되지 않음). ④ 잠금 4종이 Cat 타입에서 제외되어 selected/itemOptions에 진입 자체가 불가(타입 레벨 봉인 — tsc U-1 교차). ⑤ sheet 모드 부제(:663) "옷·헤어를 골라주세요" → "옷·모자·가방을 골라주세요" 문자 확인 + 헤어 미선택 시 4단계 "현재 시트 유지" 경로 불변(:447-455 상당).
- Then: ①~⑤ 전부 충족 — **②(이모지 잠금 아이콘 ≥1건)가 FAIL 게이트**.

**U-3. 악세서리 피커 — [모자|가방] 서브탭·전체 조회·동시 선택·SAMPLE 폴백 [unit]**
- Given: 서버는 `?category=모자|가방|악세서리` 전부 400(PLAN F2) — 스펙 B: 악세서리 진입 시 **category 파라미터 없는** `GET /business/ads/active` 전체 조회 → `item.category ∈ {모자,가방}` 클라이언트 필터(wishlistStore.ts:107 관행). 선택 모델은 내부 Cat '모자'·'가방' 분리(각 단일 선택 = 동시 착용 성립).
- When: ① 조회 배선: 악세서리 피커 요청 URL에 category 쿼리 부재(**400 유발 파라미터를 앱이 쓰지 않음** — A-1 서버 실측과 교차 논증) + 응답을 `{모자,가방}` 동치 필터로 보관, 상의/하의/신발 피커의 기존 `category=` 호출은 diff 0. ② 서브탭 세그먼트 [모자|가방](기본 모자) 전환 배선: 세그먼트가 baseItems **앞단** 필터로 적용되어 드릴다운·패싯·기선택 정렬이 서브탭별 목록 기준으로 재계산됨(전환 시 상태 오염 — 모자 탭 드릴 상태가 가방 탭에 잔존하는 경로 여부 판정·기록) + 로그 `[ArtistCody] accessory subcat` 배선. ③ **동시 선택 성립**: pickItem이 현재 세그먼트의 Cat('모자' 또는 '가방') 슬롯에 저장 → `selected['모자']`와 `selected['가방']` 동시 보유 가능 + 악세서리 그리드 카드·선택 요약에 둘 다 표기 + 개별 해제(롱프레스/재선택) 가능 — 한쪽 선택이 다른 쪽을 덮어쓰는 경로 0건 문자 확인. ④ **실데이터 0건 폴백(PLAN 확정 = SAMPLE 교체)**: 전체 조회 결과 중 모자/가방 0건 또는 요청 실패(catch) 시 SAMPLE_ITEMS 폴백 — 샘플이 **모자 5종·가방 5종으로 교체**(볼캡/버킷햇 등·크로스백/토트백 등 가상 브랜드 관행)되고 기존 장신구(귀걸이·목걸이·팔찌 등) **잔존 0**, 샘플 위시 하트 숨김 유지, 서브탭별 5종씩 정상 분배. ⑤ 위시리스트 탭: 악세서리 피커에서 `it.category ∈ {모자,가방}` + 현재 서브탭 일치 필터(현 실데이터 0건 → 빈 안내 렌더·크래시 0), 상의 등 기존 카테고리 위시 탭 필터(`category === pickerCat`) diff 0. ⑥ 성별 필터 칩: 악세서리 피커 **미노출**(GENDER_FILTER_CATS 불변 — U-5 교차).
- Then: ①~⑥ 전부 충족 — ③(동시 선택)·④(폴백 성립)가 판정 중심.

**U-4. 착용 방식 — CAT_OPTIONS 3종×2 + fmt() 직렬화 스냅샷·미선택 desc 오염 0 [unit] — FAIL 게이트(직렬화 누락)**
- Given: 스펙 C — CAT_OPTIONS에 `모자: [{label:'착용 방식', values:['바로 쓰기','거꾸로 쓰기','비스듬히 쓰기']}]`·`가방: [{label:'착용 방식', values:['손에 들기','크로스로 메기','어깨에 메기']}]` 추가만으로 '세부 옵션' 박스 UI와 fmt()(:351-358 상당) 프롬프트 직렬화가 자동 반영되는 구조. CLOTHING_CATS(:349)에 '모자','가방' 추가('악세서리' 제거)로 2단계 블록 분류.
- When: ① CAT_OPTIONS 확장이 위 라벨·값 문자와 **정확 일치**(모자 3종·가방 3종 — 오탈자·순서 포함 문자 대조). ② **직렬화 스냅샷성 검증**: 모자 아이템+‘거꾸로 쓰기’, 가방 아이템+‘크로스로 메기’ 선택 상태를 가정한 fmt() 경로 추적으로 desc 내 정확한 형태가 `모자="BRAND 볼캡 (착용 방식:거꾸로 쓰기)"`·`가방="BRAND 크로스백 (착용 방식:크로스로 메기)"`(기존 상의 `(핏:슬림)` 패턴과 동형 — 구분자·괄호·콜론 문자 단위)로 2단계 "새 의상 적용" 블록에 포함됨을 확인 — CLOTHING_CATS 누락으로 모자/가방이 2단계 블록에서 빠지는 경로 = **직렬화 누락 FAIL**. ③ 【착용 방식 해석】 1줄 합성: 모자/가방 중 착용 방식 **선택 시에만** desc에 포함(거꾸로=backwards 등 해석 지시문 — PLAN 확정 문구와 대조), 아이템만 선택하고 방식 미선택이면 해석 줄 불포함 여부 기록(스펙상 "선택 시" — 문자 기준 판정). ④ **미선택 시 desc 오염 0**: 모자·가방 모두 미선택 시 desc가 기존 v3.205 형상과 **문자 동일**(미선택 기본형 :370-373에 모자/가방 미추가 — "모자 없음" 류 문구 삽입 0, 해석 줄 0, 1단계 의상 제거 지시문(:394)은 기존 그대로) — 프로그램적/문자 단위 비교 논증, 오염 1건 = FAIL. ⑤ 저장 경로: 옵션이 기존 `itemOptions[cat]` → AppliedItem.options(:494)로 영속 — **신규 필드·서버 계약 변화 0**(taskStore.setInput({outfitDesc}) 경유 user_text 통과 — ArtistLoadingScreen.tsx 무수정 전제, U-6 교차). ⑥ 옵션 칩 토글·재탭 해제가 기존 '세부 옵션' 박스 로직 재사용(신규 UI 재작성 발견 시 이중 규칙 기록).
- Then: ①~⑥ 전부 충족 — **②(2단계 블록 직렬화 누락 — 선택했는데 프롬프트 미반영)·④(미선택 desc 오염)가 FAIL 게이트**.

**U-5. v3.205 회귀 — 성별 자동 필터·위시리스트·드릴다운·SAMPLE 폴백 파괴 0 [unit] — FAIL 게이트**
- Given: 같은 파일(ArtistCodyScreen.tsx)에 v3.205 합격 형상(성별 자동 필터 U-8, 위시 탭, 5단계 드릴다운, SAMPLE 폴백)이 살아 있음 — 이번 개편이 이를 파괴하면 기합격 판정 무효.
- When: ① **성별 자동 필터**: `GENDER_FILTER_CATS = ['상의','하의','신발']` **한정 유지**(:95 상당 — 모자/가방/악세서리 미추가 문자 확인), genderMatches(:75-81)·3단 폴백(:228-231)·피커 토글 칩(:845-855)·피커 재진입 시 기본 ON 복귀 전부 diff 0 — 악세서리 피커에서 성별 필터가 적용되어 전량 소실되는 경로 0건(U-3 ⑥ 교차). ② **위시리스트 탭**: 상의/하의/신발 피커의 위시 필터·하트 토글 diff 0. ③ **5단계 드릴다운**(:582-645): 플랫폼›브랜드›성별›제품›색상 체인·패싯 수치·기선택 정렬 불변 — 악세서리 서브탭 필터가 baseItems 앞단 삽입 외에 드릴 체인 코드를 수정하지 않음. ④ **SAMPLE 폴백**: 상의/하의/신발의 서버 0건·요청 실패 폴백(:252, :257-258) 경로 diff 0(샘플 교체는 악세서리 장신구→모자/가방만). ⑤ 적용 플로우 회귀: outfit 모드 최소 1개 선택 게이트·피로도 게이트·별 사전 체크·ArtistLoading 직행, 하의 특별 지시·참조 이미지 경고(:499)·로고 블록, appendOutfitObjectNames **top/bottom/shoes 3필드 한정**(ArtistLoadingScreen.tsx:85-91 무수정 — 모자/가방은 텍스트 전용) 전부 불변. ⑥ 기존 저장 착장 호환: AppliedItem.cat이 free string이라 과거 '악세서리' cat 저장분의 ArtistResult 표시 회귀 0(마이그레이션 코드 불요 논증).
- Then: ①~⑥ 전부 충족 — **①(성별 필터 한정 파괴)·③(드릴다운 파괴)·②④(위시·폴백 파괴)가 FAIL 게이트**.

**U-6. diff 격리 — ArtistCodyScreen.tsx 1파일 + 직전 사이클 파일 diff 0 + tsc [unit] — FAIL 게이트**
- Given: 변경 매트릭스 = `2_housing/screens/ArtistCodyScreen.tsx` **1파일**. 직전 v3.205(+④개정) 합격 형상 파일들 — `screens/DmChatScreen.tsx`·`hooks/useKeyboardOverlapLift.ts`·`services/playback.ts`·`services/audioMode.ts`·`components/feed/FeedCard.tsx`·`screens/SettingsScreen.tsx`·`screens/UserChannelScreen.tsx`(+App.tsx 타입) — 은 무접촉이어야 기합격 유지.
- When: ① `git status --short` + `git diff --stat`(2_housing 스코프): 콘텐츠 diff가 **ArtistCodyScreen.tsx 1파일 내**(목록 외 접촉 시 커밋 메시지 명기 조건부 — 관례이나 ArtistLoadingScreen·stores 접촉은 스펙 위반으로 반려). ② **직전 사이클 파일들 diff 0**(위 8파일 전수 — 1건이라도 diff 시 기합격 판정 무효·재검 회부). ③ **서버 파일·0_platform 무접촉**(서버 diff 1건 = 즉시 FAIL — 이번 사이클 서버 무수정 원칙). ④ `npx tsc --noEmit` exit 0(U-1 ② 재실행 — 최종 형상 기준). ⑤ 신규 노출 문자열 브랜딩: 이번 diff 내 'AIDOL' 0·이모지 0(U-2 ② 교차 — 상시 게이트 계승).
- Then: ①~⑤ 전부 충족 — **②(직전 합격 형상 회귀)·③(서버 파일 diff)가 FAIL 게이트**.

### [api] 서버 계약 실측 (무인증 GET만 — 쓰기·파일 접촉 0)

**A-1. `?category=모자` 400 + 전체 조회 계약 존속 [api]**
- Given: 프로덕션 `ALLOWED_AD_CATEGORIES = {"상의","하의","신발","장소"}`(routes/business.py:30 — 읽기 실측 완료 형상)로 `?category=모자|가방|악세서리`는 400. 앱 악세서리 피커는 이 파라미터를 **쓰지 않는** 전체 조회 방식(U-3 ①)이 스펙 — 서버 거부와 앱 조회 방식의 교차 확인이 본 시나리오의 목적. 서버는 이번 사이클 무수정이므로 결과는 현상 확인이지 수정 대상 아님.
- When(전부 무인증 GET, 프로덕션 `https://api.maidol.ai.kr`): ① `GET /api/business/ads/active?category=모자` → **400 실측**(가방·악세서리도 각 1회 — 3건 모두 400 확인, 200이 돌아오면 서버가 변경된 것 = 전제 붕괴로 판정 회부). ② 교차 판정: U-3 ①의 "앱이 category 파라미터를 쓰지 않음"과 본 400 실측을 병기 — **앱 요청 형상(파라미터 없음)이 400 유발 경로를 원천 회피함**을 계약 수준에서 확정. ③ `GET /api/business/ads/active`(파라미터 없음) → 200 + 전건 수신, category 분포가 **기존 3종(상의/하의/신발)만**(+장소 0건) — 모자/가방 0건 실측(455건 기준치 대비 증감은 기록만, FAIL 아님) → 앱 폴백(U-3 ④) 전제 성립. ④ 응답 아이템 스키마에 **gender 필드 존속**(v3.205 성별 필터의 계약 전제 — 소실 시 U-5 ① 재협의 차단) + id/name/brand/category/이미지 등 기존 필드형 불변. ⑤ `GET /health` 200(스모크). 전 요청 무인증·읽기 전용 — 인증 헤더·쓰기 메서드 사용 0.
- Then: ①~⑤ 전부 충족 — ①(400 확인)+②(앱 회피 교차)가 판정 중심, ④가 회귀 게이트.

### [e2e] 실기기 수동 절차 (정적 대체: U-1~U-6 + A-1 완료로 머지 게이트 갈음)

**E-1. 꾸미기 진입 — 그리드 4+잠금 카드 육안 + 잠금 탭 안내 [e2e]**
- 실기기 수동 절차(`TEST_USER_EMAIL` 계정): 아티스트 꾸미기 진입 → 그리드에 **활성 4장(상의/하의/신발/악세서리) + 잠금 4장(헤어스타일/헤어컬러/안경/문신)** 육안 — 잠금 카드에 **자물쇠 벡터 아이콘**(이모지 아님·흐린 스타일) + 부제 "준비 중" → 잠금 카드 탭 → '준비 중' 안내(showAlert)만 뜨고 **피커 미오픈** → 꾹 눌러도 무동작 → sheet 모드 진입 시 부제 "옷·모자·가방을 골라주세요" 확인.

**E-2. 악세서리→모자 서브탭→착용 방식→생성 — 프롬프트 로그 확증 [e2e] — FAIL 게이트(프롬프트 미반영)**
- 실기기 수동 절차: 악세서리 카드 탭 → 피커 [모자|가방] 서브탭(기본 모자) → 현 실데이터 0건이므로 **모자 샘플 5종** 노출(장신구 0·위시 하트 숨김·성별 칩 미노출) → 모자 1개 선택 + '착용 방식' 칩에서 **'거꾸로 쓰기'** 선택 → 생성 실행(별·피로도 게이트 통과 계정) → __DEV__ 프롬프트 로그(desc)에 `모자="… (착용 방식:거꾸로 쓰기)"` + 【착용 방식 해석】 줄 **포함 육안 확증** — 미포함 1건 = U-4 ②의 실기기 확증 FAIL. 생성 결과 이미지의 착용 반영도는 기록 사안(모델 재현성 — FAIL 아님·정직 보고).

**E-3. 가방 교차 + 모자·가방 동시 선택 [e2e]**
- 실기기 수동 절차: 악세서리 피커 → **가방 서브탭** 전환 → 가방 샘플 5종 노출 → 가방 1개 선택 + '크로스로 메기' 선택 → 모자 서브탭 복귀 시 모자 선택 유지(동시 선택 성립) → 그리드 악세서리 카드에 모자·가방 **둘 다 요약 표기** → 개별 해제 1회(가방만 해제 → 모자 잔존) → 재선택 후 생성 1회 → 로그에 `가방="… (착용 방식:크로스로 메기)"` 포함 → 드릴다운(플랫폼›브랜드›…)이 서브탭별 목록 기준으로 동작 1회 확인.

**E-4. 기존 상의/하의/신발 플로우 회귀 + 미선택 프롬프트 불변 [e2e]**
- 실기기 수동 절차: ① 상의 피커 — 기존 category= 조회 실데이터 노출(모자/가방 미혼입), 성별 자동 필터 칩 기본 ON·'전체 보기' 토글·재진입 복귀, 5단계 드릴다운·위시리스트 탭 각 1회 회귀 0(v3.205 E-3 축약 재실행). ② 상의+하의+신발만 선택(모자/가방 미선택)으로 생성 1회 → 프롬프트 로그가 기존 형상(착용 방식·해석 줄 **불포함**, 기본형 3종 불변) — U-4 ④의 실기기 확증. ③ 과거 '악세서리' cat 포함 저장 착장의 ArtistResult 표시 1회 정상. ④ 생성 요청의 참조 이미지가 여전히 top/bottom/shoes 3종만 첨부(모자/가방 텍스트 전용 — 서버 계약 불변).

### 게이트 요약

- **머지 게이트(앱 1파일)**: U-1~U-6 + A-1 전부 PASS 시 머지 허용(frontend 자동 push 관례 — 서버 배포 없음). E-1~E-4는 정적 대체 완료 조건으로 비차단 이관하되 **E-2(착용 방식 프롬프트 포함)·E-4 ②(미선택 불변)는 U-4의 실기기 확증으로 PASS 기록 필수**.
- **핵심 FAIL 게이트 5건**: ① **U-2 ②**(이모지 잠금 아이콘 사용 ≥1건 — Feather lock 벡터만 허용) ② **U-5 ①③**(v3.205 성별 자동 필터 한정 파괴·5단계 드릴다운 파괴 — 위시·SAMPLE 폴백 포함) ③ **U-4 ② / E-2**(desc 직렬화 누락 — 착용 방식 선택했는데 프롬프트 미반영) ④ **U-4 ④**(미선택 시 desc 오염 — 기존 프롬프트 문자 변형) ⑤ **U-6 ②③**(직전 사이클 합격 파일 diff·서버 파일 diff = 격리 위반). 1건이라도 FAIL이면 커밋 금지.
- 사용자 결정 이월 사안(PLAN §결정): 서버 ALLOWED_AD_CATEGORIES 1줄 개방·헤어 잠금 확인·모자/가방 참조 이미지 필드·'비스듬히 쓰기' 채택 여부 — 본 사이클 판정 대상 아님(승인 시 차기 TESTPLAN에서 A-1 ①의 400 전제가 뒤집히므로 재실측 필요 명기).

## v3.207 (2026-09-22) — 실기기 피드백 12건: 코치마크·first-run 게이트·차트 신곡·keyboard-controller 근본 전환·신고 이미지 첨부·비밀번호 재설정·테스트 데이터 정리 + APK/AAB

> 대상: PLAN.md v3.207(:3813~) 12항목 — ① 튜토리얼 코치마크(anchor 스포트라이트·화살표) ② 차트 신곡 기본 탭 ③ 테스트 피드 4건 삭제 ④ official 발신 DM 1,111건 삭제 ⑤ react-native-keyboard-controller 전환(구훅 2종 폐기) ⑥ 신고(DM) 이미지 첨부(서버+앱) ⑦ 비밀번호 재설정(서버+앱) ⑧ 작곡 step 3 연주곡 선택지 제거 ⑨ 작사 듀엣(무변경 확인) ⑩ 성별 필터 서버 폴백+칩 발견성 ⑪ 튜토리얼 first-run 게이트 ⑫ 작업실 ⓘ 제거.
> 실행 전제: 앱 `/Users/pearl/TripleJ/2_housing`(frontend, v3.206 합격 형상 기준선). 서버 수정 2건(⑥ dm-image·⑦ password-reset)과 데이터 삭제 2건(③④)은 **오케스트레이터가 사용자 최종 확인 후 별도 실행** — [api] 시나리오는 배포/실행 완료 후 착수(전이면 "대기"로 보고), test-designer/tester의 사전 서버 접근은 **프로덕션 무인증 GET만**(쓰기·ssh 파일 수정 0, 삭제 검증 mongo 조회는 컨테이너 python **읽기 전용**). ⑤는 네이티브 모듈 — [e2e] ⑤ 검증은 **keyboard-controller 포함 신규 APK(eas preview)** 에서만 유효(구빌드 검증 무효), AAB(production)는 산출 확인.
> 시크릿·실계정 크리덴셜 기재 금지 — `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`/`NEW_PASSWORD` 플레이스홀더만 표기. **재설정 코드 6자리 값은 어떤 증적·보고서·스크린샷에도 기재 금지**(dev 모드 서버 로그에서 읽어 즉시 사용, 증적 표기는 `******` 마스킹). 실사용자 데이터 접근 금지(자기 테스트 계정 한정).

### [unit] 앱 정적 검증 (머지 게이트 — 서버 배포·데이터 삭제와 독립 트랙)

**U-1. 선행 게이트 — 클린 기준선 + tsc exit 0 + 의존성 격리 [unit]**
- Given: v3.206 합격 형상 클린 기준선 위에서만 diff 귀속 판정(U-9)이 성립. 접촉 허용 목록 = PLAN 변경 매트릭스: App.tsx·components/TutorialOverlay.tsx·utils/tutorialAnchors.ts(신규)·utils/tutorialGate.ts(신규)·screens/MapScreen.tsx·ChartScreen.tsx·SearchScreen.tsx·PlayerScreen.tsx·FeedScreen.tsx·PlaylistScreen.tsx·components/TrackRow.tsx·screens/DmChatScreen.tsx·Modal 5종(PlaylistPickerSheet/ReportModal/AppealModal/AnswerEditModal/AlbumCreateModal)·hooks 구훅 2종(삭제)·components/auth/AuthPanel.tsx·screens/SettingsScreen.tsx·services/authService.ts·screens/MusicGenerationScreen.tsx·screens/ArtistCodyScreen.tsx·package.json.
- When: ① `git log --oneline -1`+`git status --short`(2_housing 스코프) 클린 기준선(미커밋 잔존 시 착수 금지·반려). ② 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`. ③ package.json diff = `react-native-keyboard-controller` 정확 1건 추가뿐(타 의존성 버전 변동 0) + lock 파일 정합.
- Then: ② **exit 0** — Mode 유니온('forgot'|'forgotSent')·TutorialStep 확장(anchorKey/placement)·ChartTrack.created_at 등 타입 변경이 전 소비처와 정합함을 컴파일로 확정.

**U-2. [항목⑤] keyboard-controller 전환 전수 — 구훅 소비처 0·KeyboardProvider·Modal 5종 [unit] — FAIL 게이트(전환 누락·혼용)**
- Given: 실패 인과 = RN `Keyboard` 이벤트 의존(PLAN F5 — edge-to-edge 기기에서 미발화/좌표계 불일치, 두 세대 훅 모두 실기기 실패). 전환 스펙: 네이티브 WindowInsetsAnimationCompat 기반 keyboard-controller로 일원화, 구훅 2종 완전 폐기.
- When: ① **`grep -rn "useAndroidKeyboardLift\|useKeyboardOverlapLift"` 2_housing 전역 → 소비처 0건 + `hooks/useAndroidKeyboardLift.ts`·`hooks/useKeyboardOverlapLift.ts` 파일 자체 삭제** 확인 — 1건이라도 잔존 = 혼용 FAIL(신구 이중 보정 재발 인과). ② App.tsx 루트 `KeyboardProvider` 래핑 정확 1곳(라이브러리 요구 위치 — NavigationContainer 대비 상/하위 어느 쪽인지 근거와 함께 기록). ③ **Modal 5종 전수 체크리스트 표**: PlaylistPickerSheet(:32)·ReportModal(:43)·AppealModal·AnswerEditModal·AlbumCreateModal 각각 keyboard-controller API(`useKeyboardState` 또는 라이브러리 KAV)로 전환 — 5/5 전환 확인, 1종 누락 = FAIL(RN Modal 별도 window가 실패 뿌리 — F5). ④ DmChatScreen: RN KeyboardAvoidingView·overlap 훅 참조 0 + keyboard-controller `KeyboardAvoidingView(behavior='padding')` 교체, 기존 `[DmChat]` 로그·dmSocket 배선·pending 대화 분기 diff 0. ⑤ 신규 경로에 RN `Keyboard.addListener` 재유입 0(실패 인과 복귀 차단 — 신규 diff 기준 grep). ⑥ iOS 경로: 동일 컴포넌트로 통일 — Platform 분기 잔존 시 의도·근거 기록(기존 iOS KAV 회귀는 E-1 ⓔ 실기기 확증). ⑦ 로그 추적자 `[KeyboardCtl]` 배선.
- Then: ①~⑦ 전부 충족 — **①(구훅 잔존)·③(Modal 5종 중 전환 누락)이 FAIL 게이트**.

**U-3. [항목⑪] tutorialGate — getAllKeys 판정 경계 3케이스 [unit] — FAIL 게이트(기존 유저 오판)**
- Given: 판별 유일 근거 = **진짜 신규 설치만 AsyncStorage 완전 empty**(PLAN F1 — auth-token은 로그아웃 시 삭제, player-storage-v1은 비회원 재생만 해도 생성). 스펙: `maidol_first_run_v1` 마커 확정 — 미존재 시 getAllKeys() 검사, 튜토리얼 키 제외 키 1개 이상 → 'existing'(seen 6키 일괄 선기록), 완전 빈 → 'fresh'.
- When: ① **판정 경계 케이스 표 3종 문자 추적**: ⓐ **기존 키 보유자** — `player-storage-v1` 1개만 존재(비회원 재생 이력) / `auth-token-v1` 존재 / zustand persist 키만 존재 각각 → 전부 'existing' 판정 + `maidol_tutorial_seen_v1:{player|chart|feed|playlist|search|map}` 6키 일괄 기록 → TutorialOverlay 자동 노출 effect 미동작. ⓑ **완전 신규** — getAllKeys() `[]` → 'fresh' + 화면별 최초 1회 노출 유지(설치 후 2번째 접속의 첫 방문 화면 포함 — 기본안 해석). ⓒ **재설치** — 스토리지 초기화로 ⓑ와 동일 상태 → 'fresh'(스펙상 신규 취급 — 서버 조회 등으로 기존 유저 복원하는 로직 부재 확인·명기, 사용자 결정 사안 ⑤ 반려 시 재협의). ② **제외 필터 경계**: 판정에서 제외하는 키가 정확히 `maidol_tutorial_seen_v1:` prefix + `maidol_first_run_v1` 자신뿐 — 제외 과다(예: `maidol_` prefix 전체 제외)로 기존 유저가 'fresh' 되는 경로 0건 문자 확인. ③ 레이스: 마커 미확정(판정 진행 중/부팅 직후) 시 오버레이 **미노출**(보수 기본값 계승 — restoreSession과 순서 무관 논증). ④ getAllKeys throw(스토리지 오류) 시 catch 처리 방향('existing' 취급 = 보수)이 스펙 정합인지 판정·기록. ⑤ 마커 기록 후 재부팅 시 getAllKeys 재검사 생략(마커 우선) — 매 부팅 전체 스캔 아닌지 확인. ⑥ 로그 `[TutorialGate]` {verdict, keyCount} 배선 — 토큰 값·키 값 로그 출력 0.
- Then: ①~⑥ 전부 충족 — **①ⓐ·②(기존 키 보유자가 'fresh' 판정되는 경로 ≥1건) = FAIL 게이트**.

**U-4. [항목①] 코치마크 — anchor registry·fallback 경로 [unit]**
- Given: 스펙 = TutorialStep `anchorKey?`/`placement?` + utils/tutorialAnchors registry(registerAnchor/getAnchor, measureInWindow) + 4분할 딤 스포트라이트 + 화살표, **anchor 미등록/측정 실패 시 현행 카드형 graceful fallback**. anchor 스텝 범위 = 화면당 1~2개 한정(40% 룰).
- When: ① registry 계약: TrackRow 옵션 prop으로 **첫 행(index 0)만** 등록(전 행 등록 발견 시 과설계 기록), 화면별 anchor 스텝이 차트 ⋮·검색 ⋮·플레이어 주요 버튼·피드 글쓰기 범위 내(전 스텝 앵커화 = 범위 고정 위반 반려). ② **fallback 경로 문자 추적 — 판정 중심**: getAnchor(key) 미등록(null)·rect 0×0·화면 밖 좌표 각각 → 스포트라이트·화살표 미렌더 + 기존 균일 딤+하단 카드로 강하(크래시·빈 오버레이 0) — 리스트 로딩 전 자동 노출 타이밍(anchor 등록 전)이 대표 케이스임을 명기. ③ 4분할 딤 산식: anchor rect 구멍 좌표 화면 경계 클램프 + placement 상/하 자동 판정식 문자 확인. ④ 화면 언마운트/리스트 갱신 시 stale rect 처리(다음 진입 화살표 오지시 경로) 판정·기록. ⑤ 기존 skip·Android 백버튼 skip·캐러셀 진행 diff 0, 텍스트 전용 스텝은 현행 유지. ⑥ ⑪ 게이트와의 결합: 'fresh'에서만 자동 노출(U-3 교차) — anchor 유무와 무관.
- Then: ①~⑥ 전부 충족 — ②(fallback 부재로 미등록 시 크래시/허공 지시)가 판정 중심.

**U-5. [항목⑩] 성별 필터 — 서버 폴백 최우선 연결 + 칩 상시 노출 조건 [unit]**
- Given: 미발견 원인 = 서버에 gender="여성" 있는데 앱 3단 폴백이 서버 캐릭터를 미조회 → null → 칩 자체 미노출(PLAN F10 — characterTaskStore persist 미등록). 스펙: (a) 서버 캐릭터 gender 폴백 1순위 (b) 상의/하의/신발 피커 칩 **상시 노출**.
- When: ① 폴백 체인 문자 대조: **서버 캐릭터 gender(기존 GET /character 응답 재사용) → apiResult.gender → taskStore.pendingGender → artistProfileStore** — 서버 값이 최우선 + 신규 네트워크 호출 최소화(화면 진입마다 신규 fetch 남발 시 기록). ② **칩 상시 노출 조건식**: 노출 게이트(:634 상당)에서 `artistGender &&` 의존 제거 — gender null이어도 GENDER_FILTER_CATS(상의/하의/신발) 피커에서 칩 렌더: null → "성별 미설정 · 전체 표시"(탭 시 프로필 성별 설정 유도 안내 — showAlert, 시스템 Alert 0) / 판별 → 현행 "◯◯용만"↔"전체 보기" 토글. ③ null 시 필터 미적용(전량 노출) 안전 원칙 불변 + 피커 재진입 기본 ON 복귀(v3.205 U-8 ③) diff 0. ④ 회귀: genderMatches 재사용(이중 규칙 0)·드릴다운 5단계·위시탭·SAMPLE 폴백·v3.206 악세서리(GENDER_FILTER_CATS 3종 한정 — 악세서리 미추가·서브탭·동시 선택·착용 방식) 전부 diff 0. ⑤ 로그 `[ArtistCody] 성별 자동 필터` {g, cat, before, after} 유지 + 폴백 출처(server|task|local) 기록 여부.
- Then: ①~⑤ 전부 충족 — ①(서버 폴백 연결)·②(칩 상시 노출 조건)이 판정 중심, ④는 U-9 교차 FAIL 게이트.

**U-6. [항목⑧] 연주곡 선택지 제거 — step 3·편집 모달 동반 + 카드 경로 생존 [unit] — FAIL 게이트(편집 모달 잔존·카드 경로 파괴)**
- Given: 3곳 동반 수정(:1286 렌더 배열·:450 편집 모달 case 3·:49 상수), ComposeLyricsPick "가사 없이 만들기 (연주곡)" 카드는 존치 — 연주곡 진입 일원화.
- When: ① step 3 렌더 배열 = VOCAL_OPTIONS(남/여 2종)만 — INSTRUMENTAL_OPTION 참조 0. ② **편집 모달 case 3 동반 제거** — 누락 시 재선택 모달로 연주곡 우회 진입 잔존 = FAIL. ③ :49 상수·미사용 참조 정리(dead code 잔존 시 기록). ④ :926-931 연주곡 해제 방어 분기 **유지**(삭제 발견 시 되감기 유입 가드 소실 = FAIL). ⑤ **카드 경로 생존 — 가사 없이 카드로 연주곡 생성 가능**: ComposeLyricsPickScreen.tsx:279-288 카드 diff 0 + setInstrumental(true) → v3.203 5문항 한정 체인(300→301→310→5→10→13, musicStore.instrumental 기준) 회귀 0 — 선택지 제거가 연주곡 **기능 자체를 소멸시키지 않음** 논증(가사 유지 무보컬 서브 유스케이스 소멸은 사용자 결정 사안 ④ — 승인 전제 명기). ⑥ VOCAL_OPTIONS(:45) 불변(타 화면 공유 상수).
- Then: ①~⑥ 전부 충족 — **②(편집 모달 우회 잔존)·④(방어 분기 소실)·⑤(카드 경로 파괴) = FAIL 게이트**.

**U-7. [항목⑦] AuthPanel forgot 모드 — 상태 전이 전수 + 비밀번호 로그 0 [unit] — FAIL 게이트(민감정보 로그)**
- Given: 스펙 — Mode에 'forgot'|'forgotSent' 추가(:24), 로그인 폼 하단 "비밀번호를 잊으셨나요?" 링크(:273-280 사이), 이메일 입력→코드+새 비밀번호→완료 후 login 복귀, "아이디는 가입하신 이메일입니다" 안내 1줄. services/authService.ts passwordResetRequest/Confirm.
- When: ① **상태 전이 표 전수**: login→(링크)→forgot→(요청)→forgotSent→(confirm 성공)→login 복귀 / 각 단계 취소·뒤로 → login / **request 실패(네트워크 외 4xx)도 forgotSent 진행 여부** — 존재 비노출 UX 정합 판정·기록 / 기존 'gate'|'form'|'blocked'|'pending' 모드 diff 0. ② onModeChange 시그니처 변경 소비처 전수 + SettingsScreen 헤더 타이틀 매핑에 신규 모드 2종 추가(누락 시 undefined 헤더 경로 = tsc 또는 런타임 확인). ③ **민감정보 로그 0**: 신규 diff 내 console 출력에 password/new_password/code **값** 포함 0건(정밀 판독 — `[Auth]` 로그 이메일 마스킹 여부는 기록 사안, 비밀번호·코드 평문 로그 1건 = FAIL). ④ 앱이 request 응답 body에서 코드를 읽는 경로 0건(dev 모드 포함 응답 비포함 계약 — A-1 ⑦ 교차). ⑤ 안내 문구: 이메일 라벨 하단 "아이디는 가입하신 이메일입니다" 배선. ⑥ confirm 입력 선검증(비밀번호 규칙) 여부·서버 400 문구 표시 경로 확인(크래시 0).
- Then: ①~⑥ 전부 충족 — **③이 FAIL 게이트**.

**U-8. [항목②⑨⑫] 국소 항목 정적 [unit]**
- **②** ChartScreen: 기본 탭 `useState<ChartTab>('new')`(:74) + TABS 순서 신곡 맨 앞·Top100 2번째 존치 + 폴백 endpoint(:96) 신곡 + 튜토리얼 문구(:27-31)·빈 상태(:312-314) 신곡 기준 + ChartTrack `created_at?` 옵션 필드·TrackRow footer 상대 발매일(서버 무수정 — `/tracks/?sort=created_at` 기존 계약).
- **⑫** MapScreen: :292-300 ⓘ 블록 삭제 + tutorialRef(:241)·Handle import(:35) 정리(미사용 import 잔존 기록). **TutorialOverlay 컴포넌트(:744) 존치 필수** — ⓘ만 제거해야 하며 오버레이 통째 제거 시 ①⑪ 파괴 = FAIL. 재보기 수단 소멸은 의도된 동작(⑪ 정합) 명기. 헤더 마퀴 레이아웃 회귀 0.
- **⑨** 무변경 확인: LyricsInputScreen 듀엣 스텝(:63-66,:161)·MusicGenerationScreen 듀엣 체인(:359,:752,:963-989,:1558-1596 step 100/101) **diff 0** — 산출물은 "메인/서브보컬 질문은 작곡 디렉터 step 3→100→101에서 정상 노출" 판정 보고뿐(코드 변경 발견 시 스펙 위반 반려).

**U-9. diff 격리 + 직전 사이클 회귀 0 [unit] — FAIL 게이트**
- Given: 접촉 허용 = U-1 목록. 직전 합격 형상(v3.203/204/205/⑤개정/206)과 이번 매트릭스가 **겹치는 파일 3종**(DmChatScreen·SettingsScreen·ArtistCodyScreen)은 이번 항목 hunk만 허용.
- When: ① `git status --short`+`git diff --stat`(2_housing 스코프): 목록 외 접촉 0 — 특히 **서버 파일·0_platform 무접촉**(로컬 서버 소스 diff 1건 = 즉시 FAIL, 서버 수정은 오케스트레이터 별도 트랙), `services/playback.ts`·`services/audioMode.ts`·`components/feed/FeedCard.tsx`·`screens/UserChannelScreen.tsx` diff 0. ② **겹침 파일 hunk 단위 귀속 판독**: DmChatScreen(⑤ 전환+⑥ 첨부 외 hunk 0 — 프리다운로드·dmSocket 불변)·SettingsScreen(⑦ 헤더 타이틀 매핑 외 0 — '공지사항' 행·startCsInquiry 문의 동선 불변)·ArtistCodyScreen(⑩ 외 0 — v3.206 악세서리 서브탭·착용 방식·잠금 카드 불변). ③ **직전 사이클 합격 기능 diff 0 전수**: v3.203 연주곡 5문항 체인·durationSec / v3.204 AnswerEditModal 3화면·MusicResult 시크·refine 가드 / v3.205 다음곡 프리다운로드·성별 자동 필터 코어·공지 채널 3파일 / v3.206 꾸미기 개편 — **단 ⑤ 리프트 전환이 정당하게 건드리는 hunk(AnswerEditModal 등 Modal 5종의 키보드 코드)는 예외 허용, 그 외 로직 hunk 0**. ④ ③④ 삭제 스크립트·증적 git 미추적(scratchpad 한정) + 크리덴셜·토큰·실계정 이메일·재설정 코드 값 출력 0(`TEST_USER_EMAIL` 표기만). ⑤ `npx tsc --noEmit` 최종 형상 재실행 exit 0(U-1 ② 재확인).
- Then: ①~⑤ 전부 충족 — **①(서버/목록 외 diff)·③(직전 사이클 회귀)이 FAIL 게이트**.

### [api] 서버 검증 (⑥⑦ 배포 후·③④ 실행 후 — 전이면 "대기" 보고)

**A-0. 실행 게이트 [api] — 최상위 FAIL 게이트(무승인 실행)**
- Given: 서버 코드 배포(⑥⑦)·프로덕션 데이터 삭제(③④)는 전부 **오케스트레이터가 사용자 최종 확인 후 실행**(PLAN 소스오브트루스 규정 — 특히 ③ #4 공지테스트 글, ④ 1,111건은 사용자 결정 사안 1·2). test-designer/tester의 사전 접근은 무인증 GET만.
- When: 배포·삭제 실행 전 사용자 승인 기록 확인 + 배포 전 사전 스냅샷(무인증 GET — `/health` 200, 기존 API 스키마, 서버 파일 mtime은 오케스트레이터 ssh 읽기 위임).
- Then: **승인 전 배포·삭제·프로덕션 쓰기 1건 = 최상위 FAIL(비가역 사고)**. 승인 대기 중이면 A-1~A-6 "대기"로 보고하고 [unit] 트랙만 진행.

**A-1. [항목⑦] 재설정 정상 체인 — 요청→dev 로그 코드→검증→새 비밀번호 로그인 [api]**
- Given: 배포 완료 + dev 모드(SMTP 자격 미제공 — 실메일 0, 코드는 서버 로그만·응답 미포함). `TEST_USER_EMAIL` 계정(password_hash 보유 일반 계정).
- When: ① `POST /auth/password-reset/request {email: TEST_USER_EMAIL}` → 200. ② dev 모드 서버 로그(docker logs — 오케스트레이터 경유 읽기)에서 6자리 코드 확인 — **증적에는 `******` 마스킹, 값 기재 금지**. ③ `POST /auth/password-reset/confirm {email, code, new_password: NEW_PASSWORD}` → 200(validate_password 통과·bcrypt 갱신). ④ 구 비밀번호 로그인 → 401 + `NEW_PASSWORD` 로그인 → 200 토큰 발급(**체인 완결**). ⑤ 사용 완료 코드 재사용 → 거부(1회성). ⑥ 15분 만료는 실대기 대신 코드 판독으로 갈음(TTL 저장·비교식 문자 확인 — 만료 코드 confirm 거부 경로 존재). ⑦ request/confirm 응답 body에 코드 미포함(dev 모드 포함 — 포함 1건 = FAIL, U-7 ④ 교차). ⑧ 검증 후 비밀번호 원복(테스트 계정 관리).
- Then: ①~⑧ 전부 충족 — ④ 체인 완결이 판정 중심.

**A-2. [항목⑦] 계정 존재 비노출·rate limit·소셜 안내 [api] — FAIL 게이트(존재 노출)**
- When: ① **존재하지 않는 이메일** request → 실존 계정과 **HTTP 상태·body 스키마·문구 프로그램적 비교 완전 동일**(응답 시간차 현저성도 기록 — 타이밍 채널) — **차이 1건 = 계정 열거 취약점 FAIL**. ② 잘못된 코드 confirm 반복 → **5회 초과 시 제한 발동**(6회째는 정답 코드도 거부 — 코드 무효화/차단 실측). ③ request 연타 rate limit 실측(횟수·윈도 기록 — 무제한이면 판정 회부: 메일 폭탄·코드 스팸 벡터). ④ **소셜 전용 계정**(password_hash NULL) request → 응답은 ①과 동일(응답으로 소셜 여부도 비노출) + dev 로그/메일 본문에 "소셜 가입 계정" 안내 분기 확인. ⑤ confirm의 new_password 규칙 위반 → 400 + 규칙 안내(이 시점은 코드 검증 후이므로 존재 노출 아님 명기). ⑥ 서버 로그 grep: 평문 비밀번호 출력 0(코드 6자리는 dev 모드 의도 출력이라 예외, **비밀번호 1건 = FAIL**).
- Then: ①~⑥ 전부 충족 — **①이 FAIL 게이트**.

**A-3. [항목⑥] dm-image 업로드 검증·이미지 메시지 왕복·하위호환 [api] — FAIL 게이트(prefix 우회)**
- Given: 배포 완료. 신규 `/upload/dm-image`(feed-image 계약 복제, prefix `dm/{user_id}/`) + SendMessageBody `image_object_name?` + send_message 확장(text 또는 image 필수).
- When: ① 정상 업로드: jpg/png/webp 각 1건 ≤15MB → 200 + object_name prefix `dm/{본인 user_id}/` 확인 + 재인코딩 산출물 MinIO 실존. ② **한도 검증**: 15MB 초과 → 거부(4xx), 비이미지(pdf·확장자 위장 바이너리) → 거부 — 오류 응답이 5xx 크래시가 아닌 정돈된 4xx. ③ **이미지 메시지 왕복**: `POST /dm/{official 대화}/messages {image_object_name}` → 저장 + 조회 직렬화에 `image_url`(browser_image_url) + 대화 last_message_text "(사진)" + WS payload에 이미지 필드 포함(수신측 실시간 반영 전제). ④ **본인 prefix·실존 검증**: 타 유저 prefix object_name 지정 → 거부, MinIO 미실존 object → 거부 — **우회 1건 = 타인 이미지 도용 경로 FAIL**. ⑤ text·image 규칙: text만(구형 계약) 정상 / image만 정상 / 둘 다 정상 / **둘 다 없음 → 400**. ⑥ **구형 텍스트 메시지 하위호환**: image 필드 없는 기존 body 정상 + 배포 전 저장된 텍스트 메시지 조회 직렬화 불변(신규 필드 optional — null/부재로 응답, 구형 앱 파싱 파괴 없음 논증). ⑦ admin CS 툴 직렬화 공유 여부 실측 — 동일 image_url 필드 노출(admin_cs.py). ⑧ 기존 텍스트 전용 전송·2000자 검증 회귀 0.
- Then: ①~⑧ 전부 충족 — **④가 FAIL 게이트**.

**A-4. [항목③] 피드 4건 삭제 후 잔존 0 + 보존 검증 [api] — FAIL 게이트(보존 대상 오삭제)**
- Given: A-0 승인 + 오케스트레이터가 `purge_feed_document` 경유 실행 완료. 삭제 대상 feed_id 4건(6a69b3c7c03621e095f0295c·6a8588fc227bebd79cd1b7fe·6a8c118399933f837326bc6d·6a955c0113b9e03ee75306c9).
- When(컨테이너 python **읽기 전용** + API GET): ① **잔존 0 검증 쿼리**: feeds에서 4건 id 조회 0건 + comments/likes에 해당 feed_id 잔존 문서 0 + notifications target_id 잔존 0 + MinIO 이미지 정리 증적(purge 로그). ② **보존 검증**: feeds 잔존 = **정확히 4건**(official 공지 3건 + lovvepearl "펄킴 신곡" 1건) — **공지 3건 본문이 v3.205 등록분과 프로그램적 diff 0**(오염·부분 삭제 0), 펄킴 글 id 존속. ③ `GET /api/feeds/timeline`·`GET /api/feeds/user/{official_id}?kind=community` 200 + 공지 3건 노출 유지·순서 불변. ④ 실행 증적이 purge_feed_document 경유임을 확인(mongo 직접 delete 발견 시 절차 위반 기록 — 연쇄 정리 누락 위험).
- Then: ①~④ 전부 충족 — **②(official 공지 3건·펄킴 글 중 1건이라도 소실·변형) = FAIL 게이트(비가역)**.

**A-5. [항목④] official DM 1,111건 삭제 후 검증 [api] — FAIL 게이트(peer 21건 오삭제)**
- Given: A-0 승인 + 실행 완료. 삭제 전 스냅샷 필수: peer 발신 21건 message id 목록 + 대화 143개별 official/peer 건수 집계(오케스트레이터 실행 스크립트 산출물 — 검증 대조 기준).
- When(읽기 전용): ① dm_messages `sender_id=official_id` 잔존 **0건**(1,111건 전량 삭제 확인). ② **peer 발신 21건 전수 보존** — 삭제 전 스냅샷 id 목록과 1:1 대조(1건 소실 = FAIL). ③ 대화방 정리 정합: 잔존 메시지 0건 대화 → dm_conversations 삭제 / 잔존 있는 대화(peer 메시지 보유) → last_message_text/last_at가 **잔존 최신 메시지와 일치하게 재계산** + unread 리셋 — 전 대화 전수 스캔으로 불일치 0. ④ `TEST_USER_EMAIL` 계정 인박스 API: official 테스트 대화 부재 + **문의하기 재진입 → pair_key upsert로 새 대화 정상 생성**(dm_service.py:347-382 경로 — 삭제가 신규 문의를 막지 않음). ⑤ admin_notices 원본 레코드 불변(삭제 범위 밖 — 사용자 원문 = DM만). ⑥ 집계 보고: 삭제 1,111 / 대화 삭제 N / 보정 대화 M / 보존 peer 21 수치표.
- Then: ①~⑥ 전부 충족 — **②가 FAIL 게이트**.

**A-6. 서버 회귀 스모크 [api]**
- When: 배포 후 ① `/health` 200 + 차트(`/tracks/?sort=created_at`)·트랙 목록·`GET /business/ads/active`(gender 필드 존속 — ⑩ 계약 전제)·`GET /dm/official` 기존 스키마 불변. ② auth 기존 로그인·register·me 회귀 0(⑦ 추가가 기존 라우트 미파괴). ③ DM 기존 텍스트 전송·인박스 조회 회귀 0(⑥ 확장이 구계약 미파괴 — A-3 ⑥ 교차). ④ 서버 로그 traceback 0 + 컨테이너 재시작 이력이 배포 1회분만.
- Then: 전부 충족.

### [e2e] 실기기 (keyboard-controller 포함 신규 APK 필수 — 구빌드 검증 무효)

**E-0. 빌드 게이트 [e2e]**: eas preview(**APK**)·production(**AAB**) 산출 성공 + preview APK에 react-native-keyboard-controller 네이티브 포함 확인(빌드 로그 autolinking 목록). 이하 E-1~E-8은 이 APK 설치 기기 기준 — 구 APK로 수행한 ⑤ 검증 결과는 무효 처리.

**E-1. [항목⑤] 키보드 가림 — 신고 입력창·담기 시트 키보드 위 노출 [e2e] — 이번 사이클 최상위 완료 조건·최상위 FAIL 게이트**
- Given: v3.201 훅·v3.205 훅 **2회 연속 실기기 실패 후 3번째 시도**(근본 전환). 검증면: 문제 실기기(재현 기기) 필수 + API 34 에뮬 + iOS.
- When/Then:
  - ⓐ **신고 입력창**: 설정 → 문의하기(오류 신고) → 사유 선택 → DmChat(프리필 `[오류신고: 사유] `) → 입력 포커스 → **입력바 전체가 키보드 위 완전 노출**(가림 0) → 키보드 닫힘 후 잔존 간격 0 → 장문 입력·연속 전송 중 튐 없음.
  - ⓑ **담기 시트(PlaylistPickerSheet)**: 트랙 ⋮ → 담기 → 새 재생목록 이름 입력 포커스 → **시트·입력창이 키보드 위 노출**.
  - ⓒ Modal 나머지 4종(ReportModal·AppealModal·AnswerEditModal·AlbumCreateModal) 각 1회 동일 3점(노출·잔존 0·이중 보정 없음).
  - ⓓ 제스처/3버튼 내비 각각 + 진입 직후 입력바가 내비바에 안 깔림(edge-to-edge 회귀).
  - ⓔ iOS: 기존 KAV 대비 회귀 0(과잉 여백·이중 리프트 없음 — U-2 ⑥ 실기기 확증).
- **FAIL 게이트: 문제 기기에서 가림 재현 1건 = 이번 사이클 최상위 FAIL. 3회째 실패이므로 훅 미세수정 재시도 금지 — 즉시 replan 대상**(PLAN F5 판정 계승: RN Keyboard 이벤트 기반 JS 보정 복귀 금지, 네이티브 레벨 재설계 회부)임을 보고서에 명기.

**E-2. [항목①] 코치마크 화살표 실요소 지시 [e2e]**
- 실기기 절차(신규 설치 상태): 차트 첫 진입 → 코치마크 스포트라이트 구멍·화살표가 **첫 행 ⋮(TrackRow more-vertical) 버튼 실좌표를 정확히 가리킴**(오프셋 눈대중 기록 — 허공/다른 요소 지시 = FAIL) → 검색 화면 ⋮ 동일 → 플레이어·피드 글쓰기 anchor 스텝 각 1회 → **기내 모드 등으로 리스트 로딩 지연 상태 진입 → 카드형 fallback 정상 강하**(크래시 0 — 화살표 없는 카드형은 PASS) → Android 백버튼 skip 동작.

**E-3. [항목⑪] first-run 게이트 [e2e] — FAIL 게이트(기존 유저 노출)**
- ⓐ **기존 계정 단말**(구버전 위 업데이트 설치 — AsyncStorage 잔존): 로그인 상태로 player/chart/feed/playlist/search/map 전 화면 순회 → 튜토리얼 **0회**(1회라도 노출 = FAIL). ⓑ **신규 설치**(스토리지 클리어 또는 신규 단말): 화면별 최초 1회 노출 + 2회째 방문 미노출. ⓒ 재설치(삭제→재설치): 신규 취급 노출(스펙 기록 — U-3 ①ⓒ 확증). ⓓ 비회원 재생 1회 후 앱 삭제 없이 재시작: 'existing' 전환 없음(fresh 마커 유지 — 마커 우선 확인).

**E-4. [항목②] 차트 첫 진입 신곡 [e2e]**: 앱 재시작 → 차트 탭 첫 진입 = **신곡 탭 활성**(top100 아님) + NEW 뱃지 + 최신 앨범 가로 섹션 + 발매일 footer → Top 100 탭 전환·복귀 정상 → 당겨서 리프레시 신곡 기준 → 빈 상태 문구(해당 시).

**E-5. [항목⑥] 신고 대화방 이미지 첨부 [e2e]**: 신고 DM 대화방 → 입력바 첨부 버튼 → 이미지 선택(DocumentPicker image/*) → 업로드→전송 → **본인 말풍선 이미지 표시**(최대폭 제한 렌더) → 앱 재진입 후 히스토리 이미지 잔존 → 인박스 미리보기 "(사진)" → admin CS 툴 수신 확인 → 15MB 초과·비이미지 선택 시 정돈된 거부 안내(크래시 0) → 텍스트 없이 이미지 단독 전송 정상 → 텍스트 전용 전송 회귀 0.

**E-6. [항목⑦] 비밀번호 재설정 전 과정 [e2e]**: 로그아웃 → 로그인 화면 "비밀번호를 잊으셨나요?" 링크 → `TEST_USER_EMAIL` 입력·요청 → forgotSent 화면 → (dev 모드) 서버 로그에서 코드 확인(증적 마스킹) → 코드+새 비밀번호 입력 → 완료 후 login 모드 복귀 → **새 비밀번호로 로그인 성공** → 틀린 코드 1회 오류 안내(크래시 0) → "아이디는 가입하신 이메일입니다" 문구 노출 → 검증 후 비밀번호 원복.

**E-7. [항목⑩] 성별 칩 실기기 [e2e]**: **서버 gender=여성 아티스트 보유 계정**으로 앱 재시작(taskStore 휘발 상태 재현 — 미발견 조건) → 꾸미기 → 상의 피커 → **칩 "여성용만" 노출 + 필터 동작**(남성용 미노출·공용 노출) → '전체 보기' 토글·재진입 기본 복귀 → gender null 캐릭터 → **"성별 미설정 · 전체 표시" 칩 노출**(상시 노출 확증) + 전량 표시 + 탭 시 설정 유도 안내 → 악세서리 피커 칩 미노출(v3.206 불변) → 드릴다운 5단계·위시탭·SAMPLE 폴백 회귀 0.

**E-8. [항목⑫⑧⑨] 스모크 [e2e]**: ⑫ 작업실 헤더 **ⓘ 부재** + 기획사명 마퀴 레이아웃 회귀 0. ⑧ 작곡 step 3 선택지 **남·여 2개만** + 답변 편집 모달 재선택에도 연주곡 부재 + "가사 없이 만들기 (연주곡)" 카드 → 5문항 체인 진입 정상(생성 미실행 — 과금 0). ⑨ 작사 듀엣 선택 → 작곡 디렉터 step 3 "듀엣 곡이네요! 메인 보컬 성별…" → step 100(서브 성별)→101(서브 스타일) 노출 확인 — 무변경 검증 보고.

### 게이트 요약

- **머지 게이트(앱)**: U-1~U-9 전부 PASS 시 머지 허용(frontend 자동 push 관례). 서버 트랙: A-0 승인 → 배포 → A-1~A-3·A-6 / 데이터 트랙: A-0 승인 → 실행 → A-4·A-5 — 앱 머지와 독립(승인 대기 시 "대기" 보고).
- **완료 조건: E-0(신규 APK·AAB 산출) + E-1(⑤ 키보드) 실기기 PASS가 이번 사이클 최상위 완료 조건** — ⑤만은 정적 대체 불가(v3.201·v3.205 두 번의 정적 PASS가 실기기에서 뒤집힌 전력). 나머지 E-2~E-8은 정적 대체 병기·실기기 이관 항목이나 E-3 ⓐ(기존 유저 0회)·E-2 화살표 정확성은 PASS 기록 필수.
- **핵심 FAIL 게이트 5+3건**: ① **E-1**(키보드 가림 재현 — 3회째 실패 = **replan 회부**, 미세수정 금지) ② **U-3 ①②/E-3 ⓐ**(기존 유저에게 튜토리얼 노출) ③ **A-4 ②·A-5 ②**(보존 대상 오삭제 — official 공지 3건·펄킴 글·peer DM 21건) ④ **A-2 ①**(응답 차이로 계정 존재 노출) ⑤ **U-9 ①③**(직전 사이클 회귀·diff 격리 위반) — 추가 게이트: **U-2 ①③**(구훅 잔존·Modal 전환 누락), **A-3 ④**(dm-image prefix 우회), **U-7 ③/A-2 ⑥**(비밀번호 평문 로그), **A-0**(무승인 배포·삭제 = 최상위). 1건이라도 FAIL이면 커밋·배포·출고 금지(A군 FAIL은 해당 트랙 한정 판정 — 앱 머지 게이트와 분리).
- 이월·결정 대기: SMTP 실자격(⑦ dev 모드 출고 여부)·③ #4·④ go/no-go·⑧ 가사 유지 무보컬 소멸·⑪ 해석 — 사용자 결정 사안 1~5 회신 전 해당 [api]·실행 항목은 "대기". 차기 이월(판정 대상 아님): ① 잔여 스텝 앵커 확대·피드 ⋯ 튜토리얼·⑦ SES 전환.

## v3.208 (2026-09-22) — 디렉터 휴식(쿨다운) 보상형 광고 배선: useRewardedSkipAd 훅·fatigueGate 단일 지점·서버 SSV 키 URL 1줄

> 대상: PLAN.md v3.208(:3954~) — 앱 신규 2파일(hooks/useRewardedSkipAd.ts·constants/ads.ts) + 수정 3파일(utils/fatigueGate.ts·App.tsx·eas.json) + 서버 1줄(server_staging_v3208/rewards.py `GOOGLE_KEYS_URL` → `https://www.gstatic.com/admob/reward/verifier-keys.json` — F2 치명 버그). 흐름: 쿨다운 다이얼로그 「광고 보고 30분 단축」 → EARNED_REWARD → 구글 SSV 콜백 skip_wait_count +1 → status 폴링(2s×15) 적립 확인 → 자동 doSkip('ad') = 30분 단축. 서버 계약 무변경(엔드포인트 신설 0).
> 실행 전제: 앱 `/Users/pearl/TripleJ/2_housing`(frontend, v3.207 합격 형상 기준선). 서버 1줄은 **스테이징(`server_staging_v3208/`)만 접촉 — 프로덕션 배포는 오케스트레이터가 사용자 최종 확인 후 v3.207 절차(`.bak_pre_v3208` 백업 → scp → docker build+재생성) 재사용**. [api]는 배포 완료 후 착수(전이면 "대기" 보고), test-designer/tester의 프로덕션 접근은 **무인증 GET만**(쓰기·ssh 0). [e2e]는 사용자 결정 사안 1(자체 보상형 광고 단위 생성 + SSV 콜백 URL `https://api.maidol.ai.kr/api/rewards/admob-callback` 등록 + **테스트 기기 등록**) 완료 후 착수 — 미제공 시 TestIds 폴백 UI 검증까지만(적립 E2E "대기").
> 시크릿 기재 금지: AdMob 앱 ID·광고 단위 ID 실값은 어떤 증적·보고서에도 기재 금지 — **`ca-app-pub-xxxx~xxxx`(앱)/`ca-app-pub-xxxx/xxxx`(단위) 형식 플레이스홀더만 표기**. 테스트 기기 ID·user_id 실값도 마스킹.
> **⚠ 무효 트래픽 경고(전 항목 공통)**: 내부 테스트에서 **실광고 노출·클릭 = AdMob 무효 트래픽 → 계정 정지 위험**. 모든 [e2e]는 **테스트 광고(자체 단위+등록된 테스트 기기 조합, 또는 TestIds)에서만** 수행 — 광고 소재 클릭·유도는 테스트 광고라도 금지(시청 완료만). 테스트 기기 미등록 상태에서 자체 단위 광고가 "Test Ad" 라벨 없이 게재되면 **즉시 중단·보고**(1건 = 절차 FAIL).

### [unit] 앱 정적 검증 (머지 게이트 — 서버 배포·콘솔 작업과 독립 트랙)

**U-1. 선행 게이트 — 클린 기준선 + 접촉 허용 목록 + tsc exit 0 [unit]**
- Given: v3.207 합격 형상 클린 기준선 위에서만 diff 귀속 판정(U-7)이 성립. 접촉 허용 목록 = PLAN 변경 매트릭스 앱 5파일: `hooks/useRewardedSkipAd.ts`(신규)·`constants/ads.ts`(신규)·`utils/fatigueGate.ts`·`App.tsx`·`eas.json`(+ 부수 env 예시 파일 있으면 기록). 서버는 `server_staging_v3208/rewards.py` 1파일만(로컬 미러 `0_platform_music/backend_9004` 원본 무접촉).
- When: ① `git log --oneline -1`+`git status --short`(2_housing 스코프) 클린 기준선 확인(미커밋 잔존 시 착수 금지·반려). ② 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`. ③ package.json diff **0**(react-native-google-mobile-ads ^16.3.2 기존 설치·app.json 앱 ID 기존 실값 — 이번 사이클 의존성·네이티브 변경 0 = JS-only 논증, prebuild 산출 변경 없음).
- Then: ② **exit 0** — 신규 훅 시그니처·fatigueGate 옵션 확장이 전 소비처와 정합함을 컴파일로 확정. ③ 위반(의존성 추가/버전 변동) 1건 = 네이티브 변경 유입 반려.

**U-2. 훅 상태 전이 전수 — 로드→표시→완료/실패/닫힘 + F4 결함 3종 교정 [unit]**
- Given: WaitTimerScreen 보존 코드의 16.3.2 기준 결함 3종(PLAN F4 — ① serverSideVerificationOptions 미설정 ② 'closed' 문자열 리터럴 구독 ③ setTimeout 스테일 클로저)을 교정한 신규 `hooks/useRewardedSkipAd.ts`가 대상. WaitTimerScreen 자체는 @deprecated 무수정 존치.
- When: ① **상태 전이 표 문자 추적**: idle→loading(pre-load)→loaded→showing→earned(EARNED_REWARD) / showing→closed(미완료 닫힘 — earned 미발화) / loading→error(로드 실패) / show 요청 시 미로드 → "광고 준비 중…" 경로 — 각 전이에서 후속 액션(폴링 시작은 **earned에서만**) 문자 확인. ② 이벤트 구독이 **SDK 상수**(`RewardedAdEventType.LOADED`/`EARNED_REWARD`·`AdEventType.CLOSED`/`ERROR`) 기반 — 문자열 리터럴('closed' 등) 구독 0(F4 결함② 재발 차단). ③ 타이머·구독 정리: unmount/재시도 시 리스너 unsubscribe 전수 + 타임아웃 콜백이 스테일 상태를 참조하지 않음(ref 또는 최신 상태 기반 — F4 결함③ 재발 차단) 문자 추적. ④ CLOSED(earned 미발화) 시 **보상 로직 미트리거**(폴링·doSkip 미호출) + 재로드 준비. ⑤ 로드 실패 시 재시도 정책(무한 루프 0) 확인. ⑥ 로그 추적자 `[AdReward]` 배선 — 단위 ID·user_id 실값 로그 출력 0.
- Then: ①~⑥ 전부 충족 — ①(earned에서만 보상 후속)·②(상수 구독)이 판정 중심.

**U-3. SSV customData=user_id 전달 코드 확증 [unit] — FAIL 게이트(보상자 식별 불가)**
- Given: 서버 rewards.py는 `custom_data`를 user_id로 사용(:190) — 앱이 `serverSideVerificationOptions.customData`에 user_id를 실어야만 적립됨(미전달 시 콜백이 와도 보상자 식별 불가 = 적립 0, F2·F4 결함① 인과).
- When: ① `RewardedAd.createForAdRequest(adUnitId, {serverSideVerificationOptions: {customData: <user_id>}})` 형태로 **광고 인스턴스 생성 시점에 customData 설정** 문자 확인(16.3.2 RequestOptions.d.ts:6-17 계약 — show 시점 주입 불가 API임을 근거로 생성 시점 판정). ② user_id 출처가 로그인 세션(authStore/토큰 클레임 등 실사용자 식별자)과 일치 — 하드코딩·빈 문자열·undefined 폴백 경로 0. ③ 비로그인/user_id 미확보 상태에서 광고 버튼 노출·show 진입 차단(customData 없는 시청 = 적립 불능 시청 방지) 경로 확인. ④ customData 값 로그 출력 0(마스킹).
- Then: ①~④ 전부 충족 — **①·②(customData 미설정 또는 user_id 아닌 값) 1건 = FAIL 게이트(시청해도 적립 0 — 배선 전체 무의미화)**.

**U-4. constants/ads.ts — EXPO_PUBLIC 키 폴백·하드코딩 0 [unit] — FAIL 게이트(단위 ID 하드코딩)**
- Given: 스펙 = `process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID`(빌드 시 인라인) 우선, 미설정 시 `TestIds.REWARDED` 폴백 — 단일 규칙(`__DEV__`/프로필 분기 불요). 코드에 실값 하드코딩 금지.
- When: ① 폴백 식 문자 확인: 키 미설정(undefined·빈 문자열) → `TestIds.REWARDED` — 그 외 분기 없음(과설계 시 기록). ② **하드코딩 스캔**: 2_housing 신규 diff 전역 `grep -rn "ca-app-pub-"` → **0건**(app.json 기존 앱 ID 제외 — 이번 diff 밖. TestIds는 SDK 상수라 무관). eas.json은 **키 이름만** 추가·값은 빈 문자열/미기재(사용자 제공 후 주입) 확인 — 값 실값 발견 시 FAIL. ③ 테스트 기기 ID 목록: `MobileAds().setRequestConfiguration({testDeviceIdentifiers})` App.tsx 앱 시작 1회 배선 + ID 값은 플레이스홀더/env 경유(실값 커밋 0). ④ Android 한정 키만 사용(iOS 단위 ID 참조 0 — 이번 사이클 Android 한정, PLAN F6 iOS 이월 정합).
- Then: ①~④ 전부 충족 — **②(광고 단위 실값 하드코딩·eas.json 실값 커밋) 1건 = FAIL 게이트**.

**U-5. fatigueGate 단일 지점 — 12개 호출부 무수정 전파 + 기존 ⭐/광고권 경로 diff 0 [unit] — FAIL 게이트(호출부 수정·기존 경로 파괴)**
- Given: 설계 원칙 = 다이얼로그 내부(showFatigueCooldownDialog, utils/fatigueGate.ts:15-103)에만 광고 버튼을 추가하여 **호출부 12곳 전부 무수정 수혜**(PLAN F3).
- When: ① **호출부 12곳 diff 0 전수표**: MapScreen:424 · MusicGeneration:1188,1913 · MusicLoading:307 · ArtistLoading:493 · ArtistResult:647 · ArtistCody:422 · LyricsResult:131 · LyricsLoading:133 · CoverGeneration:486,1146 · LyricsPromptReview:85 — `git diff` 기준 12곳 소속 화면 파일 **전부 무접촉**(1곳이라도 fatigueGate 호출 시그니처 변경·광고 관련 수정 유입 = 단일 지점 원칙 위반 FAIL). ② 신규 버튼 「광고 보고 30분 단축」: 광고권 0장이어도 노출 + 광고 미로드 시 "광고 준비 중…" 비활성 — 노출 조건식 문자 확인(미지원 플랫폼 미노출은 U-6). ③ **기존 버튼 2종 경로 diff 0**: ⭐단축 버튼(상시)·광고권 버튼(`skip_wait_count>0` 조건 :86-91) — 라벨·순서·핸들러·doSkip 호출·409/402 처리 로직 hunk 0(버튼 배열에 항목 추가만 허용). ④ **시청완료→적립 폴링→자동 소비 체인**: earned → getFatigueStatus 폴링(2s 간격 최대 15회=30s, 기존 fatigueService 재사용 — 신규 rewards API 클라이언트 불요) → skip_wait_count 증가 감지 → doSkip('ad') 자동 1회 → 잔여 쿨다운 시 갱신 다이얼로그 재표시(기존 반복 스킵 UX) — 타임아웃 시 "적립 확인 지연" 안내 후 기존 다이얼로그 복귀·**doSkip 미호출**. ⑤ **클라 단독 보상 경로 0**: 앱 diff 전역에서 skip_wait_count를 서버 적립 없이 증가시키거나, earned만으로(폴링 확인 없이) doSkip('ad')를 호출하거나, 신규 적립 API를 호출하는 코드 **0건** — 적립은 구글→서버 SSV 콜백 유일(PLAN F6). ⑥ 폴링 재진입 가드: 다이얼로그 중복 표시·doSkip 이중 호출(이중 차감) 방지 문자 확인. ⑦ 로그 `[AdReward]`+기존 `[fatigue:*]` 병기.
- Then: ①~⑦ 전부 충족 — **①(호출부 수정)·③(기존 스킵 경로 파괴)·⑤(시청 완료 확인 없는 보상 지급 경로) = FAIL 게이트**.

**U-6. Expo Go/web 안전 강등 [unit]**
- Given: 관행 계승(PLAN F4) — `Platform.OS!=='web'` + try-require 게이트, metro.config.js:23 web 빈 모듈 치환과 한 쌍. 원칙: 미지원 환경은 광고 버튼 **자체 미노출**(mock 보상 금지 — 서버 적립 없는 가짜 성공 UX 금지).
- When: ① try-require 실패(Expo Go — 네이티브 모듈 부재) 시: 훅이 unavailable 상태 반환 + 다이얼로그 광고 버튼 미노출 + **크래시 0**(require를 조건부·try 내로 한정, top-level import 0) 문자 추적. ② web: metro 빈 모듈 치환 유지(metro.config.js diff 0) + Platform 게이트로 버튼 미노출. ③ **mock 보상 경로 0**: unavailable 상태에서 시청 성공 흉내·폴링·doSkip 트리거 코드 0건. ④ App.tsx MobileAds 초기화도 동일 게이트 내(웹/Expo Go에서 초기화 호출 크래시 0). ⑤ 기존 다이얼로그(⭐/광고권)는 전 플랫폼 현행 유지.
- Then: ①~⑤ 전부 충족 — ①(Expo Go 크래시)·③(mock 보상)이 판정 중심.

**U-7. diff 격리 + v3.207 형상 회귀 0 [unit] — FAIL 게이트**
- Given: 접촉 허용 = U-1 목록. 직전 v3.207 합격 형상(keyboard-controller 전환·코치마크·first-run 게이트·차트 신곡·DM 이미지·비밀번호 재설정·성별 칩·연주곡 제거)과 이번 매트릭스는 **겹치는 파일이 App.tsx 1종뿐**(v3.207 KeyboardProvider 래핑 vs 이번 MobileAds 초기화).
- When: ① `git status --short`+`git diff --stat`(2_housing 스코프): U-1 목록 외 접촉 0 — 특히 WaitTimerScreen.tsx·fatigueService.ts·screens 12곳·metro.config.js·package.json·app.json **전부 diff 0**, 로컬 서버 소스(`0_platform_music/backend_9004`) diff 0(스테이징 `server_staging_v3208/`만 허용). ② App.tsx hunk 귀속: MobileAds 초기화+setRequestConfiguration 외 hunk 0 — KeyboardProvider 래핑·기존 초기화 순서 불변. ③ **v3.207 합격 기능 diff 0 전수**: 구훅 2종 삭제 상태 유지(재유입 0)·Modal 5종 keyboard-controller·tutorialGate/코치마크·ChartScreen 신곡 탭·DmChatScreen 이미지 첨부·AuthPanel forgot 모드·ArtistCody 성별 칩·MusicGeneration step 3 — 로직 hunk 0. ④ 증적·스크립트 git 미추적(scratchpad 한정) + 광고 단위 ID·테스트 기기 ID·user_id 실값 출력 0(플레이스홀더만). ⑤ `npx tsc --noEmit` 최종 형상 재실행 exit 0(U-1 ② 재확인).
- Then: ①~⑤ 전부 충족 — **①(목록 외/서버 원본 diff)·③(v3.207 회귀) = FAIL 게이트**.

### [api] 서버 검증 (rewards.py 1줄 배포 후 — 전이면 "대기" 보고)

**A-0. 실행 게이트 [api] — 최상위 FAIL 게이트(무승인 배포)**
- Given: 서버 수정은 `server_staging_v3208/rewards.py` 1줄(GOOGLE_KEYS_URL www 교정)이 전부 — **프로덕션 배포는 오케스트레이터가 사용자 최종 확인 후 실행**(백업 `.bak_pre_v3208` → scp → docker build+재생성). test-designer/tester 사전 접근은 무인증 GET만.
- When: ① 배포 전: 스테이징 파일이 프로덕션 원본(md5 `95cd671b…` 기준) 대비 **정확히 GOOGLE_KEYS_URL 1줄 diff**인지 확인(그 외 hunk 발견 = 스코프 초과 반려) + 사전 스냅샷 `/health` 200. ② 배포 실행 전 사용자 승인 기록 확인.
- Then: **승인 전 배포·프로덕션 쓰기 1건 = 최상위 FAIL**. 대기 중이면 A-1~A-4 "대기" 보고, [unit] 트랙만 진행.

**A-1. www.gstatic.com 키 조회 200 + 캐시 [api]**
- Given: 배포 완료. 교정 전 실측 — `https://gstatic.com/...` 301 리다이렉트 + httpx follow_redirects=False(:55) → 키 fetch JSON 파싱 실패 → 전 SSV 콜백 403(F2 치명 버그).
- When: ① (서버 무관 사전 확증) `curl -sI https://www.gstatic.com/admob/reward/verifier-keys.json` → **200 직접 응답**(리다이렉트 0) + body JSON에 `keys[].keyId/pem` 구조 확인. ② 배포 후 임의 SSV 형식 콜백 1회 호출(아래 A-2 ①)로 키 fetch 경로를 발화시켜 서버 로그(docker logs — 오케스트레이터 경유 읽기)에 키 fetch 성공/파싱 오류 부재 확인 — 교정 전 증상(JSON 파싱 실패 traceback) 소멸. ③ 연속 콜백 2회째에 키 재fetch 없이 캐시 사용(rewards.py 키 캐시 로직 기준 — 캐시 TTL·조건은 코드 실측값 기록). ④ 키 fetch 실패 시(네트워크 차단 가정) 콜백이 5xx 크래시가 아닌 정돈된 4xx/403 거절인지 코드 판독 병기.
- Then: ①~③ 충족 — ②(파싱 실패 traceback 잔존 = 1줄 수정 무효)가 판정 중심.

**A-2. SSV 콜백 서명검증 — 정상/위조 경로 [api]**
- Given: `GET /api/rewards/admob-callback`(:153, 무인증) — ECDSA-SHA256 검증(:98-128), `custom_data`=user_id(:190), 적립 `reward_balances.$inc skip_wait_count += reward_amount`(:231-239).
- When: ① **위조 서명**: 형식상 유효한 쿼리(user_id·reward_amount·transaction_id·signature·key_id)에 임의 서명 → **403 거절 + 적립 0**(balance GET으로 확증). ② key_id 미존재·서명 파라미터 누락 각각 → 정돈된 4xx(5xx 크래시 0). ③ **정상 서명 경로**: 구글 개인키 없이는 유효 서명 생성 불가 — **정상 적립 경로 검증은 [e2e] E-1(실기기 테스트 광고 → 구글 발신 실SSV 콜백) 실측으로 이관함을 명기**(스테이징에서 서명검증 우회·스킵 플래그 추가는 프로덕션 코드 오염이므로 금지). ④ custom_data 부재 콜백(서명 유효 가정 불가로 코드 판독 병기): user_id 식별 불가 시 적립 스킵/거절 경로 확인 — U-3 앱측 게이트와 교차.
- Then: ①~③ 충족 — ①(위조 서명 통과 = 무검증 적립) 1건 = FAIL.

**A-3. dedup — 동일 transaction_id 재호출 무적립 [api]**
- Given: transaction_id dedup — reward_transactions unique index(:143).
- When: ① 동일 transaction_id 콜백 2회(E-1 실측 시 구글 재시도 관찰 또는 동일 쿼리 재전송) → 2회째 `already_processed` 응답 + skip_wait_count **증가 1회 유지**(balance 전후 대조) + reward_transactions 1건만 적재. ② 서명검증이 dedup **앞단**인지 순서 판독(위조+기존 transaction_id 재전송이 dedup 응답으로 정보 노출되지 않는지 기록 사안). ※ 유효 서명 필요 부분은 E-1 실측과 병합 수행.
- Then: ① 충족 — 재호출 이중 적립 1건 = FAIL.

**A-4. 기존 fatigue skip('ad') 원자 차감 회귀 + 스모크 [api]**
- Given: 소비 경로 무수정 — POST /api/fatigue/skip method='ad'(:187-205) `{skip_wait_count:{$gte:1}}` 조건부 `$inc:-1` 원자 차감·레이스 시 +1 원복·SKIP_MINUTES=30(:47).
- When(자기 테스트 계정 한정): ① 잔량 0 상태에서 method='ad' skip → 402(잔량 부족) 기존 응답 불변. ② (E-1 적립 후) 잔량 1 → skip 성공 + 30분 단축 + 잔량 0 — 차감 정확 1. ③ 쿨다운 없는 상태 skip → 기존 409/무의미 응답 불변. ④ 배포 후 회귀 스모크: `/health` 200 + `GET /api/rewards/balance`·`/history` 기존 스키마 불변 + 서버 로그 traceback 0 + 컨테이너 재시작 이력 배포 1회분만.
- Then: ①~④ 전부 충족.

### [e2e] 실기기 (Android · 사용자 콘솔 작업 완료 후 — 자체 광고 단위+SSV URL 등록+**테스트 기기 등록** 전제)

**E-0. 전제 게이트 + 무효 트래픽 방지 [e2e] — 절차 FAIL 게이트**
- Given: 구글 샘플 TestIds로는 SSV 콜백이 우리 서버로 오지 않음(콘솔 단위별 설정 — PLAN F1) → 적립 E2E는 **자체 보상형 단위 + SSV URL 등록 + 테스트 기기 등록** 조합이 유일 경로. 기기: 1.1.0 계열 신규 APK(네이티브 변경 0이므로 기존 APK에 JS 업데이트 반영 형상도 가 — 반영 방식 기록).
- When/Then: ① 사용자 제공값(단위 ID `ca-app-pub-xxxx/xxxx`·테스트 기기 ID) 주입 빌드 확인 — 미제공 시 E-1~E-2의 적립 체인은 "대기", TestIds 폴백으로 E-2 ①·E-3·E-4만 수행. ② 광고 게재 시 **"Test Ad" 라벨 확인 필수** — 라벨 없는 실광고 게재 발견 = 즉시 시청 중단·보고(테스트 기기 등록 누락 신호). ③ **⚠ 실광고 클릭 절대 금지 — 내부 테스트 중 광고 소재 클릭·전환 유도는 테스트 광고라도 수행하지 않음(시청 완료·닫기만). 무효 트래픽 = AdMob 계정 정지 위험. 위반 1건 = 절차 FAIL·즉시 보고.**

**E-1. 정상 체인 — 광고 옵션 노출 → 테스트 광고 시청 완료 → 적립 폴링 → 자동 30분 단축 [e2e] — 이번 사이클 최상위 완료 조건**
- Given: 쿨다운 진행 중 디렉터(임의 화면 — 대표: MusicGeneration) + 광고권 0장 + 테스트 기기.
- When/Then: ① 쿨다운 다이얼로그에 버튼 3종 노출: ⭐단축 · (광고권 0장이라 광고권 버튼 미노출 — 기존 조건 유지) · **「광고 보고 30분 단축」**(pre-load 완료 시 활성). ② 탭 → 테스트 광고 전체화면 재생 → **끝까지 시청**(EARNED_REWARD) → 닫기. ③ "적립 확인 중" 폴링 표시 → **30s 내** 자동 skip 발화 → 쿨다운 **30분 단축 확인**(타이머 갱신) — 잔여 쿨다운 시 갱신 다이얼로그 재표시(반복 시청 가능 확인 1회). ④ 서버 교차 증적: reward_transactions 1건 적재 + skip_wait_count 로그 증감(+1 적립→-1 소비, A-3·A-4 ② 병합) + 서버 로그 `[rewards]` SSV 검증 성공. ⑤ SSV 지연이 30s 초과한 경우: "적립 확인 지연" 안내 → 다이얼로그 복귀 → 잠시 후 재진입 시 광고권 버튼 노출(적립 반영)·소비 정상 — 지연 실측치 기록. ⑥ user_id 귀속: 적립이 **시청 계정 본인** balance에 반영(타 계정 오적립 0 — U-3 교차).
- Then: ①~⑥ 충족 — **③(자동 단축 체인) + ④(서버 적립 증적)가 최상위 완료 조건**. 시청 완료 없이 단축 발생 1건 = FAIL(클라 단독 보상 — U-5 ⑤ 실기기 확증).

**E-2. 폴백 — 광고 미충전·로드 실패 시 기존 경로 무손상 [e2e]**
- When/Then: ① 광고 미로드 상태(진입 직후·연속 시청 직후) 다이얼로그 → 광고 버튼 "광고 준비 중…" 비활성 + ⭐단축 정상 동작(크래시 0). ② **비행기 모드**(로드 실패 강제) → 다이얼로그에서 광고 버튼 비활성/실패 안내 → 기존 ⭐/광고권 버튼 경로 정상 + 네트워크 복구 후 재로드 정상. ③ 폴링 타임아웃 경로(콜백 지연 유도 곤란 시 E-1 ⑤ 실측으로 갈음 명기) → 안내 후 기존 다이얼로그 복귀 + **이중 차감 0**(잔량·쿨다운 대조).

**E-3. 중도 이탈 — 광고 닫기 시 무보상 + 기존 다이얼로그 복귀 [e2e]**
- When/Then: ① 광고 재생 중 조기 닫기(스킵/뒤로) → EARNED_REWARD 미발화 → **적립 0**(balance 불변·reward_transactions 미적재) + 폴링·doSkip 미발화 + 쿨다운 불변. ② 닫힘 후 기존 쿨다운 다이얼로그 정상 복귀(또는 재진입 시 정상 — 동작 기록) + 광고 재로드 후 재시청 가능. ③ 시청 중 앱 백그라운드 전환→복귀 크래시 0.

**E-4. ⭐스킵·광고권 회귀 + 플랫폼 스모크 [e2e]**
- When/Then: ① **⭐단축 회귀**: 쿨다운 다이얼로그 ⭐ 버튼 → 잔액 차감·30분 단축·402(잔액 부족 시) 안내 — v3.207 대비 무변화. ② 광고권 보유 상태(E-1 적립 직후 자동 소비 전 타이밍 또는 적립만 된 상태) → 광고권 버튼 노출·수동 소비 정상(기존 조건 `skip_wait_count>0` 유지). ③ 호출부 회귀 스모크: 12곳 중 대표 4화면(Map·MusicGeneration·ArtistCody·CoverGeneration) 다이얼로그 호출 → 동일 버튼 구성·정상 동작(나머지 8곳은 U-5 ① 정적 diff 0으로 갈음 명기). ④ **Expo Go**: 광고 버튼 미노출 + 다이얼로그·⭐ 정상 + 크래시 0. ⑤ web 빌드: 빈 모듈 치환 유지·크래시 0. ⑥ 키 미제공 빌드(TestIds): 광고 표시·시청은 되나 **적립 미발생이 정상**임을 확인 + 폴링 타임아웃 안내 경로 발화(적립 0 = 버그 아님 명기).

### 게이트 요약

- **머지 게이트(앱)**: U-1~U-7 전부 PASS 시 머지 허용(frontend 자동 push 관례). 서버 트랙: A-0 승인 → 배포 → A-1~A-4 / E2E 트랙: E-0 전제(사용자 콘솔 작업) 충족 → E-1~E-4 — 각 트랙 대기 시 "대기" 보고, 앱 머지와 독립.
- **완료 조건**: E-1 ③④(테스트 광고 시청→SSV 적립→자동 30분 단축 체인 + 서버 증적)가 이번 사이클 최상위 완료 조건 — 단, 사용자 결정 사안 1(콘솔 발급값) 미회신 시 U+A까지로 "부분 완료(적립 E2E 대기)" 판정 허용(PLAN 명기 — TestIds 폴백 UI 배선까지 출고 가능).
- **핵심 FAIL 게이트 5건**: ① **U-4 ②**(광고 단위 ID 하드코딩·실값 커밋) ② **U-3**(SSV customData=user_id 누락 — 보상자 식별 불가·적립 0) ③ **U-5 ⑤/E-1**(시청 완료·서버 적립 확인 없이 보상 지급 — 클라 단독 보상 경로) ④ **U-5 ①③/E-4 ①**(12곳 호출부 수정·기존 ⭐/광고권 스킵 경로 파괴) ⑤ **U-7 ①③**(v3.207 형상 회귀·diff 격리 위반) — 추가: **A-0**(무승인 배포 = 최상위)·**A-2 ①**(위조 서명 통과)·**A-3**(dedup 이중 적립)·**E-0 ③**(실광고 클릭 — 절차 FAIL). 1건이라도 FAIL이면 커밋·배포·출고 금지(서버/E2E 트랙 FAIL은 해당 트랙 한정 판정 — 앱 머지 게이트와 분리).
- 이월(판정 대상 아님): iOS ATT/SKAdNetwork·실광고 전환(스토어 공개+app-ads.txt)·서버측 일일 적립 캡(콘솔 게재빈도 캡으로 갈음 — 사용자 결정 사안 3)·WaitTimerScreen 완전 삭제.

---

## v3.209 (2026-09-22) — 공유영상(영상 디렉터): 단색(이미지 없는) 배경 + 자막 테두리 on/off·테두리 색 선택

> 대상: PLAN.md v3.209(:4030~) — 앱 1파일(`2_housing/screens/VideoDirectorScreen.tsx`: bg 단계 4번째 카드「단색 배경」·solid→`bg=color&bgalpha=100` 매핑·진하기 skip·신규 2단계 fontOutline/outlineColor) + 서버 스테이징 2파일(`server_staging_v3209/share_video.py`: STYLE_BGALPHAS +"100"·_build_ass 테두리 파라미터화·_style_tuple 14원소+말미 기본값 절단 / `server_staging_v3209/tracks.py`: POST·GET file Query 2종 `fontoutline`·`outlinecolor` + 검증 + _defaults 2키 + share_object_name **위치 인자** 호출 동기 :2605-2608). 신규 엔드포인트 0 — 계약은 선택 Query 2종 추가뿐, **기본값 조합 = 현행과 비트 동일**이 설계 핵심.
> 실행 전제: 앱 `/Users/pearl/TripleJ/2_housing`(frontend, v3.208 합격 형상 기준선). 서버는 **스테이징(`server_staging_v3209/`, 프로덕션 EC2 원본 scp + `.orig` 보존)만 접촉** — 로컬 미러 `0_platform_music/backend_9004`는 원본과 상이(PLAN F3)하므로 **비교 기준으로도 수정 대상으로도 사용 금지**. 프로덕션 배포는 오케스트레이터가 사용자 최종 확인 후 v3.207/8 절차(`.bak_pre_v3209` 백업 → scp → docker build+재생성) 재사용. [api]는 배포 완료 후 착수(전이면 "대기" 보고), test-designer/tester의 프로덕션 접근은 **무인증 GET만**(쓰기·ssh 0 — POST 생성·과금 항목은 오케스트레이터/자체 테스트 계정 경유 실행 결과를 판독). [e2e]는 실기기(Android)에서 수행.
> 시크릿 기재 금지: 계정 토큰·user_id·track_id 실값·EC2 호스트 상세는 증적에 플레이스홀더(`user_xxxx`·`track_xxxx`·`maidol-ec2`)만 표기. 테스트 곡은 자기 계정 소유 트랙만 사용.

### [unit] 앱 정적 검증 (머지 게이트 — 서버 배포와 독립 트랙)

**U-1. 선행 게이트 — 클린 기준선 + 접촉 허용 목록 + tsc exit 0 [unit]**
- Given: v3.208 합격 형상 클린 기준선. 접촉 허용 목록 = 앱 `screens/VideoDirectorScreen.tsx` **1파일**(+서버 스테이징 `server_staging_v3209/` 2파일 — S 트랙에서 판정). 그 외 앱 파일 전부 diff 0이어야 U-7 diff 귀속이 성립.
- When: ① `git log --oneline -1`+`git status --short`(2_housing 스코프) 클린 기준선 확인(미커밋 잔존 시 착수 금지·반려). ② 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`. ③ `components/TrackShareDownloadSheet.tsx`(:53 format-only 구 페이로드 — 제2 호출부) diff **0** 선확인.
- Then: ② **exit 0** — Step 유니언 확장(fontOutline·outlineColor)·신규 상태 3종(pickedBg 'solid'·pickedOutline·pickedOutlineColor)·styleParams 확장이 컴파일 정합. ③ 위반 = 구 호출부 접촉 반려.

**U-2. 배경 단계 4카드 — 단색은 center 전용 노출 [unit]**
- Given: 배경 질문(bg 단계 :523-537)은 **center 레이아웃에서만** 노출 — layout full이면 :173-174에서 font로 skip, styleParams :266이 bg='blur' 강제(현행). 사용자 결정 사안 1 기본안 = full 제외.
- When: ① bg 단계 카드 **4개** 문자 확인: 원본/흐린/색으로 덮기/**「단색 배경」(desc "이미지 없이 색만")** — center 분기 내부에만 추가. ② full 레이아웃 경로: bg 단계 skip 로직·bg='blur' 강제 diff 0(단색 카드가 full에서 노출되는 경로 0). ③ 단색 카드 미리보기 = 이미지 없는 순수 색 스와치(커버 이미지 미합성 — 정직한 근사) 렌더 코드 확인. ④ 기존 3카드(clean/blur/color)의 라벨·핸들러·후속 단계 hunk 0(카드 배열 항목 추가만 허용).
- Then: ①~④ 전부 충족 — ②(full 오염)·④(기존 3모드 파괴)가 판정 중심.

**U-3. 단색 선택 흐름 — 진하기 skip + bg=color&bgalpha=100 매핑 [unit]**
- Given: 확정 스펙 ① — 앱 내부 `pickedBg='solid'`, API 계약 신설 0(기존 `bg=color&bgcolor={hex}&bgalpha=100`으로 매핑).
- When: ① 단색 선택 → 색 팔레트 단계(기존 bgColor 단계 재사용, PALETTE 12색+hex :50-54) → **진하기(투명도 25/45/70) 단계 미출현** → 폰트 단계 직행 — 단계 전이 분기 문자 추적. ② styleParams(:263-270) 매핑: `pickedBg==='solid'` → `bg=color & bgcolor={선택 hex} & bgalpha=100` 정확(다른 신규 쿼리 키 신설 0). ③ 기존 '색으로 덮기'(color) 경로: 색→진하기(25/45/70) 3단계 흐름 hunk 0 — bgalpha 25/45/70 매핑 불변. ④ 사용자 버블 step='bg' 기록 — 롤백 호환(U-5와 교차).
- Then: ①~④ 전부 충족 — ②(매핑 오류 = 서버 400 또는 원본 비침)·③(기존 color 회귀)가 판정 중심.

**U-4. 테두리 2단계 전이 — 없게 선택 시 색 질문 skip + 기본값 정규화 [unit]**
- Given: 확정 스펙 ② — fontColor 단계 뒤 신규 2단계: `fontOutline`(카드 2:「테두리 있음(기본)」/「없음」, textShadow 근사 미리보기) → 있음이면 `outlineColor`(PALETTE 재사용, 기본=검정 강조 표시) → 이후 lyricsMode→subPos 기존 흐름.
- When: ① 전이 표 문자 추적: fontColor→fontOutline→(있음)→outlineColor→lyricsMode / fontOutline→(없음)→**outlineColor skip**→lyricsMode. ② 전송 규칙: `fontoutline = pickedOutline ? '1' : '0'`, `outlinecolor =` 테두리 on **이고 검정(000000)이 아닐 때만** hex — **검정 선택 = ""(기본값 정규화)** 문자 확인(레거시 캐시 적중 조건). ③ **기본값 조합 파라미터 생략**: 테두리 있음+검정(=기본) 선택 시 styleParams가 fontoutline·outlinecolor **키 자체를 생략**(또는 서버 _defaults와 동치인 값만 전송 — 구현 방식 실측 기록, 단 S-4/A-1의 object name 동일성으로 최종 판정). 단색 아닌 기본 배경 조합도 bgalpha=100 미전송. ④ 디렉터 질문 문구 2건(배경·테두리) 추가 확인 — 기존 질문 문구 hunk 0.
- Then: ①~④ 전부 충족 — ②·③(기본값 정규화 실패 = 전 사용자 캐시 미스·재렌더 폭증) = **FAIL 게이트(캐시 키 보존)와 직결**.

**U-5. 답변 버블 편집(롤백) 신규 스텝 호환 [unit]**
- Given: 이 화면의 답변 편집 관행 = **사용자 버블 탭 → 해당 단계 롤백**(handleEditChoice :138-145, v3.182 방식 — **AnswerEditModal 미사용 화면**임을 PLAN F1 실측 명기; 구현이 AnswerEditModal을 도입했다면 그 경로로 동일 판정).
- When: ① 신규 스텝 3종(bg 단색 카드 포함·fontOutline·outlineColor)의 사용자 버블이 step 기록을 가져 탭 시 해당 단계로 롤백 — 롤백 후 후속 상태(pickedOutline·pickedOutlineColor·pickedBg) 초기화/재수집 정확. ② 교차 편집: 단색→'색으로 덮기'로 변경 시 진하기 단계 **재출현**, '있음'→'없음' 변경 시 outlineColor 답변 폐기(스테일 outlinecolor 전송 0). ③ 기존 스텝(format/layout/shape/font/fontColor/lyricsMode/subPos) 롤백 로직 hunk 0.
- Then: ①~③ 전부 충족 — ②(스테일 상태 잔존 → 모순 파라미터 전송)가 판정 중심.

**U-6. diff 격리 + v3.205~208 회귀 0 [unit] — FAIL 게이트**
- Given: 접촉 허용 = U-1 목록(앱 1파일). 직전 사이클 합격 형상: v3.205(꾸미기)·v3.206(카테고리 개편)·v3.207(실기기 12건·keyboard-controller)·v3.208(보상형 광고 배선) — 이번 매트릭스와 **겹치는 파일 0**(VideoDirectorScreen은 4개 사이클 모두 무접촉이었음).
- When: ① `git status --short`+`git diff --stat`(2_housing 스코프): VideoDirectorScreen.tsx 외 접촉 0 — 특히 TrackShareDownloadSheet.tsx·fatigueGate.ts·useRewardedSkipAd.ts·App.tsx·package.json·app.json·eas.json **전부 diff 0**, 로컬 서버 소스(`0_platform_music/backend_9004`) diff 0(스테이징 `server_staging_v3209/`만 허용). ② VideoDirectorScreen.tsx hunk 귀속: 변경 매트릭스 항목(Step 확장·4번째 카드·solid 매핑·진하기 skip·신규 상태 3종·styleParams·질문 문구 2건) 외 hunk 0 — kakao/wide 포맷·circle/square shape·가사 모드·자막 위치 로직 불변. ③ v3.208 합격 기능 스모크 diff 0: 광고 훅·fatigueGate 12곳 호출부·SSV 배선 재유입/변형 0. ④ 증적·스크립트 git 미추적(scratchpad 한정). ⑤ `npx tsc --noEmit` 최종 형상 재실행 exit 0.
- Then: ①~⑤ 전부 충족 — **①(목록 외/서버 원본 diff)·③(직전 사이클 회귀) = FAIL 게이트**.

### [unit] 서버 스테이징 정적 검증 (배포 전 — `server_staging_v3209/`만, 프로덕션 무접촉)

**S-1. 스테이징 출처·diff 스코프 게이트 [unit]**
- Given: PLAN F3 — 로컬 미러 부실(share_video.py md5 상이 af7057…↔프로덕션 9c5d13…, tracks.py 미러 부재). 스테이징은 **프로덕션 EC2 원본 scp**에서 출발.
- When: ① `server_staging_v3209/*.orig` 존재 + `.orig` md5가 프로덕션 원본과 일치(share_video.py 9c5d13… 기준) 확인. ② `diff .orig 수정본` hunk가 변경 매트릭스 항목(STYLE_BGALPHAS·STYLE_FONTOUTLINES·_build_ass/_build_ass_scroll 파라미터화·_style_tuple/_DEFAULT_STYLE_TUPLE 14원소·_style_suffix 절단·share_object_name/generate 시그니처 / tracks.py Query 2종·검증·_defaults 2키·호출 확장)에 전부 귀속 — 그 외 hunk 0. ③ EC2 직접 쓰기 흔적 0(배포는 오케스트레이터 승인 후).
- Then: ①~③ 충족 — ①(로컬 미러 출발 = 프로덕션과 다른 코드 배포) 1건 = 반려.

**S-2. STYLE_BGALPHAS +"100" — 단색 배경 1줄 [unit]**
- Given: F4 B안 — `STYLE_BGALPHAS = {"25","45","70","100"}`(:117) 1줄로 :670 `drawbox=c=0x{bgcolor}@{alpha}:t=fill`이 alpha=1.0 완전 불투명 = 커버 완전 차폐.
- When: ① 상수에 "100" 추가 문자 확인 + :669 alpha 계산식(`int(bgalpha)/100` 상당)이 "100"→1.0을 그대로 처리(별도 분기 신설 0 — 최소 diff). ② POST 검증(:2463-2471)·GET file 검증(:2586)이 동일 상수 import로 자동 통과함을 import 경로 판독으로 확증(중복 하드코딩 상수 발견 시 동기 누락 반려). ③ drawbox 체인(:664-672)의 clean/blur 분기 hunk 0.
- Then: ①~③ 전부 충족.

**S-3. fontoutline/outlinecolor 검증식 + ASS Outline=0·BGR 변환 정확성 [unit]**
- Given: 계약 — `fontoutline` "1"(기본)|"0", `outlinecolor` ""(기본=검정)|hex6. 현행 하드코딩: `_build_ass` :305-307·`_build_ass_scroll` :386-387 `OutlineColour=&H00000000`·`Outline=3`.
- When: ① 검증식 문자 확인: `fontoutline in {"0","1"}`, `outlinecolor=="" or _HEX6_RE.match(...)` — **hex6 아닌 값(GGGGGG·7자리·#접두 등) 거부** 경로가 POST·GET file 양쪽에 존재. ② Style 줄 파라미터화: Outline 폭 `3 if fontoutline=="1" else 0`, OutlineColour `font_colour_ass(outlinecolor) if outlinecolor else "&H00000000"` — **Style 줄 첫 &H00000000만 치환, BackColour 불변** + scroll 인라인 오버라이드(\1c·\alpha) 무수정. ③ **BGR 변환 정확성**: `font_colour_ass`(:149-156) 재사용 확인 + 파이썬 단독 실행 실측 — `FF6FA5 → &H00A56FFF`·`FFFFFF → &H00FFFFFF`·`FF0000 → &H000000FF`(RRGGBB→&H00BBGGRR 반전) 3케이스 표 기록. ④ 스테이징 파일 파이썬 단독 로드로 임시 ASS 생성(일반·scroll 각 1) — fontoutline=0 산출물에 `Outline=0`, outlinecolor=FF6FA5 산출물에 `OutlineColour=&H00A56FFF` 문자열 실증.
- Then: ①~④ 전부 충족 — ③·④(BGR 반전 오류 = 사용자가 고른 색과 다른 테두리)가 판정 중심.

**S-4. 캐시 키 보존 실측 — 기본값 조합 suffix 비트 동일 [unit] — FAIL 게이트(최중요)**
- Given: `_style_tuple`(:163-164) 12→14원소 + `_style_suffix`(:167-172) **말미 신규 축이 기본값("1","")이면 절단 후 md5** → 기존 전 조합의 object name(`share/v6/{id}{fmt}{suffix}.mp4` :185)·과금 ref(:2527-2530)·video_url 쿼리(:2501-2507)가 배포 전후 비트 동일해야 함(기존 영상 URL·캐시·환불멱등 보존).
- When: ① **파이썬 단위 비교 스크립트**(scratchpad): `.orig`와 수정본을 각각 로드해 `share_object_name` 문자열을 조합 표로 대조 — (a) 전 기본값, (b) 구 비기본 대표 5종+(예: center/circle/line/dohyeon/hex 글자색/bg=color·bgalpha=45 — 기존 12축 조합), (c) kakao·wide 포맷 각 1 — **전 케이스 문자열 완전 동일**. ② 신규 축 비기본(fontoutline=0 / outlinecolor=FF6FA5 / bgalpha=100)은 **기존과 다른 suffix** 생성(충돌 0 — 구 캐시 오염 방지). ③ _DEFAULT_STYLE_TUPLE 14원소와 route `_defaults` 2키(fontoutline "1"·outlinecolor "")의 값 일치(불일치 = 기본값 요청이 비기본으로 과금·캐시 분열). ④ heavy_job_slot(:575-577) 스타일 키에 신규 축 포함 확인. ⑤ GET file의 share_object_name **위치 인자** 호출(:2605-2608) 인자 순서·개수가 확장 시그니처와 정합(어긋나면 GET 프록시 전면 404/오객체 — tsc 같은 컴파일 게이트가 없으므로 문자 대조 필수).
- Then: ①~⑤ 전부 충족 — **①(기본·구 비기본 조합 object name 1건이라도 상이 = 기존 영상 URL 파손) = FAIL 게이트. ⑤(위치 인자 불일치)도 동급.**

### [api] 프로덕션 검증 (배포 완료 후 — 전이면 "대기" 보고, 무승인 배포 = 최상위 FAIL)

**A-0. 실행 게이트 [api]**
- Given: 배포는 오케스트레이터가 사용자 최종 확인 후 실행(`.bak_pre_v3209` → scp → docker build+재생성). When/Then: 배포 전 `/health` 200 스냅샷 + 사용자 승인 기록 확인 — **승인 전 프로덕션 쓰기 1건 = 최상위 FAIL**. 대기 중이면 A-1~A-4 "대기" 보고, [unit] 트랙(U·S)만 진행.

**A-1. 하위호환 — 파라미터 미전송 요청 = 기존 캐시 히트·신규 렌더 0 [api] — FAIL 게이트**
- Given: 배포 전 자기 계정 트랙으로 기본 스타일·비기본 스타일(S-4 ① (b) 대표 1종) 영상을 각 1건 **선생성**해 video_url·object name 스냅샷 확보(배포 전 준비 항목).
- When: ① 배포 후 동일 트랙·동일 파라미터(신규 키 미전송 — TrackShareDownloadSheet 경로와 동형인 format-only 포함) 재요청 → 응답 `cached:true` + **⭐무과금**(잔액 전후 대조) + video_url 문자열이 배포 전 스냅샷과 동일. ② 서버 로그(오케스트레이터 경유) ffmpeg 신규 렌더 발화 0. ③ 기존 발급 video_url 무인증 GET → 200·기존 mp4 그대로.
- Then: ①~③ 전부 충족 — **캐시 미스·재렌더·URL 변경 1건 = FAIL 게이트(전 사용자 기존 영상 파손+렌더 폭증)**.

**A-2. 신규 파라미터 정상 경로 [api]**
- When/Then(자기 테스트 계정·자기 트랙 한정): ① `bg=color&bgcolor={hex}&bgalpha=100`(center) → 정상 201/200 + video_url 발급 + GET file 200(다운로드 산출물은 E-1로 이관). ② `fontoutline=0` → 정상 처리(400 아님). ③ `fontoutline=1&outlinecolor=FF6FA5` → 정상 처리 + video_url 쿼리·과금 ref에 비기본 축 직렬화 확인. ④ GET `…/share-video/file`에 동일 신규 쿼리 → 200(POST·GET 검증 동치 — S-2 ②·S-3 ① 실배포 확증).

**A-3. 검증 400 경로 [api]**
- When/Then: ① `fontoutline=2` → 400 "지원하지 않는 스타일". ② `outlinecolor=GGGGGG`(비hex6) → 400. ③ `bg=color&bgcolor` 누락 → 400(기존 검증 불변). ④ `bgalpha=99`(비허용값) → 400 — 각 케이스 5xx 크래시 0·서버 로그 traceback 0.

**A-4. 과금·환불 멱등 + 스모크 [api]**
- When/Then(자기 테스트 계정): ① 신규 축 비기본 조합 **첫 생성** ⭐차감 1회(POINT_COSTS['share_video'] 기존 단가) + ref에 fontoutline/outlinecolor 포함. ② **동일 조합 재요청** `cached:true`·무과금(차감 0). ③ 실패 유도(또는 코드 판독 병기 :2545-2552) 시 환불 멱등 — 이중 환불·미환불 0. ④ 배포 후 스모크: `/health` 200 + 커버 없는 곡 400 게이트(:2495-2496) 불변 + 컨테이너 재시작 이력 배포 1회분만.

### [e2e] 실기기 (Android — 앱 머지 + 서버 배포 완료 후)

**E-1. 단색 배경 — 결과 영상에 원본 이미지 흔적 0 [e2e] — 핵심 FAIL 게이트**
- Given: 자기 계정·커버 있는 트랙, 영상 디렉터(center 레이아웃) 진입.
- When: ① 디렉터 대화에서 배경 「단색 배경」 선택 → 색(예: PALETTE 중 1) → **진하기 질문 미출현 실기기 확인** → 나머지 단계 진행 → 생성 완료. ② 결과 영상 재생 + 프레임 샘플링(초반·중반·종반 3점 캡처): **배경 영역 픽셀 = 지정색 단일 — 원본 커버 이미지 흔적(윤곽·블러 잔상 포함) 0**. ③ 중앙 커버 이미지·자막·워터마크는 정상 표시(배경만 단색).
- Then: ①~③ 충족 — **②(원본 비침 1건 = alpha 미적용/매핑 오류) = 핵심 FAIL 게이트**.

**E-2. 테두리 없게 — 자막 테두리 부재 [e2e]**
- When/Then: ① 테두리 「없음」 선택 → outlineColor 질문 **미출현** → 생성. ② 결과 자막 확대 캡처 — 글자 외곽 테두리 부재(글자색만, 흰 글자면 어두운 배경 조합으로 판독). ③ line(scroll)·일반 가사 양모드 각 1건.

**E-3. 테두리 있게 + 색 선택 — 해당 색 테두리 [e2e]**
- When/Then: ① 테두리 「있음」 → 색 팔레트(기본=검정 강조 표시 확인) → 비검정 색(예: FF6FA5) 선택 → 생성 → 자막 확대 캡처에서 **선택색 테두리** 확인(색상 오프셋 시 S-3 BGR 표와 대조). ② 검정 선택 → 생성 — 현행과 동일 검정 두께3 + (가능하면 video_url 대조로) 레거시 캐시 적중 확인. ③ 글자색과 테두리색 조합(예: 흰 글자+분홍 테두리) 시인성 정상.

**E-4. 기존 이미지 배경 3모드 회귀 [e2e]**
- When/Then: ① 원본/흐린/색으로 덮기(진하기 45) 각 1건 생성 — v3.208 이전과 동일 산출(원본 비침 정도·블러·어둠막 현행 유지). ② kakao·wide 포맷 각 1건 + full 레이아웃 1건(배경 질문 미출현·blur 강제 현행) 회귀. ③ TrackShareDownloadSheet 다운로드 경로(format-only) 1건 — 정상 다운로드·기존 캐시 활용(A-1 교차). ④ 테두리 질문에서 기본(있음·검정) 선택 시 결과가 기존 영상과 시각 동일.

**E-5. 답변 버블 편집으로 배경/테두리 변경 재생성 [e2e]**
- When/Then: ① E-1 완료 상태에서 배경 답변 버블 탭 → bg 단계 롤백 → '색으로 덮기'로 변경 시 **진하기 질문 재출현** → 재생성 정상. ② 테두리 답변 버블 탭 → 「없음」→「있음+색」 왕복 변경 → 재생성 결과에 최종 선택만 반영(스테일 파라미터 0 — U-5 ② 실기기 확증). ③ 편집-재생성 반복 중 크래시 0·기존 스텝(포맷·폰트 등) 답변 보존.

### 게이트 요약

- **머지 게이트(앱)**: U-1~U-6 전부 PASS 시 머지 허용(frontend 자동 push 관례). 서버 트랙: S-1~S-4 PASS → A-0 승인 → 배포 → A-1~A-4. E2E 트랙: 앱+서버 완료 후 E-1~E-5. 각 트랙 대기 시 "대기" 보고, 앱 머지와 독립.
- **완료 조건**: E-1 ②(단색 배경 완전 차폐)·E-2·E-3(테두리 on/off·색 반영)이 이번 사이클 사용자 요청 직결 완료 조건.
- **핵심 FAIL 게이트 4건**: ① **S-4 ①/A-1**(캐시 키 변경 — 기존 영상 URL 파손·기본값 조합 suffix 불일치) ② **E-1 ②**(단색인데 원본 비침) ③ **U-1 ③/S-4 ⑤/E-4 ③**(구 호출부 파손 — TrackShareDownloadSheet format-only·GET file 위치 인자) ④ **U-6 ①③**(직전 사이클 v3.205~208 회귀·diff 격리 위반) — 추가: **A-0**(무승인 배포 = 최상위)·**S-1 ①**(로컬 미러 출발 배포). 1건이라도 FAIL이면 커밋·배포·출고 금지(서버/E2E 트랙 FAIL은 해당 트랙 한정 판정 — 앱 머지 게이트와 분리).
- 이월(판정 대상 아님): full 레이아웃 단색·커버 없는 곡 가사-only 영상·테두리 두께 선택·share-video 창작기록 적재(PLAN 40% 룰 이월 목록).

## v3.210 (2026-09-22) — 피드 탭·공개/비공개 앱 배선 + 프로덕션 앨범 2건 삭제(데이터) + AI 곡 "(Inst.)" 생성·배포

> 대상: PLAN.md v3.210(:4105~) — ① 앱 3파일(`2_housing/screens/FeedScreen.tsx` 탭 3분할·내 글 조회·Fab kind 분기 / `screens/FeedComposeScreen.tsx` 공개 스위치+is_public 실값 / `components/feed/FeedCard.tsx` 공개 전환 메뉴·비공개 칩) — **서버 무변경**(feeds.py의 is_public 스키마·필터·PUT 계약은 이미 완비, PLAN F①). ② 코드 0 — 프로덕션 `aimu.albums` 2건 데이터 삭제(mongosh)+마미 베스트 AI 커버 1점 MinIO 제거. ③ 앱 1파일(`screens/MyMusicScreen.tsx` ⋮ Inst. 액션) + 서버 스테이징(`server_staging_v3210/`: `app/routes/tracks.py` + `app/services/inst_service.py` 신규) — sunoapi.org `POST /api/v1/vocal-removal/generate`(audioUrl=자체 MinIO presigned, type=separate_vocal, 10 credits)→`GET /api/v1/vocal-removal/record-info` 폴링→instrumentalUrl **즉시 MinIO 이관**(Suno측 14일 보관)→"(원제) (Inst.)" 신규 트랙 자동 발매. 비용 **⭐5**(기본안, 외부 원가 10 credits).
> 실행 전제: 앱 `/Users/pearl/TripleJ/2_housing`(frontend, v3.209 합격 형상 기준선 — 단 `2_housing/App.tsx`는 **사이클 착수 전부터 웹 세션 기존 미커밋 M 상태**로 예외, U-1 참조). 서버는 스테이징 `server_staging_v3210/`(프로덕션 EC2 원본 scp+`.orig` 보존)만 접촉 — 로컬 미러 `0_platform_music/backend_9004`는 수정·비교 기준 사용 금지(v3.209 S-1 관행 계승). 프로덕션 배포·앨범 삭제·실생성(⭐/Suno 크레딧 소모)은 **오케스트레이터가 사용자 최종 확인 후 실행** — test-designer/tester의 프로덕션 접근은 **무인증 GET만**(쓰기·ssh·mongosh 0, 쓰기성 항목은 오케스트레이터/자체 테스트 계정 경유 실행 결과를 판독). git 조작 금지(status/diff/log 판독만). [api]는 배포·데이터 작업 완료 후 착수(전이면 "대기" 보고), [e2e]는 실기기(Android) 새 빌드.
> 시크릿 기재 금지: 계정 토큰·이메일 실값·user_id·track_id·album_id 실값·EC2 호스트·sunoapi.org API 키는 증적에 플레이스홀더(`user_xxxx`·`track_xxxx`·`album_test_1`(앨범테스트)·`album_user_2`(마미 베스트)·`maidol-ec2`·`SUNO_KEY`)만 표기.

### [unit] 앱 정적 검증 — ① 피드 탭·공개/비공개 + ③ Inst. 진입 (머지 게이트)

**U-1. 선행 게이트 — 클린 기준선 + tsc exit 0 + diff 격리(App.tsx 웹 세션 M 제외 명시) [unit] — FAIL 게이트**
- Given: 접촉 허용 목록 = 앱 4파일(FeedScreen.tsx·FeedComposeScreen.tsx·components/feed/FeedCard.tsx·MyMusicScreen.tsx) + 서버 스테이징 `server_staging_v3210/`(S 트랙에서 판정). **예외 명시: `2_housing/App.tsx`는 착수 전 git status에서 이미 M(웹 세션 기존 미커밋 변경)** — 이번 사이클 diff 귀속 판정에서 **제외**하되, 착수 시점 diff 스냅샷을 확보해 이번 사이클이 App.tsx에 **추가 hunk를 1건이라도 만들면 FAIL**.
- When: ① 착수 시 `git status --short`+`git diff`(2_housing 스코프) 스냅샷 기록(App.tsx 기존 hunk 목록 포함). ② 구현 합류 후 `cd /Users/pearl/TripleJ/2_housing && npx tsc --noEmit`. ③ 최종 `git diff --stat` 대조: 허용 4파일 외 접촉 0 — 특히 VideoDirectorScreen.tsx(v3.209)·fatigueGate.ts·useRewardedSkipAd.ts(v3.208)·package.json·app.json·eas.json 전부 diff 0, App.tsx는 착수 스냅샷과 hunk 완전 동일. ④ 증적·스크립트 git 미추적(scratchpad 한정).
- Then: ② **exit 0** + ③ 격리 성립 — 위반 1건 = 반려.

**U-2. 피드 탭 3종 — 조회 조건 분리 [unit]**
- Given: 확정 스펙 ①-A — 상단 세그먼트 [전체]/[내 피드]/[내 공지](MyMusicScreen tabBar 스타일 재사용), 비로그인은 [전체]만 노출·탭바 숨김.
- When: ① 조회 조건 문자 추적: [전체]=`/feeds/timeline`(기존 호출 hunk 0 — 파라미터·페이징 불변), [내 피드]=`/feeds/user/{me}?kind=feed`, [내 공지]=`/feeds/user/{me}?kind=community` — 내 글 조회는 본인 조회라 서버가 비공개 포함 반환(feeds.py 계약, 앱측 별도 공개 필터 코드 0 확인). ② 비로그인 분기: 탭바 미렌더+타임라인만 — me 부재 시 `/feeds/user/undefined` 호출 경로 0. ③ Fab kind 분기: [내 공지] 탭에서 FeedCompose 진입 시 kind='community', 그 외 'feed' — 기존 마이페이지 커뮤니티 진입(kind='community', FeedCompose:41) 경로 hunk 0. ④ 탭 전환 시 목록 상태 분리(전환 왕복에 스테일 목록 잔존 0) + 렌더는 기존 FeedCard·블록 로직 재사용(신규 카드 컴포넌트 0).
- Then: ①~④ 전부 충족 — ①(kind 혼선·비공개 필터 중복)·③(공지 작성 동선 파손)이 판정 중심.

**U-3. 작성 공개 스위치 — 기본 ON=공개 [unit]**
- Given: 확정 스펙 ①-B — FeedComposeScreen `is_public: true` 하드코딩(:244) 제거, TrackUploadScreen 스위치(:383) 관행 재사용.
- When: ① 스위치 초기값 **true(공개)** 문자 확인 — 피드·공지(kind 불문) 공통 노출. ② POST 페이로드에 스위치 실값 `is_public` 전달(:244 하드코딩 잔존 grep 0건). ③ 스위치 라벨·설명이 공개/비공개 의미를 명확 표기(공지 배지·블라인드와 혼동 문구 0). ④ 작성 성공 후 목록 갱신 경로가 탭별 조회(U-2)와 정합(비공개 등록 직후 [내 피드]에 즉시 보임).
- Then: ①~④ 전부 충족 — ①(기본 비공개로 뒤집힘 = 기존 사용자 체감 회귀)이 판정 중심.

**U-4. 카드 ⋯메뉴 공개 전환 — 내 글 한정 + PUT full-body 원형 보존 [unit]**
- Given: 확정 스펙 ①-C — FeedCard ⋯메뉴(내 글: 현행 삭제만 :287-306)에 [비공개로 전환]/[공개로 전환] 추가. 서버 PUT /feeds/{id} 계약 = 전체 body 필요(title·blocks 원형·bgm 재전송 + is_public 반전), 앱 최초의 PUT 사용처.
- When: ① 메뉴 노출 조건 = **내 글(작성자==me) 한정** — 남의 글 메뉴(팔로우/신고) hunk 0. ② PUT 페이로드: serialize 응답의 blocks **원형**(track_id/object_name/[item] 마커 무손실)·title·bgm 재전송 + is_public만 반전 — blocks 재가공·재직렬화로 원형 훼손하는 코드 0(문자 추적). ③ kind는 payload에서 변경 불가 계약(feeds.py:601) 준수 — kind 전송 시 원값 그대로. ④ `report_blinded` 글: 서버 400 응답을 "신고 처리로 제한된 콘텐츠" 안내로 노출(무한 스피너·크래시 0). ⑤ 전환 성공 후 카드 상태·칩(U-5) 즉시 갱신.
- Then: ①~⑤ 전부 충족 — ①(남의 글 전환 노출)·②(blocks 원형 훼손 = 전환 왕복 시 첨부 소실) = FAIL 게이트급.

**U-5. 비공개 칩 — Feather 아이콘·이모지 0 [unit]**
- Given: 카드에 내 글 한정 "비공개" 칩(MyMusicScreen 트랙 비공개 표기 관행), 공지 배지(v3.205)와 별개 공존.
- When: ① 칩 아이콘 = **Feather(예: eye-off/lock) 벡터 아이콘** — 신규 코드 hunk 내 이모지 문자(🔒·👁 등 유니코드 이모지) **0건** grep 실측. ② 노출 조건 = 내 글 && is_public===false 한정(타인에겐 비공개 글 자체가 미수신이므로 칩 로직에 타인 분기 불요 — 방어 조건 확인). ③ 공지 배지와 동시 표시 시 레이아웃 겹침 0(스타일 판독). ④ [전체] 타임라인(공개글만)에서는 칩 미출현 경로 자연 성립 확인.
- Then: ①~④ 전부 충족 — ①(이모지 유입)이 판정 중심(프로젝트 아이콘 관행 위반).

**U-6. 회귀 0 — 공지 배지·타임라인·블라인드 [unit] — FAIL 게이트**
- Given: 직전 사이클 합격 형상 v3.205~209와 이번 매트릭스 겹침 = FeedCard(공지 배지 v3.205)뿐.
- When: ① 공지 배지 로직(official 작성 community 글만 :86) hunk 0 — 일반 유저 공지에 배지 미표시 조건 불변(U-3·E-1과 교차). ② [전체] 타임라인: 호출·랭킹·렌더·페이징 diff 0(:129 계열) — 탭 도입이 기존 타임라인 코드 경로를 조건 분기로 감쌀 뿐 로직 무수정. ③ 블라인드(report_blinded) 표시·차단 로직 hunk 0(공개 토글과 별개 플래그 — 충돌 없음 PLAN F① 재확인). ④ FeedCard 삭제·팔로우·신고 메뉴 항목의 라벨·핸들러 hunk 0(메뉴 배열 항목 추가만 허용). ⑤ v3.209 영상 디렉터·v3.208 광고 배선 파일 무접촉(U-1 ③과 교차).
- Then: ①~⑤ 전부 충족 — **①~③(공지 배지·타임라인·블라인드 회귀)·⑤(직전 사이클 회귀) = FAIL 게이트**.

**U-7. Inst. 진입(앱) — ⋮ 시트 액션·⭐5 확인 다이얼로그·폴링 관행 [unit]**
- Given: 확정 스펙 ③ 앱 — MyMusicScreen 곡 탭 ⋮ TrackActionSheet `extraItems`(:792-798) [Inst. 버전 만들기].
- When: ① 노출 조건 문자 확인: 내 곡 && ai_model suno(AI 곡 한정) && 제목 "(Inst.)" 아님 && 진행 중 아님 — 업로드곡·타인 곡 경로 미노출. ② 실행 전 **확인 다이얼로그에 ⭐5 비용 안내** 문구(실값 5 하드코딩 여부·서버 응답 연동 여부 실측 기록 — 표기 누락 = 무고지 과금 반려). ③ 402(잔액 부족) 응답 → 별 부족 안내(기존 별 충전 유도 관행), 생성 실패(폴링 FAILED/타임아웃) → 실패 안내+환불 문구 — 각각 무한 스피너·크래시 0. ④ 상태 폴링은 **기존 generate 폴링 관행 재사용**(suno_generator/앱측 기존 생성 폴링 패턴과 동형 — 신규 폴링 프레임워크·전역 타이머 신설 0), 중복 요청 시 버튼 비활성/락 재진입 가드. ⑤ 완료 시 알림 후 내 곡 목록 갱신 경로 확인. ⑥ 기존 시트 항목(공유/다운로드/차트 업로드/삭제)의 라벨·순서·핸들러 hunk 0.
- Then: ①~⑥ 전부 충족 — ②(비용 미고지)·⑥(기존 액션 파손)이 판정 중심.

### [unit] 서버 스테이징 정적 검증 — ③ (`server_staging_v3210/`만, 프로덕션 무접촉)

**S-1. 스테이징 출처·diff 스코프 + py_compile [unit]**
- Given: v3.209 S-1 관행 — 스테이징은 프로덕션 EC2 원본 scp에서 출발, `.orig` 보존.
- When: ① `server_staging_v3210/tracks.py.orig`(등) 존재 + `.orig` md5가 프로덕션 원본과 일치 확인(오케스트레이터 scp 기록 대조). ② `diff .orig 수정본` hunk가 변경 매트릭스(instrumental 라우트 2종·inst_service 신규 파일·설정 참조)에 전부 귀속 — 그 외 hunk 0, demucs/torch **재유입 0**(Dockerfile 가드 위반 grep: `torch|demucs` 0건). ③ `python3 -m py_compile` 수정 전 파일 대조 — 스테이징 전 .py **exit 0**. ④ EC2 직접 쓰기 흔적 0.
- Then: ①~④ 충족 — ②(torch 재유입 = 빌드 가드 파괴) 포함 위반 1건 = 반려.

**S-2. 소유자 검증·연주곡 거부·중복/기존재 처리 [unit]**
- Given: `POST /api/tracks/{track_id}/instrumental` 계약 — 소유자 본인·AI(suno) 곡 한정.
- When: ① 소유자 검증: track.user_id != 요청자 → 403 — **차감 이전** 위치(순서 문자 추적). ② 연주곡 거부: 이미 "(Inst.)" 트랙(source_track_id 보유 또는 제목 마커)·lyrics 없는 연주곡·ai_model 비suno → 400 — 역시 차감 이전. ③ 이미 존재 처리: 동일 원곡의 (Inst.) 트랙 기존재 시 명시 응답(409 또는 400+기존 트랙 안내 — 구현 실측 기록, 무언가 중복 생성·이중 과금 경로 0). ④ 진행 중 락: melody 중복 방지 락 관행으로 동시 요청 2번째 거부(폴링 중 재호출 포함). ⑤ 20MB 초과 원곡(sunoapi.org audioUrl 상한) → 사전 검증 4xx(외부 호출 전 차단).
- Then: ①~⑤ 전부 충족 — 모든 거부 경로가 **차감 전**임이 판정 중심(S-3과 교차).

**S-3. ⭐5 차감·환불 대칭 — 실패 전(全) 경로 [unit] — FAIL 게이트**
- Given: 비용 ⭐5(share_video·커버와 동일 축), 실패 시 환불 관행(refund 멱등).
- When: ① 차감 시점 = 검증 통과 후·외부 호출 전 1회(5 고정) — POINT_COSTS 계열 상수 등록 확인. ② **실패 전 경로 환불 대칭 표** 작성: (a) sunoapi.org generate 호출 실패/타임아웃 (b) 폴링 FAILED/타임아웃 (c) instrumentalUrl 다운로드 실패 (d) MinIO 이관 실패 (e) 트랙 발매(DB 적재) 실패 — 각 경로에 환불 호출 존재 + **성공 경로에 환불 0** + 환불 멱등(동일 ref 이중 환불 차단) 문자 추적. ③ 402: 잔액<5 시 외부 호출·차감 0. ④ 백그라운드 폴링 태스크 예외가 환불 없이 삼켜지는 경로(bare except) 0.
- Then: ①~④ 전부 충족 — **이중 차감·환불 누락 경로 1건 = FAIL 게이트**.

**S-4. presigned URL 단일 경로 + vocal-removal 계약·폴링 [unit]**
- Given: PLAN 판정 — 구곡의 Suno측 taskId/audioId는 14일 보관으로 신뢰 불가 → **`audioUrl`(자체 MinIO presigned URL) 단일 경로**.
- When: ① 요청 페이로드 = `audioUrl`+`type: separate_vocal` — taskId/audioId 경로 코드 0(단일 경로 확인). ② presigned URL 생성: 원곡 object_name 기준·만료 여유(폴링 시간 초과 상회) 확인, 외부 접근성 curl 실검증 기록(PLAN 40% 룰 유일 불확실성 — 실패 시 우회 설계 발동 여부). ③ 폴링: `GET /api/v1/vocal-removal/record-info?taskId=` successFlag 분기(PENDING 재시도/SUCCESS/실패군) — 기존 suno_generator 폴링(:315) 관행과 동형(간격·상한·타임아웃 명시). ④ API 키는 기존 config(suno_api_url·키) 재사용 — 신규 시크릿 하드코딩 0.
- Then: ①~④ 전부 충족 — ①(이중 경로 = 구곡 실패 분기 잔존)이 판정 중심.

**S-5. MinIO 이관·(Inst.) 트랙 필드 — Suno URL 잔존 = FAIL [unit] — FAIL 게이트(최중요)**
- Given: sunoapi.org 산출 URL은 **14일 후 만료** — 신규 트랙의 audio 참조가 외부 URL이면 14일 뒤 전곡 재생 불능 사고.
- When: ① 흐름 문자 추적: SUCCESS→`instrumentalUrl` 다운로드→**MinIO put→자체 object_name으로 트랙 적재** — 트랙 doc의 audio 참조 필드(object_name/audio_url 등 기존 트랙 스키마 동일 필드)에 **`sunoapi.org`·suno CDN 도메인이 저장되는 코드 경로 0**(대입문 전수 grep). ② vocalUrl은 미저장(요구 산출물은 instrumental만 — 저장 시 근거 기록). ③ 신규 트랙 필드: 제목 `"<원제> (Inst.)"`(중복 접미 방지 — 원제에 이미 (Inst.) 시 S-2 ②에서 차단), 원곡의 커버·장르·무드·artist_name·character/persona 스냅샷 복제, **lyrics 없음**, `source_track_id` 기록, `is_public`=원곡과 동일, duration은 산출 오디오 실측(원곡 값 맹복제 시 근거 기록). ④ 창작 기록(creation_log) 관행 연동 확인. ⑤ 발매 형태 = 기존 트랙 발매 관행(차트/내 곡 노출 계약)과 동일 컬렉션·필드 — 신규 조회 경로 신설 0.
- Then: ①~⑤ 전부 충족 — **①(Suno URL 잔존) = FAIL 게이트(최중요, 14일 만료 사고)**.

### [api] ② 프로덕션 앨범 2건 삭제 (데이터 작업 — 사용자 승인 게이트, 무승인 삭제 = 최상위 FAIL)

**D-0. 승인·백업 게이트 [api] — 최상위 FAIL 게이트**
- Given: 후보 2건 = `album_test_1`(앨범테스트, **타 계정** 오리쟁이 소유·borrowed 커버)·`album_user_2`(마미 베스트, 사용자 본인·AI 커버). PLAN 사용자 결정 사안 1: 타 계정 건 포함 여부 확인 필요.
- When: ① 삭제 실행 전 **사용자 승인 기록**(2건 모두인지/본인 1건만인지 명시 응답) 확인 — 특히 `album_test_1` 타 계정 소유 고지 포함. ② 삭제 전 백업: 2건 앨범 doc JSON export + 마미 베스트 커버 오브젝트 사본 확보 기록. ③ 삭제 직전 후보 재확인: albums count=2·id 2건 일치(제3의 앨범 오삭제 방지). ④ 실행 주체 = 오케스트레이터(mongosh) — test-designer/tester의 mongosh·쓰기 0.
- Then: ①~④ 전부 충족 — **승인 전 삭제 1건 = 최상위 FAIL. 승인 대기 중이면 D-1 "대기" 보고.**

**D-1. 삭제 후 잔존 0 + 수록곡 트랙 보존 [api]**
- Given: PLAN 스펙 ② — 앨범 doc 삭제 + 마미 베스트 `album_` prefix 커버만 MinIO 제거, **트랙은 건드리지 않음**(albums.py:410-427 관행), 앨범테스트 borrowed 커버는 트랙 소유물로 보존.
- When: ① 삭제 후 count 실측: albums 잔존 **0**(승인이 1건만이면 1 — 승인 범위와 일치). ② 무인증 GET: `/albums/latest`(상당) 빈 목록 정상 200(5xx 0), 삭제된 album_id 단건 조회 404. ③ **수록곡 트랙 4곡 무손상**: 각 트랙 단건 GET 200 + audio 참조 유효(무인증 재생 URL 200) — 트랙 doc의 album 참조 필드가 있다면 dangling 처리 확인(목록/재생 5xx 0). ④ 커버 오브젝트: 마미 베스트 `covers/generated/user_xxxx/album_*.png` 제거 확인, 앨범테스트 borrowed 커버(트랙 커버) **잔존** 확인. ⑤ 마이뮤직 앨범 탭 빈 목록 정상은 E-3에서 실기기 교차.
- Then: ①~④ 전부 충족 — ③(트랙 손상)·④(borrowed 커버 오삭제)가 판정 중심.

### [api] ③ Inst. + ① 서버 필터 실측 (배포 완료 후 — 전이면 "대기" 보고, 무승인 배포 = 최상위 FAIL)

**A-0. 실행 게이트 [api]**
- Given: 배포는 오케스트레이터가 사용자 최종 확인 후 실행(`.bak_pre_v3210` 백업 → scp → docker build+재생성, v3.207~209 절차 재사용).
- When/Then: 배포 전 `/health` 200 스냅샷 + 사용자 승인 기록 확인 — **승인 전 프로덕션 쓰기 1건 = 최상위 FAIL**. 대기 중이면 A-1~A-5 "대기" 보고, [unit] 트랙만 진행.

**A-1. 타인 곡 403 — 차감 0 [api]**
- When/Then(자기 테스트 계정): 타 계정 소유 track_xxxx로 POST instrumental → **403** + 잔액 전후 대조 **차감 0** + 서버 traceback 0.

**A-2. 연주곡·비대상 곡 400 — 차감 0 [api]**
- When/Then: ① 이미 (Inst.)인 트랙(또는 lyrics 없는 연주곡) → **400** + 차감 0. ② 업로드곡(ai_model 비suno) → 400 + 차감 0. ③ 오류 메시지가 사용자 안내 가능 문구(U-7 ③ 연동).

**A-3. 잔액 부족 402 — 차감 0·외부 호출 0 [api]**
- When/Then: 잔액<⭐5 상태 테스트 계정으로 POST → **402** + 차감 0(잔액 전후 동일) + 서버 로그에 sunoapi.org 발신 0(오케스트레이터 경유 판독) — 외부 크레딧 유출 없는 사전 차단 확증.

**A-4. 실생성 1건 — 사용자 승인 후 실측 [api] — 완료 조건 직결**
- Given: **실비용 발생 명시 — 테스트 계정 ⭐10 보유 상태에서 ⭐5 차감 + sunoapi.org 크레딧 10 소모.** 오케스트레이터가 사용자 승인 취득 후 1건만 실행(test-designer/tester 직접 실행 금지 — 결과 판독). **무승인 실생성 = 최상위 FAIL.**
- When: ① 자기 곡(AI·보컬 있는 곡) POST → 202/200 수리 → 폴링 상태 전이(PENDING→SUCCESS) 기록. ② 완료 후 **"(원제) (Inst.)" 신규 트랙 적재** 확인: 단건 GET 200, 커버·장르·무드·artist_name 승계, lyrics 없음, source_track_id=원곡, is_public=원곡과 동일. ③ **audio 참조 실측: 자체 MinIO 도메인 — 응답 JSON·재생 URL 어디에도 `sunoapi.org`/Suno CDN 문자열 0**(S-5의 실배포 확증, 잔존 1건 = FAIL). ④ 오디오 무인증 GET 200 + 실재생 가능(Content-Type·바이트 수 기록, 청감 판정은 E-2). ⑤ 잔액 실측 **10→5(정확히 -5)** — 이중 차감 0, 성공 후 환불 발화 0. ⑥ 창작 기록(creation_log) 1건 적재 확인. ⑦ 동일 원곡 재요청 → S-2 ③ 기존재 응답(이중 과금 0).
- Then: ①~⑦ 전부 충족 — **③(Suno URL 잔존)·⑤(차감 부정확) = FAIL 게이트**.

**A-5. 비공개 글 서버 필터 실측 — 타인 미노출 [api] — FAIL 게이트**
- Given: 서버 필터는 기존 완비(feeds.py :391·:439-464·:571) — 앱이 is_public 실값을 보내기 시작하는 첫 사이클이므로 실측 확증 필요.
- When(자기 테스트 계정 2개 A/B, 오케스트레이터 경유 작성): ① A 계정으로 비공개 피드 1건 작성(is_public=false 실전송 — 서버 저장값 확인). ② **B 계정 토큰 조회**: `/feeds/timeline` 미노출 + `/feeds/user/{A}` 미노출 + 단건 GET **404**. ③ 무인증 GET(공개 경로 존재 시) 동일 미노출. ④ A 본인 조회: `/feeds/user/{A}?kind=feed` **노출**(비공개 포함). ⑤ A가 공개 전환(PUT) 후 B 재조회 → 타임라인·채널·단건 노출 전환 + blocks 원형 보존(첨부 무손실 — U-4 ② 실배포 확증).
- Then: ①~⑤ 전부 충족 — **②·③(비공개 글 타인 노출 1건) = FAIL 게이트**.

### [e2e] 실기기 (Android 새 빌드 — 앱 머지 + 서버 배포·데이터 작업 완료 후)

**E-1. 피드 탭·비공개 작성→타계정 미노출→공개 전환→노출 [e2e] — 핵심 FAIL 게이트**
- Given: 실기기 계정 A + 보조 계정 B(또는 비로그인 뷰).
- When: ① 피드 페이지 탭 3종 전환 — [전체] 기존 타임라인 그대로, [내 피드]/[내 공지] 내 글만·kind 분리 표시. ② [내 피드]에서 Fab→작성, 스위치 **기본 공개 확인** 후 OFF(비공개)로 등록 → [내 피드]에 즉시 표시+**Feather 비공개 칩**(이모지 아님 육안 확인), [전체] 타임라인 미출현. ③ B 계정(별도 기기/재로그인): 타임라인·A 채널에서 해당 글 **미노출**. ④ A가 카드 ⋯메뉴 [공개로 전환] → B 재조회 시 **노출** + 첨부(트랙/이미지) 원형 재생 정상(전환 왕복 1회 추가 — 소실 0). ⑤ [내 공지] 탭 Fab→공지 작성(일반 유저) → 공지 배지 **미표시**(official 아님, v3.205 회귀) 확인. ⑥ 남의 글 ⋯메뉴에 전환 항목 부재 확인.
- Then: ①~⑥ 전부 충족 — **③(타계정 노출)·④(전환 후 첨부 소실) = FAIL 게이트**.

**E-2. Inst. 생성 E2E — 메뉴→⭐5 다이얼로그→생성→내 곡 (Inst.) 재생 [e2e] — 완료 조건 직결**
- Given: A-4 실생성과 별개로 실기기 동선 검증 — 단, **추가 실생성은 비용 재발생**이므로 A-4 산출 트랙 재활용 가능 구간(재생·표시)은 재활용하고, 신규 생성 1건이 필요한 경우 사용자 승인 재취득(무승인 = 최상위 FAIL).
- When: ① 마이뮤직 곡 ⋮ 시트에 [Inst. 버전 만들기] 노출(AI 곡)·업로드곡/이미 (Inst.) 곡에는 미노출. ② 실행 → **확인 다이얼로그 ⭐5 안내** 육안 확인 → 진행 시 폴링 표시(앱 조작 가능 — UI 블로킹 0) → 완료 알림. ③ 내 곡 목록에 "(원제) (Inst.)" 표시·커버 승계 → **재생: 보컬 제거·반주 유지 청감 확인**(품질 이슈는 기록만, 판정은 재생 성공). ④ 잔액 표시 -5 반영. ⑤ 실패/402 시나리오는 A-2·A-3 판독으로 갈음(실기기 재현 강제 없음).
- Then: ①~④ 전부 충족.

**E-3. 회귀 스모크 — 공지 배지·v3.209 영상 디렉터·앨범 빈 목록 [e2e] — FAIL 게이트**
- When/Then: ① official 계정 공지가 [전체]·[내 공지](official 본인)에서 **공지 배지 정상 표시**(v3.205) + 일반 유저 글 배지 0. ② v3.209 영상 디렉터: 단색 배경 1건+테두리 색 1건 생성 경로 진입~완료 스모크(캐시 히트 허용) — 크래시·질문 흐름 회귀 0. ③ 마이뮤직 앨범 탭·앨범 목록 화면: 삭제 후 빈 목록 정상 렌더(크래시·무한 로딩 0, D-1 ⑤ 교차), 수록곡이던 트랙 4곡 재생 정상. ④ 피드 삭제·신고·팔로우 기존 메뉴 동작 1건씩 스모크.
- Then: **①·②(직전 사이클 회귀) = FAIL 게이트**.

### 게이트 요약

- **트랙 구조**: 앱 머지 게이트 = U-1~U-7 전부 PASS(frontend 자동 push 관례). 서버 트랙 = S-1~S-5 PASS → A-0 승인 → 배포 → A-1~A-5. 데이터 트랙 = D-0 승인 → 삭제 → D-1. E2E = 전 트랙 완료 후 E-1~E-3. 각 트랙 대기 시 "대기" 보고 — 커밋 순서 ①→②→③(PLAN 40% 룰: ③ 실패 시 ①·②만으로 사이클 완결 가능).
- **완료 조건**: E-1(탭·비공개 왕복)·E-2(Inst. 재생)·D-1(앨범 삭제 실증)이 사용자 요청 3건 직결 완료 조건.
- **핵심 FAIL 게이트**: ① **D-0/A-0/A-4·E-2**(무승인 앨범 삭제·무승인 배포·무승인 실생성 = 최상위) ② **S-5 ①/A-4 ③**(신규 트랙 audio의 Suno URL 잔존 — 14일 만료 사고) ③ **S-3/A-4 ⑤**(⭐ 이중 차감·환불 누락) ④ **A-5/E-1 ③**(비공개 글 타인 노출) ⑤ **U-6/E-3 ①②**(직전 사이클 회귀 — 공지 배지·타임라인·블라인드·v3.209 영상 디렉터) — 추가: **U-1**(diff 격리·App.tsx 추가 hunk)·**U-4 ②/E-1 ④**(blocks 원형 훼손)·**S-1 ②**(torch/demucs 재유입). 1건이라도 FAIL이면 해당 트랙 커밋·배포·출고 금지.
- 이월(판정 대상 아님): 업로드곡 Inst. 확장·Inst. 비용 대안(⭐10)·full 레이아웃 등 PLAN 이월 목록, 보컬 제거 품질 자체(외부 모델 성능)는 기록만.

## v3.212 (2026-09-23) — 추천하기 공유 개편: 옵션 2개 축소·멘트 랜딩 톤 정렬·초대 페이지 CTA 2원화(UA 분기)·OG 이미지 v2·웹 ?ref 프리필

대상: `2_housing/components/AppShareModal.tsx`(공유 옵션 2개·멘트 확정본) · `2_housing/components/auth/AuthPanel.tsx`(웹 한정 ?ref 프리필) · `server_staging_v3212/referral.py`(CTA 2원화+UA 분기·OG 메타·토큰 정렬) · `server_staging_v3212/static/og/invite_og_v2.png`(신규 1200×630). 서버 배포·EC2 `.env` 추가는 오케스트레이터 담당 — 배포 전이면 [api]/[e2e]는 "대기" 보고. 민감 값은 플레이스홀더(`<TEST_CODE>`=유효 추천코드 4자, `<TEST_ACCOUNT>`=테스트 계정)로 표기하며 실값은 산출물에 기록 금지.

### [unit] 앱 트랙 (AppShareModal · AuthPanel — 코드 정적 검증, 빌드 불요)

**U-1. AppShareModal 공유 옵션 정확히 2개 — 인스타·페북 잔재 0 [unit] — FAIL 게이트**
- Given: PLAN ① — 버튼 [카카오톡으로 공유 | 링크 복사] 2개만. 카카오톡 버튼은 현행 네이티브 공유 시트(`Share.share`) 유지, 카카오 SDK 미도입(이월).
- When: ① `SHARE_BUTTONS` 배열 원소 수 실측 — 소셜 버튼은 카카오톡 1종만, 링크 복사 버튼 별도 존치로 노출 버튼 총 2개. ② 파일 전체에서 "인스타"/"instagram"/"페이스북"/"facebook" 문자열(대소문자 무관) 0건 — 주석·미사용 분기·아이콘 참조 잔재 포함. ③ 카카오톡 버튼 핸들러가 여전히 RN `Share.share({message})` 경로(카카오 SDK import 0, package.json kakao 계열 의존성 0 재확인). ④ 링크 복사 핸들러가 `shareTextFull`(멘트 전문+URL)을 클립보드에 복사 — URL 누락 없음. ⑤ 버튼 레이아웃 2열 1행(폭 48% 셀) 유지, 모달 안내문(보상 설명)은 현행 유지 확인.
- Then: ①~⑤ 전부 충족 — **①·②(옵션 2개 초과 또는 인스타/페북 잔재 1건) = FAIL 게이트**.

**U-2. 공유 멘트 확정본 문자 일치·이모지 0(⭐ 예외)·AIDOL 0 [unit] — FAIL 게이트**
- Given: PLAN ① 확정 멘트(shareTextBase):
  ```
  나의 AI 아이돌, MAIDOL
  작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요.
  추천코드 {code} 입력하면 두 사람 모두 ⭐50, 시작은 3분이면 충분해요.
  ```
  `shareTextFull` = shareTextBase + "\n" + inviteUrl. 링크 복사도 동일 전문.
- When: ① 소스의 shareTextBase 템플릿 리터럴을 확정본과 **문자 단위 대조**(줄바꿈 위치·중점 `·`·쉼표·"완성해요"/"충분해요" 어미 포함, {code} 보간 위치 일치). ② 멘트·모달 전체 노출 문자열에 이모지 0 — 유일 예외 ⭐(U+2B50)만 허용, 별 외 이모지(🎵🎁 등) 발견 즉시 FAIL. ③ 노출 문자열에 "AIDOL" 단독 표기 0(브랜딩 규칙 — "MAIDOL" 내부 부분 문자열은 매칭 제외: `\bAIDOL\b` 기준). ④ 공유 시트 호출 메시지와 링크 복사 클립보드 값이 동일한 shareTextFull 인지(두 경로 문안 분기 0).
- Then: ①~④ 전부 충족 — **①(확정본 불일치)·③(AIDOL 노출) = FAIL 게이트**.

**U-3. AuthPanel ?ref 프리필 — 웹 한정·네이티브 분기 무접촉 [unit]**
- Given: PLAN ④ — `referralCode` 초기값을 `Platform.OS === 'web'` && `location.search`의 `ref`가 REFERRAL_RE(4자) 통과 시 대문자 프리필(약 5줄, try/catch). 가입 API payload 계약 무변경.
- When: ① 프리필 로직이 `Platform.OS === 'web'` 가드 내부에만 존재 — 네이티브 경로에서 `location`/`URLSearchParams` 참조 도달 불가(웹 전용 API의 네이티브 크래시 0). ② try/catch 래핑 존재(SSR·location 부재 환경 안전). ③ REFERRAL_RE 검증 통과 시에만 대입 + `.toUpperCase()` 적용, 미통과(`ref=zz!` 등) 시 초기값 공란. ④ 기존 수동 입력 필드·검증·가입 payload 필드명 diff 무변경(프리필은 초기값만). ⑤ AuthPanel diff가 프리필 블록 외 hunk 0.
- Then: ①~⑤ 전부 충족 — ①(네이티브 분기 접촉)이 판정 중심.

**U-4. tsc exit 0 + diff 격리 [unit] — FAIL 게이트(직전 사이클 회귀)**
- Given: frontend 브랜치는 커밋 후 자동 push 관례 — 머지 게이트 역할.
- When: ① `2_housing/`에서 `npx tsc --noEmit` exit 0(신규 에러 0 — 기존 에러 있으면 기준선 대조로 증분 0 판정). ② `git diff --stat` 실측: 이번 사이클 앱 변경 = `AppShareModal.tsx`·`AuthPanel.tsx` **2파일만**. 병행/직전 사이클 파일(`App.tsx`, 피드 탭 v3.210 파일군, expo-audio v3.211 파일군, `HomeHeaderActions.tsx`) 및 `1_MV_wedding/`·`0_platform_music/` 기존 dirty 파일에 **이번 사이클發 hunk 0** — 기존 워킹트리 변경은 판정 제외하되 신규 hunk 유입만 검사. ③ `HomeHeaderActions.tsx` 진입점(openInvite) 무변경 — 모달 열림 경로 회귀 0.
- Then: ①~③ 전부 충족 — **②(diff 격리 위반) = FAIL 게이트(직전 사이클 회귀 방지)**.

### [unit] 서버 스테이징 트랙 (server_staging_v3212/ — 정적 검증, 배포 전 수행 가능)

**S-1. referral.py 정적 — PLAY_STORE_URL 하드코딩 0·UA 분기·og:image v2·불변 계약 diff 0 [unit] — FAIL 게이트**
- Given: PLAN ② — CTA 2원화(양 버튼 항상 노출, UA 서버측 분기), `_WEBAPP_URL="https://app.maidol.ai.kr"` 상수, Play 링크는 `settings.play_store_url` 경유(.env 교체는 배포 단계), og:image → `/static/og/invite_og_v2.png`. 보상 로직·JSON API·404 변형·XSS escape·`aidol://` 무변경.
- When: ① `grep`으로 `play.google.com` 하드코딩 0건 — Play CTA href는 `settings.play_store_url` 참조만(내부테스트 URL 문자열이 py에 직접 등장하면 FAIL). ② UA 분기: invite_landing이 Request의 User-Agent를 읽어 "Android" 포함 → Play 버튼 primary(그라데이션)·웹 버튼 secondary, 그 외(iOS/기타) → 웹 버튼 primary + 보조문구 "iOS는 웹 버전을 권장해요 — 설치 없이 바로 시작" — 분기 로직 문자 추적, **두 버튼 모두 양 분기에서 항상 렌더**(한쪽 숨김 코드 0). ③ 웹 CTA href = `_WEBAPP_URL` + 유효 코드 시 `?ref={code}`(무효 코드 시 쿼리 없음), 코드 값 escape 경유. ④ og:image 경로 = `/static/og/invite_og_v2.png`(구 invite_og.png 참조 잔존 0), og:title/description = PLAN 확정본(유효 "「{nickname}」님이 MAIDOL에 초대했어요" / 무효 "MAIDOL — 나의 AI 아이돌" / desc "작사·작곡부터 앨범 커버까지 AI가 무료로 완성. 추천코드 {code} 입력하면 두 사람 모두 스타 50!", 무효 시 코드 문장 생략) 문자 대조. ⑤ `referral.py_orig` 대비 diff에서 **`aidol://` 딥링크 블록·`/api/referral/*` JSON 라우트·보상(⭐50 적립) 로직·404 변형 구조에 변경 hunk 0** — 표시 계층(HTML/CSS/OG 메타)만 변경. ⑥ 토큰 정렬: bg `#0a0a1a`·바이올렛 `#8b5cf6`/`#a78bfa`/`#6d28d9`·Pretendard CDN link·tagline "MY AI IDOL · AI 음악 창작 놀이터"·lede "작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요." 존재. ⑦ 노출 문자열 `\bAIDOL\b` 0·이모지 0(⭐ 예외 — desc는 "스타 50" 표기임에 유의).
- Then: ①~⑦ 전부 충족 — **⑤(보상·JSON API·딥링크 diff 발생) = FAIL 게이트**.

**S-2. OG PNG 실물 검사 — 1200×630·AIDOL 부재(육안) [unit] — FAIL 게이트(최중요)**
- Given: PLAN ③ — `server_staging_v3212/static/og/invite_og_v2.png`. 구 이미지의 FAIL 요인 3종 = "AIDOL" 워드마크·브라우저 창 프레임·입체 별 클립아트.
- When: ① Pillow(또는 `file`+`sips`)로 규격 실측: **정확히 1200×630, PNG**. ② **Read 도구로 이미지 실물을 읽어 육안 판정**: "AIDOL" 문자 미포함(워드마크는 "MAIDOL"), 브라우저 창 프레임 부재, 클립아트 입체 별 부재. ③ 육안 구성 확인: #0a0a1a 계열 다크 배경 + 상단 바이올렛 글로우, 중앙 MAIDOL 그라데이션 워드마크, 서브카피 "MY AI IDOL · AI 음악 창작 놀이터", 하단 배지 "OPEN BETA" + "추천코드 가입 시 두 사람 모두 ⭐50" — 한글 렌더 깨짐(□ 두부글자) 0. ④ 파일 용량 상식선(<500KB) — 과대 시 카카오 스크랩 지연 리스크 기록.
- Then: ①~④ 전부 충족 — **②(AIDOL 잔존) = FAIL 게이트(최중요 — 사용자 지적 "촌스러운 이미지"의 핵심 원인)**. 이미지 미제작 상태면 "대기" 보고.

**S-3. py_compile + 템플릿 무결성 [unit]**
- When/Then: ① `python3 -m py_compile server_staging_v3212/referral.py` exit 0. ② f-string 템플릿 중괄호 이스케이프 검증 — CSS 블록 `{{ }}` 처리 누락으로 인한 렌더 시 KeyError/ValueError 경로 0(가능하면 `_render_invite_html` 상당 함수를 로컬 import 호출로 유효/무효 코드 2케이스 렌더 스모크 — HTML 문자열에 미치환 `{var}` 잔존 0). ③ 렌더 산출 HTML에 CTA `<a>` 2개·`aidol://` 링크 1개 존재.

### [api] 배포 후 실측 (오케스트레이터 배포 완료 확인 후 — 전이면 "대기" 보고. 무인증 GET·웹 브라우저 검증만, 서버 쓰기 0)

**A-1. invite 페이지 UA 분기 실측 [api]**
- Given: `https://api.maidol.ai.kr/invite/<TEST_CODE>` 배포 완료(restart_9004.sh + .env `PLAY_STORE_URL` 반영).
- When: ① `curl -A "Mozilla/5.0 (Linux; Android 14; ...) Chrome/..."` → Play 버튼 primary 클래스·웹 버튼 secondary. ② `curl -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 ...) Safari/..."` → 웹 버튼 primary + iOS 권장 보조문구 존재. ③ 양 UA 응답 모두에 **두 CTA href 공존**: Play = `https://play.google.com/apps/internaltest/4700477405401874414`(.env 반영 실증 — 구 플레이스홀더 `details?id=com.maidol.app` 잔존 시 FAIL), 웹 = `https://app.maidol.ai.kr?ref=<TEST_CODE>`. ④ `aidol://` 앱 열기 링크 존치.
- Then: ①~④ 전부 충족 — ③의 구 플레이스홀더 잔존이 판정 중심.

**A-2. OG 메타·이미지 서빙 실측 [api]**
- When/Then: ① `curl /invite/<TEST_CODE>` HTML의 og:title/og:description = S-1 ④ 확정본, og:image = `https://api.maidol.ai.kr/static/og/invite_og_v2.png`. ② og:image URL GET → **200 + Content-Type image/png**, 바이트 다운로드 후 1200×630 재실측(스테이징 파일과 동일 바이트 — 체크섬 대조). ③ **구 `invite_og.png` GET 여전히 200**(기존 스크랩 카드 404 방지 — 존치 정책). ④ 무효 코드 `/invite/ZZZZ` → 404 + HTML 변형(안내문 + CTA 2개 유지) + og:title 무효 문안. ⑤ HEAD 프리플라이트: 유효 200 / 무효 404.

**A-3. JSON API·보상 계약 회귀 [api] — FAIL 게이트**
- Given: 표시 계층만 변경 — `/api/referral/*` 계약 불변이 전제.
- When: ① `GET /api/referral/my-code`(<TEST_ACCOUNT> 토큰 — 값은 플레이스홀더 관리) 응답 스키마 필드 전항 v3.211 이전과 동일. ② 무인증 GET `/invite/<TEST_CODE>` 반복 호출이 서버 5xx 0·응답 시간 상식선. ③ 보상(⭐50) 적립 로직은 코드 diff 0(S-1 ⑤)로 갈음하고, 실가입 스모크는 E2E 게이트에서 신규 코드 가입 1건 발생 시 양측 적립 확인으로 교차(추가 가입 강제 없음).
- Then: ①~③ 전부 충족 — **①(JSON 계약 회귀) = FAIL 게이트**.

**A-4. 웹앱 ?ref 프리필 브라우저 실측 [api] (Playwright 허용)**
- Given: 웹앱 배포본 `https://app.maidol.ai.kr`(앱 머지·웹 빌드 배포 완료 후 — 전이면 "대기").
- When: ① Playwright(또는 헤드리스 브라우저)로 `app.maidol.ai.kr?ref=<TEST_CODE>` 접속 → 가입 폼 진입 시 추천코드 필드에 `<TEST_CODE>` 대문자 자동 입력. ② `?ref=zz!`(형식 무효) → 필드 공란 + 콘솔 에러 0. ③ 쿼리 없음 → 공란·기존 수동 입력 동작 회귀 무. ④ 가입 제출은 하지 않음(계정 생성 부작용 0 — 프리필 표시까지만 검증).
- Then: ①~④ 전부 충족.

### [e2e] 실기기 (앱 새 빌드 + 서버 배포 완료 후)

**E-1. 추천하기 → 옵션 2개 → 카카오 공유 → 수신 멘트·OG 카드 [e2e] — 완료 조건 직결**
- Given: 실기기(Android) 새 빌드 + **카카오 공유 디버거(developers.kakao.com/tool/debugger/sharing)에서 `api.maidol.ai.kr/invite/<TEST_CODE>` 캐시 초기화 선행**(초기화 없이는 구 카드가 떠도 판정 불가 — 초기화 수행 기록 필수).
- When: ① 홈 헤더 친구초대 아이콘 → 공유 모달: 버튼 정확히 [카카오톡으로 공유 | 링크 복사] 2개, 인스타/페북 부재 육안 확인. ② 카카오톡 공유 → 시트에서 카카오톡 선택 → 수신 측 말풍선 텍스트 = 확정 멘트 3줄 + invite URL **문자 일치**(스크린샷 채증). ③ 수신 카톡의 OG 카드 = **신규 v2 이미지**(MAIDOL 워드마크·다크 바이올렛 — 구 AIDOL/브라우저 프레임 카드면 FAIL, 단 캐시 초기화 누락 여부 먼저 재확인) + og:title 신규 문안. ④ 링크 복사 → 메모 앱 붙여넣기로 클립보드 값 = 동일 전문 + URL.
- Then: ①~④ 전부 충족 — **①(옵션 3개 이상 잔존)·③(AIDOL 구 카드) = FAIL 게이트**.

**E-2. 초대 링크 Android/iPhone 실기기 분기 [e2e] — 완료 조건 직결**
- When: ① Android 실기기 브라우저에서 invite 링크 열기 → primary(그라데이션) = [Google Play에서 다운로드], 탭 시 내부테스트 페이지 도달(테스터 미등록 계정이면 접근 제한 화면도 정상 — 링크 자체 도달 판정). ② iPhone(또는 iOS UA 시뮬레이션 브라우저)에서 열기 → primary = [웹에서 바로 시작하기] + iOS 권장 문구, 탭 시 `app.maidol.ai.kr?ref=<TEST_CODE>` 도달 → 가입 폼 코드 프리필(A-4 실기기 교차). ③ 양 기기 모두 secondary 버튼 존재·동작. ④ 앱 설치 기기에서 `aidol://` 앱 열기 링크 동작 스모크.
- Then: ①~④ 전부 충족.

**E-3. 회귀 스모크 — 직전 사이클 [e2e] — FAIL 게이트**
- When/Then: ① v3.210 피드 탭 3종([전체|내 피드|내 공지]) 전환·공개/비공개 칩 표시 정상 1회 스모크. ② v3.211 백그라운드 재생 검증 화면(설정 진입) 진입~재생 스모크(크래시 0). ③ 추천 가입 보상: E-1 공유 링크로 신규 가입 1건 발생 시 양측 ⭐50 적립 확인(신규 가입 강제 없음 — 미발생 시 A-3 ③ 코드 diff 0으로 갈음 기록). ④ 앱 전반 노출 문자열 AIDOL 0 스팟 체크(모달·초대 흐름 한정).
- Then: **①·②(직전 사이클 회귀) = FAIL 게이트**.

### 게이트 요약

- **트랙 구조**: 앱 머지 게이트 = U-1~U-4 전부 PASS(frontend 자동 push 관례). 서버 트랙 = S-1~S-3 PASS → 오케스트레이터 배포(EC2 `.bak_pre_v3212` 백업 → scp py+png → .env `PLAY_STORE_URL` 1줄 → restart_9004.sh, EC2 직접 편집 금지) → A-1~A-3. 웹앱 프리필 = 웹 빌드 배포 후 A-4. E2E = 전 트랙 완료 + 카카오 캐시 초기화 후 E-1~E-3. 각 선행 미완 시 "대기" 보고.
- **완료 조건**: E-1(옵션 2개·신규 멘트·신규 OG 카드)·E-2(Android/iOS 권장 버튼 분기)가 사용자 요청 직결 완료 조건.
- **핵심 FAIL 게이트**: ① **S-2 ②/E-1 ③**(OG 이미지 AIDOL 잔존) ② **S-1 ⑤/A-3 ①**(보상·JSON API 회귀) ③ **U-1/E-1 ①**(공유 옵션 2개 초과 잔존) ④ **U-4 ②/E-3 ①②**(직전 사이클 회귀 — diff 격리·피드 탭·백그라운드 재생) — 추가: U-2(멘트 확정본 불일치·AIDOL 노출)·A-1 ③(구 Play 플레이스홀더 잔존). 1건이라도 FAIL이면 해당 트랙 커밋·배포·출고 금지.
- 사용자 안내 이관 항목(판정 대상 아님): 카카오 OG 캐시 수동 초기화(기 공유 URL), Play 내부테스트 링크는 테스터 등록 계정 한정, 카카오 SDK 카드 템플릿·beta-event-og.png 정리는 이월.

## v3.213 (2026-09-23) — 튜토리얼 전면 재설계: 6영역 확정 문안·플레이리스트 제거·반투명 하이라이트·TUTORIAL_REVIEW_MODE·anchor 13종·작업실 자동 스크롤·상단바 오버레이 2호

대상: `2_housing/components/TutorialOverlay.tsx`(반투명 하이라이트·enabled/onStepChange prop·리뷰 모드 분기) · `2_housing/utils/tutorialGate.ts`(TUTORIAL_REVIEW_MODE·SCREEN_KEYS) · `2_housing/utils/tutorialAnchors.ts`(anchor 키 +13종) · `2_housing/screens/ChartScreen.tsx`(2스텝 교체·chipBar anchor·topbar 오버레이 2호) · `2_housing/components/HomeHeaderActions.tsx`(registerTutorialAnchors prop) · `2_housing/App.tsx`(chartHeader 한정 전달) · `2_housing/screens/FeedScreen.tsx`·`SearchScreen.tsx`(각 1스텝 교체) · `2_housing/screens/PlaylistScreen.tsx`(튜토리얼 완전 제거) · `2_housing/screens/MapScreen.tsx`(6스텝·anchor 6종·자동 스크롤). 서버 무관(프론트 전용) — [api] 트랙 없음. PlayerScreen은 무변경(기존 3스텝 존치)이 스펙.

**문안 대조 기준(확정본)**: 사용자 원문 스펙에 **교정 2건 반영** — ① 띄어쓰기 붙임("~ 할 수 있어요"→"~할 수 있어요": 상단바 스타·DM 2곳) ② "메세지"→"메시지"(DM). "Youtube" 표기는 원문 유지. 이하 U-1의 14개 문자열이 유일한 대조 기준이며, 원문 그대로(교정 미반영)도 확정본과 다르면 FAIL.

### [unit] 정적 검증 (코드 판독·grep·tsc — 빌드 불요)

**U-1. 6영역 문안 확정본 문자 일치 [unit] — FAIL 게이트**
- Given: 확정본 14개 스텝 문안(교정 2건 반영). 타이틀은 PLAN 제안(신곡·차트 탭/곡 더보기/피드 작성/곡 검색/아티스트 디렉터/작사 디렉터/작곡 디렉터/이미지 디렉터/영상 디렉터/생성이력/스타/출석체크/추천/알림/DM/마이페이지) 기준, 본문은 아래와 **문자 단위 일치**:
  - chart 1/2: `최신 발매된 곡이나 인기곡을 탭하여 확인해보세요.` / 2/2: `클릭하여 재생목록에 추가하거나 플레이리스트에 담아보세요.`
  - feed 1/1: `클릭하여 피드를 작성하거나 다른 사용자의 피드 및 공지사항을 확인할 수 있어요.`
  - search 1/1: `검색하여 나에게 딱 맞는 곡을 찾아보세요.`
  - map 1~6: `클릭하여 나만의 아티스트를 만들고 의상을 입힐 수 있어요.` / `클릭하여 가사를 작사할 수 있어요.` / `클릭하여 나만의 음악을 만들어요.` / `클릭하여 내 곡의 커버 이미지를 만들어요.` / `클릭하여 SNS, Youtube, 카카오톡에 게시할 영상을 만들어요.` / `작업실에서 작업했던 과정을 확인할 수 있어요.`
  - topbar 1~6: `클릭하여 잔여 스타와 스타 받는 방법을 확인할 수 있어요.` / `클릭하여 출석체크하고 스타를 받아보세요.` / `클릭하여 친구에게 초대링크를 보내고 스타를 받아보세요.` / `클릭하여 새 피드나 공지를 확인해보세요.` / `클릭하여 나에게 온 메시지나 요청을 확인하고 다른 사용자 또는 관리자에게 연락할 수 있어요.` / `내 기획사를 관리할 수 있는 페이지로 이동할 수 있어요.`
- When: ① 각 화면 파일의 스텝 배열(desc/body 문자열)을 위 확정본과 diff 0으로 대조 — 줄바꿈·문장부호·"Youtube" 표기 포함. ② 스텝 수 실측: chart 2·feed 1·search 1·map 6·topbar 6(순서도 표와 일치 — map은 아티스트→작사→작곡→이미지→영상→생성이력, topbar는 스타→출석체크→추천→알림→DM→마이페이지). ③ 교정 전 원문 잔재("확인 할 수 있어요"·"연락 할 수 있어요"·"메세지") grep 0건. ④ 노출 문자열 `\bAIDOL\b` 0·이모지 0(브랜딩·팝업 관행). ⑤ v3.207 구 문안("빛나는 디렉터" 등 기존 스텝 텍스트) 잔재 0.
- Then: ①~⑤ 전부 충족 — **①(확정본 불일치)·③(교정 전 원문 잔재) = FAIL 게이트**.

**U-2. 플레이리스트 튜토리얼 잔재 0 [unit] — FAIL 게이트**
- Given: PLAN 표 #2 — 플레이리스트는 "튜토리얼 없음", PlaylistScreen.tsx :29 스텝·:321 오버레이·import 전량 삭제.
- When: ① PlaylistScreen.tsx에서 TutorialOverlay import·JSX·스텝 배열 grep 0건. ② `tutorialGate.ts`의 `TUTORIAL_SCREEN_KEYS`에 `'playlist'` 부재·`'topbar'` 존재 실측(기존 유저 마이그레이션 선기록이 topbar까지 커버하는 구조 확인). ③ `2_housing/` 전체 grep: screenKey `'playlist'`로 TutorialOverlay를 마운트하는 코드 0건, playlist용 seen 키 신규 기록 경로 0건(마이그레이션·과거 키 정리 코드의 문자열 잔존은 판정 제외 — 신규 기록 경로만 검사). ④ 플레이리스트 화면 본기능(목록·재생) 코드에 이번 사이클 hunk가 튜토리얼 제거 외 0.
- Then: ①~④ 전부 충족 — **①~③(플레이리스트 잔재) = FAIL 게이트**.

**U-3. 게이팅 조건식 — 로그인 상태 상호 배타 [unit] — FAIL 게이트**
- Given: PLAN 해석 확정 ① — 차트=`enabled = !user`(비로그인 전용), 상단바(차트 화면 호스트 2호 오버레이)·피드·검색·작업실=`enabled = !!user`(로그인 전용). 한 화면에서 두 오버레이 동시 노출은 구조적으로 불가.
- When: ① ChartScreen: TutorialOverlay 2개 마운트 실측 — 1호(screenKey 'chart') enabled=!user, 2호(screenKey 'topbar') enabled=!!user — **동일 user 상태에서 둘 다 true가 되는 식 불가**(문자 추적). ② FeedScreen·SearchScreen·MapScreen 각 enabled=!!user(또는 등가식) 확인. ③ TutorialOverlay 내부: enabled=false면 리뷰 모드 여부와 무관하게 show 경로 도달 불가(조기 return/조건 가드 문자 추적). ④ 작업실 비로그인 = guestTouchOverlay 잠금과 게이팅 정합(비로그인 시 튜토리얼·잠금 화면 중 잠금만). ⑤ Map anchor(feed-compose 선례처럼) 비로그인 시 topbar/map 신규 anchor가 stale 등록으로 남지 않는지 — 등록 조건 또는 해제 경로 확인.
- Then: ①~⑤ 전부 충족 — **①·②(게이팅 역전 — 비로그인에 로그인용 노출식 또는 그 역) = FAIL 게이트**.

**U-4. TUTORIAL_REVIEW_MODE 양 경로 — true(상시)·false(v3.211 완전 복귀) [unit] — FAIL 게이트**
- Given: `tutorialGate.ts` 상단 `export const TUTORIAL_REVIEW_MODE = true;`가 **유일한 스위치**(복귀 절차 주석 포함). 이번 출고 형상은 true.
- When: ① 플래그 선언 위치·현재값 true·복귀 주석 실측 + `2_housing/` 전체에서 리뷰 모드 판정을 이 상수 외 다른 곳에서 하드코딩한 분기 0건(단일 출처). ② **true 경로**: TutorialOverlay가 initTutorialGate 'fresh' 판정·seen 키 검사를 생략하고 `useIsFocused()` 포커스 획득마다 show() — 문자 추적(마운트 1회 useEffect 의존이 아님을 확인). seen 키 기록은 유지(무해 — PLAN 명기)여도 무방하되 기록이 true 경로의 노출을 막지 않는 구조 확인. ③ **false 경로(1줄 전환 검증)**: 상수만 false로 뒤집은 로컬 형상에서 코드 경로 추적 — initTutorialGate()==='fresh' && seen 미기록 시 1회 노출·seen 기록·재노출 차단, 'existing' 판정 시 전 화면 미노출 — v3.211 동작과 등가(포커스 재노출 경로가 false에서 도달 불가함을 문자 추적). 검증 후 **true로 원복 필수**(출고 형상 = true — 원복 확인을 결과에 기록). ④ false 경로에서도 enabled 게이팅은 동일 적용(로그인 전 enabled=false로 seen 미소모 → 가입 후 첫 진입 노출 — "가입 후 최초 사용" 요건 성립 구조 확인). ⑤ 가능하면 tutorialGate 로직을 node로 격리 실행(AsyncStorage mock)해 fresh/existing/미확정 3분기 + REVIEW_MODE 분기 스모크.
- Then: ①~⑤ 전부 충족 — **③(false 전환 시 first-run 미복귀 — 1줄 전환이 성립하지 않음) = FAIL 게이트**.

**U-5. anchor 13종 — 등록·해제 쌍·fallback [unit]**
- Given: 신규 13키 = `chart-tabs` + `map-artist/lyricist/composer/image/video/history`(6) + `topbar-star/attendance/invite/noti/dm/mypage`(6). 기존 재사용 = chart-row-more·feed-compose·search-input. search-row-more는 미사용화(키 존치 무해).
- When: ① `tutorialAnchors.ts` 키 union에 신규 13종 전부 존재(오타 0 — 스텝 배열의 anchor 키 참조와 문자 일치 교차 대조). ② 등록/해제 쌍: 각 등록 지점(ChartScreen chipBar onLayout, HomeHeaderActions 6종 ref/onLayout, MapScreen 디렉터 5종+생성이력)에 대응하는 해제(unmount cleanup 또는 조건 이탈 시 해제) 경로 존재 — 특히 로그인 상태 변화·화면 언마운트 시 stale 좌표 잔존 여부. ③ HomeHeaderActions 다중 마운트 대책: `registerTutorialAnchors` prop이 App.tsx **chartHeader(:283) 1곳에서만 true** — 전체 grep으로 타 헤더(titleHeader 등) 전달 0건 실측(stale 좌표 경합 차단). ④ anchor 미등록·0-rect 시 하단 카드 fallback 동작 회귀(기존 :248-256 경로 존치). ⑤ MapScreen 디렉터 anchor 박스가 `(d.x±70, d.y±70)*mapScale` 좌표계(isNext 펄스와 동일)로 산출됨 — 계산식 문자 추적. ⑥ HomeHeaderActions 아이콘 6종에 ref/onLayout만 부착·스타일 hunk 0(헤더 레이아웃 무영향).
- Then: ①~⑥ 전부 충족 — ③(다중 마운트 stale 경합)이 판정 중심.

**U-6. 반투명 하이라이트 스타일 수치 대조 — 구 테두리 박스 잔재 0 [unit] — FAIL 게이트**
- Given: PLAN 비주얼 스펙 — 4분할 딤 구멍 구조는 유지하되 구 `holeBorder`(borderWidth 2 실선)를 반투명 박스로 대체.
- When: ① 딤 색 = `rgba(13, 8, 32, 0.68)`(구 `rgba(0,0,0,0.6)` 잔재 0 — DIM_COLOR 교체 실측). ② 하이라이트 박스 수치 대조: backgroundColor `rgba(168, 85, 247, 0.16)` · borderRadius 12(radius.lg) · borderWidth `StyleSheet.hairlineWidth` · borderColor `rgba(192, 132, 252, 0.45)` · pointerEvents none. ③ 글로우: shadowColor accent(#a855f7)·shadowOpacity 0.9·shadowRadius 16·offset {0,0} — Android는 틴트+헤어라인만으로 성립(elevation 글로우 미강제) 확인. ④ **구 컷아웃 테두리 잔재 0**: borderWidth 2(또는 상수 2px) 실선 holeBorder 스타일 grep 0건 — 신 스타일과 병존 시 FAIL. ⑤ HOLE_PAD 8·화살표·근접 카드·placement 자동('below' 포함) 로직 hunk 0(유지). ⑥ 도트 인디케이터+[건너뛰기]/[다음(마지막 시작하기)] 버튼 관행 유지·스와이프 미도입 확인.
- Then: ①~⑥ 전부 충족 — **②·④(수치 불일치 또는 2px 실선 테두리 잔재 = 사용자 지적 "테두리 박스" 미해소) = FAIL 게이트**.

**U-7. onStepChange 자동 스크롤 배선 (MapScreen) [unit]**
- Given: PLAN F4 — 이미지(4/6, y=1300)·영상(5/6, y=1620) 디렉터는 첫 화면 밖 → 스텝 전환 시 자동 스크롤 후 anchor 재산출 없이는 카드 fallback으로 강등.
- When: ① TutorialOverlay에 `onStepChange?(index)` prop 신설·스텝 전환 시 호출 실측(첫 스텝 표시 시점 포함 여부 확인 — 1스텝도 화면 밖일 수 있는 방어). ② MapScreen이 onStepChange에서 대상 디렉터 y 기반 `scrollRef.scrollTo({y: 대상y*scale − 화면높이*0.45, animated:true})` 상당 호출 + 스크롤 후 재측정(~350ms 지연) 또는 스크롤오프셋 기반 직접 계산으로 anchor 갱신 — 두 방식 중 어느 쪽이든 갱신 경로 존재를 문자 추적. ③ 생성이력(6/6)은 고정 오버레이 버튼(스크롤 무관) — 스크롤 로직 미적용 확인. ④ onStepChange 미전달 화면(차트·피드·검색·상단바)에서 undefined 호출 안전(옵셔널 체이닝).
- Then: ①~④ 전부 충족.

**U-8. tsc exit 0 + diff 격리 [unit] — FAIL 게이트(직전 사이클 회귀)**
- Given: frontend 자동 push 관례 — 머지 게이트. 변경 매트릭스 = 10파일(TutorialOverlay·tutorialGate·tutorialAnchors·ChartScreen·HomeHeaderActions·App.tsx·FeedScreen·SearchScreen·PlaylistScreen·MapScreen).
- When: ① `2_housing/`에서 `npx tsc --noEmit` exit 0(기존 에러 존재 시 기준선 대조 증분 0). ② `git diff --stat` 실측: 이번 사이클 hunk가 위 10파일에 한정 — **PlayerScreen.tsx hunk 0**(스펙 범위 밖 — 존치 결정), v3.212 파일군(AppShareModal·AuthPanel)·v3.211 파일군(expo-audio 검증 화면)·v3.210 파일군(피드 탭)에 이번 사이클發 hunk 0, `1_MV_wedding/`·`0_platform_music/` 기존 dirty 무접촉. ③ App.tsx 변경 = chartHeader의 registerTutorialAnchors 전달 1건뿐(타 헤더·네비 옵션 hunk 0). ④ HomeHeaderActions 진입 핸들러(openInvite 등)·배지 로직 hunk 0 — ref/onLayout·prop 추가만.
- Then: ①~④ 전부 충족 — **②(diff 격리 위반 = 직전 사이클 회귀 유입) = FAIL 게이트**.

### [e2e] 실기기/실빌드 (새 빌드 + TUTORIAL_REVIEW_MODE=true 상태 — 웹 세션은 Playwright 병용 허용, 육안 판정은 스크린샷 채증)

**E-1. 비로그인 차트 — 진입마다 2스텝·반투명 하이라이트 [e2e] — 완료 조건 직결**
- Given: 새 빌드, 비로그인(로그아웃) 상태. REVIEW_MODE=true이므로 seen 여부 무관.
- When: ① 차트 진입 → 튜토리얼 1/2: **탭 스트립 전체 영역**(신곡~내 재생목록 chipBar)에 반투명 보라 박스, 문안 U-1 확정본. ② [다음] → 2/2: 첫 행 ⋮에 하이라이트, 문안 일치 → [시작하기] 종료. ③ 다른 탭 갔다가 차트 재진입 → **매번 재노출**(리뷰 모드 상시성) + [건너뛰기] 후 재진입 시에도 노출. ④ 비로그인 상태에서 상단바 6스텝 **미노출**(게이팅 — 차트 화면에서 차트 튜토리얼만). ⑤ 피드·검색 진입 시 튜토리얼 무노출(로그인 게이트), 작업실 = 게스트 잠금 + 튜토리얼 무노출.
- Then: ①~⑤ 전부 충족 — **④·⑤(게이팅 역전 — 비로그인에 로그인용 노출) = FAIL 게이트**.

**E-2. 로그인 — 상단바 6스텝·피드 1·검색 1·작업실 6(자동 스크롤) [e2e] — 완료 조건 직결**
- Given: 로그인 상태(테스트 계정 — 실값 산출물 기록 금지).
- When: ① 차트 진입 → **차트 2스텝 미노출**, 대신 상단바 6스텝 캐러셀: 스타→출석체크→추천→알림→DM→마이페이지 순으로 하이라이트가 헤더 아이콘 위를 이동(작은 아이콘도 화살표+카드 below 배치 정상), 문안 각 확정본 일치. ② 피드 진입 → 1스텝(Fab 하이라이트). ③ 검색 진입 → 1스텝(검색바). ④ 작업실 진입 → 6스텝: 1~3(아티스트·작사·작곡) 첫 화면 내 하이라이트 → **4(이미지)·5(영상) 스텝 전환 시 맵이 자동 스크롤되어 해당 디렉터가 반투명 박스로 스포트라이트**(하단 카드 fallback으로 강등되면 FAIL — 하이라이트 박스가 디렉터 위에 있음을 육안+스크린샷) → 6(생성이력) 우상단 고정 버튼. ⑤ 각 화면 이탈→재진입 시 매번 재노출(리뷰 모드 — 상단바 포함). ⑥ 진행 중 백버튼(Android)·[건너뛰기]로 즉시 닫힘·화면 조작 복귀, 닫은 뒤 앱 크래시·터치 먹통 0.
- Then: ①~⑥ 전부 충족 — **①(로그인에 차트 튜토리얼 노출 = 게이팅 역전)·④(자동 스크롤 실패로 fallback 강등) = FAIL 게이트**.

**E-3. 플레이리스트 무노출·플레이어 3스텝 회귀 [e2e]**
- When: ① 플레이리스트 화면 진입(로그인·비로그인 각 1회) → 튜토리얼 **무노출**·화면 본기능(목록·재생) 정상. ② 플레이어(지금 재생) 진입 → **기존 3스텝 존치**·리뷰 모드 상시 재노출 동작(공통 플래그 적용) — 문안·동작 v3.211 형상 그대로. ③ 상단바 튜토리얼 종료 후 헤더 아이콘 6종 실탭 스모크(스타 배지·출석·초대 모달·알림·DM·마이페이지 진입) — anchor 부착으로 인한 터치 간섭 0.
- Then: ①~③ 전부 충족 — ①(플레이리스트 잔재 노출) = FAIL 게이트.

**E-4. 하이라이트 비주얼 육안 판정 [e2e] — 완료 조건 직결(사용자 요청 ①)**
- When: ① 임의 3화면(차트 탭 스트립·작업실 디렉터·상단바 아이콘)에서 하이라이트가 **실제 요소 위 세련된 반투명 보라 틴트 박스**로 보임 — 구 스타일(선명한 2px 실선 테두리 박스)이 아님을 육안+스크린샷 채증. ② 딤이 순흑이 아닌 딥퍼플 톤, 대상 영역은 원본 밝기로 식별 가능. ③ Android 실기기에서 글로우 부재여도 틴트+헤어라인만으로 하이라이트 식별 성립. ④ 텍스트 카드·화살표·도트가 하이라이트와 겹쳐 가독 저해 0.
- Then: ①~④ 전부 충족 — **①(테두리 박스로 보임 = 사용자 지적 미해소) = FAIL 게이트**.

**E-5. 회귀 스모크 — 직전 사이클 [e2e] — FAIL 게이트**
- When/Then: ① 헤더 레이아웃 무변화(아이콘 위치·간격·배지 카운트 — v3.212 이전 스크린샷 대비 육안). ② 차트 탭 전환·곡 재생·⋮ 시트 열기 정상. ③ v3.212 추천하기 모달(옵션 2개·멘트) 1회 스모크. ④ v3.211 백그라운드 재생 검증 화면 진입 스모크(크래시 0). ⑤ v3.210 피드 탭 3종 전환 스모크. ⑥ 맵 디렉터 실탭·생성이력 진입·guestTouchOverlay(비로그인 잠금) 정상. — **①~⑤(직전 사이클 회귀) = FAIL 게이트**.

### 게이트 요약

- **트랙 구조**: 머지 게이트 = U-1~U-8 전부 PASS(frontend 자동 push 관례 — FAIL 1건이라도 있으면 커밋 금지). E2E 게이트 = 새 빌드(REVIEW_MODE=true) 후 E-1~E-5. U-4 ③의 false 전환 검증은 로컬 1줄 전환→추적→**true 원복**으로 수행하며 출고 형상은 반드시 true(원복 확인 기록 필수).
- **완료 조건**: E-1(비로그인 차트 진입마다 2스텝)·E-2(로그인 4영역 전부 진입마다 + 작업실 자동 스크롤)·E-4(반투명 박스 육안)가 사용자 3요청(①반투명 ②상시 노출 ③문안 교체) 직결.
- **핵심 FAIL 게이트**: ① **U-4 ③**(REVIEW_MODE=false 전환 시 v3.211 first-run 미복귀 — 1줄 복귀 약속 불성립) ② **U-2/E-3 ①**(플레이리스트 튜토리얼 잔재) ③ **U-3/E-1 ④⑤/E-2 ①**(게이팅 역전 — 비로그인↔로그인 노출 교차) ④ **U-8 ②/E-5**(직전 사이클 회귀 — diff 격리·v3.210~212 스모크) — 추가: U-1(문안 확정본 불일치)·U-6(반투명 수치 불일치·2px 테두리 잔재)·E-2 ④(자동 스크롤 실패). 1건이라도 FAIL이면 커밋·출고 금지.
- 판정 대상 아님(기록만): 오탈자 교정은 확정본에 기 반영(U-1 기준) — 원문 고수로 재변경 시 사용자 지시 필요. 플레이어 튜토리얼 제거/재작성·search-row-more 키 정리는 사용자 결정 대기(이월). 검수 완료 후 first-run 복귀는 별도 사이클(TUTORIAL_REVIEW_MODE=false 1줄 + U-4 ③ 재실행).

---

## v3.214 (2026-09-23) — 1.1.3 실기기 피드백 10건: 튜토리얼 pill·기록안내 시트·Inst 문구/⭐5·제목 마퀴·4버튼 통일·공유 봉합·자막 기하 유도(캐시 v7)·AI 칩+MAIDOL 록업·영상 피로도

대상: 앱 = `2_housing/` 8항목(TutorialOverlay·MapScreen·PolicySheet·DialogueScreen·MyMusicScreen·VideoDirectorScreen·TrackShareDownloadSheet·types/index.ts+utils/fatigueGate.ts). 서버 = **server_staging_v3214/** 3파일(services/share_video.py·routes/tracks.py·services/fatigue_service.py) — 운영 9004 직접 수정 금지·9005 미러링 금지, [unit/서버]는 스테이징 정적 검증만, [api]는 사용자 승인 배포 후. 민감값 플레이스홀더(<SSH_HOST>·<TEST_ACCOUNT>). 피로도 상태코드 관행(fatigueService.ts 실측 기준): **생성 429**(director_fatigue) / **스킵 402**(별 부족) / **스킵 409**(활성 쿨다운 없음·무과금).

### [unit] 앱 정적 검증 (코드 판독·grep·tsc — 빌드 불요, 머지 게이트)

**U-1. 튜토리얼 shape 메타·코너 마스크 렌더 조건 [unit] — FAIL 게이트(v3.213 회귀)**
- Given: TutorialStep에 `shape?: 'rect' | 'pill'`(기본 'rect'), pill radius = `min(w,h)/2`. 코너 마스크 = 구멍 위 View 1장(`left: hole.x−B, top: hole.y−B, width: hole.w+2B, height: hole.h+2B, borderWidth: B, borderColor: DIM_COLOR, borderRadius: r+B, backgroundColor 'transparent', pointerEvents 'none'`, B=40) — **shape 무관 항상 렌더**.
- When: ① shape 기본 'rect' = radius 12(radius.lg) 현행 등가 — shape 미지정 스텝(차트·피드·검색·상단바·map-history) 시각 회귀 0(문자 추적). ② pill 분기: highlightBox radius = min(w,h)/2 계산식 실측 + 코너 마스크 radius = r+B 연동. ③ 코너 마스크 렌더 조건: validAnchor 분기에서만·rect/pill 공통·pointerEvents 'none'(터치 간섭 0)·DIM_COLOR 문자 일치(v3.213 `rgba(13, 8, 32, 0.68)` — 딤과 이음새 무단차). ④ MapScreen: 디렉터 5스텝(map-artist~map-video)에만 `shape:'pill'` — 전체 grep으로 타 스텝 pill 오염 0. ⑤ anchor 하단 확장: `(d.x±70, d.y−70 ~ d.y+94)*mapScale`(하단 +24 맵단위, 이름 배지 포함)·DIRECTOR_ANCHOR_HALF 상수 분리 유지 — 140×164 → pill radius ≈ 70*mapScale(isNext 펄스와 동일 시각 언어). ⑥ v3.213 하이라이트 수치(틴트 rgba(168,85,247,0.16)·헤어라인·글로우·HOLE_PAD 8)·문안·게이팅·onStepChange 자동 스크롤에 hunk 0.
- Then: ①~⑥ 전부 충족 — **①·⑥(v3.213 튜토리얼 회귀) = FAIL 게이트**.

**U-2. PolicySheet variant·maxHeight 셈법 — 타 소비처 회귀 0 [unit] — FAIL 게이트**
- Given: `variant?: 'page' | 'sheet'`(기본 'page'=현행 전체화면) + `topLimit?: number`. sheet의 maxHeight = `winH − topLimit − spacing.md`.
- When: ① variant 기본값 'page' 실측 + 기존 소비처 전수 grep(약관·개인정보 등): variant 미전달 → 렌더 경로 무변경(전체화면 그대로). ② sheet 분기 관행 정합: `Modal transparent statusBarTranslucent animationType="slide"`·backdrop rgba(0,0,0,0.6)·flex-end·상단 radius.xxl·paddingBottom insets.bottom+spacing.xl·body ScrollView flexGrow:0 — TrackActionSheet 등 앱 시트 관행과 대조. ③ maxHeight 식 문자 일치 + topLimit 미전달/0 시 안전 가드(NaN·winH 초과 없음). ④ DialogueScreen: `useHeaderHeight()`가 **Modal 밖(화면 본체)에서 호출**되어 prop으로 전달(Modal 별창 훅 무효 함정 회피) + fallback `insets.top + 56`. 규칙 "시트 상단 ≥ 헤더 하단" 산식 성립. ⑤ variant='sheet' 전달처 = 기록안내('창작 과정 기록 안내') 경로뿐 — 타 호출처 sheet 오염 0.
- Then: ①~⑤ 전부 충족 — **①·⑤(page 소비처 회귀) = FAIL 게이트**.

**U-3. 결과 화면 4버튼 규격 + subpos 버블 정리 [unit]**
- When: ① 2행(다른 형식으로/다른 곡으로)에 `width: 300, maxWidth: '100%'`(1행과 동일), outlineBtn paddingVertical 10→**12**, outlineBtnText fontSize 13→**14** — 4버튼 폭·높이·폰트 동일 규격(색 체계는 현행: 저장=채움·나머지 아웃라인 무변경). ② 확인 팝업 취소 시 subpos 답변 버블 잔존(:304/:332 상당) 정리 코드 존재 — 취소 경로 버블 제거 문자 추적.
- Then: ①~② 충족.

**U-4. 공유 봉합 3종 — 새니타이즈·mimeType·실패 피드백 [unit] — FAIL 게이트**
- Given: 실기기 "다운로드만" 증상 3후보(a 파일명, b mimeType, c 무피드백) 동시 봉합 스펙.
- When: ① 캐시 파일명 새니타이즈: `title.replace(/[^\w가-힣.-]+/g,'_').slice(0,40)` 상당 — 한글 보존·공백/특수문자 치환·40자 제한(정규식 문자 대조). ② `Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle })` — VideoDirectorScreen·**TrackShareDownloadSheet 양쪽** 적용. ③ 다운로드·공유 catch 전 경로에 showAlert 피드백(앱 다이얼로그 관행 — 시스템 Alert 금지·무피드백 0) + 진행 중 로딩 인디케이터. ④ 웹 세션 분기 = Linking.openURL 현행 유지(회귀 0).
- Then: ①~④ 전부 충족 — **②·③(3후보 중 미봉합 잔존) = FAIL 게이트**. 실기기 실패 지점 a/b/c 확정 로그는 E-5 ④에서 채증.

**U-5. fatigueGate 'video' — 기존 관행 재사용·기존 디렉터 회귀 0 [unit] — FAIL 게이트**
- Given: types FatigueDirector += 'video', fatigueGate.ts fallback 스킵비 video: **2**, VideoDirectorScreen에 MusicGenerationScreen 패턴 이식.
- When: ① FatigueDirector union 'video' 추가·fallback 스킵비 표 video:2 실측. ② VideoDirectorScreen 배선: 진입/포커스 status fetch → startGeneration **직전** 쿨다운이면 showFatigueCooldownDialog(스킵 ⭐2·광고권) → POST **429** 응답도 동일 다이얼로그(isDirectorFatigued 관행) — **기존 fatigueGate 단일 지점 관행(기존 소비처 ~12곳)의 재사용**임을 확인: 자체 다이얼로그·중복 쿨다운 로직 신설 0(grep). ③ 기존 4 디렉터(composer·lyricist·image·artist) 소비처 hunk 0 — 스킵비·다이얼로그·409/402 처리 회귀 0. ④ 캐시 히트(동일 조합) 흐름이 앱 게이트에 선차단되지 않는 구조(서버가 캐시 판정 — 앱은 429 수신 시에만 다이얼로그) 확인.
- Then: ①~④ 전부 충족 — **③(기존 디렉터 피로도 회귀) = FAIL 게이트**.

**U-6. Inst 문구 2건 — 404 분기·⭐5 표기 [unit]**
- When: ① MyMusicScreen :353 상당 = **"⭐${INSTRUMENTAL_STAR_COST}이 차감되며"** — 구표기 "스타 5개/스타 ${…}개" 잔재 0, INSTRUMENTAL_STAR_COST 상수 참조 유지(하드코딩 5 금지, trackService.ts:158 =5 실측). ② catch **404 전용 분기** 추가: `showAlert('알림', 'Inst. 만들기 준비 중이에요. 잠시 후 다시 시도해주세요.')` 문자 일치 — 기존 402/409 분기 무변경·generic 문구는 그 외 오류로 존치. ③ 노출 문자열 이모지 금지 예외(⭐)만 사용·`\bAIDOL\b` 0.
- Then: ①~③ 충족.

**U-7. tsc + diff 격리 [unit] — FAIL 게이트(직전 사이클 회귀)**
- When: ① `2_housing/`에서 `npx tsc --noEmit` exit 0(기존 에러 존재 시 기준선 대조 증분 0). ② `git diff` 실측: 이번 사이클 앱 hunk = 변경 매트릭스 8항목 파일에 한정 — 공유 파일(TutorialOverlay·MapScreen)은 hunk가 shape/코너 마스크/anchor 확장·피로도 배선에 한정, v3.213 파일군(tutorialGate·tutorialAnchors·ChartScreen·HomeHeaderActions·App.tsx·FeedScreen·SearchScreen·PlaylistScreen)에 이번 사이클發 hunk 0, v3.210~212 파일군·`1_MV_wedding/`·`0_platform_music/` 기존 dirty 무접촉. ③ 서버 변경이 앱 트리 유입 0.
- Then: ①~③ 전부 충족 — **②(diff 격리 위반) = FAIL 게이트**.

### [unit] 서버 스테이징 정적 검증 (`server_staging_v3214/`만 — 프로덕션 9004 무접촉, 배포 전 수행)

**S-1. `_subpos_positions` 좌표표 — 전 레이아웃×포맷×3단, 커버 겹침 0 판정식 [unit] — FAIL 게이트**
- Given: PLAN ⑦ 확정 표. 겹침 0 판정식(center): 자막 점유 구간(scroll = cy±rh/2 윈도우, line = alignment 기준 MarginV 환산 y구간)의 상단 ≥ 커버 하단 ib+pad(20) **그리고** 하단 ≤ 워터마크 상단 wt.
- When: ① `_subpos_positions(fmt, layout)` 함수 존재 — 구 `_SUBPOS_MARGIN_V`/`_SUBPOS_SCROLL_CY` 하드코딩 표 직접 참조 잔재 0(grep). ② **full 레이아웃 = 기존 수치 전항 동일**(sns/wide/kakao × near/mid/low × scroll/line — 반환값 바이트 대조, 회귀 0 — 캐시 관점에서도 full 산출 기하 불변 확인). ③ center 표값 문자 대조: sns(커버 247–981) scroll cy 1221/1421/1620·line(al=2) MarginV 830/470/110 / wide **커버 중심 0.42H·size 0.60**(점유 130–778) scroll cy 872/906/940·line 230/150/80 / kakao(점유 382–1116) **3단 동일 클램프**(scroll cy 1250 단일·line al=8 1136 단일 — 400 아님·프로필 UI 제약 주석 문서화). ④ 겹침 0 전수 대입: center 9조합(fmt3×subpos3)×2모드를 판정식에 대입해 침범 0 — 특히 구버그 재현 조합(kakao line mid/low·kakao scroll mid/low·wide scroll near/mid/low) 전부 밴드 내. ⑤ kakao line 역전(low가 mid보다 위) 구조 소멸. ⑥ kakao 배지 y=H−h−56 예외 반영 시에도 wt 계산 정합.
- Then: ①~⑥ 전부 충족 — **②(full 회귀)·④(겹침 잔존) = FAIL 게이트**.

**S-2. 제목 마퀴 분기 — 가사 유무·Inst 제외 [unit]**
- When: ① 분기 조건: `segments==[]` **그리고 비Inst**(instrumental 마킹 필드 — 부재 시 " (Inst.)" 접미사 폴백; 구현이 채택한 판별자를 tracks.py instrumental 라우트 실필드와 교차 확인) → drawtext 포함, **Inst 트랙 → 현행 유지**(세그먼트 있으면 가사·없으면 무자막 — 마퀴 미적용). ② drawtext 식: `x='if(gt(text_w,w-80), w-mod(t*140,text_w+w), (w-text_w)/2)'` — 폭 초과 시에만 우→좌 140px/s 마퀴, 아니면 중앙 정적(문자 대조)·y = subpos 밴드 line모드 y·borderw 3. ③ 제목 이스케이프: drawtext 규칙(`: ' \ , %`) 처리 함수 존재 + 특수문자 제목 케이스 검증. ④ 마퀴 시 frame_rate=**20**(스틸 -r 2 금지)·kakao 클립 동일 적용. ⑤ routes/tracks.py: find_one 프로젝션 `title` 추가·generate_share_video에 title 전달.
- Then: ①~⑤ 충족.

**S-3. 캐시 v7 승격 — 범위·객체명·v6 비파괴 [unit] — FAIL 게이트**
- When: ① share_object_name = `share/v7/` 경로 — 생성·조회 양쪽 일관. ② **승격 범위 판정**: ⑧ 배지 스트립·④ 마퀴는 전 포맷·전 레이아웃 공통 가시 변경이므로 v7은 **center 한정이 아니라 전 생성물** 적용이어야 함 — 레이아웃/포맷 조건부로 v6 경로에 쓰는 신규 생성 잔존 0(center만 v7이면 full 생성물이 구 배지로 남는 모순 → FAIL). ③ **v6 객체 삭제·마이그레이션 코드 0** — 기존 v6 URL 잔존 보장(삭제 로직 발견 시 FAIL). ④ 주석·버전 문자열 v7 갱신.
- Then: ①~④ — **②(신규 경로 v6 잔존)·③(v6 파괴 코드) = FAIL 게이트**.

**S-4. 록업 PIL 렌더 — 칩 규격·MAIDOL 색 분리·정렬 [unit]**
- When: ① watermark_logo.png 정적 록업 참조 제거 → PIL 런타임 스트립(폭 W·투명 배경 1장) — ffmpeg 필터그래프의 **기존 워터마크 입력 슬롯 그대로 재사용**(그래프 구조 hunk 최소). ② 좌하단 "AI 생성" 칩: fontsize = round(0.56×자막 fs)(sns 36/wide 32/kakao 34), `rounded_rectangle` radius 0.6fs·padH 0.7fs·padV 0.3fs·bg rgba(0,0,0,0.55)·텍스트 rgba(255,255,255,0.85)·stroke_width 1(유사볼드). ③ 우하단 "MAIDOL": 동일 fontsize, **M·DOL #FFFFFF / AI #A855F7(단색)** 분리 렌더·letterSpacing ~1px·박스 없음·칩과 **수직 중앙선 정렬(같은 라인)**. ④ 배치: 좌 x=20·우 x=W−w−20·y=H−h−20(**kakao만 H−h−56**). ⑤ 폰트 NanumGothic-Regular 번들 경로 실존(assets/fonts). ⑥ 자막 low 밴드 비침범 수식 재검(sns low 하한 1810 < 배지 상단 ~1842).
- Then: ①~⑥ 충족.

**S-5. video 과금 체인 — 게이트→spend 순서·캐시 히트 무과금 [unit] — FAIL 게이트**
- When: ① fatigue_service.py: `DIRECTORS += ("video",)`, SKIP_POINT_COSTS["video"]=**2**(share_video 5의 1/3 반올림 규칙), 사다리 {1:2h,2:4h,3:8h}/max 12h 타 디렉터 동일 — **기존 4종 수치 hunk 0**. ② tracks.py POST share-video 호출 순서: 캐시 확인 → (미스 시) **check_gate 429 → spend ⭐5** → 생성 → 성공 시 `on_generation_completed(director="video")` best-effort → 실패 시 환불 현행 유지 — 게이트가 spend보다 **앞**임을 문자 추적(타 디렉터와 동일 순서). ③ **캐시 히트 경로: check_gate·spend·on_generation_completed 전부 미호출**(무과금·무게이트·무피로 — 호출 그래프 추적). ④ 기존 4 디렉터의 check_gate·on_generation_completed 호출부 hunk 0. ⑤ 스킵 라우트: video도 402(별 부족)/409(활성 쿨다운 없음·무과금) 관행 그대로 통과(디렉터 화이트리스트에 video 포함).
- Then: ①~⑤ 전부 충족 — **②(spend가 게이트보다 앞)·③(캐시 히트 과금) = FAIL 게이트**.

**S-6. py_compile + 스테이징 격리 [unit]**
- When: ① `server_staging_v3214/` 변경 3파일 `python3 -m py_compile` exit 0. ② 스테이징 diff가 계획 3파일(share_video.py·tracks.py·fatigue_service.py)에 한정 — 프로덕션 9004·9005·타 스테이징 사본(v3210 등) 무접촉.
- Then: ①~② 충족.

### [api] 프로덕션 실측 (사용자 승인 배포 완료 후 — 전이면 "대기" 보고, 무승인 배포 = 최상위 FAIL. 검증용 쓰기는 <TEST_ACCOUNT> 한정)

**A-1. 신규 v7 생성 1건 — 좌표 실측 [api]**
- When: <TEST_ACCOUNT> 토큰으로 POST /tracks/{id}/share-video — **구버그 재현 조합 우선**(center×wide×mid 또는 center×kakao×mid) 1건 이상 → ① 산출 URL이 `share/v7/`. ② 프레임 캡처(ffmpeg/ffprobe)로 자막 y가 커버 하단 아래 밴드 내(S-1 표 기대값 ±수 px 실측 기록). ③ ⭐5 차감 1회(잔액 전후 대조).
- Then: ①~③ 충족. 배포 전이면 "대기" 기록.

**A-2. 캐시 히트 무과금·무피로 [api] — FAIL 게이트**
- When: A-1과 **동일 조합** 재요청 → ① 동일 v7 URL 즉시 반환. ② 포인트 잔액 변동 0. ③ 피로도 스택·쿨다운 변동 0(GET fatigue status 전후 대조). ④ 쿨다운 중이어도 캐시 히트는 429 없이 반환.
- Then: ①~④ — **차감 또는 스택 증가 발생 = FAIL 게이트**. (참고 기록: v6 시절 생성분은 v7 캐시 부재로 다음 요청 시 1회 재과금 — 사용자 결정 기본안 수용, FAIL 아님.)

**A-3. video 쿨다운·스킵 상태코드 [api]**
- When: ① 새 조합 생성 성공 직후 **또 다른 새 조합** 요청 → **429** {"error":"director_fatigue"} + 잔여 시간 필드(타 디렉터 스키마 동일). ② 스킵: 활성 쿨다운 중 잔액 충분 → 200·⭐2 차감, 잔액 부족 → **402**, 쿨다운 없음 상태 → **409**(무과금) — fatigue.py 관행 그대로. ③ 스킵 후 생성 재시도 정상.
- Then: ①~③ 충족(브리핑의 "쿨다운 409" 표기는 스킵 409 관행으로 정정 — 게이트는 429가 스펙·실측 기준).

**A-4. 기존 v6 URL 재생 잔존 [api] — 최상위 FAIL 게이트**
- When: **배포 전에** 기존 v6 공유영상 URL(무인증 GET 가능 공개 URL) ≥1건 확보(값은 플레이스홀더 관리) → 배포 후 동일 URL GET **200**·Content-Type video/mp4·선두 바이트 정상(재생 가능).
- Then: 200 재생 — **404/파손 = 최상위 FAIL**(기존 사용자 공유 링크 파괴).

### [e2e] 실기기/새 빌드 (앱 머지 + 서버 배포 완료 후 — 육안 판정은 스크린샷 채증)

**E-1. 작업실 튜토리얼 pill 육안 [e2e] — 완료 조건 직결(①)**
- When: ① 디렉터 5스텝 하이라이트가 pill(상하 반원)로 보이고 **라운딩 밖 코너에 밝은 사각 잔존 0**(코너 마스크 — 4모서리 확대 캡처). ② 하이라이트가 스프라이트+하단 이름 배지를 함께 감쌈(배지 모서리 잘림 0). ③ map-history·차트·피드·검색·상단바 스텝은 rect 유지(radius 12 모서리도 마스크로 정합 개선 확인). ④ isNext 펄스(원형)와 시각 언어 정합 육안.
- Then: ①~④ — **①(코너 밝은 사각 잔존) = FAIL 게이트**.

**E-2. 기록안내 시트 — 헤더 하단 제한 [e2e] — 완료 조건 직결(②)**
- When: ① 작사 디렉터 저작권 등록 모드 → recChip 탭 → **시트 상단 y ≥ 헤더 하단 y**(스크린샷 측정 — 상단바·타이틀 완전 노출·침범 0). ② backdrop 탭·닫기 정상, 본문 스크롤 정상, 하단 세이프에어리어 여백 정상. ③ 약관·개인정보 등 기존 PolicySheet 소비처는 전체화면 현행 그대로(회귀 0).
- Then: ①~③ 전부 충족 — ③(page 회귀) 포함.

**E-3. 연주곡(가사 없는 곡) 제목 마퀴 [e2e] — 완료 조건 직결(④)**
- When: ① 가사 없는 일반 곡 영상 생성 → 짧은 제목 = 중앙 정적, 긴 제목(폭 초과) = 우→좌 마퀴 순환(끊김 없는 재생 육안). ② **Inst 트랙은 마퀴 미적용**(현행 유지 — 원문 "Inst 제외"). ③ 특수문자(`:',%`) 포함 제목 1건 깨짐 0.
- Then: ①~③ 충족.

**E-4. 결과 4버튼·⭐ 문구·404 문구 [e2e]**
- When: ① 완료 화면 버튼 4개(기기에 저장/공유하기/다른 형식으로/다른 곡으로) **폭·높이·폰트 동일**(스크린샷 측정 — 색 체계 현행). ② Inst 확인 팝업 "**⭐5이 차감되며**" 표기. ③ Inst 404 문구 "Inst. 만들기 준비 중이에요…" — 서버 v3.210 /instrumental **미배포 상태에서만** 검증 가능(배포 완료 후엔 N/A 기록·강제 재현 불요).
- Then: ①~③ 충족(③ N/A 허용).

**E-5. 공유 시트 — 카카오 포함 [e2e] — 완료 조건 직결(⑥)**
- When: ① 공유하기 → **시스템 공유 시트 표시**(카카오톡 항목 포함) → 카카오톡 전송 1건 성공(시스템 시트 경유 — SDK 직공유는 이월). ② 한글 긴 제목·특수문자 제목 곡 반복 — 다운로드→공유 성공(새니타이즈 검증). ③ 실패 유도(비행기모드 등) 시 오류 showAlert 표시(무피드백 0) + 진행 중 로딩 인디케이터 노출. ④ 실패 재현 시 a/b/c(파일명/mimeType/무피드백) 원인 로그 채증·보고.
- Then: ①~④ — **①(시트 미표시 = "다운로드만" 증상 잔존) = FAIL 게이트**.

**E-6. 자막 위치 — 카드형·배경형 각각 [e2e] — 완료 조건 직결(⑦)**
- When: ① **카드형(center)**: sns·wide·kakao 각 '중간' 선택 생성 → 자막이 **커버 이미지 아래** 밴드에 위치(겹침 0 — 프레임 캡처 y 실측). ② wide 카드형 커버 0.42H 상향 구도 확인(미세 톤은 사용자 판단 기록). ③ **배경형(full)**: 위/중/아래 현행 위치 그대로 — 이미지 위 표시가 정상(회귀 0, 3종 스팟). ④ kakao 카드형 3단 동일 클램프 = 문서화된 제약(오류 아님)으로 기록.
- Then: ①~④ — **①(카드형 겹침 잔존) = FAIL 게이트**.

**E-7. AI 생성 칩 + MAIDOL 록업 [e2e] — 완료 조건 직결(⑧)**
- When: ① 생성 영상 좌하단 "AI 생성" rounded 칩 + 우하단 MAIDOL(**AI만 보라 #A855F7**) — **같은 수평 라인 정렬** 육안+캡처(sns·wide·kakao 각 1). ② 자막 '아래' 선택 포함 배지-자막 비침범. ③ 구 록업(단일 watermark_logo h40) 형태 잔존 0.
- Then: ①~③ 충족.

**E-8. 재생성 ⭐ 차감·쿨다운 [e2e] — 완료 조건 직결(⑨)**
- When: ① 다시 만들기(새 스타일 조합) → **⭐5 차감** + 생성 성공 후 쿨다운 시작(1회차 2h). ② 쿨다운 중 새 조합 재시도 → 앱 다이얼로그(**스킵 ⭐2**·광고권 — 타 디렉터와 동일 UI, 시스템 Alert 아님). ③ 스킵 선택 → ⭐2 차감 후 생성 진행. ④ **동일 조합(캐시 히트)은 쿨다운 중에도 무과금 즉시 반환**(차단·차감 0). ⑤ 기존 디렉터 쿨다운 UI 회귀 0(작곡 1회 스모크).
- Then: ①~⑤ — **④(캐시 히트 과금/차단) = FAIL 게이트**.

**E-9. 직전 사이클 회귀 스모크 [e2e] — FAIL 게이트**
- When/Then: ① v3.213 튜토리얼: 비로그인 차트 2스텝·로그인 상단바 6스텝·작업실 6스텝(자동 스크롤 포함) 리뷰 모드 재노출 정상 — pill 변경이 rect 스텝·문안·게이팅·자동 스크롤에 영향 0. ② v3.212 추천하기 모달 스모크. ③ v3.211 백그라운드 재생 검증 화면 진입(크래시 0). ④ v3.210 피드 탭 3종 전환 + Inst 생성 진입. ⑤ 헤더 레이아웃·차트 재생·⋮ 시트 기본 흐름. — **1건이라도 회귀 = FAIL**.

### 게이트 요약

- **트랙 구조**: 머지 게이트 = U-1~U-7 + S-1~S-6 전부 PASS(frontend 자동 push 관례 — FAIL 1건이라도 있으면 커밋 금지. 서버는 스테이징 정적까지 — 배포는 사용자 승인 후 rsync). [api] = 배포 완료 확인 후 A-1~A-4(전이면 "대기" 보고 — 단 **A-4의 v6 URL 확보는 배포 전 선행**). [e2e] = 새 빌드 + 배포 후 E-1~E-9.
- **완료 조건**: E-1(pill)·E-2(시트 헤더 제한)·E-3(제목 마퀴)·E-4(4버튼·⭐5)·E-5(공유 시트)·E-6(자막 겹침 0)·E-7(칩+록업)·E-8(⭐·쿨다운)이 사용자 피드백 10건 직결.
- **핵심 FAIL 게이트**: ① **A-4**(기존 v6 영상 URL 파손 — 최상위·S-3 ③ 정적 선차단) ② **S-5 ③/A-2/E-8 ④**(캐시 히트 과금) ③ **S-1 ④/E-6 ①**(자막-커버 겹침 잔존) ④ **U-7 ②/E-9**(직전 사이클 회귀 — v3.213 튜토리얼 포함) — 추가: U-1 ⑥(v3.213 하이라이트 회귀)·U-2(PolicySheet page 소비처 회귀)·U-4(공유 3후보 미봉합)·U-5 ③(기존 디렉터 피로도 회귀)·S-3 ②(신규 경로 v6 잔존)·S-5 ②(게이트-spend 순서 역전)·E-1 ①(코너 사각 잔존)·E-5 ①(공유 시트 미표시). 1건이라도 FAIL이면 커밋·출고 금지.
- 판정 대상 아님(기록만): v6→v7 승격으로 기존 생성분 다음 요청 시 1회 재과금(사용자 결정 ② 기본안 수용). kakao 카드형 3단 클램프·wide 0.42H 구도 = 스펙 확정(사용자 결정 ④ 미세 조정 여지). 브리핑 "쿨다운 409"는 스킵 409(쿨다운 없음) 관행으로 정정 — 게이트 스펙 = 429. 카카오 SDK 직공유·kakao center 밴드 재설계·Inst 마킹 필드 정식화 = 이월 후보.

## v3.215 (2026-09-23) — 최종 배포 전 사이클: 작업실 anchor 정착·Inst 품질/쿨다운/커버·nowplaying 튜토리얼 교체 (+광고 버튼 편입·영상 인코딩 성능)

대상: 앱 = `2_housing/` 6파일(TutorialOverlay·MapScreen·PlayerScreen·tutorialAnchors·MyMusicScreen·playback.ts) + 완료분 2파일(useRewardedSkipAd·app.json — 오케스트레이터 적용 완료, **재수정 금지·정적 확인만**). 서버 = **server_staging_v3215/** (routes/tracks.py·services/inst_service.py·services/share_video.py + 백필 스크립트 1건) — 프로덕션 9004 직접 수정 금지·9005 미러링 금지, [unit/서버]는 스테이징 정적 검증만, [api]는 사용자 승인 배포 후. 민감값 플레이스홀더(<SSH_HOST>·<TEST_ACCOUNT>). **모바일 앱 프로젝트 — [e2e]는 전부 "실기기 검증(빌드 후 사용자 확인)" 절차([실기기] D-군)로 치환 표기**(아이스크림콘 금지 — 유닛·정적으로 판정 가능한 항목은 실기기로 승격하지 않음). 피로도 상태코드 관행: 생성 **429**(director_fatigue) / 스킵 402(별 부족) / 스킵 409(활성 쿨다운 없음·무과금) — v3.214 정정 확정치 승계.

### [unit] 앱 정적 검증 (코드 판독·grep·tsc — 빌드 불요, 머지 게이트)

**U-1. MapScreen 정착 폴링 — 안정 판정·타임아웃 강제 해제·세대 토큰 [unit] — FAIL 게이트**
- Given: handleTutorialStepChange(index) 신규 시퀀스 = ① setSettling(true) ② 대상 scrollTo(현행) ③ scrollYRef 안정 폴링(120ms 간격, 연속 2회 |Δ|<0.5 → 정착, 최대 12회=1.44s 타임아웃) ④ 정착 후 `InteractionManager.runAfterInteractions`로 registerDirectorAnchors() ⑤ setSettling(false). 고정 450ms 타이머 대체(Android momentum 미발화·장거리 스크롤 y=1620 대응 — P1 봉합).
- When: ① 시퀀스 ①~⑤ 순서 문자 추적 — 재등록이 정착 **후**·runAfterInteractions 경유(전환 애니메이션 중 measureInWindow 오염 차단). ② 안정 판정식 실측: 연속 2회 |Δ|<0.5에서만 정착, 1회 안정 후 재이동 시 카운터 리셋. ③ **타임아웃 12회 도달 시 강제 정착 처리** — settling=true 영구 고착 경로 0(모든 분기에서 setSettling(false) 도달 — 조기 return·예외 경로 포함 추적). ④ **세대 토큰**: 폴링 진행 중 다음 스텝 전환(빠른 다음 연타) 시 구세대 폴링이 신세대 settling/재등록을 오염시키지 않음(토큰 비교 후 무시 — 타이머 정리 포함). ⑤ 스크롤 불요 스텝(artist: targetY = 340*mapScale − winH*0.45 ≤ 0)도 동일 경로로 재등록 1회 경유(스크롤 0이면 폴링 즉시 안정 → 정상 종료). ⑥ 스텝 5(생성 이력)는 measureAndRegister 후 즉시 해제. ⑦ onLayout 초기 등록 존치(폴백). ⑧ P2 검증 로그: registerDirectorAnchors에 __DEV__ 로그 + 릴리즈 1회 warn(측정 rect vs window 크기) — StatusBar.currentHeight 보정은 **선반영 금지**(코드 부재 확인 — 실기기 확정 후 후속).
- Then: ①~⑧ 전부 충족 — **③(settling 고착)·④(세대 오염) = FAIL 게이트**(고착 시 튜토리얼 전체가 딤에 갇힘 — 최악 UX).

**U-2. TutorialOverlay `suspended` — 딤만 렌더·기존 소비처 회귀 0 [unit] — FAIL 게이트**
- Given: `suspended?: boolean` prop 신설(기본 false).
- When: ① visible && suspended → **전체 딤만** 렌더(구멍·코너 마스크·화살표·카드 전부 미렌더 — 조건 분기 문자 추적). ② suspended=false 복귀 시 현행 스포트라이트/pill/폴백 로직 그대로(분기 밖 코드 hunk 0). ③ prop 미전달 소비처(작업실 외 화면: 차트·피드·검색·상단바·nowplaying) = 기본 false — 렌더 경로 무변경. ④ v3.214 U-1 확정 수치(pill radius·코너 마스크 B=40·DIM_COLOR·틴트·HOLE_PAD 8) hunk 0.
- Then: ①~④ 전부 충족 — **③·④(v3.213/214 튜토리얼 회귀) = FAIL 게이트**.

**U-3. PlayerScreen 1스텝 교체 + anchor 키 [unit]**
- Given: 기존 3스텝(재생 위치/가사·제작 노트/담기와 공유, player-add) 전부 제거 → 1스텝.
- When: ① TUTORIAL_STEPS 길이 = **1**, `anchorKey: 'player-detail-toggle'`, `placement: 'above'`, title '가사·제작 노트·스타일링'(기본안), desc **원문 문자 일치**: "토글을 열어서 가사와 제작노트 그리고 아티스트의 스타일링을 확인해보세요"(바이트 대조 — 임의 윤문 금지). ② tutorialAnchors.ts에 'player-detail-toggle' 키 추가, PlayerScreen swipeUpButton(:1192 상당)에 ref + onLayout measureAndRegister, unmount 해제. ③ 기존 player-add 등록(:1155)·해제(:205) 제거 — **앱 전체 grep으로 player-add 참조 잔재 0**(registry 주석 존치는 허용 — search-row-more 관행). ④ 트리거 코드 변경 0(F5 — 리뷰 모드 off는 ⑦ 오케스트레이터 소관·본 diff에 TUTORIAL_REVIEW_MODE hunk 없음 확인).
- Then: ①~④ 충족.

**U-4. playback 커버 하이드레이션 — 결손 시에만·실패 무해 [unit]**
- Given: playTrackNow(services/playback.ts)에 maybeHydrateCover — `cover_image`/`cover_image_url` **모두** 결손 시 `GET /tracks/{id}` 백그라운드 → store track/queue 항목 병합.
- When: ① 발동 조건: 둘 중 하나라도 존재하면 호출 0(불필요 트래픽 금지 — 조건식 문자 대조). ② 병합: store의 현재 track + queue 내 동일 id 항목 양쪽 갱신(구독 자동 반영 — setState 경로 추적), 병합 시 기존 필드 덮어쓰기 아닌 결손 보강. ③ **실패 무시**: catch에서 재생 차단·오류 다이얼로그·재시도 루프 0(fire-and-forget). ④ 재생 시작을 await로 지연시키지 않음(비동기 분리 — 재생 지연 회귀 0). ⑤ __DEV__ 로그 `[playback] cover hydrate`.
- Then: ①~⑤ 충족.

**U-5. MyMusicScreen composer 게이트 + 429 분기 [unit] — FAIL 게이트**
- Given: handleCreateInstrumental(:348-386 상당)에 MusicGenerationScreen 패턴 이식.
- When: ① 확인 다이얼로그 **전** `getFatigueStatus('composer')` — cooldown_remaining_sec>0면 `showFatigueCooldownDialog({…, director:'composer', onCleared: 재진입 안내})` 후 중단(confirm 미진입 — 순서 문자 추적). ② 상태 조회 실패 시 **게이트 오픈**(진행 허용 — 서버 429 최종 방어, MusicGeneration 관행 동일). ③ POST catch에 429/'director_fatigue' 분기 → 동일 다이얼로그(앱 다이얼로그 관행 — 시스템 Alert 금지). ④ 기존 분기 무변경: 402(별 부족)·409(existing)·404("Inst. 만들기 준비 중이에요…" v3.214 U-6)·generic — hunk 0. ⑤ ⭐ 문구 INSTRUMENTAL_STAR_COST 상수 참조 유지·`\bAIDOL\b` 0.
- Then: ①~⑤ 전부 충족 — **④(기존 Inst 오류 분기 회귀) = FAIL 게이트**.

**U-6. [편입] useRewardedSkipAd·app.json — 적용 완료분 정적 확인 (재수정 금지) [unit]**
- Given: 오케스트레이터 완료분 — 검증은 **판독만**, 이 사이클 diff에 해당 파일 추가 hunk 발견 시 즉시 보고(수정 금지 위반).
- When: ① require('react-native-google-mobile-ads') 실패 catch: **admobLoadError 보존**(에러 객체/메시지 저장) + **console.warn 승격**(console.log 잔재 0 — 릴리즈 원격 로그 도달 목적). ② initRewardedAds에 1회 가드된 `[AdReward] init — supported/loadError` warn(중복 발화 방지 플래그 확인). ③ app.json android AdMob appId 끝자리 **~8636830033**(구 ~9961638197 잔재 0). ④ RNGMA 버전 16.3.2 유지(package.json — 업그레이드 hunk 0).
- Then: ①~④ 충족. **실기기 동작(버튼 노출·로그 회수)은 새 빌드 전까지 검증 불가 — D-4 "미검증 항목"으로 연계**(본 항목 PASS가 실기기 노출을 보증하지 않음을 REPORT에 명시).

**U-7. tsc + diff 격리 [unit] — FAIL 게이트**
- When: ① `2_housing/`에서 `npx tsc --noEmit` — 기존 에러 기준선 대비 증분 0. ② `git diff` 실측: 이번 사이클 앱 hunk = 변경 매트릭스 6파일(+완료분 2파일)에 한정 — v3.213/214 파일군(tutorialGate·ChartScreen·VideoDirectorScreen·TrackShareDownloadSheet 등)에 이번 사이클發 hunk 0, `1_MV_wedding/`·`0_platform_music/` 기존 dirty 무접촉. ③ 서버 변경이 앱 트리 유입 0.
- Then: ①~③ 전부 충족 — **②(diff 격리 위반) = FAIL 게이트**.

### [unit] 서버 스테이징 정적 검증 (`server_staging_v3215/`만 — 프로덕션 9004·9005 무접촉, 배포 전 수행)

**S-1. tracks.py /instrumental composer 게이트 — 게이트→과금 순서·완료 훅 [unit] — FAIL 게이트**
- Given: create_instrumental_version에 fatigue 게이트 삽입. 관행 = v3.214 S-5(게이트가 spend보다 앞).
- When: ① 삽입 위치: `_existing` 409 검사 **통과 직후**·inst_jobs 클레임/spend **이전**에 `fatigue_gate_response(current_user["id"], director="composer")` → 429(+Retry-After) — 호출 순서 문자 추적(409 existing이 쿨다운보다 선행 = 동일 트랙 재요청은 쿨다운 중에도 409 무과금 반환). ② 429 경로에서 spend·inst_jobs 클레임·파이프라인 착수 전부 미발생(호출 그래프 추적). ③ 성공 경로: inst_service._run_pipeline 완료 마킹 후 `on_generation_completed(uploader_id, db=mongo_db, director="composer")` **best-effort**(예외가 완료 마킹을 뒤집지 않음 — try/except) + **루프-로컬 db 전달**(suno_generator:553 패턴 — 미전달 시 이벤트루프 충돌 결함). ④ 실패 경로: on_generation_completed 미호출 + 환불 현행 유지(v3.210 회귀 — hunk 0). ⑤ fatigue_service.py **hunk 0**(composer 기존재 — DIRECTORS·스킵비·사다리 수치 무변경).
- Then: ①~⑤ 전부 충족 — **①/②(순서 역전 = 쿨다운 중 과금)·⑤(피로도 체계 회귀) = FAIL 게이트**.

**S-2. inst_service.py loudnorm — best-effort·sha 정합 [unit] — FAIL 게이트**
- Given: _run_pipeline 4단계(다운로드 후·MinIO put 전) 정규화 삽입.
- When: ① ffmpeg 명령 문자 대조: `-af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -b:a 320k`(1패스 — 2패스 정밀화는 이월 확정, 선반영 0). ② **best-effort**: ffmpeg 부재(FileNotFoundError)/비 0 exit/출력 0바이트 → **원본 그대로 저장·파이프라인 성공 유지**(실패 사유 전이 금지 — 분기 문자 추적). ③ 로그 2종 `[inst] loudnorm applied` / `[inst] loudnorm skipped`(사유 포함) — API 키·URL 원문 로그 금지. ④ audio_sha256·duration = **최종 저장본**(정규화본 또는 원본) 기준 산출(정규화 후 원본 sha 잔존 = 결함). ⑤ cover_image_url 원곡 상속 현행 hunk 0(F4 — 서버 커버 변경 불요 확정). ⑥ 임시 파일 정리(정규화 실패 시 잔여 파일 누수 0).
- Then: ①~⑥ 전부 충족 — **②(loudnorm 실패가 Inst 생성 실패로 전이) = FAIL 게이트**(음질 개선이 가용성을 깨면 역행).

**S-3. share_video.py 인코딩 성능 — PIL 사전 합성·기하 불변·캐시 v8 [unit] — FAIL 게이트**
- Given: 정적 요소(커버+워터마크 록업) PIL 사전 합성 1장 → `-loop` 입력 1개화 + `-framerate` 정합, 캐시 v8 승격.
- When: ① 필터그래프 입력 수 감소 문자 추적: 정적 레이어가 사전 합성 PNG 1장으로 통합·`-loop 1` 입력 1개, 동적 요소(자막 scroll/line·마퀴)만 필터 잔존 — 마퀴 frame_rate=20·스틸 -r 규칙(v3.214 S-2 ④) 유지. ② **좌표 대응표 작성·대조**: 사전 합성으로 이동한 각 요소(커버 위치/크기·AI 칩·MAIDOL 록업 x/y·kakao H−h−56 예외)의 최종 프레임 좌표 = v3.214 S-1 subpos 표·S-4 록업 배치와 **전항 동일**(fmt 3종 × full/center — 합성 캔버스 좌표계와 ffmpeg overlay 좌표계 환산 수식 명기). 자막 subpos 좌표(scroll cy·line MarginV)는 hunk 0(동적 레이어 무이동). ③ 캐시 **v8** 승격: share_object_name = `share/v8/` — 생성·조회 양쪽 일관·**전 생성물 적용**(포맷/레이아웃 조건부 v7 신규 생성 잔존 0). ④ **v7 객체 삭제·마이그레이션 코드 0**(기존 URL 잔존 보장 — 발견 시 FAIL). ⑤ 성능 근거 정적 확인: 사전 합성이 요청당 1회·PIL 처리(프레임 반복 없음), 캐시 히트 경로는 합성·인코딩 전체 미진입.
- Then: ①~⑤ 전부 충족 — **②(기하 변화 = 자막·록업 좌표 이탈)·③(신규 경로 v7 잔존)·④(v7 파괴 코드) = FAIL 게이트**. 실측 elapsed는 A-1(정적으로 300s 판정 불가 — 목표는 배포 후 실측).

**S-4. py_compile + 백필 스크립트 + 스테이징 격리 [unit]**
- When: ① 변경 파일(tracks.py·inst_service.py·share_video.py·백필 스크립트) `python3 -m py_compile` exit 0. ② 스테이징 diff가 계획 파일에 한정 — 프로덕션 9004·9005·타 스테이징 사본(v3214 등) 무접촉, `_orig` 보존 확인. ③ 백필 스크립트: 대상 **"냥냥냥 (Inst.)"(6ab349505cd1241ab92b5e5f) 1건 한정**(전체 컬렉션 순회 금지 — id 하드 지정), S-2 ①과 동일 loudnorm 파라미터, MinIO 재업로드 + tracks.audio_sha256 갱신 포함, **DEPLOY.md에 1회성 절차 기재·실행은 사용자 승인 후**(스크립트 내 dry-run 또는 확인 프롬프트 존재). ④ 민감값: 스크립트·로그에 <SSH_HOST>·자격증명 원문 0.
- Then: ①~④ 충족.

### [api] 프로덕션 실측 (사용자 승인 배포 완료 후 — 전이면 "대기" 보고, 무승인 배포 = 최상위 FAIL. 검증용 쓰기는 <TEST_ACCOUNT> 한정)

**A-1. 영상 인코딩 성능·기하 실측 [api] — FAIL 게이트(기하)**
- Given: 배포 전 기존 v7 공유영상 공개 URL ≥1건 확보(A-5 ① 선행 — 값 플레이스홀더 관리).
- When: <TEST_ACCOUNT> 토큰으로 신규 조합 POST /tracks/{id}/share-video **단독 실행**(동시 생성 없는 시점) → ① **elapsed < 300s**(서버 로그/폴링 완료 시각 실측 — 수치 기록, 목표 미달 시 초과분·병목 로그 첨부해 재계획 소재로 보고). ② 산출 URL `share/v8/`. ③ 프레임 캡처(ffmpeg): 자막 y·AI 칩·MAIDOL 록업 좌표가 v3.214 A-1/E-6/E-7 실측값과 동일(**기하 불변** — subpos 밴드 내·록업 배치 ±수 px 기록). ④ ⭐5 차감 1회(잔액 전후 대조).
- Then: ①~④ — **③(기하 이탈) = FAIL 게이트**, ①은 미달 시 "목표 미달·수치 보고"(즉시 FAIL 아님 — 게이트 요약 참조).

**A-2. 캐시 무과금 + Inst 음질 실측 [api] — FAIL 게이트(캐시 과금)**
- When: (a) A-1과 **동일 조합** 재요청 → 동일 v8 URL 즉시 반환·잔액 변동 0·피로 스택 변동 0. (b) 신규 Inst 생성 → 저장본 다운로드 → `ffmpeg -af loudnorm=print_format=json` 실측: **I = -14±1 LUFS·TP ≤ -1.0dBTP**(원곡 -13.9와 정합 — 7.3LU 격차 해소 확인), ffprobe 320kbps/48kHz·duration 정상·선두 바이트 재생 가능, 서버 로그 `[inst] loudnorm applied`. (c) 백필 실행(사용자 승인 후) → "냥냥냥 (Inst.)" 동일 실측 -14±1·audio_sha256 갱신·cover-preview 200 유지 — 승인 전이면 "대기".
- Then: (a)~(c) — **(a) 차감/스택 발생 = FAIL 게이트**(v3.214 A-2 회귀). (참고 기록: v7 시절 생성분은 v8 캐시 부재로 다음 요청 시 1회 재과금 — 기본안 수용, FAIL 아님.)

**A-3. Inst composer 쿨다운 체인 [api] — FAIL 게이트**
- When: <TEST_ACCOUNT>로 ① composer 쿨다운 없는 상태에서 Inst 생성 성공 → GET fatigue status 전후 대조: composer 스택 +1·쿨다운 개시(**일반 곡 생성과 사다리 합산** — Inst 1건 = 작곡 1곡 카운트 확인). ② 쿨다운 중 **다른 트랙** Inst 재요청 → **429** {"error":"director_fatigue"}+Retry-After(타 디렉터 스키마 동일), **잔액 변동 0·inst_jobs 신규 문서 0**(게이트→과금 순서 실측). ③ 쿨다운 중 **동일 트랙** 재요청 → 409(existing — 쿨다운보다 선행·무과금, S-1 ① 순서 실측). ④ 상태 폴링 GET은 쿨다운 무관 통과. ⑤ 스킵: 활성 쿨다운 중 200·⭐2 차감(composer 스킵비 현행) → 스킵 후 Inst 재시도 정상. ⑥ 실패 Inst(강제 유도 가능 시) → 환불 + on_generation_completed 미발화(스택 불변) — 유도 불가면 코드 추적(S-1 ④)으로 갈음 기록.
- Then: ①~⑥ — **②(쿨다운 중 과금·클레임 발생) = FAIL 게이트**.

**A-4. [편입] 원격 로깅 배선 재확인 [api]**
- When: ① release 빌드의 console.warn → frontend.log 전송 배선(로거 훅 코드 + 서버 수신 엔드포인트) 판독 재확인 — 기존 타 warn 라인이 frontend.log에 실존하는지 표본 1건 확인(배선 생존 증거). ② `[AdReward]` 라인 자체는 **새 빌드 실기기 전까지 회수 불가** — "미검증(빌드 종속)" 기록·D-4 연계.
- Then: ① 충족 + ② 미검증 명시(FAIL 아님).

**A-5. 회귀 — 기존 v7 URL·Inst 기존 플로우 [api] — 최상위 FAIL 게이트**
- When: ① **배포 전 확보한** 기존 v7 공유영상 공개 URL GET → 배포 후 **200**·Content-Type video/mp4·선두 바이트 정상(재생 가능). ② Inst 기존 플로우: 동일 트랙 409 분기·상태 폴링 스키마 무변경. ③ share-video 기존 디렉터(video 포함 5종) fatigue status 스키마·스킵 402/409 관행 무변경(스팟 1건).
- Then: ①~③ — **①(v7 URL 404/파손) = 최상위 FAIL**(기존 사용자 공유 링크 파괴 — S-3 ④ 정적 선차단).

### [실기기] 새 빌드 검증 ([e2e] 치환 — 앱 머지 + 서버 배포 + 새 APK 빌드 후 **사용자 확인 절차**, 육안 판정은 스크린샷/화면 녹화 채증. 빌드 전이면 전 항목 "대기" 보고)

**D-1. 작업실 튜토리얼 anchor 정착 [실기기] — 완료 조건 직결(②)**
- When: ① 작업실 6스텝 진행 — 스텝 전환(특히 장거리: 아티스트→영상 y=1620) **스크롤 이동 중 하이라이트·카드 미표시(전체 딤만)** → 정착 후에만 스포트라이트 표시(화면 녹화 채증). ② 아티스트 1스텝(스크롤 없음): pill 하이라이트가 캐릭터 정위치 — isNext 펄스 좌표와 시각 오차 판정(스프라이트+이름 배지 감쌈, v3.214 E-1 기준). ③ 6스텝 완주·어느 스텝에서도 딤 고착(타임아웃 미해제) 0. ④ P2 판정 로그 회수: 릴리즈 warn(rect vs window)에서 Android 상태바 상수 오프셋 유무 확인 — 확인 시 StatusBar.currentHeight 보정 1줄 후속 지시(이번 빌드 미반영이 정상).
- Then: ①~④ — **②(하이라이트 어긋남 잔존 = 사용자 원보고 증상) = FAIL 게이트**.

**D-2. nowplaying 튜토리얼 1스텝 [실기기] — 완료 조건 직결(⑥)**
- When: ① 신규 설치 조건(스토리지 완전 초기화 — 기존 설치 기기는 'existing' 판정으로 미노출이 **정상**임을 검수자에게 사전 고지) 또는 리뷰 모드로 재생 화면 진입 → **1스텝만** 노출: 하단 토글(가사 · 제작 노트 · 스타일링 · 댓글) 영역 스포트라이트 + 카드 above. ② 문안 원문 표시: "토글을 열어서 가사와 제작노트 그리고 아티스트의 스타일링을 확인해보세요". ③ 구 3스텝(재생 위치/담기와 공유) 잔재 0.
- Then: ①~③ 충족.

**D-3. Inst 커버·음질 체감 [실기기]**
- When: ① Inst 트랙("냥냥냥 (Inst.)" 등)을 **경로별**(내 곡·피드·재생목록) 재생 → 미니플레이어·PlayerScreen·상세토글 미니바 커버 표시. ② 미표시 재현 시 진입 경로 + __DEV__ `[playback] cover hydrate` 로그 채증·보고(F4 잔여 후보 확정 자료). ③ 정규화 배포 후 신규 Inst 청감: 원곡 대비 음량 정합(주관 판정 기록) — **분리 아티팩트 잔존은 sunoapi.org 한계로 개선 불가**임을 사용자 보고에 명시(오판정 방지).
- Then: ①~③ 충족(②는 재현 시 기록 의무).

**D-4. [편입·미검증 항목] 광고 「광고 보고 단축」 버튼 [실기기] — 새 APK에서만 검증 가능**
- Given: U-6 정적 PASS는 실기기 노출을 보증하지 않음 — **본 항목이 이번 픽스의 유일한 실증**. AdMob 앱 ID 교정(~8636830033)이 반영된 새 빌드 전제.
- When: ① 쿨다운 팝업에서 광고 보고 단축 버튼 **노출 여부** 확인. ② frontend.log에서 `[AdReward] init — supported/loadError` 라인 회수 — supported=false면 loadError 본문으로 원인 확정(require throw 여부 판정 — 진단 목적 달성). ③ 노출 시: 광고 시청 → 스킵 처리 1회(SSV 경유·무과금 스킵 확인).
- Then: ①~③ — 빌드 전 상태에서는 **REPORT에 "미검증(새 빌드 필요·사용자 확인 절차)" 명시가 완료 조건**(노출 실패 자체는 이번 픽스 FAIL이 아니라 ②의 진단 로그 회수로 후속 판정).

**D-5. 회귀 스모크 [실기기] — FAIL 게이트**
- When/Then: ① 튜토리얼 타 화면 스텝(차트·피드·검색·상단바·map-history) rect·문안·게이팅 회귀 0 — suspended 신설·PlayerScreen 교체가 타 화면에 영향 0(v3.213/214 승계). ② 쿨다운 다이얼로그 기존 4 디렉터(composer·lyricist·image·artist) UI 회귀 0 — 작곡 일반 생성 1회 스모크(Inst 게이트 이식의 역영향 0). ③ 영상 생성 1건: center 자막 밴드·제목 마퀴·AI 칩+MAIDOL 록업·video 피로도 429(v3.214 E-6/E-7/E-8 스팟 — v8 재인코딩 경로 검증 겸용). ④ Inst 생성 진입 → 확인 팝업 ⭐5 문구 → 생성/폴링 정상(v3.210/214 승계). ⑤ 일반 곡 재생·헤더·⋮ 시트 기본 흐름. — **1건이라도 회귀 = FAIL**.

### 게이트 요약

- **트랙 구조**: 머지 게이트 = U-1~U-7 + S-1~S-4 전부 PASS(frontend 자동 push 관례 — FAIL 1건이라도 커밋 금지. 서버는 스테이징 정적까지 — 배포·백필은 사용자 승인 후). [api] = 배포 완료 확인 후 A-1~A-5(전이면 "대기" 보고 — 단 **A-5 ①의 v7 URL 확보는 배포 전 선행 필수**). [실기기] = 새 APK + 배포 후 D-1~D-5(사용자 확인 절차 — [e2e] 치환).
- **완료 조건 직결**: D-1(anchor 정착·어긋남 해소)·A-2(Inst -14±1 LUFS)·A-3(composer 쿨다운 429·사다리 합산)·D-3(Inst 커버)·D-2(nowplaying 1스텝)·A-1(elapsed<300s·기하 불변)이 사용자 요구 6건 직결. **D-4는 "미검증 항목" 명시가 완료 조건**(빌드 종속 — 허위 PASS 금지).
- **핵심 FAIL 게이트**: ① **A-5 ①**(기존 v7 영상 URL 파손 — 최상위·S-3 ④ 정적 선차단) ② **S-3 ②/A-1 ③**(사전 합성 기하 이탈 — 자막·록업 좌표) ③ **S-1 ①②/A-3 ②**(쿨다운 중 과금·클레임) ④ **A-2 (a)**(캐시 히트 과금 — v3.214 승계) ⑤ **S-2 ②**(loudnorm 실패의 파이프라인 전이) ⑥ **U-1 ③④**(settling 고착·세대 오염) ⑦ **U-2 ③④/D-5 ①**(튜토리얼 기존 화면·수치 회귀) ⑧ **U-5 ④**(Inst 기존 오류 분기 회귀) ⑨ **D-1 ②**(anchor 어긋남 잔존) ⑩ **U-7 ②**(diff 격리 위반). 1건이라도 FAIL이면 커밋·출고 금지.
- **판정 대상 아님(기록만)**: 분리 아티팩트 음질 자체(sunoapi.org mp3 전용·WAV/품질 옵션 부재 — 공식 문서+record-info 실조회 확정, 개선분은 음량 7.3LU까지). v7→v8 승격으로 기존 생성분 다음 요청 시 1회 재과금(기본안 수용). A-1 ① elapsed 300s 목표 미달 = 수치 보고 후 재계획(즉시 FAIL 아님 — 단 동반된 기하·과금 게이트는 별개 적용). P2 상태바 오프셋 보정 = 실기기 로그 확정 시 후속(선반영 금지). 기존 설치 기기 튜토리얼 미노출 = 정상(최종 검수는 신규 설치만 가능). 이월 후보: loudnorm 2패스·split_stem 재합성·RNGMA 17·Inst 별도 사다리.

## v3.216 (2026-09-23) — 1차 게이트(유닛·정적): 웹 소셜로그인 복구·DM 헤더 규격·official 기본 노출·패션브랜드 시드·SSUGSIS 초대 — 정독 검증 + 판정

전제: 서버 미배포 상태 — 프로덕션 쓰기·배포·원격 변경 없음(로컬 정독 + tsc/py_compile + CSV dry-parse 실측만). [api]/[e2e] 항목은 배포 후 2차 게이트로 이월.

### G1. 앱 (2_housing, 7파일) — 전부 PASS
| # | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|
| G1-1 | SocialLoginButtons 웹 분기 | 웹 = `window.location.assign(loginUrl)` 같은 탭 이동(try/catch+showAlert 폴백), `Linking` import 제거. 네이티브 경로(openAuthSessionAsync~딥링크) hunk 무접촉 | PASS |
| G1-2 | App.tsx 경쟁조건 방어 | `webOAuthTokenPending` 모듈 플래그 — hash `#token=` 감지 시 set → 부팅 effect(:540) restoreSession 스킵. `loginWithToken` Promise<boolean>(:44) 실패(!ok) 시에만 후행 restoreSession(:483). 효과 순서 보장: useOAuthCallback() 호출(:534)이 restoreSession effect(:540)보다 선행 선언 → 플래그 선확정. **diff 격리**: App.tsx 미커밋 diff = 이번 2 hunk 뿐(웹탭바 등 타 hunk 무접촉) | PASS |
| G1-3 | remoteLogger 해시 제거 | `_currentUrl` 웹 분기 `window.location.href.split('#')[0]` — `#token=` 로그 유출 차단, 네이티브 분기 무변경 | PASS |
| G1-4 | DmInbox 새 메시지 시트화 + official 고정 행 | 전체화면 Modal 폐지 → `transparent`+`statusBarTranslucent` 시트, top=`useHeaderHeight()` 측정(0이면 insets.top+56 폴백), height=winH−topLimit−spacing.md(flex-end) — 네이티브 헤더 상시 노출. 빈 검색어 = official 1행(`fetchOfficial` 캐시, 실패 시 null→빈 목록 폴백·60s 스로틀) + '공식' 배지, 탭=기존 startConversation(official_id). 검색어 입력 시 검색 결과만(고정 행 미노출 = 중복 구조적 배제). 검색 debounce·startConversation·미인증 게이트 무변경 | PASS |
| G1-5 | DmChat 헤더 규격 | header `height: 56` 고정 + paddingBottom 제거, 컨테이너 `paddingTop: insets.top`(동적)만 — 고정 paddingTop 없음(header-consistency 규칙 준수) | PASS |
| G1-6 | ArtistCody 악세서리 2호출 | `Promise.all([category=모자, category=가방])` 합산, 구주석("서버 400 거부") 삭제·정정. catch→`setPickerItems([])`=SAMPLE 폴백 유지, `wishlistStore.sync(items)` 유지 | PASS |
| G1-7 | AuthPanel 추천코드 확장 | `REFERRAL_RE=/^[A-Z0-9]{4,12}$/`·maxLength 12·문구 "4~12자". `?ref=SSUGSIS` 프리필: URLSearchParams→toUpperCase→RE.test 통과(slice 없음). 기존 4자 코드 회귀 통과(A-Z0-9 상위집합) | PASS |
| G1-8 | `npx tsc --noEmit` | exit 0, 오류 0 | PASS |

### G2. 서버 스테이징 (server_staging_v3216, 5파일) — 전부 PASS
| # | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|
| G2-1 | referral_service resolve 확장 | `REFERRAL_CODE_RE=^[A-Z0-9]{4,12}$`(SSUGSIS 7자 통과, 3자/13자/특수문자 거부), `REFERRAL_CHARSET`·`REFERRAL_CODE_LEN=4`(발급) 불변. _orig 대비 diff = 정규식+주석+로그 truncat [:8]→[:12] 만 — 최소성 충족 | PASS |
| G2-2 | referral.py 랜딩 개편 | CTA 웹앱 primary 단일(`app.maidol.ai.kr?ref={code}`), Play 버튼 제거→install-note 블록(maidol_official DM + `mailto:kimpearl@lotusai.co.kr`), 워드마크 `M<span class=wordmark-ai>AI</span>DOL` AI 그라데이션 존치. 유효(code_block+?ref 부착)/무효(code=None→일반 문구+CTA 유지, 404 HTML) 양쪽 렌더 유지. is_android·OG·HEAD 대응·open-app 링크 존치 | PASS |
| G2-3 | wishlist.py | `ALLOWED_AD_CATEGORIES`에 모자·가방 추가 1줄(+주석)만 — business.py 세트와 정합 | PASS |
| G2-4 | set_referral_ssugsis.py | dry-run 기본(--apply 필수), UUID(d988bcfd-…)+이메일 교차검증, 현행 코드=5JJY 가드, SSUGSIS 선점 조회 가드, 멱등 no-op(이미 SSUGSIS), UPDATE에 `AND referral_code=$3` 동시변경 가드 | PASS |
| G2-5 | seed_fashion_brands.py | dry-run 기본(쓰기 0 — 읽기 조회만), SEED_TAG='fashion_brands_csv' 멱등(clear_previous: S3 remove_object → delete_many = replace, 타 시드 무접촉), 판매중 기본(--include-soldout 옵션), gender/category 매핑·'대표(…)'→'기본'·실패 행 skip 리포트. **CSV dry-parse 실측(정본 CSV)**: total 4,857 → valid 4,219 / soldout 638 / skipped 0(이미지 결측 0) / 카테고리 상의1,344·하의1,276·모자629·가방623·신발347 — DEPLOY.md 기대값과 전수 일치 | PASS |
| G2-6 | py_compile 5파일 | 전부 통과 | PASS |
| G2-7 | _orig/MD5SUMS.txt·DEPLOY.md | _orig 5파일 md5 = MD5SUMS.txt 전수 일치, 배포본 md5 = DEPLOY.md 표 일치(5/5). DEPLOY.md 완결: env 교정(§1, `--env-file`은 재생성 필요 명기 §0)·백업(§2)·배포 직전 라이브 md5 재대조(§3, drift 시 중단)·build+컨테이너 재생성(§4)·검증 curl(§5)·SQL 순서 고정(코드 배포 후, §0/§6)·시드 절차(§7)·Pages 승인 배포(§8)·롤백(코드/env/SQL/시드, §9) 전부 포함 | PASS |

### G3. 웹 래퍼 (homepage/maidol/app-shell/index.html) — PASS
| # | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|
| G3-1 | search+hash 보존 | 모바일(<768) `location.replace('/app'+location.search+location.hash)`, PC iframe `src='/app'+location.search+location.hash`(스크립트 설정) — `#token=`·`?ref=` 양 경로 보존. v3.216 표시 변경은 이 2곳뿐, 랜딩 디자인·링크 등 타 부분 오염 없음(단, 디렉터리가 git 미관리라 diff 불가 — 정독 확인) | PASS |

### 판정
**v3.216 1차 게이트 통과** — 13항목 전부 PASS, FAIL 0. 이월(2차 게이트, 배포 후): /invite/SSUGSIS 실측·구글/카카오 실로그인 완주·래퍼 hash 보존 e2e·시드 반영 건수·악세서리 피커 실표시(test-designer 6~9). 비고(판정 대상 아님): (a) (brand,category,name,color) 중복 — 판매중 기준 256건(PLAN의 244건은 전량 기준·색상 정규화 전 수치로 추정, 문서 단위 삽입이라 무해 동일) (b) REFERRAL_CODE_RE 확장이 dm_service 배틀태그 검색에 파급되는 점은 DEPLOY.md §0에 의도된 부수효과로 명기됨 (c) 시드 소스가 세션 scratchpad 경로 — DEPLOY.md §7 경고 존재하나 조기 rsync/영구 복사 권장.

## v3.217 (2026-09-24) — 1차 게이트(유닛·정적): 웹 재생 브라우저 확장·차트 공개↔숨김·대표 아티스트·iOS 웹 시트·voice 302 픽스·헬스체크 관리자·가상 착장 — 정독 검증 + 판정

전제: 서버 미배포 상태 — 프로덕션 쓰기·배포·원격 변경 없음(로컬 정독 + tsc/py_compile/npm build/expo export 실측만). [api]/[e2e] 항목은 배포 후 2차 게이트로 이월(하단 명기). 서버 대조본: server_staging_v3217(_orig=라이브 2026-09-24 pull) + 로컬 9004 사본(routes/character.py — /character/me 응답 shape 확인용, 스테일 가능성 비고).

### A. 앱 (2_housing) — 11항목 중 10 PASS · 1 FAIL
| # | 태그 | 항목 | 시나리오(Given/When/Then)·근거 | 판정 |
|---|---|---|---|---|
| A-1 | [unit/web] | webAudioElement.ts 단일 element·세대 가드 | Given 웹 재생. When 곡 전환/언로드. Then ① `ensureElement()` 1회 생성 후 `audio.src` 교체 재사용(new Audio 재생성 0 — :59-92·:195-198) ② `gen` 세대 가드: 구 래퍼 unload/play/seek 전부 `this.current` 검사로 무해화(:123-125·:170-182 — unloadAsync가 gen++ 후 현 재생 미간섭) ③ ended 이중 전진 방지: endedHandler true 반환 시 didJustFinish 미전파(:71-79) + ended 직전 pause 이벤트 dispatch 억제(:67-70) ④ expo-av 호환 서브셋: 소비처 실사용 필드(isLoaded/isPlaying/positionMillis/durationMillis/didJustFinish/error) 전부 buildStatus 커버(:35-48, 소비처 grep 대조) | PASS |
| A-2 | [unit] | playback.ts createTrackSound 팩토리 — 네이티브 무변경 | When diff 정독. Then ① 팩토리(:618-636): 네이티브 분기 = `return Audio.Sound.createAsync(source, initialStatus, onStatus)` 그대로(시그니처·인자 동일 — 동작 등가) ② 네이티브 프리로드 경로(maybePreloadNext :402 createAsync·로컬 파일 스왑) hunk 0, 웹 가드 `if (Platform.OS === 'web') return` 잔존 ③ 웹 신규 코드 전부 `Platform.OS === 'web'` 블록·웹 전용 함수 내 격리 — 네이티브 런타임 유입 0 ④ loadAndPlayTrack 교체(:653-658)는 팩토리 경유 1줄 치환 | PASS |
| A-3 | [unit/web] | 웹 ended 연속재생·prefetchNextWebUrl·mediaSession 구독 단일화 | Then ① ended 핸들러(:113-137): 프리페치 URL(미스 시 결정적 stream-proxy)로 **동기** `webSwapSrcAndPlay` — await/XHR 0(프리페치는 로드 직후 fire&forget :94-117) ② 큐 소진만 false 반환 → didJustFinish 전파 → 기존 관련곡 이어듣기 경로 보존 ③ 전진 = store.playTrackAtIndex(부수효과 없는 상태 갱신 — playerStore.ts:178 확인, 이중 로드 없음) ④ mediaSession 트랙 sync = store.track 변경 구독 단일 지점(:122-131), syncMediaSessionForTrack 호출처 전수 grep = 이 구독 1곳뿐 — v3.216b playbackState/positionState 구독(msLast)은 무변경 병존 ⑤ owner 가드: 미니 경로(playback) 콜백만 새 곡 기준 재설치, PlayerScreen(external) 콜백 유지(:132-134) | PASS |
| A-4 | [unit] | PlayerScreen createAsync→createTrackSound 5곳·:604 제거 | Then ① 교체 5곳 = :489(프리로드 스왑 폴백)·:534(자동 다음곡)·:590(메인 로드)·:782(routeTrack 교체)·:844(수동 스킵) — `Audio.Sound.createAsync` 잔존 0(grep) ② 구 :604 개별 syncMediaSessionForTrack 호출 제거 + import 제거 — 파일 내 잔존 0 ③ 그 외 hunk 없음(diff 20줄 전부 위 교체·주석) — 네이티브 동작 동일(팩토리가 동일 호출로 위임) | PASS |
| A-5 | [unit/web] | browserEnv.ts·InAppEscapeBanner.tsx | Then ① UA 판정: KAKAOTALK/Instagram/NAVER/Line/FBAN·FBAV·FB_IAB/Android wv 토큰, 일반 브라우저 null(무개입 :17-28) ② kakao openExternal = `encodeURIComponent(location.href)` — query·hash 보존(:45-47, index.html 인라인 :52-53 동일) ③ intent URL 조립: scheme 판별·`package=com.android.chrome` 지정(:50-55) ④ 네이티브 즉시 null: 컴포넌트 렌더 가드 + effect 가드 이중(:29·:51) ⑤ App.tsx mount 웹 전용(:646 `Platform.OS === 'web'` 조건) ⑥ 카카오 자동 시도 중복 방지: 인라인 `__MAIDOL_INAPP_ESCAPE_AT` 플래그 → 번들 폴백 생략(:36-39), 1.5s 미이탈 배너 폴백. 비고: intent URL은 원본 hash(`#token=` 등) 잔존 시 `#Intent` 마커와 이중 fragment — Android 파서는 `#Intent;` 마커 탐색이라 통상 무해하나 e2e에서 확인 대상 | PASS |
| A-6 | [unit] | MyMusic ⋮ 양방향·아티스트 요약 is_default 우선 | Then ① 상호 배타: `actionTrack.is_public ? [차트에서 숨기기] : [차트에 업로드]`(:959-962 — 동시 노출 구조적 불가) ② 숨기기 = showAlert 2버튼 확인 → `PUT /tracks/{id} {is_public:false}` → 성공 시 로컬 즉시 갱신+fetchTracks 재동기화, 실패 시 서버 메시지 표출(:318-343) — 실패가 로컬 상태를 오염시키지 않음(성공 후에만 갱신 = 롤백 불요 구조) ③ 업로드 catch에 서버 에러 메시지 표출 보강(report_blinded 400 대응 :307-310) ④ 아티스트 요약 = `find(is_default) ?? 최신 생성 폴백`(:243-247) — ServerArtist.is_default 매핑 기존재(characterService.ts:85) | PASS |
| A-7 | [unit] | 대표 지정 팝업·배지·지정 액션 | Then ① ArtistResult: `justCreated && !artist.is_default && !defaultPromptShownRef.current`에서만 showAlert 팝업(:280) — 첫 아티스트(서버 자동 default=true) 생략·1회 가드 ref(:184) 충족, [대표로 지정]→`patchArtist(cid,{is_default:true})`(:290) 후 setServerArtist 갱신·실패 showAlert(앱 다이얼로그 관행 — 시스템 Alert 0) ② MyArtists: 대표 배지 isDefault 매핑(:123) 재사용 렌더(:420-424), 비대표+cid 보유 카드에만 "대표로 지정" 액션(:438-453 — 레거시 me 폴백 카드 제외), PATCH 성공 시 로컬 목록 상호 배타 갱신(:238 — 서버 규칙 동일 반영), settingDefaultId로 중복 PATCH 방지 ③ /character/me·PATCH 서버 응답 shape 대조(로컬 9004 사본 character.py:2347 virtual_character_id 등) 정합 | PASS |
| A-8 | [unit+실검증] | public/index.html — expo export 산출물 | Given `public/index.html` 신설(viewport-fit=cover·100dvh @supports 폴백·카카오 인라인 스크립트). When `npx expo export --platform web` 실행(exit 0) 후 dist/index.html 정독. Then viewport-fit=cover(:13)·100dvh(:33-37)·인라인 스크립트 반영 확인 — 그러나 **FAIL: 치환자 파손**. 근거: 2_housing/public/index.html:7 주석에 문자열 `%LANG_ISO_CODE%·%WEB_TITLE%`이 포함돼 있는데, expo 치환기는 `String.replace(문자열)` = **첫 1회만 치환**(node_modules/expo/node_modules/@expo/cli/build/src/start/server/webTemplate.js:80-81) → 주석이 치환을 소진, 실제 태그가 미치환 잔존: dist/index.html:9 `<html lang="%LANG_ISO_CODE%">`·:14 `<title>%WEB_TITLE%</title>` — 배포 시 브라우저 탭 제목이 문자 그대로 "%WEB_TITLE%"로 노출·lang 무효. 픽스 1줄: index.html:7 주석에서 `%` 기호 제거(예: "LANG_ISO_CODE·WEB_TITLE 치환") 후 재export 확인 | **FAIL** |
| A-9 | [unit] | MusicResult 가상 슬롯 폴백·characterId 정합 | Then ① 실사 시트 있음 = 현행(sheet_object_name/used_items + realCid :96-103) ② 실사 없음·가상 있음 = virtual_sheet_object_name/virtual_used_items 폴백 + characterId=virtualCid(:108-117) — /character/me가 두 필드+virtual_character_id 직렬화함(서버 사본 :2330-2347 확인) ③ 둘 다 없음 = snapshot 생략·cid만(:118-119) ④ 발매 페이로드 character_id = `store.artistCharacterId(작곡 시 선택 cid — MusicGenerationScreen:769·798 설정) || characterId`(:483·:564) — 가상 선택 cid가 발매까지 전달, 서버 _build_character_snapshot(kind 무관) 재조립 우선 커버 | PASS |
| A-10 | [unit] | `npx tsc --noEmit` + git diff 격리 | Then ① tsc exit 0·오류 0 ② 2_housing 변경 = 매트릭스 8파일(M) + 신설 4(webAudioElement·browserEnv·InAppEscapeBanner·public/index.html)에 한정, package.json/app.json hunk 0, services/audioMode.ts 무변경(매트릭스 '필요 범위' — 미필요 판정) ③ 타 트리(1_MV_wedding·0_platform_music) dirty = 기존 잔존분 그대로(이번 사이클發 hunk 0). 비고: 2_housing 루트 미추적 .md 4건(v39~v42 문서)은 이전 사이클 잔존물 — 코드 아님 | PASS |
| A-11 | [unit] | App.tsx 미니플레이어/탭바 웹 정합·LyricsPromptReview insets·래퍼 dvh | Then ① 미니플레이어 bottom = 웹 54(+insets.bottom)/네이티브 49+insets(:256-258) — 웹 탭바 54와 5px 겹침 해소 ② 웹 탭바 height 54+insets.bottom(:333 — viewport-fit 도입으로 insets 실값 대비) ③ LyricsPromptReview 모달 paddingBottom=`Math.max(40, insets.bottom+20)`(:316-318 — 기존 고정 40 하한 유지·회귀 무해) ④ 래퍼 app-shell/index.html:66-68 = 100vh 선언 유지 + 100dvh 덮어쓰기(미지원 브라우저 자동 폴백 — PC 전용 iframe) | PASS |

### S. 서버 스테이징 (server_staging_v3217) — 전부 PASS
| # | 태그 | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|---|
| S-1 | [unit/server] | voice_clone_service `_issue_short_audio_url` | Then ① `secrets.token_urlsafe(24)` 토큰 + 발급시각을 doc `audio_token_{kind}`/`audio_token_{kind}_issued_at`에 저장(:123-142) ② URL 형식 `https://api.maidol.ai.kr/api/voice-clone/audio/{clone_id}/{kind}/{token}` — 라우트 prefix(/api/voice-clone)+path와 문자 일치, _PUBLIC_API_BASE는 inst_service.py:51 선례와 동일 상수 ③ kind 화이트리스트 SHORT_URL_KINDS=(source,verify) 검증(:130-131) ④ 로그에 토큰 포함 URL 기록은 자체 발급 난수(시크릿 아님 — inst 선례 동일) | PASS |
| S-2 | [unit/server] | `_presign` 4곳 교체 완전성·환불 무변경 | Then ① _orig 4곳(:229 create·:356 submit_verify·:574 retry·:860 regenerate 폴백) 전부 `_issue_short_audio_url` 교체(신규 :264·:397·:616·:903) — 게이트웨이 전달용 `_presign(` 호출 잔존 grep 0(정의 :96과 302 라우트 내부 사용만) ② submit_verify는 Suno fetch 전 verify_object_name 선기록(302 라우트가 doc에서 읽는 순서 보장) ③ diff 전량(52+/9-) = VoiceFix 한정 — refund_clone_points(:1141~)·refunded 클레임·STATUS_FAILED 전이 환불 경로 hunk 0 | PASS |
| S-3 | [unit/server] | voice_clone.py 302 라우트 | Then ① `GET /audio/{clone_id}/{kind}/{token}`(:456-507, prefix 합성 = /api/voice-clone/audio/…) 무인증 — 보호는 `hmac.compare_digest` 토큰 대조(:479) ② kind∈{source,verify} 화이트리스트(:471) ③ 분기: 미존재 clone/토큰 불일치/오브젝트 부재 404 · 발급+PRESIGN_HOURS(24h) 초과 410(naive/aware datetime 양쪽 방어 :483-488) · presign 실패 502 · 성공 RedirectResponse 302(:507 — tracks.py inst-audio 패턴) ④ 파일 diff = 이 라우트 54줄뿐 ⑤ main.py diff = import 1줄+include_router 1줄 — 정확히 2줄 한정 | PASS |
| S-4 | [unit/server] | admin_health.py | Then ① 전 라우트 `Depends(get_admin_user)`(:395 — admin.py 관행 동일 import) ② 키 원문 미노출: 코드 grep — 키는 헤더 전달만(gemini도 x-goog-api-key 헤더 :140-142, URL 쿼리 0), 응답 detail = 크레딧/모델 수/쿼터/카운트/예외 클래스명뿐, _err_detail이 URL·키 비포함(:74-80) ③ Redis 10분 캐시 + force=true 우회(:404-412·:432-436), redis 불가 시 캐시 스킵 후 정상 동작 ④ active 12종(suno 크레딧·openai/anthropic/gemini/xai models·replicate account·S3 bucket_exists·SES get_account·PG/Mongo/Redis/ES) — 전부 무과금 확인 엔드포인트, settings 속성명 18종 _ref/config.py 전수 대조 일치 ⑤ passive 6종: kling/seedance = mv_jobs 24h video_model 집계(:246-257), voice validate = voice_clones 24h status/error_message 집계(⑤ 연동 :320-351), kits는 settings 미보유라 os.environ 직독(의도적) ⑥ 프로브별 wait_for(8+2s)·예외→fail 행 수렴(:379-389 — 1개 실패가 전체 응답을 죽이지 않음) ⑦ 참조 심볼 실존 확인: get_admin_user(auth.py:86)·ping_pg·get_es·get_redis·_get_ses_client(v3.207 배포 mailer.py:60) | PASS |
| S-5 | [unit/server] | py_compile·_orig/MD5SUMS·DEPLOY.md | Then ① `python3 -m py_compile` 4파일 전부 통과 ② _orig 3파일·배포본 4파일 md5 실측 = MD5SUMS.txt·DEPLOY.md 표와 7/7 전수 일치 ③ DEPLOY.md 완결: 배포 전 백업(§1)·**배포 직전 라이브 md5 재대조**(§2, drift 시 중단)·업로드(§3)·admin_web 통합 배포(§4)·docker build(§5)·검증 curl 7종(§6 — 302 라우트 404 확인·헬스 비인증 401/403·캐시 2연속 확인 포함)·**롤백**(§7 — 파일 원복+rebuild+데이터 무롤백 근거) 전부 포함, 키 원문 0 | PASS |

### W. 관리자 워크트리 (distracted-jennings-dc69d7/admin_web) — 전부 PASS
| # | 태그 | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|---|
| W-1 | [unit/admin] | 시스템 탭 배선·60s 폴링·빌드 | Then ① App.jsx /health Protected 라우트 + Health import, Layout.jsx MENU '시스템'(🩺) 1행, api.js getExternalHealth(force 시에만 ?force=true) — 3파일 diff가 이 배선에 한정 ② Health.jsx: active/passive 분리 표·상태 배지(ok/fail/unknown)·새로고침 버튼만 force=true·60s setInterval + 언마운트 clearInterval 가드(:65-69 — 페이지 오픈 중에만 폴링, 서버 10분 캐시라 실프로브 10분 1회) ③ formatDate는 Dashboard.jsx:5 export 재사용 ④ `npm run build` 재실행 통과(exit 0, dist 갱신) | PASS |

### 판정
**v3.217 1차 게이트 FAIL 1건 — 게이트 미통과(픽스 1줄 후 재판정 요망)**: A-8 public/index.html 치환자 파손(주석 속 `%LANG_ISO_CODE%·%WEB_TITLE%` 문자열이 expo의 첫 1회 치환을 소진 → dist `<title>%WEB_TITLE%</title>`·`<html lang="%LANG_ISO_CODE%">` 잔존 — 웹 배포 시 탭 제목 문자 그대로 노출). 픽스 = public/index.html:7 주석에서 % 기호 제거 후 `npx expo export --platform web` 재실행으로 dist/index.html의 lang·title 실치환 + viewport-fit·100dvh 유지 확인. 그 외 17항목 전부 PASS — A-8 픽스 확인 시 즉시 통과 가능.

이월(2차 게이트, 배포 후 — [api]/[e2e→실기기/배포후]):
- [api/스테이징→배포후] `GET /api/voice-clone/audio/{id}/{kind}/{token}` 302 실측(무효 토큰 404·유효 토큰 Location=presigned), `GET /api/admin/health/external` 200(suno detail 크레딧 수치)·force/캐시 2연속·비인증 401/403.
- [실험·사용자 승인 후] 실패 source의 짧은 302 URL로 voice/validate 1회 확증(크레딧 전후 대조) — 반증 시 게이트웨이 장애 판정 절차(PLAN ⑤).
- [e2e→실기기(iOS 사파리 web)] 화면꺼짐 중 재생 유지·ended 곡 전환 실판정(개선 후에도 보장 불가 — 판정 기록), 하단 시트 9곳 툴바 미가림(④), 잠금화면 메타 곡 전환 추종, 담기/큐 시트.
- [e2e→실기기(인앱)] 카카오톡 링크 진입 자동 탈출(또는 1.5s 배너 폴백), Android 기타 인앱 Chrome intent 버튼(hash 보존 실확인 — A-5 비고), iOS 기타 인앱 Safari 안내.
- [e2e→배포후(web)] 차트 숨기기→차트 즉시 소멸→재공개 복귀, 가상 아티스트 신규 발매→스타일링 탭 착장 표시(기존 곡 미소급 확인), 보이스 샘플 등록→awaiting_verify 완주·⭐ 과금/실패 환불 회귀.
- [admin→배포후] 시스템 탭 실렌더·새로고침(force)·suno 크레딧 표시·기존 탭 회귀.

## v3.219 (2026-09-24) — 1차 게이트(유닛·정적): 작업실 말풍선 아티스트 우선화 + 5개 디렉터 작업 중 상태 보존 — 정독 검증 + 판정

전제: 앱(2_housing) 단독·서버 무변경 — 로컬 정독 + tsc 실측만, 원격은 읽기(로그인 시도 1회)뿐. 기준 = PLAN v3.219 스펙 + 변경 매트릭스 10파일(CoverGenerationScreen은 hunk 0 확인이 곧 판정). [e2e]는 2차 게이트(웹/실기기)로 이월(하단 명기). 작업트리에 v3.217 미커밋분 병존 — 격리는 A-12에서 v3.219 추적자(마커) 단위로 판정.

### A. 앱 (2_housing) — 12항목 전부 PASS
| # | 태그 | 항목 | 시나리오(Given/When/Then)·근거 | 판정 |
|---|---|---|---|---|
| A-1 | [unit] | ① 말풍선 — hasArtistCharacter 3상태·체인 선두 artist | Then ① `useState<boolean | null>(null)`(MapScreen.tsx:247) — null=조회 전, focus 시 /character/me 실측으로 true/false 확정(:385-403, 실패·게스트 false) ② 체인 = `null→null(유보) / false→'artist' / true→기존 (!lyricsDone?'lyricist':!musicDone?'composer':'image')`(:665-674) — 스펙 문자 일치, 고정 artist 아님(기본안 1) ③ isNext=`user && d.type===nextActionDirector && !isResting`(:722) — null이면 전 디렉터 불일치 = 펄스·배지 미렌더(보유자 깜빡임 방지), 게스트(user 게이트)·휴식(!isResting) 현행 유지 ④ Dialogue 파라미터 `hasArtist: hasArtistCharacter === true`(:651) — boolean 유지(3상태 누출 0) ⑤ `[NextAction]` 로그(:676-685). 비고: null 중 아티스트 디렉터 직접 탭 시 hasArtist=false 전달은 기존(초기 false)과 동일 — 회귀 아님 | PASS |
| A-2 | [unit] | lyricsStore — draft 필드·partialize 봉합·reset | Then ① draftStep/draftChat 추가(lyricsStore.ts:34-36)·initialState 0/[](:81-82)·세터(:112-113) ② partialize에 draftStep/draftChat(:132) + **generatedPrompt**(:129 — 기존 누락 부수 결함 봉합, 게이트 8) 포함 ③ `reset: () => set(initialState)`(:116) — initialState가 draft 필드 포함 = 발매 reset() 2곳(MusicResult :525·:592)이 draft까지 클리어 ④ persist name 'aidol-lyrics-draft' 무변경(기존 저장분 승계) | PASS |
| A-3 | [unit] | LyricsInputScreen — hydrate·setStyle 스킵·'처음부터 다시' | Then ① hasResumableDraft = draftStep>0 && draftChat.length>0(:121, 마운트 스냅샷 useRef) → step/chatHistory hydrate(:122-127) ② durationLabel 역산 = DURATION_LABEL_BY_SEC[duration](:111-114·:131-133) ③ 진입 setStyle('')은 `if (!hasResumableDraft)` 가드로 복원 시 스킵(:149) ④ 미러링 effect [step, chatHistory] → setDraftStep/setDraftChat(:155-159) — persist 경유 핫리로드 생존(2026-09-07 정책) ⑤ '처음부터 다시' = store.reset()+setStyle('')(진입 초기화와 동치)+로컬 전부 초기화(:162-171), 복원 안내 버블 인라인 액션(:416-427 — 기본안 4) ⑥ processAnswer/재선택은 버블 접기 1줄 외 hunk 0 — 답변 기록·프롬프트 생성 경로 무변경 | PASS |
| A-4 | [unit] | characterTaskStore — persist partialize draft만 | Then ① persist(name 'maidol-artist-draft', AsyncStorage) 래핑 + `partialize: (s) => ({ draft: s.draft })`(:169-172) — **파일 URI(photoUri·styleImageUri 등) 미포함 grep 확인**: ArtistDraft 타입 자체가 텍스트/enum 9필드뿐(step·chat·qIndex·styleAnswers·currentInput·selectedKind·pendingConceptText·targetCharacterId·forceKind — :14-32), photoUri는 화면 로컬 state 잔류 ② setDraft/clearDraft(:138-139) ③ reset()에 draft:null 포함(:163 — legacyContract 유지 주석 현행) | PASS |
| A-5 | [unit] | ArtistInputScreen — 키 검증·v3.105 우선·reset 승계 | Then ① 마운트 판정(:161-180): restoreParam이면 draft 스킵(v3.105 '이어서 만들기' 우선 — 회귀 0), targetCharacterId/forceKind 불일치면 clearDraft 폐기(:166-176), 사용자 진행 없는 draft 미복원 ② hydrate: step/chat/qIndex/styleAnswers/currentInput/selectedKind/pendingConceptText(:184-231), style 스텝 복원 시 loadStyleSamples 재로드(:243 — 파일/네트워크 상태 미보존 보완) ③ 미러링은 사용자 진행 시에만 + 키 동봉(:249-263) ④ '처음부터' = clearDraft+초기 상태(:267-283) ⑤ 생성 성공 클리어 = ArtistResultScreen taskStore.reset() 4곳(:502·:614·:645·:686 실측 잔존) 승계 — reset()이 draft 포함(A-4) ⑥ canResume(restore/apiError → 의상 재개) 로직 hunk 0(:630-637). 비고: apiError 재진입 + draft 병존 시 draft가 Q&A/화풍 단계 복원 → welcome 한정 렌더인 '이어서 만들기' 버튼 미노출 가능 — 입력물(conceptText) 보존·전진 경로 유지라 데이터 유실 없음, 실기기 확인 이월 | PASS |
| A-6 | [unit·최대 리스크] | MusicGenerationScreen — composeDraft hydrate·마운트 초기화 분기 | Then ① resumeDraft = lyricsKey 일치 + 사용자 진행 있을 때만(:124-129) — lyricsKey는 lyrics_id 우선·해시 폴백·instrumental 전용키(:101-115), ComposeLyricsPick handlePick/연주곡이 lyricsSource·lyrics를 확정 세팅(ComposeLyricsPickScreen:190-238)해 다른 가사 진입 = 키 불일치 → 폐기 ② **마운트 artistCharacterId 강제 초기화는 새 대화 분기에서만**: 복원 분기는 `setArtistCharacterId(draftAnswers.artistCharacterId)` 스냅샷 복원 후 return(:236-250), 새 대화 분기만 불일치 draft 폐기 + setArtistCharacterId(null)(:251-263) — v3.156a 전제와 양립 ③ personaDefaultAppliedRef = `useRef(!!resumeDraft)`(:197) — 복원 시 step 12 클론 기본 선택 재적용 금지(:444-445 소비 확인) ④ 답변 28필드 전수 hydrate(editedTitle~artistCharacterId :141-213) ⑤ 미러링 [chatHistory, step, editedTitle, editedLyrics] 단일 스냅샷 + lyricsKey 재계산(:266-303) ⑥ '처음부터'(:307-345) = clearComposeDraft+setArtistCharacterId(null)+rewind/repick/persona ref·전 로컬 답변 초기화 — 마운트 새 대화 분기와 동치(전수 대조: styleDesc·customVocalInput은 선언만 있는 미사용 state라 제외 무해) ⑦ commitExchange/handleUserBubbleTap은 배너 접기 1줄 외 hunk 0 — 되감기(rewindRef)·비파괴 치환 회귀 0. 비고: 슬라이더 단독 변경은 다음 대화 커밋 시 스냅샷 반영(모든 확정이 commitExchange 경유라 실질 무손실) | PASS |
| A-7 | [unit] | 발매 클리어 지점·coverStyle 비영속(재차감 차단) | Then ① clearComposeDraft = MusicResultScreen **:526(직접 발매)·:594(커버 경유 발매)** — 두 곳 모두 lyricsStore.reset() 직후 동일 지점(스펙 문자 일치) ② musicStore persist **미도입 실측**: grep persist/AsyncStorage = 주석 2건뿐(musicStore.ts:26·:75) — coverStyle·coverTrackId 포함 전 필드 메모리 전용 = 앱 재시작 시 hasPendingGeneration(CoverGenerationScreen:133-134 hunk 0) 자동 재생성·재차감 경로 원천 부재(F3(b)) ③ CoverGenerationScreen.tsx 자체 git diff 0(A-9 ②와 동일 근거) | PASS |
| A-8 | [unit] | VideoDirectorScreen — 트랙 실측 검증·making/done 제외·sticky | Then ① resumeDraft 필터: 사용자 진행 + `step !== 'making' && step !== 'done'`(:90-95) + 미러링 effect도 making/done 조기 return(:230-241) — 이중 차단으로 생성 중 상태가 draft에 안 실림 = 재진입 무한 스피너·자동 재생성(재차감) 원천 차단, 복원점은 항상 생성 직전 선택 단계 ② 트랙 실측 검증: 목록 로드 후 find 실패 시 clearVideoDraft+초기화(:206-218 — 삭제 곡 404 방지), 존재 시 전체 스냅샷 교체 ③ 저장 성공(:564)·공유 성공(:591) clearVideoDraft — **videoStylePrefs는 별도 slice로 미클리어** = 스타일 sticky 유지(:243-254 미러링, 14필드 전수) ④ '처음부터'도 draft만 폐기·스타일 유지(:257-264) ⑤ 생성(making) 진입·폴링·롤백(handleEditChoice) 로직 hunk = 배너 접기 1줄뿐 | PASS |
| A-9 | [unit] | [DraftKeep] logout 청소·커버 흐름 hunk 0 | Then ① authStore.logout(:159-171): characterTaskStore.reset() + clearComposeDraft + clearVideoDraft + clearCoverContext — **lyricsStore 미청소(기본안 3 — 가사=사용자 생성물 보존)**, try/catch로 로그아웃 본체 무영향, `[DraftKeep]` 로그 ② store 신설 clearCoverContext(musicStore.ts:311-322)는 CoverGenerationScreen 로컬 clearCoverContext(:186-198)와 9필드 문자 동일(coverTrackId/Title/Style/CharacterObjectName/Messages/Step/ExtrasSnapshot/LyricsExcerpt/LyricsId) ③ CoverGenerationScreen.tsx diff 0줄 — 커버 흐름(v3.202 H-⑤ 보존·성공 클리어·pending 이어보기) 무접촉 ④ 게스트 재진입: logout 청소 + MapScreen user 게이트로 말풍선 미표시 | PASS |
| A-10 | [unit] | 5개 흐름 정상 완주 경로 회귀 — diff 정독 | Then 10파일 diff 전량 정독: 추가분 = draft 판정/hydrate/미러링/클리어/안내 버블·'처음부터'뿐, 기존 완주 경로의 변경 = ⑴ 작사 processAnswer·프롬프트 생성 무변경 ⑵ 아티스트 pushUser 래핑(버블 접기 1줄)·Cody 진입/생성/저장 무변경 ⑶ 작곡 commitExchange 선두 1줄·발매 핸들러는 클리어 추가뿐(보상·세션 종료 순서 무변경) ⑷ 커버 diff 0 ⑸ 영상 저장/공유 성공 후행에 클리어 추가뿐 — 완주 시 도달 상태 = 기존 + draft null(의도된 차이)로 동작 등가. 미러링·hydrate는 전부 기존 로컬 state의 사본 왕복이라 값 변형 0 | PASS |
| A-11 | [unit] | `npx tsc --noEmit` | Then exit 0·오류 0(2_housing 전체 — draft 타입·3상태 유니온·persist 래핑 포함 컴파일 무결) | PASS |
| A-12 | [unit] | git diff 격리(10파일 한정) | Then ① v3.219 추적자([NextAction]/[LyricsDraft]/[ArtistDraft]/[ComposeDraft]/[VideoDraft]/[DraftKeep]) 함유 hunk = 매트릭스 10파일에만 존재 ② 그 외 2_housing dirty 9파일(App.tsx·playback.ts·PlayerScreen·MyMusicScreen·MyArtistsScreen·ArtistResultScreen·LyricsPromptReviewScreen + TrackActionSheet·TutorialOverlay)은 마커 0 전수 확인 — 전부 v3.217 미커밋분(TESTPLAN v3.217 A-10 기재 매트릭스와 일치)·오케스트레이터 명시 기존재분 ③ MusicResultScreen만 양 사이클 hunk 병존(v3.217 가상 폴백 + v3.219 클리어 2줄 — 양쪽 매트릭스 모두 포함, 정상) ④ untracked(public/·InAppEscapeBanner=v3.217, 문서·scratchpad)·타 트리(1_MV_wedding·0_platform_music) dirty = 사이클 이전 잔존 그대로 — 이번 사이클發 오염 0 | PASS |

### 판정
**v3.219 1차 게이트 통과** — 12항목 전부 PASS, FAIL 0. 필수 게이트 1~8 전수 충족(말풍선 3상태·작사 draft persist·아티스트 partialize 격리·작곡 마운트 분기·영상 making 제외·logout 청소·tsc/격리·generatedPrompt 봉합).

이월(2차 게이트 — [e2e→웹/실기기], PLAN test-designer 7~9 승계):
- [e2e→웹] **실 draft 복원 1케이스 실측 시도 결과**: 로컬 웹서버 http://localhost:8090 가동 확인(200). 그러나 테스트 계정 webtest4_v3217@maidol.co.kr 토큰 발급 실패 — API 로그인이 팀 관행 비밀번호로 401(1회 시도 후 중단·추가 시도 없음, 계정 비밀번호 재확인 필요) → **이월**. 재시도 시: API 로그인 토큰 → /#token= 진입 → 작사 3답 → 탭 이탈 → 복귀 시 대화·진행도 복원 + '처음부터 다시' 버블 확인.
- [e2e] 정상 완주 5종(아티스트/작사/작곡/커버/영상) 각각 "도중 뒤로가기→재진입 이어가기"·"탭 이동→복귀" 끼워 완주(PLAN 7) — 발매 후 draft·lyricsStore 동시 클리어 실확인.
- [e2e] 핫리로드/앱 재시작: 작사 draft 생존(2026-09-07 재현), 아티스트 텍스트 답변 생존(AsyncStorage), 커버 pending 자동 재생성 1회·재차감 없음(PLAN 8).
- [e2e] 말풍선 실표시: 신규 계정 → 아티스트 디렉터 → 생성 완료 후 작사 이동, 보유 계정 진입 깜빡임 없음(PLAN 9).
- [실기기] A-5 비고(apiError 재진입 시 draft 복원과 '이어서 만들기' 버튼 관계) 실동작 확인.

## v3.220 (2026-09-24) — 1차 게이트(유닛·정적): 앨범 탭바 유지(숨김 탭 이식) + 알림·메시지 미니플레이어 숨김 + 카카오톡 라벨 + '스타' ⭐ 병용 — 정독 검증 + 판정

전제: 앱(2_housing) 단독·서버 무변경. 기준 = PLAN v3.220 섹션 + 구현 12파일(커밋 37a2304 이후 작업 트리 diff — App.tsx·AlbumDetailScreen·ChartScreen·MyMusicScreen·UserChannelScreen·AppShareModal·SettingsScreen·ArtistLoadingScreen·VideoDirectorScreen·MyArtistsScreen·DirectorLineupScreen·FeedCard). 정독 + grep 전수 + tsc 실측만, 파일 무수정·원격 무접촉. [e2e]는 2차 게이트(웹/실기기)로 이월(하단 명기). 사용자 결정사안 4건 전부 기본안 적용 확인.

### A. 앱 (2_housing) — 12항목 전부 PASS
| # | 태그 | 항목 | 시나리오(Given/When/Then)·근거 | 판정 |
|---|---|---|---|---|
| A-1 | [unit] | ① AlbumDetail 소속 이전 — RootStack 제거·숨김 탭 등록·ParamList 정리 | Then ⑴ RootStack.Screen AlbumDetail 등록 grep 0(App.tsx:650은 이관 주석만 잔존)·RootStackParamList의 `AlbumDetail:` 항목 제거(:167-168 주석으로 대체, 타 파일 RootStackParamList['AlbumDetail'] 참조 grep 0) ⑵ MainTabs 숨김 탭 신설(:432-452): `tabBarButton: () => null`+`tabBarItemStyle:{display:'none'}` — MyMusic 선례(:411-412)와 문자 동일 규격 ⑶ 헤더 = headerShown+AppText subtitle '앨범'+bg.deepest+headerShadowVisible:false — 구 stackHeader 시각 규격 승계, ← 는 BackIcon(차트 고정) 대신 `exitAlbum(navigation, route.params)`(:445 — 탭 goBack이 firstRoute로 떨어지는 문제의 명시 처리) ⑷ AlbumDetailScreen 명명 export `exitAlbum` import(:100) 배선 정합 | PASS |
| A-2 | [unit] | ① exitAlbum 4분기 + 내부 goBack 3곳 치환 완전성 | Then ⑴ exitAlbum(AlbumDetailScreen.tsx:39-47): from='UserChannel'&&fromParams → `navigate('UserChannel', fromParams)` 재push(탭 내부→RootStack 버블링 — 채널 복귀), from='MyMusic' → 'MyMusic'(숨김 탭), 그 외/결측 → 'Chart' 폴백 — 스펙 4분기 문자 일치, fromParams 결측 시 Chart 안전 폴백 ⑵ 내부 이탈 3곳 전부 exitAlbum 경유: 조회 실패(:121)·앨범 삭제(:179)·마지막 트랙 제거(:250) ⑶ `goBack` grep = 주석 1건(:35)뿐 — 코드 잔존 0 ⑷ `[AlbumNav]` 로그(:41). 비고(경미·비게이트): fetchAlbum useCallback deps=[albumId,navigation]이 route.params를 클로저 포획 — 동일 albumId를 다른 origin에서 재진입 후 "조회 실패" 시에만 이전 from으로 이탈하는 이론적 엣지(에러 경로 한정·정상 동선 무영향, 실기기 확인 이월) | PASS |
| A-3 | [unit] | ① 잔상 방지 리셋 ↔ focus 재조회 병존 정합 | Then ⑴ `useEffect([albumId])`(:93-98) = setAlbum(null)·setLoading(true)·setManageMode(false) — 스펙 3필드 정확 일치 ⑵ useFocusEffect(fetchAlbum, dep=[albumId,navigation] :117-128) 현행 유지 — albumId 변경 시: 리셋(잔상 제거)+focus 재조회 1회 / AI 커버 확정 goBack 복귀 시: albumId 불변 → 리셋 미발화·focus 재조회만 → 커버 갱신 경로 보존(기존 회귀 무결) ⑶ 동일 albumId 재진입 시 리셋 없음 = 이전 데이터 표시 후 재조회 — PLAN 허용 동작 | PASS |
| A-4 | [unit] | ① 진입 5콜사이트 전환 완전성 | Then 전수 grep: 구 호출(`getParent()?.navigate('AlbumDetail'`) 잔존 0, from 누락 navigate 0. ⑴ ChartScreen:215(휴면 앨범곡 분기 — from:'Chart' 부여, PLAN 명시 충족)·:315(최신앨범) ⑵ MyMusicScreen:852(앨범행)·:954(생성 직후 onCreated) — getParent 제거+탭 형제 navigate+from:'MyMusic' ⑶ UserChannelScreen:144-147 — `navigate('MainTabs',{screen:'AlbumDetail',params:{albumId,from:'UserChannel',fromParams:{authorId,name}}})` 중첩 형식, authorId·name은 route.params 스코프 실존(:39) ⑷ 5곳 전부 매 진입 albumId+from 전체 전달(머지 의존 0)·`[AlbumNav]` 로그 동반 | PASS |
| A-5 | [unit] | ② HIDE_MINIPLAYER_ROUTES 확대 — 렌더 게이트만 | Then ⑴ `['Settings','AudioSpike','Notifications','DmInbox','DmChat']`(App.tsx:559) — 기존 2개 유지+3개 추가 정확 일치, v3.220 사유 주석(:558) ⑵ 라우트명 실존 대조: DmInbox(:617)·Notifications(:618)·DmChat(:620)·Settings(:627)·AudioSpike(:660) — 오타 0, getCurrentRoute 최심 라우트 매칭 정합 ⑶ 소비처 = 렌더 게이트 1곳뿐(:663 MiniPlayerWrapper 조건부) — playerStore·재생 로직 diff 0(12파일에 playerStore 미포함) = 재생 유지 보장 ⑷ AlbumDetail은 목록 미포함 — 앨범 화면 미니플레이어 표시 유지(탭바 위 안착으로 F1 허공 결함 해소 설계) | PASS |
| A-6 | [unit] | ③ 카카오톡 라벨 | Then ⑴ AppShareModal.tsx:17 `{ key:'kakao', label:'카카오톡' }` — key 무변경·라벨만 단축 ⑵ 전앱 '카카오톡으로 공유' grep 0(주석 :2도 동기화) ⑶ handleShare('kakao') 분기·네이티브 공유 시트 위임 hunk 0 — 동작 불변 | PASS |
| A-7 | [unit] | ④ 치환 매트릭스 12행 전건 문자열 실측 | Then 전행 grep 실측 일치: MyMusicScreen:391 '차감된 스타(⭐)는 환불'·:466 '스타(⭐)가 부족해요'(뒤 '스타를 모아보세요' 유지 = R2 첫 언급만)·:492 '⭐50 추가 증정' / SettingsScreen:188 '⭐10을 드렸어요'(타이틀 기⭐ R3) / ArtistLoadingScreen:534·VideoDirectorScreen:546·DirectorLineupScreen:84 '스타(⭐)가 부족해요' / MyArtistsScreen:258·:335 타이틀 2건(본문 기⭐ R3) / AppShareModal:91 '⭐50을 받아요'+'⭐50 추가 증정'(R1×2) / FeedCard:267 '⭐50 추가 증정'. 수량 표기 잔존(`스타 [0-9]`) 전앱 grep 0 — R1 전건 소화. PLAN 표의 파일:라인(:372·:447·:473·:525)은 v3.219 병존으로 시프트 — 문자열 기준 전건 대사 완료 | PASS |
| A-8 | [unit] | ④ 오매칭 제외 규칙 + R3 무변경 존 | Then ⑴ 제외 5종 무변경 실측: HomeHeaderActions:102 a11y '스타 안내' 원형·ArtistCodyScreen:535·540 '스타킹'(프롬프트) 원형·levels.ts:20 '톱스타' 원형·currency.ts CURRENCY='스타' 원형 — 4파일 git diff 0 ⑵ '스타일*' 계열 변경 0(12파일 diff 정독 — 치환은 재화 문맥만) ⑶ R3 존(ChartScreen:340 기병기·GuestQueueNoticeModal·AttendanceModal·TrackShareDownloadSheet·StarGuideModal) = 12파일 외 미접촉으로 무변경 보장 | PASS |
| A-9 | [unit] | ④ 튜토리얼 문안 = PLAN 결정사안 4 기본안 | Then ChartScreen:38 title '⭐ 스타'(기본안 '스타'→'⭐ 스타' 정확 일치)+desc '잔여 스타(⭐)와 스타 받는 방법…'(R2 첫 언급만 병기), :39·:40 desc '스타(⭐)를 받아보세요' 2건 — PLAN 매트릭스 3행 문자 일치. :41 이후(알림·DM·마이페이지) 무변경 — v3.213 "문안=사용자 원문" 이력과의 충돌은 결정사안 4 기본안 채택으로 해소(미지시 시 기본안 진행 규칙) | PASS |
| A-10 | [unit] | 회귀 — Player·AlbumCoverGeneration 버블링·MyMusic 숨김 탭·⋮ 2택 상호작용 | Then ⑴ AlbumDetailScreen 내 RootStack 화면 navigate 3종: Player(:136)·AlbumCoverGeneration(:325)·UserChannel(:390) — 탭 내부→RootStack 버블링(react-navigation 표준), tsc 무오류로 타입 정합. 복귀 시 MainTabs 마지막 활성 탭=AlbumDetail 유지(AI 커버 확정 goBack→focus 재조회 A-3 연동) ⑵ MyMusic 숨김 탭(:407-427) hunk 0 — BackIcon(차트 고정)·⚙️ 진입 무영향 ⑶ v3.221 ⋮ 다운로드 2택은 트랙행 시트(TrackShareDownloadSheet — 커밋분·미접촉), 앨범행(:849-867)은 ⋮ 없이 chevron-right+onPress만 — 상호작용면 부재 확인 ⑷ 딥링크 linking config 무접촉(AlbumDetail 미등록 현행) ⑸ Android 하드웨어 back = backBehavior 기본(firstRoute→차트) 문서화 수용 — 전역 변경 없음 확인 | PASS |
| A-11 | [unit] | `npx tsc --noEmit` | Then exit 0·오류 0줄(2_housing 전체 — RootStackParamList 항목 제거·명명 export·중첩 navigate 포함 컴파일 무결) | PASS |
| A-12 | [unit] | git diff 격리(12파일 한정) | Then ⑴ 커밋 37a2304 이후 2_housing 변경(M) = 정확히 매트릭스 12파일 — 그 외 tracked 파일 hunk 0(stores·playerStore·CoverGenerationScreen 등 무접촉) ⑵ untracked = 사이클 이전 잔존물뿐(MAIDOL_to_AIDOL 로드맵 v42 문서 1건 + scratchpad 프로브·이미지 — 코드 아님, 이번 사이클發 신규 0) ⑶ 타 트리(1_MV_wedding·0_platform_music) dirty = 기존 잔존 그대로 — 이번 사이클發 오염 0 | PASS |

### 판정
**v3.220 1차 게이트 통과** — 12항목 전부 PASS, FAIL 0. 필수 게이트 1~7 전수 충족(① 숨김 탭 이식·exitAlbum·5콜사이트, ② HIDE 5라우트 렌더 게이트만, ③ 라벨, ④ 매트릭스 12행+제외 규칙+튜토리얼 기본안, 회귀 3종, tsc·격리). 비고 1건(A-2 — fetchAlbum 에러 경로의 route.params 스테일 클로저, 동일 앨범 교차 origin 재진입+조회 실패 시에만 발현하는 이론적 엣지)은 비게이트 관찰 사항으로 실기기 확인 이월.

이월(2차 게이트 — [e2e→웹/실기기], PLAN test-designer 7~10 승계):
- [e2e] ① 앨범 진입 5경로 실조작: 차트 최신앨범·(모킹)앨범곡·마이페이지 앨범행·생성 직후·채널 앨범 — 하단 탭바 실표시 + ← 복귀(차트/마이페이지/채널 재push) + 곡 재생(Player 모달)→닫기→탭바 유지. Android 하드웨어 back(앨범→차트 착지) 문서 스모크. 앨범 A→B 교차 진입 잔상 없음·AI 커버 확정 복귀 커버 갱신.
- [e2e] ① 앨범 화면 미니플레이어가 탭바 바로 위 안착(허공 결함 해소 육안), 하단 탭 5개 터치 즉시 이탈.
- [e2e] ② 재생 중 알림·메시지·채팅방 진입 시 미니플레이어 미표시+재생 지속(음 끊김 0)·이탈 시 재노출, DmChat 키보드 미간섭, 백그라운드·잠금화면 컨트롤 유지. 표시 화면 회귀(차트·플레이리스트·피드·검색·작업실·마이페이지·AlbumDetail).
- [e2e] ③ 추천하기 시트 '카카오톡' 라벨 육안 + 공유 시트 기동. ④ ⭐ 표기 육안(iOS·Android·웹 각 1회 스모크 — 기존 ⭐ 리터럴 다수라 저위험).
- [실기기] A-2 비고 엣지(동일 앨범 교차 origin 재진입 후 조회 실패 시 이탈 방향) 실동작 확인.

## v3.222 + v3.223 (2026-09-24) — 1차 게이트(유닛·정적): ① 영상 디렉터 프리셋 진입 헤더 ② Inst 진행 화면(ComposerLoadingView 추출·InstLoading) ③ A/B 시크(서버 — 프런트 무변경) + v3.223 재생목록 보존(append 통일·하이드레이션 대기) — 시나리오 + 판정

전제: 앱(2_housing) 기준 = PLAN v3.222(:5131~)·v3.223 섹션 + 구현 12파일(커밋 65a9eb2 이후 작업 트리 — 수정 10: App.tsx·AlbumDetailScreen·ChartScreen·FeedDetailScreen·FeedScreen·MusicLoadingScreen·MyMusicScreen·VideoDirectorScreen·services/playback.ts·stores/playerStore.ts, 신규 2: components/ComposerLoadingView.tsx·screens/InstLoadingScreen.tsx). 정독 + grep 전수 + tsc + **node 유닛 하니스 실측**(sucrase 트랜스파일, AsyncStorage·expo-av 스텁 — 실 zustand 5.0.12 persist·실 @react-navigation/routers 7.5.3 StackRouter 구동). 파일 무수정(TESTPLAN 제외)·원격 무접촉. v3.222 ③ 서버 generate.py Range는 배포 완료 — [api] 실측은 이월.
하니스(세션 scratchpad): u/t_store.js(playerStore 18건) · u/t_hyd.js(하이드레이션 대기 8건) · u/t_play.js(playTrackNow 5건+관찰 1) · router_probe*.js(StackRouter 전이 실측).

### A. v3.222 ① 영상 디렉터 프리셋 진입 헤더
| # | 태그 | 항목 | 시나리오(Given/When/Then)·근거 | 판정 |
|---|---|---|---|---|
| B-1 | [unit] | initial:false 중첩 navigate → [Map, VideoDirector] 적재 | Given Studio 미방문 세션 When MyMusic ⋮ 다운로드→'영상'(MyMusicScreen.tsx:305-308 `params:{screen:'VideoDirector', initial:false, params:{initialTrackId}}`) Then core useNavigationBuilder.tsx:284(getStateFromParams — initial:false면 params 상태 미사용)·:530-545(getInitialState=[Map])·:683(initial===false&&첫 초기화 시 navigate 디스패치) 경로 확인 + StackRouter 실측 `Map > VideoDirector`. Map 마운트 → useLayoutEffect(MapScreen.tsx:443-472) 엔터명 타이틀 주입(focus 불요) | PASS |
| B-2 | [unit] | VideoDirector focus headerLeft 주입 — Dialogue :105-120 관행 대조 | Then VideoDirectorScreen.tsx:171-187 useFocusEffect(useCallback([navigation])) → `getParent()?.setOptions({headerLeft})` — TouchableOpacity marginLeft:12·Feather arrow-left 22·colors.text.primary·a11y "작업실로 돌아가기" = DialogueScreen.tsx:104-119와 1:1(차이는 onPress만 goBack→navigate('Map')). blur cleanup 없음 = v3.201(C) 불변식 준수(클리어는 MapScreen.tsx:477-481 focus 전담). setOptions 대상 = Tab의 Studio 라우트 옵션뿐 → 타 탭 헤더 오염 없음. `[VideoDirector]` 로그 1줄 | PASS |
| B-3 | [unit] | ← 동작 = RN7 NAVIGATE 전이 실측(스펙 전제 검증) | Given 스택 [Map,Dialogue,VD] / [Map,VD] When ← `navigation.navigate('Map')`(VideoDirectorScreen.tsx:178) Then StackRouter.tsx:371-382(현재≠대상·pop 미지정 → 기존 라우트 미탐색)·:442-452(push) — 실측 `Map > Dialogue > VideoDirector > Map` / `Map > VideoDirector > Map`. **PLAN 전제 "중간 Dialogue까지 pop"은 RN6 의미론 — RN7에선 push**(대조: `popTo('Map')`·`navigate('Map',undefined,{pop:true})` → `Map`). 화면상 작업실 복귀는 성립하나 VD(+Dialogue) 인스턴스가 하부에 잔존·왕복마다 누적·Android HW back이 VD로 복귀. 비교: 구 정상 진입 ←(Dialogue 클로저 goBack, source=Dialogue)은 실측 `Map > VideoDirector`(Dialogue만 제거, VD 잔류 = 가시 무반응)로 원래 결함 — 따라서 **가시 회귀는 아님**(개선), 스택 누적은 C-9 FAIL에 병합 판정 | PASS(비고 — 조치는 C-9) |
| B-4 | [unit] | 정상 진입 회귀 — 프리셋 로직·배너·tabPress | Then VideoDirectorScreen 변경 hunk = :167-187 헤더 블록 1개뿐 — 프리셋 선곡/비공개 안내/videoDraft 클리어·복원 배너 로직 hunk 0. App.tsx Studio tabPress(:397-399) hunk 0. 정상 진입 시 Dialogue 주입 화살표를 VD focus가 덮어씀(마지막 focus 승) — 목적지 Map 단일화(결정 1 기본안) | PASS |

### B. v3.222 ② Inst 진행 화면
| # | 태그 | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|---|
| C-1 | [unit] | ComposerLoadingView 추출 = MusicLoading 동작 등가(로직 hunk 0) | Then MusicLoadingScreen diff hunk 6개 = import 정리(:1-11·:27)·pulseAnim 선언/effect 제거(:49·:72-93 → 컴포넌트 :40-62로 이동, 파라미터 동일 1.1/800ms/inOut)·렌더 치환(:351-411)·styles 삭제(:415-540) — 생성·폴링·429 재시도·resume·replace(MusicResult)·4s 전진(:45-50)·progress 점프(:53-61) hunk 0. styles 텍스트 diff = 미사용 `container` 1키만 차이(참조 grep 0), 나머지 20키 바이트 동일. 렌더: steps[safeIndex].message·스텝 state(done/active/pending)·✓·`progress>0` 게이트·노트 문안 동일(noteText Math.min 클램프는 messageIndex≤4 불변식하 등가) | PASS |
| C-2 | [unit] | InstLoading 5스텝·4s 전진·status 점프 | Then INST_STEPS 5종(InstLoadingScreen.tsx:27-33 제출→보컬 분리→오디오 받기→정규화→발매 = 결정 3 기본안). 4s interval phase==='loading'만(:80-86, 마지막 단계 캡). processing → `max(i,1)`(:110-112 = ≥2단계), completed → index 4 + phase 'done'(:113-117), pending 무변 | PASS |
| C-3 | [unit] | 5s 폴링·10분 타임아웃·일시 오류 지속 | Then 즉시 1회 + setInterval 5000(:129-130), 10분 경과 시 clearInterval+'timeout'(:98-103 — 문안 :320 = 구 MyMusic :400 문안 동일), catch 시 폴링 지속(:123-126). mounted 가드(:100·:107) | PASS |
| C-4 | [unit] | resume 모드 = 폴링만·중복 POST 없음 | Then InstLoading 내 requestInstrumental/POST 호출 grep 0 — 화면 자체가 생성 요청을 하지 않음(POST는 MyMusic confirmCreateInstrumental 1곳 :469). resume 플래그는 로그 용도(:95)·즉시 1회 확인으로 이미 완료면 바로 완료 카드 | PASS |
| C-5 | [unit] | failed 환불 문안·completed 미리듣기 | Then failed → `data.error || 'Inst. 생성에 실패했어요. 차감된 스타(⭐)는 환불됩니다.'`(:120 = 구 :391 문안 동일)+[돌아가기]. completed → result_track_id(:116) → `${BACKEND_BASE_URL}/api/tracks/stream-proxy/{id}`(:142 — PlayerScreen:562·MusicResult:210 동일 규약) → expo-av createAsync(shouldPlay:false) + Slider(:257-269) — isSeekingRef 드래그 중 status 미덮어쓰기(:153)·seekValue 버퍼·onSlidingComplete setPositionAsync(:209-219)·`disabled={!seekable}`(duration>0) = MusicResult v3.204 패턴 동형. result_track_id 결측 시 플레이어 생략·완료 카드 유지 | PASS |
| C-6 | [unit] | 언마운트 정리(인터벌·사운드) | Then 스텝 interval cleanup(:85), 폴링 cleanup mounted=false+clearInterval(:131-134), 사운드 effect cleanup unloadAsync(:170-175), createAsync 진행 중 언마운트 시 즉시 unload(:159-162), goMyPage 선 unload(:222-229). **언마운트 경로의 정리 코드 자체는 완비** — 단 이탈 경로가 언마운트를 일으키지 않는 문제는 C-9 | PASS |
| C-7 | [unit] | App.tsx 라우트 등록·타입 | Then import(:77-78)·StudioStackParamList `InstLoading: { trackId: string; title?: string; resume?: boolean }`(:127-128)·`<StudioStack.Screen name="InstLoading">`(:233-234, gestureEnabled 기본 = 이탈 자유). goInstLoading 전달 params 3필드와 타입 일치 | PASS |
| C-8 | [unit] | MyMusic 폴링 이관·진입 배선·분기 불변 | Then ⑴ pollInstrumental while 루프 grep 0, reconcileInstBusy(:393-419 — busy 트랙만 status 1회, completed/failed 시 busy 해제+fetchTracks(true))·useFocusEffect(:421-425, user 게이트). fetchTracks(:121) 선언이 reconcile(:393)보다 앞 — TDZ 없음. instBusyRef 미러로 재구독 없음 ⑵ 202 → goInstLoading(trackId,title)(:472, initial:false :381-383) ⑶ 409 job 형상 → busy true + resume:true(:497-499), 409 existing_track_id 분기·402·404·429 쿨다운·기타 오류 문안 hunk 0, handleCreateInstrumental 쿨다운 선게이트(:429-450) hunk 0 ⑷ ⋮ 진행 중 제외 조건(:372-373 `!instBusy[id]`) 유지 | PASS |
| C-9 | [unit] | **이탈 경로 누수 — ←/돌아가기가 InstLoading을 언마운트하지 않음** | Given 완료 카드에서 미리듣기 재생 중 When ←(InstLoadingScreen.tsx:68) 또는 [돌아가기](:303) = `navigation.navigate('Map')` Then RN7 StackRouter 실측 `Map > InstLoading > Map`(push — B-3 동일 근거 StackRouter.tsx:371-382·:442-452) → InstLoading 미언마운트 → C-6 cleanup 미실행 → **미리듣기 오디오가 정지 수단 없이 계속 재생**(미니플레이어는 이 Sound를 모름), 로딩 중 이탈 시 폴링도 10분까지 지속. 탭 전환 이탈도 blur 정지 없음(useFocusEffect cleanup 부재). 부수: VD ←(VideoDirectorScreen.tsx:178)도 동일 push로 왕복마다 VD 인스턴스 누적 | **FAIL** |
| C-10 | [unit] | **같은 InstLoading 인스턴스 재사용 시 상태 잔존** | Given Inst A 완료(phase 'done') → [마이페이지에서 보기](:222-230 = Tab navigate — Studio 스택 [Map, InstLoading(A)] 포커스 유지) When 곡 B에 Inst 만들기 → goInstLoading(B)(MyMusicScreen.tsx:377-386) Then StackRouter.tsx:374-376 "현재 라우트와 이름 같으면 그 라우트 재사용" — 실측 `sameKey=true`, params만 B로 교체 → phase·resultTrackId·errorMsg·messageIndex(:44-47) 리셋 없음, 폴링 effect deps=[trackId](:135)만 재시작 → **"B (Inst.) 완성!" 카드 + A 음원 미리듣기가 B 진행 중에 표시**(B 완료 전까지). 동일 트랙 재시도(A 실패 → 탭 이탈 → 재요청)는 trackId 불변이라 폴링 재시작조차 없음 → '실패' 카드 고착 | **FAIL** |

### C. v3.222 ③ A/B 시크(프런트)
| # | 태그 | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|---|
| D-1 | [unit] | 프런트 무변경 | Then `git diff 65a9eb2 -- screens/MusicResultScreen.tsx` 0줄 — v3.204 Slider·seekable 게이트 그대로(서버 Range 배포로 duration 확정 시 활성화 전제) | PASS |

### D. v3.223 재생목록 보존
| # | 태그 | 항목 | 시나리오·근거 | 판정 |
|---|---|---|---|---|
| E-1 | [unit] | playTrackNow mode 기본 append | 하니스 t_play.js(실 playerStore): P1 큐 [1,2,3]+곡9 → [1,2,3,9]·idx 3·track 9·loadAndPlayTrack(9) / P1b 보관함 queue 4·currentIndex 3 동기 / P2 중복 곡 2(+queue 인자 [7,8]) → 추가 없음·idx 1 재생(append는 queue 인자 무시) / P3 replace [7,8]→idx 1 / P4 replace 무큐→[track]. 구현 playback.ts:720-745 — 차트 관행(ChartScreen.tsx:219-222 addToQueue→findIndex→인덱스 재생)과 동형 | PASS(5/5) |
| E-2 | [unit] | 호출부 5곳 전환 | Then FeedScreen.tsx:204·FeedDetailScreen.tsx:124·MyMusicScreen.tsx:623 `playTrackNow(track)`(append 기본), AlbumDetailScreen.tsx:130-140 playFrom addToQueue+인덱스, ChartScreen.tsx:227-237 검색 탭 addToQueue+인덱스(searchResults 통째 교체 제거). 'replace' 호출자 0 — PlaylistScreen.tsx:204 setQueue(플레이리스트=교체) diff 0 의도적 잔존. playback.ts:702 setQueue는 커버 보강 map(동일 큐 — 무해) | PASS |
| E-3 | [unit] | **setQueue 잔존 grep — 곡 단위 탭 암묵 교체 3곳 누락** | Then 전수 grep `setQueue(`: PLAN F2 "교체 호출부 전수"에 없던 곡 단위 탭 3곳이 여전히 화면 리스트로 큐 교체 → setQueue→saveOwnerQueue로 계정 보관함 덮어쓰기(A1 결함 그대로): ⑴ **SearchScreen.tsx:166-168** handlePress `setQueue(results)` — 하단 '검색' 탭(App.tsx:384-385) 주 동선 ⑵ UserChannelScreen.tsx:133-137 playTrack `setQueue(queue)` ⑶ ArtistDetailScreen.tsx:106-110 handleTrackPress `setQueue(tracks)`. 구현은 PLAN 5곳과 일치하나 PLAN 열거 누락 — "곡 하나 재생 = 보관함 파괴" 경로 잔존 | **FAIL** |
| E-4 | [unit] | restoreQueueFor 빈 큐 저장 스킵·playTrackAtIndex 저장 | 하니스 t_store.js 18/18 PASS: 비회원 add/playTrackAtIndex 미저장, 보관 無+큐 2곡 승계 저장, owner add/dup 거부/playTrackAtIndex(idx·track 스냅샷)/setCurrentIndex/reorder/remove 저장, 범위 밖 인덱스 no-op, resetOnLogout 저장→초기화·guestNoticeAck 유지, 보관 有 복원(isPlaying·sessionActive false), **보관 無+빈 큐 → savedQueues 키 미생성(U6a)·하이드레이션 전 {} 경합 모사에서도 u1 미기록(U6c)**, claimQueue 승계 | PASS |
| E-5 | [unit] | App.tsx hasHydrated 대기 + 2s 폴백 | 하니스 t_hyd.js 8/8 PASS(App.tsx:585-601 원문 추출 실행): H1 hydrated → 즉시 1회·구독 0 / H2 미하이드 → 대기, onFinishHydration → 1회+unsub 1회, 2s 타이머 후 중복 0 / H3 이벤트 부재 → 2000ms 폴백 1회+unsub / H4 이벤트 2회 → 1회(done 게이트) / **H5 실 zustand persist(AsyncStorage 150ms 지연): 시작 hasHydrated=false → 대기 후 restoreQueueFor=true·3곡 복원**. useEffect 호출부(:611) webOAuthTokenPending 게이트 유지 | PASS |
| E-6 | [unit] | 불변 5종 diff 0 | Then ⑴ 미니 게이트: components/MiniPlayer.tsx diff 0·HIDE_MINIPLAYER_ROUTES(App.tsx:565) 무변 ⑵ partialize: playerStore diff hunk 2개(:167·:185)뿐 — 하니스 U8 키 = savedQueues·shuffle·repeat·guestNoticeAck ⑶ claimQueue hunk 0(U7 동작 확인) ⑷ 게스트 모달: TrackActionSheet.tsx·PlayerScreen.tsx diff 0 ⑸ 미디어세션: playback.ts hunk 2개 모두 playTrackNow(:713-745) — :121-149 hunk 0. authStore.ts diff 0 | PASS |

### E. 공통
| # | 태그 | 항목 | 근거 | 판정 |
|---|---|---|---|---|
| F-1 | [unit] | `npx tsc --noEmit` | 2_housing 전체 오류 0줄(35s) | PASS |
| F-2 | [unit] | diff 격리 12파일 | Then 65a9eb2 이후 2_housing tracked 변경 = 정확히 수정 10 + 신규 2(ComposerLoadingView 09-24 11:49·InstLoadingScreen 11:51). 그 외 untracked = 사이클 이전 문서(v39~v42 md, mtime 07~08월)·scratchpad뿐 | PASS |

### 비게이트 관찰(기록)
- O-1 id 타입 혼재: addToQueue 중복 판정은 `t.id === track.id`(엄격), playTrackNow는 String 비교 → number 1 큐에 "1" 탭 시 중복 추가·기존 인덱스 재생(t_play P5 실측 queue=[1,"1"]). 기존 부채이나 append 통일로 노출 확대 — 필요 시 addToQueue String 정규화.
- O-2 웹 OAuth 실패 후행 복원(App.tsx:524)은 하이드레이션 대기 헬퍼 미경유 — restoreQueueFor 빈 큐 스킵(E-4)이 방어하므로 무해.
- O-3 initial:false로 Studio 최초 마운트 시 Map 마운트 부수효과(MapScreen.tsx:494-506 가상 팬덤 리포트 alert, 24h due 시)가 VD/InstLoading 위에 뜰 수 있음 — e2e 육안 확인.
- O-4 Studio tabPress `navigate('Studio',{screen:'Map'})`(App.tsx:397-399)도 RN7에선 push(core useNavigationBuilder.tsx:699-705 pop 미지정) — 기존 부채, C-9와 동일 근원(백로그).
- O-5 InstLoading 미리듣기는 전역 플레이어를 정지시키지 않음(MusicResult 동일 관행) — 동시 재생 가능성 e2e 확인.

### 판정
**v3.222·223 1차 게이트 미통과** — 23항목 중 PASS 20 · FAIL 3.
- **C-9 FAIL** (v3.222① ②): InstLoadingScreen.tsx:68·:303, VideoDirectorScreen.tsx:178 `navigation.navigate('Map')` = RN7에서 push → InstLoading 미언마운트로 미리듣기 오디오 고아 재생·폴링 지속, VD 왕복 누적. 권고: 세 곳 `navigation.popTo('Map')`(실측 → `Map`) + InstLoading useFocusEffect cleanup에서 미리듣기 pauseAsync(탭 전환 대비).
- **C-10 FAIL** (v3.222②): InstLoadingScreen.tsx:44-47·:90-135 — 동일 라우트 재사용 시 phase/resultTrackId/errorMsg/messageIndex 미리셋. 권고: goInstLoading에 요청 nonce(예: `req: Date.now()`) 추가 + 폴링 effect deps [trackId, req] 진입부에서 상태 초기화(setPhase('loading')·setMessageIndex(0)·setResultTrackId(null)·setErrorMsg(null)·기존 사운드 unload), 또는 StudioStack InstLoading에 `getId={({params}) => params?.req}`로 신규 push.
- **E-3 FAIL** (v3.223①): SearchScreen.tsx:166-168 · UserChannelScreen.tsx:133-137 · ArtistDetailScreen.tsx:106-110 곡 단위 탭 setQueue 잔존 — PLAN 열거 누락(replan: 3곳 append 치환, 차트 관행 동형). 앨범 곡과 동일하게 결정 1 성격이므로 교체 유지 원하면 사용자 결정으로 명시 필요.
재시험 범위: 수정 후 C-9·C-10·E-3 + B-2/B-3(popTo 전이 재실측)·E-2 grep·tsc·격리.

이월(2차 게이트 — [e2e→웹/실기기]·[api]):
- [api] v3.222 ③ generate stream Range 실측(206·Content-Range·Accept-Ranges·무Range 200+Content-Length·불량 416·variant=1·타 사용자 403·inline) — 배포 완료분, 이번 게이트 범위 외.
- [e2e] ① 마이페이지 ⋮ 다운로드→영상: Studio 미방문/기방문 2케이스 헤더 엔터명+← 존재, ← → 작업실(수정 후 스택 [Map] 확인), 정상 진입(Map→Dialogue→VD) ←·videoDraft 배너·비공개 곡 안내·작업실 tabPress.
- [e2e] ② Inst 진행 화면 실완주(⭐ 과금 — 사용자 승인 후): 1~5 스텝·완료 카드 미리듣기 재생·시크·[마이페이지에서 보기]→"<원제> (Inst.)" 목록, 이탈 후 재요청 409→resume, 실패 환불 문안, 연속 2곡 Inst(C-10 재현 시나리오), ← 시 오디오 정지(C-9).
- [e2e] ③ A/B 화면 버전 A·B 재생바 드래그 시크(iOS·Android·웹)·카드 탭 vs 슬라이더 제스처 경합·seek LISTEN 1회.
- [e2e] v3.223 재생목록 보존: 로그인→담기 3곡→강제종료→재시작(자동 로그인)→차트 '내 재생목록' 3곡(자동 재생·미니 노출 없음)→피드/앨범/검색 곡 재생→3곡+1곡(교체 아님)→재시작→4곡 유지, 로그아웃/재로그인·계정 A/B 전환·가입 claimQueue, 비회원 재시작 폐기, 플레이리스트=교체, 미니 이전/다음·웹 미디어세션 next/prev·관련곡 이어듣기.

### 재검증 (2026-09-24, 1차 게이트 FAIL 3건 픽스 — C-9·C-10·E-3 + O-1)
전제: 앱 작업 트리(2_housing) 픽스 반영분 정독 + grep + tsc + node 하니스 재실측. 파일 무수정(TESTPLAN 제외)·원격 무접촉.
하니스(세션 scratchpad): **router_probe3.js**(App.tsx getId 원문 추출 eval + 실 StackRouter 7.5.3 — 12/12) · **u/t_e3.js**(Search·UserChannel·ArtistDetail·Chart 검색 탭 핸들러 원문 구간 추출 실행, 실 playerStore — 28/28) · 기존 u/t_store.js 18/18 · u/t_hyd.js 8/8 · u/t_play.js 5/5(+P5 관찰 → queue=[1]로 해소).

| # | 태그 | 항목 | 재검증 근거 | 판정 |
|---|---|---|---|---|
| C-9 | [unit] | 이탈 경로 언마운트 | InstLoadingScreen.tsx:63-66 `backToMap = popTo('Map')` 공용 → 헤더 ←(:78)·실패 [돌아가기](:331) 모두 경유, 파일 내 `navigate('Map')` 0. VideoDirectorScreen.tsx:176-187 headerLeft onPress `popTo('Map')`(:181). 실측 R1 `[Map,InstLoading] → popTo → Map`(대조 R1b navigate = `Map > InstLoading > Map` 구 결함 재현), R3f 누적 `[Map,Inst(A),Inst(B)] → Map`. 언마운트 → C-6 cleanup(폴링 mounted=false+clearInterval :157-160, 사운드 unload :198-203) 실행 경로 확보. 탭 전환 대비: useFocusEffect(:71-95) cleanup에서 soundRef pauseAsync + setIsPlaying(false) — 헤더 클리어는 건드리지 않음(v3.201 불변식 유지). blur 중 로드 완료 사운드는 shouldPlay:false라 무음 | **PASS** |
| C-10 | [unit] | 동일 인스턴스 재사용 상태 잔존 | App.tsx:127 `nonce?: string`, :234-238 `getId={({ params }) => params?.nonce ?? params?.trackId}`. MyMusicScreen.tsx:377-389 goInstLoading 매 호출 `nonce=String(Date.now())` — 202(:474)·409 resume(:501) 공통 경유. 실측 R3 top=Inst(A/n1)+navigate(B/n2) → **새 key push**(StackRouter.tsx:365-370 getId findLast 미일치 → :443-452), R3b 같은 nonce → 기존 key 재사용, R3c 동일 트랙 재시도(새 nonce) → 새 key(실패 카드 고착 해소), R3d nonce 결측 → trackId 폴백, R3e(대조) getId 없음 → 같은 key 재사용(구 결함 재현). 이중 방어: 폴링 effect deps `[trackId, nonce]`(:163) 진입부 phase/resultTrackId/errorMsg/messageIndex/isPlaying/position/duration 초기화(:111-117) — phase 변경으로 사운드 effect cleanup(unload) 연쇄 | **PASS** |
| E-3 | [unit] | 곡 단위 탭 setQueue 잔존 | SearchScreen.tsx:166-172 handlePress · UserChannelScreen.tsx:134-142 playTrack(track) · ArtistDetailScreen.tsx:106-114 handleTrackPress → `addToQueue` + String findIndex + `setCurrentIndex` + navigate('Player',{track}) = 차트 관행(ChartScreen.tsx:218-224) 1:1. 하니스 t_e3 각 핸들러 원문 실행: 보관함 [1,2,3]+곡9 → `[1,2,3,9]`·idx3·Player(track9)·savedQueues.u1 4곡/idx3 저장, 중복 곡2 → 추가 없음·idx1, [1]+"1" → 이중 추가 없음·idx0, 빈 큐 → [5]·idx0. 핸들러 구간 내 setQueue 0 | **PASS**(4×7) |
| B-2 | [unit] | VD headerLeft 재확인 | 아이콘·marginLeft 12·a11y "작업실로 돌아가기"·blur cleanup 없음 불변, onPress만 popTo('Map')로 교체 | PASS |
| B-3 | [unit] | popTo 전이 재실측 | R2 `[Map,Dialogue,VD] → popTo → Map`, R2b 프리셋 `[Map,VD] → Map`, R2c(O-4 누적) `[Map,Dialogue,Map,VD] → Map > Dialogue > Map`(가장 가까운 Map까지 — 무해). 1차 비고(VD·Dialogue 하부 잔존·누적) **해소** | PASS |
| E-2 | [unit] | setQueue 잔존 전수 grep | `setQueue(` = PlaylistScreen.tsx:204(플레이리스트=교체, v3.36 의도적 잔존) · playback.ts:702(커버 보강 map — 동일 큐) · playback.ts:728(playTrackNow 'replace' 분기 — 호출자 0) 3곳뿐. 곡 단위 탭 경로 0. playTrackNow 호출부 FeedScreen:204·FeedDetailScreen:124·MyMusicScreen:625 모두 append 기본 | PASS |
| O-1 | [unit] | id 타입 혼재 | playerStore.ts:99-100 `String(t?.id) === String(track.id)`. t_e3: addToQueue [1]+"1"=false·+2=true·+"2"=false·무 id 거부. ChartScreen 엄격 findIndex 잔존 0(:221·:232 String 2곳). t_play P5 → `queue=[1] currentIndex=0`(1차 [1,"1"] 해소) | PASS(해소) |
| F-1 | [unit] | `npx tsc --noEmit` | 오류 0줄(EXIT 0, 38.6s) | PASS |
| F-2 | [unit] | diff 격리 | 65a9eb2 이후 2_housing tracked 변경 13 + 신규 2 = 15 = 1차 12파일 + 픽스 추가 3(SearchScreen·UserChannelScreen·ArtistDetailScreen; ChartScreen·playerStore는 기존 집합 내 hunk 추가). 전부 mtime 09-24 12:07~12:09 픽스 창. 그 외 untracked = 사이클 이전 문서 md·scratchpad뿐 | PASS |
| R-1 | [unit] | 회귀: UserChannel 호출부 시그니처 | playTrack(track) 1인자 — 호출부 3곳 :202(피드 트랙 블록 `b.track`)·:302(발매곡 `t`)·:371(아티스트 곡 `t`) 모두 1인자, 제거된 `queue` 지역변수 참조 0(tsc 0). `!track?.id` 가드 유지 | PASS |
| R-2 | [unit] | 회귀: 검색 탭 기존 동작 | SearchScreen handlePress 호출부 :191(결과 행)·:308(onPlay) 불변, CTR 로깅 `/tracks/search/click`(:162-165) hunk 0, navigate('Player',{track:t}) 유지 — 재생 진입 보존(PlayerScreen.tsx:739 routeTrack 우선 재생 — 구 경로와 동일 소비). 차이는 큐가 results 교체 → append 뿐(의도) | PASS |

#### 비게이트 관찰(재검증 추가)
- **O-6 범위 밖 `navigate('Map')` 4곳 판정**(router_probe3 OBS 실측):
  - ArtistInputScreen.tsx:298 헤더 ‹ — 무조건 `navigate('Map')`. 진입 = Dialogue 액션 `navigate:ArtistInput`(DialogueScreen.tsx:184·:288) 또는 MyArtists(:310-311·:330) push → 실측 `Map > Dialogue > ArtistInput → … > ArtistInput > Map` / `Map > MyArtists > ArtistInput > Map`. **C-9와 동일 push 결함**(ArtistInput·Dialogue 하부 잔존·왕복 누적·Android HW back 복귀). 오디오 없음 → 가시 피해는 스택 누적뿐.
  - ArtistCodyScreen.tsx:656 헤더 ‹ else 분기(returnToCover 아님) — ArtistInput/ArtistResult `replace('ArtistCody')`로 `[Map,Dialogue,ArtistCody]` → 실측 `… > ArtistCody > Map`. **C-9와 동일 push 결함**(:634 주석이 언급한 "Cody가 stack에 남는" 증상의 동일 근원).
  - ArtistResultScreen.tsx:506 저장 완료 확인 else 분기 · MyArtistsScreen.tsx:212 handleBack else 분기 — `canGoBack()===false`(스택 단일 라우트 + 부모 Tab back 불가)에서만 도달 → 스택에 Map이 **없는** 루트 상태 폴백이라 C-9(기존 Map 위 중복 push)와 **다른 경우**. 실측 `ArtistResult → ArtistResult > Map`(popTo였다면 `Map` 대체 — 하부 잔존 차이만). 정상 경로(ArtistResult popToTop `Map > Dialogue > ArtistResult → Map`, MyArtists goBack)는 무결. 루트 도달 가능 경로: MyMusicScreen.tsx:268-269 Studio 미마운트 시 선행 navigate(Map)로 방어됨 → 실질 저위험.
  - 권고(백로그, 이번 게이트 범위 외): ArtistInput:298·ArtistCody:656 → `popTo('Map')`. 동근원 O-4(App.tsx:405 tabPress)·MyMusicScreen.tsx:268 `navigate('Studio',{screen:'Map'})`도 중첩 NAVIGATE(pop 미지정) push.
- O-7 getId=nonce 부수: [마이페이지에서 보기](Tab navigate — 언마운트 없음) 또는 탭 전환 이탈 후 새 Inst 요청 시 이전 InstLoading 인스턴스가 하부에 잔존(R3 `Map > Inst(A) > Inst(B)`). 사운드는 goMyPage unload·blur pause로 무음, 완료/실패 인스턴스는 폴링 정지 — 로딩 중 이탈분만 10분 상한 백그라운드 폴링(구 MyMusic 백그라운드 폴링과 동등). ← 한 번(popTo)으로 전부 정리 → 게이트 무영향, e2e에서 HW back 시 이전 카드 노출 여부만 육안 확인.

#### 재검증 판정
**v3.222·223 1차 게이트 통과** — 1차 FAIL 3건(C-9·C-10·E-3) 전부 PASS, 재확인 B-2·B-3·E-2·O-1·F-1·F-2 PASS, 회귀 R-1·R-2 PASS(하니스 합계 71/71: router_probe3 12 · t_e3 28 · t_store 18 · t_hyd 8 · t_play 5). 2차 게이트([e2e]·[api]) 이월 목록은 위 1차 판정 블록 그대로 유효 — ② Inst e2e에 "← 시 오디오 정지·스택 [Map]", "연속 2곡 Inst 시 B 진행 카드 깨끗", "탭 전환 시 미리듣기 pause" 확인 포함.
