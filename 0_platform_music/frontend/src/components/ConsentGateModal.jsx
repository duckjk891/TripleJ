import { useState } from 'react';
import { CONSENTS, CONSENT_VERSION } from '../constants/consentTexts';
import { markConsentAgreed } from '../utils/consent';
import * as api from '../api';
import './ConsentGateModal.css';

// v125 — 기능 첫 사용 시점 동의 게이트 모달 (photo_ai | voice_ai).
// 문구는 constants/consentTexts.js 원본을 그대로 렌더한다(수정 금지).
// 캐시/조회 헬퍼(hasConsentCached/checkConsent)는 utils/consent.js 사용.
// props:
//   consentKey : 'photo_ai' | 'voice_ai'
//   onAgree    : 동의 기록 성공 후 호출(기능 진행)
//   onClose    : 취소/닫기(기능 중단)
// 주의: 로그에는 key 와 agreed bool 만 남긴다.

export default function ConsentGateModal({ consentKey, onAgree, onClose }) {
  const item = CONSENTS[consentKey];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!item) return null;

  const handleAgree = async () => {
    setBusy(true);
    setError('');
    try {
      await api.recordConsents([{ key: consentKey, agreed: true }], CONSENT_VERSION);
      markConsentAgreed(consentKey);
      console.info('[ConsentGate] agreed', { key: consentKey, agreed: true });
      onAgree();
    } catch (err) {
      console.error('[ConsentGate] record failed', {
        key: consentKey,
        status: err?.response?.status,
        message: err?.message,
      });
      setError('동의 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    if (import.meta.env.DEV) console.info('[ConsentGate] closed', { key: consentKey, agreed: false });
    onClose();
  };

  return (
    <div className="consent-gate__overlay" onClick={handleClose}>
      <div className="consent-gate__modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="consent-gate__title">{item.label}</h2>
        <div className="consent-gate__body">{item.body}</div>
        {error && <p className="consent-gate__error">{error}</p>}
        <div className="consent-gate__actions">
          <button
            type="button"
            className="consent-gate__cancel-btn"
            onClick={handleClose}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="consent-gate__agree-btn"
            onClick={handleAgree}
            disabled={busy}
          >
            {busy ? '처리 중...' : '동의하고 계속'}
          </button>
        </div>
      </div>
    </div>
  );
}
