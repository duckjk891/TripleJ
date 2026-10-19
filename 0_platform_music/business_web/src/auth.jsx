import { createContext, useContext, useEffect, useState } from 'react';
import { getToken, getStoredUser, saveAuth, clearAuth, getTokenIssuedAt, refreshSession } from './api';

const AuthContext = createContext(null);

// 로그인 상태 유지 — 토큰(7일)이 발급된 지 12시간이 넘었으면 접속 때 조용히 재발급(관리자 웹과 같은 방식).
const REFRESH_AFTER_MS = 12 * 3600 * 1000;
const CHECK_EVERY_MS = 6 * 3600 * 1000;
export const BUSINESS_ROLES = ['customer', 'admin'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  // 임시 비밀번호 계정 — 새 비밀번호를 정하기 전에는 다른 화면으로 가지 않는다(GET /profile 로 판정).
  const [mustChange, setMustChange] = useState(false);

  const signIn = (token, userInfo, remember) => {
    saveAuth(token, userInfo, remember);
    setUser(userInfo);
  };
  const signOut = () => {
    clearAuth();
    setUser(null);
    setMustChange(false);
  };
  const isAuthed = Boolean(getToken() && user && BUSINESS_ROLES.includes(user.role));

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
        .catch(() => {});
    };
    maybeRefresh();
    const t = setInterval(maybeRefresh, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [isAuthed]);

  return (
    <AuthContext.Provider value={{ user, isAuthed, signIn, signOut, mustChange, setMustChange }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
