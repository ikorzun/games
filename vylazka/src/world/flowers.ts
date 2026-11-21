/**
 * Цветы оранжереи (партнёр 19.11, 18:04: «нужна комната полностью с цветами, словно оранжерея или теплица»; квиз: «Цветы кодом,
 * остальное из библиотеки», «Поворачиваются за лучом»). Виды — те, что росли в советских теплицах и на подоконниках: гвоздика и
 * хризантема (их растили к праздникам и к похоронам), тюльпан, герань и фиалка, калла; из зелени — папоротник, традесканция,
 * монстера (docs/vylazka/_research/greenhouse.md).
 *
 * Цветок — две части:
 *  - стебель и листья ложатся в сетку помещения (plant): они стоят, распадаются и стираются вместе с местом, как вся обстановка;
 *  - головка — отдельная вещь рендера (headForm), её ставят много раз, и каждая смотрит, куда ей велят (systems/flowers.ts):
 *    на свет фонаря, а в светлых местах — на того, кто смотрит. В темноте головка закрывается: рендер сжимает её поперёк оси.
 *
 * Головка строится в своей рамке: начало — верх стебля, ось +y — куда цветок смотрит. Лепестки и листья тонкие — обе стороны,
 * материал бумаги: на просвет фонаря они светятся своим цветом (render/shaders.ts, «просвет»). Чистый TS, без three.js.
 */
import { mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import type { Xf } from './props';

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(v: V): V {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}
/** Повернуть v вокруг единичной оси k на угол a (формула Родрига). */
function rot(v: V, k: V, a: number): V {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
/** Базис плоскости, перпендикулярной оси. */
function basis(a: V): [V, V] {
  const ref: V = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n = norm(cross(ref, a));
  return [n, cross(a, n)];
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Цвет бумаги (sRGB) — тон вершины считается от него: во сколько раз цвет цветка ярче или темнее по каждому каналу. */
const PAPER: V = [0.784, 0.757, 0.655];
const ENAMEL: V = [0.851, 0.851, 0.816];
function tone(hex: string, base: V = PAPER): V {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255 / base[0], ((n >> 8) & 255) / 255 / base[1], (n & 255) / 255 / base[2]];
}
const shade = (t: V, k: number): V => [t[0] * k, t[1] * k, t[2] * k];

/**
 * Куда пишется геометрия: в сетку помещения через Xf (стебли) или в сетку головки (локально). Точка и направление переводятся
 * один раз, здесь: поворот растения вокруг вертикали (yaw) и место в помещении.
 */
interface Out {
  mb: MeshBuilder;
  p: (v: V) => V;
  d: (v: V) => V;
}
const localOut = (mb: MeshBuilder): Out => ({ mb, p: (v) => v, d: (v) => v });
function xfOut(xf: Xf, at: V, yaw: number): Out {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const r = (v: V): V => [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
  return {
    mb: xf.mb,
    p: (v) => {
      const q = r(v);
      return xf.pt(at[0] + q[0], at[1] + q[1], at[2] + q[2]);
    },
    d: (v) => {
      const q = r(v);
      return xf.dir(q[0], q[1], q[2]);
    },
  };
}

/** Подробность: 1 — ближняя головка, LOD_FAR — дальняя (граней меньше, очертания те же). */
let DETAIL = 1;
export const LOD_FAR = 0.55;
const S = (n: number): number => Math.max(2, Math.round(n * DETAIL));

/**
 * Тонкая поверхность (лепесток, лист) по сетке f(u, v): u — вдоль, 0..1, v — поперёк, −1..1. Обе стороны: у лицевой тон tint(u),
 * у изнанки — back(u) (у традесканции изнанка лиловая). Нормали — по соседним точкам; обход сверяется с нормалью.
 */
function sheet(o: Out, f: (u: number, v: number) => V, nu: number, nv: number, mat: number, tint: (u: number) => V, back?: (u: number) => V, ao: (u: number) => number = () => 1): void {
  const P: V[][] = [];
  for (let i = 0; i <= nu; i++) {
    const row: V[] = [];
    for (let j = 0; j <= nv; j++) row.push(f(i / nu, -1 + (2 * j) / nv));
    P.push(row);
  }
  const N: V[][] = P.map((row, i) =>
    row.map((_, j) => {
      const du = sub(P[Math.min(nu, i + 1)]![j]!, P[Math.max(0, i - 1)]![j]!);
      const dv = sub(P[i]![Math.min(nv, j + 1)]!, P[i]![Math.max(0, j - 1)]!);
      return norm(cross(du, dv));
    }),
  );
  const mb = o.mb;
  const side = (sign: 1 | -1, tn: (u: number) => V): void => {
    const id: number[][] = P.map((row, i) => row.map((p, j) => mb.vertex(o.p(p), o.d(mul(N[i]![j]!, sign)), mat, tn(i / nu), ao(i / nu))));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = P[i]![j]!;
        const b = P[i + 1]![j]!;
        const c = P[i + 1]![j + 1]!;
        const face = cross(sub(b, a), sub(c, a));
        const want = mul(add(N[i]![j]!, N[i + 1]![j + 1]!), sign);
        const [ia, ib, ic, id2] = [id[i]![j]!, id[i + 1]![j]!, id[i + 1]![j + 1]!, id[i]![j + 1]!];
        if (dot(face, want) >= 0) {
          mb.tri(ia, ib, ic);
          mb.tri(ia, ic, id2);
        } else {
          mb.tri(ia, ic, ib);
          mb.tri(ia, id2, ic);
        }
      }
    }
  };
  side(1, tint);
  side(-1, back ?? tint);
}

/** Трубка вдоль ломаной (стебель, черешок, цветонос): радиус по доле длины, рамка кольца переносится без перекрута. */
function tube(o: Out, path: readonly V[], radius: (t: number) => number, seg: number, mat: number, tint: (t: number) => V, ao: (t: number) => number = () => 1): void {
  const n = path.length;
  if (n < 2) return;
  const tang = path.map((_, i) => norm(sub(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!)));
  let [nx] = basis(tang[0]!);
  const ids: number[][] = [];
  const mb = o.mb;
  for (let i = 0; i < n; i++) {
    const t = tang[i]!;
    nx = norm(sub(nx, mul(t, dot(nx, t))));
    const bx = cross(t, nx);
    const u = i / (n - 1);
    const r = radius(u);
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const dir = add(mul(nx, Math.cos(a)), mul(bx, Math.sin(a)));
      row.push(mb.vertex(o.p(add(path[i]!, mul(dir, r))), o.d(dir), mat, tint(u), ao(u)));
    }
    ids.push(row);
  }
  for (let i = 0; i + 1 < n; i++) {
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg;
      // Обход наружу: кольцо идёт против часовой, если смотреть с конца трубки.
      mb.tri(ids[i]![j]!, ids[i + 1]![j]!, ids[i + 1]![k]!);
      mb.tri(ids[i]![j]!, ids[i + 1]![k]!, ids[i]![k]!);
    }
  }
}

/** Кубическая кривая Безье: n отрезков. */
function bezier(p0: V, p1: V, p2: V, p3: V, n: number): V[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return add(add(mul(p0, u * u * u), mul(p1, 3 * u * u * t)), add(mul(p2, 3 * u * t * t), mul(p3, t * t * t)));
  });
}

/**
 * Лепесток или лист от точки base: out — направление длины, wide — поперёк, face — лицо (out × wide). Профиль ширины prof(u),
 * cup — ложбинка поперёк (лист сложен по жилке, лепесток — ложечкой), bend — насколько загибается к концу (рад, вокруг wide:
 * плюс — к лицу), fringe — зубчики по краю (гвоздика), droop — провисание вниз к концу (м).
 */
interface LeafSpec {
  base: V;
  out: V;
  wide: V;
  len: number;
  width: number;
  prof: (u: number) => number;
  cup?: number;
  bend?: number;
  fringe?: number;
  droop?: number;
  nu?: number;
  nv?: number;
}
function leaf(o: Out, s: LeafSpec, mat: number, tint: (u: number) => V, back?: (u: number) => V): void {
  const out = norm(s.out);
  const wide = norm(sub(s.wide, mul(out, dot(s.wide, out))));
  const face = cross(out, wide);
  const nu = s.nu ?? S(5);
  const nv = s.nv ?? 2;
  const pts: V[] = [s.base];
  const dirs: V[] = [out];
  // Ось листа загибается понемногу на каждом шаге: к концу — на bend.
  for (let i = 1; i <= nu; i++) {
    const t = i / nu;
    const d = rot(out, wide, -(s.bend ?? 0) * t);
    pts.push(add(add(pts[i - 1]!, mul(d, s.len / nu)), [0, -(s.droop ?? 0) * (t * t - ((i - 1) / nu) ** 2), 0]));
    dirs.push(d);
  }
  sheet(
    o,
    (u, v) => {
      const i = Math.min(nu, Math.round(u * nu));
      const c = pts[i]!;
      const w = (s.width / 2) * s.prof(u);
      const lift = (s.cup ?? 0) * v * v * s.width * 0.35 * s.prof(u);
      // Зубчики: крайний ряд — через точку длиннее и короче.
      const j = Math.round(((v + 1) * nv) / 2);
      const tip = s.fringe && i === nu ? mul(dirs[i]!, j % 2 === 0 ? s.fringe : -s.fringe * 0.6) : ([0, 0, 0] as V);
      return add(add(add(c, mul(wide, v * w)), mul(face, lift)), tip);
    },
    nu,
    nv,
    mat,
    tint,
    back,
  );
}

// ── Головки (локально: начало — верх стебля, +y — куда цветок смотрит) ──

/** Чашечка: короткая зелёная трубка под венчиком. */
function calyx(o: Out, h: number, r0: number, r1: number, tint: V): void {
  tube(o, [[0, -h, 0], [0, -h * 0.5, 0], [0, 0, 0]], (t) => lerp(r0, r1, t), S(7), MAT.paper, () => tint, (t) => 0.7 + 0.3 * t);
}

/** Мутовка лепестков: n штук по кругу, каждый от радиуса r0 наклонён от оси на tilt. */
function whorl(o: Out, n: number, phase: number, r0: number, y0: number, tilt: number, spec: Omit<LeafSpec, 'base' | 'out' | 'wide'>, tint: (u: number) => V, rnd: () => number, jitter = 0.12): void {
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2 + (rnd() - 0.5) * jitter;
    const radial: V = [Math.cos(a), 0, Math.sin(a)];
    const t = tilt + (rnd() - 0.5) * jitter;
    const out: V = add(mul(radial, Math.sin(t)), [0, Math.cos(t), 0]);
    const wide: V = [-Math.sin(a), 0, Math.cos(a)];
    leaf(o, { ...spec, base: add(mul(radial, r0), [0, y0, 0]), out, wide, len: spec.len * (0.92 + rnd() * 0.16) }, MAT.paper, tint);
  }
}

/** Цвет головки по имени — тон бумаги; к основанию лепестка чуть темнее. */
const petalTint = (hex: string, deep = 0.78): ((u: number) => V) => {
  const t = tone(hex);
  return (u) => shade(t, lerp(deep, 1, Math.min(1, u * 1.6)));
};

function carnationHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.028, 0.008, 0.0105, tone('#6f8f7a'));
  const fr = { prof: (u: number) => 0.45 + 0.55 * Math.sin(Math.min(1, u * 1.1) * Math.PI * 0.62), cup: 0.5, bend: -0.5, fringe: 0.003, width: 0.017, nu: 2, nv: DETAIL < 1 ? 2 : 3 };
  const layers = DETAIL < 1 ? [[8, 0.5, 0.027], [7, 1.25, 0.024]] : [[8, 0.38, 0.026], [8, 0.85, 0.028], [7, 1.3, 0.023]];
  layers.forEach(([n, tilt, len], li) => whorl(o, n!, li * 0.37, 0.004, 0.002 * li, tilt!, { ...fr, len: len! }, petalTint(hex, 0.7 + li * 0.08), rnd));
}

function chrysanthemumHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.012, 0.009, 0.012, tone('#3f6b34'));
  // Середина — плотный бугорок из коротких лепестков.
  const rings = DETAIL < 1 ? 3 : 4;
  for (let k = 0; k < rings; k++) {
    const f = k / (rings - 1);
    const n = Math.round(lerp(8, 17, f) * (DETAIL < 1 ? 0.85 : 1));
    whorl(o, n, k * 0.29, lerp(0.002, 0.006, f), lerp(0.014, 0.002, f), lerp(0.2, 1.45, f), { len: lerp(0.02, 0.034, f), width: 0.0062, prof: (u) => 0.55 + 0.45 * Math.sin(u * Math.PI * 0.8), bend: lerp(-0.6, 0.35, f), nu: DETAIL < 1 ? 2 : 3, nv: 1 }, petalTint(hex, 0.8), rnd, 0.2);
  }
}

function tulipHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.006, 0.0045, 0.0065, tone('#5f7f50'));
  const spec = { len: 0.056, width: 0.036, prof: (u: number) => Math.pow(Math.sin(lerp(0.12, 1, u) * Math.PI), 0.65), cup: 1.25, bend: 0.32, nu: S(6) };
  whorl(o, 3, 0, 0.005, 0, 0.2, spec, petalTint(hex, 0.62), rnd, 0.08);
  whorl(o, 3, Math.PI / 3, 0.003, 0.001, 0.12, { ...spec, width: 0.033 }, petalTint(hex, 0.55), rnd, 0.08);
}

/** Маленький цветок из пяти лепестков (герань, фиалка): от точки at смотрит по dir. */
function floret(o: Out, at: V, dir: V, r: number, hex: string, eye: string | null, rnd: () => number, uneven = 0): void {
  const [a, b] = basis(norm(dir));
  const t = petalTint(hex, 0.85);
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2 + rnd() * 0.3;
    const radial = add(mul(a, Math.cos(ang)), mul(b, Math.sin(ang)));
    // Фиалка: два верхних лепестка меньше трёх нижних.
    const k2 = uneven > 0 && Math.sin(ang) > 0.2 ? 1 - uneven : 1;
    leaf(o, { base: add(at, mul(radial, r * 0.12)), out: add(mul(radial, 0.92), mul(norm(dir), 0.38)), wide: cross(norm(dir), radial), len: r * k2, width: r * 0.9 * k2, prof: (u) => Math.pow(Math.sin(lerp(0.15, 0.9, u) * Math.PI), 0.7), bend: -0.25, nu: 2, nv: 1 }, MAT.paper, t);
  }
  if (eye) tube(o, [at, add(at, mul(norm(dir), r * 0.35))], () => r * 0.16, 4, MAT.paper, () => tone(eye));
}

function geraniumHead(o: Out, hex: string, rnd: () => number): void {
  // Зонтик: 10–12 цветков на цветоножках, шаром.
  const n = DETAIL < 1 ? 6 : 11;
  const green = tone('#5a7d43');
  for (let k = 0; k < n; k++) {
    const y = 1 - (k + 0.5) / n;
    const rr = Math.sqrt(1 - y * y);
    const a = k * 2.39996;
    const dir = norm([Math.cos(a) * rr, y * 0.9 + 0.25, Math.sin(a) * rr]);
    const len = 0.022 + rnd() * 0.012;
    const tip = mul(dir, len);
    tube(o, [[0, 0, 0], mul(dir, len * 0.5), tip], () => 0.0012, 3, MAT.paper, () => green);
    floret(o, tip, dir, 0.011, hex, null, rnd);
  }
}

function violetHead(o: Out, hex: string, rnd: () => number): void {
  const n = DETAIL < 1 ? 3 : 4;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd() * 0.5;
    const dir = norm([Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55]);
    const at = mul(dir, 0.012 + rnd() * 0.01);
    tube(o, [[0, 0, 0], at], () => 0.0012, 3, MAT.paper, () => tone('#4f6b3a'));
    floret(o, at, dir, 0.0095, hex, '#e8c22a', rnd, 0.3);
  }
}

function callaHead(o: Out, hex: string, _rnd: () => number): void {
  // Покрывало: лист, свёрнутый воронкой почти по кругу, с отогнутой губой и острым кончиком спереди.
  const t = petalTint(hex, 0.86);
  const nu = S(7);
  const nv = S(10);
  sheet(
    o,
    (u, v) => {
      const th = v * 2.55;
      const r = 0.005 + 0.032 * Math.pow(u, 1.35) + 0.012 * Math.pow(u, 4) * (1 - Math.cos(th)) * 0.5;
      const lip = Math.pow(u, 3) * Math.pow(Math.cos(th / 2), 6);
      return [Math.sin(th) * r, 0.105 * u + 0.035 * lip, -Math.cos(th) * r + 0.012 * lip];
    },
    nu,
    nv,
    MAT.paper,
    t,
  );
  tube(o, [[0, 0, 0], [0, 0.03, 0.002], [0, 0.058, 0.004]], (u) => lerp(0.0042, 0.0028, u), 6, MAT.paper, () => tone('#e8bd2a'));
}

// ── Новые виды (партнёр 19.11, 21:27: «Больше разных цветов и растений в оранжерею и в другие помещения») ──

/** Пион: тяжёлый шар из чашевидных лепестков — внутри мельче и теснее, снаружи шире и отогнуты. */
function peonyHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.01, 0.01, 0.014, tone('#4a6a35'));
  const rings = DETAIL < 1 ? 3 : 4;
  for (let k = 0; k < rings; k++) {
    const f = k / (rings - 1);
    const n = Math.round(lerp(6, 12, f) * (DETAIL < 1 ? 0.8 : 1));
    const outer = k === rings - 1;
    whorl(o, n, k * 0.53, lerp(0.002, 0.009, f), lerp(0.024, 0.002, f), lerp(0.25, 1.2, f), { len: lerp(0.026, 0.044, f), width: lerp(0.024, 0.036, f), prof: (u: number) => Math.pow(Math.sin(lerp(0.15, 1, u) * Math.PI), 0.55), cup: lerp(1.3, 0.9, f), bend: lerp(0.55, -0.15, f), nu: DETAIL < 1 ? 2 : 3, nv: outer ? 2 : 1 }, petalTint(hex, lerp(0.76, 0.9, f)), rnd, 0.25);
  }
}

/** Мак: четыре тонких, как бумага, лепестка чашей; у основания — чёрное пятно; посередине коробочка и тёмные тычинки. */
function poppyHead(o: Out, hex: string, rnd: () => number): void {
  const base = tone(hex);
  const blotch = tone('#1d1414');
  const t = (u: number): V => (u < 0.2 ? blotch : shade(base, lerp(0.82, 1, u)));
  const spec = { len: 0.05, width: 0.058, prof: (u: number) => Math.pow(Math.sin(lerp(0.22, 0.96, u) * Math.PI), 0.5), cup: 0.9, bend: 0.28, nu: S(4), nv: S(3) };
  whorl(o, 2, 0, 0.004, 0, 0.75, spec, t, rnd, 0.1);
  whorl(o, 2, Math.PI / 2, 0.003, 0.002, 0.62, { ...spec, width: 0.054 }, t, rnd, 0.1);
  tube(o, [[0, 0, 0], [0, 0.011, 0], [0, 0.017, 0]], (u) => lerp(0.0058, 0.0052, u), 6, MAT.paper, () => tone('#6d8a55'));
  whorl(o, DETAIL < 1 ? 8 : 14, 0.1, 0.0065, 0.004, 0.9, { len: 0.009, width: 0.0022, prof: () => 1, nu: 1, nv: 1 }, () => blotch, rnd, 0.3);
}

/** Ромашка: белые узкие язычки кругом и жёлтая середина бугорком. */
function daisyHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.004, 0.006, 0.008, tone('#4d7a3a'));
  const n = DETAIL < 1 ? 14 : 22;
  whorl(o, n, 0, 0.007, 0.001, 1.45, { len: 0.026, width: 0.0065, prof: (u: number) => Math.pow(Math.sin(lerp(0.1, 0.9, u) * Math.PI), 0.5), bend: -0.15, nu: 2, nv: 1 }, petalTint(hex, 0.92), rnd, 0.12);
  sheet(
    o,
    (u, v) => {
      const th = v * Math.PI;
      const r = 0.0088 * u;
      return [Math.cos(th) * r, 0.0065 * (1 - u * u) + 0.001, Math.sin(th) * r];
    },
    S(3),
    S(10),
    MAT.paper,
    (u) => shade(tone('#e8b820'), lerp(0.85, 1.05, u)),
  );
}

/** Ирис: три лепестка вверх, три — вниз и наружу, с жёлтой «бородкой» у основания. */
function irisHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.012, 0.005, 0.007, tone('#4f6f45'));
  const falls = petalTint(hex, 0.62);
  whorl(o, 3, 0, 0.004, 0.004, 1.35, { len: 0.055, width: 0.03, prof: (u: number) => Math.pow(Math.sin(lerp(0.12, 0.95, u) * Math.PI), 0.7), cup: -0.4, bend: -0.9, droop: 0.012, nu: S(5), nv: 2 }, falls, rnd, 0.08);
  whorl(o, 3, Math.PI / 3, 0.003, 0.006, 0.32, { len: 0.05, width: 0.026, prof: (u: number) => Math.pow(Math.sin(lerp(0.12, 0.95, u) * Math.PI), 0.7), cup: 0.8, bend: 0.35, nu: S(4), nv: 2 }, petalTint(hex, 0.85), rnd, 0.08);
  whorl(o, 3, 0.05, 0.005, 0.006, 1.1, { len: 0.016, width: 0.004, prof: () => 1, nu: 1, nv: 1 }, () => tone('#e9c23a'), rnd, 0.05);
}

/** Подсолнух: тёмный широкий диск и кольцо жёлтых язычков, за ними — зелёные прицветники. Он и правда поворачивается к свету. */
function sunflowerHead(o: Out, hex: string, rnd: () => number): void {
  sheet(
    o,
    (u, v) => {
      const th = v * Math.PI;
      const r = 0.05 * u;
      return [Math.cos(th) * r, 0.009 * (1 - u * u), Math.sin(th) * r];
    },
    S(3),
    S(14),
    MAT.paper,
    (u) => shade(tone('#4a2c14'), lerp(0.7, 1.15, u)),
  );
  whorl(o, DETAIL < 1 ? 16 : 24, 0, 0.048, 0.001, 1.5, { len: 0.045, width: 0.016, prof: (u: number) => Math.pow(Math.sin(lerp(0.1, 0.95, u) * Math.PI), 0.6), cup: 0.4, bend: -0.2, nu: 2, nv: 1 }, petalTint(hex, 0.85), rnd, 0.1);
  whorl(o, DETAIL < 1 ? 8 : 12, 0.13, 0.04, -0.006, 1.8, { len: 0.02, width: 0.012, prof: () => 1, nu: 1, nv: 1 }, () => tone('#3d6a2e'), rnd, 0.2);
}

/** Лилия: шесть длинных лепестков трубой и резко назад, тычинки торчат наружу. */
function lilyHead(o: Out, hex: string, rnd: () => number): void {
  calyx(o, 0.008, 0.004, 0.006, tone('#5c7a4a'));
  const spec = { len: 0.075, width: 0.022, prof: (u: number) => Math.pow(Math.sin(lerp(0.05, 1, u) * Math.PI), 0.6), cup: 0.7, bend: -1.4, droop: 0.008, nu: S(6), nv: 2 };
  whorl(o, 3, 0, 0.004, 0, 0.45, spec, petalTint(hex, 0.8), rnd, 0.1);
  whorl(o, 3, Math.PI / 3, 0.003, 0.002, 0.4, { ...spec, width: 0.02 }, petalTint(hex, 0.75), rnd, 0.1);
  const n = DETAIL < 1 ? 3 : 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3;
    const c = Math.cos(a);
    const z = Math.sin(a);
    tube(o, [[0, 0, 0], [c * 0.006, 0.03, z * 0.006], [c * 0.014, 0.056, z * 0.014]], () => 0.0009, 3, MAT.paper, () => tone('#d8d0a0'));
    tube(o, [[c * 0.014, 0.056, z * 0.014], [c * 0.017, 0.059, z * 0.017]], () => 0.0024, 3, MAT.paper, () => tone('#7a3a1a'));
  }
}

/** Головки: вид и цвет. Номер в этом списке — форма головки для рендера (systems/flowers.ts, render: setFlowers). */
export const HEADS = [
  { species: 'carnation', hex: '#a8162a', ru: 'гвоздика, красная' },
  { species: 'carnation', hex: '#ece6dc', ru: 'гвоздика, белая' },
  { species: 'carnation', hex: '#e08aa0', ru: 'гвоздика, розовая' },
  { species: 'chrysanthemum', hex: '#eee9dc', ru: 'хризантема, белая' },
  { species: 'chrysanthemum', hex: '#e2b22c', ru: 'хризантема, жёлтая' },
  { species: 'chrysanthemum', hex: '#b2622c', ru: 'хризантема, бронзовая' },
  { species: 'tulip', hex: '#c2102c', ru: 'тюльпан, красный' },
  { species: 'tulip', hex: '#efbe2c', ru: 'тюльпан, жёлтый' },
  { species: 'geranium', hex: '#d02828', ru: 'герань, алая' },
  { species: 'geranium', hex: '#e2588a', ru: 'герань, розовая' },
  { species: 'violet', hex: '#673a98', ru: 'фиалка' },
  { species: 'calla', hex: '#f1ede2', ru: 'калла' },
  // Новые (21:27) — в конце списка: номера прежних форм не меняются.
  { species: 'peony', hex: '#e9a9bb', ru: 'пион, розовый' },
  { species: 'peony', hex: '#8a1834', ru: 'пион, бордовый' },
  { species: 'poppy', hex: '#d32a1e', ru: 'мак' },
  { species: 'daisy', hex: '#f2efe6', ru: 'ромашка' },
  { species: 'iris', hex: '#4d3f94', ru: 'ирис' },
  { species: 'sunflower', hex: '#e7b417', ru: 'подсолнух' },
  { species: 'lily', hex: '#f1ebdf', ru: 'лилия, белая' },
  { species: 'lily', hex: '#e2712a', ru: 'лилия, оранжевая' },
] as const;
export type FlowerSpecies =
  | 'carnation'
  | 'chrysanthemum'
  | 'tulip'
  | 'geranium'
  | 'violet'
  | 'calla'
  | 'peony'
  | 'poppy'
  | 'daisy'
  | 'iris'
  | 'sunflower'
  | 'lily'
  | 'fern'
  | 'tradescantia'
  | 'monstera'
  | 'sansevieria'
  | 'aloe'
  | 'chlorophytum';
/** Виды с головкой — те, что поворачиваются к свету; зелень стоит как стоит. */
export const BLOOMS: readonly FlowerSpecies[] = ['carnation', 'chrysanthemum', 'tulip', 'geranium', 'violet', 'calla', 'peony', 'poppy', 'daisy', 'iris', 'sunflower', 'lily'];
/** Комнатная зелень советского подоконника: тёщин язык, алоэ, хлорофитум (и монстера, традесканция — выше). */
export const HOUSEPLANTS: readonly FlowerSpecies[] = ['sansevieria', 'aloe', 'chlorophytum'];
export const FLOWER_SPECIES: readonly FlowerSpecies[] = [...BLOOMS, 'fern', 'tradescantia', 'monstera', ...HOUSEPLANTS];

const HEAD_BUILD: Record<string, (o: Out, hex: string, rnd: () => number) => void> = {
  carnation: carnationHead,
  chrysanthemum: chrysanthemumHead,
  tulip: tulipHead,
  geranium: geraniumHead,
  violet: violetHead,
  calla: callaHead,
  peony: peonyHead,
  poppy: poppyHead,
  daisy: daisyHead,
  iris: irisHead,
  sunflower: sunflowerHead,
  lily: lilyHead,
};

const headCache = new Map<number, MeshData>();
/** Сетка головки формы form (номер в HEADS) — ближняя (lod 0) или дальняя (1). Строится один раз. */
export function headForm(form: number, lod: 0 | 1 = 0): MeshData {
  const key = form * 2 + lod;
  const hit = headCache.get(key);
  if (hit) return hit;
  const h = HEADS[form];
  if (!h) throw new Error(`нет головки ${form}`);
  const mb = new MeshBuilder();
  DETAIL = lod === 1 ? LOD_FAR : 1;
  try {
    HEAD_BUILD[h.species]!(localOut(mb), h.hex, mulberry32(0x5eed + form * 977));
  } finally {
    DETAIL = 1;
  }
  const m = mb.build();
  headCache.set(key, m);
  return m;
}
/** Формы головок вида. */
export const headsOf = (species: FlowerSpecies): number[] => HEADS.map((h, i) => (h.species === species ? i : -1)).filter((i) => i >= 0);

// ── Стебли и зелень (в сетку помещения) ──

/** Что посажено: где головка (мир), куда она смотрит в покое, её форма и размер; у зелени головки нет. */
export interface Bloom {
  pos: V;
  dir: V;
  form: number;
  size: number;
  /** Поворот головки вокруг своей оси, рад: соседние не одного оттиска. */
  spin: number;
}

const GREEN = {
  glaucous: tone('#6f8f7a'),
  dark: tone('#3f6b34'),
  grey: tone('#6d8f6a'),
  fresh: tone('#4f8a3c'),
  fern: tone('#3e7a3a'),
  silver: tone('#7d9a86'),
  purple: tone('#6b3f6e'),
  waxy: tone('#2f5a2a', ENAMEL),
};

/** Путь стебля: от земли до верха h, с наклоном lean в сторону a и мягким изгибом (S-образно у длинных). */
function stalk(h: number, lean: number, a: number, wave: number, n = 6): V[] {
  const side: V = [Math.cos(a), 0, Math.sin(a)];
  const top = add(mul(side, Math.sin(lean) * h), [0, Math.cos(lean) * h, 0]);
  const p1 = add(mul(side, -wave * h), [0, h * 0.35, 0]);
  const p2 = add(mul(side, wave * h + Math.sin(lean) * h * 0.5), [0, h * 0.7, 0]);
  return bezier([0, 0, 0], p1, p2, top, n);
}
const tipDir = (path: readonly V[]): V => norm(sub(path[path.length - 1]!, path[path.length - 2]!));

/**
 * Посадить растение вида species: начало координат at в рамке xf — земля под ним, yaw — поворот растения. size — множитель
 * роста (1 — обычный). Стебли и листья пишутся в сетку xf, головки возвращаются (их ставит рендер).
 *
 * Стебли и листья лежат в сетке помещения и рисуются всегда, поэтому они лёгкие: стебель трёхгранный в четыре колена, узкий лист
 * — одна полоса; куст — от 90 (гвоздика) до 600 (папоротник) треугольников. Вся оранжерея — до 50 тысяч при пределе куска
 * помещения в 60 тысяч (tests/furniture.test.ts). Подробность — у головок: их немного в кадре, и у дальних она упрощается.
 */
export function plant(xf: Xf, at: V, species: FlowerSpecies, seed: number, size = 1, yaw = 0): Bloom[] {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const o = xfOut(xf, at, yaw);
  const blooms: Bloom[] = [];
  const bloom = (path: readonly V[], form: number, k = 1): void => {
    blooms.push({ pos: o.p(path[path.length - 1]!), dir: norm(o.d(tipDir(path))), form, size: size * k * (0.9 + rnd() * 0.2), spin: rnd() * Math.PI * 2 });
  };
  const pickForm = (): number => {
    const f = headsOf(species);
    return f[Math.floor(rnd() * f.length)]!;
  };
  const sc = size;
  switch (species) {
    case 'carnation':
    case 'chrysanthemum': {
      const carn = species === 'carnation';
      const h = (carn ? 0.42 + rnd() * 0.16 : 0.5 + rnd() * 0.18) * sc;
      const path = stalk(h, rnd() * 0.16, rnd() * 6.28, (rnd() - 0.5) * 0.08, 4);
      const g = carn ? GREEN.glaucous : GREEN.dark;
      tube(o, path, (t) => lerp(carn ? 0.0035 : 0.0042, 0.0026, t) * sc, 3, MAT.paper, () => g, (t) => 0.6 + 0.4 * t);
      const nodes = carn ? [0.3, 0.55, 0.78] : [0.25, 0.42, 0.58, 0.74];
      nodes.forEach((t, k) => {
        const i = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
        const p = path[i]!;
        const pair = carn ? 2 : 1;
        for (let q = 0; q < pair; q++) {
          const a = k * (carn ? Math.PI / 2 : 2.4) + q * Math.PI + rnd() * 0.3;
          const radial: V = [Math.cos(a), 0, Math.sin(a)];
          const out = norm(add(mul(radial, 0.85), [0, carn ? 0.55 : 0.35, 0]));
          leaf(o, { base: p, out, wide: [-Math.sin(a), 0, Math.cos(a)], len: (carn ? 0.075 : 0.065) * sc, width: (carn ? 0.0065 : 0.042) * sc, prof: carn ? (u) => Math.sin(lerp(0.1, 0.95, u) * Math.PI) ** 0.5 : (u) => (0.6 + 0.4 * Math.abs(Math.sin(u * Math.PI * 3))) * Math.sin(lerp(0.08, 0.95, u) * Math.PI), cup: 0.6, bend: carn ? -0.5 : -0.3, droop: carn ? 0.01 : 0.008, nu: carn ? 3 : 4, nv: 1 }, MAT.paper, () => g);
        }
      });
      bloom(path, pickForm());
      break;
    }
    case 'tulip': {
      const h = (0.34 + rnd() * 0.12) * sc;
      const path = stalk(h, rnd() * 0.1, rnd() * 6.28, (rnd() - 0.5) * 0.06, 4);
      tube(o, path, (t) => lerp(0.0048, 0.0036, t) * sc, 3, MAT.paper, () => GREEN.grey, (t) => 0.6 + 0.4 * t);
      for (let q = 0; q < 2; q++) {
        const a = rnd() * 6.28 + q * Math.PI;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        leaf(o, { base: [0, 0.01, 0], out: norm(add(mul(radial, 0.35), [0, 1, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: (0.17 + rnd() * 0.06) * sc, width: 0.042 * sc, prof: (u) => Math.sin(lerp(0.05, 0.98, u) * Math.PI) ** 0.6, cup: 1, bend: -0.9, droop: 0.02, nu: 4 }, MAT.paper, () => GREEN.grey);
      }
      bloom(path, pickForm());
      break;
    }
    case 'geranium': {
      const n = 5 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.28 + rnd() * 0.4;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const len = (0.07 + rnd() * 0.07) * sc;
        const tip = add(mul(radial, len * 0.8), [0, len * 0.75, 0]);
        const pet = bezier([0, 0, 0], [0, len * 0.5, 0], add(mul(radial, len * 0.4), [0, len * 0.8, 0]), tip, 2);
        tube(o, pet, () => 0.0018 * sc, 3, MAT.paper, () => GREEN.fresh);
        // Круглый лист с тёмным кольцом.
        const r = (0.033 + rnd() * 0.012) * sc;
        sheet(
          o,
          (u, v) => {
            const th = v * Math.PI;
            const rr = r * u;
            const p: V = [Math.cos(a) * rr * Math.cos(th) - Math.sin(a) * rr * Math.sin(th), 0.006 * u * u * Math.cos(th * 2), Math.sin(a) * rr * Math.cos(th) + Math.cos(a) * rr * Math.sin(th)];
            return add(add(tip, mul(radial, r * 0.8)), p);
          },
          2,
          6,
          MAT.paper,
          // Тёмное кольцо: при двух кольцах сетки — тон середины, по краю он расходится полосой.
          (u) => (u > 0.3 && u < 0.7 ? shade(GREEN.fresh, 0.55) : GREEN.fresh),
        );
      }
      const heads = 1 + (rnd() < 0.5 ? 1 : 0);
      for (let k = 0; k < heads; k++) {
        const path = stalk((0.22 + rnd() * 0.08) * sc, 0.15 + rnd() * 0.2, rnd() * 6.28, 0.05, 4);
        tube(o, path, () => 0.0022 * sc, 3, MAT.paper, () => GREEN.fresh);
        bloom(path, pickForm(), 1.1);
      }
      break;
    }
    case 'violet': {
      const n = 8;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.28 + rnd() * 0.3;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const base = mul(radial, 0.012 * sc);
        const pet = add(base, add(mul(radial, 0.045 * sc), [0, 0.03 * sc, 0]));
        tube(o, [base, pet], () => 0.0017 * sc, 3, MAT.paper, () => GREEN.dark);
        leaf(o, { base: pet, out: norm(add(radial, [0, 0.1, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: 0.045 * sc, width: 0.04 * sc, prof: (u) => Math.sin(lerp(0.05, 0.98, u) * Math.PI) ** 0.45, cup: 0.5, bend: 0.25, nu: 3 }, MAT.paper, () => GREEN.dark);
      }
      const path = stalk(0.075 * sc, 0.05, rnd() * 6.28, 0, 3);
      tube(o, path, () => 0.002 * sc, 3, MAT.paper, () => GREEN.dark);
      bloom(path, pickForm(), 1.2);
      break;
    }
    case 'calla': {
      const leaves = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < leaves; k++) {
        const a = rnd() * 6.28;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const h = (0.32 + rnd() * 0.12) * sc;
        const pet = bezier([0, 0, 0], [0, h * 0.5, 0], add(mul(radial, h * 0.15), [0, h * 0.85, 0]), add(mul(radial, h * 0.3), [0, h, 0]), 3);
        tube(o, pet, () => 0.003 * sc, 3, MAT.paper, () => GREEN.dark);
        leaf(o, { base: pet[pet.length - 1]!, out: norm(add(radial, [0, 0.55, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: 0.15 * sc, width: 0.085 * sc, prof: (u) => (u < 0.2 ? lerp(0.85, 1, u / 0.2) : Math.sin(lerp(0.5, 1, (u - 0.2) / 0.8) * Math.PI) ** 0.8), cup: 0.4, bend: -0.6, droop: 0.02, nu: 4 }, MAT.paper, () => GREEN.dark);
      }
      const path = stalk((0.48 + rnd() * 0.14) * sc, rnd() * 0.12, rnd() * 6.28, 0.02, 4);
      tube(o, path, (t) => lerp(0.0065, 0.005, t) * sc, 4, MAT.paper, () => GREEN.fresh);
      bloom(path, pickForm());
      break;
    }
    case 'fern': {
      const n = 6 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.28 + rnd() * 0.4;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const len = (0.34 + rnd() * 0.16) * sc;
        const rise = 0.5 + rnd() * 0.5;
        const rach = bezier([0, 0, 0], add(mul(radial, len * 0.15), [0, len * rise * 0.6, 0]), add(mul(radial, len * 0.6), [0, len * rise * 0.75, 0]), add(mul(radial, len), [0, len * (rise * 0.35 - 0.1), 0]), 5);
        tube(o, rach, (t) => lerp(0.0022, 0.0008, t) * sc, 3, MAT.paper, () => GREEN.fern);
        const wide: V = [-Math.sin(a), 0, Math.cos(a)];
        for (let i = 1; i < rach.length - 1; i++) {
          const t = i / (rach.length - 1);
          const d = norm(sub(rach[i + 1]!, rach[i - 1]!));
          for (const sgn of [-1, 1]) {
            const out = norm(add(mul(wide, sgn), mul(d, 0.55)));
            leaf(o, { base: rach[i]!, out, wide: d, len: lerp(0.085, 0.025, t) * sc, width: 0.019 * sc, prof: (u) => Math.sin(lerp(0.1, 0.98, u) * Math.PI) ** 0.6, bend: -0.2, droop: 0.004, nu: 2, nv: 1 }, MAT.paper, () => shade(GREEN.fern, 0.9 + 0.2 * t));
          }
        }
      }
      break;
    }
    case 'tradescantia': {
      // Свисает через край: стебли из середины горшка поднимаются и падают за край.
      const n = 6 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.28 + rnd() * 0.5;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const fall = (0.25 + rnd() * 0.35) * sc;
        const path = bezier([0, 0, 0], add(mul(radial, 0.05 * sc), [0, 0.06 * sc, 0]), add(mul(radial, 0.13 * sc), [0, 0.03 * sc, 0]), add(mul(radial, 0.16 * sc), [0, -fall, 0]), 6);
        tube(o, path, () => 0.0018 * sc, 3, MAT.paper, () => GREEN.purple);
        for (let i = 1; i < path.length; i++) {
          const d = norm(sub(path[i]!, path[i - 1]!));
          const s = i % 2 === 0 ? 1 : -1;
          const side = norm(cross(d, [0, 1, 0]));
          leaf(o, { base: path[i]!, out: norm(add(mul(side, s), mul(radial, 0.5))), wide: d, len: 0.038 * sc, width: 0.02 * sc, prof: (u) => Math.sin(lerp(0.1, 0.95, u) * Math.PI) ** 0.55, bend: 0.2, nu: 2, nv: 1 }, MAT.paper, (u) => (u > 0.3 && u < 0.6 ? GREEN.silver : GREEN.fresh), () => GREEN.purple);
        }
      }
      break;
    }
    case 'peony':
    case 'lily': {
      // Пион — куст с рассечёнными листьями и тяжёлой головой, стебель клонится; лилия — прямой стебель в мутовках узких листьев.
      const peony = species === 'peony';
      const h = (peony ? 0.46 + rnd() * 0.12 : 0.56 + rnd() * 0.14) * sc;
      const path = stalk(h, rnd() * (peony ? 0.22 : 0.08), rnd() * 6.28, (rnd() - 0.5) * 0.06, 4);
      tube(o, path, (t) => lerp(peony ? 0.0045 : 0.0048, 0.0032, t) * sc, 3, MAT.paper, () => GREEN.dark, (t) => 0.6 + 0.4 * t);
      const nodes = peony ? [0.25, 0.5] : [0.3, 0.45, 0.6, 0.75];
      nodes.forEach((t, k) => {
        const i = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
        const p = path[i]!;
        const per = peony ? 3 : 2;
        for (let q = 0; q < per; q++) {
          const a = k * 2.1 + (q / per) * 6.28 + rnd() * 0.3;
          const radial: V = [Math.cos(a), 0, Math.sin(a)];
          leaf(o, { base: p, out: norm(add(mul(radial, 0.8), [0, peony ? 0.25 : 0.55, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: (peony ? 0.09 : 0.07) * sc, width: (peony ? 0.03 : 0.012) * sc, prof: (u) => Math.pow(Math.sin(lerp(0.08, 0.95, u) * Math.PI), 0.7), cup: 0.4, bend: -0.4, droop: 0.008, nu: 3, nv: 1 }, MAT.paper, () => GREEN.dark);
        }
      });
      bloom(path, pickForm(), peony ? 1.15 : 1);
      break;
    }
    case 'poppy':
    case 'daisy': {
      // Полевые: тонкий стебель, у мака чуть изогнутый, у основания — розетка рассечённых листьев.
      const poppy = species === 'poppy';
      const h = (poppy ? 0.4 + rnd() * 0.14 : 0.3 + rnd() * 0.12) * sc;
      const path = stalk(h, rnd() * 0.18, rnd() * 6.28, (rnd() - 0.5) * (poppy ? 0.14 : 0.06), 4);
      tube(o, path, (t) => lerp(0.003, 0.0022, t) * sc, 3, MAT.paper, () => (poppy ? GREEN.grey : GREEN.fresh));
      const n = poppy ? 3 : 4;
      for (let q = 0; q < n; q++) {
        const a = (q / n) * 6.28 + rnd() * 0.5;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        leaf(o, { base: [0, 0.005, 0], out: norm(add(radial, [0, 0.45, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: (poppy ? 0.1 : 0.06) * sc, width: (poppy ? 0.022 : 0.012) * sc, prof: (u) => (0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * 3))) * Math.sin(lerp(0.08, 0.95, u) * Math.PI), bend: -0.5, droop: 0.01, nu: 3, nv: 1 }, MAT.paper, () => (poppy ? GREEN.grey : GREEN.fresh));
      }
      bloom(path, pickForm(), poppy ? 1.1 : 0.95);
      break;
    }
    case 'iris': {
      // Мечевидные листья веером из одной точки и прямой стебель выше них.
      const h = (0.5 + rnd() * 0.12) * sc;
      const fan = 4 + Math.floor(rnd() * 2);
      const a0 = rnd() * 6.28;
      for (let q = 0; q < fan; q++) {
        const a = a0 + ((q - (fan - 1) / 2) / fan) * 0.9;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        leaf(o, { base: [0, 0.005, 0], out: norm(add(mul(radial, 0.22), [0, 1, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: (0.36 + rnd() * 0.12) * sc, width: 0.026 * sc, prof: (u) => Math.pow(Math.sin(lerp(0.05, 0.98, u) * Math.PI), 0.4), bend: -0.25, droop: 0.01, nu: 4, nv: 1 }, MAT.paper, () => GREEN.grey);
      }
      const path = stalk(h, rnd() * 0.08, rnd() * 6.28, 0.01, 4);
      tube(o, path, (t) => lerp(0.0045, 0.0035, t) * sc, 3, MAT.paper, () => GREEN.grey);
      bloom(path, pickForm(), 1.05);
      break;
    }
    case 'sunflower': {
      // Толстый шершавый стебель, широкие листья сердцем вдоль него и огромная голова, наклонённая к свету.
      const h = (0.62 + rnd() * 0.12) * sc;
      const path = stalk(h, 0.05 + rnd() * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.05, 4);
      tube(o, path, (t) => lerp(0.011, 0.007, t) * sc, 4, MAT.paper, () => GREEN.fresh, (t) => 0.65 + 0.35 * t);
      [0.3, 0.5, 0.68].forEach((t, k) => {
        const i = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
        const a = k * 2.4 + rnd() * 0.4;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        leaf(o, { base: path[i]!, out: norm(add(radial, [0, 0.15, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: 0.13 * sc, width: 0.1 * sc, prof: (u) => (u < 0.3 ? lerp(0.35, 1, u / 0.3) : Math.sin(lerp(0.5, 1, (u - 0.3) / 0.7) * Math.PI) ** 0.8), cup: 0.3, bend: -0.5, droop: 0.02, nu: 3, nv: 2 }, MAT.paper, () => GREEN.fresh);
      });
      bloom(path, pickForm(), 2.2);
      break;
    }
    case 'sansevieria': {
      // Тёщин язык: прямые мечи из земли, полосатые поперёк, с жёлтой каймой.
      const n = 6 + Math.floor(rnd() * 4);
      for (let q = 0; q < n; q++) {
        const a = (q / n) * 6.28 + rnd() * 0.6;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const off = mul(radial, 0.02 + rnd() * 0.05);
        const band = rnd() * 9;
        leaf(o, { base: [off[0], 0.005, off[2]], out: norm(add(mul(radial, 0.12 + rnd() * 0.12), [0, 1, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: (0.42 + rnd() * 0.3) * sc, width: (0.05 + rnd() * 0.02) * sc, prof: (u) => Math.pow(Math.sin(lerp(0.08, 1, u) * Math.PI), 0.35), cup: 0.3, bend: -0.12, nu: 5, nv: 2 }, MAT.paper, (u) => (Math.sin((u * 14 + band) * 1.7) > 0.3 ? GREEN.dark : GREEN.silver), () => GREEN.grey);
      }
      break;
    }
    case 'aloe': {
      // Алоэ: розетка толстых сизых листьев с зубчиками, наружные лежат, внутренние встают.
      const n = 10 + Math.floor(rnd() * 4);
      for (let q = 0; q < n; q++) {
        const f = q / n;
        const a = q * 2.39996 + rnd() * 0.2;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        leaf(o, { base: mul(radial, 0.01), out: norm(add(mul(radial, lerp(1, 0.35, f)), [0, lerp(0.35, 1.2, f), 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: lerp(0.24, 0.14, f) * sc, width: lerp(0.045, 0.03, f) * sc, prof: (u) => Math.pow(1 - u, 0.6), cup: 0.9, bend: -0.25, fringe: 0.003 * sc, nu: 3, nv: 2 }, MAT.enamel, () => GREEN.glaucous);
      }
      break;
    }
    case 'chlorophytum': {
      // Хлорофитум: пучок узких полосатых листьев дугой через край горшка и пара усов с детками.
      const n = 14 + Math.floor(rnd() * 6);
      for (let q = 0; q < n; q++) {
        const a = (q / n) * 6.28 + rnd() * 0.4;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        leaf(o, { base: mul(radial, 0.008), out: norm(add(mul(radial, 0.7), [0, 0.75, 0])), wide: [-Math.sin(a), 0, Math.cos(a)], len: (0.2 + rnd() * 0.12) * sc, width: 0.014 * sc, prof: (u) => Math.pow(Math.sin(lerp(0.05, 0.95, u) * Math.PI), 0.45), bend: -1.1, droop: 0.04 * sc, nu: 4, nv: 1 }, MAT.paper, (u) => (u > 0.05 && Math.abs(((u * 37) % 1) - 0.5) < 0.18 ? tone('#e8ecd0') : GREEN.fresh));
      }
      for (let q = 0; q < 2; q++) {
        const a = rnd() * 6.28;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const run = bezier([0, 0.02, 0], add(mul(radial, 0.12 * sc), [0, 0.12 * sc, 0]), add(mul(radial, 0.24 * sc), [0, 0.04 * sc, 0]), add(mul(radial, 0.3 * sc), [0, -0.12 * sc, 0]), 4);
        tube(o, run, () => 0.0015 * sc, 3, MAT.paper, () => tone('#c8c49a'));
        const tip = run[run.length - 1]!;
        for (let k = 0; k < 5; k++) {
          const b = (k / 5) * 6.28;
          leaf(o, { base: tip, out: norm([Math.cos(b), 0.6, Math.sin(b)]), wide: [-Math.sin(b), 0, Math.cos(b)], len: 0.05 * sc, width: 0.01 * sc, prof: (u) => Math.sin(lerp(0.1, 0.95, u) * Math.PI), bend: -0.5, nu: 2, nv: 1 }, MAT.paper, () => GREEN.fresh);
        }
      }
      break;
    }
    case 'monstera': {
      const n = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.28 + rnd() * 0.6;
        const radial: V = [Math.cos(a), 0, Math.sin(a)];
        const h = (0.45 + rnd() * 0.35) * sc;
        const pet = bezier([0, 0, 0], [0, h * 0.6, 0], add(mul(radial, h * 0.25), [0, h * 0.95, 0]), add(mul(radial, h * 0.5), [0, h, 0]), 4);
        tube(o, pet, () => 0.006 * sc, 4, MAT.enamel, () => GREEN.waxy);
        // Лист с прорезями: доли между прорезями — отдельные полосы от жилки к краю.
        const base = pet[pet.length - 1]!;
        const out = norm(add(radial, [0, -0.25, 0]));
        const wide: V = [-Math.sin(a), 0, Math.cos(a)];
        const len = (0.3 + rnd() * 0.12) * sc;
        const lobes = 4;
        for (const sgn of [-1, 1]) {
          for (let l = 0; l < lobes; l++) {
            const t0 = (l + 0.08) / lobes;
            const t1 = (l + 0.92) / lobes;
            const mid = add(base, mul(out, len * (t0 + t1) / 2));
            const half = Math.sin(lerp(0.1, 0.95, (t0 + t1) / 2) * Math.PI) * len * 0.42;
            leaf(o, { base: mid, out: norm(add(mul(wide, sgn), mul(out, 0.35))), wide: out, len: half, width: len * (t1 - t0), prof: (u) => 1 - 0.35 * u * u, cup: -0.2, bend: -0.35, droop: 0.01, nu: 2 }, MAT.enamel, () => GREEN.waxy);
          }
        }
      }
      break;
    }
  }
  // Сетка помещения собирает головки с номером объекта, на котором цветок растёт (грядка, горшок): растворится он — уйдут и они.
  if (xf.mb.blooms) for (const b of blooms) xf.mb.blooms.push({ ...b, obj: xf.mb.obj });
  // Некому отдать (вещь сна, полка конструктора, витрина): головка ставится в сетку простой чашечкой своего цвета, раскрытой и
  // неподвижной — растение читается цветущим, а вес вещи почти не растёт (полная головка — сотни треугольников).
  else for (const b of blooms) cupHead(xf.mb, b);
  return blooms;
}

/** Размер головки формы: радиус поперёк и высота (по дальней сетке), м. */
const cupDims = new Map<number, readonly [number, number]>();

/** Чашечка вместо головки: усечённый конус по оси dir в цвет головки, 32 треугольника. */
function cupHead(mb: MeshBuilder, b: Bloom): void {
  let dims = cupDims.get(b.form);
  if (!dims) {
    const m = headForm(b.form, 1);
    let r = 0;
    let h = 0;
    for (let i = 0; i < m.position.length; i += 3) {
      r = Math.max(r, Math.hypot(m.position[i]!, m.position[i + 2]!));
      h = Math.max(h, m.position[i + 1]!);
    }
    dims = [r, Math.max(h, r * 0.4)];
    cupDims.set(b.form, dims);
  }
  const R = dims[0] * b.size;
  const H = dims[1] * b.size;
  const d = norm(b.dir);
  const ref: V = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ref, d));
  const v = cross(d, u);
  const col = tone(HEADS[b.form]?.hex ?? '#d8d0c0');
  const N = 8;
  const at = (rad: number, a: number, up: number): V => {
    const c = Math.cos(a + b.spin);
    const s = Math.sin(a + b.spin);
    return [b.pos[0] + (u[0] * c + v[0] * s) * rad + d[0] * up, b.pos[1] + (u[1] * c + v[1] * s) * rad + d[1] * up, b.pos[2] + (u[2] * c + v[2] * s) * rad + d[2] * up];
  };
  const out = (a: number, k: number): V => {
    const c = Math.cos(a + b.spin);
    const s = Math.sin(a + b.spin);
    return norm([(u[0] * c + v[0] * s) * k + d[0], (u[1] * c + v[1] * s) * k + d[1], (u[2] * c + v[2] * s) * k + d[2]]);
  };
  // Тон не темнее 0,12: красный мак в тени чашечки не уходит в чёрное (правило реквизита — тон приглушён, но не чернота).
  const dim = (k: number): V => [Math.max(0.12, col[0] * k), Math.max(0.12, col[1] * k), Math.max(0.12, col[2] * k)];
  const bottom = mb.vertex(b.pos, [-d[0], -d[1], -d[2]], MAT.paper, dim(0.6), 0.7);
  const top = mb.vertex(at(0, 0, 0.55 * H), d, MAT.paper, dim(0.85), 0.8);
  const low: number[] = [];
  const rim: number[] = [];
  const rimTop: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    low.push(mb.vertex(at(0.55 * R, a, 0.35 * H), out(a, 1.4), MAT.paper, dim(0.75), 0.8));
    rim.push(mb.vertex(at(R, a, H), out(a, 0.9), MAT.paper, dim(1), 1));
    rimTop.push(mb.vertex(at(R, a, H), d, MAT.paper, dim(1), 1));
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    mb.tri(bottom, low[j]!, low[i]!);
    mb.tri(low[i]!, low[j]!, rim[j]!);
    mb.tri(low[i]!, rim[j]!, rim[i]!);
    mb.tri(top, rimTop[i]!, rimTop[j]!);
  }
}
