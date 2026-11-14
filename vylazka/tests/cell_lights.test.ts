import { describe, expect, it } from 'vitest';
import { CellLights, DEFAULT_CELL_LIGHTS, panelDead } from '../src/systems/cell_lights';
import type { NavNode } from '../src/world/level';

/** Прямой коридор из n клеток (помещение 0) и комната 2 × 2 (помещение 1) за дверью у клетки at. */
function corridorWithRoom(n: number, at: number): NavNode[] {
  const nav: NavNode[] = [];
  for (let i = 0; i < n; i++) nav.push({ id: i, tier: 0, cx: 1 + i, cz: 5, x: i * 3, y: 0, z: 0, room: 0, links: [] });
  for (let i = 0; i + 1 < n; i++) {
    nav[i]!.links.push(i + 1);
    nav[i + 1]!.links.push(i);
  }
  const room: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const first = nav.length;
  room.forEach(([dx, dz], k) => nav.push({ id: first + k, tier: 0, cx: 1 + at + dx, cz: 6 + dz, x: (at + dx) * 3, y: 0, z: 3 + dz * 3, room: 1, links: [] }));
  const link = (a: number, b: number): void => {
    nav[a]!.links.push(b);
    nav[b]!.links.push(a);
  };
  link(first, first + 1);
  link(first, first + 2);
  link(first + 1, first + 3);
  link(first + 2, first + 3);
  link(at, first);
  return nav;
}

function sensor(nav: NavNode[]): CellLights {
  const l = new CellLights(nav, 'sensor', 7);
  l.corridorRooms.add(0);
  return l;
}

const run = (l: CellLights, seconds: number, playerNode: number, driftNode = -1, from = 0): void => {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) l.update(dt, { playerNode, driftNode, time: from + i * dt });
};

describe('свет по клеткам: датчики офиса', () => {
  it('сначала темно; свет загорается там, где игрок, и в двух клетках пути от него', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    expect([...l.level].every((v) => v === 0)).toBe(true);
    run(l, 1, 0);
    expect(l.at(0)).toBeGreaterThan(0.95);
    expect(l.at(1)).toBeGreaterThan(0.95);
    expect(l.at(2)).toBeGreaterThan(0.95);
    expect(l.at(3)).toBeLessThan(0.05);
    expect(l.at(9)).toBe(0);
  });

  it('панели впереди загораются по очереди: ближняя раньше дальней', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    run(l, 0.09, 4);
    // Клетка под игроком уже светится, сосед только разгорается, клетка через одну ещё тёмная.
    expect(l.at(4)).toBeGreaterThan(0.6);
    expect(l.at(5)).toBeLessThan(l.at(4));
    expect(l.at(6)).toBeLessThan(0.05);
    run(l, 0.6, 4);
    expect(l.at(6)).toBeGreaterThan(0.9);
  });

  it('свет идёт за игроком: позади панель горит ещё полторы секунды и гаснет', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    run(l, 1, 0);
    run(l, 1, 5);
    // Клетка 0 теперь в пяти клетках пути: ещё держится.
    expect(l.at(0)).toBeGreaterThan(0.9);
    expect(l.at(5)).toBeGreaterThan(0.95);
    run(l, DEFAULT_CELL_LIGHTS.hold + 1.5, 5);
    expect(l.at(0)).toBeLessThan(0.02);
    expect(l.at(3)).toBeGreaterThan(0.95);
  });

  it('в комнате свет включается целиком, как только игрок вошёл', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    const room = nav.filter((n) => n.room === 1).map((n) => n.id);
    run(l, 1, room[0]!);
    for (const id of room) expect(l.at(id)).toBeGreaterThan(0.95);
  });

  it('Осыпь гасит свет вокруг себя — даже там, где стоит игрок, — и он не загорается, пока она рядом', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    run(l, 1, 4);
    expect(l.at(4)).toBeGreaterThan(0.95);
    run(l, 0.5, 4, 5);
    expect(l.at(5)).toBeLessThan(0.02);
    expect(l.at(4)).toBeLessThan(0.02);
    expect(l.at(6)).toBeLessThan(0.02);
    // В двух клетках от неё свет остаётся.
    expect(l.at(3)).toBeGreaterThan(0.95);
    // Она ушла: свет возвращается не сразу.
    run(l, 1, 4, -1);
    expect(l.at(4)).toBeLessThan(0.02);
    run(l, DEFAULT_CELL_LIGHTS.driftHold + 0.5, 4, -1);
    expect(l.at(4)).toBeGreaterThan(0.95);
  });

  it('в «тёмном» помещении панели не загораются вовсе', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    l.offRooms.add(1);
    const room = nav.filter((n) => n.room === 1).map((n) => n.id);
    run(l, 2, room[0]!);
    for (const id of room) expect(l.at(id)).toBe(0);
    // Коридор у двери при этом освещён.
    expect(l.at(8)).toBeGreaterThan(0.95);
  });

  it('игрока в этом мире нет (карманное пространство) — свет гаснет', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    run(l, 1, 2);
    run(l, DEFAULT_CELL_LIGHTS.hold + 1.5, -1);
    expect([...l.level].every((v) => v < 0.02)).toBe(true);
  });

  it('текстура: свет клетки и номер помещения лежат на месте клетки в сетке; пустые клетки — нули', () => {
    const nav = corridorWithRoom(10, 8);
    const l = sensor(nav);
    run(l, 1, 0);
    expect(l.data.length).toBe(16 * 16 * 4);
    const at = (cx: number, cz: number): number[] => [...l.data.slice((cz * 16 + cx) * 4, (cz * 16 + cx) * 4 + 4)];
    expect(at(1, 5)).toEqual([255, 1, 0, 255]);
    expect(at(9, 6)[1]).toBe(2);
    expect(at(9, 6)[0]).toBe(0);
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('свет по клеткам: жёлтые комнаты', () => {
  const big = (): NavNode[] => {
    const nav: NavNode[] = [];
    for (let z = 0; z < 12; z++) for (let x = 0; x < 12; x++) nav.push({ id: z * 12 + x, tier: 0, cx: x + 2, cz: z + 2, x: x * 3, y: 0, z: z * 3, room: 0, links: [] });
    for (const n of nav) {
      const x = n.id % 12;
      const z = (n.id - x) / 12;
      if (x + 1 < 12) n.links.push(n.id + 1);
      if (x > 0) n.links.push(n.id - 1);
      if (z + 1 < 12) n.links.push(n.id + 12);
      if (z > 0) n.links.push(n.id - 12);
    }
    return nav;
  };

  it('свет горит сразу и везде, кроме мёртвых панелей; мёртвых — около шестой части', () => {
    const nav = big();
    const l = new CellLights(nav, 'hum', 20041113);
    const dead = nav.filter((n) => panelDead(20041113, n.cx, n.cz));
    expect(dead.length).toBeGreaterThan(nav.length * 0.08);
    expect(dead.length).toBeLessThan(nav.length * 0.26);
    for (const n of nav) {
      if (panelDead(20041113, n.cx, n.cz)) expect(l.at(n.id)).toBe(0);
      else expect(l.at(n.id)).toBeGreaterThan(0.65);
    }
    // От игрока свет не зависит.
    run(l, 2, -1);
    for (const n of nav) if (!panelDead(20041113, n.cx, n.cz)) expect(l.at(n.id)).toBeGreaterThan(0.1);
  });

  it('часть панелей мерцает: их свет то и дело проваливается; остальные горят ровно', () => {
    const nav = big();
    const l = new CellLights(nav, 'hum', 20041113);
    const lo = new Float32Array(nav.length).fill(1);
    const hi = new Float32Array(nav.length);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 20; i++) {
      l.update(dt, { playerNode: 0, driftNode: -1, time: i * dt });
      for (let k = 0; k < nav.length; k++) {
        lo[k] = Math.min(lo[k]!, l.level[k]!);
        hi[k] = Math.max(hi[k]!, l.level[k]!);
      }
    }
    const lit = nav.filter((n) => !panelDead(20041113, n.cx, n.cz));
    const flicker = lit.filter((n) => hi[n.id]! - lo[n.id]! > 0.3);
    const steady = lit.filter((n) => hi[n.id]! - lo[n.id]! < 0.02);
    expect(flicker.length).toBeGreaterThan(3);
    expect(flicker.length).toBeLessThan(lit.length * 0.35);
    expect(steady.length + flicker.length).toBe(lit.length);
  });

  it('Осыпь гасит панели и здесь', () => {
    const nav = big();
    const l = new CellLights(nav, 'hum', 5);
    const mid = 6 * 12 + 6;
    run(l, 0.5, 0, mid);
    expect(l.at(mid)).toBeLessThan(0.02);
    expect(l.at(mid + 1)).toBeLessThan(0.02);
    const far = nav.find((n) => !panelDead(5, n.cx, n.cz) && Math.abs((n.id % 12) - 6) > 3)!;
    expect(l.at(far.id)).toBeGreaterThan(0.1);
  });

  it('какая панель мертва, зависит только от сида и клетки', () => {
    expect(panelDead(1, 3, 4)).toBe(panelDead(1, 3, 4));
    let diff = 0;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) if (panelDead(1, x, z) !== panelDead(2, x, z)) diff += 1;
    expect(diff).toBeGreaterThan(10);
  });
});
