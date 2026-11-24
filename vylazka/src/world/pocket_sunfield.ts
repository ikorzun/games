/**
 * Поле подсолнухов (партнёр 24.11: «нужна квадратная зеленая комната с подсолнухами», затем: «пусть эта комната будет
 * небольшим лугом с голубым небом и полем с подсохнухами»).
 *
 * Небольшой луг под ясным голубым небом: трава, вокруг — поле подсолнухов в рост человека. Игрок появляется на поляне
 * посреди поля; от поляны вперёд ведёт прокос к дверной коробке выхода. Через подсолнухи можно идти — они не преграда.
 * Подсолнухи смотрят не на солнце: все головки повёрнуты к поляне, на высоту глаз (решение основной модели: обман ожидания —
 * цветок, который следит за светом, следит за тем, кто пришёл).
 *
 * Дела у места нет: это место, а не подсказка. Стен нет; за полем трава редеет в голубую даль.
 * Направление: игрок появляется в начале координат лицом в −z, как на лугу (world/pocket_meadow.ts).
 */
import { mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { GrassSite } from '../systems/grass';
import { GRASS_VARIANTS, grassForm } from './grass';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { doorFrame } from './pockets';
import type { PocketBuilder, PocketSpace } from './pockets';

/** Поляна, поле (внутренний и внешний радиус), полуширина прокоса, выход, трава, край ходьбы, высота взгляда головок, м. */
export const SUNFIELD = { glade: 3.2, field: 9.5, path: 0.85, exit: 12.5, grass: 24, walk: 20, look: 1.6 } as const;

const STEM: Vec3 = [0.3, 0.62, 0.16];
const LEAF: Vec3 = [0.2, 0.68, 0.13];
const BRACT: Vec3 = [0.26, 0.5, 0.14];
const SEED: Vec3 = [0.3, 0.17, 0.07];
const SEED_IN: Vec3 = [0.16, 0.09, 0.04];
const PETAL: Vec3 = [1.75, 1.2, 0.1];
const PETAL_IN: Vec3 = [1.5, 0.78, 0.06];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Подсолнух: корень base (мир), рост h, головка смотрит в точку look. Стебель чуть выгнут и у головки клонится к ней;
 * листья — парами сердечек на черешках; головка — тёмный выпуклый диск, два ряда язычков, сзади — зелёная чашка.
 */
function sunflower(mb: MeshBuilder, base: Vec3, h: number, look: Vec3, rnd: () => number): void {
  const size = 0.82 + rnd() * 0.4;
  const lean = rnd() * 6.283;
  const off = 0.05 + rnd() * 0.07;
  const top: Vec3 = [base[0] + Math.cos(lean) * off, base[1] + h, base[2] + Math.sin(lean) * off];
  const d = norm(sub(look, top));
  // Головка сидит перед концом стебля: шея загибается к взгляду.
  const head = add(top, mul(d, 0.09));
  const path: Vec3[] = [];
  const N = 5;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bow = Math.sin(t * Math.PI) * 0.05;
    const neck = t > 0.8 ? ((t - 0.8) / 0.2) ** 2 : 0;
    path.push([
      base[0] + (top[0] - base[0]) * t + Math.sin(lean) * bow + d[0] * 0.06 * neck,
      base[1] + h * t - 0.02 * neck,
      base[2] + (top[2] - base[2]) * t - Math.cos(lean) * bow + d[2] * 0.06 * neck,
    ]);
  }
  // Стебель: пять граней, книзу толще.
  const SIDES = 5;
  const rings: number[][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = 0.021 - 0.009 * t;
    const ring: number[] = [];
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2 + lean;
      const n: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      ring.push(mb.vertex(add(path[i]!, mul(n, r)), n, MAT.plaster, STEM, 0.55 + 0.45 * t));
    }
    rings.push(ring);
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      mb.tri(rings[i]![k]!, rings[i]![k1]!, rings[i + 1]![k1]!);
      mb.tri(rings[i]![k]!, rings[i + 1]![k1]!, rings[i + 1]![k]!);
    }
  }
  // Листья: по спирали, крупные внизу. Лист — сердечко из четырёх треугольников со складкой по жилке, кончик свисает.
  const leaves = 3 + Math.floor(rnd() * 2);
  let la = rnd() * 6.283;
  for (let j = 0; j < leaves; j++) {
    const t = 0.24 + (j / leaves) * 0.56 + rnd() * 0.04;
    la += 2.4 + rnd() * 0.5;
    const o: Vec3 = [base[0] + (top[0] - base[0]) * t, base[1] + h * t, base[2] + (top[2] - base[2]) * t];
    const out: Vec3 = [Math.cos(la), 0, Math.sin(la)];
    const side: Vec3 = [-out[2], 0, out[0]];
    const len = (0.3 - 0.14 * t) * size * (0.85 + rnd() * 0.3);
    const w = len * 0.42;
    const root = add(o, [out[0] * 0.07, 0.035, out[2] * 0.07]);
    const mid = add(o, [out[0] * (0.07 + len * 0.45), 0.05, out[2] * (0.07 + len * 0.45)]);
    const tip = add(o, [out[0] * (0.07 + len), -0.07 * (1 - t * 0.5), out[2] * (0.07 + len)]);
    const l = add(add(o, mul(out, 0.07 + len * 0.3)), add(mul(side, w), [0, 0.085, 0]));
    const r = add(add(o, mul(out, 0.07 + len * 0.3)), add(mul(side, -w), [0, 0.085, 0]));
    const up: Vec3 = [out[0] * 0.25, 0.97, out[2] * 0.25];
    const shade = 0.75 + rnd() * 0.3;
    const tint = mul(LEAF, shade);
    const vo = mb.vertex(o, up, MAT.plaster, STEM, 0.8);
    const vr = mb.vertex(root, up, MAT.plaster, tint, 0.7);
    const vm = mb.vertex(mid, up, MAT.plaster, mul(tint, 0.8), 0.85);
    const vt = mb.vertex(tip, up, MAT.plaster, tint, 1);
    const vl = mb.vertex(l, norm(add(up, mul(side, 0.5))), MAT.plaster, tint, 1);
    const vrr = mb.vertex(r, norm(add(up, mul(side, -0.5))), MAT.plaster, tint, 1);
    // Черешок — тонкий клин от стебля.
    // Обе стороны: изнанка треугольника не рисуется, а лист виден и сверху, и снизу.
    for (const [a, b, c] of [[vo, vr, vm], [vr, vl, vm], [vl, vt, vm], [vr, vm, vrr], [vrr, vm, vt]] as const) {
      mb.tri(a, b, c);
      mb.tri(a, c, b);
    }
  }
  // Головка: оси диска.
  const u = norm(cross(d, Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
  // u × v = d: обход «u к v» — лицом туда, куда смотрит головка (изнанка треугольника не рисуется).
  const v = cross(d, u);
  const R = 0.105 * size;
  const at = (a: number, r: number, f: number): Vec3 => add(head, add(add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)), mul(d, f)));
  // Диск семян: выпуклый, темнее к середине.
  const SEG = 12;
  const c = mb.vertex(at(0, 0, 0.03 * size), d, MAT.paper, SEED_IN, 1);
  const midRing: number[] = [];
  const rim: number[] = [];
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    const nr = norm(add(d, add(mul(u, Math.cos(a) * 0.5), mul(v, Math.sin(a) * 0.5))));
    midRing.push(mb.vertex(at(a, R * 0.55, 0.026 * size), norm(add(d, mul(sub(nr, d), 0.5))), MAT.paper, SEED, 1));
    rim.push(mb.vertex(at(a, R, 0.008 * size), nr, MAT.paper, mul(SEED, 1.5), 0.9));
  }
  for (let k = 0; k < SEG; k++) {
    const k1 = (k + 1) % SEG;
    mb.tri(c, midRing[k]!, midRing[k1]!);
    mb.tri(midRing[k]!, rim[k]!, rim[k1]!);
    mb.tri(midRing[k]!, rim[k1]!, midRing[k1]!);
  }
  // Язычки: два ряда, задний шире и темнее, вперемежку с передним; у каждого своя длина и наклон.
  const spin = rnd() * 6.283;
  for (const [row, count] of [[0, 15], [1, 13]] as const) {
    for (let k = 0; k < count; k++) {
      const a = spin + ((k + row * 0.5) / count) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
      const len = R * (0.95 + rnd() * 0.45) * (row ? 1.12 : 1);
      const half = (row ? 0.2 : 0.165) * (0.85 + rnd() * 0.3);
      const fwd = (row ? -0.012 : 0.004) * size;
      const curl = (rnd() - 0.35) * 0.05 * size;
      const n = norm(add(d, add(mul(u, Math.cos(a) * 0.35), mul(v, Math.sin(a) * 0.35))));
      const tint = mul(row ? PETAL_IN : PETAL, 0.85 + rnd() * 0.3);
      const p0 = mb.vertex(at(a, R * 0.92, fwd), n, MAT.paper, mul(PETAL_IN, 0.8), 0.8);
      const p1 = mb.vertex(at(a - half, R + len * 0.45, fwd + curl * 0.5), n, MAT.paper, tint, 1);
      const p2 = mb.vertex(at(a, R + len, fwd + curl), n, MAT.paper, tint, 1);
      const p3 = mb.vertex(at(a + half, R + len * 0.45, fwd + curl * 0.5), n, MAT.paper, tint, 1);
      mb.tri(p0, p1, p2);
      mb.tri(p0, p2, p3);
    }
  }
  // Чашка сзади: зелёный конус от края диска к шее.
  const back = mul(d, -1);
  const apex = mb.vertex(add(head, mul(d, -0.07 * size)), back, MAT.plaster, STEM, 0.7);
  const cup: number[] = [];
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    cup.push(mb.vertex(at(a, R * 1.08, 0), norm(add(back, add(mul(u, Math.cos(a)), mul(v, Math.sin(a))))), MAT.plaster, BRACT, 0.85));
  }
  for (let k = 0; k < SEG; k++) mb.tri(apex, cup[(k + 1) % SEG]!, cup[k]!);
}

/** Небо: купол свечения — дымка у земли, синева в зените (те же ступени, что на лугу). Обе стороны: изнанка не рисуется. */
function sky(mb: MeshBuilder, o: Vec3): void {
  const RS = 45;
  const stops: Array<[number, Vec3]> = [
    [-18, [60, 92, 128]],
    [0, [88, 120, 150]],
    [5, [62, 98, 140]],
    [14, [30, 70, 134]],
    [30, [12, 46, 122]],
    [55, [4, 30, 102]],
    [90, [1, 18, 80]],
  ];
  const at = (lat: number): Vec3 => {
    let k = 0;
    while (k < stops.length - 2 && lat > stops[k + 1]![0]) k++;
    const [l0, c0] = stops[k]!;
    const [l1, c1] = stops[k + 1]!;
    const t = Math.max(0, Math.min(1, (lat - l0) / (l1 - l0)));
    const e = t * t * (3 - 2 * t);
    return [c0[0] + (c1[0] - c0[0]) * e, c0[1] + (c1[1] - c0[1]) * e, c0[2] + (c1[2] - c0[2]) * e];
  };
  const lats = [89, 68, 54, 40, 28, 19, 12, 7, 3, 0, -6, -18];
  const SEG = 32;
  const rows: number[][] = lats.map((lat) => {
    const th = ((90 - lat) * Math.PI) / 180;
    const row: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const ph = (k / SEG) * Math.PI * 2;
      const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      row.push(mb.vertex([o[0] + d[0] * RS, o[1] + d[1] * RS, o[2] + d[2] * RS], [-d[0], -d[1], -d[2]], MAT.glow, at(lat), 1));
    }
    return row;
  });
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k < SEG; k++) {
      const k1 = (k + 1) % SEG;
      const [a, b, c, d] = [rows[i]![k]!, rows[i]![k1]!, rows[i + 1]![k1]!, rows[i + 1]![k]!];
      mb.tri(a, b, c);
      mb.tri(a, c, d);
      mb.tri(a, c, b);
      mb.tri(a, d, c);
    }
  }
}

export const buildSunfield: PocketBuilder = (seed: number, origin: Vec3): PocketSpace => {
  const [ox, oy, oz] = origin;
  const mb = new MeshBuilder();
  const { glade: G, field: F, path: P, exit: EX, grass: GR, walk: W } = SUNFIELD;
  // Земля: ровная, цвета сочной травы; сверху — трава плитками.
  const FAR = 60;
  mb.box([ox - FAR, oy - 0.5, oz - FAR], [ox + FAR, oy, oz + FAR], MAT.canvas, { tint: [0.55, 1.2, 0.32], skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  sky(mb, origin);
  const exit: Vec3 = [ox, oy, oz - EX];
  doorFrame(mb, exit);
  const rnd = mulberry32((seed ^ 0x5f10e3) >>> 0);
  // Прокос: полоса от поляны к выходу (в −z).
  const onPath = (x: number, z: number): boolean => Math.abs(x) < P && z < 0;
  // Трава: на поляне и прокосе — короткая, в поле — по колено, за полем — выше и к краю редеет.
  const grass: GrassSite[] = [];
  for (let gx = -GR; gx <= GR; gx++) {
    for (let gz = -GR; gz <= GR; gz++) {
      const x = gx + (rnd() - 0.5) * 0.16;
      const z = gz + (rnd() - 0.5) * 0.16;
      const r = Math.hypot(x, z);
      const rot = Math.floor(rnd() * 4) * (Math.PI / 2);
      const s = 1.08 + 0.1 * rnd();
      const variant = Math.floor(rnd() * GRASS_VARIANTS);
      const tall = 0.8 + 0.4 * rnd();
      if (r > GR) continue;
      const low = r < G + 0.5 || (Math.abs(x) < P + 0.5 && z < 0 && z > -EX - 1.5);
      grass.push({ pos: [ox + x, oy - 0.02, oz + z], rot, s, h: (low ? 0.45 : r < F ? 0.75 : 1) * tall, form: grassForm('meadow', variant) });
    }
  }
  // Подсолнухи: кольцо поля вокруг поляны, неровной сеткой со сдвигом рядов; ближе к поляне ниже, к краю выше.
  const look: Vec3 = [ox, oy + SUNFIELD.look, oz];
  const STEP = 1.02;
  const n = Math.ceil(F / STEP);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const jx = (rnd() - 0.5) * 0.45;
      const jz = (rnd() - 0.5) * 0.45;
      const hh = rnd();
      const x = i * STEP + (Math.abs(j) % 2) * STEP * 0.5 + jx;
      const z = j * STEP * 0.92 + jz;
      const r = Math.hypot(x, z);
      if (r < G + 0.3 || r > F || onPath(x * 0.86, z)) continue;
      const far = (r - G) / (F - G);
      sunflower(mb, [ox + x, oy, oz + z], 1.4 + far * 0.6 + hh * 0.35, look, rnd);
    }
  }
  const spots: Vec3[] = [
    [1.6, 0, -1.2],
    [-1.7, 0, -0.9],
    [1.3, 0, 1.7],
    [-1.2, 0, 1.9],
    [0.3, 0, -6.5],
    [-0.3, 0, -9.5],
  ].map(([x, y, z]): Vec3 => [ox + x!, oy + y!, oz + z!]);
  return {
    kind: 'sunfield',
    meshes: [mb.build()],
    colliders: [{ minX: ox - FAR, minY: oy - 0.5, minZ: oz - FAR, maxX: ox + FAR, maxY: oy, maxZ: oz + FAR }],
    spawn: { pos: [ox, oy, oz], yaw: 0 },
    // Ясный полдень, как на лугу: солнце высоко за правым плечом, небо голубое, даль видна далеко.
    env: { ambient: [0.25, 0.32, 0.41], fog: [0.28, 0.46, 0.8], fogDensity: 0.006, light: 0.1, decay: 0, haze: 0, key: { dir: [0.4, 0.8, 0.447], color: [0.96, 0.88, 0.66], reach: 9 }, scan: [10, 42] },
    center: [ox, oy, oz],
    radius: W,
    spots,
    exit,
    grass,
  };
};
