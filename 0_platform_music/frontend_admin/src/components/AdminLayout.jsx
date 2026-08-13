import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FiGrid, FiUsers, FiMusic, FiLogOut, FiFlag, FiMessageSquare, FiFileText } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { getCsUnreadCount } from '../api';
import './AdminLayout.css';

const CS_UNREAD_POLL_MS = 30000;

// v162 — 관리자 독립 앱: 라우트 루트 승격(/, /users, /tracks, /reports).
// "메인으로" 백링크는 삭제(사용자 앱 origin 이 환경별로 달라 하드코딩 부적절) → 로그아웃 버튼.
export default function AdminLayout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  // CS 미읽음 뱃지 — 30초 폴링(비차단, 실패 시 조용히 0 유지)
  const [csUnread, setCsUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const fetchUnread = () => {
      getCsUnreadCount()
        .then(({ data }) => {
          if (alive && typeof data?.count === 'number') setCsUnread(data.count);
        })
        .catch((err) => {
          console.error('[AdminLayout] getCsUnreadCount failed', { status: err?.response?.status, message: err?.message });
        });
    };
    fetchUnread();
    const timer = setInterval(fetchUnread, CS_UNREAD_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const handleLogout = () => {
    if (import.meta.env.DEV) console.info('[AdminLayout] logout');
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__header">
          <h1 className="admin-sidebar__title">MAIDOL Admin</h1>
          <button type="button" className="admin-sidebar__logout" onClick={handleLogout}>
            <FiLogOut /> 로그아웃
          </button>
        </div>
        <nav className="admin-sidebar__nav">
          <NavLink to="/" end className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiGrid /> 대시보드
          </NavLink>
          <NavLink to="/users" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiUsers /> 사용자 관리
          </NavLink>
          <NavLink to="/tracks" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiMusic /> 트랙 관리
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiFlag /> 신고 관리
          </NavLink>
          <NavLink to="/cs" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiMessageSquare /> CS 문의
            {csUnread > 0 && (
              <span className="admin-nav-badge">{csUnread > 99 ? '99+' : csUnread}</span>
            )}
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiFileText /> 감사 로그
          </NavLink>
        </nav>
      </aside>
      <main className="admin-content">
        {children}
      </main>
    </div>
  );
}
