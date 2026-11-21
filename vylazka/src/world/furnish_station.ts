/**
 * Обстановка зала ожидания (docs/vylazka/station.md).
 *
 * Зал — простор: ряды сидений посередине, четыре колонны, табло и часы; вещей немного, и ни одна
 * не заслоняет дальнюю стену. По бокам — касса, камеры хранения, буфет, кладовая; на север уходят
 * два тесных перехода к перрону. Людей нет: от них остались чемоданы, пальто, тёплый стакан.
 *
 * Предметы — из реестра ALL_PROPS (props_station.ts). Места для вещей-воспоминаний раскладываются
 * здесь же: у каждой вещи зала своё помещение (systems/session.ts, STATION_MEMORIES).
 */
import { floorSpots, free, homeStack, landmark, spot } from './furnish';
import type { CellInfo, HomeItem, RoomCtx, Slot } from './furnish';
import { ALL_PROPS } from './props_all';
import { benchSeat } from './props_station';
import { hanging } from './objects';
import type { Xf } from './props';

const seedOf = (ctx: RoomCtx): number => Math.floor(ctx.rng() * 1e6);

/** Поставить предмет реестра в точку; незнакомое имя пропускается. Ответ — сид, с которым он собран (null — не поставлен). */
function put(ctx: RoomCtx, name: string, xf: Xf): number | null {
  const p = ALL_PROPS[name];
  if (!p) return null;
  const seed = seedOf(ctx);
  // null — не встала: врастала в соседнюю (world/clearance.ts).
  return p.build(xf, seed) === false ? null : seed;
}

/** Предмет (или несколько) на свободный участок стены. */
function wall(ctx: RoomCtx, ...items: HomeItem[]): { s: Slot; x: number; seeds: number[] } | null {
  return homeStack(ctx, items);
}

/** То же, но на стену заданной стороны (0 — восток, 1 — юг, 2 — запад, 3 — север), если там свободно. */
function wallAt(ctx: RoomCtx, dir: number, name: string, y?: number): Slot | null {
  const p = ALL_PROPS[name];
  const s = ctx.slots.find((k) => k.dir === dir && !k.used && (p?.mount === 'wall' || k.deep));
  if (!p || !s) return null;
  if (p.build(s.xf.child(0, p.mount === 'wall' ? (y ?? p.y ?? 1.2) : 0, 0), seedOf(ctx)) === false) return null;
  s.used = true;
  return s;
}

/** Середина помещения (по охвату клеток) относительно его первой клетки, м. */
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

/**
 * Где на скамье лежат записка, стакан, пальто: на 0,42 м от спинки — это сиденье у всех трёх скамей полки (высота у каждой
 * своя, её отвечает benchSeat по сиду скамьи).
 */
const SEAT_Z = 0.42;

// ───────────────────────── помещения ─────────────────────────

/** Вход с улицы: отсюда вылазка начинается, сюда возвращает пробуждение. */
function vestibule(ctx: RoomCtx): void {
  const south = ctx.slots.find((s) => s.dir === 1 && !s.used) ?? ctx.slots.find((s) => !s.used);
  if (south) {
    south.used = true;
    landmark(ctx, 'entrance', south.xf, 0, 1.2, 0.2);
  }
  wall(ctx, ['st_clock']);
  put(ctx, 'st_bin', ctx.cells[0]!.xf.child(1.0, 0, 0.9));
}

/** Сам зал: 12 × 18 метров под стеклянной крышей. */
function concourse(ctx: RoomCtx): void {
  const m = middle(ctx);
  const at = (x: number, z: number): Xf => m.c.xf.child(m.dx + x, 0, m.dz + z);

  // Четыре колонны держат крышу.
  for (const [x, z] of [[-3, -4.5], [3, -4.5], [-3, 4.5], [3, 4.5]] as const) put(ctx, 'st_column', at(x, z));

  // Ряды сидений посередине, спинка к спинке; проход вдоль оси зала свободен.
  const rows = [-6.4, -2.6, 1.2, 5.0];
  rows.forEach((z, i) => {
    for (const x of [-1.5, 1.5]) {
      const seed = put(ctx, 'st_seats_double', at(x, z));
      if (seed === null) continue;
      // Места для вещей — на сиденьях: записка лежит там, где кто-то сидел.
      if ((i + (x > 0 ? 1 : 0)) % 2 === 0) spot(ctx, at(x, z), 0.55, benchSeat('st_seats_double', seed), SEAT_Z, 'table');
    }
  });

  // Табло и часы — на северной стене, между переходами: их видно от входа.
  wallAt(ctx, 3, 'st_board');
  wallAt(ctx, 3, 'st_clock');
  // У стен — сиденья, таксофоны, урны.
  for (let i = 0; i < 4; i++) {
    const r = wall(ctx, ['st_seats']);
    if (r && i % 2 === 0) spot(ctx, r.s.xf, r.x - 0.55, benchSeat('st_seats', r.seeds[0]!), SEAT_Z, 'table');
  }
  wall(ctx, ['st_phone']);
  wall(ctx, ['st_phone']);
  put(ctx, 'st_bin', at(-3.6, -4.5));
  put(ctx, 'st_bin', at(3.6, 4.5));
  // Чемоданы без хозяев.
  put(ctx, 'st_suitcase', at(-2.9, 1.4));
  put(ctx, 'st_suitcase', at(2.2, -3.4));
  put(ctx, 'st_suitcase', at(0.2, 6.2));
  floorSpots(ctx, 3);
  // Птицы (systems/birds.ts): под крышей живут голуби. От них на полу перья, а под затяжками переплёта
  // висят бумажные птицы на нитках — родня бумажным цветам. Сид у этих вещей свой, от места: остальная
  // обстановка зала от них не сдвигается. Затяжка висит на 0,87 м ниже верха крыши (level_build.ts, TIE_DROP).
  for (const [x, z] of [[-1.9, -5.3], [0.6, -0.6], [2.4, 3.1], [-0.7, 6.9]] as const) ALL_PROPS.feather?.build(at(x, z), Math.round(1000 + x * 37 + z * 91));
  for (const [x, z] of [[-2.2, -1.5], [0.8, 4.5], [2.6, -4.5]] as const) ALL_PROPS.paper_bird_hang?.build(m.c.xf.child(m.dx + x, 6.3 - 0.87, m.dz + z - 0.25), Math.round(2000 + x * 53 + z * 29));
}

/** Касса: два окошка и стойка с лентой перед ними. */
function tickets(ctx: RoomCtx): void {
  for (let i = 0; i < 2; i++) {
    const r = wall(ctx, ['st_ticket_window']);
    // На прилавке окошка (верх — 0,99 м): место висело над ним на семь сантиметров.
    if (r) spot(ctx, r.s.xf, r.x + 0.25, 0.995, 0.32, 'table');
  }
  put(ctx, 'st_barrier', ctx.cells[0]!.xf.child(0, 0, 0.5));
  wall(ctx, ['st_clock']);
  floorSpots(ctx, 1);
}

/** Камеры хранения: секции вдоль стен, одна ячейка приоткрыта. */
function lockers(ctx: RoomCtx): void {
  let n = 0;
  for (const s of free(ctx, true)) {
    if (n >= 5) break;
    s.used = true;
    // В углу секция врастала в секцию соседней стены (партнёр 18.11) — там её нет; место для вещи — только у той, что встала.
    const stood = [-0.69, 0.69].map((x) => put(ctx, 'st_lockers', s.xf.child(x, 0, 0)) !== null);
    if (n % 2 === 0 && stood[1]) spot(ctx, s.xf, 0.69, 0.02, 0.55, 'floor');
    n += 1;
  }
  put(ctx, 'st_suitcase', ctx.cells[0]!.xf.child(0.4, 0, 0.3));
  floorSpots(ctx, 2);
}

/** Буфет: прилавок с витриной, сиденья у стены. */
function buffet(ctx: RoomCtx): void {
  const k = wall(ctx, ['st_kiosk']);
  if (k) {
    spot(ctx, k.s.xf, k.x - 0.6, 1.02, 0.4, 'table');
    spot(ctx, k.s.xf, k.x + 0.5, 1.02, 0.4, 'table');
  }
  for (let i = 0; i < 2; i++) {
    const r = wall(ctx, ['st_seats']);
    if (r) spot(ctx, r.s.xf, r.x + 0.55, benchSeat('st_seats', r.seeds[0]!), SEAT_Z, 'table');
  }
  put(ctx, 'st_bin', ctx.cells[0]!.xf.child(-0.9, 0, 0.9));
  floorSpots(ctx, 1);
}

/** Переход к перрону: тесно и пусто. Указатель под потолком, изредка таксофон. */
function passage(ctx: RoomCtx): void {
  ctx.cells.forEach((c, i) => {
    if (i % 2 === 0) hanging(c.xf, () => put(ctx, 'st_sign', c.xf.child(0, ctx.h, 0)));
  });
  if (ctx.rng() < 0.5) wall(ctx, ['st_phone']);
}

/** Перрон: сиденья вдоль задней стены, часы, чемодан у края. За краем — пути. */
function platform(ctx: RoomCtx): void {
  const back = ctx.slots.filter((s) => s.dir === 1 && !s.used);
  back.forEach((s, i) => {
    if (i % 3 === 1) {
      s.used = true;
      const seed = put(ctx, 'st_seats', s.xf.child(0, 0, 0));
      if (seed !== null) spot(ctx, s.xf, i % 2 === 0 ? -0.55 : 0.55, benchSeat('st_seats', seed), SEAT_Z, 'table');
    } else if (i % 3 === 0 && i > 0) {
      s.used = true;
      put(ctx, 'st_bin', s.xf.child(0, 0, 0.3));
    }
  });
  wallAt(ctx, 1, 'st_clock');
  const m = middle(ctx);
  put(ctx, 'st_suitcase', m.c.xf.child(m.dx + 2.4, 0, m.dz - 0.6));
  put(ctx, 'st_suitcase', m.c.xf.child(m.dx - 5.5, 0, m.dz + 0.4));
  // Указатели под навесом.
  ctx.cells.forEach((c, i) => {
    if (i % 6 === 2) hanging(c.xf, () => put(ctx, 'st_sign', c.xf.child(0, ctx.h, 0)));
  });
}

/**
 * Кладовая: чужие вещи, которые никто не забрал. У дальней стены — стена чемоданов до потолка
 * (world/props_luggage.ts): её участок отведён заранее, сама она строится последним проходом
 * (world/furnish_papers.ts). Рядом с ней — одна секция ячеек у боковой стены, с той стороны, что дальше
 * от чемоданов: пара секций во всю стену упёрлась бы в них. Без стены чемоданов — как раньше: пара
 * секций и три чемодана на полу.
 */
function store(ctx: RoomCtx): void {
  const hold = ctx.papers?.[0];
  if (!hold) {
    wall(ctx, ['st_lockers', -0.69], ['st_lockers', 0.69]);
    const c = ctx.cells[0]!;
    put(ctx, 'st_suitcase', c.xf.child(-0.5, 0, 0.2));
    put(ctx, 'st_suitcase', c.xf.child(0.3, 0, -0.4));
    put(ctx, 'st_suitcase', c.xf.child(0.6, 0, 0.5));
  } else {
    const s = ctx.slots.find((k) => !k.used && !k.hazard);
    if (s) {
      s.used = true;
      // В какую сторону вдоль этой стены стоят чемоданы: секция встаёт на другую половину участка.
      const o = s.xf.pt(0, 0, 0);
      const x = s.xf.pt(1, 0, 0);
      const l = hold.slot.xf.pt(0, 0, 0);
      const toward = (x[0] - o[0]) * (l[0] - o[0]) + (x[2] - o[2]) * (l[2] - o[2]);
      put(ctx, 'st_lockers', s.xf.child(toward > 0 ? -0.69 : 0.69, 0, 0));
    }
  }
  floorSpots(ctx, 1);
}

function washroom(ctx: RoomCtx): void {
  put(ctx, 'st_bin', ctx.cells[0]!.xf.child(0.9, 0, 0.9));
  floorSpots(ctx, 1);
}

/** Обставить помещение зала ожидания. Порядок вызовов и ГСЧ фиксированы: один сид — одна обстановка. */
export function furnishStation(ctx: RoomCtx): void {
  switch (ctx.room.type) {
    case 'vestibule':
      return vestibule(ctx);
    case 'concourse':
      return concourse(ctx);
    case 'tickets':
      return tickets(ctx);
    case 'lockers':
      return lockers(ctx);
    case 'buffet':
      return buffet(ctx);
    case 'corridor':
      return passage(ctx);
    case 'platform':
      return platform(ctx);
    case 'storage':
      return store(ctx);
    case 'washroom':
      return washroom(ctx);
    default:
      // Пути: там ничего не стоит.
      return;
  }
}
