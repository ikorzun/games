/** Собранный уровень: геометрия чанками, коллайдеры и игровые точки. Общий тип для генератора и тестового уровня. */
import type { GrowthStats } from './wear_growth';
import type { Vec3 } from '../core/types';
import type { GrassSite } from '../systems/grass';
import type { GenLayout, WorldKind } from '../gen/layout';
import type { Aabb, ColliderSet } from './colliders';
import type { FlatMark } from './flat';
import type { MeshData, SheetMark } from './kit';
import type { Perch } from '../systems/birds';
import type { FreeSlot, LevelObject } from './objects';
import type { EdgePoints } from './edges';
import type { FigureSpot, PlaceWorld } from './figure_place';
import type { PlacedSpot } from './placed_place';

/** Кусок геометрии, рисуемый одним вызовом. Ярусы — чтобы не рисовать этажи, которых не видно. */
export interface LevelChunk {
  mesh: MeshData;
  tierMin: number;
  tierMax: number;
  /** Имя чанка, по которому игра может показать или скрыть его (обвал, вариант комнаты). */
  id?: string;
  /** Чанк с именем изначально скрыт. */
  hidden?: boolean;
  /** Проекции этого куска: картинки из света (world/flat.ts). Рисуются отдельно — без тени и без точек. */
  slides?: MeshData;
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
  /** Карточки от руки на стенах (signs.ts, вид card): по ним проверки и отладка находят записку. */
  notes?: SheetMark[];
  /** Плоские вещи: картонки и проекции (у тестового уровня их нет). */
  flats?: FlatMark[];
  /**
   * Предметы обстановки как объекты (world/objects.ts): номер объекта стоит в вершинах сетки и на
   * преградах. По ним игра растворяет то, чего коснулся игрок. Нет — растворять нечего.
   */
  objects?: LevelObject[];
  /** Свободные участки стен: туда растворённая вещь может вернуться «в другом месте». */
  freeSlots?: FreeSlot[];
  /** План, по которому собран уровень (у тестового уровня его нет). */
  layout: GenLayout | null;
  /** Какой это мир (не задано — убежище): от него зависят свет, запущенность и воспоминания. */
  world?: WorldKind;
  /** Стёртость места 0..1, с которой уровень собран (systems/decay.ts). Нет поля — место помнится целиком. */
  wear?: number;
  /** Своё стирание места (world/wear_growth.ts): сколько выросло рубца и коконов. Для тестов и отладки. */
  growth?: GrowthStats;
  /**
   * Помещение без потолка: над ним звёздное небо (слова партнёра: «там нет потолка, только бесконечно
   * глубокое звездное небо и изредка падают звезды»). Нет поля — такого помещения на уровне нет.
   */
  skyRoom?: number;
  /** Оранжерея (world/furnish_greenhouse.ts): номер помещения; нет поля — в этом месте её нет. */
  greenRoom?: number;
  /**
   * Головки её цветов (systems/flowers.ts): где, куда смотрят в покое, форма, размер, поворот вокруг оси и объект, на котором
   * растут (растворился — головки нет). Стебли и листья — в сетках помещений.
   */
  /** Трава, проросшая сквозь пол одного помещения (systems/grass.ts): плитки по полу; нет — травы нет. */
  grass?: GrassSite[];
  /** Помещение, где проросла трава (design.md, §36). */
  grassRoom?: number;
  /**
   * Вытоптанные круги в траве у дверей помещения с травой: x, пол, z, радиус (render: шейдер травы, GRASS). Круги вокруг вещей на
   * полу игра добавляет сама — где вещь лежит сейчас (systems/grass.ts, clearings). Нет — травы нет.
   */
  grassClear?: [number, number, number, number][];
  blooms?: { pos: Vec3; dir: Vec3; form: number; size: number; spin: number; obj: number }[];
  /** Высота потолка каждого помещения над его полом, м (номер помещения → высота). */
  ceilings?: Record<number, number>;
  /**
   * Зал ожидания: стеклянная крыша — её прямоугольник в мире (minX, minZ, maxX, maxZ, по внутренним
   * граням стен) и высота переплёта, м. По нему рендер считает тень балок без карты теней.
   */
  roof?: { box: [number, number, number, number]; y: number };
  /** Где под крышей садятся птицы (systems/birds.ts): точки на затяжках переплёта. Нет — птиц под крышей нет. */
  perches?: Perch[];
  /** Тихий слой: точки по рёбрам и углам стен (world/edges.ts). Нет — у уровня его нет (тестовый, карман). */
  edges?: EdgePoints;
  /** Фигуры партнёра, вставшие на уровне по своим правилам (world/figure_place.ts). Нет — ни одной. */
  figures?: FigureSpot[];
  /** Вещи партнёра, где они встали (world/placed_place.ts). */
  placed?: PlacedSpot[];
  /** То, по чему расставляются фигуры и вещи; только по просьбе (BuildOptions.keepPlaceWorld). */
  placeWorld?: PlaceWorld;
}
