import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <div className="login-page">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card__logo">
            <img src="/melon-logo.svg" alt="멜론" />
          </div>
          <h1 className="login-card__title">로그인</h1>

          {error && <div className="login-card__error">{error}</div>}

          <div className="login-card__field">
            <label className="login-card__label">이메일</label>
            <input
              className="login-card__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              autoFocus
            />
          </div>

          <div className="login-card__field">
            <label className="login-card__label">비밀번호</label>
            <input
              className="login-card__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
            />
          </div>

          <button className="login-card__submit" type="submit" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>

          <div className="login-card__footer">
            아직 계정이 없으신가요?
            <Link to="/register">회원가입</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
