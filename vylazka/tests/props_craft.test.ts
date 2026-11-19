import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { PAPER_H, PAPER_LAYERS, PAPER_U0, PAPER_W, STICKER_CELL, STICKER_TILES } from '../src/world/papers';
import { Xf } from '../src/world/props';
import { CRAFT_PROPS } from '../src/world/props_craft';
import type { PropSpec } from '../src/world/props_more';

/** Допуск по габариту, м: мятость лепестков, торцы труб у пола, толщина слоёв наклеек. */
const TOL = 0.06;
/** Бюджет треугольников по предметам. */
const BUDGET: Record<string, number> = {
  paper_flower: 700,
  paper_flower_hang: 700,
  paper_flower_bed: 2600,
  mound_small: 900,
  mound: 2600,
  mound_big: 4200,
  thicket: 1600,
  sticker_box: 900,
  sticker_patch: 500,
};
/** Сколько преград у предмета (ровно). */
const BOXES: Record<string, number> = {
  paper_flower: 1,
  paper_flower_bed: 1,
  paper_flower_hang: 0,
  mound_small: 1,
  mound: 1,
  mound_big: 1,
  thicket: 1,
  sticker_box: 1,
  sticker_patch: 0,
};
const GLOW = new Set(['mound_small', 'mound', 'mound_big']);

/** Опорные сиды и ещё двенадцать «случайных» (но своих, воспроизводимых). */
const SEEDS = [1, 7, 1000, 1007, 20041113, 0, ...Array.from({ length: 12 }, (_, i) => (Math.imul(i + 3, 2654435761) >>> 0) % 1000000)];
const allowedMat = (v: number): boolean => v <= MAT.castIron || v >= MAT.wallpaper;
/** Наклейки с картинками: тело наклейки — MAT.print, картинка из слоя stickers стопки бумаги (world/papers.ts). */
const PRINTED = new Set(['sticker_box', 'sticker_patch']);

interface Built {
  mesh: MeshData;
  col: ColliderSet;
  tris: number;
}

function build(p: PropSpec, seed: number, rot: 0 | 1 | 2 | 3 = 0): Built {
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  p.build(new Xf(mb, col, 0, 0, 0, rot), seed);
  return { mesh: mb.build(), col, tris: mb.triangleCount };
}

function bounds(m: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.position[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

function envelope(p: PropSpec): { min: Vec3; max: Vec3 } {
  const hw = p.w / 2;
  // Открытые дверцы и ящики вещей полки выходят вперёд за d на reach (PropSpec.reach).
  if (p.mount === 'free') return { min: [-hw, 0, -p.d / 2], max: [hw, p.h, p.d / 2 + (p.reach ?? 0)] };
  if (p.mount === 'ceiling') return { min: [-hw, -p.h, 0], max: [hw, 0, p.d] };
  return { min: [-hw, 0, 0], max: [hw, p.h, p.d + (p.reach ?? 0)] };
}

const AXES = ['x', 'y', 'z'] as const;
const entries = Object.entries(CRAFT_PROPS);

describe('реестр поделок', () => {
  it('девять предметов с заявленными монтажом и габаритами', () => {
    expect(Object.keys(CRAFT_PROPS).sort()).toEqual(Object.keys(BUDGET).sort());
    const want: Record<string, [string, number, number, number, number?]> = {
      paper_flower: ['free', 1.0, 1.0, 2.1],
      paper_flower_bed: ['free', 2.2, 1.4, 2.3],
      paper_flower_hang: ['ceiling', 1.3, 1.3, 1.2],
      mound_small: ['free', 1.0, 1.0, 0.55],
      mound: ['free', 2.0, 2.0, 1.15],
      mound_big: ['free', 3.0, 3.0, 1.7],
      thicket: ['free', 2.4, 1.4, 2.5],
      sticker_box: ['wall', 0.62, 0.2, 0.82, 0.95],
      sticker_patch: ['wall', 0.9, 0.02, 1.0, 0.9],
    };
    for (const [name, p] of entries) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
      expect(p.ru.trim().length, name).toBeGreaterThan(2);
      const [mount, w, d, h, y] = want[name]!;
      expect([p.mount, p.w, p.d, p.h, p.y], name).toEqual([mount, w, d, h, y]);
    }
  });
});

describe.each(entries)('предмет %s', (name, p) => {
  const base = build(p, 1000);

  it('геометрия цела: индексы, конечные числа, единичные нормали', () => {
    const m = base.mesh;
    expect(base.tris).toBeGreaterThan(0);
    expect(m.index.length % 3).toBe(0);
    const verts = m.position.length / 3;
    expect(m.index.every((i) => i < verts)).toBe(true);
    for (const seed of SEEDS) {
      const b = build(p, seed).mesh;
      for (const arr of [b.position, b.normal, b.color, b.uv]) expect(arr.every((v) => Number.isFinite(v)), `сид ${seed}`).toBe(true);
      for (let i = 0; i < b.normal.length; i += 3) {
        const l = Math.hypot(b.normal[i]!, b.normal[i + 1]!, b.normal[i + 2]!);
        if (Math.abs(l - 1) > 1e-3) throw new Error(`${name}, сид ${seed}: нормаль длиной ${l}`);
      }
    }
  });

  it('обход граней согласован с нормалью вершины (нет вывернутых граней)', () => {
    for (const seed of [SEEDS[0]!, SEEDS[2]!, SEEDS[4]!]) {
      const m = build(p, seed).mesh;
      let bad = 0;
      for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
        const e1: Vec3 = [m.position[b]! - m.position[a]!, m.position[b + 1]! - m.position[a + 1]!, m.position[b + 2]! - m.position[a + 2]!];
        const e2: Vec3 = [m.position[c]! - m.position[a]!, m.position[c + 1]! - m.position[a + 1]!, m.position[c + 2]! - m.position[a + 2]!];
        const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const d = n[0] * m.normal[a]! + n[1] * m.normal[a + 1]! + n[2] * m.normal[a + 2]!;
        if (d < 0) bad++;
      }
      expect(bad, `${name}, сид ${seed}: граней с обратным обходом`).toBe(0);
    }
  });

  it('материалы разрешены, оттенок в пределах, свечение — только у гор', () => {
    for (const seed of SEEDS) {
      const m = build(p, seed).mesh;
      expect(m.mat.every((v) => Number.isInteger(v) && (allowedMat(v) || (PRINTED.has(name) && v === MAT.print))), `сид ${seed}`).toBe(true);
      for (let i = 0; i < m.color.length; i += 4) {
        const hi = m.mat[i / 4] === MAT.glow ? 14 : 1.5;
        for (let k = 0; k < 3; k++) {
          expect(m.color[i + k]!, `${name}: тон`).toBeGreaterThanOrEqual(0.1);
          expect(m.color[i + k]!, `${name}: тон`).toBeLessThanOrEqual(hi);
        }
        expect(m.color[i + 3]! >= 0 && m.color[i + 3]! <= 1, `${name}: AO`).toBe(true);
      }
      const glow = m.mat.some((v) => v === MAT.glow);
      expect(glow, `${name}, сид ${seed}: пламя ${GLOW.has(name) ? 'должно быть' : 'не положено'}`).toBe(GLOW.has(name));
    }
  });

  it(`не больше ${BUDGET[name]} треугольников`, () => {
    for (const seed of SEEDS) expect(build(p, seed).tris, `сид ${seed}`).toBeLessThanOrEqual(BUDGET[name]!);
  });

  it('укладывается в заявленный габарит при любом сиде', () => {
    const env = envelope(p);
    for (const seed of SEEDS) {
      const bb = bounds(build(p, seed).mesh);
      for (let k = 0; k < 3; k++) {
        expect(bb.min[k]!, `${name}, сид ${seed}: min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
        expect(bb.max[k]!, `${name}, сид ${seed}: max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
      }
    }
  });

  it('опора: на полу, на стене или под потолком', () => {
    for (const seed of SEEDS) {
      const bb = bounds(build(p, seed).mesh);
      if (p.mount === 'free') expect(bb.min[1], `сид ${seed}: низ на полу`).toBeLessThanOrEqual(0.05);
      if (p.mount === 'wall') expect(bb.min[2], `сид ${seed}: у стены`).toBeLessThanOrEqual(0.03);
      if (p.mount === 'ceiling') expect(bb.max[1], `сид ${seed}: верх у потолка`).toBeGreaterThanOrEqual(-0.03);
    }
  });

  it('преграды: сколько сказано, внутри габарита, стоят на полу', () => {
    const env = envelope(p);
    for (const seed of SEEDS) {
      const boxes = build(p, seed).col.boxes;
      expect(boxes.length, `${name}, сид ${seed}`).toBe(BOXES[name]);
      for (const b of boxes) {
        const lo: Vec3 = [b.minX, b.minY, b.minZ];
        const hi: Vec3 = [b.maxX, b.maxY, b.maxZ];
        for (let k = 0; k < 3; k++) {
          expect(hi[k]! - lo[k]!, `${name}: преграда вырождена по ${AXES[k]}`).toBeGreaterThan(0.005);
          expect(lo[k]!, `${name}: преграда, min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
          expect(hi[k]!, `${name}: преграда, max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
        }
      }
    }
  });

  it('один сид — одна сетка, разные сиды — разные', () => {
    for (const seed of [SEEDS[0]!, SEEDS[2]!]) {
      const a = build(p, seed);
      const b = build(p, seed);
      expect(a.tris).toBe(b.tris);
      for (const key of ['position', 'normal', 'color', 'mat', 'uv', 'index'] as const) expect(Array.from(a.mesh[key]), key).toEqual(Array.from(b.mesh[key]));
      expect(a.col.boxes).toEqual(b.col.boxes);
    }
    const sig = (seed: number): string => Array.from(build(p, seed).mesh.position).join(',');
    const sigs = new Set([1, 7, 1000, 1007, 20041113].map(sig));
    expect(sigs.size, 'пять разных сидов дают пять разных сеток').toBe(5);
  });

  it('поворот на четверти оборота не ломает сборку', () => {
    for (const rot of [1, 2, 3] as const) {
      const r = build(p, 1000, rot);
      expect(r.tris, `поворот ${rot}`).toBe(base.tris);
      expect(r.mesh.position.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

describe('особые случаи', () => {
  it('у mound_small нет оградки, у mound и mound_big есть: тёмные жерди из чугуна', () => {
    const iron = (n: string): boolean => build(CRAFT_PROPS[n]!, 1000).mesh.mat.some((v) => v === MAT.castIron);
    expect(iron('mound_small')).toBe(false);
    expect(iron('mound')).toBe(true);
    expect(iron('mound_big')).toBe(true);
  });

  it('число свечей по размеру горы: по вершинам пламени', () => {
    // У пламени восемь граней — 24 вершины; свеч столько, сколько групп по 24 вершины.
    const flames = (n: string, seed: number): number => build(CRAFT_PROPS[n]!, seed).mesh.mat.filter((v) => v === MAT.glow).length / 24;
    for (const seed of SEEDS) {
      expect(flames('mound_small', seed)).toBe(3);
      expect(flames('mound', seed)).toBeGreaterThanOrEqual(8);
      expect(flames('mound', seed)).toBeLessThanOrEqual(10);
      expect(flames('mound_big', seed)).toBeGreaterThanOrEqual(14);
      expect(flames('mound_big', seed)).toBeLessThanOrEqual(18);
    }
  });

  it('в проёме оградки (0,6 м спереди) нет ни стоек, ни жердей', () => {
    for (const n of ['mound', 'mound_big']) {
      const p = CRAFT_PROPS[n]!;
      const m = build(p, 1000).mesh;
      const edge = p.w / 2 - 0.05;
      for (let i = 0; i < m.position.length; i += 3) {
        if (m.mat[i / 3] !== MAT.castIron) continue;
        const [x, z] = [m.position[i]!, m.position[i + 2]!];
        // Передняя сторона: z у края, а x внутри проёма (минус толщина жердей).
        if (z > edge - 0.03) expect(Math.abs(x) >= 0.3 - 0.02, `${n}: железо в проёме, x=${x.toFixed(3)}`).toBe(true);
      }
    }
  });

  it('жердей завала 16–22, обмоток белой бумагой достаточно', () => {
    for (const seed of SEEDS) {
      const m = build(CRAFT_PROPS.thicket!, seed).mesh;
      // Жердь: две кольца по шесть вершин и два торца (центр + шесть) = 12 + 14 вершин.
      const wood = m.mat.filter((v) => v === MAT.wood).length;
      expect(wood / 26, `сид ${seed}: жердей`).toBeGreaterThanOrEqual(16);
      expect(wood / 26, `сид ${seed}: жердей`).toBeLessThanOrEqual(22);
      const wraps = m.mat.filter((v) => v === MAT.paper).length / 12;
      expect(wraps, `сид ${seed}: обмоток`).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('картинки наклеек (партнёр 19.11: «сделать на них более детальное изображение»)', () => {
  const layer = PAPER_LAYERS.indexOf('stickers');
  const tileOf = (u: number, v: number): number => Math.floor(((u - PAPER_U0 - layer) * PAPER_W) / STICKER_CELL) + 4 * Math.floor(((1 - v) * PAPER_H) / STICKER_CELL);
  const tiles = (m: MeshData): number[] => {
    const out = new Set<number>();
    for (let i = 0; i < m.mat.length; i++) if (m.mat[i] === MAT.print) out.add(tileOf(m.uv[i * 2]!, m.uv[i * 2 + 1]!));
    return [...out];
  };

  it('картинка — из слоя stickers; одна и та же не повторяется, пока не показаны другие', () => {
    for (const seed of SEEDS) {
      for (const [n, least] of [['sticker_patch', 15], ['sticker_box', 8]] as const) {
        const t = tiles(build(CRAFT_PROPS[n]!, seed).mesh);
        expect(t.every((k) => k >= 0 && k < STICKER_TILES), `${n}, сид ${seed}: ${t.join()}`).toBe(true);
        expect(t.length, `${n}, сид ${seed}: разных картинок`).toBeGreaterThanOrEqual(least);
      }
    }
  });
});
