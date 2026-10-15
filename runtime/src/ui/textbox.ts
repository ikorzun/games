/**
 * Текстовое окно с typewriter-эффектом. Текст — DOM (не canvas): переносы, шрифты, масштаб
 * и скринридер работают средствами браузера. Не показанная часть реплики остаётся в разметке
 * невидимой, поэтому перенос строк не «прыгает» во время печати. Скринридер получает реплику
 * целиком одним сообщением (aria-live), а не по буквам.
 *
 * Раскладка — по макету реплик в Figma (Claude, узел 1232:3796): над текстом строка говорящего — круглый портрет,
 * имя и подпись под ним; под каждой строкой текста своя полоса; за напечатанным — красная плашка-каретка, а в ней,
 * когда реплика допечатана, знак «дальше» (>). Полосы — отдельный слой под текстом с той же раскладкой: перекрытия
 * полос внутри слоя не темнеют, и стыки строк ровные в любом движке.
 *
 * Печать — как на машинке: удары неровные (без случайности: повтор реплики печатается так же), после точки и
 * запятой рука замирает.
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

/**
 * Пауза перед знаком i в долях обычного удара: после конца фразы — долго, после запятой — короче, иначе неровная
 * рука ±25 % (дробная часть i·φ — равномерно и одинаково при каждом показе).
 */
export function strokeBeat(prev: string | undefined, i: number): number {
  if (prev !== undefined && /[.!?…]/.test(prev)) return 6;
  if (prev !== undefined && /[,;:—–]/.test(prev)) return 3;
  return 0.75 + ((i * 0.618034) % 1) * 0.5;
}

/** Обычный удар на 15 % короче ровной печати: паузы на знаках это возвращают, реплика печатается за прежнее время. */
const STROKE = 0.85;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Знак «дальше» из макета: тонкий «>» 6 × 8. */
function moreGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 6 8');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M0 8V6.886L4.454 3.996L0 1.114V0L6 3.646V4.347L0 8Z');
  svg.appendChild(path);
  return svg;
}

export class TextBox {
  readonly el: HTMLElement;

  private readonly whoEl: HTMLElement;
  private readonly avatarEl: HTMLImageElement;
  private readonly nameEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly shownEl: HTMLElement;
  private readonly restEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly barRestEl: HTMLElement;
  private readonly srEl: HTMLElement;
  private chars: string[] = [];
  private index = 0;
  private cps = 40;
  /** Сколько мс до следующего удара. */
  private wait = 0;
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
    this.barEl = h('span', { class: 'vn-textbox__bar' });
    this.barRestEl = h('span');
    this.srEl = h('p', { class: 'vn-sr', aria: { live: 'polite' } });
    this.el = h(
      'div',
      { class: 'vn-textbox', hidden: true, data: { style: 'say', layout: 'window' } },
      this.whoEl,
      h(
        'div',
        { class: 'vn-textbox__box' },
        h('p', { class: 'vn-textbox__text vn-textbox__bars', aria: { hidden: true } }, this.barEl, this.barRestEl),
        h('p', { class: 'vn-textbox__text', aria: { hidden: true } }, this.shownEl, h('span', { class: 'vn-textbox__more' }, moreGlyph()), this.restEl),
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
    // Новая реплика мягко проявляется (просьба владельца 2026-10-14): класс снимаем и ставим заново — анимация с начала.
    this.el.classList.remove('is-entering');
    void this.el.offsetWidth;
    this.el.classList.add('is-entering');
    this.cps = cps;
    this.chars = splitGraphemes(line.text);
    this.index = 0;
    this.wait = this.gap(0);
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
    const shown = this.chars.slice(0, this.index).join('');
    const rest = this.chars.slice(this.index).join('');
    this.shownEl.textContent = this.barEl.textContent = shown;
    this.restEl.textContent = this.barRestEl.textContent = rest;
  }

  /** Сколько мс ждать перед знаком i. */
  private gap(i: number): number {
    return (1000 / this.cps) * STROKE * strokeBeat(this.chars[i - 1], i);
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
    this.wait -= Math.min(100, now - this.last);
    this.last = now;
    const from = this.index;
    while (this.wait <= 0 && this.index < this.chars.length) {
      this.index += 1;
      this.wait += this.gap(this.index);
    }
    if (this.index !== from) this.paint();
    if (this.index >= this.chars.length) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
