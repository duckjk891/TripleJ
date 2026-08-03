import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './ReportModal.css';

// v137 — 공용 신고 모달 (트랙/피드/댓글).
// props:
//   targetType : 'track' | 'feed' | 'comment'
//   targetId   : 대상 id
//   onClose    : 닫기(성공/취소 공통)
// 주의: reason_text 원문은 절대 콘솔에 출력하지 않는다(길이만 로깅).

const REASONS = [
  { code: 'portrait', label: '초상권 침해' },
  { code: 'copyright', label: '저작권 침해' },
  { code: 'sexual', label: '성적·불쾌 콘텐츠' },
  { code: 'abuse', label: '욕설·괴롭힘' },
  { code: 'other', label: '기타' },
];

const TYPE_LABEL = { track: '곡', feed: '피드', comment: '댓글' };

export default function ReportModal({ targetType, targetId, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reasonCode, setReasonCode] = useState(null);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  // 비로그인 → 로그인 유도
  if (!user) {
    return (
      <div className="report-modal__overlay" onClick={handleClose}>
        <div className="report-modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="report-modal__title">신고하기</h2>
          <p className="report-modal__login-text">신고하려면 로그인이 필요합니다.</p>
          <div className="report-modal__actions">
            <button type="button" className="report-modal__cancel-btn" onClick={handleClose}>
              취소
            </button>
            <button
              type="button"
              className="report-modal__submit-btn"
              onClick={() => navigate('/login')}
            >
              로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!reasonCode || busy) return;
    const text = reasonCode === 'other' ? reasonText.trim().slice(0, 500) : '';
    setBusy(true);
    setError('');
    if (import.meta.env.DEV) {
      console.info('[ReportModal] submit', {
        target_type: targetType,
        target_id: targetId,
        reason_code: reasonCode,
        text_len: text.length,
      });
    }
    try {
      await api.reportContent(targetType, targetId, reasonCode, text || undefined);
      setDone(true);
    } catch (err) {
      const status = err?.response?.status;
      console.error('[ReportModal] submit failed', {
        target_type: targetType,
        target_id: targetId,
        status,
      });
      if (status === 409) {
        setError('이미 신고한 콘텐츠입니다.');
      } else if (status === 400) {
        setError(err?.response?.data?.detail || err?.response?.data?.error || '신고할 수 없는 콘텐츠입니다.');
      } else {
        setError('신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  // 접수 완료 화면
  if (done) {
    return (
      <div className="report-modal__overlay" onClick={onClose}>
        <div className="report-modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="report-modal__title">신고하기</h2>
          <p className="report-modal__done-text">신고가 접수되었습니다</p>
          {/* v139 — 처리 결과 확인 경로 안내 */}
          <p className="report-modal__done-sub">
            처리 결과는 [내 정보 설정 &gt; 내 신고 내역]에서 확인하실 수 있습니다.
          </p>
          <div className="report-modal__actions">
            <button type="button" className="report-modal__submit-btn" onClick={onClose}>
              확인
            </button>
          </div>
        </div>
      </div>
    );
  }

  const submitDisabled =
    busy || !reasonCode || (reasonCode === 'other' && !reasonText.trim());

  return (
    <div className="report-modal__overlay" onClick={handleClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="report-modal__title">
          {TYPE_LABEL[targetType] || '콘텐츠'} 신고하기
        </h2>
        <p className="report-modal__desc">신고 사유를 선택해주세요.</p>
        <div className="report-modal__reasons">
          {REASONS.map((r) => (
            <label key={r.code} className="report-modal__reason">
              <input
                type="radio"
                name="report-reason"
                value={r.code}
                checked={reasonCode === r.code}
                onChange={() => setReasonCode(r.code)}
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        {reasonCode === 'other' && (
          <textarea
            className="report-modal__text"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="신고 사유를 입력해주세요 (500자 이내)"
            maxLength={500}
            rows={4}
          />
        )}
        {error && <p className="report-modal__error">{error}</p>}
        <div className="report-modal__actions">
          <button
            type="button"
            className="report-modal__cancel-btn"
            onClick={handleClose}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="report-modal__submit-btn"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {busy ? '접수 중...' : '신고하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
