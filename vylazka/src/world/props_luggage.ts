/**
 * Багаж: стена из старых чемоданов и дорожных сундуков, сложенных до потолка, и маленький штабель у стены.
 * Правила те же, что в props_station.ts: предмет описан в своих координатах (метры, y вверх), пол — y = 0;
 * floor — спина в z = 0, растёт в +z, по x центр. Лицевая сторона чемоданов смотрит в +z, в помещение.
 *
 * Кладка как у кирпича: внизу два ряда сундуков, выше — ряды чемоданов поменьше, лежащих плашмя. Швы соседних
 * рядов не совпадают; каждый чемодан ложится на то, что под ним (по «горизонту» высот), поэтому объёмы не
 * пересекаются и ничего не висит; верхний край ступенчатый — где-то стопка выше, где-то провал.
 * Скрытые грани не строятся: задние (nz) — никогда, нижние (ny) — у всего, что стоит на полу или на другом
 * чемодане. Мелочь (ручки, замки-защёлки, уголки, ремни, рейки) — только на лицевой стороне. Каждый слой
 * деталей вынесен от лица на свою высоту (3, 4,5, 5, 9, 12 мм), чтобы две грани не лежали в одной плоскости.
 * Надписей, цифр и марок нет. У каждого третьего-четвёртого чемодана на ручке бумажная бирка — пустая:
 * чья вещь и куда она ехала, не написано (в зале ожидания тот же знак — билет без пункта назначения).
 * Вся случайность — из rng(seed): один сид — одна и та же стена.
 */
import { hash01 } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { BoxOpts } from './kit';
import { MAT } from './materials';
import type { Xf } from './props';
import { dim, rng, WHITE } from './props_more';
import type { PropSpec } from './props_more';

// ───────────────────────────── палитра ─────────────────────────────

/**
 * Сундуки: тёмно-коричневый, чёрный, охристый, выцветший серо-бежевый. Оттенок умножается на цвет
 * материала корпуса, а кожа сама тёмная, поэтому множители больше единицы: иначе в светлом зале стена
 * чемоданов — чёрное пятно.
 */
const TRUNK_TINT: readonly Vec3[] = [
  [1.15, 0.95, 0.85],
  [0.5, 0.55, 0.62],
  [1.75, 1.35, 0.75],
  [1.5, 1.45, 1.3],
];
/** Чемоданы: шоколадный, каштановый, рыжий, песочный, серо-зелёный, чёрный, изредка серо-голубой. */
const CASE_TINT: readonly Vec3[] = [
  [1.1, 0.95, 0.85],
  [1.6, 1.2, 0.95],
  [2.1, 1.3, 0.9],
  [2.5, 2.4, 2.0],
  [1.25, 1.7, 1.55],
  [0.45, 0.52, 0.62],
  [1.15, 1.55, 2.0],
];
/** Фибра (картон) светлее кожи: тот же оттенок на ней берётся слабее. */
const FIBRE_K = 0.5;
const CASE_PICK: readonly number[] = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
const SLAT: Vec3 = [0.55, 0.4, 0.28];
const IRON: Vec3 = [0.32, 0.32, 0.35];
const STEEL_LT: Vec3 = [1.2, 1.25, 1.2];
const BRASS: Vec3 = [1.3, 1.15, 0.8];
const BRASS_DK: Vec3 = [0.4, 0.34, 0.2];
const STRAP: Vec3 = [0.34, 0.24, 0.18];
/** Бирка: плотная желтоватая бумага; шнурок — суровая нитка. */
const TAG: Vec3 = [1.0, 0.94, 0.8];
const TWINE: Vec3 = [0.55, 0.5, 0.42];

// ───────────────────────────── помощник ─────────────────────────────

/** Коробка с оттенком. */
function bx(xf: Xf, a: Vec3, b: Vec3, mat: number, tint: Vec3 = WHITE, o: BoxOpts = {}): void {
  xf.box(a, b, mat, { ...o, tint });
}

const ONLY_PZ = ['nx', 'px', 'ny', 'py', 'nz'] as const;

// ───────────────────────────── раскладка ─────────────────────────────

/** Корпус одного чемодана или сундука: коробка в координатах предмета, спиной к стене (z0 = 0). */
export interface LuggageBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  /** Лицевая сторона корпуса (без деталей). */
  z1: number;
  /** Номер ряда снизу. */
  row: number;
  /** Сундук (деревянные рейки, оковки) или чемодан (ручка, защёлки). */
  trunk: boolean;
  /** Сид его мелочей. */
  seed: number;
}

/** Ширина стены по умолчанию, м. */
const WALL_W = 4.2;
/** Выше этой отметки корпуса не поднимаются, м. */
const TOP = 2.48;
/** Шаг «горизонта» высот по x, м. */
const BIN = 0.005;

/** Размеры слоя: ширина, высота, глубина — от и до. */
const TRUNK_DIM = { w: [0.75, 0.95], h: [0.45, 0.52], d: [0.55, 0.72] } as const;
// Чемодан лежит плашмя: в ширину — его длина, в высоту — толщина. Мельче настоящего делать нельзя: планки вместо чемоданов.
const CASE_DIM = { w: [0.46, 0.76], h: [0.15, 0.24], d: [0.35, 0.5] } as const;

type Dim = typeof TRUNK_DIM | typeof CASE_DIM;

const between = (r: () => number, lo: number, hi: number): number => lo + r() * (hi - lo);

/**
 * Один ряд: ширины и зазоры так, чтобы ряд заполнил отрезок [from, to]; из нескольких попыток берётся та,
 * где меньше швов совпадает со швами ряда ниже (prev) в пределах 2,5 см.
 */
function splitRow(r: () => number, from: number, to: number, dm: Dim, prev: readonly number[]): { x0: number; x1: number }[] {
  const span = to - from;
  const nlo = Math.ceil(span / (dm.w[1] + 0.0055));
  const nhi = Math.floor(span / (dm.w[0] + 0.0055));
  let best: { x0: number; x1: number }[] | null = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 60 && bestScore > 0; attempt++) {
    const n = Math.min(nhi, nlo + Math.floor(Math.sqrt(r()) * (nhi - nlo + 1)));
    const gaps = Array.from({ length: n - 1 }, () => between(r, 0.003, 0.008));
    const u = Array.from({ length: n }, () => 0.75 + 0.5 * r());
    const room = span - gaps.reduce((s, g) => s + g, 0);
    const us = u.reduce((s, v) => s + v, 0);
    const ws = u.map((v) => (room * v) / us);
    if (ws.some((w) => w < dm.w[0] || w > dm.w[1])) continue;
    const row: { x0: number; x1: number }[] = [];
    let cur = from;
    let score = 0;
    for (let i = 0; i < n; i++) {
      row.push({ x0: cur, x1: cur + ws[i]! });
      cur += ws[i]!;
      if (i < n - 1) {
        const seam = cur + gaps[i]! / 2;
        if (prev.some((p) => Math.abs(p - seam) < 0.025)) score++;
        cur += gaps[i]!;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (best) return best;
  // Запасной путь: ровные ширины (в обычных размерах не нужен).
  const n = Math.max(1, Math.round(span / ((dm.w[0] + dm.w[1]) / 2)));
  const w = (span - (n - 1) * 0.005) / n;
  return Array.from({ length: n }, (_, i) => ({ x0: from + i * (w + 0.005), x1: from + i * (w + 0.005) + w }));
}

/**
 * Раскладка стены: список корпусов. Два нижних ряда — сундуки, выше — чемоданы. Каждый корпус ложится на
 * наибольшую высоту под собой (плюс щель 3–8 мм); то, что не помещается под потолок или над провалом, не строится,
 * и в верхней зоне часть корпусов выпадает случайно — отсюда ступенчатый верх.
 */
export function luggageLayout(seed: number, w = WALL_W): LuggageBox[] {
  const HALF = w / 2;
  const NB = Math.round(w / BIN);
  const r = rng(seed);
  const out: LuggageBox[] = [];
  const sky = new Float32Array(NB); // высота верха под каждым столбцом
  const front = new Float32Array(NB).fill(9); // лицо того, что под ним: выше нависать нельзя
  const void_ = new Uint8Array(NB); // столбцы, где корпус не построен: над ними пусто
  let prevSeams: number[] = [];

  for (let row = 0; row < 24; row++) {
    const trunk = row < 2;
    const dm: Dim = trunk ? TRUNK_DIM : CASE_DIM;
    const from = -HALF + between(r, 0.012, 0.03);
    const to = HALF - between(r, 0.012, 0.03);
    const cells = splitRow(r, from, to, dm, prevSeams);
    const placed: LuggageBox[] = [];
    // Высота ряда почти одна: разброс в пределах 1,5 см у чемоданов и 3 см у сундуков — иначе ряды растут по самому высокому.
    const rowH = between(r, dm.h[0] + 0.02, dm.h[1] - 0.02);
    const spread = trunk ? 0.02 : 0.015;
    for (const c of cells) {
      const lo = Math.max(0, Math.floor((c.x0 + HALF) / BIN));
      const hi = Math.min(NB - 1, Math.ceil((c.x1 + HALF) / BIN) - 1);
      let base = 0;
      let minFront = 9;
      let holes = 0;
      for (let i = lo; i <= hi; i++) {
        if (sky[i]! > base) base = sky[i]!;
        if (front[i]! < minFront) minFront = front[i]!;
        if (void_[i]) holes++;
      }
      // Над провалом корпус ложится, только если опирается хотя бы на две трети своей ширины.
      const hole = holes > (hi - lo + 1) * 0.3;
      const y0 = row === 0 ? 0 : base + between(r, 0.003, 0.008);
      // Под потолком корпус ужимается по высоте, если иначе не влезет, но не ниже минимума слоя.
      const h = Math.min(Math.max(dm.h[0], rowH + (r() * 2 - 1) * spread), Math.max(dm.h[0], TOP - y0));
      let z1 = between(r, dm.d[0], dm.d[1]) + (r() * 2 - 1) * 0.06;
      if (row > 0) z1 = Math.min(z1, minFront + 0.02);
      z1 = Math.max(0.25, z1);
      const dropP = Math.min(0.5, Math.max(0, (y0 - 2.0) * 1.5));
      const roll = r();
      const sd = Math.floor(r() * 0x7fffffff);
      if (row > 0 && (hole || y0 + h > TOP || roll < dropP)) {
        for (let i = lo; i <= hi; i++) void_[i] = 1;
        continue;
      }
      for (let i = lo; i <= hi; i++) {
        sky[i] = y0 + h;
        front[i] = z1;
      }
      placed.push({ x0: c.x0, x1: c.x1, y0, y1: y0 + h, z0: 0, z1, row, trunk, seed: sd });
    }
    if (placed.length === 0) break;
    out.push(...placed);
    // Швы этого ряда — для сравнения со следующим.
    prevSeams = [];
    for (let i = 0; i + 1 < placed.length; i++) {
      const gap = placed[i + 1]!.x0 - placed[i]!.x1;
      if (gap < 0.02) prevSeams.push(placed[i]!.x1 + gap / 2);
    }
  }
  return out;
}

// ───────────────────────────── чемодан ─────────────────────────────

/** Чемодан, лежащий плашмя: корпус, ручка на двух ушках, две защёлки, местами уголки и два ремня. */
function drawCase(xf: Xf, b: LuggageBox): void {
  const r = rng(b.seed);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const zf = b.z1;
  const cx = (b.x0 + b.x1) / 2;
  const base = CASE_TINT[CASE_PICK[Math.floor(r() * CASE_PICK.length)]!]!;
  const fibre = r() < 0.25;
  const k = (1.1 + 0.25 * r()) * (fibre ? FIBRE_K : 1);
  const tint = dim(base, k);
  bx(xf, [b.x0, b.y0, 0], [b.x1, b.y1, zf], fibre ? MAT.cardboard : MAT.leather, tint, { skip: ['nz', 'ny'], aoBottom: 0.8 });

  const dark = dim(tint, 0.55);
  // Ручка: планка на двух ушках посередине.
  const hy = b.y0 + h * 0.5;
  const bw = Math.min(0.075, Math.max(0.045, w * 0.16));
  for (const s of [-1, 1]) {
    bx(xf, [cx + s * (bw - 0.01) - 0.01, hy - 0.007, zf], [cx + s * (bw - 0.01) + 0.01, hy + 0.007, zf + 0.006], MAT.leather, dark, { skip: ['nz', 'pz', 'px', 'nx'] });
  }
  bx(xf, [cx - bw, hy - 0.007, zf + 0.006], [cx + bw, hy + 0.007, zf + 0.011], MAT.leather, dark, { skip: ['nz'] });

  // Бирка на шнурке под ручкой — у каждого третьего-четвёртого; на ней ничего не написано. Жребий свой,
  // не из общей последовательности: остальные мелочи чемодана от бирки не меняются.
  if (hash01(b.seed, 0x7a6, 17) < 0.3) {
    const tx = cx + (hash01(b.seed, 0x7a6, 31) < 0.5 ? -1 : 1) * bw * 0.55;
    const th = Math.min(0.075, h * 0.5 - 0.032);
    const top = hy - 0.007 - 0.014;
    if (th > 0.03) {
      bx(xf, [tx - 0.001, top, zf], [tx + 0.001, hy - 0.007, zf + 0.0015], MAT.canvas, TWINE, { skip: ONLY_PZ });
      bx(xf, [tx - 0.022, top - th, zf], [tx + 0.022, top, zf + 0.002], MAT.cardboard, TAG, { skip: ['nz'] });
    }
  }

  // Ремни — у трети чемоданов: два, вокруг корпуса; защёлки чуть ближе к ручке.
  const strapped = r() < 0.3;
  if (strapped) {
    for (const s of [-1, 1]) bx(xf, [cx + s * 0.34 * w - 0.012, b.y0 + 0.002, zf], [cx + s * 0.34 * w + 0.012, b.y1 - 0.002, zf + 0.004], MAT.leather, STRAP, { skip: ONLY_PZ });
  }
  // Две защёлки светлого металла на шве крышки.
  const ly = b.y0 + h * 0.72;
  for (const s of [-1, 1]) {
    bx(xf, [cx + s * 0.26 * w - 0.014, ly - 0.015, zf], [cx + s * 0.26 * w + 0.014, ly + 0.015, zf + 0.0055], MAT.steel, STEEL_LT, { skip: ['nz', 'nx', 'px'] });
  }
  // Металлические уголки на передних углах — примерно у половины.
  if (r() < 0.45) {
    const ch = Math.min(0.035, h * 0.3);
    for (const s of [-1, 1]) {
      const xa = s < 0 ? b.x0 + 0.002 : b.x1 - 0.032;
      const xb = xa + 0.03;
      const inner = s < 0 ? 'nx' : 'px';
      bx(xf, [xa, b.y0 + 0.002, zf], [xb, b.y0 + 0.002 + ch, zf + 0.004], MAT.steel, STEEL_LT, { skip: ['nz', 'ny', inner === 'nx' ? 'nx' : 'px'] });
      bx(xf, [xa, b.y1 - 0.002 - ch, zf], [xb, b.y1 - 0.002, zf + 0.004], MAT.steel, STEEL_LT, { skip: ['nz', 'py', inner === 'nx' ? 'nx' : 'px'] });
    }
  }
}

// ───────────────────────────── сундук ─────────────────────────────

/** Дорожный сундук: корпус, рейки поперёк лица, оковки по кромкам и углам, латунные замки, иногда боковые ручки. */
function drawTrunk(xf: Xf, b: LuggageBox, endL: boolean, endR: boolean): void {
  const r = rng(b.seed);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const zf = b.z1;
  const pick = Math.floor(r() * TRUNK_TINT.length);
  const k = 0.9 + 0.2 * r();
  const tint = dim(TRUNK_TINT[pick]!, k);
  const m = r();
  const bodyMat = pick >= 2 ? MAT.canvas : m < 0.6 ? MAT.leather : MAT.wood;
  // Холст и дерево светлее кожи: на них оттенок берётся слабее.
  const bodyTint = bodyMat === MAT.leather ? tint : dim(tint, 0.62);
  bx(xf, [b.x0, b.y0, 0], [b.x1, b.y1, zf], bodyMat, bodyTint, { skip: ['nz', 'ny'], aoBottom: 0.75 });

  // Деревянные рейки между верхней и нижней оковкой: две или три.
  const three = r() < 0.5;
  const slats = three ? [0.2, 0.5, 0.8] : [0.25, 0.75];
  const slatTint = dim(SLAT, k);
  for (const f of slats) {
    const x = b.x0 + w * f;
    bx(xf, [x - 0.0225, b.y0 + 0.034, zf], [x + 0.0225, b.y1 - 0.034, zf + 0.005], MAT.wood, slatTint, { skip: ['nz', 'ny', 'py'] });
  }
  // Железные кромки сверху и снизу и угловые оковки.
  bx(xf, [b.x0 + 0.006, b.y0 + 0.004, zf], [b.x1 - 0.006, b.y0 + 0.032, zf + 0.003], MAT.castIron, IRON, { skip: ['nz', 'ny', 'nx', 'px'] });
  bx(xf, [b.x0 + 0.006, b.y1 - 0.032, zf], [b.x1 - 0.006, b.y1 - 0.004, zf + 0.003], MAT.castIron, IRON, { skip: ['nz', 'py', 'nx', 'px'] });
  const ch = Math.min(0.07, h * 0.15);
  for (const s of [-1, 1]) {
    const xa = s < 0 ? b.x0 + 0.002 : b.x1 - 0.002 - 0.068;
    const xb = xa + 0.068;
    const outer = s < 0 ? 'nx' : 'px';
    bx(xf, [xa, b.y0 + 0.002, zf], [xb, b.y0 + 0.002 + ch, zf + 0.0045], MAT.steel, IRON, { skip: ['nz', 'ny', outer] });
    bx(xf, [xa, b.y1 - 0.002 - ch, zf], [xb, b.y1 - 0.002, zf + 0.0045], MAT.steel, IRON, { skip: ['nz', 'py', outer] });
  }
  // Латунные замки-накладки: один при двух рейках, один или два при трёх.
  const lockY = b.y0 + h * 0.6;
  const lockXs = three ? (r() < 0.5 ? [0.35, 0.65] : [0.35]) : [0.5];
  for (const f of lockXs) {
    const x = b.x0 + w * f;
    bx(xf, [x - 0.024, lockY - 0.035, zf], [x + 0.024, lockY + 0.035, zf + 0.009], MAT.brass, BRASS, { skip: ['nz'], bevel: 0 });
    bx(xf, [x - 0.005, lockY - 0.016, zf + 0.009], [x + 0.005, lockY + 0.006, zf + 0.012], MAT.brass, BRASS_DK, { skip: ['nz'] });
  }
  // Кожаные ручки по бокам — на крайних сундуках ряда, где не мешает сосед.
  if (r() < 0.6) {
    const hz = zf * 0.5;
    const hy = b.y0 + h * 0.55;
    if (endL) bx(xf, [b.x0 - 0.01, hy - 0.012, hz - 0.06], [b.x0, hy + 0.012, hz + 0.06], MAT.leather, STRAP, { skip: ['px', 'nz'] });
    if (endR) bx(xf, [b.x1, hy - 0.012, hz - 0.06], [b.x1 + 0.01, hy + 0.012, hz + 0.06], MAT.leather, STRAP, { skip: ['nx', 'nz'] });
  }
}

/** Нарисовать одну коробку раскладки; крайним в ряду сундукам разрешены боковые ручки. */
function drawBox(xf: Xf, b: LuggageBox, half: number): void {
  if (b.trunk) drawTrunk(xf, b, b.x0 < -half + 0.04, b.x1 > half - 0.04);
  else drawCase(xf, b);
}

// ───────────────────────────── стена ─────────────────────────────

function luggageWall(xf: Xf, seed: number, w: number): void {
  for (const b of luggageLayout(seed, w)) drawBox(xf, b, w / 2);
  // Преграда: одна коробка от пола до половины высоты по всей ширине и глубине.
  xf.collider([-w / 2, 0, 0], [w / 2, 1.25, 0.8]);
}

// ───────────────────────────── штабель ─────────────────────────────

/** Сундук внизу, на нём 4–5 чемоданов убывающей ширины, сдвинутых друг относительно друга (без поворота). */
function luggageStack(xf: Xf, seed: number): void {
  const r = rng(seed);
  let y = 0;
  const tw = between(r, 0.86, 0.94);
  const th = between(r, 0.42, 0.48);
  const tx = between(r, -0.02, 0.02);
  const tz = between(r, 0.46, 0.54);
  const trunk: LuggageBox = { x0: tx - tw / 2, x1: tx + tw / 2, y0: 0, y1: th, z0: 0, z1: tz, row: 0, trunk: true, seed: Math.floor(r() * 0x7fffffff) };
  drawTrunk(xf, trunk, false, false);
  y = th;
  const n = r() < 0.5 ? 4 : 5;
  let zPrev = tz;
  for (let i = 0; i < n; i++) {
    const w = (0.82 - i * 0.09) * between(r, 0.97, 1.03);
    const h = between(r, 0.12, 0.145);
    const lim = 0.5 - w / 2;
    const x = between(r, -Math.min(0.03, lim), Math.min(0.03, lim));
    const z1 = Math.max(0.28, Math.min(zPrev + 0.01, tz - 0.03 - i * 0.025 + between(r, -0.015, 0.015)));
    const y0 = y + between(r, 0.003, 0.006);
    drawCase(xf, { x0: x - w / 2, x1: x + w / 2, y0, y1: y0 + h, z0: 0, z1, row: i + 1, trunk: false, seed: Math.floor(r() * 0x7fffffff) });
    y = y0 + h;
    zPrev = z1;
  }
  xf.collider([-0.5, 0, 0], [0.5, 0.625, 0.6]);
}

// ───────────────────────────── реестр ─────────────────────────────

export const LUGGAGE_PROPS: Record<string, PropSpec> = {
  st_luggage_wall: {
    w: 2.7,
    d: 0.8,
    h: 2.5,
    mount: 'floor',
    ru: 'стена из чемоданов и дорожных сундуков, сложенных до потолка',
    build: (xf, seed) => luggageWall(xf, seed, 2.7),
  },
  st_luggage_stack: {
    w: 1.0,
    d: 0.6,
    h: 1.25,
    mount: 'floor',
    ru: 'штабель из пяти-шести чемоданов у стены',
    build: (xf, seed) => luggageStack(xf, seed),
  },
};
