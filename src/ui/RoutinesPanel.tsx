import { useState } from 'react';
import { fmtTime, isDestination, isEnclosed, KINDS, parseClock } from '../geometry';
import { kindKey, useName, useT, type TKey } from '../i18n';
import { distributeTargets, fixtureTimes, itemLabel, routineTargets, targetInfo, targetKey } from '../routines';
import { FIXTURE_ICON, FIXTURE_ORDER } from './fixtureLabels';
import { useStore } from '../store';
import type { Routine, RoutineFilter, RoutineTarget, SpaceKind } from '../types';
import { NumberField, TagInput, useAllTags } from './common';

const DEST_KINDS = KINDS.filter(isDestination);

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`toggle-chip${on ? ' on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function FilterEditor({ filter, onChange, onRemove }: { filter: RoutineFilter; onChange: (f: RoutineFilter) => void; onRemove: () => void }) {
  const t = useT();
  const name = useName();
  const types = useStore((s) => s.building.itemTypes ?? []);
  const { spaceTags } = useAllTags();
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="filter-box">
      <div className="filter-head">
        <b>{filter.kind === 'spaces' ? t('filterSpaces') : t('filterItems')}</b>
        <button className="icon danger" title={t('remove')} onClick={onRemove}>
          ✕
        </button>
      </div>
      {filter.kind === 'spaces' ? (
        <>
          <div className="chips">
            {DEST_KINDS.map((k) => (
              <Toggle key={k} on={filter.spaceKinds.includes(k)} onClick={() => onChange({ ...filter, spaceKinds: toggle<SpaceKind>(filter.spaceKinds, k) })}>
                {t(kindKey(k))}
              </Toggle>
            ))}
          </div>
          <label className="field">
            <span>{t('filterTags')}</span>
            <TagInput value={filter.tags} onChange={(tags) => onChange({ ...filter, tags })} suggestions={spaceTags} />
          </label>
        </>
      ) : (
        <div className="chips">
          {types.map((tt) => (
            <Toggle key={tt.id} on={filter.typeIds.includes(tt.id)} onClick={() => onChange({ ...filter, typeIds: toggle(filter.typeIds, tt.id) })}>
              {tt.icon} {name(tt.name)}
            </Toggle>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutineCard({ routine, open, onToggle }: { routine: Routine; open: boolean; onToggle: () => void }) {
  const t = useT();
  const name = useName();
  const building = useStore((s) => s.building);
  const persons = useStore((s) => s.persons);
  const updateRoutine = useStore((s) => s.updateRoutine);
  const deleteRoutine = useStore((s) => s.deleteRoutine);
  const updatePerson = useStore((s) => s.updatePerson);
  const [roundText, setRoundText] = useState('');
  const [split, setSplit] = useState<string[]>([]);
  const set = (patch: Partial<Routine>) => updateRoutine(routine.id, patch);

  const targets = routineTargets(building, routine);
  const itemsCount = targets.filter((x) => x.itemId).length;
  const work = targets.reduce((acc, x) => acc + (targetInfo(building, routine, x)?.dwell ?? 0), 0);
  const assigned = persons.filter((p) => p.routines?.some((a) => a.routineId === routine.id));
  const parts = assigned.filter((p) => p.routines!.find((a) => a.routineId === routine.id)!.targets);
  const covered = new Set(parts.flatMap((p) => p.routines!.find((a) => a.routineId === routine.id)!.targets!));
  const uncovered = parts.length ? targets.filter((x) => !covered.has(targetKey(x))).length : 0;

  const assign = (personId: string, on: boolean) => {
    const p = persons.find((x) => x.id === personId)!;
    const rest = (p.routines ?? []).filter((a) => a.routineId !== routine.id);
    updatePerson(personId, { routines: on ? [...rest, { routineId: routine.id }] : rest });
  };

  const distribute = () => {
    const chosen = persons.filter((p) => split.includes(p.id));
    if (!chosen.length) return;
    const chunks = distributeTargets(building, routine, targets, chosen.length);
    for (const p of persons) {
      const rest = (p.routines ?? []).filter((a) => a.routineId !== routine.id);
      const k = chosen.indexOf(p);
      updatePerson(p.id, { routines: k >= 0 ? [...rest, { routineId: routine.id, targets: chunks[k] }] : rest });
    }
  };

  const addRound = () => {
    const s = parseClock(roundText);
    if (s === null) return;
    const clock = roundText.trim().replace(/^(\d):/, '0$1:');
    if (!routine.rounds.includes(clock)) set({ rounds: [...routine.rounds, clock].sort() });
    setRoundText('');
  };

  // Opciones para paradas extra: estancias con puerta y elementos de todas las plantas
  const extraOptions = building.floors.flatMap((f) => [
    ...f.spaces
      .filter((s) => isDestination(s.kind) && (!isEnclosed(s.kind) || s.doors.length))
      .map((s) => ({ key: targetKey({ floorId: f.id, spaceId: s.id }), label: `${name(f)} · ${name(s)}`, target: { floorId: f.id, spaceId: s.id } as RoutineTarget })),
    ...(building.items ?? [])
      .filter((i) => i.floorId === f.id)
      .map((i) => ({ key: targetKey({ floorId: f.id, itemId: i.id }), label: `${name(f)} · 📍 ${name(itemLabel(building, i))}`, target: { floorId: f.id, itemId: i.id } as RoutineTarget })),
  ]);

  return (
    <div className={`card person-card${open ? ' open' : ''}`}>
      <button className="card-head" onClick={onToggle}>
        <span className="dot" style={{ background: routine.color }} />
        <span className="card-title">
          <b>{name(routine.name)}</b>
          <span className="muted small">
            {t('routineSummary', { n: targets.length, i: itemsCount, w: fmtTime(work) })}
            {routine.rounds.length ? ` · ${routine.rounds.join(', ')}` : ` · ${t('onePass')}`}
          </span>
          <span className="muted small">{assigned.length ? `👤 ${assigned.map((p) => p.name).join(', ')}` : t('notAssigned')}</span>
        </span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="card-body">
          <div className="row">
            <label className="field grow">
              <span>{t('name')}</span>
              <input value={routine.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('color')}</span>
              <input type="color" value={routine.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
          </div>

          <h4>{t('routineWhat')}</h4>
          <p className="muted small">{t('routineWhatHint')}</p>
          {routine.filters.map((f, i) => (
            <FilterEditor
              key={i}
              filter={f}
              onChange={(nf) => set({ filters: routine.filters.map((x, j) => (j === i ? nf : x)) })}
              onRemove={() => set({ filters: routine.filters.filter((_, j) => j !== i) })}
            />
          ))}
          <div className="row">
            <button className="btn small" onClick={() => set({ filters: [...routine.filters, { kind: 'spaces', spaceKinds: [], tags: [] }] })}>
              {t('addFilterSpaces')}
            </button>
            <button className="btn small" onClick={() => set({ filters: [...routine.filters, { kind: 'items', typeIds: [] }] })}>
              {t('addFilterItems')}
            </button>
          </div>

          <h4>{t('routineFloors')}</h4>
          <div className="chips">
            {building.floors.map((f) => (
              <Toggle
                key={f.id}
                on={routine.floorIds.includes(f.id)}
                onClick={() =>
                  set({
                    floorIds: routine.floorIds.includes(f.id) ? routine.floorIds.filter((x) => x !== f.id) : [...routine.floorIds, f.id],
                  })
                }
              >
                {name(f)}
              </Toggle>
            ))}
          </div>
          <p className="muted small">{routine.floorIds.length ? '' : t('allFloors')}</p>

          <h4>{t('extraStops')}</h4>
          {routine.extra.map((x) => (
            <div key={targetKey(x)} className="map-row">
              <span className="map-label">{extraOptions.find((o) => o.key === targetKey(x))?.label ?? '?'}</span>
              <button className="icon danger" title={t('remove')} onClick={() => set({ extra: routine.extra.filter((y) => targetKey(y) !== targetKey(x)) })}>
                ✕
              </button>
            </div>
          ))}
          <select
            value=""
            onChange={(e) => {
              const o = extraOptions.find((x) => x.key === e.target.value);
              if (o) set({ extra: [...routine.extra, o.target] });
            }}
          >
            <option value="">{t('addExtraStop')}</option>
            {extraOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>

          <NumberField label={t('dwellPerSpace')} value={routine.dwell} step={30} min={0} onChange={(dwell) => set({ dwell: Math.max(0, dwell) })} />
          <label className="check small">
            <input type="checkbox" checked={routine.byFixtures !== false} onChange={(e) => set({ byFixtures: e.target.checked })} />
            {t('byFixtures')}
          </label>

          <h4>{t('rounds')}</h4>
          <div className="chips">
            {routine.rounds.map((r) => (
              <span key={r} className="chip">
                🕒 {r}
                <button type="button" onClick={() => set({ rounds: routine.rounds.filter((x) => x !== r) })}>
                  ×
                </button>
              </span>
            ))}
            {!routine.rounds.length && <span className="muted small">{t('onePassHint')}</span>}
          </div>
          <div className="row">
            <input type="time" value={roundText} onChange={(e) => setRoundText(e.target.value)} />
            <button className="btn small" onClick={addRound}>
              {t('addRound')}
            </button>
          </div>

          <h4>{t('assignTo')}</h4>
          <div className="chips">
            {persons.map((p) => {
              const a = p.routines?.find((x) => x.routineId === routine.id);
              return (
                <Toggle key={p.id} on={!!a} onClick={() => assign(p.id, !a)}>
                  <span className="dot" style={{ background: p.color }} /> {p.name}
                  {a?.targets && ` (${a.targets.length})`}
                </Toggle>
              );
            })}
          </div>
          {uncovered > 0 && <p className="warning">⚠ {t('uncoveredTargets', { n: uncovered })}</p>}

          <h4>{t('distribute')}</h4>
          <p className="muted small">{t('distributeHint')}</p>
          <div className="chips">
            {persons.map((p) => (
              <Toggle
                key={p.id}
                on={split.includes(p.id)}
                onClick={() => setSplit(split.includes(p.id) ? split.filter((x) => x !== p.id) : [...split, p.id])}
              >
                <span className="dot" style={{ background: p.color }} /> {p.name}
              </Toggle>
            ))}
          </div>
          <button className="btn small primary" disabled={!split.length || !targets.length} onClick={distribute}>
            {t('distributeBtn', { n: split.length })}
          </button>

          <button className="btn danger ghost" onClick={() => window.confirm(t('confirmDeleteRoutine', { name: routine.name })) && deleteRoutine(routine.id)}>
            {t('deleteRoutine')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Segundos de limpieza por cada sanitario, comunes a todas las rutinas. */
function FixtureTimesEditor() {
  const t = useT();
  const building = useStore((s) => s.building);
  const setTimes = useStore((s) => s.setFixtureTimes);
  const times = fixtureTimes(building);
  return (
    <details className="card">
      <summary>
        🚽 <b>{t('fixtureTimes')}</b>
      </summary>
      <p className="muted small">{t('fixtureTimesHint')}</p>
      <div className="grid4">
        <NumberField label={`${t('fixtureBase')} (s)`} value={times.base} step={15} min={0} onChange={(base) => setTimes({ base: Math.max(0, base) })} />
        {FIXTURE_ORDER.map((k) => (
          <NumberField
            key={k}
            label={`${FIXTURE_ICON[k]} ${t(`fx_${k}` as TKey)} (s)`}
            value={times[k]}
            step={15}
            min={0}
            onChange={(v) => setTimes({ [k]: Math.max(0, v) })}
          />
        ))}
      </div>
    </details>
  );
}

export default function RoutinesPanel() {
  const t = useT();
  const routines = useStore((s) => s.routines);
  const addRoutine = useStore((s) => s.addRoutine);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="panel">
      <p className="intro">{t('routinesIntro')}</p>
      <FixtureTimesEditor />
      <button className="btn primary block" onClick={() => setOpen(addRoutine())}>
        {t('addRoutine')}
      </button>
      {routines.map((r) => (
        <RoutineCard key={r.id} routine={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
      ))}
    </div>
  );
}
