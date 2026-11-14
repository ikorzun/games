/**
 * Реквизит «дома каждого»: бытовые вещи и знакомые комнаты, как во сне, — смешиваются с убежищем.
 * Правила те же, что в props_more.ts: предмет описан в своих координатах (метры, y вверх), пол — y = 0,
 * спина — плоскость z = 0 (стена позади), предмет растёт в +z, центр по x = 0. Отдельно стоящий (free)
 * лежит по центру: x и z от −половины до +половины. Настенный растёт от z = 0, y в записи реестра —
 * высота низа над полом. Подвесной растёт вниз от y = 0.
 *
 * Картинка тёмная и мелкая, поэтому форма крупная и «игрушечная», части контрастны (светлое на тёмном),
 * а характерные признаки преувеличены. Мелочь сделана в 1,3–1,5 раза крупнее настоящей.
 * Свечение — MAT.glow: цвет = зеленоватая основа × оттенок вершины, оттенок работает как множитель
 * яркости (экран телевизора ~ [5, 7, 10], телефона ~ [9, 10, 12], «окно в никуда» ~ [10, 10, 9]).
 */
import type { Vec3 } from '../core/types';
import type { BoxOpts } from './kit';
import { MAT } from './materials';
import type { Xf } from './props';
import { beam, ring, rng, sheet, WHITE } from './props_more';
import type { PropSpec } from './props_more';

/** Оттенок × коэффициент, но не выше 1,5: приглушённость тона держит тест. */
const dim = (t: Vec3, k: number): Vec3 => [Math.min(1.5, t[0] * k), Math.min(1.5, t[1] * k), Math.min(1.5, t[2] * k)];

const UP: Vec3 = [0, 1, 0];
const FRONT: Vec3 = [0, 0, 1];

/** Коробка с оттенком: короче, чем xf.box с опциями. */
function bx(xf: Xf, a: Vec3, b: Vec3, mat: number, tint: Vec3 = WHITE, o: BoxOpts = {}): void {
  xf.box(a, b, mat, { ...o, tint });
}

/** Плоская заплатка, смотрящая вверх (рисунок на ковре, клетка на скатерти). */
function flat(xf: Xf, x0: number, z0: number, x1: number, z1: number, y: number, mat: number, tint: Vec3 = WHITE): void {
  sheet(xf, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], UP, mat, tint);
}

/** Плоская заплатка на передней стороне (лицом к +z). */
function face(xf: Xf, x0: number, y0: number, x1: number, y1: number, z: number, mat: number, tint: Vec3 = WHITE): void {
  sheet(xf, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], FRONT, mat, tint);
}

/** Ромб на передней стороне. */
function diamond(xf: Xf, cx: number, cy: number, hw: number, hh: number, z: number, mat: number, tint: Vec3 = WHITE): void {
  sheet(xf, [cx, cy - hh, z], [cx + hw, cy, z], [cx, cy + hh, z], [cx - hw, cy, z], FRONT, mat, tint);
}

/** Ромб, лежащий на полу. */
function lozenge(xf: Xf, cx: number, cz: number, hw: number, hd: number, y: number, mat: number, tint: Vec3 = WHITE): void {
  sheet(xf, [cx, y, cz - hd], [cx + hw, y, cz], [cx, y, cz + hd], [cx - hw, y, cz], UP, mat, tint);
}

/** Шар из конусов-поясов вокруг вертикальной оси: голова, мяч, пузырь. seg — граней в поясе. */
function blob(xf: Xf, c: Vec3, r: number, mat: number, tint: Vec3 = WHITE, seg = 8, ry = r): void {
  const at = (a: number): [number, number] => [c[1] + Math.sin((a * Math.PI) / 180) * ry, Math.cos((a * Math.PI) / 180) * r];
  const lvl: number[] = [-90, -45, 0, 45, 90];
  for (let i = 0; i < lvl.length - 1; i++) {
    const [y0, r0] = at(lvl[i]!);
    const [y1, r1] = at(lvl[i + 1]!);
    xf.cyl([c[0], y0, c[2]], 'y', y1 - y0, r0, mat, { tint, segments: seg, radiusEnd: r1, caps: false });
  }
}

/** Пояс шара: от широты a0 до a1 (градусы), для полосатого мяча. */
function band(xf: Xf, c: Vec3, r: number, a0: number, a1: number, mat: number, tint: Vec3, seg: number): void {
  const k = Math.PI / 180;
  const y0 = c[1] + Math.sin(a0 * k) * r;
  const y1 = c[1] + Math.sin(a1 * k) * r;
  xf.cyl([c[0], y0, c[2]], 'y', y1 - y0, Math.cos(a0 * k) * r, mat, { tint, segments: seg, radiusEnd: Math.cos(a1 * k) * r, caps: false });
}

const WOOD_DARK: Vec3 = [0.55, 0.5, 0.45];

// ───────────────────────────── мебель ─────────────────────────────

/** Диван 2,0 × 0,9 × 0,85: подлокотники, плед через спинку, две подушки. */
function sofa(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fab: Vec3 = rnd() < 0.5 ? [1.45, 1.0, 0.45] : [0.55, 1.25, 1.1];
  for (const x of [-0.95, 0.87]) for (const z of [0.08, 0.78]) bx(xf, [x, 0, z], [x + 0.08, 0.12, z + 0.06], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [-1, 0.1, 0.04], [1, 0.4, 0.9], MAT.upholstery, dim(fab, 0.85), { aoBottom: 0.6 });
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 0.8 : -1, 0.4, 0.04], [s > 0 ? 1 : -0.8, 0.62, 0.9], MAT.upholstery, dim(fab, 0.95), { bevel: 0.02 });
  bx(xf, [-0.8, 0.4, 0.04], [0.8, 0.79, 0.3], MAT.upholstery, fab, { bevel: 0.02 });
  bx(xf, [-0.8, 0.4, 0.3], [-0.005, 0.52, 0.9], MAT.upholstery, dim(fab, 1.12), { bevel: 0.015 });
  bx(xf, [0.005, 0.4, 0.3], [0.8, 0.52, 0.9], MAT.upholstery, dim(fab, 1.12), { bevel: 0.015 });
  // Плед в крупную клетку, переброшен через спинку слева.
  const plaid: Vec3 = [1.1, 0.8, 0.75];
  bx(xf, [-0.6, 0.79, 0.02], [0, 0.85, 0.32], MAT.paintRed, plaid);
  bx(xf, [-0.6, 0.42, 0.3], [0, 0.85, 0.34], MAT.paintRed, plaid);
  bx(xf, [-0.6, 0.42, 0.0], [0, 0.85, 0.04], MAT.paintRed, dim(plaid, 0.8));
  const stripe: Vec3 = [0.5, 0.45, 0.4];
  for (const y of [0.52, 0.66]) face(xf, -0.6, y, 0, y + 0.06, 0.342, MAT.bakelite, stripe);
  for (const x of [-0.5, -0.3, -0.1]) face(xf, x, 0.42, x + 0.05, 0.85, 0.343, MAT.paper, [1.2, 1.1, 0.9]);
  // Подушки.
  bx(xf, [0.14, 0.52, 0.3], [0.5, 0.82, 0.42], MAT.paintBlue, [1.2, 1.3, 1.5], { bevel: 0.02 });
  bx(xf, [0.52, 0.52, 0.32], [0.78, 0.76, 0.43], MAT.paper, [1.3, 1.2, 0.9], { bevel: 0.02 });
  xf.collider([-1, 0, 0.04], [1, 0.85, 0.9]);
}

/** Кресло 0,9 × 0,85 × 0,9. */
function armchair(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fab: Vec3 = rnd() < 0.5 ? [0.55, 1.35, 0.9] : [1.4, 0.5, 0.45];
  for (const x of [-0.4, 0.34]) for (const z of [0.08, 0.76]) bx(xf, [x, 0, z], [x + 0.06, 0.12, z + 0.06], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [-0.45, 0.1, 0.04], [0.45, 0.38, 0.85], MAT.upholstery, dim(fab, 0.85), { aoBottom: 0.6 });
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 0.33 : -0.45, 0.38, 0.04], [s > 0 ? 0.45 : -0.33, 0.6, 0.85], MAT.upholstery, dim(fab, 0.95), { bevel: 0.02 });
  bx(xf, [-0.33, 0.38, 0.04], [0.33, 0.9, 0.27], MAT.upholstery, fab, { bevel: 0.02 });
  bx(xf, [-0.33, 0.38, 0.27], [0.33, 0.5, 0.85], MAT.upholstery, dim(fab, 1.15), { bevel: 0.015 });
  // Кружевные салфетки на спинке и подлокотниках.
  face(xf, -0.2, 0.62, 0.2, 0.86, 0.275, MAT.paper, [1.3, 1.25, 1.0]);
  for (const x of [-0.39, 0.39]) flat(xf, x - 0.05, 0.3, x + 0.05, 0.6, 0.605, MAT.paper, [1.3, 1.25, 1.0]);
  xf.collider([-0.45, 0, 0.04], [0.45, 0.9, 0.85]);
}

/** Тумба с кинескопным телевизором 1,1 × 0,5 × 1,15: экран светится, рожки антенны, под тумбой видеомагнитофон. */
function tvStand(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.05, 0.95, 0.85], 0.9 + rnd() * 0.2);
  for (const x of [-0.5, 0.45]) for (const z of [0.05, 0.43]) bx(xf, [x, 0, z], [x + 0.05, 0.25, z + 0.04], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [-0.55, 0.25, 0.02], [0.55, 0.55, 0.5], MAT.veneer, wood);
  face(xf, -0.005, 0.28, 0.005, 0.52, 0.501, MAT.bakelite);
  for (const x of [-0.08, 0.05]) bx(xf, [x, 0.36, 0.5], [x + 0.03, 0.46, 0.52], MAT.brass, [1.3, 1.2, 1.0]);
  // Видеомагнитофон под тумбой: тёмный ящик, светлая щель, красный огонёк.
  bx(xf, [-0.32, 0.03, 0.08], [0.32, 0.2, 0.46], MAT.bakelite, [1.3, 1.3, 1.3]);
  face(xf, -0.24, 0.1, 0.06, 0.16, 0.461, MAT.steel, [1.2, 1.2, 1.2]);
  bx(xf, [0.18, 0.11, 0.46], [0.23, 0.15, 0.475], MAT.glow, [14, 2, 1]);
  // Телевизор: широкий корпус, горб кинескопа позади, чёрная рамка и выпуклый светящийся экран.
  bx(xf, [-0.42, 0.55, 0.22], [0.42, 0.97, 0.47], MAT.veneer, dim(wood, 1.1));
  bx(xf, [-0.3, 0.6, 0.04], [0.3, 0.9, 0.22], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [-0.38, 0.6, 0.47], [0.22, 0.93, 0.485], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [-0.34, 0.63, 0.485], [0.18, 0.9, 0.5], MAT.glow, [5, 7, 10]);
  bx(xf, [-0.3, 0.66, 0.5], [0.14, 0.87, 0.515], MAT.glow, [6.5, 8.5, 12]);
  for (const y of [0.82, 0.68]) xf.cyl([0.32, y, 0.47], 'z', 0.035, 0.03, MAT.steel, { segments: 6, tint: [1.4, 1.4, 1.4] });
  // Комнатная антенна: основание и два рожка с шариками.
  bx(xf, [-0.07, 0.97, 0.28], [0.07, 1.0, 0.4], MAT.bakelite, [1.3, 1.3, 1.3]);
  for (const s of [-1, 1]) {
    beam(xf, [s * 0.02, 1.0, 0.34], [s * 0.34, 1.12, 0.34], 0.02, 0.02, MAT.steel, [1.4, 1.4, 1.4], { side: UP });
    bx(xf, [s * 0.34 - 0.025, 1.11, 0.315], [s * 0.34 + 0.025, 1.15, 0.365], MAT.steel, [1.4, 1.4, 1.4]);
  }
  xf.collider([-0.55, 0, 0.02], [0.55, 1.0, 0.5]);
}

/** Холодильник 0,62 × 0,62 × 1,7: две двери, ручки, магниты, записка. */
function fridge(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const body: Vec3 = dim([1.05, 1.05, 1.0], 0.92 + rnd() * 0.1);
  for (const x of [-0.26, 0.2]) bx(xf, [x, 0, 0.06], [x + 0.06, 0.05, 0.5], MAT.rubber);
  bx(xf, [-0.31, 0.04, 0.02], [0.31, 1.7, 0.58], MAT.enamel, dim(body, 0.9), { aoBottom: 0.6 });
  bx(xf, [-0.31, 0.06, 0.58], [0.31, 1.23, 0.62], MAT.enamel, body);
  bx(xf, [-0.31, 1.27, 0.58], [0.31, 1.7, 0.62], MAT.enamel, body);
  // Ручки: тёмные вертикальные скобы.
  bx(xf, [0.2, 0.92, 0.62], [0.25, 1.2, 0.67], MAT.bakelite, [1.3, 1.3, 1.3]);
  bx(xf, [0.2, 1.3, 0.62], [0.25, 1.55, 0.67], MAT.bakelite, [1.3, 1.3, 1.3]);
  // Записка и магниты: самое яркое на двери.
  face(xf, -0.17, 0.6, 0.05, 0.84, 0.621, MAT.paper, [1.4, 1.35, 1.1]);
  for (const y of [0.64, 0.7, 0.76]) face(xf, -0.13, y, 0.01, y + 0.025, 0.622, MAT.bakelite);
  bx(xf, [-0.22, 0.8, 0.62], [-0.12, 0.9, 0.64], MAT.paintRed, [1.5, 1.2, 1.2]);
  bx(xf, [0.0, 0.5, 0.62], [0.1, 0.6, 0.64], MAT.paintBlue, [1.3, 1.4, 1.5]);
  bx(xf, [-0.05, 1.4, 0.62], [0.05, 1.5, 0.64], MAT.paintOchre, [1.5, 1.3, 0.9]);
  xf.collider([-0.31, 0, 0.02], [0.31, 1.7, 0.62]);
}

/** Газовая плита 0,55 × 0,58 × 0,9: конфорки, духовка, кастрюля. */
function stove(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const body: Vec3 = dim([1.05, 1.05, 1.0], 0.92 + rnd() * 0.1);
  bx(xf, [-0.26, 0, 0.05], [-0.2, 0.04, 0.12], MAT.rubber);
  bx(xf, [0.2, 0, 0.05], [0.26, 0.04, 0.12], MAT.rubber);
  bx(xf, [-0.275, 0.04, 0.02], [0.275, 0.78, 0.55], MAT.enamel, dim(body, 0.9), { aoBottom: 0.6 });
  bx(xf, [-0.275, 0.78, 0.02], [0.275, 0.8, 0.58], MAT.bakelite, [1.4, 1.4, 1.4]);
  // Духовка: дверца со стеклом и ручкой, над ней ряд ручек конфорок.
  bx(xf, [-0.23, 0.1, 0.55], [0.23, 0.56, 0.58], MAT.enamel, body);
  bx(xf, [-0.15, 0.2, 0.58], [0.15, 0.46, 0.59], MAT.glass, [1.2, 1.2, 1.2]);
  bx(xf, [-0.2, 0.585, 0.58], [0.2, 0.615, 0.62], MAT.steel, [1.4, 1.4, 1.4]);
  for (const x of [-0.18, -0.06, 0.06, 0.18]) xf.cyl([x, 0.68, 0.55], 'z', 0.045, 0.027, MAT.bakelite, { segments: 6, tint: [1.4, 1.4, 1.4] });
  // Конфорки.
  for (const x of [-0.12, 0.12]) for (const z of [0.17, 0.42]) xf.cyl([x, 0.8, z], 'y', 0.015, 0.08, MAT.castIron, { segments: 8, tint: [0.7, 0.7, 0.7] });
  // Кастрюля на дальней левой конфорке: эмаль, крышка, шишка.
  xf.cyl([-0.12, 0.815, 0.17], 'y', 0.075, 0.105, MAT.paintRed, { segments: 8, tint: [1.4, 1.2, 1.1] });
  xf.cyl([-0.12, 0.89, 0.17], 'y', 0.006, 0.11, MAT.steel, { segments: 8, tint: [1.4, 1.4, 1.4] });
  xf.cyl([-0.12, 0.896, 0.17], 'y', 0.004, 0.02, MAT.bakelite, { segments: 5 });
  xf.collider([-0.275, 0, 0.02], [0.275, 0.8, 0.58]);
}

/** Кухонный стол 1,2 × 0,8 × 0,78 под клеёнкой в клетку, табуретка, тарелка, хлебница. */
function kitchenTable(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const top = 0.66;
  for (const x of [-0.56, 0.5]) for (const z of [0.04, 0.72]) bx(xf, [x, 0, z], [x + 0.06, top - 0.04, z + 0.04], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [-0.6, top - 0.04, 0], [0.6, top, 0.8], MAT.paper, [1.35, 1.3, 1.1]);
  // Клетка: красные квадраты в шахматном порядке, 6 × 4.
  const red: Vec3 = [1.4, 0.9, 0.85];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i + j) % 2 === 0) flat(xf, -0.6 + i * 0.2, j * 0.2, -0.4 + i * 0.2, (j + 1) * 0.2, top + 0.002, MAT.paintRed, red);
    }
  }
  // Табуретка наполовину выдвинута; сиденье светлое.
  const st = rnd() < 0.5 ? -0.32 : 0.32;
  for (const dx of [-0.11, 0.07]) for (const dz of [0.54, 0.74]) bx(xf, [st + dx, 0, dz], [st + dx + 0.04, 0.38, dz + 0.04], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [st - 0.15, 0.38, 0.5], [st + 0.15, 0.43, 0.8], MAT.wood, [1.4, 1.25, 1.05]);
  // Тарелка с куском, хлебница.
  xf.cyl([-0.1, top, 0.38], 'y', 0.02, 0.13, MAT.enamel, { segments: 8, tint: [1.2, 1.2, 1.2] });
  bx(xf, [-0.15, top + 0.02, 0.33], [-0.03, top + 0.05, 0.43], MAT.leather, [1.1, 0.9, 0.7]);
  bx(xf, [0.2, top, 0.22], [0.54, top + 0.11, 0.56], MAT.zinc, [1.3, 1.3, 1.3], { bevel: 0.015 });
  bx(xf, [0.22, top + 0.11, 0.24], [0.52, top + 0.12, 0.54], MAT.paintOchre, [1.3, 1.2, 0.8]);
  xf.collider([-0.6, 0, 0], [0.6, top, 0.8]);
}

/** Мойка-тумба 0,8 × 0,58 × 1,35: кран, над ней сушилка с тарелками. */
function sinkCabinet(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = rnd() < 0.5 ? [1.2, 1.3, 1.5] : [1.4, 1.35, 1.1];
  const mat = paint[2] > 1.4 ? MAT.paintBlue : MAT.enamel;
  bx(xf, [-0.4, 0.04, 0], [0.4, 0.8, 0.54], mat, dim(paint, 0.9), { aoBottom: 0.6 });
  for (const x of [-0.39, 0.01]) {
    bx(xf, [x, 0.08, 0.54], [x + 0.38, 0.76, 0.58], mat, paint);
    bx(xf, [x + (x < 0 ? 0.3 : 0.04), 0.4, 0.58], [x + (x < 0 ? 0.34 : 0.08), 0.5, 0.6], MAT.steel, [1.4, 1.4, 1.4]);
  }
  for (const x of [-0.38, 0.34]) bx(xf, [x, 0, 0.04], [x + 0.04, 0.04, 0.5], MAT.rubber);
  // Столешница и мойка: стальной борт, тёмное дно.
  bx(xf, [-0.4, 0.8, 0], [0.4, 0.84, 0.58], MAT.steel, [1.2, 1.2, 1.2]);
  bx(xf, [-0.34, 0.84, 0.1], [0.06, 0.865, 0.5], MAT.steel, [1.5, 1.5, 1.5]);
  flat(xf, -0.3, 0.14, 0.02, 0.46, 0.866, MAT.bakelite);
  // Кран: стойка и носик над мойкой.
  xf.cyl([0.0, 0.865, 0.09], 'y', 0.22, 0.022, MAT.steel, { segments: 6, tint: [1.5, 1.5, 1.5] });
  beam(xf, [0.0, 1.07, 0.09], [0.0, 1.07, 0.3], 0.045, 0.045, MAT.steel, [1.5, 1.5, 1.5]);
  for (const s of [-1, 1]) bx(xf, [s * 0.07 + 0.0 - 0.02, 0.865, 0.06], [s * 0.07 + 0.02, 0.92, 0.1], MAT.paintRed, [1.4, 1.2, 1.2]);
  // Сушилка над мойкой: проволочная рама и три стоящие тарелки.
  for (const x of [-0.38, -0.02]) for (const z of [0.03, 0.27]) bx(xf, [x, 1.12, z], [x + 0.025, 1.35, z + 0.025], MAT.steel, [1.2, 1.2, 1.2]);
  bx(xf, [-0.38, 1.1, 0.02], [0.0, 1.125, 0.3], MAT.steel, [1.2, 1.2, 1.2]);
  bx(xf, [-0.38, 1.33, 0.02], [0.0, 1.35, 0.3], MAT.steel, [1.2, 1.2, 1.2]);
  for (const x of [-0.31, -0.19, -0.07]) xf.cyl([x, 1.23, 0.15], 'z', 0.02, 0.11, MAT.enamel, { segments: 8, tint: [1.4, 1.4, 1.35] });
  xf.collider([-0.4, 0, 0], [0.4, 0.84, 0.58]);
}

/** Платяной шкаф 1,3 × 0,58 × 2,2: левая дверца закрыта, правая распахнута вдоль бока, одежда на плечиках, наверху чемодан. */
function wardrobe(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.05, 0.95, 0.85], 0.9 + rnd() * 0.2);
  const D = 0.44;
  for (const x of [-0.52, 0.46]) for (const z of [0.04, 0.34]) bx(xf, [x, 0, z], [x + 0.06, 0.1, z + 0.06], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  // Корпус: задняя стенка тёмная (внутри всегда темно), боковины, крыша и дно, перегородка.
  bx(xf, [-0.55, 0.1, 0], [0.55, 2.0, 0.03], MAT.veneer, [0.4, 0.37, 0.34]);
  bx(xf, [-0.55, 0.1, 0.03], [-0.5, 2.0, D], MAT.veneer, wood, { aoBottom: 0.6 });
  bx(xf, [0.5, 0.1, 0.03], [0.55, 2.0, D], MAT.veneer, wood, { aoBottom: 0.6 });
  bx(xf, [-0.57, 1.96, 0], [0.57, 2.0, 0.47], MAT.veneer, dim(wood, 1.1));
  bx(xf, [-0.5, 0.1, 0.03], [0.5, 0.14, D], MAT.veneer, dim(wood, 0.8));
  bx(xf, [-0.02, 0.14, 0.03], [0.02, 1.96, D], MAT.veneer, wood);
  // Закрытая дверца с двумя филёнками и латунной ручкой.
  bx(xf, [-0.5, 0.14, D], [-0.02, 1.96, D + 0.03], MAT.veneer, dim(wood, 1.15));
  bx(xf, [-0.44, 0.26, D + 0.03], [-0.08, 0.92, D + 0.045], MAT.veneer, dim(wood, 0.85));
  bx(xf, [-0.44, 1.04, D + 0.03], [-0.08, 1.88, D + 0.045], MAT.veneer, dim(wood, 0.85));
  xf.cyl([-0.07, 1.0, D + 0.03], 'z', 0.04, 0.025, MAT.brass, { segments: 6, tint: [1.4, 1.3, 1.1] });
  // Правая дверца распахнута почти на пол-оборота и лежит вдоль правого бока.
  beam(xf, [0.57, 1.05, D + 0.02], [0.62, 1.05, 0.0], 1.86, 0.035, MAT.veneer, dim(wood, 1.15), { side: UP });
  // Внутри: штанга, плечики с одеждой, нижняя полка со стопками.
  bx(xf, [0.02, 1.72, 0.2], [0.5, 1.75, 0.24], MAT.steel, [1.3, 1.3, 1.3]);
  const cl: Array<[number, number, number, Vec3, number]> = [
    [0.06, 0.78, 1.72, [1.4, 1.1, 1.1], MAT.paintRed],
    [0.18, 1.0, 1.72, [1.2, 1.3, 1.5], MAT.paintBlue],
    [0.3, 0.7, 1.72, [1.5, 1.3, 0.8], MAT.paintOchre],
    [0.41, 1.1, 1.72, [1.3, 1.3, 1.2], MAT.paper],
  ];
  for (const [x, y0, y1, t, m] of cl) bx(xf, [x, y0, 0.14], [x + 0.1, y1, 0.3], m, t);
  bx(xf, [0.03, 0.48, 0.04], [0.49, 0.51, 0.42], MAT.veneer, dim(wood, 0.9));
  bx(xf, [0.06, 0.51, 0.1], [0.26, 0.68, 0.38], MAT.paper, [1.3, 1.25, 1.0]);
  bx(xf, [0.28, 0.51, 0.1], [0.46, 0.62, 0.38], MAT.paintBlue, [1.2, 1.3, 1.5]);
  // Чемодан наверху: светлая фибра, тёмная ручка, две застёжки.
  bx(xf, [-0.35, 2.0, 0.07], [0.2, 2.18, 0.4], MAT.cardboard, [1.2, 1.1, 0.95], { bevel: 0.015 });
  bx(xf, [-0.12, 2.18, 0.2], [0.0, 2.2, 0.27], MAT.bakelite, [1.3, 1.3, 1.3]);
  for (const x of [-0.27, 0.12]) bx(xf, [x, 2.07, 0.4], [x + 0.06, 2.13, 0.415], MAT.brass, [1.4, 1.3, 1.1]);
  xf.collider([-0.55, 0, 0], [0.55, 2.0, 0.47]);
}

/** Стеллаж с книгами 1,0 × 0,32 × 1,9: пять отсеков, пёстрые корешки. */
function bookshelf(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.0, 0.9, 0.8], 0.9 + rnd() * 0.2);
  bx(xf, [-0.5, 0, 0.0], [0.5, 1.9, 0.02], MAT.veneer, [0.4, 0.37, 0.34]);
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 0.47 : -0.5, 0, 0.02], [s > 0 ? 0.5 : -0.47, 1.9, 0.32], MAT.veneer, wood, { aoBottom: 0.6, skip: ['nz'] });
  const ys = [0.0, 0.38, 0.76, 1.14, 1.52, 1.88];
  for (const y of ys) bx(xf, [-0.47, y, 0.02], [0.47, y + 0.03, 0.32], MAT.veneer, dim(wood, 0.9), { skip: ['nz'] });
  const spines: Array<[number, Vec3]> = [
    [MAT.paintRed, [1.3, 1.1, 1.1]],
    [MAT.paintBlue, [1.2, 1.3, 1.5]],
    [MAT.paintGreen, [1.2, 1.4, 1.3]],
    [MAT.paintOchre, [1.5, 1.3, 0.9]],
    [MAT.paper, [1.4, 1.35, 1.1]],
    [MAT.bakelite, [1.5, 1.5, 1.5]],
  ];
  for (let r = 0; r < 5; r++) {
    const y0 = ys[r]! + 0.03;
    let x = -0.45;
    const stop = r === 4 ? rnd() * 0.3 : 0;
    while (x < 0.42 - stop) {
      const w = 0.055 + rnd() * 0.07;
      const h = 0.18 + rnd() * 0.14;
      const [m, t] = spines[Math.floor(rnd() * spines.length)]!;
      if (x + w > 0.45) break;
      bx(xf, [x, y0, 0.06], [x + w, y0 + h, 0.28], m, t, { skip: ['ny', 'nz'] });
      x += w + 0.004;
    }
  }
  xf.collider([-0.5, 0, 0], [0.5, 1.9, 0.32]);
}

/** Кровать 2,0 × 0,95 × 0,75: изголовье и спинка, скомканное одеяло, подушка. */
function bedHome(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.0, 0.9, 0.8], 0.9 + rnd() * 0.2);
  const blanket: Vec3 = rnd() < 0.5 ? [1.2, 1.3, 1.5] : [1.4, 1.0, 0.9];
  const bm = blanket[2] > 1.4 ? MAT.paintBlue : MAT.paintRed;
  for (const x of [-0.98, 0.9]) for (const z of [0.03, 0.87]) bx(xf, [x, 0, z], [x + 0.08, 0.2, z + 0.05], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [-1, 0.14, 0], [-0.94, 0.75, 0.95], MAT.wood, wood, { aoBottom: 0.6 });
  bx(xf, [0.94, 0.14, 0], [1, 0.52, 0.95], MAT.wood, wood, { aoBottom: 0.6 });
  bx(xf, [-0.94, 0.2, 0.0], [0.94, 0.28, 0.95], MAT.wood, dim(wood, 0.8));
  bx(xf, [-0.94, 0.28, 0.0], [0.94, 0.46, 0.95], MAT.canvas, [1.45, 1.45, 1.35], { bevel: 0.015 });
  // Одеяло: ком из трёх кусков, один край свисает.
  bx(xf, [-0.45, 0.46, 0.04], [0.92, 0.56, 0.9], bm, blanket, { bevel: 0.02 });
  bx(xf, [-0.1, 0.56, 0.18], [0.5, 0.66, 0.7], bm, dim(blanket, 1.1), { bevel: 0.02 });
  bx(xf, [0.2, 0.3, 0.9], [0.8, 0.56, 0.95], bm, dim(blanket, 0.9));
  // Подушка и простыня у изголовья.
  bx(xf, [-0.92, 0.46, 0.2], [-0.46, 0.62, 0.78], MAT.paper, [1.45, 1.4, 1.2], { bevel: 0.025 });
  xf.collider([-1, 0, 0], [1, 0.6, 0.95]);
}

/** Ковёр на стене 1,9 × 0,04 × 1,3: бордовое поле, кайма, ромбы-медальоны из плоских листов. */
function wallCarpet(xf: Xf): void {
  bx(xf, [-0.95, 0, 0], [0.95, 1.3, 0.02], MAT.canvas, [1.4, 0.4, 0.4]);
  const cream: Vec3 = [1.4, 1.3, 1.0];
  // Кайма: четыре полосы поверх поля.
  bx(xf, [-0.95, 0, 0.02], [0.95, 0.1, 0.03], MAT.paper, cream);
  bx(xf, [-0.95, 1.2, 0.02], [0.95, 1.3, 0.03], MAT.paper, cream);
  bx(xf, [-0.95, 0.1, 0.02], [-0.85, 1.2, 0.03], MAT.paper, cream);
  bx(xf, [0.85, 0.1, 0.02], [0.95, 1.2, 0.03], MAT.paper, cream);
  // Медальоны: большой посредине, два малых по бокам, вложенные ромбы разного цвета.
  diamond(xf, 0, 0.65, 0.42, 0.42, 0.034, MAT.paintOchre, [1.5, 1.2, 0.7]);
  diamond(xf, 0, 0.65, 0.3, 0.3, 0.036, MAT.paintBlue, [0.9, 1.0, 1.2]);
  diamond(xf, 0, 0.65, 0.15, 0.15, 0.038, MAT.paper, cream);
  for (const s of [-1, 1]) {
    diamond(xf, s * 0.66, 0.65, 0.17, 0.3, 0.034, MAT.paintOchre, [1.5, 1.2, 0.7]);
    diamond(xf, s * 0.66, 0.65, 0.08, 0.15, 0.036, MAT.paintBlue, [0.9, 1.0, 1.2]);
  }
  // Бахрома по нижнему краю.
  bx(xf, [-0.9, -0.0, 0.0], [0.9, 0.02, 0.035], MAT.paper, dim(cream, 0.8));
}

/** Ковёр на полу 2,0 × 1,4: поле, кайма, ромбы. */
function rug(xf: Xf): void {
  bx(xf, [-1, 0, -0.7], [1, 0.014, 0.7], MAT.canvas, [1.4, 0.45, 0.4]);
  const cream: Vec3 = [1.4, 1.3, 1.0];
  const y = 0.0165;
  // Кайма по периметру.
  flat(xf, -0.96, -0.66, 0.96, -0.56, y, MAT.paper, cream);
  flat(xf, -0.96, 0.56, 0.96, 0.66, y, MAT.paper, cream);
  flat(xf, -0.96, -0.56, -0.86, 0.56, y, MAT.paper, cream);
  flat(xf, 0.86, -0.56, 0.96, 0.56, y, MAT.paper, cream);
  lozenge(xf, 0, 0, 0.62, 0.42, y + 0.001, MAT.paintOchre, [1.5, 1.2, 0.7]);
  lozenge(xf, 0, 0, 0.44, 0.29, y + 0.002, MAT.paintBlue, [0.9, 1.0, 1.2]);
  lozenge(xf, 0, 0, 0.22, 0.15, y + 0.003, MAT.paper, cream);
  for (const s of [-1, 1]) lozenge(xf, s * 0.74, 0, 0.1, 0.2, y + 0.002, MAT.paintOchre, [1.5, 1.2, 0.7]);
  // Бахрома на коротких краях.
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 1 : -1.0, 0, -0.62], [s > 0 ? 1.0 : -1.0, 0.012, 0.62], MAT.paper, dim(cream, 0.8));
}

/** Торшер 0,45 × 0,45 × 1,65: диск-основание, стойка, абажур. */
function floorLamp(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cx = 0;
  const cz = 0.225;
  xf.cyl([cx, 0, cz], 'y', 0.04, 0.17, MAT.castIron, { segments: 8, tint: [0.9, 0.9, 0.9] });
  xf.cyl([cx, 0.04, cz], 'y', 1.2, 0.022, MAT.brass, { segments: 6, tint: [1.2, 1.1, 0.9] });
  xf.cyl([cx, 1.24, cz], 'y', 0.04, 0.05, MAT.brass, { segments: 6, tint: [1.2, 1.1, 0.9] });
  // Абажур: широкий усечённый конус, красный ободок снизу.
  const shade: Vec3 = rnd() < 0.5 ? [1.45, 1.35, 1.0] : [1.4, 1.1, 0.9];
  xf.cyl([cx, 1.28, cz], 'y', 0.37, 0.215, MAT.paper, { segments: 8, tint: shade, radiusEnd: 0.13 });
  xf.cyl([cx, 1.28, cz], 'y', 0.035, 0.22, MAT.paintRed, { segments: 8, tint: [1.2, 1.0, 1.0], caps: false });
  xf.collider([-0.18, 0, cz - 0.18], [0.18, 1.65, cz + 0.18]);
}

/** Зеркало 0,55 × 0,05 × 1,25 в раме. */
function mirror(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const gold: Vec3 = dim([1.3, 1.15, 0.85], 0.9 + rnd() * 0.2);
  bx(xf, [-0.275, 0, 0], [0.275, 0.09, 0.05], MAT.brass, gold);
  bx(xf, [-0.275, 1.16, 0], [0.275, 1.25, 0.05], MAT.brass, gold);
  bx(xf, [-0.275, 0.09, 0], [-0.2, 1.16, 0.05], MAT.brass, gold);
  bx(xf, [0.2, 0.09, 0], [0.275, 1.16, 0.05], MAT.brass, gold);
  bx(xf, [-0.2, 0.09, 0], [0.2, 1.16, 0.03], MAT.glass, [1.1, 1.1, 1.1]);
  // Наверху резной гребень рамы.
  diamond(xf, 0, 1.25, 0.1, 0.05, 0.03, MAT.brass, gold);
  // Блик: две косые полосы.
  sheet(xf, [-0.15, 0.3, 0.032], [-0.07, 0.3, 0.032], [0.1, 0.95, 0.032], [0.02, 0.95, 0.032], FRONT, MAT.enamel, [0.8, 0.85, 0.8]);
  sheet(xf, [0.0, 0.3, 0.032], [0.04, 0.3, 0.032], [0.15, 0.7, 0.032], [0.11, 0.7, 0.032], FRONT, MAT.enamel, [0.7, 0.75, 0.7]);
}

/** Ванна на ножках 1,6 × 0,72 × 1,9: смеситель, штанга с полуотдёрнутой шторкой. */
function bathtub(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const curt: Vec3 = [1.45, 1.4, 1.2];
  const cm = MAT.paper;
  const dots: Vec3 = rnd() < 0.5 ? [1.5, 1.1, 1.0] : [1.5, 1.35, 0.8];
  // Ножки-лапы.
  for (const x of [-0.74, 0.66]) for (const z of [0.06, 0.58]) bx(xf, [x, 0, z], [x + 0.08, 0.18, z + 0.08], MAT.castIron, [1.0, 1.0, 1.0], { aoBottom: 0.6 });
  // Корпус: дно, борта, торцы. Внутри чуть темнее.
  bx(xf, [-0.8, 0.18, 0], [0.8, 0.26, 0.72], MAT.enamel, [1.0, 1.0, 0.95]);
  bx(xf, [-0.8, 0.26, 0.64], [0.8, 0.6, 0.72], MAT.enamel, [1.1, 1.1, 1.05]);
  bx(xf, [-0.8, 0.26, 0], [0.8, 0.6, 0.08], MAT.enamel, [1.1, 1.1, 1.05]);
  bx(xf, [-0.8, 0.26, 0.08], [-0.72, 0.6, 0.64], MAT.enamel, [1.1, 1.1, 1.05]);
  bx(xf, [0.72, 0.26, 0.08], [0.8, 0.6, 0.64], MAT.enamel, [1.1, 1.1, 1.05]);
  flat(xf, -0.72, 0.08, 0.72, 0.64, 0.262, MAT.enamel, [0.65, 0.7, 0.7]);
  // Смеситель на дальнем борту: корпус, носик над ванной и два красно-синих вентиля.
  bx(xf, [-0.62, 0.6, 0.0], [-0.42, 0.7, 0.07], MAT.steel, [1.5, 1.5, 1.5]);
  beam(xf, [-0.52, 0.68, 0.04], [-0.52, 0.68, 0.24], 0.05, 0.05, MAT.steel, [1.5, 1.5, 1.5]);
  bx(xf, [-0.66, 0.7, 0.0], [-0.6, 0.77, 0.06], MAT.paintRed, [1.5, 1.2, 1.2]);
  bx(xf, [-0.44, 0.7, 0.0], [-0.38, 0.77, 0.06], MAT.paintBlue, [1.3, 1.4, 1.5]);
  // Рама под шторку: две стойки по краям и штанга.
  for (const x of [-0.8, 0.76]) bx(xf, [x, 0.55, 0.62], [x + 0.04, 1.9, 0.66], MAT.steel, [1.4, 1.4, 1.4]);
  bx(xf, [-0.8, 1.85, 0.62], [0.8, 1.9, 0.66], MAT.steel, [1.4, 1.4, 1.4]);
  // Шторка: складки сдвинуты вправо, зигзаг по z.
  for (let i = 0; i < 5; i++) {
    const x = 0.0 + i * 0.16;
    const z = i % 2 === 0 ? 0.665 : 0.7;
    bx(xf, [x, 0.55, z], [x + 0.16, 1.85, z + 0.02], cm, curt);
    if (i % 2 === 0) bx(xf, [x + 0.03, 0.9, z + 0.02], [x + 0.13, 1.0, z + 0.025], MAT.paintRed, dots);
    else bx(xf, [x + 0.03, 1.3, z + 0.02], [x + 0.13, 1.4, z + 0.025], MAT.paintRed, dots);
  }
  xf.collider([-0.8, 0, 0], [0.8, 0.6, 0.72]);
}

/** Стиральная машина 0,6 × 0,56 × 0,86: круглый люк, панель с ручкой. */
function washingMachine(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const body: Vec3 = dim([1.05, 1.05, 1.0], 0.92 + rnd() * 0.1);
  for (const x of [-0.26, 0.2]) bx(xf, [x, 0, 0.06], [x + 0.06, 0.04, 0.12], MAT.rubber);
  bx(xf, [-0.3, 0.03, 0], [0.3, 0.86, 0.5], MAT.enamel, dim(body, 0.9), { aoBottom: 0.6 });
  bx(xf, [-0.3, 0.03, 0.5], [0.3, 0.86, 0.52], MAT.enamel, body);
  // Панель управления: ящик для порошка, ручка программ, красная кнопка.
  bx(xf, [-0.26, 0.72, 0.52], [-0.04, 0.82, 0.54], MAT.bakelite, [1.5, 1.5, 1.5]);
  xf.cyl([0.12, 0.77, 0.52], 'z', 0.03, 0.045, MAT.bakelite, { segments: 8, tint: [1.4, 1.4, 1.4] });
  bx(xf, [0.115, 0.775, 0.549], [0.125, 0.815, 0.553], MAT.enamel, [1.4, 1.4, 1.4]);
  bx(xf, [0.2, 0.74, 0.52], [0.26, 0.8, 0.54], MAT.paintRed, [1.5, 1.2, 1.2]);
  // Люк: стальное кольцо, тёмное стекло, светлое бельё внутри.
  xf.cyl([0, 0.4, 0.52], 'z', 0.035, 0.215, MAT.steel, { segments: 10, tint: [1.45, 1.45, 1.45] });
  xf.cyl([0, 0.4, 0.555], 'z', 0.015, 0.16, MAT.glass, { segments: 10, tint: [1.1, 1.1, 1.1] });
  xf.cyl([0.03, 0.37, 0.57], 'z', 0.004, 0.08, MAT.paintBlue, { segments: 6, tint: [1.2, 1.3, 1.5] });
  xf.collider([-0.3, 0, 0], [0.3, 0.86, 0.55]);
}

/** Унитаз с бачком 0,42 × 0,68 × 0,82: поднятая крышка, сиденье, кнопка слива. */
function toiletHome(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const seat: Vec3 = rnd() < 0.5 ? [1.3, 1.15, 0.95] : [1.0, 1.2, 1.4];
  const sm = seat[2] > 1.3 ? MAT.paintBlue : MAT.wood;
  bx(xf, [-0.19, 0.38, 0], [0.19, 0.8, 0.2], MAT.enamel, [1.1, 1.1, 1.05], { bevel: 0.015 });
  bx(xf, [-0.21, 0.78, 0], [0.21, 0.82, 0.22], MAT.enamel, [1.2, 1.2, 1.15]);
  bx(xf, [-0.13, 0, 0.2], [0.13, 0.28, 0.5], MAT.enamel, [1.0, 1.0, 0.95], { aoBottom: 0.6 });
  bx(xf, [-0.2, 0.28, 0.18], [0.2, 0.42, 0.68], MAT.enamel, [1.1, 1.1, 1.05], { bevel: 0.02 });
  // Сиденье с тёмной чашей; крышка стоит на бачке.
  bx(xf, [-0.2, 0.42, 0.24], [0.2, 0.45, 0.68], sm, seat);
  flat(xf, -0.1, 0.34, 0.1, 0.6, 0.452, MAT.bakelite);
  bx(xf, [-0.18, 0.45, 0.22], [0.18, 0.78, 0.25], sm, dim(seat, 1.1));
  bx(xf, [-0.04, 0.82, 0.07], [0.04, 0.85, 0.13], MAT.steel, [1.5, 1.5, 1.5]);
  xf.collider([-0.2, 0, 0], [0.2, 0.82, 0.68]);
}

/** Вешалка в прихожей 1,0 × 0,35 × 1,85: крючки, две куртки, полка для шапок, внизу обувь. */
function coatRack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.0, 0.9, 0.8], 0.9 + rnd() * 0.2);
  bx(xf, [-0.5, 0.05, 0], [0.5, 1.85, 0.03], MAT.wood, wood);
  bx(xf, [-0.5, 1.68, 0.0], [0.5, 1.72, 0.3], MAT.wood, dim(wood, 1.1));
  // Шапки на полке: красная, синяя, жёлтая.
  bx(xf, [-0.38, 1.72, 0.08], [-0.16, 1.85, 0.26], MAT.paintRed, [1.5, 1.2, 1.2], { bevel: 0.02 });
  bx(xf, [-0.06, 1.72, 0.1], [0.16, 1.82, 0.26], MAT.paintBlue, [1.3, 1.4, 1.5], { bevel: 0.02 });
  bx(xf, [0.26, 1.72, 0.08], [0.46, 1.84, 0.26], MAT.paintOchre, [1.5, 1.3, 0.9], { bevel: 0.02 });
  // Крючки.
  for (const x of [-0.4, -0.2, 0.0, 0.2, 0.4]) bx(xf, [x - 0.015, 1.5, 0.03], [x + 0.015, 1.54, 0.12], MAT.brass, [1.4, 1.3, 1.1]);
  // Куртки: тёмно-зелёная и красная, у каждой рукав сбоку.
  bx(xf, [-0.4, 0.72, 0.06], [-0.1, 1.5, 0.2], MAT.canvas, [0.7, 1.1, 0.8], { bevel: 0.015 });
  bx(xf, [-0.46, 0.8, 0.08], [-0.4, 1.35, 0.18], MAT.canvas, [0.7, 1.1, 0.8]);
  bx(xf, [0.06, 0.78, 0.06], [0.36, 1.5, 0.2], MAT.paintRed, [1.4, 1.1, 1.1], { bevel: 0.015 });
  bx(xf, [0.36, 0.86, 0.08], [0.42, 1.4, 0.18], MAT.paintRed, [1.4, 1.1, 1.1]);
  // Внизу поддон и две пары обуви: сапоги и светлые кеды.
  bx(xf, [-0.45, 0, 0.02], [0.45, 0.04, 0.33], MAT.rubber, [1.3, 1.3, 1.3]);
  for (const x of [-0.38, -0.24]) {
    bx(xf, [x - 0.05, 0.04, 0.06], [x + 0.05, 0.12, 0.3], MAT.paintOchre, [1.4, 1.2, 0.8]);
    bx(xf, [x - 0.05, 0.12, 0.06], [x + 0.05, 0.3, 0.16], MAT.paintOchre, [1.4, 1.2, 0.8]);
  }
  for (const x of [0.1, 0.26]) {
    bx(xf, [x - 0.05, 0.04, 0.06], [x + 0.05, 0.12, 0.3], MAT.paper, [1.45, 1.4, 1.2], { bevel: 0.015 });
    bx(xf, [x - 0.05, 0.04, 0.28], [x + 0.05, 0.06, 0.3], MAT.rubber);
  }
  xf.collider([-0.5, 0, 0], [0.5, 1.85, 0.3]);
}

/** Письменный стол с компьютером 1,2 × 0,6 × 1,25: ЭЛТ-монитор светится, клавиатура, системный блок. */
function deskPc(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.05, 0.95, 0.85], 0.9 + rnd() * 0.2);
  const beige: Vec3 = [1.45, 1.4, 1.15];
  for (const x of [-0.6, 0.54]) for (const z of [0.0, 0.54]) bx(xf, [x, 0, z], [x + 0.06, 0.72, z + 0.06], MAT.wood, WOOD_DARK, { aoBottom: 0.6 });
  bx(xf, [-0.6, 0.72, 0], [0.6, 0.76, 0.6], MAT.wood, wood);
  // Тумба с ящиками справа.
  bx(xf, [0.3, 0.1, 0.02], [0.54, 0.72, 0.58], MAT.wood, dim(wood, 0.95), { aoBottom: 0.6 });
  for (const y of [0.15, 0.32, 0.5]) {
    bx(xf, [0.32, y, 0.58], [0.52, y + 0.15, 0.6], MAT.wood, dim(wood, 1.15));
    bx(xf, [0.38, y + 0.06, 0.6], [0.46, y + 0.09, 0.62], MAT.brass, [1.4, 1.3, 1.1]);
  }
  // Системный блок слева на полу.
  bx(xf, [-0.5, 0, 0.08], [-0.22, 0.42, 0.52], MAT.enamel, beige, { aoBottom: 0.6 });
  face(xf, -0.46, 0.28, -0.26, 0.34, 0.521, MAT.bakelite);
  face(xf, -0.46, 0.18, -0.26, 0.24, 0.521, MAT.bakelite);
  bx(xf, [-0.34, 0.06, 0.52], [-0.28, 0.1, 0.535], MAT.glow, [3, 12, 3]);
  // ЭЛТ-монитор: бежевый корпус с горбом, чёрная рамка, светящийся экран.
  bx(xf, [-0.1, 0.76, 0.14], [0.1, 0.8, 0.34], MAT.enamel, beige);
  bx(xf, [-0.3, 0.8, 0.3], [0.3, 1.22, 0.47], MAT.enamel, beige);
  bx(xf, [-0.2, 0.86, 0.06], [0.2, 1.14, 0.3], MAT.enamel, dim(beige, 0.9));
  bx(xf, [-0.26, 0.84, 0.47], [0.26, 1.18, 0.485], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [-0.22, 0.87, 0.485], [0.22, 1.15, 0.5], MAT.glow, [6, 9, 8]);
  bx(xf, [0.2, 0.83, 0.47], [0.27, 0.85, 0.49], MAT.glow, [3, 12, 3]);
  // Клавиатура: светлая плата, тёмный блок клавиш.
  bx(xf, [-0.3, 0.76, 0.48], [0.14, 0.785, 0.58], MAT.enamel, beige);
  bx(xf, [-0.27, 0.785, 0.5], [0.11, 0.795, 0.57], MAT.bakelite, [1.4, 1.4, 1.4]);
  xf.collider([-0.6, 0, 0], [0.6, 0.76, 0.6]);
}

/** Детская кроватка 1,2 × 0,65 × 0,95: прутья, матрас, одеяльце. */
function crib(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.45, 1.35, 1.15], 0.92 + rnd() * 0.12);
  const rail = MAT.wood;
  for (const x of [-0.6, 0.55]) for (const z of [0.0, 0.6]) bx(xf, [x, 0, z], [x + 0.05, 0.95, z + 0.05], rail, wood, { aoBottom: 0.6 });
  // Верхние и нижние перекладины спереди и на торцах.
  bx(xf, [-0.6, 0.86, 0.6], [0.6, 0.92, 0.65], rail, wood);
  bx(xf, [-0.6, 0.26, 0.6], [0.6, 0.32, 0.65], rail, wood);
  for (const s of [-1, 1]) {
    bx(xf, [s * 0.575 - 0.025, 0.86, 0.05], [s * 0.575 + 0.025, 0.92, 0.6], rail, wood);
    bx(xf, [s * 0.575 - 0.025, 0.26, 0.05], [s * 0.575 + 0.025, 0.32, 0.6], rail, wood);
  }
  bx(xf, [-0.55, 0.3, 0.0], [0.55, 0.84, 0.03], rail, dim(wood, 0.8));
  // Прутья: на фасаде через 10 см, на торцах через 12 см.
  for (let x = -0.5; x < 0.55; x += 0.1) bx(xf, [x - 0.012, 0.32, 0.615], [x + 0.012, 0.86, 0.64], rail, wood, { skip: ['ny', 'py'] });
  for (const s of [-1, 1]) for (let z = 0.17; z < 0.58; z += 0.14) bx(xf, [s * 0.575 - 0.012, 0.32, z], [s * 0.575 + 0.012, 0.86, z + 0.024], rail, wood, { skip: ['ny', 'py'] });
  // Матрас, одеяльце, мишка-подушка.
  bx(xf, [-0.55, 0.3, 0.03], [0.55, 0.38, 0.6], MAT.canvas, [1.45, 1.4, 1.3]);
  bx(xf, [-0.1, 0.38, 0.1], [0.5, 0.44, 0.55], MAT.paintBlue, [1.3, 1.4, 1.5], { bevel: 0.015 });
  xf.collider([-0.6, 0, 0], [0.6, 0.95, 0.65]);
}

/** Куча игрушек 1,0 × 0,6 × 0,45: кубики, пирамидка, мяч, машинка. */
function toyHeap(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const jit = (): number => (rnd() - 0.5) * 0.04;
  const cubes: Array<[number, number, number, number, Vec3, number]> = [
    [-0.4, 0.0, 0.1, 0.14, [1.5, 1.2, 1.2], MAT.paintRed],
    [-0.23, 0.0, 0.14, 0.14, [1.3, 1.4, 1.5], MAT.paintBlue],
    [-0.35, 0.14, 0.13 + jit(), 0.14, [1.5, 1.3, 0.8], MAT.paintOchre],
    [-0.12, 0.0, 0.4, 0.14, [1.2, 1.4, 1.3], MAT.paintGreen],
  ];
  for (const [x, y, z, s, t, m] of cubes) bx(xf, [x, y, z], [x + s, y + s, z + s], m, t, { bevel: 0.01 });
  // Пирамидка: четыре кольца разного цвета и шарик на верхушке.
  const px = 0.12;
  const pz = 0.3;
  const rings: Array<[number, number, Vec3, number]> = [
    [0.15, 0.0, [1.5, 1.2, 1.2], MAT.paintRed],
    [0.12, 0.07, [1.5, 1.3, 0.8], MAT.paintOchre],
    [0.09, 0.14, [1.3, 1.4, 1.5], MAT.paintBlue],
    [0.06, 0.21, [1.2, 1.4, 1.3], MAT.paintGreen],
  ];
  for (const [r, y, t, m] of rings) xf.cyl([px, y, pz], 'y', 0.07, r, m, { segments: 6, tint: t });
  blob(xf, [px, 0.31, pz], 0.045, MAT.enamel, [1.4, 1.4, 1.3], 6);
  // Мяч.
  blob(xf, [0.36, 0.1, 0.18], 0.1, MAT.paintBlue, [1.3, 1.4, 1.5], 6);
  // Машинка: красный кузов, светлая кабина, четыре колеса-кубика.
  bx(xf, [0.0, 0.04, 0.46], [0.3, 0.12, 0.58], MAT.paintRed, [1.5, 1.2, 1.2]);
  bx(xf, [0.08, 0.12, 0.47], [0.24, 0.2, 0.57], MAT.paper, [1.4, 1.35, 1.1]);
  for (const x of [0.03, 0.22]) for (const z of [0.455, 0.565]) bx(xf, [x, 0, z], [x + 0.07, 0.07, z + 0.03], MAT.rubber, [1.3, 1.3, 1.3]);
  xf.collider([-0.45, 0, 0.05], [0.45, 0.3, 0.6]);
}

/** Напольная сушилка 1,4 × 0,55 × 1,0 с бельём. */
function clothesDryer(xf: Xf): void {
  const st: Vec3 = [1.4, 1.4, 1.4];
  // Две А-образные торцевые рамы: ножки сходятся к верхней планке.
  for (const s of [-1, 1]) {
    const x = s * 0.66;
    beam(xf, [x, 0.0, 0.05], [x, 0.95, 0.2], 0.035, 0.035, MAT.steel, st, { side: [1, 0, 0] });
    beam(xf, [x, 0.0, 0.5], [x, 0.95, 0.35], 0.035, 0.035, MAT.steel, st, { side: [1, 0, 0] });
  }
  // Планки вдоль: верхний ярус и средний.
  for (const z of [0.2, 0.35]) bx(xf, [-0.67, 0.93, z - 0.015], [0.67, 0.96, z + 0.015], MAT.steel, st);
  for (const z of [0.15, 0.4]) bx(xf, [-0.67, 0.58, z - 0.015], [0.67, 0.61, z + 0.015], MAT.steel, st);
  // Бельё: синее полотенце, красная футболка, белая простыня — перекинуты через верхние планки.
  const drape = (x0: number, x1: number, y0: number, mat: number, t: Vec3): void => {
    bx(xf, [x0, 0.96, 0.17], [x1, 0.98, 0.38], mat, t);
    bx(xf, [x0, y0, 0.37], [x1, 0.98, 0.395], mat, t);
    bx(xf, [x0, y0 + 0.1, 0.16], [x1, 0.98, 0.18], mat, dim(t, 0.9));
  };
  drape(-0.62, -0.2, 0.45, MAT.paintBlue, [1.2, 1.3, 1.5]);
  drape(-0.14, 0.2, 0.55, MAT.paintRed, [1.5, 1.2, 1.2]);
  drape(0.26, 0.62, 0.35, MAT.paper, [1.45, 1.4, 1.2]);
  // Рукава футболки.
  bx(xf, [-0.2, 0.7, 0.37], [-0.14, 0.97, 0.395], MAT.paintRed, [1.5, 1.2, 1.2]);
  bx(xf, [0.2, 0.7, 0.37], [0.26, 0.97, 0.395], MAT.paintRed, [1.5, 1.2, 1.2]);
  xf.collider([-0.7, 0, 0.02], [0.7, 1.0, 0.53]);
}

/** Гладильная доска 1,2 × 0,4 × 0,9: суженный нос, Х-образные ножки, подпалина, рубашка. */
function ironingBoard(xf: Xf): void {
  const st: Vec3 = [1.4, 1.4, 1.4];
  const cover: Vec3 = [1.45, 1.4, 1.1];
  bx(xf, [-0.3, 0.8, 0.02], [0.6, 0.84, 0.38], MAT.canvas, cover);
  bx(xf, [-0.5, 0.8, 0.08], [-0.3, 0.84, 0.32], MAT.canvas, cover);
  bx(xf, [-0.6, 0.8, 0.14], [-0.5, 0.84, 0.26], MAT.canvas, cover);
  // Подпалина-утюжок.
  sheet(xf, [0.1, 0.8405, 0.1], [0.3, 0.8405, 0.2], [0.1, 0.8405, 0.3], [0.1, 0.8405, 0.1], UP, MAT.rubber, [1.2, 1.1, 1.0]);
  // Рубашка, наполовину отглаженная.
  bx(xf, [0.3, 0.84, 0.06], [0.58, 0.855, 0.34], MAT.paintBlue, [1.3, 1.4, 1.5]);
  bx(xf, [0.5, 0.855, 0.06], [0.58, 0.865, 0.2], MAT.paintBlue, [1.2, 1.3, 1.4]);
  // Ножки крестом и подпятники.
  for (const z of [0.1, 0.3]) {
    beam(xf, [-0.35, 0.8, z], [0.4, 0.02, z], 0.04, 0.025, MAT.steel, st, { side: [0, 0, 1] });
    beam(xf, [0.4, 0.8, z], [-0.35, 0.02, z], 0.04, 0.025, MAT.steel, st, { side: [0, 0, 1] });
  }
  for (const x of [-0.38, 0.38]) bx(xf, [x - 0.04, 0, 0.06], [x + 0.04, 0.03, 0.34], MAT.rubber, [1.3, 1.3, 1.3]);
  xf.collider([-0.6, 0, 0.02], [0.6, 0.86, 0.38]);
}

/** Чугунная батарея 0,9 × 0,14 × 0,6 на стене: восемь секций, подводки, красный кран. */
function radiator(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const white: Vec3 = dim([1.2, 1.2, 1.15], 0.92 + rnd() * 0.1);
  bx(xf, [-0.45, 0.02, 0.0], [0.45, 0.58, 0.03], MAT.bakelite, [1.2, 1.2, 1.2]);
  for (let i = 0; i < 8; i++) {
    const x = -0.45 + i * 0.1125;
    bx(xf, [x + 0.008, 0.04, 0.03], [x + 0.1, 0.56, 0.12], MAT.enamel, white, { skip: ['nz'] });
  }
  bx(xf, [-0.45, 0.56, 0.02], [0.45, 0.6, 0.13], MAT.enamel, dim(white, 0.9));
  bx(xf, [-0.45, 0.0, 0.02], [0.45, 0.04, 0.13], MAT.enamel, dim(white, 0.9));
  bx(xf, [0.36, 0.5, 0.08], [0.45, 0.58, 0.14], MAT.paintRed, [1.5, 1.2, 1.2]);
  bx(xf, [-0.43, 0.02, 0.0], [-0.39, 0.06, 0.1], MAT.steel, [1.4, 1.4, 1.4]);
}

/** Окно в никуда 1,3 × 0,14 × 1,45: переплёт, подоконник, шторы; за стеклом ровное бледное свечение. */
function windowFake(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const frame: Vec3 = dim([0.85, 0.75, 0.65], 0.9 + rnd() * 0.2);
  const curt: Vec3 = rnd() < 0.5 ? [1.0, 0.55, 0.55] : [0.6, 1.0, 0.85];
  const cm = curt[0] > 0.9 ? MAT.paintRed : MAT.paintGreen;
  // Стёкла: шесть светящихся листов, чуть глубже рамы.
  const cols: Array<[number, number]> = [[-0.55, -0.025], [0.025, 0.55]];
  const rows: Array<[number, number]> = [[0.1, 0.46], [0.5, 0.88], [0.92, 1.33]];
  for (const [a, b] of cols) for (const [c, d] of rows) face(xf, a, c, b, d, 0.02, MAT.glow, [10, 10, 9]);
  // Рама, подоконник, переплёт.
  bx(xf, [-0.65, 0, 0], [0.65, 0.04, 0.14], MAT.wood, dim(frame, 1.2));
  bx(xf, [-0.6, 0.04, 0], [0.6, 0.1, 0.06], MAT.wood, frame);
  bx(xf, [-0.6, 1.33, 0], [0.6, 1.4, 0.06], MAT.wood, frame);
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 0.55 : -0.6, 0.1, 0], [s > 0 ? 0.6 : -0.55, 1.33, 0.06], MAT.wood, frame);
  bx(xf, [-0.025, 0.1, 0], [0.025, 1.33, 0.05], MAT.wood, frame);
  for (const y of [0.46, 0.88]) bx(xf, [-0.55, y, 0], [0.55, y + 0.04, 0.05], MAT.wood, frame);
  // Карниз и шторы по бокам, складки зигзагом.
  bx(xf, [-0.65, 1.4, 0.1], [0.65, 1.45, 0.14], MAT.steel, [1.3, 1.3, 1.3]);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x0 = s > 0 ? 0.41 + i * 0.08 : -0.65 + i * 0.08;
      const z = i % 2 === 0 ? 0.07 : 0.105;
      bx(xf, [x0, 0.1, z], [x0 + 0.08, 1.4, z + 0.03], cm, curt);
    }
  }
}

/** Фикус в кадке 0,5 × 0,5 × 1,3: ствол, ветки, крупные листья. */
function houseplant(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cx = 0;
  const cz = 0.25;
  // Кадка: широкая, с тёмным ободом и светлой землёй.
  xf.cyl([cx, 0, cz], 'y', 0.28, 0.17, MAT.brick, { segments: 8, radiusEnd: 0.22, tint: [1.45, 1.2, 1.1], caps: false });
  xf.cyl([cx, 0.28, cz], 'y', 0.05, 0.235, MAT.brick, { segments: 8, tint: [1.2, 1.0, 0.95], caps: false });
  xf.cyl([cx, 0.33, cz], 'y', 0.01, 0.21, MAT.dirt, { segments: 8, tint: [1.2, 1.2, 1.2] });
  xf.cyl([cx, 0.34, cz], 'y', 0.6, 0.045, MAT.wood, { segments: 5, tint: [1.0, 0.9, 0.8], radiusEnd: 0.03 });
  // Листья: светлая бумага, окрашенная в зелёный, — на тёмном фоне читается сразу.
  const green: Vec3 = [0.75, 1.5, 0.65];
  const N = 40;
  for (let i = 0; i < N; i++) {
    const ang = rnd() * Math.PI * 2;
    const pitch = -0.25 + rnd() * 0.75;
    const y = 0.55 + (i / N) * 0.62 + rnd() * 0.05;
    const rb = 0.015 + rnd() * 0.03;
    const len = 0.22 - (y > 1.05 ? 0.04 : 0);
    const dir: Vec3 = [Math.cos(ang) * Math.cos(pitch), Math.sin(pitch), Math.sin(ang) * Math.cos(pitch)];
    const side: Vec3 = [-Math.sin(ang), 0, Math.cos(ang)];
    const base: Vec3 = [cx + Math.cos(ang) * rb, y, cz + Math.sin(ang) * rb];
    const at = (k: number, s: number): Vec3 => [base[0] + dir[0] * len * k + side[0] * s, base[1] + dir[1] * len * k, base[2] + dir[2] * len * k + side[2] * s];
    const n: Vec3 = [dir[1] * side[2] - dir[2] * side[1], dir[2] * side[0] - dir[0] * side[2], dir[0] * side[1] - dir[1] * side[0]];
    const t = dim(green, 0.8 + rnd() * 0.3);
    sheet(xf, at(0, 0), at(0.45, 0.085), at(1, 0), at(0.45, -0.085), n, MAT.paper, t);
    sheet(xf, at(0, 0), at(0.45, 0.085), at(1, 0), at(0.45, -0.085), [-n[0], -n[1], -n[2]], MAT.paper, dim(t, 0.75));
  }
  xf.collider([-0.2, 0, cz - 0.2], [0.2, 1.0, cz + 0.2]);
}

/** Люстра 0,7 × 0,7 × 0,55 с тремя плафонами; растёт вниз от потолка. */
function chandelier(xf: Xf): void {
  const brass: Vec3 = [1.4, 1.25, 1.0];
  const cx = 0;
  const cz = 0.35;
  xf.cyl([cx, -0.03, cz], 'y', 0.03, 0.08, MAT.brass, { segments: 8, tint: brass });
  xf.cyl([cx, -0.22, cz], 'y', 0.2, 0.012, MAT.steel, { segments: 4, tint: [1.2, 1.2, 1.2] });
  xf.cyl([cx, -0.32, cz], 'y', 0.1, 0.05, MAT.brass, { segments: 8, tint: brass, radiusEnd: 0.07 });
  xf.cyl([cx, -0.48, cz], 'y', 0.16, 0.012, MAT.brass, { segments: 4, tint: brass });
  blob(xf, [cx, -0.5, cz], 0.04, MAT.brass, brass, 6);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const ex = cx + Math.cos(a) * 0.25;
    const ez = cz + Math.sin(a) * 0.25;
    beam(xf, [cx, -0.28, cz], [ex, -0.3, ez], 0.03, 0.03, MAT.brass, brass, { side: UP });
    xf.cyl([ex, -0.36, ez], 'y', 0.06, 0.014, MAT.brass, { segments: 4, tint: brass });
    // Плафон: матовый колокольчик, светится тёплым.
    xf.cyl([ex, -0.55, ez], 'y', 0.18, 0.09, MAT.glow, { segments: 7, tint: [7, 5, 3], radiusEnd: 0.055 });
  }
}

/** Ёлка 1,0 × 1,0 × 1,8: четыре яруса, шары, звезда, коробки подарков. */
function christmasTree(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cx = 0;
  const cz = 0.5;
  const fir: Vec3 = [0.55, 1.3, 0.6];
  xf.cyl([cx, 0, cz], 'y', 0.2, 0.07, MAT.wood, { segments: 6, tint: WOOD_DARK });
  const tiers: Array<[number, number, number, number]> = [
    [0.14, 0.62, 0.5, 0.28],
    [0.52, 0.5, 0.4, 0.2],
    [0.9, 0.48, 0.3, 0.14],
    [1.28, 0.46, 0.2, 0.02],
  ];
  for (const [y, h, r0, r1] of tiers) xf.cyl([cx, y, cz], 'y', h, r0, MAT.canvas, { segments: 8, tint: fir, radiusEnd: r1, caps: false });
  // Шары на ярусах: красные, золотые, синие.
  const balls: Array<[number, Vec3, number]> = [
    [MAT.paintRed, [1.5, 1.2, 1.2], 0],
    [MAT.paintOchre, [1.5, 1.4, 0.9], 1],
    [MAT.paintBlue, [1.3, 1.4, 1.5], 2],
  ];
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < 12; i++) {
    const tier = tiers[Math.min(3, Math.floor(i / 3))]!;
    const t = 0.15 + (i % 3) * 0.25;
    const y = tier[0] + tier[1] * t;
    const r = tier[2] + (tier[3] - tier[2]) * t - 0.02;
    const a = a0 + i * 2.4;
    const [m, tint] = balls[i % 3]!;
    const bxp = cx + Math.cos(a) * r;
    const bzp = cz + Math.sin(a) * r;
    bx(xf, [bxp - 0.055, y - 0.055, bzp - 0.055], [bxp + 0.055, y + 0.055, bzp + 0.055], m, tint);
  }
  // Звезда на макушке: светящийся крест из листов в двух плоскостях.
  const sy = 1.66;
  const star: Vec3 = [12, 10, 3];
  diamond(xf, cx, sy, 0.11, 0.13, cz, MAT.glow, star);
  sheet(xf, [cx - 0.12, sy, cz], [cx, sy - 0.08, cz], [cx + 0.12, sy, cz], [cx, sy + 0.08, cz], FRONT, MAT.glow, star);
  sheet(xf, [cx - 0.12, sy, cz], [cx, sy + 0.08, cz], [cx + 0.12, sy, cz], [cx, sy - 0.08, cz], [0, 0, -1], MAT.glow, star);
  sheet(xf, [cx, sy - 0.13, cz], [cx, sy, cz + 0.11], [cx, sy + 0.13, cz], [cx, sy, cz - 0.11], [1, 0, 0], MAT.glow, star);
  sheet(xf, [cx, sy - 0.13, cz], [cx, sy, cz + 0.11], [cx, sy + 0.13, cz], [cx, sy, cz - 0.11], [-1, 0, 0], MAT.glow, star);
  sheet(xf, [cx, sy - 0.13, cz], [cx, sy, cz + 0.11], [cx, sy + 0.13, cz], [cx, sy, cz - 0.11], [0, 0, -1], MAT.glow, star);
  // Подарки у подножия с лентой крест-накрест.
  const gifts: Array<[number, number, number, number, number, Vec3, number]> = [
    [0.18, 0.7, 0.3, 0.2, 0.22, [1.5, 1.2, 1.2], MAT.paintRed],
    [-0.5, 0.62, 0.26, 0.24, 0.2, [1.3, 1.4, 1.5], MAT.paintBlue],
    [-0.1, 0.78, 0.22, 0.16, 0.2, [1.2, 1.4, 1.3], MAT.paintGreen],
  ];
  for (const [x, z, w, h, d, t, m] of gifts) {
    bx(xf, [x, 0, z], [x + w, h, z + d], m, t);
    bx(xf, [x + w / 2 - 0.02, 0, z - 0.004], [x + w / 2 + 0.02, h + 0.004, z + d + 0.004], MAT.paintOchre, [1.5, 1.4, 0.9]);
    bx(xf, [x - 0.004, h - 0.004, z + d / 2 - 0.02], [x + w + 0.004, h + 0.004, z + d / 2 + 0.02], MAT.paintOchre, [1.5, 1.4, 0.9]);
  }
  xf.collider([-0.45, 0, 0.05], [0.45, 1.2, 0.95]);
}

/** Дверная створка с филёнками: общий вид для стоящей и лежащей. Здесь — стоящая (прислонена к стене). */
function doorLean(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cream: Vec3 = rnd() < 0.5 ? [1.4, 1.35, 1.1] : [1.1, 1.4, 1.3];
  const dm = cream[2] > 1.25 ? MAT.plaster : MAT.paintGreen;
  const sn = 0.14;
  const cs = Math.sqrt(1 - sn * sn);
  const z0 = 0.26;
  /** Точка створки: x, s — вдоль полотна снизу вверх, w — от тыльной грани наружу. */
  const P = (x: number, s: number, w: number): Vec3 => [x, s * cs + w * sn, z0 - s * sn + w * cs];
  const slope: Vec3 = [0, cs, -sn];
  const dark = dim(cream, 0.55);
  // Тёмная вставка под рамой.
  sheet(xf, P(-0.45, 0.02, 0.03), P(0.45, 0.02, 0.03), P(0.45, 2.04, 0.03), P(-0.45, 2.04, 0.03), [0, sn, cs], dm, dark);
  for (const x of [-0.39, 0.39]) beam(xf, P(x, 0, 0.02), P(x, 2.05, 0.02), 0.12, 0.04, dm, cream, { side: [1, 0, 0] });
  beam(xf, P(0, 0.2, 0.02), P(0, 1.9, 0.02), 0.1, 0.04, dm, cream, { side: [1, 0, 0] });
  for (const [s, w] of [[1.975, 0.15], [1.0, 0.12], [0.11, 0.22]] as const) beam(xf, P(-0.33, s, 0.02), P(0.33, s, 0.02), w, 0.04, dm, cream, { side: slope });
  // Филёнки: четыре выпуклых щита.
  for (const x of [-0.19, 0.19]) {
    for (const [s0, s1] of [[0.3, 0.88], [1.14, 1.82]] as const) beam(xf, P(x, s0, 0.04), P(x, s1, 0.04), 0.24, 0.016, dm, dim(cream, 0.72), { side: [1, 0, 0] });
  }
  // Ручка на правой стойке.
  beam(xf, P(0.36, 1.0, 0.04), P(0.36, 1.0, 0.11), 0.06, 0.06, MAT.brass, [1.4, 1.3, 1.1], { side: [1, 0, 0] });
  // Петли на левой стойке: пластина и вырванные шурупы торчат из неё.
  for (const s of [0.28, 1.0, 1.72]) {
    beam(xf, P(-0.45, s, 0.045), P(-0.35, s, 0.045), 0.12, 0.012, MAT.steel, [1.4, 1.4, 1.4], { side: slope });
    for (const ds of [-0.035, 0.035]) beam(xf, P(-0.4, s + ds, 0.05), P(-0.4, s + ds, 0.095), 0.016, 0.016, MAT.steel, [1.3, 1.3, 1.3], { side: [1, 0, 0], caps: false });
  }
  xf.collider([-0.475, 0, 0.02], [0.475, 2.05, 0.3]);
}

/** Такая же створка лежит на полу плашмя, лицом вверх. */
function doorDown(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cream: Vec3 = rnd() < 0.5 ? [1.4, 1.35, 1.1] : [1.1, 1.4, 1.3];
  const dm = cream[2] > 1.25 ? MAT.plaster : MAT.paintGreen;
  const dark = dim(cream, 0.75);
  bx(xf, [-0.45, 0, -1.0], [0.45, 0.05, 1.0], dm, dark);
  for (const x of [-0.39, 0.39]) bx(xf, [x - 0.06, 0.05, -1.0], [x + 0.06, 0.07, 1.0], dm, cream);
  bx(xf, [-0.05, 0.05, -0.8], [0.05, 0.07, 0.78], dm, cream);
  for (const [z, h] of [[-0.925, 0.075], [0.0, 0.06], [0.89, 0.11]] as const) bx(xf, [-0.33, 0.05, z - h], [0.33, 0.07, z + h], dm, cream);
  for (const x of [-0.19, 0.19]) {
    for (const [z0, z1] of [[-0.84, -0.08], [0.1, 0.78]] as const) bx(xf, [x - 0.12, 0.05, z0], [x + 0.12, 0.065, z1], dm, dim(cream, 0.92));
  }
  // Круглая ручка-розетка и петли с торчащими шурупами.
  xf.cyl([0.37, 0.07, 0.0], 'y', 0.01, 0.045, MAT.brass, { segments: 8, tint: [1.4, 1.3, 1.1] });
  for (const z of [-0.72, 0.0, 0.72]) {
    bx(xf, [-0.45, 0.07, z - 0.06], [-0.34, 0.075, z + 0.06], MAT.steel, [1.4, 1.4, 1.4]);
    for (const dz of [-0.035, 0.035]) bx(xf, [-0.41, 0.075, z + dz - 0.008], [-0.39, 0.08, z + dz + 0.008], MAT.steel, [1.3, 1.3, 1.3]);
  }
}

// ───────────────────────────── мелочь ─────────────────────────────

/** Эмалированный чайник: бочок, крышка с шишкой, носик, дужка. */
function kettle(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Корпус всегда светлый (на тёмном полу читается), цвет — в поясе и крышке.
  const body: Vec3 = rnd() < 0.5 ? [1.45, 1.4, 1.2] : [1.2, 1.4, 1.35];
  const accent: Vec3 = rnd() < 0.5 ? [1.0, 1.1, 1.4] : [1.5, 1.1, 1.0];
  const am = accent[2] > 1.3 ? MAT.paintBlue : MAT.paintRed;
  const dk: Vec3 = [1.3, 1.3, 1.3];
  xf.cyl([0, 0, 0], 'y', 0.08, 0.085, MAT.enamel, { segments: 8, tint: body, radiusEnd: 0.105 });
  xf.cyl([0, 0.08, 0], 'y', 0.1, 0.105, MAT.enamel, { segments: 8, tint: body, radiusEnd: 0.085, caps: false });
  xf.cyl([0, 0.07, 0], 'y', 0.035, 0.109, am, { segments: 8, tint: accent, caps: false });
  xf.cyl([0, 0.18, 0], 'y', 0.035, 0.085, am, { segments: 8, tint: accent, radiusEnd: 0.03 });
  xf.cyl([0, 0.215, 0], 'y', 0.04, 0.028, MAT.bakelite, { segments: 5, tint: dk });
  // Носик: крупный, тёмный кончик.
  beam(xf, [-0.08, 0.06, 0], [-0.13, 0.19, 0], 0.06, 0.06, MAT.enamel, body);
  beam(xf, [-0.12, 0.17, 0], [-0.15, 0.21, 0], 0.045, 0.045, MAT.bakelite, dk);
  // Дужка: толстая арка над крышкой.
  beam(xf, [-0.095, 0.15, 0], [-0.05, 0.285, 0], 0.035, 0.035, MAT.bakelite, dk, { side: UP, caps: false });
  beam(xf, [-0.05, 0.285, 0], [0.05, 0.285, 0], 0.035, 0.035, MAT.bakelite, dk, { side: UP, caps: false });
  beam(xf, [0.05, 0.285, 0], [0.095, 0.15, 0], 0.035, 0.035, MAT.bakelite, dk, { side: UP, caps: false });
}

/** Утюг со шнуром: стальная подошва, цветной корпус, ручка-арка. */
function iron(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const body: Vec3 = rnd() < 0.5 ? [1.4, 1.1, 1.0] : [1.2, 1.3, 1.5];
  const bm = body[0] > 1.3 ? MAT.paintRed : MAT.paintBlue;
  bx(xf, [-0.12, 0, -0.065], [0.08, 0.03, 0.065], MAT.steel, [1.45, 1.45, 1.45]);
  bx(xf, [0.08, 0, -0.045], [0.13, 0.03, 0.045], MAT.steel, [1.45, 1.45, 1.45]);
  bx(xf, [0.13, 0, -0.02], [0.15, 0.03, 0.02], MAT.steel, [1.45, 1.45, 1.45]);
  bx(xf, [-0.12, 0.03, -0.06], [0.07, 0.1, 0.06], bm, body, { bevel: 0.015 });
  bx(xf, [0.07, 0.03, -0.04], [0.12, 0.08, 0.04], bm, dim(body, 0.9));
  // Ручка: две стойки и перекладина.
  for (const x of [-0.1, 0.0]) bx(xf, [x, 0.1, -0.025], [x + 0.03, 0.15, 0.025], MAT.bakelite, [1.4, 1.4, 1.4]);
  bx(xf, [-0.1, 0.15, -0.03], [0.03, 0.18, 0.03], MAT.bakelite, [1.4, 1.4, 1.4]);
  // Шнур выходит сзади и уходит петлёй.
  beam(xf, [-0.12, 0.06, 0.0], [-0.15, 0.012, 0.04], 0.02, 0.02, MAT.rubber, [1.5, 1.5, 1.5], { caps: false });
  beam(xf, [-0.15, 0.012, 0.04], [-0.1, 0.012, 0.1 - 0.03], 0.02, 0.02, MAT.rubber, [1.5, 1.5, 1.5], { caps: false });
}

/** Смартфон экраном вверх: тёмный корпус, светящийся экран с цветными значками. */
function phone(xf: Xf): void {
  bx(xf, [-0.055, 0, -0.1], [0.055, 0.017, 0.1], MAT.bakelite, [1.4, 1.4, 1.4]);
  bx(xf, [-0.047, 0.017, -0.09], [0.047, 0.02, 0.092], MAT.glow, [9, 10, 12]);
  const icon = (x: number, z: number, t: Vec3): void => flat(xf, x, z, x + 0.026, z + 0.026, 0.0205, MAT.glow, t);
  icon(-0.04, -0.05, [12, 5, 3]);
  icon(-0.01, -0.05, [4, 12, 5]);
  icon(0.02, -0.05, [5, 6, 14]);
  icon(-0.04, -0.015, [14, 11, 3]);
  icon(-0.01, -0.015, [12, 4, 10]);
  bx(xf, [-0.02, 0.0175, 0.093], [0.02, 0.02, 0.099], MAT.steel, [1.5, 1.5, 1.5]);
}

/** Связка ключей: кольцо, три ключа веером, красный брелок. */
function keys(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fob: Vec3 = rnd() < 0.5 ? [1.5, 1.1, 1.1] : [1.3, 1.4, 1.5];
  const fm = fob[0] > 1.4 ? MAT.paintRed : MAT.paintBlue;
  const st: Vec3 = [1.5, 1.5, 1.5];
  const br: Vec3 = [1.5, 1.4, 1.0];
  for (const [z, m, t] of [[-0.036, MAT.steel, st], [0.0, MAT.brass, br], [0.036, MAT.paintOchre, [1.5, 1.4, 1.0] as Vec3]] as Array<[number, number, Vec3]>) {
    bx(xf, [-0.01, 0.012, z - 0.012], [0.078, 0.024, z + 0.012], m, t);
    bx(xf, [0.045, 0.012, z - 0.03], [0.065, 0.024, z - 0.012], m, t);
    bx(xf, [-0.03, 0.012, z - 0.018], [-0.005, 0.024, z + 0.018], m, t);
  }
  ring(xf, [-0.01, 0.006, 0], 'y', 0.036, 0.012, 6, MAT.steel, st);
  bx(xf, [-0.085, 0, -0.04], [-0.045, 0.03, 0.04], fm, fob, { bevel: 0.006 });
}

/** Плюшевый мишка сидит; одного глаза нет — на его месте крестик из ниток. */
function teddy(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const fur: Vec3 = rnd() < 0.5 ? [1.5, 1.2, 0.7] : [1.4, 1.0, 0.6];
  const light: Vec3 = [1.5, 1.4, 1.2];
  const dk: Vec3 = [1.3, 1.3, 1.3];
  // Туловище и голова: широкие усечённые конусы.
  xf.cyl([0, 0, -0.02], 'y', 0.16, 0.11, MAT.canvas, { segments: 7, tint: fur, radiusEnd: 0.13, caps: false });
  xf.cyl([0, 0.16, -0.02], 'y', 0.12, 0.13, MAT.canvas, { segments: 7, tint: fur, radiusEnd: 0.08, caps: false });
  xf.cyl([0, 0.24, 0.0], 'y', 0.1, 0.1, MAT.canvas, { segments: 7, tint: dim(fur, 1.05), radiusEnd: 0.11, caps: false });
  xf.cyl([0, 0.34, 0.0], 'y', 0.1, 0.11, MAT.canvas, { segments: 7, tint: dim(fur, 1.05), radiusEnd: 0.08 });
  // Уши — круглые диски по бокам макушки.
  for (const s of [-1, 1]) xf.cyl([s * 0.09, 0.41, -0.01], 'z', 0.04, 0.05, MAT.canvas, { segments: 6, tint: dim(fur, 0.9) });
  // Морда: светлая, с носом.
  xf.cyl([0, 0.3, 0.07], 'z', 0.06, 0.045, MAT.canvas, { segments: 6, tint: light });
  bx(xf, [-0.025, 0.315, 0.13], [0.025, 0.34, 0.15], MAT.bakelite, dk);
  // Глаз-пуговица один (слева), на месте второго — светлая заплатка с крестиком.
  xf.cyl([-0.045, 0.37, 0.085], 'z', 0.03, 0.03, MAT.bakelite, { segments: 6, tint: dk });
  face(xf, 0.02, 0.345, 0.07, 0.395, 0.093, MAT.paper, [1.4, 1.3, 1.1]);
  sheet(xf, [0.025, 0.35, 0.095], [0.032, 0.35, 0.095], [0.07, 0.39, 0.095], [0.063, 0.39, 0.095], FRONT, MAT.bakelite, dk);
  sheet(xf, [0.063, 0.35, 0.095], [0.07, 0.35, 0.095], [0.032, 0.39, 0.095], [0.025, 0.39, 0.095], FRONT, MAT.bakelite, dk);
  // Лапы: руки по бокам, ноги вперёд подошвами.
  for (const s of [-1, 1]) {
    bx(xf, [s * 0.135 - 0.035, 0.1, 0.0], [s * 0.135 + 0.035, 0.22, 0.08], MAT.canvas, dim(fur, 0.95));
    xf.cyl([s * 0.08, 0.055, 0.0], 'z', 0.15, 0.055, MAT.canvas, { segments: 6, tint: dim(fur, 0.95) });
    face(xf, s * 0.08 - 0.035, 0.03, s * 0.08 + 0.035, 0.08, 0.152, MAT.paper, light);
  }
}

/** Пара тапочек: тёмная подошва и яркий меховой носок. */
function slippers(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const top: Vec3 = rnd() < 0.5 ? [1.5, 0.7, 0.8] : [1.3, 1.4, 1.5];
  const tm = top[0] > 1.4 ? MAT.paintRed : MAT.paintBlue;
  for (const s of [-1, 1]) {
    const x = s * 0.085;
    const dz = s * 0.012;
    bx(xf, [x - 0.07, 0, -0.155 + dz], [x + 0.07, 0.025, 0.155 + dz], MAT.rubber, [1.4, 1.4, 1.4]);
    bx(xf, [x - 0.065, 0.025, 0.01 + dz], [x + 0.065, 0.085, 0.15 + dz], tm, top, { bevel: 0.02 });
    flat(xf, x - 0.05, -0.14 + dz, x + 0.05, 0.0 + dz, 0.0255, MAT.paper, [1.4, 1.3, 1.1]);
    bx(xf, [x - 0.04, 0.025, -0.15 + dz], [x + 0.04, 0.045, -0.12 + dz], tm, dim(top, 0.9));
  }
}

/** Будильник с двумя звонками: красный корпус, светлый циферблат, стрелки. */
function alarmClock(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const body: Vec3 = rnd() < 0.5 ? [1.5, 1.1, 1.0] : [1.2, 1.3, 1.5];
  const bm = body[0] > 1.4 ? MAT.paintRed : MAT.paintBlue;
  const st: Vec3 = [1.5, 1.5, 1.5];
  for (const s of [-1, 1]) bx(xf, [s * 0.05 - 0.015, 0, -0.02], [s * 0.05 + 0.015, 0.045, 0.01], MAT.rubber);
  xf.cyl([0, 0.1, -0.045], 'z', 0.075, 0.075, bm, { segments: 8, tint: body });
  xf.cyl([0, 0.1, 0.03], 'z', 0.008, 0.06, MAT.enamel, { segments: 8, tint: [1.45, 1.45, 1.35] });
  // Звонки сверху и молоточек между ними.
  for (const s of [-1, 1]) xf.cyl([s * 0.05, 0.16, -0.01], 'y', 0.04, 0.035, MAT.brass, { segments: 6, tint: [1.4, 1.3, 1.0], radiusEnd: 0.012 });
  bx(xf, [-0.05, 0.19, -0.015], [0.05, 0.2, -0.005], MAT.steel, st);
  // Стрелки (на циферблате z = 0.038).
  sheet(xf, [-0.006, 0.1, 0.039], [0.006, 0.1, 0.039], [0.006, 0.152, 0.039], [-0.006, 0.152, 0.039], FRONT, MAT.bakelite, [1.4, 1.4, 1.4]);
  sheet(xf, [-0.005, 0.1, 0.0391], [0.04, 0.12, 0.0391], [0.04, 0.13, 0.0391], [-0.005, 0.108, 0.0391], FRONT, MAT.bakelite, [1.4, 1.4, 1.4]);
  face(xf, -0.006, 0.145, 0.006, 0.158, 0.0385, MAT.paintRed, [1.5, 1.2, 1.2]);
}

/** Кружка: цветной бочок, тёмный чай, ручка. */
function mug(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const k = Math.floor(rnd() * 3);
  const col: Vec3 = k === 0 ? [1.5, 1.1, 1.0] : k === 1 ? [1.2, 1.3, 1.5] : [1.5, 1.35, 0.9];
  const cm = k === 0 ? MAT.paintRed : k === 1 ? MAT.paintBlue : MAT.paintOchre;
  xf.cyl([-0.02, 0, 0], 'y', 0.13, 0.056, cm, { segments: 8, tint: col, caps: false, radiusEnd: 0.06 });
  xf.cyl([-0.02, 0.0, 0], 'y', 0.004, 0.056, cm, { segments: 8, tint: col });
  xf.cyl([-0.02, 0.112, 0], 'y', 0.004, 0.058, MAT.bakelite, { segments: 8, tint: [1.3, 1.1, 0.9] });
  // Ручка: скоба из трёх брусков.
  bx(xf, [0.035, 0.09, -0.013], [0.08, 0.115, 0.013], cm, col);
  bx(xf, [0.035, 0.025, -0.013], [0.08, 0.05, 0.013], cm, col);
  bx(xf, [0.055, 0.05, -0.013], [0.08, 0.09, 0.013], cm, col);
}

/** Фоторамка на ножке: на карточке две фигуры, вместо лиц светлые пятна. */
function photoFrame(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const gold: Vec3 = dim([1.4, 1.25, 0.95], 0.9 + rnd() * 0.15);
  bx(xf, [-0.12, 0.03, -0.015], [0.12, 0.3, 0.02], MAT.brass, gold);
  bx(xf, [-0.07, 0.0, -0.03], [0.07, 0.03, 0.03], MAT.brass, dim(gold, 0.85));
  beam(xf, [0, 0.22, -0.015], [0, 0.0, -0.055], 0.03, 0.02, MAT.wood, WOOD_DARK, { side: [1, 0, 0] });
  // Карточка: тёплый фон, две тёмные фигуры, светлые пятна вместо лиц.
  face(xf, -0.09, 0.07, 0.09, 0.26, 0.0215, MAT.paper, [1.2, 1.0, 0.7]);
  bx(xf, [-0.08, 0.07, 0.02], [-0.01, 0.15, 0.0225], MAT.bakelite, [1.3, 1.3, 1.3]);
  bx(xf, [0.0, 0.07, 0.02], [0.08, 0.17, 0.0225], MAT.bakelite, [1.3, 1.3, 1.3]);
  for (const [x, y, r] of [[-0.045, 0.19, 0.03], [0.04, 0.215, 0.032]] as const) {
    face(xf, x - r, y - r, x + r, y + r, 0.023, MAT.glow, [5, 5, 4.5]);
    diamond(xf, x, y, r * 1.35, r * 1.35, 0.0231, MAT.glow, [5, 5, 4.5]);
  }
}

/** Дисковый телефон: красный корпус, светлый диск с отверстиями, трубка наверху. */
function rotaryPhone(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const body: Vec3 = rnd() < 0.5 ? [1.5, 1.1, 1.0] : [1.5, 1.35, 0.85];
  const bm = body[2] < 1.0 && body[1] > 1.2 ? MAT.paintOchre : MAT.paintRed;
  bx(xf, [-0.15, 0, -0.11], [0.15, 0.07, 0.11], bm, body, { bevel: 0.015, aoBottom: 0.7 });
  bx(xf, [-0.13, 0.07, -0.09], [0.13, 0.1, 0.09], bm, dim(body, 0.95));
  // Диск и отверстия.
  xf.cyl([0, 0.1, 0.03], 'y', 0.012, 0.065, MAT.enamel, { segments: 8, tint: [1.45, 1.45, 1.35] });
  xf.cyl([0, 0.112, 0.03], 'y', 0.004, 0.022, MAT.bakelite, { segments: 6, tint: [1.4, 1.4, 1.4] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 1.6 + 0.4;
    const hx = Math.cos(a) * 0.045;
    const hz = 0.03 + Math.sin(a) * 0.045;
    flat(xf, hx - 0.011, hz - 0.011, hx + 0.011, hz + 0.011, 0.1165, MAT.bakelite);
  }
  // Трубка лежит поперёк у задней кромки: две чашки и ручка.
  bx(xf, [-0.12, 0.11, -0.095], [0.12, 0.135, -0.06], MAT.bakelite, [1.4, 1.4, 1.4]);
  for (const x of [-0.14, 0.09]) bx(xf, [x, 0.1, -0.1], [x + 0.05, 0.16, -0.045], MAT.bakelite, [1.4, 1.4, 1.4]);
}

/** Ночник-гриб: светящаяся шляпка с белым пятном, светлая ножка. */
function nightLight(xf: Xf): void {
  xf.cyl([0, 0, 0], 'y', 0.025, 0.065, MAT.bakelite, { segments: 8, tint: [1.4, 1.4, 1.4] });
  xf.cyl([0, 0.025, 0], 'y', 0.08, 0.04, MAT.paper, { segments: 8, tint: [1.45, 1.4, 1.2], radiusEnd: 0.045 });
  xf.cyl([0, 0.105, 0], 'y', 0.045, 0.06, MAT.glow, { segments: 8, tint: [10, 6, 3], radiusEnd: 0.08 });
  xf.cyl([0, 0.15, 0], 'y', 0.035, 0.08, MAT.glow, { segments: 8, tint: [10, 6, 3], radiusEnd: 0.05 });
  xf.cyl([0, 0.185, 0], 'y', 0.012, 0.05, MAT.glow, { segments: 8, tint: [10, 6, 3] });
  xf.cyl([0, 0.196, 0], 'y', 0.004, 0.032, MAT.enamel, { segments: 6, tint: [1.5, 1.5, 1.4] });
}

/** Школьный ранец: цветной корпус, клапан с пряжкой, светлый карман. */
function schoolBag(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const k = Math.floor(rnd() * 3);
  const col: Vec3 = k === 0 ? [1.5, 1.1, 1.0] : k === 1 ? [1.2, 1.3, 1.5] : [1.2, 1.45, 1.25];
  const cm = k === 0 ? MAT.paintRed : k === 1 ? MAT.paintBlue : MAT.paintGreen;
  bx(xf, [-0.19, 0, -0.1], [0.19, 0.38, 0.08], cm, col, { bevel: 0.025, aoBottom: 0.7 });
  bx(xf, [-0.15, 0.03, 0.08], [0.15, 0.2, 0.115], MAT.paintOchre, [1.5, 1.3, 0.9], { bevel: 0.01 });
  bx(xf, [-0.185, 0.22, 0.07], [0.185, 0.4, 0.1], cm, dim(col, 0.8));
  bx(xf, [-0.03, 0.2, 0.1], [0.03, 0.26, 0.12], MAT.brass, [1.5, 1.4, 1.1]);
  bx(xf, [-0.18, 0.12, 0.08], [-0.15, 0.13, 0.1], MAT.paper, [1.5, 1.5, 1.4]);
  bx(xf, [-0.06, 0.39, -0.03], [0.06, 0.42, 0.01], MAT.bakelite, [1.4, 1.4, 1.4]);
}

/** Торт со свечами: коржи, глазурь, четыре свечи, кончики светятся. */
function birthdayCake(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const icing: Vec3 = rnd() < 0.5 ? [1.2, 0.85, 0.95] : [1.45, 1.4, 1.2];
  xf.cyl([0, 0, 0], 'y', 0.012, 0.15, MAT.enamel, { segments: 8, tint: [1.4, 1.4, 1.3] });
  xf.cyl([0, 0.012, 0], 'y', 0.075, 0.125, MAT.leather, { segments: 8, tint: [1.4, 1.1, 0.9] });
  xf.cyl([0, 0.087, 0], 'y', 0.03, 0.13, MAT.enamel, { segments: 8, tint: icing });
  const cols: Array<[number, Vec3]> = [
    [MAT.paintBlue, [1.3, 1.4, 1.5]],
    [MAT.paintOchre, [1.5, 1.3, 0.9]],
    [MAT.paintGreen, [1.2, 1.4, 1.3]],
    [MAT.paintRed, [1.5, 1.2, 1.2]],
  ];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.cos(a) * 0.06;
    const z = Math.sin(a) * 0.06;
    const [m, t] = cols[i]!;
    bx(xf, [x - 0.012, 0.117, z - 0.012], [x + 0.012, 0.17, z + 0.012], m, t, { skip: ['ny'] });
    bx(xf, [x - 0.011, 0.17, z - 0.011], [x + 0.011, 0.2, z + 0.011], MAT.glow, [12, 9, 3], { skip: ['ny'] });
  }
}

/** Мяч с полосой: белый, красный пояс, синие полюса. */
function ball(xf: Xf): void {
  const c: Vec3 = [0, 0.13, 0];
  const r = 0.13;
  const seg = 8;
  const blue: Vec3 = [1.3, 1.4, 1.5];
  const white: Vec3 = [1.45, 1.4, 1.25];
  band(xf, c, r, -90, -50, MAT.paintBlue, blue, seg);
  band(xf, c, r, -50, -25, MAT.enamel, white, seg);
  band(xf, c, r, -25, 25, MAT.paintRed, [1.5, 1.15, 1.1], seg);
  band(xf, c, r, 25, 50, MAT.enamel, white, seg);
  band(xf, c, r, 50, 90, MAT.paintBlue, blue, seg);
}

/** Круглый аквариум с рыжей рыбкой: стеклянные стенки, галька, водоросль; рыбка светится. */
function goldfishBowl(xf: Xf): void {
  const rim: Vec3 = [1.5, 1.5, 1.4];
  // Стекло дано каркасом: стенки сплошным тёмным стеклом превращали аквариум в чёрное ведро.
  xf.cyl([0, 0, 0], 'y', 0.03, 0.1, MAT.bakelite, { segments: 8, tint: [1.4, 1.4, 1.4] });
  xf.cyl([0, 0.03, 0], 'y', 0.02, 0.125, MAT.enamel, { segments: 8, tint: rim, caps: false });
  xf.cyl([0, 0.15, 0], 'y', 0.015, 0.15, MAT.enamel, { segments: 8, tint: rim, caps: false });
  xf.cyl([0, 0.255, 0], 'y', 0.02, 0.13, MAT.enamel, { segments: 8, tint: rim, caps: false });
  for (const [x, z] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]] as const) {
    bx(xf, [x - 0.01, 0.04, z - 0.01], [x + 0.01, 0.26, z + 0.01], MAT.enamel, rim);
  }
  // Галька, водоросль.
  xf.cyl([0, 0.03, 0], 'y', 0.025, 0.11, MAT.paintBlue, { segments: 8, tint: [1.3, 1.45, 1.5] });
  diamond(xf, -0.06, 0.13, 0.04, 0.08, 0.0, MAT.paper, [0.7, 1.5, 0.6]);
  sheet(xf, [-0.06, 0.055, -0.06], [-0.06, 0.055, 0.06], [-0.06, 0.2, 0.03], [-0.06, 0.2, -0.03], [1, 0, 0], MAT.paper, [0.7, 1.5, 0.6]);
  // Рыбка: туловище, хвост и плавник из листов, чёрный глаз.
  const fish: Vec3 = [9, 4, 1.2];
  bx(xf, [-0.02, 0.11, -0.04], [0.11, 0.2, 0.04], MAT.glow, fish);
  bx(xf, [-0.05, 0.13, -0.025], [-0.02, 0.18, 0.025], MAT.glow, fish);
  for (const n of [[0, 0, 1], [0, 0, -1]] as Vec3[]) {
    sheet(xf, [-0.05, 0.155, 0], [-0.13, 0.22, 0], [-0.13, 0.09, 0], [-0.05, 0.145, 0], n, MAT.glow, fish);
    sheet(xf, [0.0, 0.2, 0], [0.02, 0.255, 0], [0.075, 0.255, 0], [0.09, 0.2, 0], n, MAT.glow, fish);
  }
  bx(xf, [0.08, 0.16, 0.04], [0.105, 0.185, 0.05], MAT.bakelite, [1.4, 1.4, 1.4]);
}

/** Пульт от телевизора: тёмный корпус, цветные кнопки, красная «выкл». */
function remote(xf: Xf): void {
  bx(xf, [-0.035, 0, -0.11], [0.035, 0.025, 0.11], MAT.bakelite, [1.5, 1.5, 1.5], { bevel: 0.008 });
  flat(xf, -0.025, -0.1, 0.025, -0.06, 0.0256, MAT.paintRed, [1.5, 1.2, 1.2]);
  const keysM: Array<[number, Vec3]> = [
    [MAT.enamel, [1.5, 1.5, 1.4]],
    [MAT.paintBlue, [1.3, 1.4, 1.5]],
    [MAT.paintOchre, [1.5, 1.3, 0.9]],
    [MAT.paintGreen, [1.2, 1.45, 1.3]],
  ];
  let i = 0;
  for (let r = 0; r < 4; r++) {
    for (const x of [-0.025, 0.003]) {
      const [m, t] = keysM[(i++) % keysM.length]!;
      flat(xf, x, -0.045 + r * 0.037, x + 0.022, -0.045 + r * 0.037 + 0.027, 0.0256, m, t);
    }
  }
  bx(xf, [-0.015, 0.0, 0.095], [0.015, 0.027, 0.11], MAT.glow, [10, 2, 1]);
}

// ───────────────────────────── реестр ─────────────────────────────

export const HOME_PROPS: Record<string, PropSpec> = {
  sofa: { w: 2.0, d: 0.9, h: 0.85, mount: 'floor', ru: 'диван с пледом и двумя подушками', build: sofa },
  armchair: { w: 0.9, d: 0.85, h: 0.9, mount: 'floor', ru: 'кресло с салфетками', build: armchair },
  tv_stand: { w: 1.1, d: 0.5, h: 1.15, mount: 'floor', ru: 'тумба с кинескопным телевизором и видеомагнитофоном', build: tvStand },
  fridge: { w: 0.62, d: 0.62, h: 1.7, mount: 'floor', ru: 'холодильник с магнитами и запиской', build: fridge },
  stove: { w: 0.55, d: 0.58, h: 0.9, mount: 'floor', ru: 'газовая плита с кастрюлей', build: stove },
  kitchen_table: { w: 1.2, d: 0.8, h: 0.78, mount: 'floor', ru: 'кухонный стол под клеёнкой, табуретка, тарелка, хлебница', build: kitchenTable },
  sink_cabinet: { w: 0.8, d: 0.58, h: 1.35, mount: 'floor', ru: 'мойка-тумба с краном и сушилкой для тарелок', build: sinkCabinet },
  wardrobe: { w: 1.3, d: 0.58, h: 2.2, mount: 'floor', ru: 'платяной шкаф, одна дверца распахнута, чемодан наверху', build: wardrobe },
  bookshelf: { w: 1.0, d: 0.32, h: 1.9, mount: 'floor', ru: 'стеллаж с пёстрыми книгами', build: bookshelf },
  bed_home: { w: 2.0, d: 0.95, h: 0.75, mount: 'floor', ru: 'кровать с изголовьем, скомканным одеялом и подушкой', build: bedHome },
  wall_carpet: { w: 1.9, d: 0.04, h: 1.3, mount: 'wall', y: 0.85, ru: 'ковёр на стене с ромбами', build: (xf) => wallCarpet(xf) },
  rug: { w: 2.0, d: 1.4, h: 0.02, mount: 'free', ru: 'ковёр на полу с орнаментом', build: (xf) => rug(xf) },
  floor_lamp: { w: 0.45, d: 0.45, h: 1.65, mount: 'floor', ru: 'торшер с абажуром', build: floorLamp },
  mirror: { w: 0.55, d: 0.05, h: 1.25, mount: 'wall', y: 0.45, ru: 'зеркало в золочёной раме', build: mirror },
  bathtub: { w: 1.6, d: 0.72, h: 1.9, mount: 'floor', ru: 'ванна на ножках со шторкой на штанге', build: bathtub },
  washing_machine: { w: 0.6, d: 0.56, h: 0.86, mount: 'floor', ru: 'стиральная машина с круглым люком', build: washingMachine },
  toilet_home: { w: 0.42, d: 0.68, h: 0.82, mount: 'floor', ru: 'унитаз с бачком', build: toiletHome },
  coat_rack: { w: 1.0, d: 0.35, h: 1.85, mount: 'floor', ru: 'вешалка в прихожей с куртками, шапками и обувью', build: coatRack },
  desk_pc: { w: 1.2, d: 0.6, h: 1.25, mount: 'floor', ru: 'письменный стол с ЭЛТ-монитором', build: deskPc },
  crib: { w: 1.2, d: 0.65, h: 0.95, mount: 'floor', ru: 'детская кроватка с прутьями', build: crib },
  toy_heap: { w: 1.0, d: 0.6, h: 0.45, mount: 'floor', ru: 'кубики, пирамидка, мяч и машинка', build: toyHeap },
  clothes_dryer: { w: 1.4, d: 0.55, h: 1.0, mount: 'floor', ru: 'напольная сушилка с бельём', build: (xf) => clothesDryer(xf) },
  ironing_board: { w: 1.2, d: 0.4, h: 0.9, mount: 'floor', ru: 'гладильная доска с рубашкой', build: (xf) => ironingBoard(xf) },
  radiator: { w: 0.9, d: 0.14, h: 0.6, mount: 'wall', y: 0.12, ru: 'чугунная батарея', build: radiator },
  window_fake: { w: 1.3, d: 0.14, h: 1.45, mount: 'wall', y: 0.85, ru: 'окно в никуда: за стеклом ровное бледное свечение', build: windowFake },
  houseplant: { w: 0.5, d: 0.5, h: 1.3, mount: 'floor', ru: 'фикус в кадке', build: houseplant },
  chandelier: { w: 0.7, d: 0.7, h: 0.55, mount: 'ceiling', ru: 'люстра с тремя плафонами', build: (xf) => chandelier(xf) },
  christmas_tree: { w: 1.0, d: 1.0, h: 1.8, mount: 'floor', ru: 'ёлка с шарами, звездой и подарками', build: christmasTree },
  door_leaf_lean: { w: 0.95, d: 0.3, h: 2.05, mount: 'floor', ru: 'сорванная дверная створка, прислонена к стене', build: doorLean },
  door_leaf_down: { w: 0.9, d: 2.0, h: 0.08, mount: 'free', ru: 'дверная створка лежит на полу', build: doorDown },
  kettle: { w: 0.3, d: 0.22, h: 0.3, mount: 'free', ru: 'эмалированный чайник', build: kettle },
  iron: { w: 0.3, d: 0.14, h: 0.18, mount: 'free', ru: 'утюг со шнуром', build: iron },
  phone: { w: 0.11, d: 0.2, h: 0.02, mount: 'free', ru: 'смартфон экраном вверх, экран светится', build: (xf) => phone(xf) },
  keys: { w: 0.16, d: 0.1, h: 0.03, mount: 'free', ru: 'связка ключей с брелоком', build: keys },
  teddy: { w: 0.36, d: 0.3, h: 0.46, mount: 'free', ru: 'плюшевый мишка, одного глаза нет', build: teddy },
  slippers: { w: 0.34, d: 0.32, h: 0.1, mount: 'free', ru: 'пара тапочек', build: slippers },
  alarm_clock: { w: 0.18, d: 0.09, h: 0.2, mount: 'free', ru: 'будильник с двумя звонками', build: alarmClock },
  mug: { w: 0.16, d: 0.12, h: 0.13, mount: 'free', ru: 'кружка', build: mug },
  photo_frame: { w: 0.24, d: 0.12, h: 0.3, mount: 'free', ru: 'фоторамка, вместо лица светлое пятно', build: photoFrame },
  rotary_phone: { w: 0.3, d: 0.24, h: 0.16, mount: 'free', ru: 'дисковый телефон', build: rotaryPhone },
  night_light: { w: 0.16, d: 0.16, h: 0.2, mount: 'free', ru: 'ночник-гриб, светится', build: (xf) => nightLight(xf) },
  school_bag: { w: 0.38, d: 0.2, h: 0.42, mount: 'free', ru: 'школьный ранец', build: schoolBag },
  birthday_cake: { w: 0.3, d: 0.3, h: 0.2, mount: 'free', ru: 'торт со свечами, кончики светятся', build: birthdayCake },
  ball: { w: 0.26, d: 0.26, h: 0.26, mount: 'free', ru: 'мяч с полосой', build: (xf) => ball(xf) },
  goldfish_bowl: { w: 0.3, d: 0.3, h: 0.28, mount: 'free', ru: 'круглый аквариум с рыжей рыбкой', build: (xf) => goldfishBowl(xf) },
  remote: { w: 0.07, d: 0.22, h: 0.03, mount: 'free', ru: 'пульт от телевизора', build: (xf) => remote(xf) },
};
