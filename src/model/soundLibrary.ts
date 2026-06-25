// Per-drum saved-sound recall (port of SoundLibrary). Stores named parameter
// snapshots per drum in localStorage so you can save a sound and recall it later.

import { DrumType } from "./drums";

export interface SavedSound {
  name: string;
  snapshot: number[];
}

const STORAGE_KEY = "msq010.sounds";

export class SoundLibrary {
  private data = new Map<DrumType, SavedSound[]>();

  constructor() {
    this.load();
  }

  list(drum: DrumType): SavedSound[] {
    return this.data.get(drum) ?? [];
  }

  add(drum: DrumType, name: string, snapshot: number[]): void {
    const list = this.data.get(drum) ?? [];
    const existing = list.findIndex((s) => s.name === name);
    const entry: SavedSound = { name, snapshot: snapshot.slice() };
    if (existing >= 0) list[existing] = entry;
    else list.push(entry);
    this.data.set(drum, list);
    this.save();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<number, SavedSound[]>;
      for (const key of Object.keys(obj)) {
        this.data.set(Number(key) as DrumType, obj[Number(key)]);
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
