/** Всплывающие уведомления (служебные: «только прочитанное», сейв отклонён). «Новый материал» не показываем (2026-10-13). */
import { h } from './dom';

export class ToastLayer {
  readonly el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'vn-toasts', role: 'status', aria: { live: 'polite' } });
  }

  push(text: string, ms = 3200): void {
    const toast = h('div', { class: 'vn-toast', text });
    this.el.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-in'));
    setTimeout(() => {
      toast.classList.remove('is-in');
      setTimeout(() => toast.remove(), 320);
    }, ms);
  }

  clear(): void {
    this.el.replaceChildren();
  }
}
