/**
 * Расстановка реквизита по типам помещений. Помещение даёт «слоты»: участки стен по 2,7 м
 * (предметы ставятся спиной к стене) и центры клеток. Каждая функция обставляет свой тип комнаты,
 * регистрирует места для находок и приметные объекты — цели «снять на камеру».
 */
import type { Rng } from '../core/rng';
import type { GenRoom } from '../gen/layout';
import type { ItemSpot, Landmark } from './level';
import { MAT } from './materials';
import { barrel, bunk, cables, cageLamp, crate, locker, pipeRun, rubble, signPlate, stool, table, valve, ventGrille } from './props';
import type { Xf } from './props';
import {
  bench,
  bucket,
  chair,
  collapse,
  controlPanel,
  cot,
  desk,
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
  medCabinet,
  poster,
  puddle,
  radioSet,
  safe,
  shelfRack,
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
  rng: Rng;
  /** Высота потолка над полом. */
  h: number;
  slots: Slot[];
  cells: CellInfo[];
  spots: ItemSpot[];
  landmarks: Landmark[];
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
function free(ctx: RoomCtx, deep = true): Slot[] {
  return shuffled(
    ctx.rng,
    ctx.slots.filter((s) => !s.used && (!deep || s.deep)),
  );
}

/** Занять следующий свободный слот. */
function take(ctx: RoomCtx, deep = true): Slot | null {
  const s = free(ctx, deep)[0];
  if (!s) return null;
  s.used = true;
  return s;
}

function spot(ctx: RoomCtx, xf: Xf, x: number, y: number, z: number, kind: ItemSpot['kind']): void {
  const p = xf.pt(x, y, z);
  ctx.spots.push({ x: p[0], y: p[1], z: p[2], room: ctx.room.id, tier: ctx.room.tier, kind });
}

function landmark(ctx: RoomCtx, id: string, xf: Xf, x: number, y: number, z: number): void {
  const p = xf.pt(x, y, z);
  ctx.landmarks.push({ id, x: p[0], y: p[1], z: p[2], room: ctx.room.id, tier: ctx.room.tier });
}

/** Сдвиг предмета шириной w вдоль слота так, чтобы он не упёрся в угол. */
function fit(s: Slot, w: number, depth: number): number {
  const lo = -1.35 + (s.cornerL ? depth + 0.05 : 0) + w / 2;
  const hi = 1.35 - (s.cornerR ? depth + 0.05 : 0) - w / 2;
  if (lo > hi) return 0;
  return Math.max(lo, Math.min(hi, 0));
}

function lamps(ctx: RoomCtx, every = 1): void {
  ctx.cells.forEach((c, i) => {
    if (i % every === 0) cageLamp(c.xf.child(0, ctx.h, 0));
  });
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
  else if (r < 0.9) bench(s.xf.child(0, 0, 0), 1.6);
  else if (wet) puddle(s.xf.child(x, 0, 0.9), 1.1, 0.7);
  else gasMaskRow(s.xf.child(0, 1.7, 0), 4);
}

// ───────────────────────────── помещения ─────────────────────────────

function corridor(ctx: RoomCtx): void {
  const tier = ctx.room.tier;
  ctx.cells.forEach((c) => {
    if ((c.cx + c.cz) % 2 === 0) cageLamp(c.xf.child(0, ctx.h, 0));
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
    if (ctx.rng() < (tier === 2 ? 0.3 : 0.2)) {
      clutter(ctx, s, tier > 0);
      s.used = true;
    }
  }
  // Сыро на нижних ярусах.
  if (tier > 0) for (const c of ctx.cells) if (ctx.rng() < 0.12 * tier) puddle(c.xf.child((ctx.rng() - 0.5) * 0.8, 0, (ctx.rng() - 0.5) * 0.8), 0.9 + ctx.rng(), 0.6 + ctx.rng() * 0.6);
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
    bench(b.xf, 1.8);
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
  const abandoned = ctx.room.tier === 2;
  let beds = 0;
  for (const s of free(ctx)) {
    if (beds >= 4) break;
    // Нары стоят длинной стороной вдоль стены.
    bunk(s.xf.child(fit(s, 1.9, 0.75) + 0.95, 0, 0, 3));
    spot(ctx, s.xf, fit(s, 1.9, 0.75), 0.52, 0.4, 'table');
    if (beds === 0) landmark(ctx, 'bunks', s.xf, fit(s, 1.9, 0.75), 1.0, 0.75);
    s.used = true;
    beds += 1;
  }
  const l = take(ctx);
  if (l) {
    const x0 = fit(l, 1.45, 0.5) - 0.48;
    for (let i = 0; i < 3; i++) locker(l.xf.child(x0 + i * 0.48, 0, 0), abandoned ? i !== 1 : i === 1, [0.85 + i * 0.07, 0.9 + i * 0.04, 0.85 + i * 0.07]);
    spot(ctx, l.xf, x0 + 0.48, 0.3, 0.3, 'shelf');
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) {
    table(mid.xf.child(0, 0, 0));
    stool(mid.xf.child(-0.3, 0, 0.6));
    stool(mid.xf.child(0.4, 0, -0.62, 1));
    spot(ctx, mid.xf, 0, 0.77, 0, 'table');
  }
  for (const s of free(ctx, false).slice(0, 2)) {
    clutter(ctx, s, abandoned);
    s.used = true;
  }
}

function command(ctx: RoomCtx): void {
  lamps(ctx);
  const d = take(ctx);
  if (d) {
    const x = fit(d, 1.2, 0.65);
    desk(d.xf.child(x, 0, 0));
    radioSet(d.xf.child(x - 0.2, 0.76, 0.3));
    chair(d.xf.child(x - 0.1, 0, 0.95, 2));
    wallPhone(d.xf.child(x + 0.95 > 1.2 ? x - 0.95 : x + 0.95, 1.4, 0));
    landmark(ctx, 'radio', d.xf, x - 0.2, 0.9, 0.3);
    spot(ctx, d.xf, x + 0.3, 0.77, 0.3, 'table');
  }
  const m = take(ctx, false);
  if (m) {
    mapBoard(m.xf.child(0, 1.5, 0));
    landmark(ctx, 'map', m.xf, 0, 1.5, 0.05);
  }
  const s = take(ctx);
  if (s) {
    const x = fit(s, 0.5, 0.5);
    safe(s.xf.child(x, 0, 0));
    landmark(ctx, 'safe', s.xf, x, 0.4, 0.4);
    spot(ctx, s.xf, x, 0.76, 0.25, 'table');
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) {
    table(mid.xf.child(0, 0, 0, 1));
    chair(mid.xf.child(0.6, 0, 0, 3));
    chair(mid.xf.child(-0.6, 0, 0.2, 1));
    spot(ctx, mid.xf, 0, 0.77, 0, 'table');
  }
  for (const p of free(ctx, false).slice(0, 2)) {
    poster(p.xf.child(0, 1.65, 0), 0.8, 0.9, 7 + p.cx * 13 + p.cz);
    p.used = true;
  }
}

function medical(ctx: RoomCtx): void {
  lamps(ctx);
  for (const s of free(ctx).slice(0, 2)) {
    cot(s.xf.child(fit(s, 1.9, 0.7), 0, 0));
    spot(ctx, s.xf, fit(s, 1.9, 0.7), 0.6, 0.35, 'table');
    s.used = true;
  }
  const c = take(ctx);
  if (c) {
    const x = fit(c, 0.64, 0.4);
    medCabinet(c.xf.child(x, 0, 0));
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
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? fit(s, 1.2, 0.5) : -0.63 + i * 1.26;
      const shelves = shelfRack(s.xf.child(x, 0, 0), s.cx * 31 + s.cz * 17 + i + racks * 7);
      spot(ctx, s.xf, x + 0.3, shelves[1 + (i % 2)]! + 0.01, 0.38, 'shelf');
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
    duct(s.xf.child(0, ctx.h - 0.42, 0), -1.5, 1.5);
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
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? fit(s, 1.2, 0.5) : -0.63 + i * 1.26;
      const shelves = shelfRack(s.xf.child(x, 0, 0), s.cx * 37 + s.cz * 11 + i, true);
      if ((n + i) % 2 === 0) spot(ctx, s.xf, x - 0.3, shelves[1]! + 0.3, 0.42, 'shelf');
    }
    if (n === 0) landmark(ctx, 'archive', s.xf, 0, 1.2, 0.5);
    s.used = true;
    n += 1;
  }
  const mid = ctx.cells.find((c) => c.doors === 0);
  if (mid) {
    desk(mid.xf.child(0, 0, -0.3));
    chair(mid.xf.child(-0.1, 0, 0.65, 2));
    spot(ctx, mid.xf, -0.2, 0.77, 0, 'table');
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
  // Завал у стены, противоположной входу: слот без двери с самой дальней стороны.
  const back = ctx.slots[0];
  const rot = back ? back.xf.rot : 0;
  const pile = c.xf.child(0, 0, 0, ((rot + 2) % 4) as 0 | 1 | 2 | 3);
  collapse(pile, ctx.h, c.cx * 53 + c.cz * 29);
  landmark(ctx, 'collapse', pile, 0, 1.2, 0.2);
  spot(ctx, pile, 0, 0.02, 1.0, 'floor');
}

function stairwell(ctx: RoomCtx): void {
  const first = ctx.cells[0];
  if (first) cageLamp(first.xf.child(0, ctx.h, 0));
}

const FURNISH: Record<GenRoom['type'], (ctx: RoomCtx) => void> = {
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
};

/** Обставить помещение. Порядок вызовов и ГСЧ фиксированы: один сид — одна и та же обстановка. */
export function furnishRoom(ctx: RoomCtx): void {
  FURNISH[ctx.room.type](ctx);
}

/** Подпись-табличка над дверью со стороны коридора (слабое фосфорное свечение помогает ориентироваться). */
export function doorSign(xf: Xf): void {
  signPlate(xf, 0.62, 0.15);
}
