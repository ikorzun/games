/**
 * Швы офис ↔ жёлтые комнаты (docs/vylazka/pressure.md, §4.1): у офиса и его жёлтой версии один план, швы на нём — одни и те же,
 * их тем больше, чем сильнее место стёрто. Игра (переход в темноте) — tests/game_session.test.ts, «швы».
 */
import { describe, expect, it } from 'vitest';
import { generateLayout, twinLayout } from '../src/gen/layout';
import type { GenLayout } from '../src/gen/layout';
import { WEAR } from '../src/systems/decay';
import { buildLevel } from '../src/world/level_build';
import type { BuiltLevel } from '../src/world/level';
import { SEAM_OBJ } from '../src/world/objects';
import { SEAM, seamCount, seamNear, seamRooms, seamSites } from '../src/world/seams';

const SEEDS = [20041113, 7, 1984, 42, 9001, 31337, 808, 123456789];
/** Стёртость в начале круга n. */
const lap = (n: number): number => (n - 1) * WEAR.lap;

/** Стены плана: для каждой стороны каждой клетки — стена, проход (и какой) или та же комната. */
function walls(l: GenLayout): string[] {
  const at = new Map<string, number>();
  for (const r of l.rooms) for (const [x, z] of r.cells) at.set(`${r.tier},${x},${z}`, r.id);
  const edge = new Map(l.edges.map((e) => [`${e.tier},${e.cx},${e.cz},${e.dir}`, e.kind]));
  const out: string[] = [];
  for (const r of l.rooms)
    for (const [x, z] of r.cells)
      for (const [d, dx, dz] of [
        [0, 1, 0],
        [1, 0, 1],
      ] as const) {
        const o = at.get(`${r.tier},${x + dx},${z + dz}`);
        out.push(`${r.tier},${x},${z},${d}:${o === r.id ? 'same' : (edge.get(`${r.tier},${x},${z},${d}`) ?? 'wall')}`);
      }
  return out.sort();
}

describe('жёлтая версия офиса: тот же план', () => {
  it('помещения, клетки, проходы и стены — те же; другое только назначение и мир', () => {
    for (const seed of SEEDS) {
      const office = generateLayout(seed, 2, 'office');
      const twin = twinLayout(office);
      expect(twin.world).toBe('yellow');
      expect(twin.twinOf).toBe('office');
      expect(twin.seed).toBe(office.seed);
      expect(twin.rooms.map((r) => [r.id, r.tier, r.cells])).toEqual(office.rooms.map((r) => [r.id, r.tier, r.cells]));
      expect(twin.edges).toEqual(office.edges);
      expect(twin.entranceRoom).toBe(office.entranceRoom);
      expect(walls(twin)).toEqual(walls(office));
      // Назначение ушло: кроме проходов, отдела, комнаты отдыха и санузла — пустые залы.
      for (const r of twin.rooms) expect(['corridor', 'lift', 'reception', 'department', 'breakroom', 'washroom', 'hall']).toContain(r.type);
      expect(twin.rooms.filter((r) => r.type === 'hall').length).toBeGreaterThan(0);
      // План офиса не тронут.
      expect(office.rooms.some((r) => r.type === 'hall')).toBe(false);
    }
  });

  it('у собранных уровней тот же граф: узлы на тех же клетках, те же связи', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const office = generateLayout(seed, 2, 'office');
      const a = buildLevel(office);
      const b = buildLevel(twinLayout(office));
      expect(b.world).toBe('yellow');
      expect(b.nav.map((n) => [n.tier, n.cx, n.cz, n.x, n.y, n.z, n.room, [...n.links].sort()])).toEqual(a.nav.map((n) => [n.tier, n.cx, n.cz, n.x, n.y, n.z, n.room, [...n.links].sort()]));
      // Стены (преграды скорлупы: высокие и тонкие, от пола до потолка) — там же.
      const shellWalls = (l: BuiltLevel): string[] =>
        l.colliders.boxes
          .filter((x) => x.owner === undefined && x.maxY - x.minY > 2.9 && Math.min(x.maxX - x.minX, x.maxZ - x.minZ) < 0.31)
          .map((x) => [x.minX, x.minZ, x.maxX, x.maxZ].map((v) => v.toFixed(2)).join(','))
          .sort();
      expect(shellWalls(a).length).toBeGreaterThan(20);
      expect(shellWalls(b)).toEqual(shellWalls(a));
      // Обстановка — своя: в жёлтой версии пусто.
      expect((b.objects ?? []).length).toBeLessThan((a.objects ?? []).length);
    }
  });

  it('двойник бывает только у офиса; свой план жёлтых комнат остаётся своим', () => {
    expect(() => twinLayout(generateLayout(7, 2, 'shelter'))).toThrow();
    const own = generateLayout(7, 2, 'yellow');
    expect(own.twinOf).toBeUndefined();
    expect(own.rooms.map((r) => r.cells)).not.toEqual(generateLayout(7, 2, 'office').rooms.map((r) => r.cells));
  });
});

describe('швы: сколько и где', () => {
  it('на первом круге шов один; к шестому — в каждом втором помещении; дальше не растёт', () => {
    expect(seamCount(0, 13)).toBe(1);
    expect(seamCount(lap(6), 13)).toBe(7);
    expect(seamCount(1, 13)).toBe(7);
    let was = 0;
    for (let n = 1; n <= 8; n++) {
      const c = seamCount(lap(n), 13);
      expect(c).toBeGreaterThanOrEqual(was);
      was = c;
    }
    expect(seamCount(lap(2), 13)).toBeGreaterThan(1);
    expect(seamCount(0.3, 1)).toBe(1);
  });

  it('у офиса и его жёлтой версии швы одни и те же; число растёт со стёртостью', () => {
    for (const seed of SEEDS) {
      const office = generateLayout(seed, 2, 'office');
      const twin = twinLayout(office);
      const rooms = seamRooms(office).length;
      let was = 0;
      for (let n = 1; n <= 7; n++) {
        const s = seamSites(office, lap(n));
        expect(seamSites(twin, lap(n))).toEqual(s);
        expect(s.length).toBe(seamCount(lap(n), rooms));
        expect(s.length).toBeGreaterThanOrEqual(was);
        // Помещение — не больше одного шва; первый — в коридоре; швы круга n — и на круге n + 1 (место узнаётся).
        expect(new Set(s.map((x) => x.room)).size).toBe(s.length);
        expect(office.rooms[s[0]!.room]!.type).toBe('corridor');
        if (n > 1) expect(s.slice(0, was)).toEqual(seamSites(office, lap(n - 1)));
        was = s.length;
      }
      // Шестой круг — в каждом втором помещении.
      expect(seamSites(office, lap(6)).length).toBe(Math.ceil(rooms / 2));
    }
  });

  it('шов коридора — поперёк прямого участка, между глухими стенами, недалеко от входа', () => {
    for (const seed of SEEDS) {
      const office = generateLayout(seed, 2, 'office');
      const s = seamSites(office, 0)[0]!;
      expect(s.ends).toEqual(['wall', 'wall']);
      expect(s.cells).toHaveLength(1);
      // Нитка — поперёк клетки: от стены до стены, 3 м без толщины стен.
      expect(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])).toBeCloseTo(2.7, 5);
      // Рядом — в метре от нитки; в трёх метрах — уже нет.
      const mx = (s.a[0] + s.b[0]) / 2;
      const mz = (s.a[1] + s.b[1]) / 2;
      expect(seamNear([s], mx, s.y, mz)).toBe(0);
      const off: [number, number] = s.axis === 0 ? [mx, mz + 1] : [mx + 1, mz];
      expect(seamNear([s], off[0], s.y, off[1])).toBe(0);
      const far: [number, number] = s.axis === 0 ? [mx, mz + 3] : [mx + 3, mz];
      expect(seamNear([s], far[0], s.y, far[1])).toBe(-1);
      expect(seamNear([s], mx, s.y + 4.5, mz)).toBe(-1);
    }
  });

  it('нитка в сетке уровня: номер вершин шва, по полу и вверх по стене; у офиса и двойника, а не у других мест', () => {
    const office = generateLayout(20041113, 2, 'office');
    const count = (l: BuiltLevel): { verts: number; up: number } => {
      let verts = 0;
      let up = 0;
      for (const c of l.chunks) {
        const obj = c.mesh.obj;
        if (!obj) continue;
        for (let i = 0; i < obj.length; i++) {
          if (obj[i] !== SEAM_OBJ) continue;
          verts += 1;
          if (c.mesh.position[i * 3 + 1]! > 2) up += 1;
        }
      }
      return { verts, up };
    };
    const a = buildLevel(office, { wear: 0 });
    const b = buildLevel(twinLayout(office), { wear: 0 });
    expect(a.seams).toHaveLength(1);
    expect(b.seams).toEqual(a.seams);
    // Пол — четыре вершины, каждая стена — ещё четыре; у потолка — по две на стену.
    expect(count(a)).toEqual({ verts: 12, up: 4 });
    expect(count(b)).toEqual({ verts: 12, up: 4 });
    const late = buildLevel(office, { wear: lap(6) });
    expect(late.seams!.length).toBeGreaterThan(3);
    expect(count(late).verts).toBeGreaterThan(count(a).verts);
    for (const w of ['shelter', 'yellow', 'station'] as const) {
      const l = buildLevel(generateLayout(20041113, 2, w));
      expect(l.seams).toBeUndefined();
      expect(count(l).verts).toBe(0);
    }
    expect(SEAM.width).toBeGreaterThan(0.08);
  });
});
