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
