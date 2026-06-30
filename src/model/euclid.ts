// Euclidean rhythm generation. Spreads `hits` triggers as evenly as possible across
// `steps` positions (the "bucket"/Bresenham method — same result as Bjorklund up to
// rotation), then rotates so the pattern starts at `rotation`. Used by the per-grid
// Euclidean sequencer mode (see MelodyGrid.voices).

export const EUCLID_VOICES = 5;     // circles / voice slots per Euclidean grid
export const MAX_STEPS = 64;        // upper bound on a voice's step count
export const DEFAULT_STEPS = 8;
export const DEFAULT_HITS = 4;

export function clampSteps(n: number): number {
  return Math.max(1, Math.min(MAX_STEPS, Math.round(n) || 1));
}

/** A boolean hit/rest array of length `steps` with `hits` evenly spread, rotated so the
    pattern begins at `rotation` steps in. */
export function euclidPattern(hits: number, steps: number, rotation: number): boolean[] {
  const n = clampSteps(steps);
  const k = Math.max(0, Math.min(n, Math.round(hits)));
  const out = new Array<boolean>(n).fill(false);
  if (k > 0) {
    let bucket = 0;
    for (let i = 0; i < n; i++) {
      bucket += k;
      if (bucket >= n) { bucket -= n; out[i] = true; }
    }
  }
  const rot = ((Math.round(rotation) % n) + n) % n;
  if (rot === 0) return out;
  const rotated = new Array<boolean>(n);
  for (let i = 0; i < n; i++) rotated[i] = out[(i + rot) % n];
  return rotated;
}
