import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { MAT_COUNT } from '../src/world/materials';
import { buildPocket, POCKET_KINDS } from '../src/world/pockets';
import type { PocketKind, PocketSpace } from '../src/world/pockets';

const ORIGIN: Vec3 = [1000, 40, -500];
const SHIFTED: Vec3 = [-300, 12.5, 777];

const inside = (s: PocketSpace, p: Vec3, dy: number): boolean => s.colliders.some((b) => p[0] > b.minX && p[0] < b.maxX && p[2] > b.minZ && p[2] < b.maxZ && p[1] + dy > b.minY && p[1] + dy < b.maxY);
const standsOnFloor = (s: PocketSpace, p: Vec3): boolean => s.colliders.some((b) => p[0] >= b.minX && p[0] <= b.maxX && p[2] >= b.minZ && p[2] <= b.maxZ && Math.abs(b.maxY - p[1]) <= 0.05);
const dist = (s: PocketSpace, p: Vec3): number => Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]);
const triangles = (s: PocketSpace): number => s.meshes.reduce((n, m) => n + m.index.length / 3, 0);

describe.each(POCKET_KINDS.map((k) => [k] as [PocketKind]))('карманное пространство %s', (kind) => {
  const s = buildPocket(kind, 7, ORIGIN);

  it('собрано именно того вида', () => {
    expect(s.kind).toBe(kind);
  });

  it('геометрия не пуста, индексы в пределах, нет NaN', () => {
    expect(s.meshes.length).toBeGreaterThan(0);
    for (const m of s.meshes) {
      const n = m.position.length / 3;
      expect(n).toBeGreaterThan(0);
      expect(m.index.length % 3).toBe(0);
      expect(m.normal.length).toBe(m.position.length);
      expect(m.color.length).toBe(n * 4);
      expect(m.mat.length).toBe(n);
      for (const a of [m.position, m.normal, m.color, m.mat, m.uv]) {
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`не число в индексе ${i}`);
      }
      for (let i = 0; i < m.index.length; i++) if (m.index[i]! >= n) throw new Error(`индекс вне вершин: ${m.index[i]}`);
    }
    for (const b of s.colliders) {
      expect([b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every(Number.isFinite)).toBe(true);
      expect(b.maxX).toBeGreaterThan(b.minX);
      expect(b.maxY).toBeGreaterThan(b.minY);
      expect(b.maxZ).toBeGreaterThan(b.minZ);
    }
  });

  it('не больше 14000 треугольников', () => {
    expect(triangles(s)).toBeLessThanOrEqual(14000);
  });

  it('материалы — существующие номера', () => {
    for (const m of s.meshes) {
      for (let i = 0; i < m.mat.length; i++) {
        const v = m.mat[i]!;
        if (!Number.isInteger(v) || v < 0 || v >= MAT_COUNT) throw new Error(`нет материала ${v}`);
      }
    }
  });

  it('точка появления стоит на полу и не внутри преграды', () => {
    expect(standsOnFloor(s, s.spawn.pos)).toBe(true);
    expect(inside(s, s.spawn.pos, 0.3)).toBe(false);
    expect(inside(s, s.spawn.pos, 1.0)).toBe(false);
  });

  it('якоря и места лежат в радиусе и вне преград', () => {
    for (const p of s.anchors) {
      expect(dist(s, p)).toBeLessThan(s.radius);
      expect(inside(s, p, 0)).toBe(false);
    }
    for (const p of s.spots) {
      expect(dist(s, p)).toBeLessThan(s.radius);
      expect(inside(s, p, 0.3)).toBe(false);
      expect(inside(s, p, 1.0)).toBe(false);
    }
  });

  it('один сид — один результат', () => {
    const a = buildPocket(kind, 7, ORIGIN);
    expect(a.meshes.length).toBe(s.meshes.length);
    a.meshes.forEach((m, i) => {
      expect(Array.from(m.position)).toEqual(Array.from(s.meshes[i]!.position));
      expect(Array.from(m.color)).toEqual(Array.from(s.meshes[i]!.color));
      expect(Array.from(m.index)).toEqual(Array.from(s.meshes[i]!.index));
    });
    expect(a.colliders).toEqual(s.colliders);
    expect(a.spots).toEqual(s.spots);
  });

  it('другой origin — та же геометрия со сдвигом', () => {
    const o = buildPocket(kind, 7, SHIFTED);
    const d: Vec3 = [SHIFTED[0] - ORIGIN[0], SHIFTED[1] - ORIGIN[1], SHIFTED[2] - ORIGIN[2]];
    expect(o.meshes.length).toBe(s.meshes.length);
    o.meshes.forEach((m, i) => {
      const r = s.meshes[i]!;
      expect(m.position.length).toBe(r.position.length);
      for (let k = 0; k < m.position.length; k++) {
        if (Math.abs(m.position[k]! - (r.position[k]! + d[k % 3]!)) > 1e-2) throw new Error(`вершина ${k} не сдвинута`);
      }
      expect(Array.from(m.index)).toEqual(Array.from(r.index));
      expect(Array.from(m.color)).toEqual(Array.from(r.color));
    });
    s.colliders.forEach((b, i) => {
      const c = o.colliders[i]!;
      expect(c.minX - b.minX).toBeCloseTo(d[0], 2);
      expect(c.maxY - b.maxY).toBeCloseTo(d[1], 2);
      expect(c.minZ - b.minZ).toBeCloseTo(d[2], 2);
    });
    expect(o.spawn.yaw).toBe(s.spawn.yaw);
    expect(o.spawn.pos[2] - s.spawn.pos[2]).toBeCloseTo(d[2], 2);
  });
});
