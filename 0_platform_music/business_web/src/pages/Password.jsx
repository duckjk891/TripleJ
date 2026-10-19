import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword, friendlyError } from '../api';
import { useAuth } from '../auth';
import { useProfile } from '../components/Layout';
import { toast } from '../components/dialog';

export default function Password() {
  const { mustChange, setMustChange } = useAuth();
  const { reload } = useProfile();
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!cur) { setError(mustChange ? '받으신 임시 비밀번호를 입력해 주세요.' : '지금 비밀번호를 입력해 주세요.'); return; }
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { setError('새 비밀번호는 8자 이상, 영문과 숫자를 모두 넣어 주세요.'); return; }
    if (pw !== pw2) { setError('새 비밀번호가 서로 달라요.'); return; }
    setBusy(true);
    try {
      await changePassword(cur, pw);
      const wasForced = mustChange;
      setMustChange(false);
      setCur(''); setPw(''); setPw2('');
      reload();
      toast('비밀번호를 바꿨어요.');
      if (wasForced) nav('/dashboard', { replace: true });
    } catch (err) {
      setError(friendlyError(err, '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="page page--narrow">
      <div className="page__head">
        <div>
          <h1>{mustChange ? '새 비밀번호 정하기' : '비밀번호 변경'}</h1>
          <p className="muted">{mustChange ? '처음 로그인하셨어요. 받으신 임시 비밀번호 대신 쓸 새 비밀번호를 정해 주세요.' : '8자 이상, 영문과 숫자를 모두 넣어 주세요.'}</p>
        </div>
      </div>
      <form className="panel form" onSubmit={save}>
        <label className="field">{mustChange ? '임시 비밀번호' : '지금 비밀번호'}<input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" autoFocus /></label>
        <label className="field">새 비밀번호<input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <label className="field">새 비밀번호 확인<input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
        {error && <div className="notice notice--err" role="alert">{error}</div>}
        <div className="form__actions"><button className="btn btn--primary" disabled={busy}>{busy ? '바꾸는 중…' : '비밀번호 바꾸기'}</button></div>
      </form>
    </div>
  );
}
