import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listItems, toggleItem, friendlyError, CATEGORIES } from '../api';
import ItemImage from '../components/ItemImage';
import ItemDialog from '../components/ItemDialog';
import { appAlert, toast } from '../components/dialog';

const LIMIT = 40;
const STATUS = [
  { key: '', label: '모든 상태' },
  { key: 'active', label: '노출 중' },
  { key: 'inactive', label: '숨김' },
  { key: 'hidden', label: '운영 숨김' },
];

export default function Items() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [busyId, setBusyId] = useState(null);
  const debounce = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const p = { page, limit: LIMIT };
    if (query) p.q = query;
    if (category) p.category = category;
    if (status) p.status = status;
    return listItems(p)
      .then((res) => setData(res.data))
      .catch((err) => setError(friendlyError(err, '상품 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')))
      .finally(() => setLoading(false));
  }, [page, query, category, status]);

  useEffect(() => { load(); }, [load]);

  // 대시보드 '첫 상품 등록하기'에서 넘어온 경우 등록 창 열기
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing('new');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearch = (v) => {
    setQ(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(1); setQuery(v.trim()); }, 350);
  };

  const onToggle = async (it) => {
    if (it.admin_hidden) {
      appAlert('운영 정책으로 숨겨진 상품이라 노출을 켤 수 없어요. 자세한 내용은 MAIDOL 담당자에게 문의해 주세요.');
      return;
    }
    setBusyId(it.id);
    try {
      const res = await toggleItem(it.id);
      const on = Boolean(res.data?.is_active);
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, is_active: on } : x)) }));
      toast(on ? '착장 목록에 다시 보여요.' : '착장 목록에서 숨겼어요.');
      load();
    } catch (err) {
      appAlert(friendlyError(err, '바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusyId(null);
    }
  };

  const items = data?.items || [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const counts = data?.counts;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>내 상품</h1>
          {counts && <p className="muted">{counts.all.toLocaleString()}개 · 노출 중 {counts.active.toLocaleString()}개{counts.hidden ? ` · 운영 숨김 ${counts.hidden}개` : ''}</p>}
        </div>
        <button className="btn btn--primary" onClick={() => setEditing('new')}>+ 상품 등록</button>
      </div>

      <div className="tools">
        <input className="input input--search" placeholder="상품 이름·브랜드 검색" value={q} onChange={(e) => onSearch(e.target.value)} aria-label="상품 검색" />
        <div className="chips" role="group" aria-label="카테고리">
          {['', ...CATEGORIES].map((c) => (
            <button key={c || 'all'} className={`chip ${category === c ? 'is-on' : ''}`} onClick={() => { setCategory(c); setPage(1); }}>{c || '전체'}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="노출 상태">
          {STATUS.filter((s) => s.key !== 'hidden' || counts?.hidden).map((s) => (
            <button key={s.key || 'all'} className={`chip ${status === s.key ? 'is-on' : ''}`} onClick={() => { setStatus(s.key); setPage(1); }}>{s.label}</button>
          ))}
        </div>
      </div>

      {error && <div className="notice notice--err">{error}</div>}

      {loading && !data ? (
        <div className="grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div>
      ) : items.length === 0 ? (
        <div className="empty panel">
          {query || category || status ? '조건에 맞는 상품이 없어요.' : '아직 등록한 상품이 없어요. 첫 상품을 등록해 보세요.'}
        </div>
      ) : (
        <div className={`grid ${loading ? 'is-loading' : ''}`}>
          {items.map((it) => {
            const on = it.is_active !== false && !it.admin_hidden;
            return (
              <article className={`item ${on ? '' : 'item--off'}`} key={it.id}>
                <button className="item__img" onClick={() => setEditing(it)} aria-label={`${it.name} 수정`}>
                  <ItemImage obj={it.image_object_name} />
                </button>
                <div className="item__body">
                  <b title={it.name}>{it.name || '이름 없음'}</b>
                  <span>{[it.category, it.gender, it.color].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="item__foot">
                  <Link to={`/items/${it.id}`} className="linkbtn small">성과 보기</Link>
                  <label className={`switch ${it.admin_hidden ? 'is-locked' : ''}`} title={it.admin_hidden ? '운영 정책으로 숨겨진 상품' : on ? '노출 중' : '숨김'}>
                    <span className="small">{it.admin_hidden ? '운영 숨김' : on ? '노출' : '숨김'}</span>
                    <input type="checkbox" checked={on} disabled={busyId === it.id} onChange={() => onToggle(it)} aria-label="착장 목록 노출" />
                    <i />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="pager">
          <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
          <span>{page} / {pages}</span>
          <button className="btn btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}

      {editing && (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); toast(msg); load(); }}
        />
      )}
    </div>
  );
}
