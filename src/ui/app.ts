// App shell: owns the engine + pattern + UI state, and switches between the two
// full-screen views (Steps / Sound). Within Steps you pick a workspace from the
// numbered pattern buttons: one of the six 16-step patterns (drawn as two stacked
// 8-wide grids), or the "Loop" view (20-slot order list) that sequences which
// patterns play and in what order. Painted lanes are added from saved sounds.

import { EngineHost, Playhead } from "../audio/engineHost";
import { DRUMS, DrumType, drumColour } from "../model/drums";
import { getParamSpec } from "../model/paramSpec";
import { ParamId } from "../model/params";
import { DrumKit } from "../model/drumKit";
import { FULL_RANGE_PRESET } from "../model/presets";
import { SoundLibrary, SavedSound } from "../model/soundLibrary";
import { serialize, deserialize, ProjectJSON } from "../model/project";
import {
  WipArrangement, NUM_BLOCKS, ORDER_SLOTS, EMPTY, GRID_COLORS,
} from "../model/melodyGrid";
import { ALL_ROOTS, ALL_SCALES } from "../model/melodyScale";
import { GridView } from "./gridView";
import { SoundView } from "./soundView";

// A paint lane added from the saved-sound library. Each lane gets its OWN engine
// channel (`drum`) so several saved sounds can play at once, plus its own identity
// colour and the Pitch range it maps melodies within.
interface Lane {
  drum: number; // unique engine channel (0-11) this lane plays on
  name: string;
  snapshot: number[];
  color: string;
  pitch: [number, number]; // Pitch range for melody mapping
}

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
  private selectedDrum: DrumType = DrumType.Kick; // voice edited in the Sounds view
  private soundName = ""; // last used sound name (prefills the Save dialog)
  private workspace = 0; // 0..5 = pattern index, ORDER_VIEW = loop/order list
  private orderBrush = 0; // which pattern (colour) the order grid places
  private playing = false;
  private tempo = 120;

  // Paint lanes shown under the Steps grid. Empty by default; the + button adds
  // saved sounds. activeLane indexes into this list (-1 = nothing to paint).
  private lanes: Lane[] = [];
  private activeLane = -1;

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
    // The editor voice (selectedDrum) + every lane on its own channel.
    this.engine.setParams(this.selectedDrum, this.kit.get(this.selectedDrum).capture());
    this.pushLanes();
    this.pushPitchRanges();
    this.syncPattern();
    this.engine.setTempo(this.tempo);
  }

  /** Push each lane's snapshot to its own engine channel. */
  private pushLanes(): void {
    for (const lane of this.lanes) this.engine.setParams(lane.drum, lane.snapshot);
  }

  /** Send Pitch ranges for the melody mapping: the editor voice + each lane use
      their live range; unused channels fall back to the static per-drum spec. */
  private pushPitchRanges(): void {
    const ranges: (number[] | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const sp = getParamSpec(i as DrumType, ParamId.Pitch);
      ranges[i] = [sp.min, sp.max];
    }
    ranges[this.selectedDrum] = this.kit.pitchRange(this.selectedDrum);
    for (const lane of this.lanes) ranges[lane.drum] = [lane.pitch[0], lane.pitch[1]];
    this.engine.setPitchRanges(ranges);
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
        const json = serialize(this.arr, this.kit, this.tempo, this.drumTypes, this.lanes, this.soundName);
        localStorage.setItem(PROJECT_KEY, JSON.stringify(json));
      } catch {
        /* ignore quota errors */
      }
    }, 300);
  }

  private loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(PROJECT_KEY);
      if (!raw) return false;
      const json = JSON.parse(raw) as ProjectJSON;
      this.tempo = deserialize(json, this.arr, this.kit, this.drumTypes, this.lanes);
      this.soundName = json.soundName ?? this.soundName;
      this.activeLane = this.lanes.length ? 0 : -1;
      return true;
    } catch {
      return false; // ignore corrupt storage
    }
  }

  private saveToFile(): void {
    const json = serialize(this.arr, this.kit, this.tempo, this.drumTypes, this.lanes, this.soundName);
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
        this.tempo = deserialize(json, this.arr, this.kit, this.drumTypes, this.lanes);
        this.soundName = json.soundName ?? "";
        this.activeLane = this.lanes.length ? 0 : -1;
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
    this.applyRandomDefault(); // default editor sound: random Full Range
    this.tempo = 120;
    this.lanes = [];
    this.activeLane = -1;
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

  /** Preview a lane on its own channel (lanes aren't in the editable kit). */
  private auditionLane(lane: Lane): void {
    const gate = Math.round(this.engine.sampleRate * 0.4);
    this.engine.trigger(lane.drum, lane.snapshot, gate);
  }

  /** The editor's default sound: Full Range, fully shuffled so it's random and
      different every time, with no carried-over name. */
  private applyRandomDefault(): void {
    this.kit.applyPreset(this.selectedDrum, FULL_RANGE_PRESET);
    this.kit.shuffleAll(this.selectedDrum, 1.0); // 100% -> uniform over the full range
    this.soundName = "";
  }

  /** After saving a sound: drop back to a fresh random Full Range sound. */
  private revertEditorToDefault(): void {
    this.applyRandomDefault();
    this.engine.setParams(this.selectedDrum, this.kit.get(this.selectedDrum).capture());
    this.pushPitchRanges();
    this.audition(this.selectedDrum);
    this.persist();
    this.render();
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
      // Fresh session (no saved project): start on a random Full Range sound.
      if (!this.loadFromStorage()) this.applyRandomDefault();
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
      b.textContent = v === "grid" ? "Steps" : "Sounds";
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

  // --- steps view -------------------------------------------------------
  private renderGrid(): void {
    const v = this.viewRoot;
    v.append(this.patternBar());

    if (this.workspace === ORDER_VIEW) {
      v.append(this.renderOrderEditor());
    } else {
      const gridWrap = document.createElement("div");
      gridWrap.className = "grid-wrap";
      this.gridView.setBlock(this.arr.blocks[this.workspace]);
      this.gridView.setActiveDrum(this.activeDrumForPaint());
      // Colour painted cells by the lane that owns that channel.
      this.gridView.colorForDrum = (ch) => this.lanes.find((l) => l.drum === ch)?.color ?? drumColour(ch);
      gridWrap.append(this.gridView.canvas);
      v.append(gridWrap);

      v.append(this.scaleControls());
      v.append(this.laneSelector());

      requestAnimationFrame(() => this.gridView.layout());
    }

    this.updateLoopTime();
  }

  /** Numbered pattern buttons (replacing the old dropdown) + the Loop view button. */
  private patternBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "pattern-bar";

    for (let i = 0; i < NUM_BLOCKS; i++) {
      const b = document.createElement("button");
      b.className = "pat-btn" + (this.workspace === i ? " on" : "");
      b.textContent = String(i + 1);
      b.style.setProperty("--pat", GRID_COLORS[i]);
      b.onclick = () => { this.workspace = i; this.render(); };
      bar.append(b);
    }

    const loop = document.createElement("button");
    loop.className = "loop-view-btn" + (this.workspace === ORDER_VIEW ? " on" : "");
    loop.textContent = "↻";
    loop.title = "Loop / order view";
    loop.onclick = () => { this.workspace = ORDER_VIEW; this.render(); };
    bar.append(loop);

    return bar;
  }

  /** Root + scale pickers, shown below both stacked grids. */
  private scaleControls(): HTMLElement {
    const blk = this.arr.blocks[this.workspace];
    const row = document.createElement("div");
    row.className = "scale-ctl";

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

    row.append(labelled("Root", rootSel), labelled("Scale", scaleSel));
    return row;
  }

  // --- paint lanes ------------------------------------------------------
  /** Drum index the grid paints, or -1 when no lane is selected. */
  private activeDrumForPaint(): number {
    const lane = this.lanes[this.activeLane];
    return lane ? lane.drum : -1;
  }

  /** Added sound lanes (none by default) plus a + button to add from the library. */
  private laneSelector(): HTMLElement {
    const row = document.createElement("div");
    row.className = "lane-bar";

    const lanes = document.createElement("div");
    lanes.className = "lanes";
    this.lanes.forEach((lane, i) => {
      const b = document.createElement("button");
      b.className = "drum-pad" + (i === this.activeLane ? " on" : "");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = lane.color;
      const name = document.createElement("span");
      name.textContent = lane.name;
      b.append(sw, name);
      b.onclick = () => this.selectLane(i);
      // The selected lane gets an × to remove it.
      if (i === this.activeLane) {
        const rm = document.createElement("span");
        rm.className = "lane-remove";
        rm.textContent = "×";
        rm.title = "Remove lane";
        rm.onclick = (e) => { e.stopPropagation(); this.removeLane(i); };
        b.append(rm);
      }
      lanes.append(b);
    });

    const add = document.createElement("button");
    add.className = "add-sound-btn";
    add.textContent = "+";
    add.title = "Add a saved sound";
    add.onclick = (e) => { e.stopPropagation(); this.openSoundPicker(row); };

    row.append(lanes, add);
    return row;
  }

  private selectLane(i: number): void {
    this.activeLane = i;
    const lane = this.lanes[i];
    if (!lane) return;
    // The lane already owns its channel + params; just paint with it and preview.
    this.engine.setParams(lane.drum, lane.snapshot);
    this.gridView.setActiveDrum(lane.drum);
    this.auditionLane(lane);
    this.persist();
    this.render();
  }

  private removeLane(i: number): void {
    this.lanes.splice(i, 1); // frees the channel for the next added sound
    if (this.activeLane === i) this.activeLane = -1; // nothing selected to paint
    else if (this.activeLane > i) this.activeLane -= 1;
    this.gridView.setActiveDrum(this.activeDrumForPaint());
    this.pushPitchRanges();
    this.persist();
    this.render();
  }

  /** First engine channel (0-11) not used by the editor voice or another lane. */
  private nextFreeChannel(): number {
    const used = new Set<number>([this.selectedDrum, ...this.lanes.map((l) => l.drum)]);
    for (let c = 0; c < 12; c++) if (!used.has(c)) return c;
    return -1;
  }

  /** Popup of every saved sound across drums; choosing one adds it as a lane. */
  private openSoundPicker(anchor: HTMLElement): void {
    const existing = anchor.querySelector(".sound-picker");
    if (existing) { existing.remove(); return; }

    const panel = document.createElement("div");
    panel.className = "sound-picker";

    const items = this.library.all();
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No saved sounds yet. Save some in the Sounds view.";
      panel.append(empty);
    } else {
      for (const it of items) {
        const b = document.createElement("button");
        const sw = document.createElement("span");
        sw.className = "swatch";
        sw.style.background = it.color;
        const name = document.createElement("span");
        name.textContent = it.name;
        b.append(sw, name);
        b.onclick = () => {
          panel.remove();
          this.addLane(it);
        };
        panel.append(b);
      }
    }

    anchor.append(panel);
    // Dismiss on the next outside tap.
    const close = (ev: PointerEvent) => {
      if (!panel.contains(ev.target as Node)) {
        panel.remove();
        document.removeEventListener("pointerdown", close, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  private addLane(sound: SavedSound): void {
    const channel = this.nextFreeChannel();
    if (channel < 0) { alert("Maximum number of sounds reached."); return; }
    const lane: Lane = {
      drum: channel,
      name: sound.name,
      snapshot: sound.snapshot.slice(),
      color: sound.color,
      pitch: [sound.pitch[0], sound.pitch[1]],
    };
    this.lanes.push(lane);
    this.engine.setParams(channel, lane.snapshot);
    this.pushPitchRanges();
    this.selectLane(this.lanes.length - 1);
  }

  // --- order editor -----------------------------------------------------
  private renderOrderEditor(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "order-editor";

    const loop = document.createElement("div");
    loop.className = "loop-time";
    const loopLabel = document.createElement("span");
    loopLabel.className = "loop-time-label";
    loopLabel.textContent = "Loop length";
    this.loopTimeEl = document.createElement("span");
    this.loopTimeEl.className = "loop-time-val";
    loop.append(loopLabel, this.loopTimeEl);
    wrap.append(loop);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Pick a pattern colour, then tap slots to place it. Plays top-left to bottom-right.";
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

  /** Colour swatches for the six patterns; the selected one is the placing brush. */
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

    const sound = new SoundView(this.kit, this.library, this.selectedDrum, this.soundName, {
      onChange: (d) => {
        this.engine.setParams(d, this.kit.get(d).capture());
        this.persist();
      },
      onRangeChange: () => {
        this.pushPitchRanges();
        this.persist();
      },
      onAudition: (d) => this.audition(d),
      onRename: (name) => { this.soundName = name; this.persist(); },
      onSaved: () => this.revertEditorToDefault(),
    });

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
