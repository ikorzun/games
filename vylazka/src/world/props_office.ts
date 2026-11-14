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

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FRONT: Vec3 = [0, 0, 1];

/** Белый ламинат, кремовый пластик, серый металл, бирюзовая и сине-серая ткань, тёмный пластик. */
const WHT: Vec3 = [1.2, 1.2, 1.15];
const CREAM: Vec3 = [1.2, 1.15, 0.95];
const METAL: Vec3 = [0.9, 0.92, 0.95];
const METAL_DK: Vec3 = [0.6, 0.62, 0.65];
const TEAL: Vec3 = [0.4, 0.95, 0.9];
const TEAL_DK: Vec3 = [0.45, 0.95, 0.9];
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

/** Стол 1,4 × 0,7 × 0,75: белая столешница, серые боковины, справа тумба с тремя ящиками. Пользователь сидит со стороны +z. */
function desk(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const top: Vec3 = [WHT[0] * (0.95 + rnd() * 0.08), WHT[1] * (0.95 + rnd() * 0.08), WHT[2]];
  bx(xf, [-0.7, 0.71, 0], [0.7, 0.75, 0.7], MAT.enamel, top, { bevel: 0.008 });
  // Левая боковина-ножка и низкая панель между ножкой и тумбой.
  bx(xf, [-0.68, 0, 0.05], [-0.64, 0.71, 0.65], MAT.metalGrey, METAL, { aoBottom: 0.6 });
  bx(xf, [-0.64, 0.3, 0.04], [0.2, 0.68, 0.06], MAT.metalGrey, METAL_DK);
  // Тумба: тёмный корпус, светлые фронты ящиков, ручки-планки.
  bx(xf, [0.2, 0.02, 0.04], [0.68, 0.71, 0.66], MAT.metalGrey, METAL_DK, { aoBottom: 0.6 });
  const front: Vec3 = [1.1, 1.1, 1.05];
  for (let i = 0; i < 3; i++) {
    const y0 = 0.04 + i * 0.22;
    bx(xf, [0.22, y0, 0.66], [0.66, y0 + 0.205, 0.68], MAT.enamel, front);
    bx(xf, [0.36, y0 + 0.1, 0.68], [0.52, y0 + 0.125, 0.7], MAT.steel, [0.6, 0.6, 0.6]);
  }
  xf.collider([-0.7, 0, 0], [0.7, 0.75, 0.7]);
}

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

/** Кресло 0,6 × 0,6 × 0,95: пятилучевая крестовина на роликах, газ-лифт, сиденье и спинка из тёмно-бирюзовой ткани. Лицом к +z. */
function chair(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fab: Vec3 = [TEAL_DK[0] * (0.9 + rnd() * 0.3), TEAL_DK[1] * (0.9 + rnd() * 0.3), TEAL_DK[2] * (0.9 + rnd() * 0.3)];
  // Пять лучей и ролики.
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 + 18) * (Math.PI / 180);
    const x = Math.sin(a) * 0.27;
    const z = Math.cos(a) * 0.27;
    beam(xf, [0, 0.075, 0], [x, 0.075, z], 0.05, 0.035, MAT.metalGrey, [1.15, 1.17, 1.2], { side: UP });
    bx(xf, [x - 0.03, 0, z - 0.03], [x + 0.03, 0.055, z + 0.03], MAT.bakelite, PLASTIC_DK, { skip: ['ny'] });
  }
  xf.cyl([0, 0.06, 0], 'y', 0.04, 0.07, MAT.metalGrey, { tint: METAL, segments: 8 });
  xf.cyl([0, 0.1, 0], 'y', 0.36, 0.03, MAT.steel, { tint: [0.8, 0.8, 0.8], segments: 6 });
  // Сиденье и спинка.
  bx(xf, [-0.22, 0.46, -0.21], [0.22, 0.52, 0.23], MAT.upholstery, fab, { bevel: 0.012, aoBottom: 0.7 });
  bx(xf, [-0.2, 0.55, -0.27], [0.2, 0.92, -0.2], MAT.upholstery, [fab[0] * 1.1, fab[1] * 1.1, fab[2] * 1.1]);
  bx(xf, [-0.03, 0.5, -0.22], [0.03, 0.58, -0.17], MAT.metalGrey, METAL_DK);
  xf.collider([-0.22, 0, -0.27], [0.22, 0.5, 0.23]);
}

// ───────────────────────────── перегородки и составные места ─────────────────────────────

/** Ткань перегородки: серо-синяя или бирюзовая. */
function fabricOf(rnd: () => number): Vec3 {
  return rnd() < 0.5 ? BLUEG : TEAL;
}

/** Островок отдела 3,0 × 3,0 × 1,2: четыре стола спинка к спинке, крестовая перегородка, на каждом терминал, у каждого кресло. */
function deskIsland(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fab = fabricOf(rnd);
  for (const row of [
    { z: 0.03, rot: 0 as const },
    { z: -0.03, rot: 2 as const },
  ]) {
    for (const sx of [-1, 1]) {
      const d = xf.child(sx * 0.73, 0, row.z, row.rot);
      desk(d, seed + sx * 3 + row.rot);
      terminal(d.child(-0.2, 0.75, 0.33), seed + sx + row.rot * 5);
      chair(d.child(-0.2 + (rnd() - 0.5) * 0.1, 0, 0.82, 2), seed + 11 + sx + row.rot);
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

/** Кабинка 1,8 × 1,7 × 1,45: П-образная перегородка, открытая в +z, стол, терминал и кресло. */
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
  // Столешница на двух боковинах.
  bx(xf, [-0.84, 0.72, 0.06], [0.84, 0.76, 0.72], MAT.enamel, WHT, { bevel: 0.008 });
  bx(xf, [-0.82, 0, 0.1], [-0.78, 0.72, 0.68], MAT.metalGrey, METAL, { aoBottom: 0.6 });
  bx(xf, [0.78, 0, 0.1], [0.82, 0.72, 0.68], MAT.metalGrey, METAL, { aoBottom: 0.6 });
  xf.collider([-0.84, 0, 0.06], [0.84, 0.76, 0.72]);
  terminal(xf.child(0.2, 0.76, 0.38), seed + 1);
  chair(xf.child(rnd() * 0.2 - 0.1, 0, 1.05, 2), seed + 2);
}

/** Одна панель перегородки 1,5 × 0,3 × 1,45 на двух ножках. */
function partition(xf: Xf, seed: number): void {
  const fab = fabricOf(rng(seed));
  bx(xf, [-0.75, 0.08, -0.03], [0.75, 1.42, 0.03], MAT.upholstery, fab);
  bx(xf, [-0.755, 1.42, -0.035], [0.755, 1.45, 0.035], MAT.metalGrey, METAL);
  bx(xf, [-0.755, 0.05, -0.035], [0.755, 0.08, 0.035], MAT.metalGrey, METAL_DK);
  for (const x of [-0.6, 0.5]) bx(xf, [x, 0, -0.15], [x + 0.1, 0.06, 0.15], MAT.metalGrey, METAL, { aoBottom: 0.6 });
  xf.collider([-0.75, 0, -0.03], [0.75, 1.45, 0.03]);
}

// ───────────────────────────── шкафы, техника ─────────────────────────────

/** Картотечный шкаф 0,47 × 0,62 × 1,32: четыре ящика, ручки, держатели табличек; по сиду один ящик выдвинут на 0,2 м. */
function filingCabinet(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const open = Math.floor(rnd() * 4);
  bx(xf, [-0.235, 0.02, 0], [0.235, 1.32, 0.4], MAT.metalGrey, METAL_DK, { aoBottom: 0.6 });
  bx(xf, [-0.23, 0, 0.02], [0.23, 0.03, 0.38], MAT.bakelite, PLASTIC_DK);
  const h = 0.31;
  for (let i = 0; i < 4; i++) {
    const y0 = 0.04 + i * h;
    const out = i === open ? 0.2 : 0;
    if (out > 0) {
      // Выдвинутый ящик: тёмный лоток с папками и передняя панель.
      bx(xf, [-0.21, y0 + 0.02, 0.3], [0.21, y0 + 0.25, 0.4 + out], MAT.bakelite, [1.3, 1.3, 1.3]);
      for (const x of [-0.15, -0.04, 0.07]) bx(xf, [x, y0 + 0.25, 0.32], [x + 0.08, y0 + 0.28, 0.4 + out - 0.03], MAT.paper, [1.1, 1.05, 0.9]);
    }
    bx(xf, [-0.225, y0, 0.4 + out], [0.225, y0 + h - 0.02, 0.42 + out], MAT.metalGrey, METAL, { bevel: 0.006 });
    bx(xf, [-0.07, y0 + h - 0.1, 0.42 + out], [0.07, y0 + h - 0.07, 0.44 + out - 0.0], MAT.steel, [0.55, 0.55, 0.55]);
    bx(xf, [-0.05, y0 + h - 0.2, 0.42 + out], [0.05, y0 + h - 0.15, 0.428 + out], MAT.paper, [1.2, 1.15, 0.95]);
  }
  xf.collider([-0.235, 0, 0], [0.235, 1.32, 0.44]);
  xf.collider([-0.21, 0, 0.44], [0.21, 0.3, 0.62]);
}

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

/** Переговорная 2,6 × 1,9 × 0,95: длинный стол с торцевыми ножками и шесть кресел по длинным сторонам. */
function meetingTable(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-1.2, 0.7, -0.55], [1.2, 0.74, 0.55], MAT.enamel, WHT, { bevel: 0.01 });
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 1.0 : -1.06, 0, -0.4], [s > 0 ? 1.06 : -1.0, 0.7, 0.4], MAT.metalGrey, METAL, { aoBottom: 0.6 });
  bx(xf, [-1.0, 0.45, -0.03], [1.0, 0.68, 0.03], MAT.metalGrey, METAL_DK);
  bx(xf, [-0.5, 0.74, -0.14], [0.2, 0.745, 0.12], MAT.paper, [1.2, 1.15, 1.0]);
  for (const side of [-1, 1]) {
    for (const x of [-0.7, 0, 0.7]) {
      const jit = (rnd() - 0.5) * 0.12;
      chair(xf.child(x + (rnd() - 0.5) * 0.08, 0, side * (0.65 + jit), side > 0 ? 2 : 0), seed + side * 7 + Math.round(x * 10));
    }
  }
  xf.collider([-1.2, 0, -0.55], [1.2, 0.74, 0.55]);
}

/** Серверная стойка 0,6 × 0,9 × 2,0: чёрный шкаф, дверь из тонких горизонтальных планок, ряды огоньков (зелёные и янтарные). */
function serverRack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-0.3, 0, 0], [0.3, 2.0, 0.86], MAT.bakelite, [0.9, 0.95, 1.0], { aoBottom: 0.6 });
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

/** Открытый стеллаж 1,0 × 0,36 × 1,9: пять полок и ряды корешков папок, пропуски по сиду. */
function binderShelf(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  bx(xf, [-0.5, 0, 0], [-0.48, 1.9, 0.36], MAT.metalGrey, METAL);
  bx(xf, [0.48, 0, 0], [0.5, 1.9, 0.36], MAT.metalGrey, METAL);
  bx(xf, [-0.48, 0, 0], [0.48, 1.9, 0.01], MAT.metalGrey, METAL_DK);
  for (let i = 0; i < 6; i++) bx(xf, [-0.48, i * 0.372, 0.01], [0.48, i * 0.372 + 0.02, 0.36], MAT.metalGrey, METAL);
  const spines: [number, Vec3][] = [
    [MAT.cardboard, [0.8, 0.8, 0.82]],
    [MAT.paintBlue, [0.55, 0.7, 1.05]],
    [MAT.paper, [1.2, 1.15, 0.95]],
    [MAT.paintRed, [1.0, 0.55, 0.5]],
  ];
  for (let r = 0; r < 5; r++) {
    const y0 = r * 0.372 + 0.02;
    let x = -0.46;
    while (x < 0.44) {
      if (rnd() < 0.12) {
        x += 0.05 + rnd() * 0.12;
        continue;
      }
      const [mat, tint] = spines[Math.floor(rnd() * 4)]!;
      bx(xf, [x, y0, 0.05], [x + 0.045, y0 + 0.27 + rnd() * 0.06, 0.34], mat, tint, { skip: FRONT_ONLY });
      x += 0.05;
    }
  }
  xf.collider([-0.5, 0, 0], [0.5, 1.9, 0.36]);
}

export const OFFICE_PROPS: Record<string, PropSpec> = {
  office_desk: { w: 1.4, d: 0.7, h: 0.75, mount: 'floor', ru: 'стол офисный с тумбой на три ящика', build: desk },
  office_terminal: { w: 0.46, d: 0.5, h: 0.42, mount: 'free', ru: 'терминал кинескопный с клавиатурой', build: terminal },
  office_chair: { w: 0.6, d: 0.6, h: 0.95, mount: 'free', ru: 'кресло офисное на колёсиках', build: chair },
  desk_island: { w: 3.0, d: 3.0, h: 1.2, mount: 'free', ru: 'островок отдела: четыре стола, перегородка крестом, терминалы и кресла', build: deskIsland },
  cubicle: { w: 1.8, d: 1.7, h: 1.45, mount: 'floor', ru: 'кабинка с тканевой перегородкой, столом, терминалом и креслом', build: cubicle },
  partition: { w: 1.5, d: 0.3, h: 1.45, mount: 'free', ru: 'панель тканевой перегородки на ножках', build: partition },
  filing_cabinet: { w: 0.47, d: 0.62, h: 1.32, mount: 'floor', ru: 'картотечный шкаф, один ящик выдвинут', build: filingCabinet },
  water_cooler: { w: 0.34, d: 0.34, h: 1.35, mount: 'floor', ru: 'кулер с голубой бутылью', build: waterCooler },
  copier: { w: 1.0, d: 0.65, h: 1.05, mount: 'floor', ru: 'копировальный аппарат с лотком и пультом', build: copier },
  ceiling_panel: { w: 1.2, d: 0.6, h: 0.05, mount: 'ceiling', ru: 'потолочная светящаяся панель', build: ceilingPanel },
  ceiling_panel_dead: { w: 1.2, d: 0.6, h: 0.35, mount: 'ceiling', ru: 'потолочная панель потухшая, с оборванным кабелем', build: ceilingPanelDead },
  ceiling_vent: { w: 0.6, d: 0.6, h: 0.05, mount: 'ceiling', ru: 'потолочный вентиляционный диффузор', build: ceilingVent },
  whiteboard: { w: 1.8, d: 0.06, h: 1.0, mount: 'wall', y: 0.9, ru: 'белая доска с маркерными схемами', build: whiteboard },
  office_clock: { w: 0.34, d: 0.06, h: 0.34, mount: 'wall', y: 2.05, ru: 'настенные часы', build: officeClock },
  vending_machine: { w: 0.95, d: 0.8, h: 1.83, mount: 'floor', ru: 'торговый автомат с подсвеченной витриной', build: vendingMachine },
  trash_bin: { w: 0.28, d: 0.28, h: 0.32, mount: 'free', ru: 'урна офисная', build: trashBin },
  reception_desk: { w: 2.2, d: 0.8, h: 1.1, mount: 'floor', ru: 'стойка ресепшена с бирюзовой полосой и терминалом', build: receptionDesk },
  meeting_table: { w: 2.6, d: 1.9, h: 0.95, mount: 'free', ru: 'переговорный стол с шестью креслами', build: meetingTable },
  server_rack: { w: 0.6, d: 0.9, h: 2.0, mount: 'floor', ru: 'серверная стойка с рядами огоньков', build: serverRack },
  elevator_doors: { w: 1.5, d: 0.14, h: 2.35, mount: 'floor', ru: 'закрытые двери лифта с кнопкой вызова', build: elevatorDoors },
  kitchenette: { w: 1.8, d: 0.62, h: 2.05, mount: 'floor', ru: 'кухонный уголок: мойка, микроволновка, кофемашина, верхний шкаф', build: kitchenette },
  wet_floor_sign: { w: 0.32, d: 0.4, h: 0.62, mount: 'free', ru: 'жёлтый знак «мокрый пол»', build: wetFloorSign },
  desk_phone: { w: 0.22, d: 0.2, h: 0.1, mount: 'free', ru: 'офисный телефон', build: deskPhone },
  paper_stack: { w: 0.32, d: 0.24, h: 0.14, mount: 'free', ru: 'стопка бумаг и папка', build: paperStack },
  binder_shelf: { w: 1.0, d: 0.36, h: 1.9, mount: 'floor', ru: 'стеллаж с папками-корешками', build: binderShelf },
};
