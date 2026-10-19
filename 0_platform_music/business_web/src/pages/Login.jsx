import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Brand from '../components/Brand';
import { appAlert } from '../components/dialog';
import { useAuth, BUSINESS_ROLES } from '../auth';
import { login, getProfile, getRemember, saveAuth, clearAuth, requestReset, confirmReset, friendlyError } from '../api';

export default function Login() {
  const { isAuthed, signIn, setMustChange } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(getRemember());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const expired = loc.search.includes('expired=1');

  if (isAuthed) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('이메일과 비밀번호를 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      const { token, user } = res.data || {};
      if (!token || !user) throw new Error('no token');
      if (!BUSINESS_ROLES.includes(user.role)) {
        setError('광고주 계정이 아니에요. 아래 입점 문의를 남겨 주시면 광고주 계정을 만들어 드려요.');
        return;
      }
      // 임시 비밀번호 여부 확인 후 화면 결정
      saveAuth(token, user, remember);
      let must = false;
      try { must = Boolean((await getProfile()).data?.must_change_password); } catch { /* 대시보드에서 다시 확인 */ }
      signIn(token, user, remember);
      setMustChange(must);
      nav(must ? '/password' : '/dashboard', { replace: true });
    } catch (err) {
      clearAuth();
      const st = err?.response?.status;
      setError(st === 401 ? '이메일 또는 비밀번호가 맞지 않아요.' : friendlyError(err, '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} noValidate>
        <a href="#/" aria-label="MAIDOL Business 소개로"><Brand /></a>
        <h1>광고주 로그인</h1>
        <p className="muted">MAIDOL에서 발급한 광고주 계정으로 로그인해 주세요.</p>
        {expired && !error && <div className="notice">로그인 시간이 지나 다시 로그인해 주세요.</div>}
        {error && <div className="notice notice--err" role="alert">{error}</div>}
        <label>이메일<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>비밀번호<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
        <div className="login__links">
          <label className="check check--sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>로그인 상태 유지</span></label>
          <button type="button" className="linkbtn" onClick={() => setResetOpen(true)}>비밀번호를 잊으셨나요?</button>
        </div>
        <div className="login__foot">계정이 없으신가요? <Link to="/" onClick={() => setTimeout(() => document.getElementById('contact')?.scrollIntoView(), 50)}>입점 문의 남기기</Link></div>
      </form>
      {resetOpen && <ResetDialog initialEmail={email} onClose={() => setResetOpen(false)} />}
    </div>
  );
}

// 비밀번호 재설정 — 앱과 같은 이메일 6자리 코드 방식(/api/auth/password-reset/*)
function ResetDialog({ initialEmail, onClose }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(initialEmail || '');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setError('');
    if (!email.trim() || !email.includes('@')) { setError('이메일 주소를 입력해 주세요.'); return; }
    setBusy(true);
    try {
      await requestReset(email.trim());
      setStep(2);
    } catch (err) {
      setError(friendlyError(err));
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    setError('');
    if (!/^\d{6}$/.test(code.trim())) { setError('메일로 받은 6자리 숫자를 입력해 주세요.'); return; }
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { setError('새 비밀번호는 8자 이상, 영문과 숫자를 모두 넣어 주세요.'); return; }
    if (pw !== pw2) { setError('새 비밀번호가 서로 달라요.'); return; }
    setBusy(true);
    try {
      await confirmReset(email.trim(), code.trim(), pw);
      onClose();
      appAlert('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.');
    } catch (err) {
      setError(friendlyError(err, '코드가 맞지 않거나 시간이 지났어요. 코드를 다시 받아 주세요.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog dialog--sm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog__title">비밀번호 재설정</h3>
        {step === 1 ? (
          <>
            <p className="dialog__msg">광고주 계정 이메일로 6자리 코드를 보내 드려요.</p>
            <label className="field">이메일<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
          </>
        ) : (
          <>
            <p className="dialog__msg">메일이 오지 않으면 스팸함을 확인하거나, 담당자에게 임시 비밀번호를 요청해 주세요.</p>
            <label className="field">6자리 코드<input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
            <label className="field">새 비밀번호<input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
            <label className="field">새 비밀번호 확인<input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
          </>
        )}
        {error && <div className="notice notice--err" role="alert">{error}</div>}
        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>닫기</button>
          {step === 1
            ? <button className="btn btn--primary" disabled={busy} onClick={send}>{busy ? '보내는 중…' : '코드 받기'}</button>
            : <button className="btn btn--primary" disabled={busy} onClick={confirm}>{busy ? '바꾸는 중…' : '비밀번호 바꾸기'}</button>}
        </div>
      </div>
    </div>
  );
}
