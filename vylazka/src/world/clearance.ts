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
export function grows(name: string, col: ColliderSet, c0: number, objects: readonly LevelObject[]): boolean {
  const near: Aabb[] = [];
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
  }
  return false;
}
