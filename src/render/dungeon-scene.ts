import Phaser from 'phaser';
import { catalog } from '../game/catalog.generated';
import { Dungeon, DIRECTIONS } from '../game/engine';
import type { Action, Outcome, Point } from '../game/types';
import { isEnemy, isPlate, Kind } from '../game/rules';

/** Renders the original sprite sheets on a pixel-aligned isometric grid. */
export class DungeonScene extends Phaser.Scene {
  private dungeon!: Dungeon;
  private layer?: Phaser.GameObjects.Container;
  private hero?: Phaser.GameObjects.Image;
  private busy = false;
  private onReady: () => void;

  constructor(onReady: () => void) {
    super('Dungeon');
    this.onReady = onReady;
  }

  preload(): void {
    this.load.image('tiles', `${import.meta.env.BASE_URL}assets/tiles.png`);
    this.load.image('player', `${import.meta.env.BASE_URL}assets/player.png`);
    this.load.image('monsters', `${import.meta.env.BASE_URL}assets/monsters.png`);
    this.load.on('loaderror', () => {
      document.dispatchEvent(new CustomEvent('game-error', { detail: 'No se pudieron cargar los gráficos originales. Recarga la página.' }));
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#141b1a');
    catalog.IMAGES.forEach((rect, index) => {
      if ((index <= 12 || index >= 21 && index <= 28) && rect[2] && rect[3]) {
        this.textures.get('tiles').add(`tile-${index}`, 0, rect[0], rect[1], rect[2], rect[3]);
      }
    });
    for (let direction = 0; direction < 4; direction++) {
      for (let action = 0; action < 3; action++) {
        this.textures.get('player').add(`hero-${direction}-${action}`, 0, direction * 50, action * 40, 50, 40);
      }
    }
    catalog.MONSTER_COORD.forEach((rect, type) => {
      if (!rect) return;
      const key = isEnemy(type) ? 'monsters' : 'tiles';
      for (let direction = 0; direction < (type <= 2 || !isEnemy(type) ? 1 : 4); direction++) {
        this.textures.get(key).add(`entity-${type}-${direction}`, 0, rect[0] + direction * rect[2], rect[1], rect[2], rect[3]);
      }
    });
    this.textures.get('tiles').add('plate-up', 0, 0, 248, 20, 10);
    this.textures.get('tiles').add('plate-down', 0, 20, 248, 20, 10);
    this.onReady();
  }

  show(dungeon: Dungeon): void {
    this.tweens.killAll();
    this.busy = false;
    this.dungeon = dungeon;
    this.draw();
  }

  play(action: Action, outcome: Outcome): void {
    this.draw();
    if (!outcome.attacked || !this.hero) return;
    const hero = this.hero;
    const direction = this.dungeon.state.player.direction;
    this.busy = true;
    hero.setFrame(`hero-${direction}-1`);
    this.time.delayedCall(110, () => hero.active && hero.setFrame(`hero-${direction}-2`));
    this.time.delayedCall(230, () => {
      if (hero.active) hero.setFrame(`hero-${direction}-0`);
      this.busy = false;
    });
    if (action === 'attack') {
      this.cameras.main.shake(80, 0.001, true);
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private draw(): void {
    this.layer?.destroy(true);
    const room = this.dungeon.room;
    const spanX = (room.width + room.height) * 10;
    const spanY = (room.width + room.height) * 5 + 55;
    const scale = Math.max(1, Math.min(3, Math.floor(430 / spanX), Math.floor(265 / spanY)));
    const centerX = (room.width + room.height - 1) * 5;
    const centerY = (room.width - room.height) * 2.5 - 25;
    this.layer = this.add.container(Math.round(240 - centerX * scale), Math.round(155 - centerY * scale)).setScale(scale);
    for (let x = 0; x < room.width; x++) {
      for (let y = room.height - 1; y >= 0; y--) {
        const special = room.floors.find(tile => tile.x === x && tile.y === y);
        this.tile(x, y, special?.image ?? room.floor, -1000);
      }
    }
    for (let y = room.height - 1; y >= 0; y--) {
      this.tile(-1, y, room.walls.find(tile => tile.x === -1 && tile.y === y)?.image ?? room.wall, -500);
    }
    for (let x = 0; x < room.width; x++) {
      this.tile(x, room.height, room.walls.find(tile => tile.x === x && tile.y === room.height)?.image ?? room.wall + 1, -500);
    }
    for (const id of room.doorIds) {
      const door = this.dungeon.state.doors.find(door => door.id === id)!;
      const from = door.from.roomId === room.id;
      const point = from ? door.from : door.to;
      const frame = from ? door.fromImage : door.toImage;
      this.tile(point.x, point.y, frame, -490);
      // Wall-looking and invisible doors remain secret, as in the original maps.
      if ([4, 5, 23, 24, 27, 28, 30].includes(frame)) continue;
      const position = project(point);
      const marker = this.add.graphics().setDepth(-480);
      marker.lineStyle(0.5, door.open ? 0xd7b777 : 0xa55c45, 0.9);
      marker.strokePoints([{ x: position.x + 10, y: position.y }, { x: position.x + 18, y: position.y + 4 },
        { x: position.x + 10, y: position.y + 8 }, { x: position.x + 2, y: position.y + 4 }], true);
      this.layer.add(marker);
    }
    for (const entity of this.dungeon.entities) {
      if (isPlate(entity.type)) {
        const position = project(entity);
        this.layer.add(this.add.image(position.x, position.y - 5, 'tiles', entity.pressed ? 'plate-down' : 'plate-up')
          .setOrigin(0).setDepth(-475));
        continue;
      }
      const rect = catalog.MONSTER_COORD[entity.type];
      if (!rect) continue;
      const position = project(entity);
      const image = this.add.image(position.x + 10, position.y + 5, isEnemy(entity.type) ? 'monsters' : 'tiles',
        `entity-${entity.type}-${entity.type <= 2 || !isEnemy(entity.type) ? 0 : entity.direction}`)
        .setOrigin(0.5, 1).setDepth(position.y);
      if (entity.type === Kind.Master) image.setTint(0xc0a6e8);
      this.layer.add(image);
      if (isEnemy(entity.type) && entity.hp < catalog.MONSTER_VITALITY[entity.type]) {
        const bar = this.add.graphics().setDepth(1000);
        bar.fillStyle(0x391c1b).fillRect(position.x + 4, position.y - rect[3], 12, 1);
        bar.fillStyle(0xc3b07b).fillRect(position.x + 4, position.y - rect[3], 12 * entity.hp / catalog.MONSTER_VITALITY[entity.type], 1);
        this.layer.add(bar);
      }
    }
    const player = this.dungeon.state.player;
    const position = project(player);
    const cursor = this.add.graphics().setDepth(-470);
    cursor.fillStyle(0xbfa46b, 0.25);
    cursor.fillPoints([{ x: position.x, y: position.y + 5 }, { x: position.x + 10, y: position.y },
      { x: position.x + 20, y: position.y + 5 }, { x: position.x + 10, y: position.y + 10 }], true);
    const delta = DIRECTIONS[player.direction];
    const ahead = project({ x: player.x + delta.x, y: player.y + delta.y });
    cursor.fillStyle(0xe0c98e, 0.7).fillCircle(ahead.x + 10, ahead.y + 5, 1);
    this.layer.add(cursor);
    this.hero = this.add.image(position.x + 10, position.y + 5, 'player', `hero-${player.direction}-0`)
      .setOrigin(0.5, 1).setDepth(position.y + 0.1);
    this.layer.add(this.hero);
    this.layer.sort('depth');
  }

  private tile(x: number, y: number, index: number, depth: number): void {
    const rect = catalog.IMAGES[index];
    if (!rect?.[2] || !rect[3]) return;
    const point = project({ x, y });
    this.layer!.add(this.add.image(point.x, point.y - rect[3] + 5, 'tiles', `tile-${index}`).setOrigin(0).setDepth(depth));
  }
}

function project(point: Point): Point {
  return { x: (point.x + point.y) * 10, y: (point.x - point.y) * 5 };
}
