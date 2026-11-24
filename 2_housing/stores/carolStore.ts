import { create } from 'zustand';
import { getCarolStatus, type CarolStatus } from '../services/carolService';

// v3.438 [Carol] 이벤트 상태 — 배너(차트·커뮤니티·크루)와 이벤트 화면이 함께 쓴다. 배너는 1분 안에는 다시 묻지 않는다.
const FRESH_MS = 60_000;

interface CarolState {
  status: CarolStatus | null;
  uid: string | null;
  at: number;
  load: (uid: string | null, force?: boolean) => Promise<void>;
}

export const useCarolStore = create<CarolState>((set, get) => ({
  status: null,
  uid: null,
  at: 0,
  load: async (uid, force) => {
    const cur = get();
    if (!force && cur.uid === uid && Date.now() - cur.at < FRESH_MS) return;
    set({ at: Date.now(), uid, ...(cur.uid !== uid ? { status: null } : {}) });
    try {
      const status = await getCarolStatus();
      if (get().uid === uid) set({ status });
    } catch (err: any) {
      // 옛 서버(404)·일시 오류 — 배너를 숨길 뿐 다른 화면에는 영향 없음
      if (err?.response?.status !== 404) console.error('[Carol] 상태 조회 실패', { status: err?.response?.status });
      if (force) throw err;
    }
  },
}));
