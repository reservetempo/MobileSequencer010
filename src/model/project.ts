// Whole-project save/load: the 6 grids, the 20-slot order list, every drum's
// sound, and tempo. Plain JSON, used for both localStorage autosave and files.

import { DrumType } from "./drums";
import { DrumKit } from "./drumKit";
import { WipArrangement, NUM_BLOCKS, NUM_ROWS, NUM_STEPS, ORDER_SLOTS, EMPTY } from "./melodyGrid";

// A Steps-view paint lane: a saved sound bound to a drum (see app.ts Lane).
export interface LaneJSON {
  drum: number;
  name: string;
  snapshot: number[];
}

export interface ProjectJSON {
  version: 3;
  tempo: number;
  blocks: { cells: number[]; root: number; scale: number }[];
  order: number[];
  drums: Record<number, number[]>; // drum type -> param snapshot
  // drum type -> live shuffle window (v3+); absent saves fall back to factory ranges.
  ranges?: Record<number, { lo: number[]; hi: number[] }>;
  presets?: Record<number, string>; // drum type -> active preset name (label/Reset target)
  soundName?: string; // name of the current sound being designed in the Sounds view
  lanes?: LaneJSON[]; // optional: absent in older saves
}

export function serialize(
  arr: WipArrangement, kit: DrumKit, tempo: number, drums: DrumType[], lanes: LaneJSON[],
  soundName: string
): ProjectJSON {
  const drumSnaps: Record<number, number[]> = {};
  const drumRanges: Record<number, { lo: number[]; hi: number[] }> = {};
  const drumPresets: Record<number, string> = {};
  for (const d of drums) {
    drumSnaps[d] = kit.get(d).capture();
    drumRanges[d] = kit.get(d).captureRanges();
    drumPresets[d] = kit.get(d).presetName();
  }
  return {
    version: 3,
    tempo,
    blocks: arr.blocksMessage(),
    order: arr.orderArray(),
    drums: drumSnaps,
    ranges: drumRanges,
    presets: drumPresets,
    soundName,
    lanes: lanes.map((l) => ({ drum: l.drum, name: l.name, snapshot: l.snapshot.slice() })),
  };
}

/** Apply a loaded project into the live arrangement + kit, repopulating `lanes`
    in place. Returns the tempo. */
export function deserialize(
  json: ProjectJSON, arr: WipArrangement, kit: DrumKit, drums: DrumType[], lanes: LaneJSON[]
): number {
  lanes.length = 0;
  const v = json && (json as { version: number }).version;
  if (!json || (v !== 1 && v !== 2 && v !== 3)) return 120;

  for (const l of json.lanes ?? []) {
    if (l && Array.isArray(l.snapshot)) {
      lanes.push({ drum: l.drum, name: String(l.name ?? ""), snapshot: l.snapshot.slice() });
    }
  }

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
    // Ranges first so values clamp against the right window; restore() pads any
    // short (pre-LFO2/3) snapshot with defaults, and absent ranges keep the
    // factory window the kit was constructed with.
    const name = json.presets?.[d];
    if (name) kit.adoptPresetByName(d, name);
    const r = json.ranges?.[d];
    if (r && Array.isArray(r.lo) && Array.isArray(r.hi)) kit.get(d).restoreRanges(r.lo, r.hi);
    const snap = json.drums?.[d];
    if (snap) kit.get(d).restore(snap);
  }

  return typeof json.tempo === "number" ? json.tempo : 120;
}
