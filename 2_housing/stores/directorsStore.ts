import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DIRECTOR_CATALOG, INITIAL_DIRECTOR_IDS, getDirectorById } from '../data/directors';
import type { DirectorType } from '../components/Character';

interface DirectorsState {
  /** 영입한 디렉터 ID 목록 */
  hiredIds: string[];
  /** 카테고리별 현재 선택된 디렉터 ID (작업 시킬 때 사용) */
  selectedByCategory: Partial<Record<DirectorType, string>>;

  hire: (directorId: string) => void;
  isHired: (directorId: string) => boolean;
  selectForCategory: (category: DirectorType, directorId: string) => void;
  getSelected: (category: DirectorType) => string | undefined;
  /** 현재 선택된 디렉터의 modelKey (timerStore와 매핑) */
  getSelectedModelKey: (category: DirectorType) => string | undefined;

  /** 신규 유저 초기 지급 (persist hydration 후 비어있을 때만) */
  initIfEmpty: () => void;
}

export const useDirectorsStore = create<DirectorsState>()(
  persist(
    (set, get) => ({
      hiredIds: [],
      selectedByCategory: {},

      hire: (directorId) => {
        const d = getDirectorById(directorId);
        if (!d) return;
        set((state) => {
          if (state.hiredIds.includes(directorId)) return state;
          const next: Partial<Record<DirectorType, string>> = { ...state.selectedByCategory };
          // 해당 카테고리 첫 영입이면 자동 선택
          if (!next[d.category]) next[d.category] = directorId;
          return {
            hiredIds: [...state.hiredIds, directorId],
            selectedByCategory: next,
          };
        });
      },

      isHired: (directorId) => get().hiredIds.includes(directorId),

      selectForCategory: (category, directorId) => {
        set((state) => ({
          selectedByCategory: { ...state.selectedByCategory, [category]: directorId },
        }));
      },

      getSelected: (category) => get().selectedByCategory[category],

      getSelectedModelKey: (category) => {
        const id = get().selectedByCategory[category];
        if (!id) return undefined;
        return getDirectorById(id)?.modelKey;
      },

      initIfEmpty: () => {
        const { hiredIds } = get();
        if (hiredIds.length > 0) return;
        // 기본 지급 디렉터들
        const defaults = DIRECTOR_CATALOG.filter(
          (d) => d.isDefault || INITIAL_DIRECTOR_IDS.includes(d.id)
        );
        const hired = defaults.map((d) => d.id);
        const selected: Partial<Record<DirectorType, string>> = {};
        for (const d of defaults) {
          if (!selected[d.category]) selected[d.category] = d.id;
        }
        set({ hiredIds: hired, selectedByCategory: selected });
      },
    }),
    {
      name: 'directors-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hiredIds: state.hiredIds,
        selectedByCategory: state.selectedByCategory,
      }),
    }
  )
);
