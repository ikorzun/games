/** Экраны поверх игры: старт и пауза. Один и тот же блок с разным текстом и кнопками настроек. */
import { t } from '../core/i18n';
import type { Quality } from '../render/renderer';

export type OverlayMode = 'hidden' | 'loading' | 'start' | 'paused' | 'error';

export interface OverlayHandlers {
  onStart(): void;
  onResume(): void;
  onQuality(next: Quality): void;
  /** Кнопка «трясти телефоном» (только там, где нужен явный запрос разрешения). */
  onMotion?(): void;
}

const ORDER: readonly Quality[] = ['low', 'med', 'high'];

export class Overlay {
  readonly el: HTMLElement;
  mode: OverlayMode = 'hidden';
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly rotate: HTMLElement;
  private readonly qualityBtn: HTMLButtonElement;
  private readonly motionBtn: HTMLButtonElement;
  private quality: Quality = 'med';
  private touch = false;
  private errorText = '';

  constructor(
    parent: HTMLElement,
    private readonly handlers: OverlayHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vz-overlay';
    this.el.innerHTML =
      '<div class="vz-overlay__box">' +
      '<div class="vz-overlay__title"></div><div class="vz-overlay__sub"></div>' +
      '<div class="vz-overlay__prompt"></div>' +
      '<div class="vz-overlay__row"><button type="button" class="vz-overlay__opt vz-overlay__opt--quality"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--motion"></button></div>' +
      '<div class="vz-overlay__rotate"></div></div>';
    parent.append(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.title = q('.vz-overlay__title');
    this.sub = q('.vz-overlay__sub');
    this.prompt = q('.vz-overlay__prompt');
    this.rotate = q('.vz-overlay__rotate');
    this.qualityBtn = q('.vz-overlay__opt--quality') as HTMLButtonElement;
    this.motionBtn = q('.vz-overlay__opt--motion') as HTMLButtonElement;
    this.motionBtn.hidden = true;

    this.qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = ORDER[(ORDER.indexOf(this.quality) + 1) % ORDER.length]!;
      this.handlers.onQuality(next);
    });
    this.motionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onMotion?.();
    });
    // Весь экран — кнопка «начать» или «продолжить».
    this.el.addEventListener('click', () => {
      if (this.mode === 'start') this.handlers.onStart();
      else if (this.mode === 'paused') this.handlers.onResume();
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

  /** Показать кнопку датчика движения (label — её подпись) или скрыть (null). */
  setMotionButton(label: string | null): void {
    this.motionBtn.hidden = label === null;
    if (label !== null) this.motionBtn.textContent = label;
  }

  show(mode: OverlayMode, errorText = ''): void {
    this.mode = mode;
    this.errorText = errorText;
    this.refresh();
  }

  refresh(): void {
    const m = this.mode;
    this.el.classList.toggle('is-on', m !== 'hidden');
    this.el.dataset.mode = m;
    this.title.textContent = m === 'paused' ? t('ui.paused') : t('ui.title');
    this.sub.textContent = m === 'paused' ? '' : t('ui.subtitle');
    const sfx = this.touch ? '.touch' : '';
    this.prompt.textContent = m === 'loading' ? t('ui.loading') : m === 'start' ? t(`ui.start${sfx}`) : m === 'paused' ? t(`ui.resume${sfx}`) : m === 'error' ? this.errorText : '';
    this.qualityBtn.textContent = `${t('ui.quality')}: ${t(`ui.quality.${this.quality}`)}`;
    this.qualityBtn.hidden = m !== 'start' && m !== 'paused';
    this.rotate.textContent = t('ui.rotate');
  }
}
