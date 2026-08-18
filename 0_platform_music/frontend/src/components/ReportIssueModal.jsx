import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiX } from 'react-icons/fi';
import * as api from '../api';
import './ReportIssueModal.css';

/**
 * ReportIssueModal — CS 오류신고 진입 (v185 — 전용 접수 + DM 대화 병행).
 * 사유 5종 + 내용(필수 1~2000자) 작성 → 제출 시:
 *  ① 공식 계정 DM 대화 생성 시도(cid 확보 — 실패해도 접수 진행: 실패 격리)
 *  ② POST /api/issues 즉시 접수(reason 코드·내용·page_url·cid, user_agent 는 서버 캡처)
 *  ③ 접수 완료 안내 → cid 있으면 프리필과 함께 DM 화면 이동(자동 전송 X), 없으면 닫기
 *
 * 로그 prefix `[ReportIssue]`. 신고 내용 원문은 콘솔에 출력하지 않는다(길이·status 만).
 *
 * props:
 *  - onClose(): 모달 닫기
 */

const MAX_TEXT_LEN = 2000;

// reason 코드 5종(백엔드 화이트리스트) — 화면 라벨은 한글
const REASONS = [
  { code: 'playback', label: '재생 오류' },
  { code: 'payment', label: '결제·별 오류' },
  { code: 'account', label: '계정 문제' },
  { code: 'auth', label: '로그인·본인인증 문제' },
  { code: 'other', label: '기타' },
];

export default function ReportIssueModal({ onClose }) {
  const navigate = useNavigate();
  const [reasonCode, setReasonCode] = useState(REASONS[0].code);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reasonLabel = REASONS.find((r) => r.code === reasonCode)?.label || '기타';

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError('문제 내용을 입력해주세요.');
      return;
    }
    if (trimmed.length > MAX_TEXT_LEN) {
      setError(`내용은 ${MAX_TEXT_LEN}자 이내로 입력해주세요.`);
      return;
    }
    setSubmitting(true);
    setError('');
    if (import.meta.env.DEV) console.info('[ReportIssue] submit', { reason: reasonCode, text_len: trimmed.length });

    // ① DM 대화 생성 시도 — 실패해도 접수는 진행(격리)
    let cid = null;
    let conversation = null;
    try {
      const { data: official } = await api.getOfficialContact();
      const officialId = official?.official_id;
      if (!officialId) throw new Error('official_id missing');
      const { data: conv } = await api.createDmConversation(officialId);
      cid = conv?.conversation_id || null;
      if (cid) {
        conversation = conv?.peer
          ? conv
          : { ...conv, peer: { id: officialId, nickname: official?.nickname || 'maidol_official' } };
        if (import.meta.env.DEV) console.info('[ReportIssue] conversation ready', { cid: String(cid).slice(0, 8) });
      }
    } catch (err) {
      // DM 실패는 접수를 막지 않는다 — 수집만
      console.error('[ReportIssue] dm channel failed (isolated)', {
        status: err?.response?.status,
        message: err?.message,
      });
    }

    // ② 전용 접수 — 이것이 실패하면 접수 실패로 처리(모달 유지)
    try {
      const pageUrl = `${window.location.pathname}${window.location.search}`;
      await api.reportIssue({
        reason: reasonCode,
        text: trimmed,
        page_url: pageUrl,
        ...(cid ? { dm_conversation_id: cid } : {}),
      });
      if (import.meta.env.DEV) console.info('[ReportIssue] issue filed', { has_dm: !!cid });
    } catch (err) {
      console.error('[ReportIssue] reportIssue failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      const detail = err?.response?.data?.error || err?.response?.data?.detail;
      setError(detail || '접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
      setSubmitting(false);
      return;
    }

    // ③ 완료 안내 + 이동/닫기
    if (cid) {
      alert('오류 신고가 접수되었습니다. 문의 대화로 이동합니다.');
      const prefill = `[오류신고: ${reasonLabel}] ${trimmed}`;
      onClose?.();
      navigate(`/dm/${cid}`, { state: { prefill, conversation } });
    } else {
      alert('오류 신고가 접수되었습니다. (문의 대화 연결은 실패했지만 접수는 완료됐어요)');
      onClose?.();
    }
  };

  return (
    <div className="report-issue__overlay" onClick={onClose}>
      <div className="report-issue" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="report-issue__head">
          <h2 className="report-issue__title">
            <FiAlertCircle /> 오류신고
          </h2>
          <button className="report-issue__close" onClick={onClose} aria-label="닫기">
            <FiX />
          </button>
        </div>

        <p className="report-issue__hint">
          어떤 문제가 있으셨나요? 내용을 작성하면 즉시 접수되고, maidol_official 문의 대화도 함께 열립니다.
        </p>

        <ul className="report-issue__reasons">
          {REASONS.map((r) => (
            <li key={r.code}>
              <label className={`report-issue__reason ${reasonCode === r.code ? 'report-issue__reason--active' : ''}`}>
                <input
                  type="radio"
                  name="report-reason"
                  value={r.code}
                  checked={reasonCode === r.code}
                  onChange={() => { setReasonCode(r.code); if (error) setError(''); }}
                />
                <span>{r.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <textarea
          className="report-issue__text"
          placeholder="어떤 상황에서 어떤 문제가 발생했는지 적어주세요 (필수)"
          value={text}
          rows={4}
          maxLength={MAX_TEXT_LEN}
          onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
          disabled={submitting}
        />
        <p className="report-issue__counter">{MAX_TEXT_LEN - text.length}자 남음</p>

        {error && <p className="report-issue__error">{error}</p>}

        <div className="report-issue__actions">
          <button className="report-issue__btn" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button
            className="report-issue__btn report-issue__btn--primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? '접수 중...' : '접수하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
