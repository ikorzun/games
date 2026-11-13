/**
 * Реквизит из примитивов. Каждый предмет описан в своих локальных координатах (метры, y вверх)
 * и ставится через Xf: сдвиг плюс поворот на четверть оборота вокруг вертикали — коробки остаются
 * осевыми, так что коллайдеры и свет считаются дёшево.
 */
import type { Vec3 } from '../core/types';
import type { ColliderSet } from './colliders';
import type { Axis, BoxOpts, MeshBuilder } from './kit';
import { MAT } from './materials';
import { SIGN } from './signs';

/** Размещение: начало координат предмета и поворот на rot четвертей оборота против часовой (вид сверху). */
export class Xf {
  constructor(
    readonly mb: MeshBuilder,
    readonly col: ColliderSet | null,
    readonly ox: number,
    readonly oy: number,
    readonly oz: number,
    readonly rot: 0 | 1 | 2 | 3 = 0,
  ) {}

  pt(x: number, y: number, z: number): Vec3 {
    let rx = x;
    let rz = z;
    if (this.rot === 1) {
      rx = z;
      rz = -x;
    } else if (this.rot === 2) {
      rx = -x;
      rz = -z;
    } else if (this.rot === 3) {
      rx = -z;
      rz = x;
    }
    return [this.ox + rx, this.oy + y, this.oz + rz];
  }

  private span(min: Vec3, max: Vec3): [Vec3, Vec3] {
    const a = this.pt(min[0], min[1], min[2]);
    const b = this.pt(max[0], max[1], max[2]);
    return [
      [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    ];
  }

  box(min: Vec3, max: Vec3, mat: number, opts: BoxOpts = {}): void {
    const [lo, hi] = this.span(min, max);
    this.mb.box(lo, hi, mat, opts);
  }

  /** Невидимая преграда для игрока. */
  collider(min: Vec3, max: Vec3): void {
    if (!this.col) return;
    const [lo, hi] = this.span(min, max);
    this.col.addBox(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
  }

  /** Коробка, которая и видна, и мешает пройти. */
  solid(min: Vec3, max: Vec3, mat: number, opts: BoxOpts = {}): void {
    this.box(min, max, mat, opts);
    this.collider(min, max);
  }

  cyl(base: Vec3, axis: Axis, length: number, radius: number, mat: number, opts: { tint?: Vec3; ao?: number; segments?: number; caps?: boolean; radiusEnd?: number } = {}): void {
    if (axis === 'y') {
      this.mb.cylinder(this.pt(base[0], base[1], base[2]), 'y', length, radius, mat, opts);
      return;
    }
    const end: Vec3 = axis === 'x' ? [base[0] + length, base[1], base[2]] : [base[0], base[1], base[2] + length];
    const a = this.pt(base[0], base[1], base[2]);
    const b = this.pt(end[0], end[1], end[2]);
    const worldAxis: Axis = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]) ? 'x' : 'z';
    const i = worldAxis === 'x' ? 0 : 2;
    const flipped = b[i]! < a[i]!;
    // При развороте оси меняются местами и концы конуса.
    const rEnd = opts.radiusEnd ?? radius;
    if (flipped) this.mb.cylinder(b, worldAxis, length, rEnd, mat, { ...opts, radiusEnd: radius });
    else this.mb.cylinder(a, worldAxis, length, radius, mat, opts);
  }

  /**
   * Надпись, табличка или плакат из атласа (world/signs.ts) на стене позади: середина низа — в точке
   * (x, y), ширина w метров, высота по пропорции знака. Лист отстоит от стены на off, чтобы не рябил.
   * tint красит трафарет (у печатного — оставить белым).
   */
  sign(id: string, x: number, y: number, w?: number, tint: Vec3 = [1, 1, 1], off = 0.005): void {
    const s = SIGN[id];
    if (!s) throw new Error(`нет такого знака: ${id}`);
    const width = w ?? s.w;
    const height = (width * s.ph) / s.pw;
    const alpha = s.kind === 'stencil' || s.kind === 'brush' || s.kind === 'arc' || s.kind === 'tally';
    this.mb.quadUv([this.pt(x - width / 2, y, off), this.pt(x + width / 2, y, off), this.pt(x + width / 2, y + height, off), this.pt(x - width / 2, y + height, off)], [s.u0, s.v0, s.u1, s.v1], alpha ? MAT.stencil : MAT.print, tint, 1);
  }

  /** Знак на полу: левый нижний угол рисунка — в точке (x0, z0), ширина w вдоль +x, верх рисунка — в сторону +z. */
  floorSign(id: string, x0: number, z0: number, w: number, tint: Vec3 = [1, 1, 1], y = 0.004): void {
    const s = SIGN[id];
    if (!s) throw new Error(`нет такого знака: ${id}`);
    const depth = (w * s.ph) / s.pw;
    const alpha = s.kind === 'stencil' || s.kind === 'brush' || s.kind === 'arc' || s.kind === 'tally';
    // Лист смотрит вверх: обход идёт от правого ближнего угла, поэтому u перевёрнуто.
    this.mb.quadUv([this.pt(x0 + w, y, z0), this.pt(x0, y, z0), this.pt(x0, y, z0 + depth), this.pt(x0 + w, y, z0 + depth)], [s.u1, s.v0, s.u0, s.v1], alpha ? MAT.stencil : MAT.print, tint, 1);
  }

  /** Вложенное размещение: локальный сдвиг и добавочный поворот. */
  child(x: number, y: number, z: number, rot: 0 | 1 | 2 | 3 = 0): Xf {
    const p = this.pt(x, y, z);
    return new Xf(this.mb, this.col, p[0], p[1], p[2], ((this.rot + rot) % 4) as 0 | 1 | 2 | 3);
  }
}

const DARK: Vec3 = [0.35, 0.35, 0.35];

/**
 * Труба вдоль локальной оси x от 0 до length на высоте y, прижата к стене z = 0 (стена позади, z < 0).
 * Хомуты каждые 1,5 м, фланцы на стыках.
 */
export function pipeRun(xf: Xf, length: number, y: number, radius: number, mat: number = MAT.rust, tint: Vec3 = [1, 1, 1]): void {
  const z = radius + 0.06;
  xf.cyl([0, y, z], 'x', length, radius, mat, { tint, segments: 10, caps: false });
  for (let x = 0.4; x < length; x += 1.5) {
    xf.box([x - 0.025, y - radius - 0.015, 0], [x + 0.025, y + radius + 0.015, z + radius + 0.015], MAT.steel, { tint: [0.6, 0.6, 0.6] });
  }
  for (let x = 1.15; x < length - 0.3; x += 3) {
    xf.cyl([x - 0.03, y, z], 'x', 0.06, radius + 0.035, mat, { tint: [0.8, 0.8, 0.8], segments: 10 });
  }
}

/** Вентиль на трубе: маховик лицом в комнату (к +z). Начало — центр трубы. */
export function valve(xf: Xf, radius = 0.12): void {
  xf.cyl([0, 0, 0.02], 'z', 0.16, 0.022, MAT.steel);
  xf.cyl([0, 0, 0.16], 'z', 0.03, radius, MAT.paintRed, { segments: 12 });
  xf.cyl([0, 0, 0.19], 'z', 0.02, 0.035, MAT.steel);
  xf.box([-0.07, -0.05, -0.07], [0.07, 0.05, 0.07], MAT.rust, { bevel: 0.015 });
}

/** Потолочный светильник в решётке (не горит). Начало — точка крепления на потолке. */
export function cageLamp(xf: Xf): void {
  xf.box([-0.09, -0.04, -0.09], [0.09, 0, 0.09], MAT.metalGreen, { bevel: 0.012 });
  xf.cyl([0, -0.2, 0], 'y', 0.16, 0.055, MAT.enamel, { tint: [0.75, 0.75, 0.7], segments: 8 });
  for (const [dx, dz] of [
    [0.075, 0],
    [-0.075, 0],
    [0, 0.075],
    [0, -0.075],
  ] as const) {
    xf.box([dx - 0.006, -0.23, dz - 0.006], [dx + 0.006, -0.04, dz + 0.006], MAT.steel, { tint: [0.5, 0.5, 0.5] });
  }
  xf.box([-0.081, -0.236, -0.081], [0.081, -0.224, 0.081], MAT.steel, { tint: [0.5, 0.5, 0.5] });
}

/** Двухъярусные нары: 1,9 × 0,75 м, изголовьем к стене x = 0, длинной стороной вдоль z. Начало — угол у пола. */
export function bunk(xf: Xf): void {
  const L = 1.9;
  const W = 0.75;
  const post = 0.045;
  for (const x of [0, W - post]) {
    for (const z of [0, L - post]) {
      xf.box([x, 0, z], [x + post, 1.75, z + post], MAT.metalGreen, { aoBottom: 0.6 });
    }
  }
  for (const y of [0.42, 1.25]) {
    xf.box([0, y - 0.04, 0], [W, y, post], MAT.metalGreen);
    xf.box([0, y - 0.04, L - post], [W, y, L], MAT.metalGreen);
    xf.box([0, y - 0.04, 0], [post, y, L], MAT.metalGreen);
    xf.box([W - post, y - 0.04, 0], [W, y, L], MAT.metalGreen);
    // Сетка-настил и матрас со свёрнутым одеялом.
    xf.box([post, y - 0.03, post], [W - post, y - 0.015, L - post], MAT.steel, { tint: [0.45, 0.45, 0.45] });
    xf.box([0.03, y, 0.04], [W - 0.03, y + 0.09, L - 0.04], MAT.canvas, { bevel: 0.03, tint: y > 1 ? [0.9, 0.85, 0.8] : [0.75, 0.8, 0.75] });
    xf.box([0.08, y + 0.09, 0.1], [W - 0.08, y + 0.17, 0.45], MAT.canvas, { bevel: 0.035, tint: [0.55, 0.5, 0.45] });
  }
  xf.collider([0, 0, 0], [W, 1.75, L]);
}

/** Шкафчик раздевалки 0,45 × 0,5 × 1,8 м, спиной к стене z = 0, дверцей к +z. Начало — середина спинки у пола. */
export function locker(xf: Xf, open = false, tint: Vec3 = [1, 1, 1]): void {
  const w = 0.45;
  const d = 0.5;
  xf.solid([-w / 2, 0, 0], [w / 2, 1.8, d], MAT.metalGreen, { bevel: 0.015, aoBottom: 0.6, tint });
  if (open) {
    // Дверца распахнута: тёмный проём и створка сбоку.
    xf.box([-w / 2 + 0.03, 0.08, d - 0.005], [w / 2 - 0.03, 1.74, d + 0.004], MAT.rubber, { tint: [0.25, 0.25, 0.25] });
    xf.box([w / 2 - 0.01, 0.06, d], [w / 2 + 0.012, 1.76, d + 0.4], MAT.metalGreen, { tint });
  } else {
    xf.box([-w / 2 + 0.025, 0.06, d], [w / 2 - 0.025, 1.76, d + 0.012], MAT.metalGreen, { bevel: 0.006, tint: [tint[0] * 1.08, tint[1] * 1.08, tint[2] * 1.08] });
    for (let i = 0; i < 4; i++) {
      xf.box([-0.11, 1.5 + i * 0.045, d + 0.012], [0.11, 1.515 + i * 0.045, d + 0.016], MAT.rubber, { tint: DARK });
    }
    xf.box([w / 2 - 0.09, 0.95, d + 0.012], [w / 2 - 0.06, 1.05, d + 0.04], MAT.steel);
  }
  xf.box([-w / 2, 1.8, 0], [w / 2, 1.83, d], MAT.metalGreen, { tint: [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8] });
}

/** Бочка 200 л. Начало — центр дна. */
export function barrel(xf: Xf, mat: number = MAT.rust, tint: Vec3 = [1, 1, 1]): void {
  const r = 0.29;
  xf.cyl([0, 0, 0], 'y', 0.88, r, mat, { tint, segments: 14, ao: 0.9 });
  for (const y of [0.02, 0.29, 0.58, 0.85]) {
    xf.cyl([0, y, 0], 'y', 0.025, r + 0.012, mat, { tint: [tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85], segments: 14, caps: false });
  }
  xf.cyl([0.12, 0.88, 0.1], 'y', 0.02, 0.035, MAT.steel, { segments: 8 });
  xf.collider([-r * 0.8, 0, -r * 0.8], [r * 0.8, 0.88, r * 0.8]);
}

/** Деревянный ящик. Начало — центр дна. */
export function crate(xf: Xf, w = 0.6, h = 0.45, d = 0.45, tint: Vec3 = [1, 1, 1]): void {
  xf.solid([-w / 2, 0, -d / 2], [w / 2, h, d / 2], MAT.wood, { bevel: 0.012, aoBottom: 0.55, tint });
  const t: Vec3 = [tint[0] * 0.75, tint[1] * 0.75, tint[2] * 0.75];
  // Обвязка рейками по краям.
  for (const x of [-w / 2 - 0.008, w / 2 - 0.05]) {
    xf.box([x, 0, -d / 2 - 0.008], [x + 0.058, h + 0.008, d / 2 + 0.008], MAT.wood, { tint: t });
  }
  xf.box([-w / 2, h * 0.45, d / 2], [w / 2, h * 0.45 + 0.012, d / 2 + 0.006], MAT.rubber, { tint: DARK });
}

/** Стол 1,2 × 0,6 м. Начало — центр у пола. */
export function table(xf: Xf): void {
  xf.box([-0.6, 0.72, -0.3], [0.6, 0.76, 0.3], MAT.wood, { bevel: 0.01, tint: [0.9, 0.85, 0.8] });
  for (const x of [-0.56, 0.52]) {
    for (const z of [-0.26, 0.22]) xf.box([x, 0, z], [x + 0.04, 0.72, z + 0.04], MAT.steel, { tint: [0.5, 0.5, 0.5], aoBottom: 0.6 });
  }
  xf.box([-0.56, 0.6, -0.26], [0.56, 0.64, -0.22], MAT.steel, { tint: [0.5, 0.5, 0.5] });
  xf.collider([-0.6, 0, -0.3], [0.6, 0.76, 0.3]);
}

/** Табурет. Начало — центр у пола. */
export function stool(xf: Xf): void {
  xf.box([-0.17, 0.42, -0.17], [0.17, 0.46, 0.17], MAT.wood, { bevel: 0.01 });
  for (const x of [-0.15, 0.12]) {
    for (const z of [-0.15, 0.12]) xf.box([x, 0, z], [x + 0.03, 0.42, z + 0.03], MAT.wood, { tint: [0.8, 0.8, 0.8], aoBottom: 0.6 });
  }
  xf.collider([-0.17, 0, -0.17], [0.17, 0.46, 0.17]);
}

/**
 * Гермодверь в проёме: стальная рама вокруг проёма 1,1 × 2,05 м и створка, распахнутая на 90°.
 * Начало — середина проёма у пола; стена идёт вдоль x, створка открыта в сторону +z.
 */
export function hermoDoor(xf: Xf): void {
  const hw = 0.55;
  const t = 0.19; // рама чуть шире стены
  const steel: Vec3 = [0.62, 0.66, 0.62];
  xf.box([-hw - 0.09, 0, -t], [-hw, 2.05, t], MAT.metalGreen, { bevel: 0.015, tint: steel, aoBottom: 0.6 });
  xf.box([hw, 0, -t], [hw + 0.09, 2.05, t], MAT.metalGreen, { bevel: 0.015, tint: steel, aoBottom: 0.6 });
  xf.box([-hw - 0.09, 2.05, -t], [hw + 0.09, 2.15, t], MAT.metalGreen, { bevel: 0.015, tint: steel });
  // Порог — перешагивается (ниже шага контроллера).
  xf.solid([-hw, 0, -t], [hw, 0.1, t], MAT.steel, { bevel: 0.012, tint: [0.5, 0.5, 0.5] });
  // Створка: толстая плита на петлях у левого косяка, открыта вдоль +z.
  const dx0 = -hw - 0.1;
  const dx1 = -hw - 0.02;
  xf.solid([dx0, 0.1, t], [dx1, 2.02, t + 1.08], MAT.metalGreen, { bevel: 0.02, tint: steel, aoBottom: 0.7 });
  for (const y of [0.55, 1.05, 1.55]) {
    xf.box([dx1, y - 0.03, t + 0.06], [dx1 + 0.03, y + 0.03, t + 1.02], MAT.metalGreen, { tint: [steel[0] * 0.85, steel[1] * 0.85, steel[2] * 0.85] });
  }
  // Штурвал задрайки и петли.
  xf.cyl([dx1 + 0.03, 1.1, t + 0.56], 'x', 0.07, 0.02, MAT.steel);
  xf.cyl([dx1 + 0.1, 1.1, t + 0.56], 'x', 0.025, 0.17, MAT.steel, { segments: 14, tint: [0.75, 0.75, 0.75] });
  for (const y of [0.4, 1.7]) xf.cyl([dx0 + 0.04, y - 0.08, t + 0.03], 'y', 0.16, 0.035, MAT.steel);
  // Трафареты на створке (она распахнута, смотрит вдоль стены) и красный сектор распаха на полу.
  const leaf = xf.child(dx1, 0, t + 0.54, 1);
  const red: Vec3 = [0.62, 0.11, 0.08];
  leaf.sign('germo', 0, 1.68, 0.62, red, 0.004);
  leaf.sign('dzg', 0, 1.24, 0.34, red, 0.004);
  xf.floorSign('arc', -hw, t, 1.08, red);
}

/** Вентиляционная решётка на стене z = 0, лицом к +z. Начало — центр решётки. */
export function ventGrille(xf: Xf, w = 0.5, h = 0.35): void {
  xf.box([-w / 2, -h / 2, 0], [w / 2, h / 2, 0.012], MAT.rubber, { tint: [0.15, 0.15, 0.15] });
  xf.box([-w / 2 - 0.03, -h / 2 - 0.03, 0], [w / 2 + 0.03, -h / 2, 0.03], MAT.steel, { tint: [0.6, 0.6, 0.6] });
  xf.box([-w / 2 - 0.03, h / 2, 0], [w / 2 + 0.03, h / 2 + 0.03, 0.03], MAT.steel, { tint: [0.6, 0.6, 0.6] });
  xf.box([-w / 2 - 0.03, -h / 2, 0], [-w / 2, h / 2, 0.03], MAT.steel, { tint: [0.6, 0.6, 0.6] });
  xf.box([w / 2, -h / 2, 0], [w / 2 + 0.03, h / 2, 0.03], MAT.steel, { tint: [0.6, 0.6, 0.6] });
  for (let y = -h / 2 + 0.04; y < h / 2 - 0.02; y += 0.05) {
    xf.box([-w / 2, y, 0.012], [w / 2, y + 0.022, 0.028], MAT.steel, { tint: [0.55, 0.55, 0.55] });
  }
}

/** Табличка на стене z = 0 (лицом к +z): фосфорная краска слабо светится в темноте. Начало — центр. */
export function signPlate(xf: Xf, w = 0.5, h = 0.16): void {
  xf.box([-w / 2 - 0.012, -h / 2 - 0.012, 0], [w / 2 + 0.012, h / 2 + 0.012, 0.008], MAT.rubber, { tint: [0.3, 0.3, 0.3] });
  xf.box([-w / 2, -h / 2, 0.008], [w / 2, h / 2, 0.012], MAT.glow);
}

/** Пучок кабелей вдоль локальной оси x под потолком у стены z = 0. Начало — левый конец. */
export function cables(xf: Xf, length: number): void {
  for (let i = 0; i < 3; i++) {
    xf.cyl([0, -0.03 * i, 0.03 + 0.012 * i], 'x', length, 0.012, MAT.rubber, { segments: 5, caps: false, tint: [0.5 + i * 0.2, 0.5 + i * 0.2, 0.5 + i * 0.2] });
  }
  for (let x = 0.5; x < length; x += 1.2) {
    xf.box([x - 0.015, -0.085, 0], [x + 0.015, 0.02, 0.07], MAT.steel, { tint: [0.5, 0.5, 0.5] });
  }
}

/** Лестничный марш: n ступеней вниз вдоль −x от точки начала (верхняя кромка). Ширина по z — от z0 до z1. */
export function stairsDown(xf: Xf, steps: number, rise: number, run: number, z0: number, z1: number): void {
  const grey: Vec3 = [0.72, 0.72, 0.72];
  for (let i = 0; i < steps; i++) {
    const top = -rise * (i + 1);
    const xa = -run * i; // дальний от спуска край проступи — под подступёнком верхней ступени
    const xb = -run * (i + 1); // кромка
    xf.collider([xb, top - 1.2, z0], [xa, top, z1]);
    // Проступь темнеет к подступёнку: ступени читаются и сверху, где видны одни проступи.
    xf.mb.quadFacing(xf.pt(xb, top, z0), xf.pt(xa, top, z0), xf.pt(xa, top, z1), xf.pt(xb, top, z1), [0, 1, 0], MAT.concrete, grey, [1, 0.45, 0.45, 1]);
    // Подступёнок под кромкой, лицом к спускающемуся снизу.
    const out = xf.pt(xb - 1, top, 0);
    const o = xf.pt(xb, top, 0);
    xf.mb.quadFacing(xf.pt(xb, top - rise, z0), xf.pt(xb, top - rise, z1), xf.pt(xb, top, z1), xf.pt(xb, top, z0), [out[0] - o[0], 0, out[2] - o[2]], MAT.concrete, grey, [0.5, 0.5, 0.85, 0.85]);
    // Стёртый стальной уголок на кромке.
    xf.box([xb, top - 0.035, z0], [xb + 0.05, top + 0.006, z1], MAT.steel, { tint: [0.85, 0.85, 0.85] });
  }
}

/** Кучка битого бетона на полу. Начало — центр. */
export function rubble(xf: Xf, seed: number): void {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 7; i++) {
    const w = 0.08 + rnd() * 0.2;
    const h = 0.04 + rnd() * 0.12;
    const d = 0.08 + rnd() * 0.18;
    const x = (rnd() - 0.5) * 0.9;
    const z = (rnd() - 0.5) * 0.7;
    const g = 0.6 + rnd() * 0.3;
    xf.box([x - w / 2, 0, z - d / 2], [x + w / 2, h, z + d / 2], MAT.concrete, { bevel: 0.015, tint: [g, g, g], aoBottom: 0.5 });
  }
}
