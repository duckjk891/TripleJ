import { NavLink, Link } from 'react-router-dom';
import { FiGrid, FiUsers, FiMusic, FiArrowLeft } from 'react-icons/fi';
import './AdminLayout.css';

export default function AdminLayout({ children }) {
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__header">
          <h1 className="admin-sidebar__title">AIMU Admin</h1>
          <Link to="/" className="admin-sidebar__back">
            <FiArrowLeft /> 메인으로
          </Link>
        </div>
        <nav className="admin-sidebar__nav">
          <NavLink to="/admin" end className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiGrid /> 대시보드
          </NavLink>
          <NavLink to="/admin/users" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiUsers /> 사용자 관리
          </NavLink>
          <NavLink to="/admin/tracks" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiMusic /> 트랙 관리
          </NavLink>
        </nav>
      </aside>
      <main className="admin-content">
        {children}
      </main>
    </div>
  );
}
