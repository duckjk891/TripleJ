import { useState, useCallback } from 'react';
import { broadcastCs } from '../api';
import './AdminBroadcastModal.css';

// 전체 발송 모달 — CS 페이지 헤더 "📢 전체 발송" 버튼으로 오픈.
// audience(전체/일반 사용자/고객) + textarea(최대 2000자) → window.confirm 최종 확인 → POST /admin/cs/broadcast.
// 로그 prefix `[AdminBroadcast]`. 메시지 text 원문은 콘솔에 출력하지 않는다(대상/길이만).

const MAX_LEN = 2000;

const AUDIENCES = [
  { value: 'all', label: '전체' },
  { value: 'users', label: '일반 사용자' },
  { value: 'customers', label: '고객' },
];

function audienceLabel(value) {
  const found = AUDIENCES.find((a) => a.value === value);
  if (!found) {
    console.warn('[AdminBroadcast] unknown audience value', { value });
    return value || '(미선택)';
  }
  return found.label;
}

export default function AdminBroadcastModal({ open, onClose, onSuccess }) {
  const [audience, setAudience] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(''); // 인라인 안내(검증/에러)

  const reset = useCallback(() => {
    setAudience('');
    setText('');
    setNotice('');
  }, []);

  const handleClose = useCallback(() => {
    if (sending) return;
    reset();
    onClose?.();
  }, [sending, reset, onClose]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    const trimmed = text.trim();
    if (!audience) {
      setNotice('발송 대상을 선택해주세요.');
      return;
    }
    if (!trimmed) {
      setNotice('메시지를 입력해주세요.');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      // maxLength 로 보통 도달 불가 — 붙여넣기 등 예상외 경로 방어
      console.warn('[AdminBroadcast] text over max length', { len: trimmed.length });
      setNotice(`메시지는 ${MAX_LEN}자 이내로 입력해주세요.`);
      return;
    }
    setNotice('');
    const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
    const confirmed = window.confirm(
      `[${audienceLabel(audience)}] 대상에게 전체 발송합니다. 되돌릴 수 없습니다.\n\n"${preview}"\n\n발송하시겠습니까?`
    );
    if (!confirmed) return;
    setSending(true);
    if (import.meta.env.DEV) console.info('[AdminBroadcast] sending', { audience, text_len: trimmed.length });
    try {
      const { data } = await broadcastCs(audience, trimmed);
      const queued = typeof data?.queued === 'number' ? data.queued : 0;
      if (typeof data?.queued !== 'number') {
        console.warn('[AdminBroadcast] queued missing in response', { keys: Object.keys(data || {}) });
      }
      if (import.meta.env.DEV) console.info('[AdminBroadcast] queued', { audience: data?.audience || audience, queued });
      alert(`${queued}명에게 발송 예약되었습니다.`);
      reset();
      onSuccess?.(data);
      onClose?.();
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AdminBroadcast] broadcastCs failed', { status, audience, text_len: trimmed.length, message: err?.message });
      if (status === 429) {
        setNotice('이미 발송 처리 중입니다(30초 후 재시도)');
      } else if (status === 403) {
        setNotice('권한이 없습니다');
      } else if (status === 400) {
        const detail = err?.response?.data?.detail || err?.response?.data?.error || err?.response?.data?.message;
        setNotice(detail || '발송 대상 또는 메시지가 올바르지 않습니다.');
      } else if (status === 503) {
        setNotice('공식 계정이 설정되지 않았습니다');
      } else {
        console.warn('[AdminBroadcast] unexpected error status', { status });
        setNotice('전체 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSending(false);
    }
  }, [sending, audience, text, reset, onSuccess, onClose]);

  if (!open) return null;

  const remaining = MAX_LEN - text.length;

  return (
    <div className="admin-broadcast__overlay" onClick={handleClose}>
      <div className="admin-broadcast" onClick={(e) => e.stopPropagation()}>
        <div className="admin-broadcast__head">
          <h3 className="admin-broadcast__title">📢 전체 발송</h3>
          <button className="admin-broadcast__close" onClick={handleClose} aria-label="닫기">×</button>
        </div>

        <div className="admin-broadcast__audience" role="radiogroup" aria-label="발송 대상">
          {AUDIENCES.map((a) => (
            <label key={a.value} className="admin-broadcast__radio">
              <input
                type="radio"
                name="admin-broadcast-audience"
                value={a.value}
                checked={audience === a.value}
                onChange={() => { setAudience(a.value); setNotice(''); }}
                disabled={sending}
              />
              <span>{a.label}</span>
            </label>
          ))}
        </div>

        <textarea
          className="admin-broadcast__text"
          placeholder="전체 발송할 메시지를 입력하세요"
          value={text}
          rows={5}
          maxLength={MAX_LEN}
          onChange={(e) => { setText(e.target.value); if (notice) setNotice(''); }}
          disabled={sending}
        />
        <p className="admin-broadcast__counter">{remaining}자 남음</p>

        {notice && <p className="admin-broadcast__notice">{notice}</p>}

        <div className="admin-broadcast__actions">
          <button className="admin-broadcast__cancel" onClick={handleClose} disabled={sending}>
            취소
          </button>
          <button className="admin-broadcast__send" onClick={handleSend} disabled={sending}>
            {sending ? '발송 중...' : '발송'}
          </button>
        </div>
      </div>
    </div>
  );
}
