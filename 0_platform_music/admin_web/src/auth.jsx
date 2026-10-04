import { createContext, useContext, useEffect, useState } from 'react';
import { getToken, getStoredUser, saveAuth, clearAuth, getTokenIssuedAt, refreshSession } from './api';

const AuthContext = createContext(null);

// 자동 로그인 — 토큰(7일)이 발급된 지 12시간이 넘었으면 접속 시 조용히 재발급한다.
// 한 번이라도 7일 안에 접속하면 로그인이 계속 유지된다. 열어둔 탭은 6시간마다 점검.
const REFRESH_AFTER_MS = 12 * 3600 * 1000;
const CHECK_EVERY_MS = 6 * 3600 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());

  const signIn = (token, userInfo, remember) => {
    saveAuth(token, userInfo, remember);
    setUser(userInfo);
  };

  const signOut = () => {
    clearAuth();
    setUser(null);
  };

  const isAuthed = Boolean(getToken() && user && user.role === 'admin');

  useEffect(() => {
    if (!isAuthed) return undefined;
    let alive = true;
    const maybeRefresh = () => {
      if (!getToken() || Date.now() - getTokenIssuedAt() < REFRESH_AFTER_MS) return;
      refreshSession()
        .then((res) => {
          if (!alive || !res.data?.token) return;
          saveAuth(res.data.token, res.data.user);
          setUser(res.data.user);
        })
        .catch(() => {}); // 만료(401/403)는 api 인터셉터가 로그인 화면으로 보냄
    };
    maybeRefresh();
    const t = setInterval(maybeRefresh, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [isAuthed]);

  return (
    <AuthContext.Provider value={{ user, isAuthed, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
