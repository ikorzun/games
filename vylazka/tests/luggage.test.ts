import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import type { PropSpec } from '../src/world/props_more';
import { LUGGAGE_PROPS, luggageLayout } from '../src/world/props_luggage';
import type { LuggageBox } from '../src/world/props_luggage';
import { coplanarOverlaps } from './coplanar';

/** Допуск по габариту, м: 2 см. */
const TOL = 0.02;
const SEEDS = [0, 1, 1000, 20041113];

/** Разрешённые материалы: кожа, холст, картон, дерево, сталь, латунь, чугун, резина. */
const ALLOWED = new Set<number>([MAT.leather, MAT.canvas, MAT.cardboard, MAT.wood, MAT.steel, MAT.brass, MAT.castIron, MAT.rubber]);

const wall = LUGGAGE_PROPS.st_luggage_wall!;
const stack = LUGGAGE_PROPS.st_luggage_stack!;

interface Built {
  mesh: MeshData;
  col: ColliderSet;
  tris: number;
}

function build(p: PropSpec, seed: number): Built {
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  p.build(new Xf(mb, col, 0, 0, 0, 0), seed);
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

const cases: [string, PropSpec, number][] = [
  ['st_luggage_wall', wall, 6000],
  ['st_luggage_stack', stack, 700],
];

describe('реестр багажа', () => {
  it('два предмета с заявленными монтажом и габаритами', () => {
    expect(Object.keys(LUGGAGE_PROPS).sort()).toEqual(['st_luggage_stack', 'st_luggage_wall']);
    expect([wall.mount, wall.w, wall.d, wall.h]).toEqual(['floor', 2.7, 0.8, 2.5]);
    expect([stack.mount, stack.w, stack.d, stack.h]).toEqual(['floor', 1.0, 0.6, 1.25]);
    for (const p of [wall, stack]) expect(p.ru.trim().length).toBeGreaterThan(2);
  });
});

describe.each(cases)('предмет %s', (name, p, budget) => {
  it('один сид — те же вершины, другой сид — другие', () => {
    const a = build(p, 1000).mesh.position;
    const b = build(p, 1000).mesh.position;
    expect(Array.from(b)).toEqual(Array.from(a));
    const c = build(p, 1001).mesh.position;
    const same = c.length === a.length && a.every((v, i) => v === c[i]);
    expect(same, `${name}: сид 1001 совпал с 1000`).toBe(false);
  });

  it('габариты в пределах заявленных (допуск 2 см), ничего ниже пола', () => {
    for (const seed of SEEDS) {
      const { min, max } = bounds(build(p, seed).mesh);
      expect(min[1], `сид ${seed}: низ`).toBeGreaterThanOrEqual(-1e-6);
      expect(min[0], `сид ${seed}: x min`).toBeGreaterThanOrEqual(-p.w / 2 - TOL);
      expect(max[0], `сид ${seed}: x max`).toBeLessThanOrEqual(p.w / 2 + TOL);
      expect(max[1], `сид ${seed}: верх`).toBeLessThanOrEqual(p.h + TOL);
      expect(min[2], `сид ${seed}: спина`).toBeGreaterThanOrEqual(-TOL);
      expect(max[2], `сид ${seed}: глубина`).toBeLessThanOrEqual(p.d + TOL);
    }
  });

  it('число треугольников в бюджете', () => {
    for (const seed of SEEDS) {
      const t = build(p, seed).tris;
      expect(t, `сид ${seed}`).toBeLessThanOrEqual(budget);
      if (name.startsWith('st_luggage_wall')) expect(t, `сид ${seed}: стена должна быть подробной`).toBeGreaterThanOrEqual(1100);
    }
  });

  it('нет NaN и вырожденных треугольников, индексы целы', () => {
    for (const seed of SEEDS) {
      const m = build(p, seed).mesh;
      expect(m.index.length % 3).toBe(0);
      expect(m.index.length).toBeGreaterThan(0);
      const verts = m.position.length / 3;
      expect(m.index.every((i) => i < verts)).toBe(true);
      for (const arr of [m.position, m.normal, m.color, m.uv]) expect(arr.every((v) => Number.isFinite(v)), `сид ${seed}`).toBe(true);
      let degenerate = 0;
      for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
        const e1: Vec3 = [m.position[b]! - m.position[a]!, m.position[b + 1]! - m.position[a + 1]!, m.position[b + 2]! - m.position[a + 2]!];
        const e2: Vec3 = [m.position[c]! - m.position[a]!, m.position[c + 1]! - m.position[a + 1]!, m.position[c + 2]! - m.position[a + 2]!];
        const cr = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        if (cr < 1e-9) degenerate++;
      }
      expect(degenerate, `сид ${seed}: вырожденных`).toBe(0);
    }
  });

  it('есть преграда: одна коробка от пола до половины высоты по всей ширине и глубине', () => {
    for (const seed of SEEDS) {
      const boxes = build(p, seed).col.boxes;
      expect(boxes.length, `сид ${seed}`).toBe(1);
      const b = boxes[0]!;
      expect(b.minY).toBeCloseTo(0, 6);
      expect(b.maxY).toBeCloseTo(p.h / 2, 6);
      expect(b.minX).toBeCloseTo(-p.w / 2, 6);
      expect(b.maxX).toBeCloseTo(p.w / 2, 6);
      expect(b.minZ).toBeGreaterThanOrEqual(-1e-6);
      expect(b.maxZ).toBeLessThanOrEqual(p.d + 1e-6);
    }
  });

  it('материалы — только из разрешённого списка', () => {
    for (const seed of SEEDS) {
      const m = build(p, seed).mesh;
      const used = new Set(Array.from(m.mat));
      for (const v of used) expect(ALLOWED.has(v), `сид ${seed}: материал ${v}`).toBe(true);
    }
  });

  it('нет двух граней в одной плоскости, смотрящих в одну сторону и накрывающих друг друга заметной площадью', () => {
    for (const seed of [1000, 20041113]) {
      const o = coplanarOverlaps([build(p, seed).mesh], { minArea: 2e-4 });
      expect(o.length, `сид ${seed}: ${JSON.stringify(o.slice(0, 2))}`).toBe(0);
    }
  });
});

describe.each([
  [2.7, 22, 12],
  [4.2, 30, 30],
] as const)('раскладка стены шириной %s м', (W, MIN, SEAMS) => {
  const H = W / 2;
  const sameRowSeams = (boxes: LuggageBox[]): Map<number, number[]> => {
    const rows = new Map<number, LuggageBox[]>();
    for (const b of boxes) rows.set(b.row, [...(rows.get(b.row) ?? []), b]);
    const seams = new Map<number, number[]>();
    for (const [row, list] of rows) {
      list.sort((a, b) => a.x0 - b.x0);
      const s: number[] = [];
      for (let i = 0; i + 1 < list.length; i++) {
        const gap = list[i + 1]!.x0 - list[i]!.x1;
        if (gap < 0.02) s.push(list[i]!.x1 + gap / 2);
      }
      seams.set(row, s);
    }
    return seams;
  };

  it('не меньше MIN чемоданов и сундуков на каждом сиде, внизу сундуки', () => {
    for (const seed of SEEDS) {
      const l = luggageLayout(seed, W);
      expect(l.length, `сид ${seed}`).toBeGreaterThanOrEqual(MIN);
      expect(l.filter((b) => b.trunk).length, `сид ${seed}: сундуков`).toBeGreaterThanOrEqual(5);
      expect(l.every((b) => (b.row < 2) === b.trunk)).toBe(true);
    }
  });

  it('раскладка повторяема и зависит от сида', () => {
    expect(luggageLayout(5)).toEqual(luggageLayout(5));
    expect(luggageLayout(5)).not.toEqual(luggageLayout(6));
  });

  it('корпуса соседей не пересекаются объёмами, щели между ними 3 мм и больше', () => {
    for (const seed of SEEDS) {
      const l = luggageLayout(seed, W);
      for (let i = 0; i < l.length; i++) {
        for (let j = i + 1; j < l.length; j++) {
          const a = l[i]!;
          const b = l[j]!;
          const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          const dz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
          if (dx > 0 && dy > 0 && dz > 0) throw new Error(`сид ${seed}: корпуса ${i} и ${j} пересекаются`);
        }
      }
    }
  });

  it('корпуса не заходят под пол и не вылезают за габариты; размеры слоёв в разумных пределах', () => {
    for (const seed of SEEDS) {
      for (const b of luggageLayout(seed, W)) {
        expect(b.y0).toBeGreaterThanOrEqual(0);
        expect(b.y1).toBeLessThanOrEqual(2.5);
        expect(b.x0).toBeGreaterThanOrEqual(-H);
        expect(b.x1).toBeLessThanOrEqual(H);
        expect(b.z1).toBeLessThanOrEqual(0.78);
        const w = b.x1 - b.x0;
        const h = b.y1 - b.y0;
        if (b.trunk) {
          expect(w).toBeGreaterThanOrEqual(0.75 - 1e-6);
          expect(w).toBeLessThanOrEqual(0.95 + 1e-6);
          expect(h).toBeGreaterThanOrEqual(0.45 - 1e-6);
          expect(h).toBeLessThanOrEqual(0.52 + 1e-6);
        } else {
          expect(w).toBeGreaterThanOrEqual(0.46 - 1e-6);
          expect(h).toBeGreaterThanOrEqual(0.15 - 1e-6);
          expect(h).toBeLessThanOrEqual(0.24 + 1e-6);
        }
      }
    }
  });

  it('швы соседних рядов совпадают не чаще чем в 10 % случаев', () => {
    for (const seed of SEEDS) {
      const seams = sameRowSeams(luggageLayout(seed, W));
      let total = 0;
      let same = 0;
      for (const [row, list] of seams) {
        const below = seams.get(row - 1);
        if (!below) continue;
        for (const s of list) {
          total++;
          if (below.some((p) => Math.abs(p - s) < 0.02)) same++;
        }
      }
      expect(total).toBeGreaterThan(SEAMS);
      expect(same / total, `сид ${seed}: ${same} из ${total}`).toBeLessThanOrEqual(0.1);
    }
  });

  it('верхний край неровный: высота столбцов различается', () => {
    for (const seed of SEEDS) {
      const l = luggageLayout(seed, W);
      const cols: number[] = [];
      for (let x = -H + 0.05; x <= H - 0.05; x += 0.1) {
        let top = 0;
        for (const b of l) if (x >= b.x0 && x <= b.x1 && b.y1 > top) top = b.y1;
        cols.push(top);
      }
      const hi = Math.max(...cols);
      const lo = Math.min(...cols);
      expect(hi, `сид ${seed}: верх`).toBeGreaterThanOrEqual(2.2);
      expect(hi - lo, `сид ${seed}: разброс столбцов`).toBeGreaterThanOrEqual(W > 3 ? 0.2 : 0.15);
      expect(new Set(cols.map((c) => Math.round(c * 100))).size).toBeGreaterThanOrEqual(W > 3 ? 6 : 4);
    }
  });
});
