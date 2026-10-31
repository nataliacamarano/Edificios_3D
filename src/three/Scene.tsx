import { Html, OrbitControls, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import { LOCAL } from '../data/localData';
import { bbox, compassMarks } from '../geometry';
import { useT, type TKey } from '../i18n';
import { useActiveFloor, useStore } from '../store';
import type { Background, Floor, NorthDir } from '../types';
import { PeopleLayer, RoutesLayer } from './People';
import { FurnitureLayer } from './FurnitureLayer';
import { ItemMesh } from './ItemMesh';
import { SpaceMesh, WallBox } from './SpaceMesh';

// Fotos de los planos que van dentro de la app (las de los datos locales, si los hay)
const BUNDLED: Record<string, string> = LOCAL?.photos ?? {};

export const assetUrl = (src: string) =>
  BUNDLED[src] ?? (/^(https?:|data:|blob:)/.test(src) ? src : import.meta.env.BASE_URL + src.replace(/^\//, ''));

/** Evita que un fallo al cargar la foto tire abajo toda la escena. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PhotoPlane({ bg, opacity }: { bg: Background; opacity: number }) {
  const tex = useTexture(assetUrl(bg.src));
  tex.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh
      position={[bg.x + bg.w / 2, 0.065, bg.z + bg.d / 2]}
      rotation={[-Math.PI / 2, 0, ((bg.rotation ?? 0) * Math.PI) / 180]}
    >
      <planeGeometry args={[bg.w, bg.d]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

const NORTH_VECTORS: Record<NorthDir, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

/** Gira la rosa de los vientos de la esquina para que su N apunte al norte real en pantalla. */
function NorthTracker({ target, cx, cz, north }: { target: RefObject<HTMLDivElement | null>; cx: number; cz: number; north: NorthDir }) {
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const el = target.current;
    if (!el) return;
    const [nx, nz] = NORTH_VECTORS[north];
    a.set(cx, 0, cz).project(camera);
    b.set(cx + nx * 10, 0, cz + nz * 10).project(camera);
    // Ángulo en pantalla (y hacia abajo); la flecha del widget apunta hacia arriba a 0°
    const ang = Math.atan2(-(b.y - a.y), b.x - a.x);
    el.style.transform = `rotate(${(ang * 180) / Math.PI + 90}deg)`;
  });
  return null;
}

function CompassRose({ innerRef }: { innerRef: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  return (
    <div className="compass-rose" title={t('northDir')}>
      <div ref={innerRef} className="compass-rose-inner">
        <svg viewBox="-50 -50 100 100" width="100%" height="100%">
          <circle r="46" fill="rgba(255,255,255,0.92)" stroke="#cbd5e1" strokeWidth="2" />
          <polygon points="0,-34 9,0 -9,0" fill="#dc2626" />
          <polygon points="0,34 9,0 -9,0" fill="#94a3b8" />
          {(['n', 'e', 's', 'w'] as const).map((d, i) => {
            const ang = (i * Math.PI) / 2;
            return (
              <text
                key={d}
                x={Math.sin(ang) * 40}
                y={-Math.cos(ang) * 40 + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="13"
                fontWeight="800"
                fill={d === 'n' ? '#dc2626' : '#334155'}
              >
                {t(`compass_${d}` as TKey)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Letras N/S/E/O alrededor de la planta; el norte en rojo. */
function CompassMarks({ floor }: { floor: Floor }) {
  const t = useT();
  if (!floor.northDir || floor.outline.length < 3) return null;
  return (
    <>
      {compassMarks(floor.outline, floor.northDir, 3).map(({ dir, pos }) => (
        <Html key={dir} position={[pos.x, 0.3, pos.z]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`compass${dir === 'n' ? ' north' : ''}`}>{t(`compass_${dir}` as TKey)}</div>
        </Html>
      ))}
    </>
  );
}

function FloorModel({ floor }: { floor: Floor }) {
  const wallHeight = useStore((s) => s.ui.wallHeight);
  const showLabels = useStore((s) => s.ui.showLabels);
  const showPhoto = useStore((s) => s.ui.showPhoto);
  const photoOpacity = useStore((s) => s.ui.photoOpacity);
  const selection = useStore((s) => s.ui.selection);
  const building = useStore((s) => s.building);
  const items = (building.items ?? []).filter((i) => i.floorId === floor.id);

  const slab = useMemo(() => {
    if (floor.outline.length < 3) return null;
    const shape = new THREE.Shape(floor.outline.map((p) => new THREE.Vector2(p.x, -p.z)));
    return new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
  }, [floor.outline]);

  const edges = floor.outline.map((p, i) => [p, floor.outline[(i + 1) % floor.outline.length]] as const);

  return (
    <group>
      {slab && (
        <mesh geometry={slab} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]}>
          <meshStandardMaterial color="#f6f6f3" side={THREE.DoubleSide} />
        </mesh>
      )}
      {showPhoto && floor.background && (
        <Quiet>
          <Suspense fallback={null}>
            <PhotoPlane bg={floor.background} opacity={photoOpacity} />
          </Suspense>
        </Quiet>
      )}
      <CompassMarks floor={floor} />
      {edges.map(([a, b], i) => (
        <WallBox key={i} a={a} b={b} height={wallHeight} thickness={0.25} extend={0.25} color="#9fc3dc" opacity={0.45} />
      ))}
      {floor.walls.map((w) => (
        <WallBox
          key={w.id}
          a={w.a}
          b={w.b}
          height={wallHeight}
          thickness={0.18}
          extend={0.18}
          color={selection?.id === w.id ? '#ff9f1c' : '#8a93a0'}
        />
      ))}
      <FurnitureLayer floor={floor} selectedId={selection?.type === 'furniture' ? selection.id : null} />
      {items.map((i) => (
        <ItemMesh
          key={i.id}
          item={i}
          building={building}
          selected={selection?.id === i.id}
          showLabel={showLabels}
          wallHeight={wallHeight}
        />
      ))}
      {floor.spaces.map((s) => (
        <SpaceMesh
          key={s.id}
          space={s}
          floorId={floor.id}
          selected={selection?.id === s.id}
          wallHeight={wallHeight}
          showLabel={showLabels}
        />
      ))}
    </group>
  );
}

/** Coloca la cámara en la vista inicial al cambiar de planta o al pulsar «Reencuadrar». */
function CameraReset({ token, cx, cz, size }: { token: number; cx: number; cz: number; size: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  useEffect(() => {
    camera.position.set(cx, size * 0.7, cz + size * 0.62);
    if (controls) {
      controls.target.set(cx, 0, cz);
      controls.update();
    }
  }, [token, cx, cz, size, camera, controls]);
  return null;
}

export default function Scene() {
  const t = useT();
  const floor = useActiveFloor();
  const [camToken, setCamToken] = useState(0);
  const roseRef = useRef<HTMLDivElement>(null);
  const bb = bbox(floor.outline);
  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const size = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 10);

  return (
    <div className="canvas-wrap">
      <button className="btn small cam-reset" onClick={() => setCamToken((n) => n + 1)}>
        ⤢ {t('resetCamera')}
      </button>
      <Canvas
        camera={{ position: [cx, size * 0.7, cz + size * 0.62], fov: 45, near: 0.1, far: 2000 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#e7ecf2']} />
        <hemisphereLight args={['#ffffff', '#aab4c2', 1.1]} />
        <directionalLight position={[cx + 25, 60, cz + 35]} intensity={1.4} />
        <directionalLight position={[cx - 30, 40, cz - 20]} intensity={0.4} />
        <FloorModel floor={floor} />
        <RoutesLayer floorId={floor.id} />
        <PeopleLayer floorId={floor.id} />
        <OrbitControls makeDefault target={[cx, 0, cz]} maxPolarAngle={Math.PI * 0.48} enableDamping />
        <CameraReset token={camToken} cx={cx} cz={cz} size={size} />
        {floor.northDir && <NorthTracker target={roseRef} cx={cx} cz={cz} north={floor.northDir} />}
      </Canvas>
      {floor.northDir && <CompassRose innerRef={roseRef} />}
    </div>
  );
}
