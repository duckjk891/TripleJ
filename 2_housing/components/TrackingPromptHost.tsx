// v3.384 [ATT] 로그인 직후 추적 허용(ATT) 1회 — 렌더 없음. 규칙·이유는 utils/trackingConsent.ts.
// 가입 마무리(본인확인·나이 확인)가 남은 계정은 나이를 모르므로 묻지 않고, 끝나서 user 가 갱신되면 다시 판정한다.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { getOnboardingStatus } from '../services/identityService';
import { isKidsRestrictedUser } from '../utils/kidsRestricted';
import { isTrackingAsked, markTrackingNotNeeded, primeTrackingStatus, requestTrackingOnce } from '../utils/trackingConsent';

const isChildUser = (u: any): boolean => isKidsRestrictedUser(u) || u?.age_group === 'child';

export default function TrackingPromptHost() {
  const user = useAuthStore((s) => s.user) as any;

  useEffect(() => {
    void primeTrackingStatus();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios' || user?.id == null) return undefined;
    if (isChildUser(user)) {
      markTrackingNotNeeded('child');
      return undefined;
    }
    if (isTrackingAsked()) return undefined;
    const uid = String(user.id);
    let alive = true;
    (async () => {
      const ob = await getOnboardingStatus();
      if (!alive) return;
      if (ob?.required) {
        console.info('[ATT] 가입 마무리 전 — 나중에 요청');
        return;
      }
      if (ob?.is_minor) {
        markTrackingNotNeeded('minor');
        return;
      }
      const now = useAuthStore.getState().user as any;
      if (now?.id == null || String(now.id) !== uid || isChildUser(now)) return;
      await requestTrackingOnce('login', { waitTurn: true });
    })().catch((err: any) => console.warn('[ATT] 로그인 후 요청 처리 실패', { message: err?.message }));
    return () => {
      alive = false;
    };
  }, [user]);

  return null;
}
