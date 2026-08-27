import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { FiUploadCloud, FiMusic, FiX, FiImage, FiRefreshCw, FiAlertTriangle, FiCheck, FiPlay, FiDownload, FiLoader } from 'react-icons/fi';
import * as api from '../api';
import '../pages/UploadPage.css';

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

const SCENARIO_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o-mini', color: '#00d4aa', inPrice: '$0.15/M', outPrice: '$0.60/M', perCall: '$0.002', perCallKRW: '≈3원' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', color: '#a855f7', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', color: '#3b82f6', inPrice: '$3.00/M', outPrice: '$15.00/M', perCall: '$0.05', perCallKRW: '≈70원' },
  { id: 'gpt-5.4', name: 'GPT-5.4', color: '#10b981', inPrice: '$2.50/M', outPrice: '$15.00/M', perCall: '$0.05', perCallKRW: '≈70원' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', color: '#ef4444', inPrice: '$1.00/M', outPrice: '$10.00/M', perCall: '$0.03', perCallKRW: '≈42원' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', color: '#e11d48', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
];

const PROMPT_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o-mini', color: '#00d4aa', inPrice: '$0.15/M', outPrice: '$0.60/M', perCall: '$0.005', perCallKRW: '≈7원' },
  { id: 'gpt-5.4', name: 'GPT-5.4', color: '#a855f7', inPrice: '$2.50/M', outPrice: '$15.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', color: '#10b981', inPrice: '$0.75/M', outPrice: '$4.50/M', perCall: '$0.025', perCallKRW: '≈35원' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', color: '#3b82f6', inPrice: '$3.00/M', outPrice: '$15.00/M', perCall: '$0.06', perCallKRW: '≈84원' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', color: '#e11d48', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.10', perCallKRW: '≈140원' },
];

const VIDEO_PROMPT_MODELS = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', color: '#ef4444', inPrice: '$1.00/M', outPrice: '$10.00/M', perCall: '$0.02', perCallKRW: '≈28원' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', color: '#e11d48', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.10', perCallKRW: '≈140원' },
];

const SCENARIO_STYLES = [
  { id: 'drama', label: '드라마형', desc: '인물·사건·감정 중심 단편영화', enabled: true },
  { id: 'mood', label: '무드형', desc: '감정·분위기 중심 영상시', enabled: false },
  { id: 'literal', label: '리터럴형', desc: '가사 그대로 시각화', enabled: false },
  { id: 'ai_auto', label: 'AI 자동', desc: 'AI가 곡 분석 후 스타일 결정', enabled: false },
];

// v47 SSOT — brainstorm plot archetype 한국어 라벨 매핑.
// backend `app/services/mv_generator.py` 의 `PLOT_ARCHETYPES` 와 동일 enum.
const ARCHETYPE_LABELS = {
  chance_encounter: '우연한 만남',
  reunion: '재회',
  farewell: '이별·작별',
  pursuit_of_dream: '꿈을 향한 도전',
  subtle_growth: '소소한 성장',
  support_and_friendship: '우정·유대',
  inner_resolution: '내적 결단',
};

function RetryCountdown({ retryAt }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const target = new Date(retryAt + 'Z').getTime();
    const tick = () => {
      const diff = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setRemaining(diff);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [retryAt]);
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  return <span className="upload-mv-retry-countdown">{min}:{String(sec).padStart(2, '0')} 후 재시도</span>;
}

// v209 — MV(뮤직비디오) 제작 섹션. 1단계에서 UploadPage 로부터 기계적 추출, 3단계부터 MVStudioTab(MV촬영실)이 호스트.
// - in props: 곡 메타(title/genre/mood/lyrics/tags/prompt/aiTool), 오디오 소스 3종 택1
//   (fromGeneration=generation id / trackId+audioObjectName+audioDurationSec=내 트랙 / audioFile=파일 첨부),
//   커버(aiCoverObjectName/coverImageModel), 공유 파라미터(vocalGender/selectedLocationId/includeCharacter/characterVariant/selectedCharSheet),
//   draftData(MV job 복원 — 곡 메타 복원과 onClearDraft 는 부모 탭 담당)
// - out callbacks: onCoverAdopted(objectName, previewUrl) — 드래프트 복원 시 커버 역주입(부모 소유 state),
//   onCoverImageModelRestore(model) — 드래프트의 cover_image_model 복원,
//   onRequestLightbox({url,title,subtitle}) — 공용 이미지 라이트박스(부모 소유)
// - ref: notifyCoverChanged({cleared}) — 커버 변경/제거 통지(scenesInvalidated 판단은 내부에서),
//        saveDraft() — 임시저장 실행부(MV job 생성 + saveMVDraft). 버튼/메시지 UI 는 부모 탭 소관.
const MVProductionSection = forwardRef(function MVProductionSection({
  title,
  genre,
  mood,
  lyrics,
  tags,
  prompt,
  aiTool,
  fromGeneration,
  audioFile,
  // v209 3단계 — MV촬영실 「내 트랙」 곡 소스: createMVJob body 의 track_id (audio_generation_id 와 택1)
  trackId,
  // v209 3단계 — track 소스의 오디오 object name (merge-audio body 용, tracks doc.audio_url)
  audioObjectName,
  // v209 3단계 — track 소스의 duration (tracks doc.duration_sec) — DOM 측정 대체
  audioDurationSec,
  aiCoverObjectName,
  coverImageModel,
  vocalGender,
  selectedLocationId,
  includeCharacter,
  characterVariant,
  // v212 F5 — 선택 아티스트의 character_id (다중 아티스트). 지정 시 서버가 해당 아티스트로
  // 스냅샷, 미지정(legacy 폴백 카드)이면 종전 character_variant 경로.
  characterId,
  selectedCharSheet,
  draftData,
  onCoverAdopted,
  onCoverImageModelRestore,
  onRequestLightbox,
}, ref) {
  const mvPollIntervalRef = useRef(null);
  const sceneImageInputRefs = useRef({});

  // v63: 커버 이미지 인물을 character1 주인공 자산으로 사용할지. 기본값 true.
  // includeCharacter (사용자 PNG) 가 켜져있으면 자동 무력화 — 백엔드도 동일 정책.
  const [useCoverPersonAsCharacter1, setUseCoverPersonAsCharacter1] = useState(true);
  const [scenePrompt, setScenePrompt] = useState('');
  const [showScenario, setShowScenario] = useState(false);
  const [showBrainstorm, setShowBrainstorm] = useState(false);  // v47
  // v45: scenario 패널 내부의 분리 필드/사건 목록 collapsible 상태
  const [showScenarioFields, setShowScenarioFields] = useState(false);
  const [showScenarioEvents, setShowScenarioEvents] = useState(false);

  // Video Model Selection
  const [videoModel, setVideoModel] = useState('veo');

  // AI 모델 선택 (시나리오 / 이미지 프롬프트)
  const [scenarioModels, setScenarioModels] = useState(['gpt-4o-mini']);
  const [promptModels, setPromptModels] = useState(['gpt-4o-mini']);
  const [videoPromptModel, setVideoPromptModel] = useState('gemini-2.5-pro');

  // Scenario style (PLAN v30 구현1): drama=default, 나머지는 준비 중 (disabled)
  const [scenarioStyle, setScenarioStyle] = useState('drama');
  // 관계 — 아직 별도 UI 없음. 백엔드가 기본값 처리하도록 전달. (보컬 성별은 UploadPage 소유 → prop)
  const [relationship, setRelationship] = useState(null);
  // v49: 사용자 사건 시드 — 시나리오에 포함되기 원하는 핵심 사건/헤프닝 (≤300자, 선택).
  // 비워두면 LLM 이 가사·곡 분위기로 자율 판단. 본문은 PII 가능 → console 로그에 길이만.
  const [userEventSeed, setUserEventSeed] = useState('');

  // v55: 씬 이미지 생성 모델 (씬+자산 공통, 기본 nb_pro). 커버 모델(coverImageModel)은 UploadPage 소유 → prop.
  const [sceneImageModel, setSceneImageModel] = useState('nb_pro');

  // MV Draft System states
  const [mvJobId, setMvJobId] = useState(null);
  const [mvJob, setMvJob] = useState(null);
  const [mvStep, setMvStep] = useState(0); // 0=no job, 1=generating scenes, 2=scenes ready, 3=generating videos, 4=paused, 5=video ready/merging, 6=completed
  const [mvMergingAudio, setMvMergingAudio] = useState(false);
  const [mvMusicVideoPreview, setMvMusicVideoPreview] = useState(null);
  const [mvMusicVideoObjectName, setMvMusicVideoObjectName] = useState(null);
  const [mvPreview, setMvPreview] = useState(null);
  const [mvObjectName, setMvObjectName] = useState(null);
  const [mvProgressPct, setMvProgressPct] = useState(0);
  const [mvRegeneratingScene, setMvRegeneratingScene] = useState(null);
  const [generatingSceneVideo, setGeneratingSceneVideo] = useState(null);
  const [mvUploadingScene, setMvUploadingScene] = useState(null);
  const [mvCoverObjectName, setMvCoverObjectName] = useState(null);
  const [scenesInvalidated, setScenesInvalidated] = useState(false);
  // savingDraft / draftSaveMsg (임시저장 버튼·메시지 UI 상태)는 UploadPage 잔존 — 실행부만 saveDraftInternal 로 이동.
  const [selectedScene, setSelectedScene] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [vocalPreview, setVocalPreview] = useState(null); // {original_audio_url, vocal_audio_url, scene_number}
  const [separatingVocal, setSeparatingVocal] = useState(null); // scene_number being separated
  // v51 — 씬 카드 안 인라인 편집 상태. {scene_number: {field, value}} 형태.
  const [sceneEdit, setSceneEdit] = useState(null);
  const [sceneEditSaving, setSceneEditSaving] = useState(false);
  const [cascadeToast, setCascadeToast] = useState(null); // {scene_number, type:"success"|"error"}
  // v52 — 시나리오 events 카드 안 5개 필드 인라인 편집 상태.
  // {event_order, field: 'trigger'|'protagonist_action'|'motivation'|'emotion_shift'|'props', value: string}.
  // props 는 textarea 안에서 줄바꿈 split, 저장 시 list 변환.
  const [eventEdit, setEventEdit] = useState(null);
  const [eventEditSaving, setEventEditSaving] = useState(false);
  // v53 — 시나리오 상위 6개 필드 인라인 편집 상태.
  //   {field: 'narrative'|'premise'|'central_conflict'|'emotional_core'|'character_states'|'narrative_arc',
  //    value: string|object}. character_states / narrative_arc 는 dict 단위 — 각 sub-key 별 textarea 묶음.
  const [scenarioFieldEdit, setScenarioFieldEdit] = useState(null);
  const [scenarioFieldSaving, setScenarioFieldSaving] = useState(false);
  // v53 — events 추가/삭제 작업 진행 표시.
  const [eventArrayBusy, setEventArrayBusy] = useState(false);
  // v53 — [전체 저장 + 모든 씬 재생성] 충돌 다이얼로그 + 진행 표시.
  const [scenarioCascadeBusy, setScenarioCascadeBusy] = useState(false);
  const [scenarioCascadeDialog, setScenarioCascadeDialog] = useState(null);  // {userEditedScenes, completedVideoScenes}
  // v54 — 사용자 편집 표시 미니 메뉴 + 사용자 편집 현황 패널.
  const [editBadgeMenu, setEditBadgeMenu] = useState(null);  // {scope, target, field, anchor:{x,y}}
  const [userEditedSummary, setUserEditedSummary] = useState(null);  // {scenario, events, scenes}
  const [userEditedSummaryOpen, setUserEditedSummaryOpen] = useState(false);
  const [resetAllConfirm, setResetAllConfirm] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // Restore MV job from draft — 비-MV 필드 복원과 onClearDraft 호출은 UploadPage(부모) effect 담당.
  // React 는 자식 effect 를 부모보다 먼저 실행하므로 onClearDraft 이전에 job_id 를 수신한다.
  useEffect(() => {
    if (draftData?.job_id) {
      setMvJobId(draftData.job_id);
      loadMvJobDetail(draftData.job_id).then(() => {
        // mvCoverObjectName will be set after job loads
      });
    }
  }, [draftData]);  // eslint-disable-line react-hooks/exhaustive-deps

  const loadMvJobDetail = async (jobId) => {
    try {
      const { data } = await api.getMVJobDetail(jobId);
      setMvJob(data);
      const st = mapStatusToStep(data.status);
      setMvStep(st);
      // v49: 서버에 저장된 사용자 시드 복원 (드래프트/이어쓰기 시).
      if (typeof data.user_event_seed === 'string' && data.user_event_seed) {
        setUserEventSeed(data.user_event_seed);
        if (import.meta.env.DEV) {
          console.info('[MVStudio] scenario panel has seed', { len: data.user_event_seed.length });
        }
      }
      if (data.cover_object_name) {
        setMvCoverObjectName(data.cover_object_name);
        // v209: aiCoverObjectName/aiCoverPreview 는 UploadPage 소유 — 콜백으로 역주입 (기존 동작 동일: preview 는 cover_url 있을 때만)
        if (onCoverAdopted) onCoverAdopted(data.cover_object_name, data.cover_url || null);
      }
      if (data.result_video_url) {
        setMvPreview(data.result_video_url);
        setMvObjectName(data.result_object_name || null);
      }
      if (data.result_music_video_url) {
        setMvMusicVideoPreview(data.result_music_video_url);
        setMvMusicVideoObjectName(data.result_music_video_object_name || null);
      }
      if (data.video_model) {
        setVideoModel(data.video_model);
      }
      // v55: 드래프트 로드 시 image_model / cover_image_model 복원 (옛 잡엔 누락 → 그대로 nb_pro).
      if (data.image_model === 'nb_pro' || data.image_model === 'gpt_image_2') {
        setSceneImageModel(data.image_model);
      }
      if (data.cover_image_model === 'nb_pro' || data.cover_image_model === 'gpt_image_2') {
        // v209: coverImageModel 은 UploadPage 소유 — 복원 콜백으로 위임
        if (onCoverImageModelRestore) onCoverImageModelRestore(data.cover_image_model);
      }
      // If in an active state, start polling
      // v59: 'generating_assets' (Phase 1.5 자산 사전생성) 도 폴링 대상 — 진행률 갱신 표시 필요
      if (['splitting', 'generating_assets', 'generating_images', 'generating_videos', 'synclabs_processing', 'concatenating', 'merging_audio'].includes(data.status)) {
        if (import.meta.env.DEV) {
          console.info('[MVStudio] startMvPolling for job', jobId, 'status=', data.status);
        }
        startMvPolling(jobId);
      }
      // v53 — 전체 cascade 가 진행 중이면 폴링 시작
      if (data.cascade_phase && !['completed', 'cancelled', 'failed'].includes(data.cascade_phase)) {
        startMvPolling(jobId, 3000);
      }
    } catch (err) {
      console.error('[MVStudio] Failed to load job detail:', err);
    }
  };

  const mapStatusToStep = (status) => {
    switch (status) {
      case 'splitting':
      case 'generating_assets':
      case 'generating_images':
        return 1;
      case 'scenario_review':
        return 1.5;
      case 'prompts_review':
        return 1.7;
      case 'scenes_ready':
      case 'images_ready':
      case 'videos_ready':
        return 2;
      case 'generating_videos':
      case 'synclabs_processing':
      case 'concatenating':
        return 3;
      case 'paused':
        return 4;
      case 'video_ready':
      case 'merging_audio':
        return 5;
      case 'completed':
        return 6;
      case 'failed':
        return 0;
      default:
        return 0;
    }
  };

  // --- MV Draft System ---

  const stopMvPolling = useCallback(() => {
    if (mvPollIntervalRef.current) {
      clearInterval(mvPollIntervalRef.current);
      mvPollIntervalRef.current = null;
    }
  }, []);

  const startMvPolling = useCallback((jobId, intervalMs = 3000) => {
    if (!jobId || jobId === 'undefined' || jobId === 'null') {
      return;
    }
    stopMvPolling();

    mvPollIntervalRef.current = setInterval(async () => {
      try {
        const { data } = await api.getMVJobDetail(jobId);
        setMvJob(prev => {
          // Preserve previous scenes if the new response doesn't include them
          if (prev?.scenes?.length && (!data.scenes || data.scenes.length === 0)) {
            return { ...data, scenes: prev.scenes };
          }
          return data;
        });
        setMvProgressPct(data.progress || 0);

        const newStep = mapStatusToStep(data.status);
        setMvStep(newStep);

        if (data.status === 'scenario_review' || data.status === 'prompts_review') {
          stopMvPolling();
        } else if (data.status === 'images_ready' || data.status === 'scenes_ready' || data.status === 'videos_ready') {
          stopMvPolling();
        } else if (data.status === 'video_ready') {
          stopMvPolling();
          if (data.result_video_url) {
            setMvPreview(data.result_video_url);
            setMvObjectName(data.result_object_name || null);
          }
          setMvMergingAudio(false);
        } else if (data.status === 'completed') {
          stopMvPolling();
          if (data.result_video_url) {
            setMvPreview(data.result_video_url);
            setMvObjectName(data.result_object_name || null);
          }
          if (data.result_music_video_url) {
            setMvMusicVideoPreview(data.result_music_video_url);
            setMvMusicVideoObjectName(data.result_music_video_object_name || null);
          }
          setMvMergingAudio(false);
        } else if (data.status === 'paused') {
          stopMvPolling();
        } else if (data.status === 'failed') {
          stopMvPolling();
          alert('뮤직비디오 생성 실패: ' + (data.error_message || '알 수 없는 오류'));
          setMvStep(0);
        }
      } catch (err) {
        stopMvPolling();
        console.error('[MVStudio] Polling error:', err);
      }
    }, intervalMs);
  }, [stopMvPolling]);

  useEffect(() => {
    return () => stopMvPolling();
  }, [stopMvPolling]);


  // v209 3단계: 구 querySelector('.upload-card__gen-player') DOM 결합 제거 — duration 은 부모가
  // props 로 명시 공급(track 소스 = doc.duration_sec). generation 소스는 generationStreamUrl 임시
  // Audio 로 측정(기존 fallback 경로 그대로), 파일 첨부는 objectURL 측정 유지.
  const getAudioDuration = () => {
    return new Promise((resolve) => {
      if (Number.isFinite(audioDurationSec) && audioDurationSec > 0) {
        resolve(audioDurationSec);
        return;
      }
      if (fromGeneration) {
        const streamUrl = api.generationStreamUrl(fromGeneration);
        const tmpAudio = new Audio(streamUrl);
        tmpAudio.addEventListener('loadedmetadata', () => resolve(tmpAudio.duration));
        tmpAudio.addEventListener('error', () => resolve(null));
      } else if (audioFile) {
        const url = URL.createObjectURL(audioFile);
        const tmpAudio = new Audio(url);
        tmpAudio.addEventListener('loadedmetadata', () => {
          resolve(tmpAudio.duration);
          URL.revokeObjectURL(url);
        });
        tmpAudio.addEventListener('error', () => resolve(null));
      } else {
        resolve(null);
      }
    });
  };

  const handleCreateScenes = async () => {
    if (!title.trim()) {
      alert('곡 제목을 입력해주세요.');
      return;
    }
    // v210 F2: 곡 소스(generation/track) 부재 시 호출 전 차단 — 서버 400(B2) 사후 의존 금지.
    // draft 복원 곡이 양 소스 null 인 이론 경로도 여기서 함께 막힌다 (버튼 게이트와 이중 방어).
    if (!fromGeneration && !trackId) {
      alert('곡 소스가 연결되어 있지 않습니다. 작곡실 완성곡 또는 내 트랙을 선택한 뒤 씬을 생성해주세요.');
      return;
    }
    setMvStep(1);
    setMvProgressPct(0);
    try {
      const audioDuration = await getAudioDuration();
      // v55: 씬 이미지 생성 모델 라디오 값 (씬+자산 공통, 기본 "nb_pro").
      console.info('[MVStudio] scene image_model selected', { value: sceneImageModel });
      const { data } = await api.createMVJob({
        title: title.trim(),
        genre: genre || null,
        mood: mood || null,
        lyrics: lyrics.trim() || null,
        cover_object_name: aiCoverObjectName || null,
        audio_duration_sec: audioDuration || null,
        scene_prompt: scenePrompt.trim() || null,
        character_object_name: includeCharacter ? selectedCharSheet() : null,
        // v212 F5: 선택 아티스트 character_id 전송 (다중 아티스트 — 서버가 해당 doc 으로 스냅샷).
        character_id: includeCharacter ? (characterId || null) : null,
        // v75 legacy: character_id 없을 때만(구 단일 문서 계정) variant 경로 유지.
        character_variant: includeCharacter && !characterId ? characterVariant : null,
        video_model: videoModel,
        audio_generation_id: fromGeneration || null,
        // v209 3단계: 「내 트랙」 곡 소스 — 서버가 track 소유권 검증 + audio 해석 폴백 (generation 과 택1)
        track_id: trackId || null,
        scenario_models: scenarioModels,
        prompt_models: promptModels,
        video_prompt_model: videoPromptModel,
        scenario_style: scenarioStyle,
        vocal_gender: vocalGender,
        relationship: relationship,
        location_id: selectedLocationId || null,
        // v63: 커버 인물 자산화 (사용자 캐릭터 안 켰을 때만 의미 — 백엔드도 동일 정책)
        use_cover_person_as_character1: useCoverPersonAsCharacter1 && !includeCharacter,
        // v49: 사용자 사건 시드 (≤300자, 빈 문자열 → null 통일).
        user_event_seed: userEventSeed.trim() || null,
        // v55: 씬+자산 공통 이미지 생성 모델 + 커버 모델 스냅샷.
        image_model: sceneImageModel,
        cover_image_model: coverImageModel,
      });
      const jobId = data.job_id;
      if (!jobId) {
        alert('MV 작업 ID를 받지 못했습니다.');
        setMvStep(0);
        return;
      }
      setMvJobId(jobId);
      setMvCoverObjectName(aiCoverObjectName);
      setScenesInvalidated(false);
      startMvPolling(jobId, 3000);
    } catch (err) {
      // v46: 디버깅 로그 심기 — 페이로드의 lyrics 본문은 길이만(시크릿 보호).
      console.error('[MVStudio] createMVJob failed', {
        err_status: err?.response?.status,
        err_message: err?.message,
        relationship,
        scenario_style: scenarioStyle,
        vocal_gender: vocalGender,
        scenario_models: scenarioModels,
        prompt_models: promptModels,
        video_model: videoModel,
        lyrics_len: (lyrics || '').length,
        // v49: 시드 본문 미출력 — 길이만(PII 보호).
        user_event_seed_len: (userEventSeed || '').length,
      });
      // v139 — 스트라이크 생성 제한 403 공통 처리
      if (api.isGenerationRestricted(err)) api.alertGenerationRestricted(err);
      else alert(err.response?.data?.error || '씬 생성에 실패했습니다.');
      setMvStep(0);
    }
  };

  const handleUploadSceneImage = async (sceneNumber, file) => {
    if (!file || !mvJobId) return;
    setMvUploadingScene(sceneNumber);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.uploadMVSceneImage(mvJobId, sceneNumber, formData);
      // Refresh job detail
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
    } catch (err) {
      alert(err.response?.data?.error || '이미지 업로드에 실패했습니다.');
    } finally {
      setMvUploadingScene(null);
    }
  };

  const handleRegenerateSceneImage = async (sceneNumber) => {
    if (!mvJobId) return;
    setMvRegeneratingScene(sceneNumber);
    try {
      await api.regenerateMVSceneImage(mvJobId, sceneNumber);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
    } catch (err) {
      alert(err.response?.data?.error || '이미지 재생성에 실패했습니다.');
    } finally {
      setMvRegeneratingScene(null);
    }
  };

  // ── v51 — Scene-level field edit + partial cascade ──────────────────────

  const handleSceneEditOpen = (sceneNumber, field, currentValue) => {
    setSceneEdit({
      scene_number: sceneNumber,
      field,
      value: currentValue || '',
    });
  };

  const handleSceneEditCancel = () => {
    setSceneEdit(null);
  };

  const handleSceneEditSave = async () => {
    if (!sceneEdit || !mvJobId) return;
    const { scene_number, field, value } = sceneEdit;
    // v56 — 한국어 필드 (`*_ko`) 편집 로깅 (DEV 가드, 본문 미출력 — 길이만)
    if (import.meta?.env?.DEV) {
      const isKoField = typeof field === 'string' && field.endsWith('_ko');
      if (isKoField) {
        try {
          console.info('[MVStudio] scene_ko field edited', {
            scene_number,
            field,
            len: (value || '').length,
          });
        } catch (logErr) {
          console.error('[MVStudio] scene_ko edit log failed', { err: String(logErr) });
        }
      } else {
        console.info('[MVStudio] scene field edited', {
          scene_number,
          field,
          len: (value || '').length,
        });
      }
    }
    setSceneEditSaving(true);
    try {
      const payload = { [field]: value };
      // 1) PATCH — 텍스트 갱신 (v56: ko 필드만 전송. 영어는 백엔드가 자동 번역.)
      await api.patchMVScene(mvJobId, scene_number, payload);
      // 2) Cascade 자동 시작 (Q2: 다이얼로그 X). v56: ko trigger_field 도 그대로 백엔드 전달.
      await api.cascadeRegenerateMVScene(mvJobId, scene_number, field);
      // 3) 즉시 detail 한 번 fetch (running 상태 반영) + 폴링 시작
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      startMvPolling(mvJobId, 3000);
      setSceneEdit(null);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '저장에 실패했습니다.';
      alert(detail);
    } finally {
      setSceneEditSaving(false);
    }
  };

  const handleCancelCascade = async (sceneNumber) => {
    if (!mvJobId) return;
    try {
      await api.cancelCascadeMVScene(mvJobId, sceneNumber);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '취소에 실패했습니다.';
      alert(detail);
    }
  };

  // ── v52 — events 카드 인라인 편집 핸들러 ──────────────────────────────
  // event 는 1-based order 사용 (UI 에 #1, #2, … 로 표시).

  const handleEventEditStart = (eventOrder, field, currentValue) => {
    let value = '';
    if (field === 'props' && Array.isArray(currentValue)) {
      value = currentValue.join('\n');
    } else if (typeof currentValue === 'string') {
      value = currentValue;
    }
    setEventEdit({ event_order: eventOrder, field, value });
  };

  const handleEventEditCancel = () => {
    setEventEdit(null);
  };

  const handleEventEditSave = async () => {
    if (!eventEdit || !mvJobId) return;
    const { event_order, field, value } = eventEdit;
    if (import.meta?.env?.DEV) {
      try {
        console.info('[MVStudio] event field edited', {
          event_order,
          field,
          len: typeof value === 'string' ? value.length : 0,
        });
      } catch (logErr) {
        console.error('[MVStudio] event edit log failed', { err: String(logErr) });
      }
    }
    setEventEditSaving(true);
    try {
      // props 는 줄바꿈 split → list[str] (빈 줄 제거).
      let payloadValue = value;
      if (field === 'props') {
        payloadValue = (value || '')
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      const payload = { [field]: payloadValue };
      // 1) PATCH — 텍스트 갱신
      await api.patchMVScenarioEvent(mvJobId, event_order, payload);
      // 2) cascade 자동 시작 (Q2: 다이얼로그 X). 매핑 씬 0개여도 200 반환되므로
      //    별도 처리 X.
      await api.cascadeRegenerateMVEvent(mvJobId, event_order);
      // 3) 즉시 detail fetch + 폴링 시작 (v51 인프라 재사용)
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      startMvPolling(mvJobId, 3000);
      setEventEdit(null);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '저장에 실패했습니다.';
      alert(detail);
    } finally {
      setEventEditSaving(false);
    }
  };

  const handleCancelEventCascade = async (eventOrder) => {
    if (!mvJobId) return;
    try {
      await api.cancelCascadeMVEvent(mvJobId, eventOrder);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '취소에 실패했습니다.';
      alert(detail);
    }
  };

  // ── v53 — 시나리오 상위 인라인 편집 ───────────────────────────────────────

  const handleScenarioFieldEditStart = (field, currentValue) => {
    let value = '';
    if (field === 'character_states' || field === 'narrative_arc') {
      // dict — sub-key 별 별도 textarea 묶음으로 편집. value 는 dict.
      value = (currentValue && typeof currentValue === 'object') ? { ...currentValue } : {};
    } else if (typeof currentValue === 'string') {
      value = currentValue;
    }
    setScenarioFieldEdit({ field, value });
  };

  const handleScenarioFieldEditCancel = () => {
    setScenarioFieldEdit(null);
  };

  const handleScenarioFieldEditSave = async () => {
    if (!scenarioFieldEdit || !mvJobId) return;
    const { field, value } = scenarioFieldEdit;
    if (import.meta?.env?.DEV) {
      try {
        const len = (typeof value === 'string') ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : 0);
        console.info('[MVStudio] scenario field edited', { field, len });
      } catch (logErr) {
        console.error('[MVStudio] scenario edit log failed', { err: String(logErr) });
      }
    }
    setScenarioFieldSaving(true);
    try {
      const payload = { [field]: value };
      await api.patchMVScenario(mvJobId, payload);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      setScenarioFieldEdit(null);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '저장에 실패했습니다.';
      alert(detail);
    } finally {
      setScenarioFieldSaving(false);
    }
  };

  // ── v53 — events 추가 / 삭제 (배열 통째 PATCH) ────────────────────────────

  const sanitizeEventForPatch = (ev) => {
    // 백엔드 _v53_normalize_events_array 가 받는 형태로 정리.
    return {
      section: ev?.section || '',
      trigger: ev?.trigger || '',
      protagonist_action: ev?.protagonist_action || '',
      motivation: ev?.motivation || '',
      emotion_shift: ev?.emotion_shift || '',
      props: Array.isArray(ev?.props) ? ev.props.filter((p) => typeof p === 'string') : [],
      // 보존 필드 (있으면 통과)
      ...(Array.isArray(ev?.user_edited_fields) ? { user_edited_fields: ev.user_edited_fields } : {}),
      ...(Array.isArray(ev?.other_characters) ? { other_characters: ev.other_characters } : {}),
      ...(ev?.setting ? { setting: ev.setting } : {}),
    };
  };

  const handleAddEvent = async () => {
    if (!mvJobId || !mvJob) return;
    const cur = Array.isArray(mvJob.scenario_events) ? mvJob.scenario_events : [];
    const next = [
      ...cur.map(sanitizeEventForPatch),
      {
        section: '',
        trigger: '',
        protagonist_action: '',
        motivation: '',
        emotion_shift: '',
        props: [],
        user_edited_fields: [],
      },
    ];
    setEventArrayBusy(true);
    try {
      await api.patchMVScenarioEvents(mvJobId, next);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      if (import.meta?.env?.DEV) {
        console.info('[MVStudio] scenario event added', { count: next.length });
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '추가에 실패했습니다.';
      alert(detail);
    } finally {
      setEventArrayBusy(false);
    }
  };

  const handleDeleteEvent = async (eventOrder) => {
    if (!mvJobId || !mvJob) return;
    const cur = Array.isArray(mvJob.scenario_events) ? mvJob.scenario_events : [];
    if (cur.length <= 1) {
      alert('최소 1개 event 가 필요합니다.');
      return;
    }
    if (!window.confirm(`event #${eventOrder} 를 삭제할까요?`)) return;
    const next = cur
      .filter((ev, idx) => (ev.order ?? idx + 1) !== eventOrder)
      .map(sanitizeEventForPatch);
    setEventArrayBusy(true);
    try {
      await api.patchMVScenarioEvents(mvJobId, next);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      if (import.meta?.env?.DEV) {
        console.info('[MVStudio] scenario event deleted', { event_order: eventOrder, count: next.length });
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '삭제에 실패했습니다.';
      alert(detail);
    } finally {
      setEventArrayBusy(false);
    }
  };

  // ── v53 — [전체 저장 + 모든 씬 재생성] + 충돌 다이얼로그 ─────────────────

  const handleStartScenarioCascade = () => {
    if (!mvJobId || !mvJob) return;
    const scenes = Array.isArray(mvJob.scenes) ? mvJob.scenes : [];
    const userEditedScenes = scenes.filter((s) => Array.isArray(s.user_edited_fields) && s.user_edited_fields.length > 0)
      .map((s) => ({ scene_number: s.scene_number, fields: s.user_edited_fields }));
    const completedVideoScenes = scenes.filter((s) => s.video_status === 'completed')
      .map((s) => s.scene_number);
    if (import.meta?.env?.DEV) {
      console.info('[MVStudio] scenario cascade start', {
        n_user_edited_scenes: userEditedScenes.length,
        n_completed_video_scenes: completedVideoScenes.length,
      });
    }
    if (userEditedScenes.length > 0 || completedVideoScenes.length > 0) {
      setScenarioCascadeDialog({ userEditedScenes, completedVideoScenes });
    } else {
      // 충돌 없으면 즉시 시작
      confirmStartScenarioCascade();
    }
  };

  const confirmStartScenarioCascade = async () => {
    if (!mvJobId) return;
    setScenarioCascadeBusy(true);
    try {
      await api.cascadeRegenerateMVScenario(mvJobId);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      startMvPolling(mvJobId, 3000);
      setScenarioCascadeDialog(null);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || 'cascade 시작에 실패했습니다.';
      alert(detail);
    } finally {
      setScenarioCascadeBusy(false);
    }
  };

  const handleCancelScenarioCascade = async () => {
    if (!mvJobId) return;
    try {
      await api.cancelCascadeMVScenario(mvJobId);
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '취소에 실패했습니다.';
      alert(detail);
    }
  };

  // ── v54 — 사용자 편집 표시 미니 메뉴 + 사용자 편집 현황 패널 ──────────────

  // ✏ 배지 클릭 시 미니 메뉴 열기 (scope/target/field + 화면 좌표).
  const openEditBadgeMenu = (event, scope, target, field) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setEditBadgeMenu({
      scope,
      target,
      field,
      anchor: { x: rect.left, y: rect.bottom + 4 },
    });
  };

  const closeEditBadgeMenu = () => setEditBadgeMenu(null);

  // F1 — [편집 표시 해제] 미니 메뉴 액션. 단일 필드 reset.
  const handleResetSingleField = async () => {
    if (!editBadgeMenu || !mvJobId) return;
    const { scope, target, field } = editBadgeMenu;
    if (import.meta?.env?.DEV) {
      console.info('[MVStudio] reset user edit', { scope, target, field });
    }
    setResetBusy(true);
    try {
      await api.resetUserEdits(mvJobId, {
        scope,
        target: scope === 'scenario' ? null : target,
        fields: [field],
      });
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      // 패널 열려 있으면 갱신
      if (userEditedSummaryOpen) {
        try {
          const { data: sum } = await api.getUserEditedSummary(mvJobId);
          setUserEditedSummary(sum);
        } catch {}
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '편집 표시 해제에 실패했습니다.';
      alert(detail);
    } finally {
      setResetBusy(false);
      setEditBadgeMenu(null);
    }
  };

  // F2 — 사용자 편집 현황 패널 toggle + summary 로드.
  const toggleUserEditedSummaryPanel = async () => {
    if (!mvJobId) return;
    if (userEditedSummaryOpen) {
      setUserEditedSummaryOpen(false);
      return;
    }
    try {
      const { data } = await api.getUserEditedSummary(mvJobId);
      setUserEditedSummary(data);
      setUserEditedSummaryOpen(true);
    } catch {
      // best-effort — 패널 미오픈
    }
  };

  // F2 — [모두 해제] 확인 후 reset 호출.
  const handleResetAllUserEdits = async () => {
    if (!mvJobId) return;
    if (import.meta?.env?.DEV) {
      console.info('[MVStudio] reset all user edits', { jobId: mvJobId });
    }
    setResetBusy(true);
    try {
      await api.resetUserEdits(mvJobId, { scope: 'all' });
      const { data: updated } = await api.getMVJobDetail(mvJobId);
      setMvJob(updated);
      const { data: sum } = await api.getUserEditedSummary(mvJobId);
      setUserEditedSummary(sum);
      setResetAllConfirm(false);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.error || '모두 해제에 실패했습니다.';
      alert(detail);
    } finally {
      setResetBusy(false);
    }
  };

  // ✏ 배지 표시용 통일 헬퍼 (F1) — tooltip + 클릭 시 미니 메뉴.
  // scope: "scene"|"event"|"scenario", target: scene_number|event_order|null, field: string.
  const renderEditBadge = (scope, target, field, sizeOverride) => {
    return (
      <span
        title="직접 편집된 필드 — cascade 시 보존됩니다"
        onClick={(e) => openEditBadgeMenu(e, scope, target, field)}
        style={{
          marginLeft: '6px',
          color: '#fbbf24',
          fontSize: sizeOverride || '11px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >✏</span>
    );
  };

  // 매핑 씬 (scene.event_index === order-1) — F2/F3 에서 재사용.
  const getEventAffectedScenes = (eventOrder) => {
    if (!Array.isArray(mvJob?.scenes)) return [];
    return mvJob.scenes.filter(
      (s) => Number.isInteger(s.event_index) && s.event_index === eventOrder - 1,
    );
  };

  // 폴링 사이클에서 cascade 완료/실패 토스트 자동 표시
  useEffect(() => {
    if (!mvJob?.scenes) return;
    const running = mvJob.scenes.find(s => s.cascade_status === 'running');
    const completed = mvJob.scenes.find(s => s.cascade_status === 'completed' && s.cascade_completed_at);
    // 매 mvJob update 시 cascade 끝난 씬이 있고 토스트가 아직 안 떴으면 노출
    if (!running && completed && (!cascadeToast || cascadeToast.scene_number !== completed.scene_number)) {
      // v54 — 보존된 user_edited_fields 카운트 (해당 씬 기준).
      const preservedFieldCount = (completed.user_edited_fields || []).length;
      setCascadeToast({ scene_number: completed.scene_number, type: 'success', preservedFieldCount });
      const t = setTimeout(() => setCascadeToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [mvJob]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateSceneVideo = async (sceneNumber) => {
    const jobId = mvJob?.job_id || mvJobId;
    if (!jobId) return;
    setGeneratingSceneVideo(sceneNumber);
    try {
      await api.generateSceneVideo(jobId, sceneNumber);
      // 개별 씬 영상 생성 전용 폴링 (5초 간격, 최대 120회 = 10분)
      const pollInterval = setInterval(async () => {
        try {
          const { data } = await api.getMVJobDetail(jobId);
          setMvJob(data);
          // 해당 씬의 video_status 확인
          const targetScene = data.scenes?.find(s => s.scene_number === sceneNumber);
          if (targetScene && targetScene.video_status !== 'generating') {
            clearInterval(pollInterval);
            setGeneratingSceneVideo(null);
          }
        } catch (err) {
          console.error('[MVStudio] Poll error:', err);
        }
      }, 5000);
      // 10분 타임아웃
      setTimeout(() => {
        clearInterval(pollInterval);
        setGeneratingSceneVideo(null);
      }, 600000);
    } catch (err) {
      alert(err.response?.data?.error || '영상 생성 실패');
      setGeneratingSceneVideo(null);
    }
  };

  const handleRetrySyncLabs = async (sceneNumber) => {
    const jobId = mvJob?.job_id || mvJob?.id || mvJobId;
    if (!jobId) {
      alert('작업 ID를 찾을 수 없습니다.');
      return;
    }
    try {
      const resp = await api.retrySyncLabs(jobId, sceneNumber);
      console.log('[MVStudio] retrySyncLabs response:', resp);
      alert('립싱크 시도를 시작했습니다. 잠시 후 새로고침해주세요.');
    } catch (err) {
      console.error('[MVStudio] retrySyncLabs error:', err);
      const msg = err?.response?.data?.error || err?.message || '립싱크 재시도 실패';
      alert(msg);
    }
  };

  const handleStartLipsync = async (sceneNumber) => {
    const jobId = mvJob?.job_id || mvJob?.id || mvJobId;
    if (!jobId) return;
    setSeparatingVocal(sceneNumber);
    try {
      const { data } = await api.separateVocal(jobId, sceneNumber);
      // Backend returns data URLs (base64) directly - no need for fetch
      setVocalPreview(data);
    } catch (err) {
      console.error('[MVStudio] 보컬분리 에러:', err);
      const msg = err.response?.data?.error || err.message || '보컬 분리 실패';
      alert('보컬 분리 실패: ' + msg);
    } finally {
      setSeparatingVocal(null);
    }
  };

  const handleConfirmLipsync = async () => {
    if (!vocalPreview) return;
    const jobId = mvJob?.job_id || mvJob?.id || mvJobId;
    if (!jobId) return;
    const sceneNumber = vocalPreview.scene_number;
    setVocalPreview(null);
    try {
      await api.retrySyncLabs(jobId, sceneNumber);
      alert('립싱크 처리를 시작했습니다. 잠시 후 새로고침해주세요.');
    } catch (err) {
      alert(err.response?.data?.error || '립싱크 시작 실패');
    }
  };

  const handleGenerateVideos = async () => {
    if (!mvJobId) return;
    setMvStep(3);
    setMvProgressPct(0);
    try {
      await api.generateMVVideos(mvJobId, videoModel);
      startMvPolling(mvJobId, 5000);
    } catch (err) {
      alert(err.response?.data?.error || '영상 생성에 실패했습니다.');
      setMvStep(2);
    }
  };

  const handleRetryVideos = async () => {
    if (!mvJobId) return;
    setMvStep(3);
    try {
      await api.generateMVVideos(mvJobId, videoModel);
      startMvPolling(mvJobId, 5000);
    } catch (err) {
      alert(err.response?.data?.error || '재시도에 실패했습니다.');
      setMvStep(4);
    }
  };

  // v73 — 실패 씬 일괄 재생성 (이미지 / 영상) — 단일 POST, 백엔드가 selector + 순차 책임
  const handleBatchRegenerateFailedImages = async () => {
    if (!mvJobId) return;
    console.info('[MVStudio] calling generateMVImages (batch)', { mvJobId, failedImageScenes });
    try {
      await api.generateMVImages(mvJobId); // 빈 body → 실패 씬만 자동 선별 (순차)
      startMvPolling(mvJobId, 5000);
    } catch (err) {
      console.error('[MVStudio] batch image regen failed', { err, mvJobId });
      alert(err.response?.data?.error || '이미지 일괄 재생성에 실패했습니다.');
    }
  };

  const handleBatchRegenerateFailedVideos = async () => {
    if (!mvJobId) return;
    console.info('[MVStudio] calling generateMVVideos (batch)', { mvJobId, failedVideoScenes, videoModel });
    try {
      await api.generateMVVideos(mvJobId, videoModel); // scene_numbers 미전달 → 실패만 자동 선별 (순차)
      startMvPolling(mvJobId, 5000);
    } catch (err) {
      console.error('[MVStudio] batch video regen failed', { err, mvJobId });
      alert(err.response?.data?.error || '영상 일괄 재생성에 실패했습니다.');
    }
  };

  const handleCancelMV = async () => {
    if (!mvJobId) return;
    try {
      await api.cancelMVJob(mvJobId);
    } catch (err) {
      alert(err.response?.data?.error || '중지 요청에 실패했습니다.');
    }
  };

  const handleMergeAudio = async () => {
    if (!mvJobId) return;

    // Determine the audio object name from the generation
    let audioObjName = null;
    if (fromGeneration) {
      try {
        const genRes = await api.getGeneration(fromGeneration);
        audioObjName = genRes.data.result_audio_url;
      } catch {
        alert('오디오 정보를 가져올 수 없습니다.');
        return;
      }
    } else if (audioObjectName) {
      // v209 3단계: track 소스 — 부모가 공급한 tracks doc.audio_url(object name) 사용
      audioObjName = audioObjectName;
    } else if (audioFile) {
      // For uploaded files, we need to get it from the track upload path
      // The audio file needs to be uploaded first - show hint
      alert('오디오 파일을 먼저 업로드해야 합니다. AI 생성 오디오를 사용하세요.');
      return;
    } else {
      alert('오디오 파일이 연결되어 있지 않습니다.');
      return;
    }

    setMvMergingAudio(true);
    try {
      await api.mergeAudioMV(mvJobId, audioObjName);
      startMvPolling(mvJobId, 3000);
    } catch (err) {
      alert(err.response?.data?.error || '음악 합치기에 실패했습니다.');
      setMvMergingAudio(false);
    }
  };

  const handleClearMV = () => {
    setMvPreview(null);
    setMvObjectName(null);
    setMvMusicVideoPreview(null);
    setMvMusicVideoObjectName(null);
    setMvJobId(null);
    setMvJob(null);
    setMvStep(0);
    setMvProgressPct(0);
    setMvMergingAudio(false);
    stopMvPolling();
  };

  // v209: 임시저장 실행부 — 기존 handleSaveDraft(:1439-1482) 에서 메시지/스피너(savingDraft/draftSaveMsg)와
  // 에러 alert 는 UploadPage(부모) 래퍼에 남기고, MV job 생성 + saveMVDraft 본체만 이곳으로 이동 (동작 동일).
  const saveDraftInternal = async () => {
      let currentJobId = mvJobId;
      if (!currentJobId) {
        // Create a job first if none exists
        if (import.meta.env?.DEV) console.info('[MVStudio] create body', { has_gen: !!fromGeneration, has_track: !!trackId });
        const { data } = await api.createMVJob({
          title: title.trim() || '제목 없음',
          genre: genre || null,
          mood: mood || null,
          lyrics: lyrics.trim() || null,
          cover_object_name: aiCoverObjectName || null,
          // v210 F1: generation 소스도 create body 에 직접 부착 — 종전엔 사후 saveMVDraft 로만
          // 부착해 소스 없는 create 가 발생했고, 서버의 소스 부재 400 가드(B2)와 충돌한다.
          audio_generation_id: fromGeneration || null,
          // v209 픽스: track 소스 컨텍스트를 임시저장 job 생성 경로에도 보존 —
          // 누락 시 불러오기 후 씬 생성/merge-audio 에서 곡 연결이 유실된다 (tester 실증).
          track_id: trackId || null,
          audio_duration_sec: (Number.isFinite(audioDurationSec) && audioDurationSec > 0) ? audioDurationSec : null,
          scenario_style: scenarioStyle,
          vocal_gender: vocalGender,
          relationship: relationship,
          location_id: selectedLocationId || null,
          // v49: 드래프트 저장 시에도 시드 보존.
          user_event_seed: userEventSeed.trim() || null,
          // v55: 드래프트 저장 시에도 image_model 보존.
          image_model: sceneImageModel,
          cover_image_model: coverImageModel,
          // v63: 드래프트 저장에도 체크박스 값 보존.
          use_cover_person_as_character1: useCoverPersonAsCharacter1 && !includeCharacter,
        });
        currentJobId = data.job_id;
        setMvJobId(currentJobId);
      }
      await api.saveMVDraft(currentJobId, {
        genre: genre || null,
        mood: mood || null,
        tags: tags.trim() || null,
        prompt: prompt.trim() || null,
        ai_model: aiTool || null,
        audio_generation_id: fromGeneration || null,
        // v209 3단계: track 소스 드래프트에도 곡 연결 보존
        track_id: trackId || null,
      });
  };

  // Helpers
  const getCompletedImageCount = () => {
    if (!mvJob?.scenes) return 0;
    return mvJob.scenes.filter(s => s.image_url).length;
  };

  const getCompletedVideoCount = () => {
    if (!mvJob?.scenes) return 0;
    return mvJob.scenes.filter(s => s.video_url || s.video_status === 'completed').length;
  };

  // 단계별 독립 진행률 (0~100)
  const getImageProgressPct = () => {
    const total = mvJob?.total_scenes || mvJob?.scenes?.length || 0;
    if (!total) return 0;
    return Math.round((getCompletedImageCount() / total) * 100);
  };

  const getVideoProgressPct = () => {
    const total = mvJob?.total_scenes || mvJob?.scenes?.length || 0;
    if (!total) return 0;
    return Math.round((getCompletedVideoCount() / total) * 100);
  };

  // v73-fix2 — 실패 씬 카운트.
  // 이미지: image_status 필드 없음 → mv_job.status 가 Phase 2 종료(images_ready) 이상일 때
  //         image_object_name 없는 씬을 실패로 간주.
  // 영상: video_status === 'failed' 명시적 신호만.
  const imagePhaseFinished = mvJob && [
    'images_ready','generating_videos','videos_ready',
    'synclabs_processing','concatenating','merging_audio','completed'
  ].includes(mvJob.status);
  const failedImageScenes = imagePhaseFinished
    ? (mvJob?.scenes || []).filter(s => !s.image_object_name).length
    : 0;
  const failedVideoScenes = (mvJob?.scenes || []).filter(
    s => s.video_status === 'failed'
  ).length;
  const isMvBusy = [
    'splitting', 'generating_assets', 'generating_images', 'generating_videos',
    'synclabs_processing', 'concatenating', 'merging_audio'
  ].includes(mvJob?.status);

  const getStatusText = () => {
    if (!mvJob) return '';
    if (mvJob.retry_info?.active) {
        return `429 에러 — 재시도 대기 중 (${mvJob.retry_info.attempt}/${mvJob.retry_info.max_retries})`;
    }
    switch (mvJob.status) {
      case 'splitting': return '장면 분석 중...';
      case 'scenario_review': return '시나리오 비교 선택 대기 중...';
      case 'prompts_review': return 'Image Prompt 비교 선택 대기 중...';
      case 'generating_assets': return `주인공/장소 자산 생성 중... (고품질 2K, 최대 30분 소요 가능 · ${mvJob.progress || 0}%)`;
      case 'generating_images': return `장면 이미지 생성 중... (${getCompletedImageCount()}/${mvJob.total_scenes || 0})`;
      case 'generating_videos': return `영상 클립 생성 중... (${getCompletedVideoCount()}/${mvJob.total_scenes || 0})`;
      case 'synclabs_processing': return `립싱크 자동 적용 중... (${mvJob.synclabs_completed || 0}/${mvJob.synclabs_total || '?'})`;
      case 'concatenating': return '영상 합치는 중...';
      case 'merging_audio': return '음악과 영상을 합치는 중...';
      default: return '처리 중...';
    }
  };

  // v211 D7: onMvObjectNameChange 동기화 effect 제거 — 구 UploadPage 제출용이었고 소비자 0(데드).
  // MV↔곡 연결은 명시 부착(attach/detach API)으로 대체.

  // ── v211 — MV 곡 연결(붙이기): 부착 대상 = 이 job 의 소스 곡 고정 (타겟 파라미터 없음) ──
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachMsg, setAttachMsg] = useState('');

  const handleAttachMV = async (replace = false) => {
    if (!mvJobId || attachBusy) return;
    setAttachBusy(true);
    setAttachMsg('');
    try {
      if (import.meta.env?.DEV) console.info('[MVStudio] attach', { jobId: mvJobId, replace });
      const { data } = await api.attachMVJob(mvJobId, replace);
      await loadMvJobDetail(mvJobId); // attached_* 반영
      // v211 F-1: state 별 안내는 서버 응답 message 그대로 — track 소스(즉시 발매됨)에
      // "(발매 시 자동 반영)" 고정 문구가 잘못 노출되던 것 교체
      setAttachMsg('✅ ' + (data?.message || '곡에 붙었습니다.'));
      setTimeout(() => setAttachMsg(''), 4000);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409 && !replace) {
        // 곡당 1개 — 기존 부착 MV 존재: 교체 confirm 후 replace 재호출
        const conflictTitle = err?.response?.data?.conflicting_title;
        const ok = window.confirm(
          conflictTitle
            ? `이 곡에는 이미 다른 MV(「${conflictTitle}」 작업)가 붙어 있습니다. 이 MV로 교체할까요?`
            : '이 곡에는 이미 다른 MV가 붙어 있습니다. 이 MV로 교체할까요?',
        );
        if (ok) {
          setAttachBusy(false);
          await handleAttachMV(true);
          return;
        }
      } else {
        console.error('[MVStudio] attach failed', { jobId: mvJobId, status, message: err?.message });
        alert(err?.response?.data?.error || '곡에 붙이기에 실패했습니다.');
      }
    } finally {
      setAttachBusy(false);
    }
  };

  const handleDetachMV = async () => {
    if (!mvJobId || attachBusy) return;
    if (!window.confirm('이 MV를 곡에서 뗄까요? (곡 상세·플레이어에서 더 이상 재생되지 않습니다)')) return;
    setAttachBusy(true);
    setAttachMsg('');
    try {
      if (import.meta.env?.DEV) console.info('[MVStudio] detach', { jobId: mvJobId });
      await api.detachMVJob(mvJobId);
      await loadMvJobDetail(mvJobId);
      setAttachMsg('곡에서 뗐습니다');
      setTimeout(() => setAttachMsg(''), 3000);
    } catch (err) {
      console.error('[MVStudio] detach failed', { jobId: mvJobId, status: err?.response?.status, message: err?.message });
      alert(err?.response?.data?.error || '떼기에 실패했습니다.');
    } finally {
      setAttachBusy(false);
    }
  };

  // v209: 부모(UploadPage) 커버 핸들러 4곳의 결합 지점을 ref 메서드로 재현.
  useImperativeHandle(ref, () => ({
    // 커버 생성/수정/되돌리기: 기존 `if (mvStep >= 2 && mvCoverObjectName) setScenesInvalidated(true)`
    // 커버 제거(cleared:true): 기존 `if (mvStep >= 2) setScenesInvalidated(true)`
    notifyCoverChanged: ({ cleared = false } = {}) => {
      if (mvStep >= 2 && (cleared || mvCoverObjectName)) {
        setScenesInvalidated(true);
      }
    },
    saveDraft: saveDraftInternal,
  }));

  return (
    <>
        {cascadeToast && (
          <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, padding: '10px 16px', background: '#1a3d1a', color: '#9eff9e', border: '1px solid #2d6a2d', borderRadius: '6px', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
            <div>✓ 씬 {cascadeToast.scene_number} 재생성 완료</div>
            {cascadeToast.preservedFieldCount > 0 && (
              <div style={{ marginTop: '4px', color: '#fbbf24', fontSize: '11px' }}>
                ✏ 사용자 편집 {cascadeToast.preservedFieldCount}개 필드 보존됨
              </div>
            )}
          </div>
        )}

          {/* Music Video - Draft System */}
          <div className="upload-card__field">
            <label className="upload-card__label">뮤직비디오 (선택)</label>

            {/* Step 6: Completed - show final music video */}
            {mvStep === 6 && mvMusicVideoPreview && (
              <div className="upload-mv-preview">
                <video src={mvMusicVideoPreview} controls className="upload-mv-preview__video" />
                <div className="upload-mv-preview__badge">
                  <FiCheck /> 뮤직비디오 완성
                </div>
                {/* v211 — 곡 연결(명시 부착, 자동 연결 없음): 대상 = 이 MV를 만들 때 땡긴 곡 */}
                {attachMsg && (
                  <div style={{ margin: '8px 0', fontSize: '13px', color: '#9eff9e' }}>{attachMsg}</div>
                )}
                {(mvJob?.attached_track_id || mvJob?.attached_generation_id) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0' }}>
                    <span style={{ fontSize: '13px', color: '#ddd' }}>
                      🔗 「{title || '연결된 곡'}」에 연결됨
                      {mvJob?.attached_track_id ? (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: '#9eff9e' }}>✅ 발매됨</span>
                      ) : (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: '#e8c87a' }}>🕓 발매 전 (발매 시 자동 반영)</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="upload-mv-remove"
                      onClick={handleDetachMV}
                      disabled={attachBusy}
                    >
                      {attachBusy ? '처리 중...' : '떼기'}
                    </button>
                  </div>
                ) : (
                  <div style={{ margin: '8px 0' }}>
                    <button
                      type="button"
                      className="upload-mv-ai-btn"
                      onClick={() => handleAttachMV(false)}
                      disabled={attachBusy || (!fromGeneration && !trackId && !mvJob?.audio_track_id && !mvJob?.audio_generation_id)}
                    >
                      {attachBusy ? '붙이는 중...' : `🔗 「${title || '곡'}」에 붙이기`}
                    </button>
                  </div>
                )}
                <div className="upload-mv-preview__actions">
                  <button type="button" className="upload-mv-regenerate" onClick={handleClearMV}>
                    다시 만들기
                  </button>
                  <button type="button" className="upload-mv-remove" onClick={handleClearMV}>제거</button>
                </div>
              </div>
            )}

            <>
                {/* STEP 1: Scene Generation */}
                <div className="upload-mv-step">
                  <div className="upload-mv-step__title">STEP 1: 씬 생성</div>

                  {mvStep === 0 && (
                    <>
                      {/* Section 1: 씬 분위기 지시 */}
                      <div style={{ marginTop: '20px', marginBottom: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #333' }}>
                          씬 분위기 지시
                        </div>
                        <div className="upload-card__field" style={{ marginBottom: 0 }}>
                          <textarea
                            className="upload-card__textarea"
                            value={scenePrompt}
                            onChange={(e) => setScenePrompt(e.target.value)}
                            placeholder="예: 도시 배경 위주로, 밤 분위기, 네온 조명 강조"
                            rows={2}
                            style={{ minHeight: '60px' }}
                          />
                        </div>
                      </div>

                      {/* Section 2: 영상 모델 */}
                      <div style={{ marginTop: '20px', marginBottom: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #333' }}>
                          영상 모델
                        </div>
                        <div className="upload-mv-video-model-selector">
                          <div className="upload-mv-video-model-selector__label">영상 모델 선택 (씬 개수에 영향)</div>
                          <div className="upload-mv-video-model-selector__cards">
                            <button
                              type="button"
                              className={`upload-mv-video-model-card${videoModel === 'veo' ? ' upload-mv-video-model-card--active' : ''}`}
                              onClick={() => setVideoModel('veo')}
                            >
                              <div className="upload-mv-video-model-card__name">Veo 3.1</div>
                              <div className="upload-mv-video-model-card__provider">Google</div>
                              <div className="upload-mv-video-model-card__desc">고품질 8초 영상 · ~$0.50/씬</div>
                            </button>
                            <button
                              type="button"
                              className={`upload-mv-video-model-card${videoModel === 'kling' ? ' upload-mv-video-model-card--active' : ''}`}
                              onClick={() => setVideoModel('kling')}
                            >
                              <div className="upload-mv-video-model-card__name">Kling V3</div>
                              <div className="upload-mv-video-model-card__provider">Kling AI</div>
                              <div className="upload-mv-video-model-card__desc">이미지 기반 10초 영상 · ~$0.40/씬</div>
                            </button>
                            <button
                              type="button"
                              className={`upload-mv-video-model-card${videoModel === 'seedance' ? ' upload-mv-video-model-card--active' : ''}`}
                              onClick={() => setVideoModel('seedance')}
                            >
                              <div className="upload-mv-video-model-card__name">Seedance 2.0</div>
                              <div className="upload-mv-video-model-card__provider">ByteDance</div>
                              <div className="upload-mv-video-model-card__desc">시네마틱 15초 영상 · $0.13/초</div>
                            </button>
                            {/* v66: Grok Imagine Video (xAI 직접) — 콘텐츠 필터 느슨, 가격 우수 */}
                            <button
                              type="button"
                              className={`upload-mv-video-model-card${videoModel === 'grok' ? ' upload-mv-video-model-card--active' : ''}`}
                              onClick={() => {
                                if (import.meta.env.DEV) {
                                  console.info('[MVStudio] videoModel selected', { value: 'grok' });
                                }
                                setVideoModel('grok');
                              }}
                            >
                              <div className="upload-mv-video-model-card__name">Grok Imagine</div>
                              <div className="upload-mv-video-model-card__provider">xAI</div>
                              <div className="upload-mv-video-model-card__desc">10초 영상 · $0.07/초 · 필터 느슨</div>
                            </button>
                          </div>
                        </div>

                        {/* v55: 씬 이미지 생성 모델 라디오 (씬+자산 공통, Nano Banana Pro / GPT Image 2). 기본 nb_pro. */}
                        <div style={{ marginTop: '16px' }}>
                          <div className="upload-mv-video-model-selector__label">
                            씬 이미지 생성 모델 (자산도 동일 모델 적용)
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px' }}>
                            <label style={{
                              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                              padding: '10px 14px', borderRadius: '8px',
                              border: sceneImageModel === 'nb_pro' ? '2px solid #7C3AED' : '2px solid #333',
                              background: sceneImageModel === 'nb_pro' ? '#7C3AED15' : '#1a1a1a',
                              fontSize: '13px', color: '#ddd', minWidth: '180px',
                            }}>
                              <input
                                type="radio"
                                name="sceneImageModel"
                                value="nb_pro"
                                checked={sceneImageModel === 'nb_pro'}
                                onChange={() => setSceneImageModel('nb_pro')}
                                style={{ accentColor: '#7C3AED' }}
                              />
                              Nano Banana Pro
                            </label>
                            <label style={{
                              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                              padding: '10px 14px', borderRadius: '8px',
                              border: sceneImageModel === 'gpt_image_2' ? '2px solid #10A37F' : '2px solid #333',
                              background: sceneImageModel === 'gpt_image_2' ? '#10A37F15' : '#1a1a1a',
                              fontSize: '13px', color: '#ddd', minWidth: '180px',
                            }}>
                              <input
                                type="radio"
                                name="sceneImageModel"
                                value="gpt_image_2"
                                checked={sceneImageModel === 'gpt_image_2'}
                                onChange={() => setSceneImageModel('gpt_image_2')}
                                style={{ accentColor: '#10A37F' }}
                              />
                              GPT Image 2
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Section 3: AI 모델 설정 */}
                      <div style={{ marginTop: '20px', marginBottom: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #333' }}>
                          AI 모델 설정
                        </div>

                        {/* 시나리오 AI 모델 선택 */}
                        <div style={{ marginBottom: '18px' }}>
                          <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>시나리오 AI 모델</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {SCENARIO_MODELS.map(model => (
                              <label key={model.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: scenarioModels.includes(model.id) ? `2px solid ${model.color}` : '2px solid #333', background: scenarioModels.includes(model.id) ? `${model.color}15` : '#1a1a1a', fontSize: '13px', color: '#ddd', minWidth: '180px' }}>
                                <input type="checkbox" checked={scenarioModels.includes(model.id)} onChange={() => {
                                  setScenarioModels(prev => prev.includes(model.id) ? prev.filter(m => m !== model.id) : [...prev, model.id]);
                                }} style={{ accentColor: model.color, marginTop: '2px' }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span style={{ fontWeight: 600 }}>{model.name}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>in {model.inPrice}  out {model.outPrice}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>1회 ≈ {model.perCall} ({model.perCallKRW})</span>
                                </div>
                              </label>
                            ))}
                          </div>
                          {scenarioModels.length === 0 && <p style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>최소 1개 모델을 선택하세요</p>}
                        </div>

                        {/* Image Prompt AI 모델 선택 */}
                        <div style={{ marginBottom: '14px' }}>
                          <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>Image Prompt AI 모델</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {PROMPT_MODELS.map(model => (
                              <label key={model.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: promptModels.includes(model.id) ? `2px solid ${model.color}` : '2px solid #333', background: promptModels.includes(model.id) ? `${model.color}15` : '#1a1a1a', fontSize: '13px', color: '#ddd', minWidth: '180px' }}>
                                <input type="checkbox" checked={promptModels.includes(model.id)} onChange={() => {
                                  setPromptModels(prev => prev.includes(model.id) ? prev.filter(m => m !== model.id) : [...prev, model.id]);
                                }} style={{ accentColor: model.color, marginTop: '2px' }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span style={{ fontWeight: 600 }}>{model.name}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>in {model.inPrice}  out {model.outPrice}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>1회 ≈ {model.perCall} ({model.perCallKRW})</span>
                                </div>
                              </label>
                            ))}
                          </div>
                          {promptModels.length === 0 && <p style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>최소 1개 모델을 선택하세요</p>}
                        </div>

                        <div style={{ marginTop: '18px' }}>
                          <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>Video Prompt (카메라 무빙)</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {VIDEO_PROMPT_MODELS.map(model => (
                              <label key={model.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: videoPromptModel === model.id ? `2px solid ${model.color}` : '2px solid #333', background: videoPromptModel === model.id ? `${model.color}15` : '#1a1a1a', fontSize: '13px', color: '#ddd', minWidth: '180px' }}>
                                <input type="radio" name="videoPromptModel" checked={videoPromptModel === model.id} onChange={() => setVideoPromptModel(model.id)} style={{ accentColor: model.color, marginTop: '2px' }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span style={{ fontWeight: 600 }}>{model.name}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>in {model.inPrice}  out {model.outPrice}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>1회 ≈ {model.perCall} ({model.perCallKRW})</span>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* 시나리오 스타일 선택 (PLAN v30 구현1) */}
                      <div style={{ marginTop: '20px', marginBottom: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #333' }}>
                          시나리오 스타일
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                          {SCENARIO_STYLES.map(style => {
                            const selected = scenarioStyle === style.id;
                            const disabled = !style.enabled;
                            return (
                              <label
                                key={style.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '8px',
                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                  padding: '10px 14px',
                                  borderRadius: '8px',
                                  border: selected ? '2px solid #00d4aa' : '2px solid #333',
                                  background: selected ? '#00d4aa15' : '#1a1a1a',
                                  fontSize: '13px',
                                  color: '#ddd',
                                  opacity: disabled ? 0.5 : 1,
                                  position: 'relative',
                                }}
                              >
                                <input
                                  type="radio"
                                  name="scenarioStyle"
                                  checked={selected}
                                  disabled={disabled}
                                  onChange={() => { if (!disabled) setScenarioStyle(style.id); }}
                                  style={{ accentColor: '#00d4aa', marginTop: '2px' }}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                                  <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {style.label}
                                    {disabled && (
                                      <span style={{ fontSize: '10px', fontWeight: 500, color: '#888', background: '#2a2a2a', padding: '2px 6px', borderRadius: '4px', border: '1px solid #444' }}>
                                        준비 중
                                      </span>
                                    )}
                                  </span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>{style.desc}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      {/* v46: 주인공 캐릭터와 등장인물 관계 선택 (자동/연인/짝사랑/친구/가족/없음) */}
                      <div style={{ marginTop: '20px', marginBottom: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #333' }}>
                          주인공 캐릭터와 등장인물 관계
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                          {[
                            { id: null,      label: '자동 (LLM 판단)', desc: '곡 분위기로 자율 판단' },
                            { id: 'lover',   label: '연인',           desc: '현재 사귀는 연인' },
                            { id: 'crush',   label: '짝사랑',         desc: '아직 마음 미전달' },
                            { id: 'friend',  label: '친구',           desc: '오랜 친구' },
                            { id: 'family',  label: '가족',           desc: '부모/형제 등' },
                            { id: 'none',    label: '없음 (단독)',     desc: '단독 주인공 캐릭터' },
                          ].map(opt => {
                            const selected = relationship === opt.id;
                            const optionKey = opt.id === null ? 'auto' : opt.id;
                            return (
                              <label
                                key={optionKey}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '8px',
                                  cursor: 'pointer',
                                  padding: '8px 10px',
                                  borderRadius: '8px',
                                  border: selected ? '2px solid #00d4aa' : '2px solid #333',
                                  background: selected ? '#00d4aa15' : '#1a1a1a',
                                  fontSize: '12px',
                                  color: '#ddd',
                                }}
                                onClick={() => {
                                  setRelationship(opt.id);
                                  if (import.meta.env.DEV) {
                                    // remoteLogger 가 자동 캡처 (v46-pre)
                                    console.info('[MVStudio] relationship selected', { value: opt.id, label: opt.label });
                                  }
                                }}
                              >
                                <input
                                  type="radio"
                                  name="relationship"
                                  checked={selected}
                                  readOnly
                                  style={{ accentColor: '#00d4aa', marginTop: '2px' }}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                                  <span style={{ fontWeight: 600 }}>{opt.label}</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>{opt.desc}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                          명시한 옵션은 그대로 강제됩니다. "자동" 선택 시 곡 가사·장르·무드를 분석해 LLM 이 자율 판단합니다.
                        </div>
                      </div>

                      {/* v49: 사용자 사건 시드 입력 (선택, ≤300자). 비워두면 LLM 자율 판단. */}
                      <div style={{ marginTop: '20px', marginBottom: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#aaa', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #333' }}>
                          원하는 사건·헤프닝 (선택)
                        </div>
                        <textarea
                          value={userEventSeed}
                          onChange={(e) => {
                            const next = e.target.value;
                            setUserEventSeed(next);
                            // v49: DEV 가드 + 길이만 로그 (본문 미출력 — PII 보호).
                            // 매 keystroke 노이즈 방지: 길이가 0/100/200/280/300 경계일 때만.
                            if (import.meta.env.DEV) {
                              const len = next.length;
                              if (len === 0 || len === 100 || len === 200 || len === 280 || len === 300) {
                                console.info('[MVStudio] user event seed', { len });
                              }
                            }
                          }}
                          rows={3}
                          maxLength={300}
                          placeholder='예) 벚꽃나무 아래에서 잘생긴 남자와 우연히 마주쳐 첫눈에 반함, 결국 번호를 건넴'
                          style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#ddd', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                        <div style={{ fontSize: '11px', color: '#888', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>비워두면 LLM 이 가사·곡 분위기로 자율 판단합니다.</span>
                          <span style={{ color: userEventSeed.length > 280 ? '#cc8800' : '#666' }}>{userEventSeed.length}/300</span>
                        </div>
                      </div>

                      <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
                        예상 비용: 씬당 ~$0.03 · 영상 모델 비용 별도
                      </div>
                      {/* v43: 외부 업로드 트랙은 가사 자막이 표시되지 않음을 안내 */}
                      {!fromGeneration && (
                        <div style={{ fontSize: '12px', color: '#cc8800', marginBottom: '8px', background: '#fff8e1', padding: '6px 8px', borderRadius: 4 }}>
                          외부 업로드 트랙은 가사 자막이 표시되지 않습니다.
                        </div>
                      )}
                      {/* v63: 커버 인물을 주인공으로 사용 옵션 — 사용자 캐릭터 안 켰을 때만 의미 있음 */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          marginBottom: '8px',
                          padding: '8px 10px',
                          background: includeCharacter ? '#1a1a1a' : '#172240',
                          border: '1px solid ' + (includeCharacter ? '#333' : '#2d4a8c'),
                          borderRadius: 4,
                          color: includeCharacter ? '#666' : '#cfe1ff',
                          cursor: includeCharacter ? 'not-allowed' : 'pointer',
                          opacity: includeCharacter ? 0.6 : 1,
                        }}
                        title={
                          includeCharacter
                            ? '내 캐릭터 포함이 켜져있어 비활성화됨 — 사용자 캐릭터가 주인공으로 우선 사용됩니다.'
                            : '커버 이미지에 인물이 있으면 그 인물을 character1 주인공 자산으로 사용합니다.'
                        }
                      >
                        <input
                          type="checkbox"
                          checked={useCoverPersonAsCharacter1 && !includeCharacter}
                          disabled={includeCharacter}
                          onChange={(e) => {
                            if (import.meta.env.DEV) {
                              console.info('[MVStudio] useCoverPersonAsCharacter1 toggled', { value: e.target.checked });
                            }
                            setUseCoverPersonAsCharacter1(e.target.checked);
                          }}
                        />
                        <span>
                          커버이미지 인물을 주인공으로 이용하기
                          <span style={{ fontSize: '11px', color: '#888', marginLeft: '6px' }}>
                            (커버에 인물이 있을 때만 활성)
                          </span>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="upload-mv-ai-btn"
                        onClick={handleCreateScenes}
                        disabled={(!fromGeneration && !trackId) || !aiCoverObjectName || scenarioModels.length === 0 || promptModels.length === 0}
                      >
                        씬 생성하기
                      </button>
                      {/* v210 F2: 곡 소스 부재 가드 — 커버 게이트와 동일 패턴 (버튼 비활성 + 힌트) */}
                      {!fromGeneration && !trackId && (
                        <div className="upload-mv-hint">곡 소스가 연결되지 않았습니다 — 작곡실 완성곡 또는 내 트랙을 선택해주세요</div>
                      )}
                      {!aiCoverObjectName && (
                        <div className="upload-mv-hint">커버 이미지를 먼저 생성해주세요</div>
                      )}
                    </>
                  )}

                  {mvStep === 1 && (
                    <div className="upload-mv-progress">
                      <div className="upload-mv-progress__header">
                        <span className="upload-cover-spinner" />
                        <span>{getStatusText()}</span>
                      </div>
                      <div className="upload-mv-progress__bar">
                        <div className="upload-mv-progress__fill" style={{ width: `${mvJob?.status === 'generating_images' ? getImageProgressPct() : mvProgressPct}%` }} />
                      </div>
                      <div className="upload-mv-progress__text">
                        {mvJob?.status === 'generating_images'
                          ? `씬 이미지 ${getCompletedImageCount()}/${mvJob.total_scenes || 0} (${getImageProgressPct()}%)`
                          : `${mvProgressPct}%`
                        }
                      </div>
                      <button
                        type="button"
                        className="upload-mv-cancel-btn"
                        onClick={handleCancelMV}
                      >
                        <FiX /> 중지하기
                      </button>
                    </div>
                  )}

                  {/* 시나리오 비교 선택 */}
                  {mvStep === 1.5 && mvJob?.scenario_results && (
                    <div style={{ marginTop: '16px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>시나리오 비교 - 하나를 선택하세요</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                        {mvJob.scenario_results.map((result, idx) => {
                          const modelInfo = SCENARIO_MODELS.find(m => m.id === result.model) || { name: result.model, color: '#888' };
                          return (
                            <div key={idx} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: `1px solid ${modelInfo.color}33`, borderTop: `3px solid ${modelInfo.color}` }}>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: modelInfo.color, marginBottom: '12px' }}>
                                {modelInfo.name}
                              </div>
                              <pre style={{ color: '#ccc', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto', lineHeight: 1.6 }}>
                                {typeof result.scenario === 'string' ? result.scenario : JSON.stringify(result.scenario, null, 2)}
                              </pre>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api.selectScenario(mvJobId, result.model);
                                    startMvPolling(mvJobId, 3000);
                                  } catch (err) {
                                    alert(err.response?.data?.error || '시나리오 선택에 실패했습니다.');
                                  }
                                }}
                                style={{ marginTop: '12px', width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: modelInfo.color, color: '#000', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
                              >
                                이걸로 선택
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 이미지 프롬프트 비교 선택 */}
                  {mvStep === 1.7 && mvJob?.prompt_results && (
                    <div style={{ marginTop: '16px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>Image Prompt 비교 - 하나를 선택하세요</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                        {mvJob.prompt_results.map((result, idx) => {
                          const modelInfo = PROMPT_MODELS.find(m => m.id === result.model) || { name: result.model, color: '#888' };
                          return (
                            <div key={idx} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: `1px solid ${modelInfo.color}33`, borderTop: `3px solid ${modelInfo.color}` }}>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: modelInfo.color, marginBottom: '12px' }}>
                                {modelInfo.name}
                              </div>
                              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                                {Array.isArray(result.prompts) ? result.prompts.map((p, pi) => (
                                  <div key={pi} style={{ marginBottom: '8px', padding: '8px', background: '#222', borderRadius: '6px' }}>
                                    <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>Scene {pi + 1}</div>
                                    <div style={{ color: '#ccc', fontSize: '12px', lineHeight: 1.5 }}>{p.description_ko || p.prompt || JSON.stringify(p)}</div>
                                  </div>
                                )) : (
                                  <pre style={{ color: '#ccc', fontSize: '12px', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                    {typeof result.prompts === 'string' ? result.prompts : JSON.stringify(result.prompts, null, 2)}
                                  </pre>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api.selectPrompts(mvJobId, result.model);
                                    startMvPolling(mvJobId, 3000);
                                  } catch (err) {
                                    alert(err.response?.data?.error || '프롬프트 선택에 실패했습니다.');
                                  }
                                }}
                                style={{ marginTop: '12px', width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: modelInfo.color, color: '#000', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
                              >
                                이걸로 선택
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {scenesInvalidated && mvStep >= 2 && (
                    <div className="upload-mv-warning">
                      커버 이미지가 변경되었습니다. 씬 이미지와 일관성을 위해 다시 생성하는 것을 권장합니다.
                      <button type="button" className="upload-mv-warning__btn" onClick={() => {
                        setMvStep(0);
                        setMvJob(null);
                        setMvJobId(null);
                        setScenesInvalidated(false);
                      }}>씬 초기화</button>
                    </div>
                  )}

                  {/* Scenario display (visible when step >= 2 and scenario exists) — v45 */}
                  {mvStep >= 2 && (mvJob?.scenario_narrative || mvJob?.scenario) && (
                    <div style={{ marginTop: '16px', marginBottom: '16px', background: '#1a1a1a', borderRadius: '12px', border: '1px solid #333', overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => setShowScenario(!showScenario)}
                        style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', color: '#e11d48', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <span>📖 MV 시나리오 보기 {mvJob?.scenario_narrative && <span style={{ color: '#888', fontWeight: 400, fontSize: '12px' }}>· narrative {mvJob.scenario_narrative.length}자</span>}</span>
                        <span>{showScenario ? '▲' : '▼'}</span>
                      </button>
                      {showScenario && (
                        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #333' }}>
                          {/* F4 — v53 cascade 진행률 + 취소. cascade_phase 가 terminal 이 아닐 때만 노출. */}
                          {mvJob.cascade_phase && !['completed', 'cancelled', 'failed'].includes(mvJob.cascade_phase) && (() => {
                            const phaseLabels = {
                              events_extract: '1/5: events 추출 중...',
                              scene_split: '2/5: 씬 분할 중...',
                              scene_image_prompt: '2/5: 씬 image_prompt 생성 중...',
                              scene_image: '3/5: 씬 이미지 생성 중...',
                              scene_video_prompt: '4/5: 씬 video_prompt 생성 중...',
                              video_invalidate: '5/5: 영상 폐기 처리 중...',
                            };
                            const phaseLabel = phaseLabels[mvJob.cascade_phase] || mvJob.cascade_phase;
                            const progress = Math.max(0, Math.min(100, mvJob.cascade_progress || 0));
                            return (
                              <div style={{ marginTop: '14px', padding: '10px 12px', background: '#1f2937', border: '1px solid #fbbf24', borderRadius: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#fbbf24', marginBottom: '6px' }}>
                                  <span style={{ fontWeight: 600 }}>전체 cascade 진행 중</span>
                                  <span style={{ color: '#ddd' }}>· {phaseLabel} ({progress}%)</span>
                                  <button
                                    type="button"
                                    onClick={handleCancelScenarioCascade}
                                    style={{ marginLeft: 'auto', padding: '3px 10px', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                  >⛔ 전체 취소</button>
                                </div>
                                <div style={{ height: '6px', background: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                                  <div style={{ width: `${progress}%`, height: '100%', background: '#fbbf24', transition: 'width 0.4s' }} />
                                </div>
                              </div>
                            );
                          })()}

                          {/* v46: 자동 판단 결과 표시 (사용자가 자동 선택했을 때만) */}
                          {mvJob.scenario_inferred_relationship && (
                            <div style={{ marginTop: '14px', padding: '8px 12px', background: '#0d2a26', border: '1px solid #00d4aa44', borderRadius: '6px', fontSize: '12px', color: '#9ce0ce' }}>
                              <span style={{ fontWeight: 600 }}>관계 (자동 판단):</span>{' '}
                              {({
                                stranger: '우연한 만남',
                                crush: '잠재적 짝사랑',
                                friend: '친구',
                                family: '가족',
                                self: '단독 주인공 캐릭터',
                              })[mvJob.scenario_inferred_relationship] || mvJob.scenario_inferred_relationship}
                            </div>
                          )}

                          {/* v49: 사용자 사건 시드 표시 (시드 truthy 일 때만) */}
                          {mvJob.user_event_seed && (
                            <div style={{ marginTop: '14px', padding: '8px 12px', background: '#2a1a05', border: '1px solid #cc880044', borderRadius: '6px', fontSize: '12px', color: '#e8c87a' }}>
                              <span style={{ fontWeight: 600 }}>📝 사용자 시드:</span>{' '}
                              "{mvJob.user_event_seed}"
                            </div>
                          )}

                          {/* Narrative 본문 (v45 우선, 없으면 legacy scenario fallback) — v53 인라인 편집 + ✏ 배지 */}
                          {(() => {
                            const isEditing = scenarioFieldEdit && scenarioFieldEdit.field === 'narrative';
                            const userEdited = (mvJob.scenario_user_edited_fields || []).includes('narrative');
                            const editingDisabled = mvJob.cascade_phase && !['completed', 'cancelled', 'failed'].includes(mvJob.cascade_phase);
                            const narrativeText = mvJob.scenario_narrative || mvJob.scenario || '';
                            return (
                              <div style={{ marginTop: '14px' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <div style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {mvJob.scenario_narrative ? '서사 (narrative)' : '시나리오 본문'}
                                    {userEdited && renderEditBadge('scenario', null, 'narrative')}
                                    {isEditing && (
                                      <span style={{ marginLeft: '8px', color: '#9ca3af', fontSize: '11px' }}>· {(scenarioFieldEdit.value || '').length}자</span>
                                    )}
                                  </div>
                                  {!isEditing && mvJob.scenario_narrative && (
                                    <button
                                      type="button"
                                      onClick={() => handleScenarioFieldEditStart('narrative', mvJob.scenario_narrative)}
                                      disabled={editingDisabled}
                                      style={{ fontSize: '11px', padding: '2px 8px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '3px', cursor: editingDisabled ? 'not-allowed' : 'pointer' }}
                                    >편집</button>
                                  )}
                                </div>
                                {isEditing ? (
                                  <div>
                                    <textarea
                                      value={scenarioFieldEdit.value}
                                      onChange={(e) => setScenarioFieldEdit({ ...scenarioFieldEdit, value: e.target.value })}
                                      rows={12}
                                      style={{ width: '100%', padding: '8px 10px', background: '#1a1a1a', color: '#eee', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }}
                                    />
                                    <div style={{ marginTop: '6px', display: 'flex', gap: '6px' }}>
                                      <button
                                        type="button"
                                        onClick={handleScenarioFieldEditSave}
                                        disabled={scenarioFieldSaving}
                                        style={{ fontSize: '12px', padding: '5px 14px', background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '4px', cursor: scenarioFieldSaving ? 'wait' : 'pointer' }}
                                      >{scenarioFieldSaving ? '저장 중...' : '저장'}</button>
                                      <button
                                        type="button"
                                        onClick={handleScenarioFieldEditCancel}
                                        disabled={scenarioFieldSaving}
                                        style={{ fontSize: '12px', padding: '5px 14px', background: '#374151', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                                      >취소</button>
                                    </div>
                                  </div>
                                ) : (
                                  <pre style={{ color: '#ddd', fontSize: '13px', whiteSpace: 'pre-wrap', lineHeight: 1.8, fontFamily: 'inherit', margin: 0 }}>
                                    {narrativeText}
                                  </pre>
                                )}
                              </div>
                            );
                          })()}

                          {/* 분리 필드 collapsible (v45 + v53 인라인 편집) */}
                          {(() => {
                            const userEdited = mvJob.scenario_user_edited_fields || [];
                            const editingDisabled = mvJob.cascade_phase && !['completed', 'cancelled', 'failed'].includes(mvJob.cascade_phase);
                            // v53: premise/conflict/emotional_core 등은 LLM 산출물이 비어 있어도 편집 진입 가능하도록 항상 노출.
                            // 기존엔 truthy 체크 + 적어도 1개 있을 때만 collapsible 노출. v53 도 동일 — 단, 빈 필드도 편집할 수 있도록 카드는 항상 출력.
                            const hasAny = mvJob.scenario_premise || mvJob.scenario_central_conflict || mvJob.scenario_emotional_core ||
                              (mvJob.scenario_character_states && Object.keys(mvJob.scenario_character_states).length) ||
                              (mvJob.scenario_narrative_arc && Object.keys(mvJob.scenario_narrative_arc).length);
                            if (!hasAny) return null;

                            const renderTextRow = (fieldKey, label, currentValue) => {
                              const isEditing = scenarioFieldEdit && scenarioFieldEdit.field === fieldKey;
                              const isUserEdited = userEdited.includes(fieldKey);
                              return (
                                <div key={fieldKey} style={{ background: '#0f0f0f', padding: '10px 12px', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <div style={{ color: '#e11d48', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
                                      {label}
                                      {isUserEdited && renderEditBadge('scenario', null, fieldKey)}
                                    </div>
                                    {!isEditing && (
                                      <button
                                        type="button"
                                        onClick={() => handleScenarioFieldEditStart(fieldKey, currentValue || '')}
                                        disabled={editingDisabled}
                                        style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '3px', cursor: editingDisabled ? 'not-allowed' : 'pointer' }}
                                      >편집</button>
                                    )}
                                  </div>
                                  {isEditing ? (
                                    <div>
                                      <textarea
                                        value={scenarioFieldEdit.value}
                                        onChange={(e) => setScenarioFieldEdit({ ...scenarioFieldEdit, value: e.target.value })}
                                        rows={4}
                                        style={{ width: '100%', padding: '6px 8px', background: '#1a1a1a', color: '#eee', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }}
                                      />
                                      <div style={{ marginTop: '4px', display: 'flex', gap: '4px' }}>
                                        <button type="button" onClick={handleScenarioFieldEditSave} disabled={scenarioFieldSaving} style={{ fontSize: '11px', padding: '4px 10px', background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '4px', cursor: scenarioFieldSaving ? 'wait' : 'pointer' }}>{scenarioFieldSaving ? '저장 중...' : '저장'}</button>
                                        <button type="button" onClick={handleScenarioFieldEditCancel} disabled={scenarioFieldSaving} style={{ fontSize: '11px', padding: '4px 10px', background: '#374151', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ color: currentValue ? '#ddd' : '#555', fontSize: '13px', lineHeight: 1.7 }}>{currentValue || '(없음)'}</div>
                                  )}
                                </div>
                              );
                            };

                            const renderDictRow = (fieldKey, label, currentDict, knownKeys) => {
                              const isEditing = scenarioFieldEdit && scenarioFieldEdit.field === fieldKey;
                              const isUserEdited = userEdited.includes(fieldKey);
                              const dict = currentDict || {};
                              const editingDict = (isEditing && typeof scenarioFieldEdit.value === 'object') ? scenarioFieldEdit.value : {};
                              const dictKeys = Array.from(new Set([...(knownKeys || []), ...Object.keys(dict), ...Object.keys(editingDict)]));
                              return (
                                <div key={fieldKey} style={{ background: '#0f0f0f', padding: '10px 12px', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <div style={{ color: '#e11d48', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
                                      {label}
                                      {isUserEdited && renderEditBadge('scenario', null, fieldKey)}
                                    </div>
                                    {!isEditing && (
                                      <button
                                        type="button"
                                        onClick={() => handleScenarioFieldEditStart(fieldKey, dict)}
                                        disabled={editingDisabled}
                                        style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '3px', cursor: editingDisabled ? 'not-allowed' : 'pointer' }}
                                      >편집</button>
                                    )}
                                  </div>
                                  {isEditing ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                      {dictKeys.map((k) => (
                                        <div key={k}>
                                          <div style={{ color: '#bbb', fontSize: '11px', fontWeight: 600, marginBottom: '2px' }}>{k}</div>
                                          <textarea
                                            value={editingDict[k] || ''}
                                            onChange={(e) => setScenarioFieldEdit({ ...scenarioFieldEdit, value: { ...editingDict, [k]: e.target.value } })}
                                            rows={2}
                                            style={{ width: '100%', padding: '5px 7px', background: '#1a1a1a', color: '#eee', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                                          />
                                        </div>
                                      ))}
                                      <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                                        <button type="button" onClick={handleScenarioFieldEditSave} disabled={scenarioFieldSaving} style={{ fontSize: '11px', padding: '4px 10px', background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '4px', cursor: scenarioFieldSaving ? 'wait' : 'pointer' }}>{scenarioFieldSaving ? '저장 중...' : '저장'}</button>
                                        <button type="button" onClick={handleScenarioFieldEditCancel} disabled={scenarioFieldSaving} style={{ fontSize: '11px', padding: '4px 10px', background: '#374151', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      {dictKeys.map((k) => dict[k] && (
                                        <div key={k} style={{ color: '#ddd', fontSize: '13px', lineHeight: 1.7, marginTop: '4px' }}>
                                          <span style={{ color: '#bbb', fontWeight: 600 }}>{k}:</span> {String(dict[k])}
                                        </div>
                                      ))}
                                      {Object.keys(dict).length === 0 && <div style={{ color: '#555', fontSize: '12px' }}>(없음)</div>}
                                    </>
                                  )}
                                </div>
                              );
                            };

                            return (
                              <div style={{ marginTop: '14px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                                <button
                                  type="button"
                                  onClick={() => setShowScenarioFields(!showScenarioFields)}
                                  style={{ width: '100%', padding: '6px 0', background: 'transparent', border: 'none', color: '#bbb', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                >
                                  <span>🔍 시나리오 분해 (전제·갈등·감정 코어·서사 구조)</span>
                                  <span>{showScenarioFields ? '▲' : '▼'}</span>
                                </button>
                                {showScenarioFields && (
                                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {renderTextRow('premise', '전제 (premise)', mvJob.scenario_premise)}
                                    {renderTextRow('central_conflict', '핵심 갈등', mvJob.scenario_central_conflict)}
                                    {renderTextRow('emotional_core', '감정 코어', mvJob.scenario_emotional_core)}
                                    {renderDictRow('character_states', '캐릭터 내면 상태', mvJob.scenario_character_states, [])}
                                    {renderDictRow('narrative_arc', '서사 구조 (4-Act)', mvJob.scenario_narrative_arc, ['setup', 'trigger', 'climax', 'resolution'])}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* 사건 목록 (events) collapsible (v45) */}
                          {Array.isArray(mvJob.scenario_events) && mvJob.scenario_events.length > 0 && (
                            <div style={{ marginTop: '14px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                              <button
                                type="button"
                                onClick={() => setShowScenarioEvents(!showScenarioEvents)}
                                style={{ width: '100%', padding: '6px 0', background: 'transparent', border: 'none', color: '#bbb', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              >
                                <span>🎬 사건 목록 ({mvJob.scenario_events.length}개)</span>
                                <span>{showScenarioEvents ? '▲' : '▼'}</span>
                              </button>
                              {showScenarioEvents && (
                                <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                                  {mvJob.scenario_events.map((ev, idx) => {
                                    // v52 — event 단위 편집 + 매핑 씬 안내 + 진행률 + 취소.
                                    const eventOrder = ev.order ?? idx + 1;
                                    const eventEditedFields = ev.user_edited_fields || [];
                                    const affectedScenes = getEventAffectedScenes(eventOrder);
                                    const affectedNumbers = affectedScenes.map((s) => s.scene_number);
                                    const runningScenes = affectedScenes.filter((s) => s.cascade_status === 'running');
                                    const cascadeRunning = runningScenes.length > 0;
                                    let avgProgress = 0;
                                    if (affectedScenes.length > 0) {
                                      const sum = affectedScenes.reduce(
                                        (acc, s) => acc + Math.max(0, Math.min(100, s.cascade_progress || 0)),
                                        0,
                                      );
                                      avgProgress = Math.round(sum / affectedScenes.length);
                                    }
                                    // v52 — 한 카드 안 5개 필드를 일관된 형태로 렌더하기 위한 정의 list.
                                    const FIELD_DEFS = [
                                      { key: 'trigger', label: '트리거', type: 'text' },
                                      { key: 'protagonist_action', label: '행동', type: 'text' },
                                      { key: 'motivation', label: '동기', type: 'text' },
                                      { key: 'emotion_shift', label: '감정', type: 'text' },
                                      { key: 'props', label: '소품', type: 'list' },
                                    ];
                                    const fullCascadeRunning = mvJob.cascade_phase && !['completed', 'cancelled', 'failed'].includes(mvJob.cascade_phase);
                                    const arrayBusy = eventArrayBusy || fullCascadeRunning;
                                    return (
                                      <div key={idx} style={{ background: '#0f0f0f', padding: '10px 12px', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px', gap: '6px' }}>
                                          <span style={{ color: '#e11d48', fontSize: '12px', fontWeight: 700 }}>#{eventOrder} · {ev.section || '-'}</span>
                                          {ev.setting && <span style={{ color: '#888', fontSize: '11px', flex: 1 }}>{ev.setting}</span>}
                                          {/* v53 — 이벤트 삭제 */}
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteEvent(eventOrder)}
                                            disabled={arrayBusy}
                                            title="이 event 삭제"
                                            style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: '3px', cursor: arrayBusy ? 'not-allowed' : 'pointer' }}
                                          >🗑 삭제</button>
                                        </div>
                                        {/* F2 — 영향 받는 씬 안내 */}
                                        <div style={{ marginBottom: '6px', fontSize: '11px', color: '#888' }}>
                                          {affectedNumbers.length > 0 ? (
                                            <span>이 event 가 영향을 주는 씬: <span style={{ color: '#bbb', fontWeight: 600 }}>{affectedNumbers.join(', ')}</span></span>
                                          ) : (
                                            <span style={{ color: '#666' }}>이 event 는 씬에 매핑되지 않았습니다 (cascade 없음)</span>
                                          )}
                                        </div>
                                        {/* F3 — cascade 진행률 + 취소 (event 단위 평균) */}
                                        {cascadeRunning && (
                                          <div style={{ marginBottom: '6px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#fbbf24', marginBottom: '3px' }}>
                                              <span>재생성 중 ({runningScenes.length}/{affectedScenes.length}) · {avgProgress}%</span>
                                              <button
                                                type="button"
                                                onClick={() => handleCancelEventCascade(eventOrder)}
                                                style={{ marginLeft: 'auto', padding: '2px 8px', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
                                              >⛔ 취소</button>
                                            </div>
                                            <div style={{ height: '4px', background: '#1f2937', borderRadius: '2px', overflow: 'hidden' }}>
                                              <div style={{ width: `${avgProgress}%`, height: '100%', background: '#fbbf24', transition: 'width 0.3s' }} />
                                            </div>
                                          </div>
                                        )}
                                        {/* F1+F4 — 5개 필드 인라인 편집 + ✏ 배지 */}
                                        {FIELD_DEFS.map((def) => {
                                          const val = ev[def.key];
                                          const hasContent = def.type === 'list' ? Array.isArray(val) && val.length > 0 : !!val;
                                          const isEditingThis = eventEdit && eventEdit.event_order === eventOrder && eventEdit.field === def.key;
                                          const userEditedThis = eventEditedFields.includes(def.key);
                                          // 빈 필드도 편집 진입을 위해 카드 출력은 항상 표시.
                                          return (
                                            <div key={def.key} style={{ marginBottom: '4px', fontSize: '12px', lineHeight: 1.6 }}>
                                              {isEditingThis ? (
                                                <div>
                                                  <div style={{ marginBottom: '4px', fontSize: '11px', color: '#888' }}>
                                                    <span style={{ fontWeight: 600 }}>{def.label}</span>
                                                    {def.type === 'list' && <span style={{ marginLeft: '6px', color: '#666' }}>(줄바꿈으로 구분)</span>}
                                                  </div>
                                                  <textarea
                                                    value={eventEdit.value}
                                                    onChange={(e) => setEventEdit({ ...eventEdit, value: e.target.value })}
                                                    rows={def.type === 'list' ? 3 : 2}
                                                    style={{ width: '100%', padding: '6px 8px', background: '#1a1a1a', color: '#eee', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '11px', resize: 'vertical', fontFamily: 'inherit' }}
                                                  />
                                                  <div style={{ marginTop: '4px', display: 'flex', gap: '4px' }}>
                                                    <button
                                                      type="button"
                                                      onClick={handleEventEditSave}
                                                      disabled={eventEditSaving}
                                                      style={{ fontSize: '11px', padding: '4px 10px', background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '4px', cursor: eventEditSaving ? 'wait' : 'pointer' }}
                                                    >{eventEditSaving ? '저장 중...' : '저장'}</button>
                                                    <button
                                                      type="button"
                                                      onClick={handleEventEditCancel}
                                                      disabled={eventEditSaving}
                                                      style={{ fontSize: '11px', padding: '4px 10px', background: '#374151', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                                                    >취소</button>
                                                  </div>
                                                  {affectedNumbers.length > 0 && (
                                                    <div style={{ marginTop: '4px', fontSize: '10px', color: '#888' }}>
                                                      저장 시 영향 받는 씬: {affectedNumbers.join(', ')}
                                                    </div>
                                                  )}
                                                </div>
                                              ) : (
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                                  <span style={{ color: '#888', fontWeight: 600, flexShrink: 0 }}>
                                                    {def.label}
                                                    {userEditedThis && renderEditBadge('event', eventOrder, def.key, '10px')}
                                                    :
                                                  </span>
                                                  <span style={{ color: hasContent ? '#ddd' : '#555', flex: 1 }}>
                                                    {def.type === 'list'
                                                      ? (Array.isArray(val) && val.length > 0 ? val.join(', ') : '(없음)')
                                                      : (val || '(없음)')}
                                                  </span>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleEventEditStart(eventOrder, def.key, val)}
                                                    disabled={eventEditSaving || cascadeRunning}
                                                    style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '3px', cursor: cascadeRunning ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                                                  >편집</button>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {/* 등장인물 (편집 불가 — v52 범위 밖) */}
                                        {Array.isArray(ev.other_characters) && ev.other_characters.length > 0 && (
                                          <div style={{ color: '#ddd', fontSize: '12px', lineHeight: 1.6, marginTop: '4px' }}>
                                            <span style={{ color: '#888', fontWeight: 600 }}>등장:</span> {ev.other_characters.join(', ')}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {/* v53 — events 추가 타일 */}
                                  <button
                                    type="button"
                                    onClick={handleAddEvent}
                                    disabled={eventArrayBusy || (mvJob.cascade_phase && !['completed', 'cancelled', 'failed'].includes(mvJob.cascade_phase))}
                                    style={{
                                      background: 'transparent',
                                      padding: '20px 12px',
                                      borderRadius: '8px',
                                      border: '2px dashed #444',
                                      color: '#888',
                                      fontSize: '13px',
                                      cursor: 'pointer',
                                      minHeight: '120px',
                                    }}
                                  >＋ event 추가</button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* v53 — [전체 저장 + 모든 씬 재생성] 버튼 + 충돌 다이얼로그 */}
                          {(mvJob.scenario_narrative || mvJob.scenario) && (() => {
                            const cascadeRunning = mvJob.cascade_phase && !['completed', 'cancelled', 'failed'].includes(mvJob.cascade_phase);
                            const hasUserEditedTopLevel = (mvJob.scenario_user_edited_fields || []).length > 0;
                            const disabled = cascadeRunning || scenarioCascadeBusy;
                            return (
                              <div style={{ marginTop: '14px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                                {hasUserEditedTopLevel && (
                                  <div style={{ marginBottom: '8px', fontSize: '11px', color: '#fbbf24' }}>
                                    ✏ 사용자 편집한 시나리오 필드: {mvJob.scenario_user_edited_fields.join(', ')}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={handleStartScenarioCascade}
                                  disabled={disabled}
                                  style={{ width: '100%', padding: '12px 16px', background: disabled ? '#374151' : '#dc2626', border: 'none', color: '#fff', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }}
                                >
                                  {scenarioCascadeBusy ? '시작 중...' : (cascadeRunning ? '재생성 진행 중...' : '🔁 전체 저장 + 모든 씬 재생성')}
                                </button>
                                {!hasUserEditedTopLevel && !cascadeRunning && (
                                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#666' }}>
                                    시나리오 필드 또는 events 를 편집한 뒤 이 버튼으로 모든 씬을 한 번에 재생성하세요.
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* v54 — 📌 사용자 편집 현황 collapsible 패널 */}
                          {(mvJob.scenario_narrative || mvJob.scenario) && (
                            <div style={{ marginTop: '14px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                              <button
                                type="button"
                                onClick={toggleUserEditedSummaryPanel}
                                style={{ width: '100%', padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', color: '#bbb', borderRadius: '6px', fontSize: '12px', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              >
                                <span>📌 사용자 편집 현황</span>
                                <span style={{ color: '#666' }}>{userEditedSummaryOpen ? '▲' : '▼'}</span>
                              </button>
                              {userEditedSummaryOpen && (
                                <div style={{ marginTop: '8px', padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '12px' }}>
                                  {(() => {
                                    const sum = userEditedSummary || { scenario: [], events: {}, scenes: {} };
                                    const scenarioCount = (sum.scenario || []).length;
                                    const eventsCount = Object.keys(sum.events || {}).length;
                                    const scenesCount = Object.keys(sum.scenes || {}).length;
                                    const totalCount = scenarioCount + eventsCount + scenesCount;
                                    if (totalCount === 0) {
                                      return <div style={{ color: '#666' }}>편집된 필드 없음</div>;
                                    }
                                    return (
                                      <div style={{ color: '#ddd' }}>
                                        {scenarioCount > 0 && (
                                          <div style={{ marginBottom: '6px' }}>
                                            <span style={{ color: '#fbbf24', fontWeight: 600 }}>시나리오:</span>{' '}
                                            <span style={{ color: '#bbb' }}>{(sum.scenario || []).join(', ')}</span>
                                          </div>
                                        )}
                                        {eventsCount > 0 && (
                                          <div style={{ marginBottom: '6px' }}>
                                            <div style={{ color: '#fbbf24', fontWeight: 600, marginBottom: '2px' }}>events:</div>
                                            <ul style={{ margin: 0, paddingLeft: '18px', color: '#bbb' }}>
                                              {Object.entries(sum.events || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([order, fields]) => (
                                                <li key={order} style={{ fontSize: '12px' }}>event {order}: {(fields || []).join(', ')}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {scenesCount > 0 && (
                                          <div style={{ marginBottom: '6px' }}>
                                            <div style={{ color: '#fbbf24', fontWeight: 600, marginBottom: '2px' }}>씬:</div>
                                            <ul style={{ margin: 0, paddingLeft: '18px', color: '#bbb' }}>
                                              {Object.entries(sum.scenes || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([sn, fields]) => (
                                                <li key={sn} style={{ fontSize: '12px' }}>씬 {sn}: {(fields || []).join(', ')}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        <div style={{ marginTop: '10px', textAlign: 'right' }}>
                                          <button
                                            type="button"
                                            onClick={() => setResetAllConfirm(true)}
                                            disabled={resetBusy}
                                            style={{ fontSize: '11px', padding: '5px 12px', background: '#dc2626', border: 'none', color: '#fff', borderRadius: '4px', cursor: resetBusy ? 'wait' : 'pointer' }}
                                          >모두 해제</button>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                          )}

                          {/* v54 — [모두 해제] 확인 다이얼로그 */}
                          {resetAllConfirm && (
                            <div
                              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
                              onClick={() => !resetBusy && setResetAllConfirm(false)}
                            >
                              <div
                                style={{ background: '#1a1a1a', border: '1px solid #fbbf24', borderRadius: '12px', padding: '20px 24px', maxWidth: '420px', width: '90%' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ color: '#fbbf24', fontSize: '15px', fontWeight: 700, marginBottom: '10px' }}>모두 해제</div>
                                <div style={{ color: '#ddd', fontSize: '13px', lineHeight: 1.6 }}>
                                  3 레벨 (시나리오 / events / 씬) 모든 사용자 편집 표시를 해제합니다. cascade 시 이 필드들이 더 이상 보존되지 않습니다.
                                </div>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
                                  <button
                                    type="button"
                                    onClick={() => setResetAllConfirm(false)}
                                    disabled={resetBusy}
                                    style={{ padding: '8px 16px', background: '#374151', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                                  >취소</button>
                                  <button
                                    type="button"
                                    onClick={handleResetAllUserEdits}
                                    disabled={resetBusy}
                                    style={{ padding: '8px 16px', background: '#dc2626', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '13px', cursor: resetBusy ? 'wait' : 'pointer' }}
                                  >{resetBusy ? '해제 중...' : '모두 해제'}</button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* v54 — ✏ 배지 클릭 시 미니 메뉴 (드롭다운) */}
                          {editBadgeMenu && (
                            <>
                              <div
                                style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                                onClick={closeEditBadgeMenu}
                              />
                              <div
                                style={{
                                  position: 'fixed',
                                  left: Math.min(editBadgeMenu.anchor.x, window.innerWidth - 180),
                                  top: editBadgeMenu.anchor.y,
                                  background: '#1a1a1a',
                                  border: '1px solid #444',
                                  borderRadius: '6px',
                                  padding: '4px',
                                  zIndex: 9999,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                  minWidth: '160px',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={handleResetSingleField}
                                  disabled={resetBusy}
                                  style={{ display: 'block', width: '100%', padding: '6px 10px', background: 'transparent', border: 'none', color: '#ddd', fontSize: '12px', textAlign: 'left', cursor: resetBusy ? 'wait' : 'pointer', borderRadius: '4px' }}
                                >{resetBusy ? '해제 중...' : '편집 표시 해제'}</button>
                                <button
                                  type="button"
                                  onClick={closeEditBadgeMenu}
                                  disabled={resetBusy}
                                  style={{ display: 'block', width: '100%', padding: '6px 10px', background: 'transparent', border: 'none', color: '#bbb', fontSize: '12px', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                                >그대로 유지</button>
                              </div>
                            </>
                          )}

                          {/* v53 — 충돌 다이얼로그 (모달) */}
                          {scenarioCascadeDialog && (
                            <div
                              style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                              }}
                              onClick={() => !scenarioCascadeBusy && setScenarioCascadeDialog(null)}
                            >
                              <div
                                style={{ background: '#1a1a1a', border: '1px solid #fbbf24', borderRadius: '12px', padding: '20px 24px', maxWidth: '520px', width: '90%' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ color: '#fbbf24', fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>⚠ 전체 재생성 시 영향</div>
                                {scenarioCascadeDialog.userEditedScenes.length > 0 && (
                                  <div style={{ marginBottom: '10px', fontSize: '13px', color: '#ddd' }}>
                                    <div style={{ marginBottom: '4px' }}>전체 재생성 시 다음 씬 편집 사항이 폐기됩니다:</div>
                                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#bbb' }}>
                                      {scenarioCascadeDialog.userEditedScenes.map((s) => (
                                        <li key={s.scene_number} style={{ fontSize: '12px' }}>
                                          씬 {s.scene_number} ({(s.fields || []).join(', ')} 직접 편집)
                                        </li>
                                      ))}
                                    </ul>
                                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>이전 씬 배열은 archive 에 보관됩니다 (롤백 가능).</div>
                                  </div>
                                )}
                                {scenarioCascadeDialog.completedVideoScenes.length > 0 && (
                                  <div style={{ marginBottom: '10px', fontSize: '13px', color: '#ddd' }}>
                                    ⚠ 영상 (Phase 3) 까지 만들어진 씬 {scenarioCascadeDialog.completedVideoScenes.length}개도 폐기됩니다 (마킹).
                                    <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>영상 다시 만들려면 추가 비용 발생.</div>
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
                                  <button
                                    type="button"
                                    onClick={() => setScenarioCascadeDialog(null)}
                                    disabled={scenarioCascadeBusy}
                                    style={{ padding: '8px 16px', background: '#374151', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                                  >취소</button>
                                  <button
                                    type="button"
                                    onClick={confirmStartScenarioCascade}
                                    disabled={scenarioCascadeBusy}
                                    style={{ padding: '8px 16px', background: '#dc2626', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '13px', cursor: scenarioCascadeBusy ? 'wait' : 'pointer' }}
                                  >{scenarioCascadeBusy ? '시작 중...' : '폐기하고 재생성'}</button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* v48 — 곡 톤·장르 → archetype 가중치 매칭 박스 */}
                          {mvJob.scenario_archetype_weights && typeof mvJob.scenario_archetype_weights === 'object' && Object.keys(mvJob.scenario_archetype_weights).length > 0 && (() => {
                            const weights = mvJob.scenario_archetype_weights || {};
                            const entries = Object.entries(weights).sort((a, b) => (b[1] || 0) - (a[1] || 0));
                            const top3 = entries.slice(0, 3);
                            const maxVal = top3.length > 0 ? (top3[0][1] || 0) : 1;
                            // DEV 가드 — collapsible 첫 렌더 시 1회 로그
                            if (import.meta.env.DEV) {
                              try {
                                console.info('[MVStudio] archetype weights', {
                                  top3: top3.map(([k, v]) => [k, Math.round((v || 0) * 1000) / 1000]),
                                  all: entries.map(([k, v]) => [k, Math.round((v || 0) * 1000) / 1000]),
                                });
                              } catch (logErr) {
                                console.error('[MVStudio] archetype weights log failed', { err: String(logErr) });
                              }
                            }
                            return (
                              <div style={{ marginTop: '14px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                  <span style={{ color: '#bbb', fontSize: '13px', fontWeight: 600 }}>🎯 곡 톤 매칭 (archetype 가중치)</span>
                                  <span style={{ color: '#666', fontSize: '11px' }}>· 상위 3개</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                                  {top3.map(([key, val]) => {
                                    const label = ARCHETYPE_LABELS[key] || key;
                                    const pct = Math.round((val || 0) * 1000) / 10; // % 1 decimal
                                    const barWidth = maxVal > 0 ? Math.round(((val || 0) / maxVal) * 100) : 0;
                                    return (
                                      <div key={key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ color: '#ddd', fontSize: '12px', fontWeight: 500 }}>{label}</span>
                                        <div style={{ position: 'relative', height: '8px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
                                          <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${barWidth}%`, background: '#e11d48', borderRadius: '4px' }} />
                                        </div>
                                        <span style={{ color: '#888', fontSize: '11px', textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <details style={{ marginTop: '8px' }}>
                                  <summary style={{ color: '#666', fontSize: '11px', cursor: 'pointer' }}>전체 7개 archetype 보기</summary>
                                  <div style={{ marginTop: '6px', display: 'grid', gridTemplateColumns: '1fr', gap: '4px' }}>
                                    {entries.map(([key, val]) => {
                                      const label = ARCHETYPE_LABELS[key] || key;
                                      const pct = Math.round((val || 0) * 1000) / 10;
                                      return (
                                        <div key={key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', alignItems: 'center', gap: '8px' }}>
                                          <span style={{ color: '#aaa', fontSize: '11px' }}>{label}</span>
                                          <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${maxVal > 0 ? Math.round(((val || 0) / maxVal) * 100) : 0}%`, background: '#a13' }} />
                                          </div>
                                          <span style={{ color: '#666', fontSize: '10px', textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              </div>
                            );
                          })()}

                          {/* v47 — 브레인스토밍 후보 (Stage 1 plot archetype 다양성) */}
                          {Array.isArray(mvJob.scenario_brainstorm?.candidates) && mvJob.scenario_brainstorm.candidates.length > 0 && (
                            <div style={{ marginTop: '14px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = !showBrainstorm;
                                  setShowBrainstorm(next);
                                  if (next && import.meta.env.DEV) {
                                    try {
                                      const cands = mvJob.scenario_brainstorm.candidates || [];
                                      const archetypes = cands.map((c) => c?.plot_archetype || null);
                                      console.info('[MVStudio] brainstorm candidates', {
                                        count: cands.length,
                                        archetypes,
                                        selected: mvJob.scenario_selected_archetype || null,
                                      });
                                      const missing = archetypes.filter((a) => !a).length;
                                      if (missing > 0) {
                                        console.warn('[MVStudio] brainstorm missing archetype', { missing, total: cands.length });
                                      }
                                    } catch (logErr) {
                                      console.error('[MVStudio] brainstorm log failed', { err: String(logErr) });
                                    }
                                  }
                                }}
                                style={{ width: '100%', padding: '6px 0', background: 'transparent', border: 'none', color: '#bbb', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              >
                                <span>🧠 브레인스토밍 후보 ({mvJob.scenario_brainstorm.candidates.length}개)
                                  {mvJob.scenario_selected_archetype && (
                                    <span style={{ color: '#888', fontWeight: 400, fontSize: '12px', marginLeft: '8px' }}>· 채택: {ARCHETYPE_LABELS[mvJob.scenario_selected_archetype] || mvJob.scenario_selected_archetype}</span>
                                  )}
                                </span>
                                <span>{showBrainstorm ? '▲' : '▼'}</span>
                              </button>
                              {showBrainstorm && (
                                <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                                  {mvJob.scenario_brainstorm.candidates.map((c, idx) => {
                                    const archetypeKey = c?.plot_archetype || null;
                                    const archetypeLabel = archetypeKey ? (ARCHETYPE_LABELS[archetypeKey] || archetypeKey) : '-';
                                    const isSelected = !!(mvJob.scenario_selected_archetype && archetypeKey && mvJob.scenario_selected_archetype === archetypeKey);
                                    return (
                                      <div
                                        key={idx}
                                        style={{
                                          background: isSelected ? '#1a0d18' : '#0f0f0f',
                                          padding: '10px 12px',
                                          borderRadius: '8px',
                                          border: isSelected ? '1px solid #e11d48' : '1px solid #2a2a2a',
                                        }}
                                      >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px', gap: '8px' }}>
                                          <span style={{ color: '#e11d48', fontSize: '12px', fontWeight: 700 }}>
                                            #{idx + 1} · {archetypeLabel}
                                            {isSelected && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#fff', background: '#e11d48', padding: '1px 6px', borderRadius: '3px' }}>채택</span>}
                                          </span>
                                          {c?.tone && <span style={{ color: '#888', fontSize: '11px' }}>{c.tone}</span>}
                                        </div>
                                        {c?.premise_summary && (
                                          <div style={{ color: '#ddd', fontSize: '12px', lineHeight: 1.6, marginBottom: '4px' }}>
                                            <span style={{ color: '#888', fontWeight: 600 }}>전제:</span> {c.premise_summary}
                                          </div>
                                        )}
                                        {c?.central_conflict && (
                                          <div style={{ color: '#ddd', fontSize: '12px', lineHeight: 1.6, marginBottom: '4px' }}>
                                            <span style={{ color: '#888', fontWeight: 600 }}>갈등:</span> {c.central_conflict}
                                          </div>
                                        )}
                                        {c?.mood_arc && (
                                          <div style={{ color: '#ddd', fontSize: '12px', lineHeight: 1.6, marginBottom: '4px' }}>
                                            <span style={{ color: '#888', fontWeight: 600 }}>무드:</span> {c.mood_arc}
                                          </div>
                                        )}
                                        {Array.isArray(c?.key_events) && c.key_events.length > 0 && (
                                          <div style={{ color: '#ddd', fontSize: '12px', lineHeight: 1.6, marginTop: '4px' }}>
                                            <div style={{ color: '#888', fontWeight: 600, marginBottom: '2px' }}>주요 사건:</div>
                                            <ul style={{ margin: 0, paddingLeft: '18px' }}>
                                              {c.key_events.map((ke, kidx) => (
                                                <li key={kidx} style={{ marginBottom: '2px' }}>{ke}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* v61: 주인공/장소 자산 갤러리 — Phase 1.5 에서 생성된 캐릭터·장소 시트. 클릭 시 확대. */}
                  {mvJob?.assets && Object.keys(mvJob.assets).length > 0 && (
                    <div className="upload-mv-scenes-list" style={{ marginBottom: '12px' }}>
                      <div className="upload-mv-scenes-list__label">
                        주인공/장소 자산 ({Object.keys(mvJob.assets).length}개)
                      </div>
                      <div className="upload-mv-scenes-list__grid">
                        {Object.entries(mvJob.assets)
                          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                          .map(([key, asset]) => {
                            const isChar = (asset?.type || '').toLowerCase() === 'character';
                            const labelKo = isChar ? '주인공' : '장소';
                            const title = `${labelKo} (${key})${asset?.name ? ` · ${asset.name}` : ''}`;
                            const subtitle = asset?.description || '';
                            return (
                              <div
                                key={key}
                                className="upload-mv-scene-card upload-mv-scene-card--asset"
                                style={{ cursor: asset?.image_url ? 'pointer' : 'default' }}
                                onClick={() => {
                                  if (!asset?.image_url) return;
                                  if (import.meta.env.DEV) {
                                    console.info('[MVStudio] asset clicked', { key, type: asset?.type });
                                  }
                                  if (onRequestLightbox) onRequestLightbox({ url: asset.image_url, title, subtitle });
                                }}
                              >
                                <div className="upload-mv-scene-card__img-wrap">
                                  {asset?.image_url ? (
                                    <img
                                      src={asset.image_url}
                                      alt={title}
                                      className="upload-mv-scene-card__img"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="upload-mv-scene-card__placeholder">
                                      <FiImage /> 자산 없음
                                    </div>
                                  )}
                                </div>
                                <div className="upload-mv-scene-card__meta">
                                  <div className="upload-mv-scene-card__num">
                                    {isChar ? '🧑' : '📍'} {labelKo} ({key})
                                  </div>
                                  {asset?.name && (
                                    <div className="upload-mv-scene-card__section" title={asset.name}>
                                      {asset.name}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Scenes list (visible when step >= 2) */}
                  {mvStep >= 2 && mvJob?.scenes && mvJob.scenes.length > 0 && (
                    <div className="upload-mv-scenes-list">
                      <div className="upload-mv-scenes-list__label">
                        생성된 장면 ({getCompletedImageCount()}/{mvJob.scenes.length})
                      </div>
                      {/* v73-fix — 실패 씬 이미지 일괄 재생성 (image_status 필드 부재로 현재 미노출) */}
                      {failedImageScenes > 0 && (
                        <button
                          type="button"
                          className="upload-mv-warning__btn"
                          onClick={handleBatchRegenerateFailedImages}
                          disabled={isMvBusy}
                        >
                          🔁 실패 씬 이미지 일괄 재생성 ({failedImageScenes}개)
                        </button>
                      )}
                      <div className="upload-mv-scenes-list__grid">
                        {mvJob.scenes.map((scene, i) => (
                          <div key={scene.scene_number || i} className="upload-mv-scene-card">
                            <div className="upload-mv-scene-card__img-wrap">
                              {scene.image_url ? (
                                <img
                                  src={scene.image_url}
                                  alt={`씬 ${scene.scene_number || i + 1}`}
                                  className="upload-mv-scene-card__img"
                                  onClick={() => setSelectedScene(scene)}
                                  style={{ cursor: 'pointer' }}
                                />
                              ) : (
                                <div className="upload-mv-scene-card__img-placeholder">
                                  <FiImage />
                                </div>
                              )}
                              {/* Video status overlay */}
                              {scene.video_url && (
                                <div
                                  className="upload-mv-scene-card__video-overlay"
                                  onClick={(e) => { e.stopPropagation(); setSelectedVideo(scene); }}
                                >
                                  <FiPlay className="upload-mv-scene-card__play-icon" />
                                </div>
                              )}
                              {scene.video_status === 'generating' && (
                                <div className="upload-mv-scene-card__video-generating">
                                  <FiLoader className="upload-mv-scene-card__spinner" />
                                  생성중
                                </div>
                              )}
                              {scene.video_status === 'pending' && !scene.video_url && scene.video_status !== 'generating' && (
                                <div className="upload-mv-scene-card__video-pending">
                                  ⏳
                                </div>
                              )}
                              {scene.video_status === 'failed' && (
                                <div className="upload-mv-scene-card__video-failed">
                                  ❌ 실패
                                </div>
                              )}
                            </div>
                            <div className="upload-mv-scene-card__info">
                              {(scene.section || scene.use_seconds || scene.scene_type) && (
                                <div className="upload-mv-scene-card__section-info">
                                  {scene.section && <span className="upload-mv-scene-card__section-label">{scene.section}</span>}
                                  {scene.scene_type === 'lipsync' && <span className="upload-mv-scene-card__lipsync-badge">🎤 립싱크</span>}
                                  {scene.use_seconds && <span className="upload-mv-scene-card__use-seconds">{scene.use_seconds.toFixed(1)}s</span>}
                                  {scene.section_mood && <span className="upload-mv-scene-card__section-mood">{scene.section_mood}</span>}
                                </div>
                              )}
                              <div className="upload-mv-scene-card__desc">
                                {scene.description_ko || scene.description || `씬 ${scene.scene_number || i + 1}`}
                              </div>
                              {/* v51 — Scene-level field edit + cascade progress + ✏ user-edited badges */}
                              {/* v56 — 한국어(편집 가능) + 영어(자동 동기화, collapsible) 병존 */}
                              {(() => {
                                const sceneNum = scene.scene_number || i + 1;
                                const cascadeRunning = scene.cascade_status === 'running';
                                const cascadeProgress = Math.max(0, Math.min(100, scene.cascade_progress || 0));
                                const editedFields = scene.user_edited_fields || [];
                                // v56 — fieldKey 인자는 한국어(_ko)필드명. enFieldKey 는 대응 영어 필드명.
                                const renderField = (label, koFieldKey, enFieldKey, koValue, enValue) => {
                                  const isEditingThis = sceneEdit && sceneEdit.scene_number === sceneNum && sceneEdit.field === koFieldKey;
                                  const isUserEditedKo = editedFields.includes(koFieldKey);
                                  const isUserEditedEn = editedFields.includes(enFieldKey);
                                  return (
                                    <div className="upload-mv-scene-card__edit-row" key={koFieldKey} style={{ marginTop: '6px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#999' }}>
                                        <span>{label} <span style={{ color: '#666' }}>(한국어 — 편집 가능)</span></span>
                                        {(isUserEditedKo || isUserEditedEn) && (
                                          <span
                                            title="직접 편집된 필드 — cascade 시 보존됩니다"
                                            onClick={(e) => openEditBadgeMenu(e, 'scene', sceneNum, isUserEditedKo ? koFieldKey : enFieldKey)}
                                            style={{ color: '#3b82f6', cursor: 'pointer', userSelect: 'none' }}
                                          >✏</span>
                                        )}
                                        {!isEditingThis && !cascadeRunning && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleSceneEditOpen(sceneNum, koFieldKey, koValue); }}
                                            style={{ marginLeft: 'auto', fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid #444', color: '#bbb', borderRadius: '4px', cursor: 'pointer' }}
                                          >편집</button>
                                        )}
                                      </div>
                                      {isEditingThis ? (
                                        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '4px' }}>
                                          <textarea
                                            value={sceneEdit.value}
                                            onChange={(e) => setSceneEdit({ ...sceneEdit, value: e.target.value })}
                                            rows={3}
                                            placeholder="한국어로 입력하세요. 저장 시 영어로 자동 번역됩니다."
                                            style={{ width: '100%', fontSize: '12px', background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #555', borderRadius: '4px', padding: '6px', boxSizing: 'border-box' }}
                                          />
                                          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                            <button
                                              type="button"
                                              onClick={(e) => { e.stopPropagation(); handleSceneEditSave(); }}
                                              disabled={sceneEditSaving}
                                              style={{ fontSize: '11px', padding: '4px 10px', background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '4px', cursor: sceneEditSaving ? 'wait' : 'pointer' }}
                                            >{sceneEditSaving ? '저장 중...' : '저장'}</button>
                                            <button
                                              type="button"
                                              onClick={(e) => { e.stopPropagation(); handleSceneEditCancel(); }}
                                              disabled={sceneEditSaving}
                                              style={{ fontSize: '11px', padding: '4px 10px', background: 'transparent', border: '1px solid #555', color: '#bbb', borderRadius: '4px', cursor: 'pointer' }}
                                            >취소</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: '11px', color: '#bbb', marginTop: '2px', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {koValue || <span style={{ color: '#666' }}>(비어 있음 — 편집을 눌러 한국어로 입력)</span>}
                                        </div>
                                      )}
                                      {/* v56 — 영어는 read-only collapsible. 이미지/영상 LLM 호출에 사용됨. */}
                                      <details onClick={(e) => e.stopPropagation()} style={{ marginTop: '3px' }}>
                                        <summary style={{ fontSize: '10px', color: '#777', cursor: 'pointer', userSelect: 'none' }}>
                                          영어 보기 (자동 동기화)
                                        </summary>
                                        <div style={{ fontSize: '11px', color: '#888', marginTop: '3px', padding: '4px 6px', background: '#161616', borderRadius: '3px', border: '1px solid #2a2a2a', whiteSpace: 'pre-wrap' }}>
                                          {enValue || <span style={{ color: '#555' }}>(비어 있음 — 한국어 저장 시 자동 번역됩니다)</span>}
                                        </div>
                                      </details>
                                    </div>
                                  );
                                };
                                return (
                                  <div className="upload-mv-scene-card__v51-edit" onClick={(e) => e.stopPropagation()}>
                                    {renderField('description (행동·감정·맥락)', 'description_ko', 'description', scene.description_ko, scene.description)}
                                    {renderField('image_prompt (시각 묘사)', 'image_prompt_ko', 'image_prompt', scene.image_prompt_ko, scene.image_prompt)}
                                    {renderField('video_prompt (카메라 모션)', 'video_prompt_ko', 'video_prompt', scene.video_prompt_ko, scene.video_prompt)}
                                    {cascadeRunning && (
                                      <div style={{ marginTop: '6px', padding: '4px 6px', background: '#1a2540', borderRadius: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ec1ff' }}>
                                          <span>재생성 중...</span>
                                          <span>{cascadeProgress}%</span>
                                        </div>
                                        <div style={{ marginTop: '3px', height: '4px', background: '#0a1424', borderRadius: '2px', overflow: 'hidden' }}>
                                          <div style={{ width: `${cascadeProgress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s' }} />
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); handleCancelCascade(sceneNum); }}
                                          style={{ marginTop: '4px', fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px solid #6b3434', color: '#ff8888', borderRadius: '4px', cursor: 'pointer', width: '100%' }}
                                        >⛔ 취소</button>
                                      </div>
                                    )}
                                    {scene.video_status === 'invalidated_by_cascade' && (
                                      <div style={{ marginTop: '4px', fontSize: '10px', color: '#f4a261' }}>
                                        ⚠ 영상이 무효화됨 (이미지 변경) — 다시 영상 생성을 눌러주세요.
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {scene.lyrics_segment && (
                                <div className="upload-mv-scene-card__lyrics">
                                  {scene.lyrics_segment}
                                </div>
                              )}
                              {scene.image_source && (
                                <div className="upload-mv-scene-card__source">
                                  {scene.image_source === 'upload' ? '직접 업로드' : 'AI 생성'}
                                </div>
                              )}
                              {scene.video_url && (
                                <a
                                  href={scene.video_url}
                                  download
                                  className="upload-mv-scene-card__video-download"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <FiDownload /> 영상
                                </a>
                              )}
                              {/* Lipsync scene actions */}
                              {scene.scene_type === 'lipsync' && scene.video_url && (
                                <div className="upload-mv-scene-card__lipsync-actions">
                                  {scene.video_synclabs_url ? (
                                    <>
                                      <span className="upload-mv-scene-card__sync-done">
                                        ✓ 립싱크 적용{scene.video_source === 'kling+synclabs' ? ' (자동)' : ''}
                                      </span>
                                      <button className="upload-mv-scene-card__sync-try-btn" onClick={(e) => { e.stopPropagation(); handleStartLipsync(scene.scene_number); }} disabled={separatingVocal === scene.scene_number}>
                                        {separatingVocal === scene.scene_number ? '보컬 분리 중...' : '🔄 재시도'}
                                      </button>
                                    </>
                                  ) : scene.sync_error ? (
                                    <>
                                      <span className="upload-mv-scene-card__sync-error-text">
                                        🔇 실패: {scene.sync_error.length > 40 ? scene.sync_error.substring(0, 40) + '...' : scene.sync_error}
                                      </span>
                                      <button className="upload-mv-scene-card__sync-try-btn" onClick={(e) => { e.stopPropagation(); handleStartLipsync(scene.scene_number); }} disabled={separatingVocal === scene.scene_number}>
                                        {separatingVocal === scene.scene_number ? '보컬 분리 중...' : '🔄 재시도'}
                                      </button>
                                    </>
                                  ) : (
                                    <button className="upload-mv-scene-card__sync-try-btn" onClick={(e) => { e.stopPropagation(); handleStartLipsync(scene.scene_number); }} disabled={separatingVocal === scene.scene_number}>
                                      {separatingVocal === scene.scene_number ? '보컬 분리 중...' : '🎤 립싱크 시도'}
                                    </button>
                                  )}
                                </div>
                              )}
                              {/* Non-lipsync sync error fallback */}
                              {scene.scene_type !== 'lipsync' && scene.sync_error && (
                                <div className="upload-mv-scene-card__sync-error">
                                  <span className="upload-mv-scene-card__sync-error-text">
                                    🔇 립싱크 실패: {scene.sync_error.length > 50 ? scene.sync_error.substring(0, 50) + '...' : scene.sync_error}
                                  </span>
                                  <button
                                    className="upload-mv-scene-card__sync-retry-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartLipsync(scene.scene_number);
                                    }}
                                    disabled={separatingVocal === scene.scene_number}
                                  >
                                    {separatingVocal === scene.scene_number ? '보컬 분리 중...' : '🔄 립싱크 재시도'}
                                  </button>
                                </div>
                              )}
                              {scene.scene_type !== 'lipsync' && scene.video_source === 'kling (sync failed)' && !scene.sync_error && (
                                <div className="upload-mv-scene-card__sync-error">
                                  <span className="upload-mv-scene-card__sync-error-text">🔇 립싱크 실패</span>
                                  <button
                                    className="upload-mv-scene-card__sync-retry-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartLipsync(scene.scene_number);
                                    }}
                                    disabled={separatingVocal === scene.scene_number}
                                  >
                                    {separatingVocal === scene.scene_number ? '보컬 분리 중...' : '🔄 립싱크 재시도'}
                                  </button>
                                </div>
                              )}
                              {/* Individual scene video generate button */}
                              {scene.image_url && !scene.video_url && scene.video_status !== 'generating' && (
                                <button
                                  className="upload-mv-scene-card__gen-video-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateSceneVideo(scene.scene_number);
                                  }}
                                  disabled={generatingSceneVideo === scene.scene_number}
                                >
                                  🎬 영상 생성
                                </button>
                              )}
                            </div>
                            {mvStep === 2 && (
                              <div className="upload-mv-scene-card__actions">
                                <button
                                  type="button"
                                  className="upload-mv-scene-card__action-btn"
                                  onClick={() => {
                                    const ref = sceneImageInputRefs.current[scene.scene_number || i + 1];
                                    if (ref) ref.click();
                                  }}
                                  disabled={mvUploadingScene === (scene.scene_number || i + 1)}
                                >
                                  {mvUploadingScene === (scene.scene_number || i + 1) ? (
                                    <><span className="upload-cover-spinner" /> 업로드 중</>
                                  ) : (
                                    <><FiUploadCloud /> 이미지 업로드</>
                                  )}
                                </button>
                                <input
                                  ref={(el) => { sceneImageInputRefs.current[scene.scene_number || i + 1] = el; }}
                                  type="file"
                                  accept={IMAGE_ACCEPT}
                                  style={{ display: 'none' }}
                                  onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (file) handleUploadSceneImage(scene.scene_number || i + 1, file);
                                    e.target.value = '';
                                  }}
                                />
                                <button
                                  type="button"
                                  className="upload-mv-scene-card__action-btn upload-mv-scene-card__action-btn--secondary"
                                  onClick={() => handleRegenerateSceneImage(scene.scene_number || i + 1)}
                                  disabled={mvRegeneratingScene === (scene.scene_number || i + 1)}
                                >
                                  {mvRegeneratingScene === (scene.scene_number || i + 1) ? (
                                    <><span className="upload-cover-spinner" /> 생성 중</>
                                  ) : (
                                    <><FiRefreshCw /> 이미지 재생성</>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* STEP 2: Video Generation */}
                {mvStep >= 2 && (
                  <div className="upload-mv-step">
                    <div className="upload-mv-step__title">STEP 2: 영상 생성</div>

                    {mvStep === 2 && (
                      <>
                        <div className="upload-mv-video-model-selector">
                          {(() => {
                            const vm = mvJob?.video_model || videoModel;
                            const label = vm === 'kling' ? 'Kling V3 (10초)' : vm === 'seedance' ? 'Seedance 2.0 (10초)' : 'Veo 3.1 (8초)';
                            return <div className="upload-mv-video-model-selector__label">선택된 모델: {label}</div>;
                          })()}
                        </div>

                        <button
                          type="button"
                          className="upload-mv-ai-btn"
                          onClick={handleGenerateVideos}
                        >
                          {(() => {
                            const vm = mvJob?.video_model || videoModel;
                            return vm === 'kling' ? 'Kling으로 영상 생성하기' : vm === 'seedance' ? 'Seedance로 영상 생성하기' : 'Veo로 영상 생성하기';
                          })()}
                        </button>
                      </>
                    )}

                    {/* v73-fix — 실패 씬 영상 일괄 재생성 (video_status === 'failed' 만 카운트) */}
                    {failedVideoScenes > 0 && (
                      <button
                        type="button"
                        className="upload-mv-warning__btn"
                        onClick={handleBatchRegenerateFailedVideos}
                        disabled={isMvBusy}
                      >
                        🔁 실패 씬 영상 일괄 재생성 ({failedVideoScenes}개)
                      </button>
                    )}

                    {mvStep === 3 && (
                      <div className="upload-mv-progress">
                        <div className="upload-mv-progress__header">
                          <span className="upload-cover-spinner" />
                          <span>{getStatusText()}</span>
                        </div>
                        <div className="upload-mv-progress__bar">
                          <div className="upload-mv-progress__fill" style={{ width: `${mvJob?.status === 'synclabs_processing' ? mvProgressPct : getVideoProgressPct()}%` }} />
                        </div>
                        <div className="upload-mv-progress__text">
                          {mvJob?.status === 'synclabs_processing'
                            ? `립싱크 ${mvJob.synclabs_completed || 0}/${mvJob.synclabs_total || '?'} (${mvProgressPct}%)`
                            : mvJob ? `영상 ${getCompletedVideoCount()}/${mvJob.total_scenes || 0} (${getVideoProgressPct()}%)` : ''
                          }
                        </div>
                        {mvJob?.retry_info?.active && (
                          <div className="upload-mv-retry-banner">
                            <FiAlertTriangle className="upload-mv-retry-banner__icon" />
                            <div className="upload-mv-retry-banner__content">
                              <span className="upload-mv-retry-banner__title">
                                API 할당량 초과 (429) — 재시도 대기 중
                              </span>
                              <span className="upload-mv-retry-banner__detail">
                                {mvJob.retry_info.attempt}/{mvJob.retry_info.max_retries}번째 시도 · 장면 {mvJob.retry_info.scene_number} · <RetryCountdown retryAt={mvJob.retry_info.retry_at} />
                              </span>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          className="upload-mv-cancel-btn"
                          onClick={handleCancelMV}
                        >
                          <FiX /> 중지하기
                        </button>
                      </div>
                    )}

                    {mvStep === 4 && (
                      <div className="upload-mv-paused-banner">
                        <div className="upload-mv-paused-banner__icon">
                          <FiAlertTriangle />
                        </div>
                        <div className="upload-mv-paused-banner__text">
                          {mvJob?.error_message?.includes('중지') ? '사용자에 의해 중지됨' : 'API 할당량 초과로 일시정지됨'}
                          {mvJob && (
                            <span className="upload-mv-paused-banner__progress">
                              (영상 {getCompletedVideoCount()}/{mvJob.total_scenes || 0} 완료)
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="upload-mv-retry-btn"
                          onClick={handleRetryVideos}
                        >
                          <FiRefreshCw /> 재시도하기
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 3: Merge Audio */}
                {mvStep >= 5 && (
                  <div className="upload-mv-step">
                    <div className="upload-mv-step__title">STEP 3: 뮤직비디오 합치기</div>

                    {/* Video preview (silent) */}
                    {mvPreview && (
                      <div className="upload-mv-merge-preview">
                        <video src={mvPreview} controls muted className="upload-mv-merge-preview__video" />
                        <div className="upload-mv-merge-preview__label">영상 (무음)</div>
                      </div>
                    )}

                    {/* Audio info */}
                    <div className="upload-mv-merge-audio-info">
                      {fromGeneration ? (
                        <div className="upload-mv-merge-audio-badge">
                          <FiMusic />
                          <span>AI 생성 오디오 연결됨</span>
                        </div>
                      ) : audioObjectName ? (
                        <div className="upload-mv-merge-audio-badge">
                          <FiMusic />
                          <span>내 트랙 오디오 연결됨</span>
                        </div>
                      ) : audioFile ? (
                        <div className="upload-mv-merge-audio-badge">
                          <FiMusic />
                          <span>{audioFile.name}</span>
                        </div>
                      ) : (
                        <div className="upload-mv-merge-audio-badge upload-mv-merge-audio-badge--warn">
                          <FiAlertTriangle />
                          <span>오디오 파일이 연결되지 않았습니다</span>
                        </div>
                      )}
                    </div>

                    {mvStep === 5 && !mvMergingAudio && mvJob?.status === 'video_ready' && (
                      <button
                        type="button"
                        className="upload-mv-ai-btn"
                        onClick={handleMergeAudio}
                        disabled={!fromGeneration && !audioObjectName && !audioFile}
                      >
                        뮤직비디오 합치기
                      </button>
                    )}

                    {(mvMergingAudio || mvJob?.status === 'merging_audio') && (
                      <div className="upload-mv-progress">
                        <div className="upload-mv-progress__header">
                          <span className="upload-cover-spinner" />
                          <span>음악과 영상을 합치는 중...</span>
                        </div>
                        <div className="upload-mv-progress__bar">
                          <div className="upload-mv-progress__fill" style={{ width: `${mvProgressPct}%` }} />
                        </div>
                        <div className="upload-mv-progress__text">{mvProgressPct}%</div>
                      </div>
                    )}

                    {mvJob?.error_message && mvJob.status === 'video_ready' && (
                      <div className="upload-mv-warning">
                        {mvJob.error_message}
                      </div>
                    )}
                  </div>
                )}
              </>
          </div>

      {selectedScene && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setSelectedScene(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="upload-mv-scene-modal__close" onClick={() => setSelectedScene(null)}>
              ✕
            </button>

            <div className="upload-mv-scene-modal__image-wrap">
              {selectedScene.image_url ? (
                <img
                  src={selectedScene.image_url}
                  alt={`씬 ${selectedScene.scene_number}`}
                  className="upload-mv-scene-modal__image"
                />
              ) : (
                <div className="upload-mv-scene-modal__placeholder">
                  <FiImage /> 이미지 없음
                </div>
              )}
            </div>

            <div className="upload-mv-scene-modal__info">
              <h3 className="upload-mv-scene-modal__title">
                씬 {selectedScene.scene_number}
                {selectedScene.scene_type === 'lipsync' && (
                  <span className="upload-mv-scene-modal__lipsync-badge">🎤 립싱크</span>
                )}
              </h3>

              {selectedScene.section && (
                <div className="upload-mv-scene-modal__section">
                  {selectedScene.section}
                  {selectedScene.use_seconds && ` (${selectedScene.use_seconds.toFixed(1)}초)`}
                </div>
              )}

              <div className="upload-mv-scene-modal__desc">
                {selectedScene.description_ko || selectedScene.description || '설명 없음'}
              </div>

              {selectedScene.lyrics_segment && (
                <div className="upload-mv-scene-modal__lyrics">
                  <span className="upload-mv-scene-modal__lyrics-label">🎵 가사</span>
                  <p>{selectedScene.lyrics_segment}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedVideo && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setSelectedVideo(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="upload-mv-scene-modal__close" onClick={() => setSelectedVideo(null)}>
              ✕
            </button>

            {selectedVideo.scene_type === 'lipsync' && selectedVideo.video_synclabs_url ? (
              <div className="upload-mv-scene-modal__compare">
                <div className="upload-mv-scene-modal__compare-item">
                  <h4>🎬 Kling 원본</h4>
                  <video
                    src={selectedVideo.video_with_audio_url || selectedVideo.video_url}
                    controls
                    className="upload-mv-scene-modal__video"
                  />
                </div>
                <div className="upload-mv-scene-modal__compare-item">
                  <h4>🎤 립싱크 버전</h4>
                  <video
                    src={selectedVideo.video_with_audio_synclabs_url || selectedVideo.video_synclabs_url}
                    controls
                    className="upload-mv-scene-modal__video"
                  />
                </div>
              </div>
            ) : (
              <div className="upload-mv-scene-modal__video-wrap">
                <video
                  src={selectedVideo.video_with_audio_url || selectedVideo.video_url}
                  controls
                  autoPlay
                  className="upload-mv-scene-modal__video"
                />
              </div>
            )}

            <div className="upload-mv-scene-modal__info">
              <h3 className="upload-mv-scene-modal__title">
                씬 {selectedVideo.scene_number}
                {selectedVideo.scene_type === 'lipsync' && (
                  <span className="upload-mv-scene-modal__lipsync-badge">🎤 립싱크</span>
                )}
              </h3>

              {selectedVideo.section && (
                <div className="upload-mv-scene-modal__section">
                  {selectedVideo.section}
                  {selectedVideo.use_seconds && ` (${selectedVideo.use_seconds.toFixed(1)}초)`}
                </div>
              )}

              <div className="upload-mv-scene-modal__desc">
                {selectedVideo.description_ko || selectedVideo.description || '설명 없음'}
              </div>

              {selectedVideo.lyrics_segment && (
                <div className="upload-mv-scene-modal__lyrics">
                  <span className="upload-mv-scene-modal__lyrics-label">🎵 가사</span>
                  <p>{selectedVideo.lyrics_segment}</p>
                </div>
              )}

              <a href={selectedVideo.video_url} download className="upload-mv-scene-modal__download-btn">
                <FiDownload /> 영상 다운로드
              </a>
            </div>
          </div>
        </div>
      )}

      {vocalPreview && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setVocalPreview(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()} style={{maxWidth: '500px'}}>
            <button type="button" className="upload-mv-scene-modal__close" onClick={() => setVocalPreview(null)}>✕</button>

            <div className="upload-mv-scene-modal__info">
              <h3 className="upload-mv-scene-modal__title">🎤 보컬 분리 결과 - 씬 {vocalPreview.scene_number}</h3>

              <div style={{marginBottom: '1rem'}}>
                <label style={{color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '4px'}}>🎵 원본 (보컬+MR)</label>
                <audio controls src={vocalPreview.original_audio_url} style={{width: '100%'}} />
              </div>

              <div style={{marginBottom: '1.5rem'}}>
                <label style={{color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '4px'}}>🎤 분리된 보컬만</label>
                <audio controls src={vocalPreview.vocal_audio_url} style={{width: '100%'}} />
              </div>

              <div style={{display: 'flex', gap: '0.75rem', justifyContent: 'center'}}>
                <button
                  type="button"
                  className="upload-mv-scene-card__sync-try-btn"
                  style={{padding: '8px 20px', fontSize: '0.9rem'}}
                  onClick={handleConfirmLipsync}
                >
                  ✓ 이 보컬로 립싱크 진행
                </button>
                <button
                  type="button"
                  onClick={() => setVocalPreview(null)}
                  style={{padding: '8px 20px', fontSize: '0.9rem', background: '#555', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'}}
                >
                  ✕ 취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default MVProductionSection;
