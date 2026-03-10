/**
 * CharacterManager
 * 캐릭터 생성, 관리, 시간 기반 행동 로직 - 1_oneCompany에서 이식
 * 맵 크기에 맞게 조정 (20x10 타일)
 */

import Phaser from 'phaser';
import { Character } from '../entities/Character';
import type { CharacterData } from '../types';
import { AVATAR_COLORS } from '../types';
import { MAP_CONFIG } from '../config/gameConfig';
import { getSpawnLocations, getBlockedTiles, isWalkableTile } from '../config/officeMapData';
import { GameTimeManager } from './GameTimeManager';

// ── 행동 정의 (한글화) ──

interface BehaviorDef {
  id: string;
  action: string;
  emoji: string;
  duration: number; // ms
  locationId?: string; // 스폰 위치 id
}

const BEHAVIORS: BehaviorDef[] = [
  { id: 'idle', action: '서 있는 중', emoji: '🧍', duration: 4000 },
  { id: 'walk', action: '걷는 중', emoji: '🚶', duration: 2500 },
  { id: 'coffee', action: '커피 마시는 중', emoji: '☕', duration: 6000, locationId: 'break_area' },
  { id: 'work', action: '책상에서 일하는 중', emoji: '💻', duration: 10000, locationId: 'work_area' },
  { id: 'meeting', action: '회의 중', emoji: '📋', duration: 8000, locationId: 'meeting_area' },
  { id: 'lunch', action: '점심 먹는 중', emoji: '🍽️', duration: 8000, locationId: 'break_area' },
  { id: 'rest', action: '휴식 중', emoji: '😌', duration: 5000, locationId: 'break_area' },
  { id: 'park_walk', action: '산책 중', emoji: '🌳', duration: 6000 },
];

const BEHAVIOR_MAP = new Map(BEHAVIORS.map((b) => [b.id, b]));

// ── 시간대별 행동 확률 테이블 ──

interface TimeSlot {
  start: number;
  end: number;
  weights: Record<string, number>;
}

const TIME_BEHAVIOR_TABLE: TimeSlot[] = [
  { start: 6, end: 9, weights: { walk: 2, coffee: 3, idle: 1 } },
  { start: 9, end: 12, weights: { work: 5, meeting: 2, coffee: 1, idle: 1 } },
  { start: 12, end: 13, weights: { lunch: 5, walk: 2, rest: 1 } },
  { start: 13, end: 18, weights: { work: 4, meeting: 2, rest: 1, coffee: 1, idle: 1 } },
  { start: 18, end: 22, weights: { park_walk: 3, rest: 2, walk: 2, idle: 1 } },
];

const DEFAULT_WEIGHTS: Record<string, number> = { idle: 3, walk: 2, rest: 1 };

// ── 대화 설정 ──

const CONVERSATION_TILE_DISTANCE = 2;
const CONVERSATION_DURATION_MIN = 5000;
const CONVERSATION_DURATION_MAX = 8000;
const CONVERSATION_COOLDOWN = 10000;
const PROXIMITY_CHECK_INTERVAL = 1200;

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
  private blockedTiles: Set<string>;

  // Agent ID <-> Character ID 매핑
  private agentIdToCharacterId: Map<string, string> = new Map();
  private characterIdToAgentId: Map<string, string> = new Map();

  // Backend-driven 모드 (true이면 TIME_BEHAVIOR_TABLE 로컬 행동 루프 건너뜀)
  private isBackendDriven: boolean = false;

  constructor(scene: Phaser.Scene, gameTimeManager: GameTimeManager) {
    this.scene = scene;
    this.gameTimeManager = gameTimeManager;
    this.blockedTiles = getBlockedTiles();
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
    tileY: number,
    agentId?: string
  ): Character {
    const id = `char_${++this.idCounter}`;
    const spriteType = AVATAR_COLORS.findIndex((c) => c.id === avatarColorId);
    const finalSpriteType = spriteType >= 0 ? spriteType : 0;

    const data: CharacterData = {
      id,
      name,
      occupation,
      spriteType: finalSpriteType,
      x: tileX,
      y: tileY,
    };

    const character = new Character(this.scene, data);
    character.getGameTimeString = () => {
      return this.gameTimeManager.getTimeString();
    };
    this.characters.set(id, character);

    // Agent ID 매핑 저장
    if (agentId) {
      this.agentIdToCharacterId.set(agentId, id);
      this.characterIdToAgentId.set(id, agentId);
    }

    // Backend-driven 모드가 아닐 때만 로컬 행동 루프 시작
    if (!this.isBackendDriven) {
      const initialDelay = Phaser.Math.Between(1000, 2000);
      const timer = this.scene.time.delayedCall(initialDelay, () => {
        this.executeBehavior(id);
      });
      this.behaviorTimers.set(id, timer);
    }

    console.log(`Character created: ${name} (${id})${agentId ? ` agentId=${agentId}` : ''} at (${tileX}, ${tileY})`);
    return character;
  }

  /**
   * Backend에서 받은 agent_id로 캐릭터 자동 생성 (미등록 agent_id 처리)
   */
  createFromBackend(
    agentId: string,
    name?: string,
    tileX: number = 5,
    tileY: number = 5,
  ): Character {
    const avatarIds = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'cyan', 'yellow'];
    const avatarColorId = avatarIds[this.idCounter % avatarIds.length];
    const displayName = name || `Agent_${agentId.slice(0, 6)}`;
    console.log(`[CharacterManager] Auto-creating character for backend agent: ${agentId} as "${displayName}"`);
    return this.createCharacter(displayName, 'Agent', avatarColorId, tileX, tileY, agentId);
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

      // Agent ID 매핑 정리
      const agentId = this.characterIdToAgentId.get(id);
      if (agentId) {
        this.agentIdToCharacterId.delete(agentId);
        this.characterIdToAgentId.delete(id);
      }

      // 대화 쿨다운 정리
      Array.from(this.conversationCooldowns.keys()).forEach((key) => {
        if (key.includes(id)) {
          this.conversationCooldowns.delete(key);
        }
      });
    }
  }

  getCharacterCount(): number {
    return this.characters.size;
  }

  /** Agent ID로 캐릭터 조회 */
  getCharacterByAgentId(agentId: string): Character | undefined {
    const charId = this.agentIdToCharacterId.get(agentId);
    if (!charId) return undefined;
    return this.characters.get(charId);
  }

  /** Character ID로 Agent ID 조회 */
  getAgentIdByCharacterId(characterId: string): string | undefined {
    return this.characterIdToAgentId.get(characterId);
  }

  /** Backend-driven 모드 설정 */
  setBackendDriven(enabled: boolean): void {
    if (this.isBackendDriven === enabled) return;
    this.isBackendDriven = enabled;

    if (enabled) {
      // 로컬 행동 타이머 모두 중지
      this.behaviorTimers.forEach((timer) => timer.destroy());
      this.behaviorTimers.clear();
      this.characters.forEach((char) => {
        char.onArrival = null;
      });
    } else {
      // 로컬 행동 루프 재시작
      this.characters.forEach((_, id) => {
        if (!this.behaviorTimers.has(id)) {
          const delay = Phaser.Math.Between(1000, 2000);
          const timer = this.scene.time.delayedCall(delay, () => {
            this.executeBehavior(id);
          });
          this.behaviorTimers.set(id, timer);
        }
      });
    }

    console.log(`[CharacterManager] Backend-driven mode: ${enabled}`);
  }

  /** Backend-driven 모드 확인 */
  getIsBackendDriven(): boolean {
    return this.isBackendDriven;
  }

  /** Backend에서 받은 액션 적용 */
  applyBackendAction(agentId: string, action: string, position?: { x: number; y: number }): void {
    const char = this.getCharacterByAgentId(agentId);
    if (!char) return;

    if (position) {
      char.moveToTile(position.x, position.y);
      char.onArrival = () => {
        char.setAction(action);
      };
    } else {
      char.setAction(action);
    }
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

    // Backend-driven 모드이면 로컬 행동 건너뜀
    if (this.isBackendDriven) return;

    // 대화 중이면 나중에 재시도
    if (character.behaviorState === 'talking') {
      const timer = this.scene.time.delayedCall(2000, () => this.executeBehavior(id));
      this.behaviorTimers.set(id, timer);
      return;
    }

    const behavior = this.selectBehavior();

    if (behavior.locationId) {
      // 위치 기반 행동: 목적지로 이동 후 수행
      const location = getSpawnLocations().find((l) => l.id === behavior.locationId);
      if (location) {
        let targetX: number, targetY: number;
        let attempts = 0;
        do {
          targetX = Phaser.Math.Clamp(
            location.x + Phaser.Math.Between(-1, 1),
            1,
            MAP_CONFIG.width - 2
          );
          targetY = Phaser.Math.Clamp(
            location.y + Phaser.Math.Between(-1, 1),
            1,
            MAP_CONFIG.height - 2
          );
          attempts++;
        } while (!isWalkableTile(targetX, targetY, this.blockedTiles) && attempts < 5);

        character.behaviorState = 'moving';
        character.moveToTile(targetX, targetY);
        character.onArrival = () => {
          this.performAction(id, character, behavior);
        };
      } else {
        this.performAction(id, character, behavior);
      }
    } else if (behavior.id === 'walk' || behavior.id === 'park_walk') {
      // 랜덤 걷기 (walk, park_walk)
      character.behaviorState = 'moving';
      this.moveToRandomWalkable(character);
      character.onArrival = () => {
        character.behaviorState = 'idle';
        character.setAction('🧍 서 있는 중', false);
        const delay = Phaser.Math.Between(800, 2000);
        const timer = this.scene.time.delayedCall(delay, () => this.executeBehavior(id));
        this.behaviorTimers.set(id, timer);
      };
    } else {
      // 제자리 행동 (idle, rest)
      this.performAction(id, character, behavior);
    }
  }

  private moveToRandomWalkable(character: Character): void {
    const currentTileX = Math.floor(character.x / MAP_CONFIG.tileSize);
    const currentTileY = Math.floor(character.y / MAP_CONFIG.tileSize);

    let attempts = 0;
    let targetX: number, targetY: number;
    do {
      const offsetX = Phaser.Math.Between(-2, 2);
      const offsetY = Phaser.Math.Between(-2, 2);
      targetX = Phaser.Math.Clamp(currentTileX + offsetX, 1, MAP_CONFIG.width - 2);
      targetY = Phaser.Math.Clamp(currentTileY + offsetY, 1, MAP_CONFIG.height - 2);
      attempts++;
    } while (!isWalkableTile(targetX, targetY, this.blockedTiles) && attempts < 5);

    character.moveToTile(targetX, targetY);
  }

  private performAction(id: string, character: Character, behavior: BehaviorDef): void {
    const actionText = behavior.emoji ? `${behavior.emoji} ${behavior.action}` : behavior.action;
    character.setAction(actionText);
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

        // 둘 다 대화 가능한 상태여야 함
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
    this.characters.forEach((character) => {
      character.update(time, delta);
    });

    // 근접 대화 체크 (backend-driven 모드에서는 로컬 근접 대화 비활성화)
    if (!this.isBackendDriven && time - this.lastProximityCheck > PROXIMITY_CHECK_INTERVAL) {
      this.lastProximityCheck = time;
      this.checkProximityConversations();
    }
  }
}
