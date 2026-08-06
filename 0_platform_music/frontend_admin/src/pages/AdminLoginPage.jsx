import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AdminLoginPage.css';

// v162 — 관리자 전용 간소 로그인 페이지.
// 로그인 성공 후 role !== 'admin' 이면 즉시 logout(토큰/유저 localStorage 제거) + 에러 표시
// — 비관리자에게 유효 토큰을 남기지 않는다. 로그 태그: [AdminLogin] (토큰/비밀번호 로그 금지)
export default function AdminLoginPage() {
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 이미 관리자 세션이면 대시보드로
  useEffect(() => {
    if (!loading && user?.role === 'admin') {
      navigate('/', { replace: true });
    }
  }, [loading, user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const data = await login(email, password);
      if (data?.user?.role !== 'admin') {
        logout();
        if (import.meta.env.DEV) console.warn('[AdminLogin] non-admin rejected');
        setError('관리자 계정이 아닙니다.');
        return;
      }
      if (import.meta.env.DEV) console.info('[AdminLogin] admin login ok');
      navigate('/', { replace: true });
    } catch (err) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.response?.data?.message;
      console.error('[AdminLogin] login failed', { status: err?.response?.status });
      setError(detail || '로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={handleSubmit}>
        <h1 className="admin-login__title">MAIDOL Admin</h1>
        <p className="admin-login__subtitle">관리자 계정으로 로그인하세요</p>

        <label className="admin-login__label" htmlFor="admin-login-email">이메일</label>
        <input
          id="admin-login-email"
          type="email"
          className="admin-login__input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          autoComplete="username"
          required
        />

        <label className="admin-login__label" htmlFor="admin-login-password">비밀번호</label>
        <input
          id="admin-login-password"
          type="password"
          className="admin-login__input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoComplete="current-password"
          required
        />

        {error && <p className="admin-login__error">{error}</p>}

        <button type="submit" className="admin-login__submit" disabled={submitting}>
          {submitting ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
