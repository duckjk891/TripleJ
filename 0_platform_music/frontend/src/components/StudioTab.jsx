import { useState, useEffect, useRef } from 'react';
import { FiZap, FiClock, FiTrash2, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import * as api from '../api';
import StudioGame from './studio/StudioGame';
import './StudioTab.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', 'Jazz', 'Classical', 'Pop', 'K-Pop'];
const MOODS = ['Chill', 'Energetic', 'Dark', 'Happy', 'Sad', 'Epic', 'Romantic', 'Dreamy', 'Aggressive', 'Peaceful'];
const STYLES = ['Vocal', 'Instrumental', 'Beat', 'BGM', 'OST', 'Remix'];
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DURATIONS = [
  { value: 15, label: '15초' },
  { value: 30, label: '30초' },
  { value: 60, label: '1분' },
  { value: 120, label: '2분' },
  { value: 180, label: '3분' },
];

const PHASE_LABELS = {
  idle: '대기 중',
  greeting: '팀 소집 중...',
  analyze: '의뢰 분석 중...',
  working: '작업 중...',
  review: '리뷰 중...',
  complete: '완성!',
};

export default function StudioTab() {
  const gameRef = useRef(null);
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [style, setStyle] = useState('');
  const [duration, setDuration] = useState(30);
  const [bpm, setBpm] = useState('');
  const [musicalKey, setMusicalKey] = useState('');
  const [instruments, setInstruments] = useState('');
  const [referenceStyle, setReferenceStyle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [gamePhase, setGamePhase] = useState('idle');

  const [generations, setGenerations] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data } = await api.getGenerations({ limit: 50 });
      setGenerations(data.generations || []);
    } catch (err) {
      console.error('Failed to fetch generations:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!prompt.trim()) {
      setError('어떤 음악을 만들고 싶은지 설명해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        prompt: prompt.trim(),
        genre: genre || null,
        mood: mood || null,
        style: style || null,
        duration,
        bpm: bpm ? parseInt(bpm) : null,
        key: musicalKey || null,
        instruments: instruments.trim() || null,
        reference_style: referenceStyle.trim() || null,
        lyrics: lyrics.trim() || null,
      };

      await api.createGeneration(body);

      // Trigger the game animation
      if (gameRef.current) {
        gameRef.current.startGeneration({
          prompt: prompt.trim(),
          genre,
          mood,
          style,
          duration,
        });
      }

      setSuccessMsg('AI 팀이 음악 작업을 시작합니다!');
      setPrompt('');
      setGenre('');
      setMood('');
      setStyle('');
      setDuration(30);
      setBpm('');
      setMusicalKey('');
      setInstruments('');
      setReferenceStyle('');
      setLyrics('');
      fetchHistory();
    } catch (err) {
      // v139 — 스트라이크 생성 제한 403 공통 처리
      if (api.isGenerationRestricted(err)) api.alertGenerationRestricted(err);
      else setError(err.response?.data?.error || '요청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 생성 기록을 삭제하시겠습니까?')) return;
    setDeleting(id);
    try {
      await api.deleteGeneration(id);
      setGenerations((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  const statusLabel = (status) => {
    switch (status) {
      case 'pending': return '대기 중';
      case 'processing': return '생성 중';
      case 'completed': return '완료';
      case 'failed': return '실패';
      default: return status;
    }
  };

  return (
    <div className="studio">
      {/* AI Studio Game */}
      <div className="studio__game-section">
        <div className="studio__game-header">
          <h3 className="studio__game-title">AI 작업실</h3>
          <span className={`studio__phase-badge studio__phase-badge--${gamePhase}`}>
            {PHASE_LABELS[gamePhase] || gamePhase}
          </span>
        </div>
        <div className="studio__game-info">
          <span className="studio__agent-tag">🎹 하모니 <small>작곡</small></span>
          <span className="studio__agent-tag">✍️ 리릭 <small>작사</small></span>
          <span className="studio__agent-tag">🎛️ 비트 <small>프로듀서</small></span>
        </div>
        <StudioGame ref={gameRef} onPhaseChange={setGamePhase} />
      </div>

      {/* Prompt Section */}
      <form className="studio__form" onSubmit={handleSubmit}>
        <div className="studio__prompt-section">
          <label className="studio__label studio__label--main">
            <FiZap className="studio__label-icon" />
            어떤 음악을 만들고 싶나요?
          </label>
          <textarea
            className="studio__prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="예: 새벽 감성의 lo-fi 비트, 부드러운 피아노와 빗소리가 어우러진 차분한 분위기의 음악을 만들어줘"
            rows={3}
          />
        </div>

        {/* Quick Options */}
        <div className="studio__quick-options">
          <div className="studio__field">
            <label className="studio__label">장르</label>
            <div className="studio__chips">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`studio__chip ${genre === g ? 'studio__chip--active' : ''}`}
                  onClick={() => setGenre(genre === g ? '' : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="studio__field">
            <label className="studio__label">분위기</label>
            <div className="studio__chips">
              {MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`studio__chip ${mood === m ? 'studio__chip--active' : ''}`}
                  onClick={() => setMood(mood === m ? '' : m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="studio__field">
            <label className="studio__label">스타일</label>
            <div className="studio__chips">
              {STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`studio__chip ${style === s ? 'studio__chip--active' : ''}`}
                  onClick={() => setStyle(style === s ? '' : s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="studio__field">
            <label className="studio__label">길이</label>
            <div className="studio__chips">
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`studio__chip ${duration === d.value ? 'studio__chip--active' : ''}`}
                  onClick={() => setDuration(d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced Toggle */}
        <button
          type="button"
          className="studio__advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          세부 설정 {showAdvanced ? <FiChevronUp /> : <FiChevronDown />}
        </button>

        {showAdvanced && (
          <div className="studio__advanced">
            <div className="studio__advanced-row">
              <div className="studio__field studio__field--half">
                <label className="studio__label">BPM</label>
                <input
                  className="studio__input"
                  type="number"
                  min="40"
                  max="240"
                  value={bpm}
                  onChange={(e) => setBpm(e.target.value)}
                  placeholder="60~180"
                />
              </div>
              <div className="studio__field studio__field--half">
                <label className="studio__label">키 (Key)</label>
                <select
                  className="studio__select"
                  value={musicalKey}
                  onChange={(e) => setMusicalKey(e.target.value)}
                >
                  <option value="">자동</option>
                  {KEYS.map((k) => (
                    <option key={k} value={k}>{k} Major / {k} Minor</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="studio__field">
              <label className="studio__label">악기 (쉼표로 구분)</label>
              <input
                className="studio__input"
                type="text"
                value={instruments}
                onChange={(e) => setInstruments(e.target.value)}
                placeholder="예: 피아노, 어쿠스틱 기타, 드럼"
              />
            </div>

            <div className="studio__field">
              <label className="studio__label">참고 스타일</label>
              <input
                className="studio__input"
                type="text"
                value={referenceStyle}
                onChange={(e) => setReferenceStyle(e.target.value)}
                placeholder="예: BTS 스타일, 지브리 OST 느낌"
              />
            </div>

            <div className="studio__field">
              <label className="studio__label">가사 (선택)</label>
              <textarea
                className="studio__textarea"
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="가사가 있는 음악을 원하면 입력해주세요"
                rows={3}
              />
            </div>
          </div>
        )}

        {error && <div className="studio__error">{error}</div>}
        {successMsg && <div className="studio__success">{successMsg}</div>}

        <button
          className="studio__submit"
          type="submit"
          disabled={submitting || (gamePhase !== 'idle' && gamePhase !== 'complete')}
        >
          <FiZap />
          {submitting
            ? 'AI 팀에 전달 중...'
            : gamePhase !== 'idle' && gamePhase !== 'complete'
              ? 'AI 팀이 작업 중입니다...'
              : 'AI 팀에게 의뢰하기'}
        </button>
      </form>

      {/* Generation History */}
      <div className="studio__history">
        <h3 className="studio__history-title">
          <FiClock /> 생성 기록
        </h3>

        {loadingHistory ? (
          <div className="studio__history-loading">로딩 중...</div>
        ) : generations.length === 0 ? (
          <div className="studio__history-empty">
            아직 생성 기록이 없습니다. AI 팀에게 첫 음악을 의뢰해보세요!
          </div>
        ) : (
          <div className="studio__history-list">
            {generations.map((gen) => (
              <div key={gen.id} className="studio__gen-card">
                <div className="studio__gen-top">
                  <div className="studio__gen-prompt">{gen.prompt}</div>
                  <span className={`studio__gen-status studio__gen-status--${gen.status}`}>
                    {statusLabel(gen.status)}
                  </span>
                </div>
                <div className="studio__gen-meta">
                  {gen.genre && <span className="studio__gen-tag">{gen.genre}</span>}
                  {gen.mood && <span className="studio__gen-tag">{gen.mood}</span>}
                  {gen.style && <span className="studio__gen-tag">{gen.style}</span>}
                  {gen.duration && <span className="studio__gen-tag">{gen.duration}초</span>}
                </div>
                <div className="studio__gen-bottom">
                  <span className="studio__gen-date">{formatDate(gen.created_at)}</span>
                  <button
                    className="studio__gen-delete"
                    onClick={() => handleDelete(gen.id)}
                    disabled={deleting === gen.id}
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
