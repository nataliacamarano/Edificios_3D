import type { BuildingEntry } from '../store';
import type { Building, ProjectData } from '../types';

/**
 * Datos propios de una instalación (planos calcados, personal, fotos) que no van al repositorio.
 * Si existe `./local/index.ts`, la app arranca con ellos; si no, con los edificios de ejemplo.
 */
export interface LocalData {
  /** Edificios con los que arranca la biblioteca (el primero se abre). */
  library: BuildingEntry[];
  createSeed(): ProjectData;
  /** Pone al día un edificio guardado con una versión anterior de la app. */
  upgradeBuilding(b: Building): Building;
  /** Cambios de versiones muy antiguas del estado guardado (se modifica en el sitio). */
  legacyMigrate(p: Partial<ProjectData>, version: number): void;
  /** Fotos de los planos que van dentro de la app: nombre guardado → URL. */
  photos: Record<string, string>;
}

const found = import.meta.glob<{ local: LocalData }>('./local/index.ts', { eager: true });

export const LOCAL: LocalData | null = Object.values(found)[0]?.local ?? null;
