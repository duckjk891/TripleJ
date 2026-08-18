import { create } from 'zustand';
import api from '../services/api';

// [likesStore] 곡 좋아요 — 백엔드 연동(POST/DELETE /likes/{id}, GET /likes/check?song_ids=).
// 화면 전역에서 하트 상태를 공유해 차트/피드/채널 어디서 눌러도 일관되게 반영.
interface LikesState {
  liked: Record<string, boolean>;       // trackId → 좋아요 여부
  busy: Record<string, boolean>;        // 토글 진행 중(중복 클릭 방지)
  isLiked: (trackId: string) => boolean;
  sync: (trackIds: string[]) => Promise<void>;   // 보이는 곡들의 좋아요 여부 일괄 조회
  toggle: (trackId: string) => Promise<boolean>; // 낙관적 토글 → 실패 시 롤백. 반환=최종 상태
}

export const useLikesStore = create<LikesState>((set, get) => ({
  liked: {},
  busy: {},

  isLiked: (trackId) => !!get().liked[trackId],

  sync: async (trackIds) => {
    const ids = trackIds.filter(Boolean);
    if (!ids.length) return;
    if (__DEV__) console.info('[likesStore] sync', { count: ids.length });
    try {
      const { data } = await api.get('/likes/check', { params: { song_ids: ids.join(',') } });
      const likedIds: string[] = data?.liked_ids || [];
      set((s) => {
        const next = { ...s.liked };
        ids.forEach((id) => { next[id] = false; });   // 조회 대상은 기본 false
        likedIds.forEach((id) => { next[id] = true; });
        return { liked: next };
      });
    } catch (err: any) {
      // 미로그인(401) 등은 조용히 — 하트 비활성 상태 유지
      if (err?.response?.status !== 401) {
        console.error('[likesStore] sync 실패', { status: err?.response?.status });
      }
    }
  },

  toggle: async (trackId) => {
    if (!trackId || get().busy[trackId]) return get().isLiked(trackId);
    const prev = get().isLiked(trackId);
    const next = !prev;
    // 낙관적 반영
    set((s) => ({ liked: { ...s.liked, [trackId]: next }, busy: { ...s.busy, [trackId]: true } }));
    if (__DEV__) console.info('[likesStore] toggle', { trackId, next });
    try {
      if (next) await api.post(`/likes/${trackId}`);
      else await api.delete(`/likes/${trackId}`);
      return next;
    } catch (err: any) {
      // "이미 좋아요한 트랙"(중복) 은 목표 상태와 동일하므로 성공 취급
      const dupOk = next && err?.response?.status === 400;
      if (!dupOk) {
        console.error('[likesStore] toggle 실패 → 롤백', { trackId, status: err?.response?.status });
        set((s) => ({ liked: { ...s.liked, [trackId]: prev } }));
        return prev;
      }
      return next;
    } finally {
      set((s) => ({ busy: { ...s.busy, [trackId]: false } }));
    }
  },
}));
