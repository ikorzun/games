/**
 * Реквизит убежища, вторая очередь: всё, чем заставлены настоящие заброшенные убежища
 * (docs/vylazka/references.md). Правила те же, что в props.ts: предмет описан в своих координатах
 * (метры, y вверх), пол — y = 0, спина предмета — плоскость z = 0 (стена позади, z < 0),
 * предмет растёт в сторону +z и стоит по центру x = 0.
 *
 * Каждый предмет занесён в реестр PROPS с габаритами: по ним обстановка решает, куда он влезет,
 * а витрина (?level=show) расставляет предметы для просмотра.
 *
 * Наклонное (прислонённые доски, лестница, провисшие кабели) собрано из листов по точкам (xf.mb.quad
 * через xf.pt): Xf поворачивает только на четверти оборота, а лист можно поставить как угодно.
 */
import type { Vec3 } from '../core/types';
import type { Axis } from './kit';
import { MAT } from './materials';
import { stool } from './props';
import type { Xf } from './props';
import { bucket, chair, desk } from './props_bunker';

export interface PropSpec {
  /** Габариты: ширина вдоль стены, глубина от стены, высота, м. */
  w: number;
  d: number;
  h: number;
  /** Где стоит: на полу у стены, посреди пола, на стене (тогда y — высота низа), под потолком. */
  mount: 'floor' | 'free' | 'wall' | 'ceiling';
  /** Высота низа над полом для настенных предметов, м. */
  y?: number;
  /** Коротко по-русски: что это. */
  ru: string;
  build(xf: Xf, seed: number): void;
}

type Ao = number | readonly [number, number, number, number];

const WHITE: Vec3 = [1, 1, 1];
const DARK: Vec3 = [0.5, 0.5, 0.5];
const GREY: Vec3 = [0.7, 0.7, 0.7];
const dim = (t: Vec3, k: number): Vec3 => [t[0] * k, t[1] * k, t[2] * k];

/** Простой детерминированный разброс для мелочей (на геймплей не влияет). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Генератор предмета. Сид перемешан: соседние сиды (витрина даёт 1000, 1007…) не должны давать близнецов. */
const rng = (seed: number): (() => number) => lcg(Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1));

const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vneg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
function vnorm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Тонкий лист по четырём точкам (в координатах предмета, по кругу), лицом в сторону вектора n. */
function sheet(xf: Xf, a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, mat: number, tint: Vec3 = WHITE, ao: Ao = 1): void {
  const o = xf.pt(0, 0, 0);
  const f = xf.pt(n[0], n[1], n[2]);
  xf.mb.quadFacing(xf.pt(a[0], a[1], a[2]), xf.pt(b[0], b[1], b[2]), xf.pt(c[0], c[1], c[2]), xf.pt(d[0], d[1], d[2]), [f[0] - o[0], f[1] - o[1], f[2] - o[2]], mat, tint, ao);
}

/**
 * Брус между двумя точками: сечение w × t, четыре листа и два торца. Для наклонного — досок, жердей,
 * рычагов, провисших кабелей. w лежит по горизонтали поперёк бруса (или вдоль side), t — по второй нормали.
 * aoA — затенение у конца a (контактная тень у пола).
 */
function beam(xf: Xf, a: Vec3, b: Vec3, w: number, t: number, mat: number, tint: Vec3 = WHITE, opts: { side?: Vec3; ao?: number; aoA?: number; caps?: boolean } = {}): void {
  const d = vnorm(vsub(b, a));
  let s = opts.side ?? vcross(d, [0, 1, 0]);
  if (Math.hypot(s[0], s[1], s[2]) < 1e-4) s = [1, 0, 0];
  const n = vnorm(vcross(d, s));
  s = vnorm(vcross(n, d));
  const hw = w / 2;
  const ht = t / 2;
  const at = (p: Vec3, i: number, j: number): Vec3 => [p[0] + s[0] * hw * i + n[0] * ht * j, p[1] + s[1] * hw * i + n[1] * ht * j, p[2] + s[2] * hw * i + n[2] * ht * j];
  const aoB = opts.ao ?? 1;
  const aoA = opts.aoA ?? aoB;
  const ao: Ao = [aoA, aoA, aoB, aoB];
  sheet(xf, at(a, 1, -1), at(a, 1, 1), at(b, 1, 1), at(b, 1, -1), s, mat, tint, ao);
  sheet(xf, at(a, -1, -1), at(a, -1, 1), at(b, -1, 1), at(b, -1, -1), vneg(s), mat, tint, ao);
  sheet(xf, at(a, -1, 1), at(a, 1, 1), at(b, 1, 1), at(b, -1, 1), n, mat, tint, ao);
  sheet(xf, at(a, -1, -1), at(a, 1, -1), at(b, 1, -1), at(b, -1, -1), vneg(n), mat, tint, ao);
  if (opts.caps === false) return;
  sheet(xf, at(a, -1, -1), at(a, 1, -1), at(a, 1, 1), at(a, -1, 1), vneg(d), mat, tint, aoA);
  sheet(xf, at(b, -1, -1), at(b, 1, -1), at(b, 1, 1), at(b, -1, 1), d, mat, tint, aoB);
}

/** Оси плоскости, перпендикулярной оси axis: номера координат [вдоль оси, первая поперёк, вторая поперёк]. */
function planeOf(axis: Axis): [number, number, number] {
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return [a, (a + 1) % 3, (a + 2) % 3];
}

/** Кольцо прямоугольного сечения из seg звеньев — обод штурвала. c — центр, axis — ось вращения. */
function ring(xf: Xf, c: Vec3, axis: Axis, r: number, tube: number, seg: number, mat: number, tint: Vec3 = WHITE): void {
  const [a, u, v] = planeOf(axis);
  const at = (ang: number, rad: number, h: number): Vec3 => {
    const p: Vec3 = [c[0], c[1], c[2]];
    p[a] = p[a]! + h;
    p[u] = p[u]! + Math.cos(ang) * rad;
    p[v] = p[v]! + Math.sin(ang) * rad;
    return p;
  };
  const ro = r + tube / 2;
  const ri = r - tube / 2;
  const h = tube / 2;
  const ax: Vec3 = [0, 0, 0];
  ax[a] = 1;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const out: Vec3 = [0, 0, 0];
    out[u] = Math.cos((a0 + a1) / 2);
    out[v] = Math.sin((a0 + a1) / 2);
    sheet(xf, at(a0, ro, -h), at(a1, ro, -h), at(a1, ro, h), at(a0, ro, h), out, mat, tint);
    sheet(xf, at(a0, ri, -h), at(a1, ri, -h), at(a1, ri, h), at(a0, ri, h), vneg(out), mat, tint);
    sheet(xf, at(a0, ri, h), at(a1, ri, h), at(a1, ro, h), at(a0, ro, h), ax, mat, tint);
    sheet(xf, at(a0, ri, -h), at(a1, ri, -h), at(a1, ro, -h), at(a0, ro, -h), vneg(ax), mat, tint);
  }
}

/** Штурвал: обод, две спицы крестом и ступица. c — центр, axis — ось вала. */
function wheel(xf: Xf, c: Vec3, axis: Axis, r: number, mat: number, tint: Vec3 = WHITE, seg = 10): void {
  const tube = Math.max(0.014, r * 0.16);
  ring(xf, c, axis, r, tube, seg, mat, tint);
  const [a, u, v] = planeOf(axis);
  const mk = (uu: number, vv: number, hh: number): Vec3 => {
    const p: Vec3 = [c[0], c[1], c[2]];
    p[a] = p[a]! + hh;
    p[u] = p[u]! + uu;
    p[v] = p[v]! + vv;
    return p;
  };
  const t = tube * 0.38;
  xf.box(mk(-r, -t, -t), mk(r, t, t), mat, { tint });
  xf.box(mk(-t, -r, -t), mk(t, r, t), mat, { tint });
  xf.cyl(mk(0, 0, -tube * 0.8), axis, tube * 1.6, tube * 1.25, mat, { tint, segments: 6 });
}

/** Порог-комингс под гермодверью: стальной брус поперёк проёма, через него переступают. */
export function coaming(xf: Xf, w = 1.1): void {
  xf.solid([-w / 2, 0, -0.08], [w / 2, 0.16, 0.08], MAT.metalGrey, { bevel: 0.02, aoBottom: 0.6 });
  xf.box([-w / 2 + 0.03, 0.16, -0.05], [w / 2 - 0.03, 0.175, 0.05], MAT.rubber);
}

// ───────────────────────────── двери и перегородки ─────────────────────────────

/**
 * Защитно-герметическая дверь в проёме 1,1 × 2,05 м. Рама из швеллера глубиной 0,38 м: z = 0 — её
 * дальняя кромка, в стену 0,3 м ставить со сдвигом z = −0,19 (полки швеллера лягут на обе стороны стены).
 * Полотно 0,9 × 1,9 × 0,08 м с тремя рёбрами жёсткости, клиновыми затворами по углам и штурвалом 0,4 м
 * распахнуто под прямым углом в сторону +z. Цвет полотна по сиду: грязно-кремовый или сурик.
 * Преграда — только косяки и полотно; порог 7 см перешагивается.
 */
export function blastDoor(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cream = rnd() < 0.5;
  const leafMat = cream ? MAT.metalGrey : MAT.paintRed;
  const leaf: Vec3 = cream ? [1.4, 1.32, 1.05] : [0.6, 1.2, 1.15];
  const frame: Vec3 = dim([0.7, 0.72, 0.68], 0.9 + rnd() * 0.2);
  const D = 0.38;
  // Рама: швеллер стенкой в проём, полки лежат на обеих сторонах стены.
  for (const s of [-1, 1]) {
    xf.solid([s * 0.45, 0, 0.02], [s * 0.55, 2.05, D - 0.02], MAT.metalGrey, { tint: frame, aoBottom: 0.6 });
    for (const z of [0, D - 0.03]) xf.box([s * 0.43, 0, z], [s * 0.62, 1.95, z + 0.03], MAT.metalGrey, { tint: dim(frame, 0.88), aoBottom: 0.6 });
  }
  xf.box([-0.45, 1.97, 0.02], [0.45, 2.05, D - 0.02], MAT.metalGrey, { tint: frame });
  for (const z of [0, D - 0.03]) xf.box([-0.62, 1.95, z], [0.62, 2.1, z + 0.03], MAT.metalGrey, { tint: dim(frame, 0.88) });
  xf.box([-0.45, 0, 0.02], [0.45, 0.07, D - 0.02], MAT.steel, { bevel: 0.012, tint: DARK });

  // Полотно на петлях у левого косяка: распахнуто на четверть оборота, лицом в проход.
  const lf = xf.child(-0.55, 0.08, D + 0.01, 1);
  lf.solid([-0.9, 0, 0], [0, 1.9, 0.08], leafMat, { bevel: 0.012, tint: leaf, aoBottom: 0.7 });
  for (const y of [0.42, 0.95, 1.48]) {
    lf.box([-0.86, y - 0.03, 0.08], [-0.04, y + 0.03, 0.105], leafMat, { tint: dim(leaf, 0.86) });
    lf.box([-0.86, y - 0.03, -0.025], [-0.04, y + 0.03, 0], leafMat, { tint: dim(leaf, 0.86) });
  }
  // Клиновые затворы по углам: стальной клин и красная рукоять.
  for (const x of [-0.8, -0.1]) {
    for (const up of [-1, 1]) {
      const y = up > 0 ? 1.68 : 0.22;
      lf.box([x - 0.05, y - 0.035, 0.08], [x + 0.05, y + 0.035, 0.125], MAT.steel, { tint: [0.55, 0.55, 0.55] });
      lf.box([x - 0.014, y, 0.125], [x + 0.014, y - up * 0.18, 0.145], MAT.paintRed, { tint: [0.95, 0.9, 0.9] });
    }
  }
  // Штурвал задрайки на валу; с обратной стороны — бобышка вала.
  lf.cyl([-0.45, 0.95, 0.105], 'z', 0.06, 0.028, MAT.steel, { segments: 6, tint: GREY });
  wheel(lf, [-0.45, 0.95, 0.175], 'z', 0.2, MAT.castIron);
  lf.cyl([-0.45, 0.95, -0.06], 'z', 0.06, 0.05, MAT.steel, { segments: 8, tint: GREY });
  for (const y of [0.3, 1.4]) lf.cyl([0.02, y, 0.04], 'y', 0.2, 0.03, MAT.steel, { segments: 6, tint: DARK });
}

/**
 * Решётчатая дверь: коробка из уголка в проёме 1,0 × 2,05 м и створка 0,9 × 2,0 м — рама из уголка,
 * прутья через 12 см, две поперечины, навесной замок на проушине. Распахнута внутрь (в сторону +z).
 */
export function gratedDoor(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const iron: Vec3 = dim([0.62, 0.6, 0.58], 0.9 + rnd() * 0.2);
  for (const s of [-1, 1]) xf.solid([s * 0.47, 0, 0], [s * 0.52, 2.05, 0.05], MAT.steel, { tint: iron, aoBottom: 0.6 });
  xf.box([-0.47, 2.0, 0], [0.47, 2.05, 0.05], MAT.steel, { tint: iron });
  const lf = xf.child(-0.52, 0, 0.06, 1);
  for (const x of [-0.9, -0.04]) lf.box([x, 0.03, 0], [x + 0.04, 2.0, 0.04], MAT.steel, { tint: iron, aoBottom: 0.6 });
  for (const y of [0.03, 1.96]) lf.box([-0.86, y, 0], [-0.04, y + 0.04, 0.04], MAT.steel, { tint: iron });
  for (let x = -0.74; x < -0.1; x += 0.12) lf.cyl([x, 0.07, 0.02], 'y', 1.89, 0.008, MAT.steel, { segments: 5, caps: false, tint: dim(iron, 0.85) });
  for (const y of [0.7, 1.35]) lf.box([-0.86, y - 0.02, 0.012], [-0.04, y + 0.02, 0.028], MAT.steel, { tint: iron });
  for (const y of [0.3, 1.6]) lf.cyl([0.012, y, 0.02], 'y', 0.1, 0.014, MAT.steel, { segments: 5, tint: DARK });
  // Проушина и замок на свободном краю: дужка продета, замок висит открытым.
  lf.box([-0.94, 0.99, 0.008], [-0.86, 1.03, 0.032], MAT.steel, { tint: dim(iron, 0.9) });
  lf.box([-0.935, 0.9, 0.002], [-0.885, 0.96, 0.038], MAT.brass, { tint: [0.6, 0.55, 0.5] });
  lf.box([-0.925, 0.96, 0.012], [-0.895, 0.995, 0.028], MAT.steel, { tint: GREY });
  lf.collider([-0.9, 0, 0], [0, 2.0, 0.04]);
}

/**
 * Сетчатая «клетка» склада у стены, 2,4 × 1,0 × 2,2 м: перегородка из уголка и сетки (прутки через
 * 15 см) и две боковины до стены; калитка 0,72 м у правого края распахнута внутрь, на ней оставлен
 * замок. За сеткой — ящики и мешок. Войти можно только через калитку.
 */
export function meshPartition(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const iron: Vec3 = dim([0.6, 0.6, 0.58], 0.9 + rnd() * 0.2);
  const rod = { segments: 3, caps: false, tint: dim(iron, 0.85) };
  const zf = 0.95; // передняя плоскость клетки
  // Передняя стенка: стойки, обвязка, сетка глухой секции (вертикальные прутки позади, горизонтальные спереди).
  for (const x of [-1.2, 0.35, 1.15]) xf.box([x, 0, zf], [x + 0.05, 2.2, zf + 0.05], MAT.steel, { tint: iron, aoBottom: 0.6 });
  xf.box([-1.15, 2.15, zf], [1.15, 2.2, zf + 0.05], MAT.steel, { tint: iron });
  xf.box([-1.15, 0, zf + 0.01], [0.35, 0.04, zf + 0.04], MAT.steel, { tint: iron });
  xf.box([0.4, 1.98, zf + 0.01], [1.15, 2.02, zf + 0.04], MAT.steel, { tint: iron });
  for (let x = -1.0; x < 0.3; x += 0.15) xf.cyl([x, 0.04, zf + 0.019], 'y', 2.11, 0.006, MAT.steel, rod);
  for (let y = 0.19; y < 2.12; y += 0.15) xf.cyl([-1.15, y, zf + 0.031], 'x', 1.5, 0.006, MAT.steel, rod);
  // Боковины от стены до угловых стоек; сетка реже — горизонтальные прутки через 30 см.
  for (const x of [-1.175, 1.175]) {
    for (const y of [0, 2.16]) xf.box([x - 0.015, y, 0], [x + 0.015, y + 0.04, zf], MAT.steel, { tint: iron });
    for (let z = 0.15; z < zf - 0.05; z += 0.15) xf.cyl([x - 0.006, 0.04, z], 'y', 2.12, 0.006, MAT.steel, rod);
    for (let y = 0.34; y < 2.12; y += 0.3) xf.cyl([x + 0.006, y, 0], 'z', zf, 0.006, MAT.steel, rod);
  }
  // Калитка висит на угловой стойке и распахнута внутрь, вдоль боковины.
  const g = xf.child(1.15, 0, zf, 3);
  for (const x of [-0.75, -0.03]) g.box([x, 0.03, 0], [x + 0.03, 1.97, 0.03], MAT.steel, { tint: iron, aoBottom: 0.6 });
  for (const y of [0.03, 0.985, 1.94]) g.box([-0.72, y, 0], [-0.03, y + 0.03, 0.03], MAT.steel, { tint: iron });
  for (let x = -0.6; x < -0.1; x += 0.15) g.cyl([x, 0.06, 0.009], 'y', 1.88, 0.006, MAT.steel, rod);
  for (let y = 0.34; y < 1.9; y += 0.3) g.cyl([-0.72, y, 0.021], 'x', 0.69, 0.006, MAT.steel, rod);
  // Проушина на средней стойке и замок, оставленный на калитке.
  xf.box([0.4, 0.98, zf + 0.012], [0.46, 1.02, zf + 0.02], MAT.steel, { tint: iron });
  g.box([-0.785, 0.9, 0], [-0.745, 0.96, 0.03], MAT.brass, { tint: [0.6, 0.55, 0.5] });
  g.box([-0.78, 0.96, 0.009], [-0.75, 0.995, 0.021], MAT.steel, { tint: GREY });
  // За сеткой — то, что запирали: дощатые ящики, зелёный ящик с мешком.
  const wood: Vec3 = dim([0.82, 0.8, 0.72], 0.85 + rnd() * 0.2);
  xf.solid([-1.05, 0, 0.1], [-0.4, 0.45, 0.6], MAT.wood, { bevel: 0.012, tint: wood, aoBottom: 0.55 });
  for (const x of [-1.058, -0.442]) xf.box([x, 0, 0.092], [x + 0.05, 0.458, 0.608], MAT.wood, { tint: dim(wood, 0.78) });
  xf.box([-0.95, 0.45, 0.15], [-0.52, 0.75, 0.5], MAT.wood, { tint: dim(wood, 0.9) });
  xf.solid([-0.28, 0, 0.12], [0.24, 0.42, 0.56], MAT.metalGreen, { bevel: 0.012, tint: [0.9, 0.95, 0.9], aoBottom: 0.55 });
  xf.box([-0.2, 0.42, 0.2], [0.16, 0.55, 0.5], MAT.canvas, { tint: [0.85, 0.82, 0.72] });
  xf.collider([-1.2, 0, zf], [0.4, 2.2, zf + 0.05]);
  xf.collider([-1.2, 0, 0], [-1.15, 2.2, zf]);
  xf.collider([1.12, 0, 0], [1.2, 2.2, zf + 0.05]);
}

// ───────────────────────────── вентиляция (ФВУ) ─────────────────────────────

/**
 * Колонка из трёх фильтров-поглотителей ФП-300: барабаны Ø 0,55 × 0,42 м друг на друге на раме из
 * уголка, фланцы, сбоку коллектор с отводом вверх и красным вентилем, на каждом барабане табличка.
 * Ширина 0,95 м, глубина 0,6 м, высота 2,0 м.
 */
export function filterStack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cx = -0.12;
  const cz = 0.3;
  const r = 0.275;
  const body: Vec3 = dim([0.95, 1.0, 0.95], 0.85 + rnd() * 0.2);
  for (const x of [cx - 0.3, cx + 0.26]) for (const z of [cz - 0.3, cz + 0.26]) xf.box([x, 0, z], [x + 0.04, 0.14, z + 0.04], MAT.steel, { tint: DARK, aoBottom: 0.6 });
  for (const z of [cz - 0.3, cz + 0.26]) xf.box([cx - 0.26, 0.1, z], [cx + 0.26, 0.14, z + 0.04], MAT.steel, { tint: DARK });
  for (let i = 0; i < 3; i++) {
    const y = 0.16 + i * 0.46;
    xf.cyl([cx, y, cz], 'y', 0.42, r, MAT.metalGreen, { segments: 10, caps: false, tint: dim(body, i === 1 ? 1.08 : 1) });
    xf.box([cx - 0.08, y + 0.15, cz + r - 0.014], [cx + 0.08, y + 0.25, cz + r + 0.004], MAT.paper, { tint: [0.85, 0.82, 0.66] });
  }
  // Фланцы: поддон, два стыка, крышка.
  for (let i = 0; i < 4; i++) {
    const y = i === 0 ? 0.14 : 0.12 + i * 0.46;
    xf.cyl([cx, y, cz], 'y', i === 0 ? 0.02 : i === 3 ? 0.03 : 0.04, r + 0.018, MAT.steel, { segments: 10, tint: DARK });
  }
  xf.cyl([cx, 1.53, cz], 'y', 0.07, 0.08, MAT.steel, { segments: 6, tint: GREY });
  // Коллектор: отводы от барабанов к стояку, стояк обрезан под потолком.
  const xr = cx + r + 0.2;
  const x0 = cx + r - 0.03;
  xf.cyl([x0, 0.37, cz], 'x', xr + 0.06 - x0, 0.06, MAT.metalGreen, { segments: 6, tint: body });
  for (const y of [0.83, 1.29]) xf.cyl([x0, y, cz], 'x', xr - x0, 0.04, MAT.metalGreen, { segments: 6, caps: false, tint: body });
  xf.cyl([xr, 0.31, cz], 'y', 1.66, 0.06, MAT.metalGreen, { segments: 8, tint: body });
  for (const y of [1.1, 1.94]) xf.cyl([xr, y, cz], 'y', 0.03, 0.085, MAT.steel, { segments: 8, tint: DARK });
  xf.cyl([xr, 0.62, cz + 0.05], 'z', 0.09, 0.012, MAT.steel, { segments: 4, caps: false });
  xf.cyl([xr, 0.62, cz + 0.14], 'z', 0.02, 0.07, MAT.paintRed, { segments: 8 });
  xf.collider([cx - 0.3, 0, cz - 0.3], [xr + 0.085, 1.55, cz + 0.3]);
}

/**
 * Электроручной вентилятор ЭРВ-72: на раме-подставке в ряд стоят «улитка» Ø 0,5 м, электромотор
 * и редуктор ручного привода с рукоятью-кривошипом; нагнетательный патрубок уходит вверх и обрезан.
 * Ширина 0,9 м, глубина 0,6 м, высота 1,55 м.
 */
export function handFan(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.92, 1.0, 0.92], 0.85 + rnd() * 0.2);
  for (const x of [-0.44, 0.4]) for (const z of [0.08, 0.48]) xf.box([x, 0, z], [x + 0.04, 0.5, z + 0.04], MAT.steel, { tint: DARK, aoBottom: 0.6 });
  for (const z of [0.08, 0.48]) xf.box([-0.4, 0.46, z], [0.4, 0.5, z + 0.04], MAT.steel, { tint: DARK });
  for (const x of [-0.44, 0.4]) xf.box([x, 0.14, 0.12], [x + 0.04, 0.18, 0.48], MAT.steel, { tint: DARK });
  xf.box([-0.44, 0.5, 0.08], [0.44, 0.52, 0.52], MAT.steel, { tint: [0.45, 0.45, 0.45] });
  const sy = 0.79; // высота вала
  // Улитка: барабан на боку, всасывающий патрубок слева, нагнетательный — вверх от задней кромки.
  xf.box([-0.35, 0.52, 0.2], [-0.17, 0.6, 0.4], MAT.metalGreen, { tint: dim(paint, 0.8) });
  xf.cyl([-0.37, sy, 0.3], 'x', 0.22, 0.25, MAT.metalGreen, { segments: 14, tint: paint });
  xf.cyl([-0.44, sy, 0.3], 'x', 0.07, 0.1, MAT.steel, { segments: 8, tint: GREY });
  xf.cyl([-0.446, sy, 0.3], 'x', 0.006, 0.08, MAT.rubber, { segments: 8, tint: [0.6, 0.6, 0.6] });
  xf.box([-0.36, sy, 0.07], [-0.16, 1.14, 0.27], MAT.metalGreen, { tint: paint });
  xf.cyl([-0.26, 1.14, 0.17], 'y', 0.4, 0.085, MAT.zinc, { segments: 8, tint: [0.75, 0.77, 0.75] });
  xf.cyl([-0.26, 1.5, 0.17], 'y', 0.03, 0.11, MAT.steel, { segments: 8, caps: false, tint: DARK });
  // Электромотор с рёбрами охлаждения и клеммной коробкой.
  xf.box([-0.1, 0.52, 0.2], [0.14, 0.67, 0.4], MAT.metalGrey, { tint: [0.7, 0.72, 0.75] });
  xf.cyl([-0.15, sy, 0.3], 'x', 0.36, 0.13, MAT.metalGrey, { segments: 10, tint: [0.8, 0.82, 0.86] });
  for (const x of [-0.07, 0.02, 0.11]) xf.cyl([x, sy, 0.3], 'x', 0.02, 0.145, MAT.metalGrey, { segments: 10, caps: false, tint: [0.65, 0.67, 0.7] });
  xf.box([-0.03, sy + 0.11, 0.24], [0.09, sy + 0.18, 0.36], MAT.bakelite, { tint: [1.1, 1.1, 1.1] });
  // Редуктор и кривошип ручного привода.
  xf.box([0.22, 0.52, 0.17], [0.42, 0.94, 0.43], MAT.metalGreen, { bevel: 0.015, tint: paint });
  xf.cyl([0.32, sy, 0.43], 'z', 0.06, 0.035, MAT.steel, { segments: 6, tint: GREY });
  xf.box([0.3, sy - 0.26, 0.49], [0.34, sy + 0.03, 0.51], MAT.steel, { tint: GREY });
  xf.cyl([0.32, sy - 0.24, 0.51], 'z', 0.09, 0.018, MAT.wood, { segments: 6, tint: [0.8, 0.75, 0.7] });
  xf.collider([-0.44, 0, 0.07], [0.44, 1.05, 0.55]);
}

/**
 * Круглый оцинкованный воздуховод под потолком вдоль стены: длина 2,4 м, Ø 0,3 м, бандажи через 0,8 м,
 * два хомута-подвеса к потолку, снизу отвод с тёмным зевом. y = 0 — потолок.
 */
export function ductRun(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const zn: Vec3 = dim([0.8, 0.82, 0.8], 0.9 + rnd() * 0.2);
  const y = -0.24;
  const z = 0.24;
  xf.cyl([-1.2, y, z], 'x', 2.4, 0.15, MAT.zinc, { segments: 12, tint: zn });
  for (const x of [-0.8, 0, 0.8]) xf.cyl([x - 0.02, y, z], 'x', 0.04, 0.165, MAT.zinc, { segments: 12, caps: false, tint: dim(zn, 0.75) });
  // Фальц по низу трубы.
  xf.box([-1.2, y - 0.157, z - 0.006], [1.2, y - 0.148, z + 0.006], MAT.zinc, { tint: dim(zn, 0.7) });
  for (const x of [-0.6, 0.6]) {
    xf.cyl([x - 0.015, y, z], 'x', 0.03, 0.158, MAT.steel, { segments: 12, caps: false, tint: DARK });
    xf.box([x - 0.006, y + 0.15, z - 0.006], [x + 0.006, 0, z + 0.006], MAT.steel, { tint: DARK });
    xf.box([x - 0.04, -0.008, z - 0.04], [x + 0.04, 0, z + 0.04], MAT.steel, { tint: DARK });
  }
  const bx = rnd() < 0.5 ? 0.3 : -0.3;
  xf.cyl([bx, y - 0.26, z], 'y', 0.14, 0.08, MAT.zinc, { segments: 8, tint: dim(zn, 0.9) });
  xf.cyl([bx, y - 0.264, z], 'y', 0.004, 0.066, MAT.rubber, { segments: 8, tint: [0.6, 0.6, 0.6] });
}

/**
 * Герметический клапан ГК на куске воздуховода вдоль стены: дисковый корпус между фланцами, спереди
 * редуктор с красным маховичком. Ширина 0,9 м, вылет 0,55 м. y = 0 — низ корпуса.
 */
export function hermoValve(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const red = rnd() < 0.4;
  const y = 0.24;
  const z = 0.2;
  // Воздуховод: белый — чистая вентиляция, красный — фильтровентиляция.
  xf.cyl([-0.45, y, z], 'x', 0.9, 0.1, red ? MAT.paintRed : MAT.metalGrey, { segments: 10, tint: red ? [0.65, 0.85, 0.85] : [1.1, 1.1, 1.05] });
  for (const x of [-0.38, 0.38]) xf.box([x - 0.015, y - 0.12, 0], [x + 0.015, y + 0.12, z], MAT.steel, { tint: DARK });
  xf.cyl([-0.06, y, z], 'x', 0.12, 0.17, MAT.metalGreen, { segments: 12, tint: [0.95, 1.0, 0.95] });
  for (const x of [-0.09, 0.06]) xf.cyl([x, y, z], 'x', 0.03, 0.19, MAT.steel, { segments: 12, caps: false, tint: DARK });
  xf.box([-0.05, y - 0.05, z + 0.16], [0.05, y + 0.05, z + 0.24], MAT.metalGreen, { tint: [0.85, 0.9, 0.85] });
  xf.cyl([0, y, z + 0.24], 'z', 0.06, 0.012, MAT.steel, { segments: 4, caps: false });
  wheel(xf, [0, y, z + 0.3], 'z', 0.085, MAT.paintRed, [0.95, 0.9, 0.9], 8);
  xf.box([-0.04, y + 0.17, z - 0.02], [0.04, y + 0.2, z + 0.02], MAT.steel, { tint: GREY });
}

/**
 * Противовзрывное устройство на стене: стальной короб 0,6 × 0,6 × 0,25 м, жалюзи из шести пластин,
 * сбоку рычаг с красной рукоятью. y = 0 — низ короба.
 */
export function blastValve(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.85, 0.88, 0.85], 0.9 + rnd() * 0.2);
  xf.box([-0.3, 0, 0], [0.3, 0.6, 0.25], MAT.metalGrey, { bevel: 0.015, tint: paint });
  for (const y of [0, 0.545]) xf.box([-0.3, y, 0.25], [0.3, y + 0.055, 0.266], MAT.metalGrey, { tint: dim(paint, 0.9) });
  for (const x of [-0.3, 0.245]) xf.box([x, 0.055, 0.25], [x + 0.055, 0.545, 0.266], MAT.metalGrey, { tint: dim(paint, 0.9) });
  xf.box([-0.245, 0.055, 0.25], [0.245, 0.545, 0.252], MAT.rubber, { tint: [0.6, 0.6, 0.6] });
  for (let i = 0; i < 6; i++) {
    const y = 0.08 + i * 0.078;
    xf.box([-0.245, y, 0.252], [0.245, y + 0.05, 0.262], MAT.steel, { tint: [0.6, 0.6, 0.6] });
  }
  for (const x of [-0.272, 0.272]) for (const y of [0.028, 0.572]) xf.box([x - 0.015, y - 0.015, 0.266], [x + 0.015, y + 0.015, 0.278], MAT.steel, { tint: DARK });
  // Рычаг взвода на правой стенке.
  xf.cyl([0.3, 0.3, 0.12], 'x', 0.04, 0.03, MAT.steel, { segments: 6, tint: GREY });
  xf.box([0.335, 0.3, 0.11], [0.35, 0.56, 0.13], MAT.steel, { tint: GREY });
  xf.cyl([0.3425, 0.56, 0.12], 'y', 0.1, 0.016, MAT.paintRed, { segments: 6 });
}

/**
 * Тягонапоромер: дощечка 0,15 × 0,5 м с U-образной стеклянной трубкой, шкалой и резиновыми шлангами;
 * один шланг сорван и висит. y = 0 — низ дощечки.
 */
export function uGauge(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  xf.box([-0.075, 0, 0], [0.075, 0.5, 0.015], MAT.wood, { tint: [0.8, 0.75, 0.68] });
  xf.box([-0.012, 0.06, 0.015], [0.012, 0.44, 0.018], MAT.paper, { tint: [0.9, 0.87, 0.72] });
  for (let i = 0; i < 7; i++) xf.box([-0.012, 0.1 + i * 0.05, 0.018], [0.012, 0.103 + i * 0.05, 0.0195], MAT.rubber);
  // Колена трубки: внизу подкрашенная вода, уровни разошлись.
  const lv = [0.16 + rnd() * 0.06, 0.24 + rnd() * 0.06];
  for (let k = 0; k < 2; k++) {
    const x = k === 0 ? -0.03 : 0.03;
    xf.cyl([x, 0.07, 0.024], 'y', lv[k]! - 0.07, 0.007, MAT.paintRed, { segments: 5, caps: false, tint: [0.7, 0.6, 0.6] });
    xf.cyl([x, lv[k]!, 0.024], 'y', 0.43 - lv[k]!, 0.007, MAT.glass, { segments: 5, caps: false, tint: [1.1, 1.1, 1.1] });
    xf.cyl([x, 0.43, 0.024], 'y', 0.04, 0.009, MAT.rubber, { segments: 5, caps: false });
  }
  xf.cyl([-0.03, 0.07, 0.024], 'x', 0.06, 0.007, MAT.paintRed, { segments: 5, tint: [0.7, 0.6, 0.6] });
  for (const y of [0.12, 0.38]) xf.box([-0.045, y, 0.015], [0.045, y + 0.012, 0.033], MAT.steel, { tint: GREY });
  // Левый шланг уходит вверх за дощечку, правый сорван и свисает.
  xf.cyl([0.03, 0.465, 0.024], 'x', 0.07, 0.008, MAT.rubber, { segments: 5, caps: false });
  xf.cyl([0.1, 0.2, 0.024], 'y', 0.27, 0.008, MAT.rubber, { segments: 5 });
}

// ───────────────────────────── электрика ─────────────────────────────

/**
 * Рубильник: серый ящик 0,3 × 0,4 × 0,15 м с дверцей, сбоку привод с чёрной рукоятью (по сиду — вверх
 * или вниз), сверху труба-ввод. y = 0 — низ ящика.
 */
export function knifeSwitch(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.85, 0.87, 0.9], 0.9 + rnd() * 0.2);
  xf.box([-0.15, 0, 0], [0.15, 0.4, 0.15], MAT.metalGrey, { bevel: 0.012, tint: paint });
  xf.box([-0.13, 0.03, 0.15], [0.13, 0.37, 0.158], MAT.metalGrey, { tint: dim(paint, 1.1) });
  for (const y of [0.07, 0.29]) xf.box([-0.15, y, 0.15], [-0.132, y + 0.04, 0.166], MAT.steel, { tint: DARK });
  xf.box([0.1, 0.18, 0.158], [0.125, 0.22, 0.172], MAT.steel, { tint: GREY });
  xf.box([-0.07, 0.25, 0.158], [0.05, 0.31, 0.161], MAT.paper, { tint: [0.85, 0.8, 0.6] });
  // Привод на правой стенке.
  const up = rnd() < 0.4;
  xf.cyl([0.15, 0.3, 0.075], 'x', 0.03, 0.045, MAT.steel, { segments: 8, tint: DARK });
  xf.box([0.18, up ? 0.3 : 0.1, 0.065], [0.195, up ? 0.5 : 0.3, 0.085], MAT.steel, { tint: GREY });
  xf.cyl([0.1875, up ? 0.5 : 0.02, 0.075], 'y', 0.09, 0.016, MAT.bakelite, { segments: 6, tint: [1.1, 1.1, 1.1] });
  xf.cyl([0, 0.4, 0.075], 'y', 0.03, 0.032, MAT.steel, { segments: 6, tint: DARK });
  xf.cyl([0, 0.43, 0.075], 'y', 0.32, 0.02, MAT.steel, { segments: 6, caps: false, tint: [0.6, 0.6, 0.6] });
}

/**
 * Щиток 0,5 × 0,6 м: три ряда фарфоровых предохранителей-«пробок» (часть вывернута — пустые гнёзда),
 * пакетный выключатель, шина, два ввода сверху. y = 0 — низ щитка.
 */
export function fuseBoard(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  xf.box([-0.25, 0, 0], [0.25, 0.6, 0.03], MAT.wood, { tint: [0.6, 0.56, 0.52] });
  for (let row = 0; row < 3; row++) {
    const y = 0.47 - row * 0.15;
    xf.box([-0.21, y - 0.04, 0.03], [0.03, y + 0.04, 0.044], MAT.bakelite, { tint: [1.1, 1.1, 1.1] });
    for (let i = 0; i < 3; i++) {
      const x = -0.17 + i * 0.08;
      if (rnd() < 0.22) xf.box([x - 0.018, y - 0.018, 0.044], [x + 0.018, y + 0.018, 0.05], MAT.brass, { tint: [0.7, 0.62, 0.5] });
      else xf.cyl([x, y, 0.044], 'z', 0.045, 0.028, MAT.enamel, { segments: 6, tint: [0.92, 0.9, 0.84] });
    }
  }
  xf.cyl([0.14, 0.4, 0.03], 'z', 0.045, 0.05, MAT.bakelite, { segments: 8, tint: [1.1, 1.1, 1.1] });
  xf.box([0.13, 0.36, 0.075], [0.15, 0.44, 0.095], MAT.bakelite);
  xf.box([-0.21, 0.07, 0.03], [0.2, 0.085, 0.037], MAT.brass, { tint: [0.75, 0.7, 0.6] });
  for (const x of [-0.12, 0.14]) xf.cyl([x, 0.6, 0.012], 'y', 0.15, 0.008, MAT.rubber, { segments: 4, caps: false });
}

/**
 * Кабельный лоток под потолком вдоль стены, длина 2,4 м: полка из уголков на подвесах, 5–7 чёрных
 * кабелей разной толщины; крайний оборван — один конец свисает на 0,6 м. y = 0 — потолок.
 */
export function cableTray(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const yt = -0.25;
  for (const z of [0.06, 0.345]) xf.box([-1.2, yt - 0.03, z], [1.2, yt + 0.01, z + 0.015], MAT.steel, { tint: DARK });
  for (let x = -1.0; x < 1.1; x += 0.4) xf.box([x - 0.015, yt - 0.03, 0.075], [x + 0.015, yt - 0.018, 0.345], MAT.steel, { tint: DARK });
  for (const x of [-0.8, 0.8]) for (const z of [0.0675, 0.3525]) xf.box([x - 0.006, yt + 0.01, z - 0.006], [x + 0.006, 0, z + 0.006], MAT.steel, { tint: DARK });
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n - 1; i++) {
    const r = 0.009 + rnd() * 0.014;
    const z = 0.1 + (i / (n - 2)) * 0.2 + (rnd() - 0.5) * 0.015;
    const g = 0.75 + rnd() * 0.35;
    xf.cyl([-1.2, yt - 0.018 + r, z], 'x', 2.4, r, MAT.rubber, { segments: 5, caps: false, tint: [g, g, g] });
  }
  // Оборванный кабель лежит на переднем борту: левый конец перевалился и висит, правый остался в лотке.
  const r = 0.016;
  const y = yt + 0.01 + r;
  const z = 0.3525;
  const xt = -0.3 + rnd() * 0.6;
  const gap = 0.3 + rnd() * 0.3;
  xf.cyl([-1.2, y, z], 'x', xt + 1.2, r, MAT.rubber, { segments: 5, caps: false });
  xf.cyl([xt, y - 0.6, z], 'y', 0.6 + r, r, MAT.rubber, { segments: 5 });
  xf.cyl([xt, y - 0.63, z], 'y', 0.03, r * 0.55, MAT.brass, { segments: 4, tint: [0.8, 0.7, 0.6] });
  xf.cyl([xt + gap, y, z], 'x', 1.2 - xt - gap, r, MAT.rubber, { segments: 5 });
  xf.cyl([xt + gap - 0.03, y, z], 'x', 0.03, r * 0.55, MAT.brass, { segments: 4, tint: [0.8, 0.7, 0.6] });
}

/**
 * Стеллаж аккумуляторов 1,4 × 0,45 × 1,2 м: два яруса по шесть стеклянных банок, сверху тёмные блоки
 * пластин и свинцовые перемычки через одну спереди и сзади; одной банки нет, на клеммах белёсые окислы.
 */
export function batteryRack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = [0.72, 0.68, 0.62];
  for (const x of [-0.7, 0.66]) for (const z of [0.03, 0.41]) xf.box([x, 0, z], [x + 0.04, 1.14, z + 0.04], MAT.wood, { tint: dim(wood, 0.9), aoBottom: 0.6 });
  const missing = Math.floor(rnd() * 12);
  for (let tier = 0; tier < 2; tier++) {
    const y = 0.25 + tier * 0.52;
    xf.box([-0.69, y - 0.035, 0.035], [0.69, y, 0.445], MAT.wood, { tint: wood });
    for (let i = 0; i < 6; i++) {
      if (tier * 6 + i === missing) continue;
      const x = -0.55 + i * 0.22;
      xf.box([x - 0.095, y, 0.08], [x + 0.095, y + 0.3, 0.4], MAT.glass, { tint: [1.05, 1.1, 1.05], aoBottom: 0.75 });
      xf.box([x - 0.08, y + 0.3, 0.1], [x + 0.08, y + 0.325, 0.38], MAT.castIron, { tint: [0.9, 0.9, 0.9] });
      if (i < 5 && tier * 6 + i + 1 !== missing) {
        const z = i % 2 === 0 ? 0.13 : 0.32;
        xf.box([x + 0.03, y + 0.325, z], [x + 0.19, y + 0.345, z + 0.03], MAT.zinc, { tint: [0.6, 0.6, 0.62] });
      }
      if (rnd() < 0.3) xf.box([x - 0.05, y + 0.325, 0.2], [x + 0.01, y + 0.35, 0.27], MAT.plaster, { tint: [0.82, 0.88, 0.82] });
    }
  }
  // Вывод батареи по стене.
  xf.cyl([-0.62, 0.6, 0.02], 'y', 0.6, 0.012, MAT.rubber, { segments: 5, caps: false });
  xf.collider([-0.7, 0, 0.03], [0.7, 1.14, 0.45]);
}

/**
 * Трансформатор 0,7 × 0,5 × 1,0 м: бак на салазках с вертикальными рёбрами охлаждения, три
 * изолятора на крышке, расширитель позади, сливной кран, под баком — масляное пятно.
 */
export function transformer(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.75, 0.78, 0.8], 0.9 + rnd() * 0.2);
  sheet(xf, [-0.34, 0.003, 0.2], [-0.3, 0.003, 0.55], [0.2, 0.003, 0.55], [0.26, 0.003, 0.22], [0, 1, 0], MAT.wetConcrete, [0.45, 0.42, 0.4]);
  for (const x of [-0.25, 0.19]) xf.box([x, 0, 0.06], [x + 0.06, 0.08, 0.46], MAT.steel, { tint: DARK, aoBottom: 0.6 });
  xf.box([-0.27, 0.08, 0.1], [0.27, 0.72, 0.42], MAT.metalGrey, { bevel: 0.015, tint: paint, aoBottom: 0.6 });
  xf.box([-0.29, 0.72, 0.08], [0.29, 0.745, 0.44], MAT.metalGrey, { tint: dim(paint, 0.85) });
  for (let i = 0; i < 7; i++) {
    const x = -0.21 + i * 0.07;
    xf.box([x - 0.008, 0.14, 0.42], [x + 0.008, 0.66, 0.47], MAT.metalGrey, { tint: dim(paint, 0.9) });
  }
  for (const s of [-1, 1]) for (const z of [0.17, 0.26, 0.35]) xf.box([s * 0.27, 0.14, z - 0.008], [s * 0.32, 0.66, z + 0.008], MAT.metalGrey, { tint: dim(paint, 0.9) });
  // Изоляторы: бурый глазурованный фарфор с юбкой и шпилькой.
  for (const x of [-0.16, 0, 0.16]) {
    xf.cyl([x, 0.745, 0.3], 'y', 0.16, 0.036, MAT.tileFloor, { segments: 6, radiusEnd: 0.022, tint: [0.8, 0.75, 0.7] });
    xf.cyl([x, 0.8, 0.3], 'y', 0.02, 0.056, MAT.tileFloor, { segments: 6, tint: [0.8, 0.75, 0.7] });
    xf.box([x - 0.007, 0.905, 0.293], [x + 0.007, 0.95, 0.307], MAT.brass, { tint: [0.75, 0.7, 0.6] });
  }
  for (const x of [-0.17, 0.13]) xf.box([x, 0.745, 0.12], [x + 0.04, 0.8, 0.16], MAT.steel, { tint: DARK });
  xf.cyl([-0.2, 0.86, 0.14], 'x', 0.4, 0.06, MAT.metalGrey, { segments: 8, tint: paint });
  xf.cyl([0.2, 0.13, 0.47], 'z', 0.04, 0.014, MAT.brass, { segments: 6, tint: [0.75, 0.7, 0.6] });
  xf.collider([-0.32, 0, 0.06], [0.32, 0.9, 0.47]);
}

/**
 * Три баллона высотой 1,4 м в стойке у стены, перехвачены цепью: два чёрных, один голубой
 * (кислород); у двух вентили открыты, на одном — колпак. Ширина 0,8 м.
 */
export function airCylinders(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  for (const s of [-1, 1]) {
    xf.box([s * 0.38, 0, 0], [s * 0.34, 1.1, 0.03], MAT.steel, { tint: DARK, aoBottom: 0.6 });
    xf.box([s * 0.38, 0.95, 0.03], [s * 0.35, 0.99, 0.27], MAT.steel, { tint: DARK });
  }
  for (const y of [0.35, 0.95]) xf.box([-0.34, y, 0], [0.34, y + 0.04, 0.025], MAT.steel, { tint: DARK });
  xf.box([-0.38, 0, 0.03], [0.38, 0.03, 0.28], MAT.steel, { tint: [0.45, 0.45, 0.45] });
  const blue = Math.floor(rnd() * 3);
  const capped = Math.floor(rnd() * 3);
  for (let i = 0; i < 3; i++) {
    const x = -0.24 + i * 0.24;
    const mat = i === blue ? MAT.metalGrey : MAT.castIron;
    const tint: Vec3 = i === blue ? [0.55, 0.9, 1.3] : dim([1, 1, 1], 0.9 + rnd() * 0.25);
    xf.cyl([x, 0.03, 0.15], 'y', 1.12, 0.105, mat, { segments: 10, tint, ao: 0.95 });
    xf.cyl([x, 1.15, 0.15], 'y', 0.1, 0.105, mat, { segments: 10, radiusEnd: 0.04, caps: false, tint });
    if (i === capped) {
      xf.cyl([x, 1.25, 0.15], 'y', 0.13, 0.055, mat, { segments: 8, radiusEnd: 0.045, tint: dim(tint, 0.9) });
    } else {
      xf.cyl([x, 1.25, 0.15], 'y', 0.08, 0.028, MAT.brass, { segments: 6, tint: [0.75, 0.7, 0.6] });
      xf.box([x - 0.01, 1.285, 0.15], [x + 0.065, 1.31, 0.17], MAT.brass, { tint: [0.75, 0.7, 0.6] });
      xf.cyl([x, 1.33, 0.15], 'y', 0.014, 0.04, MAT.castIron, { segments: 6, tint: [1.1, 1.1, 1.1] });
    }
  }
  // Цепь провисает между крюками стойки.
  const pts: Vec3[] = [
    [-0.365, 0.97, 0.265],
    [-0.18, 0.93, 0.268],
    [0, 0.92, 0.268],
    [0.18, 0.93, 0.268],
    [0.365, 0.97, 0.265],
  ];
  for (let i = 0; i < 4; i++) beam(xf, pts[i]!, pts[i + 1]!, 0.012, 0.012, MAT.castIron, [1.1, 1.1, 1.1], { caps: false });
  xf.collider([-0.38, 0, 0], [0.38, 1.35, 0.27]);
}

// ───────────────────────────── вода и санузел ─────────────────────────────

/**
 * Напольная чаша «Генуя» на ступеньке 1,0 × 1,2 × 0,2 м: эмалированная чаша с бортом и рифлёными
 * площадками для ног, под потолком чугунный бачок на кронштейнах, смывная труба по стене, рычаг
 * с цепочкой и деревянной ручкой. На ступеньку можно встать (она ниже шага).
 */
export function squatToilet(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const e: Vec3 = dim([0.85, 0.83, 0.76], 0.9 + rnd() * 0.15);
  xf.solid([-0.5, 0, 0], [0.5, 0.2, 1.2], MAT.tileFloor, { bevel: 0.012, tint: [0.62, 0.62, 0.62], aoBottom: 0.6 });
  xf.box([-0.21, 0.2, 0.35], [0.21, 0.212, 0.95], MAT.enamel, { tint: dim(e, 0.78) });
  for (const s of [-1, 1]) {
    xf.box([s * 0.21, 0.212, 0.35], [s * 0.18, 0.236, 0.95], MAT.enamel, { tint: e });
    xf.box([s * 0.16, 0.212, 0.52], [s * 0.07, 0.228, 0.84], MAT.enamel, { tint: dim(e, 0.92) });
  }
  for (const z of [0.35, 0.92]) xf.box([-0.18, 0.212, z], [0.18, 0.236, z + 0.03], MAT.enamel, { tint: e });
  // Сток у стены и ржавый потёк к нему.
  xf.box([-0.035, 0.212, 0.4], [0.035, 0.2135, 0.78], MAT.rust, { tint: [0.9, 0.85, 0.8] });
  xf.cyl([0, 0.2135, 0.46], 'y', 0.003, 0.05, MAT.rubber, { segments: 8, tint: [0.5, 0.5, 0.5] });
  // Бачок под потолком.
  xf.box([-0.2, 1.85, 0.02], [0.2, 2.12, 0.24], MAT.castIron, { bevel: 0.015, tint: [1.1, 1.1, 1.1] });
  xf.box([-0.21, 2.12, 0.01], [0.21, 2.14, 0.25], MAT.castIron, { tint: [0.9, 0.9, 0.9] });
  for (const s of [-1, 1]) xf.box([s * 0.16 - 0.015, 1.78, 0], [s * 0.16 + 0.015, 1.85, 0.2], MAT.steel, { tint: DARK });
  xf.cyl([0, 0.26, 0.07], 'y', 1.59, 0.022, MAT.rust, { segments: 6, caps: false, tint: [0.9, 0.88, 0.85] });
  for (const y of [0.75, 1.4]) xf.box([-0.04, y, 0], [0.04, y + 0.025, 0.1], MAT.steel, { tint: DARK });
  xf.box([-0.03, 0.2, 0.04], [0.03, 0.27, 0.38], MAT.rust, { tint: [0.9, 0.88, 0.85] });
  const chain = 0.4 + rnd() * 0.4;
  xf.box([0.2, 2.05, 0.11], [0.34, 2.07, 0.13], MAT.steel, { tint: GREY });
  xf.cyl([0.33, 2.05 - chain, 0.12], 'y', chain, 0.004, MAT.steel, { segments: 3, caps: false, tint: GREY });
  xf.cyl([0.33, 1.95 - chain, 0.12], 'y', 0.1, 0.014, MAT.wood, { segments: 6, tint: [0.8, 0.75, 0.7] });
}

/**
 * Душ: стояк по стене с вентилем, наверху отвод от стены на 0,4 м и лейка на высоте 1,9 м; под
 * лейкой чугунная решётка трапа и мокрое пятно. Стоит на полу: трап должен лечь точно в пол.
 */
export function showerStub(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const pipe: Vec3 = dim([0.8, 0.8, 0.8], 0.9 + rnd() * 0.2);
  sheet(xf, [-0.27, 0.003, 0.16], [-0.27, 0.003, 0.6], [0.27, 0.003, 0.6], [0.27, 0.003, 0.16], [0, 1, 0], MAT.wetConcrete, [0.75, 0.75, 0.78]);
  xf.cyl([0, 1.05, 0], 'z', 0.012, 0.04, MAT.steel, { segments: 8, tint: DARK });
  xf.cyl([0, 1.05, 0.035], 'y', 1.04, 0.018, MAT.steel, { segments: 6, caps: false, tint: pipe });
  xf.box([-0.025, 1.18, 0.012], [0.025, 1.24, 0.058], MAT.brass, { tint: [0.7, 0.65, 0.55] });
  xf.cyl([0, 1.21, 0.058], 'z', 0.03, 0.008, MAT.steel, { segments: 4, caps: false });
  xf.cyl([0, 1.21, 0.088], 'z', 0.012, 0.035, MAT.paintRed, { segments: 8, tint: [0.9, 0.9, 0.9] });
  for (const y of [1.5, 1.95]) xf.box([-0.03, y, 0], [0.03, y + 0.02, 0.055], MAT.steel, { tint: DARK });
  xf.box([-0.02, 2.06, 0.015], [0.02, 2.1, 0.055], MAT.steel, { tint: pipe });
  xf.cyl([0, 2.08, 0.055], 'z', 0.345, 0.018, MAT.steel, { segments: 6, caps: false, tint: pipe });
  xf.box([-0.02, 2.06, 0.38], [0.02, 2.1, 0.42], MAT.steel, { tint: pipe });
  xf.cyl([0, 1.98, 0.4], 'y', 0.08, 0.018, MAT.steel, { segments: 6, caps: false, tint: pipe });
  // Лейка раструбом вниз, сетка тёмная от накипи.
  xf.cyl([0, 1.9, 0.4], 'y', 0.08, 0.095, MAT.zinc, { segments: 8, radiusEnd: 0.022, tint: [0.8, 0.8, 0.78] });
  xf.cyl([0, 1.895, 0.4], 'y', 0.005, 0.086, MAT.rubber, { segments: 8, tint: [0.7, 0.7, 0.7] });
  // Трап.
  xf.box([-0.11, 0, 0.29], [0.11, 0.008, 0.51], MAT.castIron, { tint: [1.1, 1.1, 1.1] });
  xf.box([-0.085, 0.008, 0.315], [0.085, 0.0095, 0.485], MAT.rubber, { tint: [0.5, 0.5, 0.5] });
  for (let i = 0; i < 4; i++) {
    const x = -0.0675 + i * 0.045;
    xf.box([x - 0.008, 0.0095, 0.315], [x + 0.008, 0.014, 0.485], MAT.castIron, { tint: [1.1, 1.1, 1.1] });
  }
}

/**
 * Ручной насос: чугунная колонка высотой 1,1 м на плите, излив влево, качалка-рычаг опущена
 * вправо, под изливом ведро с тёмной водой. Ширина 1,2 м; преграда — только колонка.
 */
export function handPump(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const iron: Vec3 = dim([1.1, 1.1, 1.1], 0.85 + rnd() * 0.25);
  const px = -0.14;
  const pz = 0.26;
  xf.cyl([px, 0, pz], 'y', 0.03, 0.14, MAT.castIron, { segments: 10, tint: iron, ao: 0.9 });
  xf.cyl([px, 0.03, pz], 'y', 0.6, 0.06, MAT.castIron, { segments: 8, caps: false, tint: iron });
  xf.cyl([px, 0.63, pz], 'y', 0.32, 0.085, MAT.castIron, { segments: 8, tint: iron });
  xf.cyl([px, 0.95, pz], 'y', 0.05, 0.085, MAT.castIron, { segments: 8, radiusEnd: 0.03, tint: iron });
  // Излив с носиком.
  xf.cyl([px - 0.29, 0.8, pz], 'x', 0.22, 0.03, MAT.castIron, { segments: 6, tint: iron });
  xf.box([px - 0.31, 0.73, pz - 0.03], [px - 0.27, 0.8, pz + 0.03], MAT.castIron, { tint: iron });
  // Шток, вилка и качалка.
  xf.cyl([px, 1.0, pz], 'y', 0.1, 0.012, MAT.steel, { segments: 4, caps: false, tint: GREY });
  xf.box([px, 0.9, pz - 0.02], [px + 0.13, 0.94, pz + 0.02], MAT.castIron, { tint: iron });
  xf.box([px + 0.09, 0.94, pz - 0.02], [px + 0.13, 1.1, pz + 0.02], MAT.castIron, { tint: iron });
  beam(xf, [px - 0.02, 1.1, pz], [px + 0.11, 1.085, pz], 0.03, 0.03, MAT.castIron, iron);
  beam(xf, [px + 0.11, 1.085, pz], [px + 0.72, 0.74, pz], 0.03, 0.03, MAT.castIron, iron);
  // Ведро под изливом.
  bucket(xf.child(px - 0.29, 0, pz));
  xf.cyl([px - 0.29, 0.268, pz], 'y', 0.004, 0.125, MAT.wetConcrete, { segments: 10, tint: [0.5, 0.5, 0.52] });
  xf.collider([px - 0.1, 0, pz - 0.1], [px + 0.1, 1.0, pz + 0.1]);
}

/**
 * Бачок для питьевой воды: оцинкованный цилиндр на 40 л с крышкой и краном на крашеной тумбе,
 * табличка, сбоку на цепочке висит эмалированная кружка. Ширина 0,75 м.
 */
export function waterDrum(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const zn: Vec3 = dim([0.85, 0.87, 0.85], 0.9 + rnd() * 0.2);
  const paint: Vec3 = [0.66, 0.74, 0.66];
  xf.box([-0.22, 0, 0.05], [0.22, 0.04, 0.45], MAT.wood, { tint: dim(paint, 0.7), aoBottom: 0.6 });
  xf.box([-0.24, 0.04, 0.03], [0.24, 0.62, 0.47], MAT.wood, { bevel: 0.01, tint: paint, aoBottom: 0.7 });
  xf.box([-0.2, 0.1, 0.47], [0.2, 0.56, 0.482], MAT.wood, { tint: dim(paint, 1.1) });
  xf.box([0.13, 0.3, 0.482], [0.15, 0.36, 0.5], MAT.steel, { tint: GREY });
  const cy = 0.62;
  const cz = 0.25;
  const r = 0.18;
  xf.cyl([0, cy, cz], 'y', 0.42, r, MAT.zinc, { segments: 12, tint: zn });
  for (const y of [cy + 0.02, cy + 0.37]) xf.cyl([0, y, cz], 'y', 0.015, r + 0.008, MAT.zinc, { segments: 12, caps: false, tint: dim(zn, 0.75) });
  xf.cyl([0, cy + 0.42, cz], 'y', 0.025, r + 0.012, MAT.zinc, { segments: 12, tint: dim(zn, 0.9) });
  xf.box([-0.05, cy + 0.445, cz - 0.01], [0.05, cy + 0.47, cz + 0.01], MAT.steel, { tint: DARK });
  // Кран и табличка.
  xf.cyl([0, cy + 0.06, cz + r - 0.01], 'z', 0.08, 0.014, MAT.brass, { segments: 6, tint: [0.8, 0.75, 0.65] });
  xf.box([-0.012, cy + 0.015, cz + r + 0.045], [0.012, cy + 0.06, cz + r + 0.07], MAT.brass, { tint: [0.8, 0.75, 0.65] });
  xf.box([-0.03, cy + 0.074, cz + r + 0.03], [0.03, cy + 0.084, cz + r + 0.05], MAT.brass, { tint: [0.8, 0.75, 0.65] });
  xf.box([-0.07, cy + 0.2, cz + r - 0.014], [0.07, cy + 0.28, cz + r + 0.003], MAT.paper, { tint: [0.85, 0.82, 0.68] });
  // Кружка на цепочке: от ушка бачка через край тумбы.
  const chain: Vec3[] = [
    [0.17, cy + 0.3, cz + 0.06],
    [0.235, cy + 0.02, cz + 0.1],
    [0.262, 0.44, cz + 0.1],
  ];
  for (let i = 0; i < 2; i++) beam(xf, chain[i]!, chain[i + 1]!, 0.007, 0.007, MAT.steel, GREY, { caps: false });
  const green = rnd() < 0.5;
  const mug: Vec3 = green ? [0.55, 0.8, 0.62] : [0.9, 0.88, 0.82];
  xf.cyl([0.31, 0.35, cz + 0.1], 'y', 0.09, 0.042, MAT.enamel, { segments: 8, tint: mug });
  xf.box([0.256, 0.37, cz + 0.092], [0.27, 0.43, cz + 0.108], MAT.enamel, { tint: mug });
  xf.collider([-0.24, 0, 0.03], [0.24, 1.06, 0.47]);
}

/**
 * Рукомойник: дощатый щит на стене, эмалированный бачок с крышкой и соском, под ним раковина-таз
 * на кронштейнах со сливом, на полу ведро, сбоку на гвозде тряпка. Ширина 0,5 м, высота 1,65 м.
 */
export function washstand(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const en: Vec3 = dim([0.9, 0.9, 0.86], 0.88 + rnd() * 0.15);
  xf.box([-0.25, 0.72, 0], [0.25, 1.65, 0.02], MAT.wood, { tint: [0.68, 0.72, 0.68] });
  xf.box([-0.13, 1.25, 0.02], [0.13, 1.55, 0.17], MAT.enamel, { bevel: 0.015, tint: en });
  xf.box([-0.14, 1.55, 0.015], [0.14, 1.57, 0.18], MAT.enamel, { tint: dim(en, 0.9) });
  xf.cyl([0, 1.19, 0.1], 'y', 0.06, 0.008, MAT.brass, { segments: 4, tint: [0.8, 0.75, 0.6] });
  // Сколы эмали до чёрного железа.
  xf.box([0.04, 1.29, 0.17], [0.1, 1.33, 0.172], MAT.castIron);
  xf.box([-0.11, 1.43, 0.17], [-0.08, 1.48, 0.172], MAT.castIron);
  // Таз на кронштейнах: нутро темнее, в середине ржавое пятно стока.
  for (const s of [-1, 1]) xf.box([s * 0.17 - 0.012, 0.76, 0.02], [s * 0.17 + 0.012, 0.8, 0.4], MAT.steel, { tint: DARK });
  xf.cyl([0, 0.8, 0.24], 'y', 0.11, 0.15, MAT.enamel, { segments: 10, radiusEnd: 0.21, tint: en });
  xf.cyl([0, 0.91, 0.24], 'y', 0.003, 0.185, MAT.enamel, { segments: 10, tint: dim(en, 0.62) });
  xf.cyl([0, 0.913, 0.24], 'y', 0.002, 0.04, MAT.rust, { segments: 6 });
  xf.cyl([0, 0.6, 0.24], 'y', 0.2, 0.02, MAT.steel, { segments: 6, caps: false, tint: GREY });
  bucket(xf.child(0, 0, 0.26));
  // Тряпка на гвозде.
  xf.box([0.16, 0.98, 0.02], [0.235, 1.32, 0.034], MAT.canvas, { tint: [0.8, 0.78, 0.72] });
  xf.collider([-0.22, 0, 0.02], [0.22, 0.91, 0.45]);
}

// ───────────────────────────── жилое и управление ─────────────────────────────

/**
 * Трёхъярусные нары 1,9 × 0,7 × 2,1 м из стальных труб с дощатыми настилами (часть досок выбита);
 * на нижнем ярусе свёрнутый матрас, с верхнего свисает одеяло. Стоят длинной стороной вдоль стены.
 */
export function bunkTriple(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.9, 0.95, 0.9], 0.85 + rnd() * 0.2);
  const L = 0.93;
  for (const x of [-L, L]) for (const z of [0.04, 0.66]) xf.cyl([x, 0, z], 'y', 2.1, 0.02, MAT.metalGreen, { segments: 6, tint: paint, ao: 0.9 });
  for (let t = 0; t < 3; t++) {
    const y = 0.4 + t * 0.65;
    for (const z of [0.04, 0.66]) xf.cyl([-L, y, z], 'x', 2 * L, 0.018, MAT.metalGreen, { segments: 6, caps: false, tint: paint });
    for (const x of [-L, L]) xf.cyl([x, y, 0.04], 'z', 0.62, 0.018, MAT.metalGreen, { segments: 6, caps: false, tint: paint });
    for (let i = 0; i < 4; i++) {
      const g = 0.7 + rnd() * 0.25;
      if (t > 0 && rnd() < 0.15) continue;
      const z = 0.065 + i * 0.145;
      xf.box([-L + 0.02, y + 0.018, z], [L - 0.02, y + 0.04, z + 0.135], MAT.wood, { tint: [g, g * 0.97, g * 0.92] });
    }
  }
  // Свёрнутый матрас, перехваченный ремнём.
  const mx = rnd() < 0.5 ? -0.6 : 0.55;
  xf.cyl([mx, 0.57, 0.08], 'z', 0.54, 0.13, MAT.canvas, { segments: 10, tint: [0.85, 0.8, 0.72] });
  xf.cyl([mx, 0.57, 0.33], 'z', 0.03, 0.134, MAT.leather, { segments: 10, caps: false });
  // Одеяло свесилось с верхнего яруса.
  xf.box([-mx - 0.2, 1.36, 0.665], [-mx + 0.15, 1.75, 0.68], MAT.canvas, { tint: [0.6, 0.6, 0.62] });
  xf.collider([-0.95, 0, 0.02], [0.95, 2.1, 0.68]);
}

/**
 * Панцирная кровать 1,9 × 0,8 м без матраса: трубчатые спинки с прутьями (изголовье выше),
 * царги из уголка, сетка из тонких прутков. Стоит вдоль стены.
 */
export function bedFrame(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.78, 0.82, 0.88], 0.85 + rnd() * 0.25);
  const flip = rnd() < 0.5 ? 1 : -1;
  for (const [sx, h] of [
    [-0.93, 0.95],
    [0.93, 0.75],
  ] as const) {
    const x = sx * flip;
    for (const z of [0.04, 0.76]) xf.cyl([x, 0, z], 'y', h, 0.018, MAT.metalGrey, { segments: 6, tint: paint, ao: 0.9 });
    xf.cyl([x, h - 0.02, 0.04], 'z', 0.72, 0.018, MAT.metalGrey, { segments: 6, caps: false, tint: paint });
    xf.cyl([x, 0.45, 0.04], 'z', 0.72, 0.012, MAT.metalGrey, { segments: 5, caps: false, tint: paint });
    for (let i = 1; i < 5; i++) xf.cyl([x, 0.45, 0.04 + i * 0.144], 'y', h - 0.47, 0.007, MAT.metalGrey, { segments: 4, caps: false, tint: paint });
  }
  for (const z of [0.04, 0.73]) xf.box([-0.93, 0.34, z], [0.93, 0.38, z + 0.03], MAT.steel, { tint: DARK });
  for (let i = 0; i < 7; i++) xf.cyl([-0.91, 0.35, 0.1 + i * 0.1], 'x', 1.82, 0.004, MAT.steel, { segments: 3, caps: false, tint: GREY });
  for (let i = 0; i < 9; i++) xf.cyl([-0.8 + i * 0.2, 0.353, 0.07], 'z', 0.66, 0.004, MAT.steel, { segments: 3, caps: false, tint: GREY });
  xf.collider([-0.95, 0, 0.02], [0.95, 0.5, 0.78]);
}

/**
 * Вешалка: доска 1,5 м с пятью крюками на высоте 1,6 м; на трёх через один висят плащ ОЗК, сумка
 * противогаза и ватник (в каком порядке — по сиду). y = 0 — подол плаща, 0,4 м над полом.
 */
export function coatHooks(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const hy = 1.2;
  xf.box([-0.75, hy - 0.03, 0], [0.75, hy + 0.07, 0.022], MAT.wood, { tint: [0.7, 0.66, 0.6] });
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.3;
    xf.box([x - 0.008, hy, 0.022], [x + 0.008, hy + 0.014, 0.075], MAT.steel, { tint: DARK });
  }
  // Три вещи занимают крюки 0, 2 и 4 — иначе широкие полы лезут друг в друга.
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  const at = (k: number): number => -0.6 + order[k]! * 0.6;
  // Плащ ОЗК: прорезиненный «мешок» с капюшоном и отогнутой полой.
  {
    const x = at(0);
    const g: Vec3 = dim([0.5, 0.68, 0.5], 0.9 + rnd() * 0.2);
    xf.box([x - 0.13, 0.98, 0.028], [x + 0.13, hy, 0.1], MAT.canvas, { tint: dim(g, 0.9) });
    xf.box([x - 0.21, 0, 0.026], [x + 0.21, 0.99, 0.085], MAT.canvas, { bevel: 0.02, tint: g });
    xf.box([x - 0.235, 0.28, 0.07], [x - 0.09, 0.93, 0.105], MAT.canvas, { tint: dim(g, 0.82) });
  }
  // Сумка противогаза на лямке.
  {
    const x = at(1);
    xf.box([x - 0.012, 0.84, 0.03], [x + 0.012, hy, 0.04], MAT.canvas, { tint: [0.75, 0.75, 0.62] });
    xf.box([x - 0.12, 0.55, 0.025], [x + 0.12, 0.86, 0.13], MAT.canvas, { bevel: 0.025, tint: [0.85, 0.85, 0.7] });
    xf.box([x - 0.12, 0.74, 0.13], [x + 0.12, 0.86, 0.138], MAT.canvas, { tint: [0.7, 0.7, 0.6] });
  }
  // Ватник: стёганое тулово, рукава, воротник.
  {
    const x = at(2);
    const g: Vec3 = dim([0.5, 0.55, 0.68], 0.9 + rnd() * 0.2);
    xf.box([x - 0.22, 0.5, 0.028], [x + 0.22, 1.16, 0.13], MAT.canvas, { bevel: 0.03, tint: g });
    xf.box([x - 0.09, 1.13, 0.035], [x + 0.09, hy, 0.11], MAT.canvas, { tint: dim(g, 0.85) });
    for (const s of [-1, 1]) xf.box([x + s * 0.22, 0.56, 0.035], [x + s * 0.31, 1.1, 0.115], MAT.canvas, { tint: dim(g, 0.92) });
    for (const y of [0.66, 0.82, 0.98]) xf.box([x - 0.19, y, 0.13], [x + 0.19, y + 0.006, 0.133], MAT.canvas, { tint: dim(g, 0.6) });
  }
}

/**
 * Шлем-маска противогаза лицом вверх: лицевая часть с очками, клапанная коробка с обрывком трубки,
 * затылок. Начало — центр лица на полу, трубка тянется к −z.
 */
function maskFace(xf: Xf, tint: Vec3): void {
  xf.cyl([0, 0, 0], 'y', 0.05, 0.075, MAT.enamel, { segments: 6, tint, ao: 0.9 });
  xf.box([-0.07, 0, 0.05], [0.07, 0.03, 0.17], MAT.enamel, { tint: dim(tint, 0.9), aoBottom: 0.7 });
  for (const s of [-1, 1]) xf.cyl([s * 0.034, 0.05, 0.02], 'y', 0.008, 0.024, MAT.glass, { segments: 5 });
  xf.cyl([0, 0.05, -0.035], 'y', 0.025, 0.026, MAT.enamel, { segments: 5, tint: dim(tint, 0.8) });
  xf.cyl([0, 0.02, -0.16], 'z', 0.1, 0.016, MAT.canvas, { segments: 5, caps: false, tint: [0.7, 0.75, 0.65] });
}

/**
 * Деревянный ящик 0,8 × 0,5 × 0,4 м с откинутой к стене крышкой: внутри ряды противогазных коробок
 * Ø 11 см (части уже нет) и резиновые шлем-маски; на крышке изнутри — упаковочный лист.
 */
export function gasmaskCrate(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([0.82, 0.86, 0.76], 0.85 + rnd() * 0.2);
  const z0 = 0.07;
  const z1 = 0.57;
  for (const z of [z0, z1 - 0.02]) xf.box([-0.4, 0, z], [0.4, 0.4, z + 0.02], MAT.wood, { tint: wood, aoBottom: 0.6 });
  for (const x of [-0.4, 0.38]) xf.box([x, 0, z0 + 0.02], [x + 0.02, 0.4, z1 - 0.02], MAT.wood, { tint: wood, aoBottom: 0.6 });
  xf.box([-0.38, 0, z0 + 0.02], [0.38, 0.24, z1 - 0.02], MAT.cardboard, { tint: [0.6, 0.58, 0.55] });
  for (const x of [-0.31, 0.26]) xf.box([x, 0, z1], [x + 0.05, 0.4, z1 + 0.014], MAT.wood, { tint: dim(wood, 0.8) });
  for (const s of [-1, 1]) xf.box([s * 0.4, 0.27, z0 + 0.18], [s * 0.425, 0.3, z0 + 0.32], MAT.canvas, { tint: [0.7, 0.68, 0.6] });
  // Коробки в два ряда.
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      const g = 0.9 + rnd() * 0.2;
      if (rnd() < 0.2) continue;
      xf.cyl([-0.31 + i * 0.12, 0.24, z0 + 0.1 + row * 0.13], 'y', 0.09, 0.055, MAT.metalGreen, { segments: 6, tint: [g * 0.95, g, g * 0.95] });
    }
  }
  // Маски: стопка серой резины, верхняя лежит лицом вверх.
  xf.box([0.15, 0.24, z0 + 0.03], [0.37, 0.285, z1 - 0.03], MAT.enamel, { tint: [0.3, 0.32, 0.3] });
  maskFace(xf.child(0.26, 0.285, z0 + 0.25), [0.36, 0.38, 0.36]);
  xf.cyl([-0.2, 0.24, z0 + 0.38], 'x', 0.3, 0.016, MAT.canvas, { segments: 5, tint: [0.7, 0.75, 0.65] });
  // Крышка откинута и привалена к стене.
  const lidZ = (y: number): number => z0 - 0.012 - ((y - 0.4) / 0.49) * (z0 - 0.028);
  beam(xf, [0, 0.4, lidZ(0.4)], [0, 0.89, lidZ(0.89)], 0.8, 0.02, MAT.wood, dim(wood, 0.9));
  beam(xf, [0.12, 0.52, lidZ(0.52) + 0.0125], [0.12, 0.72, lidZ(0.72) + 0.0125], 0.18, 0.003, MAT.paper, [0.85, 0.82, 0.7]);
  xf.collider([-0.4, 0, z0], [0.4, 0.4, z1]);
}

/** Место для очередной вещи в россыпи: несколько попыток встать, не задевая уже лежащее. */
function scatterSpot(rnd: () => number, placed: Array<[number, number, number]>, rad: number, x0: number, x1: number, z0: number, z1: number): [number, number] {
  let x = 0;
  let z = 0;
  for (let k = 0; k < 16; k++) {
    x = x0 + rnd() * (x1 - x0);
    z = z0 + rnd() * (z1 - z0);
    const px = x;
    const pz = z;
    if (placed.every((q) => Math.hypot(q[0] - px, q[1] - pz) >= q[2] + rad)) break;
  }
  placed.push([x, z, rad]);
  return [x, z];
}

/**
 * Груда противогазов на полу у стены, 1,2 × 0,6 м: 8–10 фильтрующих коробок вповалку (одна — вторым
 * слоем), две серые шлем-маски лицом вверх — очки смотрят в потолок, — три чёрные маски ничком,
 * обрывки гофрированных трубок, две сумки. Низкая — преграды нет.
 */
export function gasmaskPile(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const placed: Array<[number, number, number]> = [];
  const r = 0.055;
  // Маски ложатся первыми — им нужно больше места.
  for (let i = 0; i < 2; i++) {
    const [x, z] = scatterSpot(rnd, placed, 0.15, -0.42, 0.42, 0.22, 0.4);
    const g = 0.85 + rnd() * 0.2;
    maskFace(xf.child(x, 0, z, Math.floor(rnd() * 4) as 0 | 1 | 2 | 3), [0.34 * g, 0.36 * g, 0.34 * g]);
  }
  const n = 8 + Math.floor(rnd() * 3);
  let top: [number, number, number] = [0, 0.4, 0.11];
  for (let i = 0; i < n; i++) {
    const [x, z] = scatterSpot(rnd, placed, 0.06, -0.5, 0.5, 0.08, 0.5);
    const o = Math.floor(rnd() * 3);
    const g = 0.88 + rnd() * 0.22;
    const tint: Vec3 = [g * 0.95, g, g * 0.95];
    if (o === 0) xf.cyl([x, 0, z], 'y', 0.09, r, MAT.metalGreen, { segments: 5, tint, ao: 0.9 });
    else if (o === 1) xf.cyl([x - 0.045, r, z], 'x', 0.09, r, MAT.metalGreen, { segments: 5, tint, ao: 0.9 });
    else xf.cyl([x, r, z - 0.045], 'z', 0.09, r, MAT.metalGreen, { segments: 5, tint, ao: 0.9 });
    if (i === 0) top = [x, z, o === 0 ? 0.09 : 0.11];
  }
  xf.cyl([top[0] + 0.02, top[2] + r - 0.006, top[1] - 0.03], 'z', 0.09, r, MAT.metalGreen, { segments: 5, tint: [0.9, 0.95, 0.9] });
  for (let i = 0; i < 3; i++) {
    const [x, z] = scatterSpot(rnd, placed, 0.1, -0.48, 0.48, 0.1, 0.5);
    const g = 0.95 + rnd() * 0.15;
    xf.box([x - 0.09, 0, z - 0.07], [x + 0.09, 0.04 + rnd() * 0.02, z + 0.07], MAT.rubber, { tint: [g, g, g], aoBottom: 0.7 });
  }
  for (let i = 0; i < 2; i++) {
    const [x, z] = scatterSpot(rnd, placed, 0.05, -0.38, 0.38, 0.2, 0.4);
    const len = 0.22 + rnd() * 0.16;
    if (rnd() < 0.5) xf.cyl([x - len / 2, 0.016, z], 'x', len, 0.016, MAT.canvas, { segments: 5, caps: false, tint: [0.7, 0.75, 0.65] });
    else xf.cyl([x, 0.016, z - len / 2], 'z', len, 0.016, MAT.canvas, { segments: 5, caps: false, tint: [0.7, 0.75, 0.65] });
  }
  // Две сумки: одна лежит в куче, другая привалена к стене.
  const [sx, sz] = scatterSpot(rnd, placed, 0.14, -0.44, 0.44, 0.2, 0.46);
  xf.box([sx - 0.13, 0, sz - 0.1], [sx + 0.13, 0.06 + rnd() * 0.03, sz + 0.1], MAT.canvas, { tint: [0.85, 0.85, 0.7], aoBottom: 0.7 });
  const wx = -0.4 + rnd() * 0.8;
  xf.box([wx - 0.12, 0, 0.01], [wx + 0.12, 0.27, 0.1], MAT.canvas, { tint: [0.8, 0.8, 0.66], aoBottom: 0.65 });
  xf.box([wx - 0.12, 0.17, 0.1], [wx + 0.12, 0.27, 0.107], MAT.canvas, { tint: [0.68, 0.68, 0.58] });
}

/**
 * Санитарные носилки, прислонённые к стене стоймя: две жерди 2,2 м, брезент с бурым пятном,
 * распорки и ножки-скобы. Ширина 0,65 м.
 */
export function stretcher(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const lean = 0.22 + rnd() * 0.08;
  const top = Math.sqrt(2.2 * 2.2 - lean * lean);
  // Точка на плоскости носилок: t — доля длины от пола, off — отступ от плоскости в комнату.
  const at = (x: number, t: number, off = 0): Vec3 => [x, t * top, 0.035 + lean * (1 - t) + off];
  for (const x of [-0.27, 0.27]) beam(xf, at(x, 0), at(x, 1), 0.04, 0.04, MAT.wood, [0.8, 0.76, 0.7], { aoA: 0.6 });
  beam(xf, at(0, 0.12), at(0, 0.88), 0.5, 0.012, MAT.canvas, [0.85, 0.85, 0.72]);
  beam(xf, at(-0.03, 0.4, 0.008), at(-0.03, 0.62, 0.008), 0.3, 0.002, MAT.canvas, [0.52, 0.4, 0.35], { side: [1, 0, 0], caps: false });
  beam(xf, at(0.09, 0.52, 0.0085), at(0.09, 0.7, 0.0085), 0.16, 0.002, MAT.canvas, [0.5, 0.36, 0.32], { side: [1, 0, 0], caps: false });
  for (const t of [0.13, 0.87]) {
    const p = at(0, t, 0.03);
    xf.box([-0.27, p[1] - 0.012, p[2] - 0.012], [0.27, p[1] + 0.012, p[2] + 0.012], MAT.steel, { tint: DARK });
    for (const x of [-0.27, 0.27]) xf.box([x - 0.012, p[1] - 0.06, p[2] + 0.012], [x + 0.012, p[1] - 0.036, p[2] + 0.1], MAT.steel, { tint: DARK });
  }
  xf.collider([-0.3, 0, 0], [0.3, top, lean + 0.07]);
}

/**
 * Пожарный щит 1,2 × 1,0 м на высоте 0,9 м: красная доска, конусное ведро, топор, лом, багор,
 * лопата (одного инструмента может не быть — остался невыгоревший след); под щитом красный ящик
 * с песком 0,8 × 0,5 × 0,5 м. Стоит на полу: ящик — преграда.
 */
export function fireShield(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const red: Vec3 = dim([0.92, 0.88, 0.88], 0.85 + rnd() * 0.2);
  const by = 0.9;
  const gone = Math.floor(rnd() * 6); // 0 — топор, 1 — лопата, прочее — всё на месте
  xf.box([-0.6, by, 0], [0.6, by + 1.0, 0.025], MAT.paintRed, { tint: red });
  for (const y of [by + 0.3, by + 0.72]) xf.box([-0.58, y, 0.025], [0.58, y + 0.02, 0.038], MAT.steel, { tint: DARK });
  // Конусное ведро остриём вниз.
  xf.cyl([-0.42, by + 0.4, 0.17], 'y', 0.33, 0.012, MAT.paintRed, { segments: 8, radiusEnd: 0.13, tint: red });
  xf.cyl([-0.42, by + 0.725, 0.17], 'y', 0.012, 0.136, MAT.paintRed, { segments: 8, caps: false, tint: dim(red, 0.8) });
  // Топор.
  if (gone === 0) xf.box([-0.25, by + 0.12, 0.025], [-0.13, by + 0.82, 0.027], MAT.paintRed, { tint: dim(red, 1.2) });
  else {
    xf.box([-0.2, by + 0.12, 0.04], [-0.165, by + 0.8, 0.07], MAT.wood, { tint: [0.85, 0.8, 0.72] });
    xf.box([-0.26, by + 0.7, 0.04], [-0.12, by + 0.82, 0.068], MAT.paintRed, { tint: red });
    xf.box([-0.285, by + 0.69, 0.045], [-0.26, by + 0.83, 0.063], MAT.steel, { tint: GREY });
  }
  xf.cyl([0, by + 0.06, 0.055], 'y', 0.88, 0.013, MAT.steel, { segments: 5, tint: DARK });
  // Багор: древко, остриё и крюк.
  xf.cyl([0.2, by + 0.05, 0.055], 'y', 0.78, 0.016, MAT.paintRed, { segments: 5, caps: false, tint: red });
  xf.cyl([0.2, by + 0.83, 0.055], 'y', 0.13, 0.012, MAT.steel, { segments: 4, radiusEnd: 0.002, tint: GREY });
  xf.box([0.2, by + 0.8, 0.045], [0.27, by + 0.82, 0.065], MAT.steel, { tint: GREY });
  xf.box([0.255, by + 0.74, 0.045], [0.27, by + 0.8, 0.065], MAT.steel, { tint: GREY });
  // Лопата штыком вниз.
  if (gone === 1) xf.box([0.33, by + 0.08, 0.025], [0.5, by + 0.95, 0.027], MAT.paintRed, { tint: dim(red, 1.2) });
  else {
    xf.box([0.4, by + 0.36, 0.045], [0.43, by + 0.92, 0.07], MAT.wood, { tint: [0.85, 0.8, 0.72] });
    xf.box([0.33, by + 0.08, 0.04], [0.5, by + 0.37, 0.052], MAT.steel, { tint: [0.6, 0.6, 0.6] });
    xf.box([0.375, by + 0.92, 0.04], [0.455, by + 0.95, 0.075], MAT.wood, { tint: [0.85, 0.8, 0.72] });
  }
  // Ящик с песком.
  xf.solid([-0.4, 0, 0.03], [0.4, 0.5, 0.53], MAT.paintRed, { bevel: 0.012, tint: dim(red, 0.92), aoBottom: 0.6 });
  xf.box([-0.42, 0.5, 0.02], [0.42, 0.525, 0.55], MAT.paintRed, { tint: dim(red, 0.8) });
  xf.box([-0.03, 0.44, 0.53], [0.03, 0.5, 0.545], MAT.steel, { tint: DARK });
}

/**
 * Абонентский громкоговоритель: бакелитовая коробка 0,2 × 0,25 × 0,1 м с тканевой решёткой и
 * регулятором, шнур к радиорозетке под ней. y = 0 — низ розетки.
 */
export function loudspeaker(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const bk: Vec3 = rnd() < 0.5 ? [1.1, 0.95, 0.85] : [1.05, 1.05, 1.05];
  const y0 = 0.14;
  xf.box([-0.1, y0, 0], [0.1, y0 + 0.25, 0.1], MAT.bakelite, { bevel: 0.015, tint: bk });
  xf.box([-0.075, y0 + 0.07, 0.1], [0.075, y0 + 0.225, 0.103], MAT.canvas, { tint: [0.95, 0.9, 0.75] });
  for (let i = 0; i < 4; i++) xf.box([-0.075, y0 + 0.085 + i * 0.037, 0.103], [0.075, y0 + 0.097 + i * 0.037, 0.108], MAT.bakelite, { tint: bk });
  xf.cyl([0, y0 + 0.035, 0.1], 'z', 0.018, 0.02, MAT.bakelite, { segments: 6, tint: bk });
  xf.cyl([0.06, 0.05, 0.012], 'y', y0 - 0.05, 0.004, MAT.rubber, { segments: 3, caps: false });
  xf.box([0.03, 0, 0], [0.09, 0.06, 0.02], MAT.bakelite, { tint: bk });
}

/**
 * Электросирена на кронштейне: мотор, статор с тёмным поясом прорезей и раструб с чёрным зевом.
 * Ширина 0,6 м, вылет 0,36 м. y = 0 — низ кронштейна.
 */
export function siren(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const paint: Vec3 = dim([0.85, 0.87, 0.85], 0.9 + rnd() * 0.2);
  const s = rnd() < 0.5 ? 1 : -1; // в какую сторону смотрит раструб
  xf.box([-0.12, 0.02, 0], [0.12, 0.3, 0.015], MAT.steel, { tint: DARK });
  xf.box([-0.1, 0.05, 0.015], [0.1, 0.07, 0.3], MAT.steel, { tint: DARK });
  const y = 0.2;
  const z = 0.19;
  // Отрезок вдоль оси сирены от a до b (в сторону раструба — минус) с радиусами на концах.
  const part = (a: number, b: number, ra: number, rb: number, mat: number, tint: Vec3, caps = true): void => {
    const xa = s * a;
    const xb = s * b;
    if (xa < xb) xf.cyl([xa, y, z], 'x', xb - xa, ra, mat, { segments: 10, radiusEnd: rb, tint, caps });
    else xf.cyl([xb, y, z], 'x', xa - xb, rb, mat, { segments: 10, radiusEnd: ra, tint, caps });
  };
  xf.box([s * -0.01, 0.07, z - 0.06], [s * 0.15, y - 0.06, z + 0.06], MAT.metalGrey, { tint: dim(paint, 0.8) });
  part(-0.02, 0.18, 0.085, 0.085, MAT.metalGrey, paint);
  part(-0.14, -0.02, 0.125, 0.125, MAT.metalGrey, dim(paint, 0.9));
  part(-0.125, -0.035, 0.128, 0.128, MAT.rubber, [0.6, 0.6, 0.6], false);
  part(-0.26, -0.14, 0.16, 0.1, MAT.metalGrey, paint);
  part(-0.264, -0.26, 0.145, 0.145, MAT.rubber, [0.5, 0.5, 0.5]);
  xf.box([s * 0.17, y - 0.01, 0.015], [s * 0.19, y + 0.01, z], MAT.rubber);
}

/**
 * Круглые настенные часы Ø 0,3 м: тёмный корпус, пожелтевший циферблат с двенадцатью штрихами,
 * стрелки остановились (время — по сиду). y = 0 — низ корпуса.
 */
export function wallClock(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const c = 0.155;
  xf.cyl([0, c, 0], 'z', 0.05, 0.15, MAT.bakelite, { segments: 14, tint: [1.1, 1.0, 0.9] });
  xf.cyl([0, c, 0.05], 'z', 0.004, 0.128, MAT.paper, { segments: 14, tint: [0.92, 0.9, 0.78] });
  xf.cyl([0, c, 0.044], 'z', 0.018, 0.153, MAT.steel, { segments: 14, caps: false, tint: GREY });
  // Полоска на циферблате: от r0 до r1 вдоль направления ang (по часовой от «12»), полуширина hw.
  const mark = (ang: number, r0: number, r1: number, hw: number, zz: number): void => {
    const dx = Math.sin(ang);
    const dy = Math.cos(ang);
    const p = (r: number, k: number): Vec3 => [dx * r + dy * hw * k, c + dy * r - dx * hw * k, zz];
    sheet(xf, p(r0, -1), p(r0, 1), p(r1, 1), p(r1, -1), [0, 0, 1], MAT.rubber);
  };
  for (let i = 0; i < 12; i++) mark((i / 12) * Math.PI * 2, i % 3 === 0 ? 0.095 : 0.106, 0.12, i % 3 === 0 ? 0.006 : 0.003, 0.0545);
  const minutes = Math.floor(rnd() * 720);
  mark(((minutes / 720) * Math.PI * 2) % (Math.PI * 2), -0.012, 0.07, 0.006, 0.0555);
  mark((((minutes % 60) / 60) * Math.PI * 2) % (Math.PI * 2), -0.018, 0.105, 0.004, 0.0565);
  xf.cyl([0, c, 0.054], 'z', 0.006, 0.01, MAT.steel, { segments: 6, tint: DARK });
}

/**
 * Полевой телефон ТА-57 на полке: бакелитовый корпус с откинутой крышкой (на ней схема), трубка
 * поперёк, ручка индуктора справа, линия уходит вверх по стене, сбоку свисает ремень. y = 0 — низ кронштейнов.
 */
export function fieldPhone(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const bk: Vec3 = dim([1.1, 0.98, 0.85], 0.9 + rnd() * 0.1);
  xf.box([-0.22, 0.1, 0], [0.22, 0.125, 0.26], MAT.wood, { tint: [0.72, 0.68, 0.62] });
  for (const x of [-0.16, 0.16]) xf.box([x - 0.012, 0, 0], [x + 0.012, 0.1, 0.2], MAT.steel, { tint: DARK });
  const y = 0.125;
  xf.box([-0.13, y, 0.05], [0.11, y + 0.09, 0.22], MAT.bakelite, { bevel: 0.012, tint: bk });
  xf.box([-0.13, y + 0.09, 0.035], [0.11, y + 0.25, 0.05], MAT.bakelite, { tint: dim(bk, 0.9) });
  xf.box([-0.09, y + 0.12, 0.05], [0.07, y + 0.22, 0.052], MAT.paper, { tint: [0.85, 0.82, 0.68] });
  // Трубка.
  xf.box([-0.1, y + 0.105, 0.115], [0.08, y + 0.13, 0.15], MAT.bakelite);
  for (const x of [-0.1, 0.08]) xf.cyl([x, y + 0.09, 0.132], 'y', 0.035, 0.03, MAT.bakelite, { segments: 6 });
  beam(xf, [-0.12, y + 0.11, 0.135], [-0.15, y + 0.01, 0.2], 0.008, 0.008, MAT.rubber, WHITE, { caps: false });
  // Индуктор.
  xf.cyl([0.11, y + 0.045, 0.14], 'x', 0.03, 0.012, MAT.steel, { segments: 4, tint: GREY });
  xf.box([0.14, y + 0.035, 0.13], [0.15, y + 0.055, 0.19], MAT.steel, { tint: GREY });
  xf.cyl([0.15, y + 0.045, 0.183], 'x', 0.035, 0.009, MAT.bakelite, { segments: 4 });
  for (const x of [0.02, 0.035]) xf.cyl([x, y + 0.25, 0.01], 'y', 0.07, 0.004, MAT.rubber, { segments: 3, caps: false });
  xf.box([-0.2, 0.0, 0.262], [-0.17, 0.125, 0.268], MAT.canvas, { tint: [0.8, 0.78, 0.65] });
}

/** Стул, упавший на спинку: ножки смотрят в +z и кончаются у z = 0, верх спинки — у z = −0,9; высота 0,4 м. */
function fallenChair(xf: Xf, tint: Vec3): void {
  xf.box([-0.2, 0, -0.47], [0.2, 0.4, -0.43], MAT.wood, { bevel: 0.01, tint, aoBottom: 0.6 });
  for (const x of [-0.19, 0.16]) for (const y of [0.01, 0.36]) xf.box([x, y, -0.43], [x + 0.03, y + 0.03, 0], MAT.steel, { tint: DARK });
  for (const x of [-0.19, 0.16]) xf.box([x, 0, -0.9], [x + 0.03, 0.03, -0.47], MAT.steel, { tint: DARK });
  xf.box([-0.2, 0, -0.88], [0.2, 0.025, -0.68], MAT.wood, { tint });
  xf.collider([-0.2, 0, -0.9], [0.2, 0.4, 0]);
}

/**
 * Письменный стол с пишущей машинкой (в каретке лист), настольной лампой и стопкой папок; рядом
 * вдоль стены лежит опрокинутый стул. Ширина 2,2 м, глубина 0,6 м (стол выступает на 0,63).
 */
export function typewriterDesk(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const dx = -0.47;
  desk(xf.child(dx, 0, 0));
  const ty = 0.76;
  // Машинка: корпус, ступень клавиатуры со светлыми клавишами, валик с листом.
  const tx = dx - 0.1;
  const tz = 0.32;
  xf.box([tx - 0.17, ty, tz - 0.14], [tx + 0.17, ty + 0.09, tz + 0.1], MAT.castIron, { bevel: 0.012, tint: [1.1, 1.1, 1.1] });
  xf.box([tx - 0.15, ty, tz + 0.1], [tx + 0.15, ty + 0.035, tz + 0.17], MAT.castIron, { tint: [1.1, 1.1, 1.1] });
  xf.box([tx - 0.14, ty + 0.035, tz + 0.105], [tx + 0.14, ty + 0.045, tz + 0.16], MAT.enamel, { tint: [0.72, 0.7, 0.62] });
  xf.cyl([tx - 0.21, ty + 0.11, tz - 0.08], 'x', 0.42, 0.022, MAT.rubber, { segments: 6, tint: [1.1, 1.1, 1.1] });
  xf.box([tx - 0.105, ty + 0.1, tz - 0.103], [tx + 0.105, ty + 0.29, tz - 0.098], MAT.paper, { tint: [0.92, 0.9, 0.8] });
  xf.box([tx + 0.21, ty + 0.1, tz - 0.09], [tx + 0.24, ty + 0.12, tz - 0.07], MAT.steel, { tint: GREY });
  // Лампа: блин основания, стойка, плечо и абажур раструбом вниз.
  const lx = dx + 0.43;
  const lz = 0.2;
  xf.cyl([lx, ty, lz], 'y', 0.02, 0.08, MAT.bakelite, { segments: 8, tint: [1.1, 1.1, 1.1] });
  xf.cyl([lx, ty + 0.02, lz], 'y', 0.31, 0.008, MAT.steel, { segments: 4, caps: false, tint: GREY });
  xf.cyl([lx, ty + 0.325, lz], 'z', 0.13, 0.008, MAT.steel, { segments: 4, caps: false, tint: GREY });
  xf.cyl([lx, ty + 0.24, lz + 0.13], 'y', 0.09, 0.095, MAT.metalGreen, { segments: 8, radiusEnd: 0.03, tint: [0.85, 0.95, 0.85] });
  // Папки стопкой.
  for (let i = 0; i < 4; i++) {
    const ox = (rnd() - 0.5) * 0.03;
    const oz = (rnd() - 0.5) * 0.03;
    const g = 0.7 + rnd() * 0.3;
    xf.box([dx - 0.57 + ox, ty + i * 0.022, 0.2 + oz], [dx - 0.36 + ox, ty + i * 0.022 + 0.02, 0.5 + oz], i % 2 ? MAT.paper : MAT.cardboard, { tint: [g, g * 0.95, g * 0.85] });
  }
  fallenChair(xf.child(1.08, 0, 0.36, 1), [0.8, 0.75, 0.7]);
}

/**
 * Керосиновая лампа «летучая мышь» на перевёрнутом ящике: бачок, горелка, закопчённое стекло
 * в проволочной раме, колпак и дужка. Ящик 0,5 × 0,38 × 0,42 м — преграда.
 */
export function keroseneLamp(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([0.85, 0.8, 0.72], 0.85 + rnd() * 0.2);
  xf.solid([-0.25, 0, 0.06], [0.25, 0.42, 0.44], MAT.wood, { bevel: 0.01, tint: wood, aoBottom: 0.55 });
  for (const x of [-0.258, 0.208]) xf.box([x, 0, 0.052], [x + 0.05, 0.428, 0.448], MAT.wood, { tint: dim(wood, 0.78) });
  xf.box([-0.2, 0.2, 0.44], [0.2, 0.212, 0.445], MAT.rubber, { tint: [0.6, 0.6, 0.6] });
  const lx = (rnd() - 0.5) * 0.14;
  const lz = 0.24;
  const y = 0.42;
  const tin: Vec3 = dim([0.6, 0.68, 0.62], 0.9 + rnd() * 0.2);
  xf.cyl([lx, y, lz], 'y', 0.045, 0.065, MAT.zinc, { segments: 8, tint: tin });
  xf.cyl([lx, y + 0.045, lz], 'y', 0.03, 0.03, MAT.brass, { segments: 6, tint: [0.75, 0.7, 0.6] });
  xf.cyl([lx, y + 0.075, lz], 'y', 0.06, 0.03, MAT.glass, { segments: 8, radiusEnd: 0.05, caps: false, tint: [1.1, 1.1, 1.1] });
  xf.cyl([lx, y + 0.135, lz], 'y', 0.07, 0.05, MAT.glass, { segments: 8, radiusEnd: 0.028, caps: false, tint: [1.1, 1.1, 1.1] });
  xf.cyl([lx, y + 0.205, lz], 'y', 0.045, 0.034, MAT.zinc, { segments: 8, tint: tin });
  xf.cyl([lx, y + 0.25, lz], 'y', 0.012, 0.046, MAT.zinc, { segments: 8, tint: dim(tin, 0.85) });
  for (const s of [-1, 1]) {
    xf.box([lx + s * 0.07 - 0.006, y + 0.03, lz - 0.006], [lx + s * 0.07 + 0.006, y + 0.232, lz + 0.006], MAT.zinc, { tint: tin });
    xf.box([lx + s * 0.072 - 0.004, y + 0.232, lz - 0.004], [lx + s * 0.072 + 0.004, y + 0.31, lz + 0.004], MAT.steel, { tint: DARK });
  }
  xf.box([lx - 0.076, y + 0.22, lz - 0.006], [lx + 0.076, y + 0.232, lz + 0.006], MAT.zinc, { tint: tin });
  xf.box([lx - 0.076, y + 0.31, lz - 0.004], [lx + 0.076, y + 0.318, lz + 0.004], MAT.steel, { tint: DARK });
}

/**
 * Посуда на табурете: эмалированный чайник, кружка и миска; вторая кружка упала на пол, рядом
 * алюминиевый бидон с крышкой. Ширина 0,9 м.
 */
export function canteenSet(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const sx = -0.2;
  const sz = 0.28;
  stool(xf.child(sx, 0, sz));
  const y = 0.46;
  const blue = rnd() < 0.5;
  const kt: Vec3 = blue ? [0.5, 0.62, 0.8] : [0.88, 0.86, 0.8];
  const white: Vec3 = [0.9, 0.88, 0.82];
  // Чайник.
  const kx = sx - 0.05;
  const kz = sz - 0.07;
  xf.cyl([kx, y, kz], 'y', 0.12, 0.085, MAT.enamel, { segments: 10, radiusEnd: 0.07, tint: kt });
  xf.cyl([kx, y + 0.12, kz], 'y', 0.012, 0.05, MAT.enamel, { segments: 6, tint: dim(kt, 0.85) });
  xf.box([kx - 0.01, y + 0.132, kz - 0.01], [kx + 0.01, y + 0.15, kz + 0.01], MAT.bakelite);
  beam(xf, [kx + 0.07, y + 0.045, kz], [kx + 0.145, y + 0.115, kz], 0.024, 0.024, MAT.enamel, kt);
  for (const s of [-1, 1]) xf.box([kx + s * 0.062 - 0.004, y + 0.1, kz - 0.006], [kx + s * 0.062 + 0.004, y + 0.2, kz + 0.006], MAT.steel, { tint: DARK });
  xf.box([kx - 0.066, y + 0.2, kz - 0.006], [kx + 0.066, y + 0.208, kz + 0.006], MAT.steel, { tint: DARK });
  // Миска и кружка на табурете, вторая кружка — на полу.
  xf.cyl([sx - 0.08, y, sz + 0.095], 'y', 0.045, 0.045, MAT.enamel, { segments: 8, radiusEnd: 0.072, tint: white });
  xf.cyl([sx - 0.08, y + 0.045, sz + 0.095], 'y', 0.002, 0.062, MAT.enamel, { segments: 8, tint: dim(white, 0.6) });
  xf.cyl([sx + 0.1, y, sz + 0.09], 'y', 0.085, 0.04, MAT.enamel, { segments: 6, tint: blue ? white : [0.55, 0.8, 0.62] });
  xf.box([sx + 0.138, y + 0.02, sz + 0.083], [sx + 0.156, y + 0.07, sz + 0.097], MAT.enamel, { tint: white });
  xf.cyl([sx - 0.1, 0.04, sz + 0.26], 'x', 0.085, 0.04, MAT.enamel, { segments: 6, tint: white });
  // Бидон.
  const bx = 0.27;
  const bz = 0.26;
  const al: Vec3 = dim([0.9, 0.9, 0.88], 0.9 + rnd() * 0.15);
  xf.cyl([bx, 0, bz], 'y', 0.34, 0.13, MAT.zinc, { segments: 10, tint: al, ao: 0.92 });
  xf.cyl([bx, 0.34, bz], 'y', 0.07, 0.13, MAT.zinc, { segments: 10, radiusEnd: 0.075, caps: false, tint: al });
  xf.cyl([bx, 0.41, bz], 'y', 0.05, 0.075, MAT.zinc, { segments: 10, caps: false, tint: al });
  xf.cyl([bx, 0.46, bz], 'y', 0.03, 0.086, MAT.zinc, { segments: 8, tint: dim(al, 0.9) });
  xf.box([bx - 0.03, 0.49, bz - 0.008], [bx + 0.03, 0.505, bz + 0.008], MAT.steel, { tint: DARK });
  for (const s of [-1, 1]) xf.box([bx + s * 0.13, 0.24, bz - 0.03], [bx + s * 0.15, 0.26, bz + 0.03], MAT.steel, { tint: DARK });
  xf.collider([bx - 0.13, 0, bz - 0.13], [bx + 0.13, 0.5, bz + 0.13]);
}

/**
 * Прибор ДП-5 в раскрытом зелёном ящике на табурете: тёмная панель со шкалой, стрелкой и
 * переключателем, зонд свисает на шнуре с края табурета, сбоку ремень.
 */
export function dosimeterCase(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const green: Vec3 = dim([0.95, 1.0, 0.92], 0.85 + rnd() * 0.2);
  stool(xf.child(0, 0, 0.28));
  const y = 0.46;
  xf.box([-0.15, y, 0.19], [0.15, y + 0.12, 0.39], MAT.metalGreen, { bevel: 0.01, tint: green });
  xf.box([-0.15, y + 0.1, 0.165], [0.15, y + 0.3, 0.188], MAT.metalGreen, { tint: dim(green, 0.9) });
  xf.box([-0.135, y + 0.12, 0.2], [0.135, y + 0.125, 0.38], MAT.bakelite, { tint: [1.1, 1.1, 1.1] });
  xf.box([-0.11, y + 0.125, 0.27], [0, y + 0.128, 0.36], MAT.paper, { tint: [0.9, 0.88, 0.75] });
  const needle = -0.095 + rnd() * 0.08;
  xf.box([needle, y + 0.128, 0.28], [needle + 0.004, y + 0.1295, 0.35], MAT.rubber);
  xf.cyl([0.07, y + 0.125, 0.31], 'y', 0.02, 0.028, MAT.bakelite, { segments: 8, tint: [1.1, 1.1, 1.1] });
  xf.box([0.066, y + 0.145, 0.295], [0.074, y + 0.149, 0.335], MAT.enamel, { tint: [0.8, 0.8, 0.75] });
  for (const x of [0.035, 0.105]) xf.cyl([x, y + 0.125, 0.235], 'y', 0.012, 0.012, MAT.steel, { segments: 5, tint: GREY });
  // Шнур и зонд.
  const px = 0.1;
  beam(xf, [px, y + 0.06, 0.39], [px, y + 0.005, 0.46], 0.008, 0.008, MAT.rubber, WHITE, { caps: false });
  xf.cyl([px, 0.32, 0.465], 'y', y - 0.32 + 0.005, 0.004, MAT.rubber, { segments: 3, caps: false });
  xf.cyl([px, 0.1, 0.465], 'y', 0.22, 0.02, MAT.metalGreen, { segments: 6, tint: green });
  xf.cyl([px, 0.12, 0.465], 'y', 0.07, 0.023, MAT.steel, { segments: 6, caps: false, tint: DARK });
  xf.box([-0.172, y - 0.22, 0.27], [-0.156, y + 0.08, 0.31], MAT.canvas, { tint: [0.8, 0.78, 0.65] });
}

/**
 * Медицинская кушетка 1,9 × 0,6 м: рама из белёных труб, ложе в буром кожзаме, изголовье
 * приподнято на подпорке; обивка прорвана до набивки, посередине тёмное пятно.
 */
export function medCouch(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const flip = rnd() < 0.5 ? 1 : -1;
  const paint: Vec3 = dim([0.9, 0.9, 0.86], 0.8 + rnd() * 0.2);
  const lth: Vec3 = dim([1.0, 0.95, 0.9], 0.85 + rnd() * 0.25);
  for (const x of [-0.9, 0.9]) {
    for (const z of [0.05, 0.59]) xf.cyl([x, 0, z], 'y', 0.5, 0.016, MAT.enamel, { segments: 6, tint: paint, ao: 0.9 });
    xf.cyl([x, 0.48, 0.05], 'z', 0.54, 0.016, MAT.enamel, { segments: 6, caps: false, tint: paint });
    xf.cyl([x, 0.15, 0.05], 'z', 0.54, 0.012, MAT.enamel, { segments: 6, caps: false, tint: paint });
  }
  for (const z of [0.05, 0.59]) xf.cyl([-0.9, 0.48, z], 'x', 1.8, 0.016, MAT.enamel, { segments: 6, caps: false, tint: paint });
  xf.box([flip * -0.45, 0.5, 0.02], [flip * 0.95, 0.56, 0.62], MAT.leather, { bevel: 0.02, tint: lth });
  beam(xf, [flip * -0.45, 0.535, 0.32], [flip * -0.93, 0.7, 0.32], 0.6, 0.06, MAT.leather, lth, { side: [0, 0, 1] });
  xf.box([flip * -0.8, 0.5, 0.09], [flip * -0.78, 0.64, 0.55], MAT.steel, { tint: DARK });
  // Прореха с набивкой и пятно.
  xf.box([flip * 0.5, 0.56, 0.2], [flip * 0.68, 0.563, 0.34], MAT.lagging, { tint: [0.9, 0.88, 0.8] });
  sheet(xf, [flip * -0.1, 0.5615, 0.2], [flip * -0.1, 0.5615, 0.5], [flip * 0.3, 0.5615, 0.5], [flip * 0.3, 0.5615, 0.2], [0, 1, 0], MAT.leather, [0.5, 0.42, 0.4]);
  xf.collider([-0.95, 0, 0.02], [0.95, 0.6, 0.62]);
}

// ───────────────────────────── хлам и следы запустения ─────────────────────────────

/**
 * Куча мусора у стены 1,6 × 0,6 м: насыпь из комьев (выше к середине и к стене), 8–12 битых кирпичей
 * вповалку, куски штукатурки, обломки досок (один торчит к стене), опрокинутое ведро.
 * Середина кучи — преграда.
 */
export function debrisHeap(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const cx = (rnd() - 0.5) * 0.3;
  // Комья насыпи: [x0, x1, z0, z1, высота]. Первые привалены к стене, остальные сползли вперёд.
  const lumps: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const w = 0.36 + rnd() * 0.34;
    const d = 0.24 + rnd() * 0.18;
    const xc = i === 0 ? cx : cx + (rnd() - 0.5) * 1.05;
    const x0 = Math.max(-0.78, Math.min(0.78 - w, xc - w / 2));
    const z0 = i < 3 ? 0 : 0.08 + rnd() * 0.16;
    const z1 = Math.min(0.5, z0 + d);
    const k = Math.max(0, 1 - Math.abs(x0 + w / 2 - cx) / 0.75) * (1 - (z0 + z1) / 1.4);
    const h = 0.09 + rnd() * 0.08 + 0.36 * k;
    const g = 0.82 + rnd() * 0.28;
    xf.box([x0, 0, z0], [x0 + w, h, z1], i % 3 === 2 ? MAT.concrete : MAT.dirt, { bevel: 0.04, tint: [g, g * 0.98, g * 0.94], aoBottom: 0.6 });
    lumps.push([x0, x0 + w, z0, z1, h]);
  }
  // Кирпичи: целые и половинки, плашмя и на ребре; каждый четвёртый скатился на пол перед кучей.
  const n = 8 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const onFloor = i % 4 === 3;
    const len = rnd() < 0.4 ? 0.11 + rnd() * 0.08 : 0.25;
    const o = onFloor ? 0 : Math.floor(rnd() * 3);
    const sx = o === 1 ? 0.12 : len;
    const sz = o === 1 ? len : o === 2 ? 0.065 : 0.12;
    const sy = o === 2 ? 0.12 : 0.065;
    const [x0, x1, z0, z1, h] = lumps[Math.floor(rnd() * lumps.length)]!;
    const x = onFloor ? -0.75 + rnd() * (1.5 - sx) : x0 + 0.02 + rnd() * Math.max(0.01, x1 - x0 - sx - 0.04);
    const z = onFloor ? 0.47 + rnd() * 0.04 : Math.max(0.02, z0) + rnd() * Math.max(0.01, z1 - Math.max(0.02, z0) - sz);
    const y = onFloor ? 0 : h - 0.012;
    const g = 0.75 + rnd() * 0.35;
    xf.box([x, y, z], [x + sx, y + sy, z + sz], MAT.brick, { tint: [g, g * 0.95, g * 0.92], aoBottom: 0.7 });
  }
  // Куски штукатурки: на комьях и на полу перед кучей.
  for (let i = 0; i < 5; i++) {
    const s = 0.07 + rnd() * 0.1;
    const sd = Math.min(0.12, s * (0.5 + rnd() * 0.5));
    const g = 0.62 + rnd() * 0.18;
    const [x0, x1, z0, z1, h] = lumps[Math.floor(rnd() * lumps.length)]!;
    const onFloor = i % 2 === 0;
    const x = onFloor ? -0.74 + rnd() * (1.48 - s) : x0 + rnd() * Math.max(0.01, x1 - x0 - s);
    const z = onFloor ? 0.5 + rnd() * (0.12 - sd) : Math.max(0.02, z0) + rnd() * Math.max(0.01, z1 - Math.max(0.02, z0) - sd);
    const y = onFloor ? 0 : h - 0.006;
    xf.box([x, y, z], [x + s, y + 0.02 + rnd() * 0.03, z + sd], MAT.plaster, { tint: [g, g, g * 0.95], aoBottom: 0.7 });
  }
  // Доски: одна лежит поперёк самого высокого кома, одна съехала к полу, одна торчит к стене.
  const [tx0, tx1, tz0, tz1, th] = lumps.reduce((a, b) => (b[4] > a[4] ? b : a));
  const tc = (tx0 + tx1) / 2;
  const tz = (tz0 + tz1) / 2;
  xf.box([Math.max(-0.8, tx0 - 0.16), th - 0.004, tz - 0.02], [Math.min(0.8, tx1 + 0.1), th + 0.022, tz + 0.09], MAT.wood, { tint: [0.75, 0.72, 0.66] });
  beam(xf, [tc + 0.1, 0.012, 0.6], [tc + 0.14, th + 0.03, tz + 0.03], 0.1, 0.024, MAT.wood, [0.82, 0.78, 0.7], { side: [1, 0, 0], aoA: 0.6 });
  beam(xf, [tc - 0.1, th - 0.02, Math.min(0.22, tz1 - 0.04)], [tc - 0.16, 1.0, 0.03], 0.09, 0.022, MAT.wood, [0.7, 0.66, 0.6], { side: [1, 0, 0] });
  // Ведро на боку у края кучи, зевом наружу.
  const out = cx > 0 ? -1 : 1;
  const bx = out * 0.6;
  xf.cyl([bx - 0.135, 0.135, 0.38], 'x', 0.27, out > 0 ? 0.11 : 0.14, MAT.zinc, { segments: 8, radiusEnd: out > 0 ? 0.14 : 0.11, tint: [0.7, 0.68, 0.64] });
  xf.cyl([out > 0 ? bx + 0.135 : bx - 0.139, 0.135, 0.38], 'x', 0.004, 0.125, MAT.rubber, { segments: 8, tint: [0.5, 0.5, 0.5] });
  xf.collider([cx - 0.45, 0, 0], [cx + 0.45, 0.42, 0.4]);
}

/**
 * Аккуратный штабель кирпича 0,8 × 0,5 × 0,5 м (верхний ряд разобран) и рядом носилки-корыто
 * для раствора: дощатый ящик на двух жердях, внутри засохшая корка. Ширина 2,1 м.
 */
export function brickPile(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const bx = -1.03;
  const bz = 0.06;
  xf.solid([bx, 0, bz], [bx + 0.78, 0.4, bz + 0.51], MAT.brick, { tint: [0.92, 0.9, 0.86], aoBottom: 0.6 });
  // Верхние ряды — отдельные кирпичи: ложком вдоль стены, часть уже унесли.
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 3; i++) {
      const g = 0.78 + rnd() * 0.3;
      if (rnd() < 0.25) continue;
      const x = bx + i * 0.265;
      const z = bz + row * 0.13;
      xf.box([x, 0.4, z], [x + 0.25, 0.465, z + 0.12], MAT.brick, { tint: [g, g * 0.95, g * 0.92] });
      if (rnd() < 0.3) xf.box([x + 0.06, 0.465, z], [x + 0.18, 0.53, z + 0.12], MAT.brick, { tint: [g * 0.9, g * 0.88, g * 0.85] });
    }
  }
  // Несколько кирпичей на полу рядом.
  const lx = bx + 0.84;
  const loose: Array<[Vec3, Vec3]> = [
    [
      [lx, 0, 0.08],
      [lx + 0.12, 0.065, 0.33],
    ],
    [
      [lx + 0.03, 0, 0.37],
      [lx + 0.15, 0.065, 0.5],
    ],
    [
      [lx - 0.04, 0.065, 0.14],
      [lx + 0.21, 0.13, 0.26],
    ],
  ];
  for (const [lo, hi] of loose) {
    const g = 0.8 + rnd() * 0.25;
    xf.box(lo, hi, MAT.brick, { tint: [g, g * 0.95, g * 0.92], aoBottom: 0.7 });
  }
  // Носилки-корыто.
  const tx = 0.45;
  const tz = 0.32;
  const wood: Vec3 = dim([0.8, 0.77, 0.72], 0.85 + rnd() * 0.2);
  for (const x of [tx - 0.25, tx + 0.19]) xf.box([x, 0, tz - 0.2], [x + 0.06, 0.06, tz + 0.2], MAT.wood, { tint: dim(wood, 0.8), aoBottom: 0.6 });
  xf.box([tx - 0.3, 0.06, tz - 0.2], [tx + 0.3, 0.08, tz + 0.2], MAT.wood, { tint: wood });
  for (const z of [tz - 0.2, tz + 0.18]) xf.box([tx - 0.3, 0.08, z], [tx + 0.3, 0.24, z + 0.02], MAT.wood, { tint: wood });
  for (const x of [tx - 0.3, tx + 0.28]) xf.box([x, 0.08, tz - 0.18], [x + 0.02, 0.24, tz + 0.18], MAT.wood, { tint: wood });
  xf.box([tx - 0.28, 0.08, tz - 0.18], [tx + 0.28, 0.13 + rnd() * 0.04, tz + 0.18], MAT.concrete, { tint: [0.8, 0.8, 0.77] });
  for (const z of [tz - 0.24, tz + 0.2]) xf.box([tx - 0.6, 0.19, z], [tx + 0.6, 0.23, z + 0.04], MAT.wood, { tint: dim(wood, 0.9) });
}

/**
 * Доски, прислонённые к стене: 5–7 досок по 1,75–2,2 м в два слоя, и рядом на полу поддон
 * 1,0 × 0,55 м с парой недобранных досок. Ширина 2,0 м, глубина 0,6 м.
 */
export function boardStack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const n = 5 + Math.floor(rnd() * 3);
  let x = -0.97;
  for (let i = 0; i < n && x < -0.24; i++) {
    const w = 0.1 + rnd() * 0.06;
    const len = 1.75 + rnd() * 0.45;
    const foot = 0.28 + rnd() * 0.2;
    const t = 0.025 + rnd() * 0.015;
    const layer = i % 2;
    const top = Math.sqrt(len * len - foot * foot);
    const g = 0.65 + rnd() * 0.35;
    beam(xf, [x + w / 2, 0.008, foot + layer * 0.06], [x + w / 2 + (rnd() - 0.5) * 0.05, top, 0.022 + layer * 0.045], w, t, MAT.wood, [g, g * 0.96, g * 0.9], { side: [1, 0, 0], aoA: 0.55 });
    x += w * (0.72 + rnd() * 0.35);
  }
  // Поддон.
  const px = 0.48;
  const wood: Vec3 = dim([0.8, 0.77, 0.7], 0.85 + rnd() * 0.2);
  for (const dx of [-0.48, -0.05, 0.38]) xf.box([px + dx, 0, 0.04], [px + dx + 0.1, 0.1, 0.58], MAT.wood, { tint: dim(wood, 0.8), aoBottom: 0.5 });
  for (let i = 0; i < 4; i++) {
    const g = 0.85 + rnd() * 0.25;
    if (i > 0 && rnd() < 0.2) continue;
    const z = 0.04 + i * 0.14;
    xf.box([px - 0.5, 0.1, z], [px + 0.5, 0.122, z + 0.12], MAT.wood, { tint: dim(wood, g) });
  }
  xf.box([px - 0.42, 0.122, 0.07], [px + 0.46, 0.15, 0.2], MAT.wood, { tint: [0.7, 0.67, 0.6] });
  xf.box([px - 0.3, 0.122, 0.3], [px + 0.5, 0.147, 0.44], MAT.wood, { tint: [0.82, 0.78, 0.7] });
  xf.collider([-0.99, 0, 0], [x + 0.05, 2.15, 0.42]);
}

/**
 * Рассыпанные по полу бумаги на площади 1,4 × 1,0 м: 15–25 листов вразброс (на части — «строки»),
 * две папки с торчащими листами, раскрытый журнал. Лежит посреди пола; не преграда.
 */
export function papers(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Прямоугольник на полу: центр, поворот, полуразмеры, высота.
  const flat = (cx: number, cz: number, a: number, hu: number, hv: number, y: number, mat: number, tint: Vec3): void => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const p = (u: number, v: number): Vec3 => [cx + u * c - v * s, y, cz + u * s + v * c];
    sheet(xf, p(-hu, -hv), p(-hu, hv), p(hu, hv), p(hu, -hv), [0, 1, 0], mat, tint);
  };
  // Ряд тёмных «строк» на листе с центром (cx, cz) и поворотом a.
  const lines = (cx: number, cz: number, a: number, y: number, count: number): void => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let k = 0; k < count; k++) {
      const v = -0.1 + k * 0.042;
      const hu = 0.035 + rnd() * 0.04;
      const u = -0.08 + hu;
      flat(cx + u * c - v * s, cz + u * s + v * c, a, hu, 0.006, y, MAT.rubber, [1.1, 1.1, 1.1]);
    }
  };
  const n = 15 + Math.floor(rnd() * 11);
  for (let i = 0; i < n; i++) {
    // Половина листов легла кучно, половина разлетелась по всей площади.
    const wide = i % 2 === 0;
    const cx = wide ? (rnd() - 0.5) * 1.02 : (rnd() + rnd() - 1) * 0.4;
    const cz = wide ? (rnd() - 0.5) * 0.62 : (rnd() + rnd() - 1) * 0.26;
    const a = rnd() * Math.PI;
    const y = 0.002 + i * 0.00016;
    const g = 0.72 + rnd() * 0.33;
    flat(cx, cz, a, 0.105, 0.1485, y, MAT.paper, [g, g * (0.94 + rnd() * 0.06), g * (0.8 + rnd() * 0.12)]);
    if (i % 3 === 2) lines(cx, cz, a, y + 0.00008, 5);
  }
  // Папки: картонная корочка на полу и лист, вылезший из-под неё.
  for (let k = 0; k < 2; k++) {
    const cx = (k === 0 ? -0.4 : 0.36) + (rnd() - 0.5) * 0.1;
    const cz = (k === 0 ? 0.22 : -0.24) + (rnd() - 0.5) * 0.08;
    const a = rnd() * Math.PI;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const g = 0.7 + rnd() * 0.3;
    flat(cx + 0.05 * c, cz + 0.05 * s, a + 0.2, 0.105, 0.1485, 0.0068, MAT.paper, [0.9, 0.88, 0.76]);
    beam(xf, [cx - 0.16 * s, 0.016, cz + 0.16 * c], [cx + 0.16 * s, 0.016, cz - 0.16 * c], 0.23, 0.018, MAT.cardboard, [g, g * 0.92, g * 0.8]);
  }
  // Раскрытый журнал: обложка и два блока страниц.
  const jx = 0.05 + (rnd() - 0.5) * 0.2;
  const jz = 0.05 + (rnd() - 0.5) * 0.15;
  const ja = (rnd() - 0.5) * 1.2;
  const jc = Math.cos(ja);
  const js = Math.sin(ja);
  const along = (u: number, v: number, y: number): Vec3 => [jx + u * jc - v * js, y, jz + u * js + v * jc];
  beam(xf, along(0, -0.15, 0.011), along(0, 0.15, 0.011), 0.44, 0.006, MAT.leather, [0.9, 0.85, 0.8]);
  for (const sd of [-1, 1]) {
    beam(xf, along(sd * 0.105, -0.14, 0.021), along(sd * 0.105, 0.14, 0.021), 0.2, 0.014, MAT.paper, [0.9, 0.88, 0.78]);
    for (let k = 0; k < 5; k++) {
      const v = -0.1 + k * 0.045;
      const p = along(sd * 0.105, v, 0);
      flat(p[0], p[2], ja, 0.07, 0.005, 0.0283, MAT.rubber, [1.1, 1.1, 1.2]);
    }
  }
}

/**
 * Стеклянные бутылки и консервные банки у стены, 6–10 штук: часть стоит, часть лежит; вокруг
 * осколки. Полоса 0,9 × 0,45 м; не преграда.
 */
export function bottles(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const placed: Array<[number, number, number]> = [];
  const n = 6 + Math.floor(rnd() * 5);
  const glassTints: Vec3[] = [
    [0.9, 1.1, 0.9],
    [1.1, 0.85, 0.55],
    [1.0, 1.05, 1.1],
  ];
  for (let i = 0; i < n; i++) {
    const kind = rnd();
    const tint = glassTints[Math.floor(rnd() * 3)]!;
    if (kind < 0.36) {
      // Бутылка стоит: тулово, плечи, горлышко.
      const [x, z] = scatterSpot(rnd, placed, 0.045, -0.38, 0.38, 0.07, 0.36);
      xf.cyl([x, 0, z], 'y', 0.17, 0.034, MAT.glass, { segments: 6, caps: false, tint, ao: 0.9 });
      xf.cyl([x, 0.17, z], 'y', 0.05, 0.034, MAT.glass, { segments: 6, caps: false, radiusEnd: 0.013, tint });
      xf.cyl([x, 0.22, z], 'y', 0.055, 0.013, MAT.glass, { segments: 5, tint });
    } else if (kind < 0.68) {
      // Бутылка лежит.
      const along = rnd() < 0.6;
      const [x, z] = scatterSpot(rnd, placed, 0.14, along ? -0.28 : -0.38, along ? 0.14 : 0.38, along ? 0.07 : 0.07, along ? 0.36 : 0.12);
      const ax: Axis = along ? 'x' : 'z';
      const at = (t: number): Vec3 => (along ? [x + t, 0.034, z] : [x, 0.034, z + t]);
      xf.cyl(at(0), ax, 0.17, 0.034, MAT.glass, { segments: 6, tint });
      xf.cyl(at(0.17), ax, 0.05, 0.034, MAT.glass, { segments: 6, caps: false, radiusEnd: 0.013, tint });
      xf.cyl(at(0.22), ax, 0.055, 0.013, MAT.glass, { segments: 5, tint });
    } else {
      // Консервная банка: стоит или лежит, ржавая.
      const [x, z] = scatterSpot(rnd, placed, 0.06, -0.38, 0.34, 0.08, 0.36);
      const r = 0.037 + rnd() * 0.013;
      const h = 0.07 + rnd() * 0.05;
      const g = 0.8 + rnd() * 0.3;
      const mat = rnd() < 0.5 ? MAT.rust : MAT.zinc;
      if (rnd() < 0.6) xf.cyl([x, 0, z], 'y', h, r, mat, { segments: 6, tint: [g, g, g], ao: 0.9 });
      else xf.cyl([x, r, z], 'x', h, r, mat, { segments: 6, tint: [g, g, g] });
    }
  }
  // Осколки.
  for (let i = 0; i < 6; i++) {
    const x = -0.4 + rnd() * 0.8;
    const z = 0.1 + rnd() * 0.3;
    const a = rnd() * Math.PI;
    const s = 0.012 + rnd() * 0.02;
    const c = Math.cos(a) * s;
    const d = Math.sin(a) * s;
    sheet(xf, [x - c, 0.003, z - d], [x + d, 0.003, z - c], [x + c * 1.6, 0.003, z + d], [x - d, 0.003, z + c * 0.7], [0, 1, 0], MAT.glass, [1.1, 1.1, 1.1]);
  }
}

/**
 * Канистра 20 л, 0,35 × 0,47 × 0,17 м: тулово с выштамповкой крестом, три ручки, горловина.
 * Начало — середина дна; lying — лежит на широком боку, горловиной к +z.
 */
function jerrycan(xf: Xf, tint: Vec3, lying: boolean): void {
  // Точка канистры: u — по ширине, v — по высоте, w — по толщине.
  const P = (u: number, v: number, w: number): Vec3 => (lying ? [u, w + 0.085, v - 0.235] : [u, v, w]);
  xf.box(P(-0.175, 0, -0.085), P(0.175, 0.4, 0.085), MAT.metalGreen, { bevel: 0.02, tint, aoBottom: lying ? 0.8 : 0.65 });
  xf.box(P(-0.175, 0.4, -0.085), P(0.07, 0.44, 0.085), MAT.metalGreen, { tint: dim(tint, 0.92) });
  xf.box(P(-0.15, 0.44, -0.06), P(0.04, 0.468, 0.06), MAT.metalGreen, { tint: dim(tint, 0.8) });
  xf.cyl(P(0.12, 0.4, 0), lying ? 'z' : 'y', 0.06, 0.034, MAT.metalGreen, { segments: 6, tint: dim(tint, 0.85) });
  // Крест жёсткости на видимой стенке.
  const [bw, bt] = lying ? [0.022, 0.008] : [0.008, 0.022];
  beam(xf, P(-0.12, 0.07, 0.087), P(0.12, 0.33, 0.087), bw, bt, MAT.metalGreen, dim(tint, 0.85), { caps: false });
  beam(xf, P(-0.12, 0.33, 0.087), P(0.12, 0.07, 0.087), bw, bt, MAT.metalGreen, dim(tint, 0.85), { caps: false });
}

/**
 * Три канистры по 20 л — две стоят, одна на боку в масляной лужице — и жестяная воронка.
 * Ширина 1,1 м; стоящие канистры — преграда.
 */
export function canisters(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const tints: Vec3[] = [0, 1, 2].map(() => {
    const g = 0.85 + rnd() * 0.25;
    return rnd() < 0.3 ? [g * 0.95, g * 0.85, g * 0.75] : [g * 0.95, g, g * 0.92];
  });
  const m = rnd() < 0.5 ? 1 : -1;
  jerrycan(xf.child(m * -0.32, 0, 0.13), tints[0]!, false);
  jerrycan(xf.child(m * 0.0, 0, 0.21, 1), tints[1]!, false);
  sheet(xf, [m * 0.2, 0.003, 0.1], [m * 0.2, 0.003, 0.56], [m * 0.57, 0.003, 0.56], [m * 0.57, 0.003, 0.1], [0, 1, 0], MAT.wetConcrete, [0.4, 0.37, 0.34]);
  jerrycan(xf.child(m * 0.37, 0, 0.275), tints[2]!, true);
  // Воронка раструбом вниз.
  const fx = m * -0.14;
  xf.cyl([fx, 0, 0.46], 'y', 0.09, 0.09, MAT.zinc, { segments: 8, radiusEnd: 0.014, caps: false, tint: [0.8, 0.8, 0.78] });
  xf.cyl([fx, 0.09, 0.46], 'y', 0.08, 0.014, MAT.zinc, { segments: 5, tint: [0.8, 0.8, 0.78] });
  xf.collider([Math.min(m * -0.495, m * 0.085), 0, 0.035], [Math.max(m * -0.495, m * 0.085), 0.47, 0.385]);
}

/** Бочка 200 л, Ø 0,58 × 0,88 м: тулово, два зига и пробка на торце. base — центр нижнего по оси торца. */
function drum(xf: Xf, base: Vec3, axis: Axis, mat: number, tint: Vec3): void {
  const r = 0.29;
  const [a, u, v] = planeOf(axis);
  const at = (t: number, du = 0, dv = 0): Vec3 => {
    const p: Vec3 = [base[0], base[1], base[2]];
    p[a] = p[a]! + t;
    p[u] = p[u]! + du;
    p[v] = p[v]! + dv;
    return p;
  };
  xf.cyl(base, axis, 0.88, r, mat, { tint, segments: 12, ao: 0.92 });
  for (const t of [0.28, 0.575]) xf.cyl(at(t), axis, 0.025, r + 0.012, mat, { tint: dim(tint, 0.82), segments: 12, caps: false });
  xf.cyl(at(0.88, 0.12, 0.1), axis, 0.018, 0.035, MAT.steel, { segments: 6, tint: GREY });
}

/**
 * Три бочки по 200 л: две стоят рядом, третья лежит на них поперёк на деревянных клиньях; ржавые,
 * одна зелёная, под ними масляное пятно. 1,25 × 0,6 × 1,5 м.
 */
export function barrelStack(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const green = Math.floor(rnd() * 3);
  const look = (i: number): [number, Vec3] => {
    const g = 0.8 + rnd() * 0.3;
    return i === green ? [MAT.metalGreen, [g, g * 1.05, g]] : [MAT.rust, [g, g * 0.95, g * 0.9]];
  };
  const z = 0.305;
  sheet(xf, [-0.5, 0.003, 0.16], [-0.5, 0.003, 0.6], [0.35, 0.003, 0.6], [0.35, 0.003, 0.16], [0, 1, 0], MAT.wetConcrete, [0.42, 0.4, 0.37]);
  for (let i = 0; i < 2; i++) {
    const [mat, tint] = look(i);
    drum(xf, [i === 0 ? -0.3 : 0.3, 0, z], 'y', mat, tint);
  }
  const [mat, tint] = look(2);
  drum(xf, [-0.44, 0.88 + 0.302, z], 'x', mat, tint);
  xf.box([0.16, 0.88, z - 0.25], [0.44, 0.975, z - 0.17], MAT.wood, { tint: [0.75, 0.72, 0.66] });
  xf.box([-0.44, 0.88, z + 0.17], [-0.16, 0.975, z + 0.25], MAT.wood, { tint: [0.75, 0.72, 0.66] });
  xf.collider([-0.6, 0, 0.01], [0.6, 1.47, 0.6]);
}

/**
 * Провисшие с потолка кабели: 3–4 петли между скобами, свисают на 0,5–1,0 м; один кабель оборван —
 * концы висят порознь, жилы торчат. Полоса 2,0 × 0,8 м под потолком; y = 0 — потолок.
 */
export function hangingCables(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const loops = 3 + Math.floor(rnd() * 2);
  const torn = Math.floor(rnd() * loops);
  for (let i = 0; i < loops; i++) {
    const x0 = -0.95 + rnd() * 0.45;
    const x1 = 0.5 + rnd() * 0.45;
    const z0 = 0.1 + rnd() * 0.6;
    const z1 = 0.1 + rnd() * 0.6;
    const sag = 0.5 + rnd() * 0.48;
    const r = 0.011 + rnd() * 0.011;
    const g = 0.8 + rnd() * 0.3;
    const tint: Vec3 = [g, g, g];
    for (const [x, z] of [
      [x0, z0],
      [x1, z1],
    ] as const) {
      xf.box([x - 0.02, -0.014, z - 0.02], [x + 0.02, 0, z + 0.02], MAT.steel, { tint: DARK });
    }
    if (i === torn) {
      // Два обрывка: длинный и короткий, каждый висит под своей скобой и чуть отведён к середине.
      const l0 = 0.55 + rnd() * 0.4;
      const l1 = 0.2 + rnd() * 0.25;
      for (const [x, z, l, dir] of [
        [x0, z0, l0, 1],
        [x1, z1, l1, -1],
      ] as const) {
        const mid: Vec3 = [x + dir * 0.05, -l * 0.5, z];
        const end: Vec3 = [x + dir * 0.07, -l, z];
        beam(xf, [x, -0.01, z], mid, r * 2, r * 2, MAT.rubber, tint, { caps: false });
        beam(xf, mid, end, r * 2, r * 2, MAT.rubber, tint);
        beam(xf, end, [end[0] + dir * 0.006, end[1] - 0.035, end[2]], r, r, MAT.brass, [0.8, 0.7, 0.6]);
      }
      continue;
    }
    const N = 8;
    const pt = (t: number): Vec3 => [x0 + (x1 - x0) * t, -0.01 - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t];
    for (let k = 0; k < N; k++) beam(xf, pt(k / N), pt((k + 1) / N), r * 2, r * 2, MAT.rubber, tint, { caps: false });
  }
}

/**
 * Люминесцентный светильник 1,25 м на двух цепях: одна цепь оборвана, корпус повис наискось на
 * второй и на проводе, одна лампа выпала; на пустом крюке качается обрывок цепи. y = 0 — потолок.
 */
export function brokenLamp(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const f = rnd() < 0.5 ? 1 : -1;
  const z = 0.17;
  const paint: Vec3 = dim([0.85, 0.85, 0.8], 0.85 + rnd() * 0.2);
  for (const x of [-0.45, 0.45]) xf.box([f * x - 0.02, -0.015, z - 0.02], [f * x + 0.02, 0, z + 0.02], MAT.steel, { tint: DARK });
  const drop = 0.24 + rnd() * 0.08;
  const fall = 0.45 + rnd() * 0.1;
  xf.cyl([f * -0.45, -drop, z], 'y', drop - 0.015, 0.005, MAT.steel, { segments: 3, caps: false, tint: GREY });
  // Корпус: от уцелевшей цепи наискось вниз.
  const a: Vec3 = [f * -0.5, -drop - 0.03, z];
  const b: Vec3 = [f * (-0.5 + Math.sqrt(1.25 * 1.25 - fall * fall)), -drop - 0.03 - fall, z];
  const d = vnorm(vsub(b, a));
  const nn: Vec3 = [d[1] * f, -d[0] * f, 0]; // вниз от корпуса
  const on = (t: number, off: number, dz: number): Vec3 => [a[0] + (b[0] - a[0]) * t + nn[0] * off, a[1] + (b[1] - a[1]) * t + nn[1] * off, z + dz];
  beam(xf, a, b, 0.16, 0.06, MAT.metalGrey, paint);
  beam(xf, on(0.04, 0.04, 0), on(0.96, 0.04, 0), 0.2, 0.012, MAT.enamel, [0.8, 0.8, 0.74], { caps: false });
  // Одна лампа на месте, от второй остались патроны.
  beam(xf, on(0.06, 0.066, -0.045), on(0.94, 0.066, -0.045), 0.03, 0.03, MAT.enamel, [0.92, 0.92, 0.88]);
  for (const t of [0.045, 0.955]) {
    for (const dz of [-0.045, 0.045]) beam(xf, on(t - 0.015, 0.062, dz), on(t + 0.015, 0.062, dz), 0.04, 0.04, MAT.bakelite, [1.1, 1.1, 1.1]);
  }
  // Обрывки цепи: на крюке и на упавшем конце корпуса.
  xf.cyl([f * 0.45, -0.13, z], 'y', 0.115, 0.005, MAT.steel, { segments: 3, caps: false, tint: GREY });
  xf.cyl([b[0], b[1] - 0.13, z], 'y', 0.13, 0.005, MAT.steel, { segments: 3, caps: false, tint: GREY });
  // Провод от потолочной розетки к корпусу.
  const rose: Vec3 = [f * -0.1, -0.03, z + 0.05];
  xf.cyl([rose[0], -0.03, rose[2]], 'y', 0.03, 0.035, MAT.bakelite, { segments: 6, tint: [1.1, 1.1, 1.1] });
  const mid: Vec3 = [f * -0.16, -drop - 0.12, z + 0.03];
  beam(xf, rose, mid, 0.012, 0.012, MAT.rubber, WHITE, { caps: false });
  beam(xf, mid, on(0.3, -0.03, 0), 0.012, 0.012, MAT.rubber, WHITE, { caps: false });
}

/**
 * Натёки на потолке вдоль шва плит: пятно сырости, известковая корка и 10–16 тонких сосулек
 * длиной 5–30 см, желтоватых от ржавчины. Полоса 1,4 × 0,6 м; y = 0 — потолок.
 */
export function stalactites(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const lime: Vec3 = [0.84, 0.76, 0.6];
  const zs = 0.26 + rnd() * 0.08;
  // Пятно сырости: лоскуты вразнобой — там, где побелка отошла до бетона.
  for (let k = 0; k < 7; k++) {
    const cx = -0.45 + (k / 6) * 0.9 + (rnd() - 0.5) * 0.1;
    const cz = zs + (rnd() - 0.5) * 0.14;
    const a = rnd() * Math.PI;
    const hu = 0.09 + rnd() * 0.09;
    const hv = 0.05 + rnd() * 0.07;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const g = 0.78 + rnd() * 0.2;
    const y = -0.0015 - k * 0.0002;
    const p = (u: number, v: number): Vec3 => [cx + u * c - v * sn, y, Math.max(0.01, cz + u * sn + v * c)];
    sheet(xf, p(-hu, -hv), p(-hu, hv), p(hu, hv), p(hu, -hv), [0, -1, 0], MAT.concrete, [g, g, g * 0.95]);
  }
  for (let k = 0; k < 4; k++) {
    const x = -0.62 + k * 0.3 + rnd() * 0.08;
    const w = 0.14 + rnd() * 0.2;
    const dz = 0.03 + rnd() * 0.05;
    xf.box([x, -0.008 - rnd() * 0.012, zs - dz], [Math.min(0.68, x + w), 0, zs + dz], MAT.plaster, { tint: dim(lime, 0.9 + rnd() * 0.15) });
  }
  const n = 10 + Math.floor(rnd() * 7);
  for (let i = 0; i < n; i++) {
    const x = -0.62 + rnd() * 1.24;
    const z = zs + (rnd() - 0.5) * 0.14;
    const len = 0.05 + rnd() * rnd() * 0.25;
    const r = 0.01 + len * 0.085 + rnd() * 0.006;
    xf.cyl([x, -len, z], 'y', len, 0.002, MAT.plaster, { segments: 5, caps: false, radiusEnd: r, tint: dim(lime, 0.85 + rnd() * 0.2) });
  }
}

/**
 * Деревянная лестница 2,4 м, приставленная к стене: две тетивы и восемь круглых перекладин,
 * одной может не хватать. Ширина 0,55 м, низ отставлен от стены на 0,45–0,5 м.
 */
export function ladderLean(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const foot = 0.42 + rnd() * 0.08;
  const top = Math.sqrt(2.4 * 2.4 - foot * foot);
  const wood: Vec3 = dim([0.85, 0.8, 0.72], 0.85 + rnd() * 0.2);
  for (const x of [-0.22, 0.22]) beam(xf, [x, 0.01, 0.04 + foot], [x, top, 0.04], 0.035, 0.07, MAT.wood, wood, { side: [1, 0, 0], aoA: 0.55 });
  const lost = rnd() < 0.5 ? 1 + Math.floor(rnd() * 6) : -1;
  for (let k = 0; k < 8; k++) {
    if (k === lost) continue;
    const t = 0.1 + k * 0.108;
    xf.cyl([-0.22, t * top, 0.04 + foot * (1 - t)], 'x', 0.44, 0.015, MAT.wood, { segments: 6, caps: false, tint: dim(wood, 0.9) });
  }
  xf.collider([-0.25, 0, 0], [0.25, top, foot + 0.08]);
}

/**
 * Опрокинутый набок стол 1,2 × 0,6 м (столешница стоймя, ножки торчат в комнату) и два стула:
 * один стоит, другой лежит на спинке. Ширина 2,2 м, глубина 0,9 м.
 */
export function overturnedTable(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const wood: Vec3 = dim([0.88, 0.83, 0.78], 0.85 + rnd() * 0.2);
  const m = rnd() < 0.5 ? 1 : -1;
  const tz = 0.1;
  xf.box([-0.6, 0, tz], [0.6, 0.6, tz + 0.04], MAT.wood, { bevel: 0.01, tint: wood, aoBottom: 0.6 });
  for (const x of [-0.56, 0.52]) for (const y of [0.04, 0.52]) xf.box([x, y, tz + 0.04], [x + 0.04, y + 0.04, tz + 0.76], MAT.steel, { tint: DARK });
  for (const y of [0.04, 0.52]) xf.box([-0.52, y, tz + 0.04], [0.52, y + 0.04, tz + 0.14], MAT.steel, { tint: DARK });
  xf.collider([-0.6, 0, tz], [0.6, 0.6, tz + 0.76]);
  chair(xf.child(m * 0.9, 0, 0.32, rnd() < 0.5 ? 0 : 1));
  fallenChair(xf.child(m * -0.9, 0, 0, 2), [0.8, 0.75, 0.7]);
}

/**
 * Пара кирзовых сапог (один стоит, другой завалился), каска, сумка противогаза у стены
 * и портянка на полу. Полоса 0,95 × 0,45 м; не преграда.
 */
export function bootsHelmet(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const m = rnd() < 0.5 ? 1 : -1;
  const kirza: Vec3 = dim([0.5, 0.55, 0.6], 0.9 + rnd() * 0.2);
  // Сапог стоит: головка, голенище с раструбом.
  const bx = m * -0.32;
  xf.box([bx - 0.055, 0, 0.075], [bx + 0.055, 0.018, 0.355], MAT.rubber, { tint: [1.1, 1.1, 1.1] });
  xf.box([bx - 0.05, 0.018, 0.08], [bx + 0.05, 0.1, 0.35], MAT.leather, { bevel: 0.02, tint: kirza, aoBottom: 0.6 });
  xf.cyl([bx, 0.08, 0.14], 'y', 0.3, 0.052, MAT.leather, { segments: 8, radiusEnd: 0.064, tint: kirza });
  xf.cyl([bx, 0.38, 0.14], 'y', 0.003, 0.054, MAT.rubber, { segments: 8, tint: [0.5, 0.5, 0.5] });
  // Сапог лежит на боку, голенищем вдоль стены.
  const fx = m * -0.2;
  xf.box([fx - 0.05, 0, 0.1], [fx + 0.05, 0.105, 0.37], MAT.leather, { bevel: 0.02, tint: dim(kirza, 0.92), aoBottom: 0.6 });
  xf.box([fx - m * 0.05, 0, 0.095], [fx - m * 0.068, 0.11, 0.375], MAT.rubber, { tint: [1.1, 1.1, 1.1] });
  if (m > 0) xf.cyl([fx + 0.03, 0.062, 0.16], 'x', 0.3, 0.052, MAT.leather, { segments: 8, radiusEnd: 0.064, tint: dim(kirza, 0.92) });
  else xf.cyl([fx - 0.33, 0.062, 0.16], 'x', 0.3, 0.064, MAT.leather, { segments: 8, radiusEnd: 0.052, tint: dim(kirza, 0.92) });
  xf.box([m * -0.45, 0, 0.3], [m * -0.27, 0.012, 0.43], MAT.canvas, { tint: [0.9, 0.88, 0.8] });
  // Каска.
  const hx = m * 0.22;
  const hz = 0.3;
  const steel: Vec3 = dim([0.95, 1.0, 0.92], 0.85 + rnd() * 0.2);
  xf.cyl([hx, 0, hz], 'y', 0.035, 0.135, MAT.metalGreen, { segments: 10, radiusEnd: 0.13, caps: false, tint: steel });
  xf.cyl([hx, 0.035, hz], 'y', 0.06, 0.13, MAT.metalGreen, { segments: 10, radiusEnd: 0.1, caps: false, tint: steel });
  xf.cyl([hx, 0.095, hz], 'y', 0.035, 0.1, MAT.metalGreen, { segments: 10, radiusEnd: 0.045, tint: steel });
  // Сумка противогаза привалена к стене, лямка тянется по полу.
  const gx = m * 0.34;
  xf.box([gx - 0.12, 0, 0.02], [gx + 0.12, 0.28, 0.12], MAT.canvas, { bevel: 0.025, tint: [0.85, 0.85, 0.7], aoBottom: 0.65 });
  xf.box([gx - 0.12, 0.17, 0.12], [gx + 0.12, 0.28, 0.128], MAT.canvas, { tint: [0.7, 0.7, 0.6] });
  xf.box([gx - m * 0.3, 0, 0.1], [gx - m * 0.1, 0.006, 0.125], MAT.canvas, { tint: [0.75, 0.75, 0.62] });
}

/**
 * Поддон 0,7 × 0,45 м с чёрной масляной лужей, потёк через край на пол, рядом комья ветоши,
 * маслёнка с длинным носиком и гаечный ключ. Полоса 1,2 × 0,6 м; не преграда.
 */
export function oilTray(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const m = rnd() < 0.5 ? 1 : -1;
  const tx = m * -0.22;
  const tz = 0.3;
  const oil: Vec3 = [0.36, 0.33, 0.3];
  xf.box([tx - 0.35, 0, tz - 0.225], [tx + 0.35, 0.012, tz + 0.225], MAT.steel, { tint: DARK });
  for (const z of [tz - 0.225, tz + 0.21]) xf.box([tx - 0.35, 0.012, z], [tx + 0.35, 0.07, z + 0.015], MAT.steel, { tint: DARK });
  for (const x of [tx - 0.35, tx + 0.335]) xf.box([x, 0.012, tz - 0.21], [x + 0.015, 0.07, tz + 0.21], MAT.steel, { tint: DARK });
  sheet(xf, [tx - 0.335, 0.05, tz - 0.21], [tx - 0.335, 0.05, tz + 0.21], [tx + 0.335, 0.05, tz + 0.21], [tx + 0.335, 0.05, tz - 0.21], [0, 1, 0], MAT.bakelite, [1.1, 1.05, 1.0]);
  // Потёк на пол: два пятна внахлёст.
  const X = (dx: number): number => tx + m * (0.3 + dx);
  sheet(xf, [X(-0.12), 0.003, tz + 0.16], [X(-0.16), 0.003, tz + 0.29], [X(0.2), 0.003, tz + 0.3], [X(0.25), 0.003, tz + 0.14], [0, 1, 0], MAT.wetConcrete, oil);
  sheet(xf, [X(0.1), 0.0034, tz + 0.02], [X(0.05), 0.0034, tz + 0.22], [X(0.42), 0.0034, tz + 0.2], [X(0.36), 0.0034, tz + 0.04], [0, 1, 0], MAT.wetConcrete, oil);
  // Ветошь.
  const rx = m * 0.36;
  xf.box([rx - 0.12, 0, 0.1], [rx + 0.1, 0.05, 0.27], MAT.canvas, { bevel: 0.02, tint: [0.62, 0.56, 0.5], aoBottom: 0.7 });
  xf.box([rx - 0.04, 0, 0.22], [rx + 0.16, 0.03, 0.36], MAT.canvas, { bevel: 0.012, tint: [0.78, 0.72, 0.64], aoBottom: 0.7 });
  // Маслёнка.
  const ox = m * 0.47;
  const oz = 0.47;
  const tin: Vec3 = dim([0.75, 0.72, 0.66], 0.9 + rnd() * 0.2);
  xf.cyl([ox, 0, oz], 'y', 0.07, 0.045, MAT.zinc, { segments: 8, tint: tin });
  xf.cyl([ox, 0.07, oz], 'y', 0.035, 0.045, MAT.zinc, { segments: 8, radiusEnd: 0.012, caps: false, tint: tin });
  beam(xf, [ox, 0.1, oz], [ox - m * 0.15, 0.19, oz], 0.012, 0.012, MAT.zinc, tin);
  xf.box([ox + m * 0.03, 0.062, oz - 0.008], [ox + m * 0.085, 0.072, oz + 0.008], MAT.steel, { tint: GREY });
  // Гаечный ключ в пятне.
  xf.box([X(0.1), 0.0034, tz + 0.1], [X(0.32), 0.012, tz + 0.125], MAT.steel, { tint: GREY });
  xf.box([X(0.3), 0.0034, tz + 0.085], [X(0.35), 0.012, tz + 0.14], MAT.steel, { tint: GREY });
}

export const PROPS: Record<string, PropSpec> = {
  coaming: { w: 1.1, d: 0.16, h: 0.18, mount: 'free', ru: 'порог-комингс', build: (xf) => coaming(xf) },
  blast_door: { w: 1.3, d: 1.3, h: 2.1, mount: 'floor', ru: 'защитно-герметическая дверь, распахнута', build: blastDoor },
  grated_door: { w: 1.1, d: 1.0, h: 2.05, mount: 'floor', ru: 'решётчатая дверь, распахнута', build: gratedDoor },
  mesh_partition: { w: 2.4, d: 1.0, h: 2.2, mount: 'floor', ru: 'сетчатая клетка склада с калиткой', build: meshPartition },
  filter_stack: { w: 0.95, d: 0.6, h: 2.0, mount: 'floor', ru: 'колонка фильтров-поглотителей ФП-300', build: filterStack },
  hand_fan: { w: 0.9, d: 0.6, h: 1.55, mount: 'floor', ru: 'электроручной вентилятор ЭРВ-72', build: handFan },
  duct_run: { w: 2.4, d: 0.42, h: 0.52, mount: 'ceiling', ru: 'круглый воздуховод под потолком', build: ductRun },
  hermo_valve: { w: 0.9, d: 0.55, h: 0.48, mount: 'wall', y: 1.6, ru: 'герметический клапан на воздуховоде', build: hermoValve },
  blast_valve: { w: 0.75, d: 0.28, h: 0.68, mount: 'wall', y: 1.3, ru: 'противовзрывное устройство', build: blastValve },
  u_gauge: { w: 0.25, d: 0.05, h: 0.5, mount: 'wall', y: 1.3, ru: 'тягонапоромер', build: uGauge },
  knife_switch: { w: 0.45, d: 0.18, h: 0.75, mount: 'wall', y: 1.2, ru: 'рубильник в ящике', build: knifeSwitch },
  fuse_board: { w: 0.5, d: 0.1, h: 0.75, mount: 'wall', y: 1.3, ru: 'щиток с предохранителями-пробками', build: fuseBoard },
  cable_tray: { w: 2.4, d: 0.42, h: 0.9, mount: 'ceiling', ru: 'кабельный лоток с оборванным кабелем', build: cableTray },
  battery_rack: { w: 1.4, d: 0.45, h: 1.2, mount: 'floor', ru: 'стеллаж аккумуляторов', build: batteryRack },
  transformer: { w: 0.7, d: 0.5, h: 1.0, mount: 'floor', ru: 'трансформатор', build: transformer },
  air_cylinders: { w: 0.8, d: 0.3, h: 1.4, mount: 'floor', ru: 'баллоны в стойке', build: airCylinders },
  squat_toilet: { w: 1.0, d: 1.2, h: 2.15, mount: 'floor', ru: 'чаша «Генуя» с высоким бачком', build: squatToilet },
  shower_stub: { w: 0.6, d: 0.6, h: 2.12, mount: 'floor', ru: 'душевая лейка и трап', build: showerStub },
  hand_pump: { w: 1.2, d: 0.45, h: 1.12, mount: 'floor', ru: 'ручной насос с ведром', build: handPump },
  water_drum: { w: 0.75, d: 0.55, h: 1.1, mount: 'floor', ru: 'бачок питьевой воды на тумбе', build: waterDrum },
  washstand: { w: 0.5, d: 0.45, h: 1.65, mount: 'floor', ru: 'рукомойник с тазом и ведром', build: washstand },
  bunk_triple: { w: 1.9, d: 0.7, h: 2.1, mount: 'floor', ru: 'трёхъярусные нары', build: bunkTriple },
  bed_frame: { w: 1.9, d: 0.8, h: 0.95, mount: 'floor', ru: 'панцирная кровать без матраса', build: bedFrame },
  coat_hooks: { w: 1.85, d: 0.15, h: 1.3, mount: 'wall', y: 0.4, ru: 'вешалка: ОЗК, сумка противогаза, ватник', build: coatHooks },
  gasmask_crate: { w: 0.85, d: 0.6, h: 0.9, mount: 'floor', ru: 'ящик с противогазами, крышка откинута', build: gasmaskCrate },
  gasmask_pile: { w: 1.2, d: 0.6, h: 0.3, mount: 'floor', ru: 'груда противогазов', build: gasmaskPile },
  stretcher: { w: 0.65, d: 0.45, h: 2.2, mount: 'floor', ru: 'носилки, прислонённые к стене', build: stretcher },
  fire_shield: { w: 1.2, d: 0.55, h: 1.9, mount: 'floor', ru: 'пожарный щит и ящик с песком', build: fireShield },
  loudspeaker: { w: 0.25, d: 0.12, h: 0.4, mount: 'wall', y: 1.9, ru: 'абонентский громкоговоритель', build: loudspeaker },
  siren: { w: 0.6, d: 0.36, h: 0.38, mount: 'wall', y: 2.1, ru: 'электросирена на кронштейне', build: siren },
  wall_clock: { w: 0.32, d: 0.07, h: 0.32, mount: 'wall', y: 1.9, ru: 'настенные часы, стоят', build: wallClock },
  field_phone: { w: 0.5, d: 0.28, h: 0.45, mount: 'wall', y: 1.0, ru: 'полевой телефон ТА-57 на полке', build: fieldPhone },
  typewriter_desk: { w: 2.2, d: 0.6, h: 1.1, mount: 'floor', ru: 'стол с пишущей машинкой и опрокинутый стул', build: typewriterDesk },
  kerosene_lamp: { w: 0.6, d: 0.5, h: 0.75, mount: 'floor', ru: 'керосиновая лампа на ящике', build: keroseneLamp },
  canteen_set: { w: 0.9, d: 0.6, h: 0.7, mount: 'floor', ru: 'чайник, кружки и миска на табурете, бидон', build: canteenSet },
  dosimeter_case: { w: 0.4, d: 0.5, h: 0.78, mount: 'floor', ru: 'дозиметр ДП-5 в ящике на табурете', build: dosimeterCase },
  med_stretcher_bed: { w: 1.9, d: 0.6, h: 0.75, mount: 'floor', ru: 'медицинская кушетка', build: medCouch },
  debris_heap: { w: 1.6, d: 0.6, h: 1.05, mount: 'floor', ru: 'куча строительного мусора', build: debrisHeap },
  brick_pile: { w: 2.1, d: 0.6, h: 0.55, mount: 'floor', ru: 'штабель кирпича и носилки для раствора', build: brickPile },
  board_stack: { w: 2.0, d: 0.6, h: 2.2, mount: 'floor', ru: 'доски у стены и поддон', build: boardStack },
  papers: { w: 1.4, d: 1.0, h: 0.05, mount: 'free', ru: 'рассыпанные бумаги, папки, журнал', build: papers },
  bottles: { w: 0.9, d: 0.45, h: 0.3, mount: 'floor', ru: 'бутылки и консервные банки', build: bottles },
  canisters: { w: 1.1, d: 0.55, h: 0.5, mount: 'floor', ru: 'канистры и воронка', build: canisters },
  barrel_stack: { w: 1.25, d: 0.6, h: 1.5, mount: 'floor', ru: 'три бочки: две стоят, одна поверх', build: barrelStack },
  hanging_cables: { w: 2.0, d: 0.8, h: 1.05, mount: 'ceiling', ru: 'провисшие кабели, один оборван', build: hangingCables },
  broken_lamp: { w: 1.45, d: 0.35, h: 1.05, mount: 'ceiling', ru: 'светильник на одной цепи', build: brokenLamp },
  stalactites: { w: 1.4, d: 0.6, h: 0.35, mount: 'ceiling', ru: 'известковые натёки на потолке', build: stalactites },
  ladder_lean: { w: 0.55, d: 0.6, h: 2.4, mount: 'floor', ru: 'приставная лестница', build: ladderLean },
  overturned_table: { w: 2.2, d: 0.9, h: 0.92, mount: 'floor', ru: 'опрокинутый стол и два стула', build: overturnedTable },
  boots_helmet: { w: 0.95, d: 0.45, h: 0.4, mount: 'floor', ru: 'сапоги, каска и сумка противогаза', build: bootsHelmet },
  oil_tray: { w: 1.2, d: 0.6, h: 0.22, mount: 'floor', ru: 'поддон с маслом, ветошь, маслёнка', build: oilTray },
};
