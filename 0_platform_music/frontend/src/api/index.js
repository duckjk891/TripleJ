import axios from 'axios';
// v185 — 실패 API 구조화 수집. remoteLogger 는 flush 시점에만 ../api 를 사용(지연 바인딩)이라 순환 안전.
import { logApiFailure } from '../utils/remoteLogger';

// vite proxy 가 /api → backend (9006) 로 forward
const API = axios.create({
  baseURL: '/api',
});

// JWT 토큰 자동 첨부
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 응답 인터셉터 - 401 또는 토큰 만료/무효(403) 시 토큰 제거 + /login 리다이렉트
// 백엔드(app/auth.py) 정책: 누락=401, 만료/Invalid=403("토큰이 만료"/"유효하지 않은 토큰"),
// 권한부족=403("관리자 권한이 필요합니다." 등) — 권한 부족은 토큰 유지.
API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail =
      error.response?.data?.detail ||
      error.response?.data?.error ||
      error.response?.data?.message ||
      '';
    const isTokenInvalid =
      status === 401 ||
      (status === 403 && /토큰|token|만료|expired|invalid|세션/i.test(String(detail)));
    if (isTokenInvalid) {
      // 비로그인 요청의 401: 요청에 Authorization 토큰이 붙어 있지 않았다면
      // 세션 만료가 아님 — localStorage 정리/리다이렉트 없이 조용히 reject.
      const hadAuthToken =
        !!error.config?.headers?.Authorization || !!localStorage.getItem('token');
      if (!hadAuthToken) {
        if (import.meta.env.DEV) {
          console.warn('[API] anon 401, no redirect', { status });
        }
        return Promise.reject(error);
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      clearMyCharacterCache(); // 강제 로그아웃 시 캐릭터 캐시 정리 (구키 cachedCharacter* 는 폐기됨)
      const path = window.location.pathname || '';
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        try {
          sessionStorage.setItem(
            'postLoginRedirect',
            (window.location.pathname || '/') + (window.location.search || '')
          );
        } catch { /* ignore */ }
        if (import.meta.env.DEV) {
          console.warn('[API] token invalid, redirecting to /login', { status, detail });
        }
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

// v185 — 실패 API 수집(api_failure): 4xx/5xx·네트워크 에러를 remoteLogger 구조화 이벤트로 적재.
// 민감 파라미터 마스킹·/_logs/ 자기 전송 제외는 remoteLogger.logApiFailure 내부 처리.
API.interceptors.response.use(
  (response) => response,
  (error) => {
    try {
      let fullUrl = '';
      try { fullUrl = error.config ? API.getUri(error.config) : ''; } catch { fullUrl = error.config?.url || ''; }
      logApiFailure({
        method: error.config?.method,
        url: fullUrl,
        status: error.response?.status,
      });
    } catch { /* noop — 수집 실패가 원 에러 흐름을 막지 않는다 */ }
    return Promise.reject(error);
  }
);

// Auth
export const login = (email, password) =>
  API.post('/auth/login', { email, password });

// extra: 선택 인구통계 { birth_date?("YYYY-MM-DD"), gender?, region?, nationality?('domestic'|'foreign') }
// — 값이 있는 키만 포함해 전달할 것. nationality 무효값은 백엔드 400 (v123).
// v125 — extra.gender 필수(누락 400), extra.consents 필수:
//   { terms, privacy, overseas, age14: true 필수, marketing: bool, version } (필수 4개 미동의 시 400)
export const register = (email, password, nickname, extra) =>
  API.post('/auth/register', {
    email,
    password,
    nickname,
    ...(extra && typeof extra === 'object' ? extra : {}),
  });

// v125 — 동의 이력 기록(인증): consents = [{ key, agreed }] (key 7종 화이트리스트 외 400)
export const recordConsents = (consents, version) =>
  API.post('/auth/me/consents', { consents, version });

// v125 — 내 동의 최신 상태 조회(인증) → { consents: { [key]: { agreed, version, at } } }
export const getMyConsents = () =>
  API.get('/auth/me/consents');

// v123 — 가입 정책 조회(무인증) → { guardian_consent_enabled: bool }
export const getSignupConfig = () =>
  API.get('/auth/signup-config');

// v123 — 만14세 미만 가입: 보호자 동의 요청(무인증).
// payload: { email, password, nickname, birth_date, nationality?, gender?, region?,
//            guardian_name, guardian_phone } → { consent_url(테스트모드), status }
// 플래그 OFF 시 503. 주의: guardian_name/guardian_phone 값은 절대 콘솔에 출력하지 않는다.
export const requestGuardianConsent = (payload) =>
  API.post('/auth/guardian-consent/request', payload);

// v123 — 보호자 동의 고지 데이터 조회(무인증, 토큰 링크 경유)
export const getGuardianConsent = (token) =>
  API.get(`/auth/guardian-consent/${encodeURIComponent(token)}`);

// v123 — 보호자 동의/거부 결정(무인증) — { agree: bool }
export const decideGuardianConsent = (token, agree) =>
  API.post(`/auth/guardian-consent/${encodeURIComponent(token)}/decide`, { agree });

export const getMe = () =>
  API.get('/auth/me');

// 인구통계(생년월일/성별/지역) 부분 업데이트 — null 전달 시 해당 값 지우기.
export const updateMyProfile = (data) =>
  API.patch('/auth/me/profile', data);

// 소셜(OAuth) 로그인 시작 경로 — 상대경로 반환(컴포넌트가 window.location.assign 에 사용).
// provider = google | kakao | naver. 직접 URL 조립/호스트 박기 금지.
export const oauthLoginPath = (provider) => `/api/auth/oauth/${provider}/login`;

// 프로필 이미지 업로드 (multipart field `image`) → { profile_image: "profiles/..jpg" }
// 서버가 512×512 자동 크롭.
export const uploadProfileImage = (file) => {
  const formData = new FormData();
  formData.append('image', file);
  return API.post('/auth/me/profile-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// 프로필 이미지 삭제(기본 이니셜로 복귀) → { profile_image: null }
export const deleteProfileImage = () =>
  API.delete('/auth/me/profile-image');

// 회원탈퇴 — confirm_text 가 정확히 "회원탈퇴" 여야 성공(불일치 400). 성공 시 서버 세션 삭제.
export const withdrawAccount = (confirmText) =>
  API.delete('/auth/me', { data: { confirm_text: confirmText } });

// 프로필 이미지 프록시 URL (무인증) — adImageUrl 패턴. objectName = "profiles/...".
export const profileImageUrl = (objectName) =>
  `/api/auth/profile-image/${encodeURIComponent(objectName)}`;

// Albums
export const getAlbums = (params) =>
  API.get('/albums/', { params });

export const getLatestAlbums = (limit = 10) =>
  API.get('/albums/latest', { params: { limit } });

export const getAlbum = (id) =>
  API.get(`/albums/${id}`);

// v69 — Albums (CRUD + 트랙/커버)
export const getMyAlbums = (params) =>
  API.get('/albums/my', { params });

export const createAlbum = (formData) =>
  API.post('/albums/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const updateAlbum = (id, payload) =>
  API.patch(`/albums/${id}`, payload);

export const deleteAlbum = (id) =>
  API.delete(`/albums/${id}`);

export const addTracksToAlbum = (id, trackIds) =>
  API.post(`/albums/${id}/tracks`, { track_ids: trackIds });

export const removeTrackFromAlbum = (albumId, trackId) =>
  API.delete(`/albums/${albumId}/tracks/${trackId}`);

export const reorderAlbumTracks = (id, trackIds) =>
  API.put(`/albums/${id}/tracks/order`, { track_ids: trackIds });

export const updateAlbumCover = (id, formData) =>
  API.patch(`/albums/${id}/cover`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const generateAlbumCover = (payload) =>
  API.post('/albums/cover/generate', payload);

export const albumCoverPreviewUrl = (objectName) => {
  if (!objectName) return '';
  if (objectName.startsWith('http') || objectName.startsWith('/api/')) {
    return objectName;
  }
  return `/api/files/${objectName}`;
};

// Artists
export const getArtists = (params) =>
  API.get('/artists/', { params });

export const getArtist = (id) =>
  API.get(`/artists/${id}`);

export const getArtistAlbums = (id) =>
  API.get(`/artists/${id}/albums`);

export const getArtistSongs = (id, limit = 10) =>
  API.get(`/artists/${id}/tracks`, { params: { limit } });

// Charts
export const getTop100 = () =>
  API.get('/charts/top100');

export const getGenreChart = (genre, limit = 50) =>
  API.get(`/charts/genre/${genre}`, { params: { limit } });

// 느낌 카테고리 (고정 10종 — 백엔드 GET /charts/categories 가 목록 제공)
export const getCategories = () =>
  API.get('/charts/categories');

export const getCategoryChart = (category, limit = 50) =>
  API.get(`/charts/category/${encodeURIComponent(category)}`, { params: { limit } });

// Charts (v2 - Melon-style)
export const getChart = (chartType) =>
  API.get(`/charts/${chartType}`);

export const recordPlay = (trackId) =>
  API.post('/charts/record-play', { track_id: trackId });

// v160 — 70% 청취 시 재생 기록(A안) 임계값. PlayerContext / useFeedAudio 공용.
export const PLAY_RECORD_RATIO = 0.7;

// Playlists
export const getPlaylists = () =>
  API.get('/playlists/');

export const createPlaylist = (title, description, is_public = true) =>
  API.post('/playlists/', { title, description, is_public });

export const getPlaylist = (id) =>
  API.get(`/playlists/${id}`);

export const updatePlaylist = (id, data) =>
  API.put(`/playlists/${id}`, data);

export const deletePlaylist = (id) =>
  API.delete(`/playlists/${id}`);

export const addSongToPlaylist = (playlistId, trackId) =>
  API.post(`/playlists/${playlistId}/tracks`, { track_id: trackId });

export const removeSongFromPlaylist = (playlistId, trackId) =>
  API.delete(`/playlists/${playlistId}/tracks/${trackId}`);

// Likes
export const getLikes = (params) =>
  API.get('/likes/', { params });

export const checkLikes = (songIds) =>
  API.get('/likes/check', { params: { song_ids: songIds } });

export const likeSong = (songId) =>
  API.post(`/likes/${songId}`);

export const unlikeSong = (songId) =>
  API.delete(`/likes/${songId}`);

// Tracks (v2.0)
export const getLatestTracks = (limit = 10) =>
  API.get('/tracks/', { params: { limit, sort: 'created_at' } });

export const searchTracks = (q, params) =>
  API.get('/tracks/search', { params: { q, ...params } });
// v169 — 검색 결과 클릭 로깅 (CTR 측정, best-effort)
export const logSearchClick = (q, trackId) =>
  API.post('/tracks/search/click', { q, track_id: trackId });

// Upload (v2.0 - tracks API)
export const uploadTrack = (formData, onProgress) =>
  API.post('/tracks/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  });

export const uploadImage = (formData) =>
  API.post('/upload/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// Track detail
export const getTrackDetail = (id) =>
  API.get(`/tracks/${id}`);

export const getTrackMusicVideo = (trackId) =>
  API.get(`/tracks/${trackId}/music-video`);

// v149 — 가사 타임라인 (커버+가사 싱크 재생용)
// → { has_timestamps: bool, segments: [{text, start, end}], source: string } (초 단위)
export const getTrackLyricsTimeline = (trackId) =>
  API.get(`/tracks/${trackId}/lyrics-timeline`);

// v126 — SNS 공유 영상(커버+음원 9:16, 트랙당 1개 캐싱) 생성.
// 최초 생성은 곡 전체 인코딩으로 수십 초 소요 가능 → per-call 300s
// (axios 인스턴스 기본 timeout 미설정=무제한이지만 명시적으로 상한을 둔다).
// → { video_url: "/api/tracks/{id}/share-video/file", cached: bool }
// v129 — format 파라미터 추가(sns|wide|kakao, 기본 sns — 기존 콜러 무수정 호환)
export const createShareVideo = (trackId, format = 'sns') =>
  API.post(`/tracks/${trackId}/share-video`, null, {
    timeout: 300000,
    params: { format },
  });

// v126 — 공유 영상 파일 프록시 경로 헬퍼 (무인증, fetch blob/다운로드용)
// v129 — format 쿼리 추가(기본 sns)
export const shareVideoFileUrl = (trackId, format = 'sns') =>
  `/api/tracks/${trackId}/share-video/file?format=${encodeURIComponent(format)}`;

// v130 — Wondera recognize 가사 타임스탬프 요청 (인증, 본인 곡만).
// → { cached: bool, segments: N } / 실패 502 { error }
// 현재 Wondera 접속 차단 상태 — 차단 해제 후 UI 연결 예정 (함수 등록만).
export const recognizeTrackTimestamps = (trackId) =>
  API.post(`/tracks/${trackId}/recognize-timestamps`, null, { timeout: 300000 });

// Related tracks (queue auto-continuation)
export const getRelatedTracks = (trackId, excludeIds = [], limit = 1) => {
  const params = { limit };
  if (excludeIds.length > 0) params.exclude = excludeIds.join(',');
  return API.get(`/tracks/${trackId}/related`, { params });
};

// My tracks
export const getMyTracks = (params) => API.get('/tracks/my', { params });
export const deleteTrack = (id) => API.delete(`/tracks/${id}`);
export const updateTrack = (id, data) => API.put(`/tracks/${id}`, data);

// AI Cover
export const generateCover = (data) => API.post('/upload/generate-cover', data);
// v215 — 커버 보관함 (커버촬영실). 실경로 /api/upload/cover-sessions (앱팀 가안 /api/covers 아님).
// 목록: {covers:[{cover_session_id, cover_object_name, image_url, title, image_model,
//   current_version, history_count, gen_params, source, linked_tracks:[{id,title}], ...}], pagination}
// 삭제: 연결 곡 존재 시 409 {error, linked_tracks} — 미사용만 hard delete.
export const getCoverSessions = (params) => API.get('/upload/cover-sessions', { params });
// alias — PLAN F6 표기(listCoverSessions)와 지시 표기(getCoverSessions) 병존 흡수 (FE 소비 호환)
export const listCoverSessions = getCoverSessions;
export const deleteCoverSession = (coverSessionId) =>
  API.delete(`/upload/cover-sessions/${coverSessionId}`);
export const getCoverHistory = (coverSessionId) =>
  API.get(`/upload/cover-history/${coverSessionId}`);

// AI Music Video
export const generateMV = (data) => API.post('/upload/generate-mv', data);
export const checkMVStatus = (jobId) => API.get(`/upload/mv-status/${jobId}`);

// MV Draft System
// PLAN v30 구현1: scenario_style / vocal_gender / relationship 필드를 명시적으로 포함
// v209: track_id(「내 트랙」 곡 소스, MV촬영실) 지원 — 명시 필드로 통과시킨다.
//       미전송 시 null 정규화(서버 Optional) — 기존 generation 경로·호출부 시그니처 완전 하위호환.
export const createMVJob = (data) =>
  API.post('/mv/create', {
    ...data,
    scenario_style: data?.scenario_style ?? 'drama',
    vocal_gender: data?.vocal_gender ?? null,
    relationship: data?.relationship ?? null,
    track_id: data?.track_id ?? null,
  });
export const getMVJobs = () => API.get('/mv/jobs');
export const getMVJobDetail = (jobId) => API.get(`/mv/jobs/${jobId}`);
export const deleteMVJob = (jobId) => API.delete(`/mv/jobs/${jobId}`);
export const generateMVImages = (jobId, data) => API.post(`/mv/jobs/${jobId}/generate-images`, data || {});
export const uploadMVSceneImage = (jobId, sceneNumber, formData) =>
    API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/upload-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
export const regenerateMVSceneImage = (jobId, sceneNumber) =>
    API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/regenerate-image`);
export const generateMVVideos = (jobId, videoModel) => API.post(`/mv/jobs/${jobId}/generate-videos`, videoModel ? { video_model: videoModel } : {});
export const generateSceneVideo = (jobId, sceneNumber) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/generate-video`);
export const concatenateMV = (jobId) => API.post(`/mv/jobs/${jobId}/concatenate`);
export const saveMVDraft = (jobId, data) => API.post(`/mv/jobs/${jobId}/save-draft`, data);
export const cancelMVJob = (jobId) => API.post(`/mv/jobs/${jobId}/cancel`);
export const mergeAudioMV = (jobId, audioObjectName) =>
    API.post(`/mv/jobs/${jobId}/merge-audio`, { audio_object_name: audioObjectName });
export const getMVModels = () => API.get('/mv/models');
// v211 — MV 곡 부착 (전 구간 무과금 메타데이터). 타겟 파라미터 없음 — job 자신의
// 소스 곡에만 부착. 409 {error, conflicting_job_id, conflicting_title} 수신 시
// confirm 후 attachMVJob(jobId, true) 재호출 = 교체 UX.
export const attachMVJob = (jobId, replace = false) =>
  API.post(`/mv/jobs/${jobId}/attach`, { replace });
export const detachMVJob = (jobId) => API.post(`/mv/jobs/${jobId}/detach`);
export const retrySyncLabs = (jobId, sceneNumber) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/retry-sync`);
export const separateVocal = (jobId, sceneNumber) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/separate-vocal`, {}, { timeout: 300000 });
export const selectScenario = (jobId, model) => API.post(`/mv/jobs/${jobId}/select-scenario`, { model });
export const selectPrompts = (jobId, model) => API.post(`/mv/jobs/${jobId}/select-prompts`, { model });

// Character
export const generateCharacterSheet = (formData) =>
  API.post('/character/generate-sheet', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 참조 이미지 다수(사진+상의/하의/신발) + 2단계(텍스트→이미지) 생성은 3~4분 소요 가능 → 6분.
    timeout: 600000,
  });

// 가상화(그림/만화) 캐릭터 — 화풍 샘플 목록 / 샘플 이미지 / 생성
export const getStyleSamples = () =>
  API.get('/character/style-samples');
// 화풍 샘플 이미지 — vite proxy 통해 same-origin 상대경로 반환(직접 호스트/포트 금지)
export const styleSamplePreviewUrl = (key) =>
  `/api/character/style-sample/${encodeURIComponent(key)}`;
export const generateCharacterSheetCartoon = (formData) =>
  API.post('/character/generate-sheet-cartoon', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 사진+아이템(상/하/신)+화풍 참조 다수 + 2단계 생성은 3~4분 소요 가능 → 6분.
    timeout: 600000,
  });

// 비동기 접수판 — 접수만 하고 job_id 반환(수초 내 응답) → GET /character/job/{id} 폴링.
// 폼필드는 동기판(generate-sheet / generate-sheet-cartoon)과 완전히 동일.
export const generateCharacterSheetAsync = (formData) =>
  API.post('/character/generate-sheet-async', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000, // 접수만이라 30초
  });
export const generateCharacterSheetCartoonAsync = (formData) =>
  API.post('/character/generate-sheet-cartoon-async', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000, // 접수만이라 30초
  });
// job 상태 조회 — {job_id, mode, status:'processing'|'done'|'failed', object_name?, preview_url?, error?, ...}
export const getCharacterJob = (jobId) =>
  API.get(`/character/job/${jobId}`);

// ── 캐릭터 캐시 (v162 계정격리 픽스) ─────────────────────────
// 키에 사용자 id 를 포함해 계정 전환 시 이전 계정 캐시를 절대 읽지 못하게 한다.
// (구버전 키 'aimu:myCharacter'(무스코프)/'cachedCharacter' 는 폐기 — 정리 함수가 함께 제거)
function myCharacterCacheKey() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return u?.id ? `aimu:myCharacter:${u.id}` : null; // 비로그인 시 캐시 미사용
  } catch { return null; }
}
// 로그아웃/계정전환/강제로그아웃 시 캐릭터 캐시 전부 제거 (레거시 키 포함)
export function clearMyCharacterCache() {
  try {
    const doomed = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('aimu:myCharacter') || k.startsWith('cachedCharacter'))) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

// variant: 'real'(기본, 실사 슬롯) | 'virtual'(가상 슬롯). 호출부에서 'virtual' 지정 가능.
// v212: character_id(기존 아티스트 시트 교체)·kind(신규 아티스트, 슬롯 409)·
// gender/name/age/personality_* 프로필 필드 통과. variant 주입은 legacy 폴백만.
export const saveCharacter = async (data) => {
  const payload = { ...data };
  if (!payload.character_id && !payload.kind) payload.variant = payload.variant || 'real';
  const resp = await API.post('/character/save', payload);
  clearMyCharacterCache();
  return resp;
};
export const getMyCharacter = async () => {
  const cacheKey = myCharacterCacheKey();
  const TTL_MS = 5 * 60 * 1000; // 5분
  if (cacheKey) {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.ts && Date.now() - cached.ts < TTL_MS) {
          return { data: cached.data };
        }
      }
    } catch { /* ignore */ }
  }
  const resp = await API.get('/character/me');
  if (cacheKey) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: resp.data }));
    } catch { /* ignore */ }
  }
  return resp;
};
export const deleteMyCharacter = async () => {
  const resp = await API.delete('/character/me');
  clearMyCharacterCache();
  return resp;
};

// ── v212 아티스트 다중화 API ─────────────────────────────────────────────────
// 목록 캐시 키는 'aimu:myCharacters:{uid}' — clearMyCharacterCache 의
// 'aimu:myCharacter' prefix 매치로 단건 캐시와 함께 일괄 무효화된다.
function myCharacterListCacheKey() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return u?.id ? `aimu:myCharacters:${u.id}` : null;
  } catch { return null; }
}
// GET /character/list → {characters:[...], slots:{used,max}} (5분 캐시)
export const getCharacterList = async () => {
  const cacheKey = myCharacterListCacheKey();
  const TTL_MS = 5 * 60 * 1000;
  if (cacheKey) {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.ts && Date.now() - cached.ts < TTL_MS) return { data: cached.data };
      }
    } catch { /* ignore */ }
  }
  const resp = await API.get('/character/list');
  if (cacheKey) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: resp.data }));
    } catch { /* ignore */ }
  }
  return resp;
};
export const getCharacter = (characterId) => API.get(`/character/${characterId}`);
// PATCH — {name?, age?, gender?, personality_tags?, personality_text?, is_default?}
export const patchCharacter = async (characterId, body) => {
  const resp = await API.patch(`/character/${characterId}`, body);
  clearMyCharacterCache();
  return resp;
};
export const deleteCharacter = async (characterId) => {
  const resp = await API.delete(`/character/${characterId}`);
  clearMyCharacterCache();
  return resp;
};
export const getPersonalityTags = () => API.get('/character/personality-tags');
// POST /points/spend — action='extra_slot' 시 응답에 max_slots 동봉 (402=별 부족)
export const spendPoints = async (action, ref) => {
  const resp = await API.post('/points/spend', ref ? { action, ref } : { action });
  if (action === 'extra_slot') clearMyCharacterCache(); // slots.max 변동 → 리스트 캐시 무효화
  return resp;
};
export const refineCharacterSheet = (formData) =>
  API.post('/character/refine', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180000,
  });

// Face Verify (v135 — 얼굴 인증/생체 대조, FACE_VERIFY_ENABLED 기본 OFF)
// status: {enabled, is_verified, consent_needed, guardian_needed, guardian_status, registered}
export const getFaceVerifyStatus = () => API.get('/face-verify/status');
// 성인 본인 얼굴 인증(생체정보) 동의 기록
export const consentFaceVerify = (version) => API.post('/face-verify/consent', { version });
// 미성년 — 보호자 동의 문자 발송(mock) → {link?(mock), status}; 이후 status 폴링으로 승인 확인
export const requestFaceGuardianConsent = (guardian = {}) => API.post('/face-verify/guardian/request', guardian);
// 라이브니스 세션 생성(aws 모드) → {session_id, mode}
export const createFaceSession = () => API.post('/face-verify/session');
// 대조: photo(캐릭터 생성에 쓸 사진, 필수)
//  + selfieFile(mock — 실시간 촬영, 최초/재촬영 시) 또는 sessionId(aws — 라이브니스 세션)
// → {verified, method?, reason?('stored_mismatch'|'live_mismatch'|'liveness_failed'), need_recapture?}
export const verifyFace = (photoFile, { selfieFile, sessionId } = {}) => {
  const formData = new FormData();
  formData.append('photo', photoFile);
  if (selfieFile) formData.append('selfie', selfieFile);
  if (sessionId) formData.append('session_id', sessionId);
  return API.post('/face-verify/verify', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
};
// 동의 철회 — 저장 얼굴 정보·검증 기록 파기 → {withdrawn:true}
export const withdrawFaceVerify = () => API.delete('/face-verify');

// Voice Clone (v76 — Suno V5_5 Voice Cloning)
export const createVoiceClone = (formData) => API.post('/voice-clone/create', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
export const submitVoiceCloneVerify = (cloneId, formData) => API.post('/voice-clone/' + cloneId + '/verify', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
export const getVoiceClones = () => API.get('/voice-clone/list');
export const getVoiceClone = (id) => API.get('/voice-clone/' + id);
export const deleteVoiceClone = (id) => API.delete('/voice-clone/' + id);
export const regenerateVoiceClonePhrase = (id) => API.post('/voice-clone/' + id + '/regenerate-phrase');
export const checkVoiceCloneAvailability = () => API.post('/voice-clone/check-availability');
export const cleanupExpiredVoiceClones = () => API.post('/voice-clone/cleanup-expired');

// Wondera Test
export const wonderaUploadVocal = (formData) =>
  API.post('/wondera/upload-vocal', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
export const wonderaGenerate = (data) =>
  API.post('/wondera/generate', data, { timeout: 60000 });
export const wonderaQuery = (taskId) =>
  API.get(`/wondera/query/${taskId}`);
export const uploadWonderaFile = (formData) =>
  API.post('/wondera/upload-file', formData, {
    timeout: 60000,
  });
export const generateWonderaSong = (body) =>
  API.post('/wondera/generate', body, { timeout: 60000 });
export const queryWonderaSong = (taskId) =>
  API.get(`/wondera/query/${taskId}`);

// Track download
export const downloadTrackFile = (trackId) =>
  API.post(`/tracks/download/${trackId}`);

// Legacy aliases
export const uploadSong = uploadTrack;

// Reference Audio Upload (참고 음악 업로드)
export const uploadReferenceAudio = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return API.post('/generate/upload-reference/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
};

// AI Generation (작업실)
export const translateTags = (tags) => API.post('/generate/translate-tags', { tags });
export const generateLyrics = (data) => API.post('/generate/lyrics/', data);
export const createGeneration = (data) => API.post('/generate/', data);
export const startMusicGeneration = (id) => API.post(`/generate/${id}/start/`);
export const getGenerations = (params) => API.get('/generate/', { params });
export const getGeneration = (id) => API.get(`/generate/${id}`);
export const refetchGenerationTimestamps = (genId, force = false) =>
  API.post(`/generate/${genId}/timestamps/refetch`, null, { params: { force } });
// v209: draft(작사 임시저장) 전용 수정 — 서버가 본인 소유(403)+draft 여부(409) 가드,
// 화이트리스트(title/lyrics/prompt/genre/mood/style/categories/vocal/duration/duet 계열)만 반영.
export const updateGeneration = (id, payload) => API.patch(`/generate/${id}`, payload);
export const deleteGeneration = (id) => API.delete(`/generate/${id}`);
export const streamGeneration = (id) => API.get(`/generate/${id}/stream/`);
export const uploadFromGeneration = (data) => API.post('/tracks/upload-from-generation', data);
export const getGenerationModels = () => API.get('/generate/models/');

// v162 — Admin 전용 API 는 독립 앱(frontend_admin/src/api.js)으로 완전 이사.

// Cover preview URL helper (공용 — MusicPlayer/SongItem/feed/ChartPage/PlayerPage/UploadPage)
// 토큰 미첨부: 서버 cover_preview 는 무인증 엔드포인트라 ?token= 을 읽지 않는다.
// 붙여봐야 액세스 로그·Referer 에 JWT 만 남으므로 제거한다.
export const coverPreviewUrl = (objectName) =>
  `${API.defaults.baseURL}/upload/cover-preview/${encodeURIComponent(objectName)}`;

// Generation stream URL helper
// v74 — supports variantIndex (0 = first clip, BC; >=1 = second clip)
export const generationStreamUrl = (genId, variantIndex = 0) => {
  const token = localStorage.getItem('token');
  const v = Math.max(0, parseInt(variantIndex, 10) || 0);
  const variantQ = v > 0 ? `&variant=${v}` : '';
  return `${API.defaults.baseURL}/generate/${genId}/stream/?token=${encodeURIComponent(token || '')}${variantQ}`;
};

// Character sheet preview URL helper — vite proxy 통해 same-origin 상대경로 반환
export const characterPreviewUrl = (previewPath) => {
  if (!previewPath) return '';
  if (previewPath.startsWith('http')) return previewPath;
  if (previewPath.startsWith('/api/')) return previewPath;
  if (previewPath.startsWith('/')) return previewPath;
  return `/api/character/preview/${encodeURIComponent(previewPath)}`;
};

// Fetch audio as arraybuffer (for Web Audio API usage)
export const fetchAudioBuffer = (url) =>
  API.get(url, { responseType: 'arraybuffer' });

// Fetch a full URL as blob (for images/files already constructed via API helpers)
export const fetchAsBlob = (fullUrl) =>
  axios.get(fullUrl, { responseType: 'blob' });

// Business (고객사 광고 시스템)
export const getBusinessProfile = () => API.get('/business/profile');
export const updateBusinessProfile = (data) => API.put('/business/profile', data);
export const getAdItems = () => API.get('/business/ads');
export const createAdItem = (formData) =>
  API.post('/business/ads', formData);
export const updateAdItem = (itemId, formData) =>
  API.put(`/business/ads/${itemId}`, formData);
export const deleteAdItem = (itemId) => API.delete(`/business/ads/${itemId}`);
export const toggleAdItem = (itemId) => API.patch(`/business/ads/${itemId}/toggle`);
// verifiedOnly(옵션, 기본 false): true 일 때만 verified_only=true 쿼리 추가(본인인증 회원 필터)
export const getBusinessDashboard = (period = 'daily', category, verifiedOnly = false) => {
  const params = { period };
  if (category && category !== '전체') params.category = category;
  if (verifiedOnly) params.verified_only = true;
  return API.get('/business/dashboard', { params });
};
export const recordAdImpression = (itemId) =>
  API.post(`/business/ads/${itemId}/impression`);
// trackId(옵션): 곡 페이지 경유 클릭의 스타 귀속용. 없으면 미귀속 기록.
// anonId(옵션): 비로그인 익명 클릭 기록용 — 있으면 body 에 anon_id 포함.
export const recordAdClick = (itemId, trackId, anonId) => {
  const body = {};
  if (trackId) body.track_id = trackId;
  if (anonId) body.anon_id = anonId;
  return API.post(
    `/business/ads/${itemId}/click`,
    Object.keys(body).length > 0 ? body : undefined,
  );
};
// 아이템별 스타(사용자) 성과 — 본인 소유 아이템만 조회 가능
export const getAdItemStars = (itemId, period = 'daily', verifiedOnly = false) =>
  API.get(`/business/ads/${itemId}/stars`, {
    params: verifiedOnly ? { period, verified_only: true } : { period },
  });
export const getActiveAds = (category) =>
  API.get('/business/ads/active', { params: category ? { category } : {} });
// 아이템별 인사이트(위시→클릭 전환, 장르/느낌/요일/시간대, 인구통계) — 본인 소유 아이템만
export const getAdItemInsights = (itemId, period = 'daily', verifiedOnly = false) =>
  API.get(`/business/ads/${itemId}/insights`, {
    params: verifiedOnly ? { period, verified_only: true } : { period },
  });
export const adImageUrl = (objectName) =>
  `/api/business/items/image/${encodeURIComponent(objectName)}`;

// Wishlist (광고상품 위시리스트)
// trackId(옵션): 곡 페이지 경유 위시의 스타 귀속용. 없으면 기존과 동일하게 빈 바디 전송.
export const toggleWishlist = (itemId, trackId) =>
  API.post(`/wishlist/${itemId}/toggle`, trackId ? { track_id: trackId } : undefined);
export const checkWishlist = (itemIds) =>
  API.get('/wishlist/check', { params: { item_ids: (itemIds || []).join(',') } });
export const getWishlist = (category) =>
  API.get('/wishlist/', { params: category ? { category } : {} });

// Follows (스타 팔로우)
export const followUser = (userId) => API.post(`/follows/${userId}`);
export const unfollowUser = (userId) => API.delete(`/follows/${userId}`);
// 무인증 가능 — 비로그인 시 is_following 은 false
export const getFollowSummary = (userId) => API.get(`/follows/summary/${userId}`);
// 나를 팔로우하는 목록 → { followers: [{id, nickname, profile_image, followed_at}], total }
// DM 새 대화 상대 피커에 사용 (게이트 정책: 상대가 나를 팔로우해야 대화 시작 가능)
export const getMyFollowers = (params) => API.get('/follows/followers', { params });

// Feeds (v131 — 스타 채널 음악 피드)
// blocks: [{type:'text',text}|{type:'track',track_id}], bgm_track_id 선택.
// 응답 피드는 트랙 블록/bgm 이 하이드레이션된 형태({type:'track',track:{...}}).
export const createFeed = (payload) => API.post('/feeds/', payload);
export const updateFeed = (feedId, payload) => API.put(`/feeds/${feedId}`, payload);
export const deleteFeed = (feedId) => API.delete(`/feeds/${feedId}`);
// 작성자별 최신순 목록 → { feeds: [...], total }
// v133 — kind: 'feed'(기본, 음악 피드) | 'community'(공지)
export const getUserFeeds = (userId, page = 1, limit = 10, kind = 'feed') =>
  API.get(`/feeds/user/${userId}`, { params: { page, limit, kind } });
// v134 — 타임라인 (혼합 랭킹 노출, 비로그인 가능) → { feeds: [...], pagination: {page, limit, total} }
// 랭킹은 서버 몫 — FE 는 받은 순서 그대로 렌더.
export const getTimeline = (page = 1, limit = 10) =>
  API.get('/feeds/timeline', { params: { page, limit } });
// 단건 조회 (공유 링크 착지 — 비로그인 허용)
export const getFeed = (feedId) => API.get(`/feeds/${feedId}`);
// 좋아요 — 멱등, 응답 { like_count, is_liked }
export const likeFeed = (feedId) => API.post(`/feeds/${feedId}/like`);
export const unlikeFeed = (feedId) => API.delete(`/feeds/${feedId}/like`);
// 댓글 → { comments: [...], total } (오름차순 페이징)
export const getFeedComments = (feedId, page = 1, limit = 20) =>
  API.get(`/feeds/${feedId}/comments`, { params: { page, limit } });
export const addFeedComment = (feedId, text) =>
  API.post(`/feeds/${feedId}/comments`, { text });
export const deleteFeedComment = (commentId) =>
  API.delete(`/feeds/comments/${commentId}`);

// 공개 트랙 목록 (v131 — TrackPickerModal 인기순 기본, sort=play_count|like_count|created_at)
export const getTracks = (params) => API.get('/tracks/', { params });

// Reports (v137 — 콘텐츠 신뢰 세트: 신고)
// targetType: 'track'|'feed'|'comment', reasonCode: 'portrait'|'copyright'|'sexual'|'abuse'|'other'
// reasonText(≤500) 선택 — 값은 절대 콘솔에 출력하지 않는다.
// 성공 201 {report_id} / 중복 409 / 본인 콘텐츠 400.
export const reportContent = (targetType, targetId, reasonCode, reasonText) =>
  API.post('/reports/', {
    target_type: targetType,
    target_id: targetId,
    reason_code: reasonCode,
    ...(reasonText ? { reason_text: reasonText } : {}),
  });
// v162 — 신고 관리자측 API 는 독립 앱(frontend_admin/src/api.js)으로 완전 이사.

// v139 — 신고 후속: 소명 제출·내 신고 내역·스트라이크 생성 제한
// 내 콘텐츠가 신고 처리된 목록(소명 대상) → { reports: [{report_id, target_type, target_id,
//   target_summary:{title?/text?/cover_image_url?}, action, resolution, status, handled_at, has_appeal}] }
export const getMyAffectedReports = () => API.get('/reports/my-affected');
// 소명 제출 — text 1~2000자. 성공 201 {appeal_id} / 비소유 403 / blind 아님 400 / 중복 409.
// 주의: 소명 text 원문은 절대 콘솔에 출력하지 않는다(길이만 로깅).
export const submitAppeal = (reportId, text) =>
  API.post(`/reports/${reportId}/appeal`, { text });
// 내가 접수한 신고 목록 → { reports: [{report_id, target_type, target_summary, reason_code,
//   reason_text, status, action, resolution, handled_at, created_at}] }
// 주의: reason_text 원문은 절대 콘솔에 출력하지 않는다.
export const getMyReports = () => API.get('/reports/my');

// v139 — 생성 계열(곡·캐릭터·커버·MV) 위반 제한 403 공통 판별·알럿
// BE: 403 {"error":"generation_restricted","until":iso,"message":...}
export const isGenerationRestricted = (err) =>
  err?.response?.status === 403 &&
  err?.response?.data?.error === 'generation_restricted';
export const alertGenerationRestricted = (err) => {
  const until = err?.response?.data?.until;
  const d = until ? new Date(until) : null;
  const untilText = d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('ko-KR')
    : '관리자 확인 후';
  alert(`생성 기능이 제한되었습니다. 해제: ${untilText}`);
};

// AdMob Rewards
export const getRewardHistory = () => API.get('/rewards/history');
export const getRewardBalance = () => API.get('/rewards/balance');

// Points
export const getPointsBalance = () => API.get('/points/balance');
export const getPointsHistory = (limit = 50) => API.get('/points/history', { params: { limit } });

// v158 — 별(⭐) 경제 v1.2: 소비 가격 단일 소스 (FE 하드코딩 드리프트 방지)
// → { costs: { lyrics:5, compose:15, cover:5, character:10, fatigue_skip:5 } } — "costs" 래핑 주의
export const getPointCosts = () => API.get('/points/costs');

// v158 — 디렉터 피로 시스템
// → { today_completed, cooldown_active, cooldown_until(iso|null — 쿨다운 없으면 null),
//     cooldown_remaining_sec, skip_point_cost:5, skip_minutes:30,
//     ladder: {"1":2,"2":4,"3":8,"4+":12}(시간), skip_wait_count(보유 광고권) }
export const getFatigueStatus = () => API.get('/fatigue/status');
// method: 'points'(⭐ 차감) | 'ad'(보유 광고권 skip_wait_count 1장 소비) → 쿨다운 30분 단축(반복 가능).
// 성공 200 = status 동일 payload + skipped_minutes:30 (레이스로 0 가능 = 이미 해제).
// 402(points: 별 부족 / ad: {"error":"no_skip_tickets"}) · 409(활성 쿨다운 없음 — 무과금)
export const skipFatigue = (method) => API.post('/fatigue/skip', { method });

// v158 — 402/429 공통 판별 헬퍼 (:isGenerationRestricted 403 선례와 동일 패턴)
// BE 순서: 403(스트라이크) → 429(피로, Retry-After) → 402(별 부족)
export const isInsufficientPoints = (err) => err?.response?.status === 402;
export const isDirectorFatigued = (err) => err?.response?.status === 429;

// v158 — 포인트 변동(과금/환불/스킵/적립) 직후 헤더 ⭐배지 실시간 갱신 통지.
// Header.jsx 가 이 이벤트를 구독해 잔액을 재조회한다.
export const notifyPointsRefresh = () => {
  try {
    window.dispatchEvent(new Event('aimu:points-refresh'));
  } catch { /* SSR/테스트 등 window 부재 환경 무시 */ }
};

// Attendance (출석체크 / 데일리 체크인) — 보상은 별(⭐) 포인트
export const getAttendanceStatus = () => API.get('/attendance/status');
export const postAttendanceCheckIn = () => API.post('/attendance/check-in');

// ─────────────────────────────────────────────────────────────
// v69-restore: 유저 미커밋 변경에서 손실된 21개 함수 재구현
// (호출처 시그니처 + 백엔드 라우트 path/method 역추출 기반)
// ─────────────────────────────────────────────────────────────

// Beats (generations/tracks)
export const getGenerationBeats = (genId) =>
  API.get(`/generate/${genId}/beats`);
export const getTrackBeats = (trackId) =>
  API.get(`/tracks/${trackId}/beats`);
export const retryGenerationBeats = (genId) =>
  API.post(`/generate/${genId}/beats/retry`);
export const retryTrackBeats = (trackId) =>
  API.post(`/tracks/${trackId}/beats/retry`);

// Cover refine/revert (upload session)
export const refineCover = (coverSessionId, payload) =>
  API.post('/upload/refine-cover', { cover_session_id: coverSessionId, ...payload });
export const revertCover = (coverSessionId, targetVersion) =>
  API.post('/upload/revert-cover', { cover_session_id: coverSessionId, target_version: targetVersion });
// v215 — 커버 보관함 함수는 generateCover 옆(:351 부근) 단일 선언 — 중복 금지.

// My locations (character locations)
export const listMyLocations = () =>
  API.get('/character/locations');
export const locationPreviewUrl = (objectName) => {
  if (!objectName) return '';
  if (objectName.startsWith('http') || objectName.startsWith('/api/')) return objectName;
  return `/api/character/preview/${encodeURIComponent(objectName)}`;
};

// MV scene patch / cascade
export const patchMVScene = (jobId, sceneNumber, payload) =>
  API.patch(`/mv/jobs/${jobId}/scenes/${sceneNumber}`, payload);
export const cascadeRegenerateMVScene = (jobId, sceneNumber, field) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/cascade-regenerate`, { field });
export const cancelCascadeMVScene = (jobId, sceneNumber) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/cancel-cascade`);

// MV scenario event patch / cascade
export const patchMVScenarioEvent = (jobId, order, payload) =>
  API.patch(`/mv/jobs/${jobId}/scenario/events/${order}`, payload);
export const cascadeRegenerateMVEvent = (jobId, order) =>
  API.post(`/mv/jobs/${jobId}/scenario/events/${order}/cascade-regenerate`);
export const cancelCascadeMVEvent = (jobId, order) =>
  API.post(`/mv/jobs/${jobId}/scenario/events/${order}/cancel-cascade`);

// MV scenario patch / events / cascade
export const patchMVScenario = (jobId, payload) =>
  API.patch(`/mv/jobs/${jobId}/scenario`, payload);
export const patchMVScenarioEvents = (jobId, events) =>
  API.patch(`/mv/jobs/${jobId}/scenario/events`, { events });
export const cascadeRegenerateMVScenario = (jobId) =>
  API.post(`/mv/jobs/${jobId}/scenario/cascade-regenerate`);
export const cancelCascadeMVScenario = (jobId) =>
  API.post(`/mv/jobs/${jobId}/scenario/cancel-cascade`);

// MV user-edited
export const resetUserEdits = (jobId, payload) =>
  API.post(`/mv/jobs/${jobId}/user-edited/reset`, payload || {});
export const getUserEditedSummary = (jobId) =>
  API.get(`/mv/jobs/${jobId}/user-edited/summary`);

// DM (v152 — 실시간 1:1 다이렉트 메시지, prefix /api/dm)
// 게이트/스키마는 PLAN v152 기준. 메시지 text 원문은 절대 콘솔에 출력하지 않는다(길이만).
// 봉투 아이콘/전송 버튼 활성 판단용 — { is_verified: bool, ... }
export const getDmEligibility = () => API.get('/dm/eligibility');
// 대화 시작/기존 반환 — 안전게이트 전체 통과 시. 실패 시 4xx { error }.
export const createDmConversation = (peerId) =>
  API.post('/dm/conversations', { peer_id: peerId });
// 내 대화 목록 (last_at desc) → { conversations: [{conversation_id, peer, last_message_text, last_at, unread}] }
export const getDmConversations = () => API.get('/dm/conversations');
// 대화 메시지 페이지네이션 → { messages: [{id, sender_id, text, created_at, read}], has_more }
// params: { before?(msg_id|iso 커서), limit?(기본 30) }
export const getDmMessages = (cid, params) =>
  API.get(`/dm/conversations/${cid}/messages`, { params });
// 메시지 전송 → { message: {id, sender_id, text, created_at} }
export const sendDmMessage = (cid, text) =>
  API.post(`/dm/conversations/${cid}/messages`, { text });
// 읽음 처리 (내 unread=0 + 상대발신 미읽음 read=true) → { ok: true }
export const markDmRead = (cid) =>
  API.post(`/dm/conversations/${cid}/read`);
// 헤더 배지용 총 미읽음 합계 → { count: int }
export const getDmUnreadCount = () => API.get('/dm/unread-count');
// 사용자 차단/해제 (차단 사실은 UI 에 상대에게 노출 안 함) → { ok: true }
export const blockDmUser = (uid) => API.post(`/dm/blocks/${uid}`);
export const unblockDmUser = (uid) => API.delete(`/dm/blocks/${uid}`);

// CS 오류신고 — 공식 계정(maidol_official) 연락처 조회 → { official_id, nickname }.
// 본인인증 여부와 무관하게 공식 대화는 시작 가능(게이트 면제는 백엔드가 처리).
// 대화 생성/메시지 전송은 기존 createDmConversation / sendDmMessage 재사용.
export const getOfficialContact = () => API.get('/dm/official');

// DM (v155 — 인스타 완전체 C안: 전체 사용자 검색 + 메시지 요청함)
// 닉네임 부분일치 전체 사용자 검색(자기 자신/차단/탈퇴 제외, limit 20) → { users: [{id, nickname, profile_image}] }
export const searchDmUsers = (q) => API.get('/dm/users/search', { params: { q } });
// 내가 받은 메시지 요청(pending) 목록 → { requests: [대화 serialize 동일 형태 — status, requester_id 포함] }
export const getDmRequests = () => API.get('/dm/requests');
// 요청 수락 (수신자만 — 요청자 호출 403, 이미 accepted 400) → { ok, conversation }
export const acceptDmRequest = (cid) => API.post(`/dm/conversations/${cid}/accept`);
// 요청 거절 (수신자만 — 대화+메시지 삭제, 상대 무통지) → { ok }
export const declineDmRequest = (cid) => API.delete(`/dm/conversations/${cid}`);

// Referral (v154 — 앱 추천/추천코드)
// 내 추천코드 조회(인증, 코드 없으면 서버가 lazy 생성)
// → { referral_code, invite_url, play_store_url }
export const getMyReferralCode = () => API.get('/referral/my-code');
// 초대 착지 정보 조회(무인증) → { referral_code, inviter_nickname, play_store_url }
// 무효/탈퇴 유저 코드는 404 { error }.
export const getInviteInfo = (code) =>
  API.get(`/referral/invite/${encodeURIComponent(code)}`);

// v185 — 기능오류 신고 접수. payload = { reason(코드 5종), text(1~2000),
// page_url?, app_version?, dm_conversation_id? } → 201 { id }. user_agent 는 서버 캡처.
// 신고 본문 원문은 콘솔에 출력하지 않는다.
export const reportIssue = (payload) => API.post('/issues', payload);

// Frontend remote logging
export const sendFrontendLogs = (batch) =>
  // 백엔드 FrontendLogBatch 스키마는 { events: [...] } 객체를 기대한다.
  // (sendBeacon 경로와 동일 형태로 래핑 — 배열을 그대로 보내면 422 거부됨)
  API.post('/_logs/frontend', { events: batch });
// sendBeacon 은 절대 URL 필수. same-origin (포트 포함) 으로 vite proxy 경유.
export const frontendLogsBeaconUrl = `${window.location.protocol}//${window.location.host}/api/_logs/frontend`;

export default API;
