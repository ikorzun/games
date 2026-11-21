import { describe, expect, it } from 'vitest';
import { BUILD_VERSION } from '../src/core/build';
import { createPlatform } from '../src/platform';
import { PlaygamaPlatform } from '../src/platform/playgama';
import type { BridgeLike } from '../src/platform/playgama';
import type { TrackData } from '../src/platform/types';

type Cb = (v: never) => void;

/** Поддельный Bridge: столько, сколько трогает адаптер, плюс журнал вызовов. */
function fakeBridge(state: { language?: string; audio?: boolean; paused?: boolean; inter?: string; reward?: string } = {}) {
  const listeners = new Map<string, Set<Cb>>();
  const log = { messages: [] as [string, Record<string, string> | undefined][], analytics: [] as [string, TrackData | undefined][], init: 0, versionAtInit: undefined as string | null | undefined };
  const on = (e: string, cb: Cb): void => void (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(cb);
  const off = (e: string, cb: Cb): void => void listeners.get(e)?.delete(cb);
  const bridge: BridgeLike = {
    gameVersion: null,
    initialize: async () => {
      log.init += 1;
      log.versionAtInit = bridge.gameVersion;
    },
    EVENT_NAME: { PAUSE_STATE_CHANGED: 'pause', AUDIO_STATE_CHANGED: 'audio', INTERSTITIAL_STATE_CHANGED: 'inter', REWARDED_STATE_CHANGED: 'reward' },
    platform: {
      language: state.language ?? 'en',
      isAudioEnabled: state.audio ?? true,
      isPaused: state.paused ?? false,
      sendMessage: (m, d) => void log.messages.push([m, d]),
      sendCustomMessage: () => undefined,
      on,
      off,
    },
    storage: { get: async (keys) => keys.map(() => null), set: async () => undefined },
    advertisement: {
      isInterstitialSupported: true,
      isRewardedSupported: false,
      interstitialState: state.inter ?? 'closed',
      rewardedState: state.reward ?? 'closed',
      showInterstitial: () => undefined,
      showRewarded: () => undefined,
      on,
      off,
    },
    analytics: { send: (e, d) => void log.analytics.push([e, d]) },
    device: { type: 'desktop' },
  };
  const emit = (e: string, v: unknown): void => {
    for (const cb of [...(listeners.get(e) ?? [])]) (cb as (v: unknown) => void)(v);
  };
  return { bridge, log, emit, count: (e: string) => listeners.get(e)?.size ?? 0 };
}

describe('Playgama: адаптер Bridge', () => {
  it('сначала initialize, потом всё остальное; версия сборки уходит в Bridge после инициализации', async () => {
    const f = fakeBridge();
    const p = await createPlatform({ bridge: f.bridge });
    expect(p.id).toBe('playgama');
    expect(f.log.init).toBe(1);
    expect(f.log.versionAtInit).toBeNull();
    expect(f.bridge.gameVersion).toBe(BUILD_VERSION);
  });

  it('язык — только из bridge.platform.language; незнакомый — английский', async () => {
    expect((await PlaygamaPlatform.create(fakeBridge({ language: 'ru' }).bridge)).language()).toBe('ru');
    expect((await PlaygamaPlatform.create(fakeBridge({ language: 'pt' }).bridge)).language()).toBe('en');
    expect((await PlaygamaPlatform.create(fakeBridge({ language: 'en' }).bridge)).language()).toBe('en');
  });

  it('звук и пауза: начальное состояние применяется сразу, дальше — по событиям', async () => {
    const f = fakeBridge({ audio: false, paused: true });
    const p = await PlaygamaPlatform.create(f.bridge);
    const audio: boolean[] = [];
    const pause: boolean[] = [];
    p.onAudio((on) => audio.push(on));
    p.onPause((on) => pause.push(on));
    expect(audio).toEqual([false]);
    expect(pause).toEqual([true]);
    f.emit('audio', true);
    f.emit('pause', false);
    expect(audio).toEqual([false, true]);
    expect(pause).toEqual([true, false]);
  });

  it('реклама, открытая ещё до подписки, сразу ставит на паузу; дальше — по состояниям обеих реклам', async () => {
    const f = fakeBridge({ inter: 'opened' });
    const p = await PlaygamaPlatform.create(f.bridge);
    const open: boolean[] = [];
    const stop = p.onAd((o) => open.push(o));
    expect(open).toEqual([true]);
    f.emit('inter', 'closed');
    f.emit('inter', 'loading');
    f.emit('reward', 'opened');
    f.emit('reward', 'rewarded');
    f.emit('inter', 'failed');
    f.emit('reward', 'closed');
    expect(open).toEqual([true, false, true, false]);
    stop();
    expect(f.count('inter') + f.count('reward')).toBe(0);
    const quiet: boolean[] = [];
    (await PlaygamaPlatform.create(fakeBridge().bridge)).onAd((o) => quiet.push(o));
    expect(quiet).toEqual([]);
  });

  it('lifecycle-сообщения — только world и level строками; события игры — в analytics.send как есть', async () => {
    const f = fakeBridge();
    const p = await PlaygamaPlatform.create(f.bridge);
    p.track('level_started', { world: 'station', level: 3, lap: 2, stage: 1 });
    p.track('level_paused', { world: 'station', level: 3 });
    p.track('progression_started', { step_id: 'station', step_index: 3, lap: 2 });
    expect(f.log.messages).toEqual([
      ['level_started', { world: 'station', level: '3' }],
      ['level_paused', { world: 'station', level: '3' }],
    ]);
    expect(f.log.analytics).toEqual([['progression_started', { step_id: 'station', step_index: 3, lap: 2 }]]);
  });

  it('без window.bridge — web-plain', async () => {
    expect((await createPlatform({})).id).toBe('web-plain');
  });
});
