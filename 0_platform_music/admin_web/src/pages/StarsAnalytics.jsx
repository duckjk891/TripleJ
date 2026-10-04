import { useState, useEffect } from 'react';
import {
  getPointDaily, getPointBreakdown, getPointDemographics, getPointTopSpenders,
  getPointBalanceDistribution, getPointSegments, getPointCohorts,
} from '../api';

const n = (v) => Number(v || 0).toLocaleString();
const PLAN = { free: '무료', basic: '베이직', pro: '프로', premium: '프리미엄' };
const ROLE = { user: '일반', admin: '관리자', business: '비즈니스', advertiser: '광고주' };

function Bars({ rows, labelOf, valueOf, suffix = '' }) {
  const max = Math.max(1, ...rows.map(valueOf));
  if (rows.length === 0) return <p className="cell-sub">데이터 없음</p>;
  return rows.map((r, i) => (
    <div key={i} className="bar-row">
      <div className="bar-row__head"><span>{labelOf(r)}</span><span className="cell-main">{n(valueOf(r))}{suffix}</span></div>
      <div className="progress-bar" style={{ marginTop: 0 }}><div style={{ width: `${(valueOf(r) / max) * 100}%` }} /></div>
    </div>
  ));
}

export default function StarsAnalytics({ actionLabel }) {
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState('earn');
  const [d, setD] = useState({});

  useEffect(() => {
    let alive = true;
    const put = (k) => (r) => { if (alive) setD((p) => ({ ...p, [k]: r.data })); };
    const fail = (k) => () => { if (alive) setD((p) => ({ ...p, [k]: null })); };
    setD((p) => ({ dist: p.dist }));
    getPointDaily(days).then(put('daily')).catch(fail('daily'));
    getPointBreakdown(days).then(put('breakdown')).catch(fail('breakdown'));
    getPointTopSpenders(days).then(put('top')).catch(fail('top'));
    getPointCohorts(days).then(put('cohorts')).catch(fail('cohorts'));
    return () => { alive = false; };
  }, [days]);

  useEffect(() => {
    let alive = true;
    setD((p) => ({ ...p, demo: undefined, seg: undefined }));
    getPointDemographics(days, mode).then((r) => alive && setD((p) => ({ ...p, demo: r.data }))).catch(() => {});
    getPointSegments(days, mode).then((r) => alive && setD((p) => ({ ...p, seg: r.data }))).catch(() => {});
    return () => { alive = false; };
  }, [days, mode]);

  useEffect(() => {
    getPointBalanceDistribution().then((r) => setD((p) => ({ ...p, dist: r.data }))).catch(() => {});
  }, []);

  const daily = d.daily?.days || [];
  const maxDaily = Math.max(1, ...daily.map((x) => Math.max(x.earned, x.spent)));
  const sumEarned = daily.reduce((a, x) => a + x.earned, 0);
  const sumSpent = daily.reduce((a, x) => a + x.spent, 0);
  const modeLabel = mode === 'earn' ? '적립' : '사용';

  return (
    <div>
      <div className="filters">
        <div className="filter-group">
          {[7, 30, 90].map((v) => (
            <button key={v} className={`filter-btn ${days === v ? 'active' : ''}`} onClick={() => setDays(v)}>최근 {v}일</button>
          ))}
        </div>
        <div className="filter-group">
          {[['earn', '적립 기준'], ['spend', '사용 기준']].map(([v, l]) => (
            <button key={v} className={`filter-btn ${mode === v ? 'active' : ''}`} onClick={() => setMode(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">일별 적립 · 사용</h3>
        <div className="legend">
          <span><i style={{ background: 'var(--primary)' }} />적립 {n(sumEarned)}</span>
          <span><i style={{ background: 'var(--amber)' }} />사용 {n(sumSpent)}</span>
        </div>
        {daily.length === 0 ? <p className="cell-sub">{d.daily === undefined ? '로딩…' : '데이터 없음'}</p> : (
          <div className="duo-chart">
            {daily.map((x, i) => (
              <div key={x.day} className="duo-col" title={`${x.day} 적립 ${n(x.earned)} · 사용 ${n(x.spent)}`}>
                <div className="duo-bars">
                  <div style={{ height: `${(x.earned / maxDaily) * 100}%`, background: 'var(--primary)' }} />
                  <div style={{ height: `${(x.spent / maxDaily) * 100}%`, background: 'var(--amber)' }} />
                </div>
                <span className="duo-date">{(daily.length <= 14 || i % Math.ceil(daily.length / 10) === 0) ? `${x.day.slice(4, 6)}/${x.day.slice(6, 8)}` : ' '}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 className="section-title">적립 경로</h3>
          <Bars rows={d.breakdown?.earn || []} labelOf={(r) => actionLabel(r.action)} valueOf={(r) => r.total} />
        </div>
        <div className="card">
          <h3 className="section-title">사용처</h3>
          <Bars rows={d.breakdown?.spend || []} labelOf={(r) => actionLabel(r.action)} valueOf={(r) => r.total} />
        </div>
        <div className="card">
          <h3 className="section-title">잔액 분포 (현재)</h3>
          {d.dist && (
            <p className="cell-sub" style={{ marginBottom: 8 }}>보유자 {n(d.dist.total_users)}명 · 합계 ⭐ {n(d.dist.total_balance)}</p>
          )}
          <Bars rows={d.dist?.buckets || []} labelOf={(r) => `⭐ ${r.label}`} valueOf={(r) => r.count} suffix="명" />
        </div>
        <div className="card">
          <h3 className="section-title">많이 쓴 사용자</h3>
          {d.top?.whale && (
            <p className="cell-sub" style={{ marginBottom: 8 }}>
              사용자 {n(d.top.spenders)}명 중 상위 {n(d.top.whale.top_count)}명이 전체 사용량의 {d.top.whale.share_pct}%
            </p>
          )}
          <Bars rows={d.top?.top || []} labelOf={(r) => r.nickname || String(r.user_id).slice(0, 8)} valueOf={(r) => r.total} />
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 className="section-title">연령 · 성별 ({modeLabel})</h3>
          {!d.demo ? <p className="cell-sub">로딩…</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>연령</th><th>남</th><th>여</th><th>미상</th><th>합계</th></tr></thead>
                <tbody>
                  {(d.demo.rows || []).map((r) => (
                    <tr key={r.bucket}><td>{r.bucket}</td><td>{n(r.male)}</td><td>{n(r.female)}</td><td>{n(r.unknown)}</td><td className="cell-main">{n(r.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="section-title">요금제 · 역할 ({modeLabel})</h3>
          {!d.seg ? <p className="cell-sub">로딩…</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>구분</th><th>사용자</th><th>별</th></tr></thead>
                <tbody>
                  {(d.seg.plan_rows || []).map((r) => (
                    <tr key={`p${r.bucket}`}><td>요금제 · {PLAN[r.bucket] || r.bucket}</td><td>{n(r.users)}</td><td className="cell-main">{n(r.total)}</td></tr>
                  ))}
                  {(d.seg.role_rows || []).map((r) => (
                    <tr key={`r${r.bucket}`}><td>역할 · {ROLE[r.bucket] || r.bucket}</td><td>{n(r.users)}</td><td className="cell-main">{n(r.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">가입 월별 (최근 {days}일 활동)</h3>
        {!d.cohorts ? <p className="cell-sub">{d.cohorts === undefined ? '로딩…' : '데이터 없음'}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>가입 월</th><th>사용자</th><th>적립</th><th>사용</th></tr></thead>
              <tbody>
                {(d.cohorts.rows || []).map((r) => (
                  <tr key={r.month || 'unknown'}><td>{r.month || '미상'}</td><td>{n(r.users)}</td><td>{n(r.earned)}</td><td>{n(r.spent)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
