import { Alert, Platform } from 'react-native';

export type AppAlertButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

/**
 * RN Alert.alert 호환 래퍼.
 * react-native-web 의 Alert 는 no-op 이라 웹에서 onPress 가 절대 호출되지 않는다
 * (node_modules/react-native-web/dist/exports/Alert/index.js). 웹에서는 window.alert/confirm 으로 대체한다.
 */
export function showAlert(title: string, message?: string, buttons?: AppAlertButton[]) {
  if (__DEV__) {
    console.info('[appAlert] show', { title, web: Platform.OS === 'web', buttons: buttons?.length ?? 0 });
  }

  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const w = globalThis as any;
  const body = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];

  if (list.length <= 1) {
    w.alert?.(body);
    list[0]?.onPress?.();
    return;
  }

  if (list.length > 2) {
    console.warn('[appAlert] web supports 2 choices — using cancel + last action', { count: list.length });
  }
  const cancel = list.find((b) => b.style === 'cancel') ?? list[0];
  const confirm = [...list].reverse().find((b) => b.style !== 'cancel') ?? list[list.length - 1];

  const ok = w.confirm?.(`${body}\n\n확인 = ${confirm.text ?? '확인'} / 취소 = ${cancel.text ?? '취소'}`);
  (ok ? confirm : cancel).onPress?.();
}
