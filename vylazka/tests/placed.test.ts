import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';
import { placeable, placedProblems } from '../src/world/placed';
import type { PlacedSpec } from '../src/world/placed';
import { HEADROOM, placeThings, roomDoors, rotOf, throatBox, worldBox } from '../src/world/placed_place';
import type { Box } from '../src/world/placed_place';
import { ALL_PROPS, FIXED } from '../src/world/props_all';

const spec = (over: Partial<PlacedSpec> = {}, rule: Partial<PlacedSpec['rule']> = {}): PlacedSpec => ({
  id: 'pl_test',
  name: 'Стул у стены',
  prop: 'kk_chair_a',
  rule: { worlds: ['office'], rooms: [], anchor: 'wall', facing: 'room', lift: 0, count: 2, ...rule },
  turn: 0,
  offset: [0, -0.25],
  ...over,
});

const overlap = (a: Box, b: Box): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ && a.minY < b.maxY && a.maxY > b.minY;

describe('расстановка партнёра: данные', () => {
  it('годная расстановка проходит проверку', () => {
    expect(placedProblems(spec(), ALL_PROPS, FIXED)).toEqual([]);
  });

  it('ловит чужое: ключ, вещь, поворот, сдвиг, высоту, число', () => {
    expect(placedProblems(spec({ id: 'Плохо' }), ALL_PROPS, FIXED).join()).toContain('ключ');
    expect(placedProblems(spec({ prop: 'no_such_thing' }), ALL_PROPS, FIXED).join()).toContain('такой нет');
    expect(placedProblems(spec({ turn: 4 as 0 }), ALL_PROPS, FIXED).join()).toContain('поворот');
    expect(placedProblems(spec({ offset: [0, 4] }), ALL_PROPS, FIXED).join()).toContain('сдвиг');
    expect(placedProblems(spec({}, { lift: 3 }), ALL_PROPS, FIXED).join()).toContain('высота');
    expect(placedProblems(spec({}, { count: 0 }), ALL_PROPS, FIXED).join()).toContain('сколько');
    expect(placedProblems(spec({}, { worlds: [] }), ALL_PROPS, FIXED).join()).toContain('места');
  });

  it('руками не ставят то, что держит место, и подвесное', () => {
    const fixedName = [...FIXED].find((n) => ALL_PROPS[n]);
    expect(fixedName).toBeDefined();
    expect(placeable(fixedName!, ALL_PROPS[fixedName!]!, FIXED)).toBe(false);
    const ceiling = Object.entries(ALL_PROPS).find(([, p]) => p.mount === 'ceiling');
    if (ceiling) expect(placeable(ceiling[0], ceiling[1], FIXED)).toBe(false);
    expect(placeable('kk_chair_a', ALL_PROPS.kk_chair_a!, FIXED)).toBe(true);
  });

  it('поворот четвертями — тот же, что у Xf: 1 — лицом к +x, 3 — к −x', () => {
    expect(rotOf(0)).toBe(0);
    expect(rotOf(Math.PI / 2)).toBe(1);
    expect(rotOf(Math.PI)).toBe(2);
    expect(rotOf(-Math.PI / 2)).toBe(3);
    expect(rotOf(Math.PI * 2 + 0.1)).toBe(0);
  });
});

describe('расстановка партнёра: на уровне', () => {
  const build = (world: WorldKind, placed: readonly PlacedSpec[], seed = 20041113) => buildLevel(generateLayout(seed, 2, world), { wear: 0, placed, figures: [], keepPlaceWorld: true });

  it('вещь встаёт сколько просили, в разных помещениях, и становится обстановкой', () => {
    const lvl = build('office', [spec()]);
    const spots = lvl.placed ?? [];
    expect(spots.length).toBe(2);
    expect(new Set(spots.map((s) => s.room)).size).toBe(2);
    for (const s of spots) {
      // Объект уровня с этим именем стоит там, где встала вещь.
      const obj = (lvl.objects ?? []).find((o) => o.name === 'kk_chair_a' && Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) < 0.01);
      expect(obj, JSON.stringify(s)).toBeDefined();
    }
  });

  it('не врастает в мебель, не перекрывает проходы, помещается под потолком', () => {
    for (const world of ['shelter', 'office', 'station'] as WorldKind[]) {
      const lvl = build(world, [spec({}, { worlds: [world], count: 3 }), spec({ id: 'pl_corner', prop: 'kk_stool' }, { worlds: [world], anchor: 'corner', count: 3 })]);
      for (const s of lvl.placed ?? []) {
        const p = ALL_PROPS[s.prop]!;
        const box = worldBox(p, s.at, s.rot);
        const room = lvl.layout!.rooms[s.room]!;
        const floor = s.at[1];
        const roomFloor = lvl.placeWorld!.shells[room.tier]!.get(room.cells[0]![0] - 8, room.cells[0]![1] - 8)!.floorY;
        if (floor - roomFloor < HEADROOM) for (const d of roomDoors(room, lvl.placeWorld!)) expect(overlap(box, throatBox(d, roomFloor))).toBe(false);
      }
      // Две разные расстановки друг в друга не встают.
      const all = (lvl.placed ?? []).map((s) => worldBox(ALL_PROPS[s.prop]!, s.at, s.rot));
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]!, all[j]!)).toBe(false);
    }
  });

  it('у стены «лицом в комнату» вещь стоит спиной к стене', () => {
    const lvl = build('office', [spec({ offset: [0, -0.27] }, { count: 1 })]);
    const s = lvl.placed![0]!;
    const box = worldBox(ALL_PROPS[s.prop]!, s.at, s.rot);
    // Спина — на линии at; коробка уходит от неё в сторону «лица».
    const face: Record<number, [number, number]> = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };
    const [fx, fz] = face[s.rot]!;
    const cx = (box.minX + box.maxX) / 2 - s.at[0];
    const cz = (box.minZ + box.maxZ) / 2 - s.at[2];
    expect(cx * fx + cz * fz).toBeGreaterThan(0.1);
  });

  it('в проёме низкая вещь не встаёт: проход остаётся свободным', () => {
    const lvl = build('shelter', [spec({ id: 'pl_door' }, { worlds: ['shelter'], anchor: 'door', count: 3 })]);
    expect(lvl.placed ?? []).toEqual([]);
  });

  it('тот же сид — те же места; новая расстановка не сдвигает прежнюю', () => {
    const a = build('office', [spec()]).placed;
    const b = build('office', [spec()]).placed;
    expect(b).toEqual(a);
    const c = build('office', [spec(), spec({ id: 'pl_other', prop: 'kk_stool' })]).placed!.filter((s) => s.id === 'pl_test');
    expect(c).toEqual(a);
  });

  it('вещи нет в месте, которого нет в правиле', () => {
    const lvl = build('shelter', [spec()]);
    expect(lvl.placed ?? []).toEqual([]);
  });

  it('прямо через placeThings: неизвестная вещь пропускается', () => {
    const layout = generateLayout(7, 2, 'office');
    const lvl = buildLevel(layout, { wear: 0, figures: [], placed: [], keepPlaceWorld: true });
    const spots = placeThings([spec({ prop: 'no_such_thing' })], lvl.placeWorld!, ALL_PROPS);
    expect(spots).toEqual([]);
  });
});
