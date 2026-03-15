/**
 * OfficeScene
 * 사무실 전용 메인 씬 - Modern_Interiors 에셋 사용
 * 캐릭터 생성, 애니메이션, 카메라 설정, GameBridge 연동
 */

import Phaser from 'phaser';
import { MapRenderer } from '../systems/MapRenderer';
import { CharacterManager } from '../systems/CharacterManager';
import { GameTimeManager } from '../systems/GameTimeManager';
import { MAP_CONFIG, LAYER_DEPTH } from '../config/gameConfig';
import { Character } from '../entities/Character';
import { GameBridge } from '../bridge/GameBridge';

// 사용 가능한 캐릭터 스프라이트 목록
const CHARACTER_SPRITES = ['char_adam', 'char_alex', 'char_amelia', 'char_bob'] as const;
type CharacterSpriteKey = typeof CHARACTER_SPRITES[number];

export class OfficeScene extends Phaser.Scene {
  private mapRenderer!: MapRenderer;
  public characterManager!: CharacterManager;
  public gameTimeManager!: GameTimeManager;

  // 주야간 오버레이 (Effect Layer)
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;

  private bridge: GameBridge;

  // WebSocket unsubscribe functions
  private wsUnsubscribers: (() => void)[] = [];

  // 대화 중인 에이전트 추적 (Priority 3: 대화 중 액션 오버라이드 방지)
  private conversatingAgents: Set<string> = new Set();

  constructor() {
    super({ key: 'OfficeScene' });
    this.bridge = GameBridge.getInstance();
  }

  preload(): void {
    // 타일셋 로드 (spritesheet로 로드하여 개별 타일 접근 가능)
    // Room_Builder: 544x736 = 17열 x 23행
    this.load.spritesheet('tiles_room', '/assets/tiles/Room_Builder_free_32x32.png', {
      frameWidth: 32,
      frameHeight: 32,
    });
    // Interiors: 512x2848 = 16열 x 89행
    this.load.spritesheet('tiles_interior', '/assets/tiles/Interiors_free_32x32.png', {
      frameWidth: 32,
      frameHeight: 32,
    });

    // 캐릭터 스프라이트 로드 (4명 - 16x32 사이즈, 캐릭터가 2타일 높이)
    this.load.spritesheet('char_adam', '/assets/characters/Adam_16x16.png', {
      frameWidth: 16,
      frameHeight: 32,
    });
    this.load.spritesheet('char_alex', '/assets/characters/Alex_16x16.png', {
      frameWidth: 16,
      frameHeight: 32,
    });
    this.load.spritesheet('char_amelia', '/assets/characters/Amelia_16x16.png', {
      frameWidth: 16,
      frameHeight: 32,
    });
    this.load.spritesheet('char_bob', '/assets/characters/Bob_16x16.png', {
      frameWidth: 16,
      frameHeight: 32,
    });

    // 기존 캐릭터 스프라이트도 로드 (폴백용)
    this.load.spritesheet('characters', '/assets/sprites/characters.png', {
      frameWidth: 32,
      frameHeight: 32,
    });
  }

  create(): void {
    const worldWidth = MAP_CONFIG.width * MAP_CONFIG.tileSize;
    const worldHeight = MAP_CONFIG.height * MAP_CONFIG.tileSize;

    // 맵 렌더링
    this.mapRenderer = new MapRenderer(this);
    this.mapRenderer.render();

    // 캐릭터 애니메이션 생성 (새 스프라이트용)
    this.createNewCharacterAnimations();

    // 기존 애니메이션도 생성 (폴백용)
    this.createCharacterAnimations();

    // 게임 시간 매니저 (9시 시작)
    this.gameTimeManager = new GameTimeManager(9);

    // 캐릭터 매니저
    this.characterManager = new CharacterManager(this, this.gameTimeManager);

    // Effect Layer 생성 (depth: 300)
    this.createEffectLayer(worldWidth, worldHeight);

    // 카메라 설정 (맵 전체가 보이도록)
    // bounds를 맵보다 크게 설정하여 캐릭터 UI 요소들이 잘리지 않도록 함
    const padding = 64; // nameText, actionBubble 등을 위한 여유 공간
    this.cameras.main.setBounds(
      -padding,
      -padding,
      worldWidth + padding * 2,
      worldHeight + padding * 2
    );
    this.cameras.main.setZoom(1);
    this.cameras.main.scrollX = 0;
    this.cameras.main.scrollY = 0;

    // 카메라 culling 문제 방지를 위해 roundPixels 설정
    this.cameras.main.roundPixels = true;

    // UI Scene 시작
    this.scene.launch('OfficeUIScene');

    // 캐릭터 클릭 이벤트
    this.events.on('character-clicked', (character: Character) => {
      this.scene.get('OfficeUIScene').events.emit('show-character-info', character);
    });

    // GameBridge 연결
    this.bridge.connectScene(this);
    this.setupBridgeCommands();

    // WebSocket 연결 및 이벤트 구독
    this.bridge.connectWebSocket();
    this.setupSimulationEvents();

  }

  /**
   * Effect Layer 생성 (depth: 300~399)
   * 주야간 오버레이, 날씨 효과 등
   * Container 대신 직접 scene에 추가하여 depth 정렬 정상화
   */
  private createEffectLayer(worldWidth: number, worldHeight: number): void {
    // 주야간 오버레이 (alpha: 0으로 시작, 시간에 따라 변경)
    this.dayNightOverlay = this.add.rectangle(
      worldWidth / 2,
      worldHeight / 2,
      worldWidth,
      worldHeight,
      0x0a0a2e,
      0
    );
    this.dayNightOverlay.setName('DayNightOverlay');
    this.dayNightOverlay.setDepth(LAYER_DEPTH.EFFECT.DAY_NIGHT);

  }

  /**
   * 새 캐릭터 스프라이트 애니메이션 생성 (16x32)
   * 스프라이트시트: 384x224 → 24열 × 7행 (16x32 프레임)
   * - 행 0: idle 아래 (4프레임, 정면)
   * - 행 1: walk 아래 (cols 0-5, 정면) + walk 위 (cols 6-11, 뒷모습)
   * - 행 2: walk 오른쪽 (cols 0-5) + walk 왼쪽 (cols 6-11)
   * - 행 3-4: 특수 포즈
   * - 행 5: 추가 걷기 애니메이션
   * - 행 6: 특수 포즈
   */
  private createNewCharacterAnimations(): void {
    const framesPerRow = 24;

    for (const spriteKey of CHARACTER_SPRITES) {
      if (!this.textures.exists(spriteKey)) continue;

      // idle 아래 (행 0, cols 0-3)
      this.anims.create({
        key: `${spriteKey}_idle_down`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: 0,
          end: 3,
        }),
        frameRate: 4,
        repeat: -1,
      });

      // walk 아래 (행 1, cols 0-5)
      this.anims.create({
        key: `${spriteKey}_walk_down`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow,
          end: framesPerRow + 5,
        }),
        frameRate: 8,
        repeat: -1,
      });

      // idle 오른쪽 (행 2, cols 0-3)
      this.anims.create({
        key: `${spriteKey}_idle_right`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow * 2,
          end: framesPerRow * 2 + 3,
        }),
        frameRate: 4,
        repeat: -1,
      });

      // walk 오른쪽 (행 2, cols 0-5)
      this.anims.create({
        key: `${spriteKey}_walk_right`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow * 2,
          end: framesPerRow * 2 + 5,
        }),
        frameRate: 8,
        repeat: -1,
      });

      // idle 위 (행 1, cols 6-9)
      this.anims.create({
        key: `${spriteKey}_idle_up`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow + 6,
          end: framesPerRow + 9,
        }),
        frameRate: 4,
        repeat: -1,
      });

      // walk 위 (행 1, cols 6-11)
      this.anims.create({
        key: `${spriteKey}_walk_up`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow + 6,
          end: framesPerRow + 11,
        }),
        frameRate: 8,
        repeat: -1,
      });

      // idle 왼쪽 (행 2, cols 6-9)
      this.anims.create({
        key: `${spriteKey}_idle_left`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow * 2 + 6,
          end: framesPerRow * 2 + 9,
        }),
        frameRate: 4,
        repeat: -1,
      });

      // walk 왼쪽 (행 2, cols 6-11)
      this.anims.create({
        key: `${spriteKey}_walk_left`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: framesPerRow * 2 + 6,
          end: framesPerRow * 2 + 11,
        }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  /**
   * 기존 캐릭터 애니메이션 생성 (32x32, 폴백용)
   */
  private createCharacterAnimations(): void {
    // 캐릭터 타입별로 다른 행 사용 (0-7)
    // 각 캐릭터는 4방향 x 3프레임 애니메이션
    for (let charType = 0; charType < 8; charType++) {
      const baseFrame = charType * 12;

      // 아래 방향
      this.anims.create({
        key: `char${charType}_walk_down`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 0,
          end: baseFrame + 2,
        }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: `char${charType}_idle_down`,
        frames: [{ key: 'characters', frame: baseFrame + 1 }],
        frameRate: 1,
      });

      // 왼쪽 방향
      this.anims.create({
        key: `char${charType}_walk_left`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 3,
          end: baseFrame + 5,
        }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: `char${charType}_idle_left`,
        frames: [{ key: 'characters', frame: baseFrame + 4 }],
        frameRate: 1,
      });

      // 오른쪽 방향
      this.anims.create({
        key: `char${charType}_walk_right`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 6,
          end: baseFrame + 8,
        }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: `char${charType}_idle_right`,
        frames: [{ key: 'characters', frame: baseFrame + 7 }],
        frameRate: 1,
      });

      // 위 방향
      this.anims.create({
        key: `char${charType}_walk_up`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 9,
          end: baseFrame + 11,
        }),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: `char${charType}_idle_up`,
        frames: [{ key: 'characters', frame: baseFrame + 10 }],
        frameRate: 1,
      });
    }
  }

  /**
   * GameBridge 커맨드 핸들링 설정
   */
  private setupBridgeCommands(): void {
    this.events.on('bridge-command', (command: any) => {
      switch (command.type) {
        case 'CREATE_CHARACTER':
          if (command.payload) {
            const { name, occupation, spriteType, x, y } = command.payload;
            const avatarId = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'cyan', 'yellow'][spriteType] || 'blue';
            this.characterManager.createCharacter(name, occupation, avatarId, x, y);
          }
          break;

        case 'REMOVE_CHARACTER':
          if (command.payload?.characterId) {
            this.characterManager.removeCharacter(command.payload.characterId);
          }
          break;

        case 'PAUSE_GAME':
          this.pauseSimulation();
          break;

        case 'RESUME_GAME':
          this.resumeSimulation();
          break;

        case 'SET_TIME_SCALE':
          if (command.payload?.scale) {
            this.gameTimeManager.setSpeed(command.payload.scale);
          }
          break;
      }
    });
  }

  private debugLogTimer: number = 0;
  private debugLogInterval: number = 2000; // 2초마다 로그

  update(time: number, delta: number): void {
    // 일시정지가 아닐 때만 시뮬레이션 진행
    if (!this.gameTimeManager.getIsPaused()) {
      this.gameTimeManager.update();
      this.characterManager.update(time, delta);
      this.updateDayNightCycle();

      // GameBridge에 시간 업데이트
      this.bridge.updateGameTime(this.gameTimeManager.getTimeInfo());

      // depth 기준으로 정렬 강제 수행 (Graphics와 Container 간 정렬 보장)
      this.children.depthSort();

      // 디버깅 로그 (2초마다)
      this.debugLogTimer += delta;
      if (this.debugLogTimer >= this.debugLogInterval) {
        this.debugLogTimer = 0;
        this.logDebugInfo();
      }
    }
  }

  private logDebugInfo(): void {
    // Debug info disabled - press D key to trigger
  }

  pauseSimulation(): void {
    this.gameTimeManager.pause();
    this.time.paused = true;
    this.bridge.emit({
      type: 'GAME_PAUSED',
      payload: undefined,
      timestamp: Date.now(),
    });
  }

  resumeSimulation(): void {
    this.gameTimeManager.resume();
    this.time.paused = false;
    this.bridge.emit({
      type: 'GAME_RESUMED',
      payload: undefined,
      timestamp: Date.now(),
    });
  }

  private updateDayNightCycle(): void {
    const hour = this.gameTimeManager.getHour();
    let alpha = 0;
    let color = 0x0a0a2e;

    if (hour >= 21 || hour < 5) {
      // 밤
      alpha = 0.3;
      color = 0x0a0a2e;
    } else if (hour >= 5 && hour < 7) {
      // 새벽 -> 아침
      alpha = 0.3 * (7 - hour) / 2;
      color = 0x1a1040;
    } else if (hour >= 18 && hour < 21) {
      // 저녁
      alpha = 0.25 * (hour - 18) / 3;
      color = 0x2e1a0a;
    }
    // 낮 (7~18): alpha = 0

    this.dayNightOverlay.setFillStyle(color, alpha);
  }

  getCollisionRects(): Phaser.GameObjects.Rectangle[] {
    return this.mapRenderer.getCollisionRects();
  }

  /**
   * 사용 가능한 캐릭터 스프라이트 키 반환
   */
  static getCharacterSpriteKeys(): readonly string[] {
    return CHARACTER_SPRITES;
  }

  /**
   * 랜덤 캐릭터 스프라이트 키 반환
   */
  static getRandomCharacterSpriteKey(): CharacterSpriteKey {
    return CHARACTER_SPRITES[Math.floor(Math.random() * CHARACTER_SPRITES.length)];
  }

  /**
   * WebSocket simulation 이벤트 구독 설정
   */
  private setupSimulationEvents(): void {
    // simulation_action: 캐릭터 행동 업데이트
    this.wsUnsubscribers.push(
      this.bridge.onSimulationAction((msg) => {
        // Priority 3: 대화 중인 에이전트는 액션 건너뜀
        if (this.conversatingAgents.has(msg.agent_id)) {
          // skip action during conversation
          return;
        }

        // Fix 1C: 미등록 agent_id인 경우 자동 생성 (position이 있을 때만)
        let char = this.characterManager.getCharacterByAgentId(msg.agent_id);
        if (!char && msg.position) {
          char = this.characterManager.createFromBackend(msg.agent_id, undefined, msg.position.x, msg.position.y);
        }

        if (!char) {
          // no character found and no position to auto-create
          return;
        }

        // Fix 1A: applyBackendAction으로 position 유무에 관계없이 올바르게 처리
        if (msg.action) {
          const pos = msg.position ? { x: msg.position.x, y: msg.position.y } : undefined;
          this.characterManager.applyBackendAction(msg.agent_id, msg.action, pos);
        } else if (msg.position) {
          char.moveToTile(msg.position.x, msg.position.y);
        }
      })
    );

    // simulation_conversation: 대화 표시
    this.wsUnsubscribers.push(
      this.bridge.onSimulationConversation((msg) => {
        this.showConversationSequence(msg.agents, msg.dialogue);
      })
    );

    // simulation_reflection: 리플렉션 → 생각 버블 표시 (Priority 4)
    this.wsUnsubscribers.push(
      this.bridge.onSimulationReflection((msg) => {
        const char = this.characterManager.getCharacterByAgentId(msg.agent_id);
        if (char && msg.reflections.length > 0) {
          const thought = `(${msg.reflections[0]})`;
          char.setAction(thought);
        }
      })
    );

    // simulation_time: 시간 동기화
    this.wsUnsubscribers.push(
      this.bridge.onSimulationTime((msg) => {
        // Update local time display if backend sends time
        this.bridge.updateGameTime({
          hour: msg.hour,
          minute: msg.minute,
          day: msg.day,
          timeScale: msg.speed,
        });

        // Priority 4: paused 상태 동기화
        if (msg.paused && !this.gameTimeManager.getIsPaused()) {
          this.pauseSimulation();
        } else if (!msg.paused && this.gameTimeManager.getIsPaused()) {
          this.resumeSimulation();
        }
      })
    );

    // world_objects_update: 월드 오브젝트 상태 변경 (Priority 4)
    this.wsUnsubscribers.push(
      this.bridge.onWorldObjectsUpdate((msg) => {
      })
    );

    // state_sync: 전체 상태 동기화
    this.wsUnsubscribers.push(
      this.bridge.onStateSync((msg) => {
        for (const charData of msg.characters) {
          // Fix 1C: 미등록 agent_id 시 자동 생성
          let char = this.characterManager.getCharacterByAgentId(charData.agent_id);
          if (!char) {
            char = this.characterManager.createFromBackend(
              charData.agent_id,
              charData.name,
              charData.position?.x ?? 5,
              charData.position?.y ?? 5,
            );
          }

          if (charData.position) {
            char.moveToTile(charData.position.x, charData.position.y);
          }
          if (charData.action) {
            char.setAction(charData.action);
          }
        }
      })
    );

    // backend connection change: toggle backend-driven mode
    this.wsUnsubscribers.push(
      this.bridge.onBackendConnectionChange((connected) => {
        this.characterManager.setBackendDriven(connected);
      })
    );
  }

  /**
   * 대화 시퀀스 표시 (순차적으로 대사를 보여줌)
   * Priority 3: 대화 중 에이전트를 conversatingAgents에 등록하여 액션 오버라이드 방지
   */
  private showConversationSequence(
    agents: { id: string; name: string }[],
    dialogue: { speaker: string; text: string }[]
  ): void {
    // 대화 참여자 등록
    for (const agent of agents) {
      this.conversatingAgents.add(agent.id);
    }

    let delay = 0;
    const TURN_DELAY = 3000;

    for (const turn of dialogue) {
      const agent = agents.find((a) => a.name === turn.speaker || a.id === turn.speaker);
      if (!agent) continue;

      this.time.delayedCall(delay, () => {
        const char = this.characterManager.getCharacterByAgentId(agent.id);
        if (char) {
          char.showDialogue(turn.speaker, turn.text, TURN_DELAY - 500);
        }
      });

      delay += TURN_DELAY;
    }

    // 대화 시퀀스 완료 후 참여자 해제
    this.time.delayedCall(delay, () => {
      for (const agent of agents) {
        this.conversatingAgents.delete(agent.id);
      }
    });
  }

  /**
   * 씬 종료 시 정리
   */
  shutdown(): void {
    // WebSocket 구독 해제
    this.wsUnsubscribers.forEach((unsub) => unsub());
    this.wsUnsubscribers = [];

    this.bridge.disconnectWebSocket();
    this.bridge.disconnectScene();
  }
}
