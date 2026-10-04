import axios from 'axios';

const TOKEN_KEY = 'maidol_admin_token';
const USER_KEY = 'maidol_admin_user';

const REMEMBER_KEY = 'maidol_admin_remember';
const ISSUED_KEY = 'maidol_admin_token_at';

// 자동 로그인: 켜면 localStorage(브라우저를 닫아도 유지 + 접속할 때마다 7일 토큰 자동 연장),
// 끄면 sessionStorage(탭/브라우저를 닫으면 로그아웃). 저장소 접근 실패(사파리 비공개 등)는 무시.
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const stores = () => [safe(() => window.localStorage), safe(() => window.sessionStorage)].filter(Boolean);
const readKey = (key) => {
  for (const st of stores()) {
    const v = safe(() => st.getItem(key));
    if (v) return v;
  }
  return null;
};

export const getRemember = () => safe(() => window.localStorage.getItem(REMEMBER_KEY)) !== '0';
export const getToken = () => readKey(TOKEN_KEY);
export const getTokenIssuedAt = () => Number(readKey(ISSUED_KEY)) || 0;
export const getStoredUser = () => {
  try {
    return JSON.parse(readKey(USER_KEY) || 'null');
  } catch {
    return null;
  }
};
export const clearAuth = () => {
  stores().forEach((st) => [TOKEN_KEY, USER_KEY, ISSUED_KEY].forEach((k) => safe(() => st.removeItem(k))));
};
export const saveAuth = (token, user, remember = getRemember()) => {
  clearAuth();
  safe(() => window.localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'));
  const st = safe(() => (remember ? window.localStorage : window.sessionStorage));
  if (!st) return;
  safe(() => {
    st.setItem(TOKEN_KEY, token);
    st.setItem(USER_KEY, JSON.stringify(user));
    st.setItem(ISSUED_KEY, String(Date.now()));
  });
};

const API = axios.create({ baseURL: '/api' });

API.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 서버는 세션 만료를 401, 토큰 만료·위조를 403("토큰이 만료…"/"유효하지 않은 토큰…")으로 준다.
const isAuthFailure = (err) => {
  const st = err.response?.status;
  if (st === 401) return true;
  const detail = String(err.response?.data?.detail || '');
  return st === 403 && detail.includes('토큰');
};

API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (isAuthFailure(err) && !String(err.config?.url || '').includes('/auth/login')) {
      clearAuth();
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login';
      }
    }
    return Promise.reject(err);
  }
);

// 서버 오류 메시지 추출 — 라우트마다 {error} 또는 {detail} 을 쓴다.
export const errMsg = (err, fallback = '요청에 실패했습니다.') => {
  const d = err?.response?.data;
  if (d && typeof d.error === 'string') return d.error;
  if (d && typeof d.detail === 'string') return d.detail;
  return fallback;
};

export default API;

// ---- auth ----
export const login = (email, password) => API.post('/auth/login', { email, password });
// 자동 로그인 — 유효한 토큰으로 새 7일 토큰 재발급(슬라이딩)
export const refreshSession = () => API.post('/admin/session/refresh');

// ---- dashboard ----
export const getDashboard = () => API.get('/admin/dashboard');
export const getActiveUsers = (days = 14) => API.get('/admin/stats/active-users', { params: { days } });
export const getFeatureUsage = (days = 7) => API.get('/admin/stats/features', { params: { days } });
export const getRetention = (days = 30) => API.get('/admin/stats/retention', { params: { days } });
export const getScreenAnalytics = (days = 7) => API.get('/admin/stats/screens', { params: { days } });
export const getAcquisition = (days = 30) => API.get('/admin/stats/acquisition', { params: { days } });
export const getFunnels = (days = 7) => API.get('/admin/stats/funnels', { params: { days } });
export const getPaths = (days = 7, limit = 30) => API.get('/admin/stats/paths', { params: { days, limit } });

// ---- users ----
export const getUsers = (params) => API.get('/admin/users', { params });
export const getUserDetail = (id) => API.get(`/admin/users/${id}`);
export const updateUserRole = (id, role) => API.put(`/admin/users/${id}/role`, { role });
export const banUser = (id, is_banned, reason) => API.put(`/admin/users/${id}/ban`, { is_banned, reason });
export const liftRestriction = (id) => API.post(`/admin/users/${id}/restriction/lift`);
export const resetStrikes = (id) => API.post(`/admin/users/${id}/strikes/reset`);

// ---- DM · 공지 (MAIDOL 공식 계정) ----
export const getCsConversations = (params) => API.get('/admin/cs/conversations', { params });
export const getCsMessages = (cid, params) => API.get(`/admin/cs/conversations/${cid}/messages`, { params });
export const replyCs = (cid, text) => API.post(`/admin/cs/conversations/${cid}/reply`, { text });
export const markCsRead = (cid) => API.post(`/admin/cs/conversations/${cid}/read`);
export const getCsUnreadCount = () => API.get('/admin/cs/unread-count');
export const sendCs = (user_ids, text) => API.post('/admin/cs/send', { user_ids, text });
export const broadcastCs = (audience, text) => API.post('/admin/cs/broadcast', { audience, text });
export const getNotices = (params) => API.get('/admin/notices', { params });
export const getNotice = (id) => API.get(`/admin/notices/${id}`);

// ---- 피드 (MAIDOL 공식 계정 명의) ----
export const getAdminFeeds = (params) => API.get('/admin/feeds', { params });
export const getPendingComments = () => API.get('/admin/feeds/pending-comments');
export const createOfficialFeed = ({ title, text, images }) => {
  const form = new FormData();
  form.append('title', title || '');
  form.append('text', text || '');
  (images || []).forEach((f) => form.append('images', f));
  return API.post('/admin/feeds', form);
};
export const deleteOfficialFeed = (id) => API.delete(`/admin/feeds/${id}`);
export const getFeedComments = (id) => API.get(`/admin/feeds/${id}/comments`);
export const addOfficialComment = (id, text, parent_id = null) => API.post(`/admin/feeds/${id}/comments`, { text, parent_id });
export const deleteOfficialComment = (commentId) => API.delete(`/admin/feeds/comments/${commentId}`);

// ---- stars (별 = points) ----
export const getPointSummary = () => API.get('/admin/points/summary');
export const getPointBalance = (userId) => API.get(`/admin/points/users/${userId}/balance`);
export const getPointEvents = (userId, params) => API.get(`/admin/points/users/${userId}/events`, { params });
export const adjustPoints = (user_id, direction, amount, reason, notify = true, message = '') =>
  API.post('/admin/points/adjust', { user_id, direction, amount, reason, notify, message });
export const getPointBreakdown = (days = 30) => API.get('/admin/points/analytics/breakdown', { params: { days } });
export const getPointDaily = (days = 30) => API.get('/admin/points/analytics/daily', { params: { days } });
export const getPointDemographics = (days = 30, mode = 'earn') => API.get('/admin/points/analytics/demographics', { params: { days, mode } });
export const getPointTopSpenders = (days = 30) => API.get('/admin/points/analytics/top-spenders', { params: { days } });
export const getPointBalanceDistribution = () => API.get('/admin/points/analytics/balance-distribution');
export const getPointSegments = (days = 30, mode = 'earn') => API.get('/admin/points/analytics/segments', { params: { days, mode } });
export const getPointCohorts = (days = 30) => API.get('/admin/points/analytics/cohorts', { params: { days } });

// ---- tracks ----
export const getTracks = (params) => API.get('/admin/tracks', { params });
export const deleteTrack = (id) => API.delete(`/admin/tracks/${id}`);
export const updateTrackVisibility = (id, is_public) => API.put(`/admin/tracks/${id}/visibility`, { is_public });

// ---- reports ----
export const getReports = (params) => API.get('/admin/reports', { params });
export const actOnReport = (id, action) => API.post(`/admin/reports/${id}/action`, { action });
export const getUserRecentContent = (userId) => API.get(`/admin/users/${userId}/recent-content`);
export const faceSearch = (report_id) => API.post('/admin/moderation/face-search', { report_id });
export const purgeTargets = (report_id, targets) => API.post('/admin/moderation/purge', { report_id, targets });
export const blindClub = (clubId) => API.delete(`/admin/clubs/${clubId}`);
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

// ---- issues (오류 신고 · 자동 수집 에러) ----
export const getIssues = (params) => API.get('/admin/issues', { params });
export const getIssueSummary = () => API.get('/admin/issues/summary');
export const getIssue = (id) => API.get(`/admin/issues/${id}`);
export const getIssueRelatedErrors = (id) => API.get(`/admin/issues/${id}/related-errors`);
export const updateIssueStatus = (id, status, note) => API.patch(`/admin/issues/${id}/status`, { status, note });
export const getErrorGroups = (days = 7) => API.get('/admin/issues/errors', { params: { days } });
export const getErrorHistory = (fingerprint, params) =>
  API.get(`/admin/issues/errors/${encodeURIComponent(fingerprint)}`, { params });
export const probeError = (body) => API.post('/admin/issues/probe', body);
