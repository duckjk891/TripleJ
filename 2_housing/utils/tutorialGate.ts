// [TutorialGate] v3.207 ⑪ — 튜토리얼 "완전 최초 접속자 한정" first-run 게이트.
// 사용자 원문: "완전 최초 접속자만. 2번 이상 접속한 사람은 해당 안 되" = 기존 유저 완전 차단.
// 판별 근거(F1 실측): 최초 실행 판정 로직이 전무하고, auth 토큰은 로그아웃 시 삭제돼 단독 부적합.
//   비회원 재생만 해도 zustand persist 키가 생기므로 "진짜 신규 설치 = AsyncStorage 완전 빈 상태"가
//   유일하게 신뢰 가능한 신호 → getAllKeys() 기반 마이그레이션.
// 동작:
// - 마커 `maidol_first_run_v1` 존재 → 그 값('fresh'|'existing') 사용 (앱 업데이트 후 재판별 방지).
// - 마커 미존재 → getAllKeys(): 튜토리얼 키(seen/마커) 제외 키가 1개라도 있으면 'existing'
//   (기존 유저 — 화면별 seen 키 6종을 일괄 선기록해 어떤 화면에서도 자동 노출을 차단),
//   완전 빈 스토리지면 'fresh' (신규 설치 — 화면별 최초 1회 노출 허용).
// - 읽기/쓰기 실패 → status null(미확정) = 자동 노출 금지 (현행 보수 기본값 계승).
// App.tsx 부팅 시 1회 호출(가능한 이른 시점 — persist 키 생성 전)하고, TutorialOverlay도
// 자체적으로 재호출한다(멱등 — 결과 promise 메모이즈라 레이스 없음).
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FIRST_RUN_KEY = 'maidol_first_run_v1';
export const TUTORIAL_SEEN_KEY_PREFIX = 'maidol_tutorial_seen_v1:';
// TutorialOverlay를 쓰는 전 화면 screenKey — 기존 유저 마이그레이션 시 일괄 seen 처리 대상
const TUTORIAL_SCREEN_KEYS = ['player', 'chart', 'feed', 'playlist', 'search', 'map'] as const;

export type FirstRunStatus = 'fresh' | 'existing';

let status: FirstRunStatus | null = null;
let initPromise: Promise<FirstRunStatus | null> | null = null;

/** 부팅 1회(App.tsx)·오버레이에서 호출 — 멱등. 미확정(null)이면 자동 노출 금지. */
export function initTutorialGate(): Promise<FirstRunStatus | null> {
  if (!initPromise) {
    initPromise = (async (): Promise<FirstRunStatus | null> => {
      try {
        const marker = await AsyncStorage.getItem(FIRST_RUN_KEY);
        if (marker === 'fresh' || marker === 'existing') {
          status = marker;
          if (__DEV__) console.info('[TutorialGate] 마커 존재', { status });
          return status;
        }
        const keys = await AsyncStorage.getAllKeys();
        // 튜토리얼 자체 키(seen/마커)는 판별에서 제외 — 그 외 키가 하나라도 있으면 기존 유저
        const foreign = keys.filter(
          (k) => k !== FIRST_RUN_KEY && !k.startsWith(TUTORIAL_SEEN_KEY_PREFIX)
        );
        if (foreign.length > 0) {
          status = 'existing';
          // 기존 유저 마이그레이션: 전 화면 seen 선기록 + 마커 확정 (재보기 경로까지 원천 차단)
          await AsyncStorage.multiSet([
            [FIRST_RUN_KEY, 'existing'],
            ...TUTORIAL_SCREEN_KEYS.map(
              (k) => [TUTORIAL_SEEN_KEY_PREFIX + k, '1'] as [string, string]
            ),
          ]);
          if (__DEV__)
            console.info('[TutorialGate] 기존 유저 판정 — 튜토리얼 차단', {
              foreignKeyCount: foreign.length,
            });
        } else {
          status = 'fresh';
          await AsyncStorage.setItem(FIRST_RUN_KEY, 'fresh');
          if (__DEV__) console.info('[TutorialGate] 신규 설치 판정 — 화면별 최초 1회 노출');
        }
        return status;
      } catch (err: any) {
        console.error('[TutorialGate] first-run 판별 실패 — 미확정(자동 노출 금지)', {
          message: err?.message,
        });
        status = null;
        return null;
      }
    })();
  }
  return initPromise;
}

/** 판별 완료 전엔 null (동기 조회용 — 오버레이는 promise 기반 initTutorialGate를 쓴다) */
export function getFirstRunStatus(): FirstRunStatus | null {
  return status;
}
