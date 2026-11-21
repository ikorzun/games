import { describe, expect, it } from 'vitest';
import { GRAIN_VERT } from '../src/render/shaders';
import { FLOW_END, FLOW_TIME, GRAIN_DENSITY, GRAIN_MAX, GRAIN_MIN, newGrainLife, objectTriangles, RISE, sowGrains, steerGrains, stepGrains } from '../src/render/grains';
import { MeshBuilder } from '../src/world/kit';
import { hexToLinear, MAT, MAT_DEFS } from '../src/world/materials';

/** Сетка из двух ящиков: красный (объект 1) и синий повыше (объект 2), плюс ничья плита пола. */
function scene(): ReturnType<MeshBuilder['build']> {
  const mb = new MeshBuilder();
  mb.box([-3, -0.1, -3], [3, 0, 3], MAT.concrete);
  mb.obj = 1;
  mb.box([0, 0, 0], [1, 2, 0.5], MAT.paintRed, { tint: [1, 0.5, 0.5] });
  mb.obj = 2;
  mb.box([2, 1, 0], [2.4, 1.3, 0.3], MAT.paintBlue);
  mb.obj = 0;
  return mb.build();
}

describe('пыль вещи: посев точек', () => {
  it('треугольники разобраны по объектам; ничьи (пол) не попали ни к кому', () => {
    const data = scene();
    const map = objectTriangles(data);
    expect([...map.keys()].sort()).toEqual([1, 2]);
    expect(map.get(1)!.length).toBe(12);
    expect(map.get(2)!.length).toBe(12);
    // Сетка без номеров объектов — пусто.
    const plain = new MeshBuilder();
    plain.box([0, 0, 0], [1, 1, 1], MAT.concrete);
    expect(objectTriangles({ ...plain.build(), obj: undefined }).size).toBe(0);
  });

  it('точек — по площади; все лежат на своей вещи; цвет — цвет её материала с оттенком', () => {
    const data = scene();
    const tris = objectTriangles(data).get(1)!;
    const g = sowGrains(data, tris, 7);
    // Ящик 1 × 2 × 0,5: площадь 2·(2 + 1 + 0,5) = 7 м².
    expect(g.area).toBeCloseTo(7, 3);
    expect(g.count).toBe(Math.min(GRAIN_MAX, Math.round(7 * GRAIN_DENSITY)));
    expect(g.minY).toBeCloseTo(0, 5);
    expect(g.maxY).toBeCloseTo(2, 5);
    const base = hexToLinear(MAT_DEFS[MAT.paintRed]!.color);
    for (let i = 0; i < g.count; i++) {
      const [x, y, z] = [g.position[i * 3]!, g.position[i * 3 + 1]!, g.position[i * 3 + 2]!];
      expect(x).toBeGreaterThanOrEqual(-1e-4);
      expect(x).toBeLessThanOrEqual(1 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(-1e-4);
      expect(y).toBeLessThanOrEqual(2 + 1e-4);
      expect(z).toBeGreaterThanOrEqual(-1e-4);
      expect(z).toBeLessThanOrEqual(0.5 + 1e-4);
      // На поверхности ящика: хотя бы одна координата — на грани.
      const onFace = Math.min(Math.abs(x), Math.abs(x - 1), Math.abs(y), Math.abs(y - 2), Math.abs(z), Math.abs(z - 0.5));
      expect(onFace).toBeLessThan(1e-4);
      expect(g.color[i * 3]!).toBeCloseTo(base[0] * 1, 4);
      expect(g.color[i * 3 + 1]!).toBeCloseTo(base[1] * 0.5, 4);
      for (let k = 0; k < 4; k++) {
        expect(g.rnd[i * 4 + k]!).toBeGreaterThanOrEqual(0);
        expect(g.rnd[i * 4 + k]!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('точки ложатся ровно: на каждую грань — по её доле площади', () => {
    const data = scene();
    const g = sowGrains(data, objectTriangles(data).get(1)!, 3);
    // Большая грань 1 × 2 (z = 0,5) — 2/7 площади; торец 0,5 × 2 (x = 1) — 1/7.
    let front = 0;
    let side = 0;
    for (let i = 0; i < g.count; i++) {
      if (Math.abs(g.position[i * 3 + 2]! - 0.5) < 1e-4) front += 1;
      if (Math.abs(g.position[i * 3]! - 1) < 1e-4) side += 1;
    }
    expect(Math.abs(front / g.count - 2 / 7)).toBeLessThan(0.02);
    expect(Math.abs(side / g.count - 1 / 7)).toBeLessThan(0.02);
  });

  it('маленькой вещи — не меньше нижнего предела точек; слабому устройству — реже', () => {
    const data = scene();
    const tris = objectTriangles(data).get(2)!;
    // Ящик 0,4 × 0,3 × 0,3: площадь 0,66 м².
    expect(sowGrains(data, tris, 1).count).toBe(Math.round(0.66 * GRAIN_DENSITY));
    expect(sowGrains(data, tris, 1, 0.1).count).toBe(GRAIN_MIN);
    expect(sowGrains(data, objectTriangles(data).get(1)!, 1, 0.5).count).toBe(Math.round(7 * GRAIN_DENSITY * 0.5));
  });

  it('мелкое зерно: точек вчетверо больше, и предел для большой вещи растёт вместе с плотностью', () => {
    const data = scene();
    const small = objectTriangles(data).get(2)!;
    const big = objectTriangles(data).get(1)!;
    // Ящик 0,66 м²: вчетверо больше точек, чем при обычном зерне.
    expect(sowGrains(data, small, 1, 4).count).toBe(Math.round(0.66 * GRAIN_DENSITY * 4));
    // Вещь 7 м² при обычном зерне упирается в предел; при мелком предел вчетверо выше — пыль не редеет.
    expect(sowGrains(data, big, 1).count).toBe(GRAIN_MAX);
    expect(sowGrains(data, big, 1, 4).count).toBe(GRAIN_MAX * 4);
  });

  it('один сид — те же точки, другой — другие; пустой набор треугольников — ни одной точки', () => {
    const data = scene();
    const tris = objectTriangles(data).get(1)!;
    expect(sowGrains(data, tris, 5).position).toEqual(sowGrains(data, tris, 5).position);
    expect(sowGrains(data, tris, 5).position).not.toEqual(sowGrains(data, tris, 6).position);
    expect(sowGrains(data, [], 5).count).toBe(0);
  });

  it('верх вещи сходит раньше низа: вещь оседает сверху', () => {
    const data = scene();
    const g = sowGrains(data, objectTriangles(data).get(1)!, 11);
    let top = 0;
    let topN = 0;
    let low = 0;
    let lowN = 0;
    for (let i = 0; i < g.count; i++) {
      if (g.position[i * 3 + 1]! > 1.5) {
        top += g.rnd[i * 4]!;
        topN += 1;
      } else if (g.position[i * 3 + 1]! < 0.5) {
        low += g.rnd[i * 4]!;
        lowN += 1;
      }
    }
    expect(top / topN).toBeLessThan(low / lowN - 0.1);
  });

  it('светящееся осыпается светлой пылью своего оттенка', () => {
    const mb = new MeshBuilder();
    mb.box([0, 0, 0], [1, 1, 1], MAT.glow, { tint: [9, 5, 1.5] });
    const g = sowGrains(mb.build(), null, 2);
    expect(g.color[0]).toBeCloseTo(1, 4);
    expect(g.color[1]).toBeCloseTo(5 / 9, 4);
  });
});

describe('пыль вещи: точки растворяются в воздухе, на пол ничего не оседает', () => {
  const DT = 1 / 60;
  it('вещь уходит: облако видно сразу; растворилась последняя точка — облака нет, ничего не лежит', () => {
    const g = newGrainLife(0.02, false);
    expect(g.fade).toBe(1);
    for (let go = 0.02; go < 1; go += DT / 0.9) {
      steerGrains(g, go);
      stepGrains(g, DT);
      expect(g.fade).toBe(1);
      expect(g.done).toBe(false);
    }
    steerGrains(g, 1);
    // Поверхность уже растаяла, а точки ещё гаснут: растворение отстаёт и идёт чуть дальше единицы.
    expect(g.flow).toBeLessThan(0.7);
    let left = 0;
    while (!g.done && left < 5) {
      stepGrains(g, DT);
      left += DT;
    }
    expect(g.done).toBe(true);
    expect(g.flow).toBeCloseTo(FLOW_END, 5);
    // Весь путь — около FLOW_TIME секунд с начала распада; после него не остаётся ничего.
    expect(0.9 + left).toBeGreaterThan(FLOW_TIME - 0.2);
    expect(0.9 + left).toBeLessThan(FLOW_TIME + 0.2);
  });

  it('вещь возвращается: облако проступает, точки встают на места — и облако больше не нужно', () => {
    const g = newGrainLife(0.98, true);
    expect(g.fade).toBe(0);
    // При сборке отставания нет: точка встаёт на место в тот миг, когда там нарастает зерно.
    expect(g.flow).toBe(0.98);
    for (let t = 0; t < RISE + 0.05; t += DT) stepGrains(g, DT);
    expect(g.fade).toBe(1);
    expect(g.done).toBe(false);
    for (let go = 0.98; go > 0; go -= DT / 0.9) {
      steerGrains(g, Math.max(0, go));
      stepGrains(g, DT);
    }
    steerGrains(g, 0);
    stepGrains(g, DT);
    expect(g.done).toBe(true);
  });

  it('вернулась, не успев раствориться: те же точки идут обратно; снова тронули — снова гаснут', () => {
    const g = newGrainLife(0.5, false);
    steerGrains(g, 0.8);
    for (let t = 0; t < 0.4; t += DT) stepGrains(g, DT);
    const mid = g.flow;
    expect(mid).toBeGreaterThan(0);
    steerGrains(g, 0.7);
    expect(g.coming).toBe(true);
    stepGrains(g, DT);
    expect(g.flow).toBe(0.7);
    expect(g.done).toBe(false);
    steerGrains(g, 0.9);
    expect(g.coming).toBe(false);
    stepGrains(g, DT);
    expect(g.done).toBe(false);
  });

  it('шейдер: точка не падает к полу и гаснет к концу пути', () => {
    // Россыпи на полу больше нет: у облака нет высоты пола, путь идёт от поверхности, а не вниз.
    expect(GRAIN_VERT).not.toContain('uFloorY');
    expect(GRAIN_VERT).not.toMatch(/pile/);
    // К концу пути точка полностью прозрачна; дошедшую до конца не рисуют вовсе.
    expect(GRAIN_VERT).toContain('(1.0 - smoothstep(0.1, 1.0, phi))');
    expect(GRAIN_VERT).toContain('if (phi >= 1.0) return;');
  });
});

describe('пыль выросшей вещи', () => {
  it('сеется по настоящей площади (× scale²), но не больше потолка вызывающего', () => {
    const sow = sowGrains;
    // Квадрат 1×1 м из двух треугольников.
    const data = {
      position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
      normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      color: new Float32Array(16).fill(1),
      mat: new Float32Array(4),
      index: new Uint32Array([0, 1, 2, 0, 2, 3]),
    } as unknown as Parameters<typeof sow>[0];
    const plain = sow(data, null, 1, 1);
    const grown = sow(data, null, 1, 49);
    const capped = sow(data, null, 1, 49, 9000);
    expect(plain.count).toBe(650);
    expect(grown.count).toBeGreaterThan(plain.count * 30);
    expect(capped.count).toBe(9000);
  });
});
