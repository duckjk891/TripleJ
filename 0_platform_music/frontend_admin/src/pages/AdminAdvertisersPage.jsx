import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { getAdminAdvertisers } from '../api';
import './AdminAdvertisersPage.css';

// 광고주 관리 목록 (v184) — 요약 카드 4 + 검색(회사명·닉네임, 300ms 디바운스) + 테이블.
// 행 클릭 → /advertisers/:id 상세. 기간은 30일 고정(카드에 "최근 30일" 표기).
// 용어: impressions = "착장 선택", CTR = "클릭율" (금지어 미사용 관례 준수).
// 로그 prefix `[AdminAds]` — 회사명·닉네임·이메일 원문 콘솔 미출력(건수·status 만).

const DAYS = 30;
const DEBOUNCE_MS = 300;

// 확정 계약 — account_status/is_banned 로 상태 배지
function statusMeta(row) {
  if (row?.is_banned) return { label: '차단', cls: 'admin-badge--red' };
  if (row?.account_status && row.account_status !== 'active') return { label: row.account_status, cls: 'admin-badge--gray' };
  return { label: '활성', cls: 'admin-badge--green' };
}

export default function AdminAdvertisersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchList = useCallback(async (query) => {
    setLoading(true);
    setError('');
    if (import.meta.env.DEV) console.info('[AdminAds] loading advertisers', { q_len: (query || '').length, days: DAYS });
    try {
      const { data } = await getAdminAdvertisers(query, DAYS);
      const list = Array.isArray(data?.advertisers) ? data.advertisers : Array.isArray(data?.rows) ? data.rows : [];
      if (!Array.isArray(data?.advertisers) && !Array.isArray(data?.rows)) {
        console.warn('[AdminAds] unexpected list response shape', { keys: Object.keys(data || {}) });
      }
      setRows(list);
      setSummary(data?.summary || {});
      if (import.meta.env.DEV) console.info('[AdminAds] advertisers loaded', { count: list.length });
    } catch (err) {
      console.error('[AdminAds] getAdminAdvertisers failed', { status: err?.response?.status, message: err?.message });
      setError('광고주 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 검색 디바운스 — 300ms. 최초(빈 q)는 즉시.
  useEffect(() => {
    const query = q.trim();
    const timer = setTimeout(() => {
      fetchList(query);
    }, query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [q, fetchList]);

  const summaryCards = [
    { label: '광고주 수', value: summary?.advertisers ?? summary?.advertiser_count },
    { label: '등록 아이템', value: summary?.items ?? summary?.item_count },
    { label: '활성 아이템', value: summary?.active_items ?? summary?.active_count },
    { label: '최근 30일 클릭', value: summary?.clicks ?? summary?.click_count },
  ];

  return (
    <AdminLayout>
      <div className="admin-advertisers">
        <h2 className="admin-page-title">광고주 관리</h2>

        <div className="admin-advertisers__stats">
          {summaryCards.map((c) => (
            <div key={c.label} className="admin-advertisers__stat-card">
              <span className="admin-advertisers__stat-label">{c.label}</span>
              <span className="admin-advertisers__stat-value">{(c.value ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>

        <input
          type="text"
          className="admin-advertisers__search"
          placeholder="회사명 또는 닉네임으로 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {error ? (
          <div className="admin-error">
            <p>{error}</p>
            <button className="admin-btn admin-btn--small" onClick={() => fetchList(q.trim())}>재시도</button>
          </div>
        ) : loading ? (
          <p className="admin-loading">로딩 중...</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table--full">
              <thead>
                <tr>
                  <th>광고주</th>
                  <th>아이템(활성/전체)</th>
                  <th>착장 선택</th>
                  <th>클릭</th>
                  <th>클릭율</th>
                  <th>위시</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const st = statusMeta(row);
                  return (
                    <tr
                      key={row.user_id}
                      className="admin-advertisers__row"
                      onClick={() => navigate(`/advertisers/${row.user_id}`)}
                    >
                      <td>
                        {/* 확정 계약 — 광고주명: company_name(Mongo 정본) 우선, 없으면 닉네임 폴백. 부제 닉네임 */}
                        <span className="admin-advertisers__company">{row.company_name || row.nickname || '-'}</span>
                        <span className="admin-advertisers__nickname">{row.nickname || '-'}</span>
                      </td>
                      <td>{(row.active_count ?? 0).toLocaleString()} / {(row.item_count ?? 0).toLocaleString()}</td>
                      <td>{(row.impressions ?? 0).toLocaleString()}</td>
                      <td>{(row.clicks ?? 0).toLocaleString()}</td>
                      <td>{row.ctr ?? '0.00'}%</td>
                      <td>{(row.wish ?? 0).toLocaleString()}</td>
                      <td><span className={`admin-badge ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="admin-empty">광고주가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
