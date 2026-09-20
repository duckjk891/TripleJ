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
