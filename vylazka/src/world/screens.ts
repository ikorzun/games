/**
 * Выставочные экраны: большие панели, которые светятся картинкой. Приём взят с выставки: экран стоит
 * у стены, прислонённый, и показывает корни, мох, лес — вместо того чтобы это было здесь на самом деле.
 * В игре экраны заменяют то, чего нельзя (и незачем) лепить из геометрии: природу, странное, обрывки
 * поп-культуры. Память хранит не лес, а картинку леса.
 *
 * Здесь только данные и раскладка атласа — чистый TS, без canvas: уровень собирается и в тестах.
 * Атлас рисует render/screen_images.ts: первые клетки — кодом (настроечные полосы, «снег»), остальные —
 * картинки из assets/screens/<id>.webp. Экран светится и без файлов: тогда на нём «нет сигнала».
 */

/** Клетка атласа, px. Экраны вертикальные, 3 : 5. */
export const SCREEN_PW = 384;
export const SCREEN_PH = 640;
export const SCREEN_COLS = 5;

export type ScreenKind =
  /** Сигнала нет: настроечные полосы, «снег». Рисуется кодом. */
  | 'signal'
  /** Природа как она есть: корни, мох, лес. */
  | 'nature'
  /** Природа не на своём месте: проросшее, затопленное, зверь в подъезде. */
  | 'strange'
  /** Обрывки поп-культуры: студия телеигры, кадр мультфильма. Без узнаваемых героев и знаков. */
  | 'pop';

export interface ScreenImage {
  id: string;
  kind: ScreenKind;
  /** Коротко по-русски: что на картинке. */
  ru: string;
}

/** Клетки атласа по порядку. Файл картинки — assets/screens/<id>.webp (у «сигнала» файла нет). */
export const SCREEN_IMAGES: readonly ScreenImage[] = [
  { id: 'bars', kind: 'signal', ru: 'настроечные полосы: сигнала нет' },
  { id: 'snow', kind: 'signal', ru: '«снег» пустого канала' },
  { id: 'roots', kind: 'nature', ru: 'корни дерева в срезе рыжей земли' },
  { id: 'moss', kind: 'nature', ru: 'поваленный ствол во мху, еловый лес' },
  { id: 'lichen', kind: 'strange', ru: 'бетонная стена в разноцветном лишайнике и цветах' },
  { id: 'flooded', kind: 'strange', ru: 'комната, залитая прозрачной водой, кувшинки на полу' },
  { id: 'birches', kind: 'strange', ru: 'берёзы, проросшие сквозь пол офиса' },
  { id: 'deer', kind: 'strange', ru: 'олень на лестничной площадке панельного дома' },
  { id: 'gameshow', kind: 'pop', ru: 'пустая студия телеигры девяностых' },
  { id: 'cartoon', kind: 'pop', ru: 'кадр рисованного мультфильма: круглый зверь на холме' },
];

export const SCREEN_ROWS = Math.ceil(SCREEN_IMAGES.length / SCREEN_COLS);
export const SCREENS_W = SCREEN_COLS * SCREEN_PW;
export const SCREENS_H = SCREEN_ROWS * SCREEN_PH;

/** Клетка картинки в атласе, px: строка 0 — верхняя. */
export function screenCell(index: number): { x: number; y: number } {
  return { x: (index % SCREEN_COLS) * SCREEN_PW, y: Math.floor(index / SCREEN_COLS) * SCREEN_PH };
}

/**
 * uv картинки (v растёт вверх). Края поджаты на два пикселя, чтобы на уменьшенных копиях атласа
 * соседняя картинка не затекала в рамку. band — для лежачих экранов: какую долю высоты картинки
 * показывать (полоса по середине); 1 — всю.
 */
export function screenUv(index: number, band = 1): { u0: number; v0: number; u1: number; v1: number } {
  const c = screenCell(index);
  const cut = (SCREEN_PH * (1 - Math.min(1, Math.max(0.05, band)))) / 2;
  return {
    u0: (c.x + 2) / SCREENS_W,
    u1: (c.x + SCREEN_PW - 2) / SCREENS_W,
    v0: 1 - (c.y + SCREEN_PH - 2 - cut) / SCREENS_H,
    v1: 1 - (c.y + 2 + cut) / SCREENS_H,
  };
}

/** Что показывает экран: выбор по сиду предмета из картинок нужных родов (пусто — из всех). */
export function screenFor(seed: number, kinds: readonly ScreenKind[] = []): number {
  const pool = SCREEN_IMAGES.map((s, i) => [s, i] as const).filter(([s]) => kinds.length === 0 || kinds.includes(s.kind));
  const list = pool.length > 0 ? pool : SCREEN_IMAGES.map((s, i) => [s, i] as const);
  // Сид предмета — целое до миллиона; множитель разводит соседние сиды по разным картинкам.
  const k = Math.abs(Math.imul(Math.floor(seed) | 0, 2654435761) >>> 8) % list.length;
  return list[k]![1];
}
