import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './Header.css';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore — 로컬 토큰만 정리해도 충분
    }
    logout();
    navigate('/');
  };

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__logo">Wedding MV</Link>
        <nav className="site-header__nav">
          {user ? (
            <>
              <Link to="/my" className="nav-link">내 작품</Link>
              <Link to="/items" className="nav-link">아이템관리</Link>
              <button type="button" className="btn-ghost" onClick={handleLogout}>
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-link">로그인</Link>
              <Link to="/register" className="btn-primary">가입</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
