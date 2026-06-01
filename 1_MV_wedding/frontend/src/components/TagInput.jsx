import { useState } from 'react';
import './TagInput.css';

export default function TagInput({ tags, onChange, placeholder, hint }) {
  const [draft, setDraft] = useState('');

  const commit = (raw) => {
    const value = raw.trim();
    if (!value) return;
    if (tags.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...tags, value]);
    setDraft('');
  };

  // v13.2 — 복붙 또는 키보드 콤마 입력 모두 동일 경로로 분리.
  // value 안에 ',' 또는 '\n' 가 포함되면 split → 각 조각을 칩으로 추가하고
  // 마지막 조각만 draft 로 유지(아직 입력 중일 수 있는 단어).
  const handleChange = (e) => {
    const v = e.target.value;
    if (v.includes(',') || v.includes('\n')) {
      const parts = v.split(/[,\n]/);
      const finalDraft = parts.pop() ?? '';
      const next = tags.slice();
      let changed = false;
      for (const p of parts) {
        const t = p.trim();
        if (t && !next.includes(t)) {
          next.push(t);
          changed = true;
        }
      }
      if (changed) {
        if (import.meta.env.DEV) {
          console.info('[TagInput] split commit', {
            added: next.length - tags.length,
            total: next.length,
          });
        }
        onChange(next);
      }
      setDraft(finalDraft);
      return;
    }
    setDraft(v);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      const next = tags.slice(0, -1);
      onChange(next);
    }
  };

  const handleBlur = () => {
    if (draft.trim()) commit(draft);
  };

  const removeAt = (idx) => {
    const next = tags.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div className="tag-input">
      <div className="tag-input__box">
        {tags.map((tag, idx) => (
          <span key={tag + idx} className="tag-input__chip">
            {tag}
            <button
              type="button"
              className="tag-input__chip-remove"
              onClick={() => removeAt(idx)}
              aria-label={`${tag} 제거`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input__field"
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
        />
      </div>
      {hint && <p className="tag-input__hint">{hint}</p>}
    </div>
  );
}
