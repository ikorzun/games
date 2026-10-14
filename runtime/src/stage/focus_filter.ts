/**
 * Подсветка того, на ком внимание (решение владельца 2026-10-13: «он говорит или на него все смотрят и ждут»).
 *
 * Кадр покрытия остаётся тем же файлом; поверх него шейдер по маске человека (assets.shots[].cast[].mask, белый
 * человек на чёрном) приглушает окружение примерно на треть и кладёт мягкий контровой свет на край силуэта со
 * стороны света. Масок две — прежний и новый в фокусе: при смене говорящего одна гаснет, другая проявляется,
 * поэтому свет «переходит» плавно, а не переключается. Нет маски (крупный план, человек не в кадре) — нет эффекта.
 */
import { defaultFilterVert, Filter, GlProgram, Texture, UniformGroup } from 'pixi.js';
import type { TextureSource } from 'pixi.js';

/** Сколько длится переход подсветки, мс. */
export const FOCUS_MS = 450;
/** Насколько гаснет окружение (доля яркости): 25–35 % по брифу. */
export const FOCUS_DIM = 0.3;
/** В графике «Воспоминания» — 10–20 % по промпту владельца (раздел 08); берём верхнюю границу: при 15 % подсветки
 *  не было видно (владелец 2026-10-14: «нежная подсветка говорящего должна быть и в воспоминаниях»). */
export const FOCUS_DIM_MEMORY = 0.2;
/** Сила контрового света. */
export const FOCUS_RIM = 0.32;
/** В «Воспоминаниях» контровой свет сильнее: «subtle but clearly perceptible» (раздел 08 промпта владельца). */
export const FOCUS_RIM_MEMORY = 0.5;
/** Ширина каймы — доля ширины кадра. */
export const FOCUS_RIM_RADIUS = 0.006;

export const FOCUS_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform vec4 uShot;   // кадр на экране: x, y, ширина, высота (логические пиксели)
uniform vec4 uFocus;  // вес маски A, вес маски B, затемнение окружения, сила контрового света
uniform vec4 uRim;    // откуда свет (x, y — куда смотрит освещённый край, y вниз), радиус каймы (доля ширины), 0

float maskAt(sampler2D m, vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture(m, uv).r;
}

// x — мягкая маска человека (для затемнения), y — контровая кайма: внутри силуэта у края, со стороны света.
vec2 person(sampler2D m, vec2 uv, vec2 r) {
  float c = maskAt(m, uv);
  float ring = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.78539816;
    vec2 d = vec2(cos(a), sin(a));
    float s = maskAt(m, uv + d * r);
    ring += s * 0.125;
    grad += d * s;
  }
  float soft = c * 0.2 + ring * 0.8;
  float edge = clamp(c - ring, 0.0, 1.0) * 2.0;
  vec2 outward = -grad;
  float facing = length(outward) > 1e-4 ? clamp(dot(normalize(outward), uRim.xy) * 0.75 + 0.25, 0.0, 1.0) : 0.0;
  return vec2(soft, edge * facing);
}

void main() {
  vec4 col = texture(uTexture, vTextureCoord);
  vec2 screen = uOutputFrame.xy + vTextureCoord * uInputSize.xy;
  vec2 uv = (screen - uShot.xy) / uShot.zw;
  vec2 r = vec2(uRim.z, uRim.z * uShot.z / uShot.w);
  vec2 a = person(uMaskA, uv, r);
  vec2 b = person(uMaskB, uv, r);
  float lit = a.x * uFocus.x + b.x * uFocus.y;
  float env = clamp(uFocus.x + uFocus.y - lit, 0.0, 1.0);
  col.rgb *= 1.0 - uFocus.z * env;
  float rim = clamp(a.y * uFocus.x + b.y * uFocus.y, 0.0, 1.0) * uFocus.w;
  col.rgb = 1.0 - (1.0 - col.rgb) * (1.0 - vec3(1.0, 0.93, 0.82) * rim);
  finalColor = col;
}
`;

type Vec4 = Float32Array;

export interface FocusFrame {
  /** Маска уходящего из фокуса (A) и приходящего (B); null — нет маски. */
  maskA: Texture | null;
  maskB: Texture | null;
  /** Веса масок 0…1 (переход). */
  wA: number;
  wB: number;
  /** Кадр на экране, логические пиксели. */
  shot: { x: number; y: number; width: number; height: number };
  /** Насколько гаснет окружение; по умолчанию FOCUS_DIM. */
  dim?: number;
  /** Сила контрового света (по умолчанию FOCUS_RIM). */
  rim?: number;
}

/** Плавный переход веса маски: от from к to за ms с t0 (smoothstep). */
export interface FocusFade {
  from: number;
  to: number;
  t0: number;
  ms: number;
}

export function fadeAt(f: FocusFade, now: number): number {
  const k = f.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - f.t0) / f.ms));
  return f.from + (f.to - f.from) * k * k * (3 - 2 * k);
}

export function fadeDone(f: FocusFade, now: number): boolean {
  return f.ms <= 0 || now - f.t0 >= f.ms;
}

export class FocusFilter extends Filter {
  private readonly u: Record<string, Vec4>;

  constructor() {
    // highp как у вершинного шейдера Pixi: иначе uInputSize с разной точностью и программа не линкуется.
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment: FOCUS_FRAGMENT, name: 'speaker-focus', preferredFragmentPrecision: 'highp' });
    const vec = (...v: number[]): { value: Vec4; type: 'vec4<f32>' } => ({ value: new Float32Array(v), type: 'vec4<f32>' });
    const group = new UniformGroup({
      uShot: vec(0, 0, 1, 1),
      uFocus: vec(0, 0, FOCUS_DIM, FOCUS_RIM),
      uRim: vec(0, -1, FOCUS_RIM_RADIUS, 0),
    });
    super({
      glProgram,
      resources: { focusUniforms: group, uMaskA: Texture.EMPTY.source, uMaskB: Texture.EMPTY.source },
      padding: 0,
      antialias: 'off',
      resolution: 'inherit',
    });
    this.u = group.uniforms as Record<string, Vec4>;
  }

  /** Униформы кадра (имя не apply: так называется собственный метод Filter). */
  setFrame(f: FocusFrame): void {
    this.resources.uMaskA = (f.maskA ?? Texture.EMPTY).source as TextureSource;
    this.resources.uMaskB = (f.maskB ?? Texture.EMPTY).source as TextureSource;
    this.u.uShot!.set([f.shot.x, f.shot.y, Math.max(1, f.shot.width), Math.max(1, f.shot.height)]);
    this.u.uFocus!.set([f.maskA ? f.wA : 0, f.maskB ? f.wB : 0, f.dim ?? FOCUS_DIM, f.rim ?? FOCUS_RIM]);
    (this.resources.focusUniforms as UniformGroup).update();
  }
}
