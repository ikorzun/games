/**
 * Титры по стилям: date_stamp, location, lower_third, chapter, fact
 * (docs/architecture/03-visual-language.md §7). Слой живёт внутри сцены, под текстовым окном.
 * Хранит ключи, а не строки — при смене языка титры перерисовываются на лету.
 */
import { t } from '../core/i18n';
import type { CaptionStyle } from '../core/types';
import type { CaptionEventPayload, ICaptionSink } from '../stage/types';
import { h } from './dom';

interface Entry {
  key: string;
  style: CaptionStyle;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
}

export class CaptionLayer implements ICaptionSink {
  readonly el: HTMLElement;
  private readonly entries = new Set<Entry>();

  constructor(host: HTMLElement) {
    this.el = host;
  }

  /** Неблокирующий титр с автоскрытием через hold_ms. Новый титр того же стиля заменяет прежний. */
  show(ev: CaptionEventPayload): void {
    const entry = this.add(ev.key, ev.style);
    entry.timer = setTimeout(() => this.remove(entry), ev.hold_ms);
  }

  /** Титр, который держит пауза сценария (chapter / fact): закрывается вызывающим. */
  hold(key: string, style: CaptionStyle): () => void {
    const entry = this.add(key, style);
    return () => this.remove(entry);
  }

  clear(): void {
    for (const e of [...this.entries]) this.remove(e, true);
  }

  /** Язык сменили: обновить тексты уже показанных титров. */
  refresh(): void {
    for (const e of this.entries) this.fill(e);
  }

  private add(key: string, style: CaptionStyle): Entry {
    for (const e of [...this.entries]) if (e.style === style) this.remove(e, true);
    const el = h('div', { class: `vn-cap vn-cap--${style}`, role: style === 'chapter' ? 'heading' : 'status' });
    const entry: Entry = { key, style, el, timer: null };
    this.fill(entry);
    this.entries.add(entry);
    this.el.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    return entry;
  }

  private fill(e: Entry): void {
    const text = t(e.key);
    if (e.style === 'fact') {
      e.el.replaceChildren(h('span', { class: 'vn-cap__bar' }), h('span', { class: 'vn-cap__text', text }));
    } else {
      e.el.textContent = text;
    }
  }

  private remove(e: Entry, immediate = false): void {
    if (!this.entries.has(e)) return;
    this.entries.delete(e);
    if (e.timer) clearTimeout(e.timer);
    if (immediate) {
      e.el.remove();
      return;
    }
    e.el.classList.remove('is-in');
    e.el.classList.add('is-out');
    setTimeout(() => e.el.remove(), 360);
  }
}
