import { useState, useEffect, useCallback, Fragment } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import {
  getAdminIssues,
  getAdminIssuesSummary,
  getAdminIssueDetail,
  patchAdminIssueStatus,
  getAdminIssueErrors,
  getAdminIssueErrorHistory,
  probeAdminIssueError,
  getAdminIssueRelatedErrors,
} from '../api';
import { formatDate } from '../utils/format';
import './AdminIssuesPage.css';

// 오류 신고 (v185) — 탭① 신고 인박스(요약 4·사유 필터·검색·목록·상세 패널·상태 변경·CS 대화 열기)
// / 탭② 자동 수집 에러(fingerprint 묶음·기간 필터·행 확장 발생 이력 — v184 관행).
// 재확인(재발사) 버튼은 2단계 — 이번엔 자리도 만들지 않는다.
// 로그 prefix `[AdminIssues]` — 신고 본문·메모·닉네임 원문 콘솔 미출력(길이·건수·status 만).

const STATUS_META = {
  received: { label: '접수', badge: 'admin-badge--red' },
  in_progress: { label: '처리중', badge: 'admin-badge--yellow' },
  resolved: { label: '완료', badge: 'admin-badge--green' },
  dismissed: { label: '기각', badge: 'admin-badge--gray' },
};

const REASON_LABELS = {
  playback: '재생 오류',
  payment: '결제·별 오류',
  account: '계정 문제',
  auth: '로그인·본인인증 문제',
  other: '기타',
};

const ERROR_DAY_OPTIONS = [7, 30, 90]; // 백엔드 화이트리스트(7·30·90)
const LIST_LIMIT = 20;
const DEBOUNCE_MS = 300;

// v186 — 프로브 verdict 라벨(확정 계약 4종 + 미확인). indeterminate 는 auth_required 시 "(인증 필요)" 병기.
const VERDICT_META = {
  persisting: { label: '지속중', badge: 'admin-badge--red' },
  resolved: { label: '해소됨', badge: 'admin-badge--green' },
  indeterminate: { label: '판정 불가', badge: 'admin-badge--gray' },
  unreachable: { label: '확인 실패', badge: 'admin-badge--yellow' },
};

function verdictMeta(verdict, authRequired) {
  const meta = VERDICT_META[verdict];
  if (!meta) return { label: verdict || '미확인', badge: 'admin-badge--gray' };
  if (verdict === 'indeterminate' && authRequired) {
    return { ...meta, label: '판정 불가(인증 필요)' };
  }
  return meta;
}

// v186 — 재현 curl 생성(비 GET 이벤트용). 실토큰·실호스트 절대 미포함 — 플레이스홀더만.
function buildReproCurl(method, url) {
  return `curl -X ${String(method || 'GET').toUpperCase()} 'https://<서비스-호스트>${url}' -H 'Authorization: Bearer YOUR_TOKEN'`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 폴백 — 구형/비보안 컨텍스트
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function statusMeta(status) {
  return STATUS_META[status] || { label: status || '-', badge: 'admin-badge--gray' };
}

function summarize(text, n = 60) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// v186 마이크로픽스 — UA 간단 파서(라이브러리 금지, 정규식). "Chrome 151 · Windows 10" 형식,
// 파싱 실패 시 빈 문자열(호출측 원문 폴백). 원문은 title 툴팁으로 유지.
function parseUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return '';
  let m;
  let browser = '';
  if ((m = ua.match(/Edg\/(\d+)/))) browser = `Edge ${m[1]}`; // Edge UA 에 Chrome 토큰 포함 — 선판정
  else if ((m = ua.match(/Chrome\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Firefox\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/Version\/(\d+)[^)]*Safari/))) browser = `Safari ${m[1]}`;
  let os = '';
  if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10';
  else if ((m = ua.match(/Windows NT ([\d.]+)/))) os = `Windows (NT ${m[1]})`;
  else if (/iPhone|iPad/.test(ua)) os = 'iOS'; // iOS UA 에 "like Mac OS X" 포함 — macOS 보다 선판정
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (!browser && !os) return '';
  return [browser, os].filter(Boolean).join(' · ');
}

// v186 마이크로픽스 — 상태코드 쉬운 말 병기. 미등록 코드('network' 포함)는 코드만.
const STATUS_CODE_LABELS = {
  200: '정상',
  400: '잘못된 요청',
  401: '로그인 필요',
  403: '권한 없음',
  404: '찾을 수 없음',
  429: '요청 과다',
  500: '서버 오류',
  502: '서버 응답 불가',
  503: '서버 응답 불가',
};

function statusLabel(code) {
  const label = STATUS_CODE_LABELS[code];
  return label ? `${code}(${label})` : `${code}`;
}

export default function AdminIssuesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('inbox'); // inbox | errors

  // ── 탭① 인박스 ──
  const [summary, setSummary] = useState(null);
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [issuesError, setIssuesError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  // 상태 변경 폼
  const [nextStatus, setNextStatus] = useState('in_progress');
  const [note, setNote] = useState('');
  const [patching, setPatching] = useState(false);

  // ── 탭② 자동 수집 에러 ──
  const [errDays, setErrDays] = useState(7);
  const [errGroups, setErrGroups] = useState(null);
  const [errError, setErrError] = useState('');
  const [expandedFp, setExpandedFp] = useState(null);
  const [historyState, setHistoryState] = useState({}); // fp → {loading, error, data}
  // v186 — 프로브: fp → {probing, notice, last:{status, verdict, probed_at}, log:[{probed_at, status, verdict}]}
  const [probeState, setProbeState] = useState({});
  const [copiedFp, setCopiedFp] = useState(null); // curl 복사 피드백
  // v186 — 신고 상세: 관련 자동 수집 에러 + 관련 API 재확인
  const [relatedState, setRelatedState] = useState({ loading: false, errors: null, failed: false });
  const [issueProbing, setIssueProbing] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await getAdminIssuesSummary();
      setSummary(data || {});
    } catch (err) {
      console.error('[AdminIssues] getAdminIssuesSummary failed', { status: err?.response?.status, message: err?.message });
      setSummary({});
    }
  }, []);

  const loadIssues = useCallback(async (opts) => {
    const { status, reason, query, pageNum } = opts;
    setIssuesLoading(true);
    setIssuesError('');
    if (import.meta.env.DEV) console.info('[AdminIssues] loading issues', { status, reason, q_len: (query || '').length, page: pageNum });
    try {
      const params = { page: pageNum, limit: LIST_LIMIT };
      if (status !== 'all') params.status = status;
      if (reason !== 'all') params.reason = reason;
      if (query) params.q = query;
      const { data } = await getAdminIssues(params);
      const list = Array.isArray(data?.issues) ? data.issues : [];
      if (!Array.isArray(data?.issues)) {
        console.warn('[AdminIssues] unexpected issues response shape', { keys: Object.keys(data || {}) });
      }
      setIssues(list);
      setTotalPages(data?.pagination?.totalPages || 1);
      if (import.meta.env.DEV) console.info('[AdminIssues] issues loaded', { count: list.length });
    } catch (err) {
      console.error('[AdminIssues] getAdminIssues failed', { status: err?.response?.status, message: err?.message });
      setIssuesError('신고 목록을 불러오지 못했습니다.');
    } finally {
      setIssuesLoading(false);
    }
  }, []);

  // 인박스 로드 — 필터/검색(디바운스)/페이지 변경
  useEffect(() => {
    if (tab !== 'inbox') return undefined;
    const query = q.trim();
    const timer = setTimeout(() => {
      loadIssues({ status: statusFilter, reason: reasonFilter, query, pageNum: page });
    }, query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [tab, statusFilter, reasonFilter, q, page, loadIssues]);

  useEffect(() => {
    if (tab !== 'inbox') return;
    // 기존 페이지 관행(fetch-in-effect)과 동일 패턴
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
  }, [tab, loadSummary]);

  const loadErrors = useCallback(async (d) => {
    setErrError('');
    setErrGroups(null);
    if (import.meta.env.DEV) console.info('[AdminIssues] loading error groups', { days: d });
    try {
      const { data } = await getAdminIssueErrors(d);
      const groups = Array.isArray(data?.errors) ? data.errors : [];
      setErrGroups(groups);
      if (import.meta.env.DEV) console.info('[AdminIssues] error groups loaded', { count: groups.length });
    } catch (err) {
      console.error('[AdminIssues] getAdminIssueErrors failed', { status: err?.response?.status, days: d, message: err?.message });
      setErrError('에러 목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    if (tab !== 'errors') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedFp(null);
    setHistoryState({});
    loadErrors(errDays);
  }, [tab, errDays, loadErrors]);

  const fetchHistory = useCallback(async (fp) => {
    setHistoryState((m) => ({ ...m, [fp]: { loading: true } }));
    if (import.meta.env.DEV) console.info('[AdminIssues] loading error history', { days: errDays });
    try {
      const { data } = await getAdminIssueErrorHistory(fp, { days: errDays, page: 1, limit: 20 });
      setHistoryState((m) => ({ ...m, [fp]: { loading: false, data } }));
      if (import.meta.env.DEV) console.info('[AdminIssues] error history loaded', { count: (data?.events || []).length });
    } catch (err) {
      console.error('[AdminIssues] getAdminIssueErrorHistory failed', { status: err?.response?.status, message: err?.message });
      setHistoryState((m) => ({ ...m, [fp]: { loading: false, error: true } }));
    }
  }, [errDays]);

  const handleToggleGroup = (fp) => {
    if (expandedFp === fp) {
      setExpandedFp(null);
      return;
    }
    setExpandedFp(fp);
    const cached = historyState[fp];
    if (!cached || cached.error) fetchHistory(fp);
  };

  // v187 — 행 아무데나 클릭해도 확장 토글. 단, 드래그로 텍스트를 선택한 뒤의 클릭은 무시한다
  // (관리자가 에러 메시지를 드래그해 복사하는 도중 행이 접히는 것 방지).
  const handleRowToggle = (fp) => {
    const selected = window.getSelection?.().toString() || '';
    if (selected) return;
    handleToggleGroup(fp);
  };

  // v187 — 키보드 접근성(Enter/Space). 행 내부 버튼에서 올라온 키 이벤트는 버튼이 자체 처리하므로 무시(이중 토글 방지).
  const handleRowKeyDown = (e, fp) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault(); // Space 페이지 스크롤 방지
    handleToggleGroup(fp);
  };

  // v186 — 그룹 프로브 재확인(api 필드 보유 + GET 한정 — 호출측 분기 보장)
  const handleProbeGroup = useCallback(async (fp, repApi) => {
    if (probeState[fp]?.probing) return;
    setProbeState((m) => ({ ...m, [fp]: { ...(m[fp] || {}), probing: true, notice: '' } }));
    if (import.meta.env.DEV) console.info('[AdminIssues] probing group', { fp: String(fp).slice(0, 8) });
    try {
      const { data } = await probeAdminIssueError(repApi.url, { fingerprint: fp, orig_status: repApi.status });
      if (import.meta.env.DEV) console.info('[AdminIssues] probe done', { fp: String(fp).slice(0, 8), status: data?.status, verdict: data?.verdict });
      setProbeState((m) => {
        const prev = m[fp] || {};
        const entry = {
          probed_at: data?.probed_at || new Date().toISOString(),
          status: data?.status,
          verdict: data?.verdict,
          auth_required: !!data?.auth_required,
        };
        return { ...m, [fp]: { probing: false, notice: '', last: entry, log: [entry, ...(prev.log || [])] } };
      });
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminIssues] probeAdminIssueError failed', { status, message: err?.message });
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setProbeState((m) => ({
        ...m,
        [fp]: {
          ...(m[fp] || {}),
          probing: false,
          notice: status === 429 ? '잠시 후 다시 확인해주세요.' : detail || '재확인에 실패했습니다.',
        },
      }));
    }
  }, [probeState]);

  // v186 — 재현 curl 복사(비 GET) — 실토큰 미포함(플레이스홀더)
  const handleCopyCurl = useCallback(async (fp, apiMeta) => {
    const ok = await copyToClipboard(buildReproCurl(apiMeta.method, apiMeta.url));
    if (import.meta.env.DEV) console.info('[AdminIssues] repro curl copy', { fp: String(fp).slice(0, 8), ok });
    if (ok) {
      setCopiedFp(fp);
      setTimeout(() => setCopiedFp((cur) => (cur === fp ? null : cur)), 2000);
    }
  }, []);

  // v186 — 신고 상세: 관련 API 재확인 → 처리 메모 자동 append(메모 단독 PATCH) → 상세 재조회
  const handleProbeRelated = useCallback(async (issue, apiMeta) => {
    if (issueProbing) return;
    setIssueProbing(true);
    if (import.meta.env.DEV) console.info('[AdminIssues] probing related api', { issue: String(issue.id).slice(0, 8) });
    try {
      const { data } = await probeAdminIssueError(apiMeta.url, { issue_id: issue.id, orig_status: apiMeta.status });
      const v = verdictMeta(data?.verdict, !!data?.auth_required);
      if (import.meta.env.DEV) console.info('[AdminIssues] related probe done', { status: data?.status, verdict: data?.verdict });
      // 메모 자동 기록 — 기존 메모 뒤에 append, 500자 초과 시 뒤(최신)를 보존
      const line = `재확인 ${formatDate(data?.probed_at || new Date().toISOString())}: ${statusLabel(data?.status)} — ${v.label}`;
      const combined = issue.admin_note ? `${issue.admin_note}\n${line}` : line;
      await patchAdminIssueStatus(issue.id, undefined, combined.slice(-500));
      // 상세 재조회(단건) → 행 갱신
      const { data: fresh } = await getAdminIssueDetail(issue.id);
      if (fresh?.id) setIssues((prev) => prev.map((it) => (it.id === fresh.id ? { ...it, ...fresh } : it)));
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminIssues] related probe failed', { status, message: err?.message });
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      alert(status === 429 ? '잠시 후 다시 확인해주세요.' : detail || '재확인에 실패했습니다.');
    } finally {
      setIssueProbing(false);
    }
  }, [issueProbing]);

  const selected = issues.find((i) => i.id === selectedId) || null;

  const handleSelect = (issue) => {
    const opening = issue.id !== selectedId;
    setSelectedId(opening ? issue.id : null);
    setNote('');
    // 다음 상태 기본값 — 현재 상태에서 자연스러운 전이
    setNextStatus(issue.status === 'received' ? 'in_progress' : 'resolved');
    if (opening) {
      // 단건 최신본으로 행 갱신 (확정 계약 GET /{issue_id} — best-effort)
      getAdminIssueDetail(issue.id)
        .then(({ data }) => {
          if (data?.id) setIssues((prev) => prev.map((it) => (it.id === data.id ? { ...it, ...data } : it)));
        })
        .catch((err) => {
          console.error('[AdminIssues] getAdminIssueDetail failed', { status: err?.response?.status, message: err?.message });
        });
      // v186 — 관련 자동 수집 에러(신고자 본인 ∧ ±30분) 병치 로드
      setRelatedState({ loading: true, errors: null, failed: false });
      getAdminIssueRelatedErrors(issue.id)
        .then(({ data }) => {
          const list = Array.isArray(data?.errors) ? data.errors : [];
          setRelatedState({
            loading: false, errors: list, failed: false,
            windowMinutes: typeof data?.window_minutes === 'number' ? data.window_minutes : 30,
          });
          if (import.meta.env.DEV) console.info('[AdminIssues] related errors loaded', { count: list.length });
        })
        .catch((err) => {
          console.error('[AdminIssues] getAdminIssueRelatedErrors failed', { status: err?.response?.status, message: err?.message });
          setRelatedState({ loading: false, errors: null, failed: true });
        });
    }
  };

  const handlePatchStatus = useCallback(async () => {
    if (!selected || patching) return;
    const noteTrimmed = note.trim();
    const from = statusMeta(selected.status).label;
    const to = statusMeta(nextStatus).label;
    const confirmed = window.confirm(
      `이 신고의 상태를 [${from}] → [${to}] 로 변경합니다.${noteTrimmed ? '\n처리 메모가 함께 저장됩니다.' : ''}\n진행하시겠습니까?`
    );
    if (!confirmed) return;
    setPatching(true);
    if (import.meta.env.DEV) console.info('[AdminIssues] patching status', { to: nextStatus, note_len: noteTrimmed.length });
    try {
      await patchAdminIssueStatus(selected.id, nextStatus, noteTrimmed || undefined);
      // 목록·요약 갱신 (선택 유지)
      await loadIssues({ status: statusFilter, reason: reasonFilter, query: q.trim(), pageNum: page });
      loadSummary();
      setNote('');
      if (import.meta.env.DEV) console.info('[AdminIssues] status patched');
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminIssues] patchAdminIssueStatus failed', { status, message: err?.message });
      alert(status === 400
        ? (err?.response?.data?.error || '입력 값이 올바르지 않습니다.')
        : status === 404 ? '신고를 찾을 수 없습니다.' : '상태 변경에 실패했습니다.');
    } finally {
      setPatching(false);
    }
  }, [selected, patching, note, nextStatus, statusFilter, reasonFilter, q, page, loadIssues, loadSummary]);

  const summaryCards = [
    { label: '미처리', value: summary?.received, highlight: true },
    { label: '처리중', value: summary?.in_progress },
    { label: '오늘 인입', value: summary?.today },
    { label: '최근 7일 완료', value: summary?.resolved_7d },
  ];

  return (
    <AdminLayout>
      <div className="admin-issues">
        <h2 className="admin-page-title">오류 신고</h2>

        <div className="admin-issues__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'inbox'}
            className={`admin-issues__tab ${tab === 'inbox' ? 'admin-issues__tab--active' : ''}`}
            onClick={() => setTab('inbox')}
          >
            신고 인박스
          </button>
          <button
            role="tab"
            aria-selected={tab === 'errors'}
            className={`admin-issues__tab ${tab === 'errors' ? 'admin-issues__tab--active' : ''}`}
            onClick={() => setTab('errors')}
          >
            자동 수집 에러
          </button>
        </div>

        {tab === 'inbox' && (
          <>
            <div className="admin-issues__stats">
              {summaryCards.map((c) => (
                <div key={c.label} className={`admin-issues__stat-card ${c.highlight ? 'admin-issues__stat-card--alert' : ''}`}>
                  <span className="admin-issues__stat-label">{c.label}</span>
                  <span className="admin-issues__stat-value">{(c.value ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="admin-issues__filters">
              <div className="admin-issues__chips">
                <button
                  className={`admin-issues__chip ${reasonFilter === 'all' ? 'admin-issues__chip--active' : ''}`}
                  onClick={() => { setReasonFilter('all'); setPage(1); }}
                >
                  전체
                </button>
                {Object.entries(REASON_LABELS).map(([code, label]) => (
                  <button
                    key={code}
                    className={`admin-issues__chip ${reasonFilter === code ? 'admin-issues__chip--active' : ''}`}
                    onClick={() => { setReasonFilter(code); setPage(1); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="admin-issues__filter-row">
                <select
                  className="admin-issues__select"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                >
                  <option value="all">상태 전체</option>
                  {Object.entries(STATUS_META).map(([code, meta]) => (
                    <option key={code} value={code}>{meta.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  className="admin-issues__search"
                  placeholder="내용 또는 닉네임 검색"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                />
              </div>
            </div>

            {issuesError ? (
              <div className="admin-error">
                <p>{issuesError}</p>
                <button className="admin-btn admin-btn--small" onClick={() => loadIssues({ status: statusFilter, reason: reasonFilter, query: q.trim(), pageNum: page })}>재시도</button>
              </div>
            ) : issuesLoading ? (
              <p className="admin-loading">로딩 중...</p>
            ) : (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table--full">
                    <thead>
                      <tr>
                        <th>상태</th><th>사유</th><th>내용</th><th>신고자</th><th>접수일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((issue) => {
                        const st = statusMeta(issue.status);
                        return (
                          <Fragment key={issue.id}>
                            <tr
                              className={`admin-issues__row ${selectedId === issue.id ? 'admin-issues__row--selected' : ''}`}
                              onClick={() => handleSelect(issue)}
                            >
                              <td><span className={`admin-badge ${st.badge}`}>{st.label}</span></td>
                              <td className="admin-issues__nowrap">{REASON_LABELS[issue.reason] || issue.reason || '-'}</td>
                              <td className="admin-issues__summary-cell">{summarize(issue.text)}</td>
                              <td className="admin-issues__nowrap">
                                {issue.nickname || '-'}{issue.code ? `#${issue.code}` : ''}
                              </td>
                              <td className="admin-issues__nowrap">{formatDate(issue.created_at)}</td>
                            </tr>
                            {selectedId === issue.id && (
                              <tr className="admin-issues__detail-row">
                                <td colSpan={5}>
                                  <div className="admin-issues__detail">
                                    <p className="admin-issues__detail-text">{issue.text}</p>
                                    <dl className="admin-issues__detail-meta">
                                      <div>
                                        <dt>신고자</dt>
                                        <dd>
                                          {issue.user_id ? (
                                            <Link to={`/users/${issue.user_id}`} className="admin-issues__link" title={String(issue.user_id)}>
                                              {issue.nickname || `사용자 #${String(issue.user_id).slice(0, 8)}`}{issue.code ? `#${issue.code}` : ''}
                                            </Link>
                                          ) : '-'}
                                        </dd>
                                      </div>
                                      <div><dt>페이지</dt><dd>{issue.page_url || '-'}</dd></div>
                                      <div><dt>브라우저</dt><dd className="admin-issues__ua" title={issue.user_agent || undefined}>{parseUserAgent(issue.user_agent) || issue.user_agent || '-'}</dd></div>
                                      {issue.admin_note && <div><dt>처리 메모</dt><dd className="admin-issues__memo">{issue.admin_note}</dd></div>}
                                      {issue.handled_at && <div><dt>처리 시각</dt><dd>{formatDate(issue.handled_at)}</dd></div>}
                                    </dl>
                                    <div className="admin-issues__detail-actions">
                                      <select
                                        className="admin-issues__select"
                                        value={nextStatus}
                                        onChange={(e) => setNextStatus(e.target.value)}
                                        disabled={patching}
                                      >
                                        {Object.entries(STATUS_META).map(([code, meta]) => (
                                          <option key={code} value={code}>{meta.label}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        className="admin-issues__note"
                                        placeholder="처리 메모 (선택, 500자 이내)"
                                        maxLength={500}
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        disabled={patching}
                                      />
                                      <button
                                        className="admin-btn admin-btn--small"
                                        onClick={handlePatchStatus}
                                        disabled={patching || issue.status === nextStatus}
                                      >
                                        {patching ? '변경 중...' : '상태 변경'}
                                      </button>
                                      {issue.dm_conversation_id && (
                                        <button
                                          className="admin-btn admin-btn--small"
                                          onClick={() => navigate(`/cs?cid=${encodeURIComponent(issue.dm_conversation_id)}`)}
                                        >
                                          CS 대화 열기
                                        </button>
                                      )}
                                    </div>

                                    {/* v186 — 관련 자동 수집 에러 병치 ("기계 관측") */}
                                    <div className="admin-issues__related">
                                      <h4 className="admin-issues__related-title">
                                        관련 자동 수집 에러
                                        <span className="admin-issues__related-hint">신고 시각 ±{relatedState.windowMinutes || 30}분 · 신고자 본인 발생분</span>
                                      </h4>
                                      {relatedState.loading ? (
                                        <p className="admin-issues__panel-status">불러오는 중...</p>
                                      ) : relatedState.failed ? (
                                        <p className="admin-issues__panel-status">관련 에러를 불러오지 못했습니다.</p>
                                      ) : !relatedState.errors || relatedState.errors.length === 0 ? (
                                        <p className="admin-issues__panel-status">같은 시간대의 자동 수집 에러가 없습니다.</p>
                                      ) : (
                                        <>
                                          <ul className="admin-issues__history">
                                            {relatedState.errors.map((ev, i) => (
                                              <li key={ev.id || i} className="admin-issues__history-row">
                                                <span className="admin-issues__nowrap">{formatDate(ev.created_at)}</span>
                                                <span className="admin-issues__history-msg" title={ev.message || undefined}>{summarize(ev.message, 90)}</span>
                                                {ev.api ? (
                                                  <span className="admin-issues__api-meta">
                                                    {ev.api.method} {ev.api.url} → {statusLabel(ev.api.status)}
                                                    {ev.page ? ` · ${ev.page}에서` : ''}
                                                  </span>
                                                ) : (
                                                  <span className="admin-issues__api-meta admin-issues__api-meta--none">{ev.page || '-'}</span>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                          {(() => {
                                            const probeTarget = relatedState.errors.find(
                                              (ev) => ev.api && String(ev.api.method || '').toUpperCase() === 'GET'
                                            );
                                            if (!probeTarget) return null;
                                            return (
                                              <div className="admin-issues__related-probe">
                                                <button
                                                  className="admin-btn admin-btn--small"
                                                  onClick={() => handleProbeRelated(issue, probeTarget.api)}
                                                  disabled={issueProbing}
                                                >
                                                  {issueProbing ? '확인 중...' : '관련 API 재확인'}
                                                </button>
                                                <span className="admin-issues__related-hint">
                                                  결과는 처리 메모에 자동 기록됩니다 ({probeTarget.api.method} {probeTarget.api.url})
                                                </span>
                                              </div>
                                            );
                                          })()}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      {issues.length === 0 && (
                        <tr><td colSpan={5} className="admin-empty">신고가 없습니다</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="admin-pagination">
                    <button className="admin-btn admin-btn--small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
                    <span className="admin-pagination__info">{page} / {totalPages}</span>
                    <button className="admin-btn admin-btn--small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === 'errors' && (
          <>
            <div className="admin-issues__filter-row">
              <div className="admin-issues__chips">
                {ERROR_DAY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`admin-issues__chip ${errDays === d ? 'admin-issues__chip--active' : ''}`}
                    onClick={() => setErrDays(d)}
                  >
                    {d}일
                  </button>
                ))}
              </div>
            </div>

            {errError ? (
              <div className="admin-error">
                <p>{errError}</p>
                <button className="admin-btn admin-btn--small" onClick={() => loadErrors(errDays)}>재시도</button>
              </div>
            ) : errGroups === null ? (
              <p className="admin-loading">로딩 중...</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table--full">
                  <thead>
                    <tr>
                      <th>에러 요약</th><th>발생 수</th><th>영향 사용자</th><th>최근 발생</th><th>페이지</th><th>지속 여부</th><th>이력</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errGroups.map((g) => {
                      const expanded = expandedFp === g.fingerprint;
                      const hist = historyState[g.fingerprint];
                      const probe = probeState[g.fingerprint] || {};
                      // 세션 내 프로브 결과가 있으면 우선, 없으면 서버 last_probe(additive)
                      const lastProbe = probe.last || g.last_probe || null;
                      // 행 확장 이력에서 api 보유 대표 이벤트(재확인/curl 분기 기준)
                      const repApi = (hist?.data?.events || []).find((ev) => ev.api)?.api || null;
                      const repIsGet = repApi && String(repApi.method || '').toUpperCase() === 'GET';
                      // 이력 로딩 전에는 repApi 판정이 확정되지 않으므로 "api 없음" 안내를 띄우지 않는다(오안내 방지)
                      const histReady = !!hist && !hist.loading && !hist.error;
                      return (
                        <Fragment key={g.fingerprint}>
                          {/* v187 — 행 전체 클릭 확장(기존 [발생 이력] 버튼은 유지). tabIndex/aria-expanded/키보드 병행.
                              role="button" 은 두지 않는다 — table row 시맨틱(행 위치·열 연관)이 깨지는 데다
                              행 안의 실제 [발생 이력] 버튼이 이미 보조기술 경로를 제공하므로 중복 role 은 손해만 크다. */}
                          <tr
                            className="admin-issues__err-row"
                            tabIndex={0}
                            aria-expanded={expanded}
                            onClick={() => handleRowToggle(g.fingerprint)}
                            onKeyDown={(e) => handleRowKeyDown(e, g.fingerprint)}
                          >
                            <td className="admin-issues__summary-cell" title={g.message || undefined}>{summarize(g.message, 80)}</td>
                            <td>{(g.count ?? 0).toLocaleString()}</td>
                            <td>{(g.users ?? 0).toLocaleString()}</td>
                            <td className="admin-issues__nowrap">{formatDate(g.last_seen)}</td>
                            <td className="admin-issues__nowrap">{g.page || '-'}</td>
                            <td className="admin-issues__nowrap">
                              {lastProbe ? (
                                <>
                                  <span className={`admin-badge ${verdictMeta(lastProbe.verdict, lastProbe.auth_required).badge}`}>
                                    {verdictMeta(lastProbe.verdict, lastProbe.auth_required).label}
                                  </span>
                                  <span className="admin-issues__probe-time">
                                    {formatDate(lastProbe.probed_at || lastProbe.created_at)}
                                  </span>
                                </>
                              ) : '—'}
                            </td>
                            <td>
                              <button
                                className="admin-btn admin-btn--small"
                                // v187 — 행 클릭 토글과 겹쳐 즉시 되접히는 이중 토글 방지
                                onClick={(e) => { e.stopPropagation(); handleToggleGroup(g.fingerprint); }}
                                aria-expanded={expanded}
                              >
                                발생 이력 {expanded ? '▲' : '▼'}
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="admin-issues__detail-row">
                              <td colSpan={7}>
                                {/* v186 — 프로브 재확인(GET) / 재현 명령 복사(비 GET) */}
                                {/* v187 — api 정보가 없는 그룹은 버튼 부재 사유를 안내(빈 자리 방치 금지) */}
                                {repApi ? (
                                  <div className="admin-issues__probe-bar">
                                    {/* planner 판정 — GET 행은 [지금 재확인]+[재현 명령 복사] 병행, 비 GET 은 복사만 */}
                                    {repIsGet && (
                                      <button
                                        className="admin-btn admin-btn--small"
                                        onClick={() => handleProbeGroup(g.fingerprint, repApi)}
                                        disabled={!!probe.probing}
                                      >
                                        {probe.probing ? '확인 중...' : '지금 재확인'}
                                      </button>
                                    )}
                                    <button
                                      className="admin-btn admin-btn--small"
                                      onClick={() => handleCopyCurl(g.fingerprint, repApi)}
                                    >
                                      {copiedFp === g.fingerprint ? '복사됨 ✓' : '재현 명령 복사'}
                                    </button>
                                    {probe.last && (
                                      <span className={`admin-badge ${verdictMeta(probe.last.verdict, probe.last.auth_required).badge}`}>
                                        방금 확인: {statusLabel(probe.last.status)} — {verdictMeta(probe.last.verdict, probe.last.auth_required).label}
                                      </span>
                                    )}
                                    {probe.notice && <span className="admin-issues__probe-notice">{probe.notice}</span>}
                                  </div>
                                ) : histReady ? (
                                  <p className="admin-issues__probe-na">
                                    재호출할 API 정보가 없는 에러입니다(콘솔·소켓 오류 등) — 재확인·재현 명령을 제공할 수 없습니다.
                                  </p>
                                ) : null}
                                {(probe.log || []).length > 0 && (
                                  <ul className="admin-issues__history admin-issues__probe-log">
                                    {probe.log.map((p, i) => (
                                      <li key={`${p.probed_at}-${i}`} className="admin-issues__history-row">
                                        <span className="admin-issues__nowrap">{formatDate(p.probed_at)}</span>
                                        <span className="admin-issues__history-msg">확인 결과 {statusLabel(p.status)}</span>
                                        <span className={`admin-badge ${verdictMeta(p.verdict, p.auth_required).badge}`}>{verdictMeta(p.verdict, p.auth_required).label}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {!hist || hist.loading ? (
                                  <p className="admin-issues__panel-status">이력 로딩 중...</p>
                                ) : hist.error ? (
                                  <p className="admin-issues__panel-status">이력을 불러오지 못했습니다.</p>
                                ) : (
                                  <ul className="admin-issues__history">
                                    {(hist.data?.events || []).map((ev) => (
                                      <li key={ev.id} className="admin-issues__history-row">
                                        <span className="admin-issues__nowrap">{formatDate(ev.created_at)}</span>
                                        <span className="admin-issues__history-msg" title={ev.message || undefined}>{summarize(ev.message, 100)}</span>
                                        {ev.api ? (
                                          <span className="admin-issues__api-meta">
                                            {ev.api.method} {ev.api.url} → {statusLabel(ev.api.status)}
                                          </span>
                                        ) : (
                                          <span className="admin-issues__api-meta admin-issues__api-meta--none">{ev.page || '-'}</span>
                                        )}
                                      </li>
                                    ))}
                                    {(hist.data?.events || []).length === 0 && (
                                      <li className="admin-issues__panel-status">기간 내 발생 이력이 없습니다.</li>
                                    )}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {errGroups.length === 0 && (
                      <tr><td colSpan={7} className="admin-empty">수집된 에러가 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
