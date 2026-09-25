// [followService] v3.233 — 서로 팔로우(맞팔) 목록. 어린이 DM(보호자 dm_friends 허용) 상대 찾기 전용.
// 계약(기존 서버 follows.py, 신규 엔드포인트 없음):
//   GET /follows/followers?page&limit → { followers: [{id, nickname, profile_image, followed_at}], total }
//   GET /follows/following?page&limit → { following: [...], total }
// 맞팔 = 두 목록의 id 교집합(서버 F1 dm_friends 게이트의 "서로 팔로우" 판정과 같은 follows 테이블 기준).
// 실패는 null(호출 측이 "공식 계정만" 으로 안전 강등). 닉네임·id 원문은 로그에 남기지 않는다(개수만).
import api from './api';

export interface FollowUser {
  id: string;
  nickname: string;
  profile_image?: string | null;
}

export const FOLLOW_PAGE_LIMIT = 100;
export const FOLLOW_MAX_PAGES = 10; // 최대 1,000명 — 어린이 계정 규모에서 충분, 무한 루프 방지

type FollowKind = 'followers' | 'following';

function toUser(r: any): FollowUser | null {
  if (!r || r.id === undefined || r.id === null) return null;
  return { id: String(r.id), nickname: typeof r.nickname === 'string' ? r.nickname : '', profile_image: r.profile_image ?? null };
}

/** 한 방향 목록 전체(페이지 순회). 실패 시 throw — fetchMutualFollows 가 null 로 강등 */
export async function fetchAllFollows(kind: FollowKind): Promise<FollowUser[]> {
  const out: FollowUser[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= FOLLOW_MAX_PAGES; page++) {
    const res = await api.get(`/follows/${kind}`, { params: { page, limit: FOLLOW_PAGE_LIMIT } });
    const rows: any[] = Array.isArray(res.data?.[kind]) ? res.data[kind] : [];
    for (const r of rows) {
      const u = toUser(r);
      if (u && !seen.has(u.id)) { seen.add(u.id); out.push(u); }
    }
    const total = typeof res.data?.total === 'number' ? res.data.total : null;
    if (rows.length < FOLLOW_PAGE_LIMIT || (total !== null && out.length >= total)) break;
  }
  return out;
}

/** 맞팔 교집합 — 순서는 내가 팔로우한 목록(following) 기준 */
export function intersectMutual(followers: FollowUser[], following: FollowUser[]): FollowUser[] {
  const followerIds = new Set(followers.map((u) => String(u.id)));
  return following.filter((u) => followerIds.has(String(u.id)));
}

/** 서로 팔로우한 사용자 목록. 실패 시 null */
export async function fetchMutualFollows(): Promise<FollowUser[] | null> {
  try {
    const [followers, following] = await Promise.all([fetchAllFollows('followers'), fetchAllFollows('following')]);
    const mutual = intersectMutual(followers, following);
    console.info('[KidsDM] mutual follows', { followers: followers.length, following: following.length, mutual: mutual.length });
    return mutual;
  } catch (err: any) {
    console.error('[KidsDM] 맞팔 목록 조회 실패', { status: err?.response?.status ?? null, message: err?.message });
    return null;
  }
}
