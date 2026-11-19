/**
 * Разметка аналитики Untitled Session для Playgama. Таблица событий — docs/vylazka/playgama.md, «События».
 * Всё уходит через IPlatform.track: на Playgama — lifecycle-сообщения площадки и bridge.analytics.send,
 * вне её — только отладочная строка dev-сборки.
 *
 * Правила (вики Bridge, Analytics; руководство Playgama по телеметрии):
 *   - имена короткие и постоянные, snake_case; меняющееся — в данных, не в имени;
 *   - значения из конечных списков: место, круг, ступень, номер сессии (до 99), id воспоминания, причина
 *     скачка. Сида, текста, адресов, сообщений ошибок и стеков в событиях нет;
 *   - личных данных нет никаких: ни id игрока, ни имени, ни языка браузера;
 *   - покадровых событий нет: performance_sample — одна сводка за ~30 с игры (analytics/perf.ts);
 *   - что Bridge пишет сам, не дублируем: инициализацию, game_ready с временем загрузки (time_s),
 *     lifecycle-сообщения level_* (world, level), сессию площадки, рекламу с местом показа, покупки.
 * Сессия игры — «уровень» для площадки: level_started/level_completed с world = место, level = номер сессии.
 * Подробности сессии, которых у lifecycle-сообщений нет (ступень, круг, итог), — в progression_started и
 * progression_completed.
 */
import { BUILD_VERSION } from '../core/build';
import type { StepEvents } from '../game';
import type { Lifecycle } from '../lifecycle';
import type { IPlatform, TrackData } from '../platform/types';
import { PerfWindow } from './perf';
import type { PerfCounter, PerfSample } from './perf';

/** Lifecycle-сообщения площадки (Bridge пишет их в аналитику сам). */
export const LIFECYCLE_MESSAGES = ['level_started', 'level_completed', 'level_paused', 'level_resumed'] as const;
/** События аналитики игры: всё, что знает только она. */
export const ANALYTICS_EVENTS = [
  'first_input',
  'progression_started',
  'progression_completed',
  'memory_recalled',
  'caught',
  'jump',
  'pocket_used',
  'place_erased',
  'hint_shown',
  'settings_changed',
  'webgl_status',
  'performance_sample',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Что приложение знает о текущей игре (app.ts, playContext). */
export interface PlayContext {
  /** Место: shelter | office | yellow | station. */
  world: string;
  /** Сколько кругов этого места уже пройдено. */
  laps: number;
  /** Ступень погружения 0–4 (game.ts, STAGE_ALL). */
  stage: number;
  /** Номер сессии: сколько начато, считая эту. */
  n: number;
  /** Сон из сцен (прототип #scenes). */
  scenes: boolean;
  /** Просмотр без сессии (?level=test, show, pocket_…): событий сессии нет. */
  test: boolean;
  /** Качество картинки: low | med | high | ultra. */
  quality: string;
  /** Время кадра высокого качества в замере при запуске, мс (−1 или нет — замера не было: качество из адреса или выбор игрока). */
  probeMs?: number;
  /** Настройки игрока из профиля; их смена — settings_changed. */
  settings: Readonly<Record<string, string | number | boolean>>;
}

export type InputKind = 'mouse' | 'touch' | 'pen' | 'key';
export type WebglStatus = 'unavailable' | 'lost' | 'restored';

/** Скачки, которые событием jump не считаются: смена сессий — это progression_*, поимка — caught. */
const NOT_JUMPS: ReadonlySet<string> = new Set(['end', 'begin', 'caught']);
/** Номер сессии, круг: ограничены, чтобы значения оставались конечным списком. */
const cap = (x: number, max = 99): number => Math.max(0, Math.min(max, Math.floor(x)));

interface SessionStats {
  world: string;
  lap: number;
  stage: number;
  n: number;
  mode: 'loop' | 'scenes';
  /** Начало и накопленная пауза, мс по часам страницы; pauseAt — с какого момента стоит (−1 — идёт). */
  started: number;
  pausedMs: number;
  pauseAt: number;
  recalled: number;
  caught: number;
  jumps: number;
  pockets: number;
  /** level_paused отправлен, level_resumed ещё нет. */
  pausedSent: boolean;
}

export class Analytics {
  readonly perf = new PerfWindow();
  private session: SessionStats | null = null;
  private readyAt = -1;
  private inputSeen = false;
  private dropInput: (() => void) | null = null;
  private settings: Record<string, string | number | boolean> | null = null;
  private quality = '';

  constructor(
    private readonly platform: Pick<IPlatform, 'track'>,
    private readonly lifecycle: Pick<Lifecycle, 'paused' | 'onChange'>,
    private readonly ctx: () => PlayContext,
    private readonly now: () => number = () => performance.now(),
  ) {
    lifecycle.onChange((paused) => this.pauseChanged(paused));
    // Ошибки страницы — только счётчиком в сводке производительности: без сообщений и стеков.
    if (typeof window !== 'undefined') {
      window.addEventListener('error', () => this.perf.count('js_error_count'));
      window.addEventListener('unhandledrejection', () => this.perf.count('unhandled_rejection_count'));
    }
  }

  /** Первый играбельный кадр, game_ready уже ушёл: ждём первого нажатия и начинаем мерить кадры. */
  ready(): void {
    if (this.readyAt >= 0) return;
    this.readyAt = this.now();
    const c = this.ctx();
    this.settings = { ...c.settings };
    this.quality = c.quality;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onPointer = (e: PointerEvent): void => this.input(e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse');
    const onKey = (): void => this.input('key');
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true, passive: true });
    this.dropInput = () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
    document.addEventListener('visibilitychange', () => this.perf.gap());
    requestAnimationFrame(this.tick);
  }

  /** Первое нажатие после game_ready — шаг воронки «загрузилось → начал играть». */
  input(kind: InputKind): void {
    if (this.inputSeen || this.readyAt < 0) return;
    this.inputSeen = true;
    this.dropInput?.();
    this.dropInput = null;
    this.send('first_input', { ms: cap(Math.round((this.now() - this.readyAt) / 100) * 100, 600_000), input: kind });
  }

  /** Началась сессия (заставка → игра или лимбо → следующая). */
  sessionStarted(): void {
    const c = this.ctx();
    if (c.test) return;
    const t = this.now();
    const s: SessionStats = {
      world: c.world,
      lap: cap(c.laps + 1),
      stage: c.stage,
      n: cap(c.n),
      mode: c.scenes ? 'scenes' : 'loop',
      started: t,
      pausedMs: 0,
      pauseAt: this.lifecycle.paused ? t : -1,
      recalled: 0,
      caught: 0,
      jumps: 0,
      pockets: 0,
      pausedSent: false,
    };
    this.session = s;
    this.platform.track('level_started', { world: s.world, level: s.n });
    this.send('progression_started', { step_id: s.world, step_index: s.n, stage: s.stage, lap: s.lap, mode: s.mode });
  }

  /** Сессия кончилась, игрок в лимбо. */
  sessionCompleted(): void {
    const s = this.session;
    if (!s) return;
    const duration = this.elapsed(s);
    this.session = null;
    this.platform.track('level_completed', { world: s.world, level: s.n });
    this.send('progression_completed', {
      step_id: s.world,
      step_index: s.n,
      stage: s.stage,
      lap: s.lap,
      mode: s.mode,
      duration_s: duration,
      memories: s.recalled,
      caught: s.caught,
      jumps: s.jumps,
      pockets: s.pockets,
    });
    const sample = this.perf.flush(this.now());
    if (sample) this.sendPerf(sample);
  }

  /** События шага игры: вспомненное, поимка, скачки, карманные пространства. */
  onStep(ev: Pick<StepEvents, 'session' | 'fear' | 'dream'>): void {
    const s = this.session;
    if (!s) return;
    for (const e of ev.session) {
      if (e.type !== 'recall') continue;
      s.recalled += 1;
      const c = this.ctx();
      this.send('memory_recalled', { memory_id: e.memory.def.id, tier: e.memory.spot?.tier ?? 0, k: s.recalled, world: c.world, lap: cap(c.laps + 1), stage: c.stage, t_s: this.elapsed(s) });
    }
    for (const e of ev.fear) {
      if (e.type !== 'swarm' || e.what !== 'caught') continue;
      s.caught += 1;
      const c = this.ctx();
      this.send('caught', { world: c.world, lap: cap(c.laps + 1), stage: c.stage, k: s.recalled, t_s: this.elapsed(s) });
    }
    for (const e of ev.dream) {
      if (e.type === 'jump' && e.phase === 'switch' && !NOT_JUMPS.has(e.plan.cause) && e.plan.to !== 'limbo' && e.plan.to !== 'session') {
        s.jumps += 1;
        if (e.plan.to !== 'elsewhere') s.pockets += 1;
        this.send('jump', { cause: e.plan.cause, to: e.plan.to, world: this.ctx().world });
      } else if (e.type === 'pocket' && e.what !== 'enter') this.send('pocket_used', { kind: e.kind, what: e.what });
    }
  }

  /** Место стёрто до конца — миг (app.ts, moment). */
  placeErased(): void {
    const c = this.ctx();
    if (c.test) return;
    this.send('place_erased', { world: c.world, laps: cap(c.laps), n: cap(c.n) });
  }

  /** Показана подсказка обучения (id из конечного списка app.ts, teach). Подсказка «dark» — игрок застрял. */
  hint(id: string): void {
    const s = this.session;
    if (!s) return;
    this.send('hint_shown', { id, world: this.ctx().world, t_s: this.elapsed(s) });
  }

  /** Профиль записан: какие настройки игрока поменялись с прошлого раза — по событию на каждую. */
  saved(): void {
    // До game_ready настройки не «меняют», а читают из профиля.
    if (!this.settings) return;
    const next = this.ctx().settings;
    for (const [setting, value] of Object.entries(next)) if (this.settings[setting] !== value) this.send('settings_changed', { setting, value });
    this.settings = { ...next };
  }

  /** Качество картинки сменилось: игроком (auto = false) или само, когда кадров мало (auto = true). */
  qualityChanged(q: string, auto: boolean): void {
    const was = this.quality;
    this.quality = q;
    if (this.readyAt < 0 || q === was) return;
    this.send('settings_changed', { setting: 'quality', value: q, auto });
  }

  /** WebGL: недоступен на старте, контекст потерян, восстановлен. */
  webgl(status: WebglStatus): void {
    if (status === 'lost') this.perf.count('webgl_context_loss_count');
    this.send('webgl_status', { status });
  }

  /** Счётчик для сводки производительности (для проверок и ошибок, пойманных игрой). */
  count(what: PerfCounter): void {
    this.perf.count(what);
  }

  /** Идёт игра: сессия, без паузы, вкладка видна. Только тогда считаются кадры. */
  get playing(): boolean {
    return this.session !== null && !this.lifecycle.paused && !(typeof document !== 'undefined' && document.hidden);
  }

  /** Кадр страницы (свой requestAnimationFrame: в цикл игры не встраиваемся). */
  frame(t: number): void {
    const sample = this.perf.frame(t, this.playing);
    if (sample) this.sendPerf(sample);
  }

  private readonly tick = (t: number): void => {
    requestAnimationFrame(this.tick);
    this.frame(t);
  };

  private pauseChanged(paused: boolean): void {
    if (paused) this.perf.gap();
    const s = this.session;
    if (!s) return;
    const t = this.now();
    if (paused) {
      if (s.pauseAt < 0) s.pauseAt = t;
      if (!s.pausedSent) {
        s.pausedSent = true;
        this.platform.track('level_paused', { world: s.world, level: s.n });
      }
    } else {
      if (s.pauseAt >= 0) s.pausedMs += t - s.pauseAt;
      s.pauseAt = -1;
      if (s.pausedSent) {
        s.pausedSent = false;
        this.platform.track('level_resumed', { world: s.world, level: s.n });
      }
    }
  }

  /** Сколько сессия идёт без пауз, с. */
  private elapsed(s: SessionStats): number {
    const t = this.now();
    const paused = s.pausedMs + (s.pauseAt >= 0 ? t - s.pauseAt : 0);
    return Math.max(0, Math.round((t - s.started - paused) / 1000));
  }

  /**
   * Единственное место, через которое уходит performance_sample: когда у Bridge появятся системные события,
   * меняется только транспорт здесь, имя и поля остаются (руководство Playgama по телеметрии).
   */
  private sendPerf(sample: PerfSample): void {
    const c = this.ctx();
    const data: TrackData = { ...sample, build_version: BUILD_VERSION, quality: c.quality };
    if (c.probeMs !== undefined && c.probeMs >= 0) data.probe_ms = Math.round(c.probeMs * 10) / 10;
    this.send('performance_sample', data);
  }

  private send(event: AnalyticsEvent, data: TrackData): void {
    this.platform.track(event, data);
  }
}
