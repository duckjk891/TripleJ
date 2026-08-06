import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiX } from 'react-icons/fi';
import * as api from '../api';
import './ReportIssueModal.css';

/**
 * ReportIssueModal — CS 오류신고 진입.
 * 사유 선택 → "다음" → 공식 계정(maidol_official)과 DM 대화를 열고,
 * "[오류신고: {사유}] " 프리필 텍스트를 입력창에 채운 상태로 DM 화면으로 이동한다.
 * (자동 전송하지 않음 — 사용자가 상세 내용을 이어 작성 후 직접 전송)
 *
 * 로그 prefix `[ReportIssue]`. 사용자에게 보여줄 메시지와 콘솔 로그는 분리한다.
 * 상세 로그는 DEV 가드, console.error 는 상시(remoteLogger 경유 백엔드 전송).
 *
 * props:
 *  - onClose(): 모달 닫기
 */

const REASONS = [
  '재생 오류',
  '결제·별 오류',
  '계정 문제',
  '로그인·본인인증 문제',
  '기타',
];

export default function ReportIssueModal({ onClose }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState(REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleNext = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    if (import.meta.env.DEV) console.info('[ReportIssue] next click', { reason });
    try {
      // (a) 공식 계정(maidol_official) 연락처 조회
      const { data: official } = await api.getOfficialContact();
      const officialId = official?.official_id;
      if (!officialId) throw new Error('official_id missing');
      if (import.meta.env.DEV) console.info('[ReportIssue] official contact loaded');

      // (b) 공식 계정과 DM 대화 생성(기존 반환 포함)
      const { data: conv } = await api.createDmConversation(officialId);
      const cid = conv?.conversation_id;
      if (!cid) throw new Error('conversation_id missing');
      if (import.meta.env.DEV) console.info('[ReportIssue] conversation ready', { cid: String(cid).slice(0, 8) });

      // (c) 프리필 텍스트를 채운 상태로 DM 화면으로 이동(자동 전송 X)
      const prefill = `[오류신고: ${reason}] `;
      // 콜드 진입 시 대화 목록에 없어 렌더가 지연되지 않도록 conversation 객체를 함께 전달.
      // peer 가 없으면 공식 계정 정보로 최소 형태를 구성한다.
      const conversation = conv?.peer
        ? conv
        : { ...conv, peer: { id: officialId, nickname: official?.nickname || 'maidol_official' } };
      onClose?.();
      navigate(`/dm/${cid}`, { state: { prefill, conversation } });
    } catch (err) {
      console.error('[ReportIssue] start failed', {
        status: err?.response?.status,
        message: err?.message,
      });
      const detail = err?.response?.data?.error || err?.response?.data?.detail;
      setError(detail || '문의 채널을 여는 데 실패했습니다. 잠시 후 다시 시도해주세요.');
      setSubmitting(false);
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
          어떤 문제가 있으셨나요? 사유를 선택하면 maidol_official 과의 문의 대화가 열립니다.
        </p>

        <ul className="report-issue__reasons">
          {REASONS.map((r) => (
            <li key={r}>
              <label className={`report-issue__reason ${reason === r ? 'report-issue__reason--active' : ''}`}>
                <input
                  type="radio"
                  name="report-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                <span>{r}</span>
              </label>
            </li>
          ))}
        </ul>

        {error && <p className="report-issue__error">{error}</p>}

        <div className="report-issue__actions">
          <button className="report-issue__btn" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button
            className="report-issue__btn report-issue__btn--primary"
            onClick={handleNext}
            disabled={submitting}
          >
            {submitting ? '여는 중...' : '다음'}
          </button>
        </div>
      </div>
    </div>
  );
}
