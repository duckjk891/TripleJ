import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard, getReports, getItems, getActiveUsers } from '../api';

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [pendingReports, setPendingReports] = useState(null);
  const [itemTotal, setItemTotal] = useState(null);
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getActiveUsers(14)
      .then((res) => setActive(res.data))
      .catch(() => {});
    getDashboard()
      .then((res) => setData(res.data))
      .catch(() => setError('대시보드 데이터를 불러오지 못했습니다.'));
    getReports({ status: 'pending', limit: 1 })
      .then((res) => setPendingReports(res.data.pagination?.total ?? 0))
      .catch(() => {});
    getItems({ limit: 1 })
      .then((res) => setItemTotal(res.data.pagination?.total ?? 0))
      .catch(() => {});
  }, []);

  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return <div className="loading">로딩 중…</div>;

  const today = active?.today;
  const yesterday = active?.yesterday;
  const stats = [
    { label: '오늘 접속자', value: today?.active ?? null, sub: yesterday ? `어제 ${yesterday.active.toLocaleString()}명` : null },
    { label: '최근 7일 접속자', value: active?.week_active ?? null, sub: '중복 제외' },
    { label: '오늘 가입자', value: today?.signups ?? data.today_signups, sub: yesterday ? `어제 ${yesterday.signups.toLocaleString()}명` : null },
    { label: '누적 가입자', value: data.total_users, sub: '가입 계정 수' },
    { label: '누적 트랙', value: data.total_tracks },
    { label: '누적 재생수', value: data.total_plays },
    { label: '대기 중 신고', value: pendingReports, warn: pendingReports > 0, to: '/reports' },
    { label: '착장 아이템', value: itemTotal, to: '/items' },
  ];
  const daily = active?.daily || [];
  const maxActive = Math.max(1, ...daily.map((d) => d.active));

  return (
    <div>
      <h2 className="page-title">대시보드</h2>
      <div className="stats-grid">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`stat-card ${s.to ? 'stat-card--link' : ''}`}
            onClick={s.to ? () => navigate(s.to) : undefined}
          >
            <span className="stat-label">{s.label}</span>
            <span className={`stat-value ${s.warn ? 'warn' : ''}`}>
              {s.value == null ? '…' : s.value.toLocaleString()}
            </span>
            {s.sub && <span className="cell-sub">{s.sub}</span>}
          </div>
        ))}
      </div>

      {daily.length > 0 && (
        <div className="card">
          <h3 className="section-title">최근 14일 접속자 · 가입자</h3>
          <div className="dau-chart">
            {daily.map((d) => (
              <div key={d.date} className="dau-col" title={`${d.date} 접속 ${d.active} · 가입 ${d.signups}`}>
                <span className="dau-num">{d.active}</span>
                <div className="dau-bar" style={{ height: `${(d.active / maxActive) * 100}%` }} />
                <span className="dau-signup">{d.signups > 0 ? `+${d.signups}` : ''}</span>
                <span className="dau-date">{d.date.slice(5).replace('-', '/')}</span>
              </div>
            ))}
          </div>
          <p className="cell-sub" style={{ marginTop: 10 }}>
            접속자 = 그날 로그인 상태로 앱을 사용한 사용자 수 (KST, 비회원 제외). 막대 아래 +숫자는 그날 가입자.
            9/24 이전 값은 재생·포인트·곡 생성 등 활동 기록으로 복원한 값이라 실제보다 약간 낮을 수 있습니다.
          </p>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">최근 가입 사용자</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>닉네임</th><th>이메일</th><th>역할</th><th>가입일</th></tr>
            </thead>
            <tbody>
              {(data.recent_users || []).map((u) => (
                <tr key={u.id}>
                  <td className="cell-main">{u.nickname}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge--purple' : 'badge--gray'}`}>{u.role}</span>
                    {u.is_banned && <span className="badge badge--red" style={{ marginLeft: 6 }}>정지</span>}
                  </td>
                  <td className="nowrap">{formatDate(u.created_at)}</td>
                </tr>
              ))}
              {(!data.recent_users || data.recent_users.length === 0) && (
                <tr><td colSpan={4} className="td-empty">데이터가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">최근 등록 트랙</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>제목</th><th>업로더</th><th>공개</th><th>등록일</th></tr>
            </thead>
            <tbody>
              {(data.recent_tracks || []).map((t) => (
                <tr key={t.id}>
                  <td className="cell-main">{t.title}</td>
                  <td>{t.uploader_nickname || '-'}</td>
                  <td>
                    <span className={`badge ${t.is_public ? 'badge--green' : 'badge--gray'}`}>
                      {t.is_public ? '공개' : '비공개'}
                    </span>
                  </td>
                  <td className="nowrap">{formatDate(t.created_at)}</td>
                </tr>
              ))}
              {(!data.recent_tracks || data.recent_tracks.length === 0) && (
                <tr><td colSpan={4} className="td-empty">데이터가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
