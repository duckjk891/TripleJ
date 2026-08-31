import { useEffect, useState } from 'react';
import { FiImage } from 'react-icons/fi';
import * as api from '../../api';
import ArtistPicker, { loadArtists, artistKey } from '../ArtistPicker';
import CoverLibraryPicker from '../CoverLibraryPicker';
import '../../pages/UploadPage.css';
import '../StudioTab2.css';

// v215 F1+F2 — 「커버촬영실」: UploadPage 의 AI 커버 제작 블록(세션·refine·이력·되돌리기·
// ArtistPicker·장소·모델 선택) 전체 이사 + 하단 보관함(cover_sessions — PLAN C1/C6).
// 결합면 대체: title/genre/mood 는 탭 자체 입력(제목=생성 게이트 승계, 장르/무드=프롬프트 재료 선택).
// 생성 성공 = 세션 insert = 곧 보관함 자동 저장(사양 2). 파일 직접 첨부는 업로드 전속 — 여기 없음.
// props: onSendCoverToUpload({coverObjectName, coverSessionId}) — [이 커버로 업로드] 인계 (재량 채택).
const COVER_PROMPT_MODELS = [
  { id: '', name: '기본 (직접 구성)', color: '#666', inPrice: '-', outPrice: '-', perCall: '무료', perCallKRW: '0원' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', color: '#e11d48', inPrice: '$5.00/M', outPrice: '$25.00/M', perCall: '$0.08', perCallKRW: '≈112원' },
];

export default function CoverStudioTab({ onSendCoverToUpload }) {
  // ── 결합면 대체 — 탭 자체 입력 (구 UploadPage 의 title/genre/mood 결합) ──
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');

  // ── 커버 제작 state (UploadPage :44-57 이사) ──
  const [generatingCover, setGeneratingCover] = useState(false);
  const [aiCoverPreview, setAiCoverPreview] = useState(null);
  const [aiCoverObjectName, setAiCoverObjectName] = useState(null);
  // v158 — 커버 생성 비용(⭐) — /points/costs 단일 소스, 실패 시 5 폴백
  const [coverCost, setCoverCost] = useState(5);
  // v58: 커버 멀티턴 추가 수정 / 이력 / 되돌리기. 백엔드 cover_sessions 컬렉션 기반.
  const [coverSessionId, setCoverSessionId] = useState(null);
  const [coverHistory, setCoverHistory] = useState([]);
  const [coverCurrentVersion, setCoverCurrentVersion] = useState(null);
  const [showRefinePanel, setShowRefinePanel] = useState(false);
  const [refinePromptInput, setRefinePromptInput] = useState('');
  const [refiningCover, setRefiningCover] = useState(false);
  const [revertingVersion, setRevertingVersion] = useState(null);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [coverUserPrompt, setCoverUserPrompt] = useState('');
  const [coverPromptModel, setCoverPromptModel] = useState('');
  const [coverImageModel, setCoverImageModel] = useState('nb_pro');
  // 보컬 성별 — 별도 UI 없음(구 UploadPage 동일), 백엔드 기본값 정책에 맞춰 전달
  const vocalGender = 'female';

  // ── 아티스트 시트 배선 (커버 생성용 — UploadPage v212 패턴 이사) ──
  const [includeCharacter, setIncludeCharacter] = useState(false);
  const [artists, setArtists] = useState([]);
  const [selectedArtist, setSelectedArtist] = useState(null);
  const hasAnyArtist = artists.length > 0;
  const selectedCharSheet = () => (selectedArtist?.sheet_object_name || null);

  // ── 장소 (v42 이사) ──
  const [availableLocations, setAvailableLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(null);

  // ── 공용 라이트박스 (v61 패턴) + 보관함 갱신 신호 ──
  const [selectedImage, setSelectedImage] = useState(null);
  const [libRefreshKey, setLibRefreshKey] = useState(0);

  useEffect(() => {
    loadArtists()
      .then(({ artists: list, source }) => {
        setArtists(list);
        setSelectedArtist(list.find((a) => a.is_default) || list[0] || null);
        if (import.meta.env.DEV) console.debug('[CoverStudio] artists loaded', { count: list.length, source });
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.debug('[CoverStudio] artists load failed', { status: err?.response?.status });
      });
  }, []);

  useEffect(() => {
    api.listMyLocations()
      .then((data) => setAvailableLocations(data.locations || []))
      .catch(() => setAvailableLocations([]));
  }, []);

  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        if (typeof data?.costs?.cover === 'number') setCoverCost(data.costs.cover);
      })
      .catch((err) => {
        console.error('[CoverStudio] getPointCosts failed (fallback 5)', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // ── 커버 생성 (UploadPage :217-288 이사 — source:'coverstudio' 스냅샷 추가) ──
  const handleGenerateCover = async () => {
    if (!title.trim()) {
      alert('커버를 생성하려면 먼저 제목(라벨)을 입력해주세요.');
      return;
    }
    setGeneratingCover(true);
    try {
      console.info('[CoverStudio] generateCover request', {
        vocal_gender: vocalGender,
        image_model: coverImageModel,
        includeCharacter,
        selected_artist: artistKey(selectedArtist),
        will_send_character_object_name: includeCharacter ? selectedCharSheet() : null,
      });
      const { data } = await api.generateCover({
        title: title.trim(),
        genre: genre.trim() || null,
        mood: mood.trim() || null,
        style: null,
        character_object_name: includeCharacter ? selectedCharSheet() : null,
        user_prompt: coverUserPrompt.trim() || null,
        prompt_model: coverPromptModel || null,
        location_id: selectedLocationId || null,
        image_model: coverImageModel,
        vocal_gender: vocalGender,
        // v215 C1 — 생성처 스냅샷 (서버가 title/gen_params 와 함께 세션에 영속 — additive)
        source: 'coverstudio',
      });
      api.notifyPointsRefresh(); // 커버 ⭐ 차감 즉시 헤더 배지 갱신
      const proxyUrl = api.coverPreviewUrl(data.object_name);
      setAiCoverPreview(proxyUrl);
      setAiCoverObjectName(data.object_name);
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
      setLibRefreshKey((k) => k + 1); // 세션 insert = 보관함 자동 반영
    } catch (err) {
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
      } else if (api.isInsufficientPoints(err)) {
        console.error('[CoverStudio] generateCover insufficient points', { status: err?.response?.status });
        api.notifyPointsRefresh();
        alert(`별이 부족해요. AI 커버 생성에는 ⭐${coverCost}개가 필요합니다.`);
      } else {
        alert(err.response?.data?.error || 'AI 커버 생성에 실패했습니다.');
      }
    } finally {
      setGeneratingCover(false);
    }
  };

  // v58: [다시 생성] — history 있으면 확인 다이얼로그 (이사)
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

  // v58: [추가 수정] (이사 — 무과금·외부 이미지 API)
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
        console.info('[CoverStudio] refine cover', { cover_session_id: coverSessionId, len: rp.length });
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
      setLibRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('[CoverStudio] refine cover failed', {
        status: err?.response?.status,
        err: err?.message,
      });
      alert(err.response?.data?.error || '커버 수정에 실패했습니다.');
    } finally {
      setRefiningCover(false);
    }
  };

  // v58: 특정 버전으로 되돌리기 (이사)
  const handleRevertCover = async (targetVersion) => {
    if (!coverSessionId) return;
    setRevertingVersion(targetVersion);
    try {
      if (import.meta.env?.DEV) {
        console.info('[CoverStudio] revert cover', { cover_session_id: coverSessionId, version: targetVersion });
      }
      const { data } = await api.revertCover(coverSessionId, targetVersion);
      const newObjectName = data.cover_object_name;
      setAiCoverObjectName(newObjectName);
      setAiCoverPreview(api.coverPreviewUrl(newObjectName));
      setCoverCurrentVersion(data.current_version);
      setLibRefreshKey((k) => k + 1); // 현재본 변경 — 보관함 썸네일 반영
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[CoverStudio] revert cover failed', { err: err?.message });
      }
      alert(err.response?.data?.error || '버전 되돌리기에 실패했습니다.');
    } finally {
      setRevertingVersion(null);
    }
  };

  // 작업 커버 내려놓기 (세션은 보관함에 남음 — 삭제 아님)
  const handleClearWorkbench = () => {
    setAiCoverPreview(null);
    setAiCoverObjectName(null);
    setCoverSessionId(null);
    setCoverHistory([]);
    setCoverCurrentVersion(null);
    setShowRefinePanel(false);
    setRefinePromptInput('');
  };

  // ── 보관함에서 선택 → 작업대로 로드 (이력·되돌리기 이어가기 — 보관함 존재 이유) ──
  const handlePickFromLibrary = async (cover) => {
    // Picker 표준 반환 shape {cover_session_id, cover_object_name, title} (planner 확정)
    setAiCoverObjectName(cover.cover_object_name);
    setAiCoverPreview(api.coverPreviewUrl(cover.cover_object_name));
    setCoverSessionId(cover.cover_session_id);
    if (cover.title && !title.trim()) setTitle(cover.title);
    setShowRefinePanel(false);
    setRefinePromptInput('');
    if (import.meta.env.DEV) console.debug('[CoverStudio] picked from library', { session_id: cover.cover_session_id });
    try {
      const { data } = await api.getCoverHistory(cover.cover_session_id);
      setCoverCurrentVersion(data?.current_version ?? null);
      setCoverHistory(Array.isArray(data?.cover_refine_history) ? data.cover_refine_history : []);
      if (data?.image_model === 'nb_pro' || data?.image_model === 'gpt_image_2') {
        setCoverImageModel(data.image_model);
      }
    } catch (err) {
      console.error('[CoverStudio] cover history load failed', { session_id: cover.cover_session_id, status: err?.response?.status });
      setCoverHistory([]);
      setCoverCurrentVersion(null);
    }
  };

  return (
    <div className="s2">
      <div className="upload-page" style={{ padding: 0 }}>
        <div className="upload-card">
          <h1 className="upload-card__title">🎨 커버촬영실</h1>
          <p className="s2__hint" style={{ marginTop: '-8px' }}>
            만든 커버는 보관함에 자동 저장되고, 업로드·MV촬영실·커버 수정에서 꺼내 쓸 수 있어요.
          </p>

          {/* ── 제작 재료 — 탭 자체 입력 (구 UploadPage 결합면 대체) ── */}
          <div className="upload-card__field">
            <label className="upload-card__label">제목 (커버 라벨·프롬프트 재료) *</label>
            <input className="upload-card__input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 여름밤 발라드" />
          </div>
          <div className="upload-card__field" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label className="upload-card__label">장르 (선택)</label>
              <input className="upload-card__input" type="text" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="예: 발라드" />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label className="upload-card__label">분위기 (선택)</label>
              <input className="upload-card__input" type="text" value={mood} onChange={(e) => setMood(e.target.value)} placeholder="예: relaxing, dark" />
            </div>
          </div>

          {/* ── 작업대 — 미리보기 + 제작 옵션 (UploadPage :632-1030 이사) ── */}
          <div className="upload-card__field">
            <label className="upload-card__label">커버 이미지</label>

            {aiCoverPreview && (
              <div className="upload-cover-preview">
                <img
                  src={aiCoverPreview}
                  alt="AI 생성 커버"
                  className="upload-cover-preview__img"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (import.meta.env.DEV) console.info('[CoverStudio] cover clicked');
                    setSelectedImage({ url: aiCoverPreview, title: '커버 이미지', subtitle: title || '' });
                  }}
                />
                <div className="upload-cover-preview__actions">
                  {onSendCoverToUpload && (
                    <button
                      type="button"
                      className="upload-cover-ai-btn"
                      onClick={() => {
                        if (import.meta.env.DEV) console.info('[CoverStudio] send to upload', { session_id: coverSessionId });
                        onSendCoverToUpload({ coverObjectName: aiCoverObjectName, coverSessionId });
                      }}
                    >
                      이 커버로 업로드 →
                    </button>
                  )}
                  <button type="button" className="upload-cover-remove" onClick={handleClearWorkbench}>내려놓기</button>
                </div>
              </div>
            )}

            {/* Always visible - character toggle (disabled when no artist) — v212 이사 */}
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
            {includeCharacter && hasAnyArtist && (
              <ArtistPicker
                artists={artists}
                selectedKey={artistKey(selectedArtist)}
                onChange={setSelectedArtist}
              />
            )}

            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
              <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>커버 프롬프트 AI</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {COVER_PROMPT_MODELS.map(model => (
                  <label key={model.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', border: coverPromptModel === model.id ? `2px solid ${model.color}` : '2px solid #333', background: coverPromptModel === model.id ? `${model.color}15` : '#1a1a1a', fontSize: '12px', color: '#ddd' }}>
                    <input type="radio" name="csCoverPromptModel" checked={coverPromptModel === model.id} onChange={() => setCoverPromptModel(model.id)} style={{ accentColor: model.color, marginTop: '2px' }} />
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

            {/* v55: 커버 이미지 생성 모델 라디오 (이사) */}
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
                    name="csCoverImageModel"
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
                    name="csCoverImageModel"
                    value="gpt_image_2"
                    checked={coverImageModel === 'gpt_image_2'}
                    onChange={() => setCoverImageModel('gpt_image_2')}
                    style={{ accentColor: '#10A37F' }}
                  />
                  GPT Image 2
                </label>
              </div>
            </div>

            {/* v42: 장소 선택 (이사) */}
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

              {/* v58: [추가 수정] 버튼 (이사) */}
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

            {/* v58: [추가 수정] 인라인 패널 (이사) */}
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

            {/* v58: 수정 이력 collapsible 패널 (이사) */}
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

            {/* v58: [다시 생성] 확인 다이얼로그 (이사) */}
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
                    다시 생성하면 새 커버(세션)가 만들어집니다. 현재 작업 중인 커버는 보관함에 남습니다.
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
                      새로 생성
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 보관함 (cover_sessions — 관리 모드: 보기/삭제/선택하여 이어 작업) ── */}
        <div className="upload-card" style={{ marginTop: '16px' }}>
          <h2 className="upload-card__title" style={{ fontSize: '17px' }}>🗂 커버 보관함</h2>
          <p className="s2__hint" style={{ marginTop: '-6px' }}>
            카드를 클릭하면 작업대로 불러와 추가 수정·되돌리기를 이어갈 수 있어요. 곡에 연결된 커버는 삭제할 수 없습니다.
          </p>
          <CoverLibraryPicker
            manage
            refreshKey={libRefreshKey}
            selectedObjectName={aiCoverObjectName}
            onSelect={handlePickFromLibrary}
            onView={(img) => setSelectedImage(img)}
            emptyHint="보관함이 비어 있습니다. 위에서 첫 커버를 만들어보세요."
          />
        </div>
      </div>

      {/* v61 패턴 — 공용 이미지 라이트박스 */}
      {selectedImage && (
        <div className="upload-mv-scene-modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="upload-mv-scene-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="upload-mv-scene-modal__close" onClick={() => setSelectedImage(null)}>✕</button>
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
