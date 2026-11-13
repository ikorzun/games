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
      '<div class="vz-overlay__prompt"></div>' +
      '<div class="vz-overlay__row"><button type="button" class="vz-overlay__opt vz-overlay__opt--sound"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--quality"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--motion"></button></div>' +
      '<div class="vz-overlay__rotate"></div></div>';
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

  /** Показать кнопку датчика движения (label — её подпись) или скрыть (null). */
  setMotionButton(label: string | null): void {
    this.motionBtn.hidden = label === null;
    if (label !== null) this.motionBtn.textContent = label;
  }

  /** Содержимое карточки для экранов задания и отчёта. */
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
    this.rotate.textContent = t('ui.rotate');
  }
}
