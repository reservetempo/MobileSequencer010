// The Sound view: a full parameter editor for one drum. Port of DrumEditorPanel.
// Each category (Tone/Amp/Filter/LFO/Drive&FX) has Shuffle / Back / Reset and its
// own Randomness amount; Output (Volume) has just its control. Edits write live
// to the drum via the onChange callback; releases audition via onAudition.

import { DrumKit } from "../model/drumKit";
import { SoundLibrary } from "../model/soundLibrary";
import { DrumType, drumName } from "../model/drums";
import {
  ParamId, ParamGroup, NUM_PARAMS, getParamGroup, getParamGroupName,
} from "../model/params";
import { getParamSpec, formatValue, valueToNorm, normToValue, isDiscrete } from "../model/paramSpec";

const RANDOM_GROUPS = [
  ParamGroup.Tone, ParamGroup.Amp, ParamGroup.Filter, ParamGroup.Lfo, ParamGroup.Fx,
];
const ALL_GROUPS = [...RANDOM_GROUPS, ParamGroup.Output];

export interface SoundViewCallbacks {
  onChange: (drum: DrumType) => void; // a param changed -> resend live params
  onAudition: (drum: DrumType) => void; // preview the sound
}

export class SoundView {
  readonly el = document.createElement("div");
  private randomness = new Map<ParamGroup, number>();

  constructor(
    private kit: DrumKit,
    private library: SoundLibrary,
    private drum: DrumType,
    private cb: SoundViewCallbacks
  ) {
    this.el.className = "soundview";
    for (const g of RANDOM_GROUPS) this.randomness.set(g, 0.3);
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
    const title = document.createElement("h2");
    title.className = "sound-title";
    title.textContent = drumName(this.drum);
    header.append(title, this.soundLibraryRow());
    this.el.append(header);

    for (const g of ALL_GROUPS) this.el.append(this.category(g));
  }

  // Recall / save named sounds for the current drum.
  private soundLibraryRow(): HTMLElement {
    const drum = this.drum;
    const row = document.createElement("div");
    row.className = "sound-lib";

    const sel = document.createElement("select");
    sel.className = "vbox-select";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Recall…";
    sel.append(ph);
    for (const s of this.library.list(drum)) {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = s.name;
      sel.append(o);
    }
    sel.onchange = () => {
      const found = this.library.list(drum).find((s) => s.name === sel.value);
      if (!found) return;
      this.kit.get(drum).restore(found.snapshot);
      this.afterGroupOp();
    };

    const save = mkBtn("Save", "cat-btn");
    save.onclick = () => {
      const name = prompt("Save sound as:");
      if (!name) return;
      this.library.add(drum, name.trim(), this.kit.get(drum).capture());
      this.build();
    };

    row.append(sel, save);
    return row;
  }

  private afterGroupOp(): void {
    this.cb.onChange(this.drum);
    this.cb.onAudition(this.drum);
    this.build(); // refresh values + Back-enabled state (cheap full rebuild)
  }

  private category(g: ParamGroup): HTMLElement {
    const drum = this.drum;
    const sec = document.createElement("section");
    sec.className = "cat";

    const head = document.createElement("div");
    head.className = "cat-head";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = getParamGroupName(g);
    head.append(name);

    if (g !== ParamGroup.Output) {
      const shuffle = mkBtn("Shuffle", "cat-btn");
      const back = mkBtn("Back", "cat-btn");
      const reset = mkBtn("Reset", "cat-btn");
      back.disabled = !this.kit.canBack(drum, g);
      shuffle.onclick = () => { this.kit.shuffleCategory(drum, g, this.randomness.get(g)!); this.afterGroupOp(); };
      reset.onclick = () => { this.kit.resetCategory(drum, g); this.afterGroupOp(); };
      back.onclick = () => { if (this.kit.backCategory(drum, g)) this.afterGroupOp(); };
      head.append(shuffle, back, reset);

      const rnd = document.createElement("div");
      rnd.className = "rnd";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(Math.round(this.randomness.get(g)! * 100));
      const lbl = document.createElement("span");
      lbl.className = "rnd-lbl";
      lbl.textContent = `${slider.value}%`;
      slider.oninput = () => {
        this.randomness.set(g, Number(slider.value) / 100);
        lbl.textContent = `${slider.value}%`;
      };
      rnd.append(slider, lbl);
      head.append(rnd);
    }
    sec.append(head);

    const body = document.createElement("div");
    body.className = "cat-params";
    for (const id of this.paramsInGroup(g)) body.append(this.valueBox(id));
    sec.append(body);
    return sec;
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
    } else {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = "0.001";
      slider.value = String(valueToNorm(s, params.get(id)));
      slider.oninput = () => {
        params.set(id, normToValue(s, Number(slider.value)));
        val.textContent = formatValue(s, params.get(id));
        this.cb.onChange(drum);
      };
      slider.onchange = () => this.cb.onAudition(drum);
      box.append(slider);
    }
    return box;
  }
}

function mkBtn(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = cls;
  return b;
}
