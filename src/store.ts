import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { autoDoors, type AutoDoorsResult } from './autoDoors';
import { connectFloors, type ConnectResult } from './connectorDetect';
import type { NameProposal } from './planText';
import { deleteBuildingData, loadBuildingData, saveBuildingData } from './buildingLibrary';
import { LOCAL } from './data/localData';
import { defaultRules, PERSON_COLORS, SIDE_RULES, STAIRS_RULE } from './data/rules';
import { createBuilding, createSeed, exampleData, INITIAL_LIBRARY } from './data/seed';
import { uid } from './geometry';
import { DEFAULT_FIXTURE_TIMES, defaultItemTypes, defaultRoutines } from './routines';
import type {
  AccessRule,
  Building,
  FixtureTimes,
  Floor,
  Furniture,
  FurnitureKind,
  Item,
  ItemType,
  Lang,
  NorthDir,
  Person,
  ProjectData,
  Routine,
  Space,
  SpaceKind,
  Stop,
  Vec2,
  Wall,
} from './types';

export type Tool = 'select' | 'pan' | 'rectify' | 'room' | 'wall' | 'door' | 'outline' | 'delete' | 'calibrate' | 'item' | 'furniture';
export type Tab = 'builder' | 'people' | 'routines' | 'spaces' | 'rules' | 'data';

export interface Selection {
  type: 'space' | 'wall' | 'item' | 'furniture';
  floorId: string;
  id: string;
}

export interface UiState {
  lang: Lang;
  activeFloorId: string;
  view: '3d' | '2d';
  tab: Tab;
  sidebarOpen: boolean;
  showLabels: boolean;
  showRoutes: boolean;
  /** Capa de mobiliario (muebles y sanitarios); sin ella se ve solo la estructura. */
  showFurniture: boolean;
  showPhoto: boolean;
  photoOpacity: number;
  wallHeight: number;
  selection: Selection | null;
  /** Persona a cuyo itinerario se añaden las estancias pulsadas en el mapa. */
  pickPersonId: string | null;
  expandedPersonId: string | null;
  tool: Tool;
  newKind: SpaceKind;
  /** Tipo de elemento que coloca la herramienta «Elemento». */
  newItemType: string;
  /** Tipo de mueble que coloca la herramienta «Mueble». */
  newFurnitureKind: FurnitureKind;
  snap: boolean;
  /** Guardar solo en el archivo de proyecto compartido cuando cambian los datos. */
  autoSave: boolean;
}

/** Edificio de la biblioteca: el activo está en el estado; los demás, en la base de datos local. */
export interface BuildingEntry {
  id: string;
  name: string;
}

/** Copia completa de la app: todos los edificios de este equipo, con todos sus datos. */
export interface AppBackup {
  kind: 'modelo-planta-copia';
  version: 1;
  activeBuildingId: string;
  buildings: (BuildingEntry & { data: ProjectData })[];
}

export function isAppBackup(d: unknown): d is AppBackup {
  const o = d as AppBackup;
  return !!o && o.kind === 'modelo-planta-copia' && Array.isArray(o.buildings) && o.buildings.length > 0 && o.buildings.every((b) => isProjectData(b.data));
}

interface StoreState {
  /** Edificios de este equipo y cuál está abierto. */
  library: BuildingEntry[];
  activeBuildingId: string;
  building: Building;
  persons: Person[];
  rules: AccessRule[];
  /** Hora del día del segundo 0 de la simulación (segundos desde medianoche), o null. */
  startTime: number | null;
  areaMap: Record<string, string>;
  routines: Routine[];
  ui: UiState;
  past: Building[];
  future: Building[];

  setUi(patch: Partial<UiState>): void;
  setStartTime(t: number | null): void;
  /** Aplica una importación del registro: personas nuevas o reemplazadas y emparejamiento de zonas. */
  applyImport(persons: Person[], areaMap: Record<string, string>, earliest: number | null): void;
  select(sel: Selection | null): void;

  snapshot(): void;
  undo(): void;
  redo(): void;

  updateSpace(floorId: string, id: string, patch: Partial<Space>, silent?: boolean): void;
  addSpace(floorId: string, space: Space): string;
  deleteSpace(floorId: string, id: string): void;
  addWall(floorId: string, wall: Wall): void;
  updateWall(floorId: string, id: string, patch: Partial<Wall>, silent?: boolean): void;
  deleteWall(floorId: string, id: string): void;
  /** Sustituye las paredes detectadas de la foto por estas (vacío: las quita). */
  setDetectedWalls(floorId: string, walls: Wall[]): void;
  /**
   * Sustituye las estancias detectadas por estas (vacío: las quita). Con `kinds`, solo se
   * sustituyen las detectadas de esos tipos (p. ej. ascensores y escaleras).
   */
  setDetectedSpaces(floorId: string, spaces: Space[], kinds?: SpaceKind[]): void;
  /** Pone a las salas los nombres leídos del plano (y el tipo o las etiquetas que el texto indica). */
  applyNames(floorId: string, names: NameProposal[]): void;
  /** Une entre plantas los ascensores y escaleras que están en el mismo sitio. */
  connectAllFloors(): ConnectResult;
  /** Pone puerta a las estancias cerradas que no tienen ninguna (ver autoDoors). */
  addMissingDoors(floorId: string): AutoDoorsResult;
  addFurniture(floorId: string, f: Furniture): void;
  setFixtureTimes(patch: Partial<FixtureTimes>): void;
  setAutoFurnish(on: boolean): void;
  updateFurniture(floorId: string, id: string, patch: Partial<Furniture>, silent?: boolean): void;
  deleteFurniture(floorId: string, id: string): void;

  addItem(item: Item): void;
  updateItem(id: string, patch: Partial<Item>, silent?: boolean): void;
  deleteItem(id: string): void;
  addItemType(t: ItemType): void;
  updateItemType(id: string, patch: Partial<ItemType>): void;
  deleteItemType(id: string): void;

  addRoutine(): string;
  updateRoutine(id: string, patch: Partial<Routine>): void;
  deleteRoutine(id: string): void;
  setOutline(floorId: string, outline: Vec2[], silent?: boolean): void;
  /** Escala toda la planta (foto, contorno, muros y estancias) desde el origen. */
  scaleFloor(floorId: string, k: number): void;
  addFloor(mode: 'empty' | 'copy'): void;
  updateFloor(id: string, patch: Partial<Pick<Floor, 'name' | 'nameEn' | 'level' | 'northDir' | 'background' | 'outline' | 'builderDone'>>): void;
  deleteFloor(id: string): void;

  addPerson(): void;
  updatePerson(id: string, patch: Partial<Person>): void;
  deletePerson(id: string): void;
  addStop(personId: string, floorId: string, spaceId: string): void;
  updateStop(personId: string, stopId: string, patch: Partial<Stop>): void;
  moveStop(personId: string, stopId: string, dir: -1 | 1): void;
  removeStop(personId: string, stopId: string): void;

  addRule(): void;
  updateRule(id: string, patch: Partial<AccessRule>): void;
  removeRule(id: string): void;

  importData(data: ProjectData): void;
  resetPlan(): void;
  resetAll(): void;

  /** Guarda el edificio actual y abre uno nuevo en blanco (una planta vacía, sin personas). */
  newBlankBuilding(name: string): Promise<void>;
  /** Añade un edificio a la biblioteca con estos datos (p. ej. importado de un archivo) y lo abre. */
  addBuilding(name: string, data: ProjectData): Promise<void>;
  /** Sustituye todos los edificios de este equipo por los de una copia completa de la app. */
  restoreBackup(backup: AppBackup): Promise<void>;
  /** Guarda el edificio actual y abre otro de la biblioteca. */
  switchBuilding(id: string): Promise<void>;
  renameBuilding(id: string, name: string): void;
  /** Borra un edificio que no está abierto. */
  deleteBuilding(id: string): Promise<void>;
}

/** Datos del edificio abierto, para guardarlo en la biblioteca o en un archivo. */
export function projectDataOf(st: Pick<StoreState, 'building' | 'persons' | 'rules' | 'startTime' | 'areaMap' | 'routines'>): ProjectData {
  return {
    version: 1,
    building: st.building,
    persons: st.persons,
    rules: st.rules,
    startTime: st.startTime,
    areaMap: st.areaMap,
    routines: st.routines,
  };
}

/** Edificio en blanco: una planta vacía de 40 × 25 m, las reglas y rutinas de partida, sin personas. */
function blankProject(): ProjectData {
  const floor: Floor = {
    id: uid('floor-'),
    name: 'Planta 0',
    level: 0,
    outline: [
      { x: 0, z: 0 },
      { x: 40, z: 0 },
      { x: 40, z: 25 },
      { x: 0, z: 25 },
    ],
    walls: [],
    spaces: [],
    furniture: [],
  };
  return {
    version: 1,
    // Los muebles los coloca quien dibuja el edificio
    building: { floors: [floor], itemTypes: defaultItemTypes(), items: [], autoFurnish: false },
    persons: [],
    rules: defaultRules(),
    startTime: null,
    areaMap: {},
    routines: defaultRoutines(),
  };
}


const seed = createSeed();

const defaultUi: UiState = {
  lang: 'es',
  activeFloorId: seed.building.floors[0].id,
  view: '3d',
  tab: 'people',
  sidebarOpen: true,
  showLabels: true,
  showRoutes: true,
  showFurniture: true,
  showPhoto: false,
  photoOpacity: 0.55,
  wallHeight: 2.4,
  selection: null,
  pickPersonId: null,
  expandedPersonId: seed.persons[0]?.id ?? null,
  tool: 'select',
  newKind: 'meeting',
  newItemType: 't-papelera',
  newFurnitureKind: 'desk',
  snap: true,
  autoSave: true,
};

const mapFloor = (b: Building, floorId: string, fn: (f: Floor) => Floor): Building => ({
  ...b,
  floors: b.floors.map((f) => (f.id === floorId ? fn(f) : f)),
});

/** v39: todas las escaleras llevan la etiqueta «escalera» (el carro de limpieza no las usa). */
const tagStairs = (f: Floor): Floor => ({
  ...f,
  spaces: f.spaces.map((s) => (s.kind === 'stairs' && !s.tags.includes('escalera') ? { ...s, tags: [...s.tags, 'escalera'] } : s)),
});

/** Pone al día un edificio guardado o importado de una versión anterior (con los datos locales, también sus plantas). */
const upgradeBuilding = (b: Building): Building =>
  LOCAL ? LOCAL.upgradeBuilding(b) : { ...b, floors: b.floors.map(tagStairs) };

/** v39–v40: reglas nuevas (el carro no usa escaleras; cada equipo, su good lift) en reglas guardadas o importadas. */
const withStairsRule = (rules: AccessRule[]) =>
  [STAIRS_RULE, ...SIDE_RULES].reduce((acc, rule) => (acc.some((r) => r.id === rule.id) ? acc : [...acc, rule]), rules);

function cloneFloor(f: Floor, level: number, name: string, withSpaces: boolean): Floor {
  const id = uid('floor-');
  return {
    id,
    name,
    level,
    northDir: f.northDir,
    outline: f.outline.map((p) => ({ ...p })),
    walls: withSpaces ? f.walls.map((w) => ({ id: uid('w'), a: { ...w.a }, b: { ...w.b } })) : [],
    spaces: withSpaces
      ? f.spaces.map((s) => ({
          ...s,
          id: uid('s'),
          tags: [...s.tags],
          doors: s.doors.map((d) => ({ ...d, id: uid('d') })),
        }))
      : [],
    furniture: withSpaces ? (f.furniture ?? []).map((m) => ({ ...m, id: uid('m') })) : [],
    background: withSpaces ? f.background : undefined,
  };
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const commit = (fn: (b: Building) => Building, silent = false) =>
        set((st) => ({
          building: fn(st.building),
          past: silent ? st.past : [...st.past.slice(-59), st.building],
          future: silent ? st.future : [],
        }));

      const mapPerson = (id: string, fn: (p: Person) => Person) =>
        set((st) => ({ persons: st.persons.map((p) => (p.id === id ? fn(p) : p)) }));

      return {
        library: INITIAL_LIBRARY,
        activeBuildingId: INITIAL_LIBRARY[0].id,
        building: seed.building,
        persons: seed.persons,
        rules: seed.rules,
        startTime: seed.startTime ?? null,
        areaMap: {},
        routines: seed.routines ?? [],
        ui: defaultUi,
        past: [],
        future: [],

        setUi: (patch) => set((st) => ({ ui: { ...st.ui, ...patch } })),
        setStartTime: (startTime) => set({ startTime }),
        applyImport: (imported, areaMap, earliest) =>
          set((st) => {
            // Si el registro empieza antes que la simulación, se adelanta el inicio y las demás
            // personas conservan su hora del día (su retraso de salida crece lo mismo).
            let startTime = st.startTime;
            let shift = 0;
            if (earliest !== null && (startTime === null || earliest < startTime)) {
              shift = startTime === null ? 0 : startTime - earliest;
              startTime = earliest;
            }
            const byId = new Map(imported.map((p) => [p.id, p]));
            const updated = st.persons.map((p) => byId.get(p.id) ?? { ...p, startDelay: (p.startDelay || 0) + shift });
            const added = imported.filter((p) => !st.persons.some((q) => q.id === p.id));
            return {
              persons: [...updated, ...added],
              areaMap: { ...st.areaMap, ...areaMap },
              startTime,
            };
          }),
        select: (selection) =>
          set((st) => ({
            ui: {
              ...st.ui,
              selection,
              tab: selection && !st.ui.pickPersonId ? 'spaces' : st.ui.tab,
              sidebarOpen: selection && !st.ui.pickPersonId ? true : st.ui.sidebarOpen,
              activeFloorId: selection?.floorId ?? st.ui.activeFloorId,
            },
          })),

        snapshot: () => set((st) => ({ past: [...st.past.slice(-59), st.building], future: [] })),
        undo: () =>
          set((st) =>
            st.past.length
              ? { building: st.past[st.past.length - 1], past: st.past.slice(0, -1), future: [st.building, ...st.future] }
              : {},
          ),
        redo: () =>
          set((st) =>
            st.future.length ? { building: st.future[0], future: st.future.slice(1), past: [...st.past, st.building] } : {},
          ),

        updateSpace: (floorId, id, patch, silent) =>
          commit(
            (b) =>
              mapFloor(b, floorId, (f) => ({
                ...f,
                spaces: f.spaces.map((s) => {
                  if (s.id !== id) return s;
                  // Los sanitarios se mueven con su aseo
                  const dx = patch.x !== undefined ? patch.x - s.x : 0;
                  const dz = patch.z !== undefined ? patch.z - s.z : 0;
                  const fixtures =
                    s.fixtures && !patch.fixtures && (dx || dz)
                      ? s.fixtures.map((fx) => ({ ...fx, x: +(fx.x + dx).toFixed(3), z: +(fx.z + dz).toFixed(3) }))
                      : undefined;
                  // Una zona detectada que se toca pasa a ser definitiva (volver a detectar no la quita)
                  return { ...s, ...patch, ...(fixtures ? { fixtures } : {}), detected: undefined };
                }),
              })),
            silent,
          ),
        addSpace: (floorId, space) => {
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, spaces: [...f.spaces, space] })));
          return space.id;
        },
        deleteSpace: (floorId, id) => {
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, spaces: f.spaces.filter((s) => s.id !== id) })));
          set((st) => ({
            persons: st.persons.map((p) => ({ ...p, stops: p.stops.filter((s) => s.spaceId !== id) })),
            ui: st.ui.selection?.id === id ? { ...st.ui, selection: null } : st.ui,
          }));
        },
        addWall: (floorId, wall) => commit((b) => mapFloor(b, floorId, (f) => ({ ...f, walls: [...f.walls, wall] }))),
        updateWall: (floorId, id, patch, silent) =>
          commit(
            // Un muro detectado que se corrige a mano pasa a ser definitivo (volver a detectar no lo quita)
            (b) =>
              mapFloor(b, floorId, (f) => ({
                ...f,
                walls: f.walls.map((w) => (w.id === id ? { ...w, ...patch, detected: undefined } : w)),
              })),
            silent,
          ),
        setDetectedWalls: (floorId, walls) =>
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, walls: [...f.walls.filter((w) => !w.detected), ...walls] }))),
        addMissingDoors: (floorId) => {
          const floor = get().building.floors.find((f) => f.id === floorId)!;
          const res = autoDoors(floor);
          if (res.added) commit((b) => mapFloor(b, floorId, (f) => ({ ...f, spaces: res.spaces, walls: res.walls })));
          return res;
        },
        applyNames: (floorId, names) =>
          commit((b) =>
            mapFloor(b, floorId, (f) => ({
              ...f,
              spaces: f.spaces.map((s) => {
                const n = names.find((x) => x.spaceId === s.id);
                if (!n) return s;
                return { ...s, name: n.text, kind: n.kind ?? s.kind, tags: [...s.tags, ...n.tags.filter((t) => !s.tags.includes(t))] };
              }),
            })),
          ),
        connectAllFloors: () => {
          const res = connectFloors(get().building.floors);
          if (res.linked || res.groups) commit((b) => ({ ...b, floors: res.floors }));
          return res;
        },
        setDetectedSpaces: (floorId, spaces, kinds) => {
          const replaced = (s: Space) => s.detected && (!kinds || kinds.includes(s.kind));
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, spaces: [...f.spaces.filter((s) => !replaced(s)), ...spaces] })));
          set((st) => (st.ui.selection?.type === 'space' ? { ui: { ...st.ui, selection: null } } : {}));
        },
        deleteWall: (floorId, id) => {
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, walls: f.walls.filter((w) => w.id !== id) })));
          set((st) => (st.ui.selection?.id === id ? { ui: { ...st.ui, selection: null } } : {}));
        },

        setFixtureTimes: (patch) =>
          commit((b) => ({ ...b, fixtureTimes: { ...DEFAULT_FIXTURE_TIMES, ...b.fixtureTimes, ...patch } })),
        setAutoFurnish: (on) => commit((b) => ({ ...b, autoFurnish: on })),
        addFurniture: (floorId, fu) =>
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, furniture: [...(f.furniture ?? []), fu] }))),
        updateFurniture: (floorId, id, patch, silent) =>
          commit(
            (b) =>
              mapFloor(b, floorId, (f) => ({
                ...f,
                furniture: (f.furniture ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
              })),
            silent,
          ),
        deleteFurniture: (floorId, id) => {
          commit((b) => mapFloor(b, floorId, (f) => ({ ...f, furniture: (f.furniture ?? []).filter((x) => x.id !== id) })));
          set((st) => (st.ui.selection?.id === id ? { ui: { ...st.ui, selection: null } } : {}));
        },

        addItem: (item) => commit((b) => ({ ...b, items: [...(b.items ?? []), item] })),
        updateItem: (id, patch, silent) =>
          commit((b) => ({ ...b, items: (b.items ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)) }), silent),
        deleteItem: (id) => {
          commit((b) => ({ ...b, items: (b.items ?? []).filter((i) => i.id !== id) }));
          set((st) => ({
            routines: st.routines.map((r) => ({ ...r, extra: r.extra.filter((t) => t.itemId !== id) })),
            ui: st.ui.selection?.id === id ? { ...st.ui, selection: null } : st.ui,
          }));
        },
        addItemType: (t) => commit((b) => ({ ...b, itemTypes: [...(b.itemTypes ?? []), t] })),
        updateItemType: (id, patch) =>
          commit((b) => ({ ...b, itemTypes: (b.itemTypes ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
        deleteItemType: (id) => {
          // Al borrar un tipo se borran también sus elementos
          commit((b) => ({
            ...b,
            itemTypes: (b.itemTypes ?? []).filter((t) => t.id !== id),
            items: (b.items ?? []).filter((i) => i.typeId !== id),
          }));
          set((st) => ({
            routines: st.routines.map((r) => ({
              ...r,
              filters: r.filters.map((f) => (f.kind === 'items' ? { ...f, typeIds: f.typeIds.filter((x) => x !== id) } : f)),
            })),
          }));
        },

        addRoutine: () => {
          const r: Routine = {
            id: uid('r-'),
            name: get().ui.lang === 'en' ? 'New routine' : 'Nueva rutina',
            color: PERSON_COLORS[get().routines.length % PERSON_COLORS.length],
            filters: [],
            extra: [],
            floorIds: [],
            dwell: 120,
            rounds: [],
          };
          set((st) => ({ routines: [...st.routines, r] }));
          return r.id;
        },
        updateRoutine: (id, patch) => set((st) => ({ routines: st.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
        deleteRoutine: (id) =>
          set((st) => ({
            routines: st.routines.filter((r) => r.id !== id),
            persons: st.persons.map((p) =>
              p.routines?.some((a) => a.routineId === id) ? { ...p, routines: p.routines.filter((a) => a.routineId !== id) } : p,
            ),
          })),

        setOutline:(floorId, outline, silent) => commit((b) => mapFloor(b, floorId, (f) => ({ ...f, outline })), silent),
        scaleFloor: (floorId, k) =>
          commit((b) =>
            mapFloor(b, floorId, (f) => {
              const sc = (v: number) => +(v * k).toFixed(3);
              const sp = (p: Vec2) => ({ x: sc(p.x), z: sc(p.z) });
              return {
                ...f,
                outline: f.outline.map(sp),
                walls: f.walls.map((w) => ({ ...w, a: sp(w.a), b: sp(w.b) })),
                // Las puertas mantienen su ancho real; solo cambian el tamaño y la posición de las estancias
                spaces: f.spaces.map((s) => ({
                  ...s,
                  x: sc(s.x),
                  z: sc(s.z),
                  w: sc(s.w),
                  d: sc(s.d),
                  fixtures: s.fixtures?.map((fx) => ({ ...fx, x: sc(fx.x), z: sc(fx.z), w: sc(fx.w), d: sc(fx.d) })),
                })),
                furniture: f.furniture?.map((m) => ({ ...m, x: sc(m.x), z: sc(m.z), w: sc(m.w), d: sc(m.d) })),
                background: f.background && {
                  ...f.background,
                  x: sc(f.background.x),
                  z: sc(f.background.z),
                  w: sc(f.background.w),
                  d: sc(f.background.d),
                },
              };
            }),
          ),
        addFloor: (mode) => {
          const st = get();
          const current = st.building.floors.find((f) => f.id === st.ui.activeFloorId) ?? st.building.floors[0];
          const level = Math.max(...st.building.floors.map((f) => f.level)) + 1;
          const floor = cloneFloor(current, level, `Planta ${level}`, mode === 'copy');
          commit((b) => ({ ...b, floors: [...b.floors, floor] }));
          set((s) => ({ ui: { ...s.ui, activeFloorId: floor.id, selection: null } }));
        },
        updateFloor: (id, patch) =>
          commit((b) => ({ ...b, floors: b.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
        deleteFloor: (id) => {
          const st = get();
          if (st.building.floors.length <= 1) return;
          commit((b) => ({ ...b, floors: b.floors.filter((f) => f.id !== id), items: (b.items ?? []).filter((i) => i.floorId !== id) }));
          set((s) => ({
            persons: s.persons.map((p) => ({ ...p, stops: p.stops.filter((x) => x.floorId !== id) })),
            ui: {
              ...s.ui,
              selection: null,
              activeFloorId: s.ui.activeFloorId === id ? s.building.floors[0].id : s.ui.activeFloorId,
            },
          }));
        },

        addPerson: () => {
          const st = get();
          const n = st.persons.length + 1;
          const person: Person = {
            id: uid('p-'),
            name: `${st.ui.lang === 'en' ? 'Person' : 'Persona'} ${n}`,
            color: PERSON_COLORS[(n - 1) % PERSON_COLORS.length],
            // Los nuevos son operarios: usan el good lift y salen de él
            tags: ['limpieza'],
            speed: 1.3,
            startDelay: 0,
            optimize: false,
            returnToStart: false,
            stops: [],
          };
          set((s) => ({ persons: [...s.persons, person], ui: { ...s.ui, expandedPersonId: person.id, tab: 'people' } }));
        },
        updatePerson: (id, patch) => mapPerson(id, (p) => ({ ...p, ...patch })),
        deletePerson: (id) =>
          set((st) => ({
            persons: st.persons.filter((p) => p.id !== id),
            ui: { ...st.ui, pickPersonId: st.ui.pickPersonId === id ? null : st.ui.pickPersonId },
          })),
        addStop: (personId, floorId, spaceId) =>
          mapPerson(personId, (p) => ({
            ...p,
            stops: [...p.stops, { id: uid('st-'), floorId, spaceId, dwell: p.stops.length ? 60 : 0 }],
          })),
        updateStop: (personId, stopId, patch) =>
          mapPerson(personId, (p) => ({ ...p, stops: p.stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s)) })),
        moveStop: (personId, stopId, dir) =>
          mapPerson(personId, (p) => {
            const i = p.stops.findIndex((s) => s.id === stopId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= p.stops.length) return p;
            const stops = [...p.stops];
            [stops[i], stops[j]] = [stops[j], stops[i]];
            return { ...p, stops };
          }),
        removeStop: (personId, stopId) => mapPerson(personId, (p) => ({ ...p, stops: p.stops.filter((s) => s.id !== stopId) })),

        addRule: () => set((st) => ({ rules: [...st.rules, { id: uid('r-'), personTag: '', spaceTag: '' }] })),
        updateRule: (id, patch) => set((st) => ({ rules: st.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
        removeRule: (id) => set((st) => ({ rules: st.rules.filter((r) => r.id !== id) })),

        importData: (data) =>
          set((st) => ({
            building: upgradeBuilding(data.building),
            persons: data.persons,
            rules: withStairsRule(data.rules),
            startTime: data.startTime ?? null,
            areaMap: data.areaMap ?? {},
            routines: data.routines ?? [],
            past: [],
            future: [],
            ui: { ...st.ui, activeFloorId: data.building.floors[0].id, selection: null, pickPersonId: null },
          })),
        resetPlan: () => {
          commit(() => createBuilding());
          set((st) => ({ ui: { ...st.ui, activeFloorId: get().building.floors[0].id, selection: null } }));
        },
        // Un edificio en blanco se empieza con el Constructor de planta
        newBlankBuilding: async (name) => {
          await get().addBuilding(name, blankProject());
          set((st) => ({ ui: { ...st.ui, tab: 'builder', sidebarOpen: true } }));
        },
        addBuilding: async (name, data) => {
          const st = get();
          await saveBuildingData(st.activeBuildingId, projectDataOf(st));
          const id = uid('edificio-');
          set((cur) => ({
            library: [...cur.library, { id, name }],
            activeBuildingId: id,
            building: data.building,
            persons: data.persons,
            rules: data.rules,
            startTime: data.startTime ?? null,
            areaMap: data.areaMap ?? {},
            routines: data.routines ?? [],
            past: [],
            future: [],
            ui: { ...cur.ui, activeFloorId: data.building.floors[0].id, selection: null, pickPersonId: null, expandedPersonId: null },
          }));
        },
        restoreBackup: async (backup) => {
          const st = get();
          // Los edificios de este equipo que no vienen en la copia se borran: la copia los sustituye todos
          for (const e of st.library) if (!backup.buildings.some((b) => b.id === e.id)) await deleteBuildingData(e.id);
          for (const b of backup.buildings) await saveBuildingData(b.id, b.data);
          const act = backup.buildings.find((b) => b.id === backup.activeBuildingId) ?? backup.buildings[0];
          const data = act.data;
          set((cur) => ({
            library: backup.buildings.map(({ id, name }) => ({ id, name })),
            activeBuildingId: act.id,
            building: data.building,
            persons: data.persons,
            rules: data.rules,
            startTime: data.startTime ?? null,
            areaMap: data.areaMap ?? {},
            routines: data.routines ?? [],
            past: [],
            future: [],
            ui: { ...cur.ui, activeFloorId: data.building.floors[0].id, selection: null, pickPersonId: null, expandedPersonId: null },
          }));
        },
        switchBuilding: async (id) => {
          const st = get();
          if (id === st.activeBuildingId) return;
          // Un edificio de ejemplo que aún no se ha abierto no está en la base de datos local
          const data = (await loadBuildingData(id)) ?? exampleData(id);
          if (!data) throw new Error('edificio no encontrado');
          await saveBuildingData(st.activeBuildingId, projectDataOf(st));
          // Tal cual se guardó (sin pasar por las actualizaciones de versiones antiguas)
          set((cur) => ({
            activeBuildingId: id,
            building: data.building,
            persons: data.persons,
            rules: data.rules,
            startTime: data.startTime ?? null,
            areaMap: data.areaMap ?? {},
            routines: data.routines ?? [],
            past: [],
            future: [],
            ui: { ...cur.ui, activeFloorId: data.building.floors[0].id, selection: null, pickPersonId: null, expandedPersonId: null },
          }));
        },
        renameBuilding: (id, name) =>
          set((st) => ({ library: st.library.map((b) => (b.id === id ? { ...b, name } : b)) })),
        deleteBuilding: async (id) => {
          if (id === get().activeBuildingId) return;
          await deleteBuildingData(id);
          set((st) => ({ library: st.library.filter((b) => b.id !== id) }));
        },
        resetAll: () => {
          const s = createSeed();
          set((st) => ({
            building: s.building,
            persons: s.persons,
            rules: s.rules,
            startTime: s.startTime ?? null,
            areaMap: {},
            routines: s.routines ?? [],
            past: [],
            future: [],
            ui: { ...defaultUi, lang: st.ui.lang },
          }));
        },
      };
    },
    {
      name: 'modelo-planta-3d',
      // Versión de los datos guardados. Los cambios de cada versión que afectan a los datos de
      // una instalación concreta se aplican en sus datos locales (LocalData.legacyMigrate y
      // LocalData.upgradeBuilding); aquí solo los generales (v39–v40: reglas de escaleras y lados).
      version: 46,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<StoreState>;
        // Versiones muy antiguas: solo existían con los datos locales
        LOCAL?.legacyMigrate(p, version);
        if (version >= 5 && version < 46 && p.building) p.building = upgradeBuilding(p.building);
        if (version >= 5 && version < 46 && p.rules) p.rules = withStairsRule(p.rules);
        // `merge` completa lo que falte con el estado por defecto
        return p as never;
      },
      partialize: (st) => ({
        library: st.library,
        activeBuildingId: st.activeBuildingId,
        building: st.building,
        persons: st.persons,
        rules: st.rules,
        startTime: st.startTime,
        areaMap: st.areaMap,
        routines: st.routines,
        ui: {
          lang: st.ui.lang,
          activeFloorId: st.ui.activeFloorId,
          view: st.ui.view,
          tab: st.ui.tab,
          sidebarOpen: st.ui.sidebarOpen,
          showLabels: st.ui.showLabels,
          showRoutes: st.ui.showRoutes,
          showFurniture: st.ui.showFurniture,
          showPhoto: st.ui.showPhoto,
          photoOpacity: st.ui.photoOpacity,
          wallHeight: st.ui.wallHeight,
          snap: st.ui.snap,
          autoSave: st.ui.autoSave,
        },
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StoreState>;
        const merged = { ...current, ...p, ui: { ...current.ui, ...(p.ui ?? {}) } };
        // La planta activa guardada puede no existir ya
        if (!merged.building.floors.some((f) => f.id === merged.ui.activeFloorId))
          merged.ui.activeFloorId = merged.building.floors[0].id;
        return merged;
      },
    },
  ),
);

export function useActiveFloor(): Floor {
  return useStore((s) => s.building.floors.find((f) => f.id === s.ui.activeFloorId) ?? s.building.floors[0]);
}

export function isProjectData(d: unknown): d is ProjectData {
  const o = d as ProjectData;
  return (
    !!o &&
    typeof o === 'object' &&
    Array.isArray(o.building?.floors) &&
    o.building.floors.length > 0 &&
    o.building.floors.every((f) => Array.isArray(f.spaces) && Array.isArray(f.outline) && Array.isArray(f.walls)) &&
    Array.isArray(o.persons) &&
    Array.isArray(o.rules)
  );
}
