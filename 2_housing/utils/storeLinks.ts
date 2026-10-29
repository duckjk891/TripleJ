// v3.418 [StoreLinks] 앱 스토어 주소 — 명함 QR 로 웹 재생 화면에 온 휴대폰 방문자를 앱 설치로 보낸다(대표 10-29).
import { Platform } from 'react-native';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.maidol.app';
export const APP_STORE_URL = 'https://apps.apple.com/kr/app/id6820885751';
/** 안드로이드 크롬 — 앱이 있으면 앱 실행, 없으면 Play(browser_fallback_url) */
export const ANDROID_APP_INTENT_URL =
  `intent://#Intent;scheme=aidol;package=com.maidol.app;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;

/** 웹에서 접속한 휴대폰 종류(순수 판정은 UA·터치 수). 네이티브·PC = null */
export function webMobileOs(): 'android' | 'ios' | null {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1)) return 'ios';
  return null;
}

/** 웹 휴대폰이면 스토어(안드로이드는 앱 실행 우선)로 보내고 true. 그 외 false(호출측이 종전 동작) */
export function openAppStoreFromWeb(): boolean {
  const os = webMobileOs();
  if (!os || typeof window === 'undefined') return false;
  window.location.href = os === 'android' ? ANDROID_APP_INTENT_URL : APP_STORE_URL;
  return true;
}
