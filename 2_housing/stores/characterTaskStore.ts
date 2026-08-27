import { create } from 'zustand';

export type CharacterTaskMode = 'sheet' | 'refine' | 'outfit';

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

  startTask: (mode: CharacterTaskMode) => void;
  setInput: (data: Partial<Pick<CharacterTaskState, 'photoUri' | 'photoName' | 'userText' | 'refineRequest' | 'outfitDesc' | 'originalPhotoObjectName' | 'portraitConfirmed' | 'characterKind' | 'stylePreset' | 'styleImageUri' | 'styleImageName'>>) => void;
  completeApi: (result: CharacterTaskResult) => void;
  failApi: (msg: string) => void;
  /** 결과 소비 후 (ArtistResult 진입 후) 초기화 */
  clearResult: () => void;
  /** mode만 null로 (자동 저장 후 isUnsaved=false로 만들 때) */
  clearMode: () => void;
  /** 모든 상태 초기화 */
  reset: () => void;
}

export const useCharacterTaskStore = create<CharacterTaskState>((set) => ({
  mode: null,
  apiResult: null,
  apiError: null,
  photoUri: null,
  photoName: null,
  userText: null,
  refineRequest: null,
  outfitDesc: null,
  originalPhotoObjectName: null,
  portraitConfirmed: false,
  characterKind: 'real',
  stylePreset: null,
  styleImageUri: null,
  styleImageName: null,

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

  reset: () =>
    set({
      mode: null,
      apiResult: null,
      apiError: null,
      photoUri: null,
      photoName: null,
      userText: null,
      refineRequest: null,
      outfitDesc: null,
      originalPhotoObjectName: null,
      portraitConfirmed: false,
      characterKind: 'real',
      stylePreset: null,
      styleImageUri: null,
      styleImageName: null,
    }),
}));
