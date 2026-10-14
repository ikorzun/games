// @vitest-environment jsdom
/**
 * Экраны: меню, контент-предупреждение (ui.warning.* / ui.disclaimer.*), настройки, журнал с откатом,
 * сохранение/загрузка, архив. Проверяется разметка и вызовы обработчиков, а не пиксели.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/core/i18n';
import type { SaveFile } from '../src/core/saves';
import { AUTO_DELAY_RANGE, DEFAULT_SETTINGS, FONT_SCALE_RANGE } from '../src/core/settings';
import type { Settings } from '../src/core/settings';
import { createInitialState } from '../src/core/state';
import type { Episode } from '../src/core/types';
import type { LogEntry } from '../src/session';
import { ScreenHost } from '../src/ui/screen_host';
import {
  ArchiveScreen,
  DocumentScreen,
  ErrorScreen,
  languageChips,
  LogScreen,
  MenuScreen,
  SaveLoadScreen,
  SettingsScreen,
  WarningScreen,
} from '../src/ui/screens';
import { miniEpisode } from './helpers/mini';

const episode: Episode = {
  ...miniEpisode(
    { s1: { steps: [{ do: 'end', ending: 'e_main' }] } },
    { blocks: [{ id: 'b1', entry_scene: 's1', title_key: 'mini.block.title' }] },
  ),
  estimated_minutes: 40,
  age_rating: '18+' as const,
  logline_key: 'mini.logline',
};

beforeEach(() => {
  i18n.addStrings('ru', {
    'mini.title': 'Смерть за квартиры',
    'mini.logline': 'Дело о квартирах',
    'mini.cast.a': 'Следователь Орлов',
    'mini.cast.b': 'Свидетель',
    'mini.block.title': 'Допрос',
    'mini.arc_x': 'Протокол осмотра',
    'mini.arc_y': 'Справка',
    'k.line': 'Реплика журнала',
    'ui.episode.minutes': '{n} мин',
    'ui.episode.completed': 'Пройдено',
    'ui.menu.continue': 'Продолжить',
    'ui.menu.new_game': 'Новая игра',
    'ui.menu.archive': 'Архив',
    'ui.menu.settings': 'Настройки',
    'ui.menu.language': 'Язык',
    'ui.menu.brand': 'Криминальная Россия',
    'ui.menu.season': 'Сезон {n}',
    'ui.menu.episode_n': 'Эпизод {n}',
    'ui.menu.soon': 'Скоро',
    'ui.menu.badge_new': 'Новый',
    'ui.menu.restart': 'Начать заново',
    'ui.episode.continue': 'Продолжить',
    'ui.season.s1.title': 'Современные хроники',
    'ui.lang.ru': 'Русский',
    'ui.lang.en': 'English',
    'ui.lang.es': 'Español',
    'ui.lang.pt': 'Português',
    'ui.warning.continue': 'Продолжить',
    'ui.disclaimer.title': 'Основано на реальных событиях',
    'ui.disclaimer.body': 'Сцены насилия.\n\nИмена изменены.',
    'ui.disclaimer.body_age': 'Строго {rating}.',
    'ui.disclaimer.body_age_schematic': 'Насилие схематично. 16+',
    'ui.common.close': 'Закрыть',
    'ui.settings.language': 'Язык',
    'ui.settings.font_size': 'Размер шрифта',
    'ui.settings.text_speed': 'Скорость текста',
    'ui.settings.auto_delay': 'Пауза авто',
    'ui.settings.music': 'Музыка',
    'ui.settings.sfx': 'Звуки',
    'ui.settings.voice': 'Озвучка',
    'ui.settings.voice_on': 'Озвучивать реплики',
    'ui.settings.voice_volume': 'Громкость озвучки',
    'ui.settings.timers': 'Таймеры выборов',
    'ui.settings.story_only': 'Только история',
    'ui.settings.violence_mode': 'Показ насилия',
    'ui.settings.violence_full': 'Полностью',
    'ui.settings.violence_schematic': 'Схематично',
    'ui.settings.camera_fx': 'Эффекты камеры',
    'ui.settings.camera_fx_off': 'Выкл',
    'ui.settings.camera_fx_low': 'Слабо',
    'ui.settings.camera_fx_high': 'Сильно',
    'ui.settings.skip_unread': 'Пропускать непрочитанное',
    'ui.settings.quick': 'Партия',
    'ui.quick.save': 'Сохранить',
    'ui.quick.load': 'Загрузить',
    'ui.quick.mute': 'Звук выкл.',
    'ui.quick.unmute': 'Звук вкл.',
    'ui.archive.new_item': 'Новый материал',
    'mini.doc.text': 'Текст бланка',
    'ui.quick.log': 'Журнал',
    'ui.common.back': 'Назад',
    'ui.common.ok': 'Понятно',
    'ui.common.yes': 'Да',
    'ui.common.no': 'Нет',
    'ui.archive.title': 'Архив дела',
    'ui.archive.empty': 'Пусто',
    'ui.archive.real_fact': 'Реальный факт',
    'ui.save.empty': 'Пусто',
    'ui.save.slot': 'Слот',
    'ui.save.autosave': 'Автосохранение',
    'ui.save.overwrite_confirm': 'Перезаписать?',
  });
  i18n.addStrings('en', { 'ui.menu.new_game': 'New game', 'ui.menu.badge_new': 'New', 'ui.menu.archive': 'Archive' });
  i18n.setLang('ru');
});

afterEach(() => {
  document.body.replaceChildren();
  i18n.setLang('ru');
});

function open<T extends { el: HTMLElement; render?(): void }>(screen: T): T {
  const host = new ScreenHost();
  document.body.appendChild(host.el);
  host.open(screen as never);
  return screen;
}
const texts = (el: HTMLElement, sel: string): string[] => [...el.querySelectorAll(sel)].map((n) => n.textContent ?? '');

describe('MenuScreen', () => {
  const handlers = (over: Partial<{ hasContinue: boolean; completed: boolean }> = {}) => ({
    hasContinue: () => over.hasContinue ?? false,
    completed: () => over.completed ?? false,
    onContinue: vi.fn(),
    onNew: vi.fn(),
    onArchive: vi.fn(),
    onSettings: vi.fn(),
    onLanguage: vi.fn(),
  });
  const season = {
    n: 1,
    titleKey: 'ui.season.s1.title',
    years: '1992–1997',
    slots: [
      { order: 1, year: 1993, current: true, cover: './assets/ep01/shots/apartment_zoya/wide_1.webp' },
      { order: 2, year: 1994, current: false, cover: null },
      { order: 3, year: 1995, current: false, cover: null },
    ],
  };

  it('кинескоп: шапка с сезоном, полка — текущий эпизод открыт, остальные «скоро»; иконки языка, архива и настроек', () => {
    const s = open(new MenuScreen(episode, { ...handlers(), season }));
    expect(s.el.querySelector('.vn-crt .vn-crt__screen')).not.toBeNull();
    expect(s.el.querySelector('.vn-menu__tag')?.textContent).toBe('Сезон 1 · Современные хроники · 1992–1997');
    expect(texts(s.el, '.vn-ep.is-open .vn-ep__num')).toEqual(['Эпизод 1 · 1993']);
    expect(texts(s.el, '.vn-ep.is-open .vn-ep__name')).toEqual(['Смерть за квартиры']);
    expect(texts(s.el, '.vn-ep.is-locked .vn-ep__name')).toEqual(['Скоро', 'Скоро']);
    expect(texts(s.el, '.vn-ep.is-locked .vn-ep__num')).toEqual(['Эпизод 2 · 1994', 'Эпизод 3 · 1995']);
    expect(s.el.querySelector('.vn-ep.is-locked button')).toBeNull(); // закрытые не нажимаются
    expect(s.el.querySelector<HTMLElement>('.vn-ep.is-open .vn-ep__thumb')?.style.backgroundImage).toMatch(/^url\("https?:\/\/.+wide_1\.webp"\)$/);
    expect([...s.el.querySelectorAll('.vn-menu__icons button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Язык', 'Архив', 'Настройки']);
  });

  it('без сейва клик по эпизоду — новая партия, значок «Новый», «Начать заново» нет', () => {
    const hd = handlers();
    const s = open(new MenuScreen(episode, { ...hd, season }));
    expect(s.el.querySelector('.vn-ep__badge')?.textContent).toBe('Новый');
    expect(s.el.querySelector('.vn-ep__restart')).toBeNull();
    s.el.querySelector<HTMLButtonElement>('.vn-ep__open')?.click();
    expect(hd.onNew).toHaveBeenCalledTimes(1);
    expect(hd.onContinue).not.toHaveBeenCalled();
  });

  it('с автосейвом клик по эпизоду — продолжение; «Начать заново» — новая партия; пройденный помечается', () => {
    const hd = handlers({ hasContinue: true });
    const s = open(new MenuScreen(episode, { ...hd, season }));
    expect(s.el.querySelector('.vn-ep__badge')?.textContent).toBe('Продолжить');
    s.el.querySelector<HTMLButtonElement>('.vn-ep__open')?.click();
    expect(hd.onContinue).toHaveBeenCalledTimes(1);
    s.el.querySelector<HTMLButtonElement>('.vn-ep__restart')?.click();
    expect(hd.onNew).toHaveBeenCalledTimes(1);
    const done = open(new MenuScreen(episode, { ...handlers({ completed: true }), season }));
    expect(done.el.querySelector('.vn-ep__badge')?.textContent).toBe('Пройдено');
  });

  it('без рамки сезона на полке только текущий эпизод, без подписи сезона', () => {
    const s = open(new MenuScreen(episode, handlers()));
    expect(s.el.querySelector('.vn-menu__tag')).toBeNull();
    expect(s.el.querySelectorAll('.vn-ep')).toHaveLength(1);
    expect(s.el.querySelector('.vn-ep.is-open .vn-ep__name')?.textContent).toBe('Смерть за квартиры');
  });

  it('язык: глобус раскрывает переключатель — все четыре языка названы на самих языках, выбор вызывает обработчик и закрывает его', () => {
    const hd = handlers();
    const s = open(new MenuScreen(episode, hd));
    expect(s.el.querySelector('.vn-langs')).toBeNull();
    s.el.querySelector<HTMLButtonElement>('.vn-menu__icon.is-lang')?.click();
    expect(s.el.querySelector('.vn-menu__icon.is-lang')?.getAttribute('aria-expanded')).toBe('true');
    expect(texts(s.el, '.vn-langs button')).toEqual(['RU', 'EN', 'ES', 'PT']); // коды; полное имя — в title и aria-label
    expect([...s.el.querySelectorAll('.vn-langs button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Русский', 'English', 'Español', 'Português']);
    expect(s.el.querySelector('.vn-chip.is-on')?.getAttribute('data-lang')).toBe('ru');
    s.el.querySelector<HTMLButtonElement>('[data-lang="es"]')?.click();
    expect(hd.onLanguage).toHaveBeenCalledWith('es');
    expect(s.el.querySelector('.vn-langs')).toBeNull();
    expect(s.el.querySelector('.vn-menu__lang-code')?.textContent).toBe('RU');
  });

  it('эпизод переведён на один язык: глобуса в меню и выбора языка в настройках нет', () => {
    i18n.setAvailable(['ru']);
    try {
      const s = open(new MenuScreen(episode, handlers()));
      expect(s.el.querySelector('.vn-menu__icon.is-lang')).toBeNull();
      expect(languageChips(() => undefined).querySelectorAll('button')).toHaveLength(1);
    } finally {
      i18n.setAvailable(['ru', 'en', 'es', 'pt']);
    }
  });

  it('архив и настройки — иконками', () => {
    const hd = handlers();
    const s = open(new MenuScreen(episode, hd));
    s.el.querySelector<HTMLButtonElement>('.vn-menu__icon.is-archive')?.click();
    s.el.querySelector<HTMLButtonElement>('.vn-menu__icon.is-settings')?.click();
    expect(hd.onArchive).toHaveBeenCalledTimes(1);
    expect(hd.onSettings).toHaveBeenCalledTimes(1);
  });

  it('смена языка: render() перерисовывает меню на лету', () => {
    i18n.addStrings('en', { 'mini.title': 'Death for apartments' });
    const s = open(new MenuScreen(episode, handlers()));
    i18n.setLang('en');
    s.render();
    expect(s.el.querySelector('.vn-ep__name')?.textContent).toBe('Death for apartments');
    expect(s.el.querySelector('.vn-ep__badge')?.textContent).toBe('New');
    expect(s.el.querySelector('.vn-menu__icon.is-archive')?.getAttribute('aria-label')).toBe('Archive');
  });

  it('логотип передачи — картинка с названием в alt; без файла — название передачи текстом', () => {
    const hd: ReturnType<typeof handlers> & { art?: { plate: string | null; logo: string | null } } = {
      ...handlers(),
      art: { plate: null, logo: './assets/common/ui/logo_kr.webp' },
    };
    const s = open(new MenuScreen(episode, hd));
    const img = s.el.querySelector<HTMLImageElement>('img.vn-menu__logo');
    expect(img?.getAttribute('src')).toBe('./assets/common/ui/logo_kr.webp');
    expect(img?.alt).toBe('Криминальная Россия');
    hd.art = { plate: null, logo: null };
    s.render();
    expect(s.el.querySelector('img.vn-menu__logo')).toBeNull();
    expect(s.el.querySelector('h1.vn-menu__title')?.textContent).toBe('Криминальная Россия');
  });

  it('прокрутка сжимает шапку: --p растёт до 1 за 140 px, --q включается на последних 40 %', () => {
    const s = open(new MenuScreen(episode, { ...handlers(), season }));
    const scroll = s.el.querySelector<HTMLElement>('.vn-menu__scroll')!;
    for (const [y, p, q] of [[70, '0.500', '0.000'], [112, '0.800', '0.500'], [400, '1.000', '1.000']] as const) {
      Object.defineProperty(scroll, 'scrollTop', { value: y, configurable: true });
      scroll.dispatchEvent(new Event('scroll'));
      expect([scroll.style.getPropertyValue('--p'), scroll.style.getPropertyValue('--q')]).toEqual([p, q]);
    }
  });
});

describe('WarningScreen: «Основано на реальных событиях» перед эпизодом', () => {
  const make = (over: Partial<Settings> = {}) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
    const hd = { settings: () => settings, onContinue: vi.fn(), onBack: vi.fn() };
    return { s: open(new WarningScreen(episode, hd)), hd, settings };
  };
  const paragraphs = (el: HTMLElement): string[] => [...el.querySelectorAll('.vn-warning__body p')].map((p) => p.textContent ?? '');

  it('заголовок, текст абзацами (пустая строка в локали — новый абзац) и возраст из эпизода', () => {
    const { s } = make();
    expect(s.el.querySelector('.vn-warning__title')?.textContent).toBe('Основано на реальных событиях');
    expect(paragraphs(s.el)).toEqual(['Сцены насилия.', 'Имена изменены.', 'Строго 18+.']);
  });

  it('логотип передачи справа вверху — если файл есть; нет файла — без картинки', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS };
    const withLogo = open(new WarningScreen(episode, { settings: () => settings, onContinue: vi.fn(), onBack: vi.fn(), logo: './assets/common/ui/logo_kr.webp' }));
    expect(withLogo.el.querySelector<HTMLImageElement>('img.vn-warning__logo')?.getAttribute('src')).toBe('./assets/common/ui/logo_kr.webp');
    const { s } = make();
    expect(s.el.querySelector('img.vn-warning__logo')).toBeNull();
  });

  it('в схематичном режиме (сборка 16+) вместо «Строго 18+» — строка про схематичный показ', () => {
    const { s } = make({ violenceMode: 'schematic' });
    expect(paragraphs(s.el)).toEqual(['Сцены насилия.', 'Имена изменены.', 'Насилие схематично. 16+']);
  });

  it('по макету только «Назад» и «Продолжить»: ни переключателя режима, ни «Подробнее», ни «Больше не показывать»; Esc экран не закрывает', () => {
    const { s, hd } = make();
    expect(s.el.querySelectorAll('input')).toHaveLength(0);
    expect(s.el.querySelectorAll('button')).toHaveLength(2);
    s.el.querySelector<HTMLButtonElement>('.vn-warning__actions .vn-btn.is-primary')?.click();
    expect(hd.onContinue).toHaveBeenCalledTimes(1);
    s.el.querySelector<HTMLButtonElement>('.vn-warning__actions .vn-btn:not(.is-primary)')?.click();
    expect(hd.onBack).toHaveBeenCalledTimes(1);
    expect(s.dismissible).toBe(false);
  });
});

describe('SettingsScreen: ряд «Партия» (сохранить / загрузить / звук)', () => {
  it('сохранить и загрузить — только в игре, звук — всегда; кнопка звука переключает состояние и перерисовывается', () => {
    let inGame = false;
    let muted = false;
    const onMute = vi.fn(() => {
      muted = !muted;
    });
    const hd = {
      settings: () => ({ ...DEFAULT_SETTINGS }),
      onChange: vi.fn(),
      onLanguage: vi.fn(),
      onClose: vi.fn(),
      inGame: () => inGame,
      muted: () => muted,
      onSave: vi.fn(),
      onLoad: vi.fn(),
      onMute,
    };
    const s = open(new SettingsScreen(hd));
    const actions = (): string[] => [...s.el.querySelectorAll<HTMLElement>('.vn-settings__qbtn')].map((b) => b.dataset.action ?? '');
    expect(actions()).toEqual(['mute']);
    expect(s.el.querySelector('.vn-settings__qbtn[data-action="mute"]')?.textContent).toBe('Звук выкл.');
    s.el.querySelector<HTMLButtonElement>('.vn-settings__qbtn[data-action="mute"]')?.click();
    expect(onMute).toHaveBeenCalledTimes(1);
    expect(s.el.querySelector('.vn-settings__qbtn[data-action="mute"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(s.el.querySelector('.vn-settings__qbtn[data-action="mute"]')?.textContent).toBe('Звук вкл.');
    inGame = true;
    s.render();
    expect(actions()).toEqual(['save', 'load', 'mute']);
    s.el.querySelector<HTMLButtonElement>('.vn-settings__qbtn[data-action="save"]')?.click();
    s.el.querySelector<HTMLButtonElement>('.vn-settings__qbtn[data-action="load"]')?.click();
    expect(hd.onSave).toHaveBeenCalledTimes(1);
    expect(hd.onLoad).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen', () => {
  const make = (over: Partial<Settings> = {}) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
    const hd = {
      settings: () => settings,
      onChange: vi.fn(),
      onLanguage: vi.fn(),
      onClose: vi.fn(),
    };
    return { s: open(new SettingsScreen(hd)), hd };
  };
  const range = (el: HTMLElement, label: string): HTMLInputElement => {
    const input = [...el.querySelectorAll<HTMLInputElement>('input[type="range"]')].find((i) => i.getAttribute('aria-label') === label);
    if (!input) throw new Error(`нет ползунка «${label}»`);
    return input;
  };
  const slide = (input: HTMLInputElement, value: number): void => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('размер шрифта, скорость текста, пауза авто, громкости — ползунки с границами из настроек', () => {
    const { s } = make();
    const font = range(s.el, 'Размер шрифта');
    expect([Number(font.min), Number(font.max)]).toEqual([FONT_SCALE_RANGE.min, FONT_SCALE_RANGE.max]);
    const delay = range(s.el, 'Пауза авто');
    expect([Number(delay.min), Number(delay.max)]).toEqual([AUTO_DELAY_RANGE.min, AUTO_DELAY_RANGE.max]);
    expect([Number(range(s.el, 'Скорость текста').min), Number(range(s.el, 'Скорость текста').max)]).toEqual([1, 5]);
    for (const label of ['Музыка', 'Звуки', 'Громкость озвучки']) expect(Number(range(s.el, label).max)).toBe(1);
  });

  it('движение ползунков отдаёт точечный патч настроек и обновляет подпись значения', () => {
    const { s, hd } = make();
    slide(range(s.el, 'Размер шрифта'), 1.3);
    expect(hd.onChange).toHaveBeenLastCalledWith({ fontScale: 1.3 });
    expect(s.el.querySelector('.vn-range__out')?.textContent).toBe('130%');
    slide(range(s.el, 'Скорость текста'), 5);
    expect(hd.onChange).toHaveBeenLastCalledWith({ textSpeed: 5 });
    slide(range(s.el, 'Пауза авто'), 3000);
    expect(hd.onChange).toHaveBeenLastCalledWith({ autoDelayMs: 3000 });
  });

  it('таймеры выборов и «только история» — флажки; режим насилия — переключатель', () => {
    const { s, hd } = make({ timers: true, storyOnly: false });
    const box = (name: string): HTMLInputElement => s.el.querySelector<HTMLInputElement>(`input[type="checkbox"][data-setting="${name}"]`)!;
    expect([box('timers').checked, box('storyOnly').checked]).toEqual([true, false]);
    box('timers').checked = false;
    box('timers').dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ timers: false });
    box('storyOnly').checked = true;
    box('storyOnly').dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ storyOnly: true });
    const radios = [...s.el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    radios[1]?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ violenceMode: 'schematic' });
  });

  it('язык переключается из настроек; «Назад» закрывает', () => {
    const { s, hd } = make();
    s.el.querySelector<HTMLButtonElement>('[data-lang="pt"]')?.click();
    expect(hd.onLanguage).toHaveBeenCalledWith('pt');
    s.el.querySelector<HTMLButtonElement>('.vn-actions .vn-btn')?.click();
    expect(hd.onClose).toHaveBeenCalledTimes(1);
  });

  it('сохранённые значения отображаются в элементах управления', () => {
    const { s } = make({ fontScale: 1.45, textSpeed: 4, timers: false, storyOnly: true, violenceMode: 'schematic' });
    expect(range(s.el, 'Размер шрифта').value).toBe('1.45');
    expect(range(s.el, 'Скорость текста').value).toBe('4');
    const box = (name: string): boolean => s.el.querySelector<HTMLInputElement>(`input[type="checkbox"][data-setting="${name}"]`)!.checked;
    expect([box('timers'), box('storyOnly')]).toEqual([false, true]);
    expect([...s.el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.checked)).toEqual([false, true]);
  });
});

describe('SettingsScreen: озвучка', () => {
  const make = (over: Partial<Settings> = {}) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
    const hd = {
      settings: () => settings,
      onChange: vi.fn((patch: Partial<Settings>) => void Object.assign(settings, patch)),
      onLanguage: vi.fn(),
      onClose: vi.fn(),
    };
    return { s: open(new SettingsScreen(hd)), hd, settings };
  };
  const box = (el: HTMLElement): HTMLInputElement => el.querySelector<HTMLInputElement>('input[type="checkbox"][data-setting="voiceEnabled"]')!;
  const slider = (el: HTMLElement): HTMLInputElement => el.querySelector<HTMLInputElement>('.vn-voice input[type="range"]')!;

  it('пункт «Озвучка»: название группы, переключатель и ползунок громкости 0–100 % в одной группе; по умолчанию включено, 90 %', () => {
    const { s } = make();
    const group = s.el.querySelector<HTMLElement>('.vn-voice')!;
    expect(group.querySelector('.vn-settings__legend')?.textContent).toBe('Озвучка');
    expect(group.textContent).toContain('Озвучивать реплики');
    expect(box(s.el).checked).toBe(true);
    expect([slider(s.el).min, slider(s.el).max, slider(s.el).value]).toEqual(['0', '1', '0.9']);
    expect(slider(s.el).getAttribute('aria-label')).toBe('Громкость озвучки');
    expect(group.querySelector('.vn-range__out')?.textContent).toBe('90%');
    expect(slider(s.el).disabled).toBe(false);
  });

  it('переключатель отдаёт патч {voiceEnabled}, не перерисовывая экран; пока озвучка выключена, ползунок недоступен', () => {
    const { s, hd, settings } = make();
    const before = box(s.el);
    box(s.el).checked = false;
    box(s.el).dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ voiceEnabled: false });
    expect(settings.voiceEnabled).toBe(false);
    expect(slider(s.el).disabled).toBe(true);
    expect(box(s.el)).toBe(before); // тот же элемент: фокус клавиатуры не теряется
    box(s.el).checked = true;
    box(s.el).dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ voiceEnabled: true });
    expect(slider(s.el).disabled).toBe(false);
  });

  it('ползунок отдаёт патч {voice} (громкость озвучки) и обновляет подпись', () => {
    const { s, hd } = make();
    slider(s.el).value = '0.4';
    slider(s.el).dispatchEvent(new Event('input', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ voice: 0.4 });
    expect(s.el.querySelector('.vn-voice .vn-range__out')?.textContent).toBe('40%');
  });

  it('сохранённые значения показываются: выключенная озвучка — флажок снят, ползунок недоступен и стоит на своём месте', () => {
    const { s } = make({ voiceEnabled: false, voice: 0.35 });
    expect(box(s.el).checked).toBe(false);
    expect(slider(s.el).disabled).toBe(true);
    expect(slider(s.el).value).toBe('0.35');
  });
});

describe('SettingsScreen: эффекты камеры', () => {
  const make = (over: Partial<Settings> = {}, reduced = false, effective?: Settings['cameraFx']) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
    const hd = {
      settings: () => settings,
      reducedMotion: () => reduced,
      ...(effective ? { effectiveCameraFx: () => effective } : {}),
      onChange: vi.fn((patch: Partial<Settings>) => void Object.assign(settings, patch)),
      onLanguage: vi.fn(),
      onClose: vi.fn(),
    };
    return { s: open(new SettingsScreen(hd)), hd, settings };
  };
  const chips = (el: HTMLElement): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('.vn-camfx .vn-chip')];
  const on = (el: HTMLElement): string[] => chips(el).filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.cameraFx ?? '');

  it('три сегмента Выкл / Слабо / Сильно с названием группы; по умолчанию включено «Слабо»', () => {
    const { s } = make();
    expect(chips(s.el).map((c) => c.dataset.cameraFx)).toEqual(['off', 'low', 'high']);
    expect(chips(s.el).map((c) => c.textContent)).toEqual(['Выкл', 'Слабо', 'Сильно']);
    expect(s.el.querySelector('.vn-camfx')?.getAttribute('aria-label')).toBe('Эффекты камеры');
    expect(on(s.el)).toEqual(['low']);
    expect(chips(s.el).every((c) => !c.disabled)).toBe(true);
    // группа стоит рядом с языком, до ползунков звука и текста
    const groups = [...s.el.querySelectorAll('.vn-settings__legend')].map((n) => n.textContent);
    expect(groups.indexOf('Эффекты камеры')).toBe(groups.indexOf('Язык') + 1);
  });

  it('выбор уровня отдаёт патч {cameraFx} и сразу перерисовывает отметку', () => {
    const { s, hd, settings } = make();
    chips(s.el)[2]!.click();
    expect(hd.onChange).toHaveBeenLastCalledWith({ cameraFx: 'high' });
    expect(settings.cameraFx).toBe('high');
    expect(on(s.el)).toEqual(['high']);
    chips(s.el)[0]!.click();
    expect(hd.onChange).toHaveBeenLastCalledWith({ cameraFx: 'off' });
    expect(on(s.el)).toEqual(['off']);
    expect(hd.onChange).toHaveBeenCalledTimes(2);
  });

  it('сохранённое значение показывается: отмечен ровно один сегмент', () => {
    expect(on(make({ cameraFx: 'off' }).s.el)).toEqual(['off']);
    expect(on(make({ cameraFx: 'high' }).s.el)).toEqual(['high']);
  });

  it('самозащита от слабого устройства: в настройках «Слабо», но действует «Выкл» — отмечено действующее, сегменты доступны; выбор уровня уходит в onChange', () => {
    const { s, hd } = make({ cameraFx: 'low' }, false, 'off');
    expect(on(s.el)).toEqual(['off']);
    expect(chips(s.el).every((c) => !c.disabled)).toBe(true);
    chips(s.el)[1]!.click(); // «Слабо» ещё раз: в настройках уровень прежний, но это явный выбор
    expect(hd.onChange).toHaveBeenLastCalledWith({ cameraFx: 'low' });
  });

  it('prefers-reduced-motion: все сегменты недоступны, отмечено «Выкл», выбор настроек не меняется', () => {
    const { s, hd, settings } = make({ cameraFx: 'high' }, true);
    expect(chips(s.el).every((c) => c.disabled)).toBe(true);
    expect(on(s.el)).toEqual(['off']); // показываем фактическое состояние
    chips(s.el)[1]!.click(); // disabled-кнопка клика не принимает
    expect(hd.onChange).not.toHaveBeenCalled();
    expect(settings.cameraFx).toBe('high'); // выбор пользователя сохранён и вернётся, когда reduced-motion снимут
  });
});

describe('LogScreen: журнал реплик и откат', () => {
  const entries: LogEntry[] = [
    { kind: 'say', who: 'a', key: 'k.line', narrate_style: null },
    { kind: 'narrate', who: null, key: 'k.line', narrate_style: 'voiceover' },
    { kind: 'say', who: 'b', key: 'k.line', narrate_style: null },
  ];

  it('показывает имена говорящих (у рассказчика имени нет) и кнопку отката только там, куда можно вернуться', () => {
    const onRollback = vi.fn();
    const s = open(new LogScreen(episode, { entries: () => entries, maxRollback: () => 1, onRollback, onClose: vi.fn() }));
    const items = [...s.el.querySelectorAll('.vn-log__item')];
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.querySelector('.vn-log__name')?.textContent ?? null)).toEqual(['Следователь Орлов', null, 'Свидетель']);
    expect(items[1]?.classList.contains('is-voiceover')).toBe(true);
    // Последняя реплика — текущая, откат на неё бессмыслен; глубже лимита — тоже нельзя.
    expect(items.map((i) => i.querySelector('.vn-log__back') !== null)).toEqual([false, true, false]);
    items[1]?.querySelector<HTMLButtonElement>('.vn-log__back')?.click();
    expect(onRollback).toHaveBeenCalledWith(1);
  });

  it('пустой журнал — заглушка; «Назад» закрывает', () => {
    const onClose = vi.fn();
    const s = open(new LogScreen(episode, { entries: () => [], maxRollback: () => 0, onRollback: vi.fn(), onClose }));
    expect(s.el.querySelector('.vn-muted')?.textContent).toBe('Пусто');
    s.el.querySelector<HTMLButtonElement>('.vn-actions .vn-btn')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SaveLoadScreen', () => {
  const file = (scene = 's1'): SaveFile => ({
    schema_version: 1,
    content_version: 'v1',
    saved_at: '2026-10-10T10:00:00.000Z',
    state: createInitialState(episode, scene),
  });
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('загрузка: автосохранение первым, пустые слоты недоступны, занятые загружают', async () => {
    const onLoad = vi.fn();
    const auto = file();
    const s = open(
      new SaveLoadScreen(episode, {
        mode: 'load',
        autosave: () => auto,
        listManual: () => Promise.resolve([null, file(), null]),
        onLoad,
        onSave: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await settle();
    const slots = [...s.el.querySelectorAll<HTMLButtonElement>('.vn-slot')];
    expect(slots.map((b) => b.dataset.slot)).toEqual(['auto', '1', '2', '3']);
    expect(slots.map((b) => b.disabled)).toEqual([false, true, false, true]);
    expect(slots[1]?.querySelector('.vn-slot__info')?.textContent).toBe('Пусто');
    expect(slots[0]?.querySelector('.vn-slot__label')?.textContent).toBe('Автосохранение');
    slots[2]?.click();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('сохранение: в пустой слот — сразу; в занятый — после подтверждения «Перезаписать?»', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const s = open(
      new SaveLoadScreen(episode, {
        mode: 'save',
        autosave: () => null,
        listManual: () => Promise.resolve([null, file()]),
        onLoad: vi.fn(),
        onSave,
        onClose: vi.fn(),
      }),
    );
    await settle();
    expect(s.el.querySelectorAll('.vn-slot')).toHaveLength(2); // автосейва при сохранении нет
    s.el.querySelector<HTMLButtonElement>('[data-slot="1"]')?.click();
    await settle();
    expect(onSave).toHaveBeenCalledWith(1);

    s.el.querySelector<HTMLButtonElement>('[data-slot="2"]')?.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(s.el.querySelector('.vn-confirm p')?.textContent).toBe('Перезаписать?');
    s.el.querySelector<HTMLButtonElement>('.vn-confirm .vn-btn:not(.is-primary)')?.click(); // «Нет»
    expect(s.el.querySelector('.vn-confirm')).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
    s.el.querySelector<HTMLButtonElement>('[data-slot="2"]')?.click();
    s.el.querySelector<HTMLButtonElement>('.vn-confirm .vn-btn.is-primary')?.click(); // «Да»
    await settle();
    expect(onSave).toHaveBeenLastCalledWith(2);
  });

  it('занятый слот подписан названием блока и датой; для Playgama слот один', async () => {
    const withView: SaveFile = { ...file(), view: { scene: 's1', block: 'b1' } as SaveFile['view'] };
    const s = open(
      new SaveLoadScreen(episode, {
        mode: 'load',
        autosave: () => null,
        listManual: () => Promise.resolve([withView]),
        onLoad: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await settle();
    expect(s.el.querySelectorAll('.vn-slot')).toHaveLength(2); // автосейв + один слот
    expect(s.el.querySelector('[data-slot="1"] .vn-slot__info')?.textContent).toContain('Допрос');
  });
});

describe('ArchiveScreen и ErrorScreen', () => {
  it('архив показывает только открытые материалы с метками реальных фактов', () => {
    const ep = {
      ...episode,
      archive_items: [
        { id: 'arc_x', kind: 'fact' as const, title_key: 'mini.arc_x', real_fact: true },
        { id: 'arc_y', kind: 'document' as const, title_key: 'mini.arc_y' },
      ],
    };
    const unlocked: string[] = ['arc_x'];
    const s = open(new ArchiveScreen(ep, () => unlocked, vi.fn()));
    expect(texts(s.el, '.vn-archive__item h3')).toEqual(['Протокол осмотра']);
    expect(s.el.querySelector('.vn-badge')?.textContent).toBe('Реальный факт');
    unlocked.push('arc_y');
    s.render();
    expect(texts(s.el, '.vn-archive__item h3')).toEqual(['Протокол осмотра', 'Справка']);
    unlocked.length = 0;
    s.render();
    expect(s.el.querySelector('.vn-archive__empty')?.textContent).toBe('Пусто');
  });

  it('блокнот: бумажки на странице, бумага дела — сканом под скрепкой, касание открывает её; новое — под штампом', async () => {
    const ep = {
      ...episode,
      archive_items: [
        { id: 'arc_x', kind: 'fact' as const, title_key: 'mini.arc_x', text_key: 'mini.doc.text' },
        { id: 'arc_y', kind: 'document' as const, title_key: 'mini.arc_y', text_key: 'mini.doc.text', asset: 'doc_y' },
      ],
    };
    let loaded: (url: string | null) => void = () => undefined;
    const art = vi.fn(() => ({ url: null, ready: new Promise<string | null>((r) => (loaded = r)) }));
    const opened: string[] = [];
    const onDone = vi.fn();
    const s = open(
      new ArchiveScreen(ep, () => ['arc_x', 'arc_y'], onDone, 'ui.archive.title', {
        documentArt: art,
        onOpenDocument: (item) => opened.push(item.id),
        isNew: (id) => id === 'arc_y',
      }),
    );
    expect(s.el.querySelector('.vn-archive__title')?.textContent).toBe('Архив дела');
    const fact = s.el.querySelector<HTMLElement>('.vn-archive__item.is-fact')!;
    expect(fact.querySelector('h3')?.textContent).toBe('Протокол осмотра');
    expect(fact.querySelector('p')?.textContent).toBe('Текст бланка');
    expect(fact.querySelector('.vn-archive__stamp')).toBeNull();
    // скан: кнопка с картинкой и скрепкой, полного текста бумаги в блокноте нет
    const doc = s.el.querySelector<HTMLElement>('.vn-archive__item.is-document')!;
    expect(doc.classList.contains('has-scan')).toBe(true);
    expect(art).toHaveBeenCalledWith('doc_y');
    expect(doc.querySelector('p')).toBeNull();
    const btn = doc.querySelector<HTMLButtonElement>('button.vn-archive__open')!;
    expect(btn.getAttribute('aria-label')).toBe('Справка');
    expect(btn.querySelector('.vn-archive__clip')).not.toBeNull();
    const img = btn.querySelector<HTMLImageElement>('img.vn-archive__scan')!;
    expect(img.getAttribute('src')).toBeNull(); // скан ещё грузится
    loaded('./assets/doc_y.webp');
    await Promise.resolve();
    expect(img.getAttribute('src')).toBe('./assets/doc_y.webp');
    btn.click();
    expect(opened).toEqual(['arc_y']);
    expect(doc.querySelector('.vn-archive__stamp')?.textContent).toBe('Новый материал');
    s.el.querySelector<HTMLButtonElement>('.vn-document__close')?.click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ход следствия: в партии записи в порядке находок, с номерами и слоем стрелок; в меню — порядок эпизода, без них', () => {
    const ep = {
      ...episode,
      archive_items: [
        { id: 'arc_x', kind: 'fact' as const, title_key: 'mini.arc_x' },
        { id: 'arc_y', kind: 'photo' as const, title_key: 'mini.arc_y', text_key: 'mini.doc.text', asset: 'doc_p' },
      ],
    };
    const art = vi.fn(() => ({ url: './assets/doc_p.webp', ready: Promise.resolve('./assets/doc_p.webp') }));
    const found = ['arc_y', 'arc_x', 'arc_y']; // порядок находок партии (повтор не дублирует запись)
    const game = open(new ArchiveScreen(ep, () => found, vi.fn(), 'ui.archive.title', { path: true, documentArt: art }));
    expect(texts(game.el, '.vn-archive__item h3')).toEqual(['Справка', 'Протокол осмотра']);
    expect(texts(game.el, '.vn-archive__num')).toEqual(['1', '2']);
    expect(game.el.querySelector('.vn-archive__board svg.vn-archive__lines')).not.toBeNull();
    // фото — отпечатком, не кнопкой: окно документа для снимка не нужно
    const photo = game.el.querySelector<HTMLElement>('.vn-archive__item.is-photo')!;
    expect(photo.classList.contains('has-print')).toBe(true);
    expect(photo.querySelector('img.vn-archive__print')?.getAttribute('src')).toBe('./assets/doc_p.webp');
    expect(photo.querySelector('button')).toBeNull();
    const menu = open(new ArchiveScreen(ep, () => found, vi.fn()));
    expect(texts(menu.el, '.vn-archive__item h3')).toEqual(['Протокол осмотра', 'Справка']);
    expect(menu.el.querySelector('.vn-archive__num')).toBeNull();
    expect(menu.el.querySelector('.vn-archive__lines')).toBeNull();
  });

  it('блокнот: наклон и бумага — от id записи (новая запись не перекладывает старые); без окна документа бумага — текстом', () => {
    const ep = {
      ...episode,
      archive_items: [
        { id: 'arc_x', kind: 'fact' as const, title_key: 'mini.arc_x' },
        { id: 'arc_y', kind: 'document' as const, title_key: 'mini.arc_y', text_key: 'mini.doc.text', asset: 'doc_y' },
      ],
    };
    const unlocked = ['arc_y'];
    const s = open(new ArchiveScreen(ep, () => unlocked, vi.fn()));
    const look = (id: string): string => {
      const li = [...s.el.querySelectorAll<HTMLElement>('.vn-archive__item')].find((x) => x.querySelector('h3')?.textContent === id)!;
      return `${li.style.getPropertyValue('--tilt')} ${li.dataset.paper}`;
    };
    const before = look('Справка');
    unlocked.unshift('arc_x');
    s.render();
    expect(look('Справка')).toBe(before);
    expect(s.el.querySelector('.vn-archive__item.is-document p')?.textContent).toBe('Текст бланка');
    expect(s.el.querySelector('.vn-archive__open')).toBeNull();
  });

  it('экран ошибки показывает сообщение и закрывается кнопкой', () => {
    const onDone = vi.fn();
    const s = open(new ErrorScreen('что-то сломалось', onDone));
    expect(s.el.querySelector('.vn-error__msg')?.textContent).toBe('что-то сломалось');
    s.el.querySelector<HTMLButtonElement>('.vn-btn')?.click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentScreen: бланк с картинкой', () => {
  const abs = (u: string): string => `url("${new URL(u, document.baseURI).href}")`;
  const make = (image: string | null = null, textKey: string | null = 'mini.doc.text', archiveItem: string | null = null) => {
    const onDone = vi.fn();
    const s = open(new DocumentScreen(episode, 'doc_x', textKey, archiveItem, onDone, image));
    return { s, onDone };
  };
  const paper = (el: HTMLElement): HTMLElement => el.querySelector<HTMLElement>('.vn-document__paper')!;

  it('без картинки бланк — обычный лист; текст берётся из локали', () => {
    const { s } = make();
    expect(paper(s.el).classList.contains('has-image')).toBe(false);
    expect(paper(s.el).style.getPropertyValue('--doc-img')).toBe('');
    expect(paper(s.el).dataset.doc).toBe('doc_x');
    expect(s.el.querySelector('.vn-document__text')?.textContent).toBe('Текст бланка');
  });

  it('картинка бланка без текста: класс has-image и абсолютный --doc-img; текст накладывается слоем из локали', () => {
    const { s } = make('./assets/ep01/documents/doc_x.webp');
    expect(paper(s.el).classList.contains('has-image')).toBe(true);
    expect(paper(s.el).style.getPropertyValue('--doc-img')).toBe(abs('./assets/ep01/documents/doc_x.webp'));
    expect(s.el.querySelector('.vn-document__text')?.textContent).toBe('Текст бланка');
  });

  it('картинка пришла позже: setImage включает её на уже открытом экране, null — убирает; перерисовка сохраняет выбор', () => {
    const { s } = make();
    s.setImage('./assets/ep01/documents/doc_x.webp');
    expect(paper(s.el).classList.contains('has-image')).toBe(true);
    expect(paper(s.el).style.getPropertyValue('--doc-img')).toBe(abs('./assets/ep01/documents/doc_x.webp'));
    s.render(); // например, смена языка
    expect(paper(s.el).classList.contains('has-image')).toBe(true);
    s.setImage(null);
    expect(paper(s.el).classList.contains('has-image')).toBe(false);
    expect(paper(s.el).style.getPropertyValue('--doc-img')).toBe('');
  });

  it('setImage до отрисовки ничего не ломает; шапка по макету — название, метка «новый материал», крестик закрывает', () => {
    const onDone = vi.fn();
    const fresh = new DocumentScreen(episode, 'doc_x', null, null, onDone);
    expect(() => fresh.setImage('./a.webp')).not.toThrow();
    const { s, onDone: done } = make(null, 'mini.doc.text', 'arc_x');
    expect(s.el.querySelector('.vn-document__head .vn-document__tag')?.textContent).toBe('Новый материал');
    expect(s.el.querySelector('.vn-document__head .vn-document__title')).not.toBeNull();
    expect(s.el.querySelector('.vn-actions')).toBeNull();
    const close = s.el.querySelector<HTMLButtonElement>('.vn-document__close');
    expect(close?.getAttribute('aria-label')).toBe('Закрыть');
    expect(close?.querySelector('svg.vn-ico--close')).not.toBeNull();
    close?.click();
    expect(done).toHaveBeenCalledTimes(1);
    expect(s.dismissible).toBe(true); // Esc закрывает (DomUI продолжает партию через onClose)
  });

  it('бумага, открытая из блокнота, — с названием, но без метки «новый материал»', () => {
    const s = open(new DocumentScreen(episode, 'doc_x', 'mini.doc.text', 'arc_x', vi.fn(), null, false, false));
    expect(s.el.querySelector('.vn-document__title')?.textContent).toBe('Протокол осмотра');
    expect(s.el.querySelector('.vn-document__tag')).toBeNull();
  });

  it('настоящая бумага: увеличенный лист двигается мышью с зажатой кнопкой; перетаскивание не меняет масштаб, палец — прокрутка браузера', () => {
    const s = open(new DocumentScreen(episode, 'doc_x', 'mini.doc.text', null, vi.fn(), './a.webp', true));
    const sheet = s.el.querySelector<HTMLElement>('.vn-document__sheet')!;
    const scroll = { left: 0, top: 0 };
    Object.defineProperty(sheet, 'scrollLeft', { get: () => scroll.left, set: (v: number) => void (scroll.left = v), configurable: true });
    Object.defineProperty(sheet, 'scrollTop', { get: () => scroll.top, set: (v: number) => void (scroll.top = v), configurable: true });
    const ev = (type: string, x: number, y: number, pointerType = 'mouse'): PointerEvent => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }) as PointerEvent;
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      return e;
    };
    // не увеличен — перетаскивания нет, клик увеличивает
    sheet.dispatchEvent(ev('pointerdown', 100, 100));
    sheet.dispatchEvent(ev('pointermove', 50, 40));
    expect(scroll).toEqual({ left: 0, top: 0 });
    sheet.dispatchEvent(ev('pointerup', 50, 40));
    sheet.click();
    expect(sheet.classList.contains('is-zoomed')).toBe(true);
    // увеличен — тянем мышью: лист едет за рукой
    scroll.left = 200;
    scroll.top = 100;
    sheet.dispatchEvent(ev('pointerdown', 300, 300));
    sheet.dispatchEvent(ev('pointermove', 260, 250));
    expect(sheet.classList.contains('is-dragging')).toBe(true);
    expect(scroll).toEqual({ left: 240, top: 150 });
    sheet.dispatchEvent(ev('pointerup', 260, 250));
    sheet.click(); // клик после перетаскивания — не клик
    expect(sheet.classList.contains('is-zoomed')).toBe(true);
    expect(sheet.classList.contains('is-dragging')).toBe(false);
    // дрожь руки меньше 4 px — это клик: масштаб назад
    sheet.dispatchEvent(ev('pointerdown', 300, 300));
    sheet.dispatchEvent(ev('pointermove', 302, 301));
    sheet.dispatchEvent(ev('pointerup', 302, 301));
    expect(scroll).toEqual({ left: 240, top: 150 });
    sheet.click();
    expect(sheet.classList.contains('is-zoomed')).toBe(false);
    // палец: скрипт не двигает, листает сам браузер (overflow: auto)
    sheet.click();
    sheet.dispatchEvent(ev('pointerdown', 300, 300, 'touch'));
    sheet.dispatchEvent(ev('pointermove', 200, 200, 'touch'));
    expect(scroll).toEqual({ left: 240, top: 150 });
  });
});
