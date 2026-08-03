import { useState, useEffect } from 'react';
import * as api from '../api';
import './AppealModal.css';

// v139 — 소명 제출 모달 (블라인드된 콘텐츠 소유자용, 트랙/피드 공용).
// props:
//   targetType  : 'track' | 'feed'
//   targetId    : 대상 id — my-affected 목록에서 target_id 대조로 해당 신고를 찾는다.
//   onClose     : 닫기(성공/취소 공통)
//   onSubmitted : (reportId) => void — 제출 성공 시 호출(버튼 "소명 제출됨" 전환용)
// 주의: 소명 텍스트 원문은 절대 콘솔에 출력하지 않는다(길이만 로깅).

const APPEAL_MAX = 2000;
const TYPE_LABEL = { track: '곡', feed: '피드', comment: '댓글' };
const ACTION_LABEL = {
  blind: '블라인드(비공개)',
  delete: '삭제',
  confirm_delete: '확정 삭제',
  restore: '복원',
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function AppealModal({ targetType, targetId, onClose, onSubmitted }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [report, setReport] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.getMyAffectedReports();
        if (cancelled) return;
        const items = Array.isArray(data?.reports) ? data.reports : (Array.isArray(data?.items) ? data.items : []);
        const sameType = items.filter((it) => it.target_type === targetType);
        // target_id 대조 우선 — 필드 부재(응답 축약) 시 동일 타입 1건이면 그것으로 간주
        const found =
          sameType.find((it) => String(it.target_id ?? '') === String(targetId)) ||
          (sameType.length === 1 ? sameType[0] : null);
        if (import.meta.env.DEV) {
          console.info('[AppealModal] my-affected loaded', {
            total: items.length,
            target_type: targetType,
            matched: !!found,
          });
        }
        if (!found) setLoadError('해당 콘텐츠의 신고 처리 내역을 찾을 수 없습니다.');
        else setReport(found);
      } catch (err) {
        if (cancelled) return;
        console.error('[AppealModal] my-affected load failed', {
          status: err?.response?.status,
        });
        setLoadError('신고 처리 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetType, targetId]);

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const handleSubmit = async () => {
    const body = text.trim().slice(0, APPEAL_MAX);
    if (!report || !body || busy) return;
    setBusy(true);
    setError('');
    if (import.meta.env.DEV) {
      console.info('[AppealModal] submit', {
        report_id: report.report_id,
        text_len: body.length,
      });
    }
    try {
      await api.submitAppeal(report.report_id, body);
      setDone(true);
      onSubmitted?.(report.report_id);
    } catch (err) {
      const status = err?.response?.status;
      console.error('[AppealModal] submit failed', {
        report_id: report.report_id,
        status,
      });
      if (status === 409) {
        setError('이미 소명을 제출했습니다.');
      } else if (status === 400) {
        setError('현재 상태에서는 소명을 제출할 수 없습니다.');
      } else if (status === 403) {
        setError('본인 콘텐츠에 대해서만 소명할 수 있습니다.');
      } else {
        setError('소명 제출에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  const summary = report?.target_summary || {};
  const summaryText = summary.title || summary.text || '';

  return (
    <div className="appeal-modal__overlay" onClick={handleClose}>
      <div className="appeal-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="appeal-modal__title">소명하기</h2>

        {loading ? (
          <p className="appeal-modal__info">신고 처리 내역을 불러오는 중...</p>
        ) : loadError ? (
          <>
            <p className="appeal-modal__error">{loadError}</p>
            <div className="appeal-modal__actions">
              <button type="button" className="appeal-modal__cancel-btn" onClick={handleClose}>
                닫기
              </button>
            </div>
          </>
        ) : done ? (
          <>
            <p className="appeal-modal__done">
              소명이 제출되었습니다. 확인 후 복원 또는 삭제가 결정됩니다.
            </p>
            <div className="appeal-modal__actions">
              <button type="button" className="appeal-modal__submit-btn" onClick={onClose}>
                확인
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="appeal-modal__target">
              <span className="appeal-modal__target-type">
                {TYPE_LABEL[report.target_type] || '콘텐츠'}
              </span>
              {summaryText && (
                <span className="appeal-modal__target-summary">{summaryText}</span>
              )}
              <span className="appeal-modal__target-status">
                처리: {ACTION_LABEL[report.action] || report.action || '-'}
                {report.handled_at ? ` · ${fmtDate(report.handled_at)}` : ''}
              </span>
            </div>

            {report.has_appeal ? (
              <p className="appeal-modal__info">
                이미 소명을 제출했습니다. 처리 결과를 기다려주세요.
              </p>
            ) : (
              <>
                <p className="appeal-modal__desc">
                  본인 콘텐츠가 신고로 비공개 처리된 사유에 대해 소명할 내용을 입력해주세요.
                  소명은 1회만 제출할 수 있습니다.
                </p>
                <textarea
                  className="appeal-modal__text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="소명 내용을 입력해주세요 (2000자 이내)"
                  maxLength={APPEAL_MAX}
                  rows={6}
                  disabled={busy}
                />
                <span className="appeal-modal__count">{text.length}/{APPEAL_MAX}</span>
              </>
            )}

            {error && <p className="appeal-modal__error">{error}</p>}

            <div className="appeal-modal__actions">
              <button
                type="button"
                className="appeal-modal__cancel-btn"
                onClick={handleClose}
                disabled={busy}
              >
                {report.has_appeal ? '닫기' : '취소'}
              </button>
              {!report.has_appeal && (
                <button
                  type="button"
                  className="appeal-modal__submit-btn"
                  onClick={handleSubmit}
                  disabled={busy || !text.trim()}
                >
                  {busy ? '제출 중...' : '소명 제출'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
