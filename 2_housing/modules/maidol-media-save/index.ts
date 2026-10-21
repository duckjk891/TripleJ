// v3.391 [NativeSave] 안드로이드 MediaStore 직접 저장 — 로컬 Expo 모듈 JS 쪽.
// 모듈이 없는 빌드(이전 APK·iOS·웹)·안드로이드 9 이하에서는 isMediaStoreSaveAvailable() = false → 호출부가 예전 방식.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type NativeModuleShape = {
  isSupported(): boolean;
  saveToMediaStore(localUri: string, displayName: string, mimeType: string, relativeDir: string): Promise<{ uri: string; relativeDir: string }>;
};

const Native: NativeModuleShape | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeModuleShape>('MaidolMediaSave') : null;

export function isMediaStoreSaveAvailable(): boolean {
  try {
    return !!Native && Native.isSupported();
  } catch {
    return false;
  }
}

/** 캐시 파일을 기기 공용 폴더(relativeDir 예: 'Music/MAIDOL')에 저장. 실패 시 err.code = E_INSERT·E_WRITE 등 */
export async function saveToMediaStore(localUri: string, displayName: string, mimeType: string, relativeDir: string) {
  if (!Native) throw Object.assign(new Error('MaidolMediaSave module missing'), { code: 'E_MODULE_MISSING' });
  return Native.saveToMediaStore(localUri, displayName, mimeType, relativeDir);
}
