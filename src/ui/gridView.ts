// Canvas paint grid for ONE melody block (8 steps x 7 rows). Touch-first:
// tap/drag to paint the active drum, tap a painted cell of the active drum to
// erase it (toggle, matching the desktop MelodyGridView). Draws 4-step
// separators and the playhead column.

import { MelodyGrid, NUM_ROWS, NUM_STEPS, EMPTY } from "../model/melodyGrid";
import { drumColour } from "../model/drums";

const LABEL_W = 0; // no row labels
const ROW_H = 40; // px per row (8-wide grid -> roughly square cells)

export class GridView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private grid: MelodyGrid;
  private activeDrum = 0;
  private playCol = -1;

  /** Called after a cell edit so the host can resend the grid to the engine. */
  onEdit: (() => void) | null = null;

  private cellW = 20;
  private painting = false;
  private erase = false;
  private lastRow = -1;
  private lastStep = -1;

  constructor(grid: MelodyGrid) {
    this.grid = grid;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "grid-canvas";
    this.canvas.style.touchAction = "none"; // we handle drag; don't scroll
    this.ctx = this.canvas.getContext("2d")!;

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  setBlock(grid: MelodyGrid): void {
    this.grid = grid;
    this.draw();
  }

  setActiveDrum(drum: number): void {
    this.activeDrum = drum;
  }

  setPlayhead(col: number): void {
    if (col === this.playCol) return;
    this.playCol = col;
    this.draw();
  }

  /** Size the backing store to the element's CSS width and redraw. */
  layout(): void {
    const cssW = this.canvas.clientWidth || 360;
    const cssH = NUM_ROWS * ROW_H;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cellW = (cssW - LABEL_W) / NUM_STEPS;
    this.draw();
  }

  // --- painting ---------------------------------------------------------
  private cellAt(e: PointerEvent): { row: number; step: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_W;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0) return null;
    const step = Math.floor(x / this.cellW);
    const row = Math.floor(y / ROW_H);
    return MelodyGrid.isValid(row, step) ? { row, step } : null;
  }

  private apply(row: number, step: number): void {
    this.grid.setCell(row, step, this.erase ? EMPTY : this.activeDrum);
    this.lastRow = row;
    this.lastStep = step;
    this.onEdit?.();
    this.draw();
  }

  private onPointerDown = (e: PointerEvent) => {
    const c = this.cellAt(e);
    if (!c) return;
    e.preventDefault();
    // Toggle: if the cell already holds the active drum, this stroke erases.
    this.erase = this.grid.getCell(c.row, c.step) === this.activeDrum;
    this.painting = true;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.apply(c.row, c.step);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.painting) return;
    const c = this.cellAt(e);
    if (c && (c.row !== this.lastRow || c.step !== this.lastStep)) {
      this.apply(c.row, c.step);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.painting) return;
    this.painting = false;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  // --- drawing ----------------------------------------------------------
  draw(): void {
    const ctx = this.ctx;
    const g = this.grid;
    const cssW = this.canvas.clientWidth || 360;
    const totalH = NUM_ROWS * ROW_H;

    ctx.clearRect(0, 0, cssW, totalH);

    for (let row = 0; row < NUM_ROWS; row++) {
      const y = row * ROW_H;

      for (let step = 0; step < NUM_STEPS; step++) {
        const x = LABEL_W + step * this.cellW;
        const drum = g.getCell(row, step);

        ctx.fillStyle = drum >= 0 ? drumColour(drum) : "#23252b";
        ctx.fillRect(x + 1, y + 1, this.cellW - 2, ROW_H - 2);

        // Stronger line on bar boundaries (every 4 steps).
        ctx.strokeStyle = "#0e0f12";
        ctx.lineWidth = step % 4 === 0 ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, this.cellW - 1, ROW_H - 1);
      }
    }

    // Playhead column.
    if (this.playCol >= 0) {
      const x = LABEL_W + this.playCol * this.cellW;
      ctx.strokeStyle = "#ffd60a";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, 1.5, this.cellW - 3, totalH - 3);
    }
  }
}
