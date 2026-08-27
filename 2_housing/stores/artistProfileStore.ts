import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// v3.82: 아티스트 프로필(이름·성별) 로컬 보관.
// 서버 /character/me에는 gender 필드가 없어(실측: name/age/personality_*만 존재)
// 슬롯별('real'/'virtual')로 로컬 persist. 이름은 서버 character.name 우선, 없으면 여기.
export type ArtistSlot = 'real' | 'virtual';

export interface ArtistProfile {
  name?: string;
  gender?: string; // '남성' | '여성' | 자유 입력
}

interface ArtistProfileState {
  profiles: Partial<Record<ArtistSlot, ArtistProfile>>;
  setProfile: (slot: ArtistSlot, patch: ArtistProfile) => void;
  clearSlot: (slot: ArtistSlot) => void;
  /** DELETE /character/me는 전체 삭제 → 로컬 프로필도 함께 정리 */
  clearAll: () => void;
}

export const useArtistProfileStore = create<ArtistProfileState>()(
  persist(
    (set) => ({
      profiles: {},
      setProfile: (slot, patch) =>
        set((state) => {
          if (__DEV__) console.info('[artistProfile] setProfile', { slot, ...patch });
          return { profiles: { ...state.profiles, [slot]: { ...state.profiles[slot], ...patch } } };
        }),
      clearSlot: (slot) =>
        set((state) => {
          const next = { ...state.profiles };
          delete next[slot];
          return { profiles: next };
        }),
      clearAll: () => set({ profiles: {} }),
    }),
    {
      name: 'aidol-artist-profile',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ profiles: state.profiles }),
    }
  )
);
