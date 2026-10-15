// @vitest-environment jsdom
/**
 * DomUI: порт SessionUI на DOM. Ввод (клик, тап, Space/Enter, Esc, цифры, колесо), авто-режим,
 * Skip прочитанного, выборы с таймером, паузы титров, документ, мини-игра, финал, смена языка.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, t } from '../src/core/i18n';
import { defaultViewFor } from '../src/core/interpreter';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Settings } from '../src/core/settings';
import type { ChoiceOptionView, ChoicePending, Ending, GameState, LinePending, MinigamePending, Presentation, ViewState, Value } from '../src/core/types';
import { createInitialState } from '../src/core/state';
import { registerBuiltinMinigames } from '../src/minigames/registry';
import { VoiceClip } from '../src/stage/audio';
import type { ILineVoice } from '../src/stage/voice';
import type { BaseContext, HoldContext, LineContext, MinigameContext } from '../src/session';
import type { Stage } from '../src/stage/stage';
import { CaptionLayer } from '../src/ui/captions';
import { DomUI } from '../src/ui/dom_ui';
import type { DomUIDeps } from '../src/ui/dom_ui';
import { UiKit } from '../src/ui/kit';
import type { QuickAction } from '../src/ui/quick_menu';
import { FakePlatform } from './helpers/fakes';
import { mg, miniEpisode } from './helpers/mini';

const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

const episode = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
/** Вариант обычного (не дедуктивного) выбора. */
const optView = (id: string, key: string): ChoiceOptionView => ({ id, key, enabled: true, verdict: null, tried: false, hinted: false, item: null });

interface Rig {
  ui: DomUI;
  kit: UiKit;
  root: HTMLElement;
  captionsHost: HTMLElement;
  settings: Settings;
  vars: Record<string, Value>;
  view: { current: ViewState | null };
  actions: QuickAction[];
  rollbacks: { n: number };
  archiveOpens: { n: number };
  fx: Array<{ fx: string; ms: number; intensity: number; instant: boolean }>;
  mgActive: boolean[];
  /** Кого подсветить просили (stage.setFocus). */
  focus: (string | null)[];
  platform: FakePlatform;
}

const rigs: Rig[] = [];

function makeRig(over: Partial<Settings> = {}, presentation: Presentation = 'procedural', extra: Partial<DomUIDeps> = {}): Rig {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const actions: QuickAction[] = [];
  const kit = new UiKit(root, (a) => actions.push(a));
  const captionsHost = document.createElement('div');
  kit.main.appendChild(captionsHost);
  const captions = new CaptionLayer(captionsHost);
  const fx: Rig['fx'] = [];
  const mgActive: boolean[] = [];
  const focus: (string | null)[] = [];
  const stage = {
    minigameRoot: {},
    playFx: (f: string, ms: number, intensity: number, instant: boolean): Promise<void> => {
      fx.push({ fx: f, ms, intensity, instant });
      return new Promise((r) => setTimeout(r, ms));
    },
    setMinigameActive: (a: boolean): void => {
      mgActive.push(a);
    },
    setFocus: (who: string | null): void => {
      focus.push(who);
    },
  } as unknown as Stage;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
  const vars: Record<string, Value> = {};
  const view = { current: { ...defaultViewFor(episode, 's1'), presentation } as ViewState | null };
  const rollbacks = { n: 0 };
  const archiveOpens = { n: 0 };
  const platform = new FakePlatform();
  const ui = new DomUI({
    episode,
    kit,
    stage,
    captions,
    platform,
    settings: () => settings,
    view: () => view.current,
    env: () => vars,
    onOpenArchive: () => void (archiveOpens.n += 1),
    onAction: (a) => void actions.push(a),
    onRollback: () => void (rollbacks.n += 1),
    ...extra,
  });
  const rig: Rig = { ui, kit, root, captionsHost, settings, vars, view, actions, rollbacks, archiveOpens, fx, mgActive, focus, platform };
  rigs.push(rig);
  return rig;
}

const lineP = (key: string, over: Partial<LinePending> = {}): LinePending => ({
  kind: 'line',
  style: 'say',
  who: 'a',
  key,
  expression: null,
  narrate_style: null,
  voice: null,
  scene: 's1',
  index: 0,
  ...over,
});

const ctl = (): AbortController => new AbortController();
const lineCtx = (c: AbortController, read = false): LineContext => ({ signal: c.signal, read });
const baseCtx = (c: AbortController): BaseContext => ({ signal: c.signal });
const flush = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** Промис → флаг «уже выполнен». */
function track<T>(p: Promise<T>): { done: boolean; value: T | undefined } {
  const t: { done: boolean; value: T | undefined } = { done: false, value: undefined };
  void p.then((v) => {
    t.done = true;
    t.value = v;
  });
  return t;
}

const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] });
  registerBuiltinMinigames();
  i18n.addStrings('ru', {
    'l.1': 'Первая реплика',
    'l.2': 'Ещё одна',
    'l.short': 'Коротко',
    'l.long': 'Это достаточно длинная реплика, чтобы печататься заметное время',
    'mini.cast.a': 'Следователь',
    'mini.cast.a_title': 'прокуратура',
    'mini.cast.b': 'Свидетель',
    'c.a': 'Первый',
    'c.b': 'Второй',
    'c.prompt': 'Что делаем?',
    'cap.chapter': 'Глава первая',
    'doc.text': 'Текст документа',
    'ui.common.ok': 'Понятно',
    'ui.common.back': 'Назад',
    'ui.end.title': 'Финал',
    'ui.end.decisions': 'Ход следствия',
    'ui.end.back_to_menu': 'В меню',
    'ui.end.case': 'Уголовное дело',
    'ui.end.materials': 'Блокнот: {n}',
    'ui.quick.notebook': 'Блокнот',
    'ui.quick.notes': 'Заметки',
    'ui.end.decisions_n': 'Решений: {n}',
    'mini.title': 'Смерть за квартиры',
    'ui.menu.archive': 'Архив',
    'ui.archive.new_item': 'Новый материал',
    'ui.minigame.success': 'Успех',
    'ui.minigame.partial': 'Частично',
    'ui.minigame.fail': 'Провал',
    'ui.minigame.skip': 'Пропустить',
    'mini.end.main': 'Каноническая концовка',
    'mini.m1.title': 'Игра',
    'mini.m1.brief': 'Задача',
  });
  i18n.addStrings('en', { 'l.1': 'First line', 'mini.cast.a': 'Investigator' });
  i18n.setLang('ru');
});

afterEach(() => {
  for (const r of rigs.splice(0)) r.ui.dispose();
  vi.useRealTimers();
  document.body.replaceChildren();
  i18n.setLang('ru');
});

describe('DomUI: реплики и продвижение сюжета', () => {
  it('показывает реплику с именем, подписью (cast.title_key) и портретом (cast.portrait); печатает по символам', () => {
    const { ui, kit } = makeRig({ textSpeed: 3 }, 'procedural', { portraitArt: (who) => (who === 'a' ? './assets/p/a.webp' : null) });
    void ui.showLine(lineP('l.long'), lineCtx(ctl()));
    expect(kit.textbox.el.querySelector<HTMLElement>('.vn-textbox__who')?.hidden).toBe(false);
    expect(kit.textbox.el.querySelector('.vn-textbox__name')?.textContent).toBe('Следователь');
    expect(kit.textbox.el.querySelector('.vn-textbox__title')?.textContent).toBe('прокуратура');
    expect(kit.textbox.el.querySelector('.vn-textbox__avatar')?.getAttribute('src')).toBe('./assets/p/a.webp');
    expect(kit.textbox.typing).toBe(true);
  });

  it('первое нажатие допечатывает реплику, второе — листает дальше', async () => {
    const { ui, kit } = makeRig({ textSpeed: 2 });
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl())));
    ui.advance();
    await flush();
    expect(kit.textbox.complete).toBe(true);
    expect(done.done).toBe(false);
    ui.advance();
    await flush();
    expect(done.done).toBe(true);
  });

  it('скорость текста 5 — реплика появляется мгновенно, но дальше листает только игрок', async () => {
    const { ui, kit } = makeRig({ textSpeed: 5 });
    const done = track(ui.showLine(lineP('l.1'), lineCtx(ctl())));
    await flush(10_000);
    expect(kit.textbox.complete).toBe(true);
    expect(done.done).toBe(false);
    ui.advance();
    await flush();
    expect(done.done).toBe(true);
  });

  // Реплика персонажа — всегда окно с именем, как везде в игре (владелец 2026-10-14: запись 2004 года шла субтитром
  // по центру); субтитр — только у рассказчика хроники и суда.
  it.each([
    ['reconstruction', 'window', true, 'window'],
    ['talking_head', 'window', false, 'window'],
    ['chronicle', 'window', true, 'subtitle'],
    ['courtroom', 'window', true, 'subtitle'],
  ] as const)('пресет показа %s: реплика в раскладке %s, имя видно: %s; рассказчик — %s', (presentation, layout, nameShown, narrator) => {
    const { ui, kit } = makeRig({ textSpeed: 5 }, presentation);
    void ui.showLine(lineP('l.1'), lineCtx(ctl()));
    expect(kit.textbox.el.dataset.layout).toBe(layout);
    expect(kit.textbox.el.querySelector<HTMLElement>('.vn-textbox__who')?.hidden).toBe(!nameShown);
    void ui.showLine(lineP('l.1', { style: 'narrate', who: null, narrate_style: 'voiceover' }), lineCtx(ctl()));
    expect(kit.textbox.el.dataset.layout).toBe(narrator);
  });

  it('рассказчик (narrate): имени нет, стиль окна берётся из narrate_style', () => {
    const { ui, kit } = makeRig({ textSpeed: 5 });
    void ui.showLine(lineP('l.1', { style: 'narrate', who: null, narrate_style: 'voiceover' }), lineCtx(ctl()));
    expect(kit.textbox.el.querySelector<HTMLElement>('.vn-textbox__who')?.hidden).toBe(true);
    expect(kit.textbox.el.dataset.style).toBe('voiceover');
  });

  it('клик по сцене листает; клик по кнопке быстрого меню, по выборам и при открытом экране — нет', async () => {
    const { ui, kit, root } = makeRig({ textSpeed: 5 });
    const done = track(ui.showLine(lineP('l.1'), lineCtx(ctl())));
    const quickBtn = kit.quick.el.querySelector<HTMLElement>('button');
    quickBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    kit.choices.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const dialog = document.createElement('div');
    kit.screens.open({ el: dialog });
    kit.main.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(done.done).toBe(false);
    kit.screens.closeAll();
    kit.main.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await flush();
    expect(done.done).toBe(true);
    expect(root.isConnected).toBe(true);
  });

  it('правая кнопка мыши не листает', async () => {
    const { ui, kit } = makeRig({ textSpeed: 5 });
    const done = track(ui.showLine(lineP('l.1'), lineCtx(ctl())));
    kit.main.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }));
    await flush();
    expect(done.done).toBe(false);
  });

  it.each([' ', 'Enter', 'ArrowRight', 'PageDown'])('клавиша «%s» листает', async (k) => {
    const { ui } = makeRig({ textSpeed: 5 });
    const done = track(ui.showLine(lineP('l.1'), lineCtx(ctl())));
    const ev = key(k);
    expect(ev.defaultPrevented).toBe(true); // страница не скроллится
    await flush();
    expect(done.done).toBe(true);
  });

  it('Space на сфокусированной кнопке не листает сюжет (кнопка делает своё)', async () => {
    const { ui, kit } = makeRig({ textSpeed: 5 });
    const done = track(ui.showLine(lineP('l.1'), lineCtx(ctl())));
    const btn = kit.quick.el.querySelector<HTMLElement>('button');
    btn?.focus();
    key(' ', {}, btn ?? document.body);
    await flush();
    expect(done.done).toBe(false);
  });

  it('сброс партии (AbortSignal) снимает ожидание: повторное нажатие уже ничего не листает', async () => {
    const { ui } = makeRig({ textSpeed: 5 });
    const c = ctl();
    const done = track(ui.showLine(lineP('l.1'), lineCtx(c)));
    c.abort();
    ui.advance();
    await flush(5000);
    expect(done.done).toBe(false);
  });

});

describe('DomUI: горячие клавиши и колесо', () => {
  it('S, L, N, M передают действия быстрого меню (A и H убраны вместе с кнопками, 2026-10-15); ← и PageUp — откат; Ctrl/Alt-комбинации игнорируются', () => {
    const { actions, rollbacks } = makeRig({ textSpeed: 5 });
    for (const k of ['a', 'S', 'l', 'N', 'H', 'm']) key(k);
    expect(actions).toEqual(['skip', 'log', 'notebook', 'mute']);
    key('ArrowLeft');
    key('PageUp');
    expect(rollbacks.n).toBe(2);
    key('s', { ctrlKey: true });
    key('s', { metaKey: true });
    expect(actions).toHaveLength(4);
  });

  it('Esc: сначала закрывает верхний экран, иначе открывает настройки', () => {
    const { kit, actions } = makeRig();
    const a = { el: document.createElement('div') };
    kit.screens.open(a);
    key('Escape');
    expect(kit.screens.count).toBe(0);
    expect(actions).toEqual([]);
    key('Escape');
    expect(actions).toEqual(['settings']);
  });

  it('Esc не закрывает незакрываемые экраны (финал, мини-игра, документ)', () => {
    const { kit, actions } = makeRig();
    kit.screens.open({ el: document.createElement('div'), dismissible: false });
    key('Escape');
    expect(kit.screens.count).toBe(1);
    expect(actions).toEqual(['settings']);
  });

  it('при открытом экране горячие клавиши сюжета не работают', () => {
    const { kit, actions, rollbacks } = makeRig();
    kit.screens.open({ el: document.createElement('div') });
    key('s');
    key('ArrowLeft');
    expect(actions).toEqual([]);
    expect(rollbacks.n).toBe(0);
  });

  it('колесо вверх — откат, не чаще раза в 450 мс; вниз и при открытом экране — нет', () => {
    const { kit, rollbacks } = makeRig();
    const wheel = (dy: number): void => void kit.root.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }));
    vi.setSystemTime(10_000);
    vi.advanceTimersByTime(1000);
    wheel(-100);
    wheel(-100);
    expect(rollbacks.n).toBe(1);
    vi.advanceTimersByTime(500);
    wheel(-100);
    expect(rollbacks.n).toBe(2);
    wheel(100);
    expect(rollbacks.n).toBe(2);
    kit.screens.open({ el: document.createElement('div') });
    vi.advanceTimersByTime(500);
    wheel(-100);
    expect(rollbacks.n).toBe(2);
  });

  it('dispose снимает глобальные обработчики', () => {
    const { ui, actions } = makeRig();
    ui.dispose();
    key('s');
    expect(actions).toEqual([]);
  });
});

describe('DomUI: Skip прочитанного', () => {
  it('Skip листает прочитанные реплики почти мгновенно', async () => {
    const { ui } = makeRig({ textSpeed: 1 });
    ui.setSkip(true);
    expect(ui.fastForward).toBe(true);
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl(), true)));
    await flush(100);
    expect(done.done).toBe(true);
  });

  it('на непрочитанной реплике Skip выключается сам, и реплика печатается как обычно', async () => {
    const { ui, kit } = makeRig({ textSpeed: 2 });
    ui.setSkip(true);
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl(), false)));
    expect(ui.skipOn).toBe(false);
    expect(kit.quick.el.querySelector('[data-action="skip"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(kit.textbox.typing).toBe(true);
    await flush(1000);
    expect(done.done).toBe(false);
  });

  it('настройка «пропускать и непрочитанное» разрешает Skip везде', async () => {
    const { ui } = makeRig({ textSpeed: 1, skipUnread: true });
    ui.setSkip(true);
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl(), false)));
    await flush(100);
    expect(done.done).toBe(true);
    expect(ui.skipOn).toBe(true);
  });

  it('удержание Ctrl работает как временный Skip и отпускается вместе с клавишей', async () => {
    const { ui } = makeRig({ textSpeed: 1 });
    expect(ui.fastForward).toBe(false);
    key('Control', { ctrlKey: true });
    expect(ui.fastForward).toBe(true);
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl(), true)));
    await flush(100);
    expect(done.done).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    expect(ui.fastForward).toBe(false);
  });

  it('Skip выключается на выборе, документе и концовке (решения принимает игрок)', async () => {
    const r = makeRig({ textSpeed: 5 });
    r.ui.setSkip(true);
    const choice: ChoicePending = {
      kind: 'choice', id: 'ch', prompt_key: null, choice_kind: null, timer_ms: null, default_option: null, remember: false,
      options: [optView('a', 'c.a')], deduction: null,
    };
    const c = ctl();
    void r.ui.showChoice(choice, baseCtx(c));
    expect(r.ui.skipOn).toBe(false);
    r.ui.setSkip(true);
    void r.ui.showDocument({ kind: 'document', doc: 'd', text_key: null, zoomable: false, adds_to_archive: null }, baseCtx(c));
    expect(r.ui.skipOn).toBe(false);
  });
});

describe('DomUI: подсветка того, на ком внимание', () => {
  it('реплика — говорящий; мысли героя и выбор — герой (frame.player_character); рассказчик — никто', () => {
    const hero = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }, { pov: 'a' });
    const r = makeRig({ textSpeed: 5 }, 'procedural', { episode: hero });
    void r.ui.showLine(lineP('l.1', { who: 'b' }), lineCtx(ctl()));
    void r.ui.showLine(lineP('l.1', { style: 'narrate', who: null, narrate_style: 'inner' }), lineCtx(ctl()));
    void r.ui.showLine(lineP('l.1', { style: 'narrate', who: null, narrate_style: 'voiceover' }), lineCtx(ctl()));
    void r.ui.showChoice(
      { kind: 'choice', id: 'ch', prompt_key: null, choice_kind: null, timer_ms: null, default_option: null, remember: false, options: [optView('a', 'c.a')], deduction: null },
      baseCtx(ctl()),
    );
    expect(r.focus).toEqual(['b', 'a', null, 'a']);
  });
});

describe('DomUI: выбор', () => {
  const pending = (over: Partial<ChoicePending> = {}): ChoicePending => ({
    kind: 'choice',
    id: 'ch1',
    prompt_key: 'c.prompt',
    choice_kind: null,
    timer_ms: null,
    default_option: null,
    remember: false,
    options: [optView('a', 'c.a'), optView('b', 'c.b')],
    deduction: null,
    ...over,
  });

  it('возвращает выбранный id; цифра с клавиатуры выбирает вариант; Space при выборе не листает', async () => {
    const { ui, kit } = makeRig();
    const res = track(ui.showChoice(pending(), baseCtx(ctl())));
    ui.advance();
    key(' ');
    await flush();
    expect(res.done).toBe(false);
    expect(key('2').defaultPrevented).toBe(true);
    await flush();
    expect(res.value).toBe('b');
    expect(kit.choices.active).toBe(false);
  });

  it('таймер включён: по истечении выбирается default_option', async () => {
    const { ui } = makeRig({ timers: true });
    const res = track(ui.showChoice(pending({ timer_ms: 4000, default_option: 'b' }), baseCtx(ctl())));
    await flush(3900);
    expect(res.done).toBe(false);
    await flush(200);
    expect(res.value).toBe('b');
  });

  it.each([
    ['таймеры выключены в настройках', { timers: false }],
    ['режим «только история»', { timers: true, storyOnly: true }],
  ])('%s: таймера нет, выбор ждёт игрока', async (_name, over) => {
    const { ui, kit } = makeRig(over);
    const res = track(ui.showChoice(pending({ timer_ms: 1000, default_option: 'b' }), baseCtx(ctl())));
    expect(kit.choices.el.querySelector('.vn-choices__timer')).toBeNull();
    await flush(120_000);
    expect(res.done).toBe(false);
  });

  it('пауза платформы замораживает таймер выбора', async () => {
    const { ui } = makeRig({ timers: true });
    const res = track(ui.showChoice(pending({ timer_ms: 3000, default_option: 'a' }), baseCtx(ctl())));
    await flush(1000);
    ui.setPaused(true);
    await flush(60_000);
    expect(res.done).toBe(false);
    ui.setPaused(false);
    await flush(2100);
    expect(res.value).toBe('a');
  });
});

describe('DomUI: паузы сценария (титры chapter/fact, эффекты)', () => {
  it('титр chapter держит паузу ms и убирается; клик завершает паузу досрочно', async () => {
    const { ui, kit, captionsHost } = makeRig();
    const hold = { kind: 'hold', reason: 'caption', ms: 2000, caption: { key: 'cap.chapter', style: 'chapter' } } as const;
    const a = track(ui.hold(hold, { signal: ctl().signal, instant: false }));
    expect(captionsHost.querySelector('.vn-cap--chapter')?.textContent).toBe('Глава первая');
    expect(kit.textbox.visible).toBe(false);
    await flush(1900);
    expect(a.done).toBe(false);
    await flush(200);
    expect(a.done).toBe(true);
    await flush(500);
    expect(captionsHost.querySelector('.vn-cap--chapter')).toBeNull();

    const b = track(ui.hold(hold, { signal: ctl().signal, instant: false }));
    ui.advance();
    await flush();
    expect(b.done).toBe(true);
  });

  it('instant (загрузка, откат) и Skip не ждут', async () => {
    const { ui } = makeRig();
    const hold = { kind: 'hold', reason: 'caption', ms: 60_000, caption: { key: 'cap.chapter', style: 'fact' } } as const;
    const a = track(ui.hold(hold, { signal: ctl().signal, instant: true }));
    await flush();
    expect(a.done).toBe(true);
    ui.setSkip(true);
    const b = track(ui.hold(hold, { signal: ctl().signal, instant: false }));
    await flush();
    expect(b.done).toBe(true);
  });

  it('fx передаётся сцене с длительностью и силой; пауза не длиннее ms', async () => {
    const { ui, fx } = makeRig();
    const a = track(ui.hold({ kind: 'hold', reason: 'fx', ms: 800, fx: { fx: 'flash', intensity: 0.6 } }, { signal: ctl().signal, instant: false }));
    expect(fx).toEqual([{ fx: 'flash', ms: 800, intensity: 0.6, instant: false }]);
    await flush(850);
    expect(a.done).toBe(true);
  });

  it('эффект кончился раньше паузы — следующая реплика листается: таймер паузы не снимает её ожидание', async () => {
    const quick = { minigameRoot: {}, playFx: () => Promise.resolve(), setMinigameActive: () => undefined, setFocus: () => undefined } as unknown as Stage;
    const { ui } = makeRig({}, 'procedural', { stage: quick });
    const a = track(ui.hold({ kind: 'hold', reason: 'fx', ms: 250, fx: { fx: 'flash', intensity: 1 } }, { signal: ctl().signal, instant: false }));
    await flush();
    expect(a.done).toBe(true);
    const line = track(ui.showLine(lineP('k.after'), lineCtx(ctl())));
    await flush(300); // таймер паузы срабатывает, когда реплика уже на экране
    ui.advance(); // допечатать
    await flush();
    ui.advance(); // дальше
    await flush();
    expect(line.done).toBe(true);
  });

  it('отмена партии снимает ожидание паузы', async () => {
    const { ui } = makeRig();
    const c = ctl();
    const a = track(ui.hold({ kind: 'hold', reason: 'caption', ms: 60_000, caption: { key: 'cap.chapter', style: 'chapter' } }, { signal: c.signal, instant: false } as HoldContext));
    c.abort();
    await flush();
    expect(a.done).toBe(true);
  });
});

describe('DomUI: документ, мини-игра, финал', () => {
  it('бланк документа: картинка уже загружена — показывается сразу; текст остаётся слоем из локали', async () => {
    const asked: string[] = [];
    const { ui, kit } = makeRig({}, 'procedural', {
      documentArt: (id) => (asked.push(id), { url: './assets/ep01/documents/doc_x.webp', ready: Promise.resolve('./assets/ep01/documents/doc_x.webp') }),
    });
    const res = track(ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(ctl())));
    const paper = kit.screens.el.querySelector<HTMLElement>('.vn-document__paper');
    expect(asked).toEqual(['doc_x']);
    expect(paper?.classList.contains('has-image')).toBe(true);
    expect(paper?.style.getPropertyValue('--doc-img')).toContain('/assets/ep01/documents/doc_x.webp');
    expect(kit.screens.el.querySelector('.vn-document__text')?.textContent).toBe('Текст документа');
    await flush();
    kit.screens.el.querySelector<HTMLButtonElement>('.vn-document__close')?.click();
    await flush();
    expect(res.done).toBe(true);
  });

  it('настоящая бумага (текст в картинке): лист целиком без слоя текста, текст — скринридеру; касание увеличивает', async () => {
    let resolve!: (u: string | null) => void;
    const ready = new Promise<string | null>((r) => void (resolve = r));
    const { ui, kit } = makeRig({}, 'procedural', { documentArt: () => ({ url: null, ready, textInImage: true }) });
    void ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(ctl()));
    // картинка ещё грузится — читать можно сразу: прежний лист с текстом
    expect(kit.screens.el.querySelector('.vn-document__text')?.textContent).toBe('Текст документа');
    resolve('./assets/ep01/hod/docs/ru/doc_x.webp');
    await flush();
    const sheet = kit.screens.el.querySelector<HTMLElement>('.vn-document__sheet');
    expect(sheet?.querySelector('img')?.getAttribute('src')).toBe('./assets/ep01/hod/docs/ru/doc_x.webp');
    expect(kit.screens.el.querySelector('.vn-document__paper')).toBeNull();
    expect(kit.screens.el.querySelector('.vn-sr')?.textContent).toBe('Текст документа');
    sheet?.click();
    expect(sheet?.classList.contains('is-zoomed')).toBe(true);
    sheet?.click();
    expect(sheet?.classList.contains('is-zoomed')).toBe(false);
  });

  it('бланк ещё грузится: экран открывается сразу без картинки, картинка проявляется, когда придёт', async () => {
    let resolve!: (u: string | null) => void;
    const ready = new Promise<string | null>((r) => void (resolve = r));
    const { ui, kit } = makeRig({}, 'procedural', { documentArt: () => ({ url: null, ready }) });
    void ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(ctl()));
    const paper = (): HTMLElement | null => kit.screens.el.querySelector<HTMLElement>('.vn-document__paper');
    expect(paper()?.classList.contains('has-image')).toBe(false);
    expect(kit.screens.el.querySelector('.vn-document__text')?.textContent).toBe('Текст документа'); // читать можно сразу
    resolve('./assets/ep01/documents/doc_x.webp');
    await flush();
    expect(paper()?.classList.contains('has-image')).toBe(true);
  });

  it('файла бланка нет (null): обычный лист; поздняя картинка после закрытия экрана ничего не делает', async () => {
    let resolve!: (u: string | null) => void;
    const ready = new Promise<string | null>((r) => void (resolve = r));
    const missing = makeRig({}, 'procedural', { documentArt: () => ({ url: null, ready: Promise.resolve(null) }) });
    void missing.ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(ctl()));
    await flush();
    expect(missing.kit.screens.el.querySelector('.vn-document__paper')?.classList.contains('has-image')).toBe(false);

    const { ui, kit } = makeRig({}, 'procedural', { documentArt: () => ({ url: null, ready }) });
    const res = track(ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(ctl())));
    kit.screens.el.querySelector<HTMLButtonElement>('.vn-document__close')?.click();
    await flush();
    expect(res.done).toBe(true);
    expect(() => resolve('./late.webp')).not.toThrow();
    await flush();
    expect(kit.screens.count).toBe(0);
  });

  it('документ открывается модальным экраном, листание под ним не работает; Esc закрывает, как крестик', async () => {
    const { ui, kit } = makeRig();
    const res = track(ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(ctl())));
    expect(kit.screens.el.querySelector('.vn-document__text')?.textContent).toBe('Текст документа');
    ui.advance();
    await flush();
    expect(res.done).toBe(false);
    expect(kit.screens.count).toBe(1);
    key('Escape');
    await flush();
    expect(res.done).toBe(true);
    expect(kit.screens.count).toBe(0);
  });

  it('выход из партии закрывает документ, но шаг не продолжает', async () => {
    const { ui, kit } = makeRig();
    const c = ctl();
    const res = track(ui.showDocument({ kind: 'document', doc: 'doc_x', text_key: 'doc.text', zoomable: false, adds_to_archive: null }, baseCtx(c)));
    c.abort();
    await flush();
    expect(kit.screens.count).toBe(0);
    expect(res.done).toBe(false);
  });

  const mgPending = (over: Partial<MinigamePending['def']> = {}): MinigamePending => ({ kind: 'minigame', def: mg('m1', over), intro_key: null });
  const mgCtx = (c: AbortController, restore: unknown = undefined): MinigameContext => ({ signal: c.signal, restore, autosave: () => undefined });

  it('мини-игра открывается на экране, результат кнопки возвращается, экран и сцена приводятся в порядок', async () => {
    const { ui, kit, mgActive } = makeRig();
    const res = track(ui.runMinigame(mgPending(), mgCtx(ctl())));
    await flush();
    expect(mgActive).toEqual([true]);
    expect(kit.screens.el.querySelector('.mg-gb__title')?.textContent).toBe('Игра');
    expect(ui.minigameState()).toEqual({ id: 'm1', state: { hintsShown: 0 } });
    kit.screens.el.querySelector<HTMLButtonElement>('.mg-btn.is-partial')?.click();
    await flush();
    expect(res.value).toBe('partial');
    expect(mgActive).toEqual([true, false]);
    expect(kit.screens.count).toBe(0);
    expect(ui.minigameState()).toBeNull();
  });

  it('пропуск доступен только если skip.allowed', async () => {
    const { ui, kit } = makeRig();
    void ui.runMinigame(mgPending({ skip: { allowed: false } }), mgCtx(ctl()));
    await flush();
    expect(kit.screens.el.querySelector('.is-skip')).toBeNull();
  });

  it('состояние мини-игры из сейва восстанавливается, пауза платформы доходит до неё', async () => {
    const { ui, kit } = makeRig();
    const def = { skip: { allowed: true, hint_rewarded_ad: true } };
    const pend = { ...mgPending(def), def: { ...mgPending(def).def, type: 'document_check' as const, config: { discrepancies: [{ hint_key: 'c.a' }, { hint_key: 'c.b' }] } } };
    const res = track(ui.runMinigame(pend, mgCtx(ctl(), { hintsShown: 2 })));
    await flush();
    expect(kit.screens.el.querySelectorAll('.mg-gb__hints li')).toHaveLength(2);
    ui.setPaused(true);
    expect(kit.screens.el.querySelector('.mg-gb.is-paused')).not.toBeNull();
    kit.screens.el.querySelector<HTMLButtonElement>('.mg-btn.is-success')?.click();
    await flush();
    expect(res.done).toBe(false); // на паузе результат не засчитывается
    ui.setPaused(false);
    kit.screens.el.querySelector<HTMLButtonElement>('.mg-btn.is-success')?.click();
    await flush();
    expect(res.value).toBe('success');
  });

  it('отмена партии во время мини-игры уничтожает её и закрывает экран', async () => {
    const { ui, kit, mgActive } = makeRig();
    const c = ctl();
    const res = track(ui.runMinigame(mgPending(), mgCtx(c)));
    await flush();
    expect(kit.screens.count).toBe(1);
    c.abort();
    await flush();
    expect(kit.screens.count).toBe(0);
    expect(mgActive).toEqual([true, false]);
    expect(res.done).toBe(false);
    expect(ui.minigameState()).toBeNull();
  });

  const ending: Ending = { id: 'e_main', title_key: 'mini.end.main', kind: 'canonical' };
  const stateWithJournal = (): GameState => ({
    ...createInitialState(episode, 's1'),
    journal: [
      { choice: 'ch1', option: 'a', scene: 's1', key: 'c.a', prompt_key: 'c.prompt', kind: 'moral' },
      { choice: 'ch2', option: 'b', scene: 's1', key: 'c.b' },
    ],
  });

  it('финал — лист уголовного дела: шапка, название эпизода, штамп с концовкой, ход следствия, итог; кнопки «Заметки» и «В меню»', async () => {
    const { ui, kit, archiveOpens } = makeRig();
    const res = track(ui.showEnding({ kind: 'end', ending }, { ...stateWithJournal(), archive: ['arc_x'] }, baseCtx(ctl())));
    const el = kit.screens.el;
    expect(el.querySelector('.vn-ending__sheet.is-canonical')).not.toBeNull();
    expect([...el.querySelectorAll('.vn-ending__head span')].map((n) => n.textContent)).toEqual(['Уголовное дело', 'x · 1993']);
    expect(el.querySelector('.vn-ending__case')?.textContent).toBe('Смерть за квартиры');
    expect(el.querySelector('.vn-ending__stamp .vn-ending__kicker')?.textContent).toBe('Финал');
    expect(el.querySelector('.vn-ending__title')?.textContent).toBe('Каноническая концовка');
    expect(el.querySelector('.vn-ending__sub')?.textContent).toBe('Ход следствия');
    expect([...el.querySelectorAll('.vn-ending__n')].map((n) => n.textContent)).toEqual(['01', '02']);
    expect([...el.querySelectorAll('.vn-ending__foot span')].map((n) => n.textContent)).toEqual(['Блокнот: 1', 'Решений: 2']); // без «/ всего» (владелец 2026-10-15)
    expect(el.querySelector('.vn-ending__actions .vn-btn')?.textContent).toBe('Заметки'); // открывает заметки этой партии
    const entries = [...el.querySelectorAll('.vn-ending__entry')];
    expect(entries.map((n) => n.querySelector('.vn-ending__choice')?.textContent)).toEqual(['Первый', 'Второй']);
    expect(entries[0]?.querySelector('.vn-ending__prompt')?.textContent).toBe('Что делаем?');
    expect(entries[0]?.classList.contains('is-moral')).toBe(true);
    key('Escape');
    expect(kit.screens.count).toBe(1); // финал не закрывается случайно
    el.querySelectorAll<HTMLButtonElement>('.vn-actions .vn-btn')[0]?.click();
    expect(archiveOpens.n).toBe(1);
    el.querySelector<HTMLButtonElement>('.vn-btn.is-primary')?.click();
    await flush();
    expect(res.done).toBe(true);
    expect(kit.screens.count).toBe(0);
  });

  it('финал без запомненных решений показывает прочерк', () => {
    const { ui, kit } = makeRig();
    void ui.showEnding({ kind: 'end', ending }, createInitialState(episode, 's1'), baseCtx(ctl()));
    expect(kit.screens.el.querySelector('.vn-ending__journal')).toBeNull();
    expect(kit.screens.el.querySelector('.vn-muted')?.textContent).toBe('—');
  });
});

describe('DomUI: смена языка на лету и сброс', () => {
  it('refreshLanguage перерисовывает показанную реплику, имя, кнопки быстрого меню и открытые экраны; сцена не трогается', async () => {
    const { ui, kit } = makeRig({ textSpeed: 5 });
    void ui.showLine(lineP('l.1'), lineCtx(ctl()));
    const dialog = { el: document.createElement('div'), render: vi.fn() };
    kit.screens.open(dialog);
    expect(kit.textbox.el.querySelector('.vn-textbox__shown')?.textContent).toBe('Первая реплика');
    i18n.setLang('en');
    ui.refreshLanguage();
    expect(kit.textbox.el.querySelector('.vn-textbox__shown')?.textContent).toBe('First line');
    expect(kit.textbox.el.querySelector('.vn-textbox__name')?.textContent).toBe('Investigator');
    expect(document.documentElement.lang).toBe('en');
    expect(dialog.render).toHaveBeenCalledTimes(2);
    await flush();
  });

  it('reset закрывает окна, выборы и экраны игры, скрывает текст и выключает Skip', async () => {
    const { ui, kit, mgActive } = makeRig({ textSpeed: 5 });
    void ui.showLine(lineP('l.1'), lineCtx(ctl()));
    void ui.showChoice({ kind: 'choice', id: 'c', prompt_key: null, choice_kind: null, timer_ms: null, default_option: null, remember: false, options: [optView('a', 'c.a')], deduction: null }, baseCtx(ctl()));
    void ui.runMinigame({ kind: 'minigame', def: mg('m1'), intro_key: null }, { signal: ctl().signal, restore: undefined, autosave: () => undefined });
    await flush();
    ui.setSkip(true);
    ui.reset();
    expect(kit.textbox.visible).toBe(false);
    expect(kit.choices.active).toBe(false);
    expect(kit.screens.count).toBe(0);
    expect(ui.skipOn).toBe(false);
    expect(mgActive.at(-1)).toBe(false);
  });
});

// ───────────────────────────── озвучка реплик ─────────────────────────────

/** Озвучка-заглушка: клипом управляет тест (finish), журнал показывает, что и когда просили. */
class FakeVoice implements ILineVoice {
  readonly started: string[] = [];
  readonly clips: VoiceClip[] = [];
  stops = 0;
  /** false — клипа нет (нет в индексе, озвучка выключена, звук недоступен). */
  hasClip = true;
  start(line: { key: string }): VoiceClip | null {
    this.started.push(line.key);
    if (!this.hasClip) return null;
    const clip = new VoiceClip(`clip:${line.key}`);
    this.clips.push(clip);
    return clip;
  }
  stop(): void {
    this.stops += 1;
  }
  get last(): VoiceClip {
    return this.clips[this.clips.length - 1]!;
  }
}

describe('DomUI: озвучка реплик', () => {
  const rigWithVoice = (over: Partial<Settings> = {}) => {
    const voice = new FakeVoice();
    return { voice, ...makeRig(over, 'procedural', { voice }) };
  };

  it('клип стартует вместе с показом реплики (по её ключу) и больше нигде', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 5 });
    void ui.showLine(lineP('l.1'), lineCtx(ctl()));
    expect(voice.started).toEqual(['l.1']);
    await flush(10_000);
    expect(voice.started).toEqual(['l.1']); // пока реплика на экране, повторных стартов нет
    expect(voice.last.state).toBe('playing');
  });

  it('листание игроком обрывает клип; первое нажатие только допечатывает текст — клип звучит дальше', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 2 });
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl())));
    const clip = voice.last;
    ui.advance(); // допечатать
    await flush();
    expect(clip.state).toBe('playing');
    expect(done.done).toBe(false);
    ui.advance(); // листнуть
    await flush();
    expect(done.done).toBe(true);
    expect(clip.state).toBe('stopped');
  });

  it('следующая реплика: клип прежней остановлен, свой клип стартует заново', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 5 });
    void ui.showLine(lineP('l.1'), lineCtx(ctl()));
    const first = voice.last;
    ui.advance();
    await flush();
    expect(first.state).toBe('stopped');
    void ui.showLine(lineP('l.2'), lineCtx(ctl()));
    expect(voice.started).toEqual(['l.1', 'l.2']);
    expect(voice.last).not.toBe(first);
    expect(voice.last.state).toBe('playing');
  });

  it('отмена партии (откат, загрузка сейва, выход в меню) обрывает клип, поздний конец клипа ничего не листает', async () => {
    const { ui, voice, kit } = rigWithVoice({ textSpeed: 5 });
    const c = ctl();
    const done = track(ui.showLine(lineP('l.1'), lineCtx(c)));
    const clip = voice.last;
    c.abort();
    expect(clip.state).toBe('stopped');
    clip.finish('ended'); // поздний конец ничего не заводит
    await flush(20_000);
    expect(done.done).toBe(false); // промис отменённой реплики разрешает Session (RunCancelled), не интерфейс
    expect(kit.textbox.visible).toBe(true);
  });

  it('reset() (Session.cancel) останавливает клип и просит озвучку замолчать', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 5 });
    void ui.showLine(lineP('l.1'), lineCtx(ctl()));
    const clip = voice.last;
    ui.reset();
    expect(clip.state).toBe('stopped');
    expect(voice.stops).toBeGreaterThanOrEqual(1);
  });

  it('Skip прочитанного: клип не запускается; Ctrl тоже; прочитанные реплики мелькают без звука', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 1 });
    ui.setSkip(true);
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl(), true)));
    await flush(100);
    expect(done.done).toBe(true);
    expect(voice.started).toEqual([]);
    key('Control');
    const done2 = track(ui.showLine(lineP('l.2'), lineCtx(ctl(), true)));
    await flush(100);
    expect(done2.done).toBe(true);
    expect(voice.started).toEqual([]);
  });

  it('Skip включили, когда идёт клип прочитанной реплики: реплика пролистывается, клип обрывается', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 1 });
    const done = track(ui.showLine(lineP('l.long'), lineCtx(ctl(), true)));
    const clip = voice.last;
    ui.toggleSkip();
    await flush(100);
    expect(done.done).toBe(true);
    expect(clip.state).toBe('stopped');
  });

  it('Skip дошёл до непрочитанной реплики: Skip выключается, реплика идёт на обычной скорости и с озвучкой', async () => {
    const { ui, voice } = rigWithVoice({ textSpeed: 5, skipUnread: false });
    ui.setSkip(true);
    void ui.showLine(lineP('l.2'), lineCtx(ctl(), false));
    expect(ui.skipOn).toBe(false);
    expect(voice.started).toEqual(['l.2']);
  });

});

describe('DomUI: подсказка пропуска (решение владельца 2026-10-11)', () => {
  it('«Пропуск» на непрочитанной реплике не включается и объясняет подсказкой; на прочитанной — включается', async () => {
    const { ui, kit } = makeRig({ textSpeed: 5 });
    void track(ui.showLine(lineP('l.1'), lineCtx(ctl(), false)));
    await flush();
    ui.toggleSkip();
    expect(ui.skipOn).toBe(false);
    expect(kit.toasts.el.querySelector('.vn-toast')?.textContent).toBe(t('ui.skip.read_only'));
    ui.advance();
    await flush();
    void track(ui.showLine(lineP('l.1'), lineCtx(ctl(), true)));
    await flush();
    ui.toggleSkip();
    expect(ui.skipOn).toBe(true);
  });
});
