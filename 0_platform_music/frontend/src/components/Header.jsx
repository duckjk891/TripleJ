import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { FiSearch, FiMenu, FiX } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

export default function Header() {
  const { user, logout, isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="header__logo">
          <img src="/aimu-logo.svg" alt="AIMU" />
        </Link>

        <nav className={`header__nav ${menuOpen ? 'header__nav--open' : ''}`}>
          <button className="header__nav-close" onClick={closeMenu}>
            <FiX />
          </button>
          <NavLink to="/chart" onClick={closeMenu}>AI 차트</NavLink>
          <NavLink to="/search" onClick={closeMenu}>Discover</NavLink>
          <NavLink to="/playlist" onClick={closeMenu}>플레이리스트</NavLink>
          {user && <NavLink to="/my-music" onClick={closeMenu}>내 음악</NavLink>}
          {user && isAdmin && <NavLink to="/admin" onClick={closeMenu}>관리자</NavLink>}
        </nav>

        <form className="header__search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="AI 음악 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="header__search-btn">
            <FiSearch />
          </button>
        </form>

        <div className="header__actions">
          <button
            className="header__menu-btn"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <FiMenu />
          </button>
          {user ? (
            <div className="header__user">
              <span className="header__nickname">{user.nickname}</span>
              <button className="header__logout-btn" onClick={logout}>
                로그아웃
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="header__login-btn">
                로그인
              </Link>
              <Link to="/register" className="header__register-btn">
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
