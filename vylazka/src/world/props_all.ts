/**
 * Весь реквизит разом: убежище (PROPS), «дом каждого» (HOME_PROPS), офис (OFFICE_PROPS), готовые
 * модели (MODEL_PROPS), выставочные экраны (SCREEN_PROPS), поделки (CRAFT_PROPS), вокзал (STATION_PROPS), стена чемоданов
 * (LUGGAGE_PROPS), бумага — листы на щитах, в рамах и на потолке (PAPER_PROPS), находки из снимков партнёра (FOUND_PROPS). Витрина и обстановка берут отсюда.
 *
 * Здесь же предмет становится объектом уровня (world/objects.ts): всё, что он кладёт в сетку
 * помещения и в преграды, помечается его номером — по нему предмет можно растворить. Объектом
 * не становится то, чего не коснуться (потолочное), и то, что держит место на себе (FIXED).
 */
import { hash2 } from '../core/rng';
import { asObject, withFlatHook } from './objects';
import type { Xf } from './props';
import { BIRD_PROPS, CRAFT_PROPS } from './props_craft';
import { SEATING_PROPS } from './props_seating';
import { REAL_PROPS } from './props_real';
import { PEOPLE_PROPS } from './props_people';
import { FOUND_PROPS } from './props_found';
import { HOME_PROPS } from './props_home';
import { LUGGAGE_PROPS } from './props_luggage';
import { MODEL_PROPS } from './props_models';
import { PROPS } from './props_more';
import type { PropSpec } from './props_more';
import { OFFICE_PROPS } from './props_office';
import { PAPER_PROPS } from './props_papers';
import { SCREEN_PROPS } from './props_screens';
import { STATION_PROPS } from './props_station';

/**
 * Предметы, которые не растворяются: порог в проёме (через него перешагивают на каждом шагу), двери
 * лифта (с них начинается вылазка, к ним возвращает Осыпь — это примета места, а не вещь) и гора
 * (слова партнёра: «похороненное, что уже не восстановить» — она здесь единственное окончательное);
 * колонна вокзала (несущая — стоит, пока стоит зал).
 */
export const FIXED: ReadonlySet<string> = new Set(['coaming', 'elevator_doors', 'mound_small', 'mound', 'mound_big', 'st_column']);

/**
 * Записи партнёра о вещах игры (world/placed.ts): замена (квиз 17.11, вечер: «Заменять» — «в этой кухне вместо дивана игры —
 * мой»), убранная и передвинутая (17.11, 19:15: «текущую расстановку мебели я тоже должен уметь двигать и удалять»).
 * Пока собирается уровень, сборка может поставить хук (world/level_build.ts): для каждой вещи обстановки он отвечает, что
 * строить на её месте. null — её саму; другое имя — ту, другую, в той же точке и так же повёрнутую (объект уровня получает её
 * имя; разные опоры — у стены спина в z = 0, посреди пола середина в начале — выравниваются сдвигом на полглубины); пустая
 * строка '' — ничего (убрана или передвинута: передвинутую сборка поставит сама, позже).
 *
 * Хук видит только вещи, которые становятся объектами уровня сами по себе (журнал не занят, world/objects.ts): не часть
 * другой вещи и не сборку в стороне — снимок для картонки, проекцию (world/flat.ts). Картонки он видит через хук журнала
 * (flat = true): у них нет своего сида, он выводится из точки.
 */
export type PropSwap = (name: string, xf: Xf, seed: number, flat?: boolean) => string | null;
let swap: PropSwap | null = null;

/** Сид для картонки, которую сборка поставит настоящей вещью (передвинутая): из точки, где она стояла бы. */
const flatSeed = (xf: Xf): number => hash2(Math.round(xf.ox * 100), Math.round(xf.oz * 100), 0x5ad1 + Math.round(xf.oy * 10)) % 1000003;

/** Выполнить body с хуком сборки (на время сборки уровня; null — без него). */
export function withSwap<T>(fn: PropSwap | null, body: () => T): T {
  const prev = swap;
  swap = fn;
  try {
    // Картонки собираются в обход реестра (world/furnish.ts) — хук журнала отдаёт их тому же хуку: убрана или передвинута — не строить.
    return withFlatHook(fn ? (name, xf) => fn(name, xf, flatSeed(xf), true) === '' : null, body);
  } finally {
    swap = prev;
  }
}

/** Точка сборки заменяющей вещи: у разных опор начало координат в разном месте. */
function swapXf(xf: Xf, from: PropSpec, to: PropSpec): Xf {
  if (from.mount === to.mount) return xf;
  if (from.mount === 'floor' && to.mount === 'free') return xf.child(0, 0, to.d / 2);
  if (from.mount === 'free' && to.mount === 'floor') return xf.child(0, 0, -from.d / 2);
  return xf;
}

function tracked(name: string, spec: PropSpec): PropSpec {
  if (spec.mount === 'ceiling' || FIXED.has(name)) return spec;
  return {
    ...spec,
    build: (xf, seed) => {
      const sub = swap && xf.mb.log?.takes ? swap(name, xf, seed) : null;
      if (sub === '') return;
      const other = sub && sub !== name ? RAW[sub] : undefined;
      if (other) {
        const at = swapXf(xf, spec, other);
        asObject(at, sub!, () => other.build(at, seed));
        return;
      }
      asObject(xf, name, () => spec.build(xf, seed));
    },
  };
}

/**
 * Наборы реквизита по отдельности. Имя предмета должно быть единственным во всех наборах: при сборке
 * ALL_PROPS поздний набор молча перекрыл бы ранний (так новый торшер однажды заменил домашний везде).
 */
export const PROP_SETS: Readonly<Record<string, Record<string, PropSpec>>> = {
  PROPS, HOME_PROPS, OFFICE_PROPS, MODEL_PROPS, SCREEN_PROPS, CRAFT_PROPS, BIRD_PROPS, STATION_PROPS,
  LUGGAGE_PROPS, PAPER_PROPS, FOUND_PROPS, SEATING_PROPS, REAL_PROPS, PEOPLE_PROPS,
};

/** Реквизит без обёртки объекта — для замены (обёртку даёт tracked той вещи, что заменяется). */
const RAW: Record<string, PropSpec> = Object.fromEntries(Object.values(PROP_SETS).flatMap((set) => Object.entries(set)));

export const ALL_PROPS: Record<string, PropSpec> = Object.fromEntries(
  Object.values(PROP_SETS).flatMap((set) => Object.entries(set)).map(([name, spec]) => [name, tracked(name, spec)]),
);
