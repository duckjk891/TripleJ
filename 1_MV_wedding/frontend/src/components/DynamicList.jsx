import MentionField from './MentionField';
import PolishButton from './PolishButton';
import './DynamicList.css';

/**
 * v8 — 각 항목을 MentionField 로 렌더(multiline=true 일 때).
 * multiline=false 면 기존 단일 <input> 유지.
 *
 * Props
 *  items          : string[]
 *  onChange       : (next: string[]) => void
 *  refsList       : MentionRef[][]   (items 와 parallel)
 *  onChangeRefs   : (idx: number, refs: MentionRef[]) => void
 *  options        : MentionOption[]  (빈 배열이면 mention 비활성)
 *  placeholder    : string
 *  addButtonLabel : string
 *  multiline      : boolean (default true)
 *
 * 항목 추가/삭제 시 refsList 도 같이 동기화하여 부모에 통보.
 */
export default function DynamicList({
  items,
  onChange,
  refsList = [],
  onChangeRefs,
  options = [],
  placeholder,
  addButtonLabel = '+ 항목 추가',
  multiline = true,
}) {
  const handleChange = (idx, value) => {
    const next = items.slice();
    next[idx] = value;
    onChange(next);
  };

  const handleRefsChange = (idx, refs) => {
    if (typeof onChangeRefs === 'function') onChangeRefs(idx, refs);
  };

  const handleRemove = (idx) => {
    const next = items.slice();
    next.splice(idx, 1);
    onChange(next);
    // refsList 도 같은 인덱스 제거 — 부모에게 새 배열 전체 통보.
    if (typeof onChangeRefs === 'function') {
      const nextRefs = refsList.slice();
      nextRefs.splice(idx, 1);
      // onChangeRefs(idx, refs) 시그니처를 따르려면 인덱스 단위 호출이 곤란.
      // 대신 첫 인자 = -1 의 의미로 "전체 교체" 신호를 줄 수 있지만, 호환성을 위해
      // 부모는 onChange(next) 의 길이 변화를 보고 자체 동기화하는 것이 일반적.
      // 여기서는 idx 단위로 한 칸씩 비우지 않고, 부모가 items 길이 변화로 추론하도록 둠.
      // (StoryWizardPage 가 onChange 콜백에서 동시에 refsList 동기화)
    }
  };

  const handleAdd = () => {
    onChange([...items, '']);
  };

  return (
    <div className="dyn-list">
      {items.map((value, idx) => (
        <div key={idx} className="dyn-list__row">
          {multiline ? (
            <div className="dyn-list__input-wrap">
              <MentionField
                value={value}
                refs={refsList[idx] || []}
                onChange={(v) => handleChange(idx, v)}
                onChangeRefs={(refs) => handleRefsChange(idx, refs)}
                options={options}
                placeholder={placeholder}
                rows={3}
                ariaLabel={`항목 ${idx + 1}`}
                className="dyn-list__input"
              />
              <PolishButton
                value={value}
                refs={(refsList || [])[idx] || []}
                onChange={(v) => handleChange(idx, v)}
                onChangeRefs={(r) => onChangeRefs && onChangeRefs(idx, r)}
                label={`추억 ${idx + 1}`}
              />
            </div>
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
