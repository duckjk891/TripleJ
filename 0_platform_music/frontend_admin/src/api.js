import axios from 'axios';

// v162 — 관리자 독립 앱 슬림 API 클라이언트.
// vite proxy 가 /api → backend (9005) 로 forward (사용자 앱과 동일 패턴).
const API = axios.create({
  baseURL: '/api',
});

// JWT 토큰 자동 첨부
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 응답 인터셉터 - 401 또는 토큰 만료/무효(403) 시 토큰 제거 + /login 리다이렉트
// 백엔드(app/auth.py) 정책: 누락=401, 만료/Invalid=403("토큰이 만료"/"유효하지 않은 토큰"),
// 권한부족=403("관리자 권한이 필요합니다." 등) — 권한 부족은 토큰 유지.
API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail =
      error.response?.data?.detail ||
      error.response?.data?.error ||
      error.response?.data?.message ||
      '';
    const isTokenInvalid =
      status === 401 ||
      (status === 403 && /토큰|token|만료|expired|invalid|세션/i.test(String(detail)));
    if (isTokenInvalid) {
      // 비로그인 요청의 401: 요청에 Authorization 토큰이 붙어 있지 않았다면
      // 세션 만료가 아님 — localStorage 정리/리다이렉트 없이 조용히 reject.
      const hadAuthToken =
        !!error.config?.headers?.Authorization || !!localStorage.getItem('token');
      if (!hadAuthToken) {
        if (import.meta.env.DEV) {
          console.warn('[API] anon 401, no redirect', { status });
        }
        return Promise.reject(error);
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const path = window.location.pathname || '';
      if (!path.startsWith('/login')) {
        if (import.meta.env.DEV) {
          console.warn('[API] token invalid, redirecting to /login', { status, detail });
        }
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (email, password) =>
  API.post('/auth/login', { email, password });

export const getMe = () =>
  API.get('/auth/me');

// Admin
export const getAdminDashboard = () => API.get('/admin/dashboard');
export const getAdminUsers = (params) => API.get('/admin/users', { params });
export const getAdminUser = (id) => API.get(`/admin/users/${id}`);
export const updateUserRole = (id, role) => API.put(`/admin/users/${id}/role`, { role });
export const banUser = (id, is_banned, reason) => API.put(`/admin/users/${id}/ban`, { is_banned, reason });
// SanctionSquad(v145) — 제재 컨트롤: 생성 제한 해제 / 위반 기록 초기화
export const liftUserRestriction = (id) => API.post(`/admin/users/${id}/restriction/lift`);
export const resetUserStrikes = (id) => API.post(`/admin/users/${id}/strikes/reset`);
export const getAdminTracks = (params) => API.get('/admin/tracks', { params });
export const deleteAdminTrack = (id) => API.delete(`/admin/tracks/${id}`);
export const updateTrackVisibility = (id, is_public) => API.put(`/admin/tracks/${id}/visibility`, { is_public });
export const getAdminLogs = (params) => API.get('/admin/logs', { params });

// 어드민 신고 큐 → { reports: [...target_snapshot 하이드레이션..., urgent, evidence, resolution], pagination }
export const getAdminReports = (params) => API.get('/admin/reports', { params });
// action: 'blind'|'delete'|'dismiss'|'confirm_delete'(확정 삭제)|'restore'(복원)
// (트랙·피드는 blind|restore|confirm_delete|dismiss, 댓글은 delete|dismiss)
export const actionAdminReport = (reportId, action) =>
  API.post(`/admin/reports/${reportId}/action`, { action });

// v138 — 신고 집행 패키지 (양면 뷰·확정 삭제·복원·인물 수색 몰수)
// 어드민 전용 증거 프록시 URL (img src 용) — coverPreviewUrl 의 ?token= 패턴.
export const adminEvidenceUrl = (reportId, idx) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/admin/reports/${reportId}/evidence/${idx}?token=${encodeURIComponent(token || '')}`;
};
// content_json 증거 텍스트 조회 — 응답 본문은 절대 콘솔에 출력하지 않는다.
export const getAdminReportEvidence = (reportId, idx) =>
  API.get(`/admin/reports/${reportId}/evidence/${idx}`);
// 양면 뷰 우측 — 사용자의 최근 생성물 { tracks: [...], character: {...} }
export const getAdminUserRecentContent = (userId) =>
  API.get(`/admin/users/${userId}/recent-content`);
// 인물 수색 — 수 초~수십 초 소요 가능 → 타임아웃 여유(120s)
export const adminFaceSearch = (reportId) =>
  API.post('/admin/moderation/face-search', { report_id: reportId }, { timeout: 120000 });
// 선택 항목 일괄 몰수 — targets: [{type: 'track'|'character', id}]
export const adminPurge = (reportId, targets) =>
  API.post('/admin/moderation/purge', { report_id: reportId, targets });

// CS 문의 (오류신고 → maidol_official DM 관리자 대응)
// 대화 목록 → { conversations:[{conversation_id, peer:{id,nickname,profile_image,code},
//   last_message_text, last_at, unread}], pagination }
export const getCsConversations = (params) => API.get('/admin/cs/conversations', { params });
// 대화 메시지 (before 커서 페이지네이션) → { messages:[{id, sender_id, text, created_at, read}], ... }
export const getCsMessages = (cid, params) =>
  API.get(`/admin/cs/conversations/${cid}/messages`, { params });
// 답장 전송 (공식 계정 발신). 메시지 text 원문은 콘솔에 출력하지 않는다.
export const replyCs = (cid, text) =>
  API.post(`/admin/cs/conversations/${cid}/reply`, { text });
// 읽음 처리 (대화 열람 시)
export const markCsRead = (cid) =>
  API.post(`/admin/cs/conversations/${cid}/read`);
// 미읽음 총계 (nav 뱃지) → { count }
export const getCsUnreadCount = () => API.get('/admin/cs/unread-count');
// 전체 발송 (공식 계정 발신 브로드캐스트) — audience: 'all'|'users'|'customers', text 1~2000자.
// → { queued: N, audience }. 401 무토큰 / 403 비관리자 / 400 잘못된 입력 / 429 중복 발송 잠금(30초) / 503 공식 계정 미시드.
// 메시지 text 원문은 콘솔에 출력하지 않는다.
export const broadcastCs = (audience, text) =>
  API.post('/admin/cs/broadcast', { audience, text });

// Cover preview URL helper (AdminReportsPage 트랙 커버 썸네일)
export const coverPreviewUrl = (objectName) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/upload/cover-preview/${encodeURIComponent(objectName)}?token=${encodeURIComponent(token || '')}`;
};

export default API;
