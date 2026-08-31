// [authService] 계정 위생 API — 내 정보 조회, 프로필 이미지 업로드/삭제, 동의 이력 조회/기록.
// 계약 근거: MAIDOL backend_9004 app/routes/auth.py
//   GET  /auth/me                      → user 필드 flat 객체(birth_date/gender/region/sns_links 포함)
//   POST /auth/me/profile-image        → multipart field `image` (jpeg/png/webp, ≤5MB) → { profile_image: "profiles/.." }
//   DELETE /auth/me/profile-image      → { profile_image: null } (기본 이니셜 복귀)
//   GET  /auth/profile-image/{object}  → 무인증 이미지 프록시 (표시용 URL)
//   GET  /auth/me/consents             → { consents: { [key]: { agreed, version, at } } }
//   POST /auth/me/consents             → { consents: [{ key, agreed }], version } → { recorded: n }
// GuardSquad(v3.101, A-19) — 만 14세 미만 보호자 동의 (실서버 9004 openapi.json 실측):
//   GET  /auth/signup-config                     → { guardian_consent_enabled: bool } (무인증, FE 분기 결정)
//   POST /auth/guardian-consent/request          → 201 { status:"pending", message, consent_url? } (pending 계정 생성)
//                                                  503 = 플래그 OFF / 409 = 이메일 중복 / 400 = 검증 실패
//   GET  /auth/guardian-consent/{token}          → 200 { status:"pending", ... } / 409 { status: agreed|rejected } / 404 만료·무효
//   (POST /auth/guardian-consent/{token}/decide 는 보호자 웹 착지 페이지(서버 frontend_url) 전용 — 앱에서 호출하지 않음)
import { Platform } from 'react-native';
import api, { BACKEND_BASE_URL } from './api';

// 서버 계약(auth.py ALLOWED_PROFILE_IMAGE_TYPES / MAX_PROFILE_IMAGE_SIZE)과 동일
export const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export interface ConsentEntry {
  agreed: boolean;
  version: string;
  at: string | null;
}
export type ConsentMap = Record<string, ConsentEntry>;

/** 프로필 이미지 표시 URL — DmInbox/FeedCard 관행과 동일(무인증 프록시, 인코딩 없이 그대로) */
export const profileImageUrl = (objectName?: string | null): string | null =>
  objectName ? `${BACKEND_BASE_URL}/api/auth/profile-image/${objectName}` : null;

/** GET /auth/me — 최신 내 정보(인구통계 포함). 로그인 응답엔 없는 필드 보강용. */
export async function getMe(): Promise<Record<string, any>> {
  if (__DEV__) console.info('[authService] getMe start');
  try {
    const res = await api.get('/auth/me');
    const user = res.data?.user ?? res.data;
    if (__DEV__) console.info('[authService] getMe success');
    return user;
  } catch (err: any) {
    console.error('[authService] getMe failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}

/**
 * POST /auth/me/profile-image — 멀티파트 필드명 `image`(서버가 512x512 자동 크롭).
 * web/native FormData 분기: voiceService.createVoicePersona 관행 재사용.
 */
export async function uploadProfileImage(
  fileUri: string,
  fileName: string,
  mimeType: string
): Promise<{ profile_image: string }> {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // web: 표준 Web FormData는 Blob/File 객체만 받음
    const res = await fetch(fileUri);
    const blob = await res.blob();
    formData.append('image', blob, fileName);
  } else {
    // native: RN 확장 문법
    formData.append('image', { uri: fileUri, name: fileName, type: mimeType } as any);
  }
  if (__DEV__) console.info('[authService] uploadProfileImage start', { mimeType });
  try {
    const res = await api.post('/auth/me/profile-image', formData, {
      // web에서는 boundary 자동 추가되도록 헤더 미지정
      headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    if (__DEV__) console.info('[authService] uploadProfileImage success');
    return res.data;
  } catch (err: any) {
    console.error('[authService] uploadProfileImage failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}

/** DELETE /auth/me/profile-image — 기본 이니셜로 복귀. */
export async function deleteProfileImage(): Promise<{ profile_image: null }> {
  if (__DEV__) console.info('[authService] deleteProfileImage start');
  try {
    const res = await api.delete('/auth/me/profile-image');
    if (__DEV__) console.info('[authService] deleteProfileImage success');
    return res.data;
  } catch (err: any) {
    console.error('[authService] deleteProfileImage failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}

/** GET /auth/me/consents — key별 최신 동의 상태. */
export async function getMyConsents(): Promise<ConsentMap> {
  if (__DEV__) console.info('[authService] getMyConsents start');
  try {
    const res = await api.get('/auth/me/consents');
    if (__DEV__) console.info('[authService] getMyConsents success');
    return res.data?.consents ?? {};
  } catch (err: any) {
    console.error('[authService] getMyConsents failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}

// ── GuardSquad(v3.101, A-19) — 만 14세 미만 보호자 동의 ─────────────────────
// 개인정보 로그 금지: 생년월일·보호자 이름/연락처 값은 절대 로그에 남기지 않는다(길이만).

export interface SignupConfig {
  guardian_consent_enabled: boolean;
}

/** GET /auth/signup-config — 가입 플로우 설정(무인증). FE가 만 14세 미만 분기 UI를 결정. */
export async function getSignupConfig(): Promise<SignupConfig> {
  if (__DEV__) console.info('[authService] getSignupConfig start');
  try {
    const res = await api.get('/auth/signup-config');
    const enabled = !!res.data?.guardian_consent_enabled;
    if (__DEV__) console.info('[authService] getSignupConfig success', { guardianConsentEnabled: enabled });
    return { guardian_consent_enabled: enabled };
  } catch (err: any) {
    console.error('[authService] getSignupConfig failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}

/** 서버 GuardianConsentRequest 스키마(9004 실측)와 동일 — 가입 정보 + 보호자 정보. */
export interface GuardianConsentRequestBody {
  email: string;
  password: string;
  nickname: string;
  birth_date: string; // YYYY-MM-DD
  nationality?: string | null;
  gender?: string | null;
  region?: string | null;
  company_name?: string | null;
  display_title?: string | null;
  guardian_name: string;
  guardian_phone: string;
  /** register와 동일 형태({ version, terms, privacy, overseas, age14, marketing }) — 서버가 아동 경로도 필수 검증 */
  consents?: Record<string, any> | null;
}

export interface GuardianConsentRequestResult {
  status: string; // "pending"
  message: string;
  /** 알림 어댑터가 mock(테스트 모드)일 때만 내려옴 — FE가 바로 표시 */
  consent_url?: string | null;
}

/**
 * POST /auth/guardian-consent/request — 만 14세 미만 가입 요청.
 * 서버가 pending_consent 계정 + 동의 레코드를 만들고 보호자에게 동의 링크를 발송한다(현재 mock: consent_url 반환).
 * 승인 전에는 로그인 403("보호자 동의 대기 중입니다.").
 */
export async function requestGuardianConsent(
  body: GuardianConsentRequestBody
): Promise<GuardianConsentRequestResult> {
  if (__DEV__) {
    console.info('[authService] requestGuardianConsent start', {
      emailLen: body.email.length,
      guardianNameLen: body.guardian_name.length,
      guardianPhoneLen: body.guardian_phone.length,
    });
  }
  try {
    const res = await api.post('/auth/guardian-consent/request', body);
    if (__DEV__) {
      console.info('[authService] requestGuardianConsent success', {
        status: res.data?.status,
        hasConsentUrl: !!res.data?.consent_url,
      });
    }
    return res.data;
  } catch (err: any) {
    console.error('[authService] requestGuardianConsent failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}

export type GuardianConsentStatus = 'pending' | 'agreed' | 'rejected' | 'expired';

/**
 * GET /auth/guardian-consent/{token} — 동의 상태 조회(무인증).
 * 서버 계약: 200=pending / 409(body.status=agreed|rejected)=처리 완료 / 404=무효·만료.
 * 앱의 "상태 확인" 용도로 상태값으로 정규화해 반환한다(409·404는 throw하지 않음).
 */
export async function getGuardianConsentStatus(token: string): Promise<{ status: GuardianConsentStatus }> {
  if (__DEV__) console.info('[authService] getGuardianConsentStatus start', { tokenPrefix: token.slice(0, 8) });
  try {
    const res = await api.get(`/auth/guardian-consent/${token}`);
    if (__DEV__) console.info('[authService] getGuardianConsentStatus success', { status: res.data?.status });
    return { status: (res.data?.status as GuardianConsentStatus) || 'pending' };
  } catch (err: any) {
    const httpStatus = err?.response?.status;
    if (httpStatus === 409) {
      const decided = err.response?.data?.status;
      if (__DEV__) console.info('[authService] getGuardianConsentStatus decided', { status: decided });
      return { status: decided === 'agreed' ? 'agreed' : 'rejected' };
    }
    if (httpStatus === 404) {
      if (__DEV__) console.info('[authService] getGuardianConsentStatus expired/invalid');
      return { status: 'expired' };
    }
    console.error('[authService] getGuardianConsentStatus failed', { status: httpStatus, message: err?.message });
    throw err;
  }
}

/** consent_url(…/guardian-consent/{token})에서 상태 조회용 토큰 추출 — 실 SMS 전환으로 URL 미제공이면 null. */
export const guardianTokenFromUrl = (url?: string | null): string | null => {
  if (!url) return null;
  const m = url.match(/guardian-consent\/([^/?#]+)/);
  return m ? m[1] : null;
};

/** POST /auth/me/consents — 동의 append 기록. key는 서버 화이트리스트(marketing 등)만 허용. */
export async function recordConsents(
  consents: Array<{ key: string; agreed: boolean }>,
  version: string
): Promise<{ recorded: number }> {
  if (__DEV__) console.info('[authService] recordConsents start', { count: consents.length });
  try {
    const res = await api.post('/auth/me/consents', { consents, version });
    if (__DEV__) console.info('[authService] recordConsents success', { recorded: res.data?.recorded });
    return res.data;
  } catch (err: any) {
    console.error('[authService] recordConsents failed', { status: err?.response?.status, message: err?.message });
    throw err;
  }
}
