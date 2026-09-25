// v3.230 A7-1 [ReferralPending] 초대 링크 추천코드 보관 — 소셜(구글·카카오) 가입은 전체 페이지 이동/외부
// 브라우저를 거치므로 폼 state 가 사라진다. `?ref=` 또는 직접 입력한 코드를 7일간 저장해 두고
// (web = AsyncStorage→localStorage, 네이티브 = AsyncStorage) 가입 확인(가입 선물 안내) 후 지운다.
// 저장·조회 실패는 무해(try/catch) — 기능은 폼 기본값 수준으로 후퇴한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const PENDING_REF_KEY = 'maidol-pending-ref-v1';
export const PENDING_REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 서버 referral_service 해석 규격(4~12자 A-Z/0-9)과 동일 — AuthPanel REFERRAL_RE 와 같은 값
export const REFERRAL_CODE_RE = /^[A-Z0-9]{4,12}$/;

export type PendingReferralSource = 'link' | 'input';

export interface PendingReferral {
  code: string;
  savedAt: number;
  source: PendingReferralSource;
}

/** 대문자·공백 제거 후 형식이 맞으면 코드, 아니면 '' */
export function normalizeReferralCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.replace(/\s+/g, '').toUpperCase();
  return REFERRAL_CODE_RE.test(v) ? v : '';
}

/** 저장 문자열 → PendingReferral(형식·TTL 검증, 순수). 만료·손상은 null */
export function parsePendingReferral(raw: string | null | undefined, now: number): PendingReferral | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const code = normalizeReferralCode(o?.code);
    const savedAt = typeof o?.savedAt === 'number' ? o.savedAt : NaN;
    if (!code || !Number.isFinite(savedAt)) return null;
    if (now - savedAt > PENDING_REF_TTL_MS || savedAt - now > 60_000) return null;
    const source: PendingReferralSource = o?.source === 'input' ? 'input' : 'link';
    return { code, savedAt, source };
  } catch {
    return null;
  }
}

export async function loadPendingReferral(now = Date.now()): Promise<PendingReferral | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REF_KEY);
    const p = parsePendingReferral(raw, now);
    if (raw && !p) {
      // 만료·손상 — 정리(다음 가입에 옛 코드가 붙지 않게)
      await AsyncStorage.removeItem(PENDING_REF_KEY).catch(() => {});
      if (__DEV__) console.info('[ReferralPending] 만료/손상 코드 정리');
    }
    return p;
  } catch (err: any) {
    console.error('[ReferralPending] load 실패', { message: err?.message });
    return null;
  }
}

export async function savePendingReferral(code: string, source: PendingReferralSource, now = Date.now()): Promise<boolean> {
  const c = normalizeReferralCode(code);
  if (!c) return false;
  try {
    await AsyncStorage.setItem(PENDING_REF_KEY, JSON.stringify({ code: c, savedAt: now, source }));
    if (__DEV__) console.info('[ReferralPending] 저장', { len: c.length, source });
    return true;
  } catch (err: any) {
    console.error('[ReferralPending] save 실패', { message: err?.message });
    return false;
  }
}

export async function clearPendingReferral(reason: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REF_KEY);
    if (__DEV__) console.info('[ReferralPending] 삭제', { reason });
  } catch (err: any) {
    console.error('[ReferralPending] clear 실패', { message: err?.message });
  }
}

/** 웹 전용 — 현재 URL 의 `?ref=` (형식 검증 통과 시). 네이티브·실패는 '' */
export function readReferralFromUrl(): string {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    return normalizeReferralCode(new URLSearchParams(window.location.search).get('ref') || '');
  } catch {
    return '';
  }
}

/** 앱 로드 시 1회 — URL 코드가 있으면 즉시 반환 + 비동기로 7일 보관(새로고침·재방문·소셜 이동 대비) */
export function capturePendingReferralFromUrl(): string {
  const code = readReferralFromUrl();
  if (code) {
    savePendingReferral(code, 'link').catch(() => {});
    if (__DEV__) console.info('[ReferralPending] URL 코드 수신', { len: code.length });
  }
  return code;
}

// ── 이메일 가입 경로의 추천 적용 결과(register 응답 referral.applied) — 메모리 1회성 ──
// 가입 선물 안내(rewardNotice)가 "코드를 넣었는데 적용 안 됨" 문구 판단에 쓴다.
let lastSignupReferral: { code: string; applied: boolean | null; at: number } | null = null;

export function noteSignupReferral(code: string, applied: boolean | null): void {
  const c = normalizeReferralCode(code);
  lastSignupReferral = c ? { code: c, applied, at: Date.now() } : null;
  if (__DEV__) console.info('[ReferralPending] 가입 추천 결과 기록', { hasCode: !!c, applied });
}

export function peekSignupReferral(): { code: string; applied: boolean | null; at: number } | null {
  return lastSignupReferral;
}

export function clearSignupReferral(): void {
  lastSignupReferral = null;
}
