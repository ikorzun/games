/**
 * Зелёный луг: «обои по умолчанию». День, синее небо, пологий холм вокруг; жутко тем, что слишком
 * чисто, тихо и горизонт близко. Посреди травы — вещи из дома: дверная коробка без двери, стул
 * спиной к игроку, фонарь, кровать, почтовые ящики.
 *
 * Направление: у игрока yaw 0 смотрит в −z, дверной проём — в 12 м впереди точки появления.
 *
 * Состав (всё из кода): земля со сглаженными нормалями и пятнами цвета по влажности и высоте;
 * пятна-«наклейки» (выгоревшие, сочные, вытоптанные); тропинка от точки появления к двери; пучки
 * травы из узких клиньев, кочки, метёлки; цветы; берёзы, ивы, шиповник, ивняк; дальняя полоса
 * леса; небо с градиентом и кучевые облака. Свет здесь задан формой и оттенками вершин: у кроны
 * низ темнее верха, у травы корень темнее кончика.
 */
import type { Vec3 } from '../core/types';
import { ColliderSet } from './colliders';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { beam, sheet } from './props_more';
import type { PocketBuilder, PocketSpace } from './pockets';

const R_WALK = 27;
const HALF = 48;
/** Шаг сетки земли, м. */
const GSTEP = 1.5;
const GN = Math.round((2 * HALF) / GSTEP);

/** Детерминированный разброс. */
function lcg(seed: number): () => number {
  let s = Math.imul(seed ^ 0x2545f491, 0x9e3779b1) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Хеш решётки → [0,1). */
function hash2(ix: number, iz: number, s: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Гладкий шум значений, [0,1]. */
function vnoise(x: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, s);
  const b = hash2(ix + 1, iz, s);
  const c = hash2(ix, iz + 1, s);
  const d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Три октавы шума, [0,1]. */
function fbm(x: number, z: number, s: number): number {
  return vnoise(x, z, s) * 0.55 + vnoise(x * 2.1, z * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, z * 4.3, s + 2) * 0.15;
}

/** Тропинка: от точки появления (z = 0) к дверной коробке (z = −12), плавной буквой S. */
const PATH_Z0 = 1.4;
const PATH_Z1 = -12.3;
const pathX = (z: number): number => 0.8 * Math.sin((2 * Math.PI * -z) / 12);
const pathDist = (x: number, z: number): number => {
  const zc = Math.min(PATH_Z0, Math.max(PATH_Z1, z));
  return Math.hypot((x - pathX(zc)) * 0.92, z - zc);
};

/** Предметы на лугу: x, z, радиус вытоптанного пятна. Вокруг них земля ровная, трава примята. */
const OBJ: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 1.3],
  [0, -12, 1.5],
  [2.3, -10.6, 1.4],
  [3, -5, 0.85],
  [-7, -9, 0.8],
  [-10, 4, 1.8],
  [8, -9, 0.7],
  [9.1, -9, 0.7],
  [10.2, -9, 0.7],
  [11.3, -9, 0.7],
];
/** Близость к ближайшему предмету в его радиусах: <1 — внутри пятна. */
const objNear = (x: number, z: number): number => {
  let m = 99;
  for (const [ox, oz, r] of OBJ) m = Math.min(m, Math.hypot(x - ox, z - oz) / r);
  return m;
};

interface Vtx {
  p: Vec3;
  n: Vec3;
  t: Vec3;
  ao: number;
}

export const buildMeadow: PocketBuilder = (seed, origin): PocketSpace => {
  const [ox, oy, oz] = origin;
  const rnd = lcg(seed);
  const ns = (seed * 7919) | 0;
  const noise = (x: number, z: number, s: number): number => vnoise(x, z, s + ns);
  const fb = (x: number, z: number, s: number): number => fbm(x, z, s + ns);
  const mb = new MeshBuilder();
  const cs = new ColliderSet();
  const at = (x: number, y: number, z: number): Vec3 => [ox + x, oy + y, oz + z];
  const range = (a: number, b: number): number => a + (b - a) * rnd();

  /**
   * Высота земли. В круге ходьбы пол для физики плоский (y = 0), поэтому неровности там только
   * на сантиметры и гаснут у предметов и тропинки; дальше холм растёт до +6 м.
   */
  const gy = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const s = smooth((r - 26) / 30);
    const bump = 0.7 * Math.sin(x * 0.13 + 1) * Math.sin(z * 0.11 + 2) + 0.4 * Math.sin((x + z) * 0.21);
    const calm = smooth((objNear(x, z) - 0.9) / 0.8) * smooth((pathDist(x, z) - 0.3) / 0.6);
    const micro = (noise(x * 0.32, z * 0.32, 11) - 0.5) * 0.04 * calm * (1 - s);
    const rolling = (noise(x * 0.17, z * 0.17, 13) - 0.5) * 1.1 * s;
    return 6 * s + bump * s + micro + rolling;
  };
  const gnormal = (x: number, z: number): Vec3 => {
    const e = 0.3;
    return norm3([(gy(x - e, z) - gy(x + e, z)) / (2 * e), 1, (gy(x, z - e) - gy(x, z + e)) / (2 * e)]);
  };

  /** Цвет земли (оттенок под материал canvas): сочнее в ложбинах, светлее на гребнях, пятна выгорания. */
  const LUSH: Vec3 = [0.42, 1.05, 0.26];
  const MID: Vec3 = [0.8, 1.45, 0.45];
  const RIDGE: Vec3 = [1.0, 1.62, 0.5];
  const STRAW: Vec3 = [1.6, 1.4, 0.62];
  const gcol = (x: number, z: number): Vec3 => {
    const hv = noise(x * 0.32, z * 0.32, 11);
    let c = mix3(LUSH, MID, smooth((hv - 0.15) / 0.45));
    c = mix3(c, RIDGE, smooth((hv - 0.55) / 0.35));
    c = mul3(c, 0.7 + 0.62 * fb(x * 0.09, z * 0.09, 21));
    c = mix3(c, mul3(MID, 0.85), 0.25 * noise(x * 0.8, z * 0.8, 24));
    const dry = smooth((fb(x * 0.16, z * 0.16, 23) - 0.58) / 0.1) * 0.85;
    c = mix3(c, STRAW, dry);
    const tr = 1 - smooth(objNear(x, z));
    return mix3(c, [0.95, 0.98, 0.5], tr * 0.75);
  };

  // ---------- Земля: сглаженные нормали, цвет по вершинам ----------
  const gi: number[][] = [];
  for (let i = 0; i <= GN; i++) {
    const row: number[] = [];
    for (let j = 0; j <= GN; j++) {
      const x = -HALF + i * GSTEP;
      const z = -HALF + j * GSTEP;
      row.push(mb.vertex(at(x, gy(x, z), z), gnormal(x, z), MAT.canvas, gcol(x, z), 1));
    }
    gi.push(row);
  }
  for (let i = 0; i < GN; i++) {
    for (let j = 0; j < GN; j++) {
      const a = gi[i]![j]!;
      const b = gi[i]![j + 1]!;
      const c = gi[i + 1]![j]!;
      const d = gi[i + 1]![j + 1]!;
      mb.tri(a, b, c);
      mb.tri(c, b, d);
    }
  }
  cs.addBox(ox - R_WALK, oy - 0.5, oz - R_WALK, ox + R_WALK, oy, oz + R_WALK);

  /** Круговая «наклейка» на землю: в середине свой цвет, к краю — цвет земли, швов не видно. */
  let decalNo = 0;
  const patch = (cx: number, cz: number, rx: number, rz: number, centre: Vec3, mat: number = MAT.canvas, k = 10): void => {
    const lift = 0.04 + (decalNo++ % 4) * 0.004;
    const rot = rnd() * Math.PI * 2;
    const ic = mb.vertex(at(cx, gy(cx, cz) + lift, cz), gnormal(cx, cz), mat, centre, 1);
    const ring: number[] = [];
    for (let i = 0; i < k; i++) {
      const a = rot + (i / k) * Math.PI * 2;
      const rr = 0.72 + 0.4 * rnd();
      const x = cx + Math.cos(a) * rx * rr;
      const z = cz + Math.sin(a) * rz * rr;
      ring.push(mb.vertex(at(x, gy(x, z) + lift, z), gnormal(x, z), mat, mat === MAT.canvas ? gcol(x, z) : mul3(centre, 0.8), 1));
    }
    for (let i = 0; i < k; i++) mb.tri(ic, ring[(i + 1) % k]!, ring[i]!);
  };
  const okSpot = (x: number, z: number, minD: number, minN: number): boolean => pathDist(x, z) > minD && objNear(x, z) > minN;
  // Выгоревшие плеши.
  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + Math.sqrt(rnd()) * 22;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!okSpot(x, z, 1.2, 1.5)) continue;
    patch(x, z, range(0.8, 2.2), range(0.7, 1.7), mul3(STRAW, range(0.88, 1.08)));
  }
  // Сочные тёмные пятна.
  for (let i = 0; i < 20; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 3 + Math.sqrt(rnd()) * 23;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!okSpot(x, z, 1.2, 1.5)) continue;
    patch(x, z, range(1, 2.6), range(0.9, 2), mul3(LUSH, range(0.8, 1)));
  }
  // Голая земля: редкие проплешины.
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 5 + Math.sqrt(rnd()) * 18;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!okSpot(x, z, 1.5, 1.6)) continue;
    patch(x, z, range(0.35, 0.8), range(0.3, 0.7), [1.25, 1.05, 0.75], MAT.dirt, 8);
  }
  // Вытоптанные пятна под предметами.
  for (const [x, z, r] of OBJ.slice(1)) patch(x, z, r * 1.15, r * 1.05, [0.95, 0.92, 0.45], MAT.canvas, 12);

  // ---------- Тропинка: примятая трава лентой вдоль S-кривой ----------
  {
    const PW = [-0.72, -0.4, 0, 0.4, 0.72];
    const rows: number[][] = [];
    const NS = 50;
    for (let k = 0; k <= NS; k++) {
      const z = PATH_Z0 - ((PATH_Z0 - PATH_Z1) * k) / NS;
      const cx = pathX(z);
      const wob = 0.5 + 0.5 * noise(z * 0.9, 3, 31);
      const row: number[] = [];
      for (let m = 0; m < PW.length; m++) {
        const x = cx + PW[m]! * (0.85 + 0.3 * noise(z * 1.3, m, 32));
        const edge = m === 0 || m === PW.length - 1;
        const mid = m === 2 ? 1 : m === 1 || m === 3 ? 0.7 : 0;
        const worn: Vec3 = mix3([1.6, 1.58, 0.85], [1.3, 1.25, 0.68], wob);
        const c = edge ? gcol(x, z) : mix3(gcol(x, z), worn, 0.5 + 0.4 * mid);
        row.push(mb.vertex(at(x, gy(x, z) + 0.06, z), gnormal(x, z), MAT.canvas, c, 1));
      }
      rows.push(row);
    }
    for (let k = 0; k < NS; k++) {
      for (let m = 0; m < PW.length - 1; m++) {
        const a = rows[k]![m]!;
        const b = rows[k]![m + 1]!;
        const c = rows[k + 1]![m]!;
        const d = rows[k + 1]![m + 1]!;
        // z убывает по k, x растёт по m: порядок (a, b, c) смотрит вверх.
        mb.tri(a, b, c);
        mb.tri(b, d, c);
      }
    }
  }

  // ---------- Общие кирпичики: клин травы, диск-цветок, сферическая сетка, труба ----------
  /** Один клин-листик: треугольник, виден с обеих сторон; корень тёмный, кончик светлый. */
  const blade = (x: number, y: number, z: number, h: number, w: number, ang: number, lean: number, base: Vec3, tip: Vec3): void => {
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const n = norm3([dx * 0.45 * lean, 1, dz * 0.45 * lean]);
    const i0 = mb.vertex(at(x - dz * w, y, z + dx * w), n, MAT.canvas, base, 0.62);
    const i1 = mb.vertex(at(x + dz * w, y, z - dx * w), n, MAT.canvas, base, 0.62);
    const i2 = mb.vertex(at(x + dx * lean * h, y + h * (1 - 0.22 * lean), z + dz * lean * h), n, MAT.canvas, tip, 1);
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i1);
  };
  /** Пучок травы: несколько клиньев от одного корня; цвет берётся с земли в этой точке. */
  const clump = (x: number, z: number, h: number, nb: number, spread: number, warm = 0): void => {
    const y = gy(x, z) - 0.03;
    const g = gcol(x, z);
    const gl = mix3(g, STRAW, warm);
    const base = mul3(gl, 0.62);
    for (let i = 0; i < nb; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      const hh = h * range(0.55, 1.1);
      const tip: Vec3 = [gl[0] * range(1.12, 1.4), gl[1] * range(1.1, 1.3), gl[2] * range(0.95, 1.15)];
      blade(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, hh, 0.022 + 0.05 * hh, rnd() * Math.PI * 2, range(0.12, 0.6), base, tip);
    }
  };
  /** Плоский диск или звезда: цветок, лепесток, соцветие. normal — куда смотрит лицо. */
  const fanDisc = (c: Vec3, nrm: Vec3, rad: number, k: number, mat: number, tc: Vec3, te: Vec3, star = 1, aoC = 1, aoE = 1): void => {
    const n = norm3(nrm);
    const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm3(cross3(ref, n));
    const v = cross3(n, u);
    const rot = rnd() * Math.PI * 2;
    const pts = star === 1 ? k : k * 2;
    const ic = mb.vertex(at(c[0], c[1], c[2]), n, mat, tc, aoC);
    const ring: number[] = [];
    for (let i = 0; i < pts; i++) {
      const a = rot + (i / pts) * Math.PI * 2;
      const r = rad * (star !== 1 && i % 2 === 1 ? star : 1);
      const p: Vec3 = [c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r];
      ring.push(mb.vertex(at(p[0], p[1], p[2]), n, mat, te, aoE));
    }
    for (let i = 0; i < pts; i++) mb.tri(ic, ring[i]!, ring[(i + 1) % pts]!);
  };
  /**
   * Сетка по сфере (полюс сверху/снизу по желанию). Обход наружу; inward — лицом внутрь (небо).
   * f даёт точку, нормаль, оттенок и AO по углам (θ от верхнего полюса, φ вокруг).
   */
  const sphereGrid = (thetas: readonly number[], seg: number, f: (th: number, ph: number) => Vtx, mat: number, inward: boolean, topPole: boolean, bottomPole: boolean): void => {
    const mk = (th: number, ph: number): number => {
      const v = f(th, ph);
      return mb.vertex(at(v.p[0], v.p[1], v.p[2]), v.n, mat, v.t, v.ao);
    };
    const rings: number[][] = thetas.map((th) => Array.from({ length: seg }, (_, j) => mk(th, (j / seg) * Math.PI * 2)));
    const tri = (a: number, b: number, c: number): void => (inward ? mb.tri(a, c, b) : mb.tri(a, b, c));
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        tri(rings[k]![j]!, rings[k]![j1]!, rings[k + 1]![j]!);
        tri(rings[k]![j1]!, rings[k + 1]![j1]!, rings[k + 1]![j]!);
      }
    }
    if (topPole) {
      const p = mk(0, 0);
      for (let j = 0; j < seg; j++) tri(p, rings[0]![(j + 1) % seg]!, rings[0]![j]!);
    }
    if (bottomPole) {
      const last = rings[rings.length - 1]!;
      const p = mk(Math.PI, 0);
      for (let j = 0; j < seg; j++) tri(p, last[j]!, last[(j + 1) % seg]!);
    }
  };
  const evenThetas = (rings: number): number[] => Array.from({ length: rings }, (_, k) => (Math.PI * (k + 1)) / (rings + 1));
  /** Комок листвы: неровный эллипсоид, верх светлее низа. */
  const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, top: Vec3, bot: Vec3, jag = 0.22, rings = 3, seg = 8, mat: number = MAT.canvas): void => {
    sphereGrid(
      evenThetas(rings),
      seg,
      (th, ph) => {
        const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        const j = 1 + jag * (rnd() - 0.5) * 2;
        const up = (d[1] + 1) / 2;
        return { p: [cx + d[0] * rx * j, cy + d[1] * ry * j, cz + d[2] * rz * j], n: norm3([d[0], d[1] * 0.9 + 0.2, d[2]]), t: mul3(mix3(bot, top, up), range(0.88, 1.12)), ao: 0.5 + 0.5 * up };
      },
      mat,
      false,
      true,
      true,
    );
  };
  /** Труба по ломаной (ствол, ветка, прут): кольца с радиусом и оттенком в каждой точке. */
  const tube = (pts: readonly Vec3[], radii: readonly number[], tints: readonly Vec3[], mat: number, seg = 6): void => {
    const rings: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)]!;
      const p1 = pts[Math.min(pts.length - 1, i + 1)]!;
      const t = norm3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
      const ref: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm3(cross3(ref, t));
      const v = cross3(t, u);
      const row: number[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const d: Vec3 = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
        const r = radii[i]!;
        const p = pts[i]!;
        row.push(mb.vertex(at(p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r), d, mat, tints[i]!, 0.8 + 0.2 * (i / (pts.length - 1))));
      }
      rings.push(row);
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        mb.tri(rings[i]![j]!, rings[i]![j1]!, rings[i + 1]![j1]!);
        mb.tri(rings[i]![j]!, rings[i + 1]![j1]!, rings[i + 1]![j]!);
      }
    }
  };

  // ---------- Небо: купол с плавным градиентом ----------
  {
    const RS = 45;
    // Ключевые высоты (градусы над горизонтом) → цвет свечения: дымка у земли, густая синева в зените.
    const stops: Array<[number, Vec3]> = [
      [-18, [60, 92, 128]],
      [0, [88, 120, 150]],
      [5, [62, 98, 140]],
      [14, [30, 70, 134]],
      [30, [12, 46, 122]],
      [55, [4, 30, 102]],
      [90, [1, 18, 80]],
    ];
    const skyAt = (lat: number, lon: number): Vec3 => {
      let k = 0;
      while (k < stops.length - 2 && lat > stops[k + 1]![0]) k++;
      const [l0, c0] = stops[k]!;
      const [l1, c1] = stops[k + 1]!;
      const c = mix3(c0, c1, smooth((lat - l0) / (l1 - l0)));
      // Лёгкое осветление дымки с одной стороны (там, где «стоит» невидимое солнце).
      const glare = Math.max(0, Math.cos(lon - 2.2)) * Math.exp(-Math.max(0, lat) / 22);
      return mix3(c, [110, 130, 140], glare * 0.3);
    };
    const lats = [80, 68, 54, 40, 28, 19, 12, 7, 3, 0, -6, -18];
    const thetas = lats.map((l) => ((90 - l) * Math.PI) / 180);
    sphereGrid(
      thetas,
      32,
      (th, ph) => {
        const lat = 90 - (th * 180) / Math.PI;
        const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        return { p: [d[0] * RS, d[1] * RS, d[2] * RS], n: [-d[0], -d[1], -d[2]], t: skyAt(lat, ph), ao: 1 };
      },
      MAT.glow,
      true,
      true,
      false,
    );

    // Кучевые облака: комки с плоским тёмным низом. [азимут°, высота°, ширина, число комков].
    const clouds: Array<[number, number, number, number]> = [
      [-22, 21, 11, 8],
      [20, 31, 13, 9],
      [52, 17, 9, 6],
      [-58, 27, 11, 7],
      [100, 23, 8, 6],
      [158, 30, 12, 8],
      [-128, 19, 10, 7],
      [-4, 44, 8, 5],
      [78, 41, 9, 6],
      [-96, 39, 9, 6],
      [208, 36, 7, 5],
    ];
    for (const [az, el, w, nb] of clouds) {
      const dist = 36 + rnd() * 5;
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      const c: Vec3 = [Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist, -Math.cos(a) * Math.cos(e) * dist];
      // Касательная вдоль горизонта.
      const tx = Math.cos(a);
      const tz = Math.sin(a);
      for (let k = 0; k < nb; k++) {
        const u = nb === 1 ? 0 : k / (nb - 1) - 0.5;
        const prof = 1 - Math.abs(u) * 1.2;
        const rx = w * (0.16 + 0.14 * prof) * range(0.85, 1.15);
        const ry = rx * range(0.55, 0.75);
        const off = u * w * 0.95;
        const lift = ry * 0.5 * prof + rnd() * 0.5;
        const cx = c[0] + tx * off;
        const cy = c[1] + lift;
        const cz = c[2] + tz * off;
        sphereGrid(
          evenThetas(3),
          8,
          (th, ph) => {
            const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
            const j = 1 + 0.07 * (rnd() - 0.5);
            const dy = d[1] < 0 ? d[1] * 0.28 : d[1];
            // Освещённость: сверху и со стороны невидимого солнца светлее, низ плоский и серо-синий.
            const l = d[0] * 0.5 + d[1] * 0.65 - d[2] * 0.55;
            const t = Math.min(smooth((l + 0.3) / 1.3), smooth((d[1] + 0.15) / 0.8));
            return { p: [cx + d[0] * rx * j, cy + dy * ry * j, cz + d[2] * rx * j], n: d, t: mix3([84, 100, 124], [154, 158, 160], t), ao: 1 };
          },
          MAT.glow,
          false,
          true,
          true,
        );
      }
    }
  }

  // ---------- Дальний лес: две полосы силуэтов у кромки холма, синеватые от дымки ----------
  {
    /** Полоса крон: у каждой кроны своя высота, верх округлый, между кронами — просветы. */
    const strip = (rad: number, hBase: number, hVar: number, n1: number, n2: number, top: Vec3, bot: Vec3, s: number): void => {
      const NSEG = 360;
      const rows: number[][] = [];
      const bump = (a: number, n: number, sd: number): number => {
        const cell = ((a / (Math.PI * 2)) * n) + sd;
        const ci = Math.floor(cell);
        const f = cell - ci;
        const hc = 0.5 + 0.5 * hash2(ci, 7, Math.floor(s * 100) + ns);
        return hc * Math.pow(Math.sqrt(Math.max(0, 1 - (2 * f - 1) * (2 * f - 1))), 0.75);
      };
      for (let k = 0; k <= NSEG; k++) {
        const a = (k / NSEG) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        const g = gy(x, z);
        const crown = Math.max(bump(a, n1, 0), 0.8 * bump(a, n2, 0.37));
        const h = hBase + hVar * crown * (0.7 + 0.5 * noise(a * 7, s, 41));
        const nrm = norm3([-x, 0.25, -z]);
        const vv = (y: number, t: Vec3): number => mb.vertex(at(x, y, z), nrm, MAT.glow, t, 1);
        rows.push([vv(g - 0.6, bot), vv(g + h, top)]);
      }
      for (let k = 0; k < NSEG; k++) {
        const a = rows[k]![0]!;
        const b = rows[k]![1]!;
        const c = rows[k + 1]![0]!;
        const d = rows[k + 1]![1]!;
        // Лицом к центру: угол растёт вправо от наблюдателя внутри, вверх — вторая вершина.
        mb.tri(a, c, b);
        mb.tri(b, c, d);
      }
    };
    strip(43.5, 1.0, 3.4, 58, 91, [22, 40, 56], [58, 84, 106], 1.3);
    strip(40, 0.7, 2.4, 47, 73, [14, 32, 36], [42, 62, 72], 4.1);
  }

  // ---------- Пучки травы, кочки, метёлки ----------
  const spreadOK = (x: number, z: number): { h: number; ok: boolean } => {
    const pd = pathDist(x, z);
    const on = objNear(x, z);
    if (pd < 0.55 || on < 0.8) return { h: 0, ok: false };
    // У тропы и у предметов трава короче, подальше — выше.
    const sc = 0.55 + 0.45 * smooth((pd - 0.55) / 1.4) * smooth((on - 0.8) / 1.2);
    return { h: sc, ok: true };
  };
  const clumpCount = { n: 0 };
  const sprinkle = (count: number, rMin: number, rMax: number, density: (r: number) => number): void => {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rMin + Math.sqrt(rnd()) * (rMax - rMin);
      if (rnd() > density(r)) continue;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const s = spreadOK(x, z);
      if (!s.ok) continue;
      const tall = rnd() < 0.08;
      const h = (tall ? range(0.35, 0.5) : range(0.1, 0.35) * (0.8 + 0.4 * noise(x * 0.5, z * 0.5, 51))) * s.h;
      clump(x, z, h, tall || h > 0.2 ? 6 : 5, 0.08 + h * 0.3, noise(x * 0.16, z * 0.16, 23) > 0.55 ? 0.7 : 0);
      clumpCount.n++;
    }
  };
  sprinkle(1350, 0.6, 9, (r) => 1 - 0.3 * (r / 9));
  sprinkle(1050, 9, 20, (r) => 0.8 - 0.55 * ((r - 9) / 11));
  sprinkle(260, 20, 36, () => 0.7);
  // Гуще у тропы и у предметов.
  for (let k = 0; k < 130; k++) {
    const z = range(PATH_Z1 + 0.4, PATH_Z0);
    const side = rnd() < 0.5 ? -1 : 1;
    const x = pathX(z) + side * range(0.6, 1.2);
    if (!spreadOK(x, z).ok) continue;
    clump(x, z, range(0.14, 0.36), 5, 0.12, 0);
  }
  for (const [px, pz, r] of OBJ.slice(1)) {
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * range(1.0, 1.9);
      const x = px + Math.cos(a) * rr;
      const z = pz + Math.sin(a) * rr;
      if (!spreadOK(x, z).ok) continue;
      clump(x, z, range(0.15, 0.4), 5, 0.12, 0);
    }
  }
  // Кочки: тёмный холмик с густым пучком наверху.
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2.5 + Math.sqrt(rnd()) * 22;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!okSpot(x, z, 1.1, 1.4)) continue;
    const rad = range(0.2, 0.38);
    const hh = range(0.08, 0.18);
    const y = gy(x, z);
    const g = gcol(x, z);
    sphereGrid(
      evenThetas(3),
      7,
      (th, ph) => {
        const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        const dy = Math.max(d[1], -0.2);
        return { p: [x + d[0] * rad, y + dy * hh * 1.2 - 0.02, z + d[2] * rad], n: norm3([d[0] * 0.6, 1, d[2] * 0.6]), t: mul3(mix3(g, [0.7, 0.85, 0.4], 0.35), range(0.75, 0.95)), ao: 0.7 + 0.3 * Math.max(0, d[1]) };
      },
      MAT.canvas,
      false,
      true,
      false,
    );
    for (let k = 0; k < 3; k++) clump(x + range(-0.1, 0.1), z + range(-0.1, 0.1), range(0.3, 0.5), 6, 0.1, 0.2);
  }
  // Метёлки злаков: тонкий стебель и колос, группами.
  const panicle = (x: number, z: number, h: number): void => {
    const y = gy(x, z) - 0.02;
    const ang = rnd() * Math.PI * 2;
    const lean = range(0.08, 0.3);
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const tx = x + dx * lean * h;
    const tz = z + dz * lean * h;
    const stalk: Vec3 = [0.55, 1.2, 0.35];
    const i0 = mb.vertex(at(x - dz * 0.006, y, z + dx * 0.006), [0, 1, 0], MAT.canvas, stalk, 0.6);
    const i1 = mb.vertex(at(x + dz * 0.006, y, z - dx * 0.006), [0, 1, 0], MAT.canvas, stalk, 0.6);
    const i2 = mb.vertex(at(tx, y + h, tz), [0, 1, 0], MAT.canvas, [0.9, 1.45, 0.5], 1);
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i1);
    // Колос: узкий ромб, чуть наклонён по ходу стебля.
    const hl = range(0.07, 0.12);
    const head: Vec3 = rnd() < 0.65 ? [1.5, 1.38, 0.7] : [1.15, 0.85, 1.05];
    const hw = 0.016;
    const b0 = mb.vertex(at(tx, y + h, tz), [0, 1, 0], MAT.canvas, mul3(head, 0.8), 0.8);
    const b1 = mb.vertex(at(tx + dx * 0.02 - dz * hw, y + h + hl * 0.45, tz + dz * 0.02 + dx * hw), [0, 1, 0], MAT.canvas, head, 1);
    const b2 = mb.vertex(at(tx + dx * 0.02 + dz * hw, y + h + hl * 0.45, tz + dz * 0.02 - dx * hw), [0, 1, 0], MAT.canvas, head, 1);
    const b3 = mb.vertex(at(tx + dx * 0.05, y + h + hl, tz + dz * 0.05), [0, 1, 0], MAT.canvas, mul3(head, 1.1), 1);
    mb.tri(b0, b1, b2);
    mb.tri(b0, b2, b1);
    mb.tri(b1, b3, b2);
    mb.tri(b1, b2, b3);
  };
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + Math.sqrt(rnd()) * 24;
    const cx = Math.sin(a) * r;
    const cz = -Math.cos(a) * r;
    const n = 3 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const x = cx + range(-0.5, 0.5);
      const z = cz + range(-0.5, 0.5);
      if (!spreadOK(x, z).ok) continue;
      panicle(x, z, range(0.4, 0.65));
    }
  }

  // ---------- Цветы: группами, не поодиночке ----------
  const stem = (x: number, z: number, h: number, lx: number, lz: number): Vec3 => {
    const y = gy(x, z) - 0.02;
    const c: Vec3 = [0.5, 1.15, 0.32];
    const i0 = mb.vertex(at(x - 0.004, y, z), [0, 1, 0], MAT.canvas, c, 0.6);
    const i1 = mb.vertex(at(x + 0.004, y, z), [0, 1, 0], MAT.canvas, c, 0.6);
    const top: Vec3 = [x + lx, y + h, z + lz];
    const i2 = mb.vertex(at(top[0], top[1], top[2]), [0, 1, 0], MAT.canvas, [0.7, 1.4, 0.4], 1);
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i1);
    return top;
  };
  const flowerGroup = (cx: number, cz: number, kind: number): void => {
    const n = kind === 3 ? 3 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const x = cx + range(-0.9, 0.9);
      const z = cz + range(-0.9, 0.9);
      if (!spreadOK(x, z).ok) continue;
      const lx = range(-0.04, 0.04);
      const lz = range(-0.04, 0.04);
      if (kind === 0) {
        // Ромашка: белая звезда, жёлтая серединка.
        const h = range(0.2, 0.36);
        const t = stem(x, z, h, lx, lz);
        const nn: Vec3 = [lx * 6, 1, lz * 6];
        fanDisc(t, nn, range(0.048, 0.066), 5, MAT.plaster, [1.7, 1.7, 1.55], [1.65, 1.65, 1.6], 0.5);
        fanDisc([t[0], t[1] + 0.004, t[2]], nn, 0.02, 4, MAT.paintOchre, [1.9, 1.5, 0.3], [1.7, 1.25, 0.25]);
      } else if (kind === 1) {
        // Клевер: розово-сиреневый шарик на невысоком стебле.
        const h = range(0.08, 0.2);
        const t = stem(x, z, h, lx * 0.5, lz * 0.5);
        const tint: Vec3 = rnd() < 0.8 ? [1.6, 0.75, 1.25] : [1.7, 1.55, 1.5];
        fanDisc([t[0], t[1] + 0.012, t[2]], [lx * 4, 1, lz * 4], 0.036, 5, MAT.canvas, mul3(tint, 1.1), tint);
        fanDisc([t[0], t[1] + 0.003, t[2]], [0, 1, 0], 0.045, 3, MAT.canvas, [0.45, 1.05, 0.3], [0.6, 1.3, 0.38], 0.55, 0.7, 1);
      } else if (kind === 2) {
        // Лютик: жёлтая пятилепестковая чашечка.
        const h = range(0.15, 0.3);
        const t = stem(x, z, h, lx, lz);
        fanDisc(t, [lx * 5, 1, lz * 5], range(0.034, 0.046), 5, MAT.paintOchre, [1.9, 1.55, 0.2], [1.8, 1.4, 0.15], 0.8);
      } else {
        // Одуванчик: розетка листьев у земли, жёлтая головка или пушистый шарик.
        const y = gy(x, z);
        fanDisc([x, y + 0.03, z], [0, 1, 0], range(0.1, 0.16), 5, MAT.canvas, [0.4, 0.95, 0.28], [0.6, 1.25, 0.36], 0.45, 0.6, 1);
        const h = range(0.1, 0.3);
        const t = stem(x, z, h, lx, lz);
        if (rnd() < 0.7) fanDisc([t[0], t[1] + 0.006, t[2]], [lx * 4, 1, lz * 4], 0.055, 6, MAT.paintOchre, [1.9, 1.5, 0.15], [1.8, 1.35, 0.12]);
        else {
          // Пушистый шарик: два ромба-диска крест-накрест.
          for (let q = 0; q < 2; q++) fanDisc([t[0], t[1] + 0.03, t[2]], [Math.cos(q * 1.6), 0.2, Math.sin(q * 1.6)], 0.042, 5, MAT.plaster, [1.6, 1.62, 1.55], [1.3, 1.35, 1.35]);
        }
      }
    }
  };
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2.5 + Math.sqrt(rnd()) * 20;
    flowerGroup(Math.sin(a) * r, -Math.cos(a) * r, i % 4);
  }
  // Цветы по краям тропы: редкая россыпь.
  for (let i = 0; i < 8; i++) {
    const z = range(PATH_Z1 + 1, PATH_Z0 - 1);
    flowerGroup(pathX(z) + (rnd() < 0.5 ? -1 : 1) * range(1.2, 2), z, (i % 3) as number);
  }

  // ---------- Деревья ----------
  /** Берёза: светлый ствол с тёмными метинами, ветки и крона из неровных комков. */
  const birch = (x: number, z: number, h: number): void => {
    const y0 = gy(x, z) - 0.2;
    const lx = range(-0.5, 0.5);
    const lz = range(-0.5, 0.5);
    const bx = range(-0.3, 0.3);
    const bz = range(-0.3, 0.3);
    const N = Math.max(7, Math.round(h / 0.6));
    const pts: Vec3[] = [];
    const radii: number[] = [];
    const tints: Vec3[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push([x + lx * t * t + bx * Math.sin(t * 3.1), y0 + h * t, z + lz * t * t + bz * Math.sin(t * 3.1)]);
      radii.push(0.14 * (1 - 0.72 * t) * (i === 0 ? 1.3 : 1));
      const mark = i > 1 && i < N - 1 && rnd() < 0.34;
      tints.push(i < 2 ? [0.42, 0.38, 0.33] : mark ? [0.3, 0.28, 0.26] : mul3([1.55, 1.52, 1.42], range(0.9, 1.08)));
    }
    tube(pts, radii, tints, MAT.plaster, 5);
    cs.addBox(ox + x - 0.2, oy, oz + z - 0.2, ox + x + 0.2, oy + 4, oz + z + 0.2);
    const topC = pts[N]!;
    const top: Vec3 = [1.0, 1.72, 0.42];
    const bot: Vec3 = [0.42, 0.78, 0.24];
    blob(topC[0], topC[1] - 0.2, topC[2], range(0.9, 1.2), range(0.8, 1.0), range(0.9, 1.2), top, bot, 0.25, 3, 8);
    const nbr = 5 + Math.floor(rnd() * 2);
    for (let k = 0; k < nbr; k++) {
      const f = range(0.5, 0.86);
      const iBase = Math.min(N - 1, Math.round(f * N));
      const p0 = pts[iBase]!;
      const a = rnd() * Math.PI * 2;
      const len = range(0.9, 1.7);
      const rise = range(0.5, 1.1);
      const e: Vec3 = [p0[0] + Math.cos(a) * len, p0[1] + rise, p0[2] + Math.sin(a) * len];
      const m: Vec3 = [(p0[0] + e[0]) / 2, (p0[1] + e[1]) / 2 - 0.05, (p0[2] + e[2]) / 2];
      tube([p0, m, e], [0.045, 0.03, 0.015], [[1.2, 1.15, 1.05], [0.9, 0.85, 0.75], [0.6, 0.55, 0.5]], MAT.plaster, 4);
      blob(e[0], e[1] + 0.05, e[2], range(0.75, 1.15), range(0.6, 0.85), range(0.75, 1.15), top, bot, 0.25, 3, 8);
      if (rnd() < 0.4) blob(m[0] + Math.cos(a) * 0.1, m[1] + 0.25, m[2] + Math.sin(a) * 0.1, range(0.5, 0.75), range(0.4, 0.55), range(0.5, 0.75), mul3(top, 0.95), bot, 0.25, 3, 7);
    }
  };
  /** Ива: низкий раздвоенный ствол, шапка кроны и свисающие плети. */
  const willow = (x: number, z: number, h: number): void => {
    const y0 = gy(x, z) - 0.25;
    const bark: Vec3 = [0.95, 0.9, 0.72];
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2 + range(-0.4, 0.4);
      const e: Vec3 = [x + Math.cos(a) * range(0.5, 0.9), y0 + h * range(0.7, 0.9), z + Math.sin(a) * range(0.5, 0.9)];
      const m: Vec3 = [x + (e[0] - x) * 0.3, y0 + h * 0.35, z + (e[2] - z) * 0.3];
      tube([[x, y0, z], m, e], [0.2, 0.15, 0.08], [mul3(bark, 0.55), bark, mul3(bark, 1.1)], MAT.wood, 6);
    }
    cs.addBox(ox + x - 0.3, oy, oz + z - 0.3, ox + x + 0.3, oy + 3, oz + z + 0.3);
    const top: Vec3 = [0.92, 1.55, 0.58];
    const bot: Vec3 = [0.4, 0.78, 0.3];
    const cy = y0 + h * 0.92;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + range(-0.3, 0.3);
      const rr = k === 0 ? 0 : range(0.9, 1.5);
      blob(x + Math.cos(a) * rr, cy + range(-0.2, 0.3), z + Math.sin(a) * rr, range(1.0, 1.5), range(0.7, 1.0), range(1.0, 1.5), top, bot, 0.25, 3, 9);
    }
    // Плети: четыре точки, лента сужается к кончику; видна с двух сторон.
    for (let k = 0; k < 64; k++) {
      const a = rnd() * Math.PI * 2;
      const r0 = range(0.7, 1.9);
      const drop = range(h * 0.55, h * 0.95);
      const sway = range(0.1, 0.35);
      const p: Vec3[] = [];
      for (let q = 0; q < 4; q++) {
        const t = q / 3;
        const rr = r0 + sway * Math.sin(t * Math.PI * 0.9) + 0.25 * t;
        p.push([x + Math.cos(a) * rr, cy - 0.15 - drop * t * t * 0.9 - drop * 0.1 * t, z + Math.sin(a) * rr]);
      }
      const n = norm3([Math.cos(a) * 0.7, 0.5, Math.sin(a) * 0.7]);
      const wdt = [0.085, 0.07, 0.05, 0.015];
      const cols: Vec3[] = [mul3(top, 0.75), top, mix3(top, [1.2, 1.6, 0.6], 0.5), [1.15, 1.55, 0.55]];
      const L: number[] = [];
      const Rr: number[] = [];
      for (let q = 0; q < 4; q++) {
        const px = -Math.sin(a) * wdt[q]!;
        const pz = Math.cos(a) * wdt[q]!;
        const aoV = 0.55 + 0.45 * (q / 3);
        L.push(mb.vertex(at(p[q]![0] - px, p[q]![1], p[q]![2] - pz), n, MAT.canvas, cols[q]!, aoV));
        Rr.push(mb.vertex(at(p[q]![0] + px, p[q]![1], p[q]![2] + pz), n, MAT.canvas, cols[q]!, aoV));
      }
      for (let q = 0; q < 3; q++) {
        mb.tri(L[q]!, Rr[q]!, Rr[q + 1]!);
        mb.tri(L[q]!, Rr[q + 1]!, L[q + 1]!);
        mb.tri(L[q]!, Rr[q + 1]!, Rr[q]!);
        mb.tri(L[q]!, L[q + 1]!, Rr[q + 1]!);
      }
    }
  };
  /** Шиповник: низкий плотный куст с бледно-розовыми цветами по поверхности. */
  const rose = (x: number, z: number, s: number): void => {
    const y = gy(x, z);
    const top: Vec3 = [0.72, 1.4, 0.4];
    const bot: Vec3 = [0.28, 0.62, 0.2];
    const nb = 3 + Math.floor(rnd() * 2);
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + range(-0.5, 0.5);
      const rr = k === 0 ? 0 : s * range(0.4, 0.7);
      const bx = x + Math.cos(a) * rr;
      const bz = z + Math.sin(a) * rr;
      const rx = s * range(0.55, 0.8);
      const ry = s * range(0.42, 0.58);
      const by = y + ry * 0.75;
      blob(bx, by, bz, rx, ry, rx * range(0.9, 1.1), top, bot, 0.3, 3, 9);
      for (let f = 0; f < 3; f++) {
        const fa = rnd() * Math.PI * 2;
        const fe = range(0.15, 0.75);
        const d = norm3([Math.cos(fa) * Math.cos(fe), Math.sin(fe), Math.sin(fa) * Math.cos(fe)]);
        fanDisc([bx + d[0] * rx * 0.97, by + d[1] * ry * 0.97, bz + d[2] * rx * 0.97], d, 0.07, 5, MAT.canvas, [1.8, 1.2, 1.35], [1.65, 0.95, 1.15], 0.75);
      }
    }
  };
  /** Ивняк: пучок прямых прутьев с узкими серебристыми кронами. */
  const sallow = (x: number, z: number, h: number): void => {
    const y0 = gy(x, z) - 0.15;
    const top: Vec3 = [0.88, 1.5, 0.6];
    const bot: Vec3 = [0.4, 0.78, 0.32];
    const n = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + range(-0.5, 0.5);
      const rr = k === 0 ? 0 : range(0.3, 0.9);
      const bx = x + Math.cos(a) * rr;
      const bz = z + Math.sin(a) * rr;
      const hh = h * range(0.7, 1.1);
      tube([[bx, y0, bz], [bx + Math.cos(a) * 0.1, y0 + hh * 0.5, bz + Math.sin(a) * 0.1], [bx + Math.cos(a) * 0.3, y0 + hh, bz + Math.sin(a) * 0.3]], [0.035, 0.022, 0.01], [[0.7, 0.6, 0.45], [0.9, 0.8, 0.6], [1.0, 0.9, 0.7]], MAT.wood, 4);
      blob(bx + Math.cos(a) * 0.25, y0 + hh * 0.72, bz + Math.sin(a) * 0.25, range(0.35, 0.55), hh * range(0.28, 0.38), range(0.35, 0.55), top, bot, 0.28, 3, 7);
    }
  };

  for (const [x, z, h] of [
    [-11, -15, 5.2],
    [13, -16, 5.6],
    [-17, -18, 6.5],
    [-19.5, -15.5, 5.5],
    [-15, -21.5, 7],
    [18, -18, 6],
    [21, -14, 5.2],
    [9, 21, 6.5],
    [-9, 23, 5.8],
    [26, 6, 6.2],
    [-24, -6, 6.4],
  ] as const) {
    birch(x, z, h);
  }
  willow(-21, 6, 5);
  willow(17, 16, 5.5);
  for (const [x, z, s] of [
    [-13, -8, 1.3],
    [9, -17, 1.2],
    [-3, -19, 1.1],
    [12, 11, 1.2],
    [-16, 13, 1.3],
    [5, 18, 1.1],
    [-22, -3, 1.2],
    [20, 3, 1.2],
    [15, -5, 1.0],
    [-8, 10, 1.0],
    [7, -21, 1.2],
  ] as const) {
    rose(x, z, s);
  }
  for (const [x, z, h] of [
    [24, -17, 2.6],
    [-24, -12, 2.4],
    [-25, 11, 2.8],
    [8, 25, 2.5],
    [-14, 26, 2.6],
    [26, -4, 2.3],
  ] as const) {
    sallow(x, z, h);
  }

  // Дверная коробка без двери: в 12 м впереди; створка лежит рядом в траве.
  const white2: Vec3 = [1.25, 1.25, 1.22];
  const door = new Xf(mb, cs, ox, oy, oz - 12);
  door.solid([-0.6, 0, -0.07], [-0.46, 2.1, 0.07], MAT.plaster, { tint: white2, bevel: 0.01, aoBottom: 0.55 });
  door.solid([0.46, 0, -0.07], [0.6, 2.1, 0.07], MAT.plaster, { tint: white2, bevel: 0.01, aoBottom: 0.55 });
  door.box([-0.6, 2.0, -0.07], [0.6, 2.12, 0.07], MAT.plaster, { tint: white2, bevel: 0.01 });
  door.box([-0.46, 0, -0.025], [0.46, 0.015, 0.025], MAT.plaster, { tint: [0.9, 0.9, 0.88] });
  const leaf = new Xf(mb, null, ox + 2.3, oy, oz - 10.6, 1);
  leaf.box([-0.45, 0.02, -1.0], [0.45, 0.06, 1.0], MAT.wood, { tint: [1.5, 1.2, 0.9], bevel: 0.01 });
  leaf.box([0.2, 0.06, -0.55], [0.35, 0.09, -0.4], MAT.brass, { bevel: 0.01 }); // ручка

  // Стул спиной к игроку: сиденье смотрит в −z.
  const chair = new Xf(mb, cs, ox + 3, oy, oz - 5, 2);
  const cw: Vec3 = [1.3, 1.1, 0.8];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) chair.box([sx * 0.19 - 0.025, 0, sz * 0.19 - 0.025], [sx * 0.19 + 0.025, 0.45, sz * 0.19 + 0.025], MAT.wood, { tint: cw, aoBottom: 0.5 });
  }
  chair.box([-0.22, 0.45, -0.22], [0.22, 0.49, 0.22], MAT.wood, { tint: cw, bevel: 0.008 });
  chair.box([-0.2, 0.49, -0.225], [-0.17, 0.95, -0.195], MAT.wood, { tint: cw });
  chair.box([0.17, 0.49, -0.225], [0.2, 0.95, -0.195], MAT.wood, { tint: cw });
  for (const y of [0.62, 0.78, 0.92]) chair.box([-0.2, y, -0.22], [0.2, y + 0.06, -0.2], MAT.wood, { tint: cw });
  chair.collider([-0.24, 0, -0.24], [0.24, 0.95, 0.24]);

  // Уличный фонарь.
  const lamp = new Xf(mb, cs, ox - 7, oy, oz - 9);
  lamp.cyl([0, 0, 0], 'y', 0.35, 0.16, MAT.castIron, { segments: 8, radiusEnd: 0.1 });
  lamp.cyl([0, 0.3, 0], 'y', 4.0, 0.055, MAT.castIron, { segments: 8, caps: false });
  lamp.box([-0.02, 4.2, -0.02], [0.9, 4.28, 0.02], MAT.castIron);
  beam(lamp, [0, 3.5, 0], [0.6, 4.2, 0], 0.03, 0.03, MAT.castIron);
  lamp.box([0.7, 4.0, -0.14], [1.0, 4.04, 0.14], MAT.castIron);
  lamp.box([0.72, 4.04, -0.12], [0.98, 4.2, 0.12], MAT.glow, { tint: [138.5, 141.6, 49.9] });
  lamp.box([0.68, 4.2, -0.16], [1.02, 4.25, 0.16], MAT.castIron, { bevel: 0.01 });
  lamp.collider([-0.1, 0, -0.1], [0.1, 4.2, 0.1]);

  // Кровать с белым бельём, стоит на траве сбоку.
  const bed = new Xf(mb, cs, ox - 10, oy, oz + 4, 1);
  const bw: Vec3 = [1.2, 0.95, 0.7];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) bed.box([sx * 0.47 - 0.04, 0, sz * 0.97 - 0.04], [sx * 0.47 + 0.04, 0.3, sz * 0.97 + 0.04], MAT.wood, { tint: bw });
  }
  bed.box([-0.5, 0.26, -1.0], [0.5, 0.36, 1.0], MAT.wood, { tint: bw });
  bed.box([-0.5, 0.3, -1.04], [0.5, 1.0, -0.98], MAT.wood, { tint: bw, bevel: 0.01 });
  bed.box([-0.5, 0.3, 0.98], [0.5, 0.6, 1.04], MAT.wood, { tint: bw, bevel: 0.01 });
  const linen: Vec3 = [1.45, 1.45, 1.4];
  bed.box([-0.46, 0.36, -0.96], [0.46, 0.5, 0.94], MAT.canvas, { tint: [1.9, 1.9, 1.8], bevel: 0.03 });
  bed.box([-0.4, 0.5, -0.9], [0.4, 0.62, -0.5], MAT.plaster, { tint: linen, bevel: 0.05 });
  bed.box([-0.48, 0.5, -0.4], [0.48, 0.58, 0.96], MAT.plaster, { tint: linen, bevel: 0.03 });
  // Край одеяла свисает с одной стороны.
  sheet(bed, [0.48, 0.58, -0.3], [0.48, 0.58, 0.9], [0.51, 0.22, 0.9], [0.51, 0.22, -0.3], [1, 0, 0], MAT.plaster, linen);
  bed.collider([-0.52, 0, -1.05], [0.52, 1.0, 1.05]);

  // Ряд почтовых ящиков.
  for (let k = 0; k < 4; k++) {
    const mbx = new Xf(mb, cs, ox + 8 + k * 1.1, oy, oz - 9, 3);
    mbx.box([-0.04, 0, -0.04], [0.04, 1.05, 0.04], MAT.wood, { tint: [1.1, 0.9, 0.7] });
    mbx.box([-0.22, 1.05, -0.12], [0.22, 1.3, 0.12], MAT.metalGrey, { tint: [0.8 + 0.2 * k, 0.9, 1.4 - 0.2 * k], bevel: 0.02 });
    mbx.box([0.22, 1.2, -0.02], [0.25, 1.4, 0.02], MAT.paintRed, { tint: [1.4, 0.9, 0.8] });
    mbx.collider([-0.22, 0, -0.12], [0.22, 1.3, 0.12]);
  }

  const spotsXZ: Array<[number, number]> = [
    [6, 2],
    [-5, 5],
    [0, 8],
    [10, 6],
    [-12, -3],
    [-3, -14],
    [14, -2],
    [-4, 14],
  ];
  return {
    kind: 'meadow',
    meshes: [mb.build()],
    colliders: cs.boxes.map((b) => ({ ...b })),
    spawn: { pos: [ox, oy, oz], yaw: 0 },
    // Ясный день: солнце высоко за правым плечом игрока и светит втрое сильнее неба — тени на траве
    // густые и голубоватые, как в полдень. Даль видна далеко: точки редеют только к сорока метрам.
    env: { ambient: [0.25, 0.32, 0.41], fog: [0.28, 0.46, 0.8], fogDensity: 0.006, light: 0.1, decay: 0, haze: 0, key: { dir: [0.4, 0.8, 0.447], color: [0.96, 0.88, 0.66], reach: 9 }, scan: [10, 42] },
    center: [ox, oy, oz],
    radius: R_WALK,
    // Выход — дверная коробка посреди луга, прямо по ходу.
    exit: [ox, oy, oz - 12],
    spots: spotsXZ.map(([x, z]): Vec3 => [ox + x, oy, oz + z]),
  };
};
