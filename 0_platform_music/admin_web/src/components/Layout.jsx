import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { getCsUnreadCount, getReports, getIssueSummary } from '../api';

const MENU = [
  { group: '현황' },
  { to: '/', label: '대시보드', icon: '📊', end: true },
  { to: '/analytics', label: '사용 분석', icon: '📈' },
  { to: '/acquisition', label: '가입·유입', icon: '🚪' },
  { group: '소통 · 대응' },
  { to: '/messages', label: 'DM · 공지', icon: '💬', badge: 'cs' },
  { to: '/feeds', label: '피드', icon: '📝' },
  { to: '/reports', label: '신고 처리', icon: '🚨', badge: 'reports' },
  { to: '/issues', label: '오류 신고', icon: '🐞', badge: 'issues' },
  { group: '운영' },
  { to: '/tracks', label: '곡 관리', icon: '🎵' },
  { to: '/users', label: '사용자 관리', icon: '👥' },
  { to: '/stars', label: '별 관리', icon: '⭐' },
  { to: '/items', label: '착장 아이템', icon: '👕' },
  { to: '/brands', label: '브랜드/광고주', icon: '🏷️' },
  { group: '시스템' },
  { to: '/health', label: '시스템', icon: '🩺' },
  { to: '/logs', label: '관리 기록', icon: '📜' },
];

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [badges, setBadges] = useState({ cs: 0, reports: 0, issues: 0 });
  const [navOpen, setNavOpen] = useState(false);

  // 사이드바 배지 (1분 폴링) — 미읽음 문의 · 대기 신고 · 미처리 오류 신고
  useEffect(() => {
    let alive = true;
    const set = (k, v) => { if (alive) setBadges((b) => (b[k] === v ? b : { ...b, [k]: v })); };
    const tick = () => {
      getCsUnreadCount().then((r) => set('cs', r.data.count || 0)).catch(() => {});
      getReports({ status: 'pending', limit: 1 }).then((r) => set('reports', r.data.pagination?.total || 0)).catch(() => {});
      getIssueSummary().then((r) => set('issues', r.data.received || 0)).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 모바일: 화면 이동 시 메뉴 닫기, 열려 있는 동안 본문 스크롤 잠금
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const current = MENU.find((m) => m.to && (m.end ? location.pathname === m.to : location.pathname.startsWith(m.to)));
  const totalBadge = badges.cs + badges.reports + badges.issues;

  return (
    <div className={`layout ${navOpen ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button className="topbar__menu" aria-label="메뉴 열기" onClick={() => setNavOpen(true)}>
          <span /><span /><span />
          {totalBadge > 0 && <i className="topbar__dot" />}
        </button>
        <div className="topbar__title">{current ? current.label : 'MAIDOL Admin'}</div>
      </header>
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="sidebar__title">MAIDOL <span>Admin</span></div>
          <div className="sidebar__sub">관리자 콘솔</div>
          <button className="sidebar__close" aria-label="메뉴 닫기" onClick={() => setNavOpen(false)}>✕</button>
        </div>
        <nav className="sidebar__nav">
          {MENU.map((m) => (m.group ? (
            <div key={m.group} className="nav-group">{m.group}</div>
          ) : (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span>{m.icon}</span> {m.label}
              {m.badge && badges[m.badge] > 0 && <span className="nav-badge">{badges[m.badge]}</span>}
            </NavLink>
          )))}
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
