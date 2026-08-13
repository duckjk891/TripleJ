import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import RecentContentPane from '../components/RecentContentPane';
import { getAdminUser, updateUserRole, banUser, liftUserRestriction, resetUserStrikes } from '../api';
import { formatDate, isRestricted } from '../utils/format';
import './AdminUserDetailPage.css';

// v175 — 관리자 사용자 상세 (/users/:id).
// GET /api/admin/users/{id} 실재 필드만 표시(포인트·본인인증 필드는 응답에 없음 — 미표시).
// 액션은 AdminUsersPage 관행(confirm/prompt) 재사용, 성공 시 상세 재조회.
// 로그 태그: [AdminUserDetail] — 이메일 등 개인정보 원문은 콘솔에 출력하지 않는다(userId 만).

const ERROR_NOT_FOUND = 'not_found';
const ERROR_LOAD = 'load_failed';

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 프로필 이미지 로드 실패 src 기록 — src 비교 방식이라 유저 전환 시 별도 리셋 불요
  const [failedImgSrc, setFailedImgSrc] = useState(null);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setError('');
    if (import.meta.env.DEV) console.info('[AdminUserDetail] fetching user', { userId: id });
    try {
      const res = await getAdminUser(id);
      setUser(res.data);
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminUserDetail] fetch failed', { userId: id, status });
      // 400(UUID 불량)도 "없는 사용자" 와 동일 취급
      setError(status === 404 || status === 400 ? ERROR_NOT_FOUND : ERROR_LOAD);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // 기존 페이지 관행(AdminUsersPage fetchUsers-in-effect)과 동일 패턴 — codebase-wide 후속 정리 대상
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUser();
  }, [fetchUser]);

  const handleRoleChange = async (newRole) => {
    if (import.meta.env.DEV) console.info('[AdminUserDetail] calling updateUserRole', { userId: id, newRole });
    try {
      await updateUserRole(id, newRole);
      fetchUser();
    } catch (err) {
      console.error('[AdminUserDetail] updateUserRole failed', { err, userId: id });
      alert('역할 변경에 실패했습니다.');
    }
  };

  const handleBan = async () => {
    if (user.is_banned) {
      const confirmed = window.confirm(`${user.nickname}의 밴을 해제하시겠습니까?`);
      if (!confirmed) return;
      if (import.meta.env.DEV) console.info('[AdminUserDetail] calling banUser (unban)', { userId: id });
      try {
        await banUser(id, false, '');
        fetchUser();
      } catch (err) {
        console.error('[AdminUserDetail] unban failed', { err, userId: id });
        alert('밴 해제에 실패했습니다.');
      }
    } else {
      const reason = window.prompt(`${user.nickname}을(를) 밴 처리합니다. 사유를 입력하세요:`);
      if (reason === null) return;
      if (import.meta.env.DEV) console.info('[AdminUserDetail] calling banUser (ban)', { userId: id });
      try {
        await banUser(id, true, reason);
        fetchUser();
      } catch (err) {
        console.error('[AdminUserDetail] ban failed', { err, userId: id });
        alert('밴 처리에 실패했습니다.');
      }
    }
  };

  // SanctionSquad(v145) — 생성 제한(2회 누적)만 해제, 위반 이력은 보존
  const handleLiftRestriction = async () => {
    const confirmed = window.confirm(
      `${user.nickname}의 생성 제한을 해제하시겠습니까?\n(위반 기록 ${user.violation_count ?? 0}회는 유지됩니다)`
    );
    if (!confirmed) return;
    if (import.meta.env.DEV) console.info('[AdminUserDetail] calling liftUserRestriction', { userId: id });
    try {
      await liftUserRestriction(id);
      fetchUser();
    } catch (err) {
      console.error('[AdminUserDetail] liftUserRestriction failed', { err, userId: id });
      alert('생성 제한 해제에 실패했습니다.');
    }
  };

  // SanctionSquad(v145) — 위반 기록 전체 초기화(경고 0). 자동밴도 함께 해제됨
  const handleResetStrikes = async () => {
    const confirmed = window.confirm(
      `${user.nickname}의 위반 기록 ${user.violation_count ?? 0}회를 모두 초기화하시겠습니까?\n생성 제한도 함께 해제되며, 자동 정지 상태라면 정지도 풀립니다.`
    );
    if (!confirmed) return;
    if (import.meta.env.DEV) console.info('[AdminUserDetail] calling resetUserStrikes', { userId: id });
    try {
      await resetUserStrikes(id);
      fetchUser();
    } catch (err) {
      console.error('[AdminUserDetail] resetUserStrikes failed', { err, userId: id });
      alert('위반 기록 초기화에 실패했습니다.');
    }
  };

  const restricted = isRestricted(user);

  // 예상외 분기 — 로딩/에러 아님인데 user 없음 (정상 흐름에선 도달 불가)
  if (!loading && !error && !user) {
    console.warn('[AdminUserDetail] unexpected empty state', { userId: id });
  }

  return (
    <AdminLayout>
      <div className="admin-user-detail">
        <Link to="/users" className="admin-user-detail__back">← 사용자 목록</Link>
        <h2 className="admin-page-title">사용자 상세</h2>

        {loading ? (
          <p className="admin-loading">로딩 중...</p>
        ) : error === ERROR_NOT_FOUND ? (
          <div className="admin-user-detail__notfound">
            <p className="admin-error">사용자를 찾을 수 없습니다.</p>
            <Link to="/users" className="admin-btn admin-btn--small">목록으로</Link>
          </div>
        ) : error === ERROR_LOAD ? (
          <div className="admin-user-detail__notfound">
            <p className="admin-error">사용자 정보를 불러오지 못했습니다.</p>
            <div className="admin-actions">
              <button className="admin-btn admin-btn--small" onClick={fetchUser}>다시 시도</button>
              <Link to="/users" className="admin-btn admin-btn--small">목록으로</Link>
            </div>
          </div>
        ) : user ? (
          <div className="admin-user-detail__sections">
            {/* ① 프로필 */}
            <section className="admin-user-detail__section">
              <h3 className="admin-user-detail__section-title">프로필</h3>
              <div className="admin-user-detail__profile">
                {user.profile_image && user.profile_image !== failedImgSrc ? (
                  <img
                    className="admin-user-detail__avatar"
                    src={user.profile_image}
                    alt=""
                    onError={() => setFailedImgSrc(user.profile_image)}
                  />
                ) : (
                  <span className="admin-user-detail__avatar admin-user-detail__avatar--empty">
                    {(user.nickname || '?').slice(0, 1)}
                  </span>
                )}
                <div className="admin-user-detail__profile-main">
                  <span className="admin-user-detail__nickname">
                    {user.nickname || '-'}
                    <span className={`admin-badge ${user.role === 'admin' ? 'admin-badge--green' : 'admin-badge--gray'}`}>
                      {user.role}
                    </span>
                    <span className="admin-badge admin-badge--gray">{user.plan || '-'}</span>
                  </span>
                  <span className="admin-user-detail__email">{user.email}</span>
                  {user.bio && <p className="admin-user-detail__bio">{user.bio}</p>}
                  <div className="admin-user-detail__meta">
                    <span>가입일 {formatDate(user.created_at)}</span>
                    <span title="user id">id {user.id}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ② 활동 */}
            <section className="admin-user-detail__section">
              <h3 className="admin-user-detail__section-title">활동</h3>
              <div className="admin-user-detail__stats">
                <div className="admin-user-detail__stat">
                  <span className="admin-user-detail__stat-value">{user.track_count ?? 0}</span>
                  <span className="admin-user-detail__stat-label">트랙</span>
                </div>
                <div className="admin-user-detail__stat">
                  <span className="admin-user-detail__stat-value">{user.total_plays ?? 0}</span>
                  <span className="admin-user-detail__stat-label">총 재생수</span>
                </div>
                <div className="admin-user-detail__stat">
                  <span className="admin-user-detail__stat-value">{user.violation_count ?? 0}</span>
                  <span className="admin-user-detail__stat-label">위반 누적</span>
                </div>
              </div>
            </section>

            {/* ③ 제재 상태 */}
            <section className="admin-user-detail__section">
              <h3 className="admin-user-detail__section-title">제재 상태</h3>
              <div className="admin-user-detail__sanction">
                <div className="admin-user-detail__sanction-row">
                  <span className="admin-user-detail__sanction-label">계정 상태</span>
                  <span className={`admin-badge ${user.is_banned ? 'admin-badge--red' : 'admin-badge--green'}`}>
                    {user.is_banned ? 'banned' : 'active'}
                  </span>
                  {user.is_banned && user.banned_at && <span>밴 일시 {formatDate(user.banned_at)}</span>}
                </div>
                {user.is_banned && (
                  <div className="admin-user-detail__sanction-row">
                    <span className="admin-user-detail__sanction-label">밴 사유</span>
                    <span>{user.ban_reason || '-'}</span>
                  </div>
                )}
                <div className="admin-user-detail__sanction-row">
                  <span className="admin-user-detail__sanction-label">생성 제한</span>
                  {restricted ? (
                    <span className="admin-badge admin-badge--red" title={`생성 제한 만료: ${formatDate(user.restricted_until)}`}>
                      생성제한 ~{formatDate(user.restricted_until)}
                    </span>
                  ) : (
                    <span className="admin-badge admin-badge--green">없음</span>
                  )}
                </div>
                <div className="admin-user-detail__sanction-row">
                  <span className="admin-user-detail__sanction-label">위반 기록</span>
                  {(user.violation_count ?? 0) > 0 ? (
                    <span className="admin-badge admin-badge--gray" title="커뮤니티 가이드 위반 누적">
                      위반 {user.violation_count}회
                    </span>
                  ) : (
                    <span className="admin-badge admin-badge--green">없음</span>
                  )}
                </div>
              </div>
            </section>

            {/* ④ 액션 */}
            <section className="admin-user-detail__section">
              <h3 className="admin-user-detail__section-title">액션</h3>
              <div className="admin-actions">
                <select
                  className="admin-role-select"
                  value={user.role}
                  onChange={(e) => handleRoleChange(e.target.value)}
                >
                  <option value="user">user</option>
                  <option value="customer">customer</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  className={`admin-btn admin-btn--small ${user.is_banned ? 'admin-btn--primary' : 'admin-btn--danger'}`}
                  onClick={handleBan}
                >
                  {user.is_banned ? '밴 해제' : '밴'}
                </button>
                {restricted && (
                  <button
                    className="admin-btn admin-btn--small admin-btn--primary"
                    onClick={handleLiftRestriction}
                  >
                    제한 해제
                  </button>
                )}
                {(user.violation_count ?? 0) > 0 && (
                  <button
                    className="admin-btn admin-btn--small"
                    onClick={handleResetStrikes}
                    title="위반 기록 전체 초기화 (경고 0)"
                  >
                    위반 초기화
                  </button>
                )}
              </div>
            </section>

            {/* ⑤ 최근 생성물 — RecentContentPane 재사용 (신고 페이지 양면 뷰와 동일) */}
            <section className="admin-user-detail__section">
              <h3 className="admin-user-detail__section-title">최근 생성물</h3>
              <RecentContentPane userId={user.id} />
            </section>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
