import { useId, useState, type KeyboardEvent } from 'react';
import { isDestination, KINDS } from '../geometry';
import { kindKey, useName, useT, useTagName } from '../i18n';
import { useStore } from '../store';

/** Etiquetas libres en forma de chips. Enter o coma para añadir. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}) {
  const t = useT();
  const tg = useTagName();
  const [text, setText] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="chip">
          {tg(tag)}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== tag))} aria-label="×">
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        placeholder={t('tagsPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => text && add(text)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}

/** Selector de estancias destino, agrupadas por planta y tipo. */
export function SpaceSelect({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (floorId: string, spaceId: string) => void;
  placeholder?: string;
}) {
  const t = useT();
  const name = useName();
  const floors = useStore((s) => s.building.floors);
  const multi = floors.length > 1;
  return (
    <select
      className="space-select"
      value={value}
      onChange={(e) => {
        const [f, s] = e.target.value.split('::');
        if (f && s) onChange(f, s);
      }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {floors.map((f) =>
        KINDS.filter(isDestination).map((k) => {
          const list = f.spaces.filter((s) => s.kind === k).sort((a, b) => a.name.localeCompare(b.name));
          if (!list.length) return null;
          return (
            <optgroup key={f.id + k} label={(multi ? name(f) + ' · ' : '') + t(kindKey(k))}>
              {list.map((s) => (
                <option key={s.id} value={`${f.id}::${s.id}`}>
                  {name(s)}
                </option>
              ))}
            </optgroup>
          );
        }),
      )}
    </select>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? +value.toFixed(3) : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    </label>
  );
}

export function useAllTags() {
  const persons = useStore((s) => s.persons);
  const floors = useStore((s) => s.building.floors);
  const rules = useStore((s) => s.rules);
  const personTags = new Set<string>();
  const spaceTags = new Set<string>();
  persons.forEach((p) => p.tags.forEach((x) => personTags.add(x)));
  rules.forEach((r) => {
    if (r.personTag) personTags.add(r.personTag);
    if (r.spaceTag) spaceTags.add(r.spaceTag);
  });
  floors.forEach((f) => f.spaces.forEach((s) => s.tags.forEach((x) => spaceTags.add(x))));
  return { personTags: [...personTags].sort(), spaceTags: [...spaceTags].sort() };
}
