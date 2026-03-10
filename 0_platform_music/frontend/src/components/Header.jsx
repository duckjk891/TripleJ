import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { FiSearch } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

export default function Header() {
  const { user, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  };

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="header__logo">
          <img src="/melon-logo.svg" alt="멜론" />
        </Link>

        <nav className="header__nav">
          <NavLink to="/chart">차트</NavLink>
          <NavLink to="/search">최신음악</NavLink>
          <NavLink to="/playlist">플레이리스트</NavLink>
        </nav>

        <form className="header__search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="검색어를 입력하세요"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="header__search-btn">
            <FiSearch />
          </button>
        </form>

        <div className="header__actions">
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
