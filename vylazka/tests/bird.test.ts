import { describe, expect, it } from 'vitest';
import { birdMesh } from '../src/world/bird';

describe('сетка голубя', () => {
  const m = birdMesh();
  const n = m.position.length / 3;
  const P = (i: number): [number, number, number] => [m.position[i * 3]!, m.position[i * 3 + 1]!, m.position[i * 3 + 2]!];
  const sway = m.sway!;

  it('есть канал качания, не больше 160 треугольников, индексы целы', () => {
    expect(sway).toBeDefined();
    expect(sway.length).toBe(n);
    expect(m.index.length / 3).toBeLessThanOrEqual(160);
    expect(m.index.every((i) => i < n)).toBe(true);
    for (const arr of [m.position, m.normal, m.color, m.uv]) expect(arr.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('крылья: вес ненулевой, знак — как у x, растёт к кончику, не больше 1', () => {
    let wings = 0;
    let tipMax = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = P(i);
      if (Math.abs(x) <= 0.06 || Math.abs(y - 0.13) > 0.002) continue;
      wings++;
      const w = sway[i]!;
      expect(w, `вершина ${i}`).not.toBe(0);
      expect(Math.sign(w)).toBe(Math.sign(x));
      expect(Math.abs(w)).toBeLessThanOrEqual(1 + 1e-6);
      // Вес — по месту на крыле: (|x| − 0,05) / 0,37.
      expect(Math.abs(w)).toBeCloseTo(Math.min(1, (Math.abs(x) - 0.05) / 0.37), 3);
      tipMax = Math.max(tipMax, Math.abs(w));
    }
    expect(wings).toBeGreaterThan(20);
    expect(tipMax).toBeGreaterThan(0.95);
    // Монотонно: чем дальше от плеча, тем больше вес.
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) if (Math.abs(P(i)[0]) > 0.06 && Math.abs(P(i)[1] - 0.13) < 0.002) pairs.push([Math.abs(P(i)[0]), Math.abs(sway[i]!)]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < pairs.length; k++) expect(pairs[k]![1]).toBeGreaterThanOrEqual(pairs[k - 1]![1] - 1e-6);
  });

  it('тело, голова, хвост и лапы: канал нулевой (кроме плеч крыла)', () => {
    for (let i = 0; i < n; i++) {
      const [x, y] = P(i);
      const shoulder = Math.abs(Math.abs(x) - 0.05) < 1e-4 && Math.abs(y - 0.13) < 1e-4;
      if (Math.abs(x) > 0.06 && Math.abs(y - 0.13) < 0.002) continue;
      if (shoulder) {
        expect(Math.abs(sway[i]!)).toBeLessThanOrEqual(0.031);
        continue;
      }
      expect(sway[i], `вершина ${i} (${x.toFixed(3)}, ${y.toFixed(3)})`).toBe(0);
    }
  });

  it('габариты: размах 0,84, длина 0,36, низ на полу', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const p = P(i);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
      }
    }
    expect(hi[0]! - lo[0]!).toBeGreaterThanOrEqual(0.81);
    expect(hi[0]! - lo[0]!).toBeLessThanOrEqual(0.87);
    expect(hi[2]! - lo[2]!).toBeGreaterThanOrEqual(0.32);
    expect(hi[2]! - lo[2]!).toBeLessThanOrEqual(0.4);
    expect(Math.abs(lo[1]!)).toBeLessThanOrEqual(0.005);
  });

  it('обход граней согласован с нормалью вершины', () => {
    let bad = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!];
      const pa = P(a), pb = P(b), pc = P(c);
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const g = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const d = g[0]! * m.normal[a * 3]! + g[1]! * m.normal[a * 3 + 1]! + g[2]! * m.normal[a * 3 + 2]!;
      if (d < 0) bad++;
    }
    expect(bad).toBe(0);
  });
});
