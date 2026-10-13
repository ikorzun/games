/**
 * Точечное растворение (dithering) между сценами в графике «Воспоминания» (решение владельца 2026-10-13): последний
 * кадр уходящей сцены рассыпается по порогам матрицы Байера 8×8 — клетка за клеткой открывается первый кадр новой,
 * за DITHER_MS. Клетки крупные (DITHER_CELL логических пикселей), как у старых видеомикшеров и игр.
 */
import { defaultFilterVert, Filter, GlProgram, UniformGroup } from 'pixi.js';

/** Длительность точечного растворения, мс («буквально на секунду-две»). */
export const DITHER_MS = 1500;
/** Размер клетки узора, логические пиксели. */
export const DITHER_CELL = 3;

export const DITHER_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uDither; // доля пройденного 0…1, размер клетки в пикселях буфера, 0, 0

// Порог матрицы Байера 8×8 дробной арифметикой (PixiJS собирает фильтры как GLSL ES 1.00 — побитовых операций нет):
// 2×2 → 4×4 → 8×8, та же матрица, что bayer8() ниже на TypeScript (сверено тестом). Только чётность клетки —
// числа малые, точности хватает на любом экране.
float bayer2(vec2 a) {
  a = mod(floor(a), 2.0);
  return fract(a.x * 0.5 + a.y * 0.75);
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec4 col = texture(uTexture, vTextureCoord);
  finalColor = bayer8(gl_FragCoord.xy / uDither.y) + 0.5 / 64.0 < uDither.x ? vec4(0.0) : col;
}
`;

/** Порядковый номер клетки (x, y) в матрице Байера 8×8, 0…63: (x xor y) и y по битам, перевёрнуто — эталон для шейдера. */
export function bayer8(x: number, y: number): number {
  const cx = ((x % 8) + 8) % 8;
  const cy = ((y % 8) + 8) % 8;
  const a = cx ^ cy;
  let v = 0;
  for (let i = 0; i < 3; i++) v = (v << 2) | (((a >> i) & 1) << 1) | ((cy >> i) & 1);
  return v;
}

export class DitherFilter extends Filter {
  private readonly u: Float32Array;

  constructor() {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment: DITHER_FRAGMENT, name: 'dither-dissolve', preferredFragmentPrecision: 'highp' });
    const group = new UniformGroup({ uDither: { value: new Float32Array([0, DITHER_CELL, 0, 0]), type: 'vec4<f32>' } });
    super({ glProgram, resources: { ditherUniforms: group }, padding: 0, antialias: 'off', resolution: 'inherit' });
    this.u = (group.uniforms as Record<string, Float32Array>).uDither!;
  }

  /** Доля пройденного (0 — весь старый кадр, 1 — его не осталось) и размер клетки в пикселях буфера. */
  setProgress(k: number, cellPx: number): void {
    this.u[0] = Math.min(1, Math.max(0, k));
    this.u[1] = Math.max(1, cellPx);
    (this.resources.ditherUniforms as UniformGroup).update();
  }
}
