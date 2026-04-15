import { create } from 'zustand';
import { DirectorType } from '../components/Character';

interface TimerTask {
  directorType: DirectorType;
  taskName: string; // '작사' or '작곡'
  queueNumber: number;
  startedAt: number;
}

interface TimerState {
  activeTasks: Record<string, TimerTask>; // keyed by directorType
  startTask: (directorType: DirectorType, taskName: string) => void;
  reduceQueue: (directorType: DirectorType, amount: number) => void;
  completeTask: (directorType: DirectorType) => void;
  tick: () => void; // reduces queue by 1 every ~30 seconds
  getTask: (directorType: DirectorType) => TimerTask | undefined;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  activeTasks: {},
  startTask: (directorType, taskName) =>
    set((state) => ({
      activeTasks: {
        ...state.activeTasks,
        [directorType]: {
          directorType,
          taskName,
          queueNumber: Math.floor(Math.random() * 71) + 80, // 80~150
          startedAt: Date.now(),
        },
      },
    })),
  reduceQueue: (directorType, amount) =>
    set((state) => {
      const task = state.activeTasks[directorType];
      if (!task) return state;
      const newQueue = Math.max(0, task.queueNumber - amount);
      return {
        activeTasks: {
          ...state.activeTasks,
          [directorType]: { ...task, queueNumber: newQueue },
        },
      };
    }),
  completeTask: (directorType) =>
    set((state) => {
      const newTasks = { ...state.activeTasks };
      delete newTasks[directorType];
      return { activeTasks: newTasks };
    }),
  tick: () =>
    set((state) => {
      const newTasks: Record<string, TimerTask> = {};
      for (const [key, task] of Object.entries(state.activeTasks)) {
        if (task.queueNumber > 0) {
          newTasks[key] = { ...task, queueNumber: task.queueNumber - 1 };
        } else {
          newTasks[key] = { ...task, queueNumber: 0 };
        }
      }
      return { activeTasks: newTasks };
    }),
  getTask: (directorType) => get().activeTasks[directorType],
}));
