import Phaser from 'phaser';
import { OfficeScene } from './scenes/OfficeScene';
import { OfficeUIScene } from './scenes/OfficeUIScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 640,
  height: 320,
  parent: 'game-container',
  backgroundColor: '#f0e6f6',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [OfficeScene, OfficeUIScene]
};

const game = new Phaser.Game(config);

// 외부 통신 (iframe 부모와 postMessage)
window.addEventListener('message', (event) => {
  if (event.data?.type === 'GAME_COMMAND') {
    const scene = game.scene.getScene('OfficeScene');
    if (scene) {
      scene.events.emit('external-command', event.data.command);
    }
  }
});

export { game };
