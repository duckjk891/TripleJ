import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// v3.219 [LyricsDraft]: 작사 디렉터 진행 대화 draft — LyricsInputScreen ChatMessage와 구조 동일
// (구조적 타이핑 호환). 이탈·재진입 시 진행도·대화를 복원하고, 발매(reset())·'처음부터 다시'에만 지운다.
export interface LyricsDraftChatMessage {
  type: 'director' | 'user';
  text: string;
  step?: number;
}

interface LyricsState {
  genre: string;
  mood: string;
  content: string;
  perspective: string;
  language: string;
  structure: string;
  style: string;
  keywords: string;
  duration: number;
  hasRap: boolean;
  isDuet: boolean;
  reference: string;
  tempo: string;
  generatedPrompt: string;
  generatedTitle: string;
  generatedLyrics: string;
  /** v3.144 — 작업본의 출처 가사 자산 id(lyrics_assets). 작업본과 함께 영속 —
   *  musicStore.lyricsSource(비영속)가 리로드로 끊겨도 DB 연결·장르/분위기 승계 유지 */
  sourceAssetId: string;
  /** v3.219 [LyricsDraft]: 진행 중 작사 대화 스텝(0=시작 전) — 재진입 이어가기 판별 키 */
  draftStep: number;
  /** v3.219 [LyricsDraft]: 진행 중 작사 대화 전체(텍스트 답변 포함 — 2026-09-07 정책상 영속) */
  draftChat: LyricsDraftChatMessage[];
  /** v3.229 [LyricsDraft]: draft를 시작할 때의 창작 모드(일반/저작권 등록) — 영속.
   *  보존본 복귀 시 인사 대사(모드 선택 화면)를 건너뛰므로 draft와 함께 저장·복원한다. null=기록 전(구 draft) */
  draftCreationMode: 'standard' | 'copyright' | null;
  isLoading: boolean;
  error: string | null;
  setGenre: (v: string) => void;
  setMood: (v: string) => void;
  setContent: (v: string) => void;
  setPerspective: (v: string) => void;
  setLanguage: (v: string) => void;
  setStructure: (v: string) => void;
  setStyle: (v: string) => void;
  setKeywords: (v: string) => void;
  setDuration: (v: number) => void;
  setHasRap: (v: boolean) => void;
  setIsDuet: (v: boolean) => void;
  setReference: (v: string) => void;
  setTempo: (v: string) => void;
  setGeneratedPrompt: (v: string) => void;
  setGeneratedTitle: (v: string) => void;
  setGeneratedLyrics: (v: string) => void;
  setSourceAssetId: (v: string) => void;
  setDraftStep: (v: number) => void;
  setDraftChat: (v: LyricsDraftChatMessage[]) => void;
  setDraftCreationMode: (v: 'standard' | 'copyright' | null) => void;
  setIsLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  reset: () => void;
}

const initialState = {
  genre: '',
  mood: '',
  content: '',
  perspective: '',
  language: '한국어 100%', // v3.110 — 대화 선택지(LANGUAGE_OPTIONS)와 표기 통일
  structure: '',
  style: '',
  keywords: '',
  duration: 120,
  hasRap: false,
  isDuet: false,
  reference: '',
  tempo: '보통',
  generatedPrompt: '',
  generatedTitle: '',
  generatedLyrics: '',
  sourceAssetId: '',
  draftStep: 0,
  draftChat: [] as LyricsDraftChatMessage[],
  draftCreationMode: null as 'standard' | 'copyright' | null,
  isLoading: false,
  error: null,
};

// v3.133(대표 실사고 2026-09-07): 작사 결과가 메모리에만 있어 핫리로드/새로고침/앱 재시작에
// 유실됨("뱃살" 가사 유실 — 자동 자산화 v3.131 배포 전 생성분이라 서버에도 없었음).
// 생성 결과·핵심 입력을 AsyncStorage 에 영속(partialize)해 작업본이 절대 날아가지 않게 한다.
// reset()(곡 저장 시)은 기존대로 초기화 — 의도된 소비만 지운다.
export const useLyricsStore = create<LyricsState>()(
  persist(
    (set) => ({
      ...initialState,
      setGenre: (genre) => set({ genre }),
      setMood: (mood) => set({ mood }),
      setContent: (content) => set({ content }),
      setPerspective: (perspective) => set({ perspective }),
      setLanguage: (language) => set({ language }),
      setStructure: (structure) => set({ structure }),
      setStyle: (style) => set({ style }),
      setKeywords: (keywords) => set({ keywords }),
      setDuration: (duration) => set({ duration }),
      setHasRap: (hasRap) => set({ hasRap }),
      setIsDuet: (isDuet) => set({ isDuet }),
      setReference: (reference) => set({ reference }),
      setTempo: (tempo) => set({ tempo }),
      setGeneratedPrompt: (generatedPrompt) => set({ generatedPrompt }),
      setGeneratedTitle: (generatedTitle) => set({ generatedTitle }),
      setGeneratedLyrics: (generatedLyrics) => set({ generatedLyrics }),
      setSourceAssetId: (sourceAssetId) => set({ sourceAssetId }),
      setDraftStep: (draftStep) => set({ draftStep }),
      setDraftChat: (draftChat) => set({ draftChat }),
      setDraftCreationMode: (draftCreationMode) => set({ draftCreationMode }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      reset: () => set(initialState),
    }),
    {
      name: 'aidol-lyrics-draft',
      storage: createJSONStorage(() => AsyncStorage),
      // 결과물 + 재생성에 필요한 입력만 영속 (로딩/에러 등 휘발 상태 제외)
      // v3.219 [LyricsDraft]: 진행 대화 draft(텍스트 답변 = 사용자 생성물 — 핫리로드 생존)와
      // generatedPrompt(기존 partialize 누락 — '요청사항으로 돌아가기'가 재시작 후 소실되던
      // 부수 결함)도 함께 영속한다.
      partialize: (s) => ({
        genre: s.genre, mood: s.mood, content: s.content, perspective: s.perspective,
        language: s.language, structure: s.structure, keywords: s.keywords,
        duration: s.duration, hasRap: s.hasRap, isDuet: s.isDuet, reference: s.reference,
        tempo: s.tempo, generatedPrompt: s.generatedPrompt,
        generatedTitle: s.generatedTitle, generatedLyrics: s.generatedLyrics,
        sourceAssetId: s.sourceAssetId,
        draftStep: s.draftStep, draftChat: s.draftChat,
        // v3.229: 창작 모드도 draft와 함께 영속(재시작 후 1탭 복귀에서도 모드 유지)
        draftCreationMode: s.draftCreationMode,
      }),
    }
  )
);
