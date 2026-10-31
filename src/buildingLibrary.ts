import type { ProjectData } from './types';

/**
 * Edificios guardados en este equipo. El edificio activo vive en el estado de la app (y se guarda
 * como siempre); los demás se guardan aquí, en la base de datos local del navegador o del programa,
 * cada uno con todos sus datos (plantas, personas, reglas, rutinas…).
 */
const DB = 'modelo-planta-3d-edificios';
const STORE = 'edificios';

function request<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

export const saveBuildingData = (id: string, data: ProjectData) => request('readwrite', (s) => s.put(data, id));

export const loadBuildingData = (id: string) => request<ProjectData | undefined>('readonly', (s) => s.get(id));

export const deleteBuildingData = (id: string) => request('readwrite', (s) => s.delete(id));
