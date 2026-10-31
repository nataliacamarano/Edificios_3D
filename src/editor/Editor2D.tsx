import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  bbox,
  center,
  compassMarks,
  dist,
  doorGap,
  isDestination,
  isEnclosed,
  isObstacle,
  isWalledPassage,
  KIND_COLORS,
  KINDS,
  nearestSide,
  round,
  sideLength,
  sideNormal,
  spaceColor,
  uid,
  wallSegments,
} from '../geometry';
import { kindKey, useName, useT, type TKey } from '../i18n';
import { usePlans } from '../nav/PlansContext';
import { assetUrl } from '../three/Scene';
import { useActiveFloor, useStore, type Tool } from '../store';
import type { Floor, Furniture, FurnitureKind, Item, Space, SpaceKind, Vec2 } from '../types';
import { itemSize, itemTypeOf } from '../routines';
import { FURNITURE_DEFAULT_SIZE, FURNITURE_KINDS, FURNITURE_STYLE } from '../furniture';
import { furnitureParts, type Mat, type Prim } from '../furnitureLayout';
import { roomFurnitureParts } from '../roomFixtures';
import { askConfirm, askText } from '../ui/AskDialog';
import { rectifyPhoto } from '../photoRectify';

/** Colores del mobiliario en 2D, parecidos a los del plano impreso. */
const MAT_2D: Record<Mat, [string, string]> = {
  wood: ['#f3e7c9', '#8a6a3b'],
  chair: ['#ffffff', '#8a6a3b'],
  sofa: ['#dfe6ef', '#5f7390'],
  counter: ['#ebe6dc', '#7c7468'],
  storage: ['#e4e0da', '#6b665f'],
  pot: ['#e9d8c8', '#8d6e5a'],
  plant: ['#cfe6c9', '#4f8a4f'],
  metal: ['#e5e7eb', '#4b5563'],
  screen: ['#334155', '#334155'],
  felt: ['#bfe0c8', '#2f7d4f'],
  porcelain: ['#ffffff', '#64748b'],
  partition: ['#e2e8f0', '#64748b'],
  tray: ['#e0f2fe', '#5b8db0'],
  step: ['#f1f5f9', '#64748b'],
  car: ['#f8fafc', '#475569'],
};

/** Piezas de un mueble vistas desde arriba, en el orden del plano: asientos, tableros, detalles. */
const PrimsSvg = memo(function PrimsSvg({ prims }: { prims: Prim[] }) {
  const sorted = prims.filter((p) => p.layer !== null).sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  return (
    <>
      {sorted.map((p, i) => {
        const [fill, stroke] = MAT_2D[p.mat];
        if (p.shape !== 'box')
          return <ellipse key={i} cx={p.x} cy={p.z} rx={p.w / 2} ry={p.d / 2} fill={fill} stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />;
        const rot = p.rot ? `rotate(${(-p.rot * 180) / Math.PI} ${p.x} ${p.z})` : undefined;
        return (
          <g key={i} transform={rot}>
            <rect x={p.x - p.w / 2} y={p.z - p.d / 2} width={p.w} height={p.d} rx={Math.min(0.06, p.w / 4, p.d / 4)} fill={fill} stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            {p.cross && (
              <path d={`M ${p.x - p.w / 2} ${p.z - p.d / 2} L ${p.x + p.w / 2} ${p.z + p.d / 2} M ${p.x + p.w / 2} ${p.z - p.d / 2} L ${p.x - p.w / 2} ${p.z + p.d / 2}`} stroke={stroke} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            )}
          </g>
        );
      })}
    </>
  );
});

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

type Drag =
  | { type: 'pan'; cx: number; cy: number; vb: ViewBox; moved: boolean; deselect: boolean }
  | { type: 'move'; id: string; start: Vec2; orig: Vec2 }
  | { type: 'resize'; id: string; furniture: boolean; handle: Handle; orig: { x: number; z: number; w: number; d: number } }
  | { type: 'create'; start: Vec2 }
  | { type: 'wallMove'; id: string; start: Vec2; a: Vec2; b: Vec2 }
  | { type: 'wallEnd'; id: string; end: 'a' | 'b' }
  | { type: 'vertex'; index: number }
  | { type: 'itemMove'; id: string; start: Vec2; orig: Vec2 }
  | { type: 'furnitureMove'; id: string; start: Vec2; orig: Vec2 };

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TOOLS: { id: Tool; icon: string }[] = [
  { id: 'select', icon: '⬚' },
  { id: 'pan', icon: '✋' },
  { id: 'rectify', icon: '⊡' },
  { id: 'room', icon: '▭' },
  { id: 'wall', icon: '╱' },
  { id: 'door', icon: '🚪' },
  { id: 'outline', icon: '⬠' },
  { id: 'delete', icon: '🗑' },
  { id: 'item', icon: '🗑️' },
  { id: 'furniture', icon: '🪑' },
  { id: 'calibrate', icon: '📏' },
];

function fitBox(floor: Floor): ViewBox {
  const bb = bbox(floor.outline);
  const m = 3;
  return { x: bb.minX - m, y: bb.minZ - m, w: bb.maxX - bb.minX + 2 * m, h: bb.maxZ - bb.minZ + 2 * m };
}

type Rect = { x: number; z: number; w: number; d: number };

function handlePos(s: Rect, h: Handle): Vec2 {
  const x = h.includes('w') ? s.x : h.includes('e') ? s.x + s.w : s.x + s.w / 2;
  const z = h.includes('n') ? s.z : h.includes('s') ? s.z + s.d : s.z + s.d / 2;
  return { x, z };
}

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export default function Editor2D() {
  const t = useT();
  const name = useName();
  const floor = useActiveFloor();
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const select = useStore((s) => s.select);
  const { plans } = usePlans();
  const building = useStore((s) => s.building);
  const floorItems = (building.items ?? []).filter((i) => i.floorId === floor.id);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [vb, setVb] = useState<ViewBox>(() => fitBox(floor));
  const [preview, setPreview] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [wallStart, setWallStart] = useState<Vec2 | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const tool = ui.tool;
  const sel = ui.selection;
  const px = vb.w / 900; // tamaño aproximado de un píxel en metros

  useEffect(() => setVb(fitBox(floor)), [floor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Durante un arrastre se usa la transformación del momento en que empezó: si el panel lateral
  // se abre y el plano cambia de sitio, el elemento sigue al ratón sin saltar.
  const dragMatrix = useRef<DOMMatrix | null>(null);
  const screenToWorld = () => DOMMatrix.fromMatrix(svgRef.current!.getScreenCTM()!.inverse());
  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const p = new DOMPoint(clientX, clientY).matrixTransform(dragMatrix.current ?? screenToWorld());
    return { x: p.x, z: p.y };
  };
  const snap = (v: number) => (ui.snap ? round(v, 0.25) : round(v, 0.05));
  const snapP = (p: Vec2) => ({ x: snap(p.x), z: snap(p.z) });

  // Zoom con la rueda, centrado en el cursor
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      const k = Math.exp(e.deltaY * 0.0015);
      setVb((v) => {
        const w = Math.min(500, Math.max(3, v.w * k));
        const kk = w / v.w;
        return { x: p.x - (p.x - v.x) * kk, y: p.z - (p.z - v.y) * kk, w, h: v.h * kk };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Esc cancela el muro en curso
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWallStart(null);
        setPreview(null);
        dragRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setWallStart(null), [tool]);

  const capture = (e: RPointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    dragMatrix.current = screenToWorld();
  };

  const startPan = (e: RPointerEvent, deselect: boolean) => {
    dragRef.current = { type: 'pan', cx: e.clientX, cy: e.clientY, vb, moved: false, deselect };
    capture(e);
  };

  // Enderezar: las cuatro esquinas del edificio sobre la foto, en cualquier orden
  const [rectPts, setRectPts] = useState<Vec2[]>([]);
  const [rectBusy, setRectBusy] = useState(false);
  useEffect(() => setRectPts([]), [tool, floor.id]);
  const straighten = async (pts: Vec2[]) => {
    const bg = floor.background;
    if (!bg) return;
    const cx = bg.x + bg.w / 2;
    const cz = bg.z + bg.d / 2;
    const r = ((bg.rotation ?? 0) * Math.PI) / 180;
    const turn = (p: Vec2, a: number) => ({
      x: cx + (p.x - cx) * Math.cos(a) - (p.z - cz) * Math.sin(a),
      z: cz + (p.x - cx) * Math.sin(a) + (p.z - cz) * Math.cos(a),
    });
    // Planta → fracción de la foto (deshaciendo su giro) y vuelta
    const toPhoto = pts.map((p) => turn(p, -r)).map((p) => [(p.x - bg.x) / bg.w, (p.z - bg.z) / bg.d] as [number, number]);
    const fromPhoto = (u: number, v: number) => {
      const p = turn({ x: bg.x + u * bg.w, z: bg.z + v * bg.d }, r);
      return { x: round(p.x, 0.05), z: round(p.z, 0.05) };
    };
    setRectBusy(true);
    try {
      const res = await rectifyPhoto(assetUrl(bg.src), toPhoto);
      const [x0, y0, x1, y1] = res.rect;
      const st = useStore.getState();
      st.updateFloor(floor.id, { background: { ...bg, src: res.dataUrl } });
      st.setOutline(floor.id, [fromPhoto(x0, y0), fromPhoto(x1, y0), fromPhoto(x1, y1), fromPhoto(x0, y1)]);
      st.setUi({ tool: 'select', showPhoto: true });
    } catch {
      void askConfirm(t('detectWallsError'));
    } finally {
      setRectBusy(false);
      setRectPts([]);
    }
  };

  // Con la mano se arrastra el plano desde cualquier punto, también encima de salas y muebles
  const onSvgDownCapture = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    if (tool === 'rectify') {
      e.stopPropagation();
      if (rectBusy || !floor.background) return;
      const pts = [...rectPts, toWorld(e.clientX, e.clientY)];
      setRectPts(pts);
      if (pts.length === 4) void straighten(pts);
      return;
    }
    if (tool !== 'pan') return;
    e.stopPropagation();
    startPan(e, false);
    setGrabbing(true);
  };

  // ---------- Fondo ----------
  const onSvgDown = (e: RPointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      if (e.button === 2 && tool === 'wall') setWallStart(null);
      startPan(e, false);
      return;
    }
    if (e.button !== 0) return;
    const p = snapP(toWorld(e.clientX, e.clientY));
    const st = useStore.getState();
    if (tool === 'room') {
      dragRef.current = { type: 'create', start: p };
      setPreview({ a: p, b: p });
      capture(e);
    } else if (tool === 'wall') {
      if (!wallStart) setWallStart(p);
      else {
        if (dist(wallStart, p) > 0.1) st.addWall(floor.id, { id: uid('w'), a: wallStart, b: p });
        setWallStart(p);
      }
    } else if (tool === 'item') {
      // Coloca un elemento del tipo elegido donde se hace clic
      const types = st.building.itemTypes ?? [];
      const typeId = types.some((tt) => tt.id === st.ui.newItemType) ? st.ui.newItemType : types[0]?.id;
      if (!typeId) return;
      const item: Item = { id: uid('i'), typeId, floorId: floor.id, x: p.x, z: p.z, tags: [] };
      st.addItem(item);
      st.select({ type: 'item', floorId: floor.id, id: item.id });
    } else if (tool === 'furniture') {
      // Coloca un mueble del tipo elegido centrado donde se hace clic
      const kind = st.ui.newFurnitureKind;
      const [w, d] = FURNITURE_DEFAULT_SIZE[kind];
      const m: Furniture = { id: uid('m'), kind, x: snap(p.x - w / 2), z: snap(p.z - d / 2), w, d };
      st.addFurniture(floor.id, m);
      st.select({ type: 'furniture', floorId: floor.id, id: m.id });
      // Si la capa de muebles estaba oculta, se vuelve a ver para ver lo colocado
      if (!st.ui.showFurniture) st.setUi({ showFurniture: true });
    } else if (tool === 'calibrate') {
      // Escala: dos clics sobre una medida conocida de la foto y su distancia real en metros
      const q = toWorld(e.clientX, e.clientY);
      if (!wallStart) setWallStart(q);
      else {
        const measured = dist(wallStart, q);
        setWallStart(null);
        if (measured < 0.01) return;
        void askText(t('calibratePrompt', { m: measured.toFixed(2) })).then((answer) => {
          const real = parseFloat((answer ?? '').replace(',', '.'));
          if (real > 0) useStore.getState().scaleFloor(floor.id, real / measured);
        });
      }
    } else {
      startPan(e, tool === 'select');
    }
  };

  const onSvgMove = (e: RPointerEvent) => {
    const raw = toWorld(e.clientX, e.clientY);
    const p = snapP(raw);
    setCursor(p);
    const d = dragRef.current;
    if (!d) return;
    const st = useStore.getState();
    switch (d.type) {
      case 'pan': {
        const rect = svgRef.current!.getBoundingClientRect();
        const k = Math.max(d.vb.w / rect.width, d.vb.h / rect.height);
        const dx = e.clientX - d.cx;
        const dy = e.clientY - d.cy;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setVb({ ...d.vb, x: d.vb.x - dx * k, y: d.vb.y - dy * k });
        break;
      }
      case 'create':
        setPreview({ a: d.start, b: p });
        break;
      case 'move':
        st.updateSpace(
          floor.id,
          d.id,
          { x: snap(d.orig.x + raw.x - d.start.x), z: snap(d.orig.z + raw.z - d.start.z) },
          true,
        );
        break;
      case 'resize': {
        let { x, z, w, d: dd } = d.orig;
        const h = d.handle;
        if (h.includes('w')) {
          const right = x + w;
          x = Math.min(p.x, right - 0.5);
          w = right - x;
        }
        if (h.includes('e')) w = Math.max(0.5, p.x - x);
        if (h.includes('n')) {
          const bottom = z + dd;
          z = Math.min(p.z, bottom - 0.5);
          dd = bottom - z;
        }
        if (h.includes('s')) dd = Math.max(0.5, p.z - z);
        const patch = { x: round(x, 0.01), z: round(z, 0.01), w: round(w, 0.01), d: round(dd, 0.01) };
        if (d.furniture) st.updateFurniture(floor.id, d.id, patch, true);
        else st.updateSpace(floor.id, d.id, patch, true);
        break;
      }
      case 'wallMove': {
        const dx = snap(raw.x - d.start.x);
        const dz = snap(raw.z - d.start.z);
        st.updateWall(floor.id, d.id, { a: { x: d.a.x + dx, z: d.a.z + dz }, b: { x: d.b.x + dx, z: d.b.z + dz } }, true);
        break;
      }
      case 'wallEnd':
        st.updateWall(floor.id, d.id, { [d.end]: p }, true);
        break;
      case 'itemMove':
        st.updateItem(d.id, { x: snap(d.orig.x + raw.x - d.start.x), z: snap(d.orig.z + raw.z - d.start.z) }, true);
        break;
      case 'furnitureMove':
        st.updateFurniture(
          floor.id,
          d.id,
          { x: snap(d.orig.x + raw.x - d.start.x), z: snap(d.orig.z + raw.z - d.start.z) },
          true,
        );
        break;
      case 'vertex': {
        const current = st.building.floors.find((f) => f.id === floor.id);
        if (!current) break;
        const pts = current.outline.slice();
        pts[d.index] = p;
        st.setOutline(floor.id, pts, true);
        break;
      }
    }
  };

  const onSvgUp = (e: RPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGrabbing(false);
    const endPoint = toWorld(e.clientX, e.clientY);
    dragMatrix.current = null;
    if (!d) return;
    if (d.type === 'pan' && !d.moved && d.deselect) select(null);
    if (d.type === 'create') {
      const b = snapP(endPoint);
      const r = {
        x: Math.min(d.start.x, b.x),
        z: Math.min(d.start.z, b.z),
        w: Math.abs(b.x - d.start.x),
        d: Math.abs(b.z - d.start.z),
      };
      setPreview(null);
      if (r.w >= 0.5 && r.d >= 0.5) {
        const kind = ui.newKind;
        const space: Space = {
          id: uid('s'),
          name: t('newSpace'),
          kind,
          ...r,
          tags: [],
          doors: isEnclosed(kind) ? [{ id: uid('d'), side: 's', offset: 0.5, width: Math.min(0.9, r.w * 0.6) }] : [],
        };
        const st = useStore.getState();
        st.addSpace(floor.id, space);
        st.select({ type: 'space', floorId: floor.id, id: space.id });
      }
    }
  };

  // ---------- Elementos ----------
  const onSpaceDown = (e: RPointerEvent, s: Space) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    if (st.ui.pickPersonId) {
      e.stopPropagation();
      if (isDestination(s.kind)) st.addStop(st.ui.pickPersonId, floor.id, s.id);
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      st.select({ type: 'space', floorId: floor.id, id: s.id });
      st.snapshot();
      dragRef.current = { type: 'move', id: s.id, start: toWorld(e.clientX, e.clientY), orig: { x: s.x, z: s.z } };
      capture(e);
    } else if (tool === 'door') {
      e.stopPropagation();
      // Las zonas de paso (vestíbulos) también pueden tener puertas
      if (!isEnclosed(s.kind) && s.kind !== 'lobby') return;
      const p = toWorld(e.clientX, e.clientY);
      const ns = nearestSide(s, p);
      const L = sideLength(s, ns.side);
      const existing = s.doors.find((d) => d.side === ns.side && Math.abs(d.offset - ns.offset) * L < 0.7);
      st.updateSpace(floor.id, s.id, {
        doors: existing
          ? s.doors.filter((d) => d !== existing)
          : [...s.doors, { id: uid('d'), side: ns.side, offset: round(ns.offset, 0.01), width: Math.min(0.9, L * 0.6) }],
      });
    } else if (tool === 'delete') {
      e.stopPropagation();
      st.deleteSpace(floor.id, s.id);
    }
  };

  const onHandleDown = (e: RPointerEvent, s: Rect & { id: string }, handle: Handle, furniture: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useStore.getState().snapshot();
    dragRef.current = { type: 'resize', id: s.id, furniture, handle, orig: { x: s.x, z: s.z, w: s.w, d: s.d } };
    capture(e);
  };

  const onWallDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    const w = floor.walls.find((x) => x.id === id);
    if (!w) return;
    if (tool === 'select') {
      e.stopPropagation();
      st.select({ type: 'wall', floorId: floor.id, id });
      st.snapshot();
      dragRef.current = { type: 'wallMove', id, start: toWorld(e.clientX, e.clientY), a: w.a, b: w.b };
      capture(e);
    } else if (tool === 'delete') {
      e.stopPropagation();
      st.deleteWall(floor.id, id);
    }
  };

  const onItemDown = (e: RPointerEvent, item: Item) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    if (tool === 'select' || tool === 'item') {
      e.stopPropagation();
      st.select({ type: 'item', floorId: floor.id, id: item.id });
      st.snapshot();
      dragRef.current = { type: 'itemMove', id: item.id, start: toWorld(e.clientX, e.clientY), orig: { x: item.x, z: item.z } };
      capture(e);
    } else if (tool === 'delete') {
      e.stopPropagation();
      st.deleteItem(item.id);
    }
  };

  const onFurnitureDown = (e: RPointerEvent, m: Furniture) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    if (st.ui.pickPersonId) return;
    if (tool === 'select' || tool === 'furniture') {
      e.stopPropagation();
      st.select({ type: 'furniture', floorId: floor.id, id: m.id });
      st.snapshot();
      dragRef.current = { type: 'furnitureMove', id: m.id, start: toWorld(e.clientX, e.clientY), orig: { x: m.x, z: m.z } };
      capture(e);
    } else if (tool === 'delete') {
      e.stopPropagation();
      st.deleteFurniture(floor.id, m.id);
    }
  };

  const onWallEndDown = (e: RPointerEvent, id: string, end: 'a' | 'b') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useStore.getState().snapshot();
    dragRef.current = { type: 'wallEnd', id, end };
    capture(e);
  };

  const onVertexDown = (e: RPointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useStore.getState();
    if (e.shiftKey || e.altKey) {
      if (floor.outline.length > 3) st.setOutline(floor.id, floor.outline.filter((_, i) => i !== index));
      return;
    }
    st.snapshot();
    dragRef.current = { type: 'vertex', index };
    capture(e);
  };

  const onEdgeDouble = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const p = snapP(toWorld(e.clientX, e.clientY));
    const pts = floor.outline.slice();
    pts.splice(index + 1, 0, p);
    useStore.getState().setOutline(floor.id, pts);
  };

  // ---------- Dibujo ----------
  const selSpace = sel?.type === 'space' ? floor.spaces.find((s) => s.id === sel.id) : undefined;
  const selWall = sel?.type === 'wall' ? floor.walls.find((w) => w.id === sel.id) : undefined;
  const selFurniture = sel?.type === 'furniture' && ui.showFurniture ? floor.furniture?.find((m) => m.id === sel.id) : undefined;
  const resizable = selSpace ?? selFurniture;
  const showFurniture = ui.showFurniture;
  const autoFurnish = building.autoFurnish !== false;
  const furnParts = useMemo(
    () => (showFurniture ? (floor.furniture ?? []).map((m) => ({ m, prims: furnitureParts(m, floor) })) : []),
    [floor, showFurniture],
  );
  const roomParts = useMemo(
    () =>
      floor.spaces
        .map((sp) => ({ id: sp.id, prims: roomFurnitureParts(sp, { furniture: showFurniture, auto: autoFurnish }) }))
        .filter((r) => r.prims.length),
    [floor, showFurniture, autoFurnish],
  );
  const ordered = [...floor.spaces].sort((a, b) => Number(isEnclosed(a.kind) || isObstacle(a.kind)) - Number(isEnclosed(b.kind) || isObstacle(b.kind)));
  const bg = floor.background;
  const bb = bbox(floor.outline);
  const outlinePts = floor.outline.map((p) => `${p.x},${p.z}`).join(' ');
  const spaceCursor = ui.pickPersonId ? 'copy' : tool === 'select' ? 'move' : tool === 'door' || tool === 'delete' ? 'pointer' : undefined;

  return (
    <div className="editor2d">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDownCapture={onSvgDownCapture}
        onPointerDown={onSvgDown}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
        className={tool === 'pan' ? (grabbing ? 'pan-tool grabbing' : 'pan-tool') : undefined}
        style={{ cursor: tool === 'room' || tool === 'wall' || tool === 'calibrate' || tool === 'rectify' ? 'crosshair' : undefined }}
      >
        <defs>
          <pattern id="grid1m" width={1} height={1} patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#d3dae3" strokeWidth={0.02} />
          </pattern>
          <pattern id="hatch" width={0.5} height={0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.5} stroke="#9aa2ad" strokeWidth={0.08} />
          </pattern>
        </defs>

        <rect x={bb.minX - 20} y={bb.minZ - 20} width={bb.maxX - bb.minX + 40} height={bb.maxZ - bb.minZ + 40} fill="url(#grid1m)" />
        <polygon points={outlinePts} fill="#fbfbf9" stroke="none" />
        {ui.showPhoto && bg && (
          <image
            href={assetUrl(bg.src)}
            x={bg.x}
            y={bg.z}
            width={bg.w}
            height={bg.d}
            opacity={ui.photoOpacity}
            preserveAspectRatio="none"
            transform={bg.rotation ? `rotate(${bg.rotation} ${bg.x + bg.w / 2} ${bg.z + bg.d / 2})` : undefined}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {ordered.map((s) => {
          const enclosed = isEnclosed(s.kind);
          const obstacle = isObstacle(s.kind);
          const walled = (enclosed && !s.design) || isWalledPassage(s);
          const color = spaceColor(s);
          const selected = sel?.id === s.id;
          return (
            <g key={s.id} onPointerDown={(e) => onSpaceDown(e, s)} style={{ cursor: spaceCursor }}>
              <rect
                x={s.x}
                y={s.z}
                width={s.w}
                height={s.d}
                fill={obstacle ? 'url(#hatch)' : color}
                fillOpacity={s.design ? 0.15 : enclosed || obstacle ? 1 : 0.55}
                stroke={selected ? '#ff9f1c' : enclosed ? 'none' : '#7f8a96'}
                strokeWidth={selected ? 2.5 : 1}
                strokeDasharray={enclosed || obstacle || selected ? undefined : '4 3'}
                vectorEffect="non-scaling-stroke"
              />
              {obstacle && (
                <rect x={s.x} y={s.z} width={s.w} height={s.d} fill={color} fillOpacity={0.45} stroke="#7f8a96" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              )}
              {walled &&
                wallSegments(s).map(([a, b], i) => (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.z}
                    x2={b.x}
                    y2={b.z}
                    stroke={selected ? '#ff9f1c' : '#4b5563'}
                    strokeWidth={selected ? 3 : 2}
                    strokeLinecap="square"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              {walled &&
                s.doors.map((d) => {
                  const [a, b] = doorGap(s, d);
                  // Hoja de la puerta abierta hacia dentro y su arco de apertura, como en los planos
                  const n = sideNormal(d.side);
                  const r = dist(a, b);
                  const leaf = { x: a.x - n.x * r, z: a.z - n.z * r };
                  const sweep = (leaf.x - a.x) * (b.z - a.z) - (leaf.z - a.z) * (b.x - a.x) > 0 ? 1 : 0;
                  return (
                    <g key={d.id} style={{ pointerEvents: 'none' }}>
                      <line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="#16a34a" strokeWidth={5} vectorEffect="non-scaling-stroke" />
                      <line x1={a.x} y1={a.z} x2={leaf.x} y2={leaf.z} stroke="#16a34a" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                      <path
                        d={`M ${leaf.x} ${leaf.z} A ${r} ${r} 0 0 ${sweep} ${b.x} ${b.z}`}
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
            </g>
          );
        })}

        <g style={{ pointerEvents: 'none' }}>
          {roomParts.map(({ id, prims }) => (
            <PrimsSvg key={id} prims={prims} />
          ))}
        </g>
        {furnParts.map(({ m, prims }) => {
          const selected = sel?.id === m.id;
          return (
            <g
              key={m.id}
              onPointerDown={(e) => onFurnitureDown(e, m)}
              style={{ cursor: tool === 'select' || tool === 'furniture' ? 'move' : tool === 'delete' ? 'pointer' : undefined }}
            >
              <title>{m.label ? name(m.label) : t(`furn_${m.kind}` as TKey)}</title>
              {/* Zona de clic de todo el mueble */}
              <rect
                x={m.x}
                y={m.z}
                width={m.w}
                height={m.d}
                fill={selected ? '#ff9f1c' : 'transparent'}
                fillOpacity={selected ? 0.18 : 0}
                stroke={selected ? '#ff9f1c' : 'none'}
                strokeWidth={2.5}
                strokeDasharray={selected ? '5 3' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              <g style={{ pointerEvents: 'none' }}>
                <PrimsSvg prims={prims} />
              </g>
            </g>
          );
        })}

        <polygon points={outlinePts} fill="none" stroke="#334155" strokeWidth={3} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />

        {floor.northDir &&
          floor.outline.length >= 3 &&
          compassMarks(floor.outline, floor.northDir, 1.8).map(({ dir, pos }) => (
            <g key={dir} style={{ pointerEvents: 'none' }}>
              <circle cx={pos.x} cy={pos.z} r={1.1} fill={dir === 'n' ? '#dc2626' : '#334155'} />
              <text
                x={pos.x}
                y={pos.z}
                fontSize={1.3}
                fontWeight={800}
                fill="#fff"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {t(`compass_${dir}` as TKey)}
              </text>
            </g>
          ))}

        {floor.walls.map((w) => (
          <g key={w.id} onPointerDown={(e) => onWallDown(e, w.id)} style={{ cursor: tool === 'select' ? 'move' : tool === 'delete' ? 'pointer' : undefined }}>
            <line x1={w.a.x} y1={w.a.z} x2={w.b.x} y2={w.b.z} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" />
            <line
              x1={w.a.x}
              y1={w.a.z}
              x2={w.b.x}
              y2={w.b.z}
              stroke={sel?.id === w.id ? '#ff9f1c' : w.detected ? '#c2255c' : '#374151'}
              strokeWidth={4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {floorItems.map((it) => {
          const type = itemTypeOf(building, it);
          const { w, d } = itemSize(building, it);
          const selected = sel?.id === it.id;
          const fill = type?.color ?? '#64748b';
          const stroke = selected ? '#ff9f1c' : '#1f2933';
          const iconSize = Math.max(0.35, Math.min(0.9, Math.min(w, d) * 0.7));
          return (
            <g
              key={it.id}
              onPointerDown={(e) => onItemDown(e, it)}
              style={{ cursor: tool === 'select' || tool === 'item' ? 'move' : tool === 'delete' ? 'pointer' : undefined }}
            >
              {type?.shape === 'box' ? (
                <rect x={it.x - w / 2} y={it.z - d / 2} width={w} height={d} fill={fill} fillOpacity={0.55} stroke={stroke} strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
              ) : (
                <circle cx={it.x} cy={it.z} r={Math.max(0.3, Math.max(w, d) / 2)} fill={fill} fillOpacity={0.85} stroke={stroke} strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
              )}
              <text x={it.x} y={it.z} fontSize={iconSize} textAnchor="middle" dominantBaseline="central">
                {type?.icon ?? '📍'}
              </text>
            </g>
          );
        })}

        {ui.showRoutes &&
          plans.map((p) =>
            p.legs.flat().map((s, i) =>
              s.kind === 'walk' && s.floorId === floor.id ? (
                <polyline
                  key={p.person.id + i}
                  points={s.pts.map((q) => `${q.x},${q.z}`).join(' ')}
                  fill="none"
                  stroke={p.person.color}
                  strokeWidth={3}
                  strokeOpacity={0.8}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'none' }}
                />
              ) : null,
            ),
          )}

        {rectPts.length > 0 && (
          <g style={{ pointerEvents: 'none' }}>
            <polyline
              points={rectPts.map((p) => `${p.x},${p.z}`).join(' ')}
              fill="none"
              stroke="#e0006b"
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
            {rectPts.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.z} r={px * 7} fill="#e0006b" />
                <text x={p.x} y={p.z + px * 3.5} fontSize={px * 10} textAnchor="middle" fill="#fff" fontWeight={700}>
                  {i + 1}
                </text>
              </g>
            ))}
          </g>
        )}
        {ui.showLabels &&
          floor.spaces
            .filter((s) => !isObstacle(s.kind))
            .map((s) => {
              const c = center(s);
              const size = Math.min(0.55, Math.max(0.28, s.w / Math.max(4, s.name.length * 0.55)));
              return (
                <text
                  key={s.id}
                  x={c.x}
                  y={c.z}
                  fontSize={s.kind === 'workspace' ? 0.7 : size}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={s.kind === 'workspace' ? '#1f6f45' : '#1f2933'}
                  fontWeight={600}
                >
                  {name(s)}
                </text>
              );
            })}

        {resizable &&
          tool === 'select' &&
          HANDLES.map((h) => {
            const p = handlePos(resizable, h);
            const r = 5 * px;
            return (
              <rect
                key={h}
                x={p.x - r}
                y={p.z - r}
                width={2 * r}
                height={2 * r}
                fill="#fff"
                stroke="#ff9f1c"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: CURSORS[h] }}
                onPointerDown={(e) => onHandleDown(e, resizable, h, resizable === selFurniture)}
              />
            );
          })}

        {selWall &&
          tool === 'select' &&
          (['a', 'b'] as const).map((end) => (
            <circle
              key={end}
              cx={selWall[end].x}
              cy={selWall[end].z}
              r={6 * px}
              fill="#fff"
              stroke="#ff9f1c"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onWallEndDown(e, selWall.id, end)}
            />
          ))}

        {tool === 'outline' && (
          <g>
            {floor.outline.map((p, i) => {
              const q = floor.outline[(i + 1) % floor.outline.length];
              return (
                <line
                  key={'e' + i}
                  x1={p.x}
                  y1={p.z}
                  x2={q.x}
                  y2={q.z}
                  stroke="transparent"
                  strokeWidth={14}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'copy' }}
                  onDoubleClick={(e) => onEdgeDouble(e, i)}
                />
              );
            })}
            {floor.outline.map((p, i) => (
              <circle
                key={'v' + i}
                cx={p.x}
                cy={p.z}
                r={6 * px}
                fill="#fff"
                stroke="#2563eb"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => onVertexDown(e, i)}
              />
            ))}
          </g>
        )}

        {preview && (
          <rect
            x={Math.min(preview.a.x, preview.b.x)}
            y={Math.min(preview.a.z, preview.b.z)}
            width={Math.abs(preview.b.x - preview.a.x)}
            height={Math.abs(preview.b.z - preview.a.z)}
            fill={KIND_COLORS[ui.newKind]}
            fillOpacity={0.6}
            stroke="#2563eb"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
        )}
        {(tool === 'wall' || tool === 'calibrate') && wallStart && cursor && (
          <line
            x1={wallStart.x}
            y1={wallStart.z}
            x2={cursor.x}
            y2={cursor.z}
            stroke="#2563eb"
            strokeWidth={3}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
        )}
        {(tool === 'wall' || tool === 'room' || tool === 'calibrate') && cursor && (
          <circle cx={cursor.x} cy={cursor.z} r={3 * px} fill="#2563eb" style={{ pointerEvents: 'none' }} />
        )}
      </svg>

      <div className="toolbar">
        <div className="tools">
          {TOOLS.map((tl) => (
            <button
              key={tl.id}
              className={`btn small${tool === tl.id ? ' active' : ''}`}
              onClick={() => setUi({ tool: tl.id })}
              title={t(`tool_${tl.id}` as TKey)}
            >
              {tl.icon} {t(`tool_${tl.id}` as TKey)}
            </button>
          ))}
          {tool === 'room' && (
            <select value={ui.newKind} onChange={(e) => setUi({ newKind: e.target.value as SpaceKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(kindKey(k))}
                </option>
              ))}
            </select>
          )}
          {tool === 'item' && (
            <select value={ui.newItemType} onChange={(e) => setUi({ newItemType: e.target.value })}>
              {(building.itemTypes ?? []).map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.icon} {name(tt.name)}
                </option>
              ))}
            </select>
          )}
          {tool === 'furniture' && (
            <select value={ui.newFurnitureKind} onChange={(e) => setUi({ newFurnitureKind: e.target.value as FurnitureKind })}>
              {FURNITURE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FURNITURE_STYLE[k].icon} {t(`furn_${k}` as TKey)}
                </option>
              ))}
            </select>
          )}
          <span className="sep" />
          <label className="check small">
            <input type="checkbox" checked={ui.snap} onChange={(e) => setUi({ snap: e.target.checked })} />
            {t('snap')}
          </label>
          <button className="btn small" onClick={() => setVb(fitBox(floor))}>
            ⤢ {t('fit')}
          </button>
          <button className="btn small" title={t('undo') + ' (Ctrl+Z)'} onClick={() => useStore.getState().undo()}>
            ↶
          </button>
          <button className="btn small" title={t('redo') + ' (Ctrl+Y)'} onClick={() => useStore.getState().redo()}>
            ↷
          </button>
        </div>
        <div className="hint">{t(`hint_${tool}` as TKey)}</div>
      </div>
      {cursor && (
        <div className="coords">
          x {cursor.x.toFixed(2)} · z {cursor.z.toFixed(2)} m
        </div>
      )}
    </div>
  );
}
