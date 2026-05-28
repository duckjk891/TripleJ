import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import './PolishCompareModal.css';

/**
 * v9 — 텍스트 다듬기 비교 모달.
 *
 * Props
 *   open          : boolean
 *   onClose       : () => void
 *   originalText  : string
 *   refs          : MentionRef[]
 *   label         : string
 *   defaultModel  : "claude_4_7_opus" | "gpt_latest" (default: claude_4_7_opus)
 *   onApply       : (polishedText: string) => void
 *
 * 단계(phase): idle → loading → result | error
 */
export default function PolishCompareModal({
  open,
  onClose,
  originalText,
  refs = [],
  label,
  defaultModel = 'claude_4_7_opus',
  onApply,
}) {
  const [phase, setPhase] = useState('idle');
  const [model, setModel] = useState(defaultModel || 'claude_4_7_opus');
  const [polishedText, setPolishedText] = useState('');
  const [refsPreserved, setRefsPreserved] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  // loading 단계 tick 용
  const tickStartRef = useRef(0);

  // 모달이 닫혔다 다시 열릴 때 상태 초기화
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setModel(defaultModel || 'claude_4_7_opus');
      setPolishedText('');
      setRefsPreserved(true);
      setElapsedMs(0);
      setErrorMessage('');
    }
  }, [open, defaultModel]);

  // Esc 닫기
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // phase=loading 동안 1초 tick 으로 경과초 갱신(렌더용)
  useEffect(() => {
    if (phase !== 'loading') return undefined;
    tickStartRef.current = Date.now();
    const id = setInterval(() => {
      setElapsedMs(Date.now() - tickStartRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (!open) return null;

  const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));

  const startPolish = async () => {
    setPhase('loading');
    setElapsedMs(0);
    if (import.meta.env.DEV) {
      console.info('[PolishModal] calling polishStoryText', {
        model,
        text_len: (originalText || '').length,
        ref_count: refs.length,
      });
    }
    const started = Date.now();
    try {
      const { data } = await api.polishStoryText({
        text: originalText,
        refs,
        model,
        label,
      });
      setPolishedText(data.polished_text || '');
      setRefsPreserved(!!data.refs_preserved);
      setElapsedMs(data.elapsed_ms || (Date.now() - started));
      setPhase('result');
      if (import.meta.env.DEV) {
        console.info('[PolishModal] result', {
          model_used: data.model_used,
          elapsed_ms: data.elapsed_ms,
          refs_preserved: data.refs_preserved,
          polished_len: (data.polished_text || '').length,
        });
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail || err?.message || '다듬기에 실패했습니다.';
      console.error('[PolishModal] polish failed', { err, status, detail, model });
      setErrorMessage(
        typeof detail === 'string' ? detail : '다듬기에 실패했습니다.'
      );
      setPhase('error');
    }
  };

  return (
    <>
      <div
        className="polish-modal__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="polish-modal__card"
        role="dialog"
        aria-modal="true"
        aria-label={`텍스트 다듬기 — ${label}`}
      >
        <div className="polish-modal__head">
          <h3>✨ 텍스트 다듬기 — {label}</h3>
          <button
            type="button"
            className="polish-modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="polish-modal__body">
          {phase === 'idle' && (
            <>
              <div className="polish-modal__models">
                <label>
                  <input
                    type="radio"
                    name="polish-model"
                    checked={model === 'claude_4_7_opus'}
                    onChange={() => setModel('claude_4_7_opus')}
                  />
                  Claude 4.7 Opus
                </label>
                <label>
                  <input
                    type="radio"
                    name="polish-model"
                    checked={model === 'gpt_latest'}
                    onChange={() => setModel('gpt_latest')}
                  />
                  ChatGPT 최신
                </label>
              </div>
              <div className="polish-modal__preview-label muted">원본</div>
              <div className="polish-modal__preview">{originalText}</div>
              <div className="polish-modal__actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startPolish}
                >
                  다듬기 시작
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={onClose}
                >
                  취소
                </button>
              </div>
            </>
          )}

          {phase === 'loading' && (
            <div className="polish-modal__loading">
              <div className="spinner" />
              <p>
                다듬는 중... {elapsedSec}초 경과 — Claude/GPT 가 응답하는 데
                5~30초 정도 걸립니다.
              </p>
            </div>
          )}

          {phase === 'result' && (
            <>
              <div className="polish-modal__compare">
                <div className="polish-col">
                  <h4>원본</h4>
                  <div className="polish-text">{originalText}</div>
                </div>
                <div className="polish-col">
                  <h4>다듬은 글</h4>
                  <div className="polish-text polish-text--new">
                    {polishedText}
                  </div>
                </div>
              </div>
              {!refsPreserved && (
                <div className="polish-modal__warn" role="alert">
                  ⚠ 일부 멘션(@…)이 사라졌어요. 적용 시 멘션 일부가 깨질 수
                  있습니다. 다시 다듬기를 권장합니다.
                </div>
              )}
              <p className="polish-modal__meta muted">
                {elapsedMs}ms · {model}
              </p>
              <div className="polish-modal__actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onApply(polishedText);
                    onClose();
                  }}
                  disabled={!polishedText}
                >
                  적용하기
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setPhase('idle')}
                >
                  다시 다듬기
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={onClose}
                >
                  취소
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="polish-modal__error" role="alert">
                {errorMessage || '다듬기에 실패했습니다.'}
              </div>
              <div className="polish-modal__actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startPolish}
                >
                  다시 시도
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={onClose}
                >
                  취소
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
