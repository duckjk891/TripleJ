import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUploadCloud, FiMusic, FiX, FiImage, FiZap, FiRefreshCw, FiAlertTriangle, FiCheck, FiPlay, FiDownload, FiLoader } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './UploadPage.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', '기타'];
const AI_TOOLS = ['Suno', 'Udio', 'AIVA', 'Stable Audio', 'MusicGen (Meta)', '기타'];
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.flac,.m4a';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

const SCENARIO_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o-mini', color: '#00d4aa', inPrice: '$0.15/M', outPrice: '$0.60/M', perCall: '$0.002', perCallKRW: '≈3원' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', color: '#a855f7', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', color: '#3b82f6', inPrice: '$3.00/M', outPrice: '$15.00/M', perCall: '$0.05', perCallKRW: '≈70원' },
  { id: 'gpt-5.4', name: 'GPT-5.4', color: '#10b981', inPrice: '$2.50/M', outPrice: '$15.00/M', perCall: '$0.05', perCallKRW: '≈70원' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', color: '#ef4444', inPrice: '$1.00/M', outPrice: '$10.00/M', perCall: '$0.03', perCallKRW: '≈42원' },
];

const PROMPT_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o-mini', color: '#00d4aa', inPrice: '$0.15/M', outPrice: '$0.60/M', perCall: '$0.005', perCallKRW: '≈7원' },
  { id: 'gpt-5.4', name: 'GPT-5.4', color: '#a855f7', inPrice: '$2.50/M', outPrice: '$15.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', color: '#10b981', inPrice: '$0.75/M', outPrice: '$4.50/M', perCall: '$0.025', perCallKRW: '≈35원' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', color: '#3b82f6', inPrice: '$3.00/M', outPrice: '$15.00/M', perCall: '$0.06', perCallKRW: '≈84원' },
];

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

export default function UploadPage({ generationPrefill, onClearPrefill, draftData, onClearDraft }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const mvPollIntervalRef = useRef(null);
  const sceneImageInputRefs = useRef({});

  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [aiTool, setAiTool] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tags, setTags] = useState('');
  const [mood, setMood] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [fromGeneration, setFromGeneration] = useState(null);
  const [hasVoiceConverted, setHasVoiceConverted] = useState(false);
  const [useVoiceConverted, setUseVoiceConverted] = useState(false);

  const [generatingCover, setGeneratingCover] = useState(false);
  const [aiCoverPreview, setAiCoverPreview] = useState(null);
  const [aiCoverObjectName, setAiCoverObjectName] = useState(null);

  // Character & Scene Prompt
  const [myCharacter, setMyCharacter] = useState(null);
  const [includeCharacter, setIncludeCharacter] = useState(false);
  const [scenePrompt, setScenePrompt] = useState('');
  const [coverUserPrompt, setCoverUserPrompt] = useState('');

  // Video Model Selection
  const [videoModel, setVideoModel] = useState('veo');

  // AI 모델 선택 (시나리오 / 이미지 프롬프트)
  const [scenarioModels, setScenarioModels] = useState(['gpt-4o-mini']);
  const [promptModels, setPromptModels] = useState(['gpt-4o-mini']);

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
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveMsg, setDraftSaveMsg] = useState('');
  const [selectedScene, setSelectedScene] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [vocalPreview, setVocalPreview] = useState(null); // {original_audio_url, vocal_audio_url, scene_number}
  const [separatingVocal, setSeparatingVocal] = useState(null); // scene_number being separated

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Prefill from generation
  useEffect(() => {
    if (generationPrefill) {
      setTitle(generationPrefill.title || '');
      setGenre(generationPrefill.genre || '');
      setMood(generationPrefill.mood || '');
      setPrompt(generationPrefill.prompt || '');
      setLyrics(generationPrefill.lyrics || '');
      setFromGeneration(generationPrefill.generationId);
      setHasVoiceConverted(!!generationPrefill.hasVoiceConverted);
      setUseVoiceConverted(false);
      setAiTool('Suno');
      if (onClearPrefill) onClearPrefill();
    }
  }, [generationPrefill]);

  // Load user's character
  useEffect(() => {
    api.getMyCharacter()
      .then(({ data }) => {
        if (data.character) setMyCharacter(data.character);
      })
      .catch(() => {});
  }, []);

  // Restore from draft
  useEffect(() => {
    if (draftData) {
      setTitle(draftData.title || '');
      setGenre(draftData.genre || '');
      setMood(draftData.mood || '');
      setPrompt(draftData.prompt || '');
      setLyrics(draftData.lyrics || '');
      setTags(draftData.tags || '');
      setAiTool(draftData.ai_model || '');
      if (draftData.audio_generation_id) {
        setFromGeneration(draftData.audio_generation_id);
      }
      if (draftData.job_id) {
        setMvJobId(draftData.job_id);
        loadMvJobDetail(draftData.job_id).then(() => {
          // mvCoverObjectName will be set after job loads
        });
      }
      if (onClearDraft) onClearDraft();
    }
  }, [draftData]);

  const loadMvJobDetail = async (jobId) => {
    try {
      const { data } = await api.getMVJobDetail(jobId);
      setMvJob(data);
      const st = mapStatusToStep(data.status);
      setMvStep(st);
      if (data.cover_object_name) {
        setMvCoverObjectName(data.cover_object_name);
        setAiCoverObjectName(data.cover_object_name);
        if (data.cover_url) {
          setAiCoverPreview(data.cover_url);
        }
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
      // If in an active state, start polling
      if (['splitting', 'generating_images', 'generating_videos', 'synclabs_processing', 'concatenating', 'merging_audio'].includes(data.status)) {
        startMvPolling(jobId);
      }
    } catch (err) {
      console.error('[MV] Failed to load job detail:', err);
    }
  };

  const mapStatusToStep = (status) => {
    switch (status) {
      case 'splitting':
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

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
    }
  };

  const handleGenerateCover = async () => {
    if (!title.trim()) {
      alert('커버를 생성하려면 먼저 곡 제목을 입력해주세요.');
      return;
    }
    setGeneratingCover(true);
    try {
      const { data } = await api.generateCover({
        title: title.trim(),
        genre: genre || null,
        mood: mood || null,
        style: null,
        character_object_name: includeCharacter && myCharacter ? myCharacter.sheet_object_name : null,
        user_prompt: coverUserPrompt.trim() || null,
      });
      const proxyUrl = api.coverPreviewUrl(data.object_name);
      setAiCoverPreview(proxyUrl);
      setAiCoverObjectName(data.object_name);
      setImageFile(null);
      // Invalidate scenes if they were already generated with a different cover
      if (mvStep >= 2 && mvCoverObjectName) {
        setScenesInvalidated(true);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'AI 커버 생성에 실패했습니다.');
    } finally {
      setGeneratingCover(false);
    }
  };

  const handleClearAiCover = () => {
    setAiCoverPreview(null);
    setAiCoverObjectName(null);
    if (mvStep >= 2) {
      setScenesInvalidated(true);
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
        console.error('[MV] Polling error:', err);
      }
    }, intervalMs);
  }, [stopMvPolling]);

  useEffect(() => {
    return () => stopMvPolling();
  }, [stopMvPolling]);

  const getAudioDuration = () => {
    return new Promise((resolve) => {
      if (fromGeneration) {
        // Try existing audio element first
        const audioEl = document.querySelector('.upload-card__gen-player');
        if (audioEl && audioEl.duration && isFinite(audioEl.duration)) {
          resolve(audioEl.duration);
          return;
        }
        // Fallback: create temp Audio
        const streamUrl = useVoiceConverted
          ? api.voiceConvertStreamUrl(fromGeneration)
          : api.generationStreamUrl(fromGeneration);
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
    setMvStep(1);
    setMvProgressPct(0);
    try {
      const audioDuration = await getAudioDuration();
      const { data } = await api.createMVJob({
        title: title.trim(),
        genre: genre || null,
        mood: mood || null,
        lyrics: lyrics.trim() || null,
        cover_object_name: aiCoverObjectName || null,
        audio_duration_sec: audioDuration || null,
        scene_prompt: scenePrompt.trim() || null,
        character_object_name: includeCharacter && myCharacter ? myCharacter.sheet_object_name : null,
        video_model: videoModel,
        audio_generation_id: fromGeneration || null,
        scenario_models: scenarioModels,
        prompt_models: promptModels,
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
      alert(err.response?.data?.error || '씬 생성에 실패했습니다.');
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
          console.error('Poll error:', err);
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
      console.log('retrySyncLabs response:', resp);
      alert('립싱크 시도를 시작했습니다. 잠시 후 새로고침해주세요.');
    } catch (err) {
      console.error('retrySyncLabs error:', err);
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
      console.error('보컬분리 에러:', err);
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
        audioObjName = useVoiceConverted
          ? genRes.data.voice_converted_url
          : genRes.data.result_audio_url;
      } catch {
        alert('오디오 정보를 가져올 수 없습니다.');
        return;
      }
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

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setDraftSaveMsg('');
    try {
      let currentJobId = mvJobId;
      if (!currentJobId) {
        // Create a job first if none exists
        const { data } = await api.createMVJob({
          title: title.trim() || '제목 없음',
          genre: genre || null,
          mood: mood || null,
          lyrics: lyrics.trim() || null,
          cover_object_name: aiCoverObjectName || null,
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
      });
      setDraftSaveMsg('임시저장되었습니다');
      setTimeout(() => setDraftSaveMsg(''), 3000);
    } catch (err) {
      alert(err.response?.data?.error || '임시저장에 실패했습니다.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!title.trim()) { setError('곡 제목을 입력해주세요.'); return; }
    if (!fromGeneration && !audioFile) { setError('오디오 파일을 선택해주세요.'); return; }

    setUploading(true);
    setProgress(0);

    try {
      let track;

      if (fromGeneration) {
        const { data } = await api.uploadFromGeneration({
          generation_id: fromGeneration,
          title: title.trim(),
          genre: genre || undefined,
          mood: mood || undefined,
          tags: tags.trim() || undefined,
          prompt: prompt.trim() || undefined,
          lyrics: lyrics.trim() || undefined,
          ai_model: aiTool || undefined,
          cover_object_name: aiCoverObjectName || undefined,
          mv_object_name: mvMusicVideoObjectName || mvObjectName || undefined,
          use_voice_converted: useVoiceConverted || undefined,
        });
        track = data;
      } else {
        const formData = new FormData();
        formData.append('file', audioFile);
        formData.append('title', title.trim());
        if (genre) formData.append('genre', genre);
        if (aiTool) formData.append('ai_model', aiTool);
        if (prompt.trim()) formData.append('prompt', prompt.trim());
        if (tags.trim()) formData.append('tags', tags.trim());
        if (mood.trim()) formData.append('mood', mood.trim());
        if (lyrics.trim()) formData.append('lyrics', lyrics.trim());
        if (aiCoverObjectName) formData.append('cover_object_name', aiCoverObjectName);
        if (mvMusicVideoObjectName) formData.append('mv_object_name', mvMusicVideoObjectName);
        else if (mvObjectName) formData.append('mv_object_name', mvObjectName);

        const { data } = await api.uploadTrack(formData, (progressEvent) => {
          const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(pct);
        });
        track = data;
      }

      if (imageFile && !aiCoverObjectName && track?.id) {
        const imgFormData = new FormData();
        imgFormData.append('file', imageFile);
        imgFormData.append('type', 'track');
        imgFormData.append('id', track.id);
        await api.uploadImage(imgFormData).catch(() => {});
      }

      setSuccess('업로드가 완료되었습니다!');
      setFromGeneration(null);
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(err.response?.data?.error || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
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

  const getStatusText = () => {
    if (!mvJob) return '';
    if (mvJob.retry_info?.active) {
        return `429 에러 — 재시도 대기 중 (${mvJob.retry_info.attempt}/${mvJob.retry_info.max_retries})`;
    }
    switch (mvJob.status) {
      case 'splitting': return '장면 분석 중...';
      case 'scenario_review': return '시나리오 비교 선택 대기 중...';
      case 'prompts_review': return 'Image Prompt 비교 선택 대기 중...';
      case 'generating_images': return `장면 이미지 생성 중... (${getCompletedImageCount()}/${mvJob.total_scenes || 0})`;
      case 'generating_videos': return `영상 클립 생성 중... (${getCompletedVideoCount()}/${mvJob.total_scenes || 0})`;
      case 'synclabs_processing': return `립싱크 자동 적용 중... (${mvJob.synclabs_completed || 0}/${mvJob.synclabs_total || '?'})`;
      case 'concatenating': return '영상 합치는 중...';
      case 'merging_audio': return '음악과 영상을 합치는 중...';
      default: return '처리 중...';
    }
  };

  if (!user) {
    return (
      <div className="page-content">
        <div className="container">
          <div className="upload-login-prompt">
            <div className="upload-login-prompt__icon"><FiUploadCloud /></div>
            <div className="upload-login-prompt__text">로그인하여 AI 음악을 업로드하세요</div>
            <Link to="/login" className="upload-login-prompt__btn">로그인</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="upload-page">
        <form className="upload-card" onSubmit={handleSubmit}>
          <h1 className="upload-card__title">AI 음악 업로드</h1>

          {error && <div className="upload-card__error">{error}</div>}
          {success && <div className="upload-card__success">{success}</div>}

          {/* Audio file */}
          <div className="upload-card__field">
            <label className="upload-card__label">오디오 파일 *</label>
            {fromGeneration ? (
              <div className="upload-card__gen-audio">
                <div className="upload-card__gen-badge">
                  <FiZap className="upload-card__gen-badge-icon" />
                  <span className="upload-card__gen-badge-text">AI 생성 오디오 (자동 연결)</span>
                  <button
                    type="button"
                    className="upload-card__gen-badge-cancel"
                    onClick={() => { setFromGeneration(null); setHasVoiceConverted(false); setUseVoiceConverted(false); }}
                  >
                    <FiX /> 취소
                  </button>
                </div>

                {/* Voice converted version selector */}
                {hasVoiceConverted && (
                  <div className="upload-card__audio-source-selector">
                    <label className="upload-card__audio-source-label">오디오 소스 선택</label>
                    <div className="upload-card__audio-source-options">
                      <button
                        type="button"
                        className={`upload-card__audio-source-btn ${!useVoiceConverted ? 'upload-card__audio-source-btn--active' : ''}`}
                        onClick={() => setUseVoiceConverted(false)}
                      >
                        <FiMusic /> 원본 (AI 보컬)
                      </button>
                      <button
                        type="button"
                        className={`upload-card__audio-source-btn ${useVoiceConverted ? 'upload-card__audio-source-btn--active' : ''}`}
                        onClick={() => setUseVoiceConverted(true)}
                      >
                        <FiRefreshCw /> 내 목소리 버전
                      </button>
                    </div>
                  </div>
                )}

                <audio
                  key={useVoiceConverted ? 'vc' : 'original'}
                  controls
                  className="upload-card__gen-player"
                  src={
                    useVoiceConverted
                      ? api.voiceConvertStreamUrl(fromGeneration)
                      : api.generationStreamUrl(fromGeneration)
                  }
                />
              </div>
            ) : (
              <>
                <div
                  className={`upload-card__dropzone ${dragOver ? 'upload-card__dropzone--drag' : ''}`}
                  onClick={() => audioInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                >
                  <div className="upload-card__dropzone-icon"><FiUploadCloud /></div>
                  <div className="upload-card__dropzone-text"><strong>클릭</strong>하거나 파일을 드래그하세요</div>
                  <div className="upload-card__dropzone-hint">MP3, WAV, OGG, FLAC, M4A (50MB 이하)</div>
                </div>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept={AUDIO_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={(e) => setAudioFile(e.target.files[0] || null)}
                />
                {audioFile && (
                  <div className="upload-card__file-info">
                    <span className="upload-card__file-icon"><FiMusic /></span>
                    <span className="upload-card__file-name">{audioFile.name}</span>
                    <button type="button" className="upload-card__file-remove" onClick={() => setAudioFile(null)}><FiX /></button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Title */}
          <div className="upload-card__field">
            <label className="upload-card__label">곡 제목 *</label>
            <input className="upload-card__input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="곡 제목을 입력하세요" />
          </div>

          {/* Genre */}
          <div className="upload-card__field">
            <label className="upload-card__label">장르</label>
            <select className="upload-card__select" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">장르 선택</option>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* AI Tool */}
          <div className="upload-card__field">
            <label className="upload-card__label">AI 생성 도구</label>
            <select className="upload-card__select" value={aiTool} onChange={(e) => setAiTool(e.target.value)}>
              <option value="">AI 도구 선택 (선택사항)</option>
              {AI_TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Prompt */}
          <div className="upload-card__field">
            <label className="upload-card__label">생성 프롬프트 (선택)</label>
            <textarea className="upload-card__textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="AI에 입력한 프롬프트를 공유해보세요" rows={3} />
          </div>

          {/* Tags */}
          <div className="upload-card__field">
            <label className="upload-card__label">태그 (선택, 쉼표로 구분)</label>
            <input className="upload-card__input" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예: chill, 새벽, 감성" />
          </div>

          {/* Mood */}
          <div className="upload-card__field">
            <label className="upload-card__label">분위기 (선택, 쉼표로 구분)</label>
            <input className="upload-card__input" type="text" value={mood} onChange={(e) => setMood(e.target.value)} placeholder="예: relaxing, energetic, dark" />
          </div>

          {/* Cover image */}
          <div className="upload-card__field">
            <label className="upload-card__label">커버 이미지 (선택)</label>

            {aiCoverPreview && (
              <div className="upload-cover-preview">
                <img src={aiCoverPreview} alt="AI 생성 커버" className="upload-cover-preview__img" />
                <div className="upload-cover-preview__actions">
                  <button type="button" className="upload-cover-remove" onClick={handleClearAiCover}>제거</button>
                </div>
              </div>
            )}

            {!aiCoverPreview && (
              <>
                <div className="upload-card__dropzone" onClick={() => imageInputRef.current?.click()} style={{ padding: '20px' }}>
                  <div className="upload-card__dropzone-icon"><FiImage /></div>
                  <div className="upload-card__dropzone-text"><strong>클릭</strong>하여 이미지를 선택하세요</div>
                  <div className="upload-card__dropzone-hint">JPG, PNG, WebP</div>
                </div>
                <input ref={imageInputRef} type="file" accept={IMAGE_ACCEPT} style={{ display: 'none' }} onChange={(e) => { setImageFile(e.target.files[0] || null); handleClearAiCover(); }} />
                {imageFile && (
                  <div className="upload-card__file-info">
                    <span className="upload-card__file-icon"><FiImage /></span>
                    <span className="upload-card__file-name">{imageFile.name}</span>
                    <button type="button" className="upload-card__file-remove" onClick={() => setImageFile(null)}><FiX /></button>
                  </div>
                )}

                <div className="upload-cover-divider">
                  <span className="upload-cover-divider__line" />
                  <span className="upload-cover-divider__text">또는</span>
                  <span className="upload-cover-divider__line" />
                </div>
              </>
            )}

            {/* Always visible - character toggle + style input + AI button */}
            {myCharacter && (
              <label className="upload-character-toggle">
                <input
                  type="checkbox"
                  checked={includeCharacter}
                  onChange={(e) => setIncludeCharacter(e.target.checked)}
                />
                내 캐릭터 포함하기
              </label>
            )}

            <div style={{ marginTop: '10px' }}>
              <label style={{ fontSize: '13px', color: '#888', marginBottom: '4px', display: 'block' }}>
                커버 스타일 설명 (선택)
              </label>
              <textarea
                value={coverUserPrompt}
                onChange={(e) => setCoverUserPrompt(e.target.value)}
                placeholder={"예: 애니메이션 풍, 벚꽃이 흩날리는 도쿄 거리\n예: 사이버펑크 네온 도시, 비 오는 밤\n예: 수채화 느낌의 파스텔톤 풍경"}
                style={{
                  width: '100%',
                  minHeight: '70px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #333',
                  background: '#1a1a1a',
                  color: '#ddd',
                  fontSize: '13px',
                  resize: 'vertical',
                  lineHeight: '1.5',
                }}
              />
            </div>

            <button
              type="button"
              className="upload-cover-ai-btn"
              onClick={handleGenerateCover}
              disabled={generatingCover}
            >
              {generatingCover ? (
                <>
                  <span className="upload-cover-spinner" />
                  AI 커버 생성 중...
                </>
              ) : (
                aiCoverPreview ? '다시 생성' : 'AI 커버 생성'
              )}
            </button>
          </div>

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
                              <div className="upload-mv-video-model-card__desc">고품질 8초 영상</div>
                            </button>
                            <button
                              type="button"
                              className={`upload-mv-video-model-card${videoModel === 'kling' ? ' upload-mv-video-model-card--active' : ''}`}
                              onClick={() => setVideoModel('kling')}
                            >
                              <div className="upload-mv-video-model-card__name">Kling V3</div>
                              <div className="upload-mv-video-model-card__provider">Kling AI</div>
                              <div className="upload-mv-video-model-card__desc">이미지 기반 10초 영상</div>
                            </button>
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
                      </div>

                      <button
                        type="button"
                        className="upload-mv-ai-btn"
                        onClick={handleCreateScenes}
                        disabled={!aiCoverObjectName || scenarioModels.length === 0 || promptModels.length === 0}
                      >
                        씬 생성하기
                      </button>
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
                        <div className="upload-mv-progress__fill" style={{ width: `${mvProgressPct}%` }} />
                      </div>
                      <div className="upload-mv-progress__text">{mvProgressPct}%</div>
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

                  {/* Scenes list (visible when step >= 2) */}
                  {mvStep >= 2 && mvJob?.scenes && mvJob.scenes.length > 0 && (
                    <div className="upload-mv-scenes-list">
                      <div className="upload-mv-scenes-list__label">
                        생성된 장면 ({getCompletedImageCount()}/{mvJob.scenes.length})
                      </div>
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
                          <div className="upload-mv-video-model-selector__label">
                            선택된 모델: {videoModel === 'kling' ? 'Kling V3 (10초)' : 'Veo 3.1 (8초)'}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="upload-mv-ai-btn"
                          onClick={handleGenerateVideos}
                        >
                          {videoModel === 'kling' ? 'Kling으로 영상 생성하기' : 'Veo로 영상 생성하기'}
                        </button>
                      </>
                    )}

                    {mvStep === 3 && (
                      <div className="upload-mv-progress">
                        <div className="upload-mv-progress__header">
                          <span className="upload-cover-spinner" />
                          <span>{getStatusText()}</span>
                        </div>
                        <div className="upload-mv-progress__bar">
                          <div className="upload-mv-progress__fill" style={{ width: `${mvProgressPct}%` }} />
                        </div>
                        <div className="upload-mv-progress__text">
                          {mvJob?.status === 'synclabs_processing'
                            ? `립싱크 ${mvJob.synclabs_completed || 0}/${mvJob.synclabs_total || '?'}`
                            : mvJob ? `영상 ${getCompletedVideoCount()}/${mvJob.total_scenes || 0}` : ''
                          } ({mvProgressPct}%)
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
                          <span>{useVoiceConverted ? '내 목소리 버전 오디오 연결됨' : 'AI 생성 오디오 연결됨'}</span>
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
                        disabled={!fromGeneration && !audioFile}
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

          {/* Lyrics */}
          <div className="upload-card__field">
            <label className="upload-card__label">가사 (선택)</label>
            <textarea className="upload-card__textarea" value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="가사를 입력하세요" rows={4} />
          </div>

          {/* Progress */}
          {uploading && (
            <div className="upload-card__progress">
              <div className="upload-card__progress-bar">
                <div className="upload-card__progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="upload-card__progress-text">업로드 중... {progress}%</div>
            </div>
          )}

          {/* Draft save message */}
          {draftSaveMsg && (
            <div className="upload-card__success">
              <FiCheck style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {draftSaveMsg}
            </div>
          )}

          {/* Action buttons */}
          <div className="upload-card__actions">
            <button
              type="button"
              className="upload-card__draft-btn"
              onClick={handleSaveDraft}
              disabled={savingDraft || uploading}
            >
              {savingDraft ? '저장 중...' : '임시저장'}
            </button>
            <button className="upload-card__submit" type="submit" disabled={uploading}>
              {uploading ? '업로드 중...' : '업로드'}
            </button>
          </div>
        </form>
      </div>

      {selectedScene && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setSelectedScene(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()}>
            <button className="upload-mv-scene-modal__close" onClick={() => setSelectedScene(null)}>
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
            <button className="upload-mv-scene-modal__close" onClick={() => setSelectedVideo(null)}>
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
            <button className="upload-mv-scene-modal__close" onClick={() => setVocalPreview(null)}>✕</button>

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
                  className="upload-mv-scene-card__sync-try-btn"
                  style={{padding: '8px 20px', fontSize: '0.9rem'}}
                  onClick={handleConfirmLipsync}
                >
                  ✓ 이 보컬로 립싱크 진행
                </button>
                <button
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
    </div>
  );
}
