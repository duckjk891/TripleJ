// v3.305 [ClubLink] 크루 가입 공용 흐름 — 크루 화면·크루 앨범 화면·로그인 직후 자동 가입이 같은 경로를 쓴다.
//  비로그인: 가입 의도를 1시간 보관 → 로그인 모달(이메일·소셜 리로드 모두 App 전역 processPendingClubJoin 이 이어감).
//  로그인: 보관된 초대 코드(이 크루 것)로 가입 — 크루 설정이 자동 승인이면 즉시 멤버, 아니면 승인 대기.
import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '../stores/authStore';
import { joinClub, type JoinResult } from '../services/clubService';
import { openLoginModal } from './loginModal';
import { showAlert } from './appAlert';
import { clearClubInvite, loadClubInviteCode, saveJoinIntent, takeJoinIntent } from './clubLink';

export type JoinFlowResult = JoinResult | 'login';

export async function joinClubFlow(clubId: string, opts: { inviteCode?: string; reason?: string } = {}): Promise<JoinFlowResult> {
  if (!useAuthStore.getState().user) {
    await saveJoinIntent(clubId);
    openLoginModal({ reason: opts.reason || 'club_join' });
    return 'login';
  }
  const inviteCode = opts.inviteCode || (await loadClubInviteCode(clubId)) || undefined;
  const result = await joinClub(clubId, inviteCode ? { inviteCode } : {});
  console.info('[ClubLink] 가입 처리', { club: clubId.slice(0, 8), invite: !!inviteCode, result });
  if (result === 'member') clearClubInvite('joined').catch(() => {});
  return result;
}

export function joinResultMessage(result: JoinResult, clubName?: string): { title: string; body: string } {
  const n = clubName ? `「${clubName}」` : '크루';
  return result === 'member'
    ? { title: '가입 완료', body: `${n}에 가입했어요!\n크루 앨범 테마에 맞춰 새 곡을 만들어 내면 참여 미션 ⭐5를 받아요.` }
    : { title: '가입 신청', body: '가입 신청을 보냈어요. 운영자 승인 후 함께할 수 있어요.' };
}

/**
 * 로그인 직후 1회 — 비로그인 때 누른 '크루 가입하기'를 이어서 처리하고 크루 화면으로 보낸다.
 * navigate 는 App 의 navigationRef 래퍼(로그인 착지(차트) 뒤에 실행되도록 호출부가 지연).
 */
export async function processPendingClubJoin(navigate: (name: string, params: any) => void): Promise<void> {
  const clubId = await takeJoinIntent();
  if (!clubId) return;
  try {
    const result = await joinClubFlow(clubId, { reason: 'club_join_resume' });
    if (result === 'login') return;
    navigate('MainTabs', { screen: 'ClubHome', params: { clubId, refreshAt: Date.now() } });
    const m = joinResultMessage(result);
    showAlert(m.title, m.body);
  } catch (err: any) {
    console.error('[ClubLink] 로그인 후 자동 가입 실패', { club: clubId.slice(0, 8), status: err?.response?.status });
    navigate('MainTabs', { screen: 'ClubHome', params: { clubId, refreshAt: Date.now() } });
    showAlert('알림', '크루 가입을 마치지 못했어요. 크루 화면에서 다시 눌러 주세요.');
  }
}

/** 공유 시트(지원 시) → 아니면 링크 복사. 반환: 'shared' | 'copied' | 'failed' */
export async function shareOrCopy(message: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    const canNative = Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function');
    if (canNative) {
      await Share.share({ message });
      return 'shared';
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'failed';
    console.warn('[ClubLink] 공유 시트 실패 — 복사로 대체', { message: err?.message });
  }
  try {
    await Clipboard.setStringAsync(url);
    showAlert('링크 복사', '링크를 복사했어요. 카카오톡 등에 붙여넣어 초대해 보세요.');
    return 'copied';
  } catch (err: any) {
    console.error('[ClubLink] 링크 복사 실패', { message: err?.message });
    showAlert('알림', '공유하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return 'failed';
  }
}
