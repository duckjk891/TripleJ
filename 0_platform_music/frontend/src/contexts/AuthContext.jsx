import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.login(email, password);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (email, password, nickname, companyName, displayTitle) => {
    const { data } = await api.register(email, password, nickname, companyName, displayTitle);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  // OAuth 콜백 등에서 받은 JWT 로 로그인 완료 — 토큰 저장 후 /auth/me 로 user 동기화.
  // /auth/me 는 user 객체를 최상위로 반환(login 의 data.user 와 달리 래핑 없음).
  const loginWithToken = useCallback(async (token) => {
    localStorage.setItem('token', token);
    try {
      const { data } = await api.getMe();
      localStorage.setItem('user', JSON.stringify(data));
      setUser(data);
      return data;
    } catch (err) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  // 서버에서 내려준 user 객체로 로컬 state + localStorage 동기화
  const updateUser = useCallback((nextUser) => {
    if (!nextUser) return;
    setUser((prev) => {
      const merged = { ...(prev || {}), ...nextUser };
      try {
        localStorage.setItem('user', JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithToken, logout, setUser, updateUser, isAdmin: user?.role === 'admin', isBusiness: user?.role === 'customer' || user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
