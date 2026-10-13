/**
 * Director + предзагрузка блоков (IBlockLoader): вход в новый блок ждёт картинки до показа сцены, внутри блока —
 * нет; на границе с рекламой картинки грузятся на время гашения и рекламы, сцена проявляется только после них;
 * загрузка сейва греет блок; сбой загрузчика показ не ломает.
 */
import { describe, expect, it } from 'vitest';
import { defaultViewFor } from '../src/core/interpreter';
import type { EngineEvent, Pending, TransitionKind } from '../src/core/types';
import { Director } from '../src/stage/director';
import type { IBlockLoader } from '../src/stage/director';
import { FakeAudio, FakeCaptions, FakeStage } from './helpers/fakes';
import type { Timeline } from './helpers/fakes';
import { miniEpisode } from './helpers/mini';

const episode = miniEpisode(
  {
    s_old: { block: 'b_old', steps: [{ do: 'end', ending: 'e_main' }] },
    s_new: { block: 'b_new', stage: { bg: 'bg_new' }, steps: [{ do: 'end', ending: 'e_main' }] },
    s_same: { block: 'b_new', steps: [{ do: 'end', ending: 'e_main' }] },
  },
  { blocks: [{ id: 'b_old', entry_scene: 's_old' }, { id: 'b_new', entry_scene: 's_new' }] },
);

const scene = (id: string, transition: TransitionKind, newBlock: boolean): EngineEvent => ({
  t: 'scene',
  view: defaultViewFor(episode, id),
  transition,
  newBlock,
  first: false,
});
const LINE: Pending = { kind: 'line', style: 'narrate', who: null, key: 'k', expression: null, narrate_style: 'voiceover', voice: null, scene: 's_new', index: 0 };
const AD: Pending = { kind: 'ad_break', block: 'b_new' };

function setup(loader: IBlockLoader | undefined, t: Timeline = []) {
  const director = new Director({
    stage: new FakeStage(t),
    audio: new FakeAudio(t),
    captions: new FakeCaptions(t),
    ...(loader ? { loader } : {}),
    checkpoint: (r) => void t.push(`checkpoint:${r}`),
  });
  return { t, director };
}

/** Загрузчик с ручным управлением. */
function manual(t: Timeline) {
  const resolvers: Array<() => void> = [];
  const loader: IBlockLoader = {
    enterBlock: (id) => {
      t.push(`loader:enter:${id}`);
      return new Promise<void>((r) => void resolvers.push(r));
    },
  };
  return { loader, finish: () => resolvers.splice(0).forEach((r) => r()) };
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('Director: предзагрузка блока перед показом сцены', () => {
  it('новый блок: сначала загрузчик, потом changeScene; сцена не показывается, пока картинки не готовы', async () => {
    const t: Timeline = [];
    const m = manual(t);
    const { director } = (() => {
      const d = new Director({ stage: new FakeStage(t), audio: new FakeAudio(t), captions: new FakeCaptions(t), loader: m.loader, checkpoint: () => undefined });
      return { director: d };
    })();
    const p = director.present({ events: [scene('s_new', 'fade', true)], pending: LINE });
    await tick();
    expect(t).toEqual(['caption:clear', 'loader:enter:b_new']); // changeScene ещё не вызван
    m.finish();
    await p;
    expect(t).toEqual(['caption:clear', 'loader:enter:b_new', 'stage:changeScene:s_new:fade']);
  });

  it('сцена внутри того же блока загрузчика не зовёт', async () => {
    const t: Timeline = [];
    const { director } = setup({ enterBlock: (id) => (t.push(`loader:${id}`), Promise.resolve()) }, t);
    await director.present({ events: [scene('s_same', 'dissolve', false)], pending: LINE });
    expect(t.some((x) => x.startsWith('loader'))).toBe(false);
  });

  it('без загрузчика поведение прежнее', async () => {
    const { t, director } = setup(undefined);
    await director.present({ events: [scene('s_new', 'fade', true)], pending: LINE });
    expect(t).toEqual(['caption:clear', 'stage:changeScene:s_new:fade']);
  });

  it('сбой загрузчика не ломает показ: сцена всё равно выставляется', async () => {
    const { t, director } = setup({ enterBlock: () => Promise.reject(new Error('сеть')) });
    await director.present({ events: [scene('s_new', 'cut', true)], pending: LINE });
    expect(t).toContain('stage:changeScene:s_new:cut');
  });
});

describe('Director: реклама на границе блока и загрузка картинок', () => {
  it('картинки нового блока грузятся пока экран гаснет и идёт реклама; проявление — только после них', async () => {
    const t: Timeline = [];
    const m = manual(t);
    const director = new Director({ stage: new FakeStage(t), audio: new FakeAudio(t), captions: new FakeCaptions(t), loader: m.loader, checkpoint: (r) => void t.push(`checkpoint:${r}`) });
    await director.present({ events: [scene('s_new', 'fade', true), { t: 'checkpoint', reason: 'block' }], pending: AD });
    // загрузка началась сразу (параллельно с гашением), чёрный кадр держится, сцена не показана
    expect(t).toEqual(['caption:clear', 'loader:enter:b_new', 'stage:fadeToBlackAndHold:fade', 'checkpoint:block']);
    const rel = director.release();
    await tick();
    expect(t.some((x) => x.startsWith('stage:revealFromBlack'))).toBe(false); // ждём картинки
    m.finish();
    await rel;
    expect(t.at(-1)).toBe('stage:revealFromBlack:s_new:fade');
  });

  it('если картинки готовы за время рекламы, проявление без задержки', async () => {
    const t: Timeline = [];
    const { director } = setup({ enterBlock: (id) => (t.push(`loader:${id}`), Promise.resolve()) }, t);
    await director.present({ events: [scene('s_new', 'slow_fade', true)], pending: AD });
    await director.release();
    expect(t).toContain('stage:revealFromBlack:s_new:slow_fade');
  });
});

describe('Director: загрузка сейва и откат', () => {
  it('reset(view) греет картинки блока кадра и сразу выставляет кадр (без ожидания)', async () => {
    const t: Timeline = [];
    const m = manual(t);
    const director = new Director({ stage: new FakeStage(t), audio: new FakeAudio(t), captions: new FakeCaptions(t), loader: m.loader, checkpoint: () => undefined });
    director.reset(defaultViewFor(episode, 's_new'));
    expect(t).toEqual(['caption:clear', 'loader:enter:b_new', 'stage:setView:s_new', 'audio:sync:-:-']);
    m.finish();
    director.reset(null); // без кадра загрузчик не зовём
    expect(t.filter((x) => x.startsWith('loader'))).toHaveLength(1);
  });
});
