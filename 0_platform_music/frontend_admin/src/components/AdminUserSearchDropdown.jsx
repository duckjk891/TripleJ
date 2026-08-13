import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCsUsers } from '../api';
import './AdminUserSearchDropdown.css';

// 공용 단일 선택 사용자 검색 드롭다운 — v179 AdminCsSendModal 검증 패턴 이식.
// focus/click 으로 열림(빈 검색어 = 브라우즈 목록), 300ms 디바운스 + stale seq 가드,
// absolute 오버레이 고정 높이, 바깥 mousedown/Esc 로 닫힘(blur 사용 금지 — 항목 클릭 씹힘).
// 항목 클릭 시 onSelect(user) 호출 + 드롭다운 닫힘 + input 에 닉네임#code 표시(단일 선택).
// 로그 prefix `[AdminUserSearch]` — 검색어·닉네임 원문은 콘솔에 출력하지 않는다(q_len 만).

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

export default function AdminUserSearchDropdown({ onSelect, placeholder = '닉네임 또는 #태그로 검색', disabled = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchAreaRef = useRef(null); // input+드롭다운 wrapper — outside 판정 경계
  const searchSeqRef = useRef(0); // 늦게 도착한 이전 검색 응답 무시용 시퀀스

  const runSearch = useCallback(async (q) => {
    const seq = ++searchSeqRef.current;
    setSearching(true);
    if (import.meta.env.DEV) console.info('[AdminUserSearch] searching users', { q_len: q.length, limit: SEARCH_LIMIT });
    try {
      const { data } = await searchCsUsers(q, SEARCH_LIMIT);
      if (seq !== searchSeqRef.current) return;
      if (!Array.isArray(data?.users)) {
        console.warn('[AdminUserSearch] unexpected search response shape', { keys: Object.keys(data || {}) });
      }
      setResults(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      console.error('[AdminUserSearch] searchCsUsers failed', { status: err?.response?.status, q_len: q.length, message: err?.message });
      setResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, []);

  // 검색/브라우즈 — 타이핑은 300ms 디바운스, 빈 검색어(드롭다운 열림 직후·전부 삭제)는 즉시 브라우즈.
  useEffect(() => {
    if (!dropdownOpen) return undefined;
    const q = query.trim();
    const delay = q ? DEBOUNCE_MS : 0;
    const timer = setTimeout(() => { runSearch(q); }, delay);
    return () => clearTimeout(timer);
  }, [dropdownOpen, query, runSearch]);

  // 드롭다운 닫기 — 진행 중 검색 무효화 + 로딩 표시 해제
  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    searchSeqRef.current += 1;
    setSearching(false);
  }, []);

  // 바깥 mousedown + Esc 로 닫기 — 드롭다운 열림 동안만 리스너 등록.
  // blur 기반 닫기 금지: mousedown→blur→click 순서로 항목 클릭이 씹힌다.
  useEffect(() => {
    if (!dropdownOpen) return undefined;
    const onMouseDown = (e) => {
      if (searchAreaRef.current && !searchAreaRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // 드롭다운 열림 상태에서만 소비
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dropdownOpen, closeDropdown]);

  const handlePick = (user) => {
    if (disabled) return;
    if (!user?.id) {
      console.warn('[AdminUserSearch] picked user without id', { keys: Object.keys(user || {}) });
      return;
    }
    setQuery(displayName(user)); // 단일 선택 — input 에 닉네임#code 표시
    closeDropdown();
    onSelect?.(user);
  };

  const trimmedQuery = query.trim();

  return (
    <div className="admin-user-search" ref={searchAreaRef}>
      <input
        type="text"
        className="admin-user-search__input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={(e) => { setDropdownOpen(true); e.target.select(); }}
        onClick={() => setDropdownOpen(true)} // Esc 닫기 후 focus 잔존 상태 재클릭 재오픈
        disabled={disabled}
      />

      {dropdownOpen && (
        <div className="admin-user-search__dropdown">
          {searching ? (
            <p className="admin-user-search__status">검색 중...</p>
          ) : results.length === 0 ? (
            <p className="admin-user-search__status">
              {trimmedQuery ? '검색 결과가 없습니다.' : '표시할 사용자가 없습니다.'}
            </p>
          ) : (
            <ul className="admin-user-search__list">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    className="admin-user-search__item"
                    onClick={() => handlePick(u)}
                    disabled={disabled}
                  >
                    <span className="admin-user-search__avatar">{initials(u.nickname)}</span>
                    <span className="admin-user-search__name">{displayName(u)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
