/**
 * Экраны интерфейса: меню, контент-предупреждение, настройки, журнал, сохранение/загрузка,
 * архив, документ, финал. Все строки — ключи ui.* / ключи эпизода; при смене языка экран
 * перерисовывается целиком (render()).
 */
import { i18n, t } from '../core/i18n';
import type { SaveFile } from '../core/saves';
import { AUTO_DELAY_RANGE, CAMERA_FX_LEVELS, FONT_SCALE_RANGE } from '../core/settings';
import type { CameraFx, Settings } from '../core/settings';
import { LANGS } from '../core/types';
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
  background: string | null;
  plate: string | null;
  /** Логотип передачи: в меню занимает не меньше пятой части экрана. */
  logo: string | null;
}

export interface MenuHandlers {
  /** assets/common/ui/menu_video_salon.webp и title_plate.webp, если они есть. */
  art?: MenuArt;
  hasContinue: () => boolean;
  completed: () => boolean;
  onContinue: () => void;
  onNew: () => void;
  onArchive: () => void;
  onSettings: () => void;
  onLanguage: (lang: Lang) => void;
}

export class MenuScreen extends BaseScreen {
  constructor(
    private readonly episode: Episode,
    private readonly handlers: MenuHandlers,
  ) {
    super('vn-menu', false);
  }

  render(): void {
    const { episode: ep, handlers: hd } = this;
    const meta = [
      ep.estimated_minutes ? t('ui.episode.minutes', { n: ep.estimated_minutes }) : null,
      ep.age_rating ?? null,
      hd.completed() ? t('ui.episode.completed') : null,
    ].filter(Boolean);
    const btn = (label: string, onClick: () => void, cls = ''): HTMLButtonElement =>
      h('button', { class: `vn-btn ${cls}`.trim(), type: 'button', text: label, on: { click: onClick } });
    const art = hd.art;
    // Фон главного меню — видеосалон; нет файла — прежний тёмный градиент.
    this.el.classList.toggle('has-bg', !!art?.background);
    if (art?.background) this.el.style.setProperty('--menu-bg', cssUrl(art.background));
    else this.el.style.removeProperty('--menu-bg');
    const title = h('h1', { class: 'vn-menu__title', text: t(ep.title_key) });
    // Бренд: логотип передачи (assets/common/ui/logo_kr.webp, ≥ 20 % высоты экрана), под ним — название эпизода.
    let brand: HTMLElement = title;
    if (art?.logo) {
      const logo = h('img', { class: 'vn-menu__logo' }) as HTMLImageElement;
      logo.src = art.logo;
      logo.alt = '';
      logo.draggable = false;
      brand = h('div', { class: 'vn-menu__brand has-logo' }, logo, title);
    }
    fill(
      this.el,
      h(
        'div',
        { class: 'vn-menu__inner' },
        brand,
        ep.logline_key ? h('p', { class: 'vn-menu__logline', text: t(ep.logline_key) }) : null,
        h('p', { class: 'vn-menu__meta', text: meta.join(' · ') }),
        h(
          'nav',
          { class: 'vn-menu__nav' },
          hd.hasContinue() ? btn(t('ui.menu.continue'), hd.onContinue, 'is-primary') : null,
          btn(t('ui.menu.new_game'), hd.onNew, hd.hasContinue() ? '' : 'is-primary'),
          btn(t('ui.menu.archive'), hd.onArchive),
          btn(t('ui.menu.settings'), hd.onSettings),
        ),
        languageChips(hd.onLanguage),
      ),
    );
  }
}

/** Переключатель языка: названия на самих языках (требование Playgama). */
export function languageChips(onPick: (lang: Lang) => void): HTMLElement {
  return h(
    'div',
    { class: 'vn-langs', role: 'group', aria: { label: t('ui.menu.language') } },
    ...LANGS.map((lang) =>
      h('button', {
        class: `vn-chip${i18n.lang === lang ? ' is-on' : ''}`,
        type: 'button',
        lang,
        text: t(`ui.lang.${lang}`),
        data: { lang },
        aria: { pressed: i18n.lang === lang },
        on: { click: () => onPick(lang) },
      }),
    ),
  );
}

// ───────────────────────────── контент-предупреждение ─────────────────────────────

export interface WarningHandlers {
  settings: () => Settings;
  onViolenceMode: (mode: Settings['violenceMode']) => void;
  onContinue: (dontShowAgain: boolean) => void;
  onBack: () => void;
}

/** Экран перед эпизодом: предупреждение о содержании + юридический дисклеймер (ethics-and-legal.md §5, §7). */
export class WarningScreen extends BaseScreen {
  private dontShow = false;
  private detailsOpen = true;

  constructor(
    private readonly episode: Episode,
    private readonly handlers: WarningHandlers,
  ) {
    super('vn-warning', false);
  }

  render(): void {
    const { handlers: hd, episode: ep } = this;
    const mode = hd.settings().violenceMode;
    const body = mode === 'schematic' ? t('ui.warning.body_schematic') : t('ui.warning.body_generic');
    const radio = (value: Settings['violenceMode'], label: string): HTMLElement =>
      h(
        'label',
        { class: 'vn-radio' },
        h('input', {
          type: 'radio',
          name: 'violence',
          value,
          checked: mode === value,
          on: { change: () => hd.onViolenceMode(value) },
        }),
        h('span', { text: label }),
      );
    fill(
      this.el,
      card(
        'vn-warning__card',
        h('h2', { class: 'vn-warning__title', text: t('ui.warning.title') }),
        h('p', { class: 'vn-warning__body', text: body }),
        h(
          'fieldset',
          { class: 'vn-warning__violence' },
          h('legend', { text: t('ui.settings.violence_mode') }),
          radio('full', t('ui.settings.violence_full')),
          radio('schematic', t('ui.settings.violence_schematic')),
        ),
        h('button', {
          class: 'vn-linkbtn',
          type: 'button',
          text: t('ui.warning.details'),
          aria: { expanded: this.detailsOpen },
          on: {
            click: () => {
              this.detailsOpen = !this.detailsOpen;
              this.render();
            },
          },
        }),
        h(
          'section',
          { class: 'vn-warning__disclaimer', hidden: !this.detailsOpen },
          h('h3', { text: t('ui.disclaimer.title') }),
          h('p', { text: t('ui.disclaimer.body') }),
          ep.age_rating ? h('p', { class: 'vn-warning__rating', text: ep.age_rating }) : null,
        ),
        h(
          'label',
          { class: 'vn-check' },
          h('input', {
            type: 'checkbox',
            checked: this.dontShow,
            on: { change: (e) => (this.dontShow = (e.target as HTMLInputElement).checked) },
          }),
          h('span', { text: t('ui.warning.dont_show') }),
        ),
        h(
          'div',
          { class: 'vn-actions' },
          backButton(hd.onBack),
          h('button', {
            class: 'vn-btn is-primary',
            type: 'button',
            text: t('ui.warning.continue'),
            on: { click: () => hd.onContinue(this.dontShow) },
          }),
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
          on: {
            input: (e) => {
              const v = Number((e.target as HTMLInputElement).value);
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
        h('div', { class: 'vn-settings__group' }, h('span', { class: 'vn-settings__legend', text: t('ui.settings.language') }), languageChips(hd.onLanguage)),
        cameraFx,
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

export class ArchiveScreen extends BaseScreen {
  constructor(
    private readonly episode: Episode,
    private readonly unlocked: () => readonly string[],
    private readonly onDone: () => void,
  ) {
    super('vn-archive');
  }

  render(): void {
    const ids = new Set(this.unlocked());
    const items: ArchiveItem[] = (this.episode.archive_items ?? []).filter((a) => ids.has(a.id));
    fill(
      this.el,
      card(
        'vn-archive__card',
        h('h2', { class: 'vn-card__title', text: t('ui.archive.title') }),
        items.length === 0
          ? h('p', { class: 'vn-muted', text: t('ui.archive.empty') })
          : h(
              'ul',
              { class: 'vn-archive__list' },
              ...items.map((a) =>
                h(
                  'li',
                  { class: `vn-archive__item is-${a.kind}` },
                  h('h3', { text: t(a.title_key) }),
                  a.real_fact ? h('span', { class: 'vn-badge', text: t('ui.archive.real_fact') }) : null,
                  a.text_key ? h('p', { text: t(a.text_key) }) : null,
                ),
              ),
            ),
        h('div', { class: 'vn-actions' }, backButton(this.onDone)),
      ),
    );
  }
}

// ───────────────────────────── документ ─────────────────────────────

export class DocumentScreen extends BaseScreen {
  constructor(
    private readonly episode: Episode,
    private readonly doc: string,
    private readonly textKey: string | null,
    private readonly archiveItem: string | null,
    private readonly onDone: () => void,
    /** Изображение бланка без текста (assets.documents); текст накладывается слоем из локали. */
    private imageUrl: string | null = null,
  ) {
    super('vn-document', false);
  }

  /** Картинка бланка пришла позже, чем открыли экран. */
  setImage(url: string | null): void {
    this.imageUrl = url;
    const paper = this.el.querySelector<HTMLElement>('.vn-document__paper');
    if (!paper) return;
    paper.classList.toggle('has-image', url !== null);
    if (url) paper.style.setProperty('--doc-img', cssUrl(url));
    else paper.style.removeProperty('--doc-img');
  }

  render(): void {
    const item = this.archiveItem ? this.episode.archive_items?.find((a) => a.id === this.archiveItem) : undefined;
    fill(
      this.el,
      card(
        'vn-document__card',
        item ? h('h2', { class: 'vn-card__title', text: t(item.title_key) }) : null,
        item ? h('span', { class: 'vn-badge', text: t('ui.archive.new_item') }) : null,
        h(
          'div',
          {
            class: `vn-document__paper${this.imageUrl ? ' has-image' : ''}`,
            data: { doc: this.doc },
            ...(this.imageUrl ? { style: { '--doc-img': cssUrl(this.imageUrl) } } : {}),
          },
          this.textKey ? h('p', { class: 'vn-document__text', text: t(this.textKey) }) : h('p', { class: 'vn-muted', text: this.doc }),
        ),
        h('div', { class: 'vn-actions' }, backButton(this.onDone, 'ui.common.ok')),
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
  ) {
    super('vn-ending', false);
  }

  render(): void {
    const journal = this.state.journal;
    fill(
      this.el,
      card(
        'vn-ending__card',
        h('p', { class: 'vn-ending__kicker', text: t('ui.end.title') }),
        h('h2', { class: 'vn-ending__title', text: t(this.ending.title_key) }),
        h('h3', { class: 'vn-ending__sub', text: t('ui.end.decisions') }),
        journal.length === 0
          ? h('p', { class: 'vn-muted', text: '—' })
          : h(
              'ul',
              { class: 'vn-ending__journal' },
              ...journal.map((j) =>
                h(
                  'li',
                  { class: `vn-ending__entry${j.kind ? ` is-${j.kind}` : ''}` },
                  j.prompt_key ? h('span', { class: 'vn-ending__prompt', text: t(j.prompt_key) }) : null,
                  h('span', { class: 'vn-ending__choice', text: t(j.key) }),
                ),
              ),
            ),
        h(
          'div',
          { class: 'vn-actions' },
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
