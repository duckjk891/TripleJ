import axios from 'axios';

// MAIDOL 광고주 사이트 API — 같은 주소(business.maidol.ai.kr)의 /api 를 nginx 가 서버로 넘긴다.
// 이 주소에서는 /api/business/*, /api/auth/login, /api/auth/password-reset/* 만 열려 있다.

const TOKEN_KEY = 'maidol_biz_token';
const USER_KEY = 'maidol_biz_user';
const REMEMBER_KEY = 'maidol_biz_remember';
const ISSUED_KEY = 'maidol_biz_token_at';

// 로그인 상태 유지: 켜면 localStorage(브라우저를 닫아도 유지 + 접속 때 7일 토큰 자동 연장),
// 끄면 sessionStorage(탭을 닫으면 로그아웃). 저장소 접근 실패(사파리 비공개 등)는 무시.
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
  try { return JSON.parse(readKey(USER_KEY) || 'null'); } catch { return null; }
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

const API = axios.create({ baseURL: '/api', timeout: 60000 });

API.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 서버는 세션 만료를 401, 토큰 만료·위조를 403("토큰…")으로 준다 → 로그인 화면으로.
const isAuthFailure = (err) => {
  const st = err.response?.status;
  if (st === 401) return true;
  const detail = String(err.response?.data?.detail || '');
  return st === 403 && detail.includes('토큰');
};

API.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = String(err.config?.url || '');
    if (isAuthFailure(err) && !url.includes('/auth/') && !url.includes('/business/password')) {
      clearAuth();
      if (!window.location.hash.startsWith('#/login')) window.location.hash = '#/login?expired=1';
    }
    return Promise.reject(err);
  }
);

// 사용자에게 보여 줄 쉬운 안내 — 서버의 한국어 안내(4xx)만 그대로 쓰고,
// 네트워크 오류·서버 오류(5xx)·영문/기술 문구는 fallback 으로 바꾼다.
const TECH = /error|exception|traceback|http|null|undefined|500|internal|허용값|ObjectId|\bID\b/i;
export const friendlyError = (err, fallback = '잠시 후 다시 시도해 주세요.') => {
  const st = err?.response?.status;
  if (!err?.response) return '인터넷 연결을 확인하고 다시 시도해 주세요.';
  if (st >= 500) return '일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  if (st === 413) return '사진 용량이 너무 커요. 10MB 이하 사진으로 다시 시도해 주세요.';
  const d = err.response.data;
  const msg = (d && typeof d.error === 'string' && d.error) || (d && typeof d.detail === 'string' && d.detail) || '';
  if (msg && /[가-힣]/.test(msg) && !TECH.test(msg)) return msg;
  return fallback;
};

export default API;

// ---- auth ----
export const login = (email, password) => API.post('/auth/login', { email, password });
export const refreshSession = () => API.post('/business/session/refresh');
export const requestReset = (email) => API.post('/auth/password-reset/request', { email });
export const confirmReset = (email, code, new_password) =>
  API.post('/auth/password-reset/confirm', { email, code, new_password });
export const changePassword = (current_password, new_password) =>
  API.post('/business/password', { current_password, new_password });

// ---- profile ----
export const getProfile = () => API.get('/business/profile');
export const updateProfile = (body) => API.put('/business/profile', body);

// ---- items ----
export const listItems = (params) => API.get('/business/ads', { params });
export const getItem = (id) => API.get(`/business/ads/item/${id}`);
export const createItem = (formData) => API.post('/business/ads', formData);
export const updateItem = (id, formData) => API.put(`/business/ads/${id}`, formData);
export const deleteItem = (id) => API.delete(`/business/ads/${id}`);
export const toggleItem = (id) => API.patch(`/business/ads/${id}/toggle`);

// ---- performance ----
export const getDashboard = (period) => API.get('/business/dashboard', { params: { period } });
export const getInsights = (id, period) => API.get(`/business/ads/${id}/insights`, { params: { period } });
export const getStars = (id, period) => API.get(`/business/ads/${id}/stars`, { params: { period } });

// ---- public ----
export const sendInquiry = (body) => API.post('/business/inquiries', body);

// 상품 이미지 — 공개 이미지 프록시(ads/ 아래만). 목록에는 320px 썸네일을 먼저 쓴다(v3.375).
export const imageUrl = (obj) => (obj && obj.startsWith('ads/') ? `/api/business/items/image/${obj}` : null);
export const thumbUrl = (obj) => {
  if (!obj || !obj.startsWith('ads/') || obj.startsWith('ads/thumb320/')) return imageUrl(obj);
  const rest = obj.slice(4);
  const dot = rest.lastIndexOf('.');
  return `/api/business/items/image/ads/thumb320/${dot > 0 ? rest.slice(0, dot) : rest}.jpg`;
};

export const CATEGORIES = ['상의', '하의', '신발', '모자', '가방'];
export const GENDERS = ['남성용', '여성용', '공용'];
export const PERIODS = [
  { key: 'daily', label: '오늘' },
  { key: 'weekly', label: '최근 7일' },
  { key: 'monthly', label: '최근 30일' },
];
