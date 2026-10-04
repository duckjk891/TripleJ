import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getIssues, getIssueSummary, getIssueRelatedErrors, updateIssueStatus,
  getErrorGroups, getErrorHistory, probeError, errMsg,
} from '../api';
import { formatDate } from './Dashboard';
import { appAlert } from '../components/dialog';

const STATUS = {
  received: ['접수', 'badge--amber'],
  in_progress: ['처리 중', 'badge--purple'],
  resolved: ['완료', 'badge--green'],
  dismissed: ['기각', 'badge--gray'],
};
const REASONS = { playback: '재생', payment: '결제·별', account: '계정', auth: '로그인·인증', other: '기타' };
const VERDICT = {
  resolved: ['지금은 정상', 'badge--green'], persisting: ['계속 발생', 'badge--red'],
  unreachable: ['서버 응답 없음', 'badge--red'], indeterminate: ['판단 불가', 'badge--gray'],
};

const StatusBadge = ({ s }) => {
  const [label, cls] = STATUS[s] || [s, 'badge--gray'];
  return <span className={`badge ${cls}`}>{label}</span>;
};
const VerdictBadge = ({ v }) => {
  if (!v) return null;
  const [label, cls] = VERDICT[v] || [v, 'badge--gray'];
  return <span className={`badge ${cls}`}>{label}</span>;
};
const pageLabel = (p) => (typeof p === 'string' ? p : (p?.path || JSON.stringify(p)));
const apiUrlOf = (api) => (api && typeof api === 'object' ? (api.url || api.path || '') : '');

function IssueModal({ issue, onClose, onSaved }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(issue.status);
  const [note, setNote] = useState(issue.admin_note || '');
  const [related, setRelated] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getIssueRelatedErrors(issue.id).then((r) => setRelated(r.data)).catch(() => setRelated({ errors: [] }));
  }, [issue.id]);

  const save = async () => {
    setSaving(true);
    try {
      await updateIssueStatus(issue.id, status, note);
      onSaved();
    } catch (e) {
      await appAlert(errMsg(e, '저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">오류 신고 — {REASONS[issue.reason] || issue.reason}</h3>
        <dl className="kv" style={{ marginBottom: 14 }}>
          <dt>접수</dt><dd>{formatDate(issue.created_at)}</dd>
          <dt>신고자</dt><dd>{issue.nickname || '(알 수 없음)'}{issue.code ? ` #${issue.code}` : ''}</dd>
          <dt>내용</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{issue.text || '(입력 없음)'}</dd>
          <dt>화면</dt><dd>{issue.page_url || '-'}</dd>
          {issue.recent_pages?.length > 0 && (
            <><dt>직전 동선</dt><dd>{issue.recent_pages.map(pageLabel).join('  ←  ')}</dd></>
          )}
          <dt>앱 버전</dt><dd>{issue.app_version || '-'}</dd>
          <dt>기기</dt><dd className="cell-sub">{issue.user_agent || '-'}</dd>
          {issue.handled_at && (<><dt>최근 처리</dt><dd>{formatDate(issue.handled_at)}</dd></>)}
        </dl>

        <h4 className="section-title">같은 시각 자동 수집 에러 {related ? `(${related.errors.length}건, 전후 ${related.window_minutes ?? 30}분)` : ''}</h4>
        {!related ? <p className="cell-sub">로딩…</p> : related.errors.length === 0
          ? <p className="cell-sub" style={{ marginBottom: 14 }}>이 사용자에게서 수집된 에러가 없습니다.</p>
          : (
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table>
                <tbody>
                  {related.errors.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap cell-sub">{formatDate(e.created_at)}</td>
                      <td>{e.message}<div className="cell-sub">{e.page}{apiUrlOf(e.api) ? ` · ${apiUrlOf(e.api)}` : ''}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        <div className="form-row">
          <label>상태</label>
          <div className="filter-group" style={{ display: 'inline-flex' }}>
            {Object.entries(STATUS).map(([v, [l]]) => (
              <button key={v} type="button" className={`filter-btn ${status === v ? 'active' : ''}`} onClick={() => setStatus(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label>처리 메모 (관리자만 봅니다, 500자)</label>
          <textarea className="textarea" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="modal__footer">
          {issue.dm_conversation_id && (
            <button className="btn" onClick={() => navigate('/messages')}>DM 문의함으로</button>
          )}
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn--primary" disabled={saving} onClick={save}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

function Inbox({ onChanged }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 20 };
      if (status) params.status = status;
      if (reason) params.reason = reason;
      if (query) params.q = query;
      const res = await getIssues(params);
      setIssues(res.data.issues || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (e) {
      setError(errMsg(e, '오류 신고를 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [status, reason, query, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="filters">
        <div className="filter-group">
          {[['', '전체'], ...Object.entries(STATUS).map(([v, [l]]) => [v, l])].map(([v, l]) => (
            <button key={v} className={`filter-btn ${status === v ? 'active' : ''}`} onClick={() => { setStatus(v); setPage(1); }}>{l}</button>
          ))}
        </div>
        <select className="select" value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }}>
          <option value="">모든 유형</option>
          {Object.entries(REASONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q.trim()); }}>
          <input className="input" placeholder="내용·닉네임 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" type="submit">검색</button>
        </form>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>접수일</th><th>유형</th><th>내용</th><th>신고자</th><th>앱 버전</th><th>상태</th></tr></thead>
            <tbody>
              {issues.map((it) => (
                <tr key={it.id} className="row-click" onClick={() => setOpen(it)}>
                  <td className="nowrap">{formatDate(it.created_at)}</td>
                  <td className="nowrap">{REASONS[it.reason] || it.reason}</td>
                  <td style={{ minWidth: 200 }}>{(it.text || '').slice(0, 80) || <span className="cell-sub">(입력 없음)</span>}
                    {it.page_url && <div className="cell-sub">{it.page_url}</div>}</td>
                  <td className="nowrap">{it.nickname || '-'}</td>
                  <td className="nowrap cell-sub">{it.app_version || '-'}</td>
                  <td><StatusBadge s={it.status} /></td>
                </tr>
              ))}
              {issues.length === 0 && <tr><td colSpan={6} className="td-empty">오류 신고가 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
          <span className="pagination__info">{page} / {totalPages}</span>
          <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}
      {open && <IssueModal issue={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); onChanged(); }} />}
    </>
  );
}

function ErrorHistoryModal({ group, days, onClose }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    setData(null);
    getErrorHistory(group.fingerprint, { days, page, limit: 20 }).then((r) => setData(r.data)).catch(() => setData({ events: [] }));
  }, [group.fingerprint, days, page]);

  const firstApi = (data?.events || []).map((e) => e.api).find((a) => apiUrlOf(a).startsWith('/api/'));
  const runProbe = async () => {
    setProbing(true);
    try {
      const res = await probeError({
        url: apiUrlOf(firstApi), method: 'GET', fingerprint: group.fingerprint,
        orig_status: Number(firstApi.status) || undefined,
      });
      setProbe(res.data);
    } catch (e) {
      await appAlert(errMsg(e, '점검에 실패했습니다.'));
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">에러 발생 이력 — {group.count.toLocaleString()}건 · {group.users}명</h3>
        <div className="pre" style={{ marginBottom: 12 }}>{group.message || '(메시지 없음)'}</div>
        {firstApi && (
          <div style={{ marginBottom: 12 }}>
            <button className="btn btn--sm" disabled={probing} onClick={runProbe}>{probing ? '점검 중…' : '지금 서버 응답 점검'}</button>
            <span className="cell-sub" style={{ marginLeft: 8 }}>{apiUrlOf(firstApi)}</span>
            {probe && (
              <div className="cell-sub" style={{ marginTop: 6 }}>
                <VerdictBadge v={probe.verdict} /> 응답 {probe.status ?? '-'} · {probe.latency_ms ?? '-'}ms
                {probe.auth_required ? ' · 로그인 필요한 주소(비로그인으로 점검)' : ''}
              </div>
            )}
          </div>
        )}
        {!data ? <p className="cell-sub">로딩…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>시각</th><th>화면</th><th>요청</th></tr></thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{formatDate(e.created_at)}</td>
                    <td>{e.page || '-'}</td>
                    <td className="cell-sub" style={{ wordBreak: 'break-all' }}>
                      {e.api ? (typeof e.api === 'object' ? [e.api.method, apiUrlOf(e.api), e.api.status].filter(Boolean).join(' ') : String(e.api)) : '-'}
                      {e.stack && <details><summary>스택</summary><div className="pre">{e.stack}</div></details>}
                    </td>
                  </tr>
                ))}
                {data.events.length === 0 && <tr><td colSpan={3} className="td-empty">이력이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {(data?.pagination?.totalPages || 1) > 1 && (
          <div className="pagination">
            <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
            <span className="pagination__info">{page} / {data.pagination.totalPages}</span>
            <button className="btn btn--sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
          </div>
        )}
        <div className="modal__footer"><button className="btn" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

function Errors() {
  const [days, setDays] = useState(7);
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setGroups(null);
    setError('');
    getErrorGroups(days).then((r) => setGroups(r.data.errors || [])).catch((e) => setError(errMsg(e, '에러 목록을 불러오지 못했습니다.')));
  }, [days]);

  return (
    <>
      <div className="filters">
        <div className="filter-group">
          {[7, 30, 90].map((d) => (
            <button key={d} className={`filter-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>최근 {d}일</button>
          ))}
        </div>
        <span className="cell-sub">앱이 자동으로 보낸 에러를 같은 종류끼리 묶은 목록입니다.</span>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {!groups && !error ? <p className="loading">로딩 중…</p> : groups && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>에러</th><th>건수</th><th>사용자</th><th>마지막 발생</th><th>점검</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.fingerprint} className="row-click" onClick={() => setOpen(g)}>
                  <td style={{ minWidth: 220, wordBreak: 'break-word' }}>{(g.message || '(메시지 없음)').slice(0, 140)}<div className="cell-sub">{g.page}</div></td>
                  <td className="cell-main">{g.count.toLocaleString()}</td>
                  <td>{g.users}</td>
                  <td className="nowrap">{formatDate(g.last_seen)}</td>
                  <td>{g.last_probe ? <VerdictBadge v={g.last_probe.verdict} /> : <span className="cell-sub">-</span>}</td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td colSpan={5} className="td-empty">수집된 에러가 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {open && <ErrorHistoryModal group={open} days={days} onClose={() => setOpen(null)} />}
    </>
  );
}

export default function IssuesPage() {
  const [tab, setTab] = useState('inbox');
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => { getIssueSummary().then((r) => setSummary(r.data)).catch(() => {}); }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  return (
    <div>
      <h2 className="page-title">오류 신고</h2>
      {summary && (
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">미처리</span><span className={`stat-value ${summary.received > 0 ? 'warn' : ''}`}>{summary.received}</span></div>
          <div className="stat-card"><span className="stat-label">처리 중</span><span className="stat-value">{summary.in_progress}</span></div>
          <div className="stat-card"><span className="stat-label">오늘 접수</span><span className="stat-value">{summary.today}</span></div>
          <div className="stat-card"><span className="stat-label">최근 7일 완료</span><span className="stat-value">{summary.resolved_7d}</span></div>
        </div>
      )}
      <div className="tabs">
        <button className={`tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>사용자 신고</button>
        <button className={`tab ${tab === 'errors' ? 'active' : ''}`} onClick={() => setTab('errors')}>자동 수집 에러</button>
      </div>
      {tab === 'inbox' ? <Inbox onChanged={loadSummary} /> : <Errors />}
    </div>
  );
}
