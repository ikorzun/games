/**
 * Платформенный слой: тонкие адаптеры «откуда язык, куда сохранять, когда показывать рекламу».
 * IPlatform — контракт из docs/architecture/06-engine-and-pipeline.md §5; реализации:
 * playgama (Bridge SDK), web-plain (localStorage, только вне Playgama); desktop — позже.
 */
import type { Lang } from '../core/types';

export type TrackData = Record<string, string | number | boolean>;

export interface PlatformCapabilities {
  /** Нумерованные слоты ручного сохранения: web-plain — 6; Playgama — 0 (автосейв + быстрый сейв). */
  manualSlots: number;
  interstitial: boolean;
  rewarded: boolean;
}

export interface IPlatform {
  readonly id: 'web-plain' | 'playgama';
  readonly capabilities: PlatformCapabilities;

  /** Язык интерфейса: ru | en | es | pt, всё остальное → en. */
  language(): Lang;
  /** Пакетная запись по массиву ключей. Значения — любой JSON. */
  save(keys: string[], values: unknown[]): Promise<void>;
  /** Пакетное чтение; для отсутствующего ключа — null. */
  load(keys: string[]): Promise<unknown[]>;
  /** true — реклама была показана и закрыта. Только на границах блоков, вызывает интерпретатор. */
  showInterstitial(placement?: string): Promise<boolean>;
  /** true — игрок досмотрел и получил награду. */
  showRewarded(placement?: string): Promise<boolean>;
  /** Пауза платформы (реклама, вкладка в фоне). Возвращает функцию отписки. */
  onPause(cb: (paused: boolean) => void): () => void;
  /** Разрешён ли звук платформой; колбэк вызывается сразу с текущим значением. */
  onAudio(cb: (enabled: boolean) => void): () => void;
  /** Первый играбельный кадр показан (Playgama: game_ready). Вызывать один раз. */
  ready(): void;
  /** Аналитика/lifecycle: level_started, level_completed, minigame_finish, … */
  track(event: string, data?: TrackData): void;
}
