/**
 * Карманные пространства: маленькие отдельные сцены, в которые игрок проваливается из убежища, —
 * белое нигде, луг, поле подсолнухов (world/pocket_sunfield.ts), красная комната забвения (вид 'dollhouse': прежде здесь был кукольный домик, имя вида осталось). Каждое собирается кодом вдали от уровня (origin), со своими
 * преградами и своим окружением: светом, туманом, небом.
 *
 * Окружение (Env) — то, чем пространства отличаются для рендера. В убежище рассеянного света почти
 * нет и даль чёрная; в белом нигде всё залито ровным светом и даль белая.
 */
import type { Vec3 } from '../core/types';
import type { GrassSite } from '../systems/grass';
import type { WorldKind } from '../gen/layout';
import type { Aabb, HeightField } from './colliders';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import { buildLethe } from './pocket_lethe';
import { buildDunes } from './pocket_dunes';
import { buildMeadow } from './pocket_meadow';
import { buildSunfield } from './pocket_sunfield';

export interface Env {
  /** Рассеянный свет (линейный цвет): 0 — светит только фонарь. */
  ambient: Vec3;
  /** Цвет, в который уходит даль; он же фон кадра. */
  fog: Vec3;
  /** Плотность тумана, 1/м. */
  fogDensity: number;
  /** Множитель света фонаря: 0 — фонарь здесь «не проходит». */
  light: number;
  /** Насколько здесь сыро и запущено, 0..1. */
  decay: number;
  /** Плотность взвеси в луче. */
  haze: number;
  /**
   * Прямой свет пространства — солнце на лугу, большая лампа у кукольного домика: направление на
   * источник (мир, единичный вектор) и цвет с силой. Нет — светит только рассеянный свет и фонарь.
   */
  key?: { dir: Vec3; color: Vec3; /** Полуширина квадрата вокруг игрока, в котором прямой свет даёт тени, м: меньше квадрат — чётче тени. */ reach?: number };
  /**
   * Докуда рассеянный свет «сканирует» пространство: до первого расстояния точки стоят плотно, ко
   * второму редеют до россыпи, м. Не задано — 4 и 15 (тесные пространства); на лугу даль видна дольше.
   */
  scan?: [number, number];
  /**
   * Рассеянный свет дают потолочные панели, у каждой клетки уровня свой (systems/cell_lights.ts):
   * sensor — панели включаются там, где игрок, и гаснут за ним; hum — горят всегда, но неровно;
   * day — дневной свет зала ожидания: у клетки свой уровень, общий множитель задаёт ход дня.
   * ambient тогда — свет под горящей панелью. Не задано — рассеянный свет везде одинаков.
   */
  cells?: 'sensor' | 'hum' | 'day';
  /**
   * Чистое пространство: поверхности — только шар материала (matcap) и оттенок, без фактур, рельефа,
   * грязи, сырости и потёков. Так выглядят жёлтые комнаты (решение партнёра).
   */
  plain?: boolean;
}

/** Убежище: темно, даль чёрная. decay и haze игра считает по глубине сама. */
export const ENV_BUNKER: Env = { ambient: [0.0016, 0.0019, 0.0024], fog: [0, 0, 0], fogDensity: 0.035, light: 1, decay: 0.25, haze: 0.008 };

/**
 * Офис: ровный холодный свет панелей — но только там, где сработал датчик; вокруг чернота. Чисто:
 * запущенность отрицательная — ни сырости, ни пыли (шейдер мира).
 *
 * Фонаря здесь нет (light: 0 — решение партнёра: в офисе он не имеет смысла): свет даёт само место.
 * Собрано при этом только там, куда смотрит герой (слова партнёра: «локации должны распадаться, как
 * от света фонарика. Не важно светлые они или темные»): конус взгляда — в шейдере мира (uGaze), а
 * достаёт взгляд так же далеко, как луч фонаря: сплошь метров до девяти, дальше россыпью, к
 * восемнадцати редеет до ничего. (Пока место собиралось кругом вокруг игрока, дальность была 2,5 и
 * 10 м; с конусом такой короткий взгляд оставлял от коридора чёрный кадр.) А датчики движения теряют
 * того, кто замер: панели гаснут, и место осыпается.
 */
export const ENV_OFFICE: Env = { ambient: [0.5, 0.53, 0.52], fog: [0, 0, 0], fogDensity: 0.022, light: 0, decay: -0.5, haze: 0.002, scan: [7, 18], cells: 'sensor' };

/**
 * Жёлтые комнаты: тот же этаж без света — темно, как в убежище, светит только фонарь. Чисто и пусто:
 * ни сырости, ни пятен, ни фактур — один шар материала (plain).
 */
export const ENV_YELLOW: Env = { ambient: [0.002, 0.0018, 0.001], fog: [0, 0, 0], fogDensity: 0.03, light: 1, decay: -0.5, haze: 0.004, plain: true };

/**
 * Зал ожидания: дневной свет через стеклянную крышу, фонаря нет. Место держит неподвижность: пока
 * игрок стоит, зал собран до дальней стены; пошёл — он осыпается, и остаётся остров вокруг (scan
 * здесь — для идущего; для стоящего его раздвигает игра, systems/flow.ts). Прямой свет — солнце,
 * которое движется по времени места; рассеянный — по клеткам: зал светлее комнат, переходы темны.
 */
export const ENV_STATION: Env = { ambient: [0.46, 0.44, 0.4], fog: [0.62, 0.6, 0.55], fogDensity: 0.006, light: 0, decay: -0.32, haze: 0.0025, scan: [3, 11], cells: 'day', key: { dir: [0.3, 0.86, 0.4], color: [1.5, 1.42, 1.3], reach: 16 } };

/** Окружение каждого мира вылазки. */
export const WORLD_ENV: Record<WorldKind, Env> = { shelter: ENV_BUNKER, office: ENV_OFFICE, yellow: ENV_YELLOW, station: ENV_STATION };

/**
 * Виды карманов. Песчаный зал (dunes) — не скачок, а комната за чёрным проёмом места (world/pocket_dunes.ts): случайные скачки
 * туда не уносят (systems/jumps.ts), в него входят через проём.
 */
export type PocketKind = 'void' | 'meadow' | 'dollhouse' | 'dunes' | 'sunfield';
export const POCKET_KINDS: readonly PocketKind[] = ['void', 'meadow', 'dollhouse', 'dunes', 'sunfield'];

/** Клетка убежища на макете в кукольном домике: координаты сетки уровня, ярус, род помещения. */
export interface ModelCell {
  x: number;
  z: number;
  tier: number;
  type: string;
  /** Номер помещения: клетки одного помещения на макете подсвечиваются вместе. */
  room: number;
}

/**
 * Что пространству нужно знать об игре, чтобы в нём был смысл: план убежища и место искомой вещи
 * (кукольный домик показывает их макетом), и то, что это лимбо (там выхода нет — сессия кончилась).
 */
export interface PocketContext {
  cells?: readonly ModelCell[];
  /** Клетка, где лежит искомая вещь; null — сейчас ничего не ищут. */
  target?: { x: number; z: number; tier: number } | null;
  /** Клетка, откуда игрока унесло. */
  here?: { x: number; z: number; tier: number } | null;
  limbo?: boolean;
}

export interface PocketSpace {
  kind: PocketKind;
  /** Геометрия в мировых координатах (уже сдвинута на origin). */
  meshes: MeshData[];
  colliders: Aabb[];
  /** Где появляется игрок и куда смотрит: yaw 0 — в −z; pitch — наклон взгляда (минус — вниз). */
  spawn: { pos: Vec3; yaw: number; pitch?: number };
  env: Env;
  /** Центр и радиус: уйти от центра дальше радиуса — значит выйти из пространства. */
  center: Vec3;
  radius: number;
  /** Места на полу, куда игра может положить вещи. */
  spots: Vec3[];
  /**
   * Выход: пустой дверной проём, обведённый красным светом; точка — на полу посередине проёма.
   * Войти в него — вернуться в убежище; смотреть на него можно сколько угодно. Нет выхода только в лимбо.
   */
  exit?: Vec3 | null;
  /**
   * Свет обводки выхода, если не красный. Красной комнате забвения нужен белый: красный контур в красном тонет (разбор куратора,
   * противоречие 422).
   */
  exitGlow?: Vec3;
  /** То, ради чего сюда попадают: точка, на которую надо посветить (макет убежища в кукольном домике). */
  focus?: Vec3 | null;
  /** Трава плитками (луг): рисует рендер копиями одной сетки (systems/grass.ts). */
  grass?: GrassSite[];
  /** Пол-рельеф (барханы песчаного зала): опора по высоте поверхности, а не коробками (world/colliders.ts, HeightField). */
  fields?: HeightField[];
}

export type PocketBuilder = (seed: number, origin: Vec3, ctx?: PocketContext) => PocketSpace;

/** Проём выхода: ширина и высота в свету, м. */
export const EXIT_W = 0.9;
export const EXIT_H = 2.05;
/** Красный свет обводки выхода: тот же цвет, что у полигонной сетки. */
const EXIT_GLOW: Vec3 = [190, 15, 7];

/**
 * Обводка выхода: тонкие светящиеся красным рейки по контуру проёма. Плоскость проёма — поперёк оси z.
 * Знак один на все пространства: красный контур — край нарисованной сцены, за ним убежище.
 */
export function exitOutline(mb: MeshBuilder, at: Vec3, glow: Vec3 = EXIT_GLOW): void {
  const [x, y, z] = at;
  const hw = EXIT_W / 2;
  const t = 0.022;
  const d = 0.03;
  mb.box([x - hw, y, z - d], [x - hw + t, y + EXIT_H, z + d], MAT.glow, { tint: glow });
  mb.box([x + hw - t, y, z - d], [x + hw, y + EXIT_H, z + d], MAT.glow, { tint: glow });
  mb.box([x - hw, y + EXIT_H - t, z - d], [x + hw, y + EXIT_H, z + d], MAT.glow, { tint: glow });
  mb.box([x - hw, y + 0.004, z - d], [x + hw, y + 0.004 + t, z + d], MAT.glow, { tint: glow });
}

/** Дверная коробка без двери: два косяка и перемычка. Плоскость — поперёк оси z. */
export function doorFrame(mb: MeshBuilder, at: Vec3, tint: Vec3 = [1.15, 1.12, 1.05]): void {
  const [x, y, z] = at;
  const hw = EXIT_W / 2;
  const p = 0.09;
  const d = 0.07;
  mb.box([x - hw - p, y, z - d], [x - hw, y + EXIT_H + p, z + d], MAT.wood, { tint, bevel: 0.01 });
  mb.box([x + hw, y, z - d], [x + hw + p, y + EXIT_H + p, z + d], MAT.wood, { tint, bevel: 0.01 });
  mb.box([x - hw, y + EXIT_H, z - d], [x + hw, y + EXIT_H + p, z + d], MAT.wood, { tint, bevel: 0.01 });
}

/**
 * Белое нигде: ровный белый пол без краёв и горизонта. Чтобы было видно, что идёшь, пол размечен
 * редкими серыми крестиками — как сетка пустой сцены в редакторе. Здесь же лимбо между сессиями.
 */
export function buildVoid(_seed: number, origin: Vec3, ctx?: PocketContext): PocketSpace {
  const [ox, oy, oz] = origin;
  const mb = new MeshBuilder();
  // Выход — дверная коробка впереди, за вещами; в лимбо её нет: сессия кончилась, возвращаться некуда.
  const exit: Vec3 | null = ctx?.limbo ? null : [ox, oy, oz - 11];
  if (exit) doorFrame(mb, exit, [0.5, 0.5, 0.52]);
  const R = 44;
  mb.box([ox - R, oy - 0.5, oz - R], [ox + R, oy, oz + R], MAT.plaster, { tint: [1.25, 1.25, 1.25], skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  // Спокойнее и чище (партнёр 24.11): крестики реже и бледнее, пол без фактуры (env.plain), взвеси нет.
  const ink: Vec3 = [0.86, 0.86, 0.87];
  const STEP = 4;
  for (let i = -7; i <= 7; i++) {
    for (let j = -7; j <= 7; j++) {
      const x = ox + i * STEP;
      const z = oz + j * STEP;
      const y = oy + 0.003;
      mb.quad([x - 0.09, y, z + 0.012], [x + 0.09, y, z + 0.012], [x + 0.09, y, z - 0.012], [x - 0.09, y, z - 0.012], MAT.paper, ink);
      mb.quad([x - 0.012, y, z + 0.09], [x + 0.012, y, z + 0.09], [x + 0.012, y, z - 0.09], [x - 0.012, y, z - 0.09], MAT.paper, ink);
    }
  }
  // Места для вещей: расходящаяся спираль вокруг точки появления.
  const spots: Vec3[] = [];
  for (let k = 0; k < 40; k++) {
    const a = k * 2.399963;
    const r = 3.2 + 0.62 * k;
    spots.push([ox + Math.sin(a) * r, oy, oz - Math.cos(a) * r]);
  }
  return {
    kind: 'void',
    meshes: [mb.build()],
    colliders: [{ minX: ox - R, minY: oy - 0.5, minZ: oz - R, maxX: ox + R, maxY: oy, maxZ: oz + R }],
    spawn: { pos: [ox, oy, oz], yaw: 0 },
    // Фонаря нет (разбор куратора 431, слово партнёра «в светлых локациях… нет фонарика»): белое нигде и лимбо — самые светлые
    // места игры; взгляд здесь идёт от света места, как в офисе, щелчков и тряски нет. Луг фонарь оставляет: трава тянется к лучу.
    env: { ambient: [0.62, 0.62, 0.62], fog: [0.86, 0.86, 0.86], fogDensity: 0.06, light: 0, decay: 0, haze: 0, plain: true },
    center: [ox, oy, oz],
    radius: 30,
    spots,
    exit,
  };
}

const BUILDERS: Partial<Record<PocketKind, PocketBuilder>> = { void: buildVoid, meadow: buildMeadow, dollhouse: buildLethe, dunes: buildDunes, sunfield: buildSunfield };

/** Подключить строителя пространства (луг и кукольный домик лежат в своих файлах). */
export function registerPocket(kind: PocketKind, builder: PocketBuilder): void {
  BUILDERS[kind] = builder;
}

/**
 * Собрать пространство. Неподключённый вид заменяется белым нигде. Выход обводится красным светом
 * здесь, одинаково для всех.
 */
export function buildPocket(kind: PocketKind, seed: number, origin: Vec3, ctx?: PocketContext): PocketSpace {
  const p = (BUILDERS[kind] ?? buildVoid)(seed, origin, ctx);
  const exit = p.exit ?? null;
  if (exit) {
    const mb = new MeshBuilder();
    exitOutline(mb, exit, p.exitGlow);
    p.meshes.push(mb.build());
  }
  return { ...p, exit, focus: p.focus ?? null };
}
