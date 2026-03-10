/**
 * Character Entity
 * 사무실 캐릭터 엔티티 - Modern_Interiors 에셋 사용
 * Adam, Alex, Amelia, Bob 중 랜덤 선택
 * GameBridge 연동
 */

import Phaser from 'phaser';
import { MAP_CONFIG } from '../config/gameConfig';
import { getAreaNameAt } from '../config/officeMapData';
import { GameBridge } from '../bridge/GameBridge';
import type { MovementRecord, CharacterData, CharacterBehaviorState, CharacterDirection } from '../types';

// 새로운 캐릭터 스프라이트 키
const NEW_CHARACTER_SPRITES = ['char_adam', 'char_alex', 'char_amelia', 'char_bob'] as const;
type NewCharacterSpriteKey = typeof NEW_CHARACTER_SPRITES[number];

export class Character extends Phaser.GameObjects.Container {
  public characterId: string;
  public characterName: string;
  public occupation: string;
  public currentAction: string = 'Standing';
  public spriteType: number;
  public behaviorState: CharacterBehaviorState = 'idle';
  public onArrival: (() => void) | null = null;

  /** 새 스프라이트 키 (char_adam, char_alex 등) */
  public spriteKey: NewCharacterSpriteKey;

  private sprite!: Phaser.GameObjects.Sprite;
  private nameText!: Phaser.GameObjects.Text;
  private actionBubble!: Phaser.GameObjects.Container;
  private actionText!: Phaser.GameObjects.Text;

  private targetX: number | null = null;
  private targetY: number | null = null;
  private moveSpeed: number = 80;
  private isMoving: boolean = false;
  private direction: CharacterDirection = 'down';

  private pathQueue: { x: number; y: number }[] = [];
  private movementHistory: MovementRecord[] = [];
  private maxHistoryLength: number = 10;

  /** 새 스프라이트 사용 여부 */
  private useNewSprite: boolean = false;

  /** 게임 시간 문자열 제공자 (외부에서 주입) */
  public getGameTimeString: (() => string) | null = null;

  /** GameBridge 참조 */
  private bridge: GameBridge;

  constructor(scene: Phaser.Scene, data: CharacterData) {
    super(
      scene,
      data.x * MAP_CONFIG.tileSize + MAP_CONFIG.tileSize / 2,
      data.y * MAP_CONFIG.tileSize + MAP_CONFIG.tileSize / 2
    );

    this.characterId = data.id;
    this.characterName = data.name;
    this.occupation = data.occupation;
    this.spriteType = data.spriteType;
    this.bridge = GameBridge.getInstance();

    // 새 스프라이트 키 할당 (spriteType 기반 또는 랜덤)
    this.spriteKey = NEW_CHARACTER_SPRITES[data.spriteType % NEW_CHARACTER_SPRITES.length];

    // 새 스프라이트 사용 가능 여부 확인
    this.useNewSprite = scene.textures.exists(this.spriteKey);

    this.createVisuals();
    this.setupInteraction();

    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(12);
    body.setOffset(-12, -12);

    // 캐릭터가 맵 오브젝트 위에 표시되도록 높은 depth 설정
    this.setDepth(500);

    // 초기 애니메이션
    this.playIdleAnimation();

    // 초기 기록 추가
    this.addMovementRecord('Appeared');

    // GameBridge에 캐릭터 등록
    this.bridge.addCharacter({
      id: this.characterId,
      name: this.characterName,
      occupation: this.occupation,
      spriteType: this.spriteType,
      x: data.x,
      y: data.y,
      behaviorState: this.behaviorState,
      direction: this.direction,
      currentAction: this.currentAction,
      isMoving: this.isMoving,
    });
  }

  private createVisuals(): void {
    // 캐릭터 스프라이트
    if (this.useNewSprite) {
      // 새 스프라이트 사용 (16x16, 스케일 2배)
      this.sprite = this.scene.add.sprite(0, 0, this.spriteKey);
      this.sprite.setScale(2); // 16x16 -> 32x32
    } else {
      // 기존 스프라이트 사용
      this.sprite = this.scene.add.sprite(0, 0, 'characters');
      this.sprite.setScale(1);
    }
    this.add(this.sprite);

    // 이름 표시 (머리 위로 더 높이 배치)
    this.nameText = this.scene.add.text(0, -40, this.characterName, {
      fontSize: '9px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 3, y: 1 },
    }).setOrigin(0.5);
    this.add(this.nameText);

    // 행동 말풍선
    this.createActionBubble();
  }

  private createActionBubble(): void {
    this.actionBubble = this.scene.add.container(0, -56);

    const bg = this.scene.add.graphics();
    this.updateBubbleBackground(bg, this.currentAction);
    this.actionBubble.add(bg);

    this.actionText = this.scene.add.text(0, 0, this.currentAction, {
      fontSize: '9px',
      color: '#333333',
    }).setOrigin(0.5);
    this.actionBubble.add(this.actionText);

    this.add(this.actionBubble);
  }

  private updateBubbleBackground(bg: Phaser.GameObjects.Graphics, text: string): void {
    const padding = 8;
    const textWidth = text.length * 6 + padding * 2;

    bg.clear();
    bg.fillStyle(0xffffff, 0.95);
    bg.fillRoundedRect(-textWidth / 2, -10, textWidth, 20, 6);
    bg.lineStyle(1, 0x888888, 1);
    bg.strokeRoundedRect(-textWidth / 2, -10, textWidth, 20, 6);
    bg.fillStyle(0xffffff, 0.95);
    bg.fillTriangle(0, 10, -4, 5, 4, 5);
  }

  private setupInteraction(): void {
    this.setSize(32, 32);
    this.setInteractive({ useHandCursor: true });

    this.on('pointerover', () => {
      this.sprite.setTint(0xffffaa);
    });

    this.on('pointerout', () => {
      this.sprite.clearTint();
    });

    this.on('pointerdown', () => {
      this.scene.events.emit('character-clicked', this);
      // GameBridge로 클릭 이벤트 전파
      this.bridge.emit({
        type: 'CHARACTER_CLICKED',
        payload: {
          characterId: this.characterId,
          character: this.getState(),
        },
        timestamp: Date.now(),
      });
    });
  }

  private playIdleAnimation(): void {
    if (this.useNewSprite) {
      // 새 스프라이트 애니메이션
      const animKey = `${this.spriteKey}_idle_${this.direction}`;
      if (this.scene.anims.exists(animKey)) {
        this.sprite.play(animKey);
        // 왼쪽 방향은 flipX 사용
        this.sprite.setFlipX(this.direction === 'left');
      }
    } else {
      // 기존 스프라이트 애니메이션
      const animKey = `char${this.spriteType}_idle_${this.direction}`;
      if (this.scene.anims.exists(animKey)) {
        this.sprite.play(animKey);
      }
    }
  }

  private playWalkAnimation(): void {
    if (this.useNewSprite) {
      // 새 스프라이트 애니메이션
      const animKey = `${this.spriteKey}_walk_${this.direction}`;
      if (this.scene.anims.exists(animKey)) {
        this.sprite.play(animKey);
        // 왼쪽 방향은 flipX 사용
        this.sprite.setFlipX(this.direction === 'left');
      }
    } else {
      // 기존 스프라이트 애니메이션
      const animKey = `char${this.spriteType}_walk_${this.direction}`;
      if (this.scene.anims.exists(animKey)) {
        this.sprite.play(animKey);
      }
    }
  }

  update(_time: number, delta: number): void {
    if (this.isMoving && this.targetX !== null && this.targetY !== null) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 2) {
        this.x = this.targetX;
        this.y = this.targetY;
        this.targetX = null;
        this.targetY = null;
        this.isMoving = false;

        if (this.pathQueue.length > 0) {
          const next = this.pathQueue.shift()!;
          this.moveToTile(next.x, next.y);
        } else {
          this.playIdleAnimation();
          this.addMovementRecord('Arrived');
          if (this.onArrival) {
            const cb = this.onArrival;
            this.onArrival = null;
            cb();
          } else {
            this.setAction('Standing', false);
            this.behaviorState = 'idle';
          }
        }
        this.updateBridgeState();
      } else {
        // 방향 결정
        const prevDirection = this.direction;
        if (Math.abs(dx) > Math.abs(dy)) {
          this.direction = dx > 0 ? 'right' : 'left';
        } else {
          this.direction = dy > 0 ? 'down' : 'up';
        }

        // 방향 변경 시 애니메이션 업데이트
        if (prevDirection !== this.direction) {
          this.playWalkAnimation();
        }

        const moveX = (dx / distance) * this.moveSpeed * (delta / 1000);
        const moveY = (dy / distance) * this.moveSpeed * (delta / 1000);
        this.x += moveX;
        this.y += moveY;
      }
    }
  }

  moveToTile(tileX: number, tileY: number): void {
    this.targetX = tileX * MAP_CONFIG.tileSize + MAP_CONFIG.tileSize / 2;
    this.targetY = tileY * MAP_CONFIG.tileSize + MAP_CONFIG.tileSize / 2;
    this.isMoving = true;
    this.setAction('Walking', false);
    this.playWalkAnimation();
    this.updateBridgeState();
  }

  followPath(path: { x: number; y: number }[]): void {
    if (path.length === 0) return;

    this.pathQueue = path.slice(1);
    const first = path[0];
    this.moveToTile(first.x, first.y);
  }

  getIsMoving(): boolean {
    return this.isMoving;
  }

  moveToRandomNearby(): void {
    const currentTileX = Math.floor(this.x / MAP_CONFIG.tileSize);
    const currentTileY = Math.floor(this.y / MAP_CONFIG.tileSize);

    const offsetX = Phaser.Math.Between(-2, 2);
    const offsetY = Phaser.Math.Between(-2, 2);

    const newTileX = Phaser.Math.Clamp(currentTileX + offsetX, 1, MAP_CONFIG.width - 2);
    const newTileY = Phaser.Math.Clamp(currentTileY + offsetY, 1, MAP_CONFIG.height - 2);

    this.moveToTile(newTileX, newTileY);
  }

  setAction(action: string, recordHistory: boolean = true): void {
    this.currentAction = action;
    this.actionText.setText(action);

    const bg = this.actionBubble.getAt(0) as Phaser.GameObjects.Graphics;
    this.updateBubbleBackground(bg, action);

    if (recordHistory) {
      this.addMovementRecord(action);
    }

    this.updateBridgeState();
  }

  getInfo(): CharacterData {
    return {
      id: this.characterId,
      name: this.characterName,
      occupation: this.occupation,
      spriteType: this.spriteType,
      x: Math.floor(this.x / MAP_CONFIG.tileSize),
      y: Math.floor(this.y / MAP_CONFIG.tileSize),
    };
  }

  getTilePosition(): { x: number; y: number } {
    return {
      x: Math.floor(this.x / MAP_CONFIG.tileSize),
      y: Math.floor(this.y / MAP_CONFIG.tileSize),
    };
  }

  // avatarColor getter (UI 호환용)
  get avatarColor(): number {
    const colors = [0x4a90d9, 0xd94a4a, 0x4ad94a, 0x9b4ad9, 0xd9944a, 0xd94a90, 0x4ad9d9, 0xd9d94a];
    return colors[this.spriteType % colors.length];
  }

  getCurrentAreaName(): string {
    const tileX = Math.floor(this.x / MAP_CONFIG.tileSize);
    const tileY = Math.floor(this.y / MAP_CONFIG.tileSize);
    return getAreaNameAt(tileX, tileY);
  }

  addMovementRecord(action: string): void {
    let time: string;
    if (this.getGameTimeString) {
      time = this.getGameTimeString();
    } else {
      const now = new Date();
      time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
    const location = this.getCurrentAreaName();

    this.movementHistory.unshift({ time, action, location });

    if (this.movementHistory.length > this.maxHistoryLength) {
      this.movementHistory.pop();
    }
  }

  getMovementHistory(): MovementRecord[] {
    return this.movementHistory;
  }

  /**
   * 캐릭터 전체 상태 반환
   */
  getState() {
    return {
      id: this.characterId,
      name: this.characterName,
      occupation: this.occupation,
      spriteType: this.spriteType,
      spriteKey: this.spriteKey,
      x: Math.floor(this.x / MAP_CONFIG.tileSize),
      y: Math.floor(this.y / MAP_CONFIG.tileSize),
      behaviorState: this.behaviorState,
      direction: this.direction,
      currentAction: this.currentAction,
      isMoving: this.isMoving,
    };
  }

  /**
   * GameBridge 상태 업데이트
   */
  private updateBridgeState(): void {
    this.bridge.updateCharacterState(this.characterId, this.getState());
  }

  /**
   * 스프라이트 키 반환
   */
  getSpriteKey(): string {
    return this.spriteKey;
  }

  /**
   * 새 스프라이트 사용 여부 반환
   */
  isUsingNewSprite(): boolean {
    return this.useNewSprite;
  }

  /**
   * 캐릭터 제거 시 정리
   */
  destroy(fromScene?: boolean): void {
    this.bridge.removeCharacter(this.characterId);
    super.destroy(fromScene);
  }
}
