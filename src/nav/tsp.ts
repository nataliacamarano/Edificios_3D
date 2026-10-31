/**
 * Orden de visita de menor coste con el nodo 0 fijo como inicio.
 * Exacto (Held-Karp) hasta 13 paradas; vecino más próximo + 2-opt a partir de ahí.
 */
export function solveTsp(m: number[][], returnToStart: boolean): number[] {
  const n = m.length;
  if (n <= 2) return [...Array(n).keys()];
  return n - 1 <= 12 ? heldKarp(m, returnToStart) : twoOpt(m, returnToStart, nearestNeighbour(m));
}

export function routeCost(m: number[][], order: number[], returnToStart: boolean) {
  let c = 0;
  for (let i = 1; i < order.length; i++) c += m[order[i - 1]][order[i]];
  if (returnToStart && order.length > 1) c += m[order[order.length - 1]][order[0]];
  return c;
}

function heldKarp(m: number[][], ret: boolean): number[] {
  const n = m.length;
  const k = n - 1;
  const size = 1 << k;
  const full = size - 1;
  const dp = new Float64Array(size * k).fill(Infinity);
  const parent = new Int16Array(size * k).fill(-1);
  for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = m[0][j + 1];

  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < k; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * k + j];
      if (!isFinite(cur)) continue;
      for (let nx = 0; nx < k; nx++) {
        if (mask & (1 << nx)) continue;
        const nm = mask | (1 << nx);
        const v = cur + m[j + 1][nx + 1];
        if (v < dp[nm * k + nx]) {
          dp[nm * k + nx] = v;
          parent[nm * k + nx] = j;
        }
      }
    }
  }

  let best = -1;
  let bestV = Infinity;
  for (let j = 0; j < k; j++) {
    const v = dp[full * k + j] + (ret ? m[j + 1][0] : 0);
    if (v < bestV) {
      bestV = v;
      best = j;
    }
  }
  if (best < 0) return [...Array(n).keys()];

  const order: number[] = [];
  let mask = full;
  let j = best;
  while (j >= 0) {
    order.push(j + 1);
    const pj = parent[mask * k + j];
    mask &= ~(1 << j);
    j = pj;
  }
  order.push(0);
  return order.reverse();
}

function nearestNeighbour(m: number[][]): number[] {
  const n = m.length;
  const used = new Array(n).fill(false);
  used[0] = true;
  const order = [0];
  for (let s = 1; s < n; s++) {
    const last = order[order.length - 1];
    let b = -1;
    let bv = Infinity;
    for (let j = 0; j < n; j++) {
      if (!used[j] && m[last][j] < bv) {
        bv = m[last][j];
        b = j;
      }
    }
    if (b < 0) b = used.indexOf(false);
    used[b] = true;
    order.push(b);
  }
  return order;
}

function twoOpt(m: number[][], ret: boolean, start: number[]): number[] {
  let order = start;
  let best = routeCost(m, order, ret);
  let improved = true;
  for (let guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 1; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const c = routeCost(m, cand, ret);
        if (c < best - 1e-9) {
          order = cand;
          best = c;
          improved = true;
        }
      }
    }
  }
  return order;
}
