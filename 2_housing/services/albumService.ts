// [albumService] v3.96(파리티 Wave 6): 앨범 관리(A-2) + 홈 최신앨범(A-20) API.
// 계약(backend_9004/app/routes/albums.py — v69):
//   GET    /albums/latest?limit=            → AlbumResponse[]           (공개 앨범 최신순)
//   GET    /albums/my?page=&limit=          → { albums, pagination }    (내 앨범, 비공개 포함)
//   GET    /albums/{id}                     → AlbumResponse(+tracks)    (비공개=소유자만)
//   POST   /albums/  multipart { title, description?, is_public, track_ids(JSON), cover_source(auto|upload|ai),
//                                cover_file?, cover_object_name? }      (트랙 1개 이상 필수, 본인 트랙만)
//   PATCH  /albums/{id}          json { title?, description?, is_public?, cover_source? }
//   DELETE /albums/{id}
//   POST   /albums/{id}/tracks   json { track_ids }   (본인 트랙만, 중복은 서버가 무시)
//   DELETE /albums/{id}/tracks/{trackId}              (마지막 트랙 제거 시 앨범 자동 삭제 → album_deleted)
//   PUT    /albums/{id}/tracks/order json { track_ids } (현재 집합과 동일해야 함)
//   PATCH  /albums/{id}/cover    multipart { cover_file? | cover_object_name? | (빈=첫곡 커버 재적용) }
//   POST   /albums/cover/generate json { title, description?, track_ids?, gender?, image_model?, include_character? }
//     → { cover_object_name, cover_image_url }  ※ ⭐ 과금 없음(albums.py에 포인트 로직 없음 — 무료)
import { Platform } from 'react-native';
import api, { BACKEND_BASE_URL } from './api';

export type AlbumCoverSource = 'auto' | 'upload' | 'ai' | 'borrowed';

export interface Album {
  id: string;
  owner_id: string;
  artist_id?: string;
  artist_name?: string;
  title: string;
  description?: string | null;
  cover_image?: string | null; // presigned 또는 /api/... 경로
  cover_source?: AlbumCoverSource;
  is_public?: boolean;
  release_date?: string | null;
  track_count?: number;
  tracks?: any[] | null; // 상세에서만 채워짐 — TrackRow와 동일 형태(id/title/cover_image/...)
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AlbumListResponse {
  albums: Album[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

// 앨범 cover_image는 presigned 풀 URL 또는 '/api/...' 경로로 옴 — UserChannelScreen albumCoverUri 관행 통일
export function albumCoverUri(img?: string | null): string | null {
  if (!img) return null;
  if (img.startsWith('http')) return img;
  if (img.startsWith('/')) return `${BACKEND_BASE_URL}${img}`;
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}`;
}

/** GET /albums/latest — 홈 최신앨범 섹션(A-20). 비회원도 조회 가능. */
export async function getLatestAlbums(limit = 10): Promise<Album[]> {
  if (__DEV__) console.info('[albumService] getLatestAlbums', { limit });
  const res = await api.get('/albums/latest', { params: { limit } });
  return Array.isArray(res.data) ? res.data : [];
}

/** GET /albums/my — 내 앨범 목록(비공개 포함). */
export async function getMyAlbums(page = 1, limit = 50): Promise<AlbumListResponse> {
  if (__DEV__) console.info('[albumService] getMyAlbums', { page, limit });
  const res = await api.get('/albums/my', { params: { page, limit } });
  return { albums: res.data?.albums || [], pagination: res.data?.pagination };
}

/** GET /albums/{id} — 앨범 상세(트랙 포함). */
export async function getAlbum(albumId: string): Promise<Album> {
  if (__DEV__) console.info('[albumService] getAlbum', { albumId });
  const res = await api.get(`/albums/${albumId}`);
  return res.data;
}

/** web/native FormData 이미지 첨부 분기 (authService.uploadProfileImage 관행 재사용) */
async function appendImageFile(
  formData: FormData,
  field: string,
  fileUri: string,
  fileName: string,
  mimeType: string
) {
  if (Platform.OS === 'web') {
    // web: 표준 Web FormData는 Blob/File 객체만 받음
    const res = await fetch(fileUri);
    const blob = await res.blob();
    formData.append(field, blob, fileName);
  } else {
    // native: RN 확장 문법
    formData.append(field, { uri: fileUri, name: fileName, type: mimeType } as any);
  }
}

const multipartHeaders = () =>
  // web에서는 boundary 자동 추가되도록 헤더 미지정
  Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' };

export interface AlbumCoverFile {
  fileUri: string;
  fileName: string;
  mimeType: string;
}

/** POST /albums/ — 앨범 생성(multipart). 트랙 1개 이상 + 본인 트랙만(서버 검증). */
export async function createAlbum(params: {
  title: string;
  description?: string;
  isPublic?: boolean;
  trackIds: string[];
  coverSource?: 'auto' | 'upload' | 'ai';
  coverFile?: AlbumCoverFile; // coverSource=upload일 때
  coverObjectName?: string; // coverSource=ai일 때 (cover/generate 반환값)
}): Promise<Album> {
  const coverSource = params.coverSource || 'auto';
  if (__DEV__) {
    console.info('[albumService] createAlbum', {
      trackCount: params.trackIds.length,
      coverSource,
      isPublic: params.isPublic !== false,
    });
  }
  const formData = new FormData();
  formData.append('title', params.title.trim());
  formData.append('description', params.description || '');
  formData.append('is_public', String(params.isPublic !== false));
  formData.append('cover_source', coverSource);
  formData.append('track_ids', JSON.stringify(params.trackIds.map(String)));
  if (coverSource === 'upload' && params.coverFile) {
    await appendImageFile(
      formData, 'cover_file',
      params.coverFile.fileUri, params.coverFile.fileName, params.coverFile.mimeType
    );
  } else if (coverSource === 'ai' && params.coverObjectName) {
    formData.append('cover_object_name', params.coverObjectName);
  }
  const res = await api.post('/albums/', formData, { headers: multipartHeaders() });
  return res.data;
}

/** PATCH /albums/{id} — 메타 수정(제목/설명/공개여부). 소유자만. */
export async function updateAlbum(
  albumId: string,
  patch: { title?: string; description?: string; is_public?: boolean }
): Promise<Album> {
  if (__DEV__) console.info('[albumService] updateAlbum', { albumId, fields: Object.keys(patch) });
  const res = await api.patch(`/albums/${albumId}`, patch);
  return res.data;
}

/** DELETE /albums/{id} — 앨범 삭제. 소유자만. */
export async function deleteAlbum(albumId: string): Promise<void> {
  if (__DEV__) console.info('[albumService] deleteAlbum', { albumId });
  await api.delete(`/albums/${albumId}`);
}

/** POST /albums/{id}/tracks — 트랙 추가(본인 트랙만, 기존 트랙은 서버가 중복 제거). */
export async function addAlbumTracks(albumId: string, trackIds: string[]): Promise<Album> {
  if (__DEV__) console.info('[albumService] addAlbumTracks', { albumId, count: trackIds.length });
  const res = await api.post(`/albums/${albumId}/tracks`, { track_ids: trackIds.map(String) });
  return res.data;
}

/** DELETE /albums/{id}/tracks/{trackId} — 트랙 제거. 마지막 트랙이면 앨범 자동 삭제. */
export async function removeAlbumTrack(
  albumId: string,
  trackId: string
): Promise<{ album?: Album; albumDeleted: boolean }> {
  if (__DEV__) console.info('[albumService] removeAlbumTrack', { albumId, trackId });
  const res = await api.delete(`/albums/${albumId}/tracks/${trackId}`);
  if (res.data?.album_deleted) return { albumDeleted: true };
  return { album: res.data, albumDeleted: false };
}

/** PUT /albums/{id}/tracks/order — 순서 변경(현재 트랙 집합과 완전 일치 필요). */
export async function reorderAlbumTracks(albumId: string, trackIds: string[]): Promise<Album> {
  if (__DEV__) console.info('[albumService] reorderAlbumTracks', { albumId, count: trackIds.length });
  const res = await api.put(`/albums/${albumId}/tracks/order`, { track_ids: trackIds.map(String) });
  return res.data;
}

/** PATCH /albums/{id}/cover — 커버 변경. file=업로드, objectName=AI, 둘 다 없으면 첫 곡 커버 재적용. */
export async function updateAlbumCover(
  albumId: string,
  opts: { file?: AlbumCoverFile; coverObjectName?: string }
): Promise<Album> {
  if (__DEV__) {
    console.info('[albumService] updateAlbumCover', {
      albumId, mode: opts.file ? 'upload' : opts.coverObjectName ? 'ai' : 'auto',
    });
  }
  const formData = new FormData();
  if (opts.file) {
    await appendImageFile(formData, 'cover_file', opts.file.fileUri, opts.file.fileName, opts.file.mimeType);
  } else if (opts.coverObjectName) {
    formData.append('cover_object_name', opts.coverObjectName);
  } else {
    // 빈 multipart 방지용 마커(서버 미선언 필드는 무시됨) — MAIDOL AlbumCreateModal 관행
    formData.append('cover_source', 'auto');
  }
  const res = await api.patch(`/albums/${albumId}/cover`, formData, { headers: multipartHeaders() });
  return res.data;
}

/** POST /albums/cover/generate — AI 커버 생성(⭐ 과금 없음 — 서버에 포인트 로직 없음).
 * 반환된 cover_object_name을 updateAlbumCover({ coverObjectName }) 또는 createAlbum(coverSource=ai)에 전달. */
export async function generateAlbumCover(params: {
  title: string;
  description?: string;
  trackIds?: string[];
  gender?: 'female' | 'male' | 'neutral';
  imageModel?: 'nb_pro' | 'gpt_image_2';
  includeCharacter?: boolean;
}): Promise<{ cover_object_name: string; cover_image_url?: string }> {
  if (__DEV__) {
    console.info('[albumService] generateAlbumCover', {
      trackCount: params.trackIds?.length ?? 0,
      includeCharacter: !!params.includeCharacter,
    });
  }
  const res = await api.post('/albums/cover/generate', {
    title: params.title,
    description: params.description || undefined,
    track_ids: (params.trackIds || []).map(String),
    gender: params.gender || 'neutral',
    image_model: params.imageModel || 'nb_pro',
    include_character: !!params.includeCharacter,
  });
  return res.data;
}

/** GET /tracks/my — 앨범에 담을 내 발매 트랙 목록(MyMusicScreen과 동일 엔드포인트). */
export async function getMyTracksForAlbum(limit = 100): Promise<any[]> {
  if (__DEV__) console.info('[albumService] getMyTracksForAlbum', { limit });
  const res = await api.get('/tracks/my', { params: { page: 1, limit, sort: 'created_at' } });
  return res.data?.tracks || [];
}
