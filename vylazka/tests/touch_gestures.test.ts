import { describe, expect, it } from 'vitest';
import { HOLD_MS, LOOK_SENS, SLOP, STICK_R, TAP_MS, TAP_WALK_MS, TouchGestures } from '../src/player/touch_gestures';

describe('жесты на телефоне: тап — шаг, удержание — идти, ведение — луч или стик', () => {
  it('тап: коснулся и отпустил — идёт вперёд около секунды и останавливается', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 1000, false);
    g.up(1, 1080);
    let f = g.poll(1090);
    expect(f.moveZ).toBe(1);
    expect(f.moveX).toBe(0);
    expect(f.run).toBe(false);
    expect(f.walking).toBe(true);
    f = g.poll(1080 + TAP_WALK_MS - 10);
    expect(f.moveZ).toBe(1);
    f = g.poll(1080 + TAP_WALK_MS + 10);
    expect(f.moveZ).toBe(0);
    expect(f.walking).toBe(false);
  });

  it('тап в левой половине — тоже шаг вперёд', () => {
    const g = new TouchGestures();
    expect(g.down(1, 100, 300, 0, true)).toBe('stick');
    g.up(1, 90);
    expect(g.poll(100).moveZ).toBe(1);
  });

  it('удержание: палец на месте — идём, пока держим; отпустил — стоим, шага вдогонку нет', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 0, false);
    expect(g.poll(HOLD_MS - 20).moveZ).toBe(0);
    let f = g.poll(HOLD_MS + 5);
    expect(f.moveZ).toBe(1);
    expect(f.hold).toEqual({ x: 600, y: 300 });
    expect(g.poll(5000).moveZ).toBe(1);
    g.up(1, 5200);
    f = g.poll(5210);
    expect(f.moveZ).toBe(0);
    expect(f.hold).toBeNull();
  });

  it('палец чуть дрожит на месте — это всё ещё удержание', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 0, false);
    g.move(1, 600 + SLOP - 4, 302, 60);
    g.move(1, 598, 299, 120);
    expect(g.poll(HOLD_MS + 5).moveZ).toBe(1);
  });

  it('ведение в правой половине: сразу повёл — луч поворачивается, а игрок стоит', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 0, false);
    g.move(1, 640, 290, 40);
    g.move(1, 700, 280, 80);
    let f = g.poll(100);
    expect(f.moveZ).toBe(0);
    expect(f.lookYaw).toBeCloseTo(-100 * LOOK_SENS, 6);
    expect(f.lookPitch).toBeCloseTo(20 * LOOK_SENS, 6);
    // Поворот отдаётся один раз.
    f = g.poll(110);
    expect(f.lookYaw).toBe(0);
    // И сколько ни держи потом — это ведение, ходьбы нет; отпустил — шага тоже нет.
    expect(g.poll(3000).moveZ).toBe(0);
    g.up(1, 3050);
    expect(g.poll(3060).moveZ).toBe(0);
  });

  it('удержал и повёл: идём и поворачиваем одним пальцем', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 0, false);
    expect(g.poll(HOLD_MS + 10).moveZ).toBe(1);
    g.move(1, 700, 300, HOLD_MS + 60);
    g.move(1, 800, 310, HOLD_MS + 120);
    const f = g.poll(HOLD_MS + 130);
    expect(f.moveZ).toBe(1);
    expect(f.lookYaw).toBeCloseTo(-200 * LOOK_SENS, 6);
    g.up(1, 2000);
    expect(g.poll(2010).moveZ).toBe(0);
  });

  it('удержание распознаётся и без опросов: палец стоял дольше порога, потом повёл — идём', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 0, false);
    g.move(1, 680, 300, HOLD_MS + 30);
    expect(g.poll(HOLD_MS + 40).moveZ).toBe(1);
  });

  it('стик в левой половине: отвёл — идём куда отведён; до упора — бег; вперёд сам по себе не тянет', () => {
    const g = new TouchGestures();
    g.down(1, 100, 300, 0, true);
    g.move(1, 100 + STICK_R / 2, 300, 30);
    let f = g.poll(40);
    expect(f.moveX).toBeCloseTo(0.5, 5);
    expect(f.moveZ).toBeCloseTo(0, 5);
    expect(f.run).toBe(false);
    expect(f.walking).toBe(false);
    expect(f.stick).toEqual({ x: 100, y: 300, dx: STICK_R / 2, dy: 0 });
    // Назад и до упора: ручка дальше радиуса не идёт.
    g.move(1, 100, 300 + STICK_R * 3, 60);
    f = g.poll(1000);
    expect(f.moveX).toBeCloseTo(0, 5);
    expect(f.moveZ).toBeCloseTo(-1, 5);
    expect(f.run).toBe(true);
    expect(f.stick!.dy).toBeCloseTo(STICK_R, 5);
    g.up(1, 1100);
    f = g.poll(1110);
    expect(f.moveZ).toBe(0);
    expect(f.stick).toBeNull();
  });

  it('стик держат на месте — идём вперёд; отвели — он и ведёт', () => {
    const g = new TouchGestures();
    g.down(1, 100, 300, 0, true);
    let f = g.poll(HOLD_MS + 10);
    expect(f.moveZ).toBe(1);
    expect(f.walking).toBe(true);
    expect(f.hold).toBeNull();
    g.move(1, 100 - STICK_R, 300, HOLD_MS + 50);
    f = g.poll(HOLD_MS + 60);
    expect(f.moveX).toBeCloseTo(-1, 5);
    expect(f.moveZ).toBeCloseTo(0, 5);
    expect(f.walking).toBe(false);
    // Вернули ручку в середину — стоим: удержание кончилось, когда стик отвели.
    g.move(1, 101, 300, HOLD_MS + 90);
    f = g.poll(5000);
    expect(f.moveX).toBe(0);
    expect(f.moveZ).toBe(0);
  });

  it('два пальца: левый ведёт стик, правый — луч; второй палец слева тоже ведёт луч', () => {
    const g = new TouchGestures();
    expect(g.down(1, 100, 300, 0, true)).toBe('stick');
    expect(g.down(2, 150, 200, 10, true)).toBe('look');
    expect(g.down(3, 600, 300, 20, false)).toBe('look');
    g.move(1, 100, 300 - STICK_R, 40);
    g.move(3, 650, 300, 40);
    const f = g.poll(50);
    expect(f.moveZ).toBeCloseTo(1, 5);
    expect(f.run).toBe(true);
    expect(f.lookYaw).toBeCloseTo(-50 * LOOK_SENS, 6);
  });

  it('стик главнее шага по тапу: тапнули справа, пока стик ведёт назад, — идём назад', () => {
    const g = new TouchGestures();
    g.down(1, 100, 300, 0, true);
    g.move(1, 100, 300 + STICK_R, 30);
    g.down(2, 600, 300, 40, false);
    g.up(2, 100);
    const f = g.poll(120);
    expect(f.moveZ).toBeCloseTo(-1, 5);
    expect(f.walking).toBe(false);
  });

  it('пауза и потеря фокуса сбрасывают всё: ни шага, ни поворота не остаётся', () => {
    const g = new TouchGestures();
    g.down(1, 600, 300, 0, false);
    g.up(1, 50);
    g.down(2, 600, 300, 60, false);
    g.move(2, 700, 300, 80);
    g.release();
    const f = g.poll(100);
    expect(f).toEqual({ moveX: 0, moveZ: 0, run: false, lookYaw: 0, lookPitch: 0, walking: false, stick: null, hold: null });
    // Палец, отпущенный после сброса, ничего не делает.
    g.up(2, 120);
    expect(g.poll(130).moveZ).toBe(0);
  });

  it('пороги согласованы: удержание начинается раньше, чем касание перестаёт быть тапом', () => {
    expect(HOLD_MS).toBeLessThan(TAP_MS);
    expect(TAP_WALK_MS).toBeGreaterThan(500);
  });
});
