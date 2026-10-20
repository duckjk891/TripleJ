import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listItemsRich, toggleItem, bulkItems, friendlyError, CATEGORIES, GENDERS, SORTS } from '../api';
import ItemImage from '../components/ItemImage';
import ItemDialog from '../components/ItemDialog';
import Icon from '../components/Icons';
import { fmt } from '../components/Charts';
import { appAlert, appConfirm, toast } from '../components/dialog';

const LIMIT = 40;
const STATUS = [
  { key: '', label: '모든 상태' },
  { key: 'active', label: '노출 중' },
  { key: 'inactive', label: '숨김' },
  { key: 'hidden', label: '운영 숨김' },
];
const VIEW_KEY = 'maidol_biz_items_view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; } };

export default function Items() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sub, setSub] = useState('');
  const [gender, setGender] = useState('');
  const [color, setColor] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [view, setView] = useState(readView);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [busyId, setBusyId] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const debounce = useRef(null);

  const filterBody = () => {
    const f = {};
    if (query) f.q = query;
    if (category) f.category = category;
    if (sub) f.sub = sub;
    if (gender) f.gender = gender;
    if (color) f.color = color;
    if (status) f.status = status;
    return f;
  };

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    return listItemsRich({ page, limit: LIMIT, sort, ...filterBody() })
      .then((res) => setData(res.data))
      .catch((err) => setError(friendlyError(err, '상품 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')))
      .finally(() => setLoading(false));
  }, [page, query, category, sub, gender, color, status, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  // 조건이 바뀌면 고른 것을 비운다(다른 목록의 상품이 몰래 선택돼 있지 않게)
  useEffect(() => { setSel(new Set()); setAllMatching(false); }, [query, category, sub, gender, color, status]);

  // 대시보드 '첫 상품 등록하기'에서 넘어온 경우 등록 창 열기
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing('new');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeView = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* 저장 못 해도 화면은 바뀜 */ } };
  const onSearch = (v) => {
    setQ(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(1); setQuery(v.trim()); }, 350);
  };
  const pickCategory = (c) => { setCategory(c); setSub(''); setPage(1); };
  const resetFilters = () => { setQ(''); setQuery(''); setCategory(''); setSub(''); setGender(''); setColor(''); setStatus(''); setPage(1); };

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
  const facets = data?.facets;
  const filtered = Boolean(query || category || sub || gender || color || status);
  const pageIds = items.map((it) => it.id);
  const pageAllOn = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const selCount = allMatching ? total : sel.size;

  const toggleSel = (id) => {
    setAllMatching(false);
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const togglePage = () => {
    setAllMatching(false);
    setSel((s) => { const n = new Set(s); if (pageAllOn) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  };
  const clearSel = () => { setSel(new Set()); setAllMatching(false); };

  const runBulk = async (action) => {
    const n = selCount;
    if (!n) return;
    const what = allMatching ? `지금 조건에 맞는 상품 ${n.toLocaleString()}개` : `고른 상품 ${n.toLocaleString()}개`;
    const msg = {
      show: `${what}를 착장 목록에 보이게 할까요?\n운영 정책으로 숨겨진 상품은 그대로 숨겨져 있어요.`,
      hide: `${what}를 착장 목록에서 숨길까요?\n언제든 다시 켤 수 있어요.`,
      delete: `${what}를 삭제할까요?\n삭제하면 되돌릴 수 없고, 지금까지의 성과도 더 볼 수 없어요. 잠시 빼 두려면 '숨기기'를 쓰세요.`,
    }[action];
    const ok = await appConfirm(msg, { okText: { show: '보이게 하기', hide: '숨기기', delete: '삭제' }[action], danger: action === 'delete' });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const body = allMatching ? { action, filter: filterBody() } : { action, ids: [...sel] };
      const res = await bulkItems(body);
      const changed = res.data?.changed ?? 0;
      const kept = res.data?.admin_hidden_kept ?? 0;
      clearSel();
      if (action === 'delete') toast(`${changed.toLocaleString()}개를 삭제했어요.`);
      else if (action === 'show') toast(kept ? `보이게 했어요. 운영 숨김 ${kept}개는 그대로예요.` : '착장 목록에 보이게 했어요.');
      else toast('착장 목록에서 숨겼어요.');
      if (action === 'delete' && page > 1 && changed >= items.length) setPage(1);
      else load();
    } catch (err) {
      appAlert(friendlyError(err, '바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBulkBusy(false);
    }
  };

  const subs = facets?.subs || [];
  const colors = facets?.colors || [];
  const catCount = (c) => (c ? facets?.categories?.[c] : counts?.all);

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>내 상품</h1>
          {counts && <p className="muted">{counts.all.toLocaleString()}개 · 노출 중 {counts.active.toLocaleString()}개{counts.hidden ? ` · 운영 숨김 ${counts.hidden}개` : ''}</p>}
        </div>
        <div className="row">
          <Link className="btn" to="/items/upload">엑셀로 한꺼번에 등록</Link>
          <button className="btn btn--primary" onClick={() => setEditing('new')}>+ 상품 등록</button>
        </div>
      </div>

      <div className="filters panel">
        <div className="filters__row">
          <input className="input input--search" placeholder="상품 이름·브랜드 검색" value={q} onChange={(e) => onSearch(e.target.value)} aria-label="상품 검색" />
          <select className="input input--sel" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="정렬">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div className="seg seg--icons" role="group" aria-label="보기 방식">
            <button className={view === 'grid' ? 'is-on' : ''} onClick={() => changeView('grid')} aria-label="사진으로 보기" title="사진으로 보기"><Icon name="grid" size={16} /></button>
            <button className={view === 'table' ? 'is-on' : ''} onClick={() => changeView('table')} aria-label="표로 보기" title="표로 보기"><Icon name="list" size={16} /></button>
          </div>
        </div>
        <div className="filters__row">
          <span className="filters__label">카테고리</span>
          <div className="chips" role="group" aria-label="카테고리">
            {['', ...CATEGORIES].map((c) => (
              <button key={c || 'all'} className={`chip ${category === c ? 'is-on' : ''}`} onClick={() => pickCategory(c)}>
                {c || '전체'}{catCount(c) != null && <em>{catCount(c).toLocaleString()}</em>}
              </button>
            ))}
          </div>
        </div>
        {category && subs.length > 0 && (
          <div className="filters__row">
            <span className="filters__label">세부 종류</span>
            <div className="chips" role="group" aria-label="세부 종류">
              <button className={`chip chip--sm ${sub === '' ? 'is-on' : ''}`} onClick={() => { setSub(''); setPage(1); }}>전체</button>
              {subs.map((s) => (
                <button key={s.key} className={`chip chip--sm ${sub === s.key ? 'is-on' : ''}`} onClick={() => { setSub(s.key); setPage(1); }}>
                  {s.key}<em>{s.count.toLocaleString()}</em>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="filters__row">
          <span className="filters__label">대상</span>
          <div className="chips" role="group" aria-label="대상">
            {['', ...GENDERS].map((g) => (
              <button key={g || 'all'} className={`chip chip--sm ${gender === g ? 'is-on' : ''}`} onClick={() => { setGender(g); setPage(1); }}>
                {g || '전체'}{g && facets?.genders?.[g] != null && <em>{facets.genders[g].toLocaleString()}</em>}
              </button>
            ))}
          </div>
        </div>
        <div className="filters__row">
          <span className="filters__label">노출</span>
          <div className="chips" role="group" aria-label="노출 상태">
            {STATUS.filter((s) => s.key !== 'hidden' || counts?.hidden).map((s) => (
              <button key={s.key || 'all'} className={`chip chip--sm ${status === s.key ? 'is-on' : ''}`} onClick={() => { setStatus(s.key); setPage(1); }}>{s.label}</button>
            ))}
          </div>
          {colors.length > 1 && (
            <select className="input input--sel input--sm" value={color} onChange={(e) => { setColor(e.target.value); setPage(1); }} aria-label="색상">
              <option value="">모든 색상</option>
              {colors.map((c) => <option key={c.key} value={c.key}>{c.key} ({c.count.toLocaleString()})</option>)}
            </select>
          )}
          {filtered && <button className="linkbtn" onClick={resetFilters}>조건 지우기</button>}
        </div>
      </div>

      {error && <div className="notice notice--err">{error}</div>}

      {items.length > 0 && (
        <div className={`bulkbar ${selCount ? 'is-on' : ''}`}>
          <label className="check check--sm">
            <input type="checkbox" checked={pageAllOn || allMatching} onChange={togglePage} />
            <span>이 쪽 {items.length}개 모두 고르기</span>
          </label>
          {selCount > 0 && (
            <>
              <b className="bulkbar__n">{selCount.toLocaleString()}개 고름</b>
              {!allMatching && pageAllOn && total > items.length && (
                <button className="linkbtn" onClick={() => setAllMatching(true)}>조건에 맞는 {total.toLocaleString()}개 모두 고르기</button>
              )}
              <span className="bulkbar__acts">
                <button className="btn btn--sm" disabled={bulkBusy} onClick={() => runBulk('show')}>보이게 하기</button>
                <button className="btn btn--sm" disabled={bulkBusy} onClick={() => runBulk('hide')}>숨기기</button>
                <button className="btn btn--sm btn--text-danger" disabled={bulkBusy} onClick={() => runBulk('delete')}>삭제</button>
                <button className="linkbtn" onClick={clearSel}>선택 해제</button>
              </span>
            </>
          )}
          {!selCount && <span className="muted small bulkbar__hint">{total.toLocaleString()}개 · 숫자는 최근 30일 기준</span>}
        </div>
      )}

      {loading && !data ? (
        <div className="grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 230 }} />)}</div>
      ) : items.length === 0 ? (
        <div className="empty panel">
          {filtered ? '조건에 맞는 상품이 없어요.' : '아직 등록한 상품이 없어요. 첫 상품을 등록하거나 엑셀로 한꺼번에 올려 보세요.'}
        </div>
      ) : view === 'table' ? (
        <div className={`panel table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="tbl tbl--items">
            <thead>
              <tr>
                <th className="tbl__chk"><input type="checkbox" checked={pageAllOn || allMatching} onChange={togglePage} aria-label="이 쪽 모두 고르기" /></th>
                <th>상품</th>
                <th>분류</th>
                <th className="num">착장 선택</th>
                <th className="num">클릭</th>
                <th className="num">클릭률</th>
                <th className="num">담김</th>
                <th>노출</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const on = it.is_active !== false && !it.admin_hidden;
                const st = it.stats || {};
                return (
                  <tr key={it.id} className={on ? '' : 'is-off'}>
                    <td className="tbl__chk"><input type="checkbox" checked={allMatching || sel.has(it.id)} onChange={() => toggleSel(it.id)} aria-label={`${it.name} 고르기`} /></td>
                    <td>
                      <button className="cell-item cell-item--btn" onClick={() => setEditing(it)}>
                        <ItemImage obj={it.image_object_name} className="thumb" />
                        <span>
                          <b title={it.name}>{it.name || '이름 없음'}</b>
                          <small>{[it.brand, it.color].filter(Boolean).join(' · ') || ' '}</small>
                        </span>
                      </button>
                    </td>
                    <td className="small">{it.category}{it.sub_category ? ` · ${it.sub_category}` : ''}<br /><span className="muted">{it.gender}</span></td>
                    <td className="num">{fmt(st.impressions)}</td>
                    <td className="num">{fmt(st.clicks)}</td>
                    <td className="num">{Number(st.ctr || 0).toFixed(1)}%</td>
                    <td className="num">{fmt(st.wishes)}</td>
                    <td>
                      <div className="row row--nowrap">
                        <ExposeSwitch it={it} on={on} busy={busyId === it.id} onToggle={onToggle} />
                        <Link to={`/items/${it.id}`} className="linkbtn small">성과</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`grid ${loading ? 'is-loading' : ''}`}>
          {items.map((it) => {
            const on = it.is_active !== false && !it.admin_hidden;
            const st = it.stats || {};
            const picked = allMatching || sel.has(it.id);
            return (
              <article className={`item ${on ? '' : 'item--off'} ${picked ? 'is-picked' : ''}`} key={it.id}>
                <label className="item__pick" title="고르기">
                  <input type="checkbox" checked={picked} onChange={() => toggleSel(it.id)} aria-label={`${it.name} 고르기`} />
                </label>
                <button className="item__img" onClick={() => setEditing(it)} aria-label={`${it.name} 수정`}>
                  <ItemImage obj={it.image_object_name} />
                </button>
                <div className="item__body">
                  <b title={it.name}>{it.name || '이름 없음'}</b>
                  <span>{[it.sub_category || it.category, it.gender, it.color].filter(Boolean).join(' · ')}</span>
                  <span className="item__stats">착장 {fmt(st.impressions)} · 클릭 {fmt(st.clicks)} · 담김 {fmt(st.wishes)}</span>
                </div>
                <div className="item__foot">
                  <Link to={`/items/${it.id}`} className="linkbtn small">성과 보기</Link>
                  <ExposeSwitch it={it} on={on} busy={busyId === it.id} onToggle={onToggle} />
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

function ExposeSwitch({ it, on, busy, onToggle }) {
  return (
    <label className={`switch ${it.admin_hidden ? 'is-locked' : ''}`} title={it.admin_hidden ? '운영 정책으로 숨겨진 상품' : on ? '노출 중' : '숨김'}>
      <span className="small">{it.admin_hidden ? '운영 숨김' : on ? '노출' : '숨김'}</span>
      <input type="checkbox" checked={on} disabled={busy} onChange={() => onToggle(it)} aria-label="착장 목록 노출" />
      <i />
    </label>
  );
}
