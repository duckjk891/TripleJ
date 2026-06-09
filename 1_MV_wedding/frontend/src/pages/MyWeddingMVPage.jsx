import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api';
import './MyWeddingMVPage.css';

const STATUS_LABEL = {
  queued: '준비 중',
  generating_lyrics: '가사 만드는 중',
  lyrics_ready: '가사 준비됨',
  lyrics_failed: '가사 실패',
  generating_music: '음악 만드는 중',
  music_ready: '음악 준비됨',
  music_failed: '음악 실패',
};

const STEP_LABEL = {
  1: '캐릭터·장소',
  2: '우리의 시간',
  3: '서약',
  4: '결혼식 정보',
  5: '음악·가사',
  6: '완료 직전',
};

export default function MyWeddingMVPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [draft, setDraft] = useState(null); // v33 — 백엔드 작성중 draft
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // v36 — 선택 삭제 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);

  const toggleSelected = (jobId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // v37 — draft 도 선택 삭제 대상. sentinel ID 사용 (잡은 ObjectId라 충돌 X)
  const DRAFT_SENTINEL = '__draft__';

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const list = Array.from(selectedIds);
    const ok = window.confirm(
      `선택한 ${list.length}개 작품을 삭제할까요?\n` +
        `삭제하면 작품에 묶인 장소 자산도 같이 삭제돼요.\n` +
        `삭제 후 되돌릴 수 없어요.`,
    );
    if (!ok) return;
    if (import.meta.env.DEV) {
      console.info('[MyWeddingMV] bulk delete start', { count: list.length });
    }
    setDeletingBulk(true);
    let failures = 0;
    let draftDeleted = false;
    for (const id of list) {
      try {
        if (id === DRAFT_SENTINEL) {
          await api.deleteMyDraft();
          draftDeleted = true;
        } else {
          await api.deleteMVJob(id);
        }
      } catch (err) {
        failures += 1;
        console.error('[MyWeddingMV] delete failed', { err, id });
      }
    }
    // 성공한 것 state 에서 제거 (실패한 건 그대로 유지)
    if (failures === 0) {
      setJobs((prev) => prev.filter((j) => !list.includes(j.job_id || j.id)));
      if (draftDeleted) setDraft(null);
      exitSelectMode();
    } else {
      alert(`${list.length - failures}개 삭제 성공, ${failures}개 실패. 잠시 후 다시 시도해주세요.`);
    }
    setDeletingBulk(false);
  };

  useEffect(() => {
    let cancelled = false;
    if (import.meta.env.DEV) console.info('[MyWeddingMV] calling getMVJobs + getMyDraft');
    Promise.all([
      api.getMVJobs().catch((err) => ({ __err: err })),
      api.getMyDraft().catch((err) => {
        // 404 같은 비정상은 콘솔 에러만, draft 없는 것으로 처리
        console.warn('[MyWeddingMV] getMyDraft failed', { err });
        return { data: { draft: null } };
      }),
    ])
      .then(([jobsRes, draftRes]) => {
        if (cancelled) return;
        if (jobsRes?.__err) {
          setError(
            jobsRes.__err?.response?.data?.detail ||
              '목록을 불러오지 못했습니다.',
          );
        } else {
          const jdata = jobsRes?.data;
          setJobs(Array.isArray(jdata) ? jdata : jdata?.jobs || []);
        }
        setDraft(draftRes?.data?.draft || null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // v33 — [새로 만들기] 클릭: draft 있으면 confirm. 확인 시 deleteMyDraft → /wizard?new=1
  const handleNewClick = async (e) => {
    e.preventDefault();
    if (import.meta.env.DEV) {
      console.info('[MyWeddingMV] new-button clicked', { draft_present: !!draft });
    }
    if (draft) {
      const ok = window.confirm(
        '작성 중이던 작품이 있어요.\n새로 시작하면 그건 사라져요. 계속할까요?',
      );
      if (!ok) return;
      try {
        await api.deleteMyDraft();
        setDraft(null);
      } catch (err) {
        console.error('[MyWeddingMV] deleteMyDraft failed', { err });
      }
    }
    navigate('/wizard?new=1');
  };

  const handleToggleAdminReview = async (job) => {
    const jobId = job.job_id || job.id;
    const nextState = !job.admin_requested;
    // 낙관적 업데이트
    setJobs((prev) => prev.map((j) =>
      (j.job_id || j.id) === jobId
        ? { ...j, admin_requested: nextState, admin_requested_at: nextState ? new Date().toISOString() : null }
        : j
    ));
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info('[MyWeddingMV] toggle admin review', { job_id: jobId, next_state: nextState });
    }
    try {
      const { data } = nextState
        ? await api.requestAdminReview(jobId)
        : await api.cancelAdminReview(jobId);
      // 서버 응답으로 정확 동기화
      setJobs((prev) => prev.map((j) => ((j.job_id || j.id) === jobId ? data : j)));
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || '요청에 실패했습니다.';
      console.error('[MyWeddingMV] toggle admin review failed', { err, status, detail, job_id: jobId });
      // 롤백
      setJobs((prev) => prev.map((j) =>
        (j.job_id || j.id) === jobId
          ? { ...j, admin_requested: !nextState }
          : j
      ));
      alert('관리자 요청 상태 변경에 실패했습니다.');
    }
  };

  return (
    <section className="my-mv">
      <div className="my-mv__head">
        <h1 className="my-mv__title">내 작품</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {!selectMode && (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSelectMode(true)}
                disabled={jobs.length === 0 && !draft}
                title={(jobs.length === 0 && !draft) ? '삭제할 작품이 없어요' : '여러 작품을 선택해서 삭제'}
              >
                ☐ 선택 삭제
              </button>
              <button type="button" className="btn-primary" onClick={handleNewClick}>
                새로 만들기
              </button>
            </>
          )}
          {selectMode && (
            <>
              <span className="muted" style={{ alignSelf: 'center' }}>
                {selectedIds.size}개 선택됨
              </span>
              <button
                type="button"
                className="btn-ghost"
                onClick={exitSelectMode}
                disabled={deletingBulk}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: '#d33', borderColor: '#b22' }}
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || deletingBulk}
              >
                {deletingBulk ? '삭제 중...' : '🗑 선택 삭제'}
              </button>
            </>
          )}
        </div>
      </div>

      {loading && <p className="muted">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && jobs.length === 0 && !draft && !error && (
        <div className="card my-mv__empty">
          <p>아직 만든 작품이 없습니다.</p>
          <button type="button" className="btn-primary" onClick={handleNewClick}>
            첫 작품 만들기
          </button>
        </div>
      )}

      <ul className="my-mv__grid">
        {draft && (() => {
          const draftChecked = selectedIds.has(DRAFT_SENTINEL);
          return (
            <li
              className={`card my-mv__card my-mv__card--draft${draftChecked ? ' my-mv__card--selected' : ''}`}
              style={draftChecked ? { outline: '2px solid #4a90e2' } : undefined}
            >
              {selectMode && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={draftChecked}
                    onChange={() => toggleSelected(DRAFT_SENTINEL)}
                    disabled={deletingBulk}
                  />
                  <span className="muted">선택</span>
                </label>
              )}
              <h2 className="my-mv__card-title">
                {draft.title || '제목 미정'}
                <span className="my-mv__badge my-mv__badge--draft" style={{
                  marginLeft: 8, fontSize: 12, padding: '2px 8px',
                  background: '#f5c542', color: '#000', borderRadius: 10,
                }}>
                  🟡 작성중
                </span>
              </h2>
              <p className="muted">
                단계: {STEP_LABEL[draft.step] || `Step ${draft.step}`}
                {draft.updated_at && ` · 마지막 편집 ${new Date(draft.updated_at).toLocaleString()}`}
              </p>
              <div className="my-mv__card-actions">
                <Link to="/wizard" className="btn-primary">✎ 이어서 작성</Link>
              </div>
            </li>
          );
        })()}
        {jobs.map((job) => {
          const jobId = job.job_id || job.id;
          const checked = selectedIds.has(jobId);
          return (
            <li
              key={jobId}
              className={`card my-mv__card${checked ? ' my-mv__card--selected' : ''}`}
              style={checked ? { outline: '2px solid #4a90e2' } : undefined}
            >
              {selectMode && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(jobId)}
                    disabled={deletingBulk}
                  />
                  <span className="muted">선택</span>
                </label>
              )}
              <h2 className="my-mv__card-title">{job.lyrics?.title || job.title || '제목 없음'}</h2>
              <p className="muted">상태: {STATUS_LABEL[job.status] || job.status || '-'}</p>
              <div className="my-mv__card-actions">
                <Link to={`/projects/${jobId}`} className="btn-ghost">진행 상황</Link>
                {job.status === 'music_ready' && (
                  <Link to={`/projects/${jobId}`} className="btn-primary">재생</Link>
                )}
                <button
                  type="button"
                  className={`btn-ghost my-mv__admin-toggle${job.admin_requested ? ' my-mv__admin-toggle--on' : ''}`}
                  onClick={() => handleToggleAdminReview(job)}
                  title={job.admin_requested ? '관리자 요청을 취소합니다' : '관리자에게 검토를 요청합니다'}
                >
                  {job.admin_requested ? '✓ 요청됨 · 취소' : '🙋 관리자에게 요청'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
