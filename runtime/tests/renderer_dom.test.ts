// @vitest-environment jsdom
/** DOM-рендерер плейсхолдеров: offscreen-спрайты не рисуются, подсветка говорящего, детерминированные цвета. */
import { describe, expect, it } from 'vitest';
import { defaultViewFor } from '../src/core/interpreter';
import type { SpriteView, ViewState } from '../src/core/types';
import { hash32, hslToCss, hslToInt, hslToRgb, placeholderHsl } from '../src/stage/placeholders';
import { NO_ASSETS } from '../src/stage/assets';
import { isOffscreen, wantFlip } from '../src/stage/renderer';
import { DomSceneRenderer } from '../src/stage/renderer_dom';
import { miniEpisode } from './helpers/mini';

const episode = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
const sprite = (who: string, position: SpriteView['position'], extra: Partial<SpriteView> = {}): SpriteView => ({
  who,
  expression: 'calm',
  pose: null,
  position,
  silhouette: false,
  ...extra,
});

async function mounted(): Promise<{ r: DomSceneRenderer; host: HTMLElement }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = new DomSceneRenderer();
  await r.mount(host);
  return { r, host };
}
const drawn = (host: HTMLElement): string[] => [...host.querySelectorAll<HTMLElement>('.ph-sprite')].map((n) => n.dataset.who ?? '');

describe('DomSceneRenderer: голос за кадром (offscreen_*)', () => {
  it('isOffscreen распознаёт только offscreen-позиции', () => {
    expect([isOffscreen('offscreen_left'), isOffscreen('offscreen_right')]).toEqual([true, true]);
    expect([isOffscreen('left'), isOffscreen('center'), isOffscreen('right')]).toEqual([false, false, false]);
  });

  it('setView: спрайты с offscreen-позицией остаются в view, но на сцене не рисуются', async () => {
    const { r, host } = await mounted();
    const view: ViewState = {
      ...defaultViewFor(episode, 's1'),
      sprites: [sprite('a', 'left'), sprite('b', 'offscreen_right'), sprite('c', 'right')],
      speaker: 'b',
    };
    r.setView(view);
    expect(drawn(host)).toEqual(['a', 'c']);
    // Говорящий за кадром никого не затемняет.
    expect([...host.querySelectorAll('.ph-sprite.is-dim')]).toHaveLength(0);
  });

  it('showSprite с offscreen-позицией ничего не рисует и убирает прежний спрайт этого персонажа', async () => {
    const { r, host } = await mounted();
    r.showSprite(sprite('b', 'center'), false, 'cut');
    expect(drawn(host)).toEqual(['b']);
    r.showSprite(sprite('b', 'offscreen_left'), true, 'cut');
    expect(drawn(host)).toEqual([]);
    r.showSprite(sprite('a', 'offscreen_right'), false, 'dissolve');
    expect(drawn(host)).toEqual([]);
  });

  it('подсвечивается тот, кто говорит; остальные затемняются, только если говорящий на сцене', async () => {
    const { r, host } = await mounted();
    r.showSprite(sprite('a', 'left'), false, 'cut');
    r.showSprite(sprite('b', 'right'), false, 'cut');
    const dim = (): string[] => [...host.querySelectorAll<HTMLElement>('.ph-sprite.is-dim')].map((n) => n.dataset.who ?? '');
    r.setSpeaker('a');
    expect(dim()).toEqual(['b']);
    r.setSpeaker(null);
    expect(dim()).toEqual([]);
    r.setSpeaker('voice'); // персонажа нет на сцене (голос за кадром)
    expect(dim()).toEqual([]);
  });

  it('фон и CG подписаны своим id, силуэт скрывает имя и выражение', async () => {
    const { r, host } = await mounted();
    r.setBackground('bg_apartment_zoya');
    expect(host.querySelector('.ph-bg .ph-label')?.textContent).toBe('bg_apartment_zoya');
    r.setCg('cg_door_sealed');
    expect(host.querySelector('.ph-cg')?.textContent).toContain('cg_door_sealed');
    expect((host.querySelector('.ph-cg') as HTMLElement).hidden).toBe(false);
    r.setCg(null);
    expect((host.querySelector('.ph-cg') as HTMLElement).hidden).toBe(true);
    r.showSprite(sprite('murashov', 'right', { silhouette: true, expression: null }), false, 'cut');
    const node = host.querySelector('.ph-sprite') as HTMLElement;
    expect(node.classList.contains('is-silhouette')).toBe(true);
    expect(node.querySelector('.ph-name')?.textContent).toBe('?');
  });

  it('schematic-режим насилия затемняет CG и помечает подпись', async () => {
    const { r, host } = await mounted();
    r.setViolenceMode('schematic');
    r.setCg('cg_arrest_night');
    const cg = host.querySelector('.ph-cg') as HTMLElement;
    expect(cg.classList.contains('is-schematic')).toBe(true);
    expect(cg.textContent).toContain('schematic');
    r.setViolenceMode('full');
    expect(cg.classList.contains('is-schematic')).toBe(false);
  });
});

describe('плейсхолдеры: цвет — детерминированная функция id', () => {
  it('одинаковый id → одинаковый цвет, разные id и виды → разные', () => {
    expect(hash32('bg_a')).toBe(hash32('bg_a'));
    expect(placeholderHsl('bg_apartment_zoya', 'bg')).toEqual(placeholderHsl('bg_apartment_zoya', 'bg'));
    expect(hslToCss(placeholderHsl('bg_a', 'bg'))).not.toBe(hslToCss(placeholderHsl('bg_b', 'bg')));
    expect(placeholderHsl('x', 'bg')).not.toEqual(placeholderHsl('x', 'sprite'));
  });

  it('яркость в рабочих диапазонах, конвертация HSL → RGB корректна', () => {
    for (const id of ['bg_a', 'bg_yard_summer', 'bg_courtroom', 'oper', 'cg_verdict']) {
      const bg = placeholderHsl(id, 'bg');
      expect(bg.l).toBeGreaterThanOrEqual(20);
      expect(bg.l).toBeLessThanOrEqual(30);
      expect(bg.h).toBeGreaterThanOrEqual(0);
      expect(bg.h).toBeLessThan(360);
    }
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual([255, 0, 0]);
    expect(hslToRgb({ h: 120, s: 100, l: 50 })).toEqual([0, 255, 0]);
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual([0, 0, 255]);
    expect(hslToInt({ h: 0, s: 0, l: 100 })).toBe(0xffffff);
  });
});

describe('DomSceneRenderer: поворот к собеседнику (решение владельца 2026-10-11)', () => {
  it('wantFlip: при двоих стоящий слева смотрит вправо, справа — влево; один и front — без зеркала', () => {
    expect(wantFlip('left', 'left', 2)).toBe(true);
    expect(wantFlip('left', 'right', 2)).toBe(false);
    expect(wantFlip('right', 'left', 2)).toBe(false);
    expect(wantFlip('right', 'right', 2)).toBe(true);
    expect(wantFlip('center', 'left', 3)).toBe(false);
    expect(wantFlip('left', 'front', 2)).toBe(false);
    expect(wantFlip('left', 'left', 1)).toBe(false);
  });

  it('зеркало появляется, когда на сцену выходит второй, и снимается, когда он уходит', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const facing = (who: string): 'left' | 'right' | 'front' => (who === 'm' ? 'right' : who === 'c' ? 'front' : 'left');
    const r = new DomSceneRenderer({ ...NO_ASSETS, spriteFacing: facing });
    await r.mount(host);
    const flipped = (): string[] => [...host.querySelectorAll<HTMLElement>('.ph-sprite.is-flipped')].map((n) => n.dataset.who ?? '');
    r.showSprite(sprite('a', 'left'), false, 'cut');
    expect(flipped()).toEqual([]); // одна — смотрит на игрока как нарисована
    r.showSprite(sprite('b', 'right'), false, 'cut');
    expect(flipped()).toEqual(['a']); // a слева повёрнута влево → зеркалим к центру; b справа смотрит влево — как надо
    r.showSprite(sprite('m', 'center'), false, 'cut');
    expect(flipped()).toEqual(['a']); // в центре не зеркалим
    r.hideSprite('m', 'cut');
    r.showSprite(sprite('m', 'right'), false, 'cut');
    expect(flipped().sort()).toEqual(['a', 'm']); // m нарисован вправо, стоит справа → к центру через зеркало
    r.showSprite(sprite('c', 'left'), false, 'cut');
    expect(flipped().sort()).toEqual(['a', 'm']); // анфас никогда не зеркалится
    r.hideSprite('b', 'cut');
    r.hideSprite('m', 'cut');
    r.hideSprite('c', 'cut');
    expect(flipped()).toEqual([]); // снова одна
  });
});
