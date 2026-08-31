import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUploadCloud, FiMusic, FiX, FiImage, FiZap } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import BeatTrackView from '../components/BeatTrackView';
import ArtistPicker, { loadArtists, artistKey } from '../components/ArtistPicker';
import CoverLibraryPicker from '../components/CoverLibraryPicker';
import LyricsTimestampToggle from '../components/LyricsTimestampToggle';
import './UploadPage.css';

const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', '기타'];
const AI_TOOLS = ['Suno', 'Udio', 'AIVA', 'Stable Audio', 'MusicGen (Meta)', '기타'];
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.flac,.m4a';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

// v209 3단계: MV 흐름(임시저장 draftData 포함)은 MV촬영실(MVStudioTab)로 완전 이관 — draftData/onClearDraft prop 소멸.
// v212: myCharacterFromParent prop 소멸 — 아티스트 목록은 loadArtists(공용)로 자체 로드.
// v215 F3: AI 커버 제작은 커버촬영실로 이사 — 이 화면은 보관함 선택 + 파일 직접 첨부만.
//   coverPrefill {coverObjectName, coverSessionId} = 커버촬영실 [이 커버로 업로드] 인계 (composePrefill 패턴).
//   onGoCoverStudio = 커버촬영실 탭 전환 (MyMusicPage 경유 렌더에서만 — /upload 직접 라우트는 링크 숨김).
export default function UploadPage({ generationPrefill, onClearPrefill, coverPrefill, onClearCoverPrefill, onGoCoverStudio }) {
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

  // v215 F3 — AI 커버 제작(세션·refine·이력) state 는 커버촬영실로 이사.
  // 잔존 = 보관함 선택 결과 2종 (제출 경로 :415/:443 이 그대로 소비 — 검증 자연 통과).
  const [aiCoverPreview, setAiCoverPreview] = useState(null);
  const [aiCoverObjectName, setAiCoverObjectName] = useState(null);
  const [showLibPicker, setShowLibPicker] = useState(false);

  // Character & Scene Prompt — v212: 다중 아티스트. 구 variant('real'|'virtual') 라디오를
  // 공용 ArtistPicker(선택 결과 = 아티스트 doc)로 교체. artists 목록은 이 페이지가 소유
  // (토글 disabled 판단), 카드 UI 는 ArtistPicker 주입 모드.
  const [includeCharacter, setIncludeCharacter] = useState(false);
  const [artists, setArtists] = useState([]);
  const [selectedArtist, setSelectedArtist] = useState(null);
  // v214 F2 — 작곡실 인계 아티스트(prefill.characterId): 자동선택 우선 재료.
  // 목록 로드/프리필 도착 어느 쪽이 먼저여도 매칭되도록 ref 로 보관, 미매칭(삭제) 시 default 폴백 + 안내.
  const prefillCharacterIdRef = useRef(null);
  const [prefillArtistMissing, setPrefillArtistMissing] = useState(false);
  const hasAnyArtist = artists.length > 0;
  // 선택 아티스트의 시트 object_name (없으면 null → 기존과 동일하게 null 전송)
  const selectedCharSheet = () => (selectedArtist?.sheet_object_name || null);
  const selectedCharItems = () =>
    (Array.isArray(selectedArtist?.used_items) ? selectedArtist.used_items : []);
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
      // v214 F2 — 작곡실에서 부른 아티스트 우선 자동선택 (스냅샷 아티스트 어긋남 방지 — Break 2)
      const wantedId = generationPrefill.characterId || null;
      if (wantedId) {
        prefillCharacterIdRef.current = wantedId;
        setPrefillArtistMissing(false);
        setSelectedArtist((prev) => {
          const match = artists.find((a) => a.character_id === wantedId);
          if (match) return match;
          if (artists.length > 0) setPrefillArtistMissing(true); // 목록은 있는데 미매칭 = 삭제됨
          return prev; // 목록 미로드면 loadArtists 완료 시 ref 로 재시도
        });
      }
      if (import.meta.env.DEV) {
        console.info('[UploadPage] prefill from generation', {
          genId: generationPrefill.generationId,
          variantIndex: generationPrefill.variantIndex,
          characterId: wantedId,
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

  // v212: 아티스트 목록 로드 (list API 우선, legacy 단건 폴백 — loadArtists 내장) +
  // 기본 아티스트 자동 선택 (구 v75 "한쪽만 있으면 그쪽 강제" 자동 보정 승계)
  useEffect(() => {
    let alive = true;
    loadArtists()
      .then(({ artists: list, source }) => {
        if (!alive) return;
        setArtists(list);
        setSelectedArtist((prev) => {
          // v214 F2: 작곡실 인계 아티스트가 있으면 최우선 매칭 (미매칭 = 삭제 → default 폴백 + 안내)
          const wantedId = prefillCharacterIdRef.current;
          if (wantedId) {
            const match = list.find((a) => a.character_id === wantedId);
            if (match) return match;
            setPrefillArtistMissing(true);
          }
          if (prev && list.some((a) => artistKey(a) === artistKey(prev))) return prev;
          return list.find((a) => a.is_default) || list[0] || null;
        });
        if (import.meta.env.DEV) console.debug('[UploadPage] [v212] artists loaded', { count: list.length, source });
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.debug('[UploadPage] [v212] artists load failed', { status: err?.response?.status });
      });
    return () => { alive = false; };
  }, []);

  // v215 F3 — 커버촬영실 [이 커버로 업로드] 인계 수신 (composePrefill 패턴)
  useEffect(() => {
    if (coverPrefill?.coverObjectName) {
      setAiCoverObjectName(coverPrefill.coverObjectName);
      setAiCoverPreview(api.coverPreviewUrl(coverPrefill.coverObjectName));
      setImageFile(null); // 파일 첨부와 상호배제
      if (import.meta.env.DEV) console.info('[UploadPage] cover prefill received', { session_id: coverPrefill.coverSessionId || null });
      if (onClearCoverPrefill) onClearCoverPrefill();
    }
  }, [coverPrefill]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
    }
  };

  // v215 F3 — 보관함 선택 해제 (세션·이력 state 는 커버촬영실 소관으로 이사 — 축소판)
  const handleClearAiCover = () => {
    setAiCoverPreview(null);
    setAiCoverObjectName(null);
  };

  // v215 F3 — 보관함 피커 선택 (표준 반환 {cover_session_id, cover_object_name, title})
  const handlePickCover = (cover) => {
    setAiCoverObjectName(cover.cover_object_name);
    setAiCoverPreview(api.coverPreviewUrl(cover.cover_object_name));
    setImageFile(null); // 파일 첨부와 상호배제 (기존 규칙 보존)
    if (import.meta.env.DEV) console.info('[UploadPage] cover picked from library', { session_id: cover.cover_session_id });
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
          // v214 F2 — 곡 출처: 부른 아티스트 id (경로 A. persona/lyrics 는 서버가 gen_doc 에서 승계 — T1)
          character_id: includeCharacter ? (selectedArtist?.character_id || null) : null,
          // v212 F4: 스냅샷은 선택 아티스트 기준 + gender 포함 (CharacterCoverCard 는 스냅샷 기반이라 자동 추종)
          user_character_snapshot: includeCharacter && selectedArtist ? {
            name: selectedArtist.name || '',
            age: selectedArtist.age || '',
            gender: selectedArtist.gender || '',
            personality_tags: selectedArtist.personality_tags || [],
            personality_text: selectedArtist.personality_text || '',
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
        // v214 F2 — 곡 출처: 경로 B(파일 업로드)도 아티스트 id 전송 (Form 필드, 선택 시에만)
        if (includeCharacter && selectedArtist?.character_id) {
          formData.append('character_id', selectedArtist.character_id);
        }

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

            {/* Always visible - character toggle (disabled when no artist) */}
            {/* v212: 아티스트가 하나라도 있으면 사용 가능 */}
            <label
              className="upload-character-toggle"
              style={!hasAnyArtist ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              title={!hasAnyArtist ? '먼저 마이뮤직 → 내 캐릭터 탭에서 아티스트를 등록하세요.' : undefined}
            >
              <input
                type="checkbox"
                checked={includeCharacter && hasAnyArtist}
                disabled={!hasAnyArtist}
                onChange={(e) => setIncludeCharacter(e.target.checked)}
              />
              내 아티스트 포함하기
              {!hasAnyArtist && (
                <span style={{ marginLeft: '8px', fontSize: '12px', color: '#888' }}>
                  (아티스트 미등록)
                </span>
              )}
            </label>

            {/* v214 F2 — 작곡실 인계 아티스트가 삭제된 경우 안내 (default 폴백됨) */}
            {prefillArtistMissing && (
              <p style={{ fontSize: '12px', color: '#f4a261', margin: '6px 0 0' }}>
                ⚠ 작곡할 때 사용한 아티스트를 찾을 수 없어(삭제됨) 기본 아티스트로 대체했어요.
              </p>
            )}
            {/* v212 F3: 아티스트 선택 — 구 variant 라디오를 공용 ArtistPicker 로 교체 (목록 주입 모드) */}
            {includeCharacter && hasAnyArtist && (
              <ArtistPicker
                artists={artists}
                selectedKey={artistKey(selectedArtist)}
                onChange={setSelectedArtist}
              />
            )}

            {/* v215 F3 — AI 커버 제작은 커버촬영실로 이사. 여기는 보관함 선택만. */}
            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                className="upload-cover-ai-btn"
                onClick={() => setShowLibPicker((v) => !v)}
              >
                커버: 보관함에서 선택 {showLibPicker ? '▲' : '▼'}
              </button>
              {onGoCoverStudio && (
                <button
                  type="button"
                  className="upload-cover-remove"
                  style={{ marginLeft: '8px' }}
                  onClick={onGoCoverStudio}
                >
                  커버촬영실에서 만들기 →
                </button>
              )}
              {showLibPicker && (
                <CoverLibraryPicker
                  compact
                  selectedObjectName={aiCoverObjectName}
                  onSelect={handlePickCover}
                  emptyHint="보관함이 비어 있습니다. 커버촬영실에서 커버를 만들어보세요."
                />
              )}
            </div>
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
