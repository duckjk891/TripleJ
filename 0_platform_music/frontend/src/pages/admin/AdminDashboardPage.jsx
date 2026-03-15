import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { getAdminDashboard } from '../../api';
import './AdminDashboardPage.css';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await getAdminDashboard();
        setData(res.data);
      } catch (err) {
        setError('대시보드 데이터를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div className="admin-dashboard">
          <p className="admin-loading">로딩 중...</p>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="admin-dashboard">
          <p className="admin-error">{error}</p>
        </div>
      </AdminLayout>
    );
  }

  const stats = [
    { label: '총 사용자', value: data?.total_users ?? 0 },
    { label: '총 트랙', value: data?.total_tracks ?? 0 },
    { label: '총 재생수', value: data?.total_plays ?? 0 },
    { label: '오늘 가입자', value: data?.today_signups ?? 0 },
  ];

  return (
    <AdminLayout>
      <div className="admin-dashboard">
        <h2 className="admin-page-title">대시보드</h2>

        <div className="admin-stats-grid">
          {stats.map((s) => (
            <div key={s.label} className="admin-stat-card">
              <span className="admin-stat-label">{s.label}</span>
              <span className="admin-stat-value">{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="admin-tables-row">
          <div className="admin-table-section">
            <h3 className="admin-section-title">최근 가입 사용자</h3>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>닉네임</th>
                    <th>이메일</th>
                    <th>가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recent_users || []).map((u) => (
                    <tr key={u.id}>
                      <td>{u.nickname}</td>
                      <td>{u.email}</td>
                      <td>{formatDate(u.created_at)}</td>
                    </tr>
                  ))}
                  {(!data?.recent_users || data.recent_users.length === 0) && (
                    <tr><td colSpan={3} className="admin-empty">데이터가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-table-section">
            <h3 className="admin-section-title">최근 등록 트랙</h3>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>업로더</th>
                    <th>등록일</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recent_tracks || []).map((t) => (
                    <tr key={t.id}>
                      <td>{t.title}</td>
                      <td>{t.uploader_nickname || '-'}</td>
                      <td>{formatDate(t.created_at)}</td>
                    </tr>
                  ))}
                  {(!data?.recent_tracks || data.recent_tracks.length === 0) && (
                    <tr><td colSpan={3} className="admin-empty">데이터가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
