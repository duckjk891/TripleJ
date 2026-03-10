const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

// ── 캐릭터 API ──

export interface CharacterData {
  id: string;
  name: string;
  occupation: string;
  avatar_id: string;
  position: { x: number; y: number };
  current_action: string;
}

export function getCharacters(): Promise<CharacterData[]> {
  return request('/characters');
}

export function getCharacter(id: string): Promise<CharacterData> {
  return request(`/characters/${id}`);
}

export function createCharacter(data: {
  name: string;
  occupation: string;
  avatar_id: string;
  spawn_location: string;
}): Promise<CharacterData> {
  return request('/characters', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteCharacter(id: string): Promise<void> {
  return request(`/characters/${id}`, { method: 'DELETE' });
}

export function updateCharacterPosition(id: string, x: number, y: number): Promise<CharacterData> {
  return request(`/characters/${id}/position`, {
    method: 'PUT',
    body: JSON.stringify({ x, y }),
  });
}

export function updateCharacterAction(id: string, action: string): Promise<CharacterData> {
  return request(`/characters/${id}/action`, {
    method: 'PUT',
    body: JSON.stringify({ action }),
  });
}

// ── 월드 API ──

export function getWorldTree(): Promise<unknown> {
  return request('/world/tree');
}

export interface SpawnLocation {
  id: string;
  name: string;
  x: number;
  y: number;
}

export function getLocations(): Promise<SpawnLocation[]> {
  return request('/world/locations');
}

export interface GameTime {
  hour: number;
  minute: number;
  day: number;
  display: string;
  speed: number;
  paused: boolean;
}

export function getGameTime(): Promise<GameTime> {
  return request('/world/time');
}

export function setGameSpeed(speed: number): Promise<void> {
  return request('/world/time/speed', {
    method: 'PUT',
    body: JSON.stringify({ speed }),
  });
}

// ── 아바타 API ──

export interface AvatarInfo {
  id: string;
  name: string;
  color: number;
}

export function getAvatars(): Promise<AvatarInfo[]> {
  return request('/avatars');
}

// ── 에이전트 API (Phase B) ──

export interface AgentData {
  id: string;
  name: string;
  occupation: string;
  traits: string;
  position: { x: number; y: number };
  location_name: string;
  current_action: string;
  current_plan: string | null;
  memory_count: number;
  recent_memories: { content: string; type: string; importance: number }[];
  daily_plan: { start: string; end: string; desc: string; loc: string }[];
  is_conversing: boolean;
  spatial_memory: Record<string, { name: string; state: string; last_seen: string }>; // B-4
  recent_reflections: { content: string; importance: number }[]; // B-11
}

export function createAgent(data: {
  name: string;
  occupation: string;
  avatar_id: string;
  spawn_location: string;
  traits: string;
  backstory: string;
  daily_routine: string;
}): Promise<AgentData> {
  return request('/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getAgents(): Promise<AgentData[]> {
  return request('/agents');
}

export function getAgent(id: string): Promise<AgentData> {
  return request(`/agents/${id}`);
}

export function deleteAgent(id: string): Promise<void> {
  return request(`/agents/${id}`, { method: 'DELETE' });
}

export function getAgentMemories(id: string, limit: number = 20): Promise<unknown[]> {
  return request(`/agents/${id}/memories?limit=${limit}`);
}

export function getAgentPlan(id: string): Promise<unknown> {
  return request(`/agents/${id}/plan`);
}

export function runSimulationStep(): Promise<unknown> {
  return request('/agents/simulate', { method: 'POST' });
}
