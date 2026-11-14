/**
 * Локализация: плоские словари «ключ → текст». t(key): lang → en → ru → "[key]".
 * Строки интерфейса малы и вшиты в сборку (locales/<lang>/ui.json), сетевой загрузки нет.
 */
import { LANGS } from './types';
import type { Lang } from './types';

export type Params = Readonly<Record<string, string | number>>;

/** Поддерживаемый язык из произвольного кода (`ru-RU`, `pt_BR`, …) или null. */
export function parseSupportedLang(raw: string | null | undefined): Lang | null {
  const code = (raw ?? '').trim().toLowerCase().replace('_', '-').split('-')[0] ?? '';
  return (LANGS as readonly string[]).includes(code) ? (code as Lang) : null;
}

/** Всё неподдержанное → `en` (требование Playgama). */
export function normalizeLang(raw: string | null | undefined): Lang {
  return parseSupportedLang(raw) ?? 'en';
}

export function fallbackChain(lang: Lang): Lang[] {
  return [...new Set<Lang>([lang, 'en', 'ru'])];
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/** Псевдолокализация (?pseudo=1): строка длиннее на ~35 % — видно обрезания до прихода переводов. */
export function pseudoloc(text: string): string {
  const extra = Math.ceil(Array.from(text).length * 0.35);
  const pad = Array.from({ length: Math.ceil(extra / 4) }, () => '~~~').join(' ');
  return `[!! ${text} ${pad} !!]`;
}

type Listener = (lang: Lang) => void;

export class I18n {
  private readonly bundles = new Map<Lang, Map<string, string>>();
  private readonly listeners = new Set<Listener>();
  private current: Lang = 'en';
  private pseudo = false;
  /** Ключи, которые не нашлись ни в одном языке цепочки (для отладки и смоука). */
  readonly missing = new Set<string>();

  get lang(): Lang {
    return this.current;
  }

  addStrings(lang: Lang, strings: Readonly<Record<string, unknown>>): void {
    let bundle = this.bundles.get(lang);
    if (!bundle) {
      bundle = new Map();
      this.bundles.set(lang, bundle);
    }
    for (const [k, v] of Object.entries(strings)) {
      if (typeof v === 'string') bundle.set(k, v);
    }
  }

  setLang(lang: Lang): void {
    if (lang === this.current) return;
    this.current = lang;
    for (const cb of [...this.listeners]) cb(lang);
  }

  setPseudo(on: boolean): void {
    if (on === this.pseudo) return;
    this.pseudo = on;
    for (const cb of [...this.listeners]) cb(this.current);
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  raw(lang: Lang, key: string): string | undefined {
    const v = this.bundles.get(lang)?.get(key);
    return v !== undefined && v.trim() !== '' ? v : undefined;
  }

  /** Ключи языка (для проверки полноты перевода). */
  keys(lang: Lang): string[] {
    return [...(this.bundles.get(lang)?.keys() ?? [])];
  }

  t(key: string, params?: Params): string {
    for (const lang of fallbackChain(this.current)) {
      const v = this.raw(lang, key);
      if (v !== undefined) return interpolate(this.pseudo ? pseudoloc(v) : v, params);
    }
    this.missing.add(key);
    return `[${key}]`;
  }
}

export const i18n = new I18n();

export function t(key: string, params?: Params): string {
  return i18n.t(key, params);
}
