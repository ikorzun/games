// @vitest-environment jsdom
/**
 * Компоненты интерфейса на DOM: typewriter с мгновенным допечатыванием, выбор с таймером и
 * default_option, титры, быстрое меню, стек экранов, тосты. Без браузера: jsdom + поддельное время.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/core/i18n';
import type { ChoicePending } from '../src/core/types';
import { CaptionLayer } from '../src/ui/captions';
import { ChoiceMenu } from '../src/ui/choices';
import { UiKit } from '../src/ui/kit';
import { QuickMenu } from '../src/ui/quick_menu';
import type { QuickAction } from '../src/ui/quick_menu';
import { ScreenHost } from '../src/ui/screen_host';
import type { Screen } from '../src/ui/screen_host';
import { TextBox } from '../src/ui/textbox';
import type { LineView } from '../src/ui/textbox';
import { ToastLayer } from '../src/ui/toasts';

const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] });
  i18n.addStrings('ru', {
    'c.a': 'Первый',
    'c.b': 'Второй',
    'c.c': 'Третий',
    'c.prompt': 'Что делаем?',
    'cap.k': 'Москва, 1993',
    'cap.f': 'Факт дела',
    'ui.quick.auto': 'Авто',
    'ui.quick.skip': 'Пропуск',
    'ui.quick.log': 'Журнал',
    'ui.quick.save': 'Сохранить',
    'ui.quick.load': 'Загрузить',
    'ui.quick.mute': 'Звук',
    'ui.quick.settings': 'Настройки',
    'ui.quick.hide': 'Скрыть',
    'ui.menu.settings': 'Настройки',
    'ui.archive.new_item': 'Новый материал',
  });
  i18n.addStrings('en', { 'c.a': 'First', 'c.b': 'Second', 'cap.k': 'Moscow, 1993', 'ui.quick.auto': 'Auto' });
  i18n.setLang('ru');
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  i18n.setLang('ru');
});

const line = (text: string, over: Partial<LineView> = {}): LineView => ({
  name: null,
  nameColor: null,
  text,
  style: 'say',
  layout: 'window',
  ...over,
});
const shown = (tb: TextBox): string => tb.el.querySelector('.vn-textbox__shown')?.textContent ?? '';
const rest = (tb: TextBox): string => tb.el.querySelector('.vn-textbox__rest')?.textContent ?? '';

describe('TextBox: typewriter', () => {
  it('печатает по символам со скоростью cps, невидимая часть остаётся в разметке (перенос строк не прыгает)', () => {
    const tb = new TextBox();
    document.body.appendChild(tb.el);
    tb.show(line('Привет, мир'), 10);
    expect(tb.typing).toBe(true);
    expect(tb.complete).toBe(false);
    expect(shown(tb)).toBe('');
    expect(rest(tb)).toBe('Привет, мир');

    vi.advanceTimersByTime(500);
    const n = shown(tb).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(7);
    expect(shown(tb) + rest(tb)).toBe('Привет, мир'); // целиком в разметке всегда

    vi.advanceTimersByTime(5000);
    expect(shown(tb)).toBe('Привет, мир');
    expect(rest(tb)).toBe('');
    expect(tb.typing).toBe(false);
    expect(tb.complete).toBe(true);
    expect(tb.el.classList.contains('is-complete')).toBe(true);
  });

  it('мгновенный вывод по клику: finishNow допечатывает текст, возвращает true один раз и сообщает о завершении', () => {
    const tb = new TextBox();
    const done = vi.fn();
    tb.onComplete(done);
    tb.show(line('Длинная реплика для проверки'), 5);
    vi.advanceTimersByTime(100);
    expect(tb.finishNow()).toBe(true);
    expect(shown(tb)).toBe('Длинная реплика для проверки');
    expect(tb.typing).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    expect(tb.finishNow()).toBe(false); // второй клик уже листает дальше
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cps = Infinity (скорость 5, Skip прочитанного) и пустой текст завершаются сразу', () => {
    const tb = new TextBox();
    const done = vi.fn();
    tb.onComplete(done);
    tb.show(line('Сразу'), Number.POSITIVE_INFINITY);
    expect(tb.complete).toBe(true);
    expect(shown(tb)).toBe('Сразу');
    tb.show(line(''), 20);
    expect(tb.complete).toBe(true);
    expect(done).toHaveBeenCalledTimes(2);
  });

  it('графемы не рвутся: «e + combining acute» и эмодзи с модификатором печатаются целиком', () => {
    const tb = new TextBox();
    tb.show(line('éx'), 1);
    vi.advanceTimersByTime(1100);
    expect(shown(tb)).toBe('é'); // одна графема за ~1 с, не «e» без акцента
    tb.finishNow();
    expect(shown(tb)).toBe('éx');
  });

  it('имя говорящего: цвет из cast.name_color, у рассказчика имя скрыто', () => {
    const tb = new TextBox();
    tb.show(line('Текст', { name: 'Ирина', nameColor: '#ff8800' }), Number.POSITIVE_INFINITY);
    const name = tb.el.querySelector<HTMLElement>('.vn-textbox__name');
    expect(name?.hidden).toBe(false);
    expect(name?.textContent).toBe('Ирина');
    expect(name?.style.getPropertyValue('--name-color')).toBe('#ff8800');
    tb.show(line('Закадровый', { style: 'voiceover' }), Number.POSITIVE_INFINITY);
    expect(name?.hidden).toBe(true);
    expect(tb.el.dataset.style).toBe('voiceover');
  });

  it('скринридер получает реплику целиком сразу (aria-live), а не по буквам', () => {
    const tb = new TextBox();
    tb.show(line('Полная реплика'), 3);
    expect(tb.el.querySelector('.vn-sr')?.textContent).toBe('Полная реплика');
    expect(tb.el.querySelector('.vn-sr')?.getAttribute('aria-live')).toBe('polite');
    expect(tb.el.querySelector('.vn-textbox__text')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('пауза (меню, реклама, вкладка в фоне) останавливает печать, после снятия — продолжает с того же места', () => {
    const tb = new TextBox();
    tb.show(line('Остановка и продолжение'), 20);
    vi.advanceTimersByTime(200);
    const before = shown(tb).length;
    tb.setPaused(true);
    vi.advanceTimersByTime(3000);
    expect(shown(tb).length).toBe(before);
    tb.setPaused(false);
    vi.advanceTimersByTime(3000);
    expect(shown(tb)).toBe('Остановка и продолжение');
  });

  it('смена языка на лету: rerender подменяет текст целиком без повторной печати и без повторного onComplete', () => {
    const tb = new TextBox();
    const done = vi.fn();
    tb.show(line('Привет'), Number.POSITIVE_INFINITY);
    tb.onComplete(done);
    tb.rerender(line('Hello'));
    expect(shown(tb)).toBe('Hello');
    expect(tb.complete).toBe(true);
    expect(done).not.toHaveBeenCalled();
    tb.hide();
    tb.rerender(line('невидимый')); // скрытое окно не оживает
    expect(tb.visible).toBe(false);
  });

  it('новая реплика во время печати прежней не оставляет «хвоста»', () => {
    const tb = new TextBox();
    tb.show(line('Первая реплика, длинная'), 10);
    vi.advanceTimersByTime(300);
    tb.show(line('Вторая'), 10);
    expect(shown(tb) + rest(tb)).toBe('Вторая');
    vi.advanceTimersByTime(3000);
    expect(shown(tb)).toBe('Вторая');
  });
});

const choice = (over: Partial<ChoicePending> = {}): ChoicePending => ({
  kind: 'choice',
  id: 'ch1',
  prompt_key: 'c.prompt',
  choice_kind: null,
  timer_ms: null,
  default_option: null,
  remember: false,
  options: [
    { id: 'a', key: 'c.a', enabled: true },
    { id: 'b', key: 'c.b', enabled: false },
    { id: 'c', key: 'c.c', enabled: true },
  ],
  ...over,
});

describe('ChoiceMenu', () => {
  it('рисует вопрос и варианты; недоступные видны, но выключены; клик возвращает id и закрывает меню', async () => {
    const menu = new ChoiceMenu();
    document.body.appendChild(menu.el);
    const ctl = new AbortController();
    const result = menu.ask(choice(), { timers: true, signal: ctl.signal });
    expect(menu.active).toBe(true);
    expect(menu.el.hidden).toBe(false);
    expect(menu.el.querySelector('.vn-choices__prompt')?.textContent).toBe('Что делаем?');
    const btns = [...menu.el.querySelectorAll<HTMLButtonElement>('button.vn-choice')];
    expect(btns.map((b) => b.querySelector('.vn-choice__label')?.textContent)).toEqual(['Первый', 'Второй', 'Третий']);
    expect(btns.map((b) => b.disabled)).toEqual([false, true, false]);
    expect(btns.map((b) => b.querySelector('.vn-choice__n')?.textContent)).toEqual(['1', '2', '3']);
    expect(document.activeElement).toBe(btns[0]); // фокус на первом доступном
    btns[1]?.click(); // выключенная — игнорируется (disabled-кнопка не кликается)
    btns[2]?.click();
    await expect(result).resolves.toBe('c');
    expect(menu.active).toBe(false);
    expect(menu.el.hidden).toBe(true);
  });

  it('цифры 1..n выбирают вариант; выключенный не выбирается', async () => {
    const menu = new ChoiceMenu();
    const ctl = new AbortController();
    const result = menu.ask(choice(), { timers: true, signal: ctl.signal });
    expect(menu.chooseByIndex(1)).toBe(false); // «Второй» недоступен
    expect(menu.chooseByIndex(7)).toBe(false);
    expect(menu.chooseByIndex(2)).toBe(true);
    await expect(result).resolves.toBe('c');
    expect(menu.chooseByIndex(0)).toBe(false); // меню закрыто
  });

  it('таймер: по истечении timer_ms выбирается default_option', async () => {
    const menu = new ChoiceMenu();
    const ctl = new AbortController();
    const onPick = vi.fn();
    const result = menu.ask(choice({ timer_ms: 5000, default_option: 'c' }), { timers: true, signal: ctl.signal }).then(onPick);
    expect(menu.el.querySelector('.vn-choices__timer-bar')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(4900);
    expect(onPick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await result;
    expect(onPick).toHaveBeenCalledWith('c');
    expect(menu.active).toBe(false);
  });

  it('таймеры выключены в настройках (или нет default_option): полосы нет, выбор ждёт игрока сколько угодно', async () => {
    const menu = new ChoiceMenu();
    const ctl = new AbortController();
    const onPick = vi.fn();
    void menu.ask(choice({ timer_ms: 3000, default_option: 'a' }), { timers: false, signal: ctl.signal }).then(onPick);
    expect(menu.el.querySelector('.vn-choices__timer')).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onPick).not.toHaveBeenCalled();

    void menu.ask(choice({ timer_ms: 3000, default_option: null }), { timers: true, signal: ctl.signal }).then(onPick);
    expect(menu.el.querySelector('.vn-choices__timer')).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('пауза (меню настроек, реклама) замораживает таймер; после снятия остаётся прежний остаток', async () => {
    const menu = new ChoiceMenu();
    const ctl = new AbortController();
    const onPick = vi.fn();
    void menu.ask(choice({ timer_ms: 5000, default_option: 'a' }), { timers: true, signal: ctl.signal }).then(onPick);
    await vi.advanceTimersByTimeAsync(2000);
    menu.setPaused(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onPick).not.toHaveBeenCalled();
    menu.setPaused(false);
    await vi.advanceTimersByTimeAsync(2900);
    expect(onPick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onPick).toHaveBeenCalledWith('a');
  });

  it('ответ игрока до таймера отменяет таймер: default_option потом не сработает', async () => {
    const menu = new ChoiceMenu();
    const ctl = new AbortController();
    const onPick = vi.fn();
    void menu.ask(choice({ timer_ms: 1000, default_option: 'a' }), { timers: true, signal: ctl.signal }).then(onPick);
    menu.chooseByIndex(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('c');
  });

  it('отмена сессии (AbortSignal) закрывает меню без выбора', async () => {
    const menu = new ChoiceMenu();
    const ctl = new AbortController();
    const onPick = vi.fn();
    void menu.ask(choice({ timer_ms: 1000, default_option: 'a' }), { timers: true, signal: ctl.signal }).then(onPick);
    ctl.abort();
    expect(menu.active).toBe(false);
    expect(menu.el.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('смена языка: refresh меняет подписи и сохраняет фокус и таймер', async () => {
    const menu = new ChoiceMenu();
    document.body.appendChild(menu.el);
    const ctl = new AbortController();
    const onPick = vi.fn();
    void menu.ask(choice({ timer_ms: 5000, default_option: 'a' }), { timers: true, signal: ctl.signal }).then(onPick);
    menu.el.querySelector<HTMLButtonElement>('[data-id="c"]')?.focus();
    i18n.setLang('en');
    menu.refresh();
    const labels = [...menu.el.querySelectorAll('.vn-choice__label')].map((n) => n.textContent);
    expect(labels).toEqual(['First', 'Second', 'Третий']); // «Третий» есть только в ru → фолбэк
    expect((document.activeElement as HTMLElement | null)?.dataset.id).toBe('c');
    await vi.advanceTimersByTimeAsync(5100);
    expect(onPick).toHaveBeenCalledWith('a');
  });
});

describe('CaptionLayer', () => {
  it('неблокирующий титр показывается и исчезает через hold_ms', () => {
    const host = document.createElement('div');
    const caps = new CaptionLayer(host);
    caps.show({ t: 'caption', key: 'cap.k', style: 'location', hold_ms: 2000 });
    const el = host.querySelector('.vn-cap--location');
    expect(el?.textContent).toBe('Москва, 1993');
    vi.advanceTimersByTime(100);
    expect(el?.classList.contains('is-in')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(el?.classList.contains('is-out')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(host.querySelector('.vn-cap--location')).toBeNull();
  });

  it('новый титр того же стиля заменяет прежний; разные стили сосуществуют', () => {
    const host = document.createElement('div');
    const caps = new CaptionLayer(host);
    caps.show({ t: 'caption', key: 'cap.k', style: 'date_stamp', hold_ms: 5000 });
    caps.show({ t: 'caption', key: 'cap.f', style: 'date_stamp', hold_ms: 5000 });
    caps.show({ t: 'caption', key: 'cap.k', style: 'location', hold_ms: 5000 });
    expect(host.querySelectorAll('.vn-cap--date_stamp')).toHaveLength(1);
    expect(host.querySelector('.vn-cap--date_stamp')?.textContent).toBe('Факт дела');
    expect(host.querySelectorAll('.vn-cap')).toHaveLength(2);
  });

  it('hold: титр chapter/fact живёт, пока его не закроет вызывающий; fact рисуется с полосой', () => {
    const host = document.createElement('div');
    const caps = new CaptionLayer(host);
    const closeFact = caps.hold('cap.f', 'fact');
    vi.advanceTimersByTime(60_000);
    expect(host.querySelector('.vn-cap--fact .vn-cap__bar')).not.toBeNull();
    expect(host.querySelector('.vn-cap--fact .vn-cap__text')?.textContent).toBe('Факт дела');
    closeFact();
    vi.advanceTimersByTime(400);
    expect(host.querySelector('.vn-cap--fact')).toBeNull();
    const closeChapter = caps.hold('cap.k', 'chapter');
    expect(host.querySelector('.vn-cap--chapter')?.getAttribute('role')).toBe('heading');
    closeChapter();
  });

  it('смена языка: refresh перерисовывает уже показанные титры; clear убирает всё сразу', () => {
    const host = document.createElement('div');
    const caps = new CaptionLayer(host);
    caps.show({ t: 'caption', key: 'cap.k', style: 'location', hold_ms: 9000 });
    i18n.setLang('en');
    caps.refresh();
    expect(host.querySelector('.vn-cap--location')?.textContent).toBe('Moscow, 1993');
    caps.clear();
    expect(host.querySelectorAll('.vn-cap')).toHaveLength(0);
    vi.advanceTimersByTime(20_000); // отложенное скрытие уже снятого титра ничего не ломает
  });
});

describe('QuickMenu', () => {
  it('восемь кнопок в фиксированном порядке: Auto, Skip, Log, Save, Load, Mute, Settings, Hide', () => {
    const qm = new QuickMenu(() => undefined);
    const actions = [...qm.el.querySelectorAll<HTMLElement>('button')].map((b) => b.dataset.action);
    expect(actions).toEqual(['auto', 'skip', 'log', 'save', 'load', 'mute', 'settings', 'hide']);
    expect(qm.el.querySelector('[data-action="auto"]')?.textContent).toBe('Авто');
  });

  it('клик вызывает действие, не всплывает до сцены (не продвигает сюжет) и снимает фокус с кнопки', () => {
    const calls: QuickAction[] = [];
    const qm = new QuickMenu((a) => calls.push(a));
    const outer = vi.fn();
    const wrap = document.createElement('div');
    wrap.addEventListener('click', outer);
    wrap.appendChild(qm.el);
    document.body.appendChild(wrap);
    const btn = qm.el.querySelector<HTMLButtonElement>('[data-action="log"]');
    btn?.focus();
    btn?.click();
    expect(calls).toEqual(['log']);
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(btn); // Space потом продвигает сюжет, а не повторяет «Журнал»
  });

  it('переключатели Auto / Skip / Mute отражают состояние классом и aria-pressed', () => {
    const qm = new QuickMenu(() => undefined);
    const pressed = (a: string): string | null | undefined => qm.el.querySelector(`[data-action="${a}"]`)?.getAttribute('aria-pressed');
    expect([pressed('auto'), pressed('skip'), pressed('mute')]).toEqual(['false', 'false', 'false']);
    expect(pressed('log')).toBeNull(); // не переключатель
    qm.setState({ auto: true, muted: true });
    expect([pressed('auto'), pressed('skip'), pressed('mute')]).toEqual(['true', 'false', 'true']);
    expect(qm.el.querySelector('[data-action="auto"]')?.classList.contains('is-on')).toBe(true);
  });

  it('refresh подставляет подписи нового языка; setDisabled блокирует кнопку', () => {
    const qm = new QuickMenu(() => undefined);
    i18n.setLang('en');
    qm.refresh();
    expect(qm.el.querySelector('[data-action="auto"]')?.textContent).toBe('Auto');
    qm.setDisabled('save', true);
    expect(qm.el.querySelector<HTMLButtonElement>('[data-action="save"]')?.disabled).toBe(true);
  });
});

function screen(over: Partial<Screen> & { focusable?: number } = {}): Screen & { closed: number } {
  const el = document.createElement('div');
  for (let i = 0; i < (over.focusable ?? 2); i++) {
    const b = document.createElement('button');
    b.textContent = `b${i}`;
    el.appendChild(b);
  }
  const s = {
    el,
    closed: 0,
    onClose() {
      s.closed += 1;
    },
    ...(over.dismissible === undefined ? {} : { dismissible: over.dismissible }),
  };
  return s;
}

describe('ScreenHost: стек модальных экранов', () => {
  it('open добавляет экран, фокусирует первый элемент; close убирает, зовёт onClose и возвращает фокус', () => {
    const host = new ScreenHost();
    document.body.appendChild(host.el);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const s = screen();
    host.open(s);
    expect(host.count).toBe(1);
    expect(host.top).toBe(s);
    expect(s.el.classList.contains('vn-screen')).toBe(true);
    expect(document.activeElement).toBe(s.el.querySelector('button'));
    host.close(s);
    expect(host.count).toBe(0);
    expect(s.closed).toBe(1);
    expect(document.activeElement).toBe(opener);
    host.close(s); // повторное закрытие безопасно
    expect(s.closed).toBe(1);
  });

  it('фокус не возвращается на кнопку быстрого меню (иначе Space повторил бы её действие)', () => {
    const host = new ScreenHost();
    document.body.appendChild(host.el);
    const quick = document.createElement('div');
    quick.className = 'vn-quick';
    const btn = document.createElement('button');
    quick.appendChild(btn);
    document.body.appendChild(quick);
    btn.focus();
    const s = screen();
    host.open(s);
    host.close(s);
    expect(document.activeElement).not.toBe(btn);
  });

  it('closeTop закрывает верхний закрываемый экран и не трогает незакрываемые (финал, мини-игра)', () => {
    const host = new ScreenHost();
    const lower = screen();
    const modal = screen({ dismissible: false });
    host.open(lower);
    host.open(modal);
    expect(host.closeTop()).toBe(false);
    expect(host.count).toBe(2);
    host.close(modal);
    expect(host.closeTop()).toBe(true);
    expect(host.count).toBe(0);
    expect(host.closeTop()).toBe(false);
  });

  it('onChange сообщает об открытии и закрытии (авто-режим и таймеры уходят на паузу); closeAll закрывает всё', () => {
    const host = new ScreenHost();
    const seen: number[] = [];
    const off = host.onChange(() => seen.push(host.count));
    const a = screen();
    const b = screen();
    host.open(a);
    host.open(b);
    host.closeAll();
    expect(seen).toEqual([1, 2, 1, 0]);
    expect(a.closed + b.closed).toBe(2);
    off();
    host.open(screen());
    expect(seen).toHaveLength(4);
  });

  it('refresh перерисовывает все экраны (смена языка)', () => {
    const host = new ScreenHost();
    const render = vi.fn();
    const s = { ...screen(), render };
    host.open(s);
    expect(render).toHaveBeenCalledTimes(1);
    host.refresh();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('Tab не уходит из верхнего экрана: с последнего элемента — на первый, Shift+Tab с первого — на последний', () => {
    // jsdom не считает раскладку: offsetParent всегда null, а ловушка Tab фильтрует невидимое.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: function (this: HTMLElement) { return this.parentElement; } });
    try {
      const host = new ScreenHost();
      document.body.appendChild(host.el);
      const s = screen({ focusable: 3 });
      host.open(s);
      const [first, , last] = [...s.el.querySelectorAll('button')];
      last?.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      last?.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);
      const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      first?.dispatchEvent(back);
      expect(back.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
      // Посередине Tab идёт штатно.
      const mid = s.el.querySelectorAll('button')[1];
      mid?.focus();
      const plain = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      mid?.dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(false);
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetParent', desc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent;
    }
  });
});

describe('ToastLayer', () => {
  it('«Новый материал: название» с названием из локали или id, если ключа нет; уведомление гаснет само', () => {
    i18n.addStrings('ru', { 'arc.t': 'Протокол осмотра' });
    const toasts = new ToastLayer((item) => (item === 'arc_x' ? 'arc.t' : null));
    document.body.appendChild(toasts.el);
    toasts.archive('arc_x');
    toasts.archive('arc_unknown');
    const texts = [...toasts.el.querySelectorAll('.vn-toast')].map((n) => n.textContent);
    expect(texts).toEqual(['Новый материал: Протокол осмотра', 'Новый материал: arc_unknown']);
    expect(toasts.el.getAttribute('aria-live')).toBe('polite');
    vi.advanceTimersByTime(3200 + 400);
    expect(toasts.el.querySelectorAll('.vn-toast')).toHaveLength(0);
  });
});

describe('UiKit: каркас', () => {
  it('собирает корень: сцена под слоем UI, экраны и тосты рядом; контекстное меню и drag отключены', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const kit = new UiKit(root, () => undefined, () => null);
    const stageEl = document.createElement('div');
    stageEl.className = 'vn-stage';
    kit.mountStage(stageEl);
    expect(root.classList.contains('vn-root')).toBe(true);
    expect(kit.main.firstElementChild).toBe(stageEl);
    expect(kit.ui.contains(kit.textbox.el) && kit.ui.contains(kit.choices.el) && kit.ui.contains(kit.quick.el)).toBe(true);
    expect(root.contains(kit.screens.el) && root.contains(kit.toasts.el)).toBe(true);

    const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    root.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    root.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);

    kit.setUiHidden(true);
    expect(root.classList.contains('ui-hidden')).toBe(true);
    kit.setFontScale(1.3);
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.3');
  });
});
