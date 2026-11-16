/**
 * Листы бумаги (world/papers.ts): слои из assets/papers/<id>.webp складываются в одну текстуру-стопку.
 * Игра стартует, не дожидаясь их: пока слоя нет, на его месте чистая пожелтевшая бумага.
 * Откуда листы и как их пересоздать — assets/papers/README.md.
 */
import { PAPER_H, PAPER_LAYERS, PAPER_W } from '../world/papers';

const FILES = import.meta.glob<string>('../../assets/papers/*.webp', { eager: true, query: '?url', import: 'default' });

/** Адрес файла по id слоя. */
export const PAPER_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]),
);

/** Загрузить слои. Слой, который не загрузился, останется чистым листом: игра от него не зависит. */
export async function loadPapers(): Promise<Record<string, HTMLImageElement>> {
  const out: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.entries(PAPER_URLS).map(async ([id, url]) => {
      const img = new Image();
      img.decoding = 'async';
      // Как плакаты и экраны: в песочнице iframe картинку надо просить с разрешением сервера (CORS),
      // иначе canvas «испачкается» и пиксели с него снять не дадут.
      img.crossOrigin = 'anonymous';
      img.src = url;
      try {
        await img.decode();
        out[id] = img;
      } catch {
        console.warn(`[vylazka] лист бумаги «${id}» не загрузился`);
      }
    }),
  );
  return out;
}

/**
 * Стопка слоёв для видеокарты: RGBA подряд, слой за слоем; строки идут снизу вверх (v растёт вверх).
 * Альфа у слоёв портретов — маска лиц: 255 — лица нет, 128 — середина лица (world/papers.ts). У
 * остальных слоёв и у чистого листа она 255.
 */
export interface PaperStack {
  data: Uint8Array;
  width: number;
  height: number;
  depth: number;
}

/** Цвет чистого листа (sRGB): слой, который ещё не пришёл. */
const BLANK: readonly [number, number, number] = [196, 187, 164];

/**
 * Собрать стопку. Только в браузере. scale — во сколько раз слой меньше полного (телефону полный размер
 * ни к чему). Слой, который «испачкал» свой canvas (сервер не разрешил читать картинку), остаётся
 * чистым листом, остальные целы.
 */
export function drawPapers(images: Readonly<Record<string, CanvasImageSource>> = {}, scale = 1): PaperStack {
  const width = Math.max(4, Math.round(PAPER_W * scale));
  const height = Math.max(4, Math.round(PAPER_H * scale));
  const depth = PAPER_LAYERS.length;
  const data = new Uint8Array(width * height * 4 * depth);
  const row = width * 4;
  PAPER_LAYERS.forEach((id, layer) => {
    const base = layer * row * height;
    const img = images[id];
    let pixels: Uint8ClampedArray | null = null;
    if (img) {
      // Свой canvas на слой: «испачканный» одной картинкой, он не отдал бы и остальные.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, width, height);
      try {
        pixels = g.getImageData(0, 0, width, height).data;
      } catch {
        console.warn(`[vylazka] лист бумаги «${id}» не удалось прочитать: сервер не разрешает читать картинки`);
      }
    }
    if (!pixels) {
      for (let i = 0; i < width * height; i++) data.set([BLANK[0], BLANK[1], BLANK[2], 255], base + i * 4);
      return;
    }
    for (let y = 0; y < height; y++) data.set(pixels.subarray(y * row, (y + 1) * row), base + (height - 1 - y) * row);
  });
  return { data, width, height, depth };
}
