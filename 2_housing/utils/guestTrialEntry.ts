// [guestTrialEntry] v3.276 — 게스트 작사 체험 진입(웰컴 팝업 CTA·작업실 게스트 탭 공용).
// 체험을 이미 쓴 기기는 로그인 모달로 유도한다. 네비게이션은 전역 ref(어느 화면에서든).
// v3.277 [GuestCompose]: 작사 체험은 썼지만 작곡 체험은 안 쓴 게스트 — 남아 있는 체험 가사가 있으면
// 가사 결과(LyricsResult)로 보내 '작곡하러 가기'로 작곡 체험을 이어가게 한다.
import { navigateGlobal } from '../services/navigationRef';
import { openLoginModal } from './loginModal';
import { isGuestTrialUsed, isGuestComposeUsed, getGuestPendingGen } from './guestTrial';
import { showAlert } from './appAlert';
import { useLyricsStore } from '../stores/lyricsStore';

export async function startGuestLyricsTrial(source: string): Promise<void> {
  let used = false;
  try { used = await isGuestTrialUsed(); } catch { used = false; }
  let composeUsed = true;
  if (used) {
    try { composeUsed = await isGuestComposeUsed(); } catch { composeUsed = true; }
  }
  const hasLyrics = used && !!useLyricsStore.getState().generatedLyrics?.trim() && !useLyricsStore.getState().error;
  console.info('[GuestTrial] 진입', { source, used, composeUsed: used ? composeUsed : undefined, hasLyrics });
  if (used && !composeUsed && hasLyrics) {
    // 작사 체험 결과가 남아 있음 → 가사 결과로(작곡 체험 진입점). 작사 디렉터 직행과 같은 배선(Map 하부 적재)
    navigateGlobal('MainTabs', {
      screen: 'Studio',
      params: { screen: 'LyricsResult', initial: false },
    });
    return;
  }
  if (used) {
    let pending: string | null = null;
    if (composeUsed) {
      try { pending = await getGuestPendingGen(); } catch { pending = null; }
    }
    showAlert(
      '체험은 1회예요',
      pending
        ? '가입하면 체험으로 만든 곡을 가져와 발매할 수 있어요. 3초면 끝나요.'
        : '가입하면 계속 만들 수 있어요. 3초면 끝나요.',
      [
        { text: '닫기', style: 'cancel' },
        { text: '가입하고 계속', onPress: () => openLoginModal({ reason: pending ? 'guest_compose_pending' : 'guest_trial_used' }) },
      ]
    );
    return;
  }
  // 작사 디렉터 직행 — makeLike.navigateToLyricsDirector 와 같은 배선(Map 을 하부에 적재)
  navigateGlobal('MainTabs', {
    screen: 'Studio',
    params: { screen: 'LyricsInput', initial: false, params: { guestTrial: true } },
  });
}
