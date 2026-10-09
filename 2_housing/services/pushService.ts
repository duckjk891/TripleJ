import { Platform } from 'react-native';
import api from './api';

// v3.298 [WebPush] 웹 푸시 구독 — 서버 /api/push/*. 웹 전용(안드로이드 APK 는 Firebase 설정 후 별도 지원).
// 아이폰은 Safari '홈 화면에 추가' 한 웹앱(standalone)에서만 푸시 가능(Apple 정책).

export type PushSupport = 'supported' | 'ios_needs_install' | 'unsupported' | 'native';

function w(): any { return typeof window !== 'undefined' ? (window as any) : null; }

export function webPushSupport(): PushSupport {
  if (Platform.OS !== 'web') return 'native';
  const win = w();
  if (!win) return 'unsupported';
  const nav: any = win.navigator;
  const ok = !!nav && 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win;
  if (ok) return 'supported';
  const ua = String(nav?.userAgent || '');
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const standalone = !!nav?.standalone || (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  if (isIOS && !standalone) return 'ios_needs_install';
  return 'unsupported';
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = w().atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<any | null> {
  const nav: any = w()?.navigator;
  if (!nav?.serviceWorker) return null;
  const reg = await nav.serviceWorker.getRegistration('/');
  return reg ? await reg.pushManager.getSubscription() : null;
}

export async function isWebPushEnabled(): Promise<boolean> {
  if (webPushSupport() !== 'supported') return false;
  try {
    if (w().Notification.permission !== 'granted') return false;
    return !!(await currentSubscription());
  } catch (err: any) {
    console.error('[WebPush] 상태 확인 실패', { msg: err?.message });
    return false;
  }
}

/** 켜기 — 'ok' | 'denied'(권한 거부) | 'unsupported' | 'failed' */
export async function enableWebPush(): Promise<'ok' | 'denied' | 'unsupported' | 'failed'> {
  if (webPushSupport() !== 'supported') return 'unsupported';
  try {
    const perm = await w().Notification.requestPermission();
    if (__DEV__) console.info('[WebPush] 권한', { perm });
    if (perm !== 'granted') return 'denied';
    const nav: any = w().navigator;
    const reg = await nav.serviceWorker.register('/sw.js', { scope: '/' });
    await nav.serviceWorker.ready;
    const keyRes = await api.get('/push/vapid-public-key');
    const key = String(keyRes.data?.public_key || '');
    if (!key) throw new Error('no vapid key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
    const json = sub.toJSON();
    await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
    console.info('[WebPush] 구독 완료');
    return 'ok';
  } catch (err: any) {
    console.error('[WebPush] 구독 실패', { status: err?.response?.status, msg: err?.message });
    return 'failed';
  }
}

export async function disableWebPush(): Promise<void> {
  try {
    const sub = await currentSubscription();
    const endpoint = sub?.endpoint;
    if (sub) await sub.unsubscribe();
    if (endpoint) await api.post('/push/unsubscribe', { endpoint });
    console.info('[WebPush] 구독 해제');
  } catch (err: any) {
    console.error('[WebPush] 해제 실패', { status: err?.response?.status, msg: err?.message });
  }
}

/** 로그아웃 — 서버 호출 없이 브라우저 구독만 해제(다음 발송 때 서버가 410 으로 정리) */
export async function unsubscribeLocalOnLogout(): Promise<void> {
  if (Platform.OS !== 'web') return;
  try {
    const sub = await currentSubscription();
    if (sub) await sub.unsubscribe();
  } catch {
    /* 로그아웃 흐름 무영향 */
  }
}

// ── [FCM] 앱(안드로이드 APK) 푸시 — expo-notifications · Expo 푸시 서비스 경유 ─────────────────
// 서버 /api/push/expo-token(등록)·/expo-token/delete(해제). 웹푸시와 같은 알림 훅·문구로 함께 발송된다.
// 모듈 미탑재 구버전 APK·web 은 require 실패 → nativePushSupported()=false 로 전 API 안전 강등.
let Notifications: any = null;
if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
  } catch (e) {
    console.warn('[NativePush] expo-notifications 로드 실패(구버전 앱 — 앱 푸시 미지원)', { msg: String(e).slice(0, 120) });
  }
}

const NATIVE_OFF_KEY = 'maidol-native-push-off-v1'; // 사용자가 설정에서 끔 → 자동 등록 안 함
const NATIVE_ASKED_KEY = 'maidol-native-push-asked-v1'; // 로그인 후 '알림 받기' 안내 1회
const ANDROID_CHANNEL_ID = 'default'; // 서버 expo_push.ANDROID_CHANNEL_ID 와 동일
let nativeToken: string | null = null;
let handlerReady = false;

export function nativePushSupported(): boolean {
  return Platform.OS !== 'web' && !!Notifications?.getExpoPushTokenAsync;
}

function easProjectId(): string | undefined {
  try {
    const Constants = require('expo-constants').default;
    return Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  } catch {
    return undefined;
  }
}

/** 앱 시작 시 1회 — 포그라운드에서도 배너 표시 + 안드로이드 알림 채널 생성 */
export async function initNativePush(): Promise<void> {
  if (!nativePushSupported() || handlerReady) return;
  handlerReady = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'MAIDOL 알림',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        sound: 'default',
      });
    }
  } catch (err: any) {
    console.error('[NativePush] 초기화 실패', { msg: err?.message });
  }
}

/** 알림을 눌러 앱을 열었을 때 콜백(앱 실행 중 + 콜드 스타트 마지막 응답). 반환값 = 구독 해제 */
export function onNativePushOpened(cb: () => void): () => void {
  if (!nativePushSupported()) return () => {};
  let sub: any = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener(() => cb());
    Notifications.getLastNotificationResponseAsync?.()
      .then((r: any) => { if (r) cb(); })
      .catch(() => {});
  } catch (err: any) {
    console.error('[NativePush] 응답 리스너 실패', { msg: err?.message });
  }
  return () => { try { sub?.remove?.(); } catch {} };
}

async function storageGet(key: string): Promise<string | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function storageSet(key: string, value: string | null): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {}
}

/** 켜짐 = 사용자가 끄지 않았고 OS 알림 권한이 허용됨 */
export async function isNativePushEnabled(): Promise<boolean> {
  if (!nativePushSupported()) return false;
  try {
    if ((await storageGet(NATIVE_OFF_KEY)) === '1') return false;
    const p = await Notifications.getPermissionsAsync();
    return !!p?.granted;
  } catch {
    return false;
  }
}

/** 켜기/등록 — prompt=true 면 OS 권한 요청(안드로이드 13+). 'ok' | 'denied' | 'unsupported' | 'failed' */
export async function enableNativePush(prompt = true): Promise<'ok' | 'denied' | 'unsupported' | 'failed'> {
  if (!nativePushSupported()) return 'unsupported';
  try {
    await initNativePush();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm?.granted && prompt && perm?.canAskAgain !== false) perm = await Notifications.requestPermissionsAsync();
    if (__DEV__) console.info('[NativePush] 권한', { granted: !!perm?.granted, canAskAgain: perm?.canAskAgain });
    if (!perm?.granted) return 'denied';
    const res = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() });
    const token = String(res?.data || '');
    if (!token) throw new Error('no expo push token');
    await api.post('/push/expo-token', { token, platform: Platform.OS });
    nativeToken = token;
    await storageSet(NATIVE_OFF_KEY, null);
    console.info('[NativePush] 등록 완료', { platform: Platform.OS });
    return 'ok';
  } catch (err: any) {
    console.error('[NativePush] 등록 실패', { status: err?.response?.status, msg: err?.message });
    return 'failed';
  }
}

/** 끄기 — 이 기기 토큰만 서버에서 삭제하고, 다음 앱 시작 때 자동 등록하지 않는다 */
export async function disableNativePush(): Promise<void> {
  await storageSet(NATIVE_OFF_KEY, '1');
  if (!nativePushSupported()) return;
  try {
    const token = nativeToken || String((await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() }))?.data || '');
    if (token) await api.post('/push/expo-token/delete', { token });
    nativeToken = null;
    console.info('[NativePush] 해제');
  } catch (err: any) {
    console.error('[NativePush] 해제 실패', { status: err?.response?.status, msg: err?.message });
  }
}

/**
 * 로그인 계정 확정 시 — 권한이 이미 있으면 조용히 (재)등록, 처음이면 앱 내 안내 후 권한 요청(1회).
 * askFirstTime: 사용자에게 '알림 받기'를 물어볼 콜백(showAlert 기반, true=켜기 선택).
 */
export async function syncNativePushOnLogin(askFirstTime: () => Promise<boolean>): Promise<void> {
  if (!nativePushSupported()) return;
  try {
    if ((await storageGet(NATIVE_OFF_KEY)) === '1') return;
    const perm = await Notifications.getPermissionsAsync();
    if (perm?.granted) { await enableNativePush(false); return; }
    if (perm?.canAskAgain === false) return; // 사용자가 OS에서 거부 — 설정 화면 토글로만 안내
    if ((await storageGet(NATIVE_ASKED_KEY)) === '1') return;
    await storageSet(NATIVE_ASKED_KEY, '1');
    if (await askFirstTime()) await enableNativePush(true);
  } catch (err: any) {
    console.error('[NativePush] 로그인 동기화 실패', { msg: err?.message });
  }
}

/**
 * 로그아웃 직전(인증 토큰을 지우기 전) — 이 기기 토큰을 서버에서 삭제해 이전 계정 알림이 오지 않게 한다.
 * authToken 을 명시 헤더로 실어 보내므로 호출 직후 setAuthToken(null) 해도 안전.
 */
export async function unregisterNativeOnLogout(authToken: string | null): Promise<void> {
  if (!nativePushSupported() || !nativeToken || !authToken) { nativeToken = null; return; }
  const token = nativeToken;
  nativeToken = null;
  try {
    await api.post('/push/expo-token/delete', { token }, { headers: { Authorization: `Bearer ${authToken}` } });
  } catch {
    /* 로그아웃 흐름 무영향 — 다음 로그인 계정이 같은 토큰을 등록하면 서버가 이관한다 */
  }
}
