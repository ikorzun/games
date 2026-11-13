/**
 * web-plain: запуск вне Playgama (dev, превью, собственный хостинг). Сейвы — localStorage
 * (на Playgama localStorage не используется вообще), язык — из браузера, рекламы нет.
 * Если localStorage недоступен, прогресс живёт в памяти до закрытия вкладки.
 */
import { parseSupportedLang } from '../core/i18n';
import type { Lang } from '../core/types';
import type { DeviceType, IPlatform, PlatformCapabilities, TrackData } from './types';

export const STORAGE_PREFIX = 'vylazka:';

export interface WebPlainOptions {
  /** Подмена хранилища (тесты). null — принудительно «в памяти». */
  storage?: Storage | null;
  /** Подмена списка языков браузера (тесты). */
  languages?: readonly string[];
  /** В dev-сборке награда за рекламу имитируется, чтобы проверить сценарий «продолжить после поимки». */
  simulateRewarded?: boolean;
  /** Подмена определения тача (тесты). */
  coarsePointer?: boolean;
}

function safeLocalStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = `${STORAGE_PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Основной указатель — палец (телефон, планшет). Ноутбук с сенсорным экраном сюда не попадает. */
export function detectCoarsePointer(): boolean {
  try {
    if (typeof matchMedia !== 'function') return false;
    if (matchMedia('(pointer: coarse)').matches) return true;
    return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

export class WebPlainPlatform implements IPlatform {
  readonly id = 'web-plain' as const;
  readonly capabilities: PlatformCapabilities;

  private readonly storage: Storage | null;
  private readonly memory = new Map<string, string>();
  private readonly languages: readonly string[];
  private readonly simulateRewarded: boolean;
  private readonly coarse: boolean;

  constructor(options: WebPlainOptions = {}) {
    this.storage = options.storage !== undefined ? options.storage : safeLocalStorage();
    this.languages = options.languages ?? (typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []);
    this.simulateRewarded = options.simulateRewarded ?? import.meta.env.DEV;
    this.coarse = options.coarsePointer ?? detectCoarsePointer();
    this.capabilities = { interstitial: false, rewarded: this.simulateRewarded };
  }

  language(): Lang {
    for (const raw of this.languages) {
      const lang = parseSupportedLang(raw);
      if (lang) return lang;
    }
    return 'en';
  }

  deviceType(): DeviceType {
    return this.coarse ? 'mobile' : 'desktop';
  }

  async save(keys: string[], values: unknown[]): Promise<void> {
    keys.forEach((key, i) => {
      const text = JSON.stringify(values[i] ?? null);
      this.memory.set(key, text);
      if (!this.storage) return;
      try {
        this.storage.setItem(STORAGE_PREFIX + key, text);
      } catch (e) {
        console.warn(`[web-plain] не удалось записать «${key}» в localStorage (прогресс остаётся в памяти):`, e);
      }
    });
  }

  async load(keys: string[]): Promise<unknown[]> {
    return keys.map((key) => {
      let text: string | null | undefined;
      try {
        text = this.storage ? this.storage.getItem(STORAGE_PREFIX + key) : undefined;
      } catch {
        text = undefined;
      }
      text ??= this.memory.get(key) ?? null;
      if (text === null) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    });
  }

  async showInterstitial(): Promise<boolean> {
    return false;
  }

  async showRewarded(): Promise<boolean> {
    if (!this.simulateRewarded) return false;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }

  onPause(cb: (paused: boolean) => void): () => void {
    if (typeof document === 'undefined') return () => undefined;
    const handler = (): void => cb(document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }

  onAudio(cb: (enabled: boolean) => void): () => void {
    cb(true);
    return () => undefined;
  }

  ready(): void {
    if (import.meta.env.DEV) console.debug('[web-plain] ready (на Playgama здесь уходит game_ready)');
  }

  track(event: string, data?: TrackData): void {
    if (import.meta.env.DEV) console.debug('[web-plain] track', event, data ?? '');
  }
}
