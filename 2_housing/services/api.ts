import axios from 'axios';
import { handleAccountSuspendedError, handleChildRestrictedError } from '../utils/kidsRestricted';

// 백엔드 서버 — AWS 이전 완료(2026-09-17): 기본값 = AWS EC2 (api.maidol.ai.kr, backend_9004 동일 코드).
// 로컬/구서버로 되돌리려면 EXPO_PUBLIC_API_URL=http://100.127.225.55:9004 로 실행(재빌드만으로 전환).
export const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.maidol.ai.kr';

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
    // v3.232 K2: 어린이 계정 서버 차단(code=child_restricted) 공통 안내 — 3초 중복 억제.
    // 성인·구서버는 이 코드를 받지 않아 무동작. 오류는 그대로 reject(화면 기존 catch 경로 유지,
    // 자체 팝업 중복을 피하려면 화면에서 isChildRestrictedError(err) 로 생략).
    try {
      handleChildRestrictedError(error);
    } catch (e) {
      console.error('[KidsGate] 인터셉터 처리 실패', e);
    }
    // v3.233: 보호자 동의 철회로 이용 중지된 계정(403 code=account_suspended) 공통 안내 — 3초 중복 억제,
    // 이메일 로그인은 화면 오류 줄로 안내(팝업 생략). 다른 오류·구서버는 무동작, 오류는 그대로 reject.
    try {
      handleAccountSuspendedError(error);
    } catch (e) {
      console.error('[KidsGuard] 인터셉터 처리 실패', e);
    }
    return Promise.reject(error);
  }
);

export default api;
