import api from './api';

// v3.294 [Block] 사용자 차단 — 서버 /api/dm/blocks (DM·피드·크루 게시판·댓글 공통 숨김 기준)

export interface BlockedUser {
  id: string;
  nickname: string | null;
  profile_image: string | null;
  code: string | null;
  blocked_at: string | null;
}

export async function listBlockedUsers(): Promise<BlockedUser[]> {
  if (__DEV__) console.info('[Block] GET /dm/blocks');
  try {
    const res = await api.get('/dm/blocks');
    const list = Array.isArray(res.data?.blocks) ? res.data.blocks : [];
    return list.filter((b: any) => b && b.id).map((b: any) => ({
      id: String(b.id),
      nickname: b.nickname ?? null,
      profile_image: b.profile_image ?? null,
      code: b.code ?? null,
      blocked_at: b.blocked_at ?? null,
    }));
  } catch (err: any) {
    console.error('[Block] 목록 조회 실패', { status: err?.response?.status, msg: err?.message });
    throw err;
  }
}

export async function blockUser(userId: string): Promise<void> {
  if (__DEV__) console.info('[Block] 차단', { userId });
  try {
    await api.post(`/dm/blocks/${userId}`);
  } catch (err: any) {
    console.error('[Block] 차단 실패', { userId, status: err?.response?.status });
    throw err;
  }
}

export async function unblockUser(userId: string): Promise<void> {
  if (__DEV__) console.info('[Block] 차단 해제', { userId });
  try {
    await api.delete(`/dm/blocks/${userId}`);
  } catch (err: any) {
    console.error('[Block] 차단 해제 실패', { userId, status: err?.response?.status });
    throw err;
  }
}
