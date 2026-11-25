/**
 * Мебель не врастает в соседнюю (партнёр 18.11: «убери врастание мебели в соседнюю»; куратор, противоречие 255: шкафчики
 * спальни в нарах, платяной шкаф в кровати, нары в нарах у угла, кабинки друг в друге).
 *
 * Правило — для обстановки игры (world/objects.ts, withGrowthGuard; ставит сборка уровня): вещь собирается, и если её
 * преграды заходят в преграды уже стоящей вещи глубже GROW_TOL — по меньшей из двух сторон в плане и больше чем на 5 см по
 * высоте, — собранное откатывается, вещи нет, а раскладка узнаёт об этом и берёт другое место (или ничего). Стены и пол
 * (преграды без хозяина) не в счёт: у стены вещь стоит спиной вплотную. Стул и табурет можно задвинуть под стол — не глубже
 * TUCK: так их и ставит раскладка, сиденье под столешницей.
 *
 * Вещи партнёра и передвинутые им вещи игры этой проверки не проходят: у них своя, по правилу записи (world/placed_place.ts,
 * checkSpot), и решает он.
 */
import type { Aabb, ColliderSet } from './colliders';
import type { LevelObject } from './objects';

/** Насколько коробки соседних вещей могут зайти друг в друга, м: преграды — габариты, у самих моделей по краям есть воздух. */
export const GROW_TOL = 0.05;
/** Насколько вещь может уйти в стену, м: у моделей по краям воздух, а стена в плане чуть толще нарисованной. */
export const WALL_TOL = 0.08;
/** Насколько стул или табурет задвигается под стол, м. */
export const TUCK = 0.5;

const SEAT = /chair|stool/;
const TABLE = /table|desk/;

/** Сиденье у стола: такие пары могут заходить друг в друга до TUCK. */
export const tucked = (a: string, b: string): boolean => (SEAT.test(a) && TABLE.test(b)) || (SEAT.test(b) && TABLE.test(a));

/** Насколько две коробки заходят друг в друга: по меньшей из сторон в плане (0 — не заходят или разошлись по высоте). */
export function growth(a: Aabb, b: Aabb): number {
  const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (oy <= 0.05) return 0;
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return Math.max(0, Math.min(ox, oz));
}

/** Тоньше этого (в плане) — тонкая часть: перегородка, картина, полка на стене. */
export const THIN = 0.1;

/**
 * Насколько две коробки заходят друг в друга — и сквозной проход тонкой части тоже (партнёр 25.11: стойка с раковинами
 * проходила насквозь через перегородку кабинки, 2,8 см). По меньшей из сторон в плане тонкая перегородка не заходит в соседку
 * и на 3 см, хотя пересекает её всю. Если тонкая часть перекрыта по своей толщине целиком, заход — по другой стороне: насколько
 * она вдаётся в соседку. 0 — не заходят или разошлись по высоте.
 */
export function crossing(a: Aabb, b: Aabb): number {
  const d = growth(a, b);
  if (d <= 0) return 0;
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  const wx = Math.min(a.maxX - a.minX, b.maxX - b.minX);
  const wz = Math.min(a.maxZ - a.minZ, b.maxZ - b.minZ);
  let out = d;
  if (wx < THIN && ox >= wx - 1e-4) out = Math.max(out, oz);
  if (wz < THIN && oz >= wz - 1e-4) out = Math.max(out, ox);
  return out;
}

/**
 * Поле перед лицом вещи, м (партнёр 25.11: «расставить мебель так, как расставляют в реальности»; ревизия планов всех комнат:
 * стол вплотную к плите, барьер очереди поперёк окна кассы, клумба перед ячейками, стеллаж-остров в 30 см от фронта ряда).
 * Перед шкафом, плитой, окном кассы стоят, открывают и берут — туда другие вещи игры не встают, и сама вещь не встаёт лицом
 * вплотную к чужой. Два лица друг к другу делят один проход: поля между собой не мешают. Нормы — по кухням и складам (проход
 * у стеллажей 0,9 м, перед плитой и мойкой 0,9–1,2 м), урезаны под клетку 3 м.
 */
export const FRONT: Readonly<Record<string, number>> = {
  // Шкафы, стеллажи, ячейки — дверцы и ящики.
  s3_rack_metal: 0.8,
  binder_shelf: 0.8,
  bookshelf: 0.7,
  filing_cabinet: 0.8,
  wardrobe: 0.8,
  s3_dresser: 0.7,
  s3_locker_olive: 0.8,
  st_lockers: 0.9,
  s3_cabinet_medical: 0.8,
  battery_rack: 0.8,
  fuse_board: 0.8,
  // Кухня и подсобка.
  fridge: 0.9,
  stove: 0.9,
  sink_cabinet: 0.9,
  kitchenette: 0.9,
  washing_machine: 0.8,
  vending_machine: 0.9,
  water_cooler: 0.6,
  copier: 0.9,
  server_rack: 0.9,
  // Санузел: дверь кабинки, раковины.
  toilet_stall: 0.8,
  wash_basins: 0.8,
  s3_sink_pedestal: 0.6,
  // Ванна и унитаз — без поля: в ванной комнате всё вплотную, как в жизни.
  // Прилавки и окна: перед ними очередь.
  st_ticket_window: 1.1,
  st_kiosk: 1.1,
  reception_desk: 1.0,
  // Койки: длинной стороной в комнату — с неё ложатся.
  s3_bunk_black: 0.6,
  s3_bunk_mattress: 0.6,
  s3_bed_iron_white: 0.6,
};

/** Полоса пола перед лицом только что собранной вещи (её преграды — в col с номера c0; лицо — локальная +z при повороте rot). */
export function frontZone(name: string, col: ColliderSet, c0: number, rot: number | undefined): Aabb | null {
  const f = FRONT[name];
  if (!f || rot === undefined) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let y0 = Infinity;
  for (let i = c0; i < col.boxes.length; i++) {
    const b = col.boxes[i]!;
    if (b.ghost) continue;
    x0 = Math.min(x0, b.minX);
    x1 = Math.max(x1, b.maxX);
    z0 = Math.min(z0, b.minZ);
    z1 = Math.max(z1, b.maxZ);
    y0 = Math.min(y0, b.minY);
  }
  if (x0 > x1) return null;
  // Сбоку поле на 5 см уже вещи: сосед по ряду стоит вплотную, а не перед лицом.
  const e = 0.05;
  const y = { minY: y0 + 0.05, maxY: y0 + 1.6 };
  const group = col.boxes[c0]?.group;
  const g = group !== undefined ? { group } : {};
  switch (rot & 3) {
    case 0:
      return { minX: x0 + e, maxX: x1 - e, minZ: z1, maxZ: z1 + f, ...y, ...g };
    case 1:
      return { minX: x1, maxX: x1 + f, minZ: z0 + e, maxZ: z1 - e, ...y, ...g };
    case 2:
      return { minX: x0 + e, maxX: x1 - e, minZ: z0 - f, maxZ: z0, ...y, ...g };
    default:
      return { minX: x0 - f, maxX: x0, minZ: z0 + e, maxZ: z1 - e, ...y, ...g };
  }
}

/** Поле перед лицом не в счёт (главная вещь, которой иначе нет места): только пока выполняется fn. */
let frontOff = false;
export function withoutFront<T>(fn: () => T): T {
  const was = frontOff;
  frontOff = true;
  try {
    return fn();
  } finally {
    frontOff = was;
  }
}

/** Вещь встала: запомнить поле перед её лицом (если оно у неё есть). */
export function keepFront(name: string, col: ColliderSet, c0: number, rot: number | undefined): void {
  if (col.boxes[c0]?.partner) return;
  const box = frontZone(name, col, c0, rot);
  if (box) col.keeps.push({ box, owner: col.boxes[c0]?.owner ?? 0, name, rot: rot ?? 0 });
}

/**
 * Вещь у соседней стены, в углу (унитаз рядом со стиральной машиной, кухня буквой Г, ячейки в углу камеры хранения): повёрнута под прямым углом к хозяину
 * поля и заходит в поле только с его торца, не дальше UNDER_END вдоль ряда. Перед лицом она не стоит.
 */
const UNDER_END = 0.75;
/** То же для шкафа или плиты у соседней стены: на 35 см — как угловая тумба кухни буквой Г; дальше — уже перед дверцей. */
const CORNER_FRONT = 0.35;
/** Стол, стул, кровать — не ряд у стены: в поле перед плитой они не встают и сбоку. */
const LOOSE = /table|desk|chair|stool|bench|seat|sofa|armchair|bed|bunk/;
function atEnd(zone: Aabb, zrot: number, b: Aabb, brot: number | undefined, other: string): boolean {
  if (brot === undefined || ((zrot - brot) & 1) === 0 || LOOSE.test(other)) return false;
  const alongX = (zrot & 1) === 0;
  const z0 = alongX ? zone.minX : zone.minZ;
  const z1 = alongX ? zone.maxX : zone.maxZ;
  const lo = Math.max(z0, alongX ? b.minX : b.minZ);
  const hi = Math.min(z1, alongX ? b.maxX : b.maxZ);
  // Шкаф или плита в углу перед дверцей другого шкафа — нет: дверца не откроется (холодильник и плита буквой Г, ревизия 25.11).
  const reach = FRONT[other] !== undefined ? CORNER_FRONT : UNDER_END;
  return hi - lo <= reach && (lo - z0 < 0.06 || z1 - hi < 0.06);
}

/** Варианты расстановки одной комнаты (world/variants.ts) друг с другом не стоят. */
const otherVariant = (a: Aabb, b: Aabb): boolean => a.group !== undefined && b.group !== undefined && a.group !== b.group;

/** Кто не встал и во что упёрся — для разбора и тестов (null — никому не говорить). */
type Watcher = (name: string, other: string, depth: number, mine: Aabb, theirs: Aabb) => void;
let watcher: Watcher | null = null;
export function watchGrowth(fn: Watcher | null): void {
  watcher = fn;
}

/**
 * Врастает ли вещь name, только что собранная (её преграды — в col с номера c0), в уже стоящие вещи журнала objects.
 * Хозяин преграды — номер объекта журнала (с единицы).
 */
export function grows(name: string, col: ColliderSet, c0: number, objects: readonly LevelObject[], rot?: number): boolean {
  const near: Aabb[] = [];
  // Лицом вплотную к чужой вещи — не встаёт (поле перед лицом, FRONT).
  const zone = frontOff ? null : frontZone(name, col, c0, rot);
  if (zone) {
    const own = col.boxes[c0]?.owner;
    for (const b of col.query(zone.minX, zone.minZ, zone.maxX, zone.maxZ, near)) {
      // Лицом в стену (остров стеллажей, прижатый к стене): поле упирается в стену — так не ставят.
      if (b.owner === undefined && !b.ghost && !b.cut && !b.off && b.maxY - b.minY >= 1.2) {
        const depth = crossing(zone, b);
        if (depth > WALL_TOL) {
          watcher?.(name, 'front wall', depth, zone, b);
          return true;
        }
        continue;
      }
      if (b.owner === undefined || b.owner <= 0 || b.owner === own || b.partner || b.ghost || b.cut || b.off || otherVariant(zone, b)) continue;
      const o = objects[b.owner - 1];
      if (o && atEnd(zone, rot!, b, o.rot, o.name)) continue;
      const depth = crossing(zone, b);
      if (depth > GROW_TOL) {
        watcher?.(name, `front ${objects[b.owner - 1]?.name ?? ''}`, depth, zone, b);
        return true;
      }
    }
  }
  const hit = (a: Aabb, b: Aabb, other: string): boolean => {
    const depth = crossing(a, b);
    if (depth <= GROW_TOL) return false;
    if (depth <= TUCK && tucked(name, other)) return false;
    watcher?.(name, other, depth, a, b);
    return true;
  };
  for (let i = c0; i < col.boxes.length; i++) {
    const a = col.boxes[i]!;
    // Чужие вещи — объекты журнала (номер больше нуля) и массивы завала; вещи партнёра и датчики касания не в счёт.
    for (const b of col.query(a.minX, a.minZ, a.maxX, a.maxZ, near)) {
      if (b.mass && !b.ghost) {
        if (hit(a, b, 'collapse')) return true;
        continue;
      }
      // Стена (преграда без хозяина в рост): у стены вещь стоит вплотную, но в неё не уходит — не глубже WALL_TOL (аудит 25.11:
      // завал из жердей уходил в косяк проёма на 9 см).
      if (b.owner === undefined && !b.ghost && !b.cut && b.maxY - b.minY >= 1.2) {
        const depth = crossing(a, b);
        if (depth > WALL_TOL) {
          watcher?.(name, 'wall', depth, a, b);
          return true;
        }
        continue;
      }
      if (b.owner === undefined || b.owner <= 0 || b.owner === a.owner || b.partner || b.ghost) continue;
      if (hit(a, b, objects[b.owner - 1]?.name ?? '')) return true;
    }
    // Тени вещей игры, которые партнёр убрал, передвинул или заменил: для обстановки они стоят, где стояли, — и так же, как
    // стоящая вещь: её призрачные преграды (выдвинутый ящик, распахнутая дверца) соседей не держат. Без этого убранная первая
    // картотека держала ящиками вторую тройку у соседней стены, и та не вставала вовсе (CI 31be006, placed.test.ts).
    for (const sh of col.shadows) if (!sh.box.ghost && !sh.box.partner && hit(a, sh.box, sh.name)) return true;
    // В поле перед лицом другой вещи — не встаёт.
    if (a.ghost || frontOff) continue;
    for (const k of col.keeps) {
      if (k.owner === a.owner || otherVariant(a, k.box) || atEnd(k.box, k.rot, a, rot, name)) continue;
      const depth = crossing(a, k.box);
      if (depth > GROW_TOL) {
        watcher?.(name, `front of ${k.name}`, depth, a, k.box);
        return true;
      }
    }
  }
  return false;
}
