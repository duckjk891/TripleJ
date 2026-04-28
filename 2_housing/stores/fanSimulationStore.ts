import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArtistStore } from './artistStore';
import { useCompanyStore } from './companyStore';

/**
 * 가상 팬덤 재생 시뮬레이션
 * - 듣기는 무료라 가짜로 카운트해도 윤리 OK (인기도 EXP 기여)
 * - 다운로드는 실제 돈이라 절대 시뮬레이션 안 함
 *
 * 동작:
 *   앱 진입 시 또는 MapScreen mount 시 runIfDue() 호출
 *   lastRunAt에서 24h 이상 지났으면 → 일일 시뮬레이션 1회 실행
 *   여러 날 갭이 있어도 한 번에 처리 (최대 7일치 보너스)
 */
interface SimulationResult {
  plays: number;
  daysApplied: number;
}

interface FanSimulationState {
  lastRunAt: number | null;
  totalSimulatedPlays: number;
  /** 24h 경과했으면 시뮬레이션 실행 + artistStore.addExp 호출. 결과 반환 (없으면 null) */
  runIfDue: () => SimulationResult | null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function calcDailyPlays(
  artistLevel: number,
  companyLevel: number,
  songsReleased: number
): number {
  if (songsReleased <= 0) return 0; // 발매 곡 없으면 시뮬 X
  const base =
    artistLevel * 5 +
    companyLevel * 3 +
    songsReleased * 2 +
    (artistLevel >= 7 ? 20 : 0) +
    (companyLevel >= 5 ? 10 : 0);
  return Math.max(1, Math.floor(base));
}

export const useFanSimulationStore = create<FanSimulationState>()(
  persist(
    (set, get) => ({
      lastRunAt: null,
      totalSimulatedPlays: 0,

      runIfDue: () => {
        const now = Date.now();
        const last = get().lastRunAt;

        // 첫 실행은 lastRunAt만 세팅하고 끝 (즉시 보너스 X — 다음 날부터)
        if (last == null) {
          set({ lastRunAt: now });
          return null;
        }

        const elapsed = now - last;
        if (elapsed < ONE_DAY_MS) return null;

        const daysApplied = Math.min(7, Math.floor(elapsed / ONE_DAY_MS));

        const artist = useArtistStore.getState();
        const company = useCompanyStore.getState();
        const dailyPlays = calcDailyPlays(
          artist.level,
          company.level,
          artist.songsReleased
        );

        if (dailyPlays === 0) {
          // 발매 곡이 없으면 lastRunAt만 갱신
          set({ lastRunAt: now });
          return null;
        }

        const plays = dailyPlays * daysApplied;
        // 인기도 EXP — addExp가 totalPlays도 누적시킴
        artist.addExp(plays, 'play');

        set((state) => ({
          lastRunAt: now,
          totalSimulatedPlays: state.totalSimulatedPlays + plays,
        }));

        return { plays, daysApplied };
      },
    }),
    {
      name: 'fan-sim-storage-v1',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
