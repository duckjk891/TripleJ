import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api';
import { useAuth } from '../auth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(email, password);
      const { token, user } = res.data;
      if (user?.role !== 'admin') {
        setError('관리자 권한이 없는 계정입니다.');
        return;
      }
      signIn(token, user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-title">MAIDOL <span>Admin</span></div>
        <div className="login-sub">관리자 계정으로 로그인하세요</div>
        {error && <div className="login-error">{error}</div>}
        <div className="form-row">
          <label>이메일</label>
          <input
            className="input" type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} required
          />
        </div>
        <div className="form-row">
          <label>비밀번호</label>
          <input
            className="input" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={loading}>
          {loading ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
