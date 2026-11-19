/**
 * Обстановка офиса и «жёлтых комнат».
 *
 * Офис — стерильный лабиринт: белые коридоры, в каждой клетке потолочная панель, почти ничего
 * у стен. Посреди самой большой комнаты — отдел: один остров из четырёх столов с терминалами.
 * Остальное — кабинки, переговорная, комната отдыха, кабинет, картотека, копировальная, серверная.
 *
 * Жёлтые комнаты — тот же этаж, из которого ушло назначение: пустые залы с колоннами, панели
 * обесточены (у каждой шестой повис провод), редкие остатки — одинокий стул, жёлтый знак «мокрый
 * пол», перегородка. Темно, как в убежище, и чисто: ни пятен, ни фактур. На весь этаж — два экрана,
 * таких же, как в офисе.
 *
 * Мебель — из реестра ALL_PROPS: офисные предметы собраны кодом (props_office.ts), стулья, столы,
 * диваны, растения и картины — готовые модели (props_models.ts).
 */
import { panelDead } from '../systems/cell_lights';
import { bestSlots, floorSpots, free, homeCentre, homeStack, landmark, leanScreens, roles, screenAt, spot, stackOn, veils } from './furnish';
import type { CellInfo, HomeItem, RoomCtx, Slot, SlotScore } from './furnish';
import { MAT } from './materials';
import { ALL_PROPS } from './props_all';
import { ceilingBreak, KITCHEN_SPOT, officeDeskTop } from './props_office';
import { S3_TOP } from './furniture';
import { hanging } from './objects';
import type { Xf } from './props';
import type { ScreenKind } from './screens';

const seedOf = (ctx: RoomCtx): number => Math.floor(ctx.rng() * 1e6);

/** Поставить предмет реестра в точку; незнакомое имя пропускается. */
function put(ctx: RoomCtx, name: string, xf: Xf): boolean {
  const p = ALL_PROPS[name];
  if (!p) return false;
  // false — не встала: врастала в соседнюю мебель (world/clearance.ts).
  return p.build(xf, seedOf(ctx)) !== false;
}

/** Предмет на свободный участок стены. */
function wall(ctx: RoomCtx, ...items: HomeItem[]): { s: Slot; x: number; seeds: number[] } | null {
  return homeStack(ctx, items);
}

/** Предмет на лучший по оценке свободный участок стены (раскладка по смыслу: world/furnish.ts, roles). */
function wallBy(ctx: RoomCtx, score: SlotScore, ...items: HomeItem[]): { s: Slot; x: number; seeds: number[] } | null {
  return homeStack(ctx, items, score);
}

/** Кроме стены входа: на ней проход, и с порога её не видно. */
const notNear = (ctx: RoomCtx, score: SlotScore): SlotScore => {
  const plan = roles(ctx).plan;
  return (s) => (plan.role(s) === 'near' ? -Infinity : score(s));
};

/** Отдельно стоящий предмет — в угол у свободной стены, спиной к ней. */
function corner(ctx: RoomCtx, name: string): boolean {
  const p = ALL_PROPS[name];
  const s = free(ctx, false)[0];
  if (!p || !s) return false;
  s.used = true;
  const x = s.cornerL ? -0.95 : s.cornerR ? 0.95 : 0;
  return put(ctx, name, s.xf.child(x, 0, p.mount === 'free' ? p.d / 2 + 0.06 : 0));
}

/**
 * Потолочные панели: по одной на клетку. В жёлтых комнатах этаж обесточен: панели не светят, у каждой
 * шестой повис провод. Решает мир, а не вызывающий: забыть про это в одном из помещений нельзя.
 */
function panels(ctx: RoomCtx): void {
  const off = ctx.world === 'yellow';
  for (const c of ctx.cells) {
    const name = !off ? 'ceiling_panel' : panelDead(ctx.seed, c.cx, c.cz) ? 'ceiling_panel_dead' : 'ceiling_panel_off';
    const p = ALL_PROPS[name];
    // Под звёздным небом потолочных панелей нет (сид всё равно берётся: остальная обстановка от него не едет).
    const seed = seedOf(ctx);
    if (p && !ctx.sky) hanging(c.xf, () => p.build(c.xf.child(0, ctx.h, -p.d / 2), seed));
  }
}

/** Середина помещения в мире (по охвату его клеток) — относительно первой клетки. */
function middle(ctx: RoomCtx): { c: CellInfo; dx: number; dz: number } {
  const c = ctx.cells[0]!;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const k of ctx.cells) {
    x0 = Math.min(x0, k.cx);
    x1 = Math.max(x1, k.cx);
    z0 = Math.min(z0, k.cz);
    z1 = Math.max(z1, k.cz);
  }
  return { c, dx: ((x0 + x1) / 2 - c.cx) * 3, dz: ((z0 + z1) / 2 - c.cz) * 3 };
}

/** Что показывают экраны: в офисе — природу (ею заменяют окна), в жёлтых комнатах — то, что забыли выключить. */
const NATURE: readonly ScreenKind[] = ['nature', 'strange'];
/** Что показывает телевизор в комнате отдыха: общая память — то, что смотрели все. */
const POP: readonly ScreenKind[] = ['pop'];

// ───────────────────────── офис ─────────────────────────

function corridor(ctx: RoomCtx): void {
  panels(ctx);
  // Стены пусты. Изредка — то, что бывает в любом офисном коридоре; ничто не мешает пройти.
  for (const s of ctx.slots) {
    if (s.used) continue;
    const r = ctx.rng();
    const x = (ctx.rng() - 0.5) * 1.4;
    if (r < 0.05) put(ctx, 'water_cooler', s.xf.child(x, 0, 0));
    else if (r < 0.1) put(ctx, 'office_clock', s.xf.child(x, ALL_PROPS.office_clock?.y ?? 2.05, 0));
    else if (r < 0.15) put(ctx, 'print_medium', s.xf.child(x, 1.4, 0));
    else if (r < 0.19) put(ctx, 'trash_bin', s.xf.child(x, 0, 0.2));
    else if (r < 0.22) put(ctx, 'cactus_column', s.xf.child(x, 0, 0.36));
    else continue;
    s.used = true;
  }
  // Вентиляция — в каждой третьей клетке, в стороне от панели.
  ctx.cells.forEach((c, i) => {
    if (i % 3 === 1 && !ctx.sky) hanging(c.xf, () => put(ctx, 'ceiling_vent', c.xf.child(0.95, ctx.h, -0.3)));
  });
  // Экраны с природой у стен: то, чем офис заменяет окна.
  leanScreens(ctx, 3, 0.05, NATURE);
}

function lift(ctx: RoomCtx): void {
  panels(ctx);
  // Двери лифта — на южной стене, за спиной у вошедшего: отсюда вылазка начинается, сюда возвращает Осыпь.
  const south = ctx.slots.find((s) => s.dir === 1 && !s.used) ?? ctx.slots.find((s) => !s.used);
  if (south && put(ctx, 'elevator_doors', south.xf.child(0, 0, 0))) {
    south.used = true;
    landmark(ctx, 'lift', south.xf, 0, 1.2, 0.2);
  }
  wall(ctx, ['office_clock']);
}

function reception(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Стойка — напротив входа, лицом к нему: вошедший сразу видит, к кому идти.
  const desk = wallBy(ctx, k.hero, ['reception_desk']);
  if (desk) {
    landmark(ctx, 'reception', desk.s.xf, desk.x, 1.0, 0.4);
    // Высокая столешница стойки (со стороны посетителя: полоса от лицевой стенки внутрь).
    spot(ctx, desk.s.xf, desk.x + 0.7, S3_TOP.s3_reception_desk! + 0.005, 0.73, 'table');
  }
  // Сбоку — стулья для тех, кто ждёт, и кактус между ними. Стул — модель полки Sand3D (world/furniture.ts): игрушечный из
  // набора KayKit партнёру не понравился, а с 18.11 вся мебель игры — из полки.
  wallBy(ctx, k.side, ['chair_bent', -0.75], ['chair_bent', 0.75], ['cactus_round', 0, 0]);
  // Экран в приёмной: лес вместо окна.
  leanScreens(ctx, 1, 1, NATURE);
  floorSpots(ctx, 1);
}

function department(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Остров из четырёх столов посреди комнаты, которая для него слишком велика.
  const m = middle(ctx);
  if (put(ctx, 'desk_island', m.c.xf.child(m.dx, 0, m.dz))) {
    landmark(ctx, 'department', m.c.xf, m.dx, 1.0, m.dz);
    // Вещи воспоминаний ложатся на пол вокруг острова: на столах — терминалы.
    const y = 0.03;
    spot(ctx, m.c.xf, m.dx + 2.1, y, m.dz, 'floor');
    spot(ctx, m.c.xf, m.dx - 2.1, y, m.dz, 'floor');
    spot(ctx, m.c.xf, m.dx, y, m.dz + 2.0, 'floor');
    spot(ctx, m.c.xf, m.dx, y, m.dz - 2.0, 'floor');
  }
  // Стены почти пусты: часы — напротив входа, кулер — у входа, одна полка с папками — сбоку; больше в отделе ничего нет.
  wallBy(ctx, k.hero, ['office_clock']);
  wallBy(ctx, k.door, ['water_cooler']);
  wallBy(ctx, k.side, ['binder_shelf']);
  grove(ctx, m);
}

/** Сколько берёз в отделе: ряд вдоль одной стороны острова и одна-две поодаль. */
export const GROVE = { row: 4, min: 5, max: 6 } as const;

/**
 * Берёзы, проросшие сквозь отдел (слова партнёра: «добавить эти деревья в одну из комнат, чтобы они
 * так же прорастали насквозь локации»; картинка — та самая, что на экранах офиса). Природу в офис
 * привезли картинкой — а в одной комнате картинка сбывается, когда место начинает стираться:
 * «Берёзы знак последних дней, листья не нужны».
 *
 * Стволы стоят в «карманах» у внутренних узлов сетки клеток: там, где сходятся четыре клетки комнаты,
 * но не в самом узле. Так они не попадают ни на прямые между серединами клеток (по ним ходят игрок
 * и Осыпь), ни под потолочные панели (панель — посреди клетки), ни в остров столов. Четыре — рядом
 * вдоль одной стороны острова, как аллея; остальные — поодаль: комната по-прежнему слишком велика.
 */
function grove(ctx: RoomCtx, m: { c: CellInfo; dx: number; dz: number }): void {
  const tree = ALL_PROPS.birch;
  if (!tree) return;
  const has = new Set(ctx.cells.map((c) => `${c.cx},${c.cz}`));
  // Места вещей воспоминаний вокруг острова (см. department): между стволами, но не под ними.
  const spots = [
    [m.dx + 2.1, m.dz],
    [m.dx - 2.1, m.dz],
    [m.dx, m.dz + 2.0],
    [m.dx, m.dz - 2.0],
  ];
  const cands: { x: number; z: number }[] = [];
  for (const c of ctx.cells) {
    if (!has.has(`${c.cx + 1},${c.cz}`) || !has.has(`${c.cx},${c.cz + 1}`) || !has.has(`${c.cx + 1},${c.cz + 1}`)) continue;
    const vx = (c.cx - m.c.cx) * 3 + 1.5;
    const vz = (c.cz - m.c.cz) * 3 + 1.5;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = vx + sx * (0.5 + ctx.rng() * 0.22);
        const z = vz + sz * (0.5 + ctx.rng() * 0.22);
        // Не в острове столов и не на месте вещи.
        if (Math.abs(x - m.dx) < 1.8 && Math.abs(z - m.dz) < 1.8) continue;
        if (spots.some((p) => Math.hypot(x - p[0]!, z - p[1]!) < 0.75)) continue;
        cands.push({ x, z });
      }
    }
  }
  if (cands.length === 0) return;
  // Сторона острова, вдоль которой встанет ряд: ось и знак.
  const side = Math.floor(ctx.rng() * 4);
  const along = (p: { x: number; z: number }): number => (side < 2 ? p.x - m.dx : p.z - m.dz) * (side % 2 === 0 ? 1 : -1);
  const picked: { x: number; z: number }[] = [];
  const far = (p: { x: number; z: number }, d: number): boolean => picked.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= d);
  // Ряд: всё, что по эту сторону острова.
  for (const p of cands.filter((q) => along(q) > 1.8)) if (picked.length < GROVE.row && far(p, 1.0)) picked.push(p);
  // Поодаль: с другой стороны, не ближе двух с половиной метров от уже выбранных.
  const rest = cands.filter((q) => along(q) <= 1.8);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const extra = GROVE.min - GROVE.row + Math.floor(ctx.rng() * (GROVE.max - GROVE.min + 1));
  for (const p of rest) if (picked.length < GROVE.row + extra && far(p, 2.5)) picked.push(p);
  // Берёзы — «знак последних дней» (слова партнёра): в месте, которое помнится целиком, их нет; они
  // прорастают по мере того, как оно стирается (systems/decay.ts), — по одной, всегда на тех же местах.
  const grown = Math.round(picked.length * (ctx.decay?.birches ?? 0));
  picked.forEach((p, i) => {
    const at = m.c.xf.child(p.x, 0, p.z, Math.floor(ctx.rng() * 4) as 0 | 1 | 2 | 3);
    const seed = seedOf(ctx);
    if (i >= grown) return;
    // Сначала ствол, потом пролом над ним: ствол, врастающий в мебель, не встаёт — и дыры в потолке без дерева нет.
    if (tree.build(at, seed) === false) return;
    hanging(at, () => ceilingBreak(at, ctx.h, seed));
    if (i === 0) landmark(ctx, 'grove', m.c.xf, p.x, 1.2, p.z);
  });
}

function cubicles(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Кабинки — рядом вдоль стен, по одной на участок, серединой участка: ровный ряд перегородок, стена входа свободна.
  let made = 0;
  for (const s of bestSlots(ctx, false, notNear(ctx, k.hero))) {
    if (made >= ctx.cells.length + 1) break;
    const c = stackOn(ctx, s, [['cubicle']], 0);
    if (!c) continue;
    made += 1;
    if (made === 1) landmark(ctx, 'cubicles', c.s.xf, c.x, 1.0, 0.8);
  }
  // Картотека и корзина — у входа.
  wallBy(ctx, k.door, ['filing_cabinet', -0.3], ['filing_cabinet', 0.3]);
  corner(ctx, 'trash_bin');
  floorSpots(ctx, 3);
}

function meeting(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Стол переговоров — посреди комнаты, длинной стороной вдоль оси входа: с порога виден весь ряд кресел, в торце — доска.
  // Где стол перегородил бы проход (world/flow.ts) — в клетке поближе к середине.
  const e = k.plan.entry;
  const rot = (e ? (e.dir % 2 === 0 ? 0 : 1) : 0) as 0 | 1;
  const m = middle(ctx);
  const tries = [m.c.xf.child(m.dx, 0, m.dz, rot), ...ctx.cells.map((c) => c.xf.child(0, 0, 0, rot))];
  for (const at of tries) {
    if (!put(ctx, 'meeting_table', at)) continue;
    landmark(ctx, 'meeting', at, 0, 0.8, 0);
    // На листах посреди стола переговоров (props_office.ts, meetingTable).
    spot(ctx, at, 0, S3_TOP.s3_table_meeting! + 0.006, 0, 'table');
    break;
  }
  wallBy(ctx, k.hero, ['whiteboard']);
  wallBy(ctx, k.door, ['office_clock']);
  corner(ctx, 'cactus_column');
  // Экран для презентаций — на боковой стене.
  const scr = bestSlots(ctx, false, notNear(ctx, k.side))[0];
  if (scr) {
    scr.used = true;
    screenAt(ctx, scr.xf.child(0, 1.05, 0), 'wall', NATURE, scr.dir);
  }
  floorSpots(ctx, 1);
}

function breakroom(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Мини-кухня — сбоку; автомат, кулер и корзина — у входа (за ними заходят на минуту); столик с двумя стульями — напротив
  // входа, телевизор — на стене напротив столика.
  const kn = wallBy(ctx, k.side, ['kitchenette']);
  if (kn) {
    landmark(ctx, 'breakroom', kn.s.xf, kn.x, 1.0, 0.4);
    spot(ctx, kn.s.xf, kn.x + KITCHEN_SPOT.x, KITCHEN_SPOT.y, 0.3, 'table');
  }
  wallBy(ctx, k.door, ['vending_machine']);
  wallBy(ctx, k.door, ['water_cooler', -0.4], ['trash_bin', 0.35]);
  const t = wallBy(ctx, k.hero, ['table_cafe'], ['chair_bent', -0.85], ['chair_bent', 0.85]);
  if (t) spot(ctx, t.s.xf, t.x, 0.745, 0.35, 'table');
  floorSpots(ctx, 2);
  // Телевизор в комнате отдыха — единственный экран офиса, где не природа, а то, что смотрели все: студия телеигры, кадр
  // мультфильма. Напротив столика (за ним и смотрели), иначе первый свободный участок — без ГСЧ: обстановка не сдвигается.
  const o = t ? k.plan.opposite(t.s) : undefined;
  const tv = o && !o.used && !o.hazard ? o : ctx.slots.find((sl) => !sl.used && !sl.hazard);
  if (tv) {
    tv.used = true;
    screenAt(ctx, tv.xf.child(0, 1.25, 0), 'wall', POP, tv.dir);
  }
}

/** Сколько места креслу между развёрнутым столом начальника и стеной за ним, м. */
const BOSS_GAP = 1.0;

function manager(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Стол начальника — лицом ко входу: развёрнут от стены, кресло между ним и стеной, на стене за креслом — картина; кресло для
  // посетителя — перед столом. С порога видно стол и пустое кресло за ним. Не встал развёрнутым — у стены.
  const D = ALL_PROPS.office_desk!;
  let desk = false;
  for (const s of bestSlots(ctx, false, notNear(ctx, k.hero))) {
    const seed = seedOf(ctx);
    const z = BOSS_GAP + D.d;
    if (D.build(s.xf.child(0, 0, z, 2), seed) === false) continue;
    s.used = true;
    desk = true;
    const top = officeDeskTop(seed);
    put(ctx, 'office_terminal', s.xf.child(0.32, top, z - 0.33, 2));
    put(ctx, 'desk_phone', s.xf.child(-0.2, top, z - 0.2, 2));
    put(ctx, 'office_chair', s.xf.child(0.1, 0, BOSS_GAP / 2));
    put(ctx, 'print_large', s.xf.child(0, 1.45, 0));
    put(ctx, 'armchair_visitor', s.xf.child(0, 0, z + 0.95, 2));
    landmark(ctx, 'manager', s.xf, 0, 0.9, z - 0.3);
    spot(ctx, s.xf, -0.28, top + 0.005, BOSS_GAP + 0.16, 'table');
    break;
  }
  if (!desk) {
    const d = wallBy(ctx, k.hero, ['office_desk']);
    if (d) {
      const xf = d.s.xf;
      // Стол — одна из моделей полки: что на него ставится, встаёт на его столешницу.
      const top = officeDeskTop(d.seeds[0]!);
      put(ctx, 'office_terminal', xf.child(d.x - 0.32, top, 0.33));
      put(ctx, 'desk_phone', xf.child(d.x + 0.2, top, 0.2));
      put(ctx, 'office_chair', xf.child(d.x - 0.1, 0, 1.02, 2));
      landmark(ctx, 'manager', xf, d.x, 0.9, 0.4);
      spot(ctx, xf, d.x + 0.28, top + 0.005, 0.48, 'table');
    }
    wallBy(ctx, k.side, ['armchair_visitor']);
    wallBy(ctx, k.side, ['print_large']);
  }
  wallBy(ctx, k.side, ['binder_shelf']);
  wallBy(ctx, k.door, ['floor_lamp_brass']);
  corner(ctx, 'cactus_column');
  put(ctx, 'rug_wool', homeCentre(ctx).xf.child(0, 0, 0));
  floorSpots(ctx, 2);
}

function files(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  let first = true;
  // Шкафы с папками — рядами вдоль стен, начиная с дальних от входа; стена входа свободна.
  for (let i = 0; i < ctx.cells.length * 2; i++) {
    // Два стеллажа с папками — бок о бок, во всю стену: у стеллажей полки они шире прежних.
    const row = ctx.rng() < 0.6 ? wallBy(ctx, notNear(ctx, k.hero), ['filing_cabinet', -0.52], ['filing_cabinet', 0], ['filing_cabinet', 0.52]) : wallBy(ctx, notNear(ctx, k.hero), ['binder_shelf', -0.69], ['binder_shelf', 0.69]);
    if (!row) break;
    if (first) landmark(ctx, 'files', row.s.xf, row.x, 1.2, 0.4);
    first = false;
  }
  floorSpots(ctx, 3);
}

function copyroom(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  const c = wallBy(ctx, k.hero, ['copier']);
  if (c) {
    landmark(ctx, 'copyroom', c.s.xf, c.x, 1.0, 0.4);
    // На крышке копира (её верх — 0,97 м): место висело в воздухе на десять сантиметров выше.
    spot(ctx, c.s.xf, c.x - 0.15, 0.975, 0.3, 'table');
  }
  wallBy(ctx, k.side, ['binder_shelf', -0.55], ['paper_stack', 0.5]);
  corner(ctx, 'trash_bin');
  floorSpots(ctx, 2);
}

function server(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  let first = true;
  // Стойки — парами вдоль стен напротив входа и сбоку: с порога видна стена мигающих огоньков.
  for (let i = 0; i < ctx.cells.length + 1; i++) {
    const r = wallBy(ctx, notNear(ctx, k.hero), ['server_rack', -0.38], ['server_rack', 0.38]);
    if (!r) break;
    if (first) landmark(ctx, 'server', r.s.xf, r.x, 1.3, 0.5);
    first = false;
  }
  floorSpots(ctx, 2);
}

function washroom(ctx: RoomCtx): void {
  panels(ctx);
  const k = roles(ctx);
  // Раковина с зеркалом — сбоку от входа, унитаз — дальше.
  const w = wallBy(ctx, k.side, ['sink_cabinet'], ['mirror', 0, 1.15]);
  if (w) landmark(ctx, 'washroom', w.s.xf, w.x, 1.0, 0.3);
  wallBy(ctx, k.hero, ['toilet_home']);
  floorSpots(ctx, 2);
}

const OFFICE: Partial<Record<RoomCtx['room']['type'], (ctx: RoomCtx) => void>> = { corridor, lift, reception, department, cubicles, meeting, breakroom, manager, files, copyroom, server, washroom };

/** Обставить помещение офиса. Незнакомое помещение получает хотя бы свет и места для вещей. */
export function furnishOffice(ctx: RoomCtx): void {
  const fn = OFFICE[ctx.room.type];
  if (fn) return fn(ctx);
  panels(ctx);
  floorSpots(ctx, 2);
}

// ───────────────────────── жёлтые комнаты ─────────────────────────

/** Оттенок обоев жёлтых комнат (тот же, что у стен: world/level_build.ts). */
const YELLOW_WALL: [number, number, number] = [1.3, 1.12, 0.5];

/** Колонны там, где сходятся четыре клетки одного зала: зал без них был бы просто большой комнатой. */
function pillars(ctx: RoomCtx): void {
  const has = new Set(ctx.cells.map((c) => `${c.cx},${c.cz}`));
  for (const c of ctx.cells) {
    if (!has.has(`${c.cx + 1},${c.cz}`) || !has.has(`${c.cx},${c.cz + 1}`) || !has.has(`${c.cx + 1},${c.cz + 1}`)) continue;
    const xf = c.xf.child(1.5, 0, 1.5);
    xf.solid([-0.19, 0, -0.19], [0.19, ctx.h, 0.19], MAT.wallpaper, { tint: YELLOW_WALL });
    xf.box([-0.22, 0, -0.22], [0.22, 0.1, 0.22], MAT.wood, { tint: [0.7, 0.62, 0.45] });
  }
}

/** То, что осталось: редкий одинокий предмет посреди клетки. Пройти он не мешает — обойти можно всегда. */
function leftovers(ctx: RoomCtx, rate: number): void {
  for (const c of ctx.cells) {
    // Клетки с проходами остаются пустыми.
    if (c.doors > 0) continue;
    const r = ctx.rng();
    const ox = (ctx.rng() - 0.5) * 1.2;
    const oz = (ctx.rng() - 0.5) * 1.2;
    const rot = Math.floor(ctx.rng() * 4) as 0 | 1 | 2 | 3;
    if (r < rate * 0.35) put(ctx, 'office_chair', c.xf.child(ox, 0, oz, rot));
    else if (r < rate * 0.6) put(ctx, 'wet_floor_sign', c.xf.child(ox, 0, oz, rot));
    else if (r < rate * 0.75) put(ctx, 'partition', c.xf.child(ox, 0, oz, rot));
    else if (r < rate * 0.9) put(ctx, 'chair_bent', c.xf.child(ox, 0, oz - 0.3, rot));
    else if (r < rate) put(ctx, 'trash_bin', c.xf.child(ox, 0, oz));
  }
}

function yellowCorridor(ctx: RoomCtx): void {
  panels(ctx);
  // В коридоре остатков почти нет: только знак, о который нельзя споткнуться.
  for (const c of ctx.cells) if (c.doors === 0 && ctx.rng() < 0.05) put(ctx, 'wet_floor_sign', c.xf.child((ctx.rng() - 0.5) * 0.8, 0, (ctx.rng() - 0.5) * 0.8));
  // Этаж обесточен, и в темноте держатся комнаты, которых нет: до трёх на коридор.
  veils(ctx, 3);
}

function hall(ctx: RoomCtx): void {
  panels(ctx);
  pillars(ctx);
  leftovers(ctx, 0.45);
  floorSpots(ctx, Math.min(4, ctx.cells.length + 1));
  const c = ctx.cells[0]!;
  landmark(ctx, 'hall', c.xf, 0, 1.2, 0);
}

function yellowDepartment(ctx: RoomCtx): void {
  panels(ctx);
  // Остров столов стоит как стоял: единственное, что здесь помнит, зачем был этаж.
  const m = middle(ctx);
  if (put(ctx, 'desk_island', m.c.xf.child(m.dx, 0, m.dz))) {
    landmark(ctx, 'department', m.c.xf, m.dx, 1.0, m.dz);
    spot(ctx, m.c.xf, m.dx + 2.1, 0.03, m.dz, 'floor');
    spot(ctx, m.c.xf, m.dx - 2.1, 0.03, m.dz, 'floor');
    spot(ctx, m.c.xf, m.dx, 0.03, m.dz + 2.0, 'floor');
  }
}

function yellowBreakroom(ctx: RoomCtx): void {
  panels(ctx);
  // Автомат всё ещё светится.
  const v = wall(ctx, ['vending_machine']);
  if (v) landmark(ctx, 'breakroom', v.s.xf, v.x, 1.0, 0.4);
  const t = wall(ctx, ['table_cafe']);
  if (t) spot(ctx, t.s.xf, t.x, 0.745, 0.35, 'table');
  floorSpots(ctx, 2);
}

function yellowLift(ctx: RoomCtx): void {
  panels(ctx);
  const south = ctx.slots.find((s) => s.dir === 1 && !s.used) ?? ctx.slots.find((s) => !s.used);
  if (south && put(ctx, 'elevator_doors', south.xf.child(0, 0, 0))) {
    south.used = true;
    landmark(ctx, 'lift', south.xf, 0, 1.2, 0.2);
  }
}

function yellowReception(ctx: RoomCtx): void {
  panels(ctx);
  const c = ctx.cells[0]!;
  put(ctx, 'wet_floor_sign', c.xf.child(0.7, 0, 0.5));
}

const YELLOW: Partial<Record<RoomCtx['room']['type'], (ctx: RoomCtx) => void>> = {
  corridor: yellowCorridor,
  hall,
  department: yellowDepartment,
  breakroom: yellowBreakroom,
  washroom,
  lift: yellowLift,
  reception: yellowReception,
};

/**
 * Экраны жёлтых комнат: ровно столько, сколько досталось помещению (на весь уровень их два). На них
 * то же, что на экранах офиса, — это и есть связь двух мест: этаж тот же. Сначала — к свободной
 * стене; не нашлось стены — на подставке посреди клетки, так что экран встаёт всегда.
 */
function quotaScreens(ctx: RoomCtx): void {
  const images = ctx.screens ?? [];
  let done = leanScreens(ctx, images.length, 1, NATURE, images);
  const cells = [...ctx.cells].sort((a, b) => a.doors - b.doors);
  for (let i = 0; done < images.length && i < cells.length; i++, done++) {
    const c = cells[i]!;
    screenAt(ctx, c.xf.child(0.95, 0, -0.95, ((c.cx + c.cz) % 4) as 0 | 1 | 2 | 3), 'stand', NATURE, 9, images[done]);
  }
}

/** Обставить помещение жёлтых комнат. */
export function furnishYellow(ctx: RoomCtx): void {
  const fn = YELLOW[ctx.room.type];
  if (fn) fn(ctx);
  else {
    panels(ctx);
    floorSpots(ctx, 2);
  }
  quotaScreens(ctx);
}
