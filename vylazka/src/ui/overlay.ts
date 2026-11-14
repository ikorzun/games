/**
 * Экраны поверх игры: загрузка, карточка задания, пауза, отчёт о вылазке. Один блок с заголовком,
 * строками и подсказкой; весь экран — кнопка «дальше».
 */
import { t } from '../core/i18n';
import type { Quality } from '../render/renderer';

export type OverlayMode = 'hidden' | 'loading' | 'start' | 'paused' | 'report' | 'error';

export interface OverlayHandlers {
  onStart(): void;
  onResume(): void;
  /** Нажатие на экране отчёта: следующая вылазка. */
  onNext(): void;
  onQuality(next: Quality): void;
  /** Кнопка «трясти телефоном» (только там, где нужен явный запрос разрешения). */
  onMotion?(): void;
  /** Кнопка звука: включить или выключить. */
  onSound?(): void;
  /** Чувствительность обзора и яркость: по кругу ниже → средняя → выше. */
  onSens?(): void;
  onBright?(): void;
  /** Вспышки: полные или мягкие. */
  onFlash?(): void;
  /** Сменить язык. */
  onLang?(): void;
  /** Сменить место вылазки (только на заставке): убежище → офис → жёлтые комнаты. */
  onPlace?(): void;
}

/** Строка карточки: обычная, выполненная цель или подзаголовок. */
export interface CardLine {
  text: string;
  kind?: 'plain' | 'done' | 'todo' | 'head' | 'dim';
}

export interface Card {
  title: string;
  sub: string;
  lines: readonly CardLine[];
  prompt: string;
}

const ORDER: readonly Quality[] = ['low', 'med', 'high'];

export class Overlay {
  readonly el: HTMLElement;
  mode: OverlayMode = 'hidden';
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly body: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly rotate: HTMLElement;
  private readonly qualityBtn: HTMLButtonElement;
  private readonly motionBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly sensBtn: HTMLButtonElement;
  private readonly brightBtn: HTMLButtonElement;
  private readonly flashBtn: HTMLButtonElement;
  private readonly langBtn: HTMLButtonElement;
  private readonly placeBtn: HTMLButtonElement;
  private place = 'shelter';
  private calm = false;
  private sens = 1;
  private bright = 1;
  private sound = true;
  private quality: Quality = 'med';
  private touch = false;
  private errorText = '';
  private card: Card | null = null;
  private shownAt = 0;

  constructor(
    parent: HTMLElement,
    private readonly handlers: OverlayHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vz-overlay';
    this.el.innerHTML =
      '<div class="vz-overlay__box">' +
      '<div class="vz-overlay__title"></div><div class="vz-overlay__sub"></div>' +
      '<div class="vz-overlay__body"></div>' +
      '<div class="vz-overlay__prompt"></div></div>' +
      // Настройки прижаты к низу экрана: середина остаётся свободной, нажатие по ней — всегда «начать».
      '<div class="vz-overlay__foot"><div class="vz-overlay__rotate"></div>' +
      '<div class="vz-overlay__row"><button type="button" class="vz-overlay__opt vz-overlay__opt--sound"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--quality"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--sens"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--bright"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--flash"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--lang"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--place"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--motion"></button></div></div>';
    parent.append(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.title = q('.vz-overlay__title');
    this.sub = q('.vz-overlay__sub');
    this.body = q('.vz-overlay__body');
    this.prompt = q('.vz-overlay__prompt');
    this.rotate = q('.vz-overlay__rotate');
    this.qualityBtn = q('.vz-overlay__opt--quality') as HTMLButtonElement;
    this.motionBtn = q('.vz-overlay__opt--motion') as HTMLButtonElement;
    this.motionBtn.hidden = true;
    this.sensBtn = q('.vz-overlay__opt--sens') as HTMLButtonElement;
    this.brightBtn = q('.vz-overlay__opt--bright') as HTMLButtonElement;
    this.sensBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onSens?.();
    });
    this.brightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onBright?.();
    });
    this.flashBtn = q('.vz-overlay__opt--flash') as HTMLButtonElement;
    this.flashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onFlash?.();
    });
    this.langBtn = q('.vz-overlay__opt--lang') as HTMLButtonElement;
    this.langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onLang?.();
    });
    this.placeBtn = q('.vz-overlay__opt--place') as HTMLButtonElement;
    this.placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onPlace?.();
    });
    this.soundBtn = q('.vz-overlay__opt--sound') as HTMLButtonElement;
    this.soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onSound?.();
    });

    this.qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = ORDER[(ORDER.indexOf(this.quality) + 1) % ORDER.length]!;
      this.handlers.onQuality(next);
    });
    this.motionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onMotion?.();
    });
    // Весь экран — кнопка «начать», «продолжить» или «дальше».
    this.el.addEventListener('click', () => {
      if (this.mode === 'start') this.handlers.onStart();
      else if (this.mode === 'paused') this.handlers.onResume();
      // Отчёт нельзя пролистнуть случайным нажатием сразу после конца вылазки.
      else if (this.mode === 'report' && performance.now() - this.shownAt > 900) this.handlers.onNext();
    });
  }

  setTouch(touch: boolean): void {
    this.touch = touch;
    this.refresh();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.refresh();
  }

  setSound(on: boolean): void {
    this.sound = on;
    this.refresh();
  }

  /** Уровни чувствительности и яркости: 0 — ниже, 1 — средняя, 2 — выше. */
  setLevels(sens: number, bright: number): void {
    this.sens = sens;
    this.bright = bright;
    this.refresh();
  }

  /** Показать кнопку датчика движения (label — её подпись) или скрыть (null). */
  setMotionButton(label: string | null): void {
    this.motionBtn.hidden = label === null;
    if (label !== null) this.motionBtn.textContent = label;
  }

  /** Содержимое карточки для экранов задания и отчёта. */
  /** Вспышки мягкие (true) или полные. */
  setFlash(calm: boolean): void {
    this.calm = calm;
    this.refresh();
  }

  /** Место вылазки, которое выбрано сейчас. */
  setPlace(place: string): void {
    this.place = place;
    this.refresh();
  }

  setCard(card: Card | null): void {
    this.card = card;
    this.refresh();
  }

  show(mode: OverlayMode, errorText = ''): void {
    if (mode !== this.mode) this.shownAt = performance.now();
    this.mode = mode;
    this.errorText = errorText;
    this.refresh();
  }

  refresh(): void {
    const m = this.mode;
    const card = m === 'start' || m === 'report' ? this.card : null;
    this.el.classList.toggle('is-on', m !== 'hidden');
    this.el.dataset.mode = m;
    this.title.textContent = card ? card.title : m === 'paused' ? t('ui.paused') : t('ui.title');
    this.sub.textContent = card ? card.sub : m === 'paused' ? '' : t('ui.subtitle');
    this.body.replaceChildren();
    for (const line of card?.lines ?? []) {
      const row = document.createElement('div');
      row.className = `vz-overlay__line vz-overlay__line--${line.kind ?? 'plain'}`;
      row.textContent = line.text;
      this.body.append(row);
    }
    const sfx = this.touch ? '.touch' : '';
    this.prompt.textContent = card ? card.prompt : m === 'loading' ? t('ui.loading') : m === 'start' ? t(`ui.start${sfx}`) : m === 'paused' ? t(`ui.resume${sfx}`) : m === 'error' ? this.errorText : '';
    this.qualityBtn.textContent = `${t('ui.quality')}: ${t(`ui.quality.${this.quality}`)}`;
    this.qualityBtn.hidden = m !== 'start' && m !== 'paused';
    this.soundBtn.textContent = `${t('ui.sound')}: ${t(this.sound ? 'ui.sound.on' : 'ui.sound.off')}`;
    this.soundBtn.setAttribute('aria-pressed', String(this.sound));
    this.soundBtn.hidden = m !== 'start' && m !== 'paused' && m !== 'report';
    const lv = ['low', 'med', 'high'] as const;
    this.sensBtn.textContent = `${t('ui.sens')}: ${t(`ui.level.${lv[this.sens] ?? 'med'}`)}`;
    this.brightBtn.textContent = `${t('ui.bright')}: ${t(`ui.level.${lv[this.bright] ?? 'med'}`)}`;
    this.sensBtn.hidden = this.qualityBtn.hidden;
    this.brightBtn.hidden = this.qualityBtn.hidden;
    this.flashBtn.textContent = `${t('ui.flash')}: ${t(this.calm ? 'ui.flash.calm' : 'ui.flash.full')}`;
    this.flashBtn.setAttribute('aria-pressed', String(this.calm));
    this.flashBtn.hidden = this.qualityBtn.hidden;
    this.langBtn.textContent = `${t('ui.lang')}: ${t('ui.lang.name')}`;
    this.langBtn.hidden = this.qualityBtn.hidden;
    // Место выбирают до начала: посреди вылазки его не сменить.
    this.placeBtn.textContent = t(`ui.place.${this.place}`);
    this.placeBtn.hidden = m !== 'start';
    this.rotate.textContent = t('ui.rotate');
  }
}
