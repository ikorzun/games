import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { ALL_PROPS, FIXED } from '../src/world/props_all';
import { Xf } from '../src/world/props';
import type { PropSpec } from '../src/world/props_more';
import { STATION_PROPS } from '../src/world/props_station';
import { coplanarOverlaps } from './coplanar';

/** Допуск по габариту, м: 3 см. */
const TOL = 0.03;

interface Want {
  mount: PropSpec['mount'];
  w: number;
  d: number;
  h: number;
  y?: number;
  solid: boolean;
  /** Потолок числа треугольников. */
  tris: number;
}

const WANT: Record<string, Want> = {
  // Скамьи — модели полки Sand3D (18.11): у стены одна из трёх (габарит — охват всех), в ряду две деревянные спинка к спинке.
  st_seats: { mount: 'floor', w: 1.8, d: 0.8, h: 1.05, solid: true, tris: 1500 },
  st_seats_double: { mount: 'free', w: 1.5, d: 1.6, h: 1.05, solid: true, tris: 2700 },
  st_lockers: { mount: 'floor', w: 1.35, d: 0.5, h: 1.9, solid: true, tris: 1300 },
  st_ticket_window: { mount: 'floor', w: 1.5, d: 0.5, h: 2.1, solid: true, tris: 750 },
  st_board: { mount: 'wall', w: 2.6, d: 0.12, h: 1.2, y: 2.3, solid: false, tris: 600 },
  st_clock: { mount: 'wall', w: 0.7, d: 0.25, h: 0.7, y: 2.6, solid: false, tris: 420 },
  st_column: { mount: 'free', w: 0.55, d: 0.55, h: 6.2, solid: true, tris: 400 },
  st_phone: { mount: 'wall', w: 0.5, d: 0.32, h: 0.75, y: 1.1, solid: false, tris: 950 },
  st_kiosk: { mount: 'floor', w: 2.0, d: 0.7, h: 1.35, solid: true, tris: 1450 },
  st_suitcase: { mount: 'free', w: 0.6, d: 0.24, h: 0.48, solid: false, tris: 300 },
  st_bin: { mount: 'free', w: 0.4, d: 0.4, h: 0.7, solid: true, tris: 210 },
  st_sign: { mount: 'ceiling', w: 1.2, d: 0.06, h: 0.4, solid: false, tris: 260 },
  st_barrier: { mount: 'free', w: 1.6, d: 0.3, h: 0.95, solid: false, tris: 450 },
  st_note: { mount: 'free', w: 0.16, d: 0.11, h: 0.03, solid: false, tris: 80 },
  st_key: { mount: 'free', w: 0.14, d: 0.06, h: 0.02, solid: false, tris: 300 },
  st_ticket: { mount: 'free', w: 0.12, d: 0.06, h: 0.01, solid: false, tris: 120 },
  st_cup: { mount: 'free', w: 0.09, d: 0.09, h: 0.2, solid: false, tris: 250 },
  st_coat: { mount: 'free', w: 0.55, d: 0.5, h: 0.5, solid: false, tris: 230 },
};

const SEEDS = [0, 1, 7, 1000, 20041113, 4294967295];
const allowedMat = (v: number): boolean => v <= MAT.castIron || v >= MAT.wallpaper;

interface Built {
  mesh: MeshData;
  col: ColliderSet;
  tris: number;
}

function build(p: PropSpec, seed: number, rot: 0 | 1 | 2 | 3 = 0): Built {
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  p.build(new Xf(mb, col, 0, 0, 0, rot), seed);
  return { mesh: mb.build(), col, tris: mb.triangleCount };
}

function bounds(m: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.position[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** Заявленный габарит в координатах предмета (низ настенного — в y = 0, его высота y лишь для размещения). */
function envelope(p: PropSpec): { min: Vec3; max: Vec3 } {
  const hw = p.w / 2;
  if (p.mount === 'free') return { min: [-hw, 0, -p.d / 2], max: [hw, p.h, p.d / 2] };
  if (p.mount === 'ceiling') return { min: [-hw, -p.h, 0], max: [hw, 0, p.d] };
  return { min: [-hw, 0, 0], max: [hw, p.h, p.d] };
}

const AXES = ['x', 'y', 'z'] as const;
const entries = Object.entries(STATION_PROPS);

describe('реестр вокзала', () => {
  it('восемнадцать предметов с заявленными монтажом и габаритами; все есть в ALL_PROPS', () => {
    expect(Object.keys(STATION_PROPS).sort()).toEqual(Object.keys(WANT).sort());
    expect(entries).toHaveLength(18);
    for (const [name, p] of entries) {
      expect(name).toMatch(/^st_[a-z0-9_]+$/);
      expect(p.ru.trim().length, name).toBeGreaterThan(2);
      const w = WANT[name]!;
      expect([p.mount, p.w, p.d, p.h, p.y], name).toEqual([w.mount, w.w, w.d, w.h, w.y]);
      expect(name in ALL_PROPS, `${name} в ALL_PROPS`).toBe(true);
      expect(ALL_PROPS[name]!.mount).toBe(w.mount);
    }
  });

  it('колонна — в FIXED: не растворяется; остальные — предметы уровня', () => {
    expect(FIXED.has('st_column')).toBe(true);
    for (const [name] of entries) if (name !== 'st_column') expect(FIXED.has(name), name).toBe(false);
  });
});

describe.each(entries)('предмет %s', (name, p) => {
  const want = WANT[name]!;
  const base = build(p, 1000);

  it('геометрия цела: индексы, конечные числа, единичные нормали, нет вырожденных треугольников', () => {
    for (const seed of SEEDS) {
      const m = build(p, seed).mesh;
      expect(m.index.length % 3).toBe(0);
      expect(m.index.length).toBeGreaterThan(0);
      const verts = m.position.length / 3;
      expect(m.index.every((i) => i < verts)).toBe(true);
      for (const arr of [m.position, m.normal, m.color, m.uv]) expect(arr.every((v) => Number.isFinite(v)), `сид ${seed}`).toBe(true);
      for (let i = 0; i < m.normal.length; i += 3) {
        const l = Math.hypot(m.normal[i]!, m.normal[i + 1]!, m.normal[i + 2]!);
        if (Math.abs(l - 1) > 1e-3) throw new Error(`${name}, сид ${seed}: нормаль длиной ${l}`);
      }
      let degenerate = 0;
      for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
        const e1: Vec3 = [m.position[b]! - m.position[a]!, m.position[b + 1]! - m.position[a + 1]!, m.position[b + 2]! - m.position[a + 2]!];
        const e2: Vec3 = [m.position[c]! - m.position[a]!, m.position[c + 1]! - m.position[a + 1]!, m.position[c + 2]! - m.position[a + 2]!];
        const cr = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        if (cr < 1e-9) degenerate++;
      }
      expect(degenerate, `${name}, сид ${seed}: вырожденных треугольников`).toBe(0);
    }
  });

  it('обход граней согласован с нормалью вершины (нет вывернутых граней)', () => {
    const m = base.mesh;
    let bad = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
      const e1: Vec3 = [m.position[b]! - m.position[a]!, m.position[b + 1]! - m.position[a + 1]!, m.position[b + 2]! - m.position[a + 2]!];
      const e2: Vec3 = [m.position[c]! - m.position[a]!, m.position[c + 1]! - m.position[a + 1]!, m.position[c + 2]! - m.position[a + 2]!];
      const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (n[0] * m.normal[a]! + n[1] * m.normal[a + 1]! + n[2] * m.normal[a + 2]! < 0) bad++;
    }
    expect(bad, `${name}: граней с обратным обходом`).toBe(0);
  });

  it('материалы разрешены (без печати и трафарета: надписей нет), оттенок в пределах', () => {
    for (const seed of SEEDS) {
      const m = build(p, seed).mesh;
      expect(m.mat.every((v) => Number.isInteger(v) && allowedMat(v)), `сид ${seed}`).toBe(true);
      for (let i = 0; i < m.color.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          expect(m.color[i + k]!, `${name}: тон`).toBeGreaterThanOrEqual(0.1);
          expect(m.color[i + k]!, `${name}: тон`).toBeLessThanOrEqual(1.5);
        }
        expect(m.color[i + 3]! >= 0 && m.color[i + 3]! <= 1, `${name}: AO`).toBe(true);
      }
    }
  });

  it(`не больше ${want.tris} треугольников`, () => {
    for (const seed of SEEDS) expect(build(p, seed).tris, `сид ${seed}`).toBeLessThanOrEqual(want.tris);
  });

  it('габариты сетки не выходят за заявленные больше чем на 3 см', () => {
    const env = envelope(p);
    for (const seed of SEEDS) {
      const bb = bounds(build(p, seed).mesh);
      for (let k = 0; k < 3; k++) {
        expect(bb.min[k]!, `${name}, сид ${seed}: min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
        expect(bb.max[k]!, `${name}, сид ${seed}: max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
      }
    }
  });

  it('предмет не пустой: занимает не меньше 70 % заявленного размера по каждой оси', () => {
    const bb = bounds(base.mesh);
    const dims = [p.w, p.h, p.d];
    const got = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
    // Плоские предметы (табличка толщиной в миллиметры, лист) не проверяем по тонкой оси.
    [0, 1, 2].forEach((k) => {
      if (dims[k]! >= 0.05) expect(got[k]!, `${name}: ${AXES[k]}`).toBeGreaterThanOrEqual(dims[k]! * 0.7);
    });
  });

  it('опора: на полу, на стене или под потолком', () => {
    for (const seed of SEEDS) {
      const bb = bounds(build(p, seed).mesh);
      if (p.mount === 'free' || p.mount === 'floor') expect(bb.min[1], `сид ${seed}: низ на полу`).toBeLessThanOrEqual(0.03);
      if (p.mount === 'floor' || p.mount === 'wall') expect(bb.min[2], `сид ${seed}: у стены`).toBeLessThanOrEqual(0.07);
      if (p.mount === 'wall') expect(bb.min[1], `сид ${seed}: низ настенного`).toBeLessThanOrEqual(0.03);
      if (p.mount === 'ceiling') expect(bb.max[1], `сид ${seed}: верх у потолка`).toBeGreaterThanOrEqual(-0.03);
    }
  });

  it(want.solid ? 'преграда есть, внутри габарита' : 'преград нет', () => {
    const env = envelope(p);
    for (const seed of SEEDS) {
      const boxes = build(p, seed).col.boxes;
      if (!want.solid) {
        expect(boxes.length, `${name}, сид ${seed}`).toBe(0);
        continue;
      }
      expect(boxes.length, `${name}, сид ${seed}`).toBeGreaterThanOrEqual(1);
      for (const b of boxes) {
        const lo: Vec3 = [b.minX, b.minY, b.minZ];
        const hi: Vec3 = [b.maxX, b.maxY, b.maxZ];
        for (let k = 0; k < 3; k++) {
          expect(hi[k]! - lo[k]!, `${name}: преграда вырождена по ${AXES[k]}`).toBeGreaterThan(0.005);
          expect(lo[k]!, `${name}: преграда, min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
          expect(hi[k]!, `${name}: преграда, max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
        }
      }
    }
  });

  it('рябь: одноимённые грани не лежат в одной плоскости внахлёст (кроме скрытых — у стены, на полу, под потолком)', () => {
    const hidden = (o: { at: number[]; n: number[] }): boolean => {
      if (p.mount !== 'free' && o.n[2]! < -0.9 && Math.abs(o.at[2]!) < 0.003) return true; // спина у стены
      if ((p.mount === 'free' || p.mount === 'floor') && o.n[1]! < -0.9 && Math.abs(o.at[1]!) < 0.003) return true; // днище на полу
      if (p.mount === 'ceiling' && o.n[1]! > 0.9 && Math.abs(o.at[1]!) < 0.003) return true; // верх у потолка
      return false;
    };
    for (const seed of [SEEDS[0]!, SEEDS[3]!]) {
      const bad = coplanarOverlaps([build(p, seed).mesh], { minArea: 1e-6 }).filter((o) => !hidden(o));
      const where = bad.slice(0, 3).map((o) => `${o.at.map((v) => v.toFixed(3)).join(',')} n=${o.n.map((v) => v.toFixed(1)).join(',')} ${o.area.toExponential(1)}`).join('; ');
      expect(bad, `${name}, сид ${seed}: ${where}`).toHaveLength(0);
    }
  });

  it('один сид — одна сетка', () => {
    const a = build(p, 7);
    const b = build(p, 7);
    expect(a.tris).toBe(b.tris);
    for (const key of ['position', 'normal', 'color', 'mat', 'uv', 'index'] as const) expect(Array.from(a.mesh[key]), key).toEqual(Array.from(b.mesh[key]));
  });

  it('поворот на четверти оборота не ломает сборку', () => {
    for (const rot of [1, 2, 3] as const) {
      const r = build(p, 1000, rot);
      expect(r.tris, `поворот ${rot}`).toBe(base.tris);
      expect(r.mesh.position.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

describe('особые случаи', () => {
  it('часы: две тёмные стрелки на 17:50 — часовая смотрит вниз чуть правее, минутная — влево-вверх', () => {
    // Стрелки — самые дальние от центра тёмные вершины в своих слоях: по z выше циферблата (z > 0,235).
    const m = build(STATION_PROPS.st_clock!, 1).mesh;
    const dark: Vec3[] = [];
    for (let i = 0; i < m.mat.length; i++) {
      const z = m.position[i * 3 + 2]!;
      if (m.mat[i] === MAT.rubber && z > 0.236 && z < 0.25) dark.push([m.position[i * 3]!, m.position[i * 3 + 1]! - 0.35, z]);
    }
    // Слой часовой стрелки (z 0,236–0,242) и минутной (z 0,244–0,25): по самой дальней вершине.
    const far = (lo: number, hi: number): Vec3 => dark.filter((v) => v[2] >= lo - 1e-6 && v[2] <= hi + 1e-6).sort((a, b) => Math.hypot(b[0], b[1]) - Math.hypot(a[0], a[1]))[0]!;
    const hour = far(0.236, 0.242);
    const minute = far(0.244, 0.25);
    const ang = (v: Vec3): number => ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(ang(hour) - 175), 'часовая ≈ 175° от 12').toBeLessThan(8);
    expect(Math.abs(ang(minute) - 300), 'минутная ≈ 300° от 12').toBeLessThan(8);
  });

  it('табло: 6–7 рядов планок, на каждой планке — только пустой светлый материал', () => {
    const m = build(STATION_PROPS.st_board!, 1000).mesh;
    const ys = new Set<number>();
    for (let i = 0; i < m.mat.length; i++) {
      if (m.mat[i] === MAT.paper && m.position[i * 3 + 2]! > 0.071 && m.position[i * 3 + 2]! < 0.073 && m.position[i * 3 + 1]! < 0.98) ys.add(Math.floor(m.position[i * 3 + 1]! / 0.12 - 0.8));
    }
    expect(ys.size).toBeGreaterThanOrEqual(6);
    expect(ys.size).toBeLessThanOrEqual(8);
  });

  it('камеры хранения: приоткрытая дверца выступает вперёд за линию остальных', () => {
    const m = build(STATION_PROPS.st_lockers!, 1000).mesh;
    let maxZ = 0;
    for (let i = 0; i < m.position.length; i += 3) maxZ = Math.max(maxZ, m.position[i + 2]!);
    expect(maxZ).toBeGreaterThan(0.45);
  });
});
