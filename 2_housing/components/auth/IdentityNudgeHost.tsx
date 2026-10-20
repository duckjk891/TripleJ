// v3.352 [IdentityNudge] 기존 회원 본인인증 유도 — "본인인증하면 ⭐30"(대표 결정 ④). 1인 1계정 통합이 켜진 뒤에만(서버 account_merge_enabled).
// 대상: 로그인·미인증·어린이 아님·가입 마무리 대상 아님. 계정별 3일에 한 번. 로그인 뒤 6초 지연(다른 안내와 겹침 방지).
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../../stores/authStore';
import { getIdentityConfig, getOnboardingStatus } from '../../services/identityService';
import { showAlert } from '../../utils/appAlert';
import { startIdentityVerify } from '../../utils/identityVerify';
import { waitModalTurn } from '../../utils/modalTurn';

export const NUDGE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const KEY = (uid: string) => `maidol_identity_nudge_v1:${uid}`;
const DELAY_MS = 6000;

/** 지금 띄울 차례인가(순수) */
export function nudgeDue(lastShownAt: number | null, now = Date.now()): boolean {
  return !lastShownAt || now - lastShownAt >= NUDGE_INTERVAL_MS;
}

export default function IdentityNudgeHost() {
  const user = useAuthStore((s) => s.user) as any;
  const uid = user?.id != null ? String(user.id) : '';
  const verified = !!user?.is_verified;
  const kid = !!user?.kids_restricted || user?.age_group === 'child';

  useEffect(() => {
    if (!uid || verified || kid) return;
    let alive = true;
    let turn: ReturnType<typeof waitModalTurn> | null = null;
    const t = setTimeout(async () => {
      try {
        const cfg = await getIdentityConfig();
        if (!alive || !cfg?.enabled || !cfg.account_merge_enabled) return;
        const ob = await getOnboardingStatus();
        if (!alive || ob?.required) return; // 가입 마무리 화면이 본인확인을 이미 안내
        const raw = await AsyncStorage.getItem(KEY(uid)).catch(() => null);
        if (!alive || !nudgeDue(raw ? Number(raw) : null)) return;
        // v3.384 [ModalTurn]: 다른 팝업(출석·재동의·ATT 등)이 다 닫힌 뒤 차례로
        turn = waitModalTurn('identity-nudge', 0);
        await turn.promise;
        if (!alive) return;
        if (useAuthStore.getState().user?.id == null || String(useAuthStore.getState().user?.id) !== uid) return;
        AsyncStorage.setItem(KEY(uid), String(Date.now())).catch(() => {});
        console.info('[IdentityNudge] 유도 팝업 노출', { uid: uid.slice(0, 8) });
        showAlert(
          '본인인증하고 ⭐30 받기',
          '휴대폰 본인인증을 하면 ⭐30을 드려요.\n혹시 MAIDOL 계정이 여러 개라면 하나로 합쳐 드려요.',
          [
            { text: '나중에', style: 'cancel', onPress: () => console.info('[IdentityNudge] 나중에') },
            { text: '본인인증하기', onPress: () => { void startIdentityVerify('nudge'); } },
          ],
        );
      } catch (err: any) {
        console.error('[IdentityNudge] 확인 실패', { message: err?.message });
      }
    }, DELAY_MS);
    return () => { alive = false; clearTimeout(t); turn?.cancel(); };
  }, [uid, verified, kid]);

  return null;
}
