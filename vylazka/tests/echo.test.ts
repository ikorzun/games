import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { behindness, DEFAULT_ECHO, Echo, ECHO_DRIFT, ECHO_MAX, ECHO_STEP, ECHO_STRIDE, ECHO_THING } from '../src/systems/echo';

const AT: Vec3 = [1, 0, -2];

describe('эхо: волны', () => {
  it('волна рождается в точке источника с нулевым радиусом и растёт со скоростью фронта', () => {
    const e = new Echo();
    e.emit(AT, ECHO_STEP, 1);
    e.update(0);
    expect(e.count).toBe(1);
    expect([...e.data.slice(0, 4)]).toEqual([1, 0, -2, 0]);
    e.update(0.5);
    expect(e.data[3]).toBeCloseTo(0.5 * DEFAULT_ECHO.speed, 5);
    expect(e.data[6]).toBe(ECHO_STEP);
    expect(e.data[5]).toBeCloseTo(DEFAULT_ECHO.tail, 5);
  });

  it('тихий источник слышен ближе громкого; дойдя до своего предела, волна исчезает', () => {
    const e = new Echo();
    expect(e.reach(ECHO_STEP, 0.4)).toBeLessThan(e.reach(ECHO_STEP, 1));
    expect(e.reach(ECHO_STEP, 1)).toBe(DEFAULT_ECHO.range[ECHO_STEP]);
    expect(e.reach(ECHO_DRIFT, 1)).toBeGreaterThan(e.reach(ECHO_STEP, 1));
    e.emit(AT, ECHO_STEP, 1);
    const life = e.reach(ECHO_STEP, 1) / DEFAULT_ECHO.speed;
    e.update(life - 0.05);
    expect(e.count).toBe(1);
    e.update(0.1);
    expect(e.count).toBe(0);
    expect(e.data.every((v) => v === 0)).toBe(true);
  });

  it('к концу пути волна гаснет плавно, а не обрывается', () => {
    const e = new Echo();
    e.emit(AT, ECHO_STEP, 1);
    const life = e.reach(ECHO_STEP, 1) / DEFAULT_ECHO.speed;
    const amps: number[] = [];
    for (let t = 0; t < life; t += life / 12) {
      e.update(life / 12);
      if (e.count > 0) amps.push(e.data[4]!);
    }
    // Первые две трети пути сила полная, потом убывает до нуля без скачков.
    expect(amps[0]).toBeCloseTo(1, 5);
    expect(amps[5]).toBeCloseTo(1, 5);
    for (let i = 1; i < amps.length; i++) expect(amps[i]!).toBeLessThanOrEqual(amps[i - 1]! + 1e-6);
    expect(amps[amps.length - 1]!).toBeLessThan(0.3);
  });

  it('сила эха умножается на общий множитель: при свете оно слабее', () => {
    const e = new Echo();
    e.emit(AT, ECHO_STEP, 1);
    e.update(0.1, 0.35);
    expect(e.data[4]).toBeCloseTo(0.35, 5);
  });

  it('пустой источник волны не даёт', () => {
    const e = new Echo();
    e.emit(AT, ECHO_STEP, 0);
    expect(e.count).toBe(0);
  });

  it('шаги не занимают все места: частая ходьба вытесняет свои же старые волны, а волна Осыпи остаётся', () => {
    const e = new Echo();
    e.emit([9, 0, 9], ECHO_DRIFT, 1);
    for (let i = 0; i < 10; i++) {
      e.emit([i, 0, 0], ECHO_STEP, 0.5);
      e.update(0.05);
    }
    const snap = e.snapshot();
    expect(snap.filter((p) => p.kind === ECHO_STEP)).toHaveLength(DEFAULT_ECHO.steps);
    expect(snap.filter((p) => p.kind === ECHO_DRIFT)).toHaveLength(1);
    // Остались самые свежие шаги.
    expect(snap.filter((p) => p.kind === ECHO_STEP).map((p) => p.pos[0]).sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('волн не больше, чем ждёт шейдер, как бы часто они ни рождались', () => {
    const e = new Echo();
    for (let i = 0; i < 20; i++) e.emit([i, 0, 0], i % 3 === 0 ? ECHO_STEP : i % 3 === 1 ? ECHO_DRIFT : ECHO_THING, 1);
    e.update(0.01);
    expect(e.count).toBeLessThanOrEqual(ECHO_MAX);
    expect(e.data.length).toBe(ECHO_MAX * ECHO_STRIDE);
    expect(e.snapshot().some((p) => p.kind === ECHO_STEP)).toBe(true);
  });

  it('clear забывает всё: другое место — другое эхо', () => {
    const e = new Echo();
    e.emit(AT, ECHO_STEP, 1);
    e.update(0.1);
    e.clear();
    expect(e.count).toBe(0);
    expect(e.data.every((v) => v === 0)).toBe(true);
  });
});

describe('эхо: что считается «за спиной»', () => {
  const cam: Vec3 = [0, 1.4, 0];
  // yaw 0 — взгляд в −z.
  it('впереди и в поле зрения — ноль; сбоку у края — понемногу; позади — единица', () => {
    expect(behindness(cam, 0, [0, 0, -5], 0.9)).toBe(0);
    expect(behindness(cam, 0, [3, 0, -5], 0.9)).toBe(0);
    const side = behindness(cam, 0, [5, 0, -1], 0.9);
    expect(side).toBeGreaterThan(0);
    expect(side).toBeLessThan(1);
    expect(behindness(cam, 0, [0, 0, 5], 0.9)).toBe(1);
    expect(behindness(cam, 0, [2, 0, 4], 0.9)).toBe(1);
  });

  it('мера поворачивается вместе со взглядом', () => {
    // Повернулись на пол-оборота: то, что было позади, теперь впереди.
    expect(behindness(cam, Math.PI, [0, 0, 5], 0.9)).toBe(0);
    expect(behindness(cam, Math.PI, [0, 0, -5], 0.9)).toBe(1);
  });

  it('точка в самой камере «за спиной» не считается', () => {
    expect(behindness(cam, 0, [0, 0, 0], 0.9)).toBe(0);
  });
});
