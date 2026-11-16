/**
 * Зёрна вещи: точки, посеянные по её поверхности. В них тронутая вещь растворяется — точки гаснут в
 * воздухе, на пол ничего не оседает — и из них же собирается, когда возвращается («память — пыль»;
 * шейдер — GRAIN_VERT).
 *
 * Чистый TS: посев идёт по сетке предмета, рендер получает готовые массивы. Случайности нет — один
 * сид даёт одни и те же точки, поэтому посев проверяется тестами.
 */
import type { MeshData } from '../world/kit';
import { hexToLinear, MAT, MAT_DEFS } from '../world/materials';

export interface Grains {
  count: number;
  /** Место точки на поверхности, в координатах сетки. */
  position: Float32Array;
  normal: Float32Array;
  /** Цвет места без света: собственный цвет материала × оттенок вершин. */
  color: Float32Array;
  /** x — срок точки (0 — сходит первой), yzw — случайные числа. */
  rnd: Float32Array;
  /** Площадь поверхности, по которой сеяли, м². */
  area: number;
  minY: number;
  maxY: number;
}

/** Точек на квадратный метр поверхности в полную плотность. */
export const GRAIN_DENSITY = 650;
export const GRAIN_MIN = 90;
export const GRAIN_MAX = 3600;

/** Треугольники каждого объекта сетки: номер объекта → номера треугольников. Вершины без номера (стены, пол) пропущены. */
export function objectTriangles(data: MeshData): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const obj = data.obj;
  if (!obj) return out;
  for (let t = 0; t < data.index.length; t += 3) {
    const id = obj[data.index[t]!]!;
    if (id === 0) continue;
    let list = out.get(id);
    if (!list) out.set(id, (list = []));
    list.push(t / 3);
  }
  return out;
}

function lcg(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ALBEDO = new Map<number, readonly [number, number, number]>();
function albedo(mat: number): readonly [number, number, number] {
  let c = ALBEDO.get(mat);
  if (!c) {
    c = hexToLinear(MAT_DEFS[mat]?.color ?? '#808080');
    ALBEDO.set(mat, c);
  }
  return c;
}

/**
 * Посеять точки по треугольникам tris (null — по всей сетке). Число точек — по площади; density — доля
 * от полной плотности (слабое устройство сеет реже; при мелком зерне — больше единицы). Точки ложатся ровно: площадь режется на равные
 * доли, в каждой — одна точка.
 */
export function sowGrains(data: MeshData, tris: readonly number[] | null, seed: number, density = 1): Grains {
  const P = data.position;
  const I = data.index;
  const n = tris ? tris.length : I.length / 3;
  const cum = new Float64Array(n);
  let area = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const t = (tris ? tris[k]! : k) * 3;
    const a = I[t]! * 3;
    const b = I[t + 1]! * 3;
    const c = I[t + 2]! * 3;
    const ux = P[b]! - P[a]!;
    const uy = P[b + 1]! - P[a + 1]!;
    const uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!;
    const vy = P[c + 1]! - P[a + 1]!;
    const vz = P[c + 2]! - P[a + 2]!;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    cum[k] = area;
    minY = Math.min(minY, P[a + 1]!, P[b + 1]!, P[c + 1]!);
    maxY = Math.max(maxY, P[a + 1]!, P[b + 1]!, P[c + 1]!);
  }
  if (!(area > 1e-6)) return { count: 0, position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0), rnd: new Float32Array(0), area: 0, minY: 0, maxY: 0 };
  // Плотность больше единицы — мелкое зерно (сильный компьютер): предел растёт вместе с ней, иначе у
  // большой вещи точки стали бы мельче, а их число — нет, и её пыль поредела бы.
  const count = Math.max(GRAIN_MIN, Math.min(GRAIN_MAX * Math.max(1, density), Math.round(area * GRAIN_DENSITY * density)));
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  const rand = lcg(seed);
  const span = Math.max(1e-3, maxY - minY);
  let k = 0;
  for (let i = 0; i < count; i++) {
    const at = ((i + rand()) / count) * area;
    while (k < n - 1 && cum[k]! < at) k += 1;
    const t = (tris ? tris[k]! : k) * 3;
    const ia = I[t]!;
    const ib = I[t + 1]!;
    const ic = I[t + 2]!;
    let u = rand();
    let v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    for (let d = 0; d < 3; d++) {
      position[i * 3 + d] = P[ia * 3 + d]! * w + P[ib * 3 + d]! * u + P[ic * 3 + d]! * v;
      normal[i * 3 + d] = data.normal[ia * 3 + d]! * w + data.normal[ib * 3 + d]! * u + data.normal[ic * 3 + d]! * v;
    }
    const m = Math.round(data.mat[ia]!);
    const tint = [data.color[ia * 4]!, data.color[ia * 4 + 1]!, data.color[ia * 4 + 2]!];
    if (m === MAT.glow || m === MAT.lamp) {
      // Светящееся осыпается светлой пылью своего оттенка.
      const top = Math.max(1, tint[0]!, tint[1]!, tint[2]!);
      for (let d = 0; d < 3; d++) color[i * 3 + d] = tint[d]! / top;
    } else {
      const base = albedo(m);
      for (let d = 0; d < 3; d++) color[i * 3 + d] = Math.min(1.6, base[d]! * tint[d]!);
    }
    // Срок: в основном случайный, но верх вещи сходит чуть раньше низа — она оседает сверху.
    const high = (position[i * 3 + 1]! - minY) / span;
    rnd[i * 4] = Math.min(1, Math.max(0, 0.72 * rand() + 0.28 * (1 - high)));
    rnd[i * 4 + 1] = rand();
    rnd[i * 4 + 2] = rand();
    rnd[i * 4 + 3] = rand();
  }
  return { count, position, normal, color, rnd, area, minY, maxY };
}

/**
 * Жизнь облака. go — насколько вещь растворена (0..1), приходит от игры; здесь решается, докуда дошло
 * растворение (flow), насколько видно облако (fade) и когда его можно убрать.
 *
 * Уходит вещь — каждая точка в свой срок отделяется, отходит от поверхности и гаснет в воздухе. Россыпи
 * нет: растворилась последняя точка — облако не нужно (слова партнёра: «Вещь когда исчезает не должно
 * быть точек в пространстве, они не оседают, а полностью растворяются»). Возвращается — облако
 * проступает, точки из ничего встают на места.
 */
export interface GrainLife {
  go: number;
  /**
   * Докуда дошло растворение. Поверхность тает быстро (за время распада вещи), а точка гаснет дольше:
   * flow идёт за go с ограниченной скоростью и чуть дальше единицы, чтобы погасли последние точки.
   * При сборке отставания нет: точка должна встать на место к тому мигу, когда там нарастёт зерно.
   */
  flow: number;
  fade: number;
  /** Вещь возвращается (go убывает). */
  coming: boolean;
  /** Облако больше не нужно. */
  done: boolean;
}

/** За сколько секунд облако проступает, когда вещь начинает собираться. */
export const RISE = 0.3;
/** За сколько секунд растворение проходит весь путь и докуда (последняя точка: срок 0,6 + путь 0,5). */
export const FLOW_TIME = 1.7;
export const FLOW_END = 1.1;

export function newGrainLife(go: number, coming: boolean): GrainLife {
  return { go, flow: coming ? go : 0, fade: coming ? 0 : 1, coming, done: false };
}

/** Игра сообщила новое значение распада. */
export function steerGrains(g: GrainLife, go: number): void {
  if (go < g.go - 1e-4) g.coming = true;
  else if (go > g.go + 1e-4) g.coming = false;
  g.go = go;
}

/** Шаг времени. */
export function stepGrains(g: GrainLife, dt: number): void {
  g.fade = Math.min(1, g.fade + dt / RISE);
  if (g.coming) {
    g.flow = g.go;
    // Вещь собралась: все точки на местах, облако не нужно.
    if (g.go <= 0) g.done = true;
    return;
  }
  g.flow = Math.min(g.go * FLOW_END, g.flow + (dt * FLOW_END) / FLOW_TIME);
  // Растворилась последняя точка: от вещи ничего не осталось.
  if (g.go >= 1 && g.flow >= FLOW_END - 1e-9) g.done = true;
}
