import { isDestination, isEnclosed, pointInRect } from './geometry';
import type { Building, FixtureKind, FixtureTimes, Floor, Item, ItemType, Routine, RoutineTarget, Space } from './types';

/** Tipos de elemento de partida; se pueden editar y añadir más. */
export function defaultItemTypes(): ItemType[] {
  return [
    { id: 't-papelera', name: 'Papelera', icon: '🗑️', color: '#64748b', shape: 'bin', w: 0.5, d: 0.5, dwell: 30 },
    { id: 't-reciclaje', name: 'Reciclaje', icon: '♻️', color: '#16a34a', shape: 'bin', w: 0.6, d: 0.6, dwell: 45 },
    { id: 't-vaciado', name: 'Punto de vaciado', icon: '🚮', color: '#0f766e', shape: 'box', w: 1.2, d: 1, dwell: 120 },
    { id: 't-cuarto', name: 'Cuarto de limpieza', icon: '🧹', color: '#a16207', shape: 'box', w: 2, d: 2, dwell: 180 },
    { id: 't-jabon', name: 'Dispensador de jabón', icon: '🧴', color: '#db2777', shape: 'bin', w: 0.3, d: 0.3, dwell: 20 },
    { id: 't-papel', name: 'Dispensador de papel', icon: '🧻', color: '#9333ea', shape: 'bin', w: 0.3, d: 0.3, dwell: 20 },
    { id: 't-nook', name: 'Phone nook', icon: '📞', color: '#2563eb', shape: 'box', w: 1.2, d: 1.2, dwell: 120 },
    { id: 't-pod', name: 'Meeting pod', icon: '👥', color: '#0ea5e9', shape: 'box', w: 2.4, d: 2, dwell: 240 },
  ];
}

/** Rutinas de ejemplo (sin asignar): se ajustan y se asignan desde la pestaña Rutinas. */
export function defaultRoutines(): Routine[] {
  return [
    {
      id: 'r-banos',
      name: 'Rutina de baños',
      color: '#db2777',
      filters: [{ kind: 'spaces', spaceKinds: ['restroom'], tags: ['aseo'] }],
      extra: [],
      floorIds: [],
      dwell: 300,
      rounds: ['10:00', '12:00', '14:00'],
    },
    {
      id: 'r-basura',
      name: 'Recogida de basura',
      color: '#16a34a',
      filters: [{ kind: 'items', typeIds: ['t-papelera', 't-reciclaje', 't-vaciado'] }],
      extra: [],
      floorIds: [],
      dwell: 60,
      rounds: [],
    },
    {
      id: 'r-meetings',
      name: 'Limpieza de salas de reunión',
      color: '#2563eb',
      filters: [{ kind: 'spaces', spaceKinds: ['meeting'], tags: [] }, { kind: 'items', typeIds: ['t-nook', 't-pod'] }],
      extra: [],
      floorIds: [],
      dwell: 180,
      rounds: [],
    },
  ];
}

export const itemTypeOf = (b: Building, item: Item): ItemType | undefined => b.itemTypes?.find((t) => t.id === item.typeId);

export const itemSize = (b: Building, item: Item) => {
  const t = itemTypeOf(b, item);
  return { w: item.w ?? t?.w ?? 0.5, d: item.d ?? t?.d ?? 0.5 };
};

export const itemDwell = (b: Building, item: Item) => item.dwell ?? itemTypeOf(b, item)?.dwell ?? 30;

export const itemLabel = (b: Building, item: Item) => item.name?.trim() || itemTypeOf(b, item)?.name || 'Elemento';

/** Rectángulo que ocupa un elemento. */
export function itemRect(b: Building, item: Item) {
  const { w, d } = itemSize(b, item);
  return { x: item.x - w / 2, z: item.z - d / 2, w, d };
}

/** Estancia cerrada (sala, aseo…) que contiene el elemento, si la hay. */
export const spaceContaining = (floor: Floor, item: Item): Space | undefined =>
  floor.spaces.find((s) => s.kind !== 'workspace' && s.kind !== 'lobby' && pointInRect({ x: item.x, z: item.z }, s));

export const targetKey = (t: RoutineTarget) => (t.itemId ? `item:${t.itemId}` : `space:${t.floorId}:${t.spaceId}`);

export const DEFAULT_FIXTURE_TIMES: FixtureTimes = {
  base: 60,
  wc: 90,
  urinal: 40,
  sink: 30,
  shower: 120,
  dressing: 30,
  bench: 20,
  locker: 0,
};

export const fixtureTimes = (b: Building): FixtureTimes => ({ ...DEFAULT_FIXTURE_TIMES, ...b.fixtureTimes });

/** Piezas de cada tipo de un aseo (los lavabos de una encimera cuentan uno a uno). */
export function fixtureCounts(s: Space): Partial<Record<FixtureKind, number>> {
  const out: Partial<Record<FixtureKind, number>> = {};
  for (const f of s.fixtures ?? []) out[f.kind] = (out[f.kind] ?? 0) + (f.count ?? 1);
  return out;
}

/** Segundos de limpieza de un aseo según sus sanitarios, o null si no tiene ninguno calcado. */
export function fixtureCleaningTime(b: Building, s: Space): number | null {
  if (!s.fixtures?.length) return null;
  const times = fixtureTimes(b);
  const counts = fixtureCounts(s);
  return (Object.keys(counts) as FixtureKind[]).reduce((acc, k) => acc + times[k] * (counts[k] ?? 0), times.base);
}

/** Tiempo de trabajo de una estancia dentro de una rutina. */
export const spaceDwell = (b: Building, r: Routine, s: Space) =>
  (r.byFixtures !== false && fixtureCleaningTime(b, s)) || r.dwell;

/** Posición, planta y tiempo de trabajo de una parada. */
export function targetInfo(b: Building, r: Routine, t: RoutineTarget) {
  const floor = b.floors.find((f) => f.id === t.floorId);
  if (t.itemId) {
    const item = b.items?.find((i) => i.id === t.itemId);
    if (!item) return null;
    const fl = b.floors.find((f) => f.id === item.floorId);
    return { pos: { x: item.x, z: item.z }, level: fl?.level ?? 0, dwell: itemDwell(b, item), name: itemLabel(b, item) };
  }
  const s = floor?.spaces.find((x) => x.id === t.spaceId);
  if (!floor || !s) return null;
  return { pos: { x: s.x + s.w / 2, z: s.z + s.d / 2 }, level: floor.level, dwell: spaceDwell(b, r, s), name: s.name };
}

/**
 * Reparte las paradas de una rutina entre `n` operarios con una carga de trabajo parecida:
 * ordena las paradas en un recorrido (planta a planta, siempre a la más cercana) y lo corta
 * en `n` tramos seguidos de tiempo similar (trabajo + desplazamiento estimado).
 */
export function distributeTargets(b: Building, r: Routine, targets: RoutineTarget[], n: number): string[][] {
  const infos = targets
    .map((t) => ({ t, info: targetInfo(b, r, t) }))
    .filter((x): x is { t: RoutineTarget; info: NonNullable<ReturnType<typeof targetInfo>> } => !!x.info);
  const levels = [...new Set(infos.map((x) => x.info.level))].sort((a, c) => c - a);
  const tour: typeof infos = [];
  for (const level of levels) {
    const pending = infos.filter((x) => x.info.level === level);
    let cur = pending.shift();
    while (cur) {
      tour.push(cur);
      const here: { x: number; z: number } = cur.info.pos;
      pending.sort((a, c) => Math.hypot(a.info.pos.x - here.x, a.info.pos.z - here.z) - Math.hypot(c.info.pos.x - here.x, c.info.pos.z - here.z));
      cur = pending.shift();
    }
  }
  const SPEED = 1.2;
  const costs = tour.map((x, i) => {
    const prev = tour[i - 1];
    if (!prev) return x.info.dwell;
    const walk = prev.info.level === x.info.level ? Math.hypot(prev.info.pos.x - x.info.pos.x, prev.info.pos.z - x.info.pos.z) / SPEED : 60;
    return x.info.dwell + walk;
  });
  const total = costs.reduce((a, c) => a + c, 0);
  const parts: string[][] = Array.from({ length: Math.max(1, n) }, () => []);
  let acc = 0;
  tour.forEach((x, i) => {
    const k = Math.min(parts.length - 1, Math.floor((acc / (total || 1)) * parts.length));
    parts[k].push(targetKey(x.t));
    acc += costs[i];
  });
  return parts;
}

/** Paradas de una rutina: las de sus criterios (en las plantas elegidas) más las extra, sin repetir. */
export function routineTargets(b: Building, r: Routine): RoutineTarget[] {
  const floors = b.floors.filter((f) => !r.floorIds.length || r.floorIds.includes(f.id));
  const out: RoutineTarget[] = [];
  for (const f of r.filters) {
    if (f.kind === 'spaces') {
      for (const floor of floors)
        for (const s of floor.spaces) {
          // Sin puerta no se puede entrar (p. ej. partes de un vestuario): no es una parada
          if (!isDestination(s.kind) || (isEnclosed(s.kind) && !s.doors.length)) continue;
          const kindOk = !f.spaceKinds.length || f.spaceKinds.includes(s.kind);
          const tagOk = !f.tags.length || f.tags.some((t) => s.tags.includes(t));
          if (kindOk && tagOk) out.push({ floorId: floor.id, spaceId: s.id });
        }
    } else {
      for (const item of b.items ?? [])
        if (f.typeIds.includes(item.typeId) && floors.some((fl) => fl.id === item.floorId))
          out.push({ floorId: item.floorId, itemId: item.id });
    }
  }
  out.push(...r.extra);
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = targetKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
