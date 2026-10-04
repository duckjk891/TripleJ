// [guestTrialEntry] v3.276 — 게스트 작사 체험 진입(웰컴 팝업 CTA·작업실 게스트 탭 공용).
// 체험을 이미 쓴 기기는 로그인 모달로 유도한다. 네비게이션은 전역 ref(어느 화면에서든).
import { navigateGlobal } from '../services/navigationRef';
import { openLoginModal } from './loginModal';
import { isGuestTrialUsed } from './guestTrial';
import { showAlert } from './appAlert';

export async function startGuestLyricsTrial(source: string): Promise<void> {
  let used = false;
  try { used = await isGuestTrialUsed(); } catch { used = false; }
  console.info('[GuestTrial] 진입', { source, used });
  if (used) {
    showAlert('체험은 1회예요', '가입하면 계속 만들 수 있어요. 3초면 끝나요.', [
      { text: '닫기', style: 'cancel' },
      { text: '가입하고 계속', onPress: () => openLoginModal({ reason: 'guest_trial_used' }) },
    ]);
    return;
  }
  // 작사 디렉터 직행 — makeLike.navigateToLyricsDirector 와 같은 배선(Map 을 하부에 적재)
  navigateGlobal('MainTabs', {
    screen: 'Studio',
    params: { screen: 'LyricsInput', initial: false, params: { guestTrial: true } },
  });
}
