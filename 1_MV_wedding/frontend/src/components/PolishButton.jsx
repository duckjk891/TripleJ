import { useState } from 'react';
import PolishCompareModal from './PolishCompareModal';
import './PolishButton.css';

/**
 * v9 — 텍스트 다듬기 트리거 버튼 + 모달 호스트.
 *
 * Props
 *   value         : string                  현재 본문
 *   refs          : MentionRef[]            현재 멘션 refs
 *   onChange      : (newText) => void       다듬은 본문 적용
 *   onChangeRefs  : (newRefs) => void       (옵션) refs reconcile 외부 알림
 *   label         : string                  라벨(모달 제목 표시 + 로그 prefix)
 *   disabled      : boolean                 외부 비활성화
 */
export default function PolishButton({
  value,
  refs = [],
  onChange,
  onChangeRefs,
  label,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const hasText = (value || '').trim().length > 0;
  const isDisabled = disabled || !hasText;

  const handleApply = (polished) => {
    if (import.meta.env.DEV) {
      console.info(`[PolishButton:${label}] apply`, {
        from_len: (value || '').length,
        to_len: (polished || '').length,
      });
    }
    onChange(polished);
    // refs 는 그대로 유지(텍스트 안에서 @멘션이 보존됐다면 reconcile 자동,
    // 일부 사라졌으면 reconcile 이 알아서 제거).
    // 명시적 onChangeRefs 호출은 불필요 — MentionField 의 reconcileRefs 가 처리.
  };

  const handleOpen = () => {
    if (import.meta.env.DEV) {
      console.info(`[PolishButton:${label}] open`, {
        text_len: (value || '').length,
        ref_count: refs.length,
      });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className="polish-btn"
        onClick={handleOpen}
        disabled={isDisabled}
        title={isDisabled ? '먼저 텍스트를 입력해주세요' : '텍스트 다듬기'}
      >
        ✨ 다듬기
      </button>
      <PolishCompareModal
        open={open}
        onClose={() => setOpen(false)}
        originalText={value || ''}
        refs={refs}
        label={label}
        onApply={handleApply}
      />
    </>
  );
}
