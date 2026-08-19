/* global __BUILD_TIME__ */
import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FiGrid, FiUsers, FiMusic, FiLogOut, FiFlag, FiMessageSquare, FiFileText, FiStar, FiShoppingBag, FiAlertCircle, FiBell } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { getCsUnreadCount } from '../api';
import csUnreadBus from '../utils/csUnreadBus';
import './AdminLayout.css';

const CS_UNREAD_POLL_MS = 30000;

// v187 — 구번들 오인 방지: vite.config.js 의 define 으로 주입된 번들 생성 시각(ISO).
// define 은 빌드 타임 상수 치환이라 HMR 로 갱신되지 않는다
// → dev 서버에서는 이 값이 "vite dev 프로세스 기동 시각"을 의미한다(빌드 산출물에서는 실제 빌드 시각).
// 표기 실패는 화면을 막지 않도록 빈 문자열로 흡수(주입 누락·파싱 실패 대비).
const BUILD_LABEL = (() => {
  try {
    const d = new Date(__BUILD_TIME__);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return '';
  }
})();

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

  // v195 — 대화를 열어 읽음 처리한 순간 뱃지를 즉시 깎는다(관리자 앱에 WS 가 없어 로컬 신호로 처리).
  // 위 30초 폴링이 권위값이며 델타 드리프트를 자동 교정한다 — 폴링을 대체하지 않는 보완 경로다.
  useEffect(() => {
    const off = csUnreadBus.subscribe((delta) => {
      if (import.meta.env.DEV) console.info('[AdminLayout] csUnread delta applied', { delta });
      setCsUnread((v) => Math.max(0, v + delta));
    });
    return off;
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
          <NavLink to="/points" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiStar /> 별 관리
          </NavLink>
          <NavLink to="/advertisers" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiShoppingBag /> 광고주 관리
          </NavLink>
          <NavLink to="/issues" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiAlertCircle /> 오류 신고
          </NavLink>
          <NavLink to="/notices" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <FiBell /> 공지 관리
          </NavLink>
        </nav>
        {BUILD_LABEL && (
          <div className="admin-sidebar__build" title="화면이 최신이 아니면 Ctrl+Shift+R">
            빌드 {BUILD_LABEL}
          </div>
        )}
      </aside>
      <main className="admin-content">
        {children}
      </main>
    </div>
  );
}
