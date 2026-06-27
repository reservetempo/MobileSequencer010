// The pattern data: six 16-step melody patterns plus a 20-slot "order" list that
// determines the playback sequence. Each pattern is 5 keys (rows) tall; the UI
// draws its 16 steps as two stacked 8-wide grids so it fits a phone screen. Each
// pattern has an identity colour used in the order view and the pattern picker.
// The loop plays the order list top to bottom, playing each referenced pattern's
// 16 steps, then repeats.

export const NUM_ROWS = 5;
export const NUM_STEPS = 16;
export const NUM_BLOCKS = 6;
export const ORDER_SLOTS = 20;
export const EMPTY = -1;

// Identity colour per grid (distinct from the per-cell drum colours).
export const GRID_COLORS = [
  "#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4dabf7", "#b197fc",
];

export class MelodyGrid {
  // cells[row * NUM_STEPS + step] = drum index, or EMPTY.
  readonly cells: Int16Array = new Int16Array(NUM_ROWS * NUM_STEPS).fill(EMPTY);
  root = 0; // 0 = C
  scale = 0; // 0 = Major
  // When false, the row->note mapping is bypassed: each painted cell plays its
  // saved sound as-is (no key/pitch change). Root/scale are ignored while off.
  // Defaults off: new patterns play sounds as-is until you turn the key on.
  keyEnabled = false;

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

export interface BlockMessage {
  cells: number[];
  root: number;
  scale: number;
  keyEnabled: boolean;
}

export class WipArrangement {
  readonly blocks: MelodyGrid[] = [];
  // order[slot] = grid index (0..NUM_BLOCKS-1) or EMPTY.
  readonly order: Int8Array = new Int8Array(ORDER_SLOTS).fill(EMPTY);

  constructor() {
    for (let b = 0; b < NUM_BLOCKS; b++) this.blocks.push(new MelodyGrid());
    this.order[0] = 0; // start with grid 1 in the loop
  }

  /** Grids serialised for the worklet scheduler. */
  blocksMessage(): BlockMessage[] {
    return this.blocks.map((g) => ({
      cells: Array.from(g.cells),
      root: g.root,
      scale: g.scale,
      keyEnabled: g.keyEnabled,
    }));
  }

  orderArray(): number[] {
    return Array.from(this.order);
  }

  /** Drop a grid into the first empty order slot. Returns the slot, or -1 if full. */
  addToLoop(gridIndex: number): number {
    for (let i = 0; i < ORDER_SLOTS; i++) {
      if (this.order[i] === EMPTY) {
        this.order[i] = gridIndex;
        return i;
      }
    }
    return -1;
  }

  /** Number of filled slots (sections that will play). */
  filledSlots(): number {
    let n = 0;
    for (let i = 0; i < ORDER_SLOTS; i++) if (this.order[i] !== EMPTY) n++;
    return n;
  }

  /** Total 16th-note steps in one loop pass. */
  loopSteps(): number {
    return this.filledSlots() * NUM_STEPS;
  }
}
