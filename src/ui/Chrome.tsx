import type { ReactNode } from 'react';
import { fmtClock, fmtTime } from '../geometry';
import { useName, useT, type TKey } from '../i18n';
import { usePlans } from '../nav/PlansContext';
import { clock, setPlaying, setSpeed, setTime, useClockTick } from '../sim/clock';
import { useActiveFloor, useStore, type Tab } from '../store';
import { BackupButtons } from './BackupButtons';
import { BuildingPicker } from './BuildingPicker';
import BuilderPanel from './BuilderPanel';
import DataPanel from './DataPanel';
import PeoplePanel from './PeoplePanel';
import RoutinesPanel from './RoutinesPanel';
import RulesPanel from './RulesPanel';
import SpacesPanel from './SpacesPanel';

export function TopBar() {
  const t = useT();
  const name = useName();
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const floors = useStore((s) => s.building.floors);
  const floor = useActiveFloor();
  return (
    <header className="topbar">
      <button
        className={`btn small${ui.sidebarOpen ? ' active' : ''}`}
        title={t('panel')}
        onClick={() => setUi({ sidebarOpen: !ui.sidebarOpen })}
      >
        ☰
      </button>
      <div className="brand">
        <span className="logo">▦</span> {t('appTitle')}
      </div>
      <BuildingPicker />
      <label className="field inline">
        <span>{t('floor')}</span>
        <select value={floor.id} onChange={(e) => setUi({ activeFloorId: e.target.value, selection: null })}>
          {[...floors]
            .sort((a, b) => b.level - a.level)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {name(f)}
              </option>
            ))}
        </select>
      </label>
      <div className="seg">
        <button className={ui.view === '3d' ? 'on' : ''} onClick={() => setUi({ view: '3d' })}>
          {t('view3d')}
        </button>
        <button className={ui.view === '2d' ? 'on' : ''} onClick={() => setUi({ view: '2d' })}>
          {t('view2d')}
        </button>
      </div>
      <div className="toggles">
        <label className="check">
          <input type="checkbox" checked={ui.showLabels} onChange={(e) => setUi({ showLabels: e.target.checked })} />
          {t('labels')}
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.showRoutes} onChange={(e) => setUi({ showRoutes: e.target.checked })} />
          {t('routes')}
        </label>
        <label className="check" title={t('furnitureLayerHint')}>
          <input type="checkbox" checked={ui.showFurniture} onChange={(e) => setUi({ showFurniture: e.target.checked })} />
          {t('furnitureLayer')}
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.showPhoto} onChange={(e) => setUi({ showPhoto: e.target.checked })} />
          {t('photo')}
        </label>
        {ui.showPhoto && (
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            title={t('photoOpacity')}
            value={ui.photoOpacity}
            onChange={(e) => setUi({ photoOpacity: parseFloat(e.target.value) })}
          />
        )}
        {ui.view === '3d' && (
          <label className="check" title={t('wallHeight')}>
            ⇕
            <input
              type="range"
              min={0.3}
              max={3.5}
              step={0.1}
              value={ui.wallHeight}
              onChange={(e) => setUi({ wallHeight: parseFloat(e.target.value) })}
            />
          </label>
        )}
      </div>
      <BackupButtons />
      <div className="seg lang">
        <button className={ui.lang === 'es' ? 'on' : ''} onClick={() => setUi({ lang: 'es' })}>
          ES
        </button>
        <button className={ui.lang === 'en' ? 'on' : ''} onClick={() => setUi({ lang: 'en' })}>
          EN
        </button>
      </div>
    </header>
  );
}

const TABS: [Tab, TKey][] = [
  ['people', 'tabPeople'],
  ['routines', 'tabRoutines'],
  ['spaces', 'tabSpaces'],
  ['rules', 'tabRules'],
  ['data', 'tabData'],
  ['builder', 'tabBuilder'],
];

export function Sidebar() {
  const t = useT();
  const tab = useStore((s) => s.ui.tab);
  const open = useStore((s) => s.ui.sidebarOpen);
  const setUi = useStore((s) => s.setUi);
  if (!open) return null;
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {TABS.map(([id, key]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setUi({ tab: id })}>
            {t(key)}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === 'people' && <PeoplePanel />}
        {tab === 'routines' && <RoutinesPanel />}
        {tab === 'spaces' && <SpacesPanel />}
        {tab === 'rules' && <RulesPanel />}
        {tab === 'data' && <DataPanel />}
        {tab === 'builder' && <BuilderPanel />}
      </div>
    </aside>
  );
}

const SPEEDS = [1, 2, 5, 10, 20, 50, 100, 200, 500];

export function SimBar() {
  useClockTick();
  const t = useT();
  const { maxTime } = usePlans();
  const startTime = useStore((s) => s.startTime);
  return (
    <div className="simbar">
      {startTime != null && <span className="clock">{fmtClock(startTime + clock.t, true)}</span>}
      <button className="btn round" title={clock.playing ? t('pause') : t('play')} onClick={() => setPlaying(!clock.playing)}>
        {clock.playing ? '❚❚' : '▶'}
      </button>
      <button className="btn round" title={t('restart')} onClick={() => setTime(0)}>
        ⏮
      </button>
      <input
        className="timeline"
        type="range"
        min={0}
        max={Math.max(1, maxTime)}
        step={0.5}
        value={Math.min(clock.t, Math.max(1, maxTime))}
        onChange={(e) => setTime(parseFloat(e.target.value))}
      />
      <span className="time">
        {fmtTime(clock.t)} / {fmtTime(maxTime)}
      </span>
      <label className="field inline">
        <span>{t('simSpeed')}</span>
        <select value={clock.speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              ×{s}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <Sidebar />
        <main className="main">
          <div className="viewport">{children}</div>
          <SimBar />
        </main>
      </div>
    </div>
  );
}

export function PickBanner() {
  const t = useT();
  const pickId = useStore((s) => s.ui.pickPersonId);
  const person = useStore((s) => s.persons.find((p) => p.id === pickId));
  const setUi = useStore((s) => s.setUi);
  if (!person) return null;
  return (
    <div className="pick-banner" style={{ borderColor: person.color }}>
      <span className="dot" style={{ background: person.color }} />
      {t('pickBanner', { name: person.name })}
      <button className="btn small primary" onClick={() => setUi({ pickPersonId: null })}>
        {t('done')}
      </button>
    </div>
  );
}
