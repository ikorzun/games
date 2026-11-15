/**
 * Плоские вещи. Некоторые вещи память хранит не как вещи, а как снимки: вместо шкафа — его
 * фотография. С того места, откуда «снимали», такая вещь выглядит объёмной; стоит отойти в сторону —
 * и видно, что это лист. Обман ожиданий — одна из опор замысла (docs/vylazka/untitled_session.md).
 *
 * Как это сделано. Предмет собирается как обычно, а потом сплющивается на плоскость центральной
 * проекцией из точки eye: каждая вершина едет по своему лучу из eye. Картинка из eye от этого не
 * меняется вовсе — меняется только то, что видно сбоку. Чтобы ближнее по-прежнему заслоняло дальнее,
 * от глубины оставлена малая доля (ratio). Такое преобразование — гомология с центром eye и осью,
 * лежащей в плоскости: прямые остаются прямыми, плоские грани — плоскими, порядок вдоль луча не меняется.
 *
 * Плоских вещей три рода:
 *  - «картонка» (standee) — из вещества. Видна под фонарём, как всё остальное, но пройти сквозь неё
 *    можно, тени у неё нет, а с изнанки её нет вовсе;
 *  - «проекция» (veil) — из света: комната, которой нет, поперёк коридора. Светится сама, а свет её
 *    смывает: луч фонаря прожигает в ней дыру, и сквозь неё можно пройти;
 *  - «экран» (screen) — настоящая панель, которая светится картинкой (world/props_screens.ts):
 *    лес, корни, студия телеигры — вместо того чтобы это было здесь на самом деле.
 */
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { hexToLinear, MAT, MAT_DEFS } from './materials';
import { Xf } from './props';
import type { PropSpec } from './props_more';

/** Высота, с которой «снимали»: нагрудная камера игрока, м. */
export const FLAT_EYE = 1.42;
/** С какого расстояния до плоскости «снимали» картонку и проекцию, м. */
export const STANDEE_DIST = 3.2;
export const VEIL_DIST = 4.4;
/** Какая доля глубины остаётся у плоскости: шкаф глубиной 0,6 м становится рельефом около 2 см. */
export const FLAT_RATIO = 0.03;

export type FlatKind = 'standee' | 'veil' | 'screen';

/** Где в уровне стоит плоская вещь: по этому списку её находят проверки и отладка. */
export interface FlatMark {
  kind: FlatKind;
  /** Что изображено: имя предмета или сцены. */
  what: string;
  /** Середина картинки в мире (на высоте глаз) и куда она смотрит. */
  at: Vec3;
  n: Vec3;
  /** Ширина и высота картинки, м. */
  w: number;
  h: number;
  /** Высота пола под ней, м. */
  floor: number;
  room: number;
  tier: number;
}

export interface FlatFrame {
  /** Точка, из которой «снимали», в координатах сетки. */
  eye: Vec3;
  /** Плоскость z = plane, на которую всё сплющено (перед ней, со стороны eye, ничего быть не должно). */
  plane: number;
  /** Доля глубины, которая остаётся у самой плоскости. */
  ratio: number;
}

/** Собрать предмет в его собственных координатах, без преград. */
export function shapeOf(spec: PropSpec, seed: number): MeshData {
  const mb = new MeshBuilder();
  spec.build(new Xf(mb, null, 0, 0, 0, 0), seed);
  return mb.build();
}

/** Куда попадёт точка после сплющивания. */
export function flattenPoint(p: Vec3, f: FlatFrame): Vec3 {
  const D = f.eye[2] - f.plane;
  // Точка у самого «объектива» улетела бы в бесконечность: ближе девяти десятых пути не подпускаем.
  const t = Math.min(p[2] - f.plane, D * 0.9);
  const t2 = (f.ratio * D * t) / ((f.ratio - 1) * t + D);
  const s = (D - t2) / (D - t);
  return [f.eye[0] + (p[0] - f.eye[0]) * s, f.eye[1] + (p[1] - f.eye[1]) * s, f.eye[2] + (p[2] - f.eye[2]) * s];
}

/**
 * Сплющить сетку. Возвращает новые позиции и номера треугольников, которые видны из eye лицом:
 * у снимка нет оборотной стороны, и то, что было повёрнуто от «объектива», в него не попало.
 */
export function flatten(src: MeshData, f: FlatFrame): { position: Float32Array; tris: number[] } {
  const n = src.position.length / 3;
  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const q = flattenPoint([src.position[i * 3]!, src.position[i * 3 + 1]!, src.position[i * 3 + 2]!], f);
    position[i * 3] = q[0];
    position[i * 3 + 1] = q[1];
    position[i * 3 + 2] = q[2];
  }
  const tris: number[] = [];
  const P = src.position;
  for (let t = 0; t < src.index.length; t += 3) {
    const a = src.index[t]! * 3;
    const b = src.index[t + 1]! * 3;
    const c = src.index[t + 2]! * 3;
    const ux = P[b]! - P[a]!;
    const uy = P[b + 1]! - P[a + 1]!;
    const uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!;
    const vy = P[c + 1]! - P[a + 1]!;
    const vz = P[c + 2]! - P[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const facing = nx * (f.eye[0] - P[a]!) + ny * (f.eye[1] - P[a + 1]!) + nz * (f.eye[2] - P[a + 2]!);
    // Грань, на которую «объектив» смотрит вскользь, после сплющивания — нить нулевой площади.
    if (facing > 1e-7) tris.push(t / 3);
  }
  return { position, tris };
}

/** Передняя плоскость предмета: наибольший z его вершин. */
export function frontOf(src: MeshData): number {
  let z = -Infinity;
  for (let i = 2; i < src.position.length; i += 3) z = Math.max(z, src.position[i]!);
  return z;
}

/**
 * Картонка: предмет, сплющенный на плоскость своей передней стороны. Стоит там же, где стоял бы
 * настоящий (xf — его место: спина у стены), но это лист. Сделана из вещества: материалы, оттенки и
 * нормали прежние, поэтому под фонарём она отсвечивает как объёмная. Преграды нет.
 * eyeY — высота «объектива» над началом координат предмета.
 */
export function standee(xf: Xf, spec: PropSpec, seed: number, eyeY = FLAT_EYE): { w: number; h: number; plane: number } {
  const src = shapeOf(spec, seed);
  const plane = frontOf(src);
  const { position, tris } = flatten(src, { eye: [0, eyeY, plane + STANDEE_DIST], plane, ratio: FLAT_RATIO });
  const mb = xf.mb;
  const remap = new Map<number, number>();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const vert = (i: number): number => {
    let j = remap.get(i);
    if (j === undefined) {
      const x = position[i * 3]!;
      const y = position[i * 3 + 1]!;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      const tint: Vec3 = [src.color[i * 4]!, src.color[i * 4 + 1]!, src.color[i * 4 + 2]!];
      // uv — те же, что у настоящего предмета: фактура и надписи ложатся как на объёмном.
      j = mb.vertexUv(xf.pt(x, y, position[i * 3 + 2]!), xf.dir(src.normal[i * 3]!, src.normal[i * 3 + 1]!, src.normal[i * 3 + 2]!), src.mat[i]!, tint, src.color[i * 4 + 3]!, [src.uv[i * 2]!, src.uv[i * 2 + 1]!]);
      remap.set(i, j);
    }
    return j;
  };
  for (const t of tris) mb.tri(vert(src.index[t * 3]!), vert(src.index[t * 3 + 1]!), vert(src.index[t * 3 + 2]!));
  return { w: x1 - x0, h: y1, plane };
}

/** Сцена проекции: что стоит у дальней стены комнаты, которой нет. [предмет, сдвиг вдоль стены, высота низа]. */
export interface VeilScene {
  id: string;
  /** Оттенки полос обоев (материал «обои»). */
  paper: readonly [Vec3, Vec3];
  items: readonly (readonly [string, number, number?])[];
}

/** Свет в комнате, которой нет: лампа под потолком спереди слева. Нужен только затем, чтобы у вещей на снимке был объём. */
const KEY: Vec3 = [-0.33, 0.6, 0.73];
const AMB = 0.4;
const KEY_K = 0.72;

/** Цвет вершины на снимке: собственный цвет материала × оттенок × свет «лампы» × затенённость. */
export function bake(mat: number, tint: Vec3, n: Vec3, ao: number): Vec3 {
  const m = Math.round(mat);
  if (m === MAT.glow || m === MAT.lamp) {
    // Светящееся на снимке — просто самое яркое: экран, окно, огонёк.
    const k = 1.25 / Math.max(1, tint[0], tint[1], tint[2]);
    return [tint[0] * k, tint[1] * k, tint[2] * k];
  }
  const base = hexToLinear(MAT_DEFS[m]?.color ?? '#808080');
  const light = (AMB + KEY_K * Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2])) * (0.5 + 0.5 * ao);
  return [base[0] * tint[0] * light, base[1] * tint[1] * light, base[2] * tint[2] * light];
}

/**
 * Проекция: комната, которой нет. xf — середина сечения коридора на полу, +z смотрит на зрителя;
 * w × h — сечение. Внутри «снята» неглубокая комната: пол, потолок, боковые стены, дальняя стена
 * в обоях и мебель у неё. Всё это сплющено на плоскость z = 0 и уходит в сетку проекций (xf.sl)
 * светом: цвет вершины — уже готовая картинка. Преград нет. Возвращает ширину и высоту картинки.
 */
export function veil(xf: Xf, scene: VeilScene, props: Readonly<Record<string, PropSpec>>, seed: number, w: number, h: number): { w: number; h: number } | null {
  const out = xf.sl;
  if (!out) return null;
  const mb = new MeshBuilder();
  const room = new Xf(mb, null, 0, 0, 0, 0);
  // Мебель — спиной к дальней стене (она в плоскости z = 0).
  let k = 0;
  for (const [name, dx, y] of scene.items) {
    const p = props[name];
    if (!p) continue;
    p.build(room.child(dx, p.mount === 'wall' ? (y ?? p.y ?? 1.2) : 0, 0), seed + 131 * k++);
  }
  if (mb.triangleCount === 0) return null;
  const depth = Math.min(1.25, frontOf(mb.build()) + 0.04);
  const hw = w / 2;
  // Дальняя стена: обои в полоску (полосы — отдельные листы: у вершины один цвет).
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    const a = -hw + (w * i) / stripes;
    const b = -hw + (w * (i + 1)) / stripes;
    mb.quad([a, 0, 0], [b, 0, 0], [b, h, 0], [a, h, 0], MAT.wallpaper, scene.paper[i % 2]!, [0.75, 0.75, 1, 1]);
  }
  mb.box([-hw, 0, 0], [hw, 0.09, 0.02], MAT.wood, { tint: [0.7, 0.6, 0.5], skip: ['nz', 'ny', 'px', 'nx'] });
  // Пол досками, потолок, боковые стены.
  const planks = 6;
  for (let i = 0; i < planks; i++) {
    const a = (depth * i) / planks;
    const b = (depth * (i + 1)) / planks;
    mb.quad([-hw, 0, b], [hw, 0, b], [hw, 0, a], [-hw, 0, a], MAT.parquet, i % 2 ? [1, 0.96, 0.9] : [0.9, 0.86, 0.8]);
  }
  mb.quad([-hw, h, 0], [hw, h, 0], [hw, h, depth], [-hw, h, depth], MAT.plaster, [1, 1, 1]);
  mb.quad([-hw, 0, depth], [-hw, 0, 0], [-hw, h, 0], [-hw, h, depth], MAT.wallpaper, scene.paper[0]);
  mb.quad([hw, 0, 0], [hw, 0, depth], [hw, h, depth], [hw, h, 0], MAT.wallpaper, scene.paper[0]);

  const src = mb.build();
  const f: FlatFrame = { eye: [0, FLAT_EYE, depth + VEIL_DIST], plane: depth, ratio: FLAT_RATIO };
  const { position, tris } = flatten(src, f);
  const nrm = xf.dir(0, 0, 1);
  const remap = new Map<number, number>();
  const vert = (i: number): number => {
    let j = remap.get(i);
    if (j === undefined) {
      const x = position[i * 3]!;
      const y = position[i * 3 + 1]!;
      const col = bake(src.mat[i]!, [src.color[i * 4]!, src.color[i * 4 + 1]!, src.color[i * 4 + 2]!], [src.normal[i * 3]!, src.normal[i * 3 + 1]!, src.normal[i * 3 + 2]!], src.color[i * 4 + 3]!);
      // Плоскость проекции — z = 0 у xf: сцена сдвинута назад на свою глубину. uv — место в картинке, 0..1.
      j = out.vertexUv(xf.pt(x, y, position[i * 3 + 2]! - depth), nrm, MAT.glow, col, 1, [x / w + 0.5, y / h]);
      remap.set(i, j);
    }
    return j;
  };
  for (const t of tris) out.tri(vert(src.index[t * 3]!), vert(src.index[t * 3 + 1]!), vert(src.index[t * 3 + 2]!));
  return { w, h };
}

/** Комнаты, которых нет: что «снято» на проекциях. Первая — стенка с телевизором, как на снимке-образце. */
export const VEIL_SCENES: readonly VeilScene[] = [
  { id: 'wall_unit', paper: [[1.05, 1.0, 0.92], [0.95, 0.93, 0.9]], items: [['wall_unit', 0]] },
  { id: 'sofa', paper: [[1.0, 0.92, 0.78], [0.9, 0.84, 0.74]], items: [['sofa', -0.25], ['wall_carpet', -0.25], ['floor_lamp', 1.02]] },
  { id: 'bed', paper: [[0.86, 0.95, 1.0], [0.8, 0.88, 0.95]], items: [['bed_home', -0.3], ['wall_carpet', -0.3], ['floor_lamp', 1.05]] },
  { id: 'kitchen', paper: [[1.0, 1.0, 0.86], [0.92, 0.95, 0.84]], items: [['kitchen_table', -0.55], ['window_fake', -0.55], ['fridge', 0.92]] },
  { id: 'tv', paper: [[0.95, 0.9, 0.84], [0.88, 0.82, 0.78]], items: [['tv_stand', -0.6], ['armchair', 0.72], ['mirror', 0.72, 1.05]] },
  { id: 'nursery', paper: [[1.0, 0.9, 0.92], [0.94, 0.86, 0.9]], items: [['crib', -0.6], ['toy_heap', 0.65], ['window_fake', 0.65]] },
];
