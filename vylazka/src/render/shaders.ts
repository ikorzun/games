/**
 * GLSL-шейдеры. Three.js для WebGL2 сам ставит `#version 300 es` и переводит attribute/varying/
 * texture2D/gl_FragColor, поэтому текст написан в привычном стиле, а sampler2DShadow читается
 * функцией texture().
 *
 * Свет: `ambient (альбедо × AO) + фонарь × matcap`. Matcap берётся по направлению на фонарь и входит
 * только в слагаемое фонаря — иначе при погасшем фонаре мир выглядел бы подсвеченным от камеры.
 * Цвет выходит линейным: буфер сцены — sRGB8, кодирование делает сама видеокарта.
 */

/** Общая часть: профиль луча и затухание. Используется миром, пылью и роем. */
export const BEAM_GLSL = /* glsl */ `
uniform vec3 uLightPosV;
uniform vec3 uLightDirV;
uniform vec3 uLightColor;
uniform vec4 uCone;

/** Яркость луча в точке (пространство камеры) без тени: xyz — направление на фонарь, w — освещённость. */
vec4 beamAt(vec3 posV) {
  vec3 toL = uLightPosV - posV;
  float d = length(toL);
  vec3 L = toL / max(d, 1e-4);
  float cosA = dot(-L, uLightDirV);
  float hot = smoothstep(uCone.y, uCone.x, cosA);
  float corona = smoothstep(uCone.z, uCone.y, cosA);
  float spill = smoothstep(uCone.w, uCone.z, cosA);
  float beam = hot * 0.78 + corona * 0.19 + spill * 0.03;
  // Кольца дешёвого отражателя вокруг яркого пятна.
  float ang = acos(clamp(cosA, -1.0, 1.0));
  beam *= 1.0 + 0.08 * sin(ang * 85.0) * corona * (1.0 - hot);
  float atten = 1.0 / (1.0 + 0.07 * d * d);
  return vec4(L, beam * atten);
}
`;

export const WORLD_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aMat;
uniform mat4 uShadowMatrix;
varying vec3 vPosV;
varying vec3 vNrmV;
varying vec4 vColor;
varying float vMat;
varying vec2 vUv;
varying vec4 vShadow;
varying float vWall;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vPosV = mv.xyz;
  vNrmV = mat3(viewMatrix) * wn;
  vColor = aColor;
  vMat = aMat;
  vUv = uv;
  vWall = 1.0 - step(0.5, abs(wn.y));
  // Сдвиг по нормали убирает «рябь» самозатенения на стенах, в которые свет бьёт вскользь.
  vShadow = uShadowMatrix * vec4(wp.xyz + wn * 0.035, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const WORLD_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;

uniform sampler2D uAtlas;
uniform sampler2D uGrime;
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
uniform vec3 uAmbient;
uniform vec4 uBounce;     // xyz — точка попадания луча (пространство камеры), w — сила отсвета
uniform float uFog;
uniform vec4 uMatParams[16];
uniform vec3 uMatBase[16];

varying vec3 vPosV;
varying vec3 vNrmV;
varying vec4 vColor;
varying float vMat;
varying vec2 vUv;
varying vec4 vShadow;
varying float vWall;

${BEAM_GLSL}

void main() {
  vec3 N = normalize(vNrmV);
  int mi = int(vMat + 0.5);
  vec4 mp = uMatParams[mi];
  vec3 base = uMatBase[mi];

  vec4 lb = beamAt(vPosV);
  vec3 L = lb.xyz;

  // Matcap по направлению на фонарь.
  vec3 bx = normalize(vec3(L.z, 0.0, -L.x) + vec3(1e-5, 0.0, 0.0));
  vec3 by = cross(L, bx);
  vec2 muv = vec2(dot(bx, N), dot(by, N)) * 0.47 + 0.5;
  vec2 cell = vec2(float(mi - (mi / 4) * 4), float(mi / 4));
  vec3 mc = texture2D(uAtlas, (cell + muv) * 0.25).rgb;
  float facing = smoothstep(-0.02, 0.1, dot(N, L));

  float shadow = 1.0;
#ifdef SHADOWS
  vec3 sc = vShadow.xyz / vShadow.w;
  if (vShadow.w > 0.0 && sc.x > 0.002 && sc.x < 0.998 && sc.y > 0.002 && sc.y < 0.998 && sc.z < 1.0) {
    float z = sc.z - 0.0004;
    float t = uShadowTexel * 0.75;
    shadow = 0.25 * (
      texture(uShadowMap, vec3(sc.xy + vec2(-t, -t), z)) +
      texture(uShadowMap, vec3(sc.xy + vec2( t, -t), z)) +
      texture(uShadowMap, vec3(sc.xy + vec2(-t,  t), z)) +
      texture(uShadowMap, vec3(sc.xy + vec2( t,  t), z)));
  }
#endif

  float ao = vColor.a;
  float dirt = mix(1.0, 0.72 + 0.56 * texture2D(uGrime, vUv * 0.66667).r, mp.x);
#ifdef DETAIL
  vec3 g2 = texture2D(uGrime, vUv * 0.11111 + 0.37).rgb;
  dirt *= mix(1.0, 0.78 + 0.44 * g2.g, mp.x);
  // Потёки — только на вертикальных поверхностях.
  dirt *= mix(1.0, 0.86 + 0.28 * g2.b, mp.x * vWall);
#endif
  vec3 tint = vColor.rgb * dirt;

  vec3 col = mc * tint * uLightColor * (lb.w * shadow * facing * mix(1.0, ao, 0.75));

  // Отсвет от освещённого пятна: мягко подсвечивает окрестности, как рассеянный от стены свет.
  vec3 toB = uBounce.xyz - vPosV;
  float db = length(toB);
  float bounce = uBounce.w / (1.0 + 0.35 * db * db) * (0.35 + 0.65 * max(dot(N, toB / max(db, 1e-3)), 0.0));
  col += base * tint * ao * (uAmbient + uLightColor * bounce);

  col += base * mp.y;
  col *= exp(-uFog * length(vPosV));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Глубина из точки фонаря: цвет не пишется. */
export const DEPTH_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const DEPTH_FRAG = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

/** Пыль в луче: точки вокруг камеры, светятся только там, куда бьёт фонарь. */
export const DUST_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uCamPos;
uniform float uPointScale;
varying float vLight;

${BEAM_GLSL}

void main() {
  const vec3 box = vec3(7.0, 3.2, 7.0);
  vec3 p = aSeed * box;
  p += vec3(sin(uTime * 0.11 + aSeed.y * 40.0), uTime * 0.02 + cos(uTime * 0.07 + aSeed.x * 31.0) * 0.3, cos(uTime * 0.09 + aSeed.z * 23.0)) * 0.25;
  // Облако бесконечно: точки заворачиваются вокруг камеры.
  p = mod(p - uCamPos + box * 0.5, box) - box * 0.5 + uCamPos;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vLight = beamAt(mv.xyz).w * smoothstep(0.25, 0.9, dist) * (0.4 + 0.6 * fract(aSeed.x * 91.7));
  gl_PointSize = clamp(uPointScale * (0.6 + fract(aSeed.z * 57.3)) / max(dist, 0.2), 1.0, 5.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const DUST_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uLightColor;
varying float vLight;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(uLightColor * vLight * a * 0.16, 1.0);
}
`;

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Бодикам: бочкообразная дисторсия широкоугольника, хроматическая аберрация, усиление сенсора
 * с шумом, мягкий клиппинг, виньетка, блочные срывы сигнала. Шум — целочисленный хеш: одинаков
 * на всех видеокартах и не ломается на mediump.
 */
export const POST_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uAspect;
uniform float uFrame;
uniform float uGain;
uniform float uNoise;
uniform float uBarrel;
uniform float uVignette;
uniform float uGlitch;
uniform float uTunnel;
uniform float uGas;
uniform float uFade;
uniform vec3 uBeam;      // xy — где на экране центр луча, z — сила свечения пыльного воздуха

varying vec2 vUv;

float hash(uvec2 p, uint s) {
  uint h = p.x * 0x27d4eb2du ^ p.y * 0x165667b1u ^ s * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du;
  h ^= h >> 12; h *= 0x297a2d39u;
  h ^= h >> 15;
  return float(h) * (1.0 / 4294967296.0);
}

vec2 distort(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  c.x *= uAspect;
  float r2 = dot(c, c);
  // Нормировка по середине длинной стороны: центр почти не увеличен, углы уходят за кадр и темнеют.
  float edge = max(uAspect, 1.0);
  c *= (1.0 + k * r2) / (1.0 + k * edge * edge);
  c.x /= uAspect;
  return c * 0.5 + 0.5;
}

vec3 sampleScene(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture2D(tScene, uv).rgb * inside.x * inside.y;
}

void main() {
  vec2 uv = vUv;
  uvec2 px = uvec2(gl_FragCoord.xy);
  uint frame = uint(uFrame);

  // Срыв сигнала: блоки 16 px уезжают по горизонтали, часть кадра рассыпается на крупные квадраты.
  if (uGlitch > 0.0) {
    uvec2 blk = px / 16u;
    float h = hash(blk, frame / 3u + 7u);
    if (h < uGlitch * 0.35) {
      uv.x += (hash(blk, frame / 3u + 31u) - 0.5) * 0.12 * uGlitch;
      uv = (floor(uv * uRes / 8.0) + 0.5) * 8.0 / uRes;
    }
    float line = hash(uvec2(0u, px.y / 3u), frame / 2u);
    if (line < uGlitch * 0.08) uv.x += (line - 0.02) * 0.6;
  }

  vec3 col;
#ifdef CHROMA
  col.r = sampleScene(distort(uv, uBarrel * 1.06)).r;
  col.g = sampleScene(distort(uv, uBarrel)).g;
  col.b = sampleScene(distort(uv, uBarrel * 0.94)).b;
#else
  col = sampleScene(distort(uv, uBarrel));
#endif

  vec2 c = vUv * 2.0 - 1.0;
  c.x *= uAspect;

  // Пыльный воздух светится вокруг луча.
  vec2 bc = uBeam.xy * 2.0 - 1.0;
  bc.x *= uAspect;
  vec2 bd = c - bc;
  col += vec3(1.0, 0.95, 0.85) * uBeam.z * exp(-dot(bd, bd) * 3.2);

  // Газ: жёлто-зелёная муть, в которой свет фонаря расплывается.
  col = mix(col, col * vec3(1.05, 1.0, 0.5) + vec3(0.012, 0.013, 0.004) + vec3(1.0, 1.0, 0.6) * uBeam.z * 1.5 * exp(-dot(bd, bd) * 0.9), uGas);

  // Усиление сенсора и его шум: в темноте камера «тянет» картинку, зерно растёт.
  col *= uGain;
  float n = hash(px, frame) - 0.5;
  vec3 nc = vec3(hash(px, frame + 101u), hash(px, frame + 211u), hash(px, frame + 307u)) - 0.5;
  col += (vec3(n) * 0.8 + nc * 0.45) * uNoise;
  col = max(col, 0.0);

  // Мягкий клиппинг дешёвого сенсора: яркое пятно выбеливается.
  col = 1.0 - exp(-col * 1.7);

  float r = length(c) / length(vec2(max(uAspect, 1.0), 1.0));
  col *= mix(1.0, smoothstep(1.12, 0.3, r), uVignette);
  col *= 1.0 - uTunnel * smoothstep(0.25, 0.95, r);

  // Цвет дешёвой камеры: приглушённая насыщенность, холодноватые тени.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 0.8) * vec3(0.96, 1.0, 0.98);

  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  // Чересстрочная фактура видеозаписи.
  col *= 1.0 - 0.035 * float(px.y & 1u);
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;
