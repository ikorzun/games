/**
 * Платформенный слой: тонкие адаптеры «откуда язык, куда сохранять, когда показывать рекламу».
 * Реализации: playgama (Bridge SDK) и web-plain (localStorage, только вне Playgama).
 * Скопировано из runtime/src/platform с адаптацией; игры по сборке друг от друга не зависят.
 */
import type { Lang } from '../core/types';

export type TrackData = Record<string, string | number | boolean>;

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'tv';

export interface PlatformCapabilities {
  interstitial: boolean;
  rewarded: boolean;
}

export interface IPlatform {
  readonly id: 'web-plain' | 'playgama';
  readonly capabilities: PlatformCapabilities;

  /** Язык интерфейса; всё неподдержанное → en. */
  language(): Lang;
  /** Тип устройства: по нему выбирается схема управления (тач или клавиатура с мышью). */
  deviceType(): DeviceType;
  /** Пакетная запись по массиву ключей. Значения — любой JSON. Вызывать только по событиям, не по таймеру. */
  save(keys: string[], values: unknown[]): Promise<void>;
  /** Пакетное чтение; для отсутствующего ключа — null. */
  load(keys: string[]): Promise<unknown[]>;
  /** true — реклама была показана и закрыта. Только между вылазками. */
  showInterstitial(placement?: string): Promise<boolean>;
  /** true — игрок досмотрел и получил награду. */
  showRewarded(placement?: string): Promise<boolean>;
  /** Пауза платформы (реклама, вкладка в фоне). Возвращает функцию отписки. */
  onPause(cb: (paused: boolean) => void): () => void;
  /** Разрешён ли звук платформой; колбэк вызывается сразу с текущим значением. */
  onAudio(cb: (enabled: boolean) => void): () => void;
  /** Первый играбельный кадр показан (Playgama: game_ready). Вызывать один раз. */
  ready(): void;
  /** Аналитика и lifecycle: level_started, level_completed, level_failed, … */
  track(event: string, data?: TrackData): void;
}
