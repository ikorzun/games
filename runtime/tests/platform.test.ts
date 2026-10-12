/** Платформенные адаптеры: web-plain (localStorage) и playgama (обёртка над window.bridge). */
import { describe, expect, it, vi } from 'vitest';
import { createPlatform, PlaygamaPlatform, WebPlainPlatform } from '../src/platform';
import type { BridgeLike } from '../src/platform';

class MemStorage implements Storage {
  private readonly m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

describe('web-plain', () => {
  it('сохраняет и читает пачку ключей через localStorage; отсутствующий ключ — null', async () => {
    const storage = new MemStorage();
    const p = new WebPlainPlatform({ storage, languages: ['en'] });
    await p.save(['profile', 'progress'], [{ a: 1 }, { b: [1, 2, 3] }]);
    expect(await p.load(['progress', 'nope', 'profile'])).toEqual([{ b: [1, 2, 3] }, null, { a: 1 }]);
    // ключи с префиксом проекта, значения — JSON
    expect(storage.getItem('krimrussia:profile')).toBe('{"a":1}');
    // новая «сессия» на том же хранилище видит данные
    expect(await new WebPlainPlatform({ storage }).load(['profile'])).toEqual([{ a: 1 }]);
  });

  it('битый JSON в хранилище не роняет загрузку', async () => {
    const storage = new MemStorage();
    storage.setItem('krimrussia:settings', '{oops');
    expect(await new WebPlainPlatform({ storage }).load(['settings'])).toEqual([null]);
  });

  it('без localStorage прогресс живёт в памяти', async () => {
    const p = new WebPlainPlatform({ storage: null });
    await p.save(['k'], [{ x: 1 }]);
    expect(await p.load(['k'])).toEqual([{ x: 1 }]);
  });

  it('переполнение квоты не бросает исключение и не теряет данные текущей сессии', async () => {
    const storage = new MemStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = new WebPlainPlatform({ storage });
    await p.save(['k'], [1]);
    expect(await p.load(['k'])).toEqual([1]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('язык: первый поддерживаемый из списка браузера, иначе en', () => {
    expect(new WebPlainPlatform({ storage: null, languages: ['de-DE', 'pt-BR', 'ru'] }).language()).toBe('pt');
    expect(new WebPlainPlatform({ storage: null, languages: ['ru-RU'] }).language()).toBe('ru');
    expect(new WebPlainPlatform({ storage: null, languages: ['zh', 'ja'] }).language()).toBe('en');
    expect(new WebPlainPlatform({ storage: null, languages: [] }).language()).toBe('en');
  });

  it('рекламы нет; награда — только если включена имитация; слоты есть', async () => {
    const off = new WebPlainPlatform({ storage: null, simulateRewarded: false });
    expect(await off.showInterstitial()).toBe(false);
    expect(await off.showRewarded()).toBe(false);
    expect(off.capabilities).toEqual({ manualSlots: 6, interstitial: false, rewarded: false });
    const on = new WebPlainPlatform({ storage: null, simulateRewarded: true });
    vi.useFakeTimers();
    const pr = on.showRewarded();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pr).toBe(true);
    vi.useRealTimers();
  });

  it('onAudio сразу сообщает, что звук разрешён', () => {
    const cb = vi.fn();
    new WebPlainPlatform({ storage: null }).onAudio(cb);
    expect(cb).toHaveBeenCalledWith(true);
  });
});

// ───────────────────────────── Playgama ─────────────────────────────

interface FakeBridge extends BridgeLike {
  calls: string[];
  store: Map<string, unknown>;
  emit(scope: 'platform' | 'ad', event: string, value: unknown): void;
  messages: Array<[string, Record<string, string> | undefined]>;
  custom: string[];
  analyticsLog: Array<[string, unknown]>;
  adBehaviour: { onShowInterstitial?: () => void; onShowRewarded?: () => void };
}

function fakeBridge(over: { language?: string; audio?: boolean; rewarded?: boolean; interstitial?: boolean } = {}): FakeBridge {
  const platformL = new Map<string, Set<(v: boolean) => void>>();
  const adL = new Map<string, Set<(v: string) => void>>();
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  const messages: FakeBridge['messages'] = [];
  const custom: string[] = [];
  const analyticsLog: Array<[string, unknown]> = [];
  const adBehaviour: FakeBridge['adBehaviour'] = {};
  const EVENT_NAME = {
    PAUSE_STATE_CHANGED: 'pause_state_changed',
    AUDIO_STATE_CHANGED: 'audio_state_changed',
    INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed',
    REWARDED_STATE_CHANGED: 'rewarded_state_changed',
  };
  return {
    calls,
    store,
    messages,
    custom,
    analyticsLog,
    adBehaviour,
    initialize: async () => {
      calls.push('initialize');
    },
    EVENT_NAME,
    platform: {
      language: over.language ?? 'ru',
      isAudioEnabled: over.audio ?? true,
      sendMessage: (m, d) => {
        messages.push([m, d]);
      },
      sendCustomMessage: (id) => {
        custom.push(id);
      },
      on: (e, cb) => {
        if (!platformL.has(e)) platformL.set(e, new Set());
        platformL.get(e)?.add(cb);
      },
      off: (e, cb) => {
        platformL.get(e)?.delete(cb);
      },
    },
    storage: {
      get: async (keys) => {
        calls.push(`storage.get(${keys.join(',')})`);
        return keys.map((k) => (store.has(k) ? store.get(k) : null));
      },
      set: async (keys, values) => {
        calls.push(`storage.set(${keys.join(',')})`);
        keys.forEach((k, i) => store.set(k, values[i]));
      },
    },
    advertisement: {
      isInterstitialSupported: over.interstitial ?? true,
      isRewardedSupported: over.rewarded ?? true,
      showInterstitial: () => {
        calls.push('showInterstitial');
        adBehaviour.onShowInterstitial?.();
      },
      showRewarded: () => {
        calls.push('showRewarded');
        adBehaviour.onShowRewarded?.();
      },
      on: (e, cb) => {
        if (!adL.has(e)) adL.set(e, new Set());
        adL.get(e)?.add(cb);
      },
      off: (e, cb) => {
        adL.get(e)?.delete(cb);
      },
    },
    analytics: {
      send: (e, d) => {
        analyticsLog.push([e, d]);
      },
    },
    emit: (scope, event, value) => {
      if (scope === 'platform') for (const cb of [...(platformL.get(event) ?? [])]) cb(value as boolean);
      else for (const cb of [...(adL.get(event) ?? [])]) cb(value as string);
    },
  };
}

describe('playgama', () => {
  it('создание ждёт bridge.initialize(); язык берётся из bridge.platform.language', async () => {
    const b = fakeBridge({ language: 'pt' });
    const p = await PlaygamaPlatform.create(b);
    expect(b.calls[0]).toBe('initialize');
    expect(p.language()).toBe('pt');
    expect(p.id).toBe('playgama');
    for (const [raw, want] of [['ru', 'ru'], ['en', 'en'], ['es', 'es'], ['de', 'en'], ['tr', 'en'], ['', 'en']] as const) {
      expect(new PlaygamaPlatform(fakeBridge({ language: raw })).language()).toBe(want);
    }
  });

  it('сейвы: одна пачка ключей в bridge.storage.set/get, значения — JSON-строки; null для пустых ключей', async () => {
    const b = fakeBridge();
    const p = new PlaygamaPlatform(b);
    await p.save(['profile', 'progress', 'settings', 'archive'], [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]);
    expect(b.calls).toEqual(['storage.set(profile,progress,settings,archive)']);
    expect(b.store.get('progress')).toBe('{"b":2}');
    b.calls.length = 0;
    const loaded = await p.load(['progress', 'ghost', 'archive']);
    expect(b.calls).toEqual(['storage.get(progress,ghost,archive)']);
    expect(loaded).toEqual([{ b: 2 }, null, { d: 4 }]);
    b.store.set('broken', '{x');
    expect(await p.load(['broken'])).toEqual([null]);
  });

  it('game_ready отправляется один раз', () => {
    const b = fakeBridge();
    const p = new PlaygamaPlatform(b);
    p.ready();
    p.ready();
    expect(b.messages).toEqual([['game_ready', undefined]]);
  });

  it('onAudio: начальное состояние читается вручную, затем события AUDIO_STATE_CHANGED', () => {
    const b = fakeBridge({ audio: false });
    const p = new PlaygamaPlatform(b);
    const seen: boolean[] = [];
    const off = p.onAudio((v) => seen.push(v));
    expect(seen).toEqual([false]);
    b.emit('platform', 'audio_state_changed', true);
    off();
    b.emit('platform', 'audio_state_changed', false);
    expect(seen).toEqual([false, true]);
  });

  it('onPause подписывается на PAUSE_STATE_CHANGED и отписывается', () => {
    const b = fakeBridge();
    const p = new PlaygamaPlatform(b);
    const seen: boolean[] = [];
    const off = p.onPause((v) => seen.push(v));
    b.emit('platform', 'pause_state_changed', true);
    b.emit('platform', 'pause_state_changed', false);
    off();
    b.emit('platform', 'pause_state_changed', true);
    expect(seen).toEqual([true, false]);
  });

  describe('interstitial', () => {
    it('true, если реклама открылась и закрылась', async () => {
      const b = fakeBridge();
      b.adBehaviour.onShowInterstitial = () => {
        queueMicrotask(() => {
          b.emit('ad', 'interstitial_state_changed', 'loading');
          b.emit('ad', 'interstitial_state_changed', 'opened');
          b.emit('ad', 'interstitial_state_changed', 'closed');
        });
      };
      expect(await new PlaygamaPlatform(b).showInterstitial('block_break')).toBe(true);
      expect(b.calls).toContain('showInterstitial');
    });

    it('false при failed и когда реклама так и не началась (лимит частоты)', async () => {
      const failed = fakeBridge();
      failed.adBehaviour.onShowInterstitial = () => queueMicrotask(() => failed.emit('ad', 'interstitial_state_changed', 'failed'));
      expect(await new PlaygamaPlatform(failed).showInterstitial()).toBe(false);

      vi.useFakeTimers();
      const silent = fakeBridge();
      const pr = new PlaygamaPlatform(silent).showInterstitial();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pr).toBe(false);
      vi.useRealTimers();
    });

    it('closed без opened — не показана; платформа без interstitial — false сразу', async () => {
      const b = fakeBridge();
      b.adBehaviour.onShowInterstitial = () => queueMicrotask(() => b.emit('ad', 'interstitial_state_changed', 'closed'));
      expect(await new PlaygamaPlatform(b).showInterstitial()).toBe(false);
      const none = fakeBridge({ interstitial: false });
      expect(await new PlaygamaPlatform(none).showInterstitial()).toBe(false);
      expect(none.calls).not.toContain('showInterstitial');
    });
  });

  describe('rewarded', () => {
    it('награда только в состоянии rewarded', async () => {
      const ok = fakeBridge();
      ok.adBehaviour.onShowRewarded = () => {
        queueMicrotask(() => {
          for (const s of ['loading', 'opened', 'rewarded', 'closed']) ok.emit('ad', 'rewarded_state_changed', s);
        });
      };
      expect(await new PlaygamaPlatform(ok).showRewarded()).toBe(true);

      const skipped = fakeBridge();
      skipped.adBehaviour.onShowRewarded = () => {
        queueMicrotask(() => {
          for (const s of ['loading', 'opened', 'closed']) skipped.emit('ad', 'rewarded_state_changed', s);
        });
      };
      expect(await new PlaygamaPlatform(skipped).showRewarded()).toBe(false);

      const none = fakeBridge({ rewarded: false });
      expect(await new PlaygamaPlatform(none).showRewarded()).toBe(false);
      expect(new PlaygamaPlatform(none).capabilities.rewarded).toBe(false);
    });
  });

  it('track: lifecycle → sendMessage, кастомные → sendCustomMessage + analytics, прочее → analytics.send', () => {
    const b = fakeBridge();
    const p = new PlaygamaPlatform(b);
    p.track('level_started', { world: 's1', level: 'ep01' });
    p.track('level_completed', { world: 's1', level: 'ep01' });
    p.track('archive_opened');
    p.track('ending_reached', { ending: 'e_canon', kind: 'canonical' });
    p.track('minigame_finish', { id: 'mg_docs', result: 'success' });
    expect(b.messages).toEqual([
      ['level_started', { world: 's1', level: 'ep01' }],
      ['level_completed', { world: 's1', level: 'ep01' }],
    ]);
    expect(b.custom).toEqual(['archive_opened', 'ending_reached']);
    expect(b.analyticsLog).toEqual([
      ['ending_reached', { ending: 'e_canon', kind: 'canonical' }],
      ['minigame_finish', { id: 'mg_docs', result: 'success' }],
    ]);
  });

  it('ошибки Bridge не роняют игру', () => {
    const b = fakeBridge();
    b.platform.sendMessage = () => {
      throw new Error('boom');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = new PlaygamaPlatform(b);
    expect(() => p.ready()).not.toThrow();
    expect(() => p.track('level_started')).not.toThrow();
    warn.mockRestore();
  });

  it('слотов ручного сохранения нет: автосейв и быстрый сейв', () => {
    expect(new PlaygamaPlatform(fakeBridge()).capabilities.manualSlots).toBe(0);
  });
});

describe('createPlatform: выбор по наличию window.bridge', () => {
  it('есть bridge → playgama (после initialize)', async () => {
    const b = fakeBridge({ language: 'es' });
    const p = await createPlatform({ bridge: b });
    expect(p.id).toBe('playgama');
    expect(p.language()).toBe('es');
    expect(b.calls[0]).toBe('initialize');
  });

  it('нет bridge → web-plain', async () => {
    const p = await createPlatform({});
    expect(p.id).toBe('web-plain');
  });

  it('bridge не инициализировался → web-plain с предупреждением', async () => {
    const b = fakeBridge();
    b.initialize = async () => {
      throw new Error('init failed');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = await createPlatform({ bridge: b });
    expect(p.id).toBe('web-plain');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
