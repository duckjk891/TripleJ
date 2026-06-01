import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import './AdminJobsPage.css';

const STATUS_LABEL = {
  queued: '준비 중',
  generating_lyrics: '가사 만드는 중',
  lyrics_ready: '가사 준비됨',
  lyrics_failed: '가사 실패',
  generating_music: '음악 만드는 중',
  music_ready: '음악 준비됨',
  music_failed: '음악 실패',
};

const DEV = import.meta.env?.DEV;

function formatDate(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getAdminJobs()
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.jobs || [];
        setJobs(list);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        console.error('[AdminJobsPage] fetch failed', { status, err });
        // 401 은 axios 인터셉터가 localStorage 정리 → ProtectedRoute 가 /login 으로 보냄.
        // 그 외만 사용자 메시지 노출 — 빈 결과(0건) 와 구분.
        if (status === 401) {
          setError('세션이 만료되었습니다. 다시 로그인해주세요.');
        } else if (status === 403) {
          setError('관리자 권한이 없어 요청작을 볼 수 없습니다.');
        } else {
          setError('서버에서 요청작을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 사용자별 그룹핑: { user_id: { user_email, user_nickname, jobs: [...] } }
  const grouped = useMemo(() => {
    const acc = {};
    for (const job of jobs) {
      const uid = job.user_id ?? 'unknown';
      if (!acc[uid]) {
        acc[uid] = {
          user_id: uid,
          user_email: job.user_email || '',
          user_nickname: job.user_nickname || '',
          jobs: [],
        };
      }
      acc[uid].jobs.push(job);
    }
    return acc;
  }, [jobs]);

  const groups = useMemo(() => Object.values(grouped), [grouped]);

  useEffect(() => {
    if (DEV && !loading) {
      // eslint-disable-next-line no-console
      console.info('[AdminJobsPage] loaded', {
        count_users: groups.length,
        count_jobs: jobs.length,
      });
    }
  }, [loading, groups.length, jobs.length]);

  return (
    <section className="admin-jobs">
      <div className="admin-jobs__head">
        <h1 className="admin-jobs__title">요청작</h1>
        <p className="admin-jobs__desc muted">
          모든 사용자의 MV 작품을 사용자별로 묶어 보여줍니다.
        </p>
      </div>

      {loading && <p className="muted">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && groups.length === 0 && (
        <div className="card admin-jobs__empty">
          <p>아직 관리자에게 요청된 작품이 없습니다.</p>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            사용자가 자신의 작품에서 <strong>"🙋 관리자에게 요청"</strong> 버튼을 누르면 여기에 표시됩니다.
          </p>
        </div>
      )}

      <div className="admin-jobs__list">
        {groups.map((g) => (
          <div key={g.user_id} className="admin-jobs__group">
            <div className="admin-jobs__user-header">
              <span className="admin-jobs__user-nick">
                {g.user_nickname || '(닉네임 없음)'}
              </span>
              <span className="admin-jobs__user-email muted">
                · {g.user_email || '-'}
              </span>
              <span className="admin-jobs__user-count muted">
                · {g.jobs.length}개
              </span>
            </div>
            <ul className="admin-jobs__grid">
              {g.jobs.map((job) => {
                const jobId = job.job_id || job.id;
                return (
                  <li key={jobId} className="card admin-jobs__card">
                    <h2 className="admin-jobs__card-title">
                      {job.lyrics?.title || job.title || '제목 없음'}
                    </h2>
                    <p className="muted">
                      상태: {STATUS_LABEL[job.status] || job.status || '-'}
                    </p>
                    <p className="muted">
                      생성일: {formatDate(job.created_at)}
                    </p>
                    {job.admin_requested_at && (
                      <p className="admin-jobs__requested muted">
                        요청: {new Date(job.admin_requested_at).toLocaleString('ko-KR')}
                      </p>
                    )}
                    <div className="admin-jobs__card-actions">
                      <Link
                        to={`/projects/${jobId}`}
                        className="btn-ghost"
                      >
                        상세보기
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
