import { useState, useEffect } from 'react';
import { getFunnels, getPaths } from '../api';
import { formatDate } from './Dashboard';
import { screenLabel } from './Analytics';

const CLOSED = '__closed__';
const name = (s) => (s === CLOSED ? '앱 종료' : screenLabel(s));
const PLATFORM = { web: '웹', ios: 'iOS', android: '안드로이드' };

function fmtDur(sec) {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  return `${m}분 ${sec % 60}초`;
}

function Funnel({ f }) {
  const start = f.steps[0]?.sessions || 0;
  return (
    <div className="card">
      <h3 className="section-title">{f.label}</h3>
      {start === 0 ? <p className="cell-sub">기간 내 이 흐름을 시작한 세션이 없습니다.</p> : (
        <div className="funnel">
          {f.steps.map((s, i) => {
            const pct = start ? (s.sessions / start) * 100 : 0;
            const isLast = i === f.steps.length - 1;
            return (
              <div key={s.step} className="funnel-step">
                <div className="funnel-head">
                  <span className="cell-main">{i + 1}. {s.step}</span>
                  <span>
                    <b>{s.sessions}</b>세션
                    <span className="cell-sub"> · 처음 대비 {s.from_start_rate ?? 0}%{i > 0 && ` · 이전 단계 대비 ${s.from_prev_rate ?? 0}%`}</span>
                  </span>
                </div>
                <div className="progress-bar funnel-bar"><div style={{ width: `${pct}%` }} /></div>
                {!isLast && s.dropped > 0 && (
                  <div className="funnel-drop">
                    <span className="badge badge--red">{s.dropped}세션 이탈</span>
                    <span className="cell-sub">
                      이탈 후 이동: {s.dropped_to.map((d) => `${name(d.screen)} ${d.count}`).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Journeys({ days }) {
  const [funnels, setFunnels] = useState(null);
  const [paths, setPaths] = useState(null);

  useEffect(() => {
    setFunnels(null);
    setPaths(null);
    getFunnels(days).then((r) => setFunnels(r.data)).catch(() => setFunnels({ funnels: [], sessions: 0 }));
    getPaths(days, 30).then((r) => setPaths(r.data)).catch(() => setPaths({ recent: [], top_transitions: [], sessions: 0 }));
  }, [days]);

  const maxEdge = Math.max(1, ...(paths?.top_transitions || []).map((e) => e.count));

  return (
    <>
      <h3 className="page-subtitle">단계별 이탈</h3>
      <p className="cell-sub" style={{ marginBottom: 12 }}>
        한 번 앱을 열었을 때(세션) 각 흐름의 단계를 순서대로 몇 세션이 통과했는지입니다. 이탈 후 이동은 멈춘 뒤 바로 간 화면(또는 앱 종료)입니다.
      </p>
      {!funnels ? <p className="loading">로딩 중…</p> : (
        <div className="funnel-grid">
          {funnels.funnels.map((f) => <Funnel key={f.key} f={f} />)}
        </div>
      )}

      <h3 className="page-subtitle">이동 경로</h3>
      {!paths ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="card">
            <h3 className="section-title">자주 일어나는 이동 (상위 20)</h3>
            {paths.top_transitions.length === 0 ? <p className="cell-sub">데이터 없음</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>어디서</th><th>어디로</th><th style={{ width: '40%' }}>횟수</th></tr></thead>
                  <tbody>
                    {paths.top_transitions.map((e) => (
                      <tr key={`${e.from}-${e.to}`}>
                        <td>{name(e.from)}</td>
                        <td>{e.to === CLOSED ? <span className="badge badge--gray">앱 종료</span> : name(e.to)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ height: 8, borderRadius: 4, background: 'var(--primary)', width: `${(e.count / maxEdge) * 100}%` }} />
                            <span>{e.count}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="section-title">최근 세션 경로 (최근 {paths.recent.length}개 / 전체 {paths.sessions}개)</h3>
            {paths.recent.length === 0 ? <p className="cell-sub">데이터 없음</p> : paths.recent.map((s) => (
              <div key={s.session_id} className="journey">
                <div className="journey-meta">
                  <span className="nowrap">{formatDate(s.started_at)}</span>
                  <span className="badge badge--gray">{PLATFORM[s.platform] || s.platform || '-'}</span>
                  <span className="cell-main">{s.user || `비회원 ·${s.device}`}</span>
                  <span className="cell-sub">{fmtDur(s.duration_sec)} · {s.path.length}화면</span>
                </div>
                <div className="journey-path">
                  {s.path.map((p, i) => (
                    <span key={i} className="journey-step">
                      <span className="chip">{name(p)}</span>
                      {i < s.path.length - 1 && <span className="arrow">→</span>}
                    </span>
                  ))}
                  <span className="arrow">→</span><span className="chip chip--end">종료</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
