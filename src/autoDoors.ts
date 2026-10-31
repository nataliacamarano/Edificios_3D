import { isEnclosed, isObstacle, pointInPolygon, sideEnds, sideLength, SIDES, uid } from './geometry';
import type { Floor, Side, Space, Vec2, Wall } from './types';

/**
 * Puertas automáticas: a cada estancia cerrada sin puertas se le pone una en el lado que da a más
 * zona de paso (pasillo, zona de trabajo…), en el centro del tramo libre más largo. Los muros
 * sueltos que tapan ese hueco se cortan. Es un borrador: la puerta se mueve o se quita a mano.
 */
const STEP = 0.2;
const OUT = 0.35; // distancia fuera de la pared a la que se mira si hay paso
const DOOR = 0.9;

const inside = (p: Vec2, s: Space, m = 0) => p.x > s.x - m && p.x < s.x + s.w + m && p.z > s.z - m && p.z < s.z + s.d + m;

function normal(side: Side): Vec2 {
  return side === 'n' ? { x: 0, z: -1 } : side === 's' ? { x: 0, z: 1 } : side === 'w' ? { x: -1, z: 0 } : { x: 1, z: 0 };
}

/** Tramo más largo de un lado que cumple `ok`: dónde empieza y cuánto mide (metros a lo largo). */
function longestRun(s: Space, side: Side, ok: (onSide: Vec2, outside: Vec2) => boolean) {
  const [a, b] = sideEnds(s, side);
  const L = sideLength(s, side);
  const n = normal(side);
  let best = { start: 0, len: 0 };
  let start = -1;
  const steps = Math.floor(L / STEP);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(1, (i * STEP + STEP / 2) / L);
    const on = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const good = i < steps && ok(on, { x: on.x + n.x * OUT, z: on.z + n.z * OUT });
    if (good && start < 0) start = i * STEP;
    if (!good && start >= 0) {
      const len = i * STEP - start;
      if (len > best.len) best = { start, len };
      start = -1;
    }
  }
  return best;
}

/** Corta los muros sueltos que pasan por el hueco de una puerta. */
function cutWalls(walls: Wall[], a: Vec2, b: Vec2): Wall[] {
  const horiz = Math.abs(a.z - b.z) < 1e-6;
  const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.z, b.z);
  const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.z, b.z);
  const at = horiz ? a.z : a.x;
  const out: Wall[] = [];
  for (const w of walls) {
    const wh = Math.abs(w.a.z - w.b.z) < 0.05;
    const wv = Math.abs(w.a.x - w.b.x) < 0.05;
    const same = horiz ? wh && Math.abs(w.a.z - at) < 0.25 : wv && Math.abs(w.a.x - at) < 0.25;
    if (!same) {
      out.push(w);
      continue;
    }
    const w0 = horiz ? Math.min(w.a.x, w.b.x) : Math.min(w.a.z, w.b.z);
    const w1 = horiz ? Math.max(w.a.x, w.b.x) : Math.max(w.a.z, w.b.z);
    if (w1 <= lo || w0 >= hi) {
      out.push(w);
      continue;
    }
    const piece = (s0: number, s1: number): Wall =>
      horiz
        ? { ...w, id: uid('w'), a: { x: s0, z: w.a.z }, b: { x: s1, z: w.b.z } }
        : { ...w, id: uid('w'), a: { x: w.a.x, z: s0 }, b: { x: w.b.x, z: s1 } };
    if (lo - w0 > 0.1) out.push(piece(w0, lo));
    if (w1 - hi > 0.1) out.push(piece(hi, w1));
  }
  return out;
}

export interface AutoDoorsResult {
  spaces: Space[];
  walls: Wall[];
  added: number;
  /** Estancias cerradas sin ningún lado que dé a una zona de paso. */
  stuck: string[];
}

export function autoDoors(floor: Floor): AutoDoorsResult {
  const blockers = floor.spaces.filter((s) => isEnclosed(s.kind) || isObstacle(s.kind) || s.kind === 'void');
  const walkable = (p: Vec2, self: Space) =>
    (floor.outline.length < 3 || pointInPolygon(p, floor.outline)) && !blockers.some((s) => s !== self && inside(p, s, 0.05));
  let walls = floor.walls;
  let added = 0;
  const stuck: string[] = [];
  const spaces = floor.spaces.map((s) => {
    if (!isEnclosed(s.kind) || s.doors.length || s.design) return s;
    let best: { side: Side; start: number; len: number } | null = null;
    for (const side of SIDES) {
      const r = longestRun(s, side, (_on, out) => walkable(out, s));
      if (r.len < Math.min(DOOR, sideLength(s, side) * 0.6)) continue;
      if (!best || r.len > best.len) best = { side, ...r };
    }
    if (!best) {
      stuck.push(s.name);
      return s;
    }
    const L = sideLength(s, best.side);
    const width = Math.min(DOOR, L * 0.6, best.len);
    const center = best.start + best.len / 2;
    const offset = Math.round((center / L) * 100) / 100;
    // Hueco de la puerta en los muros sueltos (los detectados en la foto suelen pasar por ahí)
    const [a, b] = sideEnds(s, best.side);
    const t0 = (center - width / 2) / L;
    const t1 = (center + width / 2) / L;
    walls = cutWalls(walls, { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 });
    added++;
    return { ...s, doors: [{ id: uid('d'), side: best.side, offset, width: Math.round(width * 100) / 100 }] };
  });
  return { spaces, walls, added, stuck };
}
