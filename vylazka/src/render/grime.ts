/**
 * Тайловая текстура грязи, запечённая на CPU целочисленным шумом (одинакова на всех устройствах).
 * R — мелкая грязь и потёртости, G — крупные пятна, B — вертикальные потёки.
 */
import { clamp01 } from '../core/math';
import { hash01 } from '../core/rng';

function valueNoise(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (v: number, p: number): number => ((v % p) + p) % p;
  const h = (ix: number, iy: number): number => hash01(wrap(ix, periodX), wrap(iy, periodY), seed);
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Фрактальный шум, тайлится по [0,1)². */
function fbm(u: number, v: number, px: number, py: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * fx, v * fy, fx, fy, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

export function bakeGrime(size = 256, seed = 7): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const fine = fbm(u, v, 8, 8, 5, seed);
      const blotch = fbm(u, v, 3, 3, 3, seed + 101);
      const streak = fbm(u, v, 28, 2, 3, seed + 211);
      const o = (y * size + x) * 4;
      // Контраст: середина шума растягивается, чтобы грязь читалась пятнами, а не серой пеленой.
      data[o] = Math.round(clamp01((fine - 0.5) * 1.8 + 0.5) * 255);
      data[o + 1] = Math.round(clamp01((blotch - 0.5) * 2.0 + 0.5) * 255);
      data[o + 2] = Math.round(clamp01((streak - 0.5) * 1.8 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  return data;
}
