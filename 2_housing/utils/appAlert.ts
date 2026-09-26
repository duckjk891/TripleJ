import {
  useDialogStore,
  type DialogButton,
  type DialogOptions,
  type DialogCustomContext,
} from '../stores/dialogStore';
import type { ReactNode } from 'react';

export type AppAlertButton = DialogButton;

/**
 * RN Alert.alert 호환 시그니처의 앱 내 다이얼로그.
 * v3.85: 시스템 팝업(네이티브 Alert.alert / 웹 window.alert·confirm) 전면 금지 방침에 따라
 * 전역 dialogStore → AppDialogHost(App 루트) 렌더로 대체 — 웹/네이티브 동일한 앱 디자인 팝업.
 * 버튼 3개 이상도 지원(세로 스택).
 */
export function showAlert(title: string, message?: string, buttons?: AppAlertButton[], options?: DialogOptions) {
  if (__DEV__) {
    console.info('[appAlert] show', { title, buttons: buttons?.length ?? 0, lockMs: options?.lockMs ?? 0 });
  }
  useDialogStore.getState().show(title, message, buttons, options);
}

/**
 * v3.236 A1: 앱 내 다이얼로그 카드 안에 커스텀 본문을 렌더(제목 + render 결과).
 * 버튼·잠금·닫기 처리는 콘텐츠가 직접 한다(ctx.close). 백드롭·뒤로가기 = onRequestClose(미지정 시 닫힘).
 * 기존 showAlert 경로와 같은 큐(AppDialogHost)를 쓰므로 App.tsx 에 별도 마운트가 필요 없다.
 * 반환값 = 다이얼로그 id.
 */
export function showCustomDialog(
  title: string,
  render: (ctx: DialogCustomContext) => ReactNode,
  options?: { lockMs?: number; onRequestClose?: () => void }
): number {
  if (__DEV__) {
    console.info('[appAlert] show custom', { title, lockMs: options?.lockMs ?? 0 });
  }
  return useDialogStore
    .getState()
    .showCustom(title, { render, onRequestClose: options?.onRequestClose }, { lockMs: options?.lockMs });
}
