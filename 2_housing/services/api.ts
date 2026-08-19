import axios from 'axios';

// 백엔드 서버 — 기본값은 Tailscale 내부망(개발), 배포/AWS 이전 시 EXPO_PUBLIC_API_URL 로 교체(재빌드만으로 전환)
// 포트 9004: image_model 선택 + upload-original-photo + used_items 영속화 지원
export const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://100.127.225.55:9004';

const baseURL = `${BACKEND_BASE_URL}/api`;
console.log('[API] Base URL:', baseURL);

// Content-Type을 default에 박지 않음 — axios가 body 타입에 맞춰 자동 설정:
//   plain object → application/json
//   FormData     → multipart/form-data; boundary=... (web에선 브라우저, RN은 native)
// default에 'application/json'을 박으면 web에서 multipart 요청이 JSON.stringify되어 file이 누락됨.
// default timeout 10분 — AI 생성(이미지/캐릭터/음원)이 최대 10분까지 걸릴 수 있어 안전 마진.
// 짧은 API는 자체적으로 빠르게 응답하므로 10분 default가 사용성에 영향 없음.
const api = axios.create({
  baseURL,
  timeout: 600000,
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
