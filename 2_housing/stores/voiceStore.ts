import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listVoicePersonas, listVoiceClones, VoicePersona, VoiceClone } from '../services/voiceService';

// ── 내 목소리(Voice Persona + Voice Clone) 스토어 ───────────────────────────
// 목록은 항상 서버에서 재조회(영속화 안 함).
// v3.84: "아티스트 목소리"는 프리셋(성별+보컬 스타일 태그) 또는 클론(persona/voice_id) 중
// 하나만 배타적으로 가진다(artistVoice). 프리셋은 서버 자산이 아니라 곡 생성 태그로만 쓰임.

/** 아티스트 목소리 — 프리셋(간편)과 클론(내 목소리)은 서로 배타 */
export type ArtistVoice =
  | { type: 'preset'; gender: 'male' | 'female'; style: string }
  | { type: 'clone'; personaId: string; name: string };

/** 프리셋/클론 공용 표시 라벨 (예: "여성 · 허스키" / 클론 이름) */
export function artistVoiceLabel(v: ArtistVoice | null): string | null {
  if (!v) return null;
  if (v.type === 'preset') return `${v.gender === 'male' ? '남성' : '여성'} · ${v.style}`;
  return v.name;
}

interface VoiceState {
  personas: VoicePersona[];
  loading: boolean;
  fetchPersonas: () => Promise<void>;

  // v3.83: 정식 클로닝(노래+문장낭독) 목록 — 비영속
  clones: VoiceClone[];
  clonesLoading: boolean;
  fetchClones: () => Promise<void>;

  /** v3.84: 아티스트 목소리 (프리셋 XOR 클론) — persist 대상 */
  artistVoice: ArtistVoice | null;
  setArtistVoicePreset: (gender: 'male' | 'female', style: string) => void;
  setArtistVoiceClone: (personaId: string, name: string) => void;
  clearArtistVoice: () => void;
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

      clones: [],
      clonesLoading: false,

      fetchClones: async () => {
        if (get().clonesLoading) return;
        set({ clonesLoading: true });
        try {
          const clones = await listVoiceClones();
          set({ clones, clonesLoading: false });
        } catch {
          // 비로그인/네트워크 오류 — 목록 비움 (에러는 voiceService에서 로깅됨)
          set({ clones: [], clonesLoading: false });
        }
      },

      artistVoice: null,
      setArtistVoicePreset: (gender, style) => {
        if (__DEV__) console.log('[voiceStore] setArtistVoicePreset:', gender, style);
        // 배타: 클론이 설정돼 있어도 프리셋으로 교체
        set({ artistVoice: { type: 'preset', gender, style } });
      },
      setArtistVoiceClone: (personaId, name) => {
        if (__DEV__) console.log('[voiceStore] setArtistVoiceClone:', personaId, name);
        // 배타: 프리셋이 설정돼 있어도 클론으로 교체
        set({ artistVoice: { type: 'clone', personaId, name } });
      },
      clearArtistVoice: () => {
        if (__DEV__) console.log('[voiceStore] clearArtistVoice');
        set({ artistVoice: null });
      },
    }),
    {
      name: 'aidol-voice',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // v3.84 마이그레이션: 기존 artistPersonaId/Name persist → {type:'clone'} 승계
      migrate: (persisted: any, version) => {
        if (version < 1 && persisted && !persisted.artistVoice && persisted.artistPersonaId) {
          if (__DEV__) {
            console.log('[voiceStore] persist v0→v1 마이그레이션(클론 승계):', persisted.artistPersonaId);
          }
          return {
            artistVoice: {
              type: 'clone',
              personaId: persisted.artistPersonaId,
              name: persisted.artistPersonaName || '내 목소리',
            } as ArtistVoice,
          };
        }
        return persisted;
      },
      partialize: (state) => ({
        artistVoice: state.artistVoice,
      }),
    }
  )
);
