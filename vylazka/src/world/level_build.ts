/**
 * Сборка уровня из плана генератора: скорлупа по ярусам, лестничные марши, двери, обстановка,
 * места для находок, приметные объекты и навигационный граф. Чистый TS: работает в тестах и в Worker.
 */
import { applyTilt, isTilted, tiltMark } from './tilt';
import type { Perch } from '../systems/birds';
import { hash01, hash2, mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { CEIL_H, DX, DZ, GRID, STAIR_CELLS, TIER_DROP } from '../gen/layout';
import type { GenLayout, GenRoom, RoomType, WorldKind } from '../gen/layout';
import { mossCushion } from './moss';
import { ColliderSet } from './colliders';
import type { FlatMark } from './flat';
import { decayAt } from '../systems/decay';
import { doorSign, dropBuried, furnishRoom, roomOpenness } from './furnish';
import { furnishExtras, GARDEN_H, NO_EXTRAS } from './furnish_extras';
import { furnishPapers, newPaperState } from './furnish_papers';
import { growWear } from './wear_growth';
import { NOTE_ID, ROOM_LABEL, SIGN } from './signs';
import type { CellInfo, RoomCtx, Slot } from './furnish';
import { opennessNow, withOpenMode } from './furniture';
import { MeshBuilder } from './kit';
import type { SheetMark } from './kit';
import type { BuiltLevel, CollapseSpec, ItemSpot, Landmark, LevelChunk, NavNode, RoomVariant, StairLink, Zone } from './level';
import { CEIL_TILE, MAT } from './materials';
import { hermoDoor, stairsDown, Xf } from './props';
import { doorFrame, doorLeaf, collapse, pit, warningSign, waterSheet } from './props_bunker';
import { ALL_PROPS, withSwap } from './props_all';
import type { PropSwap, SwapTo } from './props_all';
import { ObjectLog, withGrowthGuard } from './objects';
import { grows } from './clearance';
import { DOOR_IMAGE, SCREEN_IMAGES } from './screens';
import type { FreeSlot } from './objects';
import { buildShell, CELL, Shell, STYLE_CORRIDOR, WALL_T } from './shell';
import { EdgeBuilder } from './edges';
import { placeFigures } from './figure_place';
import type { FigureSpec } from './figures';
import { FIGURES } from './figures_data';
import { fitMoved, NEVER, placedSeed, placeThings, rests, roomIndex } from './placed_place';
import type { PlacedSpot } from './placed_place';
import type { PlacedSpec, RemovedSpec } from './placed';
import { swapFits } from './placed';
import { PLACED, REMOVED } from './placed_data';
import type { ShellCell, WallStyle } from './shell';
import { inVariant, slotFor, variantPicker } from './variants';

const HALF = GRID / 2;
/** Клетка сетки → координата её центра в мире. */
export const cellToWorld = (c: number): number => (c - HALF) * CELL;
/** На сколько затяжка переплёта висит ниже верха крыши зала ожидания, м. */
export const TIE_DROP = 0.84;
export const tierFloor = (tier: number): number => -TIER_DROP * tier;

/**
 * Марш: 30 ступеней по 0,15 × 0,30 м на три клетки длины. Десять ступеней — ровно клетка по
 * горизонтали и 1,5 м по высоте, период рисунка грязи на стенах: сдвиг игрока на десять ступеней
 * не виден. На этом стоит аномалия «лестница длиннее, чем должна быть».
 */
export const STAIR_STEPS = 30;
export const STAIR_RISE = TIER_DROP / STAIR_STEPS;
export const STAIR_RUN = (STAIR_CELLS * CELL) / STAIR_STEPS;

const ROOM_STYLE: Partial<Record<RoomType, Partial<WallStyle>>> = {
  dorm: { lower: MAT.paintOchre, stripe: MAT.rubber, paintHeight: 1.35 },
  command: { lower: MAT.wood, lowerTint: [0.75, 0.7, 0.62], stripe: MAT.rubber, paintHeight: 1.1 },
  // Медпункт и санузел — в кафеле до плеча, на полу мелкая плитка.
  medical: { lower: MAT.tile, lowerTint: [0.95, 0.97, 0.95], stripe: MAT.paintGreen, paintHeight: 1.6, floor: MAT.tileFloor, floorTint: [0.9, 0.9, 0.9] },
  washroom: { lower: MAT.tile, lowerTint: [0.82, 0.9, 0.9], stripe: MAT.paintBlue, paintHeight: 1.8, floor: MAT.tileFloor, floorTint: [0.8, 0.8, 0.8] },
  // Кладовые сложены из кирпича и никогда не красились.
  storage: { lower: MAT.brick, lowerTint: [0.85, 0.85, 0.85], upper: MAT.brick, upperTint: [1.05, 1.05, 1.05], stripe: MAT.brick, paintHeight: 1.0 },
  fvu: { lower: MAT.paintGreen, lowerTint: [0.8, 0.85, 0.8], paintHeight: 1.7 },
  diesel: { lower: MAT.paintGreen, lowerTint: [0.62, 0.66, 0.55], stripe: MAT.paintRed, paintHeight: 1.2, floor: MAT.tileFloor, floorTint: [0.75, 0.75, 0.75] },
  tanks: { lower: MAT.paintBlue, lowerTint: [0.75, 0.8, 0.8], paintHeight: 1.0, floor: MAT.wetConcrete, floorTint: [0.85, 0.85, 0.85] },
  switchboard: { lower: MAT.paintOchre, lowerTint: [0.85, 0.85, 0.85], stripe: MAT.paintRed, paintHeight: 1.5 },
  archive: { lower: MAT.wood, lowerTint: [0.6, 0.55, 0.5], paintHeight: 1.2 },
  collapsed: { lower: MAT.brick, upper: MAT.concrete, stripe: MAT.brick, lowerTint: [0.7, 0.7, 0.7], upperTint: [0.7, 0.7, 0.7], paintHeight: 1.4 },
  entrance: { lower: MAT.concrete, lowerTint: [0.75, 0.75, 0.72], upper: MAT.concrete, upperTint: [0.9, 0.9, 0.87], paintHeight: 1.2 },
  airlock: { lower: MAT.paintGreen, lowerTint: [0.7, 0.75, 0.62], paintHeight: 1.6 },
  // Дом, вросший в убежище: обои на всю высоту стены (полоса и верх — те же обои) и паркет вместо бетона.
  // Оттенки у комнат разные, всё пастельное.
  living: { lower: MAT.wallpaper, lowerTint: [1.12, 0.88, 0.86], upper: MAT.wallpaper, upperTint: [1.1, 0.9, 0.88], stripe: MAT.wallpaper, paintHeight: 2.2, floor: MAT.parquet, floorTint: [0.95, 0.8, 0.65] },
  bedroom: { lower: MAT.wallpaper, lowerTint: [0.86, 0.95, 1.12], upper: MAT.wallpaper, upperTint: [0.88, 0.96, 1.1], stripe: MAT.wallpaper, paintHeight: 2.2, floor: MAT.parquet, floorTint: [0.85, 0.75, 0.65] },
  nursery: { lower: MAT.wallpaper, lowerTint: [1.12, 1.12, 0.78], upper: MAT.wallpaper, upperTint: [1.1, 1.1, 0.82], stripe: MAT.wallpaper, paintHeight: 2.2, floor: MAT.linoleum, floorTint: [1.05, 0.9, 0.72] },
  hallway: { lower: MAT.wallpaper, lowerTint: [0.98, 0.84, 0.68], upper: MAT.wallpaper, upperTint: [1.0, 0.88, 0.74], stripe: MAT.wallpaper, paintHeight: 2.0, floor: MAT.linoleum, floorTint: [0.78, 0.62, 0.5] },
  // Ванная светлее санузла убежища: белёсая плитка до потолка, на полу плитка посветлее.
  bathroom: { lower: MAT.tile, lowerTint: [1.08, 1.14, 1.16], upper: MAT.tile, upperTint: [1.05, 1.1, 1.12], stripe: MAT.tile, paintHeight: 2.2, floor: MAT.tileFloor, floorTint: [1.35, 1.45, 1.55] },
  // Кухня: крашеный низ, побелка сверху, на полу плитка.
  kitchen: { lower: MAT.paintGreen, lowerTint: [1.45, 1.5, 1.3], stripe: MAT.paintGreen, paintHeight: 1.5, floor: MAT.tileFloor, floorTint: [1.0, 1.0, 0.95] },
};

/** Коридоры ярусов красят по-разному; чем глубже, тем темнее и грязнее. */
const TIER_CORRIDOR: readonly Partial<WallStyle>[] = [
  {},
  { lower: MAT.paintBlue, lowerTint: [0.75, 0.78, 0.8], upperTint: [0.82, 0.8, 0.76], ceilTint: [0.7, 0.68, 0.64], floorTint: [0.72, 0.72, 0.72] },
  { lower: MAT.concrete, lowerTint: [0.55, 0.57, 0.55], upper: MAT.concrete, upperTint: [0.72, 0.72, 0.7], stripe: MAT.rust, ceil: MAT.concrete, ceilTint: [0.6, 0.6, 0.58], floor: MAT.wetConcrete, floorTint: [0.95, 0.95, 0.95] },
];

/**
 * Офис: белые стены с серым плинтусом, светлый глянцевый пол, потолок из плит. Отличаются только
 * полы: в отделе и кабинете — ковролин, в комнате отдыха и туалете — плитка.
 */
const OFFICE_STYLE: WallStyle = {
  lower: MAT.enamel,
  lowerTint: [0.6, 0.62, 0.65],
  stripe: MAT.metalGrey,
  // Стены — гладкие и матовые, как бумага: у побелки убежища разводы, а здесь их быть не должно.
  upper: MAT.paper,
  upperTint: [1.36, 1.4, 1.52],
  floor: MAT.enamel,
  floorTint: [0.82, 0.85, 0.88],
  ceil: MAT.ceilTile,
  ceilTint: [1.1, 1.1, 1.08],
  paintHeight: 0.12,
};
const OFFICE_ROOMS: Partial<Record<RoomType, Partial<WallStyle>>> = {
  department: { floor: MAT.carpet, floorTint: [0.42, 0.95, 0.78] },
  cubicles: { floor: MAT.carpet, floorTint: [0.75, 0.85, 1.05] },
  meeting: { floor: MAT.carpet, floorTint: [0.9, 0.9, 0.95] },
  manager: { floor: MAT.parquet, floorTint: [0.9, 0.85, 0.8], upperTint: [1.34, 1.34, 1.36] },
  breakroom: { floor: MAT.tileFloor, floorTint: [1.5, 1.6, 1.7] },
  washroom: { lower: MAT.tile, lowerTint: [1.1, 1.14, 1.16], stripe: MAT.tile, upper: MAT.tile, upperTint: [1.1, 1.14, 1.16], paintHeight: 2.2, floor: MAT.tileFloor, floorTint: [1.4, 1.5, 1.6] },
  server: { floor: MAT.linoleum, floorTint: [0.7, 0.75, 0.9], upperTint: [1.16, 1.24, 1.44] },
  files: { floor: MAT.linoleum, floorTint: [1.0, 1.0, 1.0] },
  copyroom: { floor: MAT.linoleum, floorTint: [1.0, 1.0, 1.0] },
};

/**
 * Жёлтые комнаты: тот же план под жёлтыми обоями от пола до потолка; ковролин цвета мокрого песка,
 * потолочные плиты в разводах. Все помещения одинаковы — назначения у них больше нет.
 */
const YELLOW_STYLE: WallStyle = {
  lower: MAT.wallpaper,
  lowerTint: [1.3, 1.12, 0.5],
  stripe: MAT.wallpaper,
  upper: MAT.wallpaper,
  upperTint: [1.3, 1.12, 0.5],
  floor: MAT.carpet,
  floorTint: [1.5, 1.22, 0.62],
  ceil: MAT.ceilTile,
  ceilTint: [1.12, 1.04, 0.74],
  paintHeight: 1.4,
};
const YELLOW_ROOMS: Partial<Record<RoomType, Partial<WallStyle>>> = {
  washroom: { lower: MAT.tile, lowerTint: [1.1, 1.05, 0.8], stripe: MAT.tile, upper: MAT.tile, upperTint: [1.1, 1.05, 0.8], paintHeight: 2.2, floor: MAT.tileFloor, floorTint: [1.3, 1.2, 0.9] },
};

/**
 * Зал ожидания: светлый камень и кремовая штукатурка; в малых комнатах — своё (касса в дереве, камеры
 * хранения в зелёной краске, буфет в кафеле); переходы к перрону — тёмные, в плитке; перрон — кирпич
 * и бетон.
 */
const STATION_STYLE: WallStyle = {
  lower: MAT.plaster,
  lowerTint: [1.02, 0.98, 0.86],
  stripe: MAT.wood,
  upper: MAT.plaster,
  upperTint: [1.2, 1.17, 1.06],
  floor: MAT.tile,
  floorTint: [0.9, 0.88, 0.82],
  ceil: MAT.plaster,
  ceilTint: [1.15, 1.13, 1.05],
  paintHeight: 1.5,
};
const STATION_ROOMS: Partial<Record<RoomType, Partial<WallStyle>>> = {
  concourse: { paintHeight: 1.9 },
  tickets: { lower: MAT.wood, lowerTint: [0.7, 0.6, 0.5], paintHeight: 1.2, floor: MAT.parquet, floorTint: [0.9, 0.8, 0.7] },
  lockers: { lower: MAT.paintGreen, lowerTint: [0.82, 0.9, 0.84], paintHeight: 1.7, floor: MAT.linoleum, floorTint: [0.85, 0.9, 0.85] },
  buffet: { lower: MAT.tile, lowerTint: [1.1, 1.06, 0.92], stripe: MAT.tile, paintHeight: 1.6 },
  washroom: { lower: MAT.tile, lowerTint: [0.95, 1.0, 1.0], stripe: MAT.tile, upper: MAT.tile, upperTint: [0.95, 1.0, 1.0], paintHeight: 2.2 },
  storage: { lower: MAT.brick, lowerTint: [0.9, 0.88, 0.85], upper: MAT.brick, upperTint: [1.0, 1.0, 1.0], stripe: MAT.brick, floor: MAT.concrete, floorTint: [0.8, 0.8, 0.78] },
  corridor: { lower: MAT.tile, lowerTint: [0.62, 0.68, 0.64], stripe: MAT.tile, upper: MAT.plaster, upperTint: [0.72, 0.72, 0.68], paintHeight: 1.8, floor: MAT.concrete, floorTint: [0.7, 0.7, 0.68] },
  platform: { lower: MAT.brick, lowerTint: [0.95, 0.9, 0.85], upper: MAT.brick, upperTint: [1.05, 1.0, 0.95], stripe: MAT.brick, floor: MAT.concrete, floorTint: [0.95, 0.94, 0.9], ceil: MAT.wood, ceilTint: [0.6, 0.55, 0.5] },
  track: { lower: MAT.brick, lowerTint: [0.55, 0.52, 0.5], upper: MAT.brick, upperTint: [0.6, 0.57, 0.55], stripe: MAT.brick },
};
/** Высота потолка в помещениях зала ожидания: простор зала и теснота переходов — половина его ощущения. */
const STATION_CEIL: Partial<Record<RoomType, number>> = { concourse: 6.3, corridor: 2.5, platform: 3.6, track: 5.2, vestibule: 3.2 };
/** Пути: насколько они ниже перрона и на сколько от его края начинается пустота, м. */
const TRACK_DROP = 1.2;

/** Шаг плиток подвесного потолка у места, м (0 — потолок цельный): стирание выбивает такой потолок плитками. */
export function ceilTileOf(world: WorldKind): number {
  const st = world === 'office' ? OFFICE_STYLE : world === 'yellow' ? YELLOW_STYLE : world === 'station' ? STATION_STYLE : STYLE_CORRIDOR;
  return st.ceil === MAT.ceilTile ? CEIL_TILE : 0;
}

function styleFor(room: GenRoom, world: WorldKind): WallStyle {
  if (world === 'office') return { ...OFFICE_STYLE, ...(OFFICE_ROOMS[room.type] ?? {}) };
  if (world === 'station') return { ...STATION_STYLE, ...(STATION_ROOMS[room.type] ?? {}) };
  if (world === 'yellow') return { ...YELLOW_STYLE, ...(YELLOW_ROOMS[room.type] ?? {}) };
  const dark = room.tier === 2 ? 0.82 : room.tier === 1 ? 0.92 : 1;
  const base: WallStyle = { ...STYLE_CORRIDOR, ...(TIER_CORRIDOR[room.tier] ?? {}) };
  // Шахта лестницы — голый бетон без линии покраски: на стенах нет ничего, что выдало бы высоту.
  const well: Partial<WallStyle> = { lower: MAT.concrete, upper: MAT.concrete, stripe: MAT.concrete, lowerTint: [0.72, 0.72, 0.7], upperTint: [0.72, 0.72, 0.7] };
  const own = room.type === 'corridor' ? {} : room.type === 'stairwell' ? well : (ROOM_STYLE[room.type] ?? {});
  const st: WallStyle = { ...base, ...own };
  const mul = (t: Vec3): Vec3 => [t[0] * dark, t[1] * dark, t[2] * dark];
  return { ...st, lowerTint: mul(st.lowerTint), upperTint: mul(st.upperTint), floorTint: mul(st.floorTint), ceilTint: mul(st.ceilTint) };
}

interface ChunkBuild {
  mb: MeshBuilder;
  /** Проекции этого куска — картинки из света; отдельная сетка. */
  sl: MeshBuilder;
  tierMin: number;
  tierMax: number;
  id?: string;
  hidden?: boolean;
}

/** Помещения нижнего яруса, которые могут «меняться за спиной». */
const VARIANT_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>(['dorm', 'storage', 'archive', 'washroom']);

/** Поворот размещения, при котором локальная ось +z смотрит по направлению dir. */
const ROT_FACING: readonly (0 | 1 | 2 | 3)[] = [1, 0, 3, 2];
/** Сторона дыры провала, м: по краям коридора остаются карнизы по 0,7 м. */
export const PIT_HOLE = 1.3;
const PIT_DEPTH = 1.6;
/** Смещение навигационного узла от центра клетки с провалом — на середину карниза. */
const PIT_LEDGE = 0.95;

/** Как собирать уровень. */
export interface BuildOptions {
  /**
   * Стёртость места 0..1 (systems/decay.ts): то же место, пройденное в который раз. От неё зависит то,
   * что решается при сборке: сколько вещей стоит картонками, сколько берёз проросло, какой выросла гора.
   * (Что стёрто у отдельных предметов, стен и потолка, решает игра — геометрия от этого не меняется.)
   */
  wear?: number;
  /** Фигуры партнёра (world/figures_data.ts); не задано — те, что стоят в игре. */
  figures?: readonly FigureSpec[];
  /** Вещи партнёра (world/placed_data.ts); не задано — те, что стоят в игре. */
  placed?: readonly PlacedSpec[];
  /** Вещи игры, которые партнёр убрал (world/placed_data.ts, REMOVED); не задано — те, что убраны в игре. */
  removed?: readonly RemovedSpec[];
  /**
   * Отдать в уровне то, по чему расставляются фигуры и вещи (скорлупа ярусов, преграды, начало места): нужно
   * конструктору (tools/constructor) и тестам. Игре не нужно — уровень идёт к ней из Worker, а скорлупа
   * при пересылке теряет методы.
   */
  keepPlaceWorld?: boolean;
}

/** Передвинутая вещь игры, которую сборка не поставила, где собиралась: запись, помещение, точка и сид той вещи. */
interface MovedCall {
  spec: PlacedSpec;
  room: GenRoom;
  xf: Xf;
  seed: number;
  /** Доля открытого там, где её поставила игра (у проёма — 0): с ней она строится, если места по правилу нет. */
  share: number;
}

/**
 * Что сборка делает с вещами игры по записям партнёра (world/placed.ts) — хук сборки (world/props_all.ts, withSwap).
 *
 * Хук видит каждую вещь обстановки, которая становится объектом уровня (картонки — тоже), находит её помещение по клетке и
 * ярусу точки и считает: эта вещь — nth-я такая в этом помещении (с нуля, по порядку сборки; считаются все, в том числе
 * заменённые, убранные и передвинутые, — номера устойчивы и совпадают с тем, как их считает конструктор, placed_place.ts,
 * gameNth). Дальше по порядку:
 * - убрана (RemovedSpec: эта вещь, этот номер, место и тип помещения подходят) — не строится;
 * - передвинута (PlacedSpec с moves) — не строится здесь: сборка запоминает её и после всей обстановки ставит по правилу
 *   записи в том же помещении (buildLevelInner, moveSpot); в комнате-аномалии и там, где вещи не ставят, не двигается;
 * - заменена (PlacedSpec с replaces) — на её месте вещь партнёра, по порядку сборки, не больше count на место (замена «везде» —
 *   каждая такая во всех помещениях и местах, после замен «здесь»); если вещь
 *   партнёра не встаёт на её место (swapFits), остаётся вещь игры. Картонку не заменяют.
 * Записей для этого места нет — хука нет: уровень собирается ровно как без них.
 */
interface GameEdits {
  hook: PropSwap;
  /** Передвинутые: заполняет хук во время сборки обстановки. */
  moved: MovedCall[];
  /** Помещения, где вещи игры не двигают (комната-аномалия, нижние части шахт): задаёт сборка до обстановки. */
  still: Set<number>;
}

function editsFor(layout: GenLayout, placed: readonly PlacedSpec[], removed: readonly RemovedSpec[], pick: (room: GenRoom) => string | null): GameEdits | null {
  const here = (worlds: readonly WorldKind[]): boolean => worlds.includes(layout.world);
  // Замена «везде» (everywhere) — во всех местах и помещениях, каждая; замены «здесь» идут первыми: в своих помещениях они важнее.
  const swaps = placed
    .filter((s) => s.replaces && !s.moves && (s.everywhere === true || here(s.rule.worlds)) && ALL_PROPS[s.prop] && ALL_PROPS[s.replaces] && swapFits(ALL_PROPS[s.replaces]!, ALL_PROPS[s.prop]!))
    .sort((a, b) => Number(a.everywhere === true) - Number(b.everywhere === true));
  const moves = placed.filter((s) => s.moves && !s.replaces && s.moves.thing === s.prop && ALL_PROPS[s.prop] && here(s.rule.worlds));
  const gone = removed.filter((r) => here(r.worlds) && ALL_PROPS[r.what.thing]);
  if (swaps.length + moves.length + gone.length === 0) return null;
  const roomAt = roomIndex(layout);
  // Вариант расстановки (world/variants.ts): запись варианта действует только там, где он выпал; запись без варианта — везде,
  // кроме вещи игры, которую выпавший вариант двигает или убирает сам.
  const ownTarget = (chosen: string | null, name: string, nth: number): boolean =>
    chosen !== null &&
    (gone.some((r) => slotFor(r.slot, r.rooms) === chosen && r.what.thing === name && r.what.nth === nth) ||
      moves.some((s) => slotFor(s.slot, s.rule.rooms) === chosen && s.moves!.thing === name && s.moves!.nth === nth));
  const fitsRoom = (rooms: readonly string[], room: GenRoom): boolean => rooms.length === 0 || rooms.includes(room.type);
  let chosenRoom: GenRoom | null = null;
  let chosen: string | null = null;
  const variantOk = (slot: string | undefined, room: GenRoom, name?: string, nth?: number): boolean => {
    if (chosenRoom !== room) {
      chosenRoom = room;
      chosen = pick(room);
    }
    if (slot !== undefined) return slot === chosen;
    return name === undefined || !ownTarget(chosen, name, nth ?? 0);
  };
  /** Сколько вещей каждого имени уже встретилось в помещении: «номер помещения:имя». */
  const seen = new Map<string, number>();
  const used = new Map<string, number>();
  const edits: GameEdits = { hook: () => null, moved: [], still: new Set() };
  const hook: PropSwap = (name, xf, seed, flat = false) => {
    const room = roomAt(xf.ox, xf.oy, xf.oz);
    if (!room) return null;
    const key = `${room.id}:${name}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    if (gone.some((r) => r.what.thing === name && r.what.nth === nth && fitsRoom(r.rooms, room) && variantOk(slotFor(r.slot, r.rooms), room, name, nth))) return '';
    if (!edits.still.has(room.id) && !NEVER.has(room.type)) {
      const m = moves.find((s) => s.moves!.thing === name && s.moves!.nth === nth && fitsRoom(s.rule.rooms, room) && variantOk(slotFor(s.slot, s.rule.rooms), room, name, nth));
      if (m) {
        edits.moved.push({ spec: m, room, xf, seed, share: opennessNow() });
        return '';
      }
    }
    if (flat) return null;
    // Дверцы по записи (квиз 18.11): закрыто или открыто всё; нет — как выпадет, с долей помещения.
    const to = (s: PlacedSpec): string | SwapTo => (s.open || isTilted(s.tilt) ? { prop: s.prop, ...(s.open ? { open: s.open } : {}), ...(isTilted(s.tilt) ? { tilt: s.tilt } : {}) } : s.prop);
    for (const s of swaps) {
      if (s.replaces !== name) continue;
      if (s.everywhere === true) return to(s);
      if (!fitsRoom(s.rule.rooms, room) || !variantOk(slotFor(s.slot, s.rule.rooms), room)) continue;
      const n = used.get(s.id) ?? 0;
      if (n >= s.rule.count) continue;
      used.set(s.id, n + 1);
      return to(s);
    }
    return null;
  };
  // Проба места стопки у стены откатывается целиком — и счёт хука тоже (props_all.ts, PropSwap.save).
  hook.save = () => ({ seen: new Map(seen), used: new Map(used), moved: edits.moved.length });
  hook.load = (state) => {
    const st = state as { seen: Map<string, number>; used: Map<string, number>; moved: number };
    seen.clear();
    for (const [k, v] of st.seen) seen.set(k, v);
    used.clear();
    for (const [k, v] of st.used) used.set(k, v);
    edits.moved.length = st.moved;
  };
  edits.hook = hook;
  return edits;
}

export function buildLevel(layout: GenLayout, opts: BuildOptions = {}): BuiltLevel {
  const placed = opts.placed ?? PLACED;
  const removed = opts.removed ?? REMOVED;
  const figures = opts.figures ?? FIGURES;
  // Варианты расстановки (world/variants.ts): какой из вариантов партнёра достался каждому помещению этого уровня.
  const here = (worlds: readonly WorldKind[]): boolean => worlds.includes(layout.world);
  const pick = variantPicker(layout, [
    ...placed.filter((s) => here(s.rule.worlds)).map((s) => slotFor(s.slot, s.rule.rooms)),
    ...removed.filter((r) => here(r.worlds)).map((r) => slotFor(r.slot, r.rooms)),
    ...figures.filter((f) => here(f.rule.worlds)).map((f) => slotFor(f.slot, f.rule.rooms)),
  ]);
  const edits = editsFor(layout, placed, removed, pick);
  // Мебель не врастает в соседнюю (партнёр 18.11; world/clearance.ts): проверка — на всю обстановку уровня.
  return withSwap(edits?.hook ?? null, () => withGrowthGuard(grows, () => buildLevelInner(layout, opts, edits, pick)));
}

function buildLevelInner(layout: GenLayout, opts: BuildOptions, edits: GameEdits | null, pick: (room: GenRoom) => string | null): BuiltLevel {
  const decay = decayAt(opts.wear ?? 0);
  const col = new ColliderSet();
  const chunks = new Map<string, ChunkBuild>();
  // Журнал объектов — один на уровень: у каждого предмета обстановки свой номер, где бы он ни стоял.
  const objects = new ObjectLog();
  const freeSlots: FreeSlot[] = [];
  const T = WALL_T / 2;

  // Какая из двух лестничных клеток верхняя: та, чей ярус совпадает с верхним ярусом марша.
  const upperWells = new Set<number>();
  const lowerWells = new Set<number>();
  for (const room of layout.rooms) {
    if (room.type !== 'stairwell') continue;
    const [x, z] = room.cells[0]!;
    const st = layout.stairs.find((s) => s.cx + DX[s.dir]! === x && s.cz + DZ[s.dir]! === z && (s.upperTier === room.tier || s.upperTier + 1 === room.tier));
    if (st && st.upperTier === room.tier) upperWells.add(room.id);
    else lowerWells.add(room.id);
  }

  const chunkFor = (room: GenRoom, cx: number, cz: number): ChunkBuild => {
    // Помещение — один чанк; длинные коридоры режутся блоками 4×4 клетки, чтобы отсекаться частями.
    const key = room.type === 'corridor' ? `${room.id}:${cx >> 2}:${cz >> 2}` : `${room.id}`;
    let c = chunks.get(key);
    if (!c) {
      const well = room.type === 'stairwell';
      c = { mb: new MeshBuilder(), sl: new MeshBuilder(), tierMin: well ? room.tier - (lowerWells.has(room.id) ? 1 : 0) : room.tier, tierMax: well ? room.tier + (upperWells.has(room.id) ? 1 : 0) : room.tier };
      c.mb.log = objects;
      chunks.set(key, c);
    }
    return c;
  };

  const hz = layout.hazards;
  const pitAt = new Set(hz.pits.map((p) => `${p.tier},${p.x},${p.z}`));
  // Комната-аномалия: одно помещение нижнего яруса получает два варианта обстановки (ниже, «Обстановка»).
  const lastTier = layout.tierCount - 1;
  const variantRoom =
    layout.rank >= 2 && lastTier >= 2
      ? layout.rooms.filter((r) => r.tier === lastTier && VARIANT_ROOMS.has(r.type) && r.cells.length >= 2 && !hz.gasRooms.includes(r.id)).sort((a, b) => b.cells.length - a.cells.length || a.id - b.id)[0]
      : undefined;
  // Вещи игры партнёр не двигает там, где обстановка меняется за спиной (комната-аномалия), и там, где её нет (низ шахты).
  if (edits) for (const id of [...lowerWells, ...(variantRoom ? [variantRoom.id] : [])]) edits.still.add(id);

  // ── Помещения под то, что стоит поверх обычной обстановки (world/furnish_extras.ts) ──
  // Выбор — по сиду уровня, а не по ГСЧ помещений: остальная обстановка от него не сдвигается.
  const entrance = layout.rooms[layout.entranceRoom]!;
  const hazardRoom = new Set<number>(hz.gasRooms);
  const cellRoom = new Map<string, number>();
  for (const r of layout.rooms) for (const [x, z] of r.cells) cellRoom.set(`${r.tier},${x},${z}`, r.id);
  for (const c of [...hz.pits, ...hz.water, ...hz.collapses]) {
    const id = cellRoom.get(`${c.tier},${c.x},${c.z}`);
    if (id !== undefined) hazardRoom.add(id);
  }
  const plain = layout.rooms.filter((r) => r !== entrance && r.type !== 'stairwell' && r.type !== 'lift' && r.type !== 'entrance' && r.type !== 'airlock' && r.type !== 'track' && !hazardRoom.has(r.id));
  const station = layout.world === 'station';
  const order = (salt: number) => (a: GenRoom, b: GenRoom): number => hash01(a.id * 17 + 3, salt, layout.seed ^ 0xe87a) - hash01(b.id * 17 + 3, salt, layout.seed ^ 0xe87a);
  const rooms1 = plain.filter((r) => r.type !== 'corridor' && r.type !== 'department' && r.type !== 'collapsed');
  // Сад под потолком: одно помещение верхнего яруса из четырёх клеток и больше — потолок в нём выше.
  // В зале ожидания потолки свои (STATION_CEIL), сада нет; цветы — только в комнатах с обычным потолком.
  const gardenRoom = station ? undefined : rooms1.filter((r) => r.tier === entrance.tier && r.cells.length >= 4).sort(order(1))[0];
  const flowerRooms = new Set(rooms1.filter((r) => r !== gardenRoom && r.cells.length >= 2 && (!station || r.type === 'lockers' || r.type === 'buffet')).sort(order(2)).slice(0, 2).map((r) => r.id));
  // Небо вместо потолка (слова партнёра: «в какой момент игрок заходит в одну из комнат или помещение
  // и там нет потолка, только бесконечно глубокое звездное небо и изредка падают звезды»): одно
  // помещение уровня — жилая комната убежища, кабинет офиса, зал жёлтых комнат; не сад и не комната
  // с цветами. В зале ожидания небо и так открыто: там звёзды проступают к вечеру.
  const SKY_TYPES: readonly RoomType[] = ['bedroom', 'nursery', 'living', 'hallway', 'kitchen', 'dorm', 'meeting', 'manager', 'files', 'copyroom', 'hall'];
  const skyRoom = station ? undefined : rooms1.filter((r) => r !== gardenRoom && !flowerRooms.has(r.id) && r.cells.length >= 2 && SKY_TYPES.includes(r.type)).sort(order(7))[0];
  /** Высота потолка помещения над полом. */
  const ceilOf = (room: GenRoom): number => (room === gardenRoom ? GARDEN_H : station ? (STATION_CEIL[room.type] ?? CEIL_H) : CEIL_H);

  // ── Скорлупа по ярусам ──
  const shells: Shell[] = [];
  for (let t = 0; t < layout.tierCount; t++) shells.push(new Shell());
  const world = layout.world;
  for (const room of layout.rooms) {
    const style = styleFor(room, world);
    const y = tierFloor(room.tier);
    for (const [x, z] of room.cells) {
      // Архитектура здесь условна (слова партнёра: «ты можешь менять потолок в комнатах»): в саду он выше.
      const cell: ShellCell = { cx: x - HALF, cz: z - HALF, floorY: y, ceilY: y + ceilOf(room), room: room.id, style };
      if (pitAt.has(`${room.tier},${x},${z}`)) cell.noFloor = true;
      // Зал ожидания: над залом стеклянная крыша (потолка нет, только балки), над путями — небо, под ними — пустота.
      if (station && (room.type === 'concourse' || room.type === 'track')) cell.noCeil = true;
      if (station && room.type === 'track') cell.noFloor = true;
      if (room === skyRoom) cell.noCeil = true;
      if (upperWells.has(room.id)) cell.noFloor = true;
      else if (lowerWells.has(room.id)) {
        // Нижняя часть шахты марша тянется до пола верхнего яруса и открыта вверх.
        cell.ceilY = y + TIER_DROP;
        cell.noCeil = true;
      }
      shells[room.tier]!.add(cell);
    }
  }
  for (const e of layout.edges) {
    const sh = shells[e.tier]!;
    if (e.kind === 'open') sh.setOpen(e.cx - HALF, e.cz - HALF, e.dir);
    else sh.setDoor(e.cx - HALF, e.cz - HALF, e.dir);
  }
  const roomById = (id: number): GenRoom => layout.rooms[id]!;
  for (const sh of shells) buildShell(sh, (c) => chunkFor(roomById(c.room), c.cx + HALF, c.cz + HALF).mb, col);
  // Тихий слой: точки по рёбрам и углам той же разметки — план держится, даже когда стены не собраны.
  const edgeBuild = new EdgeBuilder(layout.seed);
  shells.forEach((sh, tier) => edgeBuild.addShell(sh, tier));
  const edges = edgeBuild.build();

  // ── Лестничные марши ──
  for (const s of layout.stairs) {
    const well = layout.rooms.find((r) => upperWells.has(r.id) && r.tier === s.upperTier && r.cells[0]![0] === s.cx + DX[s.dir]! && r.cells[0]![1] === s.cz + DZ[s.dir]!)!;
    const c = chunkFor(well, 0, 0);
    // Марш спускается вдоль локальной оси −x; начало — середина ребра между площадкой и первой клеткой марша.
    const rot = ([2, 1, 0, 3] as const)[s.dir]!;
    const ox = cellToWorld(s.cx) + DX[s.dir]! * (CELL / 2);
    const oz = cellToWorld(s.cz) + DZ[s.dir]! * (CELL / 2);
    stairsDown(new Xf(c.mb, col, ox, tierFloor(s.upperTier), oz, rot), STAIR_STEPS, STAIR_RISE, STAIR_RUN, -CELL / 2 + T, CELL / 2 - T);
  }

  // ── Двери ──
  // В игре двери не открывают: проём либо пуст (коробка осталась), либо створка распахнута, либо
  // сорвана — прислонена к стене рядом или лежит на полу за проёмом.
  const hazardCells = new Set([...hz.pits, ...hz.water, ...hz.collapses].map((c) => `${c.tier},${c.x},${c.z}`));
  /** Участки стен у дверей, занятые прислонённой створкой: обстановка их пропускает. */
  const blockedSlots = new Set<string>();
  const gridAt = (tier: number, x: number, z: number): GenRoom | undefined => {
    const c = shells[tier]!.get(x - HALF, z - HALF);
    return c ? roomById(c.room) : undefined;
  };
  for (const e of layout.edges) {
    if (e.kind === 'open') continue;
    const a = gridAt(e.tier, e.cx, e.cz)!;
    const bx = e.cx + (e.dir === 0 ? 1 : 0);
    const bz = e.cz + (e.dir === 1 ? 1 : 0);
    const b = gridAt(e.tier, bx, bz)!;
    // Створка открывается внутрь помещения, чтобы не перегораживать коридор.
    const intoB = b.type !== 'corridor';
    const toward = e.dir === 0 ? (intoB ? 0 : 2) : intoB ? 1 : 3;
    const host = intoB ? b : a;
    const hostCell: [number, number] = intoB ? [bx, bz] : [e.cx, e.cz];
    const wx = cellToWorld(e.cx) + (e.dir === 0 ? CELL / 2 : 0);
    const wz = cellToWorld(e.cz) + (e.dir === 1 ? CELL / 2 : 0);
    const y = tierFloor(e.tier);
    const xf = new Xf(chunkFor(host, hostCell[0], hostCell[1]).mb, col, wx, y, wz, ROT_FACING[toward]!);
    if (e.kind === 'hermo') hermoDoor(xf);
    else {
      // В офисе коробки и створки белые, и ни одна дверь не сорвана: либо пустой проём, либо створка распахнута.
      const office = world === 'office';
      const tint: Vec3 = office ? [0.92, 0.94, 0.97] : host.type === 'medical' ? [1.5, 1.5, 1.45] : [0.9 + ((host.id * 7) % 5) * 0.05, 0.85, 0.8];
      const doorMat = office ? MAT.enamel : MAT.wood;
      doorFrame(xf, tint, doorMat);
      // Шахта лестницы и клетки с опасностями остаются как есть: створка распахнута.
      const plain = a.type === 'stairwell' || b.type === 'stairwell' || hazardCells.has(`${e.tier},${hostCell[0]},${hostCell[1]}`) || hazardCells.has(`${e.tier},${e.cx},${e.cz}`) || hazardCells.has(`${e.tier},${bx},${bz}`);
      const roll = plain ? 0.35 : hash01(e.cx * 64 + e.cz, e.dir + 2 * e.tier, layout.seed ^ 0xd00d);
      const h = office ? roll * 0.64 : roll;
      const seed = Math.floor(hash01(e.cz * 64 + e.cx, e.tier, layout.seed ^ 0xbeef) * 1e6);
      let lean = h >= 0.65 && h < 0.85;
      let side: 1 | -1 = hash2(e.cx, e.cz, layout.seed ^ e.dir) & 1 ? 1 : -1;
      if (lean) {
        // Прислонить можно к глухому участку той же стены; у одноклеточных помещений стену не отнимаем.
        const ax = xf.pt(1, 0, 0);
        const dirPlus = Math.abs(ax[0] - xf.ox) > 0.5 ? (ax[0] > xf.ox ? 0 : 2) : ax[2] > xf.oz ? 1 : 3;
        const hsx = hostCell[0] - HALF;
        const hsz = hostCell[1] - HALF;
        const wallAt = (sd: 1 | -1): boolean => shells[e.tier]!.edge(hsx, hsz, sd === 1 ? dirPlus : (dirPlus + 2) % 4) === 'wall';
        if (host.cells.length < 2) lean = false;
        else if (!wallAt(side)) {
          side = side === 1 ? -1 : 1;
          if (!wallAt(side)) lean = false;
        }
        if (lean) {
          blockedSlots.add(`${e.tier},${hostCell[0]},${hostCell[1]},${side === 1 ? dirPlus : (dirPlus + 2) % 4}`);
        }
      }
      if (h < 0.35) {
        // Только коробка.
      } else if (h < 0.65 || (h < 0.85 && !lean)) doorLeaf(xf, tint, doorMat);
      else if (lean) {
        // Створка сорвана и прислонена к стене у проёма: от косяка до угла остаётся не меньше 0,9 м прохода.
        ALL_PROPS.door_leaf_lean!.build(xf.child(side * 0.9, 0, 0.17), seed);
      } else {
        // Лежит на полу сразу за проёмом, плашмя: перешагнуть можно, преграды нет.
        ALL_PROPS.door_leaf_down!.build(xf.child(0, 0, 1.4), seed);
      }
    }
    // Табличка над дверью со стороны, противоположной створке.
    const other = intoB ? a : b;
    const otherCell: [number, number] = intoB ? [e.cx, e.cz] : [bx, bz];
    const back = ((toward + 2) % 4) as 0 | 1 | 2 | 3;
    const outer = new Xf(chunkFor(other, otherCell[0], otherCell[1]).mb, null, wx + DX[back]! * T, y, wz + DZ[back]! * T, ROT_FACING[back]!);
    doorSign(outer.child(0, 2.32, 0));
    // Трафарет справа от двери: что за ней. У гермодвери слева — предупреждение.
    const label = ROOM_LABEL[host.type];
    const ink: Vec3 = e.tier === 2 ? [0.82, 0.8, 0.76] : host.id % 3 === 0 ? [0.1, 0.1, 0.1] : [0.6, 0.11, 0.08];
    if (label && other.type !== 'stairwell') {
      const w = Math.min(SIGN[label]!.w, 0.74);
      outer.sign(label, 0.72 + w / 2, 1.52, w, ink);
    }
    if (e.kind === 'hermo' && other.type !== 'stairwell') {
      outer.sign('attention', -1.05, 1.66, 0.44, [0.6, 0.11, 0.08]);
      outer.sign('door_sector', -1.05, 1.52, 0.66, [0.6, 0.11, 0.08]);
    }
  }

  // ── Опасности среды ──
  const zones: Zone[] = [];
  const collapses: CollapseSpec[] = [];
  const roomOf = (tier: number, x: number, z: number): GenRoom => gridAt(tier, x, z)!;
  for (const p of hz.pits) {
    const room = roomOf(p.tier, p.x, p.z);
    const y = tierFloor(p.tier);
    const wx = cellToWorld(p.x);
    const wz = cellToWorld(p.z);
    const st = styleFor(room, world);
    pit(new Xf(chunkFor(room, p.x, p.z).mb, col, wx, y, wz, 0), CELL, PIT_HOLE, PIT_DEPTH, st.floor, st.floorTint);
    zones.push({ kind: 'pit', tier: p.tier, minX: wx - PIT_HOLE / 2, maxX: wx + PIT_HOLE / 2, minZ: wz - PIT_HOLE / 2, maxZ: wz + PIT_HOLE / 2, minY: y - PIT_DEPTH - 1, maxY: y - 0.7 });
  }
  // ── Зал ожидания: балки стеклянной крыши над залом, пути за краем перрона ──
  let roof: BuiltLevel['roof'];
  const perches: Perch[] = [];
  if (station) {
    // Прямоугольник крыши — клетки зала по внутренним граням стен; переплёт висит чуть ниже её верха.
    const hall = layout.rooms.filter((r) => r.type === 'concourse').flatMap((r) => r.cells.map(([x, z]) => [cellToWorld(x), cellToWorld(z), tierFloor(r.tier)] as const));
    if (hall.length > 0) {
      const W = WALL_T / 2;
      roof = {
        box: [Math.min(...hall.map((c) => c[0])) - CELL / 2 + W, Math.min(...hall.map((c) => c[1])) - CELL / 2 + W, Math.max(...hall.map((c) => c[0])) + CELL / 2 - W, Math.max(...hall.map((c) => c[1])) + CELL / 2 - W],
        y: hall[0]![2] + STATION_CEIL.concourse! - 0.15,
      };
    }
    for (const room of layout.rooms) {
      const y = tierFloor(room.tier);
      for (const [x, z] of room.cells) {
        const wx = cellToWorld(x);
        const wz = cellToWorld(z);
        const xf = new Xf(chunkFor(room, x, z).mb, null, wx, y, wz, 0);
        if (room.type === 'concourse') {
          // Переплёт крыши: балка поперёк зала над каждой клеткой и два прогона вдоль. От них на полу
          // лежит решётка теней — по ней видно, как идёт время.
          const top = STATION_CEIL.concourse!;
          xf.box([-CELL / 2, top - 0.32, -0.1], [CELL / 2, top - 0.02, 0.1], MAT.metalGreen, { tint: [0.5, 0.56, 0.52] });
          for (const px of [-0.75, 0.75]) xf.box([px - 0.045, top - 0.2, -CELL / 2], [px + 0.045, top - 0.08, CELL / 2], MAT.metalGreen, { tint: [0.5, 0.56, 0.52] });
          // Затяжка под каждой балкой: тонкий стальной прут поперёк зала. На затяжках сидят голуби
          // (systems/birds.ts) — на самих балках под стеклом им не поместиться.
          xf.box([-CELL / 2, top - TIE_DROP - 0.03, -0.015], [CELL / 2, top - TIE_DROP, 0.015], MAT.steel, { tint: [0.42, 0.45, 0.44] });
          for (const px of [-0.9, 0, 0.9]) perches.push({ pos: [wx + px, y + top - TIE_DROP, wz], yaw: (x + z) % 2 === 0 ? 0 : Math.PI });
        } else if (room.type === 'track') {
          // Пути лежат ниже перрона: балласт, шпалы, два рельса. Преград у них нет: за краем перрона
          // игрок падает, и падение его будит (зона ниже).
          xf.box([-CELL / 2, -TRACK_DROP - 0.1, -CELL / 2], [CELL / 2, -TRACK_DROP, CELL / 2], MAT.dirt, { tint: [0.42, 0.4, 0.38] });
          for (let i = 0; i < 5; i++) {
            const sx = -1.2 + i * 0.6;
            xf.box([sx - 0.11, -TRACK_DROP, -1.05], [sx + 0.11, -TRACK_DROP + 0.07, 1.05], MAT.wood, { tint: [0.45, 0.38, 0.32] });
          }
          for (const rz of [-0.72, 0.72]) xf.box([-CELL / 2, -TRACK_DROP + 0.07, rz - 0.035], [CELL / 2, -TRACK_DROP + 0.2, rz + 0.035], MAT.steel, { tint: [0.8, 0.8, 0.82] });
          // Стенки ямы: скорлупа строит стены от пола, а пути лежат ниже — без стенок под дальней стеной
          // и под кромкой перрона видно «ничто». Дальняя стена и торцы — закопчённый кирпич, кромка — бетон.
          const sh = shells[room.tier]!;
          const W = WALL_T / 2;
          for (let dir = 0; dir < 4; dir++) {
            const other = sh.get(x - HALF + DX[dir]!, z - HALF + DZ[dir]!);
            if (other && roomById(other.room).type === 'track') continue;
            const edge = !!other;
            const mat = edge ? MAT.concrete : MAT.brick;
            const tint: Vec3 = edge ? [0.6, 0.58, 0.55] : [0.4, 0.38, 0.37];
            const d = edge ? 0.06 : W;
            const lo = -TRACK_DROP - 0.1;
            if (dir === 0) xf.box([CELL / 2 - d, lo, -CELL / 2], [CELL / 2, 0, CELL / 2], mat, { tint });
            else if (dir === 2) xf.box([-CELL / 2, lo, -CELL / 2], [-CELL / 2 + d, 0, CELL / 2], mat, { tint });
            else if (dir === 1) xf.box([-CELL / 2, lo, CELL / 2 - d], [CELL / 2, 0, CELL / 2], mat, { tint });
            else xf.box([-CELL / 2, lo, -CELL / 2], [CELL / 2, 0, -CELL / 2 + d], mat, { tint });
            // Белая линия вдоль кромки перрона: дальше нельзя — это понятно без слов.
            if (edge) {
              const a = 0.42;
              const b = 0.54;
              if (dir === 0) xf.box([CELL / 2 + a, 0, -CELL / 2], [CELL / 2 + b, 0.012, CELL / 2], MAT.enamel, { tint: [0.86, 0.85, 0.8] });
              else if (dir === 2) xf.box([-CELL / 2 - b, 0, -CELL / 2], [-CELL / 2 - a, 0.012, CELL / 2], MAT.enamel, { tint: [0.86, 0.85, 0.8] });
              else if (dir === 1) xf.box([-CELL / 2, 0, CELL / 2 + a], [CELL / 2, 0.012, CELL / 2 + b], MAT.enamel, { tint: [0.86, 0.85, 0.8] });
              else xf.box([-CELL / 2, 0, -CELL / 2 - b], [CELL / 2, 0.012, -CELL / 2 - a], MAT.enamel, { tint: [0.86, 0.85, 0.8] });
            }
          }
          zones.push({ kind: 'pit', tier: room.tier, minX: wx - CELL / 2, maxX: wx + CELL / 2, minZ: wz - CELL / 2, maxZ: wz + CELL / 2, minY: y - 40, maxY: y - 0.8 });
        }
      }
    }
  }
  for (const w of hz.water) {
    const room = roomOf(w.tier, w.x, w.z);
    const y = tierFloor(w.tier);
    const wx = cellToWorld(w.x);
    const wz = cellToWorld(w.z);
    waterSheet(new Xf(chunkFor(room, w.x, w.z).mb, null, wx, y, wz, 0), CELL);
    // У воды растёт мох: три кочки на клетку, у её краёв. Место — от сида уровня, общий счётчик случайных
    // чисел не тратится: остальная обстановка от мха не сдвигается.
    for (let i = 0; i < 3; i++) {
      const hx = hash01(w.x * 7 + i, w.z * 13 + 1, layout.seed ^ 0x6d055);
      const hz2 = hash01(w.x * 11 + 2, w.z * 5 + i, layout.seed ^ 0x6d055);
      const side = i % 2 === 0 ? 1 : -1;
      const ox = i === 2 ? side * (CELL / 2 - 0.45) : (hx - 0.5) * (CELL - 0.9);
      const oz = i === 2 ? (hz2 - 0.5) * (CELL - 0.9) : side * (CELL / 2 - 0.45);
      mossCushion(new Xf(chunkFor(room, w.x, w.z).mb, null, wx + ox, y + 0.04, wz + oz, 0), Math.floor(hx * 1e6) + i, 0.16 + 0.12 * hz2);
    }
    zones.push({ kind: 'water', tier: w.tier, minX: wx - CELL / 2, maxX: wx + CELL / 2, minZ: wz - CELL / 2, maxZ: wz + CELL / 2, minY: y - 0.2, maxY: y + 1 });
  }
  for (const id of hz.gasRooms) {
    const room = roomById(id);
    const y = tierFloor(room.tier);
    for (const [x, z] of room.cells) {
      const wx = cellToWorld(x);
      const wz = cellToWorld(z);
      zones.push({ kind: 'gas', tier: room.tier, minX: wx - CELL / 2 + T, maxX: wx + CELL / 2 - T, minZ: wz - CELL / 2 + T, maxZ: wz + CELL / 2 - T, minY: y - 0.2, maxY: y + CEIL_H });
    }
    // Знак у каждой двери помещения со стороны коридора.
    for (const e of layout.edges) {
      if (e.tier !== room.tier || e.kind === 'open') continue;
      const bx = e.cx + (e.dir === 0 ? 1 : 0);
      const bz = e.cz + (e.dir === 1 ? 1 : 0);
      const aIn = roomOf(e.tier, e.cx, e.cz).id === id;
      const bIn = roomOf(e.tier, bx, bz).id === id;
      if (aIn === bIn) continue;
      // Нормаль от стены в сторону коридора.
      const out = e.dir === 0 ? (aIn ? 0 : 2) : aIn ? 1 : 3;
      const host = aIn ? roomOf(e.tier, bx, bz) : roomOf(e.tier, e.cx, e.cz);
      const hostCell: [number, number] = aIn ? [bx, bz] : [e.cx, e.cz];
      const wx = cellToWorld(e.cx) + (e.dir === 0 ? CELL / 2 : 0) + DX[out]! * T;
      const wz = cellToWorld(e.cz) + (e.dir === 1 ? CELL / 2 : 0) + DZ[out]! * T;
      const xf = new Xf(chunkFor(host, hostCell[0], hostCell[1]).mb, null, wx, y + 1.5, wz, ROT_FACING[out]!);
      warningSign(xf.child(0.9, 0, 0));
    }
  }
  hz.collapses.forEach((c, i) => {
    const y = tierFloor(c.tier);
    const wx = cellToWorld(c.x);
    const wz = cellToWorld(c.z);
    // Завал лежит отдельным скрытым чанком; его преграды попадут в мир в момент обрушения.
    const mb = new MeshBuilder();
    const tmp = new ColliderSet();
    // Клетка-перемычка: проход идёт вдоль той оси, где есть коридорные соседи.
    const alongX = gridAt(c.tier, c.x + 1, c.z) !== undefined && gridAt(c.tier, c.x - 1, c.z) !== undefined;
    for (const rot of alongX ? ([1, 3] as const) : ([0, 2] as const)) collapse(new Xf(mb, tmp, wx, y, wz, rot), CEIL_H, c.x * 53 + c.z * 29 + rot);
    const id = `collapse:${i}`;
    chunks.set(id, { mb, sl: new MeshBuilder(), tierMin: c.tier, tierMax: c.tier, id, hidden: true });
    collapses.push({ id, tier: c.tier, center: [wx, y, wz], boxes: tmp.boxes.slice() });
  });

  // ── Обстановка ──
  // У провала, в воде и под будущим завалом у стен пусто: там нужен проход по карнизу.
  const spots: ItemSpot[] = [];
  const landmarks: Landmark[] = [];
  const flats: FlatMark[] = [];
  // Комната-аномалия (variantRoom, выбрана выше): два варианта обстановки. Находок и целей в ней нет — иначе после
  // подмены они повисли бы в воздухе.
  const variants: RoomVariant[] = [];

  // Откуда начинается вылазка: рядом с началом обманок не ставим.
  const startRoom = layout.rooms[layout.entranceRoom]!;
  const start = { cx: startRoom.cells[0]![0], cz: startRoom.cells[0]![1], tier: startRoom.tier };
  // Экраны жёлтых комнат: ровно два на уровень — в ближнем к началу зале и в самом дальнем от него.
  // Это решает сборка уровня, а не помещение: помещение о соседях не знает.
  const screenQuota = new Map<number, number[]>();
  if (world === 'yellow') {
    const far = (r: GenRoom): number => Math.min(...r.cells.map(([x, z]) => Math.abs(x - start.cx) + Math.abs(z - start.cz)));
    const rooms = layout.rooms.filter((r) => !lowerWells.has(r.id) && r.type !== 'stairwell' && r.type !== 'lift');
    const halls = rooms.filter((r) => r.type === 'hall');
    const open = rooms.filter((r) => r.type !== 'corridor');
    const pool = (halls.length > 0 ? halls : open.length > 0 ? open : rooms).slice().sort((a, b) => far(a) - far(b) || a.id - b.id);
    // На ближнем — то же, что на экранах офиса (природа или «странное»). Дальний — не картинка, а проём
    // (решение партнёра: два экрана — «соединение смысла и пространств»): на нём луг, и в него входят.
    const shown = SCREEN_IMAGES.map((im, i) => (im.kind === 'nature' || im.kind === 'strange' ? i : -1)).filter((i) => i >= 0);
    const first = Math.floor(hash01(layout.seed & 0xffff, 0x5c, layout.seed ^ 0x2e11) * shown.length);
    const images = [shown[first]!, DOOR_IMAGE];
    (pool.length > 0 ? [pool[0]!, pool[pool.length - 1]!] : []).forEach((r, k) => screenQuota.set(r.id, [...(screenQuota.get(r.id) ?? []), images[k]!]));
  }
  /** Слоты и клетки помещения; геометрия идёт в mbFor (вещество и проекции), преграды — в colSet. */
  const roomCtx = (room: GenRoom, mbFor: (x: number, z: number) => { mb: MeshBuilder; sl: MeshBuilder }, colSet: ColliderSet, salt: number, outSpots: ItemSpot[], outMarks: Landmark[], outFlats: FlatMark[]): RoomCtx => {
    const sh = shells[room.tier]!;
    const y = tierFloor(room.tier);
    const slots: Slot[] = [];
    const cells: CellInfo[] = [];
    for (const [x, z] of room.cells) {
      const { mb, sl } = mbFor(x, z);
      const sx = x - HALF;
      const sz = z - HALF;
      const kinds = [0, 1, 2, 3].map((d) => sh.edge(sx, sz, d));
      const neighbours = [0, 1, 2, 3].map((d) => sh.get(sx + DX[d]!, sz + DZ[d]!));
      // Проходом считается дверь или открытое ребро в другое помещение.
      const doors = kinds.filter((k, d) => k === 'door' || (k === 'open' && neighbours[d] !== undefined && neighbours[d]!.room !== room.id)).length;
      cells.push({ cx: x, cz: z, xf: new Xf(mb, colSet, cellToWorld(x), y, cellToWorld(z), 0, sl), doors });
      const hazard = hazardCells.has(`${room.tier},${x},${z}`);
      for (let d = 0; d < 4; d++) {
        if (kinds[d] !== 'wall') continue;
        const inward = ((d + 2) % 4) as 0 | 1 | 2 | 3;
        const rot = ROT_FACING[inward]!;
        const xf = new Xf(mb, colSet, cellToWorld(x) + DX[d]! * (CELL / 2 - T), y, cellToWorld(z) + DZ[d]! * (CELL / 2 - T), rot, sl);
        // Локальная ось +x слота в мире и концы стены: есть ли там перпендикулярная стена или проход.
        const ax = xf.pt(1, 0, 0);
        const along = Math.abs(ax[0] - xf.ox) > 0.5 ? (ax[0] > xf.ox ? 0 : 2) : ax[2] > xf.oz ? 1 : 3;
        const kR = kinds[along]!;
        const kL = kinds[(along + 2) % 4]!;
        slots.push({ xf, cx: x, cz: z, dir: d, hazard, deep: doors === 0 && room.type !== 'corridor', cornerR: kR === 'wall' || kR === 'door', cornerL: kL === 'wall' || kL === 'door', used: blockedSlots.has(`${room.tier},${x},${z},${d}`) });
      }
    }
    // Свой ГСЧ у каждого помещения: правка одной комнаты не сдвигает остальные.
    return { room, world, seed: layout.seed, start, rng: mulberry32(hash2(layout.seed, room.id, 0xf00d + salt)), h: ceilOf(room), slots, cells, spots: outSpots, landmarks: outMarks, flats: outFlats, decay, ...(screenQuota.has(room.id) ? { screens: screenQuota.get(room.id)! } : {}), ...(room === skyRoom ? { sky: true } : {}) };
  };

  // Карточка от руки «please use only when necessary»: одна на уровень, в помещении рядом с началом —
  // не в самом начале, куда возвращает Осыпь (там она читалась бы укором), а на шаг дальше.
  const notes: SheetMark[] = [];
  const noteRoom = layout.rooms
    .filter((r) => r !== startRoom && r !== variantRoom && !lowerWells.has(r.id) && r.tier === startRoom.tier && r.type !== 'stairwell' && r.type !== 'lift' && r.type !== 'track')
    .map((r) => ({ r, d: Math.min(...r.cells.map(([x, z]) => Math.abs(x - start.cx) + Math.abs(z - start.cz))) }))
    .sort((a, b) => a.d - b.d || a.r.id - b.r.id)[0]?.r;

  const furnished: { room: GenRoom; ctx: RoomCtx }[] = [];
  // Бумага и чемоданы считаются на уровень: одна стена лиц, одна стена чемоданов (world/furnish_papers.ts).
  const paperState = newPaperState(world);
  for (const room of layout.rooms) {
    if (lowerWells.has(room.id)) continue;
    if (room !== variantRoom) {
      const ctx = roomCtx(room, (x, z) => chunkFor(room, x, z), col, 0, spots, landmarks, flats);
      ctx.paperState = paperState;
      furnishRoom(ctx);
      if (room === noteRoom) {
        // На свободном участке стены, ближайшем к началу; нет свободного — на любом, сбоку от того, что там висит.
        const near = (s: Slot): number => Math.abs(s.cx - start.cx) + Math.abs(s.cz - start.cz);
        const free = ctx.slots.filter((s) => !s.hazard && !s.used).sort((a, b) => near(a) - near(b))[0];
        const any = free ?? ctx.slots.filter((s) => !s.hazard).sort((a, b) => near(a) - near(b))[0];
        if (any) {
          // Место под карточкой больше не свободно: вещь, вернувшаяся «у другой стены», её не закроет.
          any.used = true;
          const x = free ? 0 : 1.05;
          const w = SIGN[NOTE_ID]!.w;
          const h = (w * SIGN[NOTE_ID]!.ph) / SIGN[NOTE_ID]!.pw;
          any.xf.sign(NOTE_ID, x, 1.34, w);
          const o = any.xf.pt(0, 0, 0);
          const f = any.xf.pt(0, 0, 1);
          notes.push({ id: NOTE_ID, at: any.xf.pt(x, 1.34 + h / 2, 0.005), n: [f[0] - o[0], f[1] - o[1], f[2] - o[2]] });
        }
      }
      // Что осталось пустым у глухих стен — запасные места: туда вещь может вернуться после темноты.
      furnished.push({ room, ctx });
      continue;
    }
    // Два варианта: обстановка каждого — в своём чанке и своей группе коллайдеров.
    const names = ['a', 'b'] as const;
    const ids = names.map((n) => `variant:${room.id}:${n}`);
    names.forEach((_, i) => {
      const mb = new MeshBuilder();
      mb.log = objects;
      const sl = new MeshBuilder();
      const tmp = new ColliderSet();
      const first = objects.list.length;
      // Плоские вещи варианта в общий список не идут: после подмены их там уже нет.
      furnishRoom(roomCtx(room, () => ({ mb, sl }), tmp, i * 7919, [], [], []));
      // Предметы варианта помнят его группу: пока вариант скрыт, их нет и коснуться их нельзя.
      for (let k = first; k < objects.list.length; k++) objects.list[k]!.group = ids[i]!;
      chunks.set(ids[i]!, { mb, sl, tierMin: room.tier, tierMax: room.tier, id: ids[i]!, hidden: i === 1 });
      for (const b of tmp.boxes) col.add({ ...b, group: ids[i]!, off: i === 1 });
    });
    let cx = 0;
    let cz = 0;
    for (const [x, z] of room.cells) {
      cx += cellToWorld(x);
      cz += cellToWorld(z);
    }
    variants.push({ room: room.id, tier: room.tier, center: [cx / room.cells.length, tierFloor(room.tier), cz / room.cells.length], chunkA: ids[0]!, chunkB: ids[1]!, groupA: ids[0]!, groupB: ids[1]! });
  }

  // ── Поверх обычной обстановки: гора у начала вылазки, цветы, наклейки, завал (world/furnish_extras.ts) ──
  // Гора стоит в ближайшем к началу помещении того же яруса, где для неё нашлось место (не в коридоре:
  // там она перегородила бы путь). Поэтому помещения обходятся от начала вдаль.
  const fromStart = (r: GenRoom): number => Math.min(...r.cells.map(([x, z]) => Math.abs(x - start.cx) + Math.abs(z - start.cz)));
  let moundLeft = decay.mound;
  for (const { room, ctx } of furnished.slice().sort((a, b) => fromStart(a.room) - fromStart(b.room) || a.room.id - b.room.id)) {
    if (moundLeft === 0) break;
    if (room === startRoom || room.tier !== startRoom.tier || room.type === 'corridor' || room.type === 'stairwell' || room.type === 'lift' || room.type === 'track') continue;
    if (furnishExtras(ctx, { ...NO_EXTRAS, mound: moundLeft }).mound) moundLeft = 0;
  }
  // Цветы: сад под высоким потолком и ещё два помещения.
  for (const { room, ctx } of furnished) {
    if (room !== gardenRoom && !flowerRooms.has(room.id)) continue;
    furnishExtras(ctx, { ...NO_EXTRAS, garden: room === gardenRoom, flowers: flowerRooms.has(room.id) ? 1 + (room.cells.length >= 4 ? 1 : 0) : 0 });
  }
  // Наклейки и завал: помещения перебираются по сиду, пока не встанет сколько нужно.
  const ranked = (salt: number): { room: GenRoom; ctx: RoomCtx }[] => furnished.filter((f) => plain.includes(f.room) && f.room !== gardenRoom).sort((a, b) => order(salt)(a.room, b.room));
  let stickersLeft = world === 'yellow' ? 2 : 4;
  for (const { ctx } of ranked(3)) {
    if (stickersLeft <= 0) break;
    stickersLeft -= furnishExtras(ctx, { ...NO_EXTRAS, stickers: Math.min(2, stickersLeft) }).stickers;
  }
  for (const { room, ctx } of ranked(4)) {
    if (room.type === 'corridor' || room.type === 'department' || room.type === 'collapsed' || room.cells.length < 3 || flowerRooms.has(room.id)) continue;
    if (furnishExtras(ctx, { ...NO_EXTRAS, thicket: true }).thicket) break;
  }
  // Бумага и чемоданы (world/furnish_papers.ts): листы на щитах, в рамах и на потолке, стена чемоданов.
  // Последним проходом и своим сидом — номера и места прежних объектов от них не сдвигаются.
  furnishPapers(paperState, furnished);
  // Своё стирание места (world/wear_growth.ts): рубец по стыку стены с потолком в убежище, щит с коконами
  // в кассе и буфете зала ожидания. Тоже последним проходом и своим сидом: обстановка от них не сдвигается.
  const growth = growWear(world, layout.seed, decay.wear, furnished, start);
  // Фигуры партнёра (world/figure_place.ts): последними, по уже стоящей обстановке — чтобы не врасти в
  // мебель. Сеток в уровень не добавляют: фигура — отдельная вещь рендера (game.ts).
  const ent0 = layout.rooms[layout.entranceRoom]!;
  const placeWorld = {
    layout,
    shells,
    col,
    skip: new Set([...lowerWells, ...(variantRoom ? [variantRoom.id] : [])]),
    spawn: [cellToWorld(ent0.cells[0]![0]), tierFloor(ent0.tier), cellToWorld(ent0.cells[0]![1]) + 0.4] as Vec3,
    spawnTier: ent0.tier,
    // Вся обстановка уже стоит: поднятая вещь партнёра ложится на её верх (placed_place.ts, restTop) — на грань под серединой.
    objects: objects.list,
    surfaces: (id: number, x: number, z: number, lo: number, hi: number) => objects.surfaces(id, x, z, lo, hi),
  };
  const figures = placeFigures(opts.figures ?? FIGURES, placeWorld, (f, r) => inVariant(slotFor(f.slot, f.rule.rooms), pick(r)));
  // Дальше строятся вещи по записям партнёра — мимо хука: они не вещи игры, считать и трогать их ему нечего.
  const placed: PlacedSpot[] = [];
  // Вещи партнёра и передвинутые — без проверки «не врастать»: их место проверено по правилу записи (placed_place.ts).
  withSwap(null, () => withGrowthGuard(null, () => {
    // Передвинутые вещи игры (партнёр 17.11, 19:15: «текущую расстановку мебели я тоже должен уметь двигать и удалять»):
    // после всей обстановки и фигур, каждая в своём помещении по правилу записи (world/placed_place.ts, moveSpot) — не в
    // проход, не в мебель и не в другую передвинутую. Места по правилу нет — стоит, где её поставила игра (с преградами:
    // у картонки их нет, а вернётся она настоящей вещью).
    // Дверцы и ящики (квиз 18.11, «Как выпадет + переключатель»): по записи — закрыто или открыто всё; без неё — как у вещей
    // игры в том же помещении (furnish.ts, roomOpenness): эти вещи строятся после обстановки, доли помещения у них уже нет. Где
    // открытым дверцам впереди тесно, точка уже закрыта (placed_place.ts, doorsAt); передвинутая без места по правилу — как её
    // построила бы обстановка на прежнем месте (у проёма — закрытой).
    const share = (room: number): number => roomOpenness(layout.world, layout.seed, room);
    // Места передвинутых — все сразу (placed_place.ts, fitMoved): оставшаяся на своём месте занимает его для остальных.
    const moved = edits?.moved ?? [];
    const fits = fitMoved(moved.map((m) => ({ spec: m.spec, room: m.room, at: [m.xf.ox, m.xf.oy, m.xf.oz], rot: m.xf.rot })), placeWorld, ALL_PROPS);
    moved.forEach((m, i) => {
      const p = ALL_PROPS[m.spec.prop]!;
      const fit = fits[i];
      if (fit) {
        const s = fit.spot;
        const ch = chunkFor(m.room, Math.round(s.at[0] / CELL) + GRID / 2, Math.round(s.at[2] / CELL) + GRID / 2);
        const xf = new Xf(ch.mb, col, s.at[0], s.at[1], s.at[2], s.rot, ch.sl);
        const mk = tiltMark(xf);
        withOpenMode(s.open, () => p.build(xf, m.seed), share(m.room.id));
        // Доворот по всем осям (world/tilt.ts): собранное поворачивается вокруг середины и ложится на опору.
        if (s.tilt) applyTilt(xf, mk, s.tilt, p.mount);
        placed.push(s);
      } else {
        const xf = new Xf(m.xf.mb, col, m.xf.ox, m.xf.oy, m.xf.oz, m.xf.rot, m.xf.sl);
        const mk = tiltMark(xf);
        withOpenMode(m.spec.open, () => p.build(xf, m.seed), m.share);
        if (isTilted(m.spec.tilt)) applyTilt(xf, mk, m.spec.tilt, p.mount);
      }
    });
    // Вещи партнёра (world/placed_place.ts): после фигур и всей обстановки — не врастают ни во что, проходы
    // оставляют свободными. Строятся как обычная обстановка: в сетку своего помещения, с преградами, объектом
    // уровня (растворяется от касания и возвращается, как всё).
    const buildPlaced = (p: PlacedSpot): void => {
      const room = layout.rooms[p.room]!;
      const gx = Math.round(p.at[0] / CELL) + GRID / 2;
      const gz = Math.round(p.at[2] / CELL) + GRID / 2;
      const ch = chunkFor(room, gx, gz);
      const spec = ALL_PROPS[p.prop]!;
      const xf = new Xf(ch.mb, col, p.at[0], p.at[1], p.at[2], p.rot, ch.sl);
      const mk = tiltMark(xf);
      withOpenMode(p.open, () => spec.build(xf, placedSeed(layout.seed, p.k, p.id)), share(p.room));
      if (p.tilt) applyTilt(xf, mk, p.tilt, spec.mount);
      placed.push(p);
    };
    // Два прохода (квиз 19.11, «Ложится на то, что под ней»): сначала то, что стоит само, — на полу, на стене, «висит»; потом
    // поднятое, что ложится. Тогда оно ложится и на вещь партнёра — по её граням, как в конструкторе, — в каком бы порядке ни шли
    // записи (в файле они — по времени сохранения). Вещи первого прохода к тому часу собраны с преградами: врастание в них ловят
    // преграды, а не их грубые коробки (у стола с хлебницей коробка накрыла бы клеёнку, на которой лежит чашка).
    const specs = opts.placed ?? PLACED;
    const roomOk = (sp: PlacedSpec, r: GenRoom): boolean => inVariant(slotFor(sp.slot, sp.rule.rooms), pick(r));
    const lies = (sp: PlacedSpec): boolean => {
      const p = ALL_PROPS[sp.prop];
      return !!p && rests(sp, p);
    };
    for (const p of placeThings(specs.filter((sp) => !lies(sp)), placeWorld, ALL_PROPS, roomOk)) buildPlaced(p);
    for (const p of placeThings(specs.filter(lies), placeWorld, ALL_PROPS, roomOk)) buildPlaced(p);
  }));
  // Места для вещей внутри преград — прочь: вся обстановка уже стоит, и вещи партнёра тоже (furnish.ts, dropBuried).
  dropBuried(spots, col);
  // Мир расстановки остаётся у конструктора и тестов: от сеток ему — только верхние грани, сборщики не держать.
  if (opts.keepPlaceWorld) objects.freeze();
  // Свободные участки стен — в порядке помещений уровня: туда вещь может вернуться «в другом месте».
  for (const { room, ctx } of furnished) for (const s of ctx.slots) if (!s.used && !s.hazard && s.deep) freeSlots.push({ at: [s.xf.ox, s.xf.oy, s.xf.oz], rot: s.xf.rot, room: room.id, tier: room.tier });

  // ── Навигационный граф: узел на клетку; нижние части шахт — те же места, что верхние, узлов не получают ──
  const nav: NavNode[] = [];
  const nodeAt = new Map<string, number>();
  const nk = (t: number, x: number, z: number): string => `${t},${x},${z}`;
  for (const room of layout.rooms) {
    // По путям никто не ходит: ни Осыпь, ни вещи сна туда не попадают (зал ожидания).
    if (room.type === 'track') continue;
    if (lowerWells.has(room.id)) continue;
    for (const [x, z] of room.cells) {
      let y = tierFloor(room.tier);
      if (upperWells.has(room.id)) {
        const st = layout.stairs.find((s) => s.upperTier === room.tier && [1, 2, 3].some((i) => s.cx + DX[s.dir]! * i === x && s.cz + DZ[s.dir]! * i === z))!;
        const i = Math.abs(x - st.cx) + Math.abs(z - st.cz);
        y -= ((i - 0.5) / STAIR_CELLS) * TIER_DROP;
      }
      // У провала узел стоит на карнизе, а не над дырой: по нему ходит и тест маршрута, и рой.
      let ox = 0;
      let oz = 0;
      if (pitAt.has(nk(room.tier, x, z))) {
        const alongX = gridAt(room.tier, x + 1, z)?.id === room.id && gridAt(room.tier, x - 1, z)?.id === room.id;
        if (alongX) oz = PIT_LEDGE;
        else ox = PIT_LEDGE;
      }
      nodeAt.set(nk(room.tier, x, z), nav.length);
      nav.push({ id: nav.length, tier: room.tier, cx: x, cz: z, x: cellToWorld(x) + ox, y, z: cellToWorld(z) + oz, room: room.id, links: [] });
    }
  }
  const link = (a: number | undefined, b: number | undefined): void => {
    if (a === undefined || b === undefined || a === b) return;
    if (!nav[a]!.links.includes(b)) nav[a]!.links.push(b);
    if (!nav[b]!.links.includes(a)) nav[b]!.links.push(a);
  };
  for (const n of nav.slice()) {
    for (const d of [0, 1]) {
      const m = nodeAt.get(nk(n.tier, n.cx + DX[d]!, n.cz + DZ[d]!));
      if (m !== undefined && nav[m]!.room === n.room) link(n.id, m);
    }
  }
  for (const e of layout.edges) {
    const a = nodeAt.get(nk(e.tier, e.cx, e.cz));
    const b = nodeAt.get(nk(e.tier, e.cx + (e.dir === 0 ? 1 : 0), e.cz + (e.dir === 1 ? 1 : 0)));
    // Ребро внизу марша ведёт из нижней части шахты (узла нет) — его заменяет связь «низ марша — площадка».
    link(a, b);
  }
  for (const s of layout.stairs) {
    const bottom = nodeAt.get(nk(s.upperTier, s.cx + DX[s.dir]! * STAIR_CELLS, s.cz + DZ[s.dir]! * STAIR_CELLS));
    const landing = nodeAt.get(nk(s.upperTier + 1, s.cx + DX[s.dir]! * (STAIR_CELLS + 1), s.cz + DZ[s.dir]! * (STAIR_CELLS + 1)));
    link(bottom, landing);
  }

  const ent = layout.rooms[layout.entranceRoom]!;
  const [ex, ez] = ent.cells[0]!;
  const out: LevelChunk[] = [];
  for (const c of chunks.values()) {
    if (c.mb.triangleCount === 0) continue;
    out.push({ mesh: c.mb.build(), tierMin: c.tierMin, tierMax: c.tierMax, ...(c.id ? { id: c.id } : {}), ...(c.hidden ? { hidden: true } : {}), ...(c.sl.triangleCount > 0 ? { slides: c.sl.build() } : {}) });
  }
  const stairs: StairLink[] = layout.stairs.map((s) => ({
    upperTier: s.upperTier,
    top: [cellToWorld(s.cx), tierFloor(s.upperTier), cellToWorld(s.cz)],
    bottom: [cellToWorld(s.cx + DX[s.dir]! * (STAIR_CELLS + 1)), tierFloor(s.upperTier + 1), cellToWorld(s.cz + DZ[s.dir]! * (STAIR_CELLS + 1))],
  }));
  return {
    wear: decay.wear,
    ceilings: Object.fromEntries(layout.rooms.map((r) => [r.id, ceilOf(r)])),
    ...(roof ? { roof } : {}),
    ...(perches.length > 0 ? { perches } : {}),
    ...(skyRoom ? { skyRoom: skyRoom.id } : {}),
    chunks: out,
    stairs,
    colliders: col,
    // Старт — у люка, лицом к шлюзу (на север).
    spawn: { pos: [cellToWorld(ex), 0, cellToWorld(ez) + 0.4], yaw: 0 },
    exit: [cellToWorld(ex), 0, cellToWorld(ez)],
    spots,
    landmarks,
    zones,
    collapses,
    variants,
    nav,
    sheets: [...chunks.values()].filter((c) => !c.hidden).flatMap((c) => c.mb.sheets),
    notes,
    flats,
    objects: objects.list,
    freeSlots,
    growth,
    layout,
    world,
    edges,
    ...(figures.length > 0 ? { figures } : {}),
    ...(placed.length > 0 ? { placed } : {}),
    ...(opts.keepPlaceWorld ? { placeWorld } : {}),
  };
}
