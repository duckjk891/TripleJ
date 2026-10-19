import { useEffect, useState } from 'react';
import { updateProfile, friendlyError } from '../api';
import { useAuth } from '../auth';
import { useProfile } from '../components/Layout';
import { toast } from '../components/dialog';

const FIELDS = [
  { k: 'company_name', label: '회사(브랜드)명', max: 50 },
  { k: 'industry', label: '업종', max: 50, ph: '예: 패션 · 여성 의류' },
  { k: 'contact_name', label: '담당자 이름', max: 50 },
  { k: 'contact_phone', label: '담당자 연락처', max: 40 },
];

export default function Profile() {
  const { user } = useAuth();
  const { profile, reload } = useProfile();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile) setF(Object.fromEntries(FIELDS.map(({ k }) => [k, profile[k] || ''])));
  }, [profile]);

  const save = async (e) => {
    e.preventDefault();
    if (!(f.company_name || '').trim()) { setError('회사(브랜드)명을 입력해 주세요.'); return; }
    setBusy(true);
    setError('');
    try {
      await updateProfile(Object.fromEntries(FIELDS.map(({ k }) => [k, (f[k] || '').trim()])));
      await reload();
      toast('회사 정보를 저장했어요.');
    } catch (err) {
      setError(friendlyError(err, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="page page--narrow">
      <div className="page__head"><div><h1>회사 정보</h1><p className="muted">MAIDOL 담당자가 연락드릴 때 쓰는 정보예요.</p></div></div>
      <form className="panel form" onSubmit={save}>
        <label className="field">로그인 이메일<input className="input" value={user?.email || ''} disabled /></label>
        {FIELDS.map(({ k, label, max, ph }) => (
          <label className="field" key={k}>{label}<input className="input" value={f[k] || ''} maxLength={max} placeholder={ph} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} /></label>
        ))}
        {error && <div className="notice notice--err">{error}</div>}
        <div className="form__actions"><button className="btn btn--primary" disabled={busy || !profile}>{busy ? '저장 중…' : '저장'}</button></div>
      </form>
    </div>
  );
}
