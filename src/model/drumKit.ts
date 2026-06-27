// Editable, stateful drum parameters + global randomise/undo controls.
// Port of DrumParameters.cpp + DrumKit.h (minus the Markov "Evolve", which was
// never implemented in the C++ either). Each drum now also carries a live shuffle
// window (lo/hi per param) that a preset sets — so any slot can take on any
// character and "Full Range" can open the window wide.

import { DrumType } from "./drums";
import { ParamId, NUM_PARAMS } from "./params";
import { getParamSpec, baseRange, isDiscrete, LFO_TARGETS } from "./paramSpec";
import { Preset, defaultPresetFor, FACTORY_PRESETS } from "./presets";

export type Snapshot = number[];

// Distribution curve for the Shuffle random draw of FREQUENCY params (Pitch &
// Filter Cutoff). Pitch perception is logarithmic, so a uniform-in-Hz draw
// ("Linear") lands most picks in the perceptual high range — the others reshape
// the draw to spread it the way the ear hears it.
export enum FreqCurve {
  Linear,    // uniform in Hz (legacy behaviour) — high-heavy
  Log,       // equal weight per octave (MIDI-like) — naturally bass-heavier
  GaussLow,  // bell in log-space centred low (bass)
  GaussMid,  // bell centred mid
  GaussHigh, // bell centred high
}

const GAUSS_SIGMA = 0.18; // spread of the Gaussian curves (in normalised log-space)
const GAUSS_MU: Record<number, number> = {
  [FreqCurve.GaussLow]: 0.15,
  [FreqCurve.GaussMid]: 0.5,
  [FreqCurve.GaussHigh]: 0.85,
};

// A standard-normal sample via Box–Muller.
function randNormal(): number {
  const u1 = Math.random() || 1e-9; // avoid log(0)
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Draw a frequency in [lo, hi] (both > 0) shaped by `curve`. Log/Gaussian options
// work in normalised log-position p∈[0,1] and map back with lo·(hi/lo)^p.
export function sampleFreq(curve: FreqCurve, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  if (curve === FreqCurve.Linear) return lo + Math.random() * (hi - lo);
  const ratio = hi / lo;
  let p: number;
  if (curve === FreqCurve.Log) {
    p = Math.random();
  } else {
    const mu = GAUSS_MU[curve] ?? 0.5;
    p = Math.min(1, Math.max(0, mu + GAUSS_SIGMA * randNormal()));
  }
  return lo * Math.pow(ratio, p);
}

export class DrumParameters {
  readonly drum: DrumType;
  private values: number[] = new Array(NUM_PARAMS).fill(0);
  private lo: number[] = new Array(NUM_PARAMS).fill(0);
  private hi: number[] = new Array(NUM_PARAMS).fill(1);
  private preset: Preset; // the last applied preset, used by Reset

  constructor(drum: DrumType) {
    this.drum = drum;
    this.preset = defaultPresetFor(drum);
    this.applyPreset(this.preset);
  }

  get(id: ParamId): number {
    return this.values[id];
  }

  /** Write a value, clamped to this param's ABSOLUTE range (baseSpec). Manual entry
      can therefore exceed the active preset's window without breaking the engine. */
  set(id: ParamId, value: number): void {
    const r = baseRange(id);
    this.values[id] = Math.min(r.max, Math.max(r.min, value));
  }

  /** Current shuffle window for a param (the active preset's range). */
  loOf(id: ParamId): number { return this.lo[id]; }
  hiOf(id: ParamId): number { return this.hi[id]; }
  presetName(): string { return this.preset.name; }

  /** Apply a preset: set the shuffle window AND the values it carries. */
  applyPreset(p: Preset): void {
    this.preset = p;
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      const r = baseRange(id);
      const lo = p.ranges[i]?.lo ?? r.min;
      const hi = p.ranges[i]?.hi ?? r.max;
      this.lo[id] = Math.min(r.max, Math.max(r.min, lo));
      this.hi[id] = Math.min(r.max, Math.max(r.min, hi));
      this.set(id, p.values[i] ?? getParamSpec(this.drum, id).def);
    }
  }

  /** Adopt a preset as the "active" one for the label + Reset target, WITHOUT
      touching current values/ranges (used on load to restore the saved name). */
  adoptPreset(p: Preset): void {
    this.preset = p;
  }

  /** Reset values back to the active preset's values (keeps its ranges). */
  resetToPreset(): void {
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      this.set(id, this.preset.values[i] ?? getParamSpec(this.drum, id).def);
    }
  }

  capture(): Snapshot {
    return this.values.slice();
  }

  /** Restore values from a snapshot. Tolerates short (pre-LFO2/3) snapshots by
      filling any missing tail with the param default. */
  restore(snap: Snapshot): void {
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      const v = snap[i];
      this.set(id, v === undefined || Number.isNaN(v) ? getParamSpec(this.drum, id).def : v);
    }
  }

  captureRanges(): { lo: number[]; hi: number[] } {
    return { lo: this.lo.slice(), hi: this.hi.slice() };
  }

  restoreRanges(lo: number[], hi: number[]): void {
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      const r = baseRange(id);
      if (lo[i] !== undefined) this.lo[id] = Math.min(r.max, Math.max(r.min, lo[i]));
      if (hi[i] !== undefined) this.hi[id] = Math.min(r.max, Math.max(r.min, hi[i]));
      // LFO destinations are always fully shufflable; widen any range saved before
      // the "None" option existed so it can be reached again.
      if (id === ParamId.LfoTarget || id === ParamId.Lfo2Target || id === ParamId.Lfo3Target) {
        this.lo[id] = r.min;
        this.hi[id] = r.max;
      }
    }
  }

  /** Randomise ("Shuffle") every randomisable param at once (Volume is never
      touched). Continuous params are drawn uniformly from a window: current lerped
      toward each edge of its live (preset) range by `randomness`. Discrete "type"
      params (Wave/Filter/LFO destinations) reroll to a random choice within their
      preset range — locked when lo==hi, so a character preset only shuffles its LFO
      destinations while Full Range also shuffles waves/filters. The shuffle amount
      is the probability that each discrete param rerolls.

      `curve` reshapes the random draw of the FREQUENCY params (Pitch & Filter
      Cutoff) so highs don't dominate perceptually — see {@link FreqCurve}. All
      other continuous params keep a uniform draw. */
  randomize(randomness: number, curve: FreqCurve = FreqCurve.Linear): void {
    randomness = Math.min(1, Math.max(0, randomness));
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      const s = getParamSpec(this.drum, id);
      if (!s.randomizable) continue;
      if (isDiscrete(s)) {
        const lo = Math.round(this.lo[id]);
        const hi = Math.round(this.hi[id]);
        if (hi > lo && Math.random() < randomness) {
          this.set(id, lo + Math.floor(Math.random() * (hi - lo + 1)));
        }
        continue;
      }
      const cur = this.get(id);
      const lo = cur + (this.lo[id] - cur) * randomness;
      const hi = cur + (this.hi[id] - cur) * randomness;
      const isFreq = id === ParamId.Pitch || id === ParamId.FilterCutoff;
      const v = isFreq ? sampleFreq(curve, lo, hi) : lo + Math.random() * (hi - lo);
      this.set(id, v);
    }
    this.dedupeLfoTargets();
  }

  /** Two LFOs aimed at the same destination just double up — silence the later
      duplicate(s) by switching them to "None". Duplicate "None"s are fine. */
  private dedupeLfoTargets(): void {
    const NONE = LFO_TARGETS.length - 1;
    const slots = [ParamId.LfoTarget, ParamId.Lfo2Target, ParamId.Lfo3Target];
    const seen = new Set<number>();
    for (const id of slots) {
      const t = Math.round(this.get(id));
      if (t === NONE) continue;
      if (seen.has(t)) this.set(id, NONE);
      else seen.add(t);
    }
  }
}

const MAX_UNDO = 20;

// One undo entry captures the full editable state (values + ranges) so undoing a
// preset change or shuffle is exact.
interface UndoState { values: number[]; lo: number[]; hi: number[]; }

export class DrumKit {
  private params = new Map<DrumType, DrumParameters>();
  private undo = new Map<DrumType, UndoState[]>(); // per-drum undo stack

  constructor(drums: DrumType[]) {
    for (const d of drums) this.params.set(d, new DrumParameters(d));
  }

  get(drum: DrumType): DrumParameters {
    return this.params.get(drum)!;
  }

  /** Live Pitch range for melody mapping (reflects the applied preset). */
  pitchRange(drum: DrumType): [number, number] {
    const p = this.get(drum);
    return [p.loOf(ParamId.Pitch), p.hiOf(ParamId.Pitch)];
  }

  private pushUndo(drum: DrumType): void {
    const stack = this.undo.get(drum) ?? [];
    const p = this.get(drum);
    const r = p.captureRanges();
    stack.push({ values: p.capture(), lo: r.lo, hi: r.hi });
    if (stack.length > MAX_UNDO) stack.shift();
    this.undo.set(drum, stack);
  }

  shuffleAll(drum: DrumType, randomness: number, curve: FreqCurve = FreqCurve.Linear): void {
    this.pushUndo(drum);
    this.get(drum).randomize(randomness, curve);
  }

  resetAll(drum: DrumType): void {
    this.pushUndo(drum);
    this.get(drum).resetToPreset();
  }

  applyPreset(drum: DrumType, preset: Preset): void {
    this.pushUndo(drum);
    this.get(drum).applyPreset(preset);
  }

  /** Restore which preset is "active" by name (for the label/Reset after a load).
      No-op if the name isn't a known factory preset. */
  adoptPresetByName(drum: DrumType, name: string): void {
    const p = FACTORY_PRESETS.find((x) => x.name === name);
    if (p) this.get(drum).adoptPreset(p);
  }

  canBack(drum: DrumType): boolean {
    const stack = this.undo.get(drum);
    return !!stack && stack.length > 0;
  }

  /** Step one drum back to its previous state. Returns false if nothing to undo. */
  backAll(drum: DrumType): boolean {
    const stack = this.undo.get(drum);
    if (!stack || stack.length === 0) return false;
    const s = stack.pop()!;
    const p = this.get(drum);
    p.restore(s.values);
    p.restoreRanges(s.lo, s.hi);
    return true;
  }
}
