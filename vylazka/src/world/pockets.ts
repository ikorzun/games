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
}

/** Убежище: темно, даль чёрная. decay и haze игра считает по глубине сама. */
export const ENV_BUNKER: Env = { ambient: [0.0016, 0.0019, 0.0024], fog: [0, 0, 0], fogDensity: 0.035, light: 1, decay: 0.25, haze: 0.008 };

export type PocketKind = 'void' | 'meadow' | 'dollhouse';
export const POCKET_KINDS: readonly PocketKind[] = ['void', 'meadow', 'dollhouse'];

export interface PocketSpace {
  kind: PocketKind;
  /** Геометрия в мировых координатах (уже сдвинута на origin). */
  meshes: MeshData[];
  colliders: Aabb[];
  spawn: { pos: Vec3; yaw: number };
  env: Env;
  /** Центр и радиус: уйти от центра дальше радиуса — значит выйти из пространства. */
  center: Vec3;
  radius: number;
  /** Точки-якоря: если долго смотреть на якорь, пространство отпускает (дверной проём на лугу). */
  anchors: Vec3[];
  /** Места на полу, куда игра может положить вещи. */
  spots: Vec3[];
}

export type PocketBuilder = (seed: number, origin: Vec3) => PocketSpace;

/**
 * Белое нигде: ровный белый пол без краёв и горизонта. Чтобы было видно, что идёшь, пол размечен
 * редкими серыми крестиками — как сетка пустой сцены в редакторе. Здесь же лимбо между сессиями.
 */
export function buildVoid(_seed: number, origin: Vec3): PocketSpace {
  const [ox, oy, oz] = origin;
  const mb = new MeshBuilder();
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
    anchors: [],
    spots,
  };
}

const BUILDERS: Partial<Record<PocketKind, PocketBuilder>> = { void: buildVoid, meadow: buildMeadow, dollhouse: buildDollhouse };

/** Подключить строителя пространства (луг и кукольный домик лежат в своих файлах). */
export function registerPocket(kind: PocketKind, builder: PocketBuilder): void {
  BUILDERS[kind] = builder;
}

/** Собрать пространство. Неподключённый вид заменяется белым нигде. */
export function buildPocket(kind: PocketKind, seed: number, origin: Vec3): PocketSpace {
  return (BUILDERS[kind] ?? buildVoid)(seed, origin);
}
