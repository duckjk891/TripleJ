import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { OfficeScene } from './game/scenes/OfficeScene';
import { OfficeUIScene } from './game/scenes/OfficeUIScene';
import { GameBridge } from './game/bridge/GameBridge';
import './GameIframe.css';

interface PhaserGameProps {
  onGameReady?: () => void;
  onError?: (error: string) => void;
}

// 게임 기본 해상도 (맵 크기: 20x10 타일, 각 32px)
const GAME_WIDTH = 640;
const GAME_HEIGHT = 320;

function PhaserGame({ onGameReady, onError }: PhaserGameProps) {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: GAME_WIDTH, height: GAME_HEIGHT });

  // 컨테이너 크기 변경 감지
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const parent = container.parentElement;
      if (!parent) return;

      const parentWidth = parent.clientWidth;
      const parentHeight = parent.clientHeight || 400; // 최소 높이

      // 비율 유지하면서 맞춤
      const aspectRatio = GAME_WIDTH / GAME_HEIGHT;
      let width = parentWidth;
      let height = width / aspectRatio;

      // 높이가 부모보다 크면 높이 기준으로 조정
      if (height > parentHeight) {
        height = parentHeight;
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

  // Phaser 게임 초기화
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

  // 크기 변경 시 게임 스케일 조정
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
