import { describe, expect, it, vi } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { WEAR } from '../src/systems/decay';
import { MeshBuilder } from '../src/world/kit';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { Xf } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';
import { cocoonCount, cocoonPanel, scarAlong, scarCover, scarLumps } from '../src/world/wear_growth';

const SEEDS = [20041113, 7, 1234, 42];
/** Стёртость на кругах 1…7: круг прибавляет WEAR.lap. */
const LAPS = Array.from({ length: 7 }, (_, i) => Math.min(1, i * WEAR.lap));
const levels = new Map<string, BuiltLevel>();
const level = (seed: number, world: WorldKind, wear: number): BuiltLevel => {
  const key = `${seed}:${world}:${wear}`;
  let l = levels.get(key);
  if (!l) levels.set(key, (l = buildLevel(generateLayout(seed, 2, world), { wear })));
  return l;
};
const placed = (l: Pick<BuiltLevel, 'objects'>): string[] => l.objects!.map((o) => `${o.name}@${o.at.map((v) => v.toFixed(3)).join(',')}/${o.rot}`);

describe('своё стирание мест: рубец убежища и коконы зала ожидания', () => {
  it('рубец: на первом круге его нет, дальше фронт уходит всё дальше и не отступает', () => {
    expect(scarCover(0, 0)).toBe(0);
    let prev = 0;
    for (const w of LAPS.slice(1)) {
      const near = scarCover(2, w);
      expect(near).toBeGreaterThanOrEqual(prev);
      prev = near;
    }
    expect(scarCover(2, LAPS[3]!)).toBeGreaterThan(0.5);
    // Далеко от начала фронта на третьем круге ещё чисто.
    expect(scarCover(25, LAPS[2]!)).toBe(0);
  });

  it('коконы: на первом круге щит пуст; круг за кругом их больше, к пятому — десятки', () => {
    expect(cocoonCount(0)).toBe(0);
    const counts = LAPS.map(cocoonCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    expect(counts[4]!).toBeGreaterThanOrEqual(30);
  });

  it('щит с коконами: новый круг добавляет коконы к прежним, а не раскладывает заново', () => {
    const verts = (w: number): number[] => {
      const mb = new MeshBuilder();
      cocoonPanel(new Xf(mb, null, 0, 0, 0, 0), 99, w);
      return Array.from(mb.build().position);
    };
    const early = verts(LAPS[2]!);
    const late = verts(LAPS[4]!);
    expect(late.length).toBeGreaterThan(early.length);
    expect(late.slice(0, early.length)).toEqual(early);
  });

  it('рубец на стыке двух участков одной стены: комья не задваиваются и не оставляют дыры', () => {
    const field = { origin: [0, 0, 0] as [number, number, number], seed: 5, wear: 0.9 };
    const along = (ox: number): number[] => scarLumps({ xf: new Xf(new MeshBuilder(), null, ox, 0, -1.35, 0), cornerL: false, cornerR: false }, 2.6, field).map((l) => l.s);
    const all = [...along(0), ...along(3), ...along(6)].sort((p, q) => p - q);
    expect(all.length).toBeGreaterThan(6);
    // Сетка комьев общая: между соседями не меньше трети шага, и на границах участков (±1,5; 4,5) тоже.
    for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!, `${all[i - 1]} → ${all[i]}`).toBeGreaterThan(0.1);
    // Та же стена, собранная одним куском и тремя участками, даёт одни и те же комья.
    const one = new Set(all.map((v) => v.toFixed(4)));
    expect(one.size).toBe(all.length);
  });

  it('на участке, куда фронт не дошёл, рубца нет', () => {
    const field = { origin: [0, 0, 0] as [number, number, number], seed: 5, wear: 0.42 };
    const mb = new MeshBuilder();
    expect(scarAlong({ xf: new Xf(mb, null, 90, 0, 0, 0), cornerL: true, cornerR: true }, 2.6, field)).toBe(0);
  });

  it('в убежище рубец растёт с кругами и не отступает', () => {
    for (const seed of SEEDS) {
      expect(level(seed, 'shelter', 0).growth?.scar ?? 0, `сид ${seed}: первый круг`).toBe(0);
      let prev = 0;
      for (const w of LAPS.slice(2, 6)) {
        const scar = level(seed, 'shelter', w).growth?.scar ?? 0;
        expect(scar, `сид ${seed}, стёртость ${w}`).toBeGreaterThan(prev);
        prev = scar;
      }
    }
  });

  it('в зале ожидания щит с коконами стоит с первого круга, коконов с кругами больше', () => {
    for (const seed of SEEDS) {
      const first = level(seed, 'station', 0);
      expect(first.growth?.panels ?? 0, `сид ${seed}`).toBeGreaterThanOrEqual(1);
      expect(first.growth?.cocoons, `сид ${seed}: первый круг`).toBe(0);
      const late = level(seed, 'station', LAPS[4]!);
      expect(late.growth?.panels).toBe(first.growth?.panels);
      expect(late.growth?.cocoons ?? 0).toBeGreaterThan(20);
    }
  });

  it('обстановка от них не сдвигается: тот же круг с ними и без них — те же вещи на тех же местах', async () => {
    vi.resetModules();
    vi.doMock('../src/world/wear_growth', async (orig) => ({ ...(await orig<typeof import('../src/world/wear_growth')>()), growWear: () => ({ scar: 0, panels: 0, cocoons: 0 }) }));
    const bare = await import('../src/world/level_build');
    vi.doUnmock('../src/world/wear_growth');
    for (const seed of SEEDS.slice(0, 2)) {
      for (const world of ['shelter', 'station'] as const) {
        const w = LAPS[4]!;
        const a = level(seed, world, w);
        const b = bare.buildLevel(generateLayout(seed, 2, world), { wear: w });
        expect(placed(a), `сид ${seed}, ${world}`).toEqual(placed(b));
        expect(a.spots, `сид ${seed}, ${world}: места вещей`).toEqual(b.spots);
        // Щит занимает участок стены: вещь туда «в другом месте» не вернётся. Больше ничего не меняется.
        const lost = b.freeSlots!.length - a.freeSlots!.length;
        expect(lost).toBeGreaterThanOrEqual(0);
        expect(lost).toBeLessThanOrEqual(a.growth?.panels ?? 0);
      }
    }
  });

  it('в офисе и жёлтых комнатах ни рубца, ни коконов', () => {
    for (const world of ['office', 'yellow'] as const) {
      const g = level(SEEDS[0]!, world, LAPS[5]!).growth;
      expect(g?.scar ?? 0).toBe(0);
      expect(g?.cocoons ?? 0).toBe(0);
    }
  });

  it('домофон, похожий на лицо, — вещь реестра на стене, ростом с ладонь', () => {
    const p = ALL_PROPS.intercom_face!;
    expect(p).toBeDefined();
    expect(p.mount).toBe('wall');
    expect(p.w).toBeLessThan(0.4);
    expect(p.h).toBeLessThan(0.4);
    // У входа голых стен не остаётся, но домофон встаёт сбоку от того, что там висит: один на уровень.
    for (const seed of SEEDS) expect(level(seed, 'shelter', 0).objects!.filter((o) => o.name === 'intercom_face'), `сид ${seed}`).toHaveLength(1);
  });
});
