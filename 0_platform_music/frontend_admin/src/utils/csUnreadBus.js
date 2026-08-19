// CS 미읽음 뱃지 로컬 신호 버스 (v195)
//
// 관리자 앱에는 WebSocket 사용처가 0건이라 서버 push 로 사이드바 뱃지를 즉시 줄일 수 없다.
// AdminCsPage 가 대화를 열어 markCsRead 에 성공하면, 방금 사라진 미읽음 수만큼 델타를
// 이 버스로 흘려보내고 AdminLayout 이 그만큼 뱃지를 깎는다.
//
// **권위값은 AdminLayout 의 30초 폴링(getCsUnreadCount)이다.**
// 이 버스는 체감 즉시성만 담당하며, 델타 누락·중복으로 생긴 드리프트는 다음 폴링이 교정한다.
// 그래서 델타를 신뢰할 수 없어도 화면이 영구히 틀어지지 않는다.
//
// 사용자 앱 `dmSocket` 의 관행 승계 — 모듈 싱글턴 + Set 기반 구독 + `subscribe() → unsubscribe`,
// 핸들러 예외는 흡수(구독자 하나가 죽어도 발신자에게 전파하지 않는다).

const handlers = new Set();

/** 미읽음 델타 구독 → unsubscribe 함수 반환 */
export function subscribe(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

/**
 * 미읽음 델타 발행. 읽음 처리로 줄었으면 음수(-n)를 넘긴다.
 * 렌더 중이 아니라 **액션 핸들러 안에서 1회만** 호출할 것(StrictMode 이중 적용 방지).
 */
export function emitDelta(delta) {
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) return;
  if (import.meta.env.DEV) console.info('[CsUnreadBus] delta', { delta: n });
  handlers.forEach((fn) => {
    try {
      fn(n);
    } catch (err) {
      console.error('[CsUnreadBus] handler error', { message: err?.message });
    }
  });
}

export default { subscribe, emitDelta };
