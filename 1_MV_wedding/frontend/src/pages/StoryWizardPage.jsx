import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as api from '../api';
import StepIndicator from '../components/StepIndicator';
import DynamicList from '../components/DynamicList';
import TagInput from '../components/TagInput';
import SceneInput from '../components/SceneInput';
import MentionField from '../components/MentionField';
import PolishButton from '../components/PolishButton';
import CharacterSheetPanel from '../components/CharacterSheetPanel';
import PlaceAssetPanel from '../components/PlaceAssetPanel';
import './StoryWizardPage.css';

const DRAFT_KEY = 'wedding-wizard-draft';

const SHEET_KEYS = ['groom_casual', 'groom_wedding', 'bride_casual', 'bride_wedding'];

const SHEET_PANELS = [
  { key: 'groom_casual', role: 'groom', style: 'casual', title: '신랑 캐릭터 시트 · 평상복' },
  { key: 'groom_wedding', role: 'groom', style: 'wedding', title: '신랑 캐릭터 시트 · 웨딩 촬영복' },
  { key: 'bride_casual', role: 'bride', style: 'casual', title: '신부 캐릭터 시트 · 평상복' },
  { key: 'bride_wedding', role: 'bride', style: 'wedding', title: '신부 캐릭터 시트 · 웨딩 촬영복' },
];

const emptySheetSlot = () => ({
  // face_file is a File — cannot survive sessionStorage; only face_preview (blob URL),
  // face_object_name (MinIO object key from /assets/upload), and the rest are serialised.
  face_file: null,
  face_preview: '',
  // Post-v6 fix: pre-upload the face photo to MinIO at file-selection time so
  // the object key survives the outfit-selection round-trip via sessionStorage.
  // The generate/refine endpoints accept this string directly.
  face_object_name: null,
  face_uploading: false,
  // v7 — 사용자 지정 시트 이름 (예: "평상복 신랑")
  display_name: '',
  user_text: '',
  image_model: 'gpt_image_2',
  items: { top: null, bottom: null, shoes: null },
  generated: null,
  generating: false,
  error: '',
  refining: false,
  refine_request: '',
  // v6 — background job ids + start timestamps. Preserved across refreshes so
  // CharacterSheetPanel can re-attach its polling effect on rehydrate.
  generate_job_id: null,
  generate_started_at: null,
  refine_job_id: null,
  refine_started_at: null,
});

// Strip non-serialisable fields (File object) before persisting.
const sanitizeSheetsForStorage = (sheets) => {
  const out = {};
  for (const key of SHEET_KEYS) {
    const s = sheets?.[key] || emptySheetSlot();
    out[key] = {
      ...s,
      face_file: null,
      // blob: URLs are tied to the current page's File and won't survive a refresh,
      // but they survive a same-tab navigation (which is what we need for the
      // outfit round-trip). Keep as-is.
      generating: false,
      refining: false,
      // Post-v6 fix: face_object_name is a plain string — preserve it.
      // face_uploading is transient (in-flight indicator) — always reset.
      face_object_name: s.face_object_name ?? null,
      face_uploading: false,
      // v7 — display_name 명시 보존 (spread 가 처리하지만 안전상 명시).
      display_name: s.display_name ?? '',
      // v6 — preserve job ids + start timestamps so polling resumes after
      // refresh. CharacterSheetPanel detects "job_id present but !generating"
      // on mount and flips generating back to true to kick the poll effect.
      generate_job_id: s.generate_job_id ?? null,
      generate_started_at: s.generate_started_at ?? null,
      refine_job_id: s.refine_job_id ?? null,
      refine_started_at: s.refine_started_at ?? null,
    };
  }
  return out;
};

// Cleanup stale generated-sheet draft on rehydrate:
//   Older sessions persisted `generated.preview_url` as a path-only string
//   (`/api/character/preview/...`) which the browser would resolve against the
//   frontend origin and without the auth token. Rebuild it via sheetPreviewUrl
//   so the <img> renders after refresh.
const reconcileGeneratedFields = (slot) => {
  const generated = slot?.generated;
  if (!generated || !generated.object_name) return slot;
  const url = generated.preview_url || '';
  // A "good" URL is absolute (http(s)://...) AND carries the ?token= query.
  const isGood = /^https?:\/\//i.test(url) && url.includes('token=');
  if (isGood) return slot;
  return {
    ...slot,
    generated: {
      ...generated,
      preview_url: api.sheetPreviewUrl(generated.object_name),
    },
  };
};

// Cleanup stale face draft on rehydrate:
//   - face_preview blob: URLs from a previous page lifetime are dead — replace
//     them with the durable network preview if face_object_name is present, or
//     wipe them otherwise (so the user isn't trapped with a broken thumbnail +
//     disabled "시트 생성" button).
const reconcileFaceFields = (slot) => {
  const objectName = slot?.face_object_name || '';
  const preview = slot?.face_preview || '';
  const previewIsBlob = typeof preview === 'string' && preview.startsWith('blob:');
  if (objectName) {
    // Pre-uploaded face exists. If the cached preview is a now-dead blob: URL,
    // swap to the network preview so the thumbnail still renders.
    if (previewIsBlob) {
      return { ...slot, face_preview: api.sheetPreviewUrl(objectName) };
    }
    return slot;
  }
  // No object_name → the cached blob: URL is meaningless; wipe it so the
  // dropzone shows its placeholder and the user uploads fresh.
  if (previewIsBlob) {
    return { ...slot, face_preview: '' };
  }
  return slot;
};

const mergeSheets = (base) => {
  const out = {};
  for (const key of SHEET_KEYS) {
    const merged = { ...emptySheetSlot(), ...(base?.[key] || {}) };
    merged.items = { top: null, bottom: null, shoes: null, ...(base?.[key]?.items || {}) };
    out[key] = reconcileGeneratedFields(reconcileFaceFields(merged));
  }
  return out;
};

const STEPS = ['두사람', '시간', '약속', '결혼식', '음악'];

const TONE_OPTIONS = [
  '잔잔 · 차분',
  '잔잔하다가 따뜻하게 차오르는',
  '밝고 경쾌',
  '엄숙 · 격식 + 진중',
];

const GENRE_OPTIONS = ['발라드', '팝', 'R&B', '포크', '어쿠스틱', '일렉트로닉'];

const MOOD_OPTIONS = ['따뜻한', '잔잔한', '벅찬', '희망찬', '그리운', '경쾌한'];

const VOCAL_STYLE_OPTIONS = [
  { value: 'female_warm', label: '여성 · 따뜻한' },
  { value: 'female_powerful', label: '여성 · 파워풀한' },
  { value: 'female_husky', label: '여성 · 허스키한' },
  { value: 'female_sweet', label: '여성 · 달콤한' },
  { value: 'male_warm', label: '남성 · 따뜻한' },
  { value: 'male_powerful', label: '남성 · 파워풀한' },
  { value: 'male_husky', label: '남성 · 허스키한' },
  { value: 'male_soft', label: '남성 · 부드러운' },
];

const MODEL_OPTIONS = [
  { value: null, label: '기본 (Claude Opus 4.7)' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'gpt-4o-mini', label: 'GPT-4o-mini (저렴)' },
];

const initialData = () => ({
  couple: {
    partner_a: { name: '', age: '' },
    partner_b: { name: '', age: '' },
  },
  story: {
    // v2.2 — 각 시점은 단일 텍스트. 사용자가 통문장으로 적고 AI가 추출.
    // v8 — @-멘션 refs 6개 필드 추가 (sheet/place 자산 태깅).
    meeting: '',
    meeting_refs: [],
    first_date: '',
    first_date_refs: [],
    memories: [''],
    memories_refs: [[]],
    proposal: '',
    proposal_refs: [],
    wedding_prep: '',
    wedding_prep_refs: [],
    rituals: '',
    rituals_refs: [],
  },
  vow: {
    keywords: [],
    line: '',
  },
  wedding_context: {
    tone: '잔잔하다가 따뜻하게 차오르는',
    audience_line: '',
  },
  music_spec: {
    genre: '발라드',
    moods: ['따뜻한', '잔잔한'],
    duration_minutes: 2,
    vocal_form: 'duet',
    vocal_styles: { main: 'female_warm', sub: 'male_warm' },
    language: 'ko',
    model: null,
  },
  sheets: {
    groom_casual: emptySheetSlot(),
    groom_wedding: emptySheetSlot(),
    bride_casual: emptySheetSlot(),
    bride_wedding: emptySheetSlot(),
  },
  // v36 — 잡 신규 생성 후 박힘. ?new=1 또는 stale 복구 시 명시적으로 null 보장.
  current_job_id: null,
});

export default function StoryWizardPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // v33 — URL `?new=1` 이면 sessionStorage 초기화 + backend draft 도 삭제 후
  // 빈 상태로 시작 (마운트 useEffect 에서 backend delete 호출).
  const isNewMode = new URLSearchParams(location.search).get('new') === '1';

  // Try to rehydrate wizard draft from sessionStorage (survives outfit-page round-trip).
  const loadInitial = () => {
    const base = initialData();
    if (isNewMode) {
      // 백지 새 작품. sessionStorage 도 비움.
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      if (import.meta.env.DEV) console.info('[StoryWizard] new=1 — fresh start');
      return { data: base, step: 1 };
    }
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return { data: base, step: 1 };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { data: base, step: 1 };
      const restoredData = parsed.data
        ? { ...base, ...parsed.data, sheets: mergeSheets(parsed.data.sheets) }
        : base;
      // v8 — story 의 refs 키 보정 (구버전 draft 호환 + memories_refs 길이 정합).
      if (restoredData && typeof restoredData === 'object') {
        const story = { ...base.story, ...(restoredData.story || {}) };
        if (!Array.isArray(story.memories) || story.memories.length === 0) {
          story.memories = [''];
        }
        const memN = story.memories.length;
        const memRefs = Array.isArray(story.memories_refs) ? story.memories_refs.slice() : [];
        while (memRefs.length < memN) memRefs.push([]);
        memRefs.length = memN;
        story.memories_refs = memRefs.map((r) => (Array.isArray(r) ? r : []));
        // 6개 단일 refs 필드 정합 (배열이 아니면 빈 배열로).
        const singleKeys = [
          'meeting_refs',
          'first_date_refs',
          'proposal_refs',
          'wedding_prep_refs',
          'rituals_refs',
        ];
        for (const k of singleKeys) {
          if (!Array.isArray(story[k])) story[k] = [];
        }
        restoredData.story = story;
      }
      const restoredStep =
        typeof parsed.step === 'number' && parsed.step >= 1 && parsed.step <= 6
          ? parsed.step
          : 1;
      if (import.meta.env.DEV) {
        console.info('[StoryWizard] draft rehydrated', { step: restoredStep });
      }
      return { data: restoredData, step: restoredStep };
    } catch (err) {
      console.error('[StoryWizard] failed to rehydrate draft', { err });
      return { data: base, step: 1 };
    }
  };

  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = loadInitial();

  const [step, setStep] = useState(initialRef.current.step);
  const [data, setData] = useState(initialRef.current.data);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // v8 — @-멘션 후보 풀 (시트 4슬롯 + 장소 N개). 마운트 시 병렬 fetch.
  // v9.1 — 자식 패널(시트/장소) 변경 시 reloadMentionOptions 콜백으로 자동 갱신.
  const [mentionOptions, setMentionOptions] = useState([]);
  // v31 — 기존에 저장된 시트 slot 집합 (CharacterSheetPanel 에 prop 으로 전달
  // 해서 "기존 시트 덮어쓰기 다이얼로그" 분기에 사용).
  const [savedSheetSlots, setSavedSheetSlots] = useState(() => new Set());
  const reloadMentionOptions = useCallback(async () => {
    try {
      const [sheetsRes, placesRes] = await Promise.all([
        api.getCharacterSheets(),
        api.listPlaces(),
      ]);
      const sheets = sheetsRes?.data?.sheets || {};
      const places = placesRes?.data?.items || [];
      const opts = [];
      const nextSavedSlots = new Set();
      for (const [slotKey, slot] of Object.entries(sheets)) {
        if (!slot) continue;
        if (slot.sheet_object_name) nextSavedSlots.add(slotKey);
        const displayName = (slot.display_name && slot.display_name.trim()) || slotKey;
        opts.push({
          type: 'sheet',
          asset_id: slotKey,
          display_name: displayName,
          object_name: slot.sheet_object_name || null,
          group_label: '🧑 캐릭터',
        });
      }
      setSavedSheetSlots(nextSavedSlots);
      for (const p of places) {
        opts.push({
          type: 'place',
          asset_id: p.place_id,
          display_name: (p.display_name && p.display_name.trim()) || '(이름 없음)',
          object_name: p.object_name || null,
          group_label: '📍 장소',
        });
      }
      setMentionOptions(opts);
      if (import.meta.env.DEV) {
        console.info('[StoryWizard] mention_options loaded', { count: opts.length });
      }
    } catch (err) {
      console.error('[StoryWizard] mention options fetch failed', { err });
      setMentionOptions([]);
    }
  }, []);
  useEffect(() => {
    reloadMentionOptions();
  }, [reloadMentionOptions]);

  // Absorb selectedOutfit from OutfitSelectPage's navigate state.
  // Done in a ref-guarded effect so the same state object is consumed only once.
  const consumedStateRef = useRef(null);
  useEffect(() => {
    const st = location.state;
    if (!st || !st.selectedOutfit) return;
    if (consumedStateRef.current === st) return;
    consumedStateRef.current = st;
    const { selectedOutfit, role, style, category, returnStep } = st;
    const key = `${role}_${style}`;
    if (!SHEET_KEYS.includes(key) || !['top', 'bottom', 'shoes'].includes(category)) {
      console.error('[StoryWizard] invalid outfit selection state', {
        role,
        style,
        category,
      });
    } else {
      if (import.meta.env.DEV) {
        console.info('[StoryWizard] applying selected outfit', {
          key,
          category,
          item_id: selectedOutfit.id,
        });
      }
      setData((d) => ({
        ...d,
        sheets: {
          ...d.sheets,
          [key]: {
            ...d.sheets[key],
            items: { ...d.sheets[key].items, [category]: selectedOutfit },
          },
        },
      }));
    }
    if (returnStep) setStep(returnStep);
    // Clear router state so a back navigation doesn't re-apply.
    try {
      navigate(location.pathname, { replace: true, state: null });
    } catch {
      /* noop */
    }
  }, [location, navigate]);

  // Persist wizard draft on every meaningful change so the outfit round-trip
  // (and accidental refreshes) survive. File objects are stripped.
  useEffect(() => {
    try {
      const payload = {
        step,
        data: { ...data, sheets: sanitizeSheetsForStorage(data.sheets) },
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (err) {
      // sessionStorage may be full or disabled — non-fatal.
      if (import.meta.env.DEV) {
        console.warn('[StoryWizard] draft persist failed', { err });
      }
    }
  }, [data, step]);

  // v35 — GenerationStatus 의 [← 이전 (수정)] 에서 넘긴 resume_job_id 가 있으면
  // wizard state 에 박아 다음 [생성] 클릭이 regenerate 가 되게.
  useEffect(() => {
    const resumeJobId = location.state?.resume_job_id;
    if (resumeJobId && !data.current_job_id) {
      if (import.meta.env.DEV) {
        console.info('[StoryWizard] resume_job_id received', { job_id: resumeJobId });
      }
      setData((d) => ({ ...d, current_job_id: resumeJobId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.resume_job_id]);

  // v33 — 마운트 시 1회: ?new=1 이면 backend draft 도 삭제. 그 외엔
  // sessionStorage 비어있을 때만 backend draft fetch → 복원.
  const backendDraftLoadedRef = useRef(false);
  useEffect(() => {
    if (backendDraftLoadedRef.current) return;
    backendDraftLoadedRef.current = true;
    (async () => {
      if (isNewMode) {
        // 새 작품 = 옛 jobId 흔적도 함께 제거. backend draft + wizard state 양쪽.
        setData((d) => ({ ...d, current_job_id: null }));
        try {
          if (import.meta.env.DEV) console.info('[StoryWizard] new=1 — deleting backend draft');
          await api.deleteMyDraft();
        } catch (err) {
          // 없으면 200 이므로 사실상 실패할 일 적음. 로그만.
          console.error('[StoryWizard] deleteMyDraft failed', { err });
        }
        return;
      }
      // sessionStorage 가 비어있을 때만 backend draft 시도 (outfit round-trip 보호)
      let hasSession = false;
      try { hasSession = !!sessionStorage.getItem(DRAFT_KEY); } catch { /* noop */ }
      if (hasSession) return;
      try {
        if (import.meta.env.DEV) console.info('[StoryWizard] calling getMyDraft');
        const { data: res } = await api.getMyDraft();
        const draft = res?.draft;
        if (draft && draft.payload && typeof draft.payload === 'object') {
          const base = initialData();
          const p = draft.payload;
          const merged = {
            ...base, ...p,
            sheets: mergeSheets(p.sheets),
          };
          const validatedDraftStep =
            typeof draft.step === 'number' && draft.step >= 1 && draft.step <= 6
              ? draft.step : 1;
          // v37 — race condition 가드: 응답이 늦게 도착했을 때 사용자가 이미
          // 진행/입력했으면 덮어쓰지 않음. step > 1 또는 data 에 의미있는 입력
          // 있으면 stale draft 응답을 무시.
          setStep((cur) => {
            if (cur > 1) {
              if (import.meta.env.DEV) {
                console.info('[StoryWizard] backend draft skipped (user advanced step)', {
                  cur_step: cur, draft_step: validatedDraftStep,
                });
              }
              return cur;
            }
            return validatedDraftStep;
          });
          setData((cur) => {
            const hasUserInput = (() => {
              const sheets = cur?.sheets || {};
              if (Object.values(sheets).some((s) => s && s.face_object_name)) return true;
              const couple = cur?.couple || {};
              if ((couple.partner_a?.name || '').trim()) return true;
              if ((couple.partner_b?.name || '').trim()) return true;
              if ((cur?.story?.meeting || '').trim()) return true;
              if (cur?.current_job_id) return true;
              return false;
            })();
            if (hasUserInput) {
              if (import.meta.env.DEV) {
                console.info('[StoryWizard] backend draft skipped (user input present)');
              }
              return cur;
            }
            return merged;
          });
          if (import.meta.env.DEV) {
            console.info('[StoryWizard] backend draft loaded (or guarded)', {
              draft_step: draft.step,
            });
          }
        }
      } catch (err) {
        console.error('[StoryWizard] getMyDraft failed', { err });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v33 — debounced backend save (1.5s). data/step 변경 시 백엔드에 upsert.
  const backendSaveTimerRef = useRef(null);
  useEffect(() => {
    if (backendSaveTimerRef.current) clearTimeout(backendSaveTimerRef.current);
    backendSaveTimerRef.current = setTimeout(async () => {
      try {
        const payload = { ...data, sheets: sanitizeSheetsForStorage(data.sheets) };
        const title =
          (data.couple?.groom_name || data.couple?.bride_name)
            ? `${data.couple?.groom_name || ''} & ${data.couple?.bride_name || ''}`.trim().replace(/^&\s*|\s*&$/g, '')
            : null;
        await api.saveMyDraft({ payload, step, title });
        if (import.meta.env.DEV) console.info('[StoryWizard] backend draft saved', { step });
      } catch (err) {
        console.error('[StoryWizard] saveMyDraft failed', { err });
      }
    }, 1500);
    return () => {
      if (backendSaveTimerRef.current) clearTimeout(backendSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, step]);

  // Navigate to outfit selection page, preserving wizard state in sessionStorage.
  const goSelectOutfit = (role, style, category) => {
    if (import.meta.env.DEV) {
      console.info('[StoryWizard] navigating to outfit select', {
        role,
        style,
        category,
      });
    }
    try {
      const payload = {
        step,
        data: { ...data, sheets: sanitizeSheetsForStorage(data.sheets) },
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error('[StoryWizard] failed to persist draft before navigate', { err });
    }
    navigate(`/outfits/${role}/${style}/${category}`);
  };

  // Patch a single sheet slot (panel onChange).
  const patchSheet = (key, patch) => {
    setData((d) => ({
      ...d,
      sheets: { ...d.sheets, [key]: { ...d.sheets[key], ...patch } },
    }));
  };

  const canNext = useMemo(() => {
    if (step === 1) {
      return (
        data.couple.partner_a.name.trim() !== '' &&
        data.couple.partner_b.name.trim() !== ''
      );
    }
    if (step === 2) {
      return data.story.meeting.trim() !== '';
    }
    if (step === 3) {
      return data.vow.keywords.length >= 1;
    }
    if (step === 4) return true;
    if (step === 5) return true;
    return true;
  }, [step, data]);

  const goNext = () => {
    if (!canNext) return;
    setStep((s) => Math.min(6, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(1, s - 1));
  const jumpTo = (n) => setStep(n);

  // --- update helpers ---
  const updateCouple = (patch) =>
    setData((d) => ({ ...d, couple: { ...d.couple, ...patch } }));
  const updatePartner = (which, patch) =>
    setData((d) => ({
      ...d,
      couple: {
        ...d.couple,
        [which]: { ...d.couple[which], ...patch },
      },
    }));
  const updateStory = (patch) =>
    setData((d) => ({ ...d, story: { ...d.story, ...patch } }));
  const updateVow = (patch) =>
    setData((d) => ({ ...d, vow: { ...d.vow, ...patch } }));
  const updateWedding = (patch) =>
    setData((d) => ({ ...d, wedding_context: { ...d.wedding_context, ...patch } }));
  const updateMusic = (patch) =>
    setData((d) => ({ ...d, music_spec: { ...d.music_spec, ...patch } }));

  const toggleMood = (m) => {
    setData((d) => {
      const exists = d.music_spec.moods.includes(m);
      const next = exists
        ? d.music_spec.moods.filter((x) => x !== m)
        : [...d.music_spec.moods, m];
      return { ...d, music_spec: { ...d.music_spec, moods: next } };
    });
  };

  // --- final submit ---
  const buildPayloads = () => {
    // v8 — memories 본문 trim 시 빈 항목 제거. 같은 인덱스의 refs 도 함께 제거.
    const cleanedMemories = [];
    const cleanedMemoriesRefs = [];
    (data.story.memories || []).forEach((s, i) => {
      const t = (s || '').trim();
      if (t) {
        cleanedMemories.push(t);
        cleanedMemoriesRefs.push(
          Array.isArray(data.story.memories_refs?.[i]) ? data.story.memories_refs[i] : []
        );
      }
    });

    const parseAge = (raw) => {
      const v = String(raw).trim();
      if (v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const trimOrNull = (s) => {
      const v = (s || '').trim();
      return v === '' ? null : v;
    };

    const safeRefs = (arr) => (Array.isArray(arr) ? arr : []);

    const storyPayload = {
      couple: {
        partner_a: {
          name: data.couple.partner_a.name.trim(),
          age: parseAge(data.couple.partner_a.age),
        },
        partner_b: {
          name: data.couple.partner_b.name.trim(),
          age: parseAge(data.couple.partner_b.age),
        },
      },
      story: {
        meeting: data.story.meeting.trim(),
        meeting_refs: safeRefs(data.story.meeting_refs),
        first_date: trimOrNull(data.story.first_date),
        first_date_refs: safeRefs(data.story.first_date_refs),
        memories: cleanedMemories,
        memories_refs: cleanedMemoriesRefs,
        proposal: trimOrNull(data.story.proposal),
        proposal_refs: safeRefs(data.story.proposal_refs),
        wedding_prep: trimOrNull(data.story.wedding_prep),
        wedding_prep_refs: safeRefs(data.story.wedding_prep_refs),
        rituals: trimOrNull(data.story.rituals),
        rituals_refs: safeRefs(data.story.rituals_refs),
      },
      vow: {
        keywords: data.vow.keywords,
        line: trimOrNull(data.vow.line),
      },
      wedding_context: {
        tone: data.wedding_context.tone,
        audience_line: trimOrNull(data.wedding_context.audience_line),
      },
    };

    if (import.meta.env.DEV) {
      const totalMentions =
        storyPayload.story.meeting_refs.length +
        storyPayload.story.first_date_refs.length +
        storyPayload.story.memories_refs.reduce((acc, arr) => acc + arr.length, 0) +
        storyPayload.story.proposal_refs.length +
        storyPayload.story.wedding_prep_refs.length +
        storyPayload.story.rituals_refs.length;
      console.info('[StoryWizard] story payload built', { total_mentions: totalMentions });
    }

    const isDuet = data.music_spec.vocal_form === 'duet';
    const musicSpec = {
      genre: data.music_spec.genre,
      moods: data.music_spec.moods,
      duration_minutes: data.music_spec.duration_minutes,
      vocal_form: data.music_spec.vocal_form,
      vocal_styles: isDuet ? data.music_spec.vocal_styles : null,
      language: data.music_spec.language,
      model: data.music_spec.model,
    };

    return { storyPayload, musicSpec };
  };

  const onGenerate = async () => {
    setError('');
    setSubmitting(true);
    try {
      const { storyPayload, musicSpec } = buildPayloads();
      const { data: storyRes } = await api.createStory(storyPayload);
      const storyId = storyRes.story_id;
      // v35 — 작품 1건 정책: 진행 중 job_id 있으면 같은 job 에 regenerate (lyrics/music 갈아엎기),
      // 없으면 새 job 생성. 둘 다 응답에 {job_id, status} 포함.
      let resolvedJobId = data.current_job_id || null;

      // 신규 잡 생성 헬퍼 (stale 복구 fallback에서도 재사용)
      const createFreshJob = async () => {
        if (import.meta.env.DEV) {
          console.info('[StoryWizard] createMVJob (fresh)');
        }
        const { data: jobRes } = await api.createMVJob({
          story_id: storyId,
          music_spec: musicSpec,
        });
        const newId = jobRes.job_id;
        setData((d) => ({ ...d, current_job_id: newId }));
        return newId;
      };

      if (resolvedJobId) {
        if (import.meta.env.DEV) {
          console.info('[StoryWizard] regenerateMVJob', { job_id: resolvedJobId });
        }
        try {
          await api.regenerateMVJob(resolvedJobId, {
            story_id: storyId,
            music_spec: musicSpec,
          });
        } catch (err) {
          // v36 stale-fallback — draft에 박힌 jobId가 백엔드 DB에 없거나(404)
          // 다른 사용자 소유로 바뀐 경우(403) → 새 잡으로 자동 복구.
          // 운영 환경 reset/마이그레이션 시 사용자가 "잡을 찾을 수 없습니다" 에러를 보지 않도록.
          const status = err?.response?.status;
          if (status === 404 || status === 403) {
            console.warn('[StoryWizard] regenerate stale (status=' + status + '), fallback to createMVJob', { job_id: resolvedJobId });
            resolvedJobId = await createFreshJob();
          } else {
            throw err;
          }
        }
      } else {
        if (import.meta.env.DEV) {
          console.info('[StoryWizard] createMVJob (first)');
        }
        resolvedJobId = await createFreshJob();
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* noop */
      }
      // v33 — 잡 생성 완료 → backend draft 도 삭제 (best-effort)
      try { await api.deleteMyDraft(); } catch (err) {
        console.error('[StoryWizard] deleteMyDraft after job create failed', { err });
      }
      navigate(`/projects/${resolvedJobId}`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : '가사 생성 시작에 실패했습니다. 잠시 후 다시 시도해주세요.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // --- step renderers ---
  const renderStep1 = () => (
    <div className="wiz-step">
      <h2 className="wiz-step__title">두 사람</h2>
      <p className="wiz-step__desc muted">
        먼저 신랑·신부의 기본 정보를 알려주세요.
      </p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="a_name">
            신랑 이름 <span className="req">*</span>
          </label>
          <input
            id="a_name"
            type="text"
            value={data.couple.partner_a.name}
            onChange={(e) => updatePartner('partner_a', { name: e.target.value })}
            placeholder="예) 김민호"
          />
        </div>
        <div className="field">
          <label htmlFor="a_age">
            신랑 나이 <span className="opt">(선택)</span>
          </label>
          <input
            id="a_age"
            type="number"
            min="0"
            value={data.couple.partner_a.age}
            onChange={(e) => updatePartner('partner_a', { age: e.target.value })}
            placeholder="31"
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="b_name">
            신부 이름 <span className="req">*</span>
          </label>
          <input
            id="b_name"
            type="text"
            value={data.couple.partner_b.name}
            onChange={(e) => updatePartner('partner_b', { name: e.target.value })}
            placeholder="예) 이지영"
          />
        </div>
        <div className="field">
          <label htmlFor="b_age">
            신부 나이 <span className="opt">(선택)</span>
          </label>
          <input
            id="b_age"
            type="number"
            min="0"
            value={data.couple.partner_b.age}
            onChange={(e) => updatePartner('partner_b', { age: e.target.value })}
            placeholder="29"
          />
        </div>
      </div>

      <div className="sheets-block">
        <div className="sheets-block__head">
          <h3 className="sheets-block__title">캐릭터 시트 <span className="opt">(선택)</span></h3>
          <p className="sheets-block__desc muted">
            신랑·신부의 평상복과 웨딩 촬영복 시트를 만들 수 있어요. 비워두고 다음 단계로 넘어가도 됩니다.
          </p>
        </div>
        <div className="sheets-block__grid">
          {SHEET_PANELS.map(({ key, role, style, title }) => (
            <CharacterSheetPanel
              key={key}
              role={role}
              style={style}
              title={title}
              value={data.sheets[key]}
              onChange={(patch) => patchSheet(key, patch)}
              onNavigateOutfit={(cat) => goSelectOutfit(role, style, cat)}
              onMentionablesChanged={reloadMentionOptions}
              hasExistingSaved={savedSheetSlots.has(key)}
            />
          ))}
        </div>
      </div>

      {/* v7 — 장소 이미지 자산 (캐릭터 시트 4슬롯 바로 아래 자매 섹션) */}
      <PlaceAssetPanel onMentionablesChanged={reloadMentionOptions} />
    </div>
  );

  const renderStep2 = () => (
    <div className="wiz-step">
      <h2 className="wiz-step__title">우리의 시간</h2>
      <p className="wiz-step__desc muted">
        두 분만 아는 장면들을 적어주세요. 가사가 일반론으로 빠지지 않게 도와줍니다.
      </p>

      <SceneInput
        label="첫 만남"
        required
        value={data.story.meeting}
        onChange={(v) => updateStory({ meeting: v })}
        refs={data.story.meeting_refs}
        onChangeRefs={(r) => updateStory({ meeting_refs: r })}
        options={mentionOptions}
        placeholder="예) 4월 비 오던 회식 끝난 야근, 회의실 옆자리에 앉아 있던 그 사람과 모니터 너머로 눈이 마주쳤어요. 그 순간 숨이 한 번 막혔고, 키보드 소리도 안 들릴 만큼 가슴이 뛰었어요."
        hint="그때의 상황과 마음을 함께 줄줄 적어주세요. @를 입력하면 미리 만든 캐릭터·장소를 태그할 수 있어요."
      />

      <SceneInput
        label="첫 데이트"
        optional
        value={data.story.first_date}
        onChange={(v) => updateStory({ first_date: v })}
        refs={data.story.first_date_refs}
        onChangeRefs={(r) => updateStory({ first_date_refs: r })}
        options={mentionOptions}
        placeholder="예) 다음 주 토요일 한강 망원 벤치에서 만났어요. 그 사람이 캔커피 두 개를 들고 왔는데, 햇살이 세서 손으로 눈을 가렸어요. 그 손그늘이 어찌나 예뻐 보이던지, 자꾸 곁눈질하다 들킬까 고개 돌렸어요."
      />

      <div className="field">
        <label>
          함께 쌓인 추억 <span className="opt">(선택, 한 칸에 한 장면씩)</span>
        </label>
        <DynamicList
          items={data.story.memories}
          refsList={data.story.memories_refs}
          onChange={(next) => {
            // 본문 길이 변화에 맞춰 refs 도 동기화.
            setData((d) => {
              const safeItems = next.length === 0 ? [''] : next;
              const len = safeItems.length;
              const prevRefs = Array.isArray(d.story.memories_refs)
                ? d.story.memories_refs
                : [];
              const safeRefs = [];
              for (let i = 0; i < len; i++) {
                safeRefs.push(Array.isArray(prevRefs[i]) ? prevRefs[i] : []);
              }
              return {
                ...d,
                story: {
                  ...d.story,
                  memories: safeItems,
                  memories_refs: safeRefs,
                },
              };
            });
          }}
          onChangeRefs={(idx, refs) => {
            setData((d) => {
              const prev = Array.isArray(d.story.memories_refs)
                ? d.story.memories_refs
                : [];
              const nextRefs = prev.slice();
              nextRefs[idx] = refs;
              return {
                ...d,
                story: { ...d.story, memories_refs: nextRefs },
              };
            });
          }}
          options={mentionOptions}
          placeholder="예) 매주 토요일 같은 벤치에서 노래 한 곡씩 같이 들었어요. 너의 어깨에 자연스럽게 기대게 됐고, 너 없는 토요일을 상상할 수 없게 됐어요."
          addButtonLabel="+ 추억 더 추가"
        />
      </div>

      <SceneInput
        label="결혼을 결심한 순간"
        optional
        value={data.story.proposal}
        onChange={(v) => updateStory({ proposal: v })}
        refs={data.story.proposal_refs}
        onChangeRefs={(r) => updateStory({ proposal_refs: r })}
        options={mentionOptions}
        placeholder="예) 부암동 그 카페 창가 자리에서, 두 잔의 커피 위에 그 사람의 손이 포개졌을 때 '같이 살자'고 자연스럽게 말이 나왔어요. 그 한 마디에 눈물이 핑 돌았는데, 떨리지 않을 만큼 이미 단단해져 있었구나 싶었어요."
      />

      <SceneInput
        label="웨딩 준비 (드레스 / 촬영)"
        optional
        value={data.story.wedding_prep}
        onChange={(v) => updateStory({ wedding_prep: v })}
        refs={data.story.wedding_prep_refs}
        onChangeRefs={(r) => updateStory({ wedding_prep_refs: r })}
        options={mentionOptions}
        placeholder="예) 어느 토요일 드레스를 입어 봤어요. 거울 너머의 모습이 어색하면서도 '이게 우리구나' 실감이 났어요. 그 다음 주말엔 야외 웨딩 촬영을 했고, 카메라 셔터 앞에서 둘이 같이 웃었어요."
      />

      <div className="field">
        <label htmlFor="rituals">
          둘만의 단어 · 농담 · 장소 <span className="opt">(선택)</span>
          <PolishButton
            value={data.story.rituals}
            refs={data.story.rituals_refs}
            onChange={(v) => updateStory({ rituals: v })}
            onChangeRefs={(r) => updateStory({ rituals_refs: r })}
            label="둘만의 단어 · 농담 · 장소"
          />
        </label>
        <MentionField
          id="rituals"
          ariaLabel="둘만의 단어 농담 장소"
          value={data.story.rituals}
          refs={data.story.rituals_refs}
          onChange={(v) => updateStory({ rituals: v })}
          onChangeRefs={(r) => updateStory({ rituals_refs: r })}
          options={mentionOptions}
          rows={3}
          placeholder='예) "오징어볶음"이 우리 사이의 사과 신호. 부암동 그 카페가 우리만의 비밀 장소.'
        />
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="wiz-step">
      <h2 className="wiz-step__title">약속</h2>
      <p className="wiz-step__desc muted">
        후렴(Chorus)에 박힐 핵심 메시지입니다. 키워드 3~5개를 권장해요.
      </p>

      <div className="field">
        <label>
          서약 키워드 <span className="req">*</span>
        </label>
        <TagInput
          tags={data.vow.keywords}
          onChange={(next) => updateVow({ keywords: next })}
          placeholder="Enter로 추가  예) 함께 나이 들기, 약한 날 먼저 손잡기, 매년 같은 자리로"
          hint="Enter 또는 콤마(,)로 칩 추가 · 칩 옆 ✕로 제거"
        />
      </div>

      <div className="field">
        <label htmlFor="vow_line">
          자유 서약 한 줄 <span className="opt">(선택)</span>
        </label>
        <textarea
          id="vow_line"
          value={data.vow.line}
          onChange={(e) => updateVow({ line: e.target.value })}
          placeholder='예) "지영아, 평생 너의 가장 가까운 친구로 살게."'
        />
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="wiz-step">
      <h2 className="wiz-step__title">결혼식 맥락</h2>
      <p className="wiz-step__desc muted">
        식 분위기와 하객에게 전하고 싶은 톤을 알려주세요.
      </p>

      <div className="field">
        <label>식 분위기</label>
        <div className="radio-grid">
          {TONE_OPTIONS.map((t) => (
            <label key={t} className="radio-card">
              <input
                type="radio"
                name="tone"
                value={t}
                checked={data.wedding_context.tone === t}
                onChange={() => updateWedding({ tone: t })}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="audience_line">
          하객에게 전하고 싶은 한 줄 <span className="opt">(선택)</span>
        </label>
        <textarea
          id="audience_line"
          value={data.wedding_context.audience_line}
          onChange={(e) => updateWedding({ audience_line: e.target.value })}
          placeholder="예) 우리 둘이 여기까지 온 이야기, 들어주셔서 감사합니다."
        />
      </div>
    </div>
  );

  const renderStep5 = () => {
    const isDuet = data.music_spec.vocal_form === 'duet';
    return (
      <div className="wiz-step">
        <h2 className="wiz-step__title">음악 사양</h2>
        <p className="wiz-step__desc muted">
          가사·음악의 기본 골격이 됩니다.
        </p>

        <div className="field">
          <label>장르</label>
          <div className="radio-grid">
            {GENRE_OPTIONS.map((g) => (
              <label key={g} className="radio-card">
                <input
                  type="radio"
                  name="genre"
                  value={g}
                  checked={data.music_spec.genre === g}
                  onChange={() => updateMusic({ genre: g })}
                />
                <span>{g}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>분위기 <span className="opt">(복수 선택)</span></label>
          <div className="radio-grid">
            {MOOD_OPTIONS.map((m) => (
              <label key={m} className="radio-card">
                <input
                  type="checkbox"
                  checked={data.music_spec.moods.includes(m)}
                  onChange={() => toggleMood(m)}
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>길이</label>
          <label className="radio-row radio-card duration-row">
            <input
              type="radio"
              name="duration"
              checked={data.music_spec.duration_minutes === 2}
              onChange={() => updateMusic({ duration_minutes: 2 })}
            />
            <span>2분 가사</span>
            <span className="opt"> 약 700자 / Verse 2~3개 + Chorus</span>
          </label>
          <label className="radio-row radio-card duration-row">
            <input
              type="radio"
              name="duration"
              checked={data.music_spec.duration_minutes === 3}
              onChange={() => updateMusic({ duration_minutes: 3 })}
            />
            <span>3분 가사</span>
            <span className="opt"> 약 1200자 / 풀 8섹션 (Verse 3개·Bridge·Chorus 2회)</span>
          </label>
        </div>

        <div className="field">
          <label>보컬 형태</label>
          <div className="radio-row">
            <label className="radio-card">
              <input
                type="radio"
                name="vocal_form"
                value="solo"
                checked={data.music_spec.vocal_form === 'solo'}
                onChange={() => updateMusic({ vocal_form: 'solo' })}
              />
              <span>솔로</span>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="vocal_form"
                value="duet"
                checked={data.music_spec.vocal_form === 'duet'}
                onChange={() => updateMusic({ vocal_form: 'duet' })}
              />
              <span>듀엣</span>
            </label>
          </div>
        </div>

        {isDuet && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="vocal_main">메인 보컬 스타일</label>
              <select
                id="vocal_main"
                value={data.music_spec.vocal_styles.main}
                onChange={(e) =>
                  updateMusic({
                    vocal_styles: {
                      ...data.music_spec.vocal_styles,
                      main: e.target.value,
                    },
                  })
                }
              >
                {VOCAL_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="vocal_sub">서브 보컬 스타일</label>
              <select
                id="vocal_sub"
                value={data.music_spec.vocal_styles.sub}
                onChange={(e) =>
                  updateMusic({
                    vocal_styles: {
                      ...data.music_spec.vocal_styles,
                      sub: e.target.value,
                    },
                  })
                }
              >
                {VOCAL_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="field">
          <label>언어</label>
          <div className="radio-row">
            {[
              { value: 'ko', label: '한국어' },
              { value: 'ko_en_73', label: '한 7 : 영 3' },
              { value: 'ko_en_55', label: '한 5 : 영 5' },
              { value: 'ko_en_37', label: '한 3 : 영 7' },
              { value: 'en', label: 'English' },
            ].map((opt) => (
              <label key={opt.value} className="radio-card">
                <input
                  type="radio"
                  name="language"
                  value={opt.value}
                  checked={data.music_spec.language === opt.value}
                  onChange={() => updateMusic({ language: opt.value })}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>
            모델 <span className="opt">(선택)</span>
          </label>
          <div className="radio-row">
            {MODEL_OPTIONS.map((opt) => (
              <label key={String(opt.value)} className="radio-card">
                <input
                  type="radio"
                  name="model"
                  checked={data.music_spec.model === opt.value}
                  onChange={() => updateMusic({ model: opt.value })}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderReview = () => {
    const m = data.music_spec;
    const vocalFormLabel = m.vocal_form === 'duet' ? '듀엣' : '솔로';
    const mainLabel =
      VOCAL_STYLE_OPTIONS.find((o) => o.value === m.vocal_styles.main)?.label || m.vocal_styles.main;
    const subLabel =
      VOCAL_STYLE_OPTIONS.find((o) => o.value === m.vocal_styles.sub)?.label || m.vocal_styles.sub;
    const modelLabel = MODEL_OPTIONS.find((o) => o.value === m.model)?.label || '서버 기본';

    const oneLine = (s, max = 80) => {
      const v = (s || '').trim().replace(/\s+/g, ' ');
      if (v === '') return '';
      return v.length > max ? v.slice(0, max) + '…' : v;
    };

    const firstDateSummary = oneLine(data.story.first_date);
    const proposalSummary = oneLine(data.story.proposal);
    const weddingPrepSummary = oneLine(data.story.wedding_prep);
    const meetingSummary = oneLine(data.story.meeting);

    const memoriesFiltered = data.story.memories.filter((s) => s.trim());

    return (
      <div className="wiz-step">
        <h2 className="wiz-step__title">검토 & 생성</h2>
        <p className="wiz-step__desc muted">
          입력한 내용을 확인하고 가사 생성을 시작해주세요.
        </p>

        <div className="review-card">
          <div className="review-card__head">
            <h3>두 사람</h3>
            <button type="button" className="review-edit" onClick={() => jumpTo(1)}>
              편집
            </button>
          </div>
          <dl className="review-dl">
            <dt>신랑</dt>
            <dd>
              {data.couple.partner_a.name || '—'}
              {data.couple.partner_a.age && ` (${data.couple.partner_a.age})`}
            </dd>
            <dt>신부</dt>
            <dd>
              {data.couple.partner_b.name || '—'}
              {data.couple.partner_b.age && ` (${data.couple.partner_b.age})`}
            </dd>
          </dl>
        </div>

        <div className="review-card">
          <div className="review-card__head">
            <h3>우리의 시간</h3>
            <button type="button" className="review-edit" onClick={() => jumpTo(2)}>
              편집
            </button>
          </div>
          <dl className="review-dl">
            <dt>첫 만남</dt>
            <dd className="pre-wrap">{meetingSummary || '—'}</dd>

            {firstDateSummary && (
              <>
                <dt>첫 데이트</dt>
                <dd className="pre-wrap">{firstDateSummary}</dd>
              </>
            )}

            {memoriesFiltered.length > 0 && (
              <>
                <dt>추억</dt>
                <dd>
                  <ul className="review-list">
                    {memoriesFiltered.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}

            {proposalSummary && (
              <>
                <dt>결혼 결심</dt>
                <dd className="pre-wrap">{proposalSummary}</dd>
              </>
            )}

            {weddingPrepSummary && (
              <>
                <dt>웨딩 준비</dt>
                <dd className="pre-wrap">{weddingPrepSummary}</dd>
              </>
            )}

            {data.story.rituals.trim() && (
              <>
                <dt>둘만의 단어</dt>
                <dd className="pre-wrap">{data.story.rituals}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="review-card">
          <div className="review-card__head">
            <h3>약속</h3>
            <button type="button" className="review-edit" onClick={() => jumpTo(3)}>
              편집
            </button>
          </div>
          <dl className="review-dl">
            <dt>서약 키워드</dt>
            <dd>
              {data.vow.keywords.length === 0 ? (
                '—'
              ) : (
                <div className="review-chips">
                  {data.vow.keywords.map((k) => (
                    <span key={k} className="review-chip">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </dd>
            <dt>자유 서약</dt>
            <dd className="pre-wrap">{data.vow.line || '—'}</dd>
          </dl>
        </div>

        <div className="review-card">
          <div className="review-card__head">
            <h3>결혼식 맥락</h3>
            <button type="button" className="review-edit" onClick={() => jumpTo(4)}>
              편집
            </button>
          </div>
          <dl className="review-dl">
            <dt>분위기</dt>
            <dd>{data.wedding_context.tone}</dd>
            <dt>하객 멘트</dt>
            <dd className="pre-wrap">{data.wedding_context.audience_line || '—'}</dd>
          </dl>
        </div>

        <div className="review-card">
          <div className="review-card__head">
            <h3>음악 사양</h3>
            <button type="button" className="review-edit" onClick={() => jumpTo(5)}>
              편집
            </button>
          </div>
          <dl className="review-dl">
            <dt>장르</dt>
            <dd>{m.genre}</dd>
            <dt>분위기</dt>
            <dd>{m.moods.length ? m.moods.join(', ') : '—'}</dd>
            <dt>길이</dt>
            <dd>{m.duration_minutes}분</dd>
            <dt>보컬</dt>
            <dd>
              {vocalFormLabel}
              {m.vocal_form === 'duet' && ` · 메인 ${mainLabel} / 서브 ${subLabel}`}
            </dd>
            <dt>언어</dt>
            <dd>
              {{
                ko: '한국어',
                ko_en_73: '한 7 : 영 3',
                ko_en_55: '한 5 : 영 5',
                ko_en_37: '한 3 : 영 7',
                en: 'English',
              }[m.language] || m.language}
            </dd>
            <dt>모델</dt>
            <dd>{modelLabel}</dd>
          </dl>
        </div>
      </div>
    );
  };

  const renderCurrent = () => {
    if (step === 1) return renderStep1();
    if (step === 2) return renderStep2();
    if (step === 3) return renderStep3();
    if (step === 4) return renderStep4();
    if (step === 5) return renderStep5();
    return renderReview();
  };

  return (
    <section className="wizard">
      <h1 className="wizard__title">두 사람의 이야기</h1>
      <p className="muted">
        다섯 단계로 짧게 답해주세요. 마지막에 검토 후 가사 생성을 시작합니다.
      </p>

      <StepIndicator steps={STEPS} current={Math.min(step, 5)} />

      {error && (
        <div className="wizard__error" role="alert">
          {error}
        </div>
      )}

      <div className="card wizard__card">{renderCurrent()}</div>

      <div className="wizard__nav">
        <button
          type="button"
          className="btn-ghost"
          onClick={goPrev}
          disabled={step === 1 || submitting}
        >
          ← 이전
        </button>

        {step < 5 && (
          <button
            type="button"
            className="btn-primary"
            onClick={goNext}
            disabled={!canNext}
          >
            다음 →
          </button>
        )}
        {step === 5 && (
          <button
            type="button"
            className="btn-primary"
            onClick={goNext}
            disabled={!canNext}
          >
            검토 →
          </button>
        )}
        {step === 6 && (
          <button
            type="button"
            className="btn-primary"
            onClick={onGenerate}
            disabled={submitting}
          >
            {submitting ? '처리 중...' : '가사 생성 시작'}
          </button>
        )}
      </div>
    </section>
  );
}
