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
};

interface DialogState {
  queue: DialogItem[];
  show: (title: string, message?: string, buttons?: DialogButton[]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  show: (title, message, buttons) =>
    set((s) => ({
      queue: [
        ...s.queue,
        {
          id: nextId++,
          title,
          message,
          buttons: buttons && buttons.length > 0 ? buttons : [{ text: '확인' }],
        },
      ],
    })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((d) => d.id !== id) })),
}));
