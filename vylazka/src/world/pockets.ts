/**
 * Карманные пространства: маленькие отдельные сцены, в которые игрок проваливается из убежища, —
 * белое нигде, луг, кукольный домик. Каждое собирается кодом вдали от уровня (origin), со своими
 * преградами и своим окружением: светом, туманом, небом.
 *
 * Окружение (Env) — то, чем пространства отличаются для рендера. В убежище рассеянного света почти
 * нет и даль чёрная; в белом нигде всё залито ровным светом и даль белая.
 */
import type { Vec3 } from '../core/types';
import type { Aabb } from './colliders';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import { buildDollhouse } from './pocket_dollhouse';
import { buildMeadow } from './pocket_meadow';

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
  key?: { dir: Vec3; color: Vec3 };
  /**
   * Докуда рассеянный свет «сканирует» пространство: до первого расстояния точки стоят плотно, ко
   * второму редеют до россыпи, м. Не задано — 4 и 15 (тесные пространства); на лугу даль видна дольше.
   */
  scan?: [number, number];
}

/** Убежище: темно, даль чёрная. decay и haze игра считает по глубине сама. */
export const ENV_BUNKER: Env = { ambient: [0.0016, 0.0019, 0.0024], fog: [0, 0, 0], fogDensity: 0.035, light: 1, decay: 0.25, haze: 0.008 };

export type PocketKind = 'void' | 'meadow' | 'dollhouse';
export const POCKET_KINDS: readonly PocketKind[] = ['void', 'meadow', 'dollhouse'];

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
  /** Точки-якоря: если долго смотреть на якорь, пространство отпускает (дверной проём на лугу). */
  anchors: Vec3[];
  /** Места на полу, куда игра может положить вещи. */
  spots: Vec3[];
  /**
   * Выход: пустой дверной проём, обведённый красным светом; точка — на полу посередине проёма.
   * Пройти сквозь него — вернуться в убежище. Не задан — берётся первый якорь.
   */
  exit?: Vec3 | null;
  /** То, ради чего сюда попадают: точка, на которую надо посветить (макет убежища в кукольном домике). */
  focus?: Vec3 | null;
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
export function exitOutline(mb: MeshBuilder, at: Vec3): void {
  const [x, y, z] = at;
  const hw = EXIT_W / 2;
  const t = 0.022;
  const d = 0.03;
  mb.box([x - hw, y, z - d], [x - hw + t, y + EXIT_H, z + d], MAT.glow, { tint: EXIT_GLOW });
  mb.box([x + hw - t, y, z - d], [x + hw, y + EXIT_H, z + d], MAT.glow, { tint: EXIT_GLOW });
  mb.box([x - hw, y + EXIT_H - t, z - d], [x + hw, y + EXIT_H, z + d], MAT.glow, { tint: EXIT_GLOW });
  mb.box([x - hw, y + 0.004, z - d], [x + hw, y + 0.004 + t, z + d], MAT.glow, { tint: EXIT_GLOW });
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
  const ink: Vec3 = [0.55, 0.55, 0.56];
  const STEP = 2;
  for (let i = -14; i <= 14; i++) {
    for (let j = -14; j <= 14; j++) {
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
    env: { ambient: [0.62, 0.62, 0.62], fog: [0.86, 0.86, 0.86], fogDensity: 0.06, light: 0.12, decay: 0, haze: 0 },
    center: [ox, oy, oz],
    radius: 30,
    anchors: exit ? [[exit[0], exit[1] + 1.2, exit[2]]] : [],
    spots,
    exit,
  };
}

const BUILDERS: Partial<Record<PocketKind, PocketBuilder>> = { void: buildVoid, meadow: buildMeadow, dollhouse: buildDollhouse };

/** Подключить строителя пространства (луг и кукольный домик лежат в своих файлах). */
export function registerPocket(kind: PocketKind, builder: PocketBuilder): void {
  BUILDERS[kind] = builder;
}

/**
 * Собрать пространство. Неподключённый вид заменяется белым нигде. Выход обводится красным светом
 * здесь, одинаково для всех: если строитель не назвал выход, им считается первый якорь (дверная
 * коробка на лугу).
 */
export function buildPocket(kind: PocketKind, seed: number, origin: Vec3, ctx?: PocketContext): PocketSpace {
  const p = (BUILDERS[kind] ?? buildVoid)(seed, origin, ctx);
  const a = p.anchors[0];
  const exit = p.exit !== undefined ? p.exit : a && !ctx?.limbo ? ([a[0], origin[1], a[2]] as Vec3) : null;
  if (exit) {
    const mb = new MeshBuilder();
    exitOutline(mb, exit);
    p.meshes.push(mb.build());
  }
  return { ...p, exit, focus: p.focus ?? null };
}
