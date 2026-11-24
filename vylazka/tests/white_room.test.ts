import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel, whiteRolled } from '../src/world/level_build';
import { CHAIN, chainLoop, lemniscate, touchesChain } from '../src/world/furnish_white';
import { FIGURES } from '../src/world/figures_data';
import { PLACED, REMOVED } from '../src/world/placed_data';
import { WARP, warpAt, warpOn } from '../src/systems/warp';

/**
 * Белая комната (партнёр 21.11, 19:06: «абсолютно белая яркая комната с висящим металической цепью в форме знака
 * бесконечности, задевая который камеру игрока перекручивает и весь мир становится широкоугольными на 5 секунд»;
 * design.md, §37; world/furnish_white.ts).
 */
const cache = new Map<string, ReturnType<typeof buildLevel> & { layout: ReturnType<typeof generateLayout> }>();
function level(world: WorldKind, seed: number, rank: 1 | 2 | 3 = 2) {
  const k = `${world}/${seed}/${rank}`;
  let l = cache.get(k);
  if (!l) {
    const layout = generateLayout(seed, rank, world);
    l = { ...buildLevel(layout), layout };
    cache.set(k, l);
  }
  return l;
}
/** Сиды, где жребий белой комнаты выпал и где нет. */
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 37);
const rolled = SEEDS.filter((s) => whiteRolled(s));
const partnerTypes = (world: WorldKind): Set<string> =>
  new Set([...[...PLACED, ...FIGURES].filter((s) => s.rule.worlds.includes(world)).flatMap((s) => s.rule.rooms), ...REMOVED.filter((r) => r.worlds.includes(world)).flatMap((r) => r.rooms)]);

describe('белая комната на уровне', () => {
  it('жребий выпадает примерно в половине уровней', () => {
    expect(rolled.length).toBeGreaterThan(SEEDS.length * 0.3);
    expect(rolled.length).toBeLessThan(SEEDS.length * 0.7);
  });

  it.each(['shelter', 'office', 'yellow'] as const)('%s: выпала — комната есть почти всегда; нет — нет', (world) => {
    let have = 0;
    for (const s of SEEDS.slice(0, 16)) {
      const l = level(world, s);
      if (!whiteRolled(s)) expect(l.whiteRoom, `сид ${s}`).toBeUndefined();
      else if (l.whiteRoom) have++;
    }
    const want = SEEDS.slice(0, 16).filter((s) => whiteRolled(s)).length;
    // Квадратных помещений без вещей партнёра в офисе мало: там комната выпадает реже (партнёр 24.11: только квадратная).
    expect(have).toBeGreaterThanOrEqual(Math.ceil(want * (world === 'office' ? 0.3 : 0.75)));
  });

  it('в зале ожидания белой комнаты нет', () => {
    for (const s of rolled.slice(0, 4)) expect(level('station', s).whiteRoom).toBeUndefined();
  });

  it.each(['shelter', 'office', 'yellow'] as const)('%s: квадратная, сторона в две-три клетки, не особое помещение и не помещение партнёра', (world) => {
    const pt = partnerTypes(world);
    for (const s of rolled.slice(0, 6)) {
      const l = level(world, s);
      const w = l.whiteRoom;
      if (!w) continue;
      const room = l.layout.rooms[w.room]!;
      expect([4, 9]).toContain(room.cells.length);
      const xs = room.cells.map((c) => c[0]);
      const zs = room.cells.map((c) => c[1]);
      expect((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...zs) - Math.min(...zs) + 1)).toBe(room.cells.length);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(Math.max(...zs) - Math.min(...zs));
      expect(w.room).not.toBe(l.layout.entranceRoom);
      expect([l.greenRoom, l.skyRoom, l.grassRoom]).not.toContain(w.room);
      expect(['corridor', 'department', 'collapsed', 'stairwell', 'lift']).not.toContain(room.type);
      expect(pt.has(room.type), `партнёр ставит вещи в ${room.type}`).toBe(false);
      // Коробка — по клеткам помещения: 3 м на клетку.
      expect((w.box[2] - w.box[0]) * (w.box[3] - w.box[1])).toBeCloseTo(room.cells.length * 9, 5);
      expect(w.y[1] - w.y[0]).toBeGreaterThan(2.4);
    }
  });

  it.each(['shelter', 'office', 'yellow'] as const)('%s: пусто — ни мебели, ни мест для вещей, ни бумаги и наклеек', (world) => {
    for (const s of rolled.slice(0, 6)) {
      const l = level(world, s);
      const w = l.whiteRoom;
      if (!w) continue;
      const inside = (p: readonly number[]): boolean => p[0]! > w.box[0] && p[0]! < w.box[2] && p[2]! > w.box[1] && p[2]! < w.box[3] && p[1]! > w.y[0] - 0.5 && p[1]! < w.y[1] + 0.5;
      expect(l.spots.filter((sp) => sp.room === w.room)).toEqual([]);
      expect((l.objects ?? []).filter((o) => inside(o.at)).map((o) => o.name)).toEqual([]);
      expect((l.flats ?? []).filter((f) => inside(f.at)).length).toBe(0);
    }
  });

  it.each(['shelter', 'office', 'yellow'] as const)('%s: цепь посередине на уровне глаз, лицом к проходу, без цепочки к потолку', (world) => {
    for (const s of rolled.slice(0, 6)) {
      const l = level(world, s);
      const w = l.whiteRoom;
      if (!w) continue;
      const c = w.chain;
      expect(c.at[0]).toBeCloseTo((w.box[0] + w.box[2]) / 2, 5);
      expect(c.at[2]).toBeCloseTo((w.box[1] + w.box[3]) / 2, 5);
      expect(c.at[1] - w.y[0]).toBeCloseTo(CHAIN.height, 5);
      expect(c.top).toBeCloseTo(w.y[1], 5);
      expect(Math.hypot(c.face[0], c.face[1])).toBeCloseTo(1, 6);
      // Знак целиком в комнате, с запасом от стен.
      for (const q of chainLoop(c, 0.05)) {
        expect(q.p[0]).toBeGreaterThan(w.box[0] + 0.3);
        expect(q.p[0]).toBeLessThan(w.box[2] - 0.3);
        expect(q.p[2]).toBeGreaterThan(w.box[1] + 0.3);
        expect(q.p[2]).toBeLessThan(w.box[3] - 0.3);
      }
    }
  });
});

describe('цепь знаком бесконечности', () => {
  const c = { at: [0, 1.46, 0] as [number, number, number], face: [0, 1] as [number, number], a: CHAIN.a, top: 2.7 };

  it('лемниската: перекрестье в середине, ширина 2a, высота около 0,7a', () => {
    expect(lemniscate(Math.PI / 2, 1)[0]).toBeCloseTo(0, 9);
    expect(lemniscate(0, 1)[0]).toBeCloseTo(1, 9);
    let hi = 0;
    for (let i = 0; i < 1000; i++) hi = Math.max(hi, lemniscate((i / 1000) * Math.PI * 2, 1)[1]);
    expect(hi).toBeGreaterThan(0.33);
    expect(hi).toBeLessThan(0.37);
  });

  it('звенья — равным шагом по длине знака, касательные единичные и лежат в плоскости знака', () => {
    const loop = chainLoop(c);
    expect(loop.length).toBeGreaterThan(80);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const d = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
      // На перекрестье соседние по длине звенья идут разными ветвями — но шаг между ними тот же.
      expect(d).toBeLessThan(CHAIN.pitch * 1.15);
      expect(Math.hypot(...a.t)).toBeCloseTo(1, 6);
      // Лицо — +z: в плоскости знака у точек z = 0.
      expect(a.p[2]).toBeCloseTo(0, 9);
    }
  });

  it('касание: тело в знаке — касается; в метре сбоку или под ним (присел бы — нет) — нет', () => {
    expect(touchesChain(c, 0.5, 0, 0, 0.3)).toBe(true);
    expect(touchesChain(c, 0, 0, 0, 0.3)).toBe(true);
    expect(touchesChain(c, 0, 0, 1.2, 0.3)).toBe(false);
    expect(touchesChain(c, 1.4, 0, 0, 0.3)).toBe(false);
    // Голова ниже знака (h = 1,0) — не касается.
    expect(touchesChain(c, 0.5, 0, 0, 0.3, 1.0)).toBe(false);
  });
});

describe('перекрут (systems/warp.ts)', () => {
  it('оборот камеры: с нуля до полного за 1,4 с, мягко на концах, в обе стороны', () => {
    expect(warpAt(0, false).roll).toBeCloseTo(0, 9);
    expect(warpAt(WARP.spin / 2, false, 1).roll).toBeCloseTo(Math.PI, 6);
    expect(warpAt(WARP.spin / 2, false, -1).roll).toBeCloseTo(-Math.PI, 6);
    expect(warpAt(WARP.spin, false).roll).toBeCloseTo(Math.PI * 2, 6);
    // Без рывка: за первый кадр (1/60 с) камера поворачивается меньше чем на сотую радиана.
    expect(Math.abs(warpAt(1 / 60, false).roll)).toBeLessThan(0.01);
  });

  it('обзор: раскрыт к 0,6 с, держится до пятой секунды, сходится к 5,9 с', () => {
    expect(warpAt(0, false).fov).toBeCloseTo(1, 9);
    expect(warpAt(WARP.open, false).fov).toBeCloseTo(WARP.fov, 6);
    expect(warpAt(3, false).fov).toBeCloseTo(WARP.fov, 6);
    expect(warpAt(WARP.hold, false).fov).toBeCloseTo(WARP.fov, 6);
    expect(warpAt(WARP.hold + WARP.close / 2, false).fov).toBeLessThan(WARP.fov);
    expect(warpAt(WARP.hold + WARP.close, false).fov).toBe(1);
    expect(warpOn(WARP.hold + WARP.close - 0.01)).toBe(true);
    expect(warpOn(WARP.hold + WARP.close)).toBe(false);
    expect(warpOn(-1)).toBe(false);
  });

  it('тихий режим: камеру только ведёт, обзор вполовину', () => {
    for (let t = 0; t < 6; t += 0.05) expect(Math.abs(warpAt(t, true).roll)).toBeLessThanOrEqual(WARP.calmTilt + 1e-9);
    expect(warpAt(3, true).fov).toBeCloseTo(1 + (WARP.fov - 1) / 2, 6);
    expect(warpAt(3, true).lens).toBeCloseTo(WARP.lens / 2, 6);
  });
});
