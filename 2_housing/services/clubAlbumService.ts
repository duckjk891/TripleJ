import api from './api';

// v3.305 [ClubAlbum] 크루 앨범 — 크루장이 크루 플레이리스트로 만드는 테마 앨범 + 대표곡 + 참여 미션.
// 서버: GET/POST /clubs/{id}/albums · GET/PATCH/DELETE /clubs/{id}/albums/{aid}
//       POST/GET /clubs/{id}/albums/{aid}/submissions · …/submissions/{tid}/approve|reject · …/eligible-tracks
// 비회원 상세: 대표곡만 locked=false(나머지 locked=true — 재생 불가 표시).

export interface ClubAlbumTrack {
  id: string;
  title: string;
  artist_name?: string;
  uploader_id?: string;
  uploader_nickname?: string;
  cover_image_url?: string | null;
  cover_image?: string | null;
  duration_sec?: number | null;
  character_id?: string | null;
  is_representative?: boolean;
  locked?: boolean;
  submission_status?: 'pending' | 'approved' | 'rejected' | null;
}

export interface ClubAlbum {
  id: string;
  club_id: string;
  title: string;
  theme?: string | null;
  cover_image_url?: string | null;
  representative_track_id?: string | null;
  representative_track?: ClubAlbumTrack | null;
  track_count: number;
  created_at?: string;
}

export interface ClubAlbumDetail extends ClubAlbum {
  tracks: ClubAlbumTrack[];
  is_member: boolean;
  role?: string | null;
  my_submissions?: { track_id: string; status: string }[];
}

export interface AlbumSubmission {
  track: ClubAlbumTrack;
  user_id: string;
  nickname?: string | null;
  created_at?: string;
}

export const ALBUM_PARTICIPATION_REWARD = 5;

const errMsg = (err: any, fallback: string): string => err?.response?.data?.error || fallback;
export { errMsg as clubAlbumErrorMessage };

export async function listClubAlbums(clubId: string): Promise<ClubAlbum[]> {
  if (__DEV__) console.info('[ClubAlbum] 목록', { clubId });
  try {
    const res = await api.get(`/clubs/${clubId}/albums`);
    return Array.isArray(res.data?.albums) ? res.data.albums : [];
  } catch (err: any) {
    console.error('[ClubAlbum] 목록 실패', { clubId, status: err?.response?.status });
    throw err;
  }
}

export async function getClubAlbum(clubId: string, albumId: string): Promise<ClubAlbumDetail> {
  if (__DEV__) console.info('[ClubAlbum] 상세', { clubId, albumId });
  try {
    const res = await api.get(`/clubs/${clubId}/albums/${albumId}`);
    const d = res.data ?? {};
    return { ...d, tracks: Array.isArray(d.tracks) ? d.tracks : [], is_member: !!d.is_member };
  } catch (err: any) {
    console.error('[ClubAlbum] 상세 실패', { clubId, albumId, status: err?.response?.status });
    throw err;
  }
}

export async function createClubAlbum(clubId: string, body: { playlistId: string; title: string; theme?: string; representativeTrackId: string }): Promise<ClubAlbum> {
  console.info('[ClubAlbum] 생성 요청', { clubId, playlistId: body.playlistId, titleLen: body.title.length });
  try {
    const res = await api.post(`/clubs/${clubId}/albums`, {
      playlist_id: body.playlistId,
      title: body.title,
      theme: body.theme || null,
      representative_track_id: body.representativeTrackId,
    });
    return res.data;
  } catch (err: any) {
    console.error('[ClubAlbum] 생성 실패', { clubId, status: err?.response?.status });
    throw err;
  }
}

export async function updateClubAlbum(clubId: string, albumId: string, patch: { title?: string; theme?: string; representative_track_id?: string }): Promise<ClubAlbum> {
  console.info('[ClubAlbum] 수정 요청', { clubId, albumId, keys: Object.keys(patch) });
  try {
    const res = await api.patch(`/clubs/${clubId}/albums/${albumId}`, patch);
    return res.data;
  } catch (err: any) {
    console.error('[ClubAlbum] 수정 실패', { clubId, albumId, status: err?.response?.status });
    throw err;
  }
}

export async function deleteClubAlbum(clubId: string, albumId: string): Promise<void> {
  console.info('[ClubAlbum] 삭제 요청', { clubId, albumId });
  await api.delete(`/clubs/${clubId}/albums/${albumId}`);
}

export async function removeClubAlbumTrack(clubId: string, albumId: string, trackId: string): Promise<void> {
  console.info('[ClubAlbum] 곡 빼기', { clubId, albumId, trackId });
  await api.delete(`/clubs/${clubId}/albums/${albumId}/tracks/${trackId}`);
}

export async function listEligibleTracks(clubId: string, albumId: string): Promise<ClubAlbumTrack[]> {
  if (__DEV__) console.info('[ClubAlbum] 낼 수 있는 곡', { clubId, albumId });
  try {
    const res = await api.get(`/clubs/${clubId}/albums/${albumId}/eligible-tracks`);
    return Array.isArray(res.data?.tracks) ? res.data.tracks : [];
  } catch (err: any) {
    console.error('[ClubAlbum] 낼 수 있는 곡 조회 실패', { clubId, albumId, status: err?.response?.status });
    throw err;
  }
}

export async function submitToClubAlbum(clubId: string, albumId: string, trackId: string): Promise<void> {
  console.info('[ClubAlbum] 참여곡 제출', { clubId, albumId, trackId });
  try {
    await api.post(`/clubs/${clubId}/albums/${albumId}/submissions`, { track_id: trackId });
  } catch (err: any) {
    console.error('[ClubAlbum] 제출 실패', { clubId, albumId, trackId, status: err?.response?.status });
    throw err;
  }
}

export async function listAlbumSubmissions(clubId: string, albumId: string): Promise<AlbumSubmission[]> {
  try {
    const res = await api.get(`/clubs/${clubId}/albums/${albumId}/submissions`);
    return Array.isArray(res.data?.submissions) ? res.data.submissions : [];
  } catch (err: any) {
    console.error('[ClubAlbum] 제출곡 조회 실패', { clubId, albumId, status: err?.response?.status });
    throw err;
  }
}

export async function decideAlbumSubmission(clubId: string, albumId: string, trackId: string, approve: boolean): Promise<{ starred?: boolean; reason?: string | null }> {
  console.info('[ClubAlbum] 제출곡 처리', { clubId, albumId, trackId, approve });
  try {
    const res = await api.post(`/clubs/${clubId}/albums/${albumId}/submissions/${trackId}/${approve ? 'approve' : 'reject'}`);
    return res.data ?? {};
  } catch (err: any) {
    console.error('[ClubAlbum] 제출곡 처리 실패', { clubId, albumId, trackId, status: err?.response?.status });
    throw err;
  }
}

/** 크루 앨범 공유 링크(서버 OG 랜딩) — 초대 코드가 있으면 붙여 비회원이 바로 가입할 수 있게 */
export function clubAlbumShareUrl(inviteUrl: string, clubId: string, albumId: string): string {
  const m = inviteUrl.match(/^(https?:\/\/[^/]+)\/club\/[0-9a-f]{24}(\?i=[a-z0-9]{8})?/i);
  const base = m ? m[1] : 'https://api.maidol.ai.kr';
  return `${base}/club/${clubId}/album/${albumId}${m?.[2] ?? ''}`;
}
