import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { FiSend, FiMoreVertical, FiArrowLeft } from 'react-icons/fi';
import Avatar from './Avatar';
import './DmChatView.css';

/**
 * DmChatView — 단일 1:1 대화 스레드 (메시지 리스트 + 입력창).
 * 상태(메시지/로딩/전송)는 상위 DmInboxPage 가 소유하고, 여기는 표시 + 콜백만 담당.
 * 로그 prefix `[DmChat]`.
 *
 * props:
 *  - conversation: { conversation_id, peer:{id,nickname,profile_image,code} }
 *      (code: v156 배틀태그 = referral_code 4자리, legacy/결측 시 null → 태그 미표시)
 *  - messages: [{id, sender_id, text, created_at, read, pending?}]
 *  - currentUserId: string
 *  - loading: bool (초기 메시지 로딩)
 *  - loadingMore: bool (과거 로딩)
 *  - hasMore: bool
 *  - sending: bool
 *  - onSend(text)
 *  - onLoadMore()
 *  - onBack() — 모바일 목록 복귀
 *  - onBlock(), onReport(message)
 *  - requestMode: bool (v155 — 내가 수신자인 pending 메시지 요청 → 입력바 대신 수락/거절/차단 바)
 *  - onAccept(), onDecline() — requestMode 전용 콜백
 *  - initialText: string (CS 오류신고 프리필 — 마운트 시 입력창 초기값. 자동 전송하지 않음)
 */

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function DmChatView({
  conversation,
  messages,
  currentUserId,
  loading,
  loadingMore,
  hasMore,
  sending,
  onSend,
  onLoadMore,
  onBack,
  onBlock,
  onReport,
  requestMode = false,
  onAccept,
  onDecline,
  initialText = '',
}) {
  // CS 오류신고 프리필: 마운트 시 초기값으로 시드(자동 전송 X). 대화 전환 시엔 아래에서 '' 로 리셋.
  const [text, setText] = useState(() => initialText || '');
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  // 과거 로드 시 스크롤 위치 보존을 위한 이전 scrollHeight
  const prevScrollHeightRef = useRef(0);
  const prevMsgCountRef = useRef(0);
  const prevLastIdRef = useRef(null);

  const peer = conversation?.peer || {};
  // v155 — 발신자측 pending(내가 요청자): 입력은 가능, 안내 문구만 노출
  const senderPending = conversation?.status === 'pending' && !requestMode;

  // 대화 전환 감지용 (스크롤 추적 ref 초기화는 layout effect 안에서)
  const prevConvIdRef = useRef(conversation?.conversation_id);

  // 새 메시지 도착(맨 아래 추가) 시 하단으로 스크롤. 과거 로드 시엔 위치 보존.
  useLayoutEffect(() => {
    // 대화 전환 → 스크롤 추적 ref 초기화 (초기 로드 분기로 유도)
    if (prevConvIdRef.current !== conversation?.conversation_id) {
      prevConvIdRef.current = conversation?.conversation_id;
      prevMsgCountRef.current = 0;
      prevLastIdRef.current = null;
      prevScrollHeightRef.current = 0;
    }
    const el = scrollRef.current;
    if (!el) return;
    const count = messages.length;
    const lastId = count > 0 ? messages[count - 1].id : null;
    const prevCount = prevMsgCountRef.current;
    const prevLastId = prevLastIdRef.current;

    if (count > prevCount && prevCount > 0 && lastId === prevLastId) {
      // 앞쪽(과거)에 추가됨 → 스크롤 위치 보존
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    } else {
      // 초기 로드 또는 하단에 새 메시지 → 맨 아래로
      el.scrollTop = el.scrollHeight;
    }
    prevMsgCountRef.current = count;
    prevLastIdRef.current = lastId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages, conversation?.conversation_id]);

  // 대화 전환 시 입력/메뉴 초기화 (렌더 중 상태 조정 패턴 — effect 내 setState 회피)
  const [prevCid, setPrevCid] = useState(conversation?.conversation_id);
  if (conversation?.conversation_id !== prevCid) {
    setPrevCid(conversation?.conversation_id);
    setText('');
    setMenuOpen(false);
  }

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 40 && hasMore && !loadingMore && !loading) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, loadingMore, loading, onLoadMore]);

  const submit = () => {
    const t = text.trim();
    if (!t || sending) return;
    if (import.meta.env.DEV) console.info('[DmChat] send submit', { len: t.length });
    onSend(t);
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  if (!conversation) {
    return (
      <div className="dmchat dmchat--empty">
        <p className="dmchat__empty-text">대화를 선택하세요</p>
      </div>
    );
  }

  // 날짜 구분선용 — 직전 메시지와 날짜가 다르면 헤더 삽입
  let lastDay = null;

  return (
    <div className="dmchat">
      <div className="dmchat__head">
        <button className="dmchat__back" onClick={onBack} title="목록으로" aria-label="목록으로">
          <FiArrowLeft />
        </button>
        <Avatar src={peer.profile_image} name={peer.nickname} size={36} />
        <span className="dmchat__peer-name">
          {peer.nickname || '알 수 없음'}
          {peer.code && <span className="dmchat__peer-tag">#{peer.code}</span>}
        </span>
        <div className="dmchat__menu-wrap">
          <button
            className="dmchat__menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title="더보기"
            aria-label="더보기"
          >
            <FiMoreVertical />
          </button>
          {menuOpen && (
            <>
              <div className="dmchat__menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="dmchat__menu">
                <button
                  className="dmchat__menu-item"
                  onClick={() => { setMenuOpen(false); onBlock(); }}
                >
                  차단하기
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="dmchat__body" ref={scrollRef} onScroll={handleScroll}>
        {loadingMore && <p className="dmchat__loading-more">이전 메시지 불러오는 중...</p>}
        {loading ? (
          <p className="dmchat__loading">불러오는 중...</p>
        ) : messages.length === 0 ? (
          <p className="dmchat__empty-thread">아직 주고받은 메시지가 없습니다.<br />첫 메시지를 보내보세요.</p>
        ) : (
          messages.map((m) => {
            const mine = String(m.sender_id) === String(currentUserId);
            const day = fmtDay(m.created_at);
            const showDay = day && day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && <div className="dmchat__daysep"><span>{day}</span></div>}
                <div className={`dmchat__row ${mine ? 'dmchat__row--mine' : 'dmchat__row--peer'}`}>
                  <div className={`dmchat__bubble ${mine ? 'dmchat__bubble--mine' : 'dmchat__bubble--peer'} ${m.pending ? 'dmchat__bubble--pending' : ''}`}>
                    <span className="dmchat__text">{m.text}</span>
                  </div>
                  <div className="dmchat__meta">
                    {m.pending ? '전송 중...' : fmtTime(m.created_at)}
                    {!mine && (
                      <button
                        className="dmchat__report-btn"
                        title="신고"
                        onClick={() => onReport(m)}
                      >
                        신고
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {requestMode ? (
        /* v155 — 수신 pending 요청: 입력바 대신 수락/거절/차단 액션 바 */
        <div className="dmchat__request-bar">
          <p className="dmchat__request-note">
            메시지 요청 — 수락하기 전까지 상대에게 읽음이 표시되지 않아요.
          </p>
          <div className="dmchat__request-actions">
            <button
              className="dmchat__request-btn dmchat__request-btn--accept"
              onClick={() => {
                if (import.meta.env.DEV) console.info('[DmChat] request accept click');
                onAccept?.();
              }}
            >
              수락
            </button>
            <button
              className="dmchat__request-btn"
              onClick={() => {
                if (import.meta.env.DEV) console.info('[DmChat] request decline click');
                onDecline?.();
              }}
            >
              거절
            </button>
            <button
              className="dmchat__request-btn dmchat__request-btn--danger"
              onClick={() => {
                if (import.meta.env.DEV) console.info('[DmChat] request block click');
                onBlock?.();
              }}
            >
              차단
            </button>
          </div>
        </div>
      ) : (
        <>
          {senderPending && (
            <p className="dmchat__pending-note">요청 대기 중 — 상대가 수락하면 대화가 시작돼요.</p>
          )}
          <div className="dmchat__input-bar">
            <textarea
              className="dmchat__input"
              placeholder="메시지 입력..."
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
            />
            <button
              className="dmchat__send-btn"
              onClick={submit}
              disabled={!text.trim() || sending}
              title="보내기"
              aria-label="보내기"
            >
              <FiSend />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
