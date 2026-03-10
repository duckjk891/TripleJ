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
