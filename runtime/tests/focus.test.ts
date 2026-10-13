/**
 * Подсветка того, на ком внимание: плавный вес маски (focus_filter.ts) и маски кадров в каталоге ассетов.
 */
import { describe, expect, it } from 'vitest';
import { AssetCatalog, collectBlockAssets } from '../src/stage/assets';
import { fadeAt, fadeDone, FOCUS_DIM, FOCUS_FRAGMENT } from '../src/stage/focus_filter';
import { miniEpisode } from './helpers/mini';

describe('подсветка: вес маски во времени', () => {
  it('от from к to за ms по smoothstep; ms = 0 — сразу', () => {
    const f = { from: 0, to: 1, t0: 1000, ms: 400 };
    expect(fadeAt(f, 900)).toBe(0);
    expect(fadeAt(f, 1200)).toBeCloseTo(0.5, 5);
    expect(fadeAt(f, 1100)).toBeLessThan(0.25); // плавный старт
    expect(fadeAt(f, 1400)).toBe(1);
    expect(fadeDone(f, 1399)).toBe(false);
    expect(fadeDone(f, 1400)).toBe(true);
    expect(fadeAt({ from: 0.7, to: 0, t0: 0, ms: 0 }, 0)).toBe(0);
  });

  it('окружение гаснет на 25–35 % (бриф владельца); шейдер смешивает две маски и кладёт кайму со стороны света', () => {
    expect(FOCUS_DIM).toBeGreaterThanOrEqual(0.25);
    expect(FOCUS_DIM).toBeLessThanOrEqual(0.35);
    expect(FOCUS_FRAGMENT).toContain('uMaskA');
    expect(FOCUS_FRAGMENT).toContain('uMaskB');
  });
});

describe('подсветка: маски кадров в каталоге', () => {
  const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
  ep.scenes.s1!.coverage = 'office';
  ep.assets = {
    ...ep.assets,
    backgrounds: [{ id: 'bg_office', path: 'assets/x/office.webp' }],
    shots: [
      { id: 'sh_wide', set: 'office', bg: 'bg_office', kind: 'wide', angle: 'eye', cast: [{ who: 'a', mask: 'assets/x/wide.a.webp' }, { who: 'b' }], file: 'assets/x/wide.webp' },
    ],
  };
  const cat = new AssetCatalog(ep, './');

  it('маска человека на кадре — адрес; нет маски, человека или кадра — null', () => {
    expect(cat.shotMask('sh_wide', 'a')?.urls).toEqual(['./assets/x/wide.a.webp']);
    expect(cat.shotMask('sh_wide', 'b')).toBeNull();
    expect(cat.shotMask('sh_wide', 'nobody')).toBeNull();
    expect(cat.shotMask('sh_none', 'a')).toBeNull();
  });

  it('маски сета грузятся с блоком в фоне (без ожидания входа в сцену)', () => {
    const block = ep.scenes.s1!.block;
    const plan = collectBlockAssets(ep, cat, block);
    expect(plan.idle.map((c) => c.urls[0])).toContain('./assets/x/wide.a.webp');
    expect(plan.images.map((c) => c.urls[0])).not.toContain('./assets/x/wide.a.webp');
  });
});
