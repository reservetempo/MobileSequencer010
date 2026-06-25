// Per-drum parameter ranges — a faithful port of ParamSpec.cpp. A base spec per
// parameter is overridden per drum so each voice stays "in character" (a kick
// can't squeal, a hat lives bright, etc.). These ranges also feed the future
// melody pitch-mapping (which centres a scale inside each drum's Pitch range).

import { DrumType } from "./drums";
import { ParamId, NUM_PARAMS } from "./params";

export interface ParamSpec {
  name: string;
  min: number;
  max: number;
  def: number;
  skew: number; // 1 = linear; <1 weights toward the low end
  step: number;
  unit: string;
  randomizable: boolean;
  choices?: string[]; // present => discrete
}

function make(
  name: string, min: number, max: number, def: number,
  skew: number, step: number, unit: string,
  randomizable = true, choices?: string[]
): ParamSpec {
  return { name, min, max, def, skew, step, unit, randomizable, choices };
}

function baseSpec(id: ParamId): ParamSpec {
  switch (id) {
    case ParamId.Pitch:          return make("Pitch", 30, 2000, 200, 0.3, 1, "Hz");
    case ParamId.PitchEnvAmount: return make("Pitch Env", 0, 5, 0, 0.5, 0.05, "x");
    case ParamId.PitchEnvDecay:  return make("Pitch Dec", 0.005, 0.6, 0.06, 0.35, 0.005, "s");
    case ParamId.Waveform:       return make("Wave", 0, 2, 0, 1, 1, "", true, ["Sine", "Tri", "Square"]);
    case ParamId.ToneLevel:      return make("Tone", 0, 1, 0.8, 1, 0.02, "");
    case ParamId.NoiseLevel:     return make("Noise", 0, 1, 0, 1, 0.02, "");
    case ParamId.AmpAttack:      return make("Attack", 0, 0.1, 0.001, 0.4, 0.001, "s");
    case ParamId.AmpDecay:       return make("Decay", 0.01, 1.5, 0.2, 0.35, 0.005, "s");
    case ParamId.AmpSustain:     return make("Sustain", 0, 1, 0, 1, 0.02, "");
    case ParamId.AmpRelease:     return make("Release", 0.005, 1.2, 0.08, 0.35, 0.005, "s");
    case ParamId.FilterType:     return make("Filter", 0, 2, 0, 1, 1, "", true, ["LP", "HP", "BP"]);
    case ParamId.FilterCutoff:   return make("Cutoff", 80, 18000, 12000, 0.3, 10, "Hz");
    case ParamId.FilterReso:     return make("Reso", 0.5, 8, 0.7, 0.5, 0.05, "Q");
    case ParamId.LfoTarget:      return make("LFO Dest", 0, 2, 0, 1, 1, "", true, ["Pitch", "Filter", "Amp"]);
    case ParamId.LfoRate:        return make("LFO Rate", 0.1, 40, 5, 0.4, 0.1, "Hz");
    case ParamId.LfoDepth:       return make("LFO Amt", 0, 1, 0, 1, 0.02, "");
    case ParamId.Drive:          return make("Drive", 0, 1, 0.1, 1, 0.02, "");
    case ParamId.EchoTime:       return make("Echo Time", 0.02, 0.6, 0.18, 0.5, 0.005, "s");
    case ParamId.EchoFeedback:   return make("Echo FB", 0, 0.85, 0.2, 1, 0.02, "");
    case ParamId.EchoMix:        return make("Echo Mix", 0, 1, 0, 1, 0.02, "");
    case ParamId.ReverbSize:     return make("Verb Size", 0, 1, 0.3, 1, 0.02, "");
    case ParamId.ReverbMix:      return make("Verb Mix", 0, 1, 0, 1, 0.02, "");
    case ParamId.Volume:         return make("Volume", 0, 1, 0.85, 1, 0.02, "", false);
    default:                     return make("?", 0, 1, 0, 1, 0.01, "");
  }
}

// Narrow a range and clamp the default into it.
function setRange(s: ParamSpec, lo: number, hi: number, def: number) {
  s.min = lo;
  s.max = hi;
  s.def = Math.min(hi, Math.max(lo, def));
}

export function getParamSpec(drum: DrumType, id: ParamId): ParamSpec {
  const s = baseSpec(id);

  switch (drum) {
    case DrumType.Kick:
      if (id === ParamId.Pitch) setRange(s, 35, 95, 50);
      if (id === ParamId.PitchEnvAmount) s.def = 3.0;
      if (id === ParamId.PitchEnvDecay) s.def = 0.07;
      if (id === ParamId.AmpDecay) setRange(s, 0.05, 1.2, 0.45);
      if (id === ParamId.NoiseLevel) setRange(s, 0, 0.5, 0.03);
      if (id === ParamId.ToneLevel) s.def = 1.0;
      if (id === ParamId.FilterCutoff) s.def = 6000;
      break;

    case DrumType.Snare:
      if (id === ParamId.Pitch) setRange(s, 160, 240, 195);
      if (id === ParamId.NoiseLevel) setRange(s, 0.1, 1.0, 0.7);
      if (id === ParamId.AmpDecay) setRange(s, 0.04, 0.6, 0.18);
      if (id === ParamId.PitchEnvAmount) s.def = 0.6;
      if (id === ParamId.FilterType) s.def = 2.0; // BP
      if (id === ParamId.FilterCutoff) s.def = 2500;
      break;

    case DrumType.Clap:
      if (id === ParamId.Pitch) setRange(s, 700, 1050, 850);
      if (id === ParamId.NoiseLevel) setRange(s, 0.4, 1.0, 0.95);
      if (id === ParamId.ToneLevel) s.def = 0.1;
      if (id === ParamId.AmpDecay) setRange(s, 0.03, 0.4, 0.12);
      if (id === ParamId.FilterType) s.def = 2.0; // BP
      if (id === ParamId.FilterCutoff) s.def = 1500;
      if (id === ParamId.FilterReso) s.def = 1.5;
      break;

    case DrumType.ClosedHat:
      if (id === ParamId.Pitch) setRange(s, 1300, 2400, 1700);
      if (id === ParamId.Waveform) s.def = 2.0; // Square
      if (id === ParamId.NoiseLevel) setRange(s, 0.4, 1.0, 0.95);
      if (id === ParamId.ToneLevel) s.def = 0.2;
      if (id === ParamId.AmpDecay) setRange(s, 0.01, 0.2, 0.05);
      if (id === ParamId.FilterType) s.def = 1.0; // HP
      if (id === ParamId.FilterCutoff) s.def = 8000;
      break;

    case DrumType.OpenHat:
      if (id === ParamId.Pitch) setRange(s, 1300, 2400, 1700);
      if (id === ParamId.Waveform) s.def = 2.0; // Square
      if (id === ParamId.NoiseLevel) setRange(s, 0.4, 1.0, 0.95);
      if (id === ParamId.ToneLevel) s.def = 0.2;
      if (id === ParamId.AmpDecay) setRange(s, 0.08, 0.9, 0.35);
      if (id === ParamId.FilterType) s.def = 1.0; // HP
      if (id === ParamId.FilterCutoff) s.def = 8000;
      break;

    case DrumType.LowTom:
      if (id === ParamId.Pitch) setRange(s, 80, 130, 95);
      if (id === ParamId.PitchEnvAmount) s.def = 1.0;
      if (id === ParamId.AmpDecay) setRange(s, 0.1, 0.9, 0.4);
      if (id === ParamId.NoiseLevel) setRange(s, 0, 0.3, 0.05);
      break;

    case DrumType.MidTom:
      if (id === ParamId.Pitch) setRange(s, 140, 190, 160);
      if (id === ParamId.PitchEnvAmount) s.def = 1.0;
      if (id === ParamId.AmpDecay) setRange(s, 0.1, 0.9, 0.35);
      if (id === ParamId.NoiseLevel) setRange(s, 0, 0.3, 0.05);
      break;

    case DrumType.HighTom:
      if (id === ParamId.Pitch) setRange(s, 200, 270, 235);
      if (id === ParamId.PitchEnvAmount) s.def = 1.0;
      if (id === ParamId.AmpDecay) setRange(s, 0.08, 0.7, 0.3);
      if (id === ParamId.NoiseLevel) setRange(s, 0, 0.3, 0.05);
      break;

    case DrumType.Rim:
      if (id === ParamId.Pitch) setRange(s, 350, 650, 480);
      if (id === ParamId.Waveform) s.def = 2.0; // Square
      if (id === ParamId.AmpDecay) setRange(s, 0.01, 0.12, 0.03);
      if (id === ParamId.NoiseLevel) setRange(s, 0, 0.5, 0.15);
      if (id === ParamId.PitchEnvAmount) s.def = 1.5;
      if (id === ParamId.FilterType) s.def = 2.0; // BP
      if (id === ParamId.FilterCutoff) s.def = 3000;
      break;

    case DrumType.Cowbell:
      if (id === ParamId.Pitch) setRange(s, 540, 820, 600);
      if (id === ParamId.Waveform) s.def = 2.0; // Square
      if (id === ParamId.AmpDecay) setRange(s, 0.05, 0.5, 0.2);
      if (id === ParamId.NoiseLevel) setRange(s, 0, 0.3, 0.05);
      if (id === ParamId.ToneLevel) s.def = 0.9;
      if (id === ParamId.FilterType) s.def = 2.0; // BP
      if (id === ParamId.FilterCutoff) s.def = 2500;
      break;

    case DrumType.Wobble:
      // Dubstep wobble bass: low sustained tone whose LP filter is swung by the LFO.
      if (id === ParamId.Pitch) setRange(s, 30, 90, 50);
      if (id === ParamId.PitchEnvAmount) s.def = 0.0;
      if (id === ParamId.Waveform) s.def = 2.0; // Square
      if (id === ParamId.ToneLevel) s.def = 1.0;
      if (id === ParamId.AmpAttack) s.def = 0.005;
      if (id === ParamId.AmpDecay) setRange(s, 0.05, 1.5, 0.25);
      if (id === ParamId.AmpSustain) s.def = 0.85;
      if (id === ParamId.AmpRelease) s.def = 0.15;
      if (id === ParamId.FilterType) s.def = 0.0; // LP
      if (id === ParamId.FilterCutoff) setRange(s, 80, 6000, 600);
      if (id === ParamId.FilterReso) s.def = 4.0;
      if (id === ParamId.LfoTarget) s.def = 1.0; // Filter
      if (id === ParamId.LfoRate) setRange(s, 0.5, 20, 9);
      if (id === ParamId.LfoDepth) s.def = 0.85;
      if (id === ParamId.Drive) s.def = 0.5;
      break;

    case DrumType.SynthBass:
      // Clean sustained synth bass for basslines/melodies.
      if (id === ParamId.Pitch) setRange(s, 40, 200, 90);
      if (id === ParamId.Waveform) s.def = 2.0; // Square
      if (id === ParamId.PitchEnvAmount) s.def = 0.2;
      if (id === ParamId.PitchEnvDecay) s.def = 0.03;
      if (id === ParamId.ToneLevel) s.def = 1.0;
      if (id === ParamId.AmpAttack) s.def = 0.005;
      if (id === ParamId.AmpDecay) setRange(s, 0.05, 1.5, 0.4);
      if (id === ParamId.AmpSustain) s.def = 0.6;
      if (id === ParamId.AmpRelease) s.def = 0.1;
      if (id === ParamId.FilterType) s.def = 0.0; // LP
      if (id === ParamId.FilterCutoff) setRange(s, 80, 8000, 1200);
      if (id === ParamId.FilterReso) s.def = 1.2;
      if (id === ParamId.Drive) s.def = 0.2;
      break;
  }

  return s;
}

/** Build the default 23-float snapshot for a drum (the array the worklet expects). */
export function defaultSnapshot(drum: DrumType): number[] {
  const snap: number[] = new Array(NUM_PARAMS);
  for (let i = 0; i < NUM_PARAMS; i++) snap[i] = getParamSpec(drum, i as ParamId).def;
  return snap;
}

export function isDiscrete(s: ParamSpec): boolean {
  return !!s.choices && s.choices.length > 0;
}

/** Format a value for display, e.g. "55 Hz", "0.18 s", or "Square". */
export function formatValue(s: ParamSpec, value: number): string {
  if (isDiscrete(s)) {
    const i = Math.min(s.choices!.length - 1, Math.max(0, Math.round(value)));
    return s.choices![i];
  }
  let decimals = 2;
  if (s.max >= 1000) decimals = 0;
  else if (s.max >= 100) decimals = 1;
  let text = value.toFixed(decimals);
  if (s.unit) text += ` ${s.unit}`;
  return text;
}

// Skew-aware slider mapping, matching juce::NormalisableRange:
//   convertTo0to1(v)   = ((v-min)/range)^skew
//   convertFrom0to1(p) = min + range * p^(1/skew)
// skew < 1 gives more slider travel to the low end (good for freq/time params).
export function valueToNorm(s: ParamSpec, value: number): number {
  const range = s.max - s.min;
  if (range <= 0) return 0;
  const p = Math.min(1, Math.max(0, (value - s.min) / range));
  return s.skew === 1 ? p : Math.pow(p, s.skew);
}

export function normToValue(s: ParamSpec, norm: number): number {
  let p = Math.min(1, Math.max(0, norm));
  if (s.skew !== 1) p = Math.pow(p, 1 / s.skew);
  let v = s.min + (s.max - s.min) * p;
  if (s.step > 0) v = Math.round(v / s.step) * s.step;
  return Math.min(s.max, Math.max(s.min, v));
}
