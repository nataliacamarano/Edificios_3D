import { useState } from 'react';
import {
  fmtTime,
  GOOD_LIFT_COLOR,
  isConnector,
  isDestination,
  isEnclosed,
  isGoodLift,
  KIND_COLORS,
  KINDS,
  SIDES,
  spaceColor,
  uid,
} from '../geometry';
import { kindKey, translateName, useName, useT, useTagName, type TKey } from '../i18n';
import { useActiveFloor, useStore } from '../store';
import { FURNITURE_KINDS, FURNITURE_STYLE } from '../furniture';
import type { Floor, Furniture, FurnitureKind, Side, Space, SpaceKind, Wall } from '../types';
import { NumberField, TagInput, useAllTags } from './common';
import { ItemEditor, ItemList, ItemTypesManager } from './ItemsSection';
import { FIXTURE_ICON, FIXTURE_ORDER } from './fixtureLabels';
import { fixtureCleaningTime, fixtureCounts } from '../routines';
import { commonNorth, withGoodLift } from '../connectorDetect';

function SpaceEditor({ floor, space }: { floor: Floor; space: Space }) {
  const t = useT();
  const name = useName();
  const updateSpace = useStore((s) => s.updateSpace);
  const deleteSpace = useStore((s) => s.deleteSpace);
  const select = useStore((s) => s.select);
  const persons = useStore((s) => s.persons);
  const addStop = useStore((s) => s.addStop);
  const { spaceTags } = useAllTags();
  const set = (patch: Partial<Space>) => updateSpace(floor.id, space.id, patch);
  const setDoor = (id: string, patch: Partial<Space['doors'][number]>) =>
    set({ doors: space.doors.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  return (
    <div className="card editor">
      <div className="editor-head">
        <span className="swatch" style={{ background: spaceColor(space) }} />
        <b>{name(space)}</b>
        <button className="icon" title={t('close')} onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <label className="field">
        <span>{t('name')}</span>
        <input value={space.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('nameEn')}</span>
        <input
          value={space.nameEn ?? ''}
          placeholder={translateName(space.name, 'en')}
          onChange={(e) => set({ nameEn: e.target.value || undefined })}
        />
      </label>
      <div className="row">
        <label className="field grow">
          <span>{t('kind')}</span>
          <select
            value={space.kind}
            onChange={(e) => {
              const kind = e.target.value as SpaceKind;
              const doors =
                isEnclosed(kind) && !space.doors.length ? [{ id: uid('d'), side: 's' as Side, offset: 0.5, width: 0.9 }] : space.doors;
              set({ kind, doors });
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(kindKey(k))}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('color')}</span>
          <div className="row tight">
            <input
              type="color"
              value={spaceColor(space)}
              onChange={(e) => set({ color: e.target.value })}
            />
            {space.color && (
              <button className="btn small" onClick={() => set({ color: undefined })}>
                {t('defaultColor')}
              </button>
            )}
          </div>
        </label>
      </div>
      <label className="field">
        <span>{t('tags')}</span>
        <TagInput value={space.tags} onChange={(tags) => set({ tags })} suggestions={spaceTags} />
      </label>

      {space.kind === 'restroom' && <FixtureSummary space={space} />}

      <h4>{t('geometry')}</h4>
      <div className="grid4">
        <NumberField label="x" value={space.x} step={0.25} onChange={(x) => set({ x })} />
        <NumberField label="z" value={space.z} step={0.25} onChange={(z) => set({ z })} />
        <NumberField label="↔" value={space.w} step={0.25} min={0.5} onChange={(w) => set({ w: Math.max(0.5, w) })} />
        <NumberField label="↕" value={space.d} step={0.25} min={0.5} onChange={(d) => set({ d: Math.max(0.5, d) })} />
      </div>

      {(isEnclosed(space.kind) || space.kind === 'lobby') && (
        <>
          <h4>{t('doors')}</h4>
          {space.doors.length === 0 && isEnclosed(space.kind) && <p className="warning">⚠ {t('noDoors')}</p>}
          {space.doors.map((d) => (
            <div key={d.id} className="door-row">
              <select value={d.side} onChange={(e) => setDoor(d.id, { side: e.target.value as Side })}>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {t(`side_${s}` as TKey)}
                  </option>
                ))}
              </select>
              <input
                type="range"
                min={0.05}
                max={0.95}
                step={0.01}
                title={t('offset')}
                value={d.offset}
                onChange={(e) => setDoor(d.id, { offset: parseFloat(e.target.value) })}
              />
              <input
                type="number"
                min={0.5}
                max={4}
                step={0.1}
                title={t('width')}
                value={d.width}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!Number.isNaN(n)) setDoor(d.id, { width: n });
                }}
              />
              <button className="icon danger" title={t('remove')} onClick={() => set({ doors: space.doors.filter((x) => x.id !== d.id) })}>
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn small"
            onClick={() => set({ doors: [...space.doors, { id: uid('d'), side: 's', offset: 0.5, width: 0.9 }] })}
          >
            {t('addDoor')}
          </button>
        </>
      )}

      {space.kind === 'lift' && (
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={isGoodLift(space)} onChange={(e) =>
                set({ tags: withGoodLift(space, floor, e.target.checked, commonNorth(useStore.getState().building.floors)).tags })
              }
            />
            {t('goodLiftToggle')}
          </label>
          {isGoodLift(space) && (
            <select
              value={space.tags.includes('lado sur') ? 'lado sur' : 'lado norte'}
              onChange={(e) =>
                set({ tags: [...space.tags.filter((tg) => tg !== 'lado norte' && tg !== 'lado sur'), e.target.value] })
              }
            >
              <option value="lado norte">{t('sideNorth')}</option>
              <option value="lado sur">{t('sideSouth')}</option>
            </select>
          )}
        </div>
      )}

      {isConnector(space.kind) && (
        <label className="field">
          <span>{t('connector')}</span>
          <input value={space.connectorId ?? ''} onChange={(e) => set({ connectorId: e.target.value || undefined })} />
          <small className="muted">{t('connectorHint')}</small>
        </label>
      )}

      {isDestination(space.kind) && persons.length > 0 && (
        <label className="field">
          <span>{t('addToItinerary')}</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addStop(e.target.value, floor.id, space.id);
            }}
          >
            <option value="">—</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <button className="btn danger ghost" onClick={() => deleteSpace(floor.id, space.id)}>
        {t('deleteSpace')}
      </button>
    </div>
  );
}

function WallEditor({ floor, wall }: { floor: Floor; wall: Wall }) {
  const t = useT();
  const updateWall = useStore((s) => s.updateWall);
  const deleteWall = useStore((s) => s.deleteWall);
  const select = useStore((s) => s.select);
  const set = (patch: Partial<Wall>) => updateWall(floor.id, wall.id, patch);
  return (
    <div className="card editor">
      <div className="editor-head">
        <b>{t('wall')}</b>
        <button className="icon" title={t('close')} onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <h4>{t('from')}</h4>
      <div className="row">
        <NumberField label="x" value={wall.a.x} step={0.25} onChange={(x) => set({ a: { ...wall.a, x } })} />
        <NumberField label="z" value={wall.a.z} step={0.25} onChange={(z) => set({ a: { ...wall.a, z } })} />
      </div>
      <h4>{t('to')}</h4>
      <div className="row">
        <NumberField label="x" value={wall.b.x} step={0.25} onChange={(x) => set({ b: { ...wall.b, x } })} />
        <NumberField label="z" value={wall.b.z} step={0.25} onChange={(z) => set({ b: { ...wall.b, z } })} />
      </div>
      <button className="btn danger ghost" onClick={() => deleteWall(floor.id, wall.id)}>
        {t('deleteWall')}
      </button>
    </div>
  );
}

/** Sanitarios del aseo y su tiempo de limpieza. */
function FixtureSummary({ space }: { space: Space }) {
  const t = useT();
  const building = useStore((s) => s.building);
  const counts = fixtureCounts(space);
  const time = fixtureCleaningTime(building, space);
  return (
    <>
      <h4>{t('fixtures')}</h4>
      {space.fixtures?.length ? (
        <>
          <div className="chips">
            {FIXTURE_ORDER.filter((k) => counts[k]).map((k) => (
              <span key={k} className="chip">
                {FIXTURE_ICON[k]} {counts[k]} {t(`fx_${k}` as TKey)}
              </span>
            ))}
          </div>
          {time !== null && (
            <p className="muted small">
              {t('cleaningTime')}: <b>{fmtTime(time)}</b>
            </p>
          )}
        </>
      ) : (
        <p className="muted small">{t('noFixtures')}</p>
      )}
    </>
  );
}

function FurnitureEditor({ floor, item }: { floor: Floor; item: Furniture }) {
  const t = useT();
  const name = useName();
  const update = useStore((s) => s.updateFurniture);
  const remove = useStore((s) => s.deleteFurniture);
  const add = useStore((s) => s.addFurniture);
  const select = useStore((s) => s.select);
  const set = (patch: Partial<Furniture>) => update(floor.id, item.id, patch);
  return (
    <div className="card editor">
      <div className="editor-head">
        <span className="swatch" style={{ background: FURNITURE_STYLE[item.kind]?.color }} />
        <b>{item.label ? name(item.label) : t(`furn_${item.kind}` as TKey)}</b>
        <button className="icon" title={t('close')} onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <label className="field">
        <span>{t('kind')}</span>
        <select value={item.kind} onChange={(e) => set({ kind: e.target.value as FurnitureKind })}>
          {FURNITURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {FURNITURE_STYLE[k].icon} {t(`furn_${k}` as TKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('furnitureLabel')}</span>
        <input value={item.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} />
      </label>
      <div className="row">
        <NumberField label="x" value={item.x} step={0.25} onChange={(x) => set({ x })} />
        <NumberField label="z" value={item.z} step={0.25} onChange={(z) => set({ z })} />
        <NumberField label="↔" value={item.w} step={0.25} min={0.2} onChange={(w) => set({ w })} />
        <NumberField label="↕" value={item.d} step={0.25} min={0.2} onChange={(d) => set({ d })} />
      </div>
      <div className="row">
        <button
          className="btn ghost"
          onClick={() => {
            const copy = { ...item, id: uid('m'), x: item.x + 0.5, z: item.z + 0.5 };
            add(floor.id, copy);
            select({ type: 'furniture', floorId: floor.id, id: copy.id });
          }}
        >
          {t('duplicate')}
        </button>
        <button className="btn danger ghost" onClick={() => remove(floor.id, item.id)}>
          {t('deleteFurniture')}
        </button>
      </div>
    </div>
  );
}

export default function SpacesPanel() {
  const t = useT();
  const name = useName();
  const tg = useTagName();
  const floor = useActiveFloor();
  const selection = useStore((s) => s.ui.selection);
  const select = useStore((s) => s.select);
  const [q, setQ] = useState('');

  const selSpace = selection?.type === 'space' ? floor.spaces.find((s) => s.id === selection.id) : undefined;
  const selWall = selection?.type === 'wall' ? floor.walls.find((w) => w.id === selection.id) : undefined;
  const items = useStore((s) => s.building.items ?? []);
  const selItem = selection?.type === 'item' ? items.find((i) => i.id === selection.id) : undefined;
  const selFurniture = selection?.type === 'furniture' ? floor.furniture?.find((m) => m.id === selection.id) : undefined;
  const furnitureCount = floor.furniture?.length ?? 0;
  const query = q.trim().toLowerCase();

  return (
    <div className="panel">
      {selSpace && <SpaceEditor key={selSpace.id} floor={floor} space={selSpace} />}
      {selWall && <WallEditor key={selWall.id} floor={floor} wall={selWall} />}
      {selItem && <ItemEditor key={selItem.id} item={selItem} />}
      {selFurniture && <FurnitureEditor key={selFurniture.id} floor={floor} item={selFurniture} />}
      <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ItemList query={q} />
      <ItemTypesManager />
      <details>
        <summary>
          🪑 {t('furniture')} <span className="count">{furnitureCount}</span>
        </summary>
        <p className="muted small">{t('furnitureHint')}</p>
      </details>
      {KINDS.map((k) => {
        const list = floor.spaces
          .filter((s) => s.kind === k && (!query || s.name.toLowerCase().includes(query) || name(s).toLowerCase().includes(query) || s.tags.some((x) => x.includes(query))))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return null;
        return (
          <details key={k} open={k !== 'obstacle' || !!query}>
            <summary>
              <span className="swatch" style={{ background: KIND_COLORS[k] }} />
              {t(kindKey(k))} <span className="count">{list.length}</span>
            </summary>
            <ul className="space-list">
              {list.map((s) => (
                <li
                  key={s.id}
                  className={selection?.id === s.id ? 'sel' : ''}
                  onClick={() => select({ type: 'space', floorId: floor.id, id: s.id })}
                >
                  {isGoodLift(s) && <span className="swatch" style={{ background: GOOD_LIFT_COLOR }} />}
                  <span>{name(s)}</span>
                  {s.tags.map((tag) => (
                    <span key={tag} className="chip small">
                      {tg(tag)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
