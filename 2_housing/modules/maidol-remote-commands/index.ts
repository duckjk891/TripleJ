// v3.416 [RemoteCmd] iOS 잠금화면 다음/이전 곡 — 로컬 Expo 모듈 JS 쪽. 모듈이 없는 빌드(이전 설치본·안드로이드·웹)는 no-op.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type Sub = { remove: () => void };
type NativeShape = {
  setEnabled(enabled: boolean): void;
  addListener(event: 'onRemoteNext' | 'onRemotePrevious', cb: () => void): Sub;
};

const Native: NativeShape | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule<NativeShape>('MaidolRemoteCommands') : null;

export function isRemoteCommandsAvailable(): boolean {
  return !!Native;
}

/** 다음/이전 곡 버튼을 켜고 눌림을 받는다. 반환 = 해제 함수 */
export function enableRemoteTrackCommands(onNext: () => void, onPrevious: () => void): () => void {
  if (!Native) return () => {};
  const subs: Sub[] = [];
  try {
    subs.push(Native.addListener('onRemoteNext', onNext));
    subs.push(Native.addListener('onRemotePrevious', onPrevious));
    Native.setEnabled(true);
  } catch (err: any) {
    console.warn('[RemoteCmd] 등록 실패', { message: err?.message });
  }
  return () => {
    subs.forEach((s) => { try { s.remove(); } catch {} });
    try { Native.setEnabled(false); } catch {}
  };
}
