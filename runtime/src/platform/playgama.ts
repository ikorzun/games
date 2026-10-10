/**
 * Playgama: обёртка над глобальным объектом `bridge` (Playgama Bridge SDK, JS Core ≥ 2.3).
 * Контракты — docs/platform/playgama-constraints.md и wiki Bridge:
 *   - язык: bridge.platform.language (ISO 639-1) → ru|en|es|pt, иначе en;
 *   - сейвы только через bridge.storage.get/set с массивом ключей (localStorage не трогаем);
 *   - game_ready через bridge.platform.sendMessage — один раз, после первого играбельного кадра;
 *   - PAUSE_STATE_CHANGED / AUDIO_STATE_CHANGED — единый обработчик паузы и звука; начальное
 *     состояние звука читаем вручную (событие приходит только при изменениях);
 *   - interstitial — только на границах блоков (вызывает интерпретатор), rewarded — по желанию
 *     игрока, награда выдаётся ТОЛЬКО в состоянии `rewarded`;
 *   - аналитика только через bridge.analytics.send и lifecycle-сообщения платформы.
 * Bridge подключается снаружи (скрипт или @playgama/bridge) — рантайм лишь проверяет window.bridge.
 */
import { normalizeLang } from '../core/i18n';
import type { Lang } from '../core/types';
import type { IPlatform, PlatformCapabilities, TrackData } from './types';

type Listener<T> = (value: T) => void;

/** Минимальная часть Bridge, которую мы используем (структурная типизация, без зависимости от пакета). */
export interface BridgeLike {
  initialize?(): Promise<unknown>;
  EVENT_NAME: {
    PAUSE_STATE_CHANGED: string;
    AUDIO_STATE_CHANGED: string;
    INTERSTITIAL_STATE_CHANGED: string;
    REWARDED_STATE_CHANGED: string;
  };
  platform: {
    language: string;
    isAudioEnabled?: boolean;
    sendMessage(message: string, data?: Record<string, string>): void;
    sendCustomMessage?(id: string): void;
    on(event: string, cb: Listener<boolean>): void;
    off?(event: string, cb: Listener<boolean>): void;
  };
  storage: {
    get(keys: string[]): Promise<unknown[]>;
    set(keys: string[], values: unknown[]): Promise<unknown>;
  };
  advertisement: {
    isInterstitialSupported?: boolean;
    isRewardedSupported?: boolean;
    showInterstitial(placement?: string): void;
    showRewarded(placement?: string): void;
    on(event: string, cb: Listener<string>): void;
    off?(event: string, cb: Listener<string>): void;
  };
  analytics?: { send(event: string, data?: TrackData): void };
}

declare global {
  interface Window {
    bridge?: BridgeLike;
  }
}

/** События, которые Bridge понимает как lifecycle-сообщения платформы. */
const PLATFORM_MESSAGES: ReadonlySet<string> = new Set([
  'level_started',
  'level_completed',
  'level_failed',
  'level_paused',
  'level_resumed',
  'in_game_loading_started',
  'in_game_loading_stopped',
  'player_got_achievement',
]);
/** Такие события отправляются как пользовательские сообщения платформы (без данных). */
const CUSTOM_MESSAGES: ReadonlySet<string> = new Set(['archive_opened', 'ending_reached']);

/** Сколько ждать начала показа рекламы, прежде чем считать, что она не покажется (лимит частоты и т. п.). */
const AD_START_TIMEOUT_MS = 4000;
const AD_LOADING_TIMEOUT_MS = 15000;
const AD_SHOWN_TIMEOUT_MS = 180000;

export class PlaygamaPlatform implements IPlatform {
  readonly id = 'playgama' as const;
  readonly capabilities: PlatformCapabilities;
  private readyCalled = false;

  constructor(private readonly bridge: BridgeLike) {
    this.capabilities = {
      manualSlots: 0,
      interstitial: bridge.advertisement.isInterstitialSupported !== false,
      rewarded: bridge.advertisement.isRewardedSupported === true,
    };
  }

  /** Дождаться инициализации Bridge и вернуть адаптер. */
  static async create(bridge: BridgeLike): Promise<PlaygamaPlatform> {
    if (typeof bridge.initialize === 'function') await bridge.initialize();
    return new PlaygamaPlatform(bridge);
  }

  language(): Lang {
    return normalizeLang(this.bridge.platform.language);
  }

  async save(keys: string[], values: unknown[]): Promise<void> {
    // Один вызов на пачку ключей; значения — JSON-строки (одинаково на всех площадках Bridge).
    await this.bridge.storage.set(
      keys,
      values.map((v) => JSON.stringify(v ?? null)),
    );
  }

  async load(keys: string[]): Promise<unknown[]> {
    const raw = await this.bridge.storage.get(keys);
    return keys.map((_, i) => {
      const v = raw[i];
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') return v;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    });
  }

  showInterstitial(placement?: string): Promise<boolean> {
    const ad = this.bridge.advertisement;
    if (ad.isInterstitialSupported === false) return Promise.resolve(false);
    const event = this.bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED;
    return new Promise<boolean>((resolve) => {
      let opened = false;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (shown: boolean): void => {
        if (done) return;
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        ad.off?.(event, onState);
        resolve(shown);
      };
      const arm = (ms: number): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => finish(opened), ms);
      };
      const onState = (state: string): void => {
        if (state === 'loading') arm(AD_LOADING_TIMEOUT_MS);
        else if (state === 'opened') {
          opened = true;
          arm(AD_SHOWN_TIMEOUT_MS);
        } else if (state === 'closed') finish(opened);
        else if (state === 'failed') finish(false);
      };
      ad.on(event, onState);
      arm(AD_START_TIMEOUT_MS);
      try {
        if (placement === undefined) ad.showInterstitial();
        else ad.showInterstitial(placement);
      } catch (e) {
        console.warn('[playgama] showInterstitial:', e);
        finish(false);
      }
    });
  }

  showRewarded(placement?: string): Promise<boolean> {
    const ad = this.bridge.advertisement;
    if (ad.isRewardedSupported !== true) return Promise.resolve(false);
    const event = this.bridge.EVENT_NAME.REWARDED_STATE_CHANGED;
    return new Promise<boolean>((resolve) => {
      let rewarded = false;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        ad.off?.(event, onState);
        resolve(ok);
      };
      const arm = (ms: number): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => finish(rewarded), ms);
      };
      // Награда — только в состоянии `rewarded`; `closed` без него — игрок закрыл рекламу раньше.
      const onState = (state: string): void => {
        if (state === 'loading') arm(AD_LOADING_TIMEOUT_MS);
        else if (state === 'opened') arm(AD_SHOWN_TIMEOUT_MS);
        else if (state === 'rewarded') rewarded = true;
        else if (state === 'closed') finish(rewarded);
        else if (state === 'failed') finish(false);
      };
      ad.on(event, onState);
      arm(AD_START_TIMEOUT_MS);
      try {
        if (placement === undefined) ad.showRewarded();
        else ad.showRewarded(placement);
      } catch (e) {
        console.warn('[playgama] showRewarded:', e);
        finish(false);
      }
    });
  }

  onPause(cb: (paused: boolean) => void): () => void {
    const { platform, EVENT_NAME } = this.bridge;
    platform.on(EVENT_NAME.PAUSE_STATE_CHANGED, cb);
    return () => platform.off?.(EVENT_NAME.PAUSE_STATE_CHANGED, cb);
  }

  onAudio(cb: (enabled: boolean) => void): () => void {
    const { platform, EVENT_NAME } = this.bridge;
    // Событие приходит только при изменениях, поэтому начальное состояние применяем сами.
    cb(platform.isAudioEnabled !== false);
    platform.on(EVENT_NAME.AUDIO_STATE_CHANGED, cb);
    return () => platform.off?.(EVENT_NAME.AUDIO_STATE_CHANGED, cb);
  }

  ready(): void {
    if (this.readyCalled) return;
    this.readyCalled = true;
    try {
      this.bridge.platform.sendMessage('game_ready');
    } catch (e) {
      console.warn('[playgama] game_ready:', e);
    }
  }

  track(event: string, data?: TrackData): void {
    try {
      if (PLATFORM_MESSAGES.has(event)) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(data ?? {})) flat[k] = String(v);
        this.bridge.platform.sendMessage(event, flat);
      } else if (CUSTOM_MESSAGES.has(event)) {
        this.bridge.platform.sendCustomMessage?.(event);
        // Данные кастомного сообщения Bridge отбрасывает — отправляем полноценное событие аналитики.
        if (data) this.bridge.analytics?.send(event, data);
      } else {
        this.bridge.analytics?.send(event, data);
      }
    } catch (e) {
      console.warn('[playgama] track:', event, e);
    }
  }
}
