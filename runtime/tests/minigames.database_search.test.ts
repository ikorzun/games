// @vitest-environment jsdom
/**
 * Поиск по картотеке (database_search): разбор config, детерминированная колода, фильтры-чипы, отбор и проверка
 * карточек, исходы по порогам, правила пропуска и подсказок, таймер, пауза, serialize / restore, смена языка.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeck, createDatabaseSearch, formatDate, parseDbConfig, TYPE } from '../src/minigames/database_search';
import type { DbCard } from '../src/minigames/database_search';
import { hashString } from '../src/minigames/mg_shell';
import { createMinigame, registerBuiltinMinigames } from '../src/minigames/registry';
import type { GameContext } from '../src/minigames/types';
import { EP01_PATH, hasRepoContent, loadEpisode, loadStrings } from './helpers/content';
import { btn, click, defOf, mountGame, press, q, rig, texts, UI } from './helpers/mg_kit';
import type { Rig } from './helpers/mg_kit';

const STRINGS: Record<string, string> = {
  ...UI,
  'mini.m1.title': 'Картотека БТИ',
  'mini.m1.brief': 'Отберите карточки',
  'mini.intro': 'Найдите повторы',
  'f.address': 'Адрес',
  'f.notary': 'Нотариус',
  'f.attorney': 'Представитель',
  'f.buyer': 'Покупатель',
  'f.date': 'Дата',
  'v.addr.a1': 'Первая ул., кв. {n}',
  'v.addr.a2': 'Вторая ул., кв. {n}',
  'v.addr.a3': 'Третья ул., кв. {n}',
  'v.notary.kov': 'Ковригин А. Н.',
  'v.notary.leb': 'Лебедева Т. И.',
  'v.notary.ost': 'Островский М. Б.',
  'v.att.mur': 'Мурашов С. В.',
  'v.att.gav': 'Гаврилов Ю. А.',
  'v.att.tik': 'Тихонова Л. Д.',
  'v.buyer.b1': 'Лапин',
  'v.buyer.b2': 'Соколов',
  'v.buyer.b3': 'Беляев',
  'v.buyer.b4': 'Фёдорова',
};

const opts = (ids: string[], prefix: string): Array<{ id: string; text_key: string }> => ids.map((id) => ({ id, text_key: `${prefix}.${id}` }));

const CFG = {
  fields: ['address', 'notary', 'attorney', 'buyer', 'date'],
  values: [
    { field: 'address', label_key: 'f.address', filter: false, options: [{ id: 'a1', text_key: 'v.addr.a1' }, { id: 'a2', text_key: 'v.addr.a2' }, { id: 'a3', text_key: 'v.addr.a3' }] },
    { field: 'notary', label_key: 'f.notary', options: opts(['kov', 'leb', 'ost'], 'v.notary') },
    { field: 'attorney', label_key: 'f.attorney', options: [{ id: 'mur', text_key: 'v.att.mur' }, { id: 'gav', text_key: 'v.att.gav' }, { id: 'tik', text_key: 'v.att.tik' }] },
    { field: 'buyer', label_key: 'f.buyer', options: opts(['b1', 'b2', 'b3', 'b4'], 'v.buyer') },
    { field: 'date', label_key: 'f.date' },
  ],
  records: 16,
  pattern: { notary: 'kov', attorney: 'mur' },
  target_count: 4,
  min_for_partial: 2,
  seed: 7,
};

/** Та же колода, что строит игра для CFG (seed задан явно). */
function deckOf(cfg: Record<string, unknown> = CFG, id = 'm1'): DbCard[] {
  const c = parseDbConfig(cfg);
  if (!c) throw new Error('config не разобран');
  return buildDeck({
    fields: c.fields.map((f) => ({ field: f.field, optionIds: f.options.map((o) => o.id), isDate: f.isDate })),
    pattern: c.pattern,
    records: c.records,
    targets: c.targetCount,
    seed: c.seed ?? hashString(id),
  });
}

interface Play {
  r: Rig;
  m: ReturnType<typeof createDatabaseSearch>;
  deck: DbCard[];
  targets: string[];
  others: string[];
  card(id: string): HTMLButtonElement;
  chip(field: string, opt: string | null): HTMLButtonElement;
  pick(...ids: string[]): void;
  check(): void;
  next(): void;
}

function play(over: Parameters<typeof defOf>[2] = {}, cfg: Record<string, unknown> = CFG, ctx: Partial<GameContext> = {}, strings = STRINGS): Play {
  const r = rig(defOf(TYPE, cfg, over), { ctx, strings });
  const m = mountGame(createDatabaseSearch(), r, cfg);
  const deck = deckOf(cfg);
  const card = (id: string): HTMLButtonElement => q<HTMLButtonElement>(r.dom, `.mg-db__card[data-id="${id}"]`);
  return {
    r,
    m,
    deck,
    targets: deck.filter((c) => c.target).map((c) => c.id),
    others: deck.filter((c) => !c.target).map((c) => c.id),
    card,
    chip: (field, opt) =>
      opt === null ? q<HTMLButtonElement>(r.dom, `.mg-db__filter[data-field="${field}"] .mg-db__chip.is-all`) : q<HTMLButtonElement>(r.dom, `.mg-db__chip[data-field="${field}"][data-opt="${opt}"]`),
    pick: (...ids) => ids.forEach((id) => click(card(id))),
    check: () => click(q(r.dom, 'button.is-check')),
    next: () => click(q(r.dom, 'button.is-next')),
  };
}

const progress = (r: Rig): string => q(r.dom, '.mg-shell__progress').textContent ?? '';
const mistakes = (r: Rig): string => q(r.dom, '.mg-shell__fails-text').textContent ?? '';
const outcome = (r: Rig): string | undefined => q(r.dom, '.mg-shell__result').dataset.outcome;
const visibleIds = (r: Rig): string[] => [...r.dom.querySelectorAll<HTMLElement>('.mg-db__item:not([hidden]) .mg-db__card')].map((b) => b.dataset.id ?? '');

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('parseDbConfig', () => {
  it('поля, паттерн, пороги и фильтры', () => {
    const c = parseDbConfig(CFG);
    expect(c?.fields.map((f) => f.field)).toEqual(['address', 'notary', 'attorney', 'buyer', 'date']);
    expect(c?.fields.map((f) => f.filter)).toEqual([false, true, true, true, false]);
    expect(c?.fields.map((f) => f.isDate)).toEqual([false, false, false, false, true]);
    expect(c?.patternFields).toEqual(['notary', 'attorney']);
    expect(c?.pattern).toEqual({ notary: 'kov', attorney: 'mur' });
    expect(c?.records).toBe(16);
    expect(c?.targetCount).toBe(4);
    expect(c?.minForPartial).toBe(2);
    expect(c?.maxMistakes).toBe(4);
    expect(c?.seed).toBe(7);
  });

  it('min_for_partial зажимается target_count; не задан — null; max_mistakes и seed из config', () => {
    expect(parseDbConfig({ ...CFG, min_for_partial: 99 })?.minForPartial).toBe(4);
    const { min_for_partial: _m, seed: _s, ...rest } = CFG;
    const c = parseDbConfig({ ...rest, max_mistakes: 2 });
    expect(c?.minForPartial).toBeNull();
    expect(c?.seed).toBeNull();
    expect(c?.maxMistakes).toBe(2);
  });

  it('больше 8 вариантов — чипов нет; filter: false — чипов нет; поле без значений и не дата пропускается', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, text_key: `k${i}` }));
    const withMany = { ...CFG, values: CFG.values.map((v) => (v.field === 'buyer' ? { ...v, options: many } : v)) };
    expect(parseDbConfig(withMany)?.fields.find((f) => f.field === 'buyer')?.filter).toBe(false);
    const noBuyer = { ...CFG, values: CFG.values.filter((v) => v.field !== 'buyer') };
    expect(parseDbConfig(noBuyer)?.fields.map((f) => f.field)).toEqual(['address', 'notary', 'attorney', 'date']);
  });

  it.each([
    ['одно поле', { ...CFG, fields: ['notary'] }],
    ['нет values и паттерн на поле без значений', { ...CFG, values: [] }],
    ['нет pattern', { ...CFG, pattern: undefined }],
    ['пустой pattern', { ...CFG, pattern: {} }],
    ['значение паттерна вне options', { ...CFG, pattern: { notary: 'nobody' } }],
    ['паттерн на неизвестное поле', { ...CFG, pattern: { court: 'x' } }],
    ['паттерн на дату', { ...CFG, pattern: { date: 'x' } }],
    ['target_count больше records', { ...CFG, target_count: 99 }],
    ['нет target_count', { ...CFG, target_count: undefined }],
    ['повтор id среди options', { ...CFG, values: CFG.values.map((v) => (v.field === 'notary' ? { ...v, options: [...(v.options ?? []), { id: 'kov', text_key: 'x' }] } : v)) }],
    ['у поля паттерна один вариант', { ...CFG, values: CFG.values.map((v) => (v.field === 'notary' ? { ...v, options: [{ id: 'kov', text_key: 'v.notary.kov' }] } : v)) }],
    ['даты: from позже to', { ...CFG, dates: { from: '1993-08-06', to: '1993-01-01' } }],
    ['даты: не гггг-мм-дд', { ...CFG, target_dates: { from: '1993-6-1', to: '1993-08-06' } }],
    ['закреплённая карточка: значение вне options', { ...CFG, fixed: [{ ...{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }, values: { ...{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }.values, buyer: 'nobody' } }] }],
    ['закреплённая карточка: не все поля', { ...CFG, fixed: [{ ...{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }, values: { notary: 'kov', attorney: 'mur' } }] }],
    ['закреплённая карточка без даты', { ...CFG, fixed: [{ values: { values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }.values, n: 34 }] }],
    ['закреплённых целевых больше target_count', { ...CFG, target_count: 1, fixed: [{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }, { ...{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }, n: 35 }] }],
  ])('непригодный config (%s) → null', (_name, cfg) => {
    expect(parseDbConfig(cfg as Record<string, unknown>)).toBeNull();
  });
});

describe('buildDeck', () => {
  const spec = {
    fields: [
      { field: 'address', optionIds: ['a1', 'a2', 'a3'], isDate: false },
      { field: 'notary', optionIds: ['kov', 'leb', 'ost'], isDate: false },
      { field: 'attorney', optionIds: ['mur', 'gav', 'tik'], isDate: false },
      { field: 'date', optionIds: [], isDate: true },
    ],
    pattern: { notary: 'kov', attorney: 'mur' },
    records: 24,
    targets: 6,
    seed: 1993,
  };

  it('размер колоды, целевые карточки, ровно по ⌊шум / 4⌋ «наполовину совпадающих» на каждое поле паттерна', () => {
    const deck = buildDeck(spec);
    expect(deck).toHaveLength(24);
    const targets = deck.filter((c) => c.target);
    expect(targets).toHaveLength(6);
    expect(targets.every((c) => c.values.notary === 'kov' && c.values.attorney === 'mur')).toBe(true);
    const others = deck.filter((c) => !c.target);
    expect(others.some((c) => c.values.notary === 'kov' && c.values.attorney === 'mur')).toBe(false);
    const onlyNotary = others.filter((c) => c.values.notary === 'kov');
    const onlyAttorney = others.filter((c) => c.values.attorney === 'mur');
    expect(onlyNotary).toHaveLength(Math.floor(18 / 4));
    expect(onlyAttorney).toHaveLength(Math.floor(18 / 4));
    expect(others.filter((c) => c.values.notary !== 'kov' && c.values.attorney !== 'mur')).toHaveLength(18 - 8);
  });

  it('одного фильтра мало: по нотариусу видно целевые и «наполовину», по обоим — только целевые', () => {
    const deck = buildDeck(spec);
    expect(deck.filter((c) => c.values.notary === 'kov')).toHaveLength(6 + 4);
    expect(deck.filter((c) => c.values.attorney === 'mur')).toHaveLength(6 + 4);
    const both = deck.filter((c) => c.values.notary === 'kov' && c.values.attorney === 'mur');
    expect(both.map((c) => c.id).sort()).toEqual(deck.filter((c) => c.target).map((c) => c.id).sort());
  });

  it('идентификаторы c01…, порядок по дате, даты в диапазоне, номера квартир в 1…180', () => {
    const deck = buildDeck(spec);
    expect(deck.map((c) => c.id)).toEqual(Array.from({ length: 24 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`));
    for (let i = 1; i < deck.length; i++) expect((deck[i - 1]?.date ?? '') <= (deck[i]?.date ?? '')).toBe(true);
    expect(deck.every((c) => c.date >= '1992-01-01' && c.date <= '1994-03-31')).toBe(true);
    expect(deck.every((c) => c.n >= 1 && c.n <= 180)).toBe(true);
    expect(deck.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date))).toBe(true);
  });

  it('детерминирована: тот же seed — та же колода; другой seed — другая', () => {
    expect(buildDeck(spec)).toEqual(buildDeck(spec));
    expect(buildDeck({ ...spec, seed: 1994 })).not.toEqual(buildDeck(spec));
  });

  it('одно поле паттерна: «наполовину совпадающих» нет, шум не содержит значения паттерна', () => {
    const deck = buildDeck({ ...spec, pattern: { notary: 'kov' } });
    expect(deck.filter((c) => c.values.notary === 'kov')).toHaveLength(6);
    expect(deck.filter((c) => !c.target).every((c) => c.values.notary !== 'kov')).toBe(true);
  });

  it('три поля паттерна: «наполовину совпадающих» не больше четверти шума на поле и не вытесняют остальной шум', () => {
    const three = {
      ...spec,
      fields: [...spec.fields, { field: 'buyer', optionIds: ['b1', 'b2'], isDate: false }],
      pattern: { notary: 'kov', attorney: 'mur', buyer: 'b1' },
    };
    const deck = buildDeck(three);
    expect(deck).toHaveLength(24);
    expect(deck.filter((c) => c.target)).toHaveLength(6);
    const near = deck.filter((c) => !c.target && Object.entries(three.pattern).filter(([f, v]) => c.values[f] === v).length === 1);
    expect(near).toHaveLength(Math.floor(18 / 4) * 3);
    expect(deck.filter((c) => !c.target).every((c) => Object.entries(three.pattern).some(([f, v]) => c.values[f] !== v))).toBe(true);
  });

  it('records == targets: шума нет; даты — для полей-дат не нужны варианты', () => {
    const deck = buildDeck({ ...spec, records: 6 });
    expect(deck.every((c) => c.target)).toBe(true);
    expect(deck.every((c) => c.values.date === undefined)).toBe(true);
  });

  it('formatDate: гггг-мм-дд → дд.мм.гггг', () => {
    expect(formatDate('1993-06-28')).toBe('28.06.1993');
  });

  it('даты колоды и целевых карточек из config; закреплённая карточка есть всегда и входит в целевые', () => {
    const day = (s: string): number => Date.parse(`${s}T00:00:00Z`);
    const fixed = { values: { address: 'a1', notary: 'kov', attorney: 'mur' }, n: 34, date: '1993-06-28' };
    const deck = buildDeck({ ...spec, dates: [day('1992-06-01'), day('1993-08-06')], targetDates: [day('1993-06-01'), day('1993-08-06')], fixed: [fixed] });
    expect(deck).toHaveLength(24);
    expect(deck.filter((c) => c.target)).toHaveLength(6);
    expect(deck.every((c) => c.date >= '1992-06-01' && c.date <= '1993-08-06')).toBe(true);
    expect(deck.filter((c) => c.target).every((c) => c.date >= '1993-06-01')).toBe(true);
    const pinned = deck.filter((c) => c.values.address === 'a1');
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ n: 34, date: '1993-06-28', target: true });
  });

  it('config: dates, target_dates и fixed разбираются; без них — прежний диапазон и пустой список', () => {
    const c = parseDbConfig({ ...CFG, dates: { from: '1992-06-01', to: '1993-08-06' }, fixed: [{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }] });
    expect(c?.dates).toEqual([Date.parse('1992-06-01T00:00:00Z'), Date.parse('1993-08-06T00:00:00Z')]);
    expect(c?.targetDates).toEqual(c?.dates);
    expect(c?.fixed).toEqual([{ values: { address: 'a1', notary: 'kov', attorney: 'mur', buyer: 'b1' }, n: 34, date: '1993-06-28' }]);
    const plain = parseDbConfig(CFG);
    expect(plain?.dates).toEqual([Date.parse('1992-01-01T00:00:00Z'), Date.parse('1994-03-31T00:00:00Z')]);
    expect(plain?.fixed).toEqual([]);
  });
});

describe('разметка', () => {
  it('название, бриф, вступление, прогресс и счётчик ошибок', () => {
    const { r } = play({}, CFG, { introKey: 'mini.intro' });
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Картотека БТИ');
    expect(q(r.dom, '.mg-shell__intro').textContent).toBe('Найдите повторы');
    expect(progress(r)).toBe('Найдено: 0 из 4');
    expect(mistakes(r)).toBe('Ошибки: 0 из 4');
  });

  it('чипы-фильтры только у нотариуса, представителя и покупателя; в каждой строке «Все» + варианты', () => {
    const { r } = play();
    expect(texts(r.dom, '.mg-db__flabel')).toEqual(['Нотариус', 'Представитель', 'Покупатель']);
    const rows = [...r.dom.querySelectorAll('.mg-db__filter')];
    expect(rows.map((row) => texts(row, '.mg-db__chip'))).toEqual([
      ['Все', 'Ковригин А. Н.', 'Лебедева Т. И.', 'Островский М. Б.'],
      ['Все', 'Мурашов С. В.', 'Гаврилов Ю. А.', 'Тихонова Л. Д.'],
      ['Все', 'Лапин', 'Соколов', 'Беляев', 'Фёдорова'],
    ]);
    expect(rows.map((row) => row.querySelector('.is-all')?.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
  });

  it('карточки — крупные строки-чекбоксы; значения из локали, дата дд.мм.гггг, номер квартиры подставлен', () => {
    const { r, deck } = play();
    const cards = [...r.dom.querySelectorAll<HTMLButtonElement>('.mg-db__card')];
    expect(cards).toHaveLength(16);
    expect(cards.every((c) => c.getAttribute('role') === 'checkbox' && c.getAttribute('aria-checked') === 'false')).toBe(true);
    const first = deck[0];
    const el = q(r.dom, `.mg-db__card[data-id="${first?.id}"]`);
    expect(q(el, '.mg-db__cell.is-title .mg-db__v').textContent).toMatch(/^(Первая|Вторая|Третья) ул\., кв\. \d+$/);
    expect(q(el, '.mg-db__cell.is-date .mg-db__v').textContent).toBe(formatDate(first?.date ?? ''));
    expect(texts(el, '.mg-db__cells .mg-db__k')).toEqual(['Нотариус', 'Представитель', 'Покупатель']);
    expect(q(el, '.mg-db__cells .mg-db__cell:nth-child(1) .mg-db__v').textContent).toBe(texts(r.dom, `.mg-db__card[data-id="${first?.id}"] .mg-db__cells .mg-db__v`)[0]);
  });

  it('служебная строка и кнопка «Проверить»: пока ничего не отмечено — недоступна', () => {
    const { r } = play();
    expect(q(r.dom, '.mg-db__shown').textContent).toBe('Показано: 16 из 16');
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 0');
    const check = q<HTMLButtonElement>(r.dom, 'button.is-check');
    expect(check.textContent).toBe('Проверить');
    expect(check.disabled).toBe(true);
    expect(q(r.dom, '.mg-shell__actions').hidden).toBe(false);
    expect(q(r.dom, '.mg-db__empty').hidden).toBe(true);
  });

  it('карточки не зависят от языка: ids и порядок те же при смене строк', () => {
    const { r } = play();
    const before = visibleIds(r);
    r.setStrings({ ...STRINGS, 'v.notary.kov': 'Kovrigin A. N.' });
    r.fireLanguageChange();
    expect(visibleIds(r)).toEqual(before);
  });
});

describe('фильтры', () => {
  it('чип сужает список, второй чип — ещё; значения фильтра подсвечены в карточках', () => {
    const { r, deck, chip } = play();
    click(chip('notary', 'kov'));
    const byNotary = deck.filter((c) => c.values.notary === 'kov').map((c) => c.id);
    expect(visibleIds(r)).toEqual(byNotary);
    expect(chip('notary', 'kov').getAttribute('aria-pressed')).toBe('true');
    expect(chip('notary', 'kov').classList.contains('is-on')).toBe(true);
    expect(chip('notary', null).getAttribute('aria-pressed')).toBe('false');
    expect(q(r.dom, '.mg-db__shown').textContent).toBe(`Показано: ${byNotary.length} из 16`);
    expect(r.dom.querySelectorAll('.mg-db__item:not([hidden]) .mg-db__v.is-hit').length).toBe(byNotary.length);

    click(chip('attorney', 'mur'));
    const both = deck.filter((c) => c.values.notary === 'kov' && c.values.attorney === 'mur').map((c) => c.id);
    expect(visibleIds(r)).toEqual(both);
    expect(both).toHaveLength(4);
    expect(r.autosaves).toBe(2);
  });

  it('повторный тап по включённому чипу и «Все» сбрасывают фильтр поля; фильтры других полей остаются', () => {
    const { r, chip, deck } = play();
    click(chip('notary', 'kov'));
    click(chip('attorney', 'mur'));
    click(chip('notary', 'kov'));
    expect(visibleIds(r)).toEqual(deck.filter((c) => c.values.attorney === 'mur').map((c) => c.id));
    click(chip('notary', 'leb'));
    click(chip('notary', null));
    expect(chip('notary', null).getAttribute('aria-pressed')).toBe('true');
    expect(visibleIds(r)).toEqual(deck.filter((c) => c.values.attorney === 'mur').map((c) => c.id));
    click(chip('attorney', null));
    expect(visibleIds(r)).toHaveLength(16);
  });

  it('нет подходящих карточек — сообщение; отмеченные, но скрытые фильтром остаются отмеченными', () => {
    const { r, deck, chip, pick } = play();
    // Находим сочетание фильтров без единой карточки.
    let combo: [string, string, string, string] | null = null;
    const ids = (f: string): string[] => [...new Set(deck.map((c) => c.values[f] ?? ''))];
    outer: for (const n of ids('notary')) for (const a of ids('attorney')) for (const b of ids('buyer')) {
      if (!deck.some((c) => c.values.notary === n && c.values.attorney === a && c.values.buyer === b)) {
        combo = [n, a, b, ''];
        break outer;
      }
    }
    expect(combo).not.toBeNull();
    const firstId = deck[0]?.id ?? '';
    pick(firstId);
    if (!combo) return;
    click(chip('notary', combo[0]));
    click(chip('attorney', combo[1]));
    click(chip('buyer', combo[2]));
    expect(visibleIds(r)).toEqual([]);
    expect(q(r.dom, '.mg-db__empty').hidden).toBe(false);
    expect(q(r.dom, '.mg-db__empty').textContent).toBe('Таких карточек нет');
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 1');
  });

  it('на паузе и после конца партии фильтры не меняются', () => {
    const { r, m, chip } = play();
    m.pause();
    click(chip('notary', 'kov'));
    expect(visibleIds(r)).toHaveLength(16);
  });
});

describe('полоса полей (узкий экран): чипы выбранного поля, без прокрутки вбок', () => {
  const tabs = (r: Rig): HTMLElement[] => [...r.dom.querySelectorAll<HTMLElement>('.mg-db__ftab')];
  const openRows = (r: Rig): string[] => [...r.dom.querySelectorAll<HTMLElement>('.mg-db__filter.is-open')].map((e) => e.dataset.field ?? '');

  it('по кнопке на поле: нотариус, представитель, покупатель; открыто первое', () => {
    const { r } = play();
    expect(tabs(r).map((t) => t.querySelector('.mg-db__ftab-label')?.textContent)).toEqual(['Нотариус', 'Представитель', 'Покупатель']);
    expect(tabs(r).map((t) => t.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
    expect(openRows(r)).toEqual(['notary']);
    expect(q(r.dom, '.mg-db__ftabs').hidden).toBe(false);
  });

  it('нажатие открывает чипы другого поля; это не ход — автосейва нет', () => {
    const { r } = play();
    click(tabs(r)[1] ?? null);
    expect(openRows(r)).toEqual(['attorney']);
    expect(tabs(r).map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
    expect(r.autosaves).toBe(0);
    click(tabs(r)[1] ?? null);
    expect(openRows(r)).toEqual(['attorney']);
  });

  it('включённый фильтр виден на кнопке поля, даже когда его чипы свёрнуты', () => {
    const { r, chip } = play();
    click(chip('notary', 'kov'));
    click(tabs(r)[1] ?? null);
    const notary = tabs(r)[0];
    expect(notary?.classList.contains('has-value')).toBe(true);
    expect(notary?.querySelector('.mg-db__ftab-value')?.textContent).toBe('Ковригин А. Н.');
    expect(tabs(r)[1]?.classList.contains('has-value')).toBe(false);
    click(chip('notary', null));
    expect(notary?.classList.contains('has-value')).toBe(false);
  });

  it('подсказка открывает чипы подсказанного поля', async () => {
    const { r } = play({ skip: { allowed: true, hint_rewarded_ad: true } }, CFG, { showRewarded: () => Promise.resolve(true) });
    click(tabs(r)[2] ?? null);
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(openRows(r)).toEqual(['notary']));
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(openRows(r)).toEqual(['attorney']));
  });

  it('на паузе поля не переключаются', () => {
    const { r, m } = play();
    m.pause();
    click(tabs(r)[1] ?? null);
    expect(openRows(r)).toEqual(['notary']);
  });

  it('одно поле с чипами — полосы нет, строка открыта; полей с чипами нет — блока фильтров нет', () => {
    const one = { ...CFG, values: CFG.values.map((v) => (v.field === 'attorney' || v.field === 'buyer' ? { ...v, filter: false } : v)) };
    const a = play({}, one);
    expect(q(a.r.dom, '.mg-db__ftabs').hidden).toBe(true);
    expect(openRows(a.r)).toEqual(['notary']);
    const none = { ...CFG, values: CFG.values.map((v) => ({ ...v, filter: false })) };
    const b = play({}, none);
    expect(q(b.r.dom, '.mg-db__filters').hidden).toBe(true);
    expect(b.r.dom.querySelectorAll('.mg-db__card')).toHaveLength(16);
  });
});

describe('отбор и проверка карточек', () => {
  it('тап по карточке отмечает её, повторный — снимает; счётчики и кнопка обновляются', () => {
    const { r, deck, card } = play();
    const id = deck[0]?.id ?? '';
    click(card(id));
    expect(card(id).classList.contains('is-picked')).toBe(true);
    expect(card(id).getAttribute('aria-checked')).toBe('true');
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 1');
    expect(q(r.dom, 'button.is-check').textContent).toBe('Проверить (1)');
    expect(q<HTMLButtonElement>(r.dom, 'button.is-check').disabled).toBe(false);
    click(card(id));
    expect(card(id).classList.contains('is-picked')).toBe(false);
    expect(q<HTMLButtonElement>(r.dom, 'button.is-check').disabled).toBe(true);
  });

  it('все целевые карточки → success; итог показан, onResult — только по «Далее» и один раз', () => {
    const { r, targets, pick, check, next } = play();
    pick(...targets);
    check();
    expect(progress(r)).toBe('Найдено: 4 из 4');
    expect(mistakes(r)).toBe('Ошибки: 0 из 4');
    expect(outcome(r)).toBe('success');
    expect(q(r.dom, '.mg-shell__result-title').textContent).toBe('Успех');
    expect(r.results).toEqual([]);
    next();
    next();
    expect(r.results).toEqual(['success']);
  });

  it('проверка закрепляет подходящие и отвергает лишние: бейджи, ошибки, статус; такие карточки больше не нажимаются', () => {
    const { r, targets, others, pick, check, card } = play();
    const t0 = targets[0] ?? '';
    const o0 = others[0] ?? '';
    pick(t0, o0);
    check();
    expect(card(t0).classList.contains('is-found')).toBe(true);
    expect(card(o0).classList.contains('is-rejected')).toBe(true);
    expect(q(card(t0), '.mg-db__badge').textContent).toBe('Подходит');
    expect(q(card(o0), '.mg-db__badge').textContent).toBe('Не подходит');
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подходит: 1 · Не подходит: 1');
    expect(progress(r)).toBe('Найдено: 1 из 4');
    expect(mistakes(r)).toBe('Ошибки: 1 из 4');
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 0');
    expect(r.autosaves).toBe(3);
    click(card(t0));
    click(card(o0));
    expect(card(t0).classList.contains('is-picked')).toBe(false);
    expect(card(o0).classList.contains('is-picked')).toBe(false);
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 0');
  });

  it('статус проверки показывает только непустые части', () => {
    const { r, targets, others, pick, check } = play();
    pick(targets[0] ?? '');
    check();
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подходит: 1');
    pick(others[0] ?? '');
    check();
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Не подходит: 1');
  });

  it('проверка без отмеченных карточек ничего не делает', () => {
    const { r, check } = play();
    q<HTMLButtonElement>(r.dom, 'button.is-check').disabled = false;
    check();
    expect(r.autosaves).toBe(0);
    expect(mistakes(r)).toBe('Ошибки: 0 из 4');
  });

  it('лимит ошибок исчерпан: нашёл не меньше min_for_partial → partial, меньше → fail', () => {
    const cfg = { ...CFG, max_mistakes: 2 };
    const a = play({}, cfg);
    a.pick(a.targets[0] ?? '', a.targets[1] ?? '');
    a.check();
    a.pick(a.others[0] ?? '', a.others[1] ?? '');
    a.check();
    expect(outcome(a.r)).toBe('partial');
    expect(q(a.r.dom, '.mg-shell__result-note').textContent).toBe('Найдено: 2 из 4');
    a.next();
    expect(a.r.results).toEqual(['partial']);

    const b = play({}, cfg);
    b.pick(b.targets[0] ?? '', b.others[0] ?? '', b.others[1] ?? '');
    b.check();
    expect(outcome(b.r)).toBe('fail');
    b.next();
    expect(b.r.results).toEqual(['fail']);
  });

  it('нашёл всё, но ошибок набралось столько же, сколько лимит → partial (успех требует ошибок меньше лимита)', () => {
    const { r, targets, others, pick, check } = play({}, { ...CFG, max_mistakes: 3 });
    pick(...targets, ...others.slice(0, 3));
    check();
    expect(progress(r)).toBe('Найдено: 4 из 4');
    expect(outcome(r)).toBe('partial');
  });

  it('нашёл всё, ошибок меньше лимита → success', () => {
    const { r, targets, others, pick, check } = play();
    pick(...targets, ...others.slice(0, 3));
    check();
    expect(mistakes(r)).toBe('Ошибки: 3 из 4');
    expect(outcome(r)).toBe('success');
  });

  it('без min_for_partial частичного результата нет: мало найдено → fail, всё найдено при лишних ошибках → partial', () => {
    const { min_for_partial: _m, ...cfg } = { ...CFG, max_mistakes: 2 };
    const a = play({}, cfg);
    a.pick(a.targets[0] ?? '', a.targets[1] ?? '', a.targets[2] ?? '', a.others[0] ?? '', a.others[1] ?? '');
    a.check();
    expect(outcome(a.r)).toBe('fail');

    const b = play({}, cfg);
    b.pick(...b.targets, b.others[0] ?? '', b.others[1] ?? '');
    b.check();
    expect(outcome(b.r)).toBe('partial');
  });

  it('после конца партии ввод не принимается', () => {
    const { r, targets, others, pick, check, card } = play();
    pick(...targets);
    check();
    click(card(others[0] ?? ''));
    expect(card(others[0] ?? '').classList.contains('is-picked')).toBe(false);
    expect(q<HTMLButtonElement>(r.dom, 'button.is-check').disabled).toBe(true);
    expect(q(r.dom, '.mg-shell__actions').hidden).toBe(true);
  });
});

describe('карточки с клавиатуры', () => {
  it('карточка — кнопка-чекбокс: ↑ ↓ Home End двигают фокус по видимым карточкам', () => {
    const { r, card, chip, deck } = play();
    click(chip('notary', 'kov'));
    const ids = visibleIds(r);
    const first = card(ids[0] ?? '');
    first.focus();
    press(first, 'ArrowDown');
    expect(document.activeElement).toBe(card(ids[1] ?? ''));
    press(document.activeElement as HTMLElement, 'End');
    expect(document.activeElement).toBe(card(ids[ids.length - 1] ?? ''));
    press(document.activeElement as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(card(ids[ids.length - 1] ?? ''));
    press(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement).toBe(card(ids[0] ?? ''));
    press(document.activeElement as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(card(ids[0] ?? ''));
    expect(deck.length).toBe(16);
  });

  it('другие клавиши и сочетания не двигают фокус', () => {
    const { card, deck } = play();
    const first = card(deck[0]?.id ?? '');
    first.focus();
    press(first, 'ArrowDown', { ctrlKey: true });
    press(first, 'x');
    expect(document.activeElement).toBe(first);
  });

  it('фокус остаётся на карточке после отметки (разметка не пересобирается)', () => {
    const { card, deck } = play();
    const first = card(deck[0]?.id ?? '');
    first.focus();
    click(first);
    expect(document.activeElement).toBe(first);
  });
});

describe('пропуск', () => {
  it('skip.allowed=false: кнопки пропуска нет', () => {
    const { r } = play({ skip: { allowed: false } });
    expect(btn(r.dom, 'is-skip')).toBeNull();
    q(r.dom, 'button.is-skip').click();
    expect(r.results).toEqual([]);
  });

  it('skip.after_fails считается в отвергнутых карточках: кнопка появляется после N ошибок', () => {
    const { r, targets, others, pick, check } = play({ skip: { allowed: true, after_fails: 2 } });
    expect(btn(r.dom, 'is-skip')).toBeNull();
    pick(targets[0] ?? '', others[0] ?? '');
    check();
    expect(btn(r.dom, 'is-skip')).toBeNull();
    pick(others[1] ?? '');
    check();
    const skip = btn(r.dom, 'is-skip');
    expect(skip).not.toBeNull();
    click(skip);
    click(skip);
    expect(r.results).toEqual(['skipped']);
  });

  it('режим «только история»: пропуск сразу и выделен; таймер выключен', () => {
    const { r } = play({ skip: { allowed: true, after_fails: 2 }, time_limit_ms: 5000 }, CFG, { settings: { timers: true, storyOnly: true } });
    expect(btn(r.dom, 'is-skip')?.classList.contains('is-primary')).toBe(true);
    expect(q(r.dom, '.mg-shell__timer').hidden).toBe(true);
  });

  it('after_fails не задан — пропуск сразу; кнопка «Проверить» стоит рядом с пропуском', () => {
    const { r } = play({ skip: { allowed: true } });
    expect(btn(r.dom, 'is-skip')).not.toBeNull();
    expect([...q(r.dom, '.mg-shell__actions').children].map((c) => (c as HTMLElement).className.includes('is-check'))).toEqual([true, false, false]);
  });
});

describe('подсказки', () => {
  const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };

  it('кнопка подсказки: флаг rewarded и поддержка платформой; бесплатных подсказок нет', () => {
    const ok = (): Promise<boolean> => Promise.resolve(true);
    expect(btn(play(withAd, CFG, { showRewarded: ok }).r.dom, 'is-hint')?.textContent).toBe('Подсказка за рекламу');
    expect(btn(play(withAd).r.dom, 'is-hint')).toBeNull();
    expect(btn(play({}, CFG, { showRewarded: ok }).r.dom, 'is-hint')).toBeNull();
  });

  it('подсказки по очереди включают фильтры паттерна: нотариус, затем представитель; потом кнопка исчезает', async () => {
    const showRewarded = vi.fn(() => Promise.resolve(true));
    const { r, chip, deck, m } = play(withAd, CFG, { showRewarded });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(chip('notary', 'kov').classList.contains('is-on')).toBe(true));
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подсказка: Нотариус — Ковригин А. Н.');
    expect(visibleIds(r)).toEqual(deck.filter((c) => c.values.notary === 'kov').map((c) => c.id));
    expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]);
    expect(r.autosaves).toBe(1);

    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(chip('attorney', 'mur').classList.contains('is-on')).toBe(true));
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подсказка: Представитель — Мурашов С. В.');
    expect(visibleIds(r)).toHaveLength(4);
    expect(btn(r.dom, 'is-hint')).toBeNull();
    expect((m.serialize() as { hints: number }).hints).toBe(2);
    expect(showRewarded).toHaveBeenCalledTimes(2);
  });

  it('реклама не показана — подсказки нет', async () => {
    const { r, chip } = play(withAd, CFG, { showRewarded: () => Promise.resolve(false) });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(chip('notary', 'kov').classList.contains('is-on')).toBe(false);
    expect(r.autosaves).toBe(0);
  });

  it('подсказка для поля без чипов только называет значение', async () => {
    const cfg = { ...CFG, values: CFG.values.map((v) => (v.field === 'notary' ? { ...v, filter: false } : v)) };
    const { r } = play(withAd, cfg, { showRewarded: () => Promise.resolve(true) });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подсказка: Нотариус — Ковригин А. Н.'));
    expect(visibleIds(r)).toHaveLength(16);
  });
});

describe('таймер и пауза', () => {
  it('время вышло → итог по найденному; «Далее» отдаёт результат', () => {
    vi.useFakeTimers();
    const { r, targets, pick, check } = play({ time_limit_ms: 5000 });
    pick(targets[0] ?? '', targets[1] ?? '');
    check();
    expect(q(r.dom, '.mg-shell__timer-text').textContent).toBe('0:05');
    vi.advanceTimersByTime(5200);
    expect(outcome(r)).toBe('partial');
    expect(q(r.dom, '.mg-shell__result-note').textContent).toBe('Время вышло. Найдено: 2 из 4');
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['partial']);
  });

  it('вышло время, найдено меньше min_for_partial → fail', () => {
    vi.useFakeTimers();
    const { r } = play({ time_limit_ms: 3000 });
    vi.advanceTimersByTime(3200);
    expect(outcome(r)).toBe('fail');
  });

  it('пауза замораживает время и ввод; resume продолжает', () => {
    vi.useFakeTimers();
    const { r, m, targets, pick } = play({ time_limit_ms: 5000 });
    vi.advanceTimersByTime(1000);
    m.pause();
    vi.advanceTimersByTime(60000);
    pick(targets[0] ?? '');
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 0');
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    m.resume();
    pick(targets[0] ?? '');
    expect(q(r.dom, '.mg-db__marked').textContent).toBe('Отмечено: 1');
    vi.advanceTimersByTime(4100);
    expect(outcome(r)).toBe('fail');
  });

  it('«Проверить», «Пропустить» и «Далее» на паузе не засчитываются', () => {
    const { r, m, targets, pick, check, next } = play();
    pick(...targets);
    m.pause();
    check();
    expect(progress(r)).toBe('Найдено: 0 из 4');
    m.resume();
    check();
    m.pause();
    next();
    expect(r.results).toEqual([]);
    m.resume();
    next();
    expect(r.results).toEqual(['success']);
  });
});

describe('serialize / restore', () => {
  const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };

  it('состояние — чистый JSON и переносится в новый экземпляр: фильтры, отметки, закреплённые и отвергнутые, подсказки', async () => {
    const a = play(withAd, CFG, { showRewarded: () => Promise.resolve(true) });
    click(btn(a.r.dom, 'is-hint'));
    await vi.waitFor(() => expect(a.chip('notary', 'kov').classList.contains('is-on')).toBe(true));
    a.pick(a.targets[0] ?? '', a.others[0] ?? '');
    a.check();
    a.pick(a.targets[1] ?? '');
    const saved = JSON.parse(JSON.stringify(a.m.serialize()));
    expect(saved.t).toEqual({ filters: { notary: 'kov' }, picked: [a.targets[1]], found: [a.targets[0]], rejected: [a.others[0]] });
    expect(saved.hints).toBe(1);

    const b = play(withAd, CFG, { showRewarded: () => Promise.resolve(true) });
    b.m.restore(saved);
    expect(b.chip('notary', 'kov').classList.contains('is-on')).toBe(true);
    expect(b.card(a.targets[0] ?? '').classList.contains('is-found')).toBe(true);
    expect(b.card(a.others[0] ?? '').classList.contains('is-rejected')).toBe(true);
    expect(b.card(a.targets[1] ?? '').classList.contains('is-picked')).toBe(true);
    expect(progress(b.r)).toBe('Найдено: 1 из 4');
    expect(mistakes(b.r)).toBe('Ошибки: 1 из 4');
    expect(b.m.serialize()).toEqual(saved);
    // подсказки продолжаются с того места, где остановились: следующая — представитель
    click(btn(b.r.dom, 'is-hint'));
    await vi.waitFor(() => expect(b.chip('attorney', 'mur').classList.contains('is-on')).toBe(true));
  });

  it('автосейв отдаёт уже обновлённое состояние', () => {
    const r = rig(defOf(TYPE, CFG), { strings: STRINGS });
    const snaps: Array<{ t: { found: string[]; rejected: string[] } }> = [];
    r.ctx.autosave = () => snaps.push(JSON.parse(JSON.stringify(m.serialize())));
    const m = mountGame(createDatabaseSearch(), r, CFG);
    const deck = deckOf();
    const target = deck.find((c) => c.target)?.id ?? '';
    click(q(r.dom, `.mg-db__card[data-id="${target}"]`));
    click(q(r.dom, 'button.is-check'));
    expect(snaps.at(-1)?.t.found).toEqual([target]);
  });

  it('окончание партии сохраняется: после загрузки снова показан итог', () => {
    const a = play();
    a.pick(...a.targets);
    a.check();
    const saved = JSON.parse(JSON.stringify(a.m.serialize()));
    const b = play();
    b.m.restore(saved);
    expect(outcome(b.r)).toBe('success');
    b.next();
    expect(b.r.results).toEqual(['success']);
  });

  it('мусор в состоянии игнорируется; неизвестные карточки и фильтры отбрасываются; found только из целевых', () => {
    const { r, m, targets, others } = play();
    m.restore('мусор');
    m.restore(null);
    m.restore({ t: 3, hints: -4 });
    expect(m.serialize()).toMatchObject({ over: null, hints: 0, t: { filters: {}, picked: [], found: [], rejected: [] } });
    m.restore({
      t: {
        filters: { notary: 'kov', attorney: 'nobody', court: 'x', address: 'a1', buyer: 7 },
        picked: [targets[1], 'zzz', 5, others[1]],
        found: [targets[0], others[0], 'zzz'],
        rejected: [others[0], targets[0]],
      },
    });
    expect(m.serialize()).toMatchObject({ t: { filters: { notary: 'kov' }, picked: [others[1], targets[1]].sort(), found: [targets[0]], rejected: [others[0]] } });
    expect(progress(r)).toBe('Найдено: 1 из 4');
  });
});

describe('смена языка и уничтожение', () => {
  it('подписи, чипы и значения карточек перерисовываются на лету; отметки и фильтры сохраняются', () => {
    const { r, chip, targets, others, pick, check } = play({}, CFG, { introKey: 'mini.intro' });
    click(chip('notary', 'kov'));
    pick(targets[0] ?? '', others[0] ?? '');
    check();
    r.setStrings({
      ...STRINGS,
      'mini.m1.title': 'BTI card index',
      'mini.intro': 'Find the repeats',
      'f.notary': 'Notary',
      'v.notary.kov': 'Kovrigin A. N.',
      'ui.minigame.all': 'All',
      'ui.minigame.found': 'Found: {n} of {total}',
      'ui.minigame.shown': 'Shown: {n} of {total}',
      'ui.minigame.match': 'Matches',
      'ui.minigame.no_match': 'No match',
      'ui.minigame.check': 'Check',
    });
    r.fireLanguageChange();
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('BTI card index');
    expect(q(r.dom, '.mg-shell__intro').textContent).toBe('Find the repeats');
    expect(progress(r)).toBe('Found: 1 of 4');
    expect(texts(r.dom, '.mg-db__flabel')[0]).toBe('Notary');
    expect(chip('notary', 'kov').textContent).toBe('Kovrigin A. N.');
    expect(chip('notary', null).textContent).toBe('All');
    expect(chip('notary', 'kov').classList.contains('is-on')).toBe(true);
    expect(q(r.dom, '.mg-db__shown').textContent).toMatch(/^Shown: \d+ of 16$/);
    expect(q(q(r.dom, `.mg-db__card[data-id="${targets[0]}"]`), '.mg-db__badge').textContent).toBe('Matches');
    expect(q(r.dom, 'button.is-check').textContent).toBe('Check');
    // значения, у которых строк на новом языке нет, показываются как раньше (фолбэк языка делает t())
    expect(texts(q(r.dom, `.mg-db__card[data-id="${targets[0]}"]`), '.mg-db__cells .mg-db__v').slice(0, 2)).toEqual(['Kovrigin A. N.', 'Мурашов С. В.']);
  });

  it('destroy убирает разметку, отписывается от смены языка, гасит таймер; повторный вызов безопасен', () => {
    vi.useFakeTimers();
    const { r, m } = play({ time_limit_ms: 4000 });
    expect(r.listenerCount()).toBe(1);
    m.destroy();
    expect(r.dom.querySelector('.mg-shell')).toBeNull();
    expect(r.listenerCount()).toBe(0);
    m.destroy();
    vi.advanceTimersByTime(10000);
    expect(r.results).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('запасной вариант и реестр', () => {
  it.each([
    ['пустой config', {}],
    ['config без values (до расширения схемы)', { fields: ['address', 'notary'], records: 24, pattern: { notary: 'kovrigin' }, target_count: 6, min_for_partial: 3 }],
  ])('%s → grey-box: эпизод остаётся проходимым', (_name, cfg) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig(defOf(TYPE, cfg as Record<string, unknown>), { strings: STRINGS });
    const m = mountGame(createDatabaseSearch(), r, cfg as Record<string, unknown>);
    expect(r.dom.querySelector('.mg-gb')).not.toBeNull();
    expect(r.dom.querySelector('.mg-db')).toBeNull();
    expect(m.serialize()).toEqual({ hintsShown: 0 });
    q(r.dom, '.mg-btn.is-partial').click();
    q(r.dom, '.mg-btn.is-partial').click();
    expect(r.results).toEqual(['partial']);
    m.destroy();
    expect(r.dom.querySelector('.mg-gb')).toBeNull();
  });

  it('реестр создаёт настоящую игру для database_search', () => {
    registerBuiltinMinigames();
    const m = createMinigame(TYPE);
    const r = rig(defOf(TYPE, CFG), { strings: STRINGS });
    mountGame(m, r, CFG);
    expect(r.dom.querySelector('.mg-db')).not.toBeNull();
    m.destroy();
  });
});

describe.skipIf(!hasRepoContent())('настоящая мини-игра ep01 (mg_db)', () => {
  const ep = loadEpisode(EP01_PATH);
  const def = ep.minigames?.mg_db;
  const strings = { ...UI, ...loadStrings('ru', ep.id) };

  it('config валиден для настоящей механики; чипы по нотариусам, представителям и покупателям; адреса и даты — без чипов', () => {
    expect(def).toBeDefined();
    if (!def) return;
    const parsed = parseDbConfig(def.config);
    expect(parsed).not.toBeNull();
    expect(parsed?.fields.filter((f) => f.filter).map((f) => f.field)).toEqual(['notary', 'attorney', 'buyer']);
    const r = rig(def, { episode: ep, strings, ctx: { introKey: 'ep01.mg_db.intro' } });
    mountGame(createDatabaseSearch(), r, def.config);
    expect(r.dom.querySelector('.mg-gb')).toBeNull();
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Картотека БТИ');
    expect(texts(r.dom, '.mg-db__flabel')).toEqual(['Нотариус', 'Представитель', 'Покупатель']);
    expect(r.dom.querySelectorAll('.mg-db__card')).toHaveLength(24);
    expect(progress(r)).toBe('Найдено: 0 из 6');
    expect(mistakes(r)).toBe('Ошибки: 0 из 4');
    expect(q(r.dom, '.mg-db__shown').textContent).toBe('Показано: 24 из 24');
    const addr = texts(r.dom, '.mg-db__cell.is-title .mg-db__v');
    expect(addr.every((a) => /(ул|ш)\., кв\. \d+$/.test(a))).toBe(true);
    expect(texts(r.dom, '.mg-db__cell.is-date .mg-db__v').every((d) => /^\d{2}\.\d{2}\.199[234]$/.test(d))).toBe(true);
  });

  it('играется до конца: нотариус Ковригин + представитель Мурашов оставляют ровно шесть карточек → success', () => {
    if (!def) return;
    const r = rig(def, { episode: ep, strings });
    mountGame(createDatabaseSearch(), r, def.config);
    click(q(r.dom, '.mg-db__chip[data-field="notary"][data-opt="kovrigin"]'));
    expect(visibleIds(r).length).toBe(10); // шесть целевых и четыре «наполовину»: одного фильтра мало
    click(q(r.dom, '.mg-db__chip[data-field="attorney"][data-opt="murashov_sv"]'));
    const ids = visibleIds(r);
    expect(ids).toHaveLength(6);
    for (const id of ids) click(q(r.dom, `.mg-db__card[data-id="${id}"]`));
    expect(q(r.dom, 'button.is-check').textContent).toBe('Проверить (6)');
    click(q(r.dom, 'button.is-check'));
    expect(outcome(r)).toBe('success');
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['success']);
  });

  it('after_fails: 2 — «Пропустить» после двух ошибок; без фильтров случайные карточки проваливаются в ошибки', () => {
    if (!def) return;
    const r = rig(def, { episode: ep, strings });
    mountGame(createDatabaseSearch(), r, def.config);
    expect(btn(r.dom, 'is-skip')).toBeNull();
    const wrongOnes = [...r.dom.querySelectorAll<HTMLButtonElement>('.mg-db__card')].filter((b) => !deckOfReal(def.id, def.config).find((c) => c.id === b.dataset.id)?.target);
    for (const b of wrongOnes.slice(0, 2)) click(b);
    click(q(r.dom, 'button.is-check'));
    expect(mistakes(r)).toBe('Ошибки: 2 из 4');
    expect(btn(r.dom, 'is-skip')).not.toBeNull();
    expect(def.skip.skip_counts_as).toBe('partial');
  });

  function deckOfReal(id: string, cfg: Record<string, unknown>): DbCard[] {
    return deckOf(cfg, id);
  }
});
