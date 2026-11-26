import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';
import { cellHash, MIN_GAP, softNoise, solidRuns, wallGaps, wallGoneAt, WallCuts } from '../src/world/wall_gone';

/** Тот же хеш, что в шейдере, — на BigInt по модулю 2^32, как uint в GLSL. */
function refHash(x: number, y: number, z: number): number {
  const M = 0xffffffffn;
  const u = (v: number): bigint => BigInt((Math.floor(v) + 32768) >>> 0);
  let n = ((u(x) * 0x27d4eb2dn) & M) ^ ((u(y) * 0x165667b1n) & M) ^ ((u(z) * 0x9e3779b1n) & M);
  n ^= n >> 15n;
  n = (n * 0x2c1b3c6dn) & M;
  n ^= n >> 12n;
  n = (n * 0x297a2d39n) & M;
  n ^= n >> 15n;
  return Number(n & 0xffffn) / 65535;
}

describe('маска стирания стен — как в шейдере', () => {
  it('хеш клетки совпадает с uint-арифметикой GLSL', () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [3.5, -2.1, 7.9],
      [-12.2, 1.4, -30.8],
      [40.1, -9.3, 2.2],
      [-0.5, 0.5, -0.5],
    ] as const) {
      expect(cellHash(x, y, z)).toBe(refHash(x, y, z));
    }
  });

  it('шум и маска в пределах 0..1; без стирания стена цела; чем сильнее стирание, тем больше стёрто', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 0.73 - 15;
      const z = i * 1.31 - 20;
      const n = softNoise(x, 1.2, z);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(wallGoneAt(x, 1, z, 1, 0)).toBe(0);
      expect(wallGoneAt(x, 1, z, 1, 0.9)).toBeGreaterThanOrEqual(wallGoneAt(x, 1, z, 1, 0.5));
    }
  });

  it('стена стирается сверху вниз: у пола — последней', () => {
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < 200; i++) {
      top += wallGoneAt(i * 0.37, 2.4, i * 0.21, 2.4, 0.5);
      bottom += wallGoneAt(i * 0.37, 0.2, i * 0.21, 0.2, 0.5);
    }
    expect(top).toBeGreaterThan(bottom);
  });
});

describe('прорехи в стенах — проходимое совпадает с видимым', () => {
  const wall = { alongZ: true, line: 1.5, t: 0.15, a0: -1.65, a1: 1.65, lo: -0.5, hi: 2.8, floor: 0 };

  it('на шестом круге (стены 0,125) прорех нет; на последнем (0,9) — есть и не уже тела', () => {
    expect(wallGaps(wall, 0.125)).toEqual([]);
    let found = 0;
    for (let k = 0; k < 20; k++) {
      const w = { ...wall, line: 1.5 + k * 3 };
      for (const [g0, g1] of wallGaps(w, 0.9)) {
        expect(g1 - g0).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
        expect(g0).toBeGreaterThanOrEqual(w.a0 + 2 * w.t - 1e-9);
        expect(g1).toBeLessThanOrEqual(w.a1 - 2 * w.t + 1e-9);
        found += 1;
      }
    }
    expect(found).toBeGreaterThan(10);
  });

  it('сплошные куски дополняют прорехи до всей стены', () => {
    const runs = solidRuns(wall, [
      [-0.8, 0.2],
      [0.6, 1.2],
    ]);
    expect(runs).toEqual([
      [-1.65, -0.8],
      [0.2, 0.6],
      [1.2, 1.65],
    ]);
  });

  const level = (world: WorldKind) => buildLevel(generateLayout(20041113, 2, world), { wear: 0, figures: [], placed: [] });

  it('на уровне: метку получают только стены между клетками; на последнем круге многие прорваны, наружные держат', () => {
    for (const world of ['shelter', 'office'] as WorldKind[]) {
      const lvl = level(world);
      const col = lvl.colliders;
      const marked = col.boxes.filter((b) => b.cut);
      expect(marked.length).toBeGreaterThan(10);
      const before = col.boxes.length;
      const cuts = new WallCuts();
      expect(cuts.apply(col, 0.125)).toBe(0);
      const open = cuts.apply(col, 0.9);
      expect(open).toBeGreaterThan(marked.length * 0.3);
      // Прорванная стена выключена, вместо неё — куски с группой; в прорехе преграды нет.
      const cutWall = marked.find((b) => b.off)!;
      const gaps = wallGaps(cutWall.cut!, 0.9);
      expect(gaps.length).toBeGreaterThan(0);
      const [g0, g1] = gaps[0]!;
      const mid = (g0 + g1) / 2;
      const c = cutWall.cut!;
      const x = c.alongZ ? c.line : mid;
      const z = c.alongZ ? mid : c.line;
      const out: typeof col.boxes = [];
      col.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05, out);
      const solid = out.filter((b) => !b.off && !b.gone && b.maxY > c.floor + 0.3 && b.minY < c.floor + 1.5 && (b.minX < x + 0.05 && b.maxX > x - 0.05 && b.minZ < z + 0.05 && b.maxZ > z - 0.05));
      expect(solid.filter((b) => b.cut || b.group?.startsWith('wallcut:'))).toEqual([]);
      expect(col.boxes.length).toBeGreaterThan(before);
      // Обратно на ранний круг — все стены снова целы.
      expect(cuts.apply(col, 0.1)).toBe(0);
      expect(marked.every((b) => !b.off)).toBe(true);
      expect(col.boxes.filter((b) => b.group?.startsWith('wallcut:') && !b.off)).toEqual([]);
    }
  });
});
