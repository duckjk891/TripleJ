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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
        />
      </div>
      {hint && <p className="tag-input__hint">{hint}</p>}
    </div>
  );
}
