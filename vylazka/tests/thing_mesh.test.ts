import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_PROPS } from '../src/world/props_all';
import { hasThing, setThingRegistry, thingMesh } from '../src/world/thing_mesh';
import type { MeshData } from '../src/world/kit';

/** Габаритный ящик сетки: min и max по осям. */
function bounds(m: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, m.position[i + a]!);
      max[a] = Math.max(max[a]!, m.position[i + a]!);
    }
  }
  return { min, max };
}

beforeAll(() => setThingRegistry(ALL_PROPS));

describe('сетка вещи', () => {
  const names = Object.keys(ALL_PROPS);

  it('в реестре есть и предметы убежища, и домашние вещи, и все вещи воспоминаний', async () => {
    expect(names.length).toBeGreaterThan(90);
    const { MEMORIES } = await import('../src/systems/session');
    for (const m of MEMORIES) expect(hasThing(m.thing), `нет предмета «${m.thing}» для воспоминания ${m.id}`).toBe(true);
  });

  it('каждый предмет собран вокруг начала координат: отцентрован по x и z в пределах допуска', () => {
    for (const name of names) {
      const t = thingMesh(name, 5);
      expect(t.mesh.index.length, name).toBeGreaterThan(0);
      const { min, max } = bounds(t.mesh);
      // Допуск: 0,15 м — у несимметричных предметов (лампа с абажуром, свисающие кабели) центр чуть смещён.
      expect(Math.abs((min[0]! + max[0]!) / 2), `${name}: центр по x`).toBeLessThan(0.15);
      expect(Math.abs((min[2]! + max[2]!) / 2), `${name}: центр по z`).toBeLessThan(0.15);
    }
  });

  it('стоит на y = 0; подвесное (под потолком) висит ниже своей высоты и не выходит выше неё', () => {
    for (const name of names) {
      const spec = ALL_PROPS[name]!;
      const t = thingMesh(name, 5);
      const { min, max } = bounds(t.mesh);
      if (spec.mount === 'ceiling') {
        expect(min[1]!, `${name}: подвесное не уходит под пол`).toBeGreaterThanOrEqual(-0.03);
        expect(max[1]!, `${name}: подвесное не выше своей высоты`).toBeLessThanOrEqual(spec.h + 0.03);
        // Крепится к потолку на своей высоте: верх сетки у верха габарита.
        expect(max[1]!, `${name}: подвесное крепится у верха`).toBeGreaterThan(spec.h * 0.5);
      } else {
        expect(Math.abs(min[1]!), `${name}: основание на y = 0`).toBeLessThan(0.06);
        expect(max[1]!, `${name}: не выше заявленной высоты`).toBeLessThanOrEqual(spec.h + 0.05);
        expect(max[1]!, `${name}: не ниже половины заявленной высоты`).toBeGreaterThan(spec.h * 0.5);
      }
    }
  });

  it('габариты в описании сходятся с геометрией; радиус взгляда — не меньше 0,22 м', () => {
    for (const name of names) {
      const spec = ALL_PROPS[name]!;
      const t = thingMesh(name, 5);
      const { min, max } = bounds(t.mesh);
      expect(max[0]! - min[0]!, `${name}: ширина`).toBeLessThanOrEqual(spec.w + 0.1);
      expect(max[2]! - min[2]!, `${name}: глубина`).toBeLessThanOrEqual(spec.d + 0.1);
      expect([t.w, t.d, t.h]).toEqual([spec.w, spec.d, spec.h]);
      expect(t.radius, name).toBeGreaterThanOrEqual(0.22);
    }
  });

  it('сетка собирается при любом сиде, без NaN и бесконечностей', () => {
    for (const name of names) {
      for (const seed of [0, 1, 4294967295]) {
        const { min, max } = bounds(thingMesh(name, seed).mesh);
        expect(Number.isFinite(min[0]! + max[2]!), `${name}/${seed}`).toBe(true);
      }
    }
  });

  it('незнакомое имя даёт болванку-кубик на полу: игра не падает', () => {
    expect(hasThing('no_such_thing')).toBe(false);
    const t = thingMesh('no_such_thing', 1);
    expect(t.mesh.index.length).toBeGreaterThan(0);
    const { min, max } = bounds(t.mesh);
    expect(min[1]).toBeCloseTo(0, 2);
    expect(max[1]).toBeCloseTo(0.26, 2);
    expect((min[0]! + max[0]!) / 2).toBeCloseTo(0, 5);
    expect((min[2]! + max[2]!) / 2).toBeCloseTo(0, 5);
    expect(t.radius).toBeGreaterThanOrEqual(0.22);
  });
});
