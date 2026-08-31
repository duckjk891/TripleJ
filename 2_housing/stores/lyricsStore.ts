import { create } from 'zustand';

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

export const useLyricsStore = create<LyricsState>((set) => ({
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
}));
