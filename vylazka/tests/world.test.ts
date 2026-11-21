import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet, rayBox } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT_COUNT, MAT_DEFS } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { buildTestLevel } from '../src/world/test_level';

/** Все треугольники смотрят наружу от точки center (для выпуклых тел). */
function facesOutward(m: MeshData, center: Vec3): boolean {
  for (let t = 0; t < m.index.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const i = m.index[t + k]! * 3;
      return [m.position[i]!, m.position[i + 1]!, m.position[i + 2]!] as Vec3;
    });
    const a = p[0]!;
    const b = p[1]!;
    const c = p[2]!;
    const n: Vec3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3 - center[0], (a[1] + b[1] + c[1]) / 3 - center[1], (a[2] + b[2] + c[2]) / 3 - center[2]];
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] <= 0) return false;
    // Нормаль в вершинах согласована с обходом.
    const i0 = m.index[t]! * 3;
    if (m.normal[i0]! * n[0] + m.normal[i0 + 1]! * n[1] + m.normal[i0 + 2]! * n[2] <= 0) return false;
  }
  return true;
}

describe('kit', () => {
  it('коробка: 12 треугольников, грани наружу', () => {
    const mb = new MeshBuilder();
    mb.box([0, 0, 0], [1, 2, 3], 4);
    const m = mb.build();
    expect(mb.triangleCount).toBe(12);
    expect(m.position.length / 3).toBe(24);
    expect(facesOutward(m, [0.5, 1, 1.5])).toBe(true);
    expect([...m.mat].every((v) => v === 4)).toBe(true);
  });

  it('коробка с фаской: 6 граней, 12 рёбер, 8 углов — всё наружу', () => {
    const mb = new MeshBuilder();
    mb.box([-1, -1, -1], [1, 1, 1], 0, { bevel: 0.1 });
    expect(mb.triangleCount).toBe(6 * 2 + 12 * 2 + 8);
    expect(facesOutward(mb.build(), [0, 0, 0])).toBe(true);
  });

  it('пропуск граней и затенение низа', () => {
    const mb = new MeshBuilder();
    mb.box([0, 0, 0], [1, 1, 1], 0, { skip: ['ny', 'py'], aoBottom: 0.5 });
    const m = mb.build();
    expect(mb.triangleCount).toBe(8);
    const aos = new Set<number>();
    for (let i = 3; i < m.color.length; i += 4) aos.add(m.color[i]!);
    expect([...aos].sort()).toEqual([0.5, 1]);
  });

  it('цилиндр по каждой оси смотрит наружу', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const mb = new MeshBuilder();
      mb.cylinder([0, 0, 0], axis, 2, 0.5, 1, { segments: 8 });
      const c: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      expect(facesOutward(mb.build(), c), axis).toBe(true);
    }
  });

  it('поворот размещения сохраняет размеры и ориентацию граней', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const mb = new MeshBuilder();
      const xf = new Xf(mb, null, 10, 0, -5, rot);
      xf.box([0, 0, 0], [2, 1, 0.5], 0, { bevel: 0.05 });
      xf.cyl([0, 0.5, 0.25], 'x', 2, 0.1, 0);
      const m = mb.build();
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < m.position.length; i += 3) {
        minX = Math.min(minX, m.position[i]!);
        maxX = Math.max(maxX, m.position[i]!);
        minZ = Math.min(minZ, m.position[i + 2]!);
        maxZ = Math.max(maxZ, m.position[i + 2]!);
      }
      const dims = [maxX - minX, maxZ - minZ].sort();
      expect(dims[0]).toBeCloseTo(0.5, 5);
      expect(dims[1]).toBeCloseTo(2, 5);
      // Угол (0,0,0) предмета остаётся в точке размещения.
      expect([minX, maxX].some((v) => Math.abs(v - 10) < 1e-6)).toBe(true);
    }
  });
});

describe('colliders', () => {
  it('query находит только коробки рядом', () => {
    const c = new ColliderSet();
    c.addBox(0, 0, 0, 1, 1, 1);
    c.addBox(50, 0, 50, 51, 1, 51);
    const out = c.query(-1, -1, 2, 2, []);
    expect(out.length).toBe(1);
    expect(out[0]!.maxX).toBe(1);
  });

  it('длинная коробка не дублируется в выдаче', () => {
    const c = new ColliderSet();
    c.addBox(0, 0, 0, 30, 1, 0.3);
    expect(c.query(0, -1, 30, 1, []).length).toBe(1);
  });

  it('луч: расстояние до ближней коробки, промах — maxDist', () => {
    const c = new ColliderSet();
    c.addBox(5, 0, -1, 6, 2, 1);
    c.addBox(9, 0, -1, 10, 2, 1);
    expect(c.raycast(0, 1, 0, 1, 0, 0, 30)).toBeCloseTo(5);
    expect(c.raycast(0, 1, 0, -1, 0, 0, 30)).toBe(30);
    expect(c.raycast(0, 5, 0, 1, 0, 0, 30)).toBe(30);
    expect(rayBox(5.5, 1, 0, 1, 0, 0, c.boxes[0]!)).toBe(0);
  });
});

describe('тестовый уровень', () => {
  const level = buildTestLevel();
  const mesh = level.chunks[0]!.mesh;

  it('геометрия без NaN, материалы в пределах атласа', () => {
    expect(mesh.index.length % 3).toBe(0);
    expect(mesh.index.length / 3).toBeGreaterThan(3000);
    expect(mesh.index.length / 3).toBeLessThan(40000);
    for (const arr of [mesh.position, mesh.normal, mesh.color, mesh.uv]) expect(arr.every((v) => Number.isFinite(v))).toBe(true);
    expect(mesh.mat.every((v) => Number.isInteger(v) && v >= 0 && v < MAT_COUNT)).toBe(true);
    expect(MAT_DEFS.length).toBe(MAT_COUNT);
    const maxIndex = mesh.index.reduce((a, b) => Math.max(a, b), 0);
    expect(maxIndex).toBeLessThan(mesh.position.length / 3);
  });

  it('нормали единичной длины', () => {
    for (let i = 0; i < mesh.normal.length; i += 3) {
      expect(Math.hypot(mesh.normal[i]!, mesh.normal[i + 1]!, mesh.normal[i + 2]!)).toBeCloseTo(1, 4);
    }
  });

  it('под точкой старта есть пол, а луч вдоль коридора упирается в дальнюю стену', () => {
    const [x, y, z] = level.spawn.pos;
    expect(level.colliders.raycast(x, y + 1, z, 0, -1, 0, 5)).toBeCloseTo(1, 5);
    const d = level.colliders.raycast(0.6, 1.4, 3, 0, 0, -1, 40);
    expect(d).toBeGreaterThan(18);
    expect(d).toBeLessThan(20);
  });
});
