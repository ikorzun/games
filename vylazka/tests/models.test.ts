import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT, MAT_COUNT } from '../src/world/materials';
import { decodeModel, modelBounds } from '../src/world/models';
import { MODEL_DATA } from '../src/world/models_data';
import { Xf } from '../src/world/props';
import { MODEL_PROPS } from '../src/world/props_models';
import type { PropSpec } from '../src/world/props_more';

/** Допуск по габариту, м. */
const TOL = 0.02;
/** Бюджет сгенерированного файла, байт. */
const BUDGET = 350 * 1024;
const AXES = ['x', 'y', 'z'] as const;
const names = Object.keys(MODEL_DATA);
const props = Object.entries(MODEL_PROPS);

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

function envelope(p: PropSpec): { min: Vec3; max: Vec3 } {
  const hw = p.w / 2;
  if (p.mount === 'free') return { min: [-hw, 0, -p.d / 2], max: [hw, p.h, p.d / 2] };
  if (p.mount === 'ceiling') return { min: [-hw, -p.h, 0], max: [hw, 0, p.d] };
  return { min: [-hw, 0, 0], max: [hw, p.h, p.d] };
}

/** Коробка после поворота на rot четвертей оборота: (x, z) → (z, −x), (−x, −z), (−z, x), как у Xf.pt. */
function rotEnv(e: { min: Vec3; max: Vec3 }, rot: 0 | 1 | 2 | 3): { min: Vec3; max: Vec3 } {
  const [a, c, b, d] = [e.min[0], e.min[2], e.max[0], e.max[2]];
  if (rot === 1) return { min: [c, e.min[1], -b], max: [d, e.max[1], -a] };
  if (rot === 2) return { min: [-b, e.min[1], -d], max: [-a, e.max[1], -c] };
  if (rot === 3) return { min: [-d, e.min[1], a], max: [-c, e.max[1], b] };
  return e;
}

function build(p: PropSpec, rot: 0 | 1 | 2 | 3 = 0): { mesh: MeshData; col: ColliderSet } {
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  p.build(new Xf(mb, col, 0, 0, 0, rot), 1000);
  return { mesh: mb.build(), col };
}

/** Замкнута ли сетка: каждое ребро (по склеенным позициям) встречается ровно дважды. Нужна для проверки обхода граней. */
function isClosed(pos: Float32Array, index: Uint16Array): boolean {
  const key = (i: number): string => `${Math.round(pos[i * 3]! * 1e4)},${Math.round(pos[i * 3 + 1]! * 1e4)},${Math.round(pos[i * 3 + 2]! * 1e4)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(index[t + e]!);
      const b = key(index[t + ((e + 1) % 3)]!);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const n of edges.values()) if (n % 2 !== 0) return false;
  return edges.size > 0;
}

/** Знаковый объём по треугольникам: положительный, если грани смотрят наружу (обход против часовой). */
function signedVolume(pos: Float32Array, index: Uint16Array): number {
  let v = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3;
    const b = index[t + 1]! * 3;
    const c = index[t + 2]! * 3;
    const [ax, ay, az] = [pos[a]!, pos[a + 1]!, pos[a + 2]!];
    const [bx, by, bz] = [pos[b]!, pos[b + 1]!, pos[b + 2]!];
    const [cx, cy, cz] = [pos[c]!, pos[c + 1]!, pos[c + 2]!];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe('данные моделей', () => {
  it('файл данных укладывается в бюджет', () => {
    const size = readFileSync(new URL('../src/world/models_data.ts', import.meta.url)).length;
    expect(size).toBeLessThan(BUDGET);
  });

  it('моделей достаточно, имена в порядке, у каждой есть реквизит', () => {
    expect(names.length).toBeGreaterThanOrEqual(24);
    for (const n of names) expect(n, n).toMatch(/^[a-z0-9_]+$/);
    expect(Object.keys(MODEL_PROPS).length).toBe(names.length);
    for (const k of Object.keys(MODEL_PROPS)) expect(k, k).toMatch(/^kk_[a-z0-9_]+$/);
  });

  it('модели без замкнутой сетки (в проверке объёма пропущены)', () => {
    const open = names.filter((n) => !isClosed(decodeModel(n).position, decodeModel(n).index));
    console.log(`не замкнуты (${open.length}): ${open.join(', ') || '—'}`);
    expect(open.length).toBeLessThan(names.length);
  });
});

describe.each(names)('модель %s', (name) => {
  const r = MODEL_DATA[name]!;
  const m = decodeModel(name);

  it('разбирается: размеры массивов и счётчики сходятся', () => {
    expect(m.position.length).toBe(r.v * 3);
    expect(m.normal.length).toBe(r.v * 3);
    expect(m.color.length).toBe(r.v * 3);
    expect(m.index.length).toBe(r.t * 3);
    expect(decodeModel(name)).toBe(m);
    for (const arr of [m.position, m.normal, m.color]) expect(arr.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('не вырождена', () => {
    expect(r.t).toBeGreaterThan(20);
  });

  it('индексы в пределах, треугольники не вырождены', () => {
    for (let t = 0; t < m.index.length; t += 3) {
      const a = m.index[t]!;
      const b = m.index[t + 1]!;
      const c = m.index[t + 2]!;
      expect(a < r.v && b < r.v && c < r.v).toBe(true);
      expect(new Set([a, b, c]).size).toBe(3);
    }
  });

  it('габарит по квантованным позициям совпадает с min/max', () => {
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.position.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, m.position[i + k]!);
        hi[k] = Math.max(hi[k]!, m.position[i + k]!);
      }
    }
    for (let k = 0; k < 3; k++) {
      expect(lo[k]!, `min ${AXES[k]}`).toBeCloseTo(r.min[k]!, 3);
      expect(hi[k]!, `max ${AXES[k]}`).toBeCloseTo(r.max[k]!, 3);
    }
    expect(modelBounds(name)).toEqual({ min: r.min, max: r.max });
  });

  it('нормали единичные', () => {
    for (let i = 0; i < m.normal.length; i += 3) expect(Math.hypot(m.normal[i]!, m.normal[i + 1]!, m.normal[i + 2]!)).toBeCloseTo(1, 3);
  });

  it('цвета в пределах 0…1', () => {
    expect(m.color.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('обход граней наружу: у замкнутой модели объём положителен', () => {
    if (!isClosed(m.position, m.index)) return; // незамкнутую сетку объёмом не проверить
    expect(signedVolume(m.position, m.index), `${name}: грани вывернуты`).toBeGreaterThan(0);
  });

  it('нормали согласованы с обходом граней', () => {
    // Нормаль треугольника по обходу должна смотреть в ту же сторону, что и нормали его вершин, у большинства граней.
    let ok = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
      const u = [m.position[b]! - m.position[a]!, m.position[b + 1]! - m.position[a + 1]!, m.position[b + 2]! - m.position[a + 2]!];
      const v = [m.position[c]! - m.position[a]!, m.position[c + 1]! - m.position[a + 1]!, m.position[c + 2]! - m.position[a + 2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const dot = n[0]! * (m.normal[a]! + m.normal[b]! + m.normal[c]!) + n[1]! * (m.normal[a + 1]! + m.normal[b + 1]! + m.normal[c + 1]!) + n[2]! * (m.normal[a + 2]! + m.normal[b + 2]! + m.normal[c + 2]!);
      if (dot >= 0) ok++;
    }
    expect(ok / r.t).toBeGreaterThan(0.95);
  });
});

describe.each(props)('реквизит %s', (name, p) => {
  const base = build(p);

  it('описание и опора в порядке', () => {
    expect(p.ru.trim().length).toBeGreaterThan(2);
    for (const v of [p.w, p.d, p.h]) expect(v > 0 && Number.isFinite(v)).toBe(true);
    if (p.mount === 'wall') expect(p.y !== undefined && p.y > 0 && p.y + p.h <= 2.6, name).toBe(true);
    else expect(p.y, name).toBeUndefined();
  });

  it('сетка цела, материал допустим', () => {
    const m = base.mesh;
    expect(m.index.length).toBeGreaterThan(60);
    expect(m.index.length % 3).toBe(0);
    expect(m.index.every((i) => i < m.position.length / 3)).toBe(true);
    expect(m.mat.every((v) => Number.isInteger(v) && v >= 0 && v < MAT_COUNT && v !== MAT.print && v !== MAT.stencil)).toBe(true);
    for (let i = 0; i < m.normal.length; i += 3) expect(Math.hypot(m.normal[i]!, m.normal[i + 1]!, m.normal[i + 2]!)).toBeCloseTo(1, 3);
    for (let i = 0; i < m.color.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        expect(m.color[i + k]!).toBeGreaterThanOrEqual(0.05 - 1e-6);
        expect(m.color[i + k]!).toBeLessThanOrEqual(2.6 + 1e-6);
      }
      expect(m.color[i + 3]).toBe(1);
    }
  });

  it('укладывается в заявленный габарит в четырёх поворотах', () => {
    const env = envelope(p);
    for (const rot of [0, 1, 2, 3] as const) {
      const bb = bounds(build(p, rot).mesh);
      // При повороте на четверть оборота ширина и глубина меняются местами: сравниваем с повёрнутой коробкой.
      const e = rotEnv(env, rot);
      for (let k = 0; k < 3; k++) {
        expect(bb.min[k]!, `${name}, поворот ${rot}: min ${AXES[k]}`).toBeGreaterThanOrEqual(e.min[k]! - TOL);
        expect(bb.max[k]!, `${name}, поворот ${rot}: max ${AXES[k]}`).toBeLessThanOrEqual(e.max[k]! + TOL);
      }
    }
  });

  it('габарит заявлен впритык: не больше сантиметра-двух запаса', () => {
    const bb = bounds(base.mesh);
    expect(p.h - bb.max[1]).toBeLessThan(0.02);
    expect(p.h - bb.max[1]).toBeGreaterThanOrEqual(-TOL);
  });

  it('стоит на своей опоре', () => {
    const bb = bounds(base.mesh);
    expect(bb.min[1], 'низ на полу').toBeLessThanOrEqual(0.03);
    if (p.mount === 'wall' || p.mount === 'floor') expect(bb.min[2], 'спина у стены').toBeLessThanOrEqual(0.03);
  });

  it('преграды внутри габарита; у настенного их нет', () => {
    const env = envelope(p);
    if (p.mount === 'wall') expect(base.col.boxes.length).toBe(0);
    for (const b of base.col.boxes) {
      const lo: Vec3 = [b.minX, b.minY, b.minZ];
      const hi: Vec3 = [b.maxX, b.maxY, b.maxZ];
      for (let k = 0; k < 3; k++) {
        expect(hi[k]! - lo[k]!).toBeGreaterThan(0.005);
        expect(lo[k]!, `преграда min ${AXES[k]}`).toBeGreaterThanOrEqual(env.min[k]! - TOL);
        expect(hi[k]!, `преграда max ${AXES[k]}`).toBeLessThanOrEqual(env.max[k]! + TOL);
      }
      expect(b.minY).toBeLessThanOrEqual(0.45);
    }
  });

  it('один вызов — один результат', () => {
    const a = build(p);
    expect(Array.from(a.mesh.position)).toEqual(Array.from(base.mesh.position));
    expect(a.col.boxes).toEqual(base.col.boxes);
  });
});
