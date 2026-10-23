// v3.333 [IdentityVerify] 본인확인(PG 준비본)·소셜 가입 마무리 API — 서버 routes/identity.py.
//   GET  /identity/config        → { enabled, provider, social_onboarding_enabled }
//   GET  /identity/onboarding    → { enabled, required, missing_consents[], birth_date_missing, is_verified, identity{enabled,provider} }
//   POST /identity/start         → { request_id, url }   (꺼져 있으면 503 identity_not_configured)
//   GET  /identity/result/{rid}  → { status: pending|verified|failed|duplicate|expired, under_14, error }
// 기본 꺼짐 — 서버 스위치(IDENTITY_VERIFY_PROVIDER·SOCIAL_ONBOARDING_ENABLED)를 켜기 전에는 앱 동작 변화 없음.
import api from './api';

export interface OnboardingStatus {
  enabled: boolean;
  required: boolean;
  missing_consents: string[];
  birth_date_missing: boolean;
  is_verified: boolean;
  /** v3.348: 만 14세 미만·보호자 동의 계정 — '만 14세 이상 확인' 항목을 묻지 않는다(구서버 미제공 = false) */
  is_minor?: boolean;
  /** v3.354: 신규 가입(이메일 포함) 휴대폰 본인확인 필수(서버 IDENTITY_REQUIRED_SINCE 이후 가입·미인증) */
  identity_required?: boolean;
  identity: { enabled: boolean; provider: string | null };
}

export type IdentityStatus = 'pending' | 'verified' | 'failed' | 'duplicate' | 'expired' | 'cancelled' | 'merge_candidate'; // v3.352 같은 사람 다른 계정 → 통합 제안

export interface IdentityResult {
  status: IdentityStatus;
  under_14: boolean | null;
  error: string | null;
  merge_candidate?: boolean; // v3.352
  rid?: string; // v3.352 앱이 붙임(통합 화면 조회용)
  /** v3.408 본인확인 때 지급된 별(가입·이벤트·추천·인증 합계 — 같은 명의 두 번째 계정은 0) */
  rewards?: { granted?: Record<string, number>; total: number };
}

export interface IdentityConfig {
  enabled: boolean;
  provider: string | null;
  social_onboarding_enabled?: boolean;
  /** v3.352 1인 1계정 통합 활성(서버 ACCOUNT_MERGE_ENABLED) — ⭐ 본인인증 유도 팝업은 이게 켜졌을 때만 */
  account_merge_enabled?: boolean;
}

export async function getIdentityConfig(): Promise<IdentityConfig | null> {
  try {
    const res = await api.get('/identity/config');
    return res.data as IdentityConfig;
  } catch (err: any) {
    console.warn('[identityService] config 조회 실패', { status: err?.response?.status });
    return null;
  }
}

export async function getOnboardingStatus(): Promise<OnboardingStatus | null> {
  try {
    const res = await api.get('/identity/onboarding');
    return res.data as OnboardingStatus;
  } catch (err: any) {
    // 구서버(404)·네트워크 오류 = 가입 마무리 없음(기존 동작)
    console.warn('[identityService] onboarding 조회 실패 — 건너뜀', { status: err?.response?.status });
    return null;
  }
}

export async function startIdentityVerification(purpose: 'signup' | 'verify', returnUrl?: string): Promise<{ request_id: string; url: string }> {
  console.info('[identityService] start', { purpose, hasReturn: !!returnUrl });
  const res = await api.post('/identity/start', { purpose, return_url: returnUrl });
  return res.data;
}

export async function getIdentityResult(requestId: string): Promise<IdentityResult> {
  const res = await api.get(`/identity/result/${encodeURIComponent(requestId)}`);
  return res.data as IdentityResult;
}
