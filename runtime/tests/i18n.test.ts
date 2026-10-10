/** i18n: цепочка lang → en → ru → "[key]", пустые строки, подстановки, смена языка на лету. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fallbackChain, I18n, interpolate, normalizeLang } from '../src/core/i18n';
import { LANGS } from '../src/core/types';
import type { Episode, Lang } from '../src/core/types';
import { EP01_PATH, hasRepoContent, loadEpisode, loadLocale, loadStrings } from './helpers/content';

function make(): I18n {
  const i = new I18n();
  i.addStrings('ru', { 'a.only_ru': 'только ру', 'a.all': 'ру', 'a.empty_en': 'ру-запас' });
  i.addStrings('en', { 'a.all': 'en', 'a.en_es': 'en-строка', 'a.empty_en': '   ' });
  i.addStrings('es', { 'a.all': 'es', 'a.en_es': 'es-строка', 'a.skeleton': '' });
  i.addStrings('pt', { 'a.all': 'pt' });
  return i;
}

describe('i18n: цепочка фолбэков', () => {
  it('lang → en → ru → [key]', () => {
    const i = make();
    i.setLang('es');
    expect(i.t('a.all')).toBe('es'); // сам язык
    expect(i.t('a.en_es')).toBe('es-строка');
    i.setLang('pt');
    expect(i.t('a.en_es')).toBe('en-строка'); // pt нет → en
    expect(i.t('a.only_ru')).toBe('только ру'); // нет ни в pt, ни в en → ru
    expect(i.t('a.nowhere')).toBe('[a.nowhere]'); // нигде → видимая заглушка
    expect(i.missing.has('a.nowhere')).toBe(true);
  });

  it('пустая строка (каркас loc_sync skeleton) и строка из пробелов считаются отсутствующими', () => {
    const i = make();
    i.setLang('es');
    expect(i.t('a.skeleton')).toBe('[a.skeleton]');
    i.setLang('en');
    expect(i.t('a.empty_en')).toBe('ру-запас'); // en пустой → ru
  });

  it('для ru цепочка ru → en → ru без повторов; для en: en → ru', () => {
    expect(fallbackChain('ru')).toEqual(['ru', 'en']);
    expect(fallbackChain('en')).toEqual(['en', 'ru']);
    expect(fallbackChain('pt')).toEqual(['pt', 'en', 'ru']);
  });

  it('язык без загруженного словаря целиком уходит в фолбэк', () => {
    const i = make();
    i.setLang('pt');
    expect(i.hasLang('pt')).toBe(true);
    const j = new I18n();
    j.addStrings('en', { k: 'v' });
    j.setLang('es');
    expect(j.hasLang('es')).toBe(false);
    expect(j.t('k')).toBe('v');
  });

  it('смена языка на лету: те же ключи — другой текст, подписчики уведомляются один раз', () => {
    const i = make();
    const seen: Lang[] = [];
    const off = i.onChange((l) => seen.push(l));
    i.setLang('ru');
    expect(i.t('a.all')).toBe('ру');
    i.setLang('en');
    expect(i.t('a.all')).toBe('en');
    i.setLang('en'); // без изменения — без события
    off();
    i.setLang('pt');
    expect(seen).toEqual(['ru', 'en']);
  });

  it('подстановки {name}: известные заменяются, неизвестные остаются как есть', () => {
    expect(interpolate('{n} мин, {who}', { n: 40 })).toBe('40 мин, {who}');
    const i = new I18n();
    i.addStrings('en', { 'ui.episode.minutes': '{n} min' });
    i.setLang('en');
    expect(i.t('ui.episode.minutes', { n: 40 })).toBe('40 min');
    expect(i.t('ui.missing.key', { n: 1 })).toBe('[ui.missing.key]');
  });

  it('не строки (мусор в словаре) игнорируются', () => {
    const i = new I18n();
    i.addStrings('en', { ok: 'да', num: 5 as unknown as string, nul: null as unknown as string });
    i.setLang('en');
    expect(i.t('ok')).toBe('да');
    expect(i.t('num')).toBe('[num]');
  });
});

describe('i18n: нормализация кода языка', () => {
  it('ru / en / es / pt и региональные варианты поддерживаются, остальное → en', () => {
    for (const [raw, want] of [
      ['ru', 'ru'],
      ['ru-RU', 'ru'],
      ['pt_BR', 'pt'],
      ['PT-br', 'pt'],
      ['es-419', 'es'],
      ['en-GB', 'en'],
      ['de', 'en'],
      ['zh-CN', 'en'],
      ['', 'en'],
      [null, 'en'],
      [undefined, 'en'],
    ] as const) {
      expect(normalizeLang(raw), String(raw)).toBe(want);
    }
  });
});

const real = hasRepoContent() ? describe : describe.skip;

function collectKeys(ep: Episode): Set<string> {
  const keys = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (typeof o === 'object' && o !== null) {
      for (const [k, v] of Object.entries(o)) {
        if ((k === 'key' || k.endsWith('_key')) && typeof v === 'string') keys.add(v);
        else walk(v);
      }
    }
  };
  walk(ep);
  return keys;
}

real('i18n: настоящие локали ep01', () => {
  const episode = loadEpisode(EP01_PATH);
  const keys = collectKeys(episode);

  function bundle(langs: Lang[]): I18n {
    const i = new I18n();
    for (const l of langs) i.addStrings(l, loadStrings(l, episode.id));
    return i;
  }

  it('каждый ключ эпизода переводится на каждом языке (хотя бы через фолбэк); заглушек [key] нет', () => {
    const i = bundle([...LANGS]);
    for (const lang of LANGS) {
      i.setLang(lang);
      const bad = [...keys].filter((k) => i.t(k).startsWith('['));
      expect(bad, lang).toEqual([]);
    }
  });

  it('при полном наборе ru/en фолбэк es/pt срабатывает только на пустых ключах', () => {
    const i = bundle([...LANGS]);
    i.setLang('es');
    const es = loadStrings('es', episode.id);
    for (const k of keys) {
      const own = es[k];
      const text = i.t(k);
      if (typeof own === 'string' && own.trim() !== '') expect(text).toBe(own);
      else expect(text === i.raw('en', k) || text === i.raw('ru', k)).toBe(true);
    }
  });

  it('без es и pt (не загружены) эпизод играбелен целиком на en, а без en — на ru', () => {
    const onlyRuEn = bundle(['ru', 'en']);
    onlyRuEn.setLang('pt');
    expect([...keys].every((k) => !onlyRuEn.t(k).startsWith('['))).toBe(true);
    const onlyRu = bundle(['ru']);
    onlyRu.setLang('es');
    expect([...keys].every((k) => !onlyRu.t(k).startsWith('['))).toBe(true);
    expect(onlyRu.t(episode.title_key)).toBe(loadLocale('ru', episode.id)[episode.title_key]);
  });

  it('названия языков в ui.json — на самих языках на всех четырёх локалях', () => {
    for (const lang of LANGS) {
      const ui = loadLocale(lang, 'ui');
      expect([ui['ui.lang.ru'], ui['ui.lang.en'], ui['ui.lang.es'], ui['ui.lang.pt']]).toEqual([
        'Русский',
        'English',
        'Español',
        'Português',
      ]);
    }
  });

  it('все ui.*-ключи, которые использует код рантайма, есть в ui.json всех языков', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = join(here, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(srcDir);
    const used = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](ui\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)['"`]/g)) {
        if (m[1]) used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const ru = loadLocale('ru', 'ui');
    for (const lang of LANGS) {
      const ui = loadLocale(lang, 'ui');
      const missing = [...used].filter((k) => !(k in ui));
      expect(missing, `ui.json ${lang}`).toEqual([]);
    }
    const unknownToRu = [...used].filter((k) => !(k in ru));
    expect(unknownToRu).toEqual([]);
  });

  it('смена языка на лету на реальных данных', () => {
    const i = bundle([...LANGS]);
    const texts = LANGS.map((l) => {
      i.setLang(l);
      return i.t(episode.title_key);
    });
    expect(new Set(texts).size).toBe(4);
    expect(vi.isMockFunction(i.t)).toBe(false);
  });
});
