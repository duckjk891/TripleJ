import Phaser from 'phaser';
import { MAP_CONFIG, AREAS, AreaDefinition } from '../config/mapData';

export interface MovementRecord {
  time: string;
  action: string;
  location: string;
}

export interface CharacterData {
  id: string;
  name: string;
  occupation: string;
  spriteType: number;  // 0-7 캐릭터 타입
  x: number;
  y: number;
}

export class Character extends Phaser.GameObjects.Container {
  public characterId: string;
  public characterName: string;
  public occupation: string;
  public currentAction: string = '서 있는 중';
  public spriteType: number;
  public behaviorState: 'idle' | 'moving' | 'acting' | 'talking' = 'idle';
  public onArrival: (() => void) | null = null;

  private sprite!: Phaser.GameObjects.Sprite;
  private nameText!: Phaser.GameObjects.Text;
  private actionBubble!: Phaser.GameObjects.Container;
  private actionText!: Phaser.GameObjects.Text;

  private targetX: number | null = null;
  private targetY: number | null = null;
  private moveSpeed: number = 80;
  private isMoving: boolean = false;
  private direction: 'up' | 'down' | 'left' | 'right' = 'down';

  private pathQueue: { x: number; y: number }[] = [];
  private movementHistory: MovementRecord[] = [];
  private maxHistoryLength: number = 10;

  /** 게임 시간 문자열 제공자 (외부에서 주입) */
  public getGameTimeString: (() => string) | null = null;

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

    this.createVisuals();
    this.setupInteraction();

    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(12);
    body.setOffset(-12, -12);

    this.setDepth(200);

    // 초기 애니메이션
    this.playIdleAnimation();

    // 초기 기록 추가
    this.addMovementRecord('등장');
  }

  private createVisuals(): void {
    // 캐릭터 스프라이트
    this.sprite = this.scene.add.sprite(0, 0, 'characters');
    this.sprite.setScale(1);
    this.add(this.sprite);

    // 이름 표시
    this.nameText = this.scene.add.text(0, -28, this.characterName, {
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5);
    this.add(this.nameText);

    // 행동 말풍선
    this.createActionBubble();
  }

  private createActionBubble(): void {
    this.actionBubble = this.scene.add.container(0, -48);

    const bg = this.scene.add.graphics();
    this.updateBubbleBackground(bg, this.currentAction);
    this.actionBubble.add(bg);

    this.actionText = this.scene.add.text(0, 0, this.currentAction, {
      fontSize: '10px',
      color: '#333333'
    }).setOrigin(0.5);
    this.actionBubble.add(this.actionText);

    this.add(this.actionBubble);
  }

  private updateBubbleBackground(bg: Phaser.GameObjects.Graphics, text: string): void {
    const padding = 10;
    const textWidth = text.length * 7 + padding * 2;

    bg.clear();
    bg.fillStyle(0xffffff, 0.95);
    bg.fillRoundedRect(-textWidth / 2, -12, textWidth, 24, 8);
    bg.lineStyle(1, 0x888888, 1);
    bg.strokeRoundedRect(-textWidth / 2, -12, textWidth, 24, 8);
    bg.fillStyle(0xffffff, 0.95);
    bg.fillTriangle(0, 12, -5, 6, 5, 6);
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
    });
  }

  private playIdleAnimation(): void {
    const animKey = `char${this.spriteType}_idle_${this.direction}`;
    if (this.scene.anims.exists(animKey)) {
      this.sprite.play(animKey);
    }
  }

  private playWalkAnimation(): void {
    const animKey = `char${this.spriteType}_walk_${this.direction}`;
    if (this.scene.anims.exists(animKey)) {
      this.sprite.play(animKey);
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
          this.addMovementRecord('도착');
          if (this.onArrival) {
            const cb = this.onArrival;
            this.onArrival = null;
            cb();
          } else {
            this.setAction('서 있는 중', false);
            this.behaviorState = 'idle';
          }
        }
      } else {
        // 방향 결정
        if (Math.abs(dx) > Math.abs(dy)) {
          this.direction = dx > 0 ? 'right' : 'left';
        } else {
          this.direction = dy > 0 ? 'down' : 'up';
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
    this.setAction('걷는 중', false);  // 이동 중은 기록하지 않음
    this.playWalkAnimation();
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

    const offsetX = Phaser.Math.Between(-3, 3);
    const offsetY = Phaser.Math.Between(-3, 3);

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
  }

  getInfo(): CharacterData {
    return {
      id: this.characterId,
      name: this.characterName,
      occupation: this.occupation,
      spriteType: this.spriteType,
      x: Math.floor(this.x / MAP_CONFIG.tileSize),
      y: Math.floor(this.y / MAP_CONFIG.tileSize)
    };
  }

  getTilePosition(): { x: number; y: number } {
    return {
      x: Math.floor(this.x / MAP_CONFIG.tileSize),
      y: Math.floor(this.y / MAP_CONFIG.tileSize)
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

    // 영역 찾기 (자식 영역 우선)
    for (const area of AREAS) {
      if (this.isInArea(tileX, tileY, area)) {
        // 자식 영역 확인
        if (area.children) {
          for (const child of area.children) {
            if (child.type !== 'object' && this.isInArea(tileX, tileY, child)) {
              return `${area.name} > ${child.name}`;
            }
          }
        }
        return area.name;
      }
    }
    return '야외';
  }

  private isInArea(tileX: number, tileY: number, area: AreaDefinition): boolean {
    return tileX >= area.x &&
           tileX < area.x + area.width &&
           tileY >= area.y &&
           tileY < area.y + area.height;
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
}
