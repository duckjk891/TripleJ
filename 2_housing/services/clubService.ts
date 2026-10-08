// [clubService] v3.245 커뮤니티 Phase 1b — 클럽 코어 API(계약 고정, 백엔드 동시 개발).
// 서버가 아직 미배포일 수 있어(404/네트워크 오류) 모든 호출자는 실패를 빈/안내 상태로 강등한다 — 크래시 금지.
// 계약:
//   POST   /clubs {name(≤30), description(≤300)} → 201 {id,name,description,member_count,owner_id,role}
//          409 code 'club_limit'(계정당 1개) | 'club_name_taken' · 400 code 'word_filtered'
//   GET    /clubs?sort=new|members&limit&before= → { clubs:[{id,name,description,member_count,owner_id,is_member,created_at}], next_before }
//   GET    /clubs/{id} → detail + is_member + role
//   POST   /clubs/{id}/join → 202 {status:'pending'}(v3.252 승인제)|200(구서버 즉시 가입)
//          · DELETE /clubs/{id}/join = 탈퇴/신청 철회 (owner 탈퇴 → 400 'owner_cannot_leave')
//   GET    /clubs/mine → 내 가입 클럽 목록
//   게시판: GET /feeds/club/{club_id}?limit&before= → { feeds, next_before } (공개 읽기, 글쓰기는 멤버만 — 403 'club_members_only')
//   클럽 플리: POST /playlists {title, club_id} · GET /clubs/{id}/playlists → [{id,title,track_count,...}]
import api from './api';

// v3.252: 대표 확정 리네이밍 — 사용자 노출 명칭 '크루'(내부 식별자·라우트명은 Club 유지).
// 서버가 내려주는 메시지는 서버(v3.252 병행)가 바꾼다 — 앱 자체 문구만 이 상수/직접 문구로 교체.
export const CLUB_LABEL = '크루';

// v3.253: 'popular' = 인지도(rp) 순. v3.257: 대표 확정(크루 인지도 미노출)으로 앱 UI 사용처 0 —
// 타입·파라미터는 유지(서버 v3.253 계약 구간 호환, 재도입 시 재사용). UI 는 new|members 만 쓴다.
export type ClubSort = 'new' | 'members' | 'popular';

// ── v3.253 크루 인지도 — v3.257 부터 앱 노출 0(대표 확정 "크루는 인지도가 필요없어").
//   서버가 recognition 키를 잠시 더 내려도 무해하도록 타입·폴백 헬퍼만 유지(UI 사용처 0).
//   크루 플리 실적(재생 +2·담기 +10)은 멤버 혜택 정산 원천으로 서버 내부 축적 계속.
export interface ClubRecognition {
  rp: number;
  /** 1..5 (그레이/브론즈/실버/골드/보라) */
  level: number;
  label: string;
}

/** v3.253: recognition 폴백 단일화 — v3.257: UI 사용처 0(노출 제거), 방어 파서로만 존치 */
export function clubRecognition(club?: { recognition?: any } | null): ClubRecognition {
  const r = club?.recognition;
  const levelRaw = Number(r?.level);
  const level = Number.isFinite(levelRaw) ? Math.min(5, Math.max(1, Math.round(levelRaw))) : 1;
  const rp = Number.isFinite(Number(r?.rp)) ? Math.max(0, Number(r.rp)) : 0;
  const label = typeof r?.label === 'string' && r.label ? r.label : `신생 ${CLUB_LABEL}`;
  return { rp, level, label };
}

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
  /** v3.252 가입 승인제 — 신서버 확장 필드(구서버 미존재). 'none'|'pending'|'member' */
  join_status?: string | null;
  /** v3.252 크루 채팅 — GET /clubs/mine 확장 필드(없으면 뱃지 숨김) */
  unread_chat?: number;
  /** v3.253 크루 인지도 — v3.257: 앱 미사용(노출 제거). 서버가 내려도/안 내려도 무해한 optional */
  recognition?: ClubRecognition | null;
  /** v3.296 [ClubGenre] 장르 태그(최대 3) */
  genres?: string[];
  /** v3.296 추천 응답 전용 — 내 곡 장르와 겹친 태그 */
  matched_genres?: string[];
  /** v3.305 [ClubInvite] 초대 링크로 온 사람 바로 가입(기본 true) — 크루장 설정 */
  invite_auto_approve?: boolean;
}

// v3.296 [ClubGenre] 크루 장르(서버 CLUB_GENRES 와 동일 순서) — 칩 렌더용 상수(요청 없이 즉시 표시)
export const CLUB_GENRES = ['댄스', '발라드', '힙합', 'R&B', '트로트', '인디', '록', '포크', '인디팝', '시티팝', '재즈', 'EDM', '클래식', '기타'];
export const MAX_CLUB_GENRES = 3;

/** v3.252: 가입 상태 파생 — join_status(신서버) 우선, 구서버는 is_member/role 로 폴백 */
export type ClubJoinStatus = 'none' | 'pending' | 'member';
export function clubJoinStatus(club?: Club | null): ClubJoinStatus {
  if (!club) return 'none';
  if (club.join_status === 'pending') return 'pending';
  if (club.join_status === 'member') return 'member';
  if (club.is_member || club.role === 'owner' || club.role === 'member') return 'member';
  return 'none';
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

const normClub = (c: any): Club => ({
  ...c,
  id: String(c?.id ?? ''),
  genres: Array.isArray(c?.genres) ? c.genres.filter((g: any) => typeof g === 'string') : [],
});

export async function createClub(name: string, description: string, genres: string[] = []): Promise<Club> {
  if (__DEV__) console.info('[Club] createClub', { nameLen: name.length, descLen: description.length, genres });
  // v3.245 게이트픽스 BUG-1: canonical '/clubs/' — 무슬래시는 307, Android OkHttp가 POST 307 미추종
  const res = await api.post('/clubs/', { name, description, genres });
  return normClub(res.data);
}

/** v3.296 [ClubGenre] 크루장 정보 수정 — 장르·소개(이름은 변경 불가) */
export async function updateClub(clubId: string, patch: { genres?: string[]; description?: string; invite_auto_approve?: boolean }): Promise<Club> {
  if (__DEV__) console.info('[ClubEdit] updateClub', { clubId, genres: patch.genres, descLen: patch.description?.length });
  try {
    const res = await api.patch(`/clubs/${clubId}`, patch);
    return normClub(res.data);
  } catch (err: any) {
    console.error('[ClubEdit] 수정 실패', { clubId, status: err?.response?.status });
    throw err;
  }
}

/** v3.296 [ClubGenre] 추천 크루 — 내가 발매한 곡 장르 기반(없으면 인기순) */
export async function getRecommendedClubs(limit = 10): Promise<{ clubs: Club[]; myGenres: string[] }> {
  if (__DEV__) console.info('[ClubRec] 추천 조회', { limit });
  try {
    const res = await api.get('/clubs/recommended', { params: { limit } });
    const clubs: Club[] = Array.isArray(res.data?.clubs) ? res.data.clubs.map(normClub) : [];
    const myGenres: string[] = Array.isArray(res.data?.my_genres) ? res.data.my_genres : [];
    return { clubs, myGenres };
  } catch (err: any) {
    console.error('[ClubRec] 추천 조회 실패', { status: err?.response?.status });
    throw err;
  }
}

export async function listClubs(opts: { sort?: ClubSort; limit?: number; before?: string | null; q?: string; genre?: string | null } = {}): Promise<ClubListPage> {
  const params: Record<string, any> = { sort: opts.sort || 'new', limit: opts.limit ?? 20 };
  if (opts.before) params.before = opts.before;
  if (opts.q && opts.q.trim()) params.q = opts.q.trim().slice(0, 30); // v3.296 검색
  if (opts.genre) params.genre = opts.genre; // v3.296 장르 필터
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

// v3.252 가입 승인제(서버 병행 스테이징, 계약 fixed):
//   POST /clubs/{id}/join → 202 {status:'pending'}(신서버 승인제) | 200(구서버 즉시 가입)
//   DELETE /clubs/{id}/join → 탈퇴(member) 또는 신청 철회(pending) 겸용
export type JoinResult = 'member' | 'pending';
export async function joinClub(clubId: string, opts: { inviteCode?: string } = {}): Promise<JoinResult> {
  if (__DEV__) console.info('[Club] joinClub', { clubId, invite: !!opts.inviteCode });
  // v3.305 [ClubInvite] 초대 코드 — 크루 설정이 자동 승인이면 서버가 즉시 멤버(200)로 응답
  const res = opts.inviteCode
    ? await api.post(`/clubs/${clubId}/join`, { invite_code: opts.inviteCode })
    : await api.post(`/clubs/${clubId}/join`);
  // 202 또는 body status 'pending' → 승인 대기(둘 다 방어 — 프록시가 상태코드를 뭉갤 수 있음)
  const pending = res?.status === 202 || res?.data?.status === 'pending';
  if (__DEV__) console.info('[Club] joinClub 결과', { clubId, pending });
  return pending ? 'pending' : 'member';
}

/** v3.305 [ClubInvite] 초대 링크(멤버 전용) — {code, url(공유 랜딩), autoApprove} */
export async function getClubInvite(clubId: string): Promise<{ code: string; url: string; autoApprove: boolean }> {
  if (__DEV__) console.info('[ClubInvite] 초대 링크 요청', { clubId });
  try {
    const res = await api.post(`/clubs/${clubId}/invite`);
    return { code: String(res.data?.code ?? ''), url: String(res.data?.url ?? ''), autoApprove: res.data?.auto_approve !== false };
  } catch (err: any) {
    console.error('[ClubInvite] 초대 링크 실패', { clubId, status: err?.response?.status });
    throw err;
  }
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
    reason = `다른 ${CLUB_LABEL} 운영자예요`; // v3.252 리네이밍
  } else if (c?.tenure_ok === false && activity === 0) {
    eligible = false;
    reason = `${CLUB_LABEL} 활동이 있는 멤버에게만 위임할 수 있어요`; // v3.252 리네이밍
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

/** v3.247 클럽 삭제 요청 초안 — 운영팀 DM(DmChat prefill)·클립보드 폴백이 같은 문구를 쓴다 (v3.252 리네이밍) */
export function clubDeleteRequestDraft(clubName: string): string {
  return `[${CLUB_LABEL} 삭제 요청] ${CLUB_LABEL}명: ${clubName} / 사유: `;
}

// ── v3.249 멤버 관리 — 서버 스테이징 확정 계약(미배포 구서버 404 → 호출자가 안내로 강등):
//   GET    /clubs/{id}/members?limit&before= → { members:[{user_id, nickname, role, joined_at}], next_before }
//          멤버 전용(비멤버 403 'club_members_only'), 최신 가입순, before=<멤버십 커서>
//   DELETE /clubs/{id}/members/{user_id} → 200 {member_count} — owner 전용(403)
//          400 'cannot_kick_owner'(본인·owner 대상) · 404(미멤버) — 작성한 글·담은 곡은 보존
//   멤버 신고: 기존 POST /reports/ 재사용 — target_type 'club_member', target_id=유저 id,
//          club_id 필수(서버가 reason_text 에 "[클럽:{club_id}] " 컨텍스트 자동 부착)
export interface ClubMember {
  user_id: string;
  nickname?: string | null;
  /** 'owner' | 'member' */
  role?: string;
  joined_at?: string;
}

// v3.261 멤버 창 외부 공개(병행 스테이징) — 응답에 anonymous:boolean 추가.
//   멤버 viewer: 기존 실명 셰이프 + user_id(채널 이동용) 그대로.
//   비멤버/비로그인: 200 {anonymous:true, member_count, members:[{role, joined_at}], next_before}
//   (닉네임·user_id 없음 → 행 키는 앱이 페이지 커서 기반으로 합성해 무한스크롤 병합과 충돌 0).
//   구서버는 여전히 403 'club_members_only' — 호출자 폴백(기존 '멤버만' 안내) 무회귀.
export interface ClubMemberPage {
  members: ClubMember[];
  next_before: string | null;
  /** v3.261: true = 익명 모드(비멤버 열람 — 닉네임·user_id 미제공) */
  anonymous: boolean;
  /** v3.261: 익명 응답 동봉 멤버 수(있을 때만) — 라벨 폴백용 */
  member_count?: number;
}

export async function listClubMembers(
  clubId: string,
  opts: { limit?: number; before?: string | null } = {},
): Promise<ClubMemberPage> {
  const params: Record<string, any> = { limit: opts.limit ?? 30 };
  if (opts.before) params.before = opts.before;
  if (__DEV__) console.info('[Club] listClubMembers', { clubId, ...params });
  const res = await api.get(`/clubs/${clubId}/members`, { params });
  const anonymous = res.data?.anonymous === true;
  const members: ClubMember[] = Array.isArray(res.data?.members)
    ? res.data.members.map((m: any, i: number) => (anonymous
      // v3.261 익명 행 — user_id 미제공: 페이지 커서+인덱스로 행 키 합성(loadMore dedupe 안전)
      ? { ...m, user_id: `anon-${opts.before || 'p0'}-${i}`, nickname: null }
      : { ...m, user_id: String(m?.user_id ?? '') }))
    : [];
  const rawCount = Number(res.data?.member_count);
  if (__DEV__ && anonymous) console.info('[Club] listClubMembers 익명 모드', { clubId, count: members.length, member_count: rawCount });
  return {
    members,
    next_before: res.data?.next_before ?? null,
    anonymous,
    member_count: Number.isFinite(rawCount) ? rawCount : undefined,
  };
}

export async function kickClubMember(clubId: string, userId: string): Promise<{ member_count?: number }> {
  if (__DEV__) console.info('[Club] kickClubMember', { clubId, userId });
  const res = await api.delete(`/clubs/${clubId}/members/${userId}`);
  return { member_count: res.data?.member_count };
}

export type ClubMembersError = 'forbidden' | 'failed';

/** 멤버 목록 실패 분류 — 403(비멤버)만 구분, 그 외(404 구서버·네트워크)는 안내 강등 */
export function classifyMembersError(err: any): ClubMembersError {
  return err?.response?.status === 403 ? 'forbidden' : 'failed';
}

export type MemberMenuAction = 'report' | 'kick';

/** 행 ⋯ 메뉴 노출 규칙(v3.249 확정) — 본인·owner 행 제외, [신고]는 멤버 누구나, [내보내기]는 owner 만 */
export function memberMenuActions(
  viewer: { id?: string | null; isMember: boolean; isOwner: boolean },
  row: ClubMember,
): MemberMenuAction[] {
  if (!viewer.isMember || !viewer.id) return [];
  if (String(row.user_id) === String(viewer.id)) return []; // 본인 행
  if ((row.role || 'member') === 'owner') return []; // owner 행(신고는 기존 '클럽 신고' 경로)
  const actions: MemberMenuAction[] = ['report'];
  if (viewer.isOwner) actions.push('kick');
  return actions;
}

/** 내보내기 실패 문구(서버 확정 오류 분기) — 404 는 호출자가 목록 새로고침을 함께 수행 */
export function kickErrorMessage(code: string | null, status?: number): string {
  if (code === 'cannot_kick_owner') return '운영자는 내보낼 수 없어요.';
  if (status === 404) return `이미 ${CLUB_LABEL}를 떠난 멤버예요. 목록을 새로고침할게요.`; // v3.252: 조사 을→를(크루)
  if (status === 403) return `${CLUB_LABEL} 운영자만 멤버를 내보낼 수 있어요.`;
  return '내보내지 못했어요. 잠시 후 다시 시도해주세요.';
}

// ── v3.252 가입 승인제(owner 신청 관리) — 서버 병행 스테이징 계약(구서버 404 → 호출자가 숨김/안내 강등):
//   GET  /clubs/{id}/join-requests → { requests:[{user_id, nickname, requested_at, was_kicked}] }
//   POST /clubs/{id}/join-requests/{user_id}/approve → 200 {member_count}
//   POST /clubs/{id}/join-requests/{user_id}/reject  → 200
//   404(이미 철회·처리됨)는 호출자가 목록 새로고침으로 수습.
export interface JoinRequest {
  user_id: string;
  nickname?: string | null;
  requested_at?: string;
  /** 이전에 내보낸(강퇴) 멤버 — owner 판단 참고용 표시 */
  was_kicked?: boolean;
}

export async function listJoinRequests(clubId: string): Promise<JoinRequest[]> {
  if (__DEV__) console.info('[Club] listJoinRequests', { clubId });
  const res = await api.get(`/clubs/${clubId}/join-requests`);
  const rows: any[] = Array.isArray(res.data?.requests) ? res.data.requests : [];
  return rows.map((r) => ({ ...r, user_id: String(r?.user_id ?? '') }));
}

export async function approveJoinRequest(clubId: string, userId: string): Promise<{ member_count?: number }> {
  if (__DEV__) console.info('[Club] approveJoinRequest', { clubId, userId });
  const res = await api.post(`/clubs/${clubId}/join-requests/${userId}/approve`);
  return { member_count: res.data?.member_count };
}

export async function rejectJoinRequest(clubId: string, userId: string): Promise<void> {
  if (__DEV__) console.info('[Club] rejectJoinRequest', { clubId, userId });
  await api.post(`/clubs/${clubId}/join-requests/${userId}/reject`);
}

// ── v3.252 크루 채팅 — 서버 계약 fixed(구서버 404 → 호출자가 안내 강등, 크래시 금지):
//   GET  /clubs/{id}/chat?limit&before=<id>&after=<id> → { messages:[…최신순], next_before }
//        before=과거 방향 커서(위로 무한스크롤) · after=재접속 캐치업(마지막 id 이후 1회)
//   POST /clubs/{id}/chat {text ≤1000} → 201 {message} · 403 'club_members_only'|'child_restricted' · 429 'rate_limited'
//   DELETE /clubs/{id}/chat/{message_id} → 200 (본인·owner, 소프트 삭제 — deleted=true 로 남음)
//   POST /clubs/{id}/chat/read → 읽음 처리(화면 진입·신규 수신 시, 실패 무시)
export interface ClubChatMessage {
  id: string;
  club_id?: string;
  sender_id: string;
  sender_nickname?: string | null;
  text?: string | null;
  created_at?: string;
  /** 소프트 삭제 — true 면 회색 '삭제된 메시지예요' 렌더 */
  deleted?: boolean;
}

export interface ClubChatPage {
  messages: ClubChatMessage[];
  next_before: string | null;
}

const normChatMsg = (m: any): ClubChatMessage => ({
  ...m,
  id: String(m?.id ?? ''),
  sender_id: String(m?.sender_id ?? ''),
});

export async function listClubChat(
  clubId: string,
  opts: { limit?: number; before?: string | null; after?: string | null } = {},
): Promise<ClubChatPage> {
  const params: Record<string, any> = { limit: opts.limit ?? 50 };
  if (opts.before) params.before = opts.before;
  if (opts.after) params.after = opts.after;
  if (__DEV__) console.info('[Club] listClubChat', { clubId, ...params });
  const res = await api.get(`/clubs/${clubId}/chat`, { params });
  const messages: ClubChatMessage[] = Array.isArray(res.data?.messages) ? res.data.messages.map(normChatMsg) : [];
  return { messages, next_before: res.data?.next_before ?? null };
}

export const CHAT_TEXT_MAX = 1000;

export async function sendClubChat(clubId: string, text: string): Promise<ClubChatMessage | null> {
  if (__DEV__) console.info('[Club] sendClubChat', { clubId, len: text.length });
  const res = await api.post(`/clubs/${clubId}/chat`, { text });
  return res.data?.message ? normChatMsg(res.data.message) : null;
}

export async function deleteClubChatMessage(clubId: string, messageId: string): Promise<void> {
  if (__DEV__) console.info('[Club] deleteClubChatMessage', { clubId, messageId });
  await api.delete(`/clubs/${clubId}/chat/${messageId}`);
}

/** 읽음 처리 — 실패는 무시(다음 진입·수신에서 재시도되는 성질) */
export function markClubChatRead(clubId: string): void {
  if (__DEV__) console.info('[Club] markClubChatRead', { clubId });
  api.post(`/clubs/${clubId}/chat/read`).catch(() => {});
}

// ── v3.253 크루 플리 혜택 — 재생 시작 보고(계약 fixed). v3.257: 실적 축적 배선 그대로 유지
//   (멤버 혜택 정산 원천 — 노출만 제거). 서버 v3.257 부터 응답에 recognition 없음(?? null 방어 유지).
//   POST /clubs/{club_id}/playlists/{playlist_id}/play-start → {granted:10|0, recognition?}
//   호출 조건(호출자 책임): 인증 사용자이면서 그 크루의 비멤버가 크루 플리를 전체 재생(큐 교체)으로
//   시작하는 시점 1회. 내 크루(멤버·owner)는 절대 호출하지 않는다. 401/404(구서버)·네트워크는
//   전부 침묵 스킵(null 반환) — 재생 흐름에 영향 금지.
export async function recordClubPlaylistPlayStart(
  clubId: string,
  playlistId: string,
): Promise<{ granted: number; recognition?: ClubRecognition | null } | null> {
  try {
    const res = await api.post(`/clubs/${clubId}/playlists/${playlistId}/play-start`);
    const granted = Number(res.data?.granted) || 0;
    if (__DEV__) console.info('[Club] CrewRecog play-start 보고', { clubId, playlistId, granted });
    return { granted, recognition: res.data?.recognition ?? null };
  } catch (err: any) {
    // 401(비로그인 방어)·404(구서버 미배포)·네트워크 — 조용히 스킵
    if (__DEV__) console.info('[Club] CrewRecog play-start 스킵(무시)', { clubId, playlistId, status: err?.response?.status });
    return null;
  }
}

// ── v3.261 크루 홍보 — 서버 계약 fixed(병행 스테이징, 구서버 404 → '곧 열려요' 안내):
//   POST /clubs/{id}/promote {genres?, moods?, message?} → 200 {targeted:N, next_at}
//   429 {code:'promo_cooldown', next_at}(7일 쿨다운) · 400(키워드 합계 1~5 위반) · 403(비owner)
//   키워드는 utils/lyricsPrompt GENRE_OPTIONS/MOOD_OPTIONS 재사용(합계 1~5) — 알림은 서버가
//   target_type='club_promo' 로 발송(취향 매칭 유저 대상).
export const PROMO_KEYWORD_MAX = 5;
export const PROMO_MESSAGE_MAX = 100;
// v3.266 — 자유 키워드 타겟(대표 확정): 예) "고양이" → 그 주제로 곡을 만든 유저에게만.
// 서버가 ES 관련도 + 정확도 컷(절대 하한·상대 컷)으로 저관련 유저를 걸러낸다.
export const PROMO_KEYWORD_MIN_LEN = 2;
export const PROMO_KEYWORD_LEN_MAX = 30;

export interface PromoteResult {
  targeted: number;
  next_at?: string | null;
  /** v3.266 — targeted=0일 때 서버 안내(예: "이 키워드로 곡을 만든 유저를 찾지 못했어요") */
  note?: string | null;
}

export async function promoteClub(
  clubId: string,
  payload: { keyword?: string; genres?: string[]; moods?: string[]; message?: string },
): Promise<PromoteResult> {
  if (__DEV__) console.info('[Club] promoteClub', {
    clubId,
    kwLen: payload.keyword?.length ?? 0,
    genres: payload.genres?.length ?? 0,
    moods: payload.moods?.length ?? 0,
    msgLen: payload.message?.length ?? 0,
  });
  const res = await api.post(`/clubs/${clubId}/promote`, payload);
  return {
    targeted: Number(res.data?.targeted) || 0,
    next_at: res.data?.next_at ?? null,
    note: res.data?.note ?? null,
  };
}

/** v3.261: next_at ISO → 'YYYY.MM.DD' (파싱 불가/부재 시 null — 문구에서 날짜 병기 생략) */
const fmtPromoDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/** v3.261 홍보 실패 문구(계약 fixed 오류 분기) — 429 는 next_at 있으면 날짜 병기, 구서버 404 는 '곧 열려요' */
export function promoteErrorMessage(err: any): string {
  const status = err?.response?.status;
  const code = getClubErrorCode(err);
  if (status === 429 || code === 'promo_cooldown') {
    const data = err?.response?.data;
    const next = fmtPromoDate(data?.next_at ?? data?.detail?.next_at);
    return next
      ? `아직 다음 홍보까지 기다려야 해요. ${next} 이후에 다시 보낼 수 있어요.`
      : '아직 다음 홍보까지 기다려야 해요.';
  }
  if (status === 400) return '장르·분위기 키워드는 1~5개 선택해야 해요.';
  if (status === 403) return `${CLUB_LABEL} 운영자만 홍보를 보낼 수 있어요.`;
  if (status === 404) return `${CLUB_LABEL} 홍보 기능이 곧 열려요. 조금만 기다려주세요.`;
  return '홍보를 보내지 못했어요. 잠시 후 다시 시도해주세요.';
}

/** 채팅 송신 실패 문구(계약 fixed 오류 분기) — child_restricted 403 은 api 인터셉터가 서버 문구로 안내 */
export function chatSendErrorMessage(code: string | null, status?: number): string {
  if (status === 429 || code === 'rate_limited') return '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내주세요.';
  if (status === 403 || code === 'club_members_only') return `${CLUB_LABEL} 멤버만 채팅에 참여할 수 있어요.`;
  return '메시지를 보내지 못했어요. 잠시 후 다시 시도해주세요.';
}
