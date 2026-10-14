/**
 * Стенд для тестов настоящих мини-игр (crime_scene_search, document_check, database_search):
 * поддельный GameContext (локализация с подстановками, автосейв, телеметрия, смена языка)
 * и несколько помощников для jsdom, где нет раскладки.
 */
import { interpolate } from '../../src/core/i18n';
import type { Episode, MinigameDef, MinigameResult, Value } from '../../src/core/types';
import type { GameContext, IMinigame, MinigameConfig } from '../../src/minigames/types';
import { mg, miniEpisode } from './mini';

/** Строки интерфейса, которые используют все три игры (ru — как в locales/ru/ui.json). */
export const UI: Record<string, string> = {
  'ui.minigame.skip': 'Пропустить',
  'ui.minigame.hint': 'Подсказка',
  'ui.minigame.hint_ad': 'Подсказка за рекламу',
  'ui.minigame.success': 'Успех',
  'ui.minigame.partial': 'Частично',
  'ui.minigame.fail': 'Неудача',
  'ui.minigame.found': 'Найдено: {n} из {total}',
  'ui.minigame.misses': 'Промахи: {n} из {max}',
  'ui.minigame.mistakes': 'Ошибки: {n} из {max}',
  'ui.minigame.time_left': 'Осталось: {time}',
  'ui.minigame.time_up': 'Время вышло',
  'ui.minigame.nothing_here': 'Здесь ничего',
  'ui.minigame.scene_help.body': 'Нажмите на подозрительное место.',
  'ui.minigame.consistent': 'Здесь всё сходится',
  'ui.minigame.doc_n': 'Документ {n}',
  'ui.minigame.check': 'Проверить',
  'ui.minigame.all': 'Все',
  'ui.minigame.shown': 'Показано: {n} из {total}',
  'ui.minigame.selected': 'Отмечено: {n}',
  'ui.minigame.no_cards': 'Таких карточек нет',
  'ui.minigame.match': 'Подходит',
  'ui.minigame.no_match': 'Не подходит',
  'ui.common.next': 'Далее',
  'ui.minigame.start_search': 'Начать осмотр',
  'ui.minigame.move': 'Переместить',
  'ui.minigame.find_item': 'Ещё не найдено',
  'ui.minigame.finish_search': 'Закончить осмотр',
  'ui.minigame.body_attempts_one': 'У вас всего {n} попытка подметить детали.',
  'ui.minigame.body_attempts_few': 'У вас всего {n} попытки подметить детали.',
  'ui.minigame.body_attempts_many': 'У вас всего {n} попыток подметить детали.',
  'ui.minigame.body_attempts_other': 'У вас всего {n} попытки подметить детали.',
};

export interface Rig {
  ctx: GameContext;
  dom: HTMLElement;
  results: MinigameResult[];
  tracked: Array<[string, Record<string, string | number | boolean> | undefined]>;
  autosaves: number;
  strings: Record<string, string>;
  setStrings(s: Record<string, string>): void;
  fireLanguageChange(): void;
  listenerCount(): number;
  vars: Record<string, Value>;
}

export interface RigOptions {
  episode?: Episode;
  ctx?: Partial<GameContext>;
  strings?: Record<string, string>;
}

/** Поддельный контекст игры + контейнер в document.body. */
export function rig(def: MinigameDef, opts: RigOptions = {}): Rig {
  let current: Record<string, string> = { ...UI, ...(opts.strings ?? {}) };
  const listeners = new Set<() => void>();
  const r: Rig = {
    dom: document.createElement('div'),
    results: [],
    tracked: [],
    autosaves: 0,
    vars: {},
    strings: current,
    setStrings: (s) => {
      current = s;
      r.strings = s;
    },
    fireLanguageChange: () => listeners.forEach((cb) => cb()),
    listenerCount: () => listeners.size,
    ctx: undefined as unknown as GameContext,
  };
  r.ctx = {
    episode: opts.episode ?? miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }),
    def,
    lang: 'ru',
    t: (key, params) => (key in current ? interpolate(current[key] ?? '', params) : `[${key}]`),
    vars: () => r.vars,
    settings: { timers: true, storyOnly: false },
    introKey: null,
    track: (event, data) => {
      r.tracked.push([event, data]);
    },
    autosave: () => {
      r.autosaves += 1;
    },
    onLanguageChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ...(opts.ctx ?? {}),
  };
  document.body.appendChild(r.dom);
  return r;
}

/** Определение мини-игры для тестов: тип, config и необязательные поля def. */
export function defOf(type: string, config: MinigameConfig, over: Partial<MinigameDef> = {}): MinigameDef {
  return mg('m1', { type, config, ...over });
}

/** Смонтировать игру в стенде. */
export function mountGame<T extends IMinigame>(game: T, r: Rig, cfg: MinigameConfig): T {
  game.onResult = (res) => r.results.push(res);
  game.mount(null as never, r.dom, cfg, r.ctx);
  return game;
}

/** jsdom не считает раскладку: подставить элементу размеры (getBoundingClientRect). */
export function sizeOf(el: Element, width: number, height: number, left = 0, top = 0): void {
  el.getBoundingClientRect = () =>
    ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;
}

export function click(el: Element | null, init: MouseEventInit = {}): void {
  if (!el) throw new Error('click: элемента нет');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

export function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

export const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`нет элемента ${sel}`);
  return el;
};

export const texts = (root: ParentNode, sel: string): string[] => [...root.querySelectorAll(sel)].map((e) => e.textContent ?? '');

/** Видимые кнопки действий оболочки (skip / hint / next) по классу. */
export const btn = (root: ParentNode, cls: string): HTMLButtonElement | null => {
  const b = root.querySelector<HTMLButtonElement>(`button.${cls}`);
  return b && !b.hidden ? b : null;
};
