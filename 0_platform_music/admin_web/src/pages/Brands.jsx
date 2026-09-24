import { useState, useEffect, useCallback } from 'react';
import {
  getAdvertisers, getAdvertiser, setItemHidden,
  getBrands, setBrandHidden, renameBrand, getItems,
} from '../api';
import AuthImage from '../components/AuthImage';
import { appPrompt, appAlert, appConfirm } from '../components/dialog';
import { formatDate } from './Dashboard';

const DAYS_OPTS = [
  { value: '7', label: '7일' },
  { value: '30', label: '30일' },
  { value: '90', label: '90일' },
];

function AdvertiserDetail({ userId, days, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const fetchDetail = useCallback(() => {
    getAdvertiser(userId, { days })
      .then((res) => setData(res.data))
      .catch(() => setError('광고주 정보를 불러오지 못했습니다.'));
  }, [userId, days]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleHidden = async (item) => {
    const toHide = !item.admin_hidden;
    let reason = '';
    if (toHide) {
      reason = (await appPrompt('숨김 사유 (감사 로그용, 생략 가능):')) || '';
    }
    try {
      await setItemHidden(item.item_id, toHide, reason);
      fetchDetail();
    } catch (err) {
      await appAlert(err.response?.data?.error || '숨김 설정에 실패했습니다.');
    }
  };

  if (error) return <div><button className="btn" onClick={onBack}>← 목록으로</button><p className="error-msg">{error}</p></div>;
  if (!data) return <div className="loading">로딩 중…</div>;

  const a = data.advertiser || {};
  const p = data.profile;
  const s = data.summary || {};

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button className="btn" onClick={onBack}>← 목록으로</button>
        <h2 className="page-title" style={{ margin: 0 }}>
          {p?.company_name || a.nickname}
          {a.is_banned && <span className="badge badge--red" style={{ marginLeft: 8 }}>정지</span>}
        </h2>
      </div>

      <div className="card">
        <h3 className="section-title">광고주 정보</h3>
        <table style={{ maxWidth: 640 }}>
          <tbody>
            <tr><td className="cell-sub" style={{ width: 110 }}>회사명</td><td>{p?.company_name || '-'}</td>
                <td className="cell-sub" style={{ width: 110 }}>업종</td><td>{p?.industry || '-'}</td></tr>
            <tr><td className="cell-sub">담당자</td><td>{p?.contact_name || '-'}</td>
                <td className="cell-sub">연락처</td><td>{p?.contact_phone || '-'}</td></tr>
            <tr><td className="cell-sub">계정</td><td>{a.nickname} ({a.email})</td>
                <td className="cell-sub">가입일</td><td>{formatDate(a.created_at)}</td></tr>
          </tbody>
        </table>
        {!p && <p className="cell-sub" style={{ marginTop: 8 }}>비즈니스 프로필 미등록 계정입니다.</p>}
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">착장 선택 (노출, {data.days}일)</span><span className="stat-value">{(s.impressions ?? 0).toLocaleString()}</span></div>
        <div className="stat-card"><span className="stat-label">클릭 ({data.days}일)</span><span className="stat-value">{(s.clicks ?? 0).toLocaleString()}</span></div>
        <div className="stat-card"><span className="stat-label">CTR</span><span className="stat-value">{s.ctr ?? 0}%</span></div>
        <div className="stat-card"><span className="stat-label">위시 담김 (현재)</span><span className="stat-value">{(s.wishes ?? 0).toLocaleString()}</span></div>
      </div>

      <div className="card">
        <h3 className="section-title">아이템 ({(data.items || []).length}건)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>이미지</th><th>이름</th><th>분류</th><th>클릭(누적)</th><th>담김</th><th>상태</th><th>등록일</th><th>액션</th></tr>
            </thead>
            <tbody>
              {(data.items || []).map((it) => (
                <tr key={it.item_id}>
                  <td><AuthImage objectName={it.image_object_name} alt={it.name} /></td>
                  <td>
                    <div className="cell-main">{it.name}</div>
                    {it.product_url && (
                      <a href={it.product_url} target="_blank" rel="noreferrer" className="cell-sub" style={{ color: 'var(--primary)' }}>상품 링크 ↗</a>
                    )}
                  </td>
                  <td>{it.category} · {it.gender}</td>
                  <td>{(it.clicks ?? 0).toLocaleString()}</td>
                  <td>{(it.wish ?? 0).toLocaleString()}</td>
                  <td>
                    {it.admin_hidden
                      ? <span className="badge badge--red" title={it.admin_hidden_at ? `숨김: ${formatDate(it.admin_hidden_at)}` : ''}>숨김</span>
                      : it.is_active
                        ? <span className="badge badge--green">노출</span>
                        : <span className="badge badge--gray">비활성</span>}
                  </td>
                  <td className="nowrap">{formatDate(it.created_at)}</td>
                  <td>
                    <button className="btn btn--sm" onClick={() => handleHidden(it)}>
                      {it.admin_hidden ? '숨김 해제' : '숨김'}
                    </button>
                  </td>
                </tr>
              ))}
              {(data.items || []).length === 0 && <tr><td colSpan={8} className="td-empty">등록된 아이템이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdvertisersView() {
  const [summary, setSummary] = useState(null);
  const [advertisers, setAdvertisers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState('30');
  const [selected, setSelected] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdvertisers({ q, days });
      setSummary(res.data.summary || null);
      setAdvertisers(res.data.advertisers || []);
    } catch {
      setError('광고주 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [q, days]);

  useEffect(() => { if (!selected) fetchList(); }, [fetchList, selected]);

  if (selected) {
    return <AdvertiserDetail userId={selected} days={days} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
            {summary && (
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">광고주 계정</span><span className="stat-value">{summary.advertisers.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">전체 아이템</span><span className="stat-value">{summary.items.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">노출 중 아이템</span><span className="stat-value">{summary.active_items.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">클릭 ({days}일)</span><span className="stat-value">{summary.clicks.toLocaleString()}</span></div>
        </div>
      )}

      <div className="filters">
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); fetchList(); }}>
          <input className="input" type="text" placeholder="회사명·닉네임 검색"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" type="submit">검색</button>
        </form>
        <div className="filter-group">
          {DAYS_OPTS.map((o) => (
            <button key={o.value} className={`filter-btn ${days === o.value ? 'active' : ''}`}
              onClick={() => setDays(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>브랜드(회사명)</th><th>아이템 (노출중)</th><th>착장 선택</th><th>클릭</th><th>CTR</th><th>담김</th><th>상태</th><th>가입일</th></tr>
            </thead>
            <tbody>
              {advertisers.map((a) => (
                <tr key={a.user_id} style={{ cursor: 'pointer' }} onClick={() => setSelected(a.user_id)}>
                  <td>
                    <div className="cell-main">{a.company_name || a.nickname}</div>
                    {a.company_name && <div className="cell-sub">{a.nickname}</div>}
                  </td>
                  <td>{a.item_count} ({a.active_count})</td>
                  <td>{a.impressions.toLocaleString()}</td>
                  <td>{a.clicks.toLocaleString()}</td>
                  <td>{a.ctr}%</td>
                  <td>{a.wish.toLocaleString()}</td>
                  <td>
                    {a.is_banned
                      ? <span className="badge badge--red">정지</span>
                      : <span className="badge badge--green">{a.account_status || 'active'}</span>}
                  </td>
                  <td className="nowrap">{formatDate(a.created_at)}</td>
                </tr>
              ))}
              {advertisers.length === 0 && <tr><td colSpan={8} className="td-empty">광고주가 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 브랜드별 (ad_items.brand 기준) — 한 계정 아래 여러 브랜드가 등록돼도 브랜드 단위로 본다
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

function BrandDetail({ brand: initialBrand, days, onBack }) {
  const [brand, setBrand] = useState(initialBrand.brand);
  const [meta, setMeta] = useState(initialBrand);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getItems({ brand, page, limit: 20 });
      setItems(res.data.items || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [brand, page]);

  const refreshMeta = useCallback(async (name) => {
    try {
      const res = await getBrands({ days });
      const found = (res.data.brands || []).find((b) => b.brand === name);
      if (found) setMeta(found);
    } catch { /* 목록 갱신 실패는 치명적이지 않음 */ }
  }, [days]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleBulkHidden = async (hidden) => {
    const n = meta.item_count;
    let reason = '';
    if (hidden) {
      const r = await appPrompt(`"${brand}" 브랜드 아이템 ${n}건을 모두 숨깁니다.\n숨김 사유 (감사 로그용, 생략 가능):`);
      if (r === null) return;
      reason = r;
    } else if (!(await appConfirm(`"${brand}" 브랜드 아이템 ${n}건의 숨김을 모두 해제할까요?`))) {
      return;
    }
    setBusy(true);
    try {
      const res = await setBrandHidden(brand, hidden, reason);
      await appAlert(`${res.data.matched}건 ${hidden ? '숨김' : '숨김 해제'} 처리했습니다.`);
      await Promise.all([fetchItems(), refreshMeta(brand)]);
    } catch (err) {
      await appAlert(err.response?.data?.error || '처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    const next = await appPrompt(`"${brand}" 브랜드명을 변경합니다 (아이템 ${meta.item_count}건 일괄).\n이미 있는 브랜드명을 입력하면 그 브랜드로 합쳐집니다.`, brand);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === brand) return;
    setBusy(true);
    try {
      const res = await renameBrand(brand, trimmed);
      await appAlert(`${res.data.matched}건의 브랜드명을 "${trimmed}"(으)로 변경했습니다.`);
      setBrand(trimmed);
      setPage(1);
      await refreshMeta(trimmed);
    } catch (err) {
      await appAlert(err.response?.data?.error || '브랜드명 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleItemHidden = async (item) => {
    const toHide = !item.admin_hidden;
    let reason = '';
    if (toHide) reason = (await appPrompt('숨김 사유 (감사 로그용, 생략 가능):')) || '';
    try {
      await setItemHidden(item.id, toHide, reason);
      await Promise.all([fetchItems(), refreshMeta(brand)]);
    } catch (err) {
      await appAlert(err.response?.data?.error || '숨김 설정에 실패했습니다.');
    }
  };

  const allHidden = meta.item_count > 0 && meta.hidden_count === meta.item_count;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 목록으로</button>
        <h2 className="page-title" style={{ margin: 0 }}>{brand}</h2>
        <div className="actions" style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={handleRename} disabled={busy}>브랜드명 변경</button>
          {allHidden
            ? <button className="btn" onClick={() => handleBulkHidden(false)} disabled={busy}>전체 숨김 해제</button>
            : <button className="btn btn--danger" onClick={() => handleBulkHidden(true)} disabled={busy}>전체 숨김</button>}
          {!allHidden && meta.hidden_count > 0 && (
            <button className="btn" onClick={() => handleBulkHidden(false)} disabled={busy}>숨김 {meta.hidden_count}건 해제</button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">아이템</span><span className="stat-value">{meta.item_count.toLocaleString()}</span></div>
        <div className="stat-card"><span className="stat-label">노출 중</span><span className="stat-value">{meta.active_count.toLocaleString()}</span></div>
        <div className="stat-card"><span className="stat-label">착장 선택 ({days}일)</span><span className="stat-value">{meta.impressions.toLocaleString()}</span></div>
        <div className="stat-card"><span className="stat-label">클릭 ({days}일)</span><span className="stat-value">{meta.clicks.toLocaleString()}</span></div>
        <div className="stat-card"><span className="stat-label">CTR</span><span className="stat-value">{meta.ctr}%</span></div>
        <div className="stat-card"><span className="stat-label">위시 담김</span><span className="stat-value">{meta.wish.toLocaleString()}</span></div>
      </div>

      <div className="card">
        <p className="cell-sub">
          카테고리: {Object.entries(meta.categories || {}).map(([c, n]) => `${c} ${n}`).join(' · ') || '-'}
          {'  ·  '}등록 계정: {(meta.owners || []).join(', ') || '-'}
          {meta.last_added && <>{'  ·  '}최근 등록: {formatDate(meta.last_added)}</>}
        </p>
      </div>

      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>이미지</th><th>이름</th><th>분류</th><th>가격</th><th>상태</th><th>등록일</th><th>액션</th></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><AuthImage objectName={it.image_object_name} alt={it.name} /></td>
                    <td>
                      <div className="cell-main">{it.name}</div>
                      {it.product_url && (
                        <a href={it.product_url} target="_blank" rel="noreferrer" className="cell-sub" style={{ color: 'var(--primary)' }}>상품 링크 ↗</a>
                      )}
                    </td>
                    <td className="nowrap">{it.category} · {it.gender}</td>
                    <td className="nowrap">{it.price_krw ? `${it.price_krw.toLocaleString()}원` : '-'}</td>
                    <td>
                      {it.admin_hidden
                        ? <span className="badge badge--red">숨김</span>
                        : it.is_active !== false
                          ? <span className="badge badge--green">노출</span>
                          : <span className="badge badge--gray">비활성</span>}
                    </td>
                    <td className="nowrap">{formatDate(it.created_at)}</td>
                    <td>
                      <button className="btn btn--sm" onClick={() => handleItemHidden(it)}>
                        {it.admin_hidden ? '숨김 해제' : '숨김'}
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={7} className="td-empty">아이템이 없습니다</td></tr>}
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
    </div>
  );
}

const SORTS = [
  { value: 'clicks', label: '클릭순' },
  { value: 'items', label: '아이템순' },
  { value: 'name', label: '이름순' },
  { value: 'recent', label: '최근 등록순' },
];

function BrandsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState('30');
  const [sort, setSort] = useState('clicks');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getBrands({ days });
      setData(res.data);
    } catch {
      setError('브랜드 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { if (!selected) fetchList(); }, [fetchList, selected]);

  if (selected) {
    return <BrandDetail brand={selected} days={days} onBack={() => setSelected(null)} />;
  }

  const needle = q.trim().toLowerCase();
  const filtered = (data?.brands || [])
    .filter((b) => !needle || b.brand.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === 'items') return b.item_count - a.item_count;
      if (sort === 'name') return a.brand.localeCompare(b.brand, 'ko');
      if (sort === 'recent') return (b.last_added || '').localeCompare(a.last_added || '');
      return (b.clicks - a.clicks) || (b.impressions - a.impressions) || (b.item_count - a.item_count);
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const rows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const s = data?.summary;

  return (
    <div>
      {s && (
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">브랜드</span><span className="stat-value">{s.brands.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">전체 아이템</span><span className="stat-value">{s.items.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">착장 선택 ({days}일)</span><span className="stat-value">{s.impressions.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">클릭 ({days}일)</span><span className="stat-value">{s.clicks.toLocaleString()}</span></div>
        </div>
      )}

      <div className="filters">
        <input className="input" type="text" placeholder="브랜드명 검색"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="filter-group">
          {DAYS_OPTS.map((o) => (
            <button key={o.value} className={`filter-btn ${days === o.value ? 'active' : ''}`}
              onClick={() => setDays(o.value)}>{o.label}</button>
          ))}
        </div>
        {needle && <span className="cell-sub">{filtered.length}개 브랜드</span>}
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>브랜드</th><th>아이템 (노출중)</th><th>카테고리</th><th>착장 선택</th><th>클릭</th><th>CTR</th><th>담김</th><th>등록 계정</th><th>최근 등록</th></tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.brand} style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                    <td className="cell-main">
                      {b.brand}
                      {b.hidden_count > 0 && <span className="badge badge--red" style={{ marginLeft: 6 }}>숨김 {b.hidden_count}</span>}
                    </td>
                    <td>{b.item_count} ({b.active_count})</td>
                    <td className="cell-sub">{Object.entries(b.categories || {}).map(([c, n]) => `${c} ${n}`).join(' · ')}</td>
                    <td>{b.impressions.toLocaleString()}</td>
                    <td>{b.clicks.toLocaleString()}</td>
                    <td>{b.ctr}%</td>
                    <td>{b.wish.toLocaleString()}</td>
                    <td className="cell-sub">{(b.owners || []).join(', ')}</td>
                    <td className="nowrap">{formatDate(b.last_added)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="td-empty">브랜드가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn--sm" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button>
              <span className="pagination__info">{curPage} / {totalPages}</span>
              <button className="btn btn--sm" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>다음</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function BrandsPage() {
  const [tab, setTab] = useState('brands');
  return (
    <div>
      <h2 className="page-title">브랜드 / 광고주</h2>
      <div className="filters">
        <div className="filter-group">
          <button className={`filter-btn ${tab === 'brands' ? 'active' : ''}`} onClick={() => setTab('brands')}>브랜드별</button>
          <button className={`filter-btn ${tab === 'advertisers' ? 'active' : ''}`} onClick={() => setTab('advertisers')}>광고주 계정별</button>
        </div>
      </div>
      {tab === 'brands' ? <BrandsView /> : <AdvertisersView />}
    </div>
  );
}
