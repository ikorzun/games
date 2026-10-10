// @vitest-environment jsdom
/**
 * Сверка документов (document_check): разбор config, фрагменты текста документа как тап-зоны, ошибки и
 * исходы по порогам, вкладки и свайп, правила пропуска и подсказок, таймер, пауза, serialize / restore,
 * смена языка, одиночный onResult.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../src/core/types';
import { createDocumentCheck, docTextKey, parseDocsConfig, segmentText, TYPE } from '../src/minigames/document_check';
import { createMinigame, registerBuiltinMinigames } from '../src/minigames/registry';
import type { GameContext } from '../src/minigames/types';
import { EP01_PATH, hasRepoContent, loadEpisode, loadStrings } from './helpers/content';
import { btn, click, defOf, mountGame, press, q, rig, texts, UI } from './helpers/mg_kit';
import type { Rig } from './helpers/mg_kit';
import { miniEpisode } from './helpers/mini';

const POA = 'ДОВЕРЕННОСТЬ. Я, С. Зоя Павловна, доверяю Мурашову представлять мои интересы… Удостоверено нотариусом Ковригиным А. Н. 14 июня 1993 г.';
const CONTRACT = 'ДОГОВОР КУПЛИ-ПРОДАЖИ КВАРТИРЫ. Москва, 28 июня 1993 г. Продавец С. Зоя Павловна, по доверенности от 14 июня 1993 г. действует Мурашов. Деньги получила: (подпись).';

const STRINGS: Record<string, string> = {
  ...UI,
  'mini.m1.title': 'Проверка документов',
  'mini.m1.brief': 'Сравните два документа',
  'mini.intro': 'Найдите два несоответствия',
  'doc.poa': POA,
  'doc.contract': CONTRACT,
  'arc.poa.title': 'Доверенность',
  'f.principal': 'С. Зоя Павловна',
  'f.poa_date': '14 июня 1993 г.',
  'f.notary': 'Ковригиным А. Н.',
  'f.ref': 'по доверенности от 14 июня 1993 г.',
  'f.sig': '(подпись)',
  'f.contract_date': '28 июня 1993 г.',
  'hint.date': 'Дата исправлена',
  'hint.sig': 'Подпись не совпадает',
};

const CFG = {
  documents: ['doc_poa', 'doc_contract'],
  discrepancies: [
    { doc: 'doc_poa', field: 'date', hint_key: 'hint.date' },
    { doc: 'doc_contract', field: 'signature', hint_key: 'hint.sig' },
  ],
  fields: [
    { doc: 'doc_poa', field: 'principal', text_key: 'f.principal' },
    { doc: 'doc_poa', field: 'date', text_key: 'f.poa_date' },
    { doc: 'doc_poa', field: 'notary', text_key: 'f.notary' },
    { doc: 'doc_contract', field: 'poa_ref', text_key: 'f.ref' },
    { doc: 'doc_contract', field: 'signature', text_key: 'f.sig' },
    { doc: 'doc_contract', field: 'date', text_key: 'f.contract_date' },
  ],
  decoys: 3,
  required: 2,
  max_mistakes: 3,
};

function episode(): Episode {
  const ep = miniEpisode({
    s1: {
      steps: [
        { do: 'document', doc: 'doc_poa', text_key: 'doc.poa' },
        { do: 'document', doc: 'doc_contract', text_key: 'doc.contract' },
        { do: 'end', ending: 'e_main' },
      ],
    },
  });
  ep.archive_items = [{ id: 'arc_poa', kind: 'document', title_key: 'arc.poa.title', text_key: 'doc.poa', asset: 'doc_poa' }];
  return ep;
}

interface Play {
  r: Rig;
  m: ReturnType<typeof createDocumentCheck>;
  frag(doc: string, field: string): HTMLButtonElement;
  mark(doc: string, field: string): void;
  date(): void;
  sig(): void;
  bad(i?: number): void;
  next(): void;
}

/** Ловушки в порядке fields при decoys: 3 — principal, notary, poa_ref (contract/date остаётся обычным текстом). */
const DECOYS: Array<[string, string]> = [
  ['doc_poa', 'principal'],
  ['doc_poa', 'notary'],
  ['doc_contract', 'poa_ref'],
];

function play(over: Parameters<typeof defOf>[2] = {}, cfg: Record<string, unknown> = CFG, ctx: Partial<GameContext> = {}, strings = STRINGS): Play {
  const r = rig(defOf(TYPE, cfg, over), { episode: episode(), ctx, strings });
  const m = mountGame(createDocumentCheck(), r, cfg);
  const frag = (doc: string, field: string): HTMLButtonElement => q<HTMLButtonElement>(r.dom, `.mg-docs__frag[data-key="${doc}/${field}"]`);
  const mark = (doc: string, field: string): void => click(frag(doc, field));
  let k = 0;
  return {
    r,
    m,
    frag,
    mark,
    date: () => mark('doc_poa', 'date'),
    sig: () => mark('doc_contract', 'signature'),
    bad: (i) => {
      const d = DECOYS[i ?? k++ % DECOYS.length];
      if (!d) throw new Error('нет ловушки');
      mark(d[0], d[1]);
    },
    next: () => click(q(r.dom, 'button.is-next')),
  };
}

const mistakes = (r: Rig): string => q(r.dom, '.mg-shell__fails-text').textContent ?? '';
const progress = (r: Rig): string => q(r.dom, '.mg-shell__progress').textContent ?? '';
const outcome = (r: Rig): string | undefined => q(r.dom, '.mg-shell__result').dataset.outcome;

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseDocsConfig', () => {
  it('несоответствия и первые `decoys` ловушек кликабельны, остальное — обычный текст', () => {
    const c = parseDocsConfig(CFG);
    expect(c?.documents).toEqual(['doc_poa', 'doc_contract']);
    expect(c?.fields).toHaveLength(6);
    expect(c?.active.map((f) => `${f.doc}/${f.field}`)).toEqual(['doc_poa/principal', 'doc_poa/date', 'doc_poa/notary', 'doc_contract/poa_ref', 'doc_contract/signature']);
    expect(c?.required).toBe(2);
    expect(c?.maxMistakes).toBe(3);
    expect(c?.active.filter((f) => f.discrepancy).map((f) => f.hintKey)).toEqual(['hint.date', 'hint.sig']);
  });

  it('decoys: 0 — только несоответствия; decoys не задан — все ловушки; decoys больше числа ловушек — все', () => {
    expect(parseDocsConfig({ ...CFG, decoys: 0 })?.active).toHaveLength(2);
    const { decoys: _d, ...noDecoys } = CFG;
    expect(parseDocsConfig(noDecoys)?.active).toHaveLength(6);
    expect(parseDocsConfig({ ...CFG, decoys: 99 })?.active).toHaveLength(6);
    expect(parseDocsConfig({ ...CFG, decoys: 1 })?.active.map((f) => f.field)).toEqual(['principal', 'date', 'signature']);
  });

  it('required зажимается числом несоответствий; max_mistakes по умолчанию 3', () => {
    expect(parseDocsConfig({ ...CFG, required: 9 })?.required).toBe(2);
    const { max_mistakes: _m, ...rest } = CFG;
    expect(parseDocsConfig(rest)?.maxMistakes).toBe(3);
  });

  it.each([
    ['нет documents', { ...CFG, documents: [] }],
    ['нет fields', { ...CFG, fields: undefined }],
    ['пустые fields', { ...CFG, fields: [] }],
    ['нет discrepancies', { ...CFG, discrepancies: [] }],
    ['несоответствие не описано в fields', { ...CFG, fields: CFG.fields.filter((f) => f.field !== 'date' || f.doc !== 'doc_poa') }],
    ['несоответствие в чужом документе', { ...CFG, discrepancies: [{ doc: 'doc_x', field: 'date', hint_key: 'h' }] }],
    ['поле в чужом документе', { ...CFG, fields: [...CFG.fields, { doc: 'doc_x', field: 'a', text_key: 'k' }] }],
    ['повтор поля', { ...CFG, fields: [...CFG.fields, CFG.fields[0]] }],
    ['поле без text_key', { ...CFG, fields: [{ doc: 'doc_poa', field: 'a' }] }],
  ])('непригодный config (%s) → null', (_name, cfg) => {
    expect(parseDocsConfig(cfg as Record<string, unknown>)).toBeNull();
  });
});

describe('segmentText: фрагменты ищутся дословно', () => {
  it('режет текст на обычные куски и фрагменты, текст при склейке не меняется', () => {
    const { parts, orphans } = segmentText(POA, [
      { key: 'a', text: '14 июня 1993 г.' },
      { key: 'b', text: 'С. Зоя Павловна' },
    ]);
    expect(orphans).toEqual([]);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.key))).toEqual(['ДОВЕРЕННОСТЬ. Я, ', 'b', ', доверяю Мурашову представлять мои интересы… Удостоверено нотариусом Ковригиным А. Н. ', 'a']);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.key === 'a' ? '14 июня 1993 г.' : 'С. Зоя Павловна')).join('')).toBe(POA);
  });

  it('одно вхождение занято один раз: второй такой же фрагмент берёт следующее или остаётся без места', () => {
    const text = 'дата 1 июня и ещё 1 июня';
    const two = segmentText(text, [{ key: 'a', text: '1 июня' }, { key: 'b', text: '1 июня' }]);
    expect(two.orphans).toEqual([]);
    expect(two.parts.filter((p) => typeof p !== 'string')).toEqual([{ key: 'a' }, { key: 'b' }]);
    const three = segmentText(text, [{ key: 'a', text: '1 июня' }, { key: 'b', text: '1 июня' }, { key: 'c', text: '1 июня' }]);
    expect(three.orphans).toEqual(['c']);
  });

  it('неразрывный пробел равен обычному; пустой и отсутствующий фрагменты — «сироты»', () => {
    const { parts, orphans } = segmentText('А. Н. Ковригин', [
      { key: 'a', text: 'А. Н.' },
      { key: 'b', text: '' },
      { key: 'c', text: 'нет такого' },
    ]);
    expect(orphans).toEqual(['b', 'c']);
    expect(parts).toEqual([{ key: 'a' }, ' Ковригин']);
  });

  it('пустой текст: все фрагменты — «сироты»', () => {
    expect(segmentText('', [{ key: 'a', text: 'x' }])).toEqual({ parts: [], orphans: ['a'] });
  });
});

describe('docTextKey', () => {
  it('сначала шаг document, затем archive_items[asset]; нет текста — null', () => {
    const ep = episode();
    expect(docTextKey(ep, 'doc_poa')).toBe('doc.poa');
    expect(docTextKey(ep, 'doc_contract')).toBe('doc.contract');
    expect(docTextKey(ep, 'doc_nope')).toBeNull();
    const onlyArchive = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
    onlyArchive.archive_items = [{ id: 'a', kind: 'document', title_key: 't', text_key: 'doc.from_archive', asset: 'doc_z' }];
    expect(docTextKey(onlyArchive, 'doc_z')).toBe('doc.from_archive');
  });
});

describe('разметка', () => {
  it('название, бриф, вступление, прогресс и счётчик ошибок', () => {
    const { r } = play({}, CFG, { introKey: 'mini.intro' });
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Проверка документов');
    expect(q(r.dom, '.mg-shell__intro').textContent).toBe('Найдите два несоответствия');
    expect(progress(r)).toBe('Найдено: 0 из 2');
    expect(mistakes(r)).toBe('Ошибки: 0 из 3');
  });

  it('вкладки: название из archive_items, иначе — заглавный заголовок текста, иначе «Документ N»', () => {
    const { r } = play();
    expect(texts(r.dom, '.mg-docs__tab')).toEqual(['Доверенность', 'Договор купли-продажи квартиры']);
    const r2 = rig(defOf(TYPE, CFG), { episode: miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }), strings: STRINGS });
    mountGame(createDocumentCheck(), r2, CFG);
    expect(texts(r2.dom, '.mg-docs__tab')).toEqual(['Документ 1', 'Документ 2']);
  });

  it('текст документа остаётся целым: фрагменты — кнопки внутри абзаца', () => {
    const { r } = play();
    const poa = q(r.dom, '.mg-docs__sheet[data-doc="doc_poa"] .mg-docs__text');
    expect(poa.textContent).toBe(POA);
    expect(poa.querySelectorAll('button.mg-docs__frag')).toHaveLength(3);
    const contract = q(r.dom, '.mg-docs__sheet[data-doc="doc_contract"] .mg-docs__text');
    expect(contract.textContent).toBe(CONTRACT);
    expect(contract.querySelectorAll('button.mg-docs__frag')).toHaveLength(2);
  });

  it('неактивные ловушки (сверх decoys) остаются обычным текстом', () => {
    const { r } = play();
    expect(r.dom.querySelector('.mg-docs__frag[data-key="doc_contract/date"]')).toBeNull();
    expect(q(r.dom, '.mg-docs__sheet[data-doc="doc_contract"] .mg-docs__text').textContent).toContain('28 июня 1993 г.');
  });

  it('фрагмент, которого нет в тексте документа, показан отдельной строкой — игра проходима', () => {
    const { r } = play({}, CFG, {}, { ...STRINGS, 'f.sig': '(подпись продавца)' });
    expect(q(r.dom, '.mg-docs__sheet[data-doc="doc_contract"] .mg-docs__text').querySelector('[data-key="doc_contract/signature"]')).toBeNull();
    const orphan = q(r.dom, '.mg-docs__sheet[data-doc="doc_contract"] .mg-docs__orphans .mg-docs__frag');
    expect(orphan.textContent).toBe('(подпись продавца)');
    expect(q(r.dom, '.mg-docs__sheet[data-doc="doc_poa"] .mg-docs__orphans').hidden).toBe(true);
    click(orphan);
    expect(progress(r)).toBe('Найдено: 1 из 2');
  });

  it('у документа нет текста — фрагменты идут отдельными строками', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
    const r = rig(defOf(TYPE, CFG), { episode: ep, strings: STRINGS });
    mountGame(createDocumentCheck(), r, CFG);
    expect(r.dom.querySelectorAll('.mg-docs__orphans .mg-docs__frag')).toHaveLength(5);
    click(q(r.dom, '.mg-docs__frag[data-key="doc_poa/date"]'));
    expect(progress(r)).toBe('Найдено: 1 из 2');
  });

  it('картинка документа из assets.documents подкладывается под текст, когда загрузилась', () => {
    const made: Array<{ src: string; fire: (type: string) => void }> = [];
    class FakeImage {
      private ls: Array<[string, () => void]> = [];
      src = '';
      constructor() {
        made.push({ src: '', fire: (type) => this.ls.filter(([t]) => t === type).forEach(([, f]) => f()) });
        const rec = made[made.length - 1];
        Object.defineProperty(this, 'src', { set: (v: string) => rec && (rec.src = v), get: () => rec?.src ?? '' });
      }
      addEventListener(type: string, cb: () => void): void {
        this.ls.push([type, cb]);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const ep = episode();
    ep.assets = { documents: [{ id: 'doc_poa', path: 'assets/ep01/docs/power_of_attorney.webp' }] };
    const r = rig(defOf(TYPE, CFG), { episode: ep, strings: STRINGS });
    mountGame(createDocumentCheck(), r, CFG);
    expect(made).toHaveLength(1);
    expect(made[0]?.src).toMatch(/assets\/ep01\/docs\/power_of_attorney\.webp$/);
    const sheet = q(r.dom, '.mg-docs__sheet[data-doc="doc_poa"]');
    expect(sheet.classList.contains('has-scan')).toBe(false);
    made[0]?.fire('load');
    expect(sheet.classList.contains('has-scan')).toBe(true);
    // адрес абсолютный: относительный в custom property читался бы от таблицы стилей
    expect(sheet.style.getPropertyValue('--doc-scan')).toMatch(/^url\("https?:\/\/[^"]+power_of_attorney\.webp"\)$/);
    expect(q(r.dom, '.mg-docs__sheet[data-doc="doc_contract"]').classList.contains('has-scan')).toBe(false);
  });
});

describe('ход игры: отметки, ошибки, исходы по порогам', () => {
  it('верное несоответствие: фрагмент отмечен, объяснение — в списке и в статусе, автосейв', () => {
    const { r, date, frag } = play();
    date();
    expect(frag('doc_poa', 'date').classList.contains('is-found')).toBe(true);
    expect(texts(r.dom, '.mg-docs__note')).toEqual(['✓Дата исправлена']);
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Дата исправлена');
    expect(progress(r)).toBe('Найдено: 1 из 2');
    expect(mistakes(r)).toBe('Ошибки: 0 из 3');
    expect(r.autosaves).toBe(1);
  });

  it('ловушка — ошибка: отмечена крестом, счётчик растёт, повторное нажатие не считается', () => {
    const { r, bad, frag } = play();
    bad(0);
    expect(frag('doc_poa', 'principal').classList.contains('is-wrong')).toBe(true);
    expect(mistakes(r)).toBe('Ошибки: 1 из 3');
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Здесь всё сходится');
    expect(r.dom.querySelectorAll('.mg-shell__pip.is-used')).toHaveLength(1);
    bad(0);
    expect(mistakes(r)).toBe('Ошибки: 1 из 3');
    expect(r.autosaves).toBe(1);
  });

  it('повторное нажатие на найденное — не ошибка и не новая находка', () => {
    const { r, date } = play();
    date();
    date();
    expect(progress(r)).toBe('Найдено: 1 из 2');
    expect(r.dom.querySelectorAll('.mg-docs__note.is-found')).toHaveLength(1);
  });

  it('найдено нужное → success; итог показан, onResult — только по «Далее» и один раз', () => {
    const { r, date, sig, next } = play();
    date();
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    sig();
    expect(outcome(r)).toBe('success');
    expect(q(r.dom, '.mg-shell__result-title').textContent).toBe('Успех');
    expect(q(r.dom, '.mg-shell__result-note').textContent).toBe('Найдено: 2 из 2');
    expect(r.results).toEqual([]);
    next();
    next();
    expect(r.results).toEqual(['success']);
  });

  it('лимит ошибок исчерпан: нашёл часть → partial, ничего → fail', () => {
    const a = play();
    a.date();
    a.bad();
    a.bad();
    expect(a.r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    a.bad();
    expect(outcome(a.r)).toBe('partial');
    a.next();
    expect(a.r.results).toEqual(['partial']);

    const b = play();
    b.bad();
    b.bad();
    b.bad();
    expect(outcome(b.r)).toBe('fail');
    expect(q(b.r.dom, '.mg-shell__result-title').textContent).toBe('Неудача');
    b.next();
    expect(b.r.results).toEqual(['fail']);
  });

  it('required меньше числа несоответствий: игра заканчивается, как только найдено нужное', () => {
    const { r, date } = play({}, { ...CFG, required: 1 });
    date();
    expect(outcome(r)).toBe('success');
    expect(q(r.dom, '.mg-shell__result-note').textContent).toBe('Найдено: 1 из 1');
  });

  it('после конца партии ввод не принимается', () => {
    const { r, bad, sig, date } = play();
    bad();
    bad();
    bad();
    date();
    sig();
    expect(progress(r)).toBe('Найдено: 0 из 2');
    expect(mistakes(r)).toBe('Ошибки: 3 из 3');
  });

  it('неактивный фрагмент не нажимается (его просто нет)', () => {
    const { r } = play();
    expect(r.dom.querySelector('[data-key="doc_contract/date"]')).toBeNull();
  });
});

describe('вкладки, свайп и клавиатура', () => {
  const tabs = (r: Rig): HTMLElement[] => [...r.dom.querySelectorAll<HTMLElement>('.mg-docs__tab')];
  const active = (r: Rig): string => q(r.dom, '.mg-docs__sheet.is-active').dataset.doc ?? '';
  const swipe = (r: Rig, dx: number, dy = 0, pointerType = 'touch'): void => {
    const box = q(r.dom, '.mg-docs__sheets');
    const ev = (type: string, x: number, y: number): void => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      box.dispatchEvent(e);
    };
    ev('pointerdown', 200, 200);
    ev('pointerup', 200 + dx, 200 + dy);
  };

  it('первый документ открыт; тап по вкладке открывает другой и просит автосейв', () => {
    const { r } = play();
    expect(active(r)).toBe('doc_poa');
    expect(tabs(r).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs(r).map((t) => t.tabIndex)).toEqual([0, -1]);
    click(tabs(r)[1] ?? null);
    expect(active(r)).toBe('doc_contract');
    expect(tabs(r).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(r.autosaves).toBe(1);
  });

  it('свайп влево — следующий документ, вправо — предыдущий; короткий и вертикальный жесты игнорируются', () => {
    const { r } = play();
    swipe(r, -30);
    swipe(r, -120, 150);
    expect(active(r)).toBe('doc_poa');
    swipe(r, -120);
    expect(active(r)).toBe('doc_contract');
    swipe(r, -120); // дальше последнего не идём
    expect(active(r)).toBe('doc_contract');
    swipe(r, 120);
    expect(active(r)).toBe('doc_poa');
  });

  it('мышь свайпом листов не переключает', () => {
    const { r } = play();
    swipe(r, -200, 0, 'mouse');
    expect(active(r)).toBe('doc_poa');
  });

  it('стрелки на вкладках переключают документы по кругу, Home / End — крайние', () => {
    const { r } = play();
    const tablist = q(r.dom, '.mg-docs__tabs');
    press(tablist, 'ArrowRight');
    expect(active(r)).toBe('doc_contract');
    press(tablist, 'ArrowRight');
    expect(active(r)).toBe('doc_poa');
    press(tablist, 'ArrowLeft');
    expect(active(r)).toBe('doc_contract');
    press(tablist, 'Home');
    expect(active(r)).toBe('doc_poa');
    press(tablist, 'End');
    expect(active(r)).toBe('doc_contract');
    press(tablist, 'a');
    expect(active(r)).toBe('doc_contract');
  });

  it('фрагмент — настоящая кнопка: Tab-фокус и Enter работают штатно', () => {
    const { frag } = play();
    expect(frag('doc_poa', 'date').tagName).toBe('BUTTON');
    expect(frag('doc_poa', 'date').type).toBe('button');
    expect(frag('doc_poa', 'date').tabIndex).toBe(0);
  });

  it('на паузе вкладки не переключаются', () => {
    const { r, m } = play();
    m.pause();
    swipe(r, -120);
    click(tabs(r)[1] ?? null);
    expect(active(r)).toBe('doc_poa');
  });

  it('один документ — вкладок нет', () => {
    const cfg = {
      documents: ['doc_poa'],
      discrepancies: [{ doc: 'doc_poa', field: 'date', hint_key: 'hint.date' }],
      fields: [{ doc: 'doc_poa', field: 'date', text_key: 'f.poa_date' }],
      required: 1,
      max_mistakes: 2,
    };
    const { r } = play({}, cfg);
    expect(q(r.dom, '.mg-docs__tabs').hidden).toBe(true);
  });
});

describe('пропуск', () => {
  it('skip.allowed=false: кнопки пропуска нет', () => {
    const { r } = play({ skip: { allowed: false } });
    expect(btn(r.dom, 'is-skip')).toBeNull();
    q(r.dom, 'button.is-skip').click();
    expect(r.results).toEqual([]);
  });

  it('skip.after_fails считается в ошибках: кнопка появляется после N ошибок, не раньше', () => {
    const { r, bad, date } = play({ skip: { allowed: true, after_fails: 2 } });
    expect(btn(r.dom, 'is-skip')).toBeNull();
    date(); // верная отметка — не неудача
    bad();
    expect(btn(r.dom, 'is-skip')).toBeNull();
    q(r.dom, 'button.is-skip').click();
    expect(r.results).toEqual([]);
    bad();
    const skip = btn(r.dom, 'is-skip');
    expect(skip?.classList.contains('is-primary')).toBe(false);
    click(skip);
    click(skip);
    expect(r.results).toEqual(['skipped']);
  });

  it('режим «только история»: пропуск сразу и выделен; таймер выключен', () => {
    const { r } = play({ skip: { allowed: true, after_fails: 2 }, time_limit_ms: 9000 }, CFG, { settings: { timers: true, storyOnly: true } });
    expect(btn(r.dom, 'is-skip')?.classList.contains('is-primary')).toBe(true);
    expect(q(r.dom, '.mg-shell__timer').hidden).toBe(true);
    click(btn(r.dom, 'is-skip'));
    expect(r.results).toEqual(['skipped']);
  });

  it('пропуск доступен сразу, если after_fails не задан; после конца партии остаётся «Далее»', () => {
    const { r, bad } = play({ skip: { allowed: true } });
    expect(btn(r.dom, 'is-skip')).not.toBeNull();
    bad();
    bad();
    bad();
    expect(btn(r.dom, 'is-skip')).toBeNull();
    expect(btn(r.dom, 'is-next')).not.toBeNull();
  });
});

describe('подсказки', () => {
  const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };

  it('кнопка подсказки: флаг rewarded и поддержка платформой; бесплатных подсказок у этой игры нет', () => {
    const ok = (): Promise<boolean> => Promise.resolve(true);
    expect(btn(play(withAd, CFG, { showRewarded: ok }).r.dom, 'is-hint')?.textContent).toBe('Подсказка за рекламу');
    expect(btn(play(withAd).r.dom, 'is-hint')).toBeNull();
    const { r, bad } = play({}, CFG, { showRewarded: ok });
    bad();
    bad();
    expect(btn(r.dom, 'is-hint')).toBeNull();
  });

  it('реклама просмотрена: открывается объяснение первого несоответствия, лист переключается, фрагмент пульсирует', async () => {
    const showRewarded = vi.fn(() => Promise.resolve(true));
    const { r, frag, m } = play(withAd, CFG, { showRewarded });
    click(q(r.dom, '.mg-docs__tab:nth-child(2)'));
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(frag('doc_poa', 'date').classList.contains('is-hinted')).toBe(true));
    expect(q(r.dom, '.mg-docs__sheet.is-active').dataset.doc).toBe('doc_poa');
    expect(texts(r.dom, '.mg-docs__note.is-hint')).toEqual(['Подсказка: Дата исправлена']);
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подсказка: Дата исправлена');
    expect(q(r.dom, '.mg-docs__tab.has-hint').textContent).toBe('Доверенность');
    expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]);
    expect((m.serialize() as { hints: number }).hints).toBe(1);
    expect(showRewarded).toHaveBeenCalledTimes(1);
  });

  it('подсказки идут по очереди и кончаются; найденное подсказкой не бывает', async () => {
    const { r, date } = play(withAd, CFG, { showRewarded: () => Promise.resolve(true) });
    date();
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(r.dom.querySelectorAll('.mg-docs__note.is-hint')).toHaveLength(1));
    expect(texts(r.dom, '.mg-docs__note.is-hint')).toEqual(['Подсказка: Подпись не совпадает']);
    expect(btn(r.dom, 'is-hint')).toBeNull();
  });

  it('реклама не показана — подсказки нет, автосейва нет, в телеметрии есть', async () => {
    const { r } = play(withAd, CFG, { showRewarded: () => Promise.resolve(false) });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(r.dom.querySelector('.mg-docs__note.is-hint')).toBeNull();
    expect(r.autosaves).toBe(0);
  });

  it('пока реклама идёт, кнопка недоступна — вторую рекламу не запустить', async () => {
    let done: (ok: boolean) => void = () => undefined;
    const showRewarded = vi.fn(() => new Promise<boolean>((res) => (done = res)));
    const { r } = play(withAd, CFG, { showRewarded });
    const b = q<HTMLButtonElement>(r.dom, 'button.is-hint');
    b.click();
    b.click();
    expect(showRewarded).toHaveBeenCalledTimes(1);
    expect(b.disabled).toBe(true);
    done(true);
    await vi.waitFor(() => expect(b.disabled).toBe(false));
  });
});

describe('таймер и пауза', () => {
  it('время вышло → итог по найденному; «Далее» отдаёт результат', () => {
    vi.useFakeTimers();
    const { r, date } = play({ time_limit_ms: 5000 });
    date();
    expect(q(r.dom, '.mg-shell__timer-text').textContent).toBe('0:05');
    vi.advanceTimersByTime(5200);
    expect(outcome(r)).toBe('partial');
    expect(q(r.dom, '.mg-shell__result-note').textContent).toBe('Время вышло. Найдено: 1 из 2');
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['partial']);
  });

  it('пауза замораживает время и ввод; resume продолжает', () => {
    vi.useFakeTimers();
    const { r, m, date, sig } = play({ time_limit_ms: 5000 });
    vi.advanceTimersByTime(1000);
    m.pause();
    expect(q(r.dom, '.mg-shell').classList.contains('is-paused')).toBe(true);
    vi.advanceTimersByTime(60000);
    date();
    expect(progress(r)).toBe('Найдено: 0 из 2');
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    m.resume();
    sig();
    expect(progress(r)).toBe('Найдено: 1 из 2');
    vi.advanceTimersByTime(4100);
    expect(outcome(r)).toBe('partial');
  });

  it('«Далее» и «Пропустить» на паузе не засчитываются', () => {
    const { r, m, date, sig, next } = play();
    date();
    sig();
    m.pause();
    next();
    expect(r.results).toEqual([]);
    m.resume();
    next();
    expect(r.results).toEqual(['success']);
  });
});

describe('serialize / restore', () => {
  it('состояние — чистый JSON и переносится в новый экземпляр: находки, ошибки, подсказки, вкладка', () => {
    const a = play(withAdFlag(), CFG, { showRewarded: () => Promise.resolve(true) });
    a.date();
    a.bad(0);
    click(q(a.r.dom, '.mg-docs__tab:nth-child(2)'));
    const saved = JSON.parse(JSON.stringify(a.m.serialize()));
    expect(saved.t).toEqual({ found: ['doc_poa/date'], wrong: ['doc_poa/principal'], hinted: [], tab: 1 });

    const b = play(withAdFlag(), CFG, { showRewarded: () => Promise.resolve(true) });
    b.m.restore(saved);
    expect(b.frag('doc_poa', 'date').classList.contains('is-found')).toBe(true);
    expect(b.frag('doc_poa', 'principal').classList.contains('is-wrong')).toBe(true);
    expect(q(b.r.dom, '.mg-docs__sheet.is-active').dataset.doc).toBe('doc_contract');
    expect(progress(b.r)).toBe('Найдено: 1 из 2');
    expect(mistakes(b.r)).toBe('Ошибки: 1 из 3');
    expect(b.m.serialize()).toEqual(saved);
    b.sig();
    expect(outcome(b.r)).toBe('success');
  });

  function withAdFlag(): Parameters<typeof defOf>[2] {
    return { skip: { allowed: true, hint_rewarded_ad: true } };
  }

  it('автосейв отдаёт уже обновлённое состояние', () => {
    const r = rig(defOf(TYPE, CFG), { episode: episode(), strings: STRINGS });
    const snaps: Array<{ t: { found: string[] } }> = [];
    r.ctx.autosave = () => snaps.push(JSON.parse(JSON.stringify(m.serialize())));
    const m = mountGame(createDocumentCheck(), r, CFG);
    click(q(r.dom, '.mg-docs__frag[data-key="doc_poa/date"]'));
    expect(snaps[0]?.t.found).toEqual(['doc_poa/date']);
  });

  it('окончание партии сохраняется: после загрузки снова показан итог', () => {
    const a = play();
    a.bad();
    a.bad();
    a.bad();
    const saved = JSON.parse(JSON.stringify(a.m.serialize()));
    const b = play();
    b.m.restore(saved);
    expect(outcome(b.r)).toBe('fail');
    b.next();
    expect(b.r.results).toEqual(['fail']);
  });

  it('мусор в состоянии игнорируется; чужие и неактивные поля отбрасываются', () => {
    const { r, m } = play();
    m.restore('мусор');
    m.restore(null);
    m.restore({ t: 5, over: 'x' });
    expect(m.serialize()).toMatchObject({ over: null, hints: 0, t: { found: [], wrong: [], hinted: [], tab: 0 } });
    m.restore({
      hints: 1,
      t: {
        found: ['doc_poa/date', 'doc_poa/date', 'doc_poa/principal', 'ghost/x', 4],
        wrong: ['doc_poa/principal', 'doc_poa/date', 'doc_contract/date'],
        hinted: ['doc_poa/date', 'doc_contract/signature'],
        tab: 99,
      },
    });
    expect(m.serialize()).toMatchObject({ t: { found: ['doc_poa/date'], wrong: ['doc_poa/principal'], hinted: ['doc_contract/signature'], tab: 1 } });
    expect(progress(r)).toBe('Найдено: 1 из 2');
  });
});

describe('смена языка и уничтожение', () => {
  it('подписи, текст документа и фрагменты перерисовываются на лету, отметки сохраняются', () => {
    const { r, date, bad } = play({}, CFG, { introKey: 'mini.intro' });
    date();
    bad(0);
    r.setStrings({
      ...STRINGS,
      'mini.m1.title': 'Document check',
      'mini.intro': 'Find two discrepancies',
      'arc.poa.title': 'Power of attorney',
      'doc.poa': 'POWER OF ATTORNEY. I, Zoya Pavlovna S., authorize Murashov… Certified by notary A. N. Kovrigin, 14 June 1993.',
      'f.principal': 'Zoya Pavlovna S.',
      'f.poa_date': '14 June 1993',
      'f.notary': 'A. N. Kovrigin',
      'hint.date': 'The date was altered',
      'ui.minigame.found': 'Found: {n} of {total}',
      'ui.minigame.mistakes': 'Mistakes: {n} of {max}',
    });
    r.fireLanguageChange();
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Document check');
    expect(q(r.dom, '.mg-shell__intro').textContent).toBe('Find two discrepancies');
    expect(progress(r)).toBe('Found: 1 of 2');
    expect(mistakes(r)).toBe('Mistakes: 1 of 3');
    expect(texts(r.dom, '.mg-docs__tab')[0]).toBe('Power of attorney');
    const poa = q(r.dom, '.mg-docs__sheet[data-doc="doc_poa"] .mg-docs__text');
    expect(poa.textContent).toContain('POWER OF ATTORNEY');
    expect(q(poa, '[data-key="doc_poa/date"]').textContent).toBe('14 June 1993');
    expect(q(poa, '[data-key="doc_poa/date"]').classList.contains('is-found')).toBe(true);
    expect(q(poa, '[data-key="doc_poa/principal"]').classList.contains('is-wrong')).toBe(true);
    expect(texts(r.dom, '.mg-docs__note')).toEqual(['✓The date was altered']);
  });

  it('абзац не пересобирается без смены текста — фокус на фрагменте не теряется', () => {
    const { frag, bad } = play();
    const b = frag('doc_poa', 'notary');
    b.focus();
    bad(1);
    expect(document.activeElement).toBe(b);
    expect(frag('doc_poa', 'notary')).toBe(b);
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
    ['config из старых тестов интерфейса (подсказки без документов)', { discrepancies: [{ hint_key: 'c.a' }, { hint_key: 'c.b' }] }],
    ['config без fields (до расширения схемы)', { documents: ['doc_poa'], discrepancies: [{ doc: 'doc_poa', field: 'date', hint_key: 'hint.date' }], required: 1, max_mistakes: 3 }],
  ])('%s → grey-box: эпизод остаётся проходимым', (_name, cfg) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig(defOf(TYPE, cfg as Record<string, unknown>, { skip: { allowed: true, hint_rewarded_ad: true } }), { strings: STRINGS, ctx: { showRewarded: () => Promise.resolve(true) } });
    const m = mountGame(createDocumentCheck(), r, cfg as Record<string, unknown>);
    expect(r.dom.querySelector('.mg-gb')).not.toBeNull();
    expect(r.dom.querySelector('.mg-docs')).toBeNull();
    expect(m.serialize()).toEqual({ hintsShown: 0 });
    m.restore({ hintsShown: 1 });
    m.pause();
    expect(r.dom.querySelector('.mg-gb.is-paused')).not.toBeNull();
    m.resume();
    q(r.dom, '.mg-btn.is-success').click();
    q(r.dom, '.mg-btn.is-fail').click();
    expect(r.results).toEqual(['success']);
    m.destroy();
    expect(r.dom.querySelector('.mg-gb')).toBeNull();
  });

  it('реестр создаёт настоящую игру для document_check', () => {
    registerBuiltinMinigames();
    const m = createMinigame(TYPE);
    const r = rig(defOf(TYPE, CFG), { episode: episode(), strings: STRINGS });
    mountGame(m, r, CFG);
    expect(r.dom.querySelector('.mg-docs')).not.toBeNull();
    m.destroy();
  });
});

describe.skipIf(!hasRepoContent())('настоящая мини-игра ep01 (mg_docs)', () => {
  const ep = loadEpisode(EP01_PATH);
  const def = ep.minigames?.mg_docs;
  const strings = { ...UI, ...loadStrings('ru', ep.id) };

  it('config валиден для настоящей механики; тексты документов и фрагменты — из локали ru', () => {
    expect(def).toBeDefined();
    if (!def) return;
    expect(parseDocsConfig(def.config)).not.toBeNull();
    const r = rig(def, { episode: ep, strings, ctx: { introKey: 'ep01.mg_docs.intro' } });
    mountGame(createDocumentCheck(), r, def.config);
    expect(r.dom.querySelector('.mg-gb')).toBeNull();
    expect(texts(r.dom, '.mg-docs__tab')).toEqual(['Доверенность', 'Договор купли-продажи квартиры']);
    expect(q(r.dom, '.mg-docs__sheet[data-doc="doc_power_of_attorney"] .mg-docs__text').textContent).toBe(strings['ep01.doc.power_of_attorney']);
    expect(q(r.dom, '.mg-docs__sheet[data-doc="doc_contract_sale"] .mg-docs__text').textContent).toBe(strings['ep01.doc.contract_sale']);
    // Все пять фрагментов нашлись в тексте, «сирот» нет.
    expect(r.dom.querySelectorAll('.mg-docs__frag')).toHaveLength(5);
    expect(r.dom.querySelectorAll('.mg-docs__orphans .mg-docs__frag')).toHaveLength(0);
    expect(progress(r)).toBe('Найдено: 0 из 2');
    expect(mistakes(r)).toBe('Ошибки: 0 из 3');
  });

  it('оба несоответствия (дата в доверенности, подпись в договоре) → success; ловушка — ошибка', () => {
    if (!def) return;
    const r = rig(def, { episode: ep, strings });
    mountGame(createDocumentCheck(), r, def.config);
    click(q(r.dom, '[data-key="doc_power_of_attorney/notary"]'));
    expect(mistakes(r)).toBe('Ошибки: 1 из 3');
    click(q(r.dom, '[data-key="doc_power_of_attorney/date"]'));
    expect(texts(r.dom, '.mg-docs__note')).toEqual(['✓Дата удостоверения исправлена поверх другой цифры']);
    click(q(r.dom, '[data-key="doc_contract_sale/signature"]'));
    expect(outcome(r)).toBe('success');
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['success']);
  });

  it('after_fails: 2 — «Пропустить» после двух ошибок; при провале skip_counts_as у игры — fail (outcomes без partial)', () => {
    if (!def) return;
    const r = rig(def, { episode: ep, strings });
    mountGame(createDocumentCheck(), r, def.config);
    click(q(r.dom, '[data-key="doc_power_of_attorney/notary"]'));
    expect(btn(r.dom, 'is-skip')).toBeNull();
    click(q(r.dom, '[data-key="doc_power_of_attorney/principal"]'));
    expect(btn(r.dom, 'is-skip')).not.toBeNull();
    expect(def.skip.skip_counts_as).toBe('fail');
  });
});
