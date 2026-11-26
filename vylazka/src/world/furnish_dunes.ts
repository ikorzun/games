/**
 * Чёрный проём песчаного зала на уровне (партнёр 21.11, 19:13; world/pocket_dunes.ts; design.md, §38).
 *
 * В части уровней одно тупиковое помещение с единственной дверью становится входом в зал: в его проёме — чернота, в которой
 * свет фонаря не находит ничего (ни стены, ни пола), а из черноты на пол коридора высыпался язык песка. Шагнул в черноту —
 * стоишь в проёме огромного зала (game.ts, шов). Само помещение пусто: вместо обстановки у двери изнутри насыпан песок — его
 * видно, только если стена с годами осыпалась (поздние круги).
 *
 * Язык песка — рельеф (HeightField): по нему ходят, порог чуть выше пола, к краям песок сходит на нет. Высота у проёма та же,
 * что у порога зала (SILL): шагнул туда и обратно — ноги на той же высоте.
 */
import type { Vec3 } from '../core/types';
import { clamp, smoothstep } from '../core/math';
import type { ColliderSet, HeightField } from './colliders';
import type { RoomCtx } from './furnish';
import type { MeshBuilder } from './kit';
import { MAT } from './materials';
import { DOOR_W } from './shell';

/** Сколько песка у порога, м: столько же лежит у порога зала (world/pocket_dunes.ts). */
export const SILL = 0.2;
/** Язык песка из проёма: на сколько выходит в коридор и на сколько расходится в стороны, м. */
const TONGUE = { out: 1.9 } as const;
const SAND: Vec3 = [1.18, 0.98, 0.7];

/** Проём зала на уровне: где он, на каком полу и куда смотрит внутрь помещения-хозяина. */
export interface DuneDoor {
  /** Помещение за проёмом (тупиковое, с одной дверью). */
  room: number;
  tier: number;
  /** Середина проёма на плоскости стены (x, z). */
  at: [number, number];
  /** Пол у проёма. */
  y: number;
  /** Единичная нормаль внутрь помещения-хозяина (по главной оси). */
  n: [number, number];
  /** Ширина и высота проёма в свету: дверь — 1,1 × 2,05 м; сквозной проём жёлтых комнат — во всю стену и до потолка. */
  w: number;
  h: number;
}

/** Высота языка песка над полом: a — от плоскости проёма наружу (в коридор), l — вбок; w — ширина проёма. */
export function tongueHeight(a: number, l: number, w: number = DOOR_W): number {
  if (a < 0) return Math.abs(l) <= w / 2 + 0.05 ? SILL : 0;
  const spread = w / 2 - 0.05 + 0.45 * a;
  const r = Math.pow(a / TONGUE.out, 1.2) + (l / spread) * (l / spread);
  const lumps = 0.018 * Math.sin(a * 7.3 + l * 3.1) * Math.sin(l * 5.7 - a * 2.2);
  return Math.max(0, SILL * (1 - smoothstep(0, 1, r)) + lumps * (1 - smoothstep(0.6, 1, r)));
}

/**
 * Чернота в проёме (с обеих сторон) и язык песка в коридор; песок — рельеф для контроллера. mb — сетка куска снаружи
 * (коридора): её видно, когда виден коридор.
 */
export function duneDoorway(mb: MeshBuilder, col: ColliderSet, d: DuneDoor): void {
  const [nx, nz] = d.n;
  // Вбок вдоль проёма: t = (−nz, nx).
  const tx = -nz;
  const tz = nx;
  const [cx, cz] = d.at;
  const y = d.y;
  const hw = d.w / 2 + 0.01;
  const side = d.w / 2 + 1.0;
  const P = (lat: number, up: number, out: number): Vec3 => [cx + tx * lat - nx * out, y + up, cz + tz * lat - nz * out];
  // Чернота: две стороны одной плоскости — снаружи и изнутри. Свет её не берёт: оттенок нулевой.
  const black: Vec3 = [0, 0, 0];
  mb.quadFacing(P(-hw, 0, 0), P(hw, 0, 0), P(hw, d.h, 0), P(-hw, d.h, 0), [-nx, 0, -nz], MAT.plaster, black, 1);
  mb.quadFacing(P(hw, 0, 0), P(-hw, 0, 0), P(-hw, d.h, 0), P(hw, d.h, 0), [nx, 0, nz], MAT.plaster, black, 1);

  // Язык песка: сетка в своих координатах (a — наружу, l — вбок), треугольники — только там, где песок есть.
  const NA = 16;
  const NL = 20;
  const A0 = -0.32;
  const ids: number[][] = [];
  const hs: number[][] = [];
  const e = 0.05;
  for (let i = 0; i <= NA; i++) {
    const a = A0 + ((TONGUE.out - A0) * i) / NA;
    const row: number[] = [];
    const hrow: number[] = [];
    for (let j = 0; j <= NL; j++) {
      const l = -side + (2 * side * j) / NL;
      const h = tongueHeight(a, l, d.w);
      const ha = (tongueHeight(a + e, l, d.w) - tongueHeight(a - e, l, d.w)) / (2 * e);
      const hl = (tongueHeight(a, l + e, d.w) - tongueHeight(a, l - e, d.w)) / (2 * e);
      // Мир: a идёт по −n, l — по t. Нормаль = (−∂h/∂x, 1, −∂h/∂z).
      const dx = -nx * ha + tx * hl;
      const dz = -nz * ha + tz * hl;
      const len = Math.hypot(dx, 1, dz);
      const lit = clamp(0.9 + h * 0.6, 0.85, 1.04);
      row.push(mb.vertex(P(l, h + 0.004, a), [-dx / len, 1 / len, -dz / len], MAT.dirt, [SAND[0] * lit, SAND[1] * lit, SAND[2] * lit], clamp(0.7 + h * 1.5, 0.7, 1)));
      hrow.push(h);
    }
    ids.push(row);
    hs.push(hrow);
  }
  // Обход: нормаль вверх при любой ориентации проёма — проверяется по самим точкам.
  const up = (i0: number, i1: number, i2: number, p0: Vec3, p1: Vec3, p2: Vec3): void => {
    const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    if (ny >= 0) mb.tri(i0, i1, i2);
    else mb.tri(i0, i2, i1);
  };
  for (let i = 0; i < NA; i++) {
    for (let j = 0; j < NL; j++) {
      if (Math.max(hs[i]![j]!, hs[i + 1]![j]!, hs[i]![j + 1]!, hs[i + 1]![j + 1]!) < 0.006) continue;
      const a0 = A0 + ((TONGUE.out - A0) * i) / NA;
      const a1 = A0 + ((TONGUE.out - A0) * (i + 1)) / NA;
      const l0 = -side + (2 * side * j) / NL;
      const l1 = -side + (2 * side * (j + 1)) / NL;
      const p00 = P(l0, 0, a0);
      const p10 = P(l0, 0, a1);
      const p01 = P(l1, 0, a0);
      const p11 = P(l1, 0, a1);
      up(ids[i]![j]!, ids[i + 1]![j]!, ids[i + 1]![j + 1]!, p00, p10, p11);
      up(ids[i]![j]!, ids[i + 1]![j + 1]!, ids[i]![j + 1]!, p00, p11, p01);
    }
  }
  const corners = [P(-side, 0, A0), P(side, 0, A0), P(-side, 0, TONGUE.out), P(side, 0, TONGUE.out)];
  const field: HeightField = {
    minX: Math.min(...corners.map((p) => p[0])),
    maxX: Math.max(...corners.map((p) => p[0])),
    minZ: Math.min(...corners.map((p) => p[2])),
    maxZ: Math.max(...corners.map((p) => p[2])),
    at: (x, z) => {
      const rx = x - cx;
      const rz = z - cz;
      return y + tongueHeight(-(rx * nx + rz * nz), rx * tx + rz * tz, d.w);
    },
  };
  col.addField(field);
}

/**
 * Помещение за чёрным проёмом: обстановки нет (места для вещей заняты), у двери изнутри — горка песка. Её видно, только
 * если стена осыпалась.
 */
export function furnishDuneHost(ctx: RoomCtx, d: DuneDoor): void {
  for (const s of ctx.slots) s.used = true;
  const mb = ctx.cells[0]?.xf.mb;
  if (!mb) return;
  const [nx, nz] = d.n;
  const c: [number, number] = [d.at[0] + nx * 1.3, d.at[1] + nz * 1.3];
  const R = 1.7;
  const H = 0.55;
  const N = 12;
  const ring = (k: number, r: number): Vec3 => {
    const a = (k / N) * Math.PI * 2;
    const h = H * (1 - (r / R) * (r / R));
    return [c[0] + Math.cos(a) * r, d.y + Math.max(0.004, h), c[1] + Math.sin(a) * r];
  };
  const top = mb.vertex([c[0], d.y + H, c[1]], [0, 1, 0], MAT.dirt, SAND, 1);
  const rings = [0.6, 1.2, R].map((r) =>
    Array.from({ length: N }, (_, k) => {
      const p = ring(k, r);
      const slope = (2 * H * r) / (R * R);
      const a = (k / N) * Math.PI * 2;
      const len = Math.hypot(slope, 1);
      return mb.vertex(p, [(Math.cos(a) * slope) / len, 1 / len, (Math.sin(a) * slope) / len], MAT.dirt, SAND, r === R ? 0.75 : 0.95);
    }),
  );
  for (let k = 0; k < N; k++) {
    const j = (k + 1) % N;
    mb.tri(top, rings[0]![j]!, rings[0]![k]!);
    for (let q = 0; q < 2; q++) {
      const a = rings[q]!;
      const b = rings[q + 1]!;
      mb.tri(a[k]!, a[j]!, b[j]!);
      mb.tri(a[k]!, b[j]!, b[k]!);
    }
  }
}
