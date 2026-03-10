/**
 * Office Map Data
 * 축소된 사무실 맵 (20x10 타일, 각 32px = 640x320px)
 * 1_oneCompany mapData.ts 참조하여 간소화
 */

import { MAP_CONFIG } from './gameConfig';

// 타일 타입
export const TileType = {
  FLOOR: 0,
  WALL: 1,
  DESK: 2,
  CHAIR: 3,
  PC: 4,
  COFFEE_MACHINE: 5,
  SOFA: 6,
  PLANT: 7,
  DOOR: 8,
} as const;

export type TileType = typeof TileType[keyof typeof TileType];

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
 * 사무실 영역 정의
 * 전체 맵: 20x10 타일
 */
export const OFFICE_AREAS: AreaDefinition[] = [
  // 메인 작업 공간 (왼쪽 영역)
  {
    id: 'work_area',
    name: 'Work Area',
    type: 'area',
    x: 0,
    y: 0,
    width: 12,
    height: 10,
    color: 0x9b8465, // 나무 바닥색
    spawnPoint: { x: 5, y: 5 },
    children: [
      // 책상 4개 (2x2 배치)
      { id: 'desk_01', name: 'Desk 1', type: 'object', x: 1, y: 2, width: 2, height: 1, color: 0x654321, isWalkable: false },
      { id: 'desk_02', name: 'Desk 2', type: 'object', x: 4, y: 2, width: 2, height: 1, color: 0x654321, isWalkable: false },
      { id: 'desk_03', name: 'Desk 3', type: 'object', x: 1, y: 6, width: 2, height: 1, color: 0x654321, isWalkable: false },
      { id: 'desk_04', name: 'Desk 4', type: 'object', x: 4, y: 6, width: 2, height: 1, color: 0x654321, isWalkable: false },
      // PC (책상 위)
      { id: 'pc_01', name: 'PC', type: 'object', x: 1, y: 1, width: 1, height: 1, color: 0x333333, isWalkable: false },
      { id: 'pc_02', name: 'PC', type: 'object', x: 4, y: 1, width: 1, height: 1, color: 0x333333, isWalkable: false },
      { id: 'pc_03', name: 'PC', type: 'object', x: 1, y: 5, width: 1, height: 1, color: 0x333333, isWalkable: false },
      { id: 'pc_04', name: 'PC', type: 'object', x: 4, y: 5, width: 1, height: 1, color: 0x333333, isWalkable: false },
      // 화분
      { id: 'plant_01', name: 'Plant', type: 'object', x: 10, y: 1, width: 1, height: 1, color: 0x228b22, isWalkable: false },
      { id: 'plant_02', name: 'Plant', type: 'object', x: 10, y: 8, width: 1, height: 1, color: 0x228b22, isWalkable: false },
    ],
  },
  // 휴게 공간 (오른쪽 위)
  {
    id: 'break_area',
    name: 'Break Area',
    type: 'area',
    x: 12,
    y: 0,
    width: 8,
    height: 5,
    color: 0xc9b896, // 밝은 나무색
    spawnPoint: { x: 16, y: 2 },
    children: [
      // 커피머신
      { id: 'coffee_machine', name: 'Coffee Machine', type: 'object', x: 13, y: 0, width: 1, height: 1, color: 0x8b4513, isWalkable: false },
      // 소파
      { id: 'sofa_01', name: 'Sofa', type: 'object', x: 16, y: 0, width: 3, height: 1, color: 0x4a4a8a, isWalkable: false },
      // 테이블
      { id: 'coffee_table', name: 'Coffee Table', type: 'object', x: 16, y: 2, width: 2, height: 1, color: 0xa0522d, isWalkable: false },
    ],
  },
  // 회의 공간 (오른쪽 아래)
  {
    id: 'meeting_area',
    name: 'Meeting Area',
    type: 'area',
    x: 12,
    y: 5,
    width: 8,
    height: 5,
    color: 0x7a9b6d, // 연한 녹색
    spawnPoint: { x: 16, y: 7 },
    children: [
      // 회의 테이블
      { id: 'meeting_table', name: 'Meeting Table', type: 'object', x: 14, y: 6, width: 4, height: 2, color: 0x4a3520, isWalkable: false },
    ],
  },
];

/**
 * 스폰 위치 목록 반환
 */
export function getSpawnLocations(): { id: string; name: string; x: number; y: number }[] {
  const locations: { id: string; name: string; x: number; y: number }[] = [];

  const traverse = (area: AreaDefinition) => {
    if (area.spawnPoint) {
      locations.push({
        id: area.id,
        name: area.name,
        x: area.spawnPoint.x,
        y: area.spawnPoint.y,
      });
    }
    area.children?.forEach(child => traverse(child));
  };

  OFFICE_AREAS.forEach(area => traverse(area));
  return locations;
}

/**
 * 영역 ID로 영역 찾기
 */
export function findAreaById(id: string): AreaDefinition | null {
  const traverse = (area: AreaDefinition): AreaDefinition | null => {
    if (area.id === id) return area;
    if (area.children) {
      for (const child of area.children) {
        const found = traverse(child);
        if (found) return found;
      }
    }
    return null;
  };

  for (const area of OFFICE_AREAS) {
    const found = traverse(area);
    if (found) return found;
  }
  return null;
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
      // 자식 영역 확인
      if (area.children) {
        for (const child of area.children) {
          if (child.type !== 'object' && isInArea(tileX, tileY, child)) {
            return `${area.name} > ${child.name}`;
          }
        }
      }
      return area.name;
    }
  }
  return 'Office';
}

/**
 * 충돌 영역 (걸을 수 없는 오브젝트) 수집
 */
export function getBlockedTiles(): Set<string> {
  const blocked = new Set<string>();

  const traverse = (area: AreaDefinition) => {
    if (area.type === 'object' && area.isWalkable === false) {
      for (let x = area.x; x < area.x + area.width; x++) {
        for (let y = area.y; y < area.y + area.height; y++) {
          blocked.add(`${x},${y}`);
        }
      }
    }
    area.children?.forEach(child => traverse(child));
  };

  OFFICE_AREAS.forEach(area => traverse(area));
  return blocked;
}

/**
 * 타일이 걸을 수 있는지 확인
 */
export function isWalkableTile(tileX: number, tileY: number, blockedTiles: Set<string>): boolean {
  // 맵 경계 체크
  if (tileX < 0 || tileX >= MAP_CONFIG.width || tileY < 0 || tileY >= MAP_CONFIG.height) {
    return false;
  }
  return !blockedTiles.has(`${tileX},${tileY}`);
}
