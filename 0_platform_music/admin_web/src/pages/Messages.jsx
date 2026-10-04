import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  getCsConversations, getCsMessages, replyCs, markCsRead, sendCs, broadcastCs,
  getNotices, getNotice, getUsers,
} from '../api';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDate } from './Dashboard';

const MAX_TEXT = 2000;
const MAX_TARGETS = 20;
const AUDIENCES = [
  { value: 'all', label: '전체 (일반 사용자 + 광고주)' },
  { value: 'users', label: '일반 사용자' },
  { value: 'customers', label: '광고주' },
];
const audienceLabel = (a) => (AUDIENCES.find((x) => x.value === a)?.label || a);
const errMsg = (err, fallback) => err.response?.data?.error || err.response?.data?.detail || fallback;

// ---------------------------------------------------------------------------
// 문의함 — MAIDOL 공식 계정으로 온 DM 대화
// ---------------------------------------------------------------------------
function Inbox({ onUnreadChange }) {
  const [convs, setConvs] = useState(null);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadConvs = useCallback(async () => {
    try {
      const res = await getCsConversations({ page: 1, limit: 100 });
      setConvs(res.data.conversations || []);
    } catch {
      setConvs([]);
    }
  }, []);

  const loadMessages = useCallback(async (cid) => {
    try {
      const res = await getCsMessages(cid, { limit: 100 });
      setMessages([...(res.data.messages || [])].reverse());
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => { loadConvs(); }, [loadConvs]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  // 오류 신고 화면의 "DM 대화에서 답장" → ?cid= 로 들어오면 그 대화를 바로 연다
  const [params, setParams] = useSearchParams();
  const wantCid = params.get('cid');
  useEffect(() => {
    if (!wantCid || !convs) return;
    const c = convs.find((x) => x.conversation_id === wantCid);
    setParams({}, { replace: true });
    if (c) open(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantCid, convs]);

  const open = async (c) => {
    setActive(c);
    setText('');
    await loadMessages(c.conversation_id);
    if (c.unread > 0) {
      try {
        await markCsRead(c.conversation_id);
        setConvs((prev) => prev.map((x) => (x.conversation_id === c.conversation_id ? { ...x, unread: 0 } : x)));
        onUnreadChange?.();
      } catch { /* 읽음 처리 실패는 표시만 늦어짐 */ }
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !active) return;
    setSending(true);
    try {
      await replyCs(active.conversation_id, t);
      setText('');
      await loadMessages(active.conversation_id);
      loadConvs();
    } catch (err) {
      await appAlert(errMsg(err, '답장을 보내지 못했습니다.'));
    } finally {
      setSending(false);
    }
  };

  const peerId = active?.peer?.id;

  return (
    <div className="inbox">
      <div className="inbox-list card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>대화 {convs ? `(${convs.length})` : ''}</h3>
          <button className="btn btn--sm" onClick={loadConvs}>새로고침</button>
        </div>
        {!convs ? <p className="loading">로딩 중…</p> : convs.length === 0 ? <p className="cell-sub">대화가 없습니다.</p> : convs.map((c) => (
          <div
            key={c.conversation_id}
            className={`inbox-item ${active?.conversation_id === c.conversation_id ? 'active' : ''}`}
            onClick={() => open(c)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span className="cell-main">{c.peer?.nickname || '(알 수 없음)'}</span>
              {c.unread > 0 && <span className="badge badge--red">{c.unread}</span>}
            </div>
            <div className="cell-sub inbox-preview">{c.last_message_text || '(사진)'}</div>
            <div className="cell-sub">{formatDate(c.last_at)}</div>
          </div>
        ))}
      </div>

      <div className="inbox-thread card">
        {!active ? <p className="cell-sub">왼쪽에서 대화를 선택하세요.</p> : (
          <>
            <h3 className="section-title">{active.peer?.nickname}</h3>
            <div className="thread-body">
              {messages.map((m) => {
                const mine = m.sender_id !== peerId;
                return (
                  <div key={m.id} className={`bubble-row ${mine ? 'mine' : ''}`}>
                    <div className={`bubble ${mine ? 'bubble--mine' : ''}`}>
                      {/* v3.274 다중 이미지(image_urls ≤5) — 없으면 단일 image_url */}
                      {(m.image_urls?.length ? m.image_urls : (m.image_url ? [m.image_url] : [])).length > 0 && (
                        <div className="thumb-row" style={{ marginTop: 0, marginBottom: m.text ? 6 : 0 }}>
                          {(m.image_urls?.length ? m.image_urls : [m.image_url]).map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="첨부 사진" className="thumb thumb--md" /></a>
                          ))}
                        </div>
                      )}
                      {m.text && <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
                    </div>
                    {!mine && /^\s*\[오류신고/.test(m.text || '') && (
                      <Link to="/issues" className="badge badge--amber" style={{ marginTop: 3 }}>오류 신고로 접수됨 →</Link>
                    )}
                    <div className="cell-sub bubble-time">{formatDate(m.created_at)}</div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <form onSubmit={send} className="thread-input">
              <textarea
                className="input" rows={3} maxLength={MAX_TEXT} placeholder="MAIDOL 공식 계정으로 답장합니다"
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
              />
              <button className="btn btn--primary" type="submit" disabled={sending || !text.trim()}>
                {sending ? '전송 중…' : '답장'}
              </button>
            </form>
            <p className="cell-sub">Ctrl/⌘ + Enter 로 전송</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DM 보내기 — 지정 사용자에게 공식 계정으로 발송 (최대 20명)
// ---------------------------------------------------------------------------
function DirectSend() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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

  const toggle = async (u) => {
    if (picked.some((p) => p.id === u.id)) {
      setPicked((prev) => prev.filter((p) => p.id !== u.id));
    } else if (picked.length >= MAX_TARGETS) {
      await appAlert(`한 번에 최대 ${MAX_TARGETS}명까지 보낼 수 있습니다.`);
    } else {
      setPicked((prev) => [...prev, u]);
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!picked.length) { await appAlert('받는 사람을 선택하세요.'); return; }
    if (!t) { await appAlert('메시지를 입력하세요.'); return; }
    const ok = await appConfirm(`MAIDOL 공식 계정으로 ${picked.length}명에게 DM을 보냅니다.\n\n받는 사람: ${picked.map((p) => p.nickname).join(', ')}`);
    if (!ok) return;
    setBusy(true);
    try {
      const res = await sendCs(picked.map((p) => p.id), t);
      const failed = res.data.failed_ids?.length || 0;
      await appAlert(`발송 완료: ${res.data.sent ?? picked.length - failed}명${failed ? ` / 실패 ${failed}명` : ''}`);
      setText('');
      setPicked([]);
    } catch (err) {
      await appAlert(errMsg(err, '발송에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="section-title">DM 보내기 (MAIDOL 공식 계정)</h3>
      <form className="search-form" onSubmit={search} style={{ marginBottom: 10 }}>
        <input className="input" placeholder="닉네임 또는 이메일" style={{ minWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="submit">검색</button>
      </form>
      {results && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <tbody>
              {results.map((u) => {
                const on = picked.some((p) => p.id === u.id);
                return (
                  <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => toggle(u)}>
                    <td><input type="checkbox" readOnly checked={on} /></td>
                    <td className="cell-main">{u.nickname}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${u.role === 'customer' ? 'badge--purple' : 'badge--gray'}`}>{u.role === 'customer' ? '광고주' : u.role}</span></td>
                  </tr>
                );
              })}
              {results.length === 0 && <tr><td className="td-empty">검색 결과가 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {picked.map((p) => (
          <span key={p.id} className="chip" style={{ cursor: 'pointer' }} onClick={() => toggle(p)}>{p.nickname} ✕</span>
        ))}
        {picked.length === 0 && <span className="cell-sub">받는 사람을 검색해서 선택하세요 (최대 {MAX_TARGETS}명)</span>}
      </div>
      <textarea className="input" rows={5} maxLength={MAX_TEXT} style={{ width: '100%' }} placeholder="메시지"
        value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span className="cell-sub">{text.length}/{MAX_TEXT}</span>
        <button className="btn btn--primary" onClick={send} disabled={busy}>{busy ? '발송 중…' : `${picked.length}명에게 보내기`}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 공지 — 대상 전체에게 공식 계정 DM 으로 발송 + 이력/읽음률
// ---------------------------------------------------------------------------
function Notices() {
  const [audience, setAudience] = useState('all');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getNotices({ page: 1, limit: 30 });
      setList(res.data.notices || []);
    } catch {
      setList([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 발송 중인 공지가 있으면 진행 상황 갱신
  useEffect(() => {
    if (!list?.some((n) => n.status === 'sending' && !n.stale)) return undefined;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [list, load]);

  const send = async () => {
    const t = text.trim();
    if (!t) { await appAlert('공지 내용을 입력하세요.'); return; }
    const ok = await appConfirm(`[${audienceLabel(audience)}] 대상에게 MAIDOL 공식 계정 DM으로 공지를 보냅니다.\n보낸 뒤에는 취소할 수 없습니다.\n\n${t.slice(0, 200)}${t.length > 200 ? '…' : ''}`);
    if (!ok) return;
    setBusy(true);
    try {
      const res = await broadcastCs(audience, t);
      await appAlert(`발송을 시작했습니다 (대상 ${res.data.queued?.toLocaleString?.() ?? res.data.queued}명). 진행 상황은 아래 이력에서 확인하세요.`);
      setText('');
      load();
    } catch (err) {
      await appAlert(errMsg(err, '공지 발송에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (n) => {
    try {
      const res = await getNotice(n.id);
      setDetail(res.data);
    } catch {
      setDetail({ ...n, text: n.text_preview });
    }
  };

  return (
    <>
      <div className="card">
        <h3 className="section-title">공지 보내기</h3>
        <p className="cell-sub" style={{ marginBottom: 10 }}>공지는 대상 전원에게 MAIDOL 공식 계정 DM으로 전달되고, 앱 알림(메시지)으로 보입니다.</p>
        <div className="filters">
          <select className="select" value={audience} onChange={(e) => setAudience(e.target.value)}>
            {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <textarea className="input" rows={6} maxLength={MAX_TEXT} style={{ width: '100%' }} placeholder="공지 내용"
          value={text} onChange={(e) => setText(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span className="cell-sub">{text.length}/{MAX_TEXT}</span>
          <button className="btn btn--primary" onClick={send} disabled={busy}>{busy ? '발송 중…' : '공지 발송'}</button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>공지 이력</h3>
          <button className="btn btn--sm" onClick={load}>새로고침</button>
        </div>
        {!list ? <p className="loading">로딩 중…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>발송일</th><th>대상</th><th>내용</th><th>상태</th><th>발송</th><th>읽음률</th><th>보낸 사람</th></tr></thead>
              <tbody>
                {list.map((n) => (
                  <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(n)}>
                    <td className="nowrap">{formatDate(n.created_at)}</td>
                    <td className="nowrap">{audienceLabel(n.audience)}</td>
                    <td style={{ maxWidth: 320 }}><div className="inbox-preview">{n.text_preview}</div></td>
                    <td>
                      {n.status === 'done' && <span className="badge badge--green">완료</span>}
                      {n.status === 'sending' && <span className={`badge ${n.stale ? 'badge--red' : 'badge--amber'}`}>{n.stale ? '중단됨' : '발송 중'}</span>}
                      {!['done', 'sending'].includes(n.status) && <span className="badge badge--gray">{n.status}</span>}
                    </td>
                    <td className="nowrap">{n.sent}/{n.targets}{n.failed ? <span className="cell-sub"> (실패 {n.failed})</span> : ''}</td>
                    <td>{n.read_rate == null ? '-' : `${n.read_rate}%`}</td>
                    <td>{n.admin_nickname || '-'}</td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={7} className="td-empty">보낸 공지가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">공지 · {formatDate(detail.created_at)} · {audienceLabel(detail.audience)}</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{detail.text}</p>
            <p className="cell-sub" style={{ marginTop: 12 }}>
              발송 {detail.sent}/{detail.targets} · 전달 {detail.delivered} · 읽음 {detail.read_count}{detail.read_rate != null ? ` (${detail.read_rate}%)` : ''}
            </p>
            <div className="modal__footer">
              <button className="btn" onClick={() => { setText(detail.text || ''); setAudience(detail.audience || 'all'); setDetail(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                이 내용으로 다시 작성
              </button>
              <button className="btn btn--primary" onClick={() => setDetail(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const TABS = [
  { key: 'inbox', label: '문의함' },
  { key: 'send', label: 'DM 보내기' },
  { key: 'notice', label: '공지' },
];

export default function MessagesPage({ onUnreadChange }) {
  const [tab, setTab] = useState('inbox');
  return (
    <div>
      <h2 className="page-title">DM · 공지</h2>
      <div className="filters">
        <div className="filter-group">
          {TABS.map((t) => (
            <button key={t.key} className={`filter-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'inbox' && <Inbox onUnreadChange={onUnreadChange} />}
      {tab === 'send' && <DirectSend />}
      {tab === 'notice' && <Notices />}
    </div>
  );
}
