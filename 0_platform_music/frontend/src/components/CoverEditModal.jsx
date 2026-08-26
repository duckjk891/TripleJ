import { useState, useEffect, useRef } from 'react';
import { FiX, FiUploadCloud, FiUser, FiEdit3, FiRotateCcw, FiArrowRight } from 'react-icons/fi';
import * as api from '../api';
import './CoverEditModal.css';

// v207 — 기존 곡 커버 이미지 수정 공용 모달 (진입점: 내 트랙 / 내 채널)
// 탭 3: ① 파일 첨부(무료) ② 내 캐릭터 AI ⭐coverCost ③ 프롬프트 AI ⭐coverCost
// AI 생성은 UploadPage 와 동일한 generate-cover 세션 파이프라인(⭐ 차감·refine) 재사용.
// 적용: 파일 탭 = uploadImage(type='cover') / AI 탭 = updateTrack(cover_image_url=세션 산출물)
// 🚫 이 컴포넌트에서 직접 fetch/URL 조립 금지 — 전부 api/index.js 함수 경유.

// 저장 raw 값(object_name 또는 '/api/…' 경로) → 표시 URL (SongItem 표기 관행과 동일 분기)
const displayUrl = (raw) => {
  if (!raw) return '';
  if (raw.startsWith('http') || raw.startsWith('/')) return raw;
  return api.coverPreviewUrl(raw);
};

// 파일 탭은 트랙당 동일 object_name 을 덮어쓰므로(covers/{uid}/{trackId}.ext)
// 같은 URL 재사용 시 브라우저 캐시로 옛 이미지가 남는다 → 표시용 URL 에만 버스터 부착.
const bust = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url);

export default function CoverEditModal({ track, onClose, onUpdated }) {
  const trackId = track?.id;
  // 모달을 연 시점의 원래 커버 raw 값 — [이전 커버로 되돌리기] 의 원복 대상
  const originalRef = useRef(track?.cover_image_url ?? track?.cover_image ?? '');

  const [tab, setTab] = useState('file'); // 'file' | 'character' | 'prompt'
  const [error, setError] = useState('');
  const [currentDisplay, setCurrentDisplay] = useState(() =>
    displayUrl(track?.cover_image_url ?? track?.cover_image ?? '')
  );

  // 파일 탭
  const [imageFile, setImageFile] = useState(null);
  const [filePreview, setFilePreview] = useState('');
  const filePreviewRef = useRef('');

  // AI 공통 (세션 파이프라인)
  const [coverCost, setCoverCost] = useState(5);
  const [imageModel, setImageModel] = useState('nb_pro');
  const [generating, setGenerating] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [aiObjectName, setAiObjectName] = useState(null);
  const [showRefine, setShowRefine] = useState(false);
  const [refineInput, setRefineInput] = useState('');
  const [refining, setRefining] = useState(false);

  // 캐릭터 탭
  const [myCharacter, setMyCharacter] = useState(null);
  const [charLoaded, setCharLoaded] = useState(false);
  const [characterVariant, setCharacterVariant] = useState('real');
  const hasReal = !!myCharacter?.sheet_object_name;
  const hasVirtual = !!myCharacter?.virtual_sheet_object_name;

  // 프롬프트 탭
  const [promptText, setPromptText] = useState('');

  // 적용/원복
  const [applying, setApplying] = useState(false);
  const [appliedRaw, setAppliedRaw] = useState(null); // 이번 모달 세션에서 교체 완료된 raw 값
  const [reverting, setReverting] = useState(false);

  // 비용 로드 (UploadPage v158 관행 — 실패 시 기본값 5 유지)
  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        if (typeof data?.costs?.cover === 'number') setCoverCost(data.costs.cover);
      })
      .catch((err) => {
        console.error('[CoverEditModal] getPointCosts failed (fallback 5)', {
          status: err?.response?.status,
        });
      });
  }, []);

  // 내 캐릭터 로드 (캐릭터 탭용, best-effort)
  useEffect(() => {
    api.getMyCharacter()
      .then(({ data }) => {
        if (data.character) setMyCharacter(data.character);
        setCharLoaded(true);
      })
      .catch(() => setCharLoaded(true));
  }, []);

  // variant 자동 보정 — 한쪽 시트만 있으면 그쪽으로 강제 (UploadPage v75 동일)
  useEffect(() => {
    if (hasReal && !hasVirtual) setCharacterVariant('real');
    else if (!hasReal && hasVirtual) setCharacterVariant('virtual');
  }, [hasReal, hasVirtual]);

  // objectURL 정리
  useEffect(() => () => {
    if (filePreviewRef.current) URL.revokeObjectURL(filePreviewRef.current);
  }, []);

  const selectedCharSheet = () => {
    if (!myCharacter) return null;
    return characterVariant === 'virtual'
      ? (myCharacter.virtual_sheet_object_name || null)
      : (myCharacter.sheet_object_name || null);
  };

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('이미지 파일만 첨부할 수 있습니다.');
      return;
    }
    setError('');
    setImageFile(f);
    if (filePreviewRef.current) URL.revokeObjectURL(filePreviewRef.current);
    const url = URL.createObjectURL(f);
    filePreviewRef.current = url;
    setFilePreview(url);
    if (import.meta.env.DEV) {
      console.info('[CoverEditModal] file selected', { trackId, name: f.name, size: f.size });
    }
  };

  // --- AI 생성 (⭐coverCost 차감 — generate-cover 세션 신규 발급) ---
  const handleGenerate = async () => {
    const kind = tab; // 'character' | 'prompt'
    if (kind === 'character' && !selectedCharSheet()) {
      setError('사용할 캐릭터 시트가 없습니다. 마이뮤직 → 내 캐릭터에서 먼저 등록해주세요.');
      return;
    }
    if (kind === 'prompt' && !promptText.trim()) {
      setError('커버 프롬프트를 입력해주세요.');
      return;
    }
    if (aiObjectName && !window.confirm(`다시 생성하면 ⭐${coverCost}개가 추가로 차감됩니다. 계속할까요?`)) {
      return;
    }
    setError('');
    setGenerating(true);
    try {
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] generateCover request', {
          trackId,
          kind,
          image_model: imageModel,
          character_variant: kind === 'character' ? characterVariant : null,
        });
      }
      const { data } = await api.generateCover({
        title: (track?.title || '').trim() || '커버',
        genre: track?.genre || null,
        mood: track?.mood || null,
        style: null,
        character_object_name: kind === 'character' ? selectedCharSheet() : null,
        user_prompt: kind === 'prompt' ? (promptText.trim() || null) : null,
        prompt_model: null,
        location_id: null,
        image_model: imageModel,
        vocal_gender: null,
      });
      api.notifyPointsRefresh(); // ⭐ 차감 즉시 헤더 배지 갱신 (v158 관행)
      setAiObjectName(data.object_name);
      setSessionId(data.cover_session_id || null);
      setShowRefine(false);
      setRefineInput('');
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] generateCover done', {
          trackId,
          object_name: data.object_name,
          has_session: !!data.cover_session_id,
        });
      }
    } catch (err) {
      console.error('[CoverEditModal] generateCover failed', {
        trackId,
        status: err?.response?.status,
        message: err?.message,
      });
      if (api.isGenerationRestricted(err)) {
        api.alertGenerationRestricted(err);
      } else if (api.isInsufficientPoints(err)) {
        api.notifyPointsRefresh();
        setError(`별이 부족해요. AI 커버 생성에는 ⭐${coverCost}개가 필요합니다.`);
      } else {
        setError(err.response?.data?.error || 'AI 커버 생성에 실패했습니다.');
      }
    } finally {
      setGenerating(false);
    }
  };

  // --- 추가 수정 (refine — 동일 세션 멀티턴, UploadPage v58 관행) ---
  const handleRefine = async () => {
    const rp = (refineInput || '').trim();
    if (!rp) {
      setError('수정 요청을 입력해주세요.');
      return;
    }
    if (rp.length > 500) {
      setError('수정 요청은 500자 이하여야 합니다.');
      return;
    }
    if (!sessionId) {
      setError('커버 세션 정보가 없습니다. 먼저 [AI 커버 생성]을 실행해주세요.');
      return;
    }
    setError('');
    setRefining(true);
    try {
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] refineCover request', {
          trackId,
          cover_session_id: sessionId,
          len: rp.length,
        });
      }
      // 백엔드 계약: RefineCoverRequest.refine_prompt (upload.py:511)
      const { data } = await api.refineCover(sessionId, { refine_prompt: rp });
      setAiObjectName(data.cover_object_name);
      setShowRefine(false);
      setRefineInput('');
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] refineCover done', {
          trackId,
          object_name: data.cover_object_name,
          version: data.current_version,
        });
      }
    } catch (err) {
      console.error('[CoverEditModal] refineCover failed', {
        trackId,
        status: err?.response?.status,
        message: err?.message,
      });
      setError(err.response?.data?.error || '커버 수정에 실패했습니다.');
    } finally {
      setRefining(false);
    }
  };

  // --- 교체: 파일 탭 (무료 — /upload/image type=cover 가 DB 반영 + 캐시 무효화까지 수행) ---
  const handleApplyFile = async () => {
    if (!imageFile || !trackId || applying) return;
    setError('');
    setApplying(true);
    try {
      const fd = new FormData();
      fd.append('file', imageFile);
      fd.append('type', 'cover'); // v197: 서버 계약값 ('track' 은 400)
      fd.append('id', trackId);
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] uploadImage(cover) request', { trackId });
      }
      const { data } = await api.uploadImage(fd);
      const raw = data.object_name || '';
      const shown = bust(displayUrl(data.file_url || raw));
      setAppliedRaw(raw);
      setCurrentDisplay(shown);
      if (onUpdated) onUpdated(shown);
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] uploadImage(cover) done', { trackId, object_name: raw });
      }
    } catch (err) {
      console.error('[CoverEditModal] uploadImage(cover) failed', {
        trackId,
        status: err?.response?.status,
        message: err?.message,
      });
      setError(err.response?.data?.error || '커버 이미지 업로드에 실패했습니다.');
    } finally {
      setApplying(false);
    }
  };

  // --- 교체: AI 탭 (updateTrack 에 세션 산출물 object_name 저장) ---
  const handleApplyAi = async () => {
    if (!aiObjectName || !trackId || applying) return;
    setError('');
    setApplying(true);
    try {
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] updateTrack(cover) request', {
          trackId,
          object_name: aiObjectName,
        });
      }
      await api.updateTrack(trackId, { cover_image_url: aiObjectName });
      const shown = displayUrl(aiObjectName); // 신규 object_name — 버스터 불필요
      setAppliedRaw(aiObjectName);
      setCurrentDisplay(shown);
      if (onUpdated) onUpdated(shown);
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] updateTrack(cover) done', { trackId });
      }
    } catch (err) {
      console.error('[CoverEditModal] updateTrack(cover) failed', {
        trackId,
        status: err?.response?.status,
        message: err?.message,
      });
      setError(err.response?.data?.error || '커버 교체에 실패했습니다.');
    } finally {
      setApplying(false);
    }
  };

  // --- 이전 커버로 되돌리기 (모달 연 시점의 원래 raw 값으로 원복 후 닫기) ---
  const handleRevert = async () => {
    const original = originalRef.current;
    if (!original || !trackId || reverting) return;
    setError('');
    setReverting(true);
    try {
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] revert to original request', { trackId });
      }
      await api.updateTrack(trackId, { cover_image_url: original });
      if (onUpdated) onUpdated(bust(displayUrl(original)));
      if (import.meta.env.DEV) {
        console.info('[CoverEditModal] revert to original done', { trackId });
      }
      onClose();
    } catch (err) {
      console.error('[CoverEditModal] revert to original failed', {
        trackId,
        status: err?.response?.status,
        message: err?.message,
      });
      setError(err.response?.data?.error || '이전 커버로 되돌리기에 실패했습니다.');
    } finally {
      setReverting(false);
    }
  };

  const newPreview = tab === 'file'
    ? filePreview
    : (aiObjectName ? displayUrl(aiObjectName) : '');
  const busyAny = applying || generating || refining || reverting;

  const renderModelRadio = () => (
    <div className="cover-edit-modal__model-row">
      <span className="cover-edit-modal__field-label">이미지 생성 모델</span>
      <label className={`cover-edit-modal__model-opt ${imageModel === 'nb_pro' ? 'is-selected' : ''}`}>
        <input
          type="radio"
          name="coverEditImageModel"
          checked={imageModel === 'nb_pro'}
          onChange={() => setImageModel('nb_pro')}
        />
        Nano Banana Pro
      </label>
      <label className={`cover-edit-modal__model-opt cover-edit-modal__model-opt--green ${imageModel === 'gpt_image_2' ? 'is-selected' : ''}`}>
        <input
          type="radio"
          name="coverEditImageModel"
          checked={imageModel === 'gpt_image_2'}
          onChange={() => setImageModel('gpt_image_2')}
        />
        GPT Image 2
      </label>
    </div>
  );

  const renderAiCommon = () => (
    <>
      {renderModelRadio()}
      <div className="cover-edit-modal__ai-actions">
        <button
          type="button"
          className="cover-edit-modal__gen-btn"
          onClick={handleGenerate}
          disabled={busyAny}
        >
          {generating ? (
            <><span className="cover-edit-modal__spinner" /> 생성 중...</>
          ) : (
            <>{aiObjectName ? '🔄 다시 생성' : 'AI 커버 생성'} <span className="cover-edit-modal__cost">⭐{coverCost}</span></>
          )}
        </button>
        {aiObjectName && sessionId && (
          <button
            type="button"
            className="cover-edit-modal__refine-toggle"
            onClick={() => setShowRefine((v) => !v)}
            disabled={busyAny}
          >
            {showRefine ? '추가 수정 닫기' : '추가 수정'}
          </button>
        )}
      </div>
      {aiObjectName && sessionId && showRefine && (
        <div className="cover-edit-modal__refine-panel">
          <label className="cover-edit-modal__field-label">
            수정 요청 (1~500자) — 변경할 부분만 명시하면 나머지는 보존됩니다.
          </label>
          <textarea
            className="cover-edit-modal__textarea"
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            placeholder={'예: 배경을 밤하늘로 바꿔주세요\n예: 전체 색감을 파스텔톤으로'}
          />
          <button
            type="button"
            className="cover-edit-modal__refine-btn"
            onClick={handleRefine}
            disabled={busyAny}
          >
            {refining ? '수정 중...' : '수정 실행'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="cover-edit-modal-overlay" onClick={onClose}>
      <div className="cover-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cover-edit-modal__header">
          <h3 className="cover-edit-modal__title">커버 수정 — {track?.title || ''}</h3>
          <button type="button" className="cover-edit-modal__close" onClick={onClose} title="닫기">
            <FiX />
          </button>
        </div>

        {/* 현재 커버 → 새 커버 미리보기 */}
        <div className="cover-edit-modal__preview-row">
          <div className="cover-edit-modal__preview-slot">
            <span className="cover-edit-modal__preview-label">현재 커버</span>
            <div className="cover-edit-modal__preview-box">
              {currentDisplay ? <img src={currentDisplay} alt="현재 커버" /> : <span className="cover-edit-modal__preview-empty">♪</span>}
            </div>
          </div>
          <FiArrowRight className="cover-edit-modal__preview-arrow" />
          <div className="cover-edit-modal__preview-slot">
            <span className="cover-edit-modal__preview-label">새 커버</span>
            <div className="cover-edit-modal__preview-box">
              {newPreview ? <img src={newPreview} alt="새 커버 미리보기" /> : <span className="cover-edit-modal__preview-empty">?</span>}
            </div>
          </div>
        </div>

        {/* 탭 */}
        <div className="cover-edit-modal__tabs">
          <button
            type="button"
            className={`cover-edit-modal__tab ${tab === 'file' ? 'is-active' : ''}`}
            onClick={() => { setTab('file'); setError(''); }}
          >
            <FiUploadCloud /> 파일 첨부
          </button>
          <button
            type="button"
            className={`cover-edit-modal__tab ${tab === 'character' ? 'is-active' : ''}`}
            onClick={() => { setTab('character'); setError(''); }}
          >
            <FiUser /> 내 캐릭터 AI <span className="cover-edit-modal__cost">⭐{coverCost}</span>
          </button>
          <button
            type="button"
            className={`cover-edit-modal__tab ${tab === 'prompt' ? 'is-active' : ''}`}
            onClick={() => { setTab('prompt'); setError(''); }}
          >
            <FiEdit3 /> 프롬프트 AI <span className="cover-edit-modal__cost">⭐{coverCost}</span>
          </button>
        </div>

        <div className="cover-edit-modal__body">
          {tab === 'file' && (
            <div className="cover-edit-modal__tab-panel">
              <label className="cover-edit-modal__file-label">
                <input type="file" accept="image/*" onChange={handleFileSelect} hidden />
                <FiUploadCloud /> {imageFile ? imageFile.name : '이미지 파일 선택 (무료)'}
              </label>
              <button
                type="button"
                className="cover-edit-modal__apply-btn"
                onClick={handleApplyFile}
                disabled={!imageFile || busyAny}
              >
                {applying ? '교체 중...' : '이 커버로 교체'}
              </button>
            </div>
          )}

          {tab === 'character' && (
            <div className="cover-edit-modal__tab-panel">
              {!charLoaded ? (
                <div className="cover-edit-modal__hint">캐릭터 정보를 불러오는 중...</div>
              ) : !(hasReal || hasVirtual) ? (
                <div className="cover-edit-modal__hint">
                  등록된 캐릭터가 없습니다. 마이뮤직 → 내 캐릭터 탭에서 먼저 캐릭터를 등록하세요.
                </div>
              ) : (
                <>
                  {/* v75 관행 — 실사화/가상화 중 있는 것만 카드로 표시 */}
                  <div className="cover-edit-modal__variant-row">
                    {[
                      hasReal && {
                        id: 'real',
                        label: '실사화',
                        subLabel: null,
                        objectName: myCharacter.sheet_object_name,
                      },
                      hasVirtual && {
                        id: 'virtual',
                        label: '가상화',
                        subLabel: myCharacter.virtual_art_style || null,
                        objectName: myCharacter.virtual_sheet_object_name,
                      },
                    ].filter(Boolean).map((card) => (
                      <label
                        key={card.id}
                        className={`cover-edit-modal__variant-card ${card.id === 'virtual' ? 'cover-edit-modal__variant-card--virtual' : ''} ${characterVariant === card.id ? 'is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="coverEditCharVariant"
                          checked={characterVariant === card.id}
                          onChange={() => {
                            setCharacterVariant(card.id);
                            if (import.meta.env.DEV) console.info('[CoverEditModal] char variant', { variant: card.id });
                          }}
                        />
                        <img src={api.characterPreviewUrl(card.objectName)} alt={card.label} />
                        <span className="cover-edit-modal__variant-name">
                          {card.label}
                          {card.subLabel && <em>{card.subLabel}</em>}
                        </span>
                      </label>
                    ))}
                  </div>
                  {renderAiCommon()}
                  <button
                    type="button"
                    className="cover-edit-modal__apply-btn"
                    onClick={handleApplyAi}
                    disabled={!aiObjectName || busyAny}
                  >
                    {applying ? '교체 중...' : '이 커버로 교체'}
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'prompt' && (
            <div className="cover-edit-modal__tab-panel">
              <label className="cover-edit-modal__field-label">커버 스타일 설명</label>
              <textarea
                className="cover-edit-modal__textarea"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder={'예: 사이버펑크 네온 도시, 비 오는 밤\n예: 수채화 느낌의 파스텔톤 풍경'}
              />
              {renderAiCommon()}
              <button
                type="button"
                className="cover-edit-modal__apply-btn"
                onClick={handleApplyAi}
                disabled={!aiObjectName || busyAny}
              >
                {applying ? '교체 중...' : '이 커버로 교체'}
              </button>
            </div>
          )}
        </div>

        {error && <div className="cover-edit-modal__error">{error}</div>}

        {/* 교체 성공 후: 완료/되돌리기 — 목록은 onUpdated 로 이미 즉시 갱신됨 */}
        {appliedRaw && (
          <div className="cover-edit-modal__done-bar">
            <span className="cover-edit-modal__done-msg">커버가 교체되었습니다.</span>
            {originalRef.current && (
              <button
                type="button"
                className="cover-edit-modal__revert-btn"
                onClick={handleRevert}
                disabled={busyAny}
                title="모달을 열 때의 커버로 되돌립니다"
              >
                <FiRotateCcw /> {reverting ? '되돌리는 중...' : '이전 커버로 되돌리기'}
              </button>
            )}
            <button
              type="button"
              className="cover-edit-modal__done-btn"
              onClick={onClose}
              disabled={busyAny}
            >
              완료
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
