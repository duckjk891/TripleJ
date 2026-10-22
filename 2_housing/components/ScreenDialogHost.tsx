// v3.397 [ModalTurn] 모달 화면(설정·플레이어·피드 작성·공유·디렉터 대화) 안 다이얼로그 — 아이폰에서 설정 → 로그아웃 확인 창이
// 아예 안 뜨던 문제(대표 실기기 10-22). 이 화면들은 네이티브 모달로 떠 있어서, 앱 루트의 AppDialogHost(RN Modal)는 그 위에
// 겹쳐 뜨지 못한다(iOS 는 이미 다른 창을 띄운 화면에서 또 띄우지 못함). 화면 안에 둔 호스트는 그 화면 위에 뜬다.
// 화면이 포커스일 때만 다이얼로그를 맡는다(설정 위에 플레이어가 열리면 플레이어 쪽이 맡음).
import type { ComponentType } from 'react';
import { useIsFocused } from '@react-navigation/native';
import AppDialogHost from './AppDialogHost';

export function withScreenDialogHost<P extends object>(Screen: ComponentType<P>, key: string): ComponentType<P> {
  function WithDialogHost(props: P) {
    const focused = useIsFocused();
    return (
      <>
        <Screen {...props} />
        <AppDialogHost nestedIn={`screen:${key}`} active={focused} />
      </>
    );
  }
  WithDialogHost.displayName = `WithDialogHost(${key})`;
  return WithDialogHost;
}
