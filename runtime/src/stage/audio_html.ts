/**
 * Звуковой бэкенд на HTMLAudioElement (надёжно на iOS Safari). Файлы — из episode.assets: музыка
 * `.m4a` (AAC, поддержан всеми целевыми браузерами и WebView), эмбиент и эффекты `.mp3`.
 *
 *  - музыка: луп с кроссфейдом по fade_ms (старый трек гаснет, новый нарастает); тот же трек повторно
 *    не запускается (откат и загрузка вызывают sync много раз);
 *  - эмбиент: луп на отдельном канале, свои затухания;
 *  - sfx: одноразовые, пул из SFX_POOL элементов (самый старый заменяется, если все заняты);
 *  - громкости каналов и mute приходят от AudioManager через setGain (mute и запрет платформой —
 *    нулевой gain: музыка продолжает идти беззвучно, поэтому при включении звука не «перематывается»);
 *  - отсутствующий файл тихо пропускается: один console.warn на файл, игра не падает;
 *  - предзагрузка по блокам: preload(urls) прогревает кеш браузера и сразу отмечает отсутствующие файлы;
 *  - озвучка реплик: отдельный канал из одного элемента (клип за раз, mp3); playVoice возвращает VoicePlayback — по нему
 *    DomUI узнаёт о конце клипа (авто-режим) и обрывает его; громкость — канал `voice`, как у остальных (mute и запрет
 *    платформой — нулевой gain); клипы блока прогреваются в фоне небольшой очередью (preloadVoice), чтобы не мешать картинкам.
 *    Файл, который по индексу есть, но не читается, — один warn и тишина; запрет автозапуска — тишина без warn.
 *
 * iOS. (1) Автозапуск звука разрешён только внутри жеста: фиксированный набор элементов (по два на
 * музыку и эмбиент, пул sfx) «разблокируется» при первом касании (unlock) — дальше им можно менять src
 * и вызывать play() без жеста; трек, который не удалось запустить до жеста, стартует при разблокировке.
 * (2) Программно менять громкость элемента на iPhone нельзя (volume всегда 1): в этом случае громкость
 * каналов работает как «вкл/выкл» через muted, а кроссфейд превращается в склейку — об этом README.
 *
 * Время, таймеры и создание элементов передаются снаружи (HtmlAudioEnv), поэтому все переходы
 * проверяются тестами без браузера (tests/audio_html.test.ts).
 */
import { VoiceClip } from './audio';
import type { IAudioBackend, VoicePlayback } from './audio';

/**
 * Тишина: 1 мс, 8 кГц, 8 бит, моно — корректный WAV для разблокировки элементов (годится Chromium и Safari;
 * «коротыш» из Howler.js с неточным размером RIFF Chromium отвергает с ошибкой MEDIA_ERR_SRC_NOT_SUPPORTED).
 */
export const SILENT_WAV = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==';

export const SFX_POOL = 6;
/** Клипов озвучки, которые прогреваются одновременно (картинки блока грузятся параллельно — не толкаемся). */
export const VOICE_WARM_CONCURRENCY = 2;
/** Сколько ждать прогрева одного клипа, мс. */
export const VOICE_WARM_TIMEOUT_MS = 8000;
/** Шаг затухания, мс. */
export const FADE_STEP_MS = 33;

type Kind = 'music' | 'ambient';

/** Часть HTMLAudioElement, которую мы используем (в тестах подменяется). */
export interface AudioElementLike {
  src: string;
  loop: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  preload: string;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, cb: (ev?: unknown) => void): void;
  removeEventListener(type: string, cb: (ev?: unknown) => void): void;
}

export interface HtmlAudioEnv {
  createElement(): AudioElementLike;
  now(): number;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  warn(message: string): void;
}

function defaultEnv(): HtmlAudioEnv {
  return {
    createElement: () => new Audio(),
    now: () => performance.now(),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    warn: (m) => console.warn(m),
  };
}

interface Fade {
  from: number;
  to: number;
  t0: number;
  ms: number;
  done?: () => void;
}

interface Track {
  id: string;
  url: string;
  el: AudioElementLike;
  /** Громкость трека из шага сценария, 0..1. */
  base: number;
  /** Множитель затухания, 0..1. */
  level: number;
  fade: Fade | null;
  /** Игрок (или платформа) должен слышать этот трек: на старте play() мог быть отклонён автозапуском. */
  blocked: boolean;
  stopped: boolean;
  onError: () => void;
}

interface Channel {
  kind: Kind;
  els: AudioElementLike[];
  current: Track | null;
  outgoing: Track[];
}

interface SfxSlot {
  el: AudioElementLike;
  busy: boolean;
  startedAt: number;
  /** Адрес эффекта, который сейчас играет в слоте. */
  url: string;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class HtmlAudioBackend implements IAudioBackend {
  private readonly env: HtmlAudioEnv;
  private readonly channels: Record<Kind, Channel>;
  private readonly sfx: SfxSlot[];
  private readonly gains: Record<'music' | 'ambient' | 'sfx' | 'voice', number> = { music: 1, ambient: 1, sfx: 1, voice: 1 };
  private readonly missing = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly probed = new Set<string>();
  /** false на iPhone/iPad Safari: volume элемента программно не меняется. */
  readonly volumeSettable: boolean;
  private timer: unknown = null;
  private paused = false;
  private pausedAt = 0;
  private unlocked = false;
  private resumeList: AudioElementLike[] = [];
  /** Элемент канала озвучки (создаётся последним и входит в разблокировку iOS) и клип, который на нём играет. */
  private readonly voiceEl: AudioElementLike;
  private voiceClip: VoiceClip | null = null;
  private readonly warmQueue: Record<'now' | 'idle', string[]> = { now: [], idle: [] };
  private readonly warmed = new Set<string>();
  private warmActive = 0;

  constructor(
    /** id ассета → URL файла (AssetCatalog.audioUrl); null — такого id нет в episode.assets. */
    private readonly resolve: (id: string) => string | null,
    env: Partial<HtmlAudioEnv> = {},
  ) {
    this.env = { ...defaultEnv(), ...env };
    const make = (): AudioElementLike => {
      const el = this.env.createElement();
      el.preload = 'auto';
      return el;
    };
    this.channels = {
      music: { kind: 'music', els: [make(), make()], current: null, outgoing: [] },
      ambient: { kind: 'ambient', els: [make(), make()], current: null, outgoing: [] },
    };
    this.sfx = Array.from({ length: SFX_POOL }, () => ({ el: make(), busy: false, startedAt: 0, url: '' }));
    this.voiceEl = make();
    for (const slot of this.sfx) {
      // Один обработчик на слот (не по одному на каждое проигрывание): ошибка относится к эффекту,
      // который играет сейчас; пока слот свободен (разблокировка, пауза), ошибки игнорируются.
      slot.el.addEventListener('ended', () => {
        slot.busy = false;
      });
      slot.el.addEventListener('error', () => {
        if (!slot.busy) return;
        slot.busy = false;
        this.missing.add(slot.url);
        this.warnOnce(`file:${slot.url}`, `[audio] нет файла ${slot.url}: звук пропущен`);
      });
    }
    this.volumeSettable = this.probeVolume();
  }

  private probeVolume(): boolean {
    try {
      const probe = this.sfx[0]!.el;
      probe.volume = 0.5;
      const ok = Math.abs(probe.volume - 0.5) < 0.001;
      probe.volume = 1;
      return ok;
    } catch {
      return false;
    }
  }

  // ───────────────────────────── IAudioBackend ─────────────────────────────

  play(kind: 'music' | 'ambient' | 'sfx', id: string, opts: { loop: boolean; volume: number; fadeMs: number }): void {
    const url = this.resolve(id);
    if (!url) {
      this.warnOnce(`id:${id}`, `[audio] нет записи об аудио «${id}» в assets эпизода: пропуск`);
      return;
    }
    if (this.missing.has(url)) return;
    if (kind === 'sfx') {
      this.playSfx(url, opts.volume);
      return;
    }
    this.playTrack(this.channels[kind], id, url, opts);
  }

  stop(kind: 'music' | 'ambient', fadeMs: number): void {
    const ch = this.channels[kind];
    const cur = ch.current;
    if (!cur) return;
    ch.current = null;
    this.retire(ch, cur, this.canFade() ? fadeMs : 0);
  }

  setGain(channel: 'music' | 'ambient' | 'sfx' | 'voice', gain: number): void {
    this.gains[channel] = clamp01(gain);
    if (channel === 'music' || channel === 'ambient') {
      const ch = this.channels[channel];
      for (const t of [ch.current, ...ch.outgoing]) if (t) this.apply(t);
    } else if (channel === 'voice') {
      this.applyVoice();
    }
  }

  /** Прогреть файлы: браузер начинает их загрузку, недостающие сразу отмечаются (один warn на файл). */
  preload(urls: readonly string[]): Promise<void> {
    const todo = urls.filter((u) => !this.probed.has(u));
    for (const u of todo) this.probed.add(u);
    return Promise.all(todo.map((u) => this.probe(u))).then(() => undefined);
  }

  /** Пауза платформы / вкладки в фоне: всё играющее встаёт и после паузы продолжается с того же места. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.pausedAt = this.env.now();
      if (this.timer !== null) {
        this.env.clearTimer(this.timer);
        this.timer = null;
      }
      this.resumeList = [];
      for (const el of this.allElements()) {
        if (!el.paused) {
          this.resumeList.push(el);
          el.pause();
        }
      }
    } else {
      const gap = this.env.now() - this.pausedAt;
      for (const t of this.allTracks()) if (t.fade) t.fade.t0 += gap;
      for (const el of this.resumeList.splice(0)) this.safePlay(el, null);
      this.ensureTimer();
    }
  }

  /**
   * Разблокировка звука: вызывать из обработчика жеста (касание, клик, клавиша). Каждому элементу пула
   * даётся «отыграть» тишину — после этого iOS разрешает ему играть без жеста. Треки, которым не дали
   * стартовать до жеста, запускаются.
   */
  unlock(): void {
    if (this.unlocked) {
      this.retryBlocked();
      return;
    }
    this.unlocked = true;
    const busy = new Set<AudioElementLike>([
      ...this.allTracks().map((t) => t.el),
      ...this.sfx.filter((s) => s.busy).map((s) => s.el),
      ...(this.voiceClip ? [this.voiceEl] : []),
    ]);
    for (const el of this.allElements()) {
      if (busy.has(el)) continue;
      try {
        el.src = SILENT_WAV;
        const r = el.play();
        const done = (): void => {
          // элемент мог за это время получить настоящий трек — не трогаем его
          if (!busy.has(el) && !this.allTracks().some((t) => t.el === el) && !this.sfx.some((s) => s.el === el && s.busy) && !(el === this.voiceEl && this.voiceClip)) {
            el.pause();
          }
        };
        if (r && typeof r.then === 'function') r.then(done, () => undefined);
        else done();
      } catch {
        /* элемент без поддержки — пропускаем */
      }
    }
    this.retryBlocked();
  }

  /** Подписаться на первый жест страницы (касание / клик / клавиша) — после него звук разблокируется. */
  installUnlock(target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document): () => void {
    const events = ['touchend', 'pointerup', 'click', 'keydown'] as const;
    const handler = (): void => {
      this.unlock();
      off();
    };
    const off = (): void => {
      for (const e of events) target.removeEventListener(e, handler, true);
    };
    for (const e of events) target.addEventListener(e, handler, true);
    return off;
  }

  dispose(): void {
    if (this.timer !== null) this.env.clearTimer(this.timer);
    this.timer = null;
    this.stopVoice();
    for (const el of this.allElements()) {
      el.pause();
      el.removeAttribute('src');
    }
  }

  /** Для отладочной панели и тестов. */
  state(): { music: string | null; ambient: string | null; fading: number; sfxBusy: number; missing: string[]; voice: string | null } {
    return {
      music: this.channels.music.current?.id ?? null,
      ambient: this.channels.ambient.current?.id ?? null,
      fading: this.allTracks().filter((t) => t.fade).length,
      sfxBusy: this.sfx.filter((s) => s.busy).length,
      missing: [...this.missing],
      voice: this.voiceClip?.url ?? null,
    };
  }

  // ───────────────────────────── треки ─────────────────────────────

  private canFade(): boolean {
    return this.volumeSettable;
  }

  private playTrack(ch: Channel, id: string, url: string, opts: { loop: boolean; volume: number; fadeMs: number }): void {
    const cur = ch.current;
    if (cur && cur.id === id && !cur.stopped) {
      // тот же трек уже идёт: не перезапускаем, только обновляем громкость
      cur.base = clamp01(opts.volume);
      cur.el.loop = opts.loop;
      this.apply(cur);
      return;
    }
    const fadeMs = this.canFade() ? Math.max(0, opts.fadeMs) : 0;
    // предыдущий трек уходит (кроссфейд: одновременно с появлением нового)
    if (cur) {
      ch.current = null;
      this.retire(ch, cur, fadeMs);
    }
    const el = this.acquire(ch);
    const track: Track = {
      id,
      url,
      el,
      base: clamp01(opts.volume),
      level: fadeMs > 0 ? 0 : 1,
      fade: null,
      blocked: false,
      stopped: false,
      onError: () => this.fileFailed(url, track),
    };
    ch.current = track;
    el.loop = opts.loop;
    el.addEventListener('error', track.onError);
    el.src = url;
    try {
      el.currentTime = 0;
    } catch {
      /* метаданные ещё не загружены — трек и так начнётся с нуля */
    }
    this.apply(track);
    this.safePlay(el, track);
    if (fadeMs > 0) this.fade(track, 1, fadeMs);
  }

  /** Элемент канала, свободный от текущего и уходящих треков; при нехватке заменяем самый старый уходящий. */
  private acquire(ch: Channel): AudioElementLike {
    const used = new Set<AudioElementLike>([...(ch.current ? [ch.current.el] : []), ...ch.outgoing.map((t) => t.el)]);
    const free = ch.els.find((e) => !used.has(e));
    if (free) return free;
    const victim = ch.outgoing.shift();
    if (victim) this.release(victim);
    return victim ? victim.el : ch.els[0]!;
  }

  /** Трек уходит: затухает за fadeMs и освобождает элемент. */
  private retire(ch: Channel, track: Track, fadeMs: number): void {
    ch.outgoing.push(track);
    const finish = (): void => {
      const i = ch.outgoing.indexOf(track);
      if (i >= 0) ch.outgoing.splice(i, 1);
      this.release(track);
    };
    if (fadeMs > 0) this.fade(track, 0, fadeMs, finish);
    else finish();
  }

  private release(track: Track): void {
    track.stopped = true;
    track.fade = null;
    track.el.removeEventListener('error', track.onError);
    try {
      track.el.pause();
    } catch {
      /* уже остановлен */
    }
  }

  private fileFailed(url: string, track: Track): void {
    if (track.stopped) return;
    this.missing.add(url);
    this.warnOnce(`file:${url}`, `[audio] нет файла ${url}: звук пропущен`);
    for (const ch of Object.values(this.channels)) {
      if (ch.current === track) ch.current = null;
      const i = ch.outgoing.indexOf(track);
      if (i >= 0) ch.outgoing.splice(i, 1);
    }
    this.release(track);
  }

  /** Эффективная громкость: трек × затухание × канал. */
  private volumeOf(t: Track): number {
    const ch = this.channels.music.current === t || this.channels.music.outgoing.includes(t) ? 'music' : 'ambient';
    return clamp01(t.base * t.level * this.gains[ch]);
  }

  private apply(t: Track): void {
    const v = this.volumeOf(t);
    if (this.volumeSettable) {
      t.el.volume = v;
      t.el.muted = false;
    } else {
      t.el.muted = v < 0.05;
    }
  }

  private fade(t: Track, to: number, ms: number, done?: () => void): void {
    t.fade = { from: t.level, to, t0: this.env.now(), ms, ...(done ? { done } : {}) };
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.paused) return;
    if (!this.allTracks().some((t) => t.fade)) return;
    this.timer = this.env.setTimer(() => this.tick(), FADE_STEP_MS);
  }

  private tick(): void {
    this.timer = null;
    const now = this.env.now();
    for (const t of this.allTracks()) {
      const f = t.fade;
      if (!f) continue;
      const k = (now - f.t0) / f.ms;
      if (k >= 1) {
        t.level = f.to;
        t.fade = null;
        this.apply(t);
        f.done?.();
      } else {
        t.level = f.from + (f.to - f.from) * Math.max(0, k);
        this.apply(t);
      }
    }
    this.ensureTimer();
  }

  private allTracks(): Track[] {
    const out: Track[] = [];
    for (const ch of Object.values(this.channels)) {
      if (ch.current) out.push(ch.current);
      out.push(...ch.outgoing);
    }
    return out;
  }

  private allElements(): AudioElementLike[] {
    return [...this.channels.music.els, ...this.channels.ambient.els, ...this.sfx.map((s) => s.el), this.voiceEl];
  }

  // ───────────────────────────── sfx ─────────────────────────────

  private playSfx(url: string, volume: number): void {
    const gain = this.gains.sfx;
    if (gain <= 0 || this.paused) return; // mute / запрет платформы / пауза: эффект не запускаем
    let slot = this.sfx.find((s) => !s.busy);
    if (!slot) slot = [...this.sfx].sort((a, b) => a.startedAt - b.startedAt)[0]!;
    const el = slot.el;
    try {
      el.pause();
    } catch {
      /* ничего не играло */
    }
    slot.busy = true;
    slot.startedAt = this.env.now();
    slot.url = url;
    el.loop = false;
    el.src = url;
    try {
      el.currentTime = 0;
    } catch {
      /* см. выше */
    }
    if (this.volumeSettable) el.volume = clamp01(volume * gain);
    else el.muted = volume * gain < 0.05;
    this.safePlay(
      el,
      null,
      () => {
        slot.busy = false;
      },
      url,
    );
  }

  // ───────────────────────────── озвучка реплик ─────────────────────────────

  /**
   * Начать клип озвучки; прежний обрывается. null — играть нечем: файл уже известен как отсутствующий или идёт пауза
   * платформы (реплики в это время не листаются).
   */
  playVoice(url: string): VoicePlayback | null {
    this.stopVoice(); // новая просьба делает прежний клип ненужным, даже если новый не стартует
    if (this.missing.has(url) || this.paused) return null;
    const el = this.voiceEl;
    const clip = new VoiceClip(url);
    const onEnded = (): void => clip.finish('ended');
    const onError = (): void => this.voiceUnreadable(clip);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    // Подписка бэкенда первая: когда подписчики клипа (авто-режим) узнают о конце, элемент уже освобождён.
    clip.onEnd(() => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      this.releaseVoice(clip);
    });
    this.voiceClip = clip;
    el.loop = false;
    el.src = url;
    try {
      el.currentTime = 0;
    } catch {
      /* метаданные ещё не загружены — клип и так начнётся с нуля */
    }
    this.applyVoice();
    let r: Promise<void> | void;
    try {
      r = el.play();
    } catch (e) {
      this.voicePlayFailed(e, clip);
      return clip;
    }
    if (r && typeof r.then === 'function') r.then(() => undefined, (e: unknown) => this.voicePlayFailed(e, clip));
    return clip;
  }

  stopVoice(): void {
    this.voiceClip?.finish('stopped');
  }

  /**
   * Прогрев клипов озвучки в фоне: не больше VOICE_WARM_CONCURRENCY одновременно, 'now' (текущий блок) обгоняет
   * 'idle' (следующие). Один и тот же адрес дважды не греется.
   */
  preloadVoice(urls: readonly string[], priority: 'now' | 'idle' = 'idle'): void {
    for (const u of urls) {
      if (this.warmed.has(u) || this.missing.has(u)) continue;
      this.warmed.add(u);
      this.warmQueue[priority].push(u);
    }
    this.pumpWarm();
  }

  private pumpWarm(): void {
    while (this.warmActive < VOICE_WARM_CONCURRENCY) {
      const url = this.warmQueue.now.shift() ?? this.warmQueue.idle.shift();
      if (url === undefined) return;
      this.warmActive += 1;
      void this.probe(url, ['canplaythrough'], VOICE_WARM_TIMEOUT_MS).then(() => {
        this.warmActive -= 1;
        this.pumpWarm();
      });
    }
  }

  private applyVoice(): void {
    const v = this.gains.voice;
    if (this.volumeSettable) {
      this.voiceEl.volume = v;
      this.voiceEl.muted = false;
    } else {
      this.voiceEl.muted = v < 0.05;
    }
  }

  /** Клип закончился любым способом: элемент замолкает и отпускает загрузку (недогруженный клип не качается зря). */
  private releaseVoice(clip: VoiceClip): void {
    if (this.voiceClip !== clip) return;
    this.voiceClip = null;
    const el = this.voiceEl;
    try {
      el.pause();
    } catch {
      /* уже остановлен */
    }
    el.removeAttribute('src');
    try {
      el.load();
    } catch {
      /* элемент без load() — не страшно */
    }
  }

  /** Файл из индекса не читается (повреждён, нет на сервере): один warn на файл, дальше клип молча пропускается. */
  private voiceUnreadable(clip: VoiceClip): void {
    if (clip.state !== 'playing') return;
    this.missing.add(clip.url);
    this.warnOnce(`file:${clip.url}`, `[audio] нет файла ${clip.url}: озвучка пропущена`);
    clip.finish('failed');
  }

  private voicePlayFailed(e: unknown, clip: VoiceClip): void {
    if (clip.state !== 'playing') return;
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'AbortError') return; // src сменили или поставили на паузу — клип завершит тот, кто это сделал
    if (name === 'NotAllowedError') {
      clip.finish('failed'); // автозапуск запрещён (iOS до первого касания): без звука, без шума
      return;
    }
    this.voiceUnreadable(clip);
  }

  // ───────────────────────────── запуск и ошибки ─────────────────────────────

  /** play() с разбором отказа: автозапуск запрещён → ждём жеста; файл не читается → пропуск. */
  private safePlay(el: AudioElementLike, track: Track | null, onFail?: () => void, url?: string): void {
    if (this.paused && track) {
      // пауза платформы: трек запустится после неё
      this.resumeList.push(el);
      return;
    }
    let r: Promise<void> | void;
    try {
      r = el.play();
    } catch (e) {
      this.playFailed(e, el, track, onFail, url);
      return;
    }
    if (r && typeof r.then === 'function') r.then(() => undefined, (e: unknown) => this.playFailed(e, el, track, onFail, url));
  }

  private playFailed(e: unknown, el: AudioElementLike, track: Track | null, onFail?: () => void, logicalUrl?: string): void {
    if (el === this.voiceEl && this.voiceClip) {
      this.voicePlayFailed(e, this.voiceClip); // возобновление клипа после паузы платформы не удалось
      return;
    }
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'AbortError') return; // src сменили на лету — нормальный ход вещей
    if (name === 'NotAllowedError') {
      if (track && !track.stopped) track.blocked = true; // доиграем после первого касания (unlock)
      onFail?.();
      return;
    }
    // NotSupportedError и прочее: файла нет или формат не читается
    const url = track?.url ?? logicalUrl ?? el.src;
    if (track) this.fileFailed(url, track);
    else if (url) {
      this.missing.add(url);
      this.warnOnce(`file:${url}`, `[audio] не удалось проиграть ${url}: звук пропущен`);
    }
    onFail?.();
  }

  private retryBlocked(): void {
    for (const t of this.allTracks()) {
      if (t.blocked && !t.stopped) {
        t.blocked = false;
        this.safePlay(t.el, t);
      }
    }
  }

  // ───────────────────────────── предзагрузка ─────────────────────────────

  private probe(url: string, okEvents: readonly string[] = ['loadedmetadata', 'canplay', 'canplaythrough'], timeoutMs = 4000): Promise<void> {
    return new Promise<void>((resolve) => {
      const el = this.env.createElement();
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        this.env.clearTimer(timer);
        for (const ev of okEvents) el.removeEventListener(ev, onOk);
        el.removeEventListener('error', onBad);
        if (!ok) {
          this.missing.add(url);
          this.warnOnce(`file:${url}`, `[audio] нет файла ${url}: звук пропущен`);
        }
        el.removeAttribute('src');
        resolve();
      };
      const onOk = (): void => finish(true);
      const onBad = (): void => finish(false);
      // iOS не предзагружает аудио без жеста — события не придут: по таймеру считаем «неизвестно, но не отсутствует»
      const timer = this.env.setTimer(() => finish(true), timeoutMs);
      for (const ev of okEvents) el.addEventListener(ev, onOk);
      el.addEventListener('error', onBad);
      el.preload = 'auto';
      el.src = url;
      el.load();
    });
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.env.warn(message);
  }
}
