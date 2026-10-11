// v3.341 [PolicyConsentGate] 개정 처리방침(국외 이전) 미동의 회원 — 디렉터(AI) 작업 진입 시 동의 필수.
// 대표 결정(10-11): "모든 디렉터가 AI 이므로 동의를 안 했다면 디렉터와 대화할 때 동의 팝업, 동의 안 하면 대화 취소 → 작업실".
//  · 동의 = POST /auth/me/consents privacy·overseas(CONSENT_VERSION) — 실행 중 사용자별 캐시(다시 묻지 않음)
//  · 신규 이메일 가입자는 가입 때 최신 판에 동의 → 통과. 비로그인(게스트 체험)·어린이 계정(법정대리인 대상)은 게이트 제외.
//  · 화면은 components/consent/PolicyConsentHost(App 루트 1개)가 그린다.
import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { create } from 'zustand';
import { getMyConsents, recordConsents } from '../services/authService';
import { CONSENT_VERSION } from '../constants/consentTexts';
import { useAuthStore } from '../stores/authStore';
import { isChildNow } from './kidsMode';
import { navigationRef } from '../services/navigationRef';

interface PolicyConsentState {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}
export const usePolicyConsentStore = create<PolicyConsentState>(() => ({ visible: false, resolve: null }));

let agreedFor: string | null = null;
let pending: Promise<boolean> | null = null;

/** 최신 판 국외 이전 동의 여부(순수) */
export function hasCurrentPolicyConsent(consents: Record<string, { agreed?: boolean; version?: string } | undefined>, current = CONSENT_VERSION): boolean {
  const o = consents?.overseas;
  return !!(o?.agreed && o?.version === current);
}

/** 앱 시작 재동의 팝업 등에서 동의를 기록했을 때 — 게이트가 다시 묻지 않게 */
export function markPolicyAgreed(uid: string) {
  agreedFor = uid;
}

/** 동의돼 있으면 true, 아니면 동의 팝업 → 동의 기록 성공 시 true / 거절·실패 false */
export function ensurePolicyConsent(source: string): Promise<boolean> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return Promise.resolve(true);
  if (isChildNow()) return Promise.resolve(true);
  const key = String(uid);
  if (agreedFor === key) return Promise.resolve(true);
  if (pending) return pending;
  pending = (async () => {
    try {
      const consents = await getMyConsents();
      if (hasCurrentPolicyConsent(consents as any)) {
        agreedFor = key;
        return true;
      }
    } catch (err: any) {
      // 조회 실패는 막지 않는다(서버 장애로 작업 전체가 막히지 않게) — 다음 진입 때 다시 확인
      console.warn('[PolicyConsentGate] 동의 조회 실패 — 통과', { status: err?.response?.status, source });
      return true;
    }
    console.info('[PolicyConsentGate] 동의 팝업', { source, version: CONSENT_VERSION });
    const ok = await new Promise<boolean>((resolve) => usePolicyConsentStore.setState({ visible: true, resolve }));
    usePolicyConsentStore.setState({ visible: false, resolve: null });
    if (!ok) {
      console.info('[PolicyConsentGate] 동의 안 함 — 작업 취소', { source });
      return false;
    }
    try {
      await recordConsents([{ key: 'privacy', agreed: true }, { key: 'overseas', agreed: true }], CONSENT_VERSION);
      agreedFor = key;
      console.info('[PolicyConsentGate] 동의 기록', { source });
      return true;
    } catch (err: any) {
      console.error('[PolicyConsentGate] 동의 기록 실패', { status: err?.response?.status, source });
      return false;
    }
  })().finally(() => { pending = null; });
  return pending;
}

/** 작업실(지도)로 돌아가기 */
export function goBackToStudio(source: string) {
  if (!navigationRef.isReady()) return;
  console.info('[PolicyConsentGate] 작업실로 복귀', { source });
  (navigationRef.navigate as any)('MainTabs', { screen: 'Studio', params: { screen: 'Map', pop: true } });
}

/** 디렉터 화면에서 호출 — 화면에 들어올 때마다 확인(동의 후엔 캐시로 즉시 통과), 거절하면 작업실로 */
export function useAiConsentGate(screen: string) {
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void ensurePolicyConsent(screen).then((ok) => {
        if (alive && !ok) goBackToStudio(screen);
      });
      return () => { alive = false; };
    }, [screen]),
  );
}
