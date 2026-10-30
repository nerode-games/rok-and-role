import { catalog } from './catalog.generated';
import { Dungeon } from './engine';
import { FINAL_LEVEL, isPlate } from './rules';
import type { AdventureSave, GameState, Item, Level } from './types';

// Keep the prototype slot intact so an existing first-level game can be imported.
export const SAVE_KEY = 'rok-and-role:first-entry:v1';
export const ADVENTURE_SAVE_KEY = 'rok-and-role:adventure:v2';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export interface SavedGame { state: GameState | null; warning: string | null }
export interface SavedAdventure { save: AdventureSave | null; warning: string | null }

const isInteger = (value: unknown, min = 0, max = 1_000_000): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

function validItem(item: Item): boolean {
  const limits = [10000, 11, 6, 5, 5, catalog.PERGAMINO_BODY.length - 1];
  if (!item || !isInteger(item.id, -2) || !isInteger(item.type, 0, 5) || !isInteger(item.value, 0, limits[item.type])) return false;
  const limited = item.type === 1 && item.value === 7 || item.type === 2 && item.value === 6;
  return limited ? isInteger(item.uses, 1, 10) : item.uses === undefined;
}

/** Adds chapter ownership to the first prototype's persisted entities. */
function migrateLegacy(data: Record<string, unknown>, level: Level): GameState {
  if (level.index !== 0) throw new Error('El guardado antiguo pertenece al primer capítulo.');
  const state = data as unknown as GameState;
  if (!Array.isArray(state.entities) || !Array.isArray(state.player?.inventory)) throw new Error('Guardado antiguo inválido.');
  state.entities = state.entities.map(entity => {
    const original = level.entities.find(entry => entry.id === entity.id);
    return { ...entity, roomId: original?.roomId ?? -1, pressed: false, links: [] };
  });
  state.player.inventory = state.player.inventory.map(item => {
    const limited = item.type === 1 && item.value === 7 || item.type === 2 && item.value === 6;
    return limited ? { ...item, uses: 10 } : item;
  });
  return { ...state, version: 2, levelIndex: 0, totalTurns: state.turn, remainingTurns: -1,
    status: state.status === 'victory' ? 'cleared' : state.status };
}

function validateEntities(state: GameState, level: Level): void {
  if (!Array.isArray(state.entities) || state.entities.length < level.entities.length || state.entities.length > 5000 ||
      state.entities.some(entity => !entity) || new Set(state.entities.map(entity => entity.id)).size !== state.entities.length) {
    throw new Error('Lista de entidades inválida.');
  }
  const lastOriginalId = Math.max(-1, ...level.entities.map(entity => entity.id));
  for (const entity of state.entities) {
    const original = level.entities.find(entry => entry.id === entity.id);
    const room = level.rooms.find(room => room.id === entity.roomId);
    const validType = original ? entity.type === original.type && entity.roomId === original.roomId :
      entity.id > lastOriginalId && isInteger(entity.type, 0, 9) && entity.objectId === -1;
    if (!room || !validType || !isInteger(entity.id) || !isInteger(entity.direction, 0, 3) ||
        !isInteger(entity.hp, -10000, catalog.MONSTER_VITALITY[entity.type]) || typeof entity.removed !== 'boolean' ||
        typeof entity.pressed !== 'boolean' || !isInteger(entity.x, 0, room.width - 1) || !isInteger(entity.y, 0, room.height - 1) ||
        (original && ![original.objectId, -1].includes(entity.objectId))) {
      throw new Error('Datos de entidades inválidos.');
    }
    entity.links = original ? [...original.links] : [];
    if (!isPlate(entity.type)) entity.pressed = false;
  }
  if (level.entities.some(original => !state.entities.some(entity => entity.id === original.id))) {
    throw new Error('Faltan entidades originales.');
  }
}

/** Validates browser storage against the authoritative map and sprite catalog. */
export function decodeCheckpoint(text: string, level: Level): GameState {
  if (text.length > 2_000_000) throw new Error('Guardado demasiado grande.');
  const data = JSON.parse(text) as Record<string, unknown>;
  if (!data || typeof data !== 'object') throw new Error('Formato de guardado inválido.');
  const state = data.version === 1 ? migrateLegacy(data, level) : data as unknown as GameState;
  if (state.version !== 2 || state.levelIndex !== level.index || !['playing', 'dead', 'cleared', 'victory'].includes(state.status)) {
    throw new Error('Versión o capítulo de guardado no compatible.');
  }
  const room = level.rooms.find(room => room.id === state.roomId);
  const player = state.player;
  if (!room || !player || !isInteger(player.x, 0, room.width - 1) || !isInteger(player.y, 0, room.height - 1) ||
      !isInteger(player.direction, 0, 3) || !isInteger(player.level, 0, 100) || player.maxHp !== 10 + player.level * 5 ||
      !isInteger(player.hp, 0, player.maxHp) || !isInteger(player.xp) || !isInteger(player.nextXp, 1) ||
      !isInteger(player.weapon, 0, 11) || !isInteger(player.armor, 0, 6) ||
      !Array.isArray(player.inventory) || player.inventory.length > 1000 || !player.inventory.every(validItem) ||
      !player.inventory.some(item => item.type === 1 && item.value === player.weapon) ||
      !player.inventory.some(item => item.type === 2 && item.value === player.armor)) {
    throw new Error('Datos del personaje inválidos.');
  }
  validateEntities(state, level);
  if (!Array.isArray(state.doors) || state.doors.length !== level.doors.length ||
      state.doors.some(door => !door) || new Set(state.doors.map(door => door.id)).size !== level.doors.length ||
      state.doors.some(door => !level.doors.some(original => original.id === door.id) || typeof door.open !== 'boolean')) {
    throw new Error('Datos de puertas inválidos.');
  }
  state.doors = level.doors.map(door => ({ ...structuredClone(door), open: state.doors.find(saved => saved.id === door.id)!.open }));
  if (!isInteger(state.turn) || !isInteger(state.totalTurns, state.turn) || !isInteger(state.rng, 1, 0xffffffff) ||
      (level.turnLimit === -1 ? state.remainingTurns !== -1 : !isInteger(state.remainingTurns, 0, level.turnLimit)) ||
      typeof state.freeRotation !== 'boolean' || !Array.isArray(state.visited) ||
      new Set(state.visited).size !== state.visited.length || state.visited.length > level.rooms.length ||
      !state.visited.includes(state.roomId) || state.visited.some(id => !level.rooms.some(room => room.id === id)) ||
      !Array.isArray(state.log) || state.log.length > 30 || state.log.some(line => typeof line !== 'string' || line.length > 500) ||
      (state.parchment !== null && !isInteger(state.parchment, 0, catalog.PERGAMINO_BODY.length - 1)) ||
      (state.effect !== null && (!state.effect || !isInteger(state.effect.kind, 0, 4) ||
        !isInteger(state.effect.turns, 1, 20) || !isInteger(state.effect.value, 0, 5))) ||
      (state.status === 'dead' ? player.hp !== 0 : player.hp === 0) ||
      (state.status === 'victory' && (level.index !== FINAL_LEVEL || state.entities.some(entity => entity.type === 19 && !entity.removed)))) {
    throw new Error('Estado de partida inválido.');
  }
  return state;
}

export function decodeAdventure(text: string, levels: Level[]): AdventureSave {
  if (text.length > 4_000_000) throw new Error('Guardado demasiado grande.');
  const data = JSON.parse(text) as AdventureSave;
  if (!data || data.version !== 2 || !isInteger(data.current?.levelIndex, 0, FINAL_LEVEL) ||
      data.entry?.levelIndex !== data.current.levelIndex) throw new Error('Guardado de aventura inválido.');
  const level = levels[data.current.levelIndex];
  const current = decodeCheckpoint(JSON.stringify(data.current), level);
  const entry = decodeCheckpoint(JSON.stringify(data.entry), level);
  if (entry.status !== 'playing' || entry.turn !== 0 || entry.roomId !== level.start.roomId ||
      entry.player.x !== level.start.x || entry.player.y !== level.start.y) throw new Error('Punto de reintento inválido.');
  return { version: 2, current, entry };
}

export function readAdventure(store: Store, levels: Level[]): SavedAdventure {
  try {
    const text = store.getItem(ADVENTURE_SAVE_KEY);
    if (text) return { save: decodeAdventure(text, levels), warning: null };
    const legacy = store.getItem(SAVE_KEY);
    if (!legacy) return { save: null, warning: null };
    const current = decodeCheckpoint(legacy, levels[0]);
    return { save: { version: 2, current, entry: new Dungeon(levels[0], undefined, current.rng).state }, warning: null };
  } catch (error) {
    console.warn('Could not restore adventure.', error);
    return { save: null, warning: 'No se pudo recuperar el guardado local. Puedes empezar una aventura nueva.' };
  }
}

export function writeAdventure(store: Store, save: AdventureSave): boolean {
  return write(store, ADVENTURE_SAVE_KEY, save);
}

export function readCheckpoint(store: Store, level: Level): SavedGame {
  try {
    const text = store.getItem(SAVE_KEY);
    return { state: text ? decodeCheckpoint(text, level) : null, warning: null };
  } catch (error) {
    console.warn('Could not restore local checkpoint.', error);
    return { state: null, warning: 'No se pudo recuperar el guardado local. Puedes empezar una partida nueva.' };
  }
}

export function writeCheckpoint(store: Store, state: GameState): boolean {
  return write(store, SAVE_KEY, state);
}

function write(store: Store, key: string, value: GameState | AdventureSave): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn('Could not save local checkpoint.', error);
    return false;
  }
}
