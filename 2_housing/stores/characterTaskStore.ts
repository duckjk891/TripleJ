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

  startTask: (mode: CharacterTaskMode, photoUri?: string | null, photoName?: string | null) => void;
  completeApi: (result: CharacterTaskResult) => void;
  failApi: (msg: string) => void;
  /** 결과 소비 후 (ArtistResult 진입 후) 초기화 */
  clearResult: () => void;
  /** 모든 상태 초기화 */
  reset: () => void;
}

export const useCharacterTaskStore = create<CharacterTaskState>((set) => ({
  mode: null,
  apiResult: null,
  apiError: null,
  photoUri: null,
  photoName: null,

  startTask: (mode, photoUri, photoName) =>
    set((state) => ({
      mode,
      apiError: null,
      // apiResult는 이전 시트 그대로 유지 (refine/outfit의 sheet_image 베이스로 재사용).
      // sheet 모드는 completeApi가 곧 덮어씀
      photoUri: photoUri !== undefined ? photoUri : state.photoUri,
      photoName: photoName !== undefined ? photoName : state.photoName,
    })),

  completeApi: (result) => set({ apiResult: result, apiError: null }),

  failApi: (msg) => set({ apiError: msg }),

  clearResult: () => set({ apiResult: null, apiError: null, mode: null }),

  reset: () =>
    set({
      mode: null,
      apiResult: null,
      apiError: null,
      photoUri: null,
      photoName: null,
    }),
}));
