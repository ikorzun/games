import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import { SwarmAI } from '../src/swarm/ai';
import type { SwarmInput } from '../src/swarm/ai';
import { MAX_WORMS, SwarmBody } from '../src/swarm/body';
import { Anomalies } from '../src/systems/anomalies';
import { Director } from '../src/systems/director';
import type { DirectorEvent } from '../src/systems/director';
import type { NavNode } from '../src/world/level';
import { buildLevel, STAIR_RISE, STAIR_RUN, STAIR_STEPS } from '../src/world/level_build';

const DT = 1 / 60;

/** Прямой коридор из n узлов через 3 м. */
function line(n: number): NavNode[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, tier: 0, cx: i, cz: 0, x: i * 3, y: 0, z: 0, room: 0, links: [i - 1, i + 1].filter((k) => k >= 0 && k < n) }));
}

const at = (node: number, extra: Partial<SwarmInput> = {}): SwarmInput => ({ player: [node * 3, 0, 0], playerNode: node, lightOn: true, beamOnSwarm: false, noise: 0, ...extra });

function run(sw: SwarmAI, seconds: number, inp: SwarmInput | ((t: number) => SwarmInput)): { caught: boolean; scattered: number; cohered: number } {
  const res = { caught: false, scattered: 0, cohered: 0 };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const o = sw.update(DT, typeof inp === 'function' ? inp(i * DT) : inp);
    if (o.caught) res.caught = true;
    if (o.scattered) res.scattered += 1;
    if (o.cohered) res.cohered += 1;
    if (o.caught) break;
  }
  return res;
}

describe('рой: поведение', () => {
  it('спит, пока не выпустили; в темноте и тишине не находит игрока', () => {
    const sw = new SwarmAI(line(20), mulberry32(1));
    expect(run(sw, 5, at(10)).caught).toBe(false);
    expect(sw.mode).toBe('dormant');
    expect(sw.proximity([30, 0, 0])).toBe(0);
    sw.activate(0);
    const r = run(sw, 40, at(15, { lightOn: false }));
    expect(r.caught).toBe(false);
    expect(sw.awareness).toBe(0);
    expect(['roam']).toContain(sw.mode);
  });

  it('идёт на свет: замечает, подходит, собирается в фигуру и охотится', () => {
    const sw = new SwarmAI(line(20), mulberry32(2));
    sw.activate(0);
    const r = run(sw, 30, at(7));
    expect(r.cohered).toBe(1);
    expect(r.caught).toBe(true);
    expect(sw.mode).toBe('hunt');
    expect(sw.cohesion).toBe(1);
  });

  it('слышит шум издалека меньше, чем видит свет: тряска фонаря выдаёт игрока в темноте', () => {
    const quiet = new SwarmAI(line(20), mulberry32(3));
    quiet.activate(0);
    run(quiet, 6, at(5, { lightOn: false, noise: 0 }));
    expect(quiet.awareness).toBe(0);
    const loud = new SwarmAI(line(20), mulberry32(3));
    loud.activate(0);
    run(loud, 6, at(5, { lightOn: false, noise: 0.9 }));
    expect(loud.awareness).toBeGreaterThan(0.5);
    // Тихий шаг в десяти клетках не слышен.
    const far = new SwarmAI(line(20), mulberry32(3));
    far.activate(0);
    run(far, 6, at(10, { lightOn: false, noise: 0.12 }));
    expect(far.awareness).toBe(0);
  });

  it('прямой луч разваливает рой, но он возвращается — с каждым разом быстрее', () => {
    const sw = new SwarmAI(line(30), mulberry32(4));
    sw.activate(12);
    sw.mode = 'hunt';
    sw.cohesion = 1;
    sw.awareness = 1;
    const r1 = run(sw, 3, at(15, { beamOnSwarm: true }));
    expect(r1.scattered).toBe(1);
    expect(r1.caught).toBe(false);
    expect(sw.mode).toBe('scatter');
    expect(sw.aggravation).toBe(1);
    // Пока рассыпан — не опасен и не глушит фонарь.
    run(sw, 1, at(15));
    expect(sw.proximity([45, 0, 0])).toBe(0);
    let back1 = 0;
    for (; back1 < 20 * 60 && sw.mode !== 'hunt'; back1++) sw.update(DT, at(15, { beamOnSwarm: false }));
    expect(sw.mode).toBe('hunt');
    const r2 = run(sw, 3, at(15, { beamOnSwarm: true }));
    expect(r2.scattered).toBe(1);
    let back2 = 0;
    for (; back2 < 20 * 60 && sw.mode !== 'hunt'; back2++) sw.update(DT, at(15, { beamOnSwarm: false }));
    expect(back2).toBeLessThan(back1);
  });

  it('под лучом ползёт медленно; в темноте охотится быстрее, чем на свету', () => {
    const dist = (extra: Partial<SwarmInput>): number => {
      const sw = new SwarmAI(line(40), mulberry32(5));
      sw.activate(0);
      sw.mode = 'hunt';
      sw.cohesion = 1;
      sw.awareness = 1;
      const x0 = sw.pos[0];
      // Меньше времени, чем нужно лучу, чтобы развалить рой.
      for (let i = 0; i < 60; i++) {
        sw.awareness = 1;
        sw.update(DT, at(30, extra));
      }
      return sw.pos[0] - x0;
    };
    const beam = dist({ beamOnSwarm: true });
    const lit = dist({});
    const dark = dist({ lightOn: false });
    expect(beam).toBeLessThan(lit * 0.4);
    expect(dark).toBeGreaterThan(lit * 1.3);
  });

  it('потеряв игрока в темноте и тишине, охота прекращается', () => {
    const sw = new SwarmAI(line(40), mulberry32(6));
    sw.activate(0);
    sw.mode = 'hunt';
    sw.cohesion = 1;
    sw.awareness = 1;
    const r = run(sw, 12, at(30, { lightOn: false }));
    expect(r.caught).toBe(false);
    expect(sw.mode).toBe('roam');
  });

  it('явление: фигура стоит и рассыпается от луча или когда к ней подошли; не охотится', () => {
    const a = new SwarmAI(line(20), mulberry32(7));
    a.appear(8, 6);
    expect(a.mode).toBe('apparition');
    const r = run(a, 0.6, at(2, { beamOnSwarm: true }));
    expect(r.scattered).toBe(1);
    expect(a.mode).toBe('dormant');
    const b = new SwarmAI(line(20), mulberry32(7));
    b.appear(8, 6);
    expect(run(b, 5, at(2)).caught).toBe(false);
    expect(b.mode).toBe('apparition');
    run(b, 2, at(2));
    expect(b.mode).toBe('dormant');
    const c = new SwarmAI(line(20), mulberry32(7));
    c.appear(8, 60);
    run(c, 0.2, at(7));
    expect(c.mode).toBe('dormant');
  });

  it('на настоящем уровне рой доходит от дальнего узла до игрока через ярусы', () => {
    const level = buildLevel(generateLayout(20041113, 3));
    const sw = new SwarmAI(level.nav, mulberry32(8));
    const start = level.nav.findIndex((n) => n.room === level.layout!.entranceRoom);
    const far = level.nav.filter((n) => n.tier === 2).sort((p, q) => sw.route(start, q.id).length - sw.route(start, p.id).length)[0]!;
    expect(sw.route(start, far.id).length).toBeGreaterThan(15);
    sw.activate(far.id);
    const p = level.nav[start]!;
    let caught = false;
    for (let i = 0; i < 60 * 120 && !caught; i++) {
      sw.alert(start, 1);
      caught = sw.update(DT, { player: [p.x, p.y, p.z], playerNode: start, lightOn: false, beamOnSwarm: false, noise: 1 }).caught;
    }
    expect(caught).toBe(true);
  });
});

describe('рой: тело', () => {
  it('собранный рой — столб выше человека; рассеянный — пятно у пола', () => {
    const body = new SwarmBody(3);
    const center: Vec3 = [10, -4.5, 5];
    const stats = (c: number): { top: number; mean: number; spread: number } => {
      body.snap(center, c);
      for (let i = 0; i < 120; i++) body.update(DT, center, c, null);
      let top = -Infinity;
      let mean = 0;
      let spread = 0;
      for (let i = 0; i < MAX_WORMS; i++) {
        const y = body.heads[i * 3 + 1]! - center[1];
        top = Math.max(top, y);
        mean += y / MAX_WORMS;
        spread = Math.max(spread, Math.hypot(body.heads[i * 3]! - center[0], body.heads[i * 3 + 2]! - center[2]));
      }
      return { top, mean, spread };
    };
    const fig = stats(1);
    const flat = stats(0);
    expect(fig.top).toBeGreaterThan(1.9);
    expect(fig.spread).toBeLessThan(0.7);
    expect(flat.mean).toBeLessThan(fig.mean * 0.6);
    expect(flat.spread).toBeGreaterThan(1.5);
    for (let i = 0; i < MAX_WORMS * 3; i++) {
      expect(Number.isFinite(body.heads[i])).toBe(true);
      expect(Number.isFinite(body.dirs[i])).toBe(true);
    }
  });

  it('в момент поимки рой рывком смыкается в заданной точке', () => {
    const body = new SwarmBody(3);
    const center: Vec3 = [0, 0, 0];
    body.snap(center, 1);
    const lens: Vec3 = [3, 1.4, 0];
    for (let i = 0; i < 90; i++) body.update(DT, center, 1, lens);
    let near = 0;
    for (let i = 0; i < MAX_WORMS; i++) if (Math.hypot(body.heads[i * 3]! - 3, body.heads[i * 3 + 1]! - 1.4, body.heads[i * 3 + 2]!) < 0.6) near += 1;
    expect(near).toBeGreaterThan(MAX_WORMS * 0.8);
  });
});

describe('режиссёр страха', () => {
  const play = (seconds: number, tierAt: (t: number) => number, goals = 0, seed = 1): { events: Array<DirectorEvent & { t: number }>; d: Director } => {
    const d = new Director(mulberry32(seed));
    const events: Array<DirectorEvent & { t: number }> = [];
    let busy = false;
    for (let t = 0; t < seconds; t += 0.5) {
      for (const e of d.update({ time: t, tier: tierAt(t), goalsDone: goals, swarmBusy: busy, tiers: 3 })) {
        events.push({ ...e, t });
        if (e.type === 'release') busy = true;
      }
    }
    return { events, d };
  };

  it('первые минуты — только ложные события; потом явления; потом охота', () => {
    const { events } = play(400, () => 0);
    const firstScare = events.find((e) => e.type === 'scare')!;
    const firstGlimpse = events.find((e) => e.type === 'apparition')!;
    const release = events.find((e) => e.type === 'release')!;
    expect(firstScare.t).toBeGreaterThan(15);
    expect(firstScare.t).toBeLessThan(40);
    expect(firstGlimpse.t).toBeGreaterThan(75);
    expect(release.t).toBeGreaterThanOrEqual(210);
    expect(events.filter((e) => e.type === 'release').length).toBe(1);
    expect(events.filter((e) => e.t < 75).every((e) => e.type === 'scare')).toBe(true);
  });

  it('спуск ускоряет события: на втором ярусе рой мелькает, на нижнем — выходит сразу', () => {
    const a = play(120, (t) => (t > 30 ? 1 : 0));
    expect(a.events.find((e) => e.type === 'apparition')!.t).toBeLessThan(60);
    expect(a.events.some((e) => e.type === 'release')).toBe(false);
    const b = play(120, (t) => (t > 30 ? 2 : 0));
    expect(b.events.find((e) => e.type === 'release')!.t).toBeLessThan(35);
    // Первая цель на втором ярусе — тоже сигнал к охоте.
    const c = play(120, (t) => (t > 30 ? 1 : 0), 1);
    expect(c.events.find((e) => e.type === 'release')!.t).toBeLessThan(35);
  });

  it('пугалки не повторяются подряд и идут с паузами; «гаснущие надписи» — только в глубине', () => {
    const { events } = play(900, () => 0, 0, 5);
    const scares = events.filter((e) => e.type === 'scare') as Array<{ type: 'scare'; id: string; t: number }>;
    expect(scares.length).toBeGreaterThan(8);
    for (let i = 1; i < scares.length; i++) {
      expect(scares[i]!.id).not.toBe(scares[i - 1]!.id);
      expect(scares[i]!.t - scares[i - 1]!.t).toBeGreaterThanOrEqual(27.5);
    }
    expect(scares.some((s) => s.id === 'signs')).toBe(false);
    const deep = play(900, () => 1, 0, 5).events.filter((e) => e.type === 'scare') as Array<{ id: string }>;
    expect(deep.some((s) => s.id === 'signs')).toBe(true);
  });
});

describe('аномалии', () => {
  const level = buildLevel(generateLayout(20041113, 3));
  const stair = level.stairs.find((s) => s.upperTier === 1)!;
  const geo = { run: STAIR_RUN, rise: STAIR_RISE, steps: STAIR_STEPS };
  const ax = Math.sign(stair.bottom[0] - stair.top[0]);
  const az = Math.sign(stair.bottom[2] - stair.top[2]);
  /** Точка на марше в s метрах по горизонтали от верхней кромки. */
  const onStair = (s: number): Vec3 => [stair.top[0] + ax * (1.5 + s), stair.top[1] - Math.ceil(s / STAIR_RUN) * STAIR_RISE, stair.top[2] + az * (1.5 + s)];

  it('лестница вниз удлиняется дважды: сдвиг ровно на десять ступеней назад и вверх', () => {
    const an = new Anomalies(stair, geo, [], 2);
    let shifts = 0;
    let s = 0;
    for (let i = 0; i < 2000 && s < 9; i++) {
      s += 2.3 * DT;
      for (const e of an.update(onStair(s), -1, false)) {
        if (e.type !== 'shift') continue;
        shifts += 1;
        expect(e.dx).toBeCloseTo(-ax * 3, 6);
        expect(e.dz).toBeCloseTo(-az * 3, 6);
        expect(e.dy).toBeCloseTo(1.5, 6);
        s -= 3;
      }
    }
    expect(shifts).toBe(2);
    expect(an.loops).toBe(0);
  });

  it('на подъёме, рядом с роем и на обычной лестнице сдвигов нет', () => {
    const up = new Anomalies(stair, geo, [], 2);
    let n = 0;
    for (let s = 8.9; s > 0; s -= 2.3 * DT) n += up.update(onStair(s), -1, false).length;
    expect(n).toBe(0);
    const blocked = new Anomalies(stair, geo, [], 2);
    for (let s = 0; s < 9; s += 2.3 * DT) n += blocked.update(onStair(s), -1, true).length;
    expect(n).toBe(0);
    const none = new Anomalies(null, geo, [], 2);
    expect(none.loops).toBe(0);
    for (let s = 0; s < 9; s += 2.3 * DT) n += none.update(onStair(s), -1, false).length;
    expect(n).toBe(0);
  });

  it('комната меняется, только когда в ней побывали и ушли далеко; потом меняется обратно', () => {
    expect(level.variants.length).toBe(1);
    const v = level.variants[0]!;
    expect(level.layout!.rooms[v.room]!.tier).toBe(2);
    expect(level.chunks.some((c) => c.id === v.chunkA && !c.hidden)).toBe(true);
    expect(level.chunks.some((c) => c.id === v.chunkB && c.hidden === true)).toBe(true);
    expect(level.colliders.boxes.some((b) => b.group === v.groupA && !b.off)).toBe(true);
    expect(level.colliders.boxes.some((b) => b.group === v.groupB && b.off === true)).toBe(true);
    // В комнате-аномалии нет ни находок, ни целей.
    expect(level.spots.some((s) => s.room === v.room)).toBe(false);
    expect(level.landmarks.some((l) => l.room === v.room)).toBe(false);

    const an = new Anomalies(null, geo, level.variants, 0);
    const far: Vec3 = [v.center[0] + 20, v.center[1], v.center[2]];
    expect(an.update(far, -1, false)).toEqual([]);
    expect(an.update(v.center, v.room, false)).toEqual([]);
    // Вышли, но недалеко — ещё видно.
    expect(an.update([v.center[0] + 6, v.center[1], v.center[2]], -1, false)).toEqual([]);
    const ev = an.update(far, -1, false);
    expect(ev).toEqual([{ type: 'variant', variant: v, alt: true }]);
    expect(an.update(far, -1, false)).toEqual([]);
    an.update(v.center, v.room, false);
    expect(an.update(far, -1, false)).toEqual([{ type: 'variant', variant: v, alt: false }]);
    // Состояние переживает сохранение.
    an.update(v.center, v.room, false);
    an.update(far, -1, false);
    const again = new Anomalies(stair, geo, level.variants, 2);
    expect(again.restore({ loops: 1, alt: an.state().alt })).toEqual([{ type: 'variant', variant: v, alt: true }]);
    expect(again.loops).toBe(1);
  });

  it('на первом ранге аномалий нет', () => {
    const l1 = buildLevel(generateLayout(20041113, 1));
    expect(l1.variants).toEqual([]);
  });
});
