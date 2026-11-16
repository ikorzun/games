import { describe, expect, it } from 'vitest';
import * as S from '../src/render/shaders';

/**
 * Униформа, объявленная только в вершинном шейдере, во фрагментном не видна: шейдер не собирается, и
 * мир пропадает целиком (так было с uDots). Модульные тесты шейдеров не компилируют — поэтому здесь
 * проверка по тексту: всё, что фрагментный шейдер берёт из униформ (имена u + заглавная), в нём объявлено.
 */
function names(src: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) out.add(m[1]!);
  return out;
}

describe('униформы шейдеров', () => {
  const frags = Object.entries(S).filter(([k, v]) => /_FRAG$/.test(k) && typeof v === 'string') as [string, string][];

  it('фрагментных шейдеров нашлось достаточно', () => {
    expect(frags.length).toBeGreaterThan(8);
  });

  for (const [name, src] of frags) {
    it(`${name}: каждая используемая униформа объявлена в нём самом`, () => {
      const declared = names(src, /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(u[A-Z]\w*)/g);
      const used = names(src, /\b(u[A-Z]\w*)\b/g);
      const missing = [...used].filter((u) => !declared.has(u));
      expect(missing).toEqual([]);
    });
  }
});
