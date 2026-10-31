import {
  center,
  dist,
  doorPoint,
  isConnector,
  isEnclosed,
  isGoodLift,
  isBlocking,
  lerp,
  fmtClock as fmtClockShort,
  parseClock,
  polylineLength,
  sideNormal,
} from '../geometry';
import type { AccessRule, Building, Floor, Item, Person, Routine, RoutineTarget, Space, Stop, Vec2 } from '../types';
import { itemDwell, itemLabel, itemRect, itemTypeOf, routineTargets, spaceContaining, spaceDwell, targetKey } from '../routines';
import { buildGrid, cellCenter, cellOf, nearestFree, type NavGrid } from './grid';
import { cellsToPoints, dijkstra, smoothPath, tracePath } from './pathfind';
import { solveTsp } from './tsp';

/** Segundos de un trayecto en ascensor: espera + tiempo por planta. */
const LIFT_BASE_S = 20;
const LIFT_PER_LEVEL_S = 4;
const STAIRS_PER_LEVEL_S = 15;
/** Velocidad de referencia para convertir segundos de cambio de planta en metros equivalentes. */
const REF_SPEED = 1.3;

/**
 * Penalización por metro recorrido dentro de una zona «a evitar»: solo se cruza si rodearla
 * es más de AVOID_FACTOR veces más largo (en la práctica, si no hay alternativa).
 */
const AVOID_FACTOR = 30;
/** Penalización (en metros equivalentes) por usar un ascensor «a evitar». */
const AVOID_CONNECTOR = 5000;

interface MaskRef {
  key: string;
  mask: Uint8Array;
  /** Peso por celda (1 normal, AVOID_FACTOR en zonas a evitar); ausente si no hay ninguna. */
  weight?: Float32Array;
}

/** Rejillas por planta y cachés de campos de distancia. Se recrea cuando cambia el edificio. */
export class Router {
  readonly grids = new Map<string, NavGrid>();
  private masks = new Map<string, MaskRef>();
  private fields = new Map<string, Float64Array>();

  constructor(readonly building: Building) {
    for (const f of building.floors) {
      // Los muebles (nooks, pods, cuartos y el mobiliario de la planta) bloquean el paso; las
      // papeleras no
      const blockers = [
        ...(building.items ?? [])
          .filter((i) => i.floorId === f.id && itemTypeOf(building, i)?.shape === 'box')
          .map((i) => itemRect(building, i)),
        ...(f.furniture ?? []),
      ];
      this.grids.set(f.id, buildGrid(f, blockers));
    }
  }

  mask(floorId: string, blockedSpaceIds: string[], avoidedSpaceIds: string[] = []): MaskRef {
    const key = floorId + '|' + [...blockedSpaceIds].sort().join(',') + '|' + [...avoidedSpaceIds].sort().join(',');
    let m = this.masks.get(key);
    if (!m) {
      const g = this.grids.get(floorId)!;
      const mask = g.base.slice();
      for (const id of blockedSpaceIds) {
        const cells = g.spaceCells.get(id);
        if (cells) for (const c of cells) mask[c] = 1;
      }
      let weight: Float32Array | undefined;
      if (avoidedSpaceIds.length) {
        weight = new Float32Array(mask.length).fill(1);
        for (const id of avoidedSpaceIds) {
          const cells = g.spaceCells.get(id);
          if (cells) for (const c of cells) weight[c] = AVOID_FACTOR;
        }
      }
      m = { key, mask, weight };
      this.masks.set(key, m);
    }
    return m;
  }

  field(floorId: string, m: MaskRef, src: number) {
    const key = m.key + '#' + src;
    let f = this.fields.get(key);
    if (!f) {
      if (this.fields.size > 400) this.fields.clear();
      f = dijkstra(this.grids.get(floorId)!, m.mask, src, m.weight);
      this.fields.set(key, f);
    }
    return f;
  }
}

/** Salida de una estancia: camino interior desde su centro hasta una celda libre del pasillo. */
export interface Exit {
  inner: Vec2[];
  len: number;
  cell: number;
}

export interface PlanNode {
  stop: Stop;
  /** Índice en `person.stops`; −1 = good lift añadido solo; −2 = parada de una rutina. */
  stopIndex: number;
  /** Estancia de la parada (para un elemento, una estancia ficticia con su nombre y posición). */
  space: Space;
  item?: Item;
  floorId: string;
  exits: Exit[];
  anchor: Vec2;
  /** Grupo de orden: −1 good lift inicial, 0 paradas manuales, 1… rondas de rutinas. */
  group: number;
  /** Segundo de simulación a partir del cual puede empezar (inicio de ronda). */
  notBefore?: number;
  /** Rutina y hora de la ronda, para los avisos. */
  roundLabel?: string;
}

export interface WalkSeg {
  kind: 'walk';
  floorId: string;
  pts: Vec2[];
  len: number;
}

export interface VerticalSeg {
  kind: 'vertical';
  fromFloor: string;
  toFloor: string;
  pos: Vec2;
  toPos: Vec2;
  seconds: number;
}

export type Seg = WalkSeg | VerticalSeg;

export type PlanEvent =
  | { kind: 'dwell'; t0: number; t1: number; floorId: string; pos: Vec2; node: number }
  | { kind: 'walk'; t0: number; t1: number; floorId: string; pts: Vec2[]; cum: number[]; len: number; to: number }
  | {
      kind: 'vertical';
      t0: number;
      t1: number;
      fromFloor: string;
      toFloor: string;
      pos: Vec2;
      toPos: Vec2;
      to: number;
      /** La persona pasa este tiempo en plantas que no están en el modelo. */
      away?: boolean;
    };

export interface PlanWarning {
  type: 'missing' | 'forbidden' | 'noAccess' | 'unreachable' | 'late';
  stopId: string;
  name: string;
}

export interface PersonPlan {
  person: Person;
  nodes: PlanNode[];
  /** Orden efectivo de visita (índices de `nodes`). */
  order: number[];
  legs: Seg[][];
  events: PlanEvent[];
  distance: number;
  walkTime: number;
  totalTime: number;
  endTime: number;
  originalDistance: number;
  optimizedDistance: number;
  warnings: PlanWarning[];
}

interface LegPart {
  type: 'walk' | 'vertical';
  floorId: string;
  a?: Exit;
  b?: Exit;
  from?: { floor: Floor; space: Space };
  to?: { floor: Floor; space: Space };
  seconds?: number;
}

interface Leg {
  cost: number;
  parts: LegPart[];
}

/** Ruta desde y hasta el good lift: por defecto, para el personal de limpieza. */
export const usesGoodLift = (p: Person) => p.goodLiftEnds ?? p.tags.includes('limpieza');

export function planPerson(
  router: Router,
  rules: AccessRule[],
  person: Person,
  startTime: number | null = null,
  routines: Routine[] = [],
): PersonPlan {
  const building = router.building;
  const floorById = new Map(building.floors.map((f) => [f.id, f]));

  const applies = (r: AccessRule, s: Space) => !!r.personTag && !!r.spaceTag && s.tags.includes(r.spaceTag);
  const forbidden = (s: Space) =>
    rules.some((r) => {
      if (r.mode === 'avoid' || !applies(r, s)) return false;
      const hasTag = person.tags.includes(r.personTag);
      return r.mode === 'only' ? !hasTag : hasTag;
    });
  // Zonas que se cruzan solo si no hay otra ruta (se penalizan, no se bloquean)
  const avoided = (s: Space) =>
    rules.some((r) => r.mode === 'avoid' && applies(r, s) && person.tags.includes(r.personTag));

  const maskCache = new Map<string, MaskRef>();
  const maskFor = (floor: Floor) => {
    let m = maskCache.get(floor.id);
    if (!m) {
      const open = floor.spaces.filter((s) => !isEnclosed(s.kind) && !isBlocking(s.kind));
      const blocked = open.filter(forbidden).map((s) => s.id);
      const avoid = open.filter((s) => !forbidden(s) && avoided(s)).map((s) => s.id);
      m = router.mask(floor.id, blocked, avoid);
      maskCache.set(floor.id, m);
    }
    return m;
  };

  const exitCache = new Map<string, Exit[]>();
  const exitsOf = (floor: Floor, s: Space): Exit[] => {
    const key = floor.id + '/' + s.id;
    const cached = exitCache.get(key);
    if (cached) return cached;
    const g = router.grids.get(floor.id)!;
    const { mask } = maskFor(floor);
    const out: Exit[] = [];
    if (isEnclosed(s.kind)) {
      const c = center(s);
      for (const d of s.doors) {
        const dp = doorPoint(s, d);
        const n = sideNormal(d.side);
        const inset = Math.min(0.5, (d.side === 'n' || d.side === 's' ? s.d : s.w) / 2);
        const inside = { x: dp.x - n.x * inset, z: dp.z - n.z * inset };
        const cell = nearestFree(g, mask, cellOf(g, { x: dp.x + n.x * 0.5, z: dp.z + n.z * 0.5 }), 6);
        if (cell < 0) continue;
        const inner = [c, inside, dp, cellCenter(g, cell)];
        out.push({ inner, len: polylineLength(inner), cell });
      }
    } else {
      const cell = nearestFree(g, mask, cellOf(g, center(s)), 40);
      if (cell >= 0) out.push({ inner: [cellCenter(g, cell)], len: 0, cell });
    }
    exitCache.set(key, out);
    return out;
  };

  // Salidas de un elemento: si está dentro de una sala o un aseo, se entra por su puerta hasta
  // el elemento; si está en zona abierta, se va a la celda libre más cercana.
  const itemExits = (floor: Floor, item: Item): Exit[] | 'forbidden' => {
    const pos = { x: item.x, z: item.z };
    const room = spaceContaining(floor, item);
    if (room && isEnclosed(room.kind)) {
      if (forbidden(room)) return 'forbidden';
      return exitsOf(floor, room).map((e) => {
        const inner = [pos, ...e.inner.slice(1)];
        return { inner, len: polylineLength(inner), cell: e.cell };
      });
    }
    const g = router.grids.get(floor.id)!;
    const cell = nearestFree(g, maskFor(floor).mask, cellOf(g, pos), 40);
    if (cell < 0) return [];
    const inner = [pos, cellCenter(g, cell)];
    return [{ inner, len: polylineLength(inner), cell }];
  };

  // 1. Paradas válidas: las manuales (grupo 0) y las de las rutinas asignadas (un grupo por ronda)
  const warnings: PlanWarning[] = [];
  let nodes: PlanNode[] = [];
  const addSpaceNode = (stop: Stop, stopIndex: number, group: number) => {
    const floor = floorById.get(stop.floorId);
    const space = floor?.spaces.find((s) => s.id === stop.spaceId);
    if (!floor || !space || isBlocking(space.kind)) {
      warnings.push({ type: 'missing', stopId: stop.id, name: space?.name ?? '?' });
      return null;
    }
    if (forbidden(space)) {
      warnings.push({ type: 'forbidden', stopId: stop.id, name: space.name });
      return null;
    }
    const exits = exitsOf(floor, space);
    if (!exits.length) {
      warnings.push({ type: 'noAccess', stopId: stop.id, name: space.name });
      return null;
    }
    const anchor = isEnclosed(space.kind) ? center(space) : exits[0].inner[0];
    const node: PlanNode = { stop, stopIndex, space, floorId: floor.id, exits, anchor, group };
    nodes.push(node);
    return node;
  };
  const addItemNode = (stop: Stop, item: Item, group: number) => {
    const floor = floorById.get(item.floorId);
    const label = itemLabel(building, item);
    if (!floor) {
      warnings.push({ type: 'missing', stopId: stop.id, name: label });
      return null;
    }
    const exits = itemExits(floor, item);
    if (exits === 'forbidden' || !exits.length) {
      warnings.push({ type: exits === 'forbidden' ? 'forbidden' : 'noAccess', stopId: stop.id, name: label });
      return null;
    }
    const r = itemRect(building, item);
    const space: Space = { id: item.id, name: label, kind: 'workspace', ...r, doors: [], tags: item.tags };
    const node: PlanNode = { stop, stopIndex: -2, space, item, floorId: floor.id, exits, anchor: { x: item.x, z: item.z }, group };
    nodes.push(node);
    return node;
  };

  person.stops.forEach((stop, stopIndex) => addSpaceNode(stop, stopIndex, 0));

  // Rutinas: primero las pasadas sin horario y después las rondas, por hora
  type RoundSpec = { routine: Routine; targets: RoutineTarget[]; time: number | null; clock: string };
  const rounds: RoundSpec[] = [];
  for (const a of person.routines ?? []) {
    const routine = routines.find((r) => r.id === a.routineId);
    if (!routine) continue;
    const all = routineTargets(building, routine);
    const targets = a.targets ? all.filter((t) => a.targets!.includes(targetKey(t))) : all;
    if (!targets.length) continue;
    const times = routine.rounds.map((c) => ({ c, s: parseClock(c) })).filter((x) => x.s !== null);
    if (!times.length || startTime === null) rounds.push({ routine, targets, time: null, clock: '' });
    else for (const { c, s } of times) rounds.push({ routine, targets, time: s! - startTime, clock: c });
  }
  rounds.sort((a, b) => (a.time ?? -Infinity) - (b.time ?? -Infinity));
  rounds.forEach((rd, gi) => {
    const routineSpaceDwell = (t: RoutineTarget) => {
      const sp = floorById.get(t.floorId)?.spaces.find((x) => x.id === t.spaceId);
      return sp ? spaceDwell(building, rd.routine, sp) : rd.routine.dwell;
    };
    for (const t of rd.targets) {
      const id = `${person.id}#${rd.routine.id}#${gi}#${targetKey(t)}`;
      const item = t.itemId ? building.items?.find((i) => i.id === t.itemId) : undefined;
      const stop: Stop = {
        id,
        floorId: item?.floorId ?? t.floorId,
        spaceId: t.spaceId ?? '',
        dwell: item ? itemDwell(building, item) : routineSpaceDwell(t),
      };
      const node = item ? addItemNode(stop, item, gi + 1) : addSpaceNode(stop, -2, gi + 1);
      if (node) {
        node.stopIndex = -2;
        node.roundLabel = rd.clock ? `${rd.routine.name} ${rd.clock}` : rd.routine.name;
        if (rd.time !== null) node.notBefore = Math.max(0, rd.time);
      }
    }
  });

  // 2. Coste de cada tramo
  const sameFloor = (floor: Floor, A: Exit[], B: Exit[]) => {
    const m = maskFor(floor);
    let best = { cost: Infinity, a: undefined as Exit | undefined, b: undefined as Exit | undefined };
    for (const a of A) {
      const f = router.field(floor.id, m, a.cell);
      for (const b of B) {
        const c = a.len + f[b.cell] + b.len;
        if (c < best.cost) best = { cost: c, a, b };
      }
    }
    return best;
  };

  const connectorsOf = (floor: Floor) => floor.spaces.filter((s) => isConnector(s.kind) && s.connectorId && !forbidden(s));

  const legCache = new Map<string, Leg>();
  const leg = (A: PlanNode, B: PlanNode): Leg => {
    const key = A.stop.id + '>' + B.stop.id;
    const cached = legCache.get(key);
    if (cached) return cached;
    let result: Leg = { cost: Infinity, parts: [] };
    const fa = floorById.get(A.floorId)!;
    const fb = floorById.get(B.floorId)!;
    if (A.floorId === B.floorId) {
      if (A.space.id === B.space.id) result = { cost: 0, parts: [] };
      else {
        const r = sameFloor(fa, A.exits, B.exits);
        if (r.a && r.b) result = { cost: r.cost, parts: [{ type: 'walk', floorId: fa.id, a: r.a, b: r.b }] };
      }
    } else {
      result = crossFloor(A, fa, B, fb);
    }
    legCache.set(key, result);
    return result;
  };

  /**
   * Ruta entre plantas encadenando ascensores/escaleras: Dijkstra sobre los conectores de
   * todas las plantas. Permite p. ej. good lift hasta el lobby, andar hasta el ascensor C y
   * bajar con él a la -2.
   */
  function crossFloor(A: PlanNode, fa: Floor, B: PlanNode, fb: Floor): Leg {
    const nodesC = building.floors.flatMap((floor) => connectorsOf(floor).map((space) => ({ floor, space })));
    const n = nodesC.length;
    const d = new Array<number>(n).fill(Infinity);
    const prev = new Array<{ from: number; part: LegPart } | null>(n).fill(null);
    const done = new Array<boolean>(n).fill(false);
    const walkPart = (floor: Floor, from: Exit[], to: Exit[]) => {
      const r = sameFloor(floor, from, to);
      return r.a && r.b ? { cost: r.cost, part: { type: 'walk', floorId: floor.id, a: r.a, b: r.b } as LegPart } : null;
    };

    // Inicio: de A a cada conector de su planta
    nodesC.forEach((c, i) => {
      if (c.floor.id !== fa.id) return;
      if (c.space.id === A.space.id) {
        d[i] = 0;
        return;
      }
      const w = walkPart(fa, A.exits, exitsOf(fa, c.space));
      if (w) {
        d[i] = w.cost;
        prev[i] = { from: -1, part: w.part };
      }
    });

    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && isFinite(d[i]) && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      const cu = nodesC[u];
      for (let v = 0; v < n; v++) {
        if (done[v] || v === u) continue;
        const cv = nodesC[v];
        let step: { cost: number; part: LegPart } | null = null;
        if (cv.floor.id !== cu.floor.id && cv.space.connectorId === cu.space.connectorId) {
          const levels = Math.abs(cu.floor.level - cv.floor.level) || 1;
          const seconds = cu.space.kind === 'lift' ? LIFT_BASE_S + LIFT_PER_LEVEL_S * levels : STAIRS_PER_LEVEL_S * levels;
          step = {
            // Un ascensor «a evitar» (p. ej. el good lift del otro lado) solo si no hay otro
            cost: seconds * REF_SPEED + (avoided(cu.space) || avoided(cv.space) ? AVOID_CONNECTOR : 0),
            part: { type: 'vertical', floorId: cu.floor.id, from: cu, to: cv, seconds },
          };
        } else if (cv.floor.id === cu.floor.id) {
          step = walkPart(cu.floor, exitsOf(cu.floor, cu.space), exitsOf(cv.floor, cv.space));
        }
        if (step && d[u] + step.cost < d[v]) {
          d[v] = d[u] + step.cost;
          prev[v] = { from: u, part: step.part };
        }
      }
    }

    // Final: del mejor conector de la planta de B hasta B
    let best: Leg = { cost: Infinity, parts: [] };
    nodesC.forEach((c, i) => {
      if (c.floor.id !== fb.id || !isFinite(d[i])) return;
      let cost = d[i];
      const tail: LegPart[] = [];
      if (c.space.id !== B.space.id) {
        const w = walkPart(fb, exitsOf(fb, c.space), B.exits);
        if (!w) return;
        cost += w.cost;
        tail.push(w.part);
      }
      if (cost >= best.cost) return;
      const parts: LegPart[] = [];
      for (let k = i; k >= 0 && prev[k]; k = prev[k]!.from) parts.unshift(prev[k]!.part);
      best = { cost, parts: [...parts, ...tail] };
    });
    return best;
  }

  // 2b. Los operarios salen del good lift y vuelven a él: si la primera o la última parada no
  // es un montacargas, se añade el más cercano de esa planta como parada de 0 s.
  const ret = person.returnToStart;
  let fixedEnd = false;
  if (usesGoodLift(person) && nodes.length) {
    const liftNode = (node: PlanNode, suffix: string): PlanNode | null => {
      const floor = floorById.get(node.floorId)!;
      const usable = floor.spaces.filter((s) => isGoodLift(s) && !forbidden(s));
      // El del lado del equipo; el otro, solo si no hay
      const own = usable.filter((s) => !avoided(s));
      const lifts = own.length ? own : usable;
      // Si la parada ya es un ascensor (el good lift o el de entrada a la planta), no se añade otro
      if (!lifts.length || node.space.kind === 'lift') return null;
      const lift = lifts.reduce((a, b) => (dist(center(a), node.anchor) <= dist(center(b), node.anchor) ? a : b));
      const exits = exitsOf(floor, lift);
      if (!exits.length) return null;
      return {
        stop: { id: person.id + suffix, floorId: floor.id, spaceId: lift.id, dwell: 0 },
        stopIndex: -1,
        space: lift,
        floorId: floor.id,
        exits,
        anchor: center(lift),
        group: suffix.endsWith("inicio") ? -1 : 1e9,
      };
    };
    const startLift = liftNode(nodes[0], '#good-lift-inicio');
    if (startLift) nodes.unshift(startLift);
    if (!ret) {
      const endLift = liftNode(nodes[nodes.length - 1], '#good-lift-fin');
      if (endLift) {
        nodes.push(endLift);
        fixedEnd = true;
      }
    }
  }

  // 3. Descarta las paradas a las que no se puede llegar desde el inicio
  if (nodes.length > 1) {
    const start = nodes[0];
    nodes = nodes.filter((n, i) => {
      if (i === 0 || isFinite(leg(start, n).cost)) return true;
      warnings.push({ type: 'unreachable', stopId: n.stop.id, name: n.space.name });
      return false;
    });
  }

  // 4. Orden de visita, grupo a grupo: el good lift inicial, las paradas manuales (en su
  // orden o el más corto) y cada ronda de rutina en su orden más corto, empezando donde
  // terminó la anterior. El good lift final, si lo hay, se queda siempre al final.
  if (fixedEnd && nodes[nodes.length - 1]?.stopIndex !== -1) fixedEnd = false;
  const n = nodes.length;
  const identity = [...Array(n).keys()];
  const groupedOrder = (optimizeManual: boolean) => {
    if (!n) return [];
    const order = [0];
    const placed = new Set([0]);
    const groups = [...new Set(nodes.map((x) => x.group))].sort((a, b) => a - b);
    for (const g of groups) {
      const members = identity.filter((i) => !placed.has(i) && nodes[i].group === g);
      if (!members.length) continue;
      if ((g === 0 && !optimizeManual) || g >= 1e9 || members.length === 1) order.push(...members);
      else {
        const sub = [order[order.length - 1], ...members];
        const m = sub.map((i) => sub.map((j) => (i === j ? 0 : leg(nodes[i], nodes[j]).cost)));
        order.push(...solveTsp(m, false).slice(1).map((k) => sub[k]));
      }
      members.forEach((i) => placed.add(i));
    }
    return order;
  };
  const optOrder = groupedOrder(true);
  const order = groupedOrder(person.optimize);

  // 5. Geometría de los tramos
  const geomCache = new Map<string, Seg[]>();
  const legGeometry = (A: PlanNode, B: PlanNode): Seg[] => {
    const key = A.stop.id + '>' + B.stop.id;
    const cached = geomCache.get(key);
    if (cached) return cached;
    const segs: Seg[] = [];
    for (const part of leg(A, B).parts) {
      if (part.type === 'walk' && part.a && part.b) {
        const floor = floorById.get(part.floorId)!;
        const g = router.grids.get(floor.id)!;
        const m = maskFor(floor);
        const field = router.field(floor.id, m, part.a.cell);
        const cells = tracePath(g, m.mask, field, part.b.cell, m.weight);
        const grid = smoothPath(g, m.mask, cellsToPoints(g, cells), m.weight);
        const raw = [...part.a.inner.slice(0, -1), ...grid, ...[...part.b.inner].reverse().slice(1)];
        const pts = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]) > 1e-3);
        segs.push({ kind: 'walk', floorId: floor.id, pts, len: polylineLength(pts) });
      } else if (part.type === 'vertical' && part.from && part.to) {
        segs.push({
          kind: 'vertical',
          fromFloor: part.from.floor.id,
          toFloor: part.to.floor.id,
          pos: center(part.from.space),
          toPos: center(part.to.space),
          seconds: part.seconds ?? 0,
        });
      }
    }
    geomCache.set(key, segs);
    return segs;
  };

  const legsFor = (ord: number[]) => {
    const out: Seg[][] = [];
    for (let i = 1; i < ord.length; i++) out.push(legGeometry(nodes[ord[i - 1]], nodes[ord[i]]));
    if (ret && ord.length > 1) out.push(legGeometry(nodes[ord[ord.length - 1]], nodes[ord[0]]));
    return out;
  };
  const walkLength = (legs: Seg[][]) =>
    legs.flat().reduce((acc, s) => acc + (s.kind === 'walk' ? s.len : 0), 0);

  const legs = legsFor(order);
  const distance = walkLength(legs);
  const sameOrder = order.every((v, i) => v === optOrder[i]);
  const originalDistance = order.every((v, i) => v === i) ? distance : walkLength(legsFor(identity));
  const optimizedDistance = sameOrder ? distance : n > 2 ? walkLength(legsFor(optOrder)) : distance;

  // 6. Línea temporal
  const speed = Math.max(0.2, person.speed || 1.3);
  const events: PlanEvent[] = [];
  // Cada ronda de rutina empieza a su hora: la primera parada de la ronda no empieza antes.
  const roundStart = new Map<number, number>();
  const seenGroups = new Set<number>();
  for (const k of order) {
    const nd = nodes[k];
    if (nd.notBefore != null && !seenGroups.has(nd.group)) roundStart.set(k, nd.notBefore);
    seenGroups.add(nd.group);
  }
  // Con «respetar horas reales», cada parada no empieza antes de su hora registrada.
  const realStartOf = (k: number) => {
    if (roundStart.has(k)) return roundStart.get(k)!;
    if (!person.holdUntilReal || startTime == null) return null;
    const c = parseClock(nodes[k].stop.real?.start);
    return c == null ? null : c - startTime;
  };
  let t = Math.max(0, person.startDelay || 0);
  if (order.length) t = Math.max(t, realStartOf(order[0]) ?? 0);
  const startT = t;
  const dwellAt = (k: number, dur: number) => {
    const node = nodes[k];
    // Ronda que empieza más de un minuto tarde (la anterior no ha terminado a tiempo)
    const due = roundStart.get(k);
    if (due != null && t > due + 60 && startTime != null)
      warnings.push({
        type: 'late',
        stopId: node.stop.id,
        name: `${node.roundLabel ?? ''} → ${fmtClockShort(startTime + t)}`,
      });
    events.push({ kind: 'dwell', t0: t, t1: t + dur, floorId: node.floorId, pos: node.anchor, node: k });
    t += dur;
  };
  if (order.length) {
    dwellAt(order[0], Math.max(0, nodes[order[0]].stop.dwell));
    legs.forEach((segs, i) => {
      const from = order[i];
      const to = i + 1 < order.length ? order[i + 1] : order[0];
      // Tiempo de espera hasta la hora real de la siguiente parada. Si el tramo cambia de
      // planta, la espera se pasa «en otras plantas»; si no, en la parada de origen.
      const legTime = segs.reduce((acc, s) => acc + (s.kind === 'walk' ? s.len / speed : s.seconds), 0);
      const target = i + 1 < order.length ? realStartOf(to) : null;
      let slack = target == null ? 0 : Math.max(0, target - (t + legTime));
      // Entre rondas se espera en la última parada; «en otras plantas» solo para el registro real
      if (slack > 0 && (roundStart.has(to) || !segs.some((s) => s.kind === 'vertical'))) {
        dwellAt(from, slack);
        slack = 0;
      }
      for (const s of segs) {
        if (s.kind === 'walk') {
          const cum = [0];
          for (let j = 1; j < s.pts.length; j++) cum.push(cum[j - 1] + dist(s.pts[j - 1], s.pts[j]));
          const dur = s.len / speed;
          events.push({ kind: 'walk', t0: t, t1: t + dur, floorId: s.floorId, pts: s.pts, cum, len: s.len, to });
          t += dur;
        } else {
          const extra = slack;
          slack = 0;
          events.push({
            kind: 'vertical',
            t0: t,
            t1: t + s.seconds + extra,
            fromFloor: s.fromFloor,
            toFloor: s.toFloor,
            pos: s.pos,
            toPos: s.toPos,
            to,
            away: extra > 0,
          });
          t += s.seconds + extra;
        }
      }
      if (i + 1 < order.length) dwellAt(order[i + 1], Math.max(0, nodes[order[i + 1]].stop.dwell));
    });
  }

  return {
    person,
    nodes,
    order,
    legs,
    events,
    distance,
    walkTime: distance / speed,
    totalTime: t - startT,
    endTime: t,
    originalDistance,
    optimizedDistance,
    // Sin repetir el mismo aviso en cada ronda
    warnings: warnings.filter((w, i) => warnings.findIndex((x) => x.type === w.type && x.name === w.name) === i),
  };
}

export interface PlanSample {
  floorId: string;
  pos: Vec2;
  state: 'idle' | 'dwell' | 'walk' | 'vertical' | 'away' | 'done';
  node: number;
}

/** Posición y estado de una persona en el instante `t`. */
export function samplePlan(plan: PersonPlan, t: number): PlanSample | null {
  const { nodes, events, order } = plan;
  if (!nodes.length || !order.length) return null;
  const first = nodes[order[0]];
  if (!events.length || t < events[0].t0) return { floorId: first.floorId, pos: first.anchor, state: 'idle', node: order[0] };

  for (const e of events) {
    if (t > e.t1) continue;
    if (e.kind === 'dwell') return { floorId: e.floorId, pos: e.pos, state: 'dwell', node: e.node };
    if (e.kind === 'vertical') {
      // Fuera del modelo: no se dibuja en ninguna planta
      if (e.away) return { floorId: '', pos: e.toPos, state: 'away', node: e.to };
      const half = (e.t0 + e.t1) / 2;
      return t < half
        ? { floorId: e.fromFloor, pos: e.pos, state: 'vertical', node: e.to }
        : { floorId: e.toFloor, pos: e.toPos, state: 'vertical', node: e.to };
    }
    const span = e.t1 - e.t0;
    const s = span > 0 ? ((t - e.t0) / span) * e.len : e.len;
    let i = 1;
    while (i < e.cum.length - 1 && e.cum[i] < s) i++;
    const seg = e.cum[i] - e.cum[i - 1];
    const k = seg > 0 ? (s - e.cum[i - 1]) / seg : 1;
    return { floorId: e.floorId, pos: lerp(e.pts[i - 1], e.pts[i], Math.max(0, Math.min(1, k))), state: 'walk', node: e.to };
  }

  const last = events[events.length - 1];
  if (last.kind === 'dwell') return { floorId: last.floorId, pos: last.pos, state: 'done', node: last.node };
  if (last.kind === 'vertical') return { floorId: last.toFloor, pos: last.toPos, state: 'done', node: last.to };
  return { floorId: last.floorId, pos: last.pts[last.pts.length - 1], state: 'done', node: last.to };
}
