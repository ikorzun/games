import { describe, expect, it } from 'vitest';
import { box, bounds, grabMove, grabStart, loadWork, problems, raycast, saveWork, sphere, stamp, subdivide, tcount, toRecord, vcount } from '../tools/sculpt/core';
import type { SculptMesh, V3 } from '../tools/sculpt/core';
import { decodeRecord } from '../src/world/models';

/** Слова партнёра: «Своя лепка в браузере… Ограничения можно встроить прямо в редактор… Мне для MacBook давай делать». */
const C: V3 = [0, 0.3, 0];
const radius = (m: SculptMesh, i: number): number => Math.hypot(m.pos[i * 3]! - C[0], m.pos[i * 3 + 1]! - C[1], m.pos[i * 3 + 2]! - C[2]);
/** Вершина, ближайшая к точке. */
function nearest(m: SculptMesh, p: V3): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < vcount(m); i++) {
    const d = Math.hypot(m.pos[i * 3]! - p[0], m.pos[i * 3 + 1]! - p[1], m.pos[i * 3 + 2]! - p[2]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

describe('лепка: сетка', () => {
  it('шар замкнут, нормали наружу; луч попадает в ближнюю сторону', () => {
    const m = sphere(3);
    expect(vcount(m)).toBe(642);
    expect(tcount(m)).toBe(1280);
    // Каждое ребро — у двух треугольников (замкнутая поверхность).
    const edges = new Map<string, number>();
    for (let f = 0; f < m.idx.length; f += 3) {
      for (let k = 0; k < 3; k++) {
        const a = m.idx[f + k]!;
        const b = m.idx[f + ((k + 1) % 3)]!;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    for (let i = 0; i < vcount(m); i++) {
      const d = (m.pos[i * 3]! - C[0]) * m.nrm[i * 3]! + (m.pos[i * 3 + 1]! - C[1]) * m.nrm[i * 3 + 1]! + (m.pos[i * 3 + 2]! - C[2]) * m.nrm[i * 3 + 2]!;
      expect(d).toBeGreaterThan(0);
    }
    const hit = raycast(m, [0, 0.3, 2], [0, 0, -1])!;
    expect(hit).not.toBeNull();
    expect(hit.p[2]).toBeGreaterThan(0.28);
    expect(hit.n[2]).toBeGreaterThan(0.9);
    expect(raycast(m, [0, 2, 2], [0, 0, -1])).toBeNull();
  });

  it('куб-подушка тоже замкнут и стоит на полу; «подробнее» — вчетверо больше треугольников, форма та же', () => {
    const b = box(6);
    expect(bounds(b).min[1]).toBeCloseTo(0, 2);
    const s = sphere(2);
    const d = subdivide(s);
    expect(tcount(d)).toBe(tcount(s) * 4);
    let worst = 0;
    for (let i = 0; i < vcount(d); i++) worst = Math.max(worst, Math.abs(radius(d, i) - 0.3));
    expect(worst).toBeLessThan(0.03);
  });
});

describe('лепка: кисти', () => {
  it('«рисовать» выдавливает под кистью и зеркально по x; с ⌥ — вдавливает', () => {
    const m = sphere(4);
    const at: V3 = [0.15, 0.3, Math.sqrt(0.3 * 0.3 - 0.15 * 0.15)];
    const n: V3 = [at[0] / 0.3, 0, at[2] / 0.3];
    const i = nearest(m, at);
    const j = nearest(m, [-at[0], at[1], at[2]]);
    const r0 = radius(m, i);
    stamp(m, { brush: 'draw', at, n, radius: 0.08, strength: 0.6, invert: false }, true);
    expect(radius(m, i)).toBeGreaterThan(r0 + 0.002);
    expect(radius(m, j)).toBeCloseTo(radius(m, i), 3);
    // Далеко от кисти ничего не сдвинулось.
    const far = nearest(m, [0, 0.3, -0.3]);
    expect(radius(m, far)).toBeCloseTo(0.3, 5);
    const r1 = radius(m, i);
    stamp(m, { brush: 'draw', at, n, radius: 0.08, strength: 0.6, invert: true }, true);
    expect(radius(m, i)).toBeLessThan(r1);
  });

  it('«гладить» убирает рябь; «двигать» тянет середину сильнее края; «краска» красит под кистью', () => {
    const m = sphere(4);
    for (let i = 0; i < vcount(m); i++) {
      const k = 1 + (i % 2 === 0 ? 0.04 : -0.04);
      for (let c = 0; c < 3; c++) m.pos[i * 3 + c] = C[c]! + (m.pos[i * 3 + c]! - C[c]!) * k;
    }
    const spread = (): number => {
      let s = 0;
      for (let i = 0; i < vcount(m); i++) s += Math.abs(radius(m, i) - 0.3);
      return s / vcount(m);
    };
    const before = spread();
    for (const z of [0.3, -0.3]) for (const x of [0, 0.2, -0.2]) for (const y of [0.1, 0.3, 0.5]) stamp(m, { brush: 'smooth', at: [x, y, z * 0.9], n: [0, 0, Math.sign(z)], radius: 0.25, strength: 0.8, invert: false }, false);
    expect(spread()).toBeLessThan(before * 0.7);

    const g = sphere(4);
    const top: V3 = [0, 0.6, 0];
    const mid = nearest(g, top);
    const edge = nearest(g, [0.08, 0.6 - 0.011, 0]);
    const y0 = g.pos[mid * 3 + 1]!;
    const ye = g.pos[edge * 3 + 1]!;
    const grab = grabStart(g, top, 0.12, true);
    grabMove(g, grab, [0, 0.1, 0]);
    expect(g.pos[mid * 3 + 1]! - y0).toBeGreaterThan(0.09);
    expect(g.pos[edge * 3 + 1]! - ye).toBeLessThan(g.pos[mid * 3 + 1]! - y0);

    const p = sphere(3);
    const pi = nearest(p, [0, 0.6, 0]);
    stamp(p, { brush: 'paint', at: [0, 0.6, 0], n: [0, 1, 0], radius: 0.1, strength: 1, invert: false, color: [0.9, 0.1, 0.1] }, false);
    expect(p.col[pi * 3]!).toBeGreaterThan(0.85);
    expect(p.col[pi * 3 + 1]!).toBeLessThan(0.2);
    // Краска форму не трогает.
    expect(radius(p, pi)).toBeCloseTo(0.3, 5);
  });
});

describe('лепка: ограничения игры и выгрузка', () => {
  it('выше потолка, шире клетки, висит над полом — редактор говорит об этом', () => {
    const tall = sphere(2, 1.5, [0, 1.6, 0]);
    expect(problems(tall, 'floor').some((p) => p.startsWith('выше потолка'))).toBe(true);
    expect(problems(tall, 'floor').some((p) => p.startsWith('шире клетки'))).toBe(true);
    const fly = sphere(2, 0.2, [0, 0.6, 0]);
    expect(problems(fly, 'floor').some((p) => p.startsWith('висит над полом'))).toBe(true);
    expect(problems(sphere(2), 'floor')).toEqual([]);
  });

  it('выгрузка — запись модели игры: встаёт на пол, укладывается в бюджет, читается игрой', () => {
    const m = sphere(4, 0.2, [0.5, 0.7, -0.3]);
    stamp(m, { brush: 'paint', at: [0.5, 0.9, -0.3], n: [0, 1, 0], radius: 0.1, strength: 1, invert: false, color: [0.2, 0.4, 0.8] }, false);
    // Упрощение — подставное (в браузере это meshoptimizer): каждый k-й треугольник, по всей поверхности.
    const thin = (idx: Uint32Array, _pos: Float32Array, n: number): Uint32Array => {
      const step = Math.ceil(idx.length / n);
      const out: number[] = [];
      for (let f = 0; f < idx.length / 3 && out.length < n; f += step) out.push(idx[f * 3]!, idx[f * 3 + 1]!, idx[f * 3 + 2]!);
      return Uint32Array.from(out);
    };
    const { record, tris } = toRecord(m, 'floor', 1500, thin);
    expect(tris).toBeLessThanOrEqual(1500);
    const d = decodeRecord(record);
    expect(d.index.length / 3).toBe(tris);
    expect(d.min[1]).toBeCloseTo(0, 3);
    // Стоит по центру: середина габарита по x и z — в нуле.
    expect(Math.abs((d.min[0] + d.max[0]) / 2)).toBeLessThan(0.02);
    expect(d.max[1]).toBeGreaterThan(0.38);
    // Цвет краски дошёл (sRGB 8 бит → линейный): синее больше красного там, где красили.
    const top = d.position.reduce((best, _, i, a) => (i % 3 === 1 && a[i]! > a[best * 3 + 1]! ? i / 3 - 1 / 3 : best), 0);
    const t = Math.round(top);
    expect(d.color[t * 3 + 2]!).toBeGreaterThan(d.color[t * 3]!);
    // Без упрощения — все треугольники.
    expect(toRecord(m, 'floor', 1e6).tris).toBe(tcount(m));
  });

  it('работа сохраняется и открывается той же, со всей плотностью и краской', () => {
    const m = subdivide(sphere(3));
    stamp(m, { brush: 'draw', at: [0, 0.6, 0], n: [0, 1, 0], radius: 0.1, strength: 0.7, invert: false }, true);
    const w = JSON.parse(JSON.stringify(saveWork(m)));
    const back = loadWork(w);
    expect(vcount(back)).toBe(vcount(m));
    expect(Array.from(back.idx)).toEqual(Array.from(m.idx));
    expect(Math.abs(back.pos[100]! - m.pos[100]!)).toBeLessThan(1e-7);
    expect(Math.abs(back.col[30]! - m.col[30]!)).toBeLessThan(0.01);
  });
});
