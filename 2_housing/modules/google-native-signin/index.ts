// v3.385 [GoogleNative] 안드로이드 시스템 계정창(Credential Manager) 구글 로그인 — 로컬 Expo 모듈 JS 쪽.
// 네이티브 모듈이 없는 빌드(이전 APK·개발 클라이언트·iOS·웹)에서는 isGoogleNativeAvailable() = false → 기존 브라우저 방식.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

// 서버(oauth_service)가 쓰는 웹 OAuth 클라이언트 ID(공개값) — id_token 의 aud 가 된다. 바꾸면 서버 GOOGLE_CLIENT_ID 와 함께.
export const GOOGLE_WEB_CLIENT_ID = '832756935102-p4hn0hk6ipo0k5f6naep9lq1klt58rfk.apps.googleusercontent.com';

type NativeModuleShape = {
  signIn(serverClientId: string): Promise<{ idToken: string; nonce: string }>;
};

const Native: NativeModuleShape | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeModuleShape>('GoogleNativeSignIn') : null;

export function isGoogleNativeAvailable(): boolean {
  return !!Native;
}

/** 시스템 계정창을 띄워 구글 id_token 을 받는다. 실패 시 err.code = E_CANCELLED·E_NO_CREDENTIAL·E_PROVIDER_CONFIG·E_GET_CREDENTIAL 등 */
export async function googleNativeSignIn(): Promise<{ idToken: string; nonce: string }> {
  if (!Native) throw Object.assign(new Error('GoogleNativeSignIn module missing'), { code: 'E_MODULE_MISSING' });
  return Native.signIn(GOOGLE_WEB_CLIENT_ID);
}

/**
 * 사용자가 직접 닫은 것인지 — 조용히 끝낸다. 단 [16] "Account reauth failed" 는 콘솔 설정(SHA-1) 오류에서도
 * 취소로 오는 사례가 있어 취소로 보지 않는다(→ 브라우저 폴백).
 */
export function isUserCancel(err: any): boolean {
  if (err?.code !== 'E_CANCELLED') return false;
  const msg = String(err?.message || '');
  return !/\[16\]|reauth/i.test(msg);
}
