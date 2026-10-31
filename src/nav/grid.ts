import { bbox, distToSegment, isBlocking, isEnclosed, isWalledPassage, pointInPolygon, wallSegments } from '../geometry';
import type { Floor, Vec2 } from '../types';

/** Tamaño de celda de la rejilla de navegación, en metros. */
export const CELL = 0.25;
/** Radio de la persona: los obstáculos se engordan esta distancia. */
export const AGENT_RADIUS = 0.2;
const WALL_HALF = 0.1;

export interface NavGrid {
  cols: number;
  rows: number;
  ox: number;
  oz: number;
  /** 1 = celda bloqueada (fuera del contorno, muros, estancias cerradas y núcleos). */
  base: Uint8Array;
  /** Celdas de cada estancia abierta, para poder bloquearlas a quien tenga prohibido el acceso. */
  spaceCells: Map<string, Int32Array>;
}

export function cellOf(g: NavGrid, p: Vec2) {
  const c = Math.floor((p.x - g.ox) / CELL);
  const r = Math.floor((p.z - g.oz) / CELL);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}

export function cellCenter(g: NavGrid, idx: number): Vec2 {
  const r = Math.floor(idx / g.cols);
  const c = idx - r * g.cols;
  return { x: g.ox + (c + 0.5) * CELL, z: g.oz + (r + 0.5) * CELL };
}

function cellRange(g: NavGrid, x0: number, z0: number, x1: number, z1: number) {
  return {
    c0: Math.max(0, Math.floor((x0 - g.ox) / CELL)),
    c1: Math.min(g.cols - 1, Math.floor((x1 - g.ox) / CELL)),
    r0: Math.max(0, Math.floor((z0 - g.oz) / CELL)),
    r1: Math.min(g.rows - 1, Math.floor((z1 - g.oz) / CELL)),
  };
}

/** Celdas cuyo centro cae dentro del rectángulo. */
function rectCells(g: NavGrid, x0: number, z0: number, x1: number, z1: number) {
  const out: number[] = [];
  const { c0, c1, r0, r1 } = cellRange(g, x0, z0, x1, z1);
  for (let r = r0; r <= r1; r++) {
    const cz = g.oz + (r + 0.5) * CELL;
    if (cz < z0 || cz > z1) continue;
    for (let c = c0; c <= c1; c++) {
      const cx = g.ox + (c + 0.5) * CELL;
      if (cx >= x0 && cx <= x1) out.push(r * g.cols + c);
    }
  }
  return out;
}

function markSegment(g: NavGrid, a: Vec2, b: Vec2, radius: number) {
  const { c0, c1, r0, r1 } = cellRange(
    g,
    Math.min(a.x, b.x) - radius,
    Math.min(a.z, b.z) - radius,
    Math.max(a.x, b.x) + radius,
    Math.max(a.z, b.z) + radius,
  );
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const p = { x: g.ox + (c + 0.5) * CELL, z: g.oz + (r + 0.5) * CELL };
      if (distToSegment(p, a, b) <= radius) g.base[r * g.cols + c] = 1;
    }
  }
}

/** `blockers`: rectángulos de muebles (phone nooks, pods…) que también bloquean el paso. */
export function buildGrid(floor: Floor, blockers: { x: number; z: number; w: number; d: number }[] = []): NavGrid {
  const outline = floor.outline.length >= 3 ? floor.outline : [];
  const bb = bbox(outline);
  const ox = bb.minX - 0.5;
  const oz = bb.minZ - 0.5;
  const cols = Math.max(1, Math.ceil((bb.maxX - bb.minX + 1) / CELL));
  const rows = Math.max(1, Math.ceil((bb.maxZ - bb.minZ + 1) / CELL));
  const g: NavGrid = { cols, rows, ox, oz, base: new Uint8Array(cols * rows), spaceCells: new Map() };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: ox + (c + 0.5) * CELL, z: oz + (r + 0.5) * CELL };
      if (!outline.length || !pointInPolygon(p, outline)) g.base[r * cols + c] = 1;
    }
  }

  const radius = WALL_HALF + AGENT_RADIUS;
  for (let i = 0; i < outline.length; i++) markSegment(g, outline[i], outline[(i + 1) % outline.length], radius);
  for (const w of floor.walls) markSegment(g, w.a, w.b, radius);

  for (const s of floor.spaces) {
    if (isEnclosed(s.kind) || isBlocking(s.kind)) {
      const R = AGENT_RADIUS;
      for (const idx of rectCells(g, s.x - R, s.z - R, s.x + s.w + R, s.z + s.d + R)) g.base[idx] = 1;
    } else {
      g.spaceCells.set(s.id, Int32Array.from(rectCells(g, s.x, s.z, s.x + s.w, s.z + s.d)));
      // Vestíbulos: sus paredes bloquean, salvo los huecos de las puertas
      if (isWalledPassage(s)) for (const [a, b] of wallSegments(s)) markSegment(g, a, b, WALL_HALF + AGENT_RADIUS);
    }
  }
  for (const r of blockers) {
    const R = AGENT_RADIUS;
    for (const idx of rectCells(g, r.x - R, r.z - R, r.x + r.w + R, r.z + r.d + R)) g.base[idx] = 1;
  }
  return g;
}

/** Celda libre más próxima (búsqueda en anillos de hasta `maxR` celdas). */
export function nearestFree(g: NavGrid, mask: Uint8Array, idx: number, maxR: number) {
  if (idx < 0) return -1;
  if (!mask[idx]) return idx;
  const r0 = Math.floor(idx / g.cols);
  const c0 = idx - r0 * g.cols;
  for (let rad = 1; rad <= maxR; rad++) {
    let best = -1;
    let bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
        const j = r * g.cols + c;
        if (mask[j]) continue;
        const d = dr * dr + dc * dc;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}
