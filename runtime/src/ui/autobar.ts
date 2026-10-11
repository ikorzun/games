/**
 * Полоса авто-режима: красная линия под картинкой (портрет) или над окном текста (ландшафт), которая убывает
 * ровно столько, сколько авто-режим ждёт перед следующей репликой; длительность зависит от числа символов
 * (решение владельца 2026-10-11). Анимация — CSS (--autobar-ms), JS только включает и выключает.
 */
import { h } from './dom';

export class AutoBar {
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  /** Длительность текущего отсчёта, мс; 0 — полоса скрыта. */
  ms = 0;

  constructor() {
    this.fill = h('i', { class: 'vn-autobar__fill' });
    this.el = h('div', { class: 'vn-autobar', aria: { hidden: true } }, this.fill);
  }

  /** Запустить отсчёт: полоса из полной убывает до нуля за ms миллисекунд. */
  start(ms: number): void {
    this.ms = ms;
    this.el.style.setProperty('--autobar-ms', `${Math.max(0, Math.round(ms))}ms`);
    this.el.classList.remove('is-on');
    // Перезапуск CSS-анимации: снять класс, дать стилю примениться, поставить снова.
    void this.fill.offsetWidth;
    this.el.classList.add('is-on');
  }

  stop(): void {
    this.ms = 0;
    this.el.classList.remove('is-on');
  }
}
