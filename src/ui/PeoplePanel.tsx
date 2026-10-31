import { fmtClock, fmtDist, fmtTime, parseClock } from '../geometry';
import { useName, useT, type TKey } from '../i18n';
import { usePlans } from '../nav/PlansContext';
import { samplePlan, usesGoodLift, type PersonPlan } from '../nav/planner';
import { clock, useClockTick } from '../sim/clock';
import { useStore } from '../store';
import type { Person } from '../types';
import { NumberField, SpaceSelect, TagInput, useAllTags } from './common';

function LiveStatus({ plan }: { plan: PersonPlan }) {
  useClockTick();
  const t = useT();
  const tn = useName();
  const floors = useStore((st) => st.building.floors);
  const s = samplePlan(plan, clock.t);
  if (!s) return null;
  const node = plan.nodes[s.node];
  const floor = floors.length > 1 ? floors.find((f) => f.id === node?.floorId) : undefined;
  const name = (node ? tn(node.space) : '') + (floor ? ` (${tn(floor)})` : '');
  return <div className={`live-status st-${s.state}`}>{t(`status_${s.state}` as TKey, { name })}</div>;
}

/** Compara el inicio, el fin y la duración registrados con los de la simulación. */
function RealVsSim({ plan }: { plan: PersonPlan }) {
  const t = useT();
  const startTime = useStore((s) => s.startTime);
  const { person } = plan;
  const rs = parseClock(person.real?.start);
  const re = parseClock(person.real?.end);
  if (startTime == null || rs == null || re == null || !plan.events.length) return null;
  const realDur = re - rs;
  const simStart = startTime + Math.max(0, person.startDelay);
  const simEnd = startTime + plan.endTime;
  const diff = plan.totalTime - realDur;
  return (
    <div className="realsim">
      <span />
      <span className="h">{t('real')}</span>
      <span className="h">{t('simulated')}</span>
      <span className="h">⏱</span>
      <span>
        {fmtClock(rs)} → {fmtClock(re)}
      </span>
      <span>
        {fmtClock(simStart)} → {fmtClock(simEnd, true)}
      </span>
      <span className="h">Σ</span>
      <b>{fmtTime(realDur)}</b>
      <b>{fmtTime(plan.totalTime)}</b>
      <span className="h">{t('difference')}</span>
      <span className={diff <= 0 ? 'good' : 'bad'} title={t('diffHint')}>
        {diff <= 0 ? '−' : '+'}
        {fmtTime(Math.abs(diff))}
      </span>
      <span />
    </div>
  );
}

function PlanSummary({ plan }: { plan: PersonPlan }) {
  const t = useT();
  const tn = useName();
  const { person } = plan;
  const n = plan.nodes.length;
  const saving =
    plan.originalDistance > 0 ? Math.round((1 - plan.optimizedDistance / plan.originalDistance) * 100) : 0;
  return (
    <div className="summary">
      <div className="stats">
        <div>
          <span>{t('distance')}</span>
          <b>{fmtDist(plan.distance)}</b>
        </div>
        <div>
          <span>{t('walkTime')}</span>
          <b>{fmtTime(plan.walkTime)}</b>
        </div>
        <div>
          <span>{t('totalTime')}</span>
          <b>{fmtTime(plan.totalTime)}</b>
        </div>
      </div>
      {person.real && (
        <>
          <span className="muted small">{t('realVsSim')}</span>
          <RealVsSim plan={plan} />
        </>
      )}
      {n > 2 && (
        <div className="compare">
          <div className={!person.optimize ? 'active' : ''}>
            <span>{t('originalOrder')}</span>
            <b>{fmtDist(plan.originalDistance)}</b>
          </div>
          <div className={person.optimize ? 'active' : ''}>
            <span>{t('optimizedOrder')}</span>
            <b>
              {fmtDist(plan.optimizedDistance)}
              {saving > 0 && <em className="saving"> {t('saving', { p: saving })}</em>}
            </b>
          </div>
          {saving <= 0 && <p className="muted small">{t('alreadyOptimal')}</p>}
        </div>
      )}
      {person.optimize && n > 1 && (
        <div className="visit-order">
          <span>{t('visitOrder')}:</span>{' '}
          {plan.order.map((i) => tn(plan.nodes[i].space)).join(' → ')}
          {person.returnToStart && ` → ${tn(plan.nodes[plan.order[0]].space)}`}
        </div>
      )}
      {plan.warnings.map((w) => (
        <div key={w.stopId} className="warning">
          ⚠ {t(`warn_${w.type}` as TKey, { name: tn(w.name) })}
        </div>
      ))}
    </div>
  );
}

/** Rutinas asignadas a la persona: se añaden a su itinerario en el orden más corto. */
function PersonRoutines({ person, plan }: { person: Person; plan?: PersonPlan }) {
  const t = useT();
  const routines = useStore((s) => s.routines);
  const updatePerson = useStore((s) => s.updatePerson);
  const setUi = useStore((s) => s.setUi);
  const assigned = person.routines ?? [];
  const routineStops = plan ? plan.nodes.filter((n) => n.stopIndex === -2).length : 0;
  return (
    <>
      <h4>{t('tabRoutines')}</h4>
      <div className="chips">
        {assigned.map((a) => {
          const r = routines.find((x) => x.id === a.routineId);
          if (!r) return null;
          return (
            <span key={a.routineId} className="chip" style={{ background: r.color + '22', color: r.color }}>
              {r.name}
              {a.targets && ` (${a.targets.length})`}
              <button
                type="button"
                title={t('remove')}
                onClick={() => updatePerson(person.id, { routines: assigned.filter((x) => x.routineId !== a.routineId) })}
              >
                ×
              </button>
            </span>
          );
        })}
        {!assigned.length && <span className="muted small">{t('noRoutines')}</span>}
      </div>
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) updatePerson(person.id, { routines: [...assigned, { routineId: e.target.value }] });
          }}
        >
          <option value="">{t('assignRoutine')}</option>
          {routines
            .filter((r) => !assigned.some((a) => a.routineId === r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
        <button className="btn small" onClick={() => setUi({ tab: 'routines' })}>
          {t('editRoutines')}
        </button>
      </div>
      {routineStops > 0 && <p className="muted small">{t('routineStopsInPlan', { n: routineStops })}</p>}
    </>
  );
}

function PersonCard({ person, plan, expanded }: { person: Person; plan?: PersonPlan; expanded: boolean }) {
  const t = useT();
  const setUi = useStore((s) => s.setUi);
  const updatePerson = useStore((s) => s.updatePerson);
  const deletePerson = useStore((s) => s.deletePerson);
  const addStop = useStore((s) => s.addStop);
  const updateStop = useStore((s) => s.updateStop);
  const moveStop = useStore((s) => s.moveStop);
  const removeStop = useStore((s) => s.removeStop);
  const picking = useStore((s) => s.ui.pickPersonId === person.id);
  const { personTags } = useAllTags();
  const set = (patch: Partial<Person>) => updatePerson(person.id, patch);

  const visitIndex = (stopId: string) => {
    if (!plan) return null;
    // Sin contar las paradas automáticas del good lift
    const k = plan.order
      .filter((i) => plan.nodes[i].stopIndex >= 0)
      .findIndex((i) => plan.nodes[i].stop.id === stopId);
    return k >= 0 ? k + 1 : null;
  };
  const warned = new Set(plan?.warnings.map((w) => w.stopId));

  // Horas simuladas de llegada y salida de cada parada (primera visita)
  const startTime = useStore((s) => s.startTime);
  const simTimes = new Map<string, { t0: number; t1: number }>();
  plan?.events.forEach((e) => {
    if (e.kind !== 'dwell') return;
    const id = plan.nodes[e.node].stop.id;
    if (!simTimes.has(id)) simTimes.set(id, { t0: e.t0, t1: e.t1 });
  });
  const clk = (s: number) => (startTime != null ? fmtClock(startTime + s) : fmtTime(s));

  return (
    <div className={`card person-card${expanded ? ' open' : ''}`}>
      <button className="card-head" onClick={() => setUi({ expandedPersonId: expanded ? null : person.id })}>
        <span className="dot" style={{ background: person.color }} />
        <span className="card-title">
          <b>{person.name}</b>
          <span className="muted small">
            {t('stopsCount', { n: person.stops.length })}
            {plan && plan.nodes.length > 1 && ` · ${fmtDist(plan.distance)} · ${fmtTime(plan.totalTime)}`}
          </span>
          {plan && <LiveStatus plan={plan} />}
        </span>
        <span className="chev">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="card-body">
          <div className="row">
            <label className="field grow">
              <span>{t('name')}</span>
              <input value={person.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('color')}</span>
              <input type="color" value={person.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>{t('tags')}</span>
            <TagInput value={person.tags} onChange={(tags) => set({ tags })} suggestions={personTags} />
          </label>
          <div className="row">
            <NumberField label={t('speed')} value={person.speed} step={0.1} min={0.2} onChange={(v) => set({ speed: v })} />
            <NumberField
              label={t('startDelay')}
              value={person.startDelay}
              step={5}
              min={0}
              onChange={(v) => set({ startDelay: Math.max(0, v) })}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={person.optimize} onChange={(e) => set({ optimize: e.target.checked })} />
            {t('optimize')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={person.returnToStart}
              onChange={(e) => set({ returnToStart: e.target.checked })}
            />
            {t('returnToStart')}
          </label>
          <label className="check" title={t('goodLiftEndsHint')}>
            <input
              type="checkbox"
              checked={usesGoodLift(person)}
              onChange={(e) => set({ goodLiftEnds: e.target.checked })}
            />
            {t('goodLiftEnds')}
          </label>
          <label className="check" title={t('holdUntilRealHint')}>
            <input
              type="checkbox"
              checked={!!person.holdUntilReal}
              onChange={(e) => set({ holdUntilReal: e.target.checked })}
            />
            {t('holdUntilReal')}
          </label>

          <h4>{t('itinerary')}</h4>
          <p className="muted small">{t('itineraryHint')}</p>
          {person.stops.length === 0 && <p className="muted">{t('noStops')}</p>}
          {person.stops.length > 0 && (
            <div className="stops-head muted small">
              <span />
              <span />
              <span>{t('dwell')}</span>
            </div>
          )}
          <ol className="stops">
            {person.stops.map((s, i) => {
              const v = person.optimize ? visitIndex(s.id) : null;
              return (
                <li key={s.id} className={warned.has(s.id) ? 'warn' : ''}>
                  <span className="num" style={{ borderColor: person.color }}>
                    {i === 0 ? '⌂' : i + 1}
                  </span>
                  <SpaceSelect
                    value={`${s.floorId}::${s.spaceId}`}
                    onChange={(floorId, spaceId) => updateStop(person.id, s.id, { floorId, spaceId })}
                  />
                  <input
                    className="dwell"
                    type="number"
                    min={0}
                    step={10}
                    title={t('dwell')}
                    value={s.dwell}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!Number.isNaN(n)) updateStop(person.id, s.id, { dwell: Math.max(0, n) });
                    }}
                  />
                  {v && v !== i + 1 ? (
                    <span className="visit" title={t('visitOrder')}>
                      #{v}
                    </span>
                  ) : (
                    <span className="visit" />
                  )}
                  <button className="icon" title={t('moveUp')} disabled={i === 0} onClick={() => moveStop(person.id, s.id, -1)}>
                    ↑
                  </button>
                  <button
                    className="icon"
                    title={t('moveDown')}
                    disabled={i === person.stops.length - 1}
                    onClick={() => moveStop(person.id, s.id, 1)}
                  >
                    ↓
                  </button>
                  <button className="icon danger" title={t('remove')} onClick={() => removeStop(person.id, s.id)}>
                    ✕
                  </button>
                  {(s.real?.start || simTimes.has(s.id)) && (
                    <div className="stop-times">
                      {s.real?.start && (
                        <>
                          {t('real')}{' '}
                          <b>
                            {s.real.start}
                            {s.real.end && `–${s.real.end}`}
                          </b>
                          {simTimes.has(s.id) && ' · '}
                        </>
                      )}
                      {simTimes.has(s.id) && (
                        <>
                          {t('simulated')}{' '}
                          <b>
                            {clk(simTimes.get(s.id)!.t0)}–{clk(simTimes.get(s.id)!.t1)}
                          </b>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="row">
            <SpaceSelect value="" placeholder={t('addStop')} onChange={(f, sp) => addStop(person.id, f, sp)} />
            <button
              className={`btn${picking ? ' active' : ''}`}
              onClick={() => setUi({ pickPersonId: picking ? null : person.id, selection: null })}
            >
              📍 {picking ? t('picking') : t('pickOnMap')}
            </button>
          </div>

          <PersonRoutines person={person} plan={plan} />

          {plan && <PlanSummary plan={plan} />}

          <button
            className="btn danger ghost"
            onClick={() => window.confirm(t('confirmDeletePerson', { name: person.name })) && deletePerson(person.id)}
          >
            {t('deletePerson')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function PeoplePanel() {
  const t = useT();
  const persons = useStore((s) => s.persons);
  const addPerson = useStore((s) => s.addPerson);
  const expanded = useStore((s) => s.ui.expandedPersonId);
  const { plans } = usePlans();
  return (
    <div className="panel">
      <button className="btn primary block" onClick={addPerson}>
        {t('addPerson')}
      </button>
      {persons.length === 0 && <p className="muted">{t('noPersons')}</p>}
      {persons.map((p) => (
        <PersonCard key={p.id} person={p} plan={plans.find((pl) => pl.person.id === p.id)} expanded={expanded === p.id} />
      ))}
    </div>
  );
}
