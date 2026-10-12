// v3.343 [CrewPreview] 크루 비회원 1분 미리 듣기 — 크루 플레이리스트·앨범을 비회원이 재생하면 곡마다 1분에서 멈추고
// "크루에 가입하면 끝까지 들을 수 있어요" 안내(대표 10-12: 초대·공유 링크로 와서 1분 듣고, 더 들으려면 가입).
// 제한은 playerStore.previewLimit(크루 화면이 큐를 바꿀 때 설정) — 다른 곡을 큐에 담아 듣는 건 영향 없음.
import { usePlayerStore } from '../stores/playerStore';
import { showAlert } from './appAlert';
import { navigateGlobal } from '../services/navigationRef';
import { requestDeferredWelcome } from './deferredWelcome';

export const CREW_PREVIEW_SEC = 60;
let lastNoticeAt = 0;

/** 지금 상태에서 멈춰야 하는가(순수) */
export function shouldStopPreview(s: { previewLimit: any; track: any; isPlaying: boolean; position: number }): boolean {
  const lim = s.previewLimit;
  if (!lim || !s.isPlaying) return false;
  const tid = s.track?.id != null ? String(s.track.id) : '';
  if (!tid || !lim.trackIds.includes(tid)) return false;
  return (s.position || 0) >= lim.sec * 1000;
}

/** 앱 시작 시 1회 — 재생 위치를 지켜보다 제한에 닿으면 일시정지 + 가입 안내 */
export function initCrewPreviewWatcher(): () => void {
  return usePlayerStore.subscribe((s) => {
    if (!shouldStopPreview(s as any)) return;
    const lim = s.previewLimit!;
    console.info('[CrewPreview] 1분 미리 듣기 끝 — 일시정지', { club: lim.clubId.slice(0, 8), track: String(s.track?.id ?? '') });
    s.sound?.pauseAsync().catch(() => {});
    s.setIsPlaying(false);
    if (Date.now() - lastNoticeAt < 3000) return;
    lastNoticeAt = Date.now();
    showAlert('1분 미리 듣기가 끝났어요', `${lim.clubName ? `「${lim.clubName}」 ` : ''}크루에 가입하면 끝까지 들을 수 있어요.`, [
      // v3.346: 닫기 = (크루 링크로 처음 온 비로그인이면) 미뤄 둔 체험 안내 노출
      { text: '닫기', style: 'cancel', onPress: () => requestDeferredWelcome('preview_end') },
      {
        text: '크루 가입하러 가기',
        onPress: () => navigateGlobal('MainTabs', { screen: 'ClubHome', params: { clubId: lim.clubId, initialTab: 'playlists', refreshAt: Date.now() } }),
      },
    ]);
  });
}
