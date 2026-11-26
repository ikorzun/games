import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { SwaySpec } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { Xf, hung, rooted, swaying } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';

const N: [number, number, number] = [0, 1, 0];

/** Положить по вершине на каждой высоте из списка; вернуть веса качания в порядке добавления. */
function weights(setup: (mb: MeshBuilder) => void, ys: number[]): number[] | undefined {
  const mb = new MeshBuilder();
  setup(mb);
  for (const y of ys) mb.vertex([0, y, 0], N, MAT.wallpaper);
  // Для build() нужен хоть один треугольник: индексы не важны для весов.
  return mb.build().sway ? Array.from(mb.build().sway!) : undefined;
}

describe('качание: MeshBuilder.sway', () => {
  it('без sway у build() нет поля sway', () => {
    const mb = new MeshBuilder();
    mb.vertex([0, 0, 0], N, MAT.wallpaper);
    mb.vertex([0, 1, 0], N, MAT.wallpaper);
    expect('sway' in mb.build()).toBe(false);
    expect(mb.build().sway).toBeUndefined();
  });

  it('вес вершины = clamp((y − from) / span, 0, 1) × gain', () => {
    const spec: SwaySpec = { from: 1, span: 2, gain: 0.5 };
    const w = weights((mb) => (mb.sway = spec), [0, 1, 1.5, 2, 3, 5])!;
    expect(w[0]).toBeCloseTo(0); // ниже from — зажато в 0
    expect(w[1]).toBeCloseTo(0);
    expect(w[2]).toBeCloseTo(0.125); // (0,5 / 2) × 0,5
    expect(w[3]).toBeCloseTo(0.25);
    expect(w[4]).toBeCloseTo(0.5);
    expect(w[5]).toBeCloseTo(0.5); // выше from + span — зажато в gain
  });

  it('при span < 0 вес растёт вниз', () => {
    const w = weights((mb) => (mb.sway = { from: 0, span: -2, gain: 1 }), [0.5, 0, -1, -2, -3])!;
    expect(w[0]).toBeCloseTo(0);
    expect(w[1]).toBeCloseTo(0);
    expect(w[2]).toBeCloseTo(0.5);
    expect(w[3]).toBeCloseTo(1);
    expect(w[4]).toBeCloseTo(1);
  });

  it('с bend: true вес идёт квадратом', () => {
    const w = weights((mb) => (mb.sway = { from: 0, span: 2, gain: 0.8, bend: true }), [0, 0.5, 1, 2])!;
    expect(w[1]).toBeCloseTo(0.25 * 0.25 * 0.8);
    expect(w[2]).toBeCloseTo(0.25 * 0.8);
    expect(w[3]).toBeCloseTo(0.8);
  });

  it('swayValue перекрывает sway и кладёт число как есть, в том числе отрицательное; после null снова действует sway', () => {
    const mb = new MeshBuilder();
    mb.sway = { from: 0, span: 1, gain: 1 };
    mb.vertex([0, 1, 0], N, MAT.wallpaper); // 1
    mb.swayValue = -0.7;
    mb.vertex([0, 1, 0], N, MAT.wallpaper); // −0,7
    mb.swayValue = 3.5;
    mb.vertex([0, 0, 0], N, MAT.wallpaper); // 3,5 даже вне зажима
    mb.swayValue = 0;
    mb.vertex([0, 1, 0], N, MAT.wallpaper); // ноль — тоже значение, а не «не задан»
    mb.swayValue = null;
    mb.vertex([0, 0.5, 0], N, MAT.wallpaper); // 0,5
    const s = Array.from(mb.build().sway!);
    expect(s[0]).toBeCloseTo(1);
    expect(s[1]).toBeCloseTo(-0.7);
    expect(s[2]).toBeCloseTo(3.5);
    expect(s[3]).toBeCloseTo(0);
    expect(s[4]).toBeCloseTo(0.5);
  });

  it('swayValue без sway тоже даёт поле', () => {
    const mb = new MeshBuilder();
    mb.swayValue = -1;
    mb.vertex([0, 0, 0], N, MAT.wallpaper);
    expect(Array.from(mb.build().sway!)).toEqual([-1]);
  });
});

describe('качание: hung, rooted, swaying', () => {
  const mk = (oy = 0): Xf => new Xf(new MeshBuilder(), new ColliderSet(), 0, oy, 0, 0);

  it('hung и rooted задают spec от xf.oy и возвращают прежнее значение', () => {
    const xf = mk(2);
    let inside: SwaySpec | null = null;
    hung(xf, 1.5, 0.8, () => (inside = xf.mb.sway));
    expect(inside).toEqual({ from: 2, span: -1.5, gain: 0.8 });
    expect(xf.mb.sway).toBeNull();
    rooted(xf, 3, 0.4, () => (inside = xf.mb.sway));
    expect(inside).toEqual({ from: 2, span: 3, gain: 0.4, bend: true });
    expect(xf.mb.sway).toBeNull();
  });

  it('возвращают результат build', () => {
    const xf = mk();
    expect(hung(xf, 1, 1, () => 42)).toBe(42);
    expect(rooted(xf, 1, 1, () => 'x')).toBe('x');
    expect(swaying(xf, { from: 0, span: 1, gain: 1 }, () => [1])).toEqual([1]);
  });

  it('прежнее значение xf.mb.sway возвращается после сборки, даже если build бросил исключение', () => {
    const xf = mk();
    const prev: SwaySpec = { from: 9, span: 9, gain: 9 };
    xf.mb.sway = prev;
    expect(() => hung(xf, 1, 1, () => { throw new Error('сбой'); })).toThrow('сбой');
    expect(xf.mb.sway).toBe(prev);
    expect(() => rooted(xf, 1, 1, () => { throw new Error('сбой'); })).toThrow('сбой');
    expect(xf.mb.sway).toBe(prev);
    expect(() => swaying(xf, { from: 0, span: 1, gain: 1 }, () => { throw new Error('сбой'); })).toThrow('сбой');
    expect(xf.mb.sway).toBe(prev);
    // Вложенность: внутренний возвращает внешний spec.
    let mid: SwaySpec | null = null;
    hung(xf, 1, 1, () => {
      hung(xf, 2, 1, () => undefined);
      mid = xf.mb.sway;
    });
    expect(mid).toEqual({ from: 0, span: -1, gain: 1 });
    expect(xf.mb.sway).toBe(prev);
  });
});

/** Собрать предмет реестра так же, как в тестах реквизита. */
function buildProp(name: string, seed = 1000): { sway: Float32Array | undefined; ys: number[] } {
  const mb = new MeshBuilder();
  ALL_PROPS[name]!.build(new Xf(mb, new ColliderSet(), 0, 0, 0, 0), seed);
  const m = mb.build();
  const ys: number[] = [];
  for (let i = 1; i < m.position.length; i += 3) ys.push(m.position[i]!);
  return { sway: m.sway, ys };
}

describe('качание: предметы реестра', () => {
  it.each(['paper_flower_hang', 'hanging_cables', 'broken_lamp', 'st_sign'])('висящий %s: есть ненулевые веса, верх весит меньше низа', (name) => {
    expect(name in ALL_PROPS).toBe(true);
    const { sway, ys } = buildProp(name);
    expect(sway, `${name}: поле sway`).toBeDefined();
    expect(sway!.length).toBe(ys.length);
    expect(sway!.some((w) => w !== 0)).toBe(true);
    const yMin = Math.min(...ys);
    // Потолок — y = 0: верхняя треть габарита против нижней.
    const third = (0 - yMin) / 3;
    const top: number[] = [];
    const bottom: number[] = [];
    ys.forEach((y, i) => {
      if (y > -third) top.push(sway![i]!);
      else if (y < yMin + third) bottom.push(sway![i]!);
    });
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(top), name).toBeLessThan(mean(bottom));
    expect(Math.max(...top), name).toBeLessThanOrEqual(Math.max(...bottom));
    // Вершины у самого потолка почти не качаются.
    ys.forEach((y, i) => {
      if (y > -0.02) expect(sway![i]!, `${name}, y=${y}`).toBeLessThan(0.1);
    });
  });

  it('у paper_flower веса растут с высотой', () => {
    const { sway, ys } = buildProp('paper_flower');
    expect(sway).toBeDefined();
    expect(sway!.some((w) => w !== 0)).toBe(true);
    const yMax = Math.max(...ys);
    const low: number[] = [];
    const high: number[] = [];
    ys.forEach((y, i) => {
      if (y < yMax / 3) low.push(sway![i]!);
      else if (y > (2 * yMax) / 3) high.push(sway![i]!);
    });
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(high)).toBeGreaterThan(mean(low));
    // Корень стоит.
    ys.forEach((y, i) => {
      if (y < 0.02) expect(sway![i]!).toBeLessThan(0.01);
    });
  });

  it.each(['sofa', 'wardrobe', 'bookshelf', 'desk_pc'])('у обычной мебели (%s) поля sway нет', (name) => {
    expect(name in ALL_PROPS).toBe(true);
    const { sway } = buildProp(name);
    expect(sway).toBeUndefined();
  });
});
