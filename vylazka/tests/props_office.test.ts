import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { OFFICE_PROPS } from '../src/world/props_office';
import type { PropSpec } from '../src/world/props_more';

/** Допуск по габариту, м: фаски, головки болтов, свес цепочки. */
const TOL = 0.06;
/** Потолок бюджета на предмет (обычный — до 300, сложный — до 700). */
const MAX_TRIS = 800;
/** Составные предметы (шесть-восемь кресел, терминалов, столов) не укладываются в обычный бюджет. */
const MAX_TRIS_COMPOSITE = 2400;
const COMPOSITE = new Set(['desk_island', 'meeting_table']);
const capOf = (name: string): number => (COMPOSITE.has(name) ? MAX_TRIS_COMPOSITE : MAX_TRIS);
/**
 * Витрина ставит предметы с сидами 1000 + 7·i, обстановка — со случайными до миллиона. К опорным сидам
 * добавлен ряд случайных; VZ_PROPS_SEEDS=500 прогоняет больше (долго, для разовой проверки).
 */
const EXTRA = Number(process.env.VZ_PROPS_SEEDS ?? 24);
const SEEDS = [1, 7, 1000, 1007, 1350, 20041113, 0xffffffff, 0, ...Array.from({ length: EXTRA }, (_, i) => (i * 7919 + 13) % 1000000)];
/** Материалы надписей (print, stencil) реквизиту не положены: их кладёт отдельный слой. Домашний набор (обои… обивка) идёт после них. */
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

/** Заявленный габарит в координатах предмета: спина — z = 0, отдельно стоящий — по центру, подвесной — вниз от потолка. */
function envelope(p: PropSpec): { min: Vec3; max: Vec3 } {
  const hw = p.w / 2;
  if (p.mount === 'free') return { min: [-hw, 0, -p.d / 2], max: [hw, p.h, p.d / 2] };
  if (p.mount === 'ceiling') return { min: [-hw, -p.h, 0], max: [hw, 0, p.d] };
  return { min: [-hw, 0, 0], max: [hw, p.h, p.d] };
}

const AXES = ['x', 'y', 'z'] as const;
const entries = Object.entries(OFFICE_PROPS);

describe('реестр реквизита', () => {
  it('предметов достаточно, ключи и описания в порядке', () => {
    expect(entries.length).toBeGreaterThanOrEqual(25);
    for (const [name, p] of entries) {
      expect(name, name).toMatch(/^[a-z0-9_]+$/);
      expect(p.ru.trim().length, name).toBeGreaterThan(2);
      expect(['floor', 'free', 'wall', 'ceiling'], name).toContain(p.mount);
      for (const v of [p.w, p.d, p.h]) expect(v > 0 && Number.isFinite(v), name).toBe(true);
      // Высота подвеса нужна настенным и только им; под потолком 2,7 м остаётся зазор.
      if (p.mount === 'wall') expect(p.y !== undefined && p.y > 0 && p.y + p.h <= 2.6, name).toBe(true);
      else expect(p.y, name).toBeUndefined();
    }
  });

  if (process.env.VZ_PROPS_STATS) {
    it('сводка: треугольники и габариты', () => {
      const rows = entries.map(([name, p]) => {
        const b = build(p, 1000);
        const bb = bounds(b.mesh);
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < b.mesh.color.length; i += 4) {
          for (let k = 0; k < 3; k++) {
            lo = Math.min(lo, b.mesh.color[i + k]!);
            hi = Math.max(hi, b.mesh.color[i + k]!);
          }
        }
        return { name, mount: p.mount, tris: b.tris, boxes: b.col.boxes.length, tint: `${lo.toFixed(2)}…${hi.toFixed(2)}`, x: `${bb.min[0].toFixed(2)}…${bb.max[0].toFixed(2)}`, y: `${bb.min[1].toFixed(2)}…${bb.max[1].toFixed(2)}`, z: `${bb.min[2].toFixed(2)}…${bb.max[2].toFixed(2)}` };
      });
      console.table(rows.sort((a, b) => b.tris - a.tris));
      console.log(`всего: ${rows.length} предметов, ${rows.reduce((n, r) => n + r.tris, 0)} треугольников`);
    });
  }
});

describe.each(entries)('предмет %s', (name, p) => {
  const base = build(p, SEEDS[2]!);

  it('геометрия не пуста и цела', () => {
    const m = base.mesh;
    expect(base.tris).toBeGreaterThan(0);
    expect(m.index.length % 3).toBe(0);
    const verts = m.position.length / 3;
    expect(m.index.every((i) => i < verts)).toBe(true);
    for (const arr of [m.position, m.normal, m.color, m.uv]) expect(arr.every((v) => Number.isFinite(v))).toBe(true);
    for (let i = 0; i < m.normal.length; i += 3) expect(Math.hypot(m.normal[i]!, m.normal[i + 1]!, m.normal[i + 2]!)).toBeCloseTo(1, 4);
  });

  it('материалы — целые номера без надписей, тон приглушён', () => {
    const m = base.mesh;
    expect(m.mat.every((v) => Number.isInteger(v) && v >= 0 && allowedMat(v))).toBe(true);
    // Тон: ничего кислотного и ничего «чернее чёрного»; AO — в пределах 0…1. У светящихся поверхностей
    // (MAT.glow) и у потолочной панели (MAT.lamp) оттенок — множитель яркости: до 14 и до 200.
    for (let i = 0; i < m.color.length; i += 4) {
      const mat = m.mat[i / 4];
      const hi = mat === MAT.glow ? 14 : mat === MAT.lamp ? 200 : 1.5;
      for (let k = 0; k < 3; k++) {
        expect(m.color[i + k]!, `${name}: тон`).toBeGreaterThanOrEqual(0.1);
        expect(m.color[i + k]!, `${name}: тон`).toBeLessThanOrEqual(hi);
      }
      expect(m.color[i + 3]! >= 0 && m.color[i + 3]! <= 1, `${name}: AO`).toBe(true);
    }
  });

  it(`не больше ${capOf(name)} треугольников`, () => {
    for (const seed of SEEDS) expect(build(p, seed).tris, `сид ${seed}`).toBeLessThanOrEqual(capOf(name));
  });

  it('укладывается в заявленный габарит при любом сиде', () => {
    const env = envelope(p);
    for (const seed of SEEDS) {
      const bb = bounds(build(p, seed).mesh);
      for (let k = 0; k < 3; k++) {
        expect(bb.min[k]!, `${name}, сид ${seed}: min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
        expect(bb.max[k]!, `${name}, сид ${seed}: max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
      }
    }
  });

  it('стоит на своей опоре: на полу, на стене или под потолком', () => {
    const bb = bounds(base.mesh);
    if (p.mount === 'floor' || p.mount === 'free') expect(bb.min[1], 'низ на полу').toBeLessThanOrEqual(0.03);
    if (p.mount === 'wall' || p.mount === 'floor') expect(bb.min[2], 'спина у стены').toBeLessThanOrEqual(0.12);
    if (p.mount === 'wall') expect(bb.min[2], 'настенное касается стены').toBeLessThanOrEqual(0.03);
    if (p.mount === 'ceiling') expect(bb.max[1], 'верх у потолка').toBeGreaterThanOrEqual(-0.03);
  });

  it('преграды лежат внутри габарита; у настенного и подвесного их нет', () => {
    const env = envelope(p);
    for (const seed of SEEDS) {
      const boxes = build(p, seed).col.boxes;
      if (p.mount === 'wall' || p.mount === 'ceiling') expect(boxes.length, name).toBe(0);
      for (const b of boxes) {
        const lo: Vec3 = [b.minX, b.minY, b.minZ];
        const hi: Vec3 = [b.maxX, b.maxY, b.maxZ];
        for (let k = 0; k < 3; k++) {
          expect(hi[k]! - lo[k]!, `${name}: преграда вырождена по ${AXES[k]}`).toBeGreaterThan(0.005);
          expect(lo[k]!, `${name}: преграда, min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
          expect(hi[k]!, `${name}: преграда, max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
        }
        // Преграда стоит на полу, а не висит.
        expect(b.minY, `${name}: преграда над полом`).toBeLessThanOrEqual(0.45);
      }
    }
  });

  it('один сид — один результат', () => {
    for (const seed of [SEEDS[0]!, SEEDS[2]!]) {
      const a = build(p, seed);
      const b = build(p, seed);
      expect(a.tris).toBe(b.tris);
      for (const key of ['position', 'normal', 'color', 'mat', 'uv', 'index'] as const) expect(Array.from(a.mesh[key]), key).toEqual(Array.from(b.mesh[key]));
      expect(a.col.boxes).toEqual(b.col.boxes);
    }
  });

  it('поворот на четверти оборота не ломает сборку', () => {
    const b0 = bounds(base.mesh);
    for (const rot of [1, 2, 3] as const) {
      const r = build(p, SEEDS[2]!, rot);
      expect(r.tris, `поворот ${rot}`).toBe(base.tris);
      expect(r.col.boxes.length, `поворот ${rot}`).toBe(base.col.boxes.length);
      expect(r.mesh.position.every((v) => Number.isFinite(v))).toBe(true);
      const bb = bounds(r.mesh);
      // Размеры в плане либо сохраняются, либо меняются местами. Допуск — на гранёные цилиндры:
      // у лежачего многогранника после поворота вершины встают иначе, и габарит гуляет на сантиметр-два.
      const plan = [bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]];
      const want = rot === 2 ? [b0.max[0] - b0.min[0], b0.max[2] - b0.min[2]] : [b0.max[2] - b0.min[2], b0.max[0] - b0.min[0]];
      expect(Math.abs(plan[0]! - want[0]!), `поворот ${rot}: размер по x`).toBeLessThan(0.03);
      expect(Math.abs(plan[1]! - want[1]!), `поворот ${rot}: размер по z`).toBeLessThan(0.03);
      expect(Math.abs(bb.min[1] - b0.min[1]), `поворот ${rot}: низ`).toBeLessThan(0.03);
      expect(Math.abs(bb.max[1] - b0.max[1]), `поворот ${rot}: верх`).toBeLessThan(0.03);
    }
  });
});
