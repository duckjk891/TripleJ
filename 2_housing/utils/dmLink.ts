// v3.376 [DmLink]: 메일 등 외부에서 MAIDOL 메시지함으로 바로 오는 링크 — https://app.maidol.ai.kr/app?open=dm
// 웹 모듈 로드 시 1회 캡처(React Navigation 이 주소를 바꾸기 전) → 부팅 세션 정착 뒤 소비:
// 로그인돼 있으면 메시지함(DmInbox), 아니면 로그인 창을 띄우고 로그인되는 즉시 메시지함으로.
import { Platform } from 'react-native';

let pending = false;

/** 순수 — location.search 에 open=dm 이 있는가 */
export function isDmLinkSearch(search: string): boolean {
  try {
    const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return (q.get('open') || '').toLowerCase() === 'dm';
  } catch {
    return false;
  }
}

/** 순수 — 주소에서 open 파라미터만 뺀 새 주소(없으면 null) */
export function stripDmParam(href: string): string | null {
  try {
    const u = new URL(href);
    if (!u.searchParams.has('open')) return null;
    u.searchParams.delete('open');
    return u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : '') + u.hash;
  } catch {
    return null;
  }
}

export function captureWebDmLink(): boolean {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    if (!isDmLinkSearch(window.location.search)) return false;
    pending = true;
    const next = stripDmParam(window.location.href);
    if (next !== null) window.history.replaceState(window.history.state, '', next);
    console.info('[DmLink] captured');
    return true;
  } catch (err: any) {
    console.error('[DmLink] web capture 실패', { message: err?.message });
    return false;
  }
}

export function peekPendingDmLink(): boolean {
  return pending;
}

export function takePendingDmLink(): boolean {
  const was = pending;
  pending = false;
  return was;
}

/** v3.391 [AppLinks] 설치 앱: App Link(https://app.maidol.ai.kr/app?open=dm)·aidol://?open=dm 으로 열렸을 때 */
export function captureNativeDmLink(url: string | null | undefined): boolean {
  if (Platform.OS === 'web' || !url || url.includes('oauth/callback')) return false;
  const qm = url.match(/\?([^#]*)/);
  if (!qm || !isDmLinkSearch(qm[1])) return false;
  pending = true;
  console.info('[DmLink] captured(native)');
  return true;
}
