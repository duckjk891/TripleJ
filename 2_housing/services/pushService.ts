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
