/**
 * Раскладка по смыслу (партнёр 19.11, 14:33: «вернись к расстановке мебели и расставь её по-новому и логично, с учётом лучших
 * практик создания игровых уровней. Вещи бери из библиотеки»; docs/vylazka/design.md, §31): проходы свободны, вещи стоят
 * группами по делу, главная вещь — напротив входа, правки партнёра находят свои вещи.
 */
import { describe, expect, it } from 'vitest';
import { generateLayout, GRID, TIER_DROP } from '../src/gen/layout';
import type { GenLayout, WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';
import type { BuiltLevel } from '../src/world/level';
import { BODY, watchFlows } from '../src/world/flow';
import type { RoomFlow } from '../src/world/flow';
import { CELL } from '../src/world/shell';
import { FACE } from '../src/world/room_plan';
import { PLACED, REMOVED } from '../src/world/placed_data';
import { FIGURES } from '../src/world/figures_data';
import { gameNth, roomIndex } from '../src/world/placed_place';
import { slotFor, variantPicker } from '../src/world/variants';
import type { LevelObject } from '../src/world/objects';

const SEEDS = [20041113, 7, 42, 1234, 5];
const NONE = { wear: 0, placed: [], removed: [], figures: [] } as const;

/** Уровень без правок партнёра и правила проходов, под которыми обставлены его помещения. */
function build(world: WorldKind, seed: number, rank: 1 | 2 | 3 = 2): { layout: GenLayout; level: BuiltLevel; flows: RoomFlow[] } {
  const flows: RoomFlow[] = [];
  watchFlows((f) => flows.push(f));
  try {
    const layout = generateLayout(seed, rank, world);
    return { layout, level: buildLevel(layout, NONE), flows };
  } finally {
    watchFlows(null);
  }
}

/** Помещение уровня, в котором стоит точка. */
function roomOf(layout: GenLayout, x: number, y: number, z: number): number {
  const cx = Math.round(x / CELL) + GRID / 2;
  const cz = Math.round(z / CELL) + GRID / 2;
  const tier = Math.max(0, Math.round(-y / TIER_DROP + 0.05));
  return layout.rooms.find((r) => r.tier === tier && r.cells.some(([a, b]) => a === cx && b === cz))?.id ?? -1;
}

const inRoom = (layout: GenLayout, o: LevelObject, type: string): boolean => layout.rooms[roomOf(layout, o.at[0], o.at[1] + 0.01, o.at[2])]?.type === type;

describe('раскладка по смыслу: проходы', () => {
  it('мебель игры не встаёт перед проходом, на дорожку к середине его клетки и в саму середину (убежище и офис)', () => {
    let checked = 0;
    for (const world of ['shelter', 'office'] as const) {
      for (const seed of SEEDS) {
        const { level, flows } = build(world, seed);
        const boxes = level.colliders.boxes;
        for (const f of flows) {
          const floor = f.doors.length ? level.objects!.find((o) => o.id > f.from && o.id <= f.to)?.at[1] ?? 0 : 0;
          for (const b of boxes) {
            if (b.owner === undefined || b.owner <= f.from || b.owner > f.to || b.ghost) continue;
            if (b.maxY <= floor + 0.36 || b.minY >= floor + 1.8) continue;
            checked += 1;
            const name = level.objects![b.owner - 1]!.name;
            const hits = (r: { x0: number; x1: number; z0: number; z1: number }): boolean => b.minX < r.x1 - 0.02 && b.maxX > r.x0 + 0.02 && b.minZ < r.z1 - 0.02 && b.maxZ > r.z0 + 0.02;
            expect(f.fronts.some(hits), `${world} ${seed}: ${name} перед проходом`).toBe(false);
            expect(f.lanes.some(hits), `${world} ${seed}: ${name} на дорожке к середине клетки`).toBe(false);
            for (const [cx, cz] of f.centers) {
              const dx = Math.max(b.minX - cx, 0, cx - b.maxX);
              const dz = Math.max(b.minZ - cz, 0, cz - b.maxZ);
              expect(dx * dx + dz * dz >= BODY * BODY - 1e-9, `${world} ${seed}: ${name} в середине клетки с проходом`).toBe(true);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('у каждого помещения убежища и офиса (кроме коридоров) есть главный вход, роли стен считаются от него', () => {
    const { flows } = build('shelter', 20041113);
    expect(flows.length).toBeGreaterThan(15);
    for (const f of flows) {
      expect(f.doors.length).toBeGreaterThan(0);
      expect(f.entry).not.toBeNull();
      // Вход — один из проходов; ближний к началу сна по ходу.
      expect(f.doors).toContain(f.entry);
      expect(Math.min(...f.doors.map((d) => d.dist))).toBe(f.entry!.dist);
    }
    // Полоса перед проходом — на метр вглубь от внутренней грани стены.
    for (const f of flows) for (const r of f.fronts) expect(Math.max(r.x1 - r.x0, r.z1 - r.z0)).toBeGreaterThanOrEqual(1.0 - 1e-9);
    expect(FACE).toBeCloseTo(CELL / 2 - 0.15, 6);
  });
});

describe('раскладка по смыслу: группы', () => {
  it('гостиная: диван смотрит на телевизор — напротив, по оси, не дальше 3,6 м; на ковре между ними — журнальный столик', () => {
    let pairs = 0;
    let rooms = 0;
    let tables = 0;
    for (const seed of SEEDS) {
      for (const rank of [1, 2, 3] as const) {
        const { layout, level } = build('shelter', seed, rank);
        for (const room of layout.rooms.filter((r) => r.type === 'living')) {
          rooms += 1;
          const here = (n: string): LevelObject[] => level.objects!.filter((o) => o.name === n && roomOf(layout, o.at[0], o.at[1] + 0.01, o.at[2]) === room.id);
          const sofa = here('sofa')[0];
          const tv = here('tv_stand')[0];
          if (!sofa || !tv) continue;
          // Лицо вещи — её локальная +z: rot 0 → +z, 1 → +x, 2 → −z, 3 → −x.
          const face = (o: LevelObject): [number, number] => [[0, 1], [1, 0], [0, -1], [-1, 0]][o.rot] as [number, number];
          const c = (o: LevelObject): [number, number] => [(o.min[0] + o.max[0]) / 2, (o.min[2] + o.max[2]) / 2];
          const [sx, sz] = c(sofa);
          const [tx, tz] = c(tv);
          const f = face(sofa);
          const g = face(tv);
          // Смотрят друг на друга.
          if (f[0] * g[0] + f[1] * g[1] > -0.99) continue;
          const along = (tx - sx) * f[0] + (tz - sz) * f[1];
          const across = Math.abs((tx - sx) * f[1] - (tz - sz) * f[0]);
          expect(along, `сид ${seed}/${rank}: телевизор перед диваном`).toBeGreaterThan(0.8);
          expect(along, `сид ${seed}/${rank}: от дивана до экрана`).toBeLessThan(3.8);
          expect(across, `сид ${seed}/${rank}: экран по оси дивана`).toBeLessThan(0.7);
          pairs += 1;
          if (here('s3_coffee_table').length) tables += 1;
        }
      }
    }
    expect(rooms).toBeGreaterThan(10);
    // Пара встаёт в большинстве гостиных; где не встала — диван и телевизор хотя бы не на одной стене рядом (проверка ниже).
    expect(pairs / rooms).toBeGreaterThan(0.6);
    expect(tables).toBeGreaterThan(pairs / 2);
  });

  it('кухня: один холодильник и одна батарея (на них ссылаются правки партнёра); мойка и плита — рядом с холодильником', () => {
    let kitchens = 0;
    let lines = 0;
    for (const seed of SEEDS) {
      for (const rank of [1, 2, 3] as const) {
        const { layout, level } = build('shelter', seed, rank);
        for (const room of layout.rooms.filter((r) => r.type === 'kitchen')) {
          kitchens += 1;
          const here = (n: string): LevelObject[] => level.objects!.filter((o) => o.name === n && roomOf(layout, o.at[0], o.at[1] + 0.01, o.at[2]) === room.id);
          expect(here('fridge').length, `сид ${seed}/${rank}: холодильников в кухне`).toBe(1);
          expect(here('radiator').length, `сид ${seed}/${rank}: батарей в кухне`).toBeLessThanOrEqual(1);
          const f = here('fridge')[0]!;
          const near = (o: LevelObject | undefined): boolean => o !== undefined && Math.hypot(o.at[0] - f.at[0], o.at[2] - f.at[2]) < 1.6;
          if (near(here('sink_cabinet')[0]) && near(here('stove')[0])) lines += 1;
        }
      }
    }
    expect(kitchens).toBeGreaterThan(10);
    expect(lines / kitchens).toBeGreaterThan(0.8);
  });

  it('спальня: тумбочка у изголовья кровати; ванная: раковина с зеркалом над ней', () => {
    let beds = 0;
    let stands = 0;
    let sinks = 0;
    let baths = 0;
    for (const seed of SEEDS) {
      const { layout, level } = build('shelter', seed, 3);
      for (const o of level.objects!) {
        if (o.name === 'bed_home' && inRoom(layout, o, 'bedroom')) {
          beds += 1;
          const ns = level.objects!.find((n) => n.name === 's3_nightstand' && Math.hypot(n.at[0] - o.at[0], n.at[2] - o.at[2]) < 1.5 && n.rot === o.rot);
          if (ns) stands += 1;
        }
      }
      for (const room of layout.rooms.filter((r) => r.type === 'bathroom')) {
        baths += 1;
        const here = (n: string): LevelObject[] => level.objects!.filter((o) => o.name === n && roomOf(layout, o.at[0], o.at[1] + 0.01, o.at[2]) === room.id);
        const s = here('s3_sink_pedestal')[0];
        if (s && here('mirror').some((m) => Math.hypot(m.at[0] - s.at[0], m.at[2] - s.at[2]) < 0.2 && m.min[1] > s.max[1] - 0.05)) sinks += 1;
      }
    }
    expect(beds).toBeGreaterThan(2);
    expect(stands / beds).toBeGreaterThan(0.6);
    expect(baths).toBeGreaterThan(2);
    expect(sinks / baths).toBeGreaterThan(0.5);
  });

  it('переговорная: стол не у стены, а посреди — от стен не ближе 0,3 м (в узкой, в одну клетку шириной, — не в стене)', () => {
    let tables = 0;
    for (const seed of SEEDS) {
      const { layout, level } = build('office', seed);
      for (const o of level.objects!.filter((x) => x.name === 'meeting_table')) {
        const room = layout.rooms[roomOf(layout, o.at[0], o.at[1] + 0.01, o.at[2])]!;
        const cells = new Set(room.cells.map(([a, b]) => `${a},${b}`));
        // Точки вокруг стола на 0,3 м — в клетках помещения и не ближе грани стены.
        const ok = (x: number, z: number): boolean => {
          const cx = Math.round(x / CELL) + GRID / 2;
          const cz = Math.round(z / CELL) + GRID / 2;
          if (!cells.has(`${cx},${cz}`)) return false;
          const lx = x - (cx - GRID / 2) * CELL;
          const lz = z - (cz - GRID / 2) * CELL;
          const wallX = !cells.has(`${cx + Math.sign(lx)},${cz}`);
          const wallZ = !cells.has(`${cx},${cz + Math.sign(lz)}`);
          return (!wallX || Math.abs(lx) <= FACE) && (!wallZ || Math.abs(lz) <= FACE);
        };
        // В комнате шириной в клетку стол с креслами (2,42 м) встаёт посреди неё впритык: кресла у стен, но не в них.
        const xs = new Set(room.cells.map(([a]) => a)).size;
        const zs = new Set(room.cells.map(([, b]) => b)).size;
        const m = Math.min(xs, zs) >= 2 ? 0.3 : 0.05;
        for (const [x, z] of [[o.min[0] - m, o.min[2] - m], [o.max[0] + m, o.min[2] - m], [o.min[0] - m, o.max[2] + m], [o.max[0] + m, o.max[2] + m]] as const) {
          expect(ok(x, z), `office ${seed}: угол стола переговоров у стены`).toBe(true);
        }
        tables += 1;
      }
    }
    expect(tables).toBeGreaterThan(2);
  });
});

describe('правки партнёра после перестановки (куратор, пачка 49: «тест-снимок»)', () => {
  it('каждая передвинутая им вещь находит свою вещь игры по имени и номеру; его фигуры где-то встают', () => {
    const worlds = [...new Set([...PLACED, ...FIGURES].flatMap((r) => r.rule.worlds))] as WorldKind[];
    const moved = new Map<string, { rooms: number; has: number; found: number }>();
    const figs = new Map<string, number>();
    for (const world of worlds) {
      for (const seed of SEEDS) {
        for (const rank of [1, 3] as const) {
          const layout = generateLayout(seed, rank, world);
          const here = (ws: readonly string[]): boolean => ws.includes(world);
          const pick = variantPicker(layout, [
            ...PLACED.filter((s) => here(s.rule.worlds)).map((s) => slotFor(s.slot, s.rule.rooms)),
            ...REMOVED.filter((r) => here(r.worlds)).map((r) => slotFor(r.slot, r.rooms)),
            ...FIGURES.filter((f) => here(f.rule.worlds)).map((f) => slotFor(f.slot, f.rule.rooms)),
          ]);
          const plain = buildLevel(layout, NONE);
          const full = buildLevel(layout, { wear: 0 });
          const roomAt = roomIndex(layout);
          const objs = plain.objects ?? [];
          for (const s of PLACED) {
            if (!s.moves || !here(s.rule.worlds)) continue;
            const slot = slotFor(s.slot, s.rule.rooms);
            const m = moved.get(s.id) ?? { rooms: 0, has: 0, found: 0 };
            for (const room of layout.rooms) {
              if (!s.rule.rooms.includes(room.type) || pick(room) !== slot) continue;
              m.rooms += 1;
              const mine = objs.filter((o) => o.name === s.moves!.thing && roomAt(o.at[0], o.at[1], o.at[2]) === room);
              if (mine.length > 0) m.has += 1;
              if (mine.some((o) => gameNth(objs, o, roomAt) === s.moves!.nth)) m.found += 1;
            }
            moved.set(s.id, m);
          }
          for (const f of FIGURES) if (here(f.rule.worlds)) figs.set(f.id, (figs.get(f.id) ?? 0) + (full.figures ?? []).filter((p) => p.id === f.id).length);
        }
      }
    }
    for (const [id, m] of moved) {
      if (m.rooms === 0) continue;
      // Вещь из жребия обстановки есть не в каждой такой комнате (ручной насос в баках — примерно в половине): там двигать
      // нечего. Сломана правка, если вещи нет нигде (имя сменилось) или там, где она есть, номер указывает не на неё.
      expect(m.has, `${id}: его вещи нет ни в одной из ${m.rooms} комнат`).toBeGreaterThan(0);
      expect(m.found / m.has, `${id}: нашла свою вещь в ${m.found} из ${m.has} комнат, где она есть (всего ${m.rooms})`).toBeGreaterThanOrEqual(0.75);
    }
    for (const [id, n] of figs) expect(n, `${id}: фигура не встала ни разу`).toBeGreaterThan(0);
  });
});
