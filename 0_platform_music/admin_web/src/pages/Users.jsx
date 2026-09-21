import { useState, useEffect, useCallback } from 'react';
import { getUsers, updateUserRole, banUser } from '../api';
import { formatDate } from './Dashboard';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [banned, setBanned] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { search, page, limit: 20 };
      if (banned !== 'all') params.banned = banned === 'banned';
      const res = await getUsers(params);
      setUsers(res.data.users || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      setError('사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search, page, banned]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleRole = async (u) => {
    const next = u.role === 'admin' ? 'user' : 'admin';
    if (!(await appConfirm(`${u.nickname} 님의 역할을 "${next}" 로 변경하시겠습니까?`))) return;
    try {
      await updateUserRole(u.id, next);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '역할 변경에 실패했습니다.');
    }
  };

  const handleBan = async (u) => {
    if (u.is_banned) {
      if (!(await appConfirm(`${u.nickname} 님의 정지를 해제하시겠습니까?`))) return;
      try {
        await banUser(u.id, false);
        fetchList();
      } catch (err) {
        await appAlert(err.response?.data?.error || '정지 해제에 실패했습니다.');
      }
      return;
    }
    const reason = await appPrompt(`${u.nickname} 님을 정지합니다. 사유를 입력하세요:`);
    if (reason === null) return;
    try {
      await banUser(u.id, true, reason);
      fetchList();
    } catch (err) {
      await appAlert(err.response?.data?.error || '정지에 실패했습니다.');
    }
  };

  return (
    <div>
      <h2 className="page-title">사용자 관리</h2>

      <div className="filters">
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setPage(1); fetchList(); }}>
          <input
            className="input" type="text" placeholder="이메일·닉네임 검색"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" type="submit">검색</button>
        </form>
        <div className="filter-group">
          {[['all', '전체'], ['active', '정상'], ['banned', '정지']].map(([v, l]) => (
            <button key={v} className={`filter-btn ${banned === v ? 'active' : ''}`}
              onClick={() => { setBanned(v); setPage(1); }}>{l}</button>
          ))}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading ? <p className="loading">로딩 중…</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>닉네임</th><th>이메일</th><th>역할</th><th>상태</th><th>가입일</th><th>액션</th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-main">{u.nickname}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${u.role === 'admin' ? 'badge--purple' : 'badge--gray'}`}>{u.role}</span></td>
                    <td>
                      {u.is_banned
                        ? <span className="badge badge--red" title={u.ban_reason || ''}>정지</span>
                        : <span className="badge badge--green">정상</span>}
                    </td>
                    <td className="nowrap">{formatDate(u.created_at)}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn--sm" onClick={() => handleRole(u)}>
                          {u.role === 'admin' ? '관리자 해제' : '관리자로'}
                        </button>
                        <button className={`btn btn--sm ${u.is_banned ? '' : 'btn--danger'}`} onClick={() => handleBan(u)}>
                          {u.is_banned ? '정지 해제' : '정지'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={6} className="td-empty">사용자가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
              <span className="pagination__info">{page} / {totalPages}</span>
              <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
