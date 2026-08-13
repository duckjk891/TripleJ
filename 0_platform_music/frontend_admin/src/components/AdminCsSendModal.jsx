import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCsUsers, sendCsDirect } from '../api';
import './AdminCsSendModal.css';

// 지정 발송 모달 — CS 페이지 헤더 "✉️ 지정 발송" 버튼으로 오픈.
// 닉네임/#태그 검색(300ms 디바운스) → 결과 클릭으로 대상 선택 chips(최대 20명)
// → textarea(최대 2000자) → window.confirm 최종 확인 → POST /admin/cs/send.
// 로그 prefix `[AdminCsSend]`. 메시지 text·닉네임 원문은 콘솔에 출력하지 않는다(길이/건수만).

const MAX_LEN = 2000;
const MAX_TARGETS = 20;
const SEARCH_LIMIT = 10;
const DEBOUNCE_MS = 300;

function initials(name) {
  const n = (name || '').trim();
  return n ? n.slice(0, 1).toUpperCase() : '?';
}

function displayName(user) {
  const nickname = user?.nickname || '알 수 없음';
  return user?.code ? `${nickname}#${user.code}` : nickname;
}

export default function AdminCsSendModal({ open, onClose, onSuccess }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState([]); // [{id, nickname, code}]
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(''); // 인라인 안내(검증/에러)

  // 늦게 도착한 이전 검색 응답 무시용 시퀀스
  const searchSeqRef = useRef(0);

  const runSearch = useCallback(async (q) => {
    const seq = ++searchSeqRef.current;
    setSearching(true);
    // 검색어 원문은 콘솔에 출력하지 않는다(q_len 만).
    if (import.meta.env.DEV) console.info('[AdminCsSend] searching users', { q_len: q.length, limit: SEARCH_LIMIT });
    try {
      const { data } = await searchCsUsers(q, SEARCH_LIMIT);
      if (seq !== searchSeqRef.current) return;
      if (!Array.isArray(data?.users)) {
        console.warn('[AdminCsSend] unexpected search response shape', { keys: Object.keys(data || {}) });
      }
      setResults(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      console.error('[AdminCsSend] searchCsUsers failed', { status: err?.response?.status, q_len: q.length, message: err?.message });
      setResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, []);

  // 검색 디바운스 — 입력 후 300ms 지나면 호출. 빈 검색어 정리는 handleQueryChange 에서.
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (!q) return undefined;
    const timer = setTimeout(() => { runSearch(q); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, runSearch]);

  const reset = useCallback(() => {
    searchSeqRef.current += 1; // 진행 중 검색 응답 무효화
    setQuery('');
    setResults([]);
    setSearching(false);
    setSelected([]);
    setText('');
    setNotice('');
  }, []);

  const handleClose = useCallback(() => {
    if (sending) return;
    reset();
    onClose?.();
  }, [sending, reset, onClose]);

  const handleQueryChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    if (!v.trim()) {
      searchSeqRef.current += 1;
      setResults([]);
      setSearching(false);
    }
  };

  const handlePick = (user) => {
    if (sending) return;
    if (!user?.id) {
      console.warn('[AdminCsSend] picked user without id', { keys: Object.keys(user || {}) });
      return;
    }
    if (selected.some((u) => u.id === user.id)) return;
    if (selected.length >= MAX_TARGETS) {
      setNotice(`최대 ${MAX_TARGETS}명까지 선택할 수 있습니다. 더 많은 대상은 전체 발송을 이용해주세요.`);
      return;
    }
    setNotice('');
    setSelected((prev) => [...prev, { id: user.id, nickname: user.nickname, code: user.code }]);
  };

  const handleRemove = (id) => {
    if (sending) return;
    setSelected((prev) => prev.filter((u) => u.id !== id));
    setNotice('');
  };

  const handleSend = useCallback(async () => {
    if (sending) return;
    const trimmed = text.trim();
    if (selected.length === 0) {
      setNotice('발송 대상을 선택해주세요.');
      return;
    }
    if (!trimmed) {
      setNotice('메시지를 입력해주세요.');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      // maxLength 로 보통 도달 불가 — 붙여넣기 등 예상외 경로 방어
      console.warn('[AdminCsSend] text over max length', { len: trimmed.length });
      setNotice(`메시지는 ${MAX_LEN}자 이내로 입력해주세요.`);
      return;
    }
    setNotice('');
    const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
    const names = selected.map(displayName).join(', ');
    const confirmed = window.confirm(
      `선택한 ${selected.length}명에게 발송합니다. 되돌릴 수 없습니다.\n\n대상: ${names}\n\n"${preview}"\n\n발송하시겠습니까?`
    );
    if (!confirmed) return;
    setSending(true);
    if (import.meta.env.DEV) console.info('[AdminCsSend] sending', { targets: selected.length, text_len: trimmed.length });
    try {
      const { data } = await sendCsDirect(selected.map((u) => u.id), trimmed);
      const sent = typeof data?.sent === 'number' ? data.sent : 0;
      const failed = typeof data?.failed === 'number' ? data.failed : 0;
      if (typeof data?.sent !== 'number') {
        console.warn('[AdminCsSend] sent missing in response', { keys: Object.keys(data || {}) });
      }
      if (import.meta.env.DEV) console.info('[AdminCsSend] send done', { requested: data?.requested, sent, failed });
      alert(`${sent}명 발송 완료${failed > 0 ? ` (실패 ${failed})` : ''}`);
      reset();
      onSuccess?.(data);
      onClose?.();
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminCsSend] sendCsDirect failed', { status, targets: selected.length, text_len: trimmed.length, message: err?.message });
      if (status === 400) {
        const detail = err?.response?.data?.detail || err?.response?.data?.error || err?.response?.data?.message;
        setNotice(detail || '발송 대상 또는 메시지가 올바르지 않습니다.');
      } else if (status === 403) {
        setNotice('권한이 없습니다');
      } else if (status === 503) {
        setNotice('공식 계정이 설정되지 않았습니다');
      } else {
        console.warn('[AdminCsSend] unexpected error status', { status });
        setNotice('발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSending(false);
    }
  }, [sending, text, selected, reset, onSuccess, onClose]);

  if (!open) return null;

  const remaining = MAX_LEN - text.length;
  const trimmedQuery = query.trim();

  return (
    <div className="admin-cs-send__overlay" onClick={handleClose}>
      <div className="admin-cs-send" onClick={(e) => e.stopPropagation()}>
        <div className="admin-cs-send__head">
          <h3 className="admin-cs-send__title">✉️ 지정 발송</h3>
          <button className="admin-cs-send__close" onClick={handleClose} aria-label="닫기">×</button>
        </div>

        <input
          type="text"
          className="admin-cs-send__search"
          placeholder="닉네임 또는 #태그로 검색"
          value={query}
          onChange={handleQueryChange}
          disabled={sending}
        />

        {trimmedQuery && (
          <div className="admin-cs-send__results">
            {searching ? (
              <p className="admin-cs-send__results-status">검색 중...</p>
            ) : results.length === 0 ? (
              <p className="admin-cs-send__results-status">검색 결과가 없습니다.</p>
            ) : (
              <ul className="admin-cs-send__result-list">
                {results.map((u) => {
                  const picked = selected.some((s) => s.id === u.id);
                  return (
                    <li key={u.id}>
                      <button
                        className={`admin-cs-send__result ${picked ? 'admin-cs-send__result--picked' : ''}`}
                        onClick={() => handlePick(u)}
                        disabled={sending || picked}
                      >
                        <span className="admin-cs-send__avatar">{initials(u.nickname)}</span>
                        <span className="admin-cs-send__result-name">{displayName(u)}</span>
                        {picked && <span className="admin-cs-send__result-picked-mark">선택됨</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="admin-cs-send__chips-head">
          <span className="admin-cs-send__chips-label">발송 대상</span>
          <span className="admin-cs-send__chips-counter">{selected.length}/{MAX_TARGETS}</span>
        </div>
        <div className="admin-cs-send__chips">
          {selected.length === 0 ? (
            <p className="admin-cs-send__chips-empty">검색 결과를 클릭해 대상을 추가하세요.</p>
          ) : (
            selected.map((u) => (
              <span key={u.id} className="admin-cs-send__chip">
                {displayName(u)}
                <button
                  className="admin-cs-send__chip-remove"
                  onClick={() => handleRemove(u.id)}
                  disabled={sending}
                  aria-label={`${displayName(u)} 제거`}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        <textarea
          className="admin-cs-send__text"
          placeholder="발송할 메시지를 입력하세요"
          value={text}
          rows={5}
          maxLength={MAX_LEN}
          onChange={(e) => { setText(e.target.value); if (notice) setNotice(''); }}
          disabled={sending}
        />
        <p className="admin-cs-send__counter">{remaining}자 남음</p>

        {notice && <p className="admin-cs-send__notice">{notice}</p>}

        <div className="admin-cs-send__actions">
          <button className="admin-cs-send__cancel" onClick={handleClose} disabled={sending}>
            취소
          </button>
          <button className="admin-cs-send__send" onClick={handleSend} disabled={sending}>
            {sending ? '발송 중...' : '발송'}
          </button>
        </div>
      </div>
    </div>
  );
}
