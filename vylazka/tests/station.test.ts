import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { generateLayout, GRID } from '../src/gen/layout';
import type { GenLayout } from '../src/gen/layout';
import { DEFAULT_SESSION, ORDERED_WORLDS, Session, STATION_MEMORIES } from '../src/systems/session';
import type { SessionEvent, SessionInput } from '../src/systems/session';
import { buildLevel } from '../src/world/level_build';
import { ALL_PROPS } from '../src/world/props_all';
import { setThingRegistry } from '../src/world/thing_mesh';

const SEEDS = [1, 7, 42, 20041113, 99991, 5];
const key = (x: number, z: number): string => `${x},${z}`;

/** Клетки, достижимые от входа: внутри помещения — свободно, между помещениями — только по проходам. */
function reach(l: GenLayout, skip: ReadonlySet<string> = new Set()): Set<string> {
  const room = new Map<string, number>();
  for (const r of l.rooms) for (const [x, z] of r.cells) room.set(key(x, z), r.id);
  const open = new Set<string>();
  for (const e of l.edges) {
    const bx = e.cx + (e.dir === 0 ? 1 : 0);
    const bz = e.cz + (e.dir === 1 ? 1 : 0);
    open.add(`${key(e.cx, e.cz)}>${key(bx, bz)}`);
    open.add(`${key(bx, bz)}>${key(e.cx, e.cz)}`);
  }
  const start = l.rooms[l.entranceRoom]!.cells[0]!;
  const seen = new Set([key(start[0], start[1])]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = key(x + dx, z + dz);
      if (!room.has(k) || seen.has(k) || skip.has(k)) continue;
      if (room.get(k) !== room.get(key(x, z)) && !open.has(`${key(x, z)}>${k}`)) continue;
      seen.add(k);
      queue.push([x + dx, z + dz]);
    }
  }
  return seen;
}

describe('зал ожидания: план', () => {
  it('в плане есть вход, зал 4 × 6 клеток, касса, камеры хранения, буфет, два перехода, перрон и пути вдоль него', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'station');
      const of = (t: string) => l.rooms.filter((r) => r.type === t);
      expect(l.world).toBe('station');
      expect(l.tierCount).toBe(1);
      expect(l.rooms[l.entranceRoom]!.type).toBe('vestibule');
      expect(of('concourse')).toHaveLength(1);
      expect(of('concourse')[0]!.cells).toHaveLength(24);
      for (const t of ['tickets', 'lockers', 'buffet', 'platform', 'track']) expect(of(t), t).toHaveLength(1);
      expect(of('corridor')).toHaveLength(2);
      // Пути тянутся вдоль всего перрона, клетка в клетку.
      expect(of('track')[0]!.cells.length * 2).toBe(of('platform')[0]!.cells.length);
    }
  });

  it('клетки не пересекаются и лежат в сетке; один сид — один план', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'station');
      const all = l.rooms.flatMap((r) => r.cells.map(([x, z]) => key(x, z)));
      expect(new Set(all).size).toBe(all.length);
      for (const r of l.rooms) for (const [x, z] of r.cells) expect(x >= 0 && z >= 0 && x < GRID && z < GRID).toBe(true);
      expect(JSON.stringify(generateLayout(seed, 2, 'station'))).toBe(JSON.stringify(l));
    }
  });

  it('всё связано, и есть петля: зал → переход → перрон → второй переход → зал', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'station');
      const total = l.rooms.reduce((n, r) => n + r.cells.length, 0);
      expect(reach(l).size).toBe(total);
      // Убрать любой из двух переходов — перрон всё ещё достижим.
      for (const pass of l.rooms.filter((r) => r.type === 'corridor')) {
        const skip = new Set(pass.cells.map(([x, z]) => key(x, z)));
        const got = reach(l, skip);
        for (const [x, z] of l.rooms.find((r) => r.type === 'platform')!.cells) expect(got.has(key(x, z))).toBe(true);
      }
    }
  });

  it('от сида зависит зеркальность плана, от ранга — длина переходов и перрона', () => {
    const side = (seed: number): number => Math.sign(generateLayout(seed, 2, 'station').rooms.find((r) => r.type === 'buffet')!.cells[0]![0] - GRID / 2);
    const sides = new Set(Array.from({ length: 24 }, (_, i) => side(i + 1)));
    expect(sides.size).toBe(2);
    const size = (rank: 1 | 2 | 3, type: string): number => generateLayout(7, rank, 'station').rooms.filter((r) => r.type === type).reduce((n, r) => n + r.cells.length, 0);
    expect(size(1, 'corridor')).toBeLessThan(size(2, 'corridor'));
    expect(size(1, 'platform')).toBeLessThan(size(2, 'platform'));
    expect(size(2, 'platform')).toBeLessThan(size(3, 'platform'));
  });
});

describe('зал ожидания: уровень', () => {
  beforeAll(() => setThingRegistry(ALL_PROPS));

  it('за краем перрона — пути ниже пола и зона падения над каждой их клеткой', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'station');
      const level = buildLevel(l);
      const pits = level.zones.filter((z) => z.kind === 'pit');
      expect(pits).toHaveLength(l.rooms.find((r) => r.type === 'track')!.cells.length);
      // Зона лежит ниже перрона: упасть в неё можно, только шагнув за край.
      for (const z of pits) expect(z.maxY).toBeLessThan(-0.5);
    }
  });

  it('по путям никто не ходит: в графе путей нет, остальное достижимо от начала', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'station');
      const level = buildLevel(l);
      const track = l.rooms.find((r) => r.type === 'track')!.id;
      expect(level.nav.some((n) => n.room === track)).toBe(false);
      const seen = new Set<number>();
      const start = level.nav.find((n) => n.room === l.entranceRoom)!;
      const queue = [start.id];
      seen.add(start.id);
      for (let i = 0; i < queue.length; i++) for (const k of level.nav[queue[i]!]!.links) if (!seen.has(k)) (seen.add(k), queue.push(k));
      expect(seen.size).toBe(level.nav.length);
    }
  });

  it('у каждой из пяти вещей есть место в её помещении', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'station');
      const level = buildLevel(l);
      for (const m of STATION_MEMORIES) {
        const own = level.spots.filter((s) => m.rooms!.includes(l.rooms[s.room]!.type));
        expect(own.length, `${m.id} (сид ${seed})`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('зал ожидания: пять вещей', () => {
  beforeAll(() => setThingRegistry(ALL_PROPS));
  const QUICK = { ...DEFAULT_SESSION, firstDelay: 1, delay: 1, fallback: 0, minLength: 0 };
  const far = (): number => 1e9;

  /** Вход для шага сессии: игрок стоит в полутора метрах от точки и смотрит на неё. */
  function gaze(node: number, at: Vec3 | null, holdDt?: number): SessionInput {
    const eye: Vec3 = at ? [at[0], at[1] + 0.2, at[2] + 1.5] : [0, 1.4, 0];
    return { pos: [eye[0], 0, eye[2]], eye, aim: [0, 0, -1], light: 1, node, swarm: 0, observed: true, landed: 0, ...(holdDt === undefined ? {} : { holdDt }) };
  }

  it('идут всегда одни и те же и по порядку — как бы ни легли сид и прошлые сессии', () => {
    expect(ORDERED_WORLDS.has('station')).toBe(true);
    const chain = STATION_MEMORIES.map((m) => m.id);
    expect(chain).toEqual(['st_note', 'st_key', 'st_ticket', 'st_cup', 'st_coat']);
    for (const seed of SEEDS) {
      const level = buildLevel(generateLayout(seed, 2, 'station'));
      expect(new Session(level, seed).memories.map((m) => m.def.id)).toEqual(chain);
      expect(new Session(level, seed + 1, new Set(['st_note', 'st_cup'])).memories.map((m) => m.def.id)).toEqual(chain);
    }
  });

  it('каждая вещь появляется в своём помещении; вспомнить её можно только стоя', () => {
    const l = generateLayout(42, 2, 'station');
    const level = buildLevel(l);
    const s = new Session(level, 42, new Set(), QUICK);
    const node = level.nav.find((n) => n.room === l.entranceRoom)!.id;
    const got: SessionEvent[] = [];
    for (const def of STATION_MEMORIES) {
      // Вспышка приходит через секунду времени места.
      for (let i = 0; i < 200 && !s.active; i++) got.push(...s.update(1 / 60, gaze(node, null), far));
      const act = s.active!;
      expect(act.def.id).toBe(def.id);
      expect(def.rooms).toContain(l.rooms[act.spot!.room]!.type);
      const at: Vec3 = [act.spot!.x, act.spot!.y, act.spot!.z];
      // Идёт (взгляд не держит): сколько ни смотри, не вспоминается.
      for (let i = 0; i < 240; i++) got.push(...s.update(1 / 60, gaze(node, at, 0), far));
      expect(s.hold).toBe(0);
      expect(act.state).toBe('active');
      // Встал: полторы секунды — и вспомнил.
      for (let i = 0; i < 200 && act.state !== 'done'; i++) got.push(...s.update(1 / 60, gaze(node, at, 1 / 60), far));
      expect(act.state).toBe('done');
    }
    expect(got.filter((e) => e.type === 'recall')).toHaveLength(5);
    expect(got.some((e) => e.type === 'all-done')).toBe(true);
  });
});
