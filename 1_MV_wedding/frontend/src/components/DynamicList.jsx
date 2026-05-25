import './DynamicList.css';

export default function DynamicList({
  items,
  onChange,
  placeholder,
  addButtonLabel = '+ 항목 추가',
  multiline = true,
}) {
  const handleChange = (idx, value) => {
    const next = items.slice();
    next[idx] = value;
    onChange(next);
  };

  const handleRemove = (idx) => {
    const next = items.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const handleAdd = () => {
    onChange([...items, '']);
  };

  return (
    <div className="dyn-list">
      {items.map((value, idx) => (
        <div key={idx} className="dyn-list__row">
          {multiline ? (
            <textarea
              className="dyn-list__input"
              value={value}
              onChange={(e) => handleChange(idx, e.target.value)}
              placeholder={placeholder}
            />
          ) : (
            <input
              type="text"
              className="dyn-list__input"
              value={value}
              onChange={(e) => handleChange(idx, e.target.value)}
              placeholder={placeholder}
            />
          )}
          <button
            type="button"
            className="dyn-list__remove"
            onClick={() => handleRemove(idx)}
            aria-label="이 항목 삭제"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="dyn-list__add" onClick={handleAdd}>
        {addButtonLabel}
      </button>
    </div>
  );
}
