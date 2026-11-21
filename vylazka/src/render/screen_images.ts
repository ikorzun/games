/**
 * Картинки выставочных экранов (world/screens.ts): отдельный атлас. Первые клетки рисует код —
 * настроечные полосы и «снег», поэтому экран светится и без файлов; остальные — картинки из
 * assets/screens/<id>.webp. Игра стартует, не дожидаясь их, и перерисовывает атлас, когда они пришли.
 * Откуда картинки и как их пересоздать — assets/screens/README.md.
 */
import { SCREEN_IMAGES, SCREEN_PH, SCREEN_PW, screenCell, SCREENS_H, SCREENS_W } from '../world/screens';

const FILES = import.meta.glob<string>('../../assets/screens/*.webp', { eager: true, query: '?url', import: 'default' });

/** Адрес файла по id картинки. */
export const SCREEN_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]),
);

/** Загрузить картинки экранов. Та, что не загрузилась, останется «без сигнала»: игра от неё не зависит. */
export async function loadScreens(): Promise<Record<string, HTMLImageElement>> {
  const out: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.entries(SCREEN_URLS).map(async ([id, url]) => {
      const img = new Image();
      img.decoding = 'async';
      // Как и плакаты: в песочнице iframe картинку надо просить с разрешением сервера (CORS), иначе
      // canvas «испачкается» и текстуру с него снять не дадут.
      img.crossOrigin = 'anonymous';
      img.src = url;
      try {
        await img.decode();
        out[id] = img;
      } catch {
        console.warn(`[vylazka] картинка экрана «${id}» не загрузилась`);
      }
    }),
  );
  return out;
}

type G = CanvasRenderingContext2D;

/** Целочисленный шум: один и тот же рисунок на любом устройстве. */
function noise(i: number): number {
  let n = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Настроечные полосы: семь цветных столбцов, под ними серая шкала. Ничьей таблицы не повторяет. */
function bars(g: G, x: number, y: number): void {
  const cols = ['#b4b4b4', '#b4b414', '#14b4b4', '#14b414', '#b414b4', '#b41414', '#1414b4'];
  const w = SCREEN_PW / cols.length;
  const top = Math.round(SCREEN_PH * 0.72);
  cols.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(x + Math.floor(i * w), y, Math.ceil(w), top);
  });
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 200);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x + Math.floor((i * SCREEN_PW) / 8), y + top, Math.ceil(SCREEN_PW / 8), SCREEN_PH - top);
  }
  g.fillStyle = '#101010';
  g.fillRect(x, y + top - 3, SCREEN_PW, 6);
}

/** «Снег» пустого канала: крупное зерно, тёмные горизонтальные полосы. */
function snow(g: G, x: number, y: number): void {
  const cell = 4;
  for (let j = 0; j < SCREEN_PH / cell; j++) {
    const band = 0.55 + 0.45 * Math.sin(j * 0.21) * Math.sin(j * 0.047 + 1.3);
    for (let i = 0; i < SCREEN_PW / cell; i++) {
      const v = Math.round(30 + 190 * noise(i * 7919 + j * 104729) * band);
      g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 8)})`;
      g.fillRect(x + i * cell, y + j * cell, cell, cell);
    }
  }
}

/** Нарисовать атлас экранов. Только в браузере. images — картинки, которые уже загрузились. */
export function drawScreens(images: Readonly<Record<string, CanvasImageSource>> = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SCREENS_W;
  canvas.height = SCREENS_H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, SCREENS_W, SCREENS_H);
  SCREEN_IMAGES.forEach((s, i) => {
    const { x, y } = screenCell(i);
    const img = images[s.id];
    if (img) g.drawImage(img, x, y, SCREEN_PW, SCREEN_PH);
    else if (s.id === 'snow') snow(g, x, y);
    // Картинка ещё не пришла (или её нет вовсе) — на экране настроечные полосы.
    else bars(g, x, y);
  });
  return canvas;
}
