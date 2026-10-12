// v3.350 [GuardianAttach] 로그인한 만 14세 미만 계정의 보호자 동의(소셜 가입 후 본인확인으로 나이 확인) — 서버 routes/auth.py
//   GET  /auth/me/guardian-consent  → { required, status: none|pending|agreed|rejected|expired, consent_url, expires_at, guardian_verified }
//   POST /auth/me/guardian-consent  → 같은 모양(대기 중인 요청이 있으면 그 링크 그대로, 만 14세 미만이 아니면 400)
// 보호자는 링크(maidol.ai.kr/guardian/?token=) → 휴대폰 본인확인(다날, 성인·자녀 본인 아님) → 동의.
import api from './api';

export type GuardianConsentStatus = 'none' | 'pending' | 'agreed' | 'rejected' | 'expired';

export interface MyGuardianConsent {
  required: boolean;
  status: GuardianConsentStatus;
  consent_url: string | null;
  expires_at: string | null;
  guardian_verified?: boolean;
}

export async function getMyGuardianConsent(): Promise<MyGuardianConsent | null> {
  try {
    const res = await api.get('/auth/me/guardian-consent');
    return res.data as MyGuardianConsent;
  } catch (err: any) {
    // 구서버(404)·네트워크 오류 = 판단 불가 → null(호출부가 종전 동작 유지)
    console.warn('[guardianConsentService] 상태 조회 실패', { status: err?.response?.status });
    return null;
  }
}

export async function requestMyGuardianConsent(): Promise<MyGuardianConsent> {
  console.info('[guardianConsentService] 동의 링크 요청');
  const res = await api.post('/auth/me/guardian-consent');
  return res.data as MyGuardianConsent;
}
