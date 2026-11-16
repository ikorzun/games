import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { MEM_LIGHT_FADE, MEM_LIGHT_KIND, MEMORY_LIGHT, memLightStep, memoryLightOf } from '../src/world/memory_light';
import { ALL_PROPS } from '../src/world/props_all';
import { setThingRegistry, thingMesh } from '../src/world/thing_mesh';
import { WORLD_MEMORIES } from '../src/systems/session';

/** Свет памяти (world/memory_light.ts): у какой вещи какой свет, как он загорается и гаснет, что видно издалека. */
describe('свет памяти', () => {
  setThingRegistry(ALL_PROPS);

  it('свет есть только у настоящих вещей реестра', () => {
    for (const kind of Object.keys(MEMORY_LIGHT)) expect(ALL_PROPS[kind], kind).toBeDefined();
  });

  it('вещи, что стоят в двух местах, — со своим светом (по ним видно, что места связаны)', () => {
    const where = new Map<string, Set<string>>();
    for (const [world, defs] of Object.entries(WORLD_MEMORIES)) for (const d of defs) where.set(d.thing, (where.get(d.thing) ?? new Set()).add(world));
    const bridges = [...where].filter(([, w]) => w.size > 1).map(([t]) => t);
    expect(bridges.sort()).toEqual(['kettle', 'office_chair', 'st_coat', 'st_ticket']);
    for (const b of bridges) expect(memoryLightOf(b), b).toBeDefined();
  });

  it('красного нет: красный — знак системы (сетка, давление, выход)', () => {
    for (const [kind, d] of Object.entries(MEMORY_LIGHT)) {
      const [r, g, b] = d.color;
      expect(r > 1.4 * g && r > 1.4 * b, kind).toBe(false);
      expect(d.strength).toBeGreaterThan(0);
      expect(d.radius).toBeGreaterThan(0.5);
    }
  });

  it('роды света различны и укладываются в то, что знает шейдер (0–3)', () => {
    const v = Object.values(MEM_LIGHT_KIND);
    expect(new Set(v).size).toBe(v.length);
    for (const k of v) expect(k >= 0 && k <= 3).toBe(true);
  });

  it('загорается за MEM_LIGHT_FADE.in, гаснет быстрее и не перелетает цель', () => {
    let k = 0;
    let t = 0;
    while (k < 1 && t < 10) {
      k = memLightStep(k, 1, 0.1);
      t += 0.1;
    }
    expect(t).toBeCloseTo(MEM_LIGHT_FADE.in, 1);
    let down = 0;
    while (k > 0 && down < 10) {
      k = memLightStep(k, 0, 0.1);
      down += 0.1;
    }
    expect(down).toBeLessThan(t);
    expect(memLightStep(0.5, 0.6, 1)).toBe(0.6);
    expect(memLightStep(0.5, 0.4, 1)).toBe(0.4);
  });

  it('у чайника горит газ (свет из самого предмета), у пальто лежит снег', () => {
    const mats = (kind: string): Set<number> => new Set(thingMesh(kind, 7).mesh.mat);
    expect(mats('kettle').has(MAT.glow)).toBe(true);
    expect(mats('st_coat').has(MAT.paper)).toBe(true);
  });
});
