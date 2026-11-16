/**
 * Весь реквизит разом: убежище (PROPS), «дом каждого» (HOME_PROPS), офис (OFFICE_PROPS), готовые
 * модели (MODEL_PROPS), выставочные экраны (SCREEN_PROPS), поделки (CRAFT_PROPS), вокзал (STATION_PROPS), стена чемоданов
 * (LUGGAGE_PROPS) и бумага — листы на щитах, в рамах и на потолке (PAPER_PROPS). Витрина и обстановка берут отсюда.
 *
 * Здесь же предмет становится объектом уровня (world/objects.ts): всё, что он кладёт в сетку
 * помещения и в преграды, помечается его номером — по нему предмет можно растворить. Объектом
 * не становится то, чего не коснуться (потолочное), и то, что держит место на себе (FIXED).
 */
import { asObject } from './objects';
import { BIRD_PROPS, CRAFT_PROPS } from './props_craft';
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

function tracked(name: string, spec: PropSpec): PropSpec {
  if (spec.mount === 'ceiling' || FIXED.has(name)) return spec;
  return { ...spec, build: (xf, seed) => asObject(xf, name, () => spec.build(xf, seed)) };
}

export const ALL_PROPS: Record<string, PropSpec> = Object.fromEntries(
  Object.entries({ ...PROPS, ...HOME_PROPS, ...OFFICE_PROPS, ...MODEL_PROPS, ...SCREEN_PROPS, ...CRAFT_PROPS, ...BIRD_PROPS, ...STATION_PROPS, ...LUGGAGE_PROPS, ...PAPER_PROPS }).map(([name, spec]) => [name, tracked(name, spec)]),
);
