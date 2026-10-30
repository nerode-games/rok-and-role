import { catalog } from './catalog.generated';
import type { Action, Direction, Entity, GameState, Item, Level, Outcome, Point, Room } from './types';
import { FINAL_LEVEL, isEnemy, isPlate, Kind, Spell, Weapon } from './rules';

export const DIRECTIONS: readonly Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
export const DIRECTION_NAMES = ['suroeste', 'sureste', 'noreste', 'noroeste'] as const;
const EMPTY_OUTCOME: Outcome = { changedRoom: false, consumedTurn: false, attacked: false };

/** Pure turn-based rules; seeded randomness is included in the saved state. */
export class Dungeon {
  readonly state: GameState;

  constructor(readonly level: Level, state?: GameState, seed = Date.now()) {
    this.state = state ?? {
      version: 2, status: 'playing', roomId: level.start.roomId, levelIndex: level.index,
      player: { x: level.start.x, y: level.start.y, direction: 0, hp: 10, maxHp: 10,
        xp: 0, level: 0, nextXp: 100, weapon: 0, armor: 0,
        inventory: [{ id: -1, type: 1, value: 0 }, { id: -2, type: 2, value: 0 }] },
      entities: structuredClone(level.entities), doors: structuredClone(level.doors),
      visited: [level.start.roomId], turn: 0, totalTurns: 0, remainingTurns: level.turnLimit,
      freeRotation: false, rng: (seed >>> 0) || 1,
      effect: null, parchment: null,
      log: [`Entras en ${catalog.LEVEL_NAME[level.index]}.`, ...(level.index === 0 ? ['Busca la llave en el cofre de la segunda sala.'] : [])],
    };
  }

  get room(): Room {
    return this.level.rooms.find(room => room.id === this.state.roomId)!;
  }

  get entities(): Entity[] {
    return this.state.entities.filter(entity => entity.roomId === this.state.roomId && !entity.removed);
  }

  message(text: string): void {
    this.state.log = [...this.state.log, text].slice(-30);
  }

  act(action: Action): Outcome {
    if (this.state.status !== 'playing' || this.state.parchment !== null) return { ...EMPTY_OUTCOME };
    const outcome = { ...EMPTY_OUTCOME };
    const roomId = this.state.roomId;
    if (action === 'left' || action === 'right') {
      this.state.player.direction = ((this.state.player.direction + (action === 'left' ? 1 : 3)) % 4) as Direction;
      outcome.consumedTurn = this.state.freeRotation;
      this.state.freeRotation = !this.state.freeRotation;
    } else if (action === 'forward' || action === 'backward') {
      outcome.consumedTurn = this.move(action === 'forward' ? 1 : -1);
    } else {
      if (action === 'attack') this.attack();
      else this.message('Esperas un turno.');
      outcome.attacked = action === 'attack';
      outcome.consumedTurn = true;
    }
    outcome.changedRoom = roomId !== this.state.roomId;
    if (outcome.consumedTurn) this.endTurn(outcome.changedRoom);
    return outcome;
  }

  private move(sign: number): boolean {
    const player = this.state.player;
    const delta = DIRECTIONS[player.direction];
    const next = { x: player.x + delta.x * sign, y: player.y + delta.y * sign };
    const door = this.state.doors.find(entry => this.room.doorIds.includes(entry.id) &&
      samePoint(entry.from.roomId === this.room.id ? entry.from : entry.to, next));
    if (door) {
      if (!door.open) {
        const keyIndex = player.inventory.findIndex(item => item.type === 0 && item.value === door.id);
        if (keyIndex === -1) {
          this.message('La puerta está cerrada. Necesitas su llave.');
          return false;
        }
        player.inventory.splice(keyIndex, 1);
        door.open = true;
        this.message('Usas la llave. La puerta se abre.');
      }
      const leavingFrom = door.from.roomId === this.room.id;
      const destination = leavingFrom ? door.to : door.from;
      const offset = DIRECTIONS[leavingFrom ? door.toDirection : door.fromDirection];
      const entry = { x: destination.x + offset.x, y: destination.y + offset.y };
      const targetRoom = this.level.rooms.find(room => room.id === destination.roomId)!;
      const blockers = this.state.entities.filter(entity => entity.roomId === targetRoom.id && !entity.removed && !isPlate(entity.type));
      const blocker = blockers.find(entity => samePoint(entity, entry));
      if (blocker) {
        const free = this.freeEntry(targetRoom, blockers, entry);
        if (!free) {
          this.message('La entrada está bloqueada.');
          return false;
        }
        Object.assign(blocker, free);
      }
      this.state.roomId = destination.roomId;
      Object.assign(player, entry);
      if (!this.state.visited.includes(destination.roomId)) this.state.visited.push(destination.roomId);
      this.message(`Entras en la sala ${destination.roomId + 1}.`);
      this.activatePlate(entry);
      this.checkExit();
      return true;
    }
    if (!this.canOccupy(next)) {
      this.message('El camino está bloqueado.');
      return false;
    }
    Object.assign(player, next);
    this.activatePlate(next);
    this.checkExit();
    return true;
  }

  private freeEntry(room: Room, blockers: Entity[], entry: Point): Point | undefined {
    for (let x = 0; x < room.width; x++) {
      for (let y = 0; y < room.height; y++) {
        if (!samePoint({ x, y }, entry) && !blockers.some(entity => samePoint(entity, { x, y }))) return { x, y };
      }
    }
    return undefined;
  }

  private checkExit(): void {
    const exit = this.level.exit;
    if (exit && exit.roomId === this.state.roomId && samePoint(this.state.player, exit)) {
      if (this.level.index === FINAL_LEVEL && this.state.entities.some(entity => entity.type === Kind.Master && !entity.removed)) {
        this.message('El Maestro sigue vivo. La fortaleza aún no está a salvo.');
        return;
      }
      this.state.status = this.level.index === FINAL_LEVEL ? 'victory' : 'cleared';
      this.message(this.state.status === 'victory' ? '¡La fortaleza está a salvo! Has completado la aventura.' : '¡Has encontrado la salida! Capítulo completado.');
    }
  }

  private canOccupy(point: Point, ignoreId = -1): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < this.room.width && point.y < this.room.height &&
      !this.entities.some(entity => entity.id !== ignoreId && !isPlate(entity.type) && samePoint(entity, point));
  }

  /** A successful step may trigger a plate for either the player or an enemy. */
  private activatePlate(point: Point): void {
    const plate = this.entities.find(entity => isPlate(entity.type) && samePoint(entity, point));
    if (!plate || plate.pressed && plate.type !== Kind.Switch) return;
    plate.pressed = !plate.pressed;
    if (plate.type === Kind.SummonPlate) {
      for (const delta of DIRECTIONS) {
        const location = { x: plate.x + delta.x, y: plate.y + delta.y };
        if (this.canOccupy(location) && !samePoint(this.state.player, location)) this.spawn(plate.links[0], location);
      }
      this.message('¡Una trampa! La placa invoca enemigos a tu alrededor.');
    } else {
      for (const door of this.state.doors) {
        if (plate.links.includes(door.id)) door.open = !door.open;
      }
      this.message(plate.links.length ? '¡Clic! La placa cambia las puertas.' : '¡Clic! Has pisado una placa.');
    }
  }

  private spawn(type: number, point: Point): void {
    const id = Math.max(-1, ...this.state.entities.map(entity => entity.id)) + 1;
    this.state.entities.push({ ...point, id, type, roomId: this.room.id, objectId: -1,
      direction: 0, hp: catalog.MONSTER_VITALITY[type], removed: false, pressed: false, links: [] });
  }

  private attack(): void {
    const player = this.state.player;
    const delta = DIRECTIONS[player.direction];
    const target = this.entities.find(entity => !isPlate(entity.type) && samePoint(entity, { x: player.x + delta.x, y: player.y + delta.y }));
    if (!target) {
      if (this.state.effect?.kind === Spell.Invisible && this.entities.some(entity => isEnemy(entity.type))) {
        this.state.effect = null;
      }
      this.message('Tu arma corta el aire.');
      return;
    }
    if (!isEnemy(target.type)) {
      if (target.type >= Kind.Chest && target.type <= Kind.Library && !faces(target, player)) {
        this.message('Acércate al frente del cofre para abrirlo.');
        return;
      }
      this.loot(target);
      if (target.type === Kind.Barrel) target.removed = true;
      return;
    }
    if (this.state.effect?.kind === Spell.Invisible) this.state.effect = null;
    if (player.weapon === Weapon.Damned) {
      const cost = Math.max(0, target.hp);
      player.hp = Math.max(0, player.hp - cost);
      target.hp = 0;
      this.message(`La Espada Maldita drena ${cost} puntos de tu vitalidad.`);
      this.kill(target);
      return;
    }
    const defense = player.weapon === Weapon.Biting ? 0 : catalog.MONSTER_CD[target.type];
    const baseDamage = Math.max(0, Math.floor(player.level / 3) +
      (this.state.effect?.kind === Spell.Strength ? this.state.effect.value : 0) +
      this.roll(catalog.WEAPON_CA_MIN[player.weapon], catalog.WEAPON_CA_MAX[player.weapon]) - defense);
    const damage = baseDamage * (target.type > Kind.SmallCube && !faces(target, player) ? 2 : 1);
    target.hp -= damage;
    if (baseDamage > 0) this.weaponEffect(target, baseDamage);
    if (target.type === Kind.Master) target.hp = Math.max(1, target.hp);
    this.message(damage ? `Golpeas a ${catalog.MONSTER_NAME[target.type]}. Daño: ${damage}.` : 'El enemigo bloquea tu ataque.');
    if (target.hp <= 0) this.kill(target);
  }

  private weaponEffect(target: Entity, damage: number): void {
    const player = this.state.player;
    switch (player.weapon) {
      case Weapon.Knives: target.hp = 0; break;
      case Weapon.Flame: {
        const weapon = player.inventory.find(item => item.type === 1 && item.value === Weapon.Flame);
        if (weapon && --weapon.uses! <= 0) {
          weapon.value = player.weapon = Weapon.Sword;
          delete weapon.uses;
          this.message('La Espada de Fuego pierde su magia y se convierte en una espada normal.');
        }
        break;
      }
      case Weapon.Vampiric: player.hp = Math.min(player.maxHp, player.hp + damage); break;
      case Weapon.Shock: {
        const delta = DIRECTIONS[player.direction];
        this.moveEnemy(target, { x: target.x + delta.x, y: target.y + delta.y });
        break;
      }
    }
  }

  private loot(entity: Entity): void {
    const item = this.level.items.find(item => item.id === entity.objectId);
    if (!item && !isEnemy(entity.type)) this.message('Está vacío.');
    else if (item) {
      this.state.player.inventory.push({ ...item });
      entity.objectId = -1;
      this.message(`Encuentras: ${itemName(item)}.`);
    }
  }

  private kill(entity: Entity): void {
    entity.removed = true;
    this.loot(entity);
    if (entity.type === Kind.LargeCube || entity.type === Kind.MediumCube) {
      this.spawn(entity.type + 1, entity);
      const neighbor = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
        .map(delta => ({ x: entity.x + delta.x, y: entity.y + delta.y }))
        .find(point => this.canOccupy(point) && !samePoint(this.state.player, point));
      if (neighbor) this.spawn(entity.type + 1, neighbor);
      this.message('El cubo se divide en criaturas más pequeñas.');
    }
    const player = this.state.player;
    player.xp += catalog.MONSTER_PX[entity.type];
    this.message(`Derrotas a ${catalog.MONSTER_NAME[entity.type]}. +${catalog.MONSTER_PX[entity.type]} PX.`);
    while (player.xp >= player.nextXp) {
      player.level++;
      player.maxHp = 10 + 5 * player.level;
      if (player.hp > 0) player.hp = player.maxHp;
      player.nextXp += 100 * (player.level + 1);
      this.message(`¡Subes al nivel ${player.level}! Recuperas toda tu vitalidad.`);
    }
  }

  useItem(index: number): Outcome {
    if (this.state.status !== 'playing' || this.state.parchment !== null) return { ...EMPTY_OUTCOME };
    const player = this.state.player;
    const item = player.inventory[index];
    if (!item) return { ...EMPTY_OUTCOME };
    if (item.type === 0) {
      this.message('Las llaves se usan automáticamente al cruzar su puerta.');
      return { ...EMPTY_OUTCOME };
    }
    if (item.type === 5) {
      this.state.parchment = item.value;
      return { ...EMPTY_OUTCOME };
    }
    if (item.type === 1) player.weapon = item.value;
    if (item.type === 2) player.armor = item.value;
    if (item.type === 3 || item.type === 4) {
      if (!this.applyConsumable(item)) return { ...EMPTY_OUTCOME };
      player.inventory.splice(index, 1);
    }
    this.message(`Usas ${itemName(item)}.`);
    this.endTurn(false);
    return { changedRoom: false, consumedTurn: true, attacked: false };
  }

  private applyConsumable(item: Item): boolean {
    if (this.state.effect && item.value !== 5) {
      this.message('Ya estás bajo el efecto de un hechizo.');
      return false;
    }
    const values = item.type === 3 ? catalog.SCROLL_VALUE : catalog.POTION_VALUE;
    const durations = item.type === 3 ? catalog.SCROLL_DURATION : catalog.POTION_DURATION;
    if (item.value === 5) {
      this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + values[item.value]);
    } else {
      this.state.effect = { kind: item.value, value: values[item.value], turns: durations[item.value] };
      if (item.value === Spell.Invulnerable) this.state.player.hp = this.state.player.maxHp;
    }
    return true;
  }

  private endTurn(changedRoom: boolean): void {
    this.state.freeRotation = false;
    this.state.turn++;
    this.state.totalTurns++;
    if (this.state.status !== 'playing') return;
    const effect = this.state.effect;
    if (this.state.player.hp <= 0) {
      this.state.status = 'dead';
      this.message('La maldición ha consumido tu última fuerza.');
      return;
    }
    if (!changedRoom && effect?.kind !== Spell.Speed && this.state.remainingTurns > 0) this.state.remainingTurns--;
    if (this.state.remainingTurns === 0) {
      this.state.player.hp = 0;
      this.message('Las salidas se han sellado. Se ha agotado el tiempo para escapar.');
    } else if (!changedRoom && effect?.kind !== Spell.Invisible && effect?.kind !== Spell.Speed) {
      const enemies = this.entities.filter(entity => isEnemy(entity.type))
        .sort((a, b) => distance(a, this.state.player) - distance(b, this.state.player));
      for (const enemy of enemies) {
        if (enemy.removed) continue;
        this.enemyTurn(enemy);
        if (this.state.player.hp === 0) break;
      }
    }
    if (effect && --effect.turns === 0) {
      this.state.effect = null;
      this.message('El efecto mágico se desvanece.');
    }
    if (this.state.player.hp <= 0) {
      this.state.status = 'dead';
      this.message('Halloran ha caído. La fortaleza sigue esperando un héroe.');
    }
  }

  private enemyTurn(enemy: Entity): void {
    const player = this.state.player;
    if (enemy.type === Kind.Troll) enemy.hp = Math.min(catalog.MONSTER_VITALITY[enemy.type], enemy.hp + 2);
    for (let action = 0; action < 2; action++) {
      if (distance(enemy, player) === 1 && (enemy.type <= 2 || faces(enemy, player))) {
        this.enemyAttack(enemy);
        return;
      }
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const horizontal = dx > 0 ? 1 : 3;
      const vertical = dy > 0 ? 2 : 0;
      if (enemy.type <= Kind.SmallCube) {
        const choices = dx === 0 ? [vertical] : dy === 0 ? [horizontal] :
          Math.abs(dx) <= Math.abs(dy) ? [vertical, horizontal] : [horizontal, vertical];
        for (const direction of choices) {
          const delta = DIRECTIONS[direction];
          if (this.moveEnemy(enemy, { x: enemy.x + delta.x, y: enemy.y + delta.y })) break;
        }
        return;
      }
      if (!this.humanoidStep(enemy, horizontal as Direction, vertical as Direction, dx, dy, action)) return;
    }
  }

  /** Reproduces the original one-free-turn orientation and greedy path rules. */
  private humanoidStep(enemy: Entity, horizontal: Direction, vertical: Direction, dx: number, dy: number, freeTurns: number): boolean {
    let desired = (dx === 0 ? vertical : horizontal);
    if (dx !== 0 && dy !== 0) {
      if (enemy.direction !== horizontal && enemy.direction !== vertical) {
        enemy.direction = (enemy.direction + 2) % 4 === horizontal ? vertical : horizontal;
        return true;
      }
      const delta = DIRECTIONS[enemy.direction];
      const prioritize = enemy.direction === horizontal ? Math.abs(dx) >= Math.abs(dy) : Math.abs(dy) >= Math.abs(dx);
      if ((freeTurns > 0 || prioritize) && this.moveEnemy(enemy, { x: enemy.x + delta.x, y: enemy.y + delta.y })) return false;
      desired = enemy.direction === horizontal ? vertical : horizontal;
    }
    if (enemy.direction !== desired) {
      enemy.direction = ((enemy.direction + 2) % 4 === desired ? dx === 0 ? 1 : 0 : desired) as Direction;
      return true;
    }
    const delta = DIRECTIONS[desired];
    this.moveEnemy(enemy, { x: enemy.x + delta.x, y: enemy.y + delta.y });
    return false;
  }

  private moveEnemy(enemy: Entity, point: Point): boolean {
    if (!this.canOccupy(point, enemy.id) || samePoint(this.state.player, point)) return false;
    Object.assign(enemy, point);
    this.activatePlate(point);
    return true;
  }

  private enemyAttack(enemy: Entity): void {
    const player = this.state.player;
    if (this.state.effect?.kind === 2) {
      player.hp = player.maxHp;
      this.message(`${catalog.MONSTER_NAME[enemy.type]} no puede atravesar tu protección.`);
      return;
    }
    const defense = catalog.ARMOR_CD[player.armor] + (this.state.effect?.kind === 1 ? this.state.effect.value : 0);
    let damage = Math.max(0, this.roll(catalog.MONSTER_CA_MIN[enemy.type], catalog.MONSTER_CA_MAX[enemy.type]) - defense);
    if (!faces(player, enemy)) damage *= 2;
    player.hp = Math.max(0, player.hp - damage);
    if (damage > 0 && enemy.type === Kind.Master) enemy.hp = Math.min(catalog.MONSTER_VITALITY[Kind.Master], enemy.hp + damage);
    if (damage > 0 && player.armor === 6) {
      const armor = player.inventory.find(item => item.type === 2 && item.value === 6);
      if (armor && --armor.uses! <= 0) {
        player.inventory.splice(player.inventory.indexOf(armor), 1);
        player.armor = 0;
        this.message('La Armadura de Hueso se desvanece.');
      }
    }
    this.message(damage ? `${catalog.MONSTER_NAME[enemy.type]} te golpea. Daño: ${damage}.` : `${catalog.MONSTER_NAME[enemy.type]} falla su ataque.`);
  }

  private roll(min: number, max: number): number {
    let value = this.state.rng;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state.rng = value >>> 0;
    return min + this.state.rng % (max - min + 1);
  }
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function faces(actor: Point & { direction: Direction }, target: Point): boolean {
  const delta = DIRECTIONS[actor.direction];
  return actor.x + delta.x === target.x && actor.y + delta.y === target.y;
}

export function itemName(item: Item): string {
  const names: Record<number, readonly string[]> = { 1: catalog.WEAPON_DESCRIPTION, 2: catalog.ARMOR_DESCRIPTION,
    3: catalog.SCROLL_DESCRIPTION, 4: catalog.POTION_DESCRIPTION };
  if (item.type === 0) return 'Llave';
  if (item.type === 5) return `Pergamino ${item.value + 1}`;
  return names[item.type]?.[item.value] ?? 'Objeto';
}
