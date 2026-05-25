import './SceneInput.css';

/**
 * v2.2 — 시점 칸은 단일 textarea로 통합.
 * 사용자가 그때의 상황·행동·심정을 한 덩어리로 자연스럽게 적고,
 * AI가 가사화 시 그 안에서 장면과 감정을 모두 추출한다.
 */
export default function SceneInput({
  label,
  required = false,
  optional = false,
  value,
  onChange,
  placeholder,
  hint,
}) {
  return (
    <div className="scene-input">
      <div className="scene-input__label">
        <span className="scene-input__label-text">{label}</span>
        {required && <span className="req">*</span>}
        {optional && <span className="opt">(선택)</span>}
      </div>
      <textarea
        className="scene-input__textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && <p className="scene-input__hint muted">{hint}</p>}
    </div>
  );
}
