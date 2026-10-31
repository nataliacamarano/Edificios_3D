import { applyH, homography, type Pt, type Quad } from './data/rectify';

/**
 * Endereza la foto de un plano hecha con el móvil algo inclinado: las cuatro esquinas del edificio
 * (en fracciones 0–1 de la foto, en cualquier orden) pasan a ser un rectángulo. Es lo mismo que se
 * hizo a mano con las fotos de las plantas 9, 5 y 1, ahora para cualquier foto.
 */
export interface RectifiedPhoto {
  /** Foto corregida, del mismo tamaño que la original. */
  dataUrl: string;
  /** Rectángulo del edificio en la foto corregida, en fracciones 0–1: [x0, y0, x1, y1]. */
  rect: [number, number, number, number];
}

/** Ordena cuatro puntos como sup. izq., sup. dcha., inf. dcha., inf. izq. */
export function orderCorners(pts: Pt[]): Quad {
  const by = (f: (p: Pt) => number, max: boolean) => pts.reduce((a, b) => ((max ? f(b) > f(a) : f(b) < f(a)) ? b : a));
  return [by((p) => p[0] + p[1], false), by((p) => p[0] - p[1], true), by((p) => p[0] + p[1], true), by((p) => p[0] - p[1], false)];
}

export function rectifyPhoto(url: string, corners01: Pt[], maxDim = 3000): Promise<RectifiedPhoto> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const W = Math.round(img.naturalWidth * k);
      const H = Math.round(img.naturalHeight * k);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, W, H);
      const src = ctx.getImageData(0, 0, W, H).data;

      const q = orderCorners(corners01.map(([x, y]) => [x * W, y * H] as Pt));
      // Rectángulo destino: lados medios de las esquinas marcadas
      const x0 = (q[0][0] + q[3][0]) / 2;
      const x1 = (q[1][0] + q[2][0]) / 2;
      const y0 = (q[0][1] + q[1][1]) / 2;
      const y1 = (q[3][1] + q[2][1]) / 2;
      const dst: Quad = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      // Para cada píxel de la foto corregida, de qué punto de la original viene
      const back = homography(dst, q);
      const out = ctx.createImageData(W, H);
      const o = out.data;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const [sx, sy] = applyH(back, x + 0.5, y + 0.5);
          const i = (y * W + x) * 4;
          const fx = sx - 0.5;
          const fy = sy - 0.5;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) {
            o[i] = o[i + 1] = o[i + 2] = 255;
            o[i + 3] = 255;
            continue;
          }
          // Interpolación bilineal
          const ax = fx - ix;
          const ay = fy - iy;
          const p00 = (iy * W + ix) * 4;
          const p10 = p00 + 4;
          const p01 = p00 + W * 4;
          const p11 = p01 + 4;
          for (let ch = 0; ch < 3; ch++)
            o[i + ch] =
              (src[p00 + ch] * (1 - ax) + src[p10 + ch] * ax) * (1 - ay) + (src[p01 + ch] * (1 - ax) + src[p11 + ch] * ax) * ay;
          o[i + 3] = 255;
        }
      ctx.putImageData(out, 0, 0);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), rect: [x0 / W, y0 / H, x1 / W, y1 / H] });
    };
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}
