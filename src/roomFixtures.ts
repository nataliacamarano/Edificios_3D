import { frame, meetingParts, type Prim } from './furnitureLayout';
import type { Side, Space } from './types';

type F = ReturnType<typeof frame>;

/**
 * Contenido dibujado de las estancias para que se lean como en el plano: sanitarios y cabinas
 * en los aseos, duchas y taquillas en los vestuarios, peldaños en las escaleras y el aspa de
 * cada cabina de ascensor. Es solo dibujo: no cambia las rutas.
 */

/** Dónde está la puerta en los ejes locales: lado largo (v = 0 o v = S) y posición a lo largo. */
function doorAt(s: Space, f: F): { vSide: 0 | 1 | null; u: number } {
  const d = s.doors[0];
  if (!d) return { vSide: null, u: 0 };
  const long = f.horiz ? d.side === 'n' || d.side === 's' : d.side === 'w' || d.side === 'e';
  if (long) return { vSide: d.side === 'n' || d.side === 'w' ? 0 : 1, u: d.offset * f.L };
  return { vSide: null, u: d.side === 'w' || d.side === 'n' ? 0 : f.L };
}

const inner = (s: Space, inset: number) => ({ x: s.x + inset, z: s.z + inset, w: s.w - 2 * inset, d: s.d - 2 * inset });

/** Inodoro visto desde arriba: cisterna contra la pared `back` y taza delante. */
function toilet(f: F, cu: number, back: 0 | 1, out: Prim[]) {
  const wall = back === 1 ? f.S : 0;
  const dir = back === 1 ? -1 : 1;
  out.push(f.box(cu - 0.2, cu + 0.2, Math.min(wall, wall + dir * 0.18), Math.max(wall, wall + dir * 0.18), 0, 0.8, 'porcelain', 1));
  const c = f.at(cu, wall + dir * 0.45);
  const [w, d] = f.horiz ? [0.38, 0.52] : [0.52, 0.38];
  out.push({ shape: 'cyl', x: c.x, z: c.z, w, d, y: 0, h: 0.42, mat: 'porcelain', layer: 2 });
}

/** Encimera con lavabos contra la pared `side`, entre u0 y u1. */
function sinks(f: F, u0: number, u1: number, side: 0 | 1, out: Prim[]) {
  if (u1 - u0 < 0.5) return;
  const v0 = side === 1 ? f.S - 0.5 : 0;
  out.push(f.box(u0, u1, v0, v0 + 0.5, 0.82, 0.06, 'counter', 1));
  out.push(f.box(u0 + 0.05, u1 - 0.05, v0 + 0.05, v0 + 0.45, 0, 0.82, 'partition', null));
  const n = Math.max(1, Math.floor((u1 - u0) / 0.7));
  for (let i = 0; i < n; i++) {
    const c = f.at(u0 + ((i + 0.5) * (u1 - u0)) / n, v0 + 0.25);
    out.push({ shape: 'cyl', x: c.x, z: c.z, w: 0.38, d: 0.38, y: 0.88, h: 0.02, mat: 'porcelain', layer: 2 });
  }
}

/** Fila de cabinas (inodoros o duchas) contra la pared `back`, con mamparas y frente con puerta. */
function cubicles(f: F, u0: number, u1: number, back: 0 | 1, depth: number, shower: boolean, out: Prim[]) {
  const n = Math.max(1, Math.floor((u1 - u0) / 0.95));
  const cw = (u1 - u0) / n;
  const wall = back === 1 ? f.S : 0;
  const front = back === 1 ? f.S - depth : depth;
  const [va, vb] = back === 1 ? [front, wall] : [wall, front];
  for (let i = 0; i <= n; i++) {
    const u = u0 + i * cw;
    out.push(f.box(u - 0.025, u + 0.025, va, vb, 0, 2.0, 'partition', 1));
  }
  for (let i = 0; i < n; i++) {
    const a = u0 + i * cw;
    const b = a + cw;
    const cu = (a + b) / 2;
    // Frente con el hueco de la puerta
    out.push(f.box(a, cu - 0.3, front - 0.025, front + 0.025, 0, 2.0, 'partition', 1));
    out.push(f.box(cu + 0.3, b, front - 0.025, front + 0.025, 0, 2.0, 'partition', 1));
    if (shower) {
      const m = Math.min(cw, depth) - 0.15;
      const c = (va + vb) / 2;
      out.push(f.box(cu - m / 2, cu + m / 2, c - m / 2, c + m / 2, 0, 0.05, 'tray', 1));
      const p = f.at(cu, c);
      out.push({ shape: 'cyl', x: p.x, z: p.z, w: 0.1, d: 0.1, y: 0.05, h: 0.01, mat: 'metal', layer: 2 });
    } else toilet(f, cu, back, out);
  }
}

/** Banco de vestuario a lo largo, en el centro de la franja libre [v0, v1]. */
function bench(f: F, u0: number, u1: number, v0: number, v1: number, out: Prim[]) {
  if (u1 - u0 < 0.8 || v1 - v0 < 1.0) return;
  const c = (v0 + v1) / 2;
  out.push(f.box(u0, u1, c - 0.2, c + 0.2, 0, 0.45, 'wood', 1));
}

/** Taquillas contra la pared `side` (fondo 0,5 m), con su aspa en 2D. */
function lockers(f: F, u0: number, u1: number, side: 0 | 1, out: Prim[]) {
  if (u1 - u0 < 0.6) return;
  const n = Math.max(1, Math.round((u1 - u0) / 0.9));
  const w = (u1 - u0) / n;
  const v0 = side === 1 ? f.S - 0.5 : 0;
  for (let i = 0; i < n; i++)
    out.push(f.box(u0 + i * w + 0.02, u0 + (i + 1) * w - 0.02, v0, v0 + 0.5, 0, 1.9, 'storage', 1, { cross: true }));
}

type R = { x: number; z: number; w: number; d: number };
const OPP: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

const rectBox = (r: R, y: number, h: number, mat: Prim['mat'], layer: Prim['layer'], extra: Partial<Prim> = {}): Prim => ({
  shape: 'box',
  x: r.x + r.w / 2,
  z: r.z + r.d / 2,
  w: r.w,
  d: r.d,
  y,
  h,
  mat,
  layer,
  ...extra,
});

/** Franja de grosor `t` pegada al lado `side` del rectángulo, entre las fracciones a y b de ese lado. */
function band(r: R, side: Side, t: number, a = 0, b = 1): R {
  const horiz = side === 'n' || side === 's';
  const len = horiz ? r.w : r.d;
  const p0 = a * len;
  const p1 = b * len;
  if (horiz) return { x: r.x + p0, z: side === 'n' ? r.z : r.z + r.d - t, w: p1 - p0, d: t };
  return { x: side === 'w' ? r.x : r.x + r.w - t, z: r.z + p0, w: t, d: p1 - p0 };
}

/** Pared del aseo más cercana a la pieza. */
function nearestWall(s: Space, r: R): Side {
  const d: [Side, number][] = [
    ['n', r.z - s.z],
    ['s', s.z + s.d - (r.z + r.d)],
    ['w', r.x - s.x],
    ['e', s.x + s.w - (r.x + r.w)],
  ];
  return d.sort((a, b) => a[1] - b[1])[0][0];
}

/** Mamparas de una cabina, con el hueco de la puerta centrado en `door`. */
function cubicleWalls(r: R, door: Side | undefined, out: Prim[]) {
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    if (side !== door) {
      out.push(rectBox(band(r, side, 0.05), 0, 2.0, 'partition', 1));
      continue;
    }
    const len = side === 'n' || side === 's' ? r.w : r.d;
    const gap = Math.min(0.6, len * 0.6) / len;
    out.push(rectBox(band(r, side, 0.05, 0, 0.5 - gap / 2), 0, 2.0, 'partition', 1));
    out.push(rectBox(band(r, side, 0.05, 0.5 + gap / 2, 1), 0, 2.0, 'partition', 1));
  }
}

/** Inodoro contra la pared `back` del rectángulo: cisterna y taza. */
function toiletIn(r: R, back: Side, out: Prim[]) {
  const horiz = back === 'n' || back === 's';
  const len = horiz ? r.w : r.d;
  const depth = horiz ? r.d : r.w;
  const a = Math.max(0, 0.5 - 0.2 / len);
  const b = Math.min(1, 0.5 + 0.2 / len);
  out.push(rectBox(band(r, back, Math.min(0.18, depth * 0.3), a, b), 0, 0.8, 'porcelain', 1));
  const off = Math.min(0.45, depth * 0.5);
  const cx = r.x + r.w / 2;
  const cz = r.z + r.d / 2;
  const c =
    back === 'n' ? { x: cx, z: r.z + off } : back === 's' ? { x: cx, z: r.z + r.d - off } : back === 'w' ? { x: r.x + off, z: cz } : { x: r.x + r.w - off, z: cz };
  const [w, d] = horiz ? [0.38, 0.52] : [0.52, 0.38];
  out.push({ shape: 'cyl', x: c.x, z: c.z, w, d, y: 0, h: 0.42, mat: 'porcelain', layer: 2 });
}

/** Piezas seguidas a lo largo de la pared `back` (lavabos de una encimera, urinarios…). */
function along(r: R, back: Side, n: number, fn: (cell: R) => void) {
  const horiz = back === 'n' || back === 's';
  for (let i = 0; i < n; i++)
    fn(horiz ? { x: r.x + (i * r.w) / n, z: r.z, w: r.w / n, d: r.d } : { x: r.x, z: r.z + (i * r.d) / n, w: r.w, d: r.d / n });
}

/** Sanitarios calcados del plano, cada uno en su sitio. */
function tracedFixtures(s: Space): Prim[] {
  const out: Prim[] = [];
  for (const f of s.fixtures ?? []) {
    const r: R = { x: f.x, z: f.z, w: f.w, d: f.d };
    const back = f.back ?? (f.door ? OPP[f.door] : nearestWall(s, r));
    switch (f.kind) {
      case 'wc':
        if (f.door) cubicleWalls(r, f.door, out);
        toiletIn(r, back, out);
        break;
      case 'shower': {
        if (f.door) cubicleWalls(r, f.door, out);
        const m = Math.min(r.w, r.d) * 0.08;
        out.push(rectBox({ x: r.x + m, z: r.z + m, w: r.w - 2 * m, d: r.d - 2 * m }, 0, 0.05, 'tray', 1));
        out.push({ shape: 'cyl', x: r.x + r.w / 2, z: r.z + r.d / 2, w: 0.1, d: 0.1, y: 0.05, h: 0.01, mat: 'metal', layer: 2 });
        break;
      }
      case 'dressing': {
        // Vestidor junto a la ducha: cabina con su puerta y un banquito contra la pared
        if (f.door) cubicleWalls(r, f.door, out);
        const horiz = back === 'n' || back === 's';
        const a = horiz ? 0.15 : 0.15;
        out.push(rectBox(band(r, back, Math.min(0.35, (horiz ? r.d : r.w) * 0.4), a, 1 - a), 0, 0.45, 'wood', 1));
        break;
      }
      case 'urinal':
        along(r, back, f.count ?? 1, (c) => {
          const horiz = back === 'n' || back === 's';
          const a = horiz ? Math.max(0, 0.5 - 0.18 / c.w) : Math.max(0, 0.5 - 0.18 / c.d);
          out.push(rectBox(band(c, back, Math.min(0.32, horiz ? c.d : c.w), a, 1 - a), 0.35, 0.6, 'porcelain', 2));
        });
        break;
      case 'sink': {
        out.push(rectBox(r, 0.82, 0.06, 'counter', 1));
        out.push(rectBox(r, 0, 0.82, 'partition', null));
        along(r, back, f.count ?? 1, (c) => {
          const dia = Math.min(0.42, c.w * 0.8, c.d * 0.8);
          out.push({ shape: 'cyl', x: c.x + c.w / 2, z: c.z + c.d / 2, w: dia, d: dia, y: 0.88, h: 0.02, mat: 'porcelain', layer: 2 });
        });
        break;
      }
      case 'bench':
        out.push(rectBox(r, 0, 0.45, 'wood', 1));
        break;
      case 'locker': {
        const n = f.count ?? Math.max(1, Math.round(Math.max(r.w, r.d) / 0.9));
        along(r, back, n, (c) => out.push(rectBox({ x: c.x + 0.01, z: c.z + 0.01, w: c.w - 0.02, d: c.d - 0.02 }, 0, 1.9, 'storage', 1, { cross: true })));
        break;
      }
    }
  }
  return out;
}

/** Aseos, duchas y vestuarios: sus sanitarios calcados o, si no los hay, unos según su tamaño. */
function restroomParts(s: Space): Prim[] {
  if (s.fixtures?.length) return tracedFixtures(s);
  const out: Prim[] = [];
  const r = inner(s, 0.1);
  if (r.w < 0.8 || r.d < 0.8) return out;
  const f = frame(r);
  const { L, S } = f;
  const door = doorAt(s, f);
  // Las cabinas van contra la pared larga sin puerta; lo demás, en el extremo lejos de la puerta
  const back: 0 | 1 = door.vSide === 1 ? 0 : 1;
  const front: 0 | 1 = back === 1 ? 0 : 1;
  const farEnd = door.u < L / 2;
  const shower = s.tags.includes('ducha');
  const lockerRoom = /taquillas/i.test(s.name) || s.tags.includes('vestuario');
  const accessible = s.tags.includes('adaptado') || s.tags.includes('inclusivo');

  if (lockerRoom) {
    lockers(f, 0.2, L - 0.2, back, out);
    if (S >= 2.6) lockers(f, farEnd ? L * 0.35 : 0.2, farEnd ? L - 0.2 : L * 0.65, front, out);
    bench(f, 0.6, L - 0.6, back === 1 ? (S >= 2.6 ? 0.5 : 0) : 0.5, back === 1 ? S - 0.5 : S >= 2.6 ? S - 0.5 : S, out);
    return out;
  }

  if (accessible || (L < 2.8 && S < 2.4)) {
    // Aseo individual: inodoro en un rincón, lavabo y círculo de giro si es adaptado
    toilet(f, farEnd ? L - 0.45 : 0.45, back, out);
    sinks(f, farEnd ? Math.max(0.1, L - 1.7) : 0.95, farEnd ? L - 1.0 : Math.min(L - 0.1, 1.7), back, out);
    if (accessible) {
      const diam = Math.min(1.5, S - 0.3, L - 0.3);
      const c = f.at(L / 2, S / 2);
      if (diam > 0.8) out.push({ shape: 'cyl', x: c.x, z: c.z, w: diam, d: diam, y: 0, h: 0.005, mat: 'tray', layer: 0 });
    }
    return out;
  }

  const depth = Math.min(shower ? 1.1 : 1.5, S * 0.5);
  cubicles(f, 0.1, L - 0.1, back, depth, shower, out);
  const free0 = back === 1 ? 0 : depth;
  const free1 = back === 1 ? S - depth : S;
  if (shower) {
    // Vestuario con duchas: banco en el centro y lavabos al fondo
    bench(f, 0.8, L - 0.8, free0 + 0.5, free1, out);
    sinks(f, farEnd ? L * 0.55 : 0.1, farEnd ? L - 0.1 : L * 0.45, front, out);
  } else {
    const len = Math.min(L * 0.5, 3.2);
    sinks(f, farEnd ? L - 0.1 - len : 0.1, farEnd ? L - 0.1 : 0.1 + len, front, out);
  }
  return out;
}

/**
 * Escalera central de diseño de la planta 9, en Y: tramo inclinado desde el sur hasta una meseta
 * redonda y, desde ella, dos brazos en V hacia el norte. Puntos en píxeles de la foto, relativos
 * al rectángulo [515, 494, 618, 671] y escalados al tamaño real de la estancia.
 */
const Y_BOX = [515, 494, 618, 671];
const Y_FLIGHTS: { a: [number, number]; b: [number, number]; width: number; h0: number; h1: number }[] = [
  // Tramo de abajo: desde el pasillo sur (y 669) hasta la meseta, sube
  { a: [545, 669], b: [576, 582], width: 26, h0: 0, h1: 1.6 },
  // Brazos en V: desde la meseta hasta el lado norte, siguen subiendo
  { a: [552, 558], b: [529.5, 497], width: 23, h0: 1.6, h1: 2.9 },
  { a: [582, 564], b: [604.5, 497], width: 21, h0: 1.6, h1: 2.9 },
];
const Y_LANDING = { c: [569, 565] as [number, number], r: 23 };

function yStairParts(s: Space): Prim[] {
  const out: Prim[] = [];
  const kx = s.w / (Y_BOX[2] - Y_BOX[0]);
  const kz = s.d / (Y_BOX[3] - Y_BOX[1]);
  const at = ([x, y]: [number, number]) => ({ x: s.x + (x - Y_BOX[0]) * kx, z: s.z + (y - Y_BOX[1]) * kz });
  const k = (kx + kz) / 2;
  for (const f of Y_FLIGHTS) {
    const a = at(f.a);
    const b = at(f.b);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const n = Math.max(4, Math.round(len / 0.3));
    const rot = -Math.atan2(dz, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const h = f.h0 + ((i + 1) / n) * (f.h1 - f.h0);
      out.push({ shape: 'box', x: a.x + dx * t, z: a.z + dz * t, w: len / n - 0.02, d: f.width * k, y: 0, h, mat: 'step', layer: 1, rot });
    }
    // Barandillas de cristal a ambos lados
    const nx = -dz / len;
    const nz = dx / len;
    for (const side of [-1, 1]) {
      const off = ((f.width * k) / 2) * side;
      out.push({ shape: 'box', x: (a.x + b.x) / 2 + nx * off, z: (a.z + b.z) / 2 + nz * off, w: len, d: 0.04, y: Math.max(f.h0, 0.2), h: 1.0, mat: 'tray', layer: 2, rot });
    }
  }
  const c = at(Y_LANDING.c);
  const d = Y_LANDING.r * 2 * k;
  out.push({ shape: 'cyl', x: c.x, z: c.z, w: d, d, y: 0, h: 1.6, mat: 'step', layer: 1 });
  return out;
}

/** Escalera: peldaños de uno o dos tramos con meseta al fondo, lejos de la puerta. */
function stairParts(s: Space): Prim[] {
  if (s.design === 'y-stair') return yStairParts(s);
  const out: Prim[] = [];
  const r = inner(s, 0.1);
  if (r.w < 0.8 || r.d < 0.8) return out;
  const f = frame(r);
  const { L, S } = f;
  const door = doorAt(s, f);
  const landingAtEnd = door.u < L / 2;
  const landing = Math.min(1.3, L * 0.25);
  const tread = 0.28;
  const rise = 0.17;
  const n = Math.max(3, Math.floor((L - landing - (L >= 4 ? Math.min(1.35, L * 0.3) : 0.4)) / tread));
  // Rellano de entrada: en escaleras grandes, como en el plano (algo más de un metro)
  const entry = L >= 4 ? Math.min(1.35, L * 0.3) : 0.4;
  const startU = landingAtEnd ? entry : L - entry;
  const dirU = landingAtEnd ? 1 : -1;
  const two = S >= 2.0;
  const flights: [number, number][] = two ? [[0, S / 2 - 0.06], [S / 2 + 0.06, S]] : [[0, S]];
  flights.forEach(([v0, v1], k) => {
    for (let i = 0; i < n; i++) {
      // El primer tramo sube hacia la meseta; el segundo sigue subiendo de vuelta desde ella
      const level = k === 0 ? i + 1 : n + i + 1;
      const ua = k === 0 ? startU + dirU * i * tread : startU + dirU * (n - 1 - i) * tread;
      const ub = ua + dirU * tread;
      out.push(f.box(Math.min(ua, ub), Math.max(ua, ub), v0, v1, 0, level * rise, 'step', 1));
    }
  });
  const lu0 = landingAtEnd ? L - landing : 0;
  out.push(f.box(lu0, lu0 + landing, 0, S, 0, n * rise, 'step', 1));
  if (two) {
    const [a, b] = landingAtEnd ? [entry, L - landing] : [landing, L - entry];
    out.push(f.box(a, b, S / 2 - 0.05, S / 2 + 0.05, 0, n * rise + 0.9, 'metal', 2));
  }
  return out;
}

/** Cabinas de ascensor marcadas con su aspa, como en el plano. */
function liftParts(s: Space): Prim[] {
  const out: Prim[] = [];
  const r = inner(s, 0.12);
  if (r.w < 0.6 || r.d < 0.6) return out;
  const f = frame(r);
  const n = Math.max(1, Math.round(f.L / Math.max(1.6, f.S)));
  const cw = f.L / n;
  for (let i = 0; i < n; i++)
    out.push(f.box(i * cw + 0.05, (i + 1) * cw - 0.05, 0.05, f.S - 0.05, 0, 0.02, 'car', 1, { cross: true }));
  return out;
}

/** Sala de masajes: camilla en el centro, taburete al lado y mueble auxiliar en un rincón. */
function massageParts(s: Space): Prim[] {
  const out: Prim[] = [];
  const r = inner(s, 0.15);
  if (r.w < 1.2 || r.d < 1.2) return out;
  const f = frame(r);
  const { L, S } = f;
  const door = doorAt(s, f);
  const tl = Math.min(1.9, L - 0.6);
  const tw = Math.min(0.7, S - 0.8);
  const u0 = (L - tl) / 2;
  const v0 = (S - tw) / 2;
  out.push(f.box(u0, u0 + tl, v0, v0 + tw, 0, 0.7, 'sofa', 1));
  // Reposacabezas en el extremo lejos de la puerta
  const headU = door.u < L / 2 ? u0 + tl - 0.35 : u0;
  out.push(f.box(headU, headU + 0.35, v0 + 0.08, v0 + tw - 0.08, 0.7, 0.06, 'porcelain', 2));
  const stool = f.at(L / 2, Math.max(0.25, v0 - 0.3));
  out.push({ shape: 'cyl', x: stool.x, z: stool.z, w: 0.38, d: 0.38, y: 0, h: 0.55, mat: 'chair', layer: 0 });
  const cu = door.u < L / 2 ? L - 0.25 : 0.25;
  out.push(f.box(cu - 0.22, cu + 0.22, S - 0.45, S - 0.02, 0, 0.85, 'storage', 1));
  return out;
}

/**
 * Cocina profesional: encimeras contra las paredes largas (con hueco en las puertas), isla
 * central con fuegos, fregadero y neveras.
 */
function kitchenParts(s: Space): Prim[] {
  const out: Prim[] = [];
  const r = inner(s, 0.1);
  if (r.w < 2 || r.d < 2) return out;
  const f = frame(r);
  const { L, S } = f;
  const depth = 0.65;
  const runs: [number, number, 0 | 1][] = [];
  for (const side of [0, 1] as const) {
    // Huecos frente a las puertas de esa pared
    const gaps = s.doors
      .filter((d) => (f.horiz ? (side === 0 ? d.side === 'n' : d.side === 's') : side === 0 ? d.side === 'w' : d.side === 'e'))
      .map((d) => d.offset * L)
      .sort((a, b) => a - b);
    let start = 0;
    for (const g of [...gaps, L + 0.7]) {
      const end = Math.min(L, g - 0.7);
      if (end - start >= 0.6) runs.push([start, end, side]);
      start = g + 0.7;
    }
  }
  for (const [a, b, side] of runs) {
    const v0 = side === 1 ? S - depth : 0;
    out.push(f.box(a, b, v0, v0 + depth, 0, 0.9, 'counter', 1));
  }
  // Fregadero en el primer tramo y neveras al final del más largo
  const first = runs[0];
  if (first && first[1] - first[0] > 1.2) {
    const v = first[2] === 1 ? S - depth / 2 : depth / 2;
    const cu = first[0] + 0.8;
    out.push(f.box(cu - 0.4, cu + 0.4, v - 0.22, v + 0.22, 0.9, 0.02, 'porcelain', 2));
  }
  const longest = [...runs].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
  if (longest && longest[1] - longest[0] > 2.5) {
    const v0 = longest[2] === 1 ? S - depth : 0;
    out.push(f.box(longest[1] - 1.5, longest[1] - 0.05, v0, v0 + depth, 0, 2.0, 'metal', 2));
  }
  // Isla central con fuegos (como el bloque de módulos del plano)
  const il = Math.min(L * 0.4, 4.5);
  const iw = Math.min(1.4, S - 2 * depth - 2.2);
  if (iw >= 0.7) {
    const u0 = (L - il) / 2;
    const v0 = (S - iw) / 2;
    out.push(f.box(u0, u0 + il, v0, v0 + iw, 0, 0.9, 'metal', 1));
    const n = Math.max(1, Math.floor(il / 0.6));
    for (let i = 0; i < n; i++)
      for (const vv of [v0 + iw * 0.28, v0 + iw * 0.72]) {
        const c = f.at(u0 + (i + 0.5) * (il / n), vv);
        out.push({ shape: 'cyl', x: c.x, z: c.z, w: 0.26, d: 0.26, y: 0.9, h: 0.015, mat: 'screen', layer: 2 });
      }
  }
  return out;
}

export interface RoomPartsOptions {
  /** Capa de mobiliario visible; sin ella solo quedan escaleras y ascensores (estructura). */
  furniture?: boolean;
  /** Amueblar solas las salas; sin ello solo se ven los sanitarios calcados. */
  auto?: boolean;
}

/** Contenido dibujado de una estancia: mesas en salas, sanitarios en aseos, peldaños en escaleras… */
export function roomFurnitureParts(s: Space, { furniture = true, auto = true }: RoomPartsOptions = {}): Prim[] {
  if (s.kind === 'stairs') return stairParts(s);
  if (s.kind === 'lift') return liftParts(s);
  if (!furniture) return [];
  if (s.kind === 'restroom' && s.fixtures?.length) return tracedFixtures(s);
  if (!auto) return [];
  if (s.tags.includes('masajes')) return massageParts(s);
  if (s.tags.includes('cocina')) return kitchenParts(s);
  switch (s.kind) {
    case 'meeting':
      return meetingParts(s);
    case 'restroom':
      return restroomParts(s);
    default:
      return [];
  }
}
