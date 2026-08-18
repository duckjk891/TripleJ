import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import {
  getAdminAdvertiserDetail,
  getAdminAdvertiserDashboard,
  getAdminAdvertiserItemStars,
  getAdminAdvertiserItemInsights,
  setAdminAdItemHidden,
} from '../api';
import { formatDate } from '../utils/format';
import { adminMediaSrc } from '../utils/media';
import './AdminAdvertiserDetailPage.css';

// 광고주 상세 (v184) — ④회사 정보(Mongo 정본+계정) ⑤플랜·과금(향후 자리) ⑥성과 요약(7/30/90일)
// ⑦등록 아이템(강제 숨김/해제 + 행 확장 스타별 성과·인사이트 — BusinessPage 패턴 포팅)
// ⑧광고주 화면 그대로(dashboard 재사용 — 기간 일간/주간/월간·카테고리·인증 필터, ⑥과 기간 규약 상이 표기).
// 용어: "착장 선택"/"클릭율". 로그 prefix `[AdminAds]` — 회사명·연락처·이메일·스타 닉네임 콘솔 미출력.

const DAY_OPTIONS = [7, 30, 90];
const PERIOD_OPTIONS = [
  { value: 'daily', label: '일간' },
  { value: 'weekly', label: '주간' },
  { value: 'monthly', label: '월간' },
];
const DASH_CATEGORY_OPTIONS = ['전체', '상의', '하의', '신발', '장소'];
const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const NATIONALITY_LABELS = { domestic: '내국인', foreign: '외국인' };
const INSIGHT_DIM_OPTIONS = [
  { key: 'genre', label: '장르별' },
  { key: 'mood', label: '느낌별' },
];
// ⑦ 행 확장 stars/insights 기준(고정) — ⑧ 컨트롤과 독립. 패널에 기준 라벨 표기.
const ITEM_PANEL_PERIOD = 'daily';

// 확정 계약 — 아이템 썸네일: 기존 admin 미디어 프록시 + 기성 adminMediaSrc(토큰 쿼리) 재사용
const adThumbSrc = (objectName) => adminMediaSrc(`/api/admin/media/${objectName}`);

// 확정 계약 — ⑦ 상태 3분류
function itemStatusMeta(item) {
  if (item?.admin_hidden) return { label: '숨김(관리자)', cls: 'admin-badge--red' };
  if (!item?.is_active) return { label: '비활성(광고주)', cls: 'admin-badge--gray' };
  return { label: '게재중', cls: 'admin-badge--green' };
}

export default function AdminAdvertiserDetailPage() {
  const { id } = useParams();

  // ④~⑦ 상세 (days 연동)
  const [days, setDays] = useState(30);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [hidingId, setHidingId] = useState(null); // 숨김 처리 중 아이템

  // ⑦ 행 확장 — BusinessPage 패턴 포팅(itemId별 {loading, error, data} 캐시)
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [starsState, setStarsState] = useState({});
  const [insightsState, setInsightsState] = useState({});
  const [insightDim, setInsightDim] = useState('genre');

  // ⑧ 대시보드 (기간 규약 별도: daily/weekly/monthly)
  const [period, setPeriod] = useState('daily');
  const [dashCategory, setDashCategory] = useState('전체');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [dash, setDash] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState('');

  const fetchDetail = useCallback(async (d) => {
    setDetailError('');
    if (import.meta.env.DEV) console.info('[AdminAds] loading advertiser detail', { days: d });
    try {
      const { data } = await getAdminAdvertiserDetail(id, d);
      setDetail(data || {});
      if (import.meta.env.DEV) console.info('[AdminAds] detail loaded', { items: (data?.items || []).length });
    } catch (err) {
      console.error('[AdminAds] getAdminAdvertiserDetail failed', { status: err?.response?.status, message: err?.message });
      setDetailError(err?.response?.status === 404 ? '광고주를 찾을 수 없습니다.' : '상세 정보를 불러오지 못했습니다.');
    }
  }, [id]);

  const fetchDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError('');
    if (import.meta.env.DEV) console.info('[AdminAds] loading dashboard', { period, dashCategory, verifiedOnly });
    try {
      const { data } = await getAdminAdvertiserDashboard(id, period, dashCategory, verifiedOnly);
      setDash(data || {});
      if (import.meta.env.DEV) console.info('[AdminAds] dashboard loaded', { items: (data?.items || []).length });
    } catch (err) {
      console.error('[AdminAds] getAdminAdvertiserDashboard failed', { status: err?.response?.status, message: err?.message });
      setDashError('대시보드 데이터를 불러오지 못했습니다.');
    } finally {
      setDashLoading(false);
    }
  }, [id, period, dashCategory, verifiedOnly]);

  useEffect(() => {
    // 기존 페이지 관행(fetch-in-effect)과 동일 패턴
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    fetchDetail(days);
  }, [days, fetchDetail]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboard();
  }, [fetchDashboard]);

  // ── ⑦ 행 확장 lazy load (BusinessPage 포팅 — 고정 기준 ITEM_PANEL_PERIOD·전체 회원) ──
  const fetchStars = useCallback(async (itemId) => {
    setStarsState((m) => ({ ...m, [itemId]: { loading: true } }));
    if (import.meta.env.DEV) console.info('[AdminAds] loading item stars', { period: ITEM_PANEL_PERIOD });
    try {
      const res = await getAdminAdvertiserItemStars(id, itemId, ITEM_PANEL_PERIOD, false);
      if (!Array.isArray(res.data?.stars)) {
        console.warn('[AdminAds] unexpected stars shape', { keys: Object.keys(res.data || {}) });
      }
      setStarsState((m) => ({ ...m, [itemId]: { loading: false, data: res.data } }));
      if (import.meta.env.DEV) console.info('[AdminAds] item stars loaded', { stars: res.data?.stars?.length ?? 0 });
    } catch (err) {
      console.error('[AdminAds] getAdminAdvertiserItemStars failed', { status: err?.response?.status, message: err?.message });
      setStarsState((m) => ({ ...m, [itemId]: { loading: false, error: true } }));
    }
  }, [id]);

  const fetchInsights = useCallback(async (itemId) => {
    setInsightsState((m) => ({ ...m, [itemId]: { loading: true } }));
    if (import.meta.env.DEV) console.info('[AdminAds] loading item insights', { period: ITEM_PANEL_PERIOD });
    try {
      const res = await getAdminAdvertiserItemInsights(id, itemId, ITEM_PANEL_PERIOD, false);
      setInsightsState((m) => ({ ...m, [itemId]: { loading: false, data: res.data } }));
      if (import.meta.env.DEV) {
        console.info('[AdminAds] item insights loaded', {
          by_genre: res.data?.by_genre?.length ?? 0,
          by_hour: res.data?.by_hour?.length ?? 0,
        });
      }
    } catch (err) {
      console.error('[AdminAds] getAdminAdvertiserItemInsights failed', { status: err?.response?.status, message: err?.message });
      setInsightsState((m) => ({ ...m, [itemId]: { loading: false, error: true } }));
    }
  }, [id]);

  const handleToggleExpand = (itemId) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      return;
    }
    setExpandedItemId(itemId);
    const cached = starsState[itemId];
    if (!cached || cached.error) fetchStars(itemId);
    const cachedInsights = insightsState[itemId];
    if (!cachedInsights || cachedInsights.error) fetchInsights(itemId);
  };

  // ── ⑦ 강제 숨김/해제 ──
  const handleToggleHidden = useCallback(async (item) => {
    if (hidingId) return;
    const nextHidden = !item.admin_hidden;
    const name = item.product_name || item.name || '(이름 없음)';
    const confirmed = window.confirm(
      nextHidden
        ? `"${name}" 아이템을 강제 숨김합니다.\n사용자 화면에서 즉시 제외되며, 광고주는 해제할 수 없습니다.\n진행하시겠습니까?`
        : `"${name}" 아이템의 강제 숨김을 해제합니다.\n광고주 활성 상태면 사용자 화면에 다시 포함됩니다.\n진행하시겠습니까?`
    );
    if (!confirmed) return;
    setHidingId(item.item_id);
    if (import.meta.env.DEV) console.info('[AdminAds] set item hidden', { hidden: nextHidden });
    try {
      await setAdminAdItemHidden(item.item_id, nextHidden);
      // 성공 → 상세 재조회(아이템 행·요약 동시 갱신)
      await fetchDetail(days);
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminAds] setAdminAdItemHidden failed', { status, hidden: nextHidden, message: err?.message });
      alert(status === 404 ? '아이템을 찾을 수 없습니다.' : '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setHidingId(null);
    }
  }, [hidingId, days, fetchDetail]);

  // ── 렌더 헬퍼 (BusinessPage renderStarsPanel/renderInsightsPanel 포팅) ──
  const renderStarsPanel = (itemId) => {
    const st = starsState[itemId];
    if (!st || st.loading) return <p className="admin-ads-detail__panel-status">스타 데이터 로딩 중...</p>;
    if (st.error) return <p className="admin-ads-detail__panel-status">스타별 성과를 불러오지 못했습니다.</p>;
    const stars = Array.isArray(st.data?.stars) ? st.data.stars : [];
    const untracked = st.data?.untracked_clicks ?? 0;
    return (
      <div className="admin-ads-detail__stars-box">
        <p className="admin-ads-detail__panel-basis">기준: 일간 · 전체 회원 (⑧ 대시보드 컨트롤과 독립)</p>
        {stars.length === 0 ? (
          <p className="admin-ads-detail__panel-status">집계된 스타 데이터가 없습니다.</p>
        ) : (
          <table className="admin-ads-detail__stars-table">
            <thead>
              <tr>
                <th>순위</th><th>스타</th><th>착장</th><th>위시</th><th>쇼핑몰 클릭</th><th>팔로워</th><th>재생수</th><th>반응률</th>
              </tr>
            </thead>
            <tbody>
              {stars.map((s, i) => (
                <tr key={s.user_id ?? i}>
                  <td>{i + 1}</td>
                  <td>{s.nickname || '-'}</td>
                  <td>{(s.worn_count ?? 0).toLocaleString()}</td>
                  <td>{(s.wish_count ?? 0).toLocaleString()}</td>
                  <td>{(s.click_count ?? 0).toLocaleString()}</td>
                  <td>{(s.follower_count ?? 0).toLocaleString()}</td>
                  <td>{(s.total_plays ?? 0).toLocaleString()}</td>
                  <td>{s.engagement_rate == null ? '-' : `${Number(s.engagement_rate).toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {untracked > 0 && (
          <p className="admin-ads-detail__panel-note">스타 미귀속 클릭 {untracked.toLocaleString()}건 (곡 페이지 외 경로)</p>
        )}
      </div>
    );
  };

  const renderInsightsPanel = (itemId) => {
    const st = insightsState[itemId];
    if (!st || st.loading) return <p className="admin-ads-detail__panel-status">인사이트 로딩 중...</p>;
    if (st.error) return <p className="admin-ads-detail__panel-status">인사이트를 불러오지 못했습니다.</p>;
    const ins = st.data || {};
    const conv = ins.wish_to_click || {};
    const dimSource = insightDim === 'genre' ? ins.by_genre : ins.by_mood;
    const dimRows = Array.isArray(dimSource) ? dimSource : [];
    const dimMax = Math.max(...dimRows.map((r) => Math.max(r.wishes || 0, r.clicks || 0)), 1);
    const byWeekday = Array.isArray(ins.by_weekday) ? ins.by_weekday : [];
    const weekdayMax = Math.max(...byWeekday.map((r) => r.count || 0), 1);
    const byHour = Array.isArray(ins.by_hour) ? ins.by_hour : [];
    const hourMax = Math.max(...byHour.map((r) => r.count || 0), 1);
    const demo = ins.demographics || {};
    const demoGroups = [
      { title: '연령대', rows: (Array.isArray(demo.age_bands) ? demo.age_bands : []).map((r) => ({ key: r.band, count: r.count })) },
      { title: '성별', rows: Array.isArray(demo.genders) ? demo.genders : [] },
      { title: '지역', rows: Array.isArray(demo.regions) ? demo.regions : [] },
      {
        title: '내/외국인',
        rows: (Array.isArray(demo.nationalities) ? demo.nationalities : []).map((r) => ({
          key: NATIONALITY_LABELS[r.key] || r.key,
          count: r.count,
        })),
      },
    ];
    return (
      <div className="admin-ads-detail__insights-box">
        <h5 className="admin-ads-detail__panel-title">인사이트</h5>
        <div className="admin-ads-detail__insights-conv">
          위시 {(conv.wishes ?? 0).toLocaleString()} → 클릭 {(conv.clicks ?? 0).toLocaleString()}
          {' '}(전환율 {conv.rate == null ? '측정불가' : `${conv.rate}%`})
        </div>

        <div className="admin-ads-detail__insights-dim-head">
          <div className="admin-ads-detail__dim-tabs">
            {INSIGHT_DIM_OPTIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`admin-ads-detail__dim-tab ${insightDim === d.key ? 'admin-ads-detail__dim-tab--active' : ''}`}
                onClick={() => setInsightDim(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="admin-ads-detail__legend">
            <span><i className="admin-ads-detail__dot admin-ads-detail__dot--wish" /> 위시</span>
            <span><i className="admin-ads-detail__dot admin-ads-detail__dot--click" /> 클릭</span>
          </div>
        </div>
        {dimRows.length === 0 ? (
          <p className="admin-ads-detail__panel-status">데이터가 없습니다</p>
        ) : (
          <div className="admin-ads-detail__hbars">
            {dimRows.map((r, i) => (
              <div key={r.key ?? i} className="admin-ads-detail__hrow">
                <span className="admin-ads-detail__hlabel">{r.key || '미입력'}</span>
                <div className="admin-ads-detail__htrack">
                  <div className="admin-ads-detail__hbar admin-ads-detail__hbar--wish" style={{ width: `${((r.wishes || 0) / dimMax) * 100}%` }} />
                  <div className="admin-ads-detail__hbar admin-ads-detail__hbar--click" style={{ width: `${((r.clicks || 0) / dimMax) * 100}%` }} />
                </div>
                <span className="admin-ads-detail__hvals">
                  {(r.wishes ?? 0).toLocaleString()} / {(r.clicks ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="admin-ads-detail__insights-charts">
          <div className="admin-ads-detail__insights-chart">
            <h6 className="admin-ads-detail__panel-subtitle">요일별</h6>
            {byWeekday.length === 0 ? (
              <p className="admin-ads-detail__panel-status">데이터가 없습니다</p>
            ) : (
              <div className="admin-ads-detail__vbars">
                {byWeekday.map((r, i) => (
                  <div key={r.weekday ?? i} className="admin-ads-detail__vwrap">
                    <span className="admin-ads-detail__vval">{r.count ?? 0}</span>
                    <div className="admin-ads-detail__vbar" style={{ height: `${((r.count || 0) / weekdayMax) * 100}%` }} />
                    <span className="admin-ads-detail__vlabel">{WEEKDAY_LABELS[r.weekday] ?? r.weekday}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="admin-ads-detail__insights-chart admin-ads-detail__insights-chart--hours">
            <h6 className="admin-ads-detail__panel-subtitle">시간대별</h6>
            {byHour.length === 0 ? (
              <p className="admin-ads-detail__panel-status">데이터가 없습니다</p>
            ) : (
              <div className="admin-ads-detail__vbars">
                {byHour.map((r, i) => (
                  <div key={r.hour ?? i} className="admin-ads-detail__vwrap admin-ads-detail__vwrap--hour" title={`${r.hour ?? i}시 ${r.count ?? 0}건`}>
                    <div className="admin-ads-detail__vbar" style={{ height: `${((r.count || 0) / hourMax) * 100}%` }} />
                    {/* 라벨 없는 칸도 nbsp 로 라인 높이 유지 — 공백 1개는 span 이 0 높이로 접혀 막대 기준선이 어긋남 */}
                    <span className="admin-ads-detail__vlabel">{(r.hour ?? i) % 3 === 0 ? `${r.hour ?? i}` : ' '}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="admin-ads-detail__demo">
          {demoGroups.map((g) => {
            const groupMax = Math.max(...g.rows.map((r) => r.count || 0), 1);
            return (
              <div key={g.title} className="admin-ads-detail__demo-col">
                <h6 className="admin-ads-detail__panel-subtitle">{g.title}</h6>
                {g.rows.length === 0 ? (
                  <p className="admin-ads-detail__panel-status">데이터가 없습니다</p>
                ) : (
                  g.rows.map((r, i) => (
                    <div key={r.key ?? i} className="admin-ads-detail__demo-row">
                      <span className="admin-ads-detail__demo-label">{r.key || '미입력'}</span>
                      <div className="admin-ads-detail__demo-track">
                        <div className="admin-ads-detail__demo-bar" style={{ width: `${((r.count || 0) / groupMax) * 100}%` }} />
                      </div>
                      <span className="admin-ads-detail__demo-count">{(r.count ?? 0).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 확정 계약 — advertiser(계정)/profile(Mongo 정본, null 가능 → "—" 폴백)/summary/items
  const profile = detail?.profile || {};
  const account = detail?.advertiser || {};
  const perf = detail?.summary || {};
  const items = Array.isArray(detail?.items) ? detail.items : [];

  return (
    <AdminLayout>
      <div className="admin-ads-detail">
        <div className="admin-ads-detail__head">
          <h2 className="admin-page-title">광고주 상세</h2>
          <Link to="/advertisers" className="admin-ads-detail__back">← 목록으로</Link>
        </div>

        {detailError ? (
          <div className="admin-error">
            <p>{detailError}</p>
            <button className="admin-btn admin-btn--small" onClick={() => fetchDetail(days)}>재시도</button>
          </div>
        ) : detail === null ? (
          <p className="admin-loading">로딩 중...</p>
        ) : (
          <>
            {/* ④ 회사 정보 — Mongo 프로필 정본 + 계정 */}
            <section className="admin-ads-detail__section">
              <h3 className="admin-ads-detail__section-title">회사 정보</h3>
              <div className="admin-ads-detail__info-grid">
                <div className="admin-ads-detail__info-col">
                  <dl>
                    <div><dt>회사명</dt><dd>{profile.company_name || '—'}</dd></div>
                    <div><dt>업종</dt><dd>{profile.industry || '—'}</dd></div>
                    <div><dt>담당자</dt><dd>{profile.contact_name || '—'}</dd></div>
                    <div><dt>연락처</dt><dd>{profile.contact_phone || '—'}</dd></div>
                  </dl>
                </div>
                <div className="admin-ads-detail__info-col">
                  <dl>
                    <div><dt>이메일</dt><dd>{account.email || '—'}</dd></div>
                    <div>
                      <dt>닉네임</dt>
                      <dd>
                        <Link to={`/users/${account.user_id || id}`} className="admin-ads-detail__link" title={String(account.user_id || id)}>
                          {account.nickname || '—'}
                        </Link>
                      </dd>
                    </div>
                    <div><dt>가입일</dt><dd>{account.created_at ? formatDate(account.created_at) : '—'}</dd></div>
                    <div>
                      <dt>상태</dt>
                      <dd>
                        <span className={`admin-badge ${account.is_banned ? 'admin-badge--red' : account.account_status && account.account_status !== 'active' ? 'admin-badge--gray' : 'admin-badge--green'}`}>
                          {account.is_banned ? '차단' : account.account_status && account.account_status !== 'active' ? account.account_status : '활성'}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </section>

            {/* ⑤ 플랜·과금 — 향후 자리 블록 */}
            <section className="admin-ads-detail__section">
              <h3 className="admin-ads-detail__section-title">
                플랜·과금
                <span className="admin-ads-detail__future-badge">향후</span>
              </h3>
              <div className="admin-ads-detail__info-grid">
                <div className="admin-ads-detail__info-col">
                  <dl>
                    <div><dt>플랜</dt><dd>—</dd></div>
                    <div><dt>월 정액</dt><dd>—</dd></div>
                  </dl>
                </div>
                <div className="admin-ads-detail__info-col">
                  <dl>
                    <div><dt>결제 상태</dt><dd>—</dd></div>
                    <div><dt>다음 결제일</dt><dd>—</dd></div>
                  </dl>
                </div>
              </div>
              <p className="admin-ads-detail__future-note">아이템 개수별 월 정액 과금 도입 예정입니다.</p>
            </section>

            {/* ⑥ 성과 요약 — 기간 7/30/90일 */}
            <section className="admin-ads-detail__section">
              <div className="admin-ads-detail__section-head">
                <h3 className="admin-ads-detail__section-title">성과 요약 <span className="admin-ads-detail__basis">최근 {days}일 기준</span></h3>
                <div className="admin-ads-detail__range">
                  {DAY_OPTIONS.map((d) => (
                    <button
                      key={d}
                      className={`admin-ads-detail__range-btn ${days === d ? 'admin-ads-detail__range-btn--active' : ''}`}
                      onClick={() => setDays(d)}
                      aria-pressed={days === d}
                    >
                      {d}일
                    </button>
                  ))}
                </div>
              </div>
              <div className="admin-ads-detail__stats">
                <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">착장 선택</span><span className="admin-ads-detail__stat-value">{(perf.impressions ?? 0).toLocaleString()}</span></div>
                <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">클릭</span><span className="admin-ads-detail__stat-value">{(perf.clicks ?? 0).toLocaleString()}</span></div>
                <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">클릭율</span><span className="admin-ads-detail__stat-value">{perf.ctr ?? '0.00'}%</span></div>
                <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">위시</span><span className="admin-ads-detail__stat-value">{(perf.wishes ?? 0).toLocaleString()}</span></div>
              </div>
            </section>

            {/* ⑦ 등록 아이템 — 강제 숨김/해제 + 행 확장(스타별 성과·인사이트) */}
            <section className="admin-ads-detail__section">
              <h3 className="admin-ads-detail__section-title">등록 아이템 <span className="admin-ads-detail__basis">클릭·위시는 누적</span></h3>
              <div className="admin-table-wrap">
                <table className="admin-table--full">
                  <thead>
                    <tr>
                      <th>썸네일</th><th>아이템</th><th>카테고리</th><th>클릭</th><th>위시</th><th>상태</th><th>관리</th><th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const st = itemStatusMeta(item);
                      const expanded = expandedItemId === item.item_id;
                      return (
                        <Fragment key={item.item_id}>
                          <tr>
                            <td>
                              <div className="admin-ads-detail__thumb">
                                {item.image_object_name ? (
                                  <img src={adThumbSrc(item.image_object_name)} alt="" loading="lazy" />
                                ) : (
                                  <span>-</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="admin-ads-detail__item-brand">{item.brand || '-'}</span>
                              <span className="admin-ads-detail__item-name">{item.product_name || item.name || '-'}</span>
                            </td>
                            <td>{item.category || '-'}</td>
                            <td>{(item.clicks ?? 0).toLocaleString()}</td>
                            <td>{(item.wish ?? 0).toLocaleString()}</td>
                            <td><span className={`admin-badge ${st.cls}`}>{st.label}</span></td>
                            <td>
                              <button
                                className={`admin-btn admin-btn--small ${item.admin_hidden ? '' : 'admin-ads-detail__hide-btn'}`}
                                onClick={() => handleToggleHidden(item)}
                                disabled={hidingId === item.item_id}
                              >
                                {hidingId === item.item_id ? '처리 중...' : item.admin_hidden ? '숨김 해제' : '강제 숨김'}
                              </button>
                            </td>
                            <td>
                              <button
                                className="admin-btn admin-btn--small"
                                onClick={() => handleToggleExpand(item.item_id)}
                                aria-expanded={expanded}
                              >
                                스타·인사이트 {expanded ? '▲' : '▼'}
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="admin-ads-detail__expand-row">
                              <td colSpan={8}>
                                {renderStarsPanel(item.item_id)}
                                {renderInsightsPanel(item.item_id)}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={8} className="admin-empty">등록된 아이템이 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ⑧ 광고주 화면 그대로 — dashboard 재사용 (기간 규약: 일간/주간/월간 — ⑥과 상이) */}
            <section className="admin-ads-detail__section">
              <div className="admin-ads-detail__section-head">
                <h3 className="admin-ads-detail__section-title">
                  광고주 화면 그대로 보기
                  <span className="admin-ads-detail__basis">기간 기준: 일간/주간/월간 (성과 요약의 7/30/90일과 다름)</span>
                </h3>
                <div className="admin-ads-detail__dash-controls">
                  <div className="admin-ads-detail__range">
                    {PERIOD_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`admin-ads-detail__range-btn ${period === opt.value ? 'admin-ads-detail__range-btn--active' : ''}`}
                        onClick={() => setPeriod(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="admin-ads-detail__range" role="group" aria-label="회원 인증 필터">
                    <button
                      className={`admin-ads-detail__range-btn ${verifiedOnly ? 'admin-ads-detail__range-btn--active' : ''}`}
                      onClick={() => setVerifiedOnly(true)}
                    >
                      인증 회원만
                    </button>
                    <button
                      className={`admin-ads-detail__range-btn ${!verifiedOnly ? 'admin-ads-detail__range-btn--active' : ''}`}
                      onClick={() => setVerifiedOnly(false)}
                    >
                      전체
                    </button>
                  </div>
                </div>
              </div>

              <div className="admin-ads-detail__cat-tabs">
                {DASH_CATEGORY_OPTIONS.map((cat) => (
                  <button
                    key={cat}
                    className={`admin-ads-detail__cat-tab ${dashCategory === cat ? 'admin-ads-detail__cat-tab--active' : ''}`}
                    onClick={() => setDashCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {dashError ? (
                <div className="admin-error">
                  <p>{dashError}</p>
                  <button className="admin-btn admin-btn--small" onClick={fetchDashboard}>재시도</button>
                </div>
              ) : dashLoading ? (
                <p className="admin-loading">로딩 중...</p>
              ) : (
                <>
                  <div className="admin-ads-detail__stats admin-ads-detail__stats--six">
                    <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">전체 착장 선택</span><span className="admin-ads-detail__stat-value">{(dash?.total_impressions ?? 0).toLocaleString()}</span></div>
                    <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">전체 방문 수</span><span className="admin-ads-detail__stat-value">{(dash?.total_clicks ?? 0).toLocaleString()}</span></div>
                    <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">클릭율(클릭/착장 선택)</span><span className="admin-ads-detail__stat-value">{dash?.ctr ?? '0.00'}%</span></div>
                    <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">사용자 수</span><span className="admin-ads-detail__stat-value">{(dash?.total_users ?? 0).toLocaleString()}</span></div>
                    <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">위시 담김</span><span className="admin-ads-detail__stat-value">{(dash?.total_wishes ?? 0).toLocaleString()}</span></div>
                    <div className="admin-ads-detail__stat-card"><span className="admin-ads-detail__stat-label">착장</span><span className="admin-ads-detail__stat-value">{(dash?.total_worn ?? 0).toLocaleString()}</span></div>
                  </div>

                  {Array.isArray(dash?.chart_data) && dash.chart_data.length > 0 && (() => {
                    const chartData = dash.chart_data;
                    const maxBar = Math.max(...chartData.map((d) => Math.max(d.impressions || 0, d.clicks || 0)), 1);
                    return (
                      <div className="admin-ads-detail__chart">
                        <div className="admin-ads-detail__legend">
                          <span><i className="admin-ads-detail__dot admin-ads-detail__dot--imp" /> 착장 선택</span>
                          <span><i className="admin-ads-detail__dot admin-ads-detail__dot--click" /> 방문 수</span>
                        </div>
                        <div className="admin-ads-detail__chart-body">
                          {chartData.map((d, i) => (
                            <div key={i} className="admin-ads-detail__chart-group" title={`${d.label} — 착장 선택 ${d.impressions ?? 0} / 방문 ${d.clicks ?? 0} / CTR ${d.ctr ?? 0}%`}>
                              <div className="admin-ads-detail__chart-bars">
                                <div className="admin-ads-detail__chart-bar admin-ads-detail__chart-bar--imp" style={{ height: `${((d.impressions || 0) / maxBar) * 100}%` }} />
                                <div className="admin-ads-detail__chart-bar admin-ads-detail__chart-bar--click" style={{ height: `${((d.clicks || 0) / maxBar) * 100}%` }} />
                              </div>
                              <span className="admin-ads-detail__chart-label">{d.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="admin-table-wrap">
                    <table className="admin-table--full">
                      <thead>
                        <tr>
                          <th>이미지</th><th>아이템명</th><th>착장 선택</th><th>방문 수</th><th>클릭율</th><th>위시</th><th>착장</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dash?.items || []).map((item) => (
                          <tr key={item.item_id}>
                            <td>
                              <div className="admin-ads-detail__thumb">
                                {item.image_object_name ? (
                                  <img src={adThumbSrc(item.image_object_name)} alt="" loading="lazy" />
                                ) : (
                                  <span>-</span>
                                )}
                              </div>
                            </td>
                            <td>{item.name || '-'}</td>
                            <td>{(item.impressions ?? 0).toLocaleString()}</td>
                            <td>{(item.clicks ?? 0).toLocaleString()}</td>
                            <td>{item.ctr ?? '0.00'}%</td>
                            <td>{(item.wish_count ?? 0).toLocaleString()}</td>
                            <td>{(item.worn_count ?? 0).toLocaleString()}</td>
                          </tr>
                        ))}
                        {(!dash?.items || dash.items.length === 0) && (
                          <tr><td colSpan={7} className="admin-empty">데이터가 없습니다</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
