// v76 — 내 목소리 (보이스 클론) 섹션
// 내캐릭터 탭 안에 위치. 카드 리스트 + 신규 학습 마법사 트리거.
import { useState, useEffect, useCallback } from 'react';
import { FiMic, FiPlus, FiTrash2, FiPlay } from 'react-icons/fi';
import * as api from '../api';
import VoiceCloneWizard from './VoiceCloneWizard';
import './MyVoiceCloneSection.css';

const STATUS_BADGE = {
  validating: { label: '학습 중', color: '#7C3AED' },
  awaiting_verify: { label: '검증 대기', color: '#f59e0b' },
  generating: { label: '학습 중', color: '#7C3AED' },
  ready: { label: '사용 가능', color: '#1ed760' },
  failed: { label: '실패', color: '#EF4444' },
  expired: { label: '만료됨', color: '#b91c1c' },
};

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return '';
  }
}

export default function MyVoiceCloneSection() {
  const [clones, setClones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resumeClone, setResumeClone] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [cleaningExpired, setCleaningExpired] = useState(false);
  const [cleanupNotice, setCleanupNotice] = useState('');

  const expiredCount = clones.filter((c) => c?.status === 'expired').length;

  const fetchClones = useCallback(async () => {
    if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] fetching clones');
    setLoading(true);
    setError('');
    try {
      const { data } = await api.getVoiceClones();
      const items = data?.clones || data?.items || [];
      setClones(items);
      if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] clones loaded', { count: items.length });
    } catch (err) {
      console.error('[MyVoiceCloneSection] fetch failed', { status: err?.response?.status, message: err?.message });
      setError('목소리 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.info('[MyVoiceCloneSection] mount, fetching clones');
    fetchClones();
  }, [fetchClones]);

  // status 가 ready 가 아닌 클론은 주기적으로 폴링
  useEffect(() => {
    const inProgress = clones.some((c) =>
      ['validating', 'awaiting_verify', 'generating'].includes(c?.status)
    );
    if (!inProgress) return undefined;
    const t = setInterval(fetchClones, 8000);
    return () => clearInterval(t);
  }, [clones, fetchClones]);

  const handleDelete = async (clone) => {
    // v76.9: 백엔드 _serialize 가 _id → clone_id 로 변환. id 가 undefined 라서 confirm 도 안 떴음.
    const id = clone?.clone_id || clone?.id;
    if (!id) {
      console.warn('[MyVoiceCloneSection] delete: id missing', { clone });
      return;
    }
    if (!window.confirm(`"${clone.voice_name || clone.name || '이 목소리'}" 를 삭제하시겠습니까?`)) {
      return;
    }
    setDeletingId(id);
    try {
      await api.deleteVoiceClone(id);
      if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] deleted', { id });
      await fetchClones();
    } catch (err) {
      console.error('[MyVoiceCloneSection] delete failed', { id, status: err?.response?.status, message: err?.message });
      alert('삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCleanupExpired = async () => {
    if (expiredCount === 0) return;
    if (!window.confirm(`만료된 목소리 ${expiredCount}개를 영구 삭제하시겠습니까?`)) {
      return;
    }
    setCleaningExpired(true);
    setCleanupNotice('');
    if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] cleanupExpired calling', { expiredCount });
    try {
      const { data } = await api.cleanupExpiredVoiceClones();
      if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] cleanupExpired ok', { deleted: data?.deleted });
      await fetchClones();
      setCleanupNotice(`${data?.deleted ?? 0}개의 만료된 목소리를 삭제했습니다.`);
    } catch (err) {
      console.error('[MyVoiceCloneSection] cleanupExpired failed', { err });
      alert('삭제된 목소리 정리에 실패했습니다.');
    } finally {
      setCleaningExpired(false);
    }
  };

  const handleResumeVerify = (clone) => {
    const id = clone?.clone_id || clone?.id;
    if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] resume verify', { id });
    setResumeClone(clone);
    setWizardOpen(true);
  };

  const handleNew = () => {
    if (import.meta.env.DEV) console.info('[MyVoiceCloneSection] open new wizard');
    setResumeClone(null);
    setWizardOpen(true);
  };

  const handleWizardClose = () => {
    setWizardOpen(false);
    setResumeClone(null);
  };

  const handleWizardComplete = () => {
    setWizardOpen(false);
    setResumeClone(null);
    fetchClones();
  };

  return (
    <div className="myvc">
      <div className="myvc__header">
        <h3 className="myvc__title">
          <FiMic className="myvc__title-icon" />
          내 목소리 (보이스 클론)
        </h3>
        <div className="myvc__header-actions">
          {expiredCount > 0 && (
            <button
              type="button"
              className="myvc__btn myvc__btn--danger"
              disabled={cleaningExpired}
              onClick={handleCleanupExpired}
            >
              <FiTrash2 /> {cleaningExpired ? '정리 중...' : `삭제된 목소리 정리 (${expiredCount})`}
            </button>
          )}
          <button type="button" className="myvc__btn myvc__btn--primary" onClick={handleNew}>
            <FiPlus /> 새 목소리 학습
          </button>
        </div>
      </div>

      {error && <div className="myvc__error">{error}</div>}
      {cleanupNotice && <div className="myvc__notice">{cleanupNotice}</div>}

      {loading && clones.length === 0 ? (
        <div className="myvc__empty">목소리 목록 불러오는 중...</div>
      ) : clones.length === 0 ? (
        <div className="myvc__empty">
          아직 학습된 목소리가 없습니다. <strong>“새 목소리 학습”</strong> 으로 첫 클론을 만들어보세요.
        </div>
      ) : (
        <div className="myvc__grid">
          {clones.map((c) => {
            const id = c?.clone_id || c?.id;
            const badge = STATUS_BADGE[c?.status] || { label: c?.status || '알 수 없음', color: '#94A3B8' };
            const isAwaitingVerify = c?.status === 'awaiting_verify';
            return (
              <div key={id} className="myvc__card">
                <div className="myvc__card-head">
                  <div className="myvc__card-name" title={c.voice_name || c.name || ''}>
                    {c.voice_name || c.name || '(이름 없음)'}
                  </div>
                  <span className="myvc__badge" style={{ backgroundColor: badge.color }}>
                    {badge.label}
                  </span>
                </div>
                {c?.description && (
                  <p className="myvc__card-desc">{c.description}</p>
                )}
                <div className="myvc__card-meta">
                  <span>{formatDate(c?.created_at)}</span>
                </div>
                <div className="myvc__card-actions">
                  {isAwaitingVerify && (
                    <button
                      type="button"
                      className="myvc__btn myvc__btn--ghost"
                      onClick={() => handleResumeVerify(c)}
                    >
                      <FiPlay /> 검증 녹음 마저 하기
                    </button>
                  )}
                  <button
                    type="button"
                    className="myvc__btn myvc__btn--danger"
                    disabled={deletingId === id}
                    onClick={() => handleDelete(c)}
                  >
                    <FiTrash2 /> 삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {wizardOpen && (
        <VoiceCloneWizard
          open={wizardOpen}
          onClose={handleWizardClose}
          onComplete={handleWizardComplete}
          resumeClone={resumeClone}
        />
      )}
    </div>
  );
}
