import { create } from 'zustand';
import api from '../services/api';

// [pointsStore] 별(⭐) 잔액 — 백엔드 /points/balance 가 소스오브트루스.
// MAIDOL 헤더의 별 배지와 동일 개념. 로그인/체크인/획득 직후 fetchBalance() 로 갱신.
interface PointsState {
  balance: number | null; // null = 미로드(미로그인 포함)
  loading: boolean;
  fetchBalance: () => Promise<void>;
  setBalance: (n: number) => void; // status/check-in 응답의 balance 를 직접 반영(추가 네트워크 없이)
  clear: () => void;
}

export const usePointsStore = create<PointsState>((set) => ({
  balance: null,
  loading: false,
  fetchBalance: async () => {
    set({ loading: true });
    if (__DEV__) console.info('[pointsStore] fetching /points/balance');
    try {
      const { data } = await api.get('/points/balance');
      set({ balance: typeof data?.balance === 'number' ? data.balance : 0, loading: false });
    } catch (err: any) {
      // 미로그인(401) 등은 조용히 — 배지는 숨김
      if (err?.response?.status !== 401) {
        console.error('[pointsStore] fetchBalance 실패', { status: err?.response?.status });
      }
      set({ loading: false });
    }
  },
  setBalance: (n) => set({ balance: n }),
  clear: () => set({ balance: null }),
}));
