import { createNavigationContainerRef } from '@react-navigation/native';

// 전역 네비게이션 ref — 전역 모달 등 화면 밖 컨텍스트에서 이동에 사용.
export const navigationRef = createNavigationContainerRef<any>();

export function navigateGlobal(name: string, params?: object) {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as any)(name, params);
  } else if (__DEV__) {
    console.warn('[navigationRef] navigate 호출됐지만 준비 안 됨', { name });
  }
}
