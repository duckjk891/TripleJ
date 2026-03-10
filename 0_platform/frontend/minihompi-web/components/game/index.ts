// Types
export * from './types';

// Config
export * from './config/gameConfig';
export * from './config/worldTree';
export {
  ROOM_TILES, INTERIOR_TILES, FLOOR_LAYER, OBJECT_TYPE, OBJECT_LAYER,
  COLLISION_LAYER, OFFICE_AREAS, OBJECT_RENDER_INFO,
  getSpawnLocations as getMapSpawnLocations,
  findAreaById, isInArea, getAreaNameAt, getBlockedTiles, isWalkableTile,
} from './config/officeMapData';
export type { AreaDefinition } from './config/officeMapData';

// Bridge
export { GameBridge, gameBridge } from './bridge/GameBridge';

// Systems
export { CharacterManager } from './systems/CharacterManager';
export { GameTimeManager } from './systems/GameTimeManager';
export { MapRenderer } from './systems/MapRenderer';

// Entities
export { Character } from './entities/Character';

// Scenes
export { OfficeScene } from './scenes/OfficeScene';
export { OfficeUIScene } from './scenes/OfficeUIScene';

// Services
export * as gameApi from './services/api';
