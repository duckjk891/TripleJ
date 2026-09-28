import { create } from 'zustand';
import type { RecognitionSub, RecognitionTier } from '../data/levels';

// v3.251 [Recog]: kind 확장 — 'artist'는 인지도(세부 단계) 승급 토스트로 재정의(tier·sub 동봉),
// 'notice'는 경량 안내 토스트(공유=공연 "공연을 마쳤어요!" 등). 'company'는 기존 계약 그대로
// (companyStore 무접촉 — newLevel·rankLabel·emoji·bonus 필드 유지, emoji는 더 이상 렌더하지 않음).
export type LevelUpKind = 'artist' | 'company' | 'notice';

export interface LevelUpEvent {
  id: string;
  kind: LevelUpKind;
  /** company=레벨, artist=25스텝 step, notice=0 */
  newLevel: number;
  /** 토스트 제목 재료 — artist='연습생 4' 라벨, notice=제목 문구 */
  rankLabel: string;
  /** 레거시(company 호환 필드) — 이모지 전시 금지로 렌더하지 않음. 신규 이벤트는 '' */
  emoji: string;
  bonus: number;
  /** v3.251 artist 전용 — 휘장 렌더용 */
  tier?: RecognitionTier;
  sub?: RecognitionSub;
  /** v3.251 보조 문구(부제) override */
  message?: string;
}

interface LevelUpQueueState {
  queue: LevelUpEvent[];
  enqueue: (e: Omit<LevelUpEvent, 'id'>) => void;
  dequeue: () => void;
}

export const useLevelUpQueueStore = create<LevelUpQueueState>((set) => ({
  queue: [],
  enqueue: (e) =>
    set((state) => ({
      queue: [
        ...state.queue,
        {
          ...e,
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        },
      ],
    })),
  dequeue: () =>
    set((state) => ({
      queue: state.queue.slice(1),
    })),
}));
