/**
 * Game Types for React-Phaser Integration
 * 0_platform 게임 타입 정의
 */

// ============================================================================
// Character Types
// ============================================================================

/**
 * 캐릭터 상태 (행동 상태)
 */
export type CharacterBehaviorState = 'idle' | 'moving' | 'acting' | 'talking';

/**
 * 캐릭터 방향
 */
export type CharacterDirection = 'up' | 'down' | 'left' | 'right';

/**
 * 캐릭터 기본 데이터
 */
export interface CharacterData {
  id: string;
  name: string;
  occupation: string;
  spriteType: number;
  x: number;
  y: number;
}

/**
 * 캐릭터 전체 상태 (런타임 상태 포함)
 */
export interface CharacterState extends CharacterData {
  behaviorState: CharacterBehaviorState;
  direction: CharacterDirection;
  currentAction: string;
  isMoving: boolean;
}

/**
 * 캐릭터 이동 기록
 */
export interface MovementRecord {
  time: string;
  action: string;
  location: string;
}

// ============================================================================
// Game State Types
// ============================================================================

/**
 * 게임 전체 상태
 */
export interface GameState {
  isRunning: boolean;
  isPaused: boolean;
  gameTime: GameTime;
  characters: Map<string, CharacterState>;
  selectedCharacterId: string | null;
}

/**
 * 게임 시간 정보
 */
export interface GameTime {
  hour: number;
  minute: number;
  day: number;
  timeScale: number;
}

// ============================================================================
// Game Command Types
// ============================================================================

/**
 * 게임 커맨드 타입
 */
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
  | 'SET_TIME_SCALE'
  | 'CAMERA_FOLLOW'
  | 'CAMERA_PAN';

/**
 * 게임 커맨드 인터페이스
 */
export interface GameCommand<T extends GameCommandType = GameCommandType> {
  type: T;
  payload?: GameCommandPayload[T];
  timestamp?: number;
}

/**
 * 각 커맨드 타입에 대한 페이로드 정의
 */
export interface GameCommandPayload {
  START_GAME: undefined;
  PAUSE_GAME: undefined;
  RESUME_GAME: undefined;
  STOP_GAME: undefined;
  CREATE_CHARACTER: CreateCharacterPayload;
  REMOVE_CHARACTER: { characterId: string };
  MOVE_CHARACTER: MoveCharacterPayload;
  SET_CHARACTER_ACTION: SetCharacterActionPayload;
  SELECT_CHARACTER: { characterId: string | null };
  SET_TIME_SCALE: { scale: number };
  CAMERA_FOLLOW: { characterId: string };
  CAMERA_PAN: { x: number; y: number };
}

export interface CreateCharacterPayload {
  name: string;
  occupation: string;
  spriteType: number;
  x: number;
  y: number;
}

export interface MoveCharacterPayload {
  characterId: string;
  targetX: number;
  targetY: number;
}

export interface SetCharacterActionPayload {
  characterId: string;
  action: string;
}

// ============================================================================
// Game Event Types
// ============================================================================

/**
 * 게임 이벤트 타입
 */
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

/**
 * 게임 이벤트 인터페이스
 */
export interface GameEvent<T extends GameEventType = GameEventType> {
  type: T;
  payload?: GameEventPayload[T];
  timestamp: number;
}

/**
 * 각 이벤트 타입에 대한 페이로드 정의
 */
export interface GameEventPayload {
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

// ============================================================================
// Event Handler Types
// ============================================================================

/**
 * 이벤트 핸들러 타입
 */
export type GameEventHandler<T extends GameEventType = GameEventType> = (
  event: GameEvent<T>
) => void;

/**
 * 이벤트 리스너 등록 해제 함수
 */
export type UnsubscribeFunction = () => void;

// ============================================================================
// Bridge Types
// ============================================================================

/**
 * GameBridge 인터페이스
 */
export interface IGameBridge {
  // State
  getState(): GameState;

  // Commands
  sendCommand<T extends GameCommandType>(command: GameCommand<T>): void;

  // Events
  on<T extends GameEventType>(
    eventType: T,
    handler: GameEventHandler<T>
  ): UnsubscribeFunction;

  off<T extends GameEventType>(
    eventType: T,
    handler: GameEventHandler<T>
  ): void;

  // Lifecycle
  destroy(): void;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * 게임 설정
 */
export interface GameConfig {
  width: number;
  height: number;
  parentId: string;
  debug?: boolean;
  timeScale?: number;
}

/**
 * 맵 설정
 */
export interface MapConfig {
  tileSize: number;
  width: number;
  height: number;
}

/**
 * 아바타 색상 프리셋
 */
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
