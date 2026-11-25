/**
 * Аудит расстановки (партнёр 25.11: «собрать план всех локаций и всех комнат, понять габариты и расставить мебель так, как
 * расставляют в реальности»). Все четыре места, несколько сидов и размеров: ни одна вещь не проходит сквозь другую — и сквозь
 * тонкую тоже (перегородка кабинки, 2,8 см, раньше пропускала столешницу с раковинами насквозь), и не уходит в стену.
 */
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import type { Aabb } from '../src/world/colliders';
import { crossing, GROW_TOL, tucked, WALL_TOL } from '../src/world/clearance';
import { buildLevel } from '../src/world/level_build';

const WORLDS: readonly WorldKind[] = ['shelter', 'office', 'yellow', 'station'];
const SEEDS = [20041113, 777, 31337, 4242];

interface Finding {
  world: WorldKind;
  seed: number;
  rank: number;
  a: string;
  b: string;
  kind: 'cross' | 'wall';
  depth: number;
  at: [number, number, number];
}

/** Все пересечения вещей уровня: вещь сквозь вещь (и сквозь тонкую) и вещь в стене. */
function audit(world: WorldKind, seed: number, rank: 1 | 2 | 3): Finding[] {
  const lvl = buildLevel(generateLayout(seed, rank, world), { wear: 0, figures: [] });
  const objs = lvl.objects ?? [];
  const col = lvl.colliders;
  const out: Finding[] = [];
  const seen = new Set<string>();
  const near: Aabb[] = [];
  for (const a of col.boxes) {
    if (a.owner === undefined || a.owner <= 0 || a.ghost || a.partner || a.off) continue;
    for (const b of col.query(a.minX, a.minZ, a.maxX, a.maxZ, near)) {
      if (b === a || b.ghost || b.partner || b.cut || b.off) continue;
      // Варианты расстановки одной комнаты (world/variants.ts): в игре показан один, друг с другом они не стоят.
      if (a.group !== undefined && b.group !== undefined && a.group !== b.group) continue;
      const at: [number, number, number] = [(a.minX + a.maxX) / 2, a.minY, (a.minZ + a.maxZ) / 2];
      if (b.mass) {
        const d = crossing(a, b);
        if (d > GROW_TOL) out.push({ world, seed, rank, a: objs[a.owner - 1]?.name ?? '?', b: 'collapse', kind: 'cross', depth: d, at });
        continue;
      }
      if (b.owner === undefined) {
        // Стена (преграда без хозяина, выше пояса): вещь не уходит в неё глубже 8 см. Пол и потолок — плиты, их пропускаем.
        if (b.maxY - b.minY < 1.2) continue;
        const d = crossing(a, b);
        if (d > WALL_TOL) out.push({ world, seed, rank, a: objs[a.owner - 1]?.name ?? '?', b: 'wall', kind: 'wall', depth: d, at });
        continue;
      }
      if (b.owner <= 0 || b.owner === a.owner) continue;
      const key = a.owner < b.owner ? `${a.owner}:${b.owner}` : `${b.owner}:${a.owner}`;
      if (seen.has(key)) continue;
      const na = objs[a.owner - 1]?.name ?? '?';
      const nb = objs[b.owner - 1]?.name ?? '?';
      const d = crossing(a, b);
      if (d <= GROW_TOL || tucked(na, nb)) continue;
      seen.add(key);
      out.push({ world, seed, rank, a: na, b: nb, kind: 'cross', depth: d, at });
    }
  }
  return out;
}

describe('аудит расстановки: вещи не проходят друг сквозь друга и сквозь стены', () => {
  for (const world of WORLDS) {
    it(world, () => {
      const all: Finding[] = [];
      for (const seed of SEEDS) for (const rank of [1, 2, 3] as const) all.push(...audit(world, seed, rank));
      const pairs = new Map<string, number>();
      for (const f of all) pairs.set(`${f.kind} ${f.a} × ${f.b}`, (pairs.get(`${f.kind} ${f.a} × ${f.b}`) ?? 0) + 1);
      const top = [...pairs].sort((x, y) => y[1] - x[1]).slice(0, 40);
      if (top.length) console.log(`${world}: ${all.length}\n` + top.map(([k, n]) => `  ${n} ${k}`).join('\n'));
      expect(all.map((f) => `${f.kind} ${f.a} × ${f.b} ${f.depth.toFixed(2)} @${f.at.map((v) => v.toFixed(1))} (${f.seed}, r${f.rank})`).slice(0, 12)).toEqual([]);
    });
  }
});
