/**
 * Реквизит убежища. Соглашение для настенных предметов: стена позади (z < 0), предмет стоит у z = 0
 * лицом к +z, по ширине центрирован по x = 0, начало координат — на полу. Исключения оговорены.
 * Всё собрано из коробок с фасками и цилиндров; детали мельче ладони — отдельными деталями, а не текстурой.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';

const DARK: Vec3 = [0.3, 0.3, 0.3];
const GREY: Vec3 = [0.6, 0.6, 0.6];
const dim = (t: Vec3, k: number): Vec3 => [t[0] * k, t[1] * k, t[2] * k];

/** Простой детерминированный разброс для мелочей на полках (на геймплей не влияет). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Стеллаж 1,2 × 0,45 × 1,9 м с ящиками и коробками. Возвращает высоты полок (для находок). */
export function shelfRack(xf: Xf, seed: number, paper = false): number[] {
  const w = 1.2;
  const d = 0.45;
  const rnd = lcg(seed);
  for (const x of [-w / 2, w / 2 - 0.04]) {
    for (const z of [0.02, d - 0.04]) xf.box([x, 0, z], [x + 0.04, 1.9, z + 0.04], MAT.steel, { tint: GREY, aoBottom: 0.6 });
  }
  const shelves = [0.25, 0.7, 1.15, 1.6];
  for (const y of shelves) {
    xf.box([-w / 2, y - 0.025, 0.02], [w / 2, y, d], MAT.steel, { tint: [0.5, 0.5, 0.5] });
    let x = -w / 2 + 0.06;
    while (x < w / 2 - 0.2) {
      const bw = paper ? 0.05 + rnd() * 0.07 : 0.2 + rnd() * 0.25;
      if (rnd() < (paper ? 0.9 : 0.72)) {
        const bh = paper ? 0.26 + rnd() * 0.1 : 0.12 + rnd() * 0.22;
        const bd = paper ? 0.24 + rnd() * 0.06 : 0.25 + rnd() * 0.12;
        const g = 0.7 + rnd() * 0.3;
        if (paper) xf.box([x, y, 0.08], [Math.min(x + bw, w / 2 - 0.05), y + bh, 0.08 + bd], MAT.paper, { tint: [g, g * (0.85 + rnd() * 0.15), g * 0.8] });
        else xf.box([x, y, 0.07], [Math.min(x + bw, w / 2 - 0.05), y + bh, 0.07 + bd], rnd() < 0.6 ? MAT.wood : MAT.canvas, { bevel: 0.008, tint: [g, g, g] });
      }
      x += bw + (paper ? 0.004 : 0.03 + rnd() * 0.05);
    }
  }
  xf.collider([-w / 2, 0, 0], [w / 2, 1.9, d]);
  return shelves;
}

/** Письменный стол 1,2 × 0,6 м с тумбой, спинкой к стене. */
export function desk(xf: Xf): void {
  xf.box([-0.6, 0.72, 0.03], [0.6, 0.76, 0.63], MAT.wood, { bevel: 0.01, tint: [0.85, 0.8, 0.75] });
  xf.box([0.18, 0.08, 0.06], [0.57, 0.72, 0.6], MAT.wood, { bevel: 0.008, tint: [0.75, 0.7, 0.65], aoBottom: 0.6 });
  for (const y of [0.2, 0.4, 0.58]) {
    xf.box([0.2, y, 0.6], [0.55, y + 0.15, 0.612], MAT.wood, { tint: [0.9, 0.85, 0.8] });
    xf.box([0.34, y + 0.06, 0.612], [0.41, y + 0.085, 0.63], MAT.brass);
  }
  for (const z of [0.06, 0.56]) xf.box([-0.57, 0, z], [-0.53, 0.72, z + 0.04], MAT.wood, { tint: [0.7, 0.65, 0.6], aoBottom: 0.6 });
  xf.box([-0.57, 0.3, 0.06], [-0.53, 0.72, 0.6], MAT.wood, { tint: [0.75, 0.7, 0.65] });
  xf.collider([-0.6, 0, 0.03], [0.6, 0.76, 0.63]);
}

/** Стул. Начало — центр сиденья на полу, спинка у −z. */
export function chair(xf: Xf): void {
  xf.box([-0.2, 0.43, -0.2], [0.2, 0.47, 0.2], MAT.wood, { bevel: 0.01, tint: [0.8, 0.75, 0.7] });
  for (const x of [-0.19, 0.16]) for (const z of [-0.19, 0.16]) xf.box([x, 0, z], [x + 0.03, 0.43, z + 0.03], MAT.steel, { tint: DARK, aoBottom: 0.6 });
  xf.box([-0.19, 0.47, -0.2], [-0.16, 0.9, -0.17], MAT.steel, { tint: DARK });
  xf.box([0.16, 0.47, -0.2], [0.19, 0.9, -0.17], MAT.steel, { tint: DARK });
  xf.box([-0.2, 0.68, -0.21], [0.2, 0.88, -0.185], MAT.wood, { bevel: 0.008, tint: [0.8, 0.75, 0.7] });
  xf.collider([-0.2, 0, -0.2], [0.2, 0.47, 0.2]);
}

/** Радиостанция на столе: ящик с ручками настройки, шкалой и тангентой. Начало — центр на столешнице. */
export function radioSet(xf: Xf): void {
  xf.box([-0.24, 0, -0.14], [0.24, 0.26, 0.14], MAT.metalGreen, { bevel: 0.012 });
  xf.box([-0.2, 0.13, 0.14], [0.02, 0.22, 0.146], MAT.paper, { tint: [0.9, 0.85, 0.6] });
  for (const x of [-0.16, -0.06, 0.08, 0.17]) xf.cyl([x, 0.07, 0.14], 'z', 0.025, 0.026, MAT.rubber, { segments: 8 });
  xf.box([0.07, 0.13, 0.14], [0.2, 0.22, 0.148], MAT.rubber, { tint: DARK });
  xf.box([0.3, 0, -0.06], [0.36, 0.045, 0.1], MAT.rubber, { bevel: 0.01 });
}

/** Доска с картой или схемой на стене. Начало — центр доски. */
export function mapBoard(xf: Xf, w = 1.4, h = 0.9): void {
  xf.box([-w / 2 - 0.03, -h / 2 - 0.03, 0], [w / 2 + 0.03, h / 2 + 0.03, 0.02], MAT.wood, { tint: [0.6, 0.55, 0.5] });
  xf.box([-w / 2, -h / 2, 0.02], [w / 2, h / 2, 0.026], MAT.paper, { tint: [0.95, 0.92, 0.82] });
  // Пометки: полоски и квадраты «условных знаков».
  const rnd = lcg(Math.round(w * 100 + h * 7));
  for (let i = 0; i < 9; i++) {
    const x = (rnd() - 0.5) * (w - 0.3);
    const y = (rnd() - 0.5) * (h - 0.2);
    xf.box([x, y, 0.026], [x + 0.05 + rnd() * 0.22, y + 0.012 + rnd() * 0.05, 0.029], rnd() < 0.5 ? MAT.paintRed : MAT.paintBlue);
  }
}

/** Сейф 0,5 × 0,45 × 0,75 м. */
export function safe(xf: Xf): void {
  xf.solid([-0.25, 0, 0.02], [0.25, 0.75, 0.47], MAT.metalGreen, { bevel: 0.02, tint: [0.75, 0.8, 0.85], aoBottom: 0.6 });
  xf.box([-0.2, 0.06, 0.47], [0.2, 0.69, 0.485], MAT.metalGreen, { bevel: 0.008, tint: [0.85, 0.9, 0.95] });
  xf.cyl([0.08, 0.38, 0.485], 'z', 0.03, 0.06, MAT.steel, { segments: 10 });
  xf.box([-0.13, 0.36, 0.485], [-0.05, 0.4, 0.52], MAT.brass);
}

/** Медицинская кушетка 1,9 × 0,65 м вдоль стены. */
export function cot(xf: Xf): void {
  for (const x of [-0.92, 0.88]) for (const z of [0.04, 0.62]) xf.box([x, 0, z], [x + 0.035, 0.5, z + 0.035], MAT.enamel, { tint: [0.8, 0.8, 0.78], aoBottom: 0.6 });
  xf.box([-0.95, 0.46, 0.02], [0.95, 0.5, 0.67], MAT.enamel, { tint: [0.8, 0.8, 0.78] });
  xf.box([-0.94, 0.5, 0.03], [0.94, 0.58, 0.66], MAT.canvas, { bevel: 0.025, tint: [1.1, 1.05, 0.95] });
  xf.box([-0.92, 0.58, 0.08], [-0.55, 0.66, 0.6], MAT.canvas, { bevel: 0.03, tint: [1.25, 1.2, 1.1] });
  xf.collider([-0.95, 0, 0.02], [0.95, 0.58, 0.67]);
}

/** Медицинский шкаф: белая эмаль, «стеклянный» верх с полками и склянками. */
export function medCabinet(xf: Xf): void {
  xf.solid([-0.32, 0, 0.02], [0.32, 1.7, 0.36], MAT.enamel, { bevel: 0.012, aoBottom: 0.6 });
  xf.box([-0.27, 0.92, 0.36], [0.27, 1.64, 0.366], MAT.steel, { tint: [0.35, 0.42, 0.45] });
  for (const y of [1.15, 1.4]) xf.box([-0.27, y, 0.366], [0.27, y + 0.012, 0.372], MAT.enamel);
  for (const [x, y] of [
    [-0.18, 0.94],
    [-0.02, 0.94],
    [0.12, 1.165],
    [-0.14, 1.415],
    [0.05, 1.415],
  ] as const) {
    xf.cyl([x, y, 0.38], 'y', 0.09, 0.022, MAT.brass, { segments: 6, tint: [0.7, 0.45, 0.25] });
  }
  xf.box([-0.27, 0.08, 0.36], [0.27, 0.84, 0.372], MAT.enamel, { bevel: 0.006, tint: [0.95, 0.95, 0.95] });
  xf.box([-0.03, 0.42, 0.372], [0.03, 0.5, 0.395], MAT.steel);
  // Красный крест.
  xf.box([-0.07, 0.6, 0.372], [0.07, 0.64, 0.376], MAT.paintRed);
  xf.box([-0.02, 0.55, 0.372], [0.02, 0.69, 0.376], MAT.paintRed);
}

/** Ряд умывальников: n раковин с кранами и общей трубой. Ширина — 0,62 м на раковину. */
export function sinkRow(xf: Xf, n: number): void {
  const w = n * 0.62;
  xf.cyl([-w / 2, 1.12, 0.05], 'x', w, 0.016, MAT.steel, { segments: 6, caps: false });
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.31 + i * 0.62;
    xf.box([x - 0.25, 0.72, 0], [x + 0.25, 0.86, 0.42], MAT.enamel, { bevel: 0.025, tint: [0.92, 0.92, 0.9] });
    xf.box([x - 0.19, 0.845, 0.06], [x + 0.19, 0.862, 0.36], MAT.steel, { tint: [0.3, 0.3, 0.3] });
    xf.cyl([x, 0.4, 0.2], 'y', 0.32, 0.022, MAT.steel, { segments: 6 });
    xf.cyl([x, 0.86, 0.05], 'y', 0.26, 0.012, MAT.brass, { segments: 6 });
    xf.cyl([x, 1.0, 0.05], 'z', 0.12, 0.012, MAT.brass, { segments: 6 });
    xf.cyl([x - 0.03, 1.05, 0.03], 'x', 0.06, 0.02, MAT.brass, { segments: 6 });
    // Зеркало-плитка над раковиной.
    xf.box([x - 0.17, 1.25, 0], [x + 0.17, 1.62, 0.012], MAT.steel, { tint: [0.4, 0.45, 0.47] });
  }
  xf.collider([-w / 2, 0.4, 0], [w / 2, 0.86, 0.42]);
}

/** Кабинки: перегородки и чаши. Ширина — 0,9 м на кабинку, глубина 1,2 м. */
export function stalls(xf: Xf, n: number): void {
  const w = n * 0.9;
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + i * 0.9;
    xf.solid([x - 0.02, 0.15, 0], [x + 0.02, 1.85, 1.2], MAT.wood, { tint: [0.55, 0.62, 0.55] });
    xf.box([x - 0.03, 0, 1.14], [x + 0.03, 1.9, 1.2], MAT.steel, { tint: GREY, aoBottom: 0.6 });
  }
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.45 + i * 0.9;
    xf.cyl([x, 0, 0.38], 'y', 0.38, 0.17, MAT.enamel, { segments: 10, radiusEnd: 0.2, tint: [0.9, 0.9, 0.88], ao: 0.85 });
    xf.box([x - 0.2, 0.55, 0.02], [x + 0.2, 0.95, 0.2], MAT.enamel, { bevel: 0.02, tint: [0.9, 0.9, 0.88] });
    xf.cyl([x, 0.95, 0.1], 'y', 0.9, 0.018, MAT.steel, { segments: 6 });
    xf.collider([x - 0.2, 0, 0.02], [x + 0.2, 0.6, 0.6]);
    // Дверца приоткрыта.
    xf.box([x - 0.4, 0.15, 1.2], [x - 0.36, 1.85, 1.75], MAT.wood, { tint: [0.5, 0.58, 0.5] });
  }
}

/** Ведро. Начало — центр дна. */
export function bucket(xf: Xf): void {
  xf.cyl([0, 0, 0], 'y', 0.27, 0.11, MAT.steel, { segments: 10, radiusEnd: 0.14, tint: [0.7, 0.72, 0.7] });
  xf.cyl([0, 0.262, 0], 'y', 0.012, 0.145, MAT.steel, { segments: 10, caps: false, tint: [0.5, 0.5, 0.5] });
}

/**
 * Фильтровентиляционная установка: две колонки фильтров-поглотителей (по три барабана),
 * коллектор, стояки к потолку. Ширина 1,5 м, глубина 0,7 м. h — высота потолка.
 */
export function filterUnit(xf: Xf, h: number): void {
  xf.box([-0.75, 0, 0.05], [0.75, 0.1, 0.7], MAT.steel, { tint: [0.4, 0.4, 0.4], bevel: 0.01 });
  for (const x of [-0.38, 0.38]) {
    for (let i = 0; i < 3; i++) {
      const y = 0.1 + i * 0.5;
      xf.cyl([x, y, 0.38], 'y', 0.46, 0.27, MAT.metalGreen, { segments: 14, tint: i === 1 ? [1.05, 1.05, 1.05] : [0.92, 0.92, 0.92] });
      xf.cyl([x, y + 0.02, 0.38], 'y', 0.03, 0.285, MAT.steel, { segments: 14, caps: false, tint: GREY });
      xf.cyl([x, y + 0.41, 0.38], 'y', 0.03, 0.285, MAT.steel, { segments: 14, caps: false, tint: GREY });
      // Маркировка барабана.
      xf.box([x - 0.09, y + 0.16, 0.648], [x + 0.09, y + 0.26, 0.655], MAT.paper, { tint: [0.9, 0.9, 0.7] });
    }
    xf.cyl([x, 1.6, 0.38], 'y', h - 1.6, 0.085, MAT.steel, { segments: 10, tint: [0.7, 0.72, 0.7] });
    xf.cyl([x, 1.72, 0.38], 'y', 0.05, 0.11, MAT.steel, { segments: 10, tint: GREY });
  }
  xf.cyl([-0.38, h - 0.32, 0.38], 'x', 0.76, 0.085, MAT.steel, { segments: 10, tint: [0.7, 0.72, 0.7] });
  xf.cyl([-0.02, h - 0.32, 0.38], 'y', 0.02, 0.1, MAT.paintRed, { segments: 10 });
  xf.collider([-0.75, 0, 0.05], [0.75, 1.65, 0.7]);
}

/** Электроручной вентилятор: улитка на тумбе, мотор и рукоятка ручного привода. Ширина 0,9 м. */
export function fanUnit(xf: Xf, h: number): void {
  xf.solid([-0.4, 0, 0.08], [0.4, 0.55, 0.62], MAT.metalGreen, { bevel: 0.015, tint: [0.8, 0.8, 0.8], aoBottom: 0.6 });
  xf.cyl([-0.1, 0.9, 0.2], 'z', 0.3, 0.33, MAT.metalGreen, { segments: 16 });
  xf.cyl([-0.1, 0.9, 0.5], 'z', 0.04, 0.12, MAT.steel, { segments: 10 });
  xf.box([0.18, 0.55, 0.2], [0.4, 0.82, 0.5], MAT.steel, { bevel: 0.015, tint: [0.45, 0.45, 0.48] });
  // Рукоятка ручного привода.
  xf.cyl([-0.1, 0.9, 0.54], 'z', 0.08, 0.02, MAT.steel, { segments: 6 });
  xf.box([-0.12, 0.88, 0.6], [0.14, 0.92, 0.625], MAT.steel);
  xf.cyl([0.13, 0.9, 0.62], 'z', 0.12, 0.018, MAT.wood, { segments: 6 });
  xf.cyl([-0.1, 1.2, 0.35], 'y', h - 1.2, 0.1, MAT.steel, { segments: 10, tint: [0.7, 0.72, 0.7] });
  xf.collider([-0.45, 0.55, 0.1], [0.25, 1.25, 0.6]);
}

/** Короб воздуховода под потолком вдоль стены: от x0 до x1. Начало — точка стены на высоте низа короба. */
export function duct(xf: Xf, x0: number, x1: number): void {
  xf.box([x0, 0, 0.04], [x1, 0.3, 0.38], MAT.steel, { tint: [0.62, 0.64, 0.62], bevel: 0.008 });
  for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.9) xf.box([x - 0.02, -0.015, 0.025], [x + 0.02, 0.315, 0.395], MAT.steel, { tint: [0.45, 0.45, 0.45] });
}

/**
 * Дизель-генератор на раме: блок с головками цилиндров, маховик, генератор, радиатор,
 * выхлопная труба в потолок. Ширина 2,3 м, глубина 1,0 м.
 */
export function dieselGen(xf: Xf, h: number): void {
  xf.box([-1.15, 0, 0.12], [1.15, 0.14, 0.95], MAT.steel, { tint: [0.35, 0.35, 0.35], bevel: 0.015 });
  // Блок двигателя.
  xf.box([-0.75, 0.14, 0.3], [0.2, 0.85, 0.8], MAT.metalGreen, { bevel: 0.03, tint: [0.75, 0.8, 0.75] });
  xf.box([-0.7, 0.85, 0.36], [0.15, 1.0, 0.74], MAT.metalGreen, { bevel: 0.02, tint: [0.65, 0.7, 0.65] });
  for (let i = 0; i < 4; i++) {
    const x = -0.6 + i * 0.22;
    xf.cyl([x, 1.0, 0.55], 'y', 0.09, 0.07, MAT.steel, { segments: 8, tint: [0.5, 0.5, 0.5] });
    xf.cyl([x, 0.55, 0.8], 'z', 0.05, 0.035, MAT.brass, { segments: 6 });
  }
  // Выпускной коллектор и труба в потолок.
  xf.cyl([-0.7, 0.72, 0.27], 'x', 0.85, 0.05, MAT.rust, { segments: 8 });
  xf.cyl([-0.72, 0.72, 0.27], 'y', h - 0.72, 0.06, MAT.rust, { segments: 8 });
  // Маховик и генератор.
  xf.cyl([0.2, 0.52, 0.55], 'x', 0.1, 0.36, MAT.steel, { segments: 18, tint: [0.4, 0.4, 0.42] });
  xf.cyl([0.34, 0.52, 0.55], 'x', 0.66, 0.27, MAT.metalGreen, { segments: 14, tint: [0.6, 0.62, 0.7] });
  xf.cyl([1.0, 0.52, 0.55], 'x', 0.06, 0.2, MAT.steel, { segments: 12, tint: GREY });
  xf.box([0.5, 0.79, 0.42], [0.82, 0.95, 0.68], MAT.steel, { bevel: 0.012, tint: [0.45, 0.45, 0.5] });
  // Радиатор с решёткой.
  xf.box([-1.1, 0.14, 0.28], [-0.82, 1.05, 0.82], MAT.steel, { bevel: 0.015, tint: [0.4, 0.42, 0.4] });
  for (let y = 0.22; y < 1.0; y += 0.06) xf.box([-1.108, y, 0.32], [-1.1, y + 0.025, 0.78], MAT.rubber, { tint: DARK });
  // Топливный бачок и шланг.
  xf.cyl([-0.3, 1.25, 0.2], 'x', 0.5, 0.11, MAT.paintRed, { segments: 10 });
  xf.cyl([-0.05, 1.0, 0.25], 'y', 0.25, 0.012, MAT.rubber, { segments: 5 });
  xf.collider([-1.15, 0, 0.12], [1.15, 1.05, 0.95]);
}

/** Топливная цистерна на ложементах: цилиндр вдоль стены, указатель уровня, горловина. Ширина 1,9 м. */
export function fuelTank(xf: Xf): void {
  for (const x of [-0.6, 0.5]) xf.box([x, 0, 0.1], [x + 0.1, 0.42, 0.9], MAT.concrete, { tint: [0.75, 0.75, 0.75], aoBottom: 0.6 });
  xf.cyl([-0.9, 0.8, 0.5], 'x', 1.8, 0.42, MAT.rust, { segments: 16, tint: [0.9, 0.85, 0.8] });
  for (const x of [-0.5, 0.45]) xf.cyl([x, 0.8, 0.5], 'x', 0.05, 0.435, MAT.steel, { segments: 16, caps: false, tint: [0.45, 0.45, 0.45] });
  xf.cyl([0.1, 1.2, 0.5], 'y', 0.1, 0.07, MAT.steel, { segments: 8 });
  xf.cyl([-0.7, 0.5, 0.94], 'y', 0.6, 0.012, MAT.enamel, { segments: 5 });
  xf.collider([-0.9, 0, 0.1], [0.9, 1.22, 0.92]);
}

/** Щит управления: шкаф с приборами, лампами и рубильниками. Ширина 0,9 м. */
export function controlPanel(xf: Xf): void {
  xf.solid([-0.45, 0, 0.02], [0.45, 1.7, 0.34], MAT.metalGreen, { bevel: 0.015, tint: [0.85, 0.9, 0.95], aoBottom: 0.6 });
  xf.box([-0.4, 0.75, 0.34], [0.4, 1.62, 0.35], MAT.steel, { tint: [0.3, 0.32, 0.34] });
  for (let i = 0; i < 3; i++) {
    const x = -0.26 + i * 0.26;
    xf.cyl([x, 1.42, 0.35], 'z', 0.03, 0.085, MAT.enamel, { segments: 12 });
    xf.cyl([x, 1.42, 0.38], 'z', 0.008, 0.07, MAT.paper, { segments: 12, tint: [0.9, 0.9, 0.8] });
    xf.box([x - 0.004, 1.42, 0.388], [x + 0.004, 1.48, 0.392], MAT.rubber);
  }
  for (let i = 0; i < 5; i++) {
    const x = -0.32 + i * 0.16;
    xf.cyl([x, 1.2, 0.35], 'z', 0.025, 0.022, i % 2 === 0 ? MAT.paintRed : MAT.glow, { segments: 8 });
    xf.box([x - 0.02, 0.92, 0.35], [x + 0.02, 1.06, 0.365], MAT.rubber, { bevel: 0.006 });
    xf.box([x - 0.012, 1.0 + (i % 3 === 0 ? 0.03 : -0.03), 0.365], [x + 0.012, 1.03 + (i % 3 === 0 ? 0.03 : -0.03), 0.4], MAT.steel);
  }
  xf.box([-0.4, 0.1, 0.34], [0.4, 0.66, 0.352], MAT.metalGreen, { bevel: 0.006, tint: [0.9, 0.95, 1.0] });
  xf.box([0.3, 0.34, 0.352], [0.34, 0.42, 0.38], MAT.steel);
}

/** Электрошкаф: серый высокий, с табличкой и ручкой. Ширина 0,7 м. */
export function elCabinet(xf: Xf, open = false): void {
  xf.solid([-0.35, 0, 0.02], [0.35, 1.95, 0.42], MAT.steel, { bevel: 0.015, tint: [0.62, 0.64, 0.66], aoBottom: 0.6 });
  if (open) {
    xf.box([-0.3, 0.1, 0.415], [0.3, 1.85, 0.425], MAT.rubber, { tint: [0.2, 0.2, 0.2] });
    for (let i = 0; i < 4; i++) xf.box([-0.24, 0.4 + i * 0.36, 0.42], [0.24, 0.6 + i * 0.36, 0.44], MAT.rubber, { tint: [0.45, 0.45, 0.45], bevel: 0.006 });
    xf.box([0.345, 0.08, 0.42], [0.36, 1.87, 0.98], MAT.steel, { tint: [0.6, 0.62, 0.64] });
  } else {
    xf.box([-0.3, 0.08, 0.42], [0.3, 1.87, 0.432], MAT.steel, { bevel: 0.006, tint: [0.7, 0.72, 0.74] });
    xf.box([0.2, 0.95, 0.432], [0.24, 1.07, 0.46], MAT.rubber);
    // Знак «опасно»: жёлтая табличка с красной полосой.
    xf.box([-0.1, 1.42, 0.432], [0.1, 1.6, 0.436], MAT.brass, { tint: [1.2, 1.1, 0.5] });
    xf.box([-0.012, 1.45, 0.436], [0.012, 1.57, 0.439], MAT.paintRed);
  }
  for (let i = 0; i < 5; i++) xf.box([-0.2, 1.72 + i * 0.03, 0.432], [0.2, 1.732 + i * 0.03, 0.436], MAT.rubber, { tint: DARK });
}

/**
 * Бак для воды: большой цилиндр вдоль стены на бетонных опорах, лесенка, люк, сливная труба с вентилем.
 * Ширина 2,4 м, глубина 1,5 м.
 */
export function waterTank(xf: Xf): void {
  for (const x of [-0.8, 0.65]) xf.box([x, 0, 0.1], [x + 0.15, 0.5, 1.45], MAT.concrete, { tint: [0.72, 0.72, 0.72], aoBottom: 0.6 });
  xf.cyl([-1.2, 1.15, 0.78], 'x', 2.4, 0.68, MAT.paintBlue, { segments: 20, tint: [0.75, 0.8, 0.8] });
  for (const x of [-0.75, 0, 0.7]) xf.cyl([x, 1.15, 0.78], 'x', 0.06, 0.695, MAT.steel, { segments: 20, caps: false, tint: [0.45, 0.45, 0.45] });
  xf.cyl([0.2, 1.8, 0.78], 'y', 0.1, 0.2, MAT.steel, { segments: 12, tint: GREY });
  // Лесенка.
  for (const x of [-0.42, -0.12]) xf.box([x, 0, 1.47], [x + 0.025, 1.75, 1.495], MAT.steel, { tint: GREY });
  for (let y = 0.25; y < 1.7; y += 0.28) xf.cyl([-0.42, y, 1.482], 'x', 0.32, 0.012, MAT.steel, { segments: 5 });
  // Слив.
  xf.cyl([0.9, 0.2, 1.3], 'y', 0.3, 0.035, MAT.rust, { segments: 8 });
  xf.cyl([0.9, 0.2, 1.3], 'z', 0.3, 0.035, MAT.rust, { segments: 8 });
  xf.cyl([0.9, 0.2, 1.52], 'z', 0.03, 0.08, MAT.paintRed, { segments: 10 });
  xf.collider([-1.2, 0, 0.1], [1.2, 1.85, 1.46]);
}

/**
 * Шахта с лестницей на поверхность: скобы по стене, тёмный проём в потолке, обечайка люка.
 * h — высота потолка. Начало — точка стены у пола.
 */
export function ladderShaft(xf: Xf, h: number): void {
  for (const x of [-0.24, 0.215]) xf.box([x, 0.2, 0.1], [x + 0.025, h + 1.2, 0.125], MAT.steel, { tint: [0.55, 0.55, 0.55] });
  for (let y = 0.35; y < h + 1.1; y += 0.3) xf.cyl([-0.24, y, 0.112], 'x', 0.48, 0.014, MAT.steel, { segments: 6, tint: [0.75, 0.75, 0.75] });
  for (const y of [0.9, 2.1]) {
    xf.box([-0.24, y, 0], [-0.215, y + 0.025, 0.11], MAT.steel, { tint: GREY });
    xf.box([0.215, y, 0], [0.24, y + 0.025, 0.11], MAT.steel, { tint: GREY });
  }
  // Проём в потолке: тёмный колодец с обечайкой.
  xf.box([-0.45, h - 0.01, 0.02], [0.45, h + 1.25, 0.9], MAT.rubber, { tint: [0.12, 0.12, 0.12], skip: ['ny'] });
  xf.box([-0.5, h - 0.06, 0], [0.5, h, 0.06], MAT.steel, { tint: GREY });
  xf.box([-0.5, h - 0.06, 0.9], [0.5, h, 0.96], MAT.steel, { tint: GREY });
  xf.box([-0.5, h - 0.06, 0.06], [-0.44, h, 0.9], MAT.steel, { tint: GREY });
  xf.box([0.44, h - 0.06, 0.06], [0.5, h, 0.9], MAT.steel, { tint: GREY });
  xf.collider([-0.3, 0, 0], [0.3, 2.2, 0.16]);
}

/** Крючки с сумками противогазов на стене. Начало — центр планки, ширина — n × 0,3 м. */
export function gasMaskRow(xf: Xf, n: number): void {
  const w = n * 0.3;
  xf.box([-w / 2, 0, 0], [w / 2, 0.06, 0.02], MAT.wood, { tint: [0.7, 0.65, 0.6] });
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.15 + i * 0.3;
    xf.cyl([x, 0.03, 0.02], 'z', 0.05, 0.008, MAT.steel, { segments: 5 });
    if (i % 4 === 3) continue;
    xf.box([x - 0.012, -0.22, 0.04], [x + 0.012, 0.03, 0.05], MAT.canvas, { tint: [0.8, 0.8, 0.7] });
    xf.box([x - 0.11, -0.5, 0.02], [x + 0.11, -0.22, 0.13], MAT.canvas, { bevel: 0.025, tint: [0.85, 0.85, 0.7] });
    xf.box([x - 0.11, -0.3, 0.13], [x + 0.11, -0.22, 0.137], MAT.canvas, { tint: [0.7, 0.7, 0.6] });
  }
}

/** Огнетушитель на кронштейне. Начало — точка стены на высоте дна баллона. */
export function extinguisher(xf: Xf): void {
  xf.cyl([0, 0, 0.1], 'y', 0.42, 0.075, MAT.paintRed, { segments: 10 });
  xf.cyl([0, 0.42, 0.1], 'y', 0.06, 0.03, MAT.steel, { segments: 8 });
  xf.box([-0.015, 0.47, 0.1], [0.015, 0.5, 0.2], MAT.rubber);
  xf.box([-0.09, 0.2, 0], [0.09, 0.24, 0.1], MAT.steel, { tint: GREY });
  xf.box([-0.05, 0.12, 0.176], [0.05, 0.25, 0.18], MAT.paper, { tint: [0.9, 0.9, 0.8] });
}

/** Скамья вдоль стены длиной len. */
export function bench(xf: Xf, len: number): void {
  xf.box([-len / 2, 0.4, 0.04], [len / 2, 0.44, 0.38], MAT.wood, { bevel: 0.01, tint: [0.8, 0.75, 0.7] });
  for (const x of [-len / 2 + 0.08, len / 2 - 0.12]) xf.box([x, 0, 0.06], [x + 0.04, 0.4, 0.36], MAT.steel, { tint: DARK, aoBottom: 0.6 });
  xf.collider([-len / 2, 0, 0.04], [len / 2, 0.44, 0.38]);
}

/** Настенный телефон. Начало — центр корпуса. */
export function wallPhone(xf: Xf): void {
  xf.box([-0.1, -0.13, 0], [0.1, 0.13, 0.08], MAT.rubber, { bevel: 0.015, tint: [0.6, 0.6, 0.6] });
  xf.cyl([0, -0.03, 0.08], 'z', 0.012, 0.055, MAT.steel, { segments: 10, tint: GREY });
  xf.box([-0.13, 0.13, 0.02], [0.13, 0.17, 0.07], MAT.rubber, { bevel: 0.012 });
  xf.cyl([-0.11, -0.4, 0.04], 'y', 0.5, 0.006, MAT.rubber, { segments: 4 });
}

/** Плакат или стенд на стене: бумага в рейках, с «иллюстрациями». Начало — центр. */
export function poster(xf: Xf, w: number, h: number, seed: number): void {
  const rnd = lcg(seed);
  const tone: Vec3 = [0.9 + rnd() * 0.1, 0.85 + rnd() * 0.1, 0.7 + rnd() * 0.12];
  xf.box([-w / 2, -h / 2, 0], [w / 2, h / 2, 0.006], MAT.paper, { tint: tone });
  xf.box([-w / 2, h / 2 - 0.02, 0], [w / 2, h / 2, 0.012], MAT.wood, { tint: [0.6, 0.55, 0.5] });
  xf.box([-w / 2, -h / 2, 0], [w / 2, -h / 2 + 0.02, 0.012], MAT.wood, { tint: [0.6, 0.55, 0.5] });
  // Заголовок и блоки: красная шапка, тёмные «строки», цветные «рисунки».
  xf.box([-w / 2 + 0.04, h / 2 - 0.1, 0.006], [w / 2 - 0.04, h / 2 - 0.05, 0.008], MAT.paintRed);
  const cols = w > 0.6 ? 3 : 2;
  for (let c = 0; c < cols; c++) {
    const x0 = -w / 2 + 0.04 + (c * (w - 0.08)) / cols;
    const cw = (w - 0.08) / cols - 0.03;
    xf.box([x0, -0.02, 0.006], [x0 + cw, h / 2 - 0.14, 0.008], rnd() < 0.5 ? MAT.paintGreen : MAT.paintBlue, { tint: [1.2, 1.2, 1.2] });
    for (let y = -h / 2 + 0.05; y < -0.06; y += 0.035) xf.box([x0, y, 0.006], [x0 + cw * (0.6 + rnd() * 0.4), y + 0.012, 0.008], MAT.rubber, { tint: [0.6, 0.6, 0.6] });
  }
}

/** Завал: обрушенная плита, обломки и арматура. Занимает клетку 2,7 × 2,7 м; начало — её центр на полу. */
export function collapse(xf: Xf, h: number, seed: number): void {
  const rnd = lcg(seed);
  // Куча от стены до стены, выше к дальнему краю.
  for (let i = 0; i < 26; i++) {
    const z = -1.2 + rnd() * 1.9;
    const k = 1 - (z + 1.2) / 2.2;
    const w = 0.25 + rnd() * 0.7;
    const d = 0.25 + rnd() * 0.6;
    const hh = 0.15 + rnd() * 0.5 + k * 1.3;
    const x = (rnd() - 0.5) * (2.6 - w);
    const g = 0.5 + rnd() * 0.35;
    xf.box([x - w / 2, 0, z - d / 2], [x + w / 2, hh, z + d / 2], MAT.concrete, { bevel: 0.03, tint: [g, g, g * 0.97], aoBottom: 0.5 });
  }
  // Упавшая плита перекрытия и торчащая арматура.
  xf.box([-1.3, 1.5, -1.3], [1.3, 1.7, -0.3], MAT.concrete, { bevel: 0.03, tint: [0.6, 0.6, 0.6] });
  xf.box([-1.3, h - 0.5, -1.3], [0.2, h, -0.7], MAT.concrete, { bevel: 0.03, tint: [0.55, 0.55, 0.55] });
  for (let i = 0; i < 6; i++) {
    const x = -1.1 + rnd() * 2.2;
    xf.cyl([x, 1.0 + rnd() * 0.6, -0.5 + rnd() * 0.6], 'y', 0.5 + rnd() * 0.8, 0.008, MAT.rust, { segments: 4 });
  }
  xf.collider([-1.35, 0, -1.35], [1.35, h, 0.1]);
  xf.collider([-1.35, 0, 0.1], [1.35, 0.5, 0.75]);
}

/** Лужа: тонкое мокрое пятно на полу. Начало — центр. */
export function puddle(xf: Xf, w: number, d: number): void {
  xf.box([-w / 2, 0.002, -d / 2], [w / 2, 0.006, d / 2], MAT.wetConcrete, { tint: [0.7, 0.72, 0.75], skip: ['ny'] });
  xf.box([-w / 2 + 0.15, 0.002, -d / 2 - 0.18], [w / 2 - 0.2, 0.006, -d / 2], MAT.wetConcrete, { tint: [0.7, 0.72, 0.75], skip: ['ny'] });
}

/** Простая дверь в проёме 1,1 × 2,05 м: рама и распахнутая створка. Стена вдоль x, створка открыта к +z. */
export function plainDoor(xf: Xf, tint: Vec3 = [1, 1, 1]): void {
  const hw = 0.55;
  const t = 0.165;
  const frame = dim(tint, 0.7);
  xf.box([-hw - 0.05, 0, -t], [-hw, 2.05, t], MAT.wood, { tint: frame, aoBottom: 0.6 });
  xf.box([hw, 0, -t], [hw + 0.05, 2.05, t], MAT.wood, { tint: frame, aoBottom: 0.6 });
  xf.box([-hw - 0.05, 2.05, -t], [hw + 0.05, 2.1, t], MAT.wood, { tint: frame });
  // Створка на петлях у левого косяка, открыта чуть шире прямого угла — стоит вдоль стены.
  xf.solid([-hw - 0.045, 0.02, t], [-hw - 0.005, 2.02, t + 1.05], MAT.wood, { bevel: 0.006, tint, aoBottom: 0.7 });
  xf.box([-hw - 0.005, 0.25, t + 0.12], [-hw + 0.004, 0.95, t + 0.93], MAT.wood, { tint: dim(tint, 0.85) });
  xf.box([-hw - 0.005, 1.1, t + 0.12], [-hw + 0.004, 1.85, t + 0.93], MAT.wood, { tint: dim(tint, 0.85) });
  xf.cyl([-hw - 0.005, 1.02, t + 0.95], 'x', 0.06, 0.018, MAT.brass, { segments: 6 });
}

/** Знак «опасно, газ» на стене: жёлтый ромб с тёмной меткой. Начало — центр. */
export function warningSign(xf: Xf): void {
  xf.box([-0.16, -0.16, 0], [0.16, 0.16, 0.006], MAT.brass, { tint: [1.5, 1.35, 0.5] });
  xf.box([-0.16, -0.16, 0], [0.16, -0.13, 0.009], MAT.rubber, { tint: DARK });
  xf.box([-0.16, 0.13, 0], [0.16, 0.16, 0.009], MAT.rubber, { tint: DARK });
  xf.box([-0.02, -0.04, 0.006], [0.02, 0.1, 0.01], MAT.rubber, { tint: DARK });
  xf.box([-0.02, -0.1, 0.006], [0.02, -0.065, 0.01], MAT.rubber, { tint: DARK });
}

/**
 * Провал в полу клетки: пол кольцом вокруг дыры hole × hole, стенки шахты, чёрная вода внизу,
 * обломанные края и арматура. Начало — центр клетки на уровне пола; cell — размер клетки.
 */
export function pit(xf: Xf, cell: number, hole: number, depth: number, floorMat: number, tint: Vec3): void {
  const c = cell / 2;
  const h = hole / 2;
  // Четыре полосы пола вокруг дыры — они же опора для игрока.
  for (const [x0, z0, x1, z1] of [
    [-c, -c, c, -h],
    [-c, h, c, c],
    [-c, -h, -h, h],
    [h, -h, c, h],
  ] as const) {
    xf.solid([x0, -depth - 0.3, z0], [x1, 0, z1], floorMat, { tint, skip: ['ny'] });
  }
  // Чёрная вода на дне.
  xf.solid([-h, -depth - 0.3, -h], [h, -depth, h], MAT.wetConcrete, { tint: [0.25, 0.28, 0.3], skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  // Обломанные края плиты и торчащая арматура.
  const rnd = lcg(Math.round(xf.ox * 31 + xf.oz * 17));
  for (let i = 0; i < 14; i++) {
    const side = i % 4;
    const t = (rnd() - 0.5) * hole;
    const w = 0.12 + rnd() * 0.25;
    const d = 0.05 + rnd() * 0.16;
    const x = side === 0 ? -h : side === 1 ? h : t;
    const z = side === 2 ? -h : side === 3 ? h : t;
    const g = 0.5 + rnd() * 0.3;
    xf.box([x - (side < 2 ? d : w) / 2, -0.12 - rnd() * 0.1, z - (side < 2 ? w : d) / 2], [x + (side < 2 ? d : w) / 2, 0.012, z + (side < 2 ? w : d) / 2], MAT.concrete, { bevel: 0.012, tint: [g, g, g] });
    if (i % 2 === 0) {
      const inward = side === 0 ? 1 : side === 1 ? -1 : 0;
      const inwardZ = side === 2 ? 1 : side === 3 ? -1 : 0;
      if (inward !== 0) xf.cyl([inward > 0 ? x : x - 0.25 - rnd() * 0.2, -0.1, z], 'x', 0.25 + rnd() * 0.2, 0.007, MAT.rust, { segments: 4 });
      else xf.cyl([x, -0.1, inwardZ > 0 ? z : z - 0.25 - rnd() * 0.2], 'z', 0.25 + rnd() * 0.2, 0.007, MAT.rust, { segments: 4 });
    }
  }
}

/** Гладь воды на затопленном участке: тонкая тёмная плёнка над полом клетки. Начало — центр клетки. */
export function waterSheet(xf: Xf, cell: number): void {
  const c = cell / 2;
  xf.box([-c, 0.03, -c], [c, 0.045, c], MAT.wetConcrete, { tint: [0.42, 0.47, 0.5], skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
}
