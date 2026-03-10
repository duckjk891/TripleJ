/**
 * 월드 트리 구조 (Phase B 에이전트 인지 시스템을 위한 데이터 구조)
 * office-game 맵 (20x10) 기준으로 조정
 */

export interface WorldNode {
  id: string;
  name: string;
  type: 'world' | 'area' | 'room' | 'object';
  state?: string; // Phase B: 오브젝트 상태
  children: WorldNode[];
  position?: { x: number; y: number }; // 타일 좌표
}

// ── 월드 트리 데이터 (20x10 맵 기준) ──

export const WORLD_TREE: WorldNode = {
  id: 'world',
  name: 'Office',
  type: 'world',
  children: [
    {
      id: 'work_area',
      name: '작업 공간',
      type: 'area',
      position: { x: 5, y: 5 },
      children: [
        { id: 'desk_01', name: '책상 1', type: 'object', state: 'empty', position: { x: 1, y: 2 }, children: [] },
        { id: 'desk_02', name: '책상 2', type: 'object', state: 'empty', position: { x: 4, y: 2 }, children: [] },
        { id: 'desk_03', name: '책상 3', type: 'object', state: 'empty', position: { x: 1, y: 6 }, children: [] },
        { id: 'desk_04', name: '책상 4', type: 'object', state: 'empty', position: { x: 4, y: 6 }, children: [] },
        { id: 'pc_01', name: 'PC', type: 'object', state: 'idle', position: { x: 1, y: 1 }, children: [] },
        { id: 'pc_02', name: 'PC', type: 'object', state: 'idle', position: { x: 4, y: 1 }, children: [] },
        { id: 'pc_03', name: 'PC', type: 'object', state: 'idle', position: { x: 1, y: 5 }, children: [] },
        { id: 'pc_04', name: 'PC', type: 'object', state: 'idle', position: { x: 4, y: 5 }, children: [] },
        { id: 'plant_01', name: '화분', type: 'object', position: { x: 10, y: 1 }, children: [] },
        { id: 'plant_02', name: '화분', type: 'object', position: { x: 10, y: 8 }, children: [] },
      ],
    },
    {
      id: 'break_area',
      name: '휴게 공간',
      type: 'area',
      position: { x: 16, y: 2 },
      children: [
        { id: 'coffee_machine', name: '커피머신', type: 'object', state: 'idle', position: { x: 13, y: 0 }, children: [] },
        { id: 'sofa_01', name: '소파', type: 'object', state: 'empty', position: { x: 16, y: 0 }, children: [] },
        { id: 'coffee_table', name: '커피 테이블', type: 'object', state: 'empty', position: { x: 16, y: 2 }, children: [] },
      ],
    },
    {
      id: 'meeting_area',
      name: '회의 공간',
      type: 'area',
      position: { x: 16, y: 7 },
      children: [
        { id: 'meeting_table', name: '회의 테이블', type: 'object', state: 'empty', position: { x: 14, y: 6 }, children: [] },
      ],
    },
  ],
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

/** 노드의 전체 경로 문자열 반환 (예: "작업 공간 > 책상 1") */
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

/** 스폰 가능 위치 목록 (position이 있는 area 노드) */
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

    if (node.position && node.type === 'area') {
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

/** 노드 ID -> 맵 좌표 매핑 (전체) */
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
