/**
 * Весь реквизит разом: убежище (PROPS), «дом каждого» (HOME_PROPS), офис (OFFICE_PROPS), готовые
 * модели (MODEL_PROPS), выставочные экраны (SCREEN_PROPS), поделки (CRAFT_PROPS), вокзал (STATION_PROPS), стена чемоданов
 * (LUGGAGE_PROPS), бумага — листы на щитах, в рамах и на потолке (PAPER_PROPS), находки из снимков партнёра (FOUND_PROPS), мебель
 * полки Sand3D под своими именами s3_* (SAND3D_PROPS: их ставит партнёр конструктором, а комнаты убежища — сама обстановка,
 * world/furnish.ts). Мебель остальных мест с 18.11 тоже из полки, но под прежними именами (world/furniture.ts). Витрина и
 * обстановка берут отсюда.
 *
 * Здесь же предмет становится объектом уровня (world/objects.ts): всё, что он кладёт в сетку
 * помещения и в преграды, помечается его номером — по нему предмет можно растворить. Объектом
 * не становится то, чего не коснуться (потолочное), и то, что держит место на себе (FIXED).
 */
import { hash2 } from '../core/rng';
import { withOpenMode } from './furniture';
import { asObject, markBuild, rewindBuild, withFlatHook } from './objects';
import type { PlacedOpen } from './placed';
import { applyTilt, tiltMark } from './tilt';
import type { Tilt } from './tilt';
import type { Xf } from './props';
import { BIRD_PROPS, CRAFT_PROPS } from './props_craft';
import { SEATING_PROPS } from './props_seating';
import { REAL_PROPS } from './props_real';
import { SAND3D_PROPS } from './props_sand3d';
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
 *
 * Замена с дверцами по записи (placed.ts, PlacedSpec.open) отвечает SwapTo: какую вещь и закрыто или открыто у неё всё.
 */
export type PropSwap = ((name: string, xf: Xf, seed: number, flat?: boolean) => string | SwapTo | null) & {
  /**
   * Состояние хука (счёт вещей по помещениям, израсходованные замены, передвинутые): раскладка пробует место стопки у стены
   * и откатывает пробу (world/furnish.ts, homeStack) — вместе с ней откатывается и счёт, иначе номера вещей съедут.
   */
  save?: () => unknown;
  load?: (state: unknown) => void;
};

/** Вещь на месте вещи игры с дверцами по записи партнёра: 'shut' — всё закрыто, 'open' — всё открыто. */
export interface SwapTo {
  prop: string;
  open?: PlacedOpen;
  /** Доворот по всем осям (world/tilt.ts): замена, повёрнутая партнёром. */
  tilt?: Tilt;
  /** Висит выше места вещи игры на столько, м: замена с отметкой «висит» (placed.ts, PlacedSpec.hang; противоречие 281). */
  lift?: number;
}
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

/** Состояние хука сборки (PropSwap.save); undefined — хука нет. */
export const swapState = (): unknown => swap?.save?.();

/** Вернуть хук к состоянию state (откат пробы раскладки). */
export function restoreSwap(state: unknown): void {
  if (state !== undefined) swap?.load?.(state);
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
      const own = (): boolean => asObject(xf, name, () => spec.build(xf, seed));
      // Без записей партнёра (хука нет) или внутри другой вещи — как есть: проверка «не врастать» — в asObject.
      if (!swap || !xf.mb.log?.takes) return own();
      // Вещь игры сначала встаёт сама, с проверкой «не врастать» (world/clearance.ts): номер в помещении хук считает только
      // вставшим — так же считает и конструктор, у которого записей нет (world/placed_place.ts, gameNth).
      const mark = markBuild(xf)!;
      if (!own()) return false;
      const got = swap(name, xf, seed);
      if (got === null) return true;
      // Убрана, передвинута или заменена: здесь её нет, но для остальной обстановки она стоит — тенью, как в конструкторе.
      const col = xf.col;
      const boxes = col ? col.boxes.slice(mark.col).map((b) => ({ ...b })) : [];
      rewindBuild(xf, mark);
      if (col) for (const box of boxes) col.shadows.push({ box, name });
      if (got === '') return;
      const sub = typeof got === 'string' ? got : got.prop;
      // Дверцы по записи; нет записи — как выпадет: доля открытого у помещения, которое обставляется (furnish.ts).
      const mode = typeof got === 'object' ? got.open : undefined;
      // Доворот по всем осям (world/tilt.ts): собранную замену сборка поворачивает вокруг её середины.
      const tilt = typeof got === 'object' ? got.tilt : undefined;
      const lift = typeof got === 'object' ? (got.lift ?? 0) : 0;
      const other = sub !== name ? RAW[sub] : undefined;
      // Замену выбрал партнёр (её место — место вещи игры): проверку «не врастать» она не проходит, и её преграды проверка не
      // видит — остальная обстановка встаёт, как при вещи игры. Висящая — над этим местом, на lift.
      const put = (base: Xf, n: string, sp: PropSpec): boolean => {
        const at = lift > 0 ? base.child(0, lift, 0) : base;
        const mk = tiltMark(at);
        const ok = asObject(at, n, () => withOpenMode(mode, () => sp.build(at, seed)), false, false, true);
        if (ok && tilt) applyTilt(at, mk, tilt, sp.mount);
        return ok;
      };
      if (other) return put(swapXf(xf, spec, other), sub, other);
      return put(xf, name, spec);
    },
  };
}

/**
 * Наборы реквизита по отдельности. Имя предмета должно быть единственным во всех наборах: при сборке
 * ALL_PROPS поздний набор молча перекрыл бы ранний (так новый торшер однажды заменил домашний везде).
 */
export const PROP_SETS: Readonly<Record<string, Record<string, PropSpec>>> = {
  PROPS, HOME_PROPS, OFFICE_PROPS, MODEL_PROPS, SCREEN_PROPS, CRAFT_PROPS, BIRD_PROPS, STATION_PROPS,
  LUGGAGE_PROPS, PAPER_PROPS, FOUND_PROPS, SEATING_PROPS, REAL_PROPS, PEOPLE_PROPS, SAND3D_PROPS,
};

/** Реквизит без обёртки объекта — для замены (обёртку даёт tracked той вещи, что заменяется). */
const RAW: Record<string, PropSpec> = Object.fromEntries(Object.values(PROP_SETS).flatMap((set) => Object.entries(set)));

export const ALL_PROPS: Record<string, PropSpec> = Object.fromEntries(
  Object.values(PROP_SETS).flatMap((set) => Object.entries(set)).map(([name, spec]) => [name, tracked(name, spec)]),
);
