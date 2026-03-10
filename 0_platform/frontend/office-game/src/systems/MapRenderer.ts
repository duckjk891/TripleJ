/**
 * MapRenderer
 * 사무실 맵 렌더링 시스템 - 1_oneCompany에서 이식
 * officeMapData 사용
 */

import Phaser from 'phaser';
import { MAP_CONFIG, GAME_COLORS } from '../config/gameConfig';
import { OFFICE_AREAS } from '../config/officeMapData';
import type { AreaDefinition } from '../config/officeMapData';

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

    // 1. 배경 (사무실 바닥)
    this.renderBackground(worldWidth, worldHeight);

    // 2. 각 영역 렌더링
    OFFICE_AREAS.forEach((area) => this.renderArea(area));

    // 3. 영역 이름 표시
    OFFICE_AREAS.forEach((area) => this.renderAreaLabel(area));

    // 4. 월드 테두리
    this.renderWorldBorder(worldWidth, worldHeight);
  }

  private renderBackground(worldWidth: number, worldHeight: number): void {
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(GAME_COLORS.floor, 1); // 미니홈피 바닥색
    graphics.fillRect(0, 0, worldWidth, worldHeight);
    graphics.setDepth(0);
  }

  private renderArea(area: AreaDefinition): void {
    const { tileSize } = MAP_CONFIG;
    const graphics = this.scene.add.graphics();

    const x = area.x * tileSize;
    const y = area.y * tileSize;
    const w = area.width * tileSize;
    const h = area.height * tileSize;

    // 영역 채우기
    graphics.fillStyle(area.color, 1);
    graphics.fillRect(x, y, w, h);

    // 영역 테두리
    if (area.type === 'area' || area.type === 'room') {
      graphics.lineStyle(2, 0x333333, 0.5);
      graphics.strokeRect(x, y, w, h);
    }

    // 오브젝트인 경우 더 진한 테두리
    if (area.type === 'object') {
      graphics.lineStyle(1, 0x000000, 0.4);
      graphics.strokeRect(x, y, w, h);

      // 충돌 영역 추가 (걸을 수 없는 오브젝트)
      if (area.isWalkable === false) {
        const rect = this.scene.add.rectangle(
          x + w / 2,
          y + h / 2,
          w,
          h,
          0xff0000,
          0 // 투명
        );
        this.scene.physics.add.existing(rect, true); // static body
        this.collisionRects.push(rect);
      }
    }

    // depth 설정: 영역은 1, 오브젝트는 10 (캐릭터는 200)
    const depth = area.type === 'object' ? 10 : 1;
    graphics.setDepth(depth);

    // 자식 영역 렌더링
    if (area.children) {
      area.children.forEach((child) => this.renderArea(child));
    }
  }

  private renderAreaLabel(area: AreaDefinition): void {
    if (area.type === 'object') return; // 오브젝트는 라벨 표시 안함

    const { tileSize } = MAP_CONFIG;
    const x = area.x * tileSize + 4;
    const y = area.y * tileSize + 4;

    const text = this.scene.add.text(x, y, area.name, {
      fontSize: area.type === 'area' ? '11px' : '9px',
      color: '#ffffff',
      backgroundColor: '#00000066',
      padding: { x: 3, y: 1 },
    });

    text.setDepth(100);
  }

  private renderWorldBorder(worldWidth: number, worldHeight: number): void {
    const graphics = this.scene.add.graphics();
    graphics.lineStyle(3, GAME_COLORS.primary, 1);
    graphics.strokeRect(0, 0, worldWidth, worldHeight);
    graphics.setDepth(150);
  }

  /**
   * 디버그용 그리드 렌더링
   */
  renderGrid(): void {
    const { width, height, tileSize } = MAP_CONFIG;
    const worldWidth = width * tileSize;
    const worldHeight = height * tileSize;

    const graphics = this.scene.add.graphics();
    graphics.lineStyle(1, 0x000000, 0.1);

    for (let x = 0; x <= worldWidth; x += tileSize) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, worldHeight);
    }

    for (let y = 0; y <= worldHeight; y += tileSize) {
      graphics.moveTo(0, y);
      graphics.lineTo(worldWidth, y);
    }

    graphics.strokePath();
    graphics.setDepth(99);
  }

  getCollisionRects(): Phaser.GameObjects.Rectangle[] {
    return this.collisionRects;
  }
}
