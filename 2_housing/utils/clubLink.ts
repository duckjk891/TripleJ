// v3.305 [ClubLink] 크루 초대·크루 앨범 공유 링크 진입 → 크루 화면 바로 착지 → (비회원) 로그인 후 자동 가입.
//  진입 형태
//   · 웹: 서버 공유 랜딩(`/club/{id}?i=코드`, `/club/{id}/album/{aid}`)이 `https://app.maidol.ai.kr/?club={id}&i=…&album=…`
//     로 보낸다 — 앱 모듈 로드 시 1회 캡처(trackLink 관행), 주소창에서 club·i·album 만 제거.
//   · 네이티브: `aidol://club/{id}?i=…&album=…`(Linking 콜드 스타트 + 실행 중).
//  보관(AsyncStorage, 7일): 초대 코드 {clubId, code} — 소셜 로그인 전체 페이지 이동 뒤에도 가입 시 코드를 쓴다.
//  가입 의도(1시간): 비회원이 크루 화면에서 '크루 가입하기' → 로그인 모달. 로그인(이메일·소셜 리로드 모두) 직후
//   App 전역에서 1회 자동 가입 → 크루 화면 복귀(processPendingClubJoin).
//  첫 방문 안내(WelcomeGuide)는 크루 링크 진입이면 생략(대표 확정 10-08: 크루 페이지로 바로, 체험은 가입 후).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
export const INVITE_CODE_RE = /^[a-z0-9]{8}$/;
const INVITE_KEY = 'maidol-club-invite-v1';
const JOIN_KEY = 'maidol-club-join-intent-v1';
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const JOIN_INTENT_TTL_MS = 60 * 60 * 1000;

export interface ClubLink {
  clubId: string;
  code?: string;
  albumId?: string;
}

let pending: ClubLink | null = null;
let entryViaClubLink = false;

const normId = (v: unknown): string => (typeof v === 'string' && OBJECT_ID_RE.test(v.trim()) ? v.trim().toLowerCase() : '');
const normCode = (v: unknown): string => (typeof v === 'string' && INVITE_CODE_RE.test(v.trim()) ? v.trim() : '');

/** `?club=&i=&album=` search 문자열 → ClubLink (순수). club 이 없거나 형식 오류면 null */
export function parseClubLinkFromSearch(search: string | null | undefined): ClubLink | null {
  if (!search) return null;
  try {
    const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const clubId = normId(p.get('club'));
    if (!clubId) return null;
    const code = normCode(p.get('i'));
    const albumId = normId(p.get('album'));
    return { clubId, ...(code ? { code } : {}), ...(albumId ? { albumId } : {}) };
  } catch {
    return null;
  }
}

/** 네이티브 딥링크 `aidol://club/{id}?i=…&album=…` (순수). OAuth 콜백·기타 경로는 null */
export function parseClubLinkFromUrl(url: string | null | undefined): ClubLink | null {
  if (!url || typeof url !== 'string' || url.includes('oauth/callback')) return null;
  const m = url.match(/club\/([0-9a-fA-F]{24})(?:\/album\/([0-9a-fA-F]{24}))?/);
  if (!m) {
    const qm = url.match(/\?([^#]*)/);
    return qm ? parseClubLinkFromSearch(qm[1]) : null;
  }
  const qm = url.match(/\?([^#]*)/);
  const q = qm ? new URLSearchParams(qm[1]) : null;
  const code = normCode(q?.get('i'));
  const albumId = normId(m[2] || q?.get('album'));
  return { clubId: m[1].toLowerCase(), ...(code ? { code } : {}), ...(albumId ? { albumId } : {}) };
}

/** 웹 URL 에서 club·i·album 제거한 href (순수). 바꿀 게 없으면 null */
export function stripClubParams(href: string): string | null {
  try {
    const u = new URL(href);
    let changed = false;
    for (const k of ['club', 'i', 'album']) {
      if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
    }
    return changed ? u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash : null;
  } catch {
    return null;
  }
}

function setPending(link: ClubLink, src: 'web' | 'native'): void {
  pending = link;
  entryViaClubLink = true;
  if (link.code) saveClubInvite(link.clubId, link.code).catch(() => {});
  console.info('[ClubLink] captured', { club: link.clubId.slice(0, 8), album: link.albumId?.slice(0, 8) ?? null, code: !!link.code, src });
}

/** 웹 — 앱 모듈 로드 시 1회 */
export function captureWebClubLink(): ClubLink | null {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    const link = parseClubLinkFromSearch(window.location.search);
    if (!link) return null;
    setPending(link, 'web');
    const next = stripClubParams(window.location.href);
    if (next !== null) window.history.replaceState(window.history.state, '', next);
    return link;
  } catch (err: any) {
    console.error('[ClubLink] web capture 실패', { message: err?.message });
    return null;
  }
}

/** 네이티브 — 크루 링크면 true */
export function captureNativeClubLink(url: string | null | undefined): boolean {
  const link = parseClubLinkFromUrl(url);
  if (!link) return false;
  setPending(link, 'native');
  return true;
}

/** 이번 실행이 크루 링크로 시작됐는지 — WelcomeGuide 생략 판단 */
export function isClubLinkEntry(): boolean {
  return entryViaClubLink;
}

export function peekPendingClubLink(): ClubLink | null {
  return pending;
}

/** 크루 화면으로 이동할 링크 1건 꺼내기(1회) */
export function takePendingClubLink(): ClubLink | null {
  const p = pending;
  pending = null;
  return p;
}

// ── 초대 코드 보관(7일) ─────────────────────────────────────────────

export function parseStored<T extends { savedAt: number }>(raw: string | null, ttl: number, now: number): T | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o.savedAt !== 'number' || now - o.savedAt > ttl || o.savedAt - now > 60_000) return null;
    if (!normId(o.clubId)) return null;
    return o as T;
  } catch {
    return null;
  }
}

export async function saveClubInvite(clubId: string, code: string, now = Date.now()): Promise<void> {
  const c = normCode(code);
  const id = normId(clubId);
  if (!c || !id) return;
  try {
    await AsyncStorage.setItem(INVITE_KEY, JSON.stringify({ clubId: id, code: c, savedAt: now }));
  } catch (err: any) {
    console.error('[ClubLink] 초대 코드 저장 실패', { message: err?.message });
  }
}

/** 이 크루의 보관된 초대 코드(없거나 만료·다른 크루면 '') */
export async function loadClubInviteCode(clubId: string, now = Date.now()): Promise<string> {
  try {
    const o = parseStored<{ clubId: string; code: string; savedAt: number }>(await AsyncStorage.getItem(INVITE_KEY), INVITE_TTL_MS, now);
    return o && o.clubId === normId(clubId) ? normCode(o.code) : '';
  } catch {
    return '';
  }
}

export async function clearClubInvite(reason: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(INVITE_KEY);
    if (__DEV__) console.info('[ClubLink] 초대 코드 삭제', { reason });
  } catch {}
}

// ── 가입 의도(로그인 후 자동 가입, 1시간) ─────────────────────────────

export async function saveJoinIntent(clubId: string, now = Date.now()): Promise<void> {
  const id = normId(clubId);
  if (!id) return;
  try {
    await AsyncStorage.setItem(JOIN_KEY, JSON.stringify({ clubId: id, savedAt: now }));
    console.info('[ClubLink] 로그인 후 가입 예약', { club: id.slice(0, 8) });
  } catch (err: any) {
    console.error('[ClubLink] 가입 예약 저장 실패', { message: err?.message });
  }
}

/** 예약된 가입 1건 꺼내기(꺼내면 삭제 — 중복 실행 방지) */
export async function takeJoinIntent(now = Date.now()): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(JOIN_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(JOIN_KEY);
    const o = parseStored<{ clubId: string; savedAt: number }>(raw, JOIN_INTENT_TTL_MS, now);
    return o ? normId(o.clubId) : null;
  } catch {
    return null;
  }
}

/** 테스트 전용 */
export function __resetClubLinkForTest(): void {
  pending = null;
  entryViaClubLink = false;
}
