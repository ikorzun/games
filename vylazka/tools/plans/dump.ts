/**
 * План сверху (раскладка по смыслу, партнёр 19.11, 14:33): уровни мест на нескольких сидах — комнаты, проходы, вещи (габариты),
 * места вещей воспоминаний, приметы, преграды. Печатает JSON в stdout; рисует plans.mjs (render.py). Уровни — без правок
 * партнёра (их раскладка — его), если не передан флаг --partner.
 */
import { generateLayout, WORLD_KINDS } from '../../src/gen/layout';
import type { WorldKind } from '../../src/gen/layout';
import { buildLevel } from '../../src/world/level_build';

const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const seeds = arg('seeds', '20041113,7,42').split(',').map(Number);
const rank = Number(arg('rank', '2')) as 1 | 2 | 3;
const worlds = arg('worlds', WORLD_KINDS.join(',')).split(',') as WorldKind[];
const partner = process.argv.includes('--partner');
const out: unknown[] = [];
for (const world of worlds) {
  for (const seed of seeds) {
    const layout = generateLayout(seed, rank, world);
    const level = buildLevel(layout, partner ? { wear: 0 } : { wear: 0, placed: [], removed: [], figures: [] });
    out.push({
      world,
      seed,
      rooms: layout.rooms,
      edges: layout.edges,
      stairs: layout.stairs,
      entrance: layout.entranceRoom,
      objects: (level.objects ?? []).map((o) => ({ n: o.name, at: o.at, rot: o.rot, min: o.min, max: o.max, solid: o.solid, flat: o.flat })),
      spots: level.spots,
      landmarks: level.landmarks,
      boxes: level.colliders.boxes.map((b) => [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ]),
    });
  }
}
process.stdout.write(JSON.stringify(out));
