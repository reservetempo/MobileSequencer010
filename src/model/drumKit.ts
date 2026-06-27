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

// --- Shuffle max-length model ----------------------------------------------
// A rough estimate of a hit's audible length in seconds: the amp body plus the
// dominant FX tail (echo OR reverb, whichever rings longest). Used both to cap
// shuffled sounds and to label them. Constants are tuned by ear, not exact DSP.
const ECHO_EPS = 0.03; // echo repeat quieter than this is inaudible
const VERB_EPS = 0.05; // reverb mix below this adds no usable tail
const RV_BASE = 0.3;   // shortest reverb tail (size 0), seconds
const RV_SPAN = 2.2;   // extra tail at size 1, seconds

// How many audible repeats a feedback echo produces at the given feedback/mix.
function echoRepeats(fb: number, mix: number): number {
  if (mix <= ECHO_EPS) return 0;
  if (fb < 0.01) return 1;
  return Math.max(1, 1 + Math.log(ECHO_EPS / mix) / Math.log(fb));
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
      other continuous params keep a uniform draw.

      `maxLen` (seconds, 0 = off) caps the estimated audible length: FX tails are
      trimmed first (echo, then reverb), then the amp body, to fit. */
  randomize(randomness: number, curve: FreqCurve = FreqCurve.Linear, maxLen = 0): void {
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
    this.clampLength(maxLen);
  }

  /** Rough audible length (seconds) of the current sound: amp body (attack +
      decay + sustain-weighted release) plus the dominant FX tail (echo/reverb).
      Shared by the length cap and the shuffle recap label. */
  estimateLength(): number {
    const body =
      this.get(ParamId.AmpAttack) +
      this.get(ParamId.AmpDecay) +
      this.get(ParamId.AmpSustain) * this.get(ParamId.AmpRelease);
    const echoTail =
      this.get(ParamId.EchoMix) > ECHO_EPS
        ? this.get(ParamId.EchoTime) *
          echoRepeats(this.get(ParamId.EchoFeedback), this.get(ParamId.EchoMix))
        : 0;
    const verbTail =
      this.get(ParamId.ReverbMix) > VERB_EPS
        ? RV_BASE + this.get(ParamId.ReverbSize) * RV_SPAN
        : 0;
    return body + Math.max(echoTail, verbTail);
  }

  /** Trim FX (echo, then reverb), and finally the amp body, so the estimated
      length fits within `maxLen` seconds. Leaves the dry drum untouched when it
      already fits. No-op when maxLen <= 0. */
  private clampLength(maxLen: number): void {
    if (maxLen <= 0) return;
    const A = this.get(ParamId.AmpAttack);
    const D = this.get(ParamId.AmpDecay);
    const R = this.get(ParamId.AmpRelease);
    const body = A + D + this.get(ParamId.AmpSustain) * R;
    const tailBudget = Math.max(0, maxLen - body);

    // Echo: shorten the delay to fit the budget; disable if even a minimal echo
    // (its shortest delay × audible repeats) won't fit.
    if (this.get(ParamId.EchoMix) > ECHO_EPS) {
      const reps = echoRepeats(this.get(ParamId.EchoFeedback), this.get(ParamId.EchoMix));
      const minTime = getParamSpec(this.drum, ParamId.EchoTime).min;
      const maxTime = reps > 0 ? tailBudget / reps : Infinity;
      if (maxTime < minTime) this.set(ParamId.EchoMix, 0);
      else if (this.get(ParamId.EchoTime) > maxTime) this.set(ParamId.EchoTime, maxTime);
    }

    // Reverb: shrink room size to fit; disable mix if even the smallest room
    // tail overruns the budget.
    if (this.get(ParamId.ReverbMix) > VERB_EPS) {
      if (tailBudget < RV_BASE) this.set(ParamId.ReverbMix, 0);
      else {
        const maxSize = (tailBudget - RV_BASE) / RV_SPAN;
        if (this.get(ParamId.ReverbSize) > maxSize) {
          this.set(ParamId.ReverbSize, Math.max(0, maxSize));
        }
      }
    }

    // Body still too long on its own → scale the envelope down (FX already
    // removed above, since tailBudget was 0). Decay/Release have non-zero floors
    // that set() clamps to, so scale only the reducible part above each floor —
    // that lands the body exactly on maxLen instead of stalling at the floor.
    if (body > maxLen) {
      const fA = baseRange(ParamId.AmpAttack).min;
      const fD = baseRange(ParamId.AmpDecay).min;
      const fR = baseRange(ParamId.AmpRelease).min;
      const S = this.get(ParamId.AmpSustain);
      const floorBody = fA + fD + S * fR;
      const k = body > floorBody ? Math.max(0, (maxLen - floorBody) / (body - floorBody)) : 0;
      this.set(ParamId.AmpAttack, fA + (A - fA) * k);
      this.set(ParamId.AmpDecay, fD + (D - fD) * k);
      this.set(ParamId.AmpRelease, fR + (R - fR) * k);
    }
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

  shuffleAll(
    drum: DrumType,
    randomness: number,
    curve: FreqCurve = FreqCurve.Linear,
    maxLen = 0,
  ): void {
    this.pushUndo(drum);
    this.get(drum).randomize(randomness, curve, maxLen);
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
