import axios from 'axios';

const API = axios.create({
  baseURL: `${window.location.protocol}//${window.location.hostname}:9000/api`,
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
export const concatenateMV = (jobId) => API.post(`/mv/jobs/${jobId}/concatenate`);
export const saveMVDraft = (jobId, data) => API.post(`/mv/jobs/${jobId}/save-draft`, data);
export const cancelMVJob = (jobId) => API.post(`/mv/jobs/${jobId}/cancel`);
export const mergeAudioMV = (jobId, audioObjectName) =>
    API.post(`/mv/jobs/${jobId}/merge-audio`, { audio_object_name: audioObjectName });
export const getMVModels = () => API.get('/mv/models');

// Character
export const generateCharacterSheet = (formData) =>
  API.post('/character/generate-sheet', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
export const saveCharacter = (data) => API.post('/character/save', data);
export const getMyCharacter = () => API.get('/character/me');
export const deleteMyCharacter = () => API.delete('/character/me');

// Legacy aliases
export const uploadSong = uploadTrack;

// AI Generation (작업실)
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

export default API;
