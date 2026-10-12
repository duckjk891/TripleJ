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
  identity: { enabled: boolean; provider: string | null };
}

export type IdentityStatus = 'pending' | 'verified' | 'failed' | 'duplicate' | 'expired' | 'cancelled';

export interface IdentityResult {
  status: IdentityStatus;
  under_14: boolean | null;
  error: string | null;
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
