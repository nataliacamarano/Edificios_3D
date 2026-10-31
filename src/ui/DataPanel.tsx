import { useRef, useState } from 'react';
import { fmtClock, isEnclosed, KINDS, parseClock, uid } from '../geometry';
import { assetUrl } from '../three/Scene';
import { detectOutline, detectWalls, loadPixels, type Sensitivity } from '../wallDetect';
import { detectColorZones, type ColorGroup } from '../colorZones';
import { detectLiftsAndStairs, type Rect } from '../connectorDetect';
import type { NameProposal } from '../planText';
import { kindKey, translateName, useT, type TKey } from '../i18n';
import { useActiveFloor, useStore, type Tool } from '../store';
import type { Background, NorthDir, Space, SpaceKind } from '../types';
import { NumberField } from './common';
import { DEFAULT_PHOTO_SCALE, loadImageAsDataUrl } from './files';
import { BuildingsSection } from './BuildingPicker';
import ImportLog from './ImportLog';
import ProjectFile from './ProjectFile';

const NORTH_DIRS: NorthDir[] = ['+x', '-x', '-z', '+z'];

/** Detectar las paredes de la foto (borrador que luego se corrige en el editor 2D). */
export function DetectWalls() {
  const t = useT();
  const floor = useActiveFloor();
  const [sens, setSens] = useState<Sensitivity>('medium');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const detected = floor.walls.filter((w) => w.detected).length;

  const run = async () => {
    const bg = floor.background;
    if (!bg) return;
    setBusy(true);
    setMsg('');
    try {
      const px = await loadPixels(assetUrl(bg.src));
      // La planta puede haber cambiado mientras se cargaba la foto
      const st = useStore.getState();
      const current = st.building.floors.find((f) => f.id === floor.id);
      if (!current) return;
      const walls = detectWalls(px, { ...current, walls: current.walls.filter((w) => !w.detected) }, sens, () => uid('w'));
      st.setDetectedWalls(floor.id, walls);
      st.setUi({ view: '2d', tool: 'select', showPhoto: true, selection: null });
      setMsg(t('detectWallsDone', { n: walls.length }));
    } catch {
      setMsg(t('detectWallsError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? t('detectWallsBusy') : t('detectWalls')}
        </button>
        <select value={sens} title={t('sensitivity')} onChange={(e) => setSens(e.target.value as Sensitivity)}>
          <option value="low">{t('sensitivity')}: {t('sens_low')}</option>
          <option value="medium">{t('sensitivity')}: {t('sens_medium')}</option>
          <option value="high">{t('sensitivity')}: {t('sens_high')}</option>
        </select>
        {detected > 0 && (
          <button className="btn danger ghost" onClick={() => useStore.getState().setDetectedWalls(floor.id, [])}>
            {t('removeDetected', { n: detected })}
          </button>
        )}
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">{t('detectWallsHint')}</p>
    </>
  );
}

/** Contorno de la planta ajustado al borde del edificio en la foto (sin título ni leyenda). */
async function outlineFromPhoto(bg: Background) {
  return detectOutline(await loadPixels(assetUrl(bg.src)), bg);
}

export function FitOutline() {
  const t = useT();
  const floor = useActiveFloor();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    if (!floor.background) return;
    setBusy(true);
    setMsg('');
    try {
      const pts = await outlineFromPhoto(floor.background);
      if (pts) {
        useStore.getState().setOutline(floor.id, pts);
        const w = (pts[1].x - pts[0].x).toFixed(1).replace('.', ',');
        const d = (pts[2].z - pts[1].z).toFixed(1).replace('.', ',');
        setMsg(t('fitOutlineDone', { w, d }));
      } else setMsg(t('fitOutlineNone'));
    } catch {
      setMsg(t('detectWallsError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void run()}>
          {t('fitOutline')}
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </>
  );
}

/** Leer los nombres escritos en el plano (OCR) y ponérselos a las salas. */
export function ReadNames() {
  const t = useT();
  const floor = useActiveFloor();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState('');
  const [props, setProps] = useState<NameProposal[] | null>(null);

  const run = async () => {
    const bg = floor.background;
    if (!bg) return;
    setBusy(true);
    setMsg('');
    setProps(null);
    setProgress(0);
    try {
      // El lector de texto se carga solo cuando se usa (pesa unos megas)
      const { readPlanLabels, proposeNames } = await import('../planText');
      const labels = await readPlanLabels(assetUrl(bg.src), bg, setProgress);
      const current = useStore.getState().building.floors.find((f) => f.id === floor.id)!;
      const kindLabels = [...KINDS.map((k) => t(kindKey(k))), t('newSpace')];
      const found = proposeNames(current, labels, kindLabels);
      setProps(found);
      setMsg(t('namesFound', { n: labels.length, m: found.length }));
    } catch {
      setMsg(t('namesError'));
    } finally {
      setBusy(false);
    }
  };

  const chosen = props?.filter((p) => p.apply) ?? [];
  return (
    <>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? t('namesBusy', { p: Math.round(progress * 100) }) : t('readNames')}
        </button>
      </div>
      {props && props.length > 0 && (
        <>
          <ul className="space-list">
            {props.map((p, i) => (
              <li key={p.spaceId}>
                <label className="check grow">
                  <input
                    type="checkbox"
                    checked={p.apply}
                    onChange={(e) => setProps(props.map((x, j) => (j === i ? { ...x, apply: e.target.checked } : x)))}
                  />
                  <span className="muted">{p.current}</span> → <b>{p.text}</b>
                  {(p.kind || p.tags.length > 0) && (
                    <span className="muted small"> ({[p.kind && t(kindKey(p.kind)), ...p.tags].filter(Boolean).join(', ')})</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <button
            className="btn primary"
            disabled={!chosen.length}
            onClick={() => {
              useStore.getState().applyNames(floor.id, chosen);
              setMsg(t('namesApplied', { n: chosen.length }));
              setProps(null);
            }}
          >
            {t('applyNames', { n: chosen.length })}
          </button>
        </>
      )}
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">{t('readNamesHint')}</p>
    </>
  );
}

/** Une los ascensores y escaleras que coinciden de una planta a otra. */
export function ConnectFloors() {
  const t = useT();
  const [msg, setMsg] = useState('');
  return (
    <>
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            const r = useStore.getState().connectAllFloors();
            setMsg(r.groups ? t('connectDone', { g: r.groups, n: r.linked }) : t('connectNone'));
          }}
        >
          {t('connectFloors')}
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">{t('connectHint')}</p>
    </>
  );
}

/** Ascensores (recuadro con X) y escaleras (peldaños) de la foto. */
export function DetectConnectors() {
  const t = useT();
  const floor = useActiveFloor();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const detected = floor.spaces.filter((s) => s.detected && (s.kind === 'lift' || s.kind === 'stairs')).length;
  const run = async () => {
    const bg = floor.background;
    if (!bg) return;
    setBusy(true);
    setMsg('');
    try {
      const px = await loadPixels(assetUrl(bg.src));
      const st = useStore.getState();
      const current = st.building.floors.find((f) => f.id === floor.id)!;
      // Sin los detectados antes: así volver a detectar los sustituye
      const { lifts, stairs } = detectLiftsAndStairs(px, {
        ...current,
        spaces: current.spaces.filter((s) => !(s.detected && (s.kind === 'lift' || s.kind === 'stairs'))),
      });
      const mk = (kind: SpaceKind, name: string, tags: string[]) => (r: Rect, i: number): Space => ({
        id: uid('s'),
        name: `${name} ${i + 1}`,
        kind,
        ...r,
        doors: [],
        tags,
        detected: true,
      });
      st.setDetectedSpaces(
        floor.id,
        [...lifts.map(mk('lift', t('kind_lift'), [])), ...stairs.map(mk('stairs', t('kind_stairs'), ['escalera']))],
        ['lift', 'stairs'],
      );
      st.setUi({ view: '2d', tool: 'select', showPhoto: true, selection: null });
      setMsg(t('connectorsDone', { l: lifts.length, s: stairs.length }));
    } catch {
      setMsg(t('detectWallsError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? t('detectWallsBusy') : t('detectConnectors')}
        </button>
        {detected > 0 && (
          <button
            className="btn danger ghost"
            onClick={() => useStore.getState().setDetectedSpaces(floor.id, [], ['lift', 'stairs'])}
          >
            {t('removeConnectors', { n: detected })}
          </button>
        )}
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </>
  );
}

/** Puertas para las estancias cerradas que no tienen ninguna, hacia el pasillo más cercano. */
export function AddDoors() {
  const t = useT();
  const floor = useActiveFloor();
  const [msg, setMsg] = useState('');
  const missing = floor.spaces.filter((s) => isEnclosed(s.kind) && !s.doors.length && !s.design).length;
  const run = () => {
    const res = useStore.getState().addMissingDoors(floor.id);
    setMsg(
      t('autoDoorsDone', { n: res.added }) +
        (res.stuck.length ? ' ' + t('autoDoorsStuck', { n: res.stuck.length, names: res.stuck.slice(0, 5).join(', ') }) : ''),
    );
  };
  return (
    <>
      <div className="row">
        <button className="btn" disabled={!missing} onClick={run}>
          {t('autoDoors', { n: missing })}
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </>
  );
}

const ZONE_KINDS: SpaceKind[] = ['room', 'meeting', 'restroom', 'kitchen', 'workspace', 'lobby', 'stairs', 'lift', 'obstacle', 'void'];

/** Tipo propuesto para un color: los rellenos muy claros y sin color suelen ser pasillo o fondo. */
function guessKind(color: string): SpaceKind | 'ignore' {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return sat < 25 && lum > 215 ? 'ignore' : 'room';
}

/** Detectar zonas por color: cada color de relleno de la foto se convierte en estancias del tipo elegido. */
export function DetectZones() {
  const t = useT();
  const floor = useActiveFloor();
  const [groups, setGroups] = useState<(ColorGroup & { kind: SpaceKind | 'ignore' })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const detected = floor.spaces.filter((s) => s.detected).length;

  const find = async () => {
    const bg = floor.background;
    if (!bg) return;
    setBusy(true);
    setMsg('');
    try {
      const px = await loadPixels(assetUrl(bg.src), 900);
      const found = detectColorZones(px, floor);
      setGroups(found.map((g) => ({ ...g, kind: guessKind(g.color) })));
      if (!found.length) setMsg(t('zonesNone'));
    } catch {
      setMsg(t('detectWallsError'));
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    if (!groups) return;
    const n: Partial<Record<SpaceKind, number>> = {};
    const spaces: Space[] = [];
    for (const g of groups) {
      if (g.kind === 'ignore') continue;
      const kind = g.kind;
      for (const z of g.zones) {
        n[kind] = (n[kind] ?? 0) + 1;
        spaces.push({
          id: uid('s'),
          name: `${t(kindKey(kind))} ${n[kind]}`,
          kind,
          ...z,
          doors: [],
          tags: [],
          color: g.color,
          detected: true,
        });
      }
    }
    const st = useStore.getState();
    st.setDetectedSpaces(floor.id, spaces);
    st.setUi({ view: '2d', tool: 'select', showPhoto: true, selection: null });
    setMsg(t('zonesDone', { n: spaces.length }));
    setGroups(null);
  };

  return (
    <>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void find()}>
          {busy ? t('detectWallsBusy') : t('detectZones')}
        </button>
        {detected > 0 && (
          <button className="btn danger ghost" onClick={() => useStore.getState().setDetectedSpaces(floor.id, [])}>
            {t('removeZones', { n: detected })}
          </button>
        )}
      </div>
      {groups && groups.length > 0 && (
        <>
          <ul className="space-list">
            {groups.map((g, i) => (
              <li key={g.color}>
                <span className="swatch" style={{ background: g.color }} />
                <span className="grow">{t('zonesCount', { n: g.zones.length, m: g.area })}</span>
                <select
                  value={g.kind}
                  onChange={(e) =>
                    setGroups(groups.map((x, j) => (j === i ? { ...x, kind: e.target.value as SpaceKind | 'ignore' } : x)))
                  }
                >
                  <option value="ignore">{t('zonesIgnore')}</option>
                  {ZONE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(kindKey(k))}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={create}>
            {t('zonesCreate', { n: groups.filter((g) => g.kind !== 'ignore').reduce((a, g) => a + g.zones.length, 0) })}
          </button>
        </>
      )}
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">{t('detectZonesHint')}</p>
    </>
  );
}

/**
 * Botones para subir la foto del plano (a la planta activa o a una planta nueva). `tool`: la
 * herramienta del editor 2D con la que se sigue después (calibrar la escala o enderezar).
 */
export function PhotoUpload({ tool = 'calibrate' }: { tool?: Tool }) {
  const t = useT();
  const floor = useActiveFloor();
  const inputRef = useRef<HTMLInputElement>(null);
  const asNewFloor = useRef(false);
  const [error, setError] = useState('');
  const bg = floor.background;

  const pick = (newFloor: boolean) => {
    asNewFloor.current = newFloor;
    inputRef.current?.click();
  };

  const onPhoto = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setError('');
    try {
      const { url, w, h } = await loadImageAsDataUrl(file);
      const st = useStore.getState();
      if (asNewFloor.current) st.addFloor('empty');
      const target = useStore.getState().building.floors.find((f) => f.id === useStore.getState().ui.activeFloorId)!;
      const bw = +(w * DEFAULT_PHOTO_SCALE).toFixed(2);
      const bd = +(h * DEFAULT_PHOTO_SCALE).toFixed(2);
      st.updateFloor(target.id, {
        background: { src: url, x: 0, z: 0, w: bw, d: bd, rotation: 0 },
        // En una planta vacía, el contorno empieza siendo el rectángulo de la foto
        ...(target.spaces.length
          ? {}
          : {
              outline: [
                { x: 0, z: 0 },
                { x: bw, z: 0 },
                { x: bw, z: bd },
                { x: 0, z: bd },
              ],
            }),
      });
      // Siguiente paso natural: fijar la escala sobre la foto en el editor 2D
      st.setUi({ showPhoto: true, view: '2d', tool, selection: null });
      // En una planta vacía, el contorno se ajusta al borde del edificio (sin título ni márgenes)
      if (!target.spaces.length) {
        const bg = useStore.getState().building.floors.find((f) => f.id === target.id)?.background;
        const pts = bg && (await outlineFromPhoto(bg).catch(() => null));
        if (pts) useStore.getState().setOutline(target.id, pts);
      }
    } catch {
      setError(t('importError'));
    }
  };

  return (
    <>
      <div className="row">
        <button className="btn" onClick={() => pick(false)}>
          {bg ? t('replacePhoto') : t('uploadPhoto')}
        </button>
        <button className="btn" onClick={() => pick(true)}>
          {t('newFloorFromPhoto')}
        </button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
      </div>
      {error && <p className="warning">⚠ {error}</p>}
    </>
  );
}

/** Foto del plano de la planta activa: subirla, detectar lo que contiene, moverla, girarla o quitarla. */
function PhotoSection() {
  const t = useT();
  const floor = useActiveFloor();
  const updateFloor = useStore((s) => s.updateFloor);
  const bg = floor.background;
  return (
    <>
      <h4>{t('floorPhoto')}</h4>
      <p className="muted small">{t('photoHint')}</p>
      <PhotoUpload />
      {bg && (
        <>
          <h4>{t('detectSection')}</h4>
          <FitOutline />
          <DetectZones />
          <DetectWalls />
          <DetectConnectors />
          <AddDoors />
          <ReadNames />
        </>
      )}
      {bg ? (
        <div className="row">
          <NumberField label={`${t('photoPosition')} x`} value={bg.x} step={0.25} onChange={(x) => updateFloor(floor.id, { background: { ...bg, x } })} />
          <NumberField label="z" value={bg.z} step={0.25} onChange={(z) => updateFloor(floor.id, { background: { ...bg, z } })} />
          <button
            className="btn"
            onClick={() => updateFloor(floor.id, { background: { ...bg, rotation: ((bg.rotation ?? 0) + 90) % 360 } })}
          >
            {t('rotatePhoto')}
          </button>
          <button className="btn danger ghost" onClick={() => updateFloor(floor.id, { background: undefined })}>
            {t('removePhoto')}
          </button>
        </div>
      ) : (
        <p className="muted small">{t('noPhoto')}</p>
      )}
    </>
  );
}

export default function DataPanel() {
  const t = useT();
  const floors = useStore((s) => s.building.floors);
  const activeFloorId = useStore((s) => s.ui.activeFloorId);
  const setUi = useStore((s) => s.setUi);
  const addFloor = useStore((s) => s.addFloor);
  const updateFloor = useStore((s) => s.updateFloor);
  const deleteFloor = useStore((s) => s.deleteFloor);
  const resetPlan = useStore((s) => s.resetPlan);
  const resetAll = useStore((s) => s.resetAll);
  const startTime = useStore((s) => s.startTime);
  const setStartTime = useStore((s) => s.setStartTime);

  return (
    <div className="panel">
      <BuildingsSection />

      <h4>{t('floors')}</h4>
      {[...floors]
        .sort((a, b) => b.level - a.level)
        .map((f) => (
          <div key={f.id} className={`floor-row${f.id === activeFloorId ? ' active' : ''}`}>
            <input type="radio" checked={f.id === activeFloorId} onChange={() => setUi({ activeFloorId: f.id, selection: null })} />
            <input className="grow" value={f.name} onChange={(e) => updateFloor(f.id, { name: e.target.value })} />
            <input
              className="name-en"
              title={t('nameEn')}
              value={f.nameEn ?? ''}
              placeholder={translateName(f.name, 'en')}
              onChange={(e) => updateFloor(f.id, { nameEn: e.target.value || undefined })}
            />
            <label className="field inline">
              <span>{t('level')}</span>
              <input
                type="number"
                value={f.level}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) updateFloor(f.id, { level: n });
                }}
              />
            </label>
            <select
              title={t('northDir')}
              value={f.northDir ?? ''}
              onChange={(e) => updateFloor(f.id, { northDir: (e.target.value || undefined) as NorthDir | undefined })}
            >
              <option value="">{t('northDir')}: —</option>
              {NORTH_DIRS.map((d) => (
                <option key={d} value={d}>
                  {t('northDir')} {t(`north_${d}` as TKey)}
                </option>
              ))}
            </select>
            <button
              className="icon danger"
              disabled={floors.length <= 1}
              title={t('deleteFloor')}
              onClick={() => window.confirm(t('confirmDeleteFloor', { name: f.name })) && deleteFloor(f.id)}
            >
              ✕
            </button>
          </div>
        ))}
      <div className="row">
        <button className="btn" onClick={() => addFloor('empty')}>
          {t('addFloorEmpty')}
        </button>
        <button className="btn" onClick={() => addFloor('copy')}>
          {t('addFloorCopy')}
        </button>
      </div>
      <p className="muted small">{t('floorsHint')}</p>
      {floors.length > 1 && <ConnectFloors />}

      <PhotoSection />

      <ImportLog />

      <ProjectFile />

      <h4>{t('startTime')}</h4>
      <input
        type="time"
        value={startTime == null ? '' : fmtClock(startTime)}
        onChange={(e) => setStartTime(parseClock(e.target.value))}
      />
      <p className="muted small">{t('startTimeHint')}</p>

      <h4>{t('data')}</h4>
      <p className="muted small">{t('storageNote')}</p>
      <div className="row">
        <button className="btn ghost" onClick={() => window.confirm(t('confirmReset')) && resetPlan()}>
          {t('resetPlan')}
        </button>
        <button className="btn danger ghost" onClick={() => window.confirm(t('confirmReset')) && resetAll()}>
          {t('resetAll')}
        </button>
      </div>
    </div>
  );
}
