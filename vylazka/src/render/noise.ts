/**
 * Тайловые шумовые поля, из которых на CPU собираются все текстуры игры. Только целочисленный хеш:
 * картинка одинакова на любом устройстве и переживает потерю графического контекста.
 *
 * Поле — квадратный Float32Array со значениями 0..1, бесшовный по обеим осям. Поля считаются один раз
 * и потом читаются с целым множителем частоты (тогда бесшовность сохраняется), поэтому десяток
 * разных текстур стоит немногим дороже одной.
 */
import { hash01 } from '../core/rng';

export interface Field {
  size: number;
  data: Float32Array;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Фрактальный шум: octaves октав, начиная с px×py периодов на сторону. */
export function fbmField(size: number, px: number, py: number, octaves: number, seed: number): Field {
  const data = new Float32Array(size * size);
  let amp = 0.5;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let o = 0; o < octaves; o++) {
    // Решётка случайных значений октавы.
    const lat = new Float32Array(fx * fy);
    for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) lat[j * fx + i] = hash01(i, j, seed + o * 17);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * fy;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      const r0 = (y0 % fy) * fx;
      const r1 = ((y0 + 1) % fy) * fx;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * fx;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const c0 = x0 % fx;
        const c1 = (x0 + 1) % fx;
        const a = lat[r0 + c0]!;
        const b = lat[r0 + c1]!;
        const c = lat[r1 + c0]!;
        const d = lat[r1 + c1]!;
        data[y * size + x]! += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    if (fx > size || fy > size) break;
  }
  for (let i = 0; i < data.length; i++) data[i] = data[i]! / norm;
  return { size, data };
}

export interface CellField {
  size: number;
  /** Расстояние до ближайшей точки, 0..1 (в долях ячейки). */
  near: Float32Array;
  /** Расстояние до границы ячейки, 0..1: у трещины — ноль. */
  edge: Float32Array;
  /** Случайное число ячейки, 0..1: одно на весь «лоскут». */
  id: Float32Array;
}

/** Ячеистый шум (Вороной): cells×cells точек на сторону, бесшовный. */
export function cellField(size: number, cells: number, seed: number): CellField {
  const near = new Float32Array(size * size);
  const edge = new Float32Array(size * size);
  const id = new Float32Array(size * size);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  const pid = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      px[j * cells + i] = 0.12 + 0.76 * hash01(i, j, seed);
      py[j * cells + i] = 0.12 + 0.76 * hash01(i, j, seed + 53);
      pid[j * cells + i] = hash01(i, j, seed + 97);
    }
  }
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const cy = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const cx = Math.floor(gx);
      let d1 = 9;
      let d2 = 9;
      let best = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = (((cx + ox) % cells) + cells) % cells;
          const iy = (((cy + oy) % cells) + cells) % cells;
          const k = iy * cells + ix;
          const dx = cx + ox + px[k]! - gx;
          const dy = cy + oy + py[k]! - gy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      }
      const o = y * size + x;
      near[o] = Math.min(1, d1);
      edge[o] = Math.min(1, d2 - d1);
      id[o] = pid[best]!;
    }
  }
  return { size, near, edge, id };
}

/** Прочитать поле с целыми множителями частоты и сдвигом в текселях (бесшовность сохраняется). */
export function at(f: Field, x: number, y: number, kx = 1, ky = kx, ox = 0, oy = 0): number {
  const n = f.size;
  return f.data[(((y * ky + oy) % n) + n) % n * n + ((((x * kx + ox) % n) + n) % n)]!;
}

/** То же для массива ячеистого поля. */
export function atCell(a: Float32Array, size: number, x: number, y: number, k = 1, ox = 0, oy = 0): number {
  return a[(((y * k + oy) % size) + size) % size * size + ((((x * k + ox) % size) + size) % size)]!;
}

export const sstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
