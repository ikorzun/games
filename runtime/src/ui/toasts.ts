/** Всплывающие уведомления: «Новый материал: …» при открытии архива. */
import { t } from '../core/i18n';
import type { IToastSink } from '../stage/types';
import { h } from './dom';

export class ToastLayer implements IToastSink {
  readonly el: HTMLElement;

  /** titleKeyOf: ключ названия архивного материала по его id. */
  constructor(private readonly titleKeyOf: (item: string) => string | null) {
    this.el = h('div', { class: 'vn-toasts', role: 'status', aria: { live: 'polite' } });
  }

  archive(item: string): void {
    const titleKey = this.titleKeyOf(item);
    const title = titleKey ? t(titleKey) : item;
    this.push(`${t('ui.archive.new_item')}: ${title}`);
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
