// App shell: owns the engine + pattern + UI state, and switches between the two
// full-screen views (Grid / Sound). Phase 3 builds out the Grid view; the Sound
// view is a stub until Phase 4.

import { EngineHost } from "../audio/engineHost";
import { DRUMS, DrumType } from "../model/drums";
import { getParamSpec } from "../model/paramSpec";
import { ParamId } from "../model/params";
import { DrumKit } from "../model/drumKit";
import { SoundLibrary } from "../model/soundLibrary";
import { serialize, deserialize, ProjectJSON } from "../model/project";
import { WipArrangement, NUM_BLOCKS } from "../model/melodyGrid";
import { ALL_ROOTS, ALL_SCALES } from "../model/melodyScale";
import { GridView } from "./gridView";
import { SoundView } from "./soundView";

const PROJECT_KEY = "msq010.project";

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
  private selectedBlock = 0;
  private playing = false;
  private tempo = 120;

  private root: HTMLElement;
  private viewRoot!: HTMLElement;
  private gridView = new GridView(this.arr.blocks[0]);

  constructor(root: HTMLElement) {
    this.root = root;

    this.engine.onPlayhead = (p) => {
      this.gridView.setPlayhead(p.block === this.selectedBlock ? p.col : -1);
    };
    // Resume audio after iOS/tab interruptions.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.engine.resume();
    });
    this.renderStart();
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
    this.syncGrid();
    this.engine.setTempo(this.tempo);
  }

  private syncGrid(): void {
    this.engine.setGrid(this.arr.toMessage());
    this.persist();
  }

  // --- persistence ------------------------------------------------------
  /** Debounced autosave of the whole project to localStorage. */
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

  /** Re-push everything to the engine and fully re-render after a load/new. */
  private afterProjectChange(): void {
    if (this.playing) { this.playing = false; this.engine.stop(); }
    this.gridView = new GridView(this.arr.blocks[this.selectedBlock]);
    this.engine.onPlayhead = (p) => {
      this.gridView.setPlayhead(p.block === this.selectedBlock ? p.col : -1);
    };
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
      this.persist();
    };

    t.append(play, tempo, label);
    return t;
  }

  // --- grid view --------------------------------------------------------
  private renderGrid(): void {
    const v = this.viewRoot;

    v.append(this.blockTabs());
    v.append(this.blockControls());

    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";
    this.gridView.setBlock(this.arr.blocks[this.selectedBlock]);
    this.gridView.setActiveDrum(this.selectedDrum);
    gridWrap.append(this.gridView.canvas);
    v.append(gridWrap);

    v.append(this.drumSelector((d) => {
      this.selectedDrum = d;
      this.gridView.setActiveDrum(d);
      this.audition(d);
    }));

    // Size the canvas after it is in the DOM.
    requestAnimationFrame(() => this.gridView.layout());
  }

  private blockTabs(): HTMLElement {
    const row = document.createElement("div");
    row.className = "block-tabs";
    for (let b = 0; b < NUM_BLOCKS; b++) {
      const tab = document.createElement("button");
      const blk = this.arr.blocks[b];
      tab.textContent = String(b + 1);
      tab.className =
        "block-tab" +
        (b === this.selectedBlock ? " on" : "") +
        (blk.active ? "" : " muted");
      tab.onclick = () => {
        this.selectedBlock = b;
        this.render();
      };
      row.append(tab);
    }
    return row;
  }

  private blockControls(): HTMLElement {
    const blk = this.arr.blocks[this.selectedBlock];
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
      this.syncGrid();
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
      this.syncGrid();
    };

    const loop = document.createElement("button");
    loop.className = "loop-btn" + (blk.active ? " on" : "");
    loop.textContent = blk.active ? "Loop ●" : "Loop ○";
    loop.onclick = () => {
      blk.active = !blk.active;
      loop.className = "loop-btn" + (blk.active ? " on" : "");
      loop.textContent = blk.active ? "Loop ●" : "Loop ○";
      this.gridView.draw();
      this.syncGrid();
      // Refresh the tab's muted state.
      this.render();
    };

    row.append(labelled("Root", rootSel), labelled("Scale", scaleSel), loop);
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
