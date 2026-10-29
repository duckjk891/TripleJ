import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';
import { noteModalTransition } from '../utils/modalTurn';

// 전역 네비게이션 ref — 전역 모달 등 화면 밖 컨텍스트에서 이동에 사용.
export const navigationRef = createNavigationContainerRef<any>();

export function navigateGlobal(name: string, params?: object) {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as any)(name, params);
  } else if (__DEV__) {
    console.warn('[navigationRef] navigate 호출됐지만 준비 안 됨', { name });
  }
}

/**
 * v3.419: 시작 화면(Splash, 5초 뒤 MainTabs 로 replace)이 끝날 때까지 대기 — 최대 timeoutMs.
 * Splash 중에 다른 화면으로 이동하면 Splash 의 replace 가 뒤이어 차트로 덮어쓴다
 * (첫 방문자 '무료로 한 곡 만들어보기' → 재료 담기 → 차트로 튕김, 대표 10-29).
 */
export function whenPastSplash(timeoutMs = 8000): Promise<void> {
  const past = () => navigationRef.isReady() && !!navigationRef.getCurrentRoute()?.name
    && navigationRef.getCurrentRoute()?.name !== 'Splash';
  if (past()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      off?.();
      resolve();
    };
    // 컨테이너 준비 전엔 state 리스너를 못 다니 짧게 폴링도 한다
    const poll = setInterval(() => { if (past()) finish(); }, 200);
    const timer = setTimeout(finish, timeoutMs);
    try { off = navigationRef.addListener('state', () => { if (past()) finish(); }); } catch { /* 폴링으로 대체 */ }
  });
}

// v3.216b F1: 로그인 성공 시 항상 차트 탭으로 리셋 착지 — 이메일·소셜·토큰 콜백 공용.
// Splash 표시 중이거나 컨테이너 미준비면 no-op: Splash는 어차피 MainTabs(초기 탭 Chart)로
// replace 되므로 인트로를 끊지 않고도 차트 착지가 보장된다.
export function resetToChartTab() {
  if (!navigationRef.isReady()) {
    if (__DEV__) console.warn('[navigationRef] resetToChartTab — 컨테이너 미준비(스킵, Splash 경유 착지)');
    return;
  }
  if (navigationRef.getCurrentRoute()?.name === 'Splash') {
    if (__DEV__) console.info('[navigationRef] resetToChartTab — Splash 진행 중(스킵, 자동 차트 착지)');
    return;
  }
  if (__DEV__) console.info('[navigationRef] resetToChartTab — 차트 탭으로 리셋');
  noteModalTransition(); // v3.384 [ModalTurn] 로그인 착지 화면 전환(모달 화면 닫힘 포함) 뒤에 자동 팝업
  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: 'MainTabs', state: { index: 0, routes: [{ name: 'Chart' }] } }],
    })
  );
}
