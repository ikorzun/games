/**
 * Локализация. Строки — плоские словари «ключ → текст», по одному на язык
 * (ui.json + common.json + <episode_id>.json сливаются в один словарь языка).
 *
 * t(key): lang → en → ru → "[key]"  (docs/architecture/05-localization.md §1).
 * Пустая строка считается отсутствующей: каркас `loc_sync skeleton` создаёт пустые ключи.
 * Рантайм никогда не кэширует готовые строки в состоянии — только ключи, поэтому язык
 * можно сменить на лету, перерисовав текущий шаг.
 */
import { LANGS } from './types';
import type { Lang } from './types';

export type Params = Readonly<Record<string, string | number>>;

/** Поддерживаемый код языка из произвольной строки (`ru-RU`, `pt_BR`, …); всё остальное → `en`. */
export function normalizeLang(raw: string | null | undefined): Lang {
  const code = (raw ?? '').trim().toLowerCase().replace('_', '-').split('-')[0] ?? '';
  return (LANGS as readonly string[]).includes(code) ? (code as Lang) : 'en';
}

/** Цепочка подстановки для языка: сам язык, затем en, затем ru (без повторов). */
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

type Listener = (lang: Lang) => void;

export class I18n {
  private readonly bundles = new Map<Lang, Map<string, string>>();
  private readonly listeners = new Set<Listener>();
  private current: Lang = 'en';
  /** Ключи, которые не нашлись ни в одном языке цепочки (для отладки/QA). */
  readonly missing = new Set<string>();

  get lang(): Lang {
    return this.current;
  }

  /** Добавить (слить) строки языка. Повторный вызов с теми же ключами перезаписывает значения. */
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

  hasLang(lang: Lang): boolean {
    return this.bundles.has(lang);
  }

  setLang(lang: Lang): void {
    if (lang === this.current) return;
    this.current = lang;
    for (const cb of [...this.listeners]) cb(lang);
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Перевод строго на заданный язык, без фолбэка; undefined — если пусто/нет. */
  raw(lang: Lang, key: string): string | undefined {
    const v = this.bundles.get(lang)?.get(key);
    return v !== undefined && v.trim() !== '' ? v : undefined;
  }

  has(key: string): boolean {
    return fallbackChain(this.current).some((l) => this.raw(l, key) !== undefined);
  }

  t(key: string, params?: Params): string {
    for (const lang of fallbackChain(this.current)) {
      const v = this.raw(lang, key);
      if (v !== undefined) return interpolate(v, params);
    }
    this.missing.add(key);
    return `[${key}]`;
  }
}

/** Экземпляр приложения. Для тестов создавайте `new I18n()`. */
export const i18n = new I18n();

export function t(key: string, params?: Params): string {
  return i18n.t(key, params);
}
