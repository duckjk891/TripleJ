// v3.360 [PhotoConsent] 얼굴 사진 AI 처리 동의 — 실사 아티스트 사진 고르기 직전 1회(대표 10-14 결정 (가)). voiceConsent 와 같은 구조.
// Apple 5.1.2(i)(개인 데이터를 외부 AI 로 보내기 전 고지·명시 동의)·Play 사용자 데이터 정책.
// 동의 기록 = 서버 user_consents(key photo_ai, version PHOTO_AI_CONSENT_VERSION). 같은 판에 동의했으면 다시 묻지 않는다.
// 화면은 PhotoConsentHost(App 루트)가 그린다 — ensurePhotoAiConsent() 가 열고 사용자의 선택을 기다린다.
import { create } from 'zustand';
import { getMyConsents, recordConsents } from '../services/authService';
import { PHOTO_AI_CONSENT_VERSION } from '../constants/consentTexts';
import { useAuthStore } from '../stores/authStore';

interface PhotoConsentState {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}

export const usePhotoConsentStore = create<PhotoConsentState>(() => ({ visible: false, resolve: null }));

let agreedFor: string | null = null; // 이번 실행에서 동의 확인된 사용자 id

/** 동의돼 있으면 true, 아니면 동의 화면을 띄워 결과를 돌려준다(동의 기록 실패 = false). */
export async function ensurePhotoAiConsent(source: string): Promise<boolean> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return true; // 비로그인은 이 기능에 도달하지 않음(로그인 게이트가 먼저) — 막지 않는다
  const userKey = String(uid);
  if (agreedFor === userKey) return true;
  try {
    const consents = await getMyConsents();
    const c = (consents as any)?.photo_ai;
    if (c?.agreed && c?.version === PHOTO_AI_CONSENT_VERSION) {
      agreedFor = userKey;
      return true;
    }
  } catch (err: any) {
    console.warn('[PhotoConsent] 동의 조회 실패 — 화면으로 확인', { status: err?.response?.status });
  }
  console.info('[PhotoConsent] 동의 화면 표시', { source });
  const ok = await new Promise<boolean>((resolve) => {
    usePhotoConsentStore.setState({ visible: true, resolve });
  });
  usePhotoConsentStore.setState({ visible: false, resolve: null });
  if (!ok) {
    console.info('[PhotoConsent] 동의하지 않음', { source });
    return false;
  }
  try {
    await recordConsents([{ key: 'photo_ai', agreed: true }], PHOTO_AI_CONSENT_VERSION);
    agreedFor = userKey;
    console.info('[PhotoConsent] 동의 기록', { source });
    return true;
  } catch (err: any) {
    console.error('[PhotoConsent] 동의 기록 실패', { status: err?.response?.status, source });
    return false;
  }
}

/** 로그아웃·계정 전환 시 캐시 비움 */
export function resetPhotoConsentCache() {
  agreedFor = null;
}
