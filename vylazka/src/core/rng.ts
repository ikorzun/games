/**
 * Целочисленный генератор случайных чисел. Всё, что влияет на уровень и сейв, считается только им:
 * сохранение может открыться на другом устройстве, а Math.sin/pow между движками побитово не совпадают.
 */
export type Rng = () => number;

/** mulberry32: [0, 1), детерминирован для данного зерна. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Целочисленный хеш двух координат и зерна → uint32 (для шума и разброса по ячейкам). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** hash2 в [0, 1). */
export const hash01 = (x: number, y: number, seed = 0): number => hash2(x, y, seed) / 4294967296;

export const randInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
export const randRange = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
