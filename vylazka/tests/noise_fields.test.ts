import { describe, expect, it } from 'vitest';
import { bakeGrime } from '../src/render/grime';
import { cellField, fbmField, gradField, matchField, warpField } from '../src/render/noise';
import type { Field } from '../src/render/noise';

const N = 64;

const spread = (f: Field): number => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f.data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
};

/** Средняя разница соседей по x внутри поля и на стыке (последний столбец → первый). */
function neighbours(f: Field): { inside: number; seam: number } {
  const n = f.size;
  let inside = 0;
  let seam = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n - 1; x++) inside += Math.abs(f.data[y * n + x + 1]! - f.data[y * n + x]!);
    seam += Math.abs(f.data[y * n]! - f.data[y * n + n - 1]!);
  }
  return { inside: inside / (n * (n - 1)), seam: seam / n };
}

describe('gradField: градиентный шум', () => {
  const f = gradField(N, 4, 4, 4, 11);

  it('значения в [0, 1], размер сходится', () => {
    expect(f.size).toBe(N);
    expect(f.data.length).toBe(N * N);
    for (const v of f.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('бесшовный: разница через край не больше типичной разницы соседей, умноженной на 3', () => {
    const { inside, seam } = neighbours(f);
    expect(seam).toBeLessThanOrEqual(inside * 3);
    // И по вертикали.
    let vIn = 0;
    let vSeam = 0;
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N - 1; y++) vIn += Math.abs(f.data[(y + 1) * N + x]! - f.data[y * N + x]!);
      vSeam += Math.abs(f.data[x]! - f.data[(N - 1) * N + x]!);
    }
    expect(vSeam / N).toBeLessThanOrEqual((vIn / (N * (N - 1))) * 3);
  });

  it('детерминирован; другой сид даёт другое поле', () => {
    expect(gradField(N, 4, 4, 4, 11).data).toEqual(f.data);
    expect(gradField(N, 4, 4, 4, 12).data).not.toEqual(f.data);
  });

  it('не вырожден: разброс больше 0,1', () => {
    expect(spread(f)).toBeGreaterThan(0.1);
  });

  it('не степень двойки — ошибка', () => {
    expect(() => gradField(60, 4, 4, 3, 1)).toThrow();
  });
});

describe('warpField: увод поля в стороны', () => {
  const f = gradField(N, 4, 4, 3, 21);
  const by = gradField(N, 2, 2, 3, 22);

  it('тот же размер и детерминизм', () => {
    const w = warpField(f, by, 0.1);
    expect(w.size).toBe(N);
    expect(w.data.length).toBe(N * N);
    expect(warpField(f, by, 0.1).data).toEqual(w.data);
  });

  it('при amount = 0 равен исходному полю', () => {
    const w = warpField(f, by, 0);
    for (let i = 0; i < f.data.length; i++) expect(w.data[i]).toBeCloseTo(f.data[i]!, 6);
  });

  it('при ненулевом amount поле меняется, значения остаются в пределах исходных', () => {
    const w = warpField(f, by, 0.15);
    expect(w.data).not.toEqual(f.data);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of f.data) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (const v of w.data) {
      expect(v).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(v).toBeLessThanOrEqual(hi + 1e-6);
    }
  });
});

describe('matchField: подгонка разброса под образец', () => {
  const f = gradField(N, 4, 4, 3, 31);
  const like = fbmField(N, 4, 4, 3, 32);
  const m = matchField(f, like);

  it('отсортированные значения результата равны отсортированным значениям образца', () => {
    expect(Float32Array.from(m.data).sort()).toEqual(Float32Array.from(like.data).sort());
  });

  it('порядок мест сохранён: где у исходного больше — там у результата не меньше', () => {
    const idx = Array.from({ length: f.data.length }, (_, i) => i).sort((a, b) => f.data[a]! - f.data[b]! || a - b);
    for (let k = 1; k < idx.length; k++) expect(m.data[idx[k]!]!).toBeGreaterThanOrEqual(m.data[idx[k - 1]!]!);
  });

  it('размер прежний', () => {
    expect(m.size).toBe(N);
  });
});

describe('bakeGrime: карта запустения', () => {
  const size = 64;
  const seed = 7;
  const data = bakeGrime(size, seed);
  const channel = (ch: number): number[] => Array.from({ length: size * size }, (_, i) => data[i * 4 + ch]!);
  /** Прежняя карта: fbm-поле после той же растяжки контраста. */
  const stretch = (f: Field, k: number): number[] => Array.from(f.data, (v) => Math.round(Math.min(1, Math.max(0, (v - 0.5) * k + 0.5)) * 255));

  it('размер size × size × 4', () => {
    expect(data.length).toBe(size * size * 4);
  });

  it('канал R не совпадает с прежней решёточной картой, но гистограмма та же (±1)', () => {
    const old = stretch(fbmField(size, 8, 8, 5, seed), 1.8);
    const now = channel(0);
    expect(now).not.toEqual(old);
    const a = [...now].sort((x, y) => x - y);
    const b = [...old].sort((x, y) => x - y);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!), `i=${i}`).toBeLessThanOrEqual(1);
  });

  it('канал G не совпадает с прежней решёточной картой, но гистограмма та же (±1)', () => {
    const old = stretch(fbmField(size, 3, 3, 3, seed + 101), 2.0);
    const now = channel(1);
    expect(now).not.toEqual(old);
    const a = [...now].sort((x, y) => x - y);
    const b = [...old].sort((x, y) => x - y);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!), `i=${i}`).toBeLessThanOrEqual(1);
  });

  it('детерминирована; остальные каналы не вырождены', () => {
    expect(bakeGrime(size, seed)).toEqual(data);
    for (const ch of [2, 3]) {
      const c = channel(ch);
      expect(Math.max(...c) - Math.min(...c), `канал ${ch}`).toBeGreaterThan(20);
    }
    // cellField здесь нужен только как проверка, что экспорт на месте.
    expect(cellField(size, 14, seed + 307).edge.length).toBe(size * size);
  });
});
