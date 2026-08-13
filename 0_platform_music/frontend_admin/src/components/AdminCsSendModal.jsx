import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCsUsers, sendCsDirect } from '../api';
import './AdminCsSendModal.css';

// 지정 발송 모달 — CS 페이지 헤더 "✉️ 지정 발송" 버튼으로 오픈.
// 닉네임/#태그 검색(300ms 디바운스) + 빈 검색어면 브라우즈 목록(닉네임순, 서버 v178).
// 결과 리스트는 검색 입력 focus 시 열리는 드롭다운 오버레이(v179) — 항목 클릭으로 다중 선택,
// 바깥 mousedown/Esc 로 닫힘(blur 사용 금지 — 항목 클릭 씹힘).
// 선택 chips(최대 20명) → textarea(최대 2000자) → window.confirm 최종 확인 → POST /admin/cs/send.
// 로그 prefix `[AdminCsSend]`. 메시지 text·닉네임 원문은 콘솔에 출력하지 않는다(길이/건수만).

const MAX_LEN = 2000;
const MAX_TARGETS = 20;
const SEARCH_LIMIT = 20;
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
  // 검색 드롭다운 오버레이 (v179) — input focus 로 열고, 바깥 mousedown/Esc/모달 close 로 닫는다.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchAreaRef = useRef(null); // input+드롭다운 wrapper — outside 판정 경계

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

  // 검색/브라우즈 — 타이핑은 300ms 디바운스, 빈 검색어(드롭다운 열림 직후·전부 삭제)는 즉시 브라우즈 목록 호출.
  // 빈 q 호출은 서버(v178)가 닉네임순 브라우즈 목록으로 응답 — 형식 동일.
  // v179 — 트리거가 모달 open → 드롭다운 open(입력창 focus)으로 교체됨. 재focus 시 자동 재호출(신선도).
  useEffect(() => {
    if (!dropdownOpen) return undefined;
    const q = query.trim();
    const delay = q ? DEBOUNCE_MS : 0;
    const timer = setTimeout(() => { runSearch(q); }, delay);
    return () => clearTimeout(timer);
  }, [dropdownOpen, query, runSearch]);

  // 드롭다운 닫기 — 진행 중 검색 무효화 + 로딩 표시 해제 (잔여 "검색 중..." 방지)
  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    searchSeqRef.current += 1;
    setSearching(false);
  }, []);

  // 바깥 mousedown + Esc 로 닫기 — 드롭다운 열림 동안만 리스너 등록.
  // blur 기반 닫기 금지: mousedown→blur→click 순서로 항목 클릭이 씹힌다.
  // 패널이 wrapper 내부라 항목 클릭은 "내부" 판정 → 닫히지 않고 click 정상 도달(다중선택 유지).
  useEffect(() => {
    if (!(open && dropdownOpen)) return undefined;
    const onMouseDown = (e) => {
      if (searchAreaRef.current && !searchAreaRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // 드롭다운 열림 상태에서만 소비 — 모달은 유지
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, dropdownOpen, closeDropdown]);

  const reset = useCallback(() => {
    searchSeqRef.current += 1; // 진행 중 검색 응답 무효화
    setQuery('');
    setResults([]);
    setSearching(false);
    setDropdownOpen(false); // 모달 close 시 드롭다운 상태 동기화
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
    // 빈값 클리어 분기 없음 — 빈 q 는 effect 가 즉시 브라우즈로 대체(stale 응답은 seq 가드가 처리).
    setQuery(e.target.value);
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

        {/* 검색 입력 + 드롭다운 오버레이 wrapper — ref 가 outside mousedown 판정 경계 */}
        <div className="admin-cs-send__search-wrap" ref={searchAreaRef}>
          <input
            type="text"
            className="admin-cs-send__search"
            placeholder="닉네임 또는 #태그로 검색"
            value={query}
            onChange={handleQueryChange}
            onFocus={() => setDropdownOpen(true)}
            onClick={() => setDropdownOpen(true)} // Esc 닫기 후 focus 잔존 상태 재클릭 재오픈(원 요구 '클릭하거나 터치하면')
            disabled={sending}
          />

          {dropdownOpen && (
            <div className="admin-cs-send__dropdown">
              {searching ? (
                <p className="admin-cs-send__results-status">검색 중...</p>
              ) : results.length === 0 ? (
                <p className="admin-cs-send__results-status">
                  {trimmedQuery ? '검색 결과가 없습니다.' : '표시할 사용자가 없습니다.'}
                </p>
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
        </div>

        <div className="admin-cs-send__chips-head">
          <span className="admin-cs-send__chips-label">발송 대상</span>
          <span className="admin-cs-send__chips-counter">{selected.length}/{MAX_TARGETS}</span>
        </div>
        <div className="admin-cs-send__chips">
          {selected.length === 0 ? (
            <p className="admin-cs-send__chips-empty">목록에서 사용자를 클릭해 대상을 추가하세요.</p>
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
