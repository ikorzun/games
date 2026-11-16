/**
 * Манекены людей (слова партнёра: «Сейчас фокусируемся на том, чтобы довести локации до идеала: цвет,
 * свет, текстура, расставить вещи и манекены людей»; раньше — «болванки людей… в позах»).
 *
 * Деревянный манекен художника в рост человека: голова — яйцо без лица, суставы — шары, видные издалека.
 * Шарниры здесь не украшение. Безликая неподвижная фигура в мире из точек иначе читалась бы как Осыпь —
 * у неё формы «сидящая фигура», «тот, кто идёт следом» (заметил куратор, `ideas.md`, T-16). Манекен с
 * шарнирами — вещь, а не существо: так в памяти остаются люди, от которых не сохранилось лиц («RENDERED
 * FROM MEMORY. DETAILS WERE NOT KEPT.»). Взрослые, без лиц, без лежащих поз.
 *
 * Поза — углы суставов (Pose); скелет считается прямой кинематикой от таза. Позы-заготовки — POSES.
 *
 * В местах манекенов нет: фигуры расставляет партнёр сам (его слова 16.11: «Не расставляй фигуры, я сам
 * это сделаю. Тем более мне нужны другие фигуры. В следующий раз спрашивай»). Здесь — вещь реестра: её
 * видно в опроснике (вкладка «Люди») и на картинках материалов. Координаты как у всего реквизита: лицом в +z, x — вбок, пол —
 * y = 0; у сидящих (pelvis.y задан) таз стоит на сиденье, у стоящих подошвы ставятся на пол.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';

type M3 = readonly [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mm = (a: M3, b: M3): M3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
const mv = (a: M3, v: Vec3): Vec3 => [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
const rx = (d: number): M3 => {
  const c = Math.cos(d * DEG);
  const s = Math.sin(d * DEG);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const ry = (d: number): M3 => {
  const c = Math.cos(d * DEG);
  const s = Math.sin(d * DEG);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const rz = (d: number): M3 => {
  const c = Math.cos(d * DEG);
  const s = Math.sin(d * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
/** Сгиб, который уводит смотрящую вниз кость вперёд (+z): бедро, плечо, локоть (с обратным знаком — колено). */
const flex = (d: number): M3 => rx(-d);
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Рука или нога: вперёд (сгиб в плече или бедре), вбок (отведение; плюс — от тела), сгиб локтя или колена, поворот. */
export interface Limb {
  fwd: number;
  out: number;
  bend: number;
  twist?: number;
}

export interface Pose {
  /**
   * Таз: высота центра над полом (нет — стоит, подошвы на полу), сдвиг вперёд, наклон вперёд, поворот,
   * крен. back — спиной к стене: корпус сдвигается так, чтобы спина была на этом z.
   */
  pelvis: { y?: number; z?: number; pitch: number; yaw?: number; roll?: number; back?: number };
  /** Наклон корпуса вперёд в пояснице и поворот плеч. */
  spine: number;
  twist?: number;
  head: { pitch: number; yaw: number; roll?: number };
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** Сгиб стопы: плюс — носок вверх. */
  footL?: number;
  footR?: number;
}

/** Длины, м: человек около 1,76 м. */
const SK = { hipX: 0.092, thigh: 0.44, shin: 0.43, ankle: 0.075, waist: 0.1, chest: 0.31, shoulderX: 0.185, neck: 0.085, upper: 0.29, fore: 0.255 } as const;

/** Позы-заготовки. Сидячие — для сиденья высотой 0,46 м (скамья зала ожидания, гнутый стул, кресло офиса). */
export const POSES = {
  /** Стоит, руки вдоль тела. */
  stand: { pelvis: { pitch: 0 }, spine: 2, head: { pitch: 4, yaw: 0 }, armL: { fwd: 4, out: 7, bend: 10 }, armR: { fwd: 2, out: 7, bend: 12 }, legL: { fwd: 1, out: 3, bend: 0 }, legR: { fwd: -1, out: 3, bend: 2 } },
  /** Ждёт: руки сцеплены впереди, голова опущена. */
  wait: { pelvis: { pitch: 0 }, spine: 4, head: { pitch: 16, yaw: 0 }, armL: { fwd: 16, out: -8, bend: 62, twist: 20 }, armR: { fwd: 16, out: -8, bend: 62, twist: -20 }, legL: { fwd: 0, out: 5, bend: 0 }, legR: { fwd: 0, out: 5, bend: 3 } },
  /** Стоит у окна или табло: руки за спиной, голова чуть вверх. */
  look: { pelvis: { pitch: 0 }, spine: 0, head: { pitch: -9, yaw: 0 }, armL: { fwd: -22, out: 6, bend: 34 }, armR: { fwd: -22, out: 6, bend: 34 }, legL: { fwd: 2, out: 4, bend: 0 }, legR: { fwd: -2, out: 4, bend: 0 } },
  /** Говорит по телефону: правая рука у уха, левая на поясе. */
  call: { pelvis: { pitch: 0, roll: 2 }, spine: 3, head: { pitch: 8, yaw: 0, roll: -10 }, armL: { fwd: 6, out: 36, bend: 95, twist: -40 }, armR: { fwd: 36, out: 26, bend: 142, twist: 30 }, legL: { fwd: 3, out: 3, bend: 4 }, legR: { fwd: -2, out: 6, bend: 0 } },
  /** Сидит, руки на бёдрах. */
  sit: { pelvis: { y: 0.56, z: 0.27, pitch: -2 }, spine: 8, head: { pitch: 10, yaw: 0 }, armL: { fwd: 30, out: 9, bend: 44 }, armR: { fwd: 28, out: 9, bend: 48 }, legL: { fwd: 86, out: 6, bend: 74 }, legR: { fwd: 84, out: 7, bend: 66 } },
  /** Сидит на диване (сиденье 0,52 м — выше скамьи), откинувшись, руки на коленях. */
  sofa: { pelvis: { y: 0.62, z: 0.27, pitch: -4 }, spine: 6, head: { pitch: 6, yaw: 0 }, armL: { fwd: 34, out: 10, bend: 40 }, armR: { fwd: 32, out: 10, bend: 44 }, legL: { fwd: 75, out: 7, bend: 58 }, legR: { fwd: 73, out: 8, bend: 60 } },
  /** Сидит за столом: руки лежат на столешнице. */
  desk: { pelvis: { y: 0.56, z: 0.27, pitch: 0 }, spine: 18, head: { pitch: 18, yaw: 0 }, armL: { fwd: 62, out: 14, bend: 58, twist: -15 }, armR: { fwd: 60, out: 14, bend: 62, twist: 15 }, legL: { fwd: 88, out: 6, bend: 92 }, legR: { fwd: 86, out: 7, bend: 86 } },
  /** Сидит на полу, обхватив колени. */
  hug: { pelvis: { y: 0.11, z: 0.2, pitch: -18 }, spine: 30, head: { pitch: 24, yaw: 0 }, armL: { fwd: 70, out: -6, bend: 62 }, armR: { fwd: 70, out: -6, bend: 62 }, legL: { fwd: 132, out: 9, bend: 122 }, legR: { fwd: 130, out: 11, bend: 118 } },
  /** Прислонился спиной к стене, руки опущены, взгляд в сторону. */
  lean: { pelvis: { pitch: -7, back: 0.03 }, spine: -3, head: { pitch: 2, yaw: 18 }, armL: { fwd: -6, out: 8, bend: 16 }, armR: { fwd: -4, out: 6, bend: 22 }, legL: { fwd: 9, out: 4, bend: 0 }, legR: { fwd: 22, out: 9, bend: 30 }, footR: 6 },
} as const satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;

/** Скелет в позе: точки суставов и рамки костей (столбцы — оси x, y, z кости в координатах предмета). */
export interface Skeleton {
  pelvis: Vec3;
  waist: Vec3;
  chestC: Vec3;
  neckBase: Vec3;
  neckTop: Vec3;
  head: Vec3;
  shL: Vec3;
  shR: Vec3;
  elL: Vec3;
  elR: Vec3;
  wrL: Vec3;
  wrR: Vec3;
  hipL: Vec3;
  hipR: Vec3;
  knL: Vec3;
  knR: Vec3;
  anL: Vec3;
  anR: Vec3;
  frames: { pelvis: M3; chest: M3; head: M3; foreL: M3; foreR: M3; footL: M3; footR: M3 };
}

/** Прямая кинематика. Стоящего ставит подошвами на пол, сидящего — тазом на заданную высоту. */
export function skeleton(p: Pose): Skeleton {
  const root = mm(mm(ry(p.pelvis.yaw ?? 0), rz(p.pelvis.roll ?? 0)), rx(p.pelvis.pitch));
  const waistF = mm(root, rx(p.spine));
  const chest = mm(waistF, ry(p.twist ?? 0));
  const headF = mm(mm(mm(chest, rx(p.head.pitch)), ry(p.head.yaw)), rz(p.head.roll ?? 0));
  const pelvis: Vec3 = [0, 0, p.pelvis.z ?? 0];
  const waist = add(pelvis, mv(root, [0, SK.waist, 0]));
  const shC = add(waist, mv(waistF, [0, SK.chest, 0]));
  const chestC = add(waist, mv(waistF, [0, 0.19, 0]));
  const neckBase = add(shC, mv(chest, [0, 0.03, 0]));
  const neckTop = add(neckBase, mv(chest, [0, SK.neck, 0]));
  const head = add(neckTop, mv(headF, [0, 0.115, 0.012]));
  const arm = (side: 1 | -1, l: Limb): { sh: Vec3; el: Vec3; wr: Vec3; fore: M3 } => {
    const sh = add(shC, mv(chest, [side * SK.shoulderX, -0.012, 0]));
    const upper = mm(mm(mm(chest, rz(side * l.out)), flex(l.fwd)), ry(side * (l.twist ?? 0)));
    const el = add(sh, mv(upper, [0, -SK.upper, 0]));
    const fore = mm(upper, flex(l.bend));
    const wr = add(el, mv(fore, [0, -SK.fore, 0]));
    return { sh, el, wr, fore };
  };
  const leg = (side: 1 | -1, l: Limb, foot: number): { hip: Vec3; kn: Vec3; an: Vec3; foot: M3 } => {
    const hip = add(pelvis, mv(root, [side * SK.hipX, -0.03, 0]));
    const thigh = mm(mm(mm(root, rz(side * l.out)), flex(l.fwd)), ry(side * (l.twist ?? 0)));
    const kn = add(hip, mv(thigh, [0, -SK.thigh, 0]));
    const shin = mm(thigh, flex(-l.bend));
    const an = add(kn, mv(shin, [0, -SK.shin, 0]));
    return { hip, kn, an, foot: mm(shin, rx(-foot)) };
  };
  const aL = arm(1, p.armL);
  const aR = arm(-1, p.armR);
  const lL = leg(1, p.legL, p.footL ?? 0);
  const lR = leg(-1, p.legR, p.footR ?? 0);
  const sk: Skeleton = {
    pelvis, waist, chestC, neckBase, neckTop, head,
    shL: aL.sh, shR: aR.sh, elL: aL.el, elR: aR.el, wrL: aL.wr, wrR: aR.wr,
    hipL: lL.hip, hipR: lR.hip, knL: lL.kn, knR: lR.kn, anL: lL.an, anR: lR.an,
    frames: { pelvis: root, chest, head: headF, foreL: aL.fore, foreR: aR.fore, footL: lL.foot, footR: lR.foot },
  };
  // Высота: сидящий — тазом на сиденье, стоящий — нижней точкой подошвы на полу.
  const dy = p.pelvis.y !== undefined ? p.pelvis.y : -Math.min(soleLow(sk.anL, sk.frames.footL), soleLow(sk.anR, sk.frames.footR));
  // Спиной к стене: задняя точка таза, груди и затылка — на заданном z.
  const dz = p.pelvis.back !== undefined ? p.pelvis.back - Math.min(sk.pelvis[2] - 0.108, sk.chestC[2] - 0.112, sk.head[2] - 0.108) : 0;
  return shift(sk, [0, dy, dz]);
}

/** Самая низкая точка подошвы: пятка и носок. */
function soleLow(an: Vec3, f: M3): number {
  return Math.min(add(an, mv(f, [0, -SK.ankle, -0.05]))[1], add(an, mv(f, [0, -SK.ankle, 0.17]))[1]);
}

function shift(s: Skeleton, d: Vec3): Skeleton {
  const out = { ...s } as Record<string, unknown>;
  for (const [k, v] of Object.entries(s)) if (Array.isArray(v) && v.length === 3) out[k] = add(v as Vec3, d);
  return out as unknown as Skeleton;
}

/** Все точки скелета, по которым считаются габариты (суставы, макушка, подошвы, кисти). */
export function skeletonPoints(s: Skeleton): Vec3[] {
  const pts: Vec3[] = [s.pelvis, s.waist, s.chestC, s.neckBase, s.neckTop, s.shL, s.shR, s.elL, s.elR, s.wrL, s.wrR, s.hipL, s.hipR, s.knL, s.knR, s.anL, s.anR];
  pts.push(add(s.head, mv(s.frames.head, [0, 0.12, 0])));
  for (const [an, f] of [[s.anL, s.frames.footL], [s.anR, s.frames.footR]] as const) {
    pts.push(add(an, mv(f, [0, -SK.ankle, -0.05])), add(an, mv(f, [0, -SK.ankle, 0.17])));
  }
  pts.push(add(s.wrL, mv(s.frames.foreL, [0, -0.17, 0])), add(s.wrR, mv(s.frames.foreR, [0, -0.17, 0])));
  return pts;
}

// ───────────────────────────── геометрия ─────────────────────────────

interface Paint {
  mat: number;
  tint: Vec3;
}

/** Эллипсоид с полуосями r (в осях рамки f) — голова, грудь, таз, кисть, стопа. */
function ellipsoid(xf: Xf, c: Vec3, f: M3, r: Vec3, pt: Paint, rings = 6, seg = 10, ao = 1): void {
  const mb = xf.mb;
  const rows: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const ph = (i / rings) * Math.PI;
    const y = -Math.cos(ph);
    const s = Math.sin(ph);
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const lx = Math.cos(th) * s;
      const lz = Math.sin(th) * s;
      const p = add(c, mv(f, [lx * r[0], y * r[1], lz * r[2]]));
      const n = norm(mv(f, [lx / r[0], y / r[1], lz / r[2]]));
      // Снизу темнее: шар у пола и под подбородком в тени.
      const a = ao * (0.82 + 0.18 * (0.5 + 0.5 * y));
      row.push(mb.vertex(xf.pt(p[0], p[1], p[2]), xf.dir(n[0], n[1], n[2]), pt.mat, pt.tint, a));
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      mb.tri(rows[i]![k]!, rows[i + 1]![k1]!, rows[i]![k1]!);
      mb.tri(rows[i]![k]!, rows[i + 1]![k]!, rows[i + 1]![k1]!);
    }
  }
}

/**
 * Сужающийся сегмент от a к b (плечо, предплечье, бедро, голень, шея, живот): радиус от ra к rb с лёгкой
 * выпуклостью посередине; side — направление, вдоль которого сечение шире в flat раз. Концы прячутся в
 * шарах суставов, поэтому заглушек нет.
 */
function limb(xf: Xf, a: Vec3, b: Vec3, ra: number, rb: number, side: Vec3, flat: number, pt: Paint, rings = 4, seg = 8): void {
  const mb = xf.mb;
  const ax = sub(b, a);
  const L = Math.hypot(ax[0], ax[1], ax[2]) || 1e-6;
  const d = scale(ax, 1 / L);
  let u = sub(side, scale(d, dot(side, d)));
  if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]);
  u = norm(u);
  const v = norm(cross(u, d));
  const rows: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = (ra + (rb - ra) * t) * (1 + 0.1 * Math.sin(Math.PI * t));
    const dr = (rb - ra) / L;
    const p0 = add(a, scale(d, t * L));
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const cu = Math.cos(th);
      const sv = Math.sin(th);
      const p = add(p0, add(scale(u, cu * r * flat), scale(v, sv * r)));
      const n = norm(add(add(scale(u, cu / flat), scale(v, sv)), scale(d, -dr)));
      row.push(mb.vertex(xf.pt(p[0], p[1], p[2]), xf.dir(n[0], n[1], n[2]), pt.mat, pt.tint, 0.9 + 0.1 * Math.sin(Math.PI * t)));
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      mb.tri(rows[i]![k]!, rows[i + 1]![k1]!, rows[i]![k1]!);
      mb.tri(rows[i]![k]!, rows[i + 1]![k]!, rows[i + 1]![k1]!);
    }
  }
}

function ball(xf: Xf, c: Vec3, r: number, pt: Paint, detail = 1): void {
  ellipsoid(xf, c, I3, [r, r, r], pt, 4 * detail, 7 * detail, 0.92);
}

/**
 * Сама фигура. Оттенок дерева у каждой свой (сид), шарниры темнее — их видно издалека. detail — во сколько
 * раз больше колец и граней (в игре 1; картинкам материалов — больше, чтобы грани не мешали судить о свете).
 */
export function buildMannequin(xf: Xf, pose: Pose, seed: number, detail = 1): Skeleton {
  const D = Math.max(1, Math.round(detail));
  const rnd = rng(seed);
  // Бук с разбросом тона; шары суставов — темнее, промасленные.
  const k = 0.94 + rnd() * 0.12;
  const wood: Paint = { mat: MAT.wood, tint: [1.86 * k, 2.12 * k, 2.42 * k] };
  const joint: Paint = { mat: MAT.wood, tint: [1.2 * k, 1.2 * k, 1.22 * k] };
  const s = skeleton(pose);
  const fr = s.frames;
  const across = mv(fr.pelvis, [1, 0, 0]);
  const acrossC = mv(fr.chest, [1, 0, 0]);
  // Корпус: таз, живот, грудь.
  ellipsoid(xf, add(s.pelvis, mv(fr.pelvis, [0, 0.01, 0])), fr.pelvis, [0.158, 0.1, 0.108], wood, 6 * D, 10 * D);
  limb(xf, add(s.pelvis, mv(fr.pelvis, [0, 0.05, 0])), add(s.waist, mv(fr.chest, [0, 0.09, 0])), 0.098, 0.106, across, 1.32, wood, 4 * D, 8 * D);
  ellipsoid(xf, s.chestC, fr.chest, [0.168, 0.165, 0.112], wood, 7 * D, 11 * D);
  ball(xf, s.waist, 0.082, joint, D);
  // Шея и голова: яйцо без лица, чуть уже книзу.
  limb(xf, s.neckBase, s.neckTop, 0.044, 0.04, acrossC, 1, wood, 2 * D, 7 * D);
  ball(xf, s.neckTop, 0.047, joint, D);
  ellipsoid(xf, s.head, fr.head, [0.093, 0.121, 0.108], wood, 7 * D, 11 * D);
  // Руки.
  for (const [sh, el, wr, fore] of [[s.shL, s.elL, s.wrL, fr.foreL], [s.shR, s.elR, s.wrR, fr.foreR]] as const) {
    ball(xf, sh, 0.056, joint, D);
    limb(xf, sh, el, 0.047, 0.037, acrossC, 1.08, wood, 4 * D, 8 * D);
    ball(xf, el, 0.04, joint, D);
    limb(xf, el, wr, 0.037, 0.029, acrossC, 1.12, wood, 4 * D, 8 * D);
    ball(xf, wr, 0.03, joint, D);
    // Кисть — плоская варежка вдоль предплечья.
    ellipsoid(xf, add(wr, mv(fore, [0, -0.085, 0])), fore, [0.044, 0.088, 0.021], wood, 5 * D, 8 * D);
  }
  // Ноги.
  for (const [hip, kn, an, foot] of [[s.hipL, s.knL, s.anL, fr.footL], [s.hipR, s.knR, s.anR, fr.footR]] as const) {
    ball(xf, hip, 0.068, joint, D);
    limb(xf, hip, kn, 0.074, 0.054, across, 1.05, wood, 4 * D, 8 * D);
    ball(xf, kn, 0.053, joint, D);
    limb(xf, kn, an, 0.051, 0.035, across, 1.05, wood, 4 * D, 8 * D);
    ball(xf, an, 0.036, joint, D);
    ellipsoid(xf, add(an, mv(foot, [0, -0.045, 0.06])), foot, [0.044, 0.033, 0.118], wood, 5 * D, 8 * D);
  }
  return s;
}

/** Запас на толщину тела вокруг точек скелета, м (грудь — 0,17 в стороны, 0,11 вперёд-назад). */
const BODY = 0.13;

function spec(pose: PoseName, ru: string, mount: 'free' | 'floor', collide: boolean): PropSpec {
  const pts = skeletonPoints(skeleton(POSES[pose]));
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const h = Math.max(...pts.map((p) => p[1])) + 0.01;
  // Посреди пола фигура стоит по центру своего места; у стены (сидящие, прислонённый) — спиной к z = 0.
  const dz = mount === 'free' ? -(Math.min(...zs) + Math.max(...zs)) / 2 : 0;
  const half = (v: number[]): number => Math.max(...v.map(Math.abs));
  return {
    w: Math.ceil((2 * half(xs) + 2 * BODY) * 100) / 100,
    d: Math.ceil((mount === 'free' ? 2 * half(zs.map((z) => z + dz)) + 2 * BODY : Math.max(...zs) + BODY) * 100) / 100,
    h: Math.ceil(h * 100) / 100,
    mount,
    ru,
    build: (xf, seed) => {
      // Каждый чуть по-своему: голова и руки на несколько градусов в сторону.
      const r = rng(seed * 7 + 3);
      const base = POSES[pose] as Pose;
      const jit = (v: number, a: number): number => v + (r() - 0.5) * 2 * a;
      const p: Pose = {
        ...base,
        head: { ...base.head, yaw: jit(base.head.yaw, 12), pitch: jit(base.head.pitch, 4) },
        armL: { ...base.armL, fwd: jit(base.armL.fwd, 4), bend: jit(base.armL.bend, 5) },
        armR: { ...base.armR, fwd: jit(base.armR.fwd, 4), bend: jit(base.armR.bend, 5) },
      };
      const at = dz !== 0 ? xf.child(0, 0, dz) : xf;
      const s = buildMannequin(at, p, seed);
      if (collide) {
        // Стоящий — преграда в рост; сидящий стоит на чужом сиденье и преградой не считается.
        const ps = skeletonPoints(s);
        const lo: Vec3 = [Math.min(...ps.map((q) => q[0])) - 0.06, 0, Math.min(...ps.map((q) => q[2])) - 0.06];
        const hi: Vec3 = [Math.max(...ps.map((q) => q[0])) + 0.06, Math.max(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[2])) + 0.06];
        at.collider(lo, hi);
      }
    },
  };
}

/** Манекены: имена mq_<поза>. Сидячие садятся на сиденье высотой 0,46 м (сиденье ставится отдельно). */
export const PEOPLE_PROPS: Record<string, PropSpec> = {
  mq_stand: spec('stand', 'манекен человека: стоит, руки вдоль тела', 'free', true),
  mq_wait: spec('wait', 'манекен человека: ждёт, руки сцеплены впереди', 'free', true),
  mq_look: spec('look', 'манекен человека: смотрит вверх, руки за спиной', 'free', true),
  mq_call: spec('call', 'манекен человека: говорит по телефону', 'free', true),
  mq_sit: spec('sit', 'манекен человека: сидит, руки на бёдрах', 'floor', false),
  mq_sofa: spec('sofa', 'манекен человека: сидит на диване', 'floor', false),
  mq_desk: spec('desk', 'манекен человека: сидит за столом, руки на столешнице', 'floor', false),
  mq_hug: spec('hug', 'манекен человека: сидит на полу, обхватив колени', 'floor', true),
  mq_lean: spec('lean', 'манекен человека: прислонился спиной к стене', 'floor', true),
};
