/**
 * Мебель не врастает в соседнюю (партнёр 18.11: «убери врастание мебели в соседнюю»; куратор, противоречие 255).
 * Правило — world/clearance.ts; откат вещи, которая врастала, — world/objects.ts; раскладка, которая ищет другое место, —
 * world/furnish.ts. Модели полки подключены: преграды открытых дверец и ящиков — тоже преграды.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { growth, GROW_TOL, TUCK, tucked, watchGrowth } from '../src/world/clearance';
import { ColliderSet } from '../src/world/colliders';
import type { Aabb } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { registerModels } from '../src/world/models';
import type { PlacedSpec, RemovedSpec } from '../src/world/placed';
import { roomIndex } from '../src/world/placed_place';
import { Xf } from '../src/world/props';
import { SAND3D_DATA } from '../src/world/sand3d_data';

beforeAll(() => registerModels(SAND3D_DATA));

const WORLDS: WorldKind[] = ['shelter', 'office', 'yellow', 'station'];
const SEEDS = [20041113, 7, 42];

/** Пары вещей уровня, чьи преграды заходят друг в друга глубже допуска (стул под столом — до TUCK — не в счёт). */
function grown(lvl: BuiltLevel): string[] {
  const objs = lvl.objects ?? [];
  const boxes = lvl.colliders.boxes.filter((b) => b.owner !== undefined && b.owner > 0 && !b.off && !b.ghost && !b.partner);
  const out: string[] = [];
  const near: Aabb[] = [];
  for (const a of boxes) {
    for (const b of lvl.colliders.query(a.minX, a.minZ, a.maxX, a.maxZ, near)) {
      if (b.owner === undefined || b.owner <= 0 || b.owner <= a.owner! || b.ghost || b.partner) continue;
      const depth = growth(a, b);
      if (depth <= GROW_TOL) continue;
      const na = objs[a.owner! - 1]?.name ?? '?';
      const nb = objs[b.owner - 1]?.name ?? '?';
      if (depth <= TUCK && tucked(na, nb)) continue;
      out.push(`${na} × ${nb}: ${depth.toFixed(2)} м`);
    }
  }
  return out;
}

describe('мебель не врастает в соседнюю', () => {
  it.each(WORLDS.flatMap((w) => SEEDS.map((s) => [w, s] as const)))('%s, сид %i: ни одна вещь игры не заходит в соседнюю', (w, seed) => {
    const lvl = buildLevel(generateLayout(seed, 2, w), { wear: 0, figures: [] });
    expect(grown(lvl)).toEqual([]);
  });

  it('стул и табурет под столом — можно, глубже полуметра — нет; прочие пары — не глубже 5 см', () => {
    expect(tucked('s3_chair_ladder', 's3_desk_green')).toBe(true);
    expect(tucked('s3_table_work', 's3_stool_wood')).toBe(true);
    expect(tucked('s3_stool_wood', 's3_bunk_black')).toBe(false);
    expect(tucked('wardrobe', 'bed_home')).toBe(false);
    const a: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    expect(growth(a, { minX: 0.9, minY: 0, minZ: 0, maxX: 2, maxY: 1, maxZ: 1 })).toBeCloseTo(0.1, 5);
    // Разошлись по высоте — не врастают.
    expect(growth(a, { minX: 0.5, minY: 0.96, minZ: 0, maxX: 2, maxY: 2, maxZ: 1 })).toBe(0);
  });

  it('врастание — правда отказ: на уровнях убежища правило не пускает нары в нары у угла и шкафчики в нары', () => {
    const seen = new Set<string>();
    watchGrowth((name, other) => seen.add(`${name} ← ${other}`));
    try {
      for (const seed of SEEDS) for (const rank of [1, 2, 3] as const) buildLevel(generateLayout(seed, rank, 'shelter'), { wear: 0, figures: [] });
    } finally {
      watchGrowth(null);
    }
    expect([...seen].some((k) => /^s3_bunk_\w+ ← s3_bunk_/.test(k) || /^s3_locker_olive ← s3_bunk_/.test(k)), [...seen].join('; ')).toBe(true);
  });
});

describe('откат вещи, которая не встала', () => {
  it('сетка возвращается к отметке: вершины, треугольники и листы', () => {
    const mb = new MeshBuilder();
    const xf = new Xf(mb, null, 0, 0, 0);
    xf.box([0, 0, 0], [1, 1, 1], 1);
    const before = mb.build();
    const mark = mb.mark();
    xf.box([2, 0, 0], [3, 1, 1], 2);
    mb.sheets.push({ id: 'x', at: [0, 0, 0], n: [0, 0, 1] });
    mb.rewind(mark);
    const after = mb.build();
    expect(mb.sheets.length).toBe(0);
    for (const k of ['position', 'normal', 'color', 'mat', 'uv', 'index'] as const) expect(Array.from(after[k]), k).toEqual(Array.from(before[k]));
  });

  it('преграды возвращаются к отметке и пропадают из поиска', () => {
    const col = new ColliderSet();
    col.addBox(0, 0, 0, 1, 1, 1);
    const n = col.boxes.length;
    col.addBox(0.5, 0, 0.5, 5, 1, 5);
    col.addBox(3, 0, 3, 4, 1, 4);
    col.rewind(n);
    expect(col.boxes.length).toBe(1);
    expect(col.query(-1, -1, 10, 10, []).length).toBe(1);
    // Номер освободился — новая коробка встаёт на него и находится.
    col.addBox(6, 0, 6, 7, 1, 7);
    expect(col.query(5.5, 5.5, 7.5, 7.5, []).length).toBe(1);
  });
});

describe('записи партнёра и правило «не врастать»', () => {
  it('две передвинутые скамьи буфета: одна стоит, где её поставила игра, — другая по правилу туда не встаёт (18.11, 0,62 м)', () => {
    // Записи партнёра 18.11 (конструктор, буфет зала ожидания): обе скамьи передвинуты; одной места по правилу нет, и раньше вторая
    // вставала ровно туда, где осталась первая (world/placed_place.ts, fitMoved).
    const benches = [
      {"at": "2026-11-18T16:11:59.477Z", "id": "pl_mwmbk5lwe", "moves": {"nth": 1, "thing": "st_seats"}, "name": "скамья: деревянная со спинкой — передвинута", "near": [0.25, 0.075], "offset": [0.7, -0.29], "prop": "st_seats", "rule": {"anchor": "wall", "count": 1, "facing": "room", "lift": 0, "rooms": ["buffet"], "worlds": ["station"]}, "slot": "buffet.0", "turn": 0},
      {"at": "2026-11-18T16:12:19.682Z", "id": "pl_mwmbk940f", "moves": {"nth": 0, "thing": "st_seats"}, "name": "скамья: деревянная со спинкой — передвинута", "near": [0.075, 0.25], "offset": [-0.4, -0.29], "prop": "st_seats", "rule": {"anchor": "wall", "count": 1, "facing": "room", "lift": 0, "rooms": ["buffet"], "worlds": ["station"]}, "slot": "buffet.0", "turn": 0},
    ] as unknown as PlacedSpec[];
    const lvl = buildLevel(generateLayout(42, 2, 'station'), { wear: 0, figures: [], placed: benches, removed: [] });
    expect(grown(lvl)).toEqual([]);
  });

  it('убранная вещь игры остаётся тенью: вещь, которая без записей не встала бы рядом, не появляется и с записью', () => {
    // Найти помещение, где правило не пустило вещь игры, и убрать ту, что ей мешала, — номера и места остальных те же.
    for (const seed of SEEDS) {
      const layout = generateLayout(seed, 2, 'shelter');
      const plain = buildLevel(layout, { wear: 0, figures: [] });
      const at = roomIndex(layout);
      const census = (l: BuiltLevel): string[] =>
        (l.objects ?? [])
          .filter((o) => o.name.startsWith('s3_bunk_') || o.name === 's3_locker_olive')
          .map((o) => `${o.name}@${o.at.map((v) => v.toFixed(2)).join(',')}`)
          .sort();
      const bunks = (plain.objects ?? []).filter((o) => o.name === 's3_bunk_black' && at(o.at[0], o.at[1], o.at[2])?.type === 'dorm');
      if (bunks.length === 0) continue;
      const gone: RemovedSpec = { id: 'rm_bunk', name: 'нары', what: { thing: 's3_bunk_black', nth: 0 }, worlds: ['shelter'], rooms: ['dorm'] };
      const lvl = buildLevel(layout, { wear: 0, figures: [], removed: [gone] });
      // В каждой спальне первые чёрные нары убраны — и только они: всё прочее (нары, шкафчики) стоит, где стояло без записи.
      const first = new Set<string>();
      for (const r of layout.rooms.filter((q) => q.type === 'dorm')) {
        const b = bunks.find((o) => at(o.at[0], o.at[1], o.at[2])?.id === r.id);
        if (b) first.add(`${b.name}@${b.at.map((v) => v.toFixed(2)).join(',')}`);
      }
      expect(census(lvl)).toEqual(census(plain).filter((k) => !first.has(k)));
      return;
    }
    throw new Error('на этих планах нет спален с чёрными нарами');
  });
});
