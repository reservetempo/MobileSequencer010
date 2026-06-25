// The pattern data: four 16x7 melody grids ("blocks") chained over their active
// members into one loop. Port of MelodyGrid.h + the WIP parts of Arrangement.h.

export const NUM_ROWS = 7;
export const NUM_STEPS = 16;
export const NUM_BLOCKS = 4;
export const EMPTY = -1;

export class MelodyGrid {
  // cells[row * NUM_STEPS + step] = drum index, or EMPTY.
  readonly cells: Int16Array = new Int16Array(NUM_ROWS * NUM_STEPS).fill(EMPTY);
  root = 0; // 0 = C
  scale = 0; // 0 = Major
  active = true; // when false, muted / excluded from the loop

  private idx(row: number, step: number): number {
    return row * NUM_STEPS + step;
  }

  getCell(row: number, step: number): number {
    return this.cells[this.idx(row, step)];
  }

  setCell(row: number, step: number, drumIndex: number): void {
    if (!MelodyGrid.isValid(row, step)) return;
    this.cells[this.idx(row, step)] = drumIndex;
  }

  clearAll(): void {
    this.cells.fill(EMPTY);
  }

  setRoot(semitone: number): void {
    this.root = ((semitone % 12) + 12) % 12;
  }

  static isValid(row: number, step: number): boolean {
    return row >= 0 && row < NUM_ROWS && step >= 0 && step < NUM_STEPS;
  }
}

export class WipArrangement {
  readonly blocks: MelodyGrid[] = [];

  constructor() {
    for (let b = 0; b < NUM_BLOCKS; b++) {
      const g = new MelodyGrid();
      g.active = b === 0; // start as a single 16-step loop; enable more to extend
      this.blocks.push(g);
    }
  }

  /** Serialise to the plain shape the worklet scheduler consumes. */
  toMessage(): { cells: number[]; root: number; scale: number; active: boolean }[] {
    return this.blocks.map((g) => ({
      cells: Array.from(g.cells),
      root: g.root,
      scale: g.scale,
      active: g.active,
    }));
  }
}
