// v3.346 [WelcomeDefer] 크루 공유·초대 링크로 처음 온 비로그인 사용자도 체험 1회 안내(대표 10-12).
// 링크 목적지(크루 화면)를 먼저 보여 주고, 크루 영역을 벗어나거나(다른 탭·화면) 1분 미리 듣기 안내를
// 닫으면 그때 첫 방문 안내(WelcomeGuide — [작사 체험하러 가기]/[둘러보기])를 띄운다.

/** 크루 링크 착지 동안 머무는 화면 — 여기 있는 동안은 안내를 미룬다 */
export const CREW_AREA_ROUTES = ['Splash', 'ClubHome', 'ClubAlbum', 'Player'];

export function isCrewAreaRoute(name: string | undefined | null): boolean {
  return !name || CREW_AREA_ROUTES.includes(name);
}

type Listener = (reason: string) => void;
const listeners = new Set<Listener>();

/** 미뤄 둔 첫 방문 안내를 지금 띄워 달라는 요청(WelcomeGuide 가 대상·1회 여부를 판정) */
export function requestDeferredWelcome(reason: string): void {
  listeners.forEach((l) => {
    try { l(reason); } catch { /* 리스너 오류 무시 */ }
  });
}

export function onDeferredWelcomeRequest(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
