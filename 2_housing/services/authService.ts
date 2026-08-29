// [authService] 계정 위생 API — 내 정보 조회, 프로필 이미지 업로드/삭제, 동의 이력 조회/기록.
// 계약 근거: MAIDOL backend_9004 app/routes/auth.py
//   GET  /auth/me                      → user 필드 flat 객체(birth_date/gender/region/sns_links 포함)
//   POST /auth/me/profile-image        → multipart field `image` (jpeg/png/webp, ≤5MB) → { profile_image: "profiles/.." }
//   DELETE /auth/me/profile-image      → { profile_image: null } (기본 이니셜 복귀)
//   GET  /auth/profile-image/{object}  → 무인증 이미지 프록시 (표시용 URL)
//   GET  /auth/me/consents             → { consents: { [key]: { agreed, version, at } } }
//   POST /auth/me/consents             → { consents: [{ key, agreed }], version } → { recorded: n }
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
