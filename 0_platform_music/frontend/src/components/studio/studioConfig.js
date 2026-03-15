/**
 * AIMU Studio - Map & Character Configuration
 * 16x10 tile grid, 32px per tile = 512x320
 */

export const MAP = {
  COLS: 16,
  ROWS: 10,
  TILE: 32,
  get WIDTH() { return this.COLS * this.TILE; },
  get HEIGHT() { return this.ROWS * this.TILE; },
};

export const COLORS = {
  FLOOR: 0x1a1a2e,
  WALL: 0x0f0f1a,
  COMPOSE_ZONE: 0x1e1040,
  LYRICS_ZONE: 0x0f2840,
  PRODUCE_ZONE: 0x2a1030,
  CENTER_ZONE: 0x16162a,
  GRID: 0x2d2d44,
  LABEL: '#94A3B8',
  BUBBLE_BG: 0x16162a,
  BUBBLE_BORDER: 0x7c3aed,
};

// Studio areas
export const AREAS = {
  COMPOSE: { name: '작곡', x: 0, y: 0, w: 6, h: 5, color: COLORS.COMPOSE_ZONE },
  LYRICS:  { name: '작사', x: 10, y: 0, w: 6, h: 5, color: COLORS.LYRICS_ZONE },
  PRODUCE: { name: '프로듀싱', x: 5, y: 6, w: 6, h: 4, color: COLORS.PRODUCE_ZONE },
  CENTER:  { name: '회의', x: 6, y: 2, w: 4, h: 4, color: COLORS.CENTER_ZONE },
};

// Furniture positions (tile coords) with interior sprite frame indices
export const FURNITURE = [
  // 작곡 코너 - 피아노, 키보드
  { x: 1, y: 1, frame: 323, label: '🎹' },
  { x: 3, y: 1, frame: 324, label: '🎹' },
  { x: 1, y: 3, frame: 258, label: '🎧' },
  // 작사 코너 - 책상, 노트
  { x: 12, y: 1, frame: 256, label: '📝' },
  { x: 14, y: 1, frame: 257, label: '📚' },
  { x: 12, y: 3, frame: 258, label: '💻' },
  // 프로듀서 - 믹싱 콘솔
  { x: 6, y: 7, frame: 322, label: '🎛️' },
  { x: 8, y: 7, frame: 323, label: '🔊' },
  { x: 10, y: 7, frame: 324, label: '🖥️' },
  // 중앙 회의 - 테이블
  { x: 7, y: 3, frame: 291, label: '☕' },
  { x: 8, y: 3, frame: 291, label: '☕' },
];

// Walkable tiles (everything except walls/furniture)
export function isWalkable(x, y) {
  if (x < 0 || x >= MAP.COLS || y < 0 || y >= MAP.ROWS) return false;
  // Border walls
  if (x === 0 || x === MAP.COLS - 1 || y === 0 || y === MAP.ROWS - 1) return false;
  // Furniture collision
  for (const f of FURNITURE) {
    if (f.x === x && f.y === y) return false;
  }
  return true;
}

// AI Characters
export const CHARACTERS = [
  {
    id: 'composer',
    name: '하모니',
    role: '작곡 AI',
    sprite: 'char_adam',
    startX: 2,
    startY: 2,
    homeArea: 'COMPOSE',
    homeX: 2,
    homeY: 2,
    idleActions: ['멜로디 구상 중...', '코드 진행 분석 중', '악보 스케치 중', '영감을 찾는 중...', '화성 실험 중'],
    workActions: ['메인 멜로디 작곡 중 🎵', '코드 진행 만드는 중', '편곡 작업 중', '인트로 작곡 중'],
  },
  {
    id: 'lyricist',
    name: '리릭',
    role: '작사 AI',
    sprite: 'char_amelia',
    startX: 13,
    startY: 2,
    homeArea: 'LYRICS',
    homeX: 13,
    homeY: 2,
    idleActions: ['가사 아이디어 메모 중', '운율 연구 중', '시 읽는 중...', '단어 선택 고민 중', '감정 표현 탐구 중'],
    workActions: ['가사 초안 작성 중 ✍️', '후렴 가사 다듬는 중', '가사 수정 중', '라임 맞추는 중'],
  },
  {
    id: 'producer',
    name: '비트',
    role: '프로듀서 AI',
    sprite: 'char_alex',
    startX: 8,
    startY: 8,
    homeArea: 'PRODUCE',
    homeX: 8,
    homeY: 8,
    idleActions: ['트렌드 분석 중', '레퍼런스 곡 청취 중 🎧', '사운드 라이브러리 탐색', '믹싱 세팅 확인 중'],
    workActions: ['전체 구성 설계 중 🎛️', '사운드 디자인 중', '믹싱 작업 중', 'BPM/키 설정 중'],
  },
];

// Dialogue templates for different phases
export const DIALOGUES = {
  greeting: [
    { speaker: '비트', text: '새 프로젝트가 들어왔어! 다 같이 모여봐.' },
    { speaker: '하모니', text: '오! 어떤 음악이야?' },
    { speaker: '리릭', text: '나도 궁금해, 어떤 콘셉트인지 알려줘!' },
  ],
  analyze: (prompt, genre, mood) => [
    { speaker: '비트', text: `의뢰 내용은: "${prompt.slice(0, 40)}${prompt.length > 40 ? '...' : ''}"` },
    ...(genre ? [{ speaker: '비트', text: `장르는 ${genre}으로 가자.` }] : []),
    ...(mood ? [{ speaker: '리릭', text: `${mood} 분위기라... 영감이 떠오른다!` }] : []),
    { speaker: '하모니', text: '좋아, 멜로디 구상 시작할게.' },
    { speaker: '리릭', text: '나도 가사 아이디어 잡아볼게!' },
  ],
  working: [
    [
      { speaker: '하모니', text: '이 코드 진행 어때? 감성적인 느낌으로...' },
      { speaker: '비트', text: '좋은데, 좀 더 리듬감을 살려보자.' },
    ],
    [
      { speaker: '리릭', text: '후렴 가사 초안 나왔어, 한번 봐줘.' },
      { speaker: '하모니', text: '멜로디랑 잘 맞는 것 같아!' },
    ],
    [
      { speaker: '비트', text: '중간 브릿지 부분에 변화를 줘볼까?' },
      { speaker: '리릭', text: '거기에 감정이 고조되는 가사를 넣으면 좋겠어.' },
    ],
    [
      { speaker: '하모니', text: '이 부분 악기 배치 어떻게 할까?' },
      { speaker: '비트', text: '피아노를 메인으로 가져가고, 패드로 공간감을 줘보자.' },
    ],
  ],
  review: [
    { speaker: '비트', text: '자, 전체적으로 한번 들어보자.' },
    { speaker: '하모니', text: '멜로디 라인이 자연스럽게 흘러가네.' },
    { speaker: '리릭', text: '가사도 감정 전달이 잘 되는 것 같아.' },
    { speaker: '비트', text: '좋아! 마무리 작업 들어가자.' },
  ],
  complete: [
    { speaker: '비트', text: '완성! 결과물이 꽤 괜찮은데?' },
    { speaker: '하모니', text: '멜로디가 귀에 쏙 들어오는 걸?' },
    { speaker: '리릭', text: '최고의 팀워크였어! 🎉' },
  ],
};

// Animation config (16x32 frame layout - characters span 2 tile rows)
// Spritesheet: 384x224 → 24 cols × 7 rows at 16x32
// Row 0: idle_down (4 frames, front view)
// Row 1: walk_down (cols 0-5, front) + walk_up (cols 6-11, back view)
// Row 2: walk_right (cols 0-5) + walk_left (cols 6-11)
// Row 3-4: sitting/special poses
// Row 5: additional walk
// Row 6: special poses
export const ANIM = {
  COLS_PER_ROW: 24,
  FRAME_RATE: 8,
  MOVE_SPEED: 64,
  // Define frame ranges: { start, count } where start = row * 24 + col
  ANIMS: {
    idle_down:  { start: 0,  count: 4 },   // Row 0, cols 0-3
    walk_down:  { start: 24, count: 6 },   // Row 1, cols 0-5
    idle_up:    { start: 30, count: 4 },   // Row 1, cols 6-9 (first 4 of up-facing)
    walk_up:    { start: 30, count: 6 },   // Row 1, cols 6-11
    idle_right: { start: 48, count: 4 },   // Row 2, cols 0-3
    walk_right: { start: 48, count: 6 },   // Row 2, cols 0-5
    idle_left:  { start: 54, count: 4 },   // Row 2, cols 6-9
    walk_left:  { start: 54, count: 6 },   // Row 2, cols 6-11
  },
};
