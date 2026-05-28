import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

export default function MyWeddingMVPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getMVJobs()
      .then(({ data }) => {
        if (!cancelled) {
          setJobs(Array.isArray(data) ? data : data?.jobs || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.response?.data?.detail || '목록을 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <Link to="/wizard" className="btn-primary">새로 만들기</Link>
      </div>

      {loading && <p className="muted">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && jobs.length === 0 && !error && (
        <div className="card my-mv__empty">
          <p>아직 만든 작품이 없습니다.</p>
          <Link to="/wizard" className="btn-primary">첫 작품 만들기</Link>
        </div>
      )}

      <ul className="my-mv__grid">
        {jobs.map((job) => {
          const jobId = job.job_id || job.id;
          return (
            <li key={jobId} className="card my-mv__card">
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
