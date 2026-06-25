# MobileSequencer 010

A synthesised melody-grid drum machine for the web — a mobile-focused port of the
JUCE desktop app *Sequencer 010*. Every sound is generated procedurally (no
samples) by an AudioWorklet; you paint melodies across four chained 16×7 grids
using any drum's timbre, pitched to a chosen key and scale.

## Features

- **Five synth drums** (Kick, Snare, Hat, Bass, Wobble), each fully editable:
  tone osc + noise, pitch envelope, state-variable filter, LFO, drive, ADSR,
  echo and reverb.
- **Grid view** — one block at a time (swipe/tabs between four), tap/drag to
  paint, per-block Root / Scale / Loop. Active blocks chain into one loop.
- **Sound view** — full parameter editor with per-category Shuffle / Back /
  Reset / Randomness, plus saving and recalling named sounds.
- **Save/load** projects (localStorage autosave + JSON file), installable PWA
  with offline support.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # static production build -> dist/
```

Deploys automatically to GitHub Pages via `.github/workflows/deploy.yml`.
