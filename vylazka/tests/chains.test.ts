/**
 * Пять вещей по порядку в каждом месте (systems/session.ts, цепочки). Строка, которой вещь
 * вспоминается, называет помещение следующей; значит, такое помещение должно быть на каждом уровне
 * этого места — иначе строка врёт, а вещь окажется где попало.
 */
import { describe, expect, it } from 'vitest';
import { generateLayout, WORLD_KINDS } from '../src/gen/layout';
import { DEFAULT_SESSION, ORDERED_WORLDS, Session, WORLD_MEMORIES } from '../src/systems/session';
import { buildLevel } from '../src/world/level_build';

const SEEDS = [20041113, 7, 1234, 42];
const RANKS = [1, 2, 3] as const;

describe('цепочки пяти вещей', () => {
  it('порядок, а не жребий — во всех четырёх местах', () => {
    for (const w of WORLD_KINDS) expect(ORDERED_WORLDS.has(w), w).toBe(true);
  });

  for (const world of WORLD_KINDS) {
    it(`${world}: помещение каждой вещи есть на уровне при любом сиде и ранге`, () => {
      for (const seed of SEEDS) {
        for (const rank of RANKS) {
          const types = new Set(generateLayout(seed, rank, world).rooms.map((r) => r.type));
          for (const m of WORLD_MEMORIES[world]) {
            expect(m.rooms?.some((r) => types.has(r)), `${world}, сид ${seed}, ранг ${rank}: ${m.id} (${m.rooms?.join(', ')})`).toBe(true);
          }
        }
      }
    });
  }

  it('сессия идёт по цепочке своего места', () => {
    for (const world of WORLD_KINDS) {
      const level = buildLevel(generateLayout(20041113, 2, world));
      const s = new Session(level, 5);
      expect(s.memories.map((m) => m.def.id)).toEqual(WORLD_MEMORIES[world].slice(0, DEFAULT_SESSION.count).map((m) => m.id));
    }
  });
});
