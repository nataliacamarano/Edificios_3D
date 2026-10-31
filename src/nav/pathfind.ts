import { dist, lerp } from '../geometry';
import type { Vec2 } from '../types';
import { CELL, cellCenter, cellOf, type NavGrid } from './grid';

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, p: number) {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[i] = ids[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }
  pop(): [number, number] {
    const ids = this.ids;
    const pri = this.pri;
    const top: [number, number] = [ids[0], pri[0]];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && pri[r] < pri[l] ? r : l;
        if (pri[m] >= lastP) break;
        ids[i] = ids[m];
        pri[i] = pri[m];
        i = m;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}

/**
 * Coste desde `src` a todas las celdas, con 8 vecinos y sin cortar esquinas. Sin pesos es la
 * distancia en metros; con pesos, cada paso cuesta su distancia por el peso de la celda de llegada.
 */
export function dijkstra(g: NavGrid, mask: Uint8Array, src: number, weight?: Float32Array): Float64Array {
  const { cols, rows } = g;
  const d = new Float64Array(cols * rows).fill(Infinity);
  if (src < 0 || mask[src]) return d;
  d[src] = 0;
  const heap = new MinHeap();
  heap.push(src, 0);
  while (heap.size) {
    const [u, du] = heap.pop();
    if (du > d[u]) continue;
    const r = (u / cols) | 0;
    const c = u - r * cols;
    for (const [dc, dr, w] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const v = nr * cols + nc;
      if (mask[v]) continue;
      if (dc && dr && (mask[r * cols + nc] || mask[nr * cols + c])) continue;
      const nd = du + w * CELL * (weight ? weight[v] : 1);
      if (nd < d[v]) {
        d[v] = nd;
        heap.push(v, nd);
      }
    }
  }
  return d;
}

/** Recorre el campo de distancias cuesta abajo desde `target` hasta el origen. */
export function tracePath(
  g: NavGrid,
  mask: Uint8Array,
  field: Float64Array,
  target: number,
  weight?: Float32Array,
): number[] {
  if (target < 0 || !isFinite(field[target])) return [];
  const { cols, rows } = g;
  const path = [target];
  let cur = target;
  let guard = 0;
  while (field[cur] > 1e-9 && guard++ < cols * rows) {
    const r = (cur / cols) | 0;
    const c = cur - r * cols;
    const wc = weight ? weight[cur] : 1;
    let best = -1;
    let bestVal = Infinity;
    for (const [dc, dr, w] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const v = nr * cols + nc;
      if (mask[v]) continue;
      if (dc && dr && (mask[r * cols + nc] || mask[nr * cols + c])) continue;
      const val = field[v] + w * CELL * wc;
      if (val < bestVal) {
        bestVal = val;
        best = v;
      }
    }
    if (best < 0 || field[best] >= field[cur]) break;
    path.push(best);
    cur = best;
  }
  return path.reverse();
}

/**
 * Visibilidad directa entre dos puntos. Con pesos, el atajo no puede entrar en celdas más
 * penalizadas que sus extremos (así no se cuela por una zona que la ruta rodeaba).
 */
function lineOfSight(g: NavGrid, mask: Uint8Array, a: Vec2, b: Vec2, weight?: Float32Array) {
  const n = Math.ceil(dist(a, b) / (CELL * 0.25));
  const limit = weight ? Math.max(weight[cellOf(g, a)] ?? 1, weight[cellOf(g, b)] ?? 1) : 1;
  for (let i = 0; i <= n; i++) {
    const idx = cellOf(g, lerp(a, b, n ? i / n : 0));
    if (idx < 0 || mask[idx]) return false;
    if (weight && weight[idx] > limit) return false;
  }
  return true;
}

/** Elimina los zigzags de la rejilla uniendo puntos con visibilidad directa. */
export function smoothPath(g: NavGrid, mask: Uint8Array, pts: Vec2[], weight?: Float32Array): Vec2[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && lineOfSight(g, mask, pts[i], pts[j + 1], weight)) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

export function cellsToPoints(g: NavGrid, cells: number[]) {
  return cells.map((c) => cellCenter(g, c));
}
