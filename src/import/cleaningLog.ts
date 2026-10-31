import { parseClock } from '../geometry';
import type { Building, Floor, Person, Space, Stop } from '../types';

/** Campos que se buscan en la hoja del registro. */
export type LogField = 'cleaner' | 'floor' | 'area' | 'start' | 'end' | 'date' | 'activity';
export const LOG_FIELDS: LogField[] = ['cleaner', 'floor', 'area', 'start', 'end', 'date', 'activity'];
export const REQUIRED_FIELDS: LogField[] = ['cleaner', 'floor', 'area', 'start'];

export interface LogSheet {
  name: string;
  rows: string[][];
}

/** Lee un Excel o CSV y devuelve sus hojas como tablas de texto (tal como se ven en la hoja). */
export async function readLogFile(file: File): Promise<LogSheet[]> {
  const XLSX = await import('xlsx');
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' })
      .map((r) => r.map((c) => String(c ?? '').trim())),
  }));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const SYNONYMS: Record<LogField, string[]> = {
  cleaner: ['cleaner', 'limpiador', 'limpiadora', 'operario', 'operaria', 'persona', 'empleado', 'name', 'nombre'],
  floor: ['floor', 'planta', 'piso', 'level', 'nivel'],
  area: ['area', 'zona', 'zone', 'estancia', 'aseo', 'area / name', 'room', 'sala'],
  start: ['start', 'inicio', 'hora inicio', 'start 1', 'desde', 'entrada'],
  end: ['end', 'fin', 'hora fin', 'end 1', 'hasta', 'salida'],
  date: ['date', 'fecha', 'dia'],
  activity: ['activity', 'actividad', 'tipo', 'tarea', 'task'],
};

/** Encuentra la fila de cabecera (la primera con «floor/planta» y «start/inicio») y sus columnas. */
export function detectColumns(rows: string[][]): { headerRow: number; columns: Partial<Record<LogField, number>> } {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r].map(norm);
    const columns: Partial<Record<LogField, number>> = {};
    for (const field of LOG_FIELDS) {
      // Coincidencia exacta primero; después, cabeceras que empiezan por el sinónimo
      let idx = cells.findIndex((c) => SYNONYMS[field].includes(c));
      if (idx < 0) idx = cells.findIndex((c) => SYNONYMS[field].some((s) => c.startsWith(s)));
      if (idx >= 0 && !Object.values(columns).includes(idx)) columns[field] = idx;
    }
    if (columns.floor !== undefined && columns.start !== undefined) return { headerRow: r, columns };
  }
  return { headerRow: 0, columns: {} };
}

export interface LogRecord {
  date: string;
  cleaner: string;
  floorLabel: string;
  area: string;
  start: string;
  end: string;
}

const SKIP_ACTIVITIES = ['lift', 'ascensor', 'break', 'descanso', 'pausa'];

/** Filas útiles del registro: con limpiador, planta, zona y hora de inicio (sin trayectos de ascensor). */
export function extractRecords(rows: string[][], headerRow: number, columns: Partial<Record<LogField, number>>): LogRecord[] {
  const get = (r: string[], f: LogField) => (columns[f] === undefined ? '' : (r[columns[f]!] ?? '').trim());
  return rows
    .slice(headerRow + 1)
    .map((r) => ({
      date: get(r, 'date'),
      cleaner: get(r, 'cleaner'),
      floorLabel: get(r, 'floor'),
      area: get(r, 'area'),
      start: toClock(get(r, 'start')),
      end: toClock(get(r, 'end')),
      activity: norm(get(r, 'activity')),
    }))
    .filter((r) => r.cleaner && r.floorLabel && r.area && r.start && !SKIP_ACTIVITIES.some((a) => r.activity.startsWith(a)))
    .map(({ activity: _activity, ...rest }) => rest);
}

/** «9:40», «09:40:00», «9:40 AM» → «9:40». */
function toClock(text: string) {
  const m = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(text);
  if (!m) return '';
  let h = +m[1];
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
  return `${h}:${m[2]}`;
}

/** «L9», «9», «Planta -2», «0 (GF)», «PB» → nivel. */
export function parseLevel(label: string): number | null {
  const n = norm(label);
  if (/^(gf|pb|ground|planta baja|bajo)/.test(n)) return 0;
  const m = /-?\d+/.exec(n);
  return m ? +m[0] : null;
}

export const floorForLabel = (b: Building, label: string): Floor | undefined => {
  const level = parseLevel(label);
  return level === null ? undefined : b.floors.find((f) => f.level === level);
};

export const areaKey = (floorId: string, area: string) => `${floorId}|${norm(area)}`;

/** Palabras de la zona → etiqueta de las estancias que le corresponden. */
const AREA_TAGS: [RegExp, string][] = [
  [/(men|hombre|caballero|male)\b/, 'hombres'],
  [/(ladies|lady|women|mujer|dama|female)/, 'mujeres'],
  [/(disab|accessib|adaptad|minusv)/, 'adaptado'],
  [/(shower|ducha)/, 'ducha'],
  [/(security|seguridad)/, 'seguridad'],
  [/(general|mixed|mixto|unisex)/, 'general'],
  [/(inclusiv|neutr)/, 'inclusivo'],
];

/** Mejor estancia para una zona del registro: mismo nombre, o por etiquetas (hombres, mujeres…). */
export function guessSpace(floor: Floor, area: string): Space | undefined {
  const n = norm(area);
  const byName = floor.spaces.find((s) => norm(s.name) === n || (s.nameEn && norm(s.nameEn) === n));
  if (byName) return byName;
  const wanted = AREA_TAGS.filter(([re]) => re.test(n)).map(([, tag]) => tag);
  if (!wanted.length) return undefined;
  const candidates = floor.spaces.filter((s) => wanted.every((tag) => s.tags.includes(tag)));
  // «General» también encaja con aseos mixtos o inclusivos
  const fallback =
    wanted[0] === 'general'
      ? floor.spaces.filter((s) => s.tags.includes('mixto') || s.tags.includes('inclusivo'))
      : [];
  return [...candidates, ...fallback].find((s) => s.doors.length > 0) ?? candidates[0] ?? fallback[0];
}

export interface ImportResult {
  persons: Person[];
  skipped: number;
  earliest: number | null;
}

/**
 * Crea un itinerario por limpiador (y por fecha si hay varias), con las paradas ordenadas por
 * hora, la espera igual a los minutos de limpieza y las horas reales para compararlas.
 */
export function buildPersons(
  b: Building,
  records: LogRecord[],
  areaMap: Record<string, string>,
  existing: Person[],
  colors: string[],
): ImportResult {
  // Solo se añade la fecha al nombre de quien aparece en más de un día
  const daysOf = new Map<string, Set<string>>();
  for (const r of records) daysOf.set(r.cleaner, (daysOf.get(r.cleaner) ?? new Set()).add(r.date));
  const groups = new Map<string, LogRecord[]>();
  for (const r of records) {
    const key = (daysOf.get(r.cleaner)?.size ?? 0) > 1 ? `${r.cleaner} (${r.date})` : r.cleaner;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  let skipped = 0;
  let earliest: number | null = null;
  const persons: Person[] = [];
  let colorIdx = existing.length;
  for (const [name, recs] of groups) {
    const sorted = [...recs].sort((a, c) => (parseClock(a.start) ?? 0) - (parseClock(c.start) ?? 0));
    const prev = existing.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const id = prev?.id ?? `p-${Math.random().toString(36).slice(2, 9)}`;
    const stops: Stop[] = [];
    for (const r of sorted) {
      const floor = floorForLabel(b, r.floorLabel);
      const spaceId = floor && areaMap[areaKey(floor.id, r.area)];
      if (!floor || !spaceId) {
        skipped++;
        continue;
      }
      const s = parseClock(r.start)!;
      const e = parseClock(r.end);
      earliest = earliest === null ? s : Math.min(earliest, s);
      stops.push({
        id: `${id}-s${stops.length}`,
        floorId: floor.id,
        spaceId,
        dwell: e !== null && e > s ? e - s : 0,
        real: { start: r.start, end: r.end || undefined },
      });
    }
    if (!stops.length) continue;
    const last = stops[stops.length - 1].real!;
    persons.push({
      id,
      name,
      color: prev?.color ?? colors[colorIdx++ % colors.length],
      tags: prev?.tags ?? ['limpieza'],
      speed: prev?.speed ?? 1.2,
      startDelay: 0,
      optimize: false,
      returnToStart: false,
      // Como el registro puede tener plantas que no están en el modelo, se respetan sus horas
      holdUntilReal: true,
      real: { start: stops[0].real!.start, end: last.end ?? last.start },
      stops,
    });
  }
  return { persons, skipped, earliest };
}
