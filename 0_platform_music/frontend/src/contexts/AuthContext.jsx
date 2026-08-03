import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as api from '../api';

const AuthContext = createContext(null);

// v157 — 로그인 세션당 1회 출석체크 자동 팝업용 "pending 소비형" 플래그 키.
// 로그인 성공 경로(login/register/loginWithToken)에서만 세팅 — 새로고침 restore 경로에서는 세팅하지 않음.
export const ATTENDANCE_PROMPT_KEY = 'aimu:attendancePromptPending';

// 세팅/제거는 항상 try/catch (sessionStorage 접근 불가 환경 대비)
function setAttendancePromptFlag() {
  try {
    sessionStorage.setItem(ATTENDANCE_PROMPT_KEY, '1');
    if (import.meta.env.DEV) console.info('[AuthContext] attendance prompt flag set');
  } catch { /* sessionStorage 불가 환경 — 자동 팝업만 생략(⭐ 배지 수동 경로 유지) */ }
}

function clearAttendancePromptFlag() {
  try {
    sessionStorage.removeItem(ATTENDANCE_PROMPT_KEY);
    if (import.meta.env.DEV) console.info('[AuthContext] attendance prompt flag cleared');
  } catch { /* sessionStorage 불가 환경 — 무시 */ }
}

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
    setAttendancePromptFlag();
    setUser(data.user);
    return data;
  }, []);

  // extra: 선택 인구통계 { birth_date?, gender?, region? } — 값이 있는 키만 담아 전달.
  // (companyName/displayTitle 은 기존과 동일하게 api.register 페이로드에 미포함)
  const register = useCallback(async (email, password, nickname, companyName, displayTitle, extra) => {
    const { data } = await api.register(email, password, nickname, extra);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setAttendancePromptFlag();
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
      setAttendancePromptFlag();
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
    clearAttendancePromptFlag();
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
