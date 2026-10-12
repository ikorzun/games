// @vitest-environment jsdom
/**
 * Допрос (interrogation_press): разбор конфига и условий улик, доступные карточки, верная и неверная
 * улика, «надавить» и «оставить без ответа», исходы по порогам, ошибки-точки, пропуск и подсказка,
 * таймер, пауза, serialize/restore, смена языка, единственный onResult; плюс проверка на настоящем
 * конфиге ep01 (mg_interrogation) и локалях.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpolate } from '../src/core/i18n';
import type { MinigameDef, MinigameResult, Value } from '../src/core/types';
import { createInterrogationPress, interrogationOutcome, parseInterrogation, truthy } from '../src/minigames/interrogation_press';
import type { GameContext, IMinigame } from '../src/minigames/types';
import { EP01_PATH, hasRepoContent, loadEpisode, loadStrings } from './helpers/content';
import { mg, miniEpisode } from './helpers/mini';

// ───────────────────────────── стенд ─────────────────────────────

const REAL_UI = loadStrings('ru', 'ep01_murylev');
const STRINGS: Record<string, string> = {
  ...REAL_UI,
  'mini.m1.title': 'Допрос',
  'mini.m1.brief': 'Предъявите улики.',
  'mini.intro': 'Он врёт. Докажите.',
  'mini.cast.a': 'Следователь',
  'mini.cast.b': 'Подозреваемый',
  'st.1': 'Я был дома.',
  'st.2': 'Я никого не знаю.',
  'st.2.press': 'Ну, может, видел раз.',
  'st.3': 'Ключей у меня нет.',
  'st.4': 'Машина не моя.',
  'ev.a': 'Билет',
  'ev.b': 'Показания соседа',
  'ev.c': 'Связка ключей',
  'ev.d': 'Справка ГАИ',
  'ev.decoy': 'Квитанция',
};

const CFG = {
  suspect: 'b',
  statements: [
    { id: 's1', text_key: 'st.1', contradicted_by: 'ev_a', requires: 'has_a' },
    { id: 's2', text_key: 'st.2', contradicted_by: 'ev_b', requires: 'has_b', press_key: 'st.2.press' },
    { id: 's3', text_key: 'st.3', contradicted_by: ['ev_c', 'ev_a'], requires: 'has_c' },
    { id: 's4', text_key: 'st.4', contradicted_by: 'ev_d', requires: 'has_d' },
  ],
  evidence: [
    { id: 'ev_a', label_key: 'ev.a', requires: 'has_a' },
    { id: 'ev_decoy', label_key: 'ev.decoy' },
    'ev_b', // строкой: условие берётся из утверждения → has_b
    { id: 'ev_c', label_key: 'ev.c', requires: 'has_c' },
    'ev_d',
  ],
  full_threshold: 3,
  partial_threshold: 1,
  max_mistakes: 3,
};
const VARS: Record<string, Value> = { has_a: true, has_b: true, has_c: false, has_d: true };

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

function harness(def: MinigameDef, over: Partial<GameContext> = {}, vars: Record<string, Value> = VARS): Harness {
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

const defOf = (over: Partial<MinigameDef> = {}): MinigameDef => mg('m1', { type: 'interrogation_press', ...over });

function setup(
  cfg: Record<string, unknown> = CFG,
  def: Partial<MinigameDef> = {},
  ctxOver: Partial<GameContext> = {},
  vars: Record<string, Value> = VARS,
): { m: IMinigame; hs: Harness; dom: HTMLElement } {
  const hs = harness(defOf(def), ctxOver, vars);
  const m = createInterrogationPress();
  m.onResult = (r) => hs.results.push(r);
  m.mount(null as never, hs.dom, cfg, hs.ctx);
  return { m, hs, dom: hs.dom };
}

const card = (dom: HTMLElement, ev: string): HTMLButtonElement => {
  const el = dom.querySelector<HTMLButtonElement>(`button.mg-ip__card[data-ev="${ev}"]`);
  if (!el) throw new Error(`нет карточки ${ev}`);
  return el;
};
const cards = (dom: HTMLElement): string[] => [...dom.querySelectorAll<HTMLElement>('button.mg-ip__card')].map((c) => c.dataset.ev ?? '');
const present = (dom: HTMLElement, ev: string): void => card(dom, ev).click();
const text = (dom: HTMLElement, sel: string): string => dom.querySelector(sel)?.textContent ?? '';
const used = (dom: HTMLElement): number => dom.querySelectorAll('.mg-ip__dot.is-used').length;
const buttons = (dom: HTMLElement): string[] => [...dom.querySelectorAll('.mg-ip__actions button.mg-btn')].map((b) => b.textContent ?? '');
const click = (dom: HTMLElement, sel: string): void => {
  const b = dom.querySelector<HTMLButtonElement>(sel);
  if (!b) throw new Error(`нет ${sel}`);
  b.click();
};
const next = (dom: HTMLElement): void => click(dom, '.mg-btn.is-next');
const pass = (dom: HTMLElement): void => click(dom, '.mg-btn.is-pass');
const done = (dom: HTMLElement): void => click(dom, '.mg-ip__result button[data-focus="done"]');
const panelShown = (dom: HTMLElement): boolean => dom.querySelector<HTMLElement>('.mg-ip__result')?.hidden === false;
const stKind = (dom: HTMLElement): string | undefined => dom.querySelector<HTMLElement>('.mg-ip__bubble')?.dataset.state;
const noMissingKeys = (dom: HTMLElement): void => {
  expect(dom.textContent ?? '').not.toMatch(/\[ui\.|\[ep01\.|\[mini\.|\[st\.|\[ev\./);
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

// ───────────────────────────── чистая логика ─────────────────────────────

describe('parseInterrogation: чтение конфига', () => {
  it('утверждения: contradicted_by строкой или списком (без дублей), requires и press_key; битые отбрасываются', () => {
    const spec = parseInterrogation({
      suspect: 'b',
      statements: [
        { id: 's1', text_key: 'k1', contradicted_by: 'e1', requires: 'v1', press_key: 'p1' },
        { id: 's2', text_key: 'k2', contradicted_by: ['e1', 'e2', 'e1'] },
        { id: 's2', text_key: 'dup', contradicted_by: 'e1' },
        { id: '', text_key: 'k', contradicted_by: 'e1' },
        { id: 's3', contradicted_by: 'e1' },
        null,
        'мусор',
      ],
      evidence: ['e1', 'e2'],
      full_threshold: 2,
      partial_threshold: 1,
      max_mistakes: 2,
    });
    expect(spec.suspect).toBe('b');
    expect(spec.statements).toEqual([
      { id: 's1', textKey: 'k1', contradictedBy: ['e1'], requires: 'v1', pressKey: 'p1' },
      { id: 's2', textKey: 'k2', contradictedBy: ['e1', 'e2'], requires: null, pressKey: null },
    ]);
  });

  it('улики: строка или объект; условие у объекта — своё, у строки — из утверждения', () => {
    const spec = parseInterrogation({
      statements: [
        { id: 's1', text_key: 'k1', contradicted_by: 'e1', requires: 'v1' },
        { id: 's2', text_key: 'k2', contradicted_by: ['e2', 'e3'], requires: 'v2' },
        { id: 's3', text_key: 'k3', contradicted_by: 'e3', requires: 'v3' },
      ],
      evidence: ['e1', { id: 'e2', label_key: 'l2' }, 'e3', { id: 'e4', label_key: 'l4', requires: 'v4' }, 'e1', { id: '' }],
      full_threshold: 1,
      partial_threshold: 1,
      max_mistakes: 3,
    });
    const byId = Object.fromEntries(spec.evidence.map((e) => [e.id, e]));
    expect(Object.keys(byId)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(byId.e1?.requires).toBe('v1'); // строка: единственная улика утверждения s1
    expect(byId.e2?.requires).toBeNull(); // объект без requires — приманка, условие из утверждения не подмешивается
    expect(byId.e2?.labelKey).toBe('l2');
    expect(byId.e3?.requires).toBe('v3'); // единственная улика s3 главнее «первой свободной» в s2
    expect(byId.e4?.requires).toBe('v4');
  });

  it('несколько улик у утверждения: условие достаётся первой из тех, у кого его ещё нет — порядок утверждений не важен', () => {
    const base = {
      evidence: ['ev_keys', 'ev_accomplice'],
      full_threshold: 1,
      partial_threshold: 1,
      max_mistakes: 3,
    };
    const st = (id: string, by: string | string[], requires: string): Record<string, unknown> => ({ id, text_key: id, contradicted_by: by, requires });
    for (const statements of [
      [st('alone', 'ev_accomplice', 'accomplice_talks'), st('keys', ['ev_keys', 'ev_accomplice'], 'keys_found')],
      [st('keys', ['ev_keys', 'ev_accomplice'], 'keys_found'), st('alone', 'ev_accomplice', 'accomplice_talks')],
      [st('keys', ['ev_accomplice', 'ev_keys'], 'keys_found'), st('alone', 'ev_accomplice', 'accomplice_talks')],
    ]) {
      const spec = parseInterrogation({ ...base, statements });
      expect(Object.fromEntries(spec.evidence.map((e) => [e.id, e.requires]))).toEqual({ ev_keys: 'keys_found', ev_accomplice: 'accomplice_talks' });
    }
  });

  it('пороги и лимит ошибок: значения по умолчанию и зажим', () => {
    const statements = [1, 2, 3].map((n) => ({ id: `s${n}`, text_key: `k${n}`, contradicted_by: 'e' }));
    expect(parseInterrogation({ statements, evidence: ['e'] })).toMatchObject({ full: 3, partial: 1, maxMistakes: 3 });
    expect(parseInterrogation({ statements, evidence: ['e'], full_threshold: 9, partial_threshold: 9, max_mistakes: 0 })).toMatchObject({ full: 3, partial: 3, maxMistakes: 1 });
    expect(parseInterrogation({ statements, evidence: ['e'], full_threshold: 2, partial_threshold: 5 })).toMatchObject({ full: 2, partial: 2 });
  });

  it('пустой и мусорный конфиг не бросает', () => {
    for (const cfg of [{}, { statements: 5, evidence: 'x' }, { statements: [null], evidence: [null, 3] }]) {
      expect(() => parseInterrogation(cfg)).not.toThrow();
    }
    expect(parseInterrogation({}).statements).toEqual([]);
  });
});

describe('truthy и interrogationOutcome', () => {
  it('truthy: bool как есть; число — не ноль; строка — не пустая и не none/false/0; нет переменной — ложь', () => {
    expect([true, false, 1, 0, 'full', 'none', 'false', '0', '', undefined].map((v) => truthy(v))).toEqual([true, false, true, false, true, false, false, false, false, false]);
  });

  it('итог: не меньше full — success; не меньше partial — partial; иначе fail', () => {
    expect(interrogationOutcome(3, 3, 1)).toBe('success');
    expect(interrogationOutcome(5, 3, 1)).toBe('success');
    expect(interrogationOutcome(2, 3, 1)).toBe('partial');
    expect(interrogationOutcome(1, 3, 1)).toBe('partial');
    expect(interrogationOutcome(0, 3, 1)).toBe('fail');
  });
});

// ───────────────────────────── разметка и карточки ─────────────────────────────

describe('разметка', () => {
  it('реплика подозреваемого сверху: имя из cast, номер утверждения, текст из локали; точки ошибок — по max_mistakes', () => {
    const { dom, hs } = setup();
    expect(text(dom, '.mg-ip__kicker')).toBe('Допрос');
    expect(text(dom, '.mg-ip__speaker')).toBe('Подозреваемый');
    expect(text(dom, '.mg-ip__count')).toBe('Утверждение 1/4');
    expect(text(dom, '.mg-ip__statement')).toBe('Я был дома.');
    expect(dom.querySelectorAll('.mg-ip__dot')).toHaveLength(3);
    expect(used(dom)).toBe(0);
    expect(dom.querySelectorAll('.mg-ip__pip')).toHaveLength(4);
    expect(dom.querySelector('.mg-ip__pip.is-current')).toBe(dom.querySelectorAll('.mg-ip__pip')[0]);
    expect(hs.dom.classList.contains('mg-host-ip')).toBe(true);
    noMissingKeys(dom);
  });

  it('вступление шага сверху, бриф под «Как играть»; без вступления бриф виден сразу', () => {
    const withIntro = setup(CFG, {}, { introKey: 'mini.intro' });
    expect(text(withIntro.dom, '.mg-ip__intro')).toBe('Он врёт. Докажите.');
    expect(withIntro.dom.querySelector('details.mg-ip__howto .mg-ip__brief')?.textContent).toBe('Предъявите улики.');
    const plain = setup();
    expect(plain.dom.querySelector('details')).toBeNull();
    expect(text(plain.dom, '.mg-ip__brief')).toBe('Предъявите улики.');
  });

  it('карточки — только доступные улики (условие истинно) и приманки, в порядке конфига; недоступные скрыты', () => {
    const { dom } = setup();
    expect(cards(dom)).toEqual(['ev_a', 'ev_decoy', 'ev_b', 'ev_d']); // ev_c недоступна: has_c = false
    expect(text(dom, 'button[data-ev="ev_a"] .mg-ip__label')).toBe('Билет');
    expect(text(dom, 'button[data-ev="ev_decoy"] .mg-ip__label')).toBe('Квитанция');
    expect(text(dom, 'button[data-ev="ev_d"] .mg-ip__label')).toBe('D'); // строкой, без label_key — заглушка из id
    const all = setup(CFG, {}, {}, { ...VARS, has_c: true });
    expect(cards(all.dom)).toEqual(['ev_a', 'ev_decoy', 'ev_b', 'ev_c', 'ev_d']);
    const none = setup(CFG, {}, {}, {});
    expect(cards(none.dom)).toEqual(['ev_decoy']); // только приманка
  });

  it('значение переменной читается как bool, число или строка', () => {
    const { dom } = setup(CFG, {}, {}, { has_a: 1, has_b: 'full', has_c: 'none', has_d: 0 });
    expect(cards(dom)).toEqual(['ev_a', 'ev_decoy', 'ev_b']);
  });

  it('нет доступных улик — сообщение вместо карточек; допрос всё равно можно пройти до конца', () => {
    const { dom, hs } = setup({ ...CFG, evidence: [{ id: 'ev_a', requires: 'has_a' }] }, {}, {}, {});
    expect(dom.querySelectorAll('button.mg-ip__card')).toHaveLength(0);
    expect(text(dom, '.mg-ip__empty')).toBe(REAL_UI['ui.minigame.interrogation.body.no_evidence']);
    for (let i = 0; i < 4; i++) pass(dom);
    expect(panelShown(dom)).toBe(true);
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('без suspect реплика анонимна; неизвестный персонаж — тоже', () => {
    const a = setup({ ...CFG, suspect: undefined });
    expect(a.dom.querySelector<HTMLElement>('.mg-ip__speaker')?.hidden).toBe(true);
    const b = setup({ ...CFG, suspect: 'нет_такого' });
    expect(b.dom.querySelector<HTMLElement>('.mg-ip__speaker')?.hidden).toBe(true);
  });

  it('при большом лимите ошибок точек нет — только число', () => {
    const { dom } = setup({ ...CFG, max_mistakes: 12 });
    expect(dom.querySelectorAll('.mg-ip__dot')).toHaveLength(0);
    expect(text(dom, '.mg-ip__mtext')).toBe('Ошибки: 0 из 12');
  });
});

// ───────────────────────────── ход допроса ─────────────────────────────

describe('верная улика', () => {
  it('«ломает» утверждение: штамп, состояние пузыря, отметка на карточке, «Далее»; автосейв после хода', () => {
    const { dom, hs } = setup();
    present(dom, 'ev_a');
    expect(stKind(dom)).toBe('broken');
    expect(dom.querySelector('.mg-ip__stamp')?.textContent).toBe(REAL_UI['ui.minigame.interrogation.broken']);
    expect(dom.querySelector('.mg-ip__bubble')?.classList.contains('is-broken')).toBe(true);
    expect(card(dom, 'ev_a').classList.contains('is-used')).toBe(true);
    expect(card(dom, 'ev_a').querySelector('.mg-ip__mark.is-ok')).not.toBeNull();
    expect(text(dom, '.mg-ip__feedback')).toBe('Опровергнуто: Билет');
    expect(dom.querySelector('.mg-ip__pip')?.classList.contains('is-broken')).toBe(true);
    expect(used(dom)).toBe(0);
    expect(hs.autosaves).toBe(1);
    // остальные карточки заперты (aria-disabled), кнопка «Оставить без ответа» сменилась на «Далее»
    expect(card(dom, 'ev_decoy').getAttribute('aria-disabled')).toBe('true');
    expect(buttons(dom).filter((b) => b === REAL_UI['ui.common.next'])).toHaveLength(1);
    expect(dom.querySelector('.mg-btn.is-pass')).toBeNull();
    // повторное предъявление уже опровергнутому утверждению ничего не меняет
    present(dom, 'ev_decoy');
    expect(used(dom)).toBe(0);
    expect(hs.autosaves).toBe(1);
  });

  it('«Далее» переходит к следующему утверждению; номер и полоска обновляются', () => {
    const { dom } = setup();
    present(dom, 'ev_a');
    next(dom);
    expect(text(dom, '.mg-ip__count')).toBe('Утверждение 2/4');
    expect(text(dom, '.mg-ip__statement')).toBe('Я никого не знаю.');
    expect(stKind(dom)).toBe('open');
    expect(dom.querySelectorAll('.mg-ip__pip')[1]?.classList.contains('is-current')).toBe(true);
    expect(text(dom, '.mg-ip__feedback')).toBe('');
  });

  it('несколько эквивалентных улик: любая из contradicted_by опровергает; улика не расходуется и годится для других утверждений', () => {
    const { dom } = setup(CFG, {}, {}, { ...VARS, has_c: true });
    present(dom, 'ev_a'); // s1
    next(dom);
    pass(dom); // s2 оставили
    expect(text(dom, '.mg-ip__statement')).toBe('Ключей у меня нет.');
    present(dom, 'ev_a'); // s3: ev_a — альтернатива ev_c
    expect(stKind(dom)).toBe('broken');
    expect(card(dom, 'ev_a').classList.contains('is-used')).toBe(true);
  });

  it('цифры 1…9 предъявляют карточку по номеру; лишние и пустые номера игнорируются', () => {
    const { dom } = setup();
    const key = (k: string): void => {
      dom.querySelector('.mg-ip')?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };
    key('9');
    key('0');
    key('x');
    expect(used(dom)).toBe(0);
    key('2'); // ev_decoy — неверная
    expect(used(dom)).toBe(1);
    key('1'); // ev_a — верная для s1
    expect(stKind(dom)).toBe('broken');
  });
});

describe('неверная улика', () => {
  it('ошибка: точка загорается, пузырь трясётся, карточка гаснет для этого утверждения (aria-disabled и ✕), в подсказке — реплика', () => {
    const { dom, hs } = setup();
    present(dom, 'ev_decoy');
    expect(used(dom)).toBe(1);
    expect(dom.querySelector('.mg-ip__bubble')?.classList.contains('is-shake')).toBe(true);
    expect(card(dom, 'ev_decoy').classList.contains('is-wrong')).toBe(true);
    expect(card(dom, 'ev_decoy').getAttribute('aria-disabled')).toBe('true');
    expect(card(dom, 'ev_decoy').querySelector('.mg-ip__mark')).not.toBeNull();
    expect(card(dom, 'ev_decoy').getAttribute('aria-label')).toBe('Не подошло: Квитанция');
    expect(text(dom, '.mg-ip__feedback')).toBe(REAL_UI['ui.minigame.interrogation.body.wrong']);
    expect(stKind(dom)).toBe('open');
    expect(hs.autosaves).toBe(1);
    // повторный тап по той же карточке — не вторая ошибка
    present(dom, 'ev_decoy');
    expect(used(dom)).toBe(1);
    expect(hs.autosaves).toBe(1);
    // но для следующего утверждения карточка снова годится для попытки
    pass(dom);
    expect(card(dom, 'ev_decoy').classList.contains('is-wrong')).toBe(false);
  });

  it('ошибка не закрывает утверждение: можно предъявить верную улику и сломать его', () => {
    const { dom } = setup();
    present(dom, 'ev_b');
    present(dom, 'ev_a');
    expect(stKind(dom)).toBe('broken');
    expect(used(dom)).toBe(1);
  });

  it('max_mistakes ошибок обрывают допрос: «он замолчал», итог по числу опровергнутых', () => {
    const { dom, hs } = setup();
    present(dom, 'ev_a');
    next(dom); // s2
    present(dom, 'ev_a');
    present(dom, 'ev_decoy');
    expect(panelShown(dom)).toBe(false);
    present(dom, 'ev_d'); // третья ошибка
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-ip__feedback')).toBe(REAL_UI['ui.minigame.interrogation.body.silenced']);
    expect(text(dom, '.mg-ip__verdict')).toBe(REAL_UI['ui.minigame.partial']); // 1 из 4 при partial_threshold = 1
    expect(text(dom, '.mg-ip__summary')).toBe('Опровергнуто утверждений: 1 из 4. Ошибок: 3.');
    expect(used(dom)).toBe(3);
    expect(hs.results).toEqual([]);
    done(dom);
    done(dom);
    expect(hs.results).toEqual(['partial']);
    noMissingKeys(dom);
  });

  it('после конца допроса карточки заперты и ввод не принимается', () => {
    const { dom } = setup();
    present(dom, 'ev_decoy');
    present(dom, 'ev_b');
    present(dom, 'ev_d');
    expect(panelShown(dom)).toBe(true);
    expect(card(dom, 'ev_a').getAttribute('aria-disabled')).toBe('true');
    present(dom, 'ev_a');
    expect(stKind(dom)).toBe('open');
    expect(text(dom, '.mg-ip__verdict')).toBe(REAL_UI['ui.minigame.fail']); // ничего не опровергнуто
  });
});

describe('«Оставить без ответа» и «Надавить»', () => {
  it('оставленное утверждение помечается и не считается опровергнутым; последнее оставленное завершает допрос', () => {
    const { dom, hs } = setup();
    pass(dom);
    expect(text(dom, '.mg-ip__count')).toBe('Утверждение 2/4');
    expect(dom.querySelectorAll('.mg-ip__pip')[0]?.classList.contains('is-passed')).toBe(true);
    pass(dom);
    pass(dom);
    expect(panelShown(dom)).toBe(false);
    pass(dom); // четвёртое
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-ip__verdict')).toBe(REAL_UI['ui.minigame.fail']);
    expect(text(dom, '.mg-ip__summary')).toBe('Опровергнуто утверждений: 0 из 4. Ошибок: 0.');
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('«Надавить» есть только у утверждений с press_key; ответ подозреваемого без ошибки; кнопка исчезает после нажатия', () => {
    const { dom, hs } = setup();
    expect(buttons(dom).includes(REAL_UI['ui.minigame.interrogation.press'] as string)).toBe(false); // s1: press_key нет
    pass(dom);
    expect(buttons(dom)).toContain(REAL_UI['ui.minigame.interrogation.press']);
    const before = hs.autosaves;
    click(dom, '.mg-btn.is-press');
    expect(text(dom, '.mg-ip__press')).toBe('Ну, может, видел раз.');
    expect(used(dom)).toBe(0);
    expect(hs.autosaves).toBe(before + 1);
    expect(dom.querySelector('.mg-btn.is-press')).toBeNull();
    expect(stKind(dom)).toBe('open'); // давление не закрывает утверждение
    present(dom, 'ev_b');
    expect(stKind(dom)).toBe('broken');
    expect(text(dom, '.mg-ip__press')).toBe('Ну, может, видел раз.'); // ответ остаётся
  });

  it('нажатие «Надавить» запоминается в сохранении и возвращается после загрузки', () => {
    const a = setup();
    pass(a.dom);
    click(a.dom, '.mg-btn.is-press');
    const b = setup();
    b.m.restore(JSON.parse(JSON.stringify(a.m.serialize())));
    expect(text(b.dom, '.mg-ip__press')).toBe('Ну, может, видел раз.');
    expect(b.dom.querySelector('.mg-btn.is-press')).toBeNull();
  });
});

describe('исходы по порогам', () => {
  const playAll = (dom: HTMLElement, answers: Array<string | null>): void => {
    for (const ev of answers) {
      if (ev === null) pass(dom);
      else {
        present(dom, ev);
        if (!panelShown(dom)) next(dom);
      }
    }
  };

  it('опровергнуто не меньше full_threshold → success; последнее утверждение сразу даёт итог', () => {
    const { dom, hs } = setup(CFG, {}, {}, { ...VARS, has_c: true });
    playAll(dom, ['ev_a', 'ev_b']); // два опровергнуто, третье впереди
    expect(panelShown(dom)).toBe(false);
    present(dom, 'ev_c'); // третье утверждение
    expect(panelShown(dom)).toBe(false); // допрос продолжается до конца (одно утверждение осталось)
    next(dom);
    present(dom, 'ev_d'); // последнее — итог без лишнего «Далее»
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-ip__verdict')).toBe(REAL_UI['ui.minigame.success']);
    expect(text(dom, '.mg-ip__summary')).toBe('Опровергнуто утверждений: 4 из 4. Ошибок: 0.');
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('три из четырёх (порог full = 3) — всё ещё success', () => {
    const { dom, hs } = setup(CFG, {}, {}, { ...VARS, has_c: true });
    playAll(dom, ['ev_a', 'ev_b', 'ev_c', null]);
    expect(panelShown(dom)).toBe(true);
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('меньше full, но не меньше partial → partial', () => {
    const { dom, hs } = setup();
    playAll(dom, ['ev_a', null, null, null]);
    done(dom);
    expect(hs.results).toEqual(['partial']);
  });

  it('меньше partial_threshold → fail', () => {
    const { dom, hs } = setup({ ...CFG, partial_threshold: 2 });
    playAll(dom, ['ev_a', null, null, null]);
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('пороги больше числа утверждений зажимаются: безупречный допрос всё равно success', () => {
    const { dom, hs } = setup({ ...CFG, full_threshold: 10 }, {}, {}, { ...VARS, has_c: true });
    playAll(dom, ['ev_a', 'ev_b', 'ev_c', 'ev_d']);
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('результат не зависит от ошибок, если лимит не исчерпан', () => {
    const { dom, hs } = setup(CFG, {}, {}, { ...VARS, has_c: true });
    present(dom, 'ev_decoy'); // 1 ошибка
    playAll(dom, ['ev_a', 'ev_b', 'ev_c', 'ev_d']);
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('config без утверждений превращается в grey-box с предупреждением; результат пробрасывается, пауза и сохранение делегируются', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const cfg of [{ statements: [], evidence: ['e'], full_threshold: 1, partial_threshold: 1, max_mistakes: 3 }, {}]) {
      const { dom, hs, m } = setup(cfg);
      expect(dom.querySelector('.mg-gb')).not.toBeNull();
      expect(dom.querySelector('.mg-ip')).toBeNull();
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('config непригоден для interrogation_press'));
      m.pause();
      m.resume();
      m.restore({ hintsShown: 0 });
      expect(m.serialize()).toEqual({ hintsShown: 0 });
      dom.querySelector<HTMLButtonElement>('.mg-btn.is-fail')?.click();
      expect(hs.results).toEqual(['fail']);
      m.destroy();
      expect(dom.querySelector('.mg-gb')).toBeNull();
    }
    warn.mockRestore();
  });
});

describe('пропуск', () => {
  it('кнопка появляется после skip.after_fails ошибок; в режиме «только история» — сразу и выделена', () => {
    const { dom } = setup(CFG, { skip: { allowed: true, after_fails: 2 } });
    expect(buttons(dom)).not.toContain(REAL_UI['ui.minigame.skip']);
    present(dom, 'ev_decoy');
    expect(buttons(dom)).not.toContain(REAL_UI['ui.minigame.skip']);
    present(dom, 'ev_b');
    expect(buttons(dom)).toContain(REAL_UI['ui.minigame.skip']);

    const story = setup(CFG, { skip: { allowed: true, after_fails: 2 } }, { settings: { timers: false, storyOnly: true } });
    expect(buttons(story.dom)).toContain(REAL_UI['ui.minigame.skip']);
    expect(story.dom.querySelector('.is-skip')?.classList.contains('is-primary')).toBe(true);
  });

  it('after_fails не задан — кнопка сразу; skip.allowed=false — никогда', () => {
    expect(buttons(setup(CFG, { skip: { allowed: true } }).dom)).toContain(REAL_UI['ui.minigame.skip']);
    const off = setup(CFG, { skip: { allowed: false } }, { settings: { timers: false, storyOnly: true } });
    expect(off.dom.querySelector('.is-skip')).toBeNull();
    present(off.dom, 'ev_decoy');
    expect(off.dom.querySelector('.is-skip')).toBeNull();
  });

  it('пропуск отдаёт skipped сразу и ровно один раз; после него допрос неактивен', () => {
    const { dom, hs } = setup(CFG, { skip: { allowed: true } });
    const skip = dom.querySelector<HTMLButtonElement>('.is-skip');
    skip?.click();
    skip?.click();
    present(dom, 'ev_a');
    expect(hs.results).toEqual(['skipped']);
    expect(stKind(dom)).toBe('open');
  });

  it('после итога кнопки пропуска нет', () => {
    const { dom, hs } = setup(CFG, { skip: { allowed: true } });
    present(dom, 'ev_decoy');
    present(dom, 'ev_b');
    present(dom, 'ev_d');
    expect(dom.querySelector('.is-skip')).toBeNull();
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });
});

describe('подсказка за rewarded-рекламу', () => {
  const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };

  it('кнопка есть только при hint_rewarded_ad и поддержке платформой, и только пока утверждение открыто', () => {
    const ok = (): Promise<boolean> => Promise.resolve(true);
    expect(buttons(setup(CFG, withAd, { showRewarded: ok }).dom)).toContain(REAL_UI['ui.minigame.hint_ad']);
    expect(buttons(setup(CFG, withAd).dom)).not.toContain(REAL_UI['ui.minigame.hint_ad']);
    expect(buttons(setup(CFG, { skip: { allowed: true } }, { showRewarded: ok }).dom)).not.toContain(REAL_UI['ui.minigame.hint_ad']);
    const { dom } = setup(CFG, withAd, { showRewarded: ok });
    present(dom, 'ev_a');
    expect(buttons(dom)).not.toContain(REAL_UI['ui.minigame.hint_ad']);
  });

  it('подсказка подсвечивает карточку, опровергающую текущее утверждение; один раз на утверждение; автосейв и телеметрия', async () => {
    const showRewarded = vi.fn(() => Promise.resolve(true));
    const { dom, hs, m } = setup(CFG, withAd, { showRewarded });
    click(dom, '.mg-btn.is-hint');
    await vi.waitFor(() => expect(card(dom, 'ev_a').classList.contains('is-hint')).toBe(true));
    expect(text(dom, '.mg-ip__feedback')).toBe('Подсказка: подойдёт «Билет».');
    expect(hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]);
    expect(hs.autosaves).toBe(1);
    expect(dom.querySelector('.mg-btn.is-hint')).toBeNull(); // на это утверждение подсказка уже была
    expect(m.serialize()).toMatchObject({ hinted: ['s1'] });
    present(dom, 'ev_a');
    next(dom);
    expect(dom.querySelector('.mg-btn.is-hint')).not.toBeNull(); // новое утверждение — новая подсказка
  });

  it('если подходящей улики у игрока нет — подсказка честно об этом говорит', async () => {
    const { dom } = setup(CFG, withAd, { showRewarded: () => Promise.resolve(true) }, { ...VARS, has_d: false });
    pass(dom);
    pass(dom);
    pass(dom); // s4: улика ev_d недоступна
    expect(text(dom, '.mg-ip__statement')).toBe('Машина не моя.');
    click(dom, '.mg-btn.is-hint');
    await vi.waitFor(() => expect(text(dom, '.mg-ip__feedback')).toBe(REAL_UI['ui.minigame.interrogation.body.hint_none']));
    expect(dom.querySelector('.mg-ip__card.is-hint')).toBeNull();
  });

  it('реклама не показана или бросила ошибку — подсказки нет, автосейва нет, событие в телеметрии есть; пока реклама идёт, кнопка недоступна', async () => {
    const no = setup(CFG, withAd, { showRewarded: () => Promise.resolve(false) });
    click(no.dom, '.mg-btn.is-hint');
    await vi.waitFor(() => expect(no.hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(no.dom.querySelector('.mg-ip__card.is-hint')).toBeNull();
    expect(no.hs.autosaves).toBe(0);

    const bad = setup(CFG, withAd, { showRewarded: () => Promise.reject(new Error('ad')) });
    click(bad.dom, '.mg-btn.is-hint');
    await vi.waitFor(() => expect(bad.hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));

    let resolveAd: (ok: boolean) => void = () => undefined;
    const showRewarded = vi.fn(() => new Promise<boolean>((r) => (resolveAd = r)));
    const busy = setup(CFG, withAd, { showRewarded });
    click(busy.dom, '.mg-btn.is-hint');
    expect(busy.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.disabled).toBe(true);
    busy.dom.querySelector<HTMLButtonElement>('.mg-btn.is-hint')?.click();
    expect(showRewarded).toHaveBeenCalledTimes(1);
    resolveAd(true);
    await vi.waitFor(() => expect(busy.dom.querySelector('.mg-ip__card.is-hint')).not.toBeNull());
  });

  it('мини-игра закрыта, пока шла реклама: DOM не трогается, автосейва нет', async () => {
    let resolveAd: (ok: boolean) => void = () => undefined;
    const late = setup(CFG, withAd, { showRewarded: () => new Promise<boolean>((r) => (resolveAd = r)) });
    click(late.dom, '.mg-btn.is-hint');
    late.m.destroy();
    resolveAd(true);
    await vi.waitFor(() => expect(late.hs.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]));
    expect(late.dom.querySelector('.mg-ip')).toBeNull();
    expect(late.hs.autosaves).toBe(0);
  });
});

describe('таймер (def.time_limit_ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('есть лимит и таймеры включены: полоска времени; время вышло → итог по опровергнутым и пометка «Время вышло»', () => {
    const { dom, hs } = setup(CFG, { time_limit_ms: 10_000 });
    expect(dom.querySelector('.mg-ip__time')).not.toBeNull();
    present(dom, 'ev_a');
    vi.advanceTimersByTime(9_000);
    expect(panelShown(dom)).toBe(false);
    expect(dom.querySelector('.mg-ip__time')?.getAttribute('aria-valuetext')).toMatch(/^Осталось: 0:0[1-9]$/);
    vi.advanceTimersByTime(1_500);
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-ip__verdict')).toBe(REAL_UI['ui.minigame.partial']);
    expect(text(dom, '.mg-ip__why')).toBe(REAL_UI['ui.minigame.time_up']);
    done(dom);
    expect(hs.results).toEqual(['partial']);
  });

  it('таймеры выключены в настройках или режим «только история» — таймера нет; без time_limit_ms — тоже', () => {
    for (const settings of [{ timers: false, storyOnly: false }, { timers: false, storyOnly: true }, { timers: true, storyOnly: true }]) {
      const { dom } = setup(CFG, { time_limit_ms: 3_000 }, { settings });
      expect(dom.querySelector('.mg-ip__time')).toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(panelShown(dom)).toBe(false);
    }
    const plain = setup();
    expect(plain.dom.querySelector('.mg-ip__time')).toBeNull();
    expect(plain.m.serialize()).toMatchObject({ left: null });
  });

  it('пауза замораживает время и ввод; resume продолжает; остаток возвращается через restore', () => {
    const { dom, m } = setup(CFG, { time_limit_ms: 10_000 });
    vi.advanceTimersByTime(4_000);
    m.pause();
    vi.advanceTimersByTime(60_000);
    expect(panelShown(dom)).toBe(false);
    const state = JSON.parse(JSON.stringify(m.serialize())) as { left: number };
    expect(state.left).toBeGreaterThan(5_500);
    expect(state.left).toBeLessThanOrEqual(6_000);
    present(dom, 'ev_a'); // на паузе ввод не принимается
    expect(stKind(dom)).toBe('open');
    m.resume();
    vi.advanceTimersByTime(5_000);
    expect(panelShown(dom)).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(panelShown(dom)).toBe(true);

    const b = setup(CFG, { time_limit_ms: 10_000 });
    b.m.restore({ ...state, left: 1_000 });
    vi.advanceTimersByTime(800);
    expect(panelShown(b.dom)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(panelShown(b.dom)).toBe(true);
  });
});

describe('serialize / restore: автосейв внутри мини-игры', () => {
  it('прогресс допроса возвращается после загрузки: текущее утверждение, опровергнутые и оставленные, ошибки, подсказки', async () => {
    const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };
    const a = setup(CFG, withAd, { showRewarded: () => Promise.resolve(true) });
    present(a.dom, 'ev_decoy'); // ошибка на s1
    present(a.dom, 'ev_a'); // s1 опровергнуто
    next(a.dom);
    pass(a.dom); // s2 оставлено
    click(a.dom, '.mg-btn.is-hint');
    await vi.waitFor(() => expect(text(a.dom, '.mg-ip__feedback')).toContain('Подсказка'));
    const state = JSON.parse(JSON.stringify(a.m.serialize())) as Record<string, unknown>;
    expect(state).toMatchObject({
      v: 1,
      index: 2,
      broken: [['s1', 'ev_a']],
      passed: ['s2'],
      wrong: ['s1|ev_decoy'],
      hinted: ['s3'],
      result: null,
    });

    const b = setup(CFG, withAd, { showRewarded: () => Promise.resolve(true) });
    b.m.restore(state);
    expect(text(b.dom, '.mg-ip__count')).toBe('Утверждение 3/4');
    expect(text(b.dom, '.mg-ip__statement')).toBe('Ключей у меня нет.');
    expect(used(b.dom)).toBe(1);
    const pips = [...b.dom.querySelectorAll('.mg-ip__pip')].map((p) => p.className);
    expect(pips[0]).toContain('is-broken');
    expect(pips[1]).toContain('is-passed');
    expect(pips[2]).toContain('is-current');
    expect(b.m.serialize()).toEqual(a.m.serialize());
    // игра продолжается с того же места
    present(b.dom, 'ev_a'); // s3: ev_a — альтернатива
    expect(stKind(b.dom)).toBe('broken');
  });

  it('карточка, заведомо неверная для утверждения, остаётся серой после загрузки', () => {
    const a = setup();
    present(a.dom, 'ev_decoy');
    const b = setup();
    b.m.restore(JSON.parse(JSON.stringify(a.m.serialize())));
    expect(card(b.dom, 'ev_decoy').classList.contains('is-wrong')).toBe(true);
    present(b.dom, 'ev_decoy');
    expect(used(b.dom)).toBe(1);
  });

  it('сохранение на итоговой панели снова показывает итог; «Далее» отдаёт результат один раз', () => {
    const a = setup();
    present(a.dom, 'ev_decoy');
    present(a.dom, 'ev_b');
    present(a.dom, 'ev_d');
    const state = JSON.parse(JSON.stringify(a.m.serialize()));
    const b = setup();
    b.m.restore(state);
    expect(panelShown(b.dom)).toBe(true);
    expect(text(b.dom, '.mg-ip__verdict')).toBe(REAL_UI['ui.minigame.fail']);
    expect(b.hs.results).toEqual([]);
    done(b.dom);
    done(b.dom);
    expect(b.hs.results).toEqual(['fail']);
  });

  it('мусор в состоянии игнорируется: ни исключений, ни порчи текущей партии', () => {
    const { dom, m } = setup();
    present(dom, 'ev_a');
    const before = JSON.stringify(m.serialize());
    for (const junk of ['мусор', null, undefined, 42, [], { broken: 'x', passed: 5, wrong: {}, pressed: 1, hinted: null, index: 'x', left: 'y', result: 'win' }]) {
      expect(() => m.restore(junk)).not.toThrow();
    }
    expect(JSON.stringify(m.serialize())).toBe(before);
    // битые элементы отбрасываются, индекс зажимается
    m.restore({ broken: [['s1', 'ev_a'], ['zzz', 'ev_a'], ['s2', 'нет'], 5, ['s3']], passed: ['s1', 's2', 'zzz', 7], wrong: ['s1|ev_decoy', 'zzz|ev_a', 's1|нет', 'мусор'], index: 99 });
    expect(m.serialize()).toMatchObject({ index: 3, broken: [['s1', 'ev_a']], passed: ['s2'], wrong: ['s1|ev_decoy'] });
    m.restore({ index: -4 });
    expect(m.serialize()).toMatchObject({ index: 0 });
  });
});

describe('пауза, язык, destroy', () => {
  it('на паузе (реклама, вкладка в фоне) ввод не засчитывается; после resume — работает', () => {
    const { dom, m, hs } = setup(CFG, { skip: { allowed: true } });
    m.pause();
    expect(dom.querySelector('.mg-ip')?.classList.contains('is-paused')).toBe(true);
    present(dom, 'ev_a');
    pass(dom);
    dom.querySelector<HTMLButtonElement>('.is-skip')?.click();
    expect(stKind(dom)).toBe('open');
    expect(text(dom, '.mg-ip__count')).toBe('Утверждение 1/4');
    expect(hs.results).toEqual([]);
    m.resume();
    present(dom, 'ev_a');
    expect(stKind(dom)).toBe('broken');
  });

  it('«Далее» на итоговой панели на паузе не засчитывается', () => {
    const { dom, m, hs } = setup();
    for (let i = 0; i < 4; i++) pass(dom);
    m.pause();
    done(dom);
    expect(hs.results).toEqual([]);
    m.resume();
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('смена языка перерисовывает реплику, имя, карточки и подписи на лету, не теряя прогресс и ошибки', () => {
    const { dom, hs } = setup(CFG, {}, { introKey: 'mini.intro' });
    present(dom, 'ev_decoy');
    present(dom, 'ev_a');
    next(dom);
    hs.setStrings({
      ...STRINGS,
      'mini.m1.title': 'Interrogation',
      'mini.cast.b': 'Suspect',
      'st.2': 'I know nobody.',
      'ev.a': 'Ticket',
      'ui.minigame.interrogation.statement': 'Statement {n}/{total}',
      'ui.minigame.interrogation.pass': 'Leave it',
    });
    hs.fireLanguageChange();
    expect(text(dom, '.mg-ip__kicker')).toBe('Interrogation');
    expect(text(dom, '.mg-ip__speaker')).toBe('Suspect');
    expect(text(dom, '.mg-ip__statement')).toBe('I know nobody.');
    expect(text(dom, '.mg-ip__count')).toBe('Statement 2/4');
    expect(text(dom, 'button[data-ev="ev_a"] .mg-ip__label')).toBe('Ticket');
    expect(buttons(dom)).toContain('Leave it');
    expect(used(dom)).toBe(1);
    expect(dom.querySelector('.mg-ip__pip')?.classList.contains('is-broken')).toBe(true);
  });

  it('destroy убирает разметку и класс контейнера, отписывается от языка, гасит таймер и безопасен при повторном вызове', () => {
    vi.useFakeTimers();
    const { dom, hs, m } = setup(CFG, { time_limit_ms: 5_000 });
    expect(hs.listenerCount()).toBe(1);
    m.destroy();
    expect(dom.querySelector('.mg-ip')).toBeNull();
    expect(dom.classList.contains('mg-host-ip')).toBe(false);
    expect(hs.listenerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(hs.results).toEqual([]);
    expect(hs.autosaves).toBe(0);
    expect(() => {
      m.destroy();
      m.pause();
      m.resume();
      m.restore({ index: 1 });
      hs.fireLanguageChange();
    }).not.toThrow();
  });

  it('хост вызывает destroy прямо внутри onResult — повторные нажатия ничего не ломают', () => {
    const hs = harness(defOf());
    const m = createInterrogationPress();
    m.onResult = (r) => {
      hs.results.push(r);
      m.destroy();
    };
    m.mount(null as never, hs.dom, CFG, hs.ctx);
    for (let i = 0; i < 4; i++) pass(hs.dom);
    done(hs.dom);
    expect(hs.results).toEqual(['fail']);
    expect(hs.dom.querySelector('.mg-ip')).toBeNull();
  });
});

describe('доступность', () => {
  it('точки ошибок — img с подписью; заперты через aria-disabled (фокус не теряется); реплика обратной связи — живая область', () => {
    const { dom } = setup();
    expect(dom.querySelector('.mg-ip__lives')?.getAttribute('role')).toBe('img');
    expect(dom.querySelector('.mg-ip__lives')?.getAttribute('aria-label')).toBe('Ошибки: 0 из 3');
    expect(dom.querySelector('.mg-ip__feedback')?.getAttribute('role')).toBe('status');
    card(dom, 'ev_decoy').focus();
    present(dom, 'ev_decoy');
    expect(document.activeElement).toBe(card(dom, 'ev_decoy')); // карточка осталась в фокусе, хоть и погасла
    expect(card(dom, 'ev_decoy').disabled).toBe(false);
    expect(card(dom, 'ev_decoy').getAttribute('aria-disabled')).toBe('true');
  });

  it('полоска утверждений подписана; штамп и отметки различаются формой, а не только цветом', () => {
    const { dom } = setup();
    present(dom, 'ev_decoy');
    present(dom, 'ev_a');
    expect(dom.querySelector('.mg-ip__pip')?.getAttribute('aria-label')).toBe('Утверждение 1/4: Опровергнуто');
    const bad = card(dom, 'ev_decoy').querySelector('.mg-ip__mark path')?.getAttribute('d');
    const ok = card(dom, 'ev_a').querySelector('.mg-ip__mark path')?.getAttribute('d');
    expect(bad).toBeTruthy();
    expect(ok).toBeTruthy();
    expect(bad).not.toBe(ok);
  });
});

// ───────────────────────────── настоящий ep01 ─────────────────────────────

describe.skipIf(!hasRepoContent())('mg_interrogation из ep01 на настоящих локалях', () => {
  const episode = loadEpisode(EP01_PATH);
  const def = episode.minigames?.mg_interrogation as MinigameDef;
  const ru = loadStrings('ru', episode.id);
  const ALL = { docs_flaw: true, accomplice_talks: true, found_chain: true, found_photo: true, keys_found: true };

  const mountReal = (vars: Record<string, Value>, over: Partial<GameContext> = {}): { m: IMinigame; hs: Harness; dom: HTMLElement } => {
    const hs = harness(def, { episode, introKey: 'ep01.mg_interrogation.intro', ...over }, vars);
    hs.setStrings(ru);
    const m = createInterrogationPress();
    m.onResult = (r) => hs.results.push(r);
    m.mount(null as never, hs.dom, def.config, hs.ctx);
    return { m, hs, dom: hs.dom };
  };
  /** Правильные улики для пяти утверждений ep01 по порядку. */
  const SOLUTION = ['ev_docs_flaw', 'ev_accomplice', 'ev_chain', 'ev_photo', 'ev_keys'];

  it('конфиг читается: пять утверждений, семь карточек (пять улик + две приманки), условия у всех настоящих улик', () => {
    const spec = parseInterrogation(def.config);
    expect(spec.statements).toHaveLength(5);
    expect(spec.evidence).toHaveLength(7);
    const gated = spec.evidence.filter((e) => e.requires !== null).map((e) => e.id);
    expect(gated.sort()).toEqual([...SOLUTION].sort());
    expect(spec.evidence.filter((e) => e.requires === null)).toHaveLength(2); // приманки
    for (const st of spec.statements) {
      expect(ru[st.textKey], st.textKey).toBeTruthy();
      for (const ev of st.contradictedBy) expect(spec.evidence.some((e) => e.id === ev), `${st.id}: ${ev}`).toBe(true);
    }
    for (const ev of spec.evidence) expect(ru[ev.labelKey as string], ev.id).toBeTruthy();
    // приманки не опровергают ни одного утверждения
    for (const ev of spec.evidence.filter((e) => e.requires === null)) {
      expect(spec.statements.some((s) => s.contradictedBy.includes(ev.id)), ev.id).toBe(false);
    }
    // условия улик — объявленные переменные эпизода
    for (const ev of spec.evidence) if (ev.requires) expect(Object.keys(episode.variables), ev.id).toContain(ev.requires);
  });

  it('при всех найденных уликах: карточки — все семь, имя подозреваемого из cast, штампы по порядку → success', () => {
    const { dom, hs } = mountReal(ALL);
    expect(cards(dom)).toHaveLength(7);
    expect(text(dom, '.mg-ip__speaker')).toBe(ru['ep01.cast.murashov']);
    expect(text(dom, '.mg-ip__statement')).toBe(ru['ep01.mg_interrogation.st.dates']);
    expect(text(dom, '.mg-ip__intro')).toBe(ru['ep01.mg_interrogation.intro']);
    noMissingKeys(dom);
    SOLUTION.forEach((ev, i) => {
      present(dom, ev);
      expect(stKind(dom), `утверждение ${i + 1}`).toBe('broken');
      if (i < SOLUTION.length - 1) next(dom);
    });
    expect(panelShown(dom)).toBe(true);
    expect(text(dom, '.mg-ip__verdict')).toBe(ru['ui.minigame.success']);
    expect(text(dom, '.mg-ip__summary')).toBe('Опровергнуто утверждений: 5 из 5. Ошибок: 0.');
    done(dom);
    expect(hs.results).toEqual(['success']);
  });

  it('без найденных улик остаются только приманки: утверждения неопровержимы, три ошибки → fail', () => {
    const { dom, hs } = mountReal({});
    expect(cards(dom).sort()).toEqual(['ev_registration', 'ev_volga']);
    present(dom, 'ev_registration');
    present(dom, 'ev_volga');
    expect(used(dom)).toBe(2);
    pass(dom);
    present(dom, 'ev_registration');
    expect(panelShown(dom)).toBe(true); // третья ошибка
    done(dom);
    expect(hs.results).toEqual(['fail']);
  });

  it('две найденные улики (фото и документ): опровергнуто 2 при full 3 и partial 1 → partial', () => {
    const { dom, hs } = mountReal({ found_photo: true, docs_flaw: true });
    expect(cards(dom).sort()).toEqual(['ev_docs_flaw', 'ev_photo', 'ev_registration', 'ev_volga'].sort());
    present(dom, 'ev_docs_flaw'); // st_dates
    next(dom);
    pass(dom); // st_alone — улики нет
    pass(dom); // st_once — улики нет
    present(dom, 'ev_photo'); // st_south
    next(dom);
    pass(dom); // st_keys
    expect(panelShown(dom)).toBe(true);
    done(dom);
    expect(hs.results).toEqual(['partial']);
  });

  it('st_keys опровергается и показаниями сообщника (ev_accomplice), когда связки ключей нет', () => {
    const { dom } = mountReal({ accomplice_talks: true });
    expect(cards(dom)).not.toContain('ev_keys');
    for (let i = 0; i < 4; i++) pass(dom); // до st_keys
    expect(text(dom, '.mg-ip__statement')).toBe(ru['ep01.mg_interrogation.st.keys']);
    present(dom, 'ev_accomplice');
    expect(stKind(dom)).toBe('broken');
    expect(used(dom)).toBe(0);
  });

  it('пропуск доступен после skip.after_fails ошибок; ошибка не мешает потом сломать утверждение', () => {
    const { dom } = mountReal(ALL);
    const after = def.skip.after_fails ?? 0;
    expect(def.skip.allowed).toBe(true);
    expect(after).toBeGreaterThan(0);
    expect(dom.querySelector('.is-skip')).toBeNull();
    present(dom, 'ev_registration');
    expect(dom.querySelector('.is-skip') === null).toBe(after > 1);
    present(dom, 'ev_volga');
    expect(dom.querySelector('.is-skip')).not.toBeNull();
    present(dom, 'ev_docs_flaw');
    expect(stKind(dom)).toBe('broken');
  });
});
