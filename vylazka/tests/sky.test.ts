import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';

/**
 * Слова партнёра: «в какой момент игрок заходит в одну из комнат или помещение и там нет потолка,
 * только бесконечно глубокое звездное небо и изредка падают звезды».
 */
describe('комната под звёздным небом', () => {
  const worlds: WorldKind[] = ['shelter', 'office', 'yellow'];

  it('в убежище, офисе и жёлтых комнатах такая комната одна; в зале ожидания её нет — небо там и так открыто', () => {
    let found = 0;
    let total = 0;
    for (const world of worlds) {
      for (const seed of [7, 11, 20041113, 42, 1001]) {
        const layout = generateLayout(seed, 2, world);
        const level = buildLevel(layout);
        total += 1;
        if (level.skyRoom === undefined) continue;
        found += 1;
        const room = layout.rooms[level.skyRoom]!;
        expect(room.cells.length, `${world}/${seed}`).toBeGreaterThanOrEqual(2);
        expect(['corridor', 'stairwell', 'lift', 'entrance', 'airlock', 'fvu', 'diesel', 'tanks', 'collapsed', 'department']).not.toContain(room.type);
      }
    }
    // Подходящая комната находится почти всегда.
    expect(found).toBeGreaterThanOrEqual(total - 2);
    expect(buildLevel(generateLayout(7, 2, 'station')).skyRoom).toBeUndefined();
  });

  it('потолка в ней нет, и под потолок ничего не подвешено; в соседних комнатах потолок на месте', () => {
    for (const world of worlds) {
      const layout = generateLayout(20041113, 2, world);
      const level = buildLevel(layout);
      expect(level.skyRoom, world).toBeDefined();
      const room = layout.rooms[level.skyRoom!]!;
      const xs = room.cells.map((c) => (c[0] - 8) * 3);
      const zs = room.cells.map((c) => (c[1] - 8) * 3);
      const box = { x0: Math.min(...xs) - 1.5, x1: Math.max(...xs) + 1.5, z0: Math.min(...zs) - 1.5, z1: Math.max(...zs) + 1.5 };
      const floorY = -4.5 * room.tier;
      // Что висит под потолком: предметы, у которых низ выше двух метров над полом.
      const hanging = (level.objects ?? []).filter((o) => {
        const x = (o.min[0] + o.max[0]) / 2;
        const z = (o.min[2] + o.max[2]) / 2;
        return x > box.x0 + 0.3 && x < box.x1 - 0.3 && z > box.z0 + 0.3 && z < box.z1 - 0.3 && o.min[1] > floorY + 2.2 && o.min[1] < floorY + 3.2;
      });
      expect(hanging.map((o) => o.name), world).toEqual([]);
    }
  });

  it('один сид — одна и та же комната', () => {
    for (const world of worlds) {
      const a = buildLevel(generateLayout(42, 2, world)).skyRoom;
      const b = buildLevel(generateLayout(42, 2, world)).skyRoom;
      expect(a).toBe(b);
    }
  });
});
