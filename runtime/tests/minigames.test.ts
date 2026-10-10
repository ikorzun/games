// @vitest-environment jsdom
/** Реестр мини-игр и grey-box реализации: контракт IMinigame, кнопки исходов, пропуск, подсказки, смена языка. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MinigameDef, MinigameResult, Value } from '../src/core/types';
import { GreyBoxMinigame, hintsFor, summarize } from '../src/minigames/grey_box';
import {
  createMinigame,
  GREY_BOX_TYPES,
  hasMinigame,
  registerBuiltinMinigames,
  registeredTypes,
  registerMinigame,
} from '../src/minigames/registry';
import type { GameContext, IMinigame } from '../src/minigames/types';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { mg, miniEpisode } from './helpers/mini';

const STRINGS: Record<string, string> = {
  'ui.minigame.success': 'Успех',
  'ui.minigame.partial': 'Частично',
  'ui.minigame.fail': 'Провал',
  'ui.minigame.skip': 'Пропустить',
  'ui.minigame.hint_ad': 'Подсказка за рекламу',
  'ui.minigame.hint': 'Подсказка',
  'mini.m1.title': 'Название игры',
  'mini.m1.brief': 'Задача игры',
  'mini.intro': 'Вступление шага',
  'mini.hint1': 'Первая подсказка',
  'mini.hint2': 'Вторая подсказка',
  'mini.st1': 'Показание один',
  'mini.st2': 'Показание два',
};

interface Harness {
  ctx: GameContext;
  dom: HTMLElement;
  results: MinigameResult[];
  tracked: Array<[string, Record<string, string | number | boolean> | undefined]>;
  autosaves: number;
  setStrings(s: Record<string, string>): void;
  fireLanguageChange(): void;
  vars: Record<string, Value>;
  listenerCount(): number;
}

function harness(def: MinigameDef, over: Partial<GameContext> = {}, strings: Record<string, string> = STRINGS): Harness {
  let current = strings;
  const listeners = new Set<() => void>();
  const h: Harness = {
    dom: document.createElement('div'),
    results: [],
    tracked: [],
    autosaves: 0,
    vars: {},
    setStrings: (s) => {
      current = s;
    },
    fireLanguageChange: () => listeners.forEach((cb) => cb()),
    listenerCount: () => listeners.size,
    ctx: undefined as unknown as GameContext,
  };
  h.ctx = {
    episode: miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }),
    def,
    lang: 'ru',
    t: (key) => current[key] ?? `[${key}]`,
    vars: () => h.vars,
    settings: { timers: true, storyOnly: false },
    introKey: null,
    track: (event, data) => {
      h.tracked.push([event, data]);
    },
    autosave: () => {
      h.autosaves += 1;
    },
    onLanguageChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ...over,
  };
  document.body.appendChild(h.dom);
  return h;
}

const mounted = (def: MinigameDef, cfg: Record<string, unknown> = {}, over: Partial<GameContext> = {}, type = def.type): { m: IMinigame; h: Harness } => {
  const hs = harness(def, over);
  const m = new GreyBoxMinigame(type);
  m.onResult = (r) => hs.results.push(r);
  m.mount(null as never, hs.dom, cfg, hs.ctx);
  return { m, h: hs };
};
const buttons = (dom: HTMLElement): string[] => [...dom.querySelectorAll('button.mg-btn')].map((b) => b.textContent ?? '');
const click = (dom: HTMLElement, cls: string): void => {
  const b = dom.querySelector<HTMLButtonElement>(`button.${cls}`);
  if (!b) throw new Error(`нет кнопки .${cls}`);
  b.click();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('реестр типов мини-игр', () => {
  beforeEach(() => registerBuiltinMinigames());
  afterEach(() => registerBuiltinMinigames());

  it('встроенные типы зарегистрированы: crime_scene_search, document_check, database_search, evidence_board, interrogation_press', () => {
    expect(registeredTypes()).toEqual([...GREY_BOX_TYPES].sort());
    for (const type of GREY_BOX_TYPES) expect(hasMinigame(type)).toBe(true);
    expect(hasMinigame('deduction_fill')).toBe(false);
  });

  it('тип без реализации получает grey-box: эпизод остаётся проходимым', () => {
    const m = createMinigame('deduction_fill');
    expect(m).toBeInstanceOf(GreyBoxMinigame);
    const hs = harness(mg('m1'));
    m.onResult = (r) => hs.results.push(r);
    m.mount(null as never, hs.dom, { anything: 1 }, hs.ctx);
    expect(hs.dom.querySelector('.mg-gb__cfg')?.textContent).toContain('config');
    click(hs.dom, 'is-success');
    expect(hs.results).toEqual(['success']);
  });

  it('registerMinigame подменяет реализацию типа; каждая мини-игра создаётся новым экземпляром', () => {
    const calls: string[] = [];
    const custom = (): IMinigame => ({
      onResult: () => undefined,
      mount: () => void calls.push('mount'),
      pause: () => undefined,
      resume: () => undefined,
      serialize: () => null,
      restore: () => undefined,
      destroy: () => void calls.push('destroy'),
    });
    registerMinigame('document_check', custom);
    const a = createMinigame('document_check');
    const b = createMinigame('document_check');
    expect(a).not.toBe(b);
    a.mount(null as never, document.createElement('div'), {}, harness(mg('m1')).ctx);
    a.destroy();
    expect(calls).toEqual(['mount', 'destroy']);
    // Другие типы подмена не затрагивает: их фабрика остаётся встроенной (grey-box или настоящая механика).
    const other = createMinigame('crime_scene_search');
    expect(typeof other.mount).toBe('function');
    expect(other).not.toBe(a);
  });
});

describe('GreyBoxMinigame: интерфейс и исходы', () => {
  it('показывает название и бриф из локали, вступление шага и пометку типа', () => {
    const { h } = mounted(mg('m1', { difficulty: 'hard' }), {}, { introKey: 'mini.intro' });
    expect(h.dom.querySelector('.mg-gb__title')?.textContent).toBe('Название игры');
    expect(h.dom.querySelector('.mg-gb__brief')?.textContent).toBe('Задача игры');
    expect(h.dom.querySelector('.mg-gb__intro')?.textContent).toBe('Вступление шага');
    expect(h.dom.querySelector('.mg-gb__tag')?.textContent).toBe('grey-box · document_check · hard');
  });

  it('кнопки Успех / Частично / Провал и Пропустить (если skip.allowed)', () => {
    const { h } = mounted(mg('m1'));
    expect(buttons(h.dom)).toEqual(['Успех', 'Частично', 'Провал', 'Пропустить']);
  });

  it('skip.allowed=false: кнопки пропуска нет', () => {
    const { h } = mounted(mg('m1', { skip: { allowed: false } }));
    expect(buttons(h.dom)).toEqual(['Успех', 'Частично', 'Провал']);
    expect(h.dom.querySelector('.is-skip')).toBeNull();
  });

  it('режим «только история»: пропуск выделен как основное действие', () => {
    const normal = mounted(mg('m1'));
    expect(normal.h.dom.querySelector('.is-skip')?.classList.contains('is-primary')).toBe(false);
    const story = mounted(mg('m1'), {}, { settings: { timers: false, storyOnly: true } });
    expect(story.h.dom.querySelector('.is-skip')?.classList.contains('is-primary')).toBe(true);
  });

  it.each([
    ['is-success', 'success'],
    ['is-partial', 'partial'],
    ['is-fail', 'fail'],
    ['is-skip', 'skipped'],
  ] as const)('кнопка .%s отдаёт результат %s ровно один раз', (cls, result) => {
    const { h } = mounted(mg('m1'));
    click(h.dom, cls);
    click(h.dom, cls);
    click(h.dom, 'is-fail');
    expect(h.results).toEqual([result]);
  });

  it('пока мини-игра на паузе (реклама, вкладка в фоне), нажатия не засчитываются; после resume — работают', () => {
    const { m, h } = mounted(mg('m1'));
    m.pause();
    expect(h.dom.querySelector('.mg-gb')?.classList.contains('is-paused')).toBe(true);
    click(h.dom, 'is-success');
    expect(h.results).toEqual([]);
    m.resume();
    expect(h.dom.querySelector('.mg-gb')?.classList.contains('is-paused')).toBe(false);
    click(h.dom, 'is-success');
    expect(h.results).toEqual(['success']);
  });

  it('destroy убирает разметку и отписывается от смены языка', () => {
    const { m, h } = mounted(mg('m1'));
    expect(h.listenerCount()).toBe(1);
    m.destroy();
    expect(h.dom.querySelector('.mg-gb')).toBeNull();
    expect(h.listenerCount()).toBe(0);
    m.destroy(); // повторный вызов безопасен
  });

  it('смена языка перерисовывает подписи на лету, не теряя прогресс', () => {
    const { h } = mounted(mg('m1'));
    expect(buttons(h.dom)[0]).toBe('Успех');
    h.setStrings({ ...STRINGS, 'ui.minigame.success': 'Success', 'mini.m1.title': 'Game title' });
    h.fireLanguageChange();
    expect(buttons(h.dom)[0]).toBe('Success');
    expect(h.dom.querySelector('.mg-gb__title')?.textContent).toBe('Game title');
  });
});

describe('GreyBoxMinigame: подсказки за rewarded-рекламу и автосейв внутри мини-игры', () => {
  const cfg = {
    discrepancies: [{ hint_key: 'mini.hint1' }, { hint_key: 'mini.hint2' }],
    documents: ['doc_a'],
    required: 2,
    max_mistakes: 3,
  };
  const withAd = mg('m1', { skip: { allowed: true, hint_rewarded_ad: true } });

  it('кнопка подсказки есть только при hint_rewarded_ad, поддержке платформой и наличии подсказок в данных', () => {
    const rewarded = (): Promise<boolean> => Promise.resolve(true);
    expect(buttons(mounted(withAd, cfg, { showRewarded: rewarded }).h.dom)).toContain('Подсказка за рекламу');
    expect(buttons(mounted(withAd, cfg).h.dom)).not.toContain('Подсказка за рекламу'); // платформа без rewarded
    expect(buttons(mounted(mg('m1'), cfg, { showRewarded: rewarded }).h.dom)).not.toContain('Подсказка за рекламу'); // флаг не выставлен
    expect(buttons(mounted(withAd, { documents: [] }, { showRewarded: rewarded }).h.dom)).not.toContain('Подсказка за рекламу'); // подсказок нет
  });

  it('просмотренная реклама открывает подсказки по одной и просит автосейв; после последней кнопка исчезает', async () => {
    const showRewarded = vi.fn(() => Promise.resolve(true));
    const { m, h } = mounted(withAd, cfg, { showRewarded });
    click(h.dom, 'is-hint');
    await vi.waitFor(() => expect(h.dom.querySelectorAll('.mg-gb__hints li')).toHaveLength(1));
    expect(h.dom.querySelector('.mg-gb__hints li')?.textContent).toBe('Подсказка: Первая подсказка');
    expect(h.autosaves).toBe(1);
    expect(h.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]);
    expect(m.serialize()).toEqual({ hintsShown: 1 });

    click(h.dom, 'is-hint');
    await vi.waitFor(() => expect(h.dom.querySelectorAll('.mg-gb__hints li')).toHaveLength(2));
    expect(h.dom.querySelector('.is-hint')).toBeNull();
    expect(showRewarded).toHaveBeenCalledTimes(2);
  });

  it('реклама не показана или закрыта досрочно: подсказки нет, автосейва нет, событие в телеметрии есть', async () => {
    const { h } = mounted(withAd, cfg, { showRewarded: () => Promise.resolve(false) });
    click(h.dom, 'is-hint');
    await vi.waitFor(() => expect(h.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(h.dom.querySelectorAll('.mg-gb__hints li')).toHaveLength(0);
    expect(h.autosaves).toBe(0);
  });

  it('пока реклама идёт, кнопка подсказки недоступна — двойной тап не запускает вторую рекламу', async () => {
    let resolveAd: (ok: boolean) => void = () => undefined;
    const showRewarded = vi.fn(() => new Promise<boolean>((r) => (resolveAd = r)));
    const { h } = mounted(withAd, cfg, { showRewarded });
    click(h.dom, 'is-hint');
    expect(h.dom.querySelector<HTMLButtonElement>('.is-hint')?.disabled).toBe(true);
    h.dom.querySelector<HTMLButtonElement>('.is-hint')?.click();
    expect(showRewarded).toHaveBeenCalledTimes(1);
    resolveAd(true);
    await vi.waitFor(() => expect(h.dom.querySelector<HTMLButtonElement>('.is-hint')?.disabled).toBe(false));
  });

  it('serialize / restore: открытые подсказки возвращаются после загрузки; мусор в состоянии игнорируется', () => {
    const { m, h } = mounted(withAd, cfg, { showRewarded: () => Promise.resolve(true) });
    m.restore({ hintsShown: 2 });
    expect(h.dom.querySelectorAll('.mg-gb__hints li')).toHaveLength(2);
    expect(m.serialize()).toEqual({ hintsShown: 2 });
    m.restore('мусор');
    m.restore({ hintsShown: -5 });
    m.restore(null);
    expect(m.serialize()).toEqual({ hintsShown: 2 });
    m.restore({ hintsShown: 1.7 });
    expect(m.serialize()).toEqual({ hintsShown: 1 });
  });
});

describe('summarize / hintsFor: краткое описание конфигов по типам', () => {
  const ctx = (vars: Record<string, Value> = {}): GameContext => {
    const h = harness(mg('m1'), {}, STRINGS);
    h.vars = vars;
    return h.ctx;
  };
  const row = (rows: Array<[string, string]>, label: string): string | undefined => rows.find(([k]) => k === label)?.[1];

  it('crime_scene_search: число зон, обязательные, подписи из локали', () => {
    const rows = summarize('crime_scene_search', { hotspots: [{ id: 'a', required: true, label_key: 'mini.hint1' }, { id: 'b' }], max_misses: 4 }, ctx());
    expect(row(rows, 'hotspots')).toBe('2 (required 1)');
    expect(row(rows, 'labels')).toBe('Первая подсказка · b');
    expect(row(rows, 'max_misses')).toBe('4');
  });

  it('document_check, database_search, evidence_board', () => {
    const dc = summarize('document_check', { documents: ['a', 'b'], discrepancies: [1, 2, 3], required: 2, max_mistakes: 3 }, ctx());
    expect(row(dc, 'documents')).toBe('a, b');
    expect(row(dc, 'discrepancies')).toBe('3');
    expect(row(dc, 'required / decoys / max_mistakes')).toBe('2 / 0 / 3');

    const db = summarize('database_search', { fields: ['f1', 'f2'], records: 40, pattern: { f1: 'x', f2: 7 }, target_count: 3 }, ctx());
    expect(row(db, 'fields')).toBe('f1, f2');
    expect(row(db, 'pattern')).toBe('f1=x, f2=7');
    expect(row(db, 'target_count / min_for_partial')).toBe('3 / —');

    const eb = summarize('evidence_board', { nodes: [1, 2, 3], required_links: [1, 2], decoy_links: [1], max_wrong_links: 2 }, ctx());
    expect(row(eb, 'nodes')).toBe('3');
    expect(row(eb, 'required_links / decoy_links')).toBe('2 / 1');
  });

  it('interrogation_press: показания с requires помечаются по текущим переменным (✔ / ✘)', () => {
    const cfg = {
      statements: [{ id: 'st1', text_key: 'mini.st1' }, { id: 'st2', text_key: 'mini.st2', requires: 'has_doc' }],
      full_threshold: 2,
      partial_threshold: 1,
      max_mistakes: 3,
    };
    const without = summarize('interrogation_press', cfg, ctx({ has_doc: false }));
    expect(without.map(([k]) => k).slice(0, 2)).toEqual(['✔ st1', '✘ st2 (requires has_doc)']);
    const withDoc = summarize('interrogation_press', cfg, ctx({ has_doc: true }));
    expect(withDoc[1]?.[0]).toBe('✔ st2 (requires has_doc)');
    expect(withDoc[1]?.[1]).toBe('Показание два');
  });

  it('пустой или неполный конфиг не роняет отрисовку', () => {
    for (const type of [...GREY_BOX_TYPES, 'custom']) {
      expect(() => summarize(type, {}, ctx())).not.toThrow();
      expect(() => hintsFor(type, {}, ctx())).not.toThrow();
    }
  });
});

describe.skipIf(!hasRepoContent())('grey-box на настоящих мини-играх ep01', () => {
  const episode = loadEpisode(EP01_PATH);
  const defs = Object.values(episode.minigames ?? {});

  it('в эпизоде есть мини-игры всех пяти встроенных типов', () => {
    expect(new Set(defs.map((d) => d.type))).toEqual(new Set(GREY_BOX_TYPES));
  });

  // Grey-box проверяется напрямую: встроенные типы постепенно получают настоящие механики
  // (свои тесты — tests/minigames.<тип>.test.ts), а grey-box остаётся запасной реализацией.
  it.each(defs.map((d) => [d.id, d] as const))('%s: grey-box рисуется, кнопки исходов соответствуют outcomes и skip.allowed', (_id, def) => {
    const hs = harness(def, { episode, showRewarded: () => Promise.resolve(true) }, {});
    const m = new GreyBoxMinigame(def.type);
    m.onResult = (r) => hs.results.push(r);
    m.mount(null as never, hs.dom, def.config, hs.ctx);
    // Без локалей строки — видимые заглушки [key], но разметка и конфиг рисуются.
    expect(hs.dom.querySelector('.mg-gb__title')?.textContent).toBe(`[${def.title_key}]`);
    expect(hs.dom.querySelectorAll('.mg-gb__cfg dt').length).toBeGreaterThan(0);
    expect(hs.dom.querySelectorAll('.mg-btn.is-success, .mg-btn.is-partial, .mg-btn.is-fail')).toHaveLength(3);
    expect(hs.dom.querySelector('.is-skip') !== null).toBe(def.skip.allowed);
    click(hs.dom, 'is-partial');
    expect(hs.results).toEqual(['partial']);
    m.destroy();
  });
});
