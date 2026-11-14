/** Собранный уровень: геометрия чанками, коллайдеры и игровые точки. Общий тип для генератора и тестового уровня. */
import type { Vec3 } from '../core/types';
import type { GenLayout } from '../gen/layout';
import type { Aabb, ColliderSet } from './colliders';
import type { MeshData, SheetMark } from './kit';

/** Кусок геометрии, рисуемый одним вызовом. Ярусы — чтобы не рисовать этажи, которых не видно. */
export interface LevelChunk {
  mesh: MeshData;
  tierMin: number;
  tierMax: number;
  /** Имя чанка, по которому игра может показать или скрыть его (обвал, вариант комнаты). */
  id?: string;
  /** Чанк с именем изначально скрыт. */
  hidden?: boolean;
}

/**
 * Комната с двумя вариантами обстановки (аномалия «изменилась, пока не смотрел»).
 * У каждого варианта свой чанк и своя группа коллайдеров; стены, пол и двери общие.
 */
export interface RoomVariant {
  room: number;
  tier: number;
  center: Vec3;
  chunkA: string;
  chunkB: string;
  groupA: string;
  groupB: string;
}

/** Зона среды: вода замедляет и глушит фонарь, газ душит, провал убивает. */
export interface Zone {
  kind: 'water' | 'gas' | 'pit';
  tier: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Обвал, который может засыпать клетку коридора за спиной игрока. */
export interface CollapseSpec {
  /** id скрытого чанка с завалом. */
  id: string;
  tier: number;
  center: Vec3;
  /** Преграды, которые появятся вместе с завалом. */
  boxes: Aabb[];
}

/** Место, куда можно положить находку или батарейку. */
export interface ItemSpot {
  x: number;
  y: number;
  z: number;
  room: number;
  tier: number;
  kind: 'table' | 'shelf' | 'floor';
}

/** Приметный объект, который можно «снять на камеру» как цель вылазки. */
export interface Landmark {
  /** Что это: diesel, fvu, tank, panel, map, radio, safe, cabinet, archive… */
  id: string;
  x: number;
  y: number;
  z: number;
  room: number;
  tier: number;
}

/** Узел навигации: клетка уровня. */
export interface NavNode {
  id: number;
  tier: number;
  cx: number;
  cz: number;
  x: number;
  y: number;
  z: number;
  room: number;
  links: number[];
}

/** Лестница между ярусами: центры верхней и нижней площадок. Нужна рендеру, чтобы знать, когда виден соседний ярус. */
export interface StairLink {
  upperTier: number;
  top: Vec3;
  bottom: Vec3;
}

export interface BuiltLevel {
  chunks: LevelChunk[];
  stairs: StairLink[];
  colliders: ColliderSet;
  spawn: { pos: Vec3; yaw: number };
  /** Где заканчивается вылазка (лестница на поверхность). */
  exit: Vec3;
  spots: ItemSpot[];
  landmarks: Landmark[];
  zones: Zone[];
  collapses: CollapseSpec[];
  variants: RoomVariant[];
  nav: NavNode[];
  /** Где висят листы-картинки: плакаты и планы убежища (только в видимых с самого начала частях уровня). */
  sheets: SheetMark[];
  /** План, по которому собран уровень (у тестового уровня его нет). */
  layout: GenLayout | null;
}
