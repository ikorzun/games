/**
 * Вокзал, зал ожидания: сиденья, камеры хранения, касса, табло, часы, колонна, таксофон, буфет, чемодан,
 * урна, указатель, ограждение — и мелкие вещи-воспоминания (записка, ключ, билет, стакан, пальто).
 * Правила те же, что в props_office.ts: предмет описан в своих координатах (метры, y вверх), пол — y = 0;
 * floor — спина в z = 0, растёт в +z, по x центр; free — по центру; wall — спина в z = 0, y в реестре — высота
 * низа; ceiling — растёт вниз от y = 0.
 *
 * Гамма: светлый камень и кремовые стены, сиденья — приглушённые горчичный и сине-зелёный, сталь серо-зелёная,
 * дерево тёмное. Надписей, цифр и марок нет: таблички — светлые прямоугольники, планки табло — без букв.
 * Стекло в этой игре — непрозрачный тёмный глянец (MAT.glass), поэтому за стеклом ничего не прячем:
 * витрина буфета открыта спереди. Соседние блоки либо стыкуются встык, либо разнесены; накладки вынесены от
 * поверхности на 2–4 мм.
 * Вся случайность — из rng(seed).
 */
import type { Vec3 } from '../core/types';
import type { BoxOpts } from './kit';
import { MAT } from './materials';
import { hung } from './props';
import type { Xf } from './props';
import { beam, ring, rng, sheet, WHITE } from './props_more';
import type { PropSpec } from './props_more';
import { furnished, jitter, pickOf, s3Put, s3Size, S3_SEAT } from './furniture';

const UP: Vec3 = [0, 1, 0];

// ───────────────────────────── палитра ─────────────────────────────

const STONE: Vec3 = [1.25, 1.2, 1.1];
const STONE_DK: Vec3 = [0.98, 0.94, 0.86];
const CREAM: Vec3 = [1.2, 1.15, 0.95];
const MUSTARD: Vec3 = [1.3, 0.98, 0.42];
const TEAL: Vec3 = [0.42, 0.92, 0.85];
const STEEL: Vec3 = [0.8, 0.92, 0.85];
const STEEL_DK: Vec3 = [0.5, 0.62, 0.56];
const STEEL_LT: Vec3 = [1.2, 1.25, 1.2];
const WOOD: Vec3 = [0.62, 0.46, 0.36];
const GLASS: Vec3 = [1.3, 1.35, 1.3];
const LIGHT: Vec3 = [1.45, 1.4, 1.2];
const INK: Vec3 = [0.3, 0.3, 0.32];
const BRASS: Vec3 = [1.3, 1.15, 0.8];

// ───────────────────────────── помощники ─────────────────────────────

/** Коробка с оттенком. */
function bx(xf: Xf, a: Vec3, b: Vec3, mat: number, tint: Vec3 = WHITE, o: BoxOpts = {}): void {
  xf.box(a, b, mat, { ...o, tint });
}

/** Цилиндр с оттенком; по умолчанию восьмигранник. */
function cy(xf: Xf, base: Vec3, axis: 'x' | 'y' | 'z', len: number, r: number, mat: number, tint: Vec3 = WHITE, seg = 8, o: { radiusEnd?: number; caps?: boolean } = {}): void {
  xf.cyl(base, axis, len, r, mat, { ...o, tint, segments: seg });
}

/** Многоугольник с чётным числом вершин (x, z), вытянутый по y от y0 до y1: верх и бока, без низа. */
function prism(xf: Xf, p: readonly (readonly [number, number])[], y0: number, y1: number, mat: number, tint: Vec3 = WHITE): void {
  const n = p.length;
  const P = (i: number, y: number): Vec3 => [p[i]![0], y, p[i]![1]];
  for (let k = 1; k + 2 < n; k += 2) sheet(xf, P(0, y1), P(k, y1), P(k + 1, y1), P(k + 2, y1), UP, mat, tint);
  const cx = p.reduce((s, q) => s + q[0], 0) / n;
  const cz = p.reduce((s, q) => s + q[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const out: Vec3 = [(p[i]![0] + p[j]![0]) / 2 - cx, 0, (p[i]![1] + p[j]![1]) / 2 - cz];
    sheet(xf, P(i, y0), P(j, y0), P(j, y1), P(i, y1), out, mat, tint);
  }
}

const add3 = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// ───────────────────────────── сиденья ─────────────────────────────

/**
 * Скамьи зала — с полки Sand3D (18.11, партнёр: «замени всю мебель на новую самостоятельно»; прежде здесь стояли ряды литых
 * сидений на балке). Посреди зала — ряды деревянных скамей спинка к спинке, как на старых вокзалах; у стен — какая
 * придётся: деревянная, синяя или парковая на чугунных ногах, будто их свезли сюда отовсюду.
 */
export const WALL_BENCHES = ['s3_bench_wood', 's3_bench_blue', 's3_bench_cast'] as const;
const ROW_BENCH = 's3_bench_wood';

/** Высота сиденья скамьи, которую с этим сидом поставит st_seats (у стены) или st_seats_double (ряд): на неё кладут вещи. */
export function benchSeat(name: 'st_seats' | 'st_seats_double', seed: number): number {
  return S3_SEAT[name === 'st_seats' ? pickOf(WALL_BENCHES, seed) : ROW_BENCH]!;
}

/** Две деревянные скамьи полки спинка к спинке — ряд посреди зала; тон у каждой свой. */
function seatsDouble(xf: Xf, seed: number): void {
  s3Put(xf, ROW_BENCH, { tint: jitter(seed) });
  s3Put(xf.child(0, 0, 0, 2), ROW_BENCH, { tint: jitter(seed, 0.07, 1) });
}

// ───────────────────────────── камеры хранения ─────────────────────────────

function lockers(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const ajarC = Math.floor(rnd() * 3);
  const ajarR = 1 + Math.floor(rnd() * 3);
  // Корпус, цоколь, козырёк.
  bx(xf, [-0.675, 0.1, 0], [0.675, 1.86, 0.3], MAT.metalGreen, STEEL_DK, { bevel: 0.008, skip: ['nz', 'ny'] });
  bx(xf, [-0.65, 0, 0.02], [0.65, 0.1, 0.28], MAT.metalGreen, [0.4, 0.5, 0.45], { skip: ['ny'] });
  bx(xf, [-0.685, 1.86, 0], [0.685, 1.9, 0.32], MAT.metalGreen, STEEL, { bevel: 0.006, skip: ['nz', 'ny'] });
  const th = (26 * Math.PI) / 180;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = (c - 1) * 0.44;
      const y0 = 0.13 + r * 0.43;
      const col = (r + c) % 2 === 0 ? TEAL : MUSTARD;
      const ajar = c === ajarC && r === ajarR;
      if (!ajar) {
        bx(xf, [cx - 0.205, y0, 0.3], [cx + 0.205, y0 + 0.41, 0.33], MAT.enamel, col, { bevel: 0.004, skip: ['nz'] });
        // Ручка-кружок и светлая табличка.
        cy(xf, [cx + 0.11, y0 + 0.15, 0.33], 'z', 0.014, 0.02, MAT.steel, STEEL_LT, 8);
        bx(xf, [cx - 0.1, y0 + 0.29, 0.33], [cx + 0.03, y0 + 0.35, 0.334], MAT.paper, LIGHT, { skip: ['nz'] });
        continue;
      }
      // Тёмный проём и дверца, повисшая на левой петле, развёрнутая наружу на 26°.
      bx(xf, [cx - 0.198, y0 + 0.004, 0.3], [cx + 0.198, y0 + 0.406, 0.304], MAT.rubber, [0.3, 0.36, 0.33], { skip: ['nz'] });
      const h: Vec3 = [cx - 0.205, y0 + 0.205, 0.315];
      const dv: Vec3 = [Math.cos(th), 0, Math.sin(th)];
      const nv: Vec3 = [-Math.sin(th), 0, Math.cos(th)];
      beam(xf, h, add3(h, dv, 0.41), 0.41, 0.03, MAT.enamel, col, { side: UP });
      const knob = add3(add3(h, dv, 0.3), nv, 0.022);
      beam(xf, add3(knob, dv, -0.012), add3(knob, dv, 0.012), 0.024, 0.014, MAT.steel, STEEL_LT, { side: UP });
      const pl = add3(add3(add3(h, dv, 0.06), nv, 0.0175), UP, 0.1);
      beam(xf, pl, add3(pl, dv, 0.14), 0.06, 0.004, MAT.paper, LIGHT, { side: UP });
    }
  }
  xf.collider([-0.685, 0, 0], [0.685, 1.9, 0.34]);
}

// ───────────────────────────── касса ─────────────────────────────

function ticketWindow(xf: Xf): void {
  // Тумба-прилавок с цоколем, столешница, три светлых филёнки спереди.
  bx(xf, [-0.73, 0.08, 0.02], [0.4, 0.95, 0.5], MAT.plaster, CREAM, { bevel: 0.006, skip: ['ny', 'nz'] });
  bx(xf, [-0.7, 0, 0.05], [0.37, 0.08, 0.47], MAT.plaster, STONE_DK, { skip: ['ny'] });
  bx(xf, [-0.75, 0.95, 0], [0.42, 0.99, 0.52], MAT.wood, WOOD, { bevel: 0.006, skip: ['ny', 'nz'] });
  for (const cx of [-0.5, -0.17, 0.16]) bx(xf, [cx - 0.14, 0.15, 0.5], [cx + 0.14, 0.85, 0.512], MAT.plaster, STONE, { bevel: 0.004, skip: ['nz'] });
  // Рама над прилавком: щель для бумаг между столешницей и нижней планкой, стекло, верхняя планка и табличка.
  const F0 = 0.2;
  const F1 = 0.28;
  bx(xf, [-0.7, 0.99, F0], [-0.64, 2.02, F1], MAT.wood, WOOD, { bevel: 0.004, skip: ['ny'] });
  bx(xf, [0.29, 0.99, F0], [0.35, 2.02, F1], MAT.wood, WOOD, { bevel: 0.004, skip: ['ny'] });
  bx(xf, [-0.64, 1.08, F0], [0.29, 1.2, F1], MAT.wood, WOOD, { bevel: 0.004 });
  bx(xf, [-0.64, 1.88, F0], [0.29, 2.02, F1], MAT.wood, WOOD, { bevel: 0.004 });
  // Стекло. За ним — не каморка кассира, а ложная комната (render/shaders.ts, fakeHall): тот же зал под
  // стеклянной крышей, пустой, в вечернем свете. Это обманка зала ожидания: геометрии за окном нет.
  // Оттенок вершин у такого окна — его размеры: ширина, высота и высота нижнего края над полом.
  if (xf.sl) xf.sl.quadUv([xf.pt(-0.64, 1.2, 0.232), xf.pt(0.29, 1.2, 0.232), xf.pt(0.29, 1.88, 0.232), xf.pt(-0.64, 1.88, 0.232)], [0, 0, 1, 1], MAT.glass, [0.93, 0.68, 1.2], 1);
  else bx(xf, [-0.64, 1.2, 0.228], [0.29, 1.88, 0.236], MAT.glass, GLASS);
  bx(xf, [-0.5, 2.02, 0.21], [0.15, 2.1, 0.27], MAT.paper, LIGHT, { bevel: 0.004, skip: ['ny'] });
  // Полочка для мелочи в щели: лоток с бортиками и тёмным резиновым ковриком.
  bx(xf, [-0.3, 0.99, 0.28], [-0.05, 1.005, 0.46], MAT.metalGreen, STEEL, { skip: ['ny'] });
  bx(xf, [-0.3, 1.005, 0.452], [-0.05, 1.03, 0.46], MAT.metalGreen, STEEL, { skip: ['ny'] });
  bx(xf, [-0.3, 1.005, 0.28], [-0.292, 1.03, 0.452], MAT.metalGreen, STEEL, { skip: ['ny'] });
  bx(xf, [-0.058, 1.005, 0.28], [-0.05, 1.03, 0.452], MAT.metalGreen, STEEL, { skip: ['ny'] });
  bx(xf, [-0.29, 1.005, 0.29], [-0.06, 1.008, 0.45], MAT.rubber, [0.45, 0.5, 0.48], { skip: ['ny'] });
  // Узкая стойка сбоку: цоколь, тумба, деревянная крышка и светлая табличка.
  bx(xf, [0.47, 0, 0.14], [0.73, 0.07, 0.4], MAT.plaster, STONE_DK, { skip: ['ny'] });
  bx(xf, [0.49, 0.07, 0.16], [0.71, 1.05, 0.38], MAT.plaster, CREAM, { bevel: 0.006 });
  bx(xf, [0.45, 1.05, 0.1], [0.75, 1.09, 0.44], MAT.wood, WOOD, { bevel: 0.006 });
  bx(xf, [0.53, 0.68, 0.38], [0.67, 0.93, 0.384], MAT.paper, LIGHT, { skip: ['nz'] });
  xf.collider([-0.75, 0, 0], [0.75, 2.1, 0.52]);
}

// ───────────────────────────── табло ─────────────────────────────

function board(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Рама, тёмная панель, светлая шапка.
  bx(xf, [-1.3, 0, 0], [-1.24, 1.2, 0.12], MAT.metalGreen, STEEL_DK, { bevel: 0.005, skip: ['nz'] });
  bx(xf, [1.24, 0, 0], [1.3, 1.2, 0.12], MAT.metalGreen, STEEL_DK, { bevel: 0.005, skip: ['nz'] });
  bx(xf, [-1.24, 0, 0], [1.24, 0.06, 0.12], MAT.metalGreen, STEEL_DK, { bevel: 0.005, skip: ['nz'] });
  bx(xf, [-1.24, 1.1, 0], [1.24, 1.2, 0.12], MAT.metalGreen, STEEL, { bevel: 0.005, skip: ['nz'] });
  bx(xf, [-1.24, 0.06, 0], [1.24, 1.1, 0.06], MAT.bakelite, [0.4, 0.42, 0.45], { skip: ['nz'] });
  bx(xf, [-0.4, 1.12, 0.12], [0.4, 1.18, 0.124], MAT.paper, LIGHT, { skip: ['nz'] });
  // Семь рядов: время (два блока), назначение (длина разная), платформа. Каждая планка — две половинки с чёрной щелью.
  const lens = [0.55, 0.9, 0.7, 1.1, 0.8, 0.62, 0.95];
  for (let i = lens.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [lens[i], lens[j]] = [lens[j]!, lens[i]!];
  }
  const late = Math.floor(rnd() * 7);
  for (let r = 0; r < 7; r++) {
    const y0 = 0.1 + r * 0.12;
    const k = 0.9 + rnd() * 0.13;
    const t: Vec3 = r === late ? MUSTARD : [LIGHT[0] * k, LIGHT[1] * k, LIGHT[2] * k];
    const groups: [number, number][] = [
      [-1.15, -1.03],
      [-0.99, -0.87],
      [-0.75, -0.75 + lens[r]!],
      [0.95, 1.15],
    ];
    for (const [x0, x1] of groups) {
      bx(xf, [x0, y0 + 0.047, 0.06], [x1, y0 + 0.09, 0.072], MAT.paper, t, { skip: ['nz', 'nx', 'px', 'ny'] });
      bx(xf, [x0, y0, 0.06], [x1, y0 + 0.043, 0.072], MAT.paper, t, { skip: ['nz', 'nx', 'px'] });
    }
  }
}

// ───────────────────────────── часы ─────────────────────────────

function clock(xf: Xf): void {
  const C: Vec3 = [0, 0.35, 0];
  // Кронштейн: плита на стене, рука и подкос.
  bx(xf, [-0.07, 0.25, 0], [0.07, 0.45, 0.02], MAT.metalGreen, STEEL_DK, { bevel: 0.004, skip: ['nz'] });
  bx(xf, [-0.025, 0.335, 0.02], [0.025, 0.375, 0.1], MAT.metalGreen, STEEL_DK);
  beam(xf, [0, 0.22, 0.02], [0, 0.12, 0.12], 0.04, 0.03, MAT.metalGreen, STEEL_DK, { side: [1, 0, 0] });
  // Восьмигранный корпус, светлый циферблат.
  cy(xf, [C[0], C[1], 0.08], 'z', 0.14, 0.35, MAT.metalGreen, STEEL, 8);
  cy(xf, [C[0], C[1], 0.22], 'z', 0.008, 0.31, MAT.enamel, [1.5, 1.5, 1.4], 8);
  // Двенадцать рисок: по четвертям длиннее.
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    const q = h % 3 === 0;
    const r0 = q ? 0.22 : 0.255;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    beam(xf, [C[0] + dx * r0, C[1] + dy * r0, 0.231], [C[0] + dx * 0.295, C[1] + dy * 0.295, 0.231], 0.006, q ? 0.026 : 0.016, MAT.rubber, INK, { side: [0, 0, 1] });
  }
  // Стрелки на 17:50: часовая — 5 ч 50 мин, минутная — на десяти.
  const hand = (a: number, len: number, tail: number, w: number, z: number): void => {
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    beam(xf, [C[0] - dx * tail, C[1] - dy * tail, z], [C[0] + dx * len, C[1] + dy * len, z], 0.006, w, MAT.rubber, INK, { side: [0, 0, 1] });
  };
  hand(((5 + 50 / 60) * 30 * Math.PI) / 180, 0.17, 0.04, 0.034, 0.239);
  hand((300 * Math.PI) / 180, 0.265, 0.05, 0.022, 0.247);
  cy(xf, [C[0], C[1], 0.242], 'z', 0.012, 0.024, MAT.metalGreen, STEEL_DK, 8);
}

// ───────────────────────────── колонна ─────────────────────────────

function column(xf: Xf): void {
  bx(xf, [-0.275, 0, -0.275], [0.275, 0.25, 0.275], MAT.plaster, STONE_DK, { bevel: 0.01, skip: ['ny'] });
  bx(xf, [-0.25, 0.25, -0.25], [0.25, 0.32, 0.25], MAT.plaster, STONE, { bevel: 0.008 });
  bx(xf, [-0.22, 0.32, -0.22], [0.22, 5.8, 0.22], MAT.plaster, CREAM, { bevel: 0.03 });
  // Тёмная панель-обшивка в рост человека: вынесена на 2 мм от ствола.
  bx(xf, [-0.222, 0.32, -0.222], [0.222, 1.3, 0.222], MAT.plaster, STONE_DK, { bevel: 0.01, skip: ['py', 'ny'] });
  bx(xf, [-0.25, 5.8, -0.25], [0.25, 5.9, 0.25], MAT.plaster, STONE, { bevel: 0.008 });
  bx(xf, [-0.265, 5.9, -0.265], [0.265, 6.1, 0.265], MAT.plaster, CREAM, { bevel: 0.012 });
  bx(xf, [-0.275, 6.1, -0.275], [0.275, 6.2, 0.275], MAT.plaster, STONE, { bevel: 0.01, skip: ['py'] });
  xf.collider([-0.275, 0, -0.275], [0.275, 6.2, 0.275]);
}

// ───────────────────────────── таксофон ─────────────────────────────

function phone(xf: Xf): void {
  // Спинка, козырёк с щёчками, корпус, полочка с бортиком.
  bx(xf, [-0.2, 0.03, 0], [0.2, 0.7, 0.02], MAT.metalGreen, STEEL_DK, { skip: ['nz'] });
  bx(xf, [-0.25, 0.7, 0], [0.25, 0.75, 0.32], MAT.metalGreen, STEEL, { bevel: 0.01, skip: ['nz'] });
  for (const s of [-1, 1]) bx(xf, [s > 0 ? 0.22 : -0.25, 0.46, 0], [s > 0 ? 0.25 : -0.22, 0.7, 0.28], MAT.metalGreen, STEEL, { skip: ['nz', 'py'] });
  bx(xf, [-0.17, 0.1, 0.02], [0.17, 0.62, 0.17], MAT.metalGreen, STEEL, { bevel: 0.01 });
  bx(xf, [-0.2, 0, 0.02], [0.2, 0.03, 0.32], MAT.metalGreen, STEEL_DK, { skip: ['nz'] });
  bx(xf, [-0.2, 0.03, 0.3], [0.2, 0.06, 0.32], MAT.metalGreen, STEEL_DK);
  // Трубка слева: ручка и две чашки, рычаг под ней и витой шнур.
  const B = MAT.bakelite;
  const BK: Vec3 = [0.5, 0.5, 0.52];
  bx(xf, [-0.155, 0.3, 0.17], [-0.105, 0.56, 0.205], B, BK, { bevel: 0.006 });
  bx(xf, [-0.165, 0.5, 0.17], [-0.095, 0.58, 0.235], B, BK, { bevel: 0.008 });
  bx(xf, [-0.165, 0.26, 0.17], [-0.095, 0.34, 0.235], B, BK, { bevel: 0.008 });
  bx(xf, [-0.17, 0.43, 0.205], [-0.09, 0.46, 0.22], MAT.steel, STEEL_LT, { bevel: 0.004, skip: ['nz'] });
  const cord: Vec3[] = [
    [-0.13, 0.26, 0.2],
    [-0.105, 0.21, 0.2],
    [-0.15, 0.16, 0.2],
    [-0.12, 0.1, 0.17],
  ];
  for (let i = 0; i + 1 < cord.length; i++) beam(xf, cord[i]!, cord[i + 1]!, 0.012, 0.012, MAT.rubber, INK, { side: [0, 0, 1] });
  // Справа: светлое окошко, щель монетоприёмника, плита и девять кнопок.
  bx(xf, [0.02, 0.36, 0.17], [0.13, 0.44, 0.173], MAT.paper, LIGHT, { skip: ['nz'] });
  bx(xf, [0.04, 0.5, 0.17], [0.12, 0.56, 0.176], MAT.rubber, [0.35, 0.4, 0.38], { skip: ['nz'] });
  bx(xf, [0.065, 0.515, 0.176], [0.095, 0.545, 0.179], MAT.rubber, [0.2, 0.2, 0.2], { skip: ['nz'] });
  bx(xf, [-0.005, 0.125, 0.17], [0.135, 0.285, 0.174], MAT.rubber, [0.4, 0.45, 0.43], { skip: ['nz'] });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) bx(xf, [0.008 + c * 0.045, 0.135 + r * 0.047, 0.174], [0.038 + c * 0.045, 0.165 + r * 0.047, 0.19], MAT.enamel, LIGHT, { bevel: 0.003, skip: ['nz'] });
}

// ───────────────────────────── буфет ─────────────────────────────

function kiosk(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Прилавок: цоколь, тумба, четыре светлых филёнки, тёмная столешница.
  bx(xf, [-0.95, 0, 0.02], [0.95, 0.08, 0.62], MAT.plaster, STONE_DK, { skip: ['ny'] });
  bx(xf, [-0.97, 0.08, 0], [0.97, 0.95, 0.66], MAT.plaster, STONE, { bevel: 0.006, skip: ['ny', 'nz'] });
  for (const cx of [-0.72, -0.24, 0.24, 0.72]) bx(xf, [cx - 0.2, 0.2, 0.66], [cx + 0.2, 0.82, 0.672], MAT.plaster, CREAM, { bevel: 0.004, skip: ['nz'] });
  bx(xf, [-1.0, 0.95, 0], [1.0, 0.99, 0.7], MAT.wood, WOOD, { bevel: 0.006, skip: ['ny', 'nz'] });
  // Витрина слева: четыре стойки, крыша, задняя стенка, боковые стёкла и верхняя полоса стекла, две полки.
  for (const x of [-0.95, 0.07]) {
    for (const z of [0.12, 0.55]) bx(xf, [x, 0.99, z], [x + 0.03, 1.33, z + 0.03], MAT.metalGreen, STEEL, { skip: ['ny'] });
  }
  bx(xf, [-0.95, 1.33, 0.12], [0.1, 1.35, 0.58], MAT.metalGreen, STEEL, { bevel: 0.004, skip: ['py'] });
  bx(xf, [-0.92, 0.99, 0.12], [0.07, 1.33, 0.13], MAT.plaster, CREAM, { skip: ['ny'] });
  for (const [x0, x1] of [[-0.95, -0.947], [0.097, 0.1]] as const) bx(xf, [x0, 1.0, 0.15], [x1, 1.32, 0.55], MAT.glass, GLASS);
  bx(xf, [-0.92, 1.27, 0.55], [0.07, 1.32, 0.556], MAT.glass, GLASS);
  for (const y of [1.1, 1.21]) bx(xf, [-0.92, y, 0.13], [0.07, y + 0.013, 0.55], MAT.glass, GLASS);
  // Булочки и пирожки: на прилавке и обеих полках, по три-четыре штуки.
  const WARES: readonly Vec3[] = [MUSTARD, [1.15, 0.8, 0.5], CREAM, [1.0, 0.65, 0.4]];
  const levels = [0.99, 1.113, 1.223];
  levels.forEach((y, li) => {
    const n = 3 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = -0.85 + (i + 0.5) * (0.88 / n) + (rnd() - 0.5) * 0.04;
      const w = 0.07 + rnd() * 0.03;
      const hh = 0.04 + rnd() * 0.03;
      const z = 0.25 + rnd() * 0.15;
      bx(xf, [x - w / 2, y, z - 0.05], [x + w / 2, y + hh, z + 0.05], MAT.paper, WARES[(i + li) % WARES.length]!, { bevel: 0.012, skip: ['ny'] });
    }
  });
  for (const [y, x] of [[1.1, -0.6], [1.21, -0.3]] as const) bx(xf, [x, y, 0.55], [x + 0.08, y + 0.013, 0.554], MAT.paper, LIGHT, { skip: ['ny', 'nz'] });
  // Справа: поддон, бак с краником, стопка стаканов.
  bx(xf, [0.42, 0.99, 0.2], [0.74, 0.998, 0.55], MAT.metalGreen, STEEL_DK, { skip: ['ny'] });
  cy(xf, [0.58, 0.998, 0.36], 'y', 0.3, 0.13, MAT.steel, [0.95, 1.0, 0.95], 8);
  cy(xf, [0.58, 1.298, 0.36], 'y', 0.032, 0.14, MAT.metalGreen, STEEL, 8);
  cy(xf, [0.58, 1.33, 0.36], 'y', 0.02, 0.03, MAT.brass, BRASS, 6);
  for (const y of [1.15, 1.24]) cy(xf, [0.58, y, 0.36], 'y', 0.012, 0.136, MAT.metalGreen, STEEL_DK, 8);
  bx(xf, [0.565, 1.06, 0.49], [0.595, 1.1, 0.55], MAT.brass, BRASS, { bevel: 0.004 });
  bx(xf, [0.572, 1.01, 0.535], [0.588, 1.06, 0.55], MAT.brass, BRASS);
  bx(xf, [0.56, 1.1, 0.49], [0.6, 1.13, 0.51], MAT.paintRed, [1.1, 0.5, 0.45], { bevel: 0.004 });
  for (let i = 0; i < 3; i++) cy(xf, [0.9, 0.99 + i * 0.045, 0.4], 'y', 0.1, 0.03, MAT.glass, GLASS, 8, { radiusEnd: 0.042 });
  xf.collider([-1.0, 0, 0], [1.0, 1.35, 0.7]);
}

// ───────────────────────────── чемодан ─────────────────────────────

function suitcase(xf: Xf): void {
  const L: Vec3 = [0.8, 0.58, 0.42];
  const S: Vec3 = [0.6, 0.42, 0.3];
  // Корпус стоит на ребре, две ножки, два ремня вокруг, ручка поверх, замок.
  bx(xf, [-0.3, 0.02, -0.12], [0.3, 0.44, 0.12], MAT.leather, L, { bevel: 0.02 });
  for (const x of [-0.24, 0.24]) bx(xf, [x - 0.03, 0, -0.06], [x + 0.03, 0.02, 0.06], MAT.rubber, INK, { skip: ['ny'] });
  for (const x of [-0.14, 0.14]) {
    bx(xf, [x - 0.02, 0.03, 0.12], [x + 0.02, 0.45, 0.132], MAT.leather, S, { skip: ['nz'] });
    bx(xf, [x - 0.02, 0.44, -0.12], [x + 0.02, 0.45, 0.12], MAT.leather, S);
    bx(xf, [x - 0.02, 0.03, -0.132], [x + 0.02, 0.45, -0.12], MAT.leather, S, { skip: ['pz'] });
    bx(xf, [x - 0.018, 0.27, 0.132], [x + 0.018, 0.31, 0.138], MAT.steel, STEEL_LT, { skip: ['nz'] });
  }
  for (const x of [-0.07, 0.07]) bx(xf, [x - 0.012, 0.45, -0.014], [x + 0.012, 0.47, 0.014], MAT.leather, S, { skip: ['ny'] });
  bx(xf, [-0.082, 0.47, -0.016], [0.082, 0.48, 0.016], MAT.leather, S, { skip: ['ny'] });
  bx(xf, [-0.025, 0.38, 0.12], [0.025, 0.42, 0.128], MAT.steel, STEEL_LT, { skip: ['nz'] });
  for (const [x, y] of [[-0.3, 0.02], [0.3, 0.02], [-0.3, 0.44], [0.3, 0.44]] as const) {
    bx(xf, [x - (x < 0 ? 0 : 0.016), y - (y < 0.2 ? 0 : 0.016), 0.11], [x + (x < 0 ? 0.016 : 0), y + (y < 0.2 ? 0.016 : 0), 0.123], MAT.steel, STEEL_LT, { skip: ['nz'] });
  }
}

// ───────────────────────────── урна ─────────────────────────────

function bin(xf: Xf): void {
  cy(xf, [0, 0, 0], 'y', 0.03, 0.2, MAT.metalGreen, STEEL_DK, 8);
  cy(xf, [0, 0.03, 0], 'y', 0.63, 0.17, MAT.metalGreen, STEEL, 8, { radiusEnd: 0.19 });
  cy(xf, [0, 0.5, 0], 'y', 0.04, 0.2, MAT.steel, STEEL_LT, 8);
  cy(xf, [0, 0.66, 0], 'y', 0.036, 0.2, MAT.metalGreen, STEEL, 8);
  cy(xf, [0, 0.696, 0], 'y', 0.004, 0.15, MAT.rubber, [0.25, 0.28, 0.27], 8);
  xf.collider([-0.2, 0, -0.2], [0.2, 0.7, 0.2]);
}

// ───────────────────────────── указатель ─────────────────────────────

function sign(xf: Xf): void {
  const PL: Vec3 = [0.3, 0.62, 0.56];
  bx(xf, [-0.6, -0.4, 0.015], [0.6, -0.15, 0.045], MAT.enamel, PL, { bevel: 0.004 });
  // Два тросика с проушинами.
  for (const x of [-0.45, 0.45]) {
    bx(xf, [x - 0.003, -0.14, 0.027], [x + 0.003, 0, 0.033], MAT.metalGreen, STEEL_DK, { skip: ['py'] });
    bx(xf, [x - 0.012, -0.15, 0.02], [x + 0.012, -0.14, 0.04], MAT.metalGreen, STEEL_DK, { skip: ['ny'] });
  }
  // Стрелка из блоков (вправо) и светлый квадрат слева, с обеих сторон.
  const cyl = -0.275;
  const arrow: [number, number, number][] = [
    [-0.4, 0.14, 0.025],
    [0.14, 0.2, 0.09],
    [0.2, 0.26, 0.065],
    [0.26, 0.32, 0.04],
    [0.32, 0.36, 0.015],
  ];
  for (const [z0, z1, face] of [[0.045, 0.053, 'pz'], [0.007, 0.015, 'nz']] as const) {
    for (const [x0, x1, hh] of arrow) bx(xf, [x0, cyl - hh, z0], [x1, cyl + hh, z1], MAT.paper, LIGHT, { skip: face === 'pz' ? ['nz'] : ['pz'] });
    bx(xf, [-0.56, -0.36, z0], [-0.44, -0.2, z1], MAT.paper, LIGHT, { skip: face === 'pz' ? ['nz'] : ['pz'] });
  }
}

// ───────────────────────────── ограждение ─────────────────────────────

function barrier(xf: Xf): void {
  for (const x of [-0.65, 0.65]) {
    cy(xf, [x, 0, 0], 'y', 0.03, 0.15, MAT.metalGreen, STEEL_DK, 8);
    cy(xf, [x, 0.03, 0], 'y', 0.03, 0.15, MAT.steel, STEEL_LT, 8, { radiusEnd: 0.045 });
    cy(xf, [x, 0.06, 0], 'y', 0.82, 0.022, MAT.steel, STEEL_LT, 6);
    cy(xf, [x, 0.88, 0], 'y', 0.07, 0.034, MAT.brass, BRASS, 8, { radiusEnd: 0.04 });
  }
  // Лента: девять звеньев по дуге провиса, лента плоская, стоймя.
  const pts: Vec3[] = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const x = -0.65 + t * 1.3;
    return [x, 0.84 - 0.11 * (1 - Math.pow(2 * t - 1, 2)), 0];
  });
  for (let i = 0; i + 1 < pts.length; i++) beam(xf, pts[i]!, pts[i + 1]!, 0.05, 0.008, MAT.canvas, MUSTARD, { side: UP });
  for (const x of [-0.65, 0.65]) bx(xf, [x - 0.02, 0.8, -0.014], [x + 0.02, 0.86, 0.014], MAT.brass, BRASS, { skip: [] });
}

// ───────────────────────────── мелкие вещи-воспоминания ─────────────────────────────

/** Сложенный вдвое листок: двускатная «палатка» с тремя тёмными строчками на левой половинке. */
function note(xf: Xf): void {
  const paper: Vec3 = [1.45, 1.4, 1.2];
  beam(xf, [-0.08, 0.0035, 0], [0, 0.0265, 0], 0.11, 0.003, MAT.paper, paper, { side: [0, 0, 1] });
  beam(xf, [0, 0.0265, 0], [0.08, 0.0035, 0], 0.11, 0.003, MAT.paper, [paper[0] * 0.92, paper[1] * 0.92, paper[2] * 0.92], { side: [0, 0, 1] });
  // Строчки лежат на скате, вдоль сгиба.
  const k = 0.0265 - 0.0035;
  const len = Math.hypot(0.08, k);
  const tx = 0.08 / len;
  const ty = k / len;
  const nx = -ty;
  const ny = tx;
  for (const [u, z0, z1] of [[0.2, -0.04, 0.035], [0.5, -0.04, 0.02], [0.8, -0.04, 0.03]] as const) {
    const px = -0.08 + 0.08 * u + nx * 0.0024;
    const py = 0.0035 + k * u + ny * 0.0024;
    beam(xf, [px, py, z0], [px, py, z1], 0.007, 0.0014, MAT.rubber, INK, { side: [tx, ty, 0] });
  }
}

/** Ключ с большой овальной биркой на кольце: лежит плашмя вдоль x. Латунный: на тёмном полу виден. */
function key(xf: Xf): void {
  const ellipse = (cx: number, cz: number, rx: number, rz: number): [number, number][] => Array.from({ length: 8 }, (_, i) => [cx + Math.cos((i / 8) * Math.PI * 2) * rx, cz + Math.sin((i / 8) * Math.PI * 2) * rz]);
  prism(xf, ellipse(-0.045, 0, 0.026, 0.026), 0, 0.012, MAT.enamel, MUSTARD);
  cy(xf, [-0.058, 0.012, 0.0], 'y', 0.001, 0.006, MAT.rubber, INK, 6);
  // Кольцо через дырку бирки и крупное ушко ключа.
  ring(xf, [0.0, 0.007, 0], 'y', 0.015, 0.01, 8, MAT.brass, BRASS);
  ring(xf, [0.034, 0.005, 0], 'y', 0.01, 0.01, 8, MAT.brass, BRASS);
  // Стержень пошире и две зубца бородки.
  bx(xf, [0.042, 0, -0.005], [0.07, 0.01, 0.005], MAT.brass, BRASS, { bevel: 0.001 });
  bx(xf, [0.05, 0, 0.005], [0.057, 0.01, 0.016], MAT.brass, BRASS, { skip: ['nx', 'px'] });
  bx(xf, [0.062, 0, 0.005], [0.069, 0.01, 0.012], MAT.brass, BRASS, { skip: ['nx', 'px'] });
}

/** Картонный билет с отрывным краем и двумя полосками. */
function ticket(xf: Xf): void {
  bx(xf, [-0.06, 0, -0.03], [-0.037, 0.006, 0.03], MAT.cardboard, [1.25, 1.15, 0.92]);
  bx(xf, [-0.037, 0, -0.03], [0.06, 0.006, 0.03], MAT.cardboard, [1.5, 1.42, 1.15]);
  // Перфорация: пять тёмных точек вдоль отрыва.
  for (let i = 0; i < 5; i++) bx(xf, [-0.039, 0.006, -0.026 + i * 0.013], [-0.035, 0.0066, -0.022 + i * 0.013], MAT.rubber, INK, { skip: ['ny'] });
  bx(xf, [-0.01, 0.006, -0.022], [0.05, 0.0068, -0.012], MAT.enamel, TEAL, { skip: ['ny'] });
  bx(xf, [-0.01, 0.006, 0.004], [0.05, 0.0068, 0.014], MAT.enamel, MUSTARD, { skip: ['ny'] });
}

/** Бумажный стакан: восьмигранный конус, поясок, чёрный кофе и три струйки пара из блоков. */
function cup(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  cy(xf, [0, 0, 0], 'y', 0.1, 0.032, MAT.paper, [1.5, 1.45, 1.3], 8, { radiusEnd: 0.045 });
  cy(xf, [0, 0.035, 0], 'y', 0.025, 0.0381, MAT.enamel, TEAL, 8, { radiusEnd: 0.0413 });
  cy(xf, [0, 0.1, 0], 'y', 0.002, 0.04, MAT.wood, [0.35, 0.25, 0.18], 8);
  // Пар: три столбика из трёх блоков со сдвигом вправо-влево.
  const wisps: [number, number, number][] = [
    [-0.02, 0.0, 0.03],
    [0.0, 0.01, 0.03],
    [0.02, -0.005, 0.03],
  ];
  wisps.forEach(([x, z, h]) => {
    const flip = rnd() < 0.5 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const y0 = 0.11 + k * h;
      const dx = (k % 2 === 0 ? -0.007 : 0.007) * flip;
      bx(xf, [x + dx - 0.006, y0, z - 0.006], [x + dx + 0.006, y0 + h, z + 0.006], MAT.paper, [1.5, 1.5, 1.45], { skip: k === 0 ? ['ny'] : [] });
    }
  });
}

/** Пальто, брошенное на сиденье: спинка тянется вверх, воротник, свесившийся рукав, подкладка. */
function coat(xf: Xf): void {
  const C: Vec3 = [0.5, 0.52, 0.56];
  const C2: Vec3 = [0.58, 0.6, 0.64];
  // Часть на сиденье и спинка, опирающаяся на спинку сиденья.
  bx(xf, [-0.225, 0, -0.05], [0.205, 0.07, 0.24], MAT.upholstery, C, { bevel: 0.02 });
  beam(xf, [-0.01, 0.05, -0.02], [-0.01, 0.46, -0.18], 0.42, 0.1, MAT.upholstery, C2, { side: [1, 0, 0] });
  // Воротник и светлая изнанка в вырезе.
  bx(xf, [-0.17, 0.43, -0.24], [0.17, 0.5, -0.14], MAT.upholstery, [0.45, 0.47, 0.5], { bevel: 0.015 });
  bx(xf, [-0.05, 0.435, -0.141], [0.05, 0.49, -0.136], MAT.canvas, [1.1, 0.8, 0.4], { skip: ['nz'] });
  // Свесившийся рукав и манжета.
  const a: Vec3 = [0.17, 0.4, -0.15];
  const b: Vec3 = [0.215, 0.07, 0.17];
  beam(xf, a, b, 0.1, 0.09, MAT.upholstery, C2, { side: [1, 0, 0] });
  beam(xf, add3(b, [0, 0, 1], -0.015), add3(b, [0, 0, 1], 0.03), 0.095, 0.085, MAT.upholstery, [0.4, 0.42, 0.45], { side: [1, 0, 0] });
  // Второй рукав: сложенный комок слева.
  bx(xf, [-0.27, 0, 0.02], [-0.2, 0.075, 0.24], MAT.upholstery, C, { bevel: 0.02 });
  snow(xf);
}

/**
 * Снег на пальто: его принесли с зимней улицы, и он не тает — «it smells of a station». Главная деталь,
 * видная издалека: белое на тёмном сукне; холодный свет сверху даёт свет памяти (world/memory_light.ts).
 * Лежит на том, что смотрит вверх: на плечах у воротника и на полах.
 */
function snow(xf: Xf): void {
  const S: Vec3 = [1.45, 1.48, 1.5];
  const S2: Vec3 = [1.4, 1.44, 1.5];
  // Комья без фасок и без нижней грани: снег лежит на сукне, а бюджет предмета невелик.
  const o: BoxOpts = { skip: ['ny'] };
  // Плечи и воротник.
  bx(xf, [-0.16, 0.5, -0.232], [-0.02, 0.522, -0.152], MAT.paper, S, o);
  bx(xf, [0.01, 0.5, -0.226], [0.15, 0.516, -0.158], MAT.paper, S2, o);
  bx(xf, [-0.215, 0.47, -0.215], [-0.15, 0.494, -0.15], MAT.paper, S, o);
  // Полы на сиденье — пятнами, не сплошь.
  bx(xf, [-0.2, 0.07, 0.02], [-0.06, 0.086, 0.13], MAT.paper, S, o);
  bx(xf, [-0.03, 0.07, 0.1], [0.11, 0.083, 0.22], MAT.paper, S2, o);
}

// ───────────────────────────── реестр ─────────────────────────────

export const STATION_PROPS: Record<string, PropSpec> = {
  st_seats: furnished('floor', WALL_BENCHES, 'скамья: деревянная со спинкой, синяя или парковая на чугунных ногах'),
  st_seats_double: { w: s3Size(ROW_BENCH).w, d: s3Size(ROW_BENCH).d * 2, h: s3Size(ROW_BENCH).h, mount: 'free', ru: 'две деревянные скамьи спинка к спинке', build: seatsDouble },
  st_lockers: { w: 1.35, d: 0.5, h: 1.9, mount: 'floor', ru: 'секция камер хранения 3×4, одна дверца приоткрыта', build: lockers },
  st_ticket_window: { w: 1.5, d: 0.5, h: 2.1, mount: 'floor', ru: 'окошко кассы: прилавок, рама со стеклом, полочка для мелочи, узкая стойка', build: (xf) => ticketWindow(xf) },
  st_board: { w: 2.6, d: 0.12, h: 1.2, mount: 'wall', y: 2.3, ru: 'табло отправления с перекидными планками без букв', build: board },
  st_clock: { w: 0.7, d: 0.25, h: 0.7, mount: 'wall', y: 2.6, ru: 'вокзальные часы на кронштейне, стрелки на 17:50', build: (xf) => clock(xf) },
  st_column: { w: 0.55, d: 0.55, h: 6.2, mount: 'free', ru: 'квадратная колонна с базой и капителью', build: (xf) => column(xf) },
  st_phone: { w: 0.5, d: 0.32, h: 0.75, mount: 'wall', y: 1.1, ru: 'настенный таксофон под козырьком', build: (xf) => phone(xf) },
  st_kiosk: { w: 2.0, d: 0.7, h: 1.35, mount: 'floor', ru: 'буфетный прилавок: витрина, бак с краником, стопка стаканов', build: kiosk },
  st_suitcase: { w: 0.6, d: 0.24, h: 0.48, mount: 'free', ru: 'чемодан с ручкой и двумя ремнями', build: (xf) => suitcase(xf) },
  st_bin: { w: 0.4, d: 0.4, h: 0.7, mount: 'free', ru: 'урна-восьмигранник с кольцом', build: (xf) => bin(xf) },
  st_sign: { w: 1.2, d: 0.06, h: 0.4, mount: 'ceiling', ru: 'подвесной указатель со стрелкой на двух тросиках', build: (xf) => hung(xf, 0.4, 0.35, () => sign(xf)) },
  st_barrier: { w: 1.6, d: 0.3, h: 0.95, mount: 'free', ru: 'две стойки ограждения с провисшей лентой', build: (xf) => barrier(xf) },
  st_note: { w: 0.16, d: 0.11, h: 0.03, mount: 'free', ru: 'сложенный вдвое листок с тремя тёмными строчками', build: (xf) => note(xf) },
  st_key: { w: 0.14, d: 0.06, h: 0.02, mount: 'free', ru: 'ключ с большой овальной биркой на кольце', build: (xf) => key(xf) },
  st_ticket: { w: 0.12, d: 0.06, h: 0.01, mount: 'free', ru: 'картонный билет с отрывным краем и двумя полосками', build: (xf) => ticket(xf) },
  st_cup: { w: 0.09, d: 0.09, h: 0.2, mount: 'free', ru: 'бумажный стакан с паром', build: cup },
  st_coat: { w: 0.55, d: 0.5, h: 0.5, mount: 'free', ru: 'пальто, брошенное на сиденье', build: (xf) => coat(xf) },
};
