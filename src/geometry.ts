import type { Door, NorthDir, Side, Space, SpaceKind, Vec2 } from './types';

export const KINDS: SpaceKind[] = [
  'meeting',
  'room',
  'workspace',
  'restroom',
  'kitchen',
  'printer',
  'stationery',
  'lift',
  'stairs',
  'lobby',
  'void',
  'obstacle',
];

export const KIND_COLORS: Record<SpaceKind, string> = {
  meeting: '#e8d7a2',
  room: '#dfe3e8',
  workspace: '#cfe6d3',
  restroom: '#f0b3bc',
  kitchen: '#9fc2ee',
  printer: '#8fd1ab',
  stationery: '#cdc4ee',
  lift: '#8e98a6',
  stairs: '#c4cad3',
  lobby: '#f5e6c8',
  void: '#bfe3f5',
  obstacle: '#c7cbd2',
};

/** Turquesa, como el «good lift» marcado en los planos. */
export const GOOD_LIFT_COLOR = '#22d3c5';

/** Montacargas: ascensor con la etiqueta «montacargas». */
export const isGoodLift = (s: Space) => s.kind === 'lift' && s.tags.includes('montacargas');

/** Color con el que se dibuja una estancia: el suyo, el del montacargas o el de su tipo. */
export const spaceColor = (s: Space) => s.color ?? (isGoodLift(s) ? GOOD_LIFT_COLOR : KIND_COLORS[s.kind]);

export const KIND_ICONS: Record<SpaceKind, string> = {
  meeting: '',
  room: '',
  workspace: '',
  restroom: '🚻',
  kitchen: '☕',
  printer: '🖨️',
  stationery: '📎',
  lift: '🛗',
  stairs: '🪜',
  lobby: '',
  void: '',
  obstacle: '',
};

export const SIDES: Side[] = ['n', 'e', 's', 'w'];

/** Estancias con muros y puertas: solo se entra por sus puertas. */
export const isEnclosed = (k: SpaceKind) =>
  k === 'meeting' || k === 'room' || k === 'restroom' || k === 'lift' || k === 'stairs';
export const isObstacle = (k: SpaceKind) => k === 'obstacle';
/** Hueco (tragaluz, atrio): no se pisa, pero se dibuja como cristal. */
export const isVoid = (k: SpaceKind) => k === 'void';
/** No transitable: núcleos y huecos. */
export const isBlocking = (k: SpaceKind) => isObstacle(k) || isVoid(k);
export const isConnector = (k: SpaceKind) => k === 'lift' || k === 'stairs';
/**
 * Zona de paso con paredes y puertas (vestíbulo de un aseo, antesala…): se camina por dentro,
 * pero solo se entra y sale por sus puertas.
 */
export const isWalledPassage = (s: Space) => !isEnclosed(s.kind) && !isBlocking(s.kind) && s.doors.length > 0;
export const isDestination = (k: SpaceKind) => !isBlocking(k);

export const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 9);

export const round = (v: number, step = 0.05) => +(Math.round(v / step) * step).toFixed(3);

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

export function polylineLength(pts: Vec2[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

export const center = (s: Space): Vec2 => ({ x: s.x + s.w / 2, z: s.z + s.d / 2 });

export const sideLength = (s: Space, side: Side) => (side === 'n' || side === 's' ? s.w : s.d);

export function sideEnds(s: Space, side: Side): [Vec2, Vec2] {
  switch (side) {
    case 'n':
      return [{ x: s.x, z: s.z }, { x: s.x + s.w, z: s.z }];
    case 's':
      return [{ x: s.x, z: s.z + s.d }, { x: s.x + s.w, z: s.z + s.d }];
    case 'w':
      return [{ x: s.x, z: s.z }, { x: s.x, z: s.z + s.d }];
    case 'e':
      return [{ x: s.x + s.w, z: s.z }, { x: s.x + s.w, z: s.z + s.d }];
  }
}

export function sideNormal(side: Side): Vec2 {
  switch (side) {
    case 'n':
      return { x: 0, z: -1 };
    case 's':
      return { x: 0, z: 1 };
    case 'w':
      return { x: -1, z: 0 };
    case 'e':
      return { x: 1, z: 0 };
  }
}

export function doorPoint(s: Space, d: Door): Vec2 {
  const [a, b] = sideEnds(s, d.side);
  return lerp(a, b, d.offset);
}

/** Extremos [inicio, fin] del hueco de una puerta. */
export function doorGap(s: Space, d: Door): [Vec2, Vec2] {
  const [a, b] = sideEnds(s, d.side);
  const L = sideLength(s, d.side) || 1;
  const t0 = Math.max(0, d.offset * L - d.width / 2) / L;
  const t1 = Math.min(L, d.offset * L + d.width / 2) / L;
  return [lerp(a, b, t0), lerp(a, b, t1)];
}

/** Tramos de muro del perímetro de una estancia, descontando los huecos de las puertas. */
export function wallSegments(s: Space): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (const side of SIDES) {
    const [a, b] = sideEnds(s, side);
    const L = sideLength(s, side);
    if (L <= 0) continue;
    const gaps = s.doors
      .filter((d) => d.side === side)
      .map((d) => [Math.max(0, d.offset * L - d.width / 2), Math.min(L, d.offset * L + d.width / 2)])
      .sort((p, q) => p[0] - q[0]);
    let t = 0;
    for (const [g0, g1] of gaps) {
      if (g0 - t > 0.02) out.push([lerp(a, b, t / L), lerp(a, b, g0 / L)]);
      t = Math.max(t, g1);
    }
    if (L - t > 0.02) out.push([lerp(a, b, t / L), b]);
  }
  return out;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

export const pointInRect = (p: Vec2, s: { x: number; z: number; w: number; d: number }) =>
  p.x >= s.x && p.x <= s.x + s.w && p.z >= s.z && p.z <= s.z + s.d;

/** Lado de la estancia más cercano a un punto y la posición relativa (0..1) sobre ese lado. */
export function nearestSide(s: Space, p: Vec2): { side: Side; offset: number; distance: number } {
  let best = { side: 'n' as Side, offset: 0.5, distance: Infinity };
  for (const side of SIDES) {
    const [a, b] = sideEnds(s, side);
    const d = distToSegment(p, a, b);
    if (d < best.distance) {
      const L = sideLength(s, side) || 1;
      const along = side === 'n' || side === 's' ? p.x - s.x : p.z - s.z;
      best = { side, offset: Math.max(0.05, Math.min(0.95, along / L)), distance: d };
    }
  }
  return best;
}

export function bbox(pts: Vec2[]) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!isFinite(minX)) return { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
  return { minX, minZ, maxX, maxZ };
}

const DIR_VECTORS: Record<NorthDir, Vec2> = {
  '+x': { x: 1, z: 0 },
  '-x': { x: -1, z: 0 },
  '+z': { x: 0, z: 1 },
  '-z': { x: 0, z: -1 },
};

export type Cardinal = 'n' | 's' | 'e' | 'w';

/** Posición de las letras N/S/E/O fuera del contorno, según hacia dónde quede el norte. */
export function compassMarks(outline: Vec2[], north: NorthDir, margin = 2.5): { dir: Cardinal; pos: Vec2 }[] {
  const bb = bbox(outline);
  const c = { x: (bb.minX + bb.maxX) / 2, z: (bb.minZ + bb.maxZ) / 2 };
  const hx = (bb.maxX - bb.minX) / 2 + margin;
  const hz = (bb.maxZ - bb.minZ) / 2 + margin;
  const n = DIR_VECTORS[north];
  // El este queda 90° en sentido horario del norte (con z hacia abajo)
  const e = { x: -n.z, z: n.x };
  const at = (d: Vec2) => ({ x: c.x + d.x * hx, z: c.z + d.z * hz });
  return [
    { dir: 'n', pos: at(n) },
    { dir: 's', pos: at({ x: -n.x, z: -n.z }) },
    { dir: 'e', pos: at(e) },
    { dir: 'w', pos: at({ x: -e.x, z: -e.z }) },
  ];
}

export function fmtTime(sec: number) {
  if (!isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** Hora del día "hh:mm" (o "hh:mm:ss") a partir de segundos desde medianoche. */
export function fmtClock(sec: number, withSeconds = false) {
  if (!isFinite(sec)) return '—';
  const s = Math.round(sec) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}${withSeconds ? ':' + pad(s % 60) : ''}`;
}

/** "10:41" → segundos desde medianoche. Devuelve null si el texto no es una hora. */
export function parseClock(text: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((text ?? '').trim());
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0);
}

export const fmtDist =(m: number) => (isFinite(m) ? `${m.toFixed(m < 10 ? 1 : 0)} m` : '—');
