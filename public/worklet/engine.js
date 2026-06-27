/*
  engine.js — AudioWorklet DSP for MobileSequencer010

  Plain JS by design: this runs in the AudioWorkletGlobalScope and is served
  verbatim (no bundler transform), so it must be self-contained with no imports.
  It is a faithful port of the C++ engine:
    - Voice            <- DrumVoice.cpp / .h  (osc + noise + SVF + LFO + drive + ADSR)
    - Channel          <- DrumChannel.cpp / .h (6-voice pool + echo + freeverb + volume)
    - Reverb           <- juce::Reverb (freeverb: 8 combs + 4 allpass, mono)

  The main thread owns parameter ranges/defaults; it sends plain 23-float
  snapshots in. Parameter indices below MUST match src/model/params.ts (ParamId).
*/

// --- Parameter indices (keep in sync with ParamId in src/model/params.ts) ---
const P = {
  Pitch: 0, PitchEnvAmount: 1, PitchEnvDecay: 2, Waveform: 3, ToneLevel: 4, NoiseLevel: 5,
  AmpAttack: 6, AmpDecay: 7, AmpSustain: 8, AmpRelease: 9,
  FilterType: 10, FilterCutoff: 11, FilterReso: 12,
  LfoTarget: 13, LfoRate: 14, LfoDepth: 15,
  Drive: 16, EchoTime: 17, EchoFeedback: 18, EchoMix: 19,
  ReverbSize: 20, ReverbMix: 21, Volume: 22,
  // LFO 2 & 3 (appended after Volume; see ParamId in src/model/params.ts).
  Lfo2Target: 23, Lfo2Rate: 24, Lfo2Depth: 25,
  Lfo3Target: 26, Lfo3Rate: 27, Lfo3Depth: 28,
};

// LFO destination indices, in sync with LFO_TARGETS in src/model/paramSpec.ts.
// LFO_NONE disables the LFO (handled by falling through the routing switch).
const LFO_PITCH = 0, LFO_FILTER = 1, LFO_AMP = 2, LFO_DRIVE = 3, LFO_RESO = 4, LFO_WAVE = 5, LFO_NONE = 6;

const NUM_DRUMS = 12;
const NUM_VOICES = 6;
const VOICE_GAIN = 0.9;
const TWO_PI = Math.PI * 2;

const NUM_ROWS = 5;
const NUM_STEPS = 16;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

//============================================================================
// Melody scale -> frequency (port of MelodyScale.h / melodyScale.ts). Owns the
// pitch mapping because the clock lives here. Keep intervals in sync with
// src/model/melodyScale.ts.
const NUM_NOTES = 5;
const SCALE_INTERVALS = [
  [0, 2, 4, 5, 7, 9, 11], // Major
  [0, 2, 3, 5, 7, 8, 10], // Minor
  [0, 2, 4, 7, 9],        // Major pentatonic
  [0, 3, 5, 7, 10],       // Minor pentatonic
];
const ROOT_MIDI = 60;
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function semitoneForRow(row, scaleType) {
  const iv = SCALE_INTERVALS[clamp(scaleType | 0, 0, SCALE_INTERVALS.length - 1)];
  const len = iv.length;
  const degIdx = NUM_NOTES - 1 - row;
  return 12 * Math.floor(degIdx / len) + iv[degIdx % len];
}

// pitchLo/pitchHi = the drum's Pitch range, sent from the main thread.
function frequencyFor(row, rootSemitone, scaleType, pitchLo, pitchHi) {
  const midi = ROOT_MIDI + rootSemitone + semitoneForRow(row, scaleType);
  const refMidi = ROOT_MIDI + rootSemitone + semitoneForRow((NUM_NOTES / 2) | 0, scaleType);
  const drumCentre = Math.sqrt(pitchLo * pitchHi);
  const octaveShift = Math.round(Math.log2(drumCentre / midiToHz(refMidi)));
  const freq = midiToHz(midi) * Math.pow(2, octaveShift);
  return clamp(freq, pitchLo, pitchHi);
}

// Fast xorshift32 noise source (-1..1).
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

//============================================================================
// Linear ADSR — mirrors juce::ADSR (linear segments; release ramps from the
// current value to 0 over the release time).
class ADSR {
  constructor() {
    this.state = 0; // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
    this.value = 0;
    this.attackRate = 0; this.decayRate = 0; this.releaseRate = 0;
    this.sustain = 0; this.release = 0; this.sr = 44100;
  }
  setParameters(a, d, s, r, sr) {
    this.sr = sr; this.release = r; this.sustain = s;
    this.attackRate = a > 0 ? 1 / (a * sr) : 1e9;
    this.decayRate = d > 0 ? (1 - s) / (d * sr) : 1e9;
  }
  noteOn() { this.value = 0; this.state = 1; }
  noteOff() {
    if (this.state === 0) return;
    if (this.release > 0 && this.value > 0) {
      this.releaseRate = this.value / (this.release * this.sr);
      this.state = 4;
    } else { this.value = 0; this.state = 0; }
  }
  isActive() { return this.state !== 0; }
  next() {
    switch (this.state) {
      case 1: this.value += this.attackRate; if (this.value >= 1) { this.value = 1; this.state = 2; } break;
      case 2: this.value -= this.decayRate; if (this.value <= this.sustain) { this.value = this.sustain; this.state = 3; } break;
      case 3: break;
      case 4: this.value -= this.releaseRate; if (this.value <= 0) { this.value = 0; this.state = 0; } break;
      default: this.value = 0;
    }
    return this.value;
  }
}

//============================================================================
// TPT state-variable filter (Zavalishin). type: 0=LP, 1=HP, 2=BP.
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; }
  reset() { this.ic1 = 0; this.ic2 = 0; }
  process(v0, g, k, type) {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = v0 - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (type === 1) return v0 - k * v1 - v2; // high
    if (type === 2) return v1;               // band
    return v2;                               // low
  }
}

//============================================================================
class Voice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.adsr = new ADSR();
    this.filter = new SVF();
    this.rng = makeRng((Math.random() * 4294967296) >>> 0);
    this.oscPhase = 0; this.pitchEnv = 0; this.pitchEnvCoef = 0;
    this.lfoPhase = [0, 0, 0];
    this.lfoTargets = [0, 0, 0];
    this.lfoRates = [0, 0, 0];
    this.lfoDepths = [0, 0, 0];
    this.gateSamples = 0; this.samplesPlayed = 0; this.noteOffSent = false;
  }
  start(s, gate) {
    this.basePitch = s[P.Pitch];
    this.pitchEnvAmount = s[P.PitchEnvAmount];
    this.pitchEnvDecay = Math.max(0.001, s[P.PitchEnvDecay]);
    this.waveform = Math.round(s[P.Waveform]);
    this.toneLevel = s[P.ToneLevel];
    this.noiseLevel = s[P.NoiseLevel];
    this.filterType = Math.round(s[P.FilterType]);
    this.filterCutoff = s[P.FilterCutoff];
    this.filterReso = Math.max(0.3, s[P.FilterReso]);
    // Three independent always-on LFOs, each routed by its own destination.
    this.lfoTargets = [Math.round(s[P.LfoTarget]), Math.round(s[P.Lfo2Target]), Math.round(s[P.Lfo3Target])];
    this.lfoRates = [s[P.LfoRate], s[P.Lfo2Rate], s[P.Lfo3Rate]];
    this.lfoDepths = [s[P.LfoDepth], s[P.Lfo2Depth], s[P.Lfo3Depth]];
    this.lfoPhase = [0, 0, 0];
    this.drive = s[P.Drive];

    this.adsr.setParameters(
      Math.max(0.0001, s[P.AmpAttack]),
      Math.max(0.0001, s[P.AmpDecay]),
      clamp(s[P.AmpSustain], 0, 1),
      Math.max(0.0001, s[P.AmpRelease]),
      this.sr
    );

    this.oscPhase = 0; this.pitchEnv = 1;
    this.pitchEnvCoef = Math.exp(-1 / (this.pitchEnvDecay * this.sr));
    this.filter.reset();
    this.samplesPlayed = 0; this.noteOffSent = false;
    this.gateSamples = Math.max(1, gate);
    this.adsr.noteOn();
    this.active = true;
  }
  // `pw` is the square-wave duty cycle (0..1, 0.5 = symmetric); ignored by sine/tri.
  osc(phase, wave, pw) {
    if (wave === 1) return 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1; // triangle
    if (wave === 2) return phase < pw ? 1 : -1;                                     // square
    return Math.sin(TWO_PI * phase);                                               // sine
  }
  renderAdding(out, n) {
    if (!this.active) return;
    const sr = this.sr;
    const nyquist = sr * 0.5;
    for (let i = 0; i < n; i++) {
      // Evaluate the three LFOs and fold each into its destination's modulator.
      let pitchMul = 1, cutoffMul = 1, ampMul = 1, resoMul = 1, driveAdd = 0, pwOff = 0;
      for (let L = 0; L < 3; L++) {
        const depth = this.lfoDepths[L];
        const v = Math.sin(TWO_PI * this.lfoPhase[L]); // -1..1
        this.lfoPhase[L] += this.lfoRates[L] / sr;     // advance even when silent
        if (this.lfoPhase[L] >= 1) this.lfoPhase[L] -= 1;
        if (depth <= 0) continue;
        switch (this.lfoTargets[L]) {
          case LFO_PITCH:  pitchMul  *= Math.pow(2, v * depth * 0.5); break;
          case LFO_FILTER: cutoffMul *= Math.pow(2, v * depth * 2);   break;
          case LFO_AMP:    ampMul    *= 1 - depth * (0.5 * (1 - v));   break;
          case LFO_DRIVE:  driveAdd  += v * depth;                     break;
          case LFO_RESO:   resoMul   *= Math.pow(2, v * depth);        break;
          case LFO_WAVE:   pwOff     += v * depth * 0.45;              break;
          case LFO_NONE:   default:                                   break; // disabled
        }
      }

      let freq = this.basePitch * (1 + this.pitchEnvAmount * this.pitchEnv) * pitchMul;
      this.pitchEnv *= this.pitchEnvCoef;

      const osc = this.osc(this.oscPhase, this.waveform, clamp(0.5 + pwOff, 0.05, 0.95));
      const noise = this.rng();
      const mixed = this.toneLevel * osc + this.noiseLevel * noise;

      this.oscPhase += freq / sr;
      if (this.oscPhase >= 1) this.oscPhase -= Math.floor(this.oscPhase);

      const cutoff = clamp(this.filterCutoff * cutoffMul, 20, nyquist * 0.99);
      const g = Math.tan(Math.PI * cutoff / sr);
      const k = 1 / clamp(this.filterReso * resoMul, 0.3, 20);
      let filtered = this.filter.process(mixed, g, k, this.filterType);

      const drive = clamp(this.drive + driveAdd, 0, 2);
      if (drive > 0) filtered = Math.tanh(filtered * (1 + drive * 5));

      const env = this.adsr.next() * ampMul;
      out[i] += filtered * env * VOICE_GAIN;

      if (!this.noteOffSent && ++this.samplesPlayed >= this.gateSamples) {
        this.adsr.noteOff();
        this.noteOffSent = true;
      }
      if (!this.adsr.isActive()) { this.active = false; break; }
    }
  }
}

//============================================================================
// Simple mono feedback-delay echo.
class Echo {
  constructor(sr) {
    this.bufLen = ((sr * 0.7) | 0) + 4;
    this.buf = new Float32Array(this.bufLen);
    this.w = 0;
  }
  process(input, delay, fb, mix) {
    delay = clamp(delay | 0, 1, this.bufLen - 1);
    let r = this.w - delay;
    if (r < 0) r += this.bufLen;
    const delayed = this.buf[r];
    this.buf[this.w] = input + delayed * fb;
    this.w = (this.w + 1) % this.bufLen;
    return input * (1 - mix) + delayed * mix;
  }
}

//============================================================================
// Freeverb (port of juce::Reverb), mono path.
class Comb {
  constructor(size) { this.buf = new Float32Array(size); this.i = 0; this.last = 0; }
  process(input, damp, fb) {
    const out = this.buf[this.i];
    this.last = out * (1 - damp) + this.last * damp;
    this.buf[this.i] = input + this.last * fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return out;
  }
  clear() { this.buf.fill(0); this.last = 0; }
}
class Allpass {
  constructor(size) { this.buf = new Float32Array(size); this.i = 0; }
  process(input) {
    const buffered = this.buf[this.i];
    this.buf[this.i] = input + buffered * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return buffered - input;
  }
  clear() { this.buf.fill(0); }
}
class Reverb {
  constructor(sr) {
    const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const apT = [556, 441, 341, 225];
    const scale = (t) => Math.max(1, ((sr * t) / 44100) | 0);
    this.combs = combT.map((t) => new Comb(scale(t)));
    this.aps = apT.map((t) => new Allpass(scale(t)));
    this.roomSize = 0.7; this.damp = 0; this.wet = 0; this.dry = 0; this.gain = 0.015;
  }
  // wetLevel/dryLevel scaling matches juce::Reverb (wet*3, dry*2); mono so the
  // two width-split wet gains sum back to `wet`.
  setParameters(roomSize, damping, wetLevel, dryLevel) {
    this.wet = wetLevel * 3.0;
    this.dry = dryLevel * 2.0;
    this.roomSize = roomSize * 0.28 + 0.7;
    this.damp = damping * 0.4;
  }
  processMono(buf, n) {
    for (let i = 0; i < n; i++) {
      const input = buf[i] * this.gain;
      let out = 0;
      for (let c = 0; c < this.combs.length; c++) out += this.combs[c].process(input, this.damp, this.roomSize);
      for (let a = 0; a < this.aps.length; a++) out = this.aps[a].process(out);
      buf[i] = out * this.wet + buf[i] * this.dry;
    }
  }
  reset() { this.combs.forEach((c) => c.clear()); this.aps.forEach((a) => a.clear()); }
}

//============================================================================
class Channel {
  constructor(sr) {
    this.sr = sr;
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) this.voices.push(new Voice(sr));
    this.next = 0;
    this.echo = new Echo(sr);
    this.reverb = new Reverb(sr);
    // Live params (FX/volume + pitch base). Set via setParams, NEVER by trigger,
    // so a pitched melody hit can't clobber the drum's base sound. Mirrors how
    // the C++ engine reads kit.params live while triggering from a snapshot.
    this.params = null;
  }
  setParams(snap) { this.params = snap; }
  trigger(snap, gate) {
    for (let i = 0; i < NUM_VOICES; i++) {
      if (!this.voices[i].active) { this.voices[i].start(snap, gate); return; }
    }
    this.voices[this.next].start(snap, gate);
    this.next = (this.next + 1) % NUM_VOICES;
  }
  // Render `n` samples and ADD into master at `offset`. `scratch` is shared temp.
  renderInto(master, scratch, offset, n) {
    if (!this.params) return;
    for (let i = 0; i < n; i++) scratch[i] = 0;
    for (let v = 0; v < NUM_VOICES; v++) this.voices[v].renderAdding(scratch, n);

    const p = this.params;
    const echoMix = p[P.EchoMix];
    if (echoMix > 0.0001) {
      const delay = (p[P.EchoTime] * this.sr) | 0;
      const fb = p[P.EchoFeedback];
      for (let i = 0; i < n; i++) scratch[i] = this.echo.process(scratch[i], delay, fb, echoMix);
    }
    const verbMix = p[P.ReverbMix];
    if (verbMix > 0.0001) {
      this.reverb.setParameters(p[P.ReverbSize], 0.4, verbMix, 1 - verbMix);
      this.reverb.processMono(scratch, n);
    }
    const vol = p[P.Volume];
    for (let i = 0; i < n; i++) master[offset + i] += scratch[i] * vol;
  }
}

//============================================================================
class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate; // AudioWorkletGlobalScope global
    this.channels = [];
    for (let i = 0; i < NUM_DRUMS; i++) this.channels.push(new Channel(this.sr));
    this.scratch = new Float32Array(128);
    this.master = new Float32Array(128);

    // Pitch ranges per drum index ([lo, hi]); sent from the main thread.
    this.pitchRanges = new Array(NUM_DRUMS).fill(null);

    // --- pattern + transport state ---
    // Active pattern the loop is currently playing.
    this.blocks = null;      // [{cells:Int, root, scale, keyEnabled} x NUM_BLOCKS]
    this.order = null;       // [grid index | -1] x ORDER_SLOTS
    // Staged pattern: edits while playing land here and are promoted to active
    // only when the loop restarts, so the current pass plays unchanged.
    this.pendingBlocks = null;
    this.pendingOrder = null;
    this.hasPending = false;

    this.tempo = 120;
    this.playing = false;
    this.seqPos = 0;         // position within the ordered sequence
    this.samplesToNextStep = 0;
    this.lastGrid = -2;      // for change-only playhead reporting
    this.lastCol = -2;
    this.lastSlot = -2;

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case "trigger": { const ch = this.channels[m.drum]; if (ch) ch.trigger(m.snapshot, m.gate | 0); break; }
      case "params": { const ch = this.channels[m.drum]; if (ch) ch.setParams(m.snapshot); break; }
      case "pitchRanges": this.pitchRanges = m.ranges; break;
      case "pattern":
        if (this.playing) {
          // Stage; applied at the next loop restart.
          this.pendingBlocks = m.blocks;
          this.pendingOrder = m.order;
          this.hasPending = true;
        } else {
          this.blocks = m.blocks;
          this.order = m.order;
        }
        break;
      case "tempo": this.tempo = m.bpm; break;
      case "play":
        this.promotePending();
        this.playing = true;
        this.seqPos = 0;
        this.samplesToNextStep = 0;
        break;
      case "stop":
        this.playing = false;
        this.promotePending(); // settle staged edits once stopped
        this.reportPlayhead(-1, -1, -1);
        break;
    }
  }

  promotePending() {
    if (this.hasPending) {
      this.blocks = this.pendingBlocks;
      this.order = this.pendingOrder;
      this.hasPending = false;
    }
  }

  samplesPerStep() {
    // 16th notes: four steps per beat.
    return (this.sr * 60) / Math.max(1, this.tempo) / 4;
  }

  reportPlayhead(grid, col, slot, fired) {
    if (grid !== this.lastGrid || col !== this.lastCol || slot !== this.lastSlot) {
      this.lastGrid = grid;
      this.lastCol = col;
      this.lastSlot = slot;
      // `fired` = drum channels triggered on this step, for the mixer's flash LEDs.
      this.port.postMessage({ type: "playhead", grid, col, slot, fired: fired || [] });
    }
  }

  // Fire one step of the ordered sequence: walk the 20-slot order list, play each
  // referenced pattern's 16 columns, looping. Each painted row triggers pitched to
  // its grid's key. Staged edits are promoted only at the loop boundary.
  fireStep(gate) {
    const blocks = this.blocks;
    const order = this.order;
    if (!blocks || !order) { this.reportPlayhead(-1, -1, -1); return; }

    // Build the play sequence from filled order slots.
    const seq = [];
    for (let i = 0; i < order.length; i++) {
      const g = order[i];
      if (g >= 0 && g < blocks.length) seq.push({ grid: g, slot: i });
    }
    if (seq.length === 0) { this.reportPlayhead(-1, -1, -1); return; }

    const total = seq.length * NUM_STEPS;
    if (this.seqPos >= total) this.seqPos %= total;

    const entry = seq[(this.seqPos / NUM_STEPS) | 0];
    const col = this.seqPos % NUM_STEPS;
    const g = blocks[entry.grid];

    const fired = [];
    for (let row = 0; row < NUM_ROWS; row++) {
      const drum = g.cells[row * NUM_STEPS + col];
      if (drum < 0 || drum >= NUM_DRUMS) continue;
      const ch = this.channels[drum];
      if (!ch || !ch.params) continue;

      const snap = ch.params.slice(); // base sound...
      const range = this.pitchRanges[drum];
      // ...pitched to the row's note, unless this grid has its key turned off,
      // in which case every row plays the saved sound as-is (no pitch change).
      if (range && g.keyEnabled !== false) snap[P.Pitch] = frequencyFor(row, g.root, g.scale, range[0], range[1]);
      ch.trigger(snap, gate);
      fired.push(drum);
    }

    this.reportPlayhead(entry.grid, col, entry.slot, fired);

    this.seqPos = (this.seqPos + 1) % total;
    if (this.seqPos === 0) this.promotePending(); // loop completed -> apply staged edits
  }

  renderChannels(master, offset, n) {
    for (let c = 0; c < NUM_DRUMS; c++) this.channels[c].renderInto(master, this.scratch, offset, n);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const n = out[0].length;
    if (this.scratch.length < n) {
      this.scratch = new Float32Array(n);
      this.master = new Float32Array(n);
    }
    const master = this.master;
    for (let i = 0; i < n; i++) master[i] = 0;

    if (!this.playing) {
      this.renderChannels(master, 0, n); // audition / tails keep ringing
    } else {
      let pos = 0;
      while (pos < n) {
        if (this.samplesToNextStep <= 0) {
          this.fireStep((this.samplesPerStep() | 0));
          this.samplesToNextStep += this.samplesPerStep();
        }
        let chunk = Math.min(n - pos, Math.ceil(this.samplesToNextStep));
        if (chunk < 1) chunk = 1;
        this.renderChannels(master, pos, chunk);
        pos += chunk;
        this.samplesToNextStep -= chunk;
      }
    }

    for (let ch = 0; ch < out.length; ch++) {
      const o = out[ch];
      for (let i = 0; i < n; i++) o[i] = master[i];
    }
    return true;
  }
}

registerProcessor("engine-processor", EngineProcessor);
