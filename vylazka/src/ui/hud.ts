/**
 * Надписи поверх кадра, как на записи с нагрудной камеры: REC и номер камеры слева,
 * дата и время справа, подсказка внизу. Всё — DOM поверх canvas (читаемо при любом разрешении рендера).
 */
import { t } from '../core/i18n';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Дата и время записи: старт 13 ноября 2004, 23:41:07, дальше идут игровые секунды. */
export function recTimestamp(seconds: number): string {
  const start = 23 * 3600 + 41 * 60 + 7;
  const total = start + Math.floor(seconds);
  const day = 13 + Math.floor(total / 86400);
  const s = total % 86400;
  return `2004-11-${pad(day)} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly cam: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fps: HTMLElement;
  private lastClock = '';
  private lastHint = '';
  private lastPrompt = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'vz-hud';
    this.el.innerHTML =
      '<div class="vz-hud__top">' +
      '<div class="vz-hud__tl"><span class="vz-hud__dot"></span><span class="vz-hud__rec"></span><span class="vz-hud__cam"></span></div>' +
      '<div class="vz-hud__tr"><span class="vz-hud__clock"></span><span class="vz-hud__fps"></span></div>' +
      '</div>' +
      '<div class="vz-hud__prompt"><span class="vz-hud__prompt-text"></span><span class="vz-hud__bar"><i></i></span></div>' +
      '<div class="vz-hud__hint"></div>';
    parent.append(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.rec = q('.vz-hud__rec');
    this.cam = q('.vz-hud__cam');
    this.clock = q('.vz-hud__clock');
    this.hint = q('.vz-hud__hint');
    this.prompt = q('.vz-hud__prompt-text');
    this.bar = q('.vz-hud__bar i');
    this.fps = q('.vz-hud__fps');
    this.relabel();
  }

  relabel(): void {
    this.rec.textContent = t('hud.rec');
    this.cam.textContent = t('hud.cam');
  }

  setTime(seconds: number): void {
    const s = recTimestamp(seconds);
    if (s !== this.lastClock) {
      this.lastClock = s;
      this.clock.textContent = s;
    }
  }

  /** Подсказка внизу кадра; пустая строка — скрыть. */
  setHint(text: string): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint.textContent = text;
    this.hint.classList.toggle('is-on', text !== '');
  }

  /** Крупная подсказка «трясите фонарь» с полосой прогресса. */
  setShakePrompt(text: string, progress: number): void {
    if (text !== this.lastPrompt) {
      this.lastPrompt = text;
      this.prompt.textContent = text;
      this.el.classList.toggle('is-shake', text !== '');
    }
    this.bar.style.width = `${Math.round(progress * 100)}%`;
  }

  setFps(text: string): void {
    this.fps.textContent = text;
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
  }
}
