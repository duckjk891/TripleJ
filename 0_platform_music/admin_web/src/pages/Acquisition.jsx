import { useState, useEffect } from 'react';
import { getAcquisition } from '../api';

const DAYS_OPTS = [7, 30, 90];
const PLATFORM_LABELS = { web: '웹', ios: 'iOS 앱', android: '안드로이드 앱', unknown: '확인 안 됨' };

function Breakdown({ title, rows, labelKey = 'label', total }) {
  const sum = total ?? rows.reduce((a, r) => a + r.count, 0);
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <p className="cell-sub">데이터 없음</p> : rows.map((r) => {
        const pct = sum ? Math.round((r.count / sum) * 100) : 0;
        return (
          <div key={r[labelKey]} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: 4 }}>
              <span className="cell-main">{r[labelKey]}</span>
              <span>{r.count}명 <span className="cell-sub">({pct}%)</span></span>
            </div>
            <div className="progress-bar" style={{ marginTop: 0 }}><div style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export default function AcquisitionPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    getAcquisition(days).then((r) => setData(r.data)).catch(() => setError('가입·유입 데이터를 불러오지 못했습니다.'));
  }, [days]);

  const t = data?.totals;
  const platformRows = (data?.platforms || []).map((p) => ({ ...p, label: PLATFORM_LABELS[p.platform] || p.platform }));

  return (
    <div>
      <h2 className="page-title">가입 · 유입</h2>
      <div className="filters">
        <div className="filter-group">
          {DAYS_OPTS.map((d) => (
            <button key={d} className={`filter-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>최근 {d}일</button>
          ))}
        </div>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {!data ? (!error && <p className="loading">로딩 중…</p>) : (
        <>
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">가입자 (최근 {days}일)</span><span className="stat-value">{t.signups}</span></div>
            <div className="stat-card"><span className="stat-label">추천 코드로 가입</span><span className="stat-value">{t.referred}</span><span className="cell-sub">{t.signups ? Math.round((t.referred / t.signups) * 100) : 0}%</span></div>
            <div className="stat-card"><span className="stat-label">전체 회원</span><span className="stat-value">{t.users}</span><span className="cell-sub">일반 회원 (브랜드·운영·테스트 제외)</span></div>
            <div className="stat-card"><span className="stat-label">최근 7일 접속 회원</span><span className="stat-value">{t.active_7d}</span></div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Breakdown title={`가입 방식 (최근 ${days}일 가입자)`} rows={data.signup_methods} />
            <Breakdown title="로그인 방식 (최근 7일 접속 회원)" rows={data.active_methods} />
            <Breakdown title="로그인 방식 (전체 회원)" rows={data.all_methods} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Breakdown title={`추천인별 가입 (최근 ${days}일)`} rows={data.inviters} labelKey="inviter" total={t.signups} />
            <Breakdown title={`가입 플랫폼 (최근 ${days}일 가입자)`} rows={platformRows} />
          </div>
          <p className="cell-sub" style={{ marginBottom: 20 }}>
            추천인별 비율은 전체 가입자 대비입니다. 가입 플랫폼은 앱 사용 분석(9/24 웹부터 수집)에 잡힌 사용자만 구분되고, 그 전 가입자는 &apos;확인 안 됨&apos;으로 나옵니다.
            광고·SNS·스토어 검색 같은 외부 유입 경로는 아직 기록되지 않습니다.
          </p>

          <div className="card">
            <h3 className="section-title">일별 가입</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>날짜</th><th>가입</th><th>이메일</th><th>구글</th><th>카카오</th><th>추천 코드</th></tr></thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="nowrap">{d.date}</td>
                      <td className="cell-main">{d.total}</td>
                      <td>{d.local || 0}</td>
                      <td>{d.google || 0}</td>
                      <td>{d.kakao || 0}</td>
                      <td>{d.referred}</td>
                    </tr>
                  ))}
                  {data.daily.length === 0 && <tr><td colSpan={6} className="td-empty">기간 내 가입자가 없습니다</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
