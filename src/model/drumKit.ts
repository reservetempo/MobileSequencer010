// Editable, stateful drum parameters + per-category randomise/undo controls.
// Port of DrumParameters.cpp + DrumKit.h (minus the Markov "Evolve", which was
// never implemented in the C++ either).

import { DrumType } from "./drums";
import { ParamId, ParamGroup, NUM_PARAMS, getParamGroup } from "./params";
import { getParamSpec, defaultSnapshot, isDiscrete } from "./paramSpec";

export type Snapshot = number[];

export class DrumParameters {
  readonly drum: DrumType;
  private values: number[];

  constructor(drum: DrumType) {
    this.drum = drum;
    this.values = defaultSnapshot(drum);
  }

  get(id: ParamId): number {
    return this.values[id];
  }

  /** Write a value, clamped to this drum's legal range. */
  set(id: ParamId, value: number): void {
    const s = getParamSpec(this.drum, id);
    this.values[id] = Math.min(s.max, Math.max(s.min, value));
  }

  capture(): Snapshot {
    return this.values.slice();
  }

  restore(snap: Snapshot): void {
    for (let i = 0; i < NUM_PARAMS; i++) this.set(i as ParamId, snap[i]);
  }

  resetGroup(group: ParamGroup): void {
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      if (getParamGroup(id) === group) this.set(id, getParamSpec(this.drum, id).def);
    }
  }

  restoreGroup(snap: Snapshot, group: ParamGroup): void {
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      if (getParamGroup(id) === group) this.set(id, snap[i]);
    }
  }

  /** Randomise ("Shuffle"). Volume is never touched; discrete "type" params are
      left alone (change those by hand). Each continuous param is drawn uniformly
      from a window: current lerped toward each range edge by `randomness`. */
  randomize(randomness: number, groupMask: number): void {
    randomness = Math.min(1, Math.max(0, randomness));
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      const s = getParamSpec(this.drum, id);
      if (!s.randomizable) continue;
      if ((groupMask & (1 << getParamGroup(id))) === 0) continue;
      if (isDiscrete(s)) continue;
      const cur = this.get(id);
      const lo = cur + (s.min - cur) * randomness;
      const hi = cur + (s.max - cur) * randomness;
      this.set(id, lo + Math.random() * (hi - lo));
    }
  }
}

const MAX_UNDO = 20;

export class DrumKit {
  private params = new Map<DrumType, DrumParameters>();
  // Per (drum, group) undo stack of snapshots.
  private undo = new Map<string, Snapshot[]>();

  constructor(drums: DrumType[]) {
    for (const d of drums) this.params.set(d, new DrumParameters(d));
  }

  get(drum: DrumType): DrumParameters {
    return this.params.get(drum)!;
  }

  private key(drum: DrumType, g: ParamGroup): string {
    return `${drum}:${g}`;
  }

  private pushUndo(drum: DrumType, g: ParamGroup): void {
    const k = this.key(drum, g);
    const stack = this.undo.get(k) ?? [];
    stack.push(this.get(drum).capture());
    if (stack.length > MAX_UNDO) stack.shift();
    this.undo.set(k, stack);
  }

  shuffleCategory(drum: DrumType, g: ParamGroup, randomness: number): void {
    this.pushUndo(drum, g);
    this.get(drum).randomize(randomness, 1 << g);
  }

  resetCategory(drum: DrumType, g: ParamGroup): void {
    this.pushUndo(drum, g);
    this.get(drum).resetGroup(g);
  }

  canBack(drum: DrumType, g: ParamGroup): boolean {
    const stack = this.undo.get(this.key(drum, g));
    return !!stack && stack.length > 0;
  }

  /** Step one category back to its previous state. Returns false if nothing to undo. */
  backCategory(drum: DrumType, g: ParamGroup): boolean {
    const stack = this.undo.get(this.key(drum, g));
    if (!stack || stack.length === 0) return false;
    const snap = stack.pop()!;
    this.get(drum).restoreGroup(snap, g);
    return true;
  }
}
