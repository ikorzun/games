/**
 * Песчаный зал (партнёр 21.11, 19:13: «В другой комнате, песок на полу, комната огромная и песок словно барханами, из песка
 * торчат кости скелет огромного странного зверя»; design.md, §38; куратор, пачка 55, W-20: «карман с проходом из комнаты»).
 *
 * Зал больше того, что снаружи (обман ожиданий): в обычном помещении места дверной проём чёрен, из него на пол высыпался
 * песок (world/furnish_dunes.ts); шагнул в черноту — стоишь в проёме огромного зала, засыпанного песком. Проход — шов без
 * вспышки (game.ts, seam): шаг, взгляд и скорость те же, повёрнутые под проём зала. Обратно — тем же проёмом.
 *
 * Зал 48 × 66 м, стены уходят в темноту на 17 м. Высоко в левой стене — ряд окон: из них ровный холодный свет ложится на
 * гребни барханов, подветренные склоны в тени. Песок — рельеф (HeightField): по барханам ходят, а не упираются в них. У проёма
 * песок отступил ровной площадкой, к стенам намело горки. Посреди — скелет огромного странного зверя: хребет ныряет в песок
 * и выходит из него, над грудью рёбра стоят сводом выше человеческого роста — под ними можно пройти; череп с тремя парами
 * глазниц лежит у конца шеи, повёрнутый к проёму, рядом — отвалившаяся челюсть; из барханов торчат две кости лап и шестипалая
 * кисть, по песку раскиданы позвонки и обломки рёбер.
 *
 * Осыпи здесь нет: песок — её вещество, а её самой нет (куратор, W-20).
 *
 * Направление: проём в южной стене (z = oz), yaw 0 смотрит в −z, зал уходит в −z. Точка появления — в проёме. Координаты зала:
 * u — вбок от проёма (x = ox + u), v — вглубь (z = oz − v).
 */
import type { Vec3 } from '../core/types';
import { clamp, smoothstep } from '../core/math';
import { mulberry32 } from '../core/rng';
import type { Aabb, HeightField } from './colliders';
import { SILL } from './furnish_dunes';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import type { PocketBuilder, PocketSpace } from './pockets';

/** Размеры зала: ширина (u), длина (v), высота стен, шаг сетки песка, проём (ширина и высота в свету), м. */
export const DUNES = { w: 48, l: 66, wallH: 17, cell: 0.75, doorW: 0.9, doorH: 2.05 } as const;

/** Цвет песка: бледный, тёплый; гребни светлее впадин. */
const SAND: Vec3 = [1.18, 0.98, 0.7];
/** Кость: старая, желтоватая. */
const BONE: Vec3 = [0.9, 0.84, 0.7];
/** Глазницы — тёмные провалы. */
const HOLE: Vec3 = [0.035, 0.03, 0.03];

const fract = (x: number): number => x - Math.floor(x);

/** Профиль гряды по фазе s ∈ [0, 1): наветренный склон длинный и пологий, подветренный — короткий и крутой; гребень и впадина плавные. */
function ridge(s: number): number {
  const c = 0.66;
  const k = s < c ? Math.sin((Math.PI / 2) * (s / c)) : Math.cos((Math.PI / 2) * ((s - c) / (1 - c)));
  return k * k;
}

/**
 * Высота песка над полом зала, м: u — вбок от проёма (−w/2…w/2), v — вглубь от проёма (0…l). Главные гряды идут поперёк
 * ветра (ветер вдоль +u), гребни извилисты, высота плывёт вдоль гряды; поверх — мелкие гряды наискось и пологие холмы. У проёма
 * — ровная площадка вровень с порогом, к стенам песок наметён горкой.
 */
export function duneHeight(u: number, v: number, seed = 0): number {
  const p = (seed % 997) * 0.37;
  const warp = 3.4 * Math.sin(v * 0.105 + p) + 1.5 * Math.sin(v * 0.29 + 1.7 + p * 1.3);
  const s1 = fract((u + warp) / 13.5 + 0.11 * Math.sin(v * 0.047 + 0.6 + p));
  const amp = 1.15 + 0.45 * Math.sin(v * 0.071 + 2.1 + p) + 0.25 * Math.sin(u * 0.093 + v * 0.041 + p * 0.7);
  const s2 = fract((u * 0.78 + v * 0.62 + 1.2 * Math.sin(u * 0.21 + p)) / 5.3);
  const hill = 0.4 * Math.sin(u * 0.13 + 0.4 + p) * Math.sin(v * 0.09 + 1.1);
  const base = Math.max(0, amp * ridge(s1) + 0.22 * ridge(s2) + hill + 0.4);
  const dDoor = Math.hypot(u, v);
  const landing = smoothstep(2.4, 9, dDoor);
  const dWall = Math.min(DUNES.w / 2 - Math.abs(u), DUNES.l - v);
  const drift = 2.6 * (1 - smoothstep(0, 9, dWall)) * smoothstep(4, 11, dDoor);
  const south = 1.8 * (1 - smoothstep(0, 6, v)) * smoothstep(5, 12, Math.abs(u));
  // Порог засыпан на SILL — столько же песка у проёма на уровне (world/furnish_dunes.ts): шагнул туда и обратно — ноги на той же высоте.
  return SILL + landing * base + drift + south;
}

// ── Векторы ──
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Сумма векторов с весами. */
const comb = (...terms: [Vec3, number][]): Vec3 => {
  const out: Vec3 = [0, 0, 0];
  for (const [v, k] of terms) {
    out[0] += v[0] * k;
    out[1] += v[1] * k;
    out[2] += v[2] * k;
  }
  return out;
};
const UP: Vec3 = [0, 1, 0];

/**
 * Кость трубкой по ломаной: кольца с параллельным переносом рамки (без скручивания), радиус по доле длины, торцы закрыты.
 * Обход колец — наружу (как у MeshBuilder.cylinder).
 */
export function boneTube(mb: MeshBuilder, pts: readonly Vec3[], rad: (t: number) => number, tint: Vec3, sides = 6): void {
  const n = pts.length;
  if (n < 2) return;
  const T = pts.map((_, i) => norm(sub(pts[Math.min(n - 1, i + 1)]!, pts[Math.max(0, i - 1)]!)));
  const t0 = T[0]!;
  let N = norm(Math.abs(t0[1]) < 0.9 ? cross(t0, UP) : cross(t0, [1, 0, 0]));
  const rings: number[][] = [];
  const at: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    const t = T[i]!;
    if (i > 0) N = norm(sub(N, mul(t, dot(N, t))));
    const B = cross(t, N);
    const r = Math.max(0.004, rad(i / (n - 1)));
    const ring: number[] = [];
    const ringAt: Vec3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const d = comb([N, Math.cos(a)], [B, Math.sin(a)]);
      const p = add(pts[i]!, mul(d, r));
      ring.push(mb.vertex(p, d, MAT.plaster, tint, 1));
      ringAt.push(p);
    }
    rings.push(ring);
    at.push(ringAt);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      mb.tri(a[k]!, a[j]!, b[j]!);
      mb.tri(a[k]!, b[j]!, b[k]!);
    }
  }
  // Торцы: веер с нормалью торца (начало смотрит назад по длине, конец — вперёд).
  for (const [end, s] of [
    [0, -1],
    [n - 1, 1],
  ] as const) {
    const nn = mul(T[end]!, s);
    const c = mb.vertex(pts[end]!, nn, MAT.plaster, tint, 1);
    const ids = at[end]!.map((p) => mb.vertex(p, nn, MAT.plaster, tint, 1));
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      if (s < 0) mb.tri(c, ids[j]!, ids[k]!);
      else mb.tri(c, ids[k]!, ids[j]!);
    }
  }
}

/**
 * Эллипсоид в рамке (F, S, U — правая тройка: F × S = U) с полуосями r: черепная коробка, тело позвонка, глазница. Обход —
 * наружу.
 */
export function blob(mb: MeshBuilder, c: Vec3, F: Vec3, S: Vec3, U: Vec3, r: Vec3, tint: Vec3, seg = 8, rings = 6): void {
  const ids: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const ph = (k / seg) * Math.PI * 2;
      const lx = Math.sin(th) * Math.cos(ph);
      const ly = Math.sin(th) * Math.sin(ph);
      const lz = Math.cos(th);
      const p = comb([c, 1], [F, r[0] * lx], [S, r[1] * ly], [U, r[2] * lz]);
      const n = norm(comb([F, lx / r[0]], [S, ly / r[1]], [U, lz / r[2]]));
      row.push(mb.vertex(p, n, MAT.plaster, tint, 1));
    }
    ids.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < seg; k++) {
      const j = (k + 1) % seg;
      mb.tri(ids[i]![k]!, ids[i + 1]![k]!, ids[i + 1]![j]!);
      mb.tri(ids[i]![k]!, ids[i + 1]![j]!, ids[i]![j]!);
    }
  }
}

/** Рамка по направлению вперёд: F, S = U0 × F, U = F × S (правая тройка, U — ближе всего к верху). */
function frame(f: Vec3): [Vec3, Vec3, Vec3] {
  const F = norm(f);
  const S = norm(Math.abs(F[1]) > 0.97 ? cross([0, 0, 1], F) : cross(UP, F));
  const U = cross(F, S);
  return [F, S, U];
}

/** Точки кривой Катмулла — Рома через опорные точки (по `per` на отрезок). */
function catmull(pts: readonly [number, number][], per: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Ломаная, переразбитая равным шагом по длине. */
function resample(line: readonly [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [line[0]!];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - carry;
    while (t <= d) {
      out.push([a[0] + ((b[0] - a[0]) * t) / d, a[1] + ((b[1] - a[1]) * t) / d]);
      t += step;
    }
    carry = d - (t - step);
  }
  return out;
}

/** Хребет зверя в координатах зала (u, v): от кончика хвоста у правой стороны проёма — наискось к шее в глубине слева. */
export const SPINE: readonly [number, number][] = [
  [10.5, 9],
  [9.2, 13.5],
  [6.5, 18.5],
  [3.0, 23.5],
  [-0.8, 28.5],
  [-4.6, 33.0],
  [-7.8, 37.0],
  [-9.6, 40.2],
];

/** Высота хребта над песком по доле длины s (0 — кончик хвоста, 1 — конец шеи): хвост ныряет, грудь стоит сводом, шея опускается к черепу. */
export function spineLift(s: number): number {
  const chest = 4.9 * smoothstep(0.24, 0.38, s) * (1 - smoothstep(0.7, 0.9, s));
  const neck = 0.9 * smoothstep(0.8, 0.95, s);
  const tail = (1 - smoothstep(0.22, 0.32, s)) * (0.25 * Math.sin(s * 36 + 1.0) - 0.15);
  return chest + neck + tail;
}

export interface DunesInfo {
  /** Позвонки: центр и радиус (мир). */
  vertebrae: { at: Vec3; r: number }[];
  /** Рёбра: точки по длине (мир). */
  ribs: Vec3[][];
  /** Череп: центр черепной коробки и куда смотрит морда (мир, единичный, горизонтальный). */
  skull: { at: Vec3; face: [number, number] };
}

/** Собранный зал и то, что в нём стоит (для проверок). */
export interface DunesSpace extends PocketSpace {
  fields: HeightField[];
  dunes: DunesInfo;
}

export const buildDunes: PocketBuilder = (seed, origin): DunesSpace => {
  const [ox, oy, oz] = origin;
  const rnd = mulberry32((seed ^ 0x51d2) >>> 0);
  const mb = new MeshBuilder();
  const colliders: Aabb[] = [];
  const H = (u: number, v: number): number => duneHeight(u, Math.max(0, v), seed);
  const W = (u: number, v: number, y: number): Vec3 => [ox + u, oy + y, oz - v];
  const ground = (x: number, z: number): number => oy + H(x - ox, oz - z);
  const { w, l, wallH, cell, doorW, doorH } = DUNES;

  // ── Песок: сетка со сглаженными нормалями; впадины темнее, гребни светлее ──
  const nu = Math.round(w / cell);
  const nv = Math.round(l / cell);
  const grid: number[][] = [];
  const e = 0.35;
  for (let j = 0; j <= nv; j++) {
    const v = j * cell;
    const row: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = -w / 2 + i * cell;
      const h = H(u, v);
      const hu = (H(u + e, v) - H(u - e, v)) / (2 * e);
      const hv = (H(u, v + e) - H(u, v - e)) / (2 * e);
      // Мир: x = ox + u, z = oz − v → dh/dx = hu, dh/dz = −hv.
      const n = norm([-hu, 1, hv]);
      const around = (H(u + 1.6, v) + H(u - 1.6, v) + H(u, v + 1.6) + H(u, v - 1.6)) / 4;
      const cave = around - h;
      const ao = clamp(1 - cave * 0.45, 0.5, 1.06);
      const lit = clamp(0.94 - cave * 0.12 + (rnd() - 0.5) * 0.04, 0.82, 1.06);
      row.push(mb.vertex(W(u, v, h), n, MAT.dirt, [SAND[0] * lit, SAND[1] * lit, SAND[2] * lit], ao));
    }
    grid.push(row);
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      // p00 — (i, j), ближе к проёму (больше z); p01 — (i, j + 1), глубже (меньше z).
      const p00 = grid[j]![i]!;
      const p10 = grid[j]![i + 1]!;
      const p01 = grid[j + 1]![i]!;
      const p11 = grid[j + 1]![i + 1]!;
      mb.tri(p01, p00, p11);
      mb.tri(p11, p00, p10);
    }
  }
  const fields: HeightField[] = [{ minX: ox - w / 2, minZ: oz - l, maxX: ox + w / 2, maxZ: oz + 0.6, at: ground }];
  colliders.push({ minX: ox - w / 2, minY: oy - 0.6, minZ: oz - l, maxX: ox + w / 2, maxY: oy + SILL, maxZ: oz + 0.6 });

  // ── Стены: бетон уходит в темноту; в южной — проём ──
  const wallTint: Vec3 = [0.6, 0.58, 0.56];
  const T = 0.5;
  const wall = (min: Vec3, max: Vec3): void => {
    mb.box(min, max, MAT.concrete, { tint: wallTint, aoBottom: 0.6 });
    colliders.push({ minX: min[0], minY: min[1], minZ: min[2], maxX: max[0], maxY: max[1], maxZ: max[2] });
  };
  wall([ox - w / 2 - T, oy - 1, oz - l - T], [ox - w / 2, oy + wallH, oz + T]);
  wall([ox + w / 2, oy - 1, oz - l - T], [ox + w / 2 + T, oy + wallH, oz + T]);
  wall([ox - w / 2, oy - 1, oz - l - T], [ox + w / 2, oy + wallH, oz - l]);
  wall([ox - w / 2, oy - 1, oz], [ox - doorW / 2, oy + wallH, oz + T]);
  wall([ox + doorW / 2, oy - 1, oz], [ox + w / 2, oy + wallH, oz + T]);
  wall([ox - doorW / 2, oy + doorH, oz], [ox + doorW / 2, oy + wallH, oz + T]);
  // Коробка проёма — серая, без двери.
  const frameT: Vec3 = [0.75, 0.73, 0.7];
  mb.box([ox - doorW / 2 - 0.09, oy, oz - 0.07], [ox - doorW / 2, oy + doorH + 0.09, oz + 0.05], MAT.wood, { tint: frameT, bevel: 0.01 });
  mb.box([ox + doorW / 2, oy, oz - 0.07], [ox + doorW / 2 + 0.09, oy + doorH + 0.09, oz + 0.05], MAT.wood, { tint: frameT, bevel: 0.01 });
  mb.box([ox - doorW / 2, oy + doorH, oz - 0.07], [ox + doorW / 2, oy + doorH + 0.09, oz + 0.05], MAT.wood, { tint: frameT, bevel: 0.01 });
  // В проёме — чернота: обратная сторона той, что видна из коридора. За ней — преграда, чтобы не уйти в толщу стены.
  mb.quad([ox + doorW / 2, oy, oz + 0.22], [ox - doorW / 2, oy, oz + 0.22], [ox - doorW / 2, oy + doorH, oz + 0.22], [ox + doorW / 2, oy + doorH, oz + 0.22], MAT.plaster, [0, 0, 0], 1);
  colliders.push({ minX: ox - doorW / 2 - 0.05, minY: oy, minZ: oz + 0.32, maxX: ox + doorW / 2 + 0.05, maxY: oy + doorH, maxZ: oz + 0.6 });

  // ── Окна высоко в левой стене: холодный ровный свет; переплёт решёткой ──
  const winGlow: Vec3 = [9, 10.2, 12.8];
  const wx = ox - w / 2 + 0.02;
  for (let k = 0; k < 7; k++) {
    const vz = 9 + k * 8;
    const z0 = oz - vz - 1.2;
    const z1 = oz - vz + 1.2;
    const y0 = oy + 10;
    const y1 = oy + 15.5;
    mb.quad([wx, y0, z1], [wx, y0, z0], [wx, y1, z0], [wx, y1, z1], MAT.glow, winGlow, 1);
    const bar = (a: Vec3, b: Vec3): void => mb.box(a, b, MAT.concrete, { tint: [0.3, 0.3, 0.3] });
    bar([wx, y0, oz - vz - 0.06], [wx + 0.12, y1, oz - vz + 0.06]);
    for (let r = 1; r < 4; r++) {
      const y = y0 + ((y1 - y0) * r) / 4;
      bar([wx, y - 0.05, z0], [wx + 0.12, y + 0.05, z1]);
    }
    bar([wx, y0 - 0.12, z0 - 0.1], [wx + 0.25, y0, z1 + 0.1]);
  }

  // ── Скелет ──
  const info: DunesInfo = { vertebrae: [], ribs: [], skull: { at: [0, 0, 0], face: [0, 1] } };
  const line = resample(catmull(SPINE, 10), 0.95);
  const count = line.length;
  // Песок под хребтом, сглаженный вдоль него: грудь стоит ровным сводом, а не повторяет каждый бархан.
  const raw = line.map(([u, v]) => H(u, v));
  const smooth = raw.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -4; k <= 4; k++) {
      const q = raw[clamp(i + k, 0, count - 1)]!;
      s += q;
      n++;
    }
    return s / n;
  });
  const spine: Vec3[] = line.map(([u, v], i) => {
    const s = i / (count - 1);
    const chest = smoothstep(0.24, 0.38, s) * (1 - smoothstep(0.7, 0.9, s));
    const g = raw[i]! + (smooth[i]! - raw[i]!) * chest;
    return W(u, v, g + spineLift(s));
  });
  const radiusAt = (s: number): number => 0.22 + 0.36 * Math.pow(Math.sin(Math.PI * clamp((s - 0.02) / 0.92, 0, 1)), 0.7);
  const boneTint = (): Vec3 => {
    const k = 0.95 + rnd() * 0.1;
    return [BONE[0] * k, BONE[1] * k, BONE[2] * (k - 0.03)];
  };
  for (let i = 0; i < count; i++) {
    const s = i / (count - 1);
    const P = spine[i]!;
    const tg = norm(sub(spine[Math.min(count - 1, i + 1)]!, spine[Math.max(0, i - 1)]!));
    const [F, S, U] = frame(tg);
    const r = radiusAt(s);
    const tint = boneTint();
    const chest = smoothstep(0.3, 0.4, s) * (1 - smoothstep(0.66, 0.76, s));
    info.vertebrae.push({ at: P, r });
    // Тело позвонка: короткое вдоль хребта.
    blob(mb, P, F, S, U, [0.55 * r, r, 0.9 * r], tint, 8, 5);
    // Остистые отростки: на груди — парные, разведённые, как у существа, которого не было (странный зверь); к хвосту — один.
    const tall = r * (1.5 + 1.4 * chest);
    const pair = chest > 0.3;
    for (const side of pair ? [-1, 1] : [0]) {
      const base = comb([P, 1], [U, 0.75 * r], [S, side * 0.32 * r]);
      const tip = comb([base, 1], [U, tall], [F, -0.4 * tall], [S, side * 0.35 * tall]);
      const mid = comb([base, 0.5], [tip, 0.5], [F, -0.08 * tall]);
      boneTube(mb, [base, mid, tip], (t) => (0.26 - 0.18 * t) * r, tint, 4);
    }
    // Поперечные отростки.
    for (const side of [-1, 1]) {
      const a = comb([P, 1], [S, side * 0.7 * r]);
      const b = comb([a, 1], [S, side * 1.05 * r], [U, -0.25 * r], [F, -0.15 * r]);
      boneTube(mb, [a, b], (t) => (0.2 - 0.12 * t) * r, tint, 4);
    }
    // Хвост и шея лежат у песка: о них спотыкаются.
    const lift = P[1] - ground(P[0], P[2]);
    if (lift < 1.4 && lift > -r * 0.9) colliders.push({ minX: P[0] - r, minY: ground(P[0], P[2]) - 0.3, minZ: P[2] - r, maxX: P[0] + r, maxY: P[1] + r, maxZ: P[2] + r });

    // Рёбра — у позвонков груди: дугой наружу и вниз, концы уходят в песок. Часть сломана, пары-другой нет.
    if (s > 0.34 && s < 0.71) {
      const span = 2.6 + 1.0 * Math.sin((Math.PI * (s - 0.34)) / 0.37);
      const flat = norm([S[0], 0, S[2]]);
      for (const side of [-1, 1]) {
        const roll = rnd();
        if (roll < 0.07) continue;
        const L = mul(flat, side);
        const A = comb([P, 1], [S, side * 0.75 * r], [U, 0.15 * r]);
        const end = 0.78 * Math.PI;
        const tipXZ = comb([A, 1], [L, span * Math.sin(end)]);
        const g = ground(tipXZ[0], tipXZ[2]);
        const b = (A[1] - g + 0.5) / (1 - Math.cos(end));
        const broken = roll > 0.82;
        const stop = broken ? end * (0.42 + rnd() * 0.25) : end;
        const pts: Vec3[] = [];
        for (let k = 0; k <= 13; k++) {
          const th = (k / 13) * stop;
          pts.push(comb([A, 1], [L, span * Math.sin(th)], [UP, b * (Math.cos(th) - 1)], [F, -0.55 * Math.sin(th)]));
        }
        const rt = boneTint();
        boneTube(mb, pts, (t) => 0.17 - 0.07 * t, rt, 6);
        info.ribs.push(pts);
        // Низ ребра — преграда: сквозь кость у песка не пройти.
        const low = pts.filter((q) => q[1] < ground(q[0], q[2]) + 2.2);
        if (low.length > 0) {
          const xs = low.map((q) => q[0]);
          const zs = low.map((q) => q[2]);
          colliders.push({ minX: Math.min(...xs) - 0.16, minY: oy - 0.5, minZ: Math.min(...zs) - 0.16, maxX: Math.max(...xs) + 0.16, maxY: Math.max(...low.map((q) => q[1])) + 0.16, maxZ: Math.max(...zs) + 0.16 });
        }
      }
    }
  }

  // ── Череп: у конца шеи, повёрнут к проёму; три пары глазниц, рога назад, длинная морда с зубами ──
  {
    const end = spine[count - 1]!;
    const tg = norm(sub(end, spine[count - 3]!));
    const sideFlat = norm([tg[2], 0, -tg[0]]);
    const c0 = comb([end, 1], [sideFlat, 1.6], [[tg[0], 0, tg[2]], 0.6]);
    const toDoor = norm([ox - c0[0], 0, oz - c0[2]]);
    // В три четверти к проёму: от двери видны морда в профиль, ряд глазниц и зубы, а не торец морды.
    const turn = 0.85;
    const fwd = norm([toDoor[0] * Math.cos(turn) - toDoor[2] * Math.sin(turn), 0, toDoor[0] * Math.sin(turn) + toDoor[2] * Math.cos(turn)]);
    const C: Vec3 = [c0[0], ground(c0[0], c0[2]) + 0.58, c0[2]];
    const [F, S, U] = frame(comb([fwd, 1], [UP, -0.08]));
    const tint = boneTint();
    info.skull = { at: C, face: [fwd[0], fwd[2]] };
    blob(mb, C, F, S, U, [1.5, 1.05, 0.95], tint, 10, 7);
    // Морда.
    const snout: Vec3[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      snout.push(comb([C, 1], [F, 1.0 + 3.0 * t], [U, -0.1 - 0.4 * t * t]));
    }
    boneTube(mb, snout, (t) => 0.64 - 0.44 * t, tint, 7);
    boneTube(mb, [snout[5]!, comb([snout[5]!, 1], [F, 0.35], [U, -0.25]), comb([snout[5]!, 1], [F, 0.42], [U, -0.6])], (t) => 0.2 - 0.15 * t, tint, 5);
    // Гребень по темени.
    boneTube(mb, [comb([C, 1], [U, 0.86], [F, -1.25]), comb([C, 1], [U, 1.02]), comb([C, 1], [U, 0.82], [F, 1.25])], () => 0.12, tint, 5);
    // Глазницы: три пары, тёмные провалы.
    for (let k = 0; k < 3; k++) {
      for (const side of [-1, 1]) {
        const at = comb([C, 1], [F, 0.78 - 0.5 * k], [U, 0.3 + 0.07 * k], [S, side * (0.84 - 0.05 * k)]);
        blob(mb, at, F, S, U, [0.31 - 0.03 * k, 0.2, 0.24 - 0.02 * k], HOLE, 7, 4);
      }
    }
    // Рога назад и вниз.
    for (const side of [-1, 1]) {
      const b0 = comb([C, 1], [U, 0.62], [F, -0.6], [S, side * 0.55]);
      const horn: Vec3[] = [b0, comb([b0, 1], [F, -0.8], [U, 0.62], [S, side * 0.3]), comb([b0, 1], [F, -1.9], [U, 0.72], [S, side * 0.72]), comb([b0, 1], [F, -2.65], [U, 0.18], [S, side * 1.02]), comb([b0, 1], [F, -2.85], [U, -0.35], [S, side * 1.12])];
      boneTube(mb, horn, (t) => 0.22 - 0.18 * t, tint, 6);
    }
    // Зубы вдоль нижнего края морды.
    for (let k = 0; k < 9; k++) {
      const t = 0.12 + k * 0.095;
      const r = 0.64 - 0.44 * t;
      for (const side of [-1, 1]) {
        const base = comb([C, 1], [F, 1.0 + 3.0 * t], [U, -0.1 - 0.4 * t * t - 0.62 * r], [S, side * 0.55 * r]);
        boneTube(mb, [base, comb([base, 1], [U, -0.3 + 0.08 * t], [F, 0.05])], (q) => 0.065 * (1 - q) + 0.004, [1.2, 1.15, 1.0], 4);
      }
    }
    colliders.push({ minX: C[0] - 1.6, minY: oy - 0.5, minZ: C[2] - 1.6, maxX: C[0] + 1.6, maxY: C[1] + 1.0, maxZ: C[2] + 1.6 });
    const nose = snout[4]!;
    colliders.push({ minX: nose[0] - 0.5, minY: oy - 0.5, minZ: nose[2] - 0.5, maxX: nose[0] + 0.5, maxY: nose[1] + 0.4, maxZ: nose[2] + 0.5 });
    // Отвалившаяся челюсть: вилка двух длинных костей в песке рядом.
    const jApex = comb([C, 1], [S, -2.9], [F, 1.4]);
    const jDir = norm(comb([F, 1], [S, -0.35]));
    for (const side of [-1, 1]) {
      const arm = norm(comb([jDir, Math.cos(0.32)], [S, side * Math.sin(0.32)]));
      const pts: Vec3[] = [];
      for (let k = 0; k <= 5; k++) {
        const p = comb([jApex, 1], [arm, -k * 0.75]);
        pts.push([p[0], ground(p[0], p[2]) + 0.12 - 0.05 * k, p[2]]);
      }
      boneTube(mb, pts, (t) => 0.22 - 0.06 * t, tint, 6);
    }
    colliders.push({ minX: jApex[0] - 2.4, minY: oy - 0.5, minZ: jApex[2] - 2.4, maxX: jApex[0] + 2.4, maxY: ground(jApex[0], jApex[2]) + 0.4, maxZ: jApex[2] + 2.4 });
  }

  // ── Кости лап торчат из барханов; шестипалая кисть лежит на склоне ──
  const limb = (u: number, v: number, dir: Vec3, len: number, rad: number, broken: boolean): void => {
    const g = H(u, v);
    const base = W(u, v, g - 1.3);
    const d = norm(dir);
    const pts: Vec3[] = [];
    for (let k = 0; k <= 8; k++) pts.push(comb([base, 1], [d, (len * k) / 8], [[d[2], 0, -d[0]], 0.18 * Math.sin((Math.PI * k) / 8)]));
    boneTube(mb, pts, (t) => rad * (0.82 + 0.5 * Math.max(0, 1 - t / 0.14) + (broken ? 0 : 0.6 * smoothstep(0.84, 1, t))), boneTint(), 7);
    const top = pts.filter((q) => q[1] < W(u, v, g)[1] + 2.4);
    const xs = top.map((q) => q[0]);
    const zs = top.map((q) => q[2]);
    colliders.push({ minX: Math.min(...xs) - rad, minY: oy - 0.5, minZ: Math.min(...zs) - rad, maxX: Math.max(...xs) + rad, maxY: Math.max(...top.map((q) => q[1])) + rad, maxZ: Math.max(...zs) + rad });
  };
  limb(-5.5, 21.5, [0.28, 1, 0.2], 6.2, 0.34, false);
  limb(8.4, 27.5, [-0.45, 1, -0.15], 4.6, 0.3, true);
  {
    const cu = -12.5;
    const cv = 25.5;
    const palm = W(cu, cv, H(cu, cv) + 0.12);
    const [F, S, U] = frame([0.6, 0, -0.8]);
    blob(mb, palm, F, S, U, [0.9, 0.75, 0.3], boneTint(), 8, 5);
    for (let f = 0; f < 6; f++) {
      const a = -1.05 + (f * 2.1) / 5;
      const d = norm(comb([F, Math.cos(a)], [S, Math.sin(a)]));
      const pts: Vec3[] = [];
      for (let k = 0; k <= 7; k++) {
        const p = comb([palm, 1], [d, 0.7 + k * 0.36]);
        const h = ground(p[0], p[2]);
        // Палец лежит на песке, коготь загибается и уходит в него.
        pts.push([p[0], h + 0.1 + 0.06 * Math.sin(k * 1.3) - (k === 7 ? 0.35 : 0), p[2]]);
      }
      boneTube(mb, pts, (t) => (t < 0.8 ? 0.11 + 0.03 * Math.sin(t * 18) : 0.12 * (1 - (t - 0.8) / 0.2) + 0.01), boneTint(), 5);
    }
    colliders.push({ minX: palm[0] - 3.2, minY: oy - 0.5, minZ: palm[2] - 3.2, maxX: palm[0] + 3.2, maxY: palm[1] + 0.3, maxZ: palm[2] + 3.2 });
  }

  // ── Раскиданные позвонки и обломки рёбер (не у проёма) ──
  for (let k = 0; k < 7; k++) {
    let u = 0;
    let v = 0;
    for (let tries = 0; tries < 12; tries++) {
      u = (rnd() - 0.5) * (w - 8);
      v = 6 + rnd() * (l - 14);
      if (Math.hypot(u, v) > 7) break;
    }
    const at = W(u, v, H(u, v) + 0.12);
    const [F, S, U] = frame([rnd() - 0.5, 0.25, rnd() - 0.5]);
    const r = 0.25 + rnd() * 0.2;
    const tint = boneTint();
    blob(mb, at, F, S, U, [0.55 * r, r, 0.9 * r], tint, 7, 4);
    boneTube(mb, [comb([at, 1], [U, 0.7 * r]), comb([at, 1], [U, 2.2 * r], [F, -0.6 * r])], (t) => (0.26 - 0.18 * t) * r, tint, 4);
  }
  for (let k = 0; k < 4; k++) {
    const u = (rnd() - 0.5) * (w - 10);
    const v = 10 + rnd() * (l - 18);
    const g = H(u, v);
    const yaw = rnd() * Math.PI * 2;
    const d: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
    const span = 1.4 + rnd() * 1.2;
    const pts: Vec3[] = [];
    for (let q = 0; q <= 8; q++) {
      const th = (q / 8) * 0.8 * Math.PI;
      pts.push(comb([W(u, v, g - 0.4), 1], [d, span * Math.sin(th)], [UP, 1.6 * Math.sin(th * 0.9)]));
    }
    boneTube(mb, pts, (t) => 0.15 - 0.06 * t, boneTint(), 6);
  }

  const spots: Vec3[] = (
    [
      [2.4, 6.5],
      [-3.2, 9.5],
      [5.5, 12],
      [-1.5, 15],
    ] as const
  ).map(([u, v]) => W(u, v, H(u, v)));

  return {
    kind: 'dunes',
    meshes: [mb.build()],
    colliders,
    fields,
    spawn: { pos: [ox, oy + SILL, oz - 0.8], yaw: 0 },
    // Ночь в высоком зале: рассеянного света почти нет, из окон слева ровный холодный свет ложится на гребни. Даль тёмная,
    // точки редеют к тридцати метрам — зал кажется больше, чем виден.
    env: { ambient: [0.006, 0.0068, 0.0085], fog: [0.0015, 0.0017, 0.0022], fogDensity: 0.02, light: 1, decay: 0.1, haze: 0.014, key: { dir: norm([-0.72, 0.42, 0.18]), color: [0.3, 0.34, 0.44], reach: 14 }, scan: [9, 32] },
    center: [ox, oy, oz - l / 2],
    radius: 80,
    spots,
    exit: [ox, oy, oz],
    dunes: info,
  };
};
