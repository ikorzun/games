/**
 * Карта запустения: тайловая текстура, по которой шейдер решает, где грязь, сырость, ржавчина
 * и облупившаяся краска. Запекается на CPU целочисленным шумом (одинакова на всех устройствах).
 * R — мелкая грязь и потёртости, G — крупные пятна, B — вертикальные потёки,
 * A — сетка трещин: расстояние до ближайшей трещины (0 — сама трещина).
 */
import { clamp01 } from '../core/math';
import { at, atCell, cellField, fbmField } from './noise';

export function bakeGrime(size = 256, seed = 7): Uint8Array {
  const fine = fbmField(size, 8, 8, 5, seed);
  const blotch = fbmField(size, 3, 3, 3, seed + 101);
  const streak = fbmField(size, 28, 2, 3, seed + 211);
  const cells = cellField(size, 14, seed + 307);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      // Контраст: середина шума растягивается, чтобы грязь читалась пятнами, а не серой пеленой.
      data[o] = Math.round(clamp01((at(fine, x, y) - 0.5) * 1.8 + 0.5) * 255);
      data[o + 1] = Math.round(clamp01((at(blotch, x, y) - 0.5) * 2.0 + 0.5) * 255);
      data[o + 2] = Math.round(clamp01((at(streak, x, y) - 0.5) * 1.8 + 0.5) * 255);
      data[o + 3] = Math.round(clamp01(atCell(cells.edge, size, x, y) * 2.2) * 255);
    }
  }
  return data;
}
