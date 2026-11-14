/**
 * Обстановка офиса и «жёлтых комнат».
 *
 * Офис — стерильный лабиринт: белые коридоры, в каждой клетке потолочная панель, почти ничего
 * у стен. Посреди самой большой комнаты — отдел: один остров из четырёх столов с терминалами.
 * Остальное — кабинки, переговорная, комната отдыха, кабинет, картотека, копировальная, серверная.
 *
 * Жёлтые комнаты — тот же этаж, из которого ушло назначение: пустые залы с колоннами, часть панелей
 * мертва (те же, что гасит свет по клеткам: systems/cell_lights.ts, panelDead), редкие остатки —
 * одинокий стул, жёлтый знак «мокрый пол», перегородка.
 *
 * Мебель — из реестра ALL_PROPS: офисные предметы собраны кодом (props_office.ts), стулья, столы,
 * диваны, растения и картины — готовые модели (props_models.ts).
 */
import { panelDead } from '../systems/cell_lights';
import { floorSpots, free, homeCentre, homeStack, landmark, spot } from './furnish';
import type { CellInfo, HomeItem, RoomCtx, Slot } from './furnish';
import { MAT } from './materials';
import { ALL_PROPS } from './props_all';
import type { Xf } from './props';

const seedOf = (ctx: RoomCtx): number => Math.floor(ctx.rng() * 1e6);

/** Поставить предмет реестра в точку; незнакомое имя пропускается. */
function put(ctx: RoomCtx, name: string, xf: Xf): boolean {
  const p = ALL_PROPS[name];
  if (!p) return false;
  p.build(xf, seedOf(ctx));
  return true;
}

/** Предмет на свободный участок стены. */
function wall(ctx: RoomCtx, ...items: HomeItem[]): { s: Slot; x: number } | null {
  return homeStack(ctx, items);
}

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
 * Потолочные панели: по одной на клетку. dead — какие клетки остались без света (жёлтые комнаты):
 * там панель тёмная, с повисшим проводом.
 */
function panels(ctx: RoomCtx, dead = false): void {
  for (const c of ctx.cells) {
    const off = dead && panelDead(ctx.seed, c.cx, c.cz);
    const name = off ? 'ceiling_panel_dead' : 'ceiling_panel';
    const p = ALL_PROPS[name];
    if (p) p.build(c.xf.child(0, ctx.h, -p.d / 2), seedOf(ctx));
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
    else if (r < 0.15) put(ctx, 'kk_picture_medium', s.xf.child(x, 1.4, 0));
    else if (r < 0.19) put(ctx, 'trash_bin', s.xf.child(x, 0, 0.2));
    else if (r < 0.22) put(ctx, 'kk_cactus', s.xf.child(x, 0, 0.36));
    else continue;
    s.used = true;
  }
  // Вентиляция — в каждой третьей клетке, в стороне от панели.
  ctx.cells.forEach((c, i) => {
    if (i % 3 === 1) put(ctx, 'ceiling_vent', c.xf.child(0.95, ctx.h, -0.3));
  });
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
  const desk = wall(ctx, ['reception_desk']);
  if (desk) {
    landmark(ctx, 'reception', desk.s.xf, desk.x, 1.0, 0.4);
    spot(ctx, desk.s.xf, desk.x + 0.7, 1.12, 0.62, 'table');
  }
  // Напротив — стулья для тех, кто ждёт, и кактус между ними.
  wall(ctx, ['kk_chair_a', -0.75], ['kk_chair_a', 0.75], ['kk_cactus_small', 0, 0]);
  floorSpots(ctx, 1);
}

function department(ctx: RoomCtx): void {
  panels(ctx);
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
  // Стены почти пусты: часы, кулер и одна полка с папками — больше в отделе ничего нет.
  wall(ctx, ['office_clock']);
  wall(ctx, ['water_cooler']);
  wall(ctx, ['binder_shelf']);
}

function cubicles(ctx: RoomCtx): void {
  panels(ctx);
  let made = 0;
  for (let i = 0; i < ctx.cells.length + 1; i++) {
    const c = wall(ctx, ['cubicle']);
    if (!c) break;
    made += 1;
    if (made === 1) landmark(ctx, 'cubicles', c.s.xf, c.x, 1.0, 0.8);
  }
  wall(ctx, ['filing_cabinet', -0.3], ['filing_cabinet', 0.3]);
  corner(ctx, 'trash_bin');
  floorSpots(ctx, 3);
}

function meeting(ctx: RoomCtx): void {
  panels(ctx);
  const c = homeCentre(ctx);
  if (put(ctx, 'meeting_table', c.xf.child(0, 0, 0))) {
    landmark(ctx, 'meeting', c.xf, 0, 0.8, 0);
    spot(ctx, c.xf, 0, 0.77, 0, 'table');
  }
  wall(ctx, ['whiteboard']);
  wall(ctx, ['office_clock']);
  corner(ctx, 'kk_cactus');
  floorSpots(ctx, 1);
}

function breakroom(ctx: RoomCtx): void {
  panels(ctx);
  const k = wall(ctx, ['kitchenette']);
  if (k) {
    landmark(ctx, 'breakroom', k.s.xf, k.x, 1.0, 0.4);
    spot(ctx, k.s.xf, k.x - 0.6, 0.94, 0.3, 'table');
  }
  wall(ctx, ['vending_machine']);
  wall(ctx, ['water_cooler', -0.4], ['trash_bin', 0.35]);
  // Столик у стены и два стула по бокам.
  const t = wall(ctx, ['kk_table_small'], ['kk_chair_a', -0.85], ['kk_chair_a', 0.85]);
  if (t) spot(ctx, t.s.xf, t.x, 0.72, 0.35, 'table');
  floorSpots(ctx, 2);
}

function manager(ctx: RoomCtx): void {
  panels(ctx);
  const d = wall(ctx, ['office_desk']);
  if (d) {
    const xf = d.s.xf;
    put(ctx, 'office_terminal', xf.child(d.x - 0.32, 0.75, 0.33));
    put(ctx, 'desk_phone', xf.child(d.x + 0.2, 0.75, 0.2));
    put(ctx, 'office_chair', xf.child(d.x - 0.1, 0, 1.15, 2));
    landmark(ctx, 'manager', xf, d.x, 0.9, 0.4);
    spot(ctx, xf, d.x + 0.28, 0.77, 0.52, 'table');
  }
  wall(ctx, ['kk_armchair']);
  wall(ctx, ['binder_shelf']);
  wall(ctx, ['kk_picture_large']);
  wall(ctx, ['kk_lamp_standing']);
  corner(ctx, 'kk_cactus');
  put(ctx, 'kk_rug_rect', homeCentre(ctx).xf.child(0, 0, 0));
  floorSpots(ctx, 2);
}

function files(ctx: RoomCtx): void {
  panels(ctx);
  let first = true;
  for (let i = 0; i < ctx.cells.length * 2; i++) {
    const row = ctx.rng() < 0.6 ? wall(ctx, ['filing_cabinet', -0.52], ['filing_cabinet', 0], ['filing_cabinet', 0.52]) : wall(ctx, ['binder_shelf', -0.55], ['binder_shelf', 0.55]);
    if (!row) break;
    if (first) landmark(ctx, 'files', row.s.xf, row.x, 1.2, 0.4);
    first = false;
  }
  floorSpots(ctx, 3);
}

function copyroom(ctx: RoomCtx): void {
  panels(ctx);
  const c = wall(ctx, ['copier']);
  if (c) {
    landmark(ctx, 'copyroom', c.s.xf, c.x, 1.0, 0.4);
    spot(ctx, c.s.xf, c.x - 0.15, 1.07, 0.3, 'table');
  }
  wall(ctx, ['binder_shelf', -0.55], ['paper_stack', 0.5]);
  corner(ctx, 'trash_bin');
  floorSpots(ctx, 2);
}

function server(ctx: RoomCtx): void {
  panels(ctx);
  let first = true;
  for (let i = 0; i < ctx.cells.length + 1; i++) {
    const r = wall(ctx, ['server_rack', -0.38], ['server_rack', 0.38]);
    if (!r) break;
    if (first) landmark(ctx, 'server', r.s.xf, r.x, 1.3, 0.5);
    first = false;
  }
  floorSpots(ctx, 2);
}

function washroom(ctx: RoomCtx): void {
  panels(ctx);
  const s = wall(ctx, ['sink_cabinet'], ['mirror', 0, 1.15]);
  if (s) landmark(ctx, 'washroom', s.s.xf, s.x, 1.0, 0.3);
  wall(ctx, ['toilet_home']);
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
    else if (r < rate * 0.9) put(ctx, 'kk_chair_a', c.xf.child(ox, 0, oz - 0.3, rot));
    else if (r < rate) put(ctx, 'trash_bin', c.xf.child(ox, 0, oz));
  }
}

function yellowCorridor(ctx: RoomCtx): void {
  panels(ctx, true);
  // В коридоре остатков почти нет: только знак, о который нельзя споткнуться.
  for (const c of ctx.cells) if (c.doors === 0 && ctx.rng() < 0.05) put(ctx, 'wet_floor_sign', c.xf.child((ctx.rng() - 0.5) * 0.8, 0, (ctx.rng() - 0.5) * 0.8));
}

function hall(ctx: RoomCtx): void {
  panels(ctx, true);
  pillars(ctx);
  leftovers(ctx, 0.45);
  floorSpots(ctx, Math.min(4, ctx.cells.length + 1));
  const c = ctx.cells[0]!;
  landmark(ctx, 'hall', c.xf, 0, 1.2, 0);
}

function yellowDepartment(ctx: RoomCtx): void {
  panels(ctx, true);
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
  panels(ctx, true);
  // Автомат всё ещё светится.
  const v = wall(ctx, ['vending_machine']);
  if (v) landmark(ctx, 'breakroom', v.s.xf, v.x, 1.0, 0.4);
  const t = wall(ctx, ['kk_table_small']);
  if (t) spot(ctx, t.s.xf, t.x, 0.72, 0.35, 'table');
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

/** Обставить помещение жёлтых комнат. */
export function furnishYellow(ctx: RoomCtx): void {
  const fn = YELLOW[ctx.room.type];
  if (fn) return fn(ctx);
  panels(ctx, true);
  floorSpots(ctx, 2);
}
