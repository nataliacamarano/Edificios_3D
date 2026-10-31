import { useState, type ReactNode } from 'react';
import { commonNorth, withGoodLift } from '../connectorDetect';
import { isEnclosed, isGoodLift } from '../geometry';
import { useName, useT, type TKey } from '../i18n';
import { useActiveFloor, useStore, type Tool } from '../store';
import type { Floor } from '../types';
import { AddDoors, ConnectFloors, DetectConnectors, DetectWalls, DetectZones, FitOutline, PhotoUpload, ReadNames } from './DataPanel';

/**
 * Constructor de planta: lleva paso a paso de la foto de un plano a la planta lista para las rutas
 * de limpieza, con las mismas herramientas que la pestaña Datos y el editor 2D. Los pasos que se
 * pueden comprobar se marcan solos; los demás, con «Hecho». Lo marcado se guarda con la planta.
 */
interface Step {
  id: string;
  /** Hecho sin que haga falta marcarlo (se ve en los datos de la planta). */
  auto?: (f: Floor) => boolean;
  /** Herramienta del editor 2D que usa el paso. */
  tool?: Tool;
  body?: () => ReactNode;
}

const STEPS: Step[] = [
  { id: 'photo', auto: (f) => !!f.background, body: () => <PhotoUpload tool="rectify" /> },
  { id: 'rectify', tool: 'rectify' },
  { id: 'scale', tool: 'calibrate' },
  { id: 'outline', tool: 'outline', body: () => <FitOutline /> },
  { id: 'zones', auto: (f) => f.spaces.length > 0, body: () => <DetectZones /> },
  { id: 'walls', auto: (f) => f.walls.length > 0, body: () => <DetectWalls /> },
  { id: 'connectors', auto: (f) => f.spaces.some((s) => s.kind === 'lift' || s.kind === 'stairs'), body: () => <DetectConnectors /> },
  {
    id: 'doors',
    auto: (f) => f.spaces.some((s) => isEnclosed(s.kind)) && f.spaces.every((s) => !isEnclosed(s.kind) || s.doors.length > 0 || !!s.design),
    tool: 'door',
    body: () => <AddDoors />,
  },
  { id: 'names', body: () => <ReadNames /> },
  { id: 'goodlift', auto: (f) => f.spaces.some(isGoodLift), body: () => <GoodLifts /> },
  { id: 'review' },
];

/** Ascensores de la planta con su casilla de good lift y su lado, sin tener que buscarlos en el plano. */
function GoodLifts() {
  const t = useT();
  const name = useName();
  const floor = useActiveFloor();
  const lifts = floor.spaces.filter((s) => s.kind === 'lift');
  if (!lifts.length) return <p className="muted small">{t('b_noLifts')}</p>;
  const st = () => useStore.getState();
  return (
    <ul className="space-list">
      {lifts.map((s) => (
        <li key={s.id}>
          <label className="check grow">
            <input
              type="checkbox"
              checked={isGoodLift(s)}
              onChange={(e) =>
                st().updateSpace(floor.id, s.id, {
                  tags: withGoodLift(s, floor, e.target.checked, commonNorth(st().building.floors)).tags,
                })
              }
            />
            {name(s)}
          </label>
          {isGoodLift(s) && (
            <select
              value={s.tags.includes('lado sur') ? 'lado sur' : 'lado norte'}
              onChange={(e) =>
                st().updateSpace(floor.id, s.id, {
                  tags: [...s.tags.filter((tg) => tg !== 'lado norte' && tg !== 'lado sur'), e.target.value],
                })
              }
            >
              <option value="lado norte">{t('sideNorth')}</option>
              <option value="lado sur">{t('sideSouth')}</option>
            </select>
          )}
          <button className="btn small" onClick={() => st().select({ type: 'space', floorId: floor.id, id: s.id })}>
            {t('b_show')}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function BuilderPanel() {
  const t = useT();
  const name = useName();
  const floor = useActiveFloor();
  const floors = useStore((s) => s.building.floors);
  const ui = useStore((s) => s.ui);
  const manual = new Set(floor.builderDone ?? []);
  const isDone = (s: Step) => manual.has(s.id) || !!s.auto?.(floor);
  const firstOpen = STEPS.find((s) => !isDone(s))?.id ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const current = open ?? firstOpen;
  const doneCount = STEPS.filter(isDone).length;

  const mark = (id: string, done: boolean) => {
    const set = new Set(manual);
    if (done) set.add(id);
    else set.delete(id);
    useStore.getState().updateFloor(floor.id, { builderDone: [...set] });
    setOpen(null);
  };
  const useTool = (tool: Tool) => useStore.getState().setUi({ view: '2d', tool, showPhoto: true, selection: null });

  return (
    <div className="panel builder">
      <p className="muted small">{t('b_intro')}</p>
      <div className="builder-progress">
        <b>{name(floor)}</b>
        <span className="muted small">{t('b_progress', { n: doneCount, m: STEPS.length })}</span>
        <div className="bar">
          <div style={{ width: `${(100 * doneCount) / STEPS.length}%` }} />
        </div>
      </div>

      <ol className="builder-steps">
        {STEPS.map((s, i) => {
          const done = isDone(s);
          const expanded = current === s.id;
          return (
            <li key={s.id} className={`${done ? 'done' : ''}${expanded ? ' open' : ''}`}>
              <button className="builder-head" onClick={() => setOpen(expanded ? '' : s.id)}>
                <span className="num">{done ? '✓' : i + 1}</span>
                <span className="grow">{t(`b_${s.id}` as TKey)}</span>
              </button>
              {expanded && (
                <div className="builder-body">
                  <p className="small">{t(`b_${s.id}_hint` as TKey)}</p>
                  {s.tool && (
                    <div className="row">
                      <button className={`btn${ui.tool === s.tool && ui.view === '2d' ? ' active' : ''}`} onClick={() => useTool(s.tool!)}>
                        {t(`b_${s.id}_tool` as TKey)}
                      </button>
                    </div>
                  )}
                  {s.id === 'review' && (
                    <div className="row">
                      <button className="btn" onClick={() => useStore.getState().setUi({ view: '3d' })}>
                        {t('view3d')}
                      </button>
                      <button className="btn" onClick={() => useStore.getState().setUi({ tab: 'spaces' })}>
                        {t('b_review_spaces')}
                      </button>
                    </div>
                  )}
                  {s.body?.()}
                  <div className="row builder-actions">
                    {!s.auto?.(floor) &&
                      (manual.has(s.id) ? (
                        <button className="btn ghost small" onClick={() => mark(s.id, false)}>
                          {t('b_undo')}
                        </button>
                      ) : (
                        <button className="btn primary small" onClick={() => mark(s.id, true)}>
                          {t('b_done')}
                        </button>
                      ))}
                    {s.auto?.(floor) && <span className="muted small">✓ {t('b_autoDone')}</span>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <h4>{t('b_building')}</h4>
      <p className="muted small">{t('b_nextFloor')}</p>
      <PhotoUpload tool="rectify" />
      {floors.length > 1 && <ConnectFloors />}
    </div>
  );
}
