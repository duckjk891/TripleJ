import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiZap, FiMusic, FiMic, FiChevronDown, FiChevronUp,
  FiClock, FiTrash2, FiRefreshCw, FiEdit3, FiSliders,
  FiCheck, FiArrowLeft, FiArrowRight, FiLoader,
  FiToggleLeft, FiToggleRight, FiPlay, FiPause, FiDownload,
  FiUploadCloud,
} from 'react-icons/fi';
import * as api from '../api';
import './StudioTab2.css';

const GENRE_PRESETS = [
  'Pop', 'K-Pop', 'Hip-hop', 'R&B', 'Rock', 'Electronic',
  'Lo-fi', 'Jazz', 'Classical', 'Ambient', 'Cinematic',
  '발라드', '댄스', '인디', 'Folk', 'Reggae', 'Metal', 'Soul',
];

const MOOD_PRESETS = [
  'Energetic', 'Chill', 'Dark', 'Happy', 'Sad', 'Epic',
  'Romantic', 'Dreamy', 'Aggressive', 'Peaceful', 'Nostalgic', 'Funky',
];

const VOCAL_PRESETS = [
  { value: '', label: '자동 선택' },
  { value: 'male_warm', label: '남성 - 따뜻한' },
  { value: 'male_powerful', label: '남성 - 파워풀' },
  { value: 'male_soft', label: '남성 - 부드러운' },
  { value: 'female_sweet', label: '여성 - 감미로운' },
  { value: 'female_powerful', label: '여성 - 파워풀' },
  { value: 'female_husky', label: '여성 - 허스키' },
];

const MODEL_OPTIONS = [
  { id: 'yue', name: 'YuE', desc: '오픈소스 음악 생성 AI (보컬 + 반주)' },
  { id: 'suno', name: 'Suno', desc: 'AI 음악 생성 서비스 (고품질 보컬 + 반주)' },
];

const STRUCTURE_TAGS = ['[Verse]', '[Chorus]', '[Bridge]', '[Outro]', '[Intro]', '[Pre-Chorus]', '[Instrumental]'];

export default function StudioTab2({ onSendToUpload }) {
  // ─── Mode: 'simple' or 'custom' ───
  const [mode, setMode] = useState('custom');
  const [selectedModel, setSelectedModel] = useState('yue');

  // ─── Step state: 1=prompt, 2=lyrics confirm, 3=generate music ───
  const [step, setStep] = useState(1);

  // Simple mode
  const [simplePrompt, setSimplePrompt] = useState('');
  const [simpleSubmitting, setSimpleSubmitting] = useState(false);

  // Step 1: Prompt
  const [description, setDescription] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedMoods, setSelectedMoods] = useState([]);

  // Step 2: Lyrics (from ChatGPT)
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [generatingLyrics, setGeneratingLyrics] = useState(false);

  // Step 3: Music settings
  const [styleText, setStyleText] = useState('');
  const [vocal, setVocal] = useState('');
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [bpm, setBpm] = useState('');
  const [musicalKey, setMusicalKey] = useState('');
  const [duration, setDuration] = useState(60);
  const [referenceText, setReferenceText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // General state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // History
  const [generations, setGenerations] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleting, setDeleting] = useState(null);

  // Audio playback for generated music
  const [playingId, setPlayingId] = useState(null);
  const genAudioRef = useRef(null);

  // Polling for active generations
  const pollRef = useRef(null);
  const lyricsRef = useRef(null);

  useEffect(() => {
    fetchHistory();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Poll for processing generations
  useEffect(() => {
    const hasProcessing = generations.some((g) => g.status === 'processing' || g.status === 'pending');
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(fetchHistory, 10000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [generations]);

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

  const toggleGenre = (g) => {
    setSelectedGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  const toggleMood = (m) => {
    setSelectedMoods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  };

  const insertTag = (tag) => {
    const ta = lyricsRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = lyrics.substring(0, start);
    const after = lyrics.substring(end);
    setLyrics(before + tag + '\n' + after);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + tag.length + 1;
    }, 0);
  };

  // ─── Step 1 → 2: Generate Lyrics ───
  const handleGenerateLyrics = async () => {
    setError('');
    if (!description.trim()) {
      setError('어떤 음악을 만들고 싶은지 설명해주세요.');
      return;
    }

    setGeneratingLyrics(true);
    try {
      const { data } = await api.generateLyrics({
        prompt: description.trim(),
        genre: selectedGenres.join(', ') || null,
        mood: selectedMoods.join(', ') || null,
        language: 'ko',
      });
      setTitle(data.title || '');
      setLyrics(data.lyrics || '');
      setStep(2);
    } catch (err) {
      const msg = err.response?.data?.error || '가사 생성에 실패했습니다.';
      setError(msg);
    } finally {
      setGeneratingLyrics(false);
    }
  };

  // ─── Step 2 → 3: Confirm Lyrics ───
  const handleConfirmLyrics = () => {
    if (!lyrics.trim()) {
      setError('가사를 입력해주세요.');
      return;
    }
    setError('');
    setStep(3);
  };

  // ─── Step 3: Generate Music ───
  const handleGenerateMusic = async () => {
    setError('');
    setSuccessMsg('');
    setSubmitting(true);

    try {
      const body = {
        prompt: description.trim(),
        title: title.trim() || null,
        lyrics: lyrics.trim(),
        genre: selectedGenres.join(', ') || null,
        mood: selectedMoods.join(', ') || null,
        style: styleText.trim() || null,
        vocal: isInstrumental ? 'instrumental' : vocal || null,
        duration,
        bpm: bpm ? parseInt(bpm) : null,
        key: musicalKey || null,
        reference_style: referenceText.trim() || null,
        start_music_gen: true,
        model: selectedModel,
      };

      await api.createGeneration(body);
      setSuccessMsg('음악 생성이 시작되었습니다! 완료까지 시간이 소요됩니다.');

      // Reset
      setStep(1);
      setDescription('');
      setTitle('');
      setLyrics('');
      setSelectedGenres([]);
      setSelectedMoods([]);
      setStyleText('');
      setVocal('');
      setIsInstrumental(false);
      setBpm('');
      setMusicalKey('');
      setReferenceText('');
      fetchHistory();
    } catch (err) {
      setError(err.response?.data?.error || '요청에 실패했습니다.');
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

  const handleRetry = async (id) => {
    try {
      await api.startMusicGeneration(id);
      fetchHistory();
    } catch (err) {
      alert(err.response?.data?.error || '재시도에 실패했습니다.');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  // ─── Simple Mode: One-click generation ───
  const handleSimpleGenerate = async () => {
    setError('');
    setSuccessMsg('');
    if (!simplePrompt.trim()) {
      setError('어떤 음악을 만들고 싶은지 설명해주세요.');
      return;
    }

    setSimpleSubmitting(true);
    try {
      // Step 1: Generate lyrics via ChatGPT
      const { data: lyricsData } = await api.generateLyrics({
        prompt: simplePrompt.trim(),
        language: 'ko',
      });

      // Step 2: Submit music generation with lyrics
      await api.createGeneration({
        prompt: simplePrompt.trim(),
        title: lyricsData.title || null,
        lyrics: lyricsData.lyrics || '',
        start_music_gen: true,
        duration: 30,
        model: selectedModel,
      });

      setSuccessMsg('가사가 자동 생성되었고, 음악 생성이 시작되었습니다!');
      setSimplePrompt('');
      fetchHistory();
    } catch (err) {
      setError(err.response?.data?.error || '생성에 실패했습니다.');
    } finally {
      setSimpleSubmitting(false);
    }
  };

  // ─── Build stream URL (proxied through backend) ───
  const getStreamUrl = (genId) => {
    const token = localStorage.getItem('token');
    const base = `${window.location.protocol}//${window.location.hostname}:9000`;
    return `${base}/api/generate/${genId}/stream/?token=${encodeURIComponent(token)}`;
  };

  // ─── Play generated audio ───
  const handlePlayGeneration = (genId) => {
    // If already playing this one, pause it
    if (playingId === genId && genAudioRef.current) {
      genAudioRef.current.pause();
      setPlayingId(null);
      return;
    }

    // Stop previous audio
    if (genAudioRef.current) {
      genAudioRef.current.pause();
    }

    const audio = new Audio(getStreamUrl(genId));
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => { setPlayingId(null); alert('오디오 재생에 실패했습니다.'); };
    genAudioRef.current = audio;
    setPlayingId(genId);
    audio.play();
  };

  // ─── Download generated audio ───
  const handleDownloadGeneration = (genId) => {
    // Direct browser navigation - backend streams the file with Content-Disposition: attachment
    window.location.href = getStreamUrl(genId);
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (genAudioRef.current) {
        genAudioRef.current.pause();
        genAudioRef.current = null;
      }
    };
  }, []);

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
    <div className="s2">
      {/* ─── Mode Toggle ─── */}
      <div className="s2__mode-bar">
        <button
          className={`s2__mode-btn ${mode === 'simple' ? 's2__mode-btn--active' : ''}`}
          onClick={() => setMode('simple')}
        >
          <FiZap /> 간편 모드
        </button>
        <button
          className={`s2__mode-btn ${mode === 'custom' ? 's2__mode-btn--active' : ''}`}
          onClick={() => setMode('custom')}
        >
          <FiSliders /> 커스텀 모드
        </button>
      </div>

      {/* ─── Simple Mode ─── */}
      {mode === 'simple' && (
        <div className="s2__form">
          <div className="s2__section">
            <label className="s2__label">AI 모델</label>
            <div className="s2__model-cards">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`s2__model-card ${selectedModel === m.id ? 's2__model-card--active' : ''}`}
                  onClick={() => setSelectedModel(m.id)}
                >
                  <span className="s2__model-name">{m.name}</span>
                  <span className="s2__model-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="s2__section">
            <label className="s2__main-label">
              <FiZap className="s2__label-icon" />
              어떤 음악을 만들고 싶나요?
            </label>
            <textarea
              className="s2__textarea s2__textarea--large"
              value={simplePrompt}
              onChange={(e) => setSimplePrompt(e.target.value)}
              placeholder="예: 비 오는 새벽 감성의 재즈 발라드, 여름밤 드라이브에 어울리는 시티팝"
              rows={4}
              maxLength={1000}
            />
            <div className="s2__char-count">{simplePrompt.length} / 1,000</div>
          </div>

          {error && <div className="s2__msg s2__msg--error">{error}</div>}
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          <button
            className="s2__submit"
            onClick={handleSimpleGenerate}
            disabled={simpleSubmitting}
          >
            {simpleSubmitting ? (
              <><FiLoader className="s2__spin" /> AI가 가사를 쓰고 음악을 생성하고 있습니다...</>
            ) : (
              <><FiMusic /> 음악 생성하기</>
            )}
          </button>
          <div className="s2__note">
            {selectedModel === 'suno'
              ? 'ChatGPT가 가사를 자동 생성하고, Suno AI가 음악을 만듭니다.'
              : 'ChatGPT가 가사를 자동 생성하고, YuE AI가 음악을 만듭니다.'}
          </div>
        </div>
      )}

      {/* ─── Custom Mode ─── */}
      {mode === 'custom' && (<>
      <div className="s2__steps">
        <div className={`s2__step ${step >= 1 ? 's2__step--active' : ''} ${step > 1 ? 's2__step--done' : ''}`}>
          <span className="s2__step-num">1</span>
          <span className="s2__step-label">프롬프트 입력</span>
        </div>
        <div className="s2__step-line" />
        <div className={`s2__step ${step >= 2 ? 's2__step--active' : ''} ${step > 2 ? 's2__step--done' : ''}`}>
          <span className="s2__step-num">2</span>
          <span className="s2__step-label">가사 확인</span>
        </div>
        <div className="s2__step-line" />
        <div className={`s2__step ${step >= 3 ? 's2__step--active' : ''}`}>
          <span className="s2__step-num">3</span>
          <span className="s2__step-label">음악 생성</span>
        </div>
      </div>

      {/* ─── Step 1: Prompt Input ─── */}
      {step === 1 && (
        <div className="s2__form">
          <div className="s2__section">
            <label className="s2__main-label">
              <FiZap className="s2__label-icon" />
              어떤 음악을 만들고 싶나요?
            </label>
            <textarea
              className="s2__textarea s2__textarea--large"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="예: 비 오는 새벽에 듣기 좋은 감성적인 재즈 발라드, 피아노와 색소폰이 어우러진 로맨틱한 분위기"
              rows={4}
              maxLength={1000}
            />
            <div className="s2__char-count">{description.length} / 1,000</div>
          </div>

          <div className="s2__section">
            <label className="s2__label">장르 (선택)</label>
            <div className="s2__chips">
              {GENRE_PRESETS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`s2__chip ${selectedGenres.includes(g) ? 's2__chip--active' : ''}`}
                  onClick={() => toggleGenre(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="s2__section">
            <label className="s2__label">분위기 (선택)</label>
            <div className="s2__chips">
              {MOOD_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`s2__chip ${selectedMoods.includes(m) ? 's2__chip--active' : ''}`}
                  onClick={() => toggleMood(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="s2__msg s2__msg--error">{error}</div>}
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          <button
            className="s2__submit"
            onClick={handleGenerateLyrics}
            disabled={generatingLyrics}
          >
            {generatingLyrics ? (
              <>
                <FiLoader className="s2__spin" />
                AI가 가사를 작성하고 있습니다...
              </>
            ) : (
              <>
                <FiEdit3 />
                AI 가사 생성하기
              </>
            )}
          </button>

          {/* Or skip to manual lyrics */}
          <button
            className="s2__skip-btn"
            onClick={() => setStep(2)}
          >
            직접 가사 작성하기 →
          </button>
        </div>
      )}

      {/* ─── Step 2: Lyrics Confirm/Edit ─── */}
      {step === 2 && (
        <div className="s2__form">
          <div className="s2__section">
            <label className="s2__label">제목</label>
            <input
              className="s2__input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="곡 제목"
              maxLength={100}
            />
          </div>

          <div className="s2__section">
            <div className="s2__label-row">
              <label className="s2__main-label">
                <FiEdit3 className="s2__label-icon" />
                가사 편집
              </label>
              <button
                type="button"
                className={`s2__toggle ${isInstrumental ? 's2__toggle--on' : ''}`}
                onClick={() => setIsInstrumental(!isInstrumental)}
              >
                {isInstrumental ? <FiToggleRight /> : <FiToggleLeft />}
                {isInstrumental ? 'Instrumental' : 'Vocal'}
              </button>
            </div>

            {!isInstrumental && (
              <>
                <div className="s2__tag-bar">
                  {STRUCTURE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="s2__tag-btn"
                      onClick={() => insertTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={lyricsRef}
                  className="s2__textarea s2__textarea--lyrics"
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder={`[Verse]\n밤하늘에 별이 쏟아지면\n너와 걸었던 그 길이 떠올라\n\n[Chorus]\n우리의 노래가 울려 퍼져\n이 밤을 채우는 멜로디`}
                  rows={10}
                  maxLength={3000}
                />
                <div className="s2__char-count">{lyrics.length} / 3,000</div>
              </>
            )}
          </div>

          {error && <div className="s2__msg s2__msg--error">{error}</div>}

          <div className="s2__btn-row">
            <button className="s2__btn-back" onClick={() => setStep(1)}>
              <FiArrowLeft /> 이전
            </button>
            <button
              className="s2__btn-regen"
              onClick={handleGenerateLyrics}
              disabled={generatingLyrics}
            >
              <FiRefreshCw className={generatingLyrics ? 's2__spin' : ''} />
              가사 재생성
            </button>
            <button className="s2__submit s2__submit--next" onClick={handleConfirmLyrics}>
              가사 확정 <FiArrowRight />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Music Generation Settings ─── */}
      {step === 3 && (
        <div className="s2__form">
          {/* Preview confirmed lyrics */}
          <div className="s2__preview">
            <div className="s2__preview-header">
              <h3 className="s2__preview-title">{title || '무제'}</h3>
              <button className="s2__preview-edit" onClick={() => setStep(2)}>
                <FiEdit3 /> 가사 수정
              </button>
            </div>
            <pre className="s2__preview-lyrics">{lyrics || '(Instrumental)'}</pre>
          </div>

          {/* Model Selection */}
          <div className="s2__section">
            <label className="s2__label">AI 모델</label>
            <div className="s2__model-cards">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`s2__model-card ${selectedModel === m.id ? 's2__model-card--active' : ''}`}
                  onClick={() => setSelectedModel(m.id)}
                >
                  <span className="s2__model-name">{m.name}</span>
                  <span className="s2__model-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div className="s2__section">
            <label className="s2__main-label">
              <FiMusic className="s2__label-icon" />
              스타일 (자유 입력)
            </label>
            <input
              className="s2__input"
              type="text"
              value={styleText}
              onChange={(e) => setStyleText(e.target.value)}
              placeholder="예: dreamy lo-fi with soft piano, 90s R&B groove"
              maxLength={200}
            />
          </div>

          {/* Vocal */}
          {!isInstrumental && (
            <div className="s2__section">
              <label className="s2__label">
                <FiMic className="s2__label-icon--inline" />
                보컬 스타일
              </label>
              <div className="s2__vocal-grid">
                {VOCAL_PRESETS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    className={`s2__vocal-btn ${vocal === v.value ? 's2__vocal-btn--active' : ''}`}
                    onClick={() => setVocal(v.value)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Advanced */}
          <button
            type="button"
            className="s2__advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            세부 설정 {showAdvanced ? <FiChevronUp /> : <FiChevronDown />}
          </button>

          {showAdvanced && (
            <div className="s2__advanced">
              {selectedModel !== 'suno' && (
                <div className="s2__advanced-row">
                  <div className="s2__field">
                    <label className="s2__label">BPM</label>
                    <input
                      className="s2__input"
                      type="number"
                      min="40" max="240"
                      value={bpm}
                      onChange={(e) => setBpm(e.target.value)}
                      placeholder="60 ~ 180"
                    />
                  </div>
                  <div className="s2__field">
                    <label className="s2__label">키 (Key)</label>
                    <select
                      className="s2__select"
                      value={musicalKey}
                      onChange={(e) => setMusicalKey(e.target.value)}
                    >
                      <option value="">자동</option>
                      {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map((k) => (
                        <option key={k} value={k}>{k} Major / Minor</option>
                      ))}
                    </select>
                  </div>
                  <div className="s2__field">
                    <label className="s2__label">길이</label>
                    <select
                      className="s2__select"
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    >
                      <option value={30}>30초 (~1 segment)</option>
                      <option value={60}>1분 (~2 segments)</option>
                      <option value={90}>1분 30초 (~3 segments)</option>
                      <option value={120}>2분 (~4 segments)</option>
                    </select>
                  </div>
                </div>
              )}
              {selectedModel === 'suno' && (
                <div className="s2__suno-note">
                  Suno는 자체적으로 곡 길이, BPM, 키를 결정합니다.
                </div>
              )}
              <div className="s2__field">
                <label className="s2__label">참고 스타일 / 레퍼런스</label>
                <input
                  className="s2__input"
                  type="text"
                  value={referenceText}
                  onChange={(e) => setReferenceText(e.target.value)}
                  placeholder="예: BTS - Spring Day 느낌, 지브리 OST 스타일"
                />
              </div>
            </div>
          )}

          {error && <div className="s2__msg s2__msg--error">{error}</div>}
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          <div className="s2__btn-row">
            <button className="s2__btn-back" onClick={() => setStep(2)}>
              <FiArrowLeft /> 이전
            </button>
            <button
              className="s2__submit"
              onClick={handleGenerateMusic}
              disabled={submitting}
            >
              {submitting ? (
                <><FiLoader className="s2__spin" /> 생성 요청 중...</>
              ) : (
                <><FiZap /> 음악 생성 시작</>
              )}
            </button>
          </div>

          <div className="s2__note">
            {selectedModel === 'suno'
              ? 'Suno AI가 음악을 생성합니다. 약 1~3분 소요됩니다.'
              : 'YuE AI 모델이 음악을 생성합니다. 30초당 약 15~30분 소요됩니다.'}
          </div>
        </div>
      )}
      </>)}

      {/* ─── Generation History ─── */}
      <div className="s2__history">
        <div className="s2__history-header">
          <h3 className="s2__history-title">
            <FiClock /> 생성 기록
          </h3>
          <button className="s2__history-refresh" onClick={fetchHistory} disabled={loadingHistory}>
            <FiRefreshCw className={loadingHistory ? 's2__spin' : ''} />
          </button>
        </div>

        {loadingHistory && generations.length === 0 ? (
          <div className="s2__history-empty">로딩 중...</div>
        ) : generations.length === 0 ? (
          <div className="s2__history-empty">아직 생성 기록이 없습니다.</div>
        ) : (
          <div className="s2__history-list">
            {generations.map((gen) => (
              <div key={gen.id} className="s2__gen-card">
                <div className="s2__gen-top">
                  <div className="s2__gen-info">
                    {gen.title && <div className="s2__gen-title">{gen.title}</div>}
                    <div className="s2__gen-prompt">{gen.prompt}</div>
                  </div>
                  <span className={`s2__gen-status s2__gen-status--${gen.status}`}>
                    {gen.status === 'processing' && gen.progress ? `${gen.progress}%` : statusLabel(gen.status)}
                  </span>
                </div>
                <div className="s2__gen-meta">
                  {gen.model && (
                    <span className="s2__gen-tag s2__gen-tag--model">
                      {gen.model === 'yue' ? 'YuE' : gen.model === 'suno' ? 'Suno' : gen.model}
                    </span>
                  )}
                  {gen.genre && <span className="s2__gen-tag">{gen.genre}</span>}
                  {gen.mood && <span className="s2__gen-tag">{gen.mood}</span>}
                  {gen.style && <span className="s2__gen-tag s2__gen-tag--style">{gen.style}</span>}
                  {gen.vocal === 'instrumental' && (
                    <span className="s2__gen-tag s2__gen-tag--inst">Instrumental</span>
                  )}
                  {gen.duration && <span className="s2__gen-tag">{gen.duration}초</span>}
                </div>
                {/* Play/Download for completed generations */}
                {gen.status === 'completed' && (
                  <div className="s2__gen-player">
                    <button
                      className={`s2__gen-play ${playingId === gen.id ? 's2__gen-play--active' : ''}`}
                      onClick={() => handlePlayGeneration(gen.id)}
                    >
                      {playingId === gen.id ? <FiPause /> : <FiPlay />}
                      {playingId === gen.id ? '일시정지' : '재생'}
                    </button>
                    <button
                      className="s2__gen-download"
                      onClick={() => handleDownloadGeneration(gen.id, gen.title)}
                    >
                      <FiDownload /> 다운로드
                    </button>
                    {onSendToUpload && (
                      <button
                        className="s2__gen-upload"
                        onClick={() => onSendToUpload({
                          generationId: gen.id,
                          title: gen.title,
                          genre: gen.genre,
                          mood: gen.mood,
                          prompt: gen.prompt,
                          lyrics: gen.lyrics,
                        })}
                      >
                        <FiUploadCloud /> 업로드하기
                      </button>
                    )}
                  </div>
                )}

                <div className="s2__gen-bottom">
                  <span className="s2__gen-date">{formatDate(gen.created_at)}</span>
                  <div className="s2__gen-actions">
                    {gen.status === 'failed' && (
                      <button className="s2__gen-retry" onClick={() => handleRetry(gen.id)}>
                        <FiRefreshCw /> 재시도
                      </button>
                    )}
                    <button
                      className="s2__gen-delete"
                      onClick={() => handleDelete(gen.id)}
                      disabled={deleting === gen.id}
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
