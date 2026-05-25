import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../api';
import './GenerationStatusPage.css';

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(['music_ready', 'music_failed', 'lyrics_failed']);

const STATUS_MESSAGE = {
  queued: '준비 중...',
  generating_lyrics: '두 분의 이야기로 가사를 만들고 있어요. 약 30초 정도 걸려요.',
  lyrics_ready: '가사가 준비됐어요. 마음에 드시면 이 가사로 음악을 만들어볼까요?',
  lyrics_failed: '가사 생성에 실패했습니다.',
  generating_music: '음악을 만들고 있어요. 약 1~3분 정도 걸려요.',
  music_ready: '음악이 준비됐어요.',
  music_failed: '음악 생성에 실패했습니다.',
};

const META_LINE_RE = /^\s*\[[^\]]+\]\s*$/;

function LyricsBody({ body }) {
  const lines = useMemo(() => (body || '').split('\n'), [body]);
  return (
    <div className="lyrics-body">
      {lines.map((line, idx) => {
        if (META_LINE_RE.test(line)) {
          return (
            <div key={idx} className="lyrics-meta">
              {line.trim()}
            </div>
          );
        }
        if (line.trim() === '') {
          return <div key={idx} className="lyrics-blank" />;
        }
        return (
          <div key={idx} className="lyrics-line">
            {line}
          </div>
        );
      })}
    </div>
  );
}

export default function GenerationStatusPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [musicTriggering, setMusicTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState('');
  const timerRef = useRef(null);
  const cancelledRef = useRef(false);
  const fetchJobRef = useRef(null);

  useEffect(() => {
    cancelledRef.current = false;

    const stopPolling = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const fetchJob = async () => {
      try {
        const { data } = await api.getMVJob(id);
        if (cancelledRef.current) return;
        setJob(data);
        setError('');
        if (TERMINAL_STATUSES.has(data?.status)) {
          stopPolling();
        }
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err?.response?.data?.detail || '잡 정보를 불러오지 못했습니다.');
        }
      }
    };

    fetchJobRef.current = fetchJob;
    fetchJob();
    timerRef.current = setInterval(fetchJob, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      stopPolling();
    };
  }, [id]);

  const status = job?.status || 'queued';
  const progress = typeof job?.progress === 'number' ? job.progress : 0;
  const message = STATUS_MESSAGE[status] || STATUS_MESSAGE.queued;
  const lyrics = job?.lyrics;

  const isLyricsReady = status === 'lyrics_ready';
  const isLyricsFailed = status === 'lyrics_failed';
  const isGeneratingMusic = status === 'generating_music';
  const isMusicReady = status === 'music_ready';
  const isMusicFailed = status === 'music_failed';

  const isWorking = status === 'generating_lyrics' || status === 'queued' || isGeneratingMusic;

  const onStartMusic = async () => {
    setTriggerError('');
    setMusicTriggering(true);
    try {
      await api.startMusicGen(id);
      // 즉시 UI를 generating_music으로 바꿔 사용자 피드백
      setJob((prev) => ({ ...(prev || {}), status: 'generating_music', progress: 0 }));
      // 폴링 인터벌 재시작 (terminal 검사로 멈췄을 수 있음)
      if (!timerRef.current && fetchJobRef.current) {
        timerRef.current = setInterval(fetchJobRef.current, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setTriggerError(err?.response?.data?.detail || '음악 생성을 시작하지 못했습니다.');
    } finally {
      setMusicTriggering(false);
    }
  };

  const downloadName = `${(lyrics?.title || 'wedding-mv').replace(/[^\w가-힣 -]/g, '')}.mp3`;
  const variantsCount = job?.audio_variants?.length || 0;

  return (
    <section className="gen-status">
      <h1 className="gen-status__title">제작 진행 상황</h1>

      <div className="card gen-status__card">
        <p className="muted gen-status__job-id">잡 ID: {id}</p>
        <p className="gen-status__message">{message}</p>

        {isWorking && (
          <>
            <div className="gen-status__bar">
              <div
                className="gen-status__bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <p className="muted gen-status__hint">5초마다 자동으로 새로고침합니다.</p>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      {isLyricsReady && lyrics && (
        <div className="card lyrics-card">
          <h2 className="lyrics-card__title">{lyrics.title || '제목 없음'}</h2>
          <LyricsBody body={lyrics.body || ''} />
          {lyrics.model && (
            <p className="lyrics-card__credit muted">by {lyrics.model}</p>
          )}
          <div className="lyrics-card__actions">
            <button
              type="button"
              className="btn-primary"
              onClick={onStartMusic}
              disabled={musicTriggering}
            >
              {musicTriggering ? '시작하는 중...' : '이 가사로 음악 만들기'}
            </button>
            <Link to="/my" className="btn-ghost">
              내 작품으로 →
            </Link>
          </div>
          {triggerError && <p className="error-text">{triggerError}</p>}
        </div>
      )}

      {(isGeneratingMusic || isMusicReady || isMusicFailed) && lyrics && (
        <div className="card lyrics-card">
          <h2 className="lyrics-card__title">{lyrics.title || '제목 없음'}</h2>
          <LyricsBody body={lyrics.body || ''} />
          {lyrics.model && (
            <p className="lyrics-card__credit muted">by {lyrics.model}</p>
          )}
        </div>
      )}

      {isMusicReady && (
        <div className="card audio-card">
          <h2 className="audio-card__title">음악</h2>
          <audio
            controls
            src={api.audioStreamUrl(id, 1)}
            className="audio-card__player"
          />
          {variantsCount > 1 && (
            <div className="audio-card__variant">
              <p className="muted">다른 버전</p>
              <audio
                controls
                src={api.audioStreamUrl(id, 2)}
                className="audio-card__player"
              />
            </div>
          )}
          <div className="audio-card__actions">
            <a
              href={api.audioStreamUrl(id, 1)}
              download={downloadName}
              className="btn-ghost"
            >
              다운로드
            </a>
            <Link to="/my" className="btn-ghost">
              내 작품으로 →
            </Link>
          </div>
        </div>
      )}

      {isMusicFailed && (
        <div className="card lyrics-card lyrics-card--error">
          <p className="lyrics-card__error-msg">
            {job?.error_message || '음악 생성에 실패했습니다.'}
          </p>
          <div className="lyrics-card__actions">
            <button
              type="button"
              className="btn-primary"
              onClick={onStartMusic}
              disabled={musicTriggering}
            >
              {musicTriggering ? '재시도 중...' : '다시 시도'}
            </button>
            <Link to="/my" className="btn-ghost">
              내 작품으로 →
            </Link>
          </div>
          {triggerError && <p className="error-text">{triggerError}</p>}
        </div>
      )}

      {isLyricsFailed && (
        <div className="card lyrics-card lyrics-card--error">
          <p className="lyrics-card__error-msg">
            {job?.error_message || '알 수 없는 오류가 발생했습니다.'}
          </p>
          <div className="lyrics-card__actions">
            <Link to="/wizard" className="btn-primary">
              다시 위저드로 →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
