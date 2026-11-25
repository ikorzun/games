/**
 * Главная вещь в каждой комнате (партнёр 25.11: «почини сам и проверь остальные комнаты»; куратор, пачка 64, критерий 5).
 * Перепись комнат нашла санузлы без кабинок (жёлтые комнаты — половина, вокзал — все: там стояла одна урна) и приёмные без
 * стойки: правило «не врастать» и «поле перед лицом» убирают вещь молча, а без неё комната не читается. Здесь — то, без чего тип
 * комнаты не узнать. Нарочно пустые помещения (песчаный зал, белая комната забирают комнату целиком) пропускаются.
 */
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel } from '../src/world/level_build';

const CELL = 3;
const HALF = 8;
const SEEDS = [20041113, 777, 31337, 4242];

/** Тип комнаты → наборы вещей; из каждого набора должна стоять хотя бы одна. */
const MAIN: Partial<Record<WorldKind, Record<string, string[][]>>> = {
  shelter: {
    kitchen: [['stove'], ['fridge'], ['sink_cabinet'], ['kitchen_table']],
    bathroom: [['bathtub'], ['toilet_home'], ['s3_sink_pedestal']],
  },
  office: {
    washroom: [['toilet_stall'], ['wash_basins']],
    reception: [['office_desk', 'reception_desk', 's3_reception_desk']],
    copyroom: [['copier']],
    manager: [['office_desk']],
  },
  yellow: { washroom: [['toilet_stall'], ['wash_basins']] },
  station: {
    washroom: [['toilet_stall'], ['wash_basins']],
    tickets: [['st_ticket_window']],
    storage: [['st_luggage_wall']],
    buffet: [['st_kiosk']],
  },
};

describe('главная вещь в каждой комнате своего типа', () => {
  for (const [world, types] of Object.entries(MAIN) as [WorldKind, Record<string, string[][]>][]) {
    it(world, () => {
      const missing: string[] = [];
      for (const seed of SEEDS) {
        for (const rank of [1, 2, 3] as const) {
          const layout = generateLayout(seed, rank, world);
          const lvl = buildLevel(layout, { wear: 0, placed: [], removed: [], figures: [] });
          const objs = lvl.objects ?? [];
          for (const room of layout.rooms) {
            const need = types[room.type];
            if (!need) continue;
            const cells = new Set(room.cells.map(([x, z]) => `${x},${z}`));
            const floor = -4.5 * room.tier;
            const names = new Set(
              objs
                .filter((o) => {
                  const cx = (o.min[0] + o.max[0]) / 2;
                  const cz = (o.min[2] + o.max[2]) / 2;
                  return o.min[1] >= floor - 0.05 && o.min[1] < floor + 2.9 && cells.has(`${Math.round(cx / CELL) + HALF},${Math.round(cz / CELL) + HALF}`);
                })
                .map((o) => o.name),
            );
            if (names.size === 0) continue;
            for (const set of need) if (!set.some((n) => names.has(n))) missing.push(`${room.type} #${room.id} без ${set.join('|')} (${seed}, r${rank})`);
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }
});
