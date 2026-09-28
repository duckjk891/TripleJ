// [clubService] v3.245 커뮤니티 Phase 1b — 클럽 코어 API(계약 고정, 백엔드 동시 개발).
// 서버가 아직 미배포일 수 있어(404/네트워크 오류) 모든 호출자는 실패를 빈/안내 상태로 강등한다 — 크래시 금지.
// 계약:
//   POST   /clubs {name(≤30), description(≤300)} → 201 {id,name,description,member_count,owner_id,role}
//          409 code 'club_limit'(계정당 1개) | 'club_name_taken' · 400 code 'word_filtered'
//   GET    /clubs?sort=new|members&limit&before= → { clubs:[{id,name,description,member_count,owner_id,is_member,created_at}], next_before }
//   GET    /clubs/{id} → detail + is_member + role
//   POST   /clubs/{id}/join · DELETE /clubs/{id}/join (owner 탈퇴 → 400 'owner_cannot_leave')
//   GET    /clubs/mine → 내 가입 클럽 목록
//   게시판: GET /feeds/club/{club_id}?limit&before= → { feeds, next_before } (공개 읽기, 글쓰기는 멤버만 — 403 'club_members_only')
//   클럽 플리: POST /playlists {title, club_id} · GET /clubs/{id}/playlists → [{id,title,track_count,...}]
import api from './api';

export type ClubSort = 'new' | 'members';

export interface Club {
  id: string;
  name: string;
  description?: string;
  member_count?: number;
  owner_id?: string;
  is_member?: boolean;
  created_at?: string;
  /** 'owner' | 'member' — 서버가 내 역할을 알 때만 */
  role?: string | null;
}

export interface ClubListPage {
  clubs: Club[];
  next_before: string | null;
}

export interface ClubPlaylist {
  id: string;
  title?: string;
  name?: string;
  track_count?: number;
}

export interface ClubFeedPage {
  feeds: any[];
  next_before: string | null;
}

/** 서버 오류 코드(409/400/403 공통 셰이프 {code} 또는 {detail:{code}}) — 없으면 null */
export function getClubErrorCode(err: any): string | null {
  try {
    const data = err?.response?.data;
    if (!data || typeof data !== 'object') return null;
    for (const d of [data, data.detail]) {
      if (d && typeof d === 'object' && typeof d.code === 'string') return d.code;
    }
    return null;
  } catch {
    return null;
  }
}

const normClub = (c: any): Club => ({ ...c, id: String(c?.id ?? '') });

export async function createClub(name: string, description: string): Promise<Club> {
  if (__DEV__) console.info('[Club] createClub', { nameLen: name.length, descLen: description.length });
  // v3.245 게이트픽스 BUG-1: canonical '/clubs/' — 무슬래시는 307, Android OkHttp가 POST 307 미추종
  const res = await api.post('/clubs/', { name, description });
  return normClub(res.data);
}

export async function listClubs(opts: { sort?: ClubSort; limit?: number; before?: string | null } = {}): Promise<ClubListPage> {
  const params: Record<string, any> = { sort: opts.sort || 'new', limit: opts.limit ?? 20 };
  if (opts.before) params.before = opts.before;
  if (__DEV__) console.info('[Club] listClubs', params);
  const res = await api.get('/clubs/', { params }); // v3.245 게이트픽스 BUG-1: 307 왕복 제거
  const clubs: Club[] = Array.isArray(res.data?.clubs) ? res.data.clubs.map(normClub) : [];
  return { clubs, next_before: res.data?.next_before ?? null };
}

export async function getClub(clubId: string): Promise<Club> {
  if (__DEV__) console.info('[Club] getClub', { clubId });
  const res = await api.get(`/clubs/${clubId}`);
  // v3.245 게이트픽스 BUG-2: 서버 상세는 {club:{…}} 래핑 — 언랩(구서버 평면 응답도 수용)
  return normClub(res.data?.club ?? res.data);
}

export async function joinClub(clubId: string): Promise<void> {
  if (__DEV__) console.info('[Club] joinClub', { clubId });
  await api.post(`/clubs/${clubId}/join`);
}

export async function leaveClub(clubId: string): Promise<void> {
  if (__DEV__) console.info('[Club] leaveClub', { clubId });
  await api.delete(`/clubs/${clubId}/join`);
}

/** 내가 가입한 클럽 — 실패는 throw(호출자가 빈 목록으로 강등) */
export async function getMyClubs(): Promise<Club[]> {
  if (__DEV__) console.info('[Club] getMyClubs');
  const res = await api.get('/clubs/mine');
  const rows: any[] = Array.isArray(res.data) ? res.data : (res.data?.clubs || []);
  return rows.map(normClub);
}

/** 클럽 게시판(공개 읽기) — 기존 feeds 파이프라인 재사용(kind='club') */
export async function listClubFeeds(clubId: string, opts: { limit?: number; before?: string | null } = {}): Promise<ClubFeedPage> {
  const params: Record<string, any> = { limit: opts.limit ?? 20 };
  if (opts.before) params.before = opts.before;
  if (__DEV__) console.info('[Club] listClubFeeds', { clubId, ...params });
  const res = await api.get(`/feeds/club/${clubId}`, { params });
  const feeds: any[] = Array.isArray(res.data?.feeds) ? res.data.feeds : (Array.isArray(res.data) ? res.data : []);
  return { feeds, next_before: res.data?.next_before ?? null };
}

export async function listClubPlaylists(clubId: string): Promise<ClubPlaylist[]> {
  if (__DEV__) console.info('[Club] listClubPlaylists', { clubId });
  const res = await api.get(`/clubs/${clubId}/playlists`);
  const rows: any[] = Array.isArray(res.data) ? res.data : (res.data?.playlists || []);
  return rows.map((p) => ({ ...p, id: String(p?.id ?? '') }));
}

/** 클럽 공유 플레이리스트 생성 — 곡 담기는 기존 /playlists/{id}/tracks 그대로(added_by는 서버 몫) */
export async function createClubPlaylist(clubId: string, title: string): Promise<ClubPlaylist> {
  if (__DEV__) console.info('[Club] createClubPlaylist', { clubId, titleLen: title.length });
  const res = await api.post('/playlists/', { title, club_id: clubId });
  return { ...res.data, id: String(res.data?.id ?? '') };
}

// ── v3.247 운영자 위임 — 서버 스테이징 확정 계약(플랫 셰이프, 미배포 시 404 → 호출자가 안내로 강등):
//   GET  /clubs/{id}/transfer-candidates → { candidates:[{user_id, nickname, joined_at,
//        tenure_ok, posts, comments, playlist_adds, owns_other_club}] }
//        (어린이 멤버는 서버가 후보에서 제외 — 앱 추가 처리 불필요)
//   POST /clubs/{id}/transfer-owner {new_owner_id} → 200
//        403(비owner) · 400 'transferee_not_member'|'transferee_not_eligible'
//        · 409 'club_limit'(수임자가 이미 클럽 운영 중)|'conflict'
export interface TransferCandidate {
  user_id: string;
  nickname?: string;
  joined_at?: string;
  tenure_ok?: boolean;
  posts?: number;
  comments?: number;
  playlist_adds?: number;
  owns_other_club?: boolean;
  /** 앱 파생 — 아래 규칙으로 normalize 시 계산(필드 미비 구응답은 선택 가능으로 방어) */
  eligible: boolean;
  /** 자격 미달 사유(파생) — 목록에서 흐리게 + 사유 표시용 */
  reason?: string;
}

/** 자격 파생 규칙(서버 확정): owns_other_club → 미달 / tenure_ok=false && 활동 0 → 미달 / 그 외 가능 */
const normCandidate = (c: any): TransferCandidate => {
  const activity = (c?.posts ?? 0) + (c?.comments ?? 0) + (c?.playlist_adds ?? 0);
  let eligible = true;
  let reason: string | undefined;
  if (c?.owns_other_club === true) {
    eligible = false;
    reason = '다른 클럽 운영자예요';
  } else if (c?.tenure_ok === false && activity === 0) {
    eligible = false;
    reason = '클럽 활동이 있는 멤버에게만 위임할 수 있어요';
  }
  return { ...c, user_id: String(c?.user_id ?? ''), eligible, reason };
};

export async function transferCandidates(clubId: string): Promise<TransferCandidate[]> {
  if (__DEV__) console.info('[Club] transferCandidates', { clubId });
  const res = await api.get(`/clubs/${clubId}/transfer-candidates`);
  const rows: any[] = Array.isArray(res.data?.candidates) ? res.data.candidates : [];
  return rows.map(normCandidate);
}

export async function transferOwner(clubId: string, newOwnerId: string): Promise<void> {
  if (__DEV__) console.info('[Club] transferOwner', { clubId, newOwnerId });
  await api.post(`/clubs/${clubId}/transfer-owner`, { new_owner_id: newOwnerId });
}

/** v3.247 클럽 삭제 요청 초안 — 운영팀 DM(DmChat prefill)·클립보드 폴백이 같은 문구를 쓴다 */
export function clubDeleteRequestDraft(clubName: string): string {
  return `[클럽 삭제 요청] 클럽명: ${clubName} / 사유: `;
}
