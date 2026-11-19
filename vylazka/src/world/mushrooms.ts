/**
 * Грибы: то, чем прорастает место рядом с Осыпью (systems/spores.ts). Каждая гроздь — одна сетка, рендер ставит её много раз,
 * каждый раз со своим поворотом и размером.
 *
 * Слова партнёра 19.11: «разновидностей грибов нужно больше, форма грибной ножки не только прямая, но и изогнутая. посмотри
 * опасные грибы для человека и на их основе сделай модели». Виды — по ядовитым грибам (облик, цвет, как растут и как гнётся
 * ножка: docs/vylazka/_research/toxic_mushrooms.md): бледная поганка, мухомор, белая поганка, говорушка, ложноопёнок,
 * омфалот (пластинки светятся в темноте), сатанинский гриб, строчок, огненный коралл, коноцибе. Ножки гнутся так, как в
 * природе: у пучка на древесине выходят вбок и дугой поднимаются к свету, у тонконогих — вьются, «пальцы» коралла клонятся.
 *
 * Все неестественно крупные (самые высокие — 30–45 см при размере 1, в углу гроздь ещё в полтора раза крупнее): знак должен
 * читаться с края луча, а не под ногами. У каждого вида два варианта грозди — чтобы ряд одинаковых не читался узором.
 */
import { mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function norm(v: V): V {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}
const UP: V = [0, 1, 0];
const angle = (a: V, b: V): number => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;

/** Базис плоскости, перпендикулярной оси. */
function basis(a: V): [V, V] {
  const ref: V = Math.abs(a[1]) < 0.9 ? UP : [1, 0, 0];
  const n = norm(cross(ref, a));
  return [n, cross(a, n)];
}

/** Цвет материала (sRGB): тон вершины — во сколько раз цвет гриба ярче или темнее материала по каждому каналу. */
const BASE = {
  enamel: [0.851, 0.851, 0.816],
  paper: [0.784, 0.757, 0.655],
  plaster: [0.796, 0.784, 0.733],
  glow: [0.651, 0.859, 0.659],
  leather: [0.29, 0.188, 0.141],
  wood: [0.439, 0.325, 0.224],
} as const satisfies Record<string, V>;
type Base = keyof typeof BASE;
const MAT_OF: Record<Base, number> = { enamel: MAT.enamel, paper: MAT.paper, plaster: MAT.plaster, glow: MAT.glow, leather: MAT.leather, wood: MAT.wood };
function tone(hex: string, base: Base): V {
  const n = parseInt(hex.slice(1), 16);
  const b = BASE[base];
  return [((n >> 16) & 255) / 255 / b[0], ((n >> 8) & 255) / 255 / b[1], (n & 255) / 255 / b[2]];
}

/** Поверхность из колец точек: rings[i][j], нормали — по точкам; тон и затенение — по кольцу. Обход сверяется с нормалью. */
function sleeve(mb: MeshBuilder, rings: readonly V[][], normals: readonly V[][], mat: number, tints: readonly V[], aos: readonly number[]): void {
  const idx: number[][] = rings.map((ring, i) => ring.map((p, j) => mb.vertex(p, normals[i]![j]!, mat, tints[i]!, aos[i]!)));
  const seg = rings[0]!.length;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg;
      const a = rings[i]![j]!;
      const b = rings[i]![k]!;
      const c = rings[i + 1]![k]!;
      const face = cross(sub(b, a), sub(c, a));
      const want = add(normals[i]![j]!, normals[i + 1]![k]!);
      const [ia, ib, ic, id] = [idx[i]![j]!, idx[i]![k]!, idx[i + 1]![k]!, idx[i + 1]![j]!];
      if (dot(face, want) >= 0) {
        mb.tri(ia, ib, ic);
        mb.tri(ia, ic, id);
      } else {
        mb.tri(ia, ic, ib);
        mb.tri(ia, id, ic);
      }
    }
  }
}

/** Веер от кольца к вершине (макушка шляпки, кончик «пальца»). */
function fan(mb: MeshBuilder, ring: readonly V[], ringN: readonly V[], apex: V, apexN: V, mat: number, tRing: V, tApex: V, ao = 1): void {
  const c = mb.vertex(apex, apexN, mat, tApex, ao);
  const ids = ring.map((p, j) => mb.vertex(p, ringN[j]!, mat, tRing, ao));
  for (let j = 0; j < ring.length; j++) {
    const k = (j + 1) % ring.length;
    const face = cross(sub(ring[k]!, ring[j]!), sub(apex, ring[j]!));
    if (dot(face, add(ringN[j]!, apexN)) >= 0) mb.tri(ids[j]!, ids[k]!, c);
    else mb.tri(ids[j]!, c, ids[k]!);
  }
}

/** Кубическая кривая Безье. */
function bez(p0: V, p1: V, p2: V, p3: V, t: number): V {
  const u = 1 - t;
  return add(add(mul(p0, u * u * u), mul(p1, 3 * u * u * t)), add(mul(p2, 3 * u * t * t), mul(p3, t * t * t)));
}

/** Сколько градусов набирает ножка от основания до шляпки — у каждого вида, для проверок (самая изогнутая ножка вида). */
const bends = new Map<string, number>();
let current = '';
/**
 * Подробность сетки: 1 — ближняя гроздь, LOD_FAR — дальняя (дальше нескольких метров: граней меньше, раскладка та же —
 * места, размеры и изгибы совпадают, поэтому смена ближней на дальнюю не видна). Грибов вчетверо гуще (партнёр 19.11:
 * «нужно увеличить плотность грибов минимум в 4 раза») — без дальних сеток кадр бы это не потянул.
 */
let DETAIL = 1;
const LOD_FAR = 0.6;
/** Число граней по окружности при нынешней подробности. */
const S = (n: number): number => Math.max(3, Math.round(n * DETAIL));
/** Свой ГСЧ для мелочей, число которых зависит от подробности (хлопья, зубцы вольвы): общий поток тратит одно число. */
const sub01 = (rnd: () => number): (() => number) => mulberry32(Math.floor(rnd() * 4294967296) >>> 0);

/**
 * Ножка-трубка вдоль ломаной: радиус по точкам, тон снизу вверх, у земли — тень. Рамка кольца переносится вдоль кривой
 * (без перекрута). Возвращает верх и направление ножки у верха — от них встаёт шляпка.
 */
function stem(mb: MeshBuilder, full: readonly V[], radius: (t: number) => number, segFull: number, base: Base, tintAt: (t: number) => V): { top: V; dir: V } {
  // Дальняя сетка: точки ломаной через одну (первая и последняя — всегда), граней по окружности меньше.
  const path = DETAIL < 1 ? full.filter((_, i) => i % 2 === 0 || i === full.length - 1) : full;
  const seg = S(segFull);
  const n = path.length;
  const tang = path.map((_, i) => norm(sub(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!)));
  let [nx] = basis(tang[0]!);
  const rings: V[][] = [];
  const normals: V[][] = [];
  const tints: V[] = [];
  const aos: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = tang[i]!;
    nx = norm(sub(nx, mul(t, dot(nx, t))));
    const bx = cross(t, nx);
    const u = i / (n - 1);
    const r = radius(u);
    const ring: V[] = [];
    const nr: V[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const d = add(mul(nx, Math.cos(a)), mul(bx, Math.sin(a)));
      const p = add(path[i]!, mul(d, r));
      // Наклонное кольцо у земли не уходит под пол: что ниже — ложится на пол.
      ring.push([p[0], Math.max(0, p[1]), p[2]]);
      nr.push(d);
    }
    rings.push(ring);
    normals.push(nr);
    tints.push(tintAt(u));
    aos.push(0.55 + 0.45 * Math.min(1, u * 4));
  }
  sleeve(mb, rings, normals, MAT_OF[base], tints, aos);
  if (DETAIL === 1) bends.set(current, Math.max(bends.get(current) ?? 0, angle(tang[0]!, tang[n - 1]!)));
  return { top: path[n - 1]!, dir: tang[n - 1]! };
}

/** Точки ножки по кривой: n отрезков. */
const along = (p0: V, p1: V, p2: V, p3: V, n: number): V[] => Array.from({ length: n + 1 }, (_, i) => bez(p0, p1, p2, p3, i / n));

/** Прямая (почти) ножка от base вверх на h с наклоном lean (рад) в сторону yaw. */
function straightPath(base: V, h: number, lean: number, yaw: number, n = 5): V[] {
  const top = add(base, [Math.sin(lean) * Math.cos(yaw) * h, Math.cos(lean) * h, Math.sin(lean) * Math.sin(yaw) * h]);
  return along(base, mix(base, top, 0.33), mix(base, top, 0.66), top, n);
}

/**
 * Ножка пучка: выходит из общей точки вбок под углом rise к земле и дугой поднимается вверх (грави- и фототропизм: ножка,
 * начавшая расти вбок, выпрямляется к вертикали — исследование, раздел А). out — насколько отходит вбок, h — высота.
 */
function arcPath(base: V, yaw: number, rise: number, out: number, h: number, n = 7): V[] {
  const d: V = [Math.cos(yaw), 0, Math.sin(yaw)];
  const p1 = add(base, add(mul(d, out * 0.55 * Math.cos(rise)), [0, out * 0.55 * Math.sin(rise), 0]));
  const top = add(base, add(mul(d, out), [0, h, 0]));
  const p2 = sub(top, [0, h * 0.45, 0]);
  return along(base, p1, p2, top, n);
}

/** Вьющаяся тонкая ножка: S-образно, с наклоном. */
function wavyPath(base: V, h: number, yaw: number, amp: number, phase: number, n = 9): V[] {
  const d: V = [Math.cos(yaw), 0, Math.sin(yaw)];
  const s: V = [-Math.sin(yaw), 0, Math.cos(yaw)];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const w = Math.sin(t * Math.PI * 1.5 + phase) * amp * t;
    return add(base, add(add(mul(d, amp * 1.4 * t * t), mul(s, w)), [0, h * t, 0]));
  });
}

interface CapSpec {
  /** Профиль шляпки [радиус, высота] в долях R и H — от края (первая) к макушке (последняя, радиус 0). */
  profile: readonly (readonly [number, number])[];
  R: number;
  H: number;
  seg: number;
  base: Base;
  /** Тон по профилю: 0 — край, 1 — макушка. */
  tint: (k: number) => V;
  /** Нижняя сторона: пластинки (или трубочки) — до радиуса ножки; decurrent — насколько сбегают по ножке вниз, м. */
  gill: { stem: number; tint: V; base?: Base; decurrent?: number; lift?: number };
  /** Волна края: амплитуда (доля радиуса) и число волн. */
  wave?: readonly [number, number];
  /** Насколько шляпка смотрит вверх, а не по ножке (0 — по ножке, 1 — строго вверх). */
  upright?: number;
}

/** Шляпка — тело вращения профиля над верхом ножки; снизу — пластинки. Возвращает «точку и нормаль на шляпке» (k — от края к макушке). */
function cap(mb: MeshBuilder, top: V, dir: V, spec: CapSpec, phase = 0): (k: number, a: number) => { p: V; n: V } {
  const c: CapSpec = { ...spec, seg: S(spec.seg) };
  const axis = norm(mix(dir, UP, c.upright ?? 0.6));
  const [nx, bx] = basis(axis);
  const prof = c.profile;
  const K = prof.length - 1;
  const waveAt = (k: number, a: number): number => (c.wave ? 1 + c.wave[0] * Math.sin(a * c.wave[1] + phase) * Math.max(0, 1 - k * 2.5) : 1);
  const radial = (a: number): V => add(mul(nx, Math.cos(a)), mul(bx, Math.sin(a)));
  /** Профиль в точке k: радиус и высота (м) и нормаль в плоскости профиля [наружу, вдоль оси]. */
  const at = (k: number): { r: number; h: number; nr: number; nh: number } => {
    const x = Math.max(0, Math.min(K, k * K));
    const i = Math.min(K - 1, Math.floor(x));
    const f = x - i;
    const r = (prof[i]![0] + (prof[i + 1]![0] - prof[i]![0]) * f) * c.R;
    const h = (prof[i]![1] + (prof[i + 1]![1] - prof[i]![1]) * f) * c.H;
    // Касательная — по соседним отрезкам (в узлах — среднее двух): нормаль (dh, −dr) смотрит наружу и вверх.
    const seg = (j: number): [number, number] => [(prof[j + 1]![0] - prof[j]![0]) * c.R, (prof[j + 1]![1] - prof[j]![1]) * c.H];
    let [dr, dh] = seg(i);
    if (f < 1e-6 && i > 0) {
      const [pr, ph] = seg(i - 1);
      dr = (dr + pr) / 2;
      dh = (dh + ph) / 2;
    }
    const l = Math.hypot(dr, dh) || 1;
    return { r, h, nr: dh / l, nh: -dr / l };
  };
  const surf = (k: number, a: number): { p: V; n: V } => {
    const q = at(k);
    const d = radial(a);
    const p = add(add(top, mul(axis, q.h)), mul(d, q.r * waveAt(k, a)));
    return { p, n: k >= 1 ? axis : norm(add(mul(d, q.nr), mul(axis, q.nh))) };
  };
  const rings: V[][] = [];
  const normals: V[][] = [];
  const tints: V[] = [];
  for (let i = 0; i < K; i++) {
    const k = i / K;
    const ring: V[] = [];
    const nr: V[] = [];
    for (let j = 0; j < c.seg; j++) {
      const q = surf(k, (j / c.seg) * Math.PI * 2);
      ring.push(q.p);
      nr.push(q.n);
    }
    rings.push(ring);
    normals.push(nr);
    tints.push(c.tint(k));
  }
  sleeve(mb, rings, normals, MAT_OF[c.base], tints, rings.map(() => 1));
  fan(mb, rings[K - 1]!, normals[K - 1]!, surf(1, 0).p, axis, MAT_OF[c.base], tints[K - 1]!, c.tint(1));
  // Пластинки: от края к ножке, лицом вниз; у воронок сбегают по ножке.
  const g = c.gill;
  const innerH = (g.lift ?? 0) * c.H - (g.decurrent ?? 0);
  const inner = rings[0]!.map((_, j) => add(add(top, mul(axis, innerH)), mul(radial((j / c.seg) * Math.PI * 2), g.stem * 1.15)));
  // Нормаль пластинок — по их конусу (от ножки к краю): у плоских — вниз, у воронок со сбегающими пластинками — вниз и наружу.
  const rim = at(0);
  const dr = rim.r - g.stem * 1.15;
  const dh = rim.h - innerH;
  const l = Math.hypot(dr, dh) || 1;
  const gn = rings[0]!.map((_, j) => norm(add(mul(radial((j / c.seg) * Math.PI * 2), dh / l), mul(axis, -dr / l))));
  sleeve(mb, [rings[0]!, inner], [gn, gn], MAT_OF[g.base ?? 'paper'], [g.tint, mul(g.tint, 0.7)], [0.85, 0.6]);
  return surf;
}

/** Юбка (кольцо) на ножке: висит вниз раструбом, с двух сторон. */
function skirt(mb: MeshBuilder, at: V, axis: V, r0: number, r1: number, drop: number, segFull: number, t: V): void {
  const seg = S(segFull);
  const [nx, bx] = basis(axis);
  const ring = (c: V, r: number): V[] => Array.from({ length: seg }, (_, j) => add(c, add(mul(nx, Math.cos((j / seg) * Math.PI * 2) * r), mul(bx, Math.sin((j / seg) * Math.PI * 2) * r))));
  const low = sub(at, mul(axis, drop));
  const top = ring(at, r0);
  const bot = ring(low, r1);
  const outN = top.map((p) => norm(add(sub(p, at), mul(axis, -0.3))));
  sleeve(mb, [top, bot], [outN, outN], MAT.paper, [t, mul(t, 0.92)], [0.9, 0.95]);
  const inTop = ring(at, r0 * 0.96);
  const inBot = ring(add(low, mul(axis, 0.002)), r1 * 0.96);
  const inN = outN.map((n) => mul(n, -1));
  sleeve(mb, [inTop, inBot], [inN, inN], MAT.paper, [mul(t, 0.7), mul(t, 0.8)], [0.6, 0.75]);
}

/** Вольва — мешок у основания ножки с рваным краем, с двух сторон. */
function volva(mb: MeshBuilder, base: V, r: number, h: number, segFull: number, t: V, rnd0: () => number): void {
  const seg = S(segFull);
  const rnd = sub01(rnd0);
  const pt = (y: number, rr: number, j: number): V => [base[0] + Math.cos((j / seg) * Math.PI * 2) * rr, base[1] + y, base[2] + Math.sin((j / seg) * Math.PI * 2) * rr];
  const tops = Array.from({ length: seg }, () => h * (0.75 + rnd() * 0.4));
  const rings = [Array.from({ length: seg }, (_, j) => pt(0, r * 0.82, j)), Array.from({ length: seg }, (_, j) => pt(h * 0.45, r, j)), Array.from({ length: seg }, (_, j) => pt(tops[j]!, r * 1.08, j))];
  const outN = rings.map((ring) => ring.map((p) => norm([p[0] - base[0], 0.15, p[2] - base[2]])));
  sleeve(mb, rings, outN, MAT.paper, [mul(t, 0.8), t, mul(t, 1.04)], [0.5, 0.85, 1]);
  const inner = rings.map((ring) => ring.map((p) => [base[0] + (p[0] - base[0]) * 0.93, p[1], base[2] + (p[2] - base[2]) * 0.93] as V));
  const inN = outN.map((ring) => ring.map((n) => mul(n, -1)));
  sleeve(mb, inner, inN, MAT.paper, [mul(t, 0.72), mul(t, 0.8), mul(t, 0.9)], [0.6, 0.75, 0.9]);
}

/** Бородавки мухомора: белые хлопья — низкие трёхгранные пирамидки на шляпке. */
function warts(mb: MeshBuilder, on: (k: number, a: number) => { p: V; n: V }, countFull: number, size: number, t: V, rnd0: () => number): void {
  const rnd = sub01(rnd0);
  const count = Math.max(1, Math.round(countFull * DETAIL));
  for (let i = 0; i < count; i++) {
    const k = 0.18 + rnd() * 0.72;
    const a = rnd() * Math.PI * 2;
    const { p, n } = on(k, a);
    const [u, w] = basis(n);
    const s = size * (0.6 + rnd() * 0.7);
    const corners = [0, 1, 2].map((q) => add(p, add(mul(u, Math.cos((q / 3) * Math.PI * 2 + a) * s), mul(w, Math.sin((q / 3) * Math.PI * 2 + a) * s))));
    const apex = add(p, mul(n, s * 0.7));
    fan(mb, corners, corners.map((c) => norm(sub(c, sub(p, mul(n, s))))), apex, n, MAT.plaster, t, mul(t, 1.05));
  }
}

/** Бугорок-основание пучка: гнилая древесина и мох, из которых растёт гроздь. */
function lump(mb: MeshBuilder, r: number, h: number, segFull: number, t: V): void {
  const seg = S(segFull);
  const rings: V[][] = [];
  const normals: V[][] = [];
  for (const [rr, hh] of [
    [1, 0],
    [0.8, 0.6],
    [0.4, 0.95],
  ] as const) {
    rings.push(Array.from({ length: seg }, (_, j) => [Math.cos((j / seg) * Math.PI * 2) * r * rr, h * hh, Math.sin((j / seg) * Math.PI * 2) * r * rr] as V));
    normals.push(Array.from({ length: seg }, (_, j) => norm([Math.cos((j / seg) * Math.PI * 2) * (1 - hh), 0.4 + hh, Math.sin((j / seg) * Math.PI * 2) * (1 - hh)])));
  }
  sleeve(mb, rings, normals, MAT.wood, [mul(t, 0.7), t, t], [0.4, 0.8, 0.9]);
  fan(mb, rings[2]!, normals[2]!, [0, h, 0], UP, MAT.wood, t, t);
}

// ── Профили шляпок: [радиус, высота] от края к макушке, в долях R и H ──
const DOME: readonly (readonly [number, number])[] = [
  [1, -0.1],
  [0.92, 0.3],
  [0.72, 0.62],
  [0.42, 0.88],
  [0, 1],
];
const FLAT: readonly (readonly [number, number])[] = [
  [1, -0.12],
  [0.9, 0.22],
  [0.65, 0.42],
  [0.3, 0.52],
  [0, 0.55],
];
const BELL: readonly (readonly [number, number])[] = [
  [1, -0.15],
  [0.86, 0.35],
  [0.62, 0.72],
  [0.3, 0.94],
  [0, 1],
];
const FUNNEL: readonly (readonly [number, number])[] = [
  [1, 0.42],
  [0.78, 0.36],
  [0.5, 0.2],
  [0.22, 0.06],
  [0, 0.02],
];
const UMBO: readonly (readonly [number, number])[] = [
  [1, -0.08],
  [0.82, 0.28],
  [0.5, 0.5],
  [0.2, 0.68],
  [0, 0.92],
];
const CUSHION: readonly (readonly [number, number])[] = [
  [1, -0.05],
  [0.95, 0.35],
  [0.75, 0.75],
  [0.4, 0.95],
  [0, 1],
];

type Rnd = () => number;
interface SpeciesDef {
  /** Имя вида — [a-z0-9_]. */
  id: string;
  latin: string;
  /** По-русски — для отладки и документов. */
  ru: string;
  build(mb: MeshBuilder, rnd: Rnd): void;
}

/** Бледная поганка: оливковая шляпка, белая юбка, ножка в белом мешке; рядом «яйцо» — шляпка едва выглядывает из вольвы. */
function deathCap(mb: MeshBuilder, rnd: Rnd): void {
  const stemT = tone('#eeead8', 'paper');
  const olive = (k: number): V => mix(tone('#9a9a5c', 'enamel'), tone('#5e5f2c', 'enamel'), k);
  const one = (x: number, z: number, h: number, R: number): void => {
    const yaw = rnd() * Math.PI * 2;
    const path = straightPath([x, 0, z], h, 0.06 + rnd() * 0.08, yaw);
    const s = stem(mb, path, (u) => 0.013 + 0.012 * Math.max(0, 1 - u * 5) - 0.003 * u, 6, 'paper', (u) => mix(tone('#c9c6a8', 'paper'), stemT, Math.min(1, u * 3)));
    cap(mb, s.top, s.dir, { profile: FLAT, R, H: R * 0.75, seg: 9, base: 'enamel', tint: olive, gill: { stem: 0.012, tint: tone('#f2f0e6', 'paper') }, upright: 0.7 }, rnd() * 6);
    skirt(mb, path[4]!, s.dir, 0.0125, 0.026, 0.022, 8, tone('#f4f1e6', 'paper'));
    volva(mb, [x, 0, z], 0.03, 0.045, 8, tone('#ebe6d6', 'paper'), rnd);
  };
  one(0, 0, 0.3, 0.075);
  one(0.09, 0.05, 0.21, 0.058);
  // «Яйцо»: мешок и макушка шляпки.
  volva(mb, [-0.07, 0, 0.06], 0.034, 0.06, 8, tone('#ebe6d6', 'paper'), rnd);
  cap(mb, [-0.07, 0.045, 0.06], UP, { profile: DOME, R: 0.03, H: 0.03, seg: 8, base: 'enamel', tint: olive, gill: { stem: 0.01, tint: tone('#e8e4d6', 'paper') } });
}

/** Мухомор: красная шляпка в белых хлопьях, белая юбка, ножка с клубнем в кольцах. Самый узнаваемый — «поп-культура» среди ядовитых. */
function flyAgaric(mb: MeshBuilder, rnd: Rnd): void {
  const red = (k: number): V => mix(tone('#c9411f', 'enamel'), tone('#8e1a12', 'enamel'), k * k);
  const white = tone('#f2eee2', 'plaster');
  const one = (x: number, z: number, h: number, R: number, prof: typeof DOME, wartN: number): void => {
    const path = straightPath([x, 0, z], h, 0.04 + rnd() * 0.1, rnd() * Math.PI * 2);
    const s = stem(mb, path, (u) => 0.014 + 0.016 * Math.max(0, 1 - u * 4) ** 2 - 0.004 * u, 7, 'paper', () => tone('#f0ebde', 'paper'));
    const on = cap(mb, s.top, s.dir, { profile: prof, R, H: R * 0.62, seg: 10, base: 'enamel', tint: red, gill: { stem: 0.014, tint: tone('#f4f0e2', 'paper') }, upright: 0.7 }, rnd() * 6);
    warts(mb, on, wartN, R * 0.09, white, rnd);
    if (h > 0.12) skirt(mb, path[4]!, s.dir, 0.014, 0.034, 0.03, 8, tone('#f6f2e6', 'paper'));
  };
  one(0, 0, 0.34, 0.11, FLAT, 20);
  one(0.12, -0.04, 0.22, 0.07, DOME, 12);
  one(-0.06, 0.09, 0.08, 0.042, DOME, 6);
}

/** Белая поганка («ангел-разрушитель»): вся белая, высокий колокол на тонкой ножке, юбка, мешок у земли. */
function destroyingAngel(mb: MeshBuilder, rnd: Rnd): void {
  const w = (k: number): V => mix(tone('#f1eee4', 'enamel'), tone('#e3dccb', 'enamel'), k);
  for (const [x, z, h, R] of [
    [0, 0, 0.42, 0.062],
    [0.085, 0.04, 0.31, 0.05],
  ] as const) {
    const yaw = rnd() * Math.PI * 2;
    // Лёгкая дуга: тянется вверх, чуть отклонившись у земли.
    const path = arcPath([x, 0, z], yaw, 1.1, 0.05 + rnd() * 0.03, h, 7);
    const s = stem(mb, path, (u) => 0.01 + 0.012 * Math.max(0, 1 - u * 6) - 0.002 * u, 6, 'paper', () => tone('#efebdf', 'paper'));
    cap(mb, s.top, s.dir, { profile: BELL, R, H: R * 1.15, seg: 9, base: 'enamel', tint: w, gill: { stem: 0.01, tint: tone('#f6f4ec', 'paper') }, upright: 0.5 }, rnd() * 6);
    skirt(mb, path[5]!, s.dir, 0.0105, 0.022, 0.02, 7, tone('#f4f1e8', 'paper'));
    volva(mb, [x, 0, z], 0.026, 0.05, 7, tone('#ece7d8', 'paper'), rnd);
  }
}

/** Говорушка беловатая: белые воронки дугой (кусок «ведьминого кольца»), пластинки сбегают по ножке. */
function foolsFunnel(mb: MeshBuilder, rnd: Rnd): void {
  const w = (k: number): V => mix(tone('#ebe7dc', 'enamel'), tone('#d8d0bc', 'enamel'), k);
  const n = 6;
  const arc0 = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = arc0 + (i / (n - 1) - 0.5) * 1.6;
    const x = Math.cos(a) * 0.14;
    const z = Math.sin(a) * 0.14;
    const h = 0.07 + rnd() * 0.08;
    const path = arcPath([x, 0, z], a + Math.PI + (rnd() - 0.5), 1.2, 0.02, h, 5);
    const s = stem(mb, path, (u) => 0.008 - 0.002 * u, 5, 'paper', () => tone('#e6e0d0', 'paper'));
    cap(mb, s.top, s.dir, { profile: FUNNEL, R: 0.035 + rnd() * 0.02, H: 0.04, seg: 8, base: 'enamel', tint: w, gill: { stem: 0.007, tint: tone('#e9e3d2', 'paper'), decurrent: 0.018 }, wave: [0.08, 5], upright: 0.8 }, rnd() * 6);
  }
}

/**
 * Ложноопёнок серно-жёлтый: плотный пучок из одной точки на гнилой древесине; ножки выходят вбок и дугой поднимаются — «букет».
 * Шляпки серно-жёлтые с оранжевой серединой, пластинки оливково-тёмные.
 */
function sulphurTuft(mb: MeshBuilder, rnd: Rnd): void {
  lump(mb, 0.05, 0.03, 7, tone('#5a4630', 'wood'));
  const yellow = (k: number): V => mix(tone('#e3d77e', 'enamel'), tone('#c78a2e', 'enamel'), k);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const path = arcPath([Math.cos(yaw) * 0.012, 0.02, Math.sin(yaw) * 0.012], yaw, 0.15 + rnd() * 0.5, 0.05 + rnd() * 0.08, 0.1 + rnd() * 0.13, 7);
    const s = stem(mb, path, (u) => 0.0075 - 0.0015 * u, 5, 'paper', (u) => mix(tone('#8a5a2a', 'paper'), tone('#d6bd56', 'paper'), Math.min(1, u * 1.6)));
    cap(mb, s.top, s.dir, { profile: UMBO, R: 0.024 + rnd() * 0.018, H: 0.024, seg: 6, base: 'enamel', tint: yellow, gill: { stem: 0.007, tint: tone('#5e5a2e', 'paper') }, upright: 0.55 }, rnd() * 6);
  }
}

/**
 * Омфалот: оранжевый пучок с воронками на изогнутых ножках; пластинки нисходящие и в темноте слабо светятся сине-зелёным —
 * единственное, что видно от гриба без фонаря.
 */
function jackOLantern(mb: MeshBuilder, rnd: Rnd): void {
  lump(mb, 0.06, 0.035, 7, tone('#4a3a2a', 'wood'));
  const orange = (k: number): V => mix(tone('#e8892c', 'enamel'), tone('#b9541a', 'enamel'), k);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const path = arcPath([Math.cos(yaw) * 0.015, 0.025, Math.sin(yaw) * 0.015], yaw, 0.3 + rnd() * 0.5, 0.06 + rnd() * 0.07, 0.12 + rnd() * 0.1, 7);
    const s = stem(mb, path, (u) => 0.012 - 0.004 * u, 6, 'paper', (u) => mix(tone('#a6501a', 'paper'), tone('#d9731e', 'paper'), Math.min(1, u * 2)));
    cap(mb, s.top, s.dir, { profile: FUNNEL, R: 0.04 + rnd() * 0.022, H: 0.05, seg: 8, base: 'enamel', tint: orange, gill: { stem: 0.011, tint: tone('#7fd6c4', 'glow'), base: 'glow', decurrent: 0.03 }, wave: [0.1, 4], upright: 0.6 }, rnd() * 6);
  }
}

/** Сатанинский гриб: толстая ножка-бочонок в красной сетке, бледная подушка шляпки, снизу — кроваво-красные поры. */
function satanBolete(mb: MeshBuilder, rnd: Rnd): void {
  for (const [x, z, h, R, r] of [
    [0, 0, 0.17, 0.11, 0.045],
    [0.13, 0.05, 0.09, 0.06, 0.028],
  ] as const) {
    const path = straightPath([x, 0, z], h, 0.03 + rnd() * 0.06, rnd() * Math.PI * 2, 5);
    const s = stem(mb, path, (u) => r * (1.15 - 0.55 * u + 0.25 * Math.sin(u * Math.PI)), 8, 'paper', (u) => mix(tone('#a8281a', 'paper'), tone('#e0a030', 'paper'), u * u));
    cap(mb, s.top, s.dir, { profile: CUSHION, R, H: R * 0.6, seg: 10, base: 'plaster', tint: (k) => mix(tone('#bdb9a4', 'plaster'), tone('#d6d2c0', 'plaster'), k), gill: { stem: r * 0.7, tint: tone('#c0241e', 'paper'), lift: 0.05 }, wave: [0.04, 3], upright: 0.8 }, rnd() * 6);
  }
}

/** Строчок: бурая складчатая шляпка-«мозг» на короткой толстой белой ножке. */
function falseMorel(mb: MeshBuilder, rnd: Rnd): void {
  const one = (x: number, z: number, R: number): void => {
    const h = R * 0.9;
    const path = straightPath([x, 0, z], h, rnd() * 0.12, rnd() * Math.PI * 2, 3);
    const s = stem(mb, path, (u) => R * (0.42 - 0.08 * u), 7, 'paper', () => tone('#e8e2d4', 'paper'));
    // Шляпка: сфера с бороздами — радиус гуляет по долготе и широте; в бороздах темнее.
    const c = add(s.top, [0, R * 0.55, 0]);
    const seg = S(12);
    const lat = Math.max(5, Math.round(8 * DETAIL));
    const ph = rnd() * 6;
    const fold = (th: number, a: number): number => Math.sin(a * 5 + ph + 2.4 * Math.sin(th * 3)) * Math.cos(th * 4 - a * 2 + ph) * 0.5 + Math.sin(a * 9 + th * 7 + ph) * 0.25;
    const rings: V[][] = [];
    const normals: V[][] = [];
    const tints: V[] = [];
    for (let i = 1; i < lat; i++) {
      const th = (i / lat) * Math.PI;
      const ring: V[] = [];
      const nr: V[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const f = fold(th, a);
        const rr = R * (1 + 0.16 * f) * (i === lat - 1 ? 0.75 : 1);
        const d: V = [Math.sin(th) * Math.cos(a), Math.cos(th) * 0.82, Math.sin(th) * Math.sin(a)];
        ring.push(add(c, mul(d, rr)));
        nr.push(norm(d));
      }
      rings.push(ring);
      normals.push(nr);
      tints.push(mix(tone('#4e2416', 'leather'), tone('#8a4a2c', 'leather'), 0.5 + 0.5 * Math.sin(i * 1.7 + ph)));
    }
    sleeve(mb, rings, normals, MAT.leather, tints, rings.map((_, i) => 0.75 + 0.25 * Math.sin(i * 2.1)));
    fan(mb, rings[0]!, normals[0]!, add(c, [0, R * 0.82, 0]), UP, MAT.leather, tints[0]!, tone('#7a3b25', 'leather'));
    fan(mb, rings[rings.length - 1]!, normals[normals.length - 1]!, add(c, [0, -R * 0.6, 0]), mul(UP, -1), MAT.leather, tints[tints.length - 1]!, tone('#4e2416', 'leather'), 0.6);
  };
  one(0, 0, 0.065);
  one(0.1, 0.05, 0.045);
  if (rnd() > 0.4) one(-0.05, 0.09, 0.035);
}

/** Огненный коралл (кентаке): красные «пальцы» из одной точки, без шляпки; клонятся в стороны, иные раздваиваются. */
function fireCoral(mb: MeshBuilder, rnd: Rnd): void {
  const red = (u: number): V => mix(tone('#7a2210', 'enamel'), tone('#de4a1e', 'enamel'), Math.min(1, u * 1.4));
  const n = 6;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const h = 0.12 + rnd() * 0.12;
    const tilt = 0.2 + rnd() * 0.5;
    const base: V = [Math.cos(yaw) * 0.015, 0, Math.sin(yaw) * 0.015];
    const d: V = [Math.cos(yaw), 0, Math.sin(yaw)];
    const top = add(base, add(mul(d, Math.sin(tilt) * h), [0, Math.cos(tilt) * h, 0]));
    const path = along(base, add(base, [0, h * 0.35, 0]), add(base, add(mul(d, Math.sin(tilt) * h * 0.4), [0, h * 0.7, 0])), top, 6);
    const r0 = 0.011 + rnd() * 0.006;
    const s = stem(mb, path, (u) => r0 * (1 - 0.25 * u), 6, 'enamel', red);
    // Скруглённый кончик.
    const [nx, bx] = basis(s.dir);
    const tipN = S(6);
    const ring = Array.from({ length: tipN }, (_, j) => add(add(s.top, mul(s.dir, r0 * 0.3)), add(mul(nx, Math.cos((j / tipN) * Math.PI * 2) * r0 * 0.55), mul(bx, Math.sin((j / tipN) * Math.PI * 2) * r0 * 0.55))));
    const rn = ring.map((p) => norm(sub(p, s.top)));
    fan(mb, ring, rn, add(s.top, mul(s.dir, r0 * 0.75)), s.dir, MAT.enamel, red(1), red(1));
    sleeve(
      mb,
      [Array.from({ length: tipN }, (_, j) => add(s.top, add(mul(nx, Math.cos((j / tipN) * Math.PI * 2) * r0 * 0.75), mul(bx, Math.sin((j / tipN) * Math.PI * 2) * r0 * 0.75)))), ring],
      [rn, rn],
      MAT.enamel,
      [red(1), red(1)],
      [1, 1],
    );
    // Иной палец раздваивается у верха.
    if (rnd() > 0.6) {
      const at = path[4]!;
      const fork = norm(add(d, [0, 1.2, 0]));
      const p2 = along(at, add(at, mul(fork, 0.02)), add(at, add(mul(fork, 0.04), [0, 0.02, 0])), add(at, add(mul(fork, 0.05), [0, 0.04, 0])), 4);
      stem(mb, p2, (u) => r0 * 0.6 * (1 - 0.3 * u), 5, 'enamel', () => red(1));
    }
  }
}

/** Коноцибе: крошечные колокольчики на непомерно длинных нитяных ножках, которые вьются; у верха — колечко. */
function deadlyConocybe(mb: MeshBuilder, rnd: Rnd): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.02 + rnd() * 0.11;
    const base: V = [Math.cos(a) * rr, 0, Math.sin(a) * rr];
    const h = 0.17 + rnd() * 0.15;
    const path = wavyPath(base, h, rnd() * Math.PI * 2, 0.025 + rnd() * 0.03, rnd() * 6, 9);
    const s = stem(mb, path, () => 0.0035, 4, 'paper', (u) => mix(tone('#b8a27c', 'paper'), tone('#e2d6bc', 'paper'), u));
    cap(mb, s.top, s.dir, { profile: BELL, R: 0.015 + rnd() * 0.008, H: 0.022, seg: 6, base: 'enamel', tint: (k) => mix(tone('#c9a77a', 'enamel'), tone('#8a6038', 'enamel'), k), gill: { stem: 0.0035, tint: tone('#9a7048', 'paper') }, upright: 0.3 }, rnd() * 6);
    skirt(mb, path[8]!, s.dir, 0.0036, 0.007, 0.004, 5, tone('#e8dcc4', 'paper'));
  }
}

/** Виды грибов (порядок — номер вида в местах роста, systems/spores.ts). */
export const SPECIES: readonly SpeciesDef[] = [
  { id: 'death_cap', latin: 'Amanita phalloides', ru: 'бледная поганка', build: deathCap },
  { id: 'fly_agaric', latin: 'Amanita muscaria', ru: 'мухомор красный', build: flyAgaric },
  { id: 'destroying_angel', latin: 'Amanita virosa', ru: 'белая поганка', build: destroyingAngel },
  { id: 'fools_funnel', latin: 'Clitocybe rivulosa', ru: 'говорушка беловатая', build: foolsFunnel },
  { id: 'sulphur_tuft', latin: 'Hypholoma fasciculare', ru: 'ложноопёнок серно-жёлтый', build: sulphurTuft },
  { id: 'jack_o_lantern', latin: 'Omphalotus olearius', ru: 'омфалот (светится)', build: jackOLantern },
  { id: 'satan_bolete', latin: 'Rubroboletus satanas', ru: 'сатанинский гриб', build: satanBolete },
  { id: 'false_morel', latin: 'Gyromitra esculenta', ru: 'строчок', build: falseMorel },
  { id: 'fire_coral', latin: 'Podostroma cornu-damae', ru: 'огненный коралл', build: fireCoral },
  { id: 'deadly_conocybe', latin: 'Pholiotina rugosa', ru: 'коноцибе', build: deadlyConocybe },
];
/** Сколько вариантов грозди у каждого вида: номер формы — вид × FORMS + вариант. */
export const FORMS = 2;
export const SPECIES_ID = SPECIES.map((s) => s.id);
export const speciesIndex = (id: string): number => SPECIES_ID.indexOf(id);

const cache = new Map<number, MeshData>();

/**
 * Сетка грозди: форма = вид × FORMS + вариант; lod 1 — дальняя (граней меньше, раскладка та же). Низ — y = 0, гроздь вокруг
 * начала координат.
 */
export function mushroomForm(form: number, lod: 0 | 1 = 0): MeshData {
  const key = form * 2 + lod;
  const hit = cache.get(key);
  if (hit) return hit;
  const sp = SPECIES[Math.floor(form / FORMS) % SPECIES.length]!;
  const mb = new MeshBuilder();
  current = sp.id;
  DETAIL = lod === 1 ? LOD_FAR : 1;
  try {
    sp.build(mb, mulberry32(0x6d757368 ^ (form * 0x9e37)));
  } finally {
    DETAIL = 1;
  }
  const m = mb.build();
  cache.set(key, m);
  return m;
}

/** Самый сильный изгиб ножки вида, градусы (строит обе грозди вида, если их ещё нет). */
export function speciesBend(id: string): number {
  const i = speciesIndex(id);
  for (let v = 0; v < FORMS; v++) mushroomForm(i * FORMS + v);
  return bends.get(id) ?? 0;
}
