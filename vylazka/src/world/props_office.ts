/**
 * Офисный реквизит: стерильный отдел с терминалами, перегородки, копир, кулер, потолочные панели.
 * Правила те же, что в props_home.ts: предмет описан в своих координатах (метры, y вверх), пол — y = 0,
 * спина — плоскость z = 0, предмет растёт в +z, центр по x = 0; отдельно стоящий (free) лежит по центру.
 * Настенный растёт от z = 0, y в записи реестра — высота низа; подвесной растёт вниз от y = 0.
 *
 * Картинка тёмная и мелкая, поэтому форма крупная и «игрушечная»: детали мельче 3–4 см не видны.
 * Палитра — стерильные белые, кремовые и серые тона с бирюзово-зелёным и тусклым синим акцентом,
 * техника восьмидесятых, без логотипов и надписей. Свечение — MAT.glow (экраны, огоньки) и MAT.lamp
 * (потолочная панель): оттенок вершины там множитель яркости.
 * Составные предметы (островок, переговорная, кабинка) собраны из стола, терминала и кресла через xf.child.
 */
import type { Vec3 } from '../core/types';
import type { BoxOpts } from './kit';
import { MAT } from './materials';
import type { Xf } from './props';
import { beam, rng, sheet, WHITE } from './props_more';
import type { PropSpec } from './props_more';
import { fillShelves, furnished, jitter, pickOf, s3As, s3Put, spanOf, S3_SHELVES, S3_TOP } from './furniture';

/** Мебель отдела с полки Sand3D: столы (у отдела — одной модели), кресло, шкафы для папок. */
const OFFICE_DESKS = ['s3_desk_office_grey', 's3_desk_office'] as const;
const CHAIR = 's3_chair_office';
const BINDER_SHELVES = ['s3_bookcase_office', 's3_rack_metal'] as const;

/** Высота столешницы стола office_desk с этим сидом (какую модель поставит furnished — та же жеребьёвка). */
export const officeDeskTop = (seed: number): number => S3_TOP[pickOf(OFFICE_DESKS, seed)]!;

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FRONT: Vec3 = [0, 0, 1];

/** Белый ламинат, кремовый пластик, серый металл, бирюзовая и сине-серая ткань, тёмный пластик. */
const WHT: Vec3 = [1.2, 1.2, 1.15];
const CREAM: Vec3 = [1.2, 1.15, 0.95];
const METAL: Vec3 = [0.9, 0.92, 0.95];
const METAL_DK: Vec3 = [0.6, 0.62, 0.65];
const TEAL: Vec3 = [0.4, 0.95, 0.9];
const BLUEG: Vec3 = [0.7, 0.88, 1.25];
const PLASTIC_DK: Vec3 = [1.0, 1.0, 1.0];

/** Коробка с оттенком: короче, чем xf.box с опциями. */
function bx(xf: Xf, a: Vec3, b: Vec3, mat: number, tint: Vec3 = WHITE, o: BoxOpts = {}): void {
  xf.box(a, b, mat, { ...o, tint });
}

/** Плоская заплатка на передней стороне (лицом к +z). */
function face(xf: Xf, x0: number, y0: number, x1: number, y1: number, z: number, mat: number, tint: Vec3 = WHITE): void {
  sheet(xf, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], FRONT, mat, tint);
}

/** Плоская заплатка, смотрящая вверх. */
function flat(xf: Xf, x0: number, z0: number, x1: number, z1: number, y: number, mat: number, tint: Vec3 = WHITE): void {
  sheet(xf, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], UP, mat, tint);
}

/** Грани коробки, оставляемые только спереди и сверху: для рядов мелких предметов (корешки, пластины). */
const FRONT_ONLY = ['nx', 'px', 'ny', 'nz'] as const;

// ───────────────────────────── стол, терминал, кресло ─────────────────────────────

/** Терминал 0,46 × 0,5 × 0,42: кремовый кинескопный корпус, впалый зелёно-синий экран, клавиатура. Начало — центр основания. */
function terminal(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const k = 0.85 + rnd() * 0.3;
  const scr: Vec3 = [4 * k, 7 * k, 6 * k];
  bx(xf, [-0.1, 0, -0.1], [0.1, 0.045, 0.05], MAT.enamel, CREAM);
  // Корпус, горб кинескопа позади.
  bx(xf, [-0.22, 0.04, -0.06], [0.22, 0.4, 0.08], MAT.enamel, CREAM, { bevel: 0.01 });
  bx(xf, [-0.16, 0.1, -0.25], [0.16, 0.34, -0.06], MAT.enamel, [1.1, 1.06, 0.88]);
  // Рамка экрана и сам экран в глубине.
  const f: Vec3 = [1.05, 1.0, 0.82];
  bx(xf, [-0.22, 0.04, 0.08], [-0.17, 0.4, 0.11], MAT.enamel, f);
  bx(xf, [0.17, 0.04, 0.08], [0.22, 0.4, 0.11], MAT.enamel, f);
  bx(xf, [-0.17, 0.04, 0.08], [0.17, 0.1, 0.11], MAT.enamel, f);
  bx(xf, [-0.17, 0.34, 0.08], [0.17, 0.4, 0.11], MAT.enamel, f);
  bx(xf, [-0.17, 0.1, 0.075], [0.17, 0.34, 0.083], MAT.glow, scr);
  bx(xf, [0.12, 0.055, 0.11], [0.15, 0.075, 0.115], MAT.bakelite, PLASTIC_DK);
  // Клавиатура: плита, тёмный блок клавиш, светлая длинная клавиша.
  bx(xf, [-0.22, 0, 0.13], [0.22, 0.03, 0.25], MAT.enamel, CREAM, { aoBottom: 0.6 });
  bx(xf, [-0.19, 0.03, 0.15], [0.19, 0.047, 0.23], MAT.bakelite, [1.4, 1.4, 1.4]);
  bx(xf, [-0.08, 0.047, 0.205], [0.08, 0.052, 0.225], MAT.enamel, CREAM);
}

// ───────────────────────────── перегородки и составные места ─────────────────────────────

/** Ткань перегородки: серо-синяя или бирюзовая. */
function fabricOf(rnd: () => number): Vec3 {
  return rnd() < 0.5 ? BLUEG : TEAL;
}

/**
 * Островок отдела 3,0 × 3,0 × 1,2: четыре стола полки спинка к спинке (у отдела столы одной модели), крестовая перегородка,
 * на каждом столе терминал, у каждого — офисное кресло полки.
 */
function deskIsland(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fab = fabricOf(rnd);
  const D = pickOf(OFFICE_DESKS, seed);
  for (const row of [
    { z: 0.03, rot: 0 as const },
    { z: -0.03, rot: 2 as const },
  ]) {
    for (const sx of [-1, 1]) {
      const d = xf.child(sx * 0.76, 0, row.z, row.rot);
      const k = seed + sx * 3 + row.rot;
      s3Put(d, D, { tint: jitter(k) });
      terminal(d.child(-0.2, S3_TOP[D]!, 0.33), seed + sx + row.rot * 5);
      s3As(d.child(-0.2 + (rnd() - 0.5) * 0.1, 0, 1.0, 2), CHAIR, 'free', { tint: jitter(k, 0.07, 2) });
    }
  }
  // Крестовая перегородка: ткань в металлической окантовке, поверху планка.
  bx(xf, [-1.43, 0.08, -0.03], [1.43, 1.12, 0.03], MAT.upholstery, fab);
  bx(xf, [-0.03, 0.08, -0.73], [0.03, 1.12, 0.73], MAT.upholstery, fab);
  bx(xf, [-1.43, 1.12, -0.035], [1.43, 1.15, 0.035], MAT.metalGrey, METAL);
  bx(xf, [-0.035, 1.12, -0.73], [0.035, 1.15, 0.73], MAT.metalGrey, METAL);
  bx(xf, [-1.43, 0.03, -0.035], [1.43, 0.08, 0.035], MAT.metalGrey, METAL_DK);
  bx(xf, [-0.035, 0.03, -0.73], [0.035, 0.08, 0.73], MAT.metalGrey, METAL_DK);
  xf.collider([-1.43, 0, -0.03], [1.43, 1.15, 0.03]);
  xf.collider([-0.03, 0, -0.73], [0.03, 1.15, 0.73]);
}

/** Кабинка 1,8 × 1,7 × 1,45: П-образная перегородка, открытая в +z; внутри стол полки с терминалом и офисное кресло полки. */
function cubicle(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fab = fabricOf(rnd);
  const panel = (x0: number, z0: number, x1: number, z1: number): void => {
    bx(xf, [x0, 0.04, z0], [x1, 1.42, z1], MAT.upholstery, fab);
    bx(xf, [x0 - 0.005, 1.42, z0 - 0.005], [x1 + 0.005, 1.45, z1 + 0.005], MAT.metalGrey, METAL);
    bx(xf, [x0 - 0.005, 0, z0 - 0.005], [x1 + 0.005, 0.04, z1 + 0.005], MAT.metalGrey, METAL_DK);
    xf.collider([x0, 0, z0], [x1, 1.45, z1]);
  };
  panel(-0.9, 0, 0.9, 0.06);
  panel(-0.9, 0.06, -0.84, 1.7);
  panel(0.84, 0.06, 0.9, 1.7);
  const D = pickOf(OFFICE_DESKS, seed);
  s3Put(xf.child(0, 0, 0.06), D, { tint: jitter(seed) });
  terminal(xf.child(0.2, S3_TOP[D]!, 0.38), seed + 1);
  s3As(xf.child(rnd() * 0.2 - 0.1, 0, 1.12, 2), CHAIR, 'free', { tint: jitter(seed, 0.07, 2) });
}

/** Одна панель перегородки 1,5 × 0,3 × 1,45 на двух ножках. */
function partition(xf: Xf, seed: number): void {
  const fab = fabricOf(rng(seed));
  bx(xf, [-0.74, 0.08, -0.03], [0.74, 1.42, 0.03], MAT.upholstery, fab);
  bx(xf, [-0.755, 1.42, -0.035], [0.755, 1.45, 0.035], MAT.metalGrey, METAL);
  bx(xf, [-0.755, 0.05, -0.035], [0.755, 0.08, 0.035], MAT.metalGrey, METAL_DK);
  // Кант по бокам: без него панель читалась гладкой плитой (аудит мест, 16.11).
  for (const x of [-0.755, 0.74]) bx(xf, [x, 0.08, -0.035], [x + 0.015, 1.42, 0.035], MAT.metalGrey, METAL);
  for (const x of [-0.6, 0.5]) bx(xf, [x, 0, -0.15], [x + 0.1, 0.06, 0.15], MAT.metalGrey, METAL, { aoBottom: 0.6 });
  xf.collider([-0.75, 0, -0.03], [0.75, 1.45, 0.03]);
}

// ───────────────────────────── шкафы, техника ─────────────────────────────

/** Кулер 0,34 × 0,34 × 1,35: белая колонна, голубая бутыль, два краника, поддон. */
function waterCooler(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-0.15, 0, 0.02], [0.15, 0.98, 0.32], MAT.enamel, WHT, { bevel: 0.01, aoBottom: 0.6 });
  bx(xf, [-0.16, 0, 0.01], [0.16, 0.06, 0.33], MAT.bakelite, PLASTIC_DK);
  // Углубление под стакан и поддон.
  bx(xf, [-0.1, 0.5, 0.31], [0.1, 0.72, 0.325], MAT.bakelite, [0.9, 0.9, 0.9]);
  bx(xf, [-0.11, 0.46, 0.28], [0.11, 0.5, 0.34], MAT.metalGrey, METAL);
  bx(xf, [-0.1, 0.5, 0.325], [0.1, 0.52, 0.335], MAT.metalGrey, METAL_DK);
  // Краники: синий и красный.
  bx(xf, [-0.08, 0.74, 0.32], [-0.03, 0.8, 0.34], MAT.paintBlue, [0.8, 1.0, 1.4]);
  bx(xf, [0.03, 0.74, 0.32], [0.08, 0.8, 0.34], MAT.paintRed, [1.2, 0.8, 0.8]);
  // Бутыль: голубое стекло с узким горлом.
  const lvl = 0.55 + rnd() * 0.3;
  xf.cyl([0, 0.98, 0.17], 'y', 0.28, 0.14, MAT.glass, { tint: [0.7 * lvl + 0.55, 0.9 * lvl + 0.65, 1.5], segments: 8 });
  xf.cyl([0, 1.26, 0.17], 'y', 0.08, 0.14, MAT.glass, { tint: [1.0, 1.4, 1.5], segments: 8, radiusEnd: 0.05 });
  // Светлая бумажная полоса на бутыли читается в темноте лучше стекла.
  xf.cyl([0, 1.08, 0.17], 'y', 0.08, 0.1415, MAT.enamel, { tint: [0.8, 1.05, 1.3], segments: 8 });
  xf.collider([-0.15, 0, 0.02], [0.15, 1.35, 0.32]);
}

/** Копир 1,0 × 0,65 × 1,05: кремовый корпус, крышка, лоток сбоку, пульт с огоньком, фронты кассет. */
function copier(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-0.5, 0, 0.02], [0.38, 0.85, 0.62], MAT.enamel, CREAM, { bevel: 0.01, aoBottom: 0.6 });
  bx(xf, [-0.48, 0, 0.62], [0.36, 0.06, 0.64], MAT.bakelite, PLASTIC_DK);
  // Две кассеты с бумагой спереди и тёмная щель между ними.
  for (const y of [0.1, 0.37]) {
    bx(xf, [-0.46, y, 0.62], [0.34, y + 0.25, 0.64], MAT.enamel, [1.1, 1.05, 0.88]);
    bx(xf, [-0.1, y + 0.16, 0.64], [0.1, y + 0.19, 0.66], MAT.steel, [0.6, 0.6, 0.6]);
  }
  // Крышка с поднятым краем и пульт.
  bx(xf, [-0.5, 0.85, 0.02], [0.38, 0.97, 0.46], MAT.enamel, [1.1, 1.06, 0.9], { bevel: 0.01 });
  bx(xf, [-0.45, 0.85, 0.46], [0.15, 0.92, 0.64], MAT.bakelite, [1.3, 1.3, 1.3]);
  bx(xf, [-0.38, 0.92, 0.52], [-0.14, 0.935, 0.6], MAT.glow, [3 + rnd() * 2, 7, 5]);
  for (const x of [-0.08, 0, 0.08]) bx(xf, [x, 0.92, 0.52], [x + 0.05, 0.935, 0.6], MAT.paintGreen, [0.6, 1.1, 0.9]);
  // Боковой лоток для бумаги.
  bx(xf, [0.38, 0.55, 0.06], [0.5, 0.59, 0.56], MAT.metalGrey, METAL);
  bx(xf, [0.48, 0.59, 0.06], [0.5, 0.64, 0.56], MAT.metalGrey, METAL);
  bx(xf, [0.4, 0.59, 0.2], [0.46, 0.605, 0.46], MAT.paper, [1.2, 1.15, 1.0]);
  xf.collider([-0.5, 0, 0.02], [0.5, 1.0, 0.64]);
}

// ───────────────────────────── потолок ─────────────────────────────

/** Рамка потолочной панели: четыре планки по периметру, верх на y = 0. */
function panelFrame(xf: Xf, h: number, tint: Vec3): void {
  bx(xf, [-0.6, -h, 0], [0.6, 0, 0.04], MAT.metalGrey, tint);
  bx(xf, [-0.6, -h, 0.56], [0.6, 0, 0.6], MAT.metalGrey, tint);
  bx(xf, [-0.6, -h, 0.04], [-0.56, 0, 0.56], MAT.metalGrey, tint);
  bx(xf, [0.56, -h, 0.04], [0.6, 0, 0.56], MAT.metalGrey, tint);
}

/** Светящаяся панель 1,2 × 0,6 × 0,05: рамка и лицо MAT.lamp, смотрящее вниз. */
function ceilingPanel(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  panelFrame(xf, 0.05, [0.85, 0.87, 0.9]);
  const k = 0.93 + rnd() * 0.14;
  const t: Vec3 = [150 * k, 150 * k, 140 * k];
  sheet(xf, [-0.56, -0.03, 0.04], [-0.56, -0.03, 0.56], [0.56, -0.03, 0.56], [0.56, -0.03, 0.04], DOWN, MAT.lamp, t);
  // Две тёмные перекладины делят рассеиватель на три части.
  for (const x of [-0.187, 0.187]) bx(xf, [x - 0.01, -0.04, 0.04], [x + 0.01, -0.025, 0.56], MAT.metalGrey, METAL_DK);
}

/** Мёртвая панель 1,2 × 0,6 × 0,35: тёмное лицо без свечения и короткий свисающий кабель. */
function ceilingPanelDead(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  panelFrame(xf, 0.05, [0.7, 0.72, 0.75]);
  sheet(xf, [-0.56, -0.03, 0.04], [-0.56, -0.03, 0.56], [0.56, -0.03, 0.56], [0.56, -0.03, 0.04], DOWN, MAT.plaster, [0.45, 0.45, 0.45]);
  for (const x of [-0.187, 0.187]) bx(xf, [x - 0.01, -0.04, 0.04], [x + 0.01, -0.025, 0.56], MAT.metalGrey, [0.5, 0.5, 0.5]);
  const x0 = (rnd() - 0.5) * 0.7;
  const c: Vec3 = [0.9, 0.9, 0.9];
  beam(xf, [x0, -0.04, 0.3], [x0 + 0.03, -0.14, 0.32], 0.025, 0.025, MAT.bakelite, c);
  beam(xf, [x0 + 0.03, -0.14, 0.32], [x0 + 0.02, -0.25, 0.35], 0.025, 0.025, MAT.bakelite, c);
  beam(xf, [x0 + 0.02, -0.25, 0.35], [x0 - 0.01, -0.31, 0.37], 0.025, 0.025, MAT.bakelite, c);
  bx(xf, [x0 - 0.04, -0.35, 0.34], [x0 + 0.02, -0.3, 0.4], MAT.bakelite, [1.3, 1.3, 1.3]);
}

/** Обесточенная панель 1,2 × 0,6 × 0,05: та же панель, но рассеиватель не светится — серый пластик. */
function ceilingPanelOff(xf: Xf, _seed: number): void {
  panelFrame(xf, 0.05, [0.78, 0.8, 0.83]);
  sheet(xf, [-0.56, -0.03, 0.04], [-0.56, -0.03, 0.56], [0.56, -0.03, 0.56], [0.56, -0.03, 0.04], DOWN, MAT.plaster, [0.62, 0.63, 0.62]);
  for (const x of [-0.187, 0.187]) bx(xf, [x - 0.01, -0.04, 0.04], [x + 0.01, -0.025, 0.56], MAT.metalGrey, METAL_DK);
}

/** Вентиляционный диффузор 0,6 × 0,6 × 0,05: рамка и три вложенных квадратных жалюзи. */
function ceilingVent(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const t: Vec3 = [0.88 + rnd() * 0.1, 0.9, 0.92];
  // Рамка.
  bx(xf, [-0.3, -0.04, 0], [0.3, 0, 0.04], MAT.metalGrey, t);
  bx(xf, [-0.3, -0.04, 0.56], [0.3, 0, 0.6], MAT.metalGrey, t);
  bx(xf, [-0.3, -0.04, 0.04], [-0.26, 0, 0.56], MAT.metalGrey, t);
  bx(xf, [0.26, -0.04, 0.04], [0.3, 0, 0.56], MAT.metalGrey, t);
  // Тёмная глубина и три квадрата жалюзи разной глубины.
  sheet(xf, [-0.26, -0.01, 0.04], [-0.26, -0.01, 0.56], [0.26, -0.01, 0.56], [0.26, -0.01, 0.04], DOWN, MAT.bakelite, [0.4, 0.4, 0.4]);
  const sq: [number, number][] = [
    [0.22, 0.03],
    [0.15, 0.04],
    [0.08, 0.05],
  ];
  for (const [r, depth] of sq) {
    const o = 0.025;
    bx(xf, [-r, -depth, 0.3 - r], [r, -0.005, 0.3 - r + o], MAT.metalGrey, [0.95, 0.97, 1.0]);
    bx(xf, [-r, -depth, 0.3 + r - o], [r, -0.005, 0.3 + r], MAT.metalGrey, [0.95, 0.97, 1.0]);
    bx(xf, [-r, -depth, 0.3 - r + o], [-r + o, -0.005, 0.3 + r - o], MAT.metalGrey, [0.95, 0.97, 1.0]);
    bx(xf, [r - o, -depth, 0.3 - r + o], [r, -0.005, 0.3 + r - o], MAT.metalGrey, [0.95, 0.97, 1.0]);
  }
}

// ───────────────────────────── стена ─────────────────────────────

/** Белая доска 1,8 × 0,06 × 1,0: алюминиевая рамка, лоток с маркером, несколько тонких чёрточек. */
function whiteboard(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-0.9, 0, 0], [0.9, 0.05, 0.06], MAT.metalGrey, METAL);
  bx(xf, [-0.9, 0.97, 0], [0.9, 1.0, 0.05], MAT.metalGrey, METAL);
  bx(xf, [-0.9, 0.05, 0], [-0.87, 0.97, 0.05], MAT.metalGrey, METAL);
  bx(xf, [0.87, 0.05, 0], [0.9, 0.97, 0.05], MAT.metalGrey, METAL);
  bx(xf, [-0.87, 0.05, 0], [0.87, 0.97, 0.04], MAT.enamel, [1.25, 1.25, 1.2]);
  const m = 0.55 + rnd() * 0.4;
  bx(xf, [-0.5 + m * 0.3, 0.05, 0.02], [-0.4 + m * 0.3, 0.075, 0.05], MAT.paintBlue, [0.7, 0.9, 1.3]);
  // Штрихи: рамки, стрелки и каракули без текста.
  const st: Vec3 = [0.35, 0.37, 0.4];
  const line = (a: [number, number], b: [number, number]): void => beam(xf, [a[0], a[1], 0.045], [b[0], b[1], 0.045], 0.004, 0.014, MAT.bakelite, st);
  const dx = (rnd() - 0.5) * 0.3;
  line([-0.6 + dx, 0.75], [-0.1 + dx, 0.76]);
  line([-0.1 + dx, 0.76], [-0.09 + dx, 0.5]);
  line([-0.09 + dx, 0.5], [-0.6 + dx, 0.49]);
  line([-0.6 + dx, 0.49], [-0.61 + dx, 0.75]);
  line([-0.05 + dx, 0.63], [0.35 + dx, 0.635]);
  line([0.35 + dx, 0.635], [0.3 + dx, 0.68]);
  line([0.35 + dx, 0.635], [0.3 + dx, 0.59]);
  line([0.4, 0.8], [0.75, 0.82]);
  line([0.4, 0.3], [0.7, 0.33]);
  line([-0.7, 0.25], [-0.2, 0.22]);
}

/** Круглые настенные часы 0,34 × 0,06 × 0,34: чёрный обод, белый циферблат, две стрелки; время по сиду. */
function officeClock(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cy = 0.17;
  xf.cyl([0, cy, 0], 'z', 0.05, 0.17, MAT.bakelite, { tint: PLASTIC_DK, segments: 16 });
  xf.cyl([0, cy, 0.05], 'z', 0.006, 0.145, MAT.enamel, { tint: [1.25, 1.25, 1.2], segments: 16 });
  // Метки на 12, 3, 6, 9 часов.
  for (const [x, y, w, h] of [
    [0, cy + 0.12, 0.014, 0.03],
    [0, cy - 0.12, 0.014, 0.03],
    [0.12, cy, 0.03, 0.014],
    [-0.12, cy, 0.03, 0.014],
  ] as const) {
    bx(xf, [x - w / 2, y - h / 2, 0.055], [x + w / 2, y + h / 2, 0.06], MAT.bakelite, [0.7, 0.7, 0.7]);
  }
  const ah = rnd() * Math.PI * 2;
  const am = rnd() * Math.PI * 2;
  const hand = (a: number, len: number, w: number, z: number): void =>
    beam(xf, [0, cy, z], [Math.sin(a) * len, cy + Math.cos(a) * len, z], 0.005, w, MAT.bakelite, [0.6, 0.6, 0.6], { side: FRONT });
  hand(ah, 0.085, 0.022, 0.0575);
  hand(am, 0.125, 0.014, 0.0585);
  xf.cyl([0, cy, 0.056], 'z', 0.005, 0.014, MAT.bakelite, { tint: [0.6, 0.6, 0.6], segments: 6 });
}

// ───────────────────────────── стойки, автоматы, мебель ─────────────────────────────

/** Автомат с напитками 0,95 × 0,8 × 1,83: тёмный корпус, подсвеченная витрина с рядами товара, панель с монетоприёмником, лоток. */
function vendingMachine(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-0.475, 0, 0], [0.475, 1.83, 0.78], MAT.bakelite, [1.35, 1.4, 1.5], { bevel: 0.01, aoBottom: 0.6 });
  // Подсвеченная витрина: засветка, рамка, полки и товар.
  bx(xf, [-0.42, 0.6, 0.78], [0.14, 1.7, 0.79], MAT.glow, [5, 6, 7]);
  bx(xf, [-0.44, 0.58, 0.78], [-0.42, 1.72, 0.805], MAT.metalGrey, METAL);
  bx(xf, [0.14, 0.58, 0.78], [0.16, 1.72, 0.805], MAT.metalGrey, METAL);
  bx(xf, [-0.44, 1.7, 0.78], [0.16, 1.72, 0.805], MAT.metalGrey, METAL);
  bx(xf, [-0.44, 0.58, 0.78], [0.16, 0.6, 0.805], MAT.metalGrey, METAL);
  const prod: [number, Vec3][] = [
    [MAT.paintRed, [1.3, 0.7, 0.6]],
    [MAT.paintBlue, [0.7, 0.95, 1.4]],
    [MAT.paintGreen, [0.6, 1.2, 0.9]],
    [MAT.paintOchre, [1.4, 1.2, 0.5]],
  ];
  for (let r = 0; r < 4; r++) {
    const y = 0.64 + r * 0.265;
    bx(xf, [-0.42, y, 0.78], [0.14, y + 0.025, 0.8], MAT.metalGrey, METAL_DK);
    for (let c = 0; c < 4; c++) {
      if (rnd() < 0.15) continue;
      const [mat, tint] = prod[(r + c + Math.floor(rnd() * 2)) % 4]!;
      const x = -0.4 + c * 0.13;
      bx(xf, [x, y + 0.025, 0.78], [x + 0.09, y + 0.15 + rnd() * 0.06, 0.8], mat, tint);
    }
  }
  // Заголовок витрины: светящаяся полоса.
  bx(xf, [-0.42, 1.74, 0.78], [0.44, 1.8, 0.795], MAT.glow, [5, 6, 7]);
  // Правая панель: монетоприёмник, кнопки, светящийся индикатор.
  bx(xf, [0.2, 0.6, 0.78], [0.44, 1.7, 0.795], MAT.metalGrey, METAL_DK);
  bx(xf, [0.24, 1.52, 0.795], [0.4, 1.64, 0.805], MAT.glow, [4, 7, 6]);
  for (let i = 0; i < 6; i++) bx(xf, [0.24 + (i % 2) * 0.09, 1.08 + Math.floor(i / 2) * 0.1, 0.795], [0.31 + (i % 2) * 0.09, 1.15 + Math.floor(i / 2) * 0.1, 0.81], MAT.steel, [0.85, 0.85, 0.85]);
  bx(xf, [0.26, 0.82, 0.795], [0.38, 0.96, 0.805], MAT.steel, [0.7, 0.7, 0.7]);
  bx(xf, [0.31, 0.86, 0.805], [0.33, 0.93, 0.81], MAT.bakelite, [0.6, 0.6, 0.6]);
  // Откидная створка выдачи.
  bx(xf, [-0.42, 0.1, 0.78], [0.14, 0.45, 0.8], MAT.bakelite, [0.7, 0.75, 0.8]);
  bx(xf, [-0.3, 0.38, 0.8], [0.02, 0.41, 0.81], MAT.steel, [0.7, 0.7, 0.7]);
  xf.collider([-0.475, 0, 0], [0.475, 1.83, 0.8]);
}

/** Урна 0,28 × 0,28 × 0,32: тёмное слегка коническое ведро с ободком. */
function trashBin(xf: Xf, seed: number): void {
  const k = 0.85 + rng(seed)() * 0.3;
  xf.cyl([0, 0, 0], 'y', 0.3, 0.1, MAT.bakelite, { tint: [k, k, k], segments: 10, radiusEnd: 0.13 });
  xf.cyl([0, 0.3, 0], 'y', 0.02, 0.14, MAT.metalGrey, { tint: METAL_DK, segments: 10 });
}

/** Стойка ресепшена 2,2 × 0,8 × 1,1: высокая белая лицевая стенка с бирюзовой полосой, ниже рабочая столешница с терминалом. */
function receptionDesk(xf: Xf, seed: number): void {
  // Высокая лицевая стенка и широкая верхняя плита.
  bx(xf, [-1.07, 0, 0.45], [1.07, 1.06, 0.78], MAT.enamel, WHT, { aoBottom: 0.6 });
  bx(xf, [-1.1, 1.06, 0.42], [1.1, 1.1, 0.8], MAT.enamel, [1.3, 1.3, 1.25], { bevel: 0.01 });
  bx(xf, [-1.07, 0.3, 0.78], [1.07, 0.62, 0.8], MAT.paintGreen, [0.4, 1.1, 1.0]);
  bx(xf, [-1.07, 0, 0.78], [1.07, 0.06, 0.8], MAT.bakelite, PLASTIC_DK);
  // Низкая рабочая столешница сзади на двух тумбах.
  bx(xf, [-1.05, 0.68, 0.02], [1.05, 0.72, 0.45], MAT.enamel, WHT, { bevel: 0.008 });
  for (const x of [-1.05, 0.67]) bx(xf, [x, 0, 0.04], [x + 0.38, 0.68, 0.43], MAT.metalGrey, METAL_DK, { aoBottom: 0.6 });
  bx(xf, [-0.67, 0.4, 0.04], [0.67, 0.66, 0.06], MAT.metalGrey, METAL_DK);
  // Терминал экраном к рабочему месту (к −z).
  terminal(xf.child(-0.4, 0.72, 0.22, 2), seed);
  bx(xf, [0.2, 0.72, 0.12], [0.34, 0.86, 0.3], MAT.bakelite, [1.3, 1.3, 1.3]);
  xf.collider([-1.1, 0, 0.42], [1.1, 1.1, 0.8]);
  xf.collider([-1.05, 0, 0.02], [1.05, 0.72, 0.42]);
}

/** Переговорная: стол полки для переговоров, на нём листы; шесть офисных кресел полки по длинным сторонам. */
function meetingTable(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const T = 's3_table_meeting';
  s3Put(xf, T, { tint: jitter(seed) });
  const top = S3_TOP[T]!;
  bx(xf, [-0.5, top, -0.14], [0.2, top + 0.005, 0.12], MAT.paper, [1.2, 1.15, 1.0], { skip: ['ny'] });
  for (const side of [-1, 1]) {
    for (const x of [-0.78, 0, 0.78]) {
      const jit = (rnd() - 0.5) * 0.1;
      s3As(xf.child(x + (rnd() - 0.5) * 0.04, 0, side * (0.7 + jit), side > 0 ? 2 : 0), CHAIR, 'free', { tint: jitter(seed + side * 7 + Math.round(x * 10), 0.07, 2) });
    }
  }
}

/** Серверная стойка 0,6 × 0,9 × 2,0: чёрный шкаф, дверь из тонких горизонтальных планок, ряды огоньков (зелёные и янтарные). */
function serverRack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Корпус на 3 мм уже и ниже рамы: крышка, цоколь и стойки той же ширины легли бы с ним в одну плоскость и рябили.
  bx(xf, [-0.297, 0, 0], [0.297, 1.997, 0.86], MAT.bakelite, [0.9, 0.95, 1.0], { aoBottom: 0.6 });
  bx(xf, [-0.3, 1.95, 0], [0.3, 2.0, 0.89], MAT.metalGrey, METAL_DK);
  bx(xf, [-0.3, 0, 0.05], [0.3, 0.07, 0.89], MAT.metalGrey, METAL_DK);
  for (const x of [-0.3, 0.26]) bx(xf, [x, 0.07, 0.8], [x + 0.04, 1.95, 0.89], MAT.metalGrey, METAL_DK);
  // Планки двери.
  for (let y = 0.12; y < 1.9; y += 0.07) bx(xf, [-0.26, y, 0.86], [0.26, y + 0.04, 0.89], MAT.metalGrey, [0.7, 0.72, 0.75], { skip: FRONT_ONLY });
  // Огоньки: левая колонка и несколько справа; по сиду часть не горит.
  for (let i = 0; i < 20; i++) {
    const y = 0.15 + i * 0.087;
    for (let j = 0; j < 3; j++) {
      if (rnd() < 0.3) continue;
      const amber = rnd() < 0.3;
      const x = -0.2 + j * 0.06 + (i % 4 === 0 ? 0.24 : 0);
      bx(xf, [x, y, 0.88], [x + 0.025, y + 0.025, 0.9], MAT.glow, amber ? [12, 7, 1] : [2, 10, 3]);
    }
  }
  xf.collider([-0.3, 0, 0], [0.3, 2.0, 0.89]);
}

/** Двери лифта 1,5 × 0,14 × 2,35: рамка, две стальные створки, кнопка вызова с огоньком, полоса индикатора над дверью. */
function elevatorDoors(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const frame: Vec3 = [0.75, 0.78, 0.8];
  bx(xf, [-0.75, 0, 0], [-0.59, 2.35, 0.12], MAT.metalGrey, frame);
  bx(xf, [0.59, 0, 0], [0.75, 2.35, 0.12], MAT.metalGrey, frame);
  bx(xf, [-0.59, 2.2, 0], [0.59, 2.35, 0.12], MAT.metalGrey, frame);
  // Створки: щель посередине, пара горизонтальных канавок.
  bx(xf, [-0.59, 0, 0.03], [-0.008, 2.2, 0.08], MAT.steel, [1.05, 1.07, 1.1]);
  bx(xf, [0.008, 0, 0.03], [0.59, 2.2, 0.08], MAT.steel, [1.0, 1.03, 1.07]);
  bx(xf, [-0.008, 0, 0.0], [0.008, 2.2, 0.06], MAT.bakelite, [0.5, 0.5, 0.5]);
  for (const y of [0.9, 1.5]) face(xf, -0.58, y, 0.58, y + 0.025, 0.081, MAT.bakelite, [0.7, 0.7, 0.72]);
  // Кнопка вызова на правой стойке.
  bx(xf, [0.61, 0.95, 0.12], [0.73, 1.25, 0.135], MAT.steel, [0.7, 0.72, 0.75]);
  bx(xf, [0.65, 1.1, 0.135], [0.69, 1.15, 0.14], MAT.glow, rnd() < 0.5 ? [10, 6, 2] : [3, 9, 5]);
  // Индикатор этажа над дверью.
  bx(xf, [-0.3, 2.23, 0.12], [0.3, 2.31, 0.135], MAT.bakelite, [0.8, 0.8, 0.8]);
  bx(xf, [-0.26, 2.25, 0.135], [0.26, 2.29, 0.14], MAT.glow, [3, 8, 5]);
}

/** Кухонный уголок 1,8 × 0,62 × 2,05: тумба с раковиной, микроволновка, кофемашина, верхний шкаф. */
function kitchenette(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Тумба с фасадами и столешница.
  bx(xf, [-0.9, 0.05, 0.02], [0.9, 0.9, 0.58], MAT.enamel, WHT, { aoBottom: 0.6 });
  bx(xf, [-0.9, 0, 0.06], [0.9, 0.05, 0.56], MAT.bakelite, PLASTIC_DK);
  bx(xf, [-0.9, 0.9, 0.02], [0.9, 0.93, 0.62], MAT.metalGrey, [0.95, 0.97, 1.0], { bevel: 0.006 });
  for (const x of [-0.9, -0.3, 0.3]) {
    bx(xf, [x + 0.02, 0.08, 0.58], [x + 0.58, 0.86, 0.6], MAT.enamel, [1.15, 1.15, 1.1]);
    bx(xf, [x + 0.3, 0.7, 0.6], [x + 0.34, 0.8, 0.625], MAT.steel, [0.6, 0.6, 0.6]);
  }
  // Раковина: рамка, тёмная чаша, кран с изливом.
  bx(xf, [-0.72, 0.93, 0.12], [-0.12, 0.945, 0.5], MAT.steel, [1.0, 1.0, 1.0]);
  flat(xf, -0.66, 0.18, -0.18, 0.44, 0.946, MAT.bakelite, [0.35, 0.37, 0.4]);
  xf.cyl([-0.42, 0.945, 0.1], 'y', 0.2, 0.018, MAT.steel, { tint: [1.1, 1.1, 1.1], segments: 6 });
  beam(xf, [-0.42, 1.14, 0.1], [-0.42, 1.14, 0.26], 0.035, 0.035, MAT.steel, [1.1, 1.1, 1.1], { side: UP });
  // Микроволновка: кремовый ящик с тёмным окном и панелью.
  bx(xf, [0.05, 0.93, 0.1], [0.55, 1.2, 0.5], MAT.enamel, CREAM, { bevel: 0.008 });
  bx(xf, [0.09, 0.98, 0.5], [0.38, 1.15, 0.51], MAT.glass, [0.5, 0.55, 0.55]);
  bx(xf, [0.42, 0.98, 0.5], [0.52, 1.15, 0.51], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [0.44, 1.1, 0.51], [0.5, 1.13, 0.515], MAT.glow, [3 + rnd() * 3, 8, 5]);
  // Кофемашина: тёмный корпус, носик, стеклянный кофейник.
  bx(xf, [0.64, 0.93, 0.14], [0.86, 1.32, 0.48], MAT.bakelite, [1.4, 1.4, 1.4], { bevel: 0.008 });
  bx(xf, [0.66, 0.93, 0.34], [0.84, 1.0, 0.5], MAT.metalGrey, METAL_DK);
  xf.cyl([0.75, 0.95, 0.42], 'y', 0.13, 0.055, MAT.glass, { tint: [0.9, 0.75, 0.5], segments: 8 });
  bx(xf, [0.8, 1.22, 0.48], [0.83, 1.25, 0.49], MAT.glow, [11, 5, 1]);
  // Плитка над столешницей и верхний шкаф.
  face(xf, -0.9, 0.93, 0.9, 1.45, 0.03, MAT.tile, [1.2, 1.2, 1.15]);
  bx(xf, [-0.9, 1.45, 0.02], [-0.05, 2.05, 0.34], MAT.enamel, [1.15, 1.15, 1.1], { bevel: 0.008 });
  face(xf, -0.476, 1.48, -0.474, 2.02, 0.342, MAT.bakelite, [0.6, 0.6, 0.6]);
  for (const x of [-0.5, -0.45]) bx(xf, [x - 0.01, 1.5, 0.34], [x + 0.01, 1.62, 0.36], MAT.steel, [0.6, 0.6, 0.6]);
  xf.collider([-0.9, 0, 0.02], [0.9, 0.93, 0.62]);
}

/** Знак «мокрый пол» 0,32 × 0,4 × 0,62: жёлтая раскладная стремянка из двух наклонных щитов, без надписей. */
function wetFloorSign(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const yel: Vec3 = [1.4 + rnd() * 0.1, 1.2, 0.45];
  for (const s of [-1, 1]) {
    beam(xf, [0, 0.01, s * 0.19], [0, 0.6, s * 0.015], 0.3, 0.015, MAT.paintOchre, yel, { side: [1, 0, 0] });
    // Две тёмные полосы на щите.
    for (const t of [0.22, 0.3]) {
      const y = 0.01 + t * 0.59 * 1.0;
      const z = s * (0.19 - t * 0.175);
      beam(xf, [0, y, z], [0, y + 0.04, z - s * 0.007], 0.28, 0.019, MAT.bakelite, [0.7, 0.7, 0.7], { side: [1, 0, 0] });
    }
  }
  bx(xf, [-0.15, 0.58, -0.03], [0.15, 0.62, 0.03], MAT.paintOchre, [1.2, 1.05, 0.4]);
}

/** Телефон 0,22 × 0,2 × 0,1: кремовое основание, трубка поперёк, кнопки. */
function deskPhone(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const c: Vec3 = rnd() < 0.5 ? CREAM : [1.0, 1.05, 1.1];
  bx(xf, [-0.11, 0, -0.1], [0.11, 0.045, 0.1], MAT.enamel, c, { bevel: 0.008, aoBottom: 0.6 });
  // Трубка лежит поперёк: перемычка и два раструба.
  bx(xf, [-0.1, 0.07, -0.07], [0.1, 0.095, -0.02], MAT.enamel, [c[0] * 0.95, c[1] * 0.95, c[2] * 0.95], { bevel: 0.006 });
  bx(xf, [-0.1, 0.045, -0.075], [-0.06, 0.1, -0.015], MAT.enamel, c);
  bx(xf, [0.06, 0.045, -0.075], [0.1, 0.1, -0.015], MAT.enamel, c);
  // Клавиши 3 × 3.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) bx(xf, [-0.05 + i * 0.037, 0.045, 0.0 + j * 0.032], [-0.03 + i * 0.037, 0.055, 0.02 + j * 0.032], MAT.bakelite, [1.4, 1.4, 1.4]);
}

/** Стопка бумаг и папка 0,32 × 0,24 × 0,14: высота и смещение по сиду. */
function paperStack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const h = 0.05 + rnd() * 0.05;
  const ox = (rnd() - 0.5) * 0.04;
  const oz = (rnd() - 0.5) * 0.03;
  const pp: Vec3 = [1.15, 1.12, 1.0];
  bx(xf, [-0.15 + ox, 0, -0.1 + oz], [0.07 + ox, h * 0.6, 0.1 + oz], MAT.paper, pp);
  bx(xf, [-0.14 + ox + 0.015, h * 0.6, -0.09 + oz - 0.01], [0.06 + ox + 0.02, h, 0.09 + oz], MAT.paper, [pp[0] * 0.95, pp[1] * 0.95, pp[2] * 0.95]);
  // Папка-скоросшиватель рядом: цветная обложка и светлый корешок.
  const bh = 0.04 + rnd() * 0.03;
  const col: Vec3 = rnd() < 0.5 ? [0.5, 0.75, 1.2] : [0.45, 1.0, 0.9];
  bx(xf, [0.09, 0, -0.11], [0.16, bh, 0.11], MAT.paintBlue, col, { bevel: 0.006 });
  bx(xf, [0.09, bh, -0.11], [0.15, bh + 0.004, 0.1], MAT.paper, pp);
}

/**
 * Шкаф для бумаг или металлический стеллаж полки (по сиду): полки заставлены папками-корешками с пропусками, где пролёт
 * низкий — архивными коробками торцом вперёд.
 */
function binderShelf(xf: Xf, seed: number): void {
  const m = pickOf(BINDER_SHELVES, seed);
  s3Put(xf, m, { tint: jitter(seed) });
  fillShelves(xf, S3_SHELVES[m]!, 'binders', seed, { back: m === 's3_bookcase_office' });
}

// ───────────────────────────── то, что проросло ─────────────────────────────

/** Высота потолка офиса, м: берёза растёт от пола до него — и, судя по дыре, дальше. */
export const BIRCH_H = 2.7;
/** Берёста и её отметины; ветки. */
const BARK: Vec3 = [1.32, 1.32, 1.29];
const BARK_DK: Vec3 = [0.17, 0.16, 0.15];
const TWIG: Vec3 = [0.3, 0.24, 0.19];
/**
 * Берёза 0,56 × 0,56 × 2,7: ствол от пола до потолка — белая берёста в чёрных чёрточках, тёмный
 * комель, два-три сучка. Она не стоит в комнате, а проросла сквозь неё: пол и потолок ей не помеха.
 * Предмет — только ствол. Дыру в потолке и голые ветки из неё кладёт помещение (ceilingBreak): они
 * остаются, когда ствол рассыпался от касания. Листьев нет (слова партнёра: «Берёзы знак последних
 * дней, листья не нужны»).
 *
 * Ствол — не цилиндр из kit: у каждой грани свой тон, иначе на берёсте не нарисовать отметин.
 * (У луга своя берёза — целое дерево с кроной, world/pocket_meadow.ts; эта — столб сквозь этаж.)
 */
function birch(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const S = 8;
  const k = 0.88 + rnd() * 0.28;
  const r0 = 0.15 * k;
  const r1 = 0.105 * k;
  const ph1 = rnd() * 6.28;
  const ph2 = rnd() * 6.28;
  const bend = 0.015 + rnd() * 0.03;
  // Ось ствола чуть гуляет: у пола — ровно в начале координат, выше — на несколько сантиметров в сторону.
  const axis = (y: number): [number, number] => {
    const g = Math.min(1, y / 0.8);
    return [Math.sin(y * 1.15 + ph1) * bend * g, Math.sin(y * 0.85 + ph2) * bend * g];
  };
  const radius = (y: number): number => (r0 + (r1 - r0) * (y / BIRCH_H)) * (y < 0.45 ? 1 + 0.5 * (1 - y / 0.45) ** 2 : 1);
  const at = (i: number, y: number): Vec3 => {
    const a = (i / S) * Math.PI * 2;
    const [ax, az] = axis(y);
    const r = radius(y);
    return [ax + Math.sin(a) * r, y, az + Math.cos(a) * r];
  };

  // Пояса: высокие белые чередуются с тонкими — в них отметины. Первые три — комель.
  const ys: number[] = [0, 0.1, 0.24, 0.45];
  const marks = new Map<number, { from: number; len: number; knot: boolean }>();
  for (let y = 0.45; ; ) {
    y += 0.11 + rnd() * 0.17;
    const knot = rnd() < 0.24;
    const hgt = knot ? 0.07 + rnd() * 0.04 : 0.022 + rnd() * 0.02;
    if (y + hgt > BIRCH_H - 0.14) break;
    ys.push(y);
    marks.set(ys.length - 1, { from: Math.floor(rnd() * S), len: knot ? 2 : 1 + Math.floor(rnd() * 4), knot });
    y += hgt;
    ys.push(y);
  }
  ys.push(BIRCH_H);

  const p = (q: Vec3): Vec3 => xf.pt(q[0], q[1], q[2]);
  for (let b = 0; b + 1 < ys.length; b++) {
    const y0 = ys[b]!;
    const y1 = ys[b + 1]!;
    const mark = marks.get(b);
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      let tint: Vec3;
      if (b < 3) {
        // Комель: старая чёрная кора, местами проглядывает белое.
        const v = rnd();
        tint = v < 0.72 ? [0.26 + v * 0.2, 0.25 + v * 0.19, 0.24 + v * 0.18] : [BARK[0] * 0.8, BARK[1] * 0.8, BARK[2] * 0.8];
      } else if (mark && (i - mark.from + S) % S < mark.len) {
        const v = 0.9 + rnd() * 0.5;
        tint = [BARK_DK[0] * v, BARK_DK[1] * v, BARK_DK[2] * v];
      } else {
        const v = rnd() < 0.1 ? 0.74 : 0.9 + rnd() * 0.1;
        tint = [BARK[0] * v, BARK[1] * v, BARK[2] * v];
      }
      const n0 = xf.dir(Math.sin((i / S) * Math.PI * 2), 0, Math.cos((i / S) * Math.PI * 2));
      const n1 = xf.dir(Math.sin((j / S) * Math.PI * 2), 0, Math.cos((j / S) * Math.PI * 2));
      // У самого пола — контактная тень.
      const aoLo = b === 0 ? 0.55 : 1;
      const v00 = xf.mb.vertex(p(at(i, y0)), n0, MAT.paper, tint, aoLo);
      const v10 = xf.mb.vertex(p(at(j, y0)), n1, MAT.paper, tint, aoLo);
      const v11 = xf.mb.vertex(p(at(j, y1)), n1, MAT.paper, tint, 1);
      const v01 = xf.mb.vertex(p(at(i, y1)), n0, MAT.paper, tint, 1);
      xf.mb.tri(v00, v10, v11);
      xf.mb.tri(v00, v11, v01);
    }
  }

  // Сучки: короткий тёмный обломок над отметиной-«бровью».
  let knots = 0;
  for (const [b, m] of marks) {
    if (!m.knot || knots >= 3) continue;
    knots += 1;
    const y = ys[b + 1]!;
    const a = ((m.from + m.len / 2) / S) * Math.PI * 2;
    const [ax, az] = axis(y);
    const r = radius(y);
    const out = 0.035 + rnd() * 0.035;
    beam(xf, [ax + Math.sin(a) * (r - 0.02), y - 0.01, az + Math.cos(a) * (r - 0.02)], [ax + Math.sin(a) * (r + out), y + 0.03 + rnd() * 0.03, az + Math.cos(a) * (r + out)], 0.032, 0.032, MAT.paper, BARK_DK);
  }
  xf.collider([-0.16, 0, -0.16], [0.16, BIRCH_H, 0.16]);
}

/**
 * Выбитая плита над стволом: тёмный квадрат в потолке на высоте h, в его раме — остатки плиты, из
 * дыры свисают тонкие голые ветки; на полу — обломок плиты и разошедшийся ковролин
 * у комля. Тоже не предмет: когда ствола нет, дыра остаётся и ветки висят из неё.
 */
export function ceilingBreak(xf: Xf, h: number, seed: number): void {
  const rnd = rng(seed ^ 0xb7ea);
  const s = 0.3;
  const y = h - 0.006;
  sheet(xf, [-s, y, -s], [-s, y, s], [s, y, s], [s, y, -s], DOWN, MAT.rubber, [0.11, 0.11, 0.12]);
  // Остатки плиты по краям рамы: с двух сторон, разной ширины.
  const tile: Vec3 = [0.95, 0.95, 0.92];
  const w1 = 0.06 + rnd() * 0.1;
  const w2 = 0.05 + rnd() * 0.09;
  bx(xf, [-s, y - 0.012, -s], [-s + w1, y, s * (rnd() * 0.8)], MAT.ceilTile, tile);
  bx(xf, [-s * (rnd() * 0.6), y - 0.012, s - w2], [s, y, s], MAT.ceilTile, tile);

  // Ветки из дыры: выходят у самого ствола, отходят в сторону и повисают. Голые (слова партнёра:
  // «Берёзы знак последних дней, листья не нужны»): на них ничего не растёт и ничего не осталось.
  const twigs = 4 + Math.floor(rnd() * 2);
  for (let t = 0; t < twigs; t++) {
    const a = ((t + rnd() * 0.7) / twigs) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const r = 0.16 + rnd() * 0.08;
    const o1 = 0.12 + rnd() * 0.16;
    const o2 = 0.06 + rnd() * 0.12;
    const from: Vec3 = [dx * r, y, dz * r];
    const elbow: Vec3 = [dx * (r + o1), y - 0.08 - rnd() * 0.1, dz * (r + o1)];
    const tip: Vec3 = [dx * (r + o1 + o2), elbow[1] - 0.26 - rnd() * 0.26, dz * (r + o1 + o2)];
    beam(xf, from, elbow, 0.014, 0.014, MAT.wood, TWIG, { caps: false });
    beam(xf, elbow, tip, 0.009, 0.009, MAT.wood, TWIG, { caps: false });
    // Отросток: тонкий прутик от колена в сторону и вниз.
    const sx = dx * 0.6 + (rnd() - 0.5) * 0.8;
    const sz = dz * 0.6 + (rnd() - 0.5) * 0.8;
    const len = 0.1 + rnd() * 0.12;
    beam(xf, elbow, [elbow[0] + sx * len, elbow[1] - len * (0.5 + rnd() * 0.6), elbow[2] + sz * len], 0.006, 0.004, MAT.wood, TWIG, { caps: false });
  }


  // Обломок плиты на полу, в стороне от ствола.
  const a = rnd() * Math.PI * 2;
  const ox = Math.sin(a) * (0.45 + rnd() * 0.3);
  const oz = Math.cos(a) * (0.45 + rnd() * 0.3);
  bx(xf, [ox - 0.14, 0, oz - 0.1], [ox + 0.14, 0.018, oz + 0.1], MAT.ceilTile, tile, { aoBottom: 0.6 });
  // Земля у комля: ковролин разошёлся — неровное тёмное пятно чуть шире ствола.
  const dirt: Vec3 = [0.24, 0.22, 0.19];
  const rim: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const g = 0.24 + rnd() * 0.1;
    rim.push([Math.sin(ang) * g, 0.004, Math.cos(ang) * g]);
  }
  for (let i = 0; i < 8; i += 2) sheet(xf, [0, 0.004, 0], rim[i]!, rim[i + 1]!, rim[(i + 2) % 8]!, UP, MAT.dirt, dirt);
}

export const OFFICE_PROPS: Record<string, PropSpec> = {
  office_desk: furnished('floor', OFFICE_DESKS, 'стол офисный: серый или с тумбой на ящики'),
  office_terminal: { w: 0.46, d: 0.5, h: 0.42, mount: 'free', ru: 'терминал кинескопный с клавиатурой', build: terminal },
  office_chair: furnished('free', [CHAIR], 'кресло офисное на колёсиках'),
  desk_island: { w: 3.0, d: 3.0, h: 1.2, mount: 'free', ru: 'островок отдела: четыре стола, перегородка крестом, терминалы и кресла', build: deskIsland },
  cubicle: { w: 1.8, d: 1.7, h: 1.45, mount: 'floor', ru: 'кабинка с тканевой перегородкой, столом, терминалом и креслом', build: cubicle },
  partition: { w: 1.5, d: 0.3, h: 1.45, mount: 'free', ru: 'панель тканевой перегородки на ножках', build: partition },
  filing_cabinet: furnished('floor', ['s3_filing_cabinet'], 'картотечный шкаф, три ящика'),
  water_cooler: { w: 0.34, d: 0.34, h: 1.35, mount: 'floor', ru: 'кулер с голубой бутылью', build: waterCooler },
  copier: { w: 1.0, d: 0.65, h: 1.05, mount: 'floor', ru: 'копировальный аппарат с лотком и пультом', build: copier },
  ceiling_panel: { w: 1.2, d: 0.6, h: 0.05, mount: 'ceiling', ru: 'потолочная светящаяся панель', build: ceilingPanel },
  ceiling_panel_off: { w: 1.2, d: 0.6, h: 0.05, mount: 'ceiling', ru: 'потолочная панель обесточенная', build: ceilingPanelOff },
  ceiling_panel_dead: { w: 1.2, d: 0.6, h: 0.35, mount: 'ceiling', ru: 'потолочная панель потухшая, с оборванным кабелем', build: ceilingPanelDead },
  ceiling_vent: { w: 0.6, d: 0.6, h: 0.05, mount: 'ceiling', ru: 'потолочный вентиляционный диффузор', build: ceilingVent },
  whiteboard: { w: 1.8, d: 0.06, h: 1.0, mount: 'wall', y: 0.9, ru: 'белая доска с маркерными схемами', build: whiteboard },
  office_clock: { w: 0.34, d: 0.06, h: 0.34, mount: 'wall', y: 2.05, ru: 'настенные часы', build: officeClock },
  vending_machine: { w: 0.95, d: 0.8, h: 1.83, mount: 'floor', ru: 'торговый автомат с подсвеченной витриной', build: vendingMachine },
  trash_bin: { w: 0.28, d: 0.28, h: 0.32, mount: 'free', ru: 'урна офисная', build: trashBin },
  reception_desk: { w: 2.2, d: 0.8, h: 1.1, mount: 'floor', ru: 'стойка ресепшена с бирюзовой полосой и терминалом', build: receptionDesk },
  meeting_table: { w: 2.4, d: 2.24, h: 1.02, mount: 'free', ru: 'переговорный стол с шестью креслами', build: meetingTable },
  server_rack: { w: 0.6, d: 0.9, h: 2.0, mount: 'floor', ru: 'серверная стойка с рядами огоньков', build: serverRack },
  elevator_doors: { w: 1.5, d: 0.14, h: 2.35, mount: 'floor', ru: 'закрытые двери лифта с кнопкой вызова', build: elevatorDoors },
  kitchenette: { w: 1.8, d: 0.62, h: 2.05, mount: 'floor', ru: 'кухонный уголок: мойка, микроволновка, кофемашина, верхний шкаф', build: kitchenette },
  wet_floor_sign: { w: 0.32, d: 0.4, h: 0.62, mount: 'free', ru: 'жёлтый знак «мокрый пол»', build: wetFloorSign },
  birch: { w: 0.56, d: 0.56, h: 2.72, mount: 'free', ru: 'берёза, проросшая сквозь пол и потолок: белый ствол в чёрных отметинах', build: birch },
  desk_phone: { w: 0.22, d: 0.2, h: 0.1, mount: 'free', ru: 'офисный телефон', build: deskPhone },
  paper_stack: { w: 0.32, d: 0.24, h: 0.14, mount: 'free', ru: 'стопка бумаг и папка', build: paperStack },
  binder_shelf: { ...spanOf(BINDER_SHELVES), mount: 'floor', ru: 'шкаф или стеллаж с папками-корешками', build: binderShelf },
};
