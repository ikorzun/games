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
import { plant } from './flowers';
import { MAT } from './materials';
import { hung } from './props';
import type { Xf } from './props';
import { beam, ring, rng, sheet, WHITE } from './props_more';
import type { PropSpec } from './props_more';
import { fillShelves, furnished, jitter, openOf, pickOf, s3Bounds, s3Put, s3Size, spanOf, S3_SHELVES, S3_TOP, turnOf } from './furniture';

/** Книжные шкафы полки Sand3D, из которых выбирается стеллаж с книгами. */
const BOOKCASES = ['s3_bookcase_dark', 's3_etagere'] as const;

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

const TV_STAND = 's3_buffet_louvered';
/** Телевизор выше крышки тумбы на столько (вместе с рожками антенны) и глубже её на столько — нависает над краем. */
const TV_H = 0.6;
const TV_FRONT = 0.49;

/**
 * Тумба полки под телевизор (дверцы-жалюзи, открытая полка посередине) с кинескопным телевизором: экран светится, рожки
 * антенны; на открытой полке — видеомагнитофон. Кинескоп глубже тумбы и чуть нависает над краем — как у всех, кто ставил
 * телевизор на то, что было.
 */
function tvStand(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([1.05, 0.95, 0.85], 0.9 + rnd() * 0.2);
  const open = openOf(TV_STAND, seed);
  s3Put(xf, TV_STAND, { tint: jitter(seed), ...(open ? { open } : {}) });
  // Видеомагнитофон на нижней доске открытой полки: тёмный ящик, светлая щель, красный огонёк.
  const vy = S3_SHELVES[TV_STAND]![0]!.y;
  bx(xf, [-0.25, vy, 0.05], [0.25, vy + 0.1, 0.34], MAT.bakelite, [1.3, 1.3, 1.3]);
  face(xf, -0.18, vy + 0.035, 0.1, vy + 0.06, 0.341, MAT.steel, [1.2, 1.2, 1.2]);
  bx(xf, [0.15, vy + 0.04, 0.34], [0.2, vy + 0.07, 0.355], MAT.glow, [14, 2, 1]);
  // Телевизор на крышке, горбом кинескопа к стене: широкий корпус, чёрная рамка и выпуклый светящийся экран.
  const y = S3_TOP[TV_STAND]!;
  bx(xf, [-0.42, y, 0.19], [0.42, y + 0.42, 0.44], MAT.veneer, dim(wood, 1.1));
  bx(xf, [-0.3, y + 0.05, 0.01], [0.3, y + 0.35, 0.19], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [-0.38, y + 0.05, 0.44], [0.22, y + 0.38, 0.455], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [-0.34, y + 0.08, 0.455], [0.18, y + 0.35, 0.47], MAT.glow, [5, 7, 10]);
  bx(xf, [-0.3, y + 0.11, 0.47], [0.14, y + 0.32, 0.485], MAT.glow, [6.5, 8.5, 12]);
  for (const k of [0.27, 0.13]) xf.cyl([0.32, y + k, 0.44], 'z', 0.035, 0.03, MAT.steel, { segments: 6, tint: [1.4, 1.4, 1.4] });
  // Комнатная антенна: основание и два рожка с шариками.
  bx(xf, [-0.07, y + 0.42, 0.25], [0.07, y + 0.45, 0.37], MAT.bakelite, [1.3, 1.3, 1.3]);
  for (const s of [-1, 1]) {
    beam(xf, [s * 0.02, y + 0.45, 0.31], [s * 0.34, y + 0.57, 0.31], 0.02, 0.02, MAT.steel, [1.4, 1.4, 1.4], { side: UP });
    bx(xf, [s * 0.34 - 0.025, y + 0.56, 0.285], [s * 0.34 + 0.025, y + TV_H, 0.335], MAT.steel, [1.4, 1.4, 1.4]);
  }
  // Преграда — от пола: кинескоп нависает над краем тумбы, и упираются в него, а не в тумбу.
  xf.collider([-0.42, 0, 0.01], [0.42, y + 0.45, TV_FRONT]);
}



/**
 * Кухонный стол полки (точёные ножки) под клеёнкой в красную клетку — клеёнка свисает по краям; табуретка полки наполовину
 * выдвинута из-под стола; на клеёнке тарелка с куском и хлебница.
 */
const KITCHEN_TABLE = 's3_table_kitchen';
const KITCHEN_STOOL = 's3_stool_wood';
/** Табуретка задвинута под край стола на 4 см и довёрнута рукой до 0,6 рад в любую сторону. */
const KITCHEN_STOOL_IN = 0.04;
const KITCHEN_STOOL_TURN = 0.6;
/** Глубина стола с табуреткой: до края табуретки при самом сильном довороте (из габаритов моделей, а не на глаз). */
const kitchenDepth = (): number => s3Bounds(KITCHEN_TABLE)[1][2] - KITCHEN_STOOL_IN + s3Bounds(KITCHEN_STOOL, false, KITCHEN_STOOL_TURN)[1][2];

function kitchenTable(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const T = KITCHEN_TABLE;
  s3Put(xf, T, { tint: jitter(seed) });
  const [lo, hi] = s3Bounds(T);
  const hw = hi[0] + 0.01;
  const z0 = lo[2] - 0.005;
  const z1 = hi[2] + 0.01;
  const top = S3_TOP[T]!;
  const y = top + 0.002;
  // Клеёнка: лист по столешнице и подол на три с половиной сантиметра по краям.
  const cloth: Vec3 = [1.35, 1.3, 1.1];
  bx(xf, [-hw, top, z0], [hw, y, z1], MAT.paper, cloth, { skip: ['ny'] });
  bx(xf, [-hw, top - 0.035, z1 - 0.005], [hw, top, z1], MAT.paper, cloth, { skip: ['ny', 'py', 'nz'] });
  for (const s of [-1, 1]) bx(xf, [s > 0 ? hw - 0.005 : -hw, top - 0.035, z0], [s > 0 ? hw : -hw + 0.005, top, z1 - 0.005], MAT.paper, cloth, { skip: ['ny', 'py'] });
  // Клетка: красные квадраты в шахматном порядке, 7 × 4.
  const red: Vec3 = [1.4, 0.9, 0.85];
  const sx = (2 * hw) / 7;
  const sz = (z1 - z0) / 4;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) flat(xf, -hw + i * sx, z0 + j * sz, -hw + (i + 1) * sx, z0 + (j + 1) * sz, y + 0.002, MAT.paintRed, red);
  }
  // Табуретка наполовину выдвинута; с какой стороны — по сиду.
  const st = rnd() < 0.5 ? -0.36 : 0.36;
  s3Put(xf.child(st, 0, hi[2] - KITCHEN_STOOL_IN), KITCHEN_STOOL, { tint: jitter(seed, 0.07, 1), yaw: turnOf(seed, KITCHEN_STOOL_TURN) });
  // Тарелка с куском, хлебница.
  const ty = y + 0.003;
  xf.cyl([-0.12, ty, 0.42], 'y', 0.02, 0.13, MAT.enamel, { segments: 8, tint: [1.2, 1.2, 1.2] });
  bx(xf, [-0.17, ty + 0.02, 0.37], [-0.05, ty + 0.05, 0.47], MAT.leather, [1.1, 0.9, 0.7]);
  bx(xf, [0.2, ty, 0.24], [0.54, ty + 0.11, 0.58], MAT.zinc, [1.3, 1.3, 1.3], { bevel: 0.015 });
  bx(xf, [0.22, ty + 0.11, 0.26], [0.52, ty + 0.12, 0.56], MAT.paintOchre, [1.3, 1.2, 0.8]);
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

/** Книжный шкаф или этажерка полки (по сиду); на полках пёстрые корешки, где низко — книги стопками плашмя. */
function bookshelf(xf: Xf, seed: number): void {
  const m = pickOf(BOOKCASES, seed);
  s3Put(xf, m, { tint: jitter(seed) });
  fillShelves(xf, S3_SHELVES[m]!, 'books', seed, { back: m !== 's3_etagere' });
}

/** Стрелка часов на передней стороне: из центра в направлении a (градусы по часовой от «12»), длина len, ширина w. */
function clockHand(xf: Xf, cx: number, cy: number, a: number, len: number, w: number, z: number, tint: Vec3): void {
  const dx = Math.sin((a * Math.PI) / 180);
  const dy = Math.cos((a * Math.PI) / 180);
  const px = -dy * w;
  const py = dx * w;
  sheet(xf, [cx - px, cy - py, z], [cx + px, cy + py, z], [cx + px * 0.5 + dx * len, cy + py * 0.5 + dy * len, z], [cx - px * 0.5 + dx * len, cy - py * 0.5 + dy * len, z], FRONT, MAT.bakelite, tint);
}

/**
 * Советская «стенка» 2,6 × 0,46 × 2,1: тёмный полированный корпус, снизу ряд закрытых тумб, по бокам серванты
 * со стеклом и хрусталём, в середине собрание сочинений, телевизор (выключен) и на полке круглые часы 17:50.
 */
function wallUnit(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const k = 0.94 + rnd() * 0.12;
  const body: Vec3 = [0.5 * k, 0.36 * k, 0.27 * k];
  const lite = dim(body, 1.2);
  const F = 0.46;
  const crystal: Vec3 = [1.2, 1.35, 1.5];
  const china: Vec3 = [1.45, 1.45, 1.38];
  // Цоколь, тумбы (дверцы-заплатки, щели между ними — тёмный корпус), столешница.
  bx(xf, [-1.25, 0, 0.03], [1.25, 0.05, F - 0.03], MAT.veneer, dim(body, 0.7), { skip: ['nz', 'ny'] });
  bx(xf, [-1.3, 0.05, 0], [1.3, 0.55, F], MAT.veneer, dim(body, 0.8), { skip: ['nz', 'ny', 'py'] });
  bx(xf, [-1.3, 0.55, 0], [1.3, 0.58, F + 0.01], MAT.veneer, lite, { skip: ['nz', 'ny'] });
  for (let i = 0; i < 5; i++) {
    const x0 = -1.27 + i * 0.508;
    face(xf, x0, 0.08, x0 + 0.496, 0.53, F + 0.003, MAT.veneer, dim(body, 1.05));
    bx(xf, [x0 + 0.42, 0.27, F + 0.003], [x0 + 0.45, 0.35, F + 0.03], MAT.brass, [1.4, 1.25, 1], { skip: ['nz', 'ny', 'py'] });
  }
  // Каркас: боковины, перегородки, светлые задники, карниз на 3 см шире корпуса.
  for (const x of [-1.3, 1.27, -0.65, 0.62]) bx(xf, [x, 0.58, 0], [x + 0.03, 2.05, F], MAT.veneer, body, { skip: ['nz', 'ny', 'py'] });
  face(xf, -1.27, 0.58, -0.65, 2.05, 0.02, MAT.enamel, [1.35, 1.2, 0.9]);
  face(xf, 0.65, 0.58, 1.27, 2.05, 0.02, MAT.enamel, [1.05, 1.2, 1.4]);
  face(xf, -0.62, 0.58, 0.62, 2.05, 0.02, MAT.veneer, dim(body, 0.55));
  bx(xf, [-1.33, 2.05, 0], [1.33, 2.1, 0.49], MAT.veneer, lite, { skip: ['nz', 'ny'] });
  // Серванты: стеклянные полки (верх на 0,912 / 1,262 / 1,612), рамки-стойки и узкий блик.
  for (const s of [-1, 1]) {
    const a = s > 0 ? 0.65 : -1.27;
    const b = s > 0 ? 1.27 : -0.65;
    for (const y of [0.9, 1.25, 1.6]) bx(xf, [a, y, 0.03], [b, y + 0.012, F - 0.02], MAT.glass, [1.5, 1.5, 1.5], { skip: ['nz', 'ny', 'px', 'nx'] });
    for (const x of [a, b - 0.025]) bx(xf, [x, 0.58, F], [x + 0.025, 2.05, F + 0.015], MAT.veneer, lite, { skip: ['nz', 'ny', 'py'] });
    const g = a + 0.2;
    sheet(xf, [g, 0.65, F + 0.016], [g + 0.025, 0.65, F + 0.016], [g + 0.075, 1.98, F + 0.016], [g + 0.05, 1.98, F + 0.016], FRONT, MAT.paper, [1.3, 1.35, 1.5]);
  }
  // Левый: стопки тарелок; графин с пробкой и рюмки; блюдо на ребре и высокая ваза; ваза-ладья.
  for (const [x0, x1] of [[-1.22, -1.07], [-1.04, -0.89]] as const) {
    bx(xf, [x0, 0.58, 0.12], [x1, 0.74, 0.32], MAT.enamel, china, { skip: ['nz', 'ny'] });
  }
  xf.cyl([-0.76, 0.69, 0.2], 'z', 0.03, 0.1, MAT.paintBlue, { segments: 6, tint: [1.2, 1.3, 1.5] });
  xf.cyl([-1.1, 0.912, 0.2], 'y', 0.17, 0.065, MAT.enamel, { segments: 6, tint: crystal });
  bx(xf, [-1.12, 1.082, 0.18], [-1.08, 1.18, 0.22], MAT.enamel, crystal, { skip: ['nz', 'ny'] });
  bx(xf, [-1.13, 1.18, 0.17], [-1.07, 1.22, 0.23], MAT.paintRed, [1.3, 1.1, 1.1], { skip: ['nz', 'ny'] });
  for (let i = 0; i < 4; i++) xf.cyl([-0.93 + i * 0.075, 0.912, 0.2], 'y', 0.1, 0.015, MAT.enamel, { segments: 5, tint: crystal, radiusEnd: 0.045, caps: false });
  xf.cyl([-0.9, 1.372, 0.2], 'z', 0.03, 0.1, MAT.paintBlue, { segments: 6, tint: [1.2, 1.3, 1.5] });
  bx(xf, [-1.0, 1.612, 0.17], [-0.9, 1.65, 0.23], MAT.enamel, crystal, { skip: ['nz', 'ny'] });
  xf.cyl([-1.15, 1.74, 0.2], 'x', 0.38, 0.045, MAT.paintBlue, { segments: 6, tint: [1.2, 1.3, 1.5], radiusEnd: 0.09 });
  // Правый: ряд книг корешками наружу, чашки с блюдцами (белые, цветок-пятно), хрустальные вазы.
  let bxp = 0.67;
  for (let i = 0; i < 6; i++) {
    const w = 0.07 + rnd() * 0.02;
    const h = 0.22 + rnd() * 0.08;
    bx(xf, [bxp, 0.58, 0.07], [bxp + w, 0.58 + h, 0.3], i % 2 ? MAT.paintRed : MAT.paintBlue, i % 2 ? [1.2, 1.0, 1.0] : [1.1, 1.2, 1.4], { skip: ['ny', 'nz', 'px', 'nx'] });
    bxp += w + 0.003;
  }
  const flowers = [MAT.paintRed, MAT.paintOchre, MAT.paintBlue, MAT.paintRed] as const;
  const cups: Array<[number, number]> = [[0.8, 0.912], [0.97, 0.912], [1.14, 0.912], [0.97, 1.262]];
  cups.forEach(([cx, cy], i) => {
    bx(xf, [cx - 0.06, cy, 0.14], [cx + 0.06, cy + 0.012, 0.26], MAT.enamel, china, { skip: ['nz', 'ny'] });
    bx(xf, [cx - 0.035, cy + 0.012, 0.165], [cx + 0.035, cy + 0.075, 0.235], MAT.enamel, china, { skip: ['nz', 'ny'] });
    face(xf, cx - 0.015, cy + 0.03, cx + 0.015, cy + 0.06, 0.236, flowers[i]!, [1.4, 1.2, 1.0]);
  });
  xf.cyl([0.8, 1.612, 0.2], 'y', 0.26, 0.05, MAT.enamel, { segments: 6, tint: crystal, radiusEnd: 0.085 });
  xf.cyl([1.1, 1.612, 0.2], 'y', 0.32, 0.04, MAT.enamel, { segments: 6, tint: crystal, radiusEnd: 0.075 });
  // Середина, верх: собрание сочинений (одинаковая высота), три книги плашмя, пара наклонена вправо.
  bx(xf, [-0.62, 1.6, 0.03], [0.62, 1.63, F - 0.02], MAT.veneer, lite, { skip: ['nz', 'ny', 'px', 'nx'] });
  const ws: number[] = [];
  for (let i = 0; i < 10; i++) ws.push(0.05 + rnd() * 0.04);
  const wsum = ws.reduce((a, b) => a + b, 0);
  let x = -0.6;
  ws.forEach((w0, i) => {
    const w = (w0 / wsum) * 0.95;
    const green = i % 3 !== 1;
    bx(xf, [x, 1.63, 0.08], [x + w, 1.93, 0.3], green ? MAT.paintGreen : MAT.wood, green ? [0.55, 0.75, 0.5] : [0.7, 0.55, 0.42], { skip: ['ny', 'nz', 'px', 'nx'] });
    if (i % 2 === 0) face(xf, x, 1.84, x + w, 1.855, 0.3, MAT.brass, [1.4, 1.25, 0.7]);
    x += w;
  });
  for (const [x0, x1, y0] of [[-0.58, -0.26, 1.93], [-0.5, -0.2, 1.97], [-0.05, 0.25, 1.93]] as const) bx(xf, [x0, y0, 0.07], [x1, y0 + 0.04, 0.3], MAT.wood, [0.65, 0.5, 0.4], { skip: ['ny', 'nz'] });
  beam(xf, [0.4, 1.635, 0.19], [0.47, 1.93, 0.19], 0.22, 0.05, MAT.paintGreen, [0.55, 0.75, 0.5], { side: FRONT });
  beam(xf, [0.46, 1.635, 0.19], [0.56, 1.92, 0.19], 0.22, 0.05, MAT.wood, [0.7, 0.55, 0.42], { side: FRONT });
  // Середина, ниша: кинескопный телевизор, выключен.
  bx(xf, [-0.62, 0.93, 0.03], [0.62, 0.95, F - 0.02], MAT.veneer, lite, { skip: ['nz', 'ny', 'px', 'nx'] });
  bx(xf, [-0.4, 1.03, 0.05], [0.4, 1.49, 0.24], MAT.bakelite, [1.1, 1.1, 1.1], { skip: ['nz', 'ny', 'pz'] });
  bx(xf, [-0.58, 0.96, 0.24], [0.58, 1.56, 0.44], MAT.bakelite, [1.3, 1.3, 1.3], { skip: ['nz', 'ny'] });
  bx(xf, [-0.52, 1.0, 0.44], [0.22, 1.52, 0.452], MAT.bakelite, [0.8, 0.8, 0.8], { skip: ['nz', 'ny'] });
  bx(xf, [-0.48, 1.04, 0.452], [0.18, 1.48, 0.468], MAT.glass, [0.9, 0.9, 0.9], { skip: ['nz', 'ny'] });
  for (const y of [1.36, 1.41, 1.46]) face(xf, 0.29, y, 0.51, y + 0.02, 0.441, MAT.bakelite, [0.6, 0.6, 0.6]);
  xf.cyl([0.4, 1.15, 0.44], 'z', 0.03, 0.04, MAT.steel, { segments: 6, tint: [1.4, 1.4, 1.4] });
  bx(xf, [0.5, 1.0, 0.44], [0.53, 1.03, 0.45], MAT.glow, [3, 12, 3], { skip: ['nz', 'ny'] });
  // Середина, открытая полка: стопки книг плашмя (светлые обрезы наружу) и часы 17:50.
  for (const x0 of [-0.58, 0.22]) {
    const x1 = x0 + 0.36;
    for (let i = 0; i < 3; i++) {
      const y0 = 0.58 + i * 0.075;
      bx(xf, [x0, y0 + 0.012, 0.1], [x1, y0 + 0.07, 0.4], MAT.paper, [1.4, 1.35, 1.1], { skip: ['ny', 'nz'] });
      face(xf, x0, y0, x1, y0 + 0.012, 0.402, MAT.paintGreen, [0.55, 0.7, 0.5]);
    }
    sheet(xf, [x0, 0.805, 0.1], [x1, 0.805, 0.1], [x1, 0.805, 0.4], [x0, 0.805, 0.4], UP, MAT.paintGreen, [0.55, 0.7, 0.5]);
  }
  const cy = 0.725;
  bx(xf, [-0.07, 0.58, 0.2], [0.07, 0.62, 0.34], MAT.brass, [1.1, 1.0, 0.8], { skip: ['nz', 'ny'] });
  xf.cyl([0, cy, 0.22], 'z', 0.06, 0.105, MAT.brass, { segments: 8, tint: [1.3, 1.2, 0.9] });
  xf.cyl([0, cy, 0.28], 'z', 0.008, 0.09, MAT.enamel, { segments: 8, tint: [1.5, 1.5, 1.4] });
  const zf = 0.2885;
  const dark: Vec3 = [0.4, 0.4, 0.4];
  for (const [tx, ty, w, h] of [[0, 0.07, 0.008, 0.022], [0, -0.07, 0.008, 0.022], [0.07, 0, 0.022, 0.008], [-0.07, 0, 0.022, 0.008]] as const) face(xf, tx - w, cy + ty - h, tx + w, cy + ty + h, zf, MAT.bakelite, dark);
  clockHand(xf, 0, cy, 175, 0.052, 0.008, zf + 0.0005, dark);
  clockHand(xf, 0, cy, 300, 0.078, 0.006, zf + 0.001, dark);
  xf.collider([-1.3, 0, 0], [1.3, 2.1, 0.46]);
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




/** Напольная вешалка полки в прихожей; у стены рядом — сапоги, перед ними светлые кеды. */
function coatRack(xf: Xf, seed: number): void {
  s3Put(xf.child(-0.2, 0, 0.33), 's3_coat_stand', { tint: jitter(seed) });
  const boot: Vec3 = [1.4, 1.2, 0.8];
  for (const x of [0.2, 0.32]) {
    bx(xf, [x - 0.05, 0, 0.06], [x + 0.05, 0.08, 0.3], MAT.paintOchre, boot, { aoBottom: 0.6 });
    bx(xf, [x - 0.05, 0.08, 0.06], [x + 0.05, 0.3, 0.16], MAT.paintOchre, boot);
  }
  for (const x of [0.24, 0.36]) {
    bx(xf, [x - 0.05, 0.012, 0.36], [x + 0.05, 0.08, 0.6], MAT.paper, [1.45, 1.4, 1.2], { bevel: 0.015 });
    bx(xf, [x - 0.052, 0, 0.358], [x + 0.052, 0.012, 0.602], MAT.rubber, [1.3, 1.3, 1.3], { skip: ['ny'] });
  }
}

/**
 * Письменный стол полки (тумба слева) с компьютером: ЭЛТ-монитор светится, клавиатура; системный блок — на полу под
 * столешницей справа.
 */
function deskPc(xf: Xf, seed: number): void {
  const D = 's3_desk_simple';
  s3Put(xf, D, { tint: jitter(seed) });
  const t = S3_TOP[D]!;
  const beige: Vec3 = [1.45, 1.4, 1.15];
  // Системный блок.
  bx(xf, [0.12, 0, 0.06], [0.4, 0.42, 0.48], MAT.enamel, beige, { aoBottom: 0.6 });
  face(xf, 0.16, 0.28, 0.36, 0.34, 0.481, MAT.bakelite);
  face(xf, 0.16, 0.18, 0.36, 0.24, 0.481, MAT.bakelite);
  bx(xf, [0.28, 0.06, 0.48], [0.34, 0.1, 0.495], MAT.glow, [3, 12, 3]);
  // ЭЛТ-монитор: подставка, корпус, горб кинескопа к стене, чёрная рамка, светящийся экран.
  bx(xf, [-0.1, t, 0.12], [0.1, t + 0.04, 0.3], MAT.enamel, beige);
  bx(xf, [-0.27, t + 0.04, 0.18], [0.27, t + 0.44, 0.35], MAT.enamel, beige);
  bx(xf, [-0.18, t + 0.1, 0.01], [0.18, t + 0.36, 0.18], MAT.enamel, dim(beige, 0.9));
  bx(xf, [-0.23, t + 0.08, 0.35], [0.23, t + 0.4, 0.362], MAT.bakelite, [1.2, 1.2, 1.2]);
  bx(xf, [-0.19, t + 0.11, 0.362], [0.19, t + 0.37, 0.372], MAT.glow, [6, 9, 8]);
  bx(xf, [0.17, t + 0.07, 0.35], [0.23, t + 0.09, 0.366], MAT.glow, [3, 12, 3]);
  // Клавиатура: светлая плата, тёмный блок клавиш.
  bx(xf, [-0.24, t, 0.39], [0.18, t + 0.025, 0.5], MAT.enamel, beige);
  bx(xf, [-0.21, t + 0.025, 0.41], [0.15, t + 0.035, 0.49], MAT.bakelite, [1.4, 1.4, 1.4]);
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

/**
 * Комнатное растение 0,5 × 0,5 × 1,3 (партнёр 19.11, 21:27: «Больше разных цветов и растений… в другие помещения»): что стоит у
 * стены, решает сид — фикус в кадке (как было), тёщин язык, алоэ, хлорофитум или монстера в горшке; зелень — кодом
 * (world/flowers.ts, plant).
 */
function houseplant(xf: Xf, seed: number): void {
  const kind = seed % 5;
  if (kind === 0) return ficus(xf, seed);
  const cz = 0.25;
  // Горшок: обожжённая глина на поддоне, у сансевиерии — повыше и пошире (высокий куст в низком горшке валится).
  const big = kind === 1;
  const r0 = big ? 0.15 : 0.11;
  const h = big ? 0.3 : 0.24;
  const clay: Vec3 = [1.45, 0.82, 0.62];
  xf.cyl([0, 0, cz], 'y', 0.02, r0 + 0.04, MAT.brick, { segments: 10, tint: dim(clay, 0.85) });
  xf.cyl([0, 0.02, cz], 'y', h - 0.03, r0, MAT.plaster, { segments: 10, radiusEnd: r0 + 0.04, tint: clay, caps: false });
  xf.cyl([0, h - 0.01, cz], 'y', 0.03, r0 + 0.05, MAT.plaster, { segments: 10, tint: dim(clay, 1.05), caps: false });
  xf.cyl([0, h - 0.04, cz], 'y', 0.01, r0 + 0.035, MAT.dirt, { segments: 10, tint: [1.1, 1.05, 1.0] });
  // Монстеры дома нет: её лист шире места горшка у стены (0,5 м) и тяжелее бюджета вещи — она живёт в оранжерее, в кадке.
  // Вместо неё — герань, цветок советского подоконника; её головки, как в оранжерее, поворачиваются к свету.
  const species = (['sansevieria', 'aloe', 'chlorophytum', 'geranium'] as const)[kind - 1]!;
  const size = species === 'chlorophytum' ? 0.85 : species === 'geranium' ? 1.1 : 1.15;
  plant(xf, [0, h - 0.03, cz], species, seed, size, rng(seed)() * 6.28);
  xf.collider([-0.2, 0, cz - 0.2], [0.2, Math.min(1.0, h + 0.5), cz + 0.2]);
}

/**
 * Банка с цветами 0,24 × 0,24 × 0,6 (середина — в начале координат, дно — на y = 0): стеклянная банка с водой и букет из того,
 * что росло на даче и продавалось у метро, — ромашки, пионы, гвоздики, тюльпаны, маки. Головки — вещи рендера: поворачиваются
 * к свету (world/flowers.ts, systems/flowers.ts).
 */
function jarFlowers(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const glass: Vec3 = [1.25, 1.35, 1.35];
  xf.cyl([0, 0, 0], 'y', 0.13, 0.042, MAT.glass, { segments: 10, tint: glass, caps: false });
  xf.cyl([0, 0.13, 0], 'y', 0.012, 0.036, MAT.glass, { segments: 10, tint: glass, caps: false });
  xf.cyl([0, 0.003, 0], 'y', 0.085, 0.039, MAT.glass, { segments: 10, tint: [0.95, 1.1, 1.05] });
  const kinds = [['daisy', 'daisy', 'poppy'], ['peony', 'peony', 'carnation'], ['carnation', 'carnation', 'tulip'], ['tulip', 'tulip', 'daisy'], ['daisy', 'carnation', 'poppy']] as const;
  const set = kinds[Math.floor(rnd() * kinds.length)]!;
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    plant(xf, [Math.cos(a) * 0.012, 0.03, Math.sin(a) * 0.012], set[i % set.length]!, Math.floor(rnd() * 1e9), 0.62 + rnd() * 0.12, a);
  }
}

/** Фикус в кадке: ствол, ветки, крупные листья. */
function ficus(xf: Xf, seed: number): void {
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

/** Высота конфорки под чайником, м: чайник стоит на её решётке. */
const KETTLE_LIFT = 0.04;

/**
 * Чайник на конфорке без плиты: плиты нет, а синий венец газа горит — «the kettle. you left it on.» Это
 * его главная деталь, видная издалека; синий свет на пол вокруг даёт свет памяти (world/memory_light.ts).
 */
function kettle(xf: Xf, seed: number): void {
  burner(xf);
  kettleBody(xf.child(0, KETTLE_LIFT, 0, 0), seed);
}

/** Чугунная горелка: чашка, рассекатель, решётка из четырёх лап и двенадцать язычков газа. */
function burner(xf: Xf): void {
  const iron: Vec3 = [0.55, 0.55, 0.58];
  xf.cyl([0, 0, 0], 'y', 0.014, 0.05, MAT.castIron, { segments: 10, tint: iron });
  xf.cyl([0, 0.014, 0], 'y', 0.006, 0.042, MAT.castIron, { segments: 10, tint: [0.4, 0.4, 0.42] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    beam(xf, [c * 0.052, KETTLE_LIFT - 0.006, sn * 0.052], [c * 0.125, KETTLE_LIFT - 0.006, sn * 0.125], 0.012, 0.012, MAT.castIron, iron);
    beam(xf, [c * 0.125, KETTLE_LIFT - 0.006, sn * 0.125], [c * 0.132, 0, sn * 0.132], 0.012, 0.012, MAT.castIron, iron);
  }
  // Венец: язычки из света (светятся сами, видны и без фонаря), у основания голубее.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    xf.cyl([Math.cos(a) * 0.046, 0.017, Math.sin(a) * 0.046], 'y', 0.028, 0.0075, MAT.glow, { segments: 4, tint: [3.5, 7, 14], radiusEnd: 0.0012, caps: false });
  }
}

/** Эмалированный чайник: бочок, крышка с шишкой, носик, дужка. */
function kettleBody(xf: Xf, seed: number): void {
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

// ─────────── кухня и ванная — моделями полки Sand3D (квиз 19.11, партнёр: «Заменить собранное кодом») ───────────
// Холодильник, плита, ванна, унитаз и стиральная машина — модели полки (scripts/import_sand3d.py, третий подбор). Имена вещей
// прежние: на них ссылаются правки партнёра (холодильник, батарея кухни), вещи сна и картонки. То, что рассказывало о
// комнате у прежних, собранных кодом, — записка под магнитами, кастрюля на конфорке, шторка над ванной — накладками на модели.

const FRIDGE = furnished('floor', ['s3_fridge_old'], 'холодильник: старый, округлый, хромированные ручки; на двери записка под магнитом');
/** Передняя плоскость двери холодильника полки — по сетке модели (середина двери в 0,79 м от стены). */
const FRIDGE_DOOR = 0.795;

function fridgeS3(xf: Xf, seed: number): void {
  FRIDGE.build(xf, seed);
  // Записка и магниты — самое яркое на двери.
  face(xf, 0.02, 0.98, 0.15, 1.2, FRIDGE_DOOR, MAT.paper, [1.4, 1.35, 1.1]);
  for (const y of [1.02, 1.08, 1.14]) face(xf, 0.05, y, 0.12, y + 0.025, FRIDGE_DOOR + 0.001, MAT.bakelite);
  bx(xf, [0.05, 1.19, FRIDGE_DOOR - 0.005], [0.12, 1.26, FRIDGE_DOOR + 0.015], MAT.paintRed, [1.5, 1.2, 1.2]);
  bx(xf, [0.16, 0.78, FRIDGE_DOOR - 0.005], [0.23, 0.85, FRIDGE_DOOR + 0.015], MAT.paintBlue, [1.3, 1.4, 1.5]);
  bx(xf, [-0.05, 1.42, FRIDGE_DOOR - 0.005], [0.02, 1.49, FRIDGE_DOOR + 0.015], MAT.paintOchre, [1.5, 1.3, 0.9]);
}

const STOVE = furnished('floor', ['s3_gas_stove'], 'газовая плита: четыре конфорки, духовка со стеклом; на конфорке кастрюля');
/** Высота решёток над дальними конфорками плиты полки, м. */
const STOVE_GRATE = 0.928;

function stoveS3(xf: Xf, seed: number): void {
  STOVE.build(xf, seed);
  // Кастрюля на дальней левой конфорке: эмаль, крышка, шишка.
  xf.cyl([-0.18, STOVE_GRATE, 0.2], 'y', 0.075, 0.105, MAT.paintRed, { segments: 8, tint: [1.4, 1.2, 1.1] });
  xf.cyl([-0.18, STOVE_GRATE + 0.075, 0.2], 'y', 0.006, 0.11, MAT.steel, { segments: 8, tint: [1.4, 1.4, 1.4] });
  xf.cyl([-0.18, STOVE_GRATE + 0.081, 0.2], 'y', 0.004, 0.02, MAT.bakelite, { segments: 5 });
}

const TUB = furnished('floor', ['s3_bathtub'], 'ванна: эмаль, смеситель с торца; над ней штанга со шторкой');
/** Габарит ванны полки: передний борт — от стены, края — по длине, борт — по высоте (штанга и шторка встают по нему). */
const TUB_BOX = s3Size('s3_bathtub');
const TUB_FRONT = TUB_BOX.d - 0.05;
const TUB_RIM = TUB_BOX.h - 0.06;

function bathtubS3(xf: Xf, seed: number): void {
  TUB.build(xf, seed);
  const rnd = rng(seed);
  const curt: Vec3 = [1.45, 1.4, 1.2];
  const dots: Vec3 = rnd() < 0.5 ? [1.5, 1.1, 1.0] : [1.5, 1.35, 0.8];
  // Рама под шторку над передним бортом: две стойки и штанга.
  const half = TUB_BOX.w / 2;
  for (const x of [-half, half - 0.04]) bx(xf, [x, TUB_RIM, TUB_FRONT], [x + 0.04, 1.9, TUB_FRONT + 0.04], MAT.steel, [1.4, 1.4, 1.4]);
  bx(xf, [-half, 1.85, TUB_FRONT], [half, 1.9, TUB_FRONT + 0.04], MAT.steel, [1.4, 1.4, 1.4]);
  // Шторка: складки сдвинуты к одному краю, зигзаг.
  for (let i = 0; i < 5; i++) {
    const x = half - 0.84 + i * 0.16;
    const z = TUB_FRONT + (i % 2 === 0 ? 0.045 : 0.075);
    bx(xf, [x, TUB_RIM, z], [x + 0.16, 1.85, z + 0.02], MAT.paper, curt);
    const y = i % 2 === 0 ? 0.9 : 1.3;
    bx(xf, [x + 0.03, y, z + 0.02], [x + 0.13, y + 0.1, z + 0.025], MAT.paintRed, dots);
  }
}

// ───────────────────────────── реестр ─────────────────────────────

export const HOME_PROPS: Record<string, PropSpec> = {
  sofa: furnished('floor', ['s3_sofa_olive', 's3_sofa_grey'], 'диван: старый, в оливковой обивке, или с деревянными подлокотниками', { pull: 0.03 }),
  armchair: furnished('floor', ['s3_armchair_round', 's3_armchair_sixties'], 'кресло: с круглой спинкой или шестидесятых, с деревянными подлокотниками', { turn: 0.07, pull: 0.05 }),
  tv_stand: { w: s3Size(TV_STAND).w, d: TV_FRONT, reach: Math.max(0, s3Size(TV_STAND, true).d - TV_FRONT), h: Math.ceil((S3_TOP[TV_STAND]! + TV_H) * 100) / 100, mount: 'floor', ru: 'тумба с кинескопным телевизором и видеомагнитофоном', build: tvStand },
  fridge: { ...FRIDGE, build: fridgeS3 },
  stove: { ...STOVE, build: stoveS3 },
  kitchen_table: { w: 1.4, d: Math.ceil(kitchenDepth() * 100) / 100, h: 0.87, mount: 'floor', ru: 'кухонный стол на точёных ножках под клеёнкой, табуретка, тарелка, хлебница', build: kitchenTable },
  sink_cabinet: { w: 0.8, d: 0.58, h: 1.35, mount: 'floor', ru: 'мойка-тумба с краном и сушилкой для тарелок', build: sinkCabinet },
  // Дверцы светлого открыты по сиду (у серого они слиты с корпусом — он всегда закрыт), поэтому светлый — в двух случаях из трёх.
  wardrobe: furnished('floor', ['s3_wardrobe_plain', 's3_wardrobe_plain', 's3_wardrobe_grey'], 'платяной шкаф: светлый в две дверцы или серый с ящиками внизу', { pull: 0.03, open: true }),
  wall_unit: { w: 2.6, d: 0.46, h: 2.1, mount: 'floor', ru: 'стенка: сервант с хрусталём, книги, телевизор, часы', build: wallUnit },
  bookshelf: { ...spanOf(BOOKCASES), mount: 'floor', ru: 'книжный шкаф или этажерка с пёстрыми книгами', build: bookshelf },
  bed_home: furnished('floor', ['s3_bed_iron_green'], 'железная кровать с зелёным одеялом', { pull: 0.03 }),
  wall_carpet: { w: 1.9, d: 0.04, h: 1.3, mount: 'wall', y: 0.85, ru: 'ковёр на стене с ромбами', build: (xf) => wallCarpet(xf) },
  rug: { w: 2.0, d: 1.4, h: 0.02, mount: 'free', ru: 'ковёр на полу с орнаментом', build: (xf) => rug(xf) },
  floor_lamp: { w: 0.45, d: 0.45, h: 1.65, mount: 'floor', ru: 'торшер с абажуром', build: floorLamp },
  mirror: { w: 0.55, d: 0.05, h: 1.25, mount: 'wall', y: 0.45, ru: 'зеркало в золочёной раме', build: mirror },
  bathtub: { ...TUB, d: Math.max(TUB.d, TUB_FRONT + 0.12), h: 1.9, build: bathtubS3 },
  washing_machine: furnished('floor', ['s3_washer'], 'стиральная машина с круглым люком', { open: true }),
  toilet_home: furnished('floor', ['s3_toilet'], 'унитаз-компакт с бачком'),
  coat_rack: { w: 1.04, d: 0.65, h: 1.8, mount: 'floor', ru: 'напольная вешалка в прихожей, рядом сапоги и кеды', build: coatRack },
  desk_pc: { w: 1.04, d: 0.52, h: 1.2, mount: 'floor', ru: 'письменный стол с тумбой и ЭЛТ-монитором, системный блок под столом', build: deskPc },
  crib: furnished('floor', ['s3_crib'], 'детская кроватка', { turn: 0.03, pull: 0.04 }),
  toy_heap: { w: 1.0, d: 0.6, h: 0.45, mount: 'floor', ru: 'кубики, пирамидка, мяч и машинка', build: toyHeap },
  clothes_dryer: { w: 1.4, d: 0.55, h: 1.0, mount: 'floor', ru: 'напольная сушилка с бельём', build: (xf) => clothesDryer(xf) },
  ironing_board: { w: 1.2, d: 0.4, h: 0.9, mount: 'floor', ru: 'гладильная доска с рубашкой', build: (xf) => ironingBoard(xf) },
  radiator: { w: 0.9, d: 0.14, h: 0.6, mount: 'wall', y: 0.12, ru: 'чугунная батарея', build: radiator },
  window_fake: { w: 1.3, d: 0.14, h: 1.45, mount: 'wall', y: 0.85, ru: 'окно в никуда: за стеклом ровное бледное свечение', build: windowFake },
  jar_flowers: { w: 0.24, d: 0.24, h: 0.6, mount: 'free', ru: 'банка с цветами: ромашки, пионы, гвоздики, тюльпаны или маки', build: jarFlowers },
  houseplant: { w: 0.5, d: 0.5, h: 1.3, mount: 'floor', ru: 'комнатное растение: фикус в кадке, тёщин язык, алоэ, хлорофитум или герань', build: houseplant },
  chandelier: { w: 0.7, d: 0.7, h: 0.55, mount: 'ceiling', ru: 'люстра с тремя плафонами', build: (xf) => hung(xf, 0.55, 0.25, () => chandelier(xf)) },
  christmas_tree: { w: 1.0, d: 1.0, h: 1.8, mount: 'floor', ru: 'ёлка с шарами, звездой и подарками', build: christmasTree },
  door_leaf_lean: { w: 0.95, d: 0.3, h: 2.05, mount: 'floor', ru: 'сорванная дверная створка, прислонена к стене', build: doorLean },
  door_leaf_down: { w: 0.9, d: 2.0, h: 0.08, mount: 'free', ru: 'дверная створка лежит на полу', build: doorDown },
  kettle: { w: 0.3, d: 0.27, h: 0.34, mount: 'free', ru: 'эмалированный чайник на конфорке без плиты, газ горит', build: kettle },
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
