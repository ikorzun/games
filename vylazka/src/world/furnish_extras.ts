/**
 * То, что стоит в месте поверх его обычной обстановки — в любом мире (слова партнёра, 15.11):
 *
 *  - гора: «Гора и свечи как похороненное, что уже не восстановить. Память слиплась в кучу». Стоит
 *    у начала вылазки и растёт от круга к кругу (systems/decay.ts): по ней видно, сколько уже стёрто.
 *    Не растворяется: это то единственное, что здесь окончательно;
 *  - бумажные цветы: «про школьные поделки и одновременно про замершую, хоть и красивую, но мёртвую
 *    часть воспоминаний»; «цветы могут быть где угодно», потолок ради них можно поднять — в одном
 *    помещении он выше обычного, и цветы висят над головой;
 *  - наклейки: «Отображение современного мира есть в любой локации. Каждая локация — это микс
 *    воспоминаний из разного времени»;
 *  - завал: куча длинных жердей, связанных белыми обмотками.
 *
 * Ставится после обычной обстановки, на свободные участки стен; чего не поместилось — того нет.
 */
import { MAT } from './materials';
import { asObject, hanging } from './objects';
import { ALL_PROPS } from './props_all';
import type { CellInfo, RoomCtx, Slot } from './furnish';
import { fit, landmark } from './furnish';

export interface Extras {
  /** Гора слипшегося: 0 — нет, 1 — кучка, 2 — гора, 3 — гора и кучка рядом. */
  mound: 0 | 1 | 2 | 3;
  /** Помещение с высоким потолком: цветы висят над головой. */
  garden: boolean;
  /** Сколько цветов поставить на пол (по одному и клумбами). */
  flowers: number;
  /** Сколько мест с наклейками. */
  stickers: number;
  /** Поставить завал. */
  thicket: boolean;
}

export const NO_EXTRAS: Extras = { mound: 0, garden: false, flowers: 0, stickers: 0, thicket: false };

/** Высота потолка в помещении с цветами над головой, м (ярусы идут через 4,5 м: остаётся перекрытие). */
export const GARDEN_H = 4.2;

const seedOf = (ctx: RoomCtx): number => Math.floor(ctx.rng() * 1e6);

/** Свободный участок стены: сначала глубокие (без двери рядом), по порядку клеток — выбор не зависит от ГСЧ. */
function freeSlot(ctx: RoomCtx, deep: boolean): Slot | undefined {
  const free = ctx.slots.filter((s) => !s.hazard && !s.used && (!deep || s.deep));
  return free.sort((a, b) => Number(b.deep) - Number(a.deep) || a.cx - b.cx || a.cz - b.cz || a.dir - b.dir)[Math.floor(ctx.rng() * free.length)];
}

/** Поставить предмет реестра у участка стены: напольный — спиной к ней, «свободный» — в off метрах от неё. */
function stand(ctx: RoomCtx, name: string, s: Slot, dx = 0, off = 0.12): boolean {
  const p = ALL_PROPS[name];
  if (!p) return false;
  const z = p.mount === 'free' ? p.d / 2 + off : 0;
  // Не встала — врастала в мебель (world/clearance.ts): участок остаётся свободным, другое помещение примет её.
  if (p.build(s.xf.child(dx, p.mount === 'wall' ? (p.y ?? 1) : 0, z), seedOf(ctx)) === false) return false;
  s.used = true;
  return true;
}

/**
 * Поставить то, что положено помещению. Возвращает, что встало: чему не нашлось места, то примет
 * другое помещение (это решает сборка уровня).
 */
export function furnishExtras(ctx: RoomCtx, x: Extras): { mound: boolean; stickers: number; thicket: boolean } {
  let mound = false;
  let stickers = 0;
  let thicket = false;
  if (x.mound > 0) {
    // Гора — у глухой стены. Нет такой — у стены рядом с проходом встаёт только кучка: гора перегородила бы путь.
    const deep = freeSlot(ctx, true);
    const s = deep ?? freeSlot(ctx, false);
    const name = deep && x.mound >= 2 ? 'mound' : 'mound_small';
    if (s && stand(ctx, name, s)) {
      mound = true;
      landmark(ctx, 'mound', s.xf, 0, 0.6, ALL_PROPS[name]!.d / 2 + 0.12);
      if (x.mound >= 3) {
        const s2 = freeSlot(ctx, true);
        if (s2) stand(ctx, 'mound_small', s2);
      }
    }
  }
  if (x.garden) garden(ctx);
  for (let i = 0; i < x.flowers; i++) {
    const s = freeSlot(ctx, true);
    if (!s) break;
    if (stand(ctx, i % 2 === 0 ? 'paper_flower_bed' : 'paper_flower', s, 0, 0.15) && i === 0) landmark(ctx, 'flowers', s.xf, 0, 1.2, 0.9);
  }
  for (let i = 0; i < x.stickers; i++) {
    const s = freeSlot(ctx, false);
    if (!s) break;
    if (!stand(ctx, i % 2 === 0 ? 'sticker_box' : 'sticker_patch', s, (ctx.rng() - 0.5) * 0.8)) break;
    if (i === 0) landmark(ctx, 'stickers', s.xf, 0, 1.3, 0);
    stickers += 1;
  }
  if (x.thicket) {
    const s = freeSlot(ctx, true);
    // 2,4 м вдоль стены — у угла сдвинуть от соседней стены (fit), а не впритык к ней: иначе жерди уходили в косяк (аудит 25.11).
    const t = ALL_PROPS.thicket;
    if (s && t && stand(ctx, 'thicket', s, fit(s, t.w, t.d + 0.1), 0.1)) {
      thicket = true;
      landmark(ctx, 'thicket', s.xf, 0, 1.2, 0.8);
    }
  }
  return { mound, stickers, thicket };
}

/**
 * Сад под потолком: в каждой клетке без прохода (а если таких нет — во всех) висит цветок головой
 * вниз, каждый на своей высоте — от «над самой головой» до «рукой не достать». Подвесное обычно не
 * предмет (его не коснуться), но цветок — предмет: он расцветает и рассыпается, когда к нему подходят.
 */
function garden(ctx: RoomCtx): void {
  const hang = ALL_PROPS.paper_flower_hang;
  if (!hang) return;
  const inner = ctx.cells.filter((c) => c.doors === 0);
  const cells: CellInfo[] = (inner.length >= 3 ? inner : ctx.cells).slice(0, 5);
  cells.forEach((c, i) => {
    const drop = [0.2, 1.3, 0.7, 1.6, 0.4][i % 5]!;
    const jx = (ctx.rng() - 0.5) * 1.2;
    const jz = (ctx.rng() - 0.5) * 1.2;
    const top = ctx.h - drop;
    // Нить от потолка до подвеса.
    if (drop > 0.05) hanging(c.xf, () => c.xf.cyl([jx, top, jz], 'y', drop, 0.004, MAT.paper, { tint: [1.1, 1.08, 1.0], segments: 4, caps: false }));
    // У подвесного предмета начало координат — у края (z от 0 до d): сдвигаем, чтобы головка была под нитью.
    const at = c.xf.child(jx, top, jz, Math.floor(ctx.rng() * 4) as 0 | 1 | 2 | 3).child(0, 0, -hang.d / 2);
    const seed = seedOf(ctx);
    asObject(at, 'paper_flower_hang', () => hang.build(at, seed));
    if (i === 0) landmark(ctx, 'garden', c.xf, jx, 1.4, jz);
  });
  // И клумба на полу — у стены.
  const s = freeSlot(ctx, true);
  if (s) stand(ctx, 'paper_flower_bed', s, 0, 0.15);
}
