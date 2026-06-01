import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as api from '../api';
import './MVPlayerPage.css';

export default function MVPlayerPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getMVJob(id)
      .then(({ data }) => {
        if (!cancelled) setJob(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.response?.data?.detail || '잡 정보를 불러오지 못했습니다.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <section className="player">
      <h1 className="player__title">뮤직비디오 재생</h1>
      <div className="card player__stage">
        <video controls className="player__video">
          <source src="" />
          영상이 아직 준비되지 않았습니다.
        </video>
        <p className="muted">
          v1: 영상 생성 파이프라인은 아직 연결되지 않았습니다.
        </p>
      </div>
      <div className="card player__meta">
        <h2 className="player__meta-title">잡 정보</h2>
        {error && <p className="error-text">{error}</p>}
        {job ? (
          <ul className="player__meta-list">
            <li><span className="muted">잡 ID:</span> {job.job_id || id}</li>
            <li><span className="muted">상태:</span> {job.status || '-'}</li>
            <li><span className="muted">스토리 ID:</span> {job.story_id || '-'}</li>
          </ul>
        ) : (
          <p className="muted">불러오는 중...</p>
        )}
      </div>
    </section>
  );
}
