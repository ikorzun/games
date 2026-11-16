/**
 * Где стоит каждая вещь: строит уровни всех четырёх мест на нескольких сидах и рангах и считает предметы
 * по имени — в среднем на уровень и по типам помещений. Запускается при сборке каталога (build.mjs) и
 * печатает JSON в stdout.
 */
import { GRID, TIER_DROP, WORLD_KINDS, generateLayout } from '../../src/gen/layout';
import { buildLevel } from '../../src/world/level_build';
import { CELL } from '../../src/world/shell';

const SEEDS = [20041113, 7, 1234, 42, 5];
const RANKS = [1, 2, 3] as const;

type Usage = Record<string, { worlds: Record<string, number>; rooms: Record<string, number> }>;
const out: Usage = {};
const levels = SEEDS.length * RANKS.length;

for (const world of WORLD_KINDS) {
  for (const seed of SEEDS) {
    for (const rank of RANKS) {
      const layout = generateLayout(seed, rank, world);
      const level = buildLevel(layout, { wear: 0 });
      const roomAt = (x: number, y: number, z: number): string => {
        const cx = Math.round(x / CELL) + GRID / 2;
        const cz = Math.round(z / CELL) + GRID / 2;
        const tier = Math.max(0, Math.round(-y / TIER_DROP + 0.05));
        const r = layout.rooms.find((q) => q.tier === tier && q.cells.some(([a, b]) => a === cx && b === cz));
        return r ? r.type : '?';
      };
      for (const o of level.objects ?? []) {
        const u = (out[o.name] ??= { worlds: {}, rooms: {} });
        u.worlds[world] = (u.worlds[world] ?? 0) + 1 / levels;
        const room = `${world}:${roomAt(o.at[0], o.at[1] - 0.01, o.at[2])}`;
        u.rooms[room] = (u.rooms[room] ?? 0) + 1;
      }
    }
  }
}
for (const u of Object.values(out)) for (const w of Object.keys(u.worlds)) u.worlds[w] = Math.round(u.worlds[w]! * 10) / 10;
process.stdout.write(JSON.stringify(out));
