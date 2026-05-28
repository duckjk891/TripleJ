import { useEffect, useState } from 'react';
import * as api from '../api';
import { useAuth } from '../contexts/AuthContext';
import './AdminUsersPage.css';

const DEV = import.meta.env?.DEV;

function formatDate(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return String(value);
  }
}

const ROLE_LABEL = {
  user: '일반',
  admin: '관리자',
};

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pendingId, setPendingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAdminUsers()
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.users || [];
        setUsers(list);
        if (DEV) {
          // eslint-disable-next-line no-console
          console.info('[AdminUsersPage] loaded', { count: list.length });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[AdminUsersPage] fetch failed', err);
        setError('사용자 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  };

  const handleRoleChange = async (target) => {
    const newRole = target.role === 'admin' ? 'user' : 'admin';
    const nickname = target.nickname || target.email || '사용자';
    const confirmMsg = `${nickname} 의 등급을 ${ROLE_LABEL[newRole]} 로 변경하시겠습니까?`;
    if (!window.confirm(confirmMsg)) return;

    if (DEV) {
      // eslint-disable-next-line no-console
      console.info('[AdminUsersPage] role change request', {
        target_user_id: target.id,
        new_role: newRole,
      });
    }

    setPendingId(target.id);
    try {
      await api.updateUserRole(target.id, newRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, role: newRole } : u))
      );
      showToast(`${nickname} 의 등급을 ${ROLE_LABEL[newRole]} 로 변경했습니다.`);
    } catch (err) {
      console.error('[AdminUsersPage] role change failed', err);
      const status = err?.response?.status;
      let msg;
      if (status === 409) {
        msg = '이 사용자의 등급은 변경할 수 없습니다.';
      } else if (status === 403) {
        msg = '권한이 없습니다.';
      } else {
        msg = '등급 변경에 실패했습니다.';
      }
      showToast(msg);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="admin-users">
      <div className="admin-users__head">
        <h1 className="admin-users__title">사용자 관리</h1>
        <p className="admin-users__desc muted">
          등급을 변경하면 해당 사용자의 다음 로그인부터 반영됩니다.
        </p>
      </div>

      {toast && <div className="admin-users__toast">{toast}</div>}

      {loading && <p className="muted">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && users.length > 0 && (
        <div className="admin-users__table-wrap">
          <table className="admin-users__table">
            <thead>
              <tr>
                <th>이메일</th>
                <th>닉네임</th>
                <th>등급</th>
                <th>가입일</th>
                <th>동작</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = currentUser && currentUser.id === u.id;
                const isSeed = u.email === 'admin';
                const disabled = isSelf || isSeed || pendingId === u.id;
                const targetLabel = u.role === 'admin' ? '일반으로' : '관리자로';
                const tooltip =
                  isSelf || isSeed ? '강등할 수 없습니다' : undefined;
                return (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.nickname || '-'}</td>
                    <td>
                      <span
                        className={
                          u.role === 'admin'
                            ? 'admin-users__role--admin'
                            : 'admin-users__role'
                        }
                      >
                        {ROLE_LABEL[u.role] || u.role || '-'}
                      </span>
                    </td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost admin-users__action"
                        onClick={() => handleRoleChange(u)}
                        disabled={disabled}
                        title={tooltip}
                      >
                        {pendingId === u.id ? '변경 중...' : targetLabel}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div className="card admin-users__empty">
          <p>등록된 사용자가 없습니다.</p>
        </div>
      )}
    </section>
  );
}
