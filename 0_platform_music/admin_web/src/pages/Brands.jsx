import { useState, useEffect, useCallback } from 'react';
import { getAdvertisers, getAdvertiser, setItemHidden } from '../api';
import AuthImage from '../components/AuthImage';
import { appPrompt, appAlert } from '../components/dialog';
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
        <h3 className="section-title">브랜드 정보</h3>
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

export default function BrandsPage() {
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
      <h2 className="page-title">브랜드 / 광고주</h2>

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
