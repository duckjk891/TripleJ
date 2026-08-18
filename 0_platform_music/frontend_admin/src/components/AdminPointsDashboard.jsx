import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  getAdminPointsDaily,
  getAdminPointsBreakdown,
  getAdminPointsDemographics,
  getAdminPointsTopSpenders,
  getAdminPointsBalanceDist,
} from '../api';
import { actionLabel } from '../utils/pointsLabels';
import './AdminPointsDashboard.css';

// 별 분석 대시보드 (v181, v182 확장) — /points [분석 대시보드] 탭. 순수 CSS 차트(라이브러리 금지).
// 블록 순서: ①일별 추이 ②순증·소진율(v182 — daily 재가공, 추가 fetch 없음) ③경로 분포 ④나이대×성별
// ⑤소비자 티어(v182 — 기간 연동 재조회) ⑥잔액 분포(v182 — 현재 스냅샷, 마운트 1회).
// 기간 필터 7/30/90일(기본 30). 로그 prefix `[AdminPointsDash]`.
// 응답은 집계/닉네임#code 수준뿐이며, 콘솔에는 기간·모드·건수만 출력한다(닉네임·개별값 미출력).

const DAY_OPTIONS = [7, 30, 90];

// day 'YYYYMMDD' → 'MM-DD' (백엔드 확정 스키마 — bucket 은 한글 원문이라 별도 매핑 불요)
function shortDay(day) {
  const s = String(day || '');
  return s.length === 8 ? `${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export default function AdminPointsDashboard() {
  const [days, setDays] = useState(30);

  const [daily, setDaily] = useState(null);
  const [dailyError, setDailyError] = useState('');
  const [breakdown, setBreakdown] = useState(null);
  const [breakdownError, setBreakdownError] = useState('');
  const [demo, setDemo] = useState(null);
  const [demoError, setDemoError] = useState('');
  const [demoMode, setDemoMode] = useState('earn');
  // v182 — 소비자 티어(기간 연동) / 잔액 분포(현재 스냅샷, 마운트 1회)
  const [tiers, setTiers] = useState(null);
  const [tiersError, setTiersError] = useState('');
  const [balDist, setBalDist] = useState(null);
  const [balDistError, setBalDistError] = useState('');

  const loadDaily = useCallback(async (d) => {
    setDailyError('');
    setDaily(null);
    if (import.meta.env.DEV) console.info('[AdminPointsDash] loading daily', { days: d });
    try {
      const { data } = await getAdminPointsDaily(d);
      const list = Array.isArray(data?.days) ? data.days : [];
      if (!Array.isArray(data?.days)) {
        console.warn('[AdminPointsDash] unexpected daily response shape', { keys: Object.keys(data || {}) });
      }
      setDaily(list);
      if (import.meta.env.DEV) console.info('[AdminPointsDash] daily loaded', { count: list.length });
    } catch (err) {
      console.error('[AdminPointsDash] getAdminPointsDaily failed', { status: err?.response?.status, days: d, message: err?.message });
      setDailyError('일별 추이를 불러오지 못했습니다.');
    }
  }, []);

  const loadBreakdown = useCallback(async (d) => {
    setBreakdownError('');
    setBreakdown(null);
    if (import.meta.env.DEV) console.info('[AdminPointsDash] loading breakdown', { days: d });
    try {
      const { data } = await getAdminPointsBreakdown(d);
      const earn = Array.isArray(data?.earn) ? data.earn : [];
      const spend = Array.isArray(data?.spend) ? data.spend : [];
      setBreakdown({ earn, spend });
      if (import.meta.env.DEV) console.info('[AdminPointsDash] breakdown loaded', { earn: earn.length, spend: spend.length });
    } catch (err) {
      console.error('[AdminPointsDash] getAdminPointsBreakdown failed', { status: err?.response?.status, days: d, message: err?.message });
      setBreakdownError('경로 분포를 불러오지 못했습니다.');
    }
  }, []);

  const loadDemographics = useCallback(async (d, mode) => {
    setDemoError('');
    setDemo(null);
    if (import.meta.env.DEV) console.info('[AdminPointsDash] loading demographics', { days: d, mode });
    try {
      const { data } = await getAdminPointsDemographics(d, mode);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (!Array.isArray(data?.rows)) {
        console.warn('[AdminPointsDash] unexpected demographics response shape', { keys: Object.keys(data || {}) });
      }
      setDemo({ rows, total: typeof data?.total === 'number' ? data.total : 0 });
      if (import.meta.env.DEV) console.info('[AdminPointsDash] demographics loaded', { rows: rows.length });
    } catch (err) {
      console.error('[AdminPointsDash] getAdminPointsDemographics failed', { status: err?.response?.status, days: d, mode, message: err?.message });
      setDemoError('나이대×성별 집계를 불러오지 못했습니다.');
    }
  }, []);

  // v182 — 소비자 티어. 확정 스키마: 소비자 0명이면 {top:[], whale:null, spenders:0},
  // 그 외 whale = {top_count, top_total, all_total, share_pct(소수1)}. whale null 처리 필수.
  const loadTiers = useCallback(async (d) => {
    setTiersError('');
    setTiers(null);
    if (import.meta.env.DEV) console.info('[AdminPointsDash] loading top-spenders', { days: d });
    try {
      const { data } = await getAdminPointsTopSpenders(d);
      const top = Array.isArray(data?.top) ? data.top : [];
      if (!Array.isArray(data?.top)) {
        console.warn('[AdminPointsDash] unexpected top-spenders response shape', { keys: Object.keys(data || {}) });
      }
      const w = data?.whale || null;
      const whale = w ? {
        users: w.top_count ?? 0,
        total: w.top_total ?? 0,
        allTotal: w.all_total ?? 0,
        sharePct: w.share_pct ?? pct(w.top_total ?? 0, w.all_total ?? 0),
      } : null;
      setTiers({ top, whale, spenders: typeof data?.spenders === 'number' ? data.spenders : 0 });
      if (import.meta.env.DEV) console.info('[AdminPointsDash] top-spenders loaded', { top: top.length, spenders: data?.spenders ?? 0 });
    } catch (err) {
      console.error('[AdminPointsDash] getAdminPointsTopSpenders failed', { status: err?.response?.status, days: d, message: err?.message });
      setTiersError('소비자 티어를 불러오지 못했습니다.');
    }
  }, []);

  // v182 — 잔액 분포(스냅샷, 기간 무관)
  const loadBalanceDist = useCallback(async () => {
    setBalDistError('');
    setBalDist(null);
    if (import.meta.env.DEV) console.info('[AdminPointsDash] loading balance-distribution');
    try {
      const { data } = await getAdminPointsBalanceDist();
      const buckets = Array.isArray(data?.buckets) ? data.buckets : [];
      if (!Array.isArray(data?.buckets)) {
        console.warn('[AdminPointsDash] unexpected balance-distribution response shape', { keys: Object.keys(data || {}) });
      }
      setBalDist({
        buckets,
        totalUsers: typeof data?.total_users === 'number' ? data.total_users : 0,
        totalBalance: typeof data?.total_balance === 'number' ? data.total_balance : 0,
      });
      if (import.meta.env.DEV) console.info('[AdminPointsDash] balance-distribution loaded', { buckets: buckets.length });
    } catch (err) {
      console.error('[AdminPointsDash] getAdminPointsBalanceDist failed', { status: err?.response?.status, message: err?.message });
      setBalDistError('잔액 분포를 불러오지 못했습니다.');
    }
  }, []);

  // 기간 변경 → 추이·분포·티어 재조회 / 모드 토글은 아래 별도 effect(demographics 만) — 불필요 재조회 방지
  useEffect(() => {
    // 기존 페이지 관행(fetch-in-effect)과 동일 패턴
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDaily(days);
    loadBreakdown(days);
    loadTiers(days); // v182 — 티어는 기간 연동
  }, [days, loadDaily, loadBreakdown, loadTiers]);

  // v182 — 잔액 분포는 현재 스냅샷: 마운트 1회만(기간 전환 시 재조회 불요)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBalanceDist();
  }, [loadBalanceDist]);

  // 기간 또는 모드 변경 → 인구 집계 재조회
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDemographics(days, demoMode);
  }, [days, demoMode, loadDemographics]);

  const dailyMax = daily && daily.length > 0
    ? Math.max(1, ...daily.map((d) => Math.max(d.earned || 0, d.spent || 0)))
    : 1;
  const dailyHasData = !!daily && daily.some((d) => (d.earned || 0) > 0 || (d.spent || 0) > 0);
  // x축 라벨 간략화 — 7일: 전부 / 30·90일: 처음·매 7(15)일·마지막
  const labelStep = days === 7 ? 1 : days === 30 ? 7 : 15;

  const demoMax = demo && demo.rows.length > 0
    ? Math.max(1, ...demo.rows.map((r) => r.total || 0))
    : 1;

  // v182 — 순증·소진율: 기존 daily state 재가공(신규 fetch 없음 — 동일 소스라 정합 자동,
  // signup_bonus 미포함도 v181 daily 와 자동 일관)
  const totalEarned = daily ? daily.reduce((s, d) => s + (d.earned || 0), 0) : 0;
  const totalSpent = daily ? daily.reduce((s, d) => s + (d.spent || 0), 0) : 0;
  const netTotal = totalEarned - totalSpent;
  const burnRate = totalEarned > 0 ? pct(totalSpent, totalEarned) : null; // 적립 0 기간은 "-" 표기
  const netMax = daily && daily.length > 0
    ? Math.max(1, ...daily.map((d) => Math.abs((d.earned || 0) - (d.spent || 0))))
    : 1;

  const balMax = balDist && balDist.buckets.length > 0
    ? Math.max(1, ...balDist.buckets.map((b) => b.count || 0))
    : 1;

  const renderBreakdownPanel = (title, list) => {
    const panelTotal = list.reduce((sum, row) => sum + (row.total || 0), 0);
    return (
      <div className="admin-points-dash__panel">
        <h4 className="admin-points-dash__panel-title">{title}</h4>
        {list.length === 0 ? (
          <p className="admin-points-dash__empty">기간 내 데이터가 없습니다.</p>
        ) : (
          <ul className="admin-points-dash__ratio-list">
            {list.map((row) => (
              <li key={row.action} className="admin-points-dash__ratio-row">
                <span className="admin-points-dash__ratio-label" title={row.action}>
                  {actionLabel(row.action)}
                </span>
                <span className="admin-points-dash__ratio-track">
                  <span
                    className={`admin-points-dash__ratio-fill ${title === '획득' ? 'admin-points-dash__ratio-fill--earn' : 'admin-points-dash__ratio-fill--spend'}`}
                    style={{ width: `${pct(row.total, panelTotal)}%` }}
                  />
                </span>
                <span className="admin-points-dash__ratio-value">
                  {pct(row.total, panelTotal)}% · ⭐ {(row.total || 0).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="admin-points-dash">
      {/* 기간 필터 — 전 블록 연동 */}
      <div className="admin-points-dash__range" role="radiogroup" aria-label="집계 기간">
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            className={`admin-points-dash__range-btn ${days === d ? 'admin-points-dash__range-btn--active' : ''}`}
            onClick={() => setDays(d)}
            aria-pressed={days === d}
          >
            {d}일
          </button>
        ))}
      </div>

      {/* ① 일별 추이 */}
      <section className="admin-points-dash__section">
        <h3 className="admin-points-dash__title">일별 적립/소진 추이</h3>
        {dailyError ? (
          <div className="admin-points-dash__error">
            <p>{dailyError}</p>
            <button className="admin-points-dash__retry" onClick={() => loadDaily(days)}>재시도</button>
          </div>
        ) : daily === null ? (
          <p className="admin-points-dash__loading">로딩 중...</p>
        ) : !dailyHasData ? (
          <p className="admin-points-dash__empty">기간 내 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="admin-points-dash__legend">
              <span className="admin-points-dash__legend-item"><i className="admin-points-dash__dot admin-points-dash__dot--earn" /> 적립</span>
              <span className="admin-points-dash__legend-item"><i className="admin-points-dash__dot admin-points-dash__dot--spend" /> 소진</span>
            </div>
            <div className="admin-points-dash__chart">
              {daily.map((d, i) => (
                <div
                  key={d.day || i}
                  className="admin-points-dash__day"
                  title={`${shortDay(d.day)} — 적립 ${(d.earned || 0).toLocaleString()} / 소진 ${(d.spent || 0).toLocaleString()}`}
                >
                  <span className="admin-points-dash__tooltip">
                    {shortDay(d.day)} · +{(d.earned || 0).toLocaleString()} / -{(d.spent || 0).toLocaleString()}
                  </span>
                  <div className="admin-points-dash__bars">
                    <div
                      className="admin-points-dash__bar admin-points-dash__bar--earn"
                      style={{ height: `${Math.max(d.earned ? 2 : 0, Math.round(((d.earned || 0) / dailyMax) * 100))}%` }}
                    />
                    <div
                      className="admin-points-dash__bar admin-points-dash__bar--spend"
                      style={{ height: `${Math.max(d.spent ? 2 : 0, Math.round(((d.spent || 0) / dailyMax) * 100))}%` }}
                    />
                  </div>
                  <span className="admin-points-dash__x-label">
                    {(i % labelStep === 0 || i === daily.length - 1) ? shortDay(d.day) : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ②(v182) 순증·소진율 — 기존 daily state 재가공(추가 fetch 없음), 추이 블록 직후 배치 */}
      <section className="admin-points-dash__section">
        <h3 className="admin-points-dash__title">순증·소진율</h3>
        {dailyError ? (
          <div className="admin-points-dash__error">
            <p>{dailyError}</p>
            <button className="admin-points-dash__retry" onClick={() => loadDaily(days)}>재시도</button>
          </div>
        ) : daily === null ? (
          <p className="admin-points-dash__loading">로딩 중...</p>
        ) : !dailyHasData ? (
          <p className="admin-points-dash__empty">기간 내 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="admin-points-dash__net-cards">
              <div className="admin-points-dash__net-card">
                <span className="admin-points-dash__net-label">총 적립</span>
                <span className="admin-points-dash__net-value">+{totalEarned.toLocaleString()}</span>
              </div>
              <div className="admin-points-dash__net-card">
                <span className="admin-points-dash__net-label">총 소진</span>
                <span className="admin-points-dash__net-value">-{totalSpent.toLocaleString()}</span>
              </div>
              <div className="admin-points-dash__net-card">
                <span className="admin-points-dash__net-label">순증</span>
                <span className={`admin-points-dash__net-value ${netTotal >= 0 ? 'admin-points-dash__net-value--pos' : 'admin-points-dash__net-value--neg'}`}>
                  {netTotal >= 0 ? '+' : ''}{netTotal.toLocaleString()}
                </span>
              </div>
              <div className="admin-points-dash__net-card">
                <span className="admin-points-dash__net-label">소진율</span>
                <span className="admin-points-dash__net-value">{burnRate === null ? '-' : `${burnRate}%`}</span>
              </div>
            </div>
            <div className="admin-points-dash__net-chart">
              {daily.map((d, i) => {
                const net = (d.earned || 0) - (d.spent || 0);
                const h = Math.max(net !== 0 ? 2 : 0, Math.round((Math.abs(net) / netMax) * 100));
                return (
                  <div
                    key={d.day || i}
                    className="admin-points-dash__net-day"
                    title={`${shortDay(d.day)} — 순증 ${net >= 0 ? '+' : ''}${net.toLocaleString()}`}
                  >
                    <span className="admin-points-dash__tooltip">
                      {shortDay(d.day)} · {net >= 0 ? '+' : ''}{net.toLocaleString()}
                    </span>
                    <div className="admin-points-dash__net-half admin-points-dash__net-half--up">
                      {net > 0 && <div className="admin-points-dash__net-bar admin-points-dash__net-bar--pos" style={{ height: `${h}%` }} />}
                    </div>
                    <div className="admin-points-dash__net-half admin-points-dash__net-half--down">
                      {net < 0 && <div className="admin-points-dash__net-bar admin-points-dash__net-bar--neg" style={{ height: `${h}%` }} />}
                    </div>
                    <span className="admin-points-dash__x-label">
                      {(i % labelStep === 0 || i === daily.length - 1) ? shortDay(d.day) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* ② 획득/소비 경로 분포 */}
      <section className="admin-points-dash__section">
        <h3 className="admin-points-dash__title">획득/소비 경로 분포</h3>
        {breakdownError ? (
          <div className="admin-points-dash__error">
            <p>{breakdownError}</p>
            <button className="admin-points-dash__retry" onClick={() => loadBreakdown(days)}>재시도</button>
          </div>
        ) : breakdown === null ? (
          <p className="admin-points-dash__loading">로딩 중...</p>
        ) : (
          <div className="admin-points-dash__panels">
            {renderBreakdownPanel('획득', breakdown.earn)}
            {renderBreakdownPanel('소비', breakdown.spend)}
          </div>
        )}
      </section>

      {/* ③ 나이대×성별 */}
      <section className="admin-points-dash__section">
        <div className="admin-points-dash__demo-head">
          <h3 className="admin-points-dash__title">나이대×성별 분포</h3>
          <div className="admin-points-dash__mode" role="radiogroup" aria-label="집계 모드">
            <button
              className={`admin-points-dash__range-btn ${demoMode === 'earn' ? 'admin-points-dash__range-btn--active' : ''}`}
              onClick={() => setDemoMode('earn')}
              aria-pressed={demoMode === 'earn'}
            >
              획득
            </button>
            <button
              className={`admin-points-dash__range-btn ${demoMode === 'spend' ? 'admin-points-dash__range-btn--active' : ''}`}
              onClick={() => setDemoMode('spend')}
              aria-pressed={demoMode === 'spend'}
            >
              소비
            </button>
          </div>
        </div>
        {demoError ? (
          <div className="admin-points-dash__error">
            <p>{demoError}</p>
            <button className="admin-points-dash__retry" onClick={() => loadDemographics(days, demoMode)}>재시도</button>
          </div>
        ) : demo === null ? (
          <p className="admin-points-dash__loading">로딩 중...</p>
        ) : demo.total === 0 ? (
          <p className="admin-points-dash__empty">기간 내 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="admin-points-dash__legend">
              <span className="admin-points-dash__legend-item"><i className="admin-points-dash__dot admin-points-dash__dot--male" /> 남</span>
              <span className="admin-points-dash__legend-item"><i className="admin-points-dash__dot admin-points-dash__dot--female" /> 여</span>
              <span className="admin-points-dash__legend-item"><i className="admin-points-dash__dot admin-points-dash__dot--unknown" /> 미상</span>
            </div>
            <ul className="admin-points-dash__demo-list">
              {demo.rows.map((row) => (
                <li key={row.bucket} className="admin-points-dash__demo-row">
                  <span className="admin-points-dash__demo-bucket">{row.bucket}</span>
                  <span
                    className="admin-points-dash__demo-track"
                    title={`남 ${(row.male || 0).toLocaleString()} / 여 ${(row.female || 0).toLocaleString()} / 미상 ${(row.unknown || 0).toLocaleString()}`}
                  >
                    <span className="admin-points-dash__demo-seg admin-points-dash__demo-seg--male" style={{ width: `${pct(row.male || 0, demoMax)}%` }} />
                    <span className="admin-points-dash__demo-seg admin-points-dash__demo-seg--female" style={{ width: `${pct(row.female || 0, demoMax)}%` }} />
                    <span className="admin-points-dash__demo-seg admin-points-dash__demo-seg--unknown" style={{ width: `${pct(row.unknown || 0, demoMax)}%` }} />
                  </span>
                  <span className="admin-points-dash__demo-total">⭐ {(row.total || 0).toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="admin-points-dash__footnote">미상 = 미입력·기타 · 합계 ⭐ {(demo.total || 0).toLocaleString()}</p>
          </>
        )}
      </section>

      {/* ⑤(v182) 소비자 티어 — 기간 연동. 닉네임 미해석 시 `사용자 #id8` fallback, /users/:id Link(v177 관행) */}
      <section className="admin-points-dash__section">
        <h3 className="admin-points-dash__title">소비자 티어 (상위 10)</h3>
        {tiersError ? (
          <div className="admin-points-dash__error">
            <p>{tiersError}</p>
            <button className="admin-points-dash__retry" onClick={() => loadTiers(days)}>재시도</button>
          </div>
        ) : tiers === null ? (
          <p className="admin-points-dash__loading">로딩 중...</p>
        ) : !tiers.whale || tiers.top.length === 0 ? (
          <p className="admin-points-dash__empty">기간 내 소비가 없습니다.</p>
        ) : (
          <>
            <div className="admin-points-dash__whale">
              상위 10%({tiers.whale.users.toLocaleString()}명)가 전체 소비 ⭐ {tiers.whale.allTotal.toLocaleString()} 중{' '}
              <strong>{tiers.whale.sharePct}%</strong> (⭐ {tiers.whale.total.toLocaleString()}) 점유 · 소비자 {tiers.spenders.toLocaleString()}명
            </div>
            <ol className="admin-points-dash__spender-list">
              {tiers.top.map((row, i) => (
                <li key={row.user_id || i} className="admin-points-dash__spender-row">
                  <span className="admin-points-dash__spender-rank">{i + 1}</span>
                  <span className="admin-points-dash__spender-name">
                    {row.user_id ? (
                      <Link to={`/users/${row.user_id}`} className="admin-points-dash__link" title={String(row.user_id)}>
                        {row.nickname
                          ? `${row.nickname}${row.code ? `#${row.code}` : ''}`
                          : `사용자 #${String(row.user_id).slice(0, 8)}`}
                      </Link>
                    ) : (
                      row.nickname || '알 수 없음'
                    )}
                  </span>
                  <span className="admin-points-dash__spender-total">⭐ {(row.total || 0).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {/* ⑥(v182) 잔액 분포 — 현재 스냅샷(기간 무관, 마운트 1회) */}
      <section className="admin-points-dash__section">
        <h3 className="admin-points-dash__title">
          잔액 분포
          <span className="admin-points-dash__snapshot-badge">현재 기준</span>
        </h3>
        {balDistError ? (
          <div className="admin-points-dash__error">
            <p>{balDistError}</p>
            <button className="admin-points-dash__retry" onClick={loadBalanceDist}>재시도</button>
          </div>
        ) : balDist === null ? (
          <p className="admin-points-dash__loading">로딩 중...</p>
        ) : balDist.totalUsers === 0 ? (
          <p className="admin-points-dash__empty">잔액 기록이 없습니다.</p>
        ) : (
          <>
            <div className="admin-points-dash__hist">
              {balDist.buckets.map((b) => (
                <div
                  key={b.label}
                  className="admin-points-dash__hist-col"
                  title={`${b.label} — ${(b.count || 0).toLocaleString()}명`}
                >
                  <span className="admin-points-dash__hist-count">{(b.count || 0).toLocaleString()}</span>
                  <div className="admin-points-dash__hist-track">
                    <div
                      className="admin-points-dash__hist-bar"
                      style={{ height: `${Math.max(b.count ? 2 : 0, Math.round(((b.count || 0) / balMax) * 100))}%` }}
                    />
                  </div>
                  <span className="admin-points-dash__hist-label">{b.label}</span>
                </div>
              ))}
            </div>
            <p className="admin-points-dash__footnote">
              모수 = 별 이력 보유 사용자 {balDist.totalUsers.toLocaleString()}명 · 총 잔액 ⭐ {balDist.totalBalance.toLocaleString()}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
