import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { MAT, MAT_COUNT } from '../src/world/materials';
import { buildPocket, POCKET_KINDS } from '../src/world/pockets';
import type { ModelCell, PocketContext, PocketKind, PocketSpace } from '../src/world/pockets';

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

  // Луг — открытая сцена с травой, деревьями и небом: ему отведено больше, чем комнатам.
  const limit = kind === 'meadow' ? 60000 : 14000;
  it(`не больше ${limit} треугольников`, () => {
    expect(triangles(s)).toBeLessThanOrEqual(limit);
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

/** Меш, целиком сделанный из светящегося материала: так выглядит обводка выхода (она добавляется отдельным мешем). */
const glowOnly = (s: PocketSpace): boolean => s.meshes.some((m) => m.mat.length > 0 && Array.from(m.mat).every((v) => v === MAT.glow));

describe.each(POCKET_KINDS.map((k) => [k] as [PocketKind]))('выход пространства %s', (kind) => {
  it('есть выход на полу, якорь — на высоте 1,2 м над ним, обводка — отдельный светящийся меш', () => {
    const s = buildPocket(kind, 7, ORIGIN);
    expect(s.exit).toBeTruthy();
    const e = s.exit!;
    expect(dist(s, e)).toBeLessThan(s.radius);
    expect(inside(s, e, 0.3)).toBe(false);
    expect(s.anchors.length).toBeGreaterThan(0);
    expect(s.anchors[0]![0]).toBeCloseTo(e[0], 5);
    expect(s.anchors[0]![2]).toBeCloseTo(e[2], 5);
    expect(s.anchors[0]![1] - ORIGIN[1]).toBeCloseTo(1.2, 5);
    expect(glowOnly(s)).toBe(true);
  });

  it('обводка стоит вокруг самого выхода: красные рейки лежат в пределах проёма', () => {
    const s = buildPocket(kind, 7, ORIGIN);
    const e = s.exit!;
    const m = s.meshes.find((x) => Array.from(x.mat).every((v) => v === MAT.glow))!;
    for (let i = 0; i < m.position.length; i += 3) {
      expect(Math.abs(m.position[i]! - e[0])).toBeLessThanOrEqual(0.46);
      expect(Math.abs(m.position[i + 2]! - e[2])).toBeLessThanOrEqual(0.04);
      expect(m.position[i + 1]! - e[1]).toBeGreaterThanOrEqual(-0.001);
      expect(m.position[i + 1]! - e[1]).toBeLessThanOrEqual(2.06);
    }
  });
});

describe('лимбо: белое нигде в конце сессии', () => {
  it('выхода и обводки нет, якорей нет', () => {
    const s = buildPocket('void', 7, ORIGIN, { limbo: true });
    expect(s.exit).toBeNull();
    expect(s.anchors).toEqual([]);
    expect(glowOnly(s)).toBe(false);
  });

  it('посреди сессии (не лимбо) выход у белого нигде есть', () => {
    const s = buildPocket('void', 7, ORIGIN, { limbo: false });
    expect(s.exit).not.toBeNull();
    expect(glowOnly(s)).toBe(true);
  });
});

describe('кукольный домик: стол с макетом', () => {
  const cells: ModelCell[] = [
    { x: 3, z: 4, tier: 1, type: 'kitchen', room: 1 },
    { x: 4, z: 4, tier: 1, type: 'kitchen', room: 1 },
    { x: 5, z: 4, tier: 1, type: 'corridor', room: 2 },
    { x: 5, z: 5, tier: 1, type: 'bedroom', room: 3 },
    { x: 0, z: 0, tier: 0, type: 'entrance', room: 0 },
  ];
  const ctx: PocketContext = { cells, target: { x: 4, z: 4, tier: 1 }, here: { x: 5, z: 5, tier: 1 } };

  it('есть главный предмет (focus); точка появления смотрит на стол (yaw π, взгляд вниз) и дальше 0,8 м от выхода', () => {
    const s = buildPocket('dollhouse', 7, ORIGIN, ctx);
    expect(s.focus).toBeTruthy();
    expect(s.spawn.yaw).toBeCloseTo(Math.PI, 5);
    expect(s.spawn.pitch).toBeCloseTo(-0.3, 5);
    // Взгляд yaw π идёт в +z: стол должен лежать впереди, а не за спиной.
    expect(s.focus![2]).toBeGreaterThan(s.spawn.pos[2]);
    const e = s.exit!;
    expect(Math.hypot(s.spawn.pos[0] - e[0], s.spawn.pos[2] - e[2])).toBeGreaterThan(0.8);
  });

  it('с планом убежища макет добавляет геометрию', () => {
    const bare = buildPocket('dollhouse', 7, ORIGIN);
    const full = buildPocket('dollhouse', 7, ORIGIN, ctx);
    expect(triangles(full)).toBeGreaterThan(triangles(bare));
    // Макет — часть дома: сама сцена не меняется ни по выходу, ни по точке появления.
    expect(full.exit).toEqual(bare.exit);
    expect(full.focus).toEqual(bare.focus);
    expect(full.spawn).toEqual(bare.spawn);
  });

  it('искомая вещь и «ты здесь» добавляют метки: без target и here геометрии меньше', () => {
    const plain = buildPocket('dollhouse', 7, ORIGIN, { cells });
    const marked = buildPocket('dollhouse', 7, ORIGIN, ctx);
    expect(triangles(marked)).toBeGreaterThan(triangles(plain));
  });

  it('другие виды focus не имеют', () => {
    expect(buildPocket('void', 7, ORIGIN).focus).toBeNull();
    expect(buildPocket('meadow', 7, ORIGIN).focus).toBeNull();
  });
});
