import { useDialogStore, type DialogButton } from '../stores/dialogStore';

export type AppAlertButton = DialogButton;

/**
 * RN Alert.alert 호환 시그니처의 앱 내 다이얼로그.
 * v3.85: 시스템 팝업(네이티브 Alert.alert / 웹 window.alert·confirm) 전면 금지 방침에 따라
 * 전역 dialogStore → AppDialogHost(App 루트) 렌더로 대체 — 웹/네이티브 동일한 앱 디자인 팝업.
 * 버튼 3개 이상도 지원(세로 스택).
 */
export function showAlert(title: string, message?: string, buttons?: AppAlertButton[]) {
  if (__DEV__) {
    console.info('[appAlert] show', { title, buttons: buttons?.length ?? 0 });
  }
  useDialogStore.getState().show(title, message, buttons);
}
