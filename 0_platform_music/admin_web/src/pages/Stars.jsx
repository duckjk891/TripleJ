import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getUsers, getUserDetail, getPointSummary, getPointBalance, getPointEvents, adjustPoints, getPointBreakdown,
} from '../api';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDate } from './Dashboard';

const MAX_AMOUNT = 10000;

// 앱 알림 탭 제목(앱 NotificationsScreen 의 star 문구와 동일하게 유지)
const noticeTitle = (direction, n) => {
  const shown = Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n).toLocaleString() : 'N';
  return direction === 'grant' ? `스타 ${shown}개를 받았어요` : `스타 ${shown}개가 차감되었어요`;
};

// point_events.action → 한글
const ACTION_LABELS = {
  attendance: '출석체크', signup_bonus: '가입 보상', beta_signup_bonus: '베타 가입 보너스',
  verify_bonus: '본인인증 보너스', profile_bonus: '프로필 완성 보너스',
  referral_inviter: '친구 초대 보상', referral_joiner: '추천 가입 보상',
  play: '재생 보상', download: '다운로드 보상', generate: '곡 생성 보상', upload: '곡 등록 보상',
  admin_adjust: '관리자 지급', admin_grant: '관리자 지급',
  'spend:admin_adjust': '관리자 차감', 'spend:compose': '곡 생성', 'spend:lyrics': '가사 생성',
  'spend:character': '캐릭터 생성', 'spend:cover': '커버 촬영', 'spend:cover_refine': '커버 수정',
  'spend:voice_clone': '내 목소리', 'spend:instrumental': '반주 생성', 'spend:share_video': '공유 영상',
  'spend:extra_slot': '슬롯 추가', 'spend:fatigue_skip': '피로도 해제', 'spend:hire_director': '디렉터 고용',
};
export const actionLabel = (a) => {
  if (!a) return '-';
  if (ACTION_LABELS[a]) return ACTION_LABELS[a];
  if (a.startsWith('refund:')) return `환불 (${ACTION_LABELS[`spend:${a.slice(7)}`] || a.slice(7)})`;
  return a;
};

const FILTERS = [
  { value: '', label: '전체' },
  { value: 'earn', label: '적립' },
  { value: 'spend', label: '사용' },
  { value: 'refund', label: '환불' },
  { value: 'admin', label: '관리자 조정' },
];

function UserPanel({ user, onChanged }) {
  const [balance, setBalance] = useState(null);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [direction, setDirection] = useState('grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, e] = await Promise.all([
        getPointBalance(user.id),
        getPointEvents(user.id, { page, limit: 20, ...(filter ? { filter } : {}) }),
      ]);
      setBalance(b.data.balance);
      setEvents(e.data.events || []);
      setTotalPages(e.data.pagination?.totalPages || 1);
    } catch {
      setBalance(null);
    }
  }, [user.id, page, filter]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) {
      await appAlert(`수량은 1~${MAX_AMOUNT.toLocaleString()} 사이의 정수로 입력해주세요.`);
      return;
    }
    if (!reason.trim()) {
      await appAlert('사유를 입력해주세요. (감사 기록에 남습니다)');
      return;
    }
    const verb = direction === 'grant' ? '지급' : '차감';
    const noticeLine = notify
      ? `\n\n사용자 알림: "${noticeTitle(direction, n)}"${message.trim() ? `\n  + "${message.trim()}"` : ''}`
      : '\n\n사용자 알림: 보내지 않음';
    const ok = await appConfirm(
      `${user.nickname} 님에게 ⭐ ${n.toLocaleString()}개를 ${verb}합니다.\n사유(비공개): ${reason.trim()}\n\n현재 잔액 ${balance?.toLocaleString() ?? '-'} → ${(direction === 'grant' ? (balance ?? 0) + n : (balance ?? 0) - n).toLocaleString()}${noticeLine}`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await adjustPoints(user.id, direction, n, reason.trim(), notify, message.trim());
      await appAlert(`${verb} 완료. 현재 잔액 ⭐ ${res.data.balance.toLocaleString()}${res.data.notified ? '\n사용자에게 알림을 보냈습니다.' : ''}`);
      setAmount('');
      setReason('');
      setMessage('');
      setPage(1);
      await load();
      onChanged?.();
    } catch (err) {
      await appAlert(err.response?.data?.error || err.response?.data?.detail || `${verb}에 실패했습니다.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <h3 className="section-title" style={{ margin: 0 }}>{user.nickname}</h3>
          <span className="cell-sub">{user.email}</span>
          <span style={{ marginLeft: 'auto', fontSize: '1.3rem', fontWeight: 700 }}>⭐ {balance == null ? '…' : balance.toLocaleString()}</span>
        </div>
        <form onSubmit={submit} className="filters" style={{ marginBottom: 0 }}>
          <div className="filter-group">
            <button type="button" className={`filter-btn ${direction === 'grant' ? 'active' : ''}`} onClick={() => setDirection('grant')}>지급</button>
            <button type="button" className={`filter-btn ${direction === 'deduct' ? 'active' : ''}`} onClick={() => setDirection('deduct')}>차감</button>
          </div>
          <input className="input" type="number" min="1" max={MAX_AMOUNT} placeholder="수량" style={{ width: 110 }}
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" type="text" maxLength={200} placeholder="사유 (예: 이벤트 당첨, 오류 보상)" style={{ flex: 1, minWidth: 220 }}
            value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className={`btn ${direction === 'grant' ? 'btn--primary' : 'btn--danger'}`} type="submit" disabled={busy}>
            {busy ? '처리 중…' : direction === 'grant' ? '별 지급' : '별 차감'}
          </button>
        </form>
        <div className="filters" style={{ marginTop: 10, marginBottom: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> 사용자에게 알림 보내기
          </label>
          {notify && (
            <input className="input" type="text" maxLength={100} style={{ flex: 1, minWidth: 260 }}
              placeholder="사용자에게 보일 메시지 (선택, 예: 이벤트 당첨을 축하해요!)"
              value={message} onChange={(e) => setMessage(e.target.value)} />
          )}
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>
          1회 최대 {MAX_AMOUNT.toLocaleString()}개. 사유는 감사 기록에만 남고 사용자에게 보이지 않습니다.
          알림은 앱 알림 탭에 &quot;{noticeTitle(direction, amount)}&quot; 로 표시되고, 메시지를 적으면 그 아래 함께 보입니다.
        </p>
      </div>

      <div className="card">
        <div className="filters">
          <h3 className="section-title" style={{ margin: 0 }}>별 내역</h3>
          <div className="filter-group">
            {FILTERS.map((f) => (
              <button key={f.value} className={`filter-btn ${filter === f.value ? 'active' : ''}`}
                onClick={() => { setFilter(f.value); setPage(1); }}>{f.label}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>일시</th><th>내용</th><th>수량</th></tr></thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={`${ev.created_at}-${i}`}>
                  <td className="nowrap">{formatDate(ev.created_at)}</td>
                  <td>{actionLabel(ev.action)}</td>
                  <td style={{ color: ev.amount > 0 ? 'var(--green)' : 'var(--danger)', fontWeight: 600 }}>
                    {ev.amount > 0 ? '+' : ''}{ev.amount?.toLocaleString()}
                  </td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={3} className="td-empty">내역이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
            <span className="pagination__info">{page} / {totalPages}</span>
            <button className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
          </div>
        )}
      </div>
    </>
  );
}

export default function StarsPage() {
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);

  const loadSummary = useCallback(() => {
    getPointSummary().then((r) => setSummary(r.data)).catch(() => {});
    getPointBreakdown(30).then((r) => setBreakdown(r.data)).catch(() => {});
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // 사용자 관리 화면의 '별' 버튼에서 ?uid= 로 진입
  const uid = params.get('uid');
  useEffect(() => {
    if (uid && selected?.id !== uid) {
      getUserDetail(uid).then((r) => setSelected(r.data)).catch(() => {});
    }
  }, [uid, selected?.id]);

  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    try {
      const res = await getUsers({ search: q.trim(), limit: 10 });
      setResults(res.data.users || []);
    } catch {
      setResults([]);
    }
  };

  const pick = (u) => {
    setSelected(u);
    setResults(null);
    setParams({ uid: u.id });
  };

  return (
    <div>
      <h2 className="page-title">별 관리</h2>

      {summary && (
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">유통 중인 별 (전체 잔액)</span><span className="stat-value">⭐ {summary.total_balance.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">누적 적립</span><span className="stat-value">{summary.total_earned.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">누적 사용</span><span className="stat-value">{summary.total_spent.toLocaleString()}</span></div>
          <div className="stat-card"><span className="stat-label">오늘 적립 / 사용</span><span className="stat-value">{summary.today_earned.toLocaleString()} / {summary.today_spent.toLocaleString()}</span></div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">사용자 찾기</h3>
        <form className="search-form" onSubmit={search}>
          <input className="input" type="text" placeholder="닉네임 또는 이메일" style={{ minWidth: 260 }}
            value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" type="submit">검색</button>
        </form>
        {results && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <tbody>
                {results.map((u) => (
                  <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => pick(u)}>
                    <td className="cell-main">{u.nickname}</td>
                    <td>{u.email}</td>
                    <td className="nowrap">{formatDate(u.created_at)}</td>
                    <td><button className="btn btn--sm" type="button">선택</button></td>
                  </tr>
                ))}
                {results.length === 0 && <tr><td className="td-empty">검색 결과가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && <UserPanel key={selected.id} user={selected} onChanged={loadSummary} />}

      {breakdown && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[['earn', '적립 경로 (최근 30일)'], ['spend', '사용처 (최근 30일)']].map(([k, title]) => {
            const rows = breakdown[k] || [];
            const max = Math.max(1, ...rows.map((r) => r.total));
            return (
              <div key={k} className="card" style={{ flex: 1, minWidth: 300 }}>
                <h3 className="section-title">{title}</h3>
                {rows.length === 0 ? <p className="cell-sub">데이터 없음</p> : rows.map((r) => (
                  <div key={r.action} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem', marginBottom: 3 }}>
                      <span>{actionLabel(r.action)}</span><span className="cell-main">{r.total.toLocaleString()}</span>
                    </div>
                    <div className="progress-bar" style={{ marginTop: 0 }}><div style={{ width: `${(r.total / max) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
