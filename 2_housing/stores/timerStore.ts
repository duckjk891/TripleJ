import { create } from 'zustand';
import { DirectorType } from '../components/Character';

interface TimerTask {
  directorType: DirectorType;
  taskName: string;
  queueNumber: number;
  startedAt: number;
  modelKey?: string; // 모델별 세분화 키
}

// ─── 모델별 대기번호 설정 ───
// 기준: Suno = 6시간(21,600초) 자연 대기
// 대기번호 × 감소간격(초) = 총 대기시간(초)
// 광고 1회 수익 ≈ 30~50원, 감소량으로 비용 충당

interface QueueConfig {
  minQueue: number;
  maxQueue: number;
  tickIntervalSec: number;
  adReduce: { min: number; max: number };
  label: string;
}

const MODEL_QUEUE_CONFIG: Record<string, QueueConfig> = {
  // ─── 작사 모델 (5종) ───
  'lyrics_gpt4o_mini': {
    minQueue: 30, maxQueue: 50,       // ~50원
    tickIntervalSec: 20,              // 대기: 10~17분
    adReduce: { min: 8, max: 15 },
    label: 'GPT-4o Mini 작사',
  },
  'lyrics_gpt4o': {
    minQueue: 80, maxQueue: 120,      // ~300원
    tickIntervalSec: 25,              // 대기: 33~50분
    adReduce: { min: 10, max: 18 },
    label: 'GPT-4o 작사',
  },
  'lyrics_gpt4_turbo': {
    minQueue: 120, maxQueue: 180,     // ~500원
    tickIntervalSec: 30,              // 대기: 60~90분
    adReduce: { min: 12, max: 20 },
    label: 'GPT-4 Turbo 작사',
  },
  'lyrics_claude_sonnet': {
    minQueue: 60, maxQueue: 100,      // ~200원
    tickIntervalSec: 25,              // 대기: 25~42분
    adReduce: { min: 8, max: 15 },
    label: 'Claude Sonnet 작사',
  },
  'lyrics_claude_opus': {
    minQueue: 200, maxQueue: 350,     // ~1,500원
    tickIntervalSec: 30,              // 대기: 100~175분 (약 2~3시간)
    adReduce: { min: 15, max: 25 },
    label: 'Claude Opus 작사',
  },

  // ─── 작곡 모델 ───
  'composer': {
    minQueue: 300, maxQueue: 420,     // Suno ~1,000원 (테스트 단계 단축)
    tickIntervalSec: 30,              // 대기: 150~210분 (2.5~3.5시간, 평균 3시간)
    adReduce: { min: 15, max: 30 },
    label: 'Suno 작곡',
  },
  'wondera': {
    minQueue: 200, maxQueue: 400,     // Wondera ~500원
    tickIntervalSec: 30,              // 대기: 100~200분 (약 2~3시간)
    adReduce: { min: 12, max: 25 },
    label: 'Wondera 작곡',
  },

  // ─── 이미지 ───
  'image': {
    minQueue: 60, maxQueue: 100,      // Gemini ~200원
    tickIntervalSec: 25,              // 대기: 25~42분
    adReduce: { min: 8, max: 15 },
    label: '커버 이미지',
  },

  // ─── 기타 ───
  'artist': {
    minQueue: 30, maxQueue: 50,
    tickIntervalSec: 20,
    adReduce: { min: 5, max: 10 },
    label: '아티스트',
  },
  'video': {
    minQueue: 500, maxQueue: 1000,    // MV 최고비용
    tickIntervalSec: 40,              // 대기: 333~667분 (5~11시간)
    adReduce: { min: 20, max: 35 },
    label: 'MV 생성',
  },
};

// 디렉터 타입 → 기본 모델 키 매핑
const DIRECTOR_DEFAULT_MODEL: Record<string, string> = {
  lyricist: 'lyrics_gpt4o_mini',
  composer: 'composer',
  wondera: 'wondera',
  image: 'image',
  artist: 'artist',
  video: 'video',
};

const DEFAULT_CONFIG: QueueConfig = {
  minQueue: 100, maxQueue: 200, tickIntervalSec: 30,
  adReduce: { min: 10, max: 20 }, label: '기본',
};

interface TimerState {
  activeTasks: Record<string, TimerTask>;
  startTask: (directorType: DirectorType, taskName: string, modelKey?: string) => void;
  reduceQueue: (directorType: DirectorType, amount: number) => void;
  completeTask: (directorType: DirectorType) => void;
  tickForType: (directorType: string) => void;
  getTask: (directorType: DirectorType) => TimerTask | undefined;
  getConfig: (directorType: string) => QueueConfig;
  getAdReduce: (directorType: string) => number;
  getModelConfig: (modelKey: string) => QueueConfig;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  activeTasks: {},

  startTask: (directorType, taskName, modelKey?) => {
    const key = modelKey || DIRECTOR_DEFAULT_MODEL[directorType] || directorType;
    const config = MODEL_QUEUE_CONFIG[key] || DEFAULT_CONFIG;
    const queueNumber = Math.floor(Math.random() * (config.maxQueue - config.minQueue + 1)) + config.minQueue;
    set((state) => ({
      activeTasks: {
        ...state.activeTasks,
        [directorType]: { directorType, taskName, queueNumber, startedAt: Date.now(), modelKey: key },
      },
    }));
  },

  reduceQueue: (directorType, amount) =>
    set((state) => {
      const task = state.activeTasks[directorType];
      if (!task) return state;
      return {
        activeTasks: {
          ...state.activeTasks,
          [directorType]: { ...task, queueNumber: Math.max(0, task.queueNumber - amount) },
        },
      };
    }),

  completeTask: (directorType) =>
    set((state) => {
      const newTasks = { ...state.activeTasks };
      delete newTasks[directorType];
      return { activeTasks: newTasks };
    }),

  tickForType: (directorType) =>
    set((state) => {
      const task = state.activeTasks[directorType];
      if (!task || task.queueNumber <= 0) return state;
      return {
        activeTasks: {
          ...state.activeTasks,
          [directorType]: { ...task, queueNumber: task.queueNumber - 1 },
        },
      };
    }),

  getTask: (directorType) => get().activeTasks[directorType],

  getConfig: (directorType) => {
    const task = get().activeTasks[directorType];
    const key = task?.modelKey || DIRECTOR_DEFAULT_MODEL[directorType] || directorType;
    return MODEL_QUEUE_CONFIG[key] || DEFAULT_CONFIG;
  },

  getAdReduce: (directorType) => {
    const config = get().getConfig(directorType);
    return Math.floor(Math.random() * (config.adReduce.max - config.adReduce.min + 1)) + config.adReduce.min;
  },

  getModelConfig: (modelKey) => MODEL_QUEUE_CONFIG[modelKey] || DEFAULT_CONFIG,
}));
