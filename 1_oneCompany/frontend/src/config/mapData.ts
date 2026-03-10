// 맵 데이터 정의 (Tiled 대신 코드로 생성)
// 나중에 Tiled JSON으로 교체 가능

export const MAP_CONFIG = {
  width: 50,           // 타일 개수 (가로)
  height: 40,          // 타일 개수 (세로)
  tileSize: 32,        // 타일 크기 (픽셀)
};

// 타일 타입
export enum TileType {
  GRASS = 0,
  FLOOR = 1,
  WALL = 2,
  ROAD = 3,
  WATER = 4,
  DESK = 5,
  CHAIR = 6,
  TABLE = 7,
  DOOR = 8,
}

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

// 맵 영역들
export const AREAS: AreaDefinition[] = [
  {
    id: 'main_office',
    name: 'Main Office',
    type: 'area',
    x: 5,
    y: 5,
    width: 20,
    height: 15,
    color: 0x8b7355,  // 나무 바닥색
    children: [
      {
        id: 'open_space',
        name: 'Open Space',
        type: 'room',
        x: 6,
        y: 6,
        width: 12,
        height: 8,
        color: 0x9b8465,
        spawnPoint: { x: 10, y: 10 },
        children: [
          { id: 'desk_01', name: 'Desk 01', type: 'object', x: 7, y: 7, width: 2, height: 1, color: 0x654321, isWalkable: false },
          { id: 'desk_02', name: 'Desk 02', type: 'object', x: 10, y: 7, width: 2, height: 1, color: 0x654321, isWalkable: false },
          { id: 'desk_03', name: 'Desk 03', type: 'object', x: 13, y: 7, width: 2, height: 1, color: 0x654321, isWalkable: false },
          { id: 'desk_04', name: 'Desk 04', type: 'object', x: 7, y: 11, width: 2, height: 1, color: 0x654321, isWalkable: false },
          { id: 'desk_05', name: 'Desk 05', type: 'object', x: 10, y: 11, width: 2, height: 1, color: 0x654321, isWalkable: false },
          { id: 'desk_06', name: 'Desk 06', type: 'object', x: 13, y: 11, width: 2, height: 1, color: 0x654321, isWalkable: false },
        ]
      },
      {
        id: 'meeting_room',
        name: 'Meeting Room',
        type: 'room',
        x: 6,
        y: 15,
        width: 8,
        height: 4,
        color: 0x7a9b6d,
        spawnPoint: { x: 10, y: 17 },
        children: [
          { id: 'meeting_table', name: 'Meeting Table', type: 'object', x: 8, y: 16, width: 4, height: 2, color: 0x4a3520, isWalkable: false },
        ]
      },
      {
        id: 'kitchen',
        name: 'Kitchen',
        type: 'room',
        x: 15,
        y: 15,
        width: 9,
        height: 4,
        color: 0xc9b896,
        spawnPoint: { x: 19, y: 17 },
        children: [
          { id: 'coffee_machine', name: 'Coffee Machine', type: 'object', x: 16, y: 15, width: 1, height: 1, color: 0x333333, isWalkable: false },
          { id: 'refrigerator', name: 'Refrigerator', type: 'object', x: 18, y: 15, width: 1, height: 1, color: 0xcccccc, isWalkable: false },
          { id: 'sink', name: 'Sink', type: 'object', x: 20, y: 15, width: 2, height: 1, color: 0x6699cc, isWalkable: false },
        ]
      },
    ]
  },
  {
    id: 'cafe',
    name: 'Cafe',
    type: 'area',
    x: 30,
    y: 5,
    width: 15,
    height: 12,
    color: 0xd4a574,
    children: [
      { id: 'counter', name: 'Counter', type: 'object', x: 31, y: 6, width: 6, height: 1, color: 0x8b4513, isWalkable: false },
      { id: 'cafe_table_01', name: 'Cafe Table 01', type: 'object', x: 32, y: 10, width: 2, height: 2, color: 0xa0522d, isWalkable: false },
      { id: 'cafe_table_02', name: 'Cafe Table 02', type: 'object', x: 36, y: 10, width: 2, height: 2, color: 0xa0522d, isWalkable: false },
      { id: 'cafe_table_03', name: 'Cafe Table 03', type: 'object', x: 40, y: 10, width: 2, height: 2, color: 0xa0522d, isWalkable: false },
    ],
    spawnPoint: { x: 35, y: 8 }
  },
  {
    id: 'park',
    name: 'Park',
    type: 'area',
    x: 5,
    y: 25,
    width: 25,
    height: 12,
    color: 0x7cba3d,
    children: [
      { id: 'bench_01', name: 'Bench 01', type: 'object', x: 8, y: 28, width: 2, height: 1, color: 0x8b4513, isWalkable: false },
      { id: 'bench_02', name: 'Bench 02', type: 'object', x: 15, y: 28, width: 2, height: 1, color: 0x8b4513, isWalkable: false },
      { id: 'bench_03', name: 'Bench 03', type: 'object', x: 22, y: 28, width: 2, height: 1, color: 0x8b4513, isWalkable: false },
      { id: 'fountain', name: 'Fountain', type: 'object', x: 14, y: 32, width: 3, height: 3, color: 0x4a90d9, isWalkable: false },
      { id: 'tree_01', name: 'Tree', type: 'object', x: 7, y: 26, width: 1, height: 1, color: 0x228b22, isWalkable: false },
      { id: 'tree_02', name: 'Tree', type: 'object', x: 12, y: 26, width: 1, height: 1, color: 0x228b22, isWalkable: false },
      { id: 'tree_03', name: 'Tree', type: 'object', x: 20, y: 26, width: 1, height: 1, color: 0x228b22, isWalkable: false },
      { id: 'tree_04', name: 'Tree', type: 'object', x: 25, y: 26, width: 1, height: 1, color: 0x228b22, isWalkable: false },
    ],
    spawnPoint: { x: 15, y: 30 }
  },
  {
    id: 'road_h1',
    name: 'Road',
    type: 'area',
    x: 0,
    y: 22,
    width: 50,
    height: 2,
    color: 0x555555,
  },
  {
    id: 'road_v1',
    name: 'Road',
    type: 'area',
    x: 27,
    y: 0,
    width: 2,
    height: 40,
    color: 0x555555,
  },
];
