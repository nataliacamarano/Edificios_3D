import { useMemo, useRef, useState } from 'react';
import { PERSON_COLORS } from '../data/rules';
import { isDestination } from '../geometry';
import { useName, useT, type TKey } from '../i18n';
import {
  areaKey,
  buildPersons,
  detectColumns,
  extractRecords,
  floorForLabel,
  guessSpace,
  LOG_FIELDS,
  readLogFile,
  REQUIRED_FIELDS,
  type LogField,
  type LogSheet,
} from '../import/cleaningLog';
import { useStore } from '../store';

/**
 * Importa un registro de limpieza (Excel o CSV): detecta las columnas, empareja cada zona con
 * una estancia del modelo (el emparejamiento se guarda para la próxima vez) y crea un
 * itinerario por limpiador con sus horas reales.
 */
export default function ImportLog() {
  const t = useT();
  const name = useName();
  const building = useStore((s) => s.building);
  const savedMap = useStore((s) => s.areaMap);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<LogSheet[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [colOverride, setColOverride] = useState<Partial<Record<LogField, number>>>({});
  const [date, setDate] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    try {
      const read = await readLogFile(file);
      // Hoja por defecto: la primera en la que se reconocen las columnas necesarias
      // (prefiriendo una llamada «Data» o «Datos»)
      const ok = read.map((s) => {
        const { columns } = detectColumns(s.rows);
        return REQUIRED_FIELDS.every((f) => columns[f] !== undefined);
      });
      const preferred = read.findIndex((s, i) => ok[i] && /^(data|datos)$/i.test(s.name));
      setSheets(read);
      setSheetIdx(preferred >= 0 ? preferred : Math.max(0, ok.indexOf(true)));
      setColOverride({});
      setDate('');
      setMapping({});
    } catch {
      setError(t('importError'));
    }
  };

  const sheet = sheets?.[sheetIdx];
  const detected = useMemo(() => (sheet ? detectColumns(sheet.rows) : null), [sheet]);
  const columns = { ...(detected?.columns ?? {}), ...colOverride };
  const header = sheet && detected ? sheet.rows[detected.headerRow] ?? [] : [];
  const missing = REQUIRED_FIELDS.filter((f) => columns[f] === undefined);

  const allRecords = useMemo(
    () => (sheet && detected && !missing.length ? extractRecords(sheet.rows, detected.headerRow, columns) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, detected, JSON.stringify(colOverride), missing.length],
  );
  const dates = [...new Set(allRecords.map((r) => r.date).filter(Boolean))];
  const records = date ? allRecords.filter((r) => r.date === date) : allRecords;

  // Pares planta–zona del registro con la estancia propuesta
  const pairs = useMemo(() => {
    const seen = new Map<string, { floorLabel: string; area: string; count: number; key: string; floorId?: string; guess: string }>();
    for (const r of records) {
      const floor = floorForLabel(building, r.floorLabel);
      const key = floor ? areaKey(floor.id, r.area) : `?|${r.floorLabel}|${r.area}`;
      const prev = seen.get(key);
      if (prev) prev.count++;
      else
        seen.set(key, {
          floorLabel: r.floorLabel,
          area: r.area,
          count: 1,
          key,
          floorId: floor?.id,
          guess: floor ? (savedMap[key] ?? guessSpace(floor, r.area)?.id ?? '') : '',
        });
    }
    return [...seen.values()].sort((a, b) => a.floorLabel.localeCompare(b.floorLabel) || a.area.localeCompare(b.area));
  }, [records, building, savedMap]);

  const chosen = (key: string, guess: string) => (key in mapping ? mapping[key] : guess);
  const finalMap = Object.fromEntries(pairs.filter((p) => p.floorId).map((p) => [p.key, chosen(p.key, p.guess)]));
  const cleaners = new Set(records.map((r) => r.cleaner));

  const create = () => {
    const st = useStore.getState();
    const result = buildPersons(st.building, records, finalMap, st.persons, PERSON_COLORS);
    const usable = Object.fromEntries(Object.entries(finalMap).filter(([, v]) => v));
    st.applyImport(result.persons, usable, result.earliest);
    const stops = result.persons.reduce((acc, p) => acc + p.stops.length, 0);
    setMessage(t('importDone', { p: result.persons.length, s: stops, k: result.skipped }));
    st.setUi({ tab: 'people' });
  };

  return (
    <>
      <h4>{t('importLog')}</h4>
      <p className="muted small">{t('importLogHint')}</p>
      <div className="row">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          {t('chooseLogFile')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="warning">⚠ {error}</p>}
      {message && <p className="ok-note">✓ {message}</p>}

      {sheets && sheet && (
        <div className="import-box">
          <div className="row">
            {sheets.length > 1 && (
              <label className="field">
                <span>{t('sheet')}</span>
                <select
                  value={sheetIdx}
                  onChange={(e) => {
                    setSheetIdx(+e.target.value);
                    setColOverride({});
                    setDate('');
                    setMapping({});
                  }}
                >
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dates.length > 1 && (
              <label className="field">
                <span>{t('logDate')}</span>
                <select value={date} onChange={(e) => setDate(e.target.value)}>
                  <option value="">{t('allDates')}</option>
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="col-grid">
            {LOG_FIELDS.map((f) => (
              <label key={f} className="field">
                <span>
                  {t(`field_${f}` as TKey)}
                  {REQUIRED_FIELDS.includes(f) ? ' *' : ''}
                </span>
                <select
                  value={columns[f] ?? ''}
                  onChange={(e) =>
                    setColOverride({ ...colOverride, [f]: e.target.value === '' ? undefined : +e.target.value })
                  }
                >
                  <option value="">—</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `#${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="warning">⚠ {t('missingColumns', { c: missing.map((f) => t(`field_${f}` as TKey)).join(', ') })}</p>
          )}

          {pairs.length > 0 && (
            <>
              <h4>{t('areaMapping')}</h4>
              <div className="map-list">
                {pairs.map((p) => {
                  const floor = building.floors.find((f) => f.id === p.floorId);
                  return (
                    <div key={p.key} className="map-row">
                      <span className="map-label" title={`${p.count}`}>
                        <b>{p.floorLabel}</b> · {p.area} <span className="muted small">×{p.count}</span>
                      </span>
                      {floor ? (
                        <select
                          className={chosen(p.key, p.guess) ? '' : 'unmapped'}
                          value={chosen(p.key, p.guess)}
                          onChange={(e) => setMapping({ ...mapping, [p.key]: e.target.value })}
                        >
                          <option value="">{t('ignoreArea')}</option>
                          {floor.spaces
                            .filter((s) => isDestination(s.kind))
                            .sort((a, b) => name(a).localeCompare(name(b)))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {name(s)}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span className="muted small">{t('floorMissing')}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <button className="btn primary block" disabled={!records.length} onClick={create}>
                {t('createItineraries', { p: cleaners.size })}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
