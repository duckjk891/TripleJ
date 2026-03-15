import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './RegisterPage.css';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password || !nickname) {
      setError('모든 필드를 입력해주세요.');
      return;
    }

    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      await register(email, password, nickname);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || '회원가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <div className="register-page">
        <form className="register-card" onSubmit={handleSubmit}>
          <div className="register-card__logo">
            <img src="/aimu-logo.svg" alt="AIMU" />
          </div>
          <h1 className="register-card__title">회원가입</h1>

          {error && <div className="register-card__error">{error}</div>}

          <div className="register-card__field">
            <label className="register-card__label">이메일</label>
            <input
              className="register-card__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              autoFocus
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">닉네임</label>
            <input
              className="register-card__input"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임을 입력하세요"
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">비밀번호</label>
            <input
              className="register-card__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 (6자 이상)"
            />
          </div>

          <div className="register-card__field">
            <label className="register-card__label">비밀번호 확인</label>
            <input
              className="register-card__input"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호를 다시 입력하세요"
            />
          </div>

          <button className="register-card__submit" type="submit" disabled={loading}>
            {loading ? '가입 중...' : '회원가입'}
          </button>

          <div className="register-card__footer">
            이미 계정이 있으신가요?
            <Link to="/login">로그인</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
