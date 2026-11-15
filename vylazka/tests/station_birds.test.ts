import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { MeshBuilder } from '../src/world/kit';
import { buildLevel, cellToWorld, tierFloor, TIE_DROP } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';

/** Зал ожидания второго ранга: те сиды, на которых его строят тесты игры. */
const SEEDS = [7, 20041113];
const levelOf = (seed: number) => buildLevel(generateLayout(seed, 2, 'station'));

describe('зал ожидания: насесты птиц', () => {
  for (const seed of SEEDS) {
    const level = levelOf(seed);
    const hall = level.layout!.rooms.filter((r) => r.type === 'concourse');
    const cells = hall.reduce((s, r) => s + r.cells.length, 0);

    it(`сид ${seed}: по три насеста на каждую клетку зала`, () => {
      expect(cells).toBeGreaterThan(0);
      expect(level.perches).toBeDefined();
      expect(level.perches!.length).toBe(cells * 3);
    });

    it(`сид ${seed}: все насесты внутри прямоугольника крыши`, () => {
      const [x0, z0, x1, z1] = level.roof!.box;
      for (const p of level.perches!) {
        expect(p.pos[0]).toBeGreaterThan(x0);
        expect(p.pos[0]).toBeLessThan(x1);
        expect(p.pos[2]).toBeGreaterThan(z0);
        expect(p.pos[2]).toBeLessThan(z1);
      }
    });

    it(`сид ${seed}: высота насеста — пол зала + 6,3 − TIE_DROP; затяжка висит ниже верха крыши`, () => {
      const floor = tierFloor(hall[0]!.tier);
      for (const p of level.perches!) expect(p.pos[1]).toBeCloseTo(floor + 6.3 - TIE_DROP, 6);
      // Крыша выше затяжек: насест не упирается в стекло.
      expect(level.roof!.y).toBeGreaterThan(floor + 6.3 - TIE_DROP);
    });

    it(`сид ${seed}: насесты стоят над клетками зала`, () => {
      const centres = hall.flatMap((r) => r.cells.map(([x, z]) => [cellToWorld(x), cellToWorld(z)] as const));
      for (const p of level.perches!) {
        const near = centres.some(([cx, cz]) => Math.abs(p.pos[0] - cx) < 1.5 && Math.abs(p.pos[2] - cz) < 1.5);
        expect(near).toBe(true);
      }
    });
  }

  it('в остальных мирах насестов нет', () => {
    expect(buildLevel(generateLayout(7, 2, 'office')).perches).toBeUndefined();
    expect(buildLevel(generateLayout(7, 2, 'shelter')).perches).toBeUndefined();
  });
});

describe('зал ожидания: следы птиц', () => {
  const level = levelOf(7);
  const names = (n: string) => (level.objects ?? []).filter((o) => o.name === n);

  it('четыре пера на полу — объекты уровня, их можно коснуться', () => {
    const feathers = names('feather');
    expect(feathers).toHaveLength(4);
    for (const o of feathers) {
      expect(o.solid).toBe(false);
      expect(o.min[1]).toBeLessThan(0.1);
    }
  });

  it('бумажные птицы под потолком объектами не становятся (потолочное не рассыпается: props_all.tracked)', () => {
    expect(names('paper_bird_hang')).toHaveLength(0);
  });

  it('бумажные птицы в сетке есть: у них ненулевые веса качания, свободный конец — у самой птицы', () => {
    // Одна птица отдельно: вес растёт от нити у потолка (0) к птице (gain = 1).
    const mb = new MeshBuilder();
    ALL_PROPS.paper_bird_hang!.build(new Xf(mb, null, 0, 6.3 - TIE_DROP, 0, 0), 2000);
    const one = mb.build();
    expect(one.sway).toBeDefined();
    const pos = one.sway!.filter((w) => w > 0).length;
    expect(pos).toBeGreaterThan(0);
    const top = Math.max(...one.sway!);
    expect(top).toBeGreaterThan(0.5);
    expect(top).toBeLessThanOrEqual(1 + 1e-6);
    // В уровне таких вершин не меньше, чем у трёх птиц (есть и другие висящие вещи).
    const inLevel = level.chunks.reduce((s, c) => s + (c.mesh.sway ? c.mesh.sway.filter((w) => w > 0).length : 0), 0);
    expect(inLevel).toBeGreaterThanOrEqual(3 * pos);
  });

  it('столбы зала — высокие узкие преграды под крышей: по ним стая узнаёт, что облетать', () => {
    // Объектами уровня столбы не числятся (st_column входит в FIXED, props_all.ts): игра ищет их среди
    // преград (game.setupBirds).
    const box = level.roof!.box;
    const cols = level.colliders.boxes.filter((c) => c.maxY - c.minY > 4 && c.maxX - c.minX < 1.4 && c.maxZ - c.minZ < 1.4 && c.minX > box[0] && c.maxX < box[2] && c.minZ > box[1] && c.maxZ < box[3]);
    expect(cols.length).toBe(4);
  });
});

describe('зал ожидания: окно кассы — обманка зала', () => {
  const level = levelOf(7);
  const rooms = level.layout!.rooms;

  it('в проекциях помещения кассы есть четырёхугольник стекла с оттенком окна-обманки', () => {
    const ticketRoom = rooms.find((r) => r.type === 'tickets')!;
    expect(ticketRoom).toBeDefined();
    // Куски уровня не подписаны комнатами; ищем среди всех проекций.
    const found: { quads: number; tints: number[][] } = { quads: 0, tints: [] };
    for (const c of level.chunks) {
      const s = c.slides;
      if (!s) continue;
      for (let v = 0; v + 3 < s.mat.length; v += 4) {
        if (![0, 1, 2, 3].every((k) => s.mat[v + k] === MAT.glass)) continue;
        found.quads += 1;
        found.tints.push([s.color[v * 4]!, s.color[v * 4 + 1]!, s.color[v * 4 + 2]!]);
      }
    }
    // Два окошка кассы.
    expect(found.quads).toBe(2);
    for (const t of found.tints) {
      expect(t[0]).toBeCloseTo(0.93, 2);
      expect(t[1]).toBeCloseTo(0.68, 2);
      expect(t[2]).toBeCloseTo(1.2, 2);
    }
  });
});
