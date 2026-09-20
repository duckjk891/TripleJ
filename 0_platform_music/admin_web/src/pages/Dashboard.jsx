import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard, getReports, getItems } from '../api';

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
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
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

  const stats = [
    { label: '총 사용자', value: data.total_users },
    { label: '총 트랙', value: data.total_tracks },
    { label: '총 재생수', value: data.total_plays },
    { label: '오늘 가입자', value: data.today_signups },
    { label: '대기 중 신고', value: pendingReports, warn: pendingReports > 0, to: '/reports' },
    { label: '착장 아이템', value: itemTotal, to: '/items' },
  ];

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
          </div>
        ))}
      </div>

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
