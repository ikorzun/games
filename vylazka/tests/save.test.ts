import { describe, expect, it } from 'vitest';
import { defaultProfile, loadSave, objectNumber, parseProfile, rankFor, sortieSeed, writeProfile } from '../src/core/save';
import type { IPlatform } from '../src/platform/types';

/** Платформа-заглушка с памятью: записывает всё, что просили сохранить. */
function memory(initial: Record<string, unknown> = {}): { platform: IPlatform; store: Record<string, unknown>; saves: string[][] } {
  const store = { ...initial };
  const saves: string[][] = [];
  const platform = {
    load: async (keys: string[]) => keys.map((k) => store[k] ?? null),
    save: async (keys: string[], values: unknown[]) => {
      saves.push(keys);
      keys.forEach((k, i) => (store[k] = values[i]));
    },
  } as unknown as IPlatform;
  return { platform, store, saves };
}

describe('сохранение', () => {
  it('профиль: мусор заменяется значениями по умолчанию, архив без повторов', () => {
    expect(parseProfile(null, 7)).toEqual(defaultProfile(7));
    expect(parseProfile({ v: 2 }, 7)).toEqual(defaultProfile(7));
    expect(parseProfile({ v: 1, sorties: 3.7, successes: -2, archive: ['a', 'a', 5, 'b'], baseSeed: 42 }, 7)).toEqual({ v: 1, sorties: 3, successes: 0, archive: ['a', 'b'], baseSeed: 42, muted: false, sens: 1, bright: 1, calm: false, lang: null, place: 'shelter' });
    // Чувствительность и яркость: только 0, 1, 2; всё прочее — середина.
    expect(parseProfile({ v: 1, sens: 2, bright: 0 }, 7)).toMatchObject({ sens: 2, bright: 0 });
    expect(parseProfile({ v: 1, sens: 5, bright: 'x' }, 7)).toMatchObject({ sens: 1, bright: 1 });
    // Место вылазки: убежище, офис или жёлтые комнаты; всё прочее — убежище.
    expect(parseProfile({ v: 1, place: 'office' }, 7).place).toBe('office');
    expect(parseProfile({ v: 1, place: 'yellow' }, 7).place).toBe('yellow');
    expect(parseProfile({ v: 1, place: 'moon' }, 7).place).toBe('shelter');
    // Выключатель звука запоминается; всё, кроме true, — «звук включён».
    expect(parseProfile({ v: 1, muted: true }, 7).muted).toBe(true);
    expect(parseProfile({ v: 1, muted: 'yes' }, 7).muted).toBe(false);
  });

  it('«вспышки помягче» и язык: запоминаются; всё непонятное — по умолчанию (обычные вспышки, язык не выбран)', () => {
    expect(defaultProfile(1)).toMatchObject({ calm: false, lang: null });
    expect(parseProfile({ v: 1, calm: true, lang: 'ru' }, 7)).toMatchObject({ calm: true, lang: 'ru' });
    expect(parseProfile({ v: 1, calm: 'yes', lang: 5 }, 7)).toMatchObject({ calm: false, lang: null });
    expect(parseProfile({ v: 1 }, 7)).toMatchObject({ calm: false, lang: null });
  });

  it('старое сохранение с вылазкой читается: профиль цел, вылазку игра не знает', async () => {
    const m = memory({ profile: { v: 1, sorties: 4, successes: 2, archive: ['kettle'], baseSeed: 9, calm: true, lang: 'es' }, run: { v: 1, seed: 5 } });
    const save = await loadSave(m.platform, 1);
    expect(save).not.toHaveProperty('run');
    expect(save.profile).toMatchObject({ sorties: 4, successes: 2, archive: ['kettle'], baseSeed: 9, calm: true, lang: 'es' });
  });

  it('профиль записывается и читается обратно; пишется только он', async () => {
    const m = memory();
    const p = { ...defaultProfile(3), sorties: 2, archive: ['iron', 'phone'], calm: true, lang: 'ru' };
    await writeProfile(m.platform, p);
    expect(m.saves).toEqual([['profile']]);
    expect((await loadSave(m.platform, 3)).profile).toEqual(p);
  });

  it('сбой платформы не роняет загрузку: профиль по умолчанию', async () => {
    const platform = { load: async () => Promise.reject(new Error('нет доступа')), save: async () => Promise.reject(new Error('нет доступа')) } as unknown as IPlatform;
    expect((await loadSave(platform, 11)).profile).toEqual(defaultProfile(11));
    await expect(writeProfile(platform, defaultProfile(1))).resolves.toBeUndefined();
  });

  it('ранг растёт с закрытыми сессиями; сид следующей зависит от числа начатых; номер убежища трёхзначный', () => {
    const p = defaultProfile(1);
    expect(rankFor(p)).toBe(1);
    expect(rankFor({ ...p, successes: 1 })).toBe(2);
    expect(rankFor({ ...p, successes: 3 })).toBe(3);
    expect(sortieSeed(p)).not.toBe(sortieSeed({ ...p, sorties: 1 }));
    expect(sortieSeed(p)).toBe(sortieSeed({ ...p }));
    for (const seed of [0, 1, 899, 900, 4294967295]) {
      expect(objectNumber(seed)).toBeGreaterThanOrEqual(100);
      expect(objectNumber(seed)).toBeLessThanOrEqual(999);
    }
  });
});
