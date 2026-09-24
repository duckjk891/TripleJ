import axios from 'axios';

const TOKEN_KEY = 'maidol_admin_token';
const USER_KEY = 'maidol_admin_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
};
export const saveAuth = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearAuth = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

const API = axios.create({ baseURL: '/api' });

API.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearAuth();
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login';
      }
    }
    return Promise.reject(err);
  }
);

export default API;

// ---- auth ----
export const login = (email, password) => API.post('/auth/login', { email, password });

// ---- dashboard ----
export const getDashboard = () => API.get('/admin/dashboard');
export const getActiveUsers = (days = 14) => API.get('/admin/stats/active-users', { params: { days } });
export const getFeatureUsage = (days = 7) => API.get('/admin/stats/features', { params: { days } });
export const getRetention = (days = 30) => API.get('/admin/stats/retention', { params: { days } });
export const getScreenAnalytics = (days = 7) => API.get('/admin/stats/screens', { params: { days } });

// ---- users ----
export const getUsers = (params) => API.get('/admin/users', { params });
export const getUserDetail = (id) => API.get(`/admin/users/${id}`);
export const updateUserRole = (id, role) => API.put(`/admin/users/${id}/role`, { role });
export const banUser = (id, is_banned, reason) => API.put(`/admin/users/${id}/ban`, { is_banned, reason });
export const liftRestriction = (id) => API.post(`/admin/users/${id}/restriction/lift`);
export const resetStrikes = (id) => API.post(`/admin/users/${id}/strikes/reset`);

// ---- tracks ----
export const getTracks = (params) => API.get('/admin/tracks', { params });
export const deleteTrack = (id) => API.delete(`/admin/tracks/${id}`);
export const updateTrackVisibility = (id, is_public) => API.put(`/admin/tracks/${id}/visibility`, { is_public });

// ---- reports ----
export const getReports = (params) => API.get('/admin/reports', { params });
export const actOnReport = (id, action) => API.post(`/admin/reports/${id}/action`, { action });
export const fetchEvidenceBlob = (reportId, idx) =>
  API.get(`/admin/reports/${reportId}/evidence/${idx}`, { responseType: 'blob' });

// ---- media (auth 프록시 — <img> 에 직접 못 쓰므로 blob fetch) ----
export const fetchMediaBlob = (objectName) =>
  API.get(`/admin/media/${objectName}`, { responseType: 'blob' });

// ---- advertisers (브랜드/광고주) ----
export const getAdvertisers = (params) => API.get('/admin/ads/advertisers', { params });
export const getAdvertiser = (userId, params) => API.get(`/admin/ads/advertisers/${userId}`, { params });

export const getBrands = (params) => API.get('/admin/items/brands', { params });
export const setBrandHidden = (brand, hidden, reason) =>
  API.patch('/admin/items/brands/hidden', { brand, hidden, reason });
export const renameBrand = (brand, new_brand) =>
  API.put('/admin/items/brands/rename', { brand, new_brand });

// ---- items (착장) ----
export const getItems = (params) => API.get('/admin/items', { params });
export const getItemOwners = () => API.get('/admin/items/owners');
export const updateItem = (id, body) => API.put(`/admin/items/${id}`, body);
export const deleteItem = (id) => API.delete(`/admin/items/${id}`);
export const setItemHidden = (id, hidden, reason) =>
  API.patch(`/admin/ads/items/${id}/hidden`, { hidden, reason });
export const importItems = (file, mode, dryRun) => {
  const form = new FormData();
  form.append('file', file);
  form.append('mode', mode);
  form.append('dry_run', dryRun ? 'true' : 'false');
  return API.post('/admin/items/import', form);
};
export const getImportJobs = () => API.get('/admin/items/import-jobs');
export const getImportJob = (id) => API.get(`/admin/items/import-jobs/${id}`);

// ---- logs ----
export const getAdminLogs = (params) => API.get('/admin/logs', { params });

// ---- health (v3.217 [HealthCheck] 시스템 탭) ----
export const getExternalHealth = (force = false) =>
  API.get('/admin/health/external', { params: force ? { force: true } : {} });
