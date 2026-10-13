/**
 * Текстовое окно с typewriter-эффектом. Текст — DOM (не canvas): переносы, шрифты, масштаб
 * и скринридер работают средствами браузера. Не показанная часть реплики остаётся в разметке
 * невидимой, поэтому перенос строк не «прыгает» во время печати. Скринридер получает реплику
 * целиком одним сообщением (aria-live), а не по буквам.
 *
 * Раскладка — по макету реплик в Figma (Claude, узел 1230:1541): над подложкой строка говорящего —
 * круглый портрет, имя и подпись под ним; знак «дальше» (>) стоит в конце текста.
 */
import type { NarrateStyle } from '../core/types';
import { h } from './dom';

export type TextLayout = 'window' | 'subtitle';

export interface LineView {
  /** Имя говорящего; null — рассказчик или имя скрыто пресетом показа. */
  name: string | null;
  /** Подпись под именем (роль в истории: «покупатель»); null — без подписи. */
  title: string | null;
  /** Адрес портрета для круга у имени; null — без портрета. */
  portrait: string | null;
  text: string;
  style: 'say' | NarrateStyle;
  layout: TextLayout;
}

function splitGraphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return Array.from(text);
}

export class TextBox {
  readonly el: HTMLElement;

  private readonly whoEl: HTMLElement;
  private readonly avatarEl: HTMLImageElement;
  private readonly nameEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly shownEl: HTMLElement;
  private readonly restEl: HTMLElement;
  private readonly srEl: HTMLElement;
  private chars: string[] = [];
  private index = 0;
  private cps = 40;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private paused = false;
  private readonly completeCbs = new Set<() => void>();

  constructor() {
    this.avatarEl = h('img', { class: 'vn-textbox__avatar', hidden: true });
    this.avatarEl.alt = ''; // портрет — украшение: имя рядом
    this.nameEl = h('span', { class: 'vn-textbox__name' });
    this.titleEl = h('span', { class: 'vn-textbox__title', hidden: true });
    this.whoEl = h('div', { class: 'vn-textbox__who', hidden: true }, this.avatarEl, h('div', { class: 'vn-textbox__id' }, this.nameEl, this.titleEl));
    this.shownEl = h('span', { class: 'vn-textbox__shown' });
    this.restEl = h('span', { class: 'vn-textbox__rest' });
    this.srEl = h('p', { class: 'vn-sr', aria: { live: 'polite' } });
    this.el = h(
      'div',
      { class: 'vn-textbox', hidden: true, data: { style: 'say', layout: 'window' } },
      this.whoEl,
      h(
        'div',
        { class: 'vn-textbox__box' },
        h('p', { class: 'vn-textbox__text', aria: { hidden: true } }, this.shownEl, this.restEl, h('span', { class: 'vn-textbox__more', text: '>' })),
      ),
      this.srEl,
    );
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** Идёт печать (текст показан не целиком). */
  get typing(): boolean {
    return this.running;
  }

  /** Реплика показана целиком. */
  get complete(): boolean {
    return !this.running && this.visible;
  }

  /** Показать реплику. cps = Infinity — мгновенно. */
  show(line: LineView, cps: number): void {
    this.render(line);
    this.cps = cps;
    this.chars = splitGraphemes(line.text);
    this.index = 0;
    this.acc = 0;
    this.el.classList.remove('is-complete');
    this.stop();
    this.srEl.textContent = line.text;
    if (!Number.isFinite(cps) || cps <= 0 || this.chars.length === 0) {
      this.index = this.chars.length;
      this.paint();
      this.finish();
      return;
    }
    this.paint();
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Язык сменили: перерисовать реплику целиком, без повторной печати. */
  rerender(line: LineView): void {
    if (!this.visible) return;
    this.render(line);
    this.stop();
    this.chars = splitGraphemes(line.text);
    this.index = this.chars.length;
    this.srEl.textContent = '';
    this.paint();
    this.finish(false);
  }

  /** Допечатать мгновенно. true — печать действительно шла. */
  finishNow(): boolean {
    if (!this.running) return false;
    this.stop();
    this.index = this.chars.length;
    this.paint();
    this.finish();
    return true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  hide(): void {
    this.stop();
    this.el.hidden = true;
    this.el.classList.remove('is-complete');
  }

  onComplete(cb: () => void): () => void {
    this.completeCbs.add(cb);
    return () => this.completeCbs.delete(cb);
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private render(line: LineView): void {
    this.el.hidden = false;
    this.el.dataset.style = line.style;
    this.el.dataset.layout = line.layout;
    this.whoEl.hidden = !line.name;
    this.nameEl.textContent = line.name ?? '';
    this.titleEl.hidden = !line.name || !line.title;
    this.titleEl.textContent = line.name ? (line.title ?? '') : '';
    const portrait = line.name ? line.portrait : null;
    this.avatarEl.hidden = !portrait;
    if (!portrait) this.avatarEl.removeAttribute('src');
    else if (this.avatarEl.getAttribute('src') !== portrait) this.avatarEl.src = portrait;
  }

  private paint(): void {
    this.shownEl.textContent = this.chars.slice(0, this.index).join('');
    this.restEl.textContent = this.chars.slice(this.index).join('');
  }

  private stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private finish(notify = true): void {
    this.running = false;
    this.el.classList.add('is-complete');
    if (notify) for (const cb of [...this.completeCbs]) cb();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    if (this.paused) {
      this.last = now;
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.acc += (dt * this.cps) / 1000;
    const n = Math.floor(this.acc);
    if (n > 0) {
      this.acc -= n;
      this.index = Math.min(this.chars.length, this.index + n);
      this.paint();
    }
    if (this.index >= this.chars.length) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
