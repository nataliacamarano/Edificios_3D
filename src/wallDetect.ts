import { distToSegment, isEnclosed, pointInPolygon } from './geometry';
import type { Background, Floor, Vec2, Wall } from './types';

/**
 * Detección automática de paredes en la foto del plano. Las paredes se dibujan como trazos
 * oscuros y gruesos: se queda con los píxeles oscuros, quita lo fino (texto, cotas, muebles) con
 * una apertura morfológica y busca tramos rectos largos, horizontales y verticales. El resultado
 * es un borrador: los muros salen marcados como detectados para corregirlos o quitarlos de golpe.
 */
export type Sensitivity = 'low' | 'medium' | 'high';

const PARAMS: Record<Sensitivity, { dark: number; thick: number; minLen: number }> = {
  // dark: luminancia máxima de un trazo (0–255); thick: grosor mínimo (m); minLen: largo mínimo (m)
  low: { dark: 70, thick: 0.15, minLen: 2 },
  medium: { dark: 85, thick: 0.12, minLen: 1.5 },
  high: { dark: 115, thick: 0.08, minLen: 1 },
};
/** Grupos de trazos sueltos más pequeños que esto son muebles, letras o símbolos, no paredes. */
const MIN_GROUP = 2.5;
/** Más grueso que esto es una mancha (núcleo relleno, columna, sombra), no una pared. */
const MAX_THICK = 0.6;
/** Distancia para unir tramos alineados y para cerrar esquinas. */
const JOIN = 0.35;

export interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/** Carga la imagen y la reduce (como mucho `maxDim` píxeles de lado) para analizarla. */
export function loadPixels(url: string, maxDim = 2000): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ data: ctx.getImageData(0, 0, w, h).data, w, h });
    };
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/** Suma acumulada 2D: cuenta de píxeles marcados en cualquier rectángulo en O(1). */
function integral(mask: Uint8Array, w: number, h: number) {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  return (x0: number, y0: number, x1: number, y1: number) => {
    // Rectángulo [x0, x1) × [y0, y1), recortado a la imagen
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(w, x1);
    y1 = Math.min(h, y1);
    if (x1 <= x0 || y1 <= y0) return 0;
    return I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  };
}

/** Píxeles oscuros que forman trazos de al menos k × k (apertura: erosión y dilatación). */
function thickDark({ data, w, h }: Pixels, dark: number, k: number) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    mask[i] = lum < dark && data[i * 4 + 3] > 128 ? 1 : 0;
  }
  if (k <= 1) return mask;
  const a = Math.floor(k / 2);
  const sum = integral(mask, w, h);
  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) eroded[y * w + x] = sum(x - a, y - a, x - a + k, y - a + k) === k * k ? 1 : 0;
  const sumE = integral(eroded, w, h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = sumE(x - k + 1 + a, y - k + 1 + a, x + 1 + a, y + 1 + a) > 0 ? 1 : 0;
  return out;
}

/** Tramo detectado en píxeles: a lo largo de `along` (de s0 a s1), a la altura `at`, con grosor. */
export interface Band {
  at: number;
  s0: number;
  s1: number;
  thick: number;
}

/**
 * Bandas horizontales: tramos largos de cada fila que continúan en las filas siguientes. Para las
 * verticales se llama con la imagen traspuesta (get intercambia x e y).
 */
export function bands(get: (a: number, b: number) => number, rows: number, cols: number, minLen: number, maxThick: number): Band[] {
  type Open = { y0: number; y1: number; x0: number; x1: number };
  const out: Band[] = [];
  let open: Open[] = [];
  const close = (c: Open) => {
    const thick = c.y1 - c.y0 + 1;
    if (thick <= maxThick) out.push({ at: (c.y0 + c.y1 + 1) / 2, s0: c.x0, s1: c.x1 + 1, thick });
  };
  for (let y = 0; y < rows; y++) {
    const next: Open[] = [];
    let x = 0;
    while (x < cols) {
      if (!get(y, x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < cols && get(y, x)) x++;
      const end = x - 1;
      if (end - start + 1 < minLen) continue;
      // Continúa una banda abierta de la fila anterior si se solapan bastante
      const i = open.findIndex((c) => {
        const ov = Math.min(c.x1, end) - Math.max(c.x0, start);
        return ov >= 0.6 * Math.min(c.x1 - c.x0, end - start);
      });
      if (i >= 0) {
        const c = open[i];
        open.splice(i, 1);
        next.push({ y0: c.y0, y1: y, x0: Math.min(c.x0, start), x1: Math.max(c.x1, end) });
      } else next.push({ y0: y, y1: y, x0: start, x1: end });
    }
    open.forEach(close);
    open = next;
  }
  open.forEach(close);
  return out;
}

/** Píxel de la imagen analizada → metros, con la posición y el giro de la foto en la planta. */
export function pixelToMeters(bg: Background, w: number, h: number) {
  const cx = bg.x + bg.w / 2;
  const cz = bg.z + bg.d / 2;
  const r = ((bg.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return (px: number, py: number): Vec2 => {
    const x = bg.x + (px / w) * bg.w - cx;
    const z = bg.z + (py / h) * bg.d - cz;
    return { x: cx + x * cos - z * sin, z: cz + x * sin + z * cos };
  };
}

/** Segmento recto: horizontal (h) a la altura `at`, o vertical (v) en la x `at`, de s0 a s1. */
interface Seg {
  h: boolean;
  at: number;
  s0: number;
  s1: number;
  /** Peso para promediar al unir (largo). */
  wt: number;
}

/** Une tramos alineados que se solapan o casi se tocan. */
function mergeCollinear(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const h of [true, false]) {
    const list = segs.filter((s) => s.h === h).sort((a, b) => a.at - b.at || a.s0 - b.s0);
    const done = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (done[i]) continue;
      const cur = { ...list[i] };
      done[i] = true;
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < list.length; j++) {
          if (done[j]) continue;
          const o = list[j];
          if (Math.abs(o.at - cur.at) > 0.15) continue;
          if (o.s0 > cur.s1 + JOIN || o.s1 < cur.s0 - JOIN) continue;
          cur.at = (cur.at * cur.wt + o.at * o.wt) / (cur.wt + o.wt);
          cur.s0 = Math.min(cur.s0, o.s0);
          cur.s1 = Math.max(cur.s1, o.s1);
          cur.wt += o.wt;
          done[j] = true;
          grew = true;
        }
      }
      out.push(cur);
    }
  }
  return out;
}

/** Lleva los extremos sueltos hasta la pared perpendicular más cercana para cerrar las esquinas. */
function joinCorners(segs: Seg[]) {
  for (const s of segs)
    for (const end of ['s0', 's1'] as const) {
      let best: Seg | null = null;
      let bestD = JOIN;
      for (const o of segs) {
        if (o.h === s.h) continue;
        // El otro muro debe pasar (o casi) por la altura de este
        if (s.at < o.s0 - JOIN || s.at > o.s1 + JOIN) continue;
        const d = Math.abs(o.at - s[end]);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        s[end] = best.at;
        // Y el otro se alarga si se quedaba corto
        best.s0 = Math.min(best.s0, s.at);
        best.s1 = Math.max(best.s1, s.at);
      }
    }
}

/**
 * Quita los grupos de tramos que se tocan entre sí pero no llegan a nada más grande: una encimera,
 * un aparcabicis, una letra o un símbolo. Las paredes forman una red grande unida a la fachada.
 */
type Box = { x0: number; x1: number; z0: number; z1: number };

/** Caja de la red de tramos unidos a la que pertenece cada tramo. */
function networkBoxes(segs: Seg[]): Box[] {
  const touch = (a: Seg, b: Seg) =>
    a.h !== b.h && b.at >= a.s0 - JOIN && b.at <= a.s1 + JOIN && a.at >= b.s0 - JOIN && a.at <= b.s1 + JOIN;
  const group = segs.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) if (touch(segs[i], segs[j])) group[find(i)] = find(j);
  const box = new Map<number, Box>();
  segs.forEach((s, i) => {
    const g = find(i);
    const [x0, x1, z0, z1] = s.h ? [s.s0, s.s1, s.at, s.at] : [s.at, s.at, s.s0, s.s1];
    const b = box.get(g);
    if (!b) box.set(g, { x0, x1, z0, z1 });
    else Object.assign(b, { x0: Math.min(b.x0, x0), x1: Math.max(b.x1, x1), z0: Math.min(b.z0, z0), z1: Math.max(b.z1, z1) });
  });
  return segs.map((_, i) => box.get(find(i))!);
}

function dropDebris(segs: Seg[]): Seg[] {
  const boxes = networkBoxes(segs);
  return segs.filter((_, i) => {
    const b = boxes[i];
    const big = Math.max(b.x1 - b.x0, b.z1 - b.z0);
    const small = Math.min(b.x1 - b.x0, b.z1 - b.z0);
    // Pequeño en todo, o estrecho y corto (encimeras, filas de taquillas sueltas)
    return big >= MIN_GROUP && !(small < 1 && big < 4);
  });
}

const snap = (v: number) => +(Math.round(v / 0.05) * 0.05).toFixed(2);

/** Bordes de lo que ya está dibujado (muros a mano y estancias cerradas), para no duplicarlos. */
function drawnEdges(floor: Floor): [Vec2, Vec2][] {
  const edges: [Vec2, Vec2][] = floor.walls.filter((w) => !w.detected).map((w) => [w.a, w.b]);
  for (const s of floor.spaces) {
    if (!isEnclosed(s.kind)) continue;
    const c = [
      { x: s.x, z: s.z },
      { x: s.x + s.w, z: s.z },
      { x: s.x + s.w, z: s.z + s.d },
      { x: s.x, z: s.z + s.d },
    ];
    for (let i = 0; i < 4; i++) edges.push([c[i], c[(i + 1) % 4]]);
  }
  return edges;
}

function alreadyDrawn(a: Vec2, b: Vec2, edges: [Vec2, Vec2][]) {
  const pts = [0.15, 0.5, 0.85].map((t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }));
  return pts.every((p) => edges.some(([e0, e1]) => distToSegment(p, e0, e1) < 0.25));
}

const nearOutline = (p: Vec2, poly: Vec2[]) => poly.some((a, i) => distToSegment(p, a, poly[(i + 1) % poly.length]) < 0.4);

/** Tramos rectos (ya unidos y con las esquinas cerradas) que salen de la foto. */
function photoSegments(px: Pixels, bg: Background, p: (typeof PARAMS)[Sensitivity]): Seg[] {
  // Metros por píxel de la imagen analizada (la foto puede estar estirada distinto en cada eje)
  const mx = bg.w / px.w;
  const mz = bg.d / px.h;
  const m = (mx + mz) / 2;
  const k = Math.max(1, Math.round(p.thick / m));
  const mask = thickDark(px, p.dark, k);
  const { w, h } = px;
  const toM = pixelToMeters(bg, w, h);
  const minLenPx = p.minLen / m;
  const maxThickPx = MAX_THICK / m;

  const hor = bands((y, x) => mask[y * w + x], h, w, minLenPx, maxThickPx);
  const ver = bands((x, y) => mask[y * w + x], w, h, minLenPx, maxThickPx);

  // A metros. Con la foto girada 90° las horizontales de la imagen pasan a ser verticales.
  const segs: Seg[] = [];
  const add = (a: Vec2, b: Vec2) => {
    const dx = Math.abs(b.x - a.x);
    const dz = Math.abs(b.z - a.z);
    if (dx >= dz) segs.push({ h: true, at: (a.z + b.z) / 2, s0: Math.min(a.x, b.x), s1: Math.max(a.x, b.x), wt: dx });
    else segs.push({ h: false, at: (a.x + b.x) / 2, s0: Math.min(a.z, b.z), s1: Math.max(a.z, b.z), wt: dz });
  };
  for (const b of hor) add(toM(b.s0, b.at), toM(b.s1, b.at));
  for (const b of ver) add(toM(b.at, b.s0), toM(b.at, b.s1));

  const merged = mergeCollinear(segs);
  joinCorners(merged);
  return merged;
}

/**
 * Borde del edificio en la foto: la caja de la red de paredes más grande. Deja fuera el título,
 * la leyenda y los márgenes de la foto. Null si no se encuentra nada fiable.
 */
export function detectOutline(px: Pixels, bg: Background): Vec2[] | null {
  const segs = photoSegments(px, bg, PARAMS.medium);
  if (!segs.length) return null;
  const boxes = networkBoxes(segs);
  const area = (b: Box) => (b.x1 - b.x0) * (b.z1 - b.z0);
  const b = boxes.reduce((best, x) => (area(x) > area(best) ? x : best));
  // Si apenas ocupa la foto, mejor no tocar el contorno
  if (area(b) < 0.25 * bg.w * bg.d) return null;
  const [x0, x1, z0, z1] = [snap(b.x0), snap(b.x1), snap(b.z0), snap(b.z1)];
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
}

/** Detecta las paredes de la foto de la planta. Devuelve muros nuevos marcados como detectados. */
export function detectWalls(px: Pixels, floor: Floor, sensitivity: Sensitivity, newId: () => string): Wall[] {
  const bg = floor.background;
  if (!bg) return [];
  const p = PARAMS[sensitivity];
  const merged = photoSegments(px, bg, p);

  const edges = drawnEdges(floor);
  const out: Wall[] = [];
  for (const s of dropDebris(merged)) {
    if (s.s1 - s.s0 < p.minLen) continue;
    const a = s.h ? { x: snap(s.s0), z: snap(s.at) } : { x: snap(s.at), z: snap(s.s0) };
    const b = s.h ? { x: snap(s.s1), z: snap(s.at) } : { x: snap(s.at), z: snap(s.s1) };
    // Fuera del edificio (leyenda, título del cartel) no hay paredes
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    // (con margen: la fachada cae justo sobre el contorno)
    if (floor.outline.length >= 3 && !pointInPolygon(mid, floor.outline) && !nearOutline(mid, floor.outline)) continue;
    if (alreadyDrawn(a, b, edges)) continue;
    out.push({ id: newId(), a, b, detected: true });
  }
  return out;
}
