/**
 * Рендер: один материал на весь мир, тень фонаря ручным depth-pass, один пост-проход «бодикам».
 * Сцена рисуется во внутренний буфер фиксированного размера (640×360 … 1280×720 по качеству),
 * canvas имеет тот же размер и растягивается CSS: дёшево для телефона и к лицу записи с камеры.
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import type { MeshData } from '../world/kit';
import type { LevelChunk, StairLink } from '../world/level';
import { birdMesh } from '../world/bird';
import { mushroomForm } from '../world/mushrooms';
import { headForm } from '../world/flowers';
import { GRASS_KINDS, GRASS_LODS, GRASS_VARIANTS, grassTile, grassTris } from '../world/grass';
import type { GrassLod } from '../world/grass';
import { GRASS_CLEAR, GRASS_FAR, GRASS_STRIDE } from '../systems/grass';
import type { LeanMap } from '../systems/grass';
import { BIRD_STRIDE, BIRDS_MAX } from '../systems/birds';
import { MAT_COUNT, MAT_DEFS } from '../world/materials';
import { SODIUM_GLOW } from '../world/props_greenhouse';
import { bakeDetail } from './detail';
import { bakeGrime } from './grime';
import { ATLAS_COLS, ATLAS_ROWS, bakeMatcapAtlas } from './matcap_atlas';
import { MAX_WORMS } from '../swarm/body';
import type { EdgePoints } from '../world/edges';
import type { PieceMask } from '../world/piece';
import type { OddScreen } from '../world/furnish_odd';
import type { OddKind } from '../systems/odd';
import { COMPOSE_FRAG, DEPTH_FRAG, DEPTH_VERT, DUST_FRAG, DUST_VERT, ECHO_FRAG, EDGE_FRAG, EDGE_VERT, GRAIN_VERT, HAZE_FRAG, MEMORY_FRAG, POST_FRAG, POST_VERT, SPLAT_FRAG, SPLAT_VERT, ENTITY_VERT, GLASS_FRAG, GLASS_VERT, SPOT_FRAG, STAR_FRAG, STAR_VERT, TRAIL_FRAG, TV_FRAG, WIRE_FRAG, WIRE_VERT, WORLD_FRAG, WORLD_VERT } from './shaders';
import { newGrainLife, objectTriangles, sowGrains, steerGrains, stepGrains } from './grains';
import { GRADE_DEFAULT, RINGS_DEFAULT } from './grade';
import type { Grade } from './grade';
export type { Grade } from './grade';
import type { GrainLife, Grains } from './grains';
import { clamp01, smoothstep } from '../core/math';
import { fillSky, skyLook, SKY_TOTAL } from './sky';
import { ECHO_MAX, ECHO_STRIDE } from '../systems/echo';
import type { PressureView } from '../systems/pressure';
import { SplatClouds } from './splats';

export type Quality = 'low' | 'med' | 'high' | 'ultra';

export interface QualitySpec {
  /** Число пикселей внутреннего буфера. */
  pixels: number;
  /** Сторона карты тени; 0 — тени выключены. */
  shadow: number;
  chroma: boolean;
  detail: boolean;
  dust: number;
  /** Сколько червей роя рисовать. */
  worms: number;
  /** Точек в одной пряди Осыпи. */
  strand: number;
  /** Дымка в луче: число шагов вдоль взгляда (0 — выключена) и во сколько раз её буфер меньше кадра. */
  haze: number;
  hazeDiv: number;
  /** Предметы режут дымку тенями. */
  hazeShadow: boolean;
  /** Точек-сплатов на квадратный метр поверхности в полную плотность (рядом с игроком) — при обычном зерне. */
  points: number;
  /** Объём для точек (eye-dome lighting): точки темнеют за краями ближних вещей. */
  edl: boolean;
  /** Шестиугольная укладка фактуры: бетон и штукатурка без решётки повторов (три выборки вместо одной). */
  hex: boolean;
  /**
   * Во сколько раз зерно кадра и точки распада мельче обычного (слова партнёра: «на десктопе при хорошем
   * железе на уровне hight нужно сделать зерно в 2 раза меньше, как и все растворяемые частицы»).
   * 1 — обычное зерно. Больше — буфер крупнее в fine² раз (pixels уже с этим множителем), а всё, что
   * считается в точках, — dust, strand, points — умножается на fine² при отрисовке: точка вдвое мельче,
   * точек вчетверо больше, поверхность покрыта так же. Сколько выйдет на деле, решает экран (fineOf).
   */
  fine: number;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pixels: 640 * 360, shadow: 0, chroma: false, detail: false, dust: 140, worms: 44, strand: 56, haze: 0, hazeDiv: 3, hazeShadow: false, points: 300, edl: false, hex: false, fine: 1 },
  med: { pixels: 960 * 540, shadow: 512, chroma: true, detail: true, dust: 300, worms: 68, strand: 80, haze: 8, hazeDiv: 3, hazeShadow: false, points: 600, edl: false, hex: false, fine: 1 },
  high: { pixels: 1280 * 720, shadow: 1024, chroma: true, detail: true, dust: 520, worms: MAX_WORMS, strand: 110, haze: 14, hazeDiv: 2, hazeShadow: true, points: 1100, edl: true, hex: true, fine: 1 },
  // Сильный компьютер: то же высокое качество, но вдвое мельче — и зерно, и точки. Тень фонаря тоже вдвое подробнее.
  ultra: { pixels: 4 * 1280 * 720, shadow: 2048, chroma: true, detail: true, dust: 520, worms: MAX_WORMS, strand: 110, haze: 14, hazeDiv: 2, hazeShadow: true, points: 1100, edl: true, hex: true, fine: 2 },
};

/** Решётка пыли выросшей вещи: клеток на метр — при кадре в 720 строк и выше и самое меньшее. */
export const DOT_GRID = { max: 22, min: 9, rows: 720 } as const;

/** Клеток пыли на метр при такой высоте кадра (в строках обычного зерна): мельче пикселя на трёх метрах пылинка не бывает. */
export function dotGrid(rows: number): number {
  return Math.min(DOT_GRID.max, Math.max(DOT_GRID.min, (DOT_GRID.max * rows) / DOT_GRID.rows));
}

/** Сколько точек в пряди Осыпи заведено всего: высокое качество при самом мелком зерне. */
const STRAND_MAX = 440;
/**
 * Досев при мелком зерне: точек на метр вчетверо больше, но сеять за кадр вчетверо больше нельзя —
 * посев идёт на процессоре, около десятой доли микросекунды на точку. Поэтому за кадр — не больше чем
 * в полтора раза против обычного: первый, редкий слой всё равно ложится сразу, а полная плотность
 * добирается на полсекунды дольше.
 */
const SOW_FINE_MAX = 1.5;

/**
 * Пыль выросшей вещи сеется по её настоящей площади (× scale²: посев идёт по сетке без масштаба), но не больше
 * стольких пылинок. Множитель ×6 и ×12 на кадре терялся: мяч, выросший всемеро, — это 14 м² поверхности, а
 * пылинок выходило 1200, по нескольку десятков на метр, среди сотен точек мира. 9000 — около миллисекунды
 * посева один раз и несколько секунд облака — по силам и телефону.
 */
const GIANT_GRAINS = 9000;

/** Всё, что нужно для одного кадра. */
export interface FrameView {
  camPos: Vec3;
  camYaw: number;
  camPitch: number;
  camRoll: number;
  lightPos: Vec3;
  lightDir: Vec3;
  /** Яркость фонаря, 0..~1.2. */
  lightIntensity: number;
  /** 0 — свежая батарейка (белый свет), 1 — почти села (жёлтый). */
  lightWarmth: number;
  /** Расстояние от фонаря до первой преграды по лучу, м. */
  beamDist: number;
  gain: number;
  noise: number;
  glitch: number;
  tunnel: number;
  /** 0..1: игрок в газу — жёлтая муть. */
  gas: number;
  /** 0..1: насколько здесь сыро и запущено (растёт с глубиной): облезшая краска, ржавчина, плесень. */
  decay: number;
  /** Чистое пространство: поверхности — только шар материала, без фактур и грязи (жёлтые комнаты). */
  plain?: boolean;
  /** Плотность взвеси в воздухе: насколько виден сам луч. */
  haze: number;
  fade: number;
  time: number;
  frame: number;
  /** Окружение пространства: рассеянный свет, цвет дали (он же фон) и плотность тумана. */
  ambient: Vec3;
  fogColor: Vec3;
  fogDensity: number;
  /** Множитель света фонаря в этом месте: 0 — фонарь «не проходит». */
  lightScale: number;
  /** Множитель плотности облака точек, 0..1: карманное пространство редеет, когда его время выходит. */
  scanFade: number;
  /** Прямой свет пространства: направление на источник (мир) и цвет; цвет [0,0,0] — прямого света нет. */
  keyDir: Vec3;
  keyColor: Vec3;
  /** Докуда рассеянный свет «сканирует» пространство, м: плотно до первого, россыпь после второго. */
  scanRange: [number, number];
  /** Где прямой свет даёт тени: центр и полуширина квадрата на земле (м) — он ходит за игроком; null — теней от него нет. */
  keyBox: { center: Vec3; half: number } | null;
  /**
   * Прямой свет попадает только туда, где много рассеянного (зал ожидания: солнце — в зале и на
   * перроне, но не в комнатах под потолком): общий множитель рассеянного света клеток. 0 — не действует.
   */
  keyCells?: number;
  /**
   * Правило взгляда, 0..1 (слова партнёра: «собрано только там, куда смотрит герой»): рассеянный свет
   * собирает место только в конусе взгляда. 0 — собирает везде, где достаёт (вспышка строба).
   */
  gaze?: number;
  /** Конус взгляда, градусы от его оси: [край, середина]. Не задан — как у луча фонаря: 52 и 25. */
  gazeCone?: readonly [number, number];
  /** Давление: помещение, где рассыпается пол или провисает потолок (systems/pressure.ts); нет — ничего. */
  press?: PressureView | null;
  /** Ветер: время (с; у места своё — в зале ожидания оно стоит вместе со снимком), размах свободного конца (м) и куда дует (x, z). Нет — штиль. */
  wind?: { t: number; amp: number; dir: readonly [number, number] };
  /** Шаги героя для травы и цветов у ног (WIND_GLSL, uPush): где ноги и радиус; нет — никто не мнёт. */
  push?: { at: Vec3; radius: number } | null;
  /** Зал ожидания: стеклянная крыша — её прямоугольник в мире (minX, minZ, maxX, maxZ) и высота переплёта, м. Нет — крыши нет. */
  roof?: { box: readonly [number, number, number, number]; y: number } | null;
  /**
   * Полярность Осыпи, 0..1 (слова партнёра: «Поглощает темнота в светлых воспоминаниях и в темных,
   * наоборот, это яркий свет»): 0 — место тёмное, она — свет и выжигает; 1 — светлое, она — темнота и поглощает.
   */
  polar?: number;
  /** 0..1: разрыв кадра — какая доля блоков ещё держит прошлый кадр (зал ожидания: снимок порвался). */
  mosh?: number;
  /** 0..1: луч фонаря лежит на воде — отсвет вокруг идёт рябью («зайчики» на стенах и потолке). */
  caustic?: number;
  /** Показывать ли тени-пятна под обстановкой уровня (карта задаётся setContact; в карманных пространствах её нет). */
  contact?: boolean;
  /** Звёздное небо, 0..1: насколько оно видно (0 — неба нет: карманные пространства, день в зале ожидания). */
  stars?: number;
  /**
   * 0..1: насколько небо видно сквозь несобранное. 1 — игрок в комнате под небом: её стены и всё, что свет не собрал,
   * бесконечность не режут (партнёр 17.11: «звездное небо должно быть полностью видно, это бесконечность»). 0 — небо
   * только там, где нет ничего (как было).
   */
  skyOpen?: number;
  /** Зерно неба (render/sky.ts): у каждой загрузки места своё — звёзды, млечный путь и туманности каждый раз другие. */
  skySeed?: number;
  /** Сцена — кусок места: игрок на месте (не в кармане), и помнится только кусок (setPiece). Нет поля — помнится всё. */
  piece?: boolean;
  /** Множитель «бочки» объектива: больше единицы — кадр растянут по краям, меньше — сжат. */
  lens?: number;
  /** Во сколько раз шире обзор (перекрут белой комнаты, systems/warp.ts). Нет поля — как есть. */
  fov?: number;
  /**
   * Белая комната (world/furnish_white.ts): коробка помещения — minX, minZ, maxX, maxZ — и пол с потолком. Её стены, пол и
   * потолок белые и светятся сами; то, что висит внутри, освещено этим светом. Нет — комнаты нет.
   */
  white?: { box: readonly [number, number, number, number]; y: readonly [number, number] } | null;
  /** Насколько герой в белой комнате, 0..1: там место собирается взглядом, как в светлом месте. */
  whiteIn?: number;
  /**
   * Натриевые лампы оранжереи (world/level.ts, BuiltLevel.lamps): середины трубок и коробка помещения. Красят собранное рядом
   * тёплым светом (WORLD_FRAG, lampLight); в шейдер идут LAMP.max ближних к камере. Нет — ламп нет.
   */
  lamps?: { pos: readonly Vec3[]; box: readonly [number, number, number, number]; y: readonly [number, number] } | null;
  /**
   * Странная комната (world/furnish_odd.ts; design.md, §37.1): род, коробка по полу, пол и потолок, где вещь и куда смотрит, где
   * герой (к нему баян сводит стены), squeeze — какую долю расстояния до героя стены прошли, rise — на сколько метров ушёл вверх
   * потолок (шарик), экран кинескопа (телевизор). Её облик и свет — в шейдере мира по коробке. Нет — комнаты нет.
   */
  odd?: OddView | null;
  /** Насколько герой в странной комнате, 0..1: там место собирается взглядом, как в светлом месте. */
  oddIn?: number;
  /** 0..1: след длинной выдержки и при свете (тяжесть в аквариуме, systems/odd.ts). Нет поля — как обычно. */
  trail?: number;
  /** Множитель углов луча фонаря (кривая ощущений, systems/feel.ts): меньше единицы — луч уже. Нет поля — как есть. */
  beamCone?: number;
  /** 0..1: кадр плывёт — цвета расходятся сильнее обычного (кривая ощущений; волну во времени накладывает игра). */
  drift?: number;
  /** 0..1: мир рассыпается в пыль. */
  dissolve: number;
  /** 0..1: красная полигонная сетка на всём, что видно. */
  wire: number;
  /** 0..1: насколько заметен кинескоп. */
  crt: number;
  /** 0..1: кадр выбелен (скачок между пространствами). */
  flash: number;
  /** 0..1: объектив запотел (вошёл с холода в тёплую сырую оранжерею); расчищается от середины к краям. Нет поля — сухой. */
  mist?: number;
  /** 0..1: пыль в воздухе — пыльца оранжереи: золотистая, медленная, едва видна и без луча. Нет поля — обычная пыль. */
  pollen?: number;
  /**
   * Эхо: волны от шагов и от Осыпи, по ECHO_STRIDE чисел на волну (x, y, z, радиус, сила, хвост, род, —);
   * у пустых мест сила — ноль. null — эха нет вовсе.
   */
  echo: Float32Array | null;
  /** 0..1: Осыпь за спиной, и впереди показан её призрак — отражение из-за спины. */
  ghost: number;
  /**
   * Сонар (вариант A): откуда пошла волна, её радиус, м, и сила 0..1; null — волны нет.
   */
  sonar?: readonly [number, number, number, number, number] | null;
  /** Сила тихого слоя — точек по рёбрам и углам, 0..1. Нет поля — слоя нет. */
  quiet?: number;
  /** Цвет кромки распада: красный системы (нет поля) или свой у места. */
  burnTint?: Vec3;
  /** Кадр не идёт в память света (переход): после него память начинается с чистого кадра. */
  memHold?: boolean;
  /**
   * Цвет «камеры» у места: lo — оттенок теней, hi — оттенок светов, sat — сколько цвета остаётся (1 — весь).
   * Нет поля — цвет убежища (GRADE_DEFAULT).
   */
  grade?: Grade;
  /** Сила колец дешёвого отражателя вокруг пятна фонаря. Нет поля — как в убежище (0,08). */
  rings?: number;
  /** Падающая звезда по знаку игры: азимут и высота над горизонтом, рад, и сколько секунд как пошла. null — нет. */
  fall?: readonly [number, number, number] | null;
  /**
   * Свет потолочных панелей по клеткам уровня (офис, жёлтые комнаты): data — size × size точек RGBA
   * (r — сколько рассеянного света в клетке, g — номер помещения), origin — угол сетки в мире (x, z),
   * step — шаг клетки, м. null — рассеянный свет везде одинаков.
   */
  cells: { data: Uint8Array; origin: [number, number]; step: number; size: number } | null;
  /** Сколько рассеянного света там, где стоит игрок, 0..1 (без света по клеткам — 1). */
  ambientLocal: number;
}

/** Странная комната для кадра (FrameView.odd). */
export interface OddView {
  kind: OddKind;
  box: readonly [number, number, number, number];
  y: readonly [number, number];
  at: Vec3;
  face: readonly [number, number];
  hero: readonly [number, number];
  squeeze: number;
  rise: number;
  /** Насколько ощущение сейчас здесь, 0..1 (под шариком пух закручивается). */
  k: number;
  /** Тихий режим: снег на экране кинескопа реже и тише. */
  quiet: boolean;
  screen: OddScreen | null;
}

/**
 * Кинескоп странной комнаты (K-32: «две секунды назад»): кольцо маленьких копий готового кадра — 60 кадров 128 × 72, по копии
 * каждые 1/30 с, — экран показывает самую старую: то, что герой видел две секунды назад. Около 2,2 МБ видеопамяти, и только
 * пока на уровне есть телевизор.
 */
const TV_RING = { frames: 60, every: 2 / 60, w: 128, h: 72 } as const;
/** Сила следа длинной выдержки в аквариуме: за сколько секунд гаснет след, когда тяжесть в полную силу (FrameView.trail). */
const TRAIL_HEAVY = 0.42;

/** Номер рода странной комнаты в шейдере (uOddY.z): 0 — комнаты нет. */
export const ODD_SHADER_KIND: Readonly<Record<OddKind, number>> = { bayan: 1, aquarium: 2, tv: 3, balloon: 4 };

/** Состояние «вещи» — отдельного предмета, который можно двигать, растить и рассыпать. */
export interface ThingView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** 0..1: вещь рассыпается. */
  dissolve: number;
  /** 0..1: красная сетка поверх вещи. */
  wire: number;
  /** Сетка видна сквозь стены. */
  xray: boolean;
  visible: boolean;
  /** 0..1: вещь — кружево: поверхности нет, одни нити по её рёбрам (ступень перед пустотой). */
  lace?: number;
  /** 0..1: вещь выросла под взглядом и стала облаком точек — сквозь неё проходят. */
  dots?: number;
}

/** Из чего вещь: из вещества, как всё; из света (проекция: светится сама, свет её смывает); из нитей (кружево). */
export type ThingLook = 'matter' | 'light' | 'lace';

interface Thing {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  wire: THREE.LineSegments | null;
  wireMat: THREE.ShaderMaterial | null;
  radius: number;
  data: MeshData;
  seed: number;
  look: ThingLook;
  /** Последний распад, о котором сообщила игра: по нему заводится облако пыли. */
  dis: number;
  /** Кружевная вещь: материал её нитей по рёбрам (LACE_EDGE); у остальных — null. */
  edgeMat: THREE.ShaderMaterial | null;
  /** Подробная вещь памяти: у неё свои карты цвета и нормалей (THING_TEX в шейдере мира). */
  maps: boolean;
}

/** Карты подробной вещи памяти (world/thing_hq.ts): адреса файлов. */
export interface ThingMaps {
  /** Цвет (RGB, sRGB) и затенение щелей (A). */
  color: string;
  /** Нормали (RG), шероховатость (B), металл (A). */
  normal: string;
}

/** Пыль кружева — цвета нитей, а не того, чем вещь была. */
function threadDust(g: Grains): void {
  for (let i = 0; i < g.count; i++) g.color.set([0.8, 0.78, 0.72], i * 3);
}

/** Облако пыли одной вещи (render/grains.ts): точки гаснут в воздухе — или собираются назад. */
interface Burst {
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  life: GrainLife;
}

/** Косинус угла, начиная с которого общее ребро двух граней считается изломом (около 20°). */
const CREASE_COS = 0.94;

/**
 * Рёбра сетки для красной сетки «системы»: только изломы (грани сходятся под углом больше ~20°) и края.
 * Диагонали плоских четырёхугольников не рисуются: сетка со всеми рёбрами треугольников превращала
 * вещь под взглядом в знак «нет картинки» — прямоугольник с крестом (аудит мест 16.11).
 */
export function edgeIndex(index: ArrayLike<number>, pos: ArrayLike<number>, vertexCount: number): Uint32Array {
  const first = new Map<number, number>();
  const flat = new Set<number>();
  const order: number[] = [];
  const normals: number[] = [];
  const n = [0, 0, 0];
  const faceNormal = (a: number, b: number, c: number): void => {
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    n[0] = uy * vz - uz * vy;
    n[1] = uz * vx - ux * vz;
    n[2] = ux * vy - uy * vx;
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l;
    n[1] /= l;
    n[2] /= l;
  };
  const visit = (a: number, b: number, f: number): void => {
    const k = a < b ? a * vertexCount + b : b * vertexCount + a;
    const g = first.get(k);
    if (g === undefined) {
      first.set(k, f);
      order.push(k, a, b);
      return;
    }
    const dot = normals[g * 3]! * normals[f * 3]! + normals[g * 3 + 1]! * normals[f * 3 + 1]! + normals[g * 3 + 2]! * normals[f * 3 + 2]!;
    if (dot > CREASE_COS) flat.add(k);
  };
  for (let i = 0, f = 0; i + 2 < index.length; i += 3, f++) {
    const a = index[i]!;
    const b = index[i + 1]!;
    const c = index[i + 2]!;
    faceNormal(a, b, c);
    normals.push(n[0]!, n[1]!, n[2]!);
    visit(a, b, f);
    visit(b, c, f);
    visit(c, a, f);
  }
  const out: number[] = [];
  for (let i = 0; i < order.length; i += 3) if (!flat.has(order[i]!)) out.push(order[i + 1]!, order[i + 2]!);
  return new Uint32Array(out);
}

/** Размер внутреннего буфера под соотношение сторон экрана и бюджет пикселей. */
export function internalSize(cssW: number, cssH: number, pixels: number, dpr = 1): [number, number] {
  const aspect = Math.max(0.3, Math.min(3.5, cssW / Math.max(1, cssH)));
  let h = Math.sqrt(pixels / aspect);
  let w = h * aspect;
  // Больше физического размера экрана рисовать незачем.
  const k = Math.min(1, (cssW * dpr) / w, (cssH * dpr) / h);
  w *= k;
  h *= k;
  return [Math.max(2, Math.round(w / 2) * 2), Math.max(2, Math.round(h / 2) * 2)];
}

/**
 * Насколько мелким выйдет зерно на этом экране: во сколько раз буфер выше, чем был бы при обычном зерне.
 * Мельче пикселя экрана зерна не бывает, поэтому на небольшом экране выходит меньше, чем просит качество
 * (1920 × 1080 — в полтора раза, 2560 × 1440 и больше — вдвое). Шаг — четверть: от мелкости зависит
 * плотность посева точек, а пересевать мир на каждое движение края окна дорого.
 */
export function fineOf(cssW: number, cssH: number, q: QualitySpec, dpr = 1): number {
  if (!(q.fine > 1)) return 1;
  const [, h] = internalSize(cssW, cssH, q.pixels, dpr);
  const [, base] = internalSize(cssW, cssH, q.pixels / (q.fine * q.fine), dpr);
  return Math.max(1, Math.min(q.fine, Math.round((h / base) * 4) / 4));
}

/** «Бочка» объектива нагрудной камеры в обычном состоянии. */
const BARREL = 0.085;

/**
 * Взгляд по форме кадра: во сколько раз сжать вертикаль при счёте угла взгляда (uGazeTall). Низ любого
 * кадра должен лежать от оси взгляда так же далеко, как низ широкого (16 : 9): там конус подобран.
 * В широком кадре — 1; в высоком (телефон в руке, угол обзора по вертикали 96°) — около 0,67. Сжать
 * сильнее нельзя: в портрете кадр собрался бы целиком и правило «собрано только там, куда смотрит
 * герой» на телефоне пропало бы.
 */
export function gazeTall(aspect: number): number {
  const wide = Math.tan((verticalFov(16 / 9) * Math.PI) / 360);
  const here = Math.tan((verticalFov(aspect) * Math.PI) / 360);
  return Math.min(1, wide / here);
}

/** Вертикальный угол обзора: в ландшафте держим широкий горизонтальный угол, в портрете не даём «рыбьему глазу» разъехаться. */
export function verticalFov(aspect: number): number {
  const hTarget = (106 * Math.PI) / 180;
  const v = 2 * Math.atan(Math.tan(hTarget / 2) / aspect);
  return Math.max(62, Math.min(96, (v * 180) / Math.PI));
}

/**
 * Облако точек (см. SCAN_GLSL и SPLAT_VERT). h — «число замеров» места: perLight — h на единицу
 * освещённости, max — предел (при нём сплаты слились и поверхность видна сама). hold — сколько
 * секунд место держится в памяти после того, как с него ушёл свет (MEMORY_FRAG): всё это время оно
 * редеет и осыпается, потом его нет.
 * lodDist — до этого расстояния точки стоят в полную плотность, дальше редеют как квадрат расстояния;
 * far — дальше этого точек нет совсем (к нему они гаснут), sow — сколько точек досевается за кадр на
 * каждую точку плотности (чем плотнее посев, тем больше работы за кадр, а время досева то же).
 * size — размер сплата в мире на плотность 1 точка на м²: чем плотнее посев, тем мельче сплат
 * (покрытие поверхности при этом одно и то же). maxPx — больше этого сплат на экране не бывает
 * (в долях высоты буфера). follow — как быстро «внимание скана» догоняет луч (1/с). smear — за
 * сколько секунд гаснет след яркого в кадре, когда фонарь не горит (длинная выдержка, TRAIL_FRAG).
 */
const SCAN = { perLight: 24, max: 3.5, hold: 7, lodDist: 3.5, far: 28, sow: 45, size: 0.7, maxPx: 0.013, follow: 8, followBuild: 2.2, smear: 0.55 } as const;

/**
 * Проекции — картинки из света (world/flat.ts). washFrom…washTo — при каком свете в точке картинка
 * начинает выгорать и когда пропадает совсем (мерка — освещённость луча фонаря: в его середине на
 * трёх метрах около 0,6, в ореоле — 0,1, в дальнем разливе — 0,015); gain — её яркость.
 */
const SLIDE = { washFrom: 0.012, washTo: 0.11, gain: 0.085 } as const;
/**
 * Натриевые лампы оранжереи (WORLD_FRAG, lampLight; design.md, §35): сколько самое большее в шейдере, докуда светит лампа вбок, м
 * (вниз — в 1,6 раза дальше: у трубок отражатель), и сила их света против свечения трубок. Сила подобрана по кадрам (25.11): при
 * 0,4 тепло тонуло в белом пятне фонаря, при 1,5 едва читалось; при 2,2 грядка и пол под лампой в ореоле луча оранжевые, а середина
 * пятна — тёплая белая.
 */
const LAMP = { max: 8, radius: 2.8, gain: 2.2 } as const;
/** Яркость скана сонара по целым стенам (WORLD_FRAG, uSonarTint): кольцо из точек, видное и в полной темноте. */
const SONAR_SCAN = 1.2;
/**
 * Сколько гроздей грибов рисуется разом. Мест вчетверо с лишним больше прежнего (партнёр 19.11: «нужно увеличить плотность
 * грибов минимум в 4 раза»): рядом с Осыпью на позднем круге их проросло до шестисот, на «высоком» видны все.
 */
export const SPORES_MAX = 880;
/** Предел по качеству — ближайшие столько гроздей (места уже упорядочены от ближнего): у видов по 350–1150 треугольников. */
const SPORES_CAP: Readonly<Record<Quality, number>> = { low: 240, med: 480, high: SPORES_MAX, ultra: SPORES_MAX };
/**
 * Дальше стольких метров от камеры гроздь рисуется упрощённой (world/mushrooms.ts, LOD_FAR): вдвое меньше треугольников,
 * а на шести метрах гроздь — несколько десятков точек кадра, разницы не видно.
 */
const SPORE_LOD_AT = 6;
/**
 * Грибы вне кадра не рисуются: шар грозди (радиус ball × размер) проверяется по пирамиде обзора этого кадра (с запасом margin
 * радиан — на дрожь камеры и край кадра) — копий меньше вдвое.
 */
const SPORE_CULL = { ball: 0.55, margin: 0.12 } as const;
/** Чисел на гроздь (systems/spores.ts, SPORE_STRIDE): x, y, z, поворот, размер, род, форма. */
const SPORE_STRIDE = 7;

/**
 * Головки цветов оранжереи (systems/flowers.ts): сколько разом и по качеству — ближайшие столько (у головок 120–630
 * треугольников). Дальше FLOWER_LOD_AT — упрощённой сеткой, вне кадра — не рисуются.
 */
export const FLOWERS_MAX = 900;
const FLOWERS_CAP: Readonly<Record<Quality, number>> = { low: 200, med: 450, high: FLOWERS_MAX, ultra: FLOWERS_MAX };
const FLOWER_LOD_AT = 3.5;
/** Чисел на головку (systems/flowers.ts, FLOWER_STRIDE): x, y, z, кватернион, масштаб поперёк и вдоль, форма. */
const FLOWER_STRIDE = 10;

/**
 * Трава (systems/grass.ts, world/grass.ts): плитки 1 × 1 м копиями одной сетки. Ближе GRASS_LOD_AT — все травинки плитки
 * (1320 треугольников), но не больше GRASS_NEAR_CAP плиток; дальше — каждая третья одним треугольником (88), за GRASS_HORIZON_AT —
 * каждая девятая (30), на тех же местах. Дальше GRASS_FAR и вне кадра — не рисуются. Предел плиток в кадре — по качеству; где
 * трава кончается (дальность или предел), она за последние метры сходит на нет — уменьшается, а не обрывается кругом.
 */
const GRASS_MAX = 1600;
const GRASS_CAP: Readonly<Record<Quality, number>> = { low: 700, med: 900, high: 1300, ultra: GRASS_MAX };
const GRASS_NEAR_CAP: Readonly<Record<Quality, number>> = { low: 12, med: 24, high: 40, ultra: 64 };
const GRASS_LOD_AT: Readonly<Record<Quality, number>> = { low: 2.6, med: 3.6, high: 4.6, ultra: 6 };
const GRASS_HORIZON_AT: Readonly<Record<Quality, number>> = { low: 9, med: 10, high: 12, ultra: 15 };
/** Сколько копий держит сетка каждой подробности: ближних мало по пределу, дальних и горизонта — сколько влезет в кадр. */
const GRASS_ROOM: readonly number[] = [64, 1024, GRASS_MAX];
/** Треугольников в плитке: форма × подробность (для счёта в кадре). */
const grassTrisOf = (form: number, lod: GrassLod): number => grassTris(GRASS_KINDS[Math.floor(form / GRASS_VARIANTS)] ?? 'meadow', form % GRASS_VARIANTS, lod);

/**
 * Сторона текстуры состояний объектов уровня: 64 × 64 = 4096 объектов (world/objects.ts, MAX_OBJECTS).
 * То же число зашито в шейдере (objState: id & 63, id >> 6).
 */
const OBJ_TEX = 64;

/** Сколько материалов помещается в текстуру свойств шейдера мира (uMatTex). */
const MAT_SLOTS = 48;
/** Сторона текстуры света по клеткам: столько клеток по стороне у сетки генератора. */
const CELL_TEX = 16;

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const deg = (d: number): number => Math.cos((d * Math.PI) / 180);

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  quality: Quality;
  width = 2;
  height = 2;
  /** Во сколько раз зерно и точки сейчас мельче обычного (fineOf): 1 — обычные. */
  fine = 1;
  private dustCount = -1;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  private readonly lightCam = new THREE.PerspectiveCamera(66, 1, 0.08, 34);
  /** Камера тени прямого света (солнце, лампа): лучи параллельны, область — квадрат вокруг центра пространства. */
  private readonly keyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private sceneRT: THREE.WebGLRenderTarget;
  /** Кадр после сведения: поверхности там, где сплаты слились, и точки поверх. */
  private rawRT: THREE.WebGLRenderTarget;
  /** Он же после длинной выдержки (следы яркого без фонаря) — готовый кадр до «камеры»; и прошлый такой. */
  private compRT: THREE.WebGLRenderTarget;
  private compPrevRT: THREE.WebGLRenderTarget;
  /** Усиление камеры в прошлом кадре: на столько же тускнеет след, когда оно растёт. */
  private trailGain = 1;
  /** Усиление камеры, когда фонарь в последний раз светил. */
  private litGain = 1;
  private readonly trailScene = new THREE.Scene();
  private readonly trailMat: THREE.ShaderMaterial;
  /** Мир прошлого кадра: по его глубине память света переносится в новый кадр. */
  private scenePrevRT: THREE.WebGLRenderTarget;
  /** Память света: два буфера, текущий и прошлый, меняются местами каждый кадр. */
  private memRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly memScene = new THREE.Scene();
  private readonly memMat: THREE.ShaderMaterial;
  /** Проекция прошлого кадра; есть ли прошлый кадр вообще; когда и откуда он снят. */
  private readonly prevViewProj = new THREE.Matrix4();
  private memLive = false;
  private memTime = 0;
  private readonly memCam = new THREE.Vector3();
  private readonly composeScene = new THREE.Scene();
  private readonly composeMat: THREE.ShaderMaterial;
  private readonly splatMat: THREE.ShaderMaterial;
  /** Облака точек мира: у каждой сетки свои сплаты. */
  private readonly clouds: SplatClouds;
  /** «Внимание скана»: луч фонаря с запаздыванием — туда собираются точки. */
  private readonly focusPos = new THREE.Vector3();
  /**
   * Проба «свет приносит точки» (квиз 17.11, ночь): поверхность набирает замеры вслед за вниманием скана, а не в миг света;
   * точки прилетают вдоль луча от фонаря и оседают на место — сначала серыми, потом цвета места. Включает приложение
   * (?build=1, #build, страница пробы).
   */
  beamBuild = false;
  private readonly focusDir = new THREE.Vector3(0, 0, -1);
  private focusOn = 0;
  private focusTime = -1;
  private shadowRT: THREE.WebGLRenderTarget | null = null;
  private readonly worldMat: THREE.ShaderMaterial;
  /**
   * Сцена — кусок места (world/piece.ts): маска того, что помнится, — одни и те же uniform-объекты у мира, теней, точек,
   * красной сетки и тихого слоя. Пока маски нет или игрок в кармане — выключена.
   */
  private pieceTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  private readonly pieceU = {
    uPiece: { value: null as THREE.DataTexture | null },
    uPieceGrid: { value: new THREE.Vector4(0, 0, 1, 1) },
    uPieceOn: { value: new THREE.Vector3(0, 1, 4.5) },
  };
  private pieceReady = false;
  /** Проекции (world/flat.ts): тот же шейдер мира с веткой SLIDE — картинка из света, которую свет смывает. */
  private readonly slideMat: THREE.ShaderMaterial;
  /**
   * Нити по рёбрам кружева (аудит мест: «кружево — одна машинная сетка»): материал мира с LACE_EDGE —
   * линии изломов и краёв вещи тем же светом, сборкой и памятью, что сама вещь. Сетка по граням остаётся.
   */
  private readonly laceEdgeMat: THREE.ShaderMaterial;
  /** Куски уровня, у которых сменился состав кружевных предметов: нити перестраиваются перед кадром. */
  private readonly laceDirty = new Set<number>();
  /** Отладка: проекции скрыты (чтобы сравнить кадр с ними и без них). */
  debugSlidesOff = false;
  private signsTex: THREE.Texture;
  /** Атлас картинок выставочных экранов (render/screen_images.ts). */
  private screensTex: THREE.Texture;
  /** Листы бумаги (world/papers.ts): стопка слоёв. */
  private papersTex: THREE.DataArrayTexture;
  /** Состояния объектов уровня: байт на объект — насколько он растворён. */
  /** Состояния объектов, по четыре байта: растворён, кружево, выцвел, светится. */
  private readonly objData = new Uint8Array(OBJ_TEX * OBJ_TEX * 4);
  /** Куда смотрела камера в прошлом кадре: по разнице едет прошлый кадр при разрыве (TRAIL_FRAG, uMosh). */
  private moshYaw = 0;
  private moshPitch = 0;
  private contactTex!: THREE.DataTexture;
  private readonly swarmCenter = new THREE.Vector3();
  private contactOrigin: [number, number] = [0, 0];
  private contactSpan = 0;
  private readonly objTex: THREE.DataTexture;
  private readonly depthMat: THREE.ShaderMaterial;
  private readonly postMat: THREE.ShaderMaterial;
  private readonly hazeMat: THREE.ShaderMaterial;
  private readonly hazeScene = new THREE.Scene();
  /** Цвет освещённого пятна прошлого кадра (2×2): им окрашен отсвет фонаря. */
  private readonly spotRT = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
  private readonly spotScene = new THREE.Scene();
  private spotMat!: THREE.ShaderMaterial;
  private hazeRT: THREE.WebGLRenderTarget | null = null;
  private readonly postScene = new THREE.Scene();
  private readonly postCam = new THREE.Camera();
  /** Кинескоп странной комнаты (world/furnish_odd.ts): экран, его кольцо задержанных кадров и копировщик кадра. */
  private tvScreen: THREE.Mesh | null = null;
  private tvSpec: OddScreen | null = null;
  private tvMat!: THREE.ShaderMaterial;
  private tvRing: THREE.WebGLRenderTarget[] = [];
  private tvHead = 0;
  private tvFilled = 0;
  private tvLast = -Infinity;
  private readonly copyScene = new THREE.Scene();
  private copyMat!: THREE.ShaderMaterial;
  private dust: THREE.Points | null = null;
  /** Звёздное небо над уровнем: видно там, где нет потолка (STAR_VERT). */
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.ShaderMaterial;
  /** Небо — своим проходом поверх готового кадра: его закрывает только собранное (STAR_FRAG). */
  private readonly skyScene = new THREE.Scene();
  /** Зерно неба, по которому заполнены буферы звёзд (FrameView.skySeed); 1 — небо по умолчанию. */
  private skySeedNow = 1;
  private readonly dustMat: THREE.ShaderMaterial;
  private readonly swarmMat: THREE.ShaderMaterial;
  private readonly swarmGeo: THREE.InstancedBufferGeometry;
  private readonly swarmPoints: THREE.Points;
  /** Сцена Осыпи: рисуется вслед за точками мира, тем же проходом. */
  private readonly swarmScene = new THREE.Scene();
  /** Пыль тронутых вещей: по облаку на вещь, пока она осыпается или собирается. Ключ — «o<номер объекта>» или «t<номер вещи>». */
  private readonly grainScene = new THREE.Scene();
  private readonly bursts = new Map<string, Burst>();
  private grainU: Record<string, THREE.IUniform> = {};
  private grainTime = -1;
  /** Сетки кусков уровня и треугольники их объектов (считаются при первом касании). */
  private chunkData: MeshData[] = [];
  private chunkTris: (Map<number, number[]> | null)[] = [];
  /** Во сколько раз пыль реже полной плотности (по качеству). */
  private grainDensity = 1;
  /** Грибы (systems/spores.ts): по сетке на форму грозди (вид × вариант, world/mushrooms.ts), каждая поставлена много раз. */
  private readonly sporeMeshes = new Map<number, THREE.InstancedMesh>();
  private sporeMat: THREE.ShaderMaterial | null = null;
  private readonly sporeUsed = new Map<number, number>();
  /** Стекло крыши зала ожидания: один лист над переплётом (GLASS_FRAG). */
  private glass!: THREE.Mesh;
  private bubble!: THREE.Mesh;
  private bubbleMat!: THREE.ShaderMaterial;
  private glassMat!: THREE.ShaderMaterial;
  private birdMesh: THREE.InstancedMesh | null = null;
  private birdFlap: THREE.InstancedBufferAttribute | null = null;
  private readonly birdE = new THREE.Euler();
  private readonly sporeM = new THREE.Matrix4();
  private readonly sporeQ = new THREE.Quaternion();
  private readonly sporeS = new THREE.Vector3();
  private readonly sporeP = new THREE.Vector3();
  private readonly sporeView = new THREE.Frustum();
  private readonly sporeVP = new THREE.Matrix4();
  /** Что рисовать из грибов (setSpores): раскладка по сеткам — в render, когда камера кадра уже выставлена. */
  private sporeData: Float32Array | null = null;
  private sporeCount = 0;
  /** Сколько гроздей нарисовано в последнем кадре и сколько из них упрощённых (для проверки и замера). */
  readonly sporeStats = { shown: 0, far: 0, culled: 0 };
  /** Головки цветов (systems/flowers.ts): по сетке на форму и подробность. */
  private readonly flowerMeshes = new Map<number, THREE.InstancedMesh>();
  private flowerMat: THREE.ShaderMaterial | null = null;
  private readonly flowerUsed = new Map<number, number>();
  private flowerData: Float32Array | null = null;
  private flowerCount = 0;
  readonly flowerStats = { shown: 0, far: 0, culled: 0 };
  /** Трава (systems/grass.ts): по сетке на форму плитки и подробность. */
  private readonly grassMeshes = new Map<number, THREE.InstancedMesh>();
  private grassMat: THREE.ShaderMaterial | null = null;
  private readonly grassUsed = new Map<number, number>();
  private grassData: Float32Array | null = null;
  private grassCount = 0;
  /** Вытоптанные круги травы (systems/grass.ts, GRASS_CLEAR): xz — середина, y — пол, w — радиус; w = 0 — пусто. */
  private readonly grassClear = Array.from({ length: GRASS_CLEAR }, () => new THREE.Vector4(0, 0, 0, 0));
  /** След лежавшего в траве (шейдер, bodySd): восемь капсул силуэта (ax, az, bx, bz), их радиусы по четыре и (пол, примятость, ось тела к ногам). */
  private readonly grassBody = Array.from({ length: 8 }, () => new THREE.Vector4(1e6, 1e6, 1e6, 1e6));
  private readonly grassBodyR = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];
  private readonly grassBodyK = new THREE.Vector4(0, 0, 1, 0);
  /** Трава тянется к свету (systems/grass.ts, LEAN): карта поля текстурой, где поле и откуда свет (w — сила, 0 — не тянется). */
  private leanTex: THREE.DataTexture;
  private readonly leanRect = new THREE.Vector4(0, 0, 1, 1);
  private readonly leanFrom = new THREE.Vector4(0, 0, 0, 0);
  private readonly leanDir = new THREE.Vector4(0, 0, -1, 0);
  /** Номера плиток кадра (первый проход раскладки). */
  private readonly grassPick = new Int32Array(GRASS_MAX);
  readonly grassStats = { shown: 0, far: 0, horizon: 0, culled: 0, tris: 0, end: 0 };
  /** Призрак Осыпи: то же тело, отражённое из-за спины вперёд. */
  private readonly ghostMat: THREE.ShaderMaterial;
  private readonly ghostPoints: THREE.Points;
  /** Эхо: полноэкранный проход по карте глубины, поверх точек. */
  private readonly echoScene = new THREE.Scene();
  /** Тихий слой архитектуры: точки по рёбрам и углам (world/edges.ts) и волна сонара по ним. */
  private readonly edgeScene = new THREE.Scene();
  private edgePoints: THREE.Points | null = null;
  private edgeMat: THREE.ShaderMaterial | null = null;
  private readonly echoMat: THREE.ShaderMaterial;
  private echoRT: THREE.WebGLRenderTarget;
  /** Свет по клеткам уровня: маленькая текстура, которую игра обновляет каждый кадр. */
  private readonly cellTex: THREE.DataTexture;
  /** Свойства материалов для шейдера мира: MAT_SLOTS × 3 (см. uMatTex). */
  private readonly matTex: THREE.DataTexture;
  private readonly swarmHead: THREE.InstancedBufferAttribute;
  private readonly swarmDir: THREE.InstancedBufferAttribute;
  private readonly swarmParam: THREE.InstancedBufferAttribute;
  private readonly chunks: THREE.Mesh[] = [];
  /** Геометрия карманного пространства (белое нигде, луг…): рисуется всегда, пока оно активно. */
  private readonly pocket: THREE.Mesh[] = [];
  private readonly things = new Map<number, Thing>();
  /** Карты подробных вещей памяти по адресу файла. */
  private readonly thingMaps = new Map<string, THREE.Texture>();
  private nextThing = 1;
  private readonly wireMat: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color(0, 0, 0);
  /** Предметы по ярусам: по одной маленькой геометрии на ярус. */
  /** Имена чанков, которые сейчас скрыты (обвал до обрушения, неактивный вариант комнаты). */
  private readonly hiddenIds = new Set<string>();
  private readonly lightU: Record<string, THREE.IUniform>;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private cssW = 1;
  private cssH = 1;
  private lastCalls = 0;
  private lastTris = 0;
  /** Яркость картинки по выбору игрока: множитель усиления камеры. */
  brightness = 1;
  /** Множитель углов луча, с которым сейчас стоит uCone (меняется только когда кривая ощущений его сдвинула). */
  private beamConeNow = 1;
  /** Обзор кадра без перекрута (по вертикали, градусы): его задаёт размер кадра. */
  private baseFov = 70;
  /** Обзор, под который сейчас посчитан размер сплатов (uProj). */
  private lastFov = 70;
  /** Отладка: временно выключить тень, не меняя качество (сравнение «тень вкл/выкл»). */
  debugShadowsOff = false;
  /** Свет натриевых ламп оранжереи выключен (отладка: кадры «до» и «после»). */
  debugLampsOff = false;
  /**
   * Отладка: тень прямого света (солнце зала ожидания, луга, лампа домика) — формулой, а не картой, как на
   * низком качестве (roofShade). С 16.11 днём так было на всех сенсорных устройствах: пустой пол зала на
   * iPhone приняли за «не работает карта тени». Настоящая причина нашлась вечером — Safari не рисовал сетку
   * помещения целиком (docs/vylazka/design.md, §20), — и телефон снова тенит солнце картой; формула только
   * для сравнения кадров.
   */
  keyShadowByFormula = false;
  /** Отладка: рисовать мир сплошными поверхностями, без облака точек (для сравнения кадров). */
  private debugScanOff = false;
  /** Перепад между ярусами уровня, м (для отсечения этажей). */
  tierDrop = 4.5;
  /** Полоса высот видимых ярусов в этом кадре (render): что ниже или выше — грибы, цветы, трава — не рисуется. */
  private readonly tierBand: [number, number] = [-Infinity, Infinity];
  /** Лампы оранжереи по удалению от камеры (setLamps): один массив на всё время, без выделений в кадре. */
  private readonly lampOrder: Vec3[] = [];
  /** Сила света ламп (LAMP.gain; отладка меняет) и яркость свечения, за которой он следует (setGlow). */
  private lampGain: number = LAMP.gain;
  private lampGlow = 1;
  /** Дальше этого расстояния чанки не рисуются: свет фонаря туда уже не достаёт. */
  cullDistance = 30;
  private stairs: readonly StairLink[] = [];

  /** Вызывается при потере и восстановлении графического контекста. */
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => this.onContextRestored?.());

    // Текстуры запекаются на CPU: детерминированы и переживают потерю контекста.
    const atlas = bakeMatcapAtlas(MAT_DEFS);
    const atlasTex = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.minFilter = THREE.LinearFilter;
    atlasTex.generateMipmaps = false;
    atlasTex.needsUpdate = true;
    const grimeTex = new THREE.DataTexture(bakeGrime(256), 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
    grimeTex.wrapS = THREE.RepeatWrapping;
    grimeTex.wrapT = THREE.RepeatWrapping;
    grimeTex.magFilter = THREE.LinearFilter;
    grimeTex.minFilter = THREE.LinearMipmapLinearFilter;
    grimeTex.generateMipmaps = true;
    grimeTex.needsUpdate = true;
    if (ATLAS_COLS * ATLAS_ROWS < MAT_COUNT || MAT_COUNT > MAT_SLOTS) throw new Error(`атлас matcap меньше числа материалов (или их больше ${MAT_SLOTS} — столько места в шейдере)`);
    // Фактуры: стопка слоёв. Анизотропная фильтрация держит рельеф на стенах, уходящих вдаль.
    const detail = bakeDetail(256);
    const detailTex = new THREE.DataArrayTexture(detail.data, detail.size, detail.size, detail.layers);
    detailTex.format = THREE.RGBAFormat;
    detailTex.type = THREE.UnsignedByteType;
    detailTex.wrapS = THREE.RepeatWrapping;
    detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.magFilter = THREE.LinearFilter;
    detailTex.minFilter = THREE.LinearMipmapLinearFilter;
    detailTex.generateMipmaps = true;
    detailTex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    detailTex.needsUpdate = true;
    grimeTex.anisotropy = detailTex.anisotropy;
    // Атлас надписей и плакатов: пока пустой белый лист, рисуется отдельно (setSigns).
    this.signsTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.signsTex.needsUpdate = true;
    this.objTex = new THREE.DataTexture(this.objData, OBJ_TEX, OBJ_TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.objTex.magFilter = THREE.NearestFilter;
    this.objTex.minFilter = THREE.NearestFilter;
    this.objTex.needsUpdate = true;
    // Атлас экранов: пока не нарисован — тёмно-серый тексель.
    this.screensTex = new THREE.DataTexture(new Uint8Array([40, 40, 44, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.screensTex.needsUpdate = true;
    // Пока листы не пришли — один слой в одну точку цвета чистой бумаги.
    this.papersTex = new THREE.DataArrayTexture(new Uint8Array([196, 187, 164, 255]), 1, 1, 1);
    this.papersTex.colorSpace = THREE.SRGBColorSpace;
    this.papersTex.needsUpdate = true;

    this.lightU = {
      uLightPosV: { value: new THREE.Vector3() },
      uLightDirV: { value: new THREE.Vector3(0, 0, -1) },
      uLightColor: { value: new THREE.Vector3() },
      // Яркое пятно 7–13°, ореол до 25°, слабая засветка до 52°.
      uCone: { value: new THREE.Vector4(deg(7), deg(13), deg(25), deg(52)) },
      uBeamTall: { value: 1 },
      uRings: { value: RINGS_DEFAULT },
    };
    const defOf = (i: number): (typeof MAT_DEFS)[number] => MAT_DEFS[i] ?? MAT_DEFS[0]!;
    // Свойства материалов — текстура MAT_SLOTS × 3 (WORLD_FRAG, uMatTex): строка 0 — грязь, свечение, слой фактуры, повторов на
    // метр; строка 1 — рельеф, род запустения, проступающий материал, просвет; строка 2 — цвет. Хвост за MAT_COUNT — нули.
    const matData = new Float32Array(MAT_SLOTS * 3 * 4);
    for (let i = 0; i < MAT_SLOTS; i++) {
      const d = defOf(i);
      const used = i < MAT_COUNT;
      const base = atlas.base[i] ?? [0.5, 0.5, 0.5];
      matData.set(used ? [d.grime, d.glow ?? 0, d.layer, 1 / d.tile] : [0, 0, 0, 1], i * 4);
      matData.set(used ? [d.bump, d.decay, d.alt ?? i, d.thin ?? 0] : [0, 0, i, 0], (MAT_SLOTS + i) * 4);
      matData.set([base[0]!, base[1]!, base[2]!, 0], (MAT_SLOTS * 2 + i) * 4);
    }
    this.matTex = new THREE.DataTexture(matData, MAT_SLOTS, 3, THREE.RGBAFormat, THREE.FloatType);
    this.matTex.magFilter = THREE.NearestFilter;
    this.matTex.minFilter = THREE.NearestFilter;
    this.matTex.generateMipmaps = false;
    this.matTex.needsUpdate = true;

    this.cellTex = new THREE.DataTexture(new Uint8Array(CELL_TEX * CELL_TEX * 4).fill(255), CELL_TEX, CELL_TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.cellTex.magFilter = THREE.NearestFilter;
    this.cellTex.minFilter = THREE.NearestFilter;
    this.cellTex.needsUpdate = true;
    // Трава тянется к свету: пока поля нет — один пустой тексель.
    this.leanTex = this.makeLeanTex(new Uint8Array(1), 1, 1);
    // Тени-пятна: пока уровень не дал карту — один пустой тексель.
    this.contactTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.contactTex.magFilter = THREE.LinearFilter;
    this.contactTex.minFilter = THREE.LinearFilter;
    this.contactTex.needsUpdate = true;
    this.pieceTex.magFilter = THREE.NearestFilter;
    this.pieceTex.minFilter = THREE.NearestFilter;
    this.pieceTex.needsUpdate = true;
    this.pieceU.uPiece.value = this.pieceTex;
    this.worldMat = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: WORLD_FRAG,
      uniforms: {
        ...this.lightU,
        ...this.pieceU,
        uCellLight: { value: this.cellTex },
        uCellGrid: { value: new THREE.Vector4(0, 0, 3, 0) },
        uAtlas: { value: atlasTex },
        uGrime: { value: grimeTex },
        uDetail: { value: detailTex },
        uSigns: { value: this.signsTex },
        uScreens: { value: this.screensTex },
        uPapers: { value: this.papersTex },
        uDecay: { value: 0.3 },
        uPlain: { value: 0 },
        uObjState: { value: this.objTex },
        uTierDrop: { value: 4.5 },
        uLightRightV: { value: new THREE.Vector3(1, 0, 0) },
        uLightUpV: { value: new THREE.Vector3(0, 1, 0) },
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowTexel: { value: 1 / 512 },
        uAmbient: { value: new THREE.Vector3(0.0016, 0.0019, 0.0024) },
        uKeyDirV: { value: new THREE.Vector3(0, 1, 0) },
        uKeyColor: { value: new THREE.Vector3(0, 0, 0) },
        uShadowFor: { value: 0 },
        uBounce: { value: new THREE.Vector4(0, 0, -1000, 0) },
        uSpot: { value: this.spotRT.texture },
        uFog: { value: 0.035 },
        uFogColor: { value: new THREE.Vector3(0, 0, 0) },
        uDissolve: { value: 0 },
        uThing: { value: new THREE.Vector4(0, 0, 0, 0) },
        uDots: { value: 0 },
        uDotGrid: { value: DOT_GRID.max },
        uScan: { value: new THREE.Vector4(0, SCAN.perLight, SCAN.max, 0) },
        uScanFade: { value: 1 },
        uBuild: { value: 0 },
        uBuildFocus: { value: new THREE.Vector3() },
        uBuildDir: { value: new THREE.Vector3(0, 0, -1) },
        uBuildOn: { value: 0 },
        uDebugView: { value: 0 },
        uScanRange: { value: new THREE.Vector2(4, 15) },
        uSlide: { value: new THREE.Vector4(SLIDE.washFrom, SLIDE.washTo, SLIDE.gain, 0) },
        uErase: { value: new THREE.Vector4(0, 0, 0, 0) },
        uCeilTile: { value: 0 },
        uBurnTint: { value: new THREE.Vector3(0.9, 0.07, 0.03) },
        uKeyCells: { value: 0 },
        uGaze: { value: 1 },
        uGazeCone: { value: new THREE.Vector2(Math.cos((52 * Math.PI) / 180), Math.cos((25 * Math.PI) / 180)) },
        uGazeTall: { value: 1 },
        uPressBox: { value: new THREE.Vector4(0, 0, 0, 0) },
        uPress: { value: new THREE.Vector4(0, 0, 0, 0) },
        uPressY: { value: new THREE.Vector3(0, 0, 0) },
        uWind: { value: new THREE.Vector4(0, 0, 1, 0) },
        uPush: { value: new THREE.Vector4(0, 0, 0, 0) },
        uRoofBox: { value: new THREE.Vector4(0, 0, 0, 0) },
        // Белая комната: коробка по полу и пол, потолок, есть ли она (world/furnish_white.ts).
        uWhiteBox: { value: new THREE.Vector4(0, 0, 0, 0) },
        uWhiteY: { value: new THREE.Vector4(0, 0, 0, 0) },
        // Странная комната (world/furnish_odd.ts): коробка, пол, потолок, род и время; герой и ощущение; вещь и куда она смотрит.
        uOddBox: { value: new THREE.Vector4(0, 0, 0, 0) },
        uOddY: { value: new THREE.Vector4(0, 0, 0, 0) },
        uOddFx: { value: new THREE.Vector4(0, 0, 0, 0) },
        uOddAt: { value: new THREE.Vector4(0, 0, 0, 0) },
        uOddFace: { value: new THREE.Vector4(0, 1, 0, 0) },
        uRoofY: { value: 0 },
        uKeyDirW: { value: new THREE.Vector3(0, 1, 0) },
        uRecallPos: { value: new THREE.Vector4(0, 0, 0, 0) },
        uRecallColor: { value: new THREE.Vector4(1, 1, 1, 0) },
        uRecallDir: { value: new THREE.Vector4(0, 1, 1, 1) },
        // Натриевые лампы оранжереи (setLamps): ближние к камере, коробка их помещения, пол, потолок, дальность и сколько их.
        uLamp: { value: Array.from({ length: LAMP.max }, () => new THREE.Vector4()) },
        uLampBox: { value: new THREE.Vector4(0, 0, 0, 0) },
        uLampY: { value: new THREE.Vector4(0, 0, LAMP.radius, 0) },
        uLampColor: { value: new THREE.Vector3().fromArray(SODIUM_GLOW).multiplyScalar(LAMP.gain) },
        uContact: { value: this.contactTex },
        uContactGrid: { value: new THREE.Vector3(0, 0, 0) },
        uCaustic: { value: 0 },
        uVoid: { value: new THREE.Vector4(0, 0, 0, 0) },
        uVoidK: { value: new THREE.Vector2(0, 0) },
        uSonarW: { value: new THREE.Vector4(0, 0, 0, -100) },
        uSonarTint: { value: new THREE.Vector4(0, 0, 0, 0) },
        uMatTex: { value: this.matTex },
        uMatGlow: { value: 1 },
      },
    });
    this.depthMat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.BackSide, colorWrite: false, uniforms: { uObjState: { value: this.objTex }, uWind: this.worldMat.uniforms.uWind!, uPush: this.worldMat.uniforms.uPush!, ...this.pieceU } });
    // Проекции: всё общее — теми же uniform-объектами, что у мира.
    this.slideMat = this.worldLike();
    this.laceEdgeMat = this.worldLike();
    // Красная сетка: распад берёт у мира (одни и те же uniform-объекты), яркость своя.
    this.wireMat = new THREE.ShaderMaterial({
      vertexShader: WIRE_VERT,
      fragmentShader: WIRE_FRAG,
      uniforms: {
        uDissolve: this.worldMat.uniforms.uDissolve!,
        uThing: this.worldMat.uniforms.uThing!,
        uWireColor: { value: new THREE.Vector3(1.0, 0.06, 0.03) },
        uObjState: { value: this.objTex },
        uWireAlpha: { value: 0 },
        uTime: { value: 0 },
        ...this.pieceU,
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { ...this.lightU, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uPointScale: { value: 4 }, uBoost: { value: 0 }, uPollen: { value: 0 }, uFluffBox: { value: new THREE.Vector4(0, 0, 0, 0) }, uFluffY: { value: new THREE.Vector4(0, 0, 0, 0) } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    // Стекло крыши: смешивается с кадром только по цвету — альфа кадра (число замеров) остаётся прежней.
    this.glassMat = new THREE.ShaderMaterial({
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: { uSky: { value: new THREE.Vector3() }, uSunDirW: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Vector3() }, uGlass: { value: 1 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      this.glass = new THREE.Mesh(g, this.glassMat);
      this.glass.frustumCulled = false;
      this.glass.layers.set(1);
      this.glass.visible = false;
      this.scene.add(this.glass);
    }
    // Пузырь искомой вещи: вещь парит в слабом «мыльном» пузыре — так она ни с чем не срастается и видна издалека
    // (партнёр 24.11). Тонкая плёнка: по краю видна, в середине почти прозрачна; смешивается, как стекло крыши.
    this.bubbleMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader:
        'precision highp float; varying vec3 vN; varying vec3 vV; uniform float uK; uniform float uT; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); vec3 c = mix(vec3(0.72, 0.9, 1.0), vec3(1.0, 0.8, 0.94), 0.5 + 0.5 * sin(f * 8.0 + uT * 0.9 + vN.y * 3.0)); float a = uK * (0.008 + 0.36 * f); gl_FragColor = vec4(c * a, a); }',
      uniforms: { uK: { value: 0 }, uT: { value: 0 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthWrite: false,
    });
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.bubbleMat);
    this.bubble.frustumCulled = false;
    this.bubble.layers.set(1);
    this.bubble.visible = false;
    this.scene.add(this.bubble);
    // Звёздное небо: дальние звёзды (с полосой погуще — млечный путь), ближние (они и дают глубину:
    // смещаются относительно дальних, когда игрок идёт) и три падающие с хвостами из точек.
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uBright: { value: 0 },
        uPx: { value: 1 },
        uFall: { value: new THREE.Vector4(0, 0, -100, 0) },
        tDepth: { value: null },
        tScene: { value: null },
        tMem: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uThrough: { value: 0 },
        uWarm: { value: skyLook(1).warm },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    {
      // Небо — у каждого сна своё (render/sky.ts): буферы постоянного размера, заполняются по зерну, которое даёт игра.
      const pos = new Float32Array(SKY_TOTAL * 3);
      const star = new Float32Array(SKY_TOTAL * 4);
      fillSky(1, pos, star);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aStar', new THREE.BufferAttribute(star, 4));
      this.stars = new THREE.Points(g, this.starMat);
      this.stars.frustumCulled = false;
      // Слой 1: в карту теней звёзды не идут.
      this.stars.layers.set(1);
      this.stars.visible = false;
      // Не в сцену мира: небо рисуется своим проходом после сведения кадра, иначе его закрывала бы любая стена —
      // и несобранная тоже.
      this.skyScene.add(this.stars);
    }
    // Осыпь: прядь из точек, размноженная инстансами (у каждой пряди своя голова и направление).
    // Точек в пряди — с запасом на высокое качество при самом мелком зерне; сколько из них рисовать, решает качество.
    const STRAND = STRAND_MAX;
    const rnd = new Float32Array(STRAND * 4);
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 4294967296;
    };
    // Точки идут вперемешку по длине пряди: любое их начало покрывает прядь целиком.
    for (let i = 0; i < STRAND; i++) rnd.set([next(), next(), next(), next()], i * 4);
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STRAND * 3), 3));
    sg.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    this.swarmHead = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WORMS * 3), 3);
    this.swarmDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WORMS * 3), 3);
    this.swarmParam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WORMS * 2), 2);
    this.swarmHead.setUsage(THREE.DynamicDrawUsage);
    this.swarmDir.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('iHead', this.swarmHead);
    sg.setAttribute('iDir', this.swarmDir);
    sg.setAttribute('iParam', this.swarmParam);
    sg.instanceCount = 0;
    // Материал — после материала точек мира: у них общие размеры и глубина кадра.
    this.swarmGeo = sg;

    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: null },
        uRes: { value: new THREE.Vector2(2, 2) },
        uAspect: { value: 1 },
        uFrame: { value: 0 },
        uGain: { value: 1 },
        uNoise: { value: 0.01 },
        uBarrel: { value: BARREL },
        uVignette: { value: 1 },
        uGlitch: { value: 0 },
        uTunnel: { value: 0 },
        uDrift: { value: 0 },
        uFade: { value: 1 },
        uGas: { value: 0 },
        uBeam: { value: new THREE.Vector3(0.5, 0.5, 0) },
        tHaze: { value: null },
        uGrime: { value: grimeTex },
        uHazeTexel: { value: new THREE.Vector2(1, 1) },
        uBloom: { value: 0.1 },
        uCrt: { value: 0 },
        uFlash: { value: 0 },
        uMist: { value: 0 },
        tEcho: { value: null },
        uEcho: { value: 0 },
        uFmt: { value: 1 },
        uLodFine: { value: 0 },
        uGradeLo: { value: new THREE.Vector4(...GRADE_DEFAULT.lo, GRADE_DEFAULT.sat) },
        uGradeHi: { value: new THREE.Vector3(...GRADE_DEFAULT.hi) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const postMesh = new THREE.Mesh(tri, this.postMat);
    postMesh.frustumCulled = false;
    this.postScene.add(postMesh);
    // Копия готового кадра в маленький буфер кольца кинескопа (на среднем и высоком качестве — с мип-уровня кадра, без ряби).
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: 'precision mediump float; uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }',
      uniforms: { tSrc: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    const copyMesh = new THREE.Mesh(tri, this.copyMat);
    copyMesh.frustumCulled = false;
    this.copyScene.add(copyMesh);
    // Экран кинескопа: кадр двухсекундной давности, тихий снег и строки — только на стекле (K-32, переделка куратора: снега на
    // стенах нет). Яркость ровная: снег мелкий и тусклый, кадр не мигает.
    this.tvMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: TV_FRAG,
      uniforms: { tPast: { value: null }, uHas: { value: 0 }, uTime: { value: 0 }, uQuiet: { value: 0 }, uFog: this.worldMat.uniforms.uFog!, uFogColor: this.worldMat.uniforms.uFogColor! },
      // Ложится на кадр, как стекло крыши и пузырь: цвет — свой, а альфа кадра (число замеров) — лица корпуса под ним: экран
      // собирается взглядом вместе с телевизором, а не горит сквозь закон взгляда. (Непрозрачным проходом в смоуке на
      // SwiftShader страница падала чаще — не доказано, но так спокойнее.)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthWrite: false,
    });

    this.spotMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: SPOT_FRAG,
      uniforms: { tScene: { value: null }, uBeam: { value: new THREE.Vector3(0.5, 0.5, 0) }, uLod: { value: 5 }, uAspect: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    const spotMesh = new THREE.Mesh(tri, this.spotMat);
    spotMesh.frustumCulled = false;
    this.spotScene.add(spotMesh);

    this.hazeMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: HAZE_FRAG,
      uniforms: {
        ...this.lightU,
        tDepth: { value: null },
        uGrime: { value: grimeTex },
        uShadowMap: { value: null },
        uShadowMatrixV: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uCamPos: { value: new THREE.Vector3() },
        uTan: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.05, 70) },
        uDensity: { value: 0.02 },
        uFrame: { value: 0 },
        uTime: { value: 0 },
      },
      defines: { HAZE_STEPS: 8 },
      depthTest: false,
      depthWrite: false,
    });
    const hazeMesh = new THREE.Mesh(tri, this.hazeMat);
    hazeMesh.frustumCulled = false;
    this.hazeScene.add(hazeMesh);

    // Сведение кадра и сплаты.
    this.composeMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: COMPOSE_FRAG,
      uniforms: { tScene: { value: null }, tMem: { value: null }, uMemGain: { value: 1 }, uFogColor: this.worldMat.uniforms.uFogColor!, uSolid: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    const composeMesh = new THREE.Mesh(tri, this.composeMat);
    composeMesh.frustumCulled = false;
    this.composeScene.add(composeMesh);
    this.splatMat = new THREE.ShaderMaterial({
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      uniforms: {
        ...this.pieceU,
        tScene: { value: null },
        tDepth: { value: null },
        uNearFar: { value: new THREE.Vector2(0.05, 70) },
        uTime: { value: 0 },
        uSize: { value: 0.03 },
        uProj: { value: 300 },
        uMaxPx: { value: 12 },
        uLodDist: { value: SCAN.lodDist },
        uFar: { value: SCAN.far },
        tMem: { value: null },
        // Остывший цвет точки памяти: холодный, яркости 1.
        uMemColor: { value: new THREE.Vector3(0.87, 1.02, 1.27) },
        uMemGain: { value: 1 },
        uAmbientScan: { value: 0 },
        uFogColor: this.worldMat.uniforms.uFogColor!,
        // Точки стен странной комнаты идут вместе со стенами: те же uniform-объекты, что у мира.
        uOddBox: this.worldMat.uniforms.uOddBox!,
        uOddY: this.worldMat.uniforms.uOddY!,
        uOddFx: this.worldMat.uniforms.uOddFx!,
        uHMax: { value: SCAN.max },
        uCone: this.lightU.uCone!,
        uDissolve: this.worldMat.uniforms.uDissolve!,
        uSeedW: { value: 0 },
        uFocusPosV: { value: new THREE.Vector3() },
        uFocusDirV: { value: new THREE.Vector3(0, 0, -1) },
        uFocusOn: { value: 0 },
        uBuild: { value: 0 },
        uEdl: { value: new THREE.Vector3(0.005, 0.008, 2) },
      },
      // Сплаты полупрозрачны и накладываются друг на друга; за стеной точку отсекает сам шейдер.
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.clouds = new SplatClouds(this.splatMat);
    this.clouds.lodDist = SCAN.lodDist;
    this.clouds.far = SCAN.far;
    // Осыпь: те же точки, что у мира, — тот же размер, та же форма, та же глубина кадра.
    this.swarmMat = new THREE.ShaderMaterial({
      vertexShader: ENTITY_VERT,
      fragmentShader: SPLAT_FRAG,
      uniforms: {
        ...this.lightU,
        tDepth: this.splatMat.uniforms.tDepth!,
        uNearFar: this.splatMat.uniforms.uNearFar!,
        uTime: { value: 0 },
        uSize: this.splatMat.uniforms.uSize!,
        uProj: this.splatMat.uniforms.uProj!,
        uMaxPx: this.splatMat.uniforms.uMaxPx!,
        uAlpha: { value: 0 },
        uDarkGain: { value: 1 },
        uGhost: { value: new THREE.Vector4(0, 0, -1, 0) },
        uPolar: { value: 0 },
      },
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.swarmPoints = new THREE.Points(this.swarmGeo, this.swarmMat);
    this.swarmPoints.frustumCulled = false;
    this.swarmPoints.visible = false;
    this.swarmScene.add(this.swarmPoints);
    // Призрак: та же геометрия и тот же шейдер, свои только плотность и признак отражения.
    this.ghostMat = new THREE.ShaderMaterial({
      vertexShader: ENTITY_VERT,
      fragmentShader: SPLAT_FRAG,
      uniforms: { ...this.swarmMat.uniforms, uAlpha: { value: 0 }, uGhost: { value: new THREE.Vector4(0, 0, -1, 1) } },
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.ghostPoints = new THREE.Points(this.swarmGeo, this.ghostMat);
    this.ghostPoints.frustumCulled = false;
    // Пыль вещей: те же точки, тот же свет. У каждого облака свои только uGo, uFlow и uFade.
    this.grainU = {
      ...this.lightU,
      tDepth: this.splatMat.uniforms.tDepth!,
      uNearFar: this.splatMat.uniforms.uNearFar!,
      uTime: { value: 0 },
      uSize: this.splatMat.uniforms.uSize!,
      uProj: this.splatMat.uniforms.uProj!,
      uMaxPx: this.splatMat.uniforms.uMaxPx!,
      uAmbient: this.worldMat.uniforms.uAmbient!,
      uDarkGain: { value: 1 },
    };
    this.ghostPoints.visible = false;
    this.swarmScene.add(this.ghostPoints);
    // Эхо рисуется в свой слой: длинная выдержка его не смазывает, линии остаются чёткими.
    this.echoMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: ECHO_FRAG,
      defines: { ECHO_MAX },
      uniforms: {
        tDepth: { value: null },
        tScene: { value: null },
        uInvViewProj: { value: new THREE.Matrix4() },
        uNearFar: this.splatMat.uniforms.uNearFar!,
        uTexel: { value: new THREE.Vector2(1, 1) },
        uPulse: { value: Array.from({ length: ECHO_MAX }, () => new THREE.Vector4()) },
        uPulseB: { value: Array.from({ length: ECHO_MAX }, () => new THREE.Vector4()) },
        uGainInv: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const echoMesh = new THREE.Mesh(tri, this.echoMat);
    echoMesh.frustumCulled = false;
    this.echoScene.add(echoMesh);
    // Память света: полноэкранный проход из мира этого кадра и памяти прошлого.
    this.memMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: MEMORY_FRAG,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tPrev: { value: null },
        tPrevDepth: { value: null },
        uReproj: { value: new THREE.Matrix4() },
        uNearFar: this.splatMat.uniforms.uNearFar!,
        uDecay: { value: 0 },
        uHMax: { value: SCAN.max },
        uKeep: { value: 0 },
        uFrame: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const memMesh = new THREE.Mesh(tri, this.memMat);
    memMesh.frustumCulled = false;
    this.memScene.add(memMesh);
    // Длинная выдержка: новый кадр поверх остывающего прошлого.
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: { tNow: { value: null }, tPrev: { value: null }, tDepth: { value: null }, uKeep: { value: 0 }, uMosh: { value: 0 }, uMoshShift: { value: new THREE.Vector2() }, uFmt: this.postMat.uniforms.uFmt! },
      depthTest: false,
      depthWrite: false,
    });
    const trailMesh = new THREE.Mesh(tri, this.trailMat);
    trailMesh.frustumCulled = false;
    this.trailScene.add(trailMesh);

    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(1);
    this.sceneRT = this.makeSceneRT(2, 2);
    this.scenePrevRT = this.makeSceneRT(2, 2);
    this.memRT = [this.makeMemRT(2, 2), this.makeMemRT(2, 2)];
    this.rawRT = this.makeMemRT(2, 2);
    this.echoRT = this.makeMemRT(2, 2);
    this.compRT = this.makeCompRT(2, 2);
    this.compPrevRT = this.makeCompRT(2, 2);
    this.applyQuality();
  }

  private makeSceneRT(w: number, h: number): THREE.WebGLRenderTarget {
    // Мир как он есть: цвет поверхностей и (в альфе) число замеров. Глубина — текстурой: по ней дымка
    // знает, где кончается воздух, а сплаты — что они за стеной. Выборка — ближайшая: точка берёт цвет
    // и число замеров своего места, а не смесь с соседним.
    const depthTexture = new THREE.DepthTexture(w, h);
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    // sRGB8: в тёмных градиентах нет полос, шейдер пишет линейный цвет, выборка возвращает линейный.
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  /** Перезаполнить небо по зерну (render/sky.ts): другие звёзды, млечный путь, туманности. */
  private setSky(seed: number): void {
    this.skySeedNow = seed;
    const g = this.stars.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const star = g.getAttribute('aStar') as THREE.BufferAttribute;
    const look = fillSky(seed, pos.array as Float32Array, star.array as Float32Array);
    pos.needsUpdate = true;
    star.needsUpdate = true;
    this.starMat.uniforms.uWarm!.value = look.warm;
  }

  private makeMemRT(w: number, h: number): THREE.WebGLRenderTarget {
    // Память света: цвет места и свежесть. Выборка — с усреднением: при переносе на новый кадр
    // пиксель памяти приходится между пикселями старого.
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  private makeCompRT(w: number, h: number): THREE.WebGLRenderTarget {
    // Готовый кадр до «камеры». Уменьшенные копии кадра нужны ореолу и цвету отсвета.
    const haze = QUALITY[this.quality].haze > 0;
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: haze ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, generateMipmaps: haze });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  private makeHazeRT(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  /**
   * Предел мелкости «ультра» (слова партнёра 19.11: «проверь производительность на Ультра – мне нравится визуал, хочется
   * сделать его доступным для большего количества браузеров и железа»). Ультра — не «всё или ничего»: мелкость зерна и точек
   * ступенями по четверти от 1,25 до 2, по силам машины. Буфер — в cap² раз больше высокого, точек — во столько же, тень —
   * 1024 × cap. Ставит приложение: по замеру под заставкой загрузки и по частоте кадров в игре (app.ts).
   */
  fineCap = 2;

  setFineCap(cap: number): void {
    const c = Math.max(1, Math.min(2, Math.round(cap * 4) / 4));
    if (c === this.fineCap) return;
    this.fineCap = c;
    if (QUALITY[this.quality].fine > 1) this.applyQuality();
  }

  /** Качество с пределом мелкости (для «ультра»; у остальных — как в таблице). */
  private specOf(q: Quality): QualitySpec {
    const s = QUALITY[q];
    if (!(s.fine > 1) || this.fineCap >= s.fine) return s;
    const f = Math.max(1, this.fineCap);
    return { ...s, pixels: s.pixels * (f / s.fine) ** 2, fine: f, shadow: Math.round((1024 * f) / 256) * 256 };
  }

  private applyQuality(): void {
    const q = this.specOf(this.quality);
    this.shadowRT?.dispose();
    this.shadowRT = null;
    if (q.shadow > 0) {
      const depth = new THREE.DepthTexture(q.shadow, q.shadow);
      depth.compareFunction = THREE.LessEqualCompare;
      depth.magFilter = THREE.LinearFilter;
      depth.minFilter = THREE.LinearFilter;
      this.shadowRT = new THREE.WebGLRenderTarget(q.shadow, q.shadow, { depthBuffer: true, depthTexture: depth, stencilBuffer: false });
      this.worldMat.uniforms.uShadowTexel!.value = 1 / q.shadow;
    }
    this.worldMat.defines = { ATLAS_ROWS, ...(q.shadow > 0 ? { SHADOWS: '' } : {}), ...(q.detail ? { DETAIL: '' } : {}), ...(q.hex ? { HEXTILE: '' } : {}), ...(this.debugScanOff ? {} : { SCAN: '' }) };
    this.worldMat.needsUpdate = true;
    this.slideMat.defines = { ...this.worldMat.defines, SLIDE: '' };
    this.slideMat.needsUpdate = true;
    this.laceEdgeMat.defines = { ...this.worldMat.defines, LACE_EDGE: '' };
    this.laceEdgeMat.needsUpdate = true;
    for (const t of this.things.values()) {
      t.mat.defines = { ...this.worldMat.defines, ...(t.maps ? { THING_TEX: '' } : {}) };
      t.mat.needsUpdate = true;
      if (t.edgeMat) {
        t.edgeMat.defines = { ...this.worldMat.defines, LACE_EDGE: '' };
        t.edgeMat.needsUpdate = true;
      }
    }
    // Объём для точек — только на высоком качестве: четыре лишние выборки глубины на каждую точку.
    this.splatMat.defines = q.edl ? { EDL: '' } : {};
    this.splatMat.needsUpdate = true;
    if (this.birdMesh) {
      const bm = this.birdMesh.material as THREE.ShaderMaterial;
      bm.defines = { ...this.worldMat.defines, BIRD: '' };
      bm.needsUpdate = true;
    }
    this.postMat.defines = { ...(q.chroma ? { CHROMA: '' } : {}), ...(q.haze > 0 ? { HAZE: '' } : {}) };
    this.postMat.needsUpdate = true;
    this.hazeMat.defines = { HAZE_STEPS: Math.max(1, q.haze), ...(q.hazeShadow && q.shadow > 0 ? { HAZE_SHADOW: '' } : {}) };
    this.hazeMat.needsUpdate = true;
    // Буферы зависят от качества (копии кадра, дымка): пересоздаём, даже если размер тот же.
    this.width = 0;
    this.resize(this.cssW, this.cssH);
  }

  private rebuildDust(count: number): void {
    this.dustCount = count;
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
    }
    const seeds = new Float32Array(count * 3);
    // Равномерный разброс без Math.random: кадры повторяемы от запуска к запуску.
    let s = 12345;
    for (let i = 0; i < seeds.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      seeds[i] = s / 4294967296;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.layers.set(1);
    this.scene.add(this.dust);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
  }

  /** Размер области показа в пикселях CSS. */
  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const spec = this.specOf(this.quality);
    const [w, h] = internalSize(this.cssW, this.cssH, spec.pixels, dpr);
    const fine = fineOf(this.cssW, this.cssH, spec, dpr);
    if (w === this.width && h === this.height && fine === this.fine) return;
    this.width = w;
    this.height = h;
    this.fine = fine;
    this.renderer.setSize(w, h, false);
    for (const rt of [this.sceneRT, this.scenePrevRT, ...this.memRT]) {
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    this.sceneRT = this.makeSceneRT(w, h);
    this.scenePrevRT = this.makeSceneRT(w, h);
    this.memRT = [this.makeMemRT(w, h), this.makeMemRT(w, h)];
    this.memLive = false;
    for (const rt of [this.rawRT, this.echoRT, this.compRT, this.compPrevRT]) rt.dispose();
    this.rawRT = this.makeMemRT(w, h);
    this.echoRT = this.makeMemRT(w, h);
    this.compRT = this.makeCompRT(w, h);
    this.compPrevRT = this.makeCompRT(w, h);
    this.hazeRT?.dispose();
    this.hazeRT = null;
    const q = QUALITY[this.quality];
    if (q.haze > 0) {
      // Дымка мельче не становится: её буфер остаётся того же размера, что при обычном зерне.
      const hw = Math.max(2, Math.round(w / (q.hazeDiv * fine)));
      const hh = Math.max(2, Math.round(h / (q.hazeDiv * fine)));
      this.hazeRT = this.makeHazeRT(hw, hh);
      this.postMat.uniforms.uHazeTexel!.value.set(1 / hw, 1 / hh);
    }
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.baseFov = verticalFov(aspect);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    const tanY = Math.tan((this.camera.fov * Math.PI) / 360);
    this.hazeMat.uniforms.uTan!.value.set(tanY * aspect, tanY);
    this.hazeMat.uniforms.uNearFar!.value.set(this.camera.near, this.camera.far);
    this.postMat.uniforms.uRes!.value.set(w, h);
    this.postMat.uniforms.uAspect!.value = aspect;
    this.spotMat.uniforms.uAspect!.value = aspect;
    // Уменьшенная копия, где один тексель — примерно восьмая часть высоты кадра.
    this.spotMat.uniforms.uLod!.value = Math.max(0, Math.log2(h) - 3);
    // Мелкое зерно (fine > 1): всё, что считается в точках, остаётся того же размера в пикселях буфера, а
    // буфер крупнее — значит, на экране точка мельче во столько же раз. Чтобы поверхность была покрыта
    // так же, точек больше в fine² раз. То, что принадлежит «формату записи» (строки развёртки, блоки
    // срыва, ореол, звёзды), на экране остаётся прежним.
    const f2 = fine * fine;
    this.dustMat.uniforms.uPointScale!.value = h / 160 / fine;
    // Пыль выросшей вещи (куратор, 429): шаг решётки — по высоте кадра. В кадре 720 строк пылинка 4,5 см; в низком
    // кадре (360 строк) она была бы мельче пикселя уже в трёх метрах и мерцала бы — там она крупнее, до 11 см.
    this.worldMat.uniforms.uDotGrid!.value = dotGrid(h / fine);
    const dustN = Math.round(q.dust * f2);
    if (dustN !== this.dustCount) this.rebuildDust(dustN);
    this.starMat.uniforms.uPx!.value = h / 720;
    this.postMat.uniforms.uFmt!.value = fine;
    this.postMat.uniforms.uLodFine!.value = Math.log2(fine);
    // Сплаты: сколько пикселей буфера в метре на расстоянии в метр и какой у сплата размер в мире.
    const su = this.splatMat.uniforms;
    const points = q.points * f2;
    su.uProj!.value = h / (2 * tanY);
    this.lastFov = this.camera.fov;
    su.uMaxPx!.value = Math.max(5, (h * SCAN.maxPx) / fine);
    su.uSize!.value = SCAN.size / Math.sqrt(points);
    (su.uNearFar!.value as THREE.Vector2).set(this.camera.near, this.camera.far);
    this.clouds.setDensity(points);
    this.grainDensity = Math.min(1, q.points / 1100 + 0.25) * f2;
    this.clouds.budget = q.points * SCAN.sow * Math.min(f2, SOW_FINE_MAX);
  }

  /** Облако точек ещё досевается: кадр сейчас легче, чем будет (замер времени кадра это учитывает). */
  get sowing(): boolean {
    return this.clouds.behind > 0;
  }

  /** Насколько мелким вышло бы зерно на этом экране при таком качестве (сейчас — поле fine). */
  fineFor(q: Quality): number {
    return fineOf(this.cssW, this.cssH, this.specOf(q), typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  }

  /**
   * Сколько миллисекунд уходит на кадр на самом деле: рисует кадры подряд и после каждого ждёт
   * видеокарту (чтение одной точки кадра не возвращается, пока она не закончит). По частоте кадров этого
   * не узнать: она упирается в частоту экрана и запаса не показывает. Первый кадр не в счёт — в нём
   * собираются шейдеры и заводятся буферы. stopMs — замер обрывается, как только на него ушло столько
   * времени: слабую машину не держим. Возвращает среднее по нарисованным кадрам.
   */
  measure(draw: () => void, frames: number, stopMs: number): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    // Читается сам кадр на экране: из буфера другого вида чтение может не состояться — и ожидания не будет.
    const wait = (): void => {
      this.renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    draw();
    wait();
    const t0 = performance.now();
    let n = 0;
    while (n < frames) {
      draw();
      wait();
      n += 1;
      if (performance.now() - t0 > stopMs) break;
    }
    return (performance.now() - t0) / n;
  }

  /**
   * Проверка на устройстве (#diag): видеокарта и что лежит в кадре в заданных точках (доли кадра, y — сверху
   * вниз): цвет поверхности и её «собранность» (альфа кадра мира — число замеров), память света. Читает
   * пиксели из видеокарты — только для проверки, не каждый кадр.
   */
  diag(points: readonly (readonly [number, number])[]): { gpu: string; webgl2: boolean; highp: number; probes: { scene: number[]; mem: number[] }[] } {
    const gl = this.renderer.getContext();
    let gpu = '?';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      // нет сведений — не беда
    }
    const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0;
    const buf = new Uint8Array(4);
    const read = (rt: THREE.WebGLRenderTarget, u: number, v: number): number[] => {
      const x = Math.min(rt.width - 1, Math.max(0, Math.round(u * rt.width)));
      const y = Math.min(rt.height - 1, Math.max(0, Math.round((1 - v) * rt.height)));
      this.renderer.readRenderTargetPixels(rt, x, y, 1, 1, buf);
      return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
    };
    const probes = points.map(([u, v]) => ({ scene: read(this.sceneRT, u, v), mem: read(this.memRT[1], u, v) }));
    return { gpu, webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext, highp, probes };
  }

  /**
   * Проверка на устройстве: код ошибки WebGL с прошлого вызова (0 — ошибок не было). Safari, отказавшись
   * рисовать сетку, ставит INVALID_OPERATION (1282) — по этому коду в строке проверки видно, что что-то не
   * нарисовалось, ещё до того, как это заметит глаз. Только для строки проверки: опрос замедляет кадр.
   */
  glError(): number {
    return this.renderer.getContext().getError();
  }

  /**
   * Проверка «как в Safari» (смоук, __vz.geometryAudit): у каждой сетки на сценах хватает данных каждого
   * канала на все вершины, до которых дотягиваются её индексы. Safari проверяет это перед каждым вызовом
   * отрисовки и при нехватке не рисует сетку целиком, Chrome подставляет нули — поэтому на компьютере
   * такую ошибку не видно (так на iPhone пропадал зал ожидания). Пусто — всё в порядке.
   */
  geometryAudit(): string[] {
    const bad: string[] = [];
    const seen = new Set<THREE.BufferGeometry>();
    const scenes = [this.scene, this.clouds.scene, this.edgeScene, this.grainScene, this.swarmScene, this.echoScene, this.trailScene, this.memScene, this.composeScene, this.hazeScene, this.spotScene, this.postScene];
    for (const s of scenes) {
      s.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!g || seen.has(g)) return;
        seen.add(g);
        const idx = g.getIndex();
        let need = g.getAttribute('position')?.count ?? 0;
        if (idx) {
          let m = -1;
          const a = idx.array;
          for (let i = 0; i < a.length; i++) if (a[i]! > m) m = a[i]!;
          need = m + 1;
        }
        for (const [name, attr] of Object.entries(g.attributes)) {
          if ((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) continue;
          if (attr.count < need) bad.push(`${o.type}${o.name ? ` ${o.name}` : ''} ${name}: ${attr.count} < ${need}`);
        }
      });
    }
    return bad;
  }

  /**
   * Проверка на устройстве: что процессор отдал шейдеру мира — для сверки с тем, что видит видеокарта
   * (служебный кадр 3 пишет номер клетки, а здесь лежит свет этой клетки в текстуре).
   */
  diagUniforms(): { scan: number[]; fade: number; range: number[]; cone: number[]; tall: number; keyCells: number; grid: number[]; ambient: number[]; texel: (cx: number, cz: number) => number[] } {
    const u = this.worldMat.uniforms;
    const vec = (n: string): number[] => (u[n]!.value as THREE.Vector2 | THREE.Vector3 | THREE.Vector4).toArray();
    const data = this.cellTex.image.data as Uint8Array;
    return {
      scan: vec('uScan'),
      fade: u.uScanFade!.value as number,
      range: vec('uScanRange'),
      cone: vec('uGazeCone').map((c) => (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI),
      tall: u.uGazeTall!.value as number,
      keyCells: u.uKeyCells!.value as number,
      grid: vec('uCellGrid'),
      ambient: vec('uAmbient'),
      texel: (cx, cz) => (cx < 0 || cz < 0 || cx >= CELL_TEX || cz >= CELL_TEX ? [-1, -1, -1, -1] : Array.from(data.subarray((cz * CELL_TEX + cx) * 4, (cz * CELL_TEX + cx) * 4 + 4))),
    };
  }

  /**
   * Проверка на устройстве, режим «факторы»: мир рисуется не цветом, а тем, из чего сложилась сборка
   * поверхности (r — взгляд, g — рассеянный свет, b — дальность, a — итог). Только для строки проверки.
   */
  debugView = 0;

  /** Облако точек сейчас включено (выключенное — мир сплошными поверхностями). */
  get scanOn(): boolean {
    return !this.debugScanOff;
  }

  /** Отладка: облако точек вкл/выкл. */
  debugScan(on: boolean): void {
    if (this.debugScanOff === !on) return;
    this.debugScanOff = !on;
    this.applyQuality();
  }

  /**
   * Насколько растворён объект уровня (world/objects.ts): 0 — стоит, 1 — его нет. Объект лежит в общей
   * сетке помещения; шейдер находит его вершины по номеру.
   */
  /**
   * Тени-пятна уровня (render/contact.ts): карта size × size, по каналу на ярус, 255 — темно; origin — её
   * угол в мире (x, z), span — сторона, м. null — карты нет.
   */
  /**
   * Сцена — кусок места: маска того, что помнится (world/piece.ts, pieceMask); null — помнится всё место. Включается в кадре,
   * пока игрок на месте, а не в кармане (FrameView.piece).
   */
  setPiece(mask: PieceMask | null): void {
    this.pieceReady = mask !== null;
    if (!mask) return;
    const rows = mask.h * mask.tiers;
    const img = this.pieceTex.image as { data: Uint8Array; width: number; height: number };
    if (img.width !== mask.w || img.height !== rows) {
      this.pieceTex.dispose();
      this.pieceTex = new THREE.DataTexture(new Uint8Array(mask.data), mask.w, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.pieceTex.magFilter = THREE.NearestFilter;
      this.pieceTex.minFilter = THREE.NearestFilter;
      this.pieceU.uPiece.value = this.pieceTex;
    } else img.data.set(mask.data);
    this.pieceTex.needsUpdate = true;
    this.pieceU.uPieceGrid.value.set(mask.offX, mask.offZ, mask.w, mask.h);
    this.pieceU.uPieceOn.value.y = mask.tiers;
  }

  setContact(map: { data: Uint8Array; size: number; origin: readonly [number, number]; span: number } | null): void {
    if (!map) {
      this.contactSpan = 0;
      return;
    }
    const img = this.contactTex.image as { data: Uint8Array; width: number; height: number };
    if (img.width !== map.size) {
      this.contactTex.dispose();
      this.contactTex = new THREE.DataTexture(new Uint8Array(map.data), map.size, map.size, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.contactTex.magFilter = THREE.LinearFilter;
      this.contactTex.minFilter = THREE.LinearFilter;
      this.worldMat.uniforms.uContact!.value = this.contactTex;
    } else img.data.set(map.data);
    this.contactTex.needsUpdate = true;
    this.contactOrigin = [map.origin[0], map.origin[1]];
    this.contactSpan = map.span;
  }

  setObjectState(id: number, dis: number, quiet = false): void {
    if (id <= 0 || id >= OBJ_TEX * OBJ_TEX) return;
    const d = Math.max(0, Math.min(1, dis));
    const v = Math.round(d * 255);
    const was = this.objData[id * 4]! / 255;
    if (this.objData[id * 4] !== v) {
      this.objData[id * 4] = v;
      this.objTex.needsUpdate = true;
    }
    // quiet — без пыли: предмета нет с самого начала круга (стёрт раньше), а не рассыпался на глазах.
    if (!quiet) this.grainsFor(`o${id}`, was, d, () => this.sowObject(id));
  }

  /**
   * Тон объекта уровня: dull — насколько он выцвел (0 — свой цвет, 1 — бумага), glow — насколько
   * светится своим цветом. Так бумажные цветы тусклы, пока к ним не подошли, и ярки перед распадом.
   */
  setObjectTone(id: number, dull: number, glow: number): void {
    if (id <= 0 || id >= OBJ_TEX * OBJ_TEX) return;
    const a = Math.round(Math.max(0, Math.min(1, dull)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, glow)) * 255);
    if (this.objData[id * 4 + 2] === a && this.objData[id * 4 + 3] === b) return;
    this.objData[id * 4 + 2] = a;
    this.objData[id * 4 + 3] = b;
    this.objTex.needsUpdate = true;
  }

  /**
   * Грибы: count мест по SPORE_STRIDE чисел — x, y, z, поворот, размер, род (0 — угол: гроздь крупнее; 1 — пол), форма грозди.
   * Места уже упорядочены от ближнего: берутся первые, сколько позволяет качество (SPORES_CAP), — из тех, что в кадре. Дальние
   * (SPORE_LOD_AT) — упрощённой сеткой. Тени грибы не дают и точками не рассыпаются: это не вещь места, а то, что проросло
   * сквозь него. Раскладываются в render (layoutSpores): «в кадре» — значит в кадре этого же кадра, и после скачка тоже.
   */
  setSpores(data: Float32Array, count: number): void {
    this.sporeData = data;
    this.sporeCount = count;
    if (count === 0) {
      for (const mesh of this.sporeMeshes.values()) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }
  }

  private layoutSpores(): void {
    const data = this.sporeData;
    const count = this.sporeCount;
    if (!data || count === 0) return;
    const S = SPORE_STRIDE;
    const cap = SPORES_CAP[this.quality];
    const up = this.sporeP.set(0, 1, 0);
    const cam = this.camera;
    this.sporeView.setFromProjectionMatrix(this.sporeVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const planes = this.sporeView.planes;
    const slack = Math.sin(SPORE_CULL.margin);
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    this.sporeUsed.clear();
    const st = this.sporeStats;
    st.shown = 0;
    st.far = 0;
    st.culled = 0;
    for (let i = 0; i < count && st.shown < cap; i++) {
      const x = data[i * S]!;
      const y = data[i * S + 1]!;
      const z = data[i * S + 2]!;
      if (y < this.tierBand[0] || y > this.tierBand[1]) {
        st.culled += 1;
        continue;
      }
      const k = data[i * S + 4]! * (data[i * S + 5]! < 0.5 ? 1.5 : 1);
      const d = Math.hypot(x - cx, y - cy, z - cz);
      // Шар грозди: центр — на высоте половины гриба, радиус с запасом на поворот взгляда (чем дальше, тем больше).
      const r = SPORE_CULL.ball * k + d * slack;
      let inside = true;
      for (let p = 0; p < 6 && inside; p++) {
        const pl = planes[p]!;
        if (pl.normal.x * x + pl.normal.y * (y + 0.2 * k) + pl.normal.z * z + pl.constant < -r) inside = false;
      }
      if (!inside) {
        st.culled += 1;
        continue;
      }
      const lod = d > SPORE_LOD_AT ? 1 : 0;
      const form = data[i * S + 6]!;
      const key = form * 2 + lod;
      let mesh = this.sporeMeshes.get(key);
      if (!mesh) {
        if (!this.sporeMat) {
          this.sporeMat = this.worldLike();
          this.sporeMat.uniforms.uThing = { value: new THREE.Vector4(0, 0, 2, 0) };
          this.sporeMat.defines = { ...this.worldMat.defines };
        }
        mesh = new THREE.InstancedMesh(this.makeMesh(mushroomForm(form, lod), 0, 0).geometry, this.sporeMat, SPORES_MAX);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.layers.set(1);
        this.scene.add(mesh);
        this.sporeMeshes.set(key, mesh);
      }
      const c = this.sporeUsed.get(key) ?? 0;
      this.sporeQ.setFromAxisAngle(up, data[i * S + 3]!);
      this.sporeM.compose(this.tmpV.set(x, y, z), this.sporeQ, this.sporeS.set(k, k, k));
      mesh.setMatrixAt(c, this.sporeM);
      this.sporeUsed.set(key, c + 1);
      st.shown += 1;
      st.far += lod;
    }
    for (const [key, mesh] of this.sporeMeshes) {
      const c = this.sporeUsed.get(key) ?? 0;
      mesh.count = c;
      mesh.visible = c > 0;
      if (c > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Трава: count плиток по GRASS_STRIDE чисел (уже от ближнего). Раскладка по сеткам — в render, когда камера кадра выставлена.
   */
  setGrass(data: Float32Array, count: number): void {
    this.grassData = data;
    this.grassCount = count;
    if (count === 0) {
      for (const mesh of this.grassMeshes.values()) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }
  }

  /**
   * Вытоптанные круги травы места (level_build.ts, grassClear): у мест вещей и у дверей травинки лежат, в середине их нет. По
   * четыре числа: x, пол, z, радиус. Больше GRASS_CLEAR не держится; пусто — трава всюду стоит.
   */
  setGrassClear(list: readonly (readonly [number, number, number, number])[]): void {
    for (let i = 0; i < GRASS_CLEAR; i++) {
      const c = list[i];
      if (c) this.grassClear[i]!.set(c[0], c[1], c[2], c[3]);
      else this.grassClear[i]!.set(0, 0, 0, 0);
    }
  }

  /**
   * След лежавшего человека в траве (world/level_build.ts, grassBody): капсулы силуэта (ax, az, bx, bz, радиус), пол под ним и
   * насколько трава примята — 1 только что лежали, 0 встала. Нет следа — null.
   */
  setGrassBody(caps: readonly (readonly number[])[] | null, floor = 0, press = 0): void {
    for (let i = 0; i < 8; i++) {
      const c = caps?.[i];
      const r = this.grassBodyR[i >> 2]!;
      const ri = i & 3;
      if (c) {
        this.grassBody[i]!.set(c[0]!, c[1]!, c[2]!, c[3]!);
        r.setComponent(ri, c[4]!);
      } else {
        // Пустая капсула далеко от всего: в силуэт не попадает ни одна травинка.
        this.grassBody[i]!.set(1e6, 1e6, 1e6, 1e6);
        r.setComponent(ri, 0);
      }
    }
    // Ось тела к ногам — по туловищу (третья капсула: от плеч к тазу): вдоль неё «причёсана» примятая трава.
    const t = caps?.[2];
    const ax = t ? t[2]! - t[0]! : 1;
    const az = t ? t[3]! - t[1]! : 0;
    const l = Math.hypot(ax, az) || 1;
    this.grassBodyK.set(floor, caps ? Math.max(0, Math.min(1, press)) : 0, ax / l, az / l);
  }

  private makeLeanTex(data: Uint8Array, w: number, h: number): THREE.DataTexture {
    const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    // Строка карты — по байту на клетку: без выравнивания по 4 байта, иначе ширина не кратная четырём съезжает.
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Трава тянется к свету (systems/grass.ts, LEAN): карта поля (null — травы, которая тянется, нет: газон или пусто), откуда свет
   * и сила; changed — карта менялась в этом кадре (перезалить текстуру); dir — куда светят (к оси луча трава и клонится).
   */
  setGrassLean(map: LeanMap | null, from: readonly number[] | null, strength: number, changed: boolean, dir: readonly number[] = [0, 0, -1]): void {
    if (!map || !from || strength <= 0) {
      this.leanFrom.w = 0;
      return;
    }
    const img = this.leanTex.image as { data: Uint8Array; width: number; height: number };
    if (img.data !== map.data || img.width !== map.w || img.height !== map.h) {
      // Другое поле (уровень, карман): своя карта — своя текстура.
      this.leanTex.dispose();
      this.leanTex = this.makeLeanTex(map.data, map.w, map.h);
      if (this.grassMat) this.grassMat.uniforms.uLean!.value = this.leanTex;
    } else if (changed) this.leanTex.needsUpdate = true;
    this.leanRect.set(map.minX, map.minZ, 1 / (map.w * map.cell), 1 / (map.h * map.cell));
    this.leanFrom.set(from[0]!, from[1]!, from[2]!, strength);
    this.leanDir.set(dir[0]!, dir[1]!, dir[2]!, 0);
  }

  private layoutGrass(): void {
    const data = this.grassData;
    const count = this.grassCount;
    if (!data || count === 0) return;
    const S = GRASS_STRIDE;
    const cap = GRASS_CAP[this.quality];
    const nearCap = GRASS_NEAR_CAP[this.quality];
    const lodAt = GRASS_LOD_AT[this.quality];
    const horizonAt = GRASS_HORIZON_AT[this.quality];
    const cam = this.camera;
    this.sporeView.setFromProjectionMatrix(this.sporeVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const planes = this.sporeView.planes;
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    this.grassUsed.clear();
    const st = this.grassStats;
    st.shown = 0;
    st.far = 0;
    st.horizon = 0;
    st.culled = 0;
    st.tris = 0;
    // Первый проход: какие плитки в кадре (уже от ближней) и где трава кончается — на дальности или на пределе по качеству.
    const pick = this.grassPick;
    let n = 0;
    let end = GRASS_FAR;
    for (let i = 0; i < count; i++) {
      const o = i * S;
      const x = data[o]!;
      const y = data[o + 1]!;
      const z = data[o + 2]!;
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d > GRASS_FAR) break;
      if (y < this.tierBand[0] || y > this.tierBand[1]) {
        st.culled += 1;
        continue;
      }
      // Плитка — квадрат со стороной s и травой до полуметра: шар вокруг её середины.
      const r = 0.75 * data[o + 4]! + 0.25 * data[o + 5]!;
      let inside = true;
      for (let p = 0; p < 6 && inside; p++) {
        const pl = planes[p]!;
        if (pl.normal.x * x + pl.normal.y * (y + 0.2) + pl.normal.z * z + pl.constant < -r) inside = false;
      }
      if (!inside) {
        st.culled += 1;
        continue;
      }
      if (n >= cap) {
        end = d;
        break;
      }
      pick[n++] = i;
    }
    st.end = end;
    // Последние метры травы — ниже и ниже до нуля: край не читается кругом.
    const fade = Math.min(5, 0.3 * end);
    let near = 0;
    for (let j = 0; j < n; j++) {
      const o = pick[j]! * S;
      const x = data[o]!;
      const y = data[o + 1]!;
      const z = data[o + 2]!;
      const d = Math.hypot(x - cx, y - cy, z - cz);
      const t = Math.min(1, Math.max(0, (end - d) / fade));
      const grow = t * t * (3 - 2 * t);
      if (grow < 0.03) continue;
      const lod: GrassLod = d > horizonAt ? 2 : d > lodAt || near >= nearCap ? 1 : 0;
      const form = data[o + 6]!;
      const key = form * GRASS_LODS + lod;
      let mesh = this.grassMeshes.get(key);
      if (!mesh) {
        if (!this.grassMat) {
          this.grassMat = this.worldLike();
          this.grassMat.uniforms.uThing = { value: new THREE.Vector4(0, 0, 1, 0) };
          this.grassMat.uniforms.uClear = { value: this.grassClear };
          this.grassMat.uniforms.uBody = { value: this.grassBody };
          this.grassMat.uniforms.uBodyR = { value: this.grassBodyR };
          this.grassMat.uniforms.uBodyK = { value: this.grassBodyK };
          this.grassMat.uniforms.uLean = { value: this.leanTex };
          this.grassMat.uniforms.uLeanRect = { value: this.leanRect };
          this.grassMat.uniforms.uLeanFrom = { value: this.leanFrom };
          this.grassMat.uniforms.uLeanDir = { value: this.leanDir };
          // GRASS — травинку решает её корень: вытоптанные круги и стёртый пол (render/shaders.ts).
          this.grassMat.defines = { ...this.worldMat.defines, GRASS: GRASS_CLEAR };
        }
        const kind = GRASS_KINDS[Math.floor(form / GRASS_VARIANTS)] ?? 'meadow';
        mesh = new THREE.InstancedMesh(this.makeMesh(grassTile(kind, form % GRASS_VARIANTS, lod), 0, 0).geometry, this.grassMat, GRASS_ROOM[lod]!);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.layers.set(1);
        this.scene.add(mesh);
        this.grassMeshes.set(key, mesh);
      }
      const c = this.grassUsed.get(key) ?? 0;
      if (c >= mesh.instanceMatrix.count) continue;
      if (lod === 0) near += 1;
      this.sporeQ.setFromAxisAngle(this.grassAxis, data[o + 3]!);
      this.sporeM.compose(this.tmpV.set(x, y, z), this.sporeQ, this.sporeS.set(data[o + 4]!, data[o + 5]! * grow, data[o + 4]!));
      mesh.setMatrixAt(c, this.sporeM);
      this.grassUsed.set(key, c + 1);
      st.shown += 1;
      if (lod === 1) st.far += 1;
      if (lod === 2) st.horizon += 1;
      st.tris += grassTrisOf(form, lod);
    }
    for (const [key, mesh] of this.grassMeshes) {
      const c = this.grassUsed.get(key) ?? 0;
      mesh.count = c;
      mesh.visible = c > 0;
      if (c > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private readonly grassAxis = new THREE.Vector3(0, 1, 0);

  /**
   * Головки цветов оранжереи: count головок по FLOWER_STRIDE чисел (уже от ближнего). Как грибы: копии одной сетки на форму,
   * дальние — упрощённой, вне кадра — не рисуются; свет, тень и правило взгляда — как у всего мира (вещь места).
   */
  setFlowers(data: Float32Array, count: number): void {
    this.flowerData = data;
    this.flowerCount = count;
    if (count === 0) {
      for (const mesh of this.flowerMeshes.values()) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }
  }

  private layoutFlowers(): void {
    const data = this.flowerData;
    const count = this.flowerCount;
    if (!data || count === 0) return;
    const S = FLOWER_STRIDE;
    const cap = FLOWERS_CAP[this.quality];
    const cam = this.camera;
    // Пирамида обзора уже посчитана грибами в этом кадре (layoutSpores) — но грибов может не быть: считаем сами.
    this.sporeView.setFromProjectionMatrix(this.sporeVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const planes = this.sporeView.planes;
    const slack = Math.sin(SPORE_CULL.margin);
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    this.flowerUsed.clear();
    const st = this.flowerStats;
    st.shown = 0;
    st.far = 0;
    st.culled = 0;
    for (let i = 0; i < count && st.shown < cap; i++) {
      const o = i * S;
      const x = data[o]!;
      const y = data[o + 1]!;
      const z = data[o + 2]!;
      if (y < this.tierBand[0] || y > this.tierBand[1]) {
        st.culled += 1;
        continue;
      }
      const d = Math.hypot(x - cx, y - cy, z - cz);
      const r = 0.12 * Math.max(data[o + 7]!, data[o + 8]!) + d * slack;
      let inside = true;
      for (let p = 0; p < 6 && inside; p++) {
        const pl = planes[p]!;
        if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) inside = false;
      }
      if (!inside) {
        st.culled += 1;
        continue;
      }
      const lod = d > FLOWER_LOD_AT ? 1 : 0;
      const form = data[o + 9]!;
      const key = form * 2 + lod;
      let mesh = this.flowerMeshes.get(key);
      if (!mesh) {
        if (!this.flowerMat) {
          this.flowerMat = this.worldLike();
          this.flowerMat.uniforms.uThing = { value: new THREE.Vector4(0, 0, 1, 0) };
          this.flowerMat.defines = { ...this.worldMat.defines };
        }
        mesh = new THREE.InstancedMesh(this.makeMesh(headForm(form, lod as 0 | 1), 0, 0).geometry, this.flowerMat, FLOWERS_MAX);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.layers.set(1);
        this.scene.add(mesh);
        this.flowerMeshes.set(key, mesh);
      }
      const c = this.flowerUsed.get(key) ?? 0;
      this.sporeQ.set(data[o + 3]!, data[o + 4]!, data[o + 5]!, data[o + 6]!);
      this.sporeM.compose(this.tmpV.set(x, y, z), this.sporeQ, this.sporeS.set(data[o + 7]!, data[o + 8]!, data[o + 7]!));
      mesh.setMatrixAt(c, this.sporeM);
      this.flowerUsed.set(key, c + 1);
      st.shown += 1;
      st.far += lod;
    }
    for (const [key, mesh] of this.flowerMeshes) {
      const c = this.flowerUsed.get(key) ?? 0;
      mesh.count = c;
      mesh.visible = c > 0;
      if (c > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Птицы (systems/birds.ts): count птиц по BIRD_STRIDE чисел — x, y, z, поворот, наклон носа, крен, фаза
   * взмаха, раскрытие крыльев, размер. Одна сетка, много копий; крыльями машет шейдер. Свет, тень и
   * правило взгляда у них те же, что у всего мира: птицу видно там, где место собрано.
   */
  setBirds(data: Float32Array, count: number): void {
    if (!this.birdMesh) {
      if (count === 0) return;
      const src = this.makeMesh(birdMesh(), 0, 0);
      const mat = this.worldLike();
      mat.uniforms.uThing = { value: new THREE.Vector4(0, 0, 1, 0) };
      mat.defines = { ...this.worldMat.defines, BIRD: '' };
      this.birdFlap = new THREE.InstancedBufferAttribute(new Float32Array(BIRDS_MAX * 2), 2);
      this.birdFlap.setUsage(THREE.DynamicDrawUsage);
      src.geometry.setAttribute('iBird', this.birdFlap);
      this.birdMesh = new THREE.InstancedMesh(src.geometry, mat, BIRDS_MAX);
      this.birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.birdMesh.frustumCulled = false;
      this.birdMesh.matrixAutoUpdate = false;
      this.scene.add(this.birdMesh);
    }
    const n = Math.min(count, BIRDS_MAX);
    const flap = this.birdFlap!.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const o = i * BIRD_STRIDE;
      const k = data[o + 8]!;
      // Порядок поворотов: сначала крен вокруг своей оси, потом нос вверх, потом курс.
      this.sporeQ.setFromEuler(this.birdE.set(-data[o + 4]!, data[o + 3]!, data[o + 5]!, 'YXZ'));
      this.sporeM.compose(this.tmpV.set(data[o]!, data[o + 1]!, data[o + 2]!), this.sporeQ, this.sporeS.set(k, k, k));
      this.birdMesh.setMatrixAt(i, this.sporeM);
      flap[i * 2] = data[o + 6]!;
      flap[i * 2 + 1] = data[o + 7]!;
    }
    this.birdMesh.count = n;
    this.birdMesh.visible = n > 0;
    this.birdMesh.instanceMatrix.needsUpdate = true;
    this.birdFlap!.needsUpdate = true;
  }

  /** Объект уровня — кружево: поверхности нет, одни нити (ступень перед пустотой, systems/decay.ts). */
  setObjectLace(id: number, on: boolean): void {
    if (id <= 0 || id >= OBJ_TEX * OBJ_TEX) return;
    const v = on ? 255 : 0;
    if (this.objData[id * 4 + 1] === v) return;
    this.objData[id * 4 + 1] = v;
    this.objTex.needsUpdate = true;
    // Нити по рёбрам: кусок, в котором лежит предмет, перестроит их перед следующим кадром.
    for (let c = 0; c < this.chunkData.length; c++) {
      let map = this.chunkTris[c];
      if (!map) this.chunkTris[c] = map = objectTriangles(this.chunkData[c]!);
      if (map.has(id)) this.laceDirty.add(c);
    }
  }

  /**
   * Нити по рёбрам кружевных предметов куска c: линии изломов и краёв только тех предметов, что сейчас
   * кружево. Каналы — те же, что у сетки куска (общие буферы), своё только перечисление рёбер.
   */
  private buildLaceEdges(c: number): void {
    const m = this.chunks[c];
    const data = this.chunkData[c];
    if (!m || !data) return;
    let map = this.chunkTris[c];
    if (!map) this.chunkTris[c] = map = objectTriangles(data);
    const tri: number[] = [];
    for (const [id, list] of map) {
      if (this.objData[id * 4 + 1]! === 0) continue;
      for (const t of list) tri.push(data.index[t * 3]!, data.index[t * 3 + 1]!, data.index[t * 3 + 2]!);
    }
    const old = m.userData.laceEdges as THREE.LineSegments | undefined;
    if (tri.length === 0) {
      if (old) old.visible = false;
      return;
    }
    const idx = new THREE.BufferAttribute(edgeIndex(tri, data.position, data.position.length / 3), 1);
    if (old) {
      // Каналы общие с куском: геометрию не выбрасываем (это освободило бы и его буферы), меняем рёбра.
      old.geometry.setIndex(idx);
      old.visible = true;
      return;
    }
    const lines = this.edgeLines(m.geometry, idx, this.laceEdgeMat);
    m.add(lines);
    m.userData.laceEdges = lines;
  }

  /** Линии рёбер поверх сетки: все каналы — её же (общие буферы), своё — только перечисление рёбер. */
  private edgeLines(src: THREE.BufferGeometry, idx: THREE.BufferAttribute, mat: THREE.ShaderMaterial): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setIndex(idx);
    g.boundingSphere = src.boundingSphere;
    const lines = new THREE.LineSegments(g, mat);
    lines.matrixAutoUpdate = false;
    // Тень нити не нужна: в карту теней идёт сама вещь.
    lines.layers.set(1);
    return lines;
  }

  /**
   * Стирание места (systems/decay.ts): насколько нет потолка, стен и пола, 0..1. Потолок пропадает
   * совсем, стены и пол остаются кружевом. Карманным пространствам стирание не положено — там нули.
   * wear — сама стёртость места, 0..1: по ней блёкнут листы бумаги (лица и буквы уходят первыми).
   */
  /** Стирание места; tile — шаг плиток подвесного потолка, м (0 — потолок цельный): он выпадает плитками. */
  setErase(ceiling: number, walls: number, floor: number, wear = 0, tile = 0): void {
    (this.worldMat.uniforms.uErase!.value as THREE.Vector4).set(ceiling, walls, floor, wear);
    this.worldMat.uniforms.uCeilTile!.value = tile;
  }

  /** Посеять пыль объекта уровня: его треугольники — в сетке одного из кусков. */
  private sowObject(id: number): { grains: Grains; matrix: THREE.Matrix4 } | null {
    for (let c = 0; c < this.chunkData.length; c++) {
      let map = this.chunkTris[c];
      if (!map) this.chunkTris[c] = map = objectTriangles(this.chunkData[c]!);
      const tris = map.get(id);
      if (tris) {
        const grains = sowGrains(this.chunkData[c]!, tris, id * 7919 + 13, this.grainDensity);
        if (this.objData[id * 4 + 1]! > 0) threadDust(grains);
        return { grains, matrix: this.chunks[c]!.matrixWorld };
      }
    }
    return null;
  }

  /**
   * Пыль вещи: распад изменился с was на now. Облако заводится, когда вещь начала уходить или
   * возвращаться, и живёт, пока гаснут или встают на места её точки (render/grains.ts).
   */
  private grainsFor(key: string, was: number, now: number, sow: () => { grains: Grains; matrix: THREE.Matrix4 } | null): void {
    let b = this.bursts.get(key);
    if (!b) {
      if (Math.abs(now - was) < 1e-4 || (now <= 0 && was <= 0)) return;
      const coming = now < was;
      // Уже собралась (или ещё цела) — пыли нет.
      if (coming ? now <= 0 : now <= 0.002) return;
      const made = sow();
      if (!made || made.grains.count === 0) return;
      const g = made.grains;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('aNrm', new THREE.BufferAttribute(g.normal, 3));
      geo.setAttribute('aCol', new THREE.BufferAttribute(g.color, 3));
      geo.setAttribute('aRnd', new THREE.BufferAttribute(g.rnd, 4));
      const life = newGrainLife(now, coming);
      const mat = new THREE.ShaderMaterial({
        vertexShader: GRAIN_VERT,
        fragmentShader: SPLAT_FRAG,
        uniforms: { ...this.grainU, uGo: { value: now }, uFlow: { value: life.flow }, uFade: { value: life.fade } },
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.matrixAutoUpdate = false;
      points.matrix.copy(made.matrix);
      points.matrixWorldNeedsUpdate = true;
      this.grainScene.add(points);
      b = { points, mat, life };
      this.bursts.set(key, b);
      return;
    }
    steerGrains(b.life, now);
  }

  private dropBurst(key: string): void {
    const b = this.bursts.get(key);
    if (!b) return;
    this.grainScene.remove(b.points);
    b.points.geometry.dispose();
    b.mat.dispose();
    this.bursts.delete(key);
  }

  /** Сколько облаков пыли сейчас живо и сколько в них точек (для проверок). */
  dustInfo(): { clouds: number; points: number } {
    let points = 0;
    for (const b of this.bursts.values()) points += b.points.geometry.getAttribute('position').count;
    return { clouds: this.bursts.size, points };
  }

  /** Заменить геометрию мира. stairs — лестницы между ярусами: рядом с ними виден соседний ярус. */
  setWorld(chunks: readonly LevelChunk[], stairs: readonly StairLink[] = []): void {
    // Новый уровень — кинескоп прежнего снимается вместе с кольцом кадров.
    this.setOddScreen(null);
    // Другое место — другая память: прежняя к нему не относится.
    this.memLive = false;
    // И другие предметы: все на месте.
    this.objData.fill(0);
    this.objTex.needsUpdate = true;
    this.setErase(0, 0, 0);
    this.stairs = stairs;
    for (const m of this.chunks) this.dropMesh(m);
    this.chunks.length = 0;
    this.hiddenIds.clear();
    for (const key of [...this.bursts.keys()]) this.dropBurst(key);
    this.chunkData = chunks.map((c) => c.mesh);
    this.chunkTris = chunks.map(() => null);
    this.laceDirty.clear();
    for (const chunk of chunks) {
      const mesh = this.makeMesh(chunk.mesh, chunk.tierMin, chunk.tierMax);
      if (chunk.id) mesh.userData.id = chunk.id;
      if (chunk.id && chunk.hidden) this.hiddenIds.add(chunk.id);
      this.chunks.push(mesh);
      this.scene.add(mesh);
      this.clouds.add(mesh, chunk.mesh);
      if (chunk.slides) {
        // Проекции куска — его дочерняя сетка: видна вместе с ним. Слой 1: тени не отбрасывает; точек
        // на ней нет — она не вещество, а свет.
        const slide = this.makeMesh(chunk.slides, chunk.tierMin, chunk.tierMax);
        slide.material = this.slideMat;
        slide.layers.set(1);
        mesh.add(slide);
        mesh.userData.slide = slide;
      }
    }
  }

  private makeMesh(data: MeshData, tierMin: number, tierMax: number): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(data.color, 4));
    g.setAttribute('aMat', new THREE.BufferAttribute(data.mat, 1));
    // Номер объекта у вершины: по нему шейдер растворяет отдельный предмет в общей сетке помещения.
    // Необязательный канал, длина которого не сходится с числом вершин, лучше не ставить вовсе: Safari
    // такую сетку не рисует целиком (проверяет, хватает ли данных на каждую вершину), а без канала шейдер
    // читает ноль — помещение остаётся на месте, только без ветра или без растворения своих предметов.
    const n = data.position.length / 3;
    const fits = (a: ArrayLike<number> | undefined, name: string): boolean => {
      if (!a) return false;
      if (a.length === n) return true;
      console.error(`[render] ${name}: ${a.length} значений на ${n} вершин — канал пропущен`);
      return false;
    };
    if (fits(data.obj, 'aObj')) g.setAttribute('aObj', new THREE.BufferAttribute(data.obj!, 1));
    if (fits(data.sway, 'aSway')) g.setAttribute('aSway', new THREE.BufferAttribute(data.sway!, 1));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.worldMat);
    mesh.matrixAutoUpdate = false;
    mesh.userData.tierMin = tierMin;
    mesh.userData.tierMax = tierMax;
    return mesh;
  }

  /** Убрать сетку из сцены вместе с её красной сеткой. */
  private dropMesh(m: THREE.Mesh): void {
    this.clouds.remove(m);
    const w = m.userData.wire as THREE.LineSegments | undefined;
    if (w) w.geometry.dispose();
    (m.userData.laceEdges as THREE.LineSegments | undefined)?.geometry.dispose();
    (m.userData.slide as THREE.Mesh | undefined)?.geometry.dispose();
    this.scene.remove(m);
    m.geometry.dispose();
  }

  /** Линии рёбер сетки: строятся при первом показе и остаются при ней. */
  private wireFor(m: THREE.Mesh, mat: THREE.ShaderMaterial): THREE.LineSegments {
    const have = m.userData.wire as THREE.LineSegments | undefined;
    if (have) return have;
    const g = new THREE.BufferGeometry();
    const pos = m.geometry.getAttribute('position');
    g.setAttribute('position', pos);
    const obj = m.geometry.getAttribute('aObj');
    if (obj) g.setAttribute('aObj', obj);
    g.setIndex(new THREE.BufferAttribute(edgeIndex(m.geometry.getIndex()!.array, pos.array as ArrayLike<number>, pos.count), 1));
    g.boundingSphere = m.geometry.boundingSphere;
    const lines = new THREE.LineSegments(g, mat);
    // Слой 1: в проход тени линии не попадают.
    lines.layers.set(1);
    lines.frustumCulled = false;
    m.add(lines);
    m.userData.wire = lines;
    return lines;
  }

  /**
   * Показать карманное пространство (null — убрать). Убежище при этом остаётся в сцене, но оно далеко.
   * Точки здесь вшестеро реже, чем в убежище: рядом поверхность и так видна. Сеются они клетками вокруг
   * игрока, поэтому огромный пол белого нигде (88 × 88 м) целиком не засевается.
   */
  /** Тихий слой уровня: точки по рёбрам и углам стен. null — убрать (карман, тестовый уровень). */
  setEdges(edges: EdgePoints | null): void {
    if (this.edgePoints) {
      this.edgeScene.remove(this.edgePoints);
      this.edgePoints.geometry.dispose();
      this.edgePoints = null;
    }
    if (!edges || edges.count === 0) return;
    if (!this.edgeMat) {
      this.edgeMat = new THREE.ShaderMaterial({
        vertexShader: EDGE_VERT,
        fragmentShader: EDGE_FRAG,
        uniforms: {
          ...this.pieceU,
          tDepth: { value: null },
          uNearFar: this.splatMat.uniforms.uNearFar!,
          uProj: this.splatMat.uniforms.uProj!,
          uTiers: { value: new THREE.Vector2(0, 0) },
          uSonar: { value: new THREE.Vector4(0, 0, 0, -100) },
          uSonarK: { value: 0 },
          uQuiet: { value: 0 },
          uGainInv: { value: 1 },
          uXray: { value: 0.6 },
          // Стирание места и высота яруса — те же объекты, что у мира: точки видны там, где стена уже стёрта.
          uErase: this.worldMat.uniforms.uErase!,
          uTierDrop: this.worldMat.uniforms.uTierDrop!,
        },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(edges.pos, 3));
    geo.setAttribute('aTier', new THREE.BufferAttribute(Float32Array.from(edges.tier), 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(Float32Array.from(edges.kind), 1));
    const points = new THREE.Points(geo, this.edgeMat);
    points.frustumCulled = false;
    points.matrixAutoUpdate = false;
    this.edgePoints = points;
    this.edgeScene.add(points);
  }

  setPocket(meshes: readonly MeshData[] | null): void {
    // Другое место — другая память: прежняя к нему не относится.
    this.memLive = false;
    for (const m of this.pocket) this.dropMesh(m);
    this.pocket.length = 0;
    for (const data of meshes ?? []) {
      const mesh = this.makeMesh(data, 0, 0);
      this.pocket.push(mesh);
      this.scene.add(mesh);
      this.clouds.add(mesh, data, { thin: 6 });
    }
  }

  /**
   * Ещё один материал мира: те же шейдеры и те же uniform-объекты (словарь свой — в нём можно подменить
   * отдельный uniform). Не clone(): тот копирует каждую фактуру и вектор, а на фактурах целей отрисовки
   * (uSpot) three.js пишет предупреждение в консоль — на каждый материал.
   */
  private worldLike(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG, uniforms: { ...this.worldMat.uniforms } });
  }

  /**
   * Добавить вещь: геометрия вокруг начала координат. Возвращает номер для setThing и removeThing.
   * look — из чего она: из вещества (как всё), из света (проекция: светится сама, свет её смывает; тени
   * и точек у неё нет) или из нитей (кружево: поверхности нет, одни рёбра).
   */
  addThing(data: MeshData, seed = 0, look: ThingLook = 'matter', maps: ThingMaps | null = null): number {
    // Всё общее — теми же uniform-объектами, что у мира: свет, туман, фактуры обновляются разом.
    const mat = this.worldLike();
    // y — вещь из кружева: поверхности нет, одни нити (тот же узор, что у стёртых стен); z — это вещь, а не архитектура.
    mat.uniforms.uThing = { value: new THREE.Vector4(0, look === 'lace' ? 1 : 0, 1, (seed % 97) * 1.37) };
    mat.uniforms.uDots = { value: 0 };
    mat.defines = look === 'light' ? { ...this.slideMat.defines } : { ...this.worldMat.defines };
    // Подробная вещь памяти: цвет, рельеф, шероховатость и металл — из её карт (партнёр 24.11: «материал лучше»).
    const hq = maps !== null && look === 'matter';
    if (hq) {
      mat.defines.THING_TEX = '';
      mat.uniforms.uThingC = { value: this.thingMap(maps.color, true) };
      mat.uniforms.uThingN = { value: this.thingMap(maps.normal, false) };
    }
    const mesh = this.makeMesh(data, 0, 0);
    mesh.material = mat;
    mesh.matrixAutoUpdate = true;
    mesh.visible = false;
    if (look !== 'matter') mesh.layers.set(1);
    this.scene.add(mesh);
    if (look !== 'light') this.clouds.add(mesh, data, { follow: true });
    // Кружевная вещь — ещё и нити по своим рёбрам: силуэт и изломы читаются, а не тонут в ровной сетке.
    let edgeMat: THREE.ShaderMaterial | null = null;
    if (look === 'lace') {
      edgeMat = this.worldLike();
      edgeMat.uniforms.uThing = mat.uniforms.uThing!;
      edgeMat.uniforms.uDots = mat.uniforms.uDots!;
      edgeMat.defines = { ...this.worldMat.defines, LACE_EDGE: '' };
      const idx = new THREE.BufferAttribute(edgeIndex(data.index, data.position, data.position.length / 3), 1);
      const lines = this.edgeLines(mesh.geometry, idx, edgeMat);
      mesh.add(lines);
      mesh.userData.laceEdges = lines;
    }
    const id = this.nextThing++;
    this.things.set(id, { mesh, mat, wire: null, wireMat: null, radius: mesh.geometry.boundingSphere?.radius ?? 0.5, data, seed, look, dis: 0, edgeMat, maps: hq });
    return id;
  }

  /**
   * Карта подробной вещи: одна на адрес, живёт до конца игры (видов вещей памяти — шестнадцать). Развёртка — как в glTF
   * (начало вверху слева), поэтому картинка не переворачивается; у карты цвета — sRGB, у карты нормалей — числа как есть.
   */
  private thingMap(url: string, srgb: boolean): THREE.Texture {
    let tex = this.thingMaps.get(url);
    if (!tex) {
      tex = new THREE.TextureLoader().load(url);
      tex.flipY = false;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.thingMaps.set(url, tex);
    }
    return tex;
  }

  setThing(id: number, v: ThingView): void {
    const t = this.things.get(id);
    if (!t) return;
    t.mesh.visible = v.visible;
    if (!v.visible) {
      // Спрятанная вещь пыли не оставляет: облако, которое уже гаснет, догорает само. Игра прячет вещь, когда та растворилась
      // (часть фигуры — на 0,999, вещь — в состоянии «нет»), и последнего «распад — 1» облако бы не услышало: ждало бы его и
      // висело в воздухе до смены места (смоук, 20.11, вечер: 14 облаков «Фигуры 4» через 3 с после распада). Поэтому здесь
      // облако дорастворяется само, а собиравшееся — снимается: собирать уже нечего.
      const b = this.bursts.get(`t${id}`);
      if (b) {
        if (b.life.coming) this.dropBurst(`t${id}`);
        else steerGrains(b.life, 1);
      }
      t.dis = v.dissolve;
      return;
    }
    t.mesh.position.set(v.x, v.y, v.z);
    t.mesh.rotation.set(0, v.yaw, 0);
    t.mesh.scale.setScalar(v.scale);
    (t.mat.uniforms.uThing!.value as THREE.Vector4).x = v.dissolve;
    const dots = v.dots ?? 0;
    t.mat.uniforms.uDots!.value = dots;
    this.clouds.setSparse(t.mesh, dots);
    // Выросшая вещь из точек: поверхность редеет точками (uDots), сквозь промежутки видно, что за ней.
    // Поверхность не выключается целиком: облако точек берёт глубину и цвет из неё, и без неё гаснет тоже.
    // Рассыпающаяся вещь и вещь из точек тени не отбрасывают; свет и кружево — никогда.
    if (t.look === 'matter') t.mesh.layers.set(v.dissolve > 0.4 || (v.dots ?? 0) > 0.5 ? 1 : 0);
    if (Math.abs(v.dissolve - t.dis) > 1e-4) {
      this.grainsFor(`t${id}`, t.dis, v.dissolve, () => {
        t.mesh.updateMatrix();
        // Посев идёт по сетке без масштаба: у выросшей вещи площадь в scale² раз больше, и пыли ей нужно
        // больше, иначе огромная вещь рассыпается редкими точками. Потолок — чтобы телефон не захлебнулся.
        const big = v.scale > 1.01;
        const grains = sowGrains(t.data, null, t.seed * 31 + 7, this.grainDensity * (big ? v.scale * v.scale : 1), big ? GIANT_GRAINS : Infinity);
        // Кружево осыпается своим цветом — цветом нитей.
        if (t.look === 'lace') threadDust(grains);
        return { grains, matrix: t.mesh.matrix };
      });
      t.dis = v.dissolve;
    }
    if (v.wire > 0.01) {
      if (!t.wire) {
        t.wireMat = this.wireMat.clone();
        t.wireMat.uniforms.uDissolve = this.worldMat.uniforms.uDissolve!;
        t.wireMat.uniforms.uThing = t.mat.uniforms.uThing!;
        t.wireMat.uniforms.uTime = this.wireMat.uniforms.uTime!;
        t.wireMat.uniforms.uObjState = this.wireMat.uniforms.uObjState!;
        t.wire = this.wireFor(t.mesh, t.wireMat);
      }
      t.wire.visible = true;
      t.wireMat!.uniforms.uWireAlpha!.value = v.wire;
      t.wireMat!.depthTest = !v.xray;
    } else if (t.wire) t.wire.visible = false;
  }

  removeThing(id: number): void {
    const t = this.things.get(id);
    if (!t) return;
    // Россыпь, которая уже лежит, остаётся догорать; недолетевшая пыль уходит вместе с вещью.
    const b = this.bursts.get(`t${id}`);
    if (b && (b.life.coming || b.life.go < 1)) this.dropBurst(`t${id}`);
    this.dropMesh(t.mesh);
    t.mat.dispose();
    t.edgeMat?.dispose();
    t.wireMat?.dispose();
    this.things.delete(id);
  }

  clearThings(): void {
    for (const id of [...this.things.keys()]) this.removeThing(id);
    for (const key of [...this.bursts.keys()]) if (key.startsWith('t')) this.dropBurst(key);
  }

  /**
   * Передать Осыпи (рою) позиции на кадр. heads, dirs, params — массивы тела; alpha — плотность
   * (0 — её нет). Сколько прядей и точек в пряди рисовать, решает качество. through — видна сквозь стены красным
   * контуром, как призрак, но на своём месте (тёмный урок первого сна).
   */
  setSwarm(heads: Float32Array, dirs: Float32Array, params: Float32Array, alpha: number, time: number, through = false): void {
    const on = alpha > 0.01;
    this.swarmPoints.visible = on;
    this.swarmMat.uniforms.uAlpha!.value = on ? alpha : 0;
    (this.swarmMat.uniforms.uGhost!.value as THREE.Vector4).w = through ? 2 : 0;
    if (!on) return;
    // Середина тела: вокруг неё место темнеет или выгорает (WORLD_FRAG, voidTouch).
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const nh = heads.length / 3;
    for (let i = 0; i < nh; i++) {
      cx += heads[i * 3]!;
      cy += heads[i * 3 + 1]!;
      cz += heads[i * 3 + 2]!;
    }
    this.swarmCenter.set(cx / Math.max(1, nh), cy / Math.max(1, nh), cz / Math.max(1, nh));
    (this.swarmHead.array as Float32Array).set(heads);
    (this.swarmDir.array as Float32Array).set(dirs);
    (this.swarmParam.array as Float32Array).set(params);
    this.swarmHead.needsUpdate = true;
    this.swarmDir.needsUpdate = true;
    this.swarmParam.needsUpdate = true;
    const q = QUALITY[this.quality];
    this.swarmGeo.instanceCount = Math.min(MAX_WORMS, q.worms);
    this.swarmGeo.setDrawRange(0, Math.min(STRAND_MAX, Math.round(q.strand * this.fine * this.fine)));
    this.swarmMat.uniforms.uTime!.value = time;
  }

  /** Атлас надписей и плакатов, нарисованный на canvas (render/signs_atlas.ts). */
  setSigns(canvas: HTMLCanvasElement): void {
    this.signsTex.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.signsTex = tex;
    this.worldMat.uniforms.uSigns!.value = tex;
  }

  /** Атлас картинок выставочных экранов, нарисованный на canvas (render/screen_images.ts). */
  setScreens(canvas: HTMLCanvasElement): void {
    this.screensTex.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    // Прислонённый экран виден под углом: без анизотропии картинка на нём мылится.
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.screensTex = tex;
    this.worldMat.uniforms.uScreens!.value = tex;
  }

  /** Листы бумаги: стопка слоёв (render/paper_images.ts, drawPapers). */
  setPapers(stack: { data: Uint8Array; width: number; height: number; depth: number }): void {
    this.papersTex.dispose();
    const tex = new THREE.DataArrayTexture(stack.data, stack.width, stack.height, stack.depth);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    // Лист на стене виден вскользь, когда идёшь вдоль неё: без анизотропии лица на нём мылятся.
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.papersTex = tex;
    this.worldMat.uniforms.uPapers!.value = tex;
  }

  /** Показать или скрыть именованный чанк (обвал обрушился, комната сменила вариант). */
  setChunkVisible(id: string, on: boolean): void {
    if (on) this.hiddenIds.delete(id);
    else this.hiddenIds.add(id);
  }

  /** Пузырь вокруг искомой вещи: центр, радиус, сила 0…1 и время (переливы); null — нет пузыря. */
  /**
   * Экран кинескопа странной комнаты: собрать выпуклое стекло по месту и завести кольцо кадров; null — убрать и отдать память.
   * Сетка экрана — 10 × 8 клеток, стекло выгнуто к зрителю на spec.bulge в середине.
   */
  private setOddScreen(spec: OddScreen | null): void {
    if (spec === this.tvSpec) return;
    this.tvSpec = spec;
    if (this.tvScreen) {
      this.scene.remove(this.tvScreen);
      this.tvScreen.geometry.dispose();
      this.tvScreen = null;
    }
    for (const rt of this.tvRing) rt.dispose();
    this.tvRing = [];
    this.tvHead = 0;
    this.tvFilled = 0;
    this.tvLast = -Infinity;
    if (!spec) return;
    const nx = 10;
    const ny = 8;
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx - 0.5;
        const w = j / ny - 0.5;
        const bulge = spec.bulge * (1 - (2 * u) ** 2) * (1 - (2 * w) ** 2);
        for (let k = 0; k < 3; k++) pos.push(spec.at[k]! + spec.u[k]! * u * spec.w + spec.v[k]! * w * spec.h + spec.n[k]! * bulge);
        uvs.push(i / nx, j / ny);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(idx);
    this.tvScreen = new THREE.Mesh(g, this.tvMat);
    this.tvScreen.frustumCulled = false;
    this.tvScreen.layers.set(1);
    this.scene.add(this.tvScreen);
    for (let i = 0; i < TV_RING.frames; i++) {
      const rt = new THREE.WebGLRenderTarget(TV_RING.w, TV_RING.h, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      this.tvRing.push(rt);
    }
  }

  setBubble(v: { pos: readonly [number, number, number]; radius: number; k: number; time: number } | null): void {
    this.bubble.visible = v !== null && v.k > 0.01;
    if (!v) return;
    this.bubble.position.set(v.pos[0], v.pos[1], v.pos[2]);
    this.bubble.scale.setScalar(v.radius);
    this.bubble.updateMatrixWorld();
    this.bubbleMat.uniforms.uK!.value = v.k;
    this.bubbleMat.uniforms.uT!.value = v.time;
  }

  /**
   * Свет памяти у искомой вещи (world/memory_light.ts): где она стоит и куда смотрит, род света, цвет,
   * сила (0 — погас), высота источника над вещью и докуда он светит. null — света нет.
   */
  setMemLight(v: { pos: readonly [number, number, number]; yaw: number; kind: number; color: readonly [number, number, number]; strength: number; height: number; radius: number } | null): void {
    const u = this.worldMat.uniforms;
    const pos = u.uRecallPos!.value as THREE.Vector4;
    if (!v || v.strength <= 0) {
      pos.w = 0;
      return;
    }
    pos.set(v.pos[0], v.pos[1], v.pos[2], v.strength);
    (u.uRecallColor!.value as THREE.Vector4).set(v.color[0], v.color[1], v.color[2], v.kind);
    // Вещь смотрит вдоль своей оси +z, повёрнутой на yaw (как стоит сетка вещи в setThing).
    (u.uRecallDir!.value as THREE.Vector4).set(Math.sin(v.yaw), v.height, Math.cos(v.yaw), v.radius);
  }

  /**
   * Натриевые лампы оранжереи в шейдер мира: не больше LAMP.max, ближние к камере первыми (их в оранжерее от двух до девяти). На
   * низком качестве их света нет: трубки светятся, пол под ними тёмный — как было до 25.11.
   */
  private setLamps(l: FrameView['lamps'], cam: Vec3): void {
    const u = this.worldMat.uniforms;
    const y = u.uLampY!.value as THREE.Vector4;
    if (!l || l.pos.length === 0 || this.quality === 'low' || this.debugLampsOff) {
      y.w = 0;
      return;
    }
    const d2 = (p: Vec3): number => (p[0] - cam[0]) ** 2 + (p[1] - cam[1]) ** 2 + (p[2] - cam[2]) ** 2;
    const near = this.lampOrder;
    near.length = 0;
    for (const p of l.pos) near.push(p);
    if (near.length > LAMP.max) near.sort((a, b) => d2(a) - d2(b));
    const n = Math.min(LAMP.max, near.length);
    const arr = u.uLamp!.value as THREE.Vector4[];
    for (let i = 0; i < n; i++) arr[i]!.set(near[i]![0], near[i]![1], near[i]![2], 1);
    (u.uLampBox!.value as THREE.Vector4).set(l.box[0], l.box[1], l.box[2], l.box[3]);
    y.set(l.y[0], l.y[1], LAMP.radius, n);
  }

  /** Сила света ламп оранжереи (отладка: подбор на глаз; по умолчанию LAMP.gain). */
  setLampGain(k: number): void {
    this.lampGain = k;
    this.lampColor();
  }

  /**
   * Цвет света ламп: тон натрия × сила × яркость свечения. Трубки — светящийся материал: гаснут, когда гаснут фосфорные надписи
   * (охотится Осыпь), — гаснет и их свет; во вспышку он ярче, но не больше чем вдвое.
   */
  private lampColor(): void {
    (this.worldMat.uniforms.uLampColor!.value as THREE.Vector3).fromArray(SODIUM_GLOW).multiplyScalar(this.lampGain * Math.min(this.lampGlow, 2));
  }

  /** Яркость фосфорных надписей: 1 — обычная, 0 — погасли, больше — вспышка. */
  setGlow(k: number): void {
    this.lampGlow = k;
    this.lampColor();
    this.worldMat.uniforms.uMatGlow!.value = k;
  }

  /** Точка мира на экране: x, y в долях кадра (0..1, y вниз); visible — перед камерой и в кадре. */
  project(p: readonly [number, number, number]): { x: number; y: number; visible: boolean; d: number } {
    const d = this.camera.position.distanceTo(this.tmpV.set(p[0], p[1], p[2]));
    const v = this.tmpV.project(this.camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, d };
  }

  /** Заранее собрать шейдеры, чтобы первый кадр не подвисал. */
  async warmup(): Promise<void> {
    this.renderer.setRenderTarget(this.sceneRT);
    await this.renderer.compileAsync(this.scene, this.camera);
    // Осыпь появляется посреди игры: её шейдер собирается заранее, чтобы первый её кадр не подвисал.
    const shown = this.swarmPoints.visible;
    this.swarmPoints.visible = true;
    this.ghostPoints.visible = true;
    await this.renderer.compileAsync(this.swarmScene, this.camera);
    this.swarmPoints.visible = shown;
    this.ghostPoints.visible = false;
    await this.renderer.compileAsync(this.echoScene, this.postCam);
    this.renderer.setRenderTarget(null);
    await this.renderer.compileAsync(this.postScene, this.postCam);
    if (this.hazeRT) await this.renderer.compileAsync(this.hazeScene, this.postCam);
  }

  render(v: FrameView): void {
    const r = this.renderer;
    r.info.reset();

    // Луч фонаря: кривая ощущений сужает его к концу сессии и раскрывает на выдохе (systems/feel.ts).
    const bc = v.beamCone ?? 1;
    if (bc !== this.beamConeNow) {
      this.beamConeNow = bc;
      (this.lightU.uCone!.value as THREE.Vector4).set(deg(7 * bc), deg(13 * bc), deg(25 * bc), deg(Math.min(80, 52 * bc)));
    }

    const cam = this.camera;
    cam.position.set(v.camPos[0], v.camPos[1], v.camPos[2]);
    cam.rotation.set(v.camPitch, v.camYaw, v.camRoll);
    // Перекрут белой комнаты: мир становится широкоугольным — обзор шире, и всё, что считается от обзора, — вслед за ним.
    const fovWant = Math.min(140, this.baseFov * (v.fov ?? 1));
    if (Math.abs(cam.fov - fovWant) > 1e-3) {
      cam.fov = fovWant;
      cam.updateProjectionMatrix();
      const tanY = Math.tan((fovWant * Math.PI) / 360);
      this.hazeMat.uniforms.uTan!.value.set(tanY * cam.aspect, tanY);
      const h = (this.splatMat.uniforms.uProj!.value as number) * 2 * Math.tan((this.lastFov * Math.PI) / 360);
      this.splatMat.uniforms.uProj!.value = h / (2 * tanY);
      this.lastFov = fovWant;
    }
    cam.updateMatrixWorld(true);
    const wb = this.worldMat.uniforms.uWhiteBox!.value as THREE.Vector4;
    const wy = this.worldMat.uniforms.uWhiteY!.value as THREE.Vector4;
    if (v.white) {
      wb.set(v.white.box[0], v.white.box[1], v.white.box[2], v.white.box[3]);
      wy.set(v.white.y[0], v.white.y[1], 1, 0);
    } else wy.z = 0;
    this.setLamps(v.lamps ?? null, v.camPos);
    // Странная комната: облик и свет по коробке (шейдер мира), сдвиг стен (мир и точки), пух (пыль), экран кинескопа.
    {
      const wu0 = this.worldMat.uniforms;
      const oy = wu0.uOddY!.value as THREE.Vector4;
      const fy = this.dustMat.uniforms.uFluffY!.value as THREE.Vector4;
      const o = v.odd ?? null;
      if (o) {
        (wu0.uOddBox!.value as THREE.Vector4).set(o.box[0], o.box[1], o.box[2], o.box[3]);
        oy.set(o.y[0], o.y[1], ODD_SHADER_KIND[o.kind], v.time);
        (wu0.uOddFx!.value as THREE.Vector4).set(o.hero[0], o.hero[1], o.squeeze, o.rise);
        const at = o.screen ? o.screen.at : o.at;
        (wu0.uOddAt!.value as THREE.Vector4).set(at[0], at[1], at[2], 0);
        (wu0.uOddFace!.value as THREE.Vector4).set(o.face[0], o.face[1], 0, 0);
        if (o.kind === 'balloon') {
          (this.dustMat.uniforms.uFluffBox!.value as THREE.Vector4).set(o.box[0], o.box[1], o.box[2], o.box[3]);
          fy.set(o.y[0], o.y[1] + o.rise, 1, o.k);
        } else fy.z = 0;
      } else {
        oy.z = 0;
        (wu0.uOddFx!.value as THREE.Vector4).set(0, 0, 0, 0);
        fy.z = 0;
      }
      // Кинескоп и его кольцо кадров живут, пока жив уровень (ревью 25.11: уход в карман или лимбо пересоздавал 60 буферов):
      // вне главного места экран прячется, а снимается — со сменой уровня (setWorld).
      if (o?.screen) this.setOddScreen(o.screen);
      if (this.tvScreen) this.tvScreen.visible = !!o?.screen;
      if (this.tvScreen) {
        const tu0 = this.tvMat.uniforms;
        tu0.uTime!.value = v.time;
        tu0.uQuiet!.value = o?.quiet ? 1 : 0;
        // Самая старая копия кольца — та, что сейчас будет перезаписана: две секунды назад.
        tu0.tPast!.value = this.tvRing[this.tvHead]?.texture ?? null;
        tu0.uHas!.value = this.tvFilled >= TV_RING.frames ? 1 : 0;
      }
    }

    // Отсечение чанков: дальше черты видимости всё равно чёрный туман, а чужой ярус виден только
    // с лестницы и от её площадок.
    const tf = -(v.camPos[1] - 1.42) / this.tierDrop;
    const base = Math.round(tf);
    let lo = base;
    let hi = base;
    if (tf - base > 0.12) hi = base + 1;
    else if (base - tf > 0.12) lo = base - 1;
    const near = (p: readonly [number, number, number]): boolean => (p[0] - v.camPos[0]) ** 2 + (p[2] - v.camPos[2]) ** 2 < 16 * 16;
    for (const s of this.stairs) {
      if (s.upperTier === base && near(s.top)) hi = Math.max(hi, base + 1);
      if (s.upperTier + 1 === base && near(s.bottom)) lo = Math.min(lo, base - 1);
    }
    // Грибы, цветы и трава чужого яруса тоже не рисуются (смоук CI, 20.11: у люка рисовались плитки травы и грозди грибов, которых
    // отсюда не видно, — лишние вызовы). Полоса высот — от пола нижнего видимого яруса с запасом вниз (рельсы, ямы) до потолка
    // верхнего, не доставая пола яруса над ним. В месте в один ярус (без лестниц: вокзал, жёлтые, карман) — без отсечения: там и
    // своды выше полосы (зал вокзала — 6,3 м).
    const tiers = this.stairs.length > 0;
    this.tierBand[0] = tiers ? -hi * this.tierDrop - 2.5 : -Infinity;
    this.tierBand[1] = tiers ? -lo * this.tierDrop + 4.4 : Infinity;
    this.layoutSpores();
    this.layoutFlowers();
    this.layoutGrass();
    // Нити по рёбрам кружевных предметов: перестраиваются там, где сменился состав (раз на уровень).
    for (const c of this.laceDirty) this.buildLaceEdges(c);
    this.laceDirty.clear();
    for (const m of this.chunks) {
      const sphere = m.geometry.boundingSphere;
      const far = sphere ? cam.position.distanceTo(sphere.center) - sphere.radius > this.cullDistance : false;
      const hidden = m.userData.id !== undefined && this.hiddenIds.has(m.userData.id as string);
      m.visible = !far && !hidden && (m.userData.tierMax as number) >= lo && (m.userData.tierMin as number) <= hi;
      const slide = m.userData.slide as THREE.Mesh | undefined;
      if (slide) slide.visible = !this.debugSlidesOff;
    }
    // Вещи и фигуры чужого яруса — как его чанки: не рисуются (смоук CI, 20.11: «Фигура 4» партнёра ярусом ниже рисовалась от
    // самого люка — 14 частей в кадр и в тень, 129 вызовов вместо 101). Видимость вещей игра ставит каждый кадр (setThing), здесь
    // она только гасится. Кроме вещи с сеткой: искомое в темноте видно сквозь стены — и сквозь пол, это подсказка, куда идти.
    for (const t of this.things.values()) {
      if (!t.mesh.visible || t.wire?.visible) continue;
      const y = t.mesh.position.y;
      if (y < this.tierBand[0] || y > this.tierBand[1]) t.mesh.visible = false;
    }
    for (const m of this.pocket) m.visible = true;

    // Красная сетка на всём видимом. Линии строятся по мере надобности: то, что рядом с камерой, — сразу
    // (иначе первый кадр в «сеточной» комнате пуст), дальнее — не больше трёх сеток за кадр.
    this.wireMat.uniforms.uWireAlpha!.value = v.wire;
    this.wireMat.uniforms.uTime!.value = v.time;
    let built = 0;
    for (const m of [...this.chunks, ...this.pocket]) {
      const w = m.userData.wire as THREE.LineSegments | undefined;
      if (v.wire > 0.01 && m.visible) {
        if (w) w.visible = true;
        else {
          const sphere = m.geometry.boundingSphere;
          const near = sphere ? cam.position.distanceTo(sphere.center) - sphere.radius < 7 : true;
          if (near || built < 3) {
            this.wireFor(m, this.wireMat).visible = true;
            if (!near) built += 1;
          }
        }
      } else if (w) w.visible = false;
    }

    // Окружение пространства.
    const wuEnv = this.worldMat.uniforms;
    // Свет по клеткам: где он есть, рассеянный свет в шейдере умножается на свет клетки.
    const grid = wuEnv.uCellGrid!.value as THREE.Vector4;
    if (v.cells && v.cells.size === CELL_TEX) {
      (this.cellTex.image.data as Uint8Array).set(v.cells.data);
      this.cellTex.needsUpdate = true;
      grid.set(v.cells.origin[0], v.cells.origin[1], v.cells.step, v.cells.size);
    } else grid.w = 0;
    (wuEnv.uAmbient!.value as THREE.Vector3).set(v.ambient[0], v.ambient[1], v.ambient[2]);
    (wuEnv.uFogColor!.value as THREE.Vector3).set(v.fogColor[0], v.fogColor[1], v.fogColor[2]);
    (wuEnv.uKeyDirV!.value as THREE.Vector3).set(v.keyDir[0], v.keyDir[1], v.keyDir[2]).transformDirection(cam.matrixWorldInverse);
    (wuEnv.uKeyColor!.value as THREE.Vector3).set(v.keyColor[0], v.keyColor[1], v.keyColor[2]);
    wuEnv.uFog!.value = v.fogDensity;
    wuEnv.uDissolve!.value = v.dissolve;
    const bt = v.burnTint ?? [0.9, 0.07, 0.03];
    (wuEnv.uBurnTint!.value as THREE.Vector3).set(bt[0], bt[1], bt[2]);
    this.dustMat.uniforms.uBoost!.value = v.dissolve;
    this.dustMat.uniforms.uPollen!.value = v.pollen ?? 0;
    this.clearColor.setRGB(v.fogColor[0], v.fogColor[1], v.fogColor[2]);

    // Фонарь в пространстве камеры.
    const lu = this.lightU;
    (lu.uLightPosV!.value as THREE.Vector3).set(v.lightPos[0], v.lightPos[1], v.lightPos[2]).applyMatrix4(cam.matrixWorldInverse);
    (lu.uLightDirV!.value as THREE.Vector3).set(v.lightDir[0], v.lightDir[1], v.lightDir[2]).transformDirection(cam.matrixWorldInverse);
    // Поверхности в грязи и рельефе отражают меньше, чем ровная краска: фонарь взят с запасом.
    // Лампа фонаря чуть дышит: контакт неидеален, даже когда фонарь «горит ровно».
    const breathe = 1 + 0.018 * Math.sin(v.time * 31.0) + 0.012 * Math.sin(v.time * 7.3 + 1.7);
    const k = 3.3 * v.lightIntensity * v.lightScale * breathe;
    const w = v.lightWarmth;
    (lu.uLightColor!.value as THREE.Vector3).set(k, k * (0.94 - 0.2 * w), k * (0.82 - 0.4 * w));
    // Оси пятна фонаря: по ним ложатся разводы отражателя.
    const wu = this.worldMat.uniforms;
    const right = (wu.uLightRightV!.value as THREE.Vector3).set(-v.lightDir[2], 0, v.lightDir[0]);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const upL = (wu.uLightUpV!.value as THREE.Vector3).set(v.lightDir[0], v.lightDir[1], v.lightDir[2]).cross(right).negate().normalize();
    right.transformDirection(cam.matrixWorldInverse);
    upL.transformDirection(cam.matrixWorldInverse);
    wu.uDecay!.value = v.decay;
    wu.uPlain!.value = v.plain ? 1 : 0;
    (wu.uSlide!.value as THREE.Vector4).w = v.time;
    wu.uTierDrop!.value = this.tierDrop;
    wu.uScanFade!.value = v.scanFade;
    wu.uDebugView!.value = this.debugView;
    (wu.uScanRange!.value as THREE.Vector2).set(v.scanRange[0], v.scanRange[1]);
    wu.uKeyCells!.value = v.keyCells ?? 0;
    wu.uGaze!.value = v.gaze ?? 1;
    const gc = v.gazeCone ?? [52, 25];
    (wu.uGazeCone!.value as THREE.Vector2).set(Math.cos((gc[0] * Math.PI) / 180), Math.cos((gc[1] * Math.PI) / 180));
    wu.uGazeTall!.value = gazeTall(this.camera.aspect);
    this.lightU.uBeamTall!.value = gazeTall(this.camera.aspect);
    this.lightU.uRings!.value = v.rings ?? RINGS_DEFAULT;
    const wind = v.wind;
    if (wind) (wu.uWind!.value as THREE.Vector4).set(wind.t, wind.amp, wind.dir[0], wind.dir[1]);
    else (wu.uWind!.value as THREE.Vector4).y = 0;
    const push = v.push ?? null;
    if (push) (wu.uPush!.value as THREE.Vector4).set(push.at[0], push.at[1], push.at[2], push.radius);
    else (wu.uPush!.value as THREE.Vector4).w = 0;
    const roof = v.roof ?? null;
    if (roof) (wu.uRoofBox!.value as THREE.Vector4).set(roof.box[0], roof.box[1], roof.box[2], roof.box[3]);
    // Стекло лежит на переплёте: лист во всю крышу чуть выше балок.
    this.glass.visible = roof !== null;
    if (roof) {
      this.glass.position.set((roof.box[0] + roof.box[2]) / 2, roof.y + 0.16, (roof.box[1] + roof.box[3]) / 2);
      this.glass.scale.set(roof.box[2] - roof.box[0] + 0.3, 1, roof.box[3] - roof.box[1] + 0.3);
      this.glass.updateMatrixWorld();
      const gu = this.glassMat.uniforms;
      (gu.uSky!.value as THREE.Vector3).set(v.fogColor[0], v.fogColor[1], v.fogColor[2]);
      (gu.uSunDirW!.value as THREE.Vector3).set(v.keyDir[0], v.keyDir[1], v.keyDir[2]).normalize();
      (gu.uSunColor!.value as THREE.Vector3).set(v.keyColor[0], v.keyColor[1], v.keyColor[2]);
    }
    wu.uRoofY!.value = roof ? roof.y : 0;
    (wu.uKeyDirW!.value as THREE.Vector3).set(v.keyDir[0], v.keyDir[1], v.keyDir[2]).normalize();
    wu.uCaustic!.value = v.caustic ?? 0;
    // Осыпь и место вокруг неё. Между светом и темнотой (пока она переворачивается) ореола нет.
    const polar = v.polar ?? 0;
    const here = this.swarmPoints.visible ? (this.swarmMat.uniforms.uAlpha!.value as number) : 0;
    this.swarmMat.uniforms.uPolar!.value = polar;
    const vp = this.tmpV.copy(this.swarmCenter).applyMatrix4(cam.matrixWorldInverse);
    (wu.uVoid!.value as THREE.Vector4).set(vp.x, vp.y, vp.z, here > 0.02 ? 3.4 : 0);
    const asDark = Math.max(0, polar * 2 - 1);
    const asLight = Math.max(0, 1 - polar * 2);
    (wu.uVoidK!.value as THREE.Vector2).set(asDark > 0 ? asDark * here : -(asLight * here * 1.3) / Math.sqrt(Math.max(1, v.gain)), here * Math.max(asDark, asLight));
    (wu.uContactGrid!.value as THREE.Vector3).set(this.contactOrigin[0], this.contactOrigin[1], v.contact ? this.contactSpan : 0);
    // Сонар по целым стенам — скан (WORLD_FRAG): холодный, как точки плана; в темноте — ярко, при фонаре — едва. Усиление
    // камеры его не разгоняет: он светит поверх кадра, как точки тихого слоя.
    {
      const sn = v.sonar;
      const k = sn ? sn[4] : 0;
      (wu.uSonarW!.value as THREE.Vector4).set(sn ? sn[0] : 0, sn ? sn[1] : 0, sn ? sn[2] : 0, sn ? sn[3] : -100);
      const xray = 0.25 + 0.75 * (1 - smoothstep(0.05, 0.5, v.lightIntensity * v.lightScale));
      const g = (SONAR_SCAN * xray) / Math.max(1, v.gain);
      (wu.uSonarTint!.value as THREE.Vector4).set(0.5 * g, 0.72 * g, 0.84 * g, k);
    }
    const pv = v.press ?? null;
    if (pv) {
      (wu.uPressBox!.value as THREE.Vector4).set(pv.box[0], pv.box[1], pv.box[2], pv.box[3]);
      (wu.uPress!.value as THREE.Vector4).set(pv.origin[0], pv.origin[1], pv.radius, pv.grid);
      (wu.uPressY!.value as THREE.Vector3).set(pv.floorY, pv.ceilY, pv.drop);
    } else {
      (wu.uPress!.value as THREE.Vector4).set(0, 0, 0, 0);
      (wu.uPressY!.value as THREE.Vector3).set(0, 0, 0);
    }

    // Внимание скана догоняет луч с запаздыванием: точки собираются туда, куда оно уже дошло. После
    // скачка в другое место (или первой картинки) оно переносится сразу.
    const dt = this.focusTime < 0 ? 1 : Math.max(0, v.time - this.focusTime);
    this.focusTime = v.time;
    const lp = this.tmpV.set(v.lightPos[0], v.lightPos[1], v.lightPos[2]);
    const snap = dt > 0.3 || this.focusPos.distanceToSquared(lp) > 9;
    const f = snap ? 1 : 1 - Math.exp(-dt * (this.beamBuild ? SCAN.followBuild : SCAN.follow));
    // Рука идёт вместе с игроком: место догоняется втрое быстрее направления.
    this.focusPos.lerp(lp, Math.min(1, f * 3));
    this.focusDir.lerp(this.tmpV.set(v.lightDir[0], v.lightDir[1], v.lightDir[2]), f).normalize();
    this.focusOn += (Math.min(1, v.lightIntensity * v.lightScale) - this.focusOn) * f;
    const fu = this.splatMat.uniforms;
    (fu.uFocusPosV!.value as THREE.Vector3).copy(this.focusPos).applyMatrix4(cam.matrixWorldInverse);
    (fu.uFocusDirV!.value as THREE.Vector3).copy(this.focusDir).transformDirection(cam.matrixWorldInverse);
    fu.uFocusOn!.value = this.focusOn;
    fu.uBuild!.value = this.beamBuild ? 1 : 0;
    const bu = this.worldMat.uniforms;
    bu.uBuild!.value = this.beamBuild ? 1 : 0;
    (bu.uBuildFocus!.value as THREE.Vector3).copy(this.focusPos);
    (bu.uBuildDir!.value as THREE.Vector3).copy(this.focusDir);
    bu.uBuildOn!.value = this.focusOn;
    // Объём для точек: глубину смотрим в шести точках буфера от самой точки.
    (fu.uEdl!.value as THREE.Vector3).set(6 / Math.max(1, this.width), 6 / Math.max(1, this.height), 2);

    // Сплаты. Память не разгорается, когда камера в темноте поднимает усиление: что помнится, то
    // гаснет, а не проявляется заново. Усиление достаётся только тому, что видно на самом деле.
    const pu0 = this.splatMat.uniforms;
    pu0.uTime!.value = v.time;
    // Мерка — усиление, при котором место было освещено: память выглядит не ярче, чем выглядело оно само.
    if (v.lightIntensity * v.lightScale > 0.5) this.litGain = v.gain;
    const memGain = Math.min(1, this.litGain / Math.max(v.gain, 1e-3));
    pu0.uMemGain!.value = memGain;
    this.composeMat.uniforms.uMemGain!.value = memGain;
    // В пространствах с рассеянным светом точки собираются и без фонаря: «сканирует» сам свет.
    // В белой комнате место собирается взглядом, как в светлом: свет даёт сама комната.
    // И в странной комнате: её свет даёт сама комната (шейдер мира, oddLight).
    pu0.uAmbientScan!.value = Math.max(v.whiteIn ?? 0, v.oddIn ?? 0, Math.min(1, ((v.ambient[0] + v.ambient[1] + v.ambient[2]) / 3) * v.ambientLocal * 8));

    // Отсвет от пятна: точка попадания луча и сила, убывающая с расстоянием до стены.
    const hitDist = Math.min(v.beamDist, 30);
    const hit = this.tmpV.set(v.lightPos[0] + v.lightDir[0] * hitDist, v.lightPos[1] + v.lightDir[1] * hitDist, v.lightPos[2] + v.lightDir[2] * hitDist);
    const hitWorld = hit.clone();
    hit.applyMatrix4(cam.matrixWorldInverse);
    const bounce = v.beamDist < 30 ? (0.05 * v.lightIntensity * v.lightScale) / (1 + 0.07 * hitDist * hitDist) : 0;
    (this.worldMat.uniforms.uBounce!.value as THREE.Vector4).set(hit.x, hit.y, hit.z, bounce);

    // Тень: глубина сцены из точки фонаря — либо, там где есть прямой свет (солнце на лугу, лампа у
    // кукольного домика), вдоль его лучей: фонарь в таких местах почти не виден, а тени от солнца нужны.
    const keyOn = this.shadowRT !== null && v.keyBox !== null && v.keyColor[0] + v.keyColor[1] + v.keyColor[2] > 0.01 && !this.debugShadowsOff && !this.keyShadowByFormula;
    const shadowOn = keyOn || (this.shadowRT !== null && v.lightIntensity * v.lightScale > 0.01 && !this.debugShadowsOff);
    this.worldMat.uniforms.uShadowFor!.value = keyOn ? 1 : 0;
    if (this.shadowRT && shadowOn) {
      let lc: THREE.Camera = this.lightCam;
      if (keyOn && v.keyBox) {
        const kc = this.keyCam;
        const h = v.keyBox.half;
        const back = h * 2 + 20;
        kc.left = -h;
        kc.right = h;
        kc.top = h;
        kc.bottom = -h;
        kc.near = 1;
        kc.far = back + h * 2;
        kc.updateProjectionMatrix();
        // Квадрат тени ходит за игроком, но только шагами в один тексель карты: иначе при каждом его
        // шаге края теней ползли бы по траве.
        kc.position.set(0, 0, 0);
        kc.up.set(0, 1, 0);
        kc.lookAt(-v.keyDir[0], -v.keyDir[1], -v.keyDir[2]);
        kc.updateMatrixWorld(true);
        const e = kc.matrixWorld.elements;
        const texel = (2 * h) / this.shadowRT.width;
        const c = v.keyBox.center;
        const dx = Math.round((c[0] * e[0]! + c[1] * e[1]! + c[2] * e[2]!) / texel) * texel - (c[0] * e[0]! + c[1] * e[1]! + c[2] * e[2]!);
        const dy = Math.round((c[0] * e[4]! + c[1] * e[5]! + c[2] * e[6]!) / texel) * texel - (c[0] * e[4]! + c[1] * e[5]! + c[2] * e[6]!);
        kc.position.set(
          c[0] + e[0]! * dx + e[4]! * dy + v.keyDir[0] * back,
          c[1] + e[1]! * dx + e[5]! * dy + v.keyDir[1] * back,
          c[2] + e[2]! * dx + e[6]! * dy + v.keyDir[2] * back,
        );
        lc = kc;
      } else {
        lc.position.set(v.lightPos[0], v.lightPos[1], v.lightPos[2]);
        lc.up.set(0, 1, 0);
        lc.lookAt(v.lightPos[0] + v.lightDir[0], v.lightPos[1] + v.lightDir[1], v.lightPos[2] + v.lightDir[2]);
      }
      lc.updateMatrixWorld(true);
      lc.matrixWorldInverse.copy(lc.matrixWorld).invert();
      this.tmpM.multiplyMatrices(lc.projectionMatrix, lc.matrixWorldInverse);
      (this.worldMat.uniforms.uShadowMatrix!.value as THREE.Matrix4).multiplyMatrices(BIAS, this.tmpM);
      this.worldMat.uniforms.uShadowMap!.value = null;
      this.scene.overrideMaterial = this.depthMat;
      r.setRenderTarget(this.shadowRT);
      r.clear();
      r.render(this.scene, lc);
      this.scene.overrideMaterial = null;
      this.worldMat.uniforms.uShadowMap!.value = this.shadowRT.depthTexture;
    } else if (this.shadowRT) {
      // Тень не считается: карта очищается, чтобы в шейдере всё было освещено.
      r.setRenderTarget(this.shadowRT);
      r.clear();
      this.worldMat.uniforms.uShadowMap!.value = this.shadowRT.depthTexture;
    }

    this.dustMat.uniforms.uTime!.value = v.time;
    const starsOn = (v.stars ?? 0) > 0.004;
    this.stars.visible = starsOn;
    if (starsOn) {
      const su = this.starMat.uniforms;
      // Небо живёт по настоящему времени кадра: звёзды мерцают и падают и тогда, когда время места стоит.
      su.uTime!.value = v.time;
      su.uBright!.value = v.stars ?? 0;
      (su.uCamPos!.value as THREE.Vector3).copy(cam.position);
      const fall = v.fall ?? null;
      (su.uFall!.value as THREE.Vector4).set(fall ? fall[0] : 0, fall ? fall[1] : 0, fall ? v.time - fall[2] : -100, fall ? 1 : 0);
      su.uThrough!.value = this.debugScanOff ? 0 : clamp01(v.skyOpen ?? 0);
      if (v.skySeed !== undefined && v.skySeed !== this.skySeedNow) this.setSky(v.skySeed);
    }
    (this.dustMat.uniforms.uCamPos!.value as THREE.Vector3).copy(cam.position);
    // Сцена — кусок места: маска действует, пока игрок на месте; в кармане и в лимбо — нет (там своя геометрия).
    this.pieceU.uPieceOn.value.x = this.pieceReady && v.piece === true ? 1 : 0;

    // Мир прошлого кадра остаётся: по его глубине память света переносится в новый кадр.
    const older = this.scenePrevRT;
    this.scenePrevRT = this.sceneRT;
    this.sceneRT = older;
    r.setRenderTarget(this.sceneRT);
    // Служебный кадр проверки (#diag): фон — нули, чтобы по пикселю было видно, нарисована ли там поверхность.
    const probe = this.debugView > 0;
    r.setClearColor(probe ? 0x000000 : this.clearColor, probe ? 0 : 1);
    r.clear();
    r.render(this.scene, cam);
    r.setClearColor(0x000000, 1);

    // Память света: что было освещено и как давно. Прошлого нет после первого кадра, после скачка в
    // другое место и когда время пошло заново (новая сессия) — тогда всё забыто. Стареет память по
    // игровому времени: на паузе она стоит.
    // Служебный кадр проверки в память не идёт: память остаётся той, что была до него.
    const gap = v.time - this.memTime;
    const keep = this.memLive && !this.debugScanOff && gap >= 0 && this.memCam.distanceToSquared(cam.position) < 9;
    if (!probe) {
      const viewProj = this.tmpM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const mu = this.memMat.uniforms;
      const [memOut, memWas] = this.memRT;
      mu.tScene!.value = this.sceneRT.texture;
      mu.tDepth!.value = this.sceneRT.depthTexture;
      mu.tPrev!.value = memWas.texture;
      mu.tPrevDepth!.value = this.scenePrevRT.depthTexture;
      (mu.uReproj!.value as THREE.Matrix4).copy(viewProj).invert().premultiply(this.prevViewProj);
      mu.uDecay!.value = keep ? Math.min(1, gap / SCAN.hold) : 0;
      mu.uKeep!.value = keep ? 1 : 0;
      mu.uFrame!.value = v.frame;
      r.setRenderTarget(memOut);
      r.render(this.memScene, this.postCam);
      this.memRT = [memWas, memOut];
      this.prevViewProj.copy(viewProj);
      // Кадры перехода в память не идут: красная сетка и прожог старта не должны висеть в точках потом.
      this.memLive = !v.memHold;
      this.memTime = v.time;
      this.memCam.copy(cam.position);
    }
    const memNow = this.memRT[1];

    // Сведение: поверхности — только там, где сплаты слились; поверх — сами точки, из которых собран мир.
    this.composeMat.uniforms.tScene!.value = this.sceneRT.texture;
    this.composeMat.uniforms.tMem!.value = memNow.texture;
    this.composeMat.uniforms.uSolid!.value = this.debugScanOff || this.debugView > 0 ? 1 : 0;
    r.setRenderTarget(this.rawRT);
    r.render(this.composeScene, this.postCam);
    if (!this.debugScanOff && !probe) {
      this.clouds.update(cam);
      pu0.tScene!.value = this.sceneRT.texture;
      pu0.tDepth!.value = this.sceneRT.depthTexture;
      pu0.tMem!.value = memNow.texture;
      r.autoClear = false;
      r.render(this.clouds.scene, cam);
      r.autoClear = true;
    }
    // Тихий слой: точки по рёбрам и углам — только там, где стена уже стёрта (поздние круги; маска — в шейдере точек).
    // Волна сонара зажигает их там же; по целым стенам она идёт сканом в шейдере мира — пока стены целы, этот проход не нужен.
    const wallsGone = ((this.worldMat.uniforms.uErase!.value as THREE.Vector4).y * 1.14 > 0.06);
    if (this.edgePoints && this.edgeMat && ((v.quiet ?? 0) > 0 || ((v.sonar?.[4] ?? 0) > 0 && wallsGone))) {
      const eu = this.edgeMat.uniforms;
      eu.tDepth!.value = this.sceneRT.depthTexture;
      (eu.uTiers!.value as THREE.Vector2).set(lo, hi);
      const sn = v.sonar;
      (eu.uSonar!.value as THREE.Vector4).set(sn ? sn[0] : 0, sn ? sn[1] : 0, sn ? sn[2] : 0, sn ? sn[3] : -100);
      eu.uSonarK!.value = sn ? sn[4] : 0;
      eu.uQuiet!.value = v.quiet ?? 0;
      eu.uGainInv!.value = 1 / Math.max(1, v.gain);
      eu.uXray!.value = 0.15 + 0.5 * (1 - smoothstep(0.05, 0.5, v.lightIntensity * v.lightScale));
      r.autoClear = false;
      r.render(this.edgeScene, cam);
      r.autoClear = true;
    }
    // Пыль тронутых вещей — теми же точками, поверх точек мира.
    if (this.bursts.size > 0) {
      const gdt = this.grainTime < 0 ? 0 : Math.max(0, Math.min(0.1, v.time - this.grainTime));
      this.grainU.uTime!.value = v.time;
      this.grainU.uDarkGain!.value = 1 / Math.max(1, v.gain) ** 0.5;
      for (const [key, b] of this.bursts) {
        stepGrains(b.life, gdt);
        if (b.life.done) {
          this.dropBurst(key);
          continue;
        }
        b.mat.uniforms.uGo!.value = b.life.go;
        b.mat.uniforms.uFlow!.value = b.life.flow;
        b.mat.uniforms.uFade!.value = b.life.fade;
      }
      if (this.bursts.size > 0) {
        r.autoClear = false;
        r.render(this.grainScene, cam);
        r.autoClear = true;
      }
    }
    this.grainTime = v.time;
    // Осыпь — поверх точек мира. В темноте она светится сама; усиление камеры её не разгоняет.
    // Если она за спиной, впереди рисуется её призрак: то же тело, отражённое из-за спины.
    this.ghostPoints.visible = this.swarmPoints.visible && v.ghost > 0.01;
    if (this.swarmPoints.visible) {
      this.swarmMat.uniforms.uDarkGain!.value = 1 / Math.max(1, v.gain) ** 0.5;
      this.swarmMat.uniforms.tDepth!.value = this.sceneRT.depthTexture;
      if (this.ghostPoints.visible) {
        this.ghostMat.uniforms.uAlpha!.value = (this.swarmMat.uniforms.uAlpha!.value as number) * v.ghost;
        (this.ghostMat.uniforms.uGhost!.value as THREE.Vector4).set(-Math.sin(v.camYaw), 0, -Math.cos(v.camYaw), 1);
      }
      r.autoClear = false;
      r.render(this.swarmScene, cam);
      r.autoClear = true;
    }

    // Эхо: волны от шагов и от Осыпи проступают на том, чего свет не касается. Свой слой — его
    // прибавит «камера» (пост-проход).
    let echoOn = false;
    if (v.echo && !this.debugScanOff) {
      const eu = this.echoMat.uniforms;
      const pa = eu.uPulse!.value as THREE.Vector4[];
      const pb = eu.uPulseB!.value as THREE.Vector4[];
      let live = 0;
      for (let i = 0; i < ECHO_MAX; i++) {
        const o = i * ECHO_STRIDE;
        pa[i]!.set(v.echo[o]!, v.echo[o + 1]!, v.echo[o + 2]!, v.echo[o + 3]!);
        pb[i]!.set(v.echo[o + 4]!, v.echo[o + 5]!, v.echo[o + 6]!, 0);
        if (v.echo[o + 4]! > 0) live += 1;
      }
      if (live > 0) {
        eu.tDepth!.value = this.sceneRT.depthTexture;
        eu.tScene!.value = this.sceneRT.texture;
        // prevViewProj здесь уже матрица этого кадра: её только что записал проход памяти.
        (eu.uInvViewProj!.value as THREE.Matrix4).copy(this.prevViewProj).invert();
        (eu.uTexel!.value as THREE.Vector2).set((1.5 * this.fine) / this.sceneRT.width, (1.5 * this.fine) / this.sceneRT.height);
        eu.uGainInv!.value = 1 / Math.max(1, v.gain);
        r.setRenderTarget(this.echoRT);
        r.render(this.echoScene, this.postCam);
        echoOn = true;
      }
    }
    // Звёздное небо — в тот же слой, что эхо: «камера» прибавит его поверх кадра, выдержка его не смажет. Где мир
    // собран, неба не видно; где нет ничего — видно всегда; сквозь несобранное — по skyOpen (STAR_FRAG).
    if (starsOn && !probe) {
      const su = this.starMat.uniforms;
      su.tDepth!.value = this.sceneRT.depthTexture;
      su.tScene!.value = this.sceneRT.texture;
      su.tMem!.value = memNow.texture;
      (su.uRes!.value as THREE.Vector2).set(this.echoRT.width, this.echoRT.height);
      r.setRenderTarget(this.echoRT);
      if (!echoOn) r.clear();
      r.autoClear = false;
      r.render(this.skyScene, cam);
      r.autoClear = true;
      echoOn = true;
    }

    // Длинная выдержка: без фонаря яркое оставляет след, и при повороте кадр смазывается. Чем темнее,
    // тем дольше след; при свете и там, где светло само пространство, выдержки нет. Гаснет след по
    // игровому времени: на паузе кадр стоит как есть.
    const dark = (1 - smoothstep(0.05, 0.5, v.lightIntensity * v.lightScale)) * (1 - (pu0.uAmbientScan!.value as number));
    // Тяжесть в аквариуме (systems/odd.ts): след тянется и при свете.
    const tau = Math.max(SCAN.smear * dark, TRAIL_HEAVY * (v.trail ?? 0));
    const prevFrame = this.compRT;
    this.compRT = this.compPrevRT;
    this.compPrevRT = prevFrame;
    const tu = this.trailMat.uniforms;
    tu.tNow!.value = this.rawRT.texture;
    tu.tPrev!.value = this.compPrevRT.texture;
    tu.tDepth!.value = this.sceneRT.depthTexture;
    // След хранится без усиления камеры; когда оно растёт, след тускнеет на столько же — на экране
    // он только гаснет.
    const gainNow = Math.max(v.gain, 1e-3);
    tu.uKeep!.value = keep && tau > 0.01 ? Math.exp(-gap / tau) * Math.min(1, this.trailGain / gainNow) : 0;
    // Разрыв кадра: прошлый кадр едет за камерой. Поворот влево уводит картинку вправо, взгляд вверх — вниз.
    const mosh = keep ? (v.mosh ?? 0) : 0;
    tu.uMosh!.value = mosh;
    const fovY = (this.camera.fov * Math.PI) / 180;
    let dyaw = v.camYaw - this.moshYaw;
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    (tu.uMoshShift!.value as THREE.Vector2).set(mosh > 0 ? dyaw / (fovY * this.camera.aspect) : 0, mosh > 0 ? -(v.camPitch - this.moshPitch) / fovY : 0);
    this.moshYaw = v.camYaw;
    this.moshPitch = v.camPitch;
    this.trailGain = gainNow;
    r.setRenderTarget(this.compRT);
    r.render(this.trailScene, this.postCam);
    // Кинескоп странной комнаты: копия готового кадра в кольцо — раз в 1/30 с игрового времени.
    // Копирует, только пока игрок в странной комнате (oddIn): дальше от неё лишний проход по буферу — лишняя работа телефону.
    if (this.tvScreen && this.tvScreen.visible && this.tvRing.length > 0 && !probe && (v.oddIn ?? 0) > 0.01) {
      if (v.time < this.tvLast) {
        this.tvFilled = 0;
        this.tvLast = -Infinity;
      }
      // Допуск на округление: при 60 кадрах в секунду копия — ровно через кадр, а не через два.
      if (v.time - this.tvLast >= TV_RING.every - 1e-4) {
        this.copyMat.uniforms.tSrc!.value = this.compRT.texture;
        r.setRenderTarget(this.tvRing[this.tvHead]!);
        r.render(this.copyScene, this.postCam);
        this.tvHead = (this.tvHead + 1) % TV_RING.frames;
        this.tvFilled = Math.min(TV_RING.frames, this.tvFilled + 1);
        this.tvLast = v.time;
      }
    }

    // Дымка в луче: маленький буфер, по глубине готового кадра.
    if (this.hazeRT) {
      const hu = this.hazeMat.uniforms;
      hu.tDepth!.value = this.sceneRT.depthTexture;
      hu.uShadowMap!.value = shadowOn && this.shadowRT ? this.shadowRT.depthTexture : null;
      (hu.uShadowMatrixV!.value as THREE.Matrix4).multiplyMatrices(this.worldMat.uniforms.uShadowMatrix!.value as THREE.Matrix4, cam.matrixWorld);
      (hu.uCamRot!.value as THREE.Matrix3).setFromMatrix4(cam.matrixWorld);
      (hu.uCamPos!.value as THREE.Vector3).copy(cam.position);
      // Там, где карта теней занята прямым светом, дымки в луче нет: её тени были бы чужими.
      hu.uDensity!.value = !keyOn && v.lightIntensity * v.lightScale > 0.01 ? v.haze : 0;
      hu.uFrame!.value = v.frame;
      hu.uTime!.value = v.time;
      r.setRenderTarget(this.hazeRT);
      r.render(this.hazeScene, this.postCam);
    }

    // Где на экране центр луча — там светится пыльный воздух.
    const ndc = hitWorld.project(cam);
    const visible = ndc.z < 1 && ndc.z > -1;
    // Цвет освещённого пятна — в маленький буфер: в следующем кадре им окрасится отсвет.
    const su = this.spotMat.uniforms;
    su.tScene!.value = this.compRT.texture;
    const inFrame = visible && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && v.lightIntensity * v.lightScale > 0.05 && v.beamDist < 30;
    (su.uBeam!.value as THREE.Vector3).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5, inFrame ? 1 : 0);
    r.setRenderTarget(this.spotRT);
    r.render(this.spotScene, this.postCam);
    const pu = this.postMat.uniforms;
    (pu.uBeam!.value as THREE.Vector3).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5, visible ? 0.018 * v.lightIntensity * v.lightScale : 0);
    pu.uCrt!.value = v.crt;
    pu.uFlash!.value = v.flash;
    pu.uMist!.value = v.mist ?? 0;
    const gr = v.grade ?? GRADE_DEFAULT;
    (pu.uGradeLo!.value as THREE.Vector4).set(gr.lo[0], gr.lo[1], gr.lo[2], gr.sat);
    (pu.uGradeHi!.value as THREE.Vector3).set(gr.hi[0], gr.hi[1], gr.hi[2]);
    pu.tScene!.value = this.compRT.texture;
    pu.tEcho!.value = this.echoRT.texture;
    pu.uEcho!.value = echoOn ? 1 : 0;
    pu.tHaze!.value = this.hazeRT ? this.hazeRT.texture : null;
    pu.uFrame!.value = v.frame;
    pu.uGain!.value = v.gain * this.brightness;
    pu.uNoise!.value = v.noise;
    pu.uGlitch!.value = v.glitch;
    pu.uTunnel!.value = v.tunnel;
    pu.uDrift!.value = v.drift ?? 0;
    pu.uBarrel!.value = BARREL * (v.lens ?? 1);
    pu.uGas!.value = v.gas;
    pu.uFade!.value = v.fade;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);

    this.lastCalls = r.info.render.calls;
    this.lastTris = r.info.render.triangles;
  }

  /** Сколько из отданных видеокарте точек-сплатов не спрятано отбором по расстоянию (перебор; для отладки). */
  cloudUsage(): { drawn: number; shown: number; cells: number } {
    return this.clouds.usage();
  }

  /**
   * points — сколько точек-сплатов отдано видеокарте в прошлом кадре, clouds — у скольких сеток есть
   * облака точек, cells — сколько клеток с точками сейчас живо (у сеток рядом с игроком).
   */
  info(): { calls: number; triangles: number; width: number; height: number; quality: Quality; fine: number; programs: number; chunks: number; visible: number; points: number; clouds: number; cells: number; slides: number; spores: { shown: number; far: number; culled: number }; tv: number } {
    return { calls: this.lastCalls, triangles: this.lastTris, width: this.width, height: this.height, quality: this.quality, fine: this.fine, programs: this.renderer.info.programs?.length ?? 0, chunks: this.chunks.length, visible: this.chunks.filter((m) => m.visible).length, points: this.clouds.drawn, clouds: this.clouds.count, cells: this.clouds.cells, slides: this.chunks.filter((m) => m.userData.slide !== undefined).length, spores: { ...this.sporeStats }, tv: this.tvScreen ? this.tvFilled : -1 };
  }

  /**
   * Яркость текущего кадра сеткой cols×rows (0..255). Вызывать сразу после render() в том же такте:
   * буфер экрана очищается после показа. Нужна смоуку: «в конусе светло», «тень что-то меняет».
   */
  /**
   * Средний цвет кадра, доля «красных» точек (красный канал заметно сильнее двух других): по ней
   * проверки отличают красную сетку от просто светлой картинки, — и доля тёмных (все каналы ниже 40):
   * по ней видно, что поверхность собрана из точек с пустотой между ними.
   */
  probeColor(): { r: number; g: number; b: number; red: number; dark: number } {
    const gl = this.renderer.getContext();
    const w = this.width;
    const h = this.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0;
    let g = 0;
    let b = 0;
    let red = 0;
    let dark = 0;
    let n = 0;
    for (let o = 0; o < px.length; o += 8) {
      const pr = px[o]!;
      const pg = px[o + 1]!;
      const pb = px[o + 2]!;
      r += pr;
      g += pg;
      b += pb;
      if (pr > 70 && pr > pg * 1.6 && pr > pb * 1.6) red += 1;
      if (pr < 40 && pg < 40 && pb < 40) dark += 1;
      n += 1;
    }
    return { r: r / n, g: g / n, b: b / n, red: red / n, dark: dark / n };
  }

  probe(cols = 32, rows = 18): number[] {
    const gl = this.renderer.getContext();
    const w = this.width;
    const h = this.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor((c * w) / cols);
        const x1 = Math.floor(((c + 1) * w) / cols);
        // Строки readPixels идут снизу вверх — переворачиваем, чтобы строка 0 была верхней.
        const y0 = Math.floor(((rows - 1 - r) * h) / rows);
        const y1 = Math.floor(((rows - r) * h) / rows);
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const o = (y * w + x) * 4;
            sum += 0.299 * px[o]! + 0.587 * px[o + 1]! + 0.114 * px[o + 2]!;
            n += 1;
          }
        }
        out.push(n > 0 ? sum / n : 0);
      }
    }
    return out;
  }

  /** Потерять и вернуть контекст (проверка восстановления в смоуке). */
  debugLoseContext(restoreAfterMs = 200): void {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), restoreAfterMs);
  }
}
