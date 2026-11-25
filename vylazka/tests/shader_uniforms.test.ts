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

  /**
   * Сколько четвёрок униформ берёт шейдер, считая без упаковки (каждое число — целый слот, mat3 — три, mat4 — четыре) и вместе
   * с ветками #ifdef: оценка сверху. Сэмплеры — отдельно, они берут блоки текстур.
   */
  function slots(src: string): { vectors: number; samplers: number } {
    let vectors = 0;
    let samplers = 0;
    const clean = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+\w+\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
      const type = m[1]!;
      const n = m[2] ? Number(m[2]) : 1;
      if (/^(i|u)?sampler/.test(type)) samplers += n;
      else vectors += n * (type === 'mat4' ? 4 : type === 'mat3' ? 3 : type === 'mat2' ? 2 : 1);
    }
    return { vectors, samplers };
  }

  it('шейдер мира держится в униформах старых телефонов (WebGL2 обещает фрагментному 224 четвёрки и 16 текстур)', () => {
    // Запас под то, что three.js дописывает сам (камера, матрицы). Было около 231 — таблицы материалов ушли в текстуру uMatTex.
    const { vectors, samplers } = slots(S.WORLD_FRAG);
    expect(vectors).toBeLessThanOrEqual(190);
    expect(samplers).toBeLessThanOrEqual(15);
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
