import { useSyncExternalStore } from 'react';

/**
 * Reloj global de la simulación. Vive fuera de React: la escena 3D lo lee en cada frame
 * y la interfaz se refresca como mucho cada 100 ms.
 */
export const clock = {
  t: 0,
  playing: false,
  speed: 10,
  maxT: 0,
};

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function setTime(t: number) {
  clock.t = Math.max(0, t);
  emit();
}

export function setPlaying(playing: boolean) {
  if (playing && clock.maxT > 0 && clock.t >= clock.maxT) clock.t = 0;
  clock.playing = playing;
  emit();
}

export function setSpeed(speed: number) {
  clock.speed = speed;
  emit();
}

export function setMaxTime(maxT: number) {
  clock.maxT = maxT;
  emit();
}

let last = performance.now();
let lastEmit = 0;
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (clock.playing) {
    clock.t += dt * clock.speed;
    if (clock.maxT > 0 && clock.t >= clock.maxT) {
      clock.t = clock.maxT;
      clock.playing = false;
      emit();
    } else if (now - lastEmit > 100) {
      lastEmit = now;
      emit();
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Vuelve a renderizar el componente cuando avanza el reloj. */
export function useClockTick() {
  return useSyncExternalStore(subscribe, () => version);
}
