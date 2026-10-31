import type { FurnitureKind } from './types';

/** Aspecto de cada tipo de mueble: color, altura en 3D (m) e icono. */
export const FURNITURE_STYLE: Record<FurnitureKind, { color: string; h: number; icon: string }> = {
  desk: { color: '#d8c3a0', h: 0.75, icon: '🖥️' },
  table: { color: '#c9ad85', h: 0.75, icon: '🍽️' },
  sofa: { color: '#93a8c0', h: 0.45, icon: '🛋️' },
  counter: { color: '#b4ada3', h: 1.05, icon: '🧾' },
  storage: { color: '#a5a09a', h: 1.6, icon: '🗄️' },
  plant: { color: '#79b07a', h: 1.1, icon: '🪴' },
  equipment: { color: '#8e9aab', h: 1.2, icon: '⚙️' },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE_STYLE) as FurnitureKind[];

/** Tamaño por defecto (ancho × fondo, m) del mueble que coloca la herramienta «Mueble». */
export const FURNITURE_DEFAULT_SIZE: Record<FurnitureKind, [number, number]> = {
  desk: [2.8, 1.6],
  table: [1.6, 0.9],
  sofa: [2, 0.9],
  counter: [2.4, 0.7],
  storage: [1.8, 0.5],
  plant: [0.9, 0.9],
  equipment: [1.2, 0.8],
};
