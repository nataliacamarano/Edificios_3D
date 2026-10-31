import { bbox, isGoodLift } from './geometry';
import type { Floor, Space } from './types';
import { bands, pixelToMeters, type Band, type Pixels } from './wallDetect';

/**
 * Ascensores y escaleras en la foto del plano, y conexión entre plantas.
 * - Ascensor: un recuadro de 1–3 m con una X (las dos diagonales dibujadas).
 * - Escalera: una fila de peldaños: al menos 5 trazos paralelos del mismo largo, a paso regular.
 * - Conectar plantas: los ascensores y escaleras que caen en el mismo sitio del edificio en
 *   distintas plantas reciben el mismo código de conexión.
 */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/**
 * Trazo: píxel bastante más oscuro que su entorno (así los recuadros con relleno gris no cuentan
 * como trazo entero) o muy oscuro sin más.
 */
function inkMask({ data, w, h }: Pixels) {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const R = 4;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R);
      const y0 = Math.max(0, y - R);
      const x1 = Math.min(w, x + R + 1);
      const y1 = Math.min(h, y + R + 1);
      const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = lum[y * w + x];
      m[y * w + x] = v < 90 || (v < 200 && v < mean - 30) ? 1 : 0;
    }
  return m;
}

/** Trazo engordado un píxel: tolera líneas finas que no caen justo en la fila o columna mirada. */
function dilate(mask: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++)
        for (let dx = -1; dx <= 1 && !v; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) v = 1;
        }
      out[y * w + x] = v;
    }
  return out;
}

/** Fracción de puntos con trazo a lo largo de un segmento (mirando también los píxeles vecinos). */
function inkAlong(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const N = 40;
  let hit = 0;
  for (let i = 4; i < N - 4; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / N);
    const y = Math.round(y0 + ((y1 - y0) * i) / N);
    let found = false;
    for (let dy = -1; dy <= 1 && !found; dy++)
      for (let dx = -1; dx <= 1 && !found; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) found = true;
      }
    if (found) hit++;
  }
  return hit / (N - 8);
}

type PxBox = { x0: number; y0: number; x1: number; y1: number; score: number };

const iou = (a: PxBox, b: PxBox) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy;
  return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i);
};

/** Parte de la caja más pequeña que queda dentro de la otra. */
const cover = (a: PxBox, b: PxBox) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return (ix * iy) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

/** Quita cajas repetidas: de las que se solapan, se queda la de mejor puntuación. */
function dedupe(boxes: PxBox[]) {
  const out: PxBox[] = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) if (!out.some((o) => cover(o, b) > 0.4)) out.push(b);
  return out;
}

/**
 * Recuadros con X: se prueban todas las posiciones y tamaños (de 1 a 3 m). Los cuatro lados deben
 * tener trazo, las dos diagonales también, y el resto del interior estar casi vacío (así no cuentan
 * las zonas rayadas ni los escritorios).
 */
function findLifts(mask: Uint8Array, w: number, h: number, m: number): PxBox[] {
  const fat = dilate(mask, w, h);
  // Sumas acumuladas por filas y por columnas del trazo engordado: cuánto trazo tiene un lado en O(1)
  const rowP = new Int32Array(h * (w + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowP[y * (w + 1) + x + 1] = rowP[y * (w + 1) + x] + fat[y * w + x];
  const colP = new Int32Array(w * (h + 1));
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) colP[x * (h + 1) + y + 1] = colP[x * (h + 1) + y] + fat[y * w + x];
  const row = (y: number, x0: number, x1: number) => (rowP[y * (w + 1) + x1] - rowP[y * (w + 1) + x0]) / (x1 - x0);
  const col = (x: number, y0: number, y1: number) => (colP[x * (h + 1) + y1] - colP[x * (h + 1) + y0]) / (y1 - y0);

  const step = Math.max(1, Math.round(0.08 / m));
  const sizes: number[] = [];
  for (let s = Math.round(1.0 / m); s <= Math.round(3.0 / m); s += step) sizes.push(s);
  const EDGE = 0.8;
  const INTERIOR = [
    [0.5, 0.2],
    [0.5, 0.8],
    [0.2, 0.5],
    [0.8, 0.5],
    [0.35, 0.15],
    [0.65, 0.15],
    [0.35, 0.85],
    [0.65, 0.85],
    [0.15, 0.35],
    [0.15, 0.65],
    [0.85, 0.35],
    [0.85, 0.65],
  ];
  const out: PxBox[] = [];
  const s0 = sizes[0];
  for (let y = 0; y < h - s0; y++)
    for (let x = 0; x < w - s0; x++) {
      if (!fat[y * w + x]) continue;
      // Esquina superior izquierda: trazo hacia la derecha y hacia abajo al menos el tamaño mínimo,
      // y el arranque de la diagonal de la X (descarta casi todas las esquinas de paredes)
      const k1 = Math.round(s0 * 0.2);
      const k2 = Math.round(s0 * 0.35);
      if (!fat[(y + k1) * w + x + k1] || !fat[(y + k2) * w + x + k2]) continue;
      // …y a cada lado de esa diagonal, blanco (no es una zona sombreada o rayada)
      const e1 = Math.round(s0 * 0.6);
      const e2 = Math.round(s0 * 0.2);
      if (fat[(y + e2) * w + x + e1] && fat[(y + e1) * w + x + e2]) continue;
      if (row(y, x, x + s0) < EDGE || col(x, y, y + s0) < EDGE) continue;
      for (const bw of sizes) {
        if (x + bw >= w || row(y, x, x + bw) < EDGE) continue;
        // Esquina superior derecha: también baja una pared
        if (col(x + bw, y, Math.min(h - 1, y + s0)) < EDGE) continue;
        for (const bh of sizes) {
          if (bh < 0.6 * bw || bh > 1.6 * bw || y + bh >= h) continue;
          // Esquina inferior izquierda: arranca la pared de abajo
          if (!fat[(y + bh) * w + x] || row(y + bh, x, x + s0) < EDGE) continue;
          // Cruce de la X en el centro
          if (!fat[Math.round(y + bh / 2) * w + Math.round(x + bw / 2)]) continue;
          if (row(y + bh, x, x + bw) < EDGE || col(x, y, y + bh) < EDGE || col(x + bw, y, y + bh) < EDGE) continue;
          // Interior fuera de las diagonales casi sin trazo (con el trazo engordado: un rayado de
          // peldaños o una zona sombreada lo llena). Va antes de las diagonales porque es barato.
          let ink = 0;
          for (const [u, v] of INTERIOR) ink += fat[Math.round(y + v * bh) * w + Math.round(x + u * bw)];
          if (ink / INTERIOR.length > 0.17) continue;
          const d1 = inkAlong(fat, w, h, x, y, x + bw, y + bh);
          if (d1 < 0.85) continue;
          const d2 = inkAlong(fat, w, h, x + bw, y, x, y + bh);
          if (d2 < 0.85) continue;
          const n = INTERIOR.length;
          out.push({ x0: x, y0: y, x1: x + bw, y1: y + bh, score: d1 + d2 - ink / n });
        }
      }
    }
  return dedupe(out);
}

/**
 * Tramos de peldaños: trazos paralelos de 0,5–2,6 m, uno detrás de otro a 15–60 cm y solapados.
 * En las fotos los peldaños salen partidos y a paso irregular, así que primero se unen los trozos
 * de cada fila y luego se agrupan los que se solapan; hacen falta al menos 5 con paso de escalera.
 */
function findStairs(lines: Band[], m: number, vertical: boolean): PxBox[] {
  // 1. Trozos de la misma fila, casi seguidos → un peldaño
  const rows = [...lines].sort((a, b) => a.at - b.at || a.s0 - b.s0);
  const joined: Band[] = [];
  for (const b of rows) {
    // Solo se mira hacia atrás entre los de la misma fila (están al final, por el orden)
    let prev: Band | undefined;
    for (let k = joined.length - 1; k >= 0 && b.at - joined[k].at <= 1; k--) {
      const j = joined[k];
      if (Math.abs(j.at - b.at) <= 1 && b.s0 - j.s1 <= 0.4 / m && b.s1 >= j.s0) {
        prev = j;
        break;
      }
    }
    if (prev) {
      prev.s0 = Math.min(prev.s0, b.s0);
      prev.s1 = Math.max(prev.s1, b.s1);
    } else joined.push({ ...b });
  }
  const treads = joined.filter((t) => (t.s1 - t.s0) * m >= 0.75 && (t.s1 - t.s0) * m <= 2.6).sort((a, b) => a.at - b.at);

  // 2. Grupos de peldaños que se solapan y están a distancia de peldaño
  const near = (a: Band, b: Band) => {
    const gap = Math.abs(a.at - b.at) * m;
    if (gap < 0.12 || gap > 0.6) return false;
    const ov = Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0);
    return ov >= 0.7 * Math.min(a.s1 - a.s0, b.s1 - b.s0);
  };
  const group = treads.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  // Ordenados por posición: solo se comparan con los que están a menos de 60 cm
  for (let i = 0; i < treads.length; i++)
    for (let j = i + 1; j < treads.length && (treads[j].at - treads[i].at) * m <= 0.6; j++)
      if (near(treads[i], treads[j])) group[find(i)] = find(j);
  const byGroup = new Map<number, Band[]>();
  treads.forEach((t, i) => byGroup.set(find(i), [...(byGroup.get(find(i)) ?? []), t]));

  // 3. Solo los grupos con pinta de escalera: 5 peldaños o más, paso medio de 18–45 cm
  const out: PxBox[] = [];
  for (const g of byGroup.values()) {
    if (g.length < 5) continue;
    const ats = [...new Set(g.map((t) => t.at))].sort((a, b) => a - b);
    const gaps = ats.slice(1).map((a, i) => (a - ats[i]) * m).filter((d) => d >= 0.12);
    if (gaps.length < 4) continue;
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (median < 0.18 || median > 0.45) continue;
    const s0 = Math.min(...g.map((t) => t.s0));
    const s1 = Math.max(...g.map((t) => t.s1));
    const half = median / m / 2;
    const a0 = ats[0] - half;
    const a1 = ats[ats.length - 1] + half;
    // Un tramo de escalera mide al menos 1,2 m: menos suele ser texto
    if ((a1 - a0) * m < 1.2) continue;
    out.push(vertical ? { x0: a0, x1: a1, y0: s0, y1: s1, score: g.length } : { x0: s0, x1: s1, y0: a0, y1: a1, score: g.length });
  }
  return out;
}

export function detectLiftsAndStairs(px: Pixels, floor: Floor): { lifts: Rect[]; stairs: Rect[] } {
  const bg = floor.background;
  if (!bg) return { lifts: [], stairs: [] };
  const { w, h } = px;
  const m = (bg.w / w + bg.d / h) / 2;
  const mask = inkMask(px);
  // Peldaños: trazos finos de medio metro o más (los trozos de un peldaño se unen después)
  const lineLen = 0.5 / m;
  const thin = Math.max(2, 0.12 / m);
  const H = bands((y, x) => mask[y * w + x], h, w, lineLen, thin);
  const V = bands((x, y) => mask[y * w + x], w, h, lineLen, thin);
  const liftBoxes = findLifts(mask, w, h, m);
  // Las X de los ascensores no son peldaños
  const stairBoxes = dedupe([...findStairs(H, m, false), ...findStairs(V, m, true)]).filter(
    (s) => !liftBoxes.some((l) => iou(l, s) > 0.1),
  );

  const toM = pixelToMeters(bg, w, h);
  const r2 = (v: number) => +(Math.round(v / 0.05) * 0.05).toFixed(2);
  const toRect = (b: PxBox): Rect => {
    const pts = [toM(b.x0, b.y0), toM(b.x1, b.y0), toM(b.x0, b.y1), toM(b.x1, b.y1)];
    const x = r2(Math.min(...pts.map((p) => p.x)));
    const z = r2(Math.min(...pts.map((p) => p.z)));
    return { x, z, w: r2(Math.max(...pts.map((p) => p.x)) - x), d: r2(Math.max(...pts.map((p) => p.z)) - z) };
  };
  // Lo que ya está dibujado como ascensor o escalera no se repite
  const drawn = floor.spaces.filter((s) => s.kind === 'lift' || s.kind === 'stairs');
  const covered = (r: Rect) =>
    drawn.some((s) => {
      const ix = Math.max(0, Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x));
      const iz = Math.max(0, Math.min(r.z + r.d, s.z + s.d) - Math.max(r.z, s.z));
      return ix * iz > 0.5 * Math.min(r.w * r.d, s.w * s.d);
    });
  return {
    lifts: liftBoxes.map(toRect).filter((r) => !covered(r)),
    stairs: stairBoxes.map(toRect).filter((r) => !covered(r)),
  };
}

/** «lado norte» o «lado sur» según dónde cae la estancia en la planta y hacia dónde está el norte. */
export function sideTag(s: Space, floor: Floor, fallbackDir?: Floor['northDir']): 'lado norte' | 'lado sur' {
  const bb = bbox(floor.outline);
  const cx = s.x + s.w / 2;
  const cz = s.z + s.d / 2;
  const dir = floor.northDir ?? fallbackDir ?? '-z';
  const north =
    dir === '-z' ? cz < (bb.minZ + bb.maxZ) / 2 : dir === '+z' ? cz > (bb.minZ + bb.maxZ) / 2 : dir === '+x' ? cx > (bb.minX + bb.maxX) / 2 : cx < (bb.minX + bb.maxX) / 2;
  return north ? 'lado norte' : 'lado sur';
}

/** Marca o desmarca un ascensor como good lift (montacargas), con su lado. */
export function withGoodLift(s: Space, floor: Floor, on: boolean, fallbackDir?: Floor['northDir']): Space {
  const rest = s.tags.filter((t) => t !== 'montacargas' && t !== 'lado norte' && t !== 'lado sur');
  return { ...s, tags: on ? [...rest, 'montacargas', sideTag(s, floor, fallbackDir)] : rest };
}

/** Norte más habitual entre las plantas que lo tienen: para las que no lo indican. */
export function commonNorth(floors: Floor[]): Floor['northDir'] {
  const n = new Map<string, number>();
  for (const f of floors) if (f.northDir) n.set(f.northDir, (n.get(f.northDir) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Floor['northDir'];
}

export interface ConnectResult {
  floors: Floor[];
  /** Grupos de ascensores o escaleras conectados entre plantas (nuevos o ampliados). */
  groups: number;
  /** Estancias que han recibido código de conexión. */
  linked: number;
}

/**
 * Une entre plantas los ascensores y escaleras que están en el mismo sitio del edificio. Cada planta
 * viene de su propia foto, con su propio origen, así que primero se busca el desplazamiento que
 * hace coincidir más ascensores y escaleras con los de la planta que más tiene; luego se agrupan
 * los que quedan a menos de `tol` metros. Los good lifts pasan su marca a los de las otras plantas.
 */
export function connectFloors(floors: Floor[], tol = 1.2): ConnectResult {
  type Item = { f: number; s: Space; u: number; v: number };
  const per = floors.map((fl) => fl.spaces.filter((s) => s.kind === 'lift' || s.kind === 'stairs'));
  const center = (s: Space) => ({ x: s.x + s.w / 2, z: s.z + s.d / 2 });
  const ref = per.reduce((best, list, i) => (list.length > per[best].length ? i : best), 0);

  type Fit = { sx: number; tx: number; sz: number; tz: number };
  const apply = (t: Fit, s: Space) => ({ x: t.sx * center(s).x + t.tx, z: t.sz * center(s).z + t.tz });

  /**
   * Cómo pasar la planta `f` a la de referencia: escala y desplazamiento en cada eje (cada foto se
   * calibra por separado, así que la escala puede variar un poco). Se prueban las parejas de
   * ascensores/escaleras y gana la que hace coincidir más.
   */
  const fitOf = (f: number): Fit => {
    if (f === ref) return { sx: 1, tx: 0, sz: 1, tz: 0 };
    const score = (t: Fit) => {
      let votes = 0;
      let err = 0;
      for (const q of per[f]) {
        const c = apply(t, q);
        const d = Math.min(...per[ref].filter((r) => r.kind === q.kind).map((r) => Math.hypot(center(r).x - c.x, center(r).z - c.z)));
        if (d < tol) {
          votes++;
          err += d;
        }
      }
      return { votes, err };
    };
    const ok = (s: number) => s > 0.7 && s < 1.4;
    let best: Fit & { votes: number; err: number } = { sx: 1, tx: 0, sz: 1, tz: 0, votes: -1, err: Infinity };
    const consider = (t: Fit) => {
      const r = score(t);
      if (r.votes > best.votes || (r.votes === best.votes && r.err < best.err)) best = { ...t, ...r };
    };
    const pairs: [Space, Space][] = [];
    for (const a of per[ref]) for (const b of per[f]) if (a.kind === b.kind) pairs.push([a, b]);
    for (const [a1, b1] of pairs) {
      // Solo desplazamiento
      consider({ sx: 1, tx: center(a1).x - center(b1).x, sz: 1, tz: center(a1).z - center(b1).z });
      for (const [a2, b2] of pairs) {
        if (a2 === a1 || b2 === b1) continue;
        const dbx = center(b1).x - center(b2).x;
        const dbz = center(b1).z - center(b2).z;
        let sx = Math.abs(dbx) > 3 ? (center(a1).x - center(a2).x) / dbx : NaN;
        let sz = Math.abs(dbz) > 3 ? (center(a1).z - center(a2).z) / dbz : NaN;
        if (Number.isNaN(sx)) sx = sz;
        if (Number.isNaN(sz)) sz = sx;
        if (!ok(sx) || !ok(sz)) continue;
        consider({ sx, tx: center(a1).x - sx * center(b1).x, sz, tz: center(a1).z - sz * center(b1).z });
      }
    }
    // Sin coincidencias claras: se encajan los contornos
    if (best.votes < 2) {
      const a = bbox(floors[ref].outline);
      const b = bbox(floors[f].outline);
      const sx = (a.maxX - a.minX) / (b.maxX - b.minX || 1);
      const sz = (a.maxZ - a.minZ) / (b.maxZ - b.minZ || 1);
      return { sx, tx: a.minX - sx * b.minX, sz, tz: a.minZ - sz * b.minZ };
    }
    return best;
  };

  const items: Item[] = [];
  per.forEach((list, f) => {
    const t = fitOf(f);
    for (const s of list) {
      const c = apply(t, s);
      items.push({ f, s, u: c.x, v: c.z });
    }
  });
  // Grupos: misma clase de estancia, una por planta, a menos de `tol` metros
  const groups: Item[][] = [];
  for (const it of items) {
    const g = groups.find(
      (g) =>
        g[0].s.kind === it.s.kind &&
        !g.some((o) => o.f === it.f) &&
        g.some((o) => Math.hypot(o.u - it.u, o.v - it.v) < tol),
    );
    if (g) g.push(it);
    else groups.push([it]);
  }
  const patch = new Map<Space, Partial<Space>>();
  let n = 0;
  let linked = 0;
  const taken = new Set(items.map((i) => i.s.connectorId).filter(Boolean));
  for (const g of groups) {
    if (g.length < 2) continue;
    const ids = g.map((i) => i.s.connectorId).filter(Boolean) as string[];
    let id = ids[0];
    if (!id) {
      let k = 1;
      const base = g[0].s.kind === 'lift' ? 'ascensor' : 'escalera';
      while (taken.has(`${base}-${k}`)) k++;
      id = `${base}-${k}`;
      taken.add(id);
    }
    const good = g.some((i) => isGoodLift(i.s));
    let changed = false;
    for (const i of g) {
      const p: Partial<Space> = {};
      if (!i.s.connectorId) {
        p.connectorId = id;
        linked++;
        changed = true;
      }
      if (good && !isGoodLift(i.s)) {
        p.tags = withGoodLift(i.s, floors[i.f], true, commonNorth(floors)).tags;
        changed = true;
      }
      if (Object.keys(p).length) patch.set(i.s, p);
    }
    if (changed) n++;
  }
  return {
    floors: floors.map((fl) => ({ ...fl, spaces: fl.spaces.map((s) => (patch.has(s) ? { ...s, ...patch.get(s) } : s)) })),
    groups: n,
    linked,
  };
}
