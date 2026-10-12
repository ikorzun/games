/**
 * Плейсхолдеры вместо арта: цвет — детерминированная функция от id, поэтому один и тот же
 * фон/персонаж всегда выглядит одинаково между запусками и между рендерерами (Pixi / DOM).
 */

/** FNV-1a, 32 бита. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Hsl {
  /** 0..359 */
  h: number;
  /** 0..100 */
  s: number;
  /** 0..100 */
  l: number;
}

export type PlaceholderKind = 'bg' | 'sprite' | 'cg';

const RANGES: Record<PlaceholderKind, { s: [number, number]; l: [number, number] }> = {
  bg: { s: [26, 42], l: [20, 30] },
  sprite: { s: [34, 52], l: [36, 50] },
  cg: { s: [28, 44], l: [16, 24] },
};

export function placeholderHsl(id: string, kind: PlaceholderKind): Hsl {
  const h = hash32(`${kind}:${id}`);
  const r = RANGES[kind];
  const unit = (shift: number): number => ((h >>> shift) & 0xff) / 255;
  return {
    h: h % 360,
    s: r.s[0] + (r.s[1] - r.s[0]) * unit(9),
    l: r.l[0] + (r.l[1] - r.l[0]) * unit(17),
  };
}

export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): number => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** 0xRRGGBB для PixiJS. */
export function hslToInt(hsl: Hsl): number {
  const [r, g, b] = hslToRgb(hsl);
  return (r << 16) | (g << 8) | b;
}

export function hslToCss(hsl: Hsl): string {
  return `hsl(${hsl.h.toFixed(0)} ${hsl.s.toFixed(0)}% ${hsl.l.toFixed(0)}%)`;
}

/** Подпись для плейсхолдера: id без технических префиксов не режем — по ней видно, что подставлять. */
export function placeholderLabel(id: string): string {
  return id;
}
