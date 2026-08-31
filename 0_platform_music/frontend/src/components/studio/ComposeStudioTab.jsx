import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiZap, FiMusic, FiMic, FiChevronDown, FiChevronUp,
  FiClock, FiTrash2, FiRefreshCw, FiEdit3, FiSliders,
  FiCheck, FiArrowLeft, FiArrowRight, FiLoader,
  FiPlay, FiPause, FiDownload, FiUploadCloud,
} from 'react-icons/fi';
import * as api from '../../api';
import LyricsTimestampToggle from '../LyricsTimestampToggle';
import ArtistPicker, { artistKey } from '../ArtistPicker';
import {
  DEFAULT_POINT_COSTS, formatCooldown, normalizeLadderHours,
  GENRE_PRESETS, MOOD_PRESETS, STYLE_PRESETS, getTranslatedValues,
  MODEL_OPTIONS, DEFAULT_LYRICS, WONDERA_MODELS, VOCAL_PRESETS,
  buildPromptPreview, formatDuration, formatDate, isLyricsDraft,
} from './studioShared';
import '../StudioTab2.css';

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
        console.error('[ComposeStudioTab] Poll error:', err);
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
      const taskId = data?.data?.task_id || data?.id;
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
      const taskId = data?.data?.task_id || data?.id;
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
        <label className="wondera-test__label">① 내 목소리 업로드 (mp3, m4a / 15~30초) <span style={{color:'var(--color-text-sub)'}}>— 선택 · '내 목소리로 생성'에만 필수</span></label>
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
        <label className="wondera-test__label">② 가사 <span style={{color:'#e05a5a'}}>*필수</span> & 스타일</label>
        <textarea
          className="wondera-test__textarea"
          value={wLyrics}
          onChange={(e) => setWLyrics(e.target.value)}
          rows={12}
          placeholder="가사를 입력해주세요 (필수)"
        />
        {!wLyrics.trim() && (
          <div style={{color:'#e05a5a', fontSize:'12px', marginTop:'4px'}}>
            가사를 입력해야 생성할 수 있습니다.
          </div>
        )}
        <div className="wondera-test__row">
          <div className="wondera-test__field">
            <label>스타일 프롬프트 (선택)</label>
            <input
              type="text"
              value={wPrompt}
              onChange={(e) => setWPrompt(e.target.value)}
              placeholder="k-pop, ballad, emotional..."
            />
          </div>
          <div className="wondera-test__field">
            <label>모델 (선택 · 기본 auto)</label>
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
            disabled={aiStatus === 'generating' || !wLyrics.trim()}
            title={!wLyrics.trim() ? '가사를 입력해주세요 (필수)' : undefined}
          >
            {aiStatus === 'generating' ? '생성 중...' : '🎵 AI 보컬로 생성'}
          </button>
          <button
            className="wondera-test__btn wondera-test__btn--my"
            onClick={handleGenerateMy}
            disabled={myStatus === 'generating' || !wLyrics.trim() || !vocalId}
            title={!vocalId ? '먼저 ①에서 목소리 파일을 업로드해주세요 (필수)' : (!wLyrics.trim() ? '가사를 입력해주세요 (필수)' : undefined)}
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

// v209 2단계 — 「작곡실」: StudioTab2 의 작곡 계열(파라미터·프리뷰·생성/기록·피로 게이지·간편 모드·Wondera) 이식.
// 작사(구 step1-2)는 LyricsStudioTab(작사실) 소관 — 이 탭은 작사 draft 를 골라 작곡한다.
// props: onSendToUpload(기존 StudioTab2 계약 그대로) / prefillDraft(작사실 [작곡하기→] 인계 draft doc) / onClearPrefill
export default function ComposeStudioTab({ onSendToUpload, prefillDraft, onClearPrefill }) {
  // ─── Mode: 'simple' or 'custom' ───
  const [mode, setMode] = useState('custom');
  const [selectedModel, setSelectedModel] = useState('suno');
  // ─── Voice Clone state (v76 — Suno V5_5 voice cloning) ───
  const [myClones, setMyClones] = useState([]);
  const [selectedVoiceCloneId, setSelectedVoiceCloneId] = useState(null);

  // ─── v213 F2 — 아티스트 선택(접힘형)·연결 목소리 자동 주입 ───
  // 미선택 시 기존 동작 100% 불변 (ArtistPicker autoSelect=false — 여닫기만으로 무변화)
  const [showArtistSection, setShowArtistSection] = useState(false);
  const [composeArtist, setComposeArtist] = useState(null);
  // [기본 보컬] 프리셋을 고르면 아티스트 자동 주입도 함께 해제 (voiceSource 명시 관리 — V4)
  const [artistVoiceMuted, setArtistVoiceMuted] = useState(false);

  // 주입 후보 = 연결 목소리가 ready 이고 Suno voice id(파생 persona_voice_id)가 있을 때만
  const artistVoice = (!artistVoiceMuted
    && composeArtist?.persona_voice_id
    && composeArtist?.persona_status === 'ready')
    ? {
        voiceId: composeArtist.persona_voice_id,
        model: composeArtist.persona_model || 'voice_persona',
        name: composeArtist.persona_name || '연결된 목소리',
      }
    : null;

  // v213 V4 — 목소리 주입 공통 함수 (제출 2경로 공용 — R4 주입 누락 방지).
  // 우선순위: 수동 클론 선택 > 아티스트 자동 > personaModel 토글(body 조립 시 기반영) > 없음.
  const applyVoiceOverride = (body, pathLabel) => {
    if (selectedVoiceCloneId) {
      const clone = myClones.find((c) => (c?.clone_id || c?.id) === selectedVoiceCloneId);
      if (clone?.voice_id) {
        body.persona_id = clone.voice_id;
        body.persona_model = 'voice_persona';
        body.suno_model = 'V5_5';  // v76.10: Suno 내부 모델 변형. provider model 은 'suno' 유지
        if (import.meta.env.DEV) {
          console.info(`[ComposeStudioTab] applying voice_clone override (${pathLabel})`, { clone_id: clone.clone_id || clone.id });
        }
        return;
      }
    }
    if (artistVoice) {
      // 주입 값 = 파생 persona_voice_id (Suno id) — 기존 수동 경로 clone.voice_id 와 동일 결과 (V1 계약)
      body.persona_id = artistVoice.voiceId;
      body.persona_model = artistVoice.model;
      if (artistVoice.model === 'voice_persona') body.suno_model = 'V5_5';
      if (import.meta.env.DEV) {
        console.info(`[ComposeStudioTab] applying artist voice (auto, ${pathLabel})`, { artist: artistKey(composeArtist) });
      }
    }
  };

  // ─── Step state: 3=params, 4=prompt preview (구 StudioTab2 번호 유지 — 1·2(작사)는 작사실로 분리) ───
  const [step, setStep] = useState(3);
  // Simple mode
  const [simplePrompt, setSimplePrompt] = useState('');
  const [simpleSubmitting, setSimpleSubmitting] = useState(false);

  // 작곡 대상 가사·메타 — 작사 draft(handleResumeDraft) 로드로 채워짐
  const [description, setDescription] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [isDuet, setIsDuet] = useState(false);
  const [duetMainGender, setDuetMainGender] = useState('m');
  const [duetMainStyle, setDuetMainStyle] = useState('');
  const [duetSubStyle, setDuetSubStyle] = useState('');
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  // 느낌 카테고리 (가사 생성 결과로 받은 깨끗한 문자열 배열 — 생성/발행 시 관통)
  const [categories, setCategories] = useState([]);

  // Step 3: Music settings
  const [styleText, setStyleText] = useState('');
  const [vocal, setVocal] = useState('');
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [bpm, setBpm] = useState('');
  const [musicalKey, setMusicalKey] = useState('');
  const [duration, setDuration] = useState(60);
  const [referenceText, setReferenceText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Step 3: Reference audio upload (Suno only)
  const [referenceFile, setReferenceFile] = useState(null);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [referenceData, setReferenceData] = useState(null);

  // Step 3: Wondera-specific states
  const [wonderaModel, setWonderaModel] = useState('auto');
  const [wonderaNumber, setWonderaNumber] = useState(2);
  const [wonderaPrompt, setWonderaPrompt] = useState('');
  const [wonderaReferenceData, setWonderaReferenceData] = useState(null);
  const [wonderaVocalData, setWonderaVocalData] = useState(null);
  const [wonderaMelodyData, setWonderaMelodyData] = useState(null);
  const [wonderaEnableStream, setWonderaEnableStream] = useState(false);
  const [wonderaUploading, setWonderaUploading] = useState(null);

  // Suno advanced parameter toggles
  const [negativeTagsOn, setNegativeTagsOn] = useState(false);
  const [negativeTagsVal, setNegativeTagsVal] = useState('');
  const [styleWeightOn, setStyleWeightOn] = useState(false);
  const [styleWeightVal, setStyleWeightVal] = useState('');
  const [weirdnessOn, setWeirdnessOn] = useState(false);
  const [weirdnessVal, setWeirdnessVal] = useState('');
  const [audioWeightOn, setAudioWeightOn] = useState(false);
  const [audioWeightVal, setAudioWeightVal] = useState('');
  const [bpmOn, setBpmOn] = useState(false);
  const [bpmVal, setBpmVal] = useState('');
  const [keyOn, setKeyOn] = useState(false);
  const [keyVal, setKeyVal] = useState('');
  const [personaModelOn, setPersonaModelOn] = useState(false);
  const [personaModelVal, setPersonaModelVal] = useState('style_persona');

  // Draft (임시저장)
  const [draftId, setDraftId] = useState(null);

  // 번역 캐시 state — v209: 작사실 인계 draft 에는 번역 캐시가 없어 초기 [] → 첫 생성 시
  // handleGenerateMusic 의 stale 체크가 재번역 폴백을 타고 이후 캐시 (기존 재번역 경로 그대로)
  const [translatedGenre, setTranslatedGenre] = useState(null);
  const [translatedMood, setTranslatedMood] = useState(null);
  const [translatedStyle, setTranslatedStyle] = useState(null);
  // 번역 시점의 원본 선택값 (stale 체크용)
  const [translatedGenreSource, setTranslatedGenreSource] = useState([]);
  const [translatedMoodSource, setTranslatedMoodSource] = useState([]);
  const [translatedStyleSource, setTranslatedStyleSource] = useState([]);
  const [translatedStyleTextSource, setTranslatedStyleTextSource] = useState('');

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

  // ─── v158: 별 경제 v1.2 + 디렉터 피로 ───
  const [pointCosts, setPointCosts] = useState(DEFAULT_POINT_COSTS);
  const [fatigue, setFatigue] = useState(null); // GET /fatigue/status 응답
  const [fatigueRemainSec, setFatigueRemainSec] = useState(0);
  const [fatigueSkipping, setFatigueSkipping] = useState(null); // 'points' | 'ad' | null
  const [fatigueHighlight, setFatigueHighlight] = useState(false); // 429 시 게이지 강조
  const fatiguePanelRef = useRef(null);
  const fatigueHighlightTimerRef = useRef(null);

  // 가격 단일 소스 로드 — 응답은 { costs: {...} } 래핑 (실패 시 기본값 유지, 표기용이므로 비치명)
  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        const costs = data?.costs;
        if (costs && typeof costs === 'object') {
          setPointCosts((prev) => ({ ...prev, ...costs }));
          if (import.meta.env.DEV) console.info('[ComposeStudioTab] point costs loaded', costs);
        }
      })
      .catch((err) => {
        console.error('[ComposeStudioTab] getPointCosts failed (fallback defaults)', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // 피로 상태 조회 — 마운트 + fetchHistory 10초 폴링 + 429/스킵 후 재조회
  // (참조: 안정 setter + api 뿐 — 의도적으로 useCallback 미사용, fetchHistory 선례와 동일)
  const refreshFatigue = async () => {
    try {
      const { data } = await api.getFatigueStatus();
      setFatigue(data);
      setFatigueRemainSec(Math.max(0, Math.floor(data?.cooldown_remaining_sec ?? 0)));
      if (import.meta.env.DEV) {
        console.info('[ComposeStudioTab] [fatigue-ui] status', {
          today_completed: data?.today_completed,
          cooldown_active: data?.cooldown_active,
          cooldown_remaining_sec: data?.cooldown_remaining_sec,
          skip_wait_count: data?.skip_wait_count,
        });
      }
    } catch (err) {
      console.error('[ComposeStudioTab] [fatigue-ui] getFatigueStatus failed', { status: err?.response?.status, message: err?.message });
    }
  };

  // 쿨다운 1초 카운트다운 — 0 도달 시 서버 상태 재확인(해제 반영)
  useEffect(() => {
    if (fatigueRemainSec <= 0) return undefined;
    const t = setTimeout(() => {
      setFatigueRemainSec((s) => Math.max(0, s - 1));
      if (fatigueRemainSec === 1) refreshFatigue();
    }, 1000);
    return () => clearTimeout(t);
  }, [fatigueRemainSec]);

  // 강조 타이머 언마운트 정리
  useEffect(() => () => {
    if (fatigueHighlightTimerRef.current) clearTimeout(fatigueHighlightTimerRef.current);
  }, []);

  // 쿨다운 스킵 — method: 'points'(⭐) | 'ad'(보유 광고권 skip_wait_count 소비)
  // 성공 200 = status 동일 payload + skipped_minutes (레이스로 0 가능 = 이미 해제)
  const handleFatigueSkip = async (method) => {
    if (fatigueSkipping) return;
    setFatigueSkipping(method);
    try {
      const { data } = await api.skipFatigue(method);
      if (import.meta.env.DEV) console.info('[ComposeStudioTab] [fatigue-ui] skip ok', { method, skipped_minutes: data?.skipped_minutes });
      api.notifyPointsRefresh(); // ⭐/광고권 변동 → 헤더 배지 갱신
      if (data && typeof data === 'object' && 'cooldown_remaining_sec' in data) {
        // 응답이 최신 status payload — 즉시 반영
        setFatigue(data);
        setFatigueRemainSec(Math.max(0, Math.floor(data.cooldown_remaining_sec ?? 0)));
      } else {
        await refreshFatigue();
      }
      if (data?.skipped_minutes === 0) {
        alert('쿨다운이 이미 해제되어 있었어요. 바로 작곡을 지시할 수 있습니다.');
      }
    } catch (err) {
      console.error('[ComposeStudioTab] [fatigue-ui] skip failed', { method, status: err?.response?.status, error: err?.response?.data?.error });
      if (api.isInsufficientPoints(err)) {
        alert(method === 'ad' || err?.response?.data?.error === 'no_skip_tickets'
          ? '사용할 수 있는 광고 시청권이 없어요. 앱에서 광고를 시청하면 충전돼요.'
          : `별이 부족해요. 쿨다운 단축에는 ⭐${fatigue?.skip_point_cost ?? pointCosts.fatigue_skip}개가 필요합니다.`);
      } else if (err?.response?.status === 409) {
        alert('지금은 단축할 쿨다운이 없어요.');
      } else {
        alert(err?.response?.data?.message || err?.response?.data?.error || '쿨다운 단축에 실패했습니다.');
      }
      refreshFatigue();
    } finally {
      setFatigueSkipping(null);
    }
  };

  // 작곡 제출 공통 에러 분기 (BE 순서: 403 스트라이크 → 429 피로 → 402 별 부족).
  // 429/402 를 처리하면 사용자 문구를 반환, 미해당이면 null (호출측 기본 처리).
  const composeErrorMessage = (err) => {
    if (api.isDirectorFatigued(err)) {
      refreshFatigue();
      setFatigueHighlight(true);
      if (fatigueHighlightTimerRef.current) clearTimeout(fatigueHighlightTimerRef.current);
      fatigueHighlightTimerRef.current = setTimeout(() => setFatigueHighlight(false), 4000);
      try { fatiguePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
      const remain = err?.response?.data?.cooldown_remaining_sec;
      const remainText = Number.isFinite(remain) ? ` (남은 휴식 ${formatCooldown(remain)})` : '';
      return `디렉터가 쉬는 중이에요${remainText}. 휴식이 끝나면 새 곡을 지시할 수 있고, 위의 게이지에서 ⭐ 또는 광고권으로 단축할 수 있어요.`;
    }
    if (api.isInsufficientPoints(err)) {
      api.notifyPointsRefresh();
      return `별이 부족해요. 작곡에는 ⭐${pointCosts.compose}개가 필요합니다.`;
    }
    return null;
  };

  // v76 — Fetch voice clones (ready only) for Suno V5_5 cloning
  const fetchVoiceClones = useCallback(async () => {
    if (import.meta.env.DEV) console.info('[ComposeStudioTab] fetching voice clones');
    try {
      const { data } = await api.getVoiceClones();
      const ready = (data?.clones || data?.items || []).filter(
        (c) => c?.status === 'ready' && c?.voice_id
      );
      setMyClones(ready);
      if (import.meta.env.DEV) console.info('[ComposeStudioTab] voice clones loaded', { count: ready.length });
      return ready;
    } catch (err) {
      console.error('[ComposeStudioTab] getVoiceClones failed', { status: err?.response?.status, message: err?.message });
      return [];
    }
  }, []);

  useEffect(() => {
    fetchVoiceClones();
  }, [fetchVoiceClones]);

  useEffect(() => {
    fetchHistory();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // 마운트 1회 의도 — fetchHistory 는 비메모이즈 함수(안정 setter/api 만 참조)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for processing generations
  useEffect(() => {
    const hasProcessing = generations.some((g) =>
      g.status === 'processing' || g.status === 'pending'
    );
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(fetchHistory, 10000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // generations 변화에만 반응하는 폴링 토글 — fetchHistory 는 비메모이즈 함수
  }, [generations]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHistory = async () => {
    setLoadingHistory(true);
    // v158 — 생성 상태 폴링(10초)에 피로 status 갱신 연동 (곡 완성 → 쿨다운 시작 반영)
    refreshFatigue();
    try {
      const { data } = await api.getGenerations({ limit: 50 });
      setGenerations(data.generations || []);
    } catch (err) {
      console.error('[ComposeStudioTab] Failed to fetch generations:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const getCombinedStyle = () => {
    const parts = [];
    if (selectedStyles.length > 0) parts.push(selectedStyles.join(', '));
    if (styleText.trim()) parts.push(styleText.trim());
    return parts.join(', ') || null;
  };

  const getPreviewLyrics = () => {
    if (!lyrics.trim()) return null;
    const lyricsLines = lyrics.trim().split('\n');
    const preview = lyricsLines.slice(0, 4).join('\n');
    if (lyricsLines.length > 4) {
      return `${preview}\n... (총 ${lyricsLines.length}줄)`;
    }
    return preview;
  };

  // ─── Reference Audio Upload (Suno only) ───
  const handleReferenceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      setError('오디오 파일만 업로드할 수 있습니다.');
      return;
    }

    // Validate duration (max 8 minutes = 480 seconds)
    setReferenceFile(file);
    setReferenceUploading(true);
    setError('');

    try {
      const { data } = await api.uploadReferenceAudio(file);
      if (data.duration_sec > 480) {
        setError('참고 음악은 최대 8분까지 업로드할 수 있습니다.');
        setReferenceFile(null);
        setReferenceUploading(false);
        return;
      }
      setReferenceData(data);
    } catch (err) {
      setError(err.response?.data?.error || '참고 음악 업로드에 실패했습니다.');
      setReferenceFile(null);
    } finally {
      setReferenceUploading(false);
    }
  };

  const handleReferenceRemove = () => {
    setReferenceFile(null);
    setReferenceData(null);
  };

  // ─── Wondera File Upload Handler ───
  const handleWonderaFileUpload = async (file, purpose) => {
    setWonderaUploading(purpose);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', purpose);
      const { data } = await api.uploadWonderaFile(formData);
      const fileData = data.data || data;
      if (purpose === 'reference') setWonderaReferenceData(fileData);
      else if (purpose === 'vocal') setWonderaVocalData(fileData);
      else if (purpose === 'melody') setWonderaMelodyData(fileData);
    } catch (err) {
      setError(err.response?.data?.error || '파일 업로드 실패');
    } finally {
      setWonderaUploading(null);
    }
  };

  // ─── Step 3: Generate Music ───
  const handleGenerateMusic = async () => {
    setError('');
    setSuccessMsg('');
    setSubmitting(true);

    try {
      // 캐시된 번역값 사용 (Suno 경로). 선택값이 변경됐으면 재번역.
      let genreStr, moodStr, styleStr;
      if (selectedModel !== 'wondera') {
        const genreChanged = JSON.stringify(selectedGenres) !== JSON.stringify(translatedGenreSource);
        const moodChanged = JSON.stringify(selectedMoods) !== JSON.stringify(translatedMoodSource);
        const styleChanged = JSON.stringify(selectedStyles) !== JSON.stringify(translatedStyleSource) || styleText !== translatedStyleTextSource;

        if (genreChanged || moodChanged || styleChanged) {
          // 선택값이 변경됐으므로 재번역
          const [g, m, ts] = await Promise.all([
            getTranslatedValues(selectedGenres, GENRE_PRESETS),
            getTranslatedValues(selectedMoods, MOOD_PRESETS),
            getTranslatedValues(selectedStyles, STYLE_PRESETS),
          ]);
          genreStr = g;
          moodStr = m;
          const styleParts = [];
          if (ts) styleParts.push(ts);
          if (styleText.trim()) styleParts.push(styleText.trim());
          styleStr = styleParts.join(', ') || null;

          setTranslatedGenre(genreStr);
          setTranslatedMood(moodStr);
          setTranslatedStyle(styleStr);
          setTranslatedGenreSource([...selectedGenres]);
          setTranslatedMoodSource([...selectedMoods]);
          setTranslatedStyleSource([...selectedStyles]);
          setTranslatedStyleTextSource(styleText);
        } else {
          // 캐시된 번역값 사용
          genreStr = translatedGenre;
          moodStr = translatedMood;
          styleStr = translatedStyle;
        }
      }

      if (selectedModel === 'wondera') {
        // Wondera path
        const wonderaBody = {
          lyrics: lyrics.trim(),
          model: wonderaModel,
          number: wonderaNumber,
        };
        if (wonderaPrompt.trim() && !wonderaReferenceData && !wonderaMelodyData) {
          wonderaBody.prompt = wonderaPrompt.trim();
        }
        if (wonderaReferenceData) wonderaBody.reference_id = wonderaReferenceData.id;
        if (wonderaVocalData) wonderaBody.vocal_id = wonderaVocalData.id;
        if (wonderaMelodyData) wonderaBody.melody_id = wonderaMelodyData.id;
        if (wonderaEnableStream) wonderaBody.enable_stream = true;
        if (title.trim()) wonderaBody.title = title.trim();

        await api.generateWonderaSong(wonderaBody);
        setSuccessMsg('Wondera 음악 생성이 시작되었습니다! 완료까지 시간이 소요됩니다.');

        // Reset wondera states
        setWonderaModel('auto');
        setWonderaNumber(2);
        setWonderaPrompt('');
        setWonderaReferenceData(null);
        setWonderaVocalData(null);
        setWonderaMelodyData(null);
        setWonderaEnableStream(false);
      } else if (draftId) {
        // v214 T2 — 가사 출처 스냅샷: draft 삭제 직전 캡처 (문서는 죽고 스냅샷은 산다).
        // 작사실 AI 작사·직접 작성 모두 draft 경유라 이 분기 하나로 커버 — 발매 시 track.lyrics_id 로 동결.
        const lyricsSource = { lyrics_id: draftId, title: title.trim() || null, is_mine: true };
        if (import.meta.env.DEV) console.info('[ComposeStudioTab] lyrics_source captured', { lyrics_id: draftId });
        // 임시저장된 draft 삭제 후 최신 파라미터로 새로 생성
        await api.deleteGeneration(draftId).catch(() => {});
        setDraftId(null);
        const body = {
          lyrics_source: lyricsSource,
          prompt: description.trim(),
          title: title.trim() || null,
          lyrics: lyrics.trim(),
          genre: genreStr,
          mood: moodStr,
          style: styleStr,
          vocal: isDuet ? duetMainGender : (isInstrumental ? 'instrumental' : vocal || null),
          duration,
          bpm: bpmOn ? parseInt(bpmVal) || null : (bpm ? parseInt(bpm) : null),
          key: keyOn ? keyVal || null : (musicalKey || null),
          reference_style: referenceText.trim() || null,
          start_music_gen: true,
          model: selectedModel,
          negative_tags: negativeTagsOn ? negativeTagsVal.trim() || null : null,
          style_weight: styleWeightOn ? parseFloat(styleWeightVal) || null : null,
          weirdness: weirdnessOn ? parseFloat(weirdnessVal) || null : null,
          audio_weight: audioWeightOn ? parseFloat(audioWeightVal) || null : null,
          persona_model: personaModelOn ? personaModelVal || null : null,
          reference_audio_url: referenceData?.upload_url || null,
          reference_audio_name: referenceData?.filename || null,
          reference_audio_duration: referenceData?.duration_sec || null,
          duet_main_vocal_style: isDuet ? duetMainStyle.trim() || null : null,
          duet_sub_vocal_style: isDuet ? duetSubStyle.trim() || null : null,
          categories: Array.isArray(categories) ? categories : [],
        };
        // v213 V4 — 목소리 주입 공통 함수 (수동 클론 > 아티스트 자동 > 토글)
        applyVoiceOverride(body, 'draft path');
        await api.createGeneration(body);
        setSuccessMsg('음악 생성이 시작되었습니다! 완료까지 시간이 소요됩니다.');
      } else {
        // Suno path — v214: draftId 없음 = 이 화면에서 직접 입력한 가사 → lyrics_source 미동봉
        // (출처 표기 생략이 정직 — PLAN T2. 작사실 경유 가사는 위 draft 분기가 항상 담당)
        const body = {
          prompt: description.trim(),
          title: title.trim() || null,
          lyrics: lyrics.trim(),
          genre: genreStr,
          mood: moodStr,
          style: styleStr,
          vocal: isDuet ? duetMainGender : (isInstrumental ? 'instrumental' : vocal || null),
          duration,
          bpm: bpmOn ? parseInt(bpmVal) || null : (bpm ? parseInt(bpm) : null),
          key: keyOn ? keyVal || null : (musicalKey || null),
          reference_style: referenceText.trim() || null,
          start_music_gen: true,
          model: selectedModel,
          negative_tags: negativeTagsOn ? negativeTagsVal.trim() || null : null,
          style_weight: styleWeightOn ? parseFloat(styleWeightVal) || null : null,
          weirdness: weirdnessOn ? parseFloat(weirdnessVal) || null : null,
          audio_weight: audioWeightOn ? parseFloat(audioWeightVal) || null : null,
          persona_model: personaModelOn ? personaModelVal || null : null,
          reference_audio_url: referenceData?.upload_url || null,
          reference_audio_name: referenceData?.filename || null,
          reference_audio_duration: referenceData?.duration_sec || null,
          duet_main_vocal_style: isDuet ? duetMainStyle.trim() || null : null,
          duet_sub_vocal_style: isDuet ? duetSubStyle.trim() || null : null,
          categories: Array.isArray(categories) ? categories : [],
        };

        // v213 V4 — 목소리 주입 공통 함수 (수동 클론 > 아티스트 자동 > 토글)
        applyVoiceOverride(body, 'suno path');

        await api.createGeneration(body);
        setSuccessMsg('음악 생성이 시작되었습니다! 완료까지 시간이 소요됩니다.');
      }

      // Common reset
      setDraftId(null);
      setStep(3);  // v209: 가사 상태 초기화로 lyricsLoaded=false → 작사 선택 화면 복귀
      setDescription('');
      setTitle('');
      setLyrics('');
      setCategories([]);
      setSelectedGenres([]);
      setSelectedMoods([]);
      setSelectedStyles([]);
      setIsDuet(false);
      setDuetMainGender('m');
      setDuetMainStyle('');
      setDuetSubStyle('');
      setStyleText('');
      setVocal('');
      setIsInstrumental(false);
      setBpm('');
      setMusicalKey('');
      setReferenceText('');
      setNegativeTagsOn(false);
      setNegativeTagsVal('');
      setStyleWeightOn(false);
      setStyleWeightVal('');
      setWeirdnessOn(false);
      setWeirdnessVal('');
      setAudioWeightOn(false);
      setAudioWeightVal('');
      setBpmOn(false);
      setBpmVal('');
      setKeyOn(false);
      setKeyVal('');
      setPersonaModelOn(false);
      setPersonaModelVal('style_persona');
      setReferenceFile(null);
      setReferenceData(null);
      setTranslatedGenre(null);
      setTranslatedMood(null);
      setTranslatedStyle(null);
      setTranslatedGenreSource([]);
      setTranslatedMoodSource([]);
      setTranslatedStyleSource([]);
      setTranslatedStyleTextSource('');
      // v158 — 작곡 ⭐-15 차감 반영 (wondera 는 무과금 테스트 경로)
      if (selectedModel !== 'wondera') api.notifyPointsRefresh();
      fetchHistory();
    } catch (err) {
      // v139 — 스트라이크 생성 제한 403 공통 처리 → v158 — 429(피로)/402(별 부족) 분기
      if (api.isGenerationRestricted(err)) api.alertGenerationRestricted(err);
      else {
        const starMsg = composeErrorMessage(err);
        setError(starMsg || err.response?.data?.error || '요청에 실패했습니다.');
      }
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
      api.notifyPointsRefresh(); // v158 — 재시도도 작곡 ⭐-15 차감
      fetchHistory();
    } catch (err) {
      // v158 — 403(스트라이크) → 429(피로) → 402(별 부족) 분기
      if (api.isGenerationRestricted(err)) { api.alertGenerationRestricted(err); return; }
      const starMsg = composeErrorMessage(err);
      alert(starMsg || err.response?.data?.error || '재시도에 실패했습니다.');
    }
  };

  // ─── Draft 판별 — v209: 서버 확정 시그니처(point_ref) 기반 studioShared.isLyricsDraft 로 교체 ───
  const isDraft = isLyricsDraft;

  // ─── 이어서 작업: draft → Step 3 복원 ───
  const handleResumeDraft = (gen) => {
    setDescription(gen.prompt || '');
    setTitle(gen.title || '');
    setLyrics(gen.lyrics || '');
    setSelectedGenres(gen.genre ? gen.genre.split(', ').filter(Boolean) : []);
    setSelectedMoods(gen.mood ? gen.mood.split(', ').filter(Boolean) : []);
    setStyleText(gen.style || '');
    setVocal(gen.vocal || '');
    setSelectedModel(gen.model || 'suno');
    setCategories(Array.isArray(gen.categories) ? gen.categories : []);
    // v209 3단계: duet 복원 — 작사실 draft 의 duet 플래그가 vocal 산정(듀엣 시 주 보컬 성별)에 반영되도록
    setIsDuet(gen.duet ?? false);
    setDuetMainStyle(gen.duet_main_vocal_style || '');
    setDuetSubStyle(gen.duet_sub_vocal_style || '');
    setDraftId(gen.id);
    setError('');
    setSuccessMsg('');
    setStep(3);
  };

  // v209 — 작사실 [작곡하기 →] 인계 수신: draft doc 을 파라미터 단계로 복원 (기존 handleResumeDraft 재사용).
  useEffect(() => {
    if (prefillDraft) {
      handleResumeDraft(prefillDraft);
      setMode('custom');
      if (import.meta.env.DEV) console.info('[ComposeStudioTab] prefill draft received', { id: prefillDraft.id });
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefillDraft]);  // eslint-disable-line react-hooks/exhaustive-deps

  // v209 — 로드된 가사 해제 → 작사 선택 화면으로
  const handleUnloadDraft = () => {
    setDraftId(null);
    setDescription('');
    setTitle('');
    setLyrics('');
    setCategories([]);
    setSelectedGenres([]);
    setSelectedMoods([]);
    setSelectedStyles([]);
    setStyleText('');
    setVocal('');
    setError('');
    setSuccessMsg('');
    setStep(3);
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

      // Step 2: Submit music generation with lyrics (느낌 카테고리 관통)
      await api.createGeneration({
        prompt: simplePrompt.trim(),
        title: lyricsData.title || null,
        lyrics: lyricsData.lyrics || '',
        start_music_gen: true,
        duration: 30,
        model: selectedModel,
        categories: Array.isArray(lyricsData.categories) ? lyricsData.categories : [],
      });

      setSuccessMsg('가사가 자동 생성되었고, 음악 생성이 시작되었습니다!');
      setSimplePrompt('');
      api.notifyPointsRefresh(); // v158 — 작사 ⭐-5 + 작곡 ⭐-15 차감 반영
      fetchHistory();
    } catch (err) {
      // v139 — 스트라이크 생성 제한 403 공통 처리 → v158 — 429(피로)/402(별 부족) 분기
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
      } else if (api.isInsufficientPoints(err) && String(err?.config?.url || '').includes('/lyrics')) {
        // 1단계(작사) 402 — 작곡이 아니라 작사 비용 안내
        api.notifyPointsRefresh();
        setError(`별이 부족해요. AI 작사에는 ⭐${pointCosts.lyrics}개가 필요합니다.`);
      } else {
        const starMsg = composeErrorMessage(err);
        setError(starMsg || err.response?.data?.error || '생성에 실패했습니다.');
      }
    } finally {
      setSimpleSubmitting(false);
    }
  };

  // ─── Build stream URL (proxied through backend) ───
  // v74 — variantIndex (0 = first clip, BC; >=1 = second clip)
  const getStreamUrl = (genId, variantIndex = 0) => {
    return api.generationStreamUrl(genId, variantIndex);
  };

  // v74 — composite key so each variant tracks playback independently
  const playKey = (genId, variantIndex = 0) => `${genId}__${variantIndex}`;

  // ─── Play generated audio ───
  const handlePlayGeneration = (genId, variantIndex = 0) => {
    const key = playKey(genId, variantIndex);
    if (import.meta.env.DEV) {
      console.info('[ComposeStudioTab] play', { genId, variantIndex, key, currentlyPlaying: playingId });
    }

    // If already playing this one, pause it
    if (playingId === key && genAudioRef.current) {
      genAudioRef.current.pause();
      setPlayingId(null);
      return;
    }

    // Stop previous audio
    if (genAudioRef.current) {
      genAudioRef.current.pause();
    }

    const audio = new Audio(getStreamUrl(genId, variantIndex));
    audio.onended = () => setPlayingId(null);
    audio.onerror = (e) => {
      console.error('[ComposeStudioTab] audio play failed', { genId, variantIndex, err: e });
      setPlayingId(null);
      alert('오디오 재생에 실패했습니다.');
    };
    genAudioRef.current = audio;
    setPlayingId(key);
    audio.play();
  };

  // ─── Download generated audio ───
  const handleDownloadGeneration = (genId, _titleOrVariant, variantIndex = 0) => {
    // v74 — accept either (genId, title, variantIndex) or (genId, variantIndex)
    // Old callers passed (genId, title). New callers add variantIndex.
    let vi = variantIndex;
    if (typeof _titleOrVariant === 'number' && variantIndex === 0) {
      vi = _titleOrVariant;
    }
    if (import.meta.env.DEV) {
      console.info('[ComposeStudioTab] download', { genId, variantIndex: vi });
    }
    window.location.href = getStreamUrl(genId, vi);
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

  const statusLabel = (status, gen) => {
    if (gen && isDraft(gen)) return '📝 임시저장 (가사)';
    switch (status) {
      case 'pending': return '대기 중';
      case 'processing': return '생성 중';
      case 'completed': return '완료';
      case 'failed': return '실패';
      default: return status;
    }
  };

  // ─── v158: 디렉터 피로 게이지 (작곡 스텝 공통 — 상태 투명 표시, 다크패턴 금지) ───
  const renderFatiguePanel = () => {
    if (!fatigue) return null;
    const completed = Math.max(0, Number(fatigue.today_completed) || 0);
    const ladderHours = normalizeLadderHours(fatigue.ladder);
    const coolingDown = fatigueRemainSec > 0 && (fatigue.cooldown_active ?? !!fatigue.cooldown_until);
    const skipCost = fatigue.skip_point_cost ?? pointCosts.fatigue_skip;
    const skipMinutes = fatigue.skip_minutes ?? 30;
    const adSkips = Math.max(0, Number(fatigue.skip_wait_count) || 0);
    return (
      <div
        ref={fatiguePanelRef}
        className={`s2__fatigue ${fatigueHighlight ? 's2__fatigue--highlight' : ''}`}
      >
        <div className="s2__fatigue-header">
          <span className="s2__fatigue-title"><FiClock /> 디렉터 컨디션</span>
          <span className="s2__fatigue-count">오늘 완성 {completed}곡</span>
        </div>
        {/* 사다리 시각화 — n곡째 완성 시 휴식 시간 (자정에 리셋) */}
        <div className="s2__fatigue-ladder">
          {ladderHours.map((h, i) => {
            const isLast = i === ladderHours.length - 1;
            const done = isLast ? completed >= i + 1 : completed === i + 1;
            const reached = completed >= i + 1;
            return (
              <div
                key={`rung-${i}`}
                className={`s2__fatigue-rung ${reached ? 's2__fatigue-rung--reached' : ''} ${done ? 's2__fatigue-rung--current' : ''}`}
              >
                <span className="s2__fatigue-rung-num">{i + 1}곡{isLast ? '+' : ''}째</span>
                <span className="s2__fatigue-rung-hours">휴식 {h}시간</span>
              </div>
            );
          })}
        </div>
        {coolingDown ? (
          <>
            <div className="s2__fatigue-cooldown">
              디렉터가 쉬는 중이에요 — <strong className="s2__fatigue-timer">{formatCooldown(fatigueRemainSec)}</strong> 후에 새 작곡을 지시할 수 있어요.
            </div>
            <div className="s2__fatigue-skip-row">
              <button
                type="button"
                className="s2__fatigue-skip-btn"
                onClick={() => handleFatigueSkip('points')}
                disabled={fatigueSkipping !== null}
              >
                {fatigueSkipping === 'points'
                  ? <><FiLoader className="s2__spin" /> 단축 중...</>
                  : <>⭐{skipCost}로 {skipMinutes}분 단축</>}
              </button>
              <button
                type="button"
                className="s2__fatigue-skip-btn"
                onClick={() => handleFatigueSkip('ad')}
                disabled={fatigueSkipping !== null || adSkips <= 0}
              >
                {fatigueSkipping === 'ad'
                  ? <><FiLoader className="s2__spin" /> 사용 중...</>
                  : <>광고권으로 {skipMinutes}분 단축 (보유 {adSkips}장)</>}
              </button>
            </div>
            <div className="s2__fatigue-note">
              광고 시청은 앱에서 할 수 있어요 — 보유한 광고권은 여기서 바로 사용할 수 있습니다.
            </div>
          </>
        ) : (
          <div className="s2__fatigue-ready">
            지금 바로 작곡을 지시할 수 있어요. 곡이 완성될 때마다 디렉터의 휴식 시간이 위 사다리만큼 늘어나요. (매일 자정 리셋)
          </div>
        )}
      </div>
    );
  };

  // v209 — 작사 draft(선택 화면용) / 생성 기록(작사 draft 제외 — 작사실 소관) 분리
  const lyricsDrafts = generations.filter((g) => isLyricsDraft(g));
  const historyGenerations = generations.filter((g) => !isLyricsDraft(g));
  const lyricsLoaded = !!draftId || !!lyrics.trim();

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

          {/* v158 — 디렉터 피로 게이지 (작곡 스텝) */}
          {renderFatiguePanel()}

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
              <><FiMusic /> 음악 생성하기 <span className="s2__cost-badge">⭐{pointCosts.lyrics + pointCosts.compose}</span></>
            )}
          </button>
          <div className="s2__note">
            {`ChatGPT가 가사를 자동 생성하고, Suno AI가 음악을 만듭니다. (작사 ⭐${pointCosts.lyrics} + 작곡 ⭐${pointCosts.compose})`}
          </div>
        </div>
      )}

      {/* ─── Custom Mode: 작사 선택 → 파라미터(3) → 프리뷰(4) — v209 ─── */}
      {mode === 'custom' && !lyricsLoaded && (
        <div className="s2__form">
          <div className="s2__section">
            <label className="s2__main-label">
              <FiEdit3 className="s2__label-icon" />
              작곡할 가사 선택
            </label>
            <p className="s2__hint">작사실에서 저장한 「내 작사」 중 하나를 골라 작곡을 시작하세요. 새 가사는 작사실 탭에서 만들 수 있어요.</p>
          </div>
          {loadingHistory && lyricsDrafts.length === 0 ? (
            <div className="s2__history-empty">로딩 중...</div>
          ) : lyricsDrafts.length === 0 ? (
            <div className="s2__history-empty">아직 저장된 작사가 없습니다. 작사실에서 가사를 만들어 [작곡하기 →]를 눌러주세요.</div>
          ) : (
            <div className="s2__history-list">
              {lyricsDrafts.map((gen) => (
                <div key={gen.id} className="s2__gen-card">
                  <div className="s2__gen-top">
                    <div className="s2__gen-info">
                      {gen.title && <div className="s2__gen-title">{gen.title}</div>}
                      <div className="s2__gen-prompt">{gen.prompt}</div>
                    </div>
                    <span className="s2__gen-status s2__draft-badge">📝 내 작사</span>
                  </div>
                  <div className="s2__gen-meta">
                    {gen.genre && <span className="s2__gen-tag">{gen.genre}</span>}
                    {gen.mood && <span className="s2__gen-tag">{gen.mood}</span>}
                    {gen.style && <span className="s2__gen-tag s2__gen-tag--style">{gen.style}</span>}
                  </div>
                  <div className="s2__gen-player">
                    <button
                      className="s2__draft-resume"
                      onClick={() => {
                        if (import.meta.env.DEV) console.info('[ComposeStudioTab] draft selected', { id: gen.id });
                        handleResumeDraft(gen);
                      }}
                    >
                      <FiMusic /> 이 가사로 작곡
                    </button>
                  </div>
                  <div className="s2__gen-bottom">
                    <span className="s2__gen-date">{formatDate(gen.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'custom' && lyricsLoaded && (<>
      <div className="s2__steps">
        <div className={`s2__step ${step >= 3 ? 's2__step--active' : ''} ${step > 3 ? 's2__step--done' : ''}`}>
          <span className="s2__step-num">1</span>
          <span className="s2__step-label">파라미터 설정</span>
        </div>
        <div className="s2__step-line" />
        <div className={`s2__step ${step >= 4 ? 's2__step--active' : ''}`}>
          <span className="s2__step-num">2</span>
          <span className="s2__step-label">프롬프트 확인</span>
        </div>
      </div>

      {/* ─── Step 3: Music Generation Settings ─── */}
      {step === 3 && (
        <div className="s2__form">
          {/* v158 — 디렉터 피로 게이지 (작곡 스텝) */}
          {renderFatiguePanel()}

          {/* Preview confirmed lyrics */}
          <div className="s2__preview">
            <div className="s2__preview-header">
              <h3 className="s2__preview-title">{title || '무제'}</h3>
              <span className="s2__hint">{/* v209: 가사 수정은 작사실 탭에서 */}가사 수정은 작사실에서</span>
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
                    className={`s2__vocal-btn ${vocal === v.value && !selectedVoiceCloneId ? 's2__vocal-btn--active' : ''}`}
                    onClick={() => { setVocal(v.value); setSelectedVoiceCloneId(null); setArtistVoiceMuted(true); /* v213: 프리셋 선택 = 아티스트 자동 주입 해제 */ }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {/* v76 — My Voice (Voice Clone, Suno V5_5) */}
              {selectedModel === 'suno' && myClones.length > 0 && (
                <div className="s2__persona-section">
                  <label className="s2__label s2__label--persona">
                    <FiMic className="s2__label-icon--inline" />
                    내 목소리 (보이스 클론 · V5_5)
                  </label>
                  <div className="s2__vocal-grid">
                    {myClones.map((c) => {
                      const cid = c?.clone_id || c?.id;
                      return (
                        <button
                          key={cid}
                          type="button"
                          className={`s2__vocal-btn s2__vocal-btn--persona ${selectedVoiceCloneId === cid ? 's2__vocal-btn--active' : ''}`}
                          onClick={() => {
                            if (import.meta.env.DEV) console.info('[ComposeStudioTab] voice clone selected', { clone_id: cid });
                            setSelectedVoiceCloneId(cid);
                            setVocal('');
                          }}
                          title={c.description || ''}
                        >
                          <FiMic style={{ marginRight: 4 }} />
                          {c.voice_name || c.name || '이름 없음'}
                        </button>
                      );
                    })}
                  </div>
                  {selectedVoiceCloneId && (
                    <div className="s2__persona-note">
                      내 보이스 클론이 선택되었습니다. Suno V5_5 가 이 목소리로 노래합니다.
                    </div>
                  )}
                </div>
              )}

              {/* ─── v213 F2 — 아티스트로 작곡 (접힘형 — 미선택 시 기존 동작 불변) ─── */}
              <div className="s2__persona-section">
                <button
                  type="button"
                  className="s2__advanced-toggle"
                  onClick={() => setShowArtistSection(!showArtistSection)}
                >
                  🎤 아티스트로 작곡{composeArtist ? ` — ${composeArtist.name || (composeArtist.kind === 'virtual' ? '가상 아티스트' : '실사 아티스트')}` : ' (선택)'} {showArtistSection ? <FiChevronUp /> : <FiChevronDown />}
                </button>
                {showArtistSection && (
                  <>
                    <ArtistPicker
                      autoSelect={false}
                      selectedKey={artistKey(composeArtist)}
                      onChange={(a) => {
                        setComposeArtist(a);
                        setArtistVoiceMuted(false);
                        if (import.meta.env.DEV) console.info('[ComposeStudioTab] artist selected', { key: artistKey(a), has_voice: !!a?.persona_voice_id });
                      }}
                      emptyHint="등록된 아티스트가 없습니다. 마이뮤직 → 내 캐릭터 탭에서 만들 수 있어요."
                    />
                    {composeArtist && (
                      <button
                        type="button"
                        className="s2__vocal-btn"
                        style={{ marginTop: '6px' }}
                        onClick={() => { setComposeArtist(null); setArtistVoiceMuted(false); }}
                      >
                        아티스트 선택 해제
                      </button>
                    )}
                  </>
                )}
                {/* 안내 — 우선순위 반영: 수동 클론 선택이 있으면 수동이 우선 */}
                {selectedVoiceCloneId && composeArtist && (
                  <div className="s2__persona-note">
                    수동으로 고른 보이스 클론이 우선 적용됩니다 (아티스트 목소리 자동 주입은 무시).
                  </div>
                )}
                {!selectedVoiceCloneId && artistVoice && (
                  <div className="s2__persona-note">
                    🎤 「{artistVoice.name}」로 작곡됩니다 (자동)
                  </div>
                )}
                {!selectedVoiceCloneId && composeArtist && !artistVoice && !artistVoiceMuted && (
                  <div className="s2__persona-note" style={{ opacity: 0.75 }}>
                    이 아티스트에는 연결된 목소리가 없어요 — 내 캐릭터 탭에서 연결할 수 있습니다.
                  </div>
                )}
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

          {/* ─── Suno Advanced Parameters ─── */}
          {selectedModel === 'suno' && (
            <div className="studio2__suno-params">
              <h4 className="studio2__suno-params-title">Suno 상세 파라미터</h4>

              {/* 제외 스타일 */}
              <div className={`studio2__param-row ${!negativeTagsOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">제외 스타일</span>
                    <p className="studio2__param-desc">원하지 않는 스타일을 입력하면 해당 요소를 배제합니다</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={negativeTagsOn} onChange={(e) => setNegativeTagsOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <input
                  className="studio2__param-input"
                  type="text"
                  disabled={!negativeTagsOn}
                  value={negativeTagsVal}
                  onChange={(e) => setNegativeTagsVal(e.target.value)}
                  placeholder="헤비메탈, 시끄러운 드럼, 디스토션 기타"
                />
              </div>

              {/* 스타일 강도 */}
              <div className={`studio2__param-row ${!styleWeightOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">스타일 강도</span>
                    <p className="studio2__param-desc">지정한 장르/분위기를 얼마나 엄격히 따를지 (0=자유, 1=엄격)</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={styleWeightOn} onChange={(e) => setStyleWeightOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <input
                  className="studio2__param-input"
                  type="number"
                  min="0" max="1" step="0.1"
                  disabled={!styleWeightOn}
                  value={styleWeightVal}
                  onChange={(e) => setStyleWeightVal(e.target.value)}
                  placeholder="0.5"
                />
              </div>

              {/* 실험성 조절 */}
              <div className={`studio2__param-row ${!weirdnessOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">실험성 조절</span>
                    <p className="studio2__param-desc">0에 가까울수록 대중적, 1에 가까울수록 독특하고 실험적</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={weirdnessOn} onChange={(e) => setWeirdnessOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <input
                  className="studio2__param-input"
                  type="number"
                  min="0" max="1" step="0.1"
                  disabled={!weirdnessOn}
                  value={weirdnessVal}
                  onChange={(e) => setWeirdnessVal(e.target.value)}
                  placeholder="0.3"
                />
              </div>

              {/* 오디오 영향도 */}
              <div className={`studio2__param-row ${!audioWeightOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">오디오 영향도</span>
                    <p className="studio2__param-desc">참조 오디오가 결과물에 미치는 영향 (0=무시, 1=강하게 반영)</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={audioWeightOn} onChange={(e) => setAudioWeightOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <input
                  className="studio2__param-input"
                  type="number"
                  min="0" max="1" step="0.1"
                  disabled={!audioWeightOn}
                  value={audioWeightVal}
                  onChange={(e) => setAudioWeightVal(e.target.value)}
                  placeholder="0.5"
                />
              </div>

              {/* BPM */}
              <div className={`studio2__param-row ${!bpmOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">BPM</span>
                    <p className="studio2__param-desc">곡의 빠르기 (60=느린 발라드, 120=보통, 180=빠른 댄스)</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={bpmOn} onChange={(e) => setBpmOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <input
                  className="studio2__param-input"
                  type="number"
                  min="40" max="240"
                  disabled={!bpmOn}
                  value={bpmVal}
                  onChange={(e) => setBpmVal(e.target.value)}
                  placeholder="120"
                />
              </div>

              {/* Key (조성) */}
              <div className={`studio2__param-row ${!keyOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">Key (조성)</span>
                    <p className="studio2__param-desc">곡의 음악적 키 (major=밝은 느낌, minor=어두운 느낌)</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={keyOn} onChange={(e) => setKeyOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <input
                  className="studio2__param-input"
                  type="text"
                  disabled={!keyOn}
                  value={keyVal}
                  onChange={(e) => setKeyVal(e.target.value)}
                  placeholder="F minor"
                />
              </div>

              {/* 페르소나 타입 */}
              <div className={`studio2__param-row ${!personaModelOn ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">페르소나 타입</span>
                    <p className="studio2__param-desc">style=스타일만 참고, voice=목소리까지 참고</p>
                  </div>
                  <label className="studio2__toggle">
                    <input type="checkbox" checked={personaModelOn} onChange={(e) => setPersonaModelOn(e.target.checked)} />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
                <select
                  className="studio2__param-input"
                  disabled={!personaModelOn}
                  value={personaModelVal}
                  onChange={(e) => setPersonaModelVal(e.target.value)}
                >
                  <option value="style_persona">Style Persona (스타일만)</option>
                  <option value="voice_persona">Voice Persona (목소리까지)</option>
                </select>
              </div>

              {/* 준비 중인 기능 */}
              <div className="studio2__locked-features">
                <h4 className="studio2__locked-title">준비 중인 기능 (API 지원 대기)</h4>

                <div className="studio2__locked-item">
                  <span className="studio2__locked-icon">🔒</span>
                  <div>
                    <span className="studio2__locked-name">보이스 클로닝</span>
                    <p className="studio2__locked-desc">내 목소리를 녹음/업로드하여 그 목소리로 노래를 생성합니다</p>
                    <span className="studio2__locked-badge">비공식 API 지원 대기 중</span>
                  </div>
                </div>

                <div className="studio2__locked-item">
                  <span className="studio2__locked-icon">🔒</span>
                  <div>
                    <span className="studio2__locked-name">커스텀 모델 학습</span>
                    <p className="studio2__locked-desc">내 곡 6개 이상을 학습시켜 나만의 AI 모델을 만듭니다 (최대 3개)</p>
                    <span className="studio2__locked-badge">비공식 API 지원 대기 중</span>
                  </div>
                </div>

                <div className="studio2__locked-item">
                  <span className="studio2__locked-icon">🔒</span>
                  <div>
                    <span className="studio2__locked-name">My Taste</span>
                    <p className="studio2__locked-desc">AI가 내 취향을 학습해서 점점 더 맞는 곡을 생성합니다</p>
                    <span className="studio2__locked-badge">비공식 API 지원 대기 중</span>
                  </div>
                </div>

                <div className="studio2__locked-item">
                  <span className="studio2__locked-icon">🔒</span>
                  <div>
                    <span className="studio2__locked-name">MIDI 변환</span>
                    <p className="studio2__locked-desc">생성된 오디오를 MIDI 파일로 변환하여 DAW에서 편집 가능</p>
                    <span className="studio2__locked-badge">비공식 API 지원 대기 중</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Reference Audio Upload (Suno only) ─── */}
          {selectedModel === 'suno' && (
            <div className="s2__section s2__reference">
              <label className="s2__main-label">
                <FiMusic className="s2__label-icon" />
                참고 음악 (선택사항)
              </label>
              {referenceData ? (
                <div className="s2__reference-info">
                  <div className="s2__reference-file">
                    <span className="s2__reference-icon">🎵</span>
                    <div className="s2__reference-details">
                      <span className="s2__reference-name">{referenceData.filename}</span>
                      <span className="s2__reference-duration">{formatDuration(referenceData.duration_sec)}</span>
                    </div>
                    <button
                      type="button"
                      className="s2__reference-delete"
                      onClick={handleReferenceRemove}
                    >
                      <FiTrash2 /> 삭제
                    </button>
                  </div>
                </div>
              ) : (
                <div className="s2__reference-upload">
                  <label className="s2__reference-btn">
                    {referenceUploading ? (
                      <><FiLoader className="s2__spin" /> 업로드 중...</>
                    ) : (
                      <><FiUploadCloud /> 파일 선택 (최대 8분)</>
                    )}
                    <input
                      type="file"
                      accept="audio/*"
                      style={{ display: 'none' }}
                      onChange={handleReferenceUpload}
                      disabled={referenceUploading}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* ─── Wondera Parameters ─── */}
          {selectedModel === 'wondera' && (
            <div className="studio2__wondera-params">
              <h4 className="studio2__wondera-params-title">Wondera 파라미터</h4>

              {/* 모델 버전 */}
              <div className="studio2__param-row">
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">모델 버전</span>
                    <p className="studio2__param-desc">사용할 Wondera 모델 버전을 선택합니다</p>
                  </div>
                </div>
                <select
                  className="studio2__param-input"
                  value={wonderaModel}
                  onChange={(e) => setWonderaModel(e.target.value)}
                >
                  {WONDERA_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* 생성 곡 수 */}
              <div className="studio2__param-row">
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">생성 곡 수</span>
                    <p className="studio2__param-desc">한 번에 생성할 곡의 수를 선택합니다</p>
                  </div>
                </div>
                <select
                  className="studio2__param-input"
                  value={wonderaNumber}
                  onChange={(e) => setWonderaNumber(Number(e.target.value))}
                >
                  <option value={1}>1곡</option>
                  <option value={2}>2곡</option>
                  <option value={3}>3곡</option>
                </select>
              </div>

              {/* 스타일 설명 (prompt) */}
              <div className={`studio2__param-row ${(!!wonderaReferenceData || !!wonderaMelodyData) ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">스타일 설명 (prompt)</span>
                    <p className="studio2__param-desc">
                      원하는 음악 스타일을 자유롭게 설명합니다 (최대 1024자)
                      {(wonderaReferenceData || wonderaMelodyData) && (
                        <span className="studio2__wondera-conflict"> — 참고 음악 또는 멜로디 사용 시 비활성화</span>
                      )}
                    </p>
                  </div>
                </div>
                <input
                  className="studio2__param-input"
                  type="text"
                  value={wonderaPrompt}
                  onChange={(e) => setWonderaPrompt(e.target.value)}
                  placeholder="k-pop, ballad, emotional, female vocal..."
                  maxLength={1024}
                  disabled={!!wonderaReferenceData || !!wonderaMelodyData}
                />
                <div className="studio2__wondera-charcount">{wonderaPrompt.length} / 1,024</div>
              </div>

              {/* 참고 음악 (reference) */}
              <div className={`studio2__param-row ${(!!wonderaPrompt.trim() || !!wonderaMelodyData) ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">참고 음악 (reference)</span>
                    <p className="studio2__param-desc">
                      30초 이내의 참고 음악을 업로드합니다 (mp3/m4a)
                      {(wonderaPrompt.trim() || wonderaMelodyData) && (
                        <span className="studio2__wondera-conflict"> — prompt 또는 melody와 동시 사용 불가</span>
                      )}
                    </p>
                  </div>
                </div>
                {wonderaReferenceData ? (
                  <div className="studio2__wondera-file-info">
                    <span className="studio2__wondera-file-name">{wonderaReferenceData.name || wonderaReferenceData.filename || '업로드됨'}</span>
                    <button
                      type="button"
                      className="studio2__wondera-file-remove"
                      onClick={() => setWonderaReferenceData(null)}
                    >
                      <FiTrash2 /> 삭제
                    </button>
                  </div>
                ) : (
                  <label className={`studio2__wondera-upload-btn ${(!!wonderaPrompt.trim() || !!wonderaMelodyData) ? 'studio2__wondera-upload-btn--disabled' : ''}`}>
                    {wonderaUploading === 'reference' ? (
                      <><FiLoader className="s2__spin" /> 업로드 중...</>
                    ) : (
                      <><FiUploadCloud /> 파일 선택</>
                    )}
                    <input
                      type="file"
                      accept=".mp3,.m4a"
                      style={{ display: 'none' }}
                      disabled={!!wonderaPrompt.trim() || !!wonderaMelodyData || wonderaUploading === 'reference'}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleWonderaFileUpload(f, 'reference');
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>

              {/* 참고 보컬 (vocal) */}
              <div className={`studio2__param-row ${!!wonderaMelodyData ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">참고 보컬 (vocal)</span>
                    <p className="studio2__param-desc">
                      15~30초의 보컬 샘플을 업로드합니다 (mp3/m4a)
                      {wonderaMelodyData && (
                        <span className="studio2__wondera-conflict"> — melody와 동시 사용 불가</span>
                      )}
                    </p>
                  </div>
                </div>
                {wonderaVocalData ? (
                  <div className="studio2__wondera-file-info">
                    <span className="studio2__wondera-file-name">{wonderaVocalData.name || wonderaVocalData.filename || '업로드됨'}</span>
                    <button
                      type="button"
                      className="studio2__wondera-file-remove"
                      onClick={() => setWonderaVocalData(null)}
                    >
                      <FiTrash2 /> 삭제
                    </button>
                  </div>
                ) : (
                  <label className={`studio2__wondera-upload-btn ${!!wonderaMelodyData ? 'studio2__wondera-upload-btn--disabled' : ''}`}>
                    {wonderaUploading === 'vocal' ? (
                      <><FiLoader className="s2__spin" /> 업로드 중...</>
                    ) : (
                      <><FiUploadCloud /> 파일 선택</>
                    )}
                    <input
                      type="file"
                      accept=".mp3,.m4a"
                      style={{ display: 'none' }}
                      disabled={!!wonderaMelodyData || wonderaUploading === 'vocal'}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleWonderaFileUpload(f, 'vocal');
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>

              {/* 참고 멜로디 (melody) */}
              <div className={`studio2__param-row ${(!!wonderaPrompt.trim() || !!wonderaReferenceData || !!wonderaVocalData) ? 'studio2__param-row--off' : ''}`}>
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">참고 멜로디 (melody)</span>
                    <p className="studio2__param-desc">
                      5~60초의 멜로디 파일을 업로드합니다 (mp3/m4a/mid)
                      {(wonderaPrompt.trim() || wonderaReferenceData || wonderaVocalData) && (
                        <span className="studio2__wondera-conflict"> — 단독으로만 사용 가능 (prompt/reference/vocal과 동시 불가)</span>
                      )}
                    </p>
                  </div>
                </div>
                {wonderaMelodyData ? (
                  <div className="studio2__wondera-file-info">
                    <span className="studio2__wondera-file-name">{wonderaMelodyData.name || wonderaMelodyData.filename || '업로드됨'}</span>
                    <button
                      type="button"
                      className="studio2__wondera-file-remove"
                      onClick={() => setWonderaMelodyData(null)}
                    >
                      <FiTrash2 /> 삭제
                    </button>
                  </div>
                ) : (
                  <label className={`studio2__wondera-upload-btn ${(!!wonderaPrompt.trim() || !!wonderaReferenceData || !!wonderaVocalData) ? 'studio2__wondera-upload-btn--disabled' : ''}`}>
                    {wonderaUploading === 'melody' ? (
                      <><FiLoader className="s2__spin" /> 업로드 중...</>
                    ) : (
                      <><FiUploadCloud /> 파일 선택</>
                    )}
                    <input
                      type="file"
                      accept=".mp3,.m4a,.mid,.midi"
                      style={{ display: 'none' }}
                      disabled={!!wonderaPrompt.trim() || !!wonderaReferenceData || !!wonderaVocalData || wonderaUploading === 'melody'}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleWonderaFileUpload(f, 'melody');
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>

              {/* 실시간 스트리밍 */}
              <div className="studio2__param-row">
                <div className="studio2__param-header">
                  <div>
                    <span className="studio2__param-name">실시간 스트리밍</span>
                    <p className="studio2__param-desc">생성 과정을 실시간으로 스트리밍합니다</p>
                  </div>
                  <label className="studio2__toggle">
                    <input
                      type="checkbox"
                      checked={wonderaEnableStream}
                      onChange={(e) => setWonderaEnableStream(e.target.checked)}
                    />
                    <span className="studio2__toggle-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {error && <div className="s2__msg s2__msg--error">{error}</div>}
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          <div className="s2__btn-row">
            <button className="s2__btn-back" onClick={handleUnloadDraft}>
              <FiArrowLeft /> 다른 작사 선택
            </button>
            <button
              className="s2__submit"
              onClick={() => setStep(4)}
            >
              <FiCheck /> 프롬프트 확인 <FiArrowRight />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 4: Prompt Preview ─── */}
      {step === 4 && (
        <div className="s2__form">
          <div className="prompt-preview">
            <h3 className="prompt-preview__title">프롬프트 미리보기</h3>

            <div className="prompt-preview__model">
              <strong>선택된 모델:</strong>{' '}
              {MODEL_OPTIONS.find((m) => m.id === selectedModel)?.name || selectedModel}
            </div>

            <div className="prompt-preview__text">
              {buildPromptPreview(selectedModel, {
                genre: selectedGenres.join(', '),
                mood: selectedMoods.join(', '),
                vocal,
                isInstrumental,
                isDuet,
                duetMainGender,
                duetMainStyle,
                duetSubStyle,
                bpm: bpm || null,
                musicalKey: musicalKey || null,
                bpmOn,
                bpmVal: bpmVal || null,
                keyOn,
                keyVal: keyVal || null,
                style: getCombinedStyle(),
                referenceText: referenceText.trim() || null,
                duration,
                negativeTagsOn,
                negativeTagsVal,
                styleWeightOn,
                styleWeightVal,
                weirdnessOn,
                weirdnessVal,
                audioWeightOn,
                audioWeightVal,
                personaModelOn,
                personaModelVal,
                referenceData,
                wonderaModel,
                wonderaNumber,
                wonderaPrompt: wonderaPrompt.trim() || null,
                wonderaReferenceData,
                wonderaVocalData,
                wonderaMelodyData,
                wonderaEnableStream,
              })}
            </div>

            {lyrics.trim() && (
              <div className="prompt-preview__lyrics-section">
                <strong>가사 미리보기:</strong>
                <pre className="prompt-preview__lyrics">{getPreviewLyrics()}</pre>
              </div>
            )}

            {(translatedGenre || translatedMood || translatedStyle) && (
              <div className="prompt-preview__api-values">
                <strong>API 전달값 (영어 변환)</strong>
                <div className="prompt-preview__api-box">
                  {translatedGenre && <div>Genre: {translatedGenre}</div>}
                  {translatedMood && <div>Mood: {translatedMood}</div>}
                  {translatedStyle && <div>Style: {translatedStyle}</div>}
                </div>
              </div>
            )}
          </div>

          {/* v158 — 디렉터 피로 게이지 (작곡 제출 직전) */}
          {renderFatiguePanel()}

          {error && <div className="s2__msg s2__msg--error">{error}</div>}
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          <div className="s2__btn-row">
            <button className="s2__btn-back" onClick={() => setStep(3)}>
              <FiArrowLeft /> 수정하기
            </button>
            <button
              className="s2__submit"
              onClick={handleGenerateMusic}
              disabled={submitting}
            >
              {submitting ? (
                <><FiLoader className="s2__spin" /> 생성 요청 중...</>
              ) : (
                <><FiZap /> 생성하기 <span className="s2__cost-badge">⭐{pointCosts.compose}</span> <FiArrowRight /></>
              )}
            </button>
          </div>

          <div className="s2__note">
            {selectedModel === 'suno'
              ? 'Suno AI가 음악을 생성합니다. 약 1~3분 소요됩니다.'
              : selectedModel === 'wondera'
              ? 'Wondera AI가 음악을 생성합니다. 약 1~3분 소요됩니다.'
              : '음악을 생성합니다.'}
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

        {loadingHistory && historyGenerations.length === 0 ? (
          <div className="s2__history-empty">로딩 중...</div>
        ) : historyGenerations.length === 0 ? (
          <div className="s2__history-empty">아직 생성 기록이 없습니다.</div>
        ) : (
          <div className="s2__history-list">
            {historyGenerations.map((gen) => (
              <div key={gen.id} className="s2__gen-card">
                <div className="s2__gen-top">
                  <div className="s2__gen-info">
                    {gen.title && <div className="s2__gen-title">{gen.title}</div>}
                    <div className="s2__gen-prompt">{gen.prompt}</div>
                  </div>
                  <span className={`s2__gen-status s2__gen-status--${gen.status} ${isDraft(gen) ? 's2__draft-badge' : ''}`}>
                    {gen.status === 'processing' && gen.progress ? `${gen.progress}%` : statusLabel(gen.status, gen)}
                  </span>
                </div>
                <div className="s2__gen-meta">
                  {gen.model && (
                    <span className="s2__gen-tag s2__gen-tag--model">
                      {gen.model === 'suno' ? 'Suno' : gen.model === 'wondera' ? 'Wondera' : gen.model}
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

                {/* Play/Download for completed generations — v74: 2 variants side-by-side */}
                {gen.status === 'completed' && (() => {
                  // v74 — variants 배열이 없으면 (옛 데이터) 1개 가상 variant 로 fallback
                  const variants = Array.isArray(gen.variants) && gen.variants.length > 0
                    ? gen.variants
                    : [{
                        index: 0,
                        audio_url: gen.result_audio_url,
                        suno_audio_id: gen.suno_audio_id || '',
                        timestamps: [],
                      }];
                  const isMulti = variants.length > 1;
                  return (
                    <div className={`s2__gen-variants ${isMulti ? 's2__gen-variants--multi' : ''}`}>
                      {variants.map((v, vi) => {
                        const vIndex = typeof v.index === 'number' ? v.index : vi;
                        const key = playKey(gen.id, vIndex);
                        const isPlaying = playingId === key;
                        return (
                          <div key={vIndex} className="s2__gen-variant">
                            {isMulti && (
                              <div className="s2__gen-variant-header">클립 {vIndex + 1}</div>
                            )}
                            <div className="s2__gen-player">
                              <button
                                className={`s2__gen-play ${isPlaying ? 's2__gen-play--active' : ''}`}
                                onClick={() => handlePlayGeneration(gen.id, vIndex)}
                              >
                                {isPlaying ? <FiPause /> : <FiPlay />}
                                {isPlaying ? '일시정지' : '재생'}
                              </button>
                              <button
                                className="s2__gen-download"
                                onClick={() => handleDownloadGeneration(gen.id, gen.title, vIndex)}
                              >
                                <FiDownload /> 다운로드
                              </button>
                              {onSendToUpload && (
                                <button
                                  className="s2__gen-upload"
                                  onClick={() => {
                                    if (import.meta.env.DEV) {
                                      console.info('[ComposeStudioTab] sendToUpload', { genId: gen.id, variantIndex: vIndex });
                                    }
                                    onSendToUpload({
                                      generationId: gen.id,
                                      variantIndex: vIndex,
                                      title: gen.title,
                                      genre: gen.genre,
                                      mood: gen.mood,
                                      prompt: gen.prompt,
                                      lyrics: gen.lyrics,
                                      // v214 T3 — 부른 아티스트 관통 (업로드 프리필 우선 자동선택 재료).
                                      // persona 는 서버가 gen_doc 에서 승계 — FE 추가 전송 불요.
                                      characterId: composeArtist?.character_id || null,
                                    });
                                  }}
                                >
                                  <FiUploadCloud /> 업로드하기
                                </button>
                              )}
                            </div>
                            <LyricsTimestampToggle
                              segments={v.timestamps || []}
                              generationId={gen.id}
                              variantIndex={vIndex}
                              onRefetched={(updatedDoc) => {
                                if (import.meta.env.DEV) {
                                  console.info('[ComposeStudioTab] ts refetched', { genId: updatedDoc?.id });
                                }
                                if (!updatedDoc?.id) return;
                                setGenerations((prev) =>
                                  prev.map((g) =>
                                    g.id === updatedDoc.id ? { ...g, ...updatedDoc } : g
                                  )
                                );
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="s2__gen-bottom">
                  <span className="s2__gen-date">{formatDate(gen.created_at)}</span>
                  <div className="s2__gen-actions">
                    {gen.status === 'failed' && (
                      <button className="s2__gen-retry" onClick={() => handleRetry(gen.id)}>
                        <FiRefreshCw /> 재시도 <span className="s2__cost-badge">⭐{pointCosts.compose}</span>
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
