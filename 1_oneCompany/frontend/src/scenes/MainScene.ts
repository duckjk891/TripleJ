import Phaser from 'phaser';
import { MapRenderer } from '../systems/MapRenderer';
import { CharacterManager } from '../systems/CharacterManager';
import { GameTimeManager } from '../systems/GameTimeManager';
import { MAP_CONFIG } from '../config/mapData';
import { Character } from '../entities/Character';

export class MainScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private cameraSpeed: number = 8;
  private mapRenderer!: MapRenderer;
  public characterManager!: CharacterManager;
  public gameTimeManager!: GameTimeManager;
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;

  constructor() {
    super({ key: 'MainScene' });
  }

  preload(): void {
    // 캐릭터 스프라이트 시트 로드
    // 이 스프라이트는 32x32 크기, 12열 x 8행 구조
    this.load.spritesheet('characters', '/assets/sprites/characters.png', {
      frameWidth: 32,
      frameHeight: 32
    });
  }

  create(): void {
    const worldWidth = MAP_CONFIG.width * MAP_CONFIG.tileSize;
    const worldHeight = MAP_CONFIG.height * MAP_CONFIG.tileSize;

    // 맵 렌더링
    this.mapRenderer = new MapRenderer(this);
    this.mapRenderer.render();

    // 캐릭터 애니메이션 생성
    this.createCharacterAnimations();

    // 게임 시간 매니저
    this.gameTimeManager = new GameTimeManager(6);

    // 캐릭터 매니저
    this.characterManager = new CharacterManager(this, this.gameTimeManager);

    // 주야간 오버레이
    this.dayNightOverlay = this.add.rectangle(
      worldWidth / 2, worldHeight / 2,
      worldWidth, worldHeight,
      0x0a0a2e, 0
    ).setDepth(300);

    // 카메라 설정
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setZoom(1);

    // 초기 카메라 위치
    this.cameras.main.scrollX = 0;
    this.cameras.main.scrollY = 0;

    // 키보드 입력
    this.cursors = this.input.keyboard!.createCursorKeys();

    // UI Scene 시작
    this.scene.launch('UIScene');

    // 마우스 드래그로 카메라 이동
    this.setupCameraDrag();

    // 월드 경계 표시
    this.createWorldBorder(worldWidth, worldHeight);

    // 캐릭터 클릭 이벤트
    this.events.on('character-clicked', (character: Character) => {
      this.scene.get('UIScene').events.emit('show-character-info', character);
    });

    console.log('MainScene created - Map and sprites loaded');
  }

  private createCharacterAnimations(): void {
    // 캐릭터 타입별로 다른 행 사용 (0-7)
    // 각 캐릭터는 4방향 x 3프레임 애니메이션
    for (let charType = 0; charType < 8; charType++) {
      const baseFrame = charType * 12;  // 각 캐릭터는 12프레임 (3프레임 x 4방향)

      // 아래 방향
      this.anims.create({
        key: `char${charType}_walk_down`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 0,
          end: baseFrame + 2
        }),
        frameRate: 8,
        repeat: -1
      });

      this.anims.create({
        key: `char${charType}_idle_down`,
        frames: [{ key: 'characters', frame: baseFrame + 1 }],
        frameRate: 1
      });

      // 왼쪽 방향
      this.anims.create({
        key: `char${charType}_walk_left`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 3,
          end: baseFrame + 5
        }),
        frameRate: 8,
        repeat: -1
      });

      this.anims.create({
        key: `char${charType}_idle_left`,
        frames: [{ key: 'characters', frame: baseFrame + 4 }],
        frameRate: 1
      });

      // 오른쪽 방향
      this.anims.create({
        key: `char${charType}_walk_right`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 6,
          end: baseFrame + 8
        }),
        frameRate: 8,
        repeat: -1
      });

      this.anims.create({
        key: `char${charType}_idle_right`,
        frames: [{ key: 'characters', frame: baseFrame + 7 }],
        frameRate: 1
      });

      // 위 방향
      this.anims.create({
        key: `char${charType}_walk_up`,
        frames: this.anims.generateFrameNumbers('characters', {
          start: baseFrame + 9,
          end: baseFrame + 11
        }),
        frameRate: 8,
        repeat: -1
      });

      this.anims.create({
        key: `char${charType}_idle_up`,
        frames: [{ key: 'characters', frame: baseFrame + 10 }],
        frameRate: 1
      });
    }
  }

  update(time: number, delta: number): void {
    // 방향키로 카메라 이동 (일시정지 중에도 작동)
    if (this.cursors.left.isDown) {
      this.cameras.main.scrollX -= this.cameraSpeed;
    }
    if (this.cursors.right.isDown) {
      this.cameras.main.scrollX += this.cameraSpeed;
    }
    if (this.cursors.up.isDown) {
      this.cameras.main.scrollY -= this.cameraSpeed;
    }
    if (this.cursors.down.isDown) {
      this.cameras.main.scrollY += this.cameraSpeed;
    }

    // 일시정지가 아닐 때만 시뮬레이션 진행
    if (!this.gameTimeManager.getIsPaused()) {
      this.gameTimeManager.update();
      this.characterManager.update(time, delta);
      this.updateDayNightCycle();
    }
  }

  pauseSimulation(): void {
    this.gameTimeManager.pause();
    this.time.paused = true;
  }

  resumeSimulation(): void {
    this.gameTimeManager.resume();
    this.time.paused = false;
  }

  private updateDayNightCycle(): void {
    const hour = this.gameTimeManager.getHour();
    let alpha = 0;
    let color = 0x0a0a2e;

    if (hour >= 21 || hour < 5) {
      // 밤
      alpha = 0.4;
      color = 0x0a0a2e;
    } else if (hour >= 5 && hour < 7) {
      // 새벽 → 아침 (점점 밝아짐)
      alpha = 0.4 * (7 - hour) / 2;
      color = 0x1a1040;
    } else if (hour >= 18 && hour < 21) {
      // 저녁 (점점 어두워짐)
      alpha = 0.35 * (hour - 18) / 3;
      color = 0x2e1a0a;
    }
    // 낮 (7~18): alpha = 0

    this.dayNightOverlay.setFillStyle(color, alpha);
  }

  private createWorldBorder(worldWidth: number, worldHeight: number): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(4, 0x333333, 1);
    graphics.strokeRect(0, 0, worldWidth, worldHeight);
  }

  private setupCameraDrag(): void {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let cameraStartX = 0;
    let cameraStartY = 0;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
        isDragging = true;
        dragStartX = pointer.x;
        dragStartY = pointer.y;
        cameraStartX = this.cameras.main.scrollX;
        cameraStartY = this.cameras.main.scrollY;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (isDragging) {
        const dx = dragStartX - pointer.x;
        const dy = dragStartY - pointer.y;
        this.cameras.main.scrollX = cameraStartX + dx;
        this.cameras.main.scrollY = cameraStartY + dy;
      }
    });

    this.input.on('pointerup', () => {
      isDragging = false;
    });

    this.input.on('wheel', (
      _pointer: Phaser.Input.Pointer,
      _gameObjects: any[],
      _deltaX: number,
      deltaY: number
    ) => {
      const zoom = this.cameras.main.zoom;
      const newZoom = deltaY > 0
        ? Math.max(0.5, zoom - 0.1)
        : Math.min(2, zoom + 0.1);
      this.cameras.main.setZoom(newZoom);
    });
  }

  getCollisionRects(): Phaser.GameObjects.Rectangle[] {
    return this.mapRenderer.getCollisionRects();
  }
}
