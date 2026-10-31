import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { furnitureParts, type Mat, type Prim } from '../furnitureLayout';
import { roomFurnitureParts } from '../roomFixtures';
import { useStore } from '../store';
import type { Floor } from '../types';

const MAT_COLOR: Record<Mat, string> = {
  wood: '#c9a77a',
  chair: '#5b6472',
  sofa: '#7f93ad',
  counter: '#c2b9ab',
  storage: '#aaa49c',
  pot: '#8d6e5a',
  plant: '#5f9e5f',
  metal: '#7b8390',
  screen: '#26303d',
  felt: '#2f7d4f',
  porcelain: '#f8fafc',
  partition: '#cdd5df',
  tray: '#d6eaf5',
  step: '#b9bec6',
  car: '#9aa3ae',
};

const GEOMS = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
};

interface Batch {
  key: string;
  shape: Prim['shape'];
  mat: Mat;
  prims: Prim[];
  /** Mueble al que pertenece cada pieza (null = mobiliario de una sala, no seleccionable). */
  owners: (string | null)[];
}

function Batched({ batch, floorId }: { batch: Batch; floorId: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    batch.prims.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot ?? 0);
      m.compose(new THREE.Vector3(p.x, p.y + p.h / 2, p.z), q, new THREE.Vector3(p.w, p.h, p.d));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [batch]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || e.instanceId === undefined) return;
    const owner = batch.owners[e.instanceId];
    if (!owner) return;
    e.stopPropagation();
    useStore.getState().select({ type: 'furniture', floorId, id: owner });
  };

  return (
    <instancedMesh ref={ref} args={[GEOMS[batch.shape], undefined, batch.prims.length]} onClick={onClick}>
      <meshStandardMaterial color={MAT_COLOR[batch.mat]} roughness={batch.mat === 'screen' ? 0.4 : 0.85} />
    </instancedMesh>
  );
}

/** Mobiliario de la planta (el colocado y el de las salas de reunión), agrupado por material. */
export function FurnitureLayer({ floor, selectedId }: { floor: Floor; selectedId: string | null }) {
  const furniture = useStore((s) => s.ui.showFurniture);
  const auto = useStore((s) => s.building.autoFurnish !== false);
  const batches = useMemo(() => {
    const map = new Map<string, Batch>();
    const add = (prims: Prim[], owner: string | null) => {
      for (const p of prims) {
        const key = p.shape + '|' + p.mat;
        let b = map.get(key);
        if (!b) map.set(key, (b = { key, shape: p.shape, mat: p.mat, prims: [], owners: [] }));
        b.prims.push(p);
        b.owners.push(owner);
      }
    };
    if (furniture) for (const m of floor.furniture ?? []) add(furnitureParts(m, floor), m.id);
    for (const s of floor.spaces) add(roomFurnitureParts(s, { furniture, auto }), null);
    return [...map.values()];
  }, [floor, furniture, auto]);

  const sel = furniture && selectedId ? floor.furniture?.find((m) => m.id === selectedId) : undefined;

  return (
    <group>
      {batches.map((b) => (
        // La clave incluye el número de piezas: InstancedMesh no puede crecer
        <Batched key={b.key + b.prims.length} batch={b} floorId={floor.id} />
      ))}
      {sel && (
        <mesh position={[sel.x + sel.w / 2, 0.6, sel.z + sel.d / 2]}>
          <boxGeometry args={[sel.w + 0.1, 1.2, sel.d + 0.1]} />
          <meshBasicMaterial color="#ff9f1c" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
