import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { FOLLOW, Follower } from '../src/systems/follower';

/**
 * Шаги в такт (Z-19, приём 3; systems/follower.ts): на долгом пути за спиной — шаги, повторяющие твои с опозданием на полшага;
 * встал — ещё шаг и тишина; обернулся — никого. Раз-два за сон.
 */
const DT = 1 / 60;
/** Шаг игрока — раз в столько секунд; идёт по −z со скоростью 1,5 м/с, смотрит туда же (yaw 0). */
const STRIDE = 0.5;
const SPEED = 1.5;

interface Walk {
  f: Follower;
  t: number;
  z: number;
  phase: number;
  heard: { t: number; at: Vec3 }[];
}

function walk(w: Walk, seconds: number, opts: { moving?: boolean; yaw?: number; calm?: boolean } = {}): void {
  const moving = opts.moving ?? true;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    w.t += DT;
    let footstep = false;
    if (moving) {
      w.z -= SPEED * DT;
      w.phase += DT;
      if (w.phase >= STRIDE) {
        w.phase -= STRIDE;
        footstep = true;
      }
    }
    const feet: Vec3 = [0, 0, w.z];
    for (const at of w.f.update({ time: w.t, dt: DT, footstep, feet, ears: [0, 1.5, w.z], yaw: opts.yaw ?? 0, calm: opts.calm ?? true })) w.heard.push({ t: w.t, at });
  }
}

const start = (t = 30): Walk => ({ f: new Follower(7), t, z: 0, phase: 0, heard: [] });

describe('шаги в такт', () => {
  it('на долгом пути за спиной идут следом: позади на 4–6 м, с опозданием на полшага', () => {
    const w = start();
    walk(w, FOLLOW.walkFor + 4);
    expect(w.f.times).toBe(1);
    expect(w.heard.length).toBeGreaterThan(3);
    for (const h of w.heard) {
      // Позади игрока (он идёт по −z, значит шаги — с большим z), на его же пути.
      const zNow = -SPEED * (h.t - 30);
      const back = h.at[2] - zNow;
      expect(back).toBeGreaterThan(FOLLOW.dist[0] - 0.8);
      expect(back).toBeLessThan(FOLLOW.dist[1] + 1.2);
      expect(h.at[0]).toBe(0);
    }
    // Опоздание на полшага: шаг следом звучит между шагами игрока, а не вместе с ними.
    for (const h of w.heard.slice(0, 3)) {
      const since = (h.t - 30) % STRIDE;
      expect(Math.abs(since - FOLLOW.lag)).toBeLessThan(0.05);
    }
  });

  it('игрок встал — ещё один шаг и тишина', () => {
    const w = start();
    walk(w, FOLLOW.walkFor + 2.2);
    expect(w.f.following).toBe(true);
    const before = w.heard.length;
    const lastOwn = 30 + Math.floor((FOLLOW.walkFor + 2.2) / STRIDE) * STRIDE;
    walk(w, 3, { moving: false });
    // Отзвук последнего своего шага ещё в пути (опоздание на полшага), и потом — ещё один шаг сверх твоих.
    const after = w.heard.slice(before);
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after.length).toBeLessThanOrEqual(2);
    const extra = after.at(-1)!;
    expect(extra.t - lastOwn).toBeGreaterThan(FOLLOW.stopAfter);
    expect(extra.t - lastOwn).toBeLessThan(FOLLOW.stopAfter + FOLLOW.lastBeat + 0.1);
    expect(w.f.following).toBe(false);
    // И дальше — тишина.
    walk(w, 3, { moving: false });
    expect(w.heard.length).toBe(before + after.length);
  });

  it('обернулся к шагам — никого: тишина без последнего шага', () => {
    const w = start();
    walk(w, FOLLOW.walkFor + 2.2);
    expect(w.f.following).toBe(true);
    const before = w.heard.length;
    // Обернулся (взгляд на +z, туда, откуда шёл) и встал.
    walk(w, 0.05, { moving: false, yaw: Math.PI });
    walk(w, 3, { moving: false, yaw: Math.PI });
    expect(w.f.following).toBe(false);
    expect(w.heard.length - before).toBeLessThanOrEqual(1);
  });

  it('не чаще двух раз за сон и не раньше 25-й секунды; без покоя — никого', () => {
    const early = { ...start(0) };
    walk(early, FOLLOW.from - 1);
    expect(early.f.times).toBe(0);
    const w = start();
    for (let i = 0; i < 6; i++) {
      walk(w, FOLLOW.gap + 5);
      walk(w, 2, { moving: false });
    }
    expect(w.f.times).toBe(FOLLOW.perDream);
    const busy = start();
    walk(busy, 30, { calm: false });
    expect(busy.f.times).toBe(0);
    expect(busy.heard).toEqual([]);
  });
});
