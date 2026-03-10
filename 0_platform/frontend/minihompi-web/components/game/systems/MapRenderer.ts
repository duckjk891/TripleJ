/**
 * MapRenderer
 * 사무실 맵 렌더링 시스템 - 이미지 에셋 기반
 * Room_Builder + Interiors 타일셋 사용
 */

import Phaser from 'phaser';
import { MAP_CONFIG, LAYER_DEPTH, calculateEntityDepth } from '../config/gameConfig';
import {
  FLOOR_LAYER,
  OBJECT_LAYER,
  COLLISION_LAYER,
  OBJECT_TYPE,
  OFFICE_AREAS,
} from '../config/officeMapData';

/**
 * Room_Builder_free_32x32.png 타일 인덱스
 * 이미지 크기: 544x736 = 17열 x 23행
 */
const ROOM_TILES = {
  // 나무 바닥 (row 7-8, 갈색 수평 줄무늬)
  WOOD_FLOOR_1: 119,  // row 7, col 0
  WOOD_FLOOR_2: 120,  // row 7, col 1
  WOOD_FLOOR_3: 121,  // row 7, col 2

  // 어두운 나무 바닥 (row 9)
  WOOD_DARK_1: 153,   // row 9, col 0
  WOOD_DARK_2: 154,   // row 9, col 1

  // 회색 타일 바닥 (오른쪽 영역)
  TILE_GRAY_1: 180,
  TILE_GRAY_2: 181,

  // 베이지 카펫 (row 13-14)
  CARPET_1: 221,
  CARPET_2: 222,

  // 벽 관련 (상단 영역)
  WALL_DARK: 51,     // 어두운 벽
};

/**
 * Interiors_free_32x32.png 타일 인덱스
 * 이미지 크기: 512x2848 = 16열 x 89행
 */
const INTERIOR_TILES = {
  // 책상 (상단 영역, 갈색)
  DESK_LEFT: 48,
  DESK_MID: 49,
  DESK_RIGHT: 50,

  // 의자
  CHAIR_GREEN: 288,    // 녹색 의자
  CHAIR_PINK: 304,     // 분홍 의자

  // 컴퓨터/모니터
  COMPUTER: 64,
  MONITOR: 65,

  // 식물
  PLANT_SMALL: 432,
  PLANT_LARGE: 448,
  PLANT_POT: 464,

  // 소파
  SOFA_LEFT: 368,
  SOFA_MID: 369,
  SOFA_RIGHT: 370,

  // 테이블
  TABLE_SMALL: 320,
  TABLE_COFFEE: 336,

  // 책장
  BOOKSHELF_1: 192,
  BOOKSHELF_2: 208,

  // 자판기/커피머신
  VENDING: 528,
  COFFEE_MACHINE: 544,

  // 화이트보드
  WHITEBOARD: 240,
};

export class MapRenderer {
  private scene: Phaser.Scene;
  private collisionRects: Phaser.GameObjects.Rectangle[] = [];
  private floorTiles: Phaser.GameObjects.Image[] = [];
  private objectSprites: (Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle)[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  render(): void {
    const { width, height, tileSize } = MAP_CONFIG;
    const worldWidth = width * tileSize;
    const worldHeight = height * tileSize;

    // 1. 배경색 (외부/벽)
    this.renderBackground(worldWidth, worldHeight);

    // 2. 바닥 타일 (이미지)
    this.renderFloorTiles();

    // 3. 영역 라벨
    this.renderAreaLabels();

    // 4. 오브젝트 (이미지 + Y-sorting)
    this.renderObjects();

    // 5. 충돌 영역 (보이지 않음)
    this.createCollisionRects();

    // 6. 테두리
    this.renderWorldBorder(worldWidth, worldHeight);

  }

  /**
   * 배경색 렌더링 (맵 외부 - 어두운 색)
   */
  private renderBackground(worldWidth: number, worldHeight: number): void {
    const bg = this.scene.add.rectangle(
      worldWidth / 2,
      worldHeight / 2,
      worldWidth,
      worldHeight,
      0x1a1a2e  // 어두운 파란색 (참고 이미지와 유사)
    );
    bg.setDepth(LAYER_DEPTH.GROUND.BACKGROUND);
  }

  /**
   * 바닥 타일 렌더링 (이미지 기반)
   */
  private renderFloorTiles(): void {
    const { tileSize } = MAP_CONFIG;

    for (let y = 0; y < FLOOR_LAYER.length; y++) {
      for (let x = 0; x < FLOOR_LAYER[y].length; x++) {
        const tileValue = FLOOR_LAYER[y][x];
        if (tileValue === 0) continue;

        const posX = x * tileSize + tileSize / 2;
        const posY = y * tileSize + tileSize / 2;

        // 영역별 다른 바닥 타일 사용
        const frameIndex = this.getFloorTileIndex(x, y);

        try {
          const tile = this.scene.add.image(posX, posY, 'tiles_room', frameIndex);
          tile.setDepth(LAYER_DEPTH.GROUND.FLOOR);
          this.floorTiles.push(tile);
        } catch (e) {
          // 이미지 로드 실패 시 단색으로 대체
          const color = this.getFloorColorFallback(x, y);
          const rect = this.scene.add.rectangle(posX, posY, tileSize - 1, tileSize - 1, color);
          rect.setDepth(LAYER_DEPTH.GROUND.FLOOR);
        }
      }
    }
  }

  /**
   * 좌표에 따른 바닥 타일 인덱스 결정
   */
  private getFloorTileIndex(x: number, y: number): number {
    // Work Area (왼쪽) - 나무 바닥
    if (x >= 1 && x <= 7 && y >= 1 && y <= 8) {
      return ((x + y) % 2 === 0) ? ROOM_TILES.WOOD_FLOOR_1 : ROOM_TILES.WOOD_FLOOR_2;
    }

    // Hallway (중앙 통로) - 어두운 나무
    if (x >= 8 && x <= 11 && y >= 1 && y <= 8) {
      return ((x + y) % 2 === 0) ? ROOM_TILES.WOOD_DARK_1 : ROOM_TILES.WOOD_DARK_2;
    }

    // Break Area (오른쪽 위) - 베이지 카펫
    if (x >= 12 && x <= 18 && y >= 1 && y <= 4) {
      return ((x + y) % 2 === 0) ? ROOM_TILES.CARPET_1 : ROOM_TILES.CARPET_2;
    }

    // Meeting Area (오른쪽 아래) - 회색 타일
    if (x >= 12 && x <= 18 && y >= 5 && y <= 8) {
      return ((x + y) % 2 === 0) ? ROOM_TILES.TILE_GRAY_1 : ROOM_TILES.TILE_GRAY_2;
    }

    return ROOM_TILES.WOOD_FLOOR_1;
  }

  /**
   * 바닥 색상 폴백 (이미지 로드 실패 시)
   */
  private getFloorColorFallback(x: number, y: number): number {
    if (x >= 1 && x <= 7) return 0xd4a574;      // 나무색
    if (x >= 8 && x <= 11) return 0xb8b8b8;    // 회색
    if (x >= 12 && y <= 4) return 0xc9b896;    // 베이지
    return 0xa8c8a8;                            // 연녹색
  }

  /**
   * 영역 라벨 렌더링
   */
  private renderAreaLabels(): void {
    const { tileSize } = MAP_CONFIG;

    for (const area of OFFICE_AREAS) {
      const x = area.x * tileSize + 4;
      const y = area.y * tileSize + 4;

      const text = this.scene.add.text(x, y, area.name, {
        fontSize: '10px',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 2 },
      });
      text.setDepth(LAYER_DEPTH.GROUND.AREA_LABELS);
    }
  }

  /**
   * 오브젝트 렌더링 (이미지 + Y-sorting)
   */
  private renderObjects(): void {
    const { tileSize } = MAP_CONFIG;

    for (let y = 0; y < OBJECT_LAYER.length; y++) {
      for (let x = 0; x < OBJECT_LAYER[y].length; x++) {
        const objectType = OBJECT_LAYER[y][x];
        if (objectType === OBJECT_TYPE.NONE) continue;

        const posX = x * tileSize + tileSize / 2;
        const posY = y * tileSize + tileSize / 2;

        const obj = this.createObject(objectType, posX, posY);
        if (obj) {
          // Y-sorting 적용
          if (objectType === OBJECT_TYPE.WALL) {
            obj.setDepth(LAYER_DEPTH.ENTITY.BASE);
          } else {
            obj.setDepth(calculateEntityDepth(posY));
          }
          this.objectSprites.push(obj);
        }
      }
    }
  }

  /**
   * 오브젝트 생성 (이미지 우선, 실패 시 단색)
   */
  private createObject(
    objectType: number,
    posX: number,
    posY: number
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null {

    // 벽은 단색으로 처리
    if (objectType === OBJECT_TYPE.WALL) {
      const wall = this.scene.add.rectangle(posX, posY, 32, 32, 0x3d3d5c);
      return wall;
    }

    // 가구는 이미지로 시도
    const frameIndex = this.getObjectFrameIndex(objectType);
    const fallbackColor = this.getObjectFallbackColor(objectType);

    try {
      const sprite = this.scene.add.image(posX, posY, 'tiles_interior', frameIndex);
      return sprite;
    } catch (e) {
      // 이미지 실패 시 단색
      const rect = this.scene.add.rectangle(posX, posY, 28, 28, fallbackColor);
      rect.setStrokeStyle(1, 0x000000, 0.3);
      return rect;
    }
  }

  /**
   * 오브젝트 타입별 프레임 인덱스
   */
  private getObjectFrameIndex(objectType: number): number {
    switch (objectType) {
      case OBJECT_TYPE.DESK:
        return INTERIOR_TILES.DESK_MID;
      case OBJECT_TYPE.CHAIR:
        return INTERIOR_TILES.CHAIR_GREEN;
      case OBJECT_TYPE.MONITOR:
        return INTERIOR_TILES.COMPUTER;
      case OBJECT_TYPE.PLANT:
        return INTERIOR_TILES.PLANT_POT;
      case OBJECT_TYPE.SOFA:
        return INTERIOR_TILES.SOFA_MID;
      case OBJECT_TYPE.COFFEE_TABLE:
        return INTERIOR_TILES.TABLE_COFFEE;
      case OBJECT_TYPE.COFFEE_MACHINE:
        return INTERIOR_TILES.VENDING;
      case OBJECT_TYPE.MEETING_TABLE:
        return INTERIOR_TILES.TABLE_SMALL;
      case OBJECT_TYPE.WHITEBOARD:
        return INTERIOR_TILES.WHITEBOARD;
      default:
        return 0;
    }
  }

  /**
   * 오브젝트 폴백 색상
   */
  private getObjectFallbackColor(objectType: number): number {
    const colors: Record<number, number> = {
      [OBJECT_TYPE.DESK]: 0x8B5A2B,
      [OBJECT_TYPE.CHAIR]: 0x228B22,
      [OBJECT_TYPE.MONITOR]: 0x1a1a2e,
      [OBJECT_TYPE.PLANT]: 0x228B22,
      [OBJECT_TYPE.SOFA]: 0x4a4a8a,
      [OBJECT_TYPE.COFFEE_TABLE]: 0xa0522d,
      [OBJECT_TYPE.COFFEE_MACHINE]: 0x696969,
      [OBJECT_TYPE.MEETING_TABLE]: 0x5c4033,
      [OBJECT_TYPE.WHITEBOARD]: 0xf5f5f5,
    };
    return colors[objectType] || 0x888888;
  }

  /**
   * 테두리 렌더링
   */
  private renderWorldBorder(worldWidth: number, worldHeight: number): void {
    const border = this.scene.add.rectangle(
      worldWidth / 2,
      worldHeight / 2,
      worldWidth,
      worldHeight
    );
    border.setStrokeStyle(3, 0x7b5ea7);
    border.setFillStyle(0x000000, 0);
    border.setDepth(LAYER_DEPTH.GROUND.BORDER);
  }

  /**
   * 충돌 영역 생성 (보이지 않음)
   */
  private createCollisionRects(): void {
    const { tileSize } = MAP_CONFIG;

    for (let y = 0; y < COLLISION_LAYER.length; y++) {
      for (let x = 0; x < COLLISION_LAYER[y].length; x++) {
        if (COLLISION_LAYER[y][x] === 1) {
          const posX = x * tileSize + tileSize / 2;
          const posY = y * tileSize + tileSize / 2;

          const rect = this.scene.add.rectangle(
            posX, posY,
            tileSize, tileSize,
            0xff0000, 0  // 투명
          );
          rect.setDepth(LAYER_DEPTH.ENTITY.COLLISION);
          this.scene.physics.add.existing(rect, true);
          this.collisionRects.push(rect);
        }
      }
    }
  }

  getCollisionRects(): Phaser.GameObjects.Rectangle[] {
    return this.collisionRects;
  }
}
