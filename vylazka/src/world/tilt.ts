/**
 * Вещь партнёра, повёрнутая по всем осям (партнёр 18.11, 16:19: «разрешить крутить объекты по всем осям»).
 *
 * Запись (placed.ts, PlacedSpec.tilt) хранит доворот вещи в её собственных осях, градусы, порядок XYZ — как Euler в three.js:
 * x — кивок вперёд-назад, y — поворот вокруг вертикали (любой, не четвертями), z — завал на бок. Четверть оборота правила
 * («лицом куда» и turn) остаётся: доворот — поверх неё.
 *
 * Вещь вращается вокруг середины того, что собрано, и ложится на свою опору: стоящая на полу (и посреди пола) — нижней точкой
 * на прежнюю высоту, висящая на стене — спиной к стене, подвешенная — верхом к потолку. Стул, положенный на бок, лежит на
 * полу, а не висит над ним и не уходит в него.
 *
 * Так её показывает конструктор (tools/constructor) и так её строит игра: сборка уровня собирает вещь как обычно, а потом
 * поворачивает собранное — вершины, нормали, листы-картинки и преграды (world/level_build.ts, props_all.ts). Преграда
 * повёрнутой коробки — её габарит в мире: пройти сквозь вещь нельзя, хоть иногда она держит чуть шире себя.
 *
 * Чистый TS: проверяется тестами (tests/tilt.test.ts).
 */
import type { Vec3 } from '../core/types';
import type { Aabb, ColliderSet } from './colliders';
import type { MeshBuilder } from './kit';
import type { ObjectLog } from './objects';

/** Доворот в градусах вокруг осей вещи: x, y, z (порядок XYZ). */
export type Tilt = readonly [number, number, number];

/** Как вещь держится: от этого — на что она ложится после поворота. */
export type TiltMount = 'floor' | 'free' | 'wall' | 'ceiling';

/** 3×3 по строкам. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** Наибольший доворот по каждой оси, градусы (больше — то же самое, только другой записью). */
export const TILT_MAX = 180;

/** Есть ли доворот вообще: нули и отсутствие — одно и то же. */
export const isTilted = (t: Tilt | undefined): t is Tilt => !!t && (Math.abs(t[0]) > 1e-6 || Math.abs(t[1]) > 1e-6 || Math.abs(t[2]) > 1e-6);

/** Что не так с доворотом записи (пусто — годится). */
export function tiltProblems(t: unknown): string[] {
  if (t === undefined) return [];
  if (!Array.isArray(t) || t.length !== 3) return ['доворот — три числа: x, y, z'];
  if (!t.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= TILT_MAX)) return [`доворот — числа от −${TILT_MAX} до ${TILT_MAX} градусов`];
  return [];
}

/** Поворот доворота: как Matrix4.makeRotationFromEuler(new Euler(x, y, z, 'XYZ')) в three.js (Rx·Ry·Rz). */
export function tiltMat(t: Tilt): Mat3 {
  const r = Math.PI / 180;
  const a = Math.cos(t[0] * r);
  const b = Math.sin(t[0] * r);
  const c = Math.cos(t[1] * r);
  const d = Math.sin(t[1] * r);
  const e = Math.cos(t[2] * r);
  const f = Math.sin(t[2] * r);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}

/** Четверть оборота вещи (Xf.pt): поворот вокруг вертикали на rot·90°. */
export function turnMat(rot: 0 | 1 | 2 | 3): Mat3 {
  if (rot === 1) return [0, 0, 1, 0, 1, 0, -1, 0, 0];
  if (rot === 2) return [-1, 0, 0, 0, 1, 0, 0, 0, -1];
  if (rot === 3) return [0, 0, -1, 0, 1, 0, 1, 0, 0];
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export const mul = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Обратный поворот: у поворота это транспонированная матрица. */
const mulT = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** Как повернуть вещь в её осях: p' = c + r·(p − c) + d. */
export interface TiltPose {
  r: Mat3;
  /** Середина собранного (точка вращения), в осях вещи. */
  c: Vec3;
  /** Сдвиг, чтобы вещь легла на опору, в осях вещи. */
  d: Vec3;
}

/**
 * Поза повёрнутой вещи по её точкам в её осях (начало — точка вещи, без четверти оборота): середина габарита — точка вращения,
 * сдвиг — чтобы опора осталась на месте (TiltMount). pts — тройки x, y, z.
 */
export function tiltPose(pts: ArrayLike<number>, t: Tilt, mount: TiltMount): TiltPose {
  const n = Math.floor(pts.length / 3);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = pts[i * 3 + k]!;
      if (v < lo[k]!) lo[k] = v;
      if (v > hi[k]!) hi[k] = v;
    }
  }
  const r = tiltMat(t);
  if (n === 0) return { r, c: [0, 0, 0], d: [0, 0, 0] };
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  // Габарит после поворота (без сдвига): по нему решаем, насколько подвинуть.
  const lo2: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi2: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const q = mul(r, [pts[i * 3]! - c[0], pts[i * 3 + 1]! - c[1], pts[i * 3 + 2]! - c[2]]);
    for (let k = 0; k < 3; k++) {
      const v = q[k]! + c[k]!;
      if (v < lo2[k]!) lo2[k] = v;
      if (v > hi2[k]!) hi2[k] = v;
    }
  }
  const d: [number, number, number] = [0, 0, 0];
  if (mount === 'wall') d[2] = lo[2] - lo2[2];
  else if (mount === 'ceiling') d[1] = hi[1] - hi2[1];
  else d[1] = lo[1] - lo2[1];
  return { r, c, d };
}

/** Точка вещи после поворота, в её осях. */
export const tiltPoint = (pose: TiltPose, p: Vec3): Vec3 => {
  const q = mul(pose.r, [p[0] - pose.c[0], p[1] - pose.c[1], p[2] - pose.c[2]]);
  return [q[0] + pose.c[0] + pose.d[0], q[1] + pose.c[1] + pose.d[1], q[2] + pose.c[2] + pose.d[2]];
};

/** Габарит коробки после поворота (коробка — в осях вещи). */
export function tiltBox(pose: TiltPose, min: Vec3, max: Vec3): [Vec3, Vec3] {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const p = tiltPoint(pose, [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);
    for (let j = 0; j < 3; j++) {
      if (p[j]! < lo[j]!) lo[j] = p[j]!;
      if (p[j]! > hi[j]!) hi[j] = p[j]!;
    }
  }
  return [lo, hi];
}

/** Где собирается вещь: точка, четверть оборота и куда сложено собранное. */
export interface TiltTarget {
  mb: MeshBuilder;
  sl: MeshBuilder | null;
  col: ColliderSet | null;
  ox: number;
  oy: number;
  oz: number;
  rot: 0 | 1 | 2 | 3;
}

/** Откуда начинается то, что собрано для вещи: вершины сетки и проекций, листы и преграды, объекты журнала. */
export interface TiltMark {
  v: number;
  s: number;
  sheets: number;
  slSheets: number;
  c: number;
  o: number;
}

/** Отметка перед сборкой вещи — потом по ней повернуть собранное (applyTilt). */
export function tiltMark(x: Pick<TiltTarget, 'mb' | 'sl' | 'col'>): TiltMark {
  return { v: x.mb.vertexCount, s: x.sl ? x.sl.vertexCount : 0, sheets: x.mb.sheets.length, slSheets: x.sl ? x.sl.sheets.length : 0, c: x.col ? x.col.boxes.length : 0, o: x.mb.log ? x.mb.log.list.length : 0 };
}

/**
 * Повернуть то, что собрано после отметки m, на доворот t вокруг середины собранного, и положить на опору (tiltPose). Вершины и
 * нормали обеих сеток, листы-картинки, преграды (габарит повёрнутой коробки) и границы объектов журнала — всё в мире.
 */
export function applyTilt(x: TiltTarget, m: TiltMark, t: Tilt, mount: TiltMount): void {
  if (!isTilted(t)) return;
  const turn = turnMat(x.rot);
  const o: Vec3 = [x.ox, x.oy, x.oz];
  const toLocal = (p: Vec3): Vec3 => mulT(turn, [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
  const toWorld = (p: Vec3): Vec3 => {
    const q = mul(turn, p);
    return [q[0] + o[0], q[1] + o[1], q[2] + o[2]];
  };
  // Точка вращения и опора — по вершинам сетки (у проекций — свои, но вещь одна: берём всё вместе).
  const local: number[] = [];
  for (const [mb, v0] of [[x.mb, m.v], [x.sl, m.s]] as const) {
    if (!mb) continue;
    mb.eachPosition(v0, (p) => local.push(...toLocal(p)));
  }
  if (local.length === 0) return;
  const pose = tiltPose(local, t, mount);
  // Нормали: только поворот (в мире — turn·r·turnᵀ).
  const nrm = (n: Vec3): Vec3 => mul(turn, mul(pose.r, mulT(turn, n)));
  const pos = (p: Vec3): Vec3 => toWorld(tiltPoint(pose, toLocal(p)));
  x.mb.transformFrom(m.v, m.sheets, pos, nrm);
  if (x.sl) x.sl.transformFrom(m.s, m.slSheets, pos, nrm);
  // Преграды: каждую коробку — в габарит её повёрнутых углов. Сетка поиска помнит старые клетки — снять и поставить заново.
  const col = x.col;
  if (col && col.boxes.length > m.c) {
    const boxes: Aabb[] = col.boxes.slice(m.c).map((b) => ({ ...b }));
    col.rewind(m.c);
    for (const b of boxes) {
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 8; k++) {
        const p = pos([k & 1 ? b.maxX : b.minX, k & 2 ? b.maxY : b.minY, k & 4 ? b.maxZ : b.minZ]);
        for (let j = 0; j < 3; j++) {
          if (p[j]! < lo[j]!) lo[j] = p[j]!;
          if (p[j]! > hi[j]!) hi[j] = p[j]!;
        }
      }
      // Хозяин и метки — те же; owner уже стоит на коробке, add его не перепишет.
      col.add({ ...b, minX: lo[0], minY: lo[1], minZ: lo[2], maxX: hi[0], maxY: hi[1], maxZ: hi[2] });
    }
  }
  // Объекты журнала, собранные для вещи: границы — по повёрнутым вершинам.
  const log: ObjectLog | null = x.mb.log;
  if (log && log.list.length > m.o) {
    const a = x.mb.bounds(m.v);
    const b = x.sl ? x.sl.bounds(m.s) : null;
    const lo = a && b ? ([Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1]), Math.min(a[0][2], b[0][2])] as Vec3) : (a ?? b)?.[0];
    const hi = a && b ? ([Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1]), Math.max(a[1][2], b[1][2])] as Vec3) : (a ?? b)?.[1];
    if (lo && hi) for (let i = m.o; i < log.list.length; i++) Object.assign(log.list[i]!, { min: lo, max: hi });
  }
}
