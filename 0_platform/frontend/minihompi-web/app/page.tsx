'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, register } from '@/lib/api';
import '@/src/pages/MainPage.css';

export default function MainPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const savedUserId = localStorage.getItem('userId');
    if (savedUserId) {
      router.push('/home');
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        const res = await login(email, password);
        const userId = res.data.user_id || res.data.userId || 'me';
        localStorage.setItem('userId', String(userId));
        localStorage.setItem('nickname', res.data.nickname || '');
        router.push('/home');
      } else {
        await register(email, password, nickname);
        setIsLogin(true);
        setError('회원가입 성공! 로그인 해주세요');
      }
    } catch {
      setError(isLogin ? '로그인에 실패했습니다.' : '회원가입에 실패했습니다.');
    }
  };

  return (
    <div className="main-page">
      <div className="main-container">
        <div className="main-logo">
          <h1>ONECOMPANY</h1>
          <p className="main-subtitle">나만의 작은 세상</p>
        </div>

        <div className="auth-card">
          <div className="auth-tabs">
            <button
              className={`auth-tab ${isLogin ? 'active' : ''}`}
              onClick={() => { setIsLogin(true); setError(''); }}
            >
              로그인
            </button>
            <button
              className={`auth-tab ${!isLogin ? 'active' : ''}`}
              onClick={() => { setIsLogin(false); setError(''); }}
            >
              회원가입
            </button>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            <input
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {!isLogin && (
              <input
                type="text"
                placeholder="닉네임"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            )}
            {error && <p className="auth-message">{error}</p>}
            <button type="submit" className="auth-submit">
              {isLogin ? '로그인' : '회원가입'}
            </button>
          </form>
        </div>

        <p className="main-footer">Welcome to ONECOMPANY</p>
      </div>
    </div>
  );
}
