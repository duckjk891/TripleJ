import { useState, useEffect, useCallback } from 'react';
import { getReports, actOnReport, fetchEvidenceBlob } from '../api';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';

const STATUS_TABS = [
  { value: 'pending', label: '대기' },
  { value: 'actioned', label: '처리됨' },
  { value: 'dismissed', label: '기각' },
  { value: 'all', label: '전체' },
];

const REASON_LABELS = {
  sexual: '성적 콘텐츠',
  hate: '혐오/차별',
  violence: '폭력',
  spam: '스팸',
  copyright: '저작권',
  privacy: '개인정보',
  etc: '기타',
};

function targetSummary(r) {
  const t = r.target || {};
  if (t.deleted) return <span className="badge badge--gray">삭제된 대상</span>;
  if (r.target_type === 'track') return <>{t.title || '-'} <div className="cell-sub">by {t.uploader_nickname || '-'}</div></>;
  if (r.target_type === 'feed') return <>{t.text_excerpt || `(${t.kind || 'feed'})`} <div className="cell-sub">by {t.author_nickname || '-'}</div></>;
  if (r.target_type === 'comment') return <>{t.text || '-'} <div className="cell-sub">by {t.author_nickname || '-'}</div></>;
  return '-';
}

function EvidenceModal({ report, onClose }) {
  const items = report.evidence?.items || [];
  const [urls, setUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    const created = [];
    items.forEach((_, idx) => {
      fetchEvidenceBlob(report.id, idx)
        .then((res) => {
          if (cancelled) return;
          const u = URL.createObjectURL(res.data);
          created.push(u);
          setUrls((prev) => ({ ...prev, [idx]: u }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">증거 자료 — {report.reason_code}</h3>
        {report.reason_text && <p style={{ marginBottom: 12 }}>{report.reason_text}</p>}
        {items.length === 0 && <p className="cell-sub">첨부된 증거 파일이 없습니다.</p>}
        <div className="evidence-grid">
          {items.map((it, idx) => (
            <div key={idx}>
              {urls[idx]
                ? <img src={urls[idx]} alt={`evidence-${idx}`} />
                : <div className="thumb thumb--placeholder" style={{ width: 120, height: 120 }}>로딩…</div>}
              <div className="cell-sub">{it.kind || `항목 ${idx + 1}`}</div>
            </div>
          ))}
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [evidenceOf, setEvidenceOf] = useState(null);
  const [busy, setBusy] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getReports({ status, page, limit: 20 });
      setReports(res.data.reports || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('신고 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const doAction = async (report, action, label) => {
    if (!(await appConfirm(`이 신고를 "${label}" 처리하시겠습니까?`))) return;
    setBusy(report.id);
    try {
      await actOnReport(report.id, action);
      await fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '처리에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const actionButtons = (r) => {
    const disabled = busy === r.id;
    if (r.status === 'pending') {
      const btns = [];
      if (r.target_type === 'comment') {
        btns.push(<button key="del" className="btn btn--sm btn--danger" disabled={disabled} onClick={() => doAction(r, 'delete', '댓글 삭제')}>삭제</button>);
      } else {
        btns.push(<button key="blind" className="btn btn--sm" disabled={disabled} onClick={() => doAction(r, 'blind', '블라인드')}>블라인드</button>);
        btns.push(<button key="cdel" className="btn btn--sm btn--danger" disabled={disabled} onClick={() => doAction(r, 'confirm_delete', '확정 삭제(완전 파기)')}>확정 삭제</button>);
      }
      btns.push(<button key="dis" className="btn btn--sm" disabled={disabled} onClick={() => doAction(r, 'dismiss', '기각')}>기각</button>);
      return btns;
    }
    if (r.status === 'actioned' && r.action === 'blind') {
      return [<button key="res" className="btn btn--sm" disabled={disabled} onClick={() => doAction(r, 'restore', '블라인드 복원')}>복원</button>];
    }
    return null;
  };

  return (
    <div>
      <h2 className="page-title">신고 처리</h2>

      <div className="filters">
        <div className="filter-group">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              className={`filter-btn ${status === t.value ? 'active' : ''}`}
              onClick={() => { setStatus(t.value); setPage(1); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>접수일</th><th>사유</th><th>대상</th><th>신고자</th><th>소명</th><th>상태</th><th>액션</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{formatDate(r.created_at)}</td>
                    <td>
                      {r.urgent && <span className="badge badge--red">긴급</span>}{' '}
                      <span className="cell-main">{REASON_LABELS[r.reason_code] || r.reason_code}</span>
                      {r.reason_text && <div className="cell-sub">{r.reason_text.slice(0, 60)}</div>}
                      {(r.evidence?.items?.length > 0) && (
                        <button className="btn btn--sm" style={{ marginTop: 4 }} onClick={() => setEvidenceOf(r)}>
                          증거 {r.evidence.items.length}건
                        </button>
                      )}
                    </td>
                    <td>
                      <span className="badge badge--gray">{r.target_type}</span>
                      <div style={{ marginTop: 4 }}>{targetSummary(r)}</div>
                    </td>
                    <td>{r.reporter_nickname || '-'}</td>
                    <td>{r.appeal ? <span title={r.appeal.text}>{r.appeal.text.slice(0, 40)}…</span> : '-'}</td>
                    <td>
                      {r.status === 'pending' && <span className="badge badge--amber">대기</span>}
                      {r.status === 'actioned' && <span className="badge badge--green">{r.action}{r.resolution ? ` (${r.resolution})` : ''}</span>}
                      {r.status === 'dismissed' && <span className="badge badge--gray">기각{r.resolution ? ` (${r.resolution})` : ''}</span>}
                      {r.handled_by_nickname && <div className="cell-sub">by {r.handled_by_nickname}</div>}
                    </td>
                    <td><div className="actions">{actionButtons(r)}</div></td>
                  </tr>
                ))}
                {reports.length === 0 && <tr><td colSpan={7} className="td-empty">신고가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
              <span className="pagination__info">{page} / {totalPages}</span>
              <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
            </div>
          )}
        </>
      )}

      {evidenceOf && <EvidenceModal report={evidenceOf} onClose={() => setEvidenceOf(null)} />}
    </div>
  );
}
