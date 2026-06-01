import MentionField from './MentionField';
import PolishButton from './PolishButton';
import './SceneInput.css';

/**
 * v2.2 — 시점 칸은 단일 textarea로 통합.
 * v8 — 내부 textarea 를 <MentionField> 로 교체.
 *   - 새 props: refs, onChangeRefs, options, ariaLabel
 *   - onChangeRefs 미전달이면 noop (기존 호출부 호환).
 *   - options 가 빈 배열/undefined 면 mention 비활성, 평범 textarea처럼 동작.
 */
export default function SceneInput({
  label,
  required = false,
  optional = false,
  value,
  onChange,
  refs = [],
  onChangeRefs,
  options = [],
  placeholder,
  hint,
  ariaLabel,
}) {
  return (
    <div className="scene-input">
      <div className="scene-input__label">
        <span className="scene-input__label-text">{label}</span>
        {required && <span className="req">*</span>}
        {optional && <span className="opt">(선택)</span>}
        <PolishButton
          value={value}
          refs={refs}
          onChange={onChange}
          onChangeRefs={onChangeRefs}
          label={label}
        />
      </div>
      <MentionField
        value={value}
        refs={refs}
        onChange={onChange}
        onChangeRefs={onChangeRefs || (() => {})}
        options={options}
        placeholder={placeholder}
        rows={4}
        ariaLabel={ariaLabel || label}
        className="scene-input__textarea"
      />
      {hint && <p className="scene-input__hint muted">{hint}</p>}
    </div>
  );
}
