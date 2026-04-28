import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  companyExpForNextLevel,
  companyLevelUpBonus,
  getCompanyTier,
} from '../data/levels';
import { useLevelUpQueueStore } from './levelUpQueueStore';
import { useGemsStore } from './gemsStore';

interface CompanyState {
  exp: number;
  level: number;
  totalSongs: number;
  totalDirectorsHired: number;
  totalSpent: number; // 누적 💎 사용

  /**
   * EXP 추가 + 레벨업 처리 (artistStore와 동일 패턴).
   * source:
   *   release : 곡 발매 (totalSongs +1)
   *   hire    : 디렉터 영입 (totalDirectorsHired +1)
   *   spend   : 100💎 사용 임계값 도달 시 호출 (totalSpent는 별도 트래킹)
   */
  addExp: (
    delta: number,
    source: 'release' | 'hire' | 'spend'
  ) => { leveledUp: boolean; newLevel: number };

  /** spend 추적 — 누적이 100을 넘을 때마다 +5 EXP */
  trackSpend: (gemAmount: number) => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set, get) => ({
      exp: 0,
      level: 1,
      totalSongs: 0,
      totalDirectorsHired: 0,
      totalSpent: 0,

      addExp: (delta, source) => {
        if (delta <= 0) return { leveledUp: false, newLevel: get().level };

        let { exp, level } = get();
        exp += delta;
        let leveledUp = false;
        let lastNewLevel = level;

        while (exp >= companyExpForNextLevel(level)) {
          exp -= companyExpForNextLevel(level);
          level += 1;
          leveledUp = true;
          lastNewLevel = level;

          const tier = getCompanyTier(level);
          const bonus = companyLevelUpBonus(level);
          useLevelUpQueueStore.getState().enqueue({
            kind: 'company',
            newLevel: level,
            rankLabel: tier.label,
            emoji: tier.emoji,
            bonus,
          });
          useGemsStore.getState().earn(bonus, 'company_level_up');
        }

        const songsInc = source === 'release' ? 1 : 0;
        const hireInc = source === 'hire' ? 1 : 0;

        set((state) => ({
          exp,
          level,
          totalSongs: state.totalSongs + songsInc,
          totalDirectorsHired: state.totalDirectorsHired + hireInc,
        }));

        return { leveledUp, newLevel: lastNewLevel };
      },

      trackSpend: (gemAmount) => {
        if (gemAmount <= 0) return;
        const prev = get().totalSpent;
        const next = prev + gemAmount;
        // 100💎 단위 임계값을 넘었는지 카운트
        const prevBucket = Math.floor(prev / 100);
        const nextBucket = Math.floor(next / 100);
        const buckets = nextBucket - prevBucket;
        set({ totalSpent: next });
        if (buckets > 0) {
          get().addExp(buckets * 5, 'spend');
        }
      },
    }),
    {
      name: 'company-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        exp: state.exp,
        level: state.level,
        totalSongs: state.totalSongs,
        totalDirectorsHired: state.totalDirectorsHired,
        totalSpent: state.totalSpent,
      }),
    }
  )
);
