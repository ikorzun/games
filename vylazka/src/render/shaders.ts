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

/**
 * Распад: мир или отдельная вещь рассыпаются. Вершины расползаются кто куда (каждая клетка 0,4 м —
 * в свою сторону и вверх), а фрагментный шейдер выбивает в поверхности дыры. uDissolve — весь мир,
 * uThing.x — одна вещь (у неё свой материал).
 */
export const CRUMBLE_GLSL = /* glsl */ `
uniform float uDissolve;
uniform vec4 uThing;      // x — распад вещи 0..1, y — запас, z — запас, w — сид вещи

vec3 cellJitter(vec3 p) {
  ivec3 q = ivec3(floor(p)) + 32768;
  uint n = uint(q.x) * 0x27d4eb2du ^ uint(q.y) * 0x165667b1u ^ uint(q.z) * 0x9e3779b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12;
  uvec3 m = uvec3(n, n * 0x297a2d39u, n * 0x85ebca6bu);
  m ^= m >> 15;
  return vec3(m & uvec3(0xffffu)) / 65535.0 - 0.5;
}

vec3 crumble(vec3 wp, float dis) {
  if (dis <= 0.0) return wp;
  vec3 h = cellJitter(wp * 2.5 + uThing.w);
  float k = dis * dis;
  return wp + (h * vec3(1.7, 1.0, 1.7) + vec3(0.0, 0.8, 0.0)) * k * 1.5;
}
`;

/**
 * Облако точек. Мир показан не сплошными поверхностями, а точками-сплатами, как 3D-скан
 * (3D Gaussian Splatting): мягкие полупрозрачные диски лежат на поверхностях и, где их много,
 * сливаются в сплошную картинку. Сколько здесь «замеров», решает свет: в луче фонаря их много,
 * к краю луча меньше, в темноте остаются единицы.
 *
 * Работает это в два прохода. Первый рисует мир как обычно и кладёт в альфу кадра число замеров h
 * (в долях предела). Второй (SPLAT_*) рисует сами точки: каждая берёт из готового кадра цвет места,
 * на котором сидит, и его h — и по h решает, стоять ли на месте, лететь к нему или висеть в стороне.
 * Сама поверхность проявляется только там, где замеров хватило, чтобы сплаты слились (COMPOSE_FRAG).
 *
 * «Внимание скана» — луч фонаря с запаздыванием (uFocus*): точки собираются туда, куда оно уже
 * дошло, а место, с которого луч только что ушёл, ещё немного держится — тускло, без теней.
 */
export const SCAN_GLSL = /* glsl */ `
uniform vec4 uScan;       // x — h без света, y — h на единицу света, z — предел h, w — запас
uniform float uScanFade;  // 1 — пространство держится; меньше — редеет (его время выходит)
uniform vec2 uScanRange;  // докуда рассеянный свет «сканирует»: плотно до x, россыпь после y, м
`;

export const WORLD_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aMat;
uniform mat4 uShadowMatrix;
uniform float uTierDrop;
varying vec3 vWorld;
varying float vDis;
${CRUMBLE_GLSL}
varying vec3 vPosV;
varying vec3 vNrmV;
varying vec4 vColor;
varying float vMat;
varying vec2 vUv;
varying vec4 vShadow;
varying vec3 vSurf;   // x — стена (1) или пол с потолком (0); y — нормаль вверх; z — высота над полом яруса, м

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * normal);
  vWorld = wp.xyz;
  vDis = max(uDissolve, uThing.x);
  vec4 mv = viewMatrix * vec4(crumble(wp.xyz, vDis), 1.0);
  vPosV = mv.xyz;
  vNrmV = mat3(viewMatrix) * wn;
  vColor = aColor;
  vMat = aMat;
  vUv = uv;
  vSurf = vec3(1.0 - step(0.5, abs(wn.y)), wn.y, wp.y - floor((wp.y + 0.2) / uTierDrop) * uTierDrop);
  // Сдвиг по нормали убирает «рябь» самозатенения на стенах, в которые свет бьёт вскользь.
  vShadow = uShadowMatrix * vec4(wp.xyz + wn * 0.035, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * Мир. Поверхность собирается из трёх вещей: matcap-шара материала (как он блестит под фонарём),
 * фактуры (рельеф и пестрота из стопки текстур) и запустения — карты, по которой краска облезает
 * до штукатурки, металл ржавеет, бетон сыреет. Рельеф наклоняет нормаль, а с ней и выборку из
 * шара: стена под лучом, идущим вскользь, показывает каждую пору.
 */
export const WORLD_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
precision highp sampler2DArray;

uniform sampler2D uAtlas;
uniform sampler2D uGrime;
uniform sampler2DArray uDetail;
uniform sampler2D uSigns;
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
uniform vec3 uAmbient;
uniform vec3 uKeyDirV;    // прямой свет пространства: направление на источник (пространство камеры)
uniform vec3 uKeyColor;   // его цвет и сила; ноль — прямого света нет (убежище)
uniform float uShadowFor; // чья тень в карте теней: 0 — фонаря, 1 — прямого света пространства (солнце, лампа)
uniform vec4 uBounce;     // xyz — точка попадания луча (пространство камеры), w — сила отсвета
uniform sampler2D uSpot;  // средний цвет освещённого пятна в прошлом кадре: им окрашен отсвет
uniform float uFog;
uniform vec3 uFogColor;   // во что уходит даль: в убежище — чернота, в белом нигде — белое
uniform float uDecay;     // 0..1: насколько здесь сыро и запущено (растёт с глубиной); меньше нуля — чисто, как в офисе
uniform sampler2D uCellLight; // свет по клеткам уровня: r — сколько рассеянного света в клетке, g — номер помещения
uniform vec4 uCellGrid;       // xy — угол сетки в мире (x, z), z — шаг клетки, м, w — клеток по стороне (0 — света по клеткам нет)
uniform vec3 uLightRightV;
uniform vec3 uLightUpV;
// Материалов может быть до 48 (атлас шаров 8 × ATLAS_ROWS); сколько их на деле — знает world/materials.ts.
#ifndef ATLAS_ROWS
#define ATLAS_ROWS 4
#endif
uniform vec4 uMatA[48];   // грязь, свечение, слой фактуры, повторов фактуры на метр
uniform vec4 uMatB[48];   // рельеф (м), род запустения, проступающий материал, —
uniform vec3 uMatBase[48];

varying vec3 vPosV;
varying vec3 vNrmV;
varying vec4 vColor;
varying float vMat;
varying vec2 vUv;
varying vec4 vShadow;
varying vec3 vSurf;
varying vec3 vWorld;
varying float vDis;

${BEAM_GLSL}
${SCAN_GLSL}

/** Случайное число клетки мира (для дыр распада): целочисленный хеш, одинаковый на любом устройстве. */
float cellHash(vec3 p) {
  ivec3 q = ivec3(floor(p)) + 32768;
  uint n = uint(q.x) * 0x27d4eb2du ^ uint(q.y) * 0x165667b1u ^ uint(q.z) * 0x9e3779b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12; n *= 0x297a2d39u; n ^= n >> 15;
  return float(n & 0xffffu) / 65535.0;
}

/**
 * Свет потолочных панелей: у каждой клетки уровня свой. Внутри помещения он переходит от клетки
 * к клетке плавно, а на стене обрывается — соседнее помещение освещено по-своему.
 */
float cellLight(vec2 xz) {
  if (uCellGrid.w < 0.5) return 1.0;
  vec2 g = (xz - uCellGrid.xy) / uCellGrid.z;
  vec2 c = floor(g);
  vec2 f = g - c - 0.5;
  vec2 sgn = vec2(f.x < 0.0 ? -1.0 : 1.0, f.y < 0.0 ? -1.0 : 1.0);
  vec2 w = smoothstep(0.1, 0.5, abs(f)) * 0.5;
  float inv = 1.0 / uCellGrid.w;
  vec4 t0 = texture2D(uCellLight, (c + 0.5) * inv);
  vec4 tx = texture2D(uCellLight, (c + vec2(sgn.x, 0.0) + 0.5) * inv);
  vec4 tz = texture2D(uCellLight, (c + vec2(0.0, sgn.y) + 0.5) * inv);
  vec4 td = texture2D(uCellLight, (c + sgn + 0.5) * inv);
  // Соседи из другого помещения не в счёт: свет через стену не идёт. Смешение — билинейное по четырём
  // клеткам, чтобы на границе клеток не было шва (на границе вес ровно половина с обеих сторон).
  float lx = abs(tx.g - t0.g) < 0.002 ? tx.r : t0.r;
  float lz = abs(tz.g - t0.g) < 0.002 ? tz.r : t0.r;
  float ld = abs(td.g - t0.g) < 0.002 ? td.r : 0.5 * (lx + lz);
  return mix(mix(t0.r, lx, w.x), mix(lz, ld, w.x), w.y);
}

vec3 matcap(int m, vec3 N, vec3 bx, vec3 by) {
  vec2 muv = vec2(dot(bx, N), dot(by, N)) * 0.47 + 0.5;
  vec2 cell = vec2(float(m - (m / 8) * 8), float(m / 8));
  return texture2D(uAtlas, (cell + muv) * vec2(0.125, 1.0 / float(ATLAS_ROWS))).rgb;
}

/** Наклонить нормаль по высоте h (м): градиент берётся экранными производными, без касательных в вершинах. */
vec3 perturb(vec3 N, vec3 p, float h) {
  vec3 sx = dFdx(p);
  vec3 sy = dFdy(p);
  vec3 r1 = cross(sy, N);
  vec3 r2 = cross(N, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - grad);
}

void main() {
  // Распад: поверхность выгорает клетками по 9 см; кромка дыры светится красным.
  float burn = 0.0;
  if (vDis > 0.0) {
    float edge = cellHash(vWorld * 11.0) - (vDis * 1.2 - 0.1);
    if (edge < 0.0) discard;
    burn = smoothstep(0.14, 0.0, edge) * min(1.0, vDis * 4.0);
  }
  vec3 Ng = normalize(vNrmV);
  int mi = int(vMat + 0.5);
  vec4 ma = uMatA[mi];
  vec4 mb = uMatB[mi];
  int cls = int(mb.y + 0.5);
  int mj = int(mb.z + 0.5);
  float ao = vColor.a;
  float wall = vSurf.x;
  float up = vSurf.y;
  float hgt = vSurf.z;

  // Надписи и плакаты: uv указывает в атлас, а не в мир.
  vec3 ink = vec3(1.0);
  vec2 uvw = vUv;
  if (cls >= 6) {
    vec4 sg = texture2D(uSigns, vUv);
    if (cls == 7 && sg.a < 0.5) discard;
    if (cls == 6) ink = sg.rgb;
    uvw = vUv * 5.0;
  }

  vec4 lb = beamAt(vPosV);
  vec3 L = lb.xyz;
  float facing = smoothstep(-0.02, 0.1, dot(Ng, L));
  // Сила лампы без цвета: 1 — фонарь горит в полную силу.
  float lamp = uLightColor.r * (1.0 / 3.3);

  float shadow = 1.0;
#ifdef SHADOWS
  vec3 sc = vShadow.xyz / vShadow.w;
  if ((uShadowFor > 0.5 || lb.w * lamp * facing > 0.0008) && vShadow.w > 0.0 && sc.x > 0.002 && sc.x < 0.998 && sc.y > 0.002 && sc.y < 0.998 && sc.z < 1.0) {
    float z = sc.z - 0.0004;
    float t = uShadowTexel * 0.75;
    shadow = 0.25 * (
      texture(uShadowMap, vec3(sc.xy + vec2(-t, -t), z)) +
      texture(uShadowMap, vec3(sc.xy + vec2( t, -t), z)) +
      texture(uShadowMap, vec3(sc.xy + vec2(-t,  t), z)) +
      texture(uShadowMap, vec3(sc.xy + vec2( t,  t), z)));
  }
#endif

  // Карта теней одна: в убежище в ней тень фонаря, на лугу и в домике — тень солнца или лампы. Тень
  // прямого света есть только вокруг игрока: к краю своего квадрата она сходит на нет.
  float shadowKey = 1.0;
#ifdef SHADOWS
  if (uShadowFor > 0.5) {
    shadowKey = mix(shadow, 1.0, smoothstep(0.76, 0.98, 2.0 * max(abs(sc.x - 0.5), abs(sc.y - 0.5))));
    shadow = 1.0;
  }
#endif

  // Отсвет от освещённого пятна (без учёта наклона поверхности — он досчитается ниже).
  vec3 toB = uBounce.xyz - vPosV;
  float db = length(toB);
  float bounce0 = uBounce.w / (1.0 + 0.35 * db * db);
  // Свет, отражённый зелёной стеной, зеленит всё вокруг: оттенок отсвета — оттенок пятна.
  vec3 spot = texture2D(uSpot, vec2(0.5)).rgb;
  float spotMax = max(spot.r, max(spot.g, spot.b));
  vec3 bounceTint = spotMax > 0.004 ? mix(vec3(1.0), spot / spotMax, 0.8) : vec3(1.0);
  float maxc = max(vColor.r, max(vColor.g, vColor.b));

  // ── Облако точек: сколько здесь «замеров» ──
  // Свет фонаря, отсвет, собственное свечение и рассеянный свет пространства (он «сканирует» только
  // вблизи: в белом нигде и на лугу даль рассыпается на точки).
  float eLight = lb.w * shadow * facing * lamp;
  // Рассеянный свет здесь — свет потолочной панели этой клетки (где панелей нет, cell = 1).
  float cell = cellLight(vWorld.xz);
  vec3 amb = uAmbient * cell;
  float eAmb = dot(amb, vec3(0.3333));
  // Светильник светится, только пока свет в его клетке включён.
  float glowK = mi == 37 ? cell : 1.0;
  float eGlow = ma.y * maxc * glowK;
  float distV = length(vPosV);
  // Настоящий сканер хуже видит то, от чего луч не возвращается: поверхность, по которой он скользит,
  // стекло (луч уходит насквозь), чёрную резину и бакелит (луч гаснет), мокрый пол (луч отражается прочь).
  float toCam = abs(dot(Ng, vPosV)) / max(distV, 1e-3);
  // Белая матовая бумага — наоборот, лучший отражатель в убежище: плакат и лист на столе «сканируются»
  // плотнее стены вокруг, и печать на них читается раньше, чем проступает сама стена.
  float back = mix(0.6, 1.0, smoothstep(0.03, 0.4, toCam)) * (mi == 24 ? 0.35 : (mi == 7 || mi == 23 ? 0.6 : (mi == 12 ? 0.78 : (mi == 30 || mi == 15 ? 1.8 : 1.0))));
  // Прямой свет пространства тоже «сканирует»: освещённая сторона плотнее теневой.
  float keyLit = max(dot(Ng, uKeyDirV), 0.0) * dot(uKeyColor, vec3(0.3333)) * shadowKey;
  float hLit = (eLight + bounce0 * 1.2) * uScan.y * back;
  float hEnv = uScan.z * (min(1.0, eGlow * 4.0) + min(1.0, eAmb * 8.0) * (0.72 + 0.28 * min(1.0, keyLit * 3.0 + step(dot(uKeyColor, vec3(1.0)), 0.001))) * back * (1.0 - smoothstep(uScanRange.x, uScanRange.y, distV)));
  // Пространство, чьё время выходит, редеет; светящееся (красный контур выхода, небо) держится до конца.
  float hScan = min(uScan.z, max(uScan.x, hLit + hEnv)) * mix(mix(0.06, 1.0, uScanFade), 1.0, step(0.004, eGlow));
  // Число замеров уходит в альфу кадра: по нему следующий проход решает, показать ли саму поверхность
  // (в ядре луча, где сплаты слились) или только точки на ней.
  float hOut = 1.0;
#ifdef SCAN
  hOut = hScan / uScan.z;
  // Туда, где света почти нет, фактуры не нужны: поверхность — просто цвет материала.
  if (hLit < 0.1 && eGlow < 0.004 && eAmb < 0.02) {
    vec3 flat_ = uMatBase[mi] * vColor.rgb * ao;
    vec3 colG = flat_ * (amb * (0.66 + 0.34 * up) + uLightColor * (eLight * 0.45 + bounce0 * bounceTint));
    colG += vec3(0.9, 0.07, 0.03) * burn;
    gl_FragColor = vec4(mix(uFogColor, colG, exp(-uFog * distV)), hOut);
    return;
  }
#endif

  // Неровный отражатель дешёвого фонаря: пятно в разводах, в самой середине — тёмная точка.
  vec2 cuv = vec2(dot(-L, uLightRightV), dot(-L, uLightUpV));
  lb.w *= (0.84 + 0.32 * texture2D(uGrime, cuv * 1.7 + 0.5).g) * (1.0 - 0.2 * smoothstep(0.04, 0.0, length(cuv)));

  vec4 g1 = texture2D(uGrime, uvw * 0.29);
  vec4 d0 = texture(uDetail, vec3(uvw * ma.w, ma.z));
  float alb = 0.55 + 0.9 * d0.g;
  float H = d0.r * mb.x;
  float k = 0.0;      // доля проступающего материала
  float wet = 0.0;    // сырость: темнее и глянцевее
  float shade = 1.0;  // затемнение: кромки, трещины, плесень
  vec3 stain = vec3(1.0);
  float crev = 1.0 - ao;
  // Там, где чисто (запущенность меньше нуля — офис), сырости, пыли и потёков нет, а грязи вдесятеро меньше.
  float damp = clamp(1.0 + uDecay * 2.0, 0.0, 1.0);
  float grimeK = ma.x * mix(0.1, 1.0, damp);
  // Сырость поднимается от пола и копится под потолком.
  float low = wall * (1.0 - smoothstep(0.0, 0.7 + g1.g * 1.1, hgt)) * damp;
  float high = wall * smoothstep(1.8, 2.7, hgt + g1.r * 0.6) * damp;

  // На низком качестве вторая выборка карты и фактура изнанки заменены тем, что уже есть:
  // облезшая краска и ржавчина остаются, пропадают только рельеф и мелкая пестрота.
#ifdef DETAIL
  vec4 g2 = texture2D(uGrime, uvw * 1.31 + 0.37);
  vec4 d1 = texture(uDetail, vec3(uvw * uMatA[mj].w, uMatA[mj].z));
#else
  vec4 g2 = g1.brga;
  vec4 d1 = d0;
#endif
  // Чешуйки: краска и побелка отваливаются лоскутами, поэтому край облезшего места ломаный.
  vec4 fl = texture(uDetail, vec3(uvw * (cls == 1 ? 2.3 : 1.15), 16.0));
  if (cls == 1) {
    float p = g1.g * 0.5 + g2.g * 0.2 + low * 0.34 + high * 0.16 + crev * 0.25 + uDecay * 0.3 - 0.1 + (fl.r - 0.5) * 0.17;
    k = smoothstep(0.6, 0.606, p);
    // Перед кромкой краска ещё держится, но уже растрескалась и загнулась краями наружу.
    float front = smoothstep(0.47, 0.6, p) * (1.0 - k);
    H += front * (1.0 - smoothstep(0.0, 0.45, fl.g)) * 0.0045;
    shade *= 1.0 - (1.0 - smoothstep(0.0, 0.1, fl.g)) * front * 0.55;
  } else if (cls == 2) {
    // Металл: ржавчина идёт от швов и углов.
    float p = g1.g * 0.45 + g2.r * 0.25 + crev * 0.5 + uDecay * 0.3;
    k = smoothstep(0.62, 0.72, p);
    stain = mix(stain, vec3(0.9, 0.62, 0.42), smoothstep(0.5, 0.62, p) * (1.0 - k) * 0.6);
  } else if (cls == 3) {
    if (mj == 12) {
      // Бетон, пол, кирпич: пятна сырости, на полу — лужицами.
      wet = smoothstep(0.52, 0.8, g1.g * 0.75 + g2.g * 0.2 + uDecay * 0.5 + low * 0.7 + (1.0 - wall) * max(up, 0.0) * 0.12 - 0.3);
      // У стен на полу лежит то, что с них осыпалось: чешуйки краски и побелки.
      float chips = step(0.5, up) * step(0.66, fl.r) * smoothstep(0.08, 0.3, fl.g) * smoothstep(0.12, 0.42, crev + g2.r * 0.12);
      stain = mix(stain, vec3(1.75, 1.72, 1.6), chips * 0.75 * (1.0 - wet * 0.6));
      H += chips * 0.004;
    } else {
      // Побелка: отваливается пластами от сырых мест.
      float p = g1.g * 0.55 + g2.g * 0.2 + low * 0.4 + high * 0.1 + crev * 0.2 + uDecay * 0.3 - 0.16 + (fl.r - 0.5) * 0.14;
      k = smoothstep(0.62, 0.628, p);
      float front = smoothstep(0.5, 0.62, p) * (1.0 - k);
      H += front * (1.0 - smoothstep(0.0, 0.4, fl.g)) * 0.003;
      shade *= 1.0 - (1.0 - smoothstep(0.0, 0.08, fl.g)) * front * 0.35;
    }
    // Высолы: белёсая кайма там, где сырость высыхает.
    float eff = wall * (1.0 - smoothstep(0.0, 0.28, abs(hgt - 0.35 - g1.g * 0.9))) * g2.r * max(0.25 + uDecay, 0.0);
    stain = mix(stain, vec3(1.5, 1.48, 1.42), eff * 0.5 * (1.0 - k));
  } else if (cls == 4) {
    // Дерево, ткань, бумага: темнеют от сырости.
    shade *= 1.0 - 0.45 * smoothstep(0.45, 0.8, g1.g + uDecay * 0.4 + low * 0.5 - 0.1);
  }
  // Плесень: тёмные пятна в углах и под потолком.
  float mold = smoothstep(0.8, 0.96, g2.g * 0.5 + g1.r * 0.25 + crev * 0.45 + high * 0.25 + uDecay * 0.42) * step(0.5, float(cls)) * (1.0 - step(4.5, float(cls)));
  stain *= mix(vec3(1.0), vec3(0.3, 0.36, 0.25), mold * 0.85);
  // Нижний ярус: по стенам, полу и потолку ползёт чёрная поросль — следы роя. Тонкие извилистые
  // жилы и редкие «гнёзда» в углах; мокрая, чуть выпуклая.
  float deep = smoothstep(0.62, 0.84, uDecay) * (1.0 - step(5.5, float(cls)));
  float vein = 1.0 - smoothstep(0.0, 0.012 + 0.03 * g2.g, abs(g1.g - 0.52 + (g2.r - 0.5) * 0.14));
  float nest = smoothstep(0.8, 0.92, g1.r * 0.55 + g2.g * 0.45 + crev * 0.35);
  float slime = max(vein * smoothstep(0.35, 0.6, g1.r + crev * 0.5), nest) * deep;
  stain *= mix(vec3(1.0), vec3(0.045, 0.05, 0.045), slime);
  wet = max(wet, slime * 0.9);
  H += slime * 0.006;
  // Потёки по стенам.
  shade *= 1.0 - wall * smoothstep(0.55, 0.9, g1.b) * max(0.22 + 0.3 * uDecay, 0.0) * grimeK;
  alb = mix(alb, 0.55 + 0.9 * d1.g, k);
#ifdef DETAIL
  H = mix(H, d1.r * uMatB[mj].x - 0.002, k);
  vec3 N = perturb(Ng, vPosV, H);
  float dirt = mix(1.0, (0.62 + 0.5 * g2.r) * (0.8 + 0.4 * g1.g), grimeK);
#else
  vec3 N = Ng;
  float dirt = mix(1.0, 0.72 + 0.56 * g1.r, grimeK);
#endif

  // Matcap по направлению на фонарь.
  vec3 bx = normalize(vec3(L.z, 0.0, -L.x) + vec3(1e-5, 0.0, 0.0));
  vec3 by = cross(L, bx);
  vec3 mc = matcap(mi, N, bx, by);
  vec3 base = uMatBase[mi];
  vec3 mc2 = matcap(mj, N, bx, by);
  mc = mix(mc, mc2, max(k, wet * 0.85));
  base = mix(base, uMatBase[mj], max(k, wet * 0.85));
#ifdef DETAIL
  // Рельеф под лучом: чем сильнее свет скользит по поверхности, тем резче тени пор и кромок.
  float ngl = dot(Ng, L);
  float relief = clamp(dot(N, L) / max(ngl, 0.08), 0.0, 2.2);
  shade *= mix(1.0, relief, 0.8 * smoothstep(0.02, 0.22, ngl));
  shade *= 0.86 + 0.14 * d0.b;
#endif
  // То, что проступило из-под краски, годами стояло сырым: оно серее и грязнее свежей поверхности.
  // У светящегося материала оттенок вершины — множитель яркости свечения (до сотен): в освещение он
  // идёт приведённым к единице, иначе рассеянный свет выбелил бы небо и экраны.
  vec3 vc = vColor.rgb;
  float lit = 1.0;
  if (mi == 14 || mi == 37) {
    vc /= max(1.0, max(vc.r, max(vc.g, vc.b)));
    lit = 0.0;
  }
  vec3 tint = vc * ink * stain * (dirt * alb * mix(1.0, 0.55, wet) * mix(1.0, 0.62 + 0.2 * g1.r, k * step(0.5, 1.5 - abs(float(cls) - 1.0))));
  vec3 surf = mc * tint * shade;
  // Пыль на всём, что лежит выше пола и смотрит вверх.
  float dust = smoothstep(0.6, 0.95, up) * smoothstep(0.06, 0.2, hgt) * (0.35 + 0.4 * g1.g) * (1.0 - wet) * damp;
  surf = mix(surf, vec3(0.4, 0.38, 0.34) * pow(max(dot(N, L), 0.0), 0.6) * shade, dust);

  vec3 col = surf * uLightColor * (lb.w * shadow * facing * mix(1.0, ao, 0.75));

  // Отсвет от освещённого пятна: мягко подсвечивает окрестности, как рассеянный от стены свет.
  float bounce = bounce0 * (0.35 + 0.65 * max(dot(N, toB / max(db, 1e-3)), 0.0));
  // Рассеянный свет пространства идёт больше сверху (небо, потолок), чем снизу; прямой — от солнца или лампы.
  vec3 skyLit = amb * (0.66 + 0.34 * up) + uKeyColor * (max(dot(N, uKeyDirV), 0.0) * shadowKey);
  col += base * tint * ao * (skyLit * lit + uLightColor * bounceTint * bounce);

  // Мокрый пол и плитка отражают освещённое пятно: блик тянется от дальней стены к ногам.
  float gloss = max(wet, mi == 12 ? 1.0 : (mi == 18 ? 0.5 : 0.0)) * step(0.5, up);
  vec3 R = reflect(normalize(vPosV), N);
  col += uLightColor * (uBounce.w * 16.0 * gloss * pow(max(dot(R, toB / max(db, 1e-3)), 0.0), 48.0)) * (0.6 + 0.4 * d0.b);

  // Свечение. У фосфорных табличек (оттенок до 1) цвет даёт основа материала; у экранов, окон и неба
  // оттенок вершины больше единицы — он и есть цвет, помноженный на яркость (основа тогда серая).
  vec3 glowBase = maxc > 1.5 ? vec3(0.55) : uMatBase[mi];
  col += glowBase * ma.y * vColor.rgb * glowK;
  col += vec3(0.9, 0.07, 0.03) * burn;
  col = mix(uFogColor, col, exp(-uFog * distV));
  gl_FragColor = vec4(col, hOut);
}
`;

/**
 * Красная полигонная сетка: рёбра той же геометрии отдельными линиями. Светится сама, фонарь ей не
 * нужен — в полной темноте видна только она. Распадается вместе с миром.
 */
export const WIRE_VERT = /* glsl */ `
varying float vDist;
${CRUMBLE_GLSL}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * vec4(crumble(wp.xyz, max(uDissolve, uThing.x)), 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  // Чуть к камере, чтобы линия не тонула в своей же поверхности.
  gl_Position.z -= 0.0012 * gl_Position.w;
}
`;

export const WIRE_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uWireColor;
uniform float uWireAlpha;
uniform float uTime;
varying float vDist;

void main() {
  float pulse = 0.78 + 0.22 * sin(uTime * 4.3 - vDist * 1.9);
  gl_FragColor = vec4(uWireColor * (uWireAlpha * pulse * exp(-vDist * 0.045)), 1.0);
}
`;

/** Глубина из точки фонаря: цвет не пишется. */
export const DEPTH_VERT = /* glsl */ `
attribute float aMat;
void main() {
  // Светящееся (небо над лугом, абажуры, красный контур выхода) тени не отбрасывает: иначе купол неба
  // закрыл бы от солнца весь луг.
  if (aMat > 13.5 && aMat < 14.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
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
uniform float uBoost;     // 0..1: мир рассыпается — пыль видна и без луча, летит вверх
varying float vLight;

${BEAM_GLSL}

void main() {
  const vec3 box = vec3(7.0, 3.2, 7.0);
  vec3 p = aSeed * box;
  p += vec3(sin(uTime * 0.11 + aSeed.y * 40.0), uTime * (0.02 + 0.9 * uBoost) + cos(uTime * 0.07 + aSeed.x * 31.0) * 0.3, cos(uTime * 0.09 + aSeed.z * 23.0)) * 0.25;
  // Облако бесконечно: точки заворачиваются вокруг камеры.
  p = mod(p - uCamPos + box * 0.5, box) - box * 0.5 + uCamPos;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vLight = max(beamAt(mv.xyz).w, uBoost * 0.35) * smoothstep(0.25, 0.9, dist) * (0.4 + 0.6 * fract(aSeed.x * 91.7));
  gl_PointSize = clamp(uPointScale * (0.6 + fract(aSeed.z * 57.3)) / max(dist, 0.2), 1.0, 5.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const DUST_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uLightColor;
uniform highp float uBoost;
varying float vLight;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(max(uLightColor, vec3(uBoost)) * vLight * a * 0.16, 1.0);
}
`;

/**
 * Осыпь — сущность (в коде — рой). Она сделана из того же, из чего мир: из точек. Тело — сотня
 * прядей (их головы и направления считает swarm/body.ts), вдоль каждой пряди расставлены точки.
 *
 * В темноте пряди рыхлые: точки висят вокруг оси, дрожат и светятся тускло и холодно — Осыпь видна
 * и без света, она и есть то, что остаётся в темноте. Под лучом фонаря точки стягиваются к оси
 * («свет держит её») и берут свет, как любая поверхность: фигура становится плотной и яркой.
 * Часть точек помнит цвет мест, с которых осыпалась, — охру, зелёную краску, ржавчину.
 * Рисуется тем же проходом и той же формой, что точки мира (SPLAT_FRAG); за стеной её не видно.
 */
export const ENTITY_VERT = /* glsl */ `
attribute vec4 aRnd;        // x — место вдоль пряди 0..1, yzw — случайные числа точки
attribute vec3 iHead;
attribute vec3 iDir;
attribute vec2 iParam;      // зерно пряди и её длина
uniform highp sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uTime;
uniform float uSize;        // размер точки в мире, м
uniform float uProj;        // пикселей буфера на метр на расстоянии в метр
uniform float uMaxPx;
uniform float uAlpha;       // 0 — Осыпи нет
uniform float uDarkGain;    // яркость свечения в темноте (не растёт вместе с усилением камеры)
uniform vec4 uGhost;        // призрак из-за спины: xyz — взгляд по горизонтали (мир), w — 1, если это он
uniform vec3 uLightPosV;
uniform vec3 uLightDirV;
uniform vec3 uLightColor;
uniform vec4 uCone;
varying vec4 vCol;
varying vec3 vShape;

float linDepth(float d) {
  return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}

void main() {
  vCol = vec4(0.0);
  vShape = vec3(1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (uAlpha <= 0.004) return;

  // Ось пряди: голова, за ней хвост, который вьётся.
  float t = aRnd.x;
  vec3 d = normalize(iDir + vec3(1e-4, 2e-4, 0.0));
  vec3 up = abs(d.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(d, up));
  vec3 up2 = cross(side, d);
  float seed = iParam.x;
  float len = iParam.y * 1.5;
  float ph = t * 9.0 - uTime * (6.0 + seed * 3.0) + seed * 40.0;
  float amp = 0.07 * len * (0.25 + t);
  vec3 axis = iHead - d * (t * len) + side * sin(ph) * amp + up2 * cos(ph * 0.7 + seed * 11.0) * amp * 0.6;

  // Сколько света фонаря приходит в это место (конус и затухание, без теней).
  vec3 av = (viewMatrix * vec4(axis, 1.0)).xyz;
  vec3 toL = uLightPosV - av;
  float dl = length(toL);
  float cosA = dot(-toL / max(dl, 1e-4), uLightDirV);
  float beam = (smoothstep(uCone.y, uCone.x, cosA) * 0.78 + smoothstep(uCone.z, uCone.y, cosA) * 0.19 + smoothstep(uCone.w, uCone.z, cosA) * 0.03) / (1.0 + 0.07 * dl * dl);
  float held = smoothstep(0.03, 0.5, beam * dot(uLightColor, vec3(0.3333)));

  // Точка вокруг оси: в темноте рыхло и дрожит, под светом стянута и стоит.
  vec3 rnd = aRnd.yzw * 2.0 - 1.0;
  float tw = uTime * (0.8 + aRnd.z) + aRnd.y * 6.2832;
  vec3 wob = vec3(sin(tw), sin(tw * 1.3 + 1.7), cos(tw * 0.9));
  float loose = mix(0.17, 0.035, held);
  vec3 p = axis + (side * rnd.x + up2 * rnd.y + d * rnd.z * 0.6) * loose + wob * (loose * 0.35 * (1.0 - held));

  // Призрак: Осыпь позади, и её тело отражено вперёд — как в зеркале, стоящем поперёк взгляда.
  // Он виден сквозь стены, дрожит и разбит на строки: это не она, а знание о том, что она за спиной.
  bool ghost = uGhost.w > 0.5;
  if (ghost) {
    float back = dot(p - cameraPosition, uGhost.xyz);
    if (back > -0.3) return;
    p -= 2.0 * back * uGhost.xyz;
    float row = floor(p.y * 14.0 + uTime * 3.0);
    p += vec3(-uGhost.z, 0.0, uGhost.x) * (fract(sin(row * 12.9898 + floor(uTime * 12.0) * 78.233) * 43758.5453) - 0.5) * 0.16;
  }

  vec4 pv = viewMatrix * vec4(p, 1.0);
  vec4 pc = projectionMatrix * pv;
  if (pc.w <= 0.0) return;
  vec2 uv = pc.xy / pc.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;
  // За стеной её не видно. Призрак виден и сквозь стены.
  if (!ghost && -pv.z > linDepth(texture2D(tDepth, uv).r) + 0.02) return;
  // Строки развёртки: каждая вторая полоса призрака пуста.
  if (ghost && fract(uv.y * 90.0 + uTime * 0.7) < 0.45) return;

  float px = uSize * uProj / max(-pv.z, 0.05) * mix(0.8, 1.2, held);
  float alpha = uAlpha * (0.5 + 0.5 * aRnd.w) * (1.0 - 0.5 * t);
  if (px < 1.6) {
    alpha *= px * px / 2.56;
    px = 1.6;
  }
  gl_PointSize = min(px, uMaxPx);

  // Цвет. Большинство точек — выцветшие, цвета кости; часть помнит краски мест, с которых осыпалась.
  float k = fract(aRnd.w * 7.0 + seed * 3.0);
  vec3 tint = k < 0.6 ? vec3(0.85, 0.82, 0.75) : (k < 0.75 ? vec3(0.78, 0.56, 0.3) : (k < 0.9 ? vec3(0.36, 0.56, 0.42) : vec3(0.72, 0.3, 0.22)));
  vec3 dark = vec3(0.62, 0.72, 0.9) * ((0.07 + 0.07 * aRnd.w) * uDarkGain);
  vCol = vec4(dark + uLightColor * (beam * 0.42) * tint, alpha);
  // Призрак — цвета красной сетки: знак системы, а не вещь мира. Свет фонаря на него не ложится.
  if (ghost) vCol = vec4(vec3(0.95, 0.16, 0.08) * (0.5 * uDarkGain), alpha);
  gl_Position = pc;
}
`;

/**
 * Дымка в луче: для каждой точки кадра идём от камеры до стены и складываем свет фонаря, рассеянный
 * сырым воздухом. Луч становится виден как конус, предметы режут его тенями. Считается в буфере
 * в несколько раз меньше кадра; шаг сдвигается шумом, чтобы вместо ступеней было зерно.
 */
export const HAZE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;

uniform sampler2D tDepth;
uniform sampler2D uGrime;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrixV;   // пространство камеры → карта тени
uniform mat3 uCamRot;          // пространство камеры → мир (для клубов, привязанных к месту)
uniform vec3 uCamPos;
uniform vec2 uTan;             // тангенсы половин углов обзора
uniform vec2 uNearFar;
uniform float uDensity;
uniform float uFrame;
uniform float uTime;

varying vec2 vUv;

${BEAM_GLSL}

float hash(uvec2 p, uint s) {
  uint h = p.x * 0x27d4eb2du ^ p.y * 0x165667b1u ^ s * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du;
  h ^= h >> 12; h *= 0x297a2d39u;
  h ^= h >> 15;
  return float(h) * (1.0 / 4294967296.0);
}

void main() {
  float ndc = texture2D(tDepth, vUv).r * 2.0 - 1.0;
  float zv = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - ndc * (uNearFar.y - uNearFar.x));
  vec3 ray = vec3((vUv * 2.0 - 1.0) * uTan, -1.0);
  float tMax = min(zv, 16.0);
  float dt = tMax / float(HAZE_STEPS);
  float jit = hash(uvec2(gl_FragCoord.xy), uint(uFrame));
  float sum = 0.0;
  for (int i = 0; i < HAZE_STEPS; i++) {
    vec3 p = ray * ((float(i) + jit) * dt);
    float b = beamAt(p).w;
#ifdef HAZE_SHADOW
    vec4 sc = uShadowMatrixV * vec4(p, 1.0);
    vec3 sp = sc.xyz / sc.w;
    if (sc.w > 0.0 && sp.x > 0.002 && sp.x < 0.998 && sp.y > 0.002 && sp.y < 0.998 && sp.z < 1.0) b *= texture(uShadowMap, vec3(sp.xy, sp.z - 0.0008));
#endif
    // Клубы: воздух неоднороден и медленно ползёт.
    vec3 w = uCamRot * p + uCamPos;
    float wisp = textureLod(uGrime, w.xz * 0.09 + vec2(uTime * 0.006, w.y * 0.13), 0.0).g;
    // У самого объектива взвесь не видна: иначе луч засвечивает весь кадр.
    sum += b * (0.35 + 1.3 * wisp) * smoothstep(0.25, 1.6, length(p));
  }
  gl_FragColor = vec4(uLightColor * (sum * dt * uDensity), 1.0);
}
`;

/**
 * Цвет освещённого пятна: среднее по кадру вокруг точки, куда бьёт луч (уменьшенные копии кадра
 * плюс пять выборок — на случай, когда копий нет). Пишется в буфер 2×2, мир читает его в следующем
 * кадре. Луча в кадре нет — пишется нейтральный серый.
 */
export const SPOT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec3 uBeam;   // xy — точка на экране, z > 0 — луч в кадре
uniform float uLod;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.5);
  if (uBeam.z > 0.0) {
    vec2 r = vec2(0.045 / uAspect, 0.045);
    c = textureLod(tScene, uBeam.xy, uLod).rgb * 0.4
      + 0.15 * (textureLod(tScene, uBeam.xy + vec2(r.x, 0.0), uLod).rgb + textureLod(tScene, uBeam.xy - vec2(r.x, 0.0), uLod).rgb
              + textureLod(tScene, uBeam.xy + vec2(0.0, r.y), uLod).rgb + textureLod(tScene, uBeam.xy - vec2(0.0, r.y), uLod).rgb);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Сплаты: точки, из которых собран мир. Каждая — мягкий полупрозрачный диск, лежащий на своей
 * поверхности (сбоку он виден эллипсом, как сплат в 3D Gaussian Splatting). У точки два состояния:
 * на месте (поверхность «собрана») и в разлёте (висит рядом и медленно кружит). Между ними её ведёт
 * число замеров места, на котором она сидит, и «внимание скана»; пока точка летит, она отходит дальше.
 * Всё считается в вершинном шейдере: на процессоре точки не двигаются.
 *
 * Цвет точки — цвет её места в готовом кадре мира (tScene): у сплата один цвет на весь диск. Там,
 * где поверхность уже проявилась сама, точки в ней растворяются. Точка, оказавшаяся за стеной,
 * не рисуется (глубина готового кадра — tDepth).
 */
export const SPLAT_VERT = /* glsl */ `
attribute vec4 aNrm;        // xyz — нормаль поверхности, на которой сидит точка
attribute vec4 aSeed;       // x — очередь (кто появляется раньше), yzw — случайные числа точки
uniform sampler2D tScene;   // готовый кадр мира: rgb — цвет места, a — число замеров (в долях предела)
uniform highp sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uTime;
uniform float uSize;        // размер сплата в мире, м
uniform float uProj;        // пикселей буфера на метр на расстоянии в метр
uniform float uMaxPx;       // больше этого сплат на экране не бывает
uniform float uLodDist;     // до этого расстояния точки стоят в полную плотность, дальше редеют
uniform float uFar;         // дальше этого точек нет: к нему они гаснут
uniform sampler2D tMem;     // память света: rgb — каким место было при свете, a — свежесть (1 — только что)
uniform vec3 uMemColor;     // во что остывает цвет точки, пока память стареет
uniform float uMemGain;     // яркость точек памяти: не растёт, когда камера в темноте поднимает усиление
uniform float uAmbientScan; // 0..1: пространство «сканирует» рассеянный свет, фонарь для сборки не нужен
uniform float uHMax;
uniform vec4 uCone;
uniform float uDissolve;
uniform float uSeedW;
uniform vec3 uFocusPosV;
uniform vec3 uFocusDirV;
uniform float uFocusOn;
varying vec4 vCol;          // rgb — цвет, a — непрозрачность
varying vec3 vShape;        // xy — ось сжатия на экране, z — во сколько раз диск сжат вдоль неё

vec3 cellJitter(vec3 p) {
  ivec3 q = ivec3(floor(p)) + 32768;
  uint n = uint(q.x) * 0x27d4eb2du ^ uint(q.y) * 0x165667b1u ^ uint(q.z) * 0x9e3779b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12;
  uvec3 m = uvec3(n, n * 0x297a2d39u, n * 0x85ebca6bu);
  m ^= m >> 15;
  return vec3(m & uvec3(0xffffu)) / 65535.0 - 0.5;
}

/** Тот же распад, что у поверхностей (CRUMBLE_GLSL): когда мир рассыпается, точки уходят вместе с ним. */
vec3 crumble(vec3 wp, float dis) {
  if (dis <= 0.0) return wp;
  vec3 h = cellJitter(wp * 2.5 + uSeedW);
  float k = dis * dis;
  return wp + (h * vec3(1.7, 1.0, 1.7) + vec3(0.0, 0.8, 0.0)) * k * 1.5;
}

float linDepth(float d) {
  return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}

void main() {
  vCol = vec4(0.0);
  vShape = vec3(1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * aNrm.xyz);
  vec3 home = crumble(wp.xyz, uDissolve);
  vec4 hv = viewMatrix * vec4(home, 1.0);
  float dist = length(hv.xyz);
  float rank = aSeed.x;

  // Дальние точки редеют: на экране их и так хватает. Самая дешёвая проверка — первой.
  float lod = clamp(uLodDist * uLodDist / (dist * dist), 0.015, 1.0);
  if (rank > lod || dist >= uFar) return;

  // Что известно о месте, где сидит точка: его цвет и число замеров — из готового кадра мира.
  vec4 hc = projectionMatrix * hv;
  vec2 huv = hc.xy / max(hc.w, 1e-4) * 0.5 + 0.5;
  float h = 0.0;
  float fresh = 0.0;
  vec3 col = vec3(0.0);
  vec3 kept = vec3(0.0);
  if (hc.w > 0.0 && huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) {
    float zs = linDepth(texture2D(tDepth, huv).r);
    if (abs(zs + hv.z) < 0.035 * dist + 0.05) {
      vec4 sc = texture2D(tScene, huv);
      h = sc.a * uHMax;
      col = sc.rgb;
      vec4 mem = texture2D(tMem, huv);
      fresh = mem.a;
      kept = mem.rgb;
    }
  }

  // Кто виден при свете: чем больше замеров, тем больше точек. Без света точек нет.
  float hk = smoothstep(0.02, 0.5, h);
  float want = min(lod, hk);
  float aLit = want > 0.0 ? 1.0 - smoothstep(want * 0.7, want, rank) : 0.0;

  // Память света: место, с которого свет ушёл, ещё держится точками. У каждой точки свой срок: пока
  // свежесть памяти выше её порога, точка стоит на поверхности. Срок выходит — точка отпускает
  // поверхность (relax), потом осыпается и гаснет (dying). Свежесть убывает ровно, пороги у точек
  // разные — поэтому место редеет постепенно, зерно за зерном, пока не исчезнет совсем.
  // Порог — та же очередь, по которой точки появляются при свете: кто пришёл последним, уходит первым.
  // Поэтому в миг, когда свет ушёл, на месте остаются те же точки, а редея, россыпь остаётся ровной.
  float life = fresh - 0.94 * rank / lod;
  float relax = 1.0 - clamp(life / 0.5, 0.0, 1.0);
  float dying = 1.0 - clamp(life / 0.18, 0.0, 1.0);
  float aMem = life > 0.0 ? 1.0 - dying * dying : 0.0;

  float alpha = max(aLit, aMem);
  // Там, где поверхность уже проявилась сама, точки в ней растворяются. И к пределу дальности гаснут.
  alpha *= (1.0 - smoothstep(0.8 * uHMax, 0.98 * uHMax, h)) * (1.0 - smoothstep(0.7 * uFar, uFar, dist));
  if (alpha <= 0.004) return;

  // Сборка: замеров хватает и внимание скана уже здесь — точка стоит на своём месте.
  vec3 toF = uFocusPosV - hv.xyz;
  float cone = uFocusOn * smoothstep(uCone.w, mix(uCone.w, uCone.z, 0.7), dot(-normalize(toF), uFocusDirV));
  float a = hk * mix(cone, 1.0, uAmbientScan);
  // Насколько точку держит память: свежая — на месте, с истекающим сроком — отпущена.
  float held = life > 0.0 ? 1.0 - relax : 0.0;
  float s = (1.0 - a) * (1.0 - held);

  // Разлёт: вне сборки точка висит у своей поверхности и медленно кружит; пока летит к месту — отходит дальше.
  float t = uTime * (0.25 + 0.35 * aSeed.z) + aSeed.y * 6.2832;
  vec3 swirl = vec3(sin(t + wp.y * 2.1), sin(t * 0.8 + wp.x * 1.7 + 1.3), cos(t * 1.1 + wp.z * 1.9));
  vec3 rnd = aSeed.yzw * 2.0 - 1.0;
  float rest = 0.015 + 0.09 * aSeed.w;
  float burst = 4.0 * a * (1.0 - a) * (0.1 + 0.26 * aSeed.z);
  // Осыпание: чем меньше осталось срока, тем дальше точка съезжает вниз, как песок со стены (каждая
  // третья всплывает, как пыль), и уходит от взгляда. Место без света не гаснет, а оплывает и
  // осыпается. Под светом этого нет.
  float drop = relax * relax * (1.0 - aLit);
  vec3 slip = (vec3(0.0, (aSeed.w < 0.33 ? 0.35 : -1.0) * (0.2 + 0.75 * aSeed.z), 0.0) + normalize(wp.xyz - cameraPosition) * 0.25 + swirl * 0.22) * drop;
  vec3 p = home + wn * (rest * s + burst) + rnd * (0.04 * s + burst * 0.55) + swirl * (0.018 * s + 0.05 * burst) + slip;

  vec4 pv = viewMatrix * vec4(p, 1.0);
  vec4 pc = projectionMatrix * pv;
  if (pc.w <= 0.0) return;
  // За стеной точки не видно.
  vec2 puv = clamp(pc.xy / pc.w * 0.5 + 0.5, 0.001, 0.999);
  float zp = linDepth(texture2D(tDepth, puv).r);
  if (-pv.z > zp * 1.03 + 0.03) return;

  // Размер: в мире сплат постоянный, поэтому вблизи он крупнее. Дальние точки реже и потому крупнее —
  // на экране их размер перестаёт уменьшаться. Точка в разлёте мельче.
  float px = uSize * uProj / min(max(-pv.z, 0.05), uLodDist) * mix(1.0, 0.72, s) * (1.0 - 0.4 * drop);
  if (px < 1.6) {
    alpha *= px * px / 2.56;
    px = 1.6;
  }
  gl_PointSize = min(px, uMaxPx);

  // Диск лежит на поверхности: сбоку он виден эллипсом, сжатым вдоль нормали. В разлёте он круглый.
  vec3 nv = mat3(viewMatrix) * wn;
  vec3 vd = normalize(pv.xyz);
  float cosv = abs(dot(nv, vd));
  vec2 ax = nv.xy - vd.xy * dot(nv, vd);
  float al = length(ax);
  vShape = vec3(al > 1e-4 ? ax / al : vec2(1.0, 0.0), mix(1.0, max(cosv, 0.32), max(a, held)));

  // Цвет при свете — цвет места под точкой, но не темнее отметки скана: на краю луча поверхность
  // освещена слабо, а точка должна читаться. Оттенок при этом остаётся оттенком поверхности.
  const vec3 W = vec3(0.3, 0.59, 0.11);
  float lum = max(dot(col, W), 1e-3);
  float lift = clamp((0.06 + 0.2 * smoothstep(0.0, 1.6, h)) / lum, 1.0, 7.0);
  vec3 lit = col * mix(lift, 1.0, smoothstep(1.6, 3.0, h));
  // Цвет в памяти — оттенок, каким место было при свете; яркость — по свежести и по тому, насколько
  // ярким место запомнилось: середина луча держится в памяти ярче его краёв. Старея, точка остывает
  // и тускнеет.
  float was = dot(kept, W);
  vec3 hue = kept / max(was, 0.02);
  vec3 old = mix(uMemColor, hue, 0.3 + 0.7 * fresh) * ((0.04 + (0.16 + 0.6 * smoothstep(0.03, 0.7, was)) * fresh * sqrt(fresh)) * uMemGain);
  // Что ярче: в полутьме сразу после света точка не должна провалиться в черноту.
  vCol = vec4(max(old * aMem, lit * smoothstep(0.0, 0.3, hk)), alpha);
  gl_Position = pc;
}
`;

export const SPLAT_FRAG = /* glsl */ `
precision mediump float;
varying vec4 vCol;
varying vec3 vShape;

void main() {
  vec2 q = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * 2.0 - 1.0;
  float u = dot(q, vShape.xy) / vShape.z;
  float v = dot(q, vec2(-vShape.y, vShape.x));
  float r2 = u * u + v * v;
  if (r2 > 1.0) discard;
  // Гауссов профиль: середина плотная, к краю сплат тает — соседние сплаты сливаются без швов.
  float g = (exp(-r2 * 3.4) - 0.0334) / 0.9666;
  float al = vCol.a * g;
  gl_FragColor = vec4(vCol.rgb * al, al);
}
`;

/**
 * Память света. Мир существует, пока на него светят: место, с которого свет ушёл, ещё несколько
 * секунд держится в памяти — и по ней точки стоят на своих местах, а потом осыпаются (SPLAT_VERT).
 *
 * Память хранится в кадре, а не в мире: rgb — каким место было при свете, a — свежесть (1 — свет
 * здесь, 0 — забыто). Каждый кадр она переносится на новое положение камеры: по глубине пикселя
 * находится его точка в мире и её место в прошлом кадре. Если там было что-то другое (другая
 * глубина) или это место было за кадром — памяти нет. То, от чего отвернулись, забыто сразу.
 */
export const MEMORY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;            // кадр мира: rgb — цвет, a — число замеров (в долях предела)
uniform highp sampler2D tDepth;
uniform sampler2D tPrev;             // память прошлого кадра
uniform highp sampler2D tPrevDepth;  // глубина прошлого кадра
uniform mat4 uReproj;                // из экранных координат этого кадра — в экранные прошлого
uniform vec2 uNearFar;
uniform float uDecay;                // сколько свежести уходит за этот кадр
uniform float uHMax;                 // предел числа замеров
uniform float uKeep;                 // 0 — прошлого нет (первый кадр, другое место): забыть всё
uniform float uFrame;
varying vec2 vUv;

float lin(float d) {
  return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}

float hash(uvec2 p, uint s) {
  uint h = p.x * 0x27d4eb2du ^ p.y * 0x165667b1u ^ s * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du;
  h ^= h >> 12; h *= 0x297a2d39u;
  h ^= h >> 15;
  return float(h) * (1.0 / 4294967296.0);
}

void main() {
  vec4 sc = texture2D(tScene, vUv);
  float d = texture2D(tDepth, vUv).r;
  vec4 mem = vec4(0.0);
  if (uKeep > 0.5 && d < 0.99999) {
    vec4 p = uReproj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    if (p.w > 0.0) {
      vec3 q = p.xyz / p.w * 0.5 + 0.5;
      if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && q.z > 0.0 && q.z < 1.0) {
        float was = lin(texture2D(tPrevDepth, q.xy).r);
        float now = lin(q.z);
        if (abs(was - now) < 0.03 * now + 0.05) mem = texture2D(tPrev, q.xy);
      }
    }
  }
  // Свежесть хранится с шагом 1/255, а за кадр её уходит меньше шага. Поэтому убыль — целое число
  // шагов, выбранное случайно так, чтобы в среднем выходило ровно сколько нужно, при любой частоте кадров.
  float steps = uDecay * 255.0;
  float lose = (floor(steps) + (hash(uvec2(gl_FragCoord.xy), uint(uFrame)) < fract(steps) ? 1.0 : 0.0)) / 255.0;
  float fresh = max(mem.a - lose, 0.0);
  vec3 col = fresh > 0.004 ? mem.rgb : vec3(0.0);
  // Свет обновляет память, и тем крепче, чем он ярче. Мера та же, по которой при свете видны точки
  // (SPLAT_VERT): сколько их было видно — столько и помнится. Пока место освещено не слабее, чем
  // помнится, в памяти — его нынешний цвет: под ровным светом панелей оно не «выгорает» случайной
  // вспышкой. Когда свет уходит, помнится самый яркий цвет: луч, уходя, тускнеет, а место остаётся
  // в памяти таким, каким было в его середине.
  float lit = smoothstep(0.02, 0.5, sc.a * uHMax);
  const vec3 W = vec3(0.3, 0.59, 0.11);
  if (lit > 0.0 && (lit >= fresh - 0.02 || dot(sc.rgb, W) >= dot(col, W))) col = sc.rgb;
  gl_FragColor = vec4(col, max(fresh, lit));
}
`;

/**
 * Длинная выдержка. Без фонаря камера «не закрывает затвор»: всё яркое в кадре оставляет след,
 * и при повороте головы пространство смазывается, как на снимке с долгой выдержкой. Кадр — это
 * новая картинка поверх остывающей прошлой; при свете прошлой нет вовсе (uKeep = 0).
 */
export const TRAIL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tNow;    // кадр без выдержки: поверхности и точки
uniform sampler2D tPrev;   // прошлый кадр — уже со следами
uniform float uKeep;       // какая доля яркости прошлого кадра остаётся (0 — выдержки нет)
varying vec2 vUv;

void main() {
  vec3 now = texture2D(tNow, vUv).rgb;
  // Малый вычет — чтобы след гас до конца, а не застревал на шаге 1/255.
  vec3 was = max(texture2D(tPrev, vUv).rgb * uKeep - 0.0015, 0.0) * step(0.001, uKeep);
  gl_FragColor = vec4(max(now, was), 1.0);
}
`;

/**
 * Сведение: сама поверхность видна только там, где замеров хватило, чтобы сплаты слились; где их
 * меньше, остаётся даль (чернота убежища), и поверх неё следующим шагом рисуются точки.
 */
export const COMPOSE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tMem;   // память света: какой поверхность была и насколько это свежо
uniform float uMemGain;   // яркость памяти: не растёт, когда камера в темноте поднимает усиление
uniform vec3 uFogColor;
uniform float uSolid;     // 1 — показывать поверхности целиком (облако точек выключено)
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tScene, vUv);
  if (uSolid > 0.5) {
    gl_FragColor = vec4(c.rgb, 1.0);
    return;
  }
  // Поверхность не гаснет разом: первые мгновения после света она ещё видна по памяти и тает,
  // оставляя вместо себя точки. Так держится только то, что запомнилось ярким, — середина луча, где
  // поверхность и была сплошной; ореол, собранный из точек, остаётся точками.
  // Тает она не ровно, а крошится: зерно за зерном выпадает из неё, пока не останется ничего.
  vec4 m = texture2D(tMem, vUv);
  float now = smoothstep(0.22, 0.85, c.a);
  float keep = smoothstep(0.86, 1.0, m.a) * smoothstep(0.1, 0.4, dot(m.rgb, vec3(0.3, 0.59, 0.11)));
  uvec2 px = uvec2(gl_FragCoord.xy);
  uint n = px.x * 0x27d4eb2du ^ px.y * 0x165667b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12;
  float kept = step(float(n & 0xffffu) / 65535.0, keep * 0.97);
  gl_FragColor = vec4(mix(uFogColor, mix(m.rgb * uMemGain, c.rgb, now), max(now, kept)), 1.0);
}
`;

/**
 * Эхо — второй способ видеть. Свет показывает место таким, какое оно есть; эхо показывает только,
 * что оно есть: от шага игрока или от Осыпи расходится волна, и там, где её фронт идёт по стенам
 * и полу, на мгновение проступают кромки и линии равного расстояния — без цвета и подробностей.
 *
 * Один полноэкранный проход по карте глубины готового кадра: для каждого пикселя — его точка в мире
 * и расстояние до источника каждой волны (их до ECHO_MAX). Кромки берутся из той же глубины: в буфере
 * она линейна по 1/z, поэтому на плоскости её вторая разность равна нулю, а на краю предмета и в углу
 * стены с полом — нет. Там, где светло, эха не видно: свет говорит громче.
 */
export const ECHO_FRAG = /* glsl */ `
precision highp float;
uniform highp sampler2D tDepth;
uniform sampler2D tScene;         // альфа — число замеров: на свету эхо не нужно
uniform mat4 uInvViewProj;
uniform vec2 uNearFar;
uniform vec2 uTexel;
uniform vec4 uPulse[ECHO_MAX];    // xyz — источник (мир), w — радиус фронта, м
uniform vec4 uPulseB[ECHO_MAX];   // x — сила, y — длина хвоста, м, z — род: 0 — шаг, 1 — Осыпь, 2 — вещь
uniform float uGainInv;           // яркость не растёт вместе с усилением камеры
varying vec2 vUv;

void main() {
  float d = texture2D(tDepth, vUv).r;
  gl_FragColor = vec4(0.0);
  if (d > 0.99999) return;
  vec4 hp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 wp = hp.xyz / hp.w;
  float z = (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));

  float dl = texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r;
  float dr = texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r;
  float du = texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r;
  float dd = texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r;
  float e = (abs(dl + dr - 2.0 * d) + abs(du + dd - 2.0 * d)) * z / uNearFar.x;
  float edge = smoothstep(0.0025, 0.012, e);

  vec3 col = vec3(0.0);
  for (int i = 0; i < ECHO_MAX; i++) {
    float amp = uPulseB[i].x;
    if (amp <= 0.0) continue;
    float dist = distance(wp, uPulse[i].xyz);
    float behind = uPulse[i].w - dist;
    if (behind < 0.0) continue;
    // Фронт — узкая яркая кромка; за ним хвост, в котором видны кромки предметов и линии равного
    // расстояния от источника (каждые 0,8 м): по ним читается форма пола и стен.
    float front = exp(-behind * 7.0);
    float tail = exp(-behind / max(uPulseB[i].y, 0.05));
    float w = 0.005 * z + 0.006;
    float iso = 1.0 - smoothstep(w, w * 2.2, abs(fract(dist / 0.8 + 0.5) - 0.5) * 0.8);
    float k = amp / (1.0 + 0.006 * dist * dist) * (front * (0.16 + 0.5 * edge) + tail * (0.6 * edge + 0.22 * iso + 0.02));
    float kind = uPulseB[i].z;
    vec3 tint = kind < 0.5 ? vec3(0.5, 0.66, 0.82) : (kind < 1.5 ? vec3(0.92, 0.84, 0.66) : vec3(0.95, 0.12, 0.06));
    col += tint * k;
  }
  float lit = texture2D(tScene, vUv).a;
  gl_FragColor = vec4(col * (uGainInv * (1.0 - smoothstep(0.06, 0.4, lit))), 1.0);
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
uniform sampler2D tHaze;
uniform sampler2D uGrime;
uniform vec2 uHazeTexel;
uniform float uBloom;
uniform float uCrt;       // 0..1: насколько «кинескоп» заметен — строки, маска, дрожь строк, бегущая полоса
uniform float uFlash;     // 0..1: кадр выбеливается (скачок между пространствами)
uniform sampler2D tEcho;  // эхо: линии пространства, проступающие под волной (свой слой: выдержка их не смазывает)
uniform float uEcho;      // 1 — слой эха есть в этом кадре

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
  return textureLod(tScene, uv, 0.0).rgb * inside.x * inside.y;
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

  // Кинескоп: строки чуть гуляют по горизонтали, сильнее — когда картинка «под нагрузкой».
  if (uCrt > 0.0) {
    float wob = hash(uvec2(1u, px.y / 2u), frame) - 0.5;
    uv.x += wob * 0.0022 * uCrt * uCrt;
  }

  vec3 col;
#ifdef CHROMA
  // Разлёт цветов невелик: мир собран из точек в два-три пикселя, и сильный разлёт растягивал бы
  // каждую в радужный штрих.
  col.r = sampleScene(distort(uv, uBarrel * 1.025)).r;
  col.g = sampleScene(distort(uv, uBarrel)).g;
  col.b = sampleScene(distort(uv, uBarrel * 0.975)).b;
#else
  col = sampleScene(distort(uv, uBarrel));
#endif
  if (uEcho > 0.5) {
    vec2 ev = distort(uv, uBarrel);
    vec2 in_ = step(vec2(0.0), ev) * step(ev, vec2(1.0));
    col += texture2D(tEcho, ev).rgb * in_.x * in_.y;
  }

  vec2 c = vUv * 2.0 - 1.0;
  c.x *= uAspect;

  vec2 bc = uBeam.xy * 2.0 - 1.0;
  bc.x *= uAspect;
  vec2 bd = c - bc;
#ifdef HAZE
  // Дымка в луче: четыре выборки сглаживают зерно маленького буфера.
  vec2 hv = distort(uv, uBarrel);
  vec2 ht = uHazeTexel * 0.75;
  col += 0.25 * (texture2D(tHaze, hv + vec2(ht.x, ht.y)).rgb + texture2D(tHaze, hv + vec2(-ht.x, ht.y)).rgb + texture2D(tHaze, hv + vec2(ht.x, -ht.y)).rgb + texture2D(tHaze, hv - ht).rgb);
  // Ореол: яркое пятно расплывается по грязному стеклу объектива.
  vec3 glow = textureLod(tScene, hv, 3.5).rgb * 0.4 + textureLod(tScene, hv, 5.5).rgb * 0.6;
  float smear = texture2D(uGrime, vUv * vec2(uAspect, 1.0) * 0.55 + 0.13).g;
  col += glow * uBloom * (0.35 + 1.3 * smear * smear);
#else
  // Пыльный воздух светится вокруг луча.
  col += vec3(1.0, 0.95, 0.85) * uBeam.z * exp(-dot(bd, bd) * 3.2);
#endif

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

  // Цвет дешёвой камеры: приглушённая насыщенность, тени уходят в болотную зелень, света — в желтизну.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 0.74) * mix(vec3(0.9, 1.0, 0.93), vec3(1.03, 1.0, 0.92), smoothstep(0.05, 0.6, l));
  // Провал в тенях: тёмное остаётся тёмным, а не серым.
  col *= smoothstep(-0.02, 0.09, l) * 0.35 + 0.65;

  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  // Чересстрочная фактура видеозаписи; с uCrt строки и маска кинескопа проступают сильнее.
  col *= 1.0 - (0.035 + 0.11 * uCrt) * float(px.y & 1u);
  if (uCrt > 0.0) {
    uint tri = px.x % 3u;
    col *= mix(vec3(1.0), vec3(tri == 0u ? 1.0 : 0.82, tri == 1u ? 1.0 : 0.82, tri == 2u ? 1.0 : 0.82), 0.45 * uCrt);
    // Бегущая полоса: светлая строка медленно сползает по кадру.
    float bar = fract(vUv.y + uFrame * 0.0031);
    col += vec3(0.05, 0.055, 0.06) * uCrt * smoothstep(0.035, 0.0, abs(bar - 0.5));
  }
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;
