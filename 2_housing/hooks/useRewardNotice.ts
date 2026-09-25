// v3.230 A7-2 [RewardNotice] 가입 선물·추천 보상 1회 안내 — 로그인 계정 확정 직후 + 앱 복귀(active) 시
// GET /points/history 를 보고 미확인 보상을 앱 내 팝업(showAlert)으로 알린다. App 루트(GlobalModals)에서 1회 호출.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { usePointsStore } from '../stores/pointsStore';
import { getPointsHistory } from '../services/pointsHistoryService';
import { navigateGlobal } from '../services/navigationRef';
import { showAlert } from '../utils/appAlert';
import {
  buildRewardNotice,
  loadSeenRecord,
  mergeSeenRecord,
  saveSeenRecord,
} from '../utils/rewardNotice';
import {
  clearPendingReferral,
  clearSignupReferral,
  loadPendingReferral,
  peekSignupReferral,
} from '../utils/pendingReferral';

const LOGIN_DELAY_MS = 1500; // 로그인 직후 차트 착지·스플래시 전환이 끝난 뒤 안내
const RESUME_THROTTLE_MS = 5 * 60 * 1000; // 앱 복귀 재확인 최소 간격

let running = false;
let runningUid = '';
let recheckAfterRun = false; // 확인 중 다른 계정으로 바뀌면 끝난 뒤 새 계정 기준으로 1회 재확인
let lastCheckAt = 0;

export async function checkRewardNotice(trigger: 'login' | 'resume'): Promise<void> {
  const user = useAuthStore.getState().user;
  const uid = user?.id ? String(user.id) : '';
  if (!uid) return;
  if (running) {
    // 같은 계정 동시 트리거(로그인·가입·복귀)는 1회로 합친다(in-flight dedup)
    if (runningUid !== uid) recheckAfterRun = true;
    if (__DEV__) console.info('[RewardNotice] 이미 확인 중 — 건너뜀', { trigger, sameUser: runningUid === uid });
    return;
  }
  const now = Date.now();
  if (trigger === 'resume' && now - lastCheckAt < RESUME_THROTTLE_MS) return;
  running = true;
  runningUid = uid;
  lastCheckAt = now;
  console.info('[RewardNotice] 확인 시작', { trigger });
  try {
    const [events, seen, pending] = await Promise.all([
      getPointsHistory(50),
      loadSeenRecord(uid, now),
      loadPendingReferral(now),
    ]);
    // 확인 중 계정이 바뀌었으면(로그아웃·전환) 폐기
    if (String(useAuthStore.getState().user?.id ?? '') !== uid) {
      console.info('[RewardNotice] 계정 전환 감지 — 폐기');
      return;
    }
    const signupRef = peekSignupReferral();
    const referralAttempted = !!pending || !!signupRef?.code;
    const plan = buildRewardNotice(events, { now, seen: seen.rec.keys, referralAttempted });
    console.info('[RewardNotice] 판정', {
      trigger,
      events: events.length,
      dialogs: plan.dialogs.map((d) => d.kind),
      signupDetected: plan.signupDetected,
      referralApplied: plan.referralApplied,
      referralAttempted,
      firstRun: seen.isFirstRun,
    });
    // 확인 기록은 팝업 전에 저장(연속 트리거 중복 표시 방지) — 첫 실행도 기록을 남겨 기준 시각 확정
    if (plan.markSeen.length > 0 || seen.isFirstRun) {
      await saveSeenRecord(uid, mergeSeenRecord(seen.rec, plan.markSeen, now));
    }
    if (plan.signupDetected) {
      // 가입 확인 = 보관 추천코드 소진(적용 여부와 무관 — 가입은 1회뿐)
      if (pending) await clearPendingReferral(plan.referralApplied ? 'signup-applied' : 'signup-not-applied');
      clearSignupReferral();
    }
    if (plan.dialogs.length > 0) {
      usePointsStore.getState().fetchBalance();
      plan.dialogs.forEach((d) => {
        showAlert(d.title, d.message, [
          { text: '확인', style: 'cancel' },
          {
            text: '스타 내역 보기',
            onPress: () => {
              console.info('[RewardNotice] 스타 내역 이동', { kind: d.kind });
              navigateGlobal('StarHistory');
            },
          },
        ]);
      });
    }
  } catch (err: any) {
    console.error('[RewardNotice] 확인 실패', { trigger, status: err?.response?.status, message: err?.message });
  } finally {
    running = false;
    runningUid = '';
    if (recheckAfterRun) {
      recheckAfterRun = false;
      checkRewardNotice('login');
    }
  }
}

export function useRewardNotice() {
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => { checkRewardNotice('login'); }, LOGIN_DELAY_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') checkRewardNotice('resume');
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [userId]);
}
