import axios from 'axios';

// 백엔드 서버 IP (다른 PC에서 실행 중)
const BACKEND_HOST = '192.168.219.106';
const BACKEND_PORT = 9001;

const baseURL = `http://${BACKEND_HOST}:${BACKEND_PORT}/api`;
console.log('[API] Base URL:', baseURL);

const api = axios.create({
  baseURL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth token - managed directly to avoid circular dependency
let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

api.interceptors.request.use(
  (config) => {
    if (_authToken) {
      config.headers.Authorization = `Bearer ${_authToken}`;
    }
    console.log('[API Request]', config.method?.toUpperCase(), config.url, _authToken ? '(토큰 있음)' : '(토큰 없음!)');
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url;
    console.error('[API Error]', url, `status=${status}`, error.message);
    if (status === 401) {
      console.warn('[AUTH] 인증 토큰이 없거나 만료되었습니다. 다시 로그인해주세요.');
    }
    return Promise.reject(error);
  }
);

export default api;
