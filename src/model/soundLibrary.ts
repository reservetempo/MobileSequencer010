// Per-drum saved-sound recall (port of SoundLibrary). Stores named parameter
// snapshots per drum in localStorage so you can save a sound and recall it later.
// Each sound also carries a colour (its identity on the grid) and the Pitch range
// it was designed with (so it maps melodically when painted as a lane).

import { DrumType } from "./drums";

export interface SavedSound {
  name: string;
  snapshot: number[];
  color: string;
  pitch: [number, number]; // [lo, hi] Pitch range for melody mapping
}

const STORAGE_KEY = "msq010.sounds";
const DEFAULT_COLOR = "#888888";

export class SoundLibrary {
  private data = new Map<DrumType, SavedSound[]>();

  constructor() {
    this.load();
  }

  list(drum: DrumType): SavedSound[] {
    return this.data.get(drum) ?? [];
  }

  /** Every saved sound across all drums (for the grid's sound picker). */
  all(): SavedSound[] {
    const out: SavedSound[] = [];
    for (const list of this.data.values()) out.push(...list);
    return out;
  }

  add(drum: DrumType, name: string, snapshot: number[], color: string, pitch: [number, number]): void {
    const list = this.data.get(drum) ?? [];
    const existing = list.findIndex((s) => s.name === name);
    const entry: SavedSound = { name, snapshot: snapshot.slice(), color, pitch: [pitch[0], pitch[1]] };
    if (existing >= 0) list[existing] = entry;
    else list.push(entry);
    this.data.set(drum, list);
    this.save();
  }

  remove(drum: DrumType, name: string): void {
    const list = this.data.get(drum);
    if (!list) return;
    const i = list.findIndex((s) => s.name === name);
    if (i < 0) return;
    list.splice(i, 1);
    this.save();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<number, Partial<SavedSound>[]>;
      for (const key of Object.keys(obj)) {
        const list = (obj[Number(key)] ?? []).map((s) => normalize(s));
        this.data.set(Number(key) as DrumType, list);
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  private save(): void {
    const obj: Record<number, SavedSound[]> = {};
    for (const [drum, list] of this.data) obj[drum] = list;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* ignore quota errors */
    }
  }
}

// Fill in colour/pitch for older saved sounds that predate those fields.
function normalize(s: Partial<SavedSound>): SavedSound {
  const snapshot = Array.isArray(s.snapshot) ? s.snapshot.slice() : [];
  const pitchVal = snapshot[0] ?? 200; // ParamId.Pitch = 0
  const pitch: [number, number] = Array.isArray(s.pitch) && s.pitch.length === 2
    ? [s.pitch[0], s.pitch[1]]
    : [pitchVal * 0.5, pitchVal * 2];
  return {
    name: String(s.name ?? "Sound"),
    snapshot,
    color: typeof s.color === "string" ? s.color : DEFAULT_COLOR,
    pitch,
  };
}
