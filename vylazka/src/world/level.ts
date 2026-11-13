/** Собранный уровень: геометрия чанками, коллайдеры и игровые точки. Общий тип для генератора и тестового уровня. */
import type { Vec3 } from '../core/types';
import type { GenLayout } from '../gen/layout';
import type { ColliderSet } from './colliders';
import type { MeshData } from './kit';

/** Кусок геометрии, рисуемый одним вызовом. Ярусы — чтобы не рисовать этажи, которых не видно. */
export interface LevelChunk {
  mesh: MeshData;
  tierMin: number;
  tierMax: number;
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
  nav: NavNode[];
  /** План, по которому собран уровень (у тестового уровня его нет). */
  layout: GenLayout | null;
}
