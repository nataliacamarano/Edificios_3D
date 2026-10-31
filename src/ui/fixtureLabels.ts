import type { FixtureKind } from '../types';

export const FIXTURE_ORDER: FixtureKind[] = ['wc', 'urinal', 'sink', 'shower', 'dressing', 'bench', 'locker'];

export const FIXTURE_ICON: Record<FixtureKind, string> = {
  wc: '🚽',
  urinal: '🚹',
  sink: '🚰',
  shower: '🚿',
  dressing: '👕',
  bench: '🪑',
  locker: '🗄️',
};
