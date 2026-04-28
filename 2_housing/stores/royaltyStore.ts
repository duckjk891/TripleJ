import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 정산 store — 백엔드 결제 시스템 반영 전엔 mock 데이터.
 * 백엔드 반영 후 GET /api/me/royalty/summary 응답으로 채워짐.
 */
interface RoyaltyState {
  totalEarnedKrw: number;       // 누적 매출 (creator 몫)
  availableKrw: number;         // 출금 가능
  pendingPayoutKrw: number;     // 출금 진행 중
  downloadsCount: number;
  syncedAt: number | null;      // 백엔드와 마지막 동기화 시각

  /** 백엔드 응답으로 일괄 갱신 */
  syncFromServer: (data: {
    total_earned_krw: number;
    available_krw: number;
    pending_payout_krw: number;
    downloads_count: number;
  }) => void;
}

export const useRoyaltyStore = create<RoyaltyState>()(
  persist(
    (set) => ({
      totalEarnedKrw: 0,
      availableKrw: 0,
      pendingPayoutKrw: 0,
      downloadsCount: 0,
      syncedAt: null,

      syncFromServer: (data) =>
        set({
          totalEarnedKrw: data.total_earned_krw,
          availableKrw: data.available_krw,
          pendingPayoutKrw: data.pending_payout_krw,
          downloadsCount: data.downloads_count,
          syncedAt: Date.now(),
        }),
    }),
    {
      name: 'royalty-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
