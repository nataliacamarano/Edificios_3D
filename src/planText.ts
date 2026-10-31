import { createWorker, PSM, type Page } from 'tesseract.js';
import type { Background, Floor, Space, SpaceKind, Vec2 } from './types';
import { pixelToMeters } from './wallDetect';

/**
 * Lectura de los nombres escritos en la foto del plano (OCR con tesseract.js). El motor y el
 * idioma van dentro de la app (carpeta ocr/), así que funciona sin conexión, también en el
 * programa de escritorio.
 */
export interface PlanLabel {
  text: string;
  /** Centro de la etiqueta en la planta, en metros. */
  at: Vec2;
  /** Alto aproximado de la letra, en metros. */
  size: number;
  confidence: number;
}

/** Cuánto se amplía la foto antes de leerla: el OCR necesita letras de unos 20–30 píxeles. */
const UPSCALE = 3;

const asset = (name: string) => new URL(`ocr/${name}`, document.baseURI).href;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/**
 * Foto ampliada y en blanco y negro para el OCR, de dos maneras que aciertan cosas distintas:
 * - 'global': lo claro (fondo y rellenos de color) a blanco y lo oscuro a negro.
 * - 'local': es letra lo que queda más oscuro que lo que la rodea (letras grises sobre rosa o azul).
 */
function prepare(img: HTMLImageElement, k: number, mode: 'global' | 'local') {
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const W = c.width;
  const H = c.height;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
  let I: Float64Array | null = null;
  if (mode === 'local') {
    I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += lum[y * W + x];
        I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
      }
    }
  }
  const R = Math.round(6 * k);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const l = lum[y * W + x];
      let v: number;
      if (I) {
        const x0 = Math.max(0, x - R);
        const y0 = Math.max(0, y - R);
        const x1 = Math.min(W, x + R + 1);
        const y1 = Math.min(H, y + R + 1);
        const mean = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const diff = mean - l;
        v = diff < 8 ? 255 : Math.max(0, 255 - diff * 5);
      } else v = l > 190 ? 255 : Math.max(0, (l - 60) * 1.8);
      const i = (y * W + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
  ctx.putImageData(d, 0, 0);
  return c;
}

const clean = (s: string) =>
  s
    .replace(/[|_~^`´¨"“”'’;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Texto que parece un nombre de sala: con letras, no un trazo suelto leído como «ll» o «=». */
function looksLikeName(s: string) {
  const letters = (s.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length;
  return s.length >= 2 && letters >= 2 && letters / s.replace(/\s/g, '').length >= 0.6;
}

/** Palabras cortas habituales en un plano («WC M», «WC F», «Lift A»…): se aceptan con menos seguridad. */
const SHORT = /^(wc|m|f|a|b|c|d|e|n|s|lift|lav|tea|it|av|ups|plant|bin)$/i;

function keepWord(text: string, confidence: number) {
  const s = clean(text);
  if (s.length <= 3) return /^[A-Za-z0-9]{1,3}$/.test(s) && (confidence >= 75 || (SHORT.test(s) && confidence >= 40));
  return confidence >= 55 && looksLikeName(s);
}

type L = { text: string; x0: number; y0: number; x1: number; y1: number; conf: number };

/** Líneas de texto de una lectura, con las etiquetas en dos líneas ya unidas. */
function linesOf(data: Page): L[] {
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const ls: L[] = [];
  for (const line of lines) {
    const words = line.words.filter((w) => keepWord(w.text, w.confidence));
    if (!words.length) continue;
    const text = clean(words.map((w) => w.text).join(' '));
    // Una letra suelta sola no es un nombre (sí lo será unida a la línea de arriba, como «WC» + «M»)
    if (text.length < 1) continue;
    ls.push({
      text,
      x0: Math.min(...words.map((w) => w.bbox.x0)),
      y0: Math.min(...words.map((w) => w.bbox.y0)),
      x1: Math.max(...words.map((w) => w.bbox.x1)),
      y1: Math.max(...words.map((w) => w.bbox.y1)),
      conf: words.reduce((a, w) => a + w.confidence, 0) / words.length,
    });
  }
  // Etiquetas en dos líneas («Plant» / «Room», «WC» / «M»): una justo debajo de la otra y centradas
  ls.sort((a, b) => a.y0 - b.y0);
  const merged: L[] = [];
  for (const l of ls) {
    const h = l.y1 - l.y0;
    const above = merged.find(
      (m) =>
        l.y0 - m.y1 >= -h * 0.3 &&
        l.y0 - m.y1 <= h * 0.9 &&
        Math.abs((m.x0 + m.x1) / 2 - (l.x0 + l.x1) / 2) < Math.max(m.x1 - m.x0, l.x1 - l.x0) * 0.6 &&
        Math.abs(m.y1 - m.y0 - h) < h * 0.5,
    );
    if (above) {
      above.text = `${above.text} ${l.text}`;
      above.x0 = Math.min(above.x0, l.x0);
      above.x1 = Math.max(above.x1, l.x1);
      above.y1 = l.y1;
      above.conf = (above.conf + l.conf) / 2;
    } else merged.push({ ...l });
  }
  return merged.filter((l) => looksLikeName(l.text) || /^wc\b/i.test(l.text));
}

export async function readPlanLabels(url: string, bg: Background, onProgress?: (p: number) => void): Promise<PlanLabel[]> {
  const img = await loadImage(url);
  // Fotos grandes: menos ampliación, para no pasar de ~5000 píxeles de lado
  const k = Math.max(1, Math.min(UPSCALE, 5000 / Math.max(img.naturalWidth, img.naturalHeight)));
  const modes = ['global', 'local'] as const;
  let pass = 0;
  const worker = await createWorker('eng', 1, {
    workerPath: asset('worker.min.js'),
    corePath: asset('tesseract-core-simd-lstm.wasm.js'),
    langPath: new URL('ocr', document.baseURI).href,
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.((pass + m.progress) / modes.length);
    },
  });
  try {
    // Texto suelto por todo el plano (no párrafos)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const all: PlanLabel[] = [];
    for (const mode of modes) {
      const canvas = prepare(img, k, mode);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const toM = pixelToMeters(bg, canvas.width, canvas.height);
      for (const l of linesOf(data)) {
        const a = toM(l.x0, l.y0);
        const b = toM(l.x1, l.y1);
        all.push({
          text: l.text,
          at: toM((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2),
          size: Math.min(Math.abs(b.z - a.z), Math.abs(b.x - a.x)),
          confidence: Math.round(l.conf),
        });
      }
      pass++;
    }
    // Las dos lecturas juntas: si dos etiquetas caen en el mismo sitio, la más fiable
    const out: PlanLabel[] = [];
    for (const l of all.sort((a, b) => b.confidence - a.confidence))
      if (!out.some((o) => Math.hypot(o.at.x - l.at.x, o.at.z - l.at.z) < Math.max(1, o.size * 2))) out.push(l);
    return out;
  } finally {
    await worker.terminate();
  }
}

/** Lo que el texto dice de la sala: tipo y etiquetas (aseo de hombres, ascensor…). */
export function hintsFromText(text: string): { kind?: SpaceKind; tags: string[] } {
  const t = ` ${text.toLowerCase()} `;
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (has(' wc', 'toilet', 'restroom', 'aseo', 'baño', 'bano', ' lav', 'washroom', 'shower', 'ducha')) {
    const tags = ['aseo'];
    if (has(' wc m ', ' m ', 'men', 'male', 'gents', 'hombre', 'caballero')) tags.push('hombres');
    else if (has(' wc f ', ' f ', 'women', 'female', 'ladies', 'mujer', 'señora')) tags.push('mujeres');
    else if (has('accessible', 'disabled', 'adaptado', 'unisex', 'neutral', 'all gender', 'mixto')) tags.push('mixto');
    return { kind: 'restroom', tags };
  }
  if (has('lift', 'elevator', 'ascensor')) return { kind: 'lift', tags: [] };
  if (has('stair', 'escalera')) return { kind: 'stairs', tags: ['escalera'] };
  if (has('meeting', 'reunion', 'reunión', 'boardroom', 'conference')) return { kind: 'meeting', tags: [] };
  if (has('kitchen', 'cocina', 'pantry', 'tea point', 'coffee')) return { kind: 'kitchen', tags: [] };
  return { tags: [] };
}

/** Nombre puesto por la app (sin escribir a mano): estos sí se sustituyen por el texto del plano. */
export function isGenericName(name: string, kindLabels: string[]) {
  const n = name.trim().toLowerCase();
  return !n || /^(nueva estancia|new space|zona|area)\b/.test(n) || kindLabels.some((k) => new RegExp(`^${k.toLowerCase()}( \\d+)?$`).test(n));
}

export interface NameProposal {
  spaceId: string;
  current: string;
  text: string;
  kind?: SpaceKind;
  tags: string[];
  /** Propuesta marcada por defecto (la sala tenía un nombre genérico). */
  apply: boolean;
}

/**
 * Aseo de hombres, mujeres o adaptado por el color del relleno, según la costumbre de los planos:
 * azul hombres, rosa mujeres, verde adaptado. Solo cuando el texto no lo dice.
 */
export function genderFromColor(hex?: string): string | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return null;
  const d = max - min;
  const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const deg = hue * 60;
  if (deg >= 180 && deg < 260) return 'hombres';
  if (deg >= 300 || deg < 20) return 'mujeres';
  if (deg >= 80 && deg < 170) return 'mixto';
  return null;
}

const inside = (p: Vec2, s: Space, m = 0) => p.x >= s.x - m && p.x <= s.x + s.w + m && p.z >= s.z - m && p.z <= s.z + s.d + m;

/** Para cada sala, el texto que cae dentro (el más grande si hay varios). */
export function proposeNames(floor: Floor, labels: PlanLabel[], kindLabels: string[]): NameProposal[] {
  const out: NameProposal[] = [];
  // Las salas más pequeñas primero: una etiqueta dentro de un aseo no se la queda el pasillo de alrededor
  const spaces = [...floor.spaces].sort((a, b) => a.w * a.d - b.w * b.d);
  const used = new Set<PlanLabel>();
  for (const s of spaces) {
    const here = labels.filter((l) => !used.has(l) && inside(l.at, s, 0.1));
    if (!here.length) continue;
    const best = here.reduce((a, b) => (b.size * b.text.length > a.size * a.text.length ? b : a));
    used.add(best);
    if (best.text === s.name) continue;
    const hints = hintsFromText(best.text);
    const isRestroom = (hints.kind ?? s.kind) === 'restroom';
    if (isRestroom && !['hombres', 'mujeres', 'mixto'].some((g) => hints.tags.includes(g) || s.tags.includes(g))) {
      const g = genderFromColor(s.color);
      if (g) hints.tags.push(...(hints.tags.includes('aseo') || s.tags.includes('aseo') ? [g] : ['aseo', g]));
    }
    // «WC» a secas no distingue un aseo de otro: se le añade de quién es
    const gender = hints.tags.find((g) => g === 'hombres' || g === 'mujeres');
    const text = /^wc$/i.test(best.text) ? `WC${gender ? ' ' + gender : ''}` : best.text;
    out.push({
      spaceId: s.id,
      current: s.name,
      text,
      // El tipo solo cambia si la sala no lo tenía claro (sala genérica)
      kind: s.kind === 'room' || s.kind === 'workspace' ? hints.kind : undefined,
      tags: hints.tags.filter((t) => !s.tags.includes(t)),
      apply: isGenericName(s.name, kindLabels),
    });
  }
  return out;
}
