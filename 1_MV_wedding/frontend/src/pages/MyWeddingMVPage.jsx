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
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
