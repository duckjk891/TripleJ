/**
 * Office Map Data
 * 타일 인덱스 기반 맵 데이터 (20x10 타일, 각 32px = 640x320px)
 * Modern_Interiors 에셋 사용
 */

import { MAP_CONFIG } from './gameConfig';

/**
 * 타일셋 타일 인덱스 (Room_Builder_free_32x32.png 기준)
 * 이미지 분석 결과:
 * - 바닥 타일: 각 색상별 3x2 블록 (좌상단부터)
 * - 벽 타일: 상단 영역
 */
export const ROOM_TILES = {
  // 빈 타일
  EMPTY: -1,

  // 바닥 타일 (나무 바닥 - 4번째 줄, 첫번째 컬럼 기준)
  FLOOR_WOOD_1: 48,  // 밝은 나무
  FLOOR_WOOD_2: 49,
  FLOOR_WOOD_3: 50,

  // 벽 타일
  WALL_TOP: 0,
  WALL_LEFT: 16,
  WALL_RIGHT: 18,
  WALL_BOTTOM: 32,
  WALL_CORNER_TL: 0,
  WALL_CORNER_TR: 2,
  WALL_CORNER_BL: 32,
  WALL_CORNER_BR: 34,
} as const;

/**
 * 인테리어 타일 인덱스 (Interiors_free_32x32.png 기준)
 * 32x32 타일셋에서 가구 위치 (row * columns + col)
 * 이미지 가로 약 12열 기준
 */
export const INTERIOR_TILES = {
  // 책상 (상단 영역)
  DESK_LEFT: 0,
  DESK_MIDDLE: 1,
  DESK_RIGHT: 2,

  // 의자
  CHAIR_FRONT: 24,
  CHAIR_BACK: 12,

  // 컴퓨터/모니터
  MONITOR: 36,
  COMPUTER: 37,

  // 소파
  SOFA_LEFT: 60,
  SOFA_MIDDLE: 61,
  SOFA_RIGHT: 62,

  // 테이블
  TABLE_SMALL: 72,
  TABLE_LARGE: 73,

  // 식물
  PLANT_SMALL: 84,
  PLANT_LARGE: 85,

  // 커피머신/주방
  COFFEE_MACHINE: 96,

  // 기타 오피스 가구
  BOOKSHELF: 108,
  WHITEBOARD: 120,
  CABINET: 132,
} as const;

// 영역 정의
export interface AreaDefinition {
  id: string;
  name: string;
  type: 'area' | 'room' | 'object';
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  children?: AreaDefinition[];
  isWalkable?: boolean;
  spawnPoint?: { x: number; y: number };
}

/**
 * 20x10 사무실 바닥 레이어
 * 0 = 빈 공간(외부), 1 = 바닥
 *
 * 레이아웃:
 * - 외곽은 벽 (OBJECT_LAYER에서 처리)
 * - 내부는 넓은 통로와 영역으로 구성
 */
export const FLOOR_LAYER: number[][] = [
  // y=0: 상단 벽 영역 (바닥 없음)
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // y=1~8: 내부 바닥
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  // y=9: 하단 벽 영역 (바닥 없음)
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

/**
 * 20x10 벽/가구 레이어 (오브젝트 타입)
 * 0 = 없음, 양수 = 오브젝트 타입 ID
 */
export const OBJECT_TYPE = {
  NONE: 0,
  WALL: 1,
  DESK: 2,
  CHAIR: 3,
  MONITOR: 4,
  PLANT: 5,
  SOFA: 6,
  COFFEE_TABLE: 7,
  COFFEE_MACHINE: 8,
  MEETING_TABLE: 9,
  WHITEBOARD: 10,
} as const;

/**
 * 새로운 사무실 레이아웃 (더 넓고 통로 있음)
 *
 *   0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19
 * 0 [===================외곽 벽===================]
 * 1 | 책상영역        | 통 |     휴게실           |
 * 2 | 모니터 책상     | 로 |  소파    커피머신    |
 * 3 | 의자            |    |  테이블              |
 * 4 |      통로       |    |      통로            |
 * 5 |                 |    |                      |
 * 6 | 책상영역        |    |     회의실           |
 * 7 | 모니터 책상     |    |  회의테이블  화이트  |
 * 8 | 의자   식물     |    |             보드     |
 * 9 [===================외곽 벽===================]
 */
export const OBJECT_LAYER: number[][] = [
  // y=0: 상단 벽
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  // y=1: 작업공간 상단 + 휴게실 상단
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 1],
  // y=2: 책상+모니터 (왼쪽), 소파 (오른쪽)
  [1, 4, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 0, 0, 0, 0, 1],
  // y=3: 책상 (왼쪽), 커피테이블 (오른쪽)
  [1, 2, 2, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 1],
  // y=4: 넓은 통로
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=5: 넓은 통로
  [1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=6: 아래쪽 작업공간 + 회의실
  [1, 4, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=7: 책상 (왼쪽), 회의테이블 (오른쪽)
  [1, 2, 2, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 9, 9, 9, 0, 0, 10, 1],
  // y=8: 의자 + 식물 (왼쪽)
  [1, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=9: 하단 벽
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

/**
 * 20x10 충돌 레이어
 * 0 = 이동 가능, 1 = 충돌 (이동 불가)
 * 외곽 벽 + 가구 위치만 충돌
 */
export const COLLISION_LAYER: number[][] = [
  // y=0: 상단 벽 (전체 충돌)
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  // y=1: 커피머신만 충돌
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  // y=2: 모니터, 소파 충돌
  [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1],
  // y=3: 책상, 커피테이블 충돌
  [1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  // y=4: 통로 (이동 가능)
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=5: 통로 + 식물 충돌
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=6: 모니터 충돌
  [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=7: 책상, 회의테이블, 화이트보드 충돌
  [1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1],
  // y=8: 식물 충돌
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  // y=9: 하단 벽 (전체 충돌)
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

/**
 * 사무실 영역 정의 (새 레이아웃)
 */
export const OFFICE_AREAS: AreaDefinition[] = [
  // 작업 공간 (왼쪽)
  {
    id: 'work_area',
    name: 'Work Area',
    type: 'area',
    x: 1,
    y: 1,
    width: 7,
    height: 8,
    color: 0x9b8465,
    spawnPoint: { x: 3, y: 4 },
  },
  // 휴게 공간 (오른쪽 위)
  {
    id: 'break_area',
    name: 'Break Area',
    type: 'area',
    x: 12,
    y: 1,
    width: 7,
    height: 4,
    color: 0xc9b896,
    spawnPoint: { x: 16, y: 2 },
  },
  // 회의 공간 (오른쪽 아래)
  {
    id: 'meeting_area',
    name: 'Meeting Area',
    type: 'area',
    x: 12,
    y: 5,
    width: 7,
    height: 4,
    color: 0x7a9b6d,
    spawnPoint: { x: 16, y: 6 },
  },
  // 중앙 통로
  {
    id: 'hallway',
    name: 'Hallway',
    type: 'area',
    x: 8,
    y: 1,
    width: 4,
    height: 8,
    color: 0x8a8a8a,
    spawnPoint: { x: 10, y: 5 },
  },
];

/**
 * 스폰 위치 목록 반환
 */
export function getSpawnLocations(): { id: string; name: string; x: number; y: number }[] {
  return OFFICE_AREAS
    .filter(area => area.spawnPoint)
    .map(area => ({
      id: area.id,
      name: area.name,
      x: area.spawnPoint!.x,
      y: area.spawnPoint!.y,
    }));
}

/**
 * 영역 ID로 영역 찾기
 */
export function findAreaById(id: string): AreaDefinition | null {
  return OFFICE_AREAS.find(area => area.id === id) || null;
}

/**
 * 타일 좌표가 특정 영역 내에 있는지 확인
 */
export function isInArea(tileX: number, tileY: number, area: AreaDefinition): boolean {
  return (
    tileX >= area.x &&
    tileX < area.x + area.width &&
    tileY >= area.y &&
    tileY < area.y + area.height
  );
}

/**
 * 타일 좌표로 현재 영역 이름 찾기
 */
export function getAreaNameAt(tileX: number, tileY: number): string {
  for (const area of OFFICE_AREAS) {
    if (isInArea(tileX, tileY, area)) {
      return area.name;
    }
  }
  return 'Office';
}

/**
 * 충돌 타일 Set 반환
 */
export function getBlockedTiles(): Set<string> {
  const blocked = new Set<string>();

  for (let y = 0; y < COLLISION_LAYER.length; y++) {
    for (let x = 0; x < COLLISION_LAYER[y].length; x++) {
      if (COLLISION_LAYER[y][x] === 1) {
        blocked.add(`${x},${y}`);
      }
    }
  }

  return blocked;
}

/**
 * 타일이 걸을 수 있는지 확인
 */
export function isWalkableTile(tileX: number, tileY: number, blockedTiles?: Set<string>): boolean {
  // 맵 경계 체크
  if (tileX < 0 || tileX >= MAP_CONFIG.width || tileY < 0 || tileY >= MAP_CONFIG.height) {
    return false;
  }

  // 충돌 레이어 직접 체크
  if (COLLISION_LAYER[tileY] && COLLISION_LAYER[tileY][tileX] === 1) {
    return false;
  }

  // blockedTiles Set 사용 (선택적)
  if (blockedTiles && blockedTiles.has(`${tileX},${tileY}`)) {
    return false;
  }

  return true;
}

/**
 * 오브젝트 타입별 렌더링 정보
 */
export const OBJECT_RENDER_INFO: Record<number, {
  name: string;
  color: number;
  tileIndex?: number;
}> = {
  [OBJECT_TYPE.NONE]: { name: 'None', color: 0x000000 },
  [OBJECT_TYPE.WALL]: { name: 'Wall', color: 0x666666 },
  [OBJECT_TYPE.DESK]: { name: 'Desk', color: 0x8B4513 },
  [OBJECT_TYPE.CHAIR]: { name: 'Chair', color: 0x4a4a4a },
  [OBJECT_TYPE.MONITOR]: { name: 'Monitor', color: 0x333333 },
  [OBJECT_TYPE.PLANT]: { name: 'Plant', color: 0x228B22 },
  [OBJECT_TYPE.SOFA]: { name: 'Sofa', color: 0x4a4a8a },
  [OBJECT_TYPE.COFFEE_TABLE]: { name: 'Coffee Table', color: 0xa0522d },
  [OBJECT_TYPE.COFFEE_MACHINE]: { name: 'Coffee Machine', color: 0x8B4513 },
  [OBJECT_TYPE.MEETING_TABLE]: { name: 'Meeting Table', color: 0x654321 },
  [OBJECT_TYPE.WHITEBOARD]: { name: 'Whiteboard', color: 0xffffff },
};
