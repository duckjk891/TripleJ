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

function statusMeta(status) {
  return STATUS_META[status] || { label: status || '-', badge: 'admin-badge--gray' };
}

function summarize(text, n = 60) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
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
                                      <div><dt>브라우저</dt><dd className="admin-issues__ua" title={issue.user_agent || undefined}>{issue.user_agent || '-'}</dd></div>
                                      {issue.admin_note && <div><dt>처리 메모</dt><dd>{issue.admin_note}</dd></div>}
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
                      <th>에러 요약</th><th>발생 수</th><th>영향 사용자</th><th>최근 발생</th><th>페이지</th><th>이력</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errGroups.map((g) => {
                      const expanded = expandedFp === g.fingerprint;
                      const hist = historyState[g.fingerprint];
                      return (
                        <Fragment key={g.fingerprint}>
                          <tr>
                            <td className="admin-issues__summary-cell" title={g.message || undefined}>{summarize(g.message, 80)}</td>
                            <td>{(g.count ?? 0).toLocaleString()}</td>
                            <td>{(g.users ?? 0).toLocaleString()}</td>
                            <td className="admin-issues__nowrap">{formatDate(g.last_seen)}</td>
                            <td className="admin-issues__nowrap">{g.page || '-'}</td>
                            <td>
                              <button
                                className="admin-btn admin-btn--small"
                                onClick={() => handleToggleGroup(g.fingerprint)}
                                aria-expanded={expanded}
                              >
                                발생 이력 {expanded ? '▲' : '▼'}
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="admin-issues__detail-row">
                              <td colSpan={6}>
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
                                            {ev.api.method} {ev.api.url} → {ev.api.status}
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
                      <tr><td colSpan={6} className="admin-empty">수집된 에러가 없습니다</td></tr>
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
