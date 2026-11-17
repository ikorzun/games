/**
 * GLSL-шейдеры. Three.js для WebGL2 сам ставит `#version 300 es` и переводит attribute/varying/
 * texture2D/gl_FragColor, поэтому текст написан в привычном стиле, а sampler2DShadow читается
 * функцией texture().
 *
 * Свет: `ambient (альбедо × AO) + фонарь × matcap`. Matcap берётся по направлению на фонарь и входит
 * только в слагаемое фонаря — иначе при погасшем фонаре мир выглядел бы подсвеченным от камеры.
 * Цвет выходит линейным: буфер сцены — sRGB8, кодирование делает сама видеокарта.
 */

import { HANG_OBJ } from '../world/objects';

/** Общая часть: профиль луча и затухание. Используется миром, пылью и роем. */
export const BEAM_GLSL = /* glsl */ `
uniform vec3 uLightPosV;
uniform vec3 uLightDirV;
uniform vec3 uLightColor;
uniform vec4 uCone;
uniform float uBeamTall;  // 1 — пятно круглое; меньше — вытянуто по вертикали кадра (высокий кадр)
uniform float uRings;     // сила колец дешёвого отражателя: в убежище заметны, в чистых местах едва видны

/** Яркость луча в точке (пространство камеры) без тени: xyz — направление на фонарь, w — освещённость. */
vec4 beamAt(vec3 posV) {
  vec3 toL = uLightPosV - posV;
  float d = length(toL);
  vec3 L = toL / max(d, 1e-4);
  // В высоком кадре (телефон в руке) пятно вытянуто по вертикали: круглый ореол накрывал меньше половины
  // высоты кадра, и пол у ног оставался не освещён — «нет пола» (куратор, пачка 24). Отступ от оси
  // по вертикали сжимается тем же множителем, что и у взгляда (gazeTall в render/renderer.ts).
  vec3 rel = -L - uLightDirV;
  rel.y *= uBeamTall;
  float cosA = dot(normalize(uLightDirV + rel), uLightDirV);
  float hot = smoothstep(uCone.y, uCone.x, cosA);
  float corona = smoothstep(uCone.z, uCone.y, cosA);
  float spill = smoothstep(uCone.w, uCone.z, cosA);
  float beam = hot * 0.78 + corona * 0.19 + spill * 0.03;
  // Кольца дешёвого отражателя вокруг яркого пятна. Неровные: шаг кольца гуляет по кругу, кое-где кольцо
  // рвётся. Ровные концентрические ступени на гладкой стене читались полосами градиента (аудит мест, 16.11).
  if (uRings > 0.0) {
    float ang = acos(clamp(cosA, -1.0, 1.0));
    vec3 t1 = normalize(cross(uLightDirV, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    float az = atan(dot(rel, cross(t1, uLightDirV)), dot(rel, t1));
    float wob = 0.9 * sin(az * 3.0 + 1.7) + 0.5 * sin(az * 7.0 + 0.4);
    float brk = 0.55 + 0.45 * sin(az * 5.0 + 2.3);
    beam *= 1.0 + uRings * sin(ang * 85.0 + wob) * brk * corona * (1.0 - hot);
  }
  float atten = 1.0 / (1.0 + 0.07 * d * d);
  return vec4(L, beam * atten);
}
`;

/**
 * Распад. Их два, и выглядят они по-разному.
 *
 * Мир (uDissolve) рассыпается, когда его время вышло или игрока уносит в другое место: вершины
 * расползаются кто куда (каждая клетка 0,4 м — в свою сторону и вверх), поверхность выгорает клетками
 * с красной кромкой. Красное — язык системы.
 *
 * Вещь (uThing.x — отдельная вещь, uObjState — предмет в сетке помещения) уходит иначе: «память —
 * пыль» (слова партнёра: распад и сборка — «через точки»). Вершины стоят на месте, а поверхность
 * распадается на зёрна по два сантиметра: каждое сжимается в точку в свой срок и пропадает. Те же
 * зёрна — уже настоящими точками — отдельным облаком отходят от поверхности и гаснут в воздухе, на пол
 * ничего не оседает (GRAIN_VERT). Сборка — то же самое задом наперёд.
 */
export const CRUMBLE_GLSL = /* glsl */ `
uniform float uDissolve;
uniform vec4 uThing;      // x — распад вещи 0..1, y — вещь из кружева (1), z — это отдельная вещь (1; 2 — ещё и светится сама), w — сид вещи
uniform float uDots;      // 0..1: выросшая вещь — одни точки, её проходят насквозь (слова партнёра)
attribute float aObj;     // номер объекта уровня у вершины (0 — вершина ничья: стена, пол)
uniform highp sampler2D uObjState;   // состояния объектов, 64 × 64: r — растворён, g — из кружева, b — выцвел, a — светится своим цветом

/**
 * Состояние предмета, которому принадлежит вершина: x — насколько он растворён (его коснулись — он
 * рассыпается), y — от него осталось одно кружево (нити вместо поверхности), z — насколько он выцвел,
 * w — насколько светится своим цветом (бумажные цветы: тусклые, пока к ним не подошли, — и яркие перед
 * тем, как рассыпаться).
 */
vec4 objState() {
  if (aObj < 0.5) return vec4(0.0);
  int id = int(aObj + 0.5);
  return texelFetch(uObjState, ivec2(id & 63, id >> 6), 0);
}

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
uniform float uDebugView; // проверка на устройстве (#diag, «факторы»): 1 — вместо цвета то, из чего сложилась сборка
`;

/**
 * Ветер. Всё, что висит или растёт, качается: закреплённый конец стоит, свободный ходит и чуть
 * запаздывает. Вес вершины кладёт сборщик (world/kit.ts, sway); у стен и мебели он нулевой. Соседние
 * вещи качаются согласно: фаза идёт по миру волной, как порыв. Время ветра — время места: в зале
 * ожидания, пока герой стоит, оно застывает вместе со снимком.
 */
export const WIND_GLSL = /* glsl */ `
attribute float aSway;
uniform vec4 uWind;       // x — время ветра, с; y — размах свободного конца, м; zw — куда дует (x, z)

vec3 windSway(vec3 wp) {
  if (aSway <= 0.0 || uWind.y <= 0.0) return wp;
  float ph = dot(wp.xz, vec2(0.37, 0.29));
  float t = uWind.x - aSway * 0.7;
  float along = 0.55 * sin(t * 1.31 + ph) + 0.3 * sin(t * 2.17 + ph * 1.7 + 1.1) + 0.45 * sin(t * 0.43 + ph * 0.31 + 0.5);
  float across = 0.4 * sin(t * 1.73 + ph * 1.3 + 1.9);
  wp.xz += (uWind.zw * along + vec2(-uWind.w, uWind.z) * across) * (uWind.y * aSway);
  return wp;
}
`;

export const WORLD_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aMat;
uniform mat4 uShadowMatrix;
uniform float uTierDrop;
uniform vec4 uPressBox;   // давление: прямоугольник помещения (minX, minZ, maxX, maxZ)
uniform vec3 uPressY;     // x — пол помещения, y — его потолок, z — на сколько метров потолок провис
varying vec3 vWorld;
varying float vDis;
varying float vObj;
varying float vLace;
varying float vArch;
varying vec2 vTone;
varying float vSeed;      // чей узор кружева: номер предмета или сид вещи (0 — архитектура)
${CRUMBLE_GLSL}
${WIND_GLSL}
#ifdef BIRD
// Птица (systems/birds.ts): много копий одной сетки. В канале качания у вершин крыла стоит не ветер, а
// место на крыле — от плеча (0) к кончику (1) со знаком стороны; по нему крыло машет и складывается.
attribute vec2 iBird;     // x — фаза взмаха, рад; y — раскрытие крыльев 0..1 (0 — сидит, сложив)

void birdWing(inout vec3 p, inout vec3 n) {
  float w = abs(aSway);
  if (w <= 0.0) return;
  float side = sign(aSway);
  float open = iBird.y;
  vec2 d = vec2(p.x - side * 0.05, p.y - 0.13);
  // Сложенное крыло прижато к боку и тянется назад вдоль тела.
  d.x *= mix(0.2, 1.0, open);
  p.z -= (1.0 - open) * w * 0.13;
  d.y -= (1.0 - open) * w * 0.035;
  // Взмах — поворот вокруг продольной оси в плече; кончик запаздывает и ходит шире корня.
  float ang = open * (sin(iBird.x - w * 1.2) * (0.5 + 0.55 * w) + 0.18) * side;
  float c = cos(ang);
  float s = sin(ang);
  p.x = side * 0.05 + d.x * c - d.y * s;
  p.y = 0.13 + d.x * s + d.y * c;
  n.xy = vec2(n.x * c - n.y * s, n.x * s + n.y * c);
}
#endif
varying vec3 vPosV;
varying vec3 vNrmV;
varying vec4 vColor;
varying float vMat;
varying vec2 vUv;
varying vec4 vShadow;
varying vec3 vSurf;   // x — стена (1) или пол с потолком (0); y — нормаль вверх; z — высота над полом яруса, м
varying float vShell; // мох слоями (world/moss.ts): уровень слоя, 0 — не мох, 1 — кончики ворса

void main() {
  // Сетка, поставленная много раз (грибы): у каждой копии своё место, поворот и размер.
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
#ifdef BIRD
  vec3 lp = position;
  vec3 ln = normal;
  birdWing(lp, ln);
  vec4 wp = modelMatrix * (im * vec4(lp, 1.0));
  vec3 wn = normalize(mat3(modelMatrix) * (mat3(im) * ln));
  vShell = 0.0;
#else
  // Отрицательный вес качания — уровень слоя мха; ветер такие вершины не трогает.
  vShell = max(-aSway, 0.0);
  vec4 wp = modelMatrix * (im * vec4(position, 1.0));
  wp.xyz = windSway(wp.xyz);
  vec3 wn = normalize(mat3(modelMatrix) * (mat3(im) * normal));
#endif
  // Подвешенное к потолку (светильник, короб, вывеска): часть потолка, своим номером вершин (HANG_OBJ).
  bool hangV = abs(aObj - ${HANG_OBJ}.0) < 0.5;
  // Давление: потолок помещения провисает, как брюхо (systems/pressure.ts). У стен он остаётся на месте —
  // двери не закрывает; двигаются только вершины самого потолка и то, что на нём висит, — не предметы под ним.
  if (uPressY.z > 0.0 && uThing.z < 0.5 && ((aObj < 0.5 && wn.y < -0.5 && abs(wp.y - uPressY.y) < 0.3) || (hangV && wp.y > uPressY.y - 0.8 && wp.y < uPressY.y + 0.1))) {
    float pd = min(min(wp.x - uPressBox.x, uPressBox.z - wp.x), min(wp.z - uPressBox.y, uPressBox.w - wp.z));
    if (pd > 0.0) wp.y -= uPressY.z * smoothstep(0.0, 0.9, pd);
  }
  vWorld = wp.xyz;
  vec4 os = objState();
  float od = os.x;
  vDis = uDissolve;
  vObj = max(uThing.x, od);
  vLace = max(uThing.y, os.y);
  // uThing.z = 2 — вещь чуть светится сама (грибы: их видно и на краю луча, как знак).
  vTone = os.zw + vec2(0.0, uThing.z > 1.5 ? 0.3 : 0.0);
  // Архитектура — всё, что не предмет и не отдельная вещь: стены, пол, потолок, трубы на них (1). Висящее у
  // потолка — тоже архитектура, но стирается вместе с потолком над собой (2).
  vArch = uThing.z < 0.5 ? (aObj < 0.5 ? 1.0 : (hangV ? 2.0 : 0.0)) : 0.0;
  vSeed = uThing.z > 0.5 ? 1.0 + uThing.w * 7.0 : aObj;
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
  // Растворённого предмета нет вовсе: его треугольники не доходят до растеризации.
  if (od > 0.995) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#ifdef LACE_EDGE
  // Нити по рёбрам кружева (renderer: laceEdges): линии изломов и краёв вещи. Рисуются только у того,
  // что сейчас кружево, и чуть ближе к камере, чтобы не тонуть в собственной сетке.
  gl_Position.z -= 0.0008 * gl_Position.w;
  if (vLace < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
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
uniform float uPlain;     // 1 — чистое пространство: только шар материала, без фактур, рельефа и грязи
uniform sampler2D uCellLight; // свет по клеткам уровня: r — сколько рассеянного света в клетке, g — номер помещения
uniform vec4 uCellGrid;       // xy — угол сетки в мире (x, z), z — шаг клетки, м, w — клеток по стороне (0 — света по клеткам нет)
uniform vec3 uLightRightV;
uniform vec3 uLightUpV;
uniform vec4 uSlide;      // проекции: x, y — при каком свете картинка начинает выгорать и когда пропадает совсем; z — её яркость; w — время, с
uniform sampler2D uScreens; // атлас картинок выставочных экранов (world/screens.ts)
uniform sampler2DArray uPapers; // листы бумаги (world/papers.ts): портреты, деньги, карты — слой на файл
uniform float uDots;      // 0..1: выросшая вещь — одни точки (объявлен и в CRUMBLE_GLSL вершинного шейдера; во фрагментном нужен свой)
// Материалов может быть до 48 (атлас шаров 8 × ATLAS_ROWS); сколько их на деле — знает world/materials.ts.
#ifndef ATLAS_ROWS
#define ATLAS_ROWS 4
#endif
uniform vec4 uMatA[48];   // грязь, свечение, слой фактуры, повторов фактуры на метр
uniform vec4 uMatB[48];   // рельеф (м), род запустения, проступающий материал, просвет (тонкое светится, когда свет за ним)
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
varying float vObj;
varying float vLace;
varying float vArch;
varying vec2 vTone;       // x — предмет выцвел, y — светится своим цветом
varying float vSeed;      // чей узор кружева (0 — архитектура: общий узор)
varying float vShell;     // мох слоями: уровень слоя, 0 — не мох
uniform float uKeyCells;  // > 0 — прямой свет есть только там, где клетка светлая: множитель рассеянного света клеток
uniform float uGaze;      // 0..1: рассеянный свет собирает место только там, куда смотрит герой
uniform vec2 uGazeCone;   // косинусы края взгляда (за ним ничего не собрано) и его середины (собрано сплошь)
uniform float uGazeTall;  // во сколько раз сжать вертикаль при счёте угла взгляда: 1 — кадр широкий, меньше — высокий
uniform vec4 uPressBox;   // давление: прямоугольник помещения (minX, minZ, maxX, maxZ)
uniform vec4 uPress;      // xy — откуда идёт провал, z — радиус рассыпавшегося пола, w — яркость красной сетки
uniform vec3 uPressY;     // x — пол помещения, y — его потолок, z — на сколько метров потолок провис
uniform vec4 uErase;      // стирание места (systems/decay.ts): x — потолок, y — стены, z — пол; 0 — цело, 1 — стёрто
uniform float uCeilTile;  // шаг плиток подвесного потолка, м (офис, жёлтые комнаты); 0 — потолок цельный
uniform vec3 uBurnTint;   // цвет кромки распада: красный системы в тёмных местах, тёплый белый в светлых
uniform vec4 uRoofBox;    // зал ожидания: прямоугольник стеклянной крыши в мире (minX, minZ, maxX, maxZ)
uniform float uRoofY;     // высота её переплёта, м; 0 — крыши нет
uniform vec3 uKeyDirW;    // направление на прямой свет в мире
uniform vec4 uRecallPos;     // свет памяти (world/memory_light.ts): xyz — где искомая вещь (мир), w — сила; 0 — света нет
uniform vec4 uRecallColor;   // rgb — его цвет, w — род: 0 пламя у пола, 1 окно перед вещью, 2 лампа сверху, 3 зимний свет сверху, 4 ровная точка (циферблат)
uniform vec4 uRecallDir;     // xz — куда смотрит вещь (мир), y — высота источника над вещью, м, w — докуда светит, м
uniform sampler2D uContact;   // тени-пятна под обстановкой (render/contact.ts): по каналу на ярус, 1 — темно
uniform vec3 uContactGrid;    // xy — угол карты в мире (x, z), z — её сторона, м; 0 — карты нет
uniform float uTierDrop;
uniform float uCaustic;   // 0..1: луч лежит на воде — отсвет вокруг идёт рябью
uniform vec4 uVoid;       // Осыпь: xyz — где она (пространство камеры), w — докуда она достаёт, м (0 — её нет)
uniform vec2 uVoidK;      // x > 0 — она темнота и поглощает свет; x < 0 — она свет и выжигает (яркость); y — насколько она здесь, 0..1

${BEAM_GLSL}
${SCAN_GLSL}

/** Случайное число клетки мира (для дыр распада): целочисленный хеш, одинаковый на любом устройстве. */
float cellHash(vec3 p) {
  ivec3 q = ivec3(floor(p)) + 32768;
  uint n = uint(q.x) * 0x27d4eb2du ^ uint(q.y) * 0x165667b1u ^ uint(q.z) * 0x9e3779b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12; n *= 0x297a2d39u; n ^= n >> 15;
  return float(n & 0xffffu) / 65535.0;
}

/** Плавный шум 0..1: случайные числа клеток мира, сглаженные между соседями. */
float softNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(cellHash(i), cellHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(cellHash(i + vec3(0.0, 1.0, 0.0)), cellHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(cellHash(i + vec3(0.0, 0.0, 1.0)), cellHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(cellHash(i + vec3(0.0, 1.0, 1.0)), cellHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}

/**
 * Кружево: то, что остаётся от поверхности, когда вещество ушло, — нити. Возвращает расстояние от
 * места q на поверхности (м) до ближайшей нити, м. Узор: ромбическая сеть с шагом около 11 см,
 * горизонтальная нить каждые 30 см и «глазки» — кольца в каждом втором ромбе.
 */
float laceDist(vec2 q) {
  vec2 d = vec2(q.x + q.y, q.x - q.y) / 0.15;
  vec2 near = 0.5 - abs(fract(d) - 0.5);
  float net = min(near.x, near.y) * 0.106;
  float row = (0.5 - abs(fract(q.y / 0.3) - 0.5)) * 0.3;
  vec2 cell = floor(d);
  float odd = mod(cell.x + cell.y, 2.0);
  float ring = abs(length(fract(d) - 0.5) - 0.3) * 0.106 + (1.0 - odd);
  return min(min(net, row), ring);
}

/**
 * Шум, по которому выпадает потолок, в точке p мира. Подвесной потолок выпадает плитками: у плитки одно
 * число на всю — плавный шум в её середине и немного случая, чтобы край дыры шёл ступенями плиток.
 */
float ceilNoise(vec3 p) {
  if (uCeilTile > 0.0) {
    vec2 tc = floor(p.xz / uCeilTile);
    vec3 c = vec3((tc.x + 0.5) * uCeilTile, p.y, (tc.y + 0.5) * uCeilTile);
    return softNoise(c * 0.9 + 3.1) * 0.8 + cellHash(vec3(tc, 41.0)) * 0.2;
  }
  return softNoise(p * 0.9 + 3.1);
}

/**
 * Насколько стёрто это место архитектуры: 0 — цело, 1 — стёрто. Между ними — кромка, где поверхность
 * уже редеет. Стирается пятнами около метра; стена — сверху вниз.
 */
float archGone() {
  if (vArch < 0.5) return 0.0;
  // Висящее у потолка уходит целиком и вместе с потолком над серединой своей клетки (3 м): раньше его бока
  // стирались как стены, позже потолка, и светильник висел в дыре (аудит мест, 16.11). Высота выборки —
  // одна на ярус: у всей вещи одно число.
  if (vArch > 1.5) {
    if (uErase.x <= 0.0) return 0.0;
    vec2 cc = floor(vWorld.xz / 3.0 + 0.5) * 3.0;
    return step(0.0, uErase.x * 1.14 - 0.06 - ceilNoise(vec3(cc.x, vWorld.y - vSurf.z + 2.7, cc.y)));
  }
  bool ceil_ = vSurf.x < 0.5 && vSurf.y < -0.5;
  float amount = vSurf.x > 0.5 ? uErase.y : (ceil_ ? uErase.x : (vSurf.y > 0.5 ? uErase.z : uErase.y));
  if (amount <= 0.0) return 0.0;
  if (ceil_ && uCeilTile > 0.0) {
    // Подвесной потолок выпадает плитками целиком, а рама — по 1,2 см от шва — остаётся висеть решёткой
    // (было: дыра — гладкий чёрный овал, «как прожог»).
    vec2 f = abs(fract(vWorld.xz / uCeilTile) - 0.5);
    if ((0.5 - max(f.x, f.y)) * uCeilTile < 0.012) return 0.0;
    return step(0.0, amount * 1.14 - 0.06 - ceilNoise(vWorld));
  }
  float n = softNoise(vWorld * 0.9 + 3.1);
  if (vSurf.x > 0.5) n = n * 0.65 + (1.0 - clamp(vSurf.z / 2.7, 0.0, 1.0)) * 0.35;
  return clamp((amount * 1.14 - 0.06 - n) / 0.08, 0.0, 1.0);
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

/**
 * Тень переплёта стеклянной крыши без карты теней (на телефоне карты нет, а время в зале ожидания
 * видно именно по этим теням). Балки стоят ровной решёткой — поперёк зала каждые три метра, вдоль
 * каждые полтора, — поэтому тень считается прямо здесь: луч от точки к солнцу пересекает плоскость
 * крыши и попадает в балку или мимо. Вышел не через крышу, а через стену — тень стены. Полутень тем
 * шире, чем дальше до крыши; у тонкого прогона она съедает тень почти целиком. Доля света 0..1.
 */
float roofShade() {
  if (uRoofY <= 0.0 || uKeyDirW.y < 0.03) return 1.0;
  // Только в самом зале: перрон и комнаты под потолком освещены по-своему.
  if (vWorld.x < uRoofBox.x - 0.2 || vWorld.x > uRoofBox.z + 0.2 || vWorld.z < uRoofBox.y - 0.2 || vWorld.z > uRoofBox.w + 0.2 || vWorld.y > uRoofY - 0.1) return 1.0;
  float t = (uRoofY - vWorld.y) / uKeyDirW.y;
  vec2 q = vWorld.xz + uKeyDirW.xz * t;
  float pen = 0.02 + 0.006 * t;
  float inside = min(min(q.x - uRoofBox.x, uRoofBox.z - q.x), min(q.y - uRoofBox.y, uRoofBox.w - q.y));
  float bz = abs(fract(q.y / 3.0 + 0.5) - 0.5) * 3.0;
  float bx = abs(fract(q.x / 1.5) - 0.5) * 1.5;
  float fz = clamp((0.1 + pen - bz) / (2.0 * pen), 0.0, min(1.0, 0.1 / pen));
  float fx = clamp((0.045 + pen - bx) / (2.0 * pen), 0.0, min(1.0, 0.045 / pen));
  return smoothstep(-pen, pen, inside) * (1.0 - fz) * (1.0 - fx);
}

/**
 * Свет памяти: искомая вещь приносит свет, в котором её запомнили (world/memory_light.ts). Чайник —
 * синее пламя у самого пола; кресло — окно перед ним: окна нет, а солнце из него ложится рамой крестом
 * на кресло и пол; билет — круг лампы сверху; пальто — зимний свет сверху, пятнами, как сквозь снег на
 * стекле. Возвращает направление на свет (пространство камеры) и силу без учёта наклона поверхности.
 * Теней у этого света нет: он из памяти, а не из комнаты.
 */
vec4 memLight() {
  if (uRecallPos.w <= 0.0) return vec4(0.0, 1.0, 0.0, 0.0);
  vec3 d = vWorld - uRecallPos.xyz;
  float dist = length(d);
  float R = uRecallDir.w;
  if (dist > R) return vec4(0.0, 1.0, 0.0, 0.0);
  float kind = uRecallColor.w;
  vec3 Lw;
  float k;
  if (kind < 0.5 || kind > 3.5) {
    // Точка: пламя над конфоркой (0) — дрожит; циферблат (4) — ровный. Рядом ярко, к краю круга сходит на нет.
    vec3 toL = uRecallPos.xyz + vec3(0.0, uRecallDir.y, 0.0) - vWorld;
    float dl = max(length(toL), 0.05);
    Lw = toL / dl;
    float fall = 1.0 - smoothstep(0.0, R, dl);
    float flick = kind < 0.5 ? 0.85 + 0.15 * sin(uSlide.w * 17.0) * sin(uSlide.w * 6.3 + 1.7) : 1.0;
    k = fall * (0.35 + 0.65 / (1.0 + 4.0 * dl * dl)) * flick;
  } else if (kind < 1.5) {
    // Окно стоит в 2,3 м перед вещью, середина на высоте источника; рама 1,1 × 1,3 м с крестом
    // переплёта чуть выше середины. Солнце низкое (31°): пятно рамы ложится на кресло и пол у него.
    vec3 F = normalize(vec3(uRecallDir.x, 0.0, uRecallDir.z) + vec3(1e-4, 0.0, 0.0));
    Lw = normalize(F * 0.857 + vec3(0.0, 0.515, 0.0));
    vec3 Wc = uRecallPos.xyz + F * 2.3 + vec3(0.0, uRecallDir.y, 0.0);
    float t = dot(Wc - vWorld, F) / 0.857;
    if (t < 0.0) return vec4(0.0, 1.0, 0.0, 0.0);
    vec3 Q = vWorld + Lw * t;
    float u = dot(Q - Wc, vec3(F.z, 0.0, -F.x));
    float v = Q.y - Wc.y;
    // Полутень шире, чем дальше от окна.
    float soft = 0.025 + 0.018 * t;
    float rect = (1.0 - smoothstep(0.55 - soft, 0.55 + soft, abs(u))) * (1.0 - smoothstep(0.65 - soft, 0.65 + soft, abs(v)));
    float bars = smoothstep(0.018, 0.018 + soft, abs(u)) * smoothstep(0.018, 0.018 + soft, abs(v - 0.14));
    k = rect * bars * (1.0 - smoothstep(R * 0.55, R, dist));
  } else {
    // Сверху: лампа (2) — тесный тёплый круг; зимний свет (3) — шире, холоднее и пятнами.
    vec3 toL = uRecallPos.xyz + vec3(0.0, uRecallDir.y, 0.0) - vWorld;
    float dl = max(length(toL), 0.05);
    Lw = toL / dl;
    bool lampK = kind < 2.5;
    k = smoothstep(lampK ? 0.899 : 0.743, lampK ? 0.961 : 0.883, Lw.y) * (1.0 - smoothstep(R * 0.6, R, dist));
    if (!lampK) k *= 0.6 + 0.4 * softNoise(vWorld * 2.7 + 1.3);
  }
  return vec4(normalize(mat3(viewMatrix) * Lw), k * uRecallPos.w);
}

#ifdef HEXTILE
/**
 * Шестиугольная укладка фактуры (hex tiling, Mikkelsen 2022). Фактура повторяется каждые полметра-метр,
 * и на большой ровной стене это видно как решётка одинаковых пятен. Здесь поверхность делится на
 * шестиугольные ячейки, у каждой фактура сдвинута по-своему, а на стыках три соседние смешиваются.
 * Три выборки вместо одной — поэтому только на высоком качестве и только там, где у фактуры нет своего
 * рисунка (бетон, штукатурка, краска, ржавчина, земля): кирпичу, плитке и паркету повтор и есть рисунок.
 */
vec2 hexShift(ivec2 p) {
  uint n = uint(p.x + 32768) * 0x27d4eb2du ^ uint(p.y + 32768) * 0x165667b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12; n *= 0x297a2d39u; n ^= n >> 15;
  return vec2(float(n & 0xffffu), float(n >> 16)) / 65535.0;
}

vec4 hexDetail(vec2 uv, float layer) {
  // Ячейка — около трети повтора фактуры.
  vec2 sk = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
  vec2 base = floor(sk);
  vec3 f = vec3(fract(sk), 0.0);
  f.z = 1.0 - f.x - f.y;
  float s = step(0.0, -f.z);
  float s2 = 2.0 * s - 1.0;
  vec3 w = vec3(-f.z * s2, s - f.y * s2, s - f.x * s2);
  ivec2 b = ivec2(base);
  int si = int(s);
  vec4 c1 = texture(uDetail, vec3(uv + hexShift(b + ivec2(si, si)), layer));
  vec4 c2 = texture(uDetail, vec3(uv + hexShift(b + ivec2(si, 1 - si)), layer));
  vec4 c3 = texture(uDetail, vec3(uv + hexShift(b + ivec2(1 - si, si)), layer));
  // Веса острее линейных: на стыке ячеек меньше «мыла».
  w = w * w * w;
  w /= w.x + w.y + w.z;
  return c1 * w.x + c2 * w.y + c3 * w.z;
}
#endif

#ifdef SLIDE
/** Луч против коробки: расстояние до входа (или −1) и нормаль грани, в которую он вошёл. */
float hitBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out vec3 nrm) {
  vec3 inv = 1.0 / mix(rd, vec3(1e-5), lessThan(abs(rd), vec3(1e-5)));
  vec3 t1 = (bmin - ro) * inv;
  vec3 t2 = (bmax - ro) * inv;
  vec3 lo = min(t1, t2);
  vec3 hi = max(t1, t2);
  float tn = max(max(lo.x, lo.y), lo.z);
  float tf = min(min(hi.x, hi.y), hi.z);
  nrm = lo.x > lo.y && lo.x > lo.z ? vec3(-sign(rd.x), 0.0, 0.0) : (lo.y > lo.z ? vec3(0.0, -sign(rd.y), 0.0) : vec3(0.0, 0.0, -sign(rd.z)));
  return tf >= max(tn, 0.0) ? tn : -1.0;
}

/**
 * Ложная комната за окном (interior mapping): геометрии за стеклом нет — луч взгляда пересекается
 * с воображаемым ящиком, и по тому, во что он упёрся, считается цвет. Обманка зала ожидания: за
 * окошком кассы — не каморка кассира, а тот же зал под стеклянной крышей, пустой, и в нём вечер, какое
 * бы время ни стояло здесь. Оси комнаты: x — вдоль окна, y — вверх, z — вглубь; ro — точка на стекле.
 * yF — пол комнаты относительно середины окна. lv — сколько света в настоящем зале (чтобы ложный не
 * был ярче или темнее его в разы).
 */
vec3 fakeHall(vec3 ro, vec3 rd, float yF, float lv) {
  const float HW = 6.0;
  const float DEPTH = 18.0;
  float yC = yF + 6.3;
  vec3 inv = 1.0 / mix(rd, vec3(1e-5), lessThan(abs(rd), vec3(1e-5)));
  float tx = ((rd.x > 0.0 ? HW : -HW) - ro.x) * inv.x;
  float ty = ((rd.y > 0.0 ? yC : yF) - ro.y) * inv.y;
  float tz = DEPTH * inv.z;
  float t = min(tx, min(ty, tz));
  vec3 hp = ro + rd * t;
  // Вечернее солнце стоит за дальним торцом: тени переплёта тянутся к зрителю.
  vec3 sL = normalize(vec3(-0.25, 0.55, 0.5));
  vec3 sunI = vec3(1.0, 0.7, 0.42) * (lv * 1.7 + 0.04);
  vec3 ambI = vec3(0.62, 0.64, 0.7) * (lv * 0.55 + 0.012);
  vec3 plaster = vec3(0.56, 0.54, 0.48);
  vec3 col;
  if (t == ty && rd.y < 0.0) {
    // Пол: плитка 30 см и решётка теней крыши.
    vec2 tl = abs(fract(hp.xz / 0.3) - 0.5);
    float joint = smoothstep(0.46, 0.5, max(tl.x, tl.y)) * exp(-t * 0.14);
    float up = (yC - hp.y) / sL.y;
    vec2 r = hp.xz + sL.xz * up;
    float pen = 0.03 + 0.006 * up;
    float bz = abs(fract(r.y / 3.0 + 0.5) - 0.5) * 3.0;
    float bx = abs(fract(r.x / 1.5) - 0.5) * 1.5;
    float lit = (1.0 - clamp((0.1 + pen - bz) / (2.0 * pen), 0.0, min(1.0, 0.1 / pen))) * (1.0 - clamp((0.045 + pen - bx) / (2.0 * pen), 0.0, min(1.0, 0.045 / pen)));
    // За торцевой стеной солнца нет: свет лежит только там, куда он проходит через крышу.
    lit *= step(abs(r.x), HW) * step(0.0, r.y) * step(r.y, DEPTH);
    col = mix(vec3(0.6, 0.58, 0.5), vec3(0.3, 0.29, 0.26), joint) * (ambI + sunI * lit * sL.y * 1.5);
  } else if (t == ty) {
    // Крыша: переплёт на фоне вечернего неба.
    float bz = abs(fract(hp.z / 3.0 + 0.5) - 0.5) * 3.0;
    float bx = abs(fract(hp.x / 1.5) - 0.5) * 1.5;
    float beam = max(1.0 - smoothstep(0.09, 0.11, bz), 1.0 - smoothstep(0.04, 0.05, bx));
    col = mix(vec3(1.0, 0.76, 0.55) * (lv * 1.5 + 0.03), vec3(0.2, 0.24, 0.22) * ambI, beam);
  } else {
    // Стены: штукатурка, внизу тёмная панель; в дальнем торце — два проёма переходов.
    float h = hp.y - yF;
    vec3 wallC = mix(plaster * vec3(0.55, 0.42, 0.34), plaster, smoothstep(1.18, 1.22, h));
    float sun = t == tz ? 0.0 : max(dot(vec3(-sign(rd.x), 0.0, 0.0), sL), 0.0);
    col = wallC * (ambI * (0.75 + 0.25 * smoothstep(0.0, 6.3, h)) + sunI * sun * 0.8);
    if (t == tz && h < 2.1 && abs(abs(hp.x) - 2.7) < 0.6) col = vec3(0.012, 0.012, 0.014);
  }
  // Четыре столба.
  for (int i = 0; i < 4; i++) {
    vec3 c = vec3(i < 2 ? -3.0 : 3.0, 0.0, (i == 0 || i == 2) ? 4.5 : 13.5);
    vec3 n;
    float th = hitBox(ro, rd, vec3(c.x - 0.3, yF, c.z - 0.3), vec3(c.x + 0.3, yC, c.z + 0.3), n);
    if (th > 0.0 && th < t) {
      t = th;
      col = plaster * (ambI * 0.8 + sunI * max(dot(n, sL), 0.0) * 0.9);
    }
  }
  // Воздух зала: даль уходит в тёплую дымку.
  return mix(col, vec3(1.0, 0.8, 0.6) * (lv * 0.7 + 0.02), 1.0 - exp(-t * 0.009));
}
#endif

/**
 * Блики ряби («зайчики»): свет, отражённый водой, ложится на стены сетью бегущих светлых линий. Воды
 * как объёма у нас нет — это три бегущие волны, из которых оставлены одни гребни. 0 — темно, до 2,5 — линия.
 */
float caustic(vec2 p, float t) {
  vec2 q = p * 3.1;
  float a = sin(q.x * 1.3 + t * 1.1 + sin(q.y * 0.7 + t * 0.6) * 1.5);
  float b = sin(q.y * 1.7 - t * 0.9 + sin(q.x * 0.9 - t * 0.5) * 1.5);
  float c = sin((q.x + q.y) * 1.1 + t * 0.7);
  float v = 1.0 - abs((a + b + c) * 0.3333);
  v *= v;
  return v * v * v * 2.5;
}

/**
 * Рядом с Осыпью место перестаёт держаться. В светлом воспоминании она — темнота: свет вокруг неё
 * пропадает. В тёмном она — свет, и он не освещает, а выжигает: поверхность белеет. И там и там место
 * рядом с ней рассыпается на точки — число замеров падает.
 */
void voidTouch(inout vec3 col, inout float h) {
  if (uVoid.w <= 0.0) return;
  float k = 1.0 - smoothstep(uVoid.w * 0.25, uVoid.w, length(vPosV - uVoid.xyz));
  if (k <= 0.0) return;
  if (uVoidK.x > 0.0) col *= 1.0 - 0.95 * k * uVoidK.x;
  else col += vec3(1.0, 0.93, 0.82) * (k * k * -uVoidK.x);
  h *= 1.0 - 0.8 * k * uVoidK.y;
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
  // Распад мира: поверхность выгорает клетками по 9 см; кромка дыры светится красным.
  float burn = 0.0;
  if (vDis > 0.0) {
    float edge = cellHash(vWorld * 11.0) - (vDis * 1.2 - 0.1);
    if (edge < 0.0) discard;
    burn = smoothstep(0.14, 0.0, edge) * min(1.0, vDis * 4.0);
  }
  // Давление (systems/pressure.ts): по полу помещения бежит красная сетка, потом он рассыпается кругом
  // от дальнего угла; под опускающимся потолком сетка идёт по потолку. Сетка светится сама.
  float press = 0.0;
  if ((uPress.z > 0.0 || uPress.w > 0.0) && vArch > 0.5 && vSurf.x < 0.5 && vWorld.x > uPressBox.x && vWorld.x < uPressBox.z && vWorld.z > uPressBox.y && vWorld.z < uPressBox.w) {
    vec2 gq = abs(fract(vWorld.xz * 2.0) - 0.5);
    float line = smoothstep(0.455, 0.49, max(gq.x, gq.y));
    if (vSurf.y > 0.5 && uPressY.z <= 0.0 && abs(vWorld.y - uPressY.x) < 0.2) {
      // За фронтом пола нет; кромка ломаная, перед ней сетка горит ярче.
      float dO = distance(vWorld.xz, uPress.xy) + (cellHash(vec3(vWorld.x * 5.0, 1.0, vWorld.z * 5.0)) - 0.5) * 0.5;
      if (uPress.z > 0.0 && dO < uPress.z) discard;
      float edge = uPress.z > 0.0 ? 1.0 - smoothstep(0.0, 1.1, dO - uPress.z) : 0.0;
      press = max(line * max(uPress.w, edge), edge * edge * 0.45);
    } else if (vSurf.y < -0.5 && uPressY.z > 0.0 && vWorld.y > uPressY.x + 0.5 && vWorld.y < uPressY.y + 0.3) press = line * uPress.w;
    burn = max(burn, press);
  }
  // Распад вещи: поверхность распадается на зёрна по 2 см. У каждого зерна свой срок: пока он не
  // пришёл, зерно закрывает свою клетку целиком; потом сжимается в точку и пропадает.
  if (vObj > 0.0) {
    vec3 gp = vWorld * 48.0;
    vec3 gc = floor(gp);
    float turn = cellHash(gc) * 0.7;
    float keep = 1.0 - smoothstep(turn, turn + 0.3, vObj);
    // Как только срок пришёл, зерно — уже круглая точка в своей клетке (а не квадрат клетки), и она сжимается.
    if (keep < 0.999) {
      vec3 centre = 0.35 + 0.3 * vec3(cellHash(gc + 7.1), cellHash(gc + 13.7), cellHash(gc + 29.3));
      if (length(fract(gp) - centre) > 0.52 * keep) discard;
    }
  }
  // Вещь, выросшая под взглядом, — облако точек: «словно из точек, чтобы было понятно, что её можно
  // пройти насквозь» (слова партнёра). Клетка ~11 см в мире: чем больше выросла, тем реже точки; точка
  // остаётся крупной — около трёх сантиметров, — чтобы облако читалось и издали, и в упор.
  float dotGlow = 0.0;
  if (uDots > 0.0) {
    vec3 dp = vWorld * 9.0;
    vec3 dc = floor(dp);
    vec3 centre = 0.3 + 0.4 * vec3(cellHash(dc + 3.1), cellHash(dc + 5.7), cellHash(dc + 9.3));
    if (length(fract(dp) - centre) > mix(0.9, 0.3, uDots)) discard;
    dotGlow = uDots;
  }
  // Мох слоями (shell texturing): поверхность повторена слоями, и в каждом остаются только ворсинки,
  // дотянувшиеся до него. У каждой ворсинки (клетка в четыре миллиметра) своя высота; кверху она уже.
  if (vShell > 0.0) {
    vec2 mq = vUv * 260.0;
    float tall = cellHash(vec3(floor(mq), 5.0));
    if (tall < vShell || length(fract(mq) - 0.5) > 0.62 * (1.0 - 0.75 * vShell / max(tall, 1e-3))) discard;
  }
  // Стирание места и кружево. Стёртый потолок пропадает совсем (над головой чернота), стёртые стены
  // и пол остаются нитями; на кромке стёртого поверхность редеет зерном. Вещь из кружева — нити целиком.
  float laceK = step(0.5, vLace);
  float gone = archGone();
  if (gone > 0.0) {
    bool ceil_ = (vSurf.x < 0.5 && vSurf.y < -0.5) || vArch > 1.5;
    if (gone >= 1.0) {
      if (ceil_) discard;
      laceK = 1.0;
    } else if (cellHash(floor(vWorld * 48.0) + 17.0) < gone) laceK = 1.0;
  }
  // Линия-нить по ребру (LACE_EDGE) — сама нить: сетка по граням к ней не относится.
#ifndef LACE_EDGE
  if (laceK > 0.5) {
    vec3 gn = abs(normalize(cross(dFdx(vWorld), dFdy(vWorld))));
    vec2 q = gn.y > 0.6 ? vWorld.xz : (gn.x > gn.z ? vWorld.zy : vWorld.xy);
    // Нить не тоньше полутора точек кадра: вдали кружево не пропадает, а сливается в дымку.
    float px = length(fwidth(q));
    // Узор свой у каждой вещи (аудит мест: «кружево — одна машинная сетка»): поворот и шаг сети — от
    // номера предмета или сида вещи; у стен и пола — общий.
    float ls = 1.0;
    if (vSeed > 0.5) {
      float a = cellHash(vec3(floor(vSeed + 0.5), 5.0, 11.0)) * 3.14159;
      ls = 0.8 + 0.45 * cellHash(vec3(floor(vSeed + 0.5), 9.0, 2.0));
      q = mat2(cos(a), sin(a), -sin(a), cos(a)) * q / ls;
    }
    if (laceDist(q) * ls > max(0.0035, 0.75 * px)) discard;
  }
#endif
  vec3 Ng = normalize(vNrmV);
#ifdef SLIDE
  // Проекция — не вещь, а свет на том, что позади: комната, которой нет. В темноте она светится сама,
  // а свет её смывает, как смывает картинку проектора: чем ярче здесь луч фонаря или лампы потолка,
  // тем меньше от неё остаётся. Выгорает она зерном — и сквозь дыру видно то, что за ней на самом деле.
  {
    vec4 lbS = beamAt(vPosV);
    float distS0 = length(vPosV);
    if (int(vMat + 0.5) == 24) {
      // Окно в ложную комнату. Оттенок вершины здесь не цвет, а размеры: ширина окна, его высота и
      // высота нижнего края над полом, м.
      vec3 rdW = normalize(vWorld - cameraPosition);
      vec3 nW = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
      if (dot(nW, rdW) > 0.0) nW = -nW;
      vec3 tW = normalize(cross(vec3(0.0, 1.0, 0.0), nW));
      vec3 rdL = vec3(dot(rdW, tW), rdW.y, dot(rdW, -nW));
      vec2 q = (vUv - 0.5) * vColor.rg;
      // Окно смотрит в зал не из середины торца, а сбоку: столбы и проёмы видны под углом.
      vec3 colI = fakeHall(vec3(q.x + 1.6, q.y, 0.0), rdL, -(vColor.b + vColor.g * 0.5), dot(uAmbient, vec3(0.3333)));
      // Стекло: под скользящим углом в нём отражается тёмная касса; блик фонаря.
      float graze = pow(1.0 - abs(dot(normalize(vPosV), Ng)), 3.0);
      colI = mix(colI, uAmbient * 0.3, 0.55 * graze);
      vec3 Ri = reflect(normalize(vPosV), Ng);
      colI += uLightColor * (pow(max(dot(Ri, lbS.xyz), 0.0), 120.0) * lbS.w * 0.35);
      colI += uBurnTint * burn;
      gl_FragColor = vec4(mix(uFogColor, colI, exp(-uFog * distS0)), 1.0);
      return;
    }
    if (int(vMat + 0.5) == 30) {
      // Экран: стекло, за которым светится картинка. Свет её не смывает — на стекле остаётся только
      // блик фонаря. Вблизи видны строки матрицы; подсветка чуть дышит.
      vec3 pic = texture2D(uScreens, vUv).rgb;
      float rows = mix(1.0, 0.9 + 0.1 * sin(vWorld.y * 480.0), smoothstep(3.5, 1.2, distS0));
      float back = 0.96 + 0.04 * sin(uSlide.w * 5.0 + vWorld.x * 2.0);
      // Яркость подстроена под помещение, как у настоящего экрана: при свете панелей он ярче.
      float roomS = dot(uAmbient, vec3(0.3333)) * cellLight(vWorld.xz);
      vec3 colS = pic * (uSlide.z * (2.2 + 9.0 * min(roomS, 0.6)) * rows * back) + vec3(0.004, 0.005, 0.007);
      vec3 Rs = reflect(normalize(vPosV), Ng);
      colS += uLightColor * (pow(max(dot(Rs, lbS.xyz), 0.0), 120.0) * lbS.w * 0.35);
      colS += uBurnTint * burn;
      gl_FragColor = vec4(mix(uFogColor, colS, exp(-uFog * distS0)), 1.0);
      return;
    }
    float lightS = lbS.w * uLightColor.r * (1.0 / 3.3) + dot(uAmbient, vec3(0.3333)) * cellLight(vWorld.xz);
    float wash = smoothstep(uSlide.x, uSlide.y, lightS);
    // Зерно сидит на самой картинке (клетки по 1,5 см) и «кипит», пока свет на ней.
    if (cellHash(vWorld * 66.0 + vec3(0.0, 0.0, floor(uSlide.w * 11.0))) < wash) discard;
    float distS = length(vPosV);
    // Лампа проектора дышит; к краям картинка темнее, чем в середине.
    vec2 q = vUv * 2.0 - 1.0;
    float lampS = (0.93 + 0.07 * sin(uSlide.w * 9.0) * sin(uSlide.w * 2.3 + 1.1)) * (1.0 - 0.3 * dot(q, q) * 0.5);
    vec3 img = vColor.rgb * (uSlide.z * lampS * (1.0 - 0.6 * wash));
    img += uBurnTint * burn;
    gl_FragColor = vec4(mix(uFogColor, img, exp(-uFog * distS)), 1.0);
    return;
  }
#endif
  int mi = int(vMat + 0.5);
  vec4 ma = uMatA[mi];
  vec4 mb = uMatB[mi];
  int cls = int(mb.y + 0.5);
  int mj = int(mb.z + 0.5);
  float ao = vColor.a;
  float wall = vSurf.x;
  float up = vSurf.y;
  float hgt = vSurf.z;
  // Тень-пятно: под мебелью и вокруг неё пол темнее. Рассеянный свет теней не даёт, и без пятна вещи
  // висят над полом; карта запечена при сборке уровня — одна выборка, годится и телефону.
  if (uContactGrid.z > 0.0 && up > 0.5 && hgt < 0.2) {
    vec4 ct = texture2D(uContact, (vWorld.xz - uContactGrid.xy) / uContactGrid.z);
    float tierI = -floor((vWorld.y + 0.2) / uTierDrop);
    ao *= 1.0 - (tierI < 0.5 ? ct.r : (tierI < 1.5 ? ct.g : (tierI < 2.5 ? ct.b : ct.a)));
  }
  // Просвет: тонкое (бумага, перо, травинка) пропускает свет. Свет за ним — оно светится своим цветом.
  float thin = mb.w;

  // Надписи и плакаты: uv указывает в атлас, а не в мир.
  vec3 ink = vec3(1.0);
  vec2 uvw = vUv;
  if (cls == 6 && vUv.x >= 2.0) {
    // Бумага (world/papers.ts): u сдвинуто на 2 + номер слоя. Каждый приход стирает — и на листе это
    // видно так же, как в памяти: чем сильнее стёрто место, тем более мелкая копия листа берётся. Лица
    // и буквы уходят первыми, пятна света и тени остаются, а сам лист выцветает к цвету бумаги.
    vec2 pu = vec2(fract(vUv.x), vUv.y);
    float lay = floor(vUv.x) - 2.0;
    float fadeP = smoothstep(0.0, 0.62, uErase.w);
    float worn = 4.5 * fadeP;
    vec3 pg;
    if (lay < 2.5) {
      // Портреты: лица не сохраняются. Издали — лица, вблизи лицо расплывается, а одежда, поза и фон
      // студии остаются; весь лист при этом чуть теряет резкость — навести её не выходит. Где лицо,
      // сказано в альфа-канале слоя: 1 — лица нет, 0,5 — середина лица (scripts/papers_import.py).
      float nearP = 1.0 - smoothstep(1.4, 6.0, length(vPosV));
      vec4 soft = texture(uPapers, vec3(pu, lay), worn + 1.6 * nearP);
      vec3 gone = texture(uPapers, vec3(pu, lay), worn + 4.4 * nearP).rgb;
      pg = mix(soft.rgb, gone, smoothstep(0.06, 0.5, (1.0 - soft.a) * 2.0));
    } else {
      pg = texture(uPapers, vec3(pu, lay), worn).rgb;
    }
    ink = mix(pg, vec3(dot(pg, vec3(0.3, 0.59, 0.11))) * vec3(1.06, 1.0, 0.86) + 0.05, 0.6 * fadeP);
    uvw = pu * 5.0;
  } else if (cls >= 6) {
    vec4 sg = texture2D(uSigns, vUv);
    if (cls == 7 && sg.a < 0.5) discard;
    if (cls == 6) ink = sg.rgb;
    uvw = vUv * 5.0;
  }

  vec4 lb = beamAt(vPosV);
  vec3 L = lb.xyz;
  float facing = smoothstep(-0.02, 0.1, dot(Ng, L));
  // Сколько света фонаря проходит насквозь: лист повёрнут к нему изнанкой.
  float through = thin * max(-dot(Ng, L), 0.0);
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
  // Там, куда карта не достаёт (и на телефоне, где её нет вовсе), тень переплёта крыши считается по формуле.
  float shadowKey = roofShade();
#ifdef SHADOWS
  if (uShadowFor > 0.5) {
    shadowKey = mix(shadow, shadowKey, smoothstep(0.76, 0.98, 2.0 * max(abs(sc.x - 0.5), abs(sc.y - 0.5))));
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
  float eLight = lb.w * shadow * (facing + through * 0.7) * lamp;
  // Рассеянный свет здесь — свет потолочной панели этой клетки (где панелей нет, cell = 1).
  float cell = cellLight(vWorld.xz);
  // Зал ожидания: солнце светит через стеклянную крышу зала и на перрон; в комнатах под потолком его нет.
  if (uKeyCells > 0.0) shadowKey *= smoothstep(0.7, 0.95, cell / uKeyCells);
  vec3 amb = uAmbient * cell;
  float eAmb = dot(amb, vec3(0.3333));
  // Свет памяти у искомой вещи: сколько его здесь (с наклоном поверхности) — для сборки точек.
  vec4 ml = memLight();
  float eMem = ml.w * max(dot(Ng, ml.xyz), 0.0) * dot(uRecallColor.rgb, vec3(0.3333));
  // Светильник светится, только пока свет в его клетке включён.
  float glowK = mi == 37 ? cell : 1.0;
  // Сетка давления светится сама: её видно и там, куда фонарь не достаёт.
  float eGlow = max(ma.y * maxc * glowK, press * 0.6);
  float distV = length(vPosV);
  // Настоящий сканер хуже видит то, от чего луч не возвращается: поверхность, по которой он скользит,
  // стекло (луч уходит насквозь), чёрную резину и бакелит (луч гаснет), мокрый пол (луч отражается прочь).
  float toCam = abs(dot(Ng, vPosV)) / max(distV, 1e-3);
  // Белая матовая бумага — наоборот, лучший отражатель в убежище: плакат и лист на столе «сканируются»
  // плотнее стены вокруг, и печать на них читается раньше, чем проступает сама стена.
  // Пол под ногами держится дольше стен: пропавший пол читается не туманом, а провалом, и стены над
  // ним висят плитами (слова партнёра под кадрами зала ожидания с телефона: «Кажется что-то
  // сломалось», «Провалы в сценах»). Поэтому скольжение луча пол почти не прореживает, а рассеянный
  // свет собирает пол дальше, чем стены.
  float floorK = smoothstep(0.5, 0.9, up);
  float back = mix(mix(0.6, 0.92, floorK), 1.0, smoothstep(0.03, 0.4, toCam)) * (mi == 24 ? 0.35 : (mi == 7 || mi == 23 ? 0.6 : (mi == 12 ? 0.78 : (mi == 30 || mi == 15 ? 1.8 : 1.0))));
  // Прямой свет пространства тоже «сканирует»: освещённая сторона плотнее теневой.
  float keyLit = (max(dot(Ng, uKeyDirV), 0.0) + thin * 0.7 * max(-dot(Ng, uKeyDirV), 0.0)) * dot(uKeyColor, vec3(0.3333)) * shadowKey;
  float hLit = (eLight + bounce0 * 1.2) * uScan.y * back;
  // На лугу и у лампы тень реже освещённой стороны. В зале ожидания (uKeyCells > 0) почти всё стоит
  // под крышей, в тени; там место собирает не солнце, а неподвижность — тень собрана так же плотно.
  float keyK = uKeyCells > 0.0 ? 1.0 : min(1.0, keyLit * 3.0 + step(dot(uKeyColor, vec3(1.0)), 0.001));
  // Слова партнёра: «локации должны распадаться, как от света фонарика. Не важно светлые они или
  // темные: собрано только там, куда смотрит герой». Рассеянный свет собирает место только в конусе
  // взгляда: в середине сплошь, к краю россыпью, за краем — ничего (там остаются только точки памяти
  // о том, куда герой смотрел только что). Ширина конуса — у места своя; по умолчанию как у луча фонаря.
  // Вершина конуса — глаз, а не рука с фонарём: у самой стены рука оказывается за её плоскостью, и
  // стена перед лицом не собиралась бы вовсе.
  // Взгляд — по форме кадра. Круглый конус подобран под широкий экран; на высоком (телефон в руке) он
  // накрывал только середину, и пол под ногами оставался несобранным, а стены висели плитами без низа.
  // В высоком кадре вертикаль при счёте угла сжимается так, чтобы низ кадра лежал от оси взгляда там
  // же, где низ широкого (gazeTall в render/renderer.ts): пол под ногами собран, а края — не сплошь.
  vec3 gzP = vec3(vPosV.x, vPosV.y * uGazeTall, vPosV.z);
  vec3 gzL = vec3(uLightDirV.x, uLightDirV.y * uGazeTall, uLightDirV.z);
  vec3 gzD = normalize(gzL);
  vec3 gzQ = normalize(gzP);
  float cosG = dot(gzQ, gzD);
  // Край взгляда — не ровный круг: он рвётся и гуляет по кругу, как край пятна дешёвого фонаря, и переход
  // к пустоте вдвое шире. Ровный круг на широком экране читался подзорной трубой: внутри собрано, по краю
  // плотная кайма точек, углы чёрные (аудит мест, 16.11). Узор неровности стоит в кадре, а не в мире.
  vec3 gz1 = normalize(cross(gzD, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  float gzA = atan(dot(gzQ, cross(gz1, gzD)), dot(gzQ, gz1));
  float rag = 0.5 * sin(gzA * 3.0 + 0.7) + 0.3 * sin(gzA * 7.0 + 2.1) + 0.2 * sin(gzA * 13.0 + 4.4);
  float angG = acos(clamp(cosG, -1.0, 1.0));
  float gazeK = mix(1.0, 1.0 - smoothstep(acos(uGazeCone.y) * 0.85, acos(uGazeCone.x) * (1.08 + 0.13 * rag), angG), uGaze);
  vec2 rangeV = uScanRange * mix(1.0, 1.7, floorK);
  // Свет памяти собирает своё пятно издалека — дальность сборки его не режет; вне взгляда он собран
  // вполовину (россыпью), во взгляде — сплошь: вещь видна издалека, но правило взгляда остаётся.
  float hEnv = uScan.z * (min(1.0, eGlow * 4.0) + min(1.0, eAmb * 8.0) * (0.72 + 0.28 * keyK) * back * gazeK * (1.0 - smoothstep(rangeV.x, rangeV.y, distV)) + min(1.0, eMem * 5.0) * back * mix(0.5, 1.0, gazeK));
  // Пространство, чьё время выходит, редеет; светящееся (красный контур выхода, небо) держится до конца.
  float hScan = min(uScan.z, max(uScan.x, hLit + hEnv)) * mix(mix(0.06, 1.0, uScanFade), 1.0, step(0.004, eGlow));
  // Число замеров уходит в альфу кадра: по нему следующий проход решает, показать ли саму поверхность
  // (в ядре луча, где сплаты слились) или только точки на ней.
  float hOut = 1.0;
#ifdef SCAN
  hOut = hScan / uScan.z;
  // Проверка на устройстве: вместо цвета — из чего сложилась сборка поверхности. Три служебных кадра
  // подряд (app.ts, probeTick), пиксели читает строка проверки:
  //   1 — r взгляд, g рассеянный свет (×8), b дальность, a итог;
  //   2 — r свет клетки, g «отдача» поверхности (/2), b вклад фонаря, a множитель угасания места;
  //   3 — r метка (0,5 — поверхность нарисована; 1 — где-то в счёте NaN), gb — клетка, которую видит
  //       видеокарта ((индекс + 0,5) / клеток), a — вклад рассеянного света. Фон и выброшенное — нули.
  if (uDebugView > 0.5) {
    if (uDebugView > 2.5) {
      bool bad = isnan(hLit) || isnan(hEnv) || isnan(cell) || isnan(gazeK) || isnan(back) || !(hLit + hEnv > -1e30);
      vec2 cg = uCellGrid.w > 0.5 ? (floor((vWorld.xz - uCellGrid.xy) / uCellGrid.z) + 0.5) / uCellGrid.w : vec2(0.0);
      gl_FragColor = vec4(bad ? 1.0 : 0.5, clamp(cg, 0.0, 1.0), clamp(hEnv / uScan.z, 0.0, 1.0));
    } else if (uDebugView > 1.5) {
      gl_FragColor = vec4(clamp(cell, 0.0, 1.0), clamp(back * 0.5, 0.0, 1.0), clamp(hLit / uScan.z, 0.0, 1.0), mix(mix(0.06, 1.0, uScanFade), 1.0, step(0.004, eGlow)));
    } else {
      gl_FragColor = vec4(gazeK, min(1.0, eAmb * 8.0), 1.0 - smoothstep(rangeV.x, rangeV.y, distV), hOut);
    }
    return;
  }
  // Туда, где света почти нет, фактуры не нужны: поверхность — просто цвет материала.
  if (hLit < 0.1 && eGlow < 0.004 && eAmb < 0.02 && eMem < 0.004) {
    vec3 flat_ = uMatBase[mi] * vColor.rgb * ao;
    vec3 colG = flat_ * (amb * (0.66 + 0.34 * up) + uLightColor * (eLight * 0.45 + bounce0 * bounceTint));
    colG += uBurnTint * burn;
    voidTouch(colG, hOut);
    gl_FragColor = vec4(mix(uFogColor, colG, exp(-uFog * distV)), hOut);
    return;
  }
#endif

  // Неровный отражатель дешёвого фонаря: пятно в разводах, в самой середине — тёмная точка.
  vec2 cuv = vec2(dot(-L, uLightRightV), dot(-L, uLightUpV));
  lb.w *= (0.84 + 0.32 * texture2D(uGrime, cuv * 1.7 + 0.5).g) * (1.0 - 0.2 * smoothstep(0.04, 0.0, length(cuv)));

  // Узор не должен повторяться (слова партнёра: «чтобы не видно было стыков и дублирования
  // паттернов, иначе выглядит дешево»). Карта грязи тайлится каждые три с половиной метра, и пятна
  // вставали рядами. Теперь её координаты плавно уводит волна с несоизмеримыми длинами, а к первой
  // выборке подмешана вторая — в другом масштабе и повёрнутая: решётки повторов больше нет.
  vec2 warp = vec2(sin(uvw.y * 0.61 + uvw.x * 0.23 + 1.3) + 0.6 * sin(uvw.x * 0.37 - 0.9), sin(uvw.x * 0.53 - uvw.y * 0.19 + 0.7) + 0.6 * sin(uvw.y * 0.31 + 2.1));
  vec4 g1 = texture2D(uGrime, uvw * 0.29 + warp * 0.07);
#ifdef DETAIL
  vec4 g1b = texture2D(uGrime, mat2(0.829, -0.559, 0.559, 0.829) * uvw * 0.173 + 0.41);
  // Среднее двух выборок бледнее каждой: контраст возвращаем, но не с запасом — иначе пятен сырости и
  // плесени становится больше, чем было, и они ложатся ровной россыпью по всей стене.
  g1 = clamp((mix(g1, g1b, 0.42) - 0.5) * 1.12 + 0.5, 0.0, 1.0);
#endif
  // Слои без своего рисунка: бетон, штукатурка, краска, ржавчина (0–3), пол (8), земля и обмотка труб (12, 13).
  bool loose = cls < 6 && (ma.z < 3.5 || abs(ma.z - 8.0) < 0.5 || (ma.z > 11.5 && ma.z < 13.5));
#ifdef HEXTILE
  vec4 d0 = loose ? hexDetail(uvw * ma.w, ma.z) : texture(uDetail, vec3(uvw * ma.w, ma.z));
#else
  vec4 d0 = texture(uDetail, vec3(uvw * ma.w, ma.z));
  // Без шестиугольной укладки (среднее и низкое качество, телефон) слой фактуры повторялся раз в метр:
  // штукатурка зала ожидания читалась плиткой (аудит 16.11). Вторая выборка — повёрнутая и в другом
  // масштабе — ломает решётку повторов у слоёв без своего рисунка; кирпич и плитку она не трогает.
  if (loose) d0 = mix(d0, texture(uDetail, vec3(mat2(0.829, -0.559, 0.559, 0.829) * uvw * ma.w * 0.71 + 0.37, ma.z)), 0.45);
#endif
  // Пестрота фактуры: в запущенном месте ±45 %, в чистом (офис, зал ожидания) — вдвое-втрое меньше:
  // чистый вокзал не бывает в пятнах «камуфляжа» (аудит 16.11).
  float alb = 1.0 + (0.9 * d0.g - 0.45) * mix(0.35, 1.0, clamp(1.0 + uDecay * 2.0, 0.0, 1.0));
#ifdef DETAIL
  // Большая ровная стена не бывает одного тона: плавные пятна в несколько метров и помельче. Они же
  // прячут повтор самой фактуры. В чистых местах (офис) их вдвое меньше, в «чистом» рендере нет вовсе.
  alb *= 1.0 + (1.0 - uPlain) * mix(0.5, 1.0, clamp(1.0 + uDecay * 2.0, 0.0, 1.0)) * (0.11 * (softNoise(vWorld * 0.23 + 7.3) - 0.5) + 0.05 * (softNoise(vWorld * 0.9 + 1.7) - 0.5));
#endif
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
  vec4 g2 = texture2D(uGrime, uvw * 1.31 + 0.37 - warp.yx * 0.05);
  vec4 d1 = texture(uDetail, vec3(uvw * uMatA[mj].w, uMatA[mj].z));
#else
  vec4 g2 = g1.brga;
  vec4 d1 = d0;
#endif
  // Чешуйки: краска и побелка отваливаются лоскутами, поэтому край облезшего места ломаный.
  vec4 fl = texture(uDetail, vec3(uvw * (cls == 1 ? 2.3 : 1.15), 16.0));
  // Облезает стена не ровной россыпью пятен, а участками: где-то она цела на несколько метров, где-то
  // сошла почти вся. Участки задаёт плавный шум в три-четыре метра; мелким пятнам остаётся меньше веса.
  // В чистых местах (офис, зал ожидания) участков нет: там и облезать нечему.
#ifdef DETAIL
  float region = (softNoise(vWorld * 0.21 + 11.7) - 0.5) * 0.34 * damp;
#else
  float region = 0.0;
#endif
  // Запущенность добавляет облезлости до середины шкалы в полную силу, дальше — слабее: на нижнем ярусе
  // стена не превращается в сплошные пятна.
  float worn = 0.3 * min(uDecay, 0.25) + 0.18 * max(uDecay - 0.25, 0.0);
  if (cls == 1) {
    float p = g1.g * 0.4 + g2.g * 0.2 + low * 0.36 + high * 0.18 + crev * 0.27 + worn - 0.05 + region + (fl.r - 0.5) * 0.17;
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
      // Бетон, пол, кирпич: пятна сырости, на полу — лужицами. На стене сырость держится у пола (она
      // поднимается от него) и редко забирается выше: посреди стены пятно — исключение, а не узор.
      wet = smoothstep(0.52, 0.8, g1.g * mix(0.75, 0.5, wall) + g2.g * 0.2 + uDecay * 0.5 + low * 0.95 + (1.0 - wall) * max(up, 0.0) * 0.12 - 0.3);
      // У стен на полу лежит то, что с них осыпалось: чешуйки краски и побелки.
      float chips = step(0.5, up) * step(0.66, fl.r) * smoothstep(0.08, 0.3, fl.g) * smoothstep(0.12, 0.42, crev + g2.r * 0.12);
      stain = mix(stain, vec3(1.75, 1.72, 1.6), chips * 0.75 * (1.0 - wet * 0.6));
      H += chips * 0.004;
    } else {
      // Побелка: отваливается пластами от сырых мест.
      float p = g1.g * 0.43 + g2.g * 0.2 + low * 0.42 + high * 0.14 + crev * 0.22 + worn - 0.1 + region + (fl.r - 0.5) * 0.14;
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
  // Плесень: колонии в углах и под потолком. Ровные тёмные пятна одного размера по всей стене читались
  // как камуфляж (снимок партнёра с кирпичной стеной). У колонии сплошная только середина; к краю она
  // редеет на пятнышки — поле плесени решает, сколько чешуек фактуры ею заняты. Посреди стены её мало.
  float moldK = smoothstep(0.72, 1.02, g2.g * 0.4 + g1.r * 0.25 + crev * 0.5 + high * 0.3 + uDecay * 0.32) * step(0.5, float(cls)) * (1.0 - step(4.5, float(cls)));
  float mold = moldK * smoothstep(1.0 - moldK, 1.15 - moldK, fl.r * 0.75 + d0.g * 0.35);
  stain *= mix(vec3(1.0), vec3(0.3, 0.36, 0.25), mold * 0.85);
  // Нижний ярус: по стенам, полу и потолку ползёт чёрная поросль — следы роя. Тонкие извилистые
  // жилы и редкие «гнёзда» в углах; мокрая, чуть выпуклая.
  float deep = smoothstep(0.62, 0.84, uDecay) * (1.0 - step(5.5, float(cls)));
  float vein = 1.0 - smoothstep(0.0, 0.012 + 0.03 * g2.g, abs(g1.g - 0.52 + (g2.r - 0.5) * 0.14));
  // Гнёзда сидят в углах и щелях, а не посреди стены: без угла порог не взять.
  float nest = smoothstep(0.8, 0.92, g1.r * 0.45 + g2.g * 0.35 + crev * 0.6);
  float slime = max(vein * smoothstep(0.35, 0.6, g1.r + crev * 0.5), nest) * deep;
  stain *= mix(vec3(1.0), vec3(0.045, 0.05, 0.045), slime);
  wet = max(wet, slime * 0.9);
  H += slime * 0.006;
  // Потёки по стенам.
  shade *= 1.0 - wall * smoothstep(0.55, 0.9, g1.b) * max(0.22 + 0.3 * uDecay, 0.0) * grimeK;
  alb = mix(alb, 0.55 + 0.9 * d1.g, k);
#ifdef DETAIL
  H = mix(H, d1.r * uMatB[mj].x - 0.002, k);
#ifdef LACE_EDGE
  // На линии экранные производные вырождены: рельефа у нити нет.
  vec3 N = Ng;
#else
  vec3 N = perturb(Ng, vPosV, H);
#endif
  float dirt = mix(1.0, (0.62 + 0.5 * g2.r) * (0.8 + 0.4 * g1.g), grimeK);
#else
  vec3 N = Ng;
  float dirt = mix(1.0, 0.72 + 0.56 * g1.r, grimeK);
#endif
  // Чистое пространство (жёлтые комнаты): ни пестроты, ни рельефа, ни грязи, ни сырости — поверхность
  // это шар материала и оттенок, больше ничего.
  if (uPlain > 0.5) {
    alb = 1.0;
    k = 0.0;
    wet = 0.0;
    shade = 1.0;
    stain = vec3(1.0);
    dirt = 1.0;
    N = Ng;
  }

  // Matcap по направлению на фонарь.
  vec3 bx = normalize(vec3(L.z, 0.0, -L.x) + vec3(1e-5, 0.0, 0.0));
  vec3 by = cross(L, bx);
  vec3 mc = matcap(mi, N, bx, by);
  vec3 base = uMatBase[mi];
  vec3 mc2 = matcap(mj, N, bx, by);
  // Сырой бетон становится мокрым бетоном. Сырой кирпич остаётся кирпичом: он темнеет и лоснится, но
  // кладка сквозь пятно видна — иначе на стене не сырость, а серая заплата.
  float swap = max(k, wet * (mi == 19 ? 0.22 : 0.85));
  mc = mix(mc, mc2, swap);
  base = mix(base, uMatBase[mj], swap);
#ifdef DETAIL
  // Рельеф под лучом: чем сильнее свет скользит по поверхности, тем резче тени пор и кромок.
  float ngl = dot(Ng, L);
  float relief = clamp(dot(N, L) / max(ngl, 0.08), 0.0, 2.2);
  shade *= mix(1.0, relief, 0.8 * smoothstep(0.02, 0.22, ngl));
  shade *= mix(0.86 + 0.14 * d0.b, 1.0, uPlain);
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
  // Прошедший насквозь свет окрашен листом дважды — цвет гуще и теплее, блика нет.
  vec3 glowThrough = base * tint * tint * vec3(1.25, 1.05, 0.8);
  col += glowThrough * uLightColor * (lb.w * shadow * through * 0.9);

  // Отсвет от освещённого пятна: мягко подсвечивает окрестности, как рассеянный от стены свет.
  float bounce = bounce0 * (0.35 + 0.65 * max(dot(N, toB / max(db, 1e-3)), 0.0));
  // Луч на воде: отсвет не ровный, а сетью бегущих бликов — между ними темнее, на линиях втрое ярче.
  if (uCaustic > 0.0) bounce *= 1.0 + uCaustic * (caustic(vUv, uSlide.w) * 2.4 - 0.45);
  // Рассеянный свет пространства идёт больше сверху (небо, потолок), чем снизу; прямой — от солнца или лампы.
  vec3 skyLit = amb * (0.66 + 0.34 * up) + uKeyColor * (max(dot(N, uKeyDirV), 0.0) * shadowKey);
  col += base * tint * ao * (skyLit * lit + uLightColor * bounceTint * bounce);
  // Свет памяти — как рассеянный, но со своей стороны и своего цвета (на экранах и табличках его нет).
  if (ml.w > 0.0) col += base * tint * ao * uRecallColor.rgb * (ml.w * max(dot(N, ml.xyz), 0.0) * lit);
  // То же на просвет: солнце за листом, отсвет от стены позади него и свет потолка сквозь лепесток,
  // на который смотрят снизу.
  if (thin > 0.0) col += glowThrough * thin * (uKeyColor * (max(-dot(N, uKeyDirV), 0.0) * shadowKey) + uLightColor * bounceTint * (bounce0 * 0.65 * max(-dot(N, toB / max(db, 1e-3)), 0.0)) + amb * (0.9 * ao * lit * max(-up, 0.0)));

  // Мокрый пол и плитка отражают освещённое пятно: блик тянется от дальней стены к ногам.
  float gloss = max(wet, mi == 12 ? 1.0 : (mi == 18 ? 0.5 : 0.0)) * step(0.5, up);
  vec3 R = reflect(normalize(vPosV), N);
  col += uLightColor * (uBounce.w * 16.0 * gloss * pow(max(dot(R, toB / max(db, 1e-3)), 0.0), 48.0)) * (0.6 + 0.4 * d0.b);

  // Свечение. У фосфорных табличек (оттенок до 1) цвет даёт основа материала; у экранов, окон и неба
  // оттенок вершины больше единицы — он и есть цвет, помноженный на яркость (основа тогда серая).
  vec3 glowBase = maxc > 1.5 ? vec3(0.55) : uMatBase[mi];
  col += glowBase * ma.y * vColor.rgb * glowK;
  col += uBurnTint * burn;
  // Вещь из точек чуть светится своим цветом: облако видно и на краю луча, и оно не похоже на твёрдое.
  if (dotGlow > 0.0) col += uMatBase[mi] * vColor.rgb * (0.22 * dotGlow);
  // Тон предмета: выцветший теряет цвет (остаётся бумага), расцветший светится своим цветом сам.
  if (vTone.x > 0.0) col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 0.92, vTone.x * 0.88);
  if (vTone.y > 0.0) col += uMatBase[mi] * vColor.rgb * (vTone.y * 0.38);
  // Нить кружева — выцветшая: от цвета поверхности остаётся намёк, остальное — белёсая пряжа.
  if (laceK > 0.5) col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))), col, 0.3) * 1.25 + vec3(0.004, 0.004, 0.005);
  // Краски уходят раньше формы (вариант A): с кругами место выцветает к серому. Та же кривая, что
  // decayAt().paint — smooth(0,08; 0,7) от стёртости.
  float paintK = smoothstep(0.08, 0.7, uErase.w);
  if (paintK > 0.0) col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), paintK * 0.7);
  voidTouch(col, hOut);
  col = mix(uFogColor, col, exp(-uFog * distV));
  // Буфер сцены восьмибитный: плавный свет на гладкой стене ложится ступенями. Неподвижное зерно в
  // полшага (±1 %) их разбивает.
  col *= 1.0 + (cellHash(vec3(floor(gl_FragCoord.xy), 7.0)) - 0.5) * 0.02;
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
  float od = objState().x;
  vec4 mv = viewMatrix * vec4(crumble(wp.xyz, uDissolve), 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  // Чуть к камере, чтобы линия не тонула в своей же поверхности.
  gl_Position.z -= 0.0012 * gl_Position.w;
  // У растворённого предмета нет и сетки.
  if (od > 0.6) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
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
attribute float aObj;
uniform highp sampler2D uObjState;
${WIND_GLSL}
void main() {
  // Растворяющийся предмет тени не отбрасывает (как и отдельная вещь).
  if (aObj > 0.5) {
    int id = int(aObj + 0.5);
    if (texelFetch(uObjState, ivec2(id & 63, id >> 6), 0).r > 0.4) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  }
  // Светящееся (небо над лугом, абажуры, красный контур выхода) тени не отбрасывает: иначе купол неба
  // закрыл бы от солнца весь луг.
  if (aMat > 13.5 && aMat < 14.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
#ifdef USE_INSTANCING
  // Копии одной сетки (птицы): тень — от птицы с раскрытыми крыльями, без взмаха.
  vec4 wp = modelMatrix * (instanceMatrix * vec4(position, 1.0));
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz = windSway(wp.xyz);
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
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
uniform float uPolar;       // 0 — место тёмное, и она — свет; 1 — место светлое, и она — темнота
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

  // Тёмная, она плотнее и крупнее: закрывает собой то, что за ней.
  float px = uSize * uProj / max(-pv.z, 0.05) * mix(0.8, 1.2, held) * mix(1.0, 1.8, uPolar);
  float alpha = min(1.0, uAlpha * (0.5 + 0.5 * aRnd.w) * (1.0 - 0.5 * t) * mix(1.0, 2.4, uPolar));
  if (px < 1.6) {
    alpha *= px * px / 2.56;
    px = 1.6;
  }
  gl_PointSize = min(px, uMaxPx);

  // Цвет. Большинство точек — выцветшие, цвета кости; часть помнит краски мест, с которых осыпалась.
  float k = fract(aRnd.w * 7.0 + seed * 3.0);
  vec3 tint = k < 0.6 ? vec3(0.85, 0.82, 0.75) : (k < 0.75 ? vec3(0.78, 0.56, 0.3) : (k < 0.9 ? vec3(0.36, 0.56, 0.42) : vec3(0.72, 0.3, 0.22)));
  // Она — негатив места (слова партнёра: «Поглощает темнота в светлых воспоминаниях и в темных,
  // наоборот, это яркий свет, который тебя разъедает»). В темноте её точки — белый жар: светятся сами,
  // и чем их больше в одном месте, тем ближе к белому; краски мест, с которых она осыпалась, видны
  // только под лучом фонаря. На свету она чёрная: не светится и света не берёт — дыра в кадре.
  vec3 hot = vec3(1.0, 0.94, 0.84) * ((0.55 + 1.1 * aRnd.w) * uDarkGain);
  vec3 lightForm = hot + uLightColor * (beam * 0.42) * tint;
  vCol = vec4(mix(lightForm, vec3(0.003, 0.003, 0.005), uPolar), alpha);
  // Призрак — цвета красной сетки: знак системы, а не вещь мира. Свет фонаря на него не ложится.
  if (ghost) vCol = vec4(vec3(0.95, 0.16, 0.08) * (0.5 * uDarkGain), alpha);
  gl_Position = pc;
}
`;

/**
 * Пыль вещи. «Память — пыль»: тронутая вещь не выгорает и не разлетается, а уходит своими же
 * точками — и из них же собирается, когда возвращается (слова партнёра: распад и сборка — «через
 * точки»). Точки посеяны по поверхности вещи заранее (render/grains.ts), у каждой — цвет места, с
 * которого она сойдёт, и свой срок.
 *
 * Точки не оседают. Отделившись, точка чуть отходит от поверхности, мельчает и гаснет в воздухе;
 * растворилась последняя — от вещи не осталось ничего (слова партнёра: «Вещь когда исчезает не должно
 * быть точек в пространстве, они не оседают, а полностью растворяются»). Сборка — тот же путь назад:
 * точки проступают из ничего у поверхности и встают на места, где тут же нарастают зёрна.
 *
 * uGo — насколько вещь растворена (0 — стоит, 1 — её нет). Пока срок точки не пришёл, её не видно:
 * на её месте ещё стоит зерно поверхности (WORLD_FRAG). uFlow — докуда дошло растворение (путь
 * точки: 0 — на поверхности, 1 — её нет).
 *
 * Рисуется тем же проходом и той же формой, что точки мира (SPLAT_FRAG); за стеной пыли не видно.
 */
export const GRAIN_VERT = /* glsl */ `
attribute vec3 aNrm;
attribute vec3 aCol;        // цвет места без света: материал × оттенок
attribute vec4 aRnd;        // x — срок точки, yzw — случайные числа
uniform highp sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uTime;
uniform float uSize;
uniform float uProj;
uniform float uMaxPx;
uniform float uGo;          // 0..1: насколько вещь растворена
uniform float uFlow;        // 0..1+: докуда дошло растворение (отстаёт от uGo: точка гаснет дольше, чем тает поверхность)
uniform float uFade;        // 0..1: насколько видно облако (при сборке оно проступает)
uniform vec3 uAmbient;
uniform float uDarkGain;
varying vec4 vCol;
varying vec3 vShape;

${BEAM_GLSL}

float linDepth(float d) {
  return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}

void main() {
  vCol = vec4(0.0);
  vShape = vec3(1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  // Срок точки: пока он не пришёл, на её месте стоит зерно поверхности. Пришёл — точка видна; путь
  // (0 — на поверхности, 1 — растворилась) она проходит по uFlow. Верх вещи сходит чуть раньше низа.
  float turn = aRnd.x * 0.6;
  float out_ = smoothstep(turn, turn + 0.05, uGo);
  if (out_ <= 0.0) return;
  float phi = clamp((uFlow - turn) / 0.5, 0.0, 1.0);
  if (phi >= 1.0) return;

  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * aNrm);
  // Отходит от поверхности и чуть всплывает — с торможением, как в воде, и никуда не падает.
  float lift = 1.0 - (1.0 - phi) * (1.0 - phi);
  // Пыль большой вещи разлетается шире: масштаб выросшей вещи сидит в её матрице (у стен и мелочи он 1).
  float spread = sqrt(max(1.0, length(modelMatrix[0].xyz)));
  // И сыплется в обе стороны: выросшую вещь чаще видно изнутри, а пыль, что уходит только наружу, прячется за
  // уцелевшей поверхностью — растворение было не видно. Половина её летит внутрь, на игрока.
  float side = spread > 1.01 && aRnd.y < 0.5 ? -1.0 : 1.0;
  vec3 p = wp.xyz + wn * ((0.04 + 0.12 * aRnd.w) * lift * spread * side) + vec3(0.0, 0.05 * aRnd.z * lift * spread, 0.0);
  float t = uTime * (1.3 + aRnd.y) + aRnd.z * 6.2832;
  p += vec3(sin(t), 0.0, cos(t * 0.8)) * (0.015 * lift);

  vec4 pv = viewMatrix * vec4(p, 1.0);
  vec4 pc = projectionMatrix * pv;
  if (pc.w <= 0.0) return;
  vec2 uv = pc.xy / pc.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;
  if (-pv.z > linDepth(texture2D(tDepth, uv).r) + 0.03) return;

  // Гаснет на ходу и мельчает: к концу пути её нет.
  float alpha = (1.0 - smoothstep(0.1, 1.0, phi)) * out_ * uFade * (0.6 + 0.4 * aRnd.y);
  if (alpha <= 0.004) return;
  // Пылинки большой вещи крупнее: хлопья, а не мука (у остальных множитель 1).
  float px = uSize * uProj / max(-pv.z, 0.05) * mix(1.4, 0.5, phi) * mix(1.0, spread, 0.5);
  if (px < 1.6) {
    alpha *= px * px / 2.56;
    px = 1.6;
  }
  gl_PointSize = min(px, uMaxPx);

  // Свет: фонарь и рассеянный свет места. Вне луча точки тлеют сами — так же, как место, с которого
  // свет ушёл, ещё держится в памяти: иначе вещь на краю луча пропадала бы раньше, чем растворилась.
  vec4 lb = beamAt(pv.xyz);
  vec3 light = uLightColor * (lb.w * 0.55) + uAmbient * 0.9 + vec3(0.2, 0.21, 0.24) * uDarkGain;
  vCol = vec4(aCol * light, alpha);
  gl_Position = pc;
}
`;

/**
 * Тихий слой архитектуры: точки по рёбрам и углам стен (world/edges.ts; вариант A, слова партнёра:
 * «Тихий слой, это точки по ребрам и углам, иногда пробегает сонар, чтобы игрок понимал хоть какой-то план»).
 * Видны всегда, даже в темноте, но тихо и только то, что не закрыто стеной (глубина готового кадра);
 * дальше 7 м гаснут. Сонар — волна от игрока: её фронт зажигает точки ярче, за ним они остывают, а на
 * миг волна показывает план и сквозь стены — в темноте; при фонаре едва (у темноты остаётся её смысл).
 * Свет пишется поверх кадра; усиление камеры его не разгоняет.
 */
export const EDGE_VERT = /* glsl */ `
attribute float aTier;
attribute float aKind;
uniform highp sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uProj;
uniform vec2 uTiers;      // какие ярусы видны: с какого по какой
uniform vec4 uSonar;      // xyz — откуда пошла волна, w — её радиус, м
uniform float uSonarK;    // 0..1: сила волны (гаснет к концу пути)
uniform float uQuiet;     // 0..1: сила тихого слоя
uniform float uGainInv;   // 1 / усиление камеры
uniform float uXray;      // насколько волна видна сквозь стены: в темноте — сильно, при фонаре — едва
varying vec3 vCol;

float linDepth(float d) {
  return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}

void main() {
  vCol = vec3(0.0);
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aTier < uTiers.x - 0.5 || aTier > uTiers.y + 0.5) return;
  vec4 pv = viewMatrix * vec4(position, 1.0);
  float dist = -pv.z;
  if (dist < 0.08) return;
  vec4 pc = projectionMatrix * pv;
  vec2 uv = pc.xy / pc.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;
  bool hidden = dist > linDepth(texture2D(tDepth, uv).r) + 0.06 + dist * 0.004;
  float r = distance(position, uSonar.xyz);
  float dr = r - uSonar.w;
  float front = exp(-dr * dr / 0.8);
  float after = dr < 0.0 ? exp(dr / 4.0) : 0.0;
  float sonar = uSonarK * (1.3 * front + 0.4 * after);
  float quiet = hidden ? 0.0 : uQuiet * (1.0 - smoothstep(8.0, 22.0, dist));
  float a = max(quiet, sonar * (hidden ? uXray : 1.0));
  // План читается по углам и проёмам: их точки чуть ярче.
  a *= aKind > 1.5 ? 1.3 : 1.0;
  if (a < 0.004) return;
  gl_PointSize = clamp(0.026 * uProj / dist, 1.4, 3.2) * (1.0 + 0.4 * front * uSonarK);
  // Холодный цвет: точки плана не путаются с тёплыми точками места, которые собирает свет.
  vec3 tint = mix(vec3(0.5, 0.72, 0.84), vec3(0.62, 1.0, 1.0), clamp(sonar, 0.0, 1.0));
  vCol = tint * a * uGainInv;
  gl_Position = pc;
}
`;

export const EDGE_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q, q) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * (1.0 - 0.6 * r2), 1.0);
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
uniform vec3 uFogColor;     // во что уходит даль (тот же цвет, что у мира)
uniform float uHMax;
uniform vec4 uCone;
uniform float uDissolve;
uniform float uSeedW;
uniform vec3 uFocusPosV;
uniform vec3 uFocusDirV;
uniform float uFocusOn;
uniform vec3 uEdl;          // объём для точек: xy — шаг выборок глубины (доли экрана), z — сила
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
  // Объём для точек (eye-dome lighting, приём сканеров). У облака точек нет ни нормалей, ни теней — без
  // подсказки оно плоское. Точка темнее, если рядом с ней на экране есть что-то ближе к камере: дальняя
  // стена за краем ближней вещи уходит в тень, и силуэты читаются. Четыре выборки глубины на точку.
#ifdef EDL
  float zl = log2(max(zp, 0.05));
  float occ = max(0.0, zl - log2(max(linDepth(texture2D(tDepth, puv + vec2(uEdl.x, 0.0)).r), 0.05)))
    + max(0.0, zl - log2(max(linDepth(texture2D(tDepth, puv - vec2(uEdl.x, 0.0)).r), 0.05)))
    + max(0.0, zl - log2(max(linDepth(texture2D(tDepth, puv + vec2(0.0, uEdl.y)).r), 0.05)))
    + max(0.0, zl - log2(max(linDepth(texture2D(tDepth, puv - vec2(0.0, uEdl.y)).r), 0.05)));
  float edl = 0.25 + 0.75 * exp(-occ * uEdl.z);
#else
  float edl = 1.0;
#endif
  // Что ярче: в полутьме сразу после света точка не должна провалиться в черноту.
  vec3 pcol = max(old * aMem, lit * smoothstep(0.0, 0.3, hk)) * edl;
  // В светлых местах несобранное уходит в цвет тумана, а не темнеет: точка при свете — тем ближе к туману,
  // чем меньше у неё замеров; точка памяти — свежая цвета места, старая цвета тумана. Иначе на ходу дальние
  // стены зала ожидания покрывались тёмной крупой по белому туману — «телевизионный снег», а не «уходит в
  // белое» (аудит мест, 16.11).
  if (uAmbientScan > 0.0) {
    vec3 memB = mix(uFogColor, kept * uMemGain, fresh);
    vec3 litB = mix(uFogColor, lit, smoothstep(0.25, 1.0, hk));
    pcol = mix(pcol, (aMem > aLit ? memB : litB) * edl, uAmbientScan);
  }
  vCol = vec4(pcol, alpha);
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
uniform highp sampler2D tDepth; // глубина мира этого кадра: где она пуста, там небо
uniform float uKeep;       // какая доля яркости прошлого кадра остаётся (0 — выдержки нет)
uniform float uMosh;       // 0..1: разрыв кадра — какая доля блоков ещё не обновилась
uniform vec2 uMoshShift;   // на сколько кадр сдвинулся с прошлого раза, доли экрана
uniform float uFmt;        // «пиксель формата» в пикселях буфера (см. POST_FRAG): блоки на экране одного размера при любом зерне
varying vec2 vUv;

void main() {
  // Разрыв кадра (datamosh). Когда снимок в зале ожидания рвётся, новый кадр приходит не весь сразу:
  // блоки по шестнадцать точек какое-то время держат прошлый кадр — то, что было, — и он тянется по
  // движению камеры поверх того, что есть. У каждого блока свой срок; чем дальше от разрыва, тем меньше
  // их осталось. Так рвётся сжатое видео, потерявшее опорный кадр.
  if (uMosh > 0.0) {
    uvec2 blk = uvec2(gl_FragCoord.xy / uFmt) / 16u;
    uint hb = blk.x * 0x27d4eb2du ^ blk.y * 0x165667b1u;
    hb ^= hb >> 15; hb *= 0x2c1b3c6du; hb ^= hb >> 12;
    float lot = float(hb & 0xffffu) / 65535.0;
    if (lot < uMosh) {
      // Прошлое не просто едет за камерой, а ещё и оплывает вниз — у каждого блока по-своему.
      vec2 from = vUv - uMoshShift - vec2(0.0, 0.0012 + 0.0024 * lot);
      gl_FragColor = vec4(texture2D(tPrev, clamp(from, 0.001, 0.999)).rgb, 1.0);
      return;
    }
  }
  vec3 now = texture2D(tNow, vUv).rgb;
  // Малый вычет — чтобы след гас до конца, а не застревал на шаге 1/255.
  vec3 was = max(texture2D(tPrev, vUv).rgb * uKeep - 0.0015, 0.0) * step(0.001, uKeep);
  // Небо в выдержку не идёт: звёзды от лёгкого покачивания камеры тянулись вертикальными штрихами, как
  // дождь (аудит мест, 16.11). Кроме звёзд, там ничего нет — следа там и не бывает.
  if (texture2D(tDepth, vUv).r > 0.99999) was = vec3(0.0);
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
uniform float uDrift;     // 0..1: кадр плывёт — цвета расходятся сильнее (кривая ощущений за сессию)
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
// Мелкое зерно (сильный компьютер, QUALITY.ultra): буфер крупнее, шум сенсора и точки мельче. А то, что
// принадлежит формату записи, — строки развёртки, маска кинескопа, блоки срыва, ореол, разлёт цветов —
// на экране остаётся прежним: оно считается в «пикселях формата» (uFmt пикселей буфера в каждом; число
// не обязательно целое — на экране 1920 × 1080 это полтора, и строка развёртки занимает то один, то два
// пикселя буфера, а период у строк тот же, что на обычном высоком качестве).
uniform float uFmt;
uniform float uLodFine;   // на сколько ступеней уменьшенных копий сдвинут ореол: буфер крупнее — ширина ореола на экране та же
uniform vec4 uGradeLo;    // цвет камеры у места: xyz — оттенок теней, w — сколько цвета остаётся (1 — весь)
uniform vec3 uGradeHi;    // оттенок светов

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
  uvec2 fx = uvec2(gl_FragCoord.xy / uFmt);
  uint frame = uint(uFrame);

  // Срыв сигнала: блоки 16 px уезжают по горизонтали, часть кадра рассыпается на крупные квадраты.
  if (uGlitch > 0.0) {
    uvec2 blk = fx / 16u;
    float h = hash(blk, frame / 3u + 7u);
    if (h < uGlitch * 0.35) {
      uv.x += (hash(blk, frame / 3u + 31u) - 0.5) * 0.12 * uGlitch;
      // Квадраты — только у сильного сбоя (вспышка, разрыв): у слабого они читались битыми пикселями
      // экрана, а не сбоем записи (аудит 16.11). Слабый сбой только сдвигает блоки и строки.
      if (uGlitch > 0.45) {
        float sq = 8.0 * uFmt;
        uv = (floor(uv * uRes / sq) + 0.5) * sq / uRes;
      }
    }
    float line = hash(uvec2(0u, fx.y / 3u), frame / 2u);
    if (line < uGlitch * 0.08) uv.x += (line - 0.02) * 0.6;
  }

  // Кинескоп: строки чуть гуляют по горизонтали, сильнее — когда картинка «под нагрузкой».
  if (uCrt > 0.0) {
    float wob = hash(uvec2(1u, fx.y / 2u), frame) - 0.5;
    uv.x += wob * 0.0022 * uCrt * uCrt;
  }

  vec3 col;
#ifdef CHROMA
  // Разлёт цветов невелик: мир собран из точек в два-три пикселя, и сильный разлёт растягивал бы
  // каждую в радужный штрих.
  // При мелком зерне точка занимает те же два-три пикселя, но уже более крупного буфера, поэтому разлёт
  // в долях кадра вдвое меньше — в пикселях он тот же.
  // К концу сессии кадр плывёт: разлёт медленно растёт и спадает (волну задаёт игра), втрое больше обычного на пике.
  float spread = (0.025 + 0.05 * uDrift) / uFmt;
  col.r = sampleScene(distort(uv, uBarrel * (1.0 + spread))).r;
  col.g = sampleScene(distort(uv, uBarrel)).g;
  col.b = sampleScene(distort(uv, uBarrel * (1.0 - spread))).b;
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
  vec3 glow = textureLod(tScene, hv, 3.5 + uLodFine).rgb * 0.4 + textureLod(tScene, hv, 5.5 + uLodFine).rgb * 0.6;
  float smear = texture2D(uGrime, vUv * vec2(uAspect, 1.0) * 0.55 + 0.13).g;
  col += glow * uBloom * (0.35 + 1.3 * smear * smear);
#else
  // Пыльный воздух светится вокруг луча. Дымки на этом качестве нет, поэтому сам луч дорисован прямо на
  // кадре: конус-призрак от руки (она за нижним правым краем) к пятну — у руки узкий, к пятну шире и
  // бледнее. Одна формула на точку, без прохода по глубине.
  vec2 hand = vec2(0.6 * uAspect, -1.3);
  vec2 ax = bc - hand;
  float al2 = max(dot(ax, ax), 1e-4);
  float sc = clamp(dot(c - hand, ax) / al2, 0.0, 1.0);
  vec2 off = c - hand - ax * sc;
  float wc = 0.04 + 0.26 * sc;
  float cone = exp(-dot(off, off) / (wc * wc)) * smoothstep(0.0, 0.3, sc) * (1.0 - 0.55 * sc);
  col += vec3(1.0, 0.95, 0.85) * uBeam.z * (exp(-dot(bd, bd) * 3.2) + 0.75 * cone);
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

  // Цвет дешёвой камеры — у каждого места свой. В убежище насыщенность приглушена, тени уходят в болотную
  // зелень, света — в желтизну; в жёлтых комнатах жёлтый держится, в зале ожидания тени без зелени.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uGradeLo.w) * mix(uGradeLo.xyz, uGradeHi, smoothstep(0.05, 0.6, l));
  // Провал в тенях: тёмное остаётся тёмным, а не серым.
  col *= smoothstep(-0.02, 0.09, l) * 0.35 + 0.65;

  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  // Чересстрочная фактура видеозаписи; с uCrt строки и маска кинескопа проступают сильнее.
  col *= 1.0 - (0.035 + 0.11 * uCrt) * float(fx.y & 1u);
  if (uCrt > 0.0) {
    uint tri = fx.x % 3u;
    col *= mix(vec3(1.0), vec3(tri == 0u ? 1.0 : 0.82, tri == 1u ? 1.0 : 0.82, tri == 2u ? 1.0 : 0.82), 0.45 * uCrt);
    // Бегущая полоса: светлая строка медленно сползает по кадру.
    float bar = fract(vUv.y + uFrame * 0.0031);
    col += vec3(0.05, 0.055, 0.06) * uCrt * smoothstep(0.035, 0.0, abs(bar - 0.5));
  }
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

/**
 * Звёздное небо (слова партнёра: «там нет потолка, только бесконечно глубокое звездное небо и изредка
 * падают звезды»). Небо стоит над уровнем всегда; видно его там, где нет потолка: в комнате под небом,
 * сквозь стёртый потолок на поздних кругах, сквозь стеклянную крышу зала ожидания к вечеру.
 *
 * «Бесконечно глубокое» сделано расстоянием: звёзды висят на разной высоте — от пяти метров над полом
 * до сотен, — и когда игрок идёт, ближние смещаются относительно дальних. Поле бесконечно: оно
 * повторяется ящиком вокруг камеры, но звёзды стоят в мире, а не едут за игроком.
 *
 * Падающие звёзды — три «места» с разными сроками: голова и хвост из точек позади неё. Когда и откуда
 * летит звезда, решает номер её срока, а не случай: кадры повторяемы.
 */
export const STAR_VERT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uCamPos;
uniform float uBright;   // 0..1: насколько небо видно (днём в зале ожидания — 0)
uniform float uPx;       // пикселей буфера на «пиксель» звезды при 720 строках
uniform vec4 uFall;      // падающая звезда по знаку игры: x — азимут, y — высота над горизонтом, рад; z — когда пошла; w — 1 есть
attribute vec4 aStar;    // x — яркость, y — размер, z — случайное число, w — 0 дальняя, 1 ближняя, 2..4 — падающая, 5 — по знаку
varying vec3 vCol;
varying float vBig;      // 0..1: крупная звезда — с ореолом

float hash1(float n) {
  return fract(sin(n * 127.1 + 3.7) * 43758.5453);
}

void main() {
  vec3 p;
  float b = aStar.x;
  if (aStar.w < 1.5) {
    // Дальние — в ящике со стороной 440 м и на высоте до 430 м; ближние — в ящике 90 м, от 5 до 45 м.
    float R = aStar.w < 0.5 ? 220.0 : 45.0;
    float y = aStar.w < 0.5 ? 26.0 + position.y * position.y * 400.0 : 5.0 + position.y * 40.0;
    vec2 xz = position.xz * R;
    xz = mod(xz - uCamPos.xz + R, 2.0 * R) - R;
    // К краю своего ящика звезда гаснет: перескок на другую сторону не виден.
    b *= 1.0 - smoothstep(0.72 * R, 0.98 * R, max(abs(xz.x), abs(xz.y)));
    p = vec3(uCamPos.x + xz.x, y, uCamPos.z + xz.y);
    // Мерцание: у каждой своя частота.
    b *= 0.72 + 0.28 * sin(uTime * (0.6 + 2.6 * fract(aStar.z * 7.31)) + aStar.z * 6.2832);
  } else if (aStar.w > 4.5) {
    // Падающая звезда по знаку игры: когда герой под небом впервые поднимает взгляд — там, куда он
    // смотрит. Тогда небо не спутать с несобранным потолком: тот тоже чёрный в белых точках (аудит мест).
    float ph = uTime - uFall.z;
    float dur = 1.4;
    vec3 start = uCamPos + vec3(cos(uFall.x) * cos(uFall.y), sin(uFall.y), sin(uFall.x) * cos(uFall.y)) * 150.0;
    float az2 = uFall.x + 1.5708;
    vec3 dir = normalize(vec3(cos(az2), -0.32, sin(az2)));
    float t = ph - position.x * 0.2;
    p = start + dir * (110.0 * t);
    float life = clamp(ph / dur, 0.0, 1.0);
    b = (uFall.w > 0.5 && t > 0.0 && ph < dur) ? (1.0 - position.x) * (1.0 - position.x) * sin(life * 3.1416) * 2.6 : 0.0;
  } else {
    float k = aStar.w - 1.0;
    // Падают изредка: у трёх «мест» сроки 32, 45 и 58 секунд, по всему небу — раз в четверть минуты.
    float period = 19.0 + 13.0 * k;
    float n = floor(uTime / period);
    float ph = uTime - n * period;
    float dur = 0.8 + 0.6 * hash1(n * 3.1 + k);
    float h1 = hash1(n * 1.7 + k * 11.3);
    float h2 = hash1(n * 2.9 + k * 5.1);
    float h3 = hash1(n * 4.3 + k * 2.7);
    float az = h1 * 6.2832;
    float el = 0.6 + 0.7 * h2;
    vec3 start = uCamPos + vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el)) * 150.0;
    float az2 = az + 1.5708 + (h3 - 0.5) * 1.8;
    vec3 dir = normalize(vec3(cos(az2), -0.3 - 0.35 * h3, sin(az2)));
    // position.x — место точки в хвосте: 0 — голова, 1 — его конец.
    float t = ph - position.x * 0.2;
    p = start + dir * (120.0 * t);
    float life = clamp(ph / dur, 0.0, 1.0);
    b = (t > 0.0 && ph < dur) ? (1.0 - position.x) * (1.0 - position.x) * sin(life * 3.1416) * 2.2 : 0.0;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Звезда — на дальней плоскости камеры: место на экране то же, стены и потолок её закрывают. Дальняя
  // плоскость у камеры — 70 м, а дальние и падающие звёзды висят в 150–430 м: без этого видеокарта их
  // отсекала, и на небе оставались только ближние — без полосы и без падающих (аудит мест, 16.11).
  gl_Position.z = gl_Position.w * 0.99999;
  gl_PointSize = max(1.0, aStar.y * uPx);
  float v = b * uBright;
  if (v < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // Звёзды холоднее точек скана и разного размера: крупные — с ореолом. Тёплая — каждая пятая.
  float hue = fract(aStar.z * 3.7);
  vCol = (hue < 0.8 ? mix(vec3(0.66, 0.8, 1.0), vec3(0.86, 0.92, 1.0), hue * 1.25) : vec3(1.0, 0.9, 0.78)) * v;
  vBig = smoothstep(3.0, 4.6, aStar.y);
}
`;

export const STAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vCol;
varying float vBig;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float a = smoothstep(0.5, 0.04, r);
  // У крупной звезды — яркое ядро и мягкий ореол, а не ровный диск, как у точки скана.
  if (vBig > 0.0) a = mix(a, max(smoothstep(0.2, 0.02, r), exp(-r * r * 16.0) * 0.45), vBig);
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

/**
 * Стекло крыши зала ожидания. До него крыши как бы не было — один переплёт на фоне ровного неба.
 * Стекло — тонкий слой поверх неба: пыль и потёки (гуще вдоль балок, куда их сносит дождь), белёсая
 * пелена под скользящим углом и само солнце — пятно с ореолом там, где взгляд совпал с направлением
 * на него; в пыльном стекле ореол шире. Солнце идёт по времени места: на снимке стоит.
 *
 * Прозрачность у нас занята (в альфе кадра лежит число замеров), поэтому слой смешивается с кадром
 * только по цвету: альфа кадра остаётся прежней (см. смешение у glassMat в renderer.ts). Цвет выходит
 * уже умноженным на непрозрачность пыли.
 */
export const GLASS_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GLASS_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSky;        // цвет неба за стеклом (он же цвет дали)
uniform vec3 uSunDirW;    // направление на солнце в мире
uniform vec3 uSunColor;   // его цвет и сила; ноль — солнца нет
uniform float uGlass;     // 0..1: насколько стекло видно (к ночи небо темнеет — и оно с ним)
varying vec3 vWorld;

float hash2(vec2 p) {
  ivec2 q = ivec2(floor(p)) + 32768;
  uint n = uint(q.x) * 0x27d4eb2du ^ uint(q.y) * 0x165667b1u;
  n ^= n >> 15; n *= 0x2c1b3c6du; n ^= n >> 12; n *= 0x297a2d39u; n ^= n >> 15;
  return float(n & 0xffffu) / 65535.0;
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / max(dist, 1e-3);
  // Под скользящим углом стекло белёсое: отражает зал и рассеивает небо.
  float graze = pow(1.0 - abs(V.y), 3.0);
  // Пыль: пятна в метр-два, мелкая рябь и потёки вдоль ската; у балок (каждые три метра) и прогонов
  // (каждые полтора) гуще.
  float cloud = noise2(vWorld.xz * 0.7 + 3.1) * 0.6 + noise2(vWorld.xz * 2.9 + 11.0) * 0.4;
  float streak = noise2(vec2(vWorld.x * 9.0, vWorld.z * 0.45));
  float nearBeam = 1.0 - smoothstep(0.1, 0.55, abs(fract(vWorld.z / 3.0 + 0.5) - 0.5) * 3.0);
  float nearPurlin = 1.0 - smoothstep(0.05, 0.3, abs(fract(vWorld.x / 1.5) - 0.5) * 1.5);
  float dust = clamp(0.1 + 0.2 * cloud + 0.16 * streak * cloud + 0.22 * max(nearBeam, nearPurlin * 0.7), 0.0, 0.6);
  // Солнце сквозь стекло: диск и ореол; пыль ореол ширит.
  float toSun = max(dot(-V, uSunDirW), 0.0);
  float sunK = dot(uSunColor, vec3(0.3333));
  vec3 sun = uSunColor * (pow(toSun, 1800.0) * 14.0 + pow(toSun, 90.0) * (0.25 + 1.3 * dust) + pow(toSun, 12.0) * 0.06 * dust);
  vec3 dustCol = uSky * vec3(0.6, 0.58, 0.52);
  float a = dust * uGlass;
  vec3 col = dustCol * a + uSky * (0.22 * graze * uGlass) + sun * uGlass * step(0.001, sunK);
  gl_FragColor = vec4(col, a);
}
`;
