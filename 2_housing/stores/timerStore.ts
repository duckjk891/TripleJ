import { create } from 'zustand';
import { DirectorType } from '../components/Character';

interface TimerTask {
  directorType: DirectorType;
  taskName: string;
  queueNumber: number;
  initialQueue: number; // 스테이지 진행률 계산용
  startedAt: number;
  modelKey?: string; // 모델별 세분화 키
}

// 각 디렉터의 6단계 작업 흐름 (진행률 기반으로 활성 스테이지 결정)
export interface DirectorStage {
  name: string;
  icon: string;
  description: string; // 현재 이 단계에서 디렉터가 하는 일
}

export const DIRECTOR_STAGES: Record<string, DirectorStage[]> = {
  lyricist: [
    { name: '테마 해석', icon: '💭', description: '대표님이 전달한 테마를 곱씹으며 컨셉을 잡고 있어요' },
    { name: '운율 구상', icon: '🎼', description: '장르와 분위기에 맞는 운율 패턴을 설계 중이에요' },
    { name: '초안 작성', icon: '✍', description: '1절부터 후렴까지 가사 초안을 쓰고 있어요' },
    { name: '감정 다듬기', icon: '💖', description: '단어 선택과 감정 농도를 조정하고 있어요' },
    { name: '후렴 정리', icon: '🎤', description: '가장 기억에 남을 후렴구를 다듬고 있어요' },
    { name: '최종 검토', icon: '✨', description: '전체 흐름을 점검하고 마무리 중이에요' },
  ],
  composer: [
    { name: '분위기 설정', icon: '🎭', description: '곡 전체의 톤과 에너지를 잡고 있어요' },
    { name: '멜로디 스케치', icon: '🎹', description: '훅이 될 멜로디 라인을 그려보고 있어요' },
    { name: '화성 구성', icon: '🎵', description: '코드 진행과 조성을 결정하고 있어요' },
    { name: '편곡 작업', icon: '🎛', description: '악기 배치와 리듬 섹션을 쌓고 있어요' },
    { name: '믹싱', icon: '🔊', description: '각 트랙의 음량과 패닝을 조정 중이에요' },
    { name: '마스터링', icon: '✨', description: '최종 음압과 톤을 완성하고 있어요' },
  ],
  wondera: [
    { name: '분위기 설정', icon: '🎭', description: '곡의 컨셉과 에너지를 정의하고 있어요' },
    { name: '멜로디 스케치', icon: '🎹', description: 'Wondera 스타일 멜로디를 생성 중이에요' },
    { name: '화성 구성', icon: '🎵', description: '코드 진행을 모델이 학습한 패턴으로 구성 중이에요' },
    { name: '편곡 작업', icon: '🎛', description: '악기 구성과 리듬을 자동 편곡하고 있어요' },
    { name: '믹싱', icon: '🔊', description: '트랙 간 밸런스를 조율 중이에요' },
    { name: '마스터링', icon: '✨', description: '최종 출력을 다듬고 있어요' },
  ],
  image: [
    { name: '컨셉 스케치', icon: '💡', description: '곡 분위기에 맞는 커버 컨셉을 잡고 있어요' },
    { name: '컬러 팔레트', icon: '🎨', description: '곡의 감정을 표현할 색감을 고르고 있어요' },
    { name: '구도 잡기', icon: '📐', description: '중심 요소와 여백의 균형을 맞추고 있어요' },
    { name: '디테일 작업', icon: '🖌', description: '질감과 세부 묘사를 채우고 있어요' },
    { name: '보정', icon: '✨', description: '전체 톤을 보정하고 하이라이트를 넣고 있어요' },
    { name: '최종 렌더', icon: '🖼', description: '최종 해상도로 렌더링 중이에요' },
  ],
  artist: [
    { name: '페이스 분석', icon: '🔍', description: '대표님이 올린 사진을 자세히 살펴보고 있어요' },
    { name: '인상 잡기', icon: '✏️', description: '머리와 얼굴 인상을 잡고 있어요' },
    { name: '컬러 설정', icon: '🎨', description: '피부톤과 색감을 다듬고 있어요' },
    { name: '체형 작업', icon: '💃', description: '체형과 비율을 그리고 있어요' },
    { name: '분위기 입히기', icon: '✨', description: '캐릭터 무드를 입히고 있어요' },
    { name: '시트 완성', icon: '🖼', description: '캐릭터 시트를 마무리 중이에요' },
  ],
  artist_refine: [
    { name: '요청 분석', icon: '🔍', description: '요청한 부분을 분석하고 있어요' },
    { name: '재해석', icon: '🎨', description: '캐릭터에 자연스럽게 녹이는 방법을 찾고 있어요' },
    { name: '적용', icon: '✏️', description: '시트에 반영하고 있어요' },
    { name: '다듬기', icon: '✨', description: '디테일을 정리 중이에요' },
  ],
  artist_outfit: [
    { name: '의상 분석', icon: '👗', description: '고른 의상을 살펴보고 있어요' },
    { name: '매칭', icon: '🎨', description: '캐릭터와 어울리게 매칭 중이에요' },
    { name: '입히기', icon: '✏️', description: '시트에 입혀보고 있어요' },
    { name: '마무리', icon: '✨', description: '실루엣을 다듬고 있어요' },
  ],
  video: [
    { name: '스토리보드', icon: '📋', description: '곡에 맞는 씬을 나누고 스토리를 구성 중이에요' },
    { name: '씬 구성', icon: '🎞', description: '카메라 앵글과 씬별 의상을 정리하고 있어요' },
    { name: '촬영', icon: '🎥', description: 'AI 모델로 각 씬을 생성 중이에요' },
    { name: '편집', icon: '✂', description: '씬을 곡에 맞게 붙이고 있어요' },
    { name: '이펙트', icon: '🎆', description: '전환 효과와 컬러 그레이딩을 입히고 있어요' },
    { name: '파이널 컷', icon: '🎬', description: '최종 인코딩과 자막을 넣고 있어요' },
  ],
};

export const TOTAL_STAGES = 6;

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

  // ─── 아티스트 ───
  'artist': {
    minQueue: 30, maxQueue: 50,         // ~50원, 캐릭터 시트 생성: 10~17분
    tickIntervalSec: 20,
    adReduce: { min: 5, max: 10 },
    label: '아티스트 캐릭터',
  },
  'artist_refine': {
    minQueue: 15, maxQueue: 25,         // 미세조정: 4~7분 (짧음)
    tickIntervalSec: 18,
    adReduce: { min: 4, max: 8 },
    label: '아티스트 미세조정',
  },
  'artist_outfit': {
    minQueue: 15, maxQueue: 25,         // 옷 입히기: 4~7분 (짧음)
    tickIntervalSec: 18,
    adReduce: { min: 4, max: 8 },
    label: '아티스트 코디',
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
  getCurrentStage: (directorType: DirectorType) => number; // 0..5
  getStageSize: (directorType: DirectorType) => number; // 광고 1회로 스킵할 대기번호 양
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
        [directorType]: {
          directorType,
          taskName,
          queueNumber,
          initialQueue: queueNumber,
          startedAt: Date.now(),
          modelKey: key,
        },
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

  getCurrentStage: (directorType) => {
    const task = get().activeTasks[directorType];
    if (!task || task.initialQueue <= 0) return 0;
    // queueNumber == initialQueue → stage 0 (시작), queueNumber == 0 → stage 5 (막바지)
    const progress = 1 - task.queueNumber / task.initialQueue;
    return Math.min(TOTAL_STAGES - 1, Math.max(0, Math.floor(progress * TOTAL_STAGES)));
  },

  getStageSize: (directorType) => {
    const task = get().activeTasks[directorType];
    if (!task || task.initialQueue <= 0) return 0;
    return Math.ceil(task.initialQueue / TOTAL_STAGES);
  },
}));
