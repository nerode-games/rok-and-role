import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseLevel } from '../src/game/level';
import { Dungeon, DIRECTIONS } from '../src/game/engine';
import { Adventure } from '../src/game/adventure';
import { ADVENTURE_SAVE_KEY, decodeAdventure, decodeCheckpoint, readAdventure, SAVE_KEY, writeAdventure } from '../src/game/checkpoint';
import { FINAL_LEVEL, isEnemy, isPlate, Kind, Spell, Weapon } from '../src/game/rules';
import { catalog } from '../src/game/catalog.generated';
import type { Direction, Entity, Level } from '../src/game/types';

const levels = Array.from({ length: 9 }, (_, index) => {
  const map = readFileSync(new URL(`../public/assets/${index}.dat`, import.meta.url), 'utf8');
  try { return parseLevel(map, index); }
  catch (error) { throw new Error(`Original map ${index}: ${String(error)}`); }
});

describe('complete original campaign', () => {
  it('imports and round-trips the starting state of every original map', () => {
    expect(levels).toHaveLength(9);
    for (const level of levels) {
      const state = new Dungeon(level, undefined, 2).state;
      const restored = decodeCheckpoint(JSON.stringify(state), level);
      expect(restored).toEqual(state);
    }
    expect(levels.reduce((total, level) => total + level.rooms.length, 0)).toBe(204);
    expect(levels.reduce((total, level) => total + level.entities.length, 0)).toBe(328);
    expect(levels[6].turnLimit).toBe(100);
    expect(levels[8].entities.some(entity => entity.type === Kind.Master)).toBe(true);
  });

  it('connects every usable room and exit and places door arrivals inside their destinations', () => {
    for (const level of levels) {
      for (const door of level.doors) {
        for (const [side, direction] of [[door.from, door.fromDirection], [door.to, door.toDirection]] as const) {
          const room = level.rooms.find(room => room.id === side.roomId)!;
          const delta = DIRECTIONS[direction];
          expect(side.x + delta.x, `Chapter ${level.index}, door ${door.id}, X`).toBeGreaterThanOrEqual(0);
          expect(side.x + delta.x, `Chapter ${level.index}, door ${door.id}, X`).toBeLessThan(room.width);
          expect(side.y + delta.y, `Chapter ${level.index}, door ${door.id}, Y`).toBeGreaterThanOrEqual(0);
          expect(side.y + delta.y, `Chapter ${level.index}, door ${door.id}, Y`).toBeLessThan(room.height);
        }
      }
      const visited = new Set([level.start.roomId]);
      const queue = [level.start.roomId];
      while (queue.length) {
        const roomId = queue.shift();
        const room = level.rooms.find(room => room.id === roomId)!;
        for (const id of room.doorIds) {
          const door = level.doors.find(door => door.id === id)!;
          const next = door.from.roomId === room.id ? door.to.roomId : door.from.roomId;
          if (!visited.has(next)) { visited.add(next); queue.push(next); }
        }
      }
      // The original Crystal Maze retains one unused room with no doors (ID 21).
      expect(level.rooms.filter(room => room.doorIds.length > 0).every(room => visited.has(room.id)),
        `Chapter ${level.index} connectivity`).toBe(true);
      expect(visited.has(level.exit!.roomId), `Chapter ${level.index} exit`).toBe(true);
    }
  });
});

/** Isolates a rule without changing any production code or exposing test controls. */
function arena(type: number = Kind.Orc, index = 0): Dungeon {
  const enemy: Entity = { id: 0, type, x: 3, y: 3, roomId: 0, hp: catalog.MONSTER_VITALITY[type],
    direction: 3, objectId: -1, pressed: false, removed: false, links: [] };
  const level: Level = { index, turnLimit: -1, start: { roomId: 0, x: 2, y: 3 }, exit: null,
    doors: [], entities: [enemy], items: [], rooms: [{ id: 0, width: 8, height: 8, floor: 6,
      wall: 4, floors: [], walls: [], doorIds: [], monsterIds: [0] }] };
  const game = new Dungeon(level, undefined, 2);
  game.state.player.direction = 1;
  game.state.effect = { kind: Spell.Speed, turns: 20, value: 0 };
  return game;
}

function equip(game: Dungeon, value: number, uses?: number): void {
  game.state.player.inventory.push({ id: 1, type: 1, value, ...(uses === undefined ? {} : { uses }) });
  game.state.player.weapon = value;
}

function relocate(game: Dungeon, roomId: number, x: number, y: number, direction: Direction): void {
  game.state.roomId = roomId;
  if (!game.state.visited.includes(roomId)) game.state.visited.push(roomId);
  Object.assign(game.state.player, { x, y, direction });
}

function plateFixture(type: number): { game: Dungeon; plate: Entity } {
  const level = levels.find(level => level.entities.some(entity => entity.type === type))!;
  const game = new Dungeon(level, undefined, 2);
  for (const entity of game.state.entities) if (isEnemy(entity.type)) entity.removed = true;
  const plate = game.state.entities.find(entity => entity.type === type && entity.x > 0 && entity.links.length)!;
  const room = level.rooms.find(room => room.id === plate.roomId)!;
  const direction = DIRECTIONS.findIndex(delta => {
    const point = { x: plate.x - delta.x, y: plate.y - delta.y };
    return point.x >= 0 && point.y >= 0 && point.x < room.width && point.y < room.height &&
      !game.state.entities.some(entity => entity.roomId === plate.roomId && !entity.removed && !isPlate(entity.type) && entity.x === point.x && entity.y === point.y);
  }) as Direction;
  const delta = DIRECTIONS[direction];
  relocate(game, plate.roomId, plate.x - delta.x, plate.y - delta.y, direction);
  game.state.effect = { kind: Spell.Invulnerable, turns: 20, value: 0 };
  return { game, plate };
}

describe('chapter continuity and retries', () => {
  it('carries stats, equipment, durability, effects and RNG through all eight transitions', () => {
    const adventure = new Adventure(levels);
    const player = adventure.dungeon.state.player;
    Object.assign(player, { level: 4, maxHp: 30, hp: 23, xp: 1000, nextXp: 1500, weapon: 7, armor: 6 });
    player.inventory.push({ id: 7, type: 1, value: 7, uses: 6 }, { id: 8, type: 2, value: 6, uses: 4 },
      { id: 9, type: 4, value: 5 });
    adventure.dungeon.state.effect = { kind: Spell.Strength, turns: 7, value: 5 };
    for (let index = 0; index < FINAL_LEVEL; index++) {
      const before = adventure.dungeon.state;
      before.status = 'cleared';
      before.player.inventory.push({ id: 20, type: 0, value: 0 }, { id: 21, type: 5, value: 0 });
      before.turn = 10;
      before.totalTurns += 10;
      const rng = before.rng;
      expect(adventure.advance()).toBe(true);
      const current = adventure.dungeon.state;
      expect(current).toMatchObject({ levelIndex: index + 1, status: 'playing', turn: 0,
        totalTurns: (index + 1) * 10, rng, remainingTurns: levels[index + 1].turnLimit });
      expect(current.player).toMatchObject({ level: 4, hp: 23, maxHp: 30, xp: 1000, nextXp: 1500, weapon: 7, armor: 6 });
      expect(current.player.inventory.some(item => item.type === 0 || item.type === 5)).toBe(false);
      expect(current.player.inventory.find(item => item.type === 1 && item.value === 7)?.uses).toBe(6);
      expect(current.player.inventory.find(item => item.type === 2 && item.value === 6)?.uses).toBe(4);
      expect(current.effect).toEqual({ kind: Spell.Strength, turns: 7, value: 5 });
      expect(decodeAdventure(JSON.stringify(adventure.snapshot()), levels)).toEqual(adventure.snapshot());
    }
    expect(adventure.advance()).toBe(false);
  });

  it('cannot skip a live or dead chapter', () => {
    const adventure = new Adventure(levels);
    expect(adventure.advance()).toBe(false);
    adventure.dungeon.state.status = 'dead';
    expect(adventure.advance()).toBe(false);
    expect(() => new Adventure(levels.slice(0, 8))).toThrow();
  });

  it('retries from the chapter entry with the original health, equipment and puzzle state', () => {
    const adventure = new Adventure(levels);
    adventure.dungeon.state.player.hp = 7;
    adventure.dungeon.state.player.inventory.push({ id: 2, type: 4, value: 5 });
    adventure.dungeon.state.status = 'cleared';
    adventure.advance();
    const entry = structuredClone(adventure.dungeon.state);
    adventure.dungeon.state.player.hp = 0;
    adventure.dungeon.state.player.inventory.pop();
    adventure.dungeon.state.doors[0].open = !adventure.dungeon.state.doors[0].open;
    adventure.dungeon.state.status = 'dead';
    const restored = new Adventure(levels, decodeAdventure(JSON.stringify(adventure.snapshot()), levels));
    restored.retry();
    expect(restored.dungeon.state.player).toEqual(entry.player);
    expect(restored.dungeon.state.doors).toEqual(entry.doors);
    expect(restored.dungeon.state.entities).toEqual(entry.entities);
    expect(restored.dungeon.state.levelIndex).toBe(1);
    expect(restored.dungeon.state.status).toBe('playing');
  });

  it('migrates prototype saves, including a completed first level, without modifying the old slot', () => {
    const legacy = structuredClone(new Dungeon(levels[0], undefined, 2).state) as unknown as Record<string, unknown>;
    legacy.version = 1;
    legacy.status = 'victory';
    delete legacy.levelIndex; delete legacy.remainingTurns; delete legacy.totalTurns;
    const text = JSON.stringify(legacy);
    const values = new Map([[SAVE_KEY, text]]);
    const store = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    const result = readAdventure(store, levels);
    expect(result.warning).toBeNull();
    expect(result.save?.current.status).toBe('cleared');
    const adventure = new Adventure(levels, result.save!);
    expect(adventure.advance()).toBe(true);
    expect(writeAdventure(store, adventure.snapshot())).toBe(true);
    expect(values.get(SAVE_KEY)).toBe(text);
    expect(readAdventure(store, levels).save?.current.levelIndex).toBe(1);
    expect(values.has(ADVENTURE_SAVE_KEY)).toBe(true);
  });

  it('handles missing or inaccessible campaign storage and rejects mismatched retry chapters', () => {
    const empty = { getItem: () => null, setItem: () => {} };
    expect(readAdventure(empty, levels)).toEqual({ save: null, warning: null });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const denied = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
    expect(readAdventure(denied, levels).warning).toContain('guardado');
    expect(writeAdventure(denied, new Adventure(levels).snapshot())).toBe(false);
    warning.mockRestore();
    const save = new Adventure(levels).snapshot();
    save.entry.levelIndex = 1;
    expect(() => decodeAdventure(JSON.stringify(save), levels)).toThrow();
  });
});

describe('original pressure plates and spawned enemies', () => {
  it('toggles every linked door exactly once for a single-use plate', () => {
    const { game, plate } = plateFixture(Kind.Plate);
    const before = game.state.doors.map(door => door.open);
    game.act('forward');
    expect(plate.pressed).toBe(true);
    game.state.doors.forEach((door, index) => {
      expect(door.open).toBe(plate.links.includes(door.id) ? !before[index] : before[index]);
    });
    const opened = game.state.doors.map(door => door.open);
    game.act('backward'); game.act('forward');
    expect(game.state.doors.map(door => door.open)).toEqual(opened);
  });

  it('allows a repeatable switch to toggle its doors back on the next crossing', () => {
    const { game, plate } = plateFixture(Kind.Switch);
    const before = game.state.doors.map(door => door.open);
    game.act('forward'); game.act('backward'); game.act('forward');
    expect(plate.pressed).toBe(false);
    expect(game.state.doors.map(door => door.open)).toEqual(before);
  });

  it('triggers a plate when a monster steps on it', () => {
    const { game, plate } = plateFixture(Kind.Plate);
    const enemy = game.state.entities.find(entity => isEnemy(entity.type))!;
    Object.assign(enemy, { roomId: plate.roomId, x: plate.x - 1, y: plate.y, removed: false, type: Kind.SmallCube, hp: 2 });
    relocate(game, plate.roomId, plate.x + 1, plate.y, 3);
    game.state.effect = null;
    game.act('wait');
    expect(enemy.x).toBe(plate.x);
    expect(plate.pressed).toBe(true);
  });

  it('summons enemies into distinct free neighbors, only once, and persists the new IDs', () => {
    const { game, plate } = plateFixture(Kind.SummonPlate);
    const count = game.state.entities.length;
    game.act('forward');
    const spawned = game.state.entities.slice(count);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.length).toBeLessThanOrEqual(4);
    expect(spawned.every(entity => entity.type === plate.links[0] && entity.roomId === plate.roomId)).toBe(true);
    expect(new Set(spawned.map(entity => `${entity.x},${entity.y}`)).size).toBe(spawned.length);
    const restored = decodeCheckpoint(JSON.stringify(game.state), game.level);
    expect(restored.entities.slice(count)).toEqual(spawned);
    for (const entity of spawned) entity.removed = true;
    game.act('backward'); game.act('forward');
    expect(game.state.entities).toHaveLength(count + spawned.length);
  });

  it.each([Kind.LargeCube, Kind.MediumCube])('splits cube type %s into two smaller cubes with unique IDs', type => {
    const game = arena(type);
    equip(game, Weapon.Flame, 10);
    game.state.entities[0].hp = 1;
    game.act('attack');
    const children = game.entities;
    expect(children).toHaveLength(2);
    expect(children.every(entity => entity.type === type + 1 && entity.objectId === -1)).toBe(true);
    expect(new Set(children.map(entity => entity.id)).size).toBe(2);
    expect(new Set(children.map(entity => `${entity.x},${entity.y}`)).size).toBe(2);
    expect(decodeCheckpoint(JSON.stringify(game.state), game.level).entities).toEqual(game.state.entities);
  });

  it('does not create overlapping extra cubes when the room has no free neighbor', () => {
    const game = arena(Kind.LargeCube);
    equip(game, Weapon.Flame, 10);
    game.level.rooms[0].width = 4;
    game.level.rooms[0].height = 4;
    for (const [index, delta] of DIRECTIONS.entries()) {
      const point = { x: 3 + delta.x, y: 3 + delta.y };
      if (point.x < 4 && point.y < 4 && !(point.x === 2 && point.y === 3)) {
        game.state.entities.push({ ...game.state.entities[0], ...point, id: index + 1, type: Kind.Torch, hp: 0 });
      }
    }
    game.state.entities[0].hp = 1;
    game.act('attack');
    expect(game.entities.filter(entity => entity.type === Kind.MediumCube)).toHaveLength(1);
  });
});

describe('magic weapons, armor and enemy powers', () => {
  it('regenerates trolls on their turn and caps their health', () => {
    const game = arena(Kind.Troll);
    game.state.entities[0].hp = 5;
    game.state.effect = null;
    game.act('wait');
    expect(game.state.entities[0].hp).toBe(7);
  });

  it('uses mortal knives only when the attack actually penetrates defense', () => {
    const game = arena(Kind.Ogre);
    equip(game, Weapon.Knives);
    game.act('attack');
    expect(game.state.entities[0].removed).toBe(false);
    game.state.player.level = 15;
    game.act('attack');
    expect(game.state.entities[0].removed).toBe(true);
  });

  it('turns the flame sword into an ordinary sword after its final damaging use', () => {
    const game = arena(Kind.Ogre);
    equip(game, Weapon.Flame, 1);
    game.act('attack');
    expect(game.state.player.weapon).toBe(Weapon.Sword);
    expect(game.state.player.inventory.at(-1)).toMatchObject({ type: 1, value: Weapon.Sword });
    expect(game.state.player.inventory.at(-1)?.uses).toBeUndefined();
  });

  it('heals the wielder of the vampiric axe without exceeding maximum health', () => {
    const game = arena(Kind.SmallCube);
    equip(game, Weapon.Vampiric);
    game.state.player.hp = 9;
    game.act('attack');
    expect(game.state.player.hp).toBe(10);
  });

  it('pushes an enemy with the shock hammer, respecting blockers', () => {
    const game = arena(Kind.Ogre);
    equip(game, Weapon.Shock);
    game.act('attack');
    expect(game.state.entities[0].x).toBe(4);
    const wall = { ...game.state.entities[0], id: 1, type: Kind.Brazier, hp: 0, x: 5 };
    game.state.entities.push(wall);
    game.state.player.x = 3;
    game.act('attack');
    expect(game.state.entities[0].x).toBe(4);
  });

  it('ignores enemy armor with the biting axe', () => {
    const game = arena(Kind.Ogre);
    equip(game, Weapon.Biting);
    const rng = game.state.rng;
    let value = rng;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    const expectedDamage = 1 + (value >>> 0) % 8;
    game.act('attack');
    expect(game.state.entities[0].hp).toBe(35 - expectedDamage);
  });

  it('expires bone armor after its final received damaging hit', () => {
    const game = arena(Kind.Ogre);
    game.state.effect = null;
    game.state.player.armor = 6;
    game.state.player.inventory.push({ id: 1, type: 2, value: 6, uses: 1 });
    // The ogre's minimum attack can be blocked, so wait for one penetrating hit.
    for (let turn = 0; turn < 10 && game.state.player.armor === 6 && game.state.status === 'playing'; turn++) game.act('wait');
    expect(game.state.player.armor).toBe(0);
    expect(game.state.player.inventory.some(item => item.type === 2 && item.value === 6)).toBe(false);
  });

  it('keeps braziers and torches static, searchable and out of enemy turns', () => {
    const game = arena(Kind.Torch);
    game.state.effect = null;
    game.level.items.push({ id: 0, type: 5, value: 0 });
    game.state.entities[0].objectId = 0;
    game.act('attack');
    expect(game.state.player.hp).toBe(10);
    expect(game.state.player.inventory.at(-1)?.type).toBe(5);
    expect(game.state.entities[0].removed).toBe(false);
  });
});

describe('effects, timed escape and final encounter', () => {
  it('preserves the escape clock on room transitions and while speed is active', () => {
    const game = new Dungeon({ ...structuredClone(levels[0]), turnLimit: 100 }, undefined, 2);
    game.act('forward'); game.act('forward'); game.act('forward');
    expect(game.state.remainingTurns).toBe(98);
    game.state.effect = { kind: Spell.Speed, value: 0, turns: 2 };
    game.act('wait'); game.act('wait');
    expect(game.state.remainingTurns).toBe(98);
    expect(game.state.effect).toBeNull();
    game.act('wait');
    expect(game.state.remainingTurns).toBe(97);
  });

  it('keeps the actual timed chapter clock intact across save and load', () => {
    const game = new Dungeon(levels[6], undefined, 2);
    game.act('wait');
    expect(game.state.remainingTurns).toBe(99);
    expect(decodeCheckpoint(JSON.stringify(game.state), levels[6]).remainingTurns).toBe(99);
  });

  it('blocks attacks during invulnerability, suppresses enemies during invisibility, and ends invisibility on attack', () => {
    const game = arena(Kind.Orc);
    game.state.player.hp = 4;
    game.state.effect = { kind: Spell.Invulnerable, turns: 5, value: 0 };
    game.act('wait');
    expect(game.state.player.hp).toBe(10);
    game.state.effect = { kind: Spell.Invisible, turns: 5, value: 0 };
    game.act('wait');
    expect(game.state.player.hp).toBe(10);
    game.act('attack');
    expect(game.state.effect).toBeNull();
    expect(game.state.player.hp).toBeLessThan(10);
  });

  it('breaks invisibility on an empty attack when enemies are nearby', () => {
    const game = arena(Kind.Orc);
    game.state.player.direction = 0;
    game.state.effect = { kind: Spell.Invisible, turns: 5, value: 0 };
    game.act('attack');
    expect(game.state.effect).toBeNull();
    expect(game.state.player.hp).toBeLessThan(10);
  });

  it('does not let normal weapons kill the Master and lets him drain life on a hit', () => {
    const game = arena(Kind.Master, FINAL_LEVEL);
    game.state.entities[0].hp = 1;
    equip(game, Weapon.Flame, 10);
    game.act('attack');
    expect(game.state.entities[0].hp).toBe(1);
    expect(game.state.entities[0].removed).toBe(false);
    game.state.effect = null;
    game.act('wait');
    expect(game.state.entities[0].hp).toBeGreaterThan(1);
  });

  it('charges the Damned Sword the victim’s remaining health, and forbids resurrection by XP after suicide', () => {
    const game = arena(Kind.Master, FINAL_LEVEL);
    game.state.entities[0].hp = 12;
    equip(game, Weapon.Damned);
    game.act('attack');
    expect(game.state.entities[0].removed).toBe(true);
    expect(game.state.player.hp).toBe(0);
    expect(game.state.status).toBe('dead');
  });

  it('wins only after a survivable cursed strike, obtaining the last key and reaching the real final exit', () => {
    const game = new Dungeon(levels[8], undefined, 2);
    const master = game.state.entities.find(entity => entity.type === Kind.Master)!;
    for (const entity of game.state.entities) if (isEnemy(entity.type) && entity !== master) entity.removed = true;
    relocate(game, master.roomId, master.x, master.y - 1, 2);
    Object.assign(game.state.player, { level: 5, hp: 10, maxHp: 35, xp: 1500, nextXp: 2100 });
    master.hp = 3;
    equip(game, Weapon.Damned);
    game.act('attack');
    expect(game.state.status).toBe('playing');
    expect(game.state.player.hp).toBe(7);
    expect(master.removed).toBe(true);
    expect(game.state.player.inventory.some(item => item.type === 0 && item.value === 13)).toBe(true);
    const door = game.state.doors.find(door => door.id === 13)!;
    game.act('forward'); game.act('forward');
    expect(game.state.roomId).toBe(10);
    expect(door.open).toBe(true);
    // From the actual entry (1,0), cross the room to the final exit (0,2).
    game.act('forward'); game.act('forward'); game.act('left'); game.act('forward');
    expect(game.state.status).toBe('victory');
    expect(decodeCheckpoint(JSON.stringify(game.state), levels[8]).status).toBe('victory');
  });

  it('does not award the ending while the Master is alive', () => {
    const game = new Dungeon(levels[8], undefined, 2);
    relocate(game, 10, 1, 2, 3);
    game.act('forward');
    expect(game.state.status).toBe('playing');
    expect(game.state.log.at(-1)).toContain('Maestro sigue vivo');
  });
});
