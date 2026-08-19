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
// 단건 대화 조회 (v186 — /cs?cid= 진입 시 목록 밖 대화 합류용. 미전송 pending 대화 포함,
// official 참여 검증 404/403) → { conversation: {conversation_id, peer, last_message_text, last_at, unread} }
export const getCsConversation = (cid) => API.get(`/admin/cs/conversations/${cid}`);
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
// 지정 발송용 사용자 검색 — 닉네임 ILIKE + #태그 정확 매칭, active·비밴만.
// → { users: [{id, nickname, profile_image, code}] }. 검색어 원문은 콘솔에 출력하지 않는다.
export const searchCsUsers = (q, limit) =>
  API.get('/admin/cs/users/search', { params: { q, limit } });
// 지정 발송 (공식 계정 발신, 최대 20명) → { requested, sent, failed, failed_ids }.
// 401 무토큰 / 403 비관리자 / 400 잘못된 입력(빈 대상·21명 초과·text 1~2000자) / 503 공식 계정 미시드.
// 메시지 text 원문은 콘솔에 출력하지 않는다.
export const sendCsDirect = (userIds, text) =>
  API.post('/admin/cs/send', { user_ids: userIds, text });

// 별(재화) 관리 (v180 — /points 관리자 페이지)
// 전체 요약 → { total_balance, total_earned, total_spent, today_earned, today_spent }
export const getAdminPointsSummary = () => API.get('/admin/points/summary');
// 특정 사용자 잔액 → { balance }
export const getAdminUserPointBalance = (userId) =>
  API.get(`/admin/points/users/${userId}/balance`);
// 특정 사용자 원장 (page/limit/filter: earn|spend|refund|admin) → { events:[{action, amount, ref, day, created_at}], pagination }
export const getAdminUserPointEvents = (userId, params) =>
  API.get(`/admin/points/users/${userId}/events`, { params });
// 지급/차감 — direction 'grant'|'deduct', amount 1~10000, reason 필수(1~200자) → { balance }.
// 401 무토큰 / 403 비관리자 / 400 유효성·잔액 부족 / 404 사용자 없음. 사유 원문은 콘솔에 출력하지 않는다.
export const adjustAdminPoints = (userId, direction, amount, reason) =>
  API.post('/admin/points/adjust', { user_id: userId, direction, amount, reason });
// 비용표 — 기존 공개 엔드포인트 재사용 (StarEcon 단가 단일 소스) → { costs: {action: cost} }
export const getPointsCosts = () => API.get('/points/costs');

// 별 분석 대시보드 (v181) — 버킷 집계만 반환(개인 식별 값 없음). days 는 7|30|90 화이트리스트.
// 일별 추이 → { days: [{day, earned, spent}] } (연속 range, 0 채움)
export const getAdminPointsDaily = (days) =>
  API.get('/admin/points/analytics/daily', { params: { days } });
// 획득/소비 경로 분포 → { earn: [{action, total}], spend: [{action, total}] } (total DESC)
export const getAdminPointsBreakdown = (days) =>
  API.get('/admin/points/analytics/breakdown', { params: { days } });
// 나이대×성별 집계 — mode 'earn'|'spend' → { rows: [{bucket, male, female, unknown, total}], total }
export const getAdminPointsDemographics = (days, mode) =>
  API.get('/admin/points/analytics/demographics', { params: { days, mode } });
// 소비자 티어 (v182) — 상위 10 소비자 + whale 지표 → { top: [{user_id, nickname, code, total}], whale, spenders }
export const getAdminPointsTopSpenders = (days) =>
  API.get('/admin/points/analytics/top-spenders', { params: { days } });
// 잔액 분포 (v182) — 현재 스냅샷(기간 무관) → { buckets: [{label, count}×5], total_users, total_balance }
export const getAdminPointsBalanceDist = () =>
  API.get('/admin/points/analytics/balance-distribution');
// 플랜·역할 세그먼트 (v183) — mode 'earn'|'spend' → { plan_rows|plan: [{bucket, total, users?}×3],
// role_rows|role: [{bucket, total, users?}×4], users, total } (버킷 집계만 — 개별값 없음)
export const getAdminPointsSegments = (days, mode) =>
  API.get('/admin/points/analytics/segments', { params: { days, mode } });
// 가입 코호트 (v183) — 인원은 가입월 전체·별 활동만 days 필터(직교)
// → { rows: [{month "YYYY-MM"|"미상", users, earned, spent}], total_users }
export const getAdminPointsCohorts = (days) =>
  API.get('/admin/points/analytics/cohorts', { params: { days } });

// 광고주 관리 (v184 — /advertisers 목록·상세·강제 숨김)
// 목록 — q 회사명·닉네임 부분일치, days 7|30|90 → { summary: {카드4}, advertisers: [행...] }
export const getAdminAdvertisers = (q, days) =>
  API.get('/admin/ads/advertisers', { params: { q: q || undefined, days } });
// 상세 — ④프로필(Mongo 정본)+계정 / ⑥성과 요약(days 기준) / ⑦items(누적, admin_hidden 포함)
export const getAdminAdvertiserDetail = (userId, days) =>
  API.get(`/admin/ads/advertisers/${userId}`, { params: { days } });
// ⑧ 광고주 대시보드 그대로 — business dashboard 추출본 위임(period daily|weekly|monthly).
// category '전체' 는 파라미터 생략(사용자 앱 getBusinessDashboard 규약 동일).
export const getAdminAdvertiserDashboard = (userId, period, category, verifiedOnly) => {
  const params = { period };
  if (category && category !== '전체') params.category = category;
  if (verifiedOnly) params.verified_only = true;
  return API.get(`/admin/ads/advertisers/${userId}/dashboard`, { params });
};
// ⑦ 행 확장 — 아이템 스타별 성과 / 인사이트 (광고주 화면과 동일 응답)
export const getAdminAdvertiserItemStars = (userId, itemId, period, verifiedOnly) =>
  API.get(`/admin/ads/advertisers/${userId}/items/${itemId}/stars`, {
    params: { period, ...(verifiedOnly ? { verified_only: true } : {}) },
  });
export const getAdminAdvertiserItemInsights = (userId, itemId, period, verifiedOnly) =>
  API.get(`/admin/ads/advertisers/${userId}/items/${itemId}/insights`, {
    params: { period, ...(verifiedOnly ? { verified_only: true } : {}) },
  });
// 강제 숨김/해제 — 멱등 PATCH → { item_id, hidden, changed }. reason 은 내부 감사용(광고주 비노출). 원문 콘솔 미출력.
// 썸네일은 기존 admin 미디어 프록시 재사용: utils/media.js adminMediaSrc('/api/admin/media/'+object_name).
export const setAdminAdItemHidden = (itemId, hidden, reason) =>
  API.patch(`/admin/ads/items/${itemId}/hidden`, { hidden, ...(reason ? { reason } : {}) });

// 오류 신고 (v185 — /issues 인박스 + 자동 수집 에러)
// 목록 — status(received|in_progress|resolved|dismissed)·reason(playback|payment|account|auth|other)·q(내용·닉네임)
// → { issues: [{id, user_id, nickname, code, reason, text, page_url, user_agent, status, admin_note,
//    handled_at, dm_conversation_id, created_at, ...}], pagination }
export const getAdminIssues = (params) => API.get('/admin/issues', { params });
// 요약 카드 4 → { received, in_progress, today, resolved_7d }
export const getAdminIssuesSummary = () => API.get('/admin/issues/summary');
// 단건 조회 — 목록 행 동일형 (상세 패널 열 때 최신본 갱신용)
export const getAdminIssueDetail = (issueId) => API.get(`/admin/issues/${issueId}`);
// 상태 전이 — status 화이트리스트 400 / 미존재 404. note ≤500(감사에는 길이만 적재).
// v186 — status 선택화(additive): status 생략 + note 만 전달하면 메모 단독 변경(재확인 자동 기록용).
// 신고 본문·메모 원문은 콘솔에 출력하지 않는다.
export const patchAdminIssueStatus = (issueId, status, note) =>
  API.patch(`/admin/issues/${issueId}/status`, {
    ...(status ? { status } : {}),
    ...(note ? { note } : {}),
  });
// 프로브 재확인 (v186) — url 은 /api/ 상대 경로만(서버 4중 검증), GET 한정(그 외 400), 쿨다운 10초(429).
// orig_status 로 지속/해소/판정 불가 verdict 산출 → { status, latency_ms, verdict, probed_at }
export const probeAdminIssueError = (url, extra) =>
  API.post('/admin/issues/probe', { url, ...(extra || {}) });
// 신고 관련 자동 수집 에러 (v186) — 신고자 본인 ∧ 신고 시각 ±30분 → { errors: [...] }
export const getAdminIssueRelatedErrors = (issueId) =>
  API.get(`/admin/issues/${issueId}/related-errors`);
// 자동 수집 에러 묶음 — days 7|30|90 → { errors: [{fingerprint, count, users, last_seen, message, page}], days }
export const getAdminIssueErrors = (days) => API.get('/admin/issues/errors', { params: { days } });
// 묶음 발생 이력 → { events: [{id, message, page, api{method,url,status}, stack, created_at}], pagination }
export const getAdminIssueErrorHistory = (fingerprint, params) =>
  API.get(`/admin/issues/errors/${fingerprint}`, { params });

// Cover preview URL helper (AdminReportsPage 트랙 커버 썸네일)
export const coverPreviewUrl = (objectName) => {
  const token = localStorage.getItem('token');
  return `${API.defaults.baseURL}/upload/cover-preview/${encodeURIComponent(objectName)}?token=${encodeURIComponent(token || '')}`;
};

export default API;
