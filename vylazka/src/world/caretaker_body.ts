/**
 * Тело Смотрителя — один раз за игру (квиз 24.11: «без тела до акта IV; тело — один раз, ближе к финалу, фигурой партнёра»).
 * Канон, A4_E03 «отражение без зеркала»: игрок видит раннюю сцену сортировки с другого ракурса — у стола стоит тот, кто
 * разглаживает бирку, и движения у него те же, что у героя. Узнаётся по действию, а не по лицу (канон, §8): вполоборота от
 * игрока, голова опущена, одна рука разглаживает бумажную бирку на столе и выравнивает её — медленно, по кругу. Ни
 * превращения, ни погони, ни «я — это ты».
 *
 * Здесь — чья фигура, как стоит стол и бирка, сам жест и сетки. Когда фигура есть и как она рассеивается —
 * systems/caretaker_body.ts; когда её зовут — ui/koma_flow.ts (сцена A4_E03 в лимбо).
 *
 * Чья фигура — одна запись CARETAKER_BODY. Партнёр может поставить свою: назвать фигуру в конструкторе «Смотритель» (она
 * возьмётся сама и в местах стоять не будет — figures_data.ts, PLACED_FIGURES) или вписать её ключ в kind. Тогда поза и
 * материал — его, а жест двигает правую кисть его фигуры вокруг того места, где она у него стоит.
 *
 * Координаты фигуры — как в конструкторе: подошвы на y = 0, лицом к +z, левая рука — в +x. Стол и бирка стоят в тех же
 * координатах: всё вместе ставится в мир одной точкой и одним поворотом.
 *
 * Чистый TS: читают игра и тесты.
 */
import type { Vec3 } from '../core/types';
import { FIGURE_PAINT, furred, SMOKE_DOTS } from './figure_mesh';
import { solve } from './figure_ik';
import type { FigureMaterial, FigureSpec } from './figures';
import { isCaretakerFigure } from './figures';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { mannequin, skeleton, skeletonPoints } from './props_people';
import type { Part, Pose } from './props_people';

export interface CaretakerBodySpec {
  /**
   * Чья фигура: 'default' — дымный манекен основной модели (поза ниже); иначе ключ фигуры партнёра из
   * world/partner/figures.json. Фигура партнёра с именем «Смотритель» (или ключом caretaker) берётся сама, без правки здесь.
   */
  kind: string;
  /** Поза манекена по умолчанию. Правую кисть на бирку ставит жест (wristR), левую — на край стола. */
  pose: Pose;
  /** Где он стоит: x — вбок от взгляда игрока (плюс — вправо), z — сколько метров вперёд по взгляду, м. */
  offset: [number, number];
  /** Насколько он отвёрнут от игрока, град: 0 — лицом, 180 — спиной; «вполоборота» — 120–145. */
  away: number;
}

/**
 * Тело Смотрителя по умолчанию: дымный манекен у стола. Корпус наклонён к столу, голова опущена (лица у манекена нет, и
 * оно не нужно: узнают по рукам), ноги стоят как у человека, который давно так работает.
 */
export const CARETAKER_BODY: CaretakerBodySpec = {
  kind: 'default',
  pose: {
    pelvis: { pitch: 4 },
    spine: 24,
    twist: -6,
    head: { pitch: 40, yaw: -8, roll: 3 },
    armL: { fwd: 30, out: 12, bend: 40, twist: 8 },
    armR: { fwd: 40, out: 8, bend: 30, twist: -15 },
    legL: { fwd: 4, out: 5, bend: 3 },
    legR: { fwd: -5, out: 6, bend: 7 },
    footR: 4,
  },
  offset: [-0.3, 2.4],
  away: 125,
};

/** Стол сортировки в координатах фигуры: середина столешницы (x, z), ширина, глубина и высота, м. */
export const TABLE = { x: -0.1, z: 0.66, w: 1.05, d: 0.56, h: 0.76 } as const;
/** Бирка на столе: середина (координаты фигуры), длина и ширина, м. Перед правой рукой, ближе к краю. */
export const TAG_AT: Vec3 = [-0.1, TABLE.h + 0.003, 0.5];
const TAG_L = 0.19;
const TAG_W = 0.095;
/** Где лежат кончики пальцев левой руки: на краю стола, придерживает. */
const LEFT_REST: Vec3 = [0.16, TABLE.h + 0.012, 0.44];

/**
 * Жест — по кругу: столько секунд один круг, столько кадров руки на круг. 5 с — как герой сам дописывает бирку взглядом в
 * лимбо (koma_flow, WRITE_S; квиз 25.11: «5 с, как запись взглядом»): узнаёт себя по ритму.
 */
export const GESTURE_S = 5;
export const GESTURE_FRAMES = 30;
/**
 * Смотритель по умолчанию — из частиц (квиз 25.11: «создай его сам из частиц»): манекен, от поверхности которого остались
 * точки графита, как карандаш на бирке, — в белом лимбо они читаются; пока он стоит, фигура всё время чуть осыпается
 * (CARETAKER_SHED): частицы висят вокруг, будто он из них соткан. Не дым фигур мест — тот рассеивается угрозой.
 */
export const CARETAKER_DOTS = 0.8;
export const CARETAKER_SHED = 0.16;
const PARTICLE_PAINT = { body: { mat: MAT.plaster, tint: [0.5, 0.5, 0.53] as Vec3 }, joint: { mat: MAT.plaster, tint: [0.44, 0.44, 0.47] as Vec3 } };
/** Насколько бирку утаскивает рука, пока разглаживает, — потом он её выравнивает, рад. */
const SKEW = (8 * Math.PI) / 180;

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * Жест в доле круга u (0…1): куда сдвинута правая кисть от места покоя (координаты фигуры, м) и на сколько повёрнута
 * бирка, рад. Две трети круга рука ходит по бирке туда и обратно — разглаживает, и бумагу понемногу утаскивает вбок;
 * потом пальцы на углу — бирка выровнена; потом рука чуть приподнимается и возвращается. Начало и конец круга совпадают.
 */
export function gesture(u: number): { hand: Vec3; tagYaw: number } {
  const w = ((u % 1) + 1) % 1;
  if (w < 0.62) {
    const s = w / 0.62;
    return { hand: [0.055 * Math.sin(2 * Math.PI * s), 0, 0.012 * Math.sin(4 * Math.PI * s)], tagYaw: SKEW * smooth(s) };
  }
  if (w < 0.84) {
    const s = (w - 0.62) / 0.22;
    const k = Math.sin(Math.PI * s);
    return { hand: [-0.045 * k, 0.004 * k, -0.025 * k], tagYaw: SKEW * (1 - smooth(s)) };
  }
  const s = (w - 0.84) / 0.16;
  return { hand: [0, 0.022 * Math.sin(Math.PI * s), 0], tagYaw: 0 };
}

const ARM: readonly Part[] = ['upperR', 'foreR', 'handR'];

/** Тело, которое встанет: из записи или фигура партнёра. */
export interface CaretakerFigure {
  /** 'default' или ключ фигуры партнёра. */
  source: string;
  pose: Pose;
  material: FigureMaterial;
}

/**
 * Чья фигура встанет. Порядок: фигура партнёра, названная «Смотритель» (он назначил её сам); фигура партнёра, чей ключ
 * вписан в kind; иначе — манекен по умолчанию, дымный.
 */
export function caretakerFigure(spec: CaretakerBodySpec, figures: readonly FigureSpec[]): CaretakerFigure {
  const own = figures.find(isCaretakerFigure) ?? (spec.kind !== 'default' ? figures.find((f) => f.id === spec.kind) : undefined);
  if (own) return { source: own.id, pose: own.pose, material: own.material };
  return { source: 'default', pose: spec.pose, material: 'smoke' };
}

/** Кончик кисти в позе (координаты фигуры): им он касается бумаги. side — правая или левая. */
export function fingertip(pose: Pose, side: 'R' | 'L' = 'R'): Vec3 {
  const s = skeleton(pose);
  const w = side === 'R' ? s.wrR : s.wrL;
  const f = side === 'R' ? s.frames.foreR : s.frames.foreL;
  return [w[0] - 0.17 * f[1], w[1] - 0.17 * f[4], w[2] - 0.17 * f[7]];
}

/**
 * Поставить кончики пальцев в точку: кисть — варежка вдоль предплечья, поэтому решатель ведёт запястье, а запястье
 * подбирается так, чтобы кончики пришли куда надо (несколько приближений).
 */
function reachTip(pose: Pose, side: 'R' | 'L', target: Vec3): Pose {
  const h = side === 'R' ? 'wristR' : 'wristL';
  let p = pose;
  let wrist: Vec3 = [target[0], target[1] + 0.12, target[2] - 0.1];
  for (let i = 0; i < 5; i++) {
    p = solve(p, h, wrist);
    const tip = fingertip(p, side);
    wrist = [wrist[0] + target[0] - tip[0], wrist[1] + target[1] - tip[1], wrist[2] + target[2] - tip[2]];
  }
  return solve(p, h, wrist);
}

/**
 * Поза покоя: у манекена по умолчанию кончики пальцев правой руки — на бирке, левой — на краю стола. У фигуры партнёра поза
 * его, как есть.
 */
export function restPose(fig: CaretakerFigure): Pose {
  if (fig.source !== 'default') return fig.pose;
  const p = reachTip(fig.pose, 'L', LEFT_REST);
  return reachTip(p, 'R', [TAG_AT[0], TAG_AT[1] + 0.012, TAG_AT[2]]);
}

/** Поза в доле круга жеста: правая кисть сдвинута от места покоя (тем же решателем, что гнёт фигуры в конструкторе). */
export function gesturePose(rest: Pose, u: number): Pose {
  const w = skeleton(rest).wrR;
  const h = gesture(u).hand;
  return solve(rest, 'wristR', [w[0] + h[0], w[1] + h[1], w[2] + h[2]]);
}

export interface CaretakerMesh {
  figure: CaretakerFigure;
  /** Тело без правой руки: стоит неподвижно. */
  body: MeshData;
  /** Правая рука в GESTURE_FRAMES точках круга жеста: рендер показывает одну, по времени. */
  arm: MeshData[];
  /** Стол сортировки. */
  table: MeshData;
  /** Бирка вокруг своей середины: её поворачивает жест. Середина — TAG_AT. */
  tag: MeshData;
  /** Редкость точек (дымная) или 0. */
  dots: number;
  /** Середина тела в координатах фигуры: от неё меряется, подошёл ли игрок. */
  core: Vec3;
  /** Верх фигуры над полом, м. */
  top: number;
}

/** Стол: светлая крашеная столешница на четырёх стальных ножках с царгой — как в бюро находок, без примет. */
function tableMesh(): MeshData {
  const mb = new MeshBuilder();
  const { x, z, w, d, h } = TABLE;
  // Светлый: в белом лимбо тёмный стол перетягивал бы взгляд с бирки и руки; картонная бирка на нём видна.
  const top: Vec3 = [0.9, 0.88, 0.83];
  const leg: Vec3 = [0.62, 0.62, 0.64];
  mb.box([x - w / 2, h - 0.032, z - d / 2], [x + w / 2, h, z + d / 2], MAT.enamel, { tint: top, bevel: 0.006 });
  const lx = w / 2 - 0.05;
  const lz = d / 2 - 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box([x + sx * lx - 0.016, 0, z + sz * lz - 0.016], [x + sx * lx + 0.016, h - 0.032, z + sz * lz + 0.016], MAT.steel, { tint: leg, aoBottom: 0.75, skip: ['ny'] });
  // Царга под столешницей: стол читается столом и с ракурса, где ножек не видно.
  mb.box([x - lx, h - 0.11, z - lz - 0.01], [x + lx, h - 0.032, z - lz + 0.01], MAT.enamel, { tint: [0.78, 0.77, 0.73], skip: ['py'] });
  mb.box([x - lx, h - 0.11, z + lz - 0.01], [x + lx, h - 0.032, z + lz + 0.01], MAT.enamel, { tint: [0.78, 0.77, 0.73], skip: ['py'] });
  return mb.build();
}

/** Бирка: картонный ярлык с усиленной дыркой и петлёй нитки (как у бирок в мире), вокруг своей середины, длинной стороной вдоль x. */
function tagMesh(): MeshData {
  const mb = new MeshBuilder();
  const paper: Vec3 = [1.3, 1.22, 1.0];
  const twine: Vec3 = [0.55, 0.5, 0.42];
  const hl = TAG_L / 2;
  const hw = TAG_W / 2;
  // Срезанные углы у дырки: два бруска — прямоугольник и клин потоньше.
  mb.box([-hl + 0.02, 0, -hw], [hl, 0.0025, hw], MAT.cardboard, { tint: paper, skip: ['ny'] });
  mb.box([-hl, 0, -hw + 0.014], [-hl + 0.02, 0.0025, hw - 0.014], MAT.cardboard, { tint: paper, skip: ['ny'] });
  // Колечко вокруг дырки — чуть темнее.
  mb.box([-hl + 0.008, 0.0025, -0.009], [-hl + 0.026, 0.0035, 0.009], MAT.cardboard, { tint: [0.86, 0.78, 0.62], skip: ['ny'] });
  // Петля нитки, брошенная на стол.
  const pts: Vec3[] = [[-hl + 0.017, 0.004, 0], [-hl - 0.03, 0.003, 0.02], [-hl - 0.075, 0.003, 0.012], [-hl - 0.09, 0.003, -0.018], [-hl - 0.055, 0.003, -0.03], [-hl + 0.012, 0.004, -0.004]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * 0.0012;
    const nz = (dx / L) * 0.0012;
    mb.quad([a[0] - nx, a[1], a[2] - nz], [a[0] + nx, a[1], a[2] + nz], [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz], MAT.canvas, twine);
  }
  return mb.build();
}

/** Собрать тело Смотрителя: фигура, правая рука по кадрам жеста, стол и бирка. seed — разброс тона манекена. */
export function caretakerMesh(spec: CaretakerBodySpec, figures: readonly FigureSpec[], seed: number, frames = GESTURE_FRAMES): CaretakerMesh {
  const figure = caretakerFigure(spec, figures);
  const own = figure.source === 'default';
  const paint = own ? PARTICLE_PAINT : figure.material === 'wood' ? undefined : FIGURE_PAINT[figure.material];
  const fur = (d: MeshData): MeshData => (figure.material === 'hair' ? furred(d) : d);
  const rest = restPose(figure);
  const sink = new Xf(new MeshBuilder(), null, 0, 0, 0, 0);
  const bodyMb = new MeshBuilder();
  const bodyXf = new Xf(bodyMb, null, 0, 0, 0, 0);
  const s = mannequin((part) => (ARM.includes(part) ? sink : bodyXf), rest, seed, 1, paint);
  const arm: MeshData[] = [];
  for (let i = 0; i < frames; i++) {
    const mb = new MeshBuilder();
    const xf = new Xf(mb, null, 0, 0, 0, 0);
    mannequin((part) => (ARM.includes(part) ? xf : sink), gesturePose(rest, i / frames), seed, 1, paint);
    arm.push(fur(mb.build()));
  }
  const top = Math.max(...skeletonPoints(s).map((p) => p[1]));
  return { figure, body: fur(bodyMb.build()), arm, table: tableMesh(), tag: tagMesh(), dots: own ? CARETAKER_DOTS : figure.material === 'smoke' ? SMOKE_DOTS : 0, core: [s.waist[0], s.waist[1], s.waist[2]], top };
}

/**
 * Где встать в лимбо: перед взглядом игрока (eye — глаза, yaw — куда смотрит; yaw 0 — в −z), по записи spec, — но не в
 * экспонат: если на месте стола или фигуры стоит вещь (busy — их точки), место сдвигается вбок и дальше. Возвращает точку
 * фигуры (подошвы, на полу floor) и её поворот.
 */
export function caretakerSpot(spec: CaretakerBodySpec, eye: Vec3, yaw: number, floor: number, busy: readonly Vec3[]): { at: Vec3; yaw: number } {
  const fwd: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
  const right: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
  const away = (spec.away * Math.PI) / 180;
  // Лицом к игроку фигура повёрнута на yaw (её +z смотрит туда, откуда смотрят); «отвёрнут» — доворот на away.
  const figYaw = yaw + away;
  const place = (side: number, ahead: number): { at: Vec3; yaw: number } => ({ at: [eye[0] + right[0] * side + fwd[0] * ahead, floor, eye[2] + right[1] * side + fwd[1] * ahead], yaw: figYaw });
  // Стол стоит перед фигурой: его середина в мире.
  const tableOf = (p: { at: Vec3; yaw: number }): [number, number] => {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    return [p.at[0] + TABLE.x * c + TABLE.z * s, p.at[2] - TABLE.x * s + TABLE.z * c];
  };
  const free = (p: { at: Vec3; yaw: number }): boolean => {
    const t = tableOf(p);
    return busy.every((b) => Math.hypot(b[0] - p.at[0], b[2] - p.at[2]) > 0.9 && Math.hypot(b[0] - t[0], b[2] - t[1]) > 1);
  };
  const [sx, sz] = spec.offset;
  for (const [ds, dz] of [[0, 0], [0.9, 0.3], [-0.9, 0.3], [0, 0.9], [1.6, 0.6], [-1.6, 0.6], [0, 1.8], [2.4, 1.2], [-2.4, 1.2]] as const) {
    const p = place(sx + ds, sz + dz);
    if (free(p)) return p;
  }
  return place(sx, sz);
}
