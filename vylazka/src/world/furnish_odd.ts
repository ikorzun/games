/**
 * Странные комнаты (партнёр 21.11, 19:06: «еще придумай 5 комнат с подобных подходом»; строить — 25.11; design.md, §37.1;
 * карточки K-29, K-31, K-32, K-33 в docs/vylazka/ideas.md). Устроены, как белая комната (world/furnish_white.ts):
 *
 * - помещение не обставляется — ни мебели, ни бумаги, ни мест для вещей; свой облик ему даёт шейдер мира по коробке помещения
 *   (render: uOddBox), а не материал стен: стены остаются стенами для проходов, стирания и коллайдеров;
 * - посередине одна вещь, касание которой даёт пять секунд другого ощущения (systems/odd.ts, game.ts);
 * - вещь — не вещь сна: касание её не растворяет (номер вершин GROWTH_OBJ или HANG_OBJ, её нет в журнале объектов), она не
 *   светится, не парит в пузыре и молчит, пока её не тронули, — иначе читалась бы искомой (куратор 25.11).
 *
 * Баян на стуле (сжатие), старый аквариум на тумбе (тяжесть), кинескоп на полу (дребезжание), бледный шарик на нитке
 * (расширение). Лицо вещи — к проходу, ближайшему к началу сна по ходу: с него в комнату обычно и входят.
 */
import type { Vec3 } from '../core/types';
import { mulberry32 } from '../core/rng';
import { DX, DZ } from '../gen/layout';
import type { OddKind } from '../systems/odd';
import type { RoomCtx } from './furnish';
import type { MeshBuilder } from './kit';
import { MAT } from './materials';
import { GROWTH_OBJ, hanging } from './objects';
import { Xf } from './props';
import { CELL } from './shell';

/** Экран кинескопа: середина, нормаль (к зрителю), ось вправо и вверх, размеры и выпуклость стекла, м. */
export interface OddScreen {
  at: Vec3;
  n: Vec3;
  u: Vec3;
  v: Vec3;
  w: number;
  h: number;
  bulge: number;
}

/** Чего касается тело, чтобы ощущение началось: коробка вещи (min, max) или нитка шарика (отрезок и толщина). */
export type OddTrigger = { box: [Vec3, Vec3] } | { line: [Vec3, Vec3]; r: number };

export interface OddRoom {
  kind: OddKind;
  room: number;
  tier: number;
  /** Коробка помещения по полу, м: minX, minZ, maxX, maxZ. */
  box: [number, number, number, number];
  /** Пол и потолок, м (у шарика потолок выше обычного — world/level_build.ts, ceilOf). */
  y: [number, number];
  /** Середина прохода, через который входят; нет прохода — нет поля. */
  door?: [number, number];
  /** Куда смотрит лицо вещи (единичный вектор по главной оси): к проходу. */
  face: [number, number];
  /** Середина вещи на полу. */
  at: Vec3;
  trigger: OddTrigger;
  /** Экран кинескопа (только у телевизора): по нему рендер кладёт задержанный кадр. */
  screen?: OddScreen;
}

/** Насколько надо подойти к коробке вещи, чтобы коснуться её (сверх радиуса тела), м: коллайдер держит тело на радиусе. */
export const ODD_REACH = 0.07;

/** Касается ли тело (цилиндр: ось (x, z), от ног feet до головы head) вещи комнаты. */
export function touchesOdd(o: OddRoom, x: number, feet: number, z: number, radius: number, head = feet + 1.75): boolean {
  const t = o.trigger;
  if ('box' in t) {
    const [lo, hi] = t.box;
    if (feet > hi[1] || head < lo[1]) return false;
    const dx = Math.max(lo[0] - x, 0, x - hi[0]);
    const dz = Math.max(lo[2] - z, 0, z - hi[2]);
    return Math.hypot(dx, dz) < radius + ODD_REACH;
  }
  const [a, b] = t.line;
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    const px = a[0] + (b[0] - a[0]) * f;
    const py = a[1] + (b[1] - a[1]) * f;
    const pz = a[2] + (b[2] - a[2]) * f;
    if (py < feet || py > head) continue;
    if (Math.hypot(px - x, pz - z) < radius + t.r) return true;
  }
  return false;
}

// ───────────── мелкие сборщики в мировых координатах ─────────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Тонкий стержень между точками a и b (мир): призма о sides гранях со сглаженными нормалями. */
function rod(mb: MeshBuilder, a: Vec3, b: Vec3, r: number, mat: number, tint: Vec3, sides = 4): void {
  const d = norm(sub(b, a));
  const e1 = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(d, e1);
  const base = mb.vertexCount;
  for (const p of [a, b]) {
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const n: Vec3 = [e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang), e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang), e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)];
      mb.vertex([p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n, mat, tint, 1);
    }
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    mb.tri(base + i, base + j, base + sides + j);
    mb.tri(base + i, base + sides + j, base + sides + i);
  }
}

/** Лента по ломаной pts (мир) шириной w вдоль side: ремень, стебель. Обе стороны. */
function ribbon(mb: MeshBuilder, pts: readonly Vec3[], side: Vec3, w: number, mat: number, tint: Vec3): void {
  const h: Vec3 = [side[0] * (w / 2), side[1] * (w / 2), side[2] * (w / 2)];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const a: Vec3 = [p[0] - h[0], p[1] - h[1], p[2] - h[2]];
    const b: Vec3 = [p[0] + h[0], p[1] + h[1], p[2] + h[2]];
    const c: Vec3 = [q[0] + h[0], q[1] + h[1], q[2] + h[2]];
    const d: Vec3 = [q[0] - h[0], q[1] - h[1], q[2] - h[2]];
    const n = norm(cross(sub(b, a), sub(d, a)));
    mb.quadFacing(a, b, c, d, n, mat, tint);
    mb.quadFacing(a, b, c, d, [-n[0], -n[1], -n[2]], mat, tint);
  }
}

/** Пылинка: восьмигранник радиусом r вокруг c (мир). */
function mote(mb: MeshBuilder, c: Vec3, r: number, mat: number, tint: Vec3): void {
  const tip = (dx: number, dy: number, dz: number): Vec3 => [c[0] + dx * r, c[1] + dy * r, c[2] + dz * r];
  const ring = [tip(1, 0, 0), tip(0, 0, 1), tip(-1, 0, 0), tip(0, 0, -1)];
  for (const [y, s] of [
    [1, 1],
    [-1, -1],
  ] as const) {
    const top = tip(0, y, 0);
    for (let i = 0; i < 4; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % 4]!;
      const n = norm([(a[0] + b[0] + top[0]) / 3 - c[0], (a[1] + b[1] + top[1]) / 3 - c[1], (a[2] + b[2] + top[2]) / 3 - c[2]]);
      const i0 = mb.vertex(a, n, mat, tint, 1);
      const i1 = mb.vertex(b, n, mat, tint, 1);
      const i2 = mb.vertex(top, n, mat, tint, 1);
      if (s > 0) mb.tri(i0, i2, i1);
      else mb.tri(i0, i1, i2);
    }
  }
}

/** Поворот Xf, при котором локальная ось +z смотрит вдоль face (по главной оси). */
function rotFor(face: [number, number]): 0 | 1 | 2 | 3 {
  if (face[0] > 0.5) return 1;
  if (face[1] < -0.5) return 2;
  if (face[0] < -0.5) return 3;
  return 0;
}

/** Мировые габариты локальной коробки предмета (поворот на четверти оборота). */
function span(xf: Xf, min: Vec3, max: Vec3): [Vec3, Vec3] {
  const a = xf.pt(min[0], min[1], min[2]);
  const b = xf.pt(max[0], max[1], max[2]);
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ];
}

/** Кнопка: короткий цилиндр по оси axis предмета, основание в p (локально). */
function button(xf: Xf, p: Vec3, axis: 'x' | 'z', dir: 1 | -1, r: number, tint: Vec3): void {
  const len = 0.006;
  const base: Vec3 = axis === 'x' ? [dir > 0 ? p[0] : p[0] - len, p[1], p[2]] : [p[0], p[1], dir > 0 ? p[2] : p[2] - len];
  xf.cyl(base, axis, len, r, MAT.enamel, { segments: 6, tint });
}

// ───────────── баян на стуле (K-31) ─────────────

const CHAIR_WOOD: Vec3 = [0.78, 0.55, 0.36];
/**
 * Как у старого баяна: корпуса — тёмный бакелит, кнопки — белый перламутр, решётка — хром; мехи — тёмно-коричневые, по наружным
 * сгибам — светлая тесьма, на углах — металлические уголки.
 */
const BAYAN_BODY: Vec3 = [0.75, 0.7, 0.68];
const BAYAN_BELLOWS: Vec3 = [0.36, 0.22, 0.16];
const TAPE: Vec3 = [1.25, 1.18, 1.0];
const PEARL: Vec3 = [1.32, 1.28, 1.18];
const LEATHER: Vec3 = [0.66, 0.42, 0.25];

/** Стул: сиденье на 0,47 м, спинка до 0,95 м. Сиденье — к лицу (+z), спинка — сзади. */
function chair(xf: Xf): void {
  const s = 0.21;
  xf.box([-s, 0.44, -s], [s, 0.47, s], MAT.wood, { tint: CHAIR_WOOD, bevel: 0.006 });
  for (const [x, z] of [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ] as const) {
    xf.box([x - 0.018, 0, z - 0.018], [x + 0.018, 0.44, z + 0.018], MAT.wood, { tint: CHAIR_WOOD, aoBottom: 0.5 });
  }
  // Царги между ножками и задние стойки спинки.
  xf.box([-0.17, 0.12, -0.19], [0.17, 0.145, -0.17], MAT.wood, { tint: CHAIR_WOOD });
  xf.box([-0.17, 0.12, 0.17], [0.17, 0.145, 0.19], MAT.wood, { tint: CHAIR_WOOD });
  for (const x of [-0.18, 0.18]) xf.box([x - 0.018, 0.47, -0.2], [x + 0.018, 0.95, -0.164], MAT.wood, { tint: CHAIR_WOOD });
  xf.box([-0.2, 0.62, -0.205], [0.2, 0.7, -0.18], MAT.wood, { tint: CHAIR_WOOD, bevel: 0.005 });
  xf.box([-0.2, 0.83, -0.205], [0.2, 0.93, -0.18], MAT.wood, { tint: CHAIR_WOOD, bevel: 0.006 });
}

/** Наклонная коробка по восьми углам: c[0..3] — одна грань (по кругу), c[4..7] — противоположная, в том же порядке. */
function slab(mb: MeshBuilder, c: readonly Vec3[], mat: number, tint: Vec3): void {
  const mid: Vec3 = [0, 0, 0];
  for (const p of c) for (let k = 0; k < 3; k++) mid[k] = mid[k]! + p[k]! / 8;
  const face = (a: Vec3, b: Vec3, cc: Vec3, d: Vec3): void => {
    const fm: Vec3 = [(a[0] + b[0] + cc[0] + d[0]) / 4, (a[1] + b[1] + cc[1] + d[1]) / 4, (a[2] + b[2] + cc[2] + d[2]) / 4];
    mb.quadFacing(a, b, cc, d, sub(fm, mid), mat, tint);
  };
  face(c[0]!, c[1]!, c[2]!, c[3]!);
  face(c[4]!, c[5]!, c[6]!, c[7]!);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    face(c[i]!, c[j]!, c[j + 4]!, c[i + 4]!);
  }
}

/**
 * Баян стоит на сиденье и раскрыт веером: мехи внизу сжаты, кверху разошлись, корпуса наклонены врозь — так его узнают сразу
 * (сложенный и стоящий ровно, он читался батареей). Справа — корпус с хромовой решёткой и грифом в три ряда перламутровых кнопок,
 * слева — басовый корпус с кнопками на боку; мехи — складками, по наружным сгибам светлая тесьма и уголки; ремни свешиваются за
 * спину. Около трёх тысяч треугольников.
 */
function bayan(xf: Xf, y0: number): void {
  const mb = xf.mb;
  const zf = 0.095;
  const H = 0.46;
  const yb = y0 + 0.012;
  const yt = y0 + H - 0.02;
  // Веер: ширина мехов внизу и вверху; складка i проходит от bx(i) внизу до tx(i) вверху.
  const WB = 0.16;
  const WT = 0.3;
  const N = 12;
  const xAt = (f: number, y: number): number => {
    const k = (y - yb) / (yt - yb);
    return (-0.5 + f) * (WB + (WT - WB) * k);
  };
  // Наклон корпусов — по крайним складкам: единичная нормаль к плоскости складки наружу (в плоскости xy).
  const side = (f: number, out: 1 | -1): [number, number] => {
    const dx = xAt(f, yt) - xAt(f, yb);
    const l = Math.hypot(dx, yt - yb);
    return [(out * (yt - yb)) / l, (-out * dx) / l];
  };
  const P = (x: number, y: number, z: number): Vec3 => xf.pt(x, y, z);
  /** Корпус у крайней складки f толщиной t наружу; e — насколько он ниже складки сверху. */
  const body = (f: number, out: 1 | -1, t: number, e: number): { at: (s: number, y: number) => [number, number] } => {
    const [nx, ny] = side(f, out);
    const at = (s: number, y: number): [number, number] => [xAt(f, y) + nx * s, y + ny * s];
    // Наклонённый корпус стоит на сиденье наружным углом, а не врезается в него.
    const lo = y0 + Math.max(0, -ny * t);
    const hi = y0 + H - e;
    const c: Vec3[] = [];
    for (const s of [0, t]) {
      const [xa, ya] = at(s, lo);
      const [xb, yb2] = at(s, hi);
      c.push(P(xa, ya, -zf), P(xa, ya, zf), P(xb, yb2, zf), P(xb, yb2, -zf));
    }
    slab(mb, c, MAT.bakelite, BAYAN_BODY);
    return { at };
  };
  const right = body(1, 1, 0.14, 0);
  const left = body(0, -1, 0.12, 0.02);
  // Решётка голосов на лице правого корпуса — наклонные хромовые планки.
  for (let i = 0; i < 9; i++) {
    const y = y0 + 0.07 + i * 0.038;
    const [xa, ya] = right.at(0.015, y);
    const [xb, ybb] = right.at(0.085, y);
    mb.quadFacing(P(xa, ya, zf + 0.004), P(xb, ybb, zf + 0.004), P(xb, ybb + 0.012, zf + 0.004), P(xa, ya + 0.012, zf + 0.004), xf.dir(0, 0, 1), MAT.steel, [1.25, 1.25, 1.22]);
  }
  // Гриф: тёмная планка по наружному краю лица и три ряда кнопок.
  {
    const [xa, ya] = right.at(0.092, y0 + 0.02);
    const [xb, ybb] = right.at(0.14, y0 + 0.02);
    const [xc, yc] = right.at(0.14, y0 + H - 0.02);
    const [xd, yd] = right.at(0.092, y0 + H - 0.02);
    mb.quadFacing(P(xa, ya, zf + 0.003), P(xb, ybb, zf + 0.003), P(xc, yc, zf + 0.003), P(xd, yd, zf + 0.003), xf.dir(0, 0, 1), MAT.enamel, [0.34, 0.32, 0.3]);
  }
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 13; i++) {
      const y = y0 + 0.04 + i * 0.031 + (row % 2) * 0.015;
      if (y > y0 + H - 0.04) continue;
      const [x, yy] = right.at(0.102 + row * 0.015, y);
      button(xf, [x, yy, zf + 0.003], 'z', 1, 0.0066, PEARL);
    }
  }
  // Басы на наружном боку левого корпуса.
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) {
      const [x, y] = left.at(0.12, y0 + 0.07 + c * 0.044);
      button(xf, [x, y, -0.06 + r * 0.028 + (c % 2) * 0.008], 'x', -1, 0.0075, PEARL);
    }
  }
  // Мехи: складки зигзагом по четырём сторонам; на наружных сгибах — тесьма по лицу и уголки.
  const fold = (i: number): { f: number; lo: number; hi: number; z: number } => {
    const inset = i % 2 === 1 ? 0.016 : 0;
    return { f: i / N, lo: yb + inset, hi: yt - inset, z: zf - 0.006 - inset };
  };
  for (let i = 0; i < N; i++) {
    const a = fold(i);
    const b = fold(i + 1);
    const pa = (y: number, z: number): Vec3 => P(xAt(a.f, y), y, z);
    const pb = (y: number, z: number): Vec3 => P(xAt(b.f, y), y, z);
    mb.quadFacing(pa(a.hi, -a.z), pa(a.hi, a.z), pb(b.hi, b.z), pb(b.hi, -b.z), xf.dir(0, 1, 0), MAT.canvas, BAYAN_BELLOWS);
    mb.quadFacing(pa(a.lo, -a.z), pa(a.lo, a.z), pb(b.lo, b.z), pb(b.lo, -b.z), xf.dir(0, -1, 0), MAT.canvas, BAYAN_BELLOWS);
    mb.quadFacing(pa(a.lo, a.z), pa(a.hi, a.z), pb(b.hi, b.z), pb(b.lo, b.z), xf.dir(0, 0, 1), MAT.canvas, BAYAN_BELLOWS);
    mb.quadFacing(pa(a.lo, -a.z), pa(a.hi, -a.z), pb(b.hi, -b.z), pb(b.lo, -b.z), xf.dir(0, 0, -1), MAT.canvas, BAYAN_BELLOWS);
  }
  for (let i = 2; i < N; i += 2) {
    const f = fold(i);
    const tape = (z: number): void => {
      const w = 0.0035;
      mb.quadFacing(P(xAt(f.f, f.lo) - w, f.lo, z), P(xAt(f.f, f.lo) + w, f.lo, z), P(xAt(f.f, f.hi) + w, f.hi, z), P(xAt(f.f, f.hi) - w, f.hi, z), xf.dir(0, 0, Math.sign(z)), MAT.canvas, TAPE);
    };
    tape(f.z + 0.002);
    tape(-f.z - 0.002);
    for (const y of [f.lo, f.hi - 0.014]) {
      const x = xAt(f.f, y + 0.007);
      for (const z of [-f.z - 0.004, f.z - 0.01]) xf.box([x - 0.007, y, z], [x + 0.007, y + 0.014, z + 0.014], MAT.steel, { tint: [1.25, 1.25, 1.25] });
    }
  }
  // Ремни: от верха корпусов назад, вниз по спине мехов на сиденье.
  for (const x of [-0.2, 0.22]) {
    const pts = [P(x, y0 + H - 0.04, -0.07), P(x, y0 + H - 0.01, -0.115), P(x * 0.9, y0 + 0.34, -0.15), P(x * 0.8, y0 + 0.16, -0.165), P(x * 0.75, y0 + 0.006, -0.14), P(x * 0.75, y0 + 0.006, -0.07)];
    ribbon(mb, pts, xf.dir(1, 0, 0), 0.036, MAT.leather, LEATHER);
  }
}

// ───────────── аквариум (K-29) ─────────────

const VENEER: Vec3 = [0.66, 0.48, 0.34];
const FRAME: Vec3 = [0.52, 0.55, 0.52];

/**
 * Старый большой аквариум на тумбе, без рыб. Стекло дано каркасом (рёбра, нижний и верхний пояс): сплошное тёмное стекло
 * превращало аквариум в чёрное ведро (world/props_home.ts, круглый аквариум). Внутри — грунт, сухие стебли, трубка аэратора и
 * муть: сотня пылинок висит в толще и медленно ходит на сквозняке. Поверхность воды — бледный зелёный лист под кромкой.
 */
function aquarium(xf: Xf, seed: number): void {
  const mb = xf.mb;
  xf.box([-0.75, 0, -0.28], [0.75, 0.7, 0.28], MAT.veneer, { tint: VENEER, aoBottom: 0.5 });
  xf.box([-0.77, 0.7, -0.3], [0.77, 0.74, 0.3], MAT.veneer, { tint: [VENEER[0] * 0.85, VENEER[1] * 0.85, VENEER[2] * 0.85], bevel: 0.008 });
  for (const [a, b] of [
    [-0.72, -0.01],
    [0.01, 0.72],
  ] as const) {
    xf.box([a, 0.05, 0.28], [b, 0.65, 0.29], MAT.veneer, { tint: [VENEER[0] * 1.08, VENEER[1] * 1.08, VENEER[2] * 1.08] });
    const hx = a < 0 ? b - 0.06 : a + 0.06;
    xf.box([hx - 0.01, 0.52, 0.29], [hx + 0.01, 0.6, 0.305], MAT.steel, { tint: [1.1, 1.1, 1.1] });
  }
  // Каркас бака: пояс снизу, четыре стойки, кромка сверху и поперечина.
  const X = 0.72;
  const Z = 0.26;
  const yb = 0.74;
  const yt = 1.36;
  const t = 0.024;
  xf.box([-X, yb, -Z], [X, yb + 0.05, -Z + t], MAT.bakelite, { tint: FRAME });
  xf.box([-X, yb, Z - t], [X, yb + 0.05, Z], MAT.bakelite, { tint: FRAME });
  xf.box([-X, yb, -Z], [-X + t, yb + 0.05, Z], MAT.bakelite, { tint: FRAME });
  xf.box([X - t, yb, -Z], [X, yb + 0.05, Z], MAT.bakelite, { tint: FRAME });
  for (const x of [-X, X - t]) for (const z of [-Z, Z - t]) xf.box([x, yb, z], [x + t, yt, z + t], MAT.bakelite, { tint: FRAME });
  xf.box([-X, yt - 0.035, -Z], [X, yt, -Z + 0.03], MAT.bakelite, { tint: FRAME });
  xf.box([-X, yt - 0.035, Z - 0.03], [X, yt, Z], MAT.bakelite, { tint: FRAME });
  xf.box([-X, yt - 0.035, -Z], [-X + 0.03, yt, Z], MAT.bakelite, { tint: FRAME });
  xf.box([X - 0.03, yt - 0.035, -Z], [X, yt, Z], MAT.bakelite, { tint: FRAME });
  xf.box([-0.015, yt - 0.03, -Z], [0.015, yt, Z], MAT.bakelite, { tint: FRAME });
  // Известковая полоса на стойках там, где годами стояла вода.
  for (const x of [-X, X - t]) for (const z of [-Z, Z - t]) xf.box([x - 0.001, 1.25, z - 0.001], [x + t + 0.001, 1.28, z + t + 0.001], MAT.plaster, { tint: [1.25, 1.25, 1.15] });
  // Грунт и камни.
  xf.box([-X + t, yb + 0.02, -Z + t], [X - t, yb + 0.085, Z - t], MAT.dirt, { tint: [1.05, 0.98, 0.86] });
  const rnd = mulberry32(seed ^ 0xa9);
  for (let i = 0; i < 7; i++) {
    const x = -0.6 + rnd() * 1.2;
    const z = -0.18 + rnd() * 0.36;
    const s = 0.02 + rnd() * 0.035;
    xf.box([x - s, yb + 0.085, z - s * 0.8], [x + s, yb + 0.085 + s * 0.9, z + s * 0.8], MAT.concrete, { tint: [0.9, 0.92, 0.88], bevel: s * 0.3 });
  }
  // Трубка аэратора в заднем углу.
  xf.cyl([X - 0.06, yb + 0.09, -Z + 0.05], 'y', yt - yb - 0.12, 0.005, MAT.rubber, { segments: 5, tint: [1.2, 1.25, 1.2], caps: false });
  // Сухие стебли — гнутся на сквозняке, как стебель (вес растёт от грунта).
  const sway = mb.sway;
  for (let k = 0; k < 4; k++) {
    const x = -0.5 + k * 0.32 + rnd() * 0.1;
    const z = -0.12 + rnd() * 0.16;
    const h = 0.22 + rnd() * 0.18;
    mb.sway = { from: xf.oy + yb + 0.085, span: h, gain: 0.25, bend: true };
    const lean = (rnd() - 0.5) * 0.12;
    const pts: Vec3[] = [];
    for (let j = 0; j <= 4; j++) pts.push(xf.pt(x + lean * (j / 4) ** 2, yb + 0.085 + (h * j) / 4, z));
    ribbon(mb, pts, xf.dir(0.6, 0, 0.8), 0.018, MAT.paper, [0.62, 0.66, 0.42]);
  }
  mb.sway = sway;
  // Поверхность воды под кромкой: бледный лист, глядящий вверх.
  const W = 1.27;
  mb.quadFacing(xf.pt(-X + t, W, -Z + t), xf.pt(X - t, W, -Z + t), xf.pt(X - t, W, Z - t), xf.pt(-X + t, W, Z - t), [0, 1, 0], MAT.glass, [0.62, 0.86, 0.72]);
  // Муть: пылинки в толще воды, у каждой свой вес качания — ходят на сквозняке вразнобой.
  const keep = mb.swayValue;
  for (let i = 0; i < 110; i++) {
    const p = xf.pt(-X + 0.05 + rnd() * (2 * X - 0.1), yb + 0.11 + rnd() * (W - yb - 0.14), -Z + 0.05 + rnd() * (2 * Z - 0.1));
    mb.swayValue = 0.08 + rnd() * 0.35;
    mote(mb, p, 0.004 + rnd() * 0.007, MAT.paper, [0.86, 0.95, 0.74]);
  }
  mb.swayValue = keep;
}

// ───────────── телевизор (K-32) ─────────────

const TV_CASE: Vec3 = [0.6, 0.41, 0.28];
/** Экран кинескопа в осях телевизора: середина (x, y), ширина и высота, выпуклость стекла, м. */
const TV_SCREEN = { x: -0.07, y: 0.255, w: 0.36, h: 0.29, bulge: 0.014 } as const;
const TV_FRONT = 0.22;

/**
 * Старый ламповый телевизор стоит прямо на полу: деревянный корпус, тёмная рамка вокруг выпуклого экрана, справа две ручки и
 * решётка динамика, сзади — горб кинескопа, сверху — «рога» антенны. Сам экран — не здесь: его рисует рендер поверх, с кадром
 * двухсекундной давности (render: oddScreen). Возвращает экран в мире.
 */
function television(xf: Xf): OddScreen {
  const mb = xf.mb;
  xf.box([-0.33, 0, -0.2], [0.33, 0.5, TV_FRONT], MAT.veneer, { tint: TV_CASE, bevel: 0.012, aoBottom: 0.45 });
  xf.box([-0.24, 0.06, -0.42], [0.24, 0.44, -0.2], MAT.bakelite, { tint: [0.52, 0.5, 0.47] });
  xf.box([-0.15, 0.13, -0.5], [0.15, 0.37, -0.42], MAT.bakelite, { tint: [0.48, 0.46, 0.43] });
  // Рамка экрана — тёмный пластик, выступает над стеклом.
  const s = TV_SCREEN;
  const x0 = s.x - s.w / 2;
  const x1 = s.x + s.w / 2;
  const y0 = s.y - s.h / 2;
  const y1 = s.y + s.h / 2;
  const f = 0.035;
  const z0 = TV_FRONT;
  const z1 = TV_FRONT + 0.022;
  const bezel: Vec3 = [0.36, 0.35, 0.34];
  xf.box([x0 - f, y1, z0], [x1 + f, y1 + f, z1], MAT.bakelite, { tint: bezel, bevel: 0.006 });
  xf.box([x0 - f, y0 - f, z0], [x1 + f, y0, z1], MAT.bakelite, { tint: bezel, bevel: 0.006 });
  xf.box([x0 - f, y0, z0], [x0, y1, z1], MAT.bakelite, { tint: bezel });
  xf.box([x1, y0, z0], [x1 + f, y1, z1], MAT.bakelite, { tint: bezel });
  // Ручки и решётка динамика.
  for (const y of [0.37, 0.27]) xf.cyl([0.24, y, TV_FRONT], 'z', 0.03, 0.03, MAT.bakelite, { segments: 10, tint: [0.42, 0.4, 0.38] });
  for (let i = 0; i < 6; i++) xf.box([0.18, 0.05 + i * 0.022, TV_FRONT], [0.3, 0.06 + i * 0.022, TV_FRONT + 0.006], MAT.steel, { tint: [0.95, 0.95, 0.92] });
  // Антенна «рога»: основание и два стержня врозь, с шариками на концах.
  xf.cyl([0.06, 0.5, -0.06], 'y', 0.03, 0.045, MAT.bakelite, { segments: 10, tint: [0.4, 0.39, 0.37] });
  const root = xf.pt(0.06, 0.53, -0.06);
  for (const side of [-1, 1]) {
    const tip = xf.pt(0.06 + side * 0.27, 0.98, -0.16);
    rod(mb, root, tip, 0.0045, MAT.steel, [1.15, 1.15, 1.15]);
    xf.mb.cylinder([tip[0], tip[1] - 0.008, tip[2]], 'y', 0.016, 0.008, MAT.steel, { segments: 6, tint: [1.15, 1.15, 1.15] });
  }
  const o = xf.pt(0, 0, 0);
  const at = xf.pt(s.x, s.y, TV_FRONT + 0.004);
  const n = sub(xf.pt(0, 0, 1), o);
  const u = sub(xf.pt(1, 0, 0), o);
  return { at, n, u, v: [0, 1, 0], w: s.w, h: s.h, bulge: s.bulge };
}

// ───────────── шарик (K-33) ─────────────

/** Шарик: бледно-голубой, выцветший; нитка до пояса. Высоты — от пола, м. */
export const BALLOON = { center: 2.72, rx: 0.2, ry: 0.245, knot: 2.46, end: 0.95 } as const;
const BALLOON_TINT: Vec3 = [1.08, 1.17, 1.36];

/**
 * Воздушный шарик висит посреди высокой комнаты, нитка спускается до пояса. Шарик не красный: красное — язык системы, а
 * красный шарик на нитке — чужой образ из известного хоррора (куратор, K-33). Висит неподвижно, как всё в комнате; на сквозняке
 * чуть ходит конец нитки.
 */
function balloon(xf: Xf): [Vec3, Vec3] {
  const mb = xf.mb;
  const B = BALLOON;
  const seg = 14;
  const rings = 10;
  const base = mb.vertexCount;
  for (let j = 0; j <= rings; j++) {
    const th = (j / rings) * Math.PI;
    const sy = Math.cos(th);
    // Капля: книзу уже, к узлу сходится.
    const taper = 1 - 0.18 * Math.max(0, -sy) ** 1.5;
    const r = Math.sin(th) * taper;
    for (let i = 0; i < seg; i++) {
      const ph = (i / seg) * Math.PI * 2;
      const p = xf.pt(Math.cos(ph) * r * B.rx, B.center + sy * B.ry, Math.sin(ph) * r * B.rx);
      const n = norm([Math.cos(ph) * r / B.rx, sy / B.ry, Math.sin(ph) * r / B.rx]);
      mb.vertex(p, n, MAT.enamel, BALLOON_TINT, 1);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = base + j * seg + i;
      const b = base + j * seg + ((i + 1) % seg);
      const c = base + (j + 1) * seg + ((i + 1) % seg);
      const d = base + (j + 1) * seg + i;
      mb.tri(a, b, c);
      mb.tri(a, c, d);
    }
  }
  // Узел и нитка: чуть изогнута, конец — на уровне пояса.
  xf.cyl([0, B.knot, 0], 'y', B.center - B.ry - B.knot + 0.01, 0.004, MAT.enamel, { segments: 6, tint: BALLOON_TINT, radiusEnd: 0.013 });
  const pts: Vec3[] = [];
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    pts.push(xf.pt(0.035 * Math.sin(f * 2.6) * f, B.knot - (B.knot - B.end) * f, 0.02 * Math.sin(f * 4.1) * f));
  }
  for (let i = 0; i + 1 < pts.length; i++) rod(mb, pts[i]!, pts[i + 1]!, 0.0022, MAT.canvas, [1.25, 1.22, 1.15], 3);
  return [pts.at(-1)!, pts[0]!];
}

// ───────────── комната ─────────────

/**
 * Обставить странную комнату: занять все участки стен (ни бумаги, ни наклеек), поставить посередине вещь лицом к проходу.
 * Мест для вещей нет. null — помещения нет (пустые клетки).
 */
export function furnishOdd(ctx: RoomCtx, kind: OddKind): OddRoom | null {
  if (ctx.cells.length === 0) return null;
  for (const s of ctx.slots) s.used = true;
  const xs = ctx.cells.map((c) => c.xf.ox);
  const zs = ctx.cells.map((c) => c.xf.oz);
  const floor = ctx.cells[0]!.xf.oy;
  const box: [number, number, number, number] = [Math.min(...xs) - CELL / 2, Math.min(...zs) - CELL / 2, Math.max(...xs) + CELL / 2, Math.max(...zs) + CELL / 2];
  const cx = (box[0] + box[2]) / 2;
  const cz = (box[1] + box[3]) / 2;
  // Проход, с которого входят: клетка с проходом, ближайшая к началу сна (как у белой комнаты).
  let best: { d: number; at: [number, number] } | null = null;
  for (const c of ctx.cells) {
    (c.sides ?? []).forEach((side, d) => {
      if (side !== 'door' && side !== 'open') return;
      const dist = ctx.dist ? ctx.dist(c.cx + DX[d]!, c.cz + DZ[d]!) : 0;
      const at: [number, number] = [c.xf.ox + DX[d]! * (CELL / 2), c.xf.oz + DZ[d]! * (CELL / 2)];
      if (!best || dist < best.d) best = { d: dist, at };
    });
  }
  let face: [number, number] = [0, 1];
  const door = best as { d: number; at: [number, number] } | null;
  if (door) {
    const dx = door.at[0] - cx;
    const dz = door.at[1] - cz;
    face = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz) || 1];
  }
  const mb = ctx.cells[0]!.xf.mb;
  const col = ctx.cells[0]!.xf.col;
  const xf = new Xf(mb, col, cx, floor, cz, rotFor(face));
  const at: Vec3 = [cx, floor, cz];
  const out = { kind, room: ctx.room.id, tier: ctx.room.tier, box, y: [floor, floor + ctx.h] as [number, number], ...(door ? { door: door.at } : {}), face, at };
  // Вещь — не вещь сна: своим номером вершин, которого нет в журнале объектов, — касание её не растворяет, стирание стен и
  // потолка её не берёт (как то, что наросло на месте: GROWTH_OBJ). Шарик висит — он часть потолка, как цепь белой комнаты.
  const keep = mb.obj;
  try {
    if (kind === 'balloon') {
      const sway = mb.sway;
      mb.sway = { from: floor + BALLOON.center + BALLOON.ry, span: -(BALLOON.center + BALLOON.ry - BALLOON.end), gain: 0.22 };
      try {
        const line = hanging(xf, () => balloon(xf));
        return { ...out, trigger: { line, r: 0.03 } };
      } finally {
        mb.sway = sway;
      }
    }
    mb.obj = GROWTH_OBJ;
    if (kind === 'bayan') {
      chair(xf);
      bayan(xf, 0.47);
      xf.collider([-0.25, 0, -0.22], [0.26, 0.95, 0.22]);
      return { ...out, trigger: { box: span(xf, [-0.28, 0, -0.24], [0.29, 0.95, 0.24]) } };
    }
    if (kind === 'aquarium') {
      aquarium(xf, ctx.seed ^ ctx.room.id);
      xf.collider([-0.77, 0, -0.3], [0.77, 1.36, 0.3]);
      return { ...out, trigger: { box: span(xf, [-0.77, 0, -0.3], [0.77, 1.36, 0.3]) } };
    }
    const screen = television(xf);
    xf.collider([-0.33, 0, -0.5], [0.33, 0.5, TV_FRONT + 0.022]);
    return { ...out, trigger: { box: span(xf, [-0.33, 0, -0.5], [0.33, 0.55, TV_FRONT + 0.022]) }, screen };
  } finally {
    mb.obj = keep;
  }
}
