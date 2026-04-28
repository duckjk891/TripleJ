import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  artistExpForNextLevel,
  artistLevelUpBonus,
  getArtistRank,
} from '../data/levels';
import { useLevelUpQueueStore } from './levelUpQueueStore';
import { useGemsStore } from './gemsStore';

interface ArtistState {
  exp: number;
  level: number;
  songsReleased: number;
  totalPlays: number;

  /**
   * EXP 추가 후 레벨업이 일어났는지 반환.
   * 레벨업 발생 시:
   *   - level 증가
   *   - levelUpQueueStore에 토스트 enqueue
   *   - gemsStore에 보너스 💎 earn
   * 한 번 호출에 여러 레벨 점프하는 케이스도 처리.
   */
  addExp: (delta: number, source: 'release' | 'play') => { leveledUp: boolean; newLevel: number };
}

export const useArtistStore = create<ArtistState>()(
  persist(
    (set, get) => ({
      exp: 0,
      level: 1,
      songsReleased: 0,
      totalPlays: 0,

      addExp: (delta, source) => {
        if (delta <= 0) return { leveledUp: false, newLevel: get().level };

        let { exp, level } = get();
        exp += delta;
        let leveledUp = false;
        let lastNewLevel = level;

        while (exp >= artistExpForNextLevel(level)) {
          exp -= artistExpForNextLevel(level);
          level += 1;
          leveledUp = true;
          lastNewLevel = level;

          // 레벨업 토스트 + 💎 보너스
          const rank = getArtistRank(level);
          const bonus = artistLevelUpBonus(level);
          useLevelUpQueueStore.getState().enqueue({
            kind: 'artist',
            newLevel: level,
            rankLabel: rank.label,
            emoji: rank.emoji,
            bonus,
          });
          useGemsStore.getState().earn(bonus, 'artist_level_up');
        }

        const songsInc = source === 'release' ? 1 : 0;
        const playsInc = source === 'play' ? 1 : 0;

        set((state) => ({
          exp,
          level,
          songsReleased: state.songsReleased + songsInc,
          totalPlays: state.totalPlays + playsInc,
        }));

        return { leveledUp, newLevel: lastNewLevel };
      },
    }),
    {
      name: 'artist-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        exp: state.exp,
        level: state.level,
        songsReleased: state.songsReleased,
        totalPlays: state.totalPlays,
      }),
    }
  )
);
