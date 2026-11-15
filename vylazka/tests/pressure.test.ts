import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESSURE, nearestExit, Pressure } from '../src/systems/pressure';
import type { PressureInput, PressureKind, PressureOutcome, PressureRoom } from '../src/systems/pressure';

const DT = 1 / 60;
const C = DEFAULT_PRESSURE;

/** Помещение 6 × 9 м с одной дверью посреди восточной стены. */
const ROOM: PressureRoom = { id: 3, minX: 0, maxX: 6, minZ: 0, maxZ: 9, floorY: 0, height: 2.7, exits: [[6, 4.5]] };
/** То же, но с двумя выходами. */
const ROOM2: PressureRoom = { ...ROOM, id: 4, exits: [[6, 4.5], [0, 1.5]] };

const input = (pos: readonly [number, number], time: number, over: Partial<PressureInput> = {}): PressureInput => ({ time, pos, room: ROOM, quiet: false, limit: 3, kinds: ['collapse', 'squeeze'], ...over });

/**
 * Игрок идёт от pos к ближайшему выходу и дальше за порог со скоростью speed, начав через react секунд.
 * Возвращает, чем кончилось, и где он оказался.
 */
function walkOut(p: Pressure, room: PressureRoom, from: readonly [number, number], speed: number, react: number, seconds: number): { out: PressureOutcome; pos: [number, number]; t: number } {
  const pos: [number, number] = [from[0], from[1]];
  const exit = nearestExit(room, from[0], from[1]).exit!;
  // За порогом — ещё полтора метра в ту же сторону: наружу.
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  const ox = exit[0] + Math.sign(exit[0] - cx) * (Math.abs(exit[0] - cx) > Math.abs(exit[1] - cz) ? 1.5 : 0);
  const oz = exit[1] + Math.sign(exit[1] - cz) * (Math.abs(exit[0] - cx) > Math.abs(exit[1] - cz) ? 0 : 1.5);
  let leg = 0;
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    if (t > react) {
      const target = leg === 0 ? exit : ([ox, oz] as const);
      const dx = target[0] - pos[0];
      const dz = target[1] - pos[1];
      const d = Math.hypot(dx, dz);
      const step = speed * DT;
      if (d <= step) {
        pos[0] = target[0];
        pos[1] = target[1];
        if (leg === 0) leg = 1;
      } else {
        pos[0] += (dx / d) * step;
        pos[1] += (dz / d) * step;
      }
    }
    const out = p.update(DT, { time: 100 + t, pos, room, quiet: false, limit: 3, kinds: [] });
    if (out) return { out, pos, t };
  }
  return { out: null, pos, t };
}

const stand = (p: Pressure, pos: readonly [number, number], seconds: number, room: PressureRoom = ROOM): { out: PressureOutcome; t: number } => {
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    const out = p.update(DT, { time: 100 + t, pos, room, quiet: false, limit: 3, kinds: [] });
    if (out) return { out, t };
  }
  return { out: null, t };
};

describe('давление: провал пола', () => {
  it('сначала предупреждение — сетка, пол цел; потом фронт идёт от угла, дальнего от выхода', () => {
    const p = new Pressure(1);
    expect(p.start('collapse', ROOM, [1, 1])).toBe(true);
    const a = p.active!;
    // Дверь — посреди восточной стены: дальний угол — западный (любой из двух, оба равноудалены).
    expect(a.origin[0]).toBe(0);
    expect(a.phase).toBe('warn');
    stand(p, [5.5, 4.5], C.warn - 0.2);
    expect(p.view()!.radius).toBe(0);
    expect(p.view()!.grid).toBeGreaterThan(0);
    stand(p, [5.5, 4.5], 0.5);
    expect(p.active!.phase).toBe('run');
    expect(p.view()!.radius).toBeGreaterThan(0);
  });

  it('фронт идёт медленнее шага', () => {
    expect(C.front * C.walk).toBeLessThan(C.walk / C.margin);
  });

  it('кто остался стоять — падает и просыпается; чем дальше от угла, тем позже', () => {
    const near = new Pressure(1);
    near.start('collapse', ROOM, [1, 1]);
    const o = near.active!.origin;
    const a = stand(near, [o[0] + 1, o[1] === 0 ? 1 : 8], 30);
    expect(a.out).toBe('fell');
    const far = new Pressure(1);
    far.start('collapse', ROOM, [1, 1]);
    const b = stand(far, [5, 4.5], 30);
    expect(b.out).toBe('fell');
    expect(b.t).toBeGreaterThan(a.t + 1);
    // Падение длится полсекунды: проснулся не в тот же миг, как пол ушёл.
    expect(a.t).toBeGreaterThan(C.warn + C.fall);
    // После пробуждения события нет: пол вернулся.
    expect(near.active).toBeNull();
    expect(near.falling).toBeLessThan(0);
    expect(near.view()).toBeNull();
  });

  it('честность: кто пошёл к выходу шагом на четверть медленнее обычного, успевает из любой точки', () => {
    for (const room of [ROOM, ROOM2]) {
      for (let ix = 0; ix <= 6; ix++) {
        for (let iz = 0; iz <= 9; iz++) {
          const from: [number, number] = [0.3 + ix * 0.9, 0.3 + iz * 0.93];
          const p = new Pressure(7);
          expect(p.start('collapse', room, from)).toBe(true);
          const r = walkOut(p, room, from, C.walk / C.margin, 0.6, 20);
          expect(r.out, `из точки ${from.join(', ')}`).toBeNull();
        }
      }
    }
  });

  it('пол рассыпался весь, постоял пустым и собрался обратно; событие кончилось', () => {
    const p = new Pressure(1);
    p.start('collapse', ROOM, [1, 1]);
    // Игрок за порогом.
    const outside: [number, number] = [7.5, 4.5];
    stand(p, outside, C.warn + p.active!.reach / (C.front * C.walk) + 0.2);
    expect(p.active!.phase).toBe('hold');
    expect(p.view()!.radius).toBeGreaterThan(Math.hypot(6, 9));
    stand(p, outside, C.hold + C.back + 0.3);
    expect(p.active).toBeNull();
  });
});

describe('давление: потолок опускается', () => {
  it('опускается плавно, камера пригибается; до метра — проснулся', () => {
    const p = new Pressure(1);
    expect(p.start('squeeze', ROOM, [1, 1])).toBe(true);
    const span = p.active!.span;
    expect(span).toBeGreaterThanOrEqual(C.squeezeMin);
    stand(p, [1, 1], span * 0.25);
    const h1 = p.active!.ceil;
    expect(h1).toBeLessThan(ROOM.height);
    expect(h1).toBeGreaterThan(1.9);
    expect(p.camDrop([1, 1])).toBe(0);
    stand(p, [1, 1], span * 0.5);
    const h2 = p.active!.ceil;
    expect(h2).toBeLessThan(1.5);
    // Камера держится под потолком с зазором.
    expect(p.camDrop([1, 1])).toBeCloseTo(1.42 + C.duck - h2, 5);
    expect(p.view()!.drop).toBeCloseTo(ROOM.height - h2, 5);
    const r = stand(p, [1, 1], span);
    expect(r.out).toBe('crushed');
    expect(p.active).toBeNull();
  });

  it('вышел — потолок отпускает и поднимается быстрее, чем опускался', () => {
    const p = new Pressure(1);
    p.start('squeeze', ROOM, [1, 1]);
    const span = p.active!.span;
    stand(p, [1, 1], span * 0.6);
    const low = p.active!.ceil;
    const r = stand(p, [7.5, 4.5], 0.1);
    expect(r.out).toBeNull();
    expect(p.active!.phase).toBe('release');
    expect(p.camDrop([7.5, 4.5])).toBe(0);
    const up = stand(p, [7.5, 4.5], span);
    expect(up.out).toBeNull();
    expect(p.active).toBeNull();
    expect(low).toBeLessThan(ROOM.height - 0.5);
  });

  it('честность: времени хватает идущему с запасом в четверть, откуда бы он ни шёл', () => {
    for (const from of [[0.3, 0.3], [0.3, 8.7], [3, 4.5], [5.5, 8.7]] as const) {
      const p = new Pressure(3);
      p.start('squeeze', ROOM, from);
      const r = walkOut(p, ROOM, from, C.walk / C.margin, 0.6, 40);
      expect(r.out, `из точки ${from.join(', ')}`).toBeNull();
    }
  });
});

describe('давление: режиссёр', () => {
  const run = (p: Pressure, seconds: number, over: Partial<PressureInput>, t0 = 0, pos: readonly [number, number] = [1, 1]): number => {
    let t = t0;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      t += DT;
      p.update(DT, input(pos, t, over));
      if (p.active) return t;
    }
    return -1;
  };

  it('не в первую минуту; потом — как только игрок задержался в помещении вдали от выхода', () => {
    const p = new Pressure(5);
    expect(run(p, C.firstAfter - 1, {})).toBe(-1);
    const at = run(p, 10, {}, C.firstAfter - 1);
    expect(at).toBeGreaterThanOrEqual(C.firstAfter);
    expect(at).toBeLessThan(C.firstAfter + 0.5);
    expect(p.count).toBe(1);
  });

  it('не начинается у самого выхода, не в помещении, которое не годится, и пока нельзя', () => {
    const a = new Pressure(5);
    expect(run(a, 80, {}, 0, [5.2, 4.5])).toBe(-1);
    const b = new Pressure(5);
    expect(run(b, 80, { room: null })).toBe(-1);
    const c = new Pressure(5);
    expect(run(c, 80, { quiet: true })).toBe(-1);
    const d = new Pressure(5);
    expect(run(d, 80, { kinds: [] })).toBe(-1);
    const e = new Pressure(5);
    expect(run(e, 80, { limit: 0 })).toBe(-1);
  });

  it('вид события — только из разрешённых; после события пауза; за сессию не больше положенного', () => {
    for (const kind of ['collapse', 'squeeze'] as PressureKind[]) {
      const p = new Pressure(9);
      run(p, 80, { kinds: [kind] });
      expect(p.active!.kind).toBe(kind);
    }
    const p = new Pressure(9);
    let t = run(p, 80, { kinds: ['squeeze'], limit: 2 });
    // Игрок вышел: потолок отпустил, событие кончилось.
    for (let i = 0; i < 60 * 40 && p.active; i++) {
      t += DT;
      p.update(DT, input([7.5, 4.5], t, { room: null }));
    }
    expect(p.active).toBeNull();
    const ended = t;
    const again = run(p, 300, { kinds: ['squeeze'], limit: 2 }, t);
    expect(again - ended).toBeGreaterThanOrEqual(C.gap[0]);
    expect(p.count).toBe(2);
    for (let i = 0; i < 60 * 40 && p.active; i++) {
      t = again + i * DT;
      p.update(DT, input([7.5, 4.5], t, { room: null }));
    }
    expect(run(p, 400, { kinds: ['squeeze'], limit: 2 }, again + 60)).toBe(-1);
  });

  it('новая сессия — счёт с нуля', () => {
    const p = new Pressure(9);
    run(p, 80, {});
    expect(p.count).toBe(1);
    p.reset();
    expect(p.active).toBeNull();
    expect(p.count).toBe(0);
  });
});
