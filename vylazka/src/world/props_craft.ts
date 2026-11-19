/**
 * Поделки и слипшаяся память: бумажные цветы-гиганты, горы из комков со свечами, завал из жердей,
 * заклеенные наклейками шкафчик и стена. Правила те же, что в props_office.ts: предмет описан в своих
 * координатах (метры, y вверх), пол — y = 0; free — по центру, wall — спина в z = 0, ceiling — вниз от y = 0.
 *
 * Материал мира односторонний, поэтому всё, что тоньше сантиметра (лепесток, лист, наклейка), строится
 * листом: лепесток и лист — с двух сторон (две грани с противоположным обходом), наклейка — одной гранью
 * наружу. Накладки вынесены от поверхности на 1,8 мм, а перекрывающиеся наклейки лежат каждая на своей
 * высоте с шагом 0,22 мм. Наклонных цилиндров Xf не умеет — трубка (tube) собрана из колец вершин.
 * Вся случайность — из rng(seed): никакого Math.random.
 */
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { STICKER_TILES, stickerUv } from './papers';
import { hung, rooted, Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';

type V = Vec3;
type Rnd = () => number;

// ───────────────────────────── векторы и примитивы ─────────────────────────────

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
/** Оттенок в допустимых пределах: ни «чернее чёрного», ни выше 1,5 (тест следит). */
const tn = (t: V, k = 1): V => [clamp(t[0] * k, 0.12, 1.5), clamp(t[1] * k, 0.12, 1.5), clamp(t[2] * k, 0.12, 1.5)];
/** Разброс тона соседних граней: ±8 %. */
const wob = (rnd: Rnd, t: V, amp = 0.08): V => tn(t, 1 + (rnd() * 2 - 1) * amp);

type Ao3 = number | readonly [number, number, number];

/** Треугольник лицом в сторону out (вектор в координатах предмета); вырожденный пропускается. */
function tri(xf: Xf, a: V, b: V, c: V, out: V, mat: number, tint: V, ao: Ao3 = 1): void {
  const pa = xf.pt(a[0], a[1], a[2]);
  let pb = xf.pt(b[0], b[1], b[2]);
  let pc = xf.pt(c[0], c[1], c[2]);
  let n = cross(sub(pb, pa), sub(pc, pa));
  const l = len(n);
  if (!(l > 1e-9)) return;
  n = mul(n, 1 / l);
  const o = xf.dir(out[0], out[1], out[2]);
  const k: readonly [number, number, number] = typeof ao === 'number' ? [ao, ao, ao] : ao;
  let k1 = k[1];
  let k2 = k[2];
  if (dot(n, o) < 0) {
    n = mul(n, -1);
    [pb, pc] = [pc, pb];
    [k1, k2] = [k2, k1];
  }
  const i0 = xf.mb.vertex(pa, n, mat, tint, k[0]);
  const i1 = xf.mb.vertex(pb, n, mat, tint, k1);
  const i2 = xf.mb.vertex(pc, n, mat, tint, k2);
  xf.mb.tri(i0, i1, i2);
}

/** Треугольник с явными uv (картинка из стопки бумаги, world/papers.ts) лицом в сторону out. */
function triUv(xf: Xf, a: V, b: V, c: V, out: V, mat: number, tint: V, ua: readonly [number, number], ub: readonly [number, number], uc: readonly [number, number]): void {
  const pa = xf.pt(a[0], a[1], a[2]);
  let pb = xf.pt(b[0], b[1], b[2]);
  let pc = xf.pt(c[0], c[1], c[2]);
  let n = cross(sub(pb, pa), sub(pc, pa));
  const l = len(n);
  if (!(l > 1e-9)) return;
  n = mul(n, 1 / l);
  let tb = ub;
  let tc = uc;
  if (dot(n, xf.dir(out[0], out[1], out[2])) < 0) {
    n = mul(n, -1);
    [pb, pc] = [pc, pb];
    [tb, tc] = [tc, tb];
  }
  const i0 = xf.mb.vertexUv(pa, n, mat, tint, 1, ua);
  const i1 = xf.mb.vertexUv(pb, n, mat, tint, 1, tb);
  const i2 = xf.mb.vertexUv(pc, n, mat, tint, 1, tc);
  xf.mb.tri(i0, i1, i2);
}

/** Тонкий лист: две грани с противоположным обходом; front — куда смотрит лицевая сторона. */
function tri2(xf: Xf, a: V, b: V, c: V, front: V, mat: number, tint: V, ao: Ao3 = 1): void {
  tri(xf, a, b, c, front, mat, tint, ao);
  tri(xf, a, b, c, mul(front, -1), mat, tint, ao);
}

/** Плоский четырёхугольник лицом в сторону out. */
function quad(xf: Xf, p0: V, p1: V, p2: V, p3: V, out: V, mat: number, tint: V, ao = 1): void {
  const w = (p: V): V => xf.pt(p[0], p[1], p[2]);
  xf.mb.quadFacing(w(p0), w(p1), w(p2), w(p3), xf.dir(out[0], out[1], out[2]), mat, tint, ao);
}

/** Выпуклый многоугольник веером от первой вершины, лицом в сторону out. */
function poly(xf: Xf, pts: readonly V[], out: V, mat: number, tint: V, ao = 1): void {
  for (let i = 1; i + 1 < pts.length; i++) tri(xf, pts[0]!, pts[i]!, pts[i + 1]!, out, mat, tint, ao);
}

interface TubeOpts {
  seg: number;
  mat: number;
  /** Оттенок: один на всю трубку или по кольцу на каждую точку пути. */
  tint: V | readonly V[];
  capStart?: boolean;
  capEnd?: boolean;
  ao?: number;
}

/**
 * Трубка по ломаной pts с радиусом radii[i] в каждой точке: кольца вершин, нормали сглажены.
 * Кольцо ставится поперёк средней оси соседних звеньев, рамка переносится вдоль пути без скручивания.
 */
function tube(xf: Xf, pts: readonly V[], radii: readonly number[], o: TubeOpts): void {
  const n = pts.length;
  if (n < 2) return;
  const seg = Math.max(3, o.seg);
  const ao = o.ao ?? 1;
  const tintAt = (i: number): V => (Array.isArray(o.tint[0]) ? (o.tint as readonly V[])[Math.min(i, (o.tint as readonly V[]).length - 1)]! : (o.tint as V));
  const rings: number[][] = [];
  const dirs: V[] = [];
  let u: V = [1, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = norm(sub(pts[Math.min(i + 1, n - 1)]!, pts[Math.max(i - 1, 0)]!));
    dirs.push(d);
    if (i === 0) {
      const ref: V = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      u = norm(cross(ref, d));
    } else {
      const t = sub(u, mul(d, dot(u, d)));
      u = len(t) > 1e-6 ? norm(t) : norm(cross(Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], d));
    }
    const v = cross(d, u);
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const ang = (k / seg) * Math.PI * 2;
      const r = add(mul(u, Math.cos(ang)), mul(v, Math.sin(ang)));
      const p = add(pts[i]!, mul(r, radii[Math.min(i, radii.length - 1)]!));
      const w = xf.pt(p[0], p[1], p[2]);
      const nn = xf.dir(r[0], r[1], r[2]);
      ring.push(xf.mb.vertex(w, nn, o.mat, tintAt(i), ao));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < n; i++) {
    const A = rings[i]!;
    const B = rings[i + 1]!;
    for (let k = 0; k < seg; k++) {
      const j = (k + 1) % seg;
      xf.mb.tri(A[k]!, A[j]!, B[j]!);
      xf.mb.tri(A[k]!, B[j]!, B[k]!);
    }
  }
  // Торцы: плоский веер от центра. Кольцо торца — отдельные вершины с нормалью вдоль оси.
  const capAt = (i: number, sign: 1 | -1): void => {
    const d = mul(dirs[i]!, sign);
    const ref: V = Math.abs(dirs[i]![1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const uu = norm(cross(ref, dirs[i]!));
    const vv = cross(dirs[i]!, uu);
    const c = pts[i]!;
    const nn = xf.dir(d[0], d[1], d[2]);
    const ic = xf.mb.vertex(xf.pt(c[0], c[1], c[2]), nn, o.mat, tintAt(i), ao);
    const ir: number[] = [];
    for (let k = 0; k < seg; k++) {
      const ang = (k / seg) * Math.PI * 2;
      const p = add(c, mul(add(mul(uu, Math.cos(ang)), mul(vv, Math.sin(ang))), radii[Math.min(i, radii.length - 1)]!));
      ir.push(xf.mb.vertex(xf.pt(p[0], p[1], p[2]), nn, o.mat, tintAt(i), ao));
    }
    for (let k = 0; k < seg; k++) {
      const j = (k + 1) % seg;
      if (sign > 0) xf.mb.tri(ic, ir[k]!, ir[j]!);
      else xf.mb.tri(ic, ir[j]!, ir[k]!);
    }
  };
  if (o.capEnd) capAt(n - 1, 1);
  if (o.capStart) capAt(0, -1);
}

// ───────────────────────────── бумажные цветы ─────────────────────────────

/** Гуашь по бумаге: основной цвет лепестков и цвет «пуговицы» в середине. Оттенок умножает бумажный. */
const GOUACHE: readonly { main: V; centre: V }[] = [
  { main: [1.4, 0.22, 0.2], centre: [1.45, 1.22, 0.25] }, // красный — жёлтая середина
  { main: [1.45, 1.22, 0.25], centre: [0.85, 0.32, 1.25] }, // жёлтый — фиолетовая
  { main: [1.45, 0.5, 0.8], centre: [1.45, 1.22, 0.25] }, // розовый — жёлтая
  { main: [0.22, 0.5, 1.5], centre: [1.45, 1.22, 0.25] }, // синий — жёлтая
  { main: [1.45, 0.65, 0.15], centre: [0.85, 0.32, 1.25] }, // оранжевый — фиолетовая
  { main: [0.85, 0.32, 1.25], centre: [1.45, 1.22, 0.25] }, // фиолетовый — жёлтая
];

const GREENS: readonly V[] = [
  [0.3, 0.82, 0.26],
  [0.38, 0.78, 0.3],
  [0.26, 0.7, 0.34],
];

interface HeadOpts {
  petals: number;
  rows: 1 | 2;
  main: V;
  centre: V;
}

/**
 * Головка: центр c, лицо смотрит вдоль a, радиус R. Лепесток — веер из восьми вершин (вершина у середины и
 * семь точек края), слегка чашей, вершины сдвинуты (мятость), соседние грани разного тона. Лепестки
 * ряда лежат каждый на своей высоте (шаг 1,2 % радиуса), чтобы пересечения не рябили.
 */
function head(xf: Xf, rnd: Rnd, c: V, a: V, R: number, o: HeadOpts): void {
  const ref: V = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(ref, a));
  const e2 = cross(a, e1);
  const at = (r: number, t: number, h: number, th: number): V => {
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const x = r * cs - t * sn;
    const y = r * sn + t * cs;
    return [c[0] + e1[0] * x + e2[0] * y + a[0] * h, c[1] + e1[1] * x + e2[1] * y + a[1] * h, c[2] + e1[2] * x + e2[2] * y + a[2] * h];
  };
  const n = o.petals;
  // Контур лепестка: (доля длины, доля полуширины).
  const OUT: readonly (readonly [number, number])[] = [
    [0.3, -0.55],
    [0.65, -1.0],
    [0.93, -0.62],
    [1.02, 0],
    [0.93, 0.62],
    [0.65, 1.0],
    [0.3, 0.55],
  ];
  let maxH = 0;
  for (let row = 0; row < o.rows; row++) {
    const L = R * (row === 0 ? 1 : 0.68);
    const lift = row * 0.1 * R;
    const cup = row === 0 ? 0.22 : 0.3;
    const Wh = Math.tan(Math.PI / n) * 0.65 * L * 1.12;
    const a0 = row * (Math.PI / n) + rnd() * 0.3;
    const rowTint = row === 0 ? o.main : tn(o.main, 0.88);
    for (let i = 0; i < n; i++) {
      const th = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
      const hoff = lift + i * 0.012 * R;
      const jit = (): number => (rnd() - 0.5) * 0.1 * L;
      const notch = rnd() < 0.5 ? 0.1 : 0;
      const apex = at(0.08 * L, 0, hoff, th);
      const ring: V[] = OUT.map(([rf, wf], k) => {
        const r = rf * L - (k === 3 ? notch * L : 0) + jit();
        const h = hoff + cup * L * Math.pow(rf, 1.7) + jit() * 0.6;
        return at(r, wf * Wh + jit(), h, th);
      });
      maxH = Math.max(maxH, hoff + cup * L);
      for (let k = 0; k + 1 < ring.length; k++) {
        tri2(xf, apex, ring[k]!, ring[k + 1]!, a, MAT.paper, wob(rnd, rowTint), [0.55, 0.96, 0.96]);
      }
    }
  }
  // Пуговица: плоский многогранный кружок другого цвета с бортиком.
  const top = (o.rows === 2 ? 0.1 * R + 0.012 * R * n : 0.012 * R * n) + 0.06 * R;
  const bot = Math.max(0, top - 0.12 * R);
  const k0 = rnd() * 0.4;
  const ringTop: V[] = [];
  const ringBot: V[] = [];
  const NB = 8;
  for (let i = 0; i < NB; i++) {
    const th = k0 + (i / NB) * Math.PI * 2;
    const rr = 0.2 * R * (0.93 + rnd() * 0.14);
    ringTop.push(at(rr * 0.92, 0, top, th));
    ringBot.push(at(rr, 0, bot, th));
  }
  poly(xf, ringTop, a, MAT.paper, tn(o.centre, 1.0), 1);
  for (let i = 0; i < NB; i++) {
    const j = (i + 1) % NB;
    const mid = at(0, 0, (top + bot) / 2, 0);
    const mp = lerp(ringTop[i]!, ringTop[j]!, 0.5);
    quad(xf, ringBot[i]!, ringBot[j]!, ringTop[j]!, ringTop[i]!, sub(mp, mid), MAT.paper, wob(rnd, o.centre, 0.1), 0.9);
  }
}

/** Лист-лодочка: основание на стебле, ось вдоль axis, киль посередине, кончик свисает. */
function leaf(xf: Xf, rnd: Rnd, base: V, axis: V, up: V, Ll: number, Wl: number, tint: V): void {
  const d = norm(axis);
  const w = norm(cross(d, up));
  const nrm = norm(cross(w, d));
  const j = (): number => (rnd() - 0.5) * 0.04 * Ll;
  const P = (s: number, side: number, lift: number): V => add(add(add(base, mul(d, s * Ll)), mul(w, side * Wl)), mul(nrm, lift * Wl + j()));
  const B = base;
  const L1 = P(0.28, -0.45, 0.1);
  const L2 = P(0.62, -1.0, 0.1);
  const T = add(P(1.0, 0, -0.15 * Ll / Wl), [0, -0.03, 0]);
  const R2 = P(0.62, 1.0, 0.1);
  const R1 = P(0.28, 0.45, 0.1);
  const M = P(0.5, 0, -0.35);
  const ring: V[] = [B, L1, L2, T, R2, R1];
  for (let k = 0; k < ring.length; k++) {
    tri2(xf, ring[k]!, ring[(k + 1) % ring.length]!, M, nrm, MAT.paper, wob(rnd, tint, 0.1), [0.6, 1, 1]);
  }
}

interface FlowerOpts {
  /** Низ стебля. */
  base: V;
  /** Центр головки. */
  headC: V;
  /** Куда смотрит головка. */
  a: V;
  R: number;
  stemR: number;
  wobble: number;
  leafScale: number;
  pal: { main: V; centre: V };
  petals: number;
  rows: 1 | 2;
}

/** Цветок целиком: стебель из трёх колен, два листа, головка. Возвращает точки пути стебля. */
function flower(xf: Xf, rnd: Rnd, o: FlowerOpts): V[] {
  const top = sub(o.headC, mul(o.a, 0.015 + 0.03 * o.R));
  const w = (): V => [(rnd() - 0.5) * 2 * o.wobble, 0, (rnd() - 0.5) * 2 * o.wobble];
  const pts: V[] = [o.base, add(lerp(o.base, top, 1 / 3), w()), add(lerp(o.base, top, 2 / 3), w()), top];
  const g = GREENS[Math.floor(rnd() * GREENS.length)]!;
  tube(xf, pts, [o.stemR, o.stemR, o.stemR * 0.92, o.stemR * 0.85], { seg: 6, mat: MAT.paper, tint: [wob(rnd, g, 0.1), wob(rnd, g, 0.1), wob(rnd, g, 0.1), wob(rnd, g, 0.1)], capEnd: true });
  // Два листа на разных коленях, в разные стороны, чуть к зрителю.
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const az = (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.9;
    const el = (0.5 + rnd() * 0.35) as number;
    const hor: V = [Math.cos(az), 0, Math.sin(az) * 0.6 + 0.25];
    const axis = add(mul(norm(hor), Math.cos(el)), [0, Math.sin(el), 0]);
    const Ll = (0.3 + rnd() * 0.1) * o.leafScale;
    leaf(xf, rnd, pts[i + 1]!, axis, [0, 1, 0], Ll, Ll * 0.3, wob(rnd, g, 0.12));
  }
  head(xf, rnd, o.headC, o.a, o.R, { petals: o.petals, rows: o.rows, main: o.pal.main, centre: o.pal.centre });
  return pts;
}

function pickFlower(rnd: Rnd): { pal: { main: V; centre: V }; petals: number; rows: 1 | 2 } {
  return { pal: GOUACHE[Math.floor(rnd() * GOUACHE.length)]!, petals: 5 + Math.floor(rnd() * 5), rows: rnd() < 0.5 ? 1 : 2 };
}

/** Взгляд головки: смотрит на зрителя (+z), приподнята на tUp, развёрнута на yaw. */
function facingTo(yaw: number, tUp: number): V {
  return [Math.sin(yaw) * Math.cos(tUp), Math.sin(tUp), Math.cos(yaw) * Math.cos(tUp)];
}

function paperFlower(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const f = pickFlower(rnd);
  const R = 0.35 + rnd() * 0.12;
  // Головка кивает к зрителю: лицо смотрит на него и вниз на 20–40°.
  const nod = ((20 + rnd() * 20) * Math.PI) / 180;
  const a = facingTo((rnd() - 0.5) * 0.5, -nod);
  const hyMax = 2.08 - R * Math.cos(nod) * 1.04;
  const hy = 1.5 + rnd() * Math.max(0, hyMax - 1.5);
  const hc: V = [(rnd() - 0.5) * 0.08, hy, 0.06 + rnd() * 0.08];
  flower(xf, rnd, { base: [0, 0, 0], headC: hc, a, R, stemR: 0.015 + rnd() * 0.01, wobble: 0.05, leafScale: 1, ...f });
  xf.collider([-0.08, 0, -0.08], [0.08, hy, 0.08]);
}

function paperFlowerBed(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  // Кочка: низкая мятая бумажная горка, три кольца по девять вершин, без дна.
  const N = 9;
  const tintK: V[] = [
    [0.8, 0.55, 0.3],
    [0.4, 0.7, 0.3],
    [0.62, 0.46, 0.26],
  ];
  const ringK = (r: number, y: number): V[] => Array.from({ length: N }, (_, i) => [Math.cos((i / N) * 6.2832) * r * (0.9 + rnd() * 0.2), y + (rnd() - 0.5) * 0.02, Math.sin((i / N) * 6.2832) * r * (0.9 + rnd() * 0.2)] as V);
  const r0 = ringK(0.3, 0.0);
  const r1 = ringK(0.2, 0.13);
  const apex: V = [0, 0.23, 0];
  const cen: V = [0, 0.05, 0];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const t = wob(rnd, tintK[Math.floor(rnd() * 3)]!, 0.1);
    const o = (p: V): V => sub(p, cen);
    tri(xf, r0[i]!, r0[j]!, r1[j]!, o(lerp(r0[i]!, r1[j]!, 0.5)), MAT.paper, t, 0.7);
    tri(xf, r0[i]!, r1[j]!, r1[i]!, o(lerp(r0[i]!, r1[j]!, 0.5)), MAT.paper, wob(rnd, t, 0.1), 0.75);
    tri(xf, r1[i]!, r1[j]!, apex, o(lerp(r1[i]!, apex, 0.5)), MAT.paper, wob(rnd, t, 0.1), 0.9);
  }
  // 4–5 цветков разной высоты: высоты распределены равномерно и перетасованы, стебли — из кочки.
  const n = 4 + Math.floor(rnd() * 2);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const colours = Array.from({ length: GOUACHE.length }, (_, i) => i);
  for (let i = colours.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [colours[i], colours[j]] = [colours[j]!, colours[i]!];
  }
  for (let i = 0; i < n; i++) {
    const R = 0.22 + rnd() * 0.18;
    const ht = order[i]! / (n - 1);
    const hy = 0.95 + ht * (2.2 - R * 1.05 - 0.95);
    // Высокие головки кивают к зрителю (до 40° вниз), низкие смотрят чуть вверх.
    const nod = (clamp((hy - 1.2) * 45, -15, 40) * Math.PI) / 180;
    const a = facingTo((rnd() - 0.5) * 0.7, -nod);
    const xr = 1.1 - R - 0.05;
    const hx = (-xr + (i + 0.5 + (rnd() - 0.5) * 0.5) * ((2 * xr) / n)) * 0.95;
    const hz = (rnd() - 0.5) * 0.5;
    const baseP: V = [(rnd() - 0.5) * 0.1, 0.17, (rnd() - 0.5) * 0.1];
    const pk = GOUACHE[colours[i % colours.length]!]!;
    flower(xf, rnd, { base: baseP, headC: [hx, hy, hz], a, R, stemR: 0.014 + rnd() * 0.008, wobble: 0.04, leafScale: 0.7, pal: pk, petals: 5 + Math.floor(rnd() * 5), rows: rnd() < 0.5 ? 1 : 2 });
  }
  xf.collider([-0.25, 0, -0.25], [0.25, 0.6, 0.25]);
}

/** Тело подвесного цветка; cy — высота центра головки. Нужен дважды: примерка по габариту и настоящая сборка. */
function hangBody(xf: Xf, seed: number, cy: number): void {
  const rnd = rng(seed);
  const f = pickFlower(rnd);
  const R = 0.45 + rnd() * 0.17;
  const tilt = ((10 + rnd() * 15) * Math.PI) / 180;
  const az = rnd() * Math.PI * 2;
  const a: V = [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
  const c: V = [0, cy, 0];
  head(xf, rnd, c, a, R, { petals: f.petals, rows: f.rows, main: f.pal.main, centre: f.pal.centre });
  // Короткий обрубок стебля вверх от головки, на нём два листа; к его верху привязаны нити.
  const back = mul(a, -1);
  const s0 = add(c, mul(back, 0.016 + 0.03 * R));
  const s1 = add(c, mul(back, 0.3));
  const g = GREENS[Math.floor(rnd() * GREENS.length)]!;
  const stemR = 0.016 + rnd() * 0.008;
  tube(xf, [s0, lerp(s0, s1, 0.5), s1], [stemR, stemR, stemR * 0.9], { seg: 6, mat: MAT.paper, tint: wob(rnd, g, 0.1), capEnd: true });
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const hor: V = [Math.cos(az + (side > 0 ? 0 : Math.PI) + 1.2), 0, Math.sin(az + (side > 0 ? 0 : Math.PI) + 1.2)];
    const el = 0.45 + rnd() * 0.3;
    const axis = add(mul(hor, Math.cos(el)), mul(back, Math.sin(el)));
    const Ll = 0.22 + rnd() * 0.06;
    leaf(xf, rnd, lerp(s0, s1, 0.35 + i * 0.3), axis, back, Ll, Ll * 0.3, wob(rnd, g, 0.12));
  }
  // Две нити от потолка к верху обрубка.
  const thread = (tx: number, tz: number, k: number): void => {
    const top: V = [tx, 0, tz];
    const bot = add(s1, [k * 0.012, 0, 0]);
    tube(xf, [top, bot], [0.004, 0.004], { seg: 4, mat: MAT.paper, tint: [1.45, 1.4, 1.2] });
  };
  thread(-0.22, 0.03, -1);
  thread(0.22, -0.03, 1);
}

function paperFlowerHang(xf: Xf, seed: number): void {
  // Низ цветка — на 1,0–1,2 м ниже потолка. Примерка без вывода даёт точный габарит, сдвиг считается по нему.
  const depth = 1.0 + rng(seed ^ 0x3c6ef372)() * 0.2;
  const probe = new Xf(new MeshBuilder(), null, 0, 0, 0, 0);
  hangBody(probe, seed, 0);
  const b = probe.mb.bounds(0);
  const minY = b ? b[0][1] : -0.3;
  // Подвесное стоит от стены: z от 0 до d, поэтому центр головки — на полглубины вперёд.
  hangBody(xf.child(0, 0, 0.65), seed, -depth - minY);
}

// ───────────────────────────── горы из комков ─────────────────────────────

/** Комок: куб, октаэдр, пятигранная горка или пятигранный столбик; повёрнут как попало, без нижней грани там, где она не видна. */
function lump(xf: Xf, rnd: Rnd, c: V, s: number, mat: number, tint: V, ao: number): void {
  const yaw = rnd() * Math.PI * 2;
  const t1 = (rnd() - 0.5) * 0.9;
  const t2 = (rnd() - 0.5) * 0.9;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const c1 = Math.cos(t1);
  const s1 = Math.sin(t1);
  const c2 = Math.cos(t2);
  const s2 = Math.sin(t2);
  const sx = 0.75 + rnd() * 0.45;
  const sh = 0.75 + rnd() * 0.45;
  const sz = 0.75 + rnd() * 0.45;
  const rot = (p: V): V => {
    let x = p[0] * sx;
    let y = p[1] * sh;
    let z = p[2] * sz;
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [y, z] = [y * c1 - z * s1, y * s1 + z * c1];
    [x, y] = [x * c2 - y * s2, x * s2 + y * c2];
    return [c[0] + x * s, c[1] + y * s, c[2] + z * s];
  };
  const kind = rnd();
  const face3 = (p: V, q: V, r: V): void => tri(xf, p, q, r, sub(mul(add(add(p, q), r), 1 / 3), c), mat, tint, ao);
  if (kind < 0.25) {
    const v: V[] = [];
    for (let i = 0; i < 8; i++) v.push(rot([i & 4 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 1 ? 0.5 : -0.5]));
    // Пять граней: нижняя (−y) не строится.
    for (const f of [
      [4, 6, 7, 5],
      [0, 1, 3, 2],
      [2, 3, 7, 6],
      [1, 5, 7, 3],
      [0, 2, 6, 4],
    ] as const) {
      const p = f.map((i) => v[i]!) as [V, V, V, V];
      const cc = mul(add(add(p[0], p[2]), add(p[1], p[3])), 0.25);
      quad(xf, p[0], p[1], p[2], p[3], sub(cc, c), mat, tint, ao);
    }
  } else if (kind < 0.5) {
    const px = [rot([0.5, 0, 0]), rot([-0.5, 0, 0])];
    const py = [rot([0, 0.5, 0]), rot([0, -0.5, 0])];
    const pz = [rot([0, 0, 0.5]), rot([0, 0, -0.5])];
    for (const x of px) for (const y of py) for (const z of pz) face3(x, y, z);
  } else if (kind < 0.85) {
    const ring: V[] = Array.from({ length: 5 }, (_, i) => rot([Math.cos((i / 5) * 6.2832) * 0.5, -0.1, Math.sin((i / 5) * 6.2832) * 0.5]));
    const apex = rot([0, 0.4, 0]);
    for (let i = 0; i < 5; i++) face3(ring[i]!, ring[(i + 1) % 5]!, apex);
  } else {
    const lo: V[] = Array.from({ length: 5 }, (_, i) => rot([Math.cos((i / 5) * 6.2832) * 0.45, -0.4, Math.sin((i / 5) * 6.2832) * 0.45]));
    const hi: V[] = Array.from({ length: 5 }, (_, i) => rot([Math.cos((i / 5) * 6.2832) * 0.45, 0.4, Math.sin((i / 5) * 6.2832) * 0.45]));
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      const cc = mul(add(add(lo[i]!, lo[j]!), add(hi[i]!, hi[j]!)), 0.25);
      quad(xf, lo[i]!, lo[j]!, hi[j]!, hi[i]!, sub(cc, c), mat, tint, ao);
    }
    const up: V = sub(hi[0]!, lo[0]!);
    for (let i = 1; i + 1 < 5; i++) tri(xf, hi[0]!, hi[i]!, hi[i + 1]!, up, mat, tint, ao);
  }
}

interface MoundCfg {
  w: number;
  h: number;
  lumps: number;
  candles: readonly [number, number];
  /** Сторона оградки, м; 0 — без неё. */
  fence: number;
  /** Сколько треугольников на комки: остальное — свечи, оградка, основа. */
  lumpTris: number;
  /** Сторон у основы-ядра и доли радиуса его колец. */
  coreSides: number;
  coreRings: readonly number[];
}

/** Бледные цвета бывших вещей: бледно-красный, бледно-синий, охра. */
const FADED: readonly V[] = [
  [1.1, 0.62, 0.58],
  [0.68, 0.8, 1.1],
  [1.15, 0.95, 0.5],
];

function mound(xf: Xf, seed: number, cfg: MoundCfg): void {
  const rnd = rng(seed);
  const Rb = cfg.w * 0.4;
  const Hp = cfg.h * 0.72;
  const profile = (r: number): number => Hp * Math.pow(Math.max(0, 1 - r / Rb), 1.25);

  // Основа: тёмный гранёный конус под комками, чтобы щели между ними не открывали пустоту.
  const S = cfg.coreSides;
  const rings = cfg.coreRings;
  const coreAt = (k: number, i: number): V => {
    const r = Rb * rings[k]!;
    const th = (i / S) * Math.PI * 2;
    return [Math.cos(th) * r, Math.max(0, profile(r) - 0.02), Math.sin(th) * r];
  };
  const core: V = [0, 0.1, 0];
  const apexC: V = [0, Math.max(0, Hp - 0.02), 0];
  const coreT: V = [1.0, 1.0, 1.0];
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      const o = sub(lerp(coreAt(k, i), coreAt(k + 1, j), 0.5), core);
      tri(xf, coreAt(k, i), coreAt(k, j), coreAt(k + 1, j), o, MAT.concrete, wob(rnd, coreT, 0.1), 0.45);
      tri(xf, coreAt(k, i), coreAt(k + 1, j), coreAt(k + 1, i), o, MAT.concrete, wob(rnd, coreT, 0.1), 0.45);
    }
  }
  const last = rings.length - 1;
  for (let i = 0; i < S; i++) tri(xf, coreAt(last, i), coreAt(last, (i + 1) % S), apexC, sub(coreAt(last, i), core), MAT.concrete, wob(rnd, coreT, 0.1), 0.6);

  // Свечи: сначала места (комки их обходят), потом всё остальное.
  const nc = cfg.candles[0] + Math.floor(rnd() * (cfg.candles[1] - cfg.candles[0] + 1));
  const spots: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < nc; i++) {
    for (let tries = 0; tries < 12; tries++) {
      const r = Rb * (0.22 + rnd() * 0.58);
      const th = rnd() * Math.PI * 2;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      if (spots.every((s) => Math.hypot(s.x - x, s.z - z) > 0.16)) {
        spots.push({ x, z, r });
        break;
      }
    }
  }

  // Комки: на поверхности конуса, плотно, вперемешку; каждый восьмой — выцветшая вещь.
  const start = xf.mb.triangleCount;
  const MATS = [MAT.plaster, MAT.concrete, MAT.paper];
  const ASH: readonly V[] = [
    [1.05, 1.05, 1.0],
    [1.12, 1.02, 0.84],
    [0.92, 0.92, 0.94],
    [1.2, 1.18, 1.1],
  ];
  let placed = 0;
  for (let tries = 0; placed < cfg.lumps && tries < cfg.lumps * 6; tries++) {
    if (xf.mb.triangleCount - start > cfg.lumpTris) break;
    const r = Rb * Math.sqrt(rnd());
    const th = rnd() * Math.PI * 2;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 0.07)) continue;
    const size = 0.04 + 0.1 * Math.pow(rnd(), 1.3);
    const y = Math.max(profile(r) + size * 0.1, size * 0.5);
    const mi = Math.floor(rnd() * 3);
    const k = placed % 8 === 3 ? FADED[Math.floor(rnd() * FADED.length)]! : ASH[Math.floor(rnd() * ASH.length)]!;
    const tint = mi === 1 ? tn(k, 1.35) : tn(k, 0.9 + rnd() * 0.2);
    lump(xf, rnd, [x, y, z], size, MATS[mi]!, tint, 0.55 + 0.45 * clamp(y / Hp, 0, 1));
    placed++;
  }

  // Свечи с пламенем и воском у основания.
  for (const s of spots) {
    const gy = profile(s.r);
    const wax = tn([1.3, 1.25, 1.05], 0.95 + rnd() * 0.1);
    const pr = 0.035 + rnd() * 0.02;
    // Лепёшка воска: веер из шести вершин по склону.
    const padY = (px: number, pz: number): number => profile(Math.hypot(px, pz)) - 0.004;
    const pc: V = [s.x, padY(s.x, s.z), s.z];
    const pr0 = rnd() * 6;
    const padPts: V[] = Array.from({ length: 6 }, (_, i) => {
      const th = pr0 + (i / 6) * Math.PI * 2;
      const rr = pr * (0.8 + rnd() * 0.4);
      const px = s.x + Math.cos(th) * rr;
      const pz = s.z + Math.sin(th) * rr;
      return [px, padY(px, pz), pz];
    });
    for (let i = 0; i < 6; i++) tri(xf, pc, padPts[i]!, padPts[(i + 1) % 6]!, [0, 1, 0], MAT.plaster, wob(rnd, wax, 0.06), 0.9);
    const hc = 0.12 + rnd() * 0.18;
    const cr = 0.012 + rnd() * 0.006;
    const top = Math.min(gy + hc, cfg.h - 0.07);
    tube(xf, [[s.x, gy - 0.004, s.z], [s.x, top, s.z]], [cr, cr * 0.95], { seg: 5, mat: MAT.plaster, tint: wax, capEnd: true });
    // Капля пламени: ромб 2,5 × 5 см из двух четырёхгранных конусов.
    const fb = top + 0.003;
    const ft: V = [8.5 + rnd() * 1.5, 4.8 + rnd() * 0.8, 1.4 + rnd() * 0.3];
    const lo: V = [s.x, fb, s.z];
    const hi: V = [s.x, fb + 0.05, s.z];
    const mid = fb + 0.014;
    const ring: V[] = [
      [s.x + 0.0125, mid, s.z],
      [s.x, mid, s.z + 0.0125],
      [s.x - 0.0125, mid, s.z],
      [s.x, mid, s.z - 0.0125],
    ];
    const cc: V = [s.x, mid, s.z];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tri(xf, lo, ring[i]!, ring[j]!, sub(lerp(ring[i]!, ring[j]!, 0.5), cc), MAT.glow, ft, 1);
      tri(xf, hi, ring[i]!, ring[j]!, sub(lerp(ring[i]!, ring[j]!, 0.5), cc), MAT.glow, ft, 1);
    }
  }

  // Оградка: стойки и две жерди по квадрату, проём 0,6 м спереди (со стороны +z).
  if (cfg.fence > 0) {
    const h = cfg.fence / 2;
    const dark = (): V => tn([0.9, 0.9, 0.95], 0.85 + rnd() * 0.3);
    const runs: [V, V][] = [
      [[-h, 0, -h], [h, 0, -h]],
      [[-h, 0, -h], [-h, 0, h]],
      [[h, 0, -h], [h, 0, h]],
      [[-h, 0, h], [-0.3, 0, h]],
      [[0.3, 0, h], [h, 0, h]],
    ];
    const posts = new Map<string, V>();
    for (const [p, q] of runs) {
      const L = len(sub(q, p));
      const cnt = Math.max(1, Math.round(L / 0.5));
      for (let i = 0; i <= cnt; i++) {
        const pt = lerp(p, q, i / cnt);
        posts.set(`${pt[0].toFixed(3)},${pt[2].toFixed(3)}`, pt);
      }
      for (const y of [0.2, 0.38]) tube(xf, [[p[0], y, p[2]], [q[0], y, q[2]]], [0.008, 0.008], { seg: 4, mat: MAT.castIron, tint: dark() });
    }
    for (const p of posts.values()) tube(xf, [[p[0], 0, p[2]], [p[0], 0.45, p[2]]], [0.012, 0.012], { seg: 4, mat: MAT.castIron, tint: dark(), capEnd: true });
  }
  xf.collider([-0.35 * cfg.w, 0, -0.35 * cfg.w], [0.35 * cfg.w, 0.6 * cfg.h, 0.35 * cfg.w]);
}

const MOUND_CFG: Record<string, MoundCfg> = {
  mound_small: { w: 1.0, h: 0.55, lumps: 60, candles: [3, 3], fence: 0, lumpTris: 560, coreSides: 8, coreRings: [1, 0.55, 0.25] },
  mound: { w: 2.0, h: 1.15, lumps: 200, candles: [8, 10], fence: 1.9, lumpTris: 1650, coreSides: 10, coreRings: [1, 0.7, 0.45, 0.2] },
  mound_big: { w: 3.0, h: 1.7, lumps: 380, candles: [14, 18], fence: 2.9, lumpTris: 3000, coreSides: 12, coreRings: [1, 0.75, 0.55, 0.35, 0.18] },
};

// ───────────────────────────── завал ─────────────────────────────

/** Ближайшие точки двух отрезков (Эриксон): параметры s, t в 0…1 и расстояние. */
function segClosest(p1: V, q1: V, p2: V, q2: V): { s: number; t: number; d: number } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const c = dot(d1, r);
  const b = dot(d1, d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a, 0, 1);
  }
  const d = len(sub(add(p1, mul(d1, s)), add(p2, mul(d2, t))));
  return { s, t, d };
}

const POLE_TINTS: readonly V[] = [
  [1.5, 1.45, 0.9], // бамбук-солома
  [1.4, 1.3, 0.78],
  [1.0, 1.25, 0.68], // зеленоватый бамбук
  [0.8, 0.85, 0.9], // серое дерево
  [0.72, 0.74, 0.76],
];

function thicket(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const n = 16 + Math.floor(rnd() * 7);
  const poles: { a: V; b: V; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const side = rnd() < 0.5 ? 1 : -1;
    let best: { a: V; b: V; r: number } | null = null;
    for (let tries = 0; tries < 30; tries++) {
      const th = ((10 + rnd() * 45) * Math.PI) / 180;
      const phi = (rnd() - 0.5) * 2 * 0.9;
      const hx = side * Math.cos(phi);
      const hz = Math.sin(phi);
      let L = 2.2 + rnd() * 0.8;
      L = Math.min(L, 2.45 / Math.cos(th));
      const rx = L * Math.sin(th) * Math.abs(hx);
      const rz = L * Math.sin(th) * Math.abs(hz);
      if (rx > 2.25 || rz > 1.25) continue;
      const dx = L * Math.sin(th) * hx;
      const dz = L * Math.sin(th) * hz;
      const x0 = Math.max(-1.15, -1.15 - dx) + rnd() * (Math.min(1.15, 1.15 - dx) - Math.max(-1.15, -1.15 - dx));
      const z0 = Math.max(-0.65, -0.65 - dz) + rnd() * (Math.min(0.65, 0.65 - dz) - Math.max(-0.65, -0.65 - dz));
      best = { a: [x0, 0, z0], b: [x0 + dx, L * Math.cos(th), z0 + dz], r: 0.025 + rnd() * 0.02 };
      break;
    }
    if (!best) best = { a: [(rnd() - 0.5) * 1.6, 0, (rnd() - 0.5) * 0.6], b: [(rnd() - 0.5) * 1.6, 2.3, (rnd() - 0.5) * 0.6], r: 0.03 };
    poles.push(best);
  }
  // Жерди.
  for (const p of poles) {
    const k = POLE_TINTS[Math.floor(rnd() * POLE_TINTS.length)]!;
    tube(xf, [p.a, p.b], [p.r, p.r * 0.88], { seg: 6, mat: MAT.wood, tint: [wob(rnd, k, 0.08), wob(rnd, k, 0.08)], capStart: true, capEnd: true, ao: 1 });
  }
  // Белые обмотки: в 10–14 местах, где жерди сходятся ближе всего, — на обеих жердях сразу.
  const pairs: { i: number; j: number; s: number; t: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = segClosest(poles[i]!.a, poles[i]!.b, poles[j]!.a, poles[j]!.b);
      // У самого пола жерди тоже «сходятся», но обматывать там нечего: берём выше 0,35 м.
      const y = poles[i]!.a[1] + (poles[i]!.b[1] - poles[i]!.a[1]) * c.s;
      if (y > 0.35) pairs.push({ i, j, ...c });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const want = 10 + Math.floor(rnd() * 5);
  const taken: { pole: number; t: number }[] = [];
  const near = (pole: number, t: number): boolean => taken.some((q) => q.pole === pole && Math.abs(q.t - t) < 0.08);
  let done = 0;
  for (const c of pairs) {
    if (done >= want) break;
    if (near(c.i, c.s) || near(c.j, c.t)) continue;
    taken.push({ pole: c.i, t: c.s }, { pole: c.j, t: c.t });
    done++;
    for (const [idx, t] of [[c.i, c.s], [c.j, c.t]] as const) {
      const p = poles[idx]!;
      const d = norm(sub(p.b, p.a));
      const L = len(sub(p.b, p.a));
      const w = 0.05 + rnd() * 0.04;
      const t0 = clamp(t - w / (2 * L), 0.02, 0.98 - w / L);
      const ra = p.r * (1 - 0.12 * t0) + 0.007;
      const c0 = add(p.a, mul(d, t0 * L));
      const c1 = add(c0, mul(d, w));
      const wt = wob(rnd, [1.4, 1.38, 1.3], 0.06);
      tube(xf, [c0, c1], [ra, ra], { seg: 6, mat: MAT.paper, tint: wt });
    }
  }
  xf.collider([-1.1, 0, -0.45], [1.1, 2.3, 0.45]);
}

// ───────────────────────────── наклейки ─────────────────────────────

/** Высота первой накладки над поверхностью и шаг между слоями, м. */
const OFF = 0.0018;
const STEP = 0.00022;

interface Layer {
  u: number;
  v: number;
  r: number;
  top: number;
}

/** Плоскость наклеек: начало, оси, наружная нормаль, прямоугольник допустимых центров и занятые слои. */
interface Plane {
  o: V;
  u: V;
  v: V;
  n: V;
  rect: readonly [number, number, number, number];
  layers: Layer[];
  maxTop: number;
}

const planePt = (pl: Plane, u: number, v: number, lvl: number): V => add(add(add(pl.o, mul(pl.u, u)), mul(pl.v, v)), mul(pl.n, OFF + lvl * STEP));

/** Яркий цвет наклейки: оттенок по кругу, материал — бумага, эмаль или краска. */
function stickerPaint(rnd: Rnd): { mat: number; tint: V } {
  const h = rnd() * 6;
  const ch = (k: number): number => clamp(Math.abs(((h + k) % 6) - 3) - 1, 0, 1);
  const hue: V = [ch(0), ch(4), ch(2)];
  const m = rnd();
  const mat = m < 0.45 ? MAT.paper : m < 0.85 ? MAT.enamel : [MAT.paintOchre, MAT.paintBlue, MAT.paintGreen, MAT.paintRed][Math.floor(rnd() * 4)]!;
  const k = mat === MAT.paper || mat === MAT.enamel ? 1.35 : 1.5;
  return { mat, tint: tn([0.12 + hue[0] * k, 0.12 + hue[1] * k, 0.12 + hue[2] * k]) };
}

/**
 * Контур наклейки в плоскости: прямоугольник, круг (6–8 сторон), овал или звезда; повёрнут на al. raw — те же точки до поворота:
 * по ним картинка ложится на наклейку и поворачивается вместе с ней.
 */
function outline(rnd: Rnd, size: number, al: number): { pts: [number, number][]; raw: [number, number][]; kind: 'rect' | 'circle' | 'oval' | 'star' } {
  const k = rnd();
  const rot = (p: [number, number]): [number, number] => [p[0] * Math.cos(al) - p[1] * Math.sin(al), p[0] * Math.sin(al) + p[1] * Math.cos(al)];
  const shape = (kind: 'rect' | 'circle' | 'oval' | 'star', raw: [number, number][]) => ({ kind, raw, pts: raw.map(rot) });
  if (k < 0.45) {
    const hw = (size / 2) * (0.8 + rnd() * 0.5);
    const hh = (size / 2) * (0.6 + rnd() * 0.5);
    return shape('rect', [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]);
  }
  if (k < 0.7) {
    const sides = 6 + Math.floor(rnd() * 3);
    return shape('circle', Array.from({ length: sides }, (_, i): [number, number] => [(Math.cos((i / sides) * 6.2832) * size) / 2, (Math.sin((i / sides) * 6.2832) * size) / 2]));
  }
  if (k < 0.86) {
    return shape('oval', Array.from({ length: 6 }, (_, i): [number, number] => [Math.cos((i / 6) * 6.2832) * size * 0.5, Math.sin((i / 6) * 6.2832) * size * 0.31]));
  }
  return shape(
    'star',
    Array.from({ length: 10 }, (_, i): [number, number] => {
      const r = i % 2 === 0 ? size / 2 : size * 0.22;
      return [Math.cos((i / 10) * 6.2832 - 1.5708) * r, Math.sin((i / 10) * 6.2832 - 1.5708) * r];
    }),
  );
}

/**
 * Колода картинок наклеек на один предмет: все STICKER_TILES по разу в случайном порядке, а когда кончились — −1: остальные
 * наклейки этой вещи прежние, без картинки (куратор, пачка 52, противоречие 328: одна и та же картинка на шкафчике не
 * повторяется). Свой генератор от сида вещи — общий поток раскладки она не трогает.
 */
function stickerDeck(seed: number): () => number {
  const r = rng(seed ^ 0x57c4);
  const deck = Array.from({ length: STICKER_TILES }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return () => deck.pop() ?? -1;
}

/**
 * Одна наклейка: кайма (у каждой третьей) и тело с картинкой (партнёр 19.11: «стикеры нужно оставить такими же, но сделать на
 * них более детальное изображение»; картинки — слой stickers, world/papers.ts). Слой — выше всех, кого она накрывает. Без
 * картинки (tile < 0) — прежняя: цветная, иногда с тёмными «строками».
 */
function sticker(xf: Xf, rnd: Rnd, pl: Plane, i: number, u: number, v: number, size: number, tile = -1): void {
  const al = rnd() * Math.PI * 2;
  const sh = outline(rnd, size, al);
  const border = i % 3 === 0;
  const rad = Math.max(...sh.pts.map((p) => Math.hypot(p[0], p[1]))) + (border ? 0.006 : 0.002);
  let lvl = 0;
  for (const l of pl.layers) if (Math.hypot(l.u - u, l.v - v) < l.r + rad) lvl = Math.max(lvl, l.top + 1);
  const top = lvl + 2;
  pl.layers.push({ u, v, r: rad, top });
  pl.maxTop = Math.max(pl.maxTop, top);
  const star = sh.kind === 'star';
  const emit = (pts: readonly [number, number][], l: number, mat: number, tint: V): void => {
    const P = pts.map(([a, b]) => planePt(pl, u + a, v + b, l));
    if (star) {
      const c = planePt(pl, u, v, l);
      for (let k = 0; k < P.length; k++) tri(xf, c, P[k]!, P[(k + 1) % P.length]!, pl.n, mat, tint);
    } else poly(xf, P, pl.n, mat, tint);
  };
  if (border) {
    const grown = sh.pts.map(([a, b]): [number, number] => {
      const l = Math.hypot(a, b) || 1;
      return [a + (a / l) * 0.005, b + (b / l) * 0.005];
    });
    emit(grown, lvl, MAT.paper, wob(rnd, [1.4, 1.38, 1.3], 0.04));
  }
  const paint = stickerPaint(rnd);
  const bodyTint = wob(rnd, paint.tint, 0.06);
  // Чисел из общего потока — столько же, сколько у прежней наклейки, с картинкой она или без: раскладка всего пятна и шкафчика
  // остаётся той же, что была (куратор, пачка 52, противоречие 327: «оставить такими же»).
  if (tile >= 0) {
    // Картинка: квадрат плитки вписан в контур наклейки по большей стороне; веером от середины — для звезды и для остальных.
    const t = stickerUv(tile);
    const ext = Math.max(...sh.raw.map(([a, b]) => Math.max(Math.abs(a), Math.abs(b))), 1e-6);
    const uvOf = ([a, b]: readonly [number, number]): [number, number] => [t.u0 + (a / ext / 2 + 0.5) * (t.u1 - t.u0), t.v0 + (b / ext / 2 + 0.5) * (t.v1 - t.v0)];
    // Старая наклейка чуть выцвела: тон гуляет на несколько процентов (от номера наклейки, мимо общего потока).
    const h = Math.abs(Math.sin(i * 12.9898 + u * 78.233 + v * 37.719) * 43758.5453) % 1;
    const fade = 0.9 + h * 0.12;
    const tint: V = [fade, fade, fade * (0.96 + h * 0.04)];
    const c = planePt(pl, u, v, lvl + 1);
    const mid = uvOf([0, 0]);
    for (let k = 0; k < sh.pts.length; k++) {
      const a = sh.pts[k]!;
      const b = sh.pts[(k + 1) % sh.pts.length]!;
      triUv(xf, c, planePt(pl, u + a[0], v + a[1], lvl + 1), planePt(pl, u + b[0], v + b[1], lvl + 1), pl.n, MAT.print, tint, mid, uvOf(sh.raw[k]!), uvOf(sh.raw[(k + 1) % sh.raw.length]!));
    }
  } else emit(sh.pts, lvl + 1, paint.mat, bodyTint);
  // Тёмные «строки» — 2–3 полоски без смысла; у звёзд их нет, у наклейки с картинкой — тоже (числа на них всё равно берутся).
  if (!star && rnd() < 0.34) {
    const cnt = 2 + Math.floor(rnd() * 2);
    const hw = size * (0.18 + rnd() * 0.1);
    for (let k = 0; k < cnt; k++) {
      const off = (k - (cnt - 1) / 2) * 0.011;
      const w = hw * (0.6 + rnd() * 0.4);
      const R = (x: number, y: number): [number, number] => [x * Math.cos(al) - (y + off) * Math.sin(al), x * Math.sin(al) + (y + off) * Math.cos(al)];
      const shade = tn([1, 1, 1], 0.9 + rnd() * 0.2);
      if (tile >= 0) continue;
      const q = [R(-w, -0.0022), R(w, -0.0022), R(w, 0.0022), R(-w, 0.0022)].map(([a, b]) => planePt(pl, u + a, v + b, lvl + 2));
      quad(xf, q[0]!, q[1]!, q[2]!, q[3]!, pl.n, MAT.rubber, shade);
    }
  }
}

/** Росчерк маркером: ломаная из 3–5 тонких тёмных прямоугольников шириной 6–10 мм поверх всего. */
function marker(xf: Xf, rnd: Rnd, pl: Plane, s: number): void {
  const segs = 3 + Math.floor(rnd() * 3);
  const w = 0.006 + rnd() * 0.004;
  const [u0, v0, u1, v1] = pl.rect;
  let p: [number, number] = [u0 + (u1 - u0) * (0.15 + rnd() * 0.7), v0 + (v1 - v0) * (0.15 + rnd() * 0.7)];
  let ang = rnd() * Math.PI * 2;
  const base = pl.maxTop + 1 + s * 2;
  for (let i = 0; i < segs; i++) {
    ang += (rnd() - 0.5) * 2.2;
    const step = 0.06 + rnd() * 0.08;
    const q: [number, number] = [clamp(p[0] + Math.cos(ang) * step, u0, u1), clamp(p[1] + Math.sin(ang) * step, v0, v1)];
    const d = norm([q[0] - p[0], q[1] - p[1], 0]);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.01) {
      const nx = -d[1] * (w / 2);
      const ny = d[0] * (w / 2);
      const ex = d[0] * (w / 2);
      const ey = d[1] * (w / 2);
      const l = base + (i % 2);
      const c = [
        [p[0] - ex + nx, p[1] - ey + ny],
        [q[0] + ex + nx, q[1] + ey + ny],
        [q[0] + ex - nx, q[1] + ey - ny],
        [p[0] - ex - nx, p[1] - ey - ny],
      ].map(([a, b]) => planePt(pl, a!, b!, l));
      quad(xf, c[0]!, c[1]!, c[2]!, c[3]!, pl.n, MAT.rubber, tn([1, 1, 1], 0.85 + rnd() * 0.2));
    }
    p = q;
  }
  pl.maxTop = Math.max(pl.maxTop, base + 1);
}

/** Раскладка центров по сетке с разбросом: ровнее, чем чистый случай; порядок перемешан. */
function gridSpots(rnd: Rnd, n: number, rect: readonly [number, number, number, number]): [number, number][] {
  const [u0, v0, u1, v1] = rect;
  const W = u1 - u0;
  const H = v1 - v0;
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * W) / H)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push([u0 + ((c + 0.5 + (rnd() - 0.5) * 0.9) / cols) * W, v0 + ((r + 0.5 + (rnd() - 0.5) * 0.9) / rows) * H]);
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  return cells.slice(0, n);
}

const stickerSize = (rnd: Rnd): number => 0.03 + Math.pow(rnd(), 0.7) * 0.08;

function stickerBox(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const red = rnd() < 0.6;
  const mat = red ? MAT.paintRed : MAT.metalGrey;
  const body: V = red ? [1.25, 1.3, 1.2] : [1, 1, 1];
  const door: V = red ? [1.15, 1.2, 1.1] : [1.08, 1.08, 1.08];
  // Корпус, дверца с рамкой, ручка-скоба.
  xf.box([-0.31, 0, 0], [0.31, 0.82, 0.18], mat, { bevel: 0.008, tint: body, aoBottom: 0.7 });
  xf.box([-0.285, 0.035, 0.18], [0.285, 0.785, 0.19], mat, { tint: door });
  const fr = 0.018;
  xf.box([-0.285, 0.035, 0.19], [0.285, 0.035 + fr, 0.196], mat, { tint: body });
  xf.box([-0.285, 0.785 - fr, 0.19], [0.285, 0.785, 0.196], mat, { tint: body });
  xf.box([-0.285, 0.035 + fr, 0.19], [-0.285 + fr, 0.785 - fr, 0.196], mat, { tint: body });
  xf.box([0.285 - fr, 0.035 + fr, 0.19], [0.285, 0.785 - fr, 0.196], mat, { tint: body });
  const hk: V = [0.8, 0.8, 0.82];
  xf.box([0.212, 0.38, 0.19], [0.228, 0.396, 0.214], MAT.steel, { tint: hk });
  xf.box([0.212, 0.544, 0.19], [0.228, 0.56, 0.214], MAT.steel, { tint: hk });
  xf.box([0.212, 0.38, 0.214], [0.228, 0.56, 0.23], MAT.steel, { tint: hk });
  xf.collider([-0.31, 0, 0], [0.31, 0.82, 0.2]);

  const front: Plane = { o: [0, 0, 0.196], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], rect: [-0.29, 0.04, 0.29, 0.78], layers: [], maxTop: -1 };
  const right: Plane = { o: [0.31, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0], rect: [0.015, 0.03, 0.165, 0.79], layers: [], maxTop: -1 };
  const left: Plane = { o: [-0.31, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0], rect: [0.015, 0.03, 0.165, 0.79], layers: [], maxTop: -1 };
  // Несколько мест у ручки пропускаются, поэтому заказ чуть больше: на деле ложится 70–90.
  const total = 75 + Math.floor(rnd() * 16);
  const nFront = Math.round(total * 0.7);
  const nSide = Math.floor((total - nFront) / 2);
  const jobs: { pl: Plane; spots: [number, number][] }[] = [
    { pl: front, spots: gridSpots(rnd, nFront, front.rect) },
    { pl: right, spots: gridSpots(rnd, nSide, right.rect) },
    { pl: left, spots: gridSpots(rnd, nSide, left.rect) },
  ];
  const t0 = xf.mb.triangleCount;
  let i = 0;
  const deck = stickerDeck(seed);
  // Сначала грани наклеек идут порознь по плоскостям, но очередь общая: бюджет не должен достаться одной стороне.
  const longest = Math.max(...jobs.map((j) => j.spots.length));
  for (let k = 0; k < longest; k++) {
    for (const j of jobs) {
      const s = j.spots[k];
      if (!s) continue;
      if (xf.mb.triangleCount - t0 > 770) continue;
      const size = stickerSize(rnd);
      const [u0, v0, u1, v1] = j.pl.rect;
      const u = clamp(s[0], u0 + size * 0.35, u1 - size * 0.35);
      const v = clamp(s[1], v0 + size * 0.35, v1 - size * 0.35);
      // Ручка остаётся на виду.
      if (j.pl === front && u > 0.17 && u < 0.27 && v > 0.33 && v < 0.6) continue;
      sticker(xf, rnd, j.pl, i++, u, v, size, deck());
    }
  }
  const strokes = 3 + Math.floor(rnd() * 2);
  for (let s = 0; s < strokes; s++) marker(xf, rnd, front, s);
}

function stickerPatch(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const pl: Plane = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], rect: [-0.4, 0.08, 0.4, 0.92], layers: [], maxTop: -1 };
  const n = 35 + Math.floor(rnd() * 16);
  const ph = rnd() * 6.28;
  const t0 = xf.mb.triangleCount;
  const deck = stickerDeck(seed);
  for (let i = 0; i < n; i++) {
    if (xf.mb.triangleCount - t0 > 430) break;
    // Пятно неровное и гуще к середине: радиус берётся «в линию», а не «по площади».
    const th = rnd() * Math.PI * 2;
    const rho = rnd() * (1 + 0.2 * Math.sin(3 * th + ph));
    // На голой стене наклейки крупнее, чем на шкафчике: издали гроздь должна читаться пятном.
    const size = stickerSize(rnd) * 1.6;
    const u = clamp(Math.cos(th) * rho * 0.34, -0.45 + size * 0.4, 0.45 - size * 0.4);
    const v = clamp(0.5 + Math.sin(th) * rho * 0.38, size * 0.4, 1 - size * 0.4);
    sticker(xf, rnd, pl, i, u, v, size, deck());
  }
  // Одна — у самого низа пятна: отклеилась и сползла.
  sticker(xf, rnd, pl, n, (rnd() - 0.5) * 0.4, 0.045, 0.085, deck());
  const strokes = 2 + Math.floor(rnd() * 2);
  for (let s = 0; s < strokes; s++) marker(xf, rnd, pl, s);
}

// ───────────────────────────── реестр ─────────────────────────────

export const CRAFT_PROPS: Record<string, PropSpec> = {
  paper_flower: { w: 1.0, d: 1.0, h: 2.1, mount: 'free', ru: 'огромный бумажный цветок-поделка на стебле', build: (xf, seed) => rooted(xf, 2.1, 0.5, () => paperFlower(xf, seed)) },
  paper_flower_bed: { w: 2.2, d: 1.4, h: 2.3, mount: 'free', ru: 'клумба из бумажных цветов на мятой кочке', build: (xf, seed) => rooted(xf, 2.3, 0.45, () => paperFlowerBed(xf, seed)) },
  paper_flower_hang: { w: 1.3, d: 1.3, h: 1.2, mount: 'ceiling', ru: 'бумажный цветок головкой вниз на двух нитях', build: (xf, seed) => hung(xf, 1.2, 1, () => paperFlowerHang(xf, seed)) },
  mound_small: { w: 1.0, d: 1.0, h: 0.55, mount: 'free', ru: 'кучка слипшихся комков со свечами', build: (xf, seed) => mound(xf, seed, MOUND_CFG.mound_small!) },
  mound: { w: 2.0, d: 2.0, h: 1.15, mount: 'free', ru: 'гора из комков со свечами за оградкой', build: (xf, seed) => mound(xf, seed, MOUND_CFG.mound!) },
  mound_big: { w: 3.0, d: 3.0, h: 1.7, mount: 'free', ru: 'большая гора из комков со свечами за оградкой', build: (xf, seed) => mound(xf, seed, MOUND_CFG.mound_big!) },
  thicket: { w: 2.4, d: 1.4, h: 2.5, mount: 'free', ru: 'завал из перекрещённых жердей с белыми обмотками', build: thicket },
  sticker_box: { w: 0.62, d: 0.2, h: 0.82, mount: 'wall', y: 0.95, ru: 'настенный шкафчик, сплошь заклеенный наклейками', build: stickerBox },
  sticker_patch: { w: 0.9, d: 0.02, h: 1.0, mount: 'wall', y: 0.9, ru: 'гроздь наклеек и росчерков маркером прямо на стене', build: stickerPatch },
};

// ───────────────────────────── бумажная птица и перо ─────────────────────────────

/** Бумажная птица-оригами: острые листы под углом; нить от потолка (y = 0) к спине. Центр тела — на depth ниже потолка. */
function paperBirdBody(xf: Xf, rnd: Rnd, depth: number): void {
  const paper: V = [1.3, 1.27, 1.15];
  const col = GOUACHE[Math.floor(rnd() * GOUACHE.length)]!.main;
  const cy = -depth;
  const P = (x: number, y: number, z: number): V => [x, cy + y, z];
  const side: V = [1, 0, 0];
  const up: V = [0, 1, 0];
  // Тело — вертикальный клин из двух листов, клюв и хвост — острые треугольники.
  tri2(xf, P(0, 0.01, 0.15), P(0, 0.05, -0.02), P(0, -0.04, -0.02), side, MAT.paper, wob(rnd, paper));
  tri2(xf, P(0, 0.05, -0.02), P(0, 0.0, -0.14), P(0, -0.04, -0.02), side, MAT.paper, wob(rnd, paper));
  tri2(xf, P(0, 0.03, 0.13), P(0, -0.012, 0.13), P(0, 0.0, 0.24), side, MAT.paper, wob(rnd, paper, 0.05));
  tri2(xf, P(0, 0.03, -0.1), P(0, 0.08, -0.2), P(0, 0.0, -0.2), side, MAT.paper, wob(rnd, paper));
  // Крылья — два треугольника под небольшим углом вверх; одно крыло цветное.
  for (const s of [1, -1]) {
    const tone = s > 0 ? wob(rnd, paper) : tn(col, 1 + (rnd() - 0.5) * 0.1);
    tri2(xf, P(0, 0.045, 0.07), P(0, 0.045, -0.09), P(s * 0.22, 0.1, -0.03), up, MAT.paper, tone);
    tri2(xf, P(0, 0.04, 0.0), P(0, 0.04, -0.07), P(s * 0.11, 0.08, -0.1), up, MAT.paper, wob(rnd, tone, 0.06));
  }
  // Нить: от потолка к спине.
  tube(xf, [[0, 0, 0], P(0, 0.05, -0.02)], [0.004, 0.004], { seg: 4, mat: MAT.paper, tint: [1.45, 1.4, 1.2] });
}

function paperBirdHang(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const depth = 0.6 + rnd() * 0.35;
  // Подвесное стоит от стены: z от 0 до d, поэтому птица — на полглубины вперёд.
  paperBirdBody(xf.child(0, 0, 0.25), rnd, depth);
}

/** Перо на полу: стержень-полоска и по 3–4 бородки с каждой стороны, слегка приподнятые; поворот в плане — от сида. */
function feather(xf: Xf, seed: number): void {
  const rnd = rng(seed);
  const a = (rnd() - 0.5) * 1.0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const R = (x: number, y: number, z: number): V => [x * ca + z * sa, y, -x * sa + z * ca];
  const up: V = [0, 1, 0];
  const L = 0.095;
  // Стержень: узкая полоска вдоль x.
  const rw = 0.0025;
  tri2(xf, R(-L, 0.004, -rw), R(L, 0.004, -rw), R(L, 0.004, rw), up, MAT.paper, [1.1, 1.08, 1.0]);
  tri2(xf, R(-L, 0.004, -rw), R(L, 0.004, rw), R(-L, 0.004, rw), up, MAT.paper, [1.1, 1.08, 1.0]);
  // Бородки: от основания к кончику опахало шире, у конца сходится.
  const n = 4;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x0 = -0.03 + t * 0.115;
    const wid = 0.03 * Math.sin(Math.PI * (0.15 + 0.8 * t)) * (0.85 + rnd() * 0.3);
    const tint = lerp([0.95, 0.96, 1.0], [0.7, 0.72, 0.78], t);
    for (const s of [1, -1]) {
      const y1 = 0.012 + rnd() * 0.006;
      tri2(xf, R(x0, 0.004, s * rw), R(x0 + 0.03, 0.004, s * rw), R(x0 + 0.018, y1, s * wid), up, MAT.paper, wob(rnd, tint, 0.05));
    }
  }
}

/** Предметы-гости с птицей; в общий список (props_all.ts) входят отдельно от CRAFT_PROPS. */
export const BIRD_PROPS: Record<string, PropSpec> = {
  paper_bird_hang: { w: 0.5, d: 0.5, h: 1.0, mount: 'ceiling', ru: 'бумажная птица на нитке', build: (xf, seed) => hung(xf, 1.0, 1, () => paperBirdHang(xf, seed)) },
  feather: { w: 0.2, d: 0.08, h: 0.02, mount: 'free', ru: 'перо на полу', build: feather },
};
