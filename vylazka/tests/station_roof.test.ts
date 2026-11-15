import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { buildLevel, cellToWorld, tierFloor } from '../src/world/level_build';
import { CELL, WALL_T } from '../src/world/shell';

const SEEDS = [1, 7, 42, 20041113];

describe('зал ожидания: крыша уровня', () => {
  it.each(SEEDS)('сид %i: box покрывает все клетки зала с отступом внутрь на половину стены; y — на 5,9..6,3 м над полом зала', (seed) => {
    const layout = generateLayout(seed, 2, 'station');
    const level = buildLevel(layout);
    expect(level.roof).toBeDefined();
    const [minX, minZ, maxX, maxZ] = level.roof!.box;
    const halls = layout.rooms.filter((r) => r.type === 'concourse');
    expect(halls.length).toBeGreaterThan(0);
    const W = WALL_T / 2;
    let cells = 0;
    let lx = Infinity;
    let lz = Infinity;
    let hx = -Infinity;
    let hz = -Infinity;
    for (const r of halls) {
      for (const [x, z] of r.cells) {
        cells += 1;
        const wx = cellToWorld(x);
        const wz = cellToWorld(z);
        // Центр клетки лежит внутри прямоугольника, и вся клетка — тоже, за вычетом полстены.
        expect(wx).toBeGreaterThan(minX);
        expect(wx).toBeLessThan(maxX);
        expect(wz).toBeGreaterThan(minZ);
        expect(wz).toBeLessThan(maxZ);
        expect(wx - CELL / 2 + W).toBeGreaterThanOrEqual(minX - 1e-9);
        expect(wx + CELL / 2 - W).toBeLessThanOrEqual(maxX + 1e-9);
        expect(wz - CELL / 2 + W).toBeGreaterThanOrEqual(minZ - 1e-9);
        expect(wz + CELL / 2 - W).toBeLessThanOrEqual(maxZ + 1e-9);
        lx = Math.min(lx, wx);
        lz = Math.min(lz, wz);
        hx = Math.max(hx, wx);
        hz = Math.max(hz, wz);
      }
    }
    expect(cells).toBeGreaterThan(0);
    // Прямоугольник — ровно по внутренним граням крайних клеток, а не шире.
    expect(minX).toBeCloseTo(lx - CELL / 2 + W, 6);
    expect(minZ).toBeCloseTo(lz - CELL / 2 + W, 6);
    expect(maxX).toBeCloseTo(hx + CELL / 2 - W, 6);
    expect(maxZ).toBeCloseTo(hz + CELL / 2 - W, 6);
    // Высота над полом зала.
    const floor = tierFloor(halls[0]!.tier);
    const above = level.roof!.y - floor;
    expect(above).toBeGreaterThanOrEqual(5.9);
    expect(above).toBeLessThanOrEqual(6.3);
  });

  it.each(['shelter', 'office', 'yellow'] as const)('у мира %s поля roof нет', (world) => {
    const level = buildLevel(generateLayout(7, 2, world));
    expect(level.roof).toBeUndefined();
    expect('roof' in level).toBe(false);
  });
});
