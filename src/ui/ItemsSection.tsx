import { useState } from 'react';
import { uid } from '../geometry';
import { useName, useT } from '../i18n';
import { itemDwell, itemLabel, itemSize, itemTypeOf } from '../routines';
import { useActiveFloor, useStore } from '../store';
import type { Item, ItemType } from '../types';
import { NumberField, TagInput } from './common';

/** Ficha del elemento seleccionado: tipo, nombre, planta, posición, tamaño y tiempo de trabajo. */
export function ItemEditor({ item }: { item: Item }) {
  const t = useT();
  const name = useName();
  const building = useStore((s) => s.building);
  const updateItem = useStore((s) => s.updateItem);
  const deleteItem = useStore((s) => s.deleteItem);
  const addItem = useStore((s) => s.addItem);
  const select = useStore((s) => s.select);
  const setUi = useStore((s) => s.setUi);
  const type = itemTypeOf(building, item);
  const size = itemSize(building, item);
  const set = (patch: Partial<Item>) => updateItem(item.id, patch);

  return (
    <div className="card editor">
      <div className="editor-head">
        <span className="swatch" style={{ background: type?.color }} />
        <b>
          {type?.icon} {name(itemLabel(building, item))}
        </b>
        <button className="icon" title={t('close')} onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <div className="row">
        <label className="field grow">
          <span>{t('itemType')}</span>
          <select value={item.typeId} onChange={(e) => set({ typeId: e.target.value })}>
            {(building.itemTypes ?? []).map((tt) => (
              <option key={tt.id} value={tt.id}>
                {tt.icon} {name(tt.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>{t('itemFloor')}</span>
          <select
            value={item.floorId}
            onChange={(e) => {
              // Mover a otra planta: mismo sitio en el plano; se sigue viendo en su planta nueva
              set({ floorId: e.target.value });
              setUi({ activeFloorId: e.target.value });
              select({ type: 'item', floorId: e.target.value, id: item.id });
            }}
          >
            {building.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {name(f)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{t('name')}</span>
        <input value={item.name ?? ''} placeholder={type?.name} onChange={(e) => set({ name: e.target.value || undefined })} />
      </label>
      <h4>{t('geometry')}</h4>
      <div className="grid4">
        <NumberField label="x" value={item.x} step={0.25} onChange={(x) => set({ x })} />
        <NumberField label="z" value={item.z} step={0.25} onChange={(z) => set({ z })} />
        <NumberField label="↔" value={size.w} step={0.1} min={0.1} onChange={(w) => set({ w: Math.max(0.1, w) })} />
        <NumberField label="↕" value={size.d} step={0.1} min={0.1} onChange={(d) => set({ d: Math.max(0.1, d) })} />
      </div>
      <NumberField
        label={t('itemDwell')}
        value={itemDwell(building, item)}
        step={10}
        min={0}
        onChange={(v) => set({ dwell: Math.max(0, v) })}
      />
      <label className="field">
        <span>{t('tags')}</span>
        <TagInput value={item.tags} onChange={(tags) => set({ tags })} />
      </label>
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            const copy: Item = { ...item, id: uid('i'), x: item.x + 1, z: item.z + 1, tags: [...item.tags] };
            addItem(copy);
            select({ type: 'item', floorId: copy.floorId, id: copy.id });
          }}
        >
          {t('duplicate')}
        </button>
        <button className="btn danger ghost" onClick={() => deleteItem(item.id)}>
          {t('deleteItem')}
        </button>
      </div>
    </div>
  );
}

/** Elementos de la planta activa, agrupados por tipo. */
export function ItemList({ query }: { query: string }) {
  const name = useName();
  const t = useT();
  const floor = useActiveFloor();
  const building = useStore((s) => s.building);
  const selection = useStore((s) => s.ui.selection);
  const select = useStore((s) => s.select);
  const setUi = useStore((s) => s.setUi);
  const items = (building.items ?? []).filter((i) => i.floorId === floor.id);
  const q = query.trim().toLowerCase();

  return (
    <details open>
      <summary>
        📍 {t('items')} <span className="count">{items.length}</span>
      </summary>
      <p className="muted small">{t('itemsHint')}</p>
      <button className="btn small" onClick={() => setUi({ view: '2d', tool: 'item' })}>
        {t('placeItem')}
      </button>
      {(building.itemTypes ?? []).map((tt) => {
        const list = items.filter(
          (i) => i.typeId === tt.id && (!q || itemLabel(building, i).toLowerCase().includes(q) || i.tags.some((x) => x.includes(q))),
        );
        if (!list.length) return null;
        return (
          <ul key={tt.id} className="space-list">
            {list.map((i) => (
              <li
                key={i.id}
                className={selection?.id === i.id ? 'sel' : ''}
                onClick={() => select({ type: 'item', floorId: floor.id, id: i.id })}
              >
                <span>
                  {tt.icon} {name(itemLabel(building, i))}
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </details>
  );
}

/** Tipos de elemento: los de partida y los propios. */
export function ItemTypesManager() {
  const name = useName();
  const t = useT();
  const types = useStore((s) => s.building.itemTypes ?? []);
  const items = useStore((s) => s.building.items ?? []);
  const addItemType = useStore((s) => s.addItemType);
  const updateItemType = useStore((s) => s.updateItemType);
  const deleteItemType = useStore((s) => s.deleteItemType);
  const [open, setOpen] = useState<string | null>(null);

  const add = () => {
    const tt: ItemType = {
      id: uid('t-'),
      name: t('newItemType'),
      icon: '📦',
      color: '#7c3aed',
      shape: 'bin',
      w: 0.5,
      d: 0.5,
      dwell: 60,
    };
    addItemType(tt);
    setOpen(tt.id);
  };

  return (
    <details>
      <summary>
        🧩 {t('itemTypes')} <span className="count">{types.length}</span>
      </summary>
      <div className="type-list">
        {types.map((tt) => {
          const count = items.filter((i) => i.typeId === tt.id).length;
          return (
            <div key={tt.id} className="type-row">
              <button className="type-head" onClick={() => setOpen(open === tt.id ? null : tt.id)}>
                <span className="type-icon" style={{ background: tt.color }}>
                  {tt.icon}
                </span>
                <span className="grow">{name(tt.name)}</span>
                <span className="muted small">×{count}</span>
              </button>
              {open === tt.id && (
                <div className="type-body">
                  <div className="row">
                    <label className="field">
                      <span>{t('icon')}</span>
                      <input className="icon-input" value={tt.icon} onChange={(e) => updateItemType(tt.id, { icon: e.target.value })} />
                    </label>
                    <label className="field grow">
                      <span>{t('name')}</span>
                      <input value={tt.name} onChange={(e) => updateItemType(tt.id, { name: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>{t('color')}</span>
                      <input type="color" value={tt.color} onChange={(e) => updateItemType(tt.id, { color: e.target.value })} />
                    </label>
                  </div>
                  <div className="row">
                    <label className="field">
                      <span>{t('itemShape')}</span>
                      <select value={tt.shape} onChange={(e) => updateItemType(tt.id, { shape: e.target.value as ItemType['shape'] })}>
                        <option value="bin">{t('shape_bin')}</option>
                        <option value="box">{t('shape_box')}</option>
                      </select>
                    </label>
                    <NumberField label="↔ (m)" value={tt.w} step={0.1} min={0.1} onChange={(w) => updateItemType(tt.id, { w })} />
                    <NumberField label="↕ (m)" value={tt.d} step={0.1} min={0.1} onChange={(d) => updateItemType(tt.id, { d })} />
                    <NumberField label={t('dwellSec')} value={tt.dwell} step={10} min={0} onChange={(dwell) => updateItemType(tt.id, { dwell })} />
                  </div>
                  <button
                    className="btn small danger ghost"
                    onClick={() => window.confirm(t('confirmDeleteType', { name: tt.name, n: count })) && deleteItemType(tt.id)}
                  >
                    {t('deleteItemType')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn small" onClick={add}>
        {t('addItemType')}
      </button>
    </details>
  );
}
