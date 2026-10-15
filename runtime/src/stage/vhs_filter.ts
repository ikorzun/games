/**
 * Камкордер на видеокарте: один проход шейдера по всему кадру PixiJS (renderer_pixi.ts).
 *
 * Порядок как у настоящей камеры: сцена → движение камеры (сдвиг, поворот, масштаб — обратное преобразование
 * при выборке) → запись на ленту (аналоговый сигнал, по мотивам ntsc-rs https://ntsc.rs) → экран.
 * Поэтому шум, строки и зубцы лежат поверх уже сдвинутой картинки и не «плывут» вместе с ней, а холст не
 * пересчитывается CSS-трансформацией (от неё мелкий узор мылился и давал муар).
 *
 * Что делает проход (параметры — SignalProfile в camcorder.ts):
 *  - кадр делится на виртуальные строки (virtualLines): у строки свои сдвиг, шум и фаза цвета, а картинка читается
 *    с полным вертикальным разрешением (без ступенек на диагоналях — они читались как пиксели);
 *  - сдвиги строки: дрожание развёртки (чётные и нечётные врозь — зубцы на вертикальных краях), медленная волна,
 *    полоса переключения головок внизу кадра, полоса трекинга (всплеск помех планировщика);
 *  - яркость: лёгкое размытие вдоль строки и «звон» (перелёт у резких границ);
 *  - цвет (I/Q): шире по строке, с задержкой вправо, смешан с соседней строкой, фаза шумит от строки к строке,
 *    теряет насыщенность; на «сильно» цвет просачивается в яркость (рябь);
 *  - лента: шум яркости полосками, шум цвета, «снег» — белые штрихи с хвостом (гуще у нижнего края, как зона
 *    трекинга), редкие длинные выпадения;
 *  - разрыв кадра (fx vhs_glitch): рывки и шумовая полоса шва, открывшийся край — шум.
 *
 * Шум — хэши без синуса (Dave Hoskins): переживают mediump на телефонах. Номер кадра и время приходят
 * свёрнутыми (mod), чтобы не терять точность за долгую сессию.
 */
import { defaultFilterVert, Filter, GlProgram, UniformGroup } from 'pixi.js';
import { vhsUniforms } from './camcorder';
import type { VhsInput } from './camcorder';

export const VHS_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uInputClamp;

uniform vec4 uCam;   // сдвиг x, y (доли кадра), поворот (рад), масштаб
uniform vec4 uClock; // время (с), номер кадра, виртуальных строк, 1 — y текстуры вниз / -1 — вверх
uniform vec4 uSig1;  // размытие яркости, звон, растекание цвета, задержка цвета (вирт. пикс.)
uniform vec4 uSig2;  // шум яркости, шум цвета, снег, выпадения
uniform vec4 uSig3;  // дрожание строк, волна строк (вирт. пикс.), переключение головок (доля ширины), шум фазы цвета
uniform vec4 uSig4;  // рябь цвета в яркости, насыщенность, чересстрочность, уровень чёрного
uniform vec4 uBurst; // полоса трекинга: сила, центр, высота (доли кадра), мерцание
uniform vec4 uTear;  // разрыв кадра: сдвиг x, y (доли кадра), центр шва, высота шва

const vec3 LUMA = vec3(0.299, 0.587, 0.114);
const mat3 RGB2YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 YIQ2RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}

// точка кадра (0..1, y вниз) → координата текстуры, не дальше края области фильтра
vec3 src(vec2 p) {
  vec2 q = vec2(p.x, uClock.w > 0.0 ? p.y : 1.0 - p.y);
  vec2 t = q * uOutputFrame.zw * uInputSize.zw;
  return texture(uTexture, clamp(t, uInputClamp.xy, uInputClamp.zw)).rgb;
}

void main() {
  vec2 frame = uOutputFrame.zw;
  vec2 uv = vTextureCoord * uInputSize.xy / frame;
  float aspect = frame.x / frame.y;
  float lines = uClock.z;
  float vpx = lines * aspect;
  float yDown = uClock.w > 0.0 ? uv.y : 1.0 - uv.y;
  float line = floor(yDown * lines);
  float fr = uClock.y;
  float t = uClock.x;

  // ── сдвиги строки: развёртка, волна, головки, трекинг ──
  float jit = (hash12(vec2(line, fr)) - 0.5) * 2.0 * uSig3.x + (mod(line, 2.0) - 0.5) * uSig3.x;
  float wave = (vnoise(line * 0.035 + t * 0.7) - 0.5) * 2.0 * uSig3.y;
  float shift = (jit + wave) / vpx;
  float hsLines = max(3.0, lines * 0.016);
  float fromBottom = lines - 1.0 - line;
  float hsK = 0.0;
  if (fromBottom < hsLines) {
    hsK = 1.0 - fromBottom / hsLines;
    shift += uSig3.z * (0.35 + 0.65 * hsK) * (0.85 + 0.3 * hash12(vec2(line, fr + 7.0)));
  }
  float band = 0.0;
  if (uBurst.x > 0.0) {
    band = clamp(1.0 - abs(yDown - uBurst.y) / max(uBurst.z, 0.001), 0.0, 1.0);
    band = band * band * uBurst.x;
    shift += band * (vnoise(line * 0.25 + t * 30.0) - 0.5) * 0.06;
  }

  // ── камера: экран → исходная картинка (обратные сдвиг, поворот, масштаб вокруг центра), разрыв кадра ──
  // по вертикали — полное разрешение (без ступенек на диагоналях); построчные только сдвиги и шум
  vec2 sp = vec2(uv.x + shift, yDown) - uTear.xy;
  vec2 q = sp - 0.5 - uCam.xy;
  q.x *= aspect;
  float cr = cos(uCam.z);
  float sr = sin(uCam.z);
  q = vec2(cr * q.x + sr * q.y, -sr * q.x + cr * q.y) / uCam.w;
  q.x /= aspect;
  vec2 p = q + 0.5;
  bool outside = p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0;

  // ── яркость: лёгкое размытие вдоль строки и звон у резких границ ──
  float px = 1.0 / (vpx * uCam.w);
  float ls = max(uSig1.x, 0.05) * px;
  float Y = dot(src(p), LUMA) * 0.36
    + (dot(src(p - vec2(ls, 0.0)), LUMA) + dot(src(p + vec2(ls, 0.0)), LUMA)) * 0.22
    + (dot(src(p - vec2(2.0 * ls, 0.0)), LUMA) + dot(src(p + vec2(2.0 * ls, 0.0)), LUMA)) * 0.10;
  float ro = 3.0 * px;
  Y += uSig1.y * (Y - 0.5 * (dot(src(p - vec2(ro, 0.0)), LUMA) + dot(src(p + vec2(ro, 0.0)), LUMA)));

  // ── цвет: шире, с задержкой вправо, пополам с соседней строкой ──
  float cb = max(uSig1.z, 0.05) * px;
  vec2 pc = p - vec2(uSig1.w * px, 0.0);
  vec2 iq = (RGB2YIQ * src(pc - vec2(cb, 0.0))).yz * 0.25
    + (RGB2YIQ * src(pc)).yz * 0.5
    + (RGB2YIQ * src(pc + vec2(cb, 0.0))).yz * 0.25;
  iq = mix(iq, (RGB2YIQ * src(pc - vec2(0.0, 1.0 / (lines * uCam.w)))).yz, 0.4);
  float ph = (hash12(vec2(line, fr + 3.0)) - 0.5) * 2.0 * uSig3.w;
  float cp = cos(ph);
  float spn = sin(ph);
  iq = vec2(cp * iq.x - spn * iq.y, spn * iq.x + cp * iq.y);
  float xv = uv.x * vpx;
  iq += (vec2(vnoise(xv * 0.04 + hash12(vec2(line, fr)) * 97.0), vnoise(xv * 0.04 + hash12(vec2(fr, line)) * 89.0)) - 0.5) * uSig2.y;
  float phi = 3.14159265 * (xv * 0.5 + line * 0.5 + fr);
  Y += uSig4.x * (iq.x * cos(phi) + iq.y * sin(phi));

  // ── лента: шум яркости полосками ──
  float seedL = hash12(vec2(line, fr + 11.0)) * 131.0;
  float n = vnoise(xv * 0.35 + seedL) + 0.5 * vnoise(xv * 1.1 + seedL * 1.7);
  Y += (n / 1.5 - 0.5) * 2.0 * uSig2.x;

  // «снег»: белые штрихи с хвостом; гуще у нижнего края (зона трекинга) и в полосе трекинга
  float cell = floor(xv / 18.0);
  float snowP = uSig2.z * (1.0 + 7.0 * smoothstep(0.9, 1.0, yDown)) + band * 0.35;
  if (hash13(vec3(cell, line, fr)) < snowP) {
    float d = xv - (cell + hash13(vec3(cell, line, fr + 1.0))) * 18.0;
    float len = 2.0 + 14.0 * hash13(vec3(cell, fr, line));
    if (d >= 0.0 && d < len) Y += (1.0 - d / len) * (0.45 + 0.4 * hash13(vec3(line, cell, fr)));
  }
  // выпадения: длинный светлый штрих, цвет в нём пропадает
  if (hash12(vec2(line * 1.37, fr + 19.0)) < uSig2.w) {
    float d = xv - hash12(vec2(fr, line + 3.0)) * vpx;
    float len = vpx * (0.05 + 0.2 * hash12(vec2(line, fr + 23.0)));
    if (d >= 0.0 && d < len) {
      float k = 1.0 - d / len;
      Y = mix(Y, 0.95, 0.85 * sqrt(k));
      iq *= 1.0 - 0.8 * k;
    }
  }
  // полоса переключения головок: шум и потеря цвета
  if (hsK > 0.0) {
    Y += (hash13(vec3(floor(xv / 2.0), line, fr)) - 0.5) * 0.18 * hsK;
    iq *= 1.0 - 0.5 * hsK;
  }
  // полоса трекинга: серая пелена, снег, цвет уходит
  if (band > 0.0) {
    Y = mix(Y, Y * 0.85 + 0.12, band * 0.5);
    Y += (hash13(vec3(floor(xv / 3.0), line, fr)) - 0.5) * 0.5 * band;
    iq *= 1.0 - 0.6 * band;
  }
  Y *= 1.0 + uBurst.w * 0.12;

  // разрыв кадра: шумовая полоса шва и открывшийся край
  if (uTear.w > 0.0 && abs(yDown - uTear.z) < uTear.w * 0.5) {
    Y = mix(Y, hash13(vec3(floor(xv / 2.0), line, fr)) * 0.9, 0.75);
    iq *= 0.3;
  }
  if (outside) {
    Y = 0.04 + hash13(vec3(floor(xv / 2.0), line, fr + 5.0)) * 0.35;
    iq = vec2(0.0);
  }

  vec3 rgb = YIQ2RGB * vec3(Y, iq * uSig4.y);
  rgb = uSig4.w + rgb * (1.0 - uSig4.w);
  if (mod(line, 2.0) > 0.5) rgb *= 1.0 - uSig4.z;
  finalColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Vec4 = Float32Array;

export class VhsFilter extends Filter {
  private readonly u: Record<string, Vec4>;

  constructor() {
    const glProgram = GlProgram.from({
      vertex: defaultFilterVert,
      fragment: VHS_FRAGMENT,
      name: 'camcorder-vhs',
      preferredFragmentPrecision: 'highp',
    });
    const vec = (...v: number[]): { value: Vec4; type: 'vec4<f32>' } => ({ value: new Float32Array(v), type: 'vec4<f32>' });
    const group = new UniformGroup({
      uCam: vec(0, 0, 0, 1),
      uClock: vec(0, 0, 480, 1),
      uSig1: vec(0, 0, 0, 0),
      uSig2: vec(0, 0, 0, 0),
      uSig3: vec(0, 0, 0, 0),
      uSig4: vec(0, 1, 0, 0),
      uBurst: vec(0, 0, 0, 0),
      uTear: vec(0, 0, 0, 0),
    });
    super({ glProgram, resources: { vhsUniforms: group }, padding: 0, antialias: 'off', resolution: 'inherit' });
    this.u = group.uniforms as Record<string, Vec4>;
  }

  /** Униформы кадра (имя не apply: так называется собственный метод Filter в PixiJS). */
  setFrame(input: VhsInput): void {
    const values = vhsUniforms(input);
    for (const [name, v] of Object.entries(values)) this.u[name]!.set(v);
    (this.resources.vhsUniforms as UniformGroup).update();
  }
}
