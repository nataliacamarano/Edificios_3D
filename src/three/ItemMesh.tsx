import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useState } from 'react';
import { useName } from '../i18n';
import { itemLabel, itemSize, itemTypeOf } from '../routines';
import { useStore } from '../store';
import type { Building, Item } from '../types';

const SELECTED = '#ff9f1c';

/** Elemento colocado: papelera o dispensador (cilindro) o mueble como nook o pod (bloque). */
export const ItemMesh = memo(function ItemMesh({
  item,
  building,
  selected,
  showLabel,
  wallHeight,
}: {
  item: Item;
  building: Building;
  selected: boolean;
  showLabel: boolean;
  wallHeight: number;
}) {
  const [hover, setHover] = useState(false);
  const name = useName();
  const type = itemTypeOf(building, item);
  const { w, d } = itemSize(building, item);
  const box = type?.shape === 'box';
  const h = box ? Math.min(wallHeight, 2.2) : Math.min(0.9, wallHeight);
  const color = selected ? SELECTED : (type?.color ?? '#64748b');

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 4) return;
    useStore.getState().select({ type: 'item', floorId: item.floorId, id: item.id });
  };

  return (
    <group
      position={[item.x, 0, item.z]}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = '';
      }}
    >
      {box ? (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={color} transparent opacity={hover ? 0.95 : 0.8} />
        </mesh>
      ) : (
        <mesh position={[0, h / 2, 0]}>
          <cylinderGeometry args={[Math.min(w, d) / 2, Math.min(w, d) / 2.4, h, 20]} />
          <meshStandardMaterial color={color} emissive={hover ? color : '#000000'} emissiveIntensity={hover ? 0.25 : 0} />
        </mesh>
      )}
      {showLabel && (
        <Html position={[0, h + 0.35, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`item-chip${selected ? ' sel' : ''}`} style={{ borderColor: type?.color }}>
            {type?.icon ?? '📍'}
            {(selected || box) && <span> {name(itemLabel(building, item))}</span>}
          </div>
        </Html>
      )}
    </group>
  );
});
