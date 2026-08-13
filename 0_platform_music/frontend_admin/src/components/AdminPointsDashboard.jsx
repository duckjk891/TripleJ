import { useState, useEffect, useCallback } from 'react';
import {
  getAdminPointsDaily,
  getAdminPointsBreakdown,
  getAdminPointsDemographics,
} from '../api';
import { actionLabel } from '../utils/pointsLabels';
import './AdminPointsDashboard.css';

// 별 분석 대시보드 (v181) — /points [분석 대시보드] 탭. 순수 CSS 차트(라이브러리 금지).
// 3블록: ①일별 추이(이중 막대) ②획득/소비 경로 분포(가로 비율 바 2패널) ③나이대×성별(스택 바+토글).
// 기간 필터 7/30/90일(기본 30) — 전 블록 연동. 로그 prefix `[AdminPointsDash]`.
// 응답은 버킷 집계뿐이며, 콘솔에는 기간·모드·건수만 출력한다(개인정보·개별값 미출력).

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

  // 기간 변경 → 추이·분포 재조회 / 모드 토글은 아래 별도 effect(demographics 만) — 불필요 재조회 방지
  useEffect(() => {
    // 기존 페이지 관행(fetch-in-effect)과 동일 패턴
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDaily(days);
    loadBreakdown(days);
  }, [days, loadDaily, loadBreakdown]);

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
    </div>
  );
}
