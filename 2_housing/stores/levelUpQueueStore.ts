import { create } from 'zustand';

export type LevelUpKind = 'artist' | 'company';

export interface LevelUpEvent {
  id: string;
  kind: LevelUpKind;
  newLevel: number;
  rankLabel: string;
  emoji: string;
  bonus: number;
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
