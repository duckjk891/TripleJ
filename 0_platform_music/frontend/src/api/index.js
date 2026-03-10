import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:8001/api',
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

export const likeSong = (songId) =>
  API.post(`/likes/${songId}`);

export const unlikeSong = (songId) =>
  API.delete(`/likes/${songId}`);

export default API;
