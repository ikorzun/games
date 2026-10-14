/**
 * Стек модальных экранов поверх игры (меню, настройки, журнал, сейвы, финал …).
 * Фокус возвращается туда, откуда экран открыли; Tab не уходит под экран; Esc закрывает верхний
 * закрываемый экран. Содержимое экранов перерисовывается при смене языка (render()).
 */
import { h } from './dom';

export interface Screen {
  readonly el: HTMLElement;
  /** Перерисовать содержимое (смена языка, обновление данных). */
  render?(): void;
  /** Закрытие Esc / тапом вне карточки разрешено. */
  readonly dismissible?: boolean;
  /** Вызывается после закрытия. */
  onClose?(): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';

export class ScreenHost {
  readonly el: HTMLElement;
  private readonly stack: Array<{ screen: Screen; returnFocus: Element | null }> = [];
  private readonly listeners = new Set<() => void>();
  private readonly backdrops = new WeakSet<Screen>();

  constructor() {
    this.el = h('div', { class: 'vn-screens' });
    this.el.addEventListener('keydown', (e) => this.trapTab(e));
  }

  get top(): Screen | null {
    return this.stack[this.stack.length - 1]?.screen ?? null;
  }

  get count(): number {
    return this.stack.length;
  }

  has(screen: Screen): boolean {
    return this.stack.some((s) => s.screen === screen);
  }

  /** Подписка на открытие/закрытие экранов (интерфейс ставит авто-режим и таймеры на паузу). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  open(screen: Screen): void {
    const returnFocus = document.activeElement;
    screen.el.classList.add('vn-screen');
    this.el.appendChild(screen.el);
    this.stack.push({ screen, returnFocus });
    this.listenBackdrop(screen);
    screen.render?.();
    requestAnimationFrame(() => screen.el.classList.add('is-in'));
    const first = screen.el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    this.emit();
  }

  close(screen: Screen): void {
    const i = this.stack.findIndex((s) => s.screen === screen);
    if (i < 0) return;
    const [entry] = this.stack.splice(i, 1);
    screen.el.remove();
    screen.onClose?.();
    const back = entry?.returnFocus;
    if (i === this.stack.length && back instanceof HTMLElement && document.contains(back)) {
      // Кнопки быстрого меню фокус не получают обратно: иначе Space повторил бы их действие.
      if (back.closest('.vn-quick')) back.blur();
      else back.focus({ preventScroll: true });
    }
    this.emit();
  }

  /**
   * Клик или тап по фону — по самому экрану вне содержимого или по обёртке с data-backdrop (пустое место между записями
   * блокнота) — закрывает экран, как Esc и крестик (просьба владельца 2026-10-14). Незакрываемые экраны (меню,
   * предупреждение, мини-игра, финал) — нет: там фон не отменяет действие внутри сюжета.
   */
  private listenBackdrop(screen: Screen): void {
    if (this.backdrops.has(screen)) return;
    this.backdrops.add(screen);
    const isBackdrop = (t: EventTarget | null): boolean => t === screen.el || (t instanceof HTMLElement && t.dataset.backdrop !== undefined);
    // Нажали на содержимом, отпустили на фоне (тянули лист, выделяли текст) — клик достаётся их общему предку, фону;
    // такое не закрывает: нажатие тоже должно прийтись на фон.
    let downOnBackdrop = false;
    screen.el.addEventListener('pointerdown', (e) => (downOnBackdrop = isBackdrop(e.target)), true);
    screen.el.addEventListener('click', (e) => {
      if (screen.dismissible === false || this.top !== screen || !downOnBackdrop || !isBackdrop(e.target)) return;
      // Тот же клик не должен долистать реплику под экраном: экран уже закрыт, когда клик дойдёт до сцены.
      e.stopPropagation();
      this.close(screen);
    });
  }

  /** Закрыть верхний экран, если он закрываемый. true — что-то закрыто. */
  closeTop(): boolean {
    const top = this.top;
    if (!top || top.dismissible === false) return false;
    this.close(top);
    return true;
  }

  closeAll(): void {
    for (const { screen } of [...this.stack].reverse()) this.close(screen);
  }

  refresh(): void {
    for (const { screen } of this.stack) screen.render?.();
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }

  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const top = this.top;
    if (!top) return;
    const items = [...top.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hidden && x.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
