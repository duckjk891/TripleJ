import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { getProfile } from '../api';
import { appConfirm } from './dialog';
import Brand from './Brand';
import Icon from './Icons';

// 회사 정보(사이드바 이름·임시 비밀번호 여부)를 하위 화면과 공유
const ProfileContext = createContext({ profile: null, reload: () => {} });
export const useProfile = () => useContext(ProfileContext);

const MENU = [
  { to: '/dashboard', label: '대시보드', icon: 'dashboard' },
  { to: '/items', label: '내 상품', icon: 'items', end: true },
  { to: '/items/upload', label: '엑셀로 한꺼번에 등록', icon: 'upload' },
  { to: '/profile', label: '회사 정보', icon: 'profile' },
  { to: '/password', label: '비밀번호 변경', icon: 'key' },
];

export default function Layout() {
  const { user, signOut, mustChange, setMustChange, demo, endDemo } = useAuth();
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

  const leaveDemo = () => { endDemo(); nav('/', { replace: true }); };
  const goInquiry = () => { endDemo(); nav('/', { replace: true }); setTimeout(() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }), 80); };

  const logout = async () => {
    if (demo) { leaveDemo(); return; }
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
          <button className="icon-btn" aria-label="메뉴 열기" onClick={() => setOpen(true)}><Icon name="menu" size={20} /></button>
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
                end={m.end}
                className={({ isActive }) => `side__link ${isActive ? 'is-on' : ''} ${mustChange && m.to !== '/password' ? 'is-locked' : ''}`}
                onClick={(e) => { if (mustChange && m.to !== '/password') e.preventDefault(); }}
              >
                <i aria-hidden="true"><Icon name={m.icon} /></i>{m.label}
              </NavLink>
            ))}
          </nav>
          <div className="side__foot">
            <a className="side__link" href="#/">MAIDOL Business 소개</a>
            <button className="side__link side__logout" onClick={logout}>{demo ? '예시 화면 나가기' : '로그아웃'}</button>
          </div>
        </aside>
        <main className="main">
          {demo && (
            <div className="demo-bar" role="note">
              <span><b>예시 화면</b> · 지금 보시는 숫자와 상품은 모두 지어낸 예시예요. 실제 광고주 화면과 같은 구성이고, 저장은 되지 않아요.</span>
              <span className="demo-bar__act">
                <button className="btn btn--primary btn--sm" onClick={goInquiry}>입점 문의하기</button>
                <button className="btn btn--sm" onClick={leaveDemo}>예시 화면 나가기</button>
              </span>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </ProfileContext.Provider>
  );
}
