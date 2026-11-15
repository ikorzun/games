import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { GROVE } from '../src/world/furnish_office';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import type { LevelObject } from '../src/world/objects';
import { ALL_PROPS } from '../src/world/props_all';
import { BIRCH_H, LEAF_Y } from '../src/world/props_office';
import { CELL } from '../src/world/shell';

const SEEDS = [1, 5, 7, 42, 808, 4242, 9001, 31337, 20041113, 123456789, ...Array.from({ length: 30 }, (_, i) => (i * 7919 + 101) >>> 0)];
const levels = new Map<string, BuiltLevel>();
const level = (seed: number, world: WorldKind = 'office'): BuiltLevel => {
  const key = `${seed}:${world}`;
  let l = levels.get(key);
  if (!l) levels.set(key, (l = buildLevel(generateLayout(seed, 2, world))));
  return l;
};
const birches = (l: BuiltLevel): LevelObject[] => l.objects!.filter((o) => o.name === 'birch');
/** Середина ствола на полу: начало координат предмета. */
const at = (o: LevelObject): [number, number] => [o.at[0], o.at[2]];
/** Клетка сетки под точкой: как в генераторе, клетка (8, 8) — вокруг начала координат. */
const cellOf = (x: number, z: number): [number, number] => [Math.round(x / CELL) + 8, Math.round(z / CELL) + 8];
/** Отдел и его середина в мире. */
function department(l: BuiltLevel): { id: number; cx: number; cz: number; cells: Set<string> } {
  const r = l.layout!.rooms.find((x) => x.type === 'department')!;
  const xs = r.cells.map((c) => c[0]);
  const zs = r.cells.map((c) => c[1]);
  return { id: r.id, cx: ((Math.min(...xs) + Math.max(...xs)) / 2 - 8) * CELL, cz: ((Math.min(...zs) + Math.max(...zs)) / 2 - 8) * CELL, cells: new Set(r.cells.map(([x, z]) => `${x},${z}`)) };
}

/** Треугольники уровня, не принадлежащие объектам (то, что остаётся, когда предмет растворён), по условию. */
function decor(l: BuiltLevel, mat: number, keep: (p: readonly [number, number, number][]) => boolean): number {
  let n = 0;
  for (const ch of l.chunks) {
    const g = ch.mesh;
    for (let t = 0; t < g.index.length; t += 3) {
      const v = [g.index[t]!, g.index[t + 1]!, g.index[t + 2]!];
      if (g.mat[v[0]!] !== mat) continue;
      if (g.obj && v.some((i) => g.obj![i] !== 0)) continue;
      if (keep(v.map((i) => [g.position[i * 3]!, g.position[i * 3 + 1]!, g.position[i * 3 + 2]!] as const))) n += 1;
    }
  }
  return n;
}

describe('берёзы, проросшие сквозь отдел офиса', () => {
  it('берёза — предмет реестра: стоит посреди пола сама по себе, ростом до потолка', () => {
    const p = ALL_PROPS.birch!;
    expect(p).toBeDefined();
    expect(p.mount).toBe('free');
    expect(p.h).toBeGreaterThanOrEqual(BIRCH_H);
    expect(p.w).toBeLessThan(0.7);
  });

  it('растут только в отделе офиса: ряд из четырёх и одна-две поодаль; в убежище и жёлтых комнатах их нет', () => {
    for (const seed of SEEDS) {
      const l = level(seed);
      const d = department(l);
      const trees = birches(l);
      expect(trees.length, `сид ${seed}`).toBeGreaterThanOrEqual(GROVE.min);
      expect(trees.length, `сид ${seed}`).toBeLessThanOrEqual(GROVE.max);
      for (const o of trees) expect(d.cells.has(cellOf(...at(o)).join(',')), `сид ${seed}: берёза вне отдела`).toBe(true);
      // Ряд: четыре ствола по одну сторону острова столов, на одной линии (в двух метрах от его середины).
      const rows = [
        trees.filter((o) => at(o)[0] - d.cx > 1.8),
        trees.filter((o) => d.cx - at(o)[0] > 1.8),
        trees.filter((o) => at(o)[1] - d.cz > 1.8),
        trees.filter((o) => d.cz - at(o)[1] > 1.8),
      ];
      expect(Math.max(...rows.map((r) => r.length)), `сид ${seed}: ряда нет`).toBeGreaterThanOrEqual(GROVE.row);
    }
    for (const world of ['shelter', 'yellow'] as const) for (const seed of SEEDS.slice(0, 8)) expect(birches(level(seed, world)), `${world} ${seed}`).toHaveLength(0);
  });

  it('ствол идёт от пола до потолка; преграда — только сам ствол; это обычный объект: его можно растворить', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const l = level(seed);
      for (const o of birches(l)) {
        expect(o.min[1], `сид ${seed}`).toBeLessThanOrEqual(0.02);
        expect(o.max[1], `сид ${seed}`).toBeGreaterThanOrEqual(BIRCH_H - 0.02);
        expect(o.max[0] - o.min[0]).toBeLessThan(0.7);
        expect(o.max[2] - o.min[2]).toBeLessThan(0.7);
        expect(o.solid).toBe(true);
        expect(o.flat).toBe(false);
        expect(o.group).toBeUndefined();
        const boxes = l.colliders.boxes.filter((b) => b.owner === o.id);
        expect(boxes).toHaveLength(1);
        expect(boxes[0]!.maxX - boxes[0]!.minX).toBeLessThan(0.36);
        expect(boxes[0]!.maxZ - boxes[0]!.minZ).toBeLessThan(0.36);
      }
    }
  });

  it('стволы не мешают ходить: не на прямых между серединами клеток, не под панелями, не в острове столов и не на месте вещи', () => {
    for (const seed of SEEDS) {
      const l = level(seed);
      const d = department(l);
      const trees = birches(l);
      const spots = l.spots.filter((s) => s.room === d.id);
      expect(spots.length, `сид ${seed}: мест для вещей в отделе`).toBeGreaterThanOrEqual(4);
      trees.forEach((o, i) => {
        const [x, z] = at(o);
        const [cx, cz] = cellOf(x, z);
        // В своей клетке — в углу: до её осей (по ним идут пути и висит панель) не ближе 0,7 м.
        expect(Math.abs(x - (cx - 8) * CELL), `сид ${seed}: берёза ${i} на пути`).toBeGreaterThanOrEqual(0.7);
        expect(Math.abs(z - (cz - 8) * CELL), `сид ${seed}: берёза ${i} на пути`).toBeGreaterThanOrEqual(0.7);
        // Остров столов занимает середину комнаты: 3 × 3 м.
        expect(Math.abs(x - d.cx) < 1.7 && Math.abs(z - d.cz) < 1.7, `сид ${seed}: берёза ${i} в острове`).toBe(false);
        for (const s of spots) expect(Math.hypot(s.x - x, s.z - z), `сид ${seed}: берёза ${i} на месте вещи`).toBeGreaterThanOrEqual(0.7);
        for (const q of trees.slice(i + 1)) expect(Math.hypot(at(q)[0] - x, at(q)[1] - z), `сид ${seed}: стволы срослись`).toBeGreaterThanOrEqual(1.0);
      });
    }
  });

  it('над каждым стволом выбита плита, из дыры свисают ветки с листьями, на полу лежат листья — и это не часть ствола', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const l = level(seed);
      for (const o of birches(l)) {
        const [x, z] = at(o);
        const near = (r: number) => (p: readonly [number, number, number][]): boolean => p.every((q) => Math.hypot(q[0] - x, q[2] - z) < r);
        const band = (y0: number, y1: number) => (p: readonly [number, number, number][]): boolean => p.every((q) => q[1] >= y0 && q[1] <= y1);
        // Дыра: тёмный квадрат в плоскости потолка, 0,6 × 0,6 м.
        expect(decor(l, MAT.rubber, (p) => near(0.45)(p) && band(BIRCH_H - 0.01, BIRCH_H)(p)), `сид ${seed}: дыра в потолке`).toBe(2);
        // Ветки и листья на них: под потолком, не дальше 0,9 м от ствола.
        expect(decor(l, MAT.wood, (p) => near(0.9)(p) && band(1.9, BIRCH_H)(p)), `сид ${seed}: ветки`).toBeGreaterThanOrEqual(32);
        expect(decor(l, MAT.paper, (p) => near(0.9)(p) && band(1.8, BIRCH_H)(p)), `сид ${seed}: листья на ветках`).toBeGreaterThanOrEqual(100);
        // Листья на полу: плоские, чуть над ковролином.
        expect(decor(l, MAT.paper, (p) => near(1.95)(p) && band(LEAF_Y - 0.001, LEAF_Y + 0.004)(p)), `сид ${seed}: листья на полу`).toBeGreaterThanOrEqual(120);
      }
      // У самого ствола свои вершины помечены его номером: растворяется только он.
      const g = l.chunks.find((c) => c.mesh.obj && birches(l).some((o) => c.mesh.obj!.includes(o.id)))!;
      expect(g, `сид ${seed}: вершины ствола`).toBeDefined();
    }
  });

  it('листья лежат на полу отдела и не заходят в стены', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const l = level(seed);
      const d = department(l);
      let out = 0;
      for (const ch of l.chunks) {
        const g = ch.mesh;
        for (let i = 0; i < g.position.length / 3; i++) {
          if (g.mat[i] !== MAT.paper || (g.obj && g.obj[i] !== 0)) continue;
          const y = g.position[i * 3 + 1]!;
          if (y < LEAF_Y - 0.001 || y > LEAF_Y + 0.004) continue;
          const x = g.position[i * 3]!;
          const z = g.position[i * 3 + 2]!;
          // Только листья рощи: вокруг отдела.
          if (Math.abs(x - d.cx) > 6 || Math.abs(z - d.cz) > 6) continue;
          if (!d.cells.has(cellOf(x, z).join(','))) out += 1;
        }
      }
      expect(out, `сид ${seed}: листья за стеной`).toBe(0);
    }
  });

  it('один сид — одна и та же роща', () => {
    for (const seed of [808, 20041113]) {
      const a = birches(buildLevel(generateLayout(seed, 2, 'office'))).map((o) => [o.at, o.rot, o.min, o.max]);
      const b = birches(buildLevel(generateLayout(seed, 2, 'office'))).map((o) => [o.at, o.rot, o.min, o.max]);
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(b);
    }
  });
});
