export type Direction = 0 | 1 | 2 | 3;
export interface Point { x: number; y: number }
export interface Location extends Point { roomId: number }
export interface Item { id: number; type: number; value: number; uses?: number }
export interface TileSpec extends Point { image: number }
export interface Entity extends Point {
  id: number; type: number; objectId: number; direction: Direction; hp: number; removed: boolean;
  roomId: number; pressed: boolean; links: number[];
}
export interface Door {
  id: number; from: Location; to: Location;
  fromImage: number; toImage: number; fromDirection: Direction; toDirection: Direction;
  open: boolean;
}
export interface Room {
  id: number; width: number; height: number; floor: number; wall: number;
  floors: TileSpec[]; walls: TileSpec[]; doorIds: number[]; monsterIds: number[];
}
export interface Level {
  index: number;
  turnLimit: number; start: Location; exit: Location | null;
  items: Item[]; entities: Entity[]; doors: Door[]; rooms: Room[];
}
export interface Player extends Point {
  direction: Direction; hp: number; maxHp: number; xp: number; level: number;
  nextXp: number; weapon: number; armor: number; inventory: Item[];
}
export interface Effect { kind: number; turns: number; value: number }
export interface GameState {
  version: 2; status: 'playing' | 'dead' | 'cleared' | 'victory'; roomId: number; levelIndex: number;
  player: Player; entities: Entity[]; doors: Door[]; visited: number[];
  turn: number; totalTurns: number; remainingTurns: number; freeRotation: boolean; rng: number; effect: Effect | null;
  log: string[]; parchment: number | null;
}
export interface AdventureSave { version: 2; current: GameState; entry: GameState }
export type Action = 'forward' | 'backward' | 'left' | 'right' | 'attack' | 'wait';
export interface Outcome { changedRoom: boolean; consumedTurn: boolean; attacked: boolean }
