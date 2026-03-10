/**
 * MapRenderer
 * 타일맵 기반 사무실 맵 렌더링 시스템
 * 단일 Graphics 객체 사용으로 depth 문제 해결
 */

import Phaser from 'phaser';
import { MAP_CONFIG } from '../config/gameConfig';
import {
  FLOOR_LAYER,
  OBJECT_LAYER,
  COLLISION_LAYER,
  OBJECT_TYPE,
  OFFICE_AREAS,
} from '../config/officeMapData';

export class MapRenderer {
  private scene: Phaser.Scene;
  private collisionRects: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  render(): void {
    const { width, height, tileSize } = MAP_CONFIG;
    const worldWidth = width * tileSize;
    const worldHeight = height * tileSize;

    // 1. 배경 (depth: 0)
    this.renderBackground(worldWidth, worldHeight);

    // 2. 바닥 (depth: 1) - 단일 Graphics 객체
    this.renderFloorLayer();

    // 3. 오브젝트 (depth: 10) - 단일 Graphics 객체
    this.renderObjectLayer();

    // 4. 충돌 영역
    this.createCollisionRects();

    // 5. 영역 라벨 (depth: 50)
    this.renderAreaLabels();

    // 6. 테두리 (depth: 60)
    this.renderWorldBorder(worldWidth, worldHeight);
  }

  private renderBackground(worldWidth: number, worldHeight: number): void {
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(0x2a2a2a, 1);
    graphics.fillRect(0, 0, worldWidth, worldHeight);
    graphics.setDepth(0);
  }

  /**
   * 바닥 레이어 - 단일 Graphics 객체 사용
   */
  private renderFloorLayer(): void {
    const { tileSize } = MAP_CONFIG;
    const graphics = this.scene.add.graphics();

    for (let y = 0; y < FLOOR_LAYER.length; y++) {
      for (let x = 0; x < FLOOR_LAYER[y].length; x++) {
        const tileValue = FLOOR_LAYER[y][x];
        if (tileValue === 0) continue;

        const posX = x * tileSize;
        const posY = y * tileSize;

        // 영역별 바닥 색상
        let floorColor = 0x9b8465;

        if (x >= 1 && x <= 10 && y >= 1 && y <= 8) {
          // Work Area
          floorColor = ((x + y) % 2 === 0) ? 0x9b8465 : 0x8a7556;
        } else if (x >= 12 && x <= 18 && y >= 1 && y <= 4) {
          // Break Area
          floorColor = ((x + y) % 2 === 0) ? 0xc9b896 : 0xb8a785;
        } else if (x >= 12 && x <= 18 && y >= 6 && y <= 8) {
          // Meeting Area
          floorColor = ((x + y) % 2 === 0) ? 0x7a9b6d : 0x698a5c;
        } else {
          floorColor = 0x555555;
        }

        graphics.fillStyle(floorColor, 1);
        graphics.fillRect(posX, posY, tileSize, tileSize);
        graphics.lineStyle(1, 0x000000, 0.1);
        graphics.strokeRect(posX, posY, tileSize, tileSize);
      }
    }

    graphics.setDepth(1);
  }

  /**
   * 오브젝트 레이어 - 단일 Graphics 객체 사용
   */
  private renderObjectLayer(): void {
    const { tileSize } = MAP_CONFIG;
    const graphics = this.scene.add.graphics();

    for (let y = 0; y < OBJECT_LAYER.length; y++) {
      for (let x = 0; x < OBJECT_LAYER[y].length; x++) {
        const objectType = OBJECT_LAYER[y][x];
        if (objectType === OBJECT_TYPE.NONE) continue;

        const posX = x * tileSize;
        const posY = y * tileSize;

        this.drawObject(graphics, objectType, posX, posY, tileSize);
      }
    }

    graphics.setDepth(10);
  }

  /**
   * 개별 오브젝트 그리기
   */
  private drawObject(graphics: Phaser.GameObjects.Graphics, objectType: number, posX: number, posY: number, tileSize: number): void {
    switch (objectType) {
      case OBJECT_TYPE.WALL:
        graphics.fillStyle(0x666666, 1);
        graphics.fillRect(posX, posY, tileSize, tileSize);
        graphics.lineStyle(1, 0x444444, 1);
        graphics.strokeRect(posX, posY, tileSize, tileSize);
        break;

      case OBJECT_TYPE.DESK:
        graphics.fillStyle(0x8B4513, 1);
        graphics.fillRoundedRect(posX + 2, posY + 4, tileSize - 4, tileSize - 8, 2);
        graphics.lineStyle(1, 0x4a3520, 1);
        graphics.strokeRoundedRect(posX + 2, posY + 4, tileSize - 4, tileSize - 8, 2);
        break;

      case OBJECT_TYPE.CHAIR:
        graphics.fillStyle(0x4a4a4a, 1);
        graphics.fillCircle(posX + tileSize / 2, posY + tileSize / 2, tileSize / 3);
        graphics.lineStyle(1, 0x333333, 1);
        graphics.strokeCircle(posX + tileSize / 2, posY + tileSize / 2, tileSize / 3);
        break;

      case OBJECT_TYPE.MONITOR:
        graphics.fillStyle(0x222222, 1);
        graphics.fillRect(posX + 6, posY + 4, tileSize - 12, tileSize - 12);
        graphics.fillStyle(0x4488ff, 1);
        graphics.fillRect(posX + 8, posY + 6, tileSize - 16, tileSize - 16);
        graphics.fillStyle(0x222222, 1);
        graphics.fillRect(posX + 12, posY + tileSize - 10, 8, 6);
        break;

      case OBJECT_TYPE.PLANT:
        graphics.fillStyle(0x8B4513, 1);
        graphics.fillRect(posX + 8, posY + 20, tileSize - 16, 10);
        graphics.fillStyle(0x228B22, 1);
        graphics.fillCircle(posX + tileSize / 2, posY + 14, 10);
        graphics.fillStyle(0x1a6b1a, 1);
        graphics.fillCircle(posX + tileSize / 2 - 4, posY + 12, 6);
        graphics.fillCircle(posX + tileSize / 2 + 4, posY + 10, 5);
        break;

      case OBJECT_TYPE.SOFA:
        graphics.fillStyle(0x4a4a8a, 1);
        graphics.fillRoundedRect(posX + 2, posY + 8, tileSize - 4, tileSize - 12, 4);
        graphics.fillStyle(0x3a3a7a, 1);
        graphics.fillRoundedRect(posX + 2, posY + 4, tileSize - 4, 8, 3);
        break;

      case OBJECT_TYPE.COFFEE_TABLE:
        graphics.fillStyle(0xa0522d, 1);
        graphics.fillRoundedRect(posX + 4, posY + 8, tileSize - 8, tileSize - 16, 4);
        graphics.lineStyle(1, 0x8B4513, 1);
        graphics.strokeRoundedRect(posX + 4, posY + 8, tileSize - 8, tileSize - 16, 4);
        break;

      case OBJECT_TYPE.COFFEE_MACHINE:
        graphics.fillStyle(0x333333, 1);
        graphics.fillRect(posX + 6, posY + 4, tileSize - 12, tileSize - 8);
        graphics.fillStyle(0x666666, 1);
        graphics.fillRect(posX + 8, posY + 8, 8, 12);
        graphics.fillStyle(0xff6600, 1);
        graphics.fillCircle(posX + tileSize - 10, posY + 10, 3);
        break;

      case OBJECT_TYPE.MEETING_TABLE:
        graphics.fillStyle(0x654321, 1);
        graphics.fillRoundedRect(posX + 2, posY + 4, tileSize - 4, tileSize - 8, 3);
        graphics.lineStyle(1, 0x3a2510, 1);
        graphics.strokeRoundedRect(posX + 2, posY + 4, tileSize - 4, tileSize - 8, 3);
        break;

      case OBJECT_TYPE.WHITEBOARD:
        graphics.fillStyle(0x444444, 1);
        graphics.fillRect(posX + 4, posY + 2, tileSize - 8, tileSize - 4);
        graphics.fillStyle(0xffffff, 1);
        graphics.fillRect(posX + 6, posY + 4, tileSize - 12, tileSize - 8);
        graphics.fillStyle(0x0000ff, 1);
        graphics.fillRect(posX + 10, posY + 10, 12, 2);
        graphics.fillStyle(0xff0000, 1);
        graphics.fillRect(posX + 8, posY + 16, 16, 2);
        break;
    }
  }

  private createCollisionRects(): void {
    const { tileSize } = MAP_CONFIG;

    for (let y = 0; y < COLLISION_LAYER.length; y++) {
      for (let x = 0; x < COLLISION_LAYER[y].length; x++) {
        if (COLLISION_LAYER[y][x] === 1) {
          const posX = x * tileSize;
          const posY = y * tileSize;

          const rect = this.scene.add.rectangle(
            posX + tileSize / 2,
            posY + tileSize / 2,
            tileSize,
            tileSize,
            0xff0000,
            0
          );
          this.scene.physics.add.existing(rect, true);
          this.collisionRects.push(rect);
        }
      }
    }
  }

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
      text.setDepth(50);
    }
  }

  private renderWorldBorder(worldWidth: number, worldHeight: number): void {
    const graphics = this.scene.add.graphics();
    graphics.lineStyle(3, 0x7b5ea7, 1);
    graphics.strokeRect(0, 0, worldWidth, worldHeight);
    graphics.setDepth(60);
  }

  getCollisionRects(): Phaser.GameObjects.Rectangle[] {
    return this.collisionRects;
  }
}
