import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { MeshBuilder } from '../src/world/kit';
import { buildLevel, tierFloor } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { DOOR_H } from '../src/world/shell';
import { buildTestLevel } from '../src/world/test_level';
import { coplanarOverlaps } from './coplanar';
import type { Overlap } from './coplanar';

/** Наложение между бетоном стены и материалом дверной коробки или ступени. */
const between = (o: Overlap, a: number, b: number): boolean => (o.mats[0] === a && o.mats[1] === b) || (o.mats[0] === b && o.mats[1] === a);
const FRAMES = [MAT.wood, MAT.enamel, MAT.metalGreen];
const vertical = (o: Overlap): boolean => Math.abs(o.n[1]) < 0.1;
/** Низ перемычки: грань лицом вниз на высоте проёма над одним из ярусов. */
const soffit = (o: Overlap): boolean => o.n[1] < -0.9 && [0, 1, 2].some((t) => Math.abs(o.at[1] - tierFloor(t) - DOOR_H) < 0.01);

function doorFights(all: Overlap[]): Overlap[] {
  return all.filter((o) => FRAMES.some((m) => between(o, MAT.concrete, m)) && (vertical(o) || soffit(o)));
}
function stairFights(all: Overlap[]): Overlap[] {
  return all.filter((o) => (between(o, MAT.concrete, MAT.steel) && vertical(o)) || (between(o, MAT.concrete, MAT.floor) && o.n[1] > 0.9) || (between(o, MAT.concrete, MAT.wetConcrete) && o.n[1] > 0.9));
}
const where = (list: Overlap[]): string => list.slice(0, 4).map((o) => `${o.at.map((v) => v.toFixed(2)).join(', ')} (${o.area.toFixed(3)} м²)`).join('; ');

describe('рябь: две грани в одной плоскости', () => {
  it('поиск находит точное наложение и не трогает накладку, вынесенную на миллиметр', () => {
    const quads = (lift: number): MeshBuilder => {
      const mb = new MeshBuilder();
      mb.quadFacing([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], MAT.concrete);
      mb.quadFacing([0.2, lift, 0.2], [0.8, lift, 0.2], [0.8, lift, 0.8], [0.2, lift, 0.8], [0, 1, 0], MAT.wood);
      return mb;
    };
    const same = coplanarOverlaps([quads(0).build()]);
    expect(same.reduce((s, o) => s + o.area, 0)).toBeCloseTo(0.36, 2);
    expect(coplanarOverlaps([quads(0.001).build()])).toHaveLength(0);
    // Грани, смотрящие в разные стороны (ящик у стены), не спорят.
    const back = new MeshBuilder();
    back.quadFacing([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], MAT.concrete);
    back.quadFacing([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, -1], MAT.wood);
    expect(coplanarOverlaps([back.build()])).toHaveLength(0);
  });

  it('в проёмах коробка двери не лежит в одной плоскости с откосом и перемычкой стены', () => {
    const test = coplanarOverlaps(buildTestLevel().chunks.map((c) => c.mesh));
    expect(doorFights(test), where(doorFights(test))).toHaveLength(0);
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      for (const seed of [20041113, 7, 1984]) {
        const all = coplanarOverlaps(buildLevel(generateLayout(seed, 2, world)).chunks.map((c) => c.mesh));
        expect(doorFights(all), `${world} ${seed}: ${where(doorFights(all))}`).toHaveLength(0);
      }
    }
  }, 120000);

  it('на лестнице уголок не лежит в плоскости подступёнка, а нижняя проступь — в плоскости пола', () => {
    const test = coplanarOverlaps(buildTestLevel().chunks.map((c) => c.mesh));
    expect(stairFights(test), where(stairFights(test))).toHaveLength(0);
    for (const seed of [20041113, 7, 1984]) {
      const all = coplanarOverlaps(buildLevel(generateLayout(seed, 2, 'shelter')).chunks.map((c) => c.mesh));
      expect(stairFights(all), `${seed}: ${where(stairFights(all))}`).toHaveLength(0);
    }
  }, 120000);
});
