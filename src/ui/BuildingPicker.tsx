import { useRef, useState } from 'react';
import { useT } from '../i18n';
import { isProjectData, projectDataOf, useStore } from '../store';
import { askConfirm, askText } from './AskDialog';
import { forgetProjectFile } from './projectFileApi';

/** Descarga el edificio abierto como archivo, para llevarlo a otro equipo o a otra ventana. */
function exportBuilding(name: string) {
  const data = { ...projectDataOf(useStore.getState()), name };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Acciones comunes: crear, abrir y renombrar edificios (el archivo compartido se desconecta). */
export function useBuildingActions() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      void askConfirm(t('buildingError'));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    create: async () => {
      const name = (await askText(t('newBuildingPrompt'), t('newBuildingDefault')))?.trim();
      if (!name) return;
      forgetProjectFile();
      void run(() => useStore.getState().newBlankBuilding(name));
    },
    open: (id: string) => {
      forgetProjectFile();
      void run(() => useStore.getState().switchBuilding(id));
    },
    /** Archivo de edificio (o de proyecto) → edificio nuevo en la biblioteca, sin tocar el abierto. */
    importBuilding: (file: File) =>
      run(async () => {
        const data = JSON.parse(await file.text());
        if (!isProjectData(data)) throw new Error('invalid');
        const name = data.name ?? file.name.replace(/\.json$/i, '');
        forgetProjectFile();
        await useStore.getState().addBuilding(name, data);
      }),
    rename: async (id: string, current: string) => {
      const name = (await askText(t('renamePrompt'), current))?.trim();
      if (name) useStore.getState().renameBuilding(id, name);
    },
  };
}

/** Selector de edificio de la barra superior. */
export function BuildingPicker() {
  const t = useT();
  const library = useStore((s) => s.library);
  const active = useStore((s) => s.activeBuildingId);
  const { busy, create, open, rename } = useBuildingActions();
  const current = library.find((b) => b.id === active);
  return (
    <label className="field inline">
      <span>{t('building')}</span>
      <select
        value={active}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') void create();
          else if (v === '__rename') void rename(active, current?.name ?? '');
          else open(v);
        }}
      >
        {library.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option disabled>──────────</option>
        <option value="__new">{t('newBuilding')}</option>
        <option value="__rename">{t('renameBuilding')}</option>
      </select>
    </label>
  );
}

/** Lista de edificios de la pestaña Datos: abrir, renombrar, borrar y crear uno en blanco. */
export function BuildingsSection() {
  const t = useT();
  const library = useStore((s) => s.library);
  const active = useStore((s) => s.activeBuildingId);
  const autoFurnish = useStore((s) => s.building.autoFurnish !== false);
  const { busy, create, open, rename, importBuilding } = useBuildingActions();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <h4>{t('buildings')}</h4>
      <p className="muted small">{t('buildingsHint')}</p>
      <ul className="space-list">
        {library.map((b) => (
          <li key={b.id} className={b.id === active ? 'sel' : ''}>
            <span>{b.name}</span>
            {b.id === active ? (
              <span className="chip small">{t('activeBuilding')}</span>
            ) : (
              <button className="btn small" disabled={busy} onClick={() => open(b.id)}>
                {t('openBuilding')}
              </button>
            )}
            <button className="btn small" onClick={() => void rename(b.id, b.name)}>
              ✎
            </button>
            {b.id !== active && (
              <button
                className="btn small danger ghost"
                disabled={busy}
                onClick={async () =>
                  (await askConfirm(t('confirmDeleteBuilding', { name: b.name }))) && void useStore.getState().deleteBuilding(b.id)
                }
              >
                {t('deleteBuilding')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button className="btn" disabled={busy} onClick={() => void create()}>
        {t('newBuilding')}
      </button>
      <div className="row">
        <button className="btn" onClick={() => exportBuilding(library.find((b) => b.id === active)?.name ?? 'edificio')}>
          {t('exportBuilding')}
        </button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('importBuilding')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importBuilding(file);
          }}
        />
      </div>
      <p className="muted small">{t('importBuildingHint')}</p>
      <p className="muted small">{t('buildingFileNote')}</p>
      <label className="check">
        <input type="checkbox" checked={autoFurnish} onChange={(e) => useStore.getState().setAutoFurnish(e.target.checked)} />
        {t('autoFurnish')}
      </label>
      <p className="muted small">{t('autoFurnishHint')}</p>
    </>
  );
}
