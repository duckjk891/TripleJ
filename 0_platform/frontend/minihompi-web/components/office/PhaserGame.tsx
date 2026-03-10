'use client';

import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { OfficeScene } from '@/components/game/scenes/OfficeScene';
import { OfficeUIScene } from '@/components/game/scenes/OfficeUIScene';
import { GameBridge } from '@/components/game/bridge/GameBridge';
import './PhaserGame.css';

interface PhaserGameProps {
  onGameReady?: () => void;
  onError?: (error: string) => void;
}

// Game base resolution (map size: 20x10 tiles, each 32px)
const GAME_WIDTH = 640;
const GAME_HEIGHT = 320;

function PhaserGame({ onGameReady, onError }: PhaserGameProps) {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: GAME_WIDTH, height: GAME_HEIGHT });

  // Container size change detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const parent = container.parentElement;
      if (!parent) return;

      const parentWidth = parent.clientWidth;
      const parentHeight = parent.clientHeight || 400;

      // Cap maximum dimensions to prevent oversized canvas
      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 400;

      // Maintain aspect ratio while fitting
      const aspectRatio = GAME_WIDTH / GAME_HEIGHT;
      let width = Math.min(parentWidth, MAX_WIDTH);
      let height = width / aspectRatio;

      // If height exceeds parent or max, adjust based on height
      const maxH = Math.min(parentHeight, MAX_HEIGHT);
      if (height > maxH) {
        height = maxH;
        width = height * aspectRatio;
      }

      setContainerSize({ width, height });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container.parentElement!);

    window.addEventListener('resize', updateSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Phaser game initialization
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const bridge = GameBridge.getInstance();

    const unsubReady = bridge.on('GAME_READY', () => {
      onGameReady?.();
    });

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent: containerRef.current,
      backgroundColor: '#2a2a2a',
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      scene: [OfficeScene, OfficeUIScene],
    };

    try {
      gameRef.current = new Phaser.Game(config);
    } catch (err) {
      onError?.('게임 초기화 실패');
      console.error('Phaser init error:', err);
    }

    return () => {
      unsubReady();
      gameRef.current?.destroy(true);
      gameRef.current = null;
      GameBridge.resetInstance();
    };
  }, [onGameReady, onError]);

  // Resize game scale when container size changes
  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.scale.resize(GAME_WIDTH, GAME_HEIGHT);
    }
  }, [containerSize]);

  return (
    <div
      ref={containerRef}
      id="game-container"
      className="game-iframe-container"
      style={{
        width: containerSize.width,
        height: containerSize.height,
        maxWidth: '100%',
      }}
    />
  );
}

export default PhaserGame;
