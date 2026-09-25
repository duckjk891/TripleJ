/**
 * v3.233 보호자 설정 즉시 반영 — 어린이 계정만 포그라운드 복귀·DM 진입 때 /auth/me 를 조용히 다시 읽어
 * kids_permissions(보호자 허용)·kids_restricted 를 store 에 병합한다.
 *
 * 보호자 관리 페이지는 "자녀 앱에 바로 적용" 이라 안내하지만 앱은 로그인·재시작·설정 편집 때만 /auth/me 를
 * 읽었다 → 허용을 켜도 재시작 전까지 친구 DM·글쓰기 버튼이 안 보이던 문제(tester 버그 3).
 *
 * 원칙
 * - 대상: 현재 사용자 kids_restricted === true 뿐. 성인·나이 모름·비로그인·킬 스위치 OFF = 호출 0.
 * - 최소 간격 30초(요청 시작 기준), 동시 요청 1개.
 * - 실패 무시(console.error 만, 팝업 없음 — 401 은 기존 인터셉터 경고, account_suspended 는 인터셉터 공통 안내).
 * - 병합은 어린이 모드 키만(다른 프로필 필드는 건드리지 않음). 응답 도착 전에 계정이 바뀌면 버린다.
 */
import { AppState, Platform } from 'react-native';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { isKidsRestrictedUser } from './kidsRestricted';

export const KIDS_REFRESH_MIN_INTERVAL_MS = 30_000;
const KIDS_KEYS = ['kids_restricted', 'kids_permissions', 'age_group', 'birth_date_locked'] as const;

export type KidsRefreshResult = 'skipped' | 'throttled' | 'inflight' | 'updated' | 'unchanged' | 'stale' | 'failed';

let lastStartedAt = -Infinity;
let inflight: Promise<KidsRefreshResult> | null = null;

/** 어린이 계정이면 /auth/me 로 보호자 허용값을 갱신(최소 간격·실패 무시) */
export function refreshKidsPermissionsIfChild(reason: string, now: number = Date.now()): Promise<KidsRefreshResult> {
  try {
    const user = useAuthStore.getState().user;
    if (!isKidsRestrictedUser(user)) return Promise.resolve('skipped');
    if (inflight) return Promise.resolve('inflight');
    if (now - lastStartedAt < KIDS_REFRESH_MIN_INTERVAL_MS) return Promise.resolve('throttled');
    lastStartedAt = now;
    const uid = String(user!.id);
    inflight = api
      .get('/auth/me')
      .then((res): KidsRefreshResult => {
        const me = res.data?.user ?? res.data;
        const cur = useAuthStore.getState().user;
        if (!cur || String(cur.id) !== uid || !me || String(me.id ?? uid) !== uid) return 'stale';
        const patch: Record<string, any> = {};
        for (const k of KIDS_KEYS) if (k in me) patch[k] = me[k];
        const changed = Object.keys(patch).some((k) => JSON.stringify((cur as any)[k]) !== JSON.stringify(patch[k]));
        if (changed) useAuthStore.getState().setUser(patch);
        console.info('[KidsGuard] permissions refresh', {
          reason,
          changed,
          kids_restricted: patch.kids_restricted ?? null,
          permissions: patch.kids_permissions ?? null,
        });
        return changed ? 'updated' : 'unchanged';
      })
      .catch((err: any): KidsRefreshResult => {
        console.error('[KidsGuard] permissions refresh 실패(무시)', { reason, status: err?.response?.status ?? null });
        return 'failed';
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  } catch (err) {
    console.error('[KidsGuard] permissions refresh 예외(무시)', { reason, err });
    return Promise.resolve('failed');
  }
}

let started = false;
let teardown: (() => void) | null = null;

/** 포그라운드 복귀 트리거 등록(네이티브 AppState active · 웹 visibilitychange visible). 멱등, 해제 함수 반환 */
export function startKidsForegroundRefresh(): () => void {
  if (started && teardown) return teardown;
  started = true;
  const onResume = (src: string) => { void refreshKidsPermissionsIfChild(src); };
  let remove: () => void = () => {};
  try {
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined' && document.addEventListener) {
        const h = () => { if (document.visibilityState === 'visible') onResume('visibilitychange'); };
        document.addEventListener('visibilitychange', h);
        remove = () => document.removeEventListener('visibilitychange', h);
      }
    } else {
      const sub = AppState.addEventListener('change', (state) => { if (state === 'active') onResume('appstate'); });
      remove = () => sub?.remove?.();
    }
  } catch (err) {
    console.error('[KidsGuard] 포그라운드 갱신 등록 실패', { err });
  }
  teardown = () => {
    try { remove(); } catch (err) { console.error('[KidsGuard] 포그라운드 갱신 해제 실패', { err }); }
    started = false;
    teardown = null;
  };
  return teardown;
}

/** 테스트 전용 */
export function __resetKidsRefreshForTest(): void {
  lastStartedAt = -Infinity;
  inflight = null;
}
