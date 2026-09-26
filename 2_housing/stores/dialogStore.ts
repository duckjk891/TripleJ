import type { ReactNode } from 'react';
import { create } from 'zustand';

// v3.85: 전역 앱 내 다이얼로그 — 시스템 팝업(Alert.alert/window.alert·confirm) 전면 대체.
// showAlert(utils/appAlert)가 여기로 push하고, AppDialogHost(App 루트)가 큐의 맨 앞을 렌더한다.
export type DialogButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type DialogItem = {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  /** v3.230 A5-5: 표시 후 이 시간(ms) 동안 cancel 외 버튼 잠금 — 같은 위치 연타 흡수 */
  lockMs?: number;
  /** v3.236 A1: 커스텀 본문(제목 아래를 render 결과로 채움 — message/buttons 대신). 기존 경로는 미사용 */
  custom?: DialogCustom;
};

/** v3.236 A1: 커스텀 다이얼로그 렌더 컨텍스트 */
export type DialogCustomContext = {
  /** 이 다이얼로그를 닫는다(콜백 호출 없음 — 콘텐츠가 직접 후속 처리) */
  close: () => void;
  /** 표시 시점 + lockMs(없으면 0) — 콘텐츠가 확정 버튼 잠금에 사용 */
  lockUntil: number;
};

export type DialogCustom = {
  render: (ctx: DialogCustomContext) => ReactNode;
  /** 백드롭·뒤로가기 — 미지정이면 그냥 닫힘. 바쁜 동안 무시할지는 콘텐츠가 결정 */
  onRequestClose?: () => void;
};

export type DialogOptions = {
  lockMs?: number;
};

interface DialogState {
  queue: DialogItem[];
  show: (title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) => void;
  /** v3.236 A1: 커스텀 본문 다이얼로그 — 반환값 = 다이얼로그 id */
  showCustom: (title: string, custom: DialogCustom, options?: DialogOptions) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  show: (title, message, buttons, options) =>
    set((s) => ({
      queue: [
        ...s.queue,
        {
          id: nextId++,
          title,
          message,
          buttons: buttons && buttons.length > 0 ? buttons : [{ text: '확인' }],
          ...(options?.lockMs && options.lockMs > 0 ? { lockMs: options.lockMs } : {}),
        },
      ],
    })),
  showCustom: (title, custom, options) => {
    const id = nextId++;
    set((s) => ({
      queue: [
        ...s.queue,
        {
          id,
          title,
          buttons: [],
          custom,
          ...(options?.lockMs && options.lockMs > 0 ? { lockMs: options.lockMs } : {}),
        },
      ],
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((d) => d.id !== id) })),
}));
