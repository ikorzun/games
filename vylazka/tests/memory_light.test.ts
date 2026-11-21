import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { MEM_LIGHT_FADE, MEM_LIGHT_KIND, MEMORY_LIGHT, memLightMod, memLightStep, memoryLightOf } from '../src/world/memory_light';
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

  it('роды света различны и укладываются в то, что знает шейдер (0–4)', () => {
    const v = Object.values(MEM_LIGHT_KIND);
    expect(new Set(v).size).toBe(v.length);
    for (const k of v) expect(k >= 0 && k <= 4).toBe(true);
  });

  it('первая вещь убежища — та, что ищут в первой сессии, — со своим светом', () => {
    expect(memoryLightOf(WORLD_MEMORIES.shelter[0]!.thing)?.kind).toBe('dial');
  });

  it('свой свет у каждой вещи из цепочек всех четырёх мест; у вещей сна и обстановки — нет', () => {
    for (const [world, defs] of Object.entries(WORLD_MEMORIES)) for (const d of defs) expect(memoryLightOf(d.thing), `${world}: ${d.thing}`).toBeDefined();
    for (const kind of ['mug', 'ball', 'toy_heap', 'teddy']) {
      expect(ALL_PROPS[kind], kind).toBeDefined();
      expect(memoryLightOf(kind), kind).toBeUndefined();
    }
  });

  it('жизнь света во времени: ровный — всегда 1; лампочка мигает; поезд — редкая волна; экран неровный, но не гаснет', () => {
    const at = (mod: Parameters<typeof memLightMod>[0], from: number, to: number, step = 0.01): number[] => {
      const v: number[] = [];
      for (let t = from; t < to; t += step) v.push(memLightMod(mod, t));
      return v;
    };
    expect(at(undefined, 0, 20).every((x) => x === 1)).toBe(true);
    // Лампочка «на удержании»: то полная, то почти погасшая, примерно поровну.
    const blink = at('blink', 0, 12);
    const on = blink.filter((x) => x === 1).length / blink.length;
    expect(on).toBeGreaterThan(0.4);
    expect(on).toBeLessThan(0.55);
    expect(Math.min(...blink)).toBeLessThan(0.1);
    // Поезд: почти всё время слабый отсвет, раз в девять секунд — волна до полной силы.
    const pass = at('pass', 0, 9);
    expect(Math.max(...pass)).toBeGreaterThan(0.98);
    expect(pass.filter((x) => x > 0.5).length / pass.length).toBeLessThan(0.25);
    expect(Math.min(...pass)).toBeGreaterThanOrEqual(0.12);
    expect(memLightMod('pass', 4.5)).toBeCloseTo(memLightMod('pass', 13.5), 6);
    // Экран: значения разные (мерцает), но в пределах [0,35; 1] — свет не пропадает совсем.
    const tv = at('tv', 0, 10);
    expect(new Set(tv.map((x) => x.toFixed(2))).size).toBeGreaterThan(20);
    expect(Math.min(...tv)).toBeGreaterThanOrEqual(0.35);
    expect(Math.max(...tv)).toBeLessThanOrEqual(1);
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
