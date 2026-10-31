import { useRef, useState } from 'react';
import { loadBuildingData } from '../buildingLibrary';
import { useT } from '../i18n';
import { isAppBackup, isProjectData, projectDataOf, useStore, type AppBackup } from '../store';
import { askConfirm } from './AskDialog';
import { forgetProjectFile } from './projectFileApi';

/** Copia de toda la app (todos los edificios) en un archivo, para guardarla o llevarla a otro equipo. */
async function exportAll() {
  const st = useStore.getState();
  const buildings: AppBackup['buildings'] = [];
  for (const b of st.library) {
    // El edificio abierto, tal como está ahora; los demás, de la base de datos local
    const data = b.id === st.activeBuildingId ? projectDataOf(st) : await loadBuildingData(b.id);
    if (data) buildings.push({ ...b, data });
  }
  const backup: AppBackup = { kind: 'modelo-planta-copia', version: 1, activeBuildingId: st.activeBuildingId, buildings };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `modelo-planta-copia-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Exportar e importar todos los datos de la app: en la cabecera, a la derecha. */
export function BackupButtons() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (isAppBackup(data)) {
        // Copia completa: sustituye todos los edificios, así que se pide confirmación
        if (!(await askConfirm(t('confirmRestore', { n: data.buildings.length })))) return;
        forgetProjectFile();
        await useStore.getState().restoreBackup(data);
      } else if (isProjectData(data)) {
        // Un edificio suelto (o un proyecto antiguo): se añade sin borrar nada
        forgetProjectFile();
        await useStore.getState().addBuilding(data.name ?? file.name.replace(/\.json$/i, ''), data);
      } else throw new Error('invalid');
    } catch {
      void askConfirm(t('importError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="seg backup">
      <button title={t('exportAllHint')} disabled={busy} onClick={() => void exportAll()}>
        {t('exportAll')}
      </button>
      <button title={t('importAllHint')} disabled={busy} onClick={() => fileRef.current?.click()}>
        {t('importAll')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
    </div>
  );
}
