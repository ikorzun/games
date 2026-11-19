/**
 * Расстановка реквизита по типам помещений. Помещение даёт «слоты»: участки стен по 2,7 м
 * (предметы ставятся спиной к стене) и центры клеток. Каждая функция обставляет свой тип комнаты,
 * регистрирует места для находок и приметные объекты — цели «снять на камеру».
 */
import { hash01, hash2 } from '../core/rng';
import type { Rng } from '../core/rng';
import type { Vec3 } from '../core/types';
import { dressRoom } from './dress';
import { FLAT_EYE, standee, veil, VEIL_SCENES } from './flat';
import type { FlatMark } from './flat';
import { DX, DZ, TIER_DROP } from '../gen/layout';
import type { GenRoom, WorldKind } from '../gen/layout';
import { reservePapers } from './furnish_papers';
import type { PaperHold, PaperState } from './furnish_papers';
import { furnishOffice, furnishYellow } from './furnish_office';
import { furnishStation } from './furnish_station';
import type { Decay } from '../systems/decay';
import type { Aabb, ColliderSet } from './colliders';
import type { ItemSpot, Landmark } from './level';
import { MAT } from './materials';
import { ALL_PROPS, restoreSwap, swapState } from './props_all';
import type { PropSpec } from './props_more';
import { asObject, hanging, markBuild, rewindBuild } from './objects';
import { barrel, cables, cageLamp, crate, pipeRun, rubble, signPlate, valve, ventGrille } from './props';
import { fillShelves, jitter, pickOf, s3Put, s3Size, S3_BED, S3_SHELVES, S3_TOP, withOpenness } from './furniture';
import { buildDisplay, DISPLAY_SIZE } from './props_screens';
import type { DisplayShape } from './props_screens';
import { DOOR_IMAGE, DOOR_NAME, SCREEN_IMAGES, screenFor } from './screens';
import type { ScreenKind } from './screens';
import { CELL, WALL_T } from './shell';
import { flowActive, flowDone, RoomFlow, withFlow } from './flow';
import { planOf } from './room_plan';
import type { RoomPlan, Side } from './room_plan';
import { Xf } from './props';
import {
  bucket,
  collapse,
  controlPanel,
  dieselGen,
  duct,
  elCabinet,
  extinguisher,
  fanUnit,
  filterUnit,
  fuelTank,
  gasMaskRow,
  ladderShaft,
  mapBoard,
  poster,
  puddle,
  radioSet,
  safe,
  SAFE,
  sinkRow,
  stalls,
  wallPhone,
  waterTank,
} from './props_bunker';

/** Участок стены клетки: начало — середина грани у пола, +z — в комнату, x — вдоль стены (−1,35…1,35). */
export interface Slot {
  xf: Xf;
  cx: number;
  cz: number;
  dir: number;
  /** Можно ли ставить глубокие предметы (нет двери рядом и хватает места). */
  deep: boolean;
  /** Клетка с провалом, водой или будущим завалом: у стены ничего не ставим, только трубы и кабели. */
  hazard: boolean;
  /** На этом конце стены внутренний угол: там глубокий предмет упрётся в соседнюю стену. */
  cornerL: boolean;
  cornerR: boolean;
  used: boolean;
}

export interface CellInfo {
  cx: number;
  cz: number;
  /** Центр клетки на полу. */
  xf: Xf;
  /** Сколько сторон клетки заняты проходами (дверь или открытое ребро в другое помещение). */
  doors: number;
  /** Что на каждой стороне клетки (0 — +x, 1 — +z, 2 — −x, 3 — −z): стена, дверь, открытое ребро в соседнее помещение, своя клетка. */
  sides?: readonly Side[];
}

export interface RoomCtx {
  room: GenRoom;
  /** Какой это мир: убежище обставляется здесь, офис и жёлтые комнаты — в furnish_office.ts. */
  world: WorldKind;
  /** Сид уровня (общий для всех помещений): по нему решается то, что должны знать и обстановка, и игра. */
  seed: number;
  /** Клетка, с которой начинается вылазка: рядом с ней обманок не ставим. */
  start: { cx: number; cz: number; tier: number };
  /** Сколько клеток от начала сна до клетки (cx, cz) этого яруса по проходам; Infinity — не дойти (world/room_plan.ts). */
  dist?: (cx: number, cz: number) => number;
  rng: Rng;
  /** Высота потолка над полом. */
  h: number;
  slots: Slot[];
  cells: CellInfo[];
  spots: ItemSpot[];
  landmarks: Landmark[];
  /** Плоские вещи помещения: картонки и проекции (world/flat.ts). */
  flats: FlatMark[];
  /**
   * Выставочные экраны, которые обязаны стоять в этом помещении: номера их картинок (world/screens.ts).
   * Экраны — вещь офиса; в жёлтых комнатах их ровно два на весь уровень (решение партнёра: «как
   * соединение смысла и пространств»), и кому они достались и что показывают, решает сборка уровня.
   * Не задано — экранов нет.
   */
  screens?: readonly number[];
  /**
   * Стирание места (systems/decay.ts): от него зависит, сколько вещей стоит картонками и сколько
   * берёз проросло. Не задано — место помнится целиком.
   */
  decay?: Decay;
  /** У помещения нет потолка: над ним звёздное небо (world/level_build.ts). Под потолок здесь ничего не вешают. */
  sky?: boolean;
  /** Счёт бумаги и чемоданов на уровень (world/furnish_papers.ts). Нет — помещению участки под них не отводятся. */
  paperState?: PaperState;
  /** Участки стен, отведённые под бумагу и чемоданы до обстановки: предметы встанут туда последним проходом. */
  papers?: PaperHold[];
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** Свободные слоты в случайном порядке; deep — только годные для глубоких предметов. */
export function free(ctx: RoomCtx, deep = true): Slot[] {
  return shuffled(
    ctx.rng,
    ctx.slots.filter((s) => !s.used && (!deep || s.deep)),
  );
}

/** Занять следующий свободный слот. */
export function take(ctx: RoomCtx, deep = true): Slot | null {
  const s = free(ctx, deep)[0];
  if (!s) return null;
  s.used = true;
  return s;
}

export function spot(ctx: RoomCtx, xf: Xf, x: number, y: number, z: number, kind: ItemSpot['kind']): void {
  const p = xf.pt(x, y, z);
  ctx.spots.push({ x: p[0], y: p[1], z: p[2], room: ctx.room.id, tier: ctx.room.tier, kind });
}

/** Насколько вещь на сиденье, полке или стойке может уйти в коробку преграды, м: у её края (взгляд игры прощает 0,6). */
export const BURIED = 0.3;

/**
 * Убрать места для вещей, оказавшиеся внутри преграды (CI 18.11: фотография воспоминания лежала на нижней койке нар, внутри
 * сплошной коробки модели, — ни взгляд, ни луч до неё не доходили; так же — места на полу под столом переговорной, в дизеле
 * и баках, под рабочим столом, вставшим после). Вещь на полу преград не касается; на сиденье, полке, стойке может лежать чуть
 * внутри коробки, у её края, — не глубже BURIED. Звать после всей обстановки уровня: мебель ставится и после мест.
 */
export function dropBuried(spots: ItemSpot[], col: ColliderSet): void {
  const near: Aabb[] = [];
  let keep = 0;
  for (const s of spots) {
    const y = s.y + 0.06;
    const limit = s.kind === 'floor' ? 0 : BURIED;
    const buried = col.query(s.x, s.z, s.x, s.z, near).some((b) => y > b.minY && y < b.maxY && Math.min(s.x - b.minX, b.maxX - s.x, s.z - b.minZ, b.maxZ - s.z) > limit);
    if (!buried) spots[keep++] = s;
  }
  spots.length = keep;
}

/** Откуда смотрит герой на место для вещи: глаз над полом, м; на каком расстоянии пробовать встать и сколько сторон обойти. */
const SEE = { eye: 1.42, rings: [1.1, 1.7, 2.2, 3] as const, around: 12, body: 0.3, slack: 0.45 };

/**
 * Убрать места для вещей, которых не видно ни с одной точки, где можно встать (CI 19.11, «честный прогон»: будильник —
 * вещь воспоминания — лежал на тумбочке в углу спальни; за ней стена, сбоку изголовье кровати в 1,2 м и торшер, — и
 * вспомнить его было нельзя: вспоминают взглядом). Видно — так, как требует игра: глаз героя в 1,1–3 м от вещи, тело там
 * помещается и под ним есть пол, луч от глаза до вещи не упирается в преграду раньше, чем за SEE.slack до неё. Звать после
 * dropBuried: вся обстановка уже стоит.
 */
export function dropHidden(spots: ItemSpot[], col: ColliderSet): void {
  const near: Aabb[] = [];
  const R = SEE.body;
  const blocks = (b: Aabb): boolean => !b.off && !b.gone && !b.ghost;
  const seen = (s: ItemSpot): boolean => {
    const floor = -s.tier * TIER_DROP;
    const ty = s.y + 0.12;
    for (const r of SEE.rings) {
      for (let i = 0; i < SEE.around; i++) {
        const a = (i / SEE.around) * Math.PI * 2;
        const px = s.x + Math.cos(a) * r;
        const pz = s.z + Math.sin(a) * r;
        // Встать: под ногами пол, вокруг (радиус тела) — ни стены, ни мебели.
        if (col.raycast(px, floor + 1, pz, 0, -1, 0, 1.6) >= 1.6) continue;
        if (col.query(px - R, pz - R, px + R, pz + R, near).some((b) => blocks(b) && b.maxY > floor + 0.08 && b.minY < floor + 1.7 && b.minX < px + R && b.maxX > px - R && b.minZ < pz + R && b.maxZ > pz - R)) continue;
        const ey = floor + SEE.eye;
        const dx = s.x - px;
        const dy = ty - ey;
        const dz = s.z - pz;
        const d = Math.hypot(dx, dy, dz);
        if (col.raycast(px, ey, pz, dx / d, dy / d, dz / d, d) >= d - SEE.slack) return true;
      }
    }
    return false;
  };
  let keep = 0;
  for (const s of spots) if (seen(s)) spots[keep++] = s;
  spots.length = keep;
}

export function landmark(ctx: RoomCtx, id: string, xf: Xf, x: number, y: number, z: number): void {
  const p = xf.pt(x, y, z);
  ctx.landmarks.push({ id, x: p[0], y: p[1], z: p[2], room: ctx.room.id, tier: ctx.room.tier });
}

/** Сдвиг предмета шириной w вдоль слота так, чтобы он не упёрся в угол. */
export function fit(s: Slot, w: number, depth: number): number {
  const lo = -1.35 + (s.cornerL ? depth + 0.05 : 0) + w / 2;
  const hi = 1.35 - (s.cornerR ? depth + 0.05 : 0) - w / 2;
  if (lo > hi) return 0;
  return Math.max(lo, Math.min(hi, 0));
}

function lamps(ctx: RoomCtx, every = 1): void {
  if (ctx.sky) return;
  ctx.cells.forEach((c, i) => {
    if (i % every === 0) hanging(c.xf, () => cageLamp(c.xf.child(0, ctx.h, 0)));
  });
}

// ───────────────────────────── мебель полки ─────────────────────────────

/**
 * Мебель убежища с 18.11 — модели полки Sand3D (world/furniture.ts; партнёр: «замени всю мебель на новую самостоятельно»):
 * нары, столы, табуреты, стулья, койки, шкафчики, стеллажи. Каждая — предмет уровня, как вся мебель: растворяется от касания,
 * партнёр может её передвинуть или убрать конструктором. Сид — из точки: общий ход случайностей комнаты не сдвигается.
 */
const BENCHES = ['s3_bench_wood', 's3_bench_blue', 's3_bench_cast'] as const;
const BUNKS = ['s3_bunk_black', 's3_bunk_mattress'] as const;
const CHAIRS = ['s3_chair_ladder', 's3_chair_carved'] as const;
const RACK = 's3_rack_metal';
const pointSeed = (xf: Xf): number => hash2(Math.round(xf.ox * 100), Math.round(xf.oz * 100), 0x53f + Math.round(xf.oy * 10)) % 1000003;

/** Модель полки у стены (спиной к z = 0) — предмет уровня. false — не встала: врастала в соседнюю (world/clearance.ts). */
function s3(xf: Xf, name: string): boolean {
  return ALL_PROPS[name]!.build(xf, pointSeed(xf)) !== false;
}

/** Модель полки серединой в начале координат (стол посреди клетки, стул у стола). false — не встала. */
function s3c(xf: Xf, name: string): boolean {
  const g = s3Size(name);
  return s3(g.mount === 'free' ? xf : xf.child(0, 0, -g.d / 2), name);
}

/**
 * Модель полки серединой около точки xf (стол посреди клетки): врастает в стоящее у стен (world/clearance.ts) — повернуть на
 * четверть и сдвинуть вдоль длинной стороны, до 0,3 м в обе стороны, к проходу в соседнюю клетку. Ответ — рамка, в которой
 * встала (её середина — середина вещи, ось x — длинная сторона); null — не встала нигде.
 */
function s3Near(xf: Xf, name: string): Xf | null {
  for (const rot of [0, 1] as const) {
    for (const dx of [0, 0.15, -0.15, 0.3, -0.3]) {
      const at = xf.child(0, 0, 0, rot).child(dx, 0, 0);
      if (s3c(at, name)) return at;
    }
  }
  return null;
}

/**
 * Металлический стеллаж полки, на полках — ящики и тюки (кладовая) или кипы бумаги (архив). В пролёте hole оставлен
 * промежуток под вещь воспоминания; ответ — где она ляжет (x вдоль стены, y полки).
 */
function rack(xf: Xf, seed: number, load: 'boxes' | 'papers', hole: { shelf: number; x0: number; x1: number }): { x: number; y: number } | null {
  if (!s3(xf, RACK)) return null;
  fillShelves(xf, S3_SHELVES[RACK]!, load, seed, { back: false, hole });
  return { x: (hole.x0 + hole.x1) / 2, y: S3_SHELVES[RACK]![hole.shelf]!.y + 0.005 };
}

/** Мелочь у стены: что-нибудь неглубокое, не мешающее проходу. */
function clutter(ctx: RoomCtx, s: Slot, wet = false): void {
  const r = ctx.rng();
  const x = (ctx.rng() - 0.5) * 1.4;
  const seed = Math.floor(ctx.rng() * 1e6);
  if (r < 0.16) {
    crate(s.xf.child(x, 0, 0.32), 0.55, 0.4, 0.42, [0.9, 0.9, 0.9]);
    spot(ctx, s.xf, x, 0.41, 0.32, 'table');
  } else if (r < 0.28) barrel(s.xf.child(x, 0, 0.36), ctx.rng() < 0.5 ? MAT.rust : MAT.metalGreen);
  else if (r < 0.38) bucket(s.xf.child(x, 0, 0.3));
  else if (r < 0.5) rubble(s.xf.child(x, 0, 0.5), seed);
  else if (r < 0.6) extinguisher(s.xf.child(x, 0.9, 0));
  else if (r < 0.72) poster(s.xf.child(x * 0.5, 1.75, 0), 0.6 + ctx.rng() * 0.4, 0.8, seed);
  else if (r < 0.82) ventGrille(s.xf.child(x * 0.5, 2.15, 0));
  else if (r < 0.9) s3(s.xf.child(0, 0, 0), pickOf(BENCHES, seed));
  else if (wet) puddle(s.xf.child(x, 0, 0.9), 1.1, 0.7);
  else gasMaskRow(s.xf.child(0, 1.7, 0), 4);
}

// ───────────────────────────── помещения ─────────────────────────────

function corridor(ctx: RoomCtx): void {
  const tier = ctx.room.tier;
  ctx.cells.forEach((c) => {
    if ((c.cx + c.cz) % 2 === 0) hanging(c.xf, () => cageLamp(c.xf.child(0, ctx.h, 0)));
  });
  for (const s of ctx.slots) {
    // Трубы идут по западным и северным стенам, кабели — по восточным и южным: так они тянутся непрерывно.
    if (s.dir === 2 || s.dir === 3) {
      pipeRun(s.xf.child(-1.5, 0, 0), 3.0, 2.28, 0.06, MAT.rust, tier === 2 ? [0.8, 0.75, 0.7] : [1, 1, 1]);
      pipeRun(s.xf.child(-1.5, 0, 0), 3.0, 2.08, 0.035, tier === 1 ? MAT.paintRed : MAT.paintBlue, [0.8, 0.8, 0.8]);
      if (ctx.rng() < 0.12) valve(s.xf.child((ctx.rng() - 0.5) * 1.6, 2.28, 0.12));
    } else {
      cables(s.xf.child(-1.5, 2.56, 0), 3.0);
    }
    if (!s.hazard && ctx.rng() < (tier === 2 ? 0.3 : 0.2)) {
      clutter(ctx, s, tier > 0);
      s.used = true;
    }
  }
  // Сыро на нижних ярусах.
  const dry = new Set(ctx.slots.filter((s) => s.hazard).map((s) => `${s.cx},${s.cz}`));
  if (tier > 0) for (const c of ctx.cells) if (!dry.has(`${c.cx},${c.cz}`) && ctx.rng() < 0.12 * tier) puddle(c.xf.child((ctx.rng() - 0.5) * 0.8, 0, (ctx.rng() - 0.5) * 0.8), 0.9 + ctx.rng(), 0.6 + ctx.rng() * 0.6);
  // Ниже первого яруса в убежище проступает дом — комнатами, которых нет: по одной проекции на ярус.
  if (tier > 0) veils(ctx, 1);
}

function entrance(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Лестница на поверхность — у стены напротив выхода: её видно, откуда ни посмотри.
  const s = bestSlots(ctx, false, k.hero)[0];
  if (s) {
    s.used = true;
    ladderShaft(s.xf, ctx.h);
    landmark(ctx, 'exit', s.xf, 0, 1.2, 0.3);
  }
  const g = bestSlots(ctx, false, k.side)[0];
  if (g) {
    g.used = true;
    gasMaskRow(g.xf.child(0, 1.7, 0), 6);
  }
  const b = bestSlots(ctx, false, k.door)[0];
  if (b) {
    b.used = true;
    // Скамья у входа — не предмет уровня, а часть места: с этой комнаты начинается вылазка, игрок встаёт рядом, и от первого
    // же шага она растворилась бы.
    const kk = b.cx * 7 + b.cz;
    s3Put(b.xf, pickOf(BENCHES, kk), { tint: jitter(kk) });
    signPlate(b.xf.child(0, 2.2, 0), 0.7, 0.18);
  }
}

function airlock(ctx: RoomCtx): void {
  lamps(ctx);
  const a = take(ctx, false);
  if (a) {
    ventGrille(a.xf.child(0, 2.15, 0), 0.6, 0.4);
    extinguisher(a.xf.child(-0.8, 0.9, 0));
  }
  const b = take(ctx, false);
  if (b) poster(b.xf.child(0, 1.65, 0), 0.9, 0.8, 41);
}

/** Середина помещения (по охвату клеток) и клетки по удалению от неё — ближние первыми: под стол посреди комнаты. */
function byMiddle(ctx: RoomCtx): CellInfo[] {
  let x = 0;
  let z = 0;
  for (const c of ctx.cells) {
    x += c.cx;
    z += c.cz;
  }
  x /= ctx.cells.length;
  z /= ctx.cells.length;
  return ctx.cells.slice().sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z) || a.cx - b.cx || a.cz - b.cz);
}

function dorm(ctx: RoomCtx): void {
  lamps(ctx, 2);
  const k = roles(ctx);
  // Нары — рядами вдоль стен, как в казарме: по одной на участок, серединой участка — ряд ровный, без сдвигов к углам. Сначала
  // напротив входа и сбоку (с порога виден ряд нар); стена входа — под шкафчики. Нары у угла врастали в соседние (партнёр
  // 18.11): не встали — эта стена остаётся другому.
  let beds = 0;
  for (const s of bestSlots(ctx, false, (q) => (k.plan.role(q) === 'near' ? -Infinity : k.hero(q) + (q.deep ? 0.5 : 0)))) {
    if (beds >= 4) break;
    const b = pickOf(BUNKS, s.cx * 31 + s.cz * 17 + beds);
    if (!s3(s.xf.child(0, 0, 0), b)) continue;
    spot(ctx, s.xf, 0, S3_BED[b]! + 0.005, 0.42, 'table');
    if (beds === 0) landmark(ctx, 'bunks', s.xf, 0, 1.0, 0.75);
    s.used = true;
    beds += 1;
  }
  // Шкафчики — у входа: в них убирали вещи, входя. Три бок о бок; вещь — на полу перед средним, дальше открытой дверцы.
  const l = bestSlots(ctx, false, k.door)[0];
  if (l) {
    l.used = true;
    const w = s3Size('s3_locker_olive').w;
    const x0 = fit(l, w * 3, 0.56) - w;
    const stood = [0, 1, 2].map((i) => s3(l.xf.child(x0 + i * w, 0, 0), 's3_locker_olive'));
    if (stood[1]) spot(ctx, l.xf, x0 + w, 0.02, s3Size('s3_locker_olive', true).d + 0.12, 'floor');
  }
  // Стол с табуретами — посреди комнаты, в проходе между нарами; где перегородил бы путь (world/flow.ts) — в соседней клетке.
  for (const c of byMiddle(ctx)) {
    const t = s3Near(c.xf, 's3_table_work');
    if (!t) continue;
    // Табуреты задвинуты под стол наполовину.
    s3c(t.child(-0.3, 0, 0.45), 's3_stool_wood');
    s3c(t.child(0.38, 0, -0.45, 1), 's3_stool_wood');
    spot(ctx, t, 0, S3_TOP.s3_table_work! + 0.005, 0, 'table');
    break;
  }
  const abandoned = ctx.room.tier === 2;
  for (const s of free(ctx, false).slice(0, 2)) {
    clutter(ctx, s, abandoned);
    s.used = true;
  }
}

/** Сколько места стулу между развёрнутым столом и стеной за ним, м. */
const CHAIR_GAP = 0.85;

function command(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Стол командира — лицом ко входу: развёрнут от стены, стул между ним и стеной, над стулом — карта. С порога видно стол,
  // пустой стул за ним и карту — главная вещь в створе входа. Не встал развёрнутым — у стены, как письменный.
  const D = 's3_desk_green';
  const g = s3Size(D);
  const top = S3_TOP[D]!;
  let desk = false;
  for (const d of bestSlots(ctx, false, (q) => (k.plan.role(q) === 'near' ? -Infinity : k.hero(q) + (depthAt(ctx, q) >= CHAIR_GAP + g.d + 1.4 ? 1 : -2)))) {
    if (!s3(d.xf.child(0, 0, CHAIR_GAP + g.d, 2), D)) continue;
    d.used = true;
    desk = true;
    s3c(d.xf.child(0.05, 0, CHAIR_GAP - 0.3), pickOf(CHAIRS, d.cx * 5 + d.cz));
    radioSet(d.xf.child(-0.45, top, CHAIR_GAP + g.d - 0.3, 2));
    mapBoard(d.xf.child(0, 1.5, 0));
    landmark(ctx, 'radio', d.xf, -0.45, top + 0.14, CHAIR_GAP + g.d - 0.3);
    landmark(ctx, 'map', d.xf, 0, 1.5, 0.05);
    spot(ctx, d.xf, 0.4, top + 0.005, CHAIR_GAP + 0.35, 'table');
    break;
  }
  if (!desk) {
    const d = bestSlots(ctx, true, k.hero)[0];
    if (d) {
      d.used = true;
      const x = fit(d, g.w, g.d);
      // Радиостанция стоит на столе: не встал стол — нет и её.
      if (s3(d.xf.child(x, 0, 0), D)) {
        radioSet(d.xf.child(x - 0.3, top, 0.3));
        s3c(d.xf.child(x - 0.05, 0, g.d + 0.15, 2), pickOf(CHAIRS, d.cx * 5 + d.cz));
        landmark(ctx, 'radio', d.xf, x - 0.3, top + 0.14, 0.3);
        spot(ctx, d.xf, x + 0.4, top + 0.005, 0.35, 'table');
      }
    }
    const m = bestSlots(ctx, false, k.hero)[0];
    if (m) {
      m.used = true;
      mapBoard(m.xf.child(0, 1.5, 0));
      landmark(ctx, 'map', m.xf, 0, 1.5, 0.05);
    }
  }
  // Сейф — у боковой стены; телефон — у входа.
  const s = bestSlots(ctx, true, k.side)[0];
  if (s) {
    s.used = true;
    const sg = s3Size(SAFE);
    const x = fit(s, sg.w, sg.d);
    safe(s.xf.child(x, 0, 0), pointSeed(s.xf.child(x, 0, 0)));
    landmark(ctx, 'safe', s.xf, x, 0.4, 0.4);
    spot(ctx, s.xf, x, S3_TOP[SAFE]! + 0.005, 0.22, 'table');
  }
  const ph = bestSlots(ctx, false, k.door)[0];
  if (ph) wallPhone(ph.xf.child(0.9, 1.4, 0));
  // Стол для совещаний — посреди комнаты, стулья по длинным сторонам; где перегородил бы путь — в соседней клетке.
  for (const c of byMiddle(ctx)) {
    const t = s3Near(c.xf.child(0, 0, 0, 1), 's3_table_work');
    if (!t) continue;
    s3c(t.child(0, 0, 0.66, 2), pickOf(CHAIRS, c.cx + c.cz * 3));
    s3c(t.child(0.2, 0, -0.66, 0), pickOf(CHAIRS, c.cx + c.cz * 3 + 1));
    spot(ctx, t, 0, S3_TOP.s3_table_work! + 0.005, 0, 'table');
    break;
  }
  for (const p of free(ctx, false).slice(0, 2)) {
    poster(p.xf.child(0, 1.65, 0), 0.8, 0.9, 7 + p.cx * 13 + p.cz);
    p.used = true;
  }
}

function medical(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Койки — в ряд вдоль одной стены, изголовьем в одну сторону, как в палате; ряд — напротив входа или сбоку.
  const B = 's3_bed_iron_white';
  const bed = s3Size(B);
  const first = bestSlots(ctx, false, (q) => (k.plan.role(q) === 'near' ? -Infinity : k.hero(q) + (q.deep ? 0.5 : 0)));
  let beds = 0;
  for (const s of first) {
    if (beds >= 2) break;
    const row: (Slot | undefined)[] = [s, k.plan.beside(s, 1), k.plan.beside(s, -1)];
    for (const q of row) {
      if (beds >= 2 || !q || q.used || q.hazard) continue;
      const x = fit(q, bed.w, bed.d);
      if (!s3(q.xf.child(x, 0, 0), B)) continue;
      spot(ctx, q.xf, x, S3_BED[B]! + 0.005, 0.42, 'table');
      q.used = true;
      beds += 1;
    }
  }
  // Шкаф с лекарствами и умывальник — у входа: с ними начинали и заканчивали обход.
  const c = bestSlots(ctx, true, k.door)[0] ?? bestSlots(ctx, false, k.door)[0];
  if (c) {
    c.used = true;
    const cab = s3Size('s3_cabinet_medical');
    const x = fit(c, cab.w, cab.d);
    if (s3(c.xf.child(x, 0, 0), 's3_cabinet_medical')) {
      landmark(ctx, 'cabinet', c.xf, x, 1.2, 0.4);
      spot(ctx, c.xf, x + (x > 0 ? -0.7 : 0.7), 0.02, 0.3, 'floor');
    }
  }
  const w = bestSlots(ctx, false, k.door)[0];
  if (w) {
    w.used = true;
    sinkRow(w.xf.child(fit(w, 0.62, 0.45), 0, 0), 1);
  }
  for (const p of free(ctx, false).slice(0, 1)) {
    poster(p.xf.child(0, 1.65, 0), 0.7, 0.9, 99);
    p.used = true;
  }
}

/**
 * Остров из двух стеллажей спиной к спине посреди клетки, вдоль оси входа: проходы между островами и стенами смотрят от входа
 * вглубь — с порога видны коридоры между стеллажами, как на складе (и есть за чем спрятаться). Ответ — встал ли остров.
 */
function rackIsland(ctx: RoomCtx, c: CellInfo, load: 'boxes' | 'papers', hole: { shelf: number; x0: number; x1: number }, every: number): boolean {
  const e = planOf(ctx).entry;
  const rot = (e ? (e.dir % 2 === 0 ? 0 : 1) : ctx.rng() < 0.5 ? 0 : 1) as 0 | 1;
  const mark = markBuild(c.xf);
  const sides = [c.xf.child(0, 0, 0.01, rot), c.xf.child(0, 0, -0.01, (rot + 2) as 2 | 3)];
  const at = sides.map((xf, i) => rack(xf, c.cx * 37 + c.cz * 11 + i, load, hole));
  if (at.some((p) => !p)) {
    if (mark) rewindBuild(c.xf, mark);
    return false;
  }
  at.forEach((p, i) => {
    if ((c.cx + c.cz + i) % every === 0) spot(ctx, sides[i]!, p!.x, p!.y, 0.3, 'shelf');
  });
  return true;
}

function storage(ctx: RoomCtx): void {
  lamps(ctx, 2);
  const k = roles(ctx);
  // Острова стеллажей посреди клеток — сначала дальние от входа; у стен — ещё стеллажи, кроме стены входа.
  const e = k.plan.entry;
  const cells = ctx.cells.slice().sort((a, b) => (e ? Math.hypot(b.xf.ox - e.x, b.xf.oz - e.z) - Math.hypot(a.xf.ox - e.x, a.xf.oz - e.z) : 0));
  let islands = 0;
  for (const c of ctx.cells.length >= 3 ? cells : []) {
    if (islands >= ctx.cells.length - 2) break;
    if (rackIsland(ctx, c, 'boxes', { shelf: 5, x0: 0.15, x1: 0.45 }, 1)) {
      if (islands === 0) landmark(ctx, 'racks', c.xf, 0, 1.1, 0);
      islands += 1;
    }
  }
  let racks = 0;
  for (const s of bestSlots(ctx, true, (q) => (k.plan.role(q) === 'near' ? -Infinity : k.side(q)))) {
    if (racks >= (islands > 0 ? 3 : 5)) break;
    const x = fit(s, s3Size(RACK).w, 0.52);
    // Вещь — на средней полке справа: там пролёт высокий, её видно.
    const at = rack(s.xf.child(x, 0, 0), s.cx * 31 + s.cz * 17 + racks * 7, 'boxes', { shelf: 5, x0: 0.15, x1: 0.45 });
    if (!at) continue;
    spot(ctx, s.xf, x + at.x, at.y, 0.3, 'shelf');
    if (islands === 0 && racks === 0) landmark(ctx, 'racks', s.xf, 0, 1.1, 0.5);
    s.used = true;
    racks += 1;
  }
  // Ящики и бочки — у стены входа и в углах: то, что не успели разобрать.
  for (const s of bestSlots(ctx, false, k.door).slice(0, 2)) {
    crate(s.xf.child(-0.4, 0, 0.3), 0.7, 0.5, 0.5);
    crate(s.xf.child(-0.35, 0.5, 0.32, 1), 0.45, 0.32, 0.4, [0.85, 0.85, 0.85]);
    if (ctx.rng() < 0.6) barrel(s.xf.child(0.5, 0, 0.36), MAT.metalGreen);
    spot(ctx, s.xf, 0.3, 0.02, 0.8, 'floor');
    s.used = true;
  }
}

function washroom(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Умывальники в ряд — сбоку от входа; кабинки — на стене напротив них: между рядами проход.
  const a = bestSlots(ctx, false, k.side)[0];
  if (a) {
    a.used = true;
    sinkRow(a.xf.child(0, 0, 0), a.cornerL || a.cornerR ? 2 : 3);
    landmark(ctx, 'sinks', a.xf, 0, 1.1, 0.45);
  }
  const o = a ? k.plan.opposite(a) : undefined;
  const b = o && !o.used && !o.hazard && !o.cornerL && !o.cornerR ? o : bestSlots(ctx, true, k.hero).find((q) => !q.cornerL && !q.cornerR);
  if (b) {
    b.used = true;
    stalls(b.xf.child(0, 0, 0), 2);
  }
  for (const c of ctx.cells) puddle(c.xf.child(0.2, 0, 0.1), 1.2, 0.8);
  const p = bestSlots(ctx, false, k.door)[0];
  if (p) {
    pipeRun(p.xf.child(-1.35, 0, 0), 2.7, 2.3, 0.04, MAT.rust);
    bucket(p.xf.child(0.6, 0, 0.35));
    spot(ctx, p.xf, -0.5, 0.02, 0.5, 'floor');
    p.used = true;
  }
}

function fvu(ctx: RoomCtx): void {
  lamps(ctx, 2);
  const k = roles(ctx);
  // Фильтры — напротив входа и сбоку (главное в комнате видно с порога), вентилятор — рядом с ними, щит — у входа.
  let units = 0;
  for (const s of bestSlots(ctx, true, k.hero)) {
    if (units >= 3) break;
    const x = fit(s, 1.5, 0.75);
    if (units < 2) {
      filterUnit(s.xf.child(x, 0, 0), ctx.h);
      if (units === 0) landmark(ctx, 'fvu', s.xf, x, 1.0, 0.7);
    } else {
      fanUnit(s.xf.child(fit(s, 0.9, 0.65), 0, 0), ctx.h);
      landmark(ctx, 'fan', s.xf, fit(s, 0.9, 0.65), 0.9, 0.6);
    }
    s.used = true;
    units += 1;
  }
  const p = bestSlots(ctx, true, k.door)[0] ?? bestSlots(ctx, false, k.door)[0];
  if (p) {
    p.used = true;
    const x = fit(p, 0.9, 0.4);
    controlPanel(p.xf.child(x, 0, 0));
    landmark(ctx, 'panel', p.xf, x, 1.3, 0.4);
  }
  for (const s of free(ctx, false).slice(0, 3)) {
    hanging(s.xf, () => duct(s.xf.child(0, ctx.h - 0.42, 0), -1.5, 1.5));
    if (ctx.rng() < 0.5) valve(s.xf.child((ctx.rng() - 0.5) * 1.2, 1.3, 0.05));
    s.used = true;
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) spot(ctx, mid.xf, 0.4, 0.02, 0.3, 'floor');
}

function diesel(ctx: RoomCtx): void {
  lamps(ctx, 2);
  const k = roles(ctx);
  // Дизель — напротив входа, во весь участок; бак — сбоку; щит управления — у входа, чтобы видеть машину, стоя у двери.
  const g = bestSlots(ctx, true, (q) => (q.cornerL || q.cornerR ? 0 : 1) + k.hero(q))[0];
  if (g) {
    g.used = true;
    dieselGen(g.xf.child(0, 0, 0), ctx.h);
    landmark(ctx, 'diesel', g.xf, 0, 0.8, 0.9);
  }
  const t = bestSlots(ctx, true, k.side)[0];
  if (t) {
    t.used = true;
    fuelTank(t.xf.child(fit(t, 1.9, 0.95), 0, 0));
  }
  const p = bestSlots(ctx, true, k.door)[0] ?? bestSlots(ctx, false, k.door)[0];
  if (p) {
    p.used = true;
    const x = fit(p, 0.9, 0.4);
    controlPanel(p.xf.child(x, 0, 0));
    extinguisher(p.xf.child(x > 0 ? x - 0.75 : x + 0.75, 0.9, 0));
    landmark(ctx, 'panel', p.xf, x, 1.3, 0.4);
  }
  for (const c of ctx.cells) {
    if (c.doors > 0 || ctx.rng() < 0.5) continue;
    barrel(c.xf.child(0.3, 0, 0.3), MAT.rust, [0.8, 0.75, 0.7]);
    barrel(c.xf.child(-0.35, 0, 0.25), MAT.metalGreen);
    puddle(c.xf.child(0, 0, -0.4), 1.0, 0.6);
    spot(ctx, c.xf, -0.6, 0.02, -0.5, 'floor');
  }
  for (const s of free(ctx, false).slice(0, 2)) {
    clutter(ctx, s, true);
    s.used = true;
  }
}

function tanks(ctx: RoomCtx): void {
  lamps(ctx, 2);
  const k = roles(ctx);
  // Баки — напротив входа и сбоку, рядом; трубы — по остальным стенам.
  let n = 0;
  for (const s of bestSlots(ctx, true, k.hero)) {
    if (n >= 2 || s.cornerL || s.cornerR) continue;
    waterTank(s.xf.child(0, 0, 0));
    if (n === 0) landmark(ctx, 'tank', s.xf, 0, 1.2, 1.5);
    s.used = true;
    n += 1;
  }
  for (const s of free(ctx, false).slice(0, 3)) {
    pipeRun(s.xf.child(-1.5, 0, 0), 3.0, 0.6, 0.07, MAT.paintBlue, [0.8, 0.85, 0.85]);
    valve(s.xf.child((ctx.rng() - 0.5) * 1.4, 0.6, 0.13), 0.13);
    s.used = true;
  }
  for (const c of ctx.cells) {
    if (ctx.rng() < 0.6) puddle(c.xf.child((ctx.rng() - 0.5) * 0.6, 0, (ctx.rng() - 0.5) * 0.6), 1.3, 0.9);
    if (c.doors === 0 && ctx.rng() < 0.35) {
      bucket(c.xf.child(0.4, 0, 0.2));
      spot(ctx, c.xf, 0, 0.02, 0.5, 'floor');
    }
  }
}

function switchboard(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Шкафы щитовой — рядами напротив входа и сбоку: стена из железа видна с порога.
  let n = 0;
  for (const s of bestSlots(ctx, true, k.hero)) {
    if (n >= 3) break;
    const count = s.cornerL || s.cornerR ? 2 : 3;
    const x0 = fit(s, count * 0.74, 0.45) - ((count - 1) * 0.74) / 2;
    for (let i = 0; i < count; i++) elCabinet(s.xf.child(x0 + i * 0.74, 0, 0), ctx.rng() < 0.2);
    if (n === 0) landmark(ctx, 'switchboard', s.xf, x0 + 0.74, 1.3, 0.45);
    s.used = true;
    n += 1;
  }
  for (const s of free(ctx, false).slice(0, 2)) {
    cables(s.xf.child(-1.5, 2.4, 0), 3.0);
    s.used = true;
  }
  const c = ctx.cells[0];
  if (c) spot(ctx, c.xf, 0.3, 0.02, 0.3, 'floor');
}

function archive(ctx: RoomCtx): void {
  lamps(ctx, 2);
  const k = roles(ctx);
  // Стол архивариуса — у входа, к нему подходят первым; стеллажи — островами посреди клеток и у стен, проходы смотрят вглубь.
  const D = 's3_desk_green';
  const g = s3Size(D);
  const d = bestSlots(ctx, true, k.door)[0] ?? bestSlots(ctx, false, k.door)[0];
  if (d) {
    d.used = true;
    const x = fit(d, g.w, g.d);
    if (s3(d.xf.child(x, 0, 0), D)) {
      s3c(d.xf.child(x - 0.1, 0, g.d + 0.15, 2), pickOf(CHAIRS, d.cx * 3 + d.cz));
      spot(ctx, d.xf, x - 0.2, S3_TOP[D]! + 0.005, 0.35, 'table');
      // Рассыпанные папки — у стола.
      for (let i = 0; i < 5; i++) {
        const px = x + (ctx.rng() - 0.5) * 2;
        const pz = g.d + 0.5 + ctx.rng() * 0.7;
        d.xf.box([px, 0.003, pz], [px + 0.22, 0.02 + ctx.rng() * 0.03, pz + 0.3], MAT.paper, { tint: [0.8 + ctx.rng() * 0.2, 0.8, 0.65] });
      }
    }
  }
  const e = k.plan.entry;
  const cells = ctx.cells.slice().sort((a, b) => (e ? Math.hypot(b.xf.ox - e.x, b.xf.oz - e.z) - Math.hypot(a.xf.ox - e.x, a.xf.oz - e.z) : 0));
  let islands = 0;
  // Промежуток в кипах на средней полке слева — под вещь (её кладут не в каждый стеллаж).
  for (const c of ctx.cells.length >= 3 ? cells : []) {
    if (islands >= ctx.cells.length - 2) break;
    if (rackIsland(ctx, c, 'papers', { shelf: 3, x0: -0.52, x1: -0.26 }, 2)) {
      if (islands === 0) landmark(ctx, 'archive', c.xf, 0, 1.2, 0);
      islands += 1;
    }
  }
  let n = 0;
  for (const s of bestSlots(ctx, true, (q) => (k.plan.role(q) === 'near' ? -Infinity : k.side(q)))) {
    if (n >= 3) break;
    const x = fit(s, s3Size(RACK).w, 0.52);
    const at = rack(s.xf.child(x, 0, 0), s.cx * 37 + s.cz * 11 + n, 'papers', { shelf: 3, x0: -0.52, x1: -0.26 });
    if (!at) continue;
    if (n % 2 === 0) spot(ctx, s.xf, x + at.x, at.y, 0.3, 'shelf');
    if (islands === 0 && n === 0) landmark(ctx, 'archive', s.xf, 0, 1.2, 0.5);
    s.used = true;
    n += 1;
  }
}

function collapsed(ctx: RoomCtx): void {
  const c = ctx.cells[0];
  if (!c) return;
  // Завал лежит высокой стороной к глухой стене, открытой — к двери: иначе его не увидеть и не снять.
  const walls = new Set(ctx.slots.filter((s) => s.cx === c.cx && s.cz === c.cz).map((s) => s.dir));
  const door = [0, 1, 2, 3].find((d) => !walls.has(d)) ?? 0;
  // Поворот, при котором локальная ось +z завала смотрит на дверь.
  const rot = ([1, 0, 3, 2] as const)[door]!;
  const pile = c.xf.child(0, 0, 0, rot);
  collapse(pile, ctx.h, c.cx * 53 + c.cz * 29);
  landmark(ctx, 'collapse', pile, 0, 1.2, 0.2);
  spot(ctx, pile, 0, 0.02, 1.0, 'floor');
}

// ───────────────────────── домашние комнаты ─────────────────────────

/** Предмет в стопке на одном участке стены: имя, сдвиг вдоль стены, высота (для настенных — своя). */
export type HomeItem = readonly [name: string, dx?: number, y?: number];

/**
 * Поставить один или несколько предметов реестра на свободный участок стены. Глубокое (глубже 0,6 м)
 * — сначала туда, где нет дверей; в тесных комнатах допускается и у двери, если не глубже 0,75 м.
 * Настенные предметы (ковёр, окно, батарея) вешаются над низкой мебелью на тот же участок.
 */
export function homeStack(ctx: RoomCtx, items: readonly HomeItem[], score?: SlotScore, perSlot?: (s: Slot) => readonly (readonly HomeItem[])[]): Stacked | null {
  const specs = items.map(([n]) => ALL_PROPS[n]);
  if (specs.some((p) => !p)) return null;
  const { depth, half } = extent(items, specs as PropSpec[]);
  // Участки по порядку: глубокое (глубже 0,6 м) — сначала без дверей; в тесных комнатах — и у двери, если не глубже 0,75 м.
  // Главная вещь стопки (первая) врастала в соседнюю на этом участке (партнёр 18.11; world/clearance.ts) — следующий участок.
  // С оценкой (раскладка по смыслу, партнёр 19.11) — лучший по оценке участок; глубокому можно и в клетку с проходом, если
  // помещение держит проходы свободными (world/flow.ts): перегородить их вещь не даст правило.
  const tried = new Set<Slot>();
  const loose = flowActive();
  const next = (): Slot | null => {
    if (score) {
      const ok = (k: Slot): boolean => !tried.has(k) && (k.deep || depth <= 0.75 || loose);
      return bestSlots(ctx, false, (k) => (ok(k) ? score(k) + (k.deep ? 0.25 : 0) : -Infinity))[0] ?? null;
    }
    const pool = depth > 0.6 ? free(ctx, true).filter((k) => !tried.has(k)) : [];
    const more = depth <= 0.75 && pool.length === 0 ? free(ctx, false).filter((k) => !tried.has(k)) : [];
    return pool[0] ?? more[0] ?? null;
  };
  for (let s = next(); s; s = next()) {
    tried.add(s);
    // perSlot — стопки, зависящие от участка, по очереди (у кухонного ряда — холодильник у угла, потом у другого конца); габарит у
    // них тот же.
    for (const its of perSlot ? perSlot(s) : [items]) {
      const r = stackAt(ctx, s, its, perSlot ? (its.map(([n]) => ALL_PROPS[n]) as PropSpec[]) : (specs as PropSpec[]), half, depth);
      if (r) return r;
    }
  }
  return null;
}

/** Что встало: участок, сдвиг вдоль него, сиды вещей стопки, какие из них встали и какая это была стопка. */
export interface Stacked {
  s: Slot;
  x: number;
  seeds: number[];
  stood: boolean[];
  items: readonly HomeItem[];
}

/** Глубина стопки (без настенного) и половина её ширины вдоль стены. */
function extent(items: readonly HomeItem[], specs: readonly PropSpec[]): { depth: number; half: number } {
  let depth = 0;
  let half = 0;
  items.forEach(([, dx = 0], i) => {
    const p = specs[i]!;
    if (p.mount !== 'wall') depth = Math.max(depth, p.d);
    half = Math.max(half, Math.abs(dx) + p.w / 2);
  });
  return { depth, half };
}

/**
 * Стопка на заданном участке; at — где её середина вдоль стены (вещь напротив другой: телевизор по оси дивана), без него — как
 * ставит fit. null — участок занят или главная вещь здесь не встала.
 */
export function stackOn(ctx: RoomCtx, s: Slot, items: readonly HomeItem[], at?: number): Stacked | null {
  if (s.used || s.hazard) return null;
  const specs = items.map(([n]) => ALL_PROPS[n]);
  if (specs.some((p) => !p)) return null;
  const { depth, half } = extent(items, specs as PropSpec[]);
  return stackAt(ctx, s, items, specs as PropSpec[], half, depth, at);
}

/**
 * Стопка на участке s; null — главная вещь стопки здесь не встала (врастала в соседнюю), участок свободен. Сначала — где её
 * ставит fit; врастает — сдвиги вдоль той же стены, от угла (до 0,45 м, не дальше края стены), потом — другой участок.
 * Сиды тянутся один раз, по порядку вещей, как раньше: где ничего не врастает, раскладка та же до сантиметра.
 */
function stackAt(ctx: RoomCtx, s: Slot, items: readonly HomeItem[], specs: readonly PropSpec[], half: number, depth: number, at?: number): Stacked | null {
  const lim0 = Math.max(0, 1.35 - half);
  const x0 = at === undefined ? fit(s, half * 2, depth) : Math.max(-lim0, Math.min(lim0, at));
  const seeds = items.map(() => Math.floor(ctx.rng() * 1e6));
  const lim = Math.max(0, 1.35 - half);
  const xs = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45].map((d) => x0 + d).filter((x, i) => i === 0 || Math.abs(x) <= lim + 1e-9);
  // Сначала — сдвиг, при котором встаёт вся стопка; нет такого — первый, при котором встаёт хотя бы главная вещь (у стопки из
  // одной вещи это тот же проход — второй раз не пробовать).
  for (const whole of items.length > 1 ? [true, false] : [true]) {
    for (const x of xs) {
      const mark = markBuild(s.xf);
      const flats = ctx.flats.length;
      const hook = swapState();
      // Главная не встала — остальных и не строить.
      const stood: boolean[] = [];
      for (let i = 0; i < items.length; i++) stood.push(i === 0 || stood[0] === true ? buildAt(i, x) : false);
      if (stood[0] && (!whole || stood.every(Boolean))) {
        s.used = true;
        return { s, x, seeds, stood, items };
      }
      if (mark) rewindBuild(s.xf, mark);
      ctx.flats.length = flats;
      restoreSwap(hook);
      if (!mark) break;
    }
  }
  return null;

  /** Вещь i стопки при сдвиге x; false — не встала (врастала в соседнюю). */
  function buildAt(i: number, x: number): boolean {
    const [name, dx = 0, y] = items[i]!;
    const p = specs[i]!;
    const seed = seeds[i]!;
    const at = s.xf.child(x + dx, p.mount === 'wall' ? (y ?? p.y ?? 1.2) : 0, 0);
    if (p.mount === 'floor' && isFlat(ctx, s, name, i)) {
      // Картонка: стоит там же, где стоял бы настоящий предмет, но это лист — и преграды у неё нет. Поэтому и проверка «не
      // врастать» её не видела: лист вставал внутрь соседней вещи (картонный холодильник — в кухонный стол, 19.11). Сначала —
      // пробный настоящий предмет: не встал бы он — не встаёт и картонка; встал — откатываем его и ставим лист.
      const probe = markBuild(s.xf);
      if (probe) {
        const flats0 = ctx.flats.length;
        const hook0 = swapState();
        const real = (s.deep ? p.build(at, seed) : withOpenness(0, () => p.build(at, seed))) !== false;
        rewindBuild(s.xf, probe);
        ctx.flats.length = flats0;
        restoreSwap(hook0);
        if (!real) return false;
      }
      const sheet = new Xf(at.mb, null, at.ox, at.oy, at.oz, at.rot, at.sl);
      let r = { w: p.w, h: p.h, plane: 0 };
      let built = false;
      asObject(sheet, name, () => {
        r = standee(sheet, p, seed);
        built = true;
      }, true);
      // Убранную или передвинутую партнёром картонку хук сборки не строит (world/objects.ts): тогда и метки картонки нет —
      // иначе на её месте осталась бы «картонка», через которую можно пройти, а передвинутая вещь вернулась бы туда настоящей.
      if (built) ctx.flats.push({ kind: 'standee', what: name, at: at.pt(0, Math.min(FLAT_EYE, r.h * 0.6), r.plane), n: at.dir(0, 0, 1), w: r.w, h: r.h, floor: at.oy, room: ctx.room.id, tier: ctx.room.tier });
      return true;
    }
    // У проёма (в клетке с дверью) — закрыто: выдвинутый ящик и распахнутая дверца не заходят в горло прохода.
    return (s.deep ? p.build(at, seed) : withOpenness(0, () => p.build(at, seed))) !== false;
  }
}

/** Имена вещей, уже стоящих в помещении (по журналу объектов уровня): чтобы не повторять того, что в комнате есть. */
export function roomThings(ctx: RoomCtx): Set<string> {
  const out = new Set<string>();
  const c0 = ctx.cells[0];
  const log = c0?.xf.mb.log;
  if (!c0 || !log) return out;
  const cells = new Set(ctx.cells.map((c) => `${c.cx},${c.cz}`));
  const dx = c0.cx - c0.xf.ox / CELL;
  const dz = c0.cz - c0.xf.oz / CELL;
  for (const o of log.list) {
    if (o.at[1] < c0.xf.oy - 0.1 || o.at[1] > c0.xf.oy + ctx.h + 0.1) continue;
    if (cells.has(`${Math.round(o.at[0] / CELL + dx)},${Math.round(o.at[2] / CELL + dz)}`)) out.add(o.name);
  }
  return out;
}

// ───────────── раскладка по смыслу (партнёр 19.11, 14:33: «расставь мебель по-новому и логично») ─────────────

/** Оценка участка стены для вещи: больше — лучше; −Infinity — сюда нельзя. */
export type SlotScore = (s: Slot) => number;

/** Свободные участки по оценке, лучшие первыми; при равной — в порядке сида (free тасует их по ГСЧ помещения). */
export function bestSlots(ctx: RoomCtx, deep: boolean, score: SlotScore): Slot[] {
  return free(ctx, deep)
    .map((s, i) => ({ s, i, k: score(s) }))
    .filter((e) => e.k > -Infinity)
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((e) => e.s);
}

/** Координата вдоль участка s (его ось x, от середины) для точки мира (wx, wz). */
export function xOn(s: Slot, wx: number, wz: number): number {
  const a = s.xf.pt(1, 0, 0);
  return (wx - s.xf.ox) * (a[0] - s.xf.ox) + (wz - s.xf.oz) * (a[2] - s.xf.oz);
}

/**
 * Оценки участков стены относительно главного входа (world/room_plan.ts) — словарь раскладки:
 *   hero — главная вещь комнаты: в створе входа, иначе напротив, иначе сбоку; на стене входа — в последнюю очередь;
 *   side — вторая по важности: сбоку (с порога видна в профиль и не заслоняет главную), иначе напротив вне створа;
 *   door — то, чем пользуются, входя и выходя (шкаф, вешалка, шкафчики): ближе ко входу;
 *   near(x, z) — ближе к точке мира (вещь при другой вещи: кресло у дивана).
 */
export function roles(ctx: RoomCtx): { plan: RoomPlan; hero: SlotScore; side: SlotScore; door: SlotScore; near: (x: number, z: number) => SlotScore } {
  const plan = planOf(ctx);
  return {
    plan,
    hero: (s) => (plan.framed(s) ? 3 : plan.role(s) === 'far' ? 2 : plan.role(s) === 'side' ? 1 : 0),
    side: (s) => (plan.role(s) === 'side' ? 2 : plan.role(s) === 'far' ? (plan.framed(s) ? 1 : 1.5) : 0),
    door: (s) => -plan.toEntry(s) / 3 + (plan.role(s) === 'near' ? 0.5 : 0),
    near: (x, z) => (s) => -Math.hypot(s.xf.ox - x, s.xf.oz - z),
  };
}

/** Ковёр на полу (свободная вещь) серединой в точке xf. */
function rugOn(ctx: RoomCtx, xf: Xf): void {
  ALL_PROPS.rug!.build(xf, Math.floor(ctx.rng() * 1e6));
}

/**
 * Выставочный экран на свободный участок стены (прислонённый или висящий) либо посреди клетки (на
 * подставке). Что на нём — решает сид уровня и место: картинка из родов kinds. Возвращает, поставлен ли.
 */
export function screenAt(ctx: RoomCtx, xf: Xf, shape: DisplayShape, kinds: readonly ScreenKind[], salt: number, fixed?: number): void {
  // fixed — картинка задана заранее (жёлтые комнаты: два экрана на уровень показывают разное).
  const image = fixed ?? screenFor(Math.floor(hash01(Math.round(xf.ox * 7) + salt, Math.round(xf.oz * 11) + ctx.room.id, ctx.seed ^ 0x5c4e) * 1e6), kinds);
  // Экран-проём — отдельное имя: игра по нему знает, что касание переносит, а не только растворяет.
  asObject(xf, image === DOOR_IMAGE ? DOOR_NAME : `display_${shape}`, () => buildDisplay(xf, shape, image));
  const [w, h] = DISPLAY_SIZE[shape];
  // Метка — середина картинки: у прислонённого экрана она на полпути между стеной и его низом.
  const z = shape === 'lean' ? 0.26 : shape === 'wall' ? 0.07 : 0.03;
  const y = shape === 'wall' ? h / 2 : shape === 'lean' ? h * 0.49 : 0.07 + h / 2;
  ctx.flats.push({ kind: 'screen', what: SCREEN_IMAGES[image]!.id, at: xf.pt(0, y, z), n: xf.dir(0, 0, 1), w, h, floor: shape === 'wall' ? xf.oy - 1.05 : xf.oy, room: ctx.room.id, tier: ctx.room.tier });
}

/**
 * Прислонить экраны к свободным стенам помещения: не больше count, каждый — с вероятностью rate на
 * участок. Решает сид уровня и место, а не ГСЧ помещения: остальная обстановка от этого не сдвигается.
 */
export function leanScreens(ctx: RoomCtx, count: number, rate: number, kinds: readonly ScreenKind[], images?: readonly number[]): number {
  let placed = 0;
  for (const s of ctx.slots) {
    if (placed >= count) break;
    if (s.used || s.hazard) continue;
    // В коридоре экран у двери мешал бы пройти: там ему нужен участок без проходов рядом.
    if (ctx.room.type === 'corridor' && ctx.cells.find((c) => c.cx === s.cx && c.cz === s.cz)!.doors > 0) continue;
    if (hash01(s.cx * 37 + s.dir * 5, s.cz * 41 + ctx.room.id, ctx.seed ^ 0xd15b) >= rate) continue;
    s.used = true;
    screenAt(ctx, s.xf.child(fit(s, 1.2, 0.52), 0, 0), 'lean', kinds, s.dir, images?.[placed]);
    placed += 1;
  }
  return placed;
}

/**
 * Какие предметы бывают картонками: только мебель у стены, на которой ничего не лежит и к которой
 * не привязаны ни находки, ни приметы.
 */
export const FLAT_OK: ReadonlySet<string> = new Set([
  'wardrobe',
  'bookshelf',
  'fridge',
  'stove',
  'armchair',
  'floor_lamp',
  'houseplant',
  'washing_machine',
  'christmas_tree',
  'wall_unit',
  'filing_cabinet',
  'water_cooler',
  'binder_shelf',
  'vending_machine',
  'server_rack',
  'armchair_visitor',
  'floor_lamp_brass',
]);

/**
 * Доля картонок среди такой мебели. Чем «ложнее» воспоминание, тем больше в нём снимков вместо вещей:
 * офис был на самом деле, убежище и жёлтые комнаты собраны из чужих картинок. Но плоским бывает лишь
 * кое-что (решение партнёра): картонка — редкая находка, а не правило.
 */
export const FLAT_SHARE: Record<WorldKind, number> = { shelter: 0.12, office: 0.04, yellow: 0.2, station: 0.06 };

/** Быть ли предмету картонкой: решают сид уровня и место, а не ГСЧ помещения — остальная обстановка от этого не сдвигается. */
function isFlat(ctx: RoomCtx, s: Slot, name: string, i: number): boolean {
  if (!FLAT_OK.has(name)) return false;
  // Чем сильнее стёрто место, тем больше в нём снимков вместо вещей (но не всё подряд).
  return hash01(s.cx * 131 + s.dir * 7 + i, s.cz * 173 + ctx.room.id * 3, ctx.seed ^ 0xf1a7) < Math.min(0.7, FLAT_SHARE[ctx.world] * (ctx.decay?.flats ?? 1));
}

/**
 * Проекции в коридоре: комнаты, которых нет, поперёк прямых участков. Издали — освещённая комната
 * в конце коридора; вблизи — картинка из света, сквозь которую можно пройти. Ставятся не ближе
 * четырёх клеток от начала вылазки и не ближе шести друг к другу, только там, где по бокам глухие
 * стены. Смотрит проекция в одну сторону: с изнанки её нет. only — какие клетки годятся (в жёлтых
 * комнатах — только тёмные: свет проекцию смывает).
 */
export function veils(ctx: RoomCtx, count: number, only: (c: CellInfo) => boolean = () => true): void {
  if (count <= 0) return;
  const has = new Set(ctx.cells.map((c) => `${c.cx},${c.cz}`));
  const risky = new Set(ctx.slots.filter((s) => s.hazard).map((s) => `${s.cx},${s.cz}`));
  const found: { c: CellInfo; alongX: boolean; rank: number }[] = [];
  for (const c of ctx.cells) {
    if (c.doors > 0 || risky.has(`${c.cx},${c.cz}`) || !only(c)) continue;
    const e = has.has(`${c.cx + 1},${c.cz}`);
    const w = has.has(`${c.cx - 1},${c.cz}`);
    const n = has.has(`${c.cx},${c.cz - 1}`);
    const s = has.has(`${c.cx},${c.cz + 1}`);
    const alongX = e && w && !n && !s;
    const alongZ = n && s && !e && !w;
    if (!alongX && !alongZ) continue;
    if (ctx.room.tier === ctx.start.tier && Math.abs(c.cx - ctx.start.cx) + Math.abs(c.cz - ctx.start.cz) < 4) continue;
    found.push({ c, alongX, rank: hash01(c.cx * 53 + 11, c.cz * 97 + ctx.room.tier * 7, ctx.seed ^ 0x7e11) });
  }
  found.sort((a, b) => a.rank - b.rank);
  const scenes = VEIL_SCENES.filter((sc) => sc.items.every(([name]) => ALL_PROPS[name]));
  const placed: CellInfo[] = [];
  for (const f of found) {
    if (placed.length >= count || scenes.length === 0) break;
    if (placed.some((p) => Math.abs(p.cx - f.c.cx) + Math.abs(p.cz - f.c.cz) < 6)) continue;
    const flip = hash01(f.c.cx * 29, f.c.cz * 31, ctx.seed ^ 0x51de) < 0.5;
    // Локальная ось +z — на зрителя: вдоль коридора в одну из двух сторон.
    const rot = (f.alongX ? (flip ? 1 : 3) : flip ? 0 : 2) as 0 | 1 | 2 | 3;
    const scene = scenes[(Math.floor(hash01(ctx.room.tier * 13 + 5, ctx.room.id, ctx.seed ^ 0x5ce2) * scenes.length) + placed.length) % scenes.length]!;
    const xf = f.c.xf.child(0, 0, 0, rot);
    const r = veil(xf, scene, ALL_PROPS, Math.floor(f.rank * 1e6), CELL - WALL_T, ctx.h);
    if (!r) continue;
    placed.push(f.c);
    ctx.flats.push({ kind: 'veil', what: scene.id, at: xf.pt(0, FLAT_EYE, 0), n: xf.dir(0, 0, 1), w: r.w, h: r.h, floor: xf.oy, room: ctx.room.id, tier: ctx.room.tier });
  }
}

/** Клетка для центральных предметов: лучше без проходов. */
export function homeCentre(ctx: RoomCtx): CellInfo {
  return ctx.cells.find((c) => c.doors === 0) ?? ctx.cells[0]!;
}

/** Места для вещей на полу: свободные точки у центров клеток, по кругу, чтобы не налезали друг на друга. */
export function floorSpots(ctx: RoomCtx, n: number): void {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.55, 0.4],
    [-0.5, -0.45],
    [0.45, -0.5],
  ];
  const cells = ctx.cells;
  let made = 0;
  /** Уже занятые точки: «клетка:точка». Две вещи в одной точке — одна в другой (и темнота, меняя их местами, не сдвинет ни одну). */
  const taken = new Set<string>();
  for (let i = 0; made < n && i < n + cells.length * offsets.length; i++) {
    const ci = i % cells.length;
    const c = cells[ci]!;
    // Не под мебелью, не под выдвинутым ящиком и не в распахнутой дверце: из четырёх точек клетки — первая свободная от
    // преград и не занятая. Свободной нет (клетку занял стол переговорной, кабинка) — эту клетку пропустить: вещь внутри преграды
    // не видна ни взгляду, ни лучу (CI 18.11).
    const k0 = Math.floor(i / cells.length) % offsets.length;
    let k = -1;
    for (let j = 0; j < offsets.length; j++) {
      const kk = (k0 + j) % offsets.length;
      const [x, z] = offsets[kk]!;
      if (!taken.has(`${ci}:${kk}`) && !blocked(c.xf, x, z)) {
        k = kk;
        break;
      }
    }
    if (k < 0) continue;
    taken.add(`${ci}:${k}`);
    const [ox, oz] = offsets[k]!;
    spot(ctx, c.xf, ox, 0.03, oz, 'floor');
    made += 1;
  }
}

/**
 * Точка пола (x, z в клетке) под преградой или ближе 15 см к ней. Высота — от пола этой клетки: на нижних ярусах пол ниже нуля
 * (до 19.11 сравнивалось с нулём мира, и там проверка не видела ничего — места ложились в мебель, а потом их отбрасывала
 * проверка «не закопано», dropBuried).
 */
function blocked(xf: Xf, x: number, z: number): boolean {
  if (!xf.col) return false;
  const p = xf.pt(x, 0.03, z);
  const m = 0.15;
  const y = p[1];
  return xf.col.boxes.some((b) => p[0] > b.minX - m && p[0] < b.maxX + m && p[2] > b.minZ - m && p[2] < b.maxZ + m && b.minY < y + 0.47 && b.maxY > y - 0.03);
}

// Домашние комнаты расставлены по смыслу (партнёр 19.11, 14:33; docs/vylazka/design.md, §31): главная вещь — напротив входа,
// вещи стоят группами по делу, проходы свободны (world/flow.ts), стены не заставлены сплошь — пустое место тоже часть комнаты.

function kitchen(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Стол — главная вещь кухни: напротив входа, под окном в никуда. С порога видно стол и светлое окно над ним — свет тянет
  // взгляд в комнату. Вещь воспоминания — на клеёнке, слева от тарелки.
  const table = homeStack(ctx, [['kitchen_table'], ['window_fake']], k.hero);
  if (table) {
    landmark(ctx, 'kitchen', table.s.xf, table.x, 0.7, 0.4);
    // Свободный край столешницы слева от тарелки — на клеёнке (props_home.ts, kitchenTable).
    spot(ctx, table.s.xf, table.x - 0.42, S3_TOP.s3_table_kitchen! + 0.006, 0.2, 'table');
    // У стены, под окном — банка с цветами (партнёр 19.11, 21:27: цветы «и в другие помещения»): головки поворачиваются к свету,
    // как в оранжерее. Сид — от места, а не от ГСЧ помещения: остальная обстановка кухни от неё не сдвигается.
    ALL_PROPS.jar_flowers?.build(table.s.xf.child(table.x + 0.06, S3_TOP.s3_table_kitchen! + 0.006, 0.13), hash2(ctx.seed, ctx.room.id, 0x3a1f) >>> 0);
  }
  // Рабочая линия — одним рядом у боковой стены: мойка посередине, плита и холодильник по бокам — путь «холодильник —
  // мойка — плита» короткий, как на настоящей кухне.
  // Холодильник — первым в стопке: он есть в каждой кухне (его передвигает партнёр — правка ссылается на первый холодильник
  // кухни), даже если мойка с плитой рядом не встали; тогда они ищут место ближе к нему.
  // Холодильник — к углу: на тот конец ряда, где у стены угол (партнёр уводил холодильник в угол во всех кухнях — его правка
  // стала правилом генератора: куратор, пачка 50, противоречие 299). Участок — тот, что выберет ряд; углов два или нет —
  // как выпадет (жребий тянется всегда: иначе сдвинулись бы вещи дальше в комнате, а правки партнёра ссылаются на них).
  const coin = ctx.rng() < 0.5 ? -1 : 1;
  const sinkHalf = ALL_PROPS.sink_cabinet!.w / 2;
  const fx = sinkHalf + ALL_PROPS.fridge!.w / 2 + 0.02;
  const sx = sinkHalf + ALL_PROPS.stove!.w / 2 + 0.02;
  // f = 1 — холодильник на конце −x участка (угол cornerL), −1 — на конце +x (cornerR). На каждом участке, который пробует ряд, —
  // сначала холодильник у угла, потом у другого конца: «угол» бывает и дверью, и у двери холодильнику не встать.
  const lineOf = (f: number): HomeItem[] => [['fridge', -f * fx], ['sink_cabinet'], ['stove', f * sx]];
  const line = homeStack(ctx, lineOf(coin), k.side, (q) => {
    const f = q.cornerL !== q.cornerR ? (q.cornerL ? 1 : -1) : coin;
    return [lineOf(f), lineOf(-f)];
  });
  if (line) {
    const f = line.s.xf.pt(line.x + (line.items[0]![1] ?? 0), 0, 0);
    if (!line.stood[1]) homeStack(ctx, [['sink_cabinet']], k.near(f[0], f[2]));
    if (!line.stood[2]) homeStack(ctx, [['stove']], k.near(f[0], f[2]));
  }
  // Батарея — одна на кухню: её передвигает партнёр (правка ссылается на первую батарею кухни).
  homeStack(ctx, [['radiator']], k.side);
  floorSpots(ctx, table ? 2 : 3);
}

/** Глубина помещения перед участком s: от его стены до противоположной, м (клетки подряд по нормали участка). */
function depthAt(ctx: RoomCtx, s: Slot): number {
  const has = new Set(ctx.cells.map((c) => `${c.cx},${c.cz}`));
  const nx = -DX[s.dir]!;
  const nz = -DZ[s.dir]!;
  let n = 1;
  while (has.has(`${s.cx + nx * n},${s.cz + nz * n}`)) n += 1;
  return n * CELL - WALL_T;
}

/** Точка (x, z мира) внутри помещения не ближе m к его стенам. */
function inRoom(ctx: RoomCtx, p: Vec3, m: number): boolean {
  return ctx.cells.some((c) => {
    const dx = p[0] - c.xf.ox;
    const dz = p[2] - c.xf.oz;
    const lim = (d: number): number => (c.sides?.[d] === 'inner' ? CELL / 2 : CELL / 2 - WALL_T / 2 - m);
    return dx <= lim(0) && dz <= lim(1) && -dx <= lim(2) && -dz <= lim(3);
  });
}

/** От дивана до экрана — не дальше этого (от стены до стены), м: иначе диван выходит на середину комнаты. */
const SOFA_REACH = 3.6;
/** Сколько между экраном и сиденьем дивана, вынесенного на середину комнаты, м. */
const SOFA_VIEW = 2.2;

/**
 * Журнальный столик (полка Sand3D, третий подбор 19.11) серединой в xf, длинной стороной вдоль дивана: на нём место для вещи
 * воспоминания (пульт, кружка). Где столик отрезал бы проход (world/flow.ts) — его нет.
 */
function coffeeTable(ctx: RoomCtx, xf: Xf): void {
  if (s3c(xf, 's3_coffee_table')) spot(ctx, xf, 0.25, S3_TOP.s3_coffee_table! + 0.005, 0.05, 'table');
}

function living(ctx: RoomCtx): void {
  // Люстра в одной клетке, в остальных — обычные лампы.
  const centre = homeCentre(ctx);
  ctx.cells.forEach((c, i) => {
    if (ctx.sky) return;
    if (c === centre) hanging(c.xf, () => ALL_PROPS.chandelier!.build(c.xf.child(0, ctx.h, 0), 0));
    else if (i % 2 === 0) hanging(c.xf, () => cageLamp(c.xf.child(0, ctx.h, 0)));
  });
  const k = roles(ctx);
  const plan = k.plan;
  const sofaD = ALL_PROPS.sofa!.d;
  const tvD = ALL_PROPS.tv_stand!.d;
  const side = ctx.rng() < 0.5 ? -1 : 1;
  // Пара «диван — телевизор» (диван смотрит на экран, ковёр между ними, кресло рядом). Узкая комната: диван у стены напротив
  // входа, под ковром на стене, торшер сбоку; телевизор на стене напротив дивана, по его оси. Широкая (до противоположной стены
  // дальше SOFA_REACH): телевизор у стены напротив входа, диван вынесен на середину комнаты лицом к нему — с порога видны
  // спинка дивана и экран за ней (кто-то мог бы там сидеть).
  const near = (s: Slot): boolean => {
    const o = plan.opposite(s);
    return o !== undefined && !o.used && !o.hazard && depthAt(ctx, s) <= SOFA_REACH;
  };
  const wide = bestSlots(ctx, false, (s) => (depthAt(ctx, s) >= tvD + SOFA_VIEW + sofaD + 1.0 ? k.hero(s) : -Infinity))[0];
  const narrow = bestSlots(ctx, false, (s) => (near(s) ? k.hero(s) : -Infinity))[0];
  let front: Vec3 | null = null;
  let tvSlot: Slot | null = null;
  if (narrow) {
    const sofa = stackOn(ctx, narrow, [['sofa', -side * 0.24], ['wall_carpet', -side * 0.24], ['floor_lamp', side * 1.1]]);
    if (sofa) {
      const sx = sofa.x - side * 0.24;
      landmark(ctx, 'living', sofa.s.xf, sx, 0.6, 0.45);
      const at = sofa.s.xf.pt(sx, 0, 0);
      front = sofa.s.xf.pt(sx, 0, 1.5);
      const o = plan.opposite(sofa.s)!;
      const tv = stackOn(ctx, o, [['tv_stand']], xOn(o, at[0], at[2]));
      if (tv) tvSlot = tv.s;
      const mid = (sofaD + depthAt(ctx, sofa.s) - tvD) / 2;
      rugOn(ctx, sofa.s.xf.child(sx, 0, mid));
      coffeeTable(ctx, sofa.s.xf.child(sx, 0, mid));
    }
  }
  if (!front && wide) {
    const tv = stackOn(ctx, wide, [['tv_stand']]);
    if (tv) {
      tvSlot = tv.s;
      // Диван развёрнут к экрану: его спинка — на SOFA_VIEW + глубина дивана от экрана.
      const back = tvD + SOFA_VIEW + sofaD;
      const seed = Math.floor(ctx.rng() * 1e6);
      if (ALL_PROPS.sofa!.build(tv.s.xf.child(tv.x, 0, back, 2), seed) !== false) {
        landmark(ctx, 'living', tv.s.xf, tv.x, 0.6, back - sofaD / 2);
        front = tv.s.xf.pt(tv.x, 0, tvD + SOFA_VIEW * 0.5);
        const lampSeed = Math.floor(ctx.rng() * 1e6);
        // Торшер у края дивана — с той стороны, где до стены помещения есть место.
        for (const sd of [side, -side]) {
          const at = tv.s.xf.child(tv.x + sd * (ALL_PROPS.sofa!.w / 2 + 0.35), 0, back, 2);
          if (inRoom(ctx, at.pt(0, 0, 0.225), 0.3) && ALL_PROPS.floor_lamp!.build(at, lampSeed) !== false) break;
        }
        rugOn(ctx, tv.s.xf.child(tv.x, 0, tvD + SOFA_VIEW / 2 + 0.1));
        coffeeTable(ctx, tv.s.xf.child(tv.x, 0, back - sofaD - 0.75));
        homeStack(ctx, [['wall_carpet']], k.side);
      }
    }
  }
  if (front) {
    const f = front;
    // Кресло — у ближней к дивану стены, но не у экрана и не рядом с диваном на одной стене.
    homeStack(ctx, [['armchair']], (s) => (s === tvSlot || s.dir === tvSlot?.dir ? -Infinity : k.near(f[0], f[2])(s)));
  } else {
    // Пары не вышло: диван — главная вещь у стены, телевизор — где встанет, но не рядом с диваном на одной стене.
    const sofa = homeStack(ctx, [['sofa'], ['wall_carpet']], k.hero);
    if (sofa) {
      landmark(ctx, 'living', sofa.s.xf, sofa.x, 0.6, 0.45);
      const f = sofa.s.xf.pt(sofa.x, 0, 1.5);
      homeStack(ctx, [['tv_stand']], (s) => (s.dir === sofa.s.dir ? -Infinity : k.near(f[0], f[2])(s)));
    }
    rugOn(ctx, centre.xf.child(0, 0, 0));
  }
  // Книжный шкаф — сбоку; окно с батареей под ним — на свободной стене, лучше напротив входа.
  if (ctx.rng() < 0.8) homeStack(ctx, [['bookshelf']], k.side);
  if (ctx.rng() < 0.7) homeStack(ctx, [['radiator'], ['window_fake']], k.hero);
  if (ctx.rng() < 0.6) homeStack(ctx, [['houseplant']], k.side);
  // Ёлка стоит не везде и не всегда: сон помнит праздник выборочно.
  if (ctx.rng() < 0.15) homeStack(ctx, [['christmas_tree']], k.side);
  floorSpots(ctx, 3);
}

function bedroom(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Кровать — главная вещь, напротив входа; тумбочка у изголовья — на ней место для вещи воспоминания (будильник, ночник).
  // Изголовье с любой стороны: у железной кровати спинки одинаковые.
  const head = ctx.rng() < 0.5 ? -1 : 1;
  const items: HomeItem[] = [['bed_home', -head * 0.28], ['s3_nightstand', head * 1.06]];
  if (ctx.rng() < 0.6) items.push(['wall_carpet', -head * 0.28]);
  const bed = homeStack(ctx, items, k.hero);
  if (bed) {
    landmark(ctx, 'bedroom', bed.s.xf, bed.x - head * 0.28, 0.55, 0.5);
    if (bed.stood[1]) spot(ctx, bed.s.xf, bed.x + head * 1.06, S3_TOP.s3_nightstand! + 0.005, 0.2, 'table');
    // Коврик у кровати, со стороны, с которой встают.
    rugOn(ctx, bed.s.xf.child(bed.x - head * 0.28, 0, 1.12 + 0.72));
  }
  // Платяной шкаф — у входа; комод с зеркалом над ним — сбоку; окно с батареей — на свободной стене, лучше напротив входа.
  homeStack(ctx, [['wardrobe']], k.door);
  homeStack(ctx, [['s3_dresser'], ['mirror', 0, 1.15]], k.side);
  homeStack(ctx, [['radiator'], ['window_fake']], k.hero);
  if (ctx.rng() < 0.5) homeStack(ctx, [['floor_lamp']], k.side);
  floorSpots(ctx, 3);
}

function bathroom(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Ванна со шторкой — у дальней стены (её видно с порога), стиральная машина — рядом с ней.
  const flip = ctx.rng() < 0.5 ? -1 : 1;
  // Ванна и машина бок о бок: общий охват — по ширине обеих, ванна — к одному краю участка.
  const tubW = ALL_PROPS.bathtub!.w;
  const wmW = ALL_PROPS.washing_machine!.w;
  const tx = -flip * (wmW + 0.02) / 2;
  const wx = flip * (tubW + 0.02) / 2;
  const tub = homeStack(ctx, [['bathtub', tx], ['washing_machine', wx]], k.hero);
  if (tub) landmark(ctx, 'bathroom', tub.s.xf, tub.x + tx, 0.6, 0.4);
  // Раковина (полка Sand3D) с зеркалом над ней и унитаз рядом — у боковой стены. Ванна не встала (тесно) — примета на раковине.
  const sink = homeStack(ctx, [['s3_sink_pedestal', flip * 0.45], ['mirror', flip * 0.45, 1.0], ['toilet_home', -flip * 0.55]], tub ? k.side : k.hero);
  if (!tub && sink) landmark(ctx, 'bathroom', sink.s.xf, sink.x + flip * 0.45, 0.6, 0.3);
  // Сушилка с бельём — только где есть место: в тесной ванной её нет.
  if (ctx.cells.length > 1) homeStack(ctx, [['clothes_dryer']], k.side);
  floorSpots(ctx, 2);
}

function nursery(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Кроватка — главная вещь, с порога; игрушки — рядом с ней, у той же или соседней стены.
  const crib = homeStack(ctx, [['crib']], k.hero);
  if (crib) {
    landmark(ctx, 'nursery', crib.s.xf, crib.x, 0.6, 0.35);
    const c = crib.s.xf.pt(crib.x, 0, 0.5);
    homeStack(ctx, [['toy_heap']], (s) => k.near(c[0], c[2])(s));
  } else homeStack(ctx, [['toy_heap']], k.hero);
  // Стол с компьютером — сбоку; справа от монитора столешница свободна.
  const desk = homeStack(ctx, [['desk_pc']], k.side);
  if (desk) spot(ctx, desk.s.xf, desk.x + 0.42, S3_TOP.s3_desk_simple! + 0.004, 0.25, 'table');
  // Окно — на свободной стене, лучше напротив входа; книжный шкаф — у входа.
  homeStack(ctx, [['window_fake']], k.hero);
  homeStack(ctx, [['bookshelf']], k.door);
  rugOn(ctx, homeCentre(ctx).xf.child(0, 0, 0));
  floorSpots(ctx, desk ? 2 : 3);
}

function hallway(ctx: RoomCtx): void {
  lamps(ctx);
  const k = roles(ctx);
  // Вешалка — у входа: первое, что в прихожей под рукой.
  const rack = homeStack(ctx, [['coat_rack']], k.door);
  if (rack) landmark(ctx, 'hallway', rack.s.xf, rack.x, 1.1, 0.25);
  // Зеркало — одно, сбоку; под ним иногда гладильная доска (зеркало выше, чтобы доска не вросла в раму).
  const wall: HomeItem[] = [['mirror', -0.3, 1.0]];
  if (ctx.rng() < 0.5) wall.push(['ironing_board', 0.45]);
  homeStack(ctx, wall, k.side);
  // Сорванная створка прислонена у дальней стены: дверь отсюда вынесли — странность с причиной.
  if (ctx.rng() < 0.6) homeStack(ctx, [['door_leaf_lean']], k.hero);
  floorSpots(ctx, ctx.cells.length > 1 ? 3 : 2);
}

function stairwell(_ctx: RoomCtx): void {
  // В шахте лестницы пусто: ни ламп, ни труб — ничто не должно выдавать, сколько пройдено.
}

/** Помещения убежища и вросшего в него дома. Остальные роды помещений — из других миров (furnish_office.ts). */
const FURNISH: Partial<Record<GenRoom['type'], (ctx: RoomCtx) => void>> = {
  corridor,
  entrance,
  airlock,
  stairwell,
  dorm,
  command,
  medical,
  storage,
  washroom,
  fvu,
  diesel,
  tanks,
  switchboard,
  archive,
  collapsed,
  kitchen,
  living,
  bedroom,
  bathroom,
  nursery,
  hallway,
};

/** Обставить помещение. Порядок вызовов и ГСЧ фиксированы: один сид — одна и та же обстановка. */
export function furnishRoom(ctx: RoomCtx): void {
  const flow = flowFor(ctx);
  const log = ctx.cells[0]?.xf.mb.log;
  if (flow) flow.from = log?.list.length ?? 0;
  withOpenness(roomOpenness(ctx.world, ctx.seed, ctx.room.id), () => withFlow(flow, () => {
    // Стене лиц, карте и стене чемоданов нужна голая стена: их участки отводятся до мебели.
    reservePapers(ctx);
    // Офис стерилен, жёлтые комнаты пусты: у них своя обстановка и нет «следов людей» убежища.
    if (ctx.world === 'office') return furnishOffice(ctx);
    if (ctx.world === 'yellow') return furnishYellow(ctx);
    if (ctx.world === 'station') return furnishStation(ctx);
    FURNISH[ctx.room.type]?.(ctx);
    // Сначала — то, что положено помещению по назначению, потом — следы людей и времени.
    dressRoom(ctx);
  }));
  if (flow) {
    flow.to = log?.list.length ?? 0;
    flowDone(flow);
  }
}

/** Где мебель держит проходы свободными (world/flow.ts): комнаты убежища и офиса; коридоры, марши и завалы — нет. */
const FLOW_SKIP: ReadonlySet<string> = new Set(['corridor', 'stairwell', 'collapsed', 'lift', 'track']);
function flowFor(ctx: RoomCtx): RoomFlow | null {
  if (ctx.world !== 'shelter' && ctx.world !== 'office') return null;
  if (FLOW_SKIP.has(ctx.room.type) || !ctx.cells.some((c) => c.sides)) return null;
  return new RoomFlow(ctx);
}

/**
 * Как оставили помещение (партнёр 18.11: «открой дверцы и ящики у шкафов»; куратор, «Комната, из которой ушли»): из трети
 * комнат уходили второпях — открыто почти всё; в половине — как обычно; остальные прибраны, закрыто всё. Жёлтые комнаты
 * пусты и чисты — там закрыто везде. Доля одна на помещение, а не на вещь: открытое читается комнатой, а не рассыпью. Её же
 * берут вещи партнёра «как выпадет» и передвинутые вещи игры (world/level_build.ts): они строятся после обстановки.
 */
export function roomOpenness(world: WorldKind, seed: number, room: number): number {
  if (world === 'yellow') return 0;
  const r = hash2(seed, room, 0x0e1) / 4294967296;
  return r < 0.33 ? 0.95 : r < 0.83 ? 0.6 : 0;
}

/** Подпись-табличка над дверью со стороны коридора (слабое фосфорное свечение помогает ориентироваться). */
export function doorSign(xf: Xf): void {
  signPlate(xf, 0.62, 0.15);
}
