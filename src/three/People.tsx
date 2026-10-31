import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';
import { usePlans } from '../nav/PlansContext';
import { samplePlan, type PersonPlan } from '../nav/planner';
import { clock } from '../sim/clock';
import { useStore } from '../store';

function Avatar({ plan, floorId, index }: { plan: PersonPlan; floorId: string; index: number }) {
  const ref = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const color = plan.person.color;

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const s = samplePlan(plan, clock.t);
    const visible = !!s && s.floorId === floorId;
    g.visible = visible;
    if (labelRef.current) labelRef.current.style.display = visible ? '' : 'none';
    if (!s || !visible) return;
    // Quien está parado en una estancia se desplaza un poco para no solaparse con los demás.
    let ox = 0;
    let oz = 0;
    if (s.state !== 'walk' && index > 0) {
      const ang = index * 2.39996;
      ox = Math.cos(ang) * 0.55;
      oz = Math.sin(ang) * 0.55;
    }
    g.position.set(s.pos.x + ox, 0, s.pos.z + oz);
  });

  return (
    <group ref={ref}>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.24, 0.3, 1.0, 20]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        <sphereGeometry args={[0.22, 20, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.5, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <Html position={[0, 2.0, 0]} center zIndexRange={[8, 6]} style={{ pointerEvents: 'none' }}>
        <div ref={labelRef} className="person3d" style={{ background: color }}>
          {plan.person.name}
        </div>
      </Html>
    </group>
  );
}

export function PeopleLayer({ floorId }: { floorId: string }) {
  const { plans } = usePlans();
  return (
    <>
      {plans.map((p, i) => (
        <Avatar key={p.person.id} plan={p} floorId={floorId} index={i} />
      ))}
    </>
  );
}

export function RoutesLayer({ floorId }: { floorId: string }) {
  const { plans } = usePlans();
  const show = useStore((s) => s.ui.showRoutes);
  if (!show) return null;
  return (
    <>
      {plans.map((p, pi) => {
        const y = 0.09 + pi * 0.02;
        // Las paradas automáticas del good lift llevan 🛗 en lugar de número
        let num = 0;
        const visits = p.order.map((nodeIdx) => {
          const node = p.nodes[nodeIdx];
          return { node, label: node.stopIndex === -1 ? '🛗' : String(++num) };
        });
        return (
          <group key={p.person.id}>
            {p.legs.flat().map((s, i) =>
              s.kind === 'walk' && s.floorId === floorId && s.pts.length > 1 ? (
                <Line
                  key={i}
                  points={s.pts.map((q) => [q.x, y, q.z] as [number, number, number])}
                  color={p.person.color}
                  lineWidth={3}
                  transparent
                  opacity={0.85}
                />
              ) : null,
            )}
            {visits.map(({ node, label }) =>
              node.floorId === floorId ? (
                <Html
                  key={node.stop.id}
                  position={[node.anchor.x + 0.5 * pi, 0.3, node.anchor.z]}
                  center
                  zIndexRange={[7, 6]}
                  style={{ pointerEvents: 'none' }}
                >
                  <div className="stop-badge" style={{ background: p.person.color }}>
                    {label}
                  </div>
                </Html>
              ) : null,
            )}
          </group>
        );
      })}
    </>
  );
}
