import { describe, expect, it } from 'vitest';
import en from '../locales/en/ui.json';
import es from '../locales/es/ui.json';
import ru from '../locales/ru/ui.json';
import { WEAR } from '../src/systems/decay';
import { ALL_MEMORIES } from '../src/systems/session';
import { wornLine, wornShare } from '../src/systems/worn_text';

const LAPS = Array.from({ length: 8 }, (_, i) => Math.min(1, i * WEAR.lap));
const words = (s: string): number => s.trim().split(/\s+/).length;

describe('строки вещей с каждым кругом короче', () => {
  it('первые два круга — строка целиком; дальше доля слов только убывает, к концу — четверть', () => {
    expect(wornShare(LAPS[0]!)).toBe(1);
    expect(wornShare(LAPS[1]!)).toBeGreaterThan(0.95);
    for (let i = 1; i < LAPS.length; i++) expect(wornShare(LAPS[i]!)).toBeLessThanOrEqual(wornShare(LAPS[i - 1]!));
    expect(wornShare(1)).toBeCloseTo(0.25, 5);
  });

  it('пример из station.md: «it says: locker.» становится «it says.»', () => {
    expect(wornLine('it says: locker.', 0)).toBe('it says: locker.');
    expect(wornLine('it says: locker.', 1)).toBe('it says.');
  });

  it('режется с конца целыми фразами, пока можно', () => {
    const line = 'it rang. nobody got up. in the kitchen, the kettle was already on.';
    expect(wornLine(line, 0.56)).toBe('it rang. nobody got up.');
    expect(wornLine(line, 1)).toBe('it rang.');
  });

  it('испанский: от оборванного вопроса не остаётся непарного «¿»', () => {
    const line = '¿dónde está el control remoto? el canal no cambia.';
    expect(wornLine(line, 0.56)).toBe('¿dónde está el control remoto?');
    expect(wornLine(line, 1)).toBe('dónde está el.');
    expect(wornLine('la plancha. ¿la desenchufaste?', 1)).toBe('la plancha.');
    expect(wornLine('¡no la apagues, por favor!', 0.56)).toBe('no la apagues.');
    const count = (s: string, c: string): number => s.split(c).length - 1;
    for (const m of ALL_MEMORIES) {
      for (const part of ['flash', 'done']) {
        for (const w of LAPS) {
          const out = wornLine((es as Record<string, string>)[`mem.${m.id}.${part}`]!, w);
          expect(count(out, '¿'), out).toBe(count(out, '?'));
          expect(count(out, '¡'), out).toBe(count(out, '!'));
        }
      }
    }
  });

  it('все строки воспоминаний на всех языках: не длиннее, чем были, не пустые, кончаются точкой и не растут от круга к кругу', () => {
    // Испанский: обрывок вопроса теряет и «¿» — сравниваем без открывающих знаков.
    const bare = (s: string): string => s.replace(/[¿¡]/g, '');
    for (const dict of [en, ru, es] as Record<string, string>[]) {
      for (const m of ALL_MEMORIES) {
        for (const part of ['flash', 'done']) {
          const text = dict[`mem.${m.id}.${part}`];
          expect(text, `mem.${m.id}.${part}`).toBeTruthy();
          let prev = Infinity;
          for (const w of LAPS) {
            const out = wornLine(text!, w);
            expect(out.length).toBeGreaterThan(0);
            expect(bare(text!).startsWith(bare(out).replace(/\.$/, ''))).toBe(true);
            expect(/[.!?…]$/.test(out)).toBe(true);
            expect(words(out)).toBeLessThanOrEqual(prev);
            prev = words(out);
          }
        }
      }
    }
  });
});
