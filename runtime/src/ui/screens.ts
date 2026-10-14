/**
 * Экраны интерфейса: меню, контент-предупреждение, настройки, журнал, сохранение/загрузка,
 * архив, документ, финал. Все строки — ключи ui.* / ключи эпизода; при смене языка экран
 * перерисовывается целиком (render()).
 */
import { i18n, t } from '../core/i18n';
import type { SaveFile } from '../core/saves';
import { AUTO_DELAY_RANGE, CAMERA_FX_LEVELS, FONT_SCALE_RANGE, GRAPHICS_MODES } from '../core/settings';
import type { CameraFx, Settings } from '../core/settings';
import type { ArchiveItem, Episode, GameState, Ending, Lang } from '../core/types';
import type { LogEntry } from '../session';
import { cssUrl, fill, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import type { Screen } from './screen_host';

// ───────────────────────────── общие кусочки ─────────────────────────────

function card(cls: string, ...children: Array<Node | string | null | false>): HTMLElement {
  return h('div', { class: `vn-card ${cls}` }, ...children);
}

function backButton(onClick: () => void, key = 'ui.common.back'): HTMLButtonElement {
  return h('button', { class: 'vn-btn', type: 'button', text: t(key), on: { click: onClick } });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toISOString();
  }
}

/** Название персонажа по id (короткое, если есть). */
export function nameOf(episode: Episode, who: string | null, short = true): string | null {
  if (!who) return null;
  const c = episode.cast.find((x) => x.id === who);
  if (!c) return who;
  return t(short && c.short_name_key ? c.short_name_key : c.name_key);
}

/** Подпись под именем в окне реплики (cast.title_key); нет — null. */
export function titleOf(episode: Episode, who: string | null): string | null {
  const key = who ? episode.cast.find((x) => x.id === who)?.title_key : undefined;
  return key ? t(key) : null;
}

export function nameColorOf(episode: Episode, who: string | null): string | null {
  return who ? (episode.cast.find((x) => x.id === who)?.name_color ?? null) : null;
}

abstract class BaseScreen implements Screen {
  readonly el: HTMLElement;
  readonly dismissible: boolean;

  constructor(cls: string, dismissible = true) {
    this.el = h('div', { class: cls, role: 'dialog', aria: { modal: true } });
    this.dismissible = dismissible;
  }

  abstract render(): void;
}

// ───────────────────────────── главное меню ─────────────────────────────

/** Картинки интерфейса (адреса уже загруженных файлов); null — файла нет, остаётся прежнее оформление. */
export interface MenuArt {
  plate: string | null;
  /** Логотип передачи в шапке меню; нет файла — название передачи текстом. */
  logo: string | null;
}

/** Карточка на полке эпизодов: открыт только текущий эпизод, остальные — «скоро». */
export interface MenuSlot {
  order: number;
  year: number | null;
  current: boolean;
  /** Обложка (адрес файла) или null — тёмная карточка. */
  cover: string | null;
}

/** Сезон в шапке меню и его полка эпизодов (episodes/s<N>/season.json). */
export interface MenuSeason {
  n: number;
  titleKey: string;
  years: string | null;
  slots: MenuSlot[];
}

export interface MenuHandlers {
  /** assets/common/ui/logo_kr.webp и title_plate.webp, если они есть. */
  art?: MenuArt;
  /** Рамка сезона; нет — на полке только текущий эпизод. */
  season?: MenuSeason;
  hasContinue: () => boolean;
  completed: () => boolean;
  onContinue: () => void;
  onNew: () => void;
  onArchive: () => void;
  onSettings: () => void;
  onLanguage: (lang: Lang) => void;
}

/** Сжатие шапки на телефоне: 0 — вверху, 1 — после стольких пикселей прокрутки. */
const MENU_SHRINK_PX = 140;

/**
 * Главный экран (решение владельца 2026-10-12, docs/production/concepts/main_menu): кинескоп телевизора, логотип
 * передачи и сезон в шапке, полка эпизодов (текущий открыт, остальные «скоро»); язык, архив и настройки — иконками
 * в правом верхнем углу. Клик по открытому эпизоду сразу запускает его: продолжение, если есть автосейв, иначе
 * новая партия; при прогрессе под карточкой — «Начать заново». На телефоне полка вертикальная, шапка липкая и при
 * прокрутке сжимается (CSS по переменным --p и --q).
 */
export class MenuScreen extends BaseScreen {
  private langOpen = false;

  constructor(
    private readonly episode: Episode,
    private readonly handlers: MenuHandlers,
  ) {
    super('vn-menu', false);
  }

  render(): void {
    const hd = this.handlers;
    const iconBtn = (name: IconName, label: string, onClick: () => void, cls: string, expanded?: boolean): HTMLButtonElement =>
      h(
        'button',
        { class: `vn-menu__icon ${cls}`, type: 'button', title: label, aria: { label, ...(expanded === undefined ? {} : { expanded }) }, on: { click: onClick } },
        icon(name),
      );
    const icons = h(
      'nav',
      { class: 'vn-menu__icons' },
      h('span', { class: 'vn-menu__lang-code', text: i18n.lang.toUpperCase(), aria: { hidden: true } }),
      i18n.available.length > 1 ? iconBtn('globe', t('ui.menu.language'), () => this.toggleLangs(), 'is-lang', this.langOpen) : null,
      iconBtn('log', t('ui.menu.archive'), hd.onArchive, 'is-archive'),
      iconBtn('settings', t('ui.menu.settings'), hd.onSettings, 'is-settings'),
    );
    const langs = this.langOpen
      ? h('div', { class: 'vn-menu__langs' }, languageChips((lang) => {
          this.langOpen = false;
          this.render(); // закрыть переключатель сразу; при смене языка приложение перерисует меню ещё раз
          hd.onLanguage(lang);
        }))
      : null;

    let brand: HTMLElement;
    if (hd.art?.logo) {
      const logo = h('img', { class: 'vn-menu__logo' }) as HTMLImageElement;
      logo.src = hd.art.logo;
      logo.alt = t('ui.menu.brand');
      logo.draggable = false;
      brand = logo;
    } else {
      brand = h('h1', { class: 'vn-menu__title', text: t('ui.menu.brand') });
    }
    const s = hd.season;
    const tag = s
      ? h(
          'p',
          { class: 'vn-menu__tag' },
          [t('ui.menu.season', { n: s.n }), t(s.titleKey)].join(' · ') + (s.years ? ' · ' : ''),
          s.years ? h('span', { text: s.years }) : null,
        )
      : null;

    const slots: MenuSlot[] = s && s.slots.length > 0 ? s.slots : [{ order: this.episode.order ?? 1, year: null, current: true, cover: null }];
    const shelf = h('div', { class: 'vn-menu__shelf', role: 'list' }, ...slots.map((sl) => (sl.current ? this.openCard(sl) : lockedCard(sl))));
    const scroll = h('div', { class: 'vn-menu__scroll' }, h('header', { class: 'vn-menu__head' }, brand, tag), shelf);
    scroll.addEventListener(
      'scroll',
      () => {
        const p = Math.min(1, scroll.scrollTop / MENU_SHRINK_PX);
        scroll.style.setProperty('--p', p.toFixed(3));
        // логотип поднимается в ряд иконок только на последних 40 % сжатия, когда он уже мал
        scroll.style.setProperty('--q', Math.max(0, (p - 0.6) / 0.4).toFixed(3));
      },
      { passive: true },
    );
    fill(this.el, h('div', { class: 'vn-crt' }, h('div', { class: 'vn-crt__in' }, h('div', { class: 'vn-crt__screen' }, icons, langs, scroll))));
  }

  private toggleLangs(): void {
    this.langOpen = !this.langOpen;
    this.render();
  }

  private openCard(sl: MenuSlot): HTMLElement {
    const hd = this.handlers;
    const cont = hd.hasContinue();
    const badge = cont ? t('ui.episode.continue') : hd.completed() ? t('ui.episode.completed') : t('ui.menu.badge_new');
    const thumb = h('span', { class: 'vn-ep__thumb' }, h('span', { class: 'vn-ep__badge', text: badge }));
    if (sl.cover) thumb.style.backgroundImage = cssUrl(sl.cover);
    const name = t(this.episode.title_key);
    const open = h(
      'button',
      { class: 'vn-ep__open', type: 'button', aria: { label: `${slotNumber(sl)}: ${name}. ${badge}` }, on: { click: () => (cont ? hd.onContinue() : hd.onNew()) } },
      thumb,
      h('span', { class: 'vn-ep__num', text: slotNumber(sl) }),
      h('span', { class: 'vn-ep__name', text: name }),
    );
    return h(
      'div',
      { class: 'vn-ep is-open', role: 'listitem' },
      open,
      cont ? h('button', { class: 'vn-ep__restart', type: 'button', text: t('ui.menu.restart'), on: { click: hd.onNew } }) : null,
    );
  }
}

function slotNumber(sl: MenuSlot): string {
  return [t('ui.menu.episode_n', { n: sl.order }), sl.year].filter((x) => x !== null).join(' · ');
}

function lockedCard(sl: MenuSlot): HTMLElement {
  return h(
    'div',
    { class: 'vn-ep is-locked', role: 'listitem', aria: { disabled: true } },
    h('span', { class: 'vn-ep__thumb' }, h('span', { class: 'vn-ep__lock' }, icon('lock'))),
    h('span', { class: 'vn-ep__num', text: slotNumber(sl) }),
    h('span', { class: 'vn-ep__name', text: t('ui.menu.soon') }),
  );
}

/** Переключатель языка: названия на самих языках (требование Playgama). */
export function languageChips(onPick: (lang: Lang) => void): HTMLElement {
  return h(
    'div',
    { class: 'vn-langs', role: 'group', aria: { label: t('ui.menu.language') } },
    ...i18n.available.map((lang) =>
      h('button', {
        class: `vn-chip${i18n.lang === lang ? ' is-on' : ''}`,
        type: 'button',
        lang,
        text: lang.toUpperCase(), // коды RU / EN / ES / PT (решение владельца 2026-10-11); полное имя — подсказка и скринридер
        title: t(`ui.lang.${lang}`),
        data: { lang },
        aria: { label: t(`ui.lang.${lang}`), pressed: i18n.lang === lang },
        on: { click: () => onPick(lang) },
      }),
    ),
  );
}

// ───────────────────────────── контент-предупреждение ─────────────────────────────

export interface WarningHandlers {
  settings: () => Settings;
  onContinue: () => void;
  onBack: () => void;
  /** Логотип передачи (assets/common/ui/logo_kr.webp, адрес загруженного файла) — в правом верхнем углу. */
  logo?: string | null;
}

/**
 * Экран перед эпизодом «Основано на реальных событиях» (макет Figma «Claude», узел 1232:1612, решение владельца
 * 2026-10-13): на чёрном фоне с красным низом — заголовок, предупреждение и дисклеймер одним текстом
 * (ethics-and-legal.md §5), возраст, «Назад / Продолжить»; логотип передачи справа вверху. Режим показа насилия — в
 * настройках; в схематичном режиме вместо «Строго 18+» — строка про схематичный показ (16+). Показывается перед каждой
 * новой игрой.
 */
export class WarningScreen extends BaseScreen {
  constructor(
    private readonly episode: Episode,
    private readonly handlers: WarningHandlers,
  ) {
    super('vn-warning', false);
  }

  render(): void {
    const { handlers: hd, episode: ep } = this;
    const age =
      hd.settings().violenceMode === 'schematic'
        ? t('ui.disclaimer.body_age_schematic')
        : t('ui.disclaimer.body_age', { rating: ep.age_rating ?? '18+' });
    const paragraphs = [...t('ui.disclaimer.body').split(/\n\s*\n/), age].filter((p) => p.trim() !== '');
    let logo: HTMLImageElement | null = null;
    if (hd.logo) {
      logo = h('img', { class: 'vn-warning__logo' });
      logo.src = hd.logo;
      logo.alt = t('ui.menu.brand');
      logo.draggable = false;
    }
    fill(
      this.el,
      logo,
      h(
        'div',
        { class: 'vn-warning__box' },
        h('h2', { class: 'vn-warning__title', text: t('ui.disclaimer.title') }),
        h('div', { class: 'vn-warning__body' }, ...paragraphs.map((text) => h('p', { text }))),
        h(
          'div',
          { class: 'vn-warning__actions' },
          backButton(hd.onBack),
          h('button', { class: 'vn-btn is-primary', type: 'button', text: t('ui.warning.continue'), on: { click: () => hd.onContinue() } }),
        ),
      ),
    );
  }
}

// ───────────────────────────── настройки ─────────────────────────────

export interface SettingsHandlers {
  settings: () => Settings;
  /** prefers-reduced-motion: эффекты камеры выключены принудительно (кнопки недоступны). */
  reducedMotion?: () => boolean;
  /**
   * Уровень камеры, который действует сейчас: «Выкл», если эффекты выключила самозащита от слабого
   * устройства (камкордер.ts), даже когда в настройках стоит другой; выбор уровня снимает защиту.
   */
  effectiveCameraFx?: () => CameraFx;
  onChange: (patch: Partial<Settings>) => void;
  onLanguage: (lang: Lang) => void;
  onClose: () => void;
  /** Сохранить / загрузить (только в партии) и звук — переехали сюда из панели кнопок (решение владельца 2026-10-11). */
  inGame?: () => boolean;
  muted?: () => boolean;
  onSave?: () => void;
  onLoad?: () => void;
  onMute?: () => void;
}

export class SettingsScreen extends BaseScreen {
  constructor(private readonly handlers: SettingsHandlers) {
    super('vn-settings');
  }

  render(): void {
    const s = this.handlers.settings();
    const hd = this.handlers;
    const range = (
      label: string,
      key: 'fontScale' | 'textSpeed' | 'autoDelayMs' | 'music' | 'sfx' | 'voice',
      min: number,
      max: number,
      step: number,
      fmt: (v: number) => string,
    ): HTMLElement => {
      const out = h('output', { class: 'vn-range__out', text: fmt(s[key]) });
      const fill = (v: number): string => `${((v - min) / (max - min)) * 100}%`; // заливка дорожки до бегунка
      return h(
        'label',
        { class: 'vn-range' },
        h('span', { class: 'vn-range__label', text: label }),
        h('input', {
          type: 'range',
          min,
          max,
          step,
          value: s[key],
          aria: { label },
          style: { '--val': fill(s[key]) },
          on: {
            input: (e) => {
              const el = e.target as HTMLInputElement;
              const v = Number(el.value);
              el.style.setProperty('--val', fill(v));
              out.textContent = fmt(v);
              hd.onChange({ [key]: v } as Partial<Settings>);
            },
          },
        }),
        out,
      );
    };
    const toggle = (label: string, key: 'timers' | 'storyOnly' | 'skipUnread' | 'voiceEnabled', onToggle?: (on: boolean) => void): HTMLElement =>
      h(
        'label',
        { class: 'vn-check' },
        h('input', {
          type: 'checkbox',
          checked: s[key],
          data: { setting: key },
          on: {
            change: (e) => {
              const on = (e.target as HTMLInputElement).checked;
              onToggle?.(on);
              hd.onChange({ [key]: on } as Partial<Settings>);
            },
          },
        }),
        h('span', { text: label }),
      );
    const radio = (value: Settings['violenceMode'], label: string): HTMLElement =>
      h(
        'label',
        { class: 'vn-radio' },
        h('input', {
          type: 'radio',
          name: 'violence_mode',
          value,
          checked: s.violenceMode === value,
          on: { change: () => hd.onChange({ violenceMode: value }) },
        }),
        h('span', { text: label }),
      );
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    // «Эффекты камеры»: выкл / слабо / сильно. Кнопки-сегменты, а не radio — как переключатель языка.
    const reduced = hd.reducedMotion?.() ?? false;
    // «Графика»: реализм / воспоминания — те же кнопки-сегменты.
    const graphics = h(
      'div',
      { class: 'vn-settings__group' },
      h('span', { class: 'vn-settings__legend', text: t('ui.settings.graphics') }),
      h(
        'div',
        { class: 'vn-langs vn-graphics', role: 'group', aria: { label: t('ui.settings.graphics') } },
        ...GRAPHICS_MODES.map((mode) =>
          h('button', {
            class: `vn-chip${s.graphics === mode ? ' is-on' : ''}`,
            type: 'button',
            text: t(`ui.settings.graphics_${mode}`),
            data: { graphics: mode },
            aria: { pressed: s.graphics === mode },
            on: {
              click: () => {
                hd.onChange({ graphics: mode });
                this.render();
              },
            },
          }),
        ),
      ),
    );
    const camLevel: CameraFx = hd.effectiveCameraFx?.() ?? (reduced ? 'off' : s.cameraFx);
    const cameraFx = h(
      'div',
      { class: 'vn-settings__group' },
      h('span', { class: 'vn-settings__legend', text: t('ui.settings.camera_fx') }),
      h(
        'div',
        { class: 'vn-langs vn-camfx', role: 'group', aria: { label: t('ui.settings.camera_fx') } },
        ...CAMERA_FX_LEVELS.map((level) =>
          h('button', {
            class: `vn-chip${camLevel === level ? ' is-on' : ''}`,
            type: 'button',
            disabled: reduced,
            text: t(`ui.settings.camera_fx_${level}`),
            data: { cameraFx: level },
            aria: { pressed: camLevel === level },
            on: {
              click: () => {
                hd.onChange({ cameraFx: level });
                this.render();
              },
            },
          }),
        ),
      ),
    );
    // «Озвучка»: переключатель и громкость; пока озвучка выключена, ползунок недоступен (без перерисовки — фокус остаётся на флажке).
    const voiceVolume = range(t('ui.settings.voice_volume'), 'voice', 0, 1, 0.05, pct);
    const voiceSlider = voiceVolume.querySelector('input');
    if (voiceSlider) voiceSlider.disabled = !s.voiceEnabled;
    const voice = h(
      'div',
      { class: 'vn-settings__group vn-voice' },
      h('span', { class: 'vn-settings__legend', text: t('ui.settings.voice') }),
      toggle(t('ui.settings.voice_on'), 'voiceEnabled', (on) => {
        if (voiceSlider) voiceSlider.disabled = !on;
      }),
      voiceVolume,
    );
    const qbtn = (ic: IconName, label: string, onClick: () => void, on = false): HTMLElement =>
      h(
        'button',
        { class: `vn-btn vn-settings__qbtn${on ? ' is-on' : ''}`, type: 'button', data: { action: ic }, aria: { pressed: on }, on: { click: onClick } },
        icon(ic),
        h('span', { text: label }),
      );
    const inGame = hd.inGame?.() ?? false;
    const muted = hd.muted?.() ?? false;
    const quick =
      (inGame && hd.onSave && hd.onLoad) || hd.onMute
        ? h(
            'div',
            { class: 'vn-settings__quick', role: 'group', aria: { label: t('ui.settings.quick') } },
            inGame && hd.onSave ? qbtn('save', t('ui.quick.save'), hd.onSave) : null,
            inGame && hd.onLoad ? qbtn('load', t('ui.quick.load'), hd.onLoad) : null,
            hd.onMute
              ? qbtn(
                  'mute',
                  muted ? t('ui.quick.unmute') : t('ui.quick.mute'),
                  () => {
                    hd.onMute?.();
                    this.render();
                  },
                  muted,
                )
              : null,
          )
        : null;
    fill(
      this.el,
      card(
        'vn-settings__card',
        h('h2', { class: 'vn-card__title', text: t('ui.menu.settings') }),
        quick,
        i18n.available.length > 1
          ? h('div', { class: 'vn-settings__group' }, h('span', { class: 'vn-settings__legend', text: t('ui.settings.language') }), languageChips(hd.onLanguage))
          : null,
        cameraFx,
        graphics,
        range(t('ui.settings.font_size'), 'fontScale', FONT_SCALE_RANGE.min, FONT_SCALE_RANGE.max, FONT_SCALE_RANGE.step, pct),
        range(t('ui.settings.text_speed'), 'textSpeed', 1, 5, 1, (v) => `${v}/5`),
        range(t('ui.settings.auto_delay'), 'autoDelayMs', AUTO_DELAY_RANGE.min, AUTO_DELAY_RANGE.max, AUTO_DELAY_RANGE.step, (v) => `${(v / 1000).toFixed(1)} s`),
        range(t('ui.settings.music'), 'music', 0, 1, 0.05, pct),
        range(t('ui.settings.sfx'), 'sfx', 0, 1, 0.05, pct),
        voice,
        toggle(t('ui.settings.timers'), 'timers'),
        toggle(t('ui.settings.story_only'), 'storyOnly'),
        toggle(t('ui.settings.skip_unread'), 'skipUnread'),
        h(
          'fieldset',
          { class: 'vn-settings__group' },
          h('legend', { class: 'vn-settings__legend', text: t('ui.settings.violence_mode') }),
          radio('full', t('ui.settings.violence_full')),
          radio('schematic', t('ui.settings.violence_schematic')),
        ),
        h('div', { class: 'vn-actions' }, backButton(hd.onClose)),
      ),
    );
  }
}

// ───────────────────────────── журнал (backlog) ─────────────────────────────

export interface LogHandlers {
  entries: () => readonly LogEntry[];
  /** Сколько реплик назад можно откатиться максимум. */
  maxRollback: () => number;
  onRollback: (steps: number) => void;
  onClose: () => void;
}

export class LogScreen extends BaseScreen {
  constructor(
    private readonly episode: Episode,
    private readonly handlers: LogHandlers,
  ) {
    super('vn-log');
  }

  render(): void {
    const entries = this.handlers.entries();
    const maxBack = this.handlers.maxRollback();
    const items = entries.map((e, i) => {
      const steps = entries.length - 1 - i;
      const name = nameOf(this.episode, e.who);
      return h(
        'li',
        { class: `vn-log__item is-${e.kind}${e.narrate_style ? ` is-${e.narrate_style}` : ''}` },
        name ? h('b', { class: 'vn-log__name', style: { color: nameColorOf(this.episode, e.who) ?? '' }, text: name }) : null,
        h('span', { class: 'vn-log__text', text: t(e.key) }),
        steps > 0 && steps <= maxBack
          ? h('button', {
              class: 'vn-log__back',
              type: 'button',
              title: t('ui.common.back'),
              aria: { label: `${t('ui.common.back')} ×${steps}` },
              text: '↶',
              on: { click: () => this.handlers.onRollback(steps) },
            })
          : null,
      );
    });
    const list = h('ol', { class: 'vn-log__list' }, ...items);
    fill(
      this.el,
      card(
        'vn-log__card',
        h('h2', { class: 'vn-card__title', text: t('ui.quick.log') }),
        entries.length === 0 ? h('p', { class: 'vn-muted', text: t('ui.archive.empty') }) : list,
        h('div', { class: 'vn-actions' }, backButton(this.handlers.onClose)),
      ),
    );
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }
}

// ───────────────────────────── сохранение / загрузка ─────────────────────────────

export interface SaveLoadHandlers {
  mode: 'save' | 'load';
  /** Слоты: автосейв первым (только для загрузки), затем ручные. */
  autosave: () => SaveFile | null;
  listManual: () => Promise<Array<SaveFile | null>>;
  onLoad: (file: SaveFile) => void;
  onSave: (slot: number) => Promise<void>;
  onClose: () => void;
}

export class SaveLoadScreen extends BaseScreen {
  private slots: Array<SaveFile | null> = [];
  private confirm: number | null = null;
  private loading = true;

  constructor(
    private readonly episode: Episode,
    private readonly handlers: SaveLoadHandlers,
  ) {
    super('vn-saveload');
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.loading = true;
    this.slots = await this.handlers.listManual();
    this.loading = false;
    this.render();
  }

  private describe(file: SaveFile): string {
    const block = this.episode.blocks.find((b) => b.id === file.view?.block);
    const place = block?.title_key ? t(block.title_key) : (file.view?.scene ?? file.state.scene_id);
    return `${place} · ${formatDate(file.saved_at)}`;
  }

  render(): void {
    const { handlers: hd } = this;
    const save = hd.mode === 'save';
    const row = (label: string, file: SaveFile | null, onPick: (() => void) | null, key: string): HTMLElement =>
      h(
        'button',
        {
          class: `vn-slot${file ? '' : ' is-empty'}`,
          type: 'button',
          data: { slot: key },
          disabled: onPick === null,
          on: { click: () => onPick?.() },
        },
        h('span', { class: 'vn-slot__label', text: label }),
        h('span', { class: 'vn-slot__info', text: file ? this.describe(file) : t('ui.save.empty') }),
      );
    const rows: HTMLElement[] = [];
    if (!save) {
      const auto = hd.autosave();
      rows.push(row(t('ui.save.autosave'), auto, auto ? () => hd.onLoad(auto) : null, 'auto'));
    }
    this.slots.forEach((file, i) => {
      const n = i + 1;
      const label = `${t('ui.save.slot')} ${n}`;
      if (save) {
        rows.push(
          row(label, file, () => {
            if (file) {
              this.confirm = n;
              this.render();
            } else void this.doSave(n);
          }, String(n)),
        );
      } else {
        rows.push(row(label, file, file ? () => hd.onLoad(file) : null, String(n)));
      }
    });
    fill(
      this.el,
      card(
        'vn-saveload__card',
        h('h2', { class: 'vn-card__title', text: save ? t('ui.quick.save') : t('ui.quick.load') }),
        this.loading ? h('p', { class: 'vn-muted', text: '…' }) : h('div', { class: 'vn-slots' }, ...rows),
        this.confirm !== null
          ? h(
              'div',
              { class: 'vn-confirm', role: 'alertdialog' },
              h('p', { text: t('ui.save.overwrite_confirm') }),
              h(
                'div',
                { class: 'vn-actions' },
                h('button', {
                  class: 'vn-btn',
                  type: 'button',
                  text: t('ui.common.no'),
                  on: {
                    click: () => {
                      this.confirm = null;
                      this.render();
                    },
                  },
                }),
                h('button', {
                  class: 'vn-btn is-primary',
                  type: 'button',
                  text: t('ui.common.yes'),
                  on: { click: () => void this.doSave(this.confirm ?? 1) },
                }),
              ),
            )
          : null,
        h('div', { class: 'vn-actions' }, backButton(hd.onClose)),
      ),
    );
  }

  private async doSave(n: number): Promise<void> {
    this.confirm = null;
    await this.handlers.onSave(n);
    await this.reload();
  }
}

// ───────────────────────────── архив ─────────────────────────────

export interface ArchiveOptions {
  /** Скан бумаги по id ассета (как у окна документа): адрес, если уже загружен, и промис загрузки. */
  documentArt?: (docId: string) => { url: string | null; ready: Promise<string | null> };
  /** Открыть бумагу крупно — окном документа поверх блокнота. Нет — бумага лежит записью с текстом. */
  onOpenDocument?: (item: ArchiveItem) => void;
  /** Запись появилась после того, как блокнот открывали в последний раз: на ней штамп «новый материал». */
  isNew?: (id: string) => boolean;
  /**
   * Ход следствия: записи в том порядке, в каком их отдаёт unlocked (порядок находок партии), с номерами и красными
   * стрелками от каждой к следующей. Нет — порядок эпизода, без номеров и стрелок (архив в меню).
   */
  path?: boolean;
}

/** Наклон бумажки и вид бумаги — от id записи, а не от места в списке: новая запись не перекладывает старые. */
const NOTE_TILTS = [-1.3, 0.9, -0.5, 1.2, -0.9, 0.4, 1.4, -0.3];

/** FNV-1a: бумаги и наклоны распределяются по записям ровнее, чем простой полиномиальный хэш. */
function noteSeed(id: string): number {
  let s = 2166136261;
  for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
  return s;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Точка на краю прямоугольника r в сторону центра s, отступив gap наружу: стрелка не прячется под бумажкой. */
function edgeToward(r: Box, s: Box, gap: number): [number, number] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = s.x + s.w / 2 - cx;
  const dy = s.y + s.h / 2 - cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [cx, cy];
  const t = Math.min(dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t + (dx / len) * gap, cy + dy * t + (dy / len) * gap];
}

/** Красные стрелки от записи к следующей — лёгкой дугой, по очереди в разные стороны, как рукой по бумаге. */
function drawPath(board: HTMLElement, svg: SVGSVGElement): void {
  const box = board.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return; // экран ещё не выложен (или jsdom)
  // Концы стрелок — у самой бумаги: у скана это лист под скрепкой, а не вся колонка записи.
  const rects: Box[] = [...board.querySelectorAll<HTMLElement>('.vn-archive__item')].map((el) => {
    const r = (el.querySelector('.vn-archive__open') ?? el.querySelector('.vn-archive__paper') ?? el).getBoundingClientRect();
    return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  });
  const paths: string[] = [];
  for (let i = 1; i < rects.length; i++) {
    const a = rects[i - 1]!;
    const b = rects[i]!;
    const [x1, y1] = edgeToward(a, b, 6);
    const [x2, y2] = edgeToward(b, a, 12);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bend = Math.min(36, len * 0.12) * (i % 2 ? 1 : -1);
    const qx = (x1 + x2) / 2 - ((y2 - y1) / len) * bend;
    const qy = (y1 + y2) / 2 + ((x2 - x1) / len) * bend;
    const n = (v: number): string => v.toFixed(1);
    paths.push(`<path d="M${n(x1)} ${n(y1)}Q${n(qx)} ${n(qy)} ${n(x2)} ${n(y2)}" marker-end="url(#vn-archive-arrow)"/>`);
  }
  svg.setAttribute('viewBox', `0 0 ${box.width.toFixed(0)} ${box.height.toFixed(0)}`);
  svg.setAttribute('width', box.width.toFixed(0));
  svg.setAttribute('height', box.height.toFixed(0));
  svg.innerHTML =
    '<defs><marker id="vn-archive-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="8" markerHeight="8" orient="auto">' +
    '<path d="M0 1L10 5L0 9z"/></marker></defs>' +
    paths.join('');
}

/**
 * Блокнот следователя (в меню — «Архив»): без подложки — в игре поверх размытого кадра, в меню на графите. Записи —
 * предметы: карточки и обрывки под скотчем, жёлтые стикеры, бумаги дела сканом под скрепкой (касание открывает окно
 * документа), фото — отпечатком. В игре записи идут в порядке находок, с номерами, и от каждой к следующей — красная
 * стрелка: ход следствия. Новое с прошлого раза — под красным штампом.
 */
export class ArchiveScreen extends BaseScreen {
  /** Esc закрывает блокнот мимо onDone: хозяин узнаёт о закрытии отсюда. */
  onClose?: () => void;
  /** Стрелки пересчитываются, когда меняются размеры (догрузились сканы, сменилась ширина окна). */
  private resize: ResizeObserver | null = null;

  constructor(
    private readonly episode: Episode,
    private readonly unlocked: () => readonly string[],
    private readonly onDone: () => void,
    /** В игре тот же список открывается кнопкой «Блокнот» — с её заголовком. */
    private readonly titleKey = 'ui.archive.title',
    private readonly opts: ArchiveOptions = {},
  ) {
    super('vn-archive');
  }

  render(): void {
    this.resize?.disconnect();
    this.resize = null;
    const all = this.episode.archive_items ?? [];
    const open = this.unlocked();
    const items: ArchiveItem[] = this.opts.path
      ? [...new Set(open)].map((id) => all.find((a) => a.id === id)).filter((a): a is ArchiveItem => a !== undefined)
      : all.filter((a) => open.includes(a.id));
    const board =
      items.length === 0
        ? null
        : h(
            'div',
            { class: 'vn-archive__board', data: { backdrop: 1 } },
            h('ul', { class: 'vn-archive__list', data: { backdrop: 1 } }, ...items.map((a, i) => this.note(a, i))),
          );
    // В игре под блокнотом — размытый кадр (как под документом); в меню кадра нет — графитовый фон.
    this.el.classList.toggle('is-menu', !this.opts.path);
    fill(
      this.el,
      h(
        'div',
        { class: 'vn-archive__box', data: { backdrop: 1 } },
        h(
          'div',
          { class: 'vn-archive__head', data: { backdrop: 1 } },
          h('h2', { class: 'vn-archive__title', text: t(this.titleKey) }),
          // Крестик — как у окна документа.
          h(
            'button',
            { class: 'vn-document__close', type: 'button', title: t('ui.common.close'), aria: { label: t('ui.common.close') }, on: { click: this.onDone } },
            icon('close'),
          ),
        ),
        h('div', { class: 'vn-archive__page', data: { backdrop: 1 } }, board ?? h('p', { class: 'vn-archive__empty', text: t('ui.archive.empty') })),
      ),
    );
    if (board && this.opts.path && items.length > 1) this.trackPath(board);
  }

  private trackPath(board: HTMLElement): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'vn-archive__lines');
    svg.setAttribute('aria-hidden', 'true');
    board.prepend(svg);
    const draw = (): void => {
      if (board.isConnected) drawPath(board, svg);
      else this.resize?.disconnect();
    };
    draw();
    if (typeof ResizeObserver !== 'function') return;
    this.resize = new ResizeObserver(draw);
    this.resize.observe(board);
    for (const li of board.querySelectorAll('.vn-archive__item')) this.resize.observe(li);
  }

  private note(a: ArchiveItem, index: number): HTMLElement {
    const seed = noteSeed(a.id);
    const title = t(a.title_key);
    const open = this.opts.onOpenDocument;
    const scan = a.kind === 'document' && a.asset && open ? this.opts.documentArt?.(a.asset) : undefined;
    const print = a.kind === 'photo' && a.asset ? this.opts.documentArt?.(a.asset) : undefined;
    const picture = (cls: string, art: { url: string | null; ready: Promise<string | null> }): HTMLImageElement => {
      const img = h('img', { class: cls });
      img.alt = '';
      if (art.url) img.src = art.url;
      else
        void art.ready.then((url) => {
          if (url) img.src = url;
        });
      return img;
    };
    const text = [
      h('h3', { text: title }),
      ...(a.real_fact ? [h('span', { class: 'vn-badge', text: t('ui.archive.real_fact') })] : []),
      ...(a.text_key ? [h('p', { text: t(a.text_key) })] : []),
    ];
    const body: HTMLElement[] = scan
      ? [
          h(
            'button',
            {
              class: 'vn-archive__open',
              type: 'button',
              aria: { label: title },
              on: {
                // штамп снимается тут же, без перерисовки доски (прокрутка остаётся на месте)
                click: (e) => {
                  (e.currentTarget as HTMLElement).closest('.vn-archive__item')?.querySelector('.vn-archive__stamp')?.remove();
                  open?.(a);
                },
              },
            },
            picture('vn-archive__scan', scan),
            h('span', { class: 'vn-archive__clip', aria: { hidden: true } }),
          ),
          h('h3', { text: title }),
        ]
      : print
        ? [picture('vn-archive__print', print), ...text]
        : text;
    return h(
      'li',
      {
        class: `vn-archive__item is-${a.kind}${scan ? ' has-scan' : ''}${print ? ' has-print' : ''}`,
        data: { paper: seed % 3 },
        style: { '--tilt': `${NOTE_TILTS[(seed >>> 3) % NOTE_TILTS.length]}deg` },
      },
      this.opts.path ? h('span', { class: 'vn-archive__num', text: String(index + 1) }) : null,
      h('div', { class: 'vn-archive__paper' }, ...body),
      this.opts.isNew?.(a.id) ? h('span', { class: 'vn-archive__stamp', text: t('ui.archive.new_item') }) : null,
    );
  }
}

// ───────────────────────────── документ ─────────────────────────────

/**
 * Лист настоящей бумаги: клик или касание — вдвое крупнее, ещё раз — назад. Увеличенный лист двигают мышью с зажатой
 * кнопкой (решение владельца 2026-10-13); пальцем — прокруткой браузера, с инерцией. Перетаскивание — не клик: масштаб
 * от него не меняется.
 */
function zoomableSheet(sheet: HTMLElement): HTMLElement {
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  let dragged = false;
  sheet.addEventListener('pointerdown', (e) => {
    dragged = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || !sheet.classList.contains('is-zoomed')) return;
    drag = { x: e.clientX, y: e.clientY, left: sheet.scrollLeft, top: sheet.scrollTop, moved: false };
    sheet.setPointerCapture?.(e.pointerId);
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return; // дрожь руки при клике — ещё клик
    drag.moved = true;
    sheet.classList.add('is-dragging');
    sheet.scrollLeft = drag.left - dx;
    sheet.scrollTop = drag.top - dy;
  });
  const end = (): void => {
    dragged = drag?.moved ?? false;
    drag = null;
    sheet.classList.remove('is-dragging');
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
  sheet.addEventListener('click', () => {
    if (dragged) dragged = false;
    else sheet.classList.toggle('is-zoomed');
  });
  return sheet;
}

export class DocumentScreen extends BaseScreen {
  /** Закрыли не крестиком, а Esc (ScreenHost.closeTop): DomUI продолжает партию так же, как по крестику. */
  onClose?: () => void;

  constructor(
    private readonly episode: Episode,
    private readonly doc: string,
    private readonly textKey: string | null,
    private readonly archiveItem: string | null,
    private readonly onDone: () => void,
    /** Изображение бланка без текста (assets.documents); текст накладывается слоем из локали. */
    private imageUrl: string | null = null,
    /** Текст впечатан в картинку (настоящая бумага, пока по-русски): картинка целиком, касание — увеличить. */
    private readonly textInImage = false,
    /** Бумага только что пришла в дело — метка «новый материал»; из блокнота её открывают уже знакомой, без метки. */
    private readonly fresh = true,
  ) {
    super('vn-document');
  }

  /** Картинка бланка пришла позже, чем открыли экран. */
  setImage(url: string | null): void {
    this.imageUrl = url;
    if (this.textInImage) {
      this.render();
      return;
    }
    const paper = this.el.querySelector<HTMLElement>('.vn-document__paper');
    if (!paper) return;
    paper.classList.toggle('has-image', url !== null);
    if (url) paper.style.setProperty('--doc-img', cssUrl(url));
    else paper.style.removeProperty('--doc-img');
  }

  render(): void {
    const item = this.archiveItem ? this.episode.archive_items?.find((a) => a.id === this.archiveItem) : undefined;
    // Шапка по макету (Figma «Claude», узел 1232:1560): название и метка «новый материал» слева, крестик справа.
    const head = h(
      'div',
      { class: 'vn-document__head' },
      h(
        'div',
        { class: 'vn-document__heading' },
        item ? h('h2', { class: 'vn-document__title', text: t(item.title_key) }) : null,
        item && this.fresh ? h('span', { class: 'vn-document__tag', text: t('ui.archive.new_item') }) : null,
      ),
      h(
        'button',
        { class: 'vn-document__close', type: 'button', title: t('ui.common.close'), aria: { label: t('ui.common.close') }, on: { click: this.onDone } },
        icon('close'),
      ),
    );
    if (this.textInImage && this.imageUrl) {
      const img = h('img', { class: 'vn-document__img' });
      img.alt = '';
      img.src = this.imageUrl;
      const sheet = zoomableSheet(h('div', { class: 'vn-document__sheet', data: { doc: this.doc } }, img));
      const text = this.textKey ? t(this.textKey) : '';
      fill(
        this.el,
        h(
          'div',
          { class: 'vn-document__box', data: { backdrop: 1 } },
          head,
          sheet,
          // Текст бумаги — для скринридера; на других языках — перевод под картинкой (в картинке он русский).
          text ? h('p', { class: i18n.lang === 'ru' ? 'vn-sr' : 'vn-document__text vn-document__translation', text }) : null,
        ),
      );
      return;
    }
    fill(
      this.el,
      h(
        'div',
        { class: 'vn-document__box', data: { backdrop: 1 } },
        head,
        h(
          'div',
          {
            class: `vn-document__paper${this.imageUrl ? ' has-image' : ''}`,
            data: { doc: this.doc },
            ...(this.imageUrl ? { style: { '--doc-img': cssUrl(this.imageUrl) } } : {}),
          },
          this.textKey ? h('p', { class: 'vn-document__text', text: t(this.textKey) }) : h('p', { class: 'vn-muted', text: this.doc }),
        ),
      ),
    );
  }
}

// ───────────────────────────── финал ─────────────────────────────

export class EndingScreen extends BaseScreen {
  constructor(
    private readonly ending: Ending,
    private readonly state: Readonly<GameState>,
    private readonly handlers: { onMenu: () => void; onArchive: () => void },
    private readonly episode: Episode | null = null,
  ) {
    super('vn-ending', false);
  }

  /**
   * Финал (владелец 2026-10-14: «переделать интереснее, с бумаги»): лист уголовного дела. Шапка — «Уголовное дело»,
   * город и год (на языке оригинала; иначе — год), название эпизода; штамп — название концовки; «Ход следствия» —
   * решения партии по порядку; внизу — сколько материалов собрано в блокнот и сколько решений. Кнопки — под листом.
   */
  render(): void {
    const { journal, archive } = this.state;
    const ep = this.episode;
    const year = ep?.based_on.years[0];
    const city = ep && i18n.lang === (ep.localization?.source_lang ?? 'ru') ? ep.based_on.city : '';
    const place = [city, year === undefined ? '' : String(year)].filter((x) => x !== '').join(' · ');
    const total = ep?.archive_items?.length ?? 0;
    fill(
      this.el,
      h(
        'div',
        { class: 'vn-ending__box' },
        h(
          'article',
          { class: `vn-ending__sheet is-${this.ending.kind}` },
          h('span', { class: 'vn-ending__clip', aria: { hidden: true } }),
          h('header', { class: 'vn-ending__head' }, h('span', { text: t('ui.end.case') }), place ? h('span', { text: place }) : null),
          ep ? h('p', { class: 'vn-ending__case', text: t(ep.title_key) }) : null,
          h('div', { class: 'vn-ending__stamp' }, h('span', { class: 'vn-ending__kicker', text: t('ui.end.title') }), h('h2', { class: 'vn-ending__title', text: t(this.ending.title_key) })),
          h('h3', { class: 'vn-ending__sub', text: t('ui.end.decisions') }),
          journal.length === 0
            ? h('p', { class: 'vn-muted', text: '—' })
            : h(
                'ol',
                { class: 'vn-ending__journal' },
                ...journal.map((j, i) =>
                  h(
                    'li',
                    { class: `vn-ending__entry${j.kind ? ` is-${j.kind}` : ''}`, style: { '--i': String(i) } },
                    h('span', { class: 'vn-ending__n', text: String(i + 1).padStart(2, '0') }),
                    h(
                      'span',
                      { class: 'vn-ending__text' },
                      j.prompt_key ? h('span', { class: 'vn-ending__prompt', text: t(j.prompt_key) }) : null,
                      h('span', { class: 'vn-ending__choice', text: t(j.key) }),
                    ),
                  ),
                ),
              ),
          h(
            'footer',
            { class: 'vn-ending__foot' },
            total > 0 ? h('span', { text: t('ui.end.materials', { n: Math.min(archive.length, total), total }) }) : null,
            h('span', { text: t('ui.end.decisions_n', { n: journal.length }) }),
          ),
        ),
        h(
          'div',
          { class: 'vn-actions vn-ending__actions' },
          h('button', { class: 'vn-btn', type: 'button', text: t('ui.menu.archive'), on: { click: this.handlers.onArchive } }),
          h('button', { class: 'vn-btn is-primary', type: 'button', text: t('ui.end.back_to_menu'), on: { click: this.handlers.onMenu } }),
        ),
      ),
    );
  }
}

// ───────────────────────────── ошибка ─────────────────────────────

export class ErrorScreen extends BaseScreen {
  constructor(
    private readonly message: string,
    private readonly onDone: () => void,
  ) {
    super('vn-error', false);
  }

  render(): void {
    fill(
      this.el,
      card(
        'vn-error__card',
        h('h2', { class: 'vn-card__title', lang: 'en', text: 'Error' }),
        h('pre', { class: 'vn-error__msg', text: this.message }),
        h('div', { class: 'vn-actions' }, backButton(this.onDone, 'ui.common.ok')),
      ),
    );
  }
}

// ───────────────────────────── контейнер мини-игры ─────────────────────────────

/** Экран-контейнер: сама мини-игра рисует в `body` (DOM) и, при необходимости, в слое PixiJS. */
export class MinigameScreen extends BaseScreen {
  readonly body: HTMLElement;

  constructor() {
    super('vn-mg', false);
    this.body = h('div', { class: 'vn-mg__body' });
    this.el.appendChild(this.body);
  }

  render(): void {
    /* содержимое рисует мини-игра */
  }
}
