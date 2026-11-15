/**
 * Голубь: сетка птицы для вещей, у которых птица — не декорация, а гость (чучело, сидящая и взлетающая стая).
 * Собирается кодом из граней, без three.js. Свои оси: вперёд +z, вверх +y, вправо +x; начало — точка под
 * лапами (y = 0 — поверхность, на которой он сидит). Размер чуть больше настоящего: тело с хвостом ~0,36 м,
 * размах раскрытых крыльев 0,84 м.
 *
 * Канал качания (MeshData.sway) здесь не ветер, а место вершины на крыле: от плеча (0,03) к кончику (1),
 * со знаком стороны (правое крыло плюс, левое минус). По нему шейдер машет крыльями; у тела, головы,
 * хвоста и лап канал нулевой. Крылья лежат плоско (раскрыты в стороны) в плоскости y = 0,13 и видны с
 * обеих сторон — верхние и нижние грани строятся отдельно.
 */
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';

type V = Vec3;

const BACK: V = [0.62, 0.66, 0.74];
const BELLY: V = [0.7, 0.74, 0.82];
const NECK: V = [0.45, 0.62, 0.55];
const HEAD: V = [0.42, 0.45, 0.52];
const WING: V = [0.78, 0.8, 0.86];
const STRIPE: V = [0.3, 0.32, 0.38];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Как ориентировать грань: лицом от внутренней точки тела или лицом в заданную сторону. */
type Orient = { inside: V } | { facing: V };

/**
 * Треугольник с правильным обходом (против часовой с лица). nrm — сглаженные нормали вершин (null — нормаль грани);
 * sway — вес качания вершины по её положению (null — вершина стоит).
 */
function face(mb: MeshBuilder, pts: readonly [V, V, V], nrm: readonly [V, V, V] | null, orient: Orient, mat: number, tints: readonly [V, V, V], sway: ((p: V) => number) | null = null): void {
  const g = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  const want: V = 'facing' in orient ? orient.facing : sub([(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3, (pts[0][2] + pts[1][2] + pts[2][2]) / 3], orient.inside);
  const flip = dot(g, want) < 0;
  const order = flip ? [0, 2, 1] : [0, 1, 2];
  const fn = norm(flip ? [-g[0], -g[1], -g[2]] : g);
  const ids = order.map((k) => {
    mb.swayValue = sway ? sway(pts[k]!) : null;
    return mb.vertex(pts[k]!, nrm ? nrm[k]! : fn, mat, tints[k]!, 1);
  });
  mb.swayValue = null;
  mb.tri(ids[0]!, ids[1]!, ids[2]!);
}

/** Четырёхугольник двумя треугольниками, лицом в facing. */
function flat(mb: MeshBuilder, q: readonly [V, V, V, V], facing: V, mat: number, tint: V, sway: (p: V) => number): void {
  face(mb, [q[0], q[1], q[2]], null, { facing }, mat, [tint, tint, tint], sway);
  face(mb, [q[0], q[2], q[3]], null, { facing }, mat, [tint, tint, tint], sway);
}

/** Сечение тела: z, центр по высоте, полуширина, полувысота, цвет спины. */
type Ring = readonly [z: number, cy: number, rx: number, ry: number, back: V];

function ringPts(r: Ring): V[] {
  const [z, cy, rx, ry] = r;
  // Шесть вершин: верх, правый верх, правый низ, низ, левый низ, левый верх.
  return [
    [0, cy + ry, z],
    [rx * 0.9, cy + ry * 0.45, z],
    [rx, cy - ry * 0.4, z],
    [0, cy - ry, z],
    [-rx, cy - ry * 0.4, z],
    [-rx * 0.9, cy + ry * 0.45, z],
  ];
}

/** Тон вершины сечения: спина — своим цветом, низ — светлее (брюхо). */
function ringTint(k: number, back: V): V {
  return k === 3 ? BELLY : k === 2 || k === 4 ? [(back[0] + BELLY[0]) / 2, (back[1] + BELLY[1]) / 2, (back[2] + BELLY[2]) / 2] : back;
}

/** Вес качания вершины крыла: 0,03 у плеча → 1 у кончика, знак — сторона. */
const wingWeight = (p: V): number => Math.sign(p[0]) * clamp((Math.abs(p[0]) - 0.05) / 0.37, 0.03, 1);

/** Голубь с раскрытыми крыльями: тело-«веретено», голова с клювом, веер хвоста, плоские крылья, две лапы. */
export function birdMesh(): MeshData {
  const mb = new MeshBuilder();
  mb.sway = null;
  mb.swayValue = null;

  // ── Тело: четыре сечения и острый конец к хвосту; кольцо на шее зеленоватое.
  const rings: Ring[] = [
    [-0.1, 0.1, 0.03, 0.04, BACK],
    [-0.03, 0.1, 0.055, 0.07, BACK],
    [0.04, 0.1, 0.055, 0.07, BACK],
    [0.1, 0.13, 0.04, 0.05, NECK],
  ];
  const pts = rings.map(ringPts);
  const axis = (r: Ring): V => [0, r[1], r[0]];
  const nrmAt = (r: Ring, p: V): V => norm([(p[0] - 0) / (r[2] * r[2]), (p[1] - r[1]) / (r[3] * r[3]), 0]);
  const tintAt = (ri: number, k: number): V => (ri === 3 ? NECK : ringTint(k, rings[ri]!.at(4) as V));
  for (let ri = 0; ri + 1 < rings.length; ri++) {
    const a = pts[ri]!;
    const b = pts[ri + 1]!;
    const ra = rings[ri]!;
    const rb = rings[ri + 1]!;
    for (let k = 0; k < 6; k++) {
      const j = (k + 1) % 6;
      const inside = axis(ra);
      const na = (i: number): V => nrmAt(ra, a[i]!);
      const nb = (i: number): V => nrmAt(rb, b[i]!);
      face(mb, [a[k]!, a[j]!, b[j]!], [na(k), na(j), nb(j)], { inside }, MAT.canvas, [tintAt(ri, k), tintAt(ri, j), tintAt(ri + 1, j)]);
      face(mb, [a[k]!, b[j]!, b[k]!], [na(k), nb(j), nb(k)], { inside }, MAT.canvas, [tintAt(ri, k), tintAt(ri + 1, j), tintAt(ri + 1, k)]);
    }
  }
  // Острый конец: сечение сходится в точку позади.
  const apex: V = [0, 0.095, -0.17];
  const first = pts[0]!;
  const r0 = rings[0]!;
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    face(mb, [first[k]!, first[j]!, apex], [nrmAt(r0, first[k]!), nrmAt(r0, first[j]!), norm([0, -0.2, -1])], { inside: axis(r0) }, MAT.canvas, [tintAt(0, k), tintAt(0, j), BACK]);
  }

  // ── Голова: гранёный шарик (восьмигранник) впереди-сверху и клюв-клин.
  const hc: V = [0, 0.2, 0.13];
  const hr = 0.035;
  const hp = (dx: number, dy: number, dz: number): V => [hc[0] + dx * hr, hc[1] + dy * hr, hc[2] + dz * hr];
  const top = hp(0, 1, 0);
  const bot = hp(0, -1, 0);
  const ring4 = [hp(0, 0, 1), hp(1, 0, 0), hp(0, 0, -1), hp(-1, 0, 0)];
  for (let k = 0; k < 4; k++) {
    const p = ring4[k]!;
    const q = ring4[(k + 1) % 4]!;
    for (const apexP of [top, bot]) {
      const n = (v: V): V => norm(sub(v, hc));
      face(mb, [p, q, apexP], [n(p), n(q), n(apexP)], { inside: hc }, MAT.canvas, [HEAD, HEAD, HEAD]);
    }
  }
  // Клюв: три грани клина вперёд от передней вершины головы.
  const bb: V[] = [
    [-0.009, 0.206, 0.158],
    [0.009, 0.206, 0.158],
    [0, 0.19, 0.158],
  ];
  const tip: V = [0, 0.197, 0.186];
  const beakIn: V = [0, 0.2, 0.15];
  for (let k = 0; k < 3; k++) face(mb, [bb[k]!, bb[(k + 1) % 3]!, tip], null, { inside: beakIn }, MAT.bakelite, [[0.9, 0.8, 0.6], [0.9, 0.8, 0.6], [0.55, 0.45, 0.35]]);

  // ── Хвост: веер из трёх треугольников назад до z = −0,20, виден с обеих сторон, к концу темнее.
  const root: V = [0, 0.108, -0.12];
  const tails: V[] = [
    [-0.07, 0.1, -0.2],
    [-0.024, 0.1, -0.2],
    [0.024, 0.1, -0.2],
    [0.07, 0.1, -0.2],
  ];
  const tailLight: V = [0.78, 0.8, 0.86];
  const tailDark: V = [0.34, 0.36, 0.42];
  for (let k = 0; k < 3; k++) {
    for (const fy of [1, -1]) face(mb, [root, tails[k]!, tails[k + 1]!], null, { facing: [0, fy, 0] }, MAT.paper, [tailLight, tailDark, tailDark]);
  }

  // ── Крылья: лента из трёх сегментов от плеча к кончику в плоскости y = 0,13; вес качания — по месту на крыле.
  const Y = 0.13;
  const station = (side: number, k: number): { x: number; le: number; chord: number } => ({
    x: side * (0.05 + (0.37 * k) / 3),
    le: 0.09 - 0.012 * k,
    chord: 0.17 - 0.03 * k,
  });
  // Границы полос по хорде (доля от передней кромки) и их цвет: светлое поле, две тёмные полосы у задней кромки.
  const stripes4: readonly (readonly [number, number, V])[] = [
    [0, 0.6, WING],
    [0.6, 0.72, STRIPE],
    [0.72, 0.84, WING],
    [0.84, 1, STRIPE],
  ];
  const stripes2: readonly (readonly [number, number, V])[] = [
    [0, 0.72, WING],
    [0.72, 1, STRIPE],
  ];
  for (const side of [1, -1]) {
    for (let seg = 0; seg < 3; seg++) {
      const s0 = station(side, seg);
      const s1 = station(side, seg + 1);
      for (const [f0, f1, tint] of seg === 2 ? stripes2 : stripes4) {
        const q: readonly [V, V, V, V] = [
          [s0.x, Y, s0.le - f0 * s0.chord],
          [s1.x, Y, s1.le - f0 * s1.chord],
          [s1.x, Y, s1.le - f1 * s1.chord],
          [s0.x, Y, s0.le - f1 * s0.chord],
        ];
        flat(mb, q, [0, 1, 0], MAT.paper, tint, wingWeight);
        flat(mb, q, [0, -1, 0], MAT.paper, tint, wingWeight);
      }
    }
  }

  // ── Лапы: две крошечные коробки от пола до 0,03 (верх и низ не нужны).
  for (const x of [-0.022, 0.022]) mb.box([x - 0.006, 0, 0.02], [x + 0.006, 0.03, 0.032], MAT.paintRed, { tint: [1.1, 0.5, 0.45], skip: ['py', 'ny'] });

  return mb.build();
}
