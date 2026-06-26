// Parameter identity + grouping. The numeric order of ParamId IS the index used
// in the 23-float snapshots sent to the worklet, so only append before Volume.
// Keep in sync with the `P` map in public/worklet/engine.js.

export enum ParamId {
  Pitch = 0,
  PitchEnvAmount,
  PitchEnvDecay,
  Waveform,
  ToneLevel,
  NoiseLevel,
  AmpAttack,
  AmpDecay,
  AmpSustain,
  AmpRelease,
  FilterType,
  FilterCutoff,
  FilterReso,
  LfoTarget,
  LfoRate,
  LfoDepth,
  Drive,
  EchoTime,
  EchoFeedback,
  EchoMix,
  ReverbSize,
  ReverbMix,
  Volume,
  // LFO 2 & 3 appended AFTER Volume so every index above stays stable (old 23-float
  // snapshots still line up; the worklet/migration just default these). LFO 1 is the
  // original LfoTarget/LfoRate/LfoDepth (13–15).
  Lfo2Target,
  Lfo2Rate,
  Lfo2Depth,
  Lfo3Target,
  Lfo3Rate,
  Lfo3Depth,
  NumParams,
}

export const NUM_PARAMS = ParamId.NumParams;

export enum ParamGroup {
  Tone,
  Amp,
  Filter,
  Lfo,
  Fx,
  Output,
}

export function getParamGroup(id: ParamId): ParamGroup {
  switch (id) {
    case ParamId.Pitch:
    case ParamId.PitchEnvAmount:
    case ParamId.PitchEnvDecay:
    case ParamId.Waveform:
    case ParamId.ToneLevel:
    case ParamId.NoiseLevel:
      return ParamGroup.Tone;
    case ParamId.AmpAttack:
    case ParamId.AmpDecay:
    case ParamId.AmpSustain:
    case ParamId.AmpRelease:
      return ParamGroup.Amp;
    case ParamId.FilterType:
    case ParamId.FilterCutoff:
    case ParamId.FilterReso:
      return ParamGroup.Filter;
    case ParamId.LfoTarget:
    case ParamId.LfoRate:
    case ParamId.LfoDepth:
    case ParamId.Lfo2Target:
    case ParamId.Lfo2Rate:
    case ParamId.Lfo2Depth:
    case ParamId.Lfo3Target:
    case ParamId.Lfo3Rate:
    case ParamId.Lfo3Depth:
      return ParamGroup.Lfo;
    case ParamId.Drive:
    case ParamId.EchoTime:
    case ParamId.EchoFeedback:
    case ParamId.EchoMix:
    case ParamId.ReverbSize:
    case ParamId.ReverbMix:
      return ParamGroup.Fx;
    case ParamId.Volume:
      return ParamGroup.Output;
    default:
      return ParamGroup.Tone;
  }
}

export function getParamGroupName(g: ParamGroup): string {
  switch (g) {
    case ParamGroup.Tone: return "Tone";
    case ParamGroup.Amp: return "Amp Envelope";
    case ParamGroup.Filter: return "Filter";
    case ParamGroup.Lfo: return "LFO";
    case ParamGroup.Fx: return "Drive & FX";
    case ParamGroup.Output: return "Output";
  }
}
