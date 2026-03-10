/**
 * Phaser Game Configuration
 * 게임 설정 및 Phaser.Game 인스턴스 생성을 위한 설정
 * 미니홈피 content-area에 맞춤 (640x320)
 */

import Phaser from 'phaser';
import { OfficeScene } from '../scenes/OfficeScene';
import { OfficeUIScene } from '../scenes/OfficeUIScene';

/**
 * 게임 설정 옵션
 */
export interface GameConfigOptions {
  width?: number;
  height?: number;
  parentId: string;
  debug?: boolean;
}

/**
 * 기본 게임 설정 값 (미니홈피 content-area 사이즈)
 */
const DEFAULT_CONFIG: Omit<GameConfigOptions, 'parentId'> = {
  width: 640,
  height: 320,
  debug: false,
};

/**
 * Phaser 게임 설정 생성
 * @param options - 게임 설정 옵션
 * @returns Phaser.Types.Core.GameConfig
 */
export function createGameConfig(
  options: GameConfigOptions
): Phaser.Types.Core.GameConfig {
  const config = { ...DEFAULT_CONFIG, ...options };

  return {
    type: Phaser.AUTO,
    width: config.width,
    height: config.height,
    parent: config.parentId,
    backgroundColor: '#f0e6f6',
    pixelArt: true,
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: config.debug,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true,
    },
    scene: [OfficeScene, OfficeUIScene],
  };
}

/**
 * 게임 색상 상수
 */
export const GAME_COLORS = {
  // 미니홈피 테마 색상
  primary: 0x7b5ea7, // 보라
  secondary: 0xd9a8d9, // 분홍
  background: 0xf0e6f6, // 밝은 라벤더
  floor: 0xd4bce8, // 바닥 색상
  wall: 0xe8d5f5, // 벽 색상
  accent: 0xbba8d0, // 강조 색상
} as const;

/**
 * 맵 설정 상수 (20x10 타일, 각 32px)
 */
export const MAP_CONFIG = {
  tileSize: 32,
  width: 20,   // 타일 기준 (640px / 32px)
  height: 10,  // 타일 기준 (320px / 32px)
} as const;

/**
 * 캐릭터 설정 상수
 */
export const CHARACTER_CONFIG = {
  speed: 80,
  frameRate: 8,
  scale: 1,
} as const;

/**
 * 레이어 Depth 상수
 * 각 레이어는 depth 범위를 가지며, 내부에서 세부 depth 조절 가능
 */
export const LAYER_DEPTH = {
  // Layer 1: Ground (바닥) - depth 0~99
  GROUND: {
    BASE: 0,
    BACKGROUND: 0,
    FLOOR: 10,
    FLOOR_DECOR: 20,
    AREA_LABELS: 30,
    BORDER: 40,
  },

  // Layer 2: Entity (오브젝트 + 캐릭터) - depth 100~299
  // Y-sorting 적용: depth = ENTITY.BASE + (y / mapHeight) * ENTITY.RANGE
  ENTITY: {
    BASE: 100,
    RANGE: 199,  // 100 ~ 299
    COLLISION: 100,  // 충돌 영역 (보이지 않음)
  },

  // Layer 3: Effect (이펙트) - depth 300~399
  EFFECT: {
    BASE: 300,
    DAY_NIGHT: 300,
    WEATHER: 320,
    TRANSITION: 350,
  },

  // Layer 4: UI - depth 400~499
  UI: {
    BASE: 400,
    HUD: 400,
    HUD_CONTENT: 410,
    INFO_PANEL: 450,
    MODAL_DIM: 480,
    MODAL_CONTENT: 490,
  },
} as const;

/**
 * Y좌표 기반 depth 계산 (Entity Layer용)
 * @param y - 월드 Y 좌표
 * @returns depth 값 (100 ~ 299)
 */
export function calculateEntityDepth(y: number): number {
  const mapHeight = MAP_CONFIG.height * MAP_CONFIG.tileSize;
  const normalizedY = Math.max(0, Math.min(y, mapHeight)) / mapHeight;
  return Math.floor(LAYER_DEPTH.ENTITY.BASE + normalizedY * LAYER_DEPTH.ENTITY.RANGE);
}
