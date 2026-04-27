/**
 * 디렉터 카탈로그 (프론트 하드코딩, 백엔드 반영 전까지)
 * 각 디렉터는 특정 `modelKey` (timerStore.MODEL_QUEUE_CONFIG)에 바인딩됨
 */

import type { DirectorType } from '../components/Character';

export interface DirectorCatalog {
  id: string;
  name: string;              // 한글 이름 (친근한 별명)
  category: DirectorType;    // lyricist / composer / image / video / artist
  modelKey: string;          // timerStore와 매핑 (lyrics_gpt4o_mini 등)
  hireCost: number;          // 영입 캐시 (0이면 신규 지급)
  tier: 1 | 2 | 3 | 4 | 5;
  concept: string;           // 한 줄 소개
  sampleDialogues?: string[]; // 결과 보고 멘트 샘플 (후속 활용)
  isDefault?: boolean;       // 신규 가입 시 기본 지급
}

export const DIRECTOR_CATALOG: DirectorCatalog[] = [
  // ─── 작사 5종 ───
  {
    id: 'lyr_mini',
    name: '미니',
    category: 'lyricist',
    modelKey: 'lyrics_gpt4o_mini',
    hireCost: 0,
    tier: 1,
    concept: '빠르고 가벼운 라이터. 일단 초안을 뽑아주세요.',
    sampleDialogues: ['기본은 확실해요!', '일단 쓰고 다듬어봐요.'],
    isDefault: true,
  },
  {
    id: 'lyr_sonnet',
    name: '소네트',
    category: 'lyricist',
    modelKey: 'lyrics_claude_sonnet',
    hireCost: 800,
    tier: 2,
    concept: '감성 운율의 장인. 느낌 있는 가사를 만들어요.',
    sampleDialogues: ['감정선을 따라가봤어요.', '운율에 신경 썼어요.'],
  },
  {
    id: 'lyr_gpt4o',
    name: '포오',
    category: 'lyricist',
    modelKey: 'lyrics_gpt4o',
    hireCost: 1200,
    tier: 3,
    concept: '대중성과 독창성의 밸런스. 히트곡 체질.',
    sampleDialogues: ['후렴이 잘 나왔네요!', '대중적 포인트를 잡았어요.'],
  },
  {
    id: 'lyr_turbo',
    name: '터보',
    category: 'lyricist',
    modelKey: 'lyrics_gpt4_turbo',
    hireCost: 2000,
    tier: 4,
    concept: '긴 곡과 복잡한 스토리에 강한 전문가.',
    sampleDialogues: ['서사를 깊게 녹여봤어요.', '구조를 탄탄하게 잡았어요.'],
  },
  {
    id: 'lyr_opus',
    name: '오퍼스',
    category: 'lyricist',
    modelKey: 'lyrics_claude_opus',
    hireCost: 5000,
    tier: 5,
    concept: '문학적 깊이의 프리미엄 라이터. 명곡 제조기.',
    sampleDialogues: ['단어 하나하나 공들였어요.', '시처럼 다듬었어요.'],
  },

  // ─── 작곡 1종 (Suno 기본 지급) ───
  {
    id: 'cmp_suno',
    name: '수노',
    category: 'composer',
    modelKey: 'composer',
    hireCost: 0,
    tier: 4,
    concept: '모든 장르를 안정적으로 소화하는 메인 프로듀서.',
    sampleDialogues: ['밸런스가 잘 잡혔어요.', '대중적 완성도로 갔어요.'],
    isDefault: true,
  },

  // ─── 이미지 1종 ───
  {
    id: 'img_default',
    name: '지민',
    category: 'image',
    modelKey: 'image',
    hireCost: 0,
    tier: 1,
    concept: '앨범 자켓 전담 디자이너.',
    sampleDialogues: ['컨셉에 맞춰 그려봤어요.', '색감에 신경 썼어요.'],
    isDefault: true,
  },

  // ─── MV 1종 (초고가 잠금) ───
  {
    id: 'vid_kling',
    name: '클링',
    category: 'video',
    modelKey: 'video',
    hireCost: 10000,
    tier: 5,
    concept: '뮤직비디오 감독. 초고가 프리미엄.',
    sampleDialogues: ['씬마다 공들여 연출했어요.', 'MV 퀄리티 보장합니다.'],
  },

  // ─── 아티스트 디렉터 (기본) ───
  {
    id: 'art_default',
    name: '해나',
    category: 'artist',
    modelKey: 'artist',
    hireCost: 0,
    tier: 1,
    concept: '아티스트 캐릭터를 만들어주는 크리에이터.',
    isDefault: true,
  },
];

/**
 * 카테고리별 필터
 */
export function getDirectorsByCategory(category: DirectorType): DirectorCatalog[] {
  return DIRECTOR_CATALOG.filter((d) => d.category === category);
}

export function getDirectorById(id: string): DirectorCatalog | undefined {
  return DIRECTOR_CATALOG.find((d) => d.id === id);
}

/**
 * 신규 가입 시 기본 지급되는 디렉터 ID 리스트
 */
export const INITIAL_DIRECTOR_IDS = [
  'lyr_mini',
  'cmp_suno',
  'img_default',
  'art_default',
];

/**
 * 캐시 보상 단가
 */
export const GEM_REWARDS = {
  SIGNUP: 100,
  DAILY_LOGIN: 10,
  TRACK_LYRICS_DONE: 30,
  TRACK_MUSIC_DONE: 50,
  TRACK_COVER_DONE: 20,
  AD_SKIP_STEP: 5,        // 단계 스킵 광고 (부가 보너스)
  AD_REWARD_ONLY: 15,     // 캐시 전용 광고 (일일 10회 제한)
  CHART_TOP_100: 500,
  WEEKLY_CHALLENGE: 200,
};

export const GEM_COSTS = {
  INSTANT_COMPLETE: 100, // 대기 즉시 완료 (모든 단계 스킵)
};
