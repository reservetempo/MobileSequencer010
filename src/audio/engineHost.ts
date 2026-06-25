// Main-thread wrapper around the AudioWorklet engine. Owns the AudioContext and
// the worklet node, and exposes a small message API. The DSP itself lives in
// public/worklet/engine.js (served verbatim — see that file's header).

export interface Playhead {
  block: number; // -1 when stopped / no active block
  col: number;
}

export class EngineHost {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  /** Called whenever the playing step changes (for grid highlighting). */
  onPlayhead: ((p: Playhead) => void) | null = null;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  get started(): boolean {
    return this.node !== null;
  }

  /** Must be called from a user gesture (iOS/Chrome autoplay policy). */
  async start(): Promise<void> {
    if (this.node) return;
    this.ctx = new AudioContext();
    // Loaded by URL so the worklet is served verbatim; BASE_URL respects the
    // app's deploy base (see vite.config.ts).
    const url = `${import.meta.env.BASE_URL}worklet/engine.js`;
    await this.ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.ctx, "engine-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "playhead") this.onPlayhead?.({ block: m.block, col: m.col });
    };
    this.node.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  /** Resume after a suspend (e.g. iOS interruptions). */
  async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  /** Fire one drum hit now. `gate` is the note hold length in samples. */
  trigger(drum: number, snapshot: number[], gate: number): void {
    this.node?.port.postMessage({ type: "trigger", drum, snapshot, gate });
  }

  /** Update a drum's live params (drives echo/reverb/volume + pitch base). */
  setParams(drum: number, snapshot: number[]): void {
    this.node?.port.postMessage({ type: "params", drum, snapshot });
  }

  /** Per-drum Pitch ranges ([lo, hi] by drum index) for the scale mapping. */
  setPitchRanges(ranges: (number[] | null)[]): void {
    this.node?.port.postMessage({ type: "pitchRanges", ranges });
  }

  /** Replace the pattern (4 blocks). Resend whenever cells/key/active change. */
  setGrid(blocks: { cells: number[]; root: number; scale: number; active: boolean }[]): void {
    this.node?.port.postMessage({ type: "grid", blocks });
  }

  setTempo(bpm: number): void {
    this.node?.port.postMessage({ type: "tempo", bpm });
  }

  play(): void {
    this.node?.port.postMessage({ type: "play" });
  }

  stop(): void {
    this.node?.port.postMessage({ type: "stop" });
  }
}
