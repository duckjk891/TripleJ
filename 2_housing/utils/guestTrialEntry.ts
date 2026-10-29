// [guestTrialEntry] v3.276 — 게스트 작사 체험 진입(웰컴 팝업 CTA·작업실 게스트 탭 공용).
// 체험을 이미 쓴 기기는 로그인 모달로 유도한다. 네비게이션은 전역 ref(어느 화면에서든).
// v3.277 [GuestCompose]: 작사 체험은 썼지만 작곡 체험은 안 쓴 게스트 — 남아 있는 체험 가사가 있으면
// 가사 결과(LyricsResult)로 보내 '작곡하러 가기'로 작곡 체험을 이어가게 한다.
import { navigateGlobal, whenPastSplash } from '../services/navigationRef';
import { openLoginModal } from './loginModal';
import { isGuestTrialUsed, isGuestComposeUsed, getGuestPendingGen } from './guestTrial';
import { showAlert } from './appAlert';
import { useLyricsStore } from '../stores/lyricsStore';
import { clearStorySong, setStoryInput, storySongAvailable } from './storySong'; // v3.413 체험 = 재료 담기

export async function startGuestLyricsTrial(source: string): Promise<void> {
  // v3.419: 시작 화면(5초) 중에 누르면, 시작 화면이 끝난 뒤 이동(그 전에 가면 시작 화면이 차트로 덮어씀)
  await whenPastSplash();
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
  // v3.413(대표 10-26 "재료담기로 연결해"): 처음 오는 분의 '무료로 한 곡 만들어보기'는 재료 담기(낙서·사진 → 노래)로.
  // 글 한 줄 → 내 마음 들여다보기(게스트 1번) → 기존 무료 작사·작곡 체험으로 이어진다. 서버가 아직 모르면 종전처럼 작사 디렉터.
  if (await storySongAvailable()) {
    clearStorySong('guest_trial');
    setStoryInput(null);
    console.info('[GuestTrial] 재료 담기로', { source });
    navigateGlobal('MainTabs', {
      screen: 'Studio',
      params: { screen: 'StorySongInput', initial: false, params: { nonce: `trial-${Date.now()}` } },
    });
    return;
  }
  // 작사 디렉터 직행 — makeLike.navigateToLyricsDirector 와 같은 배선(Map 을 하부에 적재)
  navigateGlobal('MainTabs', {
    screen: 'Studio',
    params: { screen: 'LyricsInput', initial: false, params: { guestTrial: true } },
  });
}
