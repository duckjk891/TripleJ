import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listVoicePersonas, VoicePersona } from '../services/voiceService';

// ── 내 목소리(Voice Persona) 스토어 ─────────────────────────────────────────
// 목록은 항상 서버에서 재조회(영속화 안 함).
// "내 아티스트 목소리" 연결(artistPersonaId/Name)만 persist.

interface VoiceState {
  personas: VoicePersona[];
  loading: boolean;
  fetchPersonas: () => Promise<void>;

  /** 아티스트에 연결된 내 목소리 페르소나 (ArtistResult → VoiceManage select 모드에서 설정) */
  artistPersonaId: string | null;
  artistPersonaName: string | null;
  setArtistPersona: (id: string, name: string) => void;
  clearArtistPersona: () => void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set, get) => ({
      personas: [],
      loading: false,

      fetchPersonas: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
          const personas = await listVoicePersonas();
          set({ personas, loading: false });
        } catch {
          // 비로그인/네트워크 오류 — 목록 비움 (에러는 voiceService에서 로깅됨)
          set({ personas: [], loading: false });
        }
      },

      artistPersonaId: null,
      artistPersonaName: null,
      setArtistPersona: (id, name) => {
        if (__DEV__) console.log('[voiceStore] setArtistPersona:', id, name);
        set({ artistPersonaId: id, artistPersonaName: name });
      },
      clearArtistPersona: () => set({ artistPersonaId: null, artistPersonaName: null }),
    }),
    {
      name: 'aidol-voice',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        artistPersonaId: state.artistPersonaId,
        artistPersonaName: state.artistPersonaName,
      }),
    }
  )
);
