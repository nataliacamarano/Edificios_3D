import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  center,
  doorGap,
  isDestination,
  isEnclosed,
  isGoodLift,
  isObstacle,
  isVoid,
  isWalledPassage,
  KIND_ICONS,
  spaceColor,
  wallSegments,
} from '../geometry';
import { useName } from '../i18n';
import { useStore } from '../store';
import type { Space, Vec2 } from '../types';

const SELECTED = '#ff9f1c';

export function WallBox({
  a,
  b,
  height,
  thickness,
  color,
  extend = 0,
  opacity = 1,
}: {
  a: Vec2;
  b: Vec2;
  height: number;
  thickness: number;
  color: string;
  extend?: number;
  opacity?: number;
}) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  if (L < 0.01) return null;
  return (
    <mesh position={[(a.x + b.x) / 2, height / 2, (a.z + b.z) / 2]} rotation={[0, Math.atan2(-dz, dx), 0]}>
      <boxGeometry args={[L + extend, height, thickness]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
    </mesh>
  );
}

const DOOR_COLOR = '#16a34a';

/** Puerta: umbral verde en el suelo y dintel verde arriba del hueco, para verla desde lejos. */
function DoorMark({ a, b, height }: { a: Vec2; b: Vec2; height: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  if (L < 0.05) return null;
  const rot: [number, number, number] = [0, Math.atan2(-dz, dx), 0];
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  return (
    <group>
      <mesh position={[mx, 0.07, mz]} rotation={rot}>
        <boxGeometry args={[L, 0.03, 0.3]} />
        <meshStandardMaterial color={DOOR_COLOR} />
      </mesh>
      <mesh position={[mx, height - 0.12, mz]} rotation={rot}>
        <boxGeometry args={[L + 0.12, 0.24, 0.16]} />
        <meshStandardMaterial color={DOOR_COLOR} />
      </mesh>
    </group>
  );
}

function shade(hex: string, k: number) {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

interface Props {
  space: Space;
  floorId: string;
  selected: boolean;
  wallHeight: number;
  showLabel: boolean;
}

export const SpaceMesh = memo(function SpaceMesh({ space, floorId, selected, wallHeight, showLabel }: Props) {
  const [hover, setHover] = useState(false);
  const name = useName();
  const base = spaceColor(space);
  const goodLift = isGoodLift(space);
  const c = center(space);
  const segments = useMemo(() => (isEnclosed(space.kind) || isWalledPassage(space) ? wallSegments(space) : []), [space]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 4) return;
    const st = useStore.getState();
    if (st.ui.pickPersonId) {
      if (isDestination(space.kind)) st.addStop(st.ui.pickPersonId, floorId, space.id);
    } else {
      st.select({ type: 'space', floorId, id: space.id });
    }
  };
  const handlers = {
    onClick,
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHover(false);
      document.body.style.cursor = '';
    },
  };

  const floorColor = selected ? SELECTED : hover ? shade(base, 1.08) : base;
  const wallColor = selected ? shade(SELECTED, 0.85) : shade(base, 0.82);
  const icon = KIND_ICONS[space.kind];

  let body: React.ReactNode;
  if (isObstacle(space.kind)) {
    body = (
      <mesh position={[c.x, wallHeight / 2, c.z]}>
        <boxGeometry args={[space.w, wallHeight, space.d]} />
        <meshStandardMaterial color={selected ? SELECTED : hover ? shade(base, 1.05) : base} />
      </mesh>
    );
  } else if (isVoid(space.kind)) {
    // Tragaluz/hueco: suelo de cristal translúcido y barandilla acristalada alrededor
    const rim = wallSegments({ ...space, doors: [] });
    body = (
      <>
        <mesh position={[c.x, 0.015, c.z]}>
          <boxGeometry args={[space.w, 0.02, space.d]} />
          <meshStandardMaterial color={selected ? SELECTED : hover ? shade(base, 1.05) : base} transparent opacity={0.45} />
        </mesh>
        {rim.map(([a, b], i) => (
          <WallBox key={i} a={a} b={b} height={1.1} thickness={0.06} color="#7cc3e8" opacity={0.35} />
        ))}
      </>
    );
  } else if (space.design) {
    // Escalera de diseño abierta: solo su dibujo (peldaños y meseta), sin caja ni paredes
    body = (
      <mesh position={[c.x, 0.01, c.z]}>
        <boxGeometry args={[space.w, 0.01, space.d]} />
        <meshStandardMaterial color={floorColor} transparent opacity={selected || hover ? 0.35 : 0.08} />
      </mesh>
    );
  } else if (isEnclosed(space.kind)) {
    body = (
      <>
        <mesh position={[c.x, 0.03, c.z]}>
          <boxGeometry args={[space.w, 0.06, space.d]} />
          <meshStandardMaterial color={floorColor} />
        </mesh>
        {segments.map(([a, b], i) => (
          <WallBox key={i} a={a} b={b} height={wallHeight} thickness={0.12} color={wallColor} />
        ))}
        {space.doors.map((d) => {
          const [a, b] = doorGap(space, d);
          return <DoorMark key={d.id} a={a} b={b} height={wallHeight} />;
        })}
      </>
    );
  } else {
    const tall = space.kind === 'printer' || space.kind === 'stationery';
    body = (
      <>
        <mesh position={[c.x, tall ? 0.45 : 0.02, c.z]}>
          <boxGeometry args={[space.w, tall ? 0.9 : 0.04, space.d]} />
          <meshStandardMaterial color={floorColor} transparent={!tall} opacity={tall ? 1 : 0.8} />
        </mesh>
        {/* Vestíbulo: paredes con sus puertas */}
        {segments.map(([a, b], i) => (
          <WallBox key={i} a={a} b={b} height={wallHeight} thickness={0.12} color={wallColor} />
        ))}
        {segments.length > 0 &&
          space.doors.map((d) => {
            const [a, b] = doorGap(space, d);
            return <DoorMark key={d.id} a={a} b={b} height={wallHeight} />;
          })}
      </>
    );
  }

  const labelY = space.kind === 'workspace' ? 0.6 : isObstacle(space.kind) ? wallHeight + 0.2 : wallHeight + 0.4;
  return (
    <group {...handlers}>
      {body}
      {showLabel && !isObstacle(space.kind) && (space.kind !== 'lobby' || selected) && (space.kind !== 'room' || selected || hover) && (
        <Html position={[c.x, labelY, c.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          {goodLift && !selected ? (
            <div className="label3d goodlift">🛗 Good lift</div>
          ) : icon && !selected && space.kind !== 'kitchen' ? (
            // Servicios, ascensores y escaleras: solo el icono para no saturar la vista
            <div className={`label3d icon-only kind-${space.kind}`}>{icon}</div>
          ) : (
            <div className={`label3d kind-${space.kind}${selected ? ' sel' : ''}`}>
              {icon && <span className="ico">{icon}</span>}
              {name(space)}
            </div>
          )}
        </Html>
      )}
    </group>
  );
});
