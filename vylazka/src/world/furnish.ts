/**
 * Расстановка реквизита по типам помещений. Помещение даёт «слоты»: участки стен по 2,7 м
 * (предметы ставятся спиной к стене) и центры клеток. Каждая функция обставляет свой тип комнаты,
 * регистрирует места для находок и приметные объекты — цели «снять на камеру».
 */
import { hash01, hash2 } from '../core/rng';
import type { Rng } from '../core/rng';
import { dressRoom } from './dress';
import { FLAT_EYE, standee, veil, VEIL_SCENES } from './flat';
import type { FlatMark } from './flat';
import type { GenRoom, WorldKind } from '../gen/layout';
import { reservePapers } from './furnish_papers';
import type { PaperHold, PaperState } from './furnish_papers';
import { furnishOffice, furnishYellow } from './furnish_office';
import { furnishStation } from './furnish_station';
import type { Decay } from '../systems/decay';
import type { ItemSpot, Landmark } from './level';
import { MAT } from './materials';
import { ALL_PROPS } from './props_all';
import { asObject, hanging } from './objects';
import { barrel, cables, cageLamp, crate, pipeRun, rubble, signPlate, valve, ventGrille } from './props';
import { fillShelves, jitter, pickOf, s3Put, s3Size, S3_BED, S3_SHELVES, S3_TOP } from './furniture';
import { buildDisplay, DISPLAY_SIZE } from './props_screens';
import type { DisplayShape } from './props_screens';
import { DOOR_IMAGE, DOOR_NAME, SCREEN_IMAGES, screenFor } from './screens';
import type { ScreenKind } from './screens';
import { CELL, WALL_T } from './shell';
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
}

export interface RoomCtx {
  room: GenRoom;
  /** Какой это мир: убежище обставляется здесь, офис и жёлтые комнаты — в furnish_office.ts. */
  world: WorldKind;
  /** Сид уровня (общий для всех помещений): по нему решается то, что должны знать и обстановка, и игра. */
  seed: number;
  /** Клетка, с которой начинается вылазка: рядом с ней обманок не ставим. */
  start: { cx: number; cz: number; tier: number };
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

/** Модель полки у стены (спиной к z = 0) — предмет уровня. */
function s3(xf: Xf, name: string): void {
  ALL_PROPS[name]!.build(xf, pointSeed(xf));
}

/** Модель полки серединой в начале координат (стол посреди клетки, стул у стола). */
function s3c(xf: Xf, name: string): void {
  const g = s3Size(name);
  s3(g.mount === 'free' ? xf : xf.child(0, 0, -g.d / 2), name);
}

/**
 * Металлический стеллаж полки, на полках — ящики и тюки (кладовая) или кипы бумаги (архив). В пролёте hole оставлен
 * промежуток под вещь воспоминания; ответ — где она ляжет (x вдоль стены, y полки).
 */
function rack(xf: Xf, seed: number, load: 'boxes' | 'papers', hole: { shelf: number; x0: number; x1: number }): { x: number; y: number } {
  s3(xf, RACK);
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
  // Лестница на поверхность — у стены напротив двери.
  const s = take(ctx, false);
  if (s) {
    ladderShaft(s.xf, ctx.h);
    landmark(ctx, 'exit', s.xf, 0, 1.2, 0.3);
  }
  const g = take(ctx, false);
  if (g) gasMaskRow(g.xf.child(0, 1.7, 0), 6);
  const b = take(ctx, false);
  if (b) {
    // Скамья у входа — не предмет уровня, а часть места: с этой комнаты начинается вылазка, игрок встаёт рядом, и от первого
    // же шага она растворилась бы.
    const k = b.cx * 7 + b.cz;
    s3Put(b.xf, pickOf(BENCHES, k), { tint: jitter(k) });
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

function dorm(ctx: RoomCtx): void {
  lamps(ctx, 2);
  let beds = 0;
  for (const s of free(ctx)) {
    if (beds >= 4) break;
    // Нары стоят длинной стороной вдоль стены; вещь — на нижнем ярусе.
    const b = pickOf(BUNKS, s.cx * 31 + s.cz * 17 + beds);
    const g = s3Size(b);
    const x = fit(s, g.w, g.d);
    s3(s.xf.child(x, 0, 0), b);
    spot(ctx, s.xf, x, S3_BED[b]! + 0.005, 0.42, 'table');
    if (beds === 0) landmark(ctx, 'bunks', s.xf, x, 1.0, 0.75);
    s.used = true;
    beds += 1;
  }
  const l = take(ctx);
  if (l) {
    // Три шкафчика бок о бок; вещь — на полу перед средним.
    const w = s3Size('s3_locker_olive').w;
    const x0 = fit(l, w * 3, 0.56) - w;
    for (let i = 0; i < 3; i++) s3(l.xf.child(x0 + i * w, 0, 0), 's3_locker_olive');
    spot(ctx, l.xf, x0 + w, 0.02, 0.85, 'floor');
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) {
    s3c(mid.xf.child(0, 0, 0), 's3_table_work');
    s3c(mid.xf.child(-0.3, 0, 0.66), 's3_stool_wood');
    s3c(mid.xf.child(0.38, 0, -0.68, 1), 's3_stool_wood');
    spot(ctx, mid.xf, 0, S3_TOP.s3_table_work! + 0.005, 0, 'table');
  }
  const abandoned = ctx.room.tier === 2;
  for (const s of free(ctx, false).slice(0, 2)) {
    clutter(ctx, s, abandoned);
    s.used = true;
  }
}

function command(ctx: RoomCtx): void {
  lamps(ctx);
  const d = take(ctx);
  if (d) {
    // Двухтумбовый стол с зелёным сукном, на нём радиостанция; стул полки придвинут к столу.
    const D = 's3_desk_green';
    const g = s3Size(D);
    const x = fit(d, g.w, g.d);
    const top = S3_TOP[D]!;
    s3(d.xf.child(x, 0, 0), D);
    radioSet(d.xf.child(x - 0.3, top, 0.3));
    s3c(d.xf.child(x - 0.05, 0, g.d + 0.15, 2), pickOf(CHAIRS, d.cx * 5 + d.cz));
    wallPhone(d.xf.child(x + 1.12 > 1.35 ? x - 1.12 : x + 1.12, 1.4, 0));
    landmark(ctx, 'radio', d.xf, x - 0.3, top + 0.14, 0.3);
    spot(ctx, d.xf, x + 0.4, top + 0.005, 0.35, 'table');
  }
  const m = take(ctx, false);
  if (m) {
    mapBoard(m.xf.child(0, 1.5, 0));
    landmark(ctx, 'map', m.xf, 0, 1.5, 0.05);
  }
  const s = take(ctx);
  if (s) {
    const g = s3Size(SAFE);
    const x = fit(s, g.w, g.d);
    safe(s.xf.child(x, 0, 0), pointSeed(s.xf.child(x, 0, 0)));
    landmark(ctx, 'safe', s.xf, x, 0.4, 0.4);
    spot(ctx, s.xf, x, S3_TOP[SAFE]! + 0.005, 0.22, 'table');
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) {
    // Рабочий стол поперёк клетки и два стула по бокам.
    s3c(mid.xf.child(0, 0, 0, 1), 's3_table_work');
    s3c(mid.xf.child(0.66, 0, 0, 3), pickOf(CHAIRS, mid.cx + mid.cz * 3));
    s3c(mid.xf.child(-0.66, 0, 0.2, 1), pickOf(CHAIRS, mid.cx + mid.cz * 3 + 1));
    spot(ctx, mid.xf, 0, S3_TOP.s3_table_work! + 0.005, 0, 'table');
  }
  for (const p of free(ctx, false).slice(0, 2)) {
    poster(p.xf.child(0, 1.65, 0), 0.8, 0.9, 7 + p.cx * 13 + p.cz);
    p.used = true;
  }
}

function medical(ctx: RoomCtx): void {
  lamps(ctx);
  const B = 's3_bed_iron_white';
  const bed = s3Size(B);
  for (const s of free(ctx).slice(0, 2)) {
    const x = fit(s, bed.w, bed.d);
    s3(s.xf.child(x, 0, 0), B);
    spot(ctx, s.xf, x, S3_BED[B]! + 0.005, 0.42, 'table');
    s.used = true;
  }
  const c = take(ctx);
  if (c) {
    const cab = s3Size('s3_cabinet_medical');
    const x = fit(c, cab.w, cab.d);
    s3(c.xf.child(x, 0, 0), 's3_cabinet_medical');
    landmark(ctx, 'cabinet', c.xf, x, 1.2, 0.4);
    spot(ctx, c.xf, x + (x > 0 ? -0.7 : 0.7), 0.02, 0.3, 'floor');
  }
  const w = take(ctx);
  if (w) sinkRow(w.xf.child(fit(w, 0.62, 0.45), 0, 0), 1);
  for (const p of free(ctx, false).slice(0, 1)) {
    poster(p.xf.child(0, 1.65, 0), 0.7, 0.9, 99);
    p.used = true;
  }
}

function storage(ctx: RoomCtx): void {
  lamps(ctx, 2);
  let racks = 0;
  for (const s of free(ctx)) {
    if (racks >= 5) break;
    const n = s.cornerL || s.cornerR ? 1 : 2;
    const w = s3Size(RACK).w;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? fit(s, w, 0.52) : (i - 0.5) * w;
      // Вещь — на средней полке справа: там пролёт высокий, её видно.
      const at = rack(s.xf.child(x, 0, 0), s.cx * 31 + s.cz * 17 + i + racks * 7, 'boxes', { shelf: 5, x0: 0.15, x1: 0.45 });
      spot(ctx, s.xf, x + at.x, at.y, 0.3, 'shelf');
    }
    if (racks === 0) landmark(ctx, 'racks', s.xf, 0, 1.1, 0.5);
    s.used = true;
    racks += 1;
  }
  for (const c of ctx.cells) {
    if (c.doors > 0 || ctx.rng() < 0.4) continue;
    crate(c.xf.child(-0.3, 0, 0.2), 0.7, 0.5, 0.5);
    crate(c.xf.child(-0.25, 0.5, 0.22, 1), 0.45, 0.32, 0.4, [0.85, 0.85, 0.85]);
    if (ctx.rng() < 0.6) barrel(c.xf.child(0.55, 0, -0.35), MAT.metalGreen);
    spot(ctx, c.xf, 0.3, 0.02, 0.7, 'floor');
  }
}

function washroom(ctx: RoomCtx): void {
  lamps(ctx);
  const a = take(ctx);
  if (a) {
    sinkRow(a.xf.child(0, 0, 0), a.cornerL || a.cornerR ? 2 : 3);
    landmark(ctx, 'sinks', a.xf, 0, 1.1, 0.45);
  }
  const b = take(ctx);
  if (b && !b.cornerL && !b.cornerR) stalls(b.xf.child(0, 0, 0), 2);
  else if (b) bucket(b.xf.child(0, 0, 0.4));
  for (const c of ctx.cells) puddle(c.xf.child(0.2, 0, 0.1), 1.2, 0.8);
  const p = take(ctx, false);
  if (p) {
    pipeRun(p.xf.child(-1.35, 0, 0), 2.7, 2.3, 0.04, MAT.rust);
    bucket(p.xf.child(0.6, 0, 0.35));
    spot(ctx, p.xf, -0.5, 0.02, 0.5, 'floor');
  }
}

function fvu(ctx: RoomCtx): void {
  lamps(ctx, 2);
  let units = 0;
  for (const s of free(ctx)) {
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
  const p = take(ctx);
  if (p) {
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
  const g = free(ctx).find((s) => !s.cornerL && !s.cornerR) ?? take(ctx);
  if (g) {
    g.used = true;
    dieselGen(g.xf.child(0, 0, 0), ctx.h);
    landmark(ctx, 'diesel', g.xf, 0, 0.8, 0.9);
  }
  const t = take(ctx);
  if (t) fuelTank(t.xf.child(fit(t, 1.9, 0.95), 0, 0));
  const p = take(ctx);
  if (p) {
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
  let n = 0;
  for (const s of free(ctx)) {
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
  let n = 0;
  for (const s of free(ctx)) {
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
  let n = 0;
  for (const s of free(ctx)) {
    const count = s.cornerL || s.cornerR ? 1 : 2;
    const w = s3Size(RACK).w;
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? fit(s, w, 0.52) : (i - 0.5) * w;
      // Промежуток в кипах на средней полке слева — под вещь (её кладут не в каждый стеллаж).
      const at = rack(s.xf.child(x, 0, 0), s.cx * 37 + s.cz * 11 + i, 'papers', { shelf: 3, x0: -0.52, x1: -0.26 });
      if ((n + i) % 2 === 0) spot(ctx, s.xf, x + at.x, at.y, 0.3, 'shelf');
    }
    if (n === 0) landmark(ctx, 'archive', s.xf, 0, 1.2, 0.5);
    s.used = true;
    n += 1;
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) {
    // Стол архивариуса посреди клетки, стул придвинут.
    const D = 's3_desk_green';
    const g = s3Size(D);
    s3(mid.xf.child(0, 0, -g.d / 2), D);
    s3c(mid.xf.child(-0.1, 0, g.d / 2 + 0.15, 2), pickOf(CHAIRS, mid.cx * 3 + mid.cz));
    spot(ctx, mid.xf, -0.2, S3_TOP[D]! + 0.005, 0, 'table');
    // Рассыпанные папки.
    for (let i = 0; i < 5; i++) {
      const x = (ctx.rng() - 0.5) * 2;
      const z = 0.5 + ctx.rng() * 0.7;
      mid.xf.box([x, 0.003, z], [x + 0.22, 0.02 + ctx.rng() * 0.03, z + 0.3], MAT.paper, { tint: [0.8 + ctx.rng() * 0.2, 0.8, 0.65] });
    }
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
export function homeStack(ctx: RoomCtx, items: readonly HomeItem[]): { s: Slot; x: number; seeds: number[] } | null {
  const specs = items.map(([n]) => ALL_PROPS[n]);
  if (specs.some((p) => !p)) return null;
  let depth = 0;
  let half = 0;
  items.forEach(([, dx = 0], i) => {
    const p = specs[i]!;
    if (p.mount !== 'wall') depth = Math.max(depth, p.d);
    half = Math.max(half, Math.abs(dx) + p.w / 2);
  });
  const s = (depth > 0.6 ? free(ctx, true)[0] ?? (depth <= 0.75 ? free(ctx, false)[0] : undefined) : free(ctx, false)[0]) ?? null;
  if (!s) return null;
  s.used = true;
  const x = fit(s, half * 2, depth);
  const seeds: number[] = [];
  items.forEach(([name, dx = 0, y], i) => {
    const p = specs[i]!;
    const seed = Math.floor(ctx.rng() * 1e6);
    seeds.push(seed);
    const at = s.xf.child(x + dx, p.mount === 'wall' ? (y ?? p.y ?? 1.2) : 0, 0);
    if (p.mount === 'floor' && isFlat(ctx, s, name, i)) {
      // Картонка: стоит там же, где стоял бы настоящий предмет, но это лист — и преграды у неё нет.
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
    } else p.build(at, seed);
  });
  return { s, x, seeds };
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

/** Ковёр посреди клетки. */
function rugAt(ctx: RoomCtx, c: CellInfo): void {
  ALL_PROPS.rug!.build(c.xf.child(0, 0, 0), Math.floor(ctx.rng() * 1e6));
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
  for (let i = 0; i < n; i++) {
    const c = cells[i % cells.length]!;
    const [ox, oz] = offsets[Math.floor(i / cells.length) % offsets.length]!;
    spot(ctx, c.xf, ox, 0.03, oz, 'floor');
  }
}

function kitchen(ctx: RoomCtx): void {
  lamps(ctx);
  const table = homeStack(ctx, [['kitchen_table']]);
  if (table) {
    landmark(ctx, 'kitchen', table.s.xf, table.x, 0.7, 0.4);
    // Свободный край столешницы слева от тарелки — на клеёнке (props_home.ts, kitchenTable).
    spot(ctx, table.s.xf, table.x - 0.42, S3_TOP.s3_table_kitchen! + 0.006, 0.2, 'table');
  }
  homeStack(ctx, [['fridge']]);
  homeStack(ctx, [['stove']]);
  homeStack(ctx, [['sink_cabinet']]);
  homeStack(ctx, [['radiator', 0.2], ['window_fake', -0.3]]);
  floorSpots(ctx, table ? 2 : 3);
}

function living(ctx: RoomCtx): void {
  // Люстра в одной клетке, в остальных — обычные лампы.
  const centre = homeCentre(ctx);
  ctx.cells.forEach((c, i) => {
    if (ctx.sky) return;
    if (c === centre) hanging(c.xf, () => ALL_PROPS.chandelier!.build(c.xf.child(0, ctx.h, 0), 0));
    else if (i % 2 === 0) hanging(c.xf, () => cageLamp(c.xf.child(0, ctx.h, 0)));
  });
  const sofa = homeStack(ctx, [['sofa'], ['wall_carpet']]);
  if (sofa) landmark(ctx, 'living', sofa.s.xf, sofa.x, 0.6, 0.45);
  homeStack(ctx, [['tv_stand']]);
  if (ctx.rng() < 0.8) homeStack(ctx, [['armchair']]);
  if (ctx.rng() < 0.8) homeStack(ctx, [['bookshelf']]);
  if (ctx.rng() < 0.7) homeStack(ctx, [['floor_lamp']]);
  if (ctx.rng() < 0.6) homeStack(ctx, [['houseplant']]);
  // Ёлка стоит не везде и не всегда: сон помнит праздник выборочно.
  if (ctx.rng() < 0.15) homeStack(ctx, [['christmas_tree']]);
  rugAt(ctx, centre);
  floorSpots(ctx, 3);
}

function bedroom(ctx: RoomCtx): void {
  lamps(ctx);
  const bed = homeStack(ctx, ctx.rng() < 0.6 ? [['bed_home'], ['wall_carpet']] : [['bed_home']]);
  if (bed) landmark(ctx, 'bedroom', bed.s.xf, bed.x, 0.55, 0.5);
  homeStack(ctx, [['wardrobe']]);
  homeStack(ctx, [['mirror', 0.5], ['floor_lamp', -0.5]]);
  homeStack(ctx, [['radiator', 0.2], ['window_fake', -0.3]]);
  floorSpots(ctx, 3);
}

function bathroom(ctx: RoomCtx): void {
  lamps(ctx);
  const tub = homeStack(ctx, [['bathtub']]);
  if (tub) landmark(ctx, 'bathroom', tub.s.xf, tub.x, 0.6, 0.4);
  // Зеркало вешается над унитазом и стиральной машиной, поэтому выше обычного.
  homeStack(ctx, [['toilet_home', -0.55], ['washing_machine', 0.5], ['mirror', 0.5, 1.15]]);
  homeStack(ctx, [['clothes_dryer']]);
  floorSpots(ctx, 2);
}

function nursery(ctx: RoomCtx): void {
  lamps(ctx);
  const crib = homeStack(ctx, [['crib']]);
  if (crib) landmark(ctx, 'nursery', crib.s.xf, crib.x, 0.6, 0.35);
  const desk = homeStack(ctx, [['desk_pc']]);
  // Справа от монитора столешница свободна.
  if (desk) spot(ctx, desk.s.xf, desk.x + 0.42, S3_TOP.s3_desk_simple! + 0.004, 0.25, 'table');
  homeStack(ctx, [['toy_heap']]);
  homeStack(ctx, [['bookshelf']]);
  homeStack(ctx, [['window_fake']]);
  rugAt(ctx, homeCentre(ctx));
  floorSpots(ctx, desk ? 2 : 3);
}

function hallway(ctx: RoomCtx): void {
  lamps(ctx);
  const rack = homeStack(ctx, [['coat_rack']]);
  if (rack) landmark(ctx, 'hallway', rack.s.xf, rack.x, 1.1, 0.25);
  // Зеркало висит выше гладильной доски, чтобы доска не вросла в раму.
  const wall: HomeItem[] = [['mirror', -0.3, 1.0]];
  if (ctx.rng() < 0.5) wall.push(['ironing_board', 0.45]);
  homeStack(ctx, wall);
  if (ctx.rng() < 0.6) homeStack(ctx, [['door_leaf_lean']]);
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
  // Стене лиц, карте и стене чемоданов нужна голая стена: их участки отводятся до мебели.
  reservePapers(ctx);
  // Офис стерилен, жёлтые комнаты пусты: у них своя обстановка и нет «следов людей» убежища.
  if (ctx.world === 'office') return furnishOffice(ctx);
  if (ctx.world === 'yellow') return furnishYellow(ctx);
  if (ctx.world === 'station') return furnishStation(ctx);
  FURNISH[ctx.room.type]?.(ctx);
  // Сначала — то, что положено помещению по назначению, потом — следы людей и времени.
  dressRoom(ctx);
}

/** Подпись-табличка над дверью со стороны коридора (слабое фосфорное свечение помогает ориентироваться). */
export function doorSign(xf: Xf): void {
  signPlate(xf, 0.62, 0.15);
}
