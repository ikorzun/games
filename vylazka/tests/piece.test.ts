import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { RoomType, WorldKind } from '../src/gen/layout';
import { nodesInRange } from '../src/swarm/ai';
import { buildLevel } from '../src/world/level_build';
import type { BuiltLevel } from '../src/world/level';
import { PASSAGES, PIECE_MAX_ROOMS, PIECE_MIN_ROOMS, PIECE_REACH, pieceCells, scenePiece } from '../src/world/piece';

const levels = new Map<string, BuiltLevel>();
function level(world: WorldKind, seed: number): BuiltLevel {
  const k = `${world}:${seed}`;
  let l = levels.get(k);
  if (!l) levels.set(k, (l = buildLevel(generateLayout(seed, 2, world), { wear: 0 })));
  return l;
}

/** Узлы, до которых можно дойти от start, не выходя из множества. */
function reachable(l: BuiltLevel, start: number, inside: Set<number>): Set<number> {
  const seen = new Set([start]);
  const q = [start];
  for (let h = 0; h < q.length; h++) for (const n of l.nav[q[h]!]!.links) if (inside.has(n) && !seen.has(n)) seen.add(n), q.push(n);
  return seen;
}

describe('сцена — кусок места (квиз 17.11: «Сцена — кусок места»; pressure.md §4.8)', () => {
  it('кусок: 3–6 комнат целиком и клетки проходов вокруг; связный, с началом внутри, с краем наружу', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      for (const seed of [20041113, 777, 31337]) {
        const l = level(world, seed);
        const rooms = l.layout!.rooms;
        const passage = (r: number): boolean => PASSAGES.includes(rooms[r]!.type as RoomType);
        // Начала — разные узлы посреди плана (как сцена посреди сна).
        const entrance = l.nav.find((n) => n.room === l.layout!.entranceRoom)!.id;
        for (const start of nodesInRange(l.nav, entrance, 5, 40).filter((_, i) => i % 7 === 0).slice(0, 6)) {
          const p = scenePiece(l.nav, l.layout!, start, seed + start);
          const where = `${world} ${seed} от узла ${start}`;
          expect(p.nodes.has(start), where).toBe(true);
          expect(p.count, where).toBeGreaterThanOrEqual(Math.min(PIECE_MIN_ROOMS, rooms.filter((r) => !PASSAGES.includes(r.type)).length));
          expect(p.count, where).toBeLessThanOrEqual(PIECE_MAX_ROOMS);
          // Комната — целиком или никак.
          for (const r of p.rooms) {
            if (passage(r)) continue;
            const all = l.nav.filter((n) => n.room === r).map((n) => n.id);
            expect(all.every((id) => p.nodes.has(id)), `${where}: комната ${r} (${rooms[r]!.type}) не целиком`).toBe(true);
          }
          expect(reachable(l, start, p.nodes).size, `${where}: кусок не связный`).toBe(p.nodes.size);
          // Не всё место: у куска есть край, и за краем — то, что не помнится.
          expect(p.nodes.size, where).toBeLessThan(l.nav.length);
          expect(p.edge.length, where).toBeGreaterThan(0);
          for (const e of p.edge) expect(l.nav[e]!.links.some((x) => !p.nodes.has(x))).toBe(true);
          // Дальше PIECE_REACH (с комнатой целиком — её глубина) память не тянется.
          const near = new Set(nodesInRange(l.nav, start, 0, PIECE_REACH + 6));
          expect([...p.nodes].every((id) => near.has(id)), where).toBe(true);
          expect(pieceCells(l.nav, p).size).toBe(p.nodes.size);
        }
      }
    }
  });

  it('тот же жребий — тот же кусок; сколько комнат — по жребию сцены, от трёх до шести', () => {
    const l = level('shelter', 20041113);
    const entrance = l.nav.find((n) => n.room === l.layout!.entranceRoom)!.id;
    const start = nodesInRange(l.nav, entrance, 8, 8)[0]!;
    const a = scenePiece(l.nav, l.layout!, start, 5);
    const b = scenePiece(l.nav, l.layout!, start, 5);
    expect([...a.nodes].sort()).toEqual([...b.nodes].sort());
    const counts = new Set<number>();
    for (let s = 0; s < 40; s++) counts.add(scenePiece(l.nav, l.layout!, start, s).count);
    expect([...counts].every((c) => c >= PIECE_MIN_ROOMS && c <= PIECE_MAX_ROOMS)).toBe(true);
    expect(counts.size).toBeGreaterThanOrEqual(3);
  });

  it('в куске есть куда идти: самая дальняя его клетка — не ближе пяти клеток пути от начала', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      const l = level(world, 20041113);
      const entrance = l.nav.find((n) => n.room === l.layout!.entranceRoom)!.id;
      for (const start of nodesInRange(l.nav, entrance, 5, 40).filter((_, i) => i % 9 === 0).slice(0, 5)) {
        const p = scenePiece(l.nav, l.layout!, start, start);
        const far = Math.max(...[...p.nodes].map((id) => nodesInRange(l.nav, start, 0, 40).indexOf(id) >= 0 ? hops(l, start, id, p.nodes) : 0));
        expect(far, `${world} от узла ${start}`).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

/** Переходов от a до b, не выходя из куска. */
function hops(l: BuiltLevel, a: number, b: number, inside: Set<number>): number {
  const dist = new Map([[a, 0]]);
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h]!;
    if (cur === b) return dist.get(cur)!;
    for (const n of l.nav[cur]!.links) if (inside.has(n) && !dist.has(n)) dist.set(n, dist.get(cur)! + 1), q.push(n);
  }
  return -1;
}
