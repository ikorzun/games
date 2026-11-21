/**
 * Варианты расстановки (квиз 17.11, ночь: «Свой вариант на каждую»). У каждого «другого такого» помещения в конструкторе
 * своя расстановка партнёра: вещи, передвинутые и убранные вещи игры, манекены. Запись помнит, в каком помещении её
 * сделали: slot — «тип.номер» («kitchen.2» — третья кухня конструктора).
 *
 * В игре помещение этого типа берёт один из вариантов по жребию сида уровня и номера помещения, и в нём действуют записи
 * этого варианта. Записи, сделанные до вариантов, — первый вариант своего типа помещения (slotFor); общие (на несколько
 * типов или на любые) действуют везде, кроме тех вещей игры, которые выпавший вариант двигает или убирает сам. Вариант
 * один — все такие помещения получают его: как было, «одна расстановка на все».
 *
 * Чистый TS: работает в сборке уровня (Worker), в конструкторе и в тестах.
 */
import { hash2 } from '../core/rng';
import type { GenLayout, GenRoom } from '../gen/layout';

export const SLOT_RE = /^[a-z_]+\.\d{1,3}$/;

/** Вариант k-го помещения типа type (номер — как у «другого такого» в конструкторе, с нуля). */
export function slotOf(type: string, k: number): string {
  return `${type}.${k}`;
}

/** Тип помещения варианта. */
export function slotType(slot: string): string {
  return slot.slice(0, slot.lastIndexOf('.'));
}

/** Номер варианта (с нуля). */
export function slotNumber(slot: string): number {
  return Number(slot.slice(slot.lastIndexOf('.') + 1));
}

/**
 * Какой вариант достался помещению уровня: из вариантов его типа, что есть у записей (slots), — по жребию сида уровня и
 * номера помещения; null — у этого типа вариантов нет. Тот же уровень — тот же выбор.
 */
export function variantPicker(layout: Pick<GenLayout, 'seed'>, slots: Iterable<string | undefined>): (room: Pick<GenRoom, 'id' | 'type'>) => string | null {
  const byType = new Map<string, string[]>();
  for (const s of new Set(slots)) {
    if (!s || !SLOT_RE.test(s)) continue;
    const t = slotType(s);
    const list = byType.get(t) ?? [];
    list.push(s);
    byType.set(t, list);
  }
  for (const list of byType.values()) list.sort((a, b) => slotNumber(a) - slotNumber(b));
  return (room) => {
    const list = byType.get(room.type);
    if (!list || list.length === 0) return null;
    return list[(hash2(layout.seed, room.id, 0x5107) >>> 0) % list.length]!;
  };
}

/**
 * Вариант записи: свой (slot) или, у записей до вариантов, — первый вариант её типа помещения («kitchen.0»): так их показывает
 * конструктор (первая кухня), так их берёт и игра. Запись без варианта на несколько типов помещений или на любые — общая
 * (undefined): действует везде.
 */
export function slotFor(slot: string | undefined, rooms: readonly string[]): string | undefined {
  if (slot !== undefined) return slot;
  return rooms.length === 1 ? slotOf(rooms[0]!, 0) : undefined;
}

/** Действует ли запись варианта slot в помещении, которому выпал вариант chosen: без варианта — везде. */
export function inVariant(slot: string | undefined, chosen: string | null): boolean {
  return slot === undefined || slot === chosen;
}
