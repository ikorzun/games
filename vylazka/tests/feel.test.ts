import { describe, expect, it } from 'vitest';
import { DEFAULT_FEEL, FEEL_NEUTRAL, SessionFeel } from '../src/systems/feel';
import type { FeelInput } from '../src/systems/feel';

/** Прогнать кривую seconds секунд шагом 1/60 с при заданном ходе сессии. */
function run(f: SessionFeel, seconds: number, inp: (t: number) => FeelInput, t0 = 0): number {
  const dt = 1 / 60;
  let t = t0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    f.update(dt, inp(t));
  }
  return t;
}

const going = (done: number, count = 5) => (t: number): FeelInput => ({ time: t, done, count, active: true });

describe('кривая ощущений за сессию (K-11; партнёр: «главная плоскость — ощущения… сжатие, расширение, свет, тень, дребезжание»)', () => {
  it('в начале сессии мир почти не дышит: кадр нейтральный', () => {
    const f = new SessionFeel();
    expect(f.view()).toEqual(FEEL_NEUTRAL);
    run(f, 30, going(0));
    const v = f.view();
    expect(v.beam).toBeGreaterThan(0.995);
    expect(v.gaze).toBeGreaterThan(0.99);
    expect(v.tunnel).toBeLessThan(0.005);
    expect(v.drift).toBe(0);
  });

  it('одно время сжимает мир только наполовину — дожимают воспоминания', () => {
    const f = new SessionFeel();
    run(f, DEFAULT_FEEL.span + 30, going(0));
    const byTime = f.level;
    expect(byTime).toBeGreaterThan(0.15);
    expect(byTime).toBeLessThan(0.45);
    run(f, 40, going(5), DEFAULT_FEEL.span + 30);
    expect(f.level).toBeGreaterThan(0.95);
    // Остаток выдоха после последнего воспоминания здесь не задан: выдоха не было, кадр сжат до конца.
    const v = f.view();
    expect(v.beam).toBeCloseTo(DEFAULT_FEEL.beamTo, 1);
    expect(v.gaze).toBeCloseTo(DEFAULT_FEEL.gazeTo, 1);
    expect(v.tunnel).toBeGreaterThan(0.2);
    expect(v.drift).toBeGreaterThan(0.9);
  });

  it('вспомнил — выдох: луч и взгляд шире обычного, края светлые; через несколько секунд кривая возвращается', () => {
    const f = new SessionFeel();
    run(f, 400, going(4));
    const tight = f.view();
    expect(tight.gaze).toBeLessThan(0.85);
    f.exhale();
    const open = f.view();
    expect(open.gaze).toBeGreaterThan(1.2);
    expect(open.beam).toBeGreaterThan(1.2);
    expect(open.tunnel).toBe(0);
    expect(open.drift).toBe(0);
    run(f, DEFAULT_FEEL.exhaleTime + 0.5, going(4), 400);
    const back = f.view();
    expect(back.gaze).toBeCloseTo(tight.gaze, 2);
  });

  it('в кармане и в лимбо кривая отпускает, по возвращении снова набирается', () => {
    const f = new SessionFeel();
    run(f, 420, going(4));
    const before = f.level;
    expect(before).toBeGreaterThan(0.5);
    run(f, 30, (t) => ({ time: t, done: 4, count: 5, active: false }), 420);
    expect(f.level).toBeLessThan(before * 0.01);
    run(f, 25, going(4), 450);
    expect(f.level).toBeGreaterThan(before * 0.95);
  });

  it('две кривые не складываются: на поздних кругах петли сжатие сессии вдвое слабее', () => {
    const f = new SessionFeel();
    run(f, 500, going(5));
    const fresh = f.view(0);
    const worn = f.view(1);
    expect(1 - worn.gaze).toBeCloseTo((1 - fresh.gaze) / 2, 2);
    expect(worn.tunnel).toBeCloseTo(fresh.tunnel / 2, 3);
  });

  it('новая сессия — с чистого листа', () => {
    const f = new SessionFeel();
    run(f, 500, going(5));
    f.exhale();
    f.reset();
    expect(f.view()).toEqual(FEEL_NEUTRAL);
  });
});
