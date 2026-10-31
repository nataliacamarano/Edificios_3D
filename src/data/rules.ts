import type { AccessRule } from '../types';

/** Colores de las personas, por orden de alta. */
export const PERSON_COLORS = ['#e4572e', '#2e86de', '#17a589', '#8e44ad', '#f39c12', '#c0392b', '#16a085', '#d35400', '#2c3e50', '#e84393'];

/** Con el carro de limpieza no se pasa por las zonas marcadas «sin carro». */
export const CART_RULE: AccessRule = { id: 'r-carro', personTag: 'limpieza', spaceTag: 'sin carro', mode: 'deny' };

/** Con el carro de limpieza no se usan escaleras: se cambia de planta en el good lift. */
export const STAIRS_RULE: AccessRule = { id: 'r-escaleras', personTag: 'limpieza', spaceTag: 'escalera', mode: 'deny' };

/**
 * Cada equipo usa el good lift de su lado; el del otro lado, solo si no hay otro (p. ej. en una
 * planta que solo tiene el del norte).
 */
export const SIDE_RULES: AccessRule[] = [
  { id: 'r-lado-norte', personTag: 'equipo norte', spaceTag: 'lado sur', mode: 'avoid' },
  { id: 'r-lado-sur', personTag: 'equipo sur', spaceTag: 'lado norte', mode: 'avoid' },
];

/** Las zonas «evitar carro» solo se cruzan con el carro si no hay otra ruta. */
export const CART_AVOID_RULE: AccessRule = {
  id: 'r-evitar-carro',
  personTag: 'limpieza',
  spaceTag: 'evitar carro',
  mode: 'avoid',
};

/** Reglas de partida de cualquier edificio. */
export function defaultRules(): AccessRule[] {
  return [
    // El montacargas (good lift) es solo para limpieza; los ascensores de pasajeros, para visitantes.
    { id: 'r-montacargas', personTag: 'limpieza', spaceTag: 'montacargas', mode: 'only' },
    { id: 'r-visitantes', personTag: 'limpieza', spaceTag: 'visitantes', mode: 'deny' },
    CART_RULE,
    CART_AVOID_RULE,
    STAIRS_RULE,
    ...SIDE_RULES,
  ];
}
