// The Sounds view: a full parameter editor for one drum. Port of DrumEditorPanel,
// reworked: ONE global Shuffle/Back/Reset + a single Randomness amount for the whole
// drum; a Presets button that opens a grid of factory presets (each carrying its own
// shuffle range) plus the drum's saved sounds; per-param manual numeric entry that can
// exceed the preset range (clamped only to the absolute base range); and the LFO block
// split into three independent sections, each with a destination dropdown.

import { DrumKit } from "../model/drumKit";
import { SoundLibrary } from "../model/soundLibrary";
import { DrumType } from "../model/drums";
import {
  ParamId, ParamGroup, NUM_PARAMS, getParamGroup, getParamGroupName,
} from "../model/params";
import { getParamSpec, formatValue, isDiscrete } from "../model/paramSpec";
import { FACTORY_PRESETS, Preset } from "../model/presets";

const ALL_GROUPS = [
  ParamGroup.Tone, ParamGroup.Amp, ParamGroup.Filter, ParamGroup.Lfo, ParamGroup.Fx,
  ParamGroup.Output,
];

export interface SoundViewCallbacks {
  onChange: (drum: DrumType) => void;      // a value changed -> resend live params
  onRangeChange: (drum: DrumType) => void; // ranges changed -> resend pitch ranges
  onAudition: (drum: DrumType) => void;    // preview the sound
  onRename: (name: string) => void;        // the current sound's name changed
}

export class SoundView {
  readonly el = document.createElement("div");
  private randomness = 0.3; // single global shuffle amount (fraction toward edges)

  constructor(
    private kit: DrumKit,
    private library: SoundLibrary,
    private drum: DrumType,
    private soundName: string,
    private cb: SoundViewCallbacks
  ) {
    this.el.className = "soundview";
    this.build();
  }

  setDrum(drum: DrumType): void {
    this.drum = drum;
    this.build();
  }

  private params() {
    return this.kit.get(this.drum);
  }

  private paramsInGroup(g: ParamGroup): ParamId[] {
    const out: ParamId[] = [];
    for (let i = 0; i < NUM_PARAMS; i++) {
      const id = i as ParamId;
      if (getParamGroup(id) === g) out.push(id);
    }
    return out;
  }

  private build(): void {
    this.el.innerHTML = "";

    const header = document.createElement("div");
    header.className = "sound-header";
    const title = document.createElement("input");
    title.className = "sound-title-input";
    title.value = this.soundName;
    title.placeholder = "Sound name";
    title.setAttribute("aria-label", "Sound name");
    title.onchange = () => {
      const v = title.value.trim() || "Sound01";
      title.value = v;
      this.soundName = v;
      this.cb.onRename(v);
    };
    header.append(title, this.presetRow());
    this.el.append(header);

    this.el.append(this.globalControls());

    for (const g of ALL_GROUPS) this.el.append(this.category(g));
  }

  // Presets button (opens a grid) + Save, plus the active preset name.
  private presetRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "sound-lib";

    const presetBtn = mkBtn("Presets", "cat-btn");
    presetBtn.onclick = () => this.openPresetGrid(presetBtn);

    const current = document.createElement("span");
    current.className = "preset-current";
    current.textContent = this.params().presetName();

    // Save the current sound to the library under its name (set in the title field).
    const save = mkBtn("Save", "cat-btn");
    save.onclick = () => {
      const name = this.soundName.trim();
      if (!name) return;
      this.library.add(this.drum, name, this.params().capture());
      save.textContent = "Saved";
      setTimeout(() => { save.textContent = "Save"; }, 900);
    };

    row.append(current, presetBtn, save);
    return row;
  }

  // Grid overlay of every factory preset + this drum's saved sounds.
  private openPresetGrid(anchor: HTMLElement): void {
    const existing = this.el.querySelector(".preset-grid");
    if (existing) { existing.remove(); return; }

    const panel = document.createElement("div");
    panel.className = "preset-grid";

    const addTile = (label: string, color: string | null, onPick: () => void) => {
      const b = document.createElement("button");
      b.className = "preset-tile";
      b.textContent = label;
      if (color) {
        b.style.background = color;
        b.style.color = textOn(color);
        b.style.borderColor = "transparent";
      }
      b.onclick = () => { panel.remove(); onPick(); };
      panel.append(b);
    };

    for (const p of FACTORY_PRESETS) {
      addTile(p.name, p.color, () => this.applyPreset(p));
    }

    const saved = this.library.list(this.drum);
    if (saved.length) {
      const sep = document.createElement("div");
      sep.className = "preset-grid-sep";
      sep.textContent = "Saved";
      panel.append(sep);
      for (const s of saved) {
        addTile(s.name, null, () => {
          this.params().restore(s.snapshot);
          this.afterReplace();
        });
      }
    }

    anchor.parentElement?.append(panel);
    // Dismiss on the next outside tap.
    const close = (ev: PointerEvent) => {
      if (!panel.contains(ev.target as Node) && ev.target !== anchor) {
        panel.remove();
        document.removeEventListener("pointerdown", close, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  private applyPreset(p: Preset): void {
    this.kit.applyPreset(this.drum, p);
    this.afterReplace();
  }

  // After a whole-sound replacement (preset/saved/shuffle/reset/back): resend params
  // + pitch range, audition, and rebuild (values + Back-enabled state).
  private afterReplace(): void {
    this.cb.onChange(this.drum);
    this.cb.onRangeChange(this.drum);
    this.cb.onAudition(this.drum);
    this.build();
  }

  // One global Shuffle / Back / Reset + a single Randomness slider.
  private globalControls(): HTMLElement {
    const drum = this.drum;
    const sec = document.createElement("section");
    sec.className = "cat global-ctl";

    const head = document.createElement("div");
    head.className = "cat-head";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = "Shuffle";
    head.append(name);

    const shuffle = mkBtn("Shuffle", "cat-btn");
    const back = mkBtn("Back", "cat-btn");
    const reset = mkBtn("Reset", "cat-btn");
    back.disabled = !this.kit.canBack(drum);
    shuffle.onclick = () => { this.kit.shuffleAll(drum, this.randomness); this.afterReplace(); };
    reset.onclick = () => { this.kit.resetAll(drum); this.afterReplace(); };
    back.onclick = () => { if (this.kit.backAll(drum)) this.afterReplace(); };
    head.append(shuffle, back, reset);

    const rnd = document.createElement("div");
    rnd.className = "rnd";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(this.randomness * 100));
    const lbl = document.createElement("span");
    lbl.className = "rnd-lbl";
    lbl.textContent = `${slider.value}%`;
    slider.oninput = () => {
      this.randomness = Number(slider.value) / 100;
      lbl.textContent = `${slider.value}%`;
    };
    rnd.append(slider, lbl);
    head.append(rnd);

    sec.append(head);
    return sec;
  }

  private category(g: ParamGroup): HTMLElement {
    const sec = document.createElement("section");
    sec.className = "cat";

    const head = document.createElement("div");
    head.className = "cat-head";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = getParamGroupName(g);
    head.append(name);
    sec.append(head);

    if (g === ParamGroup.Lfo) {
      sec.append(this.lfoSections());
    } else {
      const body = document.createElement("div");
      body.className = "cat-params";
      for (const id of this.paramsInGroup(g)) body.append(this.valueBox(id));
      sec.append(body);
    }
    return sec;
  }

  // The 9 LFO params rendered as three labelled sub-sections (Dest + Rate + Amt each).
  private lfoSections(): HTMLElement {
    const ids = this.paramsInGroup(ParamGroup.Lfo); // [target,rate,depth] x3, in index order
    const wrap = document.createElement("div");
    wrap.className = "lfo-sections";
    for (let n = 0; n < 3; n++) {
      const block = document.createElement("div");
      block.className = "lfo-block";
      const h = document.createElement("div");
      h.className = "lfo-head";
      h.textContent = `LFO ${n + 1}`;
      block.append(h);
      const body = document.createElement("div");
      body.className = "cat-params";
      for (let k = 0; k < 3; k++) body.append(this.valueBox(ids[n * 3 + k]));
      block.append(body);
      wrap.append(block);
    }
    return wrap;
  }

  private valueBox(id: ParamId): HTMLElement {
    const drum = this.drum;
    const params = this.params();
    const s = getParamSpec(drum, id);

    const box = document.createElement("div");
    box.className = "vbox";

    const top = document.createElement("div");
    top.className = "vbox-top";
    const nm = document.createElement("span");
    nm.className = "vbox-name";
    nm.textContent = s.name;
    const val = document.createElement("span");
    val.className = "vbox-val";
    val.textContent = formatValue(s, params.get(id));
    top.append(nm, val);
    box.append(top);

    if (isDiscrete(s)) {
      const sel = document.createElement("select");
      sel.className = "vbox-select";
      s.choices!.forEach((c, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = c;
        sel.append(o);
      });
      sel.value = String(Math.round(params.get(id)));
      sel.onchange = () => {
        params.set(id, Number(sel.value));
        val.textContent = formatValue(s, params.get(id));
        this.cb.onChange(drum);
        this.cb.onAudition(drum);
      };
      box.append(sel);
      return box;
    }

    // Continuous: a slider spanning the LIVE (preset) range, plus a numeric input
    // that accepts out-of-range values (clamped only to the absolute base range).
    const lo = params.loOf(id);
    const hi = params.hiOf(id);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.001";
    slider.value = String(normFromRange(lo, hi, s.skew, params.get(id)));

    const num = document.createElement("input");
    num.type = "number";
    num.className = "vbox-num";
    if (s.step > 0) num.step = String(s.step);
    num.value = trim(params.get(id));

    const sync = () => {
      val.textContent = formatValue(s, params.get(id));
      num.value = trim(params.get(id));
      slider.value = String(normFromRange(lo, hi, s.skew, params.get(id)));
    };

    slider.oninput = () => {
      params.set(id, valueFromRange(lo, hi, s.skew, s.step, Number(slider.value)));
      val.textContent = formatValue(s, params.get(id));
      num.value = trim(params.get(id));
      this.cb.onChange(drum);
    };
    slider.onchange = () => this.cb.onAudition(drum);

    num.onchange = () => {
      const v = Number(num.value);
      if (!Number.isNaN(v)) params.set(id, v); // DrumParameters clamps to the base range
      sync();
      this.cb.onChange(drum);
      this.cb.onAudition(drum);
    };

    const ctl = document.createElement("div");
    ctl.className = "vbox-ctl";
    ctl.append(slider, num);
    box.append(ctl);
    return box;
  }
}

function mkBtn(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = cls;
  return b;
}

// Round a value for the numeric box without trailing-zero noise.
function trim(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

// Pick black or white text for readability on a given hex background.
function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#15161a" : "#ffffff";
}

// Skew-aware slider mapping over an explicit [lo,hi] window (mirrors the paramSpec
// helpers but uses the live preset range instead of the static spec min/max).
function normFromRange(lo: number, hi: number, skew: number, value: number): number {
  const range = hi - lo;
  if (range <= 0) return 0;
  const p = Math.min(1, Math.max(0, (value - lo) / range));
  return skew === 1 ? p : Math.pow(p, skew);
}

function valueFromRange(lo: number, hi: number, skew: number, step: number, norm: number): number {
  let p = Math.min(1, Math.max(0, norm));
  if (skew !== 1) p = Math.pow(p, 1 / skew);
  let v = lo + (hi - lo) * p;
  if (step > 0) v = Math.round(v / step) * step;
  return Math.min(hi, Math.max(lo, v));
}
