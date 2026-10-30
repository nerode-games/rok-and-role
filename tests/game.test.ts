import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseLevel } from '../src/game/level';
import { Dungeon, itemName } from '../src/game/engine';
import { decodeCheckpoint, readCheckpoint, SAVE_KEY, writeCheckpoint } from '../src/game/checkpoint';
import type { Direction, Level } from '../src/game/types';

const originalMap = readFileSync(new URL('../public/assets/0.dat', import.meta.url), 'utf8');
const level = parseLevel(originalMap);

function fresh(source: Level = level): Dungeon {
  return new Dungeon(source, undefined, 42);
}

function place(game: Dungeon, roomId: number, x: number, y: number, direction: Direction): void {
  game.state.roomId = roomId;
  if (!game.state.visited.includes(roomId)) game.state.visited.push(roomId);
  Object.assign(game.state.player, { x, y, direction });
}

describe('original level importer', () => {
  it('reads all ten rooms, nine entities, five items and ten doors without altering the map', () => {
    expect(level.rooms).toHaveLength(10);
    expect(level.entities).toHaveLength(9);
    expect(level.items).toHaveLength(5);
    expect(level.doors).toHaveLength(10);
    expect(level.start).toEqual({ roomId: 0, x: 1, y: 2 });
    expect(level.exit).toEqual({ roomId: 9, x: 1, y: 1 });
    expect(level.turnLimit).toBe(-1);
    expect(level.rooms[9].floors).toEqual([{ x: 1, y: 1, image: 12 }]);
  });

  it.each(['', 'garbage', originalMap.slice(0, -8), originalMap + '\nx', originalMap.replace('0 3 3 6 4', '0 0 3 6 4')])(
    'rejects malformed or incomplete maps', text => {
      expect(() => parseLevel(text)).toThrow();
    });

  it('accepts LF files and arbitrary whitespace', () => {
    const parsed = parseLevel(originalMap.replace(/\r/g, '').replace(/ /g, '   '));
    expect(parsed).toEqual(level);
  });

  it('rejects duplicate IDs, broken references and out-of-range starting points', () => {
    expect(() => parseLevel(originalMap.replace('1 5 0', '0 5 0'))).toThrow(/duplicados/);
    expect(() => parseLevel(originalMap.replace('0 11 0 2 0', '0 11 0 2 99'))).toThrow(/inexistente/);
    expect(() => parseLevel(originalMap.replace('0 1 2', '0 99 2'))).toThrow(/fuera/);
    expect(() => parseLevel(originalMap.replace('0 11 0 2 0', '0 14 0 2 0'))).toThrow();
  });
});

describe('first-level gameplay', () => {
  it('completes the original first level with actual moves, keys, combat and the healing potion', () => {
    const game = new Dungeon(level, undefined, 2);
    const steps = (actions: string) => {
      const commands = { F: 'forward', B: 'backward', L: 'left', R: 'right', A: 'attack' } as const;
      for (const command of actions) game.act(commands[command as keyof typeof commands]);
    };
    // Enter room 2, collect the key from the front of its chest, and unlock room 3.
    steps('FFFFFRFLLLA');
    expect(game.state.player.inventory.some(item => item.type === 0 && item.value === 1)).toBe(true);
    steps('RFRFF');
    expect(game.state.roomId).toBe(2);
    steps('FFFFF');
    expect(game.state.roomId).toBe(3);
    // Take the side corridor through room 6 to avoid the first two cubes.
    steps('FLFFRFFFF');
    expect(game.state.roomId).toBe(7);
    steps('FFL');
    for (let attack = 0; attack < 6 && !game.state.entities[5].removed && game.state.status === 'playing'; attack++) steps('A');
    expect(game.state.status, game.state.log.join('\n')).toBe('playing');
    expect(game.state.entities[5].removed).toBe(true);
    // Search the barrel, drink its healing potion, and use the goblin's key.
    steps('FFFLFA');
    const potion = game.state.player.inventory.findIndex(item => item.type === 4);
    expect(potion).toBeGreaterThanOrEqual(0);
    game.useItem(potion);
    steps('LFFLFF');
    expect(game.state.roomId).toBe(8);
    // Keep moving past the final cubes and step on the original exit tile.
    steps('LFRFFFFF');
    expect(game.state.status).toBe('cleared');
    expect(game.state.roomId).toBe(9);
    expect(game.state.player.hp).toBeGreaterThan(0);
  });

  it('allows one free rotation, charges the second, and wraps in both directions', () => {
    const game = fresh();
    expect(game.act('right').consumedTurn).toBe(false);
    expect(game.state.player.direction).toBe(3);
    expect(game.act('left').consumedTurn).toBe(true);
    expect(game.state.player.direction).toBe(0);
    expect(game.state.turn).toBe(1);
    expect(game.state.freeRotation).toBe(false);
  });

  it('moves backwards without changing orientation and does not charge blocked moves', () => {
    const game = fresh();
    game.act('backward');
    expect(game.state.turn).toBe(0);
    expect(game.state.player).toMatchObject({ x: 1, y: 2, direction: 0 });
    game.act('forward');
    expect(game.state.player).toMatchObject({ x: 1, y: 1, direction: 0 });
    game.act('backward');
    expect(game.state.player).toMatchObject({ x: 1, y: 2, direction: 0 });
  });

  it('crosses a bidirectional original door and uses its destination offset', () => {
    const game = fresh();
    game.act('forward'); game.act('forward');
    const outcome = game.act('forward');
    expect(outcome.changedRoom).toBe(true);
    expect(game.state.roomId).toBe(1);
    expect(game.state.player).toMatchObject({ x: 1, y: 3 });
    expect(game.state.visited).toEqual([0, 1]);
    game.state.player.direction = 2;
    game.act('forward');
    expect(game.state.roomId).toBe(0);
    expect(game.state.player).toMatchObject({ x: 1, y: 0 });
  });

  it('opens a chest from the front only and collects its key once', () => {
    const game = fresh();
    place(game, 1, 1, 2, 3);
    game.act('attack');
    expect(game.state.player.inventory).toHaveLength(2);
    place(game, 1, 0, 1, 2);
    game.act('attack');
    expect(game.state.player.inventory.at(-1)).toEqual({ id: 0, type: 0, value: 1 });
    game.act('attack');
    expect(game.state.player.inventory).toHaveLength(3);
    expect(game.state.log.at(-1)).toBe('Está vacío.');
  });

  it('requires the right key, consumes it automatically and leaves the door open on return', () => {
    const game = fresh();
    place(game, 1, 1, 0, 0);
    const blocked = game.act('forward');
    expect(blocked.consumedTurn).toBe(false);
    expect(game.state.roomId).toBe(1);
    game.state.player.inventory.push({ id: 3, type: 0, value: 8 });
    game.act('forward');
    expect(game.state.roomId).toBe(1);
    game.state.player.inventory.push({ id: 0, type: 0, value: 1 });
    game.act('forward');
    expect(game.state.roomId).toBe(2);
    expect(game.state.doors[1].open).toBe(true);
    expect(game.state.player.inventory.some(item => item.type === 0 && item.value === 1)).toBe(false);
    game.state.player.direction = 2;
    game.act('forward');
    expect(game.state.roomId).toBe(1);
  });

  it('blocks movement through containers', () => {
    const game = fresh();
    place(game, 1, 0, 1, 2);
    expect(game.act('forward').consumedTurn).toBe(false);
    expect(game.state.player.y).toBe(1);
  });

  it('keeps inventory reading free, prevents actions while reading, and explains automatic keys', () => {
    const game = fresh();
    game.state.player.inventory.push({ id: 1, type: 5, value: 0 }, { id: 0, type: 0, value: 1 });
    expect(game.useItem(3).consumedTurn).toBe(false);
    expect(game.state.log.at(-1)).toContain('automáticamente');
    expect(game.useItem(2).consumedTurn).toBe(false);
    expect(game.state.parchment).toBe(0);
    game.act('forward');
    expect(game.state.player.y).toBe(2);
    game.state.parchment = null;
    expect(game.useItem(999).consumedTurn).toBe(false);
  });

  it('equips items and applies healing without exceeding maximum vitality', () => {
    const game = fresh();
    game.state.player.inventory.push({ id: 4, type: 4, value: 5 });
    game.state.player.hp = 8;
    expect(game.useItem(2).consumedTurn).toBe(true);
    expect(game.state.player.hp).toBe(10);
    expect(game.state.player.inventory).toHaveLength(2);
    game.state.player.inventory.push({ id: 5, type: 1, value: 1 }, { id: 6, type: 2, value: 1 });
    game.useItem(2); game.useItem(3);
    expect(game.state.player).toMatchObject({ weapon: 1, armor: 1 });
  });

  it('applies temporary effects, blocks stacking and expires them by turn', () => {
    const game = fresh();
    game.state.player.inventory.push({ id: 5, type: 3, value: 0 }, { id: 6, type: 4, value: 1 });
    game.useItem(2);
    expect(game.state.effect).toEqual({ kind: 0, turns: 9, value: 5 });
    expect(game.useItem(2).consumedTurn).toBe(false);
    expect(game.state.player.inventory).toHaveLength(3);
    for (let i = 0; i < 9; i++) game.act('wait');
    expect(game.state.effect).toBeNull();
  });

  it('attacks only the front cell and lets a small cube retaliate', () => {
    const game = fresh();
    place(game, 4, 0, 0, 2);
    const enemy = game.state.entities.find(entity => entity.id === 3)!;
    const result = game.act('attack');
    expect(result.attacked).toBe(true);
    expect(game.state.log.some(line => line.includes('Golpeas') || line.includes('bloquea'))).toBe(true);
    expect(enemy.hp).toBeLessThan(2);
    if (!enemy.removed) expect(game.state.player.hp).toBeLessThan(10);
  });

  it('awards loot and experience once, and levels up with restored vitality', () => {
    const game = fresh();
    place(game, 7, 2, 0, 1);
    const enemy = game.state.entities.find(entity => entity.id === 5)!;
    enemy.hp = 1;
    game.state.player.xp = 90;
    game.state.player.hp = 4;
    game.act('attack');
    expect(enemy.removed).toBe(true);
    expect(game.state.player.inventory.some(item => item.type === 0 && item.value === 8)).toBe(true);
    expect(game.state.player).toMatchObject({ level: 1, xp: 110, nextXp: 300, hp: 15, maxHp: 15 });
    game.act('attack');
    expect(game.state.player.xp).toBe(110);
  });

  it('lets humanoids turn to face an adjacent player before attacking', () => {
    const game = fresh();
    place(game, 7, 2, 0, 1);
    game.act('wait');
    const goblin = game.state.entities.find(entity => entity.id === 5)!;
    expect(goblin.direction).toBe(3);
    expect(game.state.player.hp).toBeLessThan(10);
  });

  it('doubles enemy damage from the side or rear and preserves seeded results', () => {
    const facing = fresh();
    const exposed = fresh();
    place(facing, 4, 0, 0, 2);
    place(exposed, 4, 0, 0, 0);
    facing.act('wait'); exposed.act('wait');
    expect(10 - exposed.state.player.hp).toBe((10 - facing.state.player.hp) * 2);
  });

  it('does not let enemies share occupied squares while approaching', () => {
    const game = fresh();
    place(game, 8, 2, 2, 0);
    game.act('wait');
    const positions = game.entities.map(entity => `${entity.x},${entity.y}`);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions).not.toContain(`${game.state.player.x},${game.state.player.y}`);
  });

  it('ends the game on death and rejects subsequent actions', () => {
    const game = fresh();
    place(game, 4, 0, 0, 2);
    game.state.player.hp = 1;
    game.act('wait');
    expect(game.state.status).toBe('dead');
    const snapshot = structuredClone(game.state);
    game.act('forward'); game.useItem(0);
    expect(game.state).toEqual(snapshot);
  });

  it('clears the chapter at its original exit and waits for the next-chapter action', () => {
    const game = fresh();
    place(game, 9, 1, 2, 0);
    game.act('forward');
    expect(game.state.status).toBe('cleared');
    expect(game.state.turn).toBe(1);
    expect(game.state.player.hp).toBe(10);
  });

  it('enforces a finite turn limit', () => {
    const game = fresh({ ...structuredClone(level), turnLimit: 1 });
    game.act('wait');
    expect(game.state.status).toBe('dead');
  });

  it('names equipment, keys, potions and parchments', () => {
    expect(itemName({ id: 0, type: 0, value: 1 })).toBe('Llave');
    expect(itemName({ id: 1, type: 1, value: 0 })).toBe('DAGGER');
    expect(itemName({ id: 1, type: 5, value: 1 })).toBe('Pergamino 2');
  });
});

describe('local checkpoints', () => {
  it('round-trips the complete level state and resumes the same random sequence', () => {
    const game = fresh();
    place(game, 4, 0, 0, 2);
    const text = JSON.stringify(game.state);
    const restored = new Dungeon(level, decodeCheckpoint(text, level));
    game.act('wait'); restored.act('wait');
    expect(restored.state).toEqual(game.state);
  });

  it.each(['null', '{}', '{', 'x'.repeat(128001)])('rejects corrupt saved data', text => {
    expect(() => decodeCheckpoint(text, level)).toThrow();
  });

  it('rejects invalid player, entity, inventory, door and effect data', () => {
    const game = fresh();
    const mutations = [
      (state: typeof game.state) => { state.player.x = 999; },
      (state: typeof game.state) => { state.entities[0].id = 999; },
      (state: typeof game.state) => { state.doors[0].open = 'true' as unknown as boolean; },
      (state: typeof game.state) => { state.player.inventory[0].value = 999; },
      (state: typeof game.state) => { state.effect = { kind: 0, turns: 999, value: 2 }; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(game.state);
      mutate(copy);
      expect(() => decodeCheckpoint(JSON.stringify(copy), level)).toThrow();
    }
  });

  it('uses authoritative map topology when restoring door open states', () => {
    const game = fresh();
    game.state.doors[0].from.x = 999;
    const restored = decodeCheckpoint(JSON.stringify(game.state), level);
    expect(restored.doors[0].from.x).toBe(1);
  });

  it('handles absent, working and inaccessible browser storage', () => {
    const memory = new Map<string, string>();
    const store = { getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); } };
    expect(readCheckpoint(store, level)).toEqual({ state: null, warning: null });
    expect(writeCheckpoint(store, fresh().state)).toBe(true);
    expect(memory.has(SAVE_KEY)).toBe(true);
    expect(readCheckpoint(store, level).state).toEqual(fresh().state);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const denied = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
    expect(readCheckpoint(denied, level).warning).toContain('guardado');
    expect(writeCheckpoint(denied, fresh().state)).toBe(false);
    warning.mockRestore();
  });
});
