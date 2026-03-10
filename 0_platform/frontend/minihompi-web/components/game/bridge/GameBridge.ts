/**
 * GameBridge - React-Phaser Integration Bridge
 *
 * React와 Phaser 간의 이벤트 버스 및 상태 공유를 담당하는 싱글톤 클래스.
 * React 컴포넌트에서 Phaser 게임으로 커맨드를 전송하고,
 * Phaser 게임에서 React로 이벤트를 전달합니다.
 */

import type {
  GameState,
  GameTime,
  CharacterState,
  GameCommand,
  GameCommandType,
  GameEvent,
  GameEventType,
  GameEventHandler,
  UnsubscribeFunction,
  IGameBridge,
} from '../types';
import { GameWebSocket, WSConnectionState } from '../services/websocket';
import type {
  SimulationActionMessage,
  SimulationConversationMessage,
  SimulationReflectionMessage,
  SimulationTimeMessage,
  WorldObjectsUpdateMessage,
  StateSyncMessage,
} from '../services/websocket';

/**
 * GameBridge Singleton Class
 *
 * Usage:
 * ```typescript
 * // React 컴포넌트에서
 * const bridge = GameBridge.getInstance();
 *
 * // 이벤트 구독
 * const unsubscribe = bridge.on('CHARACTER_CLICKED', (event) => {
 *   console.log('Character clicked:', event.payload);
 * });
 *
 * // 커맨드 전송
 * bridge.sendCommand({
 *   type: 'CREATE_CHARACTER',
 *   payload: { name: '홍길동', occupation: '개발자', spriteType: 0, x: 10, y: 10 }
 * });
 *
 * // 클린업
 * unsubscribe();
 * ```
 */
export class GameBridge implements IGameBridge {
  private static instance: GameBridge | null = null;

  // 게임 상태
  private state: GameState;

  // 이벤트 리스너 맵
  private eventListeners: Map<GameEventType, Set<GameEventHandler<any>>>;

  // 커맨드 큐 (Phaser 씬이 아직 준비되지 않았을 때 사용)
  private commandQueue: GameCommand[];
  private isGameReady: boolean = false;

  // Phaser 씬 참조 (나중에 주입됨)
  private phaserScene: Phaser.Scene | null = null;

  // WebSocket
  private gameWebSocket: GameWebSocket | null = null;
  private _isBackendConnected: boolean = false;

  // Simulation event listeners (subscribed by scenes)
  private simulationActionListeners: Set<(msg: SimulationActionMessage) => void> = new Set();
  private simulationConversationListeners: Set<(msg: SimulationConversationMessage) => void> = new Set();
  private simulationReflectionListeners: Set<(msg: SimulationReflectionMessage) => void> = new Set();
  private simulationTimeListeners: Set<(msg: SimulationTimeMessage) => void> = new Set();
  private worldObjectsUpdateListeners: Set<(msg: WorldObjectsUpdateMessage) => void> = new Set();
  private stateSyncListeners: Set<(msg: StateSyncMessage) => void> = new Set();
  private backendConnectionListeners: Set<(connected: boolean) => void> = new Set();

  private constructor() {
    this.state = this.createInitialState();
    this.eventListeners = new Map();
    this.commandQueue = [];

    // 모든 이벤트 타입에 대해 빈 Set 초기화
    this.initializeEventListeners();
  }

  /**
   * 싱글톤 인스턴스 반환
   */
  public static getInstance(): GameBridge {
    if (!GameBridge.instance) {
      GameBridge.instance = new GameBridge();
    }
    return GameBridge.instance;
  }

  /**
   * 싱글톤 인스턴스 리셋 (테스트용)
   */
  public static resetInstance(): void {
    if (GameBridge.instance) {
      GameBridge.instance.destroy();
      GameBridge.instance = null;
    }
  }

  /**
   * 초기 게임 상태 생성
   */
  private createInitialState(): GameState {
    return {
      isRunning: false,
      isPaused: false,
      gameTime: {
        hour: 9,
        minute: 0,
        day: 1,
        timeScale: 1,
      },
      characters: new Map(),
      selectedCharacterId: null,
    };
  }

  /**
   * 이벤트 리스너 맵 초기화
   */
  private initializeEventListeners(): void {
    const eventTypes: GameEventType[] = [
      'GAME_READY',
      'GAME_STARTED',
      'GAME_PAUSED',
      'GAME_RESUMED',
      'GAME_STOPPED',
      'GAME_ERROR',
      'CHARACTER_CREATED',
      'CHARACTER_REMOVED',
      'CHARACTER_MOVED',
      'CHARACTER_ACTION_CHANGED',
      'CHARACTER_CLICKED',
      'CHARACTER_STATE_CHANGED',
      'TIME_UPDATED',
      'SCENE_LOADED',
    ];

    eventTypes.forEach((type) => {
      this.eventListeners.set(type, new Set());
    });
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * 현재 게임 상태 반환
   */
  public getState(): GameState {
    return { ...this.state };
  }

  /**
   * 게임 시간 업데이트
   */
  public updateGameTime(time: Partial<GameTime>): void {
    this.state.gameTime = { ...this.state.gameTime, ...time };
    this.emit({
      type: 'TIME_UPDATED',
      payload: this.state.gameTime,
      timestamp: Date.now(),
    });
  }

  /**
   * 캐릭터 상태 업데이트
   */
  public updateCharacterState(characterId: string, state: Partial<CharacterState>): void {
    const existing = this.state.characters.get(characterId);
    if (existing) {
      const updated = { ...existing, ...state };
      this.state.characters.set(characterId, updated);
      this.emit({
        type: 'CHARACTER_STATE_CHANGED',
        payload: { characterId, state: updated },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 캐릭터 추가
   */
  public addCharacter(character: CharacterState): void {
    this.state.characters.set(character.id, character);
    this.emit({
      type: 'CHARACTER_CREATED',
      payload: { character },
      timestamp: Date.now(),
    });
  }

  /**
   * 캐릭터 제거
   */
  public removeCharacter(characterId: string): void {
    if (this.state.characters.has(characterId)) {
      this.state.characters.delete(characterId);
      if (this.state.selectedCharacterId === characterId) {
        this.state.selectedCharacterId = null;
      }
      this.emit({
        type: 'CHARACTER_REMOVED',
        payload: { characterId },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 선택된 캐릭터 설정
   */
  public setSelectedCharacter(characterId: string | null): void {
    this.state.selectedCharacterId = characterId;
  }

  // ============================================================================
  // Command System
  // ============================================================================

  /**
   * 커맨드 전송 (React -> Phaser)
   */
  public sendCommand<T extends GameCommandType>(command: GameCommand<T>): void {
    const timestampedCommand = {
      ...command,
      timestamp: command.timestamp ?? Date.now(),
    };

    if (!this.isGameReady) {
      // 게임이 아직 준비되지 않았으면 큐에 저장
      this.commandQueue.push(timestampedCommand);
      return;
    }

    this.processCommand(timestampedCommand);
  }

  /**
   * 커맨드 처리
   */
  private processCommand(command: GameCommand): void {
    // 내부 상태 업데이트
    switch (command.type) {
      case 'START_GAME':
        this.state.isRunning = true;
        this.state.isPaused = false;
        break;
      case 'PAUSE_GAME':
        this.state.isPaused = true;
        break;
      case 'RESUME_GAME':
        this.state.isPaused = false;
        break;
      case 'STOP_GAME':
        this.state.isRunning = false;
        break;
      case 'SELECT_CHARACTER':
        this.state.selectedCharacterId = (command.payload as { characterId: string | null })?.characterId ?? null;
        break;
      case 'SET_TIME_SCALE':
        this.state.gameTime.timeScale = (command.payload as { scale: number })?.scale ?? 1;
        break;
    }

    // Phaser 씬에 커맨드 전달
    if (this.phaserScene) {
      this.phaserScene.events.emit('bridge-command', command);
    }
  }

  /**
   * 큐에 있는 커맨드 처리
   */
  private flushCommandQueue(): void {
    while (this.commandQueue.length > 0) {
      const command = this.commandQueue.shift();
      if (command) {
        this.processCommand(command);
      }
    }
  }

  // ============================================================================
  // Event System
  // ============================================================================

  /**
   * 이벤트 구독
   */
  public on<T extends GameEventType>(
    eventType: T,
    handler: GameEventHandler<T>
  ): UnsubscribeFunction {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.add(handler);
    }

    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * 이벤트 구독 해제
   */
  public off<T extends GameEventType>(
    eventType: T,
    handler: GameEventHandler<T>
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(handler);
    }
  }

  /**
   * 이벤트 발생 (Phaser -> React)
   */
  public emit<T extends GameEventType>(event: GameEvent<T>): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error(`[GameBridge] Error in event handler for ${event.type}:`, error);
        }
      });
    }

    // postMessage로 부모 창에 이벤트 전파 (iframe 환경)
    this.postMessageToParent({
      type: 'GAME_EVENT',
      event: {
        type: event.type,
        payload: this.serializePayload(event.payload),
        timestamp: event.timestamp,
      },
    });
  }

  /**
   * 부모 창에 postMessage 전송
   */
  private postMessageToParent(message: unknown): void {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
      }
    } catch {
      // 크로스 오리진 에러 무시
    }
  }

  /**
   * payload 직렬화 (Map 등 직렬화 불가 객체 처리)
   */
  private serializePayload(payload: unknown): unknown {
    if (payload === undefined || payload === null) {
      return payload;
    }
    if (payload instanceof Map) {
      return Object.fromEntries(payload);
    }
    if (typeof payload === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        result[key] = this.serializePayload(value);
      }
      return result;
    }
    return payload;
  }

  // ============================================================================
  // Phaser Integration
  // ============================================================================

  /**
   * Phaser 씬 연결
   */
  public connectScene(scene: Phaser.Scene): void {
    this.phaserScene = scene;
    this.isGameReady = true;

    // 게임 준비 이벤트 발생
    this.emit({
      type: 'GAME_READY',
      payload: undefined,
      timestamp: Date.now(),
    });

    // 큐에 있는 커맨드 처리
    this.flushCommandQueue();
  }

  /**
   * Phaser 씬 연결 해제
   */
  public disconnectScene(): void {
    this.phaserScene = null;
    this.isGameReady = false;
  }

  /**
   * Phaser 씬 참조 반환
   */
  public getScene(): Phaser.Scene | null {
    return this.phaserScene;
  }

  /**
   * 게임 준비 상태 확인
   */
  public isReady(): boolean {
    return this.isGameReady;
  }

  // ============================================================================
  // WebSocket Management
  // ============================================================================

  /** Backend 연결 상태 */
  public get isBackendConnected(): boolean {
    return this._isBackendConnected;
  }

  /** WebSocket 연결 시작 */
  public connectWebSocket(): void {
    if (this.gameWebSocket) {
      this.gameWebSocket.disconnect();
    }

    this.gameWebSocket = new GameWebSocket();
    this.gameWebSocket.setCallbacks({
      onSimulationAction: (msg) => {
        this.simulationActionListeners.forEach((cb) => cb(msg));
      },
      onSimulationConversation: (msg) => {
        this.simulationConversationListeners.forEach((cb) => cb(msg));
      },
      onSimulationReflection: (msg) => {
        this.simulationReflectionListeners.forEach((cb) => cb(msg));
      },
      onSimulationTime: (msg) => {
        this.simulationTimeListeners.forEach((cb) => cb(msg));
      },
      onWorldObjectsUpdate: (msg) => {
        this.worldObjectsUpdateListeners.forEach((cb) => cb(msg));
      },
      onStateSync: (msg) => {
        this.stateSyncListeners.forEach((cb) => cb(msg));
      },
      onConnectionStateChange: (state: WSConnectionState) => {
        const connected = state === 'connected';
        this._isBackendConnected = connected;
        this.backendConnectionListeners.forEach((cb) => cb(connected));
      },
    });

    this.gameWebSocket.connect();
  }

  /** WebSocket 연결 해제 */
  public disconnectWebSocket(): void {
    if (this.gameWebSocket) {
      this.gameWebSocket.disconnect();
      this.gameWebSocket = null;
    }
    this._isBackendConnected = false;
  }

  /** Simulation event 구독 */
  public onSimulationAction(cb: (msg: SimulationActionMessage) => void): () => void {
    this.simulationActionListeners.add(cb);
    return () => { this.simulationActionListeners.delete(cb); };
  }

  public onSimulationConversation(cb: (msg: SimulationConversationMessage) => void): () => void {
    this.simulationConversationListeners.add(cb);
    return () => { this.simulationConversationListeners.delete(cb); };
  }

  public onSimulationReflection(cb: (msg: SimulationReflectionMessage) => void): () => void {
    this.simulationReflectionListeners.add(cb);
    return () => { this.simulationReflectionListeners.delete(cb); };
  }

  public onSimulationTime(cb: (msg: SimulationTimeMessage) => void): () => void {
    this.simulationTimeListeners.add(cb);
    return () => { this.simulationTimeListeners.delete(cb); };
  }

  public onWorldObjectsUpdate(cb: (msg: WorldObjectsUpdateMessage) => void): () => void {
    this.worldObjectsUpdateListeners.add(cb);
    return () => { this.worldObjectsUpdateListeners.delete(cb); };
  }

  public onStateSync(cb: (msg: StateSyncMessage) => void): () => void {
    this.stateSyncListeners.add(cb);
    return () => { this.stateSyncListeners.delete(cb); };
  }

  public onBackendConnectionChange(cb: (connected: boolean) => void): () => void {
    this.backendConnectionListeners.add(cb);
    return () => { this.backendConnectionListeners.delete(cb); };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * 리소스 정리
   */
  public destroy(): void {
    // WebSocket 해제
    this.disconnectWebSocket();

    // Simulation 리스너 해제
    this.simulationActionListeners.clear();
    this.simulationConversationListeners.clear();
    this.simulationReflectionListeners.clear();
    this.simulationTimeListeners.clear();
    this.worldObjectsUpdateListeners.clear();
    this.stateSyncListeners.clear();
    this.backendConnectionListeners.clear();

    // 모든 이벤트 리스너 제거
    this.eventListeners.forEach((listeners) => {
      listeners.clear();
    });
    this.eventListeners.clear();

    // 커맨드 큐 비우기
    this.commandQueue = [];

    // Phaser 씬 연결 해제
    this.disconnectScene();

    // 상태 리셋
    this.state = this.createInitialState();
  }
}

// 편의를 위한 기본 인스턴스 export
export const gameBridge = GameBridge.getInstance();
