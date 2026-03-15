import Phaser from 'phaser';
import { MAP, COLORS, AREAS, FURNITURE, CHARACTERS, DIALOGUES, ANIM, isWalkable } from './studioConfig';

/**
 * AIMU Studio Scene
 * - Pixel art music studio with 3 AI characters
 * - Characters wander, discuss, and "work" on music generation requests
 */
export default class StudioScene extends Phaser.Scene {
  constructor() {
    super('StudioScene');
    this.characters = {};
    this.dialogueBubbles = [];
    this.phase = 'idle'; // idle | greeting | analyze | working | review | complete
    this.phaseTimer = null;
    this.currentRequest = null;
    this.workingDialogueIdx = 0;
    this.onPhaseChange = null;
  }

  preload() {
    // Characters are 16x32 (width x height) — each character spans 2 tile rows
    this.load.spritesheet('char_adam', '/assets/characters/Adam_16x16.png', {
      frameWidth: 16, frameHeight: 32,
    });
    this.load.spritesheet('char_amelia', '/assets/characters/Amelia_16x16.png', {
      frameWidth: 16, frameHeight: 32,
    });
    this.load.spritesheet('char_alex', '/assets/characters/Alex_16x16.png', {
      frameWidth: 16, frameHeight: 32,
    });
    this.load.spritesheet('tiles_interior', '/assets/tiles/Interiors_free_32x32.png', {
      frameWidth: 32, frameHeight: 32,
    });
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.WALL);

    this._drawMap();
    this._createAnimations();
    this._createCharacters();
    this._startIdleBehavior();
  }

  // ─── Map Drawing ──────────────────────────────────────────────

  _drawMap() {
    const g = this.add.graphics();

    // Draw area backgrounds
    Object.values(AREAS).forEach((area) => {
      g.fillStyle(area.color, 1);
      g.fillRect(area.x * MAP.TILE, area.y * MAP.TILE, area.w * MAP.TILE, area.h * MAP.TILE);
    });

    // Floor base
    g.fillStyle(COLORS.FLOOR, 0.3);
    g.fillRect(MAP.TILE, MAP.TILE, (MAP.COLS - 2) * MAP.TILE, (MAP.ROWS - 2) * MAP.TILE);

    // Grid lines
    g.lineStyle(1, COLORS.GRID, 0.15);
    for (let x = 0; x <= MAP.COLS; x++) {
      g.moveTo(x * MAP.TILE, 0);
      g.lineTo(x * MAP.TILE, MAP.HEIGHT);
    }
    for (let y = 0; y <= MAP.ROWS; y++) {
      g.moveTo(0, y * MAP.TILE);
      g.lineTo(MAP.WIDTH, y * MAP.TILE);
    }
    g.strokePath();

    // Area labels
    Object.values(AREAS).forEach((area) => {
      this.add.text(
        (area.x + area.w / 2) * MAP.TILE,
        (area.y + 0.3) * MAP.TILE,
        area.name,
        { fontSize: '10px', color: COLORS.LABEL, fontFamily: 'monospace' }
      ).setOrigin(0.5, 0).setAlpha(0.5).setDepth(0);
    });

    // Furniture emoji labels
    FURNITURE.forEach((f) => {
      this.add.text(
        f.x * MAP.TILE + MAP.TILE / 2,
        f.y * MAP.TILE + MAP.TILE / 2,
        f.label,
        { fontSize: '18px' }
      ).setOrigin(0.5).setDepth(1);
    });
  }

  // ─── Animations ───────────────────────────────────────────────

  _createAnimations() {
    const sprites = ['char_adam', 'char_amelia', 'char_alex'];

    sprites.forEach((spriteKey) => {
      Object.entries(ANIM.ANIMS).forEach(([animKey, { start, count }]) => {
        const frames = [];
        for (let i = 0; i < count; i++) {
          frames.push({ key: spriteKey, frame: start + i });
        }
        const isIdle = animKey.startsWith('idle');
        this.anims.create({
          key: `${spriteKey}_${animKey}`,
          frames,
          frameRate: isIdle ? 4 : ANIM.FRAME_RATE,
          repeat: -1,
        });
      });
    });
  }

  // ─── Characters ───────────────────────────────────────────────

  _createCharacters() {
    CHARACTERS.forEach((cfg) => {
      const px = cfg.startX * MAP.TILE + MAP.TILE / 2;
      const py = cfg.startY * MAP.TILE + MAP.TILE / 2;

      // make.sprite with add:false — matches office game pattern
      const sprite = this.make.sprite({ x: 0, y: 0, key: cfg.sprite, frame: 0, add: false });
      sprite.setScale(2);
      sprite.setOrigin(0.5, 0.5);

      const nameText = this.make.text({
        x: 0, y: -40,
        text: cfg.name,
        style: {
          fontSize: '9px',
          color: '#E2E8F0',
          fontFamily: 'sans-serif',
          fontStyle: 'bold',
          stroke: '#0F0F1A',
          strokeThickness: 2,
        },
        add: false,
      }).setOrigin(0.5);

      const roleText = this.make.text({
        x: 0, y: -32,
        text: cfg.role,
        style: {
          fontSize: '7px',
          color: '#7C3AED',
          fontFamily: 'sans-serif',
          stroke: '#0F0F1A',
          strokeThickness: 1,
        },
        add: false,
      }).setOrigin(0.5);

      const container = this.add.container(px, py, [sprite, nameText, roleText]);
      container.setDepth(100 + py / MAP.HEIGHT * 199);

      const char = {
        cfg,
        container,
        sprite,
        tileX: cfg.startX,
        tileY: cfg.startY,
        targetX: null,
        targetY: null,
        path: [],
        moving: false,
        direction: 'down',
        actionBubble: null,
        dialogueBubble: null,
      };

      sprite.play(`${cfg.sprite}_idle_down`);
      this.characters[cfg.id] = char;
    });
  }

  // ─── Movement ─────────────────────────────────────────────────

  _moveCharTo(charId, destX, destY, callback) {
    const char = this.characters[charId];
    if (!char || char.moving) return;
    if (!isWalkable(destX, destY)) return;

    // Simple direct path (no A* needed for small map)
    const path = this._findPath(char.tileX, char.tileY, destX, destY);
    if (path.length === 0) return;

    char.path = path;
    char.moving = true;
    this._moveAlongPath(charId, callback);
  }

  _findPath(fromX, fromY, toX, toY) {
    // Simple BFS pathfinding
    const queue = [[fromX, fromY, []]];
    const visited = new Set();
    visited.add(`${fromX},${fromY}`);
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    while (queue.length > 0) {
      const [cx, cy, path] = queue.shift();
      if (cx === toX && cy === toY) return path;

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        const key = `${nx},${ny}`;
        if (!visited.has(key) && isWalkable(nx, ny)) {
          visited.add(key);
          queue.push([nx, ny, [...path, { x: nx, y: ny }]]);
        }
      }
    }
    return [];
  }

  _moveAlongPath(charId, callback) {
    const char = this.characters[charId];
    if (!char.path || char.path.length === 0) {
      char.moving = false;
      this._playIdle(char);
      if (callback) callback();
      return;
    }

    const next = char.path.shift();
    const targetPx = next.x * MAP.TILE + MAP.TILE / 2;
    const targetPy = next.y * MAP.TILE + MAP.TILE / 2;

    // Determine direction
    const dx = next.x - char.tileX;
    const dy = next.y - char.tileY;
    if (dy < 0) char.direction = 'up';
    else if (dy > 0) char.direction = 'down';
    else if (dx < 0) char.direction = 'left';
    else if (dx > 0) char.direction = 'right';

    char.sprite.play(`${char.cfg.sprite}_walk_${char.direction}`, true);

    const dist = Math.sqrt(
      (targetPx - char.container.x) ** 2 + (targetPy - char.container.y) ** 2
    );
    const duration = (dist / ANIM.MOVE_SPEED) * 1000;

    this.tweens.add({
      targets: char.container,
      x: targetPx,
      y: targetPy,
      duration: Math.max(duration, 100),
      ease: 'Linear',
      onUpdate: () => {
        char.container.setDepth(100 + char.container.y / MAP.HEIGHT * 199);
      },
      onComplete: () => {
        char.tileX = next.x;
        char.tileY = next.y;
        this._moveAlongPath(charId, callback);
      },
    });
  }

  _playIdle(char) {
    char.sprite.play(`${char.cfg.sprite}_idle_${char.direction}`, true);
  }

  // ─── Action Bubbles ───────────────────────────────────────────

  _showAction(charId, text) {
    const char = this.characters[charId];
    if (!char) return;

    this._clearAction(charId);

    const t = this.make.text({
      x: 0, y: 0,
      text,
      style: {
        fontSize: '8px',
        color: '#E2E8F0',
        fontFamily: 'sans-serif',
        padding: { x: 6, y: 3 },
        wordWrap: { width: 120 },
      },
      add: false,
    }).setOrigin(0.5);

    const bg = this.make.graphics({ add: false });
    const w = t.width + 12;
    const h = t.height + 6;
    bg.fillStyle(COLORS.BUBBLE_BG, 0.9);
    bg.lineStyle(1, COLORS.BUBBLE_BORDER, 0.6);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);

    const bubble = this.add.container(0, -52, [bg, t]);
    char.container.add(bubble);
    char.actionBubble = bubble;
  }

  _clearAction(charId) {
    const char = this.characters[charId];
    if (char?.actionBubble) {
      char.actionBubble.destroy();
      char.actionBubble = null;
    }
  }

  // ─── Dialogue System ──────────────────────────────────────────

  _showDialogue(dialogueArray, callback) {
    this._clearAllDialogues();
    let idx = 0;

    const showNext = () => {
      if (idx >= dialogueArray.length) {
        this.time.delayedCall(1500, () => {
          this._clearAllDialogues();
          if (callback) callback();
        });
        return;
      }

      this._clearAllDialogues();
      const { speaker, text } = dialogueArray[idx];

      // Find character by name
      const char = Object.values(this.characters).find(
        (c) => c.cfg.name === speaker
      );
      if (!char) { idx++; showNext(); return; }

      const nameT = this.make.text({
        x: 0, y: -8, text: speaker,
        style: { fontSize: '7px', color: '#7C3AED', fontFamily: 'sans-serif', fontStyle: 'bold' },
        add: false,
      }).setOrigin(0.5);

      const msgT = this.make.text({
        x: 0, y: 4, text,
        style: { fontSize: '8px', color: '#E2E8F0', fontFamily: 'sans-serif', padding: { x: 4, y: 2 }, wordWrap: { width: 140 } },
        add: false,
      }).setOrigin(0.5);

      const w = Math.max(nameT.width, msgT.width) + 16;
      const h = nameT.height + msgT.height + 12;

      const bg = this.make.graphics({ add: false });
      bg.fillStyle(0x1a1a2e, 0.95);
      bg.lineStyle(1.5, 0x7c3aed, 0.8);
      bg.fillRoundedRect(-w / 2, -h / 2 - 4, w, h, 5);
      bg.strokeRoundedRect(-w / 2, -h / 2 - 4, w, h, 5);
      bg.fillStyle(0x1a1a2e, 0.95);
      bg.fillTriangle(-4, h / 2 - 4, 4, h / 2 - 4, 0, h / 2 + 2);

      const bubble = this.add.container(0, -58, [bg, nameT, msgT]);
      char.container.add(bubble);
      char.dialogueBubble = bubble;

      idx++;
      this.time.delayedCall(2500 + text.length * 40, showNext);
    };

    showNext();
  }

  _clearAllDialogues() {
    Object.values(this.characters).forEach((char) => {
      if (char.dialogueBubble) {
        char.dialogueBubble.destroy();
        char.dialogueBubble = null;
      }
    });
  }

  // ─── Idle Behavior ────────────────────────────────────────────

  _startIdleBehavior() {
    this._idleLoop();
  }

  _idleLoop() {
    if (this.phase !== 'idle') return;

    Object.keys(this.characters).forEach((id) => {
      const char = this.characters[id];
      if (char.moving) return;

      // Random action display
      const actions = char.cfg.idleActions;
      const action = actions[Math.floor(Math.random() * actions.length)];
      this._showAction(id, action);

      // Random wandering
      if (Math.random() < 0.5) {
        const area = AREAS[char.cfg.homeArea];
        const rx = area.x + 1 + Math.floor(Math.random() * (area.w - 2));
        const ry = area.y + 1 + Math.floor(Math.random() * (area.h - 2));
        if (isWalkable(rx, ry)) {
          this._moveCharTo(id, rx, ry);
        }
      }
    });

    this.phaseTimer = this.time.delayedCall(
      3000 + Math.random() * 3000,
      () => this._idleLoop()
    );
  }

  // ─── Generation Workflow ──────────────────────────────────────

  startGeneration(request) {
    this.currentRequest = request;
    this._stopCurrentPhase();
    this.phase = 'greeting';
    this._notifyPhase('greeting');

    // Clear all existing actions
    Object.keys(this.characters).forEach((id) => this._clearAction(id));

    // Move everyone to center
    const centerX = 7;
    const centerY = 4;
    let arrived = 0;
    const total = 3;

    const positions = [
      { id: 'composer', x: centerX - 1, y: centerY },
      { id: 'lyricist', x: centerX + 1, y: centerY },
      { id: 'producer', x: centerX, y: centerY + 1 },
    ];

    positions.forEach(({ id, x, y }) => {
      this._moveCharTo(id, x, y, () => {
        arrived++;
        if (arrived >= total) {
          this._phaseGreeting();
        }
      });
    });

    // Fallback in case pathfinding fails
    this.time.delayedCall(6000, () => {
      if (this.phase === 'greeting' && arrived < total) {
        this._phaseGreeting();
      }
    });
  }

  _phaseGreeting() {
    this._showDialogue(DIALOGUES.greeting, () => {
      this.phase = 'analyze';
      this._notifyPhase('analyze');
      this._phaseAnalyze();
    });
  }

  _phaseAnalyze() {
    const { prompt, genre, mood } = this.currentRequest || {};
    const dialogue = DIALOGUES.analyze(
      prompt || '새로운 음악',
      genre,
      mood
    );
    this._showDialogue(dialogue, () => {
      this.phase = 'working';
      this._notifyPhase('working');
      this._phaseWorking();
    });
  }

  _phaseWorking() {
    // Each character goes to their station
    const moves = [
      { id: 'composer', x: 2, y: 2 },
      { id: 'lyricist', x: 13, y: 2 },
      { id: 'producer', x: 8, y: 8 },
    ];

    moves.forEach(({ id, x, y }) => {
      this._moveCharTo(id, x, y, () => {
        const char = this.characters[id];
        const actions = char.cfg.workActions;
        this._showAction(id, actions[Math.floor(Math.random() * actions.length)]);
      });
    });

    // Working phase: show periodic dialogues
    this.workingDialogueIdx = 0;
    this._workingLoop();
  }

  _workingLoop() {
    if (this.phase !== 'working') return;

    const dialogues = DIALOGUES.working;
    if (this.workingDialogueIdx >= dialogues.length) {
      // Move to review phase
      this.phase = 'review';
      this._notifyPhase('review');
      this._phaseReview();
      return;
    }

    // Update work actions
    Object.keys(this.characters).forEach((id) => {
      const char = this.characters[id];
      const actions = char.cfg.workActions;
      this._showAction(id, actions[Math.floor(Math.random() * actions.length)]);
    });

    this.time.delayedCall(4000, () => {
      if (this.phase !== 'working') return;

      // Characters meet briefly to discuss
      const centerX = 7;
      const centerY = 4;
      let arrived = 0;

      const positions = [
        { id: 'composer', x: centerX - 1, y: centerY },
        { id: 'lyricist', x: centerX + 1, y: centerY },
        { id: 'producer', x: centerX, y: centerY + 1 },
      ];

      positions.forEach(({ id, x, y }) => {
        this._clearAction(id);
        this._moveCharTo(id, x, y, () => {
          arrived++;
          if (arrived >= 3) {
            const dialogue = dialogues[this.workingDialogueIdx];
            this.workingDialogueIdx++;
            this._showDialogue(dialogue, () => {
              // Go back to stations
              this._phaseWorking();
            });
          }
        });
      });

      // Fallback
      this.time.delayedCall(5000, () => {
        if (arrived < 3 && this.phase === 'working') {
          const dialogue = dialogues[this.workingDialogueIdx];
          this.workingDialogueIdx++;
          this._showDialogue(dialogue, () => {
            this._phaseWorking();
          });
        }
      });
    });
  }

  _phaseReview() {
    // Everyone gathers at center
    const centerX = 7;
    const centerY = 4;
    let arrived = 0;

    const positions = [
      { id: 'composer', x: centerX - 1, y: centerY },
      { id: 'lyricist', x: centerX + 1, y: centerY },
      { id: 'producer', x: centerX, y: centerY + 1 },
    ];

    Object.keys(this.characters).forEach((id) => this._clearAction(id));

    positions.forEach(({ id, x, y }) => {
      this._moveCharTo(id, x, y, () => {
        arrived++;
        if (arrived >= 3) {
          this._showDialogue(DIALOGUES.review, () => {
            this.phase = 'complete';
            this._notifyPhase('complete');
            this._phaseComplete();
          });
        }
      });
    });

    this.time.delayedCall(5000, () => {
      if (arrived < 3 && this.phase === 'review') {
        this._showDialogue(DIALOGUES.review, () => {
          this.phase = 'complete';
          this._notifyPhase('complete');
          this._phaseComplete();
        });
      }
    });
  }

  _phaseComplete() {
    this._showDialogue(DIALOGUES.complete, () => {
      // Return to idle after completion
      this.time.delayedCall(2000, () => {
        this.phase = 'idle';
        this._notifyPhase('idle');
        this.currentRequest = null;
        // Move characters back to home areas
        Object.keys(this.characters).forEach((id) => {
          const char = this.characters[id];
          this._moveCharTo(id, char.cfg.homeX, char.cfg.homeY);
        });
        this._startIdleBehavior();
      });
    });
  }

  _stopCurrentPhase() {
    if (this.phaseTimer) {
      this.phaseTimer.destroy();
      this.phaseTimer = null;
    }
    this._clearAllDialogues();
    // Stop all tweens
    Object.values(this.characters).forEach((char) => {
      this.tweens.killTweensOf(char.container);
      char.moving = false;
      char.path = [];
    });
  }

  _notifyPhase(phase) {
    if (this.onPhaseChange) {
      this.onPhaseChange(phase);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  destroy() {
    this._stopCurrentPhase();
    super.destroy();
  }
}
