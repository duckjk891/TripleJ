import { NavLink, useNavigate } from 'react-router-dom';
import { FiGrid, FiUsers, FiMusic, FiLogOut, FiFlag } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import './AdminLayout.css';

// v162 — 관리자 독립 앱: 라우트 루트 승격(/, /users, /tracks, /reports).
// "메인으로" 백링크는 삭제(사용자 앱 origin 이 환경별로 달라 하드코딩 부적절) → 로그아웃 버튼.
export default function AdminLayout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

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
        </nav>
      </aside>
      <main className="admin-content">
        {children}
      </main>
    </div>
  );
}
