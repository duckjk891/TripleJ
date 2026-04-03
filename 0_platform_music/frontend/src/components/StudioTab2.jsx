import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiZap, FiMusic, FiMic, FiChevronDown, FiChevronUp,
  FiClock, FiTrash2, FiRefreshCw, FiEdit3, FiSliders,
  FiCheck, FiArrowLeft, FiArrowRight, FiLoader,
  FiToggleLeft, FiToggleRight, FiPlay, FiPause, FiDownload,
  FiUploadCloud, FiRepeat,
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

function MrPitchAdjustPanel({ generationId, onMergeComplete }) {
  const [mrPitch, setMrPitch] = useState(0);
  const [vocalVolume, setVocalVolume] = useState(0.7);
  const [mrVolume, setMrVolume] = useState(0.85);
  const [merging, setMerging] = useState(false);

  const audioCtxRef = useRef(null);
  const vocalBufferRef = useRef(null);
  const mrBufferRef = useRef(null);
  const vocalSourceRef = useRef(null);
  const mrSourceRef = useRef(null);
  const vocalGainRef = useRef(null);
  const mrGainRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playMode, setPlayMode] = useState('both');
  const [pitchedMrBuffer, setPitchedMrBuffer] = useState(null);
  const [pitchedMrPitch, setPitchedMrPitch] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    const loadAudio = async () => {
      const token = localStorage.getItem('token');
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;

      try {
        const vocalResp = await fetch(api.streamConvertedVocal(generationId), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const vocalData = await vocalResp.arrayBuffer();
        vocalBufferRef.current = await ctx.decodeAudioData(vocalData);

        const mrResp = await fetch(api.streamBacking(generationId), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const mrData = await mrResp.arrayBuffer();
        mrBufferRef.current = await ctx.decodeAudioData(mrData);

        setLoading(false);
      } catch (err) {
        console.error('Failed to load audio:', err);
      }
    };
    loadAudio();

    return () => {
      stopPlayback();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [generationId]);

  const stopPlayback = () => {
    try { vocalSourceRef.current?.stop(); } catch {}
    try { mrSourceRef.current?.stop(); } catch {}
    setIsPlaying(false);
  };

  const startPlayback = () => {
    if (!audioCtxRef.current || !vocalBufferRef.current || !mrBufferRef.current) return;
    stopPlayback();

    const ctx = audioCtxRef.current;

    const vocalSource = ctx.createBufferSource();
    vocalSource.buffer = vocalBufferRef.current;
    const vocalGain = ctx.createGain();
    vocalGain.gain.value = playMode === 'mr' ? 0 : vocalVolume;
    vocalSource.connect(vocalGain).connect(ctx.destination);
    vocalGainRef.current = vocalGain;
    vocalSourceRef.current = vocalSource;

    // MR source: use pitched buffer if available, otherwise original
    const mrBuffer = (pitchedMrBuffer && pitchedMrPitch === mrPitch)
      ? pitchedMrBuffer
      : mrBufferRef.current;

    const mrSource = ctx.createBufferSource();
    mrSource.buffer = mrBuffer;
    const mrGain = ctx.createGain();
    mrGain.gain.value = playMode === 'vocal' ? 0 : mrVolume;
    mrSource.connect(mrGain).connect(ctx.destination);
    mrGainRef.current = mrGain;
    mrSourceRef.current = mrSource;

    vocalSource.start();
    mrSource.start();
    setIsPlaying(true);

    vocalSource.onended = () => setIsPlaying(false);
  };

  useEffect(() => {
    if (vocalGainRef.current) {
      vocalGainRef.current.gain.value = playMode === 'mr' ? 0 : vocalVolume;
    }
  }, [vocalVolume, playMode]);

  useEffect(() => {
    if (mrGainRef.current) {
      mrGainRef.current.gain.value = playMode === 'vocal' ? 0 : mrVolume;
    }
  }, [mrVolume, playMode]);

  useEffect(() => {
    // pitchedMrPitch와 mrPitch가 다르면 미리듣기 버튼으로 유도
    // (실시간 변경 없음 - 서버 처리 필요)
  }, [mrPitch]);

  const handlePreviewPitch = async () => {
    if (mrPitch === pitchedMrPitch && pitchedMrBuffer) return;
    setLoadingPreview(true);
    try {
      const { data } = await api.previewMrPitched(generationId, mrPitch);
      const ctx = audioCtxRef.current;
      const buffer = await ctx.decodeAudioData(data);
      setPitchedMrBuffer(buffer);
      setPitchedMrPitch(mrPitch);
    } catch (err) {
      alert('MR 피치 변환 실패: ' + (err.message || ''));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    try {
      await api.mergeVoiceConversion(generationId, {
        mr_pitch_shift: mrPitch,
        vocal_volume: vocalVolume,
        mr_volume: mrVolume,
      });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data } = await api.getVoiceConvertStatus(generationId);
        if (data.voice_conversion_status === 'completed') {
          onMergeComplete();
          return;
        }
        if (data.voice_conversion_status === 'failed') {
          alert('합치기 실패: ' + (data.voice_conversion_error || ''));
          break;
        }
      }
    } catch (err) {
      alert(err.response?.data?.error || '합치기에 실패했습니다.');
    } finally {
      setMerging(false);
    }
  };

  const handleReset = () => {
    setMrPitch(0);
    setVocalVolume(0.7);
    setMrVolume(0.85);
  };

  if (loading) {
    return (
      <div className="mr-pitch__panel">
        <div className="mr-pitch__loading">
          <FiLoader className="s2__spin" /> 오디오 로딩 중...
        </div>
      </div>
    );
  }

  return (
    <div className="mr-pitch__panel">
      <div className="mr-pitch__header">
        <FiSliders className="mr-pitch__icon" />
        <span>MR 음정 조절 & 합치기</span>
      </div>

      {/* Play Mode Selector */}
      <div className="mr-pitch__mode-tabs">
        <button
          className={`mr-pitch__mode-tab ${playMode === 'vocal' ? 'mr-pitch__mode-tab--active' : ''}`}
          onClick={() => setPlayMode('vocal')}
        >
          <FiMic /> 보컬만
        </button>
        <button
          className={`mr-pitch__mode-tab ${playMode === 'mr' ? 'mr-pitch__mode-tab--active' : ''}`}
          onClick={() => setPlayMode('mr')}
        >
          <FiMusic /> MR만
        </button>
        <button
          className={`mr-pitch__mode-tab ${playMode === 'both' ? 'mr-pitch__mode-tab--active' : ''}`}
          onClick={() => setPlayMode('both')}
        >
          <FiZap /> 합쳐서
        </button>
      </div>

      {/* Play / Stop */}
      <button
        className={`mr-pitch__play-btn ${isPlaying ? 'mr-pitch__play-btn--active' : ''}`}
        onClick={isPlaying ? stopPlayback : startPlayback}
      >
        {isPlaying ? <><FiPause /> 정지</> : <><FiPlay /> 미리 듣기</>}
      </button>

      {/* MR Pitch Slider */}
      <div className="mr-pitch__section">
        <label className="mr-pitch__label">MR 음정 조절</label>
        <div className="mr-pitch__value-display">
          {mrPitch > 0 ? '+' : ''}{mrPitch} 반음
        </div>
        <input
          type="range"
          className="mr-pitch__slider"
          min={-12}
          max={12}
          step={0.5}
          value={mrPitch}
          onChange={(e) => setMrPitch(parseFloat(e.target.value))}
        />
        <div className="mr-pitch__quick-btns">
          <button onClick={() => setMrPitch((p) => Math.max(-12, p - 1))}>-1</button>
          <button onClick={() => setMrPitch((p) => Math.max(-12, p - 0.5))}>-0.5</button>
          <button onClick={() => setMrPitch(0)}>원래 음정</button>
          <button onClick={() => setMrPitch((p) => Math.min(12, p + 0.5))}>+0.5</button>
          <button onClick={() => setMrPitch((p) => Math.min(12, p + 1))}>+1</button>
        </div>
        <div className="mr-pitch__preview-btn-wrap">
          <button
            className="mr-pitch__preview-btn"
            onClick={handlePreviewPitch}
            disabled={loadingPreview || mrPitch === 0}
          >
            {loadingPreview ? '변환 중...' : `이 음정(${mrPitch > 0 ? '+' : ''}${mrPitch})으로 미리듣기 적용`}
          </button>
          {pitchedMrPitch !== null && pitchedMrPitch === mrPitch && (
            <span className="mr-pitch__preview-applied">&#10003; 적용됨</span>
          )}
          {mrPitch === 0 && (
            <span className="mr-pitch__preview-note">원래 음정은 변환 불필요</span>
          )}
        </div>
      </div>

      {/* Vocal Volume Slider */}
      <div className="mr-pitch__section">
        <label className="mr-pitch__label">
          보컬 볼륨 <span className="mr-pitch__vol-val">{Math.round(vocalVolume * 100)}%</span>
        </label>
        <input
          type="range"
          className="mr-pitch__slider"
          min={0}
          max={1}
          step={0.05}
          value={vocalVolume}
          onChange={(e) => setVocalVolume(parseFloat(e.target.value))}
        />
      </div>

      {/* MR Volume Slider */}
      <div className="mr-pitch__section">
        <label className="mr-pitch__label">
          MR 볼륨 <span className="mr-pitch__vol-val">{Math.round(mrVolume * 100)}%</span>
        </label>
        <input
          type="range"
          className="mr-pitch__slider"
          min={0}
          max={1}
          step={0.05}
          value={mrVolume}
          onChange={(e) => setMrVolume(parseFloat(e.target.value))}
        />
      </div>

      {/* Action Buttons */}
      <div className="mr-pitch__actions">
        <button className="mr-pitch__reset-btn" onClick={handleReset}>
          <FiRefreshCw /> 원래 음정으로 초기화
        </button>
        <button
          className="mr-pitch__merge-btn"
          onClick={handleMerge}
          disabled={merging}
        >
          {merging ? (
            <><FiLoader className="s2__spin" /> 합치는 중...</>
          ) : (
            <><FiCheck /> 이 설정으로 최종 합치기</>
          )}
        </button>
      </div>

      {merging && (
        <div className="mr-pitch__merging-status">
          <FiLoader className="s2__spin" />
          <span>서버에서 합치는 중... 잠시만 기다려주세요.</span>
        </div>
      )}
    </div>
  );
}

const DEFAULT_LYRICS = `[Verse]
새벽 공기를 마시며 걸어가는 이 길
어제의 나를 두고 오늘을 시작해
흐릿한 가로등 아래 긴 그림자 하나
조용히 나를 따라와

[Chorus]
괜찮아 천천히 가도 돼
멈춰도 돼 쉬어가도 돼
이 길의 끝에 뭐가 있든
지금 이 한 걸음이면 돼

[Verse]
창문 너머로 보이는 하늘은 여전히
어제와 같은 색인데
내 마음만 달라져 있어
작은 용기 하나 품고서

[Chorus]
괜찮아 천천히 가도 돼
멈춰도 돼 쉬어가도 돼
이 길의 끝에 뭐가 있든
지금 이 한 걸음이면 돼

[Outro]
한 걸음 또 한 걸음
나는 걸어가고 있어`;

const WONDERA_MODELS = [
  { value: 'auto', label: 'Auto (자동 선택)' },
  { value: 'wondera-2.1', label: 'Wondera 2.1' },
  { value: 'wondera-2.2', label: 'Wondera 2.2' },
  { value: 'wondera-o1', label: 'Wondera O1' },
  { value: 'wondera-o2', label: 'Wondera O2' },
];

function WonderaTestSection() {
  // Upload state
  const [vocalFile, setVocalFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [vocalId, setVocalId] = useState(null);

  // Generate state
  const [wLyrics, setWLyrics] = useState(DEFAULT_LYRICS);
  const [wPrompt, setWPrompt] = useState('k-pop, ballad, emotional, female vocal');
  const [wModel, setWModel] = useState('auto');

  // Generation tasks
  const [, setAiTaskId] = useState(null);
  const [, setMyTaskId] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [myStatus, setMyStatus] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [myResult, setMyResult] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [myError, setMyError] = useState(null);

  // Upload handler
  const handleUpload = async () => {
    if (!vocalFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', vocalFile);
      const { data } = await api.wonderaUploadVocal(formData);
      const id = data?.data?.id;
      if (id) {
        setVocalId(id);
      } else {
        alert('업로드 실패: ID를 받지 못했습니다. 응답: ' + JSON.stringify(data));
      }
    } catch (err) {
      alert(err.response?.data?.error || '업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  // Poll helper
  const pollTask = async (taskId, setStatus, setResult, setError) => {
    setStatus('generating');
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const { data } = await api.wonderaQuery(taskId);
        const taskData = data?.data || data;
        const status = taskData?.status;

        if (status === 'succeeded') {
          setStatus('succeeded');
          setResult(taskData);
          return;
        } else if (status === 'failed' || status === 'timeouted' || status === 'cancelled') {
          setStatus('failed');
          setError(taskData?.error_info || status);
          return;
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }
    setStatus('failed');
    setError('시간 초과');
  };

  // Generate AI vocal version (no vocal_id)
  const handleGenerateAI = async () => {
    setAiStatus('generating');
    setAiResult(null);
    setAiError(null);
    try {
      const payload = { lyrics: wLyrics, model: wModel, prompt: wPrompt };
      const { data } = await api.wonderaGenerate(payload);
      const taskId = data?.data?.task_id;
      if (!taskId) {
        setAiStatus('failed');
        setAiError('task_id를 받지 못했습니다. 응답: ' + JSON.stringify(data));
        return;
      }
      setAiTaskId(taskId);
      pollTask(taskId, setAiStatus, setAiResult, setAiError);
    } catch (err) {
      setAiStatus('failed');
      setAiError(err.response?.data?.error || '생성 실패');
    }
  };

  // Generate my voice version (with vocal_id)
  const handleGenerateMy = async () => {
    if (!vocalId) {
      alert('먼저 목소리 파일을 업로드해주세요.');
      return;
    }
    setMyStatus('generating');
    setMyResult(null);
    setMyError(null);
    try {
      const payload = { lyrics: wLyrics, model: wModel, vocal_id: vocalId };
      if (wPrompt) payload.prompt = wPrompt;
      const { data } = await api.wonderaGenerate(payload);
      const taskId = data?.data?.task_id;
      if (!taskId) {
        setMyStatus('failed');
        setMyError('task_id를 받지 못했습니다. 응답: ' + JSON.stringify(data));
        return;
      }
      setMyTaskId(taskId);
      pollTask(taskId, setMyStatus, setMyResult, setMyError);
    } catch (err) {
      setMyStatus('failed');
      setMyError(err.response?.data?.error || '생성 실패');
    }
  };

  // Extract audio URL from result
  const getAudioUrl = (result) => {
    if (!result) return null;
    const songs = result.songs || result.data?.songs || [];
    if (songs.length > 0) return songs[0].audio_url || songs[0].url;
    return result.audio_url || result.url || null;
  };

  return (
    <div className="wondera-test">
      <h3 className="wondera-test__title">🧪 Wondera API 테스트</h3>

      {/* Upload */}
      <div className="wondera-test__section">
        <label className="wondera-test__label">① 내 목소리 업로드 (mp3, m4a / 15~30초)</label>
        <div className="wondera-test__upload-row">
          <input
            type="file"
            accept=".mp3,.m4a"
            onChange={(e) => setVocalFile(e.target.files[0])}
          />
          <button
            className="wondera-test__btn"
            onClick={handleUpload}
            disabled={!vocalFile || uploading}
          >
            {uploading ? '업로드 중...' : '업로드'}
          </button>
        </div>
        {vocalId && (
          <div className="wondera-test__success">✓ vocal_id: {vocalId}</div>
        )}
      </div>

      {/* Lyrics & Style */}
      <div className="wondera-test__section">
        <label className="wondera-test__label">② 가사 & 스타일</label>
        <textarea
          className="wondera-test__textarea"
          value={wLyrics}
          onChange={(e) => setWLyrics(e.target.value)}
          rows={12}
        />
        <div className="wondera-test__row">
          <div className="wondera-test__field">
            <label>스타일 프롬프트</label>
            <input
              type="text"
              value={wPrompt}
              onChange={(e) => setWPrompt(e.target.value)}
              placeholder="k-pop, ballad, emotional..."
            />
          </div>
          <div className="wondera-test__field">
            <label>모델</label>
            <select value={wModel} onChange={(e) => setWModel(e.target.value)}>
              {WONDERA_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Generate */}
      <div className="wondera-test__section">
        <label className="wondera-test__label">③ 생성</label>
        <div className="wondera-test__gen-row">
          <button
            className="wondera-test__btn wondera-test__btn--ai"
            onClick={handleGenerateAI}
            disabled={aiStatus === 'generating' || !wLyrics}
          >
            {aiStatus === 'generating' ? '생성 중...' : '🎵 AI 보컬로 생성'}
          </button>
          <button
            className="wondera-test__btn wondera-test__btn--my"
            onClick={handleGenerateMy}
            disabled={myStatus === 'generating' || !wLyrics || !vocalId}
          >
            {myStatus === 'generating' ? '생성 중...' : '🎤 내 목소리로 생성'}
          </button>
        </div>

        {aiStatus === 'generating' && <div className="wondera-test__status">AI 보컬: 생성 중... (최대 3분 소요)</div>}
        {myStatus === 'generating' && <div className="wondera-test__status">내 목소리: 생성 중... (최대 3분 소요)</div>}
        {aiError && <div className="wondera-test__error">AI 보컬 에러: {aiError}</div>}
        {myError && <div className="wondera-test__error">내 목소리 에러: {myError}</div>}
      </div>

      {/* Results */}
      {(aiResult || myResult) && (
        <div className="wondera-test__section">
          <label className="wondera-test__label">④ 결과 비교</label>
          <div className="wondera-test__results">
            {aiResult && (
              <div className="wondera-test__result-card">
                <h4>AI 보컬 버전</h4>
                {getAudioUrl(aiResult) ? (
                  <>
                    <audio controls src={getAudioUrl(aiResult)} style={{width:'100%'}} />
                    <a href={getAudioUrl(aiResult)} download className="wondera-test__download">⬇ 다운로드</a>
                  </>
                ) : (
                  <div className="wondera-test__raw">응답: {JSON.stringify(aiResult, null, 2)}</div>
                )}
              </div>
            )}
            {myResult && (
              <div className="wondera-test__result-card wondera-test__result-card--my">
                <h4>내 목소리 버전</h4>
                {getAudioUrl(myResult) ? (
                  <>
                    <audio controls src={getAudioUrl(myResult)} style={{width:'100%'}} />
                    <a href={getAudioUrl(myResult)} download className="wondera-test__download">⬇ 다운로드</a>
                  </>
                ) : (
                  <div className="wondera-test__raw">응답: {JSON.stringify(myResult, null, 2)}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudioTab2({ onSendToUpload }) {
  // ─── Mode: 'simple' or 'custom' ───
  const [mode, setMode] = useState('custom');
  const [selectedModel, setSelectedModel] = useState('yue');

  // ─── Voice Persona state ───
  const [myPersonas, setMyPersonas] = useState([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(null);

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

  // Voice Conversion (Kits.AI)
  const [kitsModels, setKitsModels] = useState([]);
  const [kitsModelsLoaded, setKitsModelsLoaded] = useState(false);
  const [vcModalGenId, setVcModalGenId] = useState(null);
  const [vcSelectedModel, setVcSelectedModel] = useState(null);
  const [vcStrength, setVcStrength] = useState(0.8);
  const [vcVolumeMix, setVcVolumeMix] = useState(0.9);
  const [vcPitchShift, setVcPitchShift] = useState(0);
  const [vcSubmitting, setVcSubmitting] = useState(false);
  const [vcPlayingId, setVcPlayingId] = useState(null);
  const vcAudioRef = useRef(null);
  const vcPollRef = useRef(null);

  // Polling for active generations
  const pollRef = useRef(null);
  const lyricsRef = useRef(null);

  // Fetch voice personas for "My Voice" option
  useEffect(() => {
    api.getVoicePersonas()
      .then(({ data }) => {
        const completed = (data.personas || []).filter((p) => p.status === 'completed' && p.persona_id);
        setMyPersonas(completed);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchHistory();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Poll for processing generations (including voice conversion in-progress)
  useEffect(() => {
    const hasProcessing = generations.some((g) =>
      g.status === 'processing' || g.status === 'pending' ||
      (g.voice_conversion_status && g.voice_conversion_status !== 'completed' && g.voice_conversion_status !== 'failed' && g.voice_conversion_status !== 'awaiting_merge' && g.voice_conversion_status !== null)
    );
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
        persona_id: selectedPersonaId || null,
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
      setSelectedPersonaId(null);
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

  // ─── Voice Conversion (Kits.AI + Suno Persona) ───
  const [vcSelectedType, setVcSelectedType] = useState(null); // 'suno_persona' | 'kits'

  const openVcModal = async (genId) => {
    setVcModalGenId(genId);
    setVcSelectedModel(null);
    setVcSelectedType(null);
    setVcStrength(0.75);
    setVcVolumeMix(0.9);
    setVcPitchShift(0);
    if (!kitsModelsLoaded) {
      try {
        const { data } = await api.getKitsVoiceModels();
        const models = data.voice_models?.data || data.voice_models || [];
        setKitsModels(Array.isArray(models) ? models : []);
        setKitsModelsLoaded(true);
      } catch (err) {
        console.error('Failed to load Kits models:', err);
        setKitsModels([]);
        setKitsModelsLoaded(true);
      }
    }
  };

  const handleStartVoiceConvert = async () => {
    if (vcSelectedType === 'suno_persona') {
      // Suno persona path: create a new generation with persona_id
      if (!vcSelectedModel) {
        alert('목소리를 선택해주세요.');
        return;
      }
      setVcSubmitting(true);
      try {
        // Find the original generation to copy its data
        const origGen = generations.find((g) => g.id === vcModalGenId);
        await api.createGeneration({
          prompt: origGen?.prompt || '',
          title: origGen?.title ? `${origGen.title} (내 목소리)` : null,
          lyrics: origGen?.lyrics || '',
          genre: origGen?.genre || null,
          mood: origGen?.mood || null,
          style: origGen?.style || null,
          start_music_gen: true,
          model: 'suno',
          persona_id: vcSelectedModel,
        });
        setVcModalGenId(null);
        fetchHistory();
      } catch (err) {
        alert(err.response?.data?.error || '음성 생성 시작에 실패했습니다.');
      } finally {
        setVcSubmitting(false);
      }
      return;
    }

    // Kits.AI path
    if (!vcSelectedModel) {
      alert('목소리 모델을 선택해주세요.');
      return;
    }
    setVcSubmitting(true);
    try {
      await api.startVoiceConvert(vcModalGenId, {
        voice_model_id: vcSelectedModel,
        conversion_strength: vcStrength,
        model_volume_mix: vcVolumeMix,
        pitch_shift: vcPitchShift,
      });
      setVcModalGenId(null);
      fetchHistory();
    } catch (err) {
      alert(err.response?.data?.error || '음성 변환 시작에 실패했습니다.');
    } finally {
      setVcSubmitting(false);
    }
  };

  const handlePlayVc = (genId) => {
    if (vcPlayingId === genId && vcAudioRef.current) {
      vcAudioRef.current.pause();
      setVcPlayingId(null);
      return;
    }
    if (vcAudioRef.current) vcAudioRef.current.pause();
    const audio = new Audio(api.voiceConvertStreamUrl(genId));
    audio.onended = () => setVcPlayingId(null);
    audio.onerror = () => { setVcPlayingId(null); alert('오디오 재생에 실패했습니다.'); };
    vcAudioRef.current = audio;
    setVcPlayingId(genId);
    audio.play();
  };

  const handleDownloadVc = (genId) => {
    window.location.href = api.voiceConvertDownloadUrl(genId);
  };

  // Cleanup VC audio on unmount
  useEffect(() => {
    return () => {
      if (vcAudioRef.current) { vcAudioRef.current.pause(); vcAudioRef.current = null; }
    };
  }, []);

  const vcStatusLabel = (status) => {
    switch (status) {
      case 'pending': return '대기 중';
      case 'converting': return '변환 중';
      case 'merging': return '합치는 중';
      case 'awaiting_merge': return 'MR 조절 대기';
      case 'uploading': return '업로드 중';
      case 'completed': return '완료';
      case 'failed': return '실패';
      default: return '';
    }
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
        <button
          className={`s2__mode-btn ${mode === 'wondera' ? 's2__mode-btn--active' : ''}`}
          onClick={() => setMode('wondera')}
        >
          <FiMusic /> 테스트 Wondera
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
                    className={`s2__vocal-btn ${vocal === v.value && !selectedPersonaId ? 's2__vocal-btn--active' : ''}`}
                    onClick={() => { setVocal(v.value); setSelectedPersonaId(null); }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {/* My Voice Personas (Suno only) */}
              {selectedModel === 'suno' && myPersonas.length > 0 && (
                <div className="s2__persona-section">
                  <label className="s2__label s2__label--persona">
                    <FiMic className="s2__label-icon--inline" />
                    내 목소리 (Voice Persona)
                  </label>
                  <div className="s2__vocal-grid">
                    {myPersonas.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`s2__vocal-btn s2__vocal-btn--persona ${selectedPersonaId === p.persona_id ? 's2__vocal-btn--active' : ''}`}
                        onClick={() => { setSelectedPersonaId(p.persona_id); setVocal(''); }}
                      >
                        <FiMic style={{ marginRight: 4 }} />
                        {p.name}
                      </button>
                    ))}
                  </div>
                  {selectedPersonaId && (
                    <div className="s2__persona-note">
                      내 Voice Persona가 선택되었습니다. Suno가 이 목소리 톤으로 노래를 생성합니다.
                    </div>
                  )}
                </div>
              )}
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

      {mode === 'wondera' && (
        <WonderaTestSection />
      )}

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
                          hasVoiceConverted: gen.voice_conversion_status === 'completed',
                        })}
                      >
                        <FiUploadCloud /> 업로드하기
                      </button>
                    )}
                    {/* Voice Conversion Button */}
                    {!gen.voice_conversion_status && (
                      <button
                        className="s2__gen-vc"
                        onClick={() => openVcModal(gen.id)}
                      >
                        <FiRepeat /> 내 목소리로 변환
                      </button>
                    )}
                  </div>
                )}

                {/* Voice Conversion Status */}
                {gen.voice_conversion_status === 'awaiting_merge' && (
                  <MrPitchAdjustPanel generationId={gen.id} onMergeComplete={() => fetchHistory()} />
                )}

                {gen.voice_conversion_status && gen.voice_conversion_status !== 'completed' && gen.voice_conversion_status !== 'failed' && gen.voice_conversion_status !== 'awaiting_merge' && (
                  <div className="s2__vc-status">
                    <FiRepeat className="s2__spin" />
                    <span>목소리 변환: {vcStatusLabel(gen.voice_conversion_status)}</span>
                    {gen.voice_conversion_progress > 0 && (
                      <span className="s2__vc-progress">{gen.voice_conversion_progress}%</span>
                    )}
                    <div className="s2__vc-bar">
                      <div className="s2__vc-bar-fill" style={{ width: `${gen.voice_conversion_progress || 0}%` }} />
                    </div>
                  </div>
                )}

                {gen.voice_conversion_status === 'failed' && (
                  <div className="s2__vc-status s2__vc-status--error">
                    <span>목소리 변환 실패: {gen.voice_conversion_error || '알 수 없는 오류'}</span>
                    <button className="s2__gen-vc s2__gen-vc--retry" onClick={() => openVcModal(gen.id)}>
                      <FiRefreshCw /> 재시도
                    </button>
                  </div>
                )}

                {/* Voice Converted Audio Player */}
                {gen.voice_conversion_status === 'completed' && gen.voice_converted_url && (
                  <div className="s2__vc-player">
                    <span className="s2__vc-label"><FiRepeat /> 내 목소리 버전</span>
                    <button
                      className={`s2__gen-play ${vcPlayingId === gen.id ? 's2__gen-play--active' : ''}`}
                      onClick={() => handlePlayVc(gen.id)}
                    >
                      {vcPlayingId === gen.id ? <FiPause /> : <FiPlay />}
                      {vcPlayingId === gen.id ? '정지' : '재생'}
                    </button>
                    <button className="s2__gen-download" onClick={() => handleDownloadVc(gen.id)}>
                      <FiDownload /> 다운로드
                    </button>
                    <button className="s2__gen-vc s2__gen-vc--retry" onClick={() => openVcModal(gen.id)}>
                      <FiRefreshCw /> 다시 변환
                    </button>
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

      {/* ─── Voice Conversion Modal ─── */}
      {vcModalGenId && (
        <div className="s2__vc-overlay" onClick={() => setVcModalGenId(null)}>
          <div className="s2__vc-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="s2__vc-modal-title"><FiRepeat /> 내 목소리로 변환</h3>
            <p className="s2__vc-modal-desc">
              목소리를 선택하면, 이 음악을 당신의 목소리로 변환합니다.
            </p>

            {/* Model Selection - Two Groups */}
            <div className="s2__vc-section">
              <label className="s2__label">목소리 선택</label>

              {/* Group 1: 우회 방식 (Suno Persona) */}
              {myPersonas.length > 0 && (
                <>
                  <div className="s2__vc-group-header">── 우회 방식 ──</div>
                  <div className="s2__vc-models">
                    {myPersonas.map((p) => (
                      <button
                        key={`persona-${p.id}`}
                        className={`s2__vc-model-btn ${vcSelectedType === 'suno_persona' && vcSelectedModel === p.persona_id ? 's2__vc-model-btn--active' : ''}`}
                        onClick={() => { setVcSelectedModel(p.persona_id); setVcSelectedType('suno_persona'); }}
                      >
                        <FiMic style={{ marginRight: 4, flexShrink: 0 }} />
                        <span className="s2__vc-model-name">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Group 2: Kits.AI */}
              <div className="s2__vc-group-header">── Kits.AI ──</div>
              {kitsModels.length === 0 ? (
                <div className="s2__vc-empty">
                  {kitsModelsLoaded ? '등록된 Kits.AI 모델이 없습니다.' : '로딩 중...'}
                </div>
              ) : (
                <div className="s2__vc-models">
                  {kitsModels.map((m) => (
                    <button
                      key={`kits-${m.id}`}
                      className={`s2__vc-model-btn ${vcSelectedType === 'kits' && vcSelectedModel === m.id ? 's2__vc-model-btn--active' : ''}`}
                      onClick={() => { setVcSelectedModel(m.id); setVcSelectedType('kits'); }}
                    >
                      <span className="s2__vc-model-name">{m.title || m.name || `Model ${m.id}`}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Advanced Settings (Kits.AI only) */}
            {vcSelectedType === 'kits' && (
              <>
                <div className="s2__vc-section">
                  <label className="s2__label">변환 강도: {vcStrength}</label>
                  <span className="s2__vc-hint">내 목소리를 얼마나 강하게 입힐지 (높을수록 내 목소리에 가까움)</span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={vcStrength}
                    onChange={(e) => setVcStrength(parseFloat(e.target.value))}
                    className="s2__vc-slider"
                  />
                </div>
                <div className="s2__vc-section">
                  <label className="s2__label">모델 볼륨 믹스: {vcVolumeMix}</label>
                  <span className="s2__vc-hint">변환된 목소리와 원본 보컬의 음량 비율 (높을수록 내 목소리 음량 위주)</span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={vcVolumeMix}
                    onChange={(e) => setVcVolumeMix(parseFloat(e.target.value))}
                    className="s2__vc-slider"
                  />
                </div>
                <div className="s2__vc-section">
                  <label className="s2__label">피치 조절: {vcPitchShift > 0 ? `+${vcPitchShift}` : vcPitchShift}</label>
                  <span className="s2__vc-hint">음높이 조절 (0 = 원래 그대로, 남→여: +3~5, 여→남: -3~-5)</span>
                  <input
                    type="range" min="-24" max="24" step="1"
                    value={vcPitchShift}
                    onChange={(e) => setVcPitchShift(parseInt(e.target.value))}
                    className="s2__vc-slider"
                  />
                </div>
              </>
            )}

            {vcSelectedType === 'suno_persona' && (
              <div className="s2__vc-section">
                <div className="s2__persona-note">
                  Suno가 이 곡의 가사와 스타일을 유지하면서 선택한 목소리로 새로 생성합니다.
                </div>
              </div>
            )}

            <div className="s2__vc-modal-actions">
              <button className="s2__btn-back" onClick={() => setVcModalGenId(null)}>
                취소
              </button>
              <button
                className="s2__submit"
                onClick={handleStartVoiceConvert}
                disabled={vcSubmitting || !vcSelectedModel || !vcSelectedType}
              >
                {vcSubmitting ? <><FiLoader className="s2__spin" /> 변환 시작 중...</> : <><FiRepeat /> 변환 시작</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
