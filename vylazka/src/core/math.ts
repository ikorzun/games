/** Мелкая математика без зависимостей (годится и для тестов в node). */
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Экспоненциальное приближение к цели, не зависящее от частоты кадров: tau — время, за которое остаётся 1/e разницы. */
export const approach = (current: number, target: number, tau: number, dt: number): number =>
  tau <= 0 ? target : target + (current - target) * Math.exp(-dt / tau);

/** Кратчайшая разница углов в радианах, результат в (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Линейный sRGB-компонент [0,1] → байт sRGB. */
export function linearToSrgb8(v: number): number {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
