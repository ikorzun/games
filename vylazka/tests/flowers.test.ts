import { describe, expect, it } from 'vitest';
import { BLOOMS, FLOWER_SPECIES, HEADS, headForm, headsOf, plant } from '../src/world/flowers';
import type { FlowerSpecies } from '../src/world/flowers';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { Xf } from '../src/world/props';

const finite = (m: MeshData): boolean => [m.position, m.normal, m.color].every((a) => Array.from(a).every(Number.isFinite));
const indicesOk = (m: MeshData): boolean => Array.from(m.index).every((i) => i >= 0 && i < m.position.length / 3);
function box(m: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, m.position[i + k]!);
      max[k] = Math.max(max[k]!, m.position[i + k]!);
    }
  return { min, max };
}
function planted(species: FlowerSpecies, seed: number, size = 1, yaw = 0) {
  const mb = new MeshBuilder();
  const blooms = plant(new Xf(mb, null, 0, 0, 0, 0), [0, 0, 0], species, seed, size, yaw);
  return { mesh: mb.build(), blooms };
}

describe('головки цветов', () => {
  it.each(HEADS.map((h, i) => [h.ru, i] as const))('%s: ближняя и дальняя собираются, без NaN, в своей рамке', (_ru, form) => {
    const near = headForm(form, 0);
    const far = headForm(form, 1);
    for (const m of [near, far]) {
      expect(finite(m)).toBe(true);
      expect(indicesOk(m)).toBe(true);
      const b = box(m);
      // Начало — верх стебля, +y — куда смотрит: головка лежит у начала, вниз уходит не дальше чашечки.
      for (let k = 0; k < 3; k++) expect(Math.max(Math.abs(b.min[k]!), Math.abs(b.max[k]!))).toBeLessThan(0.16);
      expect(b.min[1]!).toBeGreaterThan(-0.045);
      expect(b.max[1]!).toBeGreaterThan(0.004);
    }
    expect(far.index.length).toBeLessThan(near.index.length);
    expect(near.index.length / 3).toBeLessThanOrEqual(700);
    expect(far.index.length / 3).toBeLessThanOrEqual(360);
  });

  it('сетка головки строится один раз', () => {
    expect(headForm(0, 0)).toBe(headForm(0, 0));
  });

  it('у каждого цветущего вида есть головки, у зелени — нет', () => {
    for (const s of FLOWER_SPECIES) expect(headsOf(s).length > 0, s).toBe(BLOOMS.includes(s));
  });
});

describe('посадка', () => {
  it.each(FLOWER_SPECIES)('%s: собирается без NaN; головки — у цветущих, смотрят вверх, на своей высоте', (s) => {
    for (const seed of [1, 7, 1000, 20041113]) {
      const { mesh, blooms } = planted(s, seed);
      expect(finite(mesh)).toBe(true);
      expect(indicesOk(mesh)).toBe(true);
      expect(mesh.index.length / 3).toBeGreaterThan(20);
      expect(mesh.index.length / 3, `${s}: треугольников`).toBeLessThanOrEqual(s === 'fern' ? 2000 : s === 'monstera' ? 1600 : 1300);
      if (!BLOOMS.includes(s)) {
        expect(blooms).toEqual([]);
        continue;
      }
      expect(blooms.length).toBeGreaterThanOrEqual(1);
      for (const b of blooms) {
        expect(Math.hypot(...b.dir)).toBeCloseTo(1, 6);
        expect(b.dir[1], `${s}: смотрит вверх`).toBeGreaterThan(0.3);
        expect(b.pos[1]).toBeGreaterThan(0.04);
        expect(b.pos[1]).toBeLessThan(0.75);
        expect(headsOf(s)).toContain(b.form);
      }
    }
  });

  it('тот же сид — то же растение; поворот и место сдвигают его целиком', () => {
    const a = planted('carnation', 5);
    const b = planted('carnation', 5);
    expect(Array.from(a.mesh.position)).toEqual(Array.from(b.mesh.position));
    const mb = new MeshBuilder();
    const moved = plant(new Xf(mb, null, 2, 0, -3, 1), [0.1, 0.2, 0], 'carnation', 5);
    expect(moved[0]!.pos[1]).toBeCloseTo(a.blooms[0]!.pos[1] + 0.2, 6);
  });

  it('сводка для глаз: треугольники головок и растений', () => {
    const rows = HEADS.map((h, i) => `${h.ru}: ${headForm(i, 0).index.length / 3} / ${headForm(i, 1).index.length / 3}`);
    const plants = FLOWER_SPECIES.map((s) => `${s}: ${planted(s, 7).mesh.index.length / 3}`);
    console.log([...rows, ...plants].join('\n'));
  });
});
