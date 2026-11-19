import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';
import type { BuiltLevel } from '../src/world/level';
import type { LevelObject } from '../src/world/objects';
import { placeable, placedProblems, removedProblems } from '../src/world/placed';
import type { PlacedSpec, RemovedSpec } from '../src/world/placed';
import { checkSpot, fitThing, gameNth, HEADROOM, moveSpot, NEVER, placeThings, REST_REACH, restTop, rests, roomDoors, roomIndex, roomNear, rotOf, throatBox, worldBox } from '../src/world/placed_place';
import type { AnchorSpot } from '../src/world/figure_place';
import type { Vec3 } from '../src/core/types';
import { anchorSpots } from '../src/world/figure_place';
import type { Box } from '../src/world/placed_place';
import { ALL_PROPS, FIXED } from '../src/world/props_all';
import { variantPicker } from '../src/world/variants';

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

  it('дверцы (квиз 18.11): поля нет — как выпадет; закрыто или открыто — да; другое — беда', () => {
    expect(placedProblems(spec({ open: 'shut' }), ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems(spec({ open: 'open' }), ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems(spec({ open: 'ajar' as 'open' }), ALL_PROPS, FIXED).join()).toContain('дверцы');
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

describe('замена вещей игры (квиз 17.11: «Заменять»)', () => {
  const office = () => buildLevel(generateLayout(20041113, 2, 'office'), { wear: 0, figures: [], placed: [] });

  it('проверка данных: замена — существующая вещь игры с той же опорой и не крупнее с запасом', () => {
    const base = spec({ replaces: 'kk_chair_a', prop: 'kk_stool' });
    expect(placedProblems(base, ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems({ ...base, replaces: 'no_such' }, ALL_PROPS, FIXED).join()).toContain('замена');
    const wallProp = Object.entries(ALL_PROPS).find(([n, p]) => p.mount === 'wall' && !FIXED.has(n))![0];
    expect(placedProblems({ ...base, replaces: wallProp }, ALL_PROPS, FIXED).join()).toContain('не встанет');
  });

  it('вещь игры уступает место вещи партнёра: там же, так же повёрнута, не больше count', () => {
    const plain = office();
    const count = new Map<string, number>();
    for (const o of plain.objects ?? []) count.set(o.name, (count.get(o.name) ?? 0) + 1);
    // Самая частая напольная вещь офиса, на место которой встаёт табурет.
    const target = [...count.entries()]
      .filter(([n]) => ALL_PROPS[n] && !FIXED.has(n) && ALL_PROPS[n]!.mount !== 'wall' && ALL_PROPS[n]!.mount !== 'ceiling' && ALL_PROPS[n]!.w >= 0.4 && ALL_PROPS[n]!.d >= 0.4)
      .sort((a, b) => b[1] - a[1])[0]!;
    const [name, before] = target;
    expect(before).toBeGreaterThan(1);
    const swapped = buildLevel(generateLayout(20041113, 2, 'office'), { wear: 0, figures: [], placed: [spec({ id: 'pl_swap', replaces: name, prop: 'kk_stool' }, { count: 2 })] });
    const after = (swapped.objects ?? []).filter((o) => o.name === name).length;
    const stools = (swapped.objects ?? []).filter((o) => o.name === 'kk_stool');
    const plainStools = (plain.objects ?? []).filter((o) => o.name === 'kk_stool').length;
    expect(stools.length - plainStools).toBe(2);
    expect(before - after).toBe(2);
    // Хотя бы одна новая вещь стоит там, где стояла заменённая, и так же повёрнута.
    const olds = (plain.objects ?? []).filter((o) => o.name === name);
    const hit = stools.some((s) => olds.some((o) => o.rot === s.rot && Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) < 0.6));
    expect(hit).toBe(true);
  });

  it('замена «везде» (куратор, пачка 41, 239): проверка — только у замены и только да/нет', () => {
    const base = spec({ replaces: 'kk_chair_a', prop: 'kk_stool' });
    expect(placedProblems({ ...base, everywhere: true }, ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems({ ...base, everywhere: 'да' }, ALL_PROPS, FIXED).join()).toContain('везде');
    expect(placedProblems({ ...spec(), everywhere: true }, ALL_PROPS, FIXED).join()).toContain('только у замены');
  });

  it('замена «везде»: каждая такая вещь игры во всех помещениях, без счёта и мимо мест правила; «здесь» в своих помещениях важнее', () => {
    const layout = (): ReturnType<typeof generateLayout> => generateLayout(20041113, 2, 'office');
    const plain = office();
    const count = new Map<string, number>();
    for (const o of plain.objects ?? []) if (!o.flat) count.set(o.name, (count.get(o.name) ?? 0) + 1);
    const target = [...count.entries()]
      .filter(([n]) => ALL_PROPS[n] && !FIXED.has(n) && ALL_PROPS[n]!.mount === 'floor' && ALL_PROPS[n]!.w >= 0.4 && ALL_PROPS[n]!.d >= 0.4)
      .sort((a, b) => b[1] - a[1])[0]!;
    const [name, before] = target;
    expect(before).toBeGreaterThan(3);
    const stoolsIn = (l: ReturnType<typeof office>): number => (l.objects ?? []).filter((o) => o.name === 'kk_stool').length;
    const left = (l: ReturnType<typeof office>): number => (l.objects ?? []).filter((o) => o.name === name && !o.flat).length;
    // Правило записи — про убежище и одну штуку: «везде» его не слушает.
    const all = spec({ id: 'pl_all', replaces: name, prop: 'kk_stool', everywhere: true }, { worlds: ['shelter'], rooms: ['kitchen'], count: 1 });
    const swapped = buildLevel(layout(), { wear: 0, figures: [], placed: [all] });
    expect(left(swapped)).toBe(0);
    expect(stoolsIn(swapped) - stoolsIn(plain)).toBe(before);
    // Рядом замена «здесь» той же вещи на другую — в своих помещениях берёт своё (до count), остальное — «везде».
    const first = (plain.objects ?? []).find((o) => o.name === name && !o.flat)!;
    const type = roomIndex(plain.layout!)(first.at[0], first.at[1], first.at[2])?.type;
    expect(type).toBeDefined();
    const here = spec({ id: 'pl_here', replaces: name, prop: 'kk_chair_b' }, { worlds: ['office'], rooms: [type!], count: 1 });
    const both = buildLevel(layout(), { wear: 0, figures: [], placed: [all, here] });
    const chairs = (both.objects ?? []).filter((o) => o.name === 'kk_chair_b').length - (plain.objects ?? []).filter((o) => o.name === 'kk_chair_b').length;
    expect(chairs).toBe(1);
    expect(left(both)).toBe(0);
    expect(stoolsIn(both) - stoolsIn(plain)).toBe(before - 1);
  });
});

// ───────────────── вещи игры: убрать и передвинуть (партнёр 17.11, 19:15) ─────────────────

const removedSpec = (over: Partial<RemovedSpec> = {}): RemovedSpec => ({
  id: 'rm_test',
  name: 'Шкаф — убран',
  what: { thing: 'filing_cabinet', nth: 0 },
  worlds: ['office'],
  rooms: ['files'],
  ...over,
});
/** Точка объекта — ключ для сравнения уровней (номера объектов после убранной вещи сдвигаются). */
const where = (o: Pick<LevelObject, 'name' | 'at' | 'rot'>): string => `${o.name}@${o.at.map((v) => v.toFixed(3)).join(',')}/${o.rot}`;
/** Сколько объектов в каждой точке. */
const census = (objs: readonly LevelObject[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const o of objs) m.set(where(o), (m.get(where(o)) ?? 0) + 1);
  return m;
};

describe('вещи игры, убранные и передвинутые: данные', () => {
  it('убранная: годная проходит; ловит ключ, имя, вещь, номер, места, помещения', () => {
    expect(removedProblems(removedSpec(), ALL_PROPS, FIXED)).toEqual([]);
    expect(removedProblems(removedSpec({ id: 'Плохо' }), ALL_PROPS, FIXED).join()).toContain('ключ');
    expect(removedProblems(removedSpec({ name: ' ' }), ALL_PROPS, FIXED).join()).toContain('имя');
    expect(removedProblems(removedSpec({ what: { thing: 'no_such', nth: 0 } }), ALL_PROPS, FIXED).join()).toContain('такой нет');
    const fixedName = [...FIXED].find((n) => ALL_PROPS[n])!;
    expect(removedProblems(removedSpec({ what: { thing: fixedName, nth: 0 } }), ALL_PROPS, FIXED).join()).toContain('не убирают');
    const ceiling = Object.entries(ALL_PROPS).find(([, p]) => p.mount === 'ceiling')![0];
    expect(removedProblems(removedSpec({ what: { thing: ceiling, nth: 0 } }), ALL_PROPS, FIXED).join()).toContain('не убирают');
    expect(removedProblems(removedSpec({ what: { thing: 'filing_cabinet', nth: 32 } }), ALL_PROPS, FIXED).join()).toContain('номер');
    expect(removedProblems(removedSpec({ what: { thing: 'filing_cabinet', nth: 0.5 } }), ALL_PROPS, FIXED).join()).toContain('номер');
    expect(removedProblems(removedSpec({ worlds: [] }), ALL_PROPS, FIXED).join()).toContain('места');
    expect(removedProblems(removedSpec({ rooms: ['Кухня'] }), ALL_PROPS, FIXED).join()).toContain('помещения');
    expect(removedProblems(null, ALL_PROPS, FIXED)).toEqual(['не объект']);
  });

  it('передвинутая: та же вещь, что двигают, её можно ставить руками, номер 0–31, не вместе с заменой', () => {
    const moved = spec({ prop: 'filing_cabinet', moves: { thing: 'filing_cabinet', nth: 1 } });
    expect(placedProblems(moved, ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems({ ...moved, moves: { thing: 'kk_stool', nth: 1 } }, ALL_PROPS, FIXED).join()).toContain('та же, что двигают');
    expect(placedProblems({ ...moved, moves: { thing: 'filing_cabinet', nth: -1 } }, ALL_PROPS, FIXED).join()).toContain('номер');
    expect(placedProblems({ ...moved, moves: { thing: 'filing_cabinet', nth: 40 } }, ALL_PROPS, FIXED).join()).toContain('номер');
    expect(placedProblems({ ...moved, moves: { thing: 'no_such', nth: 0 } }, ALL_PROPS, FIXED).join()).toContain('такой вещи игры нет');
    const fixedName = [...FIXED].find((n) => ALL_PROPS[n])!;
    expect(placedProblems({ ...moved, prop: fixedName, moves: { thing: fixedName, nth: 0 } }, ALL_PROPS, FIXED).join()).toContain('руками не двигают');
    expect(placedProblems({ ...moved, replaces: 'kk_chair_a' }, ALL_PROPS, FIXED).join()).toContain('одно из двух');
    expect(placedProblems({ ...moved, moves: 'шкаф' }, ALL_PROPS, FIXED).join()).toContain('какая вещь игры');
  });
});

describe('вещи игры, убранные и передвинутые: на уровне', () => {
  const layout = generateLayout(20041113, 2, 'office');
  const make = (placed: readonly PlacedSpec[] = [], removed: readonly RemovedSpec[] = []): BuiltLevel => buildLevel(layout, { wear: 0, figures: [], placed, removed, keepPlaceWorld: true });
  const plain = make();
  const roomAt = roomIndex(layout);
  const roomOf = (o: Pick<LevelObject, 'at'>) => roomAt(o.at[0], o.at[1], o.at[2]);
  /** Вещи X в помещениях: номер помещения → объекты в порядке сборки. */
  const byRoom = (lvl: BuiltLevel, x: string): Map<number, LevelObject[]> => {
    const m = new Map<number, LevelObject[]>();
    for (const o of lvl.objects ?? []) {
      const r = roomOf(o);
      if (o.name !== x || !r) continue;
      m.set(r.id, [...(m.get(r.id) ?? []), o]);
    }
    return m;
  };

  it('без записей уровень тот же, что с пустыми списками', () => {
    const def = buildLevel(layout, { wear: 0, figures: [], keepPlaceWorld: true });
    expect(census(def.objects ?? [])).toEqual(census(plain.objects ?? []));
  });

  it('убранная: в каждом помещении типа — на одну меньше, пропала первая по порядку сборки; в других помещениях — как было', () => {
    const X = 'filing_cabinet';
    const T = 'files';
    const before = byRoom(plain, X);
    const inT = [...before.keys()].filter((id) => layout.rooms[id]!.type === T);
    const elsewhere = [...before.keys()].filter((id) => layout.rooms[id]!.type !== T);
    expect(inT.length).toBeGreaterThan(1);
    expect(elsewhere.length).toBeGreaterThan(0);
    const after = byRoom(make([], [removedSpec()]), X);
    for (const id of inT) {
      const was = before.get(id)!;
      const now = after.get(id) ?? [];
      expect(now.length).toBe(was.length - 1);
      // Пропала именно первая по порядку сборки: остальные стоят, где стояли.
      expect(now.map(where).sort()).toEqual(was.slice(1).map(where).sort());
    }
    for (const id of elsewhere) expect((after.get(id) ?? []).map(where)).toEqual(before.get(id)!.map(where));
    // Номер больше числа таких вещей — ничего не меняется.
    const most = Math.max(...[...before.values()].map((l) => l.length));
    const none = make([], [removedSpec({ what: { thing: X, nth: most } })]);
    expect(census(none.objects ?? [])).toEqual(census(plain.objects ?? []));
  });

  it('номер в инструменте = номер в игре: убранная по номеру из объектов уровня пропадает ровно там', () => {
    const objs = plain.objects ?? [];
    // По одной вещи разных имён с номером больше нуля (среди них — картонка, если есть): номер считается как в конструкторе.
    const picks: LevelObject[] = [];
    for (const o of objs) {
      if (!placeable(o.name, ALL_PROPS[o.name]!, FIXED) || o.name.startsWith('display_') || !roomOf(o)) continue;
      if (gameNth(objs, o, roomAt) < 1 || picks.some((p) => p.name === o.name)) continue;
      if (picks.length < 3 || (o.flat && !picks.some((p) => p.flat))) picks.push(o);
    }
    expect(picks.length).toBeGreaterThanOrEqual(3);
    for (const o of picks) {
      const nth = gameNth(objs, o, roomAt);
      const type = roomOf(o)!.type;
      const lvl = make([], [removedSpec({ what: { thing: o.name, nth }, rooms: [type] })]);
      // Пропадают ровно вещи этого имени с этим номером в помещениях этого типа; остальные такие — на месте.
      const gone = objs.filter((q) => q.name === o.name && roomOf(q)?.type === type && gameNth(objs, q, roomAt) === nth);
      expect(gone.map(where)).toContain(where(o));
      const want = census(objs.filter((q) => q.name === o.name && !gone.includes(q)));
      expect(census((lvl.objects ?? []).filter((q) => q.name === o.name)), `${o.name} №${nth}`).toEqual(want);
    }
  });

  it('варианты (квиз 17.11, ночь: «Свой вариант на каждую»): убранная варианта пропадает только там, где выпал её вариант; два варианта делят помещения', () => {
    const X = 'filing_cabinet';
    const T = 'files';
    const before = byRoom(plain, X);
    const inT = [...before.keys()].filter((id) => layout.rooms[id]!.type === T);
    expect(inT.length).toBeGreaterThan(1);
    const pick = variantPicker(layout, [`${T}.0`, `${T}.3`]);
    const got = new Set(inT.map((id) => pick(layout.rooms[id]!)));
    // Жребий повторяем и делит помещения типа между вариантами (на этом сиде достаются оба).
    expect([...got].every((v) => v === `${T}.0` || v === `${T}.3`)).toBe(true);
    expect(got.size).toBe(2);
    expect(inT.map((id) => pick(layout.rooms[id]!))).toEqual(inT.map((id) => variantPicker(layout, [`${T}.3`, `${T}.0`])(layout.rooms[id]!)));
    // Убранная во втором варианте и пустой первый вариант (манекен-заглушка не нужен: вариант задаёт любая запись типа).
    const only3 = removedSpec({ slot: `${T}.3` });
    const blank0 = removedSpec({ id: 'rm_blank', what: { thing: X, nth: 40 }, slot: `${T}.0` });
    const after = byRoom(make([], [only3, blank0]), X);
    for (const id of inT) {
      const was = before.get(id)!.length;
      const now = (after.get(id) ?? []).length;
      expect(now, `помещение ${id}: вариант ${pick(layout.rooms[id]!)}`).toBe(pick(layout.rooms[id]!) === `${T}.3` ? was - 1 : was);
    }
    // Один вариант на тип — все помещения типа получают его, как было до вариантов.
    const one = byRoom(make([], [only3]), X);
    for (const id of inT) expect((one.get(id) ?? []).length).toBe(before.get(id)!.length - 1);
  });

  it('варианты: запись до вариантов — первый вариант своего типа; общая (на любые помещения) — везде, кроме вещи, которую выпавший вариант трогает сам', () => {
    const X = 'filing_cabinet';
    const T = 'files';
    const before = byRoom(plain, X);
    const inT = [...before.keys()].filter((id) => layout.rooms[id]!.type === T);
    const pick = variantPicker(layout, [`${T}.0`, `${T}.1`]);
    // Старая (без варианта) убирает первую такую везде; вариант 1 вместо этого убирает вторую; вариант 0 ничего не трогает.
    const old = removedSpec({ id: 'rm_old' });
    const v1 = removedSpec({ id: 'rm_v1', what: { thing: X, nth: 0 }, slot: `${T}.1` });
    const v0 = removedSpec({ id: 'rm_v0', what: { thing: X, nth: 40 }, slot: `${T}.0` });
    const after = byRoom(make([], [old, v1, v0]), X);
    for (const id of inT) {
      // В обоих вариантах пропадает ровно одна: в варианте 1 — его собственная запись перекрыла старую (та же вещь), в 0 — старая.
      expect((after.get(id) ?? []).length, `помещение ${id}: ${pick(layout.rooms[id]!)}`).toBe(before.get(id)!.length - 1);
    }
    // Общая — на любые помещения: в варианте 1 её вещь убирает сам вариант (та же вещь), в остальных — она.
    const general = removedSpec({ id: 'rm_general', rooms: [] });
    const both = byRoom(make([], [general, v1]), X);
    for (const id of inT) expect((both.get(id) ?? []).length, `помещение ${id}`).toBe(before.get(id)!.length - 1);
    expect(removedProblems({ ...old, slot: 'files.x' }, ALL_PROPS, FIXED).join()).toContain('вариант');
    expect(placedProblems({ ...spec(), slot: 'kitchen' }, ALL_PROPS, FIXED).join()).toContain('вариант');
    expect(placedProblems({ ...spec(), slot: 'kitchen.2' }, ALL_PROPS, FIXED)).toEqual([]);
  });

  it('передвинутая: такая же вещь в том же помещении, по правилу, не в проходе и не в мебели', () => {
    const X = 'filing_cabinet';
    const T = 'cubicles';
    const move = spec({ id: 'pl_move', prop: X, moves: { thing: X, nth: 1 }, offset: [0, -0.29] }, { worlds: ['office'], rooms: [T], anchor: 'wall', count: 1 });
    expect(placedProblems(move, ALL_PROPS, FIXED)).toEqual([]);
    // Несколько планов: где места по правилу нет (стены заняты), вещь стоит, где поставила игра; где есть — переехала.
    let movedAll = 0;
    for (const seed of [20041113, 7, 42, 1234]) {
      const lay = generateLayout(seed, 2, 'office');
      const at = roomIndex(lay);
      const by = (l: BuiltLevel): Map<number, LevelObject[]> => {
        const m = new Map<number, LevelObject[]>();
        for (const o of l.objects ?? []) {
          const r = at(o.at[0], o.at[1], o.at[2]);
          if (o.name === X && r) m.set(r.id, [...(m.get(r.id) ?? []), o]);
        }
        return m;
      };
      const before = by(buildLevel(lay, { wear: 0, figures: [], keepPlaceWorld: true }));
      const lvl = buildLevel(lay, { wear: 0, figures: [], placed: [move], keepPlaceWorld: true });
      const after = by(lvl);
      const rooms = [...before.keys()].filter((id) => lay.rooms[id]!.type === T && before.get(id)!.length > 1);
      const moved = (lvl.placed ?? []).filter((q) => q.moved);
      movedAll += moved.length;
      for (const id of rooms) {
        expect(after.get(id)!.length).toBe(before.get(id)!.length);
        const now = after.get(id)!.map(where);
        const s = moved.find((q) => q.room === id);
        if (!s) {
          expect(now, `${seed}, помещение ${id}: места нет — как было`).toEqual(before.get(id)!.map(where));
          continue;
        }
        // Первая такая — на месте; вторая — переехала: её прежней точки больше нет.
        expect(now).toContain(where(before.get(id)![0]!));
        expect(now).not.toContain(where(before.get(id)![1]!));
        const room = lay.rooms[id]!;
        expect(at(s.at[0], s.at[1], s.at[2])?.id).toBe(id);
        const box = worldBox(ALL_PROPS[X]!, s.at, s.rot);
        const floor = lvl.placeWorld!.shells[room.tier]!.get(room.cells[0]![0] - 8, room.cells[0]![1] - 8)!.floorY;
        for (const d of roomDoors(room, lvl.placeWorld!)) expect(overlap(box, throatBox(d, floor))).toBe(false);
        // Не врастает в мебель: преграды чужих объектов её коробку не задевают.
        const self = (lvl.objects ?? []).find((o) => o.name === X && Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) < 0.01)!;
        expect(self).toBeDefined();
        const skin = 0.03;
        const hit = lvl.colliders.boxes.some((b) => b.owner !== self.id && !b.off && b.maxY > floor + 0.02 && box.minX < b.maxX - skin && box.maxX > b.minX + skin && box.minZ < b.maxZ - skin && box.maxZ > b.minZ + skin && box.minY < b.maxY - skin && box.maxY > b.minY + skin);
        expect(hit).toBe(false);
      }
      // В помещениях других типов — как было.
      for (const [id, list] of before) if (lay.rooms[id]!.type !== T) expect(after.get(id)!.map(where)).toEqual(list.map(where));
    }
    expect(movedAll, 'хоть где-то переехала').toBeGreaterThan(0);
  });

  it('near: из свободных краёв правила берётся тот, где вещь отпустили (агент конструктора, 17.11)', () => {
    const pw = plain.placeWorld!;
    const X = 'filing_cabinet';
    const p = ALL_PROPS[X]!;
    const base = spec({ id: 'pl_near', prop: X, moves: { thing: X, nth: 0 }, offset: [0, -0.29] }, { worlds: ['office'], rooms: [], anchor: 'wall', count: 1 });
    let checked = 0;
    for (const room of layout.rooms) {
      if (NEVER.has(room.type) || pw.skip.has(room.id)) continue;
      const valid = anchorSpots(room, 'wall', pw).filter((a) => {
        const { at, rot } = fitThing(base, a, p);
        return checkSpot(p, at, rot, room, a, pw, []).problems.length === 0;
      });
      if (valid.length < 2) continue;
      // Куда бы её ни отпустили — у свободного края, — там она и встаёт.
      for (const target of valid) {
        const got = moveSpot({ ...base, near: roomNear(room, target.x, target.z) }, room, pw, ALL_PROPS);
        expect(got).not.toBeNull();
        const want = fitThing(base, target, p).at;
        expect(Math.hypot(got!.spot.at[0] - want[0], got!.spot.at[2] - want[2])).toBeLessThan(0.05);
      }
      if (++checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
    expect(placedProblems({ ...base, near: [0.2, 1.4] }, ALL_PROPS, FIXED).join()).toContain('где в помещении');
  });

  it('передвинутая без места по правилу стоит, где поставила игра', () => {
    const X = 'filing_cabinet';
    // В проёме низкая вещь не встаёт никогда: проход остаётся свободным.
    const move = spec({ id: 'pl_nowhere', prop: X, moves: { thing: X, nth: 0 } }, { worlds: ['office'], rooms: ['files'], anchor: 'door', count: 1 });
    const lvl = make([move]);
    expect((lvl.placed ?? []).filter((s) => s.moved)).toEqual([]);
    // Те же точки, что без записи; картонка, которую двигали, возвращается на своё место настоящей вещью.
    const objs = plain.objects ?? [];
    const moving = (o: LevelObject): boolean => roomOf(o)?.type === 'files' && gameNth(objs, o, roomAt) === 0;
    expect(census((lvl.objects ?? []).filter((o) => o.name === X))).toEqual(census(objs.filter((o) => o.name === X)));
    expect(census((lvl.objects ?? []).filter((o) => o.name === X && !o.flat))).toEqual(census(objs.filter((o) => o.name === X && (!o.flat || moving(o)))));
  });

  it('тот же сид — та же расстановка; новая запись не сдвигает передвинутую', () => {
    const move = spec({ id: 'pl_move', prop: 'filing_cabinet', moves: { thing: 'filing_cabinet', nth: 1 }, offset: [0, -0.29] }, { worlds: ['office'], rooms: ['cubicles'], anchor: 'wall', count: 1 });
    const a = make([move]).placed;
    expect(make([move]).placed).toEqual(a);
    const b = make([move], [removedSpec({ id: 'rm_other', what: { thing: 'water_cooler', nth: 0 }, rooms: ['corridor'] })]).placed;
    expect(b).toEqual(a);
  });
});

describe('поднятая вещь ложится на то, что под ней (квиз 19.11)', () => {
  const stool = ALL_PROPS.kk_stool!;
  const obj = (id: number, min: Vec3, max: Vec3, flat = false): LevelObject => ({ id, name: 'kitchen_table', at: [min[0], min[1], min[2]], rot: 0, min, max, solid: true, flat });
  // Большой «стол»: под серединой вещи при любом её устройстве.
  const table = obj(1, [-5, 0, -5], [5, 0.8, 5]);
  const w = { objects: [table] };

  it('данные: «висит» — да или нет', () => {
    expect(placedProblems(spec({ hang: true }), ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems(spec({ hang: 'да' as unknown as boolean }), ALL_PROPS, FIXED).join()).toContain('висит');
  });

  it('кто ложится: поднятая, без «висит», не на стене и не под потолком', () => {
    expect(rests(spec({}, { lift: 0.8 }), stool)).toBe(true);
    expect(rests(spec({}, { lift: 0 }), stool)).toBe(false);
    expect(rests(spec({ hang: true }, { lift: 0.8 }), stool)).toBe(false);
    expect(rests(spec({}, { lift: 0.8, anchor: 'ceiling' }), stool)).toBe(false);
    expect(rests(spec({ prop: 'radiator' }, { lift: 0.12 }), ALL_PROPS.radiator!)).toBe(false);
  });

  it('опора: верх под серединой не выше низа + запас; ниже стола — пол; не над столом — пол; скрытое и картонка — не опора', () => {
    expect(restTop(stool, [0, 0.8, 0], 0, 0, w).y).toBeCloseTo(0.8);
    // Стол в другой комнате повыше — всё равно ловит.
    expect(restTop(stool, [0, 0.8 - REST_REACH + 0.05, 0], 0, 0, w).y).toBeCloseTo(0.8);
    // Поднята высоко над столом — опускается на него.
    expect(restTop(stool, [0, 1.9, 0], 0, 0, w).y).toBeCloseTo(0.8);
    expect(restTop(stool, [0, 1.9, 0], 0, 0, w).under?.id).toBe(1);
    // Под столешницей — на пол.
    expect(restTop(stool, [0, 0.3, 0], 0, 0, w).y).toBe(0);
    expect(restTop(stool, [20, 0.8, 20], 0, 0, w).y).toBe(0);
    expect(restTop(stool, [0, 0.8, 0], 0, 0, { ...w, objectGone: () => true }).y).toBe(0);
    expect(restTop(stool, [0, 0.8, 0], 0, 0, { objects: [obj(2, [-5, 0, -5], [5, 0.8, 5], true)] }).y).toBe(0);
    // Уже поставленная вещь партнёра — тоже опора.
    expect(restTop(stool, [0, 1.2, 0], 0, 0, {}, [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 1.1 }]).y).toBeCloseTo(1.1);
  });

  it('fitThing: без мира — ровно на высоте (как раньше); с миром — ложится; «висит» — на своей высоте; настенная — как есть', () => {
    const a: AnchorSpot = { anchor: 'middle', x: 0, z: 0, floor: 0, ceil: 3, phi: 0, wall: 0, door: 0, entry: 0, room: 0, tier: 0, pit: false };
    const lifted = spec({ prop: 'kk_stool', offset: [0, 0] }, { anchor: 'middle', lift: 0.9 });
    expect(fitThing(lifted, a, stool).at[1]).toBeCloseTo(0.9);
    expect(fitThing(lifted, a, stool, w).at[1]).toBeCloseTo(0.8);
    expect(fitThing({ ...lifted, hang: true }, a, stool, w).at[1]).toBeCloseTo(0.9);
    expect(fitThing({ ...lifted, rule: { ...lifted.rule, lift: 0 } }, a, stool, w).at[1]).toBe(0);
    const rad = spec({ prop: 'radiator', offset: [0, 0] }, { anchor: 'wall', lift: 0.12 });
    expect(fitThing(rad, { ...a, anchor: 'wall' }, ALL_PROPS.radiator!, w).at[1]).toBeCloseTo(0.12);
  });

  it('поверхности по сетке: у кухонного стола — клеёнка на столешнице, тарелка, хлебница, сиденье табуретки — каждая на своей высоте', () => {
    const lvl = buildLevel(generateLayout(20041113, 2, 'shelter'), { wear: 0, placed: [], figures: [], keepPlaceWorld: true });
    const t = (lvl.objects ?? []).find((o) => o.name === 'kitchen_table');
    expect(t).toBeDefined();
    const pw = lvl.placeWorld!;
    const floor = t!.at[1];
    const tops: number[] = [];
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 20; j++) {
        const x = t!.min[0] + ((t!.max[0] - t!.min[0]) * i) / 20;
        const z = t!.min[2] + ((t!.max[2] - t!.min[2]) * j) / 20;
        const hs = pw.surfaces!(t!.id, x, z, floor + 0.3, floor + 1.2) ?? [];
        if (hs.length > 0) tops.push(Math.max(...hs) - floor);
      }
    }
    const share = (lo: number, hi: number): number => tops.filter((v) => v >= lo && v <= hi).length;
    // Столешница s3_table_kitchen — 0,736 м (furniture.ts, S3_TOP), клеёнка и клетка на ней — ещё 4 мм: почти вся площадь стола.
    expect(share(0.735, 0.745)).toBeGreaterThan(tops.length * 0.6);
    // Хлебница — выше столешницы на 11–12 см; сиденье выдвинутой табуретки — ниже.
    expect(share(0.84, 0.87)).toBeGreaterThan(0);
    expect(share(0.42, 0.46)).toBeGreaterThan(0);
    // Верх рамки — крышка хлебницы, а не столешница: по рамке чашка повисла бы над клеёнкой.
    expect(t!.max[1] - floor).toBeGreaterThan(0.85);
  });

  it('своя вещь — тоже опора, в каком бы порядке ни шли записи: табуретка над своим кухонным столом ложится на его клеёнку', () => {
    const build = (placed: readonly PlacedSpec[]) => buildLevel(generateLayout(20041113, 2, 'shelter'), { wear: 0, placed, figures: [], keepPlaceWorld: true });
    const table = spec({ id: 'pl_table', prop: 'kitchen_table', offset: [0, 0], near: [0.5, 0.5] }, { worlds: ['shelter'], rooms: ['kitchen'], anchor: 'middle', count: 1 });
    // Где встал стол и где у него клеёнка (не хлебница и не табуретка при нём).
    const l1 = build([table]);
    const ts = l1.placed!.find((p) => p.id === 'pl_table')!;
    expect(ts).toBeDefined();
    const pw = l1.placeWorld!;
    const tObj = l1.objects!.find((o) => o.name === 'kitchen_table' && Math.hypot(o.at[0] - ts.at[0], o.at[2] - ts.at[2]) < 1e-3)!;
    expect(tObj).toBeDefined();
    // Точка, где под всем следом табуретки — клеёнка (хлебница, тарелка и край стола — мимо): там она встанет без «врастает».
    const sb = worldBox(stool, [0, 0, 0], ts.rot);
    const hx = (sb.maxX - sb.minX) / 2 + 0.03;
    const hz = (sb.maxZ - sb.minZ) / 2 + 0.03;
    const cloth = (x: number, z: number): boolean => {
      const hs = pw.surfaces!(tObj.id, x, z, ts.at[1] + 0.3, ts.at[1] + 1.2) ?? [];
      const top = hs.length ? Math.max(...hs) - ts.at[1] : 0;
      return top > 0.735 && top < 0.745;
    };
    let pt: [number, number] | null = null;
    let best = Infinity;
    const mx = (tObj.min[0] + tObj.max[0]) / 2;
    const mz = (tObj.min[2] + tObj.max[2]) / 2;
    for (let i = 1; i < 30; i++) {
      for (let j = 1; j < 30; j++) {
        const x = tObj.min[0] + ((tObj.max[0] - tObj.min[0]) * i) / 30;
        const z = tObj.min[2] + ((tObj.max[2] - tObj.min[2]) * j) / 30;
        const clear = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].every(([u, v]) => cloth(x + u! * hx, z + v! * hz));
        const d = Math.hypot(x - mx, z - mz);
        if (clear && d < best) {
          best = d;
          pt = [x, z];
        }
      }
    }
    expect(pt).not.toBeNull();
    // Сдвиг табуретки в рамке того же края, чтобы её середина пришлась на эту точку клеёнки.
    const room = l1.layout!.rooms[ts.room]!;
    const a = anchorSpots(room, 'middle', pw).find((q) => Math.abs(q.x - ts.at[0]) < 1e-6 && Math.abs(q.z - ts.at[2]) < 1e-6)!;
    expect(a).toBeDefined();
    const dx = pt![0] - (sb.minX + sb.maxX) / 2 - a.x;
    const dz = pt![1] - (sb.minZ + sb.maxZ) / 2 - a.z;
    const c = Math.cos(a.phi);
    const sn = Math.sin(a.phi);
    const up = spec({ id: 'pl_up', prop: 'kk_stool', offset: [c * dx - sn * dz, sn * dx + c * dz], near: [0.5, 0.5] }, { worlds: ['shelter'], rooms: ['kitchen'], anchor: 'middle', lift: 0.9, count: 1 });
    // Записи — в обоих порядках (в файле они по времени сохранения): табуретка ложится на клеёнку своего стола.
    for (const order of [[up, table], [table, up]]) {
      const lvl = build(order);
      const s = lvl.placed!.find((p) => p.id === 'pl_up')!;
      expect(s, JSON.stringify(order.map((o) => o.id))).toBeDefined();
      expect(Math.abs(s.at[0] - (a.x + (c * (c * dx - sn * dz) + sn * (sn * dx + c * dz))))).toBeLessThan(1e-6);
      expect(s.at[1] - ts.at[1]).toBeGreaterThan(0.735);
      expect(s.at[1] - ts.at[1]).toBeLessThan(0.745);
    }
  });

  it('на уровне: поднятая стоит на верхе того, что под её серединой, или на полу; помеченная «висит» — на своей высоте', () => {
    const build = (placed: readonly PlacedSpec[]) => buildLevel(generateLayout(20041113, 2, 'shelter'), { wear: 0, placed, figures: [], keepPlaceWorld: true });
    const lifted = spec({ id: 'pl_up', prop: 'kk_stool' }, { worlds: ['shelter'], anchor: 'middle', lift: 0.9, count: 3 });
    const hung = spec({ id: 'pl_hang', prop: 'kk_stool', hang: true }, { worlds: ['shelter'], anchor: 'wall', lift: 0.9, count: 3 });
    const lvl = build([lifted, hung]);
    const spots = lvl.placed ?? [];
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      const room = lvl.layout!.rooms[s.room]!;
      const floor = lvl.placeWorld!.shells[room.tier]!.get(room.cells[0]![0] - 8, room.cells[0]![1] - 8)!.floorY;
      const b = worldBox(stool, s.at, s.rot);
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      if (s.id === 'pl_hang') {
        expect(s.at[1] - floor, JSON.stringify(s)).toBeCloseTo(0.9, 2);
        continue;
      }
      const onFloor = Math.abs(s.at[1] - floor) < 0.005;
      // Лежит на верхней грани чужой вещи прямо под своей серединой (не на верхе рамки — там хлебница, а не столешница).
      const own = (o: LevelObject): boolean => o.name === 'kk_stool' && Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) < 0.01;
      const onThing = (lvl.objects ?? []).some(
        (o) => !o.flat && !own(o) && cx > o.min[0] && cx < o.max[0] && cz > o.min[2] && cz < o.max[2] && (lvl.placeWorld!.surfaces!(o.id, cx, cz, s.at[1] - 0.002, s.at[1] + 0.002) ?? []).length > 0,
      );
      expect(onFloor || onThing, JSON.stringify(s)).toBe(true);
    }
  });
});

describe('ручка ↕: под потолком и замена (противоречия 280, 281)', () => {
  const stool = ALL_PROPS.kk_stool!;
  const a: AnchorSpot = { anchor: 'ceiling', x: 0, z: 0, floor: 0, ceil: 3, phi: 0, wall: 0, door: 0, entry: 0, room: 0, tier: 0, pit: false };

  it('данные: «ниже потолка» — от 0 до 2,6 м', () => {
    expect(placedProblems(spec({ drop: 0.3 }, { anchor: 'ceiling' }), ALL_PROPS, FIXED)).toEqual([]);
    for (const bad of [-0.1, 2.7, Number.NaN, '0,3' as unknown as number]) {
      expect(placedProblems(spec({ drop: bad }, { anchor: 'ceiling' }), ALL_PROPS, FIXED).join(), String(bad)).toContain('ниже потолка');
    }
  });

  it('под потолком: вплотную или на drop ниже; ниже пола не уходит; у других краёв drop не действует', () => {
    const top = a.ceil - 0.02 - stool.h;
    const hung = spec({ prop: 'kk_stool', offset: [0, 0] }, { anchor: 'ceiling', lift: 0 });
    expect(fitThing(hung, a, stool).at[1]).toBeCloseTo(top);
    expect(fitThing({ ...hung, drop: 0.5 }, a, stool).at[1]).toBeCloseTo(top - 0.5);
    // В низком помещении тот же отступ держится от его потолка, а глубже пола вещь не опускается.
    expect(fitThing({ ...hung, drop: 0.5 }, { ...a, ceil: 2.4 }, stool).at[1]).toBeCloseTo(2.4 - 0.02 - stool.h - 0.5);
    expect(fitThing({ ...hung, drop: 2.6 }, { ...a, ceil: 2.4 }, stool).at[1]).toBe(0);
    // Под потолком вещь не ложится, сколько бы ни опустили: её держит потолок.
    expect(fitThing({ ...hung, drop: 2 }, a, stool, { objects: [] }).at[1]).toBeCloseTo(top - 2);
    const mid = spec({ prop: 'kk_stool', offset: [0, 0], drop: 0.5 }, { anchor: 'middle', lift: 0.9 });
    expect(fitThing(mid, { ...a, anchor: 'middle' }, stool).at[1]).toBeCloseTo(0.9);
  });

  it('замена с «висит» висит над местом вещи игры на rule.lift; без отметки — там же, где вещь игры', () => {
    const office = (placed: readonly PlacedSpec[]): BuiltLevel => buildLevel(generateLayout(20041113, 2, 'office'), { wear: 0, figures: [], placed });
    const plain = office([]);
    const count = new Map<string, number>();
    for (const o of plain.objects ?? []) if (!o.flat) count.set(o.name, (count.get(o.name) ?? 0) + 1);
    // Напольная вещь офиса с той же опорой, что у табурета: замена встаёт в её точку без сдвига.
    const name = [...count.entries()]
      .filter(([n]) => ALL_PROPS[n] && !FIXED.has(n) && ALL_PROPS[n]!.mount === stool.mount && ALL_PROPS[n]!.w >= 0.4 && ALL_PROPS[n]!.d >= 0.4)
      .sort((x, y) => y[1] - x[1])[0]![0];
    const olds = (plain.objects ?? []).filter((o) => o.name === name && !o.flat);
    const plainStools = new Set((plain.objects ?? []).filter((o) => o.name === 'kk_stool').map((o) => o.id));
    const fresh = (l: BuiltLevel): LevelObject[] => (l.objects ?? []).filter((o) => o.name === 'kk_stool' && !(plain.objects ?? []).some((p) => plainStools.has(p.id) && p.at.every((v, i) => Math.abs(v - o.at[i]!) < 1e-6)));
    const swap = (over: Partial<PlacedSpec>): PlacedSpec => spec({ id: 'pl_swap_up', replaces: name, prop: 'kk_stool', ...over }, { count: 1, lift: 0.8 });
    const upAbove = (l: BuiltLevel): number[] =>
      fresh(l).map((s) => {
        const o = olds.find((x) => Math.hypot(x.at[0] - s.at[0], x.at[2] - s.at[2]) < 1e-3);
        expect(o, JSON.stringify(s.at)).toBeDefined();
        return s.at[1] - o!.at[1];
      });
    const hung = upAbove(office([swap({ hang: true })]));
    expect(hung.length).toBe(1);
    expect(hung[0]).toBeCloseTo(0.8, 3);
    const standing = upAbove(office([swap({})]));
    expect(standing.length).toBe(1);
    expect(standing[0]).toBeCloseTo(0, 3);
  });
});
