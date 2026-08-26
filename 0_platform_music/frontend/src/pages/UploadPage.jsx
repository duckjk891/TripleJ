import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUploadCloud, FiMusic, FiX, FiImage, FiZap } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import BeatTrackView from '../components/BeatTrackView';
import LyricsTimestampToggle from '../components/LyricsTimestampToggle';
import './UploadPage.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', '기타'];
const AI_TOOLS = ['Suno', 'Udio', 'AIVA', 'Stable Audio', 'MusicGen (Meta)', '기타'];
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.flac,.m4a';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

const COVER_PROMPT_MODELS = [
  { id: '', name: '기본 (직접 구성)', color: '#666', inPrice: '-', outPrice: '-', perCall: '무료', perCallKRW: '0원' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', color: '#e11d48', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
];

// v209 3단계: MV 흐름(임시저장 draftData 포함)은 MV촬영실(MVStudioTab)로 완전 이관 — draftData/onClearDraft prop 소멸.
export default function UploadPage({ generationPrefill, onClearPrefill, myCharacterFromParent }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const audioInputRef = useRef(null);
  const imageInputRef = useRef(null);

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
  // v74 — variant 선택 + 도큐먼트 캐시 (가사 타임스탬프 노출용)
  const [variantIndex, setVariantIndex] = useState(0);
  const [generationDoc, setGenerationDoc] = useState(null);

  const [generatingCover, setGeneratingCover] = useState(false);
  const [aiCoverPreview, setAiCoverPreview] = useState(null);
  const [aiCoverObjectName, setAiCoverObjectName] = useState(null);
  // v158 — 별 경제 v1.2: 커버 생성 비용(⭐) — /points/costs 단일 소스, 실패 시 5 폴백
  const [coverCost, setCoverCost] = useState(5);
  // v58: 커버 멀티턴 추가 수정 / 이력 / 되돌리기. 백엔드 cover_sessions 컬렉션 기반.
  const [coverSessionId, setCoverSessionId] = useState(null);
  const [coverHistory, setCoverHistory] = useState([]);  // [{version, object_name, refine_prompt, image_model, created_at}, ...]
  const [coverCurrentVersion, setCoverCurrentVersion] = useState(null);
  const [showRefinePanel, setShowRefinePanel] = useState(false);
  const [refinePromptInput, setRefinePromptInput] = useState('');
  const [refiningCover, setRefiningCover] = useState(false);
  const [revertingVersion, setRevertingVersion] = useState(null);  // 진행 중 version 번호
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);  // [다시 생성] 확인 다이얼로그

  // Character & Scene Prompt
  const [myCharacter, setMyCharacter] = useState(null);
  const [includeCharacter, setIncludeCharacter] = useState(false);
  // v75: 커버/MV/발행 스냅샷에 쓸 캐릭터 variant — 'real'(실사화) | 'virtual'(가상화). 기본 실사.
  const [characterVariant, setCharacterVariant] = useState('real');
  const hasReal = !!myCharacter?.sheet_object_name;
  const hasVirtual = !!myCharacter?.virtual_sheet_object_name;
  // 선택된 variant 의 시트 object_name (없으면 null → 기존과 동일하게 null 전송)
  const selectedCharSheet = () => {
    if (!myCharacter) return null;
    return characterVariant === 'virtual'
      ? (myCharacter.virtual_sheet_object_name || null)
      : (myCharacter.sheet_object_name || null);
  };
  const selectedCharItems = () => {
    if (!myCharacter) return [];
    return characterVariant === 'virtual'
      ? (myCharacter.virtual_used_items || [])
      : (myCharacter.used_items || []);
  };
  const [coverUserPrompt, setCoverUserPrompt] = useState('');

  // v42: location picker (선택적)
  const [availableLocations, setAvailableLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(null);

  // 커버 프롬프트 AI 모델
  const [coverPromptModel, setCoverPromptModel] = useState('');

  // 보컬 성별 / 관계 — 아직 별도 UI 없음. 백엔드가 기본값 처리하도록 전달.
  const [vocalGender, setVocalGender] = useState('female');

  // v55: 이미지 생성 모델 — 커버 영역 + 씬 영역(씬+자산 공통).
  // 기본 "nb_pro" — 기존 동작 100% 보존. 잘못된 enum 은 백엔드가 400.
  const [coverImageModel, setCoverImageModel] = useState('nb_pro');

  // v61: 공용 이미지 라이트박스 — { url, title, subtitle? } 형태. 커버/자산/추후 추가 위치 공통.
  const [selectedImage, setSelectedImage] = useState(null);

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
      setVariantIndex(Number.isFinite(generationPrefill.variantIndex) ? generationPrefill.variantIndex : 0); // v74
      setAiTool('Suno');
      if (import.meta.env.DEV) {
        console.info('[UploadPage] prefill from generation', {
          genId: generationPrefill.generationId,
          variantIndex: generationPrefill.variantIndex,
        });
      }
      if (onClearPrefill) onClearPrefill();
    }
  }, [generationPrefill]);

  // v74 — Fetch generation doc to surface variants[variantIndex].timestamps
  // in the detail area. Empty timestamps render as "가사 타임스탬프 없음".
  useEffect(() => {
    if (!fromGeneration) {
      setGenerationDoc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.getGeneration(fromGeneration);
        if (!cancelled) {
          setGenerationDoc(data);
          if (import.meta.env.DEV) {
            console.info('[UploadPage] generation doc loaded', {
              genId: fromGeneration,
              variantsCount: Array.isArray(data?.variants) ? data.variants.length : 0,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[UploadPage] getGeneration failed', { genId: fromGeneration, err });
          setGenerationDoc(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fromGeneration]);

  // Load user's character — prefer parent-provided, fallback to own fetch
  useEffect(() => {
    if (myCharacterFromParent) {
      setMyCharacter(myCharacterFromParent);
      return;
    }
    api.getMyCharacter()
      .then(({ data }) => {
        if (data.character) setMyCharacter(data.character);
      })
      .catch(() => {});
  }, [myCharacterFromParent]);

  // v75: variant 자동 보정 — 한쪽 시트만 있으면 그쪽으로 강제. 둘 다 있으면 현재 선택 유지(기본 'real').
  useEffect(() => {
    if (hasReal && !hasVirtual) {
      setCharacterVariant('real');
    } else if (!hasReal && hasVirtual) {
      setCharacterVariant('virtual');
    }
  }, [hasReal, hasVirtual]);

  // v42: load locations (best-effort, [] fallback)
  useEffect(() => {
    api.listMyLocations()
      .then((data) => setAvailableLocations(data.locations || []))
      .catch(() => setAvailableLocations([]));
  }, []);

  // v158 — 커버 생성 비용 로드 (응답 { costs: {...} } 래핑 — 실패 시 기본값 5 유지)
  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        if (typeof data?.costs?.cover === 'number') setCoverCost(data.costs.cover);
      })
      .catch((err) => {
        console.error('[UploadPage] getPointCosts failed (fallback 5)', { status: err?.response?.status, message: err?.message });
      });
  }, []);


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
      // v55: 커버 이미지 생성 모델 라디오 값 (기본 "nb_pro").
      console.info('[UploadPage] cover image_model selected', { value: coverImageModel });
      // v57: 보컬 성별 — 커버 prompt 4분기에 주입. None 이면 미주입(기존 동작).
      // v67-pre: cover 호출 시 character 관련 상태도 같이 로그 (frontend.log → 백엔드 추적용)
      console.info('[UploadPage] generateCover request', {
        vocal_gender: vocalGender,
        image_model: coverImageModel,
        includeCharacter,
        has_myCharacter: !!myCharacter,
        character_variant: characterVariant,
        has_real_sheet: hasReal,
        has_virtual_sheet: hasVirtual,
        will_send_character_object_name: includeCharacter ? selectedCharSheet() : null,
      });
      const { data } = await api.generateCover({
        title: title.trim(),
        genre: genre || null,
        mood: mood || null,
        style: null,
        character_object_name: includeCharacter ? selectedCharSheet() : null,
        user_prompt: coverUserPrompt.trim() || null,
        prompt_model: coverPromptModel || null,
        location_id: selectedLocationId || null,
        image_model: coverImageModel,
        vocal_gender: vocalGender,
      });
      api.notifyPointsRefresh(); // v158 — 커버 ⭐ 차감 즉시 헤더 배지 갱신
      const proxyUrl = api.coverPreviewUrl(data.object_name);
      setAiCoverPreview(proxyUrl);
      setAiCoverObjectName(data.object_name);
      setImageFile(null);
      // v58: 신규 cover_session 발급 — 옛 history 폐기 (Q4 a). 백엔드가 매번
      // 신규 session insert. cover_session_id 없으면 (옛 응답) null 유지 → refine 비활성.
      if (data.cover_session_id) {
        setCoverSessionId(data.cover_session_id);
        setCoverCurrentVersion(0);
        setCoverHistory([{
          version: 0,
          object_name: data.object_name,
          refine_prompt: null,
          image_model: data.image_model || 'nb_pro',
          created_at: new Date().toISOString(),
        }]);
      } else {
        setCoverSessionId(null);
        setCoverHistory([]);
        setCoverCurrentVersion(null);
      }
      setShowRefinePanel(false);
      setRefinePromptInput('');
    } catch (err) {
      // v139 — 스트라이크 생성 제한 403 공통 처리
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
      } else if (api.isInsufficientPoints(err)) {
        // v158 — 별 부족(402) 분기
        console.error('[UploadPage] generateCover insufficient points', { status: err?.response?.status });
        api.notifyPointsRefresh();
        alert(`별이 부족해요. AI 커버 생성에는 ⭐${coverCost}개가 필요합니다.`);
      } else {
        alert(err.response?.data?.error || 'AI 커버 생성에 실패했습니다.');
      }
    } finally {
      setGeneratingCover(false);
    }
  };

  // v58: [다시 생성] 버튼 핸들러 — history 가 있으면 확인 다이얼로그.
  const handleRegenerateCoverClick = () => {
    if (coverHistory && coverHistory.length > 1) {
      setShowRegenConfirm(true);
      return;
    }
    handleGenerateCover();
  };

  const handleConfirmRegenerate = () => {
    setShowRegenConfirm(false);
    handleGenerateCover();
  };

  // v58: [추가 수정] 실행.
  const handleRefineCover = async () => {
    const rp = (refinePromptInput || '').trim();
    if (!rp) {
      alert('수정 요청을 입력해주세요.');
      return;
    }
    if (rp.length > 500) {
      alert('수정 요청은 500자 이하여야 합니다.');
      return;
    }
    if (!coverSessionId) {
      alert('커버 세션 정보가 없습니다. [다시 생성] 후 다시 시도해주세요.');
      return;
    }
    setRefiningCover(true);
    try {
      if (import.meta.env?.DEV) {
        console.info('[UploadPage] refine cover', { cover_session_id: coverSessionId, len: rp.length });
      }
      // api.refineCover는 payload를 객체로 스프레드하므로 반드시 { refine_prompt } 객체로 전달해야 한다 (문자열 전달 시 422).
      const { data } = await api.refineCover(coverSessionId, { refine_prompt: rp });
      const newObjectName = data.cover_object_name;
      setAiCoverObjectName(newObjectName);
      setAiCoverPreview(api.coverPreviewUrl(newObjectName));
      setCoverCurrentVersion(data.current_version);
      setCoverHistory(Array.isArray(data.cover_refine_history) ? data.cover_refine_history : []);
      setShowRefinePanel(false);
      setRefinePromptInput('');
    } catch (err) {
      console.error('[UploadPage] refine cover failed', {
        status: err?.response?.status,
        err: err?.message,
      });
      alert(err.response?.data?.error || '커버 수정에 실패했습니다.');
    } finally {
      setRefiningCover(false);
    }
  };

  // v58: 특정 버전으로 되돌리기.
  const handleRevertCover = async (targetVersion) => {
    if (!coverSessionId) return;
    setRevertingVersion(targetVersion);
    try {
      if (import.meta.env?.DEV) {
        console.info('[UploadPage] revert cover', { cover_session_id: coverSessionId, version: targetVersion });
      }
      const { data } = await api.revertCover(coverSessionId, targetVersion);
      const newObjectName = data.cover_object_name;
      setAiCoverObjectName(newObjectName);
      setAiCoverPreview(api.coverPreviewUrl(newObjectName));
      setCoverCurrentVersion(data.current_version);
      // history 자체는 백엔드에서 보존 — refetch 불필요.
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UploadPage] revert cover failed', { err: err?.message });
      }
      alert(err.response?.data?.error || '버전 되돌리기에 실패했습니다.');
    } finally {
      setRevertingVersion(null);
    }
  };

  const handleClearAiCover = () => {
    setAiCoverPreview(null);
    setAiCoverObjectName(null);
    // v58: 세션 / 이력 / 모달 상태도 함께 초기화.
    setCoverSessionId(null);
    setCoverHistory([]);
    setCoverCurrentVersion(null);
    setShowRefinePanel(false);
    setRefinePromptInput('');
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
        if (import.meta.env.DEV) {
          console.info('[UploadPage] uploadFromGeneration', {
            genId: fromGeneration,
            variantIndex,
          });
        }
        const { data } = await api.uploadFromGeneration({
          generation_id: fromGeneration,
          variant_index: variantIndex, // v74
          title: title.trim(),
          genre: genre || undefined,
          mood: mood || undefined,
          tags: tags.trim() || undefined,
          prompt: prompt.trim() || undefined,
          lyrics: lyrics.trim() || undefined,
          // 느낌 카테고리: generation 에 저장된 값을 트랙에 관통 (없으면 백엔드가 generation fallback)
          categories: Array.isArray(generationDoc?.categories) && generationDoc.categories.length > 0
            ? generationDoc.categories
            : undefined,
          ai_model: aiTool || undefined,
          cover_object_name: aiCoverObjectName || undefined,
          // v71: cover 에 '내 캐릭터 포함' 켰으면 그 시점의 캐릭터 snapshot 박음.
          // MV 안 만든 곡도 트랙 디테일에서 cover_character 노출 가능하게.
          // v75: 스냅샷은 "커버에 실제 쓴 캐릭터" 기준 — 선택 variant(실사/가상)의 시트/아이템 사용.
          user_character_snapshot: includeCharacter && myCharacter ? {
            name: myCharacter.name || '',
            age: myCharacter.age || '',
            personality_tags: myCharacter.personality_tags || [],
            personality_text: myCharacter.personality_text || '',
            sheet_object_name: selectedCharSheet(),
            used_items: selectedCharItems(),
          } : null,
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

        const { data } = await api.uploadTrack(formData, (progressEvent) => {
          const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(pct);
        });
        track = data;
      }

      if (imageFile && !aiCoverObjectName && track?.id) {
        const imgFormData = new FormData();
        imgFormData.append('file', imageFile);
        imgFormData.append('type', 'cover');   // v197: 서버 계약값 ('track' 은 400 이었음)
        imgFormData.append('id', track.id);
        try {
          await api.uploadImage(imgFormData);
        } catch (e) {
          console.error('[UploadPage] cover image upload failed', { trackId: track.id, e });
          setError('곡은 업로드되었지만 커버 이미지 저장에 실패했습니다. 내 음악에서 커버를 다시 등록해 주세요.');
          return;   // 거짓 성공 메시지 + 자동 이동 차단
        }
      }

      setSuccess('업로드가 완료되었습니다!');
      setFromGeneration(null);
      setVariantIndex(0);
      setGenerationDoc(null);
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      console.error('[UploadPage] uploadFromGeneration failed', { genId: fromGeneration, variantIndex, err });
      setError(err.response?.data?.error || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
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
                    onClick={() => {
                      setFromGeneration(null);
                      setVariantIndex(0);
                      setGenerationDoc(null);
                    }}
                  >
                    <FiX /> 취소
                  </button>
                </div>

                <audio
                  key={`original-v${variantIndex}`}
                  controls
                  className="upload-card__gen-player"
                  src={api.generationStreamUrl(fromGeneration, variantIndex)}
                />

                {/* v74 — 가사 타임스탬프 토글 (디폴트 접힘) */}
                {generationDoc && (() => {
                  const variants = Array.isArray(generationDoc.variants) ? generationDoc.variants : [];
                  const v = variants[variantIndex];
                  const segs = v?.timestamps || [];
                  return (
                    <LyricsTimestampToggle
                      segments={segs}
                      generationId={fromGeneration}
                      variantIndex={variantIndex}
                      label={`가사 타임스탬프 (클립 ${variantIndex + 1})`}
                    />
                  );
                })()}
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

          {/* v44 — Beat visualization (only for AI-generated tracks where we have an ID to poll) */}
          {/* v74 — variantIndex !== 0 인 경우 BeatTrackView 숨김 (비트는 첫 클립 한정 추출) */}
          {fromGeneration && variantIndex === 0 && (
            <BeatTrackView
              sourceType="generation"
              sourceId={fromGeneration}
              audioUrl={api.generationStreamUrl(fromGeneration, 0)}
            />
          )}

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
                {/* v61: 커버 이미지 클릭 시 라이트박스 확대 */}
                <img
                  src={aiCoverPreview}
                  alt="AI 생성 커버"
                  className="upload-cover-preview__img"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (import.meta.env.DEV) {
                      console.info('[UploadPage] cover clicked');
                    }
                    setSelectedImage({ url: aiCoverPreview, title: '커버 이미지', subtitle: title || '' });
                  }}
                />
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

            {/* Always visible - character toggle (disabled when no character sheet) */}
            {/* v75: 실사/가상 중 하나라도 시트가 있으면 사용 가능 */}
            <label
              className="upload-character-toggle"
              style={!(hasReal || hasVirtual) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              title={!(hasReal || hasVirtual) ? '먼저 마이뮤직 → 내 캐릭터 탭에서 캐릭터를 등록하세요.' : undefined}
            >
              <input
                type="checkbox"
                checked={includeCharacter && (hasReal || hasVirtual)}
                disabled={!(hasReal || hasVirtual)}
                onChange={(e) => setIncludeCharacter(e.target.checked)}
              />
              내 캐릭터 포함하기
              {!(hasReal || hasVirtual) && (
                <span style={{ marginLeft: '8px', fontSize: '12px', color: '#888' }}>
                  (캐릭터 미등록)
                </span>
              )}
            </label>

            {/* v75: 캐릭터 variant 선택 카드 — 실사화/가상화 중 택1 (있는 것만 표시) */}
            {includeCharacter && (hasReal || hasVirtual) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px', marginBottom: '4px' }}>
                {[
                  hasReal && {
                    id: 'real',
                    label: '실사화',
                    subLabel: null,
                    objectName: myCharacter.sheet_object_name,
                    color: '#4a9eff',
                  },
                  hasVirtual && {
                    id: 'virtual',
                    label: '가상화',
                    subLabel: myCharacter.virtual_art_style || null,
                    objectName: myCharacter.virtual_sheet_object_name,
                    color: '#b070ff',
                  },
                ].filter(Boolean).map((card) => {
                  const selected = characterVariant === card.id;
                  return (
                    <label
                      key={card.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: selected ? `2px solid ${card.color}` : '2px solid #333',
                        background: selected ? `${card.color}15` : '#1a1a1a',
                        fontSize: '12px',
                        color: '#ddd',
                      }}
                    >
                      <input
                        type="radio"
                        name="characterVariant"
                        checked={selected}
                        onChange={() => {
                          setCharacterVariant(card.id);
                          if (import.meta.env.DEV) console.info('[UploadPage] char variant', { variant: card.id });
                        }}
                        style={{ accentColor: card.color }}
                      />
                      <img
                        src={api.characterPreviewUrl(card.objectName)}
                        alt={card.label}
                        style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px', background: '#111' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontWeight: 600 }}>{card.label}</span>
                        {card.subLabel && (
                          <span style={{ color: '#666', fontSize: '11px' }}>{card.subLabel}</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
              <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>커버 프롬프트 AI</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {COVER_PROMPT_MODELS.map(model => (
                  <label key={model.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', border: coverPromptModel === model.id ? `2px solid ${model.color}` : '2px solid #333', background: coverPromptModel === model.id ? `${model.color}15` : '#1a1a1a', fontSize: '12px', color: '#ddd' }}>
                    <input type="radio" name="coverPromptModel" checked={coverPromptModel === model.id} onChange={() => setCoverPromptModel(model.id)} style={{ accentColor: model.color, marginTop: '2px' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontWeight: 600 }}>{model.name}</span>
                      <span style={{ color: '#666', fontSize: '11px' }}>1회 ≈ {model.perCall} ({model.perCallKRW})</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

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

            {/* v55: 커버 이미지 생성 모델 라디오 (Nano Banana Pro / GPT Image 2). 기본 nb_pro. */}
            <div style={{ marginTop: '10px' }}>
              <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>
                커버 이미지 생성 모델
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                  padding: '8px 12px', borderRadius: '8px',
                  border: coverImageModel === 'nb_pro' ? '2px solid #7C3AED' : '2px solid #333',
                  background: coverImageModel === 'nb_pro' ? '#7C3AED15' : '#1a1a1a',
                  fontSize: '12px', color: '#ddd',
                }}>
                  <input
                    type="radio"
                    name="coverImageModel"
                    value="nb_pro"
                    checked={coverImageModel === 'nb_pro'}
                    onChange={() => setCoverImageModel('nb_pro')}
                    style={{ accentColor: '#7C3AED' }}
                  />
                  Nano Banana Pro
                </label>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                  padding: '8px 12px', borderRadius: '8px',
                  border: coverImageModel === 'gpt_image_2' ? '2px solid #10A37F' : '2px solid #333',
                  background: coverImageModel === 'gpt_image_2' ? '#10A37F15' : '#1a1a1a',
                  fontSize: '12px', color: '#ddd',
                }}>
                  <input
                    type="radio"
                    name="coverImageModel"
                    value="gpt_image_2"
                    checked={coverImageModel === 'gpt_image_2'}
                    onChange={() => setCoverImageModel('gpt_image_2')}
                    style={{ accentColor: '#10A37F' }}
                  />
                  GPT Image 2
                </label>
              </div>
            </div>

            {/* v42: 장소 선택 (보유 장소가 있을 때만) */}
            {availableLocations.length > 0 && (
              <div className="upload-page__location-picker">
                <label className="upload-page__field-label">장소 선택 (선택사항)</label>
                <div className="upload-page__location-cards">
                  <button
                    type="button"
                    className={`upload-page__location-card ${selectedLocationId === null ? 'is-selected' : ''}`}
                    onClick={() => setSelectedLocationId(null)}
                  >
                    <div className="upload-page__location-none">사용 안함</div>
                  </button>
                  {availableLocations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      className={`upload-page__location-card ${selectedLocationId === loc.id ? 'is-selected' : ''}`}
                      onClick={() => setSelectedLocationId(loc.id)}
                    >
                      <img
                        src={api.locationPreviewUrl(loc.object_name)}
                        alt={loc.name}
                        className="upload-page__location-thumb"
                      />
                      <div className="upload-page__location-label">{loc.name}</div>
                    </button>
                  ))}
                </div>
                {selectedLocationId && (
                  <div className="upload-page__location-preview">
                    <img
                      src={api.locationPreviewUrl(
                        availableLocations.find((l) => l.id === selectedLocationId)?.object_name
                      )}
                      alt="선택된 장소"
                      className="upload-page__location-preview-img"
                    />
                    <div className="upload-page__location-preview-name">
                      {availableLocations.find((l) => l.id === selectedLocationId)?.name}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
              <button
                type="button"
                className="upload-cover-ai-btn"
                onClick={handleRegenerateCoverClick}
                disabled={generatingCover || refiningCover}
              >
                {generatingCover ? (
                  <>
                    <span className="upload-cover-spinner" />
                    AI 커버 생성 중...
                  </>
                ) : (
                  <>
                    {aiCoverPreview ? '다시 생성' : 'AI 커버 생성'}
                    <span className="upload-cover-cost-badge">⭐{coverCost}</span>
                  </>
                )}
              </button>

              {/* v58: [추가 수정] 버튼 — 커버가 있고 session 이 있을 때만 노출 */}
              {aiCoverPreview && coverSessionId && (
                <button
                  type="button"
                  className="upload-cover-ai-btn"
                  style={{
                    background: 'linear-gradient(135deg, #06B6D4, #0891B2)',
                    opacity: refiningCover || generatingCover ? 0.6 : 1,
                  }}
                  onClick={() => setShowRefinePanel((v) => !v)}
                  disabled={refiningCover || generatingCover}
                >
                  {showRefinePanel ? '추가 수정 닫기' : '추가 수정'}
                </button>
              )}

              <span style={{ fontSize: '11px', color: '#888' }}>
                ~$0.02
              </span>
            </div>

            {/* v58: [추가 수정] 인라인 패널 */}
            {aiCoverPreview && coverSessionId && showRefinePanel && (
              <div style={{ marginTop: '10px', padding: '12px', borderRadius: '8px', background: '#1a1a1a', border: '1px solid #333' }}>
                <label style={{ fontSize: '13px', color: '#06B6D4', marginBottom: '6px', display: 'block' }}>
                  수정 요청 (1~500자) — 변경할 부분만 명시. 나머지는 보존됩니다.
                </label>
                <textarea
                  value={refinePromptInput}
                  onChange={(e) => setRefinePromptInput(e.target.value)}
                  placeholder={"예: 머리 길이를 단발로 바꿔주세요\n예: 배경에 강아지 한 마리 추가\n예: 가디건 색깔을 노란색으로"}
                  maxLength={500}
                  style={{
                    width: '100%',
                    minHeight: '60px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #333',
                    background: '#0d0d0d',
                    color: '#ddd',
                    fontSize: '13px',
                    resize: 'vertical',
                    lineHeight: '1.5',
                  }}
                  disabled={refiningCover}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#666' }}>
                    {refinePromptInput.length}/500
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="upload-cover-remove"
                      onClick={() => { setShowRefinePanel(false); setRefinePromptInput(''); }}
                      disabled={refiningCover}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      className="upload-cover-ai-btn"
                      style={{ background: 'linear-gradient(135deg, #06B6D4, #0891B2)' }}
                      onClick={handleRefineCover}
                      disabled={refiningCover || !refinePromptInput.trim()}
                    >
                      {refiningCover ? (
                        <>
                          <span className="upload-cover-spinner" />
                          수정 중...
                        </>
                      ) : '수정 실행'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* v58: 수정 이력 collapsible 패널 */}
            {aiCoverPreview && coverSessionId && coverHistory && coverHistory.length > 0 && (
              <details style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '8px', background: '#1a1a1a', border: '1px solid #333' }}>
                <summary style={{ cursor: 'pointer', fontSize: '13px', color: '#aaa' }}>
                  📜 수정 이력 ({coverHistory.length}개)
                </summary>
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...coverHistory].sort((a, b) => (b.version ?? 0) - (a.version ?? 0)).map((entry) => {
                    const isCurrent = entry.version === coverCurrentVersion;
                    const isOrigin = entry.version === 0;
                    const label = `v${entry.version}${isOrigin ? ' (원본)' : ''}${isCurrent ? ' — 현재' : ''}`;
                    const promptText = entry.refine_prompt || (isOrigin ? '백지에서 생성' : '');
                    return (
                      <div key={entry.version} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 10px', borderRadius: '6px',
                        background: isCurrent ? '#06B6D420' : '#0d0d0d',
                        border: isCurrent ? '1px solid #06B6D4' : '1px solid #2a2a2a',
                        fontSize: '12px',
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                          <span style={{ color: '#ddd', fontWeight: isCurrent ? 600 : 400 }}>{label}</span>
                          {promptText && (
                            <span style={{ color: '#888', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>
                              "{promptText}"
                            </span>
                          )}
                        </div>
                        {!isCurrent && (
                          <button
                            type="button"
                            className="upload-cover-remove"
                            style={{ fontSize: '11px', padding: '4px 10px' }}
                            onClick={() => handleRevertCover(entry.version)}
                            disabled={revertingVersion !== null || refiningCover || generatingCover}
                          >
                            {revertingVersion === entry.version ? '되돌리는 중...' : '되돌리기'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* v58: [다시 생성] 확인 다이얼로그 — history 가 있을 때만 띄움 */}
            {showRegenConfirm && (
              <div
                style={{
                  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => setShowRegenConfirm(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: '#1a1a1a', borderRadius: '12px', padding: '20px 24px',
                    border: '1px solid #333', maxWidth: '420px', width: '90%',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}
                >
                  <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: '16px' }}>
                    다시 생성하시겠습니까?
                  </h3>
                  <p style={{ margin: '0 0 16px 0', color: '#bbb', fontSize: '13px', lineHeight: 1.5 }}>
                    다시 생성하면 현재 수정 이력 <strong style={{ color: '#fff' }}>{coverHistory.length}개</strong>가 폐기됩니다. 이 동작은 되돌릴 수 없습니다.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="upload-cover-remove"
                      onClick={() => setShowRegenConfirm(false)}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      className="upload-cover-ai-btn"
                      onClick={handleConfirmRegenerate}
                    >
                      폐기하고 다시 생성
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* v209 3단계: MV(뮤직비디오) 흐름은 내 음악 → MV촬영실 탭으로 이관 — 업로드 화면에서 제거 */}

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

          {/* Action buttons */}
          <div className="upload-card__actions">
            <button className="upload-card__submit" type="submit" disabled={uploading}>
              {uploading ? '업로드 중...' : '업로드'}
            </button>
          </div>
        </form>
      </div>

      {/* v61: 공용 이미지 라이트박스 — 커버 / 자산(주인공·장소) 클릭 시 확대 */}
      {selectedImage && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()}>
            <button className="upload-mv-scene-modal__close" onClick={() => setSelectedImage(null)}>✕</button>
            {/* v61 보강: 자산/커버는 1:1 또는 가변 비율 → contain 모드로 잘림 방지 */}
            <div className="upload-mv-scene-modal__image-wrap upload-mv-scene-modal__image-wrap--contain">
              {selectedImage.url ? (
                <img
                  src={selectedImage.url}
                  alt={selectedImage.title || '이미지'}
                  className="upload-mv-scene-modal__image"
                />
              ) : (
                <div className="upload-mv-scene-modal__placeholder">
                  <FiImage /> 이미지 없음
                </div>
              )}
            </div>
            {(selectedImage.title || selectedImage.subtitle) && (
              <div className="upload-mv-scene-modal__info">
                {selectedImage.title && (
                  <h3 className="upload-mv-scene-modal__title">{selectedImage.title}</h3>
                )}
                {selectedImage.subtitle && (
                  <div className="upload-mv-scene-modal__desc">{selectedImage.subtitle}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
