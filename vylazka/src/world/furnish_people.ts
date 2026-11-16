/**
 * Манекены людей по местам (слова партнёра: «расставить вещи и манекены людей»). Последним проходом и
 * своим сидом, как бумага и своё стирание: номера и места прежних объектов от них не сдвигаются.
 *
 * Обстановка помещений сама записывает места, где мог бы быть человек (RoomCtx.people): сиденья скамей,
 * диван, кресло у стола начальника, табло, таксофон. Здесь из них выбираются несколько — по сиду уровня.
 * В начале вылазки людей нет: первое, что видит игрок, — пустое место; человек встречается дальше.
 *
 * С кругами петли людей становится меньше раньше, чем вещей: из памяти первыми уходят люди (story.md).
 * Манекен — объект уровня, как любой предмет: тронутый рассыпается.
 */
import { hash01 } from '../core/rng';
import type { GenRoom, WorldKind } from '../gen/layout';
import type { RoomCtx } from './furnish';
import type { Xf } from './props';
import { ALL_PROPS } from './props_all';

/** Место для человека: что тут делают (поза) и рамка, в которой фигура встаёт (лицом в +z). */
export interface PersonSpot {
  xf: Xf;
  kind: 'seat' | 'sofa' | 'desk' | 'look' | 'call' | 'lean';
}

/** Сколько людей на уровне в начале петли. */
const COUNT: Record<WorldKind, number> = { station: 5, office: 3, shelter: 2, yellow: 1 };
/** Не больше стольких людей одного рода: все смотрят на табло — уже толпа, а не память. */
const CAP: Record<PersonSpot['kind'], number> = { seat: 4, sofa: 1, desk: 2, look: 1, call: 1, lean: 1 };

const PROP: Record<PersonSpot['kind'], string> = { seat: 'mq_sit', sofa: 'mq_sofa', desk: 'mq_desk', look: 'mq_look', call: 'mq_call', lean: 'mq_lean' };

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Записать место для человека (из кода обстановки). Генератор случайных чисел помещения не трогается. */
export function personSpot(ctx: RoomCtx, kind: PersonSpot['kind'], xf: Xf): void {
  (ctx.people ??= []).push({ xf, kind });
}

/** Сколько людей на уровне при этой стёртости места. */
export function peopleCount(world: WorldKind, wear: number): number {
  return Math.round(COUNT[world] * (1 - 0.8 * smooth(0.15, 0.85, wear)));
}

/**
 * Поставить людей. В жёлтых комнатах мест не записано (всё вынесли): там один человек стоит, прислонившись
 * к свободной глухой стене, — её участок занимается и для возвращения вещей больше не годится.
 */
export function furnishPeople(world: WorldKind, seed: number, wear: number, furnished: readonly { room: GenRoom; ctx: RoomCtx }[], start: { cx: number; cz: number }): number {
  const want = peopleCount(world, wear);
  if (want <= 0) return 0;
  const isStart = (r: GenRoom): boolean => r.cells.some(([x, z]) => x === start.cx && z === start.cz);
  const spots: { spot: PersonSpot; rank: number }[] = [];
  furnished.forEach(({ room, ctx }, ri) => {
    if (isStart(room)) return;
    (ctx.people ?? []).forEach((spot, i) => spots.push({ spot, rank: hash01(ri * 97 + i, 41, seed ^ 0x9e0b) }));
    if (world === 'yellow') {
      ctx.slots.forEach((s, i) => {
        if (s.used || s.hazard || !s.deep) return;
        spots.push({ spot: { xf: s.xf, kind: 'lean' }, rank: hash01(ri * 89 + i, 43, seed ^ 0x9e0b) });
      });
    }
  });
  spots.sort((a, b) => a.rank - b.rank);
  const taken: Partial<Record<PersonSpot['kind'], number>> = {};
  let placed = 0;
  for (const { spot } of spots) {
    if (placed >= want) break;
    if ((taken[spot.kind] ?? 0) >= CAP[spot.kind]) continue;
    const p = ALL_PROPS[PROP[spot.kind]];
    if (!p) continue;
    if (spot.kind === 'lean') {
      // Участок стены теперь занят: вещь «у другой стены» сюда не вернётся.
      const f = furnished.find(({ ctx }) => ctx.slots.some((s) => s.xf === spot.xf));
      const s = f?.ctx.slots.find((k) => k.xf === spot.xf);
      if (s) s.used = true;
    }
    p.build(spot.xf, Math.floor(hash01(placed, 47, seed ^ 0x9e0b) * 1e6));
    taken[spot.kind] = (taken[spot.kind] ?? 0) + 1;
    placed += 1;
  }
  return placed;
}
