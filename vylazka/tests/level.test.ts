import { describe, expect, it } from 'vitest';
import { generateLayout, TIER_DROP } from '../src/gen/layout';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from '../src/player/controller';
import type { PlayerBody } from '../src/player/controller';
import type { ColliderSet } from '../src/world/colliders';
import type { BuiltLevel, NavNode } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { MAT_COUNT } from '../src/world/materials';

const DT = 1 / 60;

/** Кратчайший путь по навигационному графу (в узлах). */
function path(nav: NavNode[], from: number, to: number): number[] | null {
  const prev = new Int32Array(nav.length).fill(-1);
  const seen = new Uint8Array(nav.length);
  const q = [from];
  seen[from] = 1;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h]!;
    if (cur === to) {
      const out = [to];
      for (let p = prev[to]!; p !== -1; p = prev[p]!) out.push(p);
      return out.reverse();
    }
    for (const n of nav[cur]!.links) {
      if (seen[n]) continue;
      seen[n] = 1;
      prev[n] = cur;
      q.push(n);
    }
  }
  return null;
}

/** Пройти настоящим контроллером через центры клеток пути. true — дошёл. */
function walkPath(level: BuiltLevel, nodes: number[], b: PlayerBody, c: ColliderSet): { ok: boolean; at: number } {
  for (let i = 1; i < nodes.length; i++) {
    const n = level.nav[nodes[i]!]!;
    let done = false;
    for (let s = 0; s < 60 * 12 && !done; s++) {
      const dx = n.x - b.x;
      const dz = n.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) done = true;
      else stepPlayer(b, dx / d, dz / d, 2.3, DT, c, DEFAULT_CONTROLLER);
    }
    if (!done) return { ok: false, at: i };
  }
  return { ok: true, at: nodes.length };
}

describe('сборка уровня из плана', () => {
  it('один сид — одна и та же геометрия, находки и приметы', () => {
    const a = buildLevel(generateLayout(20041113, 3));
    const b = buildLevel(generateLayout(20041113, 3));
    expect(a.chunks.length).toBe(b.chunks.length);
    for (let i = 0; i < a.chunks.length; i++) expect(a.chunks[i]!.mesh.position).toEqual(b.chunks[i]!.mesh.position);
    expect(a.spots).toEqual(b.spots);
    expect(a.landmarks).toEqual(b.landmarks);
    expect(a.colliders.boxes.length).toBe(b.colliders.boxes.length);
  });

  it('геометрия здорова: нет NaN, материалы в атласе, чанков и треугольников в меру', () => {
    for (const seed of [1, 77, 20041113, 555555]) {
      const level = buildLevel(generateLayout(seed, 3));
      let tris = 0;
      expect(level.chunks.length).toBeGreaterThan(20);
      expect(level.chunks.length).toBeLessThan(140);
      for (const ch of level.chunks) {
        const m = ch.mesh;
        tris += m.index.length / 3;
        expect(m.index.length % 3).toBe(0);
        for (const arr of [m.position, m.normal, m.color, m.uv]) expect(arr.every((v) => Number.isFinite(v))).toBe(true);
        expect(m.mat.every((v) => Number.isInteger(v) && v >= 0 && v < MAT_COUNT)).toBe(true);
        // Один чанк — один вызов отрисовки: он не должен быть гигантским.
        expect(m.index.length / 3).toBeLessThan(60000);
        expect(ch.tierMin).toBeLessThanOrEqual(ch.tierMax);
      }
      expect(tris).toBeGreaterThan(60000);
      expect(tris).toBeLessThan(900000);
    }
  });

  it('старт стоит на полу у люка; выход рядом', () => {
    const level = buildLevel(generateLayout(42, 2));
    const [x, y, z] = level.spawn.pos;
    expect(level.colliders.raycast(x, y + 1, z, 0, -1, 0, 5)).toBeCloseTo(1, 4);
    expect(Math.hypot(level.exit[0] - x, level.exit[2] - z)).toBeLessThan(1.5);
    expect(level.landmarks.some((l) => l.id === 'exit')).toBe(true);
  });

  it('граф навигации связен и покрывает все ярусы', () => {
    for (const seed of [3, 1000, 20041113]) {
      const level = buildLevel(generateLayout(seed, 3));
      const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
      for (const n of level.nav) expect(path(level.nav, start, n.id), `сид ${seed}: узел ${n.id} (ярус ${n.tier}) недостижим`).not.toBeNull();
      expect(new Set(level.nav.map((n) => n.tier)).size).toBe(3);
    }
  });

  it('маршрут настоящим контроллером: от люка до самой дальней клетки нижнего яруса и обратно', () => {
    for (const seed of [5, 20041113, 31337, 808]) {
      const level = buildLevel(generateLayout(seed, 3));
      const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
      // Самый дальний по графу узел — в коридоре нижнего яруса.
      let far = start;
      let farLen = 0;
      for (const n of level.nav) {
        if (n.tier !== 2 || level.layout!.rooms[n.room]!.type !== 'corridor') continue;
        const p = path(level.nav, start, n.id)!;
        if (p.length > farLen) {
          farLen = p.length;
          far = n.id;
        }
      }
      const route = path(level.nav, start, far)!;
      const s = level.nav[start]!;
      const b = createBody(s.x, s.y, s.z);
      const down = walkPath(level, route, b, level.colliders);
      expect(down.ok, `сид ${seed}: спуск застрял на шаге ${down.at} из ${route.length} (узел ${JSON.stringify(level.nav[route[down.at] ?? 0])})`).toBe(true);
      expect(b.y).toBeCloseTo(-2 * TIER_DROP, 2);
      const up = walkPath(level, route.slice().reverse(), b, level.colliders);
      expect(up.ok, `сид ${seed}: подъём застрял на шаге ${up.at}`).toBe(true);
      expect(b.y).toBeCloseTo(0, 2);
    }
  });

  it('в каждое помещение можно войти: центр хотя бы одной его клетки достижим пешком от двери', () => {
    for (const seed of [9, 20041113]) {
      const level = buildLevel(generateLayout(seed, 3));
      const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
      const s = level.nav[start]!;
      for (const room of level.layout!.rooms) {
        if (room.type === 'stairwell' || room.type === 'corridor' || room.type === 'collapsed') continue;
        const targets = level.nav.filter((n) => n.room === room.id);
        const reached = targets.some((t) => {
          const b = createBody(s.x, s.y, s.z);
          return walkPath(level, path(level.nav, start, t.id)!, b, level.colliders).ok;
        });
        expect(reached, `сид ${seed}: в помещение ${room.type} №${room.id} не войти`).toBe(true);
      }
    }
  });

  it('места для находок лежат внутри своих помещений и не в стенах; приметы есть на каждом ярусе', () => {
    const level = buildLevel(generateLayout(20041113, 3));
    expect(level.spots.length).toBeGreaterThan(25);
    for (const sp of level.spots) {
      expect(sp.y).toBeGreaterThanOrEqual(-sp.tier * TIER_DROP - 0.01);
      expect(sp.y).toBeLessThan(-sp.tier * TIER_DROP + 2.2);
      const room = level.layout!.rooms[sp.room]!;
      const inside = room.cells.some(([cx, cz]) => Math.abs(sp.x - (cx - 8) * 3) <= 1.5 && Math.abs(sp.z - (cz - 8) * 3) <= 1.5);
      expect(inside, `находка вне помещения ${room.type}`).toBe(true);
    }
    for (let t = 0; t < 3; t++) expect(level.landmarks.filter((l) => l.tier === t && l.id !== 'exit').length, `ярус ${t}`).toBeGreaterThanOrEqual(2);
  });
});
