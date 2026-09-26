import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CharacterTaskMode = 'sheet' | 'refine' | 'outfit';

// ── v3.219 [ArtistDraft]: 아티스트 생성 대화 draft — ArtistInputScreen 로컬 state 미러링.
// 이탈·재진입 시 Q&A 진행분을 복원한다(기존 v3.105 '이어서 만들기'는 의상 단계 재개 —
// draft는 그보다 앞 단계인 Q&A 도중을 커버). 생성 성공 저장(reset())·'처음부터'에만 지운다.
// photoUri 등 파일 URI는 draft에 넣지 않는다(앱 재시작 후 파일 소멸 — F3(d)). 전 필드가
// 텍스트/enum이라 draft 통째로 AsyncStorage 영속(2026-09-07 텍스트 입력물 보존 정책). ──
// v3.227 H-1 [ArtistDraft]: 사진 사용 의도 — 'photo'=얼굴 사진을 올려 만들기, 'text'=사진 없이
// 설명으로 만들기(명시 선택), null=아직 고르지 않음. URI는 영속하지 않지만 의도는 영속해서,
// 복원 시 의도='photo'인데 사진 파일이 없으면 사진 단계로 되돌린다(사진 없는 조용한 진행·과금 차단).
export type ArtistPhotoIntent = 'photo' | 'text' | null;

export interface ArtistDraftChatMessage {
  type: 'director' | 'user';
  text: string;
  /** v3.231 [ArtistAnswerEdit]: 이 user 버블이 답한 질문 키(StyleAnswers 키 — 편집 대상 식별).
   *  v3.230 이전 초안에는 없음 → 복원 시 직전 디렉터 질문 문구로 추론(utils/artistAnswerEdit) */
  qKey?: string;
}

export interface ArtistDraft {
  /** v3.231 A2: 'review' = 실사 최종 확인 단계(마지막 답 뒤 [의상 고르러 가기]) — 구 초안에는 없음 */
  step: 'welcome' | 'questioning' | 'style' | 'review';
  chat: ArtistDraftChatMessage[];
  qIndex: number;
  styleAnswers: Record<string, string>;
  currentInput: string;
  selectedKind: 'real' | 'virtual' | null;
  pendingConceptText: string;
  /** 키 검증용 — 재생성 진입(targetCharacterId)·forceKind가 draft와 다르면 폐기(오염 방지) */
  targetCharacterId: string | null;
  forceKind: 'real' | 'virtual' | null;
  /** v3.227 H-1: 사진 사용 의도(영속). v3.219 구 draft에는 없음(undefined) — 복원 시 chat에서 추론 */
  photoIntent?: ArtistPhotoIntent;
  /** v3.227 H-1(W1): [이전 사진 사용]으로 고른 서버 원본 경로(텍스트 — 영속 가능). 있으면 사진 재업로드 불요 */
  reuseOriginalObjectName?: string | null;
  /** v3.234 [ArtistDraft]: 마지막 기록 시각(setDraft가 자동 부여). v3.233 이전 초안에는 없음 */
  updatedAt?: number;
  /** v3.234 [ArtistDraft]: 이 대화로 접수(POST 202)된 생성 job — 그 job이 성공 저장되면 draft는 완료본.
   *  대화를 다시 이어가면(ArtistInput 미러링) 새 객체로 덮여 연결이 풀린다(= 재시도 대화) */
  submittedJobId?: string | null;
  submittedAt?: number | null;
}

export interface CharacterTaskResult {
  preview_url: string;       // 절대 URL (BACKEND_BASE_URL 포함)
  object_name: string;
}

interface CharacterTaskState {
  /** 현재 진행 중인 작업 종류. null이면 진행 없음 */
  mode: CharacterTaskMode | null;
  /** 백엔드 응답 도착 여부 */
  apiResult: CharacterTaskResult | null;
  apiError: string | null;
  /** 입력 컨텍스트 (작업이 끝나도 ArtistResult에서 다시 미세조정/옷입히기 시 재사용) */
  photoUri: string | null;
  photoName: string | null;
  /** 모드별 입력 텍스트 — ArtistLoading이 store에서 읽어 API 호출 (params 대신) */
  userText: string | null;       // sheet 모드: 캐릭터 컨셉 텍스트
  /** v3.105: 옷 desc가 합쳐지기 전의 순수 컨셉 텍스트 — 취소/실패 후 "이어서 만들기" 복원용.
   *  ArtistCody가 userText를 컨셉+의상으로 덮어쓰므로 원본은 여기 보존한다 */
  conceptText: string | null;
  refineRequest: string | null;  // refine 모드: 미세조정 요청
  outfitDesc: string | null;     // outfit 모드: 옷 설명
  /** 9004: 백엔드 영구저장된 원본 사진의 MinIO object name. 옷 입히기 시 /preview로 fetch해서 generate-sheet에 첨부 */
  originalPhotoObjectName: string | null;
  /** v3.76(MAIDOL v137): 사진 확약 — 본인 사진이거나 인물 동의를 받았음을 확인. 사진 첨부 시 필수 */
  portraitConfirmed: boolean;
  /** v3.227 H-1: 현재 생성 흐름의 사진 사용 의도 — ArtistLoading 생성 직전 가드가 읽는다(메모리).
   *  영속 원천은 draft.photoIntent(ArtistInput 복원 시 여기로 동기화) */
  photoIntent: ArtistPhotoIntent;
  /** v3.227 H-1(W1): [이전 사진 사용] — 사진 파일 대신 서버에 남은 본인 원본을 생성 Form
   *  `original_object_name`으로 보낸다(서버가 소유권 검증 후 같은 바이트로 얼굴 인증 게이트 수행) */
  reuseOriginalObjectName: string | null;
  /** v3.80: 실사('real') vs 가상화 그림('virtual') 캐릭터 모드 */
  characterKind: 'real' | 'virtual';
  /** v3.80: 가상화 화풍 — 샘플 키(stylePreset) XOR 직접 업로드 이미지(styleImageUri/Name) */
  stylePreset: string | null;
  styleImageUri: string | null;
  styleImageName: string | null;
  /** v3.82: 질문 흐름에서 답한 성별 — 생성 성공 시 artistProfileStore에 슬롯별로 기록 */
  pendingGender: string | null;
  /** v3.109: 질문 흐름에서 지은 아티스트 이름 — 생성 성공 시 save의 name 필드로 서버 영속.
   *  null(스킵)이면 서버 기본 명명 로직 유지 */
  pendingName: string | null;
  /** v3.164: 생성 대화의 나이 답변 — save 시 서버 age로 영속 */
  pendingAge: string | null;
  /** v3.103(B-1): 재생성 대상 character_id — 지정 시 generate/save에 전달(기존 아티스트 갱신),
   *  null이면 신규 생성(서버 슬롯 검사 → used>=max 시 409 slot_limit_exceeded) */
  targetCharacterId: string | null;
  /** v3.103(B-1): 마이그레이션 미실행(레거시) 계정 — /character/list가 비고 slots.used>=1.
   *  true면 구 계약(me/save, character_id·kind 미지정 = 슬롯 면제)으로 생성/저장 */
  legacyContract: boolean;
  /** v3.219 [ArtistDraft]: 생성 대화 진행 draft(null=없음) — 재진입 이어가기 원천 */
  draft: ArtistDraft | null;
  /** v3.234 [ArtistDraft]: 최근 성공 저장된 아티스트 생성(sheet) job id(최신순, 최대 10) — 영속.
   *  draft.submittedJobId가 여기 있으면 "이미 완료된 대화"로 보고 이어가기 대상에서 제외(방어) */
  completedArtistJobIds: string[];

  startTask: (mode: CharacterTaskMode) => void;
  setInput: (data: Partial<Pick<CharacterTaskState, 'photoUri' | 'photoName' | 'userText' | 'conceptText' | 'refineRequest' | 'outfitDesc' | 'originalPhotoObjectName' | 'portraitConfirmed' | 'photoIntent' | 'reuseOriginalObjectName' | 'characterKind' | 'stylePreset' | 'styleImageUri' | 'styleImageName' | 'pendingGender' | 'pendingName' | 'pendingAge' | 'targetCharacterId' | 'legacyContract'>>) => void;
  completeApi: (result: CharacterTaskResult) => void;
  failApi: (msg: string) => void;
  /** 결과 소비 후 (ArtistResult 진입 후) 초기화 */
  clearResult: () => void;
  /** mode만 null로 (자동 저장 후 isUnsaved=false로 만들 때) */
  clearMode: () => void;
  /** v3.219 [ArtistDraft]: 대화 draft 기록/폐기 */
  setDraft: (draft: ArtistDraft | null) => void;
  clearDraft: () => void;
  /** v3.234 [ArtistDraft]: 생성 접수(job_id 수신) 시 현재 draft를 그 job에 연결 */
  markDraftSubmitted: (jobId: string) => void;
  /** 모든 상태 초기화 */
  reset: () => void;
}

// v3.219 [ArtistDraft]: persist 래핑 — draft(전부 텍스트/enum)만 AsyncStorage 영속.
// photoUri·styleImageUri 등 파일 URI 필드는 partialize에서 제외(메모리 보존만).
export const useCharacterTaskStore = create<CharacterTaskState>()(
  persist(
    (set) => ({
  mode: null,
  apiResult: null,
  apiError: null,
  photoUri: null,
  photoName: null,
  userText: null,
  conceptText: null,
  refineRequest: null,
  outfitDesc: null,
  originalPhotoObjectName: null,
  portraitConfirmed: false,
  photoIntent: null,
  reuseOriginalObjectName: null,
  characterKind: 'real',
  stylePreset: null,
  styleImageUri: null,
  styleImageName: null,
  pendingGender: null,
  pendingName: null,
  pendingAge: null,
  targetCharacterId: null,
  legacyContract: false,
  draft: null,
  completedArtistJobIds: [],

  startTask: (mode) =>
    set({
      mode,
      apiError: null,
      // apiResult는 이전 시트 그대로 유지 (refine/outfit의 sheet_image 베이스로 재사용).
      // sheet 모드는 completeApi가 곧 덮어씀
    }),

  setInput: (data) => set((state) => ({ ...state, ...data })),

  completeApi: (result) => set({ apiResult: result, apiError: null }),

  failApi: (msg) => set({ apiError: msg }),

  clearResult: () => set({ apiResult: null, apiError: null, mode: null }),

  clearMode: () => set({ mode: null }),

  // v3.234: 기록 시각 자동 부여 — 기록은 ArtistInput 미러링뿐이라 새 객체에는 submittedJobId가 없다(연결 해제)
  setDraft: (draft) => set({ draft: draft ? { ...draft, updatedAt: Date.now() } : null }),

  clearDraft: () => set({ draft: null }),

  markDraftSubmitted: (jobId) =>
    set((state) => {
      const d = state.draft;
      if (!d || !d.chat.some((m) => m.type === 'user')) return {};
      return { draft: { ...d, submittedJobId: jobId, submittedAt: Date.now() } };
    }),

  reset: () =>
    set({
      mode: null,
      apiResult: null,
      apiError: null,
      photoUri: null,
      photoName: null,
      userText: null,
      conceptText: null,
      refineRequest: null,
      outfitDesc: null,
      originalPhotoObjectName: null,
      portraitConfirmed: false,
      photoIntent: null,
      reuseOriginalObjectName: null,
      characterKind: 'real',
      stylePreset: null,
      styleImageUri: null,
      styleImageName: null,
      pendingGender: null,
      pendingName: null,
      pendingAge: null,
      targetCharacterId: null,
      // v3.219 [ArtistDraft]: 생성 성공 저장(ArtistResult reset 승계)·전체 초기화 시 draft도 청소
      draft: null,
      // legacyContract는 계정 속성(마이그레이션 여부)이라 reset에서 유지 —
      // ArtistInput 진입 시 목록 실측으로 매번 재판정됨
    }),
    }),
    {
      name: 'maidol-artist-draft',
      storage: createJSONStorage(() => AsyncStorage),
      // 텍스트 입력물(draft)만 영속 — 사진/화풍 파일 URI·API 결과 등은 메모리 전용
      // (v3.227 H-1: 사진 사용 의도는 draft.photoIntent로 함께 영속된다)
      // v3.234: 완료 job id 목록도 영속(재시작 후에도 완료 대화 판정 유지)
      partialize: (s) => ({ draft: s.draft, completedArtistJobIds: s.completedArtistJobIds }),
    }
  )
);

/**
 * v3.227 H-1(W1) [2조 전달용]: 이번 생성에 쓸 얼굴 사진 소스가 있는가 —
 * 메모리 사진 파일(photoUri) 또는 [이전 사진 사용] 서버 원본(reuseOriginalObjectName).
 * ArtistCody 사진 배지("얼굴 사진 포함/설명으로 만들기")·【필수 유지】 분기는 photoUri 단독 대신 이 판정을 쓴다.
 */
export function hasArtistPhotoSource(
  s: Pick<CharacterTaskState, 'photoUri' | 'reuseOriginalObjectName'> = useCharacterTaskStore.getState()
): boolean {
  return !!s.photoUri || !!s.reuseOriginalObjectName;
}

// ── v3.234 [ArtistDraft]: 생성 성공 → 대화 draft 정리(공용 완료 지점) ─────────────────
// 대표 제보(9/26): 아티스트를 만들고 나서도 작업실 아티스트 디렉터에 "이어서 하기"가 떠서 휴식 표시를 가렸다.
// 원인: 성공 경로(finalizeArtistJob → ArtistResult justCreated → 자동 저장)는 draft를 지우지 않았다
// (draft 청소는 ArtistResult reset() — 수동 저장·삭제·재생성 — 에만 있었음).

/** 방어 판정: draft가 이미 성공 저장된 생성 job으로 접수된 대화인가(= 완료본, 이어가기 대상 아님) */
export function isArtistDraftCompleted(
  d: ArtistDraft | null | undefined,
  completedIds: string[] = useCharacterTaskStore.getState().completedArtistJobIds
): boolean {
  return !!d && !!d.submittedJobId && (completedIds || []).includes(d.submittedJobId);
}

export interface ArtistJobSuccessInfo {
  jobId: string;
  /** TrackedJobMode — 'sheet'(생성·재생성)만 대화 draft와 연결된다. 옷 입히기(outfit)·refine은 대화 없음 */
  mode: string;
  /** 'local'(이 기기 접수) | 'recovered' | 'conflict' */
  source?: string;
  /** 로그용 — finalize | consumed */
  via: string;
}

/**
 * 생성(sheet) job이 서버에 성공 저장됐을 때 한 곳에서 호출 — 완료 기록 + 그 job으로 접수된 draft 폐기.
 * - 연결된 draft(submittedJobId 일치) → 폐기
 * - v3.233 이전 초안(연결·기록시각 없음) + 이 기기 접수 job → 그 대화로 접수된 것(단일 슬롯) → 폐기(전환기 보정)
 * - 그 외(접수 뒤 새로 시작한 대화·다른 기기 job) → 유지
 * 실패·취소·중간 이탈은 호출하지 않는다(draft 보존 — 이어서 하기 유지).
 */
export function settleArtistDraftOnSuccess(info: ArtistJobSuccessInfo): boolean {
  try {
    if (info.mode !== 'sheet' || !info.jobId) return false;
    const s = useCharacterTaskStore.getState();
    const ids = [info.jobId, ...(s.completedArtistJobIds || []).filter((x) => x !== info.jobId)].slice(0, 10);
    const d = s.draft;
    const linked = !!d && d.submittedJobId === info.jobId;
    const legacyDraft = !!d && !d.submittedJobId && d.updatedAt == null && info.source === 'local';
    if (d && (linked || legacyDraft)) {
      useCharacterTaskStore.setState({ draft: null, completedArtistJobIds: ids });
      console.info('[ArtistDraft] 생성 완료 — draft 폐기(이어서 하기 해제)', {
        jobId: info.jobId, via: info.via, match: linked ? 'job' : 'legacy', step: d.step,
      });
      return true;
    }
    useCharacterTaskStore.setState({ completedArtistJobIds: ids });
    if (d) {
      console.info('[ArtistDraft] 생성 완료 — 다른 대화 draft 유지', {
        jobId: info.jobId, via: info.via, draftJob: d.submittedJobId ?? null, source: info.source ?? null,
      });
    }
    return false;
  } catch (err) {
    console.error('[ArtistDraft] 생성 완료 draft 정리 실패', err);
    return false;
  }
}
