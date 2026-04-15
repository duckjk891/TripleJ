import axios from 'axios';

const API = axios.create({
  baseURL: `${window.location.protocol}//${window.location.hostname}:9003/api`,
});

// JWT 토큰 자동 첨부
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 응답 인터셉터 - 401 시 토큰 제거
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (email, password) =>
  API.post('/auth/login', { email, password });

export const register = (email, password, nickname) =>
  API.post('/auth/register', { email, password, nickname });

export const getMe = () =>
  API.get('/auth/me');

// Songs
export const getSongs = (params) =>
  API.get('/songs', { params });

export const searchSongs = (q, params) =>
  API.get('/songs/search', { params: { q, ...params } });

export const getSong = (id) =>
  API.get(`/songs/${id}`);

// Albums
export const getAlbums = (params) =>
  API.get('/albums', { params });

export const getLatestAlbums = (limit = 10) =>
  API.get('/albums/latest', { params: { limit } });

export const getAlbum = (id) =>
  API.get(`/albums/${id}`);

// Artists
export const getArtists = (params) =>
  API.get('/artists', { params });

export const getArtist = (id) =>
  API.get(`/artists/${id}`);

export const getArtistAlbums = (id) =>
  API.get(`/artists/${id}/albums`);

export const getArtistSongs = (id, limit = 10) =>
  API.get(`/artists/${id}/songs`, { params: { limit } });

// Charts
export const getTop100 = () =>
  API.get('/charts/top100');

export const getGenreChart = (genre, limit = 50) =>
  API.get(`/charts/genre/${genre}`, { params: { limit } });

// Charts (v2 - Melon-style)
export const getChart = (chartType) =>
  API.get(`/charts/${chartType}`);

export const recordPlay = (trackId) =>
  API.post('/charts/record-play', { track_id: trackId });

// Playlists
export const getPlaylists = () =>
  API.get('/playlists');

export const createPlaylist = (title, description, is_public = true) =>
  API.post('/playlists', { title, description, is_public });

export const getPlaylist = (id) =>
  API.get(`/playlists/${id}`);

export const updatePlaylist = (id, data) =>
  API.put(`/playlists/${id}`, data);

export const deletePlaylist = (id) =>
  API.delete(`/playlists/${id}`);

export const addSongToPlaylist = (playlistId, songId) =>
  API.post(`/playlists/${playlistId}/songs`, { song_id: songId });

export const removeSongFromPlaylist = (playlistId, songId) =>
  API.delete(`/playlists/${playlistId}/songs/${songId}`);

// Likes
export const getLikes = (params) =>
  API.get('/likes', { params });

export const checkLikes = (songIds) =>
  API.get('/likes/check', { params: { song_ids: songIds } });

export const likeSong = (songId) =>
  API.post(`/likes/${songId}`);

export const unlikeSong = (songId) =>
  API.delete(`/likes/${songId}`);

// Tracks (v2.0)
export const getLatestTracks = (limit = 10) =>
  API.get('/tracks', { params: { limit, sort: 'created_at' } });

export const searchTracks = (q, params) =>
  API.get('/tracks/search', { params: { q, ...params } });

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

// My tracks
export const getMyTracks = (params) => API.get('/tracks/my', { params });
export const deleteTrack = (id) => API.delete(`/tracks/${id}`);
export const updateTrack = (id, data) => API.put(`/tracks/${id}`, data);

// AI Cover
export const generateCover = (data) => API.post('/upload/generate-cover', data);

// AI Music Video
export const generateMV = (data) => API.post('/upload/generate-mv', data);
export const checkMVStatus = (jobId) => API.get(`/upload/mv-status/${jobId}`);

// MV Draft System
export const createMVJob = (data) => API.post('/mv/create', data);
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
export const retrySyncLabs = (jobId, sceneNumber) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/retry-sync`);
export const separateVocal = (jobId, sceneNumber) =>
  API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/separate-vocal`, {}, { timeout: 300000 });

// Character
export const generateCharacterSheet = (formData) =>
  API.post('/character/generate-sheet', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
export const saveCharacter = (data) => API.post('/character/save', data);
export const getMyCharacter = () => API.get('/character/me');
export const deleteMyCharacter = () => API.delete('/character/me');
export const refineCharacterSheet = (formData) =>
  API.post('/character/refine', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180000,
  });

// Voice Persona
export const createVoicePersona = (formData) =>
  API.post('/voice-persona/create', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
export const getVoicePersonas = () => API.get('/voice-persona/list');
export const getVoicePersona = (id) => API.get(`/voice-persona/${id}`);
export const deleteVoicePersona = (id) => API.delete(`/voice-persona/${id}`);
export const streamVoicePersonaVocal = (id) => `${API.defaults.baseURL}/voice-persona/${id}/vocal/stream`;
export const streamVoicePersonaCover = (id) => `${API.defaults.baseURL}/voice-persona/${id}/cover/stream`;
export const downloadVoicePersonaVocal = (id) => `${API.defaults.baseURL}/voice-persona/${id}/vocal/download`;
export const downloadVoicePersonaCover = (id) => `${API.defaults.baseURL}/voice-persona/${id}/cover/download`;

// Vocal Repair (Dolby.io)
export const uploadVoiceForRepair = (formData) =>
  API.post('/vocal-repair/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
export const startVocalEnhance = (repairId, method = 'both') =>
  API.post(`/vocal-repair/${repairId}/enhance`, { method });
export const getVocalRepairStatus = (repairId) =>
  API.get(`/vocal-repair/${repairId}/status`);
export const vocalRepairOriginalStreamUrl = (repairId) =>
  `${API.defaults.baseURL}/vocal-repair/${repairId}/original/stream`;
export const vocalRepairEnhancedStreamUrl = (repairId, method) =>
  `${API.defaults.baseURL}/vocal-repair/${repairId}/enhanced/stream?method=${method}`;
export const vocalRepairOriginalDownloadUrl = (repairId) =>
  `${API.defaults.baseURL}/vocal-repair/${repairId}/original/download`;
export const vocalRepairEnhancedDownloadUrl = (repairId, method) =>
  `${API.defaults.baseURL}/vocal-repair/${repairId}/enhanced/download?method=${method}`;
export const getVocalRepairList = () => API.get('/vocal-repair/list');

// Voice Conversion (Kits.AI)
export const startVoiceConvert = (generationId, data) =>
  API.post(`/voice-convert/${generationId}`, data);
export const getVoiceConvertStatus = (generationId) =>
  API.get(`/voice-convert/${generationId}/status`);
export const getKitsVoiceModels = () => API.get('/kits/voice-models');
export const voiceConvertStreamUrl = (generationId) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/voice-convert/${generationId}/stream?token=${encodeURIComponent(token)}`;
};
export const voiceConvertDownloadUrl = (generationId) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/voice-convert/${generationId}/download?token=${encodeURIComponent(token)}`;
};

// Voice Conversion - MR Pitch Adjust & Merge
export const streamConvertedVocal = (generationId) =>
  `${API.defaults.baseURL}/voice-convert/${generationId}/converted-vocal/stream`;
export const streamBacking = (generationId) =>
  `${API.defaults.baseURL}/voice-convert/${generationId}/backing/stream`;
export const mergeVoiceConversion = (generationId, data) =>
  API.post(`/voice-convert/${generationId}/merge`, data);

// Voice Conversion - MR Pitch Preview (server-side rubberband)
export const previewMrPitched = (generationId, pitchShift) =>
  API.post(`/voice-convert/${generationId}/preview-mr`,
    { pitch_shift: pitchShift },
    { responseType: 'arraybuffer', timeout: 30000 }
  );

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
export const deleteGeneration = (id) => API.delete(`/generate/${id}`);
export const streamGeneration = (id) => API.get(`/generate/${id}/stream/`);
export const uploadFromGeneration = (data) => API.post('/tracks/upload-from-generation', data);
export const getGenerationModels = () => API.get('/generate/models/');

// Admin
export const getAdminDashboard = () => API.get('/admin/dashboard');
export const getAdminUsers = (params) => API.get('/admin/users', { params });
export const getAdminUser = (id) => API.get(`/admin/users/${id}`);
export const updateUserRole = (id, role) => API.put(`/admin/users/${id}/role`, { role });
export const banUser = (id, is_banned, reason) => API.put(`/admin/users/${id}/ban`, { is_banned, reason });
export const getAdminTracks = (params) => API.get('/admin/tracks', { params });
export const deleteAdminTrack = (id) => API.delete(`/admin/tracks/${id}`);
export const updateTrackVisibility = (id, is_public) => API.put(`/admin/tracks/${id}/visibility`, { is_public });
export const getAdminLogs = (params) => API.get('/admin/logs', { params });

// Cover preview URL helper
export const coverPreviewUrl = (objectName) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/upload/cover-preview/${encodeURIComponent(objectName)}?token=${encodeURIComponent(token || '')}`;
};

// Generation stream URL helper
export const generationStreamUrl = (genId) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/generate/${genId}/stream/?token=${encodeURIComponent(token || '')}`;
};

// Character sheet preview URL helper
export const characterPreviewUrl = (previewPath) =>
  `${API.defaults.baseURL.replace('/api', '')}${previewPath}`;

// Fetch audio as arraybuffer (for Web Audio API usage)
export const fetchAudioBuffer = (url) =>
  API.get(url, { responseType: 'arraybuffer' });

// Fetch a full URL as blob (for images/files already constructed via API helpers)
export const fetchAsBlob = (fullUrl) =>
  axios.get(fullUrl, { responseType: 'blob' });

// Fetch vocal repair streams
export const fetchVocalRepairOriginal = (repairId) =>
  API.get(`/vocal-repair/${repairId}/original/stream`, { responseType: 'arraybuffer' });

export const fetchVocalRepairEnhanced = (repairId, method) =>
  API.get(`/vocal-repair/${repairId}/enhanced/stream`, { params: { method }, responseType: 'arraybuffer' });

// Fetch voice convert streams
export const fetchConvertedVocal = (generationId) =>
  API.get(`/voice-convert/${generationId}/converted-vocal/stream`, { responseType: 'arraybuffer' });

export const fetchBacking = (generationId) =>
  API.get(`/voice-convert/${generationId}/backing/stream`, { responseType: 'arraybuffer' });

// Download vocal repair
export const downloadVocalRepair = (repairId, type, method) => {
  const endpoint = type === 'original'
    ? `/vocal-repair/${repairId}/original/download`
    : `/vocal-repair/${repairId}/enhanced/download`;
  return API.get(endpoint, { params: method ? { method } : {}, responseType: 'blob' });
};

// Download voice persona
export const downloadVoicePersona = (personaId, type) =>
  API.get(`/voice-persona/${personaId}/${type}/download`, { responseType: 'blob' });

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
export const getBusinessDashboard = (period = 'daily', category) => {
  const params = { period };
  if (category && category !== '전체') params.category = category;
  return API.get('/business/dashboard', { params });
};
export const recordAdImpression = (itemId) =>
  API.post(`/business/ads/${itemId}/impression`);
export const recordAdClick = (itemId) =>
  API.post(`/business/ads/${itemId}/click`);
export const getActiveAds = (category) =>
  API.get('/business/ads/active', { params: category ? { category } : {} });
export const adImageUrl = (objectName) =>
  `${window.location.protocol}//${window.location.hostname}:9003/api/business/items/image/${objectName}`;

// AdMob Rewards
export const getRewardHistory = () => API.get('/rewards/history');
export const getRewardBalance = () => API.get('/rewards/balance');

export default API;
