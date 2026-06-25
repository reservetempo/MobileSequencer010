// App shell: owns the engine + pattern + UI state, and switches between the two
// full-screen views (Grid / Sound). Within Grid you pick a workspace from a
// dropdown: one of the six 8x7 note grids, or the "Order" list (20 slots) that
// sequences which grids play and in what order.

import { EngineHost, Playhead } from "../audio/engineHost";
import { DRUMS, DrumType } from "../model/drums";
import { getParamSpec } from "../model/paramSpec";
import { ParamId } from "../model/params";
import { DrumKit } from "../model/drumKit";
import { SoundLibrary } from "../model/soundLibrary";
import { serialize, deserialize, ProjectJSON } from "../model/project";
import {
  WipArrangement, NUM_BLOCKS, ORDER_SLOTS, EMPTY, GRID_COLORS,
} from "../model/melodyGrid";
import { ALL_ROOTS, ALL_SCALES } from "../model/melodyScale";
import { GridView } from "./gridView";
import { SoundView } from "./soundView";

const PROJECT_KEY = "msq010.project";
const ORDER_VIEW = NUM_BLOCKS; // workspace value for the order list

type View = "grid" | "sound";

export class App {
  private engine = new EngineHost();
  private arr = new WipArrangement();
  private kit = new DrumKit(DRUMS.map((d) => d.type)); // editable per-drum params
  private library = new SoundLibrary();
  private drumTypes = DRUMS.map((d) => d.type);
  private saveTimer = 0;

  private view: View = "grid";
  private selectedDrum: DrumType = DrumType.Kick;
  private workspace = 0; // 0..5 = grid index, ORDER_VIEW = order list
  private orderBrush = 0; // which grid (colour) the order grid places
  private playing = false;
  private tempo = 120;

  private root: HTMLElement;
  private viewRoot!: HTMLElement;
  private gridView = new GridView(this.arr.blocks[0]);
  private loopTimeEl: HTMLElement | null = null;
  private orderSlotEls: HTMLElement[] | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.gridView.onEdit = () => this.syncPattern();
    this.engine.onPlayhead = (p) => this.handlePlayhead(p);
    // Resume audio after iOS/tab interruptions.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.engine.resume();
    });
    this.renderStart();
  }

  private handlePlayhead(p: Playhead): void {
    const col = this.workspace < NUM_BLOCKS && p.grid === this.workspace ? p.col : -1;
    this.gridView.setPlayhead(col);
    if (this.orderSlotEls) {
      this.orderSlotEls.forEach((el, i) => el.classList.toggle("playing", i === p.slot));
    }
  }

  // --- engine sync ------------------------------------------------------
  private pushAll(): void {
    for (const d of DRUMS) this.engine.setParams(d.type, this.kit.get(d.type).capture());
    const ranges: (number[] | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const sp = getParamSpec(i as DrumType, ParamId.Pitch);
      ranges[i] = [sp.min, sp.max];
    }
    this.engine.setPitchRanges(ranges);
    this.syncPattern();
    this.engine.setTempo(this.tempo);
  }

  /** Resend grids + order. While playing the engine stages this and applies it
      at the next loop restart, so the current pass plays unchanged. */
  private syncPattern(): void {
    this.engine.setPattern(this.arr.blocksMessage(), this.arr.orderArray());
    this.updateLoopTime();
    this.persist();
  }

  private updateLoopTime(): void {
    if (!this.loopTimeEl) return;
    const steps = this.arr.loopSteps();
    const sec = (steps * 60) / Math.max(1, this.tempo) / 4; // 16th notes
    this.loopTimeEl.textContent = steps > 0 ? `${sec.toFixed(2)}s · ${steps} steps` : "empty";
  }

  // --- persistence ------------------------------------------------------
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        const json = serialize(this.arr, this.kit, this.tempo, this.drumTypes);
        localStorage.setItem(PROJECT_KEY, JSON.stringify(json));
      } catch {
        /* ignore quota errors */
      }
    }, 300);
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(PROJECT_KEY);
      if (!raw) return;
      this.tempo = deserialize(JSON.parse(raw) as ProjectJSON, this.arr, this.kit, this.drumTypes);
    } catch {
      /* ignore corrupt storage */
    }
  }

  private saveToFile(): void {
    const json = serialize(this.arr, this.kit, this.tempo, this.drumTypes);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "msq010-project.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  private loadFromFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result)) as ProjectJSON;
        this.tempo = deserialize(json, this.arr, this.kit, this.drumTypes);
        this.afterProjectChange();
      } catch {
        alert("Could not load that file.");
      }
    };
    reader.readAsText(file);
  }

  private newProject(): void {
    this.arr = new WipArrangement();
    this.kit = new DrumKit(this.drumTypes);
    this.tempo = 120;
    this.afterProjectChange();
  }

  private afterProjectChange(): void {
    if (this.playing) { this.playing = false; this.engine.stop(); }
    const gi = this.workspace < NUM_BLOCKS ? this.workspace : 0;
    this.gridView = new GridView(this.arr.blocks[gi]);
    this.gridView.onEdit = () => this.syncPattern();
    this.pushAll();
    this.render();
  }

  private audition(drum: DrumType): void {
    const gate = Math.round(this.engine.sampleRate * 0.4);
    this.engine.trigger(drum, this.kit.get(drum).capture(), gate);
  }

  // --- start gate -------------------------------------------------------
  private renderStart(): void {
    this.root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "start-screen";
    const h = document.createElement("h1");
    h.textContent = "MobileSequencer 010";
    const btn = document.createElement("button");
    btn.id = "start";
    btn.textContent = "▶ Start";
    btn.onclick = async () => {
      await this.engine.start();
      this.loadFromStorage();
      this.pushAll();
      this.render();
    };
    wrap.append(h, btn);
    this.root.append(wrap);
  }

  // --- main render ------------------------------------------------------
  private render(): void {
    this.root.innerHTML = "";
    this.loopTimeEl = null;
    this.orderSlotEls = null;

    const bar = document.createElement("header");
    bar.className = "topbar";
    bar.append(this.viewToggle(), this.transport(), this.menu());
    this.root.append(bar);

    this.viewRoot = document.createElement("main");
    this.viewRoot.className = "viewroot";
    this.root.append(this.viewRoot);

    if (this.view === "grid") this.renderGrid();
    else this.renderSound();
  }

  private viewToggle(): HTMLElement {
    const seg = document.createElement("div");
    seg.className = "seg";
    for (const v of ["grid", "sound"] as View[]) {
      const b = document.createElement("button");
      b.textContent = v === "grid" ? "Grid" : "Sound";
      b.className = "seg-btn" + (this.view === v ? " on" : "");
      b.onclick = () => {
        if (this.view === v) return;
        this.view = v;
        this.render();
      };
      seg.append(b);
    }
    return seg;
  }

  private menu(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "menu";

    const btn = document.createElement("button");
    btn.className = "menu-btn";
    btn.textContent = "≡";

    const panel = document.createElement("div");
    panel.className = "menu-panel hidden";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.style.display = "none";
    fileInput.onchange = () => {
      const f = fileInput.files?.[0];
      if (f) this.loadFromFile(f);
      fileInput.value = "";
    };

    const mk = (text: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = () => { panel.classList.add("hidden"); fn(); };
      return b;
    };
    panel.append(
      mk("New project", () => { if (confirm("Clear everything and start fresh?")) this.newProject(); }),
      mk("Save to file", () => this.saveToFile()),
      mk("Load from file", () => fileInput.click()),
    );

    btn.onclick = () => panel.classList.toggle("hidden");
    wrap.append(btn, panel, fileInput);
    return wrap;
  }

  private transport(): HTMLElement {
    const t = document.createElement("div");
    t.className = "transport";

    const play = document.createElement("button");
    play.className = "play-btn";
    play.textContent = this.playing ? "■" : "▶";
    play.onclick = () => {
      this.playing = !this.playing;
      if (this.playing) this.engine.play();
      else {
        this.engine.stop();
        this.gridView.setPlayhead(-1);
      }
      play.textContent = this.playing ? "■" : "▶";
    };

    const tempo = document.createElement("input");
    tempo.type = "range";
    tempo.min = "60";
    tempo.max = "200";
    tempo.value = String(this.tempo);
    tempo.className = "tempo";
    const label = document.createElement("span");
    label.className = "tempo-label";
    label.textContent = `${this.tempo}`;
    tempo.oninput = () => {
      this.tempo = Number(tempo.value);
      this.engine.setTempo(this.tempo);
      label.textContent = `${this.tempo}`;
      this.updateLoopTime();
      this.persist();
    };

    t.append(play, tempo, label);
    return t;
  }

  // --- grid view --------------------------------------------------------
  private renderGrid(): void {
    const v = this.viewRoot;
    v.append(this.workspaceBar());

    if (this.workspace === ORDER_VIEW) {
      v.append(this.renderOrderEditor());
    } else {
      v.append(this.gridControls());

      const gridWrap = document.createElement("div");
      gridWrap.className = "grid-wrap";
      this.gridView.setBlock(this.arr.blocks[this.workspace]);
      this.gridView.setActiveDrum(this.selectedDrum);
      gridWrap.append(this.gridView.canvas);
      v.append(gridWrap);

      v.append(this.drumSelector((d) => {
        this.selectedDrum = d;
        this.gridView.setActiveDrum(d);
        this.audition(d);
      }));

      requestAnimationFrame(() => this.gridView.layout());
    }

    this.updateLoopTime();
  }

  private workspaceBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "workspace-bar";

    const chip = document.createElement("span");
    chip.className = "ws-chip";
    if (this.workspace < NUM_BLOCKS) chip.style.background = GRID_COLORS[this.workspace];
    else chip.style.visibility = "hidden";

    const sel = document.createElement("select");
    sel.className = "workspace-select";
    for (let i = 0; i < NUM_BLOCKS; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `Grid ${i + 1}`;
      sel.append(o);
    }
    const orderOpt = document.createElement("option");
    orderOpt.value = String(ORDER_VIEW);
    orderOpt.textContent = "Order";
    sel.append(orderOpt);
    sel.value = String(this.workspace);
    sel.onchange = () => {
      this.workspace = Number(sel.value);
      this.render();
    };

    const loop = document.createElement("div");
    loop.className = "loop-time";
    const loopLabel = document.createElement("span");
    loopLabel.className = "loop-time-label";
    loopLabel.textContent = "Loop";
    this.loopTimeEl = document.createElement("span");
    this.loopTimeEl.className = "loop-time-val";
    loop.append(loopLabel, this.loopTimeEl);

    bar.append(chip, sel, loop);
    return bar;
  }

  private gridControls(): HTMLElement {
    const blk = this.arr.blocks[this.workspace];
    const row = document.createElement("div");
    row.className = "block-ctl";

    const rootSel = document.createElement("select");
    ALL_ROOTS.forEach((name, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = name;
      rootSel.append(o);
    });
    rootSel.value = String(blk.root);
    rootSel.onchange = () => {
      blk.setRoot(Number(rootSel.value));
      this.gridView.draw();
      this.syncPattern();
    };

    const scaleSel = document.createElement("select");
    ALL_SCALES.forEach((name, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = name;
      scaleSel.append(o);
    });
    scaleSel.value = String(blk.scale);
    scaleSel.onchange = () => {
      blk.scale = Number(scaleSel.value);
      this.gridView.draw();
      this.syncPattern();
    };

    const add = document.createElement("button");
    add.className = "add-loop-btn";
    add.textContent = "+ Add to loop";
    add.onclick = () => {
      const slot = this.arr.addToLoop(this.workspace);
      if (slot < 0) alert("Order list is full (20 slots).");
      this.syncPattern();
    };

    row.append(labelled("Root", rootSel), labelled("Scale", scaleSel), add);
    return row;
  }

  private drumSelector(onSelect: (drum: DrumType) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "selector";
    for (const d of DRUMS) {
      const b = document.createElement("button");
      b.className = "drum-pad" + (d.type === this.selectedDrum ? " on" : "");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = d.colour;
      const name = document.createElement("span");
      name.textContent = d.name;
      b.append(sw, name);
      b.onclick = () => {
        row.querySelectorAll(".drum-pad").forEach((el) => el.classList.remove("on"));
        b.classList.add("on");
        onSelect(d.type);
      };
      row.append(b);
    }
    return row;
  }

  // --- order editor -----------------------------------------------------
  private renderOrderEditor(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "order-editor";

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Pick a grid colour, then tap slots to place it. Plays top-left to bottom-right.";
    wrap.append(hint);

    wrap.append(this.gridPalette());

    const grid = document.createElement("div");
    grid.className = "order-grid";
    this.orderSlotEls = [];

    for (let i = 0; i < ORDER_SLOTS; i++) {
      const slot = document.createElement("button");
      slot.className = "order-slot";
      this.paintOrderSlot(slot, i);
      slot.onclick = () => {
        // Toggle: placing the selected grid where it already is clears the slot.
        this.arr.order[i] = this.arr.order[i] === this.orderBrush ? EMPTY : this.orderBrush;
        this.paintOrderSlot(slot, i);
        this.syncPattern();
      };
      this.orderSlotEls.push(slot);
      grid.append(slot);
    }
    wrap.append(grid);
    return wrap;
  }

  /** Colour swatches for the six grids; the selected one is the placing brush. */
  private gridPalette(): HTMLElement {
    const row = document.createElement("div");
    row.className = "grid-palette";
    for (let g = 0; g < NUM_BLOCKS; g++) {
      const b = document.createElement("button");
      b.className = "grid-swatch" + (g === this.orderBrush ? " on" : "");
      b.style.background = GRID_COLORS[g];
      b.textContent = String(g + 1);
      b.onclick = () => {
        this.orderBrush = g;
        row.querySelectorAll(".grid-swatch").forEach((el) => el.classList.remove("on"));
        b.classList.add("on");
      };
      row.append(b);
    }
    return row;
  }

  private paintOrderSlot(el: HTMLElement, i: number): void {
    const g = this.arr.order[i];
    if (g >= 0) {
      el.style.background = GRID_COLORS[g];
      el.textContent = String(g + 1);
      el.classList.remove("empty");
    } else {
      el.style.background = "";
      el.textContent = String(i + 1);
      el.classList.add("empty");
    }
  }

  // --- sound view -------------------------------------------------------
  private renderSound(): void {
    const v = this.viewRoot;

    const sound = new SoundView(this.kit, this.library, this.selectedDrum, {
      onChange: (d) => {
        this.engine.setParams(d, this.kit.get(d).capture());
        this.persist();
      },
      onAudition: (d) => this.audition(d),
    });

    v.append(this.drumSelector((d) => {
      this.selectedDrum = d;
      sound.setDrum(d);
      this.audition(d);
    }));
    v.append(sound.el);
  }
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = text;
  wrap.append(span, control);
  return wrap;
}
