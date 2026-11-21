import { describe, expect, it } from 'vitest';
import { generateLayout, WORLD_KINDS } from '../src/gen/layout';
import type { GenLayout, WorldKind } from '../src/gen/layout';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from '../src/player/controller';
import type { PlayerBody } from '../src/player/controller';
import { ALL_MEMORIES, DEFAULT_SESSION, OFFICE_CHAIN, Session, SHELTER_CHAIN, STATION_MEMORIES, WORLD_MEMORIES, YELLOW_CHAIN } from '../src/systems/session';
import type { ColliderSet } from '../src/world/colliders';
import type { BuiltLevel, NavNode } from '../src/world/level';
import { MeshBuilder } from '../src/world/kit';
import { buildLevel } from '../src/world/level_build';
import { MAT, MAT_COUNT } from '../src/world/materials';
import { ENV_BUNKER, ENV_OFFICE, ENV_YELLOW, WORLD_ENV } from '../src/world/pockets';
import { Xf } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';
import { hasThing, setThingRegistry } from '../src/world/thing_mesh';

const DT = 1 / 60;
const SEEDS = [1, 5, 7, 42, 808, 4242, 9001, 31337, 20041113, 123456789, ...Array.from({ length: 30 }, (_, i) => (i * 7919 + 101) >>> 0)];
const NEW: readonly WorldKind[] = ['office', 'yellow'];

/** Расстояния в клетках пути от узла (−1 — недостижим). */
function hops(nav: NavNode[], from: number): Int32Array {
  const d = new Int32Array(nav.length).fill(-1);
  const q = [from];
  d[from] = 0;
  for (let h = 0; h < q.length; h++) {
    for (const n of nav[q[h]!]!.links) {
      if (d[n] !== -1) continue;
      d[n] = d[q[h]!]! + 1;
      q.push(n);
    }
  }
  return d;
}

function path(nav: NavNode[], from: number, to: number): number[] {
  const prev = new Int32Array(nav.length).fill(-1);
  const seen = new Uint8Array(nav.length);
  const q = [from];
  seen[from] = 1;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h]!;
    if (cur === to) break;
    for (const n of nav[cur]!.links) {
      if (seen[n]) continue;
      seen[n] = 1;
      prev[n] = cur;
      q.push(n);
    }
  }
  const out = [to];
  for (let p = prev[to]!; p !== -1; p = prev[p]!) out.push(p);
  return out.reverse();
}

function walk(level: BuiltLevel, nodes: number[], b: PlayerBody, c: ColliderSet): number {
  for (let i = 1; i < nodes.length; i++) {
    const n = level.nav[nodes[i]!]!;
    let done = false;
    for (let s = 0; s < 60 * 12 && !done; s++) {
      const dx = n.x - b.x;
      const dz = n.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) done = true;
      else stepPlayer(b, dx / d, dz / d, 2.3, DT, c, DEFAULT_CONTROLLER);
    }
    if (!done) return i;
  }
  return -1;
}

const count = (l: GenLayout, type: string): number => l.rooms.filter((r) => r.type === type).length;

describe('миры: генератор', () => {
  it('убежище не изменилось: тот же план, что и без указания мира', () => {
    for (const seed of [5, 20041113, 31337]) {
      const a = generateLayout(seed, 2);
      const b = generateLayout(seed, 2, 'shelter');
      expect(b).toEqual(a);
      expect(a.world).toBe('shelter');
      expect(a.tierCount).toBe(3);
    }
  });

  it('офис и жёлтые комнаты собираются на любом сиде: один этаж, без лестниц и опасностей', () => {
    for (const world of NEW) {
      for (const seed of SEEDS) {
        const l = generateLayout(seed, 2, world);
        expect(l.world).toBe(world);
        expect(l.tierCount, `${world} ${seed}`).toBe(1);
        expect(l.stairs).toHaveLength(0);
        expect(l.hazards).toEqual({ pits: [], water: [], gasRooms: [], collapses: [] });
        expect(count(l, 'lift')).toBe(1);
        expect(count(l, 'reception')).toBe(1);
        expect(count(l, 'corridor')).toBe(1);
        expect(l.rooms[l.entranceRoom]!.type).toBe('lift');
        // Ни одного помещения убежища.
        for (const t of ['entrance', 'airlock', 'dorm', 'fvu', 'diesel', 'tanks', 'stairwell', 'collapsed']) expect(count(l, t), `${world} ${seed}: ${t}`).toBe(0);
        expect(l.loops[0]!).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('офис: один отдел — самая большая комната; кабинки, переговорная и остальное на месте', () => {
    let big = 0;
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'office');
      expect(count(l, 'department'), `сид ${seed}`).toBe(1);
      const dep = l.rooms.find((r) => r.type === 'department')!;
      expect(dep.cells.length).toBeGreaterThanOrEqual(6);
      if (dep.cells.length >= 9) big += 1;
      for (const r of l.rooms) if (r.type !== 'corridor') expect(r.cells.length, `сид ${seed}: ${r.type}`).toBeLessThanOrEqual(dep.cells.length);
      expect(count(l, 'cubicles')).toBeGreaterThanOrEqual(1);
      expect(count(l, 'meeting')).toBeGreaterThanOrEqual(1);
      expect(count(l, 'hall')).toBe(0);
      // Двери есть; открытых проёмов — только приёмная.
      expect(l.edges.filter((e) => e.kind === 'door').length).toBeGreaterThanOrEqual(8);
      expect(l.edges.filter((e) => e.kind === 'hermo')).toHaveLength(0);
    }
    // Чаще всего отдел — три на три клетки и больше.
    expect(big).toBeGreaterThan(SEEDS.length * 0.85);
  });

  it('жёлтые комнаты: почти всё — пустые залы, дверей нет вовсе; отдел остался', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 2, 'yellow');
      expect(count(l, 'hall'), `сид ${seed}`).toBeGreaterThanOrEqual(5);
      expect(count(l, 'department')).toBeLessThanOrEqual(1);
      expect(l.edges.every((e) => e.kind === 'open'), `сид ${seed}`).toBe(true);
      for (const t of ['cubicles', 'meeting', 'manager', 'files', 'copyroom', 'server']) expect(count(l, t)).toBe(0);
    }
  });

  it('один сид — один план; у разных миров планы разные', () => {
    for (const world of NEW) expect(generateLayout(77, 2, world)).toEqual(generateLayout(77, 2, world));
    const cells = (w: WorldKind): string => JSON.stringify(generateLayout(77, 2, w).rooms.map((r) => r.cells));
    expect(cells('office')).not.toBe(cells('yellow'));
    expect(cells('office')).not.toBe(cells('shelter'));
    expect(WORLD_KINDS).toEqual(['shelter', 'office', 'yellow', 'station']);
  });
});

describe('миры: сборка уровня', () => {
  it('геометрия здорова: нет NaN, материалы в атласе, треугольников в меру; мир записан в уровне', () => {
    for (const world of NEW) {
      for (const seed of SEEDS.slice(0, 12)) {
        const level = buildLevel(generateLayout(seed, 2, world));
        expect(level.world).toBe(world);
        let tris = 0;
        for (const c of level.chunks) {
          const m = c.mesh;
          tris += m.index.length / 3;
          expect(m.position.every((v) => Number.isFinite(v)), `${world} ${seed}`).toBe(true);
          expect(m.mat.every((v) => Number.isInteger(v) && v >= 0 && v < MAT_COUNT)).toBe(true);
          expect(c.tierMin).toBe(0);
          expect(c.tierMax).toBe(0);
        }
        expect(tris, `${world} ${seed}`).toBeGreaterThan(8000);
        // Офис — до 120 тысяч: с 19.11 в нём зимний сад (оранжерея, design.md §35) — до 55 тысяч в одном помещении; без него офис
        // укладывался в 90. Рисуется то, что в кадре, и помещение целиком держит свой предел (tests/furniture.test.ts, 60 тысяч).
        expect(tris, `${world} ${seed}`).toBeLessThan(world === 'office' ? 120000 : 45000);
        expect(level.zones).toHaveLength(0);
        expect(level.collapses).toHaveLength(0);
        expect(level.variants).toHaveLength(0);
      }
    }
  });

  /** Сколько раз при сборке уровня ставили каждую из потолочных панелей. */
  function panelsBuilt(world: WorldKind): { level: BuiltLevel; cells: number; calls: Record<string, number> } {
    const names = ['ceiling_panel', 'ceiling_panel_off', 'ceiling_panel_dead'];
    const calls: Record<string, number> = { ceiling_panel: 0, ceiling_panel_off: 0, ceiling_panel_dead: 0 };
    const saved = names.map((n) => ALL_PROPS[n]!);
    names.forEach((n, i) => {
      ALL_PROPS[n] = { ...saved[i]!, build: (xf, seed) => (calls[n]!++, saved[i]!.build(xf, seed)) };
    });
    try {
      const layout = generateLayout(20041113, 2, world);
      const level = buildLevel(layout);
      // В комнате под звёздным небом потолка нет, и панелей в ней нет (tests/sky.test.ts).
      return { level, cells: layout.rooms.reduce((n, r) => n + (r.id === level.skyRoom ? 0 : r.cells.length), 0), calls };
    } finally {
      names.forEach((n, i) => (ALL_PROPS[n] = saved[i]!));
    }
  }

  const lampTrisOf = (level: BuiltLevel): number =>
    level.chunks.reduce((n, c) => {
      let k = 0;
      for (let i = 0; i < c.mesh.index.length; i += 3) if (c.mesh.mat[c.mesh.index[i]!] === MAT.lamp) k += 1;
      return n + k;
    }, 0);

  it('в каждой клетке под потолком — потолочная панель: в офисе все светятся, в жёлтых комнатах — обесточенные или мёртвые с проводом', () => {
    const office = panelsBuilt('office');
    expect(office.calls.ceiling_panel).toBe(office.cells);
    expect(office.calls.ceiling_panel_off + office.calls.ceiling_panel_dead).toBe(0);
    // Две светящиеся грани на панель, и больше светящегося в офисе нет.
    expect(lampTrisOf(office.level)).toBe(office.cells * 2);

    const yellow = panelsBuilt('yellow');
    const total = yellow.calls.ceiling_panel + yellow.calls.ceiling_panel_off + yellow.calls.ceiling_panel_dead;
    expect(total).toBe(yellow.cells);
    expect(yellow.calls.ceiling_panel_off).toBeGreaterThan(yellow.cells / 2);
    // Провод висит примерно у каждой шестой.
    expect(yellow.calls.ceiling_panel_dead).toBeGreaterThan(2);
    expect(yellow.calls.ceiling_panel_dead).toBeLessThan(yellow.cells / 3);
  });

  it('в жёлтых комнатах ни одна панель не светится: ни светящейся панели, ни светящегося материала', () => {
    const yellow = panelsBuilt('yellow');
    expect(yellow.calls.ceiling_panel, 'светящаяся панель в жёлтых комнатах').toBe(0);
    expect(lampTrisOf(yellow.level), 'светящиеся грани в жёлтых комнатах').toBe(0);
  });

  it('обесточенная и мёртвая панели сами не светятся; у мёртвой висит провод, и она ниже', () => {
    const grid = (name: string): { tris: number; lamp: number; top: number } => {
      const mb = new MeshBuilder();
      const xf = new Xf(mb, null, 0, 0, 0, 0);
      ALL_PROPS[name]!.build(xf, 5);
      const m = mb.build();
      let lamp = 0;
      for (let i = 0; i < m.index.length; i += 3) if (m.mat[m.index[i]!] === MAT.lamp) lamp += 1;
      let low = Infinity;
      for (let i = 1; i < m.position.length; i += 3) low = Math.min(low, m.position[i]!);
      return { tris: m.index.length / 3, lamp, top: low };
    };
    const lit = grid('ceiling_panel');
    const off = grid('ceiling_panel_off');
    const dead = grid('ceiling_panel_dead');
    expect(lit.lamp).toBeGreaterThan(0);
    expect(off.tris).toBeGreaterThan(0);
    expect(off.lamp).toBe(0);
    expect(dead.lamp).toBe(0);
    // Провод тянется вниз ниже самой панели.
    expect(dead.top).toBeLessThan(off.top - 0.1);
  });

  it('старт — у лифта, лицом на север; граф навигации связен; мест для вещей хватает и вдали от начала', () => {
    for (const world of NEW) {
      for (const seed of SEEDS) {
        const level = buildLevel(generateLayout(seed, 2, world));
        const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
        expect(start).toBeGreaterThanOrEqual(0);
        const s = level.nav[start]!;
        expect(Math.hypot(level.spawn.pos[0] - s.x, level.spawn.pos[2] - s.z)).toBeLessThan(1);
        expect(level.spawn.yaw).toBe(0);
        const d = hops(level.nav, start);
        expect([...d].every((v) => v >= 0), `${world} ${seed}: граф не связен`).toBe(true);
        expect(level.spots.length, `${world} ${seed}`).toBeGreaterThanOrEqual(14);
        // Воспоминанию нужно место не ближе семи клеток пути от игрока: таких мест должно быть несколько.
        const far = level.spots.filter((sp) => {
          let best = -1;
          let bd = Infinity;
          for (const n of level.nav) {
            const dd = Math.hypot(n.x - sp.x, n.z - sp.z) + (n.room === sp.room ? 0 : 6);
            if (dd < bd) {
              bd = dd;
              best = n.id;
            }
          }
          return d[best]! >= DEFAULT_SESSION.minCells;
        });
        expect(far.length, `${world} ${seed}: далёких мест ${far.length}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('в каждое помещение можно войти пешком от лифта (настоящим контроллером)', () => {
    for (const world of NEW) {
      for (const seed of [5, 20041113, 31337]) {
        const level = buildLevel(generateLayout(seed, 2, world));
        const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
        const s = level.nav[start]!;
        for (const room of level.layout!.rooms) {
          if (room.type === 'corridor') continue;
          const targets = level.nav.filter((n) => n.room === room.id);
          const reached = targets.some((t) => walk(level, path(level.nav, start, t.id), createBody(s.x, s.y, s.z), level.colliders) < 0);
          expect(reached, `${world} ${seed}: в помещение ${room.type} №${room.id} не войти`).toBe(true);
        }
      }
    }
  });

  it('по коридору можно пройти из конца в конец: редкие предметы у стен прохода не закрывают', () => {
    for (const world of NEW) {
      for (const seed of [5, 808, 20041113, 31337]) {
        const level = buildLevel(generateLayout(seed, 2, world));
        const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
        const d = hops(level.nav, start);
        const corridor = level.layout!.rooms.find((r) => r.type === 'corridor')!.id;
        let far = start;
        for (const n of level.nav) if (n.room === corridor && d[n.id]! > d[far]!) far = n.id;
        const s = level.nav[start]!;
        const at = walk(level, path(level.nav, start, far), createBody(s.x, s.y, s.z), level.colliders);
        expect(at, `${world} ${seed}: застрял на шаге ${at}`).toBe(-1);
      }
    }
  });
});

describe('миры: окружение и воспоминания', () => {
  it('у каждого мира своё окружение: в убежище темно, в офисе чисто и без фонаря, в жёлтых комнатах темно, как в убежище, и пусто', () => {
    expect(WORLD_ENV.shelter).toBe(ENV_BUNKER);
    expect(WORLD_ENV.office).toBe(ENV_OFFICE);
    expect(WORLD_ENV.yellow).toBe(ENV_YELLOW);
    expect(ENV_BUNKER.cells).toBeUndefined();
    expect(ENV_BUNKER.light).toBe(1);
    // Офис: свет даёт место (датчики), фонаря нет. Собрано только там, куда смотрит герой (новое правило
    // партнёра, 15.11: «локации должны распадаться, как от света фонарика. Не важно светлые они или
    // темные»), а достаёт взгляд так же далеко, как луч: сплошь метров до девяти, к восемнадцати — ничего.
    // (Прежнее правило — «освещённое видно только вблизи», 2,5 и 10 м кругом — этим отменено.)
    expect(ENV_OFFICE.cells).toBe('sensor');
    expect(ENV_OFFICE.light).toBe(0);
    expect(ENV_OFFICE.scan).toEqual([7, 18]);
    expect(ENV_OFFICE.decay).toBeLessThan(0);
    expect(ENV_OFFICE.fog).toEqual([0, 0, 0]);
    // Жёлтые комнаты: света по клеткам нет, фонарь есть, рассеянного света ничтожно мало.
    expect(ENV_YELLOW.cells).toBeUndefined();
    expect(ENV_YELLOW.light).toBe(1);
    const avg = (ENV_YELLOW.ambient[0] + ENV_YELLOW.ambient[1] + ENV_YELLOW.ambient[2]) / 3;
    expect(avg).toBeLessThan(0.01);
    // Только шар материала, без фактур; чисто, а не сыро.
    expect(ENV_YELLOW.plain).toBe(true);
    expect(ENV_YELLOW.decay).toBeLessThan(0);
    expect(ENV_BUNKER.plain).toBeUndefined();
    expect(ENV_OFFICE.plain).toBeUndefined();
    expect(ENV_YELLOW.fog).toEqual([0, 0, 0]);
  });

  it('у каждого мира свои пять вещей по порядку; у каждой есть вещь в реестре и тексты на всех языках', async () => {
    setThingRegistry(ALL_PROPS);
    expect(WORLD_MEMORIES.shelter).toBe(SHELTER_CHAIN);
    expect(WORLD_MEMORIES.office).toBe(OFFICE_CHAIN);
    expect(WORLD_MEMORIES.yellow).toBe(YELLOW_CHAIN);
    expect(WORLD_MEMORIES.station).toBe(STATION_MEMORIES);
    const en = (await import('../locales/en/ui.json')).default as Record<string, string>;
    const ru = (await import('../locales/ru/ui.json')).default as Record<string, string>;
    const es = (await import('../locales/es/ui.json')).default as Record<string, string>;
    for (const pool of [SHELTER_CHAIN, OFFICE_CHAIN, YELLOW_CHAIN, STATION_MEMORIES]) {
      expect(pool.length).toBe(DEFAULT_SESSION.count);
      expect(new Set(pool.map((m) => m.id)).size).toBe(pool.length);
      for (const m of pool) {
        expect(hasThing(m.thing), `${m.id}: нет вещи ${m.thing}`).toBe(true);
        for (const part of ['flash', 'task', 'done']) {
          expect(en[`mem.${m.id}.${part}`], `en mem.${m.id}.${part}`).toBeTruthy();
          expect(ru[`mem.${m.id}.${part}`], `ru mem.${m.id}.${part}`).toBeTruthy();
          expect(es[`mem.${m.id}.${part}`], `es mem.${m.id}.${part}`).toBeTruthy();
        }
      }
    }
    // Общий список — без повторов: у каждого места свои ключи текстов, даже если вещь та же (кресло, чайник).
    expect(new Set(ALL_MEMORIES.map((m) => m.id)).size).toBe(ALL_MEMORIES.length);
    expect(ALL_MEMORIES.length).toBe(4 * DEFAULT_SESSION.count);
  });

  it('сессия каждого мира берёт его пять вещей', () => {
    for (const world of WORLD_KINDS) {
      const level = buildLevel(generateLayout(20041113, 2, world));
      const s = new Session(level, 11);
      const ids = new Set(WORLD_MEMORIES[world].map((m) => m.id));
      expect(s.memories).toHaveLength(DEFAULT_SESSION.count);
      for (const m of s.memories) expect(ids.has(m.def.id), `${world}: ${m.def.id}`).toBe(true);
    }
  });

  it('названия новых помещений есть на всех языках', async () => {
    const en = (await import('../locales/en/ui.json')).default as Record<string, string>;
    const ru = (await import('../locales/ru/ui.json')).default as Record<string, string>;
    const es = (await import('../locales/es/ui.json')).default as Record<string, string>;
    for (const d of [en, ru, es]) {
      for (const t of ['lift', 'reception', 'department', 'cubicles', 'meeting', 'breakroom', 'manager', 'files', 'copyroom', 'server', 'hall']) expect(d[`room.${t}`]).toBeTruthy();
      for (const w of WORLD_KINDS) expect(d[`ui.place.${w}`]).toBeTruthy();
    }
  });
});
