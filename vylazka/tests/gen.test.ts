import { describe, expect, it } from 'vitest';
import { DX, DZ, GEN_VERSION, generateLayout, GRID, STAIR_CELLS } from '../src/gen/layout';
import type { GenLayout } from '../src/gen/layout';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);

/** Граф клеток: соседи по помещению, проходы (двери и открытые рёбра), лестницы. Ключ — «tier,x,z». */
function cellGraph(l: GenLayout): Map<string, string[]> {
  const key = (t: number, x: number, z: number): string => `${t},${x},${z}`;
  const roomAt = new Map<string, number>();
  for (const r of l.rooms) for (const [x, z] of r.cells) roomAt.set(key(r.tier, x, z), r.id);
  const g = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    if (!g.has(a)) g.set(a, []);
    if (!g.has(b)) g.set(b, []);
    g.get(a)!.push(b);
    g.get(b)!.push(a);
  };
  for (const r of l.rooms) {
    for (const [x, z] of r.cells) {
      const k = key(r.tier, x, z);
      if (!g.has(k)) g.set(k, []);
      for (const d of [0, 1]) {
        const n = key(r.tier, x + DX[d]!, z + DZ[d]!);
        if (roomAt.get(n) === r.id) link(k, n);
      }
    }
  }
  for (const e of l.edges) link(key(e.tier, e.cx, e.cz), key(e.tier, e.cx + (e.dir === 0 ? 1 : 0), e.cz + (e.dir === 1 ? 1 : 0)));
  // Марш: верхняя и нижняя клетки шахты — одно и то же место на разных ярусах.
  for (const s of l.stairs) {
    for (let i = 1; i <= STAIR_CELLS; i++) {
      const x = s.cx + DX[s.dir]! * i;
      const z = s.cz + DZ[s.dir]! * i;
      link(key(s.upperTier, x, z), key(s.upperTier + 1, x, z));
    }
  }
  return g;
}

function reach(g: Map<string, string[]>, from: string): Set<string> {
  const seen = new Set([from]);
  const q = [from];
  for (let h = 0; h < q.length; h++) for (const n of g.get(q[h]!) ?? []) if (!seen.has(n)) (seen.add(n), q.push(n));
  return seen;
}

describe('генератор плана', () => {
  it('один сид — один и тот же уровень; разные сиды — разные', () => {
    const a = generateLayout(12345, 2);
    expect(generateLayout(12345, 2)).toEqual(a);
    expect(JSON.stringify(generateLayout(12346, 2))).not.toBe(JSON.stringify(a));
    expect(a.genVersion).toBe(GEN_VERSION);
  });

  it('эталонные сиды не меняются (иначе старые сохранения откроют другой уровень — поднять GEN_VERSION)', () => {
    const sig = (seed: number, rank: 1 | 2 | 3): string => {
      const l = generateLayout(seed, rank);
      let h = 0;
      for (const ch of JSON.stringify([l.rooms, l.edges, l.stairs])) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
      return `${l.attempt}:${l.rooms.length}:${l.edges.length}:${h.toString(16)}`;
    };
    expect([sig(1, 1), sig(20041113, 2), sig(777, 3)]).toMatchInlineSnapshot(`
      [
        "0:17:16:2e74ec5f",
        "0:26:23:95d899ab",
        "0:26:23:530f46ba",
      ]
    `);
  });

  it('300 сидов × 3 ранга: уровень собирается, клетки не пересекаются, всё в пределах сетки', () => {
    for (const rank of [1, 2, 3] as const) {
      for (const seed of SEEDS) {
        const l = generateLayout(seed, rank);
        expect(l.tierCount).toBe(rank === 1 ? 2 : 3);
        const taken = new Set<string>();
        for (const r of l.rooms) {
          expect(r.cells.length, `${seed}/${rank} ${r.type}`).toBeGreaterThan(0);
          for (const [x, z] of r.cells) {
            expect(x >= 0 && z >= 0 && x < GRID && z < GRID).toBe(true);
            const k = `${r.tier},${x},${z}`;
            expect(taken.has(k), `клетка ${k} занята дважды (сид ${seed})`).toBe(false);
            taken.add(k);
          }
        }
      }
    }
  });

  it('из входа достижимо каждое помещение на каждом ярусе', () => {
    for (const rank of [1, 2, 3] as const) {
      for (const seed of SEEDS) {
        const l = generateLayout(seed, rank);
        const g = cellGraph(l);
        const ent = l.rooms[l.entranceRoom]!;
        const seen = reach(g, `0,${ent.cells[0]![0]},${ent.cells[0]![1]}`);
        for (const r of l.rooms) for (const [x, z] of r.cells) expect(seen.has(`${r.tier},${x},${z}`), `сид ${seed}, ранг ${rank}: ${r.type} недостижимо`).toBe(true);
      }
    }
  });

  it('каждый проход соединяет две существующие клетки разных помещений', () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const l = generateLayout(seed, 3);
      const roomAt = new Map<string, number>();
      for (const r of l.rooms) for (const [x, z] of r.cells) roomAt.set(`${r.tier},${x},${z}`, r.id);
      const seen = new Set<string>();
      for (const e of l.edges) {
        const a = roomAt.get(`${e.tier},${e.cx},${e.cz}`);
        const b = roomAt.get(`${e.tier},${e.cx + (e.dir === 0 ? 1 : 0)},${e.cz + (e.dir === 1 ? 1 : 0)}`);
        expect(a !== undefined && b !== undefined && a !== b, `сид ${seed}: проход в пустоту`).toBe(true);
        const k = `${e.tier},${e.cx},${e.cz},${e.dir}`;
        expect(seen.has(k), `сид ${seed}: два прохода на одном ребре`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('на каждом ярусе есть цикл: от преследования есть куда уйти', () => {
    for (const rank of [1, 2, 3] as const) {
      for (const seed of SEEDS) {
        const l = generateLayout(seed, rank);
        expect(l.loops.length).toBe(l.tierCount);
        // Цикл настоящий: в графе яруса рёбер не меньше, чем вершин (у дерева их на одно меньше).
        const g = cellGraph(l);
        for (let t = 0; t < l.tierCount; t++) {
          let v = 0;
          let e = 0;
          for (const [k, ns] of g) {
            if (!k.startsWith(`${t},`)) continue;
            v += 1;
            e += ns.filter((n) => n.startsWith(`${t},`)).length;
          }
          expect(e / 2, `сид ${seed}, ранг ${rank}, ярус ${t}`).toBeGreaterThanOrEqual(v);
        }
      }
    }
  });

  it('лестницы ведут куда-то: марш свободен на обоих ярусах, внизу есть площадка коридора', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(seed, 3);
      expect(l.stairs.length).toBe(2);
      for (const s of l.stairs) {
        const at = (tier: number, x: number, z: number): string | undefined => l.rooms.find((r) => r.tier === tier && r.cells.some(([cx, cz]) => cx === x && cz === z))?.type;
        expect(at(s.upperTier, s.cx, s.cz)).toBe('corridor');
        for (let i = 1; i <= STAIR_CELLS; i++) {
          expect(at(s.upperTier, s.cx + DX[s.dir]! * i, s.cz + DZ[s.dir]! * i)).toBe('stairwell');
          expect(at(s.upperTier + 1, s.cx + DX[s.dir]! * i, s.cz + DZ[s.dir]! * i)).toBe('stairwell');
        }
        const lx = s.cx + DX[s.dir]! * (STAIR_CELLS + 1);
        const lz = s.cz + DZ[s.dir]! * (STAIR_CELLS + 1);
        expect(at(s.upperTier + 1, lx, lz)).toBe('corridor');
      }
    }
  });

  it('состав ярусов: жилой, технический, нижний; вход и шлюз одни', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const l = generateLayout(seed, 3);
      const types = (t: number): string[] => l.rooms.filter((r) => r.tier === t).map((r) => r.type);
      expect(types(0).filter((x) => x === 'entrance').length).toBe(1);
      expect(types(0).filter((x) => x === 'airlock').length).toBe(1);
      expect(types(0)).toContain('dorm');
      expect(types(1).some((x) => x === 'fvu' || x === 'diesel' || x === 'tanks')).toBe(true);
      expect(types(2).some((x) => x === 'archive' || x === 'collapsed' || x === 'storage')).toBe(true);
      for (let t = 0; t < 3; t++) expect(types(t).filter((x) => !['corridor', 'stairwell', 'entrance', 'airlock'].includes(x)).length).toBeGreaterThanOrEqual(4);
    }
  });
});
