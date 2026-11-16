import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { clonePose, handlePoint, HANDLES, solve } from '../src/world/figure_ik';
import { figureProblems, LIMITS, poseOk } from '../src/world/figures';
import type { FigureSpec } from '../src/world/figures';
import { POSES, skeleton } from '../src/world/props_people';
import type { Pose } from '../src/world/props_people';

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const stand = (): Pose => clonePose(POSES.stand as Pose);

/** Слова партнёра: «Да, инструмент ок, но я сам хочу руками трогать». Инструмент фигур гнёт манекен руками. */
describe('фигура гнётся руками', () => {
  it('все позы-заготовки — в пределах суставов', () => {
    for (const [name, p] of Object.entries(POSES)) expect(poseOk(p), name).toBe(true);
  });

  it('потянул кисть в достижимую точку — кисть там с точностью до сантиметра; плечо на месте', () => {
    const p = stand();
    const s0 = skeleton(p);
    // Поднять левую руку вперёд и вбок: точка в пределах длины руки от плеча.
    const sh = s0.shL;
    const target: Vec3 = [sh[0] + 0.25, sh[1] + 0.1, sh[2] + 0.35];
    const q = solve(p, 'wristL', target);
    const s1 = skeleton(q);
    expect(dist(s1.wrL, target)).toBeLessThan(0.01);
    expect(dist(s1.shL, sh)).toBeLessThan(1e-9);
    // Другая рука и ноги не тронуты.
    expect(q.armR).toEqual(p.armR);
    expect(q.legL).toEqual(p.legL);
  });

  it('щиколотку можно вывести вперёд и вверх — нога сгибается, другая нога и тело стоят', () => {
    const p = stand();
    const s0 = skeleton(p);
    const target: Vec3 = [s0.anR[0], s0.anR[1] + 0.35, s0.anR[2] + 0.3];
    const q = solve(p, 'ankleR', target);
    const s1 = skeleton(q);
    expect(dist(s1.anR, target)).toBeLessThan(0.02);
    // Стоящий опирается подошвами на пол: поднял одну ногу — тело оседает на другую на несколько миллиметров.
    expect(dist(s1.anL, s0.anL)).toBeLessThan(0.01);
    expect(q.legR.bend).toBeGreaterThan(5);
  });

  it('недостижимая цель: рука тянется к ней, но суставы не выходят за пределы', () => {
    const p = stand();
    const q = solve(p, 'wristR', [-3, 1.2, 2]);
    expect(poseOk(q)).toBe(true);
    expect(q.armR.bend).toBeGreaterThanOrEqual(LIMITS.armBend[0]);
    expect(q.armR.bend).toBeLessThanOrEqual(LIMITS.armBend[1]);
    // Рука выпрямлена в сторону цели: кисть дальше от тела, чем была.
    expect(skeleton(q).wrR[0]).toBeLessThan(skeleton(p).wrR[0] - 0.2);
  });

  it('голову и корпус тоже тянут: макушка и основание шеи идут к цели, поза в пределах; заготовку решатель не трогает', () => {
    const p = stand();
    const before = JSON.stringify(POSES.stand);
    const head0 = handlePoint(skeleton(p), 'head');
    const q = solve(p, 'head', [head0[0] + 0.08, head0[1] - 0.04, head0[2] + 0.06]);
    expect(dist(handlePoint(skeleton(q), 'head'), head0)).toBeGreaterThan(0.05);
    expect(poseOk(q)).toBe(true);
    const neck0 = handlePoint(skeleton(p), 'chest');
    const r = solve(p, 'chest', [neck0[0], neck0[1] - 0.1, neck0[2] + 0.25]);
    expect(r.spine).toBeGreaterThan(p.spine + 10);
    expect(poseOk(r)).toBe(true);
    expect(JSON.stringify(POSES.stand)).toBe(before);
    expect(HANDLES.length).toBe(6);
  });
});

describe('фигура для игры: данные и их проверка', () => {
  const good = (): FigureSpec => ({
    id: 'smoke_corner',
    name: 'Дымный у угла',
    pose: stand(),
    material: 'smoke',
    rule: { worlds: ['shelter'], rooms: ['dorm'], anchor: 'corner', facing: 'wall', lift: 0.6, count: 1 },
    yaw: 0,
    offset: [0, 0.2],
  });

  it('годная фигура проходит', () => {
    expect(figureProblems(good())).toEqual([]);
  });

  it('ловит плохой ключ, материал, правило и позу', () => {
    expect(figureProblems({ ...good(), id: 'Дым 1' })).toContain('ключ: только a–z, 0–9 и _');
    expect(figureProblems({ ...good(), material: 'glass' })).toContain('материал');
    expect(figureProblems({ ...good(), rule: { ...good().rule, worlds: [] } })).toContain('места');
    expect(figureProblems({ ...good(), rule: { ...good().rule, lift: 5 } })).toContain('высота: от 0 до 2,6 м');
    expect(figureProblems({ ...good(), rule: { ...good().rule, count: 4 } })).toContain('сколько: 1–3');
    const bent = stand();
    bent.armL.bend = 170;
    expect(figureProblems({ ...good(), pose: bent })).toContain('поза вне пределов суставов');
    expect(figureProblems(null)).toEqual(['не объект']);
  });
});
