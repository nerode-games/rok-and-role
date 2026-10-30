import { catalog } from './catalog.generated';
import type { Direction, Door, Entity, Item, Level, Location, Room, TileSpec } from './types';

/** Reads the original whitespace-delimited J2ME map, with x and r markers. */
class MapReader {
  private index = 0;
  private readonly tokens: string[];

  constructor(text: string) {
    this.tokens = text.trim().split(/\s+/);
  }

  peek(): string | undefined {
    return this.tokens[this.index];
  }

  expect(marker: string): void {
    if (this.tokens[this.index++] !== marker) throw new Error(`Se esperaba «${marker}» en el mapa.`);
  }

  number(min = -1, max = 10000): number {
    const token = this.tokens[this.index++];
    const value = Number(token);
    if (!token || !/^-?\d+$/.test(token) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`Valor de mapa inválido: ${token ?? 'fin de archivo'}.`);
    }
    return value;
  }

  location(): Location {
    return { roomId: this.number(0), x: this.number(), y: this.number() };
  }

  ids(): number[] {
    const ids: number[] = [];
    while (this.peek() !== 'x') ids.push(this.number(0));
    this.expect('x');
    return ids;
  }

  tiles(): TileSpec[] {
    const tiles: TileSpec[] = [];
    while (this.peek() !== 'x') {
      tiles.push({ x: this.number(), y: this.number(), image: this.number(0, 30) });
    }
    this.expect('x');
    return tiles;
  }
}

/** Parses and validates a map without depending on graphics or browser APIs. */
export function parseLevel(text: string, index = 0): Level {
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error('Capítulo inválido.');
  const reader = new MapReader(text);
  const turnLimit = reader.number(-1);
  const start = reader.location();
  const exitRoom = reader.number();
  const exit = exitRoom === -1 ? null : { roomId: exitRoom, x: reader.number(0), y: reader.number(0) };
  const items: Item[] = [];
  while (reader.peek() !== 'x') {
    const item: Item = { id: reader.number(0), type: reader.number(0, 5), value: reader.number(0) };
    if (item.type === 1 && item.value === 7 || item.type === 2 && item.value === 6) item.uses = 10;
    items.push(item);
  }
  reader.expect('x');
  const entities: Entity[] = [];
  while (reader.peek() !== 'x') {
    const id = reader.number(0);
    const type = reader.number(0, 19);
    const entity: Entity = { id, type, x: reader.number(0), y: reader.number(0), objectId: reader.number(),
      direction: 0, hp: catalog.MONSTER_VITALITY[type], removed: false, roomId: -1, pressed: false, links: [] };
    if (type >= 14 && type <= 16) {
      if (type === 16) entity.links = [entity.objectId];
      else if (entity.objectId !== -1) entity.links = [entity.objectId, ...reader.ids()];
      entity.objectId = -1;
    }
    entities.push(entity);
  }
  reader.expect('x');
  const doors: Door[] = [];
  while (reader.peek() !== 'x') {
    const id = reader.number(0);
    const x = reader.number();
    const y = reader.number();
    const fromRoom = reader.number(0);
    const toRoom = reader.number(0);
    const toX = reader.number();
    const toY = reader.number();
    doors.push({ id, from: { roomId: fromRoom, x, y }, to: { roomId: toRoom, x: toX, y: toY },
      fromImage: reader.number(0, 30), fromDirection: reader.number(0, 3) as Direction,
      toImage: reader.number(0, 30), toDirection: reader.number(0, 3) as Direction,
      open: reader.number(0, 1) === 1 });
  }
  reader.expect('x');
  const rooms: Room[] = [];
  while (reader.peek() === 'r') {
    reader.expect('r');
    rooms.push({ id: reader.number(0), width: reader.number(1, 100), height: reader.number(1, 100),
      floor: reader.number(0, 30), wall: reader.number(0, 29), floors: reader.tiles(), walls: reader.tiles(),
      doorIds: reader.ids(), monsterIds: reader.ids() });
  }
  if (reader.peek() !== undefined) throw new Error('Datos inesperados al final del mapa.');
  for (const entity of entities) {
    const owners = rooms.filter(room => room.monsterIds.includes(entity.id));
    if (owners.length > 1) throw new Error(`Entidad ${entity.id} compartida por varias salas.`);
    entity.roomId = owners[0]?.id ?? -1;
  }
  // Some original maps retain unused monster definitions; only room members are instantiated.
  const level = { index, turnLimit, start, exit, items, entities: entities.filter(entity => entity.roomId !== -1), doors, rooms };
  validateLevel(level);
  return level;
}

/** Rejects ambiguous IDs and dangling references before gameplay begins. */
function validateLevel(level: Level): void {
  for (const collection of [level.rooms, level.entities, level.doors, level.items]) {
    if (new Set(collection.map(entry => entry.id)).size !== collection.length) {
      throw new Error('Identificadores duplicados en el mapa.');
    }
  }
  const rooms = new Map(level.rooms.map(room => [room.id, room]));
  const validLocation = (location: Location) => {
    const room = rooms.get(location.roomId);
    return room && location.x >= 0 && location.y >= 0 && location.x < room.width && location.y < room.height;
  };
  if (!validLocation(level.start) || (level.exit && !validLocation(level.exit))) {
    throw new Error('Entrada o salida fuera de una sala.');
  }
  for (const room of level.rooms) {
    if (room.doorIds.some(id => !level.doors.some(door => door.id === id &&
        (door.from.roomId === room.id || door.to.roomId === room.id))) ||
        room.monsterIds.some(id => !level.entities.some(entity => entity.id === id &&
          validLocation({ roomId: room.id, x: entity.x, y: entity.y })))) {
      throw new Error(`Referencias inválidas en la sala ${room.id}.`);
    }
  }
  if (level.entities.some(entity => entity.objectId !== -1 && !level.items.some(item => item.id === entity.objectId)) ||
      level.doors.some(door => !rooms.has(door.from.roomId) || !rooms.has(door.to.roomId))) {
    throw new Error('Referencia de objeto o puerta inexistente.');
  }
  if (level.items.some(item => item.value > [10000, 11, 6, 5, 5, catalog.PERGAMINO_BODY.length - 1][item.type]) ||
      level.entities.some(entity => entity.type === 16 ? entity.links.some(type => type < 0 || type > 9) :
        entity.links.some(id => !level.doors.some(door => door.id === id)))) {
    throw new Error('Definición de objeto o placa inválida.');
  }
}
