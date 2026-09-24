import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CharacterTaskMode = 'sheet' | 'refine' | 'outfit';

// ── v3.219 [ArtistDraft]: 아티스트 생성 대화 draft — ArtistInputScreen 로컬 state 미러링.
// 이탈·재진입 시 Q&A 진행분을 복원한다(기존 v3.105 '이어서 만들기'는 의상 단계 재개 —
// draft는 그보다 앞 단계인 Q&A 도중을 커버). 생성 성공 저장(reset())·'처음부터'에만 지운다.
// photoUri 등 파일 URI는 draft에 넣지 않는다(앱 재시작 후 파일 소멸 — F3(d)). 전 필드가
// 텍스트/enum이라 draft 통째로 AsyncStorage 영속(2026-09-07 텍스트 입력물 보존 정책). ──
export interface ArtistDraftChatMessage {
  type: 'director' | 'user';
  text: string;
}

export interface ArtistDraft {
  step: 'welcome' | 'questioning' | 'style';
  chat: ArtistDraftChatMessage[];
  qIndex: number;
  styleAnswers: Record<string, string>;
  currentInput: string;
  selectedKind: 'real' | 'virtual' | null;
  pendingConceptText: string;
  /** 키 검증용 — 재생성 진입(targetCharacterId)·forceKind가 draft와 다르면 폐기(오염 방지) */
  targetCharacterId: string | null;
  forceKind: 'real' | 'virtual' | null;
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

  startTask: (mode: CharacterTaskMode) => void;
  setInput: (data: Partial<Pick<CharacterTaskState, 'photoUri' | 'photoName' | 'userText' | 'conceptText' | 'refineRequest' | 'outfitDesc' | 'originalPhotoObjectName' | 'portraitConfirmed' | 'characterKind' | 'stylePreset' | 'styleImageUri' | 'styleImageName' | 'pendingGender' | 'pendingName' | 'pendingAge' | 'targetCharacterId' | 'legacyContract'>>) => void;
  completeApi: (result: CharacterTaskResult) => void;
  failApi: (msg: string) => void;
  /** 결과 소비 후 (ArtistResult 진입 후) 초기화 */
  clearResult: () => void;
  /** mode만 null로 (자동 저장 후 isUnsaved=false로 만들 때) */
  clearMode: () => void;
  /** v3.219 [ArtistDraft]: 대화 draft 기록/폐기 */
  setDraft: (draft: ArtistDraft | null) => void;
  clearDraft: () => void;
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

  setDraft: (draft) => set({ draft }),

  clearDraft: () => set({ draft: null }),

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
      partialize: (s) => ({ draft: s.draft }),
    }
  )
);
