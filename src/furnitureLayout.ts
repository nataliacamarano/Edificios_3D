import { distToSegment } from './geometry';
import type { Floor, Furniture, Space, Vec2 } from './types';

/**
 * Piezas con las que se dibuja cada mueble, en 2D y en 3D: tableros, sillas, respaldos,
 * macetas… Se generan a partir del rectángulo del mueble y su tipo, para que se parezca a los
 * símbolos del plano (mesas con sus sillas alrededor, puestos con silla, sofás con respaldo).
 */
export type Mat =
  | 'wood'
  | 'chair'
  | 'sofa'
  | 'counter'
  | 'storage'
  | 'pot'
  | 'plant'
  | 'metal'
  | 'screen'
  | 'felt'
  | 'porcelain'
  | 'partition'
  | 'tray'
  | 'step'
  | 'car';

export interface Prim {
  shape: 'box' | 'cyl' | 'sphere';
  /** Centro en planta y tamaño (para cilindros y esferas, w = diámetro). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Altura de la base y alto de la pieza. */
  y: number;
  h: number;
  mat: Mat;
  /** Giro alrededor del eje vertical, en radianes. */
  rot?: number;
  /** Capa en 2D: 0 asientos, 1 tableros y muebles, 2 detalles; null = no se dibuja en 2D. */
  layer: 0 | 1 | 2 | null;
  /** Aspa en 2D (armarios y taquillas). */
  cross?: boolean;
}

type Rect = { x: number; z: number; w: number; d: number };

/** Ejes locales del rectángulo: u a lo largo del lado largo, v a lo ancho. */
export function frame(r: Rect) {
  const horiz = r.w >= r.d;
  const L = horiz ? r.w : r.d;
  const S = horiz ? r.d : r.w;
  /** Pieza en coordenadas locales [u0,u1] × [v0,v1]. */
  const box = (u0: number, u1: number, v0: number, v1: number, y: number, h: number, mat: Mat, layer: Prim['layer'], extra: Partial<Prim> = {}): Prim => {
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const lu = Math.abs(u1 - u0);
    const lv = Math.abs(v1 - v0);
    return horiz
      ? { shape: 'box', x: r.x + cu, z: r.z + cv, w: lu, d: lv, y, h, mat, layer, ...extra }
      : { shape: 'box', x: r.x + cv, z: r.z + cu, w: lv, d: lu, y, h, mat, layer, ...extra };
  };
  const at = (u: number, v: number) => (horiz ? { x: r.x + u, z: r.z + v } : { x: r.x + v, z: r.z + u });
  return { horiz, L, S, box, at };
}

type F = ReturnType<typeof frame>;

/** Silla: asiento y respaldo; `toward` = +1 si la mesa queda hacia +v. */
function chair(f: F, cu: number, cv: number, toward: 1 | -1, out: Prim[], size = 0.46) {
  const h = size / 2;
  out.push(f.box(cu - h, cu + h, cv - h, cv + h, 0, 0.46, 'chair', 0));
  const bv = cv - toward * (h - 0.04);
  out.push(f.box(cu - h, cu + h, bv - 0.04, bv + 0.04, 0.46, 0.42, 'chair', 0));
}

/** Patas de mesa: dos paneles en los extremos (más barato que cuatro patas y se lee igual). */
function tableTop(f: F, u0: number, u1: number, v0: number, v1: number, out: Prim[], height = 0.74, mat: Mat = 'wood') {
  out.push(f.box(u0, u1, v0, v1, height - 0.04, 0.04, mat, 1));
  const t = 0.05;
  out.push(f.box(u0 + 0.04, u0 + 0.04 + t, v0 + 0.06, v1 - 0.06, 0, height - 0.04, 'metal', null));
  out.push(f.box(u1 - 0.04 - t, u1 - 0.04, v0 + 0.06, v1 - 0.06, 0, height - 0.04, 'metal', null));
}

/** Puestos de trabajo: mesas en una o dos filas (enfrentadas) con su silla y su pantalla. */
function desks(r: Rect, out: Prim[], back?: 0 | 1) {
  const f = frame(r);
  const { L, S } = f;
  const n = Math.max(1, Math.round(L / 1.4));
  const unit = L / n;
  const rows: { v0: number; v1: number; chairV: number | null; toward: 1 | -1 }[] = [];
  if (S >= 2.2) {
    const dd = Math.min(0.8, (S - 1.1) / 2);
    const m = S / 2;
    rows.push({ v0: m - dd, v1: m, chairV: m - dd - 0.3, toward: 1 });
    rows.push({ v0: m, v1: m + dd, chairV: m + dd + 0.3, toward: -1 });
  } else {
    const dd = Math.min(0.8, Math.max(0.45, S - 0.6));
    const chairFits = S - dd >= 0.45;
    if (back === 1) rows.push({ v0: S - dd, v1: S, chairV: chairFits ? S - dd - 0.3 : null, toward: 1 });
    else rows.push({ v0: 0, v1: dd, chairV: chairFits ? dd + 0.3 : null, toward: -1 });
  }
  for (let i = 0; i < n; i++) {
    const u0 = i * unit + 0.03;
    const u1 = (i + 1) * unit - 0.03;
    const cu = (u0 + u1) / 2;
    for (const row of rows) {
      tableTop(f, u0, u1, row.v0, row.v1, out);
      // Pantalla junto al borde del fondo de la mesa
      const sv = row.toward === 1 ? row.v1 - 0.12 : row.v0 + 0.12;
      out.push(f.box(cu - 0.27, cu + 0.27, sv - 0.03, sv + 0.03, 0.74, 0.34, 'screen', null));
      if (row.chairV !== null) chair(f, cu, row.chairV, row.toward, out);
    }
  }
}

/** Mesa con sillas a los lados (rectangular) o alrededor (redonda); taburetes si es alta. */
function table(r: Rect, out: Prim[], label = '', maxPiece = 3.2) {
  const f = frame(r);
  const { L, S } = f;
  const high = /alta|high/i.test(label);
  const booth = /reservado|booth/i.test(label);
  const bench = /banco|bench/i.test(label);

  if (bench && !booth) {
    // Banco corrido: asiento largo con respaldo hacia el lado v = 0
    const dd = Math.min(S, 0.6);
    out.push(f.box(0, L, S - dd, S, 0, 0.45, 'sofa', 0));
    out.push(f.box(0, L, S - dd, S - dd + 0.12, 0.45, 0.4, 'sofa', 0));
    return;
  }

  // Fila de mesitas redondas con una silla a cada lado (símbolo «□ ○ □» del plano)
  if (!booth && !high && S < 1.3 && L >= 1.6) {
    const n = Math.max(1, Math.floor(L / 1.5));
    const unit = L / n;
    const diam = Math.min(0.7, S - 0.1, unit - 0.95);
    for (let i = 0; i < n; i++) {
      const cu = (i + 0.5) * unit;
      const c = f.at(cu, S / 2);
      out.push({ shape: 'cyl', x: c.x, z: c.z, w: Math.max(0.45, diam), d: Math.max(0.45, diam), y: 0.7, h: 0.04, mat: 'wood', layer: 1 });
      out.push({ shape: 'cyl', x: c.x, z: c.z, w: 0.1, d: 0.1, y: 0, h: 0.7, mat: 'metal', layer: null });
      for (const side of [-1, 1] as const) {
        const p = f.at(cu + side * (Math.max(0.45, diam) / 2 + 0.25), S / 2);
        const ang = (f.horiz ? 0 : Math.PI / 2) + (side === -1 ? 0 : Math.PI);
        out.push({ shape: 'box', x: p.x, z: p.z, w: 0.42, d: 0.42, y: 0, h: 0.46, mat: 'chair', layer: 0, rot: -ang });
        out.push({ shape: 'box', x: p.x - Math.cos(ang) * 0.17, z: p.z - Math.sin(ang) * 0.17, w: 0.08, d: 0.42, y: 0.46, h: 0.4, mat: 'chair', layer: 0, rot: -ang });
      }
    }
    return;
  }

  const round = !booth && L / S < 1.3 && L < 2.4;
  if (round) {
    const c = f.at(L / 2, S / 2);
    const diam = Math.max(0.6, Math.min(L, S) - (high ? 0.7 : 1.0));
    out.push({ shape: 'cyl', x: c.x, z: c.z, w: diam, d: diam, y: (high ? 1.05 : 0.74) - 0.04, h: 0.04, mat: 'wood', layer: 1 });
    out.push({ shape: 'cyl', x: c.x, z: c.z, w: 0.12, d: 0.12, y: 0, h: (high ? 1.05 : 0.74) - 0.04, mat: 'metal', layer: null });
    const rr = diam / 2 + (high ? 0.22 : 0.3);
    const n = Math.max(2, Math.min(8, Math.floor((2 * Math.PI * rr) / 0.7)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = { x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr };
      if (high) out.push({ shape: 'cyl', x: p.x, z: p.z, w: 0.36, d: 0.36, y: 0, h: 0.75, mat: 'chair', layer: 0 });
      else {
        out.push({ shape: 'box', x: p.x, z: p.z, w: 0.46, d: 0.46, y: 0, h: 0.46, mat: 'chair', layer: 0, rot: -a });
        const b = { x: p.x + Math.cos(a) * 0.19, z: p.z + Math.sin(a) * 0.19 };
        out.push({ shape: 'box', x: b.x, z: b.z, w: 0.08, d: 0.46, y: 0.46, h: 0.42, mat: 'chair', layer: 0, rot: -a });
      }
    }
    return;
  }

  // Mesa(s) rectangulares a lo largo; las muy largas se parten en tramos
  const both = S >= 1.5;
  const seat = 0.55;
  const tv0 = both ? seat : 0;
  const tv1 = S - seat;
  const ends = !booth && L >= 2.6 && S >= 1.2;
  const uMargin = ends ? 0.55 : 0.1;
  const span = L - 2 * uMargin;
  const pieces = Math.max(1, Math.ceil(span / maxPiece));
  const gap = pieces > 1 ? 0.5 : 0;
  const pl = (span - gap * (pieces - 1)) / pieces;
  const topH = high ? 1.05 : 0.74;
  for (let k = 0; k < pieces; k++) {
    const u0 = uMargin + k * (pl + gap);
    const u1 = u0 + pl;
    tableTop(f, u0, u1, Math.max(tv0, 0.02), Math.max(tv1, tv0 + 0.5), out, topH);
    if (booth) continue;
    const per = Math.max(1, Math.floor(pl / 0.7));
    for (let i = 0; i < per; i++) {
      const cu = u0 + ((i + 0.5) * pl) / per;
      if (high) {
        const s = f.at(cu, tv1 + 0.25);
        out.push({ shape: 'cyl', x: s.x, z: s.z, w: 0.36, d: 0.36, y: 0, h: 0.75, mat: 'chair', layer: 0 });
        if (both) {
          const s2 = f.at(cu, tv0 - 0.25);
          out.push({ shape: 'cyl', x: s2.x, z: s2.z, w: 0.36, d: 0.36, y: 0, h: 0.75, mat: 'chair', layer: 0 });
        }
        continue;
      }
      chair(f, cu, tv1 + 0.28, -1, out);
      if (both) chair(f, cu, tv0 - 0.28, 1, out);
    }
  }
  if (booth) {
    // Reservados: bancos tapizados a ambos lados de las mesas
    out.push(f.box(0, L, 0, seat, 0, 0.45, 'sofa', 0));
    out.push(f.box(0, L, 0, 0.14, 0.45, 0.5, 'sofa', 0));
    if (both) {
      out.push(f.box(0, L, S - seat, S, 0, 0.45, 'sofa', 0));
      out.push(f.box(0, L, S - 0.14, S, 0.45, 0.5, 'sofa', 0));
    }
  }
  if (ends) {
    const cv = (tv0 + tv1) / 2;
    // Sillas en las cabeceras, giradas hacia la mesa
    const a = f.at(0.28, cv);
    const b = f.at(L - 0.28, cv);
    for (const [p, dir] of [[a, 0], [b, Math.PI]] as const) {
      const ang = (f.horiz ? 0 : Math.PI / 2) + dir;
      out.push({ shape: 'box', x: p.x, z: p.z, w: 0.46, d: 0.46, y: 0, h: 0.46, mat: 'chair', layer: 0, rot: -ang });
      const bx = p.x - Math.cos(ang) * 0.19;
      const bz = p.z - Math.sin(ang) * 0.19;
      out.push({ shape: 'box', x: bx, z: bz, w: 0.08, d: 0.46, y: 0.46, h: 0.42, mat: 'chair', layer: 0, rot: -ang });
    }
  }
}

/** Sofás o butacas: asiento, respaldo hacia `back` y brazos en los extremos. */
function sofa(r: Rect, out: Prim[], back: 0 | 1) {
  const f = frame(r);
  const { L, S } = f;
  const n = Math.max(1, Math.ceil(L / 2.4));
  const gap = n > 1 ? 0.3 : 0;
  const sl = (L - gap * (n - 1)) / n;
  const bv0 = back === 1 ? S - 0.22 : 0;
  for (let i = 0; i < n; i++) {
    const u0 = i * (sl + gap);
    const u1 = u0 + sl;
    out.push(f.box(u0, u1, 0, S, 0, 0.42, 'sofa', 0));
    out.push(f.box(u0, u1, bv0, bv0 + 0.22, 0.42, 0.4, 'sofa', 1));
    out.push(f.box(u0, u0 + 0.18, 0, S, 0.42, 0.2, 'sofa', 1));
    out.push(f.box(u1 - 0.18, u1, 0, S, 0.42, 0.2, 'sofa', 1));
  }
}

function equipment(r: Rect, out: Prim[], label = '') {
  const f = frame(r);
  const { L, S } = f;
  if (/cinta|treadmill/i.test(label)) {
    const n = Math.max(1, Math.round(L / 0.9));
    const unit = L / n;
    for (let i = 0; i < n; i++) {
      const u0 = i * unit + 0.08;
      const u1 = (i + 1) * unit - 0.08;
      out.push(f.box(u0, u1, 0.05, S - 0.05, 0, 0.22, 'metal', 1));
      out.push(f.box(u0, u1, 0.05, 0.22, 0.22, 1.05, 'screen', 2));
    }
    return;
  }
  if (/fuerza|weight|máquina/i.test(label)) {
    const n = Math.max(1, Math.round(L / 1.3));
    const unit = L / n;
    for (let i = 0; i < n; i++) {
      const u0 = i * unit + 0.1;
      const u1 = (i + 1) * unit - 0.1;
      out.push(f.box(u0, u1, 0.1, S - 0.1, 0, 0.08, 'metal', 1));
      out.push(f.box(u0, u0 + 0.08, 0.1, 0.18, 0, 2.0, 'metal', 2));
      out.push(f.box(u1 - 0.08, u1, 0.1, 0.18, 0, 2.0, 'metal', 2));
      out.push(f.box(u0 + 0.25, u1 - 0.25, S / 2 - 0.15, S - 0.15, 0, 0.45, 'chair', 1));
    }
    return;
  }
  if (/juego|game|ping|billar|futbol/i.test(label)) {
    tableTop(f, 0.05, L - 0.05, 0.05, S - 0.05, out, 0.78, 'felt');
    return;
  }
  if (/bici|bike/i.test(label)) {
    const n = Math.max(1, Math.round(L / 0.6));
    for (let i = 0; i < n; i++) {
      const cu = (i + 0.5) * (L / n);
      out.push(f.box(cu - 0.03, cu + 0.03, S * 0.15, S * 0.85, 0, 0.8, 'metal', 1));
    }
    return;
  }
  out.push(f.box(0, L, 0, S, 0, 1.15, 'metal', 1));
  out.push(f.box(0.05, L - 0.05, 0.05, S - 0.05, 1.15, 0.05, 'screen', 2));
}

function plant(r: Rect, out: Prim[]) {
  const f = frame(r);
  const { L, S } = f;
  if (L / S < 1.5) {
    const c = f.at(L / 2, S / 2);
    const d = Math.min(L, S);
    out.push({ shape: 'cyl', x: c.x, z: c.z, w: d * 0.75, d: d * 0.75, y: 0, h: 0.5, mat: 'pot', layer: 1 });
    out.push({ shape: 'sphere', x: c.x, z: c.z, w: d, d, y: 0.45, h: d, mat: 'plant', layer: 2 });
    return;
  }
  out.push(f.box(0, L, 0, S, 0, 0.5, 'pot', 1));
  const n = Math.max(1, Math.round(L / 0.8));
  for (let i = 0; i < n; i++) {
    const c = f.at((i + 0.5) * (L / n), S / 2);
    out.push({ shape: 'sphere', x: c.x, z: c.z, w: S * 1.1, d: S * 1.1, y: 0.45, h: S * 1.1, mat: 'plant', layer: 2 });
  }
}

/** Lado largo del mueble más cercano a una pared del contorno (para el respaldo de sofás). */
function backToward(r: Rect, outline: Vec2[]): 0 | 1 {
  if (outline.length < 2) return 0;
  const f = frame(r);
  const p0 = f.at(f.L / 2, 0);
  const p1 = f.at(f.L / 2, f.S);
  const dmin = (p: Vec2) =>
    Math.min(...outline.map((a, i) => distToSegment(p, a, outline[(i + 1) % outline.length])));
  return dmin(p1) < dmin(p0) ? 1 : 0;
}

/** Piezas de un mueble colocado. */
export function furnitureParts(m: Furniture, floor?: Floor): Prim[] {
  const out: Prim[] = [];
  const r = { x: m.x, z: m.z, w: m.w, d: m.d };
  switch (m.kind) {
    case 'desk':
      desks(r, out, backToward(r, floor?.outline ?? []));
      break;
    case 'table':
      table(r, out, m.label);
      break;
    case 'sofa':
      sofa(r, out, backToward(r, floor?.outline ?? []));
      break;
    case 'counter': {
      const f = frame(r);
      out.push(f.box(0.06, f.L - 0.06, 0.06, f.S - 0.06, 0, 0.95, 'counter', 1));
      out.push(f.box(0, f.L, 0, f.S, 0.95, 0.05, 'counter', 2));
      const label = m.label ?? '';
      if (/encimera|worktop|office/i.test(label) && f.L >= 1.2) {
        // Encimera de cocina: fregadero, cafetera y nevera al final
        const v = f.S / 2;
        out.push(f.box(f.L * 0.3 - 0.25, f.L * 0.3 + 0.25, v - 0.2, v + 0.2, 0.99, 0.02, 'porcelain', 2));
        out.push(f.box(f.L * 0.55 - 0.18, f.L * 0.55 + 0.18, v - 0.18, v + 0.18, 1.0, 0.45, 'screen', 2));
        if (f.L >= 2.4) out.push(f.box(f.L - 0.7, f.L - 0.02, 0.02, f.S - 0.02, 0, 1.9, 'metal', 2));
      } else if (/isla de servicio|servery|buffet|mostrador de servicio/i.test(label)) {
        // Mostrador de servicio: bandejas de comida a lo largo
        const n = Math.max(1, Math.floor((f.L - 0.3) / 0.7));
        for (let i = 0; i < n; i++) {
          const cu = 0.15 + (i + 0.5) * ((f.L - 0.3) / n);
          out.push(f.box(cu - 0.27, cu + 0.27, f.S / 2 - 0.2, f.S / 2 + 0.2, 1.0, 0.02, 'metal', 2));
        }
      }
      break;
    }
    case 'storage': {
      const f = frame(r);
      out.push(f.box(0, f.L, 0, f.S, 0, f.S < 0.7 ? 1.8 : 1.2, 'storage', 1, { cross: true }));
      break;
    }
    case 'plant':
      plant(r, out);
      break;
    case 'equipment':
      equipment(r, out, m.label);
      break;
  }
  return out;
}

/**
 * Mobiliario de una sala de reunión, como en el plano: mesa con sillas a su medida, o mesa y
 * silla en las cabinas pequeñas (con la mesa al fondo, lejos de la puerta).
 */
export function meetingParts(s: Space): Prim[] {
  const out: Prim[] = [];
  const inset = 0.28;
  const r = { x: s.x + inset, z: s.z + inset, w: s.w - 2 * inset, d: s.d - 2 * inset };
  if (r.w < 0.6 || r.d < 0.6) return out;
  const small = Math.min(s.w, s.d) < 1.7 && s.w * s.d < 5;
  if (small) {
    // Cabina: mesa contra la pared opuesta a la puerta
    const door = s.doors[0]?.side;
    const horiz = r.w >= r.d;
    let back: 0 | 1 = 0;
    if (door) {
      const onLong = horiz ? door === 'n' || door === 's' : door === 'e' || door === 'w';
      if (onLong) back = door === 'n' || door === 'w' ? 1 : 0;
    }
    const f = frame(r);
    const dd = Math.min(0.6, f.S * 0.45);
    const v0 = back === 1 ? f.S - dd : 0;
    tableTop(f, 0.05, f.L - 0.05, v0, v0 + dd, out);
    const cv = back === 1 ? f.S - dd - 0.3 : dd + 0.3;
    if (f.S - dd >= 0.45) chair(f, f.L / 2, cv, back === 1 ? 1 : -1, out, 0.42);
    return out;
  }
  // Una sola mesa de reunión, como en el plano
  table(r, out, '', 8);
  return out;
}
