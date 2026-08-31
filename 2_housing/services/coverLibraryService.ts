// [coverLibrary] v3.104(B-5): 커버 보관함 API.
// 계약(실서버 9004 openapi.json 실측 2026-08-31, v215/v216):
//   GET    /upload/cover-sessions?page=&limit=20  (updated_at 최신순)
//     → { covers: [{ cover_session_id, cover_object_name, image_url(상대경로 "/api/upload/cover-preview/..."),
//                    title|null, image_model, current_version, history_count, gen_params|null, source|null,
//                    linked_tracks: [{id,title}], created_at, updated_at }], pagination }
//     연결 곡은 uploader 본인 한정 역조회(현재본+이력 오브젝트 전량 기준).
//   DELETE /upload/cover-sessions/{id}
//     → 200 완전 삭제(미사용만 — 세션 doc + 오브젝트 전 버전)
//     → 409 { error, linked_tracks } (사용 중) / 404 (타인·부재·무효 은닉)
// 재사용: 보관함 커버(cover_object_name)는 여러 곡에 재사용 가능 —
//   발매(upload-from-generation·tracks/upload의 cover_object_name)·곡 커버 수정(PUT /tracks/{id} cover_image_url)
//   검증 통과(본인 세션 산출물 한정). 곡 삭제해도 오브젝트 보존, 파기는 보관함 DELETE만.
import api, { BACKEND_BASE_URL } from './api';

export interface CoverLinkedTrack {
  id: string | number;
  title: string;
}

export interface CoverSession {
  cover_session_id: string;
  cover_object_name: string;
  /** 상대경로 "/api/upload/cover-preview/..." — coverSessionImageUri()로 절대화 */
  image_url: string;
  title: string | null;
  image_model?: string;
  current_version: number;
  history_count: number;
  gen_params?: Record<string, any> | null;
  source?: string | null;
  linked_tracks: CoverLinkedTrack[];
  created_at?: string;
  updated_at?: string;
}

export interface CoverSessionListResponse {
  covers: CoverSession[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

/** image_url(상대경로) → 렌더 가능한 절대 URL (albumService.albumCoverUri 관행) */
export function coverSessionImageUri(c: Pick<CoverSession, 'image_url' | 'cover_object_name'>): string {
  const img = c.image_url;
  if (img) {
    if (img.startsWith('http')) return img;
    if (img.startsWith('/')) return `${BACKEND_BASE_URL}${img}`;
  }
  // defensive 폴백 — object_name으로 직접 프록시 조립 (다른 화면들과 동일 관행)
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(c.cover_object_name)}`;
}

/** GET /upload/cover-sessions — 내 커버 보관함 목록 (updated_at 최신순). */
export async function getCoverSessions(page = 1, limit = 20): Promise<CoverSessionListResponse> {
  if (__DEV__) console.info('[coverLibrary] getCoverSessions', { page, limit });
  const res = await api.get('/upload/cover-sessions', { params: { page, limit } });
  return { covers: res.data?.covers || [], pagination: res.data?.pagination };
}

/** DELETE /upload/cover-sessions/{id} — 미사용 커버만 완전 삭제.
 *  409(사용 중)면 err.response.data.linked_tracks에 곡 목록 — 호출부에서 안내. */
export async function deleteCoverSession(coverSessionId: string): Promise<void> {
  if (__DEV__) console.info('[coverLibrary] deleteCoverSession', { coverSessionId });
  await api.delete(`/upload/cover-sessions/${coverSessionId}`);
}
