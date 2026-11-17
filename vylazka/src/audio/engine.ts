/**
 * Звук: WebAudio, свой микшер. Банк звуков по id из audio/manifest.json; файлы лежат в public/audio
 * как `<id>_<n>.mp3`. Разовые звуки играются со случайным вариантом (без повтора подряд) и могут быть
 * привязаны к точке мира: панорама и громкость считаются от слушателя. Петли держатся с плавной
 * громкостью: «звучит ли» решает игра каждый кадр.
 *
 * Звука, синтезированного в коде, в игре нет: площадка такой не принимает. Если файла нет, звук
 * просто не играет; о неполном наборе файлов сообщает проверка сборки. Какие файлы есть, сборка
 * знает заранее (`__VZ_AUDIO__` из vite.config.ts), поэтому отсутствующие даже не запрашиваются.
 */
import { playThroughSilentSwitch } from '../platform/mobile_guard';
import type { Vec3 } from '../core/types';
import manifest from '../../audio/manifest.json';

export interface SoundDef {
  id: string;
  bus: string;
  variants: number;
  loop: boolean;
  seconds: number;
  volume: number;
  /** Для петель: сколько секунд конец перетекает в начало. */
  xfade?: number;
}

export const SOUNDS: readonly SoundDef[] = manifest.sounds;

/** Имя файла варианта звука. */
export const soundFile = (id: string, variant: number): string => `${id}_${variant}.mp3`;

declare const __VZ_AUDIO__: string[] | undefined;

/** Файлы, попавшие в сборку. */
export const bundledFiles = (): string[] => (typeof __VZ_AUDIO__ !== 'undefined' && Array.isArray(__VZ_AUDIO__) ? __VZ_AUDIO__ : []);

/** Полный набор файлов по манифесту. */
export function allSoundFiles(): string[] {
  const out: string[] = [];
  for (const s of SOUNDS) for (let v = 1; v <= s.variants; v++) out.push(soundFile(s.id, v));
  return out;
}

export interface PlayOptions {
  /** Множитель громкости поверх заданной в манифесте. */
  volume?: number;
  /** Точка мира, из которой звук слышен. Без неё звук «в голове» (интерфейс, тело игрока). */
  pos?: Vec3;
  /** Скорость воспроизведения (высота тона): небольшой разброс оживляет повторы. */
  rate?: number;
  /**
   * Сколько секунд звук готов подождать, если его файл ещё грузится. Для звуков, которые нельзя
   * проглотить (люк в начале первой вылазки): обычный звук, не успевший загрузиться, просто молчит.
   */
  late?: number;
}

/** Панорама и затухание звука из точки мира: pan −1…1, gain 0…1, muffle 0…1 (насколько глухо). */
export function spatialize(listener: Vec3, yaw: number, pos: Vec3): { pan: number; gain: number; muffle: number } {
  const dx = pos[0] - listener[0];
  const dy = pos[1] - listener[1];
  const dz = pos[2] - listener[2];
  const d = Math.hypot(dx, dy, dz);
  // Вправо от слушателя: (cos yaw, −sin yaw) при взгляде вдоль (−sin yaw, −cos yaw).
  const right = d > 1e-3 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d : 0;
  return { pan: Math.max(-1, Math.min(1, right)) * 0.85, gain: 1 / (1 + (d / 5) * (d / 5)), muffle: Math.max(0, Math.min(1, (d - 4) / 18)) };
}

interface LoopVoice {
  buf: AudioBuffer;
  /** Проходы петли, которые сейчас звучат: на стыке их два. */
  live: Set<AudioBufferSourceNode>;
  gain: GainNode;
  pan: StereoPannerNode | null;
  /** Глушит верха, как стены у далёкого звука (только у петель с точкой в мире). */
  lp: BiquadFilterNode | null;
  target: number;
  /** Когда затихшую петлю можно остановить (время контекста); null — петля звучит. */
  stopAt: number | null;
  /** Когда начнётся следующий проход (время контекста) и сколько длится стык. */
  nextAt: number;
  xfade: number;
}

/** На сколько секунд вперёд ставятся проходы петли: кадры бывают редкими, стык — нет. */
const LOOP_AHEAD = 0.5;

/** Кривые стыка равной мощности: шум в сумме не проседает, как просел бы при линейном переходе. */
const FADE_IN = Float32Array.from({ length: 17 }, (_, i) => Math.sin((i / 16) * Math.PI * 0.5));
const FADE_OUT = Float32Array.from({ length: 17 }, (_, i) => Math.cos((i / 16) * Math.PI * 0.5));

/** За сколько секунд петля набирает и теряет громкость (постоянная времени). */
const LOOP_TAU = 0.25;

type OfflineCtor = new (channels: number, length: number, rate: number) => BaseAudioContext;

/** Сколько файлов грузится разом: мелких файлов много, и по сети с задержкой каждый ждёт своей очереди. */
const PARALLEL = 6;
/**
 * Сколько секунд разовый звук ждёт запуска контекста. Safari и iOS запускают его не в тот же миг, что нажатие:
 * без ожидания первые звуки (старт, люк, щелчок) проглатывались — «звук не срабатывает сразу» (партнёр 17.11).
 */
const START_GRACE = 0.4;

const clockMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Waiting {
  def: SoundDef;
  buf: AudioBuffer;
  opts: PlayOptions;
  /** До какого мига (мс, часы страницы) звук ещё уместен. */
  until: number;
}

export class AudioEngine {
  /** Файлы, которых не оказалось на месте (для отладки и смоука). */
  readonly missing = new Set<string>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly defs = new Map(SOUNDS.map((s) => [s.id, s]));
  private readonly lastVariant = new Map<string, number>();
  private readonly loops = new Map<string, LoopVoice>();
  private listener: Vec3 = [0, 0, 0];
  private yaw = 0;
  private muted = false;
  private enabled = true;
  private paused = false;
  private seed = 1;
  private readonly queue: [string, number][] = [];
  /** Декодер до первого нажатия: настоящий контекст браузер без жеста не запустит, а разобрать файлы можно. */
  private offline: BaseAudioContext | null = null;
  private loadingBegun = false;
  private order: readonly string[] = [];
  /** Сколько раз игра просила звук и сколько раз он действительно прозвучал (для отладки и смоука). */
  readonly asked = new Map<string, number>();
  readonly played = new Map<string, number>();
  /** Разовые звуки, которые попросили, пока контекст ещё запускался: прозвучат, как только он пойдёт. */
  private readonly waiting: Waiting[] = [];

  private readonly files: ReadonlySet<string>;

  /** baseUrl — папка со звуками; files — какие файлы в ней есть (по умолчанию — попавшие в сборку). */
  constructor(
    private readonly baseUrl = './audio/',
    files: readonly string[] = bundledFiles(),
  ) {
    this.files = new Set(files);
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** Сколько файлов уже загружено и сколько должно быть. */
  status(): { loaded: number; total: number; known: number; missing: number; state: string; muted: boolean; enabled: boolean; loops: string[]; asked: Record<string, number>; played: Record<string, number> } {
    return {
      loaded: this.buffers.size,
      total: SOUNDS.reduce((n, s) => n + s.variants, 0),
      known: this.files.size,
      missing: this.missing.size,
      state: this.ctx?.state ?? 'locked',
      muted: this.muted,
      enabled: this.enabled,
      loops: this.activeLoops(),
      asked: Object.fromEntries(this.asked),
      played: Object.fromEntries(this.played),
    };
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Начать загрузку набора заранее, не дожидаясь нажатия: к началу вылазки главное уже готово.
   * first — id звуков, которые нужны раньше остальных.
   */
  preload(first: readonly string[] = []): void {
    this.order = first;
    if (typeof window === 'undefined' || this.loadingBegun) return;
    const Offline = (window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor }).OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext;
    // Без отдельного декодера (очень старые браузеры) загрузка начнётся с первым нажатием.
    if (!Offline) return;
    try {
      this.offline = new Offline(1, 1, 44100);
    } catch {
      return;
    }
    this.beginLoad();
  }

  private beginLoad(): void {
    if (this.loadingBegun) return;
    this.loadingBegun = true;
    const rank = (id: string): number => {
      const i = this.order.indexOf(id);
      return i < 0 ? this.order.length : i;
    };
    const sorted = [...SOUNDS].sort((a, b) => rank(a.id) - rank(b.id));
    for (const s of sorted) for (let v = 1; v <= s.variants; v++) if (this.files.has(soundFile(s.id, v))) this.queue.push([s.id, v]);
    // Грузим по нескольку файлов разом: полсотни одновременных декодирований подвесили бы телефон на старте.
    for (let i = 0; i < PARALLEL; i++) this.pump();
  }

  /**
   * Поднять звуки в начало очереди загрузки: они понадобятся вот-вот (гул места, в которое уносит следующая сцена).
   * Уже загруженные и грузящиеся не трогаются. До начала загрузки — меняет её порядок.
   */
  want(ids: readonly string[]): void {
    if (!this.loadingBegun) {
      this.order = [...ids, ...this.order.filter((id) => !ids.includes(id))];
      return;
    }
    const picked: [string, number][] = [];
    for (const id of ids) {
      for (let i = 0; i < this.queue.length; ) {
        if (this.queue[i]![0] === id) picked.push(...this.queue.splice(i, 1));
        else i += 1;
      }
    }
    this.queue.unshift(...picked);
  }

  /** Какие файлы ещё ждут своей загрузки, по порядку (для отладки и тестов). */
  queued(): string[] {
    return this.queue.map(([id, v]) => soundFile(id, v));
  }

  /**
   * Создать контекст воспроизведения. Вызывать из обработчика нажатия: браузеры (и особенно iOS)
   * дают звук только после жеста пользователя.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      // Звук и в беззвучном режиме iPhone, как у плеера (слова партнёра 17.11: «Да, звук нужен»): до первого звука.
      playThroughSilentSwitch();
      this.ctx = new Ctor();
      this.ctx.onstatechange = () => this.flush();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyMaster();
      this.beginLoad();
    }
    // «interrupted» бывает на iOS после звонка: будим так же, как после паузы.
    if (this.ctx.state !== 'running' && !this.paused) this.wake();
  }

  /** Запустить контекст; отказ (нажатие не засчитано как жест) не ошибка: следующее нажатие попробует снова. */
  private wake(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    void ctx.resume().then(
      () => this.flush(),
      () => undefined,
    );
  }

  /** Контекст пошёл: отыграть разовые звуки, которые его ждали и ещё не опоздали. */
  private flush(): void {
    if (this.ctx?.state !== 'running' || this.waiting.length === 0) return;
    const now = clockMs();
    for (const w of this.waiting.splice(0)) if (now <= w.until) this.start(w.def, w.buf, w.opts);
  }

  private pump(): void {
    const next = this.queue.shift();
    if (next) void this.load(next[0], next[1]).then(() => this.pump());
  }

  private load(id: string, variant: number): Promise<AudioBuffer | null> {
    const file = soundFile(id, variant);
    const known = this.loading.get(file);
    if (known) return known;
    const decoder = this.ctx ?? this.offline;
    if (!decoder || !this.files.has(file)) return Promise.resolve(null);
    const p = fetch(this.baseUrl + file)
      .then((r) => {
        // Сервер разработки на несуществующий файл отвечает страницей игры: проверяем тип.
        if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('audio')) throw new Error(String(r.status));
        return r.arrayBuffer();
      })
      // Форма с колбэками: старый Safari промис из decodeAudioData не возвращает.
      .then((data) => new Promise<AudioBuffer>((resolve, reject) => void decoder.decodeAudioData(data, resolve, reject)))
      .then((buf) => {
        this.buffers.set(file, buf);
        return buf;
      })
      .catch(() => {
        this.missing.add(file);
        return null;
      });
    this.loading.set(file, p);
    return p;
  }

  private applyMaster(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted || !this.enabled ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  /** Миг: звук обрывается разом и возвращается через seconds секунд (запись оборвалась). */
  cut(seconds: number): void {
    const ctx = this.ctx;
    const m = this.master;
    if (!ctx || !m) return;
    const now = ctx.currentTime;
    m.gain.cancelScheduledValues(now);
    m.gain.setValueAtTime(0, now);
    m.gain.setTargetAtTime(this.muted || !this.enabled ? 0 : 1, now + seconds, 0.35);
  }

  /** Выключатель звука игрока. */
  setMuted(on: boolean): void {
    this.muted = on;
    this.applyMaster();
  }

  /** Разрешён ли звук площадкой. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyMaster();
  }

  /** Пауза игры: звук останавливается целиком. */
  setPaused(on: boolean): void {
    this.paused = on;
    if (on) this.waiting.length = 0;
    if (!this.ctx) return;
    if (on && this.ctx.state === 'running') void this.ctx.suspend();
    else if (!on && this.ctx.state !== 'running') this.wake();
  }

  setListener(pos: Vec3, yaw: number): void {
    this.listener = pos;
    this.yaw = yaw;
  }

  private pickVariant(def: SoundDef): number {
    if (def.variants <= 1) return 1;
    // Свой счётчик вместо Math.random: порядок вариантов повторяем, подряд один и тот же не идёт.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    let v = 1 + (this.seed % def.variants);
    if (v === this.lastVariant.get(def.id)) v = 1 + (v % def.variants);
    this.lastVariant.set(def.id, v);
    return v;
  }

  /** Разовый звук. Если файл ещё не загружен или его нет — тишина (см. PlayOptions.late). */
  play(id: string, opts: PlayOptions = {}): void {
    const def = this.defs.get(id);
    const ctx = this.ctx;
    if (!def) throw new Error(`нет такого звука: ${id}`);
    this.asked.set(id, (this.asked.get(id) ?? 0) + 1);
    if (!ctx || !this.master) return;
    const variant = this.pickVariant(def);
    const buf = this.buffers.get(soundFile(id, variant));
    // До какого мига звук уместен: свой срок у тех, что нельзя проглотить (late), у остальных — пока запускается контекст.
    const until = clockMs() + 1000 * Math.max(opts.late ?? 0, START_GRACE);
    if (buf) {
      this.startOrWait(def, buf, opts, until);
      return;
    }
    if (!opts.late) return;
    // Файл ещё в пути: берём его вне очереди и играем, если успел.
    void this.load(id, variant).then((ready) => {
      if (ready && this.ctx === ctx) this.startOrWait(def, ready, opts, until);
    });
  }

  /** Сыграть сейчас, а если контекст ещё не пошёл (первое нажатие в Safari и на iOS) — как только пойдёт. */
  private startOrWait(def: SoundDef, buf: AudioBuffer, opts: PlayOptions, until: number): void {
    const ctx = this.ctx;
    if (!ctx || clockMs() > until) return;
    if (ctx.state === 'running') this.start(def, buf, opts);
    else if (!this.paused) this.waiting.push({ def, buf, opts, until });
  }

  private start(def: SoundDef, buf: AudioBuffer, opts: PlayOptions): void {
    const ctx = this.ctx!;
    this.played.set(def.id, (this.played.get(def.id) ?? 0) + 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    let volume = def.volume * (opts.volume ?? 1);
    let node: AudioNode = src;
    if (opts.pos) {
      const sp = spatialize(this.listener, this.yaw, opts.pos);
      volume *= sp.gain;
      // Дальний звук глуше: стены съедают верха.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000 - sp.muffle * 16500;
      node.connect(lp);
      node = lp;
      if (typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = sp.pan;
        node.connect(pan);
        node = pan;
      }
    }
    gain.gain.value = volume;
    node.connect(gain);
    gain.connect(this.master!);
    src.start();
  }

  /**
   * Петля: держать звук с громкостью gain (0 — затихнуть и остановиться). Вызывать каждый кадр
   * для всех петель, которые могут звучать. pos — откуда петля слышна (рой).
   */
  loop(id: string, gain: number, pos?: Vec3): void {
    const def = this.defs.get(id);
    const ctx = this.ctx;
    if (!def) throw new Error(`нет такого звука: ${id}`);
    if (!ctx || !this.master) return;
    let voice = this.loops.get(id);
    const sp = pos ? spatialize(this.listener, this.yaw, pos) : null;
    const target = def.volume * Math.max(0, gain) * (sp ? sp.gain : 1);
    const silent = target <= 0.001;
    if (!voice) {
      if (silent) return;
      const buf = this.buffers.get(soundFile(id, 1));
      if (!buf) return;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (pan) pan.connect(g);
      // Далёкая петля глуше, как разовый звук (start): стены съедают верха. Без этого песок Осыпи-приметы за стенкой
      // звучал так же ясно, как охота рядом (критика куратора 17.11).
      const lp = pos && typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null;
      if (lp) {
        lp.type = 'lowpass';
        lp.frequency.value = 18000 - (sp ? sp.muffle : 0) * 16500;
        lp.connect(pan ?? g);
      }
      g.connect(this.master);
      // Стык не длиннее 40 % файла: нарастание и спад одного прохода не должны встретиться.
      voice = { buf, live: new Set(), gain: g, pan, lp, target: 0, stopAt: null, nextAt: ctx.currentTime, xfade: Math.min(def.xfade ?? 0.1, buf.duration * 0.4) };
      this.loops.set(id, voice);
      this.played.set(id, (this.played.get(id) ?? 0) + 1);
      this.pass(voice, ctx.currentTime, true);
    }
    // Следующие проходы ставим заранее и точно по часам звука, а не по кадрам.
    for (let i = 0; i < 8 && voice.nextAt <= ctx.currentTime + LOOP_AHEAD; i++) this.pass(voice, Math.max(voice.nextAt, ctx.currentTime), false);
    if (sp && voice.pan) voice.pan.pan.setTargetAtTime(sp.pan, ctx.currentTime, 0.1);
    if (sp && voice.lp) voice.lp.frequency.setTargetAtTime(18000 - sp.muffle * 16500, ctx.currentTime, 0.1);
    if (Math.abs(target - voice.target) > 0.002 || (silent && voice.target !== 0)) {
      voice.target = silent ? 0 : target;
      voice.gain.gain.setTargetAtTime(voice.target, ctx.currentTime, LOOP_TAU);
    }
    // Затихшую петлю останавливаем, когда она отзвучала: по часам, а не по текущему значению
    // громкости — его не все браузеры отдают честно.
    if (!silent) voice.stopAt = null;
    else if (voice.stopAt === null) voice.stopAt = ctx.currentTime + LOOP_TAU * 5;
    else if (ctx.currentTime >= voice.stopAt) this.dropLoop(id, voice);
  }

  /**
   * Один проход петли. Файл играется целиком, а его конец перетекает в начало следующего прохода:
   * петля выходит бесшовной, даже если сам файл не зациклен или кодек добавил тишину по краям.
   */
  private pass(v: LoopVoice, when: number, first: boolean): void {
    const ctx = this.ctx!;
    const d = v.buf.duration;
    const src = ctx.createBufferSource();
    src.buffer = v.buf;
    const g = ctx.createGain();
    // Первый проход начинается сразу (петлю и так вводит общая громкость), остальные — нарастают.
    g.gain.value = first ? 1 : 0;
    if (!first) g.gain.setValueCurveAtTime(FADE_IN, when, v.xfade);
    g.gain.setValueCurveAtTime(FADE_OUT, when + d - v.xfade, v.xfade);
    src.connect(g);
    g.connect(v.lp ?? v.pan ?? v.gain);
    src.onended = () => {
      g.disconnect();
      v.live.delete(src);
    };
    src.start(when);
    src.stop(when + d);
    v.live.add(src);
    v.nextAt = when + d - v.xfade;
  }

  private dropLoop(id: string, v: LoopVoice): void {
    for (const src of v.live) {
      src.onended = null;
      src.stop();
      src.disconnect();
    }
    v.live.clear();
    v.pan?.disconnect();
    v.gain.disconnect();
    this.loops.delete(id);
  }

  /** Какие петли сейчас звучат. */
  activeLoops(): string[] {
    return [...this.loops.keys()];
  }

  /** Оборвать петли (конец вылазки, смена экрана); keep — id петли, которую не трогать. */
  stopLoops(keep?: string): void {
    for (const [id, v] of [...this.loops]) if (id !== keep) this.dropLoop(id, v);
  }
}
