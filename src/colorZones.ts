import { pointInPolygon } from './geometry';
import type { Floor } from './types';
import { pixelToMeters, type Pixels } from './wallDetect';

/**
 * Detección de zonas por color en la foto del plano: los planos pintan cada tipo de sala con un
 * relleno (aseos rosa y azul, salas grises, zonas verdes…). Se buscan los colores de relleno más
 * abundantes y, para cada uno, las manchas de ese color; cada mancha da un rectángulo.
 */
export interface ColorZone {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface ColorGroup {
  /** Color medio del relleno, en #rrggbb. */
  color: string;
  zones: ColorZone[];
  /** Superficie total de las zonas, en m². */
  area: number;
}

/** Más claro que esto es el fondo del papel; más oscuro, líneas y letras. */
const MAX_LUM = 232;
const MIN_LUM = 120;
/**
 * Diferencia de color que aún cuenta como el mismo relleno, en ΔE (espacio Lab, como lo ve el ojo):
 * distingue tonos pálidos parecidos (azul claro de un aseo y lila de una sala) mejor que el RGB.
 */
const SAME = 8;
// Una sala no mide menos de esto: lo más pequeño suelen ser mesas o símbolos coloreados
const MIN_ZONE = 3; // m²
const MIN_SIDE = 1.2; // m
const MAX_GROUPS = 10;

/** sRGB → CIE Lab (D65). */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function detectColorZones(px: Pixels, floor: Floor): ColorGroup[] {
  const bg = floor.background;
  if (!bg) return [];
  const { data, w, h } = px;
  const m2 = (bg.w / w) * (bg.d / h); // m² por píxel

  // 1. Colores de relleno más abundantes (histograma de colores reducidos a 16 niveles)
  const count = new Map<number, { n: number; r: number; g: number; b: number }>();
  const isFill = (i: number) => {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < MIN_LUM) return false;
    if (lum <= MAX_LUM) return true;
    // Rellenos muy claros pero con color (azul o rosa pálido de un aseo): sí; el papel crema, no
    const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    return lum <= 247 && sat >= 22;
  };
  for (let i = 0; i < w * h * 4; i += 4) {
    if (!isFill(i)) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const c = count.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += data[i];
    c.g += data[i + 1];
    c.b += data[i + 2];
    count.set(key, c);
  }
  const centers: { r: number; g: number; b: number; n: number }[] = [];
  for (const c of [...count.values()].sort((a, b) => b.n - a.n)) {
    const col = { r: c.r / c.n, g: c.g / c.n, b: c.b / c.n };
    const cl = lab(col.r, col.g, col.b);
    const near = centers.find((k) => dE(lab(k.r, k.g, k.b), cl) < SAME);
    if (near) {
      const t = near.n + c.n;
      near.r = (near.r * near.n + col.r * c.n) / t;
      near.g = (near.g * near.n + col.g * c.n) / t;
      near.b = (near.b * near.n + col.b * c.n) / t;
      near.n = t;
    } else if (c.n * m2 >= MIN_ZONE / 4) centers.push({ ...col, n: c.n });
  }
  const top = centers.filter((k) => k.n * m2 >= MIN_ZONE / 2).sort((a, b) => b.n - a.n).slice(0, MAX_GROUPS);

  // 2. Cada píxel, al relleno más parecido (o a ninguno)
  const topLab = top.map((k) => lab(k.r, k.g, k.b));
  const label = new Int8Array(w * h).fill(-1);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (!isFill(i)) continue;
    let best = -1;
    let bestD = SAME;
    const pl = lab(data[i], data[i + 1], data[i + 2]);
    topLab.forEach((k, j) => {
      const d = dE(k, pl);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    label[p] = best;
  }

  // 3. Manchas (componentes conexas) de cada relleno, con su caja
  type Blob = { g: number; x0: number; y0: number; x1: number; y1: number; n: number };
  const blobs: Blob[] = [];
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || label[p] < 0) continue;
    const g = label[p];
    const b: Blob = { g, x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    let top_ = 0;
    stack[top_++] = p;
    seen[p] = 1;
    while (top_) {
      const q = stack[--top_];
      const x = q % w;
      const y = (q - x) / w;
      b.n++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
      for (const r of nb)
        if (r >= 0 && !seen[r] && label[r] === g) {
          seen[r] = 1;
          stack[top_++] = r;
        }
    }
    if (b.n * m2 >= 0.05) blobs.push(b);
  }

  // 4. Une los trozos de una misma sala que los muebles o los textos dejan sueltos: solo cajas que
  //    se solapan de verdad. Dos salas vecinas separadas por una pared quedan solo tocándose.
  const overlap = (a: Blob, c: Blob) => {
    const ox = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0);
    const oy = Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0);
    return ox > 2 && oy > 2;
  };
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < blobs.length && !merged; i++)
      for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i];
        const c = blobs[j];
        if (a.g !== c.g || !overlap(a, c)) continue;
        const x0 = Math.min(a.x0, c.x0);
        const y0 = Math.min(a.y0, c.y0);
        const x1 = Math.max(a.x1, c.x1);
        const y1 = Math.max(a.y1, c.y1);
        blobs[i] = { g: a.g, x0, y0, x1, y1, n: a.n + c.n };
        blobs.splice(j, 1);
        merged = true;
        break;
      }
  }

  // 5. A metros, descartando lo pequeño, lo poco lleno y lo que cae fuera del edificio
  const toM = pixelToMeters(bg, w, h);
  const r2 = (v: number) => +(Math.round(v / 0.05) * 0.05).toFixed(2);
  const groups: ColorGroup[] = top.map((k) => ({ color: hex(k.r, k.g, k.b), zones: [], area: 0 }));
  for (const b of blobs) {
    // Con muebles dentro el relleno queda a trozos: basta con que cubra un tercio de la caja
    const fill = b.n / ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1));
    if (fill < 0.33) continue;
    const pts = [toM(b.x0, b.y0), toM(b.x1 + 1, b.y0), toM(b.x0, b.y1 + 1), toM(b.x1 + 1, b.y1 + 1)];
    const x = r2(Math.min(...pts.map((p) => p.x)));
    const z = r2(Math.min(...pts.map((p) => p.z)));
    const zw = r2(Math.max(...pts.map((p) => p.x)) - x);
    const zd = r2(Math.max(...pts.map((p) => p.z)) - z);
    if (zw < MIN_SIDE || zd < MIN_SIDE || zw * zd < MIN_ZONE) continue;
    if (floor.outline.length >= 3 && !pointInPolygon({ x: x + zw / 2, z: z + zd / 2 }, floor.outline)) continue;
    groups[b.g].zones.push({ x, z, w: zw, d: zd });
    groups[b.g].area += zw * zd;
  }
  return groups.filter((g) => g.zones.length).map((g) => ({ ...g, area: Math.round(g.area) }));
}
