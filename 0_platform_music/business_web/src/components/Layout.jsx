import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { getProfile } from '../api';
import { appConfirm } from './dialog';
import Brand from './Brand';

// 회사 정보(사이드바 이름·임시 비밀번호 여부)를 하위 화면과 공유
const ProfileContext = createContext({ profile: null, reload: () => {} });
export const useProfile = () => useContext(ProfileContext);

const MENU = [
  { to: '/dashboard', label: '대시보드', icon: '◎' },
  { to: '/items', label: '내 상품', icon: '▦' },
  { to: '/profile', label: '회사 정보', icon: '✎' },
  { to: '/password', label: '비밀번호 변경', icon: '⚿' },
];

export default function Layout() {
  const { user, signOut, mustChange, setMustChange } = useAuth();
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  const reload = () =>
    getProfile()
      .then((res) => {
        setProfile(res.data);
        const must = Boolean(res.data?.must_change_password);
        setMustChange(must);
        if (must) nav('/password', { replace: true });
      })
      .catch(() => {});

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const logout = async () => {
    if (await appConfirm('로그아웃할까요?', { okText: '로그아웃' })) {
      signOut();
      nav('/login', { replace: true });
    }
  };

  const company = profile?.company_name || user?.nickname || '광고주';

  return (
    <ProfileContext.Provider value={{ profile, reload }}>
      <div className="app">
        <header className="topbar">
          <button className="icon-btn" aria-label="메뉴 열기" onClick={() => setOpen(true)}>☰</button>
          <Brand small />
          <span className="topbar__co">{company}</span>
        </header>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`side ${open ? 'side--open' : ''}`}>
          <div className="side__brand"><Brand small /></div>
          <div className="side__co">
            <b>{company}</b>
            <span>{user?.email}</span>
          </div>
          <nav className="side__nav">
            {MENU.map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                className={({ isActive }) => `side__link ${isActive ? 'is-on' : ''} ${mustChange && m.to !== '/password' ? 'is-locked' : ''}`}
                onClick={(e) => { if (mustChange && m.to !== '/password') e.preventDefault(); }}
              >
                <i aria-hidden="true">{m.icon}</i>{m.label}
              </NavLink>
            ))}
          </nav>
          <div className="side__foot">
            <a className="side__link" href="#/">MAIDOL Business 소개</a>
            <button className="side__link side__logout" onClick={logout}>로그아웃</button>
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </ProfileContext.Provider>
  );
}
