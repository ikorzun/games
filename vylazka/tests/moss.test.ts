import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { MeshBuilder } from '../src/world/kit';
import { buildLevel } from '../src/world/level_build';
import { MOSS_PILE, MOSS_SHELLS, mossCushion } from '../src/world/moss';
import { Xf } from '../src/world/props';

/** Кочка, собранная отдельно, в начале координат. */
function cushion(seed = 5, r = 0.22) {
  const mb = new MeshBuilder();
  mossCushion(new Xf(mb, null, 0, 0, 0, 0), seed, r);
  return mb.build();
}

describe('мох слоями: mossCushion', () => {
  it('у сетки есть поле качания, все значения лежат в [-1, 0]', () => {
    const m = cushion();
    expect(m.sway).toBeDefined();
    for (const w of m.sway!) {
      expect(w).toBeGreaterThanOrEqual(-1);
      expect(w).toBeLessThanOrEqual(0);
    }
  });

  it('есть вершины основания (0) и кончиков (-1)', () => {
    const w = cushion().sway!;
    expect(w.some((v) => v === 0)).toBe(true);
    expect(w.some((v) => v === -1)).toBe(true);
  });

  it('слои выдвинуты наружу: макушка растёт с уровнем слоя ровно на MOSS_PILE', () => {
    const m = cushion();
    const n = m.sway!.length;
    // Вершин в слое поровну; макушка — последняя вершина каждого слоя (вверх по оси y).
    const per = n / (MOSS_SHELLS + 1);
    expect(Number.isInteger(per)).toBe(true);
    const topY = (s: number): number => m.position[(s * per + per - 1) * 3 + 1]!;
    const topW = (s: number): number => m.sway![s * per + per - 1]!;
    expect(topW(0)).toBe(0);
    expect(topW(MOSS_SHELLS)).toBe(-1);
    expect(topY(MOSS_SHELLS) - topY(0)).toBeCloseTo(MOSS_PILE, 5);
    for (let s = 1; s <= MOSS_SHELLS; s++) {
      expect(topY(s)).toBeGreaterThan(topY(s - 1)!);
      expect(topW(s)).toBeLessThan(topW(s - 1)!);
    }
  });

  it('чем отрицательнее вес вершины, тем она дальше от оси кочки (с той же вершины слоя)', () => {
    const m = cushion();
    const per = m.sway!.length / (MOSS_SHELLS + 1);
    for (let i = 0; i < per; i++) {
      let prev = -1;
      for (let s = 0; s <= MOSS_SHELLS; s++) {
        const k = s * per + i;
        const d = Math.hypot(m.position[k * 3]!, m.position[k * 3 + 2]!);
        // Нормаль вершины направлена от оси (или вверх): радиус не убывает.
        expect(d).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = d;
      }
    }
  });

  it('треугольников (MOSS_SHELLS + 1) × число треугольников одного слоя', () => {
    const m = cushion();
    const tris = m.index.length / 3;
    const per = tris / (MOSS_SHELLS + 1);
    expect(Number.isInteger(per)).toBe(true);
    expect(per).toBeGreaterThan(0);
    // Один слой: два кольца по 8 сегментов (по два треугольника на клетку) и «шапка» из 8.
    expect(per).toBe(2 * 8 * 2 + 8);
  });

  it('до и после вызова swayValue у построителя тот же (мох не оставляет следа в чужих вершинах)', () => {
    const mb = new MeshBuilder();
    mb.swayValue = 0.5;
    mossCushion(new Xf(mb, null, 0, 0, 0, 0), 3);
    expect(mb.swayValue).toBe(0.5);
  });
});

describe('мох в уровнях: растёт только у воды', () => {
  const negatives = (level: ReturnType<typeof buildLevel>): number => level.chunks.reduce((s, c) => s + (c.mesh.sway ? c.mesh.sway.filter((w) => w < 0).length : 0), 0);

  it('в убежище с водой в сетках есть отрицательные веса', () => {
    let found = 0;
    for (const seed of [1, 5, 7, 42, 808, 20041113]) {
      const level = buildLevel(generateLayout(seed, 3, 'shelter'));
      if (!level.zones.some((z) => z.kind === 'water')) continue;
      found += 1;
      expect(negatives(level), `сид ${seed}`).toBeGreaterThan(0);
    }
    expect(found, 'ни в одном из сидов нет воды').toBeGreaterThan(0);
  });

  it('в офисе (воды нет) отрицательных весов нет ни одного', () => {
    for (const seed of [7, 20041113]) {
      const level = buildLevel(generateLayout(seed, 3, 'office'));
      expect(level.zones.some((z) => z.kind === 'water')).toBe(false);
      expect(negatives(level), `сид ${seed}`).toBe(0);
    }
  });
});
