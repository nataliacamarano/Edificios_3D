/**
 * Corrección de perspectiva de las fotos de los planos. Las fotos se hicieron con el móvil algo
 * inclinado, así que el edificio sale estrechándose hacia abajo (las fachadas, torcidas). Para cada
 * planta se miden en la foto las cuatro esquinas del edificio y se convierten en un rectángulo.
 * Los encuadres de cada foto concreta van con los datos de cada edificio.
 */
export type Pt = [number, number];
type Vec = { x: number; z: number };
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Caja (en metros) que envuelve las cuatro esquinas de un rectángulo de la foto: con la
 * corrección de perspectiva un rectángulo de la foto ya no sale exactamente rectangular.
 */
export function boxOf(P: (x: number, y: number) => Vec, [x1, y1, x2, y2]: [number, number, number, number]) {
  const pts = [P(x1, y1), P(x2, y1), P(x1, y2), P(x2, y2)];
  const minX = Math.min(...pts.map((p) => p.x));
  const minZ = Math.min(...pts.map((p) => p.z));
  return {
    x: minX,
    z: minZ,
    w: r2(Math.max(...pts.map((p) => p.x)) - minX),
    d: r2(Math.max(...pts.map((p) => p.z)) - minZ),
  };
}
export type Quad = [Pt, Pt, Pt, Pt];
type Mat3 = number[];

/** Homografía que lleva los cuatro puntos `src` a `dst` (matriz 3×3 por filas). */
export function homography(src: Quad, dst: Quad): Mat3 {
  // Sistema lineal 8×8 (h33 = 1)
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyH(h: Mat3, x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

/** Píxel de la foto → píxel corregido (sin corrección si no se dan las cuatro esquinas). */
export function rectifier(frame: { rectify?: { src: Quad; dst: Quad } }): (x: number, y: number) => Pt {
  if (!frame.rectify) return (x, y) => [x, y];
  const h = homography(frame.rectify.src, frame.rectify.dst);
  return (x, y) => applyH(h, x, y);
}
