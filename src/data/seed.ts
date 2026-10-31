import example from '../../ejemplos/copia-5-edificios-4-plantas.json';
import type { AppBackup, BuildingEntry } from '../store';
import type { Building, ProjectData } from '../types';
import { LOCAL } from './localData';

/**
 * Datos con los que arranca la app: los de esta instalación si existen (carpeta local, fuera
 * del repositorio) o, si no, los edificios de ejemplo de `ejemplos/`.
 */
const EXAMPLES = (example as unknown as AppBackup).buildings;

/** Edificios de la biblioteca la primera vez que se abre la app (el primero queda abierto). */
export const INITIAL_LIBRARY: BuildingEntry[] = LOCAL ? LOCAL.library : EXAMPLES.map(({ id, name }) => ({ id, name }));

export function createSeed(): ProjectData {
  return LOCAL ? LOCAL.createSeed() : structuredClone(EXAMPLES[0].data);
}

export function createBuilding(): Building {
  return createSeed().building;
}

/** Datos de un edificio de ejemplo que aún no se ha abierto nunca (no está en la base de datos local). */
export function exampleData(id: string): ProjectData | undefined {
  const b = EXAMPLES.find((x) => x.id === id);
  return b ? structuredClone(b.data) : undefined;
}
