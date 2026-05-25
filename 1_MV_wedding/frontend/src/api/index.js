import axios from 'axios';

const API = axios.create({
  baseURL: `${window.location.protocol}//${window.location.hostname}:8000/api`,
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

// MV jobs
export const createMVJob = (data) => API.post('/mv/jobs', data);
export const getMVJobs = () => API.get('/mv/jobs');
export const getMVJob = (id) => API.get(`/mv/jobs/${id}`);

// MV music gen (v3)
export const startMusicGen = (jobId) => API.post(`/mv/jobs/${jobId}/music`);

export const audioStreamUrl = (jobId, variant = 1) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/mv/jobs/${jobId}/audio?token=${encodeURIComponent(token)}&variant=${variant}`;
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

// Preview URL for character sheets and outfit images (both under mv-wedding-photos).
// Mirrors audioStreamUrl pattern — appends token query so preview route can
// fall back to ?token=... when Authorization header is absent (e.g. <img src>).
export const sheetPreviewUrl = (objectName) => {
  const token = localStorage.getItem('token') || '';
  return `${API.defaults.baseURL}/character/preview/${objectName}?token=${encodeURIComponent(token)}`;
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

// Share (public)
export const getSharedMV = (token) => API.get(`/share/${token}`);

export default API;
