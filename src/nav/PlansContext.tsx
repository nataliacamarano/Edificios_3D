import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setMaxTime } from '../sim/clock';
import { useStore } from '../store';
import { planPerson, Router, type PersonPlan } from './planner';

interface PlansValue {
  plans: PersonPlan[];
  maxTime: number;
}

const PlansCtx = createContext<PlansValue>({ plans: [], maxTime: 0 });

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Calcula una sola vez las rutas de todas las personas y las comparte con la escena y los paneles. */
export function PlansProvider({ children }: { children: ReactNode }) {
  // El edificio se rehace en cada arrastre del editor: se espera a que se quede quieto.
  const building = useDebounced(
    useStore((s) => s.building),
    200,
  );
  const persons = useStore((s) => s.persons);
  const rules = useStore((s) => s.rules);
  const startTime = useStore((s) => s.startTime);
  const routines = useStore((s) => s.routines);

  const router = useMemo(() => new Router(building), [building]);
  const value = useMemo<PlansValue>(() => {
    const plans = persons.map((p) => planPerson(router, rules, p, startTime, routines));
    return { plans, maxTime: Math.max(0, ...plans.map((p) => p.endTime)) };
  }, [router, persons, rules, startTime, routines]);

  useEffect(() => setMaxTime(value.maxTime), [value.maxTime]);

  return <PlansCtx.Provider value={value}>{children}</PlansCtx.Provider>;
}

export const usePlans = () => useContext(PlansCtx);
