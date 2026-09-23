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
// v3.216b F9 — 계정 기반 seen: 로그인 사용자는 서버(GET/POST /api/tutorial/seen)에 열람을
// 저장·동기화한다. 기기 localStorage 기준이라 웹은 브라우저/기기가 바뀔 때마다 "다시 최초"가
// 되던 문제의 해소(사용자 요구 "최초 앱 실행했을때, 최초 가입했을때만").
// 비로그인은 현행 기기 기준 유지. 서버 미배포/실패 시 기기 기준으로 자동 폴백한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

/**
 * [TutorialGate] v3.213 리뷰 모드 스위치 — 이 상수 한 곳이 유일한 전환 지점.
 * - true(현재): 사용자 검수용 상시 노출 — first-run 게이트·seen 키를 무시하고
 *   화면 포커스(진입)마다 튜토리얼을 다시 보여준다.
 *   (화면별 로그인 게이팅(TutorialOverlay enabled prop)은 리뷰 모드에서도 유효 —
 *   로그인/비로그인 상태별로 검수할 수 있어야 하기 때문)
 * - false: v3.211 first-run 정책 완전 복귀 — 완전 최초 설치('fresh')만 + 화면·상태별 1회.
 *   "가입 후 최초 사용" 요건은 로그인 게이팅과 first-run의 결합으로 자연 충족된다
 *   (로그인 전엔 enabled=false라 seen 미소모 → 가입 후 첫 진입에 노출).
 * 전환 방법: 검수 완료 후 아래 값을 false로 바꾸는 1줄이 전부다(다른 코드 수정 불필요).
 */
export const TUTORIAL_REVIEW_MODE = false; // v3.215: 검수 완료 — first-run 정책 복귀(최초 설치+가입 후 최초만)

export const FIRST_RUN_KEY = 'maidol_first_run_v1';
export const TUTORIAL_SEEN_KEY_PREFIX = 'maidol_tutorial_seen_v1:';
// TutorialOverlay를 쓰는 전 화면 screenKey — 기존 유저 마이그레이션 시 일괄 seen 처리 대상
// v3.213: 'playlist' 제거(플레이리스트 튜토리얼 폐지)·'topbar' 추가(차트 화면 상단바 오버레이 2호)
const TUTORIAL_SCREEN_KEYS = ['player', 'chart', 'feed', 'search', 'map', 'topbar'] as const;

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

// ── v3.216b F9: 계정 기반 seen (서버 동기화) ─────────────────────────────────
// 상태 머신: idle(비로그인/미시작) → pending(GET 중) → synced(성공) | failed(실패 — 기기 폴백).
// TutorialOverlay가 구독(subscribeTutorialSeenSync)해 전환 시 노출 판정을 재평가한다.
export type ServerSeenSyncState = 'idle' | 'pending' | 'synced' | 'failed';

let serverSeenState: ServerSeenSyncState = 'idle';
let serverSeen = new Set<string>();
let serverSyncPromise: Promise<void> | null = null;
const syncListeners = new Set<() => void>();

function notifySeenSync() {
  syncListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

/** 동기화 상태 전환 구독 — 해제 함수 반환 */
export function subscribeTutorialSeenSync(fn: () => void): () => void {
  syncListeners.add(fn);
  return () => {
    syncListeners.delete(fn);
  };
}

export function getServerSeenSyncState(): ServerSeenSyncState {
  return serverSeenState;
}

/** 계정 기준 열람 여부 — synced 상태에서만 의미 있다 */
export function isSeenOnServer(screenKey: string): boolean {
  return serverSeen.has(screenKey);
}

/**
 * 로그인 시 호출(App.tsx user 전환 이펙트 + 오버레이 안전망) — 서버 seen을 받아 메모리
 * 캐시 + 로컬 seen 키에 반영(서버 우선). 진행 중 재호출은 같은 promise를 공유(단일 비행).
 * 엔드포인트 부재(404)·네트워크 실패 → 'failed' = 기기 기준 폴백(오버레이가 처리).
 */
export function syncTutorialSeenFromServer(): Promise<void> {
  if (serverSyncPromise) return serverSyncPromise;
  serverSeenState = 'pending';
  notifySeenSync();
  serverSyncPromise = (async () => {
    try {
      const res = await api.get('/tutorial/seen');
      const list: string[] = Array.isArray(res.data?.seen)
        ? res.data.seen.filter((s: unknown): s is string => typeof s === 'string')
        : [];
      serverSeen = new Set(list);
      serverSeenState = 'synced';
      // 서버 seen → 로컬 반영: 오프라인 재부팅·비로그인 화면(chart)에도 일관 차단
      if (list.length) {
        AsyncStorage.multiSet(
          list.map((k) => [TUTORIAL_SEEN_KEY_PREFIX + k, '1'] as [string, string])
        ).catch(() => {
          console.error('[TutorialGate] 서버 seen 로컬 반영 실패');
        });
      }
      if (__DEV__) console.info('[TutorialGate] 서버 seen 동기화', { count: list.length });
    } catch (err: any) {
      serverSeenState = 'failed';
      console.error('[TutorialGate] 서버 seen 동기화 실패 — 기기 기준 폴백', {
        status: err?.response?.status,
      });
    } finally {
      serverSyncPromise = null;
      notifySeenSync();
    }
  })();
  return serverSyncPromise;
}

/** 로그아웃 시 호출 — 계정 캐시 폐기(다음 로그인 계정과 섞임 방지) */
export function clearServerTutorialSeen(): void {
  serverSeen = new Set();
  serverSeenState = 'idle';
  notifySeenSync();
}

/**
 * 튜토리얼 닫힘(done/skip) 기록 — 로컬 + (로그인 시) 서버 양쪽. 서버 반영은 낙관
 * (메모리 선반영 → POST 실패해도 세션 내 재노출 없음, 다음 동기화에서 최종 일관).
 */
export function recordTutorialSeen(screenKey: string): void {
  AsyncStorage.setItem(TUTORIAL_SEEN_KEY_PREFIX + screenKey, '1').catch(() => {
    console.error('[TutorialGate] seen 로컬 기록 실패', { screenKey });
  });
  if (!useAuthStore.getState().user) return;
  serverSeen.add(screenKey);
  api.post('/tutorial/seen', { screen: screenKey }).catch((err: any) => {
    console.error('[TutorialGate] seen 서버 기록 실패', {
      screenKey,
      status: err?.response?.status,
    });
  });
}
