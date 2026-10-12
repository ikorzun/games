/**
 * Грамматика условий: те же кейсы, что в tools/vnexpr_test.py (CASES и BAD),
 * плюс дополнительные проверки порта. Отдельный тест следит, чтобы наборы не разошлись.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, evalCondition, evaluate, ExprError, parse, tokenize, truthy, variables } from '../src/core/expr';
import type { Value } from '../src/core/types';
import { REPO_ROOT } from './helpers/content';

// Зеркало CASES из tools/vnexpr_test.py (порядок и содержание те же).
const CASES: Array<[string, Record<string, Value>, boolean]> = [
  ['trust >= 2 && !found_knife', { trust: 2, found_knife: false }, true],
  ['trust >= 2 && !found_knife', { trust: 1, found_knife: false }, false],
  ['(a || b) && c', { a: false, b: true, c: true }, true],
  ["route == 'market'", { route: 'market' }, true],
  ["route != 'market' || n < -1", { route: 'market', n: -5 }, true],
  ['true', {}, true],
  ['!false', {}, true],
];
// Зеркало BAD из tools/vnexpr_test.py.
const BAD = ['trust >= && x', 'a &&', '(a', "a == 'unterminated", 'A > 1', 'a = 1'];

describe('expr: кейсы vnexpr_test.py', () => {
  for (const [src, env, expected] of CASES) {
    it(`${src}  env=${JSON.stringify(env)} → ${expected}`, () => {
      expect(evaluate(parse(src), env)).toBe(expected);
    });
  }

  for (const src of BAD) {
    it(`синтаксическая ошибка: ${JSON.stringify(src)}`, () => {
      expect(() => parse(src)).toThrow(ExprError);
    });
  }

  it('variables() собирает имена из выражения', () => {
    expect(new Set(variables(parse('x > 1 && (y || !z)')))).toEqual(new Set(['x', 'y', 'z']));
  });
});

describe('expr: наборы кейсов не разошлись с Python-оригиналом', () => {
  const pyPath = join(REPO_ROOT, 'tools', 'vnexpr_test.py');
  const run = existsSync(pyPath) ? it : it.skip;

  run('CASES и BAD в tools/vnexpr_test.py совпадают с зеркалом в этом файле', () => {
    const py = readFileSync(pyPath, 'utf8');
    const casesBlock = /CASES\s*=\s*\[([\s\S]*?)\n\]/.exec(py)?.[1] ?? '';
    const pyCases = [...casesBlock.matchAll(/^\s*\("([^"]+)",/gm)].map((m) => m[1]);
    const badBlock = /BAD\s*=\s*\[([^\]]*)\]/.exec(py)?.[1] ?? '';
    const pyBad = [...badBlock.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    expect(pyCases, 'не удалось разобрать CASES в vnexpr_test.py — обновите разбор в тесте').not.toHaveLength(0);
    expect(pyCases).toEqual(CASES.map((c) => c[0]));
    expect(pyBad).toEqual(BAD);
  });
});

describe('expr: токены и приоритеты', () => {
  it('токенизирует операторы, числа, строки и идентификаторы', () => {
    expect(tokenize("a>=-2&&b=='x y'").map((t) => `${t.kind}:${t.text}`)).toEqual([
      'ident:a',
      'op:>=',
      'int:-2',
      'op:&&',
      'ident:b',
      'op:==',
      "str:'x y'",
    ]);
  });

  it('&& связывает сильнее ||', () => {
    expect(evalCondition('a || b && c', { a: true, b: false, c: false })).toBe(true);
    expect(evalCondition('(a || b) && c', { a: true, b: false, c: false })).toBe(false);
  });

  it('! применяется к сравнению целиком: !a == b ≡ !(a == b)', () => {
    expect(evalCondition('!n == 3', { n: 3 })).toBe(false);
    expect(evalCondition('!n == 3', { n: 4 })).toBe(true);
    expect(evalCondition('!!ok', { ok: true })).toBe(true);
  });

  it('пробелы вокруг выражения игнорируются', () => {
    expect(evalCondition('   x   ', { x: true })).toBe(true);
  });

  it('вычисление ленивое: правая часть не считается, если результат известен', () => {
    expect(evalCondition('a || missing', { a: true })).toBe(true);
    expect(evalCondition('a && missing', { a: false })).toBe(false);
  });
});

describe('expr: значения и ошибки вычисления', () => {
  it('неопределённая переменная — ExprError', () => {
    expect(() => evaluate(parse('ghost'), {})).toThrow(ExprError);
    expect(() => evaluate(parse('constructor'), {})).toThrow(ExprError);
  });

  it('истинность как в Python: 0 и пустая строка ложны', () => {
    expect(truthy(0)).toBe(false);
    expect(truthy(3)).toBe(true);
    expect(truthy('')).toBe(false);
    expect(truthy('x')).toBe(true);
    expect(evalCondition('n', { n: 0 })).toBe(false);
    expect(evalCondition('s', { s: '' })).toBe(false);
  });

  it('bool сравнивается с числом численно, как True == 1 в Python', () => {
    expect(evalCondition('flag == 1', { flag: true })).toBe(true);
    expect(evalCondition('flag == 0', { flag: false })).toBe(true);
    expect(evalCondition('flag >= 1', { flag: true })).toBe(true);
  });

  it('== и != между строкой и числом не падают; порядковые сравнения — ExprError', () => {
    expect(evalCondition("n == 'x'", { n: 1 })).toBe(false);
    expect(evalCondition("n != 'x'", { n: 1 })).toBe(true);
    expect(() => evalCondition("n < 'x'", { n: 1 })).toThrow(ExprError);
  });

  it('строки сравниваются лексикографически', () => {
    expect(evalCondition("s < 'b'", { s: 'a' })).toBe(true);
    expect(evalCondition("s >= 'b'", { s: 'a' })).toBe(false);
  });

  it('значения, а не только булевы: evaluate("x") возвращает сырое значение', () => {
    expect(evaluate(parse('x'), { x: 7 })).toBe(7);
    expect(evaluate(parse("'abc'"), {})).toBe('abc');
  });

  it('check(): синтаксис и необъявленные переменные', () => {
    expect(check('a && b', new Set(['a', 'b']))).toEqual([]);
    expect(check('a && zz && yy', new Set(['a']))).toEqual(['необъявленная переменная: yy', 'необъявленная переменная: zz']);
    expect(check('a &&', ['a'])[0]).toMatch(/^синтаксис:/);
  });
});
