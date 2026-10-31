import { useEffect, useState } from 'react';
import { fmtClock } from '../geometry';
import { useT } from '../i18n';
import { useStore } from '../store';
import {
  currentFileName,
  fileApiSupported,
  lastProject,
  openProjectFile,
  reloadProjectFile,
  saveProjectFile,
  saveProjectFileAs,
} from './projectFileApi';

let lastSaved: number | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Guarda en el archivo de proyecto (si hay uno abierto) cada vez que cambian los datos. */
export function useProjectAutosave() {
  const autoSave = useStore((s) => s.ui.autoSave);
  useEffect(() => {
    if (!autoSave) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((st, prev) => {
      const changed =
        st.building !== prev.building ||
        st.persons !== prev.persons ||
        st.rules !== prev.rules ||
        st.startTime !== prev.startTime ||
        st.areaMap !== prev.areaMap ||
        st.routines !== prev.routines;
      if (!changed || !currentFileName()) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await saveProjectFile();
          lastSaved = Date.now();
          notify();
        } catch {
          /* sin permiso o archivo movido: se avisa al guardar a mano */
        }
      }, 1500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [autoSave]);
}

export default function ProjectFile() {
  const t = useT();
  const autoSave = useStore((s) => s.ui.autoSave);
  const setUi = useStore((s) => s.setUi);
  const [, force] = useState(0);
  const [error, setError] = useState('');
  const [reopen, setReopen] = useState<{ name: string; open: () => Promise<void> } | null>(null);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (fileApiSupported() && !currentFileName()) lastProject().then((p) => p && setReopen(p));
    return () => {
      listeners.delete(l);
    };
  }, []);

  const run = (fn: () => Promise<void>, saved = false) => async () => {
    setError('');
    try {
      await fn();
      if (saved) lastSaved = Date.now();
      setReopen(null);
      notify();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(t('fileError', { e: (e as Error).message }));
    }
  };

  const name = currentFileName();
  return (
    <>
      <h4>{t('projectFile')}</h4>
      <p className="muted small">{t('projectFileHint')}</p>
      {!fileApiSupported() ? (
        <p className="warning">⚠ {t('fileApiUnsupported')}</p>
      ) : (
        <>
          <div className="row">
            <button className="btn" onClick={run(openProjectFile)}>
              {t('openProject')}
            </button>
            {reopen && !name && (
              <button className="btn" onClick={run(reopen.open)}>
                {t('reopenProject', { name: reopen.name })}
              </button>
            )}
            <button className="btn" onClick={run(name ? saveProjectFile : saveProjectFileAs, true)}>
              {name ? t('saveProject') : t('saveProjectAs')}
            </button>
            {name && (
              <button className="btn" onClick={run(reloadProjectFile)}>
                {t('reloadProject')}
              </button>
            )}
          </div>
          {name && (
            <p className="ok-note">
              {t('fileStatus', { name })}
              {lastSaved && ` · ${t('savedAt', { t: fmtClock(new Date(lastSaved).getHours() * 3600 + new Date(lastSaved).getMinutes() * 60 + new Date(lastSaved).getSeconds(), true) })}`}
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={autoSave} onChange={(e) => setUi({ autoSave: e.target.checked })} />
            {t('autoSave')}
          </label>
          {error && <p className="warning">⚠ {error}</p>}
        </>
      )}
    </>
  );
}
