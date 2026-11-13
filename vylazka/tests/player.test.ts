import { describe, expect, it } from 'vitest';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from '../src/player/controller';
import type { PlayerBody } from '../src/player/controller';
import { CameraRig, dirFromAngles } from '../src/player/rig';
import { MOUSE_SCALE, ShakeMeter, TOUCH_SCALE } from '../src/player/shake';
import { ColliderSet } from '../src/world/colliders';
import { buildTestLevel } from '../src/world/test_level';

const DT = 1 / 60;
const P = DEFAULT_CONTROLLER;

function floor(c: ColliderSet, size = 20): void {
  c.addBox(-size, -1, -size, size, 0, size);
}

/** Идти в сторону (wx, wz) заданное время. */
function walk(b: PlayerBody, c: ColliderSet, wx: number, wz: number, seconds: number, speed = 2.3): void {
  const len = Math.hypot(wx, wz) || 1;
  for (let i = 0; i < Math.round(seconds / DT); i++) stepPlayer(b, wx / len, wz / len, speed, DT, c, P);
}

/** Идти к точке, пока не дойдём (или не выйдет время). */
function walkTo(b: PlayerBody, c: ColliderSet, x: number, z: number, speed = 2.3, timeout = 30): boolean {
  for (let i = 0; i < Math.round(timeout / DT); i++) {
    const dx = x - b.x;
    const dz = z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    stepPlayer(b, dx / d, dz / d, speed, DT, c, P);
  }
  return false;
}

describe('контроллер', () => {
  it('разгоняется до заданной скорости и идёт по полу', () => {
    const c = new ColliderSet();
    floor(c);
    const b = createBody(0, 0, 0);
    walk(b, c, 1, 0, 2);
    expect(b.x).toBeGreaterThan(4.2);
    expect(b.x).toBeLessThan(4.6);
    expect(b.y).toBe(0);
    expect(b.onGround).toBe(true);
  });

  it('упирается в стену на расстоянии радиуса и скользит вдоль неё', () => {
    const c = new ColliderSet();
    floor(c);
    c.addBox(3, 0, -10, 3.3, 3, 10);
    const b = createBody(0, 0, 0);
    walk(b, c, 1, 0, 3);
    expect(b.x).toBeCloseTo(3 - P.radius, 3);
    const z0 = b.z;
    walk(b, c, 1, 1, 2);
    expect(b.x).toBeCloseTo(3 - P.radius, 3);
    expect(b.z - z0).toBeGreaterThan(1.5);
  });

  it('не проскакивает тонкую стену на бегу и при редких кадрах', () => {
    const c = new ColliderSet();
    floor(c);
    c.addBox(2, 0, -10, 2.05, 3, 10);
    const b = createBody(0, 0, 0);
    for (let i = 0; i < 40; i++) stepPlayer(b, 1, 0, 9, 0.1, c, P);
    expect(b.x).toBeLessThan(2);
  });

  it('обходит угол коробки, а не застревает', () => {
    const c = new ColliderSet();
    floor(c);
    c.addBox(2, 0, -0.2, 3, 2, 5);
    const b = createBody(0, 0, -0.35);
    walk(b, c, 1, 0, 3);
    expect(b.x).toBeGreaterThan(3.5);
  });

  it('поднимается по ступеням и не лезет на высокий ящик', () => {
    const c = new ColliderSet();
    floor(c);
    for (let i = 0; i < 6; i++) c.addBox(1 + i * 0.3, 0, -2, 1.3 + i * 0.3, 0.18 * (i + 1), 2);
    c.addBox(2.8, 0, -2, 8, 1.08, 2);
    const b = createBody(0, 0, 0);
    walk(b, c, 1, 0, 3);
    expect(b.y).toBeCloseTo(1.08, 3);
    expect(b.onGround).toBe(true);

    const c2 = new ColliderSet();
    floor(c2);
    c2.addBox(1, 0, -2, 2, 0.5, 2);
    const b2 = createBody(0, 0, 0);
    walk(b2, c2, 1, 0, 2);
    expect(b2.y).toBe(0);
    expect(b2.x).toBeCloseTo(1 - P.radius, 3);
  });

  it('спускается по ступеням без «полёта», с уступа падает и приземляется', () => {
    const c = new ColliderSet();
    c.addBox(-5, -1, -2, 0, 0, 2);
    for (let i = 0; i < 5; i++) c.addBox(i * 0.3, -3, -2, 0.3 + i * 0.3, -0.18 * (i + 1), 2);
    c.addBox(1.5, -3, -2, 4, -0.9, 2);
    c.addBox(4, -6, -2, 12, -4, 2);
    const b = createBody(-1, 0, 0);
    let airborne = 0;
    for (let i = 0; i < 100; i++) {
      stepPlayer(b, 1, 0, 2.3, DT, c, P);
      if (!b.onGround) airborne += 1;
    }
    expect(airborne).toBe(0);
    expect(b.y).toBeCloseTo(-0.9, 3);
    let landed = 0;
    for (let i = 0; i < 200; i++) {
      const r = stepPlayer(b, 1, 0, 2.3, DT, c, P);
      if (r.landed > 0) landed = r.landed;
    }
    expect(b.y).toBeCloseTo(-4, 3);
    expect(landed).toBeGreaterThan(6);
    expect(b.onGround).toBe(true);
  });

  it('при падении с большой высоты не пролетает сквозь пол; мимо пола — сообщает о падении в бездну', () => {
    const c = new ColliderSet();
    c.addBox(-2, -0.3, -2, 2, 0, 2);
    const b = createBody(0, 40, 0);
    b.onGround = false;
    for (let i = 0; i < 400; i++) stepPlayer(b, 0, 0, 0, DT, c, P);
    expect(b.y).toBe(0);
    const b2 = createBody(10, 0, 10);
    let fell = false;
    for (let i = 0; i < 400; i++) fell = stepPlayer(b2, 0, 0, 0, DT, c, P).fellOut || fell;
    expect(fell).toBe(true);
  });

  it('маршрут по тестовому уровню: коридор → отсек за дверью → лестница вниз и обратно', () => {
    const level = buildTestLevel();
    const c = level.colliders;
    const b = createBody(...level.spawn.pos);
    expect(walkTo(b, c, 0, -6)).toBe(true);
    // Сквозь стену рядом с дверью пройти нельзя…
    const probe = { ...b };
    walk(probe, c, 1, 0, 3);
    expect(probe.x).toBeGreaterThan(1.5);
    const wall = createBody(0, 0, -3);
    walk(wall, c, 1, 0, 3);
    expect(wall.x).toBeLessThan(1.5);
    // …а в дверь — можно (порог перешагивается).
    expect(walkTo(b, c, 4, -6)).toBe(true);
    expect(b.y).toBe(0);
    expect(walkTo(b, c, 0, -6)).toBe(true);
    expect(walkTo(b, c, 0, -15)).toBe(true);
    expect(walkTo(b, c, -7, -15)).toBe(true);
    expect(walkTo(b, c, -12, -15)).toBe(true);
    expect(b.y).toBeCloseTo(-1.44, 3);
    expect(walkTo(b, c, -5, -15)).toBe(true);
    expect(b.y).toBeCloseTo(0, 3);
  });
});

describe('детектор тряски', () => {
  const run = (m: ShakeMeter, seconds: number, fn: (i: number, t: number) => void): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      fn(i, i * DT);
      m.update(DT);
    }
  };

  it('медленный поворот камеры — не тряска', () => {
    const m = new ShakeMeter();
    run(m, 2, () => m.pushMotion(12, 1));
    expect(m.level).toBe(0);
    // Один взгляд влево-вправо тоже почти не считается.
    run(m, 0.3, () => m.pushMotion(20, 0));
    run(m, 0.3, () => m.pushMotion(-20, 0));
    expect(m.level).toBeLessThan(0.35);
  });

  it('энергичная тряска мышью набирает уровень меньше чем за секунду и затухает', () => {
    const m = new ShakeMeter();
    // 7 разворотов в секунду с размахом 100 px.
    run(m, 0.8, (i) => m.pushMotion((Math.floor(i / 4) % 2 === 0 ? 1 : -1) * 25, 0, MOUSE_SCALE));
    expect(m.level).toBeGreaterThan(0.8);
    expect(m.strokes).toBeGreaterThan(8);
    run(m, 1.5, () => undefined);
    expect(m.level).toBeLessThan(0.02);
  });

  it('мелкая дрожь ниже порога не считается', () => {
    const m = new ShakeMeter();
    run(m, 1, (i) => m.pushMotion(i % 2 === 0 ? 3 : -3, 0));
    expect(m.level).toBe(0);
  });

  it('палец по кнопке: порог ниже, чем у мыши', () => {
    const touch = new ShakeMeter();
    const mouse = new ShakeMeter();
    const f = (m: ShakeMeter, s: typeof MOUSE_SCALE): void => run(m, 0.8, (i) => m.pushMotion((Math.floor(i / 4) % 2 === 0 ? 1 : -1) * 3.5, 0, s));
    f(touch, TOUCH_SCALE);
    f(mouse, MOUSE_SCALE);
    expect(touch.level).toBeGreaterThan(0.5);
    expect(mouse.level).toBe(0);
  });

  it('акселерометр: ходьба не считается, тряска считается; гравитация вычитается', () => {
    const walkM = new ShakeMeter();
    run(walkM, 2, (_, t) => walkM.pushAccel(Math.sin(t * 12) * 3, 0, 0, DT));
    expect(walkM.level).toBe(0);
    const shakeM = new ShakeMeter();
    run(shakeM, 0.6, (_, t) => shakeM.pushAccel(Math.sin(t * 40) * 25, 0, 0, DT));
    expect(shakeM.level).toBeGreaterThan(0.7);
    const still = new ShakeMeter();
    run(still, 2, () => still.pushAccel(0, 9.81, 0, DT, true));
    expect(still.level).toBeLessThan(0.3);
    run(still, 1, () => undefined);
    run(still, 1, () => still.pushAccel(0, 9.81, 0, DT, true));
    expect(still.level).toBe(0);
  });

  it('импульс (клавиша, тап) и сброс', () => {
    const m = new ShakeMeter();
    m.pushImpulse(0.3);
    expect(m.level).toBeCloseTo(0.3);
    expect(m.strokes).toBe(1);
    m.reset();
    expect(m.level).toBe(0);
  });
});

describe('нагрудная камера', () => {
  const base = { x: 0, y: 0, z: 0, aimPitch: 0, speed: 0, onGround: true, panic: 0, shake: 0 };

  it('корпус отстаёт от луча и догоняет его', () => {
    const rig = new CameraRig();
    rig.snap({ ...base, aimYaw: 0 });
    const first = rig.update({ ...base, aimYaw: 0.3 }, DT);
    expect(Math.abs(first.camYaw)).toBeLessThan(0.08);
    let out = first;
    for (let i = 0; i < 120; i++) out = rig.update({ ...base, aimYaw: 0.3 }, DT);
    expect(rig.camYaw).toBeCloseTo(0.3, 2);
    expect(Math.hypot(...out.lightDir)).toBeCloseTo(1, 5);
  });

  it('луч не уходит из кадра дальше предела', () => {
    const rig = new CameraRig();
    rig.snap({ ...base, aimYaw: 0 });
    rig.update({ ...base, aimYaw: 2 }, DT);
    expect(2 - rig.camYaw).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it('камера на высоте груди, фонарь ниже и правее', () => {
    const rig = new CameraRig();
    const out = rig.update({ ...base, aimYaw: 0 }, DT);
    expect(out.camPos[1]).toBeGreaterThan(1.3);
    expect(out.camPos[1]).toBeLessThan(1.5);
    expect(out.lightPos[1]).toBeLessThan(out.camPos[1] - 0.3);
    expect(out.lightPos[0]).toBeGreaterThan(out.camPos[0] + 0.2);
  });

  it('направление по углам: yaw 0 — вдоль −z, положительный yaw — влево', () => {
    expect(dirFromAngles(0, 0)).toEqual([-0, 0, -1]);
    expect(dirFromAngles(Math.PI / 2, 0)[0]).toBeCloseTo(-1);
    expect(dirFromAngles(0, Math.PI / 2)[1]).toBeCloseTo(1);
  });

  it('шаги отмечаются при ходьбе и не отмечаются на месте', () => {
    const rig = new CameraRig();
    let steps = 0;
    for (let i = 0; i < 120; i++) if (rig.update({ ...base, aimYaw: 0, speed: 2.3 }, DT).footstep) steps += 1;
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(steps).toBeLessThanOrEqual(5);
    const idle = new CameraRig();
    let idleSteps = 0;
    for (let i = 0; i < 120; i++) if (idle.update({ ...base, aimYaw: 0 }, DT).footstep) idleSteps += 1;
    expect(idleSteps).toBe(0);
  });
});
