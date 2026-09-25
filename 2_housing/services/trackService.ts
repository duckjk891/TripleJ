// [trackService] v3.100(A-10): 직접 음원 파일 업로드 API.
// 계약(실서버 9004 openapi.json 실측 2026-08-31 + backend_9004/app/routes/tracks.py:1238 upload_track):
//   POST /tracks/upload  multipart(201) —
//     file(필수), title(필수), genre?, mood?, tags?, categories?, ai_model?, prompt?,
//     bpm?, key?, language?, lyrics?, cover_object_name?, is_public?(기본 true)
//     제한: 확장자 .mp3/.wav/.ogg/.flac/.m4a (tracks.py:27 ALLOWED_AUDIO_EXT),
//           최대 50MB (tracks.py:28 MAX_AUDIO_SIZE) — 위반 시 400 { error }
//     응답: _serialize_track(id/title/audio_url/cover_image/...) — 발매 보상 ⭐+5는 서버가 자동 지급.
//   POST /upload/image  multipart(201) — file, type('cover'|'profile'), id (upload.py:113)
//     제한: .jpg/.jpeg/.png/.webp, 최대 10MB (upload.py:108-109)
//     type='cover' + 트랙 id → MinIO 저장 후 트랙 cover_image_url 갱신 (upload.py:137-156)
//     ※ MAIDOL UploadPage.jsx:1566은 type='track' 전송(구버전) — 백엔드는 'cover'만 허용 → 'cover' 사용.
// web/native FormData 분기는 voiceService.appendAudioFile / albumService.appendImageFile 관행 재사용.
import { Platform } from 'react-native';
import api, { BACKEND_BASE_URL } from './api';
import { FALLBACK_POINT_COSTS } from './pointCosts';

// 서버 제한값(위 계약 주석의 단일 소스) — 클라 선검증용
export const AUDIO_ALLOWED_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];
export const AUDIO_MAX_SIZE_MB = 50;
export const COVER_ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
export const COVER_MAX_SIZE_MB = 10;

export interface PickedFile {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  size?: number; // bytes — 웹/일부 네이티브에서만 제공됨
}

export interface TrackUploadParams {
  file: PickedFile;
  title: string;
  genre?: string;
  mood?: string;
  tags?: string; // comma-separated — 서버가 split
  lyrics?: string;
  aiModel?: string;
  isPublic?: boolean;
  /** v3.102(B-4): 출처 기록 — 기본 아티스트 character_id (v216: 무효여도 업로드 실패 없음) */
  characterId?: string;
  /** v3.102(B-4): 출처 기록 — 가사 보관함 로컬 id (직접 업로드 화면은 현재 미전송) */
  lyricsId?: string;
  /** v3.104(B-5): 커버 보관함에서 선택한 cover_object_name — 발매 form 필드로 전송(본인 세션 산출물만 서버 검증 통과).
   *  이 필드가 있으면 별도 POST /upload/image 불필요 (openapi 실측: tracks/upload multipart에 cover_object_name 존재). */
  coverObjectName?: string;
}

export function fileExt(fileName: string): string {
  return (fileName.split('.').pop() || '').toLowerCase();
}

// 확장자 기반 mime 추정 — 백엔드는 확장자만 강제(musicService.guessAudioMime 관행)
function guessAudioMime(fileName: string): string {
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
  };
  return map[fileExt(fileName)] || 'audio/mpeg';
}

function guessImageMime(fileName: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[fileExt(fileName)] || 'image/jpeg';
}

/** web/native FormData 파일 첨부 분기 (voiceService.appendAudioFile 관행) */
async function appendFile(formData: FormData, field: string, file: PickedFile, mime: string) {
  if (Platform.OS === 'web') {
    // web: 표준 FormData는 Blob/File만 허용
    const res = await fetch(file.fileUri);
    const blob = await res.blob();
    formData.append(field, blob, file.fileName);
  } else {
    // native: RN 확장 문법
    formData.append(field, { uri: file.fileUri, name: file.fileName, type: mime } as any);
  }
}

const multipartHeaders = () =>
  // web에서는 boundary 자동 추가되도록 헤더 미지정 (albumService 관행)
  Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' };

/**
 * POST /tracks/upload — 직접 음원 파일 발매.
 * onProgress: 0~100 정수(요청 바디 전송 진행률). 응답은 서버 _serialize_track 트랙 객체.
 */
export async function uploadTrackFile(
  params: TrackUploadParams,
  onProgress?: (pct: number) => void
): Promise<any> {
  const formData = new FormData();
  await appendFile(formData, 'file', params.file, params.file.mimeType || guessAudioMime(params.file.fileName));
  formData.append('title', params.title.trim());
  if (params.genre) formData.append('genre', params.genre);
  if (params.mood?.trim()) formData.append('mood', params.mood.trim());
  if (params.tags?.trim()) formData.append('tags', params.tags.trim());
  if (params.lyrics?.trim()) formData.append('lyrics', params.lyrics.trim());
  if (params.aiModel) formData.append('ai_model', params.aiModel);
  // v3.102(B-4): 출처 기록(옵션) — v216 openapi 실측: tracks/upload multipart에 character_id/lyrics_id 존재
  if (params.characterId) formData.append('character_id', params.characterId);
  if (params.lyricsId) formData.append('lyrics_id', params.lyricsId);
  // v3.104(B-5): 보관함 커버 재사용 — cover_object_name form 필드로 발매와 동시에 부착
  if (params.coverObjectName) formData.append('cover_object_name', params.coverObjectName);
  formData.append('is_public', String(params.isPublic !== false));

  console.info('[trackService] uploadTrackFile 시작', {
    fileName: params.file.fileName,
    size: params.file.size,
    genre: params.genre,
    isPublic: params.isPublic !== false,
  });
  const res = await api.post('/tracks/upload', formData, {
    headers: multipartHeaders(),
    timeout: 300000, // 최대 50MB — 느린 회선 고려 5분
    onUploadProgress: (e: any) => {
      if (onProgress && e?.total) onProgress(Math.round((e.loaded * 100) / e.total));
    },
  });
  console.info('[trackService] uploadTrackFile 완료', { trackId: res.data?.id });
  return res.data;
}

/**
 * POST /upload/image (type='cover') — 발매된 트랙에 커버 이미지 부착.
 * 서버가 트랙 cover_image_url을 갱신하고 presigned URL을 반환한다.
 */
/**
 * v3.150 — POST /upload/cover-background (multipart file) — 커버 배경·장소 참조 사진 업로드.
 * 반환 {object_name}: generate-cover의 background_object_name으로 전달.
 */
export async function uploadCoverBackground(file: PickedFile): Promise<{ object_name: string }> {
  const formData = new FormData();
  await appendFile(formData, 'file', file, file.mimeType || guessImageMime(file.fileName));
  console.info('[trackService] uploadCoverBackground', { fileName: file.fileName, size: file.size ?? -1 });
  const res = await api.post('/upload/cover-background', formData, {
    headers: multipartHeaders(),
    timeout: 120000,
  });
  return res.data;
}

/**
 * v3.210 ③: AI 곡 Inst.(보컬 제거) 버전 생성 — 계약(PLAN v3.210, backend 조 병렬 작업):
 *   POST /tracks/{track_id}/instrumental — 소유자 전용·⭐5 선차감·중복 요청 락.
 *     402=잔액 부족, 409=이미 진행 중(락). 완료 시 서버가 "<원제> (Inst.)" 신규 트랙을
 *     자동 발매(커버·장르·무드·artist_name 승계, is_public=원곡 동일)하고 실패 시 환불.
 *   GET /tracks/{track_id}/instrumental/status — { status, error? } (generations 관행:
 *     pending|processing|completed|failed 어휘 — musicService.isGenerationInProgress와 동일 축).
 */
// v3.230 A5-6: 하드코딩 제거 — 표시·확인은 services/pointCosts(getPointCostSync('instrumental')) 사용.
// 이 상수는 하위호환용 폴백 별칭(서버 POINT_COSTS.instrumental과 동일 표).
export const INSTRUMENTAL_STAR_COST = FALLBACK_POINT_COSTS.instrumental;

export async function requestInstrumental(trackId: string): Promise<any> {
  if (__DEV__) console.info('[Inst] 생성 요청', { trackId });
  const res = await api.post(`/tracks/${trackId}/instrumental`);
  if (__DEV__) console.info('[Inst] 생성 요청 수락', { trackId, status: res.data?.status });
  return res.data;
}

export async function getInstrumentalStatus(trackId: string): Promise<any> {
  const res = await api.get(`/tracks/${trackId}/instrumental/status`);
  return res.data;
}

export async function uploadTrackCover(trackId: string, file: PickedFile): Promise<any> {
  const formData = new FormData();
  await appendFile(formData, 'file', file, file.mimeType || guessImageMime(file.fileName));
  formData.append('type', 'cover');
  formData.append('id', String(trackId));
  console.info('[trackService] uploadTrackCover', { trackId, fileName: file.fileName });
  const res = await api.post('/upload/image', formData, {
    headers: multipartHeaders(),
    timeout: 120000,
  });
  return res.data;
}

// ── v3.230 A3 [VideoDirector] 지난 영상 무료 재열람(D9 — 칩만, 보관함 탭 재도입 아님) ─────────
// 서버(routes/tracks.py, 변경 없음):
//   GET /api/tracks/my/share-videos → {items:[{track_id,title,object_name,format,size,last_modified}]}
//     (내 곡 최신 50곡, last_modified 최신순)
//   GET /api/tracks/share-video/object/{object_name} → video/mp4 (무인증, **공개 곡만 200 — 비공개 404**)
export interface ShareVideoItem {
  track_id: string;
  title?: string;
  object_name: string;
  format?: string;
  size?: number;
  last_modified?: string | null;
}

const SHARE_OBJECT_RE = /^share\/v[5678]\/[a-f0-9]{24}[A-Za-z0-9_\-]*\.mp4$/;

export async function listMyShareVideos(): Promise<ShareVideoItem[]> {
  const res = await api.get('/tracks/my/share-videos', { timeout: 20000 });
  const items: any[] = Array.isArray(res.data?.items) ? res.data.items : [];
  return items
    .filter((it) => it && typeof it.object_name === 'string' && SHARE_OBJECT_RE.test(it.object_name) && it.track_id)
    .map((it) => ({
      track_id: String(it.track_id),
      title: it.title,
      object_name: String(it.object_name),
      format: typeof it.format === 'string' ? it.format : undefined,
      size: typeof it.size === 'number' ? it.size : undefined,
      last_modified: typeof it.last_modified === 'string' ? it.last_modified : null,
    }));
}

/** 곡별 최신 1개(last_modified 최신) — 서버 정렬을 믿지 않고 다시 고른다 */
export function latestShareVideoByTrack(items: ShareVideoItem[]): Record<string, ShareVideoItem> {
  const out: Record<string, ShareVideoItem> = {};
  for (const it of items) {
    const cur = out[it.track_id];
    if (!cur || (it.last_modified || '') > (cur.last_modified || '')) out[it.track_id] = it;
  }
  return out;
}

/** object 프록시 재생 URL(공개 곡만 재생 가능 — 호출부가 공개 여부를 먼저 확인) */
export function shareVideoObjectUrl(objectName: string): string {
  return `${BACKEND_BASE_URL}/api/tracks/share-video/object/${objectName.split('/').map(encodeURIComponent).join('/')}`;
}
