import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';

// 전역 네비게이션 ref — 전역 모달 등 화면 밖 컨텍스트에서 이동에 사용.
export const navigationRef = createNavigationContainerRef<any>();

export function navigateGlobal(name: string, params?: object) {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as any)(name, params);
  } else if (__DEV__) {
    console.warn('[navigationRef] navigate 호출됐지만 준비 안 됨', { name });
  }
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
  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: 'MainTabs', state: { index: 0, routes: [{ name: 'Chart' }] } }],
    })
  );
}
