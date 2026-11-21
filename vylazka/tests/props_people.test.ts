import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import { Xf } from '../src/world/props';
import { PEOPLE_PROPS, POSES, skeleton, skeletonPoints } from '../src/world/props_people';
import type { Pose } from '../src/world/props_people';

const SEEDS = [1, 7, 1000, 20041113, 0xffffffff, 0, 123457];
/** Сиденье скамьи зала ожидания и гнутого стула (0,445–0,47 м) и дивана (0,52 м). */
const SEATS = [0.46, 0.52];

function bounds(pos: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

describe('манекены людей', () => {
  it('стоящие стоят подошвами на полу, сидящие — тазом на сиденье, стопами у пола', () => {
    for (const [name, pose] of Object.entries(POSES) as [string, Pose][]) {
      const s = skeleton(pose);
      const low = Math.min(...skeletonPoints(s).map((p) => p[1]));
      if (pose.pelvis.y === undefined) {
        expect(low, name).toBeCloseTo(0, 3);
      } else {
        expect(low, name).toBeGreaterThan(-0.03);
        // Низ таза — на сиденье (полуось таза по высоте 0,1 м).
        if (pose.pelvis.y > 0.3) expect(Math.min(...SEATS.map((h) => Math.abs(pose.pelvis.y! - 0.1 - h))), name).toBeLessThan(0.03);
        // Стопы достают до пола: сидящий не болтает ногами в воздухе.
        expect(low, name).toBeLessThan(0.05);
      }
      // Голова выше плеч, плечи выше таза; рост взрослого.
      expect(s.head[1] > s.shL[1] && s.shL[1] > s.pelvis[1], name).toBe(true);
      if (pose.pelvis.y === undefined) expect(s.head[1] + 0.12, name).toBeGreaterThan(1.6);
    }
  });

  it('прислонённый стоит спиной к стене, ступнями от неё', () => {
    const s = skeleton(POSES.lean);
    const back = Math.min(s.pelvis[2] - 0.108, s.chestC[2] - 0.112, s.head[2] - 0.108);
    expect(back).toBeCloseTo(0.03, 3);
    expect(Math.min(s.anL[2], s.anR[2])).toBeGreaterThan(0.15);
  });

  for (const [name, p] of Object.entries(PEOPLE_PROPS)) {
    it(`${name}: в заявленных габаритах, без лишних треугольников, без NaN`, () => {
      for (const seed of SEEDS) {
        const mb = new MeshBuilder();
        const col = new ColliderSet();
        p.build(new Xf(mb, col, 0, 0, 0), seed);
        const m = mb.build();
        for (let i = 0; i < m.position.length; i++) expect(Number.isFinite(m.position[i]!), name).toBe(true);
        expect(mb.triangleCount, name).toBeLessThan(2600);
        expect(mb.triangleCount, name).toBeGreaterThan(900);
        const b = bounds(m.position);
        const hw = p.w / 2;
        const zmin = p.mount === 'free' ? -p.d / 2 : 0;
        const zmax = p.mount === 'free' ? p.d / 2 : p.d;
        expect(b.min[0], `${name} x`).toBeGreaterThan(-hw - 0.02);
        expect(b.max[0], `${name} x`).toBeLessThan(hw + 0.02);
        expect(b.min[1], `${name} y`).toBeGreaterThan(-0.03);
        expect(b.max[1], `${name} y`).toBeLessThan(p.h + 0.04);
        expect(b.min[2], `${name} z`).toBeGreaterThan(zmin - 0.03);
        expect(b.max[2], `${name} z`).toBeLessThan(zmax + 0.03);
      }
    });
  }

  it('сид меняет оттенок и поворот головы, а та же пара (поза, сид) — та же фигура', () => {
    const run = (seed: number): Float32Array | number[] => {
      const mb = new MeshBuilder();
      PEOPLE_PROPS.mq_sit!.build(new Xf(mb, null, 0, 0, 0), seed);
      return mb.build().position;
    };
    expect(Array.from(run(5))).toEqual(Array.from(run(5)));
    expect(Array.from(run(5))).not.toEqual(Array.from(run(6)));
  });
});
