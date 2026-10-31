import { isProjectData, useStore } from '../store';
import type { ProjectData } from '../types';

/**
 * Archivo de proyecto compartido (p. ej. en una carpeta de OneDrive o de red).
 * - En el programa de escritorio usa los diálogos nativos de Windows (puente `window.desktop`).
 * - En el navegador usa la API de acceso a archivos (Chrome y Edge de escritorio).
 * Se abre o guarda un .json; la app puede seguir guardando en él y recargarlo para ver los
 * cambios de otras personas.
 */

type Handle = FileSystemFileHandle;

interface DesktopFile {
  path: string;
  name: string;
  text?: string;
}
interface DesktopApi {
  openProject(): Promise<DesktopFile | null>;
  saveProjectAs(text: string): Promise<DesktopFile | null>;
  writeProject(path: string, text: string): Promise<boolean>;
  readProject(path: string): Promise<DesktopFile>;
  lastProject(): Promise<DesktopFile | null>;
}

interface FsWindow {
  showOpenFilePicker?: (o?: unknown) => Promise<Handle[]>;
  showSaveFilePicker?: (o?: unknown) => Promise<Handle>;
  desktop?: DesktopApi;
}
const fsw = window as unknown as FsWindow;
const desktop = fsw.desktop;

/** ¿Se está ejecutando como programa de escritorio? */
export const isDesktop = !!desktop;

export const fileApiSupported = () =>
  isDesktop || (typeof fsw.showOpenFilePicker === 'function' && typeof fsw.showSaveFilePicker === 'function');

const PICKER = {
  types: [{ description: 'Proyecto de planta (JSON)', accept: { 'application/json': ['.json'] } }],
};

export function currentProject(): ProjectData {
  const st = useStore.getState();
  return {
    version: 1,
    building: st.building,
    persons: st.persons,
    rules: st.rules,
    startTime: st.startTime,
    areaMap: st.areaMap,
    routines: st.routines,
  };
}
const projectText = () => JSON.stringify(currentProject(), null, 2);

function loadText(text: string) {
  const data = JSON.parse(text);
  if (!isProjectData(data)) throw new Error('archivo no válido');
  useStore.getState().importData(data);
}

// ---- Navegador: recordar el último archivo entre sesiones (IndexedDB) ----
const DB = 'modelo-planta-3d-files';
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('handles');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const rememberHandle = (h: Handle) => idb('readwrite', (s) => s.put(h, 'last')).catch(() => undefined);

async function ensurePermission(h: Handle, write: boolean) {
  const mode = write ? 'readwrite' : 'read';
  const hh = h as unknown as {
    queryPermission(o: { mode: string }): Promise<string>;
    requestPermission(o: { mode: string }): Promise<string>;
  };
  if ((await hh.queryPermission({ mode })) === 'granted') return true;
  return (await hh.requestPermission({ mode })) === 'granted';
}

/** Archivo de proyecto en uso: un handle del navegador o una ruta del escritorio. */
let current: { name: string; handle?: Handle; path?: string } | null = null;
export const currentFileName = () => current?.name ?? null;

async function readHandle(h: Handle) {
  if (!(await ensurePermission(h, false))) throw new Error('permiso denegado');
  loadText(await (await h.getFile()).text());
  current = { name: h.name, handle: h };
  await rememberHandle(h);
}

async function writeHandle(h: Handle) {
  if (!(await ensurePermission(h, true))) throw new Error('permiso denegado');
  const w = await h.createWritable();
  await w.write(projectText());
  await w.close();
}

/** Último archivo usado, para ofrecer «Reabrir» al iniciar. */
export async function lastProject(): Promise<{ name: string; open: () => Promise<void> } | null> {
  if (desktop) {
    const f = await desktop.lastProject();
    return f ? { name: f.name, open: () => readPath(f.path) } : null;
  }
  const h = await idb<Handle | undefined>('readonly', (s) => s.get('last')).catch(() => undefined);
  return h ? { name: h.name, open: () => readHandle(h) } : null;
}

async function readPath(path: string) {
  const f = await desktop!.readProject(path);
  loadText(f.text ?? '');
  current = { name: f.name, path: f.path };
}

export async function openProjectFile() {
  if (desktop) {
    const f = await desktop.openProject();
    if (!f) return;
    loadText(f.text ?? '');
    current = { name: f.name, path: f.path };
    return;
  }
  const [h] = await fsw.showOpenFilePicker!(PICKER);
  await readHandle(h);
}

export async function saveProjectFileAs() {
  if (desktop) {
    const f = await desktop.saveProjectAs(projectText());
    if (f) current = { name: f.name, path: f.path };
    return;
  }
  const h = await fsw.showSaveFilePicker!({ ...PICKER, suggestedName: 'proyecto-planta.json' });
  await writeHandle(h);
  current = { name: h.name, handle: h };
  await rememberHandle(h);
}

export async function saveProjectFile() {
  if (current?.path && desktop) await desktop.writeProject(current.path, projectText());
  else if (current?.handle) await writeHandle(current.handle);
  else await saveProjectFileAs();
}

/** Deja de usar el archivo de proyecto (al cambiar de edificio, para no escribir uno en el de otro). */
export function forgetProjectFile() {
  current = null;
}

export async function reloadProjectFile() {
  if (current?.path && desktop) await readPath(current.path);
  else if (current?.handle) await readHandle(current.handle);
}
