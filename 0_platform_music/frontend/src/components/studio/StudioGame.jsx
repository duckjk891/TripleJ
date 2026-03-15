import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Phaser from 'phaser';
import StudioScene from './StudioScene';
import { MAP } from './studioConfig';

/**
 * React wrapper for the Phaser Studio game.
 * Exposes startGeneration(request) via ref.
 */
const StudioGame = forwardRef(function StudioGame({ onPhaseChange }, ref) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const sceneRef = useRef(null);

  useImperativeHandle(ref, () => ({
    startGeneration(request) {
      if (sceneRef.current) {
        sceneRef.current.startGeneration(request);
      }
    },
  }));

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config = {
      type: Phaser.CANVAS,
      width: MAP.WIDTH,
      height: MAP.HEIGHT,
      parent: containerRef.current,
      pixelArt: true,
      roundPixels: true,
      backgroundColor: '#0F0F1A',
      render: {
        antialias: false,
        pixelArt: true,
        roundPixels: true,
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [StudioScene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    game.events.once('ready', () => {
      const scene = game.scene.getScene('StudioScene');
      sceneRef.current = scene;
      if (onPhaseChange) {
        scene.onPhaseChange = onPhaseChange;
      }
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: `${MAP.WIDTH * 2}px`,
        aspectRatio: `${MAP.WIDTH} / ${MAP.HEIGHT}`,
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid #2D2D44',
        margin: '0 auto',
        imageRendering: 'pixelated',
      }}
    />
  );
});

export default StudioGame;
