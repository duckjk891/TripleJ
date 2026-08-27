import { create } from 'zustand';
import { GenerationStatus } from '../types';

interface MusicState {
  selectedModel: 'suno' | 'wondera';
  lyrics: string;
  genre: string;
  mood: string;
  tempo: string;
  vocal: string;
  vocalStyle: string;
  referenceFile: string | null;
  referenceFileName: string | null;
  style: string;
  referenceStyle: string;
  bpm: string;
  musicalKey: string;
  negativeTags: string;
  personaModel: '' | 'style' | 'voice';
  personaId: string | null;
  subVocal: string;
  subVocalStyle: string;
  coverTrackId: string | null;
  coverTrackTitle: string | null;
  coverStyle: string | null;
  /** v3.80: 커버에 포함할 캐릭터 슬롯(실사/가상)의 object_name. null=미포함.
   *  로컬 state 대신 store에 두어 대기 후 재진입 시에도 "아티스트 포함" 선택이 유지됨. */
  coverCharacterObjectName: string | null;
  generationId: string | null;
  savedTrackId: string | null;
  status: GenerationStatus;
  resultUrl: string | null;
  isLoading: boolean;
  error: string | null;
  setSelectedModel: (model: 'suno' | 'wondera') => void;
  setLyrics: (lyrics: string) => void;
  setGenre: (genre: string) => void;
  setMood: (mood: string) => void;
  setTempo: (tempo: string) => void;
  setVocal: (vocal: string) => void;
  setVocalStyle: (style: string) => void;
  setReferenceFile: (uri: string | null, name: string | null) => void;
  setStyle: (style: string) => void;
  setReferenceStyle: (referenceStyle: string) => void;
  setBpm: (bpm: string) => void;
  setMusicalKey: (musicalKey: string) => void;
  setNegativeTags: (negativeTags: string) => void;
  setPersonaModel: (v: '' | 'style' | 'voice') => void;
  setPersonaId: (id: string | null) => void;
  setSubVocal: (v: string) => void;
  setSubVocalStyle: (v: string) => void;
  setCoverTrackId: (v: string | null) => void;
  setCoverTrackTitle: (v: string | null) => void;
  setCoverStyle: (v: string | null) => void;
  setCoverCharacterObjectName: (v: string | null) => void;
  setGenerationId: (id: string | null) => void;
  setSavedTrackId: (id: string | null) => void;
  setStatus: (status: GenerationStatus) => void;
  setResultUrl: (url: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  selectedModel: 'suno' as const,
  lyrics: '',
  genre: '',
  mood: '',
  tempo: '보통',
  vocal: '',
  vocalStyle: '',
  referenceFile: null,
  referenceFileName: null,
  style: '',
  referenceStyle: '',
  bpm: '',
  musicalKey: '',
  negativeTags: '',
  personaModel: '' as const,
  personaId: null,
  subVocal: '',
  subVocalStyle: '',
  coverTrackId: null,
  coverTrackTitle: null,
  coverStyle: null,
  coverCharacterObjectName: null,
  generationId: null,
  savedTrackId: null,
  status: 'idle' as GenerationStatus,
  resultUrl: null,
  isLoading: false,
  error: null,
};

export const useMusicStore = create<MusicState>((set) => ({
  ...initialState,
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setLyrics: (lyrics) => set({ lyrics }),
  setGenre: (genre) => set({ genre }),
  setMood: (mood) => set({ mood }),
  setTempo: (tempo) => set({ tempo }),
  setVocal: (vocal) => set({ vocal }),
  setVocalStyle: (vocalStyle) => set({ vocalStyle }),
  setReferenceFile: (referenceFile, referenceFileName) =>
    set({ referenceFile, referenceFileName }),
  setStyle: (style) => set({ style }),
  setReferenceStyle: (referenceStyle) => set({ referenceStyle }),
  setBpm: (bpm) => set({ bpm }),
  setMusicalKey: (musicalKey) => set({ musicalKey }),
  setNegativeTags: (negativeTags) => set({ negativeTags }),
  setPersonaModel: (personaModel) => set({ personaModel }),
  setPersonaId: (personaId) => set({ personaId }),
  setSubVocal: (subVocal) => set({ subVocal }),
  setSubVocalStyle: (subVocalStyle) => set({ subVocalStyle }),
  setCoverTrackId: (coverTrackId) => set({ coverTrackId }),
  setCoverTrackTitle: (coverTrackTitle) => set({ coverTrackTitle }),
  setCoverStyle: (coverStyle) => set({ coverStyle }),
  setCoverCharacterObjectName: (coverCharacterObjectName) => set({ coverCharacterObjectName }),
  setGenerationId: (generationId) => set({ generationId }),
  setSavedTrackId: (savedTrackId) => set({ savedTrackId }),
  setStatus: (status) => set({ status }),
  setResultUrl: (resultUrl) => set({ resultUrl }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
