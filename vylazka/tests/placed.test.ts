import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';
import type { BuiltLevel } from '../src/world/level';
import type { LevelObject } from '../src/world/objects';
import { placeable, placedProblems, removedProblems } from '../src/world/placed';
import type { PlacedSpec, RemovedSpec } from '../src/world/placed';
import { checkSpot, fitThing, gameNth, HEADROOM, moveSpot, NEVER, placeThings, roomDoors, roomIndex, roomNear, rotOf, throatBox, worldBox } from '../src/world/placed_place';
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
    const before = byRoom(plain, X);
    const lvl = make([move]);
    const after = byRoom(lvl, X);
    const rooms = [...before.keys()].filter((id) => layout.rooms[id]!.type === T && before.get(id)!.length > 1);
    expect(rooms.length).toBeGreaterThan(0);
    const moved = (lvl.placed ?? []).filter((s) => s.moved);
    expect(moved.length).toBe(rooms.length);
    for (const id of rooms) {
      expect(after.get(id)!.length).toBe(before.get(id)!.length);
      // Первая такая — на месте; вторая — переехала: её прежней точки больше нет.
      const now = after.get(id)!.map(where);
      expect(now).toContain(where(before.get(id)![0]!));
      expect(now).not.toContain(where(before.get(id)![1]!));
      const s = moved.find((q) => q.room === id)!;
      expect(s, `помещение ${id}`).toBeDefined();
      const room = layout.rooms[id]!;
      expect(roomAt(s.at[0], s.at[1], s.at[2])?.id).toBe(id);
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
    for (const [id, list] of before) if (layout.rooms[id]!.type !== T) expect(after.get(id)!.map(where)).toEqual(list.map(where));
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
