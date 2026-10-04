// [bootAuth] v3.276 — 앱 부팅 세션 복원 완료 신호(App.tsx markBootAuthSettled 가 통지).
// "비로그인 전용" 첫 실행 UI(WelcomeGuide)가 복원 전 user=null 을 게스트로 오판하지 않게 기다린다.
let settled = false;
const waiters: Array<() => void> = [];

export function notifyBootAuthSettled(): void {
  if (settled) return;
  settled = true;
  waiters.splice(0).forEach((fn) => { try { fn(); } catch {} });
}

/** 복원 완료까지 대기(최대 timeoutMs — 신호 유실 방어) */
export function whenBootAuthSettled(timeoutMs = 5000): Promise<void> {
  if (settled) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    waiters.push(() => { clearTimeout(t); resolve(); });
  });
}
