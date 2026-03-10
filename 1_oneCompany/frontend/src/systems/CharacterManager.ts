import Phaser from 'phaser';
import { Character, CharacterData } from '../entities/Character';
import { MAP_CONFIG, AREAS, AreaDefinition } from '../config/mapData';
import { getSpawnLocations } from '../config/worldTree';
import { GameTimeManager } from './GameTimeManager';

// 아바타 색상 프리셋
export const AVATAR_COLORS = [
  { id: 'blue', name: '파랑', color: 0x4a90d9 },
  { id: 'red', name: '빨강', color: 0xd94a4a },
  { id: 'green', name: '초록', color: 0x4ad94a },
  { id: 'purple', name: '보라', color: 0x9b4ad9 },
  { id: 'orange', name: '주황', color: 0xd9944a },
  { id: 'pink', name: '분홍', color: 0xd94a90 },
  { id: 'cyan', name: '하늘', color: 0x4ad9d9 },
  { id: 'yellow', name: '노랑', color: 0xd9d94a },
];

// ── 행동 정의 ──

interface BehaviorDef {
  id: string;
  action: string;
  emoji: string;
  duration: number;      // ms
  locationId?: string;   // worldTree 스폰 위치 id
}

const BEHAVIORS: BehaviorDef[] = [
  { id: 'idle',      action: '서 있는 중',         emoji: '🧍', duration: 5000 },
  { id: 'walk',      action: '걷는 중',           emoji: '🚶', duration: 3000 },
  { id: 'coffee',    action: '커피 마시는 중',     emoji: '☕', duration: 8000,  locationId: 'kitchen' },
  { id: 'work',      action: '책상에서 일하는 중', emoji: '💻', duration: 15000, locationId: 'open_space' },
  { id: 'meeting',   action: '회의 중',           emoji: '📋', duration: 12000, locationId: 'meeting_room' },
  { id: 'lunch',     action: '점심 먹는 중',       emoji: '🍽️', duration: 10000, locationId: 'cafe' },
  { id: 'rest',      action: '휴식 중',           emoji: '😌', duration: 6000 },
  { id: 'park_walk', action: '산책 중',           emoji: '🌳', duration: 8000,  locationId: 'park' },
];

const BEHAVIOR_MAP = new Map(BEHAVIORS.map(b => [b.id, b]));

// ── 시간대별 행동 확률 테이블 ──

interface TimeSlot {
  start: number;
  end: number;
  weights: Record<string, number>;
}

const TIME_BEHAVIOR_TABLE: TimeSlot[] = [
  { start: 6,  end: 9,  weights: { walk: 2, coffee: 3, idle: 1 } },
  { start: 9,  end: 12, weights: { work: 5, meeting: 2, coffee: 1, idle: 1 } },
  { start: 12, end: 13, weights: { lunch: 5, walk: 2, rest: 1 } },
  { start: 13, end: 18, weights: { work: 4, meeting: 2, rest: 1, coffee: 1, idle: 1 } },
  { start: 18, end: 22, weights: { park_walk: 3, rest: 2, walk: 2, idle: 1 } },
];

const DEFAULT_WEIGHTS: Record<string, number> = { idle: 3, walk: 2, rest: 1 };

// ── 대화 설정 ──

const CONVERSATION_TILE_DISTANCE = 3;
const CONVERSATION_DURATION_MIN = 8000;
const CONVERSATION_DURATION_MAX = 12000;
const CONVERSATION_COOLDOWN = 15000;
const PROXIMITY_CHECK_INTERVAL = 1500;

export class CharacterManager {
  private scene: Phaser.Scene;
  private characters: Map<string, Character> = new Map();
  private idCounter: number = 0;
  private behaviorTimers: Map<string, Phaser.Time.TimerEvent> = new Map();

  private gameTimeManager: GameTimeManager;

  // 대화 시스템
  private conversationCooldowns: Map<string, number> = new Map();
  private lastProximityCheck: number = 0;

  // 비걷기 오브젝트 타일 캐시
  private blockedTiles: Set<string> = new Set();

  constructor(scene: Phaser.Scene, gameTimeManager: GameTimeManager) {
    this.scene = scene;
    this.gameTimeManager = gameTimeManager;
    this.buildBlockedTiles();
  }

  /** 비걷기 오브젝트 영역 타일 캐시 생성 */
  private buildBlockedTiles(): void {
    const traverse = (area: AreaDefinition) => {
      if (area.type === 'object' && area.isWalkable === false) {
        for (let x = area.x; x < area.x + area.width; x++) {
          for (let y = area.y; y < area.y + area.height; y++) {
            this.blockedTiles.add(`${x},${y}`);
          }
        }
      }
      area.children?.forEach(child => traverse(child));
    };
    AREAS.forEach(a => traverse(a));
  }

  /** 타일이 걸을 수 있는지 확인 */
  private isWalkable(tx: number, ty: number): boolean {
    return !this.blockedTiles.has(`${tx},${ty}`);
  }

  /** 현재 게임 시간 (시) - 0~23 */
  getGameHour(): number {
    return this.gameTimeManager.getHour();
  }

  createCharacter(
    name: string,
    occupation: string,
    avatarColorId: string,
    tileX: number,
    tileY: number
  ): Character {
    const id = `char_${++this.idCounter}`;
    const spriteType = AVATAR_COLORS.findIndex(c => c.id === avatarColorId);
    const finalSpriteType = spriteType >= 0 ? spriteType : 0;

    const data: CharacterData = {
      id,
      name,
      occupation,
      spriteType: finalSpriteType,
      x: tileX,
      y: tileY
    };

    const character = new Character(this.scene, data);
    character.getGameTimeString = () => {
      const h = this.gameTimeManager.getHour();
      const m = this.gameTimeManager.getMinute();
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };
    this.characters.set(id, character);

    // 행동 루프 시작 (1~3초 후)
    const initialDelay = Phaser.Math.Between(1000, 3000);
    const timer = this.scene.time.delayedCall(initialDelay, () => {
      this.executeBehavior(id);
    });
    this.behaviorTimers.set(id, timer);

    console.log(`Character created: ${name} (${id}) at (${tileX}, ${tileY})`);
    return character;
  }

  getCharacter(id: string): Character | undefined {
    return this.characters.get(id);
  }

  getAllCharacters(): Character[] {
    return Array.from(this.characters.values());
  }

  removeCharacter(id: string): void {
    const character = this.characters.get(id);
    if (character) {
      const timer = this.behaviorTimers.get(id);
      if (timer) {
        timer.destroy();
        this.behaviorTimers.delete(id);
      }
      character.onArrival = null;
      character.destroy();
      this.characters.delete(id);

      // 대화 쿨다운 정리
      for (const key of this.conversationCooldowns.keys()) {
        if (key.includes(id)) {
          this.conversationCooldowns.delete(key);
        }
      }
    }
  }

  getCharacterCount(): number {
    return this.characters.size;
  }

  // ── 시간 기반 행동 선택 ──

  private selectBehavior(): BehaviorDef {
    const hour = this.getGameHour();

    // 현재 시간대에 맞는 가중치 테이블 찾기
    let weights: Record<string, number> = DEFAULT_WEIGHTS;
    for (const slot of TIME_BEHAVIOR_TABLE) {
      if (hour >= slot.start && hour < slot.end) {
        weights = slot.weights;
        break;
      }
    }

    // 가중치 기반 랜덤 선택
    const entries = Object.entries(weights);
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * totalWeight;

    for (const [behaviorId, weight] of entries) {
      roll -= weight;
      if (roll <= 0) {
        return BEHAVIOR_MAP.get(behaviorId) || BEHAVIORS[0];
      }
    }

    return BEHAVIORS[0];
  }

  // ── 행동 실행 ──

  private executeBehavior(id: string): void {
    const character = this.characters.get(id);
    if (!character) return;

    // 대화 중이면 나중에 재시도
    if (character.behaviorState === 'talking') {
      const timer = this.scene.time.delayedCall(2000, () => this.executeBehavior(id));
      this.behaviorTimers.set(id, timer);
      return;
    }

    const behavior = this.selectBehavior();

    if (behavior.locationId) {
      // 위치 기반 행동: 목적지로 이동 후 수행
      const location = getSpawnLocations().find(l => l.id === behavior.locationId);
      if (location) {
        let targetX: number, targetY: number;
        let attempts = 0;
        do {
          targetX = Phaser.Math.Clamp(
            location.x + Phaser.Math.Between(-2, 2), 1, MAP_CONFIG.width - 2
          );
          targetY = Phaser.Math.Clamp(
            location.y + Phaser.Math.Between(-2, 2), 1, MAP_CONFIG.height - 2
          );
          attempts++;
        } while (!this.isWalkable(targetX, targetY) && attempts < 8);

        character.behaviorState = 'moving';
        character.moveToTile(targetX, targetY);
        character.onArrival = () => {
          this.performAction(id, character, behavior);
        };
      } else {
        this.performAction(id, character, behavior);
      }
    } else if (behavior.id === 'walk') {
      // 랜덤 걷기
      character.behaviorState = 'moving';
      character.moveToRandomNearby();
      character.onArrival = () => {
        character.behaviorState = 'idle';
        character.setAction('서 있는 중', false);
        const delay = Phaser.Math.Between(1000, 3000);
        const timer = this.scene.time.delayedCall(delay, () => this.executeBehavior(id));
        this.behaviorTimers.set(id, timer);
      };
    } else {
      // 제자리 행동 (idle, rest)
      this.performAction(id, character, behavior);
    }
  }

  private performAction(id: string, character: Character, behavior: BehaviorDef): void {
    character.setAction(`${behavior.emoji} ${behavior.action}`);
    character.behaviorState = 'acting';

    const timer = this.scene.time.delayedCall(behavior.duration, () => {
      if (!this.characters.has(id)) return;
      character.behaviorState = 'idle';
      this.executeBehavior(id);
    });
    this.behaviorTimers.set(id, timer);
  }

  // ── 대화 시스템 ──

  private checkProximityConversations(): void {
    const chars = this.getAllCharacters();
    if (chars.length < 2) return;

    const now = Date.now();

    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        const a = chars[i];
        const b = chars[j];

        // 둘 다 대화 가능한 상태여야 함 (이동 중이거나 이미 대화 중이면 제외)
        if (a.behaviorState === 'talking' || b.behaviorState === 'talking') continue;
        if (a.behaviorState === 'moving' || b.behaviorState === 'moving') continue;

        // 쿨다운 체크
        const pairKey = [a.characterId, b.characterId].sort().join(':');
        const cooldownEnd = this.conversationCooldowns.get(pairKey) || 0;
        if (now < cooldownEnd) continue;

        // 맨해튼 거리 체크
        const tileA = a.getTilePosition();
        const tileB = b.getTilePosition();
        const dist = Math.abs(tileA.x - tileB.x) + Math.abs(tileA.y - tileB.y);

        if (dist <= CONVERSATION_TILE_DISTANCE) {
          this.startConversation(a, b);
          return; // 한 프레임에 하나의 대화만 시작
        }
      }
    }
  }

  private startConversation(a: Character, b: Character): void {
    // 기존 행동 타이머 및 콜백 정리
    for (const char of [a, b]) {
      const timer = this.behaviorTimers.get(char.characterId);
      if (timer) {
        timer.destroy();
        this.behaviorTimers.delete(char.characterId);
      }
      char.onArrival = null;
    }

    a.behaviorState = 'talking';
    b.behaviorState = 'talking';
    a.setAction(`💬 ${b.characterName}와(과) 대화 중`);
    b.setAction(`💬 ${a.characterName}와(과) 대화 중`);

    console.log(`Conversation started: ${a.characterName} <-> ${b.characterName}`);

    const duration = Phaser.Math.Between(CONVERSATION_DURATION_MIN, CONVERSATION_DURATION_MAX);
    const pairKey = [a.characterId, b.characterId].sort().join(':');

    this.scene.time.delayedCall(duration, () => {
      // 대화 종료 후 각각 다시 행동 시작
      if (this.characters.has(a.characterId)) {
        a.behaviorState = 'idle';
        this.executeBehavior(a.characterId);
      }
      if (this.characters.has(b.characterId)) {
        b.behaviorState = 'idle';
        this.executeBehavior(b.characterId);
      }

      this.conversationCooldowns.set(pairKey, Date.now() + CONVERSATION_COOLDOWN);
      console.log(`Conversation ended: ${a.characterName} <-> ${b.characterName}`);
    });
  }

  // ── 업데이트 루프 ──

  update(time: number, delta: number): void {
    this.characters.forEach(character => {
      character.update(time, delta);
    });

    // 근접 대화 체크 (1.5초마다)
    if (time - this.lastProximityCheck > PROXIMITY_CHECK_INTERVAL) {
      this.lastProximityCheck = time;
      this.checkProximityConversations();
    }
  }
}
