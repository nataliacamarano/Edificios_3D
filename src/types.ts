// Coordenadas en metros. El plano usa X hacia la derecha y Z hacia abajo (sur de la foto).
export interface Vec2 {
  x: number;
  z: number;
}

export type Lang = 'es' | 'en';

export type SpaceKind =
  | 'meeting'
  | 'room'
  | 'workspace'
  | 'restroom'
  | 'kitchen'
  | 'printer'
  | 'stationery'
  | 'lift'
  | 'stairs'
  | 'lobby'
  | 'void'
  | 'obstacle';

export type Side = 'n' | 's' | 'e' | 'w';

export interface Door {
  id: string;
  side: Side;
  /** Posición del centro de la puerta a lo largo del lado, de 0 a 1. */
  offset: number;
  width: number;
}

export interface Space {
  id: string;
  name: string;
  /** Nombre en inglés escrito a mano; si falta, se traduce automáticamente. */
  nameEn?: string;
  kind: SpaceKind;
  x: number;
  z: number;
  w: number;
  d: number;
  doors: Door[];
  tags: string[];
  color?: string;
  /** Ascensores/escaleras con el mismo connectorId en distintas plantas están conectados. */
  connectorId?: string;
  /** Sanitarios reales del aseo o vestuario (cabinas, urinarios, lavabos, duchas…). */
  fixtures?: Fixture[];
  /** Escalera de diseño abierta (sin paredes), dibujada con su forma real: 'y-stair' = en Y. */
  design?: 'y-stair';
  /** Creada con «Detectar zonas por color»: borrador que se corrige o se quita de golpe. */
  detected?: boolean;
}

/** Sanitarios y piezas de un aseo o vestuario; cuentan para el tiempo de limpieza. */
export type FixtureKind = 'wc' | 'urinal' | 'sink' | 'shower' | 'dressing' | 'bench' | 'locker';

export interface Fixture {
  kind: FixtureKind;
  /** Esquina y tamaño, en metros. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Pared contra la que está la pieza. */
  back?: Side;
  /** Lado de la puerta de la cabina (si la tiene). */
  door?: Side;
  /** Piezas seguidas (lavabos de una encimera, urinarios de una fila). */
  count?: number;
}

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  /** Sacado de la foto con «Detectar paredes»: un borrador que se corrige o se quita de golpe. */
  detected?: boolean;
}

export interface Background {
  src: string;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Giro de la imagen dentro de su rectángulo, en grados (0 o 180). */
  rotation?: number;
}

/** Hacia dónde queda el norte en el plano: +x derecha, −x izquierda, −z arriba, +z abajo. */
export type NorthDir = '+x' | '-x' | '+z' | '-z';

/**
 * Mobiliario de las zonas abiertas: se dibuja en 2D y 3D y bloquea el paso.
 * - desk: bloque de puestos de trabajo · table: mesas sueltas (comedor, zona social)
 * - sofa: sofás y asientos · counter: barras, mostradores, encimeras, recepción
 * - storage: taquillas, armarios, estanterías · plant: jardineras
 * - equipment: máquinas (gimnasio, vending), aparcabicis y otros equipos
 */
export type FurnitureKind = 'desk' | 'table' | 'sofa' | 'counter' | 'storage' | 'plant' | 'equipment';

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  w: number;
  d: number;
  label?: string;
}

export interface Floor {
  id: string;
  name: string;
  nameEn?: string;
  level: number;
  northDir?: NorthDir;
  outline: Vec2[];
  walls: Wall[];
  spaces: Space[];
  furniture?: Furniture[];
  background?: Background;
  /** Datos ya pasados por la corrección de perspectiva de la foto. */
  rectified?: boolean;
  /** Pasos del Constructor de planta marcados como hechos a mano (los demás se comprueban solos). */
  builderDone?: string[];
}

/**
 * Tipo de elemento colocable: papelera, dispensador, phone nook… `bin` se dibuja como un
 * cilindro pequeño que no estorba; `box` es un mueble (nook, pod, cuarto) que bloquea el paso.
 */
export interface ItemType {
  id: string;
  name: string;
  icon: string;
  color: string;
  shape: 'bin' | 'box';
  /** Ancho y fondo por defecto, en metros. */
  w: number;
  d: number;
  /** Segundos de trabajo en cada elemento de este tipo (vaciar, reponer, limpiar…). */
  dwell: number;
}

/** Elemento colocado en una planta. Se puede mover dentro de la planta o a otra. */
export interface Item {
  id: string;
  typeId: string;
  floorId: string;
  /** Centro del elemento, en metros. */
  x: number;
  z: number;
  name?: string;
  /** Tamaño propio (si no, el del tipo). */
  w?: number;
  d?: number;
  /** Segundos de trabajo propios (si no, los del tipo). */
  dwell?: number;
  tags: string[];
}

/** Segundos de limpieza de un aseo: un fijo por aseo más lo de cada sanitario. */
export type FixtureTimes = { base: number } & Record<FixtureKind, number>;

export interface Building {
  floors: Floor[];
  itemTypes?: ItemType[];
  items?: Item[];
  fixtureTimes?: FixtureTimes;
  /**
   * Amueblar solas las salas (mesas en reuniones, cocinas, camillas, sanitarios de aseos sin
   * calcar). Sin valor: sí. Con false solo se ven los muebles colocados a mano.
   */
  autoFurnish?: boolean;
}

/**
 * Criterio automático de una rutina: todas las estancias de ciertos tipos o etiquetas, o todos
 * los elementos de ciertos tipos, en las plantas elegidas. Se recalcula al mover o añadir.
 */
export type RoutineFilter =
  | { kind: 'spaces'; spaceKinds: SpaceKind[]; tags: string[] }
  | { kind: 'items'; typeIds: string[] };

/** Parada concreta de una rutina: una estancia o un elemento. */
export interface RoutineTarget {
  floorId: string;
  spaceId?: string;
  itemId?: string;
}

export interface Routine {
  id: string;
  name: string;
  color: string;
  filters: RoutineFilter[];
  /** Paradas añadidas a mano, además de las de los criterios. */
  extra: RoutineTarget[];
  /** Plantas en las que se aplica; vacío = todas. */
  floorIds: string[];
  /** Segundos de trabajo por estancia (los elementos usan los de su tipo). */
  dwell: number;
  /** En aseos con sanitarios calcados, el tiempo sale de ellos en vez de `dwell` (por defecto, sí). */
  byFixtures?: boolean;
  /** Hora de inicio de cada ronda ("10:00"); vacío = una pasada sin horario. */
  rounds: string[];
}

/** Rutina asignada a una persona; `targets` limita las paradas cuando la rutina se reparte. */
export interface RoutineAssignment {
  routineId: string;
  targets?: string[];
}

/** Horas registradas en la realidad ("hh:mm"), para compararlas con la simulación. */
export interface RealTimes {
  start?: string;
  end?: string;
}

export interface Stop {
  id: string;
  floorId: string;
  spaceId: string;
  /** Segundos que la persona permanece en la estancia. */
  dwell: number;
  real?: RealTimes;
}

export interface Person {
  id: string;
  name: string;
  color: string;
  tags: string[];
  /** Velocidad al caminar en m/s. */
  speed: number;
  /** Segundos de simulación en los que la persona empieza su recorrido. */
  startDelay: number;
  optimize: boolean;
  returnToStart: boolean;
  stops: Stop[];
  /** Inicio y fin reales de todo el recorrido. */
  real?: RealTimes;
  /** Ninguna parada empieza antes de su hora real (útil si faltan plantas en el modelo). */
  holdUntilReal?: boolean;
  /** La ruta sale del good lift y termina en él. Por defecto, sí para quien tenga la etiqueta «limpieza». */
  goodLiftEnds?: boolean;
  /** Rutinas asignadas: sus paradas se añaden al itinerario en el orden más corto. */
  routines?: RoutineAssignment[];
}

/**
 * - `deny` (por defecto): las personas con `personTag` no pueden entrar en estancias con `spaceTag`.
 * - `only`: las estancias con `spaceTag` solo las pueden usar las personas con `personTag`.
 * - `avoid`: las personas con `personTag` solo cruzan zonas con `spaceTag` si no hay otra ruta.
 */
export interface AccessRule {
  id: string;
  personTag: string;
  spaceTag: string;
  mode?: 'deny' | 'only' | 'avoid';
}

export interface ProjectData {
  version: 1;
  building: Building;
  persons: Person[];
  rules: AccessRule[];
  /** Hora del día (segundos desde medianoche) que corresponde al segundo 0 de la simulación. */
  startTime?: number | null;
  /** Emparejamiento de zonas del registro de limpieza con estancias («planta|zona» → id de estancia). */
  areaMap?: Record<string, string>;
  routines?: Routine[];
  /** Nombre del edificio (en los archivos exportados desde la lista de edificios). */
  name?: string;
}
