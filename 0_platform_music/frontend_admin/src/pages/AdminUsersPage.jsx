import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiSearch } from 'react-icons/fi';
import AdminLayout from '../components/AdminLayout';
import { getAdminUsers, updateUserRole, banUser, liftUserRestriction, resetUserStrikes } from '../api';
import { formatDate, isRestricted } from '../utils/format';
import './AdminUsersPage.css';

// v175 — formatDate / isRestricted 는 utils/format.js 로 공용화(로컬 정의 제거).

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

  // SanctionSquad(v145) — 생성 제한(2회 누적)만 해제, 위반 이력은 보존
  const handleLiftRestriction = async (user) => {
    const confirmed = window.confirm(
      `${user.nickname}의 생성 제한을 해제하시겠습니까?\n(위반 기록 ${user.violation_count ?? 0}회는 유지됩니다)`
    );
    if (!confirmed) return;
    if (import.meta.env.DEV) console.info('[AdminUsersPage] calling liftUserRestriction', { userId: user.id });
    try {
      await liftUserRestriction(user.id);
      fetchUsers();
    } catch (err) {
      console.error('[AdminUsersPage] liftUserRestriction failed', { err, userId: user.id });
      alert('생성 제한 해제에 실패했습니다.');
    }
  };

  // SanctionSquad(v145) — 위반 기록 전체 초기화(경고 0). 자동밴도 함께 해제됨
  const handleResetStrikes = async (user) => {
    const confirmed = window.confirm(
      `${user.nickname}의 위반 기록 ${user.violation_count ?? 0}회를 모두 초기화하시겠습니까?\n생성 제한도 함께 해제되며, 자동 정지 상태라면 정지도 풀립니다.`
    );
    if (!confirmed) return;
    if (import.meta.env.DEV) console.info('[AdminUsersPage] calling resetUserStrikes', { userId: user.id });
    try {
      await resetUserStrikes(user.id);
      fetchUsers();
    } catch (err) {
      console.error('[AdminUsersPage] resetUserStrikes failed', { err, userId: user.id });
      alert('위반 기록 초기화에 실패했습니다.');
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
                      <td>
                        {/* v175 — 사용자 상세(/users/:id) 진입점 */}
                        <Link to={`/users/${u.id}`} className="admin-users__user-link">
                          {u.nickname}
                        </Link>
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <span className={`admin-badge ${u.role === 'admin' ? 'admin-badge--green' : 'admin-badge--gray'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <div className="admin-status-cell">
                          <span className={`admin-badge ${u.is_banned ? 'admin-badge--red' : 'admin-badge--green'}`}>
                            {u.is_banned ? 'banned' : 'active'}
                          </span>
                          {(u.violation_count ?? 0) > 0 && (
                            <span className="admin-badge admin-badge--gray" title="커뮤니티 가이드 위반 누적">
                              위반 {u.violation_count}회
                            </span>
                          )}
                          {isRestricted(u) && (
                            <span className="admin-badge admin-badge--red" title={`생성 제한 만료: ${formatDate(u.restricted_until)}`}>
                              생성제한 ~{formatDate(u.restricted_until)}
                            </span>
                          )}
                        </div>
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
                        {isRestricted(u) && (
                          <button
                            className="admin-btn admin-btn--small admin-btn--primary"
                            onClick={() => handleLiftRestriction(u)}
                          >
                            제한 해제
                          </button>
                        )}
                        {(u.violation_count ?? 0) > 0 && (
                          <button
                            className="admin-btn admin-btn--small"
                            onClick={() => handleResetStrikes(u)}
                            title="위반 기록 전체 초기화 (경고 0)"
                          >
                            위반 초기화
                          </button>
                        )}
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
