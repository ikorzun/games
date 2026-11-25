import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { CELL } from '../src/world/shell';
import { buildLevel, cellToWorld, tierFloor } from '../src/world/level_build';
import { MeshBuilder } from '../src/world/kit';
import { Xf } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';
import { Flowers, FLOWER_CFG, FLOWER_STRIDE, quatOf, turnToward } from '../src/systems/flowers';
import type { FlowerSite } from '../src/systems/flowers';
import { HEADS } from '../src/world/flowers';

const WORLDS: WorldKind[] = ['shelter', 'office', 'station', 'yellow'];
const SEEDS = [20041113, 7, 1234];
const RANKS = [1, 3] as const;
const cache = new Map<string, ReturnType<typeof buildLevel> & { layout: ReturnType<typeof generateLayout> }>();
function level(world: WorldKind, seed: number, rank: 1 | 2 | 3) {
  const k = `${world}/${seed}/${rank}`;
  let l = cache.get(k);
  if (!l) {
    const layout = generateLayout(seed, rank, world);
    l = { ...buildLevel(layout), layout };
    cache.set(k, l);
  }
  return l;
}
const cases: [WorldKind, number, 1 | 3][] = [];
for (const w of WORLDS) for (const s of SEEDS) for (const r of RANKS) cases.push([w, s, r]);

describe('оранжерея в местах (партнёр 19.11: «комната полностью с цветами»)', () => {
  it.each(cases)('%s, сид %i, ранг %i: оранжерея есть (кроме жёлтых комнат), головки — внутри неё и целые', (world, seed, rank) => {
    const l = level(world, seed, rank);
    if (world === 'yellow') {
      expect(l.greenRoom).toBeUndefined();
      expect(l.blooms ?? []).toEqual([]);
      return;
    }
    expect(l.greenRoom, 'оранжерея').toBeDefined();
    const room = l.layout.rooms.find((r) => r.id === l.greenRoom)!;
    expect(room.type).not.toBe('kitchen');
    expect(['archive', 'buffet']).not.toContain(room.type);
    if (world === 'station') expect(room.type, 'в зале ожидания — клумбы на перроне').toBe('platform');
    // С 19.11, 21:27 цветы есть и вне оранжереи — в банках на кухонных столах и герань в горшках по дому (props_home.ts,
    // jar_flowers, houseplant): их головки — отдельно, проверяются ниже.
    const objs = new Map((l.objects ?? []).map((o) => [o.id, o]));
    const HOME = new Set(['jar_flowers', 'houseplant']);
    const home = (b: { obj: number }): boolean => HOME.has(objs.get(b.obj)?.name ?? '');
    const blooms = (l.blooms ?? []).filter((b) => !home(b));
    expect(blooms.length, 'головок').toBeGreaterThan(world === 'station' ? 20 : 30);
    // Головка — над полом помещения и внутри его клеток (с запасом на наклон стебля).
    for (const b of blooms) {
      expect([...b.pos, ...b.dir].every(Number.isFinite)).toBe(true);
      expect(b.form).toBeGreaterThanOrEqual(0);
      expect(b.form).toBeLessThan(HEADS.length);
      const inCell = room.cells.some(([x, z]) => {
        const cx = cellToWorld(x);
        const cz = cellToWorld(z);
        return Math.abs(b.pos[0] - cx) < CELL / 2 + 0.3 && Math.abs(b.pos[2] - cz) < CELL / 2 + 0.3;
      });
      expect(inCell, `головка ${b.pos.map((v) => v.toFixed(2))} вне оранжереи`).toBe(true);
      // Растёт на объекте уровня: растворится он — уйдёт и головка.
      expect(objs.has(b.obj), 'объект под головкой').toBe(true);
    }
  });

  // Вес оранжереи — не на одном сиде (куратор, пачка 53, противоречие 350): каждый кусок уровня в пределе помещения.
  it.each(cases.filter(([w]) => w !== 'yellow'))('%s, сид %i, ранг %i: каждый кусок уровня с оранжереей — меньше 60 тысяч треугольников', (world, seed, rank) => {
    const l = level(world, seed, rank);
    for (const [i, ch] of l.chunks.entries()) expect(ch.mesh.index.length / 3, `кусок ${i}`).toBeLessThan(60000);
  });

  it.each(cases.filter(([w]) => w !== 'yellow'))('%s, сид %i, ранг %i: тот же сид — те же головки', (world, seed, rank) => {
    const a = level(world, seed, rank).blooms ?? [];
    const b = buildLevel(generateLayout(seed, rank, world)).blooms ?? [];
    expect(b.map((q) => q.pos)).toEqual(a.map((q) => q.pos));
  });

  // Партнёр 25.11, «делай»: клумбы и цветы налезали на грядки. Посередине — клумба, стол, кадка, роза, парник: не на дорожке
  // перед грядкой или стеллажом (FRONT, 0,55 м) и листьями поверх грядки не больше 15 см (world/clearance.ts, MIDDLE_LEAF).
  it.each(cases.filter(([w]) => w !== 'yellow'))('%s, сид %i, ранг %i: посередине оранжереи — дорожка к грядкам, клумбы на них не налезают', (world, seed, rank) => {
    const l = level(world, seed, rank);
    const objs = l.objects ?? [];
    const rows = objs.filter((o) => /^gh_(bed|rack)/.test(o.name));
    const bad: string[] = [];
    for (const m of objs.filter((o) => /^(gh_patch|gh_table|gh_tub|s3_rose_tall|s3_pergola)/.test(o.name))) {
      for (const r of rows) {
        const ox = Math.min(m.max[0], r.max[0]) - Math.max(m.min[0], r.min[0]) - 0.1;
        const oz = Math.min(m.max[2], r.max[2]) - Math.max(m.min[2], r.min[2]) - 0.1;
        const oy = Math.min(m.max[1], r.max[1]) - Math.max(m.min[1], r.min[1]);
        if (oy > 0.05 && Math.min(ox, oz) > 0.15 + 1e-6) bad.push(`${m.name}#${m.id} над ${r.name}#${r.id} на ${Math.min(ox, oz).toFixed(2)} м`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('сводка для глаз: помещение и число головок', () => {
    const rows: string[] = [];
    for (const [w, s, r] of cases) {
      const l = level(w, s, r);
      const room = l.layout.rooms.find((q) => q.id === l.greenRoom);
      rows.push(`${w} ${s} r${r}: ${room ? `${room.type} ×${room.cells.length}, ярус ${room.tier}` : '—'}, головок ${(l.blooms ?? []).length}, объектов ${(l.objects ?? []).filter((o) => o.name.startsWith('gh_')).length}`);
    }
    console.log(rows.join('\n'));
  });
});

describe('натриевые лампы оранжереи светят (design.md, §35)', () => {
  it.each(cases.filter(([w]) => w !== 'yellow'))('%s, сид %i, ранг %i: лампы собраны при сборке — только под землёй и внутри оранжереи', (world, seed, rank) => {
    const l = level(world, seed, rank);
    if (world !== 'shelter') {
      expect(l.lamps, 'над грядками зимнего сада и перрона ламп нет').toBeUndefined();
      return;
    }
    const lamps = l.lamps!;
    expect(lamps, 'лампы подземной теплицы').toBeDefined();
    expect(lamps.pos.length).toBeGreaterThan(0);
    // Коробка — клетки оранжереи, по высоте — её пол и потолок.
    const room = l.layout.rooms.find((r) => r.id === l.greenRoom)!;
    const xs = room.cells.map(([x]) => cellToWorld(x));
    const zs = room.cells.map(([, z]) => cellToWorld(z));
    expect(lamps.box).toEqual([Math.min(...xs) - CELL / 2, Math.min(...zs) - CELL / 2, Math.max(...xs) + CELL / 2, Math.max(...zs) + CELL / 2]);
    expect(lamps.y[0]).toBeCloseTo(tierFloor(room.tier), 6);
    expect(lamps.y[1] - lamps.y[0]).toBeGreaterThan(2.4);
    for (const p of lamps.pos) {
      expect(p.every(Number.isFinite)).toBe(true);
      // Висит под потолком, над грядкой у стены: внутри коробки, не дальше метра от её края.
      expect(p[1], 'под потолком').toBeCloseTo(lamps.y[1] - 0.345, 3);
      expect(p[0]).toBeGreaterThan(lamps.box[0]);
      expect(p[0]).toBeLessThan(lamps.box[2]);
      expect(p[2]).toBeGreaterThan(lamps.box[1]);
      expect(p[2]).toBeLessThan(lamps.box[3]);
      const edge = Math.min(p[0] - lamps.box[0], lamps.box[2] - p[0], p[2] - lamps.box[1], lamps.box[3] - p[2]);
      expect(edge, 'у стены').toBeLessThan(1);
    }
    // Тот же сид — те же лампы.
    expect(buildLevel(generateLayout(seed, rank, world)).lamps).toEqual(lamps);
  });

  it('лампа, которая не встала (сетку откатили), не светит', () => {
    const mb = new MeshBuilder();
    mb.lamps = [];
    const xf = new Xf(mb, null, 0, 2.7, 0);
    const mark = mb.mark();
    ALL_PROPS.gh_lamp!.build(xf, 1);
    expect(mb.lamps).toEqual([[0, 2.7 - 0.345, 0.25]]);
    mb.rewind(mark);
    expect(mb.lamps).toEqual([]);
  });
});

describe('цветы поворачиваются за светом', () => {
  const make = () => new Flowers([{ pos: [0, 1, 0], dir: [0, 1, 0], form: 0, size: 1, spin: 0 }], 1);

  it('у Осыпи вянут: никнут, сжимаются, не раскрываются; след держится почти минуту; дальние — живые (design.md, §35)', () => {
    const f = new Flowers(
      [
        { pos: [0, 1, 0], dir: [0, 1, 0], form: 0, size: 1, spin: 0 },
        { pos: [8, 1, 0], dir: [0, 1, 0], form: 0, size: 1, spin: 0 },
      ],
      1,
    );
    const eye: [number, number, number] = [2, 2.5, 0];
    const beam = (to: [number, number, number]) => {
      const d = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]];
      const l = Math.hypot(d[0]!, d[1]!, d[2]!);
      return { eye, beam: { origin: eye, dir: [d[0]! / l, d[1]! / l, d[2]! / l] as [number, number, number], cos: Math.cos(0.3), range: 12 }, gaze: null };
    };
    const blight = { pos: [0.5, 1, 0] as [number, number, number], k: 1 };
    for (let i = 0; i < 150; i++) f.update(1 / 30, beam([0, 1, 0]), blight);
    const [near, far] = f.sites as [FlowerSite, FlowerSite];
    expect(near.wilt, 'рядом с Осыпью увяла').toBeGreaterThan(0.9);
    expect(far.wilt, 'дальняя жива').toBe(0);
    expect(near.open, 'увядшая не раскрывается и под лучом').toBeLessThan(0.15);
    // Поникла: головка смотрит ниже горизонта.
    expect(near.face[1]).toBeLessThan(0.5);
    // Сухая головка в выдаче — меньше живой.
    const out = new Float32Array(FLOWER_STRIDE * 2);
    f.visible(eye, 2, out);
    const sizes = [out[7]!, out[FLOWER_STRIDE + 7]!];
    expect(Math.min(...sizes)).toBeLessThan(Math.max(...sizes));
    // Осыпь ушла: через 10 с всё ещё сухая, через минуту отошла.
    for (let i = 0; i < 300; i++) f.update(1 / 30, beam([0, 1, 0]), null);
    expect(near.wilt).toBeGreaterThan(0.6);
    for (let i = 0; i < 1800; i++) f.update(1 / 30, beam([0, 1, 0]), null);
    expect(near.wilt).toBe(0);
    expect(near.open, 'живая снова раскрылась под лучом').toBeGreaterThan(0.9);
  });

  it('сухоцвет поздних кругов: ниже dry головка не отходит', () => {
    const f = make();
    f.dry = 0.5;
    f.update(1 / 30, null);
    expect(f.sites[0]!.wilt).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 600; i++) f.update(1 / 30, null);
    expect(f.sites[0]!.wilt).toBeCloseTo(0.5, 5);
  });

  it('луч на головке — раскрывается и поворачивается к фонарю, но не дальше предела', () => {
    const f = make();
    const eye: [number, number, number] = [3, 2.5, 0];
    const light = { eye, beam: { origin: eye, dir: [-3 / Math.hypot(3, 1.5), -1.5 / Math.hypot(3, 1.5), 0] as [number, number, number], cos: Math.cos(0.3), range: 12 }, gaze: null };
    for (let i = 0; i < 300; i++) f.update(1 / 30, light);
    const s = f.sites[0]!;
    expect(s.open).toBeCloseTo(1, 5);
    // К глазу (вправо и вверх), но не дальше maxTurn от покоя.
    expect(s.face[0]).toBeGreaterThan(0.5);
    expect(Math.acos(s.face[1])).toBeLessThanOrEqual(FLOWER_CFG.maxTurn + 1e-3);
  });

  it('свет ушёл — закрывается не сразу, потом медленно возвращается в покой', () => {
    const f = make();
    const eye: [number, number, number] = [3, 2.5, 0];
    const lit = { eye, beam: { origin: eye, dir: [-0.894, -0.447, 0] as [number, number, number], cos: Math.cos(0.3), range: 12 }, gaze: null };
    for (let i = 0; i < 120; i++) f.update(1 / 30, lit);
    const s = f.sites[0]!;
    // Герой рядом, но луч отвёл в сторону.
    const off = { eye, beam: { origin: eye, dir: [1, 0, 0] as [number, number, number], cos: Math.cos(0.3), range: 12 }, gaze: null };
    f.update(0.2, off);
    expect(s.open, 'сразу не закрылась').toBeCloseTo(1, 5);
    for (let i = 0; i < 900; i++) f.update(1 / 30, off);
    expect(s.open).toBe(0);
    expect(s.face[1]).toBeGreaterThan(0.99);
  });

  it('в светлом месте светит взгляд: смотришь на цветок — он раскрывается', () => {
    const f = make();
    const eye: [number, number, number] = [2, 1.6, 0];
    for (let i = 0; i < 60; i++) f.update(1 / 30, { eye, beam: null, gaze: { dir: [-1, -0.3, 0], cos: Math.cos(0.5), range: 9 } });
    expect(f.sites[0]!.open).toBeGreaterThan(0.9);
    const g = make();
    for (let i = 0; i < 60; i++) g.update(1 / 30, { eye, beam: null, gaze: { dir: [1, 0, 0], cos: Math.cos(0.5), range: 9 } });
    expect(g.sites[0]!.open).toBe(0);
  });

  it('список для рендера: ближние первыми, бутон уже цветка; растворённый объект — без головки', () => {
    const f = new Flowers(
      [
        { pos: [5, 1, 0], dir: [0, 1, 0], form: 1, size: 1, spin: 0, obj: 7 },
        { pos: [1, 1, 0], dir: [0, 1, 0], form: 2, size: 1, spin: 0, obj: 8 },
      ],
      3,
    );
    const out = new Float32Array(FLOWER_STRIDE * 4);
    const n = f.visible([0, 1, 0], 4, out);
    expect(n).toBe(2);
    expect(out[9]).toBe(2);
    expect(out[7]!).toBeCloseTo(FLOWER_CFG.bud, 5);
    expect(f.visible([0, 1, 0], 4, out, (o) => (o === 8 ? 1 : 0))).toBe(1);
  });

  it('кватернион головки ставит её ось +y по направлению face; turnToward не перескакивает', () => {
    for (const face of [[0, 1, 0], [1, 0, 0], [0.3, 0.8, -0.5]] as const) {
      const l = Math.hypot(...face);
      const f: [number, number, number] = [face[0] / l, face[1] / l, face[2] / l];
      const [x, y, z, w] = quatOf(f, 0.7);
      // Ось +y, повёрнутая кватернионом.
      const v = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
      expect(v[0]).toBeCloseTo(f[0], 5);
      expect(v[1]).toBeCloseTo(f[1], 5);
      expect(v[2]).toBeCloseTo(f[2], 5);
    }
    const a = turnToward([0, 1, 0], [1, 0, 0], 0.1);
    expect(Math.acos(a[1])).toBeCloseTo(0.1, 6);
  });
});
