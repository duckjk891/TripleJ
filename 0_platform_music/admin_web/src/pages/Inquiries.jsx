import { useState, useEffect, useCallback } from 'react';
import { getInquiries, updateInquiry } from '../api';
import { appAlert } from '../components/dialog';
import { formatDate } from './Dashboard';

// v3.379 — 광고주 사이트(business.maidol.ai.kr) 입점·광고 문의함. 1년 지나면 서버가 자동 삭제.
const STATUS_OPTS = [
  { value: 'new', label: '새 문의' },
  { value: 'done', label: '처리 완료' },
  { value: 'all', label: '전체' },
];
const LIMIT = 30;

export default function Inquiries() {
  const [status, setStatus] = useState('new');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getInquiries({ status, page, limit: LIMIT });
      setData(res.data);
    } catch {
      setError('문의 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openItem = (it) => { setOpen(it); setMemo(it.memo || ''); };

  const save = async (nextStatus) => {
    setBusy(true);
    try {
      const body = { memo };
      if (nextStatus) body.status = nextStatus;
      await updateInquiry(open.id, body);
      setOpen(null);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / LIMIT));

  return (
    <div>
      <h2 className="page-title">광고 문의</h2>
      <p className="cell-sub" style={{ marginBottom: 14 }}>
        광고주 사이트 <a href="https://business.maidol.ai.kr" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>business.maidol.ai.kr</a> 의 입점·광고 문의 양식으로 들어온 내용입니다. 답장은 문의자 이메일로 직접 보내고, 계정이 필요하면 '브랜드/광고주 → 광고주 계정별'에서 만들어 주세요. 문의는 1년 뒤 자동으로 지워집니다.
      </p>

      <div className="filters">
        <div className="filter-group">
          {STATUS_OPTS.map((o) => (
            <button key={o.value} className={`filter-btn ${status === o.value ? 'active' : ''}`} onClick={() => { setStatus(o.value); setPage(1); }}>
              {o.label}{o.value === 'new' && data?.new_count ? ` (${data.new_count})` : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>접수</th><th>회사</th><th>담당자</th><th>내용</th><th>상태</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => openItem(it)}>
                  <td className="nowrap">{formatDate(it.created_at)}</td>
                  <td><div className="cell-main">{it.company}</div>{it.channel_url && <div className="cell-sub">{it.channel_url}</div>}</td>
                  <td><div>{it.contact_name}</div><div className="cell-sub">{it.email}</div></td>
                  <td style={{ maxWidth: 360 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.message}</div></td>
                  <td>{it.status === 'done' ? <span className="badge badge--gray">처리 완료</span> : <span className="badge badge--red">새 문의</span>}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="td-empty">문의가 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', marginTop: 14 }}>
          <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
          <span className="cell-sub">{page} / {pages}</span>
          <button className="btn btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}

      {open && (
        <div className="modal-overlay" onClick={() => !busy && setOpen(null)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">{open.company}</h3>
            <table style={{ width: '100%', marginBottom: 12 }}>
              <tbody>
                <tr><td className="cell-sub" style={{ width: 110 }}>담당자</td><td>{open.contact_name}</td></tr>
                <tr><td className="cell-sub">이메일</td><td><a href={`mailto:${open.email}`} style={{ color: 'var(--primary)' }}>{open.email}</a></td></tr>
                {open.phone && <tr><td className="cell-sub">연락처</td><td>{open.phone}</td></tr>}
                {open.channel_url && <tr><td className="cell-sub">판매 채널</td><td style={{ wordBreak: 'break-all' }}>{open.channel_url}</td></tr>}
                <tr><td className="cell-sub">접수</td><td>{formatDate(open.created_at)}</td></tr>
              </tbody>
            </table>
            <div className="card" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 12 }}>{open.message}</div>
            <div className="form-row">
              <label>내부 메모 (문의자에게 보이지 않음)</label>
              <textarea className="input" rows={3} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} style={{ height: 'auto', padding: 10 }} />
            </div>
            <div className="modal__footer">
              <button className="btn" disabled={busy} onClick={() => setOpen(null)}>닫기</button>
              <button className="btn" disabled={busy} onClick={() => save(null)}>메모 저장</button>
              {open.status === 'done'
                ? <button className="btn" disabled={busy} onClick={() => save('new')}>새 문의로 되돌리기</button>
                : <button className="btn btn--primary" disabled={busy} onClick={() => save('done')}>처리 완료</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
