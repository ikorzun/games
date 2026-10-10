/**
 * Выбор: кнопки с вариантами. Таймер (timer_ms) включается только если разрешён в настройках
 * и игрок не в режиме «только история»; по истечении выбирается default_option. Недоступные
 * опции показываются выключенными — игрок видит, что что-то упустил.
 */
import { t } from '../core/i18n';
import type { ChoicePending } from '../core/types';
import { h } from './dom';

export interface AskOptions {
  /** Разрешён ли таймер (настройки). */
  timers: boolean;
  signal: AbortSignal;
}

export class ChoiceMenu {
  readonly el: HTMLElement;

  private pending: ChoicePending | null = null;
  private buttons: HTMLButtonElement[] = [];
  private promptEl: HTMLElement | null = null;
  private timerWrap: HTMLElement | null = null;
  private timerBar: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 0;
  private startedAt = 0;
  private paused = false;
  private pick: ((id: string) => void) | null = null;

  constructor() {
    this.el = h('div', { class: 'vn-choices', hidden: true, role: 'group' });
  }

  get active(): boolean {
    return this.pending !== null;
  }

  ask(p: ChoicePending, opts: AskOptions): Promise<string> {
    this.close();
    this.pending = p;
    return new Promise<string>((resolve) => {
      this.pick = (id) => {
        this.close();
        resolve(id);
      };
      opts.signal.addEventListener('abort', () => this.close(), { once: true });
      this.render();
      this.el.hidden = false;
      this.buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
      const useTimer = opts.timers && p.timer_ms !== null && p.default_option !== null;
      if (useTimer && p.timer_ms !== null) this.startTimer(p.timer_ms);
    });
  }

  /** Номер варианта с клавиатуры (1..n); true — нажатие обработано. */
  chooseByIndex(index: number): boolean {
    const btn = this.buttons[index];
    if (!this.pending || !btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  /** Язык сменили: перерисовать подписи, сохранив выбранную кнопку и таймер. */
  refresh(): void {
    if (!this.pending) return;
    const focusedId = this.el.querySelector<HTMLElement>(':focus')?.dataset.id;
    this.render();
    if (focusedId) this.el.querySelector<HTMLButtonElement>(`[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!this.timerBar) return;
    if (paused) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
      this.timerBar.style.animationPlayState = 'paused';
    } else {
      this.timerBar.style.animationPlayState = 'running';
      this.arm(this.remaining);
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerBar = null;
    this.timerWrap = null;
    this.pending = null;
    this.pick = null;
    this.paused = false;
    this.el.hidden = true;
    this.el.replaceChildren();
    this.buttons = [];
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private render(): void {
    const p = this.pending;
    if (!p) return;
    this.promptEl = p.prompt_key ? h('p', { class: 'vn-choices__prompt', text: t(p.prompt_key) }) : null;
    this.buttons = p.options.map((o, i) =>
      h(
        'button',
        {
          class: `vn-choice${o.enabled ? '' : ' is-disabled'}`,
          type: 'button',
          disabled: !o.enabled,
          data: { id: o.id },
          aria: { disabled: !o.enabled },
          on: { click: () => o.enabled && this.pick?.(o.id) },
        },
        h('span', { class: 'vn-choice__n', text: String(i + 1) }),
        h('span', { class: 'vn-choice__label', text: t(o.key) }),
      ),
    );
    this.el.setAttribute('aria-label', p.prompt_key ? t(p.prompt_key) : '');
    const kids: Node[] = [];
    if (this.promptEl) kids.push(this.promptEl);
    kids.push(...this.buttons);
    if (this.timerWrap) kids.push(this.timerWrap);
    this.el.replaceChildren(...kids);
  }

  private startTimer(ms: number): void {
    const bar = h('i', { class: 'vn-choices__timer-bar', style: { 'animation-duration': `${ms}ms` } });
    const wrap = h('div', { class: 'vn-choices__timer', aria: { hidden: true } }, bar);
    this.timerBar = bar;
    this.timerWrap = wrap;
    this.el.appendChild(wrap);
    this.arm(ms);
  }

  private arm(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.startedAt = performance.now();
    this.remaining = ms;
    this.timer = setTimeout(() => {
      const def = this.pending?.default_option;
      if (def) this.pick?.(def);
    }, ms);
  }
}
