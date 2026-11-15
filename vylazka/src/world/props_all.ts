/**
 * Весь реквизит разом: убежище (PROPS), «дом каждого» (HOME_PROPS), офис (OFFICE_PROPS), готовые
 * модели (MODEL_PROPS) и выставочные экраны (SCREEN_PROPS). Витрина и обстановка берут отсюда.
 *
 * Здесь же предмет становится объектом уровня (world/objects.ts): всё, что он кладёт в сетку
 * помещения и в преграды, помечается его номером — по нему предмет можно растворить. Объектом
 * не становится то, чего не коснуться (потолочное), и то, что держит место на себе (FIXED).
 */
import { asObject } from './objects';
import { HOME_PROPS } from './props_home';
import { MODEL_PROPS } from './props_models';
import { PROPS } from './props_more';
import type { PropSpec } from './props_more';
import { OFFICE_PROPS } from './props_office';
import { SCREEN_PROPS } from './props_screens';

/**
 * Предметы, которые не растворяются: порог в проёме (через него перешагивают на каждом шагу) и двери
 * лифта (с них начинается вылазка, к ним возвращает Осыпь — это примета места, а не вещь).
 */
export const FIXED: ReadonlySet<string> = new Set(['coaming', 'elevator_doors']);

function tracked(name: string, spec: PropSpec): PropSpec {
  if (spec.mount === 'ceiling' || FIXED.has(name)) return spec;
  return { ...spec, build: (xf, seed) => asObject(xf, name, () => spec.build(xf, seed)) };
}

export const ALL_PROPS: Record<string, PropSpec> = Object.fromEntries(
  Object.entries({ ...PROPS, ...HOME_PROPS, ...OFFICE_PROPS, ...MODEL_PROPS, ...SCREEN_PROPS }).map(([name, spec]) => [name, tracked(name, spec)]),
);
