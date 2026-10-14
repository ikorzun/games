/**
 * Звук. Менеджер ведёт состояние (что играет, mute игрока, запрет звука платформой) и пишет
 * журнал для отладки; воспроизведение делает IAudioBackend — на странице это HtmlAudioBackend
 * (audio_html.ts: HTMLAudioElement, музыка m4a, эмбиент и эффекты mp3, озвучка реплик mp3). Шаги music / sfx / ambient / stop_*
 * интерпретатор исполняет полностью; без бэкенда (тесты, отладочный режим) менеджер только записывает состояние.
 *
 * Озвучка реплик — отдельный канал: один клип за раз (playVoice сам останавливает прежний), выбор клипа — LineVoice
 * (stage/voice.ts), момент старта и остановки — DomUI. Менеджер решает только «слышно ли»: озвучка включена в настройках,
 * игра не выключена игроком (Mute) и платформой, громкость озвучки не ноль; иначе клип не запускается вовсе.
 */
import type { AudioEventPayload, IAudioSink } from './types';

/** Как закончился клип озвучки: ended — доиграл, failed — не смог играть (нет файла, автозапуск запрещён), stopped — остановлен снаружи. */
export type VoiceEnd = 'ended' | 'failed' | 'stopped';

/** Клип озвучки, который играет или уже закончил. */
export interface VoicePlayback {
  readonly url: string;
  readonly state: 'playing' | VoiceEnd;
  /**
   * Подписаться на конец клипа: cb вызывается один раз с причиной. Если клип уже закончился — сразу.
   * Возвращает отписку.
   */
  onEnd(cb: (how: VoiceEnd) => void): () => void;
  /** Остановить клип (повторный вызов безопасен). */
  stop(): void;
}

/** Состояние одного клипа озвучки; бэкенд создаёт его и завершает через finish(). */
export class VoiceClip implements VoicePlayback {
  state: 'playing' | VoiceEnd = 'playing';
  private readonly subs = new Set<(how: VoiceEnd) => void>();

  constructor(readonly url: string) {}

  onEnd(cb: (how: VoiceEnd) => void): () => void {
    if (this.state !== 'playing') {
      cb(this.state);
      return () => undefined;
    }
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  stop(): void {
    this.finish('stopped');
  }

  /** Завершить клип (идемпотентно); подписчики получают причину по порядку подписки. */
  finish(how: VoiceEnd): void {
    if (this.state !== 'playing') return;
    this.state = how;
    const subs = [...this.subs];
    this.subs.clear();
    for (const cb of subs) cb(how);
  }
}

export interface IAudioBackend {
  play(kind: 'music' | 'ambient' | 'sfx', id: string, opts: { loop: boolean; volume: number; fadeMs: number }): void;
  stop(kind: 'music' | 'ambient', fadeMs: number): void;
  /** Итоговая громкость каналов (0 — тишина, учитывает mute и запрет платформы). */
  setGain(channel: 'music' | 'ambient' | 'sfx' | 'voice', gain: number): void;
  /** Пауза платформы / вкладки в фоне: всё играющее встаёт и потом продолжается. */
  setPaused?(paused: boolean): void;
  /** Начать клип озвучки по адресу (прежний останавливается). null — играть нечем (файл известен как отсутствующий, пауза). */
  playVoice?(url: string): VoicePlayback | null;
  stopVoice?(): void;
  /** Прогреть клипы озвучки в фоне: очередь с ограниченной параллельностью, 'now' обгоняет 'idle'. */
  preloadVoice?(urls: readonly string[], priority: 'now' | 'idle'): void;
}

export interface AudioVolumes {
  music: number;
  sfx: number;
  /** Громкость озвучки реплик (настройка `voice`). */
  voice: number;
}

export class AudioManager implements IAudioSink {
  music: string | null = null;
  ambient: string | null = null;
  lastSfx: string | null = null;
  /** Последние события звука (для отладочной панели). */
  readonly log: string[] = [];

  private muted = false;
  private platformEnabled = true;
  private voiceOn = true;
  private volumes: AudioVolumes = { music: 0.4, sfx: 0.8, voice: 0.9 };
  private voiceClip: VoicePlayback | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly backend: IAudioBackend | null = null) {}

  /** Звучит ли игра сейчас: не выключена игроком и разрешена платформой. Это «общий мастер»: он множится на все каналы. */
  get audible(): boolean {
    return !this.muted && this.platformEnabled;
  }

  /** Озвучка реплик включена в настройках (флажок «Озвучка»). */
  get voiceEnabled(): boolean {
    return this.voiceOn;
  }

  /** Озвучку сейчас было бы слышно: включена, игра не выключена игроком и платформой, громкость не ноль. */
  get voiceAudible(): boolean {
    return this.voiceOn && this.audible && this.volumes.voice > 0;
  }

  /** Адрес клипа озвучки, который играет сейчас (для QA и отладочной панели). */
  get voicePlaying(): string | null {
    return this.voiceClip?.state === 'playing' ? this.voiceClip.url : null;
  }

  handle(ev: AudioEventPayload): void {
    const line = `${ev.kind}${ev.id ? ` ${ev.id}` : ''}`;
    this.log.push(line);
    if (this.log.length > 30) this.log.shift();
    switch (ev.kind) {
      case 'music':
        this.music = ev.id;
        if (ev.id) this.backend?.play('music', ev.id, { loop: ev.loop, volume: ev.volume, fadeMs: ev.fade_ms });
        break;
      case 'ambient':
        this.ambient = ev.id;
        if (ev.id) this.backend?.play('ambient', ev.id, { loop: ev.loop, volume: ev.volume, fadeMs: ev.fade_ms });
        break;
      case 'sfx':
        this.lastSfx = ev.id;
        if (ev.id) this.backend?.play('sfx', ev.id, { loop: false, volume: ev.volume, fadeMs: 0 });
        break;
      case 'stop_music':
        this.music = null;
        this.backend?.stop('music', ev.fade_ms);
        break;
      case 'stop_ambient':
        this.ambient = null;
        this.backend?.stop('ambient', ev.fade_ms);
        break;
    }
    this.emit();
  }

  /** После загрузки/отката: что должно играть по кадру. Клип озвучки прежней реплики при этом обрывается. */
  sync(music: string | null, ambient: string | null): void {
    this.stopVoice();
    if (music !== this.music) {
      this.music = music;
      if (music) this.backend?.play('music', music, { loop: true, volume: 1, fadeMs: 300 });
      else this.backend?.stop('music', 300);
    }
    if (ambient !== this.ambient) {
      this.ambient = ambient;
      if (ambient) this.backend?.play('ambient', ambient, { loop: true, volume: 1, fadeMs: 300 });
      else this.backend?.stop('ambient', 300);
    }
    this.emit();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** Пауза платформы (реклама, вкладка в фоне): звук встаёт и продолжается с того же места. */
  setPaused(paused: boolean): void {
    this.backend?.setPaused?.(paused);
  }

  /** Разрешение звука от платформы (Playgama AUDIO_STATE_CHANGED). */
  setPlatformEnabled(enabled: boolean): void {
    this.platformEnabled = enabled;
    this.applyGain();
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = v;
    this.applyGain();
  }

  /** Включить / выключить озвучку реплик (настройка `voiceEnabled`). Выключение обрывает идущий клип. */
  setVoiceEnabled(on: boolean): void {
    if (this.voiceOn === on) return;
    this.voiceOn = on;
    if (!on) this.stopVoice();
    this.applyGain();
  }

  /**
   * Начать клип озвучки. null — не слышно (выключена, Mute, запрет платформы, нулевая громкость) или играть нечем:
   * вызывающий тогда живёт как без озвучки (авто-режим считает паузу по тексту).
   */
  playVoice(url: string): VoicePlayback | null {
    this.stopVoice();
    if (!this.voiceAudible || !this.backend?.playVoice) return null;
    const clip = this.backend.playVoice(url);
    this.voiceClip = clip;
    if (clip) {
      this.log.push(`voice ${url}`);
      if (this.log.length > 30) this.log.shift();
      this.emit();
    }
    return clip;
  }

  /** Оборвать идущий клип озвучки (следующая реплика, откат, загрузка, меню, выключение озвучки). */
  stopVoice(): void {
    this.backend?.stopVoice?.();
    this.voiceClip = null;
  }

  /** Прогреть клипы озвучки (при выключенной озвучке ничего не качаем). */
  preloadVoice(urls: readonly string[], priority: 'now' | 'idle' = 'idle'): void {
    if (this.voiceOn && urls.length > 0) this.backend?.preloadVoice?.(urls, priority);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private applyGain(): void {
    const k = this.audible ? 1 : 0;
    this.backend?.setGain('music', this.volumes.music * k);
    // Фон места (улица, подъезд, кабинет) — это звук, а не музыка: идёт с ползунком «Звуки» (владелец 2026-10-14).
    this.backend?.setGain('ambient', this.volumes.sfx * k);
    this.backend?.setGain('sfx', this.volumes.sfx * k);
    this.backend?.setGain('voice', this.voiceOn ? this.volumes.voice * k : 0);
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
