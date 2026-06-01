import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import './MentionField.css';

/**
 * v8 — MentionField
 * `<textarea>` 위에 mirror div 오버레이로 칩 하이라이트 + `@` 트리거 팝업.
 *
 * Props
 *  value          : string
 *  refs           : MentionRef[]  ({type, asset_id, display_name, object_name})
 *  onChange       : (newValue: string) => void
 *  onChangeRefs   : (newRefs: MentionRef[]) => void
 *  options        : MentionOption[]
 *      ({type, asset_id, display_name, object_name, group_label})
 *  placeholder?   : string
 *  rows?          : number  (default 4)
 *  ariaLabel?     : string
 *  id?            : string
 *  disabled?      : boolean
 *  className?     : string   (textarea 에 추가될 클래스)
 *
 * 빈 options → mention 기능 비활성. 평범한 textarea처럼 동작.
 */

const MENTION_RE = /@([^\s@]{0,30})$/;

const tag = (props) => `[MentionField:${props.ariaLabel || props.id || 'unnamed'}]`;

/** 본문에서 각 ref 의 `@{display_name}` 가 몇 번 나타나는지 세서 refs 정합성 보정.
 *  v13.1 — options(시트+장소 풀) 도 받아 본문에 있는데 refs 에 없는 토큰은 자동으로 push.
 *  • 복붙·다듬기 결과 등 외부에서 들어온 텍스트의 @-토큰도 자동 인식됨.
 *  • 옵션 안에서 가장 긴 display_name 부터 매칭(짧은 게 긴 것의 접두면 우선순위 충돌 방지).
 */
function reconcileRefs(value, refs, options = []) {
  const safeRefs = Array.isArray(refs) ? refs : [];
  // refs + options 의 (display_name → option-or-ref) 매핑. refs 우선.
  const byName = new Map();
  for (const r of safeRefs) {
    if (!r || typeof r.display_name !== 'string' || !r.display_name) continue;
    if (!byName.has(r.display_name)) byName.set(r.display_name, r);
  }
  if (Array.isArray(options)) {
    for (const o of options) {
      if (!o || typeof o.display_name !== 'string' || !o.display_name) continue;
      if (!byName.has(o.display_name)) {
        byName.set(o.display_name, {
          type: o.type,
          asset_id: o.asset_id,
          display_name: o.display_name,
          object_name: o.object_name ?? null,
        });
      }
    }
  }
  if (byName.size === 0) return safeRefs;

  // 긴 이름부터 매칭(접두 충돌 방지)
  const names = Array.from(byName.keys()).sort((a, b) => b.length - a.length);

  const next = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '@') {
      let matched = false;
      for (const name of names) {
        const tok = '@' + name;
        if (value.substr(i, tok.length) === tok) {
          // base ref: refs 안의 동일 display_name 첫 항목 또는 option 기반.
          const base = byName.get(name);
          next.push({
            type: base.type,
            asset_id: base.asset_id,
            display_name: name,
            object_name: base.object_name ?? null,
          });
          i += tok.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    i += 1;
  }
  return next;
}

/** value 를 본문 토큰 단위로 잘라서 chip span / plain span 으로 렌더.
 *  v13.1 — refs 뿐 아니라 options 의 display_name 도 chip 으로 렌더(아직 refs 에 등록 안 됐어도 즉시 시각화).
 */
function tokenizeForMirror(value, refs, options = []) {
  const refNames = (Array.isArray(refs) ? refs : []).map((r) => r && r.display_name).filter(Boolean);
  const optNames = (Array.isArray(options) ? options : []).map((o) => o && o.display_name).filter(Boolean);
  const nameSet = new Set([...refNames, ...optNames]);
  if (nameSet.size === 0) return [{ kind: 'text', text: value }];
  const names = Array.from(nameSet).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ kind: 'text', text: value }];

  const tokens = [];
  let i = 0;
  outer: while (i < value.length) {
    if (value[i] === '@') {
      for (const name of names) {
        const candidate = '@' + name;
        if (value.substr(i, candidate.length) === candidate) {
          tokens.push({ kind: 'chip', text: candidate });
          i += candidate.length;
          continue outer;
        }
      }
    }
    // plain 문자 1개씩 누적 (마지막 토큰이 text 면 이어붙임).
    const last = tokens[tokens.length - 1];
    if (last && last.kind === 'text') last.text += value[i];
    else tokens.push({ kind: 'text', text: value[i] });
    i += 1;
  }
  return tokens;
}

export default function MentionField({
  value,
  refs = [],
  onChange,
  onChangeRefs,
  options = [],
  placeholder,
  rows = 4,
  ariaLabel,
  id,
  disabled = false,
  className = '',
}) {
  const textareaRef = useRef(null);
  const mirrorRef = useRef(null);
  const containerRef = useRef(null);

  // 팝업 상태.
  const [popupOpen, setPopupOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [activeIdx, setActiveIdx] = useState(0);

  const mentionEnabled = Array.isArray(options) && options.length > 0;

  // 필터링된 옵션 (그룹별, 그룹 내 사전순).
  const filtered = useMemo(() => {
    if (!mentionEnabled) return [];
    const q = (query || '').toLowerCase();
    const matched = options.filter(
      (o) => o && typeof o.display_name === 'string' && o.display_name.toLowerCase().includes(q)
    );
    // 그룹별 묶기, 그룹 안에서 display_name 사전순.
    const groups = new Map(); // group_label -> options[]
    for (const o of matched) {
      const label = o.group_label || '';
      const arr = groups.get(label);
      if (arr) arr.push(o);
      else groups.set(label, [o]);
    }
    const out = [];
    for (const [label, arr] of groups.entries()) {
      arr.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'));
      out.push({ label, items: arr });
    }
    return out;
  }, [options, query, mentionEnabled]);

  // flat 리스트 (키보드 탐색용).
  const flat = useMemo(() => {
    const items = [];
    for (const g of filtered) for (const it of g.items) items.push(it);
    return items;
  }, [filtered]);

  // popupOpen → flat 변하면 activeIdx 보정.
  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(0);
  }, [flat.length, activeIdx]);

  // 스크롤 동기화 (textarea ↔ mirror).
  const syncScroll = () => {
    const ta = textareaRef.current;
    const mi = mirrorRef.current;
    if (!ta || !mi) return;
    mi.scrollTop = ta.scrollTop;
    mi.scrollLeft = ta.scrollLeft;
  };

  useLayoutEffect(() => {
    syncScroll();
  }, [value]);

  // 외부 클릭 시 팝업 닫기.
  useEffect(() => {
    if (!popupOpen) return undefined;
    const onDocClick = (e) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target)) return;
      setPopupOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [popupOpen]);

  /** 본문 변경 콜백: 트리거 탐지 + refs reconcile. */
  const handleInputChange = (e) => {
    const newValue = e.target.value;
    const caret = e.target.selectionStart || 0;
    // 트리거 탐지.
    if (mentionEnabled) {
      const head = newValue.slice(0, caret);
      const m = head.match(MENTION_RE);
      if (m) {
        const start = m.index;
        const q = m[1] || '';
        setMentionStart(start);
        setQuery(q);
        setActiveIdx(0);
        setPopupOpen(true);
        if (import.meta.env.DEV) {
          // count 는 현재 options 기반 추정 (필터링 결과는 useMemo 비동기) — 안내 정도면 충분.
          const approxCount = options.filter(
            (o) => o && o.display_name.toLowerCase().includes(q.toLowerCase())
          ).length;
          console.info(`${tag({ ariaLabel, id })} popup open`, {
            query: q,
            count: approxCount,
          });
        }
      } else {
        if (popupOpen) setPopupOpen(false);
        setMentionStart(-1);
        setQuery('');
      }
    }
    // refs reconcile (본문 직접 편집 추적 + options 풀에서 자동 인식).
    if (typeof onChangeRefs === 'function') {
      try {
        const next = reconcileRefs(newValue, refs, options);
        const changed =
          next.length !== refs.length ||
          next.some((r, i) => !refs[i] || r.asset_id !== refs[i].asset_id);
        if (changed) {
          if (import.meta.env.DEV) {
            console.info(`${tag({ ariaLabel, id })} refs reconciled`, {
              prev: refs.length,
              next: next.length,
            });
          }
          onChangeRefs(next);
        }
      } catch (err) {
        console.error(`${tag({ ariaLabel, id })} error`, { err, context: 'reconcile' });
      }
    }
    onChange(newValue);
  };

  /** 팝업에서 옵션 선택 확정. */
  const commitSelect = (opt) => {
    if (!opt) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart || 0;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    const insert = `@${opt.display_name} `;
    const newValue = before + insert + after;
    const newCaret = (before + insert).length;
    // refs 갱신: 현재 refs 에 push.
    const nextRefs = Array.isArray(refs) ? refs.slice() : [];
    nextRefs.push({
      type: opt.type,
      asset_id: opt.asset_id,
      display_name: opt.display_name,
      object_name: opt.object_name ?? null,
    });
    if (import.meta.env.DEV) {
      console.info(`${tag({ ariaLabel, id })} selected`, {
        asset_id: opt.asset_id,
        type: opt.type,
        display_name: opt.display_name,
      });
    }
    onChange(newValue);
    if (typeof onChangeRefs === 'function') onChangeRefs(nextRefs);
    // 팝업 닫음.
    setPopupOpen(false);
    setQuery('');
    setMentionStart(-1);
    // caret 위치 복원.
    requestAnimationFrame(() => {
      try {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      } catch {
        /* noop */
      }
    });
  };

  /** keydown — 팝업 탐색 + Backspace 칩 통째 삭제. */
  const handleKeyDown = (e) => {
    // 팝업 열렸을 때의 키보드 동작.
    if (popupOpen && flat.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % flat.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + flat.length) % flat.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        commitSelect(flat[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPopupOpen(false);
        return;
      }
    }
    // Backspace 칩 통째 삭제.
    if (e.key === 'Backspace' && !popupOpen && Array.isArray(refs) && refs.length > 0) {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = ta.selectionStart || 0;
      const selEnd = ta.selectionEnd || 0;
      if (caret !== selEnd) return; // 선택 영역 있으면 default 동작.
      // caret 직전이 `@display_name + " "` (또는 `@display_name` 끝) 인지 검사.
      const names = Array.from(
        new Set(refs.map((r) => r && r.display_name).filter(Boolean))
      ).sort((a, b) => b.length - a.length);
      for (const name of names) {
        // 두 가지 패턴: `@name ` (공백 포함) 끝, 혹은 caret 직전이 `@name` (공백 없음).
        const withSpace = `@${name} `;
        if (value.slice(caret - withSpace.length, caret) === withSpace) {
          e.preventDefault();
          const newValue = value.slice(0, caret - withSpace.length) + value.slice(caret);
          const newCaret = caret - withSpace.length;
          onChange(newValue);
          if (typeof onChangeRefs === 'function') {
            const nextRefs = reconcileRefs(newValue, refs, options);
            onChangeRefs(nextRefs);
          }
          requestAnimationFrame(() => {
            try {
              ta.focus();
              ta.setSelectionRange(newCaret, newCaret);
            } catch {
              /* noop */
            }
          });
          return;
        }
        const noSpace = `@${name}`;
        if (value.slice(caret - noSpace.length, caret) === noSpace) {
          e.preventDefault();
          const newValue = value.slice(0, caret - noSpace.length) + value.slice(caret);
          const newCaret = caret - noSpace.length;
          onChange(newValue);
          if (typeof onChangeRefs === 'function') {
            const nextRefs = reconcileRefs(newValue, refs, options);
            onChangeRefs(nextRefs);
          }
          requestAnimationFrame(() => {
            try {
              ta.focus();
              ta.setSelectionRange(newCaret, newCaret);
            } catch {
              /* noop */
            }
          });
          return;
        }
      }
    }
  };

  /** mirror 토큰 렌더 — v13.1: options 도 chip 으로 시각화. */
  const tokens = useMemo(() => tokenizeForMirror(value, refs, options), [value, refs, options]);

  /** v13.1 — value 또는 options 가 외부에서 바뀌면(예: 다듬기 적용, 복붙 후 옵션 fetch) 자동 reconcile. */
  useEffect(() => {
    if (typeof onChangeRefs !== 'function') return;
    if (!mentionEnabled) return;
    try {
      const next = reconcileRefs(value, refs, options);
      const changed =
        next.length !== (refs?.length || 0) ||
        next.some((r, i) => !refs[i] || r.asset_id !== refs[i].asset_id || r.display_name !== refs[i].display_name);
      if (changed) {
        if (import.meta.env.DEV) {
          console.info(`${tag({ ariaLabel, id })} refs auto-reconciled`, {
            prev: refs?.length || 0,
            next: next.length,
          });
        }
        onChangeRefs(next);
      }
    } catch (err) {
      console.error(`${tag({ ariaLabel, id })} error`, { err, context: 'auto-reconcile' });
    }
    // refs 자체를 deps 에서 빼야 무한루프 방지(onChangeRefs 가 refs 를 갱신함).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options, mentionEnabled]);

  return (
    <div className="mention-field" ref={containerRef}>
      <div className="mention-mirror" aria-hidden="true" ref={mirrorRef}>
        {tokens.map((t, i) =>
          t.kind === 'chip' ? (
            <span key={i} className="mention-chip">
              {t.text}
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          )
        )}
        {/* 마지막 줄바꿈 케이스 보정: trailing newline 이 있으면 한 줄을 더 그려 줘야 mirror 가 textarea 와 정렬됨. */}
        {value.endsWith('\n') && <span> </span>}
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        aria-label={ariaLabel}
        className={`mention-field__textarea ${className}`.trim()}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onBlur={() => {
          // blur 시 팝업은 외부클릭이 처리. 그러나 tab-out 등은 여기서 닫음.
          // 마우스로 팝업 항목 클릭하는 케이스를 위해 약간 지연.
          setTimeout(() => setPopupOpen(false), 120);
        }}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
      />
      {popupOpen && mentionEnabled && flat.length > 0 && (
        <div className="mention-popup" role="listbox">
          {filtered.map((g, gi) => (
            <div key={`g-${gi}`} className="mention-popup__group">
              {g.label && <div className="mention-popup__group-label">{g.label}</div>}
              {g.items.map((opt) => {
                const flatIdx = flat.indexOf(opt);
                const isActive = flatIdx === activeIdx;
                return (
                  <div
                    key={`${opt.type}:${opt.asset_id}`}
                    className={`mention-popup__item${isActive ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => {
                      // textarea blur 방지.
                      e.preventDefault();
                      commitSelect(opt);
                    }}
                    onMouseEnter={() => setActiveIdx(flatIdx)}
                  >
                    {opt.object_name ? (
                      <img
                        className="mention-popup__thumb"
                        src={api.sheetPreviewUrl(opt.object_name)}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          // 이미지 로드 실패 시 placeholder 로 대체.
                          e.currentTarget.style.display = 'none';
                          const ph = e.currentTarget.nextElementSibling;
                          if (ph) ph.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className="mention-popup__thumb mention-popup__thumb--placeholder"
                      style={{ display: opt.object_name ? 'none' : 'flex' }}
                      aria-hidden="true"
                    >
                      {opt.type === 'sheet' ? '🧑'
                        : opt.type === 'place' ? '📍'
                        : opt.type === 'wedding_photo' ? '💞'
                        : opt.type === 'scene_image' ? '🎬'
                        : '📎'}
                    </div>
                    <span className="mention-popup__name">{opt.display_name}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
