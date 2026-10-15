/** Director: порядок применения событий и правило рекламной паузы (чёрный кадр держится до release). */
import { describe, expect, it } from 'vitest';
import { defaultViewFor } from '../src/core/interpreter';
import type { EngineEvent, Pending, PumpResult, TransitionKind } from '../src/core/types';
import { Director } from '../src/stage/director';
import { FakeAudio, FakeCaptions, FakeStage } from './helpers/fakes';
import type { Timeline } from './helpers/fakes';
import { miniEpisode } from './helpers/mini';

const episode = miniEpisode({
  s_old: { steps: [{ do: 'end', ending: 'e_main' }] },
  s_new: { stage: { bg: 'bg_new' }, music: 'm_new', steps: [{ do: 'end', ending: 'e_main' }] },
  s_mid: { stage: { bg: 'bg_mid' }, steps: [{ do: 'end', ending: 'e_main' }] },
});

function setup() {
  const t: Timeline = [];
  const checkpoints: string[] = [];
  const archived: string[] = [];
  const director = new Director({
    stage: new FakeStage(t),
    audio: new FakeAudio(t),
    captions: new FakeCaptions(t),
    checkpoint: (r) => {
      checkpoints.push(r);
      t.push(`checkpoint:${r}`);
    },
    archiveUnlocked: (i, toast) => archived.push(toast ? i : `${i} (тихо)`),
  });
  return { t, director, checkpoints, archived };
}

const sceneEv = (scene: string, transition: TransitionKind, newBlock = true): EngineEvent => ({
  t: 'scene',
  view: defaultViewFor(episode, scene),
  transition,
  newBlock,
  first: false,
});

const LINE: Pending = {
  kind: 'line',
  style: 'narrate',
  who: null,
  key: 'k',
  expression: null,
  narrate_style: 'voiceover',
  voice: null,
  scene: 's_new',
  index: 0,
};
const AD: Pending = { kind: 'ad_break', block: 'b2' };

describe('Director: обычный показ', () => {
  it('применяет события по порядку и ждёт переходы', async () => {
    const { t, director, checkpoints, archived } = setup();
    const events: EngineEvent[] = [
      sceneEv('s_new', 'fade'),
      { t: 'audio', kind: 'music', id: 'm_new', fade_ms: 800, loop: true, volume: 1 },
      { t: 'caption', key: 'k.cap', style: 'date_stamp', hold_ms: 3500 },
      { t: 'show', sprite: { who: 'a', expression: 'calm', pose: null, position: 'left', silhouette: false }, existing: false, transition: 'dissolve' },
      { t: 'speaker', who: 'a' },
      { t: 'bg', bg: 'bg_z', filter: 'noir', transition: 'fade' },
      { t: 'cg', cg: 'cg_a', transition: 'flash' },
      { t: 'cg_hide', transition: 'fade' },
      { t: 'hide', who: 'a', transition: 'fade' },
      { t: 'archive', item: 'arc_x', toast: true },
      { t: 'archive', item: 'arc_y', toast: false },
      { t: 'checkpoint', reason: 'block' },
    ];
    await director.present({ events, pending: LINE });
    expect(t).toEqual([
      'caption:clear',
      'stage:changeScene:s_new:fade',
      'audio:music:m_new',
      'caption:date_stamp:k.cap',
      'stage:show:a:new:dissolve',
      'stage:speaker:a',
      'stage:bg:bg_z:noir:fade',
      'stage:cg:cg_a:flash',
      'stage:cgHide:fade',
      'stage:hide:a:fade',
      'checkpoint:block',
    ]);
    expect(checkpoints).toEqual(['block']);
    // профиль узнаёт обо всех; тихие (toast: false — финал, отладка) не ставят метку на кнопке блокнота
    expect(archived).toEqual(['arc_x', 'arc_y (тихо)']);
    expect(director.holdingBlack).toBe(false);
  });

  it('reset() снимает кадр целиком и синхронизирует звук; без кадра только чистит титры', () => {
    const { t, director } = setup();
    director.reset(defaultViewFor(episode, 's_new'));
    director.reset(null);
    expect(t).toEqual(['caption:clear', 'stage:setView:s_new', 'audio:sync:m_new:-', 'caption:clear']);
  });

  it('если партию отменили, оставшиеся события не применяются', async () => {
    const { t, director } = setup();
    let cancelled = false;
    const events: EngineEvent[] = [
      { t: 'show', sprite: { who: 'a', expression: null, pose: null, position: 'left', silhouette: false }, existing: false, transition: 'cut' },
      { t: 'show', sprite: { who: 'b', expression: null, pose: null, position: 'right', silhouette: false }, existing: false, transition: 'cut' },
    ];
    await director.present({ events, pending: LINE }, {
      cancelled: () => {
        const was = cancelled;
        cancelled = true; // отмена наступает после первого события
        return was;
      },
    });
    expect(t).toEqual(['stage:show:a:new:cut']);
  });
});

describe('Director: реклама на границе блока', () => {
  const adBatch = (transition: TransitionKind): PumpResult => ({
    events: [
      sceneEv('s_new', transition),
      { t: 'audio', kind: 'music', id: 'm_new', fade_ms: 800, loop: true, volume: 1 },
      { t: 'checkpoint', reason: 'block' },
    ],
    pending: AD,
  });

  for (const transition of ['fade', 'slow_fade'] as const) {
    it(`${transition}: старая сцена гаснет в чёрный и держится; новая не показывается до release()`, async () => {
      const { t, director } = setup();
      await director.present(adBatch(transition));
      // Чёрный кадр удерживается, новая сцена на экране не появлялась, музыка отложена.
      expect(t).toEqual(['caption:clear', `stage:fadeToBlackAndHold:${transition}`, 'checkpoint:block']);
      expect(director.holdingBlack).toBe(true);

      t.push('ad:shown'); // здесь UI показывает рекламу, затем interp.continue()
      await director.release();
      expect(t).toEqual([
        'caption:clear',
        `stage:fadeToBlackAndHold:${transition}`,
        'checkpoint:block',
        'ad:shown',
        `stage:revealFromBlack:s_new:${transition}`,
        'audio:music:m_new',
      ]);
      expect(director.holdingBlack).toBe(false);
      expect(t.some((e) => e.startsWith('stage:changeScene'))).toBe(false);
    });
  }

  it('отбивка дня (титр day): новая сцена держится под чёрным, пока висит дата, и проявляется после release()', async () => {
    const { t, director } = setup();
    const day: Pending = { kind: 'hold', reason: 'caption', ms: 2600, caption: { key: 'k.day', style: 'day' } };
    await director.present({ ...adBatch('fade'), pending: day });
    expect(t).toEqual(['caption:clear', 'stage:fadeToBlackAndHold:fade', 'checkpoint:block']);
    expect(director.holdingBlack).toBe(true);
    t.push('day:shown'); // здесь UI показывает дату на чёрном, затем interp.continue()
    await director.release();
    expect(t.slice(-3)).toEqual(['day:shown', 'stage:revealFromBlack:s_new:fade', 'audio:music:m_new']);
    // обычный титр-пауза (chapter) сцену не задерживает
    const other = setup();
    await other.director.present({ ...adBatch('fade'), pending: { ...day, caption: { key: 'k.ch', style: 'chapter' } } });
    expect(other.director.holdingBlack).toBe(false);
    expect(other.t).toContain('stage:changeScene:s_new:fade');
  });

  it('любой другой переход (vhs_glitch, dissolve, cut, flash, wipe) тоже гасится в чёрный: сцена не попадает на экран до рекламы', async () => {
    for (const tr of ['vhs_glitch', 'dissolve', 'cut', 'flash', 'wipe'] as const) {
      const { t, director } = setup();
      await director.present(adBatch(tr));
      expect(t).toContain(`stage:fadeToBlackAndHold:${tr}`);
      expect(t.some((e) => e.startsWith('stage:changeScene'))).toBe(false);
      expect(director.holdingBlack).toBe(true);
    }
  });

  it('промежуточные кадры цепочки переходов не показываются, звук и архив до рекламы применяются', async () => {
    const { t, director } = setup();
    await director.present({
      events: [
        { t: 'archive', item: 'arc_x', toast: true },
        sceneEv('s_mid', 'fade', false),
        { t: 'show', sprite: { who: 'a', expression: null, pose: null, position: 'left', silhouette: false }, existing: false, transition: 'dissolve' },
        { t: 'audio', kind: 'sfx', id: 'sfx_a', fade_ms: 0, loop: false, volume: 1 },
        sceneEv('s_new', 'fade'),
      ],
      pending: AD,
    });
    expect(t).toEqual(['audio:sfx:sfx_a', 'caption:clear', 'stage:fadeToBlackAndHold:fade']);
  });

  it('автосейв при удержании выполняется сразу (сейв уже указывает на новую сцену), а не после рекламы', async () => {
    const { t, director } = setup();
    await director.present(adBatch('fade'));
    expect(t.indexOf('checkpoint:block')).toBeGreaterThan(t.indexOf('stage:fadeToBlackAndHold:fade'));
    expect(t).not.toContain('stage:revealFromBlack:s_new:fade');
  });

  it('если ad_break пришёл без события scene, ничего не гасится', async () => {
    const { t, director } = setup();
    await director.present({ events: [], pending: AD });
    expect(t).toEqual([]);
    expect(director.holdingBlack).toBe(false);
    await director.release(); // безопасно без удержания
    expect(t).toEqual([]);
  });

  it('reset() во время удержания (загрузка другого сейва) снимает удержание', async () => {
    const { t, director } = setup();
    await director.present(adBatch('fade'));
    director.reset(defaultViewFor(episode, 's_old'));
    expect(director.holdingBlack).toBe(false);
    await director.release();
    expect(t.filter((e) => e.startsWith('stage:reveal'))).toEqual([]);
  });

  it('отмена во время гашения не оставляет удержание', async () => {
    const { t, director } = setup();
    let checks = 0;
    // Первая проверка (перед событием) проходит, вторая (после гашения) — уже отмена.
    await director.present(adBatch('fade'), { cancelled: () => checks++ > 0 });
    expect(t).toContain('stage:fadeToBlackAndHold:fade');
    expect(director.holdingBlack).toBe(false);
  });
});

describe('Director: кадры покрытия', () => {
  it('событие shot идёт в сцену как склейка; перед рекламой промежуточные кадры не показываются', async () => {
    const { t, director } = setup();
    await director.present({ events: [{ t: 'shot', shot: 'sh_1', transition: 'cut' }, { t: 'shot', shot: null, transition: 'cut' }], pending: LINE });
    expect(t).toEqual(['stage:shot:sh_1:cut', 'stage:shot:-:cut']);
    const t2 = setup();
    await t2.director.present({ events: [{ t: 'shot', shot: 'sh_1', transition: 'cut' }, sceneEv('s_new', 'fade')], pending: AD });
    expect(t2.t.some((x) => x.startsWith('stage:shot'))).toBe(false);
  });
});
