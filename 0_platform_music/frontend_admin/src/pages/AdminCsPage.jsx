import { useState, useEffect, useRef, useCallback } from 'react';
import AdminLayout from '../components/AdminLayout';
import {
  getCsConversations,
  getCsMessages,
  replyCs,
  markCsRead,
} from '../api';
import './AdminCsPage.css';

// CS 문의 대응 — 사용자 오류신고가 maidol_official 로 도착한 DM 대화를 관리자가 처리.
// 좌측 대화목록(미읽음 뱃지) + 우측 메시지 스레드 + 하단 답장 입력.
// 폴링(12초)로 목록/열린 대화 메시지 갱신(WS 미사용). 로그 prefix `[AdminCs]`.
// 메시지 text 원문은 콘솔에 출력하지 않는다(길이만).

const POLL_MS = 12000;
const MSG_LIMIT = 30;

function fmtListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  const n = (name || '').trim();
  return n ? n.slice(0, 1).toUpperCase() : '?';
}

export default function AdminCsPage() {
  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState('');

  const [activeCid, setActiveCid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState('');

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // 폴링 콜백에서 최신 activeCid 참조용
  const activeCidRef = useRef(activeCid);
  useEffect(() => { activeCidRef.current = activeCid; }, [activeCid]);

  // ── 대화 목록 로드 ───────────────────────────────
  const loadConversations = useCallback(async (opts = {}) => {
    const { silent = false } = opts;
    if (!silent) setConvLoading(true);
    if (import.meta.env.DEV) console.info('[AdminCs] loading conversations', { silent });
    try {
      const { data } = await getCsConversations({ page: 1, limit: 30 });
      const list = Array.isArray(data?.conversations) ? data.conversations : [];
      setConversations(list);
      setConvError('');
      if (import.meta.env.DEV) console.info('[AdminCs] conversations loaded', { count: list.length });
    } catch (err) {
      console.error('[AdminCs] getCsConversations failed', { status: err?.response?.status, message: err?.message });
      if (!silent) setConvError('대화 목록을 불러오지 못했습니다.');
    } finally {
      if (!silent) setConvLoading(false);
    }
  }, []);

  // ── 메시지 로드 ───────────────────────────────
  const loadMessages = useCallback(async (cid, opts = {}) => {
    const { silent = false } = opts;
    if (!cid) return;
    if (!silent) { setMsgLoading(true); setMsgError(''); }
    if (import.meta.env.DEV) console.info('[AdminCs] loading messages', { cid: String(cid).slice(0, 8), silent });
    try {
      const { data } = await getCsMessages(cid, { limit: MSG_LIMIT });
      const list = Array.isArray(data?.messages) ? data.messages : [];
      // 서버는 created_at desc 가정 → 오름차순(과거→최신)으로 표시
      const ordered = [...list].reverse();
      setMessages(ordered);
      if (import.meta.env.DEV) console.info('[AdminCs] messages loaded', { count: ordered.length });
    } catch (err) {
      console.error('[AdminCs] getCsMessages failed', { status: err?.response?.status, message: err?.message });
      if (!silent) setMsgError('메시지를 불러오지 못했습니다.');
    } finally {
      if (!silent) setMsgLoading(false);
    }
  }, []);

  // ── 대화 열기 (메시지 로드 + 읽음 처리) ───────────
  const openConversation = useCallback(async (cid) => {
    if (!cid) return;
    setActiveCid(cid);
    setMessages([]);
    setMsgError('');
    setReplyText('');
    await loadMessages(cid);
    try {
      await markCsRead(cid);
      setConversations((prev) => prev.map((c) => (c.conversation_id === cid ? { ...c, unread: 0 } : c)));
      if (import.meta.env.DEV) console.info('[AdminCs] marked read', { cid: String(cid).slice(0, 8) });
    } catch (err) {
      console.error('[AdminCs] markCsRead failed', { status: err?.response?.status, message: err?.message });
    }
  }, [loadMessages]);

  // 최초 목록 로드
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 폴링 — 목록 + 열린 대화 메시지 (silent 갱신)
  useEffect(() => {
    const timer = setInterval(() => {
      loadConversations({ silent: true });
      const cid = activeCidRef.current;
      if (cid) loadMessages(cid, { silent: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadConversations, loadMessages]);

  // ── 답장 전송 ───────────────────────────────
  const handleSend = useCallback(async () => {
    const cid = activeCidRef.current;
    const text = replyText.trim();
    if (!cid || !text || sending) return;
    setSending(true);
    if (import.meta.env.DEV) console.info('[AdminCs] sending reply', { cid: String(cid).slice(0, 8), len: text.length });
    try {
      const { data } = await replyCs(cid, text);
      const saved = data?.message;
      // 응답에 메시지가 오면 반영, 없으면 재조회로 동기화
      if (saved?.id) {
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      } else {
        loadMessages(cid, { silent: true });
      }
      setReplyText('');
      // 목록 last_message 미리보기 갱신 + 상단 이동
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.conversation_id === cid);
        if (idx < 0) return prev;
        const updated = {
          ...prev[idx],
          last_message_text: text.slice(0, 200),
          last_at: saved?.created_at || new Date().toISOString(),
          unread: 0,
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
      if (import.meta.env.DEV) console.info('[AdminCs] reply sent', { cid: String(cid).slice(0, 8) });
    } catch (err) {
      console.error('[AdminCs] replyCs failed', { status: err?.response?.status, message: err?.message });
      alert('답장 전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSending(false);
    }
  }, [replyText, sending, loadMessages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeConversation = conversations.find((c) => c.conversation_id === activeCid) || null;
  const activePeer = activeConversation?.peer || {};

  return (
    <AdminLayout>
      <div className="admin-cs">
        <h2 className="admin-page-title">CS 문의</h2>

        <div className="admin-cs__panels">
          {/* 좌측: 대화 목록 */}
          <aside className="admin-cs__list">
            {convLoading ? (
              <p className="admin-cs__status">로딩 중...</p>
            ) : convError ? (
              <div className="admin-cs__status">
                <p>{convError}</p>
                <button className="admin-cs__retry" onClick={() => loadConversations()}>다시 시도</button>
              </div>
            ) : conversations.length === 0 ? (
              <p className="admin-cs__status">접수된 문의가 없습니다.</p>
            ) : (
              <ul className="admin-cs__conv-list">
                {conversations.map((c) => {
                  const peer = c.peer || {};
                  const active = c.conversation_id === activeCid;
                  const unread = c.unread || 0;
                  return (
                    <li key={c.conversation_id}>
                      <button
                        className={`admin-cs__conv ${active ? 'admin-cs__conv--active' : ''}`}
                        onClick={() => openConversation(c.conversation_id)}
                      >
                        <span className="admin-cs__avatar">{initials(peer.nickname)}</span>
                        <span className="admin-cs__conv-main">
                          <span className="admin-cs__conv-top">
                            <span className="admin-cs__conv-name">
                              {peer.nickname || '알 수 없음'}
                              {peer.code && <span className="admin-cs__tag">#{peer.code}</span>}
                            </span>
                            <span className="admin-cs__conv-time">{fmtListTime(c.last_at)}</span>
                          </span>
                          <span className="admin-cs__conv-bottom">
                            <span className={`admin-cs__conv-preview ${unread > 0 ? 'admin-cs__conv-preview--unread' : ''}`}>
                              {c.last_message_text || '내용 없음'}
                            </span>
                            {unread > 0 && (
                              <span className="admin-cs__conv-badge">{unread > 99 ? '99+' : unread}</span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* 우측: 메시지 스레드 + 답장 */}
          <section className="admin-cs__thread">
            {!activeConversation ? (
              <div className="admin-cs__thread-empty">
                <p>왼쪽에서 문의 대화를 선택하세요.</p>
              </div>
            ) : (
              <>
                <div className="admin-cs__thread-head">
                  <span className="admin-cs__avatar admin-cs__avatar--sm">{initials(activePeer.nickname)}</span>
                  <span className="admin-cs__thread-name">
                    {activePeer.nickname || '알 수 없음'}
                    {activePeer.code && <span className="admin-cs__tag">#{activePeer.code}</span>}
                  </span>
                </div>

                <div className="admin-cs__thread-body">
                  {msgLoading ? (
                    <p className="admin-cs__status">불러오는 중...</p>
                  ) : msgError ? (
                    <div className="admin-cs__status">
                      <p>{msgError}</p>
                      <button className="admin-cs__retry" onClick={() => loadMessages(activeCid)}>다시 시도</button>
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="admin-cs__status">아직 주고받은 메시지가 없습니다.</p>
                  ) : (
                    messages.map((m) => {
                      // 사용자(문의자) 메시지 = peer 발신, 관리자/공식 발신 = 우측
                      const fromPeer = String(m.sender_id) === String(activePeer.id);
                      return (
                        <div key={m.id} className={`admin-cs__row ${fromPeer ? 'admin-cs__row--peer' : 'admin-cs__row--mine'}`}>
                          <div className={`admin-cs__bubble ${fromPeer ? 'admin-cs__bubble--peer' : 'admin-cs__bubble--mine'}`}>
                            <span className="admin-cs__msg-text">{m.text}</span>
                          </div>
                          <span className="admin-cs__msg-time">{fmtTime(m.created_at)}</span>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="admin-cs__reply-bar">
                  <textarea
                    className="admin-cs__reply-input"
                    placeholder="답장 입력... (Enter 전송, Shift+Enter 줄바꿈)"
                    value={replyText}
                    rows={2}
                    maxLength={2000}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <button
                    className="admin-cs__reply-btn"
                    onClick={handleSend}
                    disabled={!replyText.trim() || sending}
                  >
                    {sending ? '전송 중...' : '전송'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
