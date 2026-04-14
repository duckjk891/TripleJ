import { useState, useEffect, useCallback } from 'react';
import { FiSearch } from 'react-icons/fi';
import AdminLayout from '../../components/AdminLayout';
import { getAdminUsers, updateUserRole, banUser } from '../../api';
import './AdminUsersPage.css';

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

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminUsers({ search, page, limit: 20 });
      setUsers(res.data.users || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateUserRole(userId, newRole);
      fetchUsers();
    } catch {
      alert('역할 변경에 실패했습니다.');
    }
  };

  const handleBan = async (user) => {
    if (user.is_banned) {
      const confirmed = window.confirm(
        `${user.nickname}의 밴을 해제하시겠습니까?`
      );
      if (!confirmed) return;
      try {
        await banUser(user.id, false, '');
        fetchUsers();
      } catch {
        alert('밴 해제에 실패했습니다.');
      }
    } else {
      const reason = window.prompt(`${user.nickname}을(를) 밴 처리합니다. 사유를 입력하세요:`);
      if (reason === null) return;
      try {
        await banUser(user.id, true, reason);
        fetchUsers();
      } catch {
        alert('밴 처리에 실패했습니다.');
      }
    }
  };

  return (
    <AdminLayout>
      <div className="admin-users">
        <h2 className="admin-page-title">사용자 관리</h2>

        <form className="admin-search-form" onSubmit={handleSearch}>
          <div className="admin-search-input-wrap">
            <FiSearch className="admin-search-icon" />
            <input
              type="text"
              placeholder="이메일 또는 닉네임 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="admin-search-input"
            />
          </div>
          <button type="submit" className="admin-search-btn">검색</button>
        </form>

        {error && <p className="admin-error">{error}</p>}

        {loading ? (
          <p className="admin-loading">로딩 중...</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--full">
                <thead>
                  <tr>
                    <th>닉네임</th>
                    <th>이메일</th>
                    <th>역할</th>
                    <th>상태</th>
                    <th>가입일</th>
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.nickname}</td>
                      <td>{u.email}</td>
                      <td>
                        <span className={`admin-badge ${u.role === 'admin' ? 'admin-badge--green' : 'admin-badge--gray'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-badge ${u.is_banned ? 'admin-badge--red' : 'admin-badge--green'}`}>
                          {u.is_banned ? 'banned' : 'active'}
                        </span>
                      </td>
                      <td>{formatDate(u.created_at)}</td>
                      <td className="admin-actions">
                        <select
                          className="admin-role-select"
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        >
                          <option value="user">user</option>
                          <option value="customer">customer</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          className={`admin-btn admin-btn--small ${u.is_banned ? 'admin-btn--primary' : 'admin-btn--danger'}`}
                          onClick={() => handleBan(u)}
                        >
                          {u.is_banned ? '밴 해제' : '밴'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={6} className="admin-empty">사용자가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="admin-pagination">
                <button
                  className="admin-btn admin-btn--small"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  이전
                </button>
                <span className="admin-pagination__info">{page} / {totalPages}</span>
                <button
                  className="admin-btn admin-btn--small"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
