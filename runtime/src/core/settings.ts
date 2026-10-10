/**
 * Настройки игрока. Хранятся под ключом `settings` (Playgama: bridge.storage, web: localStorage).
 */
import { LANGS } from './types';
import type { Lang } from './types';

export type ViolenceMode = 'full' | 'schematic';

export interface Settings {
  /** Выбранный язык; null — определять автоматически (платформа / браузер). */
  lang: Lang | null;
  /** Множитель размера шрифта текста (1 = базовый, 16 px мобильный / 20 px десктоп). */
  fontScale: number;
  /** Скорость текста: 1..5, 5 — мгновенно. */
  textSpeed: number;
  /** Пауза авто-режима после показа реплики, мс. */
  autoDelayMs: number;
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
  /** Таймеры на выборах (timer_ms). Выключенные — выбор ждёт игрока. */
  timers: boolean;
  /** Режим «только история»: без таймеров, пропуск мини-игры доступен сразу. */
  storyOnly: boolean;
  violenceMode: ViolenceMode;
  /** Пропускать (Skip) и непрочитанный текст. */
  skipUnread: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  lang: null,
  fontScale: 1,
  textSpeed: 3,
  autoDelayMs: 1800,
  music: 0.7,
  sfx: 0.8,
  voice: 1,
  muted: false,
  timers: true,
  storyOnly: false,
  violenceMode: 'full',
  skipUnread: false,
};

export const FONT_SCALE_RANGE = { min: 0.85, max: 1.6, step: 0.05 } as const;
export const AUTO_DELAY_RANGE = { min: 500, max: 5000, step: 250 } as const;

/** Символов в секунду для уровня скорости; Infinity — мгновенный вывод. */
export function charsPerSecond(level: number): number {
  const table = [0, 18, 32, 55, 95, Infinity];
  return table[Math.min(5, Math.max(1, Math.round(level)))] ?? 55;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Привести сохранённое значение к валидным настройкам (неизвестное и неверное — к умолчанию). */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const lang = typeof r.lang === 'string' && (LANGS as readonly string[]).includes(r.lang) ? (r.lang as Lang) : null;
  return {
    lang,
    fontScale: num(r.fontScale, FONT_SCALE_RANGE.min, FONT_SCALE_RANGE.max, d.fontScale),
    textSpeed: Math.round(num(r.textSpeed, 1, 5, d.textSpeed)),
    autoDelayMs: num(r.autoDelayMs, AUTO_DELAY_RANGE.min, AUTO_DELAY_RANGE.max, d.autoDelayMs),
    music: num(r.music, 0, 1, d.music),
    sfx: num(r.sfx, 0, 1, d.sfx),
    voice: num(r.voice, 0, 1, d.voice),
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    timers: typeof r.timers === 'boolean' ? r.timers : d.timers,
    storyOnly: typeof r.storyOnly === 'boolean' ? r.storyOnly : d.storyOnly,
    violenceMode: r.violenceMode === 'schematic' ? 'schematic' : 'full',
    skipUnread: typeof r.skipUnread === 'boolean' ? r.skipUnread : d.skipUnread,
  };
}
