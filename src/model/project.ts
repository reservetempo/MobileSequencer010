// Whole-project save/load: the 6 grids, the 20-slot order list, every drum's
// sound, and tempo. Plain JSON, used for both localStorage autosave and files.

import { DrumType } from "./drums";
import { DrumKit } from "./drumKit";
import { WipArrangement, NUM_BLOCKS, NUM_ROWS, NUM_STEPS, ORDER_SLOTS, EMPTY } from "./melodyGrid";

export interface ProjectJSON {
  version: 2;
  tempo: number;
  blocks: { cells: number[]; root: number; scale: number }[];
  order: number[];
  drums: Record<number, number[]>; // drum type -> param snapshot
}

export function serialize(
  arr: WipArrangement, kit: DrumKit, tempo: number, drums: DrumType[]
): ProjectJSON {
  const drumSnaps: Record<number, number[]> = {};
  for (const d of drums) drumSnaps[d] = kit.get(d).capture();
  return {
    version: 2,
    tempo,
    blocks: arr.blocksMessage(),
    order: arr.orderArray(),
    drums: drumSnaps,
  };
}

/** Apply a loaded project into the live arrangement + kit. Returns the tempo. */
export function deserialize(
  json: ProjectJSON, arr: WipArrangement, kit: DrumKit, drums: DrumType[]
): number {
  if (!json || (json.version !== 2 && (json as { version: number }).version !== 1)) return 120;

  for (let b = 0; b < NUM_BLOCKS; b++) {
    const src = json.blocks?.[b];
    const dst = arr.blocks[b];
    if (!src) continue;
    for (let i = 0; i < NUM_ROWS * NUM_STEPS; i++) {
      dst.cells[i] = src.cells?.[i] ?? EMPTY;
    }
    dst.root = ((src.root % 12) + 12) % 12;
    dst.scale = src.scale ?? 0;
  }

  for (let i = 0; i < ORDER_SLOTS; i++) {
    arr.order[i] = json.order?.[i] ?? EMPTY;
  }

  for (const d of drums) {
    const snap = json.drums?.[d];
    if (snap) kit.get(d).restore(snap);
  }

  return typeof json.tempo === "number" ? json.tempo : 120;
}
