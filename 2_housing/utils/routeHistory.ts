/**
 * [routeHistory] v3.285: 최근 화면 동선 — 오류 신고(POST /api/issues) 의 page_url·recent_pages 근거.
 *
 * App.tsx syncRoute(NavigationContainer onReady/onStateChange)가 현재 라우트명을 recordRoute 로 넘기고,
 * 신고 시 getCurrentPage()(현재 화면) / getRecentPages()(직전 화면 ≤5, 최신순) 를 꺼내 보낸다.
 * 서버(issues.py)는 path ≤200자·최대 5개로 재검증하므로 여기서도 같은 상한을 지킨다.
 * 라우트명만 기록한다(파라미터·검색어 등 사용자 데이터 X). 순수 모듈 — Node 하네스로 테스트.
 */

export type RecentPage = { path: string; at: string };

export const RECENT_PAGES_MAX = 5;
const KEEP = RECENT_PAGES_MAX + 1; // 현재 화면 1 + 직전 5

let _history: RecentPage[] = []; // 최신이 앞

/** 라우트 변경 시 1회 호출 — 같은 화면 연속 호출은 무시 */
export function recordRoute(name: string | undefined, now: number = Date.now()): void {
  if (!name) return;
  if (_history[0]?.path === name) return;
  _history = [{ path: name.slice(0, 200), at: new Date(now).toISOString() }, ..._history].slice(0, KEEP);
}

/** 현재 화면 라우트명(없으면 null) */
export function getCurrentPage(): string | null {
  return _history[0]?.path ?? null;
}

/** 현재 화면을 제외한 직전 동선 — 최신순, 최대 5개(서버 MAX_RECENT_PAGES) */
export function getRecentPages(): RecentPage[] {
  return _history.slice(1, 1 + RECENT_PAGES_MAX).map((p) => ({ ...p }));
}

/** 테스트 전용 */
export function __resetRouteHistoryForTest(): void {
  _history = [];
}
