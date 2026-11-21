import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECK, deckKeys, metaAllowed, nextFragment } from '../src/systems/meta';
import { DREAM_PRINTS } from '../src/world/papers';

/**
 * Метаслой (партнёр 21.11, 19:09; квиз — «Одна находка за сон»; systems/meta.ts): колода обрывков истории больного сна, один за
 * сон в лимбо, не в первом сне, без счёта.
 */
const locale = (lang: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../locales/${lang}/ui.json`, import.meta.url), 'utf8')) as Record<string, string>;

describe('колода обрывков', () => {
  it('12–16 обрывков, у каждого свой id; есть все пять видов — вызов, переписка, записка, снимок, запись', () => {
    expect(DECK.length).toBeGreaterThanOrEqual(12);
    expect(DECK.length).toBeLessThanOrEqual(16);
    expect(new Set(DECK.map((f) => f.id)).size).toBe(DECK.length);
    for (const kind of ['call', 'chat', 'note', 'photo', 'video']) expect(DECK.some((f) => f.kind === kind), kind).toBe(true);
    for (const f of DECK) {
      expect(f.hold, f.id).toBeGreaterThanOrEqual(4);
      expect(f.hold, f.id).toBeLessThanOrEqual(8);
    }
  });

  it('у каждого обрывка есть то, что показать: строки, звонки, записка, снимок колоды с куском внутри кадра, миг записи', () => {
    for (const f of DECK) {
      if (f.kind === 'chat') expect(f.lines?.length, f.id).toBeGreaterThan(0);
      if (f.kind === 'call') expect(f.calls?.length, f.id).toBeGreaterThan(0);
      if (f.kind === 'note') expect(f.note, f.id).toBeTruthy();
      if (f.kind === 'video') expect(['recall', 'apparition']).toContain(f.moment);
      if (f.kind === 'photo') {
        expect(DREAM_PRINTS.some((p) => p[0] === f.print), `${f.id}: снимка ${f.print} нет в колоде`).toBe(true);
        const [x, y, w, h] = f.crop!;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(1);
        expect(y + h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('тексты — на трёх языках, английский — первоисточник; у её имени текста нет (имя не сохранилось)', () => {
    for (const lang of ['en', 'ru', 'es']) {
      const d = locale(lang);
      for (const k of deckKeys()) expect(d[k], `${lang}: ${k}`).toBeTruthy();
    }
    expect(locale('en')['meta.missed.n']).toContain('{n}');
    expect(locale('ru')['meta.missed.n']).toContain('{n}');
    expect(locale('es')['meta.missed.n']).toContain('{n}');
  });
});

describe('какой обрывок следующий', () => {
  it('по порядку колоды, увиденные — мимо; колода пройдена — больше нет', () => {
    const all = { recall: true, apparition: true };
    expect(nextFragment([], all)?.id).toBe(DECK[0]!.id);
    expect(nextFragment([DECK[0]!.id], all)?.id).toBe(DECK[1]!.id);
    expect(nextFragment(DECK.map((f) => f.id), all)).toBeNull();
  });

  it('запись без кадров не сгорает: её пропускают и показывают, когда кадры есть', () => {
    const video = DECK.findIndex((f) => f.kind === 'video');
    const seen = DECK.slice(0, video).map((f) => f.id);
    expect(nextFragment(seen, { recall: false, apparition: false })?.id).toBe(DECK[video + 1]!.id);
    expect(nextFragment(seen, { recall: true, apparition: false })?.id).toBe(DECK[video]!.id);
    // Запись мига, когда она показалась, — и из кадров мига, когда вспомнил, если её кадров нет.
    expect(nextFragment(seen, { recall: false, apparition: true })?.id).toBe(DECK[video]!.id);
  });

  it('не в первом сне и не на пробных уровнях', () => {
    expect(metaAllowed(0, false)).toBe(false);
    expect(metaAllowed(1, false)).toBe(false);
    expect(metaAllowed(2, false)).toBe(true);
    expect(metaAllowed(9, true)).toBe(false);
  });
});
