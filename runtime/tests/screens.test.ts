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
  LogScreen,
  MenuScreen,
  SaveLoadScreen,
  SettingsScreen,
  SplashScreen,
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
    'ui.lang.ru': 'Русский',
    'ui.lang.en': 'English',
    'ui.lang.es': 'Español',
    'ui.lang.pt': 'Português',
    'ui.warning.title': 'Предупреждение',
    'ui.warning.body_generic': 'Сцены насилия',
    'ui.warning.body_schematic': 'Насилие схематично',
    'ui.warning.details': 'Подробнее',
    'ui.warning.dont_show': 'Больше не показывать',
    'ui.warning.continue': 'Продолжить',
    'ui.disclaimer.title': 'Дисклеймер',
    'ui.disclaimer.body': 'Имена изменены',
    'ui.settings.language': 'Язык',
    'ui.settings.font_size': 'Размер шрифта',
    'ui.settings.text_speed': 'Скорость текста',
    'ui.settings.auto_delay': 'Пауза авто',
    'ui.settings.music': 'Музыка',
    'ui.settings.sfx': 'Звуки',
    'ui.settings.voice': 'Голос',
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
    'ui.splash.tap': 'Коснитесь, чтобы начать',
    'ui.archive.new_item': 'Новый материал',
    'mini.doc.text': 'Текст бланка',
    'ui.quick.log': 'Журнал',
    'ui.quick.save': 'Сохранить',
    'ui.quick.load': 'Загрузить',
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
  i18n.addStrings('en', { 'ui.menu.new_game': 'New game', 'ui.warning.title': 'Content warning' });
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

  it('название, подзаголовок, длительность и возрастной рейтинг; без сейва — только «Новая игра» (основная)', () => {
    const hd = handlers();
    const s = open(new MenuScreen(episode, hd));
    expect(s.el.querySelector('.vn-menu__title')?.textContent).toBe('Смерть за квартиры');
    expect(s.el.querySelector('.vn-menu__logline')?.textContent).toBe('Дело о квартирах');
    expect(s.el.querySelector('.vn-menu__meta')?.textContent).toBe('40 мин · 18+');
    expect(texts(s.el, '.vn-menu__nav button')).toEqual(['Новая игра', 'Архив', 'Настройки']);
    expect(s.el.querySelector('.vn-menu__nav .is-primary')?.textContent).toBe('Новая игра');
  });

  it('при наличии автосейва первой идёт «Продолжить» (основная); пройденный эпизод помечается', () => {
    const hd = handlers({ hasContinue: true, completed: true });
    const s = open(new MenuScreen(episode, hd));
    expect(texts(s.el, '.vn-menu__nav button')).toEqual(['Продолжить', 'Новая игра', 'Архив', 'Настройки']);
    expect(s.el.querySelector('.vn-menu__nav .is-primary')?.textContent).toBe('Продолжить');
    expect(s.el.querySelector('.vn-menu__meta')?.textContent).toContain('Пройдено');
    s.el.querySelector<HTMLButtonElement>('.vn-menu__nav button')?.click();
    expect(hd.onContinue).toHaveBeenCalledTimes(1);
  });

  it('переключатель языка: все четыре языка названы на самих языках, текущий отмечен, выбор вызывает обработчик', () => {
    const hd = handlers();
    const s = open(new MenuScreen(episode, hd));
    expect(texts(s.el, '.vn-langs button')).toEqual(['Русский', 'English', 'Español', 'Português']);
    expect(s.el.querySelector('.vn-chip.is-on')?.getAttribute('data-lang')).toBe('ru');
    expect([...s.el.querySelectorAll('.vn-langs button')].map((b) => b.getAttribute('lang'))).toEqual(['ru', 'en', 'es', 'pt']);
    s.el.querySelector<HTMLButtonElement>('[data-lang="es"]')?.click();
    expect(hd.onLanguage).toHaveBeenCalledWith('es');
  });

  it('смена языка: render() перерисовывает меню на лету', () => {
    const s = open(new MenuScreen(episode, handlers()));
    i18n.setLang('en');
    s.render();
    expect(texts(s.el, '.vn-menu__nav button')[0]).toBe('New game');
    expect(s.el.querySelector('.vn-chip.is-on')?.getAttribute('data-lang')).toBe('en');
  });
});

describe('MenuScreen: картинки интерфейса (видеосалон и плашка)', () => {
  const handlers = (art?: { background: string | null; plate: string | null; logo: string | null }) => ({
    hasContinue: () => false,
    completed: () => false,
    onContinue: vi.fn(),
    onNew: vi.fn(),
    onArchive: vi.fn(),
    onSettings: vi.fn(),
    onLanguage: vi.fn(),
    ...(art ? { art } : {}),
  });
  const abs = (u: string): string => `url("${new URL(u, document.baseURI).href}")`;

  it('без картинок прежнее оформление: ни has-bg, ни --menu-bg, ни плашки; название — обычный заголовок', () => {
    const s = open(new MenuScreen(episode, handlers()));
    expect(s.el.classList.contains('has-bg')).toBe(false);
    expect(s.el.style.getPropertyValue('--menu-bg')).toBe('');
    expect(s.el.querySelector('.vn-menu__brand')).toBeNull();
    expect(s.el.querySelector('.vn-menu__plate')).toBeNull();
    expect(s.el.querySelector('.vn-menu__title')?.textContent).toBe('Смерть за квартиры');
  });

  it('фон видеосалона: класс has-bg и --menu-bg с абсолютным адресом (в сборке css лежит в dist/assets/)', () => {
    const s = open(new MenuScreen(episode, handlers({ background: './assets/common/ui/menu_video_salon.webp', plate: null, logo: null })));
    expect(s.el.classList.contains('has-bg')).toBe(true);
    expect(s.el.style.getPropertyValue('--menu-bg')).toBe(abs('./assets/common/ui/menu_video_salon.webp'));
    expect(s.el.style.getPropertyValue('--menu-bg')).toMatch(/^url\("https?:\/\//); // не относительный
    expect(s.el.querySelector('.vn-menu__plate')).toBeNull(); // плашки нет — нет и обёртки
  });

  it('логотип передачи в бренде меню (картинка, ≥ 20 % высоты по CSS); название остаётся текстом из локали (h1); без файла — прежний вид', () => {
    const art = { background: './assets/common/ui/menu_video_salon.webp', plate: null, logo: './assets/common/ui/logo_kr.webp' };
    const hd = handlers(art);
    const s = open(new MenuScreen(episode, hd));
    const brand = s.el.querySelector('.vn-menu__brand');
    expect(brand?.classList.contains('has-logo')).toBe(true);
    const img = brand?.querySelector<HTMLImageElement>('img.vn-menu__logo');
    expect(img?.getAttribute('src')).toBe(art.logo);
    expect(img?.getAttribute('alt') ?? '').toBe(''); // декоративная картинка: название читается из h1
    expect(brand?.querySelector('h1.vn-menu__title')?.textContent).toBe('Смерть за квартиры');
    // язык меняется — текст обновляется (в картинке текста эпизода нет)
    i18n.addStrings('en', { 'mini.title': 'Death for apartments' });
    i18n.setLang('en');
    s.render();
    expect(s.el.querySelector('.vn-menu__brand h1')?.textContent).toBe('Death for apartments');
    // файла больше нет (art -> null): возврат к прежнему виду
    hd.art = { background: null, plate: null, logo: null };
    s.render();
    expect(s.el.classList.contains('has-bg')).toBe(false);
    expect(s.el.style.getPropertyValue('--menu-bg')).toBe('');
    expect(s.el.querySelector('.vn-menu__brand')).toBeNull();
  });
});

describe('WarningScreen: перед эпизодом', () => {
  const make = (over: Partial<Settings> = {}) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
    const hd = {
      settings: () => settings,
      onViolenceMode: vi.fn((m: Settings['violenceMode']) => void (settings.violenceMode = m)),
      onContinue: vi.fn(),
      onBack: vi.fn(),
    };
    return { s: open(new WarningScreen(episode, hd)), hd, settings };
  };

  it('показывает заголовок и текст предупреждения (ui.warning.*), дисклеймер (ui.disclaimer.*) и рейтинг', () => {
    const { s } = make();
    expect(s.el.querySelector('.vn-warning__title')?.textContent).toBe('Предупреждение');
    expect(s.el.querySelector('.vn-warning__body')?.textContent).toBe('Сцены насилия');
    expect(s.el.querySelector('.vn-warning__disclaimer h3')?.textContent).toBe('Дисклеймер');
    expect(s.el.querySelector('.vn-warning__disclaimer p')?.textContent).toBe('Имена изменены');
    expect(s.el.querySelector('.vn-warning__rating')?.textContent).toBe('18+');
  });

  it('режим показа насилия выбирается прямо здесь; текст предупреждения меняется под схематичный режим', () => {
    const { s, hd } = make();
    const radios = [...s.el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([['full', true], ['schematic', false]]);
    radios[1]?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onViolenceMode).toHaveBeenCalledWith('schematic');
    s.render();
    expect(s.el.querySelector('.vn-warning__body')?.textContent).toBe('Насилие схематично');
  });

  it('«Подробнее» сворачивает и разворачивает дисклеймер', () => {
    const { s } = make();
    expect(s.el.querySelector<HTMLElement>('.vn-warning__disclaimer')?.hidden).toBe(false);
    s.el.querySelector<HTMLButtonElement>('.vn-linkbtn')?.click();
    expect(s.el.querySelector<HTMLElement>('.vn-warning__disclaimer')?.hidden).toBe(true);
    s.el.querySelector<HTMLButtonElement>('.vn-linkbtn')?.click();
    expect(s.el.querySelector<HTMLElement>('.vn-warning__disclaimer')?.hidden).toBe(false);
  });

  it('«Продолжить» передаёт флаг «больше не показывать»; «Назад» возвращает в меню; Esc экран не закрывает', () => {
    const { s, hd } = make();
    s.el.querySelector<HTMLButtonElement>('.vn-btn.is-primary')?.click();
    expect(hd.onContinue).toHaveBeenLastCalledWith(false);
    const box = s.el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    s.el.querySelector<HTMLButtonElement>('.vn-btn.is-primary')?.click();
    expect(hd.onContinue).toHaveBeenLastCalledWith(true);
    s.el.querySelector<HTMLButtonElement>('.vn-actions .vn-btn:not(.is-primary)')?.click();
    expect(hd.onBack).toHaveBeenCalledTimes(1);
    expect(s.dismissible).toBe(false);
  });
});

describe('SplashScreen', () => {
  it('логотип на кнопке во весь экран; касание вызывает onStart один раз; без логотипа — название текстом', () => {
    const onStart = vi.fn();
    const s = open(new SplashScreen({ logo: './assets/common/ui/logo_kr.webp', title: 'Смерть за квартиры', onStart }));
    expect(s.el.querySelector<HTMLImageElement>('img.vn-splash__logo')?.getAttribute('src')).toBe('./assets/common/ui/logo_kr.webp');
    expect(s.el.querySelector('.vn-splash__tap')?.textContent).toBe('Коснитесь, чтобы начать');
    const hit = s.el.querySelector<HTMLButtonElement>('button.vn-splash__hit');
    expect(hit?.getAttribute('aria-label')).toBe('Коснитесь, чтобы начать');
    hit?.click();
    hit?.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    const s2 = open(new SplashScreen({ logo: null, title: 'Смерть за квартиры', onStart: vi.fn() }));
    expect(s2.el.querySelector('.vn-splash__text')?.textContent).toBe('Смерть за квартиры');
    expect(s2.el.querySelector('img')).toBeNull();
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
    for (const label of ['Музыка', 'Звуки', 'Голос']) expect(Number(range(s.el, label).max)).toBe(1);
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
    const boxes = [...s.el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]); // таймеры, «только история», пропуск непрочитанного
    boxes[0]!.checked = false;
    boxes[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(hd.onChange).toHaveBeenLastCalledWith({ timers: false });
    boxes[1]!.checked = true;
    boxes[1]!.dispatchEvent(new Event('change', { bubbles: true }));
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
    expect([...s.el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((b) => b.checked)).toEqual([false, true, false]);
    expect([...s.el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.checked)).toEqual([false, true]);
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
    expect(s.el.querySelector('.vn-muted')?.textContent).toBe('Пусто');
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

  it('setImage до отрисовки ничего не ломает; «Понятно» закрывает; новый материал архива помечается', () => {
    const onDone = vi.fn();
    const fresh = new DocumentScreen(episode, 'doc_x', null, null, onDone);
    expect(() => fresh.setImage('./a.webp')).not.toThrow();
    const { s, onDone: done } = make(null, 'mini.doc.text', 'arc_x');
    expect(s.el.querySelector('.vn-badge')?.textContent).toBe('Новый материал');
    s.el.querySelector<HTMLButtonElement>('.vn-actions .vn-btn')?.click();
    expect(done).toHaveBeenCalledTimes(1);
  });
});
