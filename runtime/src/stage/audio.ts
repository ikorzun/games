/**
 * Звук. Пока в репозитории нет аудиоассетов, менеджер только ведёт состояние
 * (что играет, mute пользователя, запрет звука платформой) и пишет журнал для отладки;
 * воспроизведение подключается через IAudioBackend, когда появится build_assets (ogg).
 * Шаги music / sfx / ambient / stop_* интерпретатор уже исполняет полностью.
 */
import type { AudioEventPayload, IAudioSink } from './types';

export interface IAudioBackend {
  play(kind: 'music' | 'ambient' | 'sfx', id: string, opts: { loop: boolean; volume: number; fadeMs: number }): void;
  stop(kind: 'music' | 'ambient', fadeMs: number): void;
  /** Итоговая громкость каналов (0 — тишина, учитывает mute и запрет платформы). */
  setGain(channel: 'music' | 'ambient' | 'sfx' | 'voice', gain: number): void;
}

export interface AudioVolumes {
  music: number;
  sfx: number;
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
  private volumes: AudioVolumes = { music: 0.7, sfx: 0.8, voice: 1 };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly backend: IAudioBackend | null = null) {}

  /** Звучит ли игра сейчас: не выключена игроком и разрешена платформой. */
  get audible(): boolean {
    return !this.muted && this.platformEnabled;
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

  /** После загрузки/отката: что должно играть по кадру. */
  sync(music: string | null, ambient: string | null): void {
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

  /** Разрешение звука от платформы (Playgama AUDIO_STATE_CHANGED). */
  setPlatformEnabled(enabled: boolean): void {
    this.platformEnabled = enabled;
    this.applyGain();
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = v;
    this.applyGain();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private applyGain(): void {
    const k = this.audible ? 1 : 0;
    this.backend?.setGain('music', this.volumes.music * k);
    this.backend?.setGain('ambient', this.volumes.music * k);
    this.backend?.setGain('sfx', this.volumes.sfx * k);
    this.backend?.setGain('voice', this.volumes.voice * k);
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
