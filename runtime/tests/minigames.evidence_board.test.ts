// @vitest-environment jsdom
/**
 * Доска улик (evidence_board): разбор конфига, раскладка и геометрия ниток, ход партии (верная и лишняя
 * связь, удаление), исходы по порогам, пропуск и подсказка, таймер, пауза, serialize/restore,
 * смена языка, единственный onResult; плюс проверка на настоящем конфиге ep01 (mg_board) и локалях.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpolate } from '../src/core/i18n';
import type { MinigameDef, MinigameResult, Value } from '../src/core/types';
import {
  boardOutcome,
  createEvidenceBoard,
  edgePoint,
  layoutCells,
  pairKey,
  parseBoard,
  placeBadges,
  splitKey,
  threadPath,
  ZOOMS,
} from '../src/minigames/evidence_board';
import { Countdown, formatTime } from '../src/minigames/mg_timer';
import type { GameContext, IMinigame } from '../src/minigames/types';
import { EP01_PATH, hasRepoContent, loadEpisode, loadLocale, loadStrings } from './helpers/content';
import { LANGS } from '../src/core/types';
import { mg, miniEpisode } from './helpers/mini';

// ───────────────────────────── стенд ─────────────────────────────

const REAL_UI = loadStrings('ru', 'ep01_murylev');
const STRINGS: Record<string, string> = {
  ...REAL_UI,
  'mini.m1.title': 'Доска',
  'mini.m1.brief': 'Соедините узлы.',
  'mini.intro': 'Свяжите квартиры с людьми.',
  'n.a': 'Квартира А',
  'n.b': 'Квартира Б',
  'n.c': 'Нотариус',
  'n.d': 'Доверенный',
  'n.e': 'Машина',
};

const CFG = {
  nodes: [
    { id: 'a', label_key: 'n.a', kind: 'flat' },
    { id: 'b', label_key: 'n.b', kind: 'flat' },
    { id: 'c', label_key: 'n.c', kind: 'person' },
    { id: 'd', label_key: 'n.d', kind: 'person' },
    { id: 'e', label_key: 'n.e', kind: 'property' },
  ],
  required_links: [
    ['a', 'c'],
    ['b', 'c'],
    ['c', 'd'],
  ],
  decoy_links: [['d', 'e']],
  max_wrong_links: 2,
  partial_threshold: 2,
};

interface Harness {
  ctx: GameContext;
  dom: HTMLElement;
  results: MinigameResult[];
  tracked: Array<[string, Record<string, string | number | boolean> | undefined]>;
  autosaves: number;
  setStrings(s: Record<string, string>): void;
  fireLanguageChange(): void;
  listenerCount(): number;
}

function harness(def: MinigameDef, over: Partial<GameContext> = {}, vars: Record<string, Value> = {}): Harness {
  let current = STRINGS;
  const listeners = new Set<() => void>();
  const hs: Harness = {
    dom: document.createElement('div'),
    results: [],
    tracked: [],
    autosaves: 0,
    setStrings: (s) => {
      current = s;
    },
    fireLanguageChange: () => listeners.forEach((cb) => cb()),
    listenerCount: () => listeners.size,
    ctx: undefined as unknown as GameContext,
  };
  hs.ctx = {
    episode: miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }),
    def,
    lang: 'ru',
    t: (key, params) => interpolate(current[key] || `[${key}]`, params),
    vars: () => vars,
    settings: { timers: true, storyOnly: false },
    introKey: null,
    track: (event, data) => {
      hs.tracked.push([event, data]);
    },
    autosave: () => {
      hs.autosaves += 1;
    },
    onLanguageChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ...over,
  };
  document.body.appendChild(hs.dom);
  return hs;
}

const defOf = (over: Partial<MinigameDef> = {}): MinigameDef => mg('m1', { type: 'evidence_board', ...over });

function setup(
  cfg: Record<string, unknown> = CFG,
  def: Partial<MinigameDef> = {},
  ctxOver: Partial<GameContext> = {},
): { m: IMinigame; hs: Harness; dom: HTMLElement } {
  const hs = harness(defOf(def), ctxOver);
  const m = createEvidenceBoard();
  m.onResult = (r) => hs.results.push(r);
  m.mount(null as never, hs.dom, cfg, hs.ctx);
  return { m, hs, dom: hs.dom };
}

const node = (dom: HTMLElement, id: string): HTMLButtonElement => {
  const el = dom.querySelector<HTMLButtonElement>(`button[data-node="${id}"]`);
  if (!el) throw new Error(`нет узла ${id}`);
  return el;
};
const tap = (dom: HTMLElement, id: string): void => node(dom, id).click();
const link = (dom: HTMLElement, a: string, b: string): void => {
  tap(dom, a);
  tap(dom, b);
};
const threads = (dom: HTMLElement): SVGGElement[] => [...dom.querySelectorAll<SVGGElement>('g.mg-eb__thread')];
const threadOf = (dom: HTMLElement, key: string): SVGGElement | undefined => threads(dom).find((g) => g.getAttribute('data-link') === key);
const badge = (dom: HTMLElement, key: string): HTMLButtonElement | null => dom.querySelector<HTMLButtonElement>(`button.mg-eb__badge[data-link="${key}"]`);
const text = (dom: HTMLElement, sel: string): string => dom.querySelector(sel)?.textContent ?? '';
const used = (dom: HTMLElement): number => dom.querySelectorAll('.mg-eb__dot.is-used').length;
const buttons = (dom: HTMLElement): string[] => [...dom.querySelectorAll('.mg-eb__actions button.mg-btn')].map((b) => b.textContent ?? '');
const done = (dom: HTMLElement): void => {
  const b = dom.querySelector<HTMLButtonElement>('.mg-eb__result button[data-focus="done"]');
  if (!b) throw new Error('нет кнопки «Далее»');
  b.click();
};
const panelShown = (dom: HTMLElement): boolean => dom.querySelector<HTMLElement>('.mg-eb__result')?.hidden === false;
const noMissingKeys = (dom: HTMLElement): void => {
  expect(dom.textContent ?? '').not.toMatch(/\[ui\.|\[ep01\.|\[mini\./);
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

// ───────────────────────────── чистая логика ─────────────────────────────

describe('parseBoard: чтение конфига', () => {
  it('узлы строками и объектами, kind проверяется, дубли и пустые id отбрасываются', () => {
    const spec = parseBoard({
      nodes: ['x', { id: 'y', label_key: 'k.y', kind: 'person' }, { id: 'z', kind: 'bogus' }, 'x', '', { label_key: 'k' }, 'a|b'],
      required_links: [],
      max_wrong_links: 1,
    });
    expect(spec.nodes).toEqual([
      { id: 'x', labelKey: null, kind: null },
      { id: 'y', labelKey: 'k.y', kind: 'person' },
      { id: 'z', labelKey: null, kind: null },
    ]);
  });

  it('связи нормализуются в неориентированные пары; неизвестные узлы, петли и дубли отбрасываются; приманка не бывает верной', () => {
    const spec = parseBoard({
      nodes: ['a', 'b', 'c'],
      required_links: [['b', 'a'], ['a', 'b'], ['a', 'a'], ['a', 'zzz'], ['c']],
      decoy_links: [['a', 'b'], ['c', 'a']],
      max_wrong_links: 2,
    });
    expect(spec.required).toEqual(['a|b']);
    expect([...spec.decoys]).toEqual(['a|c']);
  });

  it('значения по умолчанию: max_wrong_links = 3, partial_threshold = 1; порог зажимается в 1…число верных связей', () => {
    const base = { nodes: ['a', 'b', 'c'], required_links: [['a', 'b'], ['b', 'c']] };
    expect(parseBoard(base)).toMatchObject({ maxWrong: 3, partialAt: 1 });
    expect(parseBoard({ ...base, partial_threshold: 9 }).partialAt).toBe(2);
    expect(parseBoard({ ...base, partial_threshold: 0 }).partialAt).toBe(1);
    expect(parseBoard({ ...base, max_wrong_links: -4 }).maxWrong).toBe(0);
  });

  it('пустой и мусорный конфиг не бросает', () => {
    for (const cfg of [{}, { nodes: 5, required_links: 'x' }, { nodes: [null, 3, []], required_links: [null] }]) {
      expect(() => parseBoard(cfg)).not.toThrow();
    }
    expect(parseBoard({}).nodes).toEqual([]);
  });

  it('pairKey не зависит от порядка, splitKey его разбирает', () => {
    expect(pairKey('b', 'a')).toBe('a|b');
    expect(pairKey('a', 'b')).toBe('a|b');
    expect(splitKey('deal_1|notary')).toEqual(['deal_1', 'notary']);
  });
});

describe('boardOutcome: итог по числу верных связей', () => {
  it('все — success; не меньше порога — partial; иначе fail', () => {
    expect(boardOutcome(5, 5, 2)).toBe('success');
    expect(boardOutcome(4, 5, 2)).toBe('partial');
    expect(boardOutcome(2, 5, 2)).toBe('partial');
    expect(boardOutcome(1, 5, 2)).toBe('fail');
    expect(boardOutcome(0, 5, 1)).toBe('fail');
    expect(boardOutcome(0, 0, 1)).toBe('success');
  });
});

describe('layoutCells: люди справа, остальное слева', () => {
  const n = (id: string, kind: 'person' | 'flat' | 'property' | 'document' | null): { id: string; labelKey: null; kind: typeof kind } => ({ id, labelKey: null, kind });

  it('при наличии kind: квартиры, затем имущество, затем документы слева (в порядке конфига внутри типа), люди справа', () => {
    const { sided, cells } = layoutCells([n('p1', 'person'), n('car', 'property'), n('f1', 'flat'), n('doc', 'document'), n('p2', 'person'), n('f2', 'flat'), n('unk', null)]);
    expect(sided).toBe(true);
    expect([...cells.entries()].filter(([, c]) => c.col === 0).map(([id]) => id)).toEqual(['f1', 'f2', 'car', 'doc', 'unk']);
    expect(cells.get('f2')).toEqual({ col: 0, row: 1 });
    expect(cells.get('p1')).toEqual({ col: 1, row: 0 });
    expect(cells.get('p2')).toEqual({ col: 1, row: 1 });
  });

  it('без kind или только люди — обычная сетка (sided = false)', () => {
    expect(layoutCells([n('a', null), n('b', null)]).sided).toBe(false);
    expect(layoutCells([n('a', 'person'), n('b', 'person')]).sided).toBe(false);
    expect(layoutCells([n('a', 'flat'), n('b', 'flat')]).sided).toBe(false);
  });
});

describe('геометрия ниток', () => {
  const r = { x: 0, y: 0, w: 100, h: 60 };

  it('edgePoint: луч из центра к точке упирается в границу прямоугольника', () => {
    expect(edgePoint(r, 300, 30)).toEqual({ x: 100, y: 30 }); // вправо — в середину правой стороны
    expect(edgePoint(r, 50, -200)).toEqual({ x: 50, y: 0 }); // вверх — верхняя сторона
    const diag = edgePoint(r, 250, 180); // луч (200, 150) из центра (50, 30) раньше упирается в нижнюю сторону
    expect(diag.x).toBeCloseTo(90);
    expect(diag.y).toBeCloseTo(60);
    expect(edgePoint(r, 50, 30)).toEqual({ x: 50, y: 30 }); // цель в центре — центр
  });

  it('threadPath: кривая начинается и кончается в заданных точках и провисает вниз', () => {
    const t = threadPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(t.at(0)).toEqual({ x: 0, y: 0 });
    expect(t.at(1)).toEqual({ x: 100, y: 0 });
    expect(t.at(0.5).x).toBeCloseTo(50);
    expect(t.at(0.5).y).toBeGreaterThan(0); // вниз
    expect(t.d.startsWith('M0 0 Q')).toBe(true);
    // направление не важно: обратная нитка провисает туда же
    expect(threadPath({ x: 100, y: 0 }, { x: 0, y: 0 }).at(0.5).y).toBeCloseTo(t.at(0.5).y);
    // вертикальная нитка не вырождается
    const v = threadPath({ x: 10, y: 0 }, { x: 10, y: 100 });
    expect(Number.isFinite(v.at(0.5).x)).toBe(true);
    // совпавшие точки — не NaN
    expect(Number.isFinite(threadPath({ x: 5, y: 5 }, { x: 5, y: 5 }).at(0.5).x)).toBe(true);
  });

  it('placeBadges: одиночный значок — посередине; значки перекрещенных ниток раздвигаются не меньше чем на minGap', () => {
    const solo = threadPath({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(placeBadges([solo], 28)[0]).toEqual(solo.at(0.5));

    // «Икс» из двух зеркальных ниток: середины совпадают.
    const up = threadPath({ x: 0, y: 100 }, { x: 120, y: 0 });
    const down = threadPath({ x: 0, y: 0 }, { x: 120, y: 100 });
    const [p, q] = placeBadges([up, down], 28);
    expect(Math.hypot((p?.x ?? 0) - (q?.x ?? 0), (p?.y ?? 0) - (q?.y ?? 0))).toBeGreaterThanOrEqual(27);
    // значок остаётся на своей нитке: дальше 20–80 % длины не уходит
    expect(p?.x).toBeGreaterThanOrEqual(0.2 * 120 - 8);
    expect(p?.x).toBeLessThanOrEqual(0.8 * 120 + 8);
  });
});

// ───────────────────────────── интерфейс и ход партии ─────────────────────────────

describe('разметка', () => {
  it('название, вступление шага и бриф из локали; бриф уходит под «Как играть», если есть вступление', () => {
    const { dom } = setup(CFG, {}, { introKey: 'mini.intro' });
    expect(text(dom, '.mg-eb__title')).toBe('Доска');
    expect(text(dom, '.mg-eb__intro')).toBe('Свяжите квартиры с людьми.');
    expect(dom.querySelector('details.mg-eb__howto .mg-eb__brief')?.textContent).toBe('Соедините узлы.');
    expect(text(dom, '.mg-eb__howto-sum')).toBe(REAL_UI['ui.minigame.howto']);
    noMissingKeys(dom);
  });

  it('без вступления бриф виден сразу, без «Как играть»', () => {
    const { dom } = setup();
    expect(dom.querySelector('details')).toBeNull();
    expect(text(dom, '.mg-eb__brief')).toBe('Соедините узлы.');
  });

  it('узлы — кнопки с подписями из локали, типом и положением по сторонам; контейнер экрана получает свой класс', () => {
    const { dom, hs, m } = setup();
    const nodes = [...dom.querySelectorAll<HTMLButtonElement>('button.mg-eb__node')];
    expect(nodes.map((n) => n.querySelector('.mg-eb__label')?.textContent)).toEqual(['Квартира А', 'Квартира Б', 'Нотариус', 'Доверенный', 'Машина']);
    expect(nodes.every((n) => n.type === 'button')).toBe(true);
    expect(node(dom, 'a').classList.contains('is-flat')).toBe(true);
    expect(node(dom, 'e').classList.contains('is-property')).toBe(true);
    expect(dom.querySelector('.mg-eb__grid')?.classList.contains('is-sided')).toBe(true);
    // люди справа (колонка 2), квартиры и имущество слева (колонка 1); строки по порядку
    expect(node(dom, 'c').style.getPropertyValue('grid-column')).toBe('2');
    expect(node(dom, 'a').style.getPropertyValue('grid-column')).toBe('1');
    expect(node(dom, 'e').style.getPropertyValue('grid-row')).toBe('3');
    expect(hs.dom.classList.contains('mg-host-eb')).toBe(true);
    m.destroy();
    expect(hs.dom.classList.contains('mg-host-eb')).toBe(false);
  });

  it('узлы без kind идут обычной сеткой; узел без label_key показывает id вместо падения', () => {
    const { dom } = setup({ nodes: ['alpha_node', 'beta', 'gamma'], required_links: [['alpha_node', 'beta']], max_wrong_links: 1 });
    expect(dom.querySelector('.mg-eb__grid')?.classList.contains('is-plain')).toBe(true);
    expect(text(dom, 'button[data-node="alpha_node"] .mg-eb__label')).toBe('Alpha node');
    expect(node(dom, 'beta').style.getPropertyValue('grid-column')).toBe('');
  });

  it('прогресс, точки ошибок (по числу max_wrong_links) и подсказка статуса в начале', () => {
    const { dom } = setup();
    expect(text(dom, '.mg-eb__progress')).toBe('Связи: 0 из 3');
    expect(dom.querySelectorAll('.mg-eb__dot')).toHaveLength(2);
    expect(used(dom)).toBe(0);
    expect(text(dom, '.mg-eb__status')).toBe(REAL_UI['ui.minigame.board.pick_first']);
    noMissingKeys(dom);
  });

  it('при большом лимите ошибок точек нет — только число', () => {
    const { dom } = setup({ ...CFG, max_wrong_links: 12 });
    expect(dom.querySelectorAll('.mg-eb__dot')).toHaveLength(0);
    expect(text(dom, '.mg-eb__mtext')).toBe('Ошибки: 0 из 12');
  });

  it('масштаб: кнопки меняют шаг, на краях отключаются; «вся доска» без раскладки остаётся на 100 %', () => {
    const { dom } = setup();
    const sheet = dom.querySelector<HTMLElement>('.mg-eb__sheet');
    const zoomBtns = dom.querySelectorAll<HTMLButtonElement>('.mg-eb__zoom button');
    const [out, fit, plus] = [zoomBtns[0], zoomBtns[1], zoomBtns[2]] as HTMLButtonElement[];
    expect(sheet?.style.getPropertyValue('--mg-eb-zoom')).toBe('1');
    plus.click();
    expect(sheet?.style.getPropertyValue('--mg-eb-zoom')).toBe(String(ZOOMS[3]));
    plus.click();
    expect(sheet?.style.getPropertyValue('--mg-eb-zoom')).toBe(String(ZOOMS[4]));
    expect(plus.disabled).toBe(true);
    fit.click();
    expect(sheet?.style.getPropertyValue('--mg-eb-zoom')).toBe('1');
    out.click();
    out.click();
    expect(sheet?.style.getPropertyValue('--mg-eb-zoom')).toBe(String(ZOOMS[0]));
    expect(out.disabled).toBe(true);
    expect(out.getAttribute('aria-label')).toBe(REAL_UI['ui.minigame.board.zoom_out']);
  });
});

describe('жесты масштаба', () => {
  const sheetZoom = (dom: HTMLElement): string => dom.querySelector<HTMLElement>('.mg-eb__sheet')?.style.getPropertyValue('--mg-eb-zoom') ?? '';
  const wheel = (el: Element, over: WheelEventInit): WheelEvent => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...over });
    el.dispatchEvent(e);
    return e;
  };
  const touch = (el: Element, type: string, pts: Array<[number, number]>): void => {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, 'touches', { value: pts.map(([x, y]) => ({ clientX: x, clientY: y })) });
    el.dispatchEvent(e);
  };

  it('Ctrl+колесо меняет масштаб на шаг и не прокручивает страницу; колесо без Ctrl ничего не делает', () => {
    const { dom } = setup();
    const vp = dom.querySelector('.mg-eb__viewport') as HTMLElement;
    expect(wheel(vp, { deltaY: -100 }).defaultPrevented).toBe(false);
    expect(sheetZoom(dom)).toBe('1');
    expect(wheel(vp, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(sheetZoom(dom)).toBe(String(ZOOMS[3]));
    wheel(vp, { deltaY: 100, ctrlKey: true });
    wheel(vp, { deltaY: 100, ctrlKey: true });
    expect(sheetZoom(dom)).toBe(String(ZOOMS[1]));
  });

  it('щипок двумя пальцами: раздвинули — крупнее, свели — мельче; один палец и «чужой» touchmove не в счёт', () => {
    const { dom } = setup();
    const vp = dom.querySelector('.mg-eb__viewport') as HTMLElement;
    touch(vp, 'touchmove', [[0, 0], [300, 0]]); // без touchstart щипка не было
    expect(sheetZoom(dom)).toBe('1');
    touch(vp, 'touchstart', [[0, 0], [100, 0]]);
    touch(vp, 'touchmove', [[0, 0], [110, 0]]); // +10 % — мало
    expect(sheetZoom(dom)).toBe('1');
    touch(vp, 'touchmove', [[0, 0], [130, 0]]); // +30 % — шаг вверх
    expect(sheetZoom(dom)).toBe(String(ZOOMS[3]));
    touch(vp, 'touchmove', [[0, 0], [95, 0]]); // от нового основания 130 → 95: меньше 82 % — шаг вниз
    expect(sheetZoom(dom)).toBe('1');
    touch(vp, 'touchmove', [[0, 0]]); // один палец
    touch(vp, 'touchend', []);
    touch(vp, 'touchmove', [[0, 0], [900, 0]]);
    expect(sheetZoom(dom)).toBe('1');
  });
});

describe('выбор узлов и связи', () => {
  it('первый тап выбирает узел (aria-pressed), повторный тап по нему снимает выбор; в статусе — подсказка', () => {
    const { dom } = setup();
    tap(dom, 'a');
    expect(node(dom, 'a').getAttribute('aria-pressed')).toBe('true');
    expect(node(dom, 'a').classList.contains('is-selected')).toBe(true);
    expect(text(dom, '.mg-eb__status')).toBe('Выбрано: Квартира А. Теперь выберите второй узел.');
    tap(dom, 'a');
    expect(node(dom, 'a').getAttribute('aria-pressed')).toBe('false');
    expect(text(dom, '.mg-eb__status')).toBe(REAL_UI['ui.minigame.board.pick_first']);
    expect(threads(dom)).toHaveLength(0);
  });

  it('Esc снимает выбор и не доходит до глобального обработчика; без выбора Esc проходит дальше', () => {
    const { dom } = setup();
    const global = vi.fn();
    window.addEventListener('keydown', global);
    const esc = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    tap(dom, 'a');
    node(dom, 'a').dispatchEvent(esc());
    expect(node(dom, 'a').getAttribute('aria-pressed')).toBe('false');
    expect(global).not.toHaveBeenCalled();
    node(dom, 'a').dispatchEvent(esc());
    expect(global).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', global);
  });

  it('верная связь: красная нитка и значок ✓, счётчик верных растёт, ошибок нет, автосейв после хода', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'c');
    const g = threadOf(dom, 'a|c');
    expect(g?.classList.contains('is-ok')).toBe(true);
    expect(badge(dom, 'a|c')?.classList.contains('is-ok')).toBe(true);
    expect(text(dom, '.mg-eb__progress')).toBe('Связи: 1 из 3');
    expect(text(dom, '.mg-eb__status')).toBe('Верно: Квартира А — Нотариус');
    expect(used(dom)).toBe(0);
    expect(hs.autosaves).toBe(1);
    expect(node(dom, 'a').classList.contains('is-linked')).toBe(true);
    expect(node(dom, 'a').getAttribute('aria-pressed')).toBe('false'); // выбор после связи снят
  });

  it('порядок узлов в паре не важен', () => {
    const { dom } = setup();
    link(dom, 'c', 'a');
    expect(threadOf(dom, 'a|c')?.classList.contains('is-ok')).toBe(true);
  });

  it('лишняя связь: пунктирная нитка и значок ✕, ошибка записана; приманка считается так же', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'b');
    expect(threadOf(dom, 'a|b')?.classList.contains('is-bad')).toBe(true);
    expect(badge(dom, 'a|b')?.classList.contains('is-bad')).toBe(true);
    expect(used(dom)).toBe(1);
    expect(text(dom, '.mg-eb__status')).toBe('Не сходится: Квартира А — Квартира Б');
    link(dom, 'd', 'e'); // приманка
    expect(threadOf(dom, 'd|e')?.classList.contains('is-bad')).toBe(true);
    expect(used(dom)).toBe(2);
    expect(hs.results).toEqual([]); // ровно max_wrong_links ошибок ещё не конец
    expect(panelShown(dom)).toBe(false);
  });

  it('ошибки считаются по уникальным парам: убрать лишнюю нитку и провести её снова — второй ошибки нет, и счётчик не возвращается', () => {
    const { dom } = setup();
    link(dom, 'a', 'b');
    expect(used(dom)).toBe(1);
    badge(dom, 'a|b')?.click(); // убрали
    expect(threads(dom)).toHaveLength(0);
    expect(used(dom)).toBe(1); // ошибка не возвращается
    link(dom, 'b', 'a'); // та же пара
    expect(threads(dom)).toHaveLength(1);
    expect(used(dom)).toBe(1);
  });

  it('повторный тап по нитке убирает связь; по значку — тоже; повторное соединение той же пары — тоже', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    link(dom, 'a', 'b'); // лишняя: партия не закончена (ошибок 1 из 2)
    expect(threads(dom)).toHaveLength(3);
    threadOf(dom, 'a|c')?.querySelector('path')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(threadOf(dom, 'a|c')).toBeUndefined();
    expect(text(dom, '.mg-eb__progress')).toBe('Связи: 1 из 3');
    expect(text(dom, '.mg-eb__status')).toBe('Убрано: Квартира А — Нотариус');
    badge(dom, 'b|c')?.click();
    expect(threadOf(dom, 'b|c')).toBeUndefined();
    expect(text(dom, '.mg-eb__progress')).toBe('Связи: 0 из 3');
    link(dom, 'b', 'a'); // та же пара ещё раз — убирает
    expect(threadOf(dom, 'a|b')).toBeUndefined();
    expect(threads(dom)).toHaveLength(0);
    expect(used(dom)).toBe(1); // ошибка осталась
    expect(hs.autosaves).toBe(6); // 3 связи + 3 удаления
    expect(badge(dom, 'a|c')).toBeNull();
  });

  it('значок связи — кнопка с понятным названием: «Убрать связь: …»', () => {
    const { dom } = setup();
    link(dom, 'a', 'c');
    const b = badge(dom, 'a|c');
    expect(b?.getAttribute('aria-label')).toBe('Убрать связь: Квартира А — Нотариус');
    expect(b?.type).toBe('button');
  });

  it('связь с неизвестным узлом при restore не появляется; нитки рисуются и без раскладки (jsdom)', () => {
    const { dom, m } = setup();
    m.restore({ links: ['a|zzz', 'a|c'], tried: [], hints: [] });
    expect(threads(dom).map((g) => g.getAttribute('data-link'))).toEqual(['a|c']);
    const path = threadOf(dom, 'a|c')?.querySelector('.mg-eb__thread-line')?.getAttribute('d') ?? '';
    expect(path).toMatch(/^M-?[\d.]+ -?[\d.]+ Q/);
    expect(path).not.toContain('NaN');
  });
});

describe('исходы партии', () => {
  it('все верные связи → success; итог показывается в нижней панели, onResult — только по «Далее» и один раз', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    expect(panelShown(dom)).toBe(false);
    link(dom, 'c', 'd');
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-eb__verdict')).toBe(REAL_UI['ui.minigame.success']);
    expect(text(dom, '.mg-eb__summary')).toBe('Верных связей: 3 из 3. Ошибок: 0.');
    expect(hs.results).toEqual([]);
    expect(dom.querySelector('.mg-eb')?.classList.contains('is-over')).toBe(true);
    // доска больше не принимает ходы
    const before = threads(dom).length;
    link(dom, 'a', 'b');
    expect(threads(dom)).toHaveLength(before);
    done(dom);
    done(dom);
    expect(hs.results).toEqual(['success']);
    noMissingKeys(dom);
  });

  it('успех с ошибками в пределах лимита: ровно max_wrong_links ошибок — всё ещё success', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'b');
    link(dom, 'a', 'd');
    expect(used(dom)).toBe(2);
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    link(dom, 'c', 'd');
    expect(text(dom, '.mg-eb__verdict')).toBe(REAL_UI['ui.minigame.success']);
    expect(text(dom, '.mg-eb__summary')).toBe('Верных связей: 3 из 3. Ошибок: 2.');
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('ошибок стало больше лимита и верных не меньше partial_threshold → partial', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'c');
    link(dom, 'b', 'c'); // 2 верных = порог
    link(dom, 'a', 'b');
    link(dom, 'a', 'd');
    expect(panelShown(dom)).toBe(false);
    link(dom, 'a', 'e'); // третья ошибка при лимите 2
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-eb__verdict')).toBe(REAL_UI['ui.minigame.partial']);
    expect(text(dom, '.mg-eb__summary')).toBe('Верных связей: 2 из 3. Ошибок: 3.');
    done(dom);
    expect(hs.results).toEqual(['partial']);
  });

  it('ошибок больше лимита, а верных меньше порога → fail', () => {
    const { dom, hs } = setup();
    link(dom, 'a', 'c'); // 1 верная при пороге 2
    link(dom, 'a', 'b');
    link(dom, 'a', 'd');
    link(dom, 'a', 'e');
    expect(text(dom, '.mg-eb__verdict')).toBe(REAL_UI['ui.minigame.fail']);
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('partial_threshold по умолчанию — 1: одной верной связи достаточно для partial', () => {
    const cfg: Record<string, unknown> = { ...CFG };
    delete cfg.partial_threshold;
    const { dom, hs } = setup(cfg);
    link(dom, 'a', 'c');
    link(dom, 'a', 'b');
    link(dom, 'a', 'd');
    link(dom, 'a', 'e');
    done(dom);
    expect(hs.results).toEqual(['partial']);
  });

  it('max_wrong_links = 0: первая же лишняя связь заканчивает партию', () => {
    const { dom, hs } = setup({ ...CFG, max_wrong_links: 0 });
    link(dom, 'a', 'b');
    expect(panelShown(dom)).toBe(true);
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('config, непригодный для механики (нет верных связей или меньше двух узлов), превращается в grey-box с предупреждением; результат пробрасывается', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const cfg of [{ nodes: ['a', 'b', 'c'], required_links: [], max_wrong_links: 1 }, { nodes: ['a'], required_links: [['a', 'b']], max_wrong_links: 1 }, {}]) {
      const { dom, hs, m } = setup(cfg);
      expect(dom.querySelector('.mg-gb')).not.toBeNull();
      expect(dom.querySelector('.mg-eb')).toBeNull();
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('config непригоден для evidence_board'));
      m.pause();
      m.resume();
      m.restore({ hintsShown: 0 });
      expect(m.serialize()).toEqual({ hintsShown: 0 });
      dom.querySelector<HTMLButtonElement>('.mg-btn.is-partial')?.click();
      expect(hs.results).toEqual(['partial']);
      m.destroy();
      expect(dom.querySelector('.mg-gb')).toBeNull();
    }
    warn.mockRestore();
  });

  it('итог сохраняется в serialize, автосейв вызывается на концовке', () => {
    const { dom, hs, m } = setup();
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    const before = hs.autosaves;
    link(dom, 'c', 'd');
    expect(hs.autosaves).toBe(before + 1);
    expect(m.serialize()).toMatchObject({ result: 'success' });
  });
});

describe('пропуск', () => {
  it('кнопка появляется после skip.after_fails ошибок; в режиме «только история» — сразу и выделена', () => {
    const { dom } = setup(CFG, { skip: { allowed: true, after_fails: 2 } });
    expect(buttons(dom)).toEqual([]);
    link(dom, 'a', 'b');
    expect(buttons(dom)).toEqual([]);
    link(dom, 'a', 'd');
    expect(buttons(dom)).toEqual([REAL_UI['ui.minigame.skip']]);

    const story = setup(CFG, { skip: { allowed: true, after_fails: 2 } }, { settings: { timers: false, storyOnly: true } });
    expect(buttons(story.dom)).toEqual([REAL_UI['ui.minigame.skip']]);
    expect(story.dom.querySelector('.is-skip')?.classList.contains('is-primary')).toBe(true);
  });

  it('after_fails не задан — кнопка сразу; skip.allowed=false — никогда, даже в «только истории»', () => {
    expect(buttons(setup(CFG, { skip: { allowed: true } }).dom)).toEqual([REAL_UI['ui.minigame.skip']]);
    const off = setup(CFG, { skip: { allowed: false } }, { settings: { timers: false, storyOnly: true } });
    expect(buttons(off.dom)).toEqual([]);
    link(off.dom, 'a', 'b');
    expect(buttons(off.dom)).toEqual([]);
  });

  it('пропуск отдаёт skipped сразу (без итоговой панели) и ровно один раз', () => {
    const { dom, hs } = setup(CFG, { skip: { allowed: true } });
    const skip = dom.querySelector<HTMLButtonElement>('.is-skip');
    skip?.click();
    skip?.click();
    expect(hs.results).toEqual(['skipped']);
    link(dom, 'a', 'c'); // после пропуска доска неактивна
    expect(hs.results).toEqual(['skipped']);
  });

  it('после итога кнопки пропуска нет, а «Далее» не даёт второй результат', () => {
    const { dom, hs } = setup(CFG, { skip: { allowed: true } });
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    link(dom, 'c', 'd');
    expect(dom.querySelector('.is-skip')).toBeNull();
    done(dom);
    dom.querySelector<HTMLButtonElement>('.is-skip')?.click();
    expect(hs.results).toEqual(['success']);
  });
});

describe('подсказка за rewarded-рекламу', () => {
  const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };

  it('кнопка есть только при hint_rewarded_ad и поддержке платформой; после последней связи исчезает', () => {
    const ok = (): Promise<boolean> => Promise.resolve(true);
    expect(buttons(setup(CFG, withAd, { showRewarded: ok }).dom)).toContain(REAL_UI['ui.minigame.hint_ad']);
    expect(buttons(setup(CFG, withAd).dom)).not.toContain(REAL_UI['ui.minigame.hint_ad']);
    expect(buttons(setup(CFG, { skip: { allowed: true } }, { showRewarded: ok }).dom)).not.toContain(REAL_UI['ui.minigame.hint_ad']);
    const { dom } = setup(CFG, withAd, { showRewarded: ok });
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    link(dom, 'c', 'd');
    expect(dom.querySelector('.is-hint')).toBeNull();
  });

  it('просмотренная реклама подсвечивает пару узлов недостающей связи, просит автосейв и пишет телеметрию', async () => {
    const showRewarded = vi.fn(() => Promise.resolve(true));
    const { dom, hs, m } = setup(CFG, withAd, { showRewarded });
    dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    await vi.waitFor(() => expect(dom.querySelectorAll('.mg-eb__node.is-hint')).toHaveLength(2));
    // подсказка — первая недостающая верная связь в порядке конфига: a–c
    expect(node(dom, 'a').classList.contains('is-hint')).toBe(true);
    expect(node(dom, 'c').classList.contains('is-hint')).toBe(true);
    expect(text(dom, '.mg-eb__status')).toBe('Подсказка: свяжите «Квартира А» и «Нотариус».');
    expect(hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]);
    expect(hs.autosaves).toBe(1);
    expect(m.serialize()).toMatchObject({ hints: ['a|c'] });
    // связали — подсветка снята; следующая подсказка указывает на другую пару
    link(dom, 'a', 'c');
    expect(dom.querySelectorAll('.mg-eb__node.is-hint')).toHaveLength(0);
    dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    await vi.waitFor(() => expect(node(dom, 'b').classList.contains('is-hint')).toBe(true));
    expect(showRewarded).toHaveBeenCalledTimes(2);
  });

  it('реклама не показана: подсказки нет, автосейва нет, событие в телеметрии есть; пока реклама идёт — кнопка недоступна', async () => {
    const no = setup(CFG, withAd, { showRewarded: () => Promise.resolve(false) });
    no.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    await vi.waitFor(() => expect(no.hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(no.dom.querySelectorAll('.mg-eb__node.is-hint')).toHaveLength(0);
    expect(no.hs.autosaves).toBe(0);

    let resolveAd: (ok: boolean) => void = () => undefined;
    const showRewarded = vi.fn(() => new Promise<boolean>((r) => (resolveAd = r)));
    const busy = setup(CFG, withAd, { showRewarded });
    busy.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    expect(busy.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.disabled).toBe(true);
    busy.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    expect(showRewarded).toHaveBeenCalledTimes(1);
    resolveAd(true);
    await vi.waitFor(() => expect(busy.dom.querySelectorAll('.mg-eb__node.is-hint')).toHaveLength(2));
  });

  it('реклама, которая бросила ошибку, не ломает игру; закрытая мини-игра не трогает DOM после рекламы', async () => {
    const bad = setup(CFG, withAd, { showRewarded: () => Promise.reject(new Error('ad')) });
    bad.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    await vi.waitFor(() => expect(bad.hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(bad.dom.querySelector('.mg-eb')).not.toBeNull();

    let resolveAd: (ok: boolean) => void = () => undefined;
    const late = setup(CFG, withAd, { showRewarded: () => new Promise<boolean>((r) => (resolveAd = r)) });
    late.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    late.m.destroy();
    resolveAd(true);
    await vi.waitFor(() => expect(late.hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]));
    expect(late.dom.querySelector('.mg-eb')).toBeNull();
    expect(late.hs.autosaves).toBe(0);
  });
});

describe('таймер (def.time_limit_ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('есть лимит и таймеры включены: полоска времени; время вышло → итог по верным связям и пометка «Время вышло»', () => {
    const { dom, hs } = setup(CFG, { time_limit_ms: 10_000 });
    expect(dom.querySelector('.mg-eb__time')).not.toBeNull();
    link(dom, 'a', 'c');
    link(dom, 'b', 'c'); // 2 верных = порог partial
    vi.advanceTimersByTime(9_000);
    expect(panelShown(dom)).toBe(false);
    expect(dom.querySelector('.mg-eb__time')?.getAttribute('aria-valuetext')).toMatch(/^Осталось: 0:0[1-9]$/);
    vi.advanceTimersByTime(1_500);
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-eb__verdict')).toBe(REAL_UI['ui.minigame.partial']);
    expect(text(dom, '.mg-eb__why')).toBe(REAL_UI['ui.minigame.time_up']);
    expect(hs.results).toEqual([]);
    done(dom);
    expect(hs.results).toEqual(['partial']);
  });

  it('время вышло при верных связях меньше порога → fail', () => {
    const { dom, hs } = setup(CFG, { time_limit_ms: 5_000 });
    link(dom, 'a', 'c');
    vi.advanceTimersByTime(5_500);
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('таймеры выключены в настройках или режим «только история» — таймера нет совсем', () => {
    for (const settings of [{ timers: false, storyOnly: false }, { timers: false, storyOnly: true }, { timers: true, storyOnly: true }]) {
      const { dom } = setup(CFG, { time_limit_ms: 3_000 }, { settings });
      expect(dom.querySelector('.mg-eb__time')).toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(panelShown(dom)).toBe(false);
    }
    // без time_limit_ms таймера тоже нет
    const plain = setup();
    expect(plain.dom.querySelector('.mg-eb__time')).toBeNull();
    expect(plain.m.serialize()).toMatchObject({ left: null });
  });

  it('пауза замораживает время и ввод, resume продолжает с того же места', () => {
    const { dom, hs, m } = setup(CFG, { time_limit_ms: 10_000 });
    vi.advanceTimersByTime(4_000);
    m.pause();
    vi.advanceTimersByTime(60_000);
    expect(panelShown(dom)).toBe(false);
    const left = (m.serialize() as { left: number }).left;
    expect(left).toBeGreaterThan(5_500);
    expect(left).toBeLessThanOrEqual(6_000);
    tap(dom, 'a'); // ввод на паузе не принимается
    expect(node(dom, 'a').getAttribute('aria-pressed')).toBe('false');
    m.resume();
    vi.advanceTimersByTime(5_000);
    expect(panelShown(dom)).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(panelShown(dom)).toBe(true);
    expect(hs.results).toEqual([]);
  });

  it('остаток времени возвращается через restore; нулевой остаток заканчивает партию', () => {
    const a = setup(CFG, { time_limit_ms: 10_000 });
    a.m.restore({ links: [], tried: [], hints: [], left: 1_000, result: null });
    vi.advanceTimersByTime(800);
    expect(panelShown(a.dom)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(panelShown(a.dom)).toBe(true);

    const b = setup(CFG, { time_limit_ms: 10_000 });
    b.m.restore({ links: [], tried: [], hints: [], left: 0, result: null });
    expect(panelShown(b.dom)).toBe(true);
  });

  it('пауза сначала, остаток потом: таймер, поставленный на паузу хостом сразу после mount, не тикает', () => {
    const hs = harness(defOf({ time_limit_ms: 2_000 }));
    const m = createEvidenceBoard();
    m.onResult = (r) => hs.results.push(r);
    m.mount(null as never, hs.dom, CFG, hs.ctx);
    m.pause(); // как DomUI.runMinigame при активной паузе платформы
    vi.advanceTimersByTime(10_000);
    expect(hs.dom.querySelector<HTMLElement>('.mg-eb__result')?.hidden).toBe(true);
  });
});

describe('Countdown и formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('считает по часам, onExpire один раз, пауза замораживает остаток', () => {
    const expire = vi.fn();
    const ticks: number[] = [];
    const c = new Countdown(1_000, expire, (left) => ticks.push(left), 100);
    c.start();
    vi.advanceTimersByTime(400);
    expect(c.remainingMs).toBeLessThanOrEqual(600);
    c.pause();
    const frozen = c.remainingMs;
    vi.advanceTimersByTime(5_000);
    expect(c.remainingMs).toBe(frozen);
    expect(expire).not.toHaveBeenCalled();
    c.start();
    vi.advanceTimersByTime(frozen + 200);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(c.done).toBe(true);
    expect(c.running).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(ticks.length).toBeGreaterThan(3);
  });

  it('stop не вызывает onExpire; start после stop ничего не запускает; setRemaining подменяет остаток', () => {
    const expire = vi.fn();
    const c = new Countdown(1_000, expire, () => undefined, 100);
    c.start();
    c.stop();
    vi.advanceTimersByTime(5_000);
    expect(expire).not.toHaveBeenCalled();
    c.start();
    expect(c.running).toBe(false);
    const d = new Countdown(1_000, expire, () => undefined, 100);
    d.setRemaining(300);
    expect(d.remainingMs).toBe(300);
    d.start();
    vi.advanceTimersByTime(400);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('один тик не списывает больше секунды: заморозка страницы не съедает время', () => {
    const c = new Countdown(60_000, () => undefined, () => undefined, 200);
    c.start();
    vi.setSystemTime(Date.now() + 30 * 60_000); // «страницу заморозили на полчаса»
    vi.advanceTimersByTime(200);
    expect(c.remainingMs).toBeGreaterThan(58_000);
  });

  it('formatTime: м:сс с округлением вверх', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(1)).toBe('0:01');
    expect(formatTime(59_001)).toBe('1:00');
    expect(formatTime(125_000)).toBe('2:05');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('serialize / restore: автосейв внутри мини-игры', () => {
  it('связи, ошибки и подсказки возвращаются после загрузки; выбор узла временный и не сохраняется', async () => {
    const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };
    const a = setup(CFG, withAd, { showRewarded: () => Promise.resolve(true) });
    link(a.dom, 'a', 'c');
    link(a.dom, 'a', 'b'); // ошибка
    a.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    await vi.waitFor(() => expect(a.dom.querySelectorAll('.mg-eb__node.is-hint')).toHaveLength(2));
    tap(a.dom, 'd'); // выбран, но не сохраняется
    const state = JSON.parse(JSON.stringify(a.m.serialize())) as Record<string, unknown>;
    expect(state).toMatchObject({ v: 1, links: ['a|c', 'a|b'], tried: ['a|b'], hints: ['b|c'], result: null });

    const b = setup(CFG, withAd, { showRewarded: () => Promise.resolve(true) });
    b.m.restore(state);
    expect(threads(b.dom).map((g) => g.getAttribute('data-link'))).toEqual(['a|c', 'a|b']);
    expect(used(b.dom)).toBe(1);
    expect(text(b.dom, '.mg-eb__progress')).toBe('Связи: 1 из 3');
    expect(node(b.dom, 'b').classList.contains('is-hint')).toBe(true);
    expect(node(b.dom, 'd').getAttribute('aria-pressed')).toBe('false');
    expect(b.m.serialize()).toEqual(a.m.serialize());
    // игра продолжается с того же места
    link(b.dom, 'b', 'c');
    link(b.dom, 'c', 'd');
    expect(panelShown(b.dom)).toBe(true);
  });

  it('сохранение, сделанное на итоговой панели, снова показывает итог; «Далее» отдаёт результат один раз', () => {
    const a = setup();
    link(a.dom, 'a', 'c');
    link(a.dom, 'b', 'c');
    link(a.dom, 'c', 'd');
    const state = JSON.parse(JSON.stringify(a.m.serialize()));
    const b = setup();
    b.m.restore(state);
    expect(panelShown(b.dom)).toBe(true);
    expect(text(b.dom, '.mg-eb__verdict')).toBe(REAL_UI['ui.minigame.success']);
    expect(b.hs.results).toEqual([]);
    done(b.dom);
    done(b.dom);
    expect(b.hs.results).toEqual(['success']);
  });

  it('лишняя связь из сейва всегда считается ошибкой, даже если её нет в списке ошибок', () => {
    const { dom, m } = setup();
    m.restore({ links: ['a|b'], tried: [], hints: [] });
    expect(used(dom)).toBe(1);
    expect(m.serialize()).toMatchObject({ tried: ['a|b'] });
  });

  it('мусор в состоянии игнорируется: ни исключений, ни порчи текущей партии', () => {
    const { dom, m } = setup();
    link(dom, 'a', 'c');
    const before = JSON.stringify(m.serialize());
    for (const junk of ['мусор', null, undefined, 42, [], { links: 'x', tried: 5, hints: {}, left: 'x', result: 'win' }]) {
      expect(() => m.restore(junk)).not.toThrow();
    }
    expect(JSON.stringify(m.serialize())).toBe(before); // партия осталась как была
    // битые элементы внутри списков отбрасываются, хорошие остаются
    m.restore({ links: [1, null, 'a|a', 'zzz|c', 'c|a'], tried: [3, 'a|b|c'], hints: [] });
    expect(m.serialize()).toMatchObject({ links: [], tried: [] }); // 'c|a' — не нормализованный ключ: порядок узлов в паре фиксирован
    m.restore({ links: ['a|c', 'a|c'], tried: [], hints: [] });
    expect(m.serialize()).toMatchObject({ links: ['a|c'] });
    // подсказки только для ещё не проведённых верных связей
    m.restore({ links: ['a|c'], tried: [], hints: ['a|c', 'a|b', 'b|c'] });
    expect(m.serialize()).toMatchObject({ hints: ['b|c'] });
  });
});

describe('пауза, язык, destroy', () => {
  it('на паузе (реклама, вкладка в фоне) тапы и кнопки не засчитываются; после resume — работают', () => {
    const { dom, m, hs } = setup(CFG, { skip: { allowed: true } });
    m.pause();
    expect(dom.querySelector('.mg-eb')?.classList.contains('is-paused')).toBe(true);
    tap(dom, 'a');
    expect(node(dom, 'a').getAttribute('aria-pressed')).toBe('false');
    dom.querySelector<HTMLButtonElement>('.is-skip')?.click();
    expect(hs.results).toEqual([]);
    m.resume();
    expect(dom.querySelector('.mg-eb')?.classList.contains('is-paused')).toBe(false);
    dom.querySelector<HTMLButtonElement>('.is-skip')?.click();
    expect(hs.results).toEqual(['skipped']);
  });

  it('«Далее» на паузе не засчитывается', () => {
    const { dom, m, hs } = setup();
    link(dom, 'a', 'c');
    link(dom, 'b', 'c');
    link(dom, 'c', 'd');
    m.pause();
    done(dom);
    expect(hs.results).toEqual([]);
    m.resume();
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('смена языка перерисовывает подписи на лету, не теряя связи, ошибки и выбор', () => {
    const { dom, hs } = setup(CFG, {}, { introKey: 'mini.intro' });
    link(dom, 'a', 'c');
    link(dom, 'a', 'b');
    tap(dom, 'd');
    hs.setStrings({
      ...STRINGS,
      'mini.m1.title': 'Board',
      'n.a': 'Flat A',
      'n.d': 'Attorney',
      'ui.minigame.board.progress': 'Links: {n} of {total}',
      'ui.minigame.board.body.pick_second': 'Selected: {name}.',
    });
    hs.fireLanguageChange();
    expect(text(dom, '.mg-eb__title')).toBe('Board');
    expect(text(dom, 'button[data-node="a"] .mg-eb__label')).toBe('Flat A');
    expect(text(dom, '.mg-eb__progress')).toBe('Links: 1 of 3');
    expect(text(dom, '.mg-eb__status')).toBe('Selected: Attorney.');
    expect(badge(dom, 'a|c')?.getAttribute('aria-label')).toContain('Flat A');
    expect(threads(dom)).toHaveLength(2);
    expect(used(dom)).toBe(1);
    expect(node(dom, 'd').getAttribute('aria-pressed')).toBe('true');
  });

  it('destroy убирает разметку и класс контейнера, отписывается от языка, гасит таймер и безопасен при повторном вызове', () => {
    vi.useFakeTimers();
    const { dom, hs, m } = setup(CFG, { time_limit_ms: 5_000 });
    expect(hs.listenerCount()).toBe(1);
    m.destroy();
    expect(dom.querySelector('.mg-eb')).toBeNull();
    expect(hs.listenerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(hs.results).toEqual([]);
    expect(hs.autosaves).toBe(0);
    expect(() => {
      m.destroy();
      m.pause();
      m.resume();
      m.restore({ links: ['a|c'] });
      hs.fireLanguageChange();
    }).not.toThrow();
  });

  it('хост вызывает destroy прямо внутри onResult — кнопка «Далее» после этого ничего не ломает', () => {
    const hs = harness(defOf());
    const m = createEvidenceBoard();
    m.onResult = (r) => {
      hs.results.push(r);
      m.destroy();
    };
    m.mount(null as never, hs.dom, CFG, hs.ctx);
    link(hs.dom, 'a', 'c');
    link(hs.dom, 'b', 'c');
    link(hs.dom, 'c', 'd');
    done(hs.dom);
    expect(hs.results).toEqual(['success']);
    expect(hs.dom.querySelector('.mg-eb')).toBeNull();
  });
});

describe('доступность', () => {
  it('прогресс-полоска времени — progressbar с текстом; точки ошибок — img с подписью; статус — живая область', () => {
    vi.useFakeTimers();
    const { dom } = setup(CFG, { time_limit_ms: 30_000 });
    const time = dom.querySelector('.mg-eb__time');
    expect(time?.getAttribute('role')).toBe('progressbar');
    expect(time?.getAttribute('aria-valuemax')).toBe('30000');
    expect(dom.querySelector('.mg-eb__dots')?.getAttribute('role')).toBe('img');
    expect(dom.querySelector('.mg-eb__dots')?.getAttribute('aria-label')).toBe('Ошибки: 0 из 2');
    expect(dom.querySelector('.mg-eb__status')?.getAttribute('role')).toBe('status');
  });

  it('значки верно/неверно различаются формой (✓ и ✕), а не только цветом', () => {
    const { dom } = setup();
    link(dom, 'a', 'c');
    link(dom, 'a', 'b');
    const ok = badge(dom, 'a|c')?.querySelector('path')?.getAttribute('d');
    const bad = badge(dom, 'a|b')?.querySelector('path')?.getAttribute('d');
    expect(ok).toBeTruthy();
    expect(bad).toBeTruthy();
    expect(ok).not.toBe(bad);
    // и нитки — сплошная и пунктирная — различаются классом (стили в evidence_board.css)
    expect(threadOf(dom, 'a|c')?.classList.contains('is-ok')).toBe(true);
    expect(threadOf(dom, 'a|b')?.classList.contains('is-bad')).toBe(true);
  });
});

// ───────────────────────────── строки интерфейса обеих игр ─────────────────────────────

describe('ui.json: строки доски улик и допроса переведены на все языки', () => {
  const ru = loadLocale('ru', 'ui');
  const keys = Object.keys(ru).filter((k) => k.startsWith('ui.minigame.board.') || k.startsWith('ui.minigame.interrogation.') || k === 'ui.minigame.howto');
  const placeholders = (v: string): string[] => (v.match(/\{[a-z_]+\}/g) ?? []).sort();

  it('ключи есть и заполнены во всех четырёх языках (не пустые), плейсхолдеры совпадают с ru', () => {
    expect(keys.length).toBeGreaterThanOrEqual(25);
    for (const lang of LANGS) {
      const ui = loadLocale(lang, 'ui');
      for (const k of keys) {
        expect(ui[k]?.trim(), `${lang} ${k}`).toBeTruthy();
        expect(placeholders(ui[k] ?? ''), `${lang} ${k}`).toEqual(placeholders(ru[k] ?? ''));
      }
    }
  });

  it('подписи не длиннее 24 символов (проверка линтера), длинные подсказки — только в body.* и не длиннее 120', () => {
    for (const lang of LANGS) {
      const ui = loadLocale(lang, 'ui');
      for (const k of keys) {
        const limit = k.includes('.body.') ? 120 : 24;
        expect((ui[k] ?? '').length, `${lang} ${k}`).toBeLessThanOrEqual(limit);
      }
    }
  });
});

// ───────────────────────────── настоящий ep01 ─────────────────────────────

describe.skipIf(!hasRepoContent())('mg_board из ep01 на настоящих локалях', () => {
  const episode = loadEpisode(EP01_PATH);
  const def = episode.minigames?.mg_board as MinigameDef;
  const ru = loadStrings('ru', episode.id);

  const mountReal = (over: Partial<GameContext> = {}): { m: IMinigame; hs: Harness; dom: HTMLElement } => {
    const hs = harness(def, { episode, introKey: 'ep01.mg_board.intro', ...over });
    hs.setStrings(ru);
    const m = createEvidenceBoard();
    m.onResult = (r) => hs.results.push(r);
    m.mount(null as never, hs.dom, def.config, hs.ctx);
    return { m, hs, dom: hs.dom };
  };

  it('у каждого узла есть подпись в ru (не [ключ]); узлы разложены по сторонам: квартиры и имущество слева, люди справа', () => {
    const { dom } = mountReal();
    const spec = parseBoard(def.config);
    expect(spec.nodes.length).toBe(8);
    for (const n of spec.nodes) {
      expect(n.labelKey, n.id).toBeTruthy();
      expect(ru[n.labelKey as string], n.labelKey as string).toBeTruthy();
      expect(text(dom, `button[data-node="${n.id}"] .mg-eb__label`)).toBe(ru[n.labelKey as string]);
    }
    noMissingKeys(dom);
    expect(node(dom, 'deal_1').style.getPropertyValue('grid-column')).toBe('1');
    expect(node(dom, 'volga_car').style.getPropertyValue('grid-column')).toBe('1');
    expect(node(dom, 'notary').style.getPropertyValue('grid-column')).toBe('2');
    expect(node(dom, 'zoya').style.getPropertyValue('grid-column')).toBe('2');
    expect(text(dom, '.mg-eb__intro')).toBe(ru['ep01.mg_board.intro']);
  });

  it('все пять верных связей из конфига → success; приманка buyer–attorney и связь с Зоей — ошибки', () => {
    const { dom, hs } = mountReal();
    const cfg = def.config as { required_links: string[][]; decoy_links: string[][]; max_wrong_links: number };
    expect(cfg.required_links).toHaveLength(5);
    link(dom, 'buyer', 'attorney'); // приманка
    link(dom, 'zoya', 'deal_1'); // у узла «Зоя» нет ни одной верной связи
    expect(used(dom)).toBe(2);
    expect(cfg.max_wrong_links).toBeGreaterThanOrEqual(2);
    for (const [a, b] of cfg.required_links) link(dom, a as string, b as string);
    expect(text(dom, '.mg-eb__verdict')).toBe(ru['ui.minigame.success']);
    expect(text(dom, '.mg-eb__summary')).toBe('Верных связей: 5 из 5. Ошибок: 2.');
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('частичный исход (3 верных связи, затем лимит ошибок) → partial; без верных связей → fail', () => {
    const cfg = def.config as { required_links: string[][]; max_wrong_links: number };
    const wrongPairs: Array<[string, string]> = [
      ['zoya', 'deal_1'],
      ['zoya', 'deal_2'],
      ['zoya', 'deal_3'],
      ['zoya', 'volga_car'],
      ['zoya', 'buyer'],
      ['zoya', 'attorney'],
    ];
    const partial = mountReal();
    for (const [a, b] of cfg.required_links.slice(0, 3)) link(partial.dom, a as string, b as string);
    for (const [a, b] of wrongPairs.slice(0, cfg.max_wrong_links + 1)) link(partial.dom, a, b);
    done(partial.dom);
    expect(partial.hs.results).toEqual(['partial']);

    const fail = mountReal();
    for (const [a, b] of wrongPairs.slice(0, cfg.max_wrong_links + 1)) link(fail.dom, a, b);
    done(fail.dom);
    expect(fail.hs.results).toEqual(['fail']);
  });

  it('пропуск доступен только после skip.after_fails ошибок', () => {
    expect(def.skip.allowed).toBe(true);
    const { dom } = mountReal();
    const after = def.skip.after_fails ?? 0;
    expect(after).toBeGreaterThan(0);
    const wrong: Array<[string, string]> = [
      ['zoya', 'deal_1'],
      ['zoya', 'deal_2'],
      ['zoya', 'deal_3'],
    ];
    for (let i = 0; i < after; i++) {
      expect(dom.querySelector('.is-skip')).toBeNull();
      link(dom, ...(wrong[i] as [string, string]));
    }
    expect(dom.querySelector('.is-skip')).not.toBeNull();
  });
});
