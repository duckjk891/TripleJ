import axios from 'axios';

// 백엔드는 Tailscale 머신(100.127.225.55:8000) 에서 항상 호스팅 중.
// frontend 를 어느 PC 에서 dev 하든 동일 백엔드를 호출하도록 명시.
// (이전엔 window.location.hostname 기반 → 다른 PC 에서 띄우면 자기 자신의 :8000 호출하려다 REFUSED)
// .env 로 override 가능 (VITE_BACKEND_BASE_URL).
const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL || 'http://100.127.225.55:8000';

const API = axios.create({
  baseURL: `${BACKEND_BASE_URL}/api`,
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(e);
  }
);

// Health
export const getHealth = () => API.get('/health');

// Auth
export const register = (email, password, nickname) =>
  API.post('/auth/register', { email, password, nickname });
export const login = (email, password) =>
  API.post('/auth/login', { email, password });
export const getMe = () => API.get('/auth/me');
export const logout = () => API.post('/auth/logout');
export const updateProfile = (payload) => API.patch('/auth/me/profile', payload);

// Story
export const createStory = (data) => API.post('/story', data);
export const getStory = (id) => API.get(`/story/${id}`);

// v9 — Story text polish (사용자 자유 텍스트 다듬기)
// payload: { text, refs:[MentionRef], model: "claude_4_7_opus"|"gpt_latest", label }
// 응답: { polished_text, model_used, elapsed_ms, refs_preserved }
export const polishStoryText = (payload) =>
  API.post('/story/polish', payload, { timeout: 90000 });

// MV jobs
export const createMVJob = (data) => API.post('/mv/jobs', data);
export const getMVJobs = () => API.get('/mv/jobs');

// v36 — 작품(job) 삭제 (그 잡에 묶인 wedding_assets 도 backend 가 cleanup).
export const deleteMVJob = (jobId) => API.delete(`/mv/jobs/${jobId}`);
export const getMVJob = (id) => API.get(`/mv/jobs/${id}`);

// v12 — Admin review request toggle (소유자만 호출 가능)
export const requestAdminReview = (jobId) =>
  API.post(`/mv/jobs/${jobId}/request-admin`);
export const cancelAdminReview = (jobId) =>
  API.delete(`/mv/jobs/${jobId}/request-admin`);

// MV music gen (v3)
export const startMusicGen = (jobId) => API.post(`/mv/jobs/${jobId}/music`);

export const audioStreamUrl = (jobId, variant = 1) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/mv/jobs/${jobId}/audio?token=${encodeURIComponent(token)}&variant=${variant}`;
};

// v43 — 다운로드용 URL. 백엔드가 ?download=1 일 때 Content-Disposition: attachment 헤더 추가.
// cross-origin 환경에서 <a download> 속성이 무시되는 문제 회피.
export const audioDownloadUrl = (jobId, variant = 1) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/mv/jobs/${jobId}/audio?token=${encodeURIComponent(token)}&variant=${variant}&download=1`;
};

// Couple character
export const saveCoupleCharacter = (data) => API.post('/character/couple', data);
export const getCoupleCharacter = () => API.get('/character/couple');

// Character sheets (v4 — groom/bride × casual/wedding, 4 sheets)
// Caller passes FormData with: file, top_image_object_name, bottom_image_object_name,
// shoes_image_object_name, user_text, image_model, role, style.
export const generateCharacterSheet = (formData) =>
  API.post('/character/sheets/generate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // GPT Image 2 가 무거워 3~5분 걸리는 케이스 있음 — 5분으로 확장.
    timeout: 300000,
  });

export const saveCharacterSheet = (payload) =>
  API.post('/character/sheets/save', payload);

export const refineCharacterSheet = (formData) =>
  API.post('/character/sheets/refine', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  });

export const getCharacterSheets = () => API.get('/character/sheets');

// v35 — 같은 job 안 lyrics/music 갈아엎기 (같은 job, 새 story_id + music_spec).
export const regenerateMVJob = (jobId, { story_id, music_spec }) =>
  API.post(`/mv/jobs/${jobId}/regenerate`, { story_id, music_spec });

// v27 — 음악만 재생성. 가사 그대로 두고 Suno 호출만 다시 실행.
// status 가 music_ready / music_failed 일 때만 200, 그 외 409.
// 백엔드가 audio_variants / lyric_timestamps_variants 초기화 후 generating_music 으로 전환.
export const regenerateMVJobMusic = (jobId) =>
  API.post(`/mv/jobs/${jobId}/music/regenerate`);

// v39 — 생성된 가사 제목/본문 수동 수정.
// payload: { title?: string(1~200), body?: string(1~5000) } — 둘 다 strip, 최소 하나 필수.
// 가드: 401 → 400(ObjectId) → 404 → 403(non-owner) → 409(queued/generating) → 422(validation).
// body 변경 시 백엔드가 lyric_timestamps_status='stale' 로 마킹.
// 응답: 기존 GET /mv/jobs/{id} 와 동일 shape (updated_doc).
// v53.5 — `?_t=<timestamp>` cache-buster 로 stale CORS preflight 캐시 우회.
// 일부 사용자 브라우저가 max-age=60 을 무시하고 오래된 preflight 응답을
// 들고 있어 PATCH 가 자체 차단된 사례 발견. URL path 가 매번 다르면
// 새 preflight 가 강제되므로 stale 캐시와 무관.
export const patchMVJobLyrics = (jobId, { title, body }) => {
  const payload = {};
  if (typeof title === 'string') payload.title = title;
  if (typeof body === 'string') payload.body = body;
  return API.patch(`/mv/jobs/${jobId}/lyrics?_t=${Date.now()}`, payload);
};

// v33 — Wizard 작성중 draft 영속화 (user 당 1개)
export const getMyDraft = () => API.get('/mv/drafts/mine');
export const saveMyDraft = ({ payload, step, title }) =>
  API.put('/mv/drafts/mine', { payload, step, title });
export const deleteMyDraft = () => API.delete('/mv/drafts/mine');

// v6 — async sheet job polling. Returns {job_id, type, status, role, style,
// image_model, sheet_object_name, preview_url, error_message, created_at, updated_at}.
export const getSheetJob = (jobId) =>
  API.get(`/character/sheets/jobs/${jobId}`);

export const getWeddingOutfits = ({ role, style, category }) =>
  API.get('/character/outfits', { params: { role, style, category } });

// Outfit catalog item management (v5 — user-added items).
// Caller passes FormData with: image (File), name, role, style, category,
// product_url (optional). Same multipart pattern as character sheet upload.
export const createOutfitItem = (formData) =>
  API.post('/character/outfits', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// Returns the current user's own outfit items. `params` may include any subset
// of { role, style, category }. Axios drops undefined query params.
// v18: 관리자 토큰이면 모든 사용자의 아이템 반환 (각 아이템에 owner_email/owner_nickname 포함).
//      일반 사용자는 본인 아이템만, owner 키 없음.
export const getMyOutfitItems = (params = {}) =>
  API.get('/character/outfits/mine', { params });

// PUT accepts the same multipart fields as POST — all optional. Only the
// item's owner is permitted; backend returns 403 with detail otherwise.
export const updateOutfitItem = (itemId, formData) =>
  API.put(`/character/outfits/${itemId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const deleteOutfitItem = (itemId) =>
  API.delete(`/character/outfits/${itemId}`);

// v20 — outfit items 일괄 삭제. body: { item_ids: [str] } (1~50).
// 응답: { deleted_count, failed:[{item_id, reason}], total_requested }.
export const bulkDeleteOutfitItems = (itemIds) =>
  API.post('/character/outfits/bulk-delete', { item_ids: itemIds });

// Preview URL for character sheets and outfit images (both under mv-wedding-photos).
// Mirrors audioStreamUrl pattern — appends token query so preview route can
// fall back to ?token=... when Authorization header is absent (e.g. <img src>).
export const sheetPreviewUrl = (objectName) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/character/preview/${objectName}?token=${encodeURIComponent(token)}`;
};

// Trigger a browser download for any asset reachable via sheetPreviewUrl
// (character sheets, outfit thumbnails, place assets, wedding photos that
// route through /character/preview). Fetches as blob to bypass Content-
// Disposition limitations and force the supplied filename.
export const downloadAssetByObjectName = async (objectName, filename) => {
  const url = sheetPreviewUrl(objectName);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download_failed status=${res.status}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || objectName.split('/').pop() || 'asset.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
};

// Assets
export const uploadAsset = (file, kind = 'photo') => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind);
  return API.post('/assets/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// Places — v7 (장소 이미지 자산)
export const createPlaceUploaded = (formData) =>
  API.post('/places/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const generatePlace = (payload) =>
  API.post('/places/generate', payload);

export const getPlaceJob = (jobId) =>
  API.get(`/places/jobs/${jobId}`);

export const listPlaces = () =>
  API.get('/places');

export const updatePlace = (placeId, payload) =>
  API.put(`/places/${placeId}`, payload);

export const deletePlace = (placeId) =>
  API.delete(`/places/${placeId}`);

// v13 — Wedding photo generation (작품 컨텍스트 + 잡 + 갤러리/디테일).
// `/api/mv/jobs/{mv_job_id}/context` 응답은 멘션 옵션 풀 빌드용:
//   { owner_user_id, owner_sheets:[{slot, display_name, sheet_object_name}],
//     owner_places:[{place_id, display_name, memo, object_name}],
//     wedding_photos:[{photo_id, object_name, preview_url, meta, created_at}] }.
// owner OR admin 가드는 백엔드에서 처리.
export const getJobContext = (jobId) =>
  API.get(`/mv/jobs/${jobId}/context`);

// payload: { groom_sheet_slot, bride_sheet_slot, place_object_name,
//            image_model, user_text, user_text_refs:[MentionRef] }.
// 응답: { photo_id, job_id, status:"queued" }.
export const generateWeddingPhoto = (jobId, payload) =>
  API.post(`/mv/jobs/${jobId}/wedding-photos/generate`, payload);

// 폴링: status ∈ queued|running|done|failed. 완료 시 object_name/preview_url 포함.
export const getWeddingPhotoJob = (jobId, photoJobId) =>
  API.get(`/mv/jobs/${jobId}/wedding-photos/jobs/${photoJobId}`);

// 갤러리. 응답 { items:[{photo_id, object_name, preview_url, meta, created_at}, ...] }.
export const listWeddingPhotos = (jobId) =>
  API.get(`/mv/jobs/${jobId}/wedding-photos`);

// 디테일. 응답 { photo_id, object_name, meta, created_at, user_text,
// groom:{...}, bride:{...}, place:{...}, image_model }.
export const getWeddingPhoto = (jobId, photoId) =>
  API.get(`/mv/jobs/${jobId}/wedding-photos/${photoId}`);

export const deleteWeddingPhoto = (jobId, photoId) =>
  API.delete(`/mv/jobs/${jobId}/wedding-photos/${photoId}`);

// v16 — Wedding photo download + bulk delete
export const downloadWeddingPhoto = (jobId, photoId) =>
  API.get(`/mv/jobs/${jobId}/wedding-photos/${photoId}/download`, {
    responseType: 'blob',
    timeout: 60000,
  });

export const downloadWeddingPhotosZip = (jobId, photoIds) =>
  API.post(
    `/mv/jobs/${jobId}/wedding-photos/download`,
    { photo_ids: photoIds },
    { responseType: 'blob', timeout: 180000 },  // 50장 ZIP 까지 여유
  );

export const bulkDeleteWeddingPhotos = (jobId, photoIds) =>
  API.post(`/mv/jobs/${jobId}/wedding-photos/bulk-delete`, {
    photo_ids: photoIds,
  });

// v15 — 웨딩사진 멀티턴 refine (체인).
// payload: { refine_request: str(1~1000), refine_request_refs: [MentionRef], image_model }.
// 응답: { photo_id(new), job_id, status:"queued" }. 폴링은 기존 getWeddingPhotoJob.
export const refineWeddingPhoto = (jobId, photoId, payload) =>
  API.post(`/mv/jobs/${jobId}/wedding-photos/${photoId}/refine`, payload);

// anchor photo 가 속한 체인의 모든 버전을 created_at asc 정렬해 반환.
// 응답: { items:[{photo_id, object_name, preview_url, meta, created_at}, ...] }.
export const getWeddingPhotoChain = (jobId, photoId) =>
  API.get(`/mv/jobs/${jobId}/wedding-photos/${photoId}/chain`);

// 기존 createPlaceUploaded 는 그대로 사용. admin 이 다른 사용자 명의로 등록할 때는
// 호출부에서 formData.append('owner_user_id', ownerUserId) 만 추가하면 된다 — 백엔드가
// admin role 검증 후 owner_user_id 를 반영. 비admin 이 owner_user_id 를 보내면 무시되거나 403.

// v11 — Admin routes (관리자 전용; 403 for non-admin)
export const getAdminJobs = () => API.get('/admin/jobs');
export const getAdminUsers = () => API.get('/admin/users');
export const updateUserRole = (userId, role) =>
  API.patch(`/admin/users/${userId}/role`, { role });

// v17.1 — Pre-MV (식전영상) jobs. prefix /api/pre-mv.
// 라우터는 owner OR admin 가드(부모 mv_jobs.user_id 기준).
//
// 흐름:
//   1) createPreMVJob({mv_job_id}) — mv_jobs.status=music_ready && lyric_timestamps 준비된 경우만 200.
//      동일 mv_job_id 의 잡이 있으면 그 잡 반환(멱등).
//   2) runPreMVPhase0(id, {scenario_model, force?}) — Claude 4.7 Opus 또는 GPT 최신.
//      백그라운드 LLM 매핑 → status: phase0_mapping → phase0_ready.
//   3) runPreMVPhase1(id, {force?}) — 가사 라인 단위 씬 분할.
//      백그라운드 → status: phase1_splitting → phase1_ready.
//   4) patchPreMVScene(id, n, fields) — 씬 텍스트 편집. image_prompt 변경 시 video/image 모두 invalidate.
//
// 폴링: getPreMVJob(id) 5초 간격.
//
// v17.2 / v17.3 에서 phase2/phase3/phase4 + regenerate + result/stream 가 추가됨.
// v19 — variant 선택 가능. opts.variant 는 1(기본) 또는 2.
export const createPreMVJob = (mvJobId, opts = {}) =>
  API.post('/pre-mv/jobs', {
    mv_job_id: mvJobId,
    variant: opts.variant || 1,
  });

export const listPreMVJobs = (mvJobId) =>
  API.get('/pre-mv/jobs', { params: { mv_job_id: mvJobId } });

export const getPreMVJob = (id) =>
  API.get(`/pre-mv/jobs/${id}`);

export const getPreMVJobStatus = (id) =>
  API.get(`/pre-mv/jobs/${id}/status`);

// scenarioModel ∈ "claude_4_7_opus" | "gpt_latest" (기본 Claude).
// force=true 면 기존 scenes[] 초기화 후 재실행.
export const runPreMVPhase0 = (id, { scenario_model = 'claude_4_7_opus', force = false } = {}) =>
  API.post(`/pre-mv/jobs/${id}/phase0`, { scenario_model, force });

// v21.4 — LLM 자율 결정 정책으로 clips_per_event 입력 폐기. backward compat 위해 받아도
// body 전송 안 함 (백엔드도 받아도 무시).
export const runPreMVPhase1 = (id, { force = false } = {}) =>
  API.post(`/pre-mv/jobs/${id}/phase1`, { force });

// payload: { description?, description_ko?, image_prompt?, image_prompt_ko?,
//            video_prompt?, video_prompt_ko? } (모두 선택).
// 응답: { scene_number, updated_fields:[...], scene:{...} }.
export const patchPreMVScene = (id, sceneNumber, payload) =>
  API.patch(`/pre-mv/jobs/${id}/scenes/${sceneNumber}`, payload);

// v17.2 — Phase 2 (씬 이미지).
// imageModel ∈ "gpt_image_2" | "nb_pro". 잡 단위 lock — 한 번 시작한 모델로 고정.
// force=true 면 이미 완료된 씬도 모두 재생성.
// 응답: { pre_mv_job_id, status:"phase2_images", image_model, queued_scene_numbers:[...] }
export const runPreMVPhase2 = (id, { image_model = 'gpt_image_2', force = false } = {}) =>
  API.post(`/pre-mv/jobs/${id}/phase2`, { image_model, force });

// 단일 씬 이미지 재생성. ⚠️ v35 이후 deprecated — 챕터 일관성을 깸.
// 신규 호출은 regeneratePreMVChapterImages 로.
export const regeneratePreMVSceneImage = (id, sceneNumber) =>
  API.post(`/pre-mv/jobs/${id}/scenes/${sceneNumber}/regenerate-image`);

// v35 — 챕터(연속 같은 story_slot) 단위 씬 이미지 재생성.
// sceneNumber 는 그 챕터의 어떤 씬이든 OK — 백엔드가 같은 챕터 모든 씬을 찾아 직렬 재생성.
// 응답: { pre_mv_job_id, chapter_seq, story_slot, queued_scene_numbers:[...], status, image_model }
export const regeneratePreMVChapterImages = (id, sceneNumber) =>
  API.post(`/pre-mv/jobs/${id}/chapters/regenerate-images`, { scene_number: sceneNumber });

// <img src> 용 URL — Bearer 헤더 대신 ?token= 쿼리 인증을 사용한다.
// sheetPreviewUrl 패턴과 동일.
export const preMVSceneImageUrl = (id, sceneNumber) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/pre-mv/jobs/${id}/scenes/${sceneNumber}/image?token=${encodeURIComponent(token)}`;
};

// v17.3 — Phase 3 (씬 영상).
// videoModel ∈ "veo" | "kling" | "seedance" | "grok". 잡 단위 lock — 처음 선택한 모델로 고정.
// force=true 면 이미 완료된 씬도 모두 재생성.
// 응답: { pre_mv_job_id, status:"phase3_videos", video_model, queued_scene_numbers:[...] }
export const runPreMVPhase3 = (id, { video_model = 'veo', force = false } = {}) =>
  API.post(`/pre-mv/jobs/${id}/phase3`, { video_model, force });

// 단일 씬 영상 재생성. ⚠️ v40 이후 deprecated — 챕터 일관성 (end_frame transition) 깸.
// 신규 호출은 regeneratePreMVChapterVideos 로.
export const regeneratePreMVSceneVideo = (id, sceneNumber) =>
  API.post(`/pre-mv/jobs/${id}/scenes/${sceneNumber}/regenerate-video`);

// v40 — 챕터(연속 같은 story_slot + memory_index) 단위 씬 영상 재생성.
// sceneNumber 는 그 챕터의 어떤 씬이든 OK — 백엔드가 챕터 모든 씬을 찾아 직렬 재생성.
// 응답: { pre_mv_job_id, chapter_seq, story_slot, queued_scene_numbers:[...], status, video_model }
export const regeneratePreMVChapterVideos = (id, sceneNumber) =>
  API.post(`/pre-mv/jobs/${id}/chapters/regenerate-videos`, { scene_number: sceneNumber });

// <video src> 용 URL — Bearer 대신 ?token=. StreamingResponse video/mp4.
export const preMVSceneVideoUrl = (id, sceneNumber) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/pre-mv/jobs/${id}/scenes/${sceneNumber}/video?token=${encodeURIComponent(token)}`;
};

// v24.2 — <a download href={url}> 용. preMVSceneVideoUrl 과 같은 URL.
// 백엔드가 Content-Disposition: attachment; filename="{NN}_{slot}_{seq}.mp4" 헤더로
// 다운로드 파일명을 부여한다.
export const downloadPreMVSceneVideo = (id, sceneNumber) =>
  preMVSceneVideoUrl(id, sceneNumber);

// v51 — 씬 이미지 다운로드 URL. preMVSceneImageUrl + &download=1.
// 백엔드가 download=true 일 때 Content-Disposition: attachment; filename="{NN}_{slot}_{seq}.png"
// 헤더 부여 (확장자만 mp4 → png).
export const downloadPreMVSceneImage = (id, sceneNumber) =>
  `${preMVSceneImageUrl(id, sceneNumber)}&download=1`;

// v24.2 — 일괄 ZIP 다운로드. sceneNumbers=null/[] → 완료된 전체.
// response.data 는 Blob — 호출처에서 createObjectURL + anchor click 으로 트리거.
export const downloadPreMVScenesZip = (id, sceneNumbers = null) =>
  API.post(
    `/pre-mv/jobs/${id}/scenes/download-zip`,
    { scene_numbers: sceneNumbers },
    { responseType: 'blob' },
  );

// v17.3 — Phase 4 (concat + audio merge).
// force=true 면 status=completed 인 잡도 다시 합성. 응답: { pre_mv_job_id, status, scene_count }.
export const runPreMVPhase4 = (id, { force = false } = {}) =>
  API.post(`/pre-mv/jobs/${id}/phase4`, { force });

// 최종 식전영상 mp4 스트리밍 URL — <video src> 호환.
export const preMVResultVideoUrl = (id) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/pre-mv/jobs/${id}/result?token=${encodeURIComponent(token)}`;
};

// Share (public)
export const getSharedMV = (token) => API.get(`/share/${token}`);

// v23 — Extra video studio (Higgsfield-style 편집자 공간)

// Scene Images (A)
export const createExtraSceneImage = (mvJobId, payload) =>
  API.post('/extra/scene-images', { mv_job_id: mvJobId, ...payload });
export const listExtraSceneImages = (mvJobId) =>
  API.get('/extra/scene-images', { params: { mv_job_id: mvJobId } });
export const getExtraSceneImage = (id) => API.get(`/extra/scene-images/${id}`);
export const deleteExtraSceneImage = (id) => API.delete(`/extra/scene-images/${id}`);
export const bulkDeleteExtraSceneImages = (ids) =>
  API.post('/extra/scene-images/bulk-delete', { ids });
export const downloadExtraSceneImage = (id) =>
  API.get(`/extra/scene-images/${id}/download`, { responseType: 'blob' });
export const extraSceneImagePreviewUrl = (objectName) => sheetPreviewUrl(objectName);

// Extra Videos (B)
export const createExtraVideo = (mvJobId, payload) =>
  API.post('/extra/videos', { mv_job_id: mvJobId, ...payload });
export const listExtraVideos = (mvJobId) =>
  API.get('/extra/videos', { params: { mv_job_id: mvJobId } });
export const getExtraVideo = (id) => API.get(`/extra/videos/${id}`);
export const deleteExtraVideo = (id) => API.delete(`/extra/videos/${id}`);
export const bulkDeleteExtraVideos = (ids) =>
  API.post('/extra/videos/bulk-delete', { ids });
export const downloadExtraVideo = (id) =>
  API.get(`/extra/videos/${id}/download`, { responseType: 'blob' });
export const extraVideoStreamUrl = (id) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/extra/videos/${id}/stream?token=${encodeURIComponent(token)}`;
};
export const refineExtraVideo = (id, payload) =>
  API.post(`/extra/videos/${id}/refine`, payload);
export const getExtraVideoChain = (id) => API.get(`/extra/videos/${id}/chain`);
export const continueExtraVideo = (id, payload = {}) =>
  API.post(`/extra/videos/${id}/continue`, payload);

export default API;
