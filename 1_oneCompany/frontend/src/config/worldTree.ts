// 월드 트리 구조 (Phase B 에이전트 인지 시스템을 위한 데이터 구조)

export interface WorldNode {
  id: string;
  name: string;
  type: 'world' | 'area' | 'room' | 'object';
  state?: string;                        // Phase B: 오브젝트 상태
  children: WorldNode[];
  position?: { x: number; y: number };   // 타일 좌표
}

// ── 월드 트리 데이터 ──

export const WORLD_TREE: WorldNode = {
  id: 'world',
  name: 'OneCompany Village',
  type: 'world',
  children: [
    {
      id: 'main_office',
      name: 'Main Office',
      type: 'area',
      children: [
        {
          id: 'open_space',
          name: 'Open Space',
          type: 'room',
          position: { x: 10, y: 10 },
          children: [
            { id: 'desk_01', name: 'Desk 01', type: 'object', state: 'empty', position: { x: 7, y: 7 }, children: [] },
            { id: 'desk_02', name: 'Desk 02', type: 'object', state: 'empty', position: { x: 10, y: 7 }, children: [] },
            { id: 'desk_03', name: 'Desk 03', type: 'object', state: 'empty', position: { x: 13, y: 7 }, children: [] },
            { id: 'desk_04', name: 'Desk 04', type: 'object', state: 'empty', position: { x: 7, y: 11 }, children: [] },
            { id: 'desk_05', name: 'Desk 05', type: 'object', state: 'empty', position: { x: 10, y: 11 }, children: [] },
            { id: 'desk_06', name: 'Desk 06', type: 'object', state: 'empty', position: { x: 13, y: 11 }, children: [] },
          ]
        },
        {
          id: 'meeting_room',
          name: 'Meeting Room',
          type: 'room',
          position: { x: 10, y: 17 },
          children: [
            { id: 'meeting_table', name: 'Meeting Table', type: 'object', state: 'empty', position: { x: 8, y: 16 }, children: [] },
          ]
        },
        {
          id: 'kitchen',
          name: 'Kitchen',
          type: 'room',
          position: { x: 19, y: 17 },
          children: [
            { id: 'coffee_machine', name: 'Coffee Machine', type: 'object', state: 'idle', position: { x: 16, y: 15 }, children: [] },
            { id: 'refrigerator', name: 'Refrigerator', type: 'object', state: 'idle', position: { x: 18, y: 15 }, children: [] },
            { id: 'sink', name: 'Sink', type: 'object', state: 'idle', position: { x: 20, y: 15 }, children: [] },
          ]
        },
      ]
    },
    {
      id: 'cafe',
      name: 'Cafe',
      type: 'area',
      position: { x: 35, y: 8 },
      children: [
        { id: 'counter', name: 'Counter', type: 'object', state: 'idle', position: { x: 31, y: 6 }, children: [] },
        { id: 'cafe_table_01', name: 'Cafe Table 01', type: 'object', state: 'empty', position: { x: 32, y: 10 }, children: [] },
        { id: 'cafe_table_02', name: 'Cafe Table 02', type: 'object', state: 'empty', position: { x: 36, y: 10 }, children: [] },
        { id: 'cafe_table_03', name: 'Cafe Table 03', type: 'object', state: 'empty', position: { x: 40, y: 10 }, children: [] },
      ]
    },
    {
      id: 'park',
      name: 'Park',
      type: 'area',
      position: { x: 15, y: 30 },
      children: [
        { id: 'bench_01', name: 'Bench 01', type: 'object', state: 'empty', position: { x: 8, y: 28 }, children: [] },
        { id: 'bench_02', name: 'Bench 02', type: 'object', state: 'empty', position: { x: 15, y: 28 }, children: [] },
        { id: 'bench_03', name: 'Bench 03', type: 'object', state: 'empty', position: { x: 22, y: 28 }, children: [] },
        { id: 'fountain', name: 'Fountain', type: 'object', state: 'running', position: { x: 14, y: 32 }, children: [] },
        { id: 'tree_01', name: 'Tree', type: 'object', position: { x: 7, y: 26 }, children: [] },
        { id: 'tree_02', name: 'Tree', type: 'object', position: { x: 12, y: 26 }, children: [] },
        { id: 'tree_03', name: 'Tree', type: 'object', position: { x: 20, y: 26 }, children: [] },
        { id: 'tree_04', name: 'Tree', type: 'object', position: { x: 25, y: 26 }, children: [] },
      ]
    },
  ]
};

// ── 유틸리티 함수 ──

/** ID로 노드 검색 */
export function findNode(id: string, node: WorldNode = WORLD_TREE): WorldNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(id, child);
    if (found) return found;
  }
  return null;
}

/** 노드의 전체 경로 문자열 반환 (예: "Main Office > Open Space") */
export function getNodePath(id: string): string | null {
  function traverse(node: WorldNode, path: string[]): string | null {
    const currentPath = node.type === 'world' ? [] : [...path, node.name];
    if (node.id === id) {
      return currentPath.join(' > ') || node.name;
    }
    for (const child of node.children) {
      const result = traverse(child, currentPath);
      if (result) return result;
    }
    return null;
  }
  return traverse(WORLD_TREE, []);
}

/** 스폰 가능 위치 목록 (position이 있는 area/room 노드) */
export interface SpawnLocation {
  id: string;
  name: string;
  x: number;
  y: number;
}

let _cachedSpawnLocations: SpawnLocation[] | null = null;

export function getSpawnLocations(): SpawnLocation[] {
  if (_cachedSpawnLocations) return _cachedSpawnLocations;

  const locations: SpawnLocation[] = [];

  function traverse(node: WorldNode, path: string[]): void {
    const currentPath = node.type === 'world' ? [] : [...path, node.name];

    if (node.position && (node.type === 'area' || node.type === 'room')) {
      locations.push({
        id: node.id,
        name: currentPath.join(' > '),
        x: node.position.x,
        y: node.position.y,
      });
    }

    for (const child of node.children) {
      traverse(child, currentPath);
    }
  }

  traverse(WORLD_TREE, []);
  _cachedSpawnLocations = locations;
  return locations;
}

/** 노드 ID → 맵 좌표 매핑 (전체) */
export function getNodePositionMap(): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();

  function traverse(node: WorldNode): void {
    if (node.position) {
      map.set(node.id, node.position);
    }
    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(WORLD_TREE);
  return map;
}
