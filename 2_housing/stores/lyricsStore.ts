import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      reset: () => set(initialState),
    }),
    {
      name: 'aidol-lyrics-draft',
      storage: createJSONStorage(() => AsyncStorage),
      // 결과물 + 재생성에 필요한 입력만 영속 (로딩/에러 등 휘발 상태 제외)
      partialize: (s) => ({
        genre: s.genre, mood: s.mood, content: s.content, perspective: s.perspective,
        language: s.language, structure: s.structure, keywords: s.keywords,
        duration: s.duration, hasRap: s.hasRap, isDuet: s.isDuet, reference: s.reference,
        tempo: s.tempo, generatedTitle: s.generatedTitle, generatedLyrics: s.generatedLyrics,
      }),
    }
  )
);
