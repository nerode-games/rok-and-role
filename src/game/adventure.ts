import { Dungeon } from './engine';
import { FINAL_LEVEL } from './rules';
import type { AdventureSave, GameState, Level } from './types';

/** Owns progression and the safe retry checkpoint at the start of each chapter. */
export class Adventure {
  dungeon: Dungeon;
  private entry: GameState;

  constructor(readonly levels: Level[], save?: AdventureSave) {
    if (levels.length !== FINAL_LEVEL + 1 || levels.some((level, index) => level.index !== index)) {
      throw new Error('La aventura necesita los nueve capítulos en orden.');
    }
    this.dungeon = new Dungeon(levels[save?.current.levelIndex ?? 0], save ? structuredClone(save.current) : undefined);
    this.dungeon.state.parchment = null;
    this.entry = structuredClone(save?.entry ?? this.dungeon.state);
  }

  advance(): boolean {
    const previous = this.dungeon.state;
    if (previous.status !== 'cleared' || previous.levelIndex >= FINAL_LEVEL) return false;
    const dungeon = new Dungeon(this.levels[previous.levelIndex + 1], undefined, previous.rng);
    const start = dungeon.level.start;
    dungeon.state.player = { ...structuredClone(previous.player), x: start.x, y: start.y,
      inventory: structuredClone(previous.player.inventory).filter(item => item.type !== 0 && item.type !== 5) };
    dungeon.state.totalTurns = previous.totalTurns;
    dungeon.state.effect = structuredClone(previous.effect);
    this.dungeon = dungeon;
    this.entry = structuredClone(dungeon.state);
    return true;
  }

  retry(): void {
    this.dungeon = new Dungeon(this.levels[this.entry.levelIndex], structuredClone(this.entry));
    this.dungeon.state.parchment = null;
    this.dungeon.message('Vuelves al comienzo del capítulo con tu equipo de entrada.');
  }

  snapshot(): AdventureSave {
    return { version: 2, current: structuredClone(this.dungeon.state), entry: structuredClone(this.entry) };
  }
}
