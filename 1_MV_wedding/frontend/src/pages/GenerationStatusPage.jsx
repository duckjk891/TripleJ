import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import WeddingPhotoPanel from '../components/WeddingPhotoPanel';
import PreCeremonyMVPanel from '../components/PreCeremonyMVPanel';
import ExtraVideoStudioPanel from '../components/ExtraVideoStudioPanel';
import './GenerationStatusPage.css';

const TAB_PHOTO = 'photo';
const TAB_PRE_MV = 'pre_mv';
const TAB_EXTRA = 'extra';

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

// v39 — 가사 제목/본문 수동 편집. canEdit=false 면 읽기 전용 (예: generating_music 중 백엔드 409).
function LyricsCardBody({ lyrics, jobId, canEdit, onLyricsUpdated, lockReason }) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const startEdit = () => {
    setEditTitle(lyrics?.title || '');
    setEditBody(lyrics?.body || '');
    setSaveError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError('');
  };

  const onSave = async () => {
    const trimmedTitle = editTitle.trim();
    const trimmedBody = editBody.trim();
    const originalTitle = (lyrics?.title || '').trim();
    const originalBody = (lyrics?.body || '').trim();
    const titleChanged = trimmedTitle !== originalTitle;
    const bodyChanged = trimmedBody !== originalBody;

    if (!titleChanged && !bodyChanged) {
      setEditing(false);
      return;
    }
    if (titleChanged && !trimmedTitle) {
      setSaveError('제목을 입력해주세요.');
      return;
    }
    if (bodyChanged && !trimmedBody) {
      setSaveError('가사를 입력해주세요.');
      return;
    }

    const payload = {};
    if (titleChanged) payload.title = trimmedTitle;
    if (bodyChanged) payload.body = trimmedBody;

    setSaving(true);
    setSaveError('');
    try {
      const { data } = await api.patchMVJobLyrics(jobId, payload);
      onLyricsUpdated?.(data);
      setEditing(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setSaveError(typeof detail === 'string' ? detail : '저장에 실패했어요.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="lyrics-card__edit" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          maxLength={200}
          placeholder="제목"
          disabled={saving}
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: 18,
            fontWeight: 600,
            border: '1px solid #bbb',
            borderRadius: 6,
          }}
        />
        <textarea
          value={editBody}
          onChange={(e) => setEditBody(e.target.value)}
          maxLength={5000}
          rows={Math.max(10, (editBody.match(/\n/g) || []).length + 2)}
          placeholder="가사 본문 — [verse 1] / [chorus] 같은 메타 표기는 그대로 두면 자동으로 강조돼요."
          disabled={saving}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 15,
            lineHeight: 1.6,
            fontFamily: 'inherit',
            border: '1px solid #bbb',
            borderRadius: 6,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
          <button type="button" className="btn-ghost" onClick={cancelEdit} disabled={saving}>
            취소
          </button>
          <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>
            ※ 본문을 바꾸면 음악과의 타임스탬프가 어긋날 수 있어요.
          </span>
        </div>
        {saveError && <p className="error-text">{saveError}</p>}
      </div>
    );
  }

  return (
    <>
      <h2 className="lyrics-card__title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>{lyrics?.title || '제목 없음'}</span>
        {canEdit ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={startEdit}
            title="제목/가사를 직접 수정해요"
            style={{ fontSize: 13, padding: '4px 10px' }}
          >
            ✎ 제목/가사 수정
          </button>
        ) : lockReason ? (
          <span className="muted" style={{ fontSize: 12 }}>{lockReason}</span>
        ) : null}
      </h2>
      <LyricsBody body={lyrics?.body || ''} />
      {lyrics?.model && <p className="lyrics-card__credit muted">by {lyrics.model}</p>}
    </>
  );
}

export default function GenerationStatusPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [musicTriggering, setMusicTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState('');
  const [activeTab, setActiveTab] = useState(TAB_PHOTO);
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

  // v35 — [← 이전 (수정)] : 생성 중에는 비활성, 완료/실패 후 활성.
  // 클릭 시 wizard 로 돌아가 같은 job_id 를 들고 가서 [생성] 다시 누르면 regenerate.
  const canGoBackToWizard = !isWorking;
  const onGoBackToWizard = () => {
    if (!canGoBackToWizard) return;
    if (import.meta.env.DEV) {
      console.info('[GenStatus] back-to-wizard', { job_id: id, status });
    }
    navigate('/wizard', { state: { resume_job_id: id } });
  };

  // v27 — [음악 재생성] : 가사 그대로 두고 Suno 호출만 다시.
  // 백엔드가 audio_variants/timestamps 초기화 후 generating_music 으로 전환.
  const [regeneratingMusic, setRegeneratingMusic] = useState(false);
  const canRegenerateMusic = isMusicReady || isMusicFailed;
  const onRegenerateMusic = async () => {
    if (!canRegenerateMusic || regeneratingMusic) return;
    const ok = window.confirm(
      '음악을 다시 만들까요?\n현재 음악과 타임스탬프는 사라지고 새로 만들어요.\n(가사는 그대로 유지)'
    );
    if (!ok) return;
    setRegeneratingMusic(true);
    setTriggerError('');
    try {
      await api.regenerateMVJobMusic(id);
      setJob((prev) => ({
        ...(prev || {}),
        status: 'generating_music',
        progress: 0,
        audio_variants: [],
        lyric_timestamps_variants: {},
        error_message: null,
      }));
      if (!timerRef.current && fetchJobRef.current) {
        timerRef.current = setInterval(fetchJobRef.current, POLL_INTERVAL_MS);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setTriggerError(typeof detail === 'string' ? detail : '음악 재생성에 실패했어요.');
    } finally {
      setRegeneratingMusic(false);
    }
  };

  // v38 — [가사 재생성] : wizard 안 가고 현재 화면에서 즉시 regenerate.
  // job 에 이미 박혀 있는 story_id + music_spec 그대로 재사용.
  // v30 — 음악이 준비된 후(music_ready/music_failed)에도 노출. 백엔드는
  //       원래 status in ('queued','generating_*') 만 차단하므로 무리 없음.
  //       단 이 경우 음악도 같이 폐기됨을 confirm 으로 알림.
  const [regenerating, setRegenerating] = useState(false);
  const canRegenerateLyrics =
    isLyricsReady || isLyricsFailed || isMusicReady || isMusicFailed;
  const onRegenerateLyrics = async () => {
    if (!canRegenerateLyrics || regenerating) return;
    if (!job?.story_id || !job?.music_spec) {
      setTriggerError('잡 정보가 부족해서 가사를 다시 만들 수 없어요. 잠시 후 다시 시도해주세요.');
      return;
    }
    const willLoseMusic = isMusicReady || isMusicFailed;
    const message = willLoseMusic
      ? '가사를 다시 만들면 현재 음악도 사라져요.\n새 가사 준비 후 [이 가사로 음악 만들기]를 다시 눌러야 해요.\n계속할까요?'
      : '가사를 다시 생성할까요?\n현재 가사는 사라지고 새로 만들어요.';
    const ok = window.confirm(message);
    if (!ok) return;
    setRegenerating(true);
    setTriggerError('');
    try {
      await api.regenerateMVJob(id, {
        story_id: job.story_id,
        music_spec: job.music_spec,
      });
      // 즉시 UI를 generating_lyrics 로 바꿔 폴링이 새 가사 픽업
      setJob((prev) => ({ ...(prev || {}), status: 'generating_lyrics', progress: 0, lyrics: null }));
      // 폴링 보장
      if (!timerRef.current && fetchJobRef.current) {
        timerRef.current = setInterval(fetchJobRef.current, POLL_INTERVAL_MS);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setTriggerError(typeof detail === 'string' ? detail : '가사 재생성에 실패했어요.');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <section className="gen-status">
      <h1 className="gen-status__title">제작 진행 상황</h1>

      <div className="card gen-status__card">
        <p className="muted gen-status__job-id">잡 ID: {id}</p>
        <p className="gen-status__message">{message}</p>

        <div className="gen-status__nav" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={onGoBackToWizard}
            disabled={!canGoBackToWizard}
            title={
              canGoBackToWizard
                ? '이전 단계로 돌아가 수정 후 다시 생성 (이전 결과는 갈아엎혀요)'
                : '생성이 끝난 뒤에 활성화돼요'
            }
          >
            ← 이전 (수정)
          </button>
        </div>

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
          <LyricsCardBody
            lyrics={lyrics}
            jobId={id}
            canEdit={!regenerating && !musicTriggering}
            onLyricsUpdated={(updated) => setJob(updated)}
          />
          <div className="lyrics-card__actions">
            <button
              type="button"
              className="btn-primary"
              onClick={onStartMusic}
              disabled={musicTriggering || regenerating}
            >
              {musicTriggering ? '시작하는 중...' : '이 가사로 음악 만들기'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onRegenerateLyrics}
              disabled={regenerating || musicTriggering}
              title="현재 가사를 버리고 같은 이야기로 가사만 다시 만들어요"
            >
              {regenerating ? '재생성 중...' : '↻ 가사 재생성'}
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
          <LyricsCardBody
            lyrics={lyrics}
            jobId={id}
            canEdit={!isGeneratingMusic}
            lockReason={isGeneratingMusic ? '음악 생성 중에는 수정할 수 없어요.' : undefined}
            onLyricsUpdated={(updated) => setJob(updated)}
          />
        </div>
      )}

      {isMusicReady && (
        <div className="card audio-card">
          <h2 className="audio-card__title">
            음악 <span className="audio-card__variant-tag">🎵 트랙 1번</span>
          </h2>
          <audio
            controls
            src={api.audioStreamUrl(id, 1)}
            className="audio-card__player"
          />
          <LyricsTimestampToggle
            variant={1}
            segments={job?.lyric_timestamps_variants?.['1'] || []}
          />
          {variantsCount > 1 && (
            <div className="audio-card__variant">
              <p className="muted">
                다른 버전 <span className="audio-card__variant-tag">🎵 트랙 2번</span>
              </p>
              <audio
                controls
                src={api.audioStreamUrl(id, 2)}
                className="audio-card__player"
              />
              <LyricsTimestampToggle
                variant={2}
                segments={job?.lyric_timestamps_variants?.['2'] || []}
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
            <button
              type="button"
              className="btn-ghost"
              onClick={onRegenerateMusic}
              disabled={regeneratingMusic || regenerating}
              title="가사는 그대로 두고 같은 가사로 음악만 다시 만들어요"
            >
              {regeneratingMusic ? '재생성 중...' : '↻ 음악 재생성'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onRegenerateLyrics}
              disabled={regenerating || regeneratingMusic}
              title="가사부터 다시 만들어요. 현재 음악은 사라지니 새 가사 준비 후 음악을 다시 만들어야 해요."
            >
              {regenerating ? '재생성 중...' : '↻ 가사 재생성'}
            </button>
            <Link to="/my" className="btn-ghost">
              내 작품으로 →
            </Link>
          </div>
          {triggerError && <p className="error-text">{triggerError}</p>}
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
              onClick={onRegenerateMusic}
              disabled={regeneratingMusic || regenerating}
            >
              {regeneratingMusic ? '재시도 중...' : '↻ 음악만 다시 시도'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onRegenerateLyrics}
              disabled={regenerating || regeneratingMusic}
              title="가사부터 새로 만들기 (음악도 다시 만들어야 해요)"
            >
              {regenerating ? '재생성 중...' : '↻ 가사부터 다시'}
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
            <button
              type="button"
              className="btn-primary"
              onClick={onRegenerateLyrics}
              disabled={regenerating}
              title="같은 이야기로 다시 시도"
            >
              {regenerating ? '재시도 중...' : '↻ 다시 시도'}
            </button>
            <Link to="/wizard" className="btn-ghost">
              위저드로 이동
            </Link>
          </div>
          {triggerError && <p className="error-text">{triggerError}</p>}
        </div>
      )}

      {/* v13/v17.1/v23.0 — 작품 디테일 본문 탭.
          음악이 완성된 뒤 [웨딩사진] / [식전영상] / [추가영상생성] 3개 탭을 노출.
          그 이전 상태에서는 웨딩사진 패널만 노출(나머지는 음악 + timestamps 가 있어야 작업 가능).
          권한(owner OR admin)은 각 패널 내부에서 가드된다. */}
      {job && (
        <div className="gen-status__tabs-area">
          {isMusicReady ? (
            <>
              <div className="gen-status__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === TAB_PHOTO}
                  className={`gen-status__tab ${activeTab === TAB_PHOTO ? 'is-active' : ''}`}
                  onClick={() => {
                    if (import.meta.env.DEV) {
                      console.info('[GenStatus] action=tab_change', { tab: TAB_PHOTO });
                    }
                    setActiveTab(TAB_PHOTO);
                  }}
                >
                  웨딩사진
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === TAB_PRE_MV}
                  className={`gen-status__tab ${activeTab === TAB_PRE_MV ? 'is-active' : ''}`}
                  onClick={() => {
                    if (import.meta.env.DEV) {
                      console.info('[GenStatus] action=tab_change', { tab: TAB_PRE_MV });
                    }
                    setActiveTab(TAB_PRE_MV);
                  }}
                >
                  식전영상
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === TAB_EXTRA}
                  className={`gen-status__tab ${activeTab === TAB_EXTRA ? 'is-active' : ''}`}
                  onClick={() => {
                    if (import.meta.env.DEV) {
                      console.info('[GenStatus] action=tab_change', { tab: TAB_EXTRA });
                    }
                    setActiveTab(TAB_EXTRA);
                  }}
                >
                  추가영상생성
                </button>
              </div>
              {activeTab === TAB_PHOTO && (
                <WeddingPhotoPanel mvJobId={id} ownerUserId={job.user_id} />
              )}
              {activeTab === TAB_PRE_MV && (
                <PreCeremonyMVPanel
                  mvJobId={id}
                  ownerUserId={job.user_id}
                  mvJob={job}
                />
              )}
              {activeTab === TAB_EXTRA && (
                <ExtraVideoStudioPanel
                  mvJobId={id}
                  mvJob={job}
                  ownerUserId={job.user_id}
                />
              )}
            </>
          ) : (
            <WeddingPhotoPanel mvJobId={id} ownerUserId={job.user_id} />
          )}
        </div>
      )}
    </section>
  );
}

// v22 — 음악 플레이어 아래 토글 패널.
// segments 형식: [{text, start, end}, ...]
function formatTimestamp(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '--:--.--';
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function LyricsTimestampToggle({ variant, segments }) {
  const count = Array.isArray(segments) ? segments.length : 0;
  if (import.meta.env.DEV) {
    console.info('[LyricsTimestampToggle] render', { variant, count });
  }
  return (
    <details className="audio-card__lyrics-toggle">
      <summary className="audio-card__lyrics-summary">
        가사 타임스탬프 보기 <span className="audio-card__lyrics-count">({count}줄)</span>
      </summary>
      {count > 0 ? (
        <ol className="audio-card__lyrics-list">
          {segments.map((seg, i) => (
            <li key={i} className="audio-card__lyrics-line">
              <span className="audio-card__lyrics-ts">{formatTimestamp(seg?.start)}</span>
              <span className="audio-card__lyrics-text">{seg?.text || ''}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="audio-card__lyrics-empty">가사 타임스탬프가 없어요.</p>
      )}
    </details>
  );
}
