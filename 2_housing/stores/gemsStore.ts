import { create } from 'zustand';
import { GEM_REWARDS } from '../data/directors';

interface GemTransaction {
  id: string;
  delta: number;        // + 획득 / - 소비
  reason: string;       // 'track_lyrics' | 'ad_reward' | 'hire_director' 등
  refId?: string;       // track id, director id 등
  at: number;
}

interface GemsState {
  balance: number;
  transactions: GemTransaction[];
  earn: (delta: number, reason: string, refId?: string) => void;
  spend: (delta: number, reason: string, refId?: string) => boolean; // 잔액 부족 시 false
  initIfEmpty: () => void; // 최초 가입 시 100 보너스
}

export const useGemsStore = create<GemsState>((set, get) => ({
  balance: 0,
  transactions: [],

  earn: (delta, reason, refId) => {
    if (delta <= 0) return;
    const tx: GemTransaction = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      delta,
      reason,
      refId,
      at: Date.now(),
    };
    set((state) => ({
      balance: state.balance + delta,
      transactions: [tx, ...state.transactions].slice(0, 100),
    }));
  },

  spend: (delta, reason, refId) => {
    if (delta <= 0) return true;
    const { balance } = get();
    if (balance < delta) return false;
    const tx: GemTransaction = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      delta: -delta,
      reason,
      refId,
      at: Date.now(),
    };
    set((state) => ({
      balance: state.balance - delta,
      transactions: [tx, ...state.transactions].slice(0, 100),
    }));
    return true;
  },

  initIfEmpty: () => {
    const { balance, transactions } = get();
    if (balance === 0 && transactions.length === 0) {
      get().earn(GEM_REWARDS.SIGNUP, 'signup');
    }
  },
}));
