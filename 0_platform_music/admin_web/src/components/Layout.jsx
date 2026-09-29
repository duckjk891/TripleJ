import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { getCsUnreadCount } from '../api';

const MENU = [
  { to: '/', label: '대시보드', icon: '📊', end: true },
  { to: '/analytics', label: '사용 분석', icon: '📈' },
  { to: '/acquisition', label: '가입·유입', icon: '🚪' },
  { to: '/messages', label: 'DM · 공지', icon: '💬', badge: 'cs' },
  { to: '/reports', label: '신고 처리', icon: '🚨' },
  { to: '/tracks', label: '곡 관리', icon: '🎵' },
  { to: '/users', label: '사용자 관리', icon: '👥' },
  { to: '/stars', label: '별 관리', icon: '⭐' },
  { to: '/items', label: '착장 아이템', icon: '👕' },
  { to: '/brands', label: '브랜드/광고주', icon: '🏷️' },
  { to: '/health', label: '시스템', icon: '🩺' },
];

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [csUnread, setCsUnread] = useState(0);

  // 공식 계정으로 온 미읽음 문의 — 사이드바 배지 (1분 폴링)
  useEffect(() => {
    let alive = true;
    const tick = () => getCsUnreadCount().then((r) => { if (alive) setCsUnread(r.data.count || 0); }).catch(() => {});
    tick();
    const t = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="sidebar__title">MAIDOL <span>Admin</span></div>
          <div className="sidebar__sub">관리자 콘솔</div>
        </div>
        <nav className="sidebar__nav">
          {MENU.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span>{m.icon}</span> {m.label}
              {m.badge === "cs" && csUnread > 0 && <span className="nav-badge">{csUnread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="who">{user?.nickname} ({user?.email})</div>
          <button className="btn-logout" onClick={handleLogout}>로그아웃</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
