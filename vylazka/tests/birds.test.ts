import { describe, expect, it } from 'vitest';
import { BIRD_STRIDE, DEFAULT_BIRDS, Flock, flockSize, Leaver, packBird } from '../src/systems/birds';
import type { BirdPose, Perch } from '../src/systems/birds';

const C = DEFAULT_BIRDS;
const DT = 1 / 60;

/** Шесть мест под крышей на разной высоте. */
const PERCHES: Perch[] = [
  { pos: [0, 6, 0], yaw: 0 },
  { pos: [6, 6.2, 1], yaw: Math.PI / 2 },
  { pos: [12, 5.8, -2], yaw: 0.7 },
  { pos: [3, 6.4, 8], yaw: 2 },
  { pos: [9, 6.1, 9], yaw: -1 },
  { pos: [15, 6, 6], yaw: 3 },
];
const SEED = 20041113;
const COUNT = 6;

const dist3 = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('стая: расписание — чистая функция времени', () => {
  it('pose(i, t) детерминирована: два вызова с одним t дают одно и то же', () => {
    const f = new Flock(PERCHES, COUNT, SEED);
    for (const t of [0, 3.3, 50, 137.5]) {
      for (let i = 0; i < COUNT; i++) expect(f.pose(i, t)).toEqual(f.pose(i, t));
    }
  });

  it('вызов с t назад после t вперёд даёт то же, что свежая стая с тем же сидом', () => {
    const used = new Flock(PERCHES, COUNT, SEED);
    for (let i = 0; i < COUNT; i++) used.pose(i, 500);
    for (const t of [0, 7.7, 42, 123]) {
      for (let i = 0; i < COUNT; i++) {
        const fresh = new Flock(PERCHES, COUNT, SEED);
        expect(used.pose(i, t), `птица ${i}, t=${t}`).toEqual(fresh.pose(i, t));
      }
    }
  });

  it('другой сид — другое расписание', () => {
    const a = new Flock(PERCHES, COUNT, 1);
    const b = new Flock(PERCHES, COUNT, 2);
    let differ = false;
    for (let i = 0; i < COUNT; i++) if (JSON.stringify(a.pose(i, 30)) !== JSON.stringify(b.pose(i, 30))) differ = true;
    expect(differ).toBe(true);
  });

  it('стая с меньше чем двумя местами пуста', () => {
    expect(new Flock([], 5, 1).count).toBe(0);
    expect(new Flock([PERCHES[0]!], 5, 1).count).toBe(0);
    expect(new Flock(PERCHES.slice(0, 2), 5, 1).count).toBe(5);
  });
});

describe('стая: сидит и летит', () => {
  it('сидящая птица стоит на точке одного из мест (сдвиг вдоль балки до 0,25 м), open = 0, не летит', () => {
    const f = new Flock(PERCHES, COUNT, SEED);
    let sat = 0;
    for (let i = 0; i < COUNT; i++) {
      for (let t = 0; t < 120; t += 0.25) {
        const p = f.pose(i, t);
        if (p.flying) continue;
        sat += 1;
        expect(p.open).toBe(0);
        const near = PERCHES.some((q) => Math.abs(q.pos[1] - p.pos[1]) < 1e-9 && Math.hypot(q.pos[0] - p.pos[0], q.pos[2] - p.pos[2]) <= 0.25 + 1e-9);
        expect(near, `птица ${i}, t=${t}`).toBe(true);
      }
    }
    expect(sat).toBeGreaterThan(100);
  });

  it('в полёте: flying, 0 ≤ open ≤ 1; в середине перелёта open > 0,9', () => {
    const f = new Flock(PERCHES, COUNT, SEED);
    let flights = 0;
    for (let i = 0; i < COUNT; i++) {
      let start = -1;
      for (let t = 0; t < 120; t += DT) {
        const p = f.pose(i, t);
        if (p.flying) {
          expect(p.open).toBeGreaterThanOrEqual(0);
          expect(p.open).toBeLessThanOrEqual(1);
          if (start < 0) start = t;
        } else if (start === 0) {
          // Птица уже летела в нулевой момент: начала перелёта мы не видели, середину не проверяем.
          start = -1;
        } else if (start >= 0) {
          // Перелёт [start, t): середина.
          const mid = f.pose(i, (start + t) / 2);
          expect(mid.flying).toBe(true);
          expect(mid.open, `птица ${i}, перелёт с ${start.toFixed(2)}`).toBeGreaterThan(0.9);
          flights += 1;
          start = -1;
        }
      }
    }
    expect(flights).toBeGreaterThan(10);
  });

  it('позиция непрерывна: за шаг 1/60 с птица сдвигается не больше speed × 3 / 60 м (120 с, все птицы)', () => {
    const f = new Flock(PERCHES, COUNT, SEED);
    const lim = (C.speed * 3) / 60;
    for (let i = 0; i < COUNT; i++) {
      let prev = f.pose(i, 0).pos;
      let worst = 0;
      for (let k = 1; k <= 120 * 60; k++) {
        const p = f.pose(i, k * DT).pos;
        const d = dist3(prev, p);
        if (d > worst) worst = d;
        prev = p;
      }
      expect(worst, `птица ${i}`).toBeLessThanOrEqual(lim);
    }
  });

  it('в полёте птица не поднимается выше обеих своих балок больше чем на 0,05 м', () => {
    const f = new Flock(PERCHES, COUNT, SEED);
    for (let i = 0; i < COUNT; i++) {
      const ts: number[] = [];
      const poses: BirdPose[] = [];
      for (let t = 0; t < 120; t += DT) {
        ts.push(t);
        poses.push(f.pose(i, t));
      }
      let last = 0; // последний индекс сидящей позы
      for (let k = 0; k < poses.length; k++) {
        if (poses[k]!.flying) continue;
        if (k - last > 1) {
          const top = Math.max(poses[last]!.pos[1], poses[k]!.pos[1]);
          for (let j = last + 1; j < k; j++) expect(poses[j]!.pos[1], `птица ${i}, t=${ts[j]}`).toBeLessThanOrEqual(top + 0.05);
        }
        last = k;
      }
    }
  });

  it('за 300 секунд каждая птица хотя бы трижды сменила место; в полёте от 10 % до 45 % времени стаи', () => {
    const f = new Flock(PERCHES, COUNT, SEED);
    const step = 0.1;
    let air = 0;
    let all = 0;
    for (let i = 0; i < COUNT; i++) {
      let was = f.pose(i, 0).flying;
      let takeoffs = 0;
      for (let t = step; t <= 300; t += step) {
        const fl = f.pose(i, t).flying;
        if (fl && !was) takeoffs += 1;
        if (fl) air += 1;
        all += 1;
        was = fl;
      }
      expect(takeoffs, `птица ${i}`).toBeGreaterThanOrEqual(3);
    }
    const share = air / all;
    expect(share).toBeGreaterThanOrEqual(0.1);
    expect(share).toBeLessThanOrEqual(0.45);
    // То же через flying(t): число птиц в воздухе в момент не превышает размер стаи.
    expect(f.flying(100)).toBeLessThanOrEqual(COUNT);
  });
});

describe('flockSize', () => {
  it('без стёртости — вся стая; с ростом стёртости не растёт; полная стёртость — ноль', () => {
    expect(flockSize(6, 0)).toBe(6);
    let prev = 6;
    for (let w = 0; w <= 1.0001; w += 0.05) {
      const n = flockSize(6, w);
      expect(n).toBeLessThanOrEqual(prev);
      expect(n).toBeGreaterThanOrEqual(0);
      prev = n;
    }
    expect(flockSize(6, 1)).toBe(0);
    // Вне 0..1 — зажимается.
    expect(flockSize(6, -3)).toBe(6);
    expect(flockSize(6, 5)).toBe(0);
  });
});

describe('Leaver: птица, которую можно спугнуть', () => {
  const perch: Perch = { pos: [1, 0.1, 2], yaw: 0.4 };

  it('без to: пока игрок далеко — сидит; в момент испуга update один раз возвращает true', () => {
    const b = new Leaver(perch, null, 5);
    for (let i = 0; i < 10; i++) expect(b.update(DT, C.scare + 1)).toBe(false);
    expect(b.state).toBe('sits');
    const p = b.pose()!;
    expect(p.flying).toBe(false);
    expect(p.pos).toEqual(perch.pos);
    expect(b.update(DT, C.scare - 0.1)).toBe(true);
    expect(b.state).toBe('leaves');
    expect(b.update(DT, C.scare - 0.1)).toBe(false);
    expect(b.state).toBe('leaves');
  });

  it('ровно на расстоянии scare ещё не срывается', () => {
    const b = new Leaver(perch, null, 5);
    expect(b.update(DT, C.scare)).toBe(false);
    expect(b.state).toBe('sits');
  });

  it('без to: через leave секунд — gone и pose() = null; пока летит — высота не убывает, к концу выше места на 8+ м', () => {
    const b = new Leaver(perch, null, 5);
    b.update(DT, 1);
    let prevY = b.pose()!.pos[1];
    let lastY = prevY;
    let guard = 0;
    while (b.state === 'leaves' && guard++ < 100000) {
      b.update(DT, 1);
      const p = b.pose();
      if (!p) break;
      expect(p.flying).toBe(true);
      expect(p.pos[1]).toBeGreaterThanOrEqual(prevY - 1e-9);
      prevY = p.pos[1];
      lastY = prevY;
    }
    expect(b.state).toBe('gone');
    expect(b.pose()).toBeNull();
    expect(lastY - perch.pos[1]).toBeGreaterThanOrEqual(8);
  });

  it('без to: время в воздухе — cfg.leave секунд', () => {
    const b = new Leaver(perch, null, 5);
    expect(b.flight).toBe(C.leave);
    b.update(0.5, 1);
    for (let i = 0; i < 10; i++) b.update(0.5, 1);
    expect(b.state).toBe('leaves'); // 5,0 с из 5,5
    b.update(0.5, 1);
    expect(b.state).toBe('gone');
  });

  it('с to: после полёта — moved, поза на новом месте, не летит', () => {
    const to: Perch = { pos: [6, 6, 2], yaw: 1.2 };
    const b = new Leaver(perch, to, 5);
    expect(b.update(DT, 1)).toBe(true);
    let guard = 0;
    while (b.state === 'leaves' && guard++ < 100000) {
      const p = b.pose()!;
      expect(p.flying).toBe(true);
      b.update(DT, 1);
    }
    expect(b.state).toBe('moved');
    const p = b.pose()!;
    expect(p.flying).toBe(false);
    expect(p.pos).toEqual(to.pos);
    expect(p.yaw).toBe(to.yaw);
    expect(p.open).toBe(0);
    // Дальше остаётся там же, сколько бы ни подходили.
    expect(b.update(DT, 0.1)).toBe(false);
    expect(b.state).toBe('moved');
  });
});

describe('packBird', () => {
  it('девять чисел в нужном порядке: x, y, z, yaw, pitch, roll, фаза по модулю 2π, раскрытие, размер', () => {
    expect(BIRD_STRIDE).toBe(9);
    const out = new Float32Array(BIRD_STRIDE * 3);
    const pose: BirdPose = { pos: [1.5, 2.5, 3.5], yaw: 0.25, pitch: -0.5, roll: 0.75, flap: 7, open: 0.6, flying: true };
    packBird(out, 1, pose, 1.25);
    const o = BIRD_STRIDE;
    const want = [1.5, 2.5, 3.5, 0.25, -0.5, 0.75, 7 % (Math.PI * 2), 0.6, 1.25];
    for (let k = 0; k < 9; k++) expect(out[o + k]!).toBeCloseTo(want[k]!, 5);
    // Соседние гнёзда не тронуты.
    for (let k = 0; k < 9; k++) {
      expect(out[k]).toBe(0);
      expect(out[2 * o + k]).toBe(0);
    }
  });
});
