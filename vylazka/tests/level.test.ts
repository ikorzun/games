import { describe, expect, it } from 'vitest';
import { generateLayout, HOME_ROOMS, TIER_DROP } from '../src/gen/layout';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from '../src/player/controller';
import type { PlayerBody } from '../src/player/controller';
import type { ColliderSet } from '../src/world/colliders';
import type { BuiltLevel, NavNode } from '../src/world/level';
import { buildLevel, cellToWorld, PIT_HOLE, tierFloor } from '../src/world/level_build';
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

  it('каждую примету можно снять: есть место, откуда она ближе 6 м и ничем не заслонена', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const level = buildLevel(generateLayout(seed * 977, 3));
      for (const lm of level.landmarks) {
        if (lm.id === 'exit') continue;
        const own = level.nav.filter((n) => n.room === lm.room);
        const around = own.flatMap((n) => n.links.map((i) => level.nav[i]!));
        // С центра клетки и с четырёх точек вокруг него: игрок не обязан стоять ровно посередине.
        const ok = [...own, ...around].some((n) =>
          [
            [0, 0],
            [0.8, 0],
            [-0.8, 0],
            [0, 0.8],
            [0, -0.8],
          ].some(([ox, oz]) => {
            const ex = n.x + ox!;
            const ey = n.y + 1.42;
            const ez = n.z + oz!;
            const dx = lm.x - ex;
            const dy = lm.y - ey;
            const dz = lm.z - ez;
            const d = Math.hypot(dx, dy, dz);
            if (d > 6 || d < 0.4) return false;
            return level.colliders.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d) >= d - 1.0;
          }),
        );
        expect(ok, `сид ${seed * 977}: примету «${lm.id}» (ярус ${lm.tier}) не снять ниоткуда`).toBe(true);
      }
    }
  });

  it('опасности на месте: зоны воды, газа и провалов; у провала есть карниз, а в дыре — гибель', () => {
    let pits = 0;
    for (const seed of [5, 20041113, 31337, 808, 4242]) {
      const level = buildLevel(generateLayout(seed, 3));
      const hz = level.layout!.hazards;
      expect(level.zones.filter((z) => z.kind === 'pit').length).toBe(hz.pits.length);
      expect(level.zones.filter((z) => z.kind === 'water').length).toBe(hz.water.length);
      expect(level.zones.some((z) => z.kind === 'gas')).toBe(hz.gasRooms.length > 0);
      expect(level.collapses.length).toBe(hz.collapses.length);
      for (const c of level.collapses) {
        expect(c.boxes.length).toBeGreaterThan(0);
        expect(level.chunks.filter((ch) => ch.id === c.id && ch.hidden === true).length).toBe(1);
      }
      for (const z of level.zones.filter((q) => q.kind === 'pit')) {
        pits += 1;
        const cx = (z.minX + z.maxX) / 2;
        const cz = (z.minZ + z.maxZ) / 2;
        const floor = -z.tier * TIER_DROP;
        // Шаг в дыру — падение ниже пола, в зону гибели.
        const b = createBody(cx, floor, cz);
        b.onGround = false;
        for (let i = 0; i < 120; i++) stepPlayer(b, 0, 0, 0, DT, level.colliders, DEFAULT_CONTROLLER);
        expect(b.y).toBeLessThan(z.maxY);
        expect(b.y).toBeGreaterThan(z.minY);
        // Дыра уже коридора: по краю остаётся опора.
        expect(PIT_HOLE).toBeLessThan(2.7 - 1.2);
      }
    }
    expect(pits).toBeGreaterThan(5);
  });

  it('обвал перекрывает клетку: до обрушения по ней ходят, после — нет, а обход остаётся', () => {
    const level = buildLevel(generateLayout(20041113, 3));
    const c = level.collapses[0]!;
    const node = level.nav.find((n) => Math.abs(n.x - c.center[0]) < 0.1 && Math.abs(n.z - c.center[2]) < 0.1 && n.tier === c.tier)!;
    const [a, bNode] = node.links.map((i) => level.nav[i]!);
    const walk = (): boolean => {
      const b = createBody(a!.x, a!.y, a!.z);
      return walkPath(level, [a!.id, node.id, bNode!.id], b, level.colliders).ok;
    };
    expect(walk()).toBe(true);
    for (const box of c.boxes) level.colliders.add(box);
    expect(walk()).toBe(false);
    // В обход: путь по графу без засыпанного узла существует.
    const without = level.nav.map((n) => ({ ...n, links: n.links.filter((l) => l !== node.id) }));
    expect(path(without, a!.id, bNode!.id)).not.toBeNull();
  });

  it('ни одна дверь не закрывает проём: в плоскости стены пусто, а свободная ширина прохода не меньше 0,9 м', () => {
    let doors = 0;
    for (const seed of [11, 20041113, 555, 9001, 31337, 77, 4242, 808]) {
      for (const rank of [1, 3] as const) {
        const level = buildLevel(generateLayout(seed, rank));
        const boxes = level.colliders.boxes;
        for (const e of level.layout!.edges) {
          if (e.kind === 'open') continue;
          doors += 1;
          const wx = cellToWorld(e.cx) + (e.dir === 0 ? 1.5 : 0);
          const wz = cellToWorld(e.cz) + (e.dir === 1 ? 1.5 : 0);
          const y0 = tierFloor(e.tier);
          // Ось прохода: у ребра к +x идём вдоль z, у ребра к +z — вдоль x.
          const along = (b: { minX: number; maxX: number; minZ: number; maxZ: number }): [number, number] => (e.dir === 0 ? [b.minZ - wz, b.maxZ - wz] : [b.minX - wx, b.maxX - wx]);
          const across = (b: { minX: number; maxX: number; minZ: number; maxZ: number }): [number, number] => (e.dir === 0 ? [b.minX - wx, b.maxX - wx] : [b.minZ - wz, b.maxZ - wz]);
          // Преграда — всё, что выше порога и ниже притолоки; низкое перешагивается.
          const blockers = boxes.filter((b) => !b.off && b.minY < y0 + 1.9 && b.maxY > y0 + 0.36);
          const gaps: Array<[number, number]> = [];
          for (const b of blockers) {
            const [a0, a1] = along(b);
            const [c0, c1] = across(b);
            if (a1 <= -0.55 + 1e-3 || a0 >= 0.55 - 1e-3) continue;
            // Плоскость самой стены: в проёме там не должно быть ничего.
            const inFrame = c0 < 0.12 && c1 > -0.12;
            if (inFrame) expect(false, `сид ${seed}/${rank}: дверь ${e.cx},${e.cz},${e.dir} забита преградой`).toBe(true);
            // Рядом с проёмом (0,6 м в обе стороны) считаем оставшуюся ширину.
            if (c0 < 0.6 && c1 > -0.6) gaps.push([Math.max(a0, -0.55), Math.min(a1, 0.55)]);
          }
          gaps.sort((p, q) => p[0] - q[0]);
          let cursor = -0.55;
          let best = 0;
          for (const [g0, g1] of gaps) {
            best = Math.max(best, g0 - cursor);
            cursor = Math.max(cursor, g1);
          }
          best = Math.max(best, 0.55 - cursor);
          expect(best, `сид ${seed}/${rank}: проход у двери ${e.cx},${e.cz},${e.dir} уже 0,9 м`).toBeGreaterThanOrEqual(0.9);
        }
      }
    }
    expect(doors).toBeGreaterThan(100);
  });

  it('в каждой домашней комнате есть 2–3 места для вещей, и стоят они внутри комнаты на полу или на столе', () => {
    let homes = 0;
    for (const seed of [11, 20041113, 555, 9001, 31337, 77, 4242, 808, 5, 6]) {
      const level = buildLevel(generateLayout(seed, 3));
      for (const r of level.layout!.rooms) {
        if (!HOME_ROOMS.has(r.type)) continue;
        homes += 1;
        const mine = level.spots.filter((p) => p.room === r.id);
        expect(mine.length, `сид ${seed}: ${r.type} (${r.id})`).toBeGreaterThanOrEqual(2);
        expect(mine.length, `сид ${seed}: ${r.type} (${r.id})`).toBeLessThanOrEqual(4);
        for (const p of mine) {
          expect(p.tier).toBe(r.tier);
          expect(r.cells.some(([x, z]) => Math.abs(p.x - cellToWorld(x)) <= 1.5 && Math.abs(p.z - cellToWorld(z)) <= 1.5), `сид ${seed}: место вне ${r.type}`).toBe(true);
        }
        // Приметная вещь по типу комнаты стоит в каждой (у прихожей, кухни и т. д. id совпадает с типом).
        expect(level.landmarks.some((m) => m.room === r.id), `сид ${seed}: у ${r.type} нет приметы`).toBe(true);
      }
    }
    expect(homes).toBeGreaterThan(40);
  });

  it('двери бывают разные: пустые проёмы, распахнутые, прислонённые и лежащие створки; хеш по ребру повторяем', () => {
    // Створки сорванных дверей — отдельные предметы: по числу коллайдеров и вершин уровень отличается от «все двери распахнуты»,
    // а повторная сборка того же сида даёт то же самое.
    const a = buildLevel(generateLayout(20041113, 3));
    const b = buildLevel(generateLayout(20041113, 3));
    expect(a.colliders.boxes).toEqual(b.colliders.boxes);
    const leaves = a.colliders.boxes.filter((x) => Math.abs(x.maxY - x.minY - 2.03) < 0.03 && Math.abs(x.maxX - x.minX - 0.95) < 0.02);
    expect(leaves.length + a.colliders.boxes.filter((x) => Math.abs(x.maxY - x.minY - 2.0) < 0.03 && Math.abs(x.maxZ - x.minZ - 1.05) < 0.02).length).toBeGreaterThan(0);
  });
});
