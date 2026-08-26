import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiZap, FiMusic, FiClock, FiTrash2, FiRefreshCw, FiEdit3,
  FiCheck, FiArrowLeft, FiArrowRight, FiLoader,
  FiToggleLeft, FiToggleRight,
} from 'react-icons/fi';
import * as api from '../../api';
import {
  LYRICS_MODELS, GENRE_PRESETS, MOOD_PRESETS, STYLE_PRESETS,
  getGenreLabel, getMoodLabel, getStyleLabel,
  DEFAULT_POINT_COSTS, resolveCustomTag, getTranslatedValues,
  STRUCTURE_TAGS, formatDate, isLyricsDraft,
} from './studioShared';
import '../StudioTab2.css';

// v209 2단계 — 「작사실」: StudioTab2 의 작사 계열(구 step1-2·직접작성·다중모델 비교) 이식 + 내 작사 리스트.
// D2 확정: generateLyrics 성공 즉시 자동 영속(createGeneration start_music_gen:false, 무과금) — ⭐ 유실 창 봉합.
// 이미 draft 를 편집 중이면 PATCH(api.updateGeneration) 로 같은 문서를 갱신한다.
// props: onSendToCompose(draftDoc) — MyMusicPage 가 작곡실 탭으로 전환+인계 (handleSendToUpload 패턴 동형)
export default function LyricsStudioTab({ onSendToCompose }) {
  // ─── Step: 1=프롬프트 입력, 2=가사 확인/편집 (구 StudioTab2 번호 유지) ───
  const [step, setStep] = useState(1);

  // Step 1: Prompt
  const [description, setDescription] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [isDuet, setIsDuet] = useState(false);
  const [duetMainGender, setDuetMainGender] = useState('m');
  const [duetMainStyle, setDuetMainStyle] = useState('');
  const [duetSubStyle, setDuetSubStyle] = useState('');

  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [generatingLyrics, setGeneratingLyrics] = useState(false);
  // 느낌 카테고리 (가사 생성 결과로 받은 깨끗한 문자열 배열 — 생성/발행 시 관통)
  const [categories, setCategories] = useState([]);
  // 고정 10종 느낌 카테고리 (백엔드 GET /charts/categories 로드, 편집 토글 UI 용)
  const [allCategories, setAllCategories] = useState([]);
  // Instrumental 토글 (가사 편집 UI 노출 제어 — draft 에는 미저장, 구 StudioTab2 step2 동작 그대로)
  const [isInstrumental, setIsInstrumental] = useState(false);

  // AI 모델 선택 (가사 생성)
  const [lyricsModels, setLyricsModels] = useState(['gpt-4o-mini']);
  const [lyricsResults, setLyricsResults] = useState(null);
  const [showLyricsCompare, setShowLyricsCompare] = useState(false);

  // 현재 편집 중인 내 작사 draft id (없으면 저장 시 신규 생성)
  const [draftId, setDraftId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ─── 내 작사 리스트 (draft = pending && !point_ref && !result_audio_url) ───
  const [myDrafts, setMyDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const [pointCosts, setPointCosts] = useState(DEFAULT_POINT_COSTS);

  const customGenreRef = useRef(null);
  const customMoodRef = useRef(null);
  const customStyleRef = useRef(null);
  const lyricsRef = useRef(null);

  // 가격 단일 소스 로드 — 실패 시 기본값 유지 (표기용, 비치명)
  useEffect(() => {
    api.getPointCosts()
      .then(({ data }) => {
        const costs = data?.costs;
        if (costs && typeof costs === 'object') {
          setPointCosts((prev) => ({ ...prev, ...costs }));
        }
      })
      .catch((err) => {
        console.error('[LyricsStudioTab] getPointCosts failed (fallback defaults)', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // 느낌 카테고리 고정 10종 로드 (편집 토글 UI 용). 하드코딩 금지, 실패 시 빈 배열 폴백.
  useEffect(() => {
    if (import.meta.env.DEV) console.info('[LyricsCategoryEdit] loading fixed categories');
    api.getCategories()
      .then(({ data }) => {
        const list = Array.isArray(data?.categories) ? data.categories : [];
        setAllCategories(list);
        if (import.meta.env.DEV) console.info('[LyricsCategoryEdit] categories loaded', { count: list.length });
      })
      .catch((err) => {
        setAllCategories([]);
        console.warn('[LyricsCategoryEdit] getCategories failed, fallback to empty', { status: err?.response?.status, message: err?.message });
      });
  }, []);

  // 칩 클릭 → 선택 카테고리(categories state) 추가/삭제 토글
  const toggleCategory = useCallback((cat) => {
    setCategories((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const selected = list.includes(cat);
      if (import.meta.env.DEV) console.info('[LyricsCategoryEdit] toggle', { cat, selected: !selected });
      return selected ? list.filter((c) => c !== cat) : [...list, cat];
    });
  }, []);

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

  const toggleStyle = (s) => {
    setSelectedStyles((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  // 직접입력 필드에 남아있는 값을 자동으로 칩에 추가
  const flushCustomInputs = () => {
    if (customGenreRef.current && customGenreRef.current.value.trim()) {
      const val = resolveCustomTag(customGenreRef.current.value.trim(), GENRE_PRESETS) || customGenreRef.current.value.trim();
      if (!selectedGenres.includes(val)) setSelectedGenres((prev) => [...prev, val]);
      customGenreRef.current.value = '';
    }
    if (customMoodRef.current && customMoodRef.current.value.trim()) {
      const val = resolveCustomTag(customMoodRef.current.value.trim(), MOOD_PRESETS) || customMoodRef.current.value.trim();
      if (!selectedMoods.includes(val)) setSelectedMoods((prev) => [...prev, val]);
      customMoodRef.current.value = '';
    }
    if (customStyleRef.current && customStyleRef.current.value.trim()) {
      const val = resolveCustomTag(customStyleRef.current.value.trim(), STYLE_PRESETS) || customStyleRef.current.value.trim();
      if (!selectedStyles.includes(val)) setSelectedStyles((prev) => [...prev, val]);
      customStyleRef.current.value = '';
    }
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

  // ─── 내 작사 리스트 로드 ───
  const fetchMyDrafts = async () => {
    setLoadingDrafts(true);
    try {
      const { data } = await api.getGenerations({ limit: 50 });
      setMyDrafts((data.generations || []).filter(isLyricsDraft));
    } catch (err) {
      console.error('[LyricsStudioTab] fetch drafts failed', { status: err?.response?.status, message: err?.message });
    } finally {
      setLoadingDrafts(false);
    }
  };

  useEffect(() => {
    fetchMyDrafts();
    // 마운트 1회 의도 — fetchMyDrafts 는 비메모이즈 함수 (StudioTab2 fetchHistory 선례)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 번역: 현재 선택 칩 → 영문 문자열 (프리셋은 통과, 커스텀만 translateTags — 실패 시 원본 유지) ───
  const translateSelections = async () => {
    const [genreStr, moodStr, styleStr] = await Promise.all([
      getTranslatedValues(selectedGenres, GENRE_PRESETS),
      getTranslatedValues(selectedMoods, MOOD_PRESETS),
      getTranslatedValues(selectedStyles, STYLE_PRESETS),
    ]);
    return { genreStr, moodStr, styleStr };
  };

  // ─── draft 영속 — draftId 있으면 PATCH(updateGeneration), 없으면 createGeneration(start_music_gen:false, 무과금) ───
  // 서버가 prompt 공백 불허(400) → 직접 작성으로 description 이 비면 제목/기본 문구로 대체.
  const persistDraft = async ({ titleVal, lyricsVal, categoriesVal }) => {
    const { genreStr, moodStr, styleStr } = await translateSelections();
    const fields = {
      prompt: description.trim() || (titleVal || '').trim() || '직접 작성 가사',
      title: (titleVal || '').trim() || null,
      lyrics: (lyricsVal || '').trim(),
      genre: genreStr,
      mood: moodStr,
      style: styleStr,
      categories: Array.isArray(categoriesVal) ? categoriesVal : [],
      // v209 3단계: duet 플래그도 create·PATCH 공통 저장 (백엔드 GenerateRequest/UpdateGenerationRequest 반영 완료)
      duet: isDuet,
      duet_main_vocal_style: isDuet ? duetMainStyle.trim() || null : null,
      duet_sub_vocal_style: isDuet ? duetSubStyle.trim() || null : null,
    };
    if (draftId) {
      const { data } = await api.updateGeneration(draftId, fields);
      if (import.meta.env.DEV) console.info('[LyricsStudioTab] draft updated', { id: draftId });
      return data;
    }
    const { data } = await api.createGeneration({
      ...fields,
      model: 'suno',
      start_music_gen: false,
    });
    if (data?.id) setDraftId(data.id);
    if (import.meta.env.DEV) console.info('[LyricsStudioTab] draft created', { id: data?.id });
    return data;
  };

  // v209 D2 — ⭐ 유실 창 봉합: 작사 성공 즉시 자동 영속 (무과금 — 실패는 비치명, 수동 [저장] 재시도 가능)
  const autoPersist = async (titleVal, lyricsVal, categoriesVal) => {
    try {
      await persistDraft({ titleVal, lyricsVal, categoriesVal });
      fetchMyDrafts();
    } catch (err) {
      console.warn('[LyricsStudioTab] auto persist failed (ignored)', { status: err?.response?.status, message: err?.message });
    }
  };

  // ─── AI 가사 생성 (구 StudioTab2 handleGenerateLyrics — 성공 즉시 영속 추가) ───
  const handleGenerateLyrics = async () => {
    flushCustomInputs();
    setError('');
    setSuccessMsg('');
    if (!description.trim()) {
      setError('어떤 음악을 만들고 싶은지 설명해주세요.');
      return;
    }

    setGeneratingLyrics(true);
    try {
      const { genreStr, moodStr, styleStr } = await translateSelections();
      const { data } = await api.generateLyrics({
        prompt: description.trim(),
        genre: genreStr,
        mood: moodStr,
        style: styleStr,
        duration_minutes: durationMinutes,
        language: 'ko',
        duet: isDuet,
        duet_main_vocal_style: isDuet ? duetMainStyle.trim() || null : null,
        duet_sub_vocal_style: isDuet ? duetSubStyle.trim() || null : null,
        models: lyricsModels,
      });
      api.notifyPointsRefresh(); // 작사 ⭐ 차감 즉시 헤더 배지 갱신
      if (data.results && Array.isArray(data.results)) {
        // 다중 모델 결과 → 비교 UI (영속은 「이걸로 선택」 시점 — 확정 가사가 아직 없음)
        setLyricsResults(data.results);
        setShowLyricsCompare(true);
      } else {
        setTitle(data.title || '');
        setLyrics(data.lyrics || '');
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        if (import.meta.env.DEV) {
          console.info('[LyricsResult] lyrics generated', { categories: data.categories || [] });
        }
        setShowLyricsCompare(false);
        setLyricsResults(null);
        setStep(2);
        await autoPersist(data.title, data.lyrics, data.categories);
      }
    } catch (err) {
      if (api.isInsufficientPoints(err)) {
        api.notifyPointsRefresh();
        setError(`별이 부족해요. AI 작사에는 ⭐${pointCosts.lyrics}개가 필요합니다.`);
      } else {
        const msg = err.response?.data?.error || '가사 생성에 실패했습니다.';
        setError(msg);
      }
    } finally {
      setGeneratingLyrics(false);
    }
  };

  // 비교 뷰 「이걸로 선택」 — 채택 즉시 영속
  const handleSelectCompareResult = (result) => {
    setTitle(result.title);
    setLyrics(result.lyrics);
    setCategories(Array.isArray(result.categories) ? result.categories : []);
    if (import.meta.env.DEV) {
      console.info('[LyricsResult] compare result selected', { model: result.model, categories: result.categories || [] });
    }
    setShowLyricsCompare(false);
    setLyricsResults(null);
    setStep(2);
    autoPersist(result.title, result.lyrics, result.categories);
  };

  // ─── 수동 [저장] (직접 작성 경로 포함) ───
  const handleSaveDraft = async () => {
    if (!lyrics.trim()) {
      setError('가사를 입력해주세요.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await persistDraft({ titleVal: title, lyricsVal: lyrics, categoriesVal: categories });
      setSuccessMsg('내 작사에 저장되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchMyDrafts();
    } catch (err) {
      console.error('[LyricsStudioTab] save draft failed', { status: err?.response?.status, message: err?.message });
      setError(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // ─── [작곡하기 →] — 최신 내용 저장 후 draft doc 을 작곡실로 인계 ───
  const handleSendToComposeClick = async () => {
    if (!lyrics.trim()) {
      setError('가사를 입력해주세요.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const doc = await persistDraft({ titleVal: title, lyricsVal: lyrics, categoriesVal: categories });
      if (import.meta.env.DEV) console.info('[LyricsStudioTab] sendToCompose', { id: doc?.id || draftId });
      if (onSendToCompose) onSendToCompose(doc);
    } catch (err) {
      console.error('[LyricsStudioTab] sendToCompose failed', { status: err?.response?.status, message: err?.message });
      setError(err.response?.data?.error || '작곡실로 보내기에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // ─── 리스트: 수정 로드 (doc 의 영문 태그 문자열을 칩으로 분해 — 프리셋은 한글 라벨로 표시됨) ───
  const splitTags = (s) => (s ? s.split(', ').filter(Boolean) : []);
  const handleEditDraft = (gen) => {
    setDraftId(gen.id);
    setDescription(gen.prompt || '');
    setTitle(gen.title || '');
    setLyrics(gen.lyrics || '');
    setCategories(Array.isArray(gen.categories) ? gen.categories : []);
    setSelectedGenres(splitTags(gen.genre));
    setSelectedMoods(splitTags(gen.mood));
    setSelectedStyles(splitTags(gen.style));
    setIsDuet(!!gen.duet);
    setDuetMainStyle(gen.duet_main_vocal_style || '');
    setDuetSubStyle(gen.duet_sub_vocal_style || '');
    setError('');
    setSuccessMsg('');
    setStep(2);
    if (import.meta.env.DEV) console.info('[LyricsStudioTab] edit draft', { id: gen.id });
  };

  // ─── 리스트: 삭제 ───
  const handleDeleteDraft = async (id) => {
    if (!window.confirm('이 작사를 삭제하시겠습니까?')) return;
    setDeletingId(id);
    try {
      await api.deleteGeneration(id);
      setMyDrafts((prev) => prev.filter((g) => g.id !== id));
      if (draftId === id) setDraftId(null);
    } catch (err) {
      console.error('[LyricsStudioTab] delete draft failed', { status: err?.response?.status, message: err?.message });
      alert(err.response?.data?.error || '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  // ─── 새 작사로 시작 (편집 중 draft 해제 + 폼 초기화) ───
  const handleNewDraft = () => {
    setDraftId(null);
    setDescription('');
    setTitle('');
    setLyrics('');
    setCategories([]);
    setSelectedGenres([]);
    setSelectedMoods([]);
    setSelectedStyles([]);
    setDurationMinutes(2);
    setIsDuet(false);
    setDuetMainGender('m');
    setDuetMainStyle('');
    setDuetSubStyle('');
    setLyricsResults(null);
    setShowLyricsCompare(false);
    setError('');
    setSuccessMsg('');
    setStep(1);
  };

  return (
    <div className="s2">
      {/* ─── Steps: 프롬프트 입력 → 가사 확인 ─── */}
      <div className="s2__steps">
        <div className={`s2__step ${step >= 1 ? 's2__step--active' : ''} ${step > 1 ? 's2__step--done' : ''}`}>
          <span className="s2__step-num">1</span>
          <span className="s2__step-label">프롬프트 입력</span>
        </div>
        <div className="s2__step-line" />
        <div className={`s2__step ${step >= 2 ? 's2__step--active' : ''}`}>
          <span className="s2__step-num">2</span>
          <span className="s2__step-label">가사 확인</span>
        </div>
      </div>

      {/* 편집 중 안내 — 리스트에서 [수정]으로 로드된 경우 */}
      {draftId && (
        <div className="s2__msg s2__msg--success" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span>📝 「내 작사」 항목을 수정 중입니다 — 저장하면 같은 항목이 갱신됩니다.</span>
          <button type="button" className="s2__skip-btn" style={{ margin: 0 }} onClick={handleNewDraft}>
            새 작사로 시작 →
          </button>
        </div>
      )}

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
            <label className="s2__label">장르 — 어떤 종류의 음악인지 (선택)</label>
            <div className="s2__chips">
              {selectedGenres.map((g) => (
                <button
                  key={g}
                  type="button"
                  className="s2__chip s2__chip--active"
                  onClick={() => toggleGenre(g)}
                >
                  {getGenreLabel(g)} ×
                </button>
              ))}
              {GENRE_PRESETS.filter(({ value }) => !selectedGenres.includes(value)).map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  className="s2__chip"
                  onClick={() => toggleGenre(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              ref={customGenreRef}
              className="s2__custom-input"
              type="text"
              placeholder="직접 입력 후 Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  const val = resolveCustomTag(e.target.value.trim(), GENRE_PRESETS) || e.target.value.trim();
                  if (!selectedGenres.includes(val)) setSelectedGenres((prev) => [...prev, val]);
                  e.target.value = '';
                  e.preventDefault();
                }
              }}
            />
          </div>

          <div className="s2__section">
            <label className="s2__label">분위기 — 어떤 감정/느낌의 음악인지 (선택)</label>
            <div className="s2__chips">
              {selectedMoods.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="s2__chip s2__chip--active"
                  onClick={() => toggleMood(m)}
                >
                  {getMoodLabel(m)} ×
                </button>
              ))}
              {MOOD_PRESETS.filter(({ value }) => !selectedMoods.includes(value)).map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  className="s2__chip"
                  onClick={() => toggleMood(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              ref={customMoodRef}
              className="s2__custom-input"
              type="text"
              placeholder="직접 입력 후 Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  const val = resolveCustomTag(e.target.value.trim(), MOOD_PRESETS) || e.target.value.trim();
                  if (!selectedMoods.includes(val)) setSelectedMoods((prev) => [...prev, val]);
                  e.target.value = '';
                  e.preventDefault();
                }
              }}
            />
          </div>

          <div className="s2__section">
            <label className="s2__label">스타일 — 음악의 질감/프로덕션 느낌 (선택)</label>
            <div className="s2__chips">
              {selectedStyles.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="s2__chip s2__chip--active"
                  onClick={() => toggleStyle(s)}
                >
                  {getStyleLabel(s)} ×
                </button>
              ))}
              {STYLE_PRESETS.filter(({ value }) => !selectedStyles.includes(value)).map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  className="s2__chip"
                  onClick={() => toggleStyle(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              ref={customStyleRef}
              className="s2__custom-input"
              type="text"
              placeholder="직접 입력 후 Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  const val = resolveCustomTag(e.target.value.trim(), STYLE_PRESETS) || e.target.value.trim();
                  if (!selectedStyles.includes(val)) setSelectedStyles((prev) => [...prev, val]);
                  e.target.value = '';
                  e.preventDefault();
                }
              }}
            />
          </div>

          <div className="s2__section">
            <label className="s2__label">음악 길이 — 가사 분량 기준</label>
            <div className="s2__chips">
              {[1, 2, 3].map((min) => (
                <button
                  key={min}
                  type="button"
                  className={`s2__chip ${durationMinutes === min ? 's2__chip--active' : ''}`}
                  onClick={() => setDurationMinutes(min)}
                >
                  {min}분
                </button>
              ))}
            </div>
          </div>

          <div className="s2__section">
            <label className="s2__label">곡 형식</label>
            <div className="s2__chips">
              <button type="button" className={`s2__chip ${!isDuet ? 's2__chip--active' : ''}`} onClick={() => setIsDuet(false)}>솔로</button>
              <button type="button" className={`s2__chip ${isDuet ? 's2__chip--active' : ''}`} onClick={() => setIsDuet(true)}>듀엣</button>
            </div>
            {isDuet && (
              <div className="s2__duet-settings">
                <div className="s2__duet-row">
                  <label className="s2__label">주 보컬 성별</label>
                  <select
                    className="s2__select"
                    value={duetMainGender}
                    onChange={(e) => setDuetMainGender(e.target.value)}
                  >
                    <option value="m">남성</option>
                    <option value="f">여성</option>
                  </select>
                </div>
                <div className="s2__duet-row">
                  <label className="s2__label">주 보컬 느낌 ({duetMainGender === 'm' ? '남성' : '여성'})</label>
                  <input
                    type="text"
                    className="s2__input"
                    value={duetMainStyle}
                    onChange={(e) => setDuetMainStyle(e.target.value)}
                    placeholder="예: warm, deep, powerful"
                  />
                </div>
                <div className="s2__duet-row">
                  <label className="s2__label">상대 보컬 느낌 ({duetMainGender === 'm' ? '여성' : '남성'})</label>
                  <input
                    type="text"
                    className="s2__input"
                    value={duetSubStyle}
                    onChange={(e) => setDuetSubStyle(e.target.value)}
                    placeholder="예: soft, sweet, breathy"
                  />
                </div>
              </div>
            )}
          </div>

          {error && <div className="s2__msg s2__msg--error">{error}</div>}
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          {/* AI 모델 선택 */}
          <div className="model-select-section" style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block' }}>AI 모델 선택</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {LYRICS_MODELS.map(model => (
                <label key={model.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: lyricsModels.includes(model.id) ? `2px solid ${model.color}` : '2px solid #333', background: lyricsModels.includes(model.id) ? `${model.color}15` : '#1a1a1a', fontSize: '13px', color: '#ddd', minWidth: '180px' }}>
                  <input type="checkbox" checked={lyricsModels.includes(model.id)} onChange={() => {
                    setLyricsModels(prev => prev.includes(model.id) ? prev.filter(m => m !== model.id) : [...prev, model.id]);
                  }} style={{ accentColor: model.color, marginTop: '2px' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600 }}>{model.name}</span>
                    <span style={{ color: '#666', fontSize: '11px' }}>in {model.inPrice}  out {model.outPrice}</span>
                    <span style={{ color: '#666', fontSize: '11px' }}>1회 ≈ {model.perCall} ({model.perCallKRW})</span>
                  </div>
                </label>
              ))}
            </div>
            {lyricsModels.length === 0 && <p style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>최소 1개 모델을 선택하세요</p>}
          </div>

          <button
            className="s2__submit"
            onClick={handleGenerateLyrics}
            disabled={generatingLyrics || lyricsModels.length === 0}
          >
            {generatingLyrics ? (
              <>
                <FiLoader className="s2__spin" />
                AI가 가사를 작성하고 있습니다...
              </>
            ) : (
              <>
                <FiEdit3 />
                AI 가사 생성하기 <span className="s2__cost-badge">⭐{pointCosts.lyrics}</span>
              </>
            )}
          </button>

          {/* 모델 비교 뷰 */}
          {showLyricsCompare && lyricsResults && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '16px' }}>
              {lyricsResults.map((result, idx) => {
                const modelInfo = LYRICS_MODELS.find(m => m.id === result.model) || { name: result.model, color: '#888' };
                return (
                  <div key={idx} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: `1px solid ${modelInfo.color}33`, borderTop: `3px solid ${modelInfo.color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: modelInfo.color }}>
                        {modelInfo.name}
                      </span>
                    </div>
                    <h4 style={{ color: '#fff', marginBottom: '8px' }}>{result.title}</h4>
                    {Array.isArray(result.categories) && result.categories.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                        {result.categories.map((cat) => (
                          <span key={cat} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '999px', background: `${modelInfo.color}22`, color: modelInfo.color, border: `1px solid ${modelInfo.color}55` }}>
                            #{cat}
                          </span>
                        ))}
                      </div>
                    )}
                    <pre style={{ color: '#ccc', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto', lineHeight: 1.6 }}>{result.lyrics}</pre>
                    <button onClick={() => handleSelectCompareResult(result)} style={{ marginTop: '12px', width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: modelInfo.color, color: '#000', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}>
                      이걸로 선택
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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

          {/* 느낌 카테고리 (고정 10종 토글 편집 — 항상 노출) */}
          <div className="s2__section">
            <label className="s2__label">느낌 카테고리</label>
            <p className="s2__hint">칩을 눌러 직접 추가/삭제할 수 있어요</p>
            <div className="s2__chips">
              {(Array.isArray(allCategories) ? allCategories : []).map((cat) => {
                const active = Array.isArray(categories) && categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`s2__chip ${active ? 's2__chip--active' : ''}`}
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={active}
                  >
                    #{cat}
                  </button>
                );
              })}
              {/* 폴백: 로드 실패로 10종이 비었는데 LLM 선택값이 있으면 그 값만이라도 보여주고 해제 가능 */}
              {Array.isArray(allCategories) && allCategories.length === 0 &&
                (Array.isArray(categories) ? categories : []).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className="s2__chip s2__chip--active"
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={true}
                  >
                    #{cat}
                  </button>
                ))}
            </div>
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
          {successMsg && <div className="s2__msg s2__msg--success">{successMsg}</div>}

          <div className="s2__btn-row">
            <button className="s2__btn-back" onClick={() => setStep(1)}>
              <FiArrowLeft /> 이전
            </button>
            <button
              className="s2__btn-regen"
              onClick={handleGenerateLyrics}
              disabled={generatingLyrics || saving}
            >
              <FiRefreshCw className={generatingLyrics ? 's2__spin' : ''} />
              가사 재생성 <span className="s2__cost-badge">⭐{pointCosts.lyrics}</span>
            </button>
            <button className="s2__submit" onClick={handleSaveDraft} disabled={saving || generatingLyrics}>
              {saving ? <><FiLoader className="s2__spin" /> 저장 중...</> : <><FiCheck /> 저장</>}
            </button>
            <button className="s2__submit s2__submit--next" onClick={handleSendToComposeClick} disabled={saving || generatingLyrics}>
              작곡하기 <FiArrowRight />
            </button>
          </div>
        </div>
      )}

      {/* ─── 내 작사 리스트 — 보기(펼침)/수정/삭제/[작곡하기 →] ─── */}
      <div className="s2__history">
        <div className="s2__history-header">
          <h3 className="s2__history-title">
            <FiClock /> 내 작사
          </h3>
          <button className="s2__history-refresh" onClick={fetchMyDrafts} disabled={loadingDrafts}>
            <FiRefreshCw className={loadingDrafts ? 's2__spin' : ''} />
          </button>
        </div>

        {loadingDrafts && myDrafts.length === 0 ? (
          <div className="s2__history-empty">로딩 중...</div>
        ) : myDrafts.length === 0 ? (
          <div className="s2__history-empty">아직 저장된 작사가 없습니다. 위에서 가사를 만들어 저장해보세요.</div>
        ) : (
          <div className="s2__history-list">
            {myDrafts.map((gen) => {
              const expanded = expandedId === gen.id;
              return (
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
                    {Array.isArray(gen.categories) && gen.categories.map((cat) => (
                      <span key={cat} className="s2__gen-tag">#{cat}</span>
                    ))}
                  </div>
                  {expanded && (
                    <pre className="s2__preview-lyrics" style={{ marginTop: '8px' }}>{gen.lyrics || '(가사 없음)'}</pre>
                  )}
                  <div className="s2__gen-player">
                    <button
                      className="s2__draft-resume"
                      onClick={() => setExpandedId(expanded ? null : gen.id)}
                    >
                      {expanded ? '접기 ▲' : '보기 ▼'}
                    </button>
                    <button
                      className="s2__draft-resume"
                      onClick={() => handleEditDraft(gen)}
                    >
                      <FiEdit3 /> 수정
                    </button>
                    <button
                      className="s2__draft-resume"
                      onClick={() => {
                        if (import.meta.env.DEV) console.info('[LyricsStudioTab] sendToCompose (list)', { id: gen.id });
                        if (onSendToCompose) onSendToCompose(gen);
                      }}
                    >
                      <FiMusic /> 작곡하기 <FiArrowRight />
                    </button>
                  </div>
                  <div className="s2__gen-bottom">
                    <span className="s2__gen-date">{formatDate(gen.created_at)}</span>
                    <div className="s2__gen-actions">
                      <button
                        className="s2__gen-delete"
                        onClick={() => handleDeleteDraft(gen.id)}
                        disabled={deletingId === gen.id}
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
