// v3.352 [IdentityVerify] 기존 회원 본인인증(설정 「본인인증」·⭐ 유도 팝업 공용) — 결과별 안내 + 같은 사람 다른 계정이면 통합 화면.
// 웹(app.maidol.ai.kr)은 같은 탭 이동이라 결과는 복귀 후 SignupCompleteGate 가 이어 처리(handleIdentityResult 공용).
import { runIdentityVerification } from './identityFlow';
import { openAccountMerge } from './accountMerge';
import { showAlert } from './appAlert';
import { friendlyErrorMessage } from './friendlyError';
import { getMe } from '../services/authService';
import { useAuthStore } from '../stores/authStore';
import type { IdentityResult } from '../services/identityService';

async function refreshMe(): Promise<void> {
  try { useAuthStore.getState().setUser((await getMe()) as any); } catch { /* 표시용 갱신 실패 무시 */ }
}

/** 본인확인 결과 처리(설정·유도 팝업 경로). 만 14세 미만은 가입 마무리 화면이 앱 재조회로 이어받는다. */
export async function handleIdentityResult(r: IdentityResult, src: string): Promise<void> {
  console.info('[IdentityVerify] 결과', { src, status: r.status, merge: !!r.merge_candidate });
  if (r.status === 'merge_candidate' || r.merge_candidate) {
    if (!r.rid) { console.warn('[IdentityVerify] merge_candidate 인데 rid 없음'); return; }
    const o = await openAccountMerge(r.rid);
    if (o === 'declined') {
      showAlert('알림', '계정을 합치지 않았어요. 본인 명의 휴대폰으로 다시 인증하거나 고객센터(maidol_official@lotusai.co.kr)로 문의해 주세요.');
    }
    await refreshMe();
    return;
  }
  if (r.status === 'verified') {
    await refreshMe();
    showAlert('본인인증 완료', '본인인증이 완료됐어요. ⭐30을 드렸어요!');
    return;
  }
  if (r.status === 'cancelled' || r.status === 'pending') return;
  showAlert('본인인증', r.error || '본인인증을 마치지 못했어요. 다시 시도해 주세요.');
}

/** 본인인증 시작(purpose='verify') */
export async function startIdentityVerify(src: string): Promise<void> {
  try {
    const r = await runIdentityVerification('verify');
    await handleIdentityResult(r, src);
  } catch (err: any) {
    console.error('[IdentityVerify] 시작 실패', { src, status: err?.response?.status });
    showAlert('본인인증', friendlyErrorMessage(err));
  }
}
