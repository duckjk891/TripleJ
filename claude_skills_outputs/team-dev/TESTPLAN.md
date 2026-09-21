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
