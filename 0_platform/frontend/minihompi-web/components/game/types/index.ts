/**
 * Office Game Types
 * 게임에서 사용되는 타입 정의
 */

// ============================================================================
// Character Types
// ============================================================================

/** 캐릭터 방향 */
export type CharacterDirection = 'up' | 'down' | 'left' | 'right';

/** 캐릭터 행동 상태 */
export type CharacterBehaviorState = 'idle' | 'moving' | 'acting' | 'talking';

/** 이동 기록 */
export interface MovementRecord {
  time: string;
  action: string;
  location: string;
}

/** 캐릭터 데이터 (생성 시 사용) */
export interface CharacterData {
  id: string;
  name: string;
  occupation: string;
  spriteType: number;
  x: number;
  y: number;
}

/** 캐릭터 상태 (런타임) */
export interface CharacterState {
  id: string;
  name: string;
  occupation: string;
  spriteType: number;
  x: number;
  y: number;
  behaviorState: CharacterBehaviorState;
  direction: CharacterDirection;
  currentAction: string;
  isMoving: boolean;
}

// ============================================================================
// Avatar Colors
// ============================================================================

export interface AvatarColor {
  id: string;
  name: string;
  color: number;
}

export const AVATAR_COLORS: AvatarColor[] = [
  { id: 'blue', name: '파랑', color: 0x4a90d9 },
  { id: 'red', name: '빨강', color: 0xd94a4a },
  { id: 'green', name: '초록', color: 0x4ad94a },
  { id: 'purple', name: '보라', color: 0x9b4ad9 },
  { id: 'orange', name: '주황', color: 0xd9944a },
  { id: 'pink', name: '분홍', color: 0xd94a90 },
  { id: 'cyan', name: '하늘', color: 0x4ad9d9 },
  { id: 'yellow', name: '노랑', color: 0xd9d94a },
];

// ============================================================================
// Game Time Types
// ============================================================================

export interface GameTime {
  hour: number;
  minute: number;
  day: number;
  timeScale: number;
}

// ============================================================================
// Game State Types
// ============================================================================

export interface GameState {
  isRunning: boolean;
  isPaused: boolean;
  gameTime: GameTime;
  characters: Map<string, CharacterState>;
  selectedCharacterId: string | null;
}

// ============================================================================
// Game Command Types
// ============================================================================

export type GameCommandType =
  | 'START_GAME'
  | 'PAUSE_GAME'
  | 'RESUME_GAME'
  | 'STOP_GAME'
  | 'CREATE_CHARACTER'
  | 'REMOVE_CHARACTER'
  | 'MOVE_CHARACTER'
  | 'SET_CHARACTER_ACTION'
  | 'SELECT_CHARACTER'
  | 'SET_TIME_SCALE';

export interface GameCommandPayloads {
  START_GAME: undefined;
  PAUSE_GAME: undefined;
  RESUME_GAME: undefined;
  STOP_GAME: undefined;
  CREATE_CHARACTER: {
    name: string;
    occupation: string;
    spriteType: number;
    x: number;
    y: number;
  };
  REMOVE_CHARACTER: { characterId: string };
  MOVE_CHARACTER: { characterId: string; x: number; y: number };
  SET_CHARACTER_ACTION: { characterId: string; action: string };
  SELECT_CHARACTER: { characterId: string | null };
  SET_TIME_SCALE: { scale: number };
}

export interface GameCommand<T extends GameCommandType = GameCommandType> {
  type: T;
  payload?: T extends keyof GameCommandPayloads ? GameCommandPayloads[T] : unknown;
  timestamp?: number;
}

// ============================================================================
// Game Event Types
// ============================================================================

export type GameEventType =
  | 'GAME_READY'
  | 'GAME_STARTED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED'
  | 'GAME_STOPPED'
  | 'GAME_ERROR'
  | 'CHARACTER_CREATED'
  | 'CHARACTER_REMOVED'
  | 'CHARACTER_MOVED'
  | 'CHARACTER_ACTION_CHANGED'
  | 'CHARACTER_CLICKED'
  | 'CHARACTER_STATE_CHANGED'
  | 'TIME_UPDATED'
  | 'SCENE_LOADED';

export interface GameEventPayloads {
  GAME_READY: undefined;
  GAME_STARTED: undefined;
  GAME_PAUSED: undefined;
  GAME_RESUMED: undefined;
  GAME_STOPPED: undefined;
  GAME_ERROR: { error: Error; message: string };
  CHARACTER_CREATED: { character: CharacterState };
  CHARACTER_REMOVED: { characterId: string };
  CHARACTER_MOVED: { characterId: string; x: number; y: number };
  CHARACTER_ACTION_CHANGED: { characterId: string; action: string };
  CHARACTER_CLICKED: { characterId: string; character: CharacterState };
  CHARACTER_STATE_CHANGED: { characterId: string; state: CharacterState };
  TIME_UPDATED: GameTime;
  SCENE_LOADED: { sceneName: string };
}

export interface GameEvent<T extends GameEventType = GameEventType> {
  type: T;
  payload: T extends keyof GameEventPayloads ? GameEventPayloads[T] : unknown;
  timestamp: number;
}

export type GameEventHandler<T extends GameEventType> = (event: GameEvent<T>) => void;
export type UnsubscribeFunction = () => void;

// ============================================================================
// Game Bridge Interface
// ============================================================================

export interface IGameBridge {
  // State
  getState(): GameState;
  updateGameTime(time: Partial<GameTime>): void;
  updateCharacterState(characterId: string, state: Partial<CharacterState>): void;
  addCharacter(character: CharacterState): void;
  removeCharacter(characterId: string): void;
  setSelectedCharacter(characterId: string | null): void;

  // Commands
  sendCommand<T extends GameCommandType>(command: GameCommand<T>): void;

  // Events
  on<T extends GameEventType>(eventType: T, handler: GameEventHandler<T>): UnsubscribeFunction;
  off<T extends GameEventType>(eventType: T, handler: GameEventHandler<T>): void;
  emit<T extends GameEventType>(event: GameEvent<T>): void;

  // Phaser Integration
  connectScene(scene: Phaser.Scene): void;
  disconnectScene(): void;
  getScene(): Phaser.Scene | null;
  isReady(): boolean;

  // Cleanup
  destroy(): void;
}
