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
    const depth = growth(a, b);
    if (depth <= GROW_TOL) return false;
    if (depth <= TUCK && tucked(name, other)) return false;
    watcher?.(name, other, depth, a, b);
    return true;
  };
  for (let i = c0; i < col.boxes.length; i++) {
    const a = col.boxes[i]!;
    // Чужие вещи — объекты журнала (номер больше нуля); вещи партнёра и датчики касания не в счёт.
    for (const b of col.query(a.minX, a.minZ, a.maxX, a.maxZ, near)) {
      if (b.owner === undefined || b.owner <= 0 || b.owner === a.owner || b.partner || b.ghost) continue;
      if (hit(a, b, objects[b.owner - 1]?.name ?? '')) return true;
    }
    // Тени вещей игры, которые партнёр убрал, передвинул или заменил: для обстановки они стоят, где стояли.
    for (const sh of col.shadows) if (hit(a, sh.box, sh.name)) return true;
  }
  return false;
}
