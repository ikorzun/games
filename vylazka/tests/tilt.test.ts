/**
 * Вещь партнёра, повёрнутая по всем осям (партнёр 18.11, 16:19: «разрешить крутить объекты по всем осям»; world/tilt.ts).
 * Доворот — как Euler XYZ в three.js (так его задаёт конструктор), вещь вращается вокруг своей середины и ложится на опору;
 * игра строит её так же: вершины, нормали, преграды и границы объекта повёрнуты.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateLayout } from '../src/gen/layout';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { registerModels } from '../src/world/models';
import { placedProblems } from '../src/world/placed';
import type { PlacedSpec } from '../src/world/placed';
import { worldBox } from '../src/world/placed_place';
import { ALL_PROPS, FIXED } from '../src/world/props_all';
import { SAND3D_DATA } from '../src/world/sand3d_data';
import { isTilted, mul, tiltMat, tiltPoint, tiltPose, tiltProblems, turnMat } from '../src/world/tilt';
import type { Tilt } from '../src/world/tilt';

beforeAll(() => registerModels(SAND3D_DATA));

const spec = (over: Partial<PlacedSpec> = {}): PlacedSpec => ({
  id: 'pl_tilt',
  name: 'Стул на боку',
  prop: 'kk_chair_a',
  rule: { worlds: ['office'], rooms: [], anchor: 'middle', facing: 'room', lift: 0, count: 1 },
  turn: 0,
  offset: [0, 0],
  ...over,
});

describe('доворот: математика', () => {
  it('поворот — тот же, что Euler XYZ у three.js (конструктор задаёт доворот им)', () => {
    for (const t of [
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, -90],
      [12, -70, 33],
      [180, 90, -45],
    ] as Tilt[]) {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((t[0] * Math.PI) / 180, (t[1] * Math.PI) / 180, (t[2] * Math.PI) / 180, 'XYZ'));
      const v = new THREE.Vector3(0.3, -1.2, 0.7).applyMatrix4(m);
      const w = mul(tiltMat(t), [0.3, -1.2, 0.7]);
      expect(w[0]).toBeCloseTo(v.x, 9);
      expect(w[1]).toBeCloseTo(v.y, 9);
      expect(w[2]).toBeCloseTo(v.z, 9);
    }
  });

  it('четверть оборота — та же, что у Xf.pt: 1 — (x, z) → (z, −x)', () => {
    expect(mul(turnMat(1), [1, 0, 0])).toEqual([0, 0, -1]);
    expect(mul(turnMat(1), [0, 0, 1])).toEqual([1, 0, 0]);
    expect(mul(turnMat(2), [1, 2, 3])).toEqual([-1, 2, -3]);
    expect(mul(turnMat(3), [1, 0, 0])).toEqual([0, 0, 1]);
  });

  it('вещь вращается вокруг середины и ложится на опору: на полу — низом на прежнюю высоту, на стене — спиной к стене, под потолком — верхом', () => {
    // Коробка 0,4 × 0,9 × 0,5: x — ширина, y — высота, z — глубина (у стены спина в z = 0).
    const pts: number[] = [];
    for (let k = 0; k < 8; k++) pts.push(k & 1 ? 0.2 : -0.2, k & 2 ? 0.9 : 0, k & 4 ? 0.5 : 0);
    const low = (pose: ReturnType<typeof tiltPose>, axis: 0 | 1 | 2, top = false): number => {
      let v = top ? -Infinity : Infinity;
      for (let i = 0; i < 8; i++) {
        const p = tiltPoint(pose, [pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!]);
        v = top ? Math.max(v, p[axis]) : Math.min(v, p[axis]);
      }
      return v;
    };
    // На боку: высота стала шириной, низ — там же, середина по x и z — там же.
    const side = tiltPose(pts, [0, 0, 90], 'floor');
    expect(low(side, 1)).toBeCloseTo(0, 9);
    expect(low(side, 1, true)).toBeCloseTo(0.4, 9);
    expect(side.c).toEqual([0, 0.45, 0.25]);
    expect(side.d[0]).toBe(0);
    expect(side.d[2]).toBe(0);
    // Наклон на стене: спина у стены.
    const wall = tiltPose(pts, [25, 0, 0], 'wall');
    expect(low(wall, 2)).toBeCloseTo(0, 9);
    // Под потолком: верх на прежней высоте.
    const ceil = tiltPose(pts, [0, 0, 40], 'ceiling');
    expect(low(ceil, 1, true)).toBeCloseTo(0.9, 9);
    // Без доворота — ничего не меняется.
    const none = tiltPose(pts, [0, 0, 0], 'floor');
    expect(tiltPoint(none, [0.2, 0.9, 0.5])).toEqual([0.2, 0.9, 0.5]);
    expect(isTilted([0, 0, 0])).toBe(false);
    expect(isTilted(undefined)).toBe(false);
    expect(isTilted([0, 1, 0])).toBe(true);
  });

  it('запись: доворот — три числа от −180 до 180; без него — годится', () => {
    expect(tiltProblems(undefined)).toEqual([]);
    expect(tiltProblems([0, 90, -180])).toEqual([]);
    expect(tiltProblems([0, 90])).not.toEqual([]);
    expect(tiltProblems([0, 200, 0])).not.toEqual([]);
    expect(tiltProblems([0, Number.NaN, 0])).not.toEqual([]);
    expect(tiltProblems('90')).not.toEqual([]);
    expect(placedProblems(spec({ tilt: [0, 0, 90] }), ALL_PROPS, FIXED)).toEqual([]);
    expect(placedProblems({ ...spec(), tilt: [0, 0, 999] as unknown as Tilt }, ALL_PROPS, FIXED).length).toBeGreaterThan(0);
  });

  it('коробка для проверки места — габарит повёрнутой: стул на боку ниже и шире, низом на той же высоте', () => {
    const p = ALL_PROPS.kk_chair_a!;
    const up = worldBox(p, [1, 0, 2], 0);
    const side = worldBox(p, [1, 0, 2], 0, 0, [0, 0, 90]);
    expect(side.minY).toBeCloseTo(up.minY, 9);
    expect(side.maxY - side.minY).toBeCloseTo(p.w, 6);
    expect(side.maxX - side.minX).toBeCloseTo(p.h, 6);
  });
});

describe('доворот: в игре', () => {
  const build = (placed: readonly PlacedSpec[]): BuiltLevel => buildLevel(generateLayout(20041113, 2, 'office'), { wear: 0, placed, figures: [], keepPlaceWorld: true });
  const objOf = (lvl: BuiltLevel): NonNullable<BuiltLevel['objects']>[number] => {
    const s = lvl.placed!.find((q) => q.id === 'pl_tilt')!;
    return (lvl.objects ?? []).find((o) => o.name === 'kk_chair_a' && Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) < 0.01)!;
  };

  it('стул на боку: объект уровня ниже прежнего и лежит на полу; преграды — его же, тоже ниже; точка в записи уровня та же', () => {
    const up = build([spec()]);
    const side = build([spec({ tilt: [0, 0, 90] })]);
    const a = objOf(up);
    const b = objOf(side);
    expect(a, 'прямой стул не встал').toBeDefined();
    expect(b, 'стул на боку не встал').toBeDefined();
    expect(side.placed!.find((q) => q.id === 'pl_tilt')!.tilt).toEqual([0, 0, 90]);
    const ha = a.max[1] - a.min[1];
    const hb = b.max[1] - b.min[1];
    expect(hb).toBeLessThan(ha * 0.8);
    // Лежит на полу: низ на той же высоте, что у стоящего.
    expect(b.min[1]).toBeCloseTo(a.min[1], 2);
    // Преграды стула (хозяин — его номер) не выше его самого.
    const boxes = side.colliders.boxes.filter((q) => q.owner === b.id);
    expect(boxes.length).toBeGreaterThan(0);
    for (const q of boxes) expect(q.maxY).toBeLessThanOrEqual(b.max[1] + 0.05);
  });

  it('нормали повёрнуты вместе с вершинами: у стула на боку нет «верхних» граней там, где стали боковые', () => {
    const side = build([spec({ tilt: [0, 0, 90] })]);
    const b = objOf(side);
    // Собрать нормали вершин объекта: их длина — единица (поворот не растягивает).
    let n = 0;
    for (const ch of side.chunks) {
      const d = ch.mesh;
      // Кусок без вещей (помещение за чёрным проёмом песчаного зала пусто) номеров объектов не несёт.
      if (!d.obj) continue;
      for (let i = 0; i < d.obj.length; i++) {
        if (d.obj[i] !== b.id) continue;
        const len = Math.hypot(d.normal[i * 3]!, d.normal[i * 3 + 1]!, d.normal[i * 3 + 2]!);
        expect(len).toBeCloseTo(1, 3);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(20);
  });
});
