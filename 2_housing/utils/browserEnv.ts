// [InApp] 인앱 브라우저 감지·탈출 유틸 — v3.217 ①(b) 웹 전용
// 인앱 웹뷰는 suspend로 백그라운드 오디오가 대부분 불가(코드 해결 불가 — PLAN F1) →
// 외부 브라우저 탈출 유도가 유일 대응.
//  · 카카오톡: kakaotalk://web/openExternal?url= (iOS/Android 공통 기본 브라우저로 열기 — 공식 스킴)
//  · Android 기타 인앱: intent://…;package=com.android.chrome;end 크롬 지정 관행
//  · iOS 기타 인앱: 강제 탈출 불가(iOS 크롬도 WebKit — 무의미) → 공유→'Safari로 열기' 안내
import { Platform } from 'react-native';

export type InAppKind = 'kakaotalk' | 'instagram' | 'naver' | 'line' | 'facebook' | 'etc';

function ua(): string {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
}

/** 인앱 브라우저 판정 — 일반 브라우저(사파리/크롬 등)는 null(무개입) */
export function detectInApp(): InAppKind | null {
  const s = ua();
  if (!s) return null;
  if (/KAKAOTALK/i.test(s)) return 'kakaotalk';
  if (/Instagram/i.test(s)) return 'instagram';
  if (/NAVER\(inapp/i.test(s) || /\bNAVER\b/i.test(s)) return 'naver';
  if (/\bLine\//i.test(s)) return 'line';
  if (/FBAN|FBAV|FB_IAB/i.test(s)) return 'facebook';
  // Android 시스템 웹뷰 토큰("; wv)") — 앱 내장 브라우저 일반형
  if (/Android/i.test(s) && /;\s?wv\)/i.test(s)) return 'etc';
  return null;
}

export function isIOSWeb(): boolean {
  return /iPhone|iPad|iPod/i.test(ua());
}

export function isAndroidWeb(): boolean {
  return /Android/i.test(ua());
}

/** 현재 페이지 URL — query·hash 보존(탈출 후 동일 지점 착지) */
export function currentPageUrl(): string {
  if (Platform.OS !== 'web' || typeof location === 'undefined') return '';
  return location.href;
}

/** 카카오톡 인앱 → 외부 기본 브라우저 열기 스킴 URL */
export function kakaoOpenExternalUrl(target?: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(target || currentPageUrl())}`;
}

/** Android 인앱 → 크롬 지정 intent:// URL */
export function chromeIntentUrl(target?: string): string {
  const href = target || currentPageUrl();
  const scheme = /^http:\/\//i.test(href) ? 'http' : 'https';
  const stripped = href.replace(/^https?:\/\//i, '');
  return `intent://${stripped}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}

/** 탈출 시도(스킴/인텐트 네비게이션) — 성공 여부는 페이지 이탈로만 판정 가능 */
export function tryEscape(url: string): boolean {
  if (Platform.OS !== 'web' || typeof location === 'undefined') return false;
  try {
    (location as any).href = url;
    return true;
  } catch (err: any) {
    console.warn('[InApp] 탈출 시도 실패', { message: err?.message });
    return false;
  }
}

/** public/index.html 인라인 스크립트가 카카오 자동 탈출을 이미 시도한 시각(ms) — 없으면 null */
export function inlineEscapeTriedAt(): number | null {
  if (Platform.OS !== 'web') return null;
  const v = (globalThis as any).__MAIDOL_INAPP_ESCAPE_AT;
  return typeof v === 'number' ? v : null;
}
