/**
 * Carga una imagen del usuario y la reduce a `maxSide` píxeles por el lado mayor, en JPEG,
 * para que quepa en el almacenamiento del navegador y en el archivo de proyecto.
 */
export function loadImageAsDataUrl(file: File, maxSide = 1600): Promise<{ url: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('imagen no válida'));
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k);
        const h = Math.round(img.naturalHeight * k);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve({ url: canvas.toDataURL('image/jpeg', 0.82), w, h });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Metros por píxel iniciales de una foto nueva (se corrigen después con «Escala»). */
export const DEFAULT_PHOTO_SCALE = 0.05;
