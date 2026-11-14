import { describe, expect, it } from 'vitest';
import { generateLayout, WORLD_KINDS } from '../src/gen/layout';
import type { GenLayout, WorldKind } from '../src/gen/layout';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from '../src/player/controller';
import type { PlayerBody } from '../src/player/controller';
import { panelDead } from '../src/systems/cell_lights';
import { ALL_MEMORIES, DEFAULT_SESSION, MEMORIES, OFFICE_MEMORIES, Session, WORLD_MEMORIES, YELLOW_MEMORIES } from '../src/systems/session';
import type { ColliderSet } from '../src/world/colliders';
import type { BuiltLevel, NavNode } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { MAT, MAT_COUNT } from '../src/world/materials';
import { ENV_BUNKER, ENV_OFFICE, ENV_YELLOW, WORLD_ENV } from '../src/world/pockets';
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
    expect(WORLD_KINDS).toEqual(['shelter', 'office', 'yellow']);
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
        expect(tris, `${world} ${seed}`).toBeLessThan(world === 'office' ? 90000 : 45000);
        expect(level.zones).toHaveLength(0);
        expect(level.collapses).toHaveLength(0);
        expect(level.variants).toHaveLength(0);
      }
    }
  });

  it('в каждой клетке — потолочная панель: в офисе все горят, в жёлтых комнатах мёртвые — без светящейся грани', () => {
    for (const world of NEW) {
      const layout = generateLayout(20041113, 2, world);
      const level = buildLevel(layout);
      // Сколько светящихся треугольников (материал «светильник») приходится на клетку.
      const lampTris = level.chunks.reduce((n, c) => {
        let k = 0;
        for (let i = 0; i < c.mesh.index.length; i += 3) if (c.mesh.mat[c.mesh.index[i]!] === MAT.lamp) k += 1;
        return n + k;
      }, 0);
      const cells = layout.rooms.reduce((n, r) => n + r.cells.length, 0);
      const dead = world === 'yellow' ? layout.rooms.reduce((n, r) => n + r.cells.filter(([x, z]) => r.type !== 'lift' && r.type !== 'reception' && panelDead(layout.seed, x, z)).length, 0) : 0;
      expect(lampTris).toBeGreaterThanOrEqual((cells - dead) * 2);
      if (world === 'yellow') {
        expect(dead).toBeGreaterThan(2);
        // Мёртвых панелей столько, что светящихся граней заметно меньше, чем клеток с живыми панелями было бы при всех живых.
        expect(lampTris).toBeLessThan(cells * 2 * 6);
      }
    }
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
  it('у каждого мира своё окружение: в убежище темно, в офисе чисто и светят датчики, в жёлтых комнатах гудит жёлтый свет', () => {
    expect(WORLD_ENV.shelter).toBe(ENV_BUNKER);
    expect(WORLD_ENV.office).toBe(ENV_OFFICE);
    expect(WORLD_ENV.yellow).toBe(ENV_YELLOW);
    expect(ENV_BUNKER.cells).toBeUndefined();
    expect(ENV_OFFICE.cells).toBe('sensor');
    expect(ENV_YELLOW.cells).toBe('hum');
    // Чистота офиса — отрицательная запущенность; жёлтые комнаты сыроваты.
    expect(ENV_OFFICE.decay).toBeLessThan(0);
    expect(ENV_YELLOW.decay).toBeGreaterThan(0.1);
    // Жёлтый свет: красного и зелёного заметно больше синего.
    expect(ENV_YELLOW.ambient[0]).toBeGreaterThan(ENV_YELLOW.ambient[2] * 2);
    // Вокруг освещённого острова — чернота.
    expect(ENV_OFFICE.fog).toEqual([0, 0, 0]);
  });

  it('у каждого мира свой набор воспоминаний; у каждого воспоминания есть вещь в реестре и тексты на двух языках', async () => {
    setThingRegistry(ALL_PROPS);
    expect(WORLD_MEMORIES.shelter).toBe(MEMORIES);
    expect(WORLD_MEMORIES.office).toBe(OFFICE_MEMORIES);
    expect(WORLD_MEMORIES.yellow).toBe(YELLOW_MEMORIES);
    const en = (await import('../locales/en/ui.json')).default as Record<string, string>;
    const ru = (await import('../locales/ru/ui.json')).default as Record<string, string>;
    for (const pool of [OFFICE_MEMORIES, YELLOW_MEMORIES]) {
      expect(pool.length).toBeGreaterThanOrEqual(DEFAULT_SESSION.count + 2);
      expect(new Set(pool.map((m) => m.id)).size).toBe(pool.length);
      for (const m of pool) {
        expect(hasThing(m.thing), `${m.id}: нет вещи ${m.thing}`).toBe(true);
        for (const part of ['flash', 'task', 'done']) {
          expect(en[`mem.${m.id}.${part}`], `en mem.${m.id}.${part}`).toBeTruthy();
          expect(ru[`mem.${m.id}.${part}`], `ru mem.${m.id}.${part}`).toBeTruthy();
        }
      }
    }
    // Общий список — без повторов: кресло и телефон есть и в офисе, и в жёлтых комнатах, но считаются один раз.
    expect(new Set(ALL_MEMORIES.map((m) => m.id)).size).toBe(ALL_MEMORIES.length);
    expect(ALL_MEMORIES.length).toBe(MEMORIES.length + OFFICE_MEMORIES.length + 1);
  });

  it('сессия в офисе берёт воспоминания офиса, в жёлтых комнатах — свои; в убежище — прежние', () => {
    for (const world of WORLD_KINDS) {
      const level = buildLevel(generateLayout(20041113, 2, world));
      const s = new Session(level, 11);
      const ids = new Set(WORLD_MEMORIES[world].map((m) => m.id));
      expect(s.memories).toHaveLength(DEFAULT_SESSION.count);
      for (const m of s.memories) expect(ids.has(m.def.id), `${world}: ${m.def.id}`).toBe(true);
    }
  });

  it('названия новых помещений есть на обоих языках', async () => {
    const en = (await import('../locales/en/ui.json')).default as Record<string, string>;
    const ru = (await import('../locales/ru/ui.json')).default as Record<string, string>;
    for (const t of ['lift', 'reception', 'department', 'cubicles', 'meeting', 'breakroom', 'manager', 'files', 'copyroom', 'server', 'hall']) {
      expect(en[`room.${t}`]).toBeTruthy();
      expect(ru[`room.${t}`]).toBeTruthy();
    }
    for (const w of WORLD_KINDS) {
      expect(en[`ui.place.${w}`]).toBeTruthy();
      expect(ru[`ui.place.${w}`]).toBeTruthy();
    }
  });
});
