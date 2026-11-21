import { describe, expect, it } from 'vitest';
import { fallbackChain, I18n, interpolate, normalizeLang, parseSupportedLang, pseudoloc } from '../src/core/i18n';
import { angleDelta, approach, linearToSrgb8, smoothstep } from '../src/core/math';
import { hash01, hash2, mulberry32, randInt } from '../src/core/rng';
import en from '../locales/en/ui.json';
import es from '../locales/es/ui.json';
import ru from '../locales/ru/ui.json';

describe('rng', () => {
  it('mulberry32 детерминирован и лежит в [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('hash2 зависит от обеих координат и зерна, значения распределены ровно', () => {
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 1, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 2, 4));
    let sum = 0;
    for (let x = 0; x < 100; x++) for (let y = 0; y < 100; y++) sum += hash01(x, y, 9);
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });

  it('randInt включает обе границы', () => {
    const r = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(randInt(r, 3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });
});

describe('math', () => {
  it('approach не зависит от дробления шага', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = approach(a, 1, 0.2, 1 / 60);
    let b = 0;
    for (let i = 0; i < 6; i++) b = approach(b, 1, 0.2, 1 / 6);
    expect(a).toBeCloseTo(b, 6);
  });

  it('angleDelta идёт кратчайшим путём', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('smoothstep и sRGB на границах', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(linearToSrgb8(0)).toBe(0);
    expect(linearToSrgb8(1)).toBe(255);
    expect(linearToSrgb8(0.2140)).toBeGreaterThan(125);
    expect(linearToSrgb8(0.2140)).toBeLessThan(130);
  });
});

describe('i18n', () => {
  it('язык из кода площадки; неподдержанный → en', () => {
    expect(parseSupportedLang('ru-RU')).toBe('ru');
    expect(parseSupportedLang('pt_BR')).toBeNull();
    expect(normalizeLang('de')).toBe('en');
    expect(fallbackChain('ru')).toEqual(['ru', 'en']);
  });

  it('подстановка параметров и запасной язык', () => {
    const i = new I18n();
    i.addStrings('ru', { a: 'Привет, {name}', only_ru: 'только ру' });
    i.addStrings('en', { a: 'Hi, {name}', b: 'B' });
    i.setLang('ru');
    expect(i.t('a', { name: 'Оля' })).toBe('Привет, Оля');
    expect(i.t('b')).toBe('B');
    i.setLang('en');
    expect(i.t('only_ru')).toBe('только ру');
    expect(i.t('nope')).toBe('[nope]');
    expect([...i.missing]).toEqual(['nope']);
    expect(interpolate('{x} и {y}', { x: 1 })).toBe('1 и {y}');
  });

  it('испанский: любой вариант кода площадки (es-419, es_MX, ES-es) — es; запасные — en, потом ru', () => {
    expect(parseSupportedLang('es')).toBe('es');
    expect(parseSupportedLang('es-419')).toBe('es');
    expect(parseSupportedLang('es_MX')).toBe('es');
    expect(normalizeLang('ES-es')).toBe('es');
    expect(fallbackChain('es')).toEqual(['es', 'en', 'ru']);
  });

  it('в ru, en и es одинаковый набор ключей, пустых строк нет', () => {
    for (const d of [ru, es]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of [...Object.entries(ru), ...Object.entries(en), ...Object.entries(es)]) expect(v.trim(), k).not.toBe('');
  });

  it('подстановки ({n}, {name}…) в ru и es — те же, что в en', () => {
    const marks = (s: string | undefined): string[] => (s?.match(/\{[a-z_][a-z0-9_]*\}/gi) ?? []).sort();
    const dicts: [string, Record<string, string>][] = [
      ['ru', ru],
      ['es', es],
    ];
    for (const [k, v] of Object.entries(en)) for (const [name, d] of dicts) expect(marks(d[k]), `${name} ${k}`).toEqual(marks(v));
  });

  it('испанская строка не длиннее английской в псевдолокализации: матрица раскладки гоняет её (+35 %) — значит, покрывает и испанский', () => {
    for (const [k, v] of Object.entries(en)) expect((es as Record<string, string>)[k]!.length, `es ${k}`).toBeLessThanOrEqual(pseudoloc(v).length);
  });

  it('испанский: вопросы и восклицания с парными знаками ¿ ? и ¡ !', () => {
    const count = (s: string, c: string): number => s.split(c).length - 1;
    for (const [k, v] of Object.entries(es)) {
      expect(count(v, '¿'), `es ${k}: ${v}`).toBe(count(v, '?'));
      expect(count(v, '¡'), `es ${k}: ${v}`).toBe(count(v, '!'));
    }
  });

  it('ключи — только [a-z0-9_.]', () => {
    for (const k of Object.keys(ru)) expect(k).toMatch(/^[a-z0-9_.]+$/);
  });
});
