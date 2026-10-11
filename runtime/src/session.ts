/**
 * Session — контроллер партии без DOM: цикл «выполнить шаги → показать → дождаться игрока →
 * ответить интерпретатору», автосейвы, прочитанное, журнал реплик, откат, реклама на границах
 * блоков, отмена при загрузке. Всё взаимодействие с экраном идёт через порты (SessionUI,
 * Director, IPlatform), поэтому полный проход эпизода проверяется тестами без браузера.
 */
import { runAutoplay } from './core/autoplay';
import type { AutoplayPolicy, AutoplayReport } from './core/autoplay';
import { t } from './core/i18n';
import { Interpreter } from './core/interpreter';
import { prepareLoad, SAVE_SCHEMA_VERSION } from './core/saves';
import type { SaveFile, SaveManager } from './core/saves';
import type {
  ChoicePending,
  DocumentPending,
  EndPending,
  Ending,
  EngineEvent,
  Episode,
  GameState,
  HoldPending,
  LinePending,
  MinigamePending,
  MinigameResult,
  NarrateStyle,
  Pending,
  Snapshot,
} from './core/types';
import type { IPlatform } from './platform/types';
import type { Director } from './stage/director';

// ───────────────────────────── порт интерфейса ─────────────────────────────

export interface BaseContext {
  /** Срабатывает, когда партию отменили (загрузка, откат, выход): интерфейс должен всё закрыть. */
  signal: AbortSignal;
}
export interface LineContext extends BaseContext {
  /** Реплика уже была прочитана (Skip «только прочитанное»). */
  read: boolean;
}
export interface HoldContext extends BaseContext {
  instant: boolean;
}
export interface MinigameContext extends BaseContext {
  /** Сохранённое состояние мини-игры (IMinigame.restore) при загрузке сейва. */
  restore: unknown;
  /** Запросить автосейв после «хода» внутри мини-игры. */
  autosave: () => void;
}

export interface SessionUI {
  /** Включён Skip: сцена применяется мгновенно, паузы пропускаются. */
  readonly fastForward: boolean;
  showLine(p: LinePending, ctx: LineContext): Promise<void>;
  /** Возвращает id выбранной опции (в том числе default_option по таймеру). */
  showChoice(p: ChoicePending, ctx: BaseContext): Promise<string>;
  hold(p: HoldPending, ctx: HoldContext): Promise<void>;
  showDocument(p: DocumentPending, ctx: BaseContext): Promise<void>;
  runMinigame(p: MinigamePending, ctx: MinigameContext): Promise<MinigameResult>;
  showEnding(p: EndPending, state: Readonly<GameState>, ctx: BaseContext): Promise<void>;
  /** Состояние активной мини-игры для сейва, если она открыта. */
  minigameState(): { id: string; state: unknown } | null;
  /** Закрыть все окна/выборы/мини-игру (отмена партии). */
  reset(): void;
  setPaused(paused: boolean): void;
}

// ───────────────────────────── типы сессии ─────────────────────────────

export type RunOutcome =
  | { reason: 'ended'; ending: Ending }
  | { reason: 'cancelled' }
  | { reason: 'rejected'; detail: string };

export interface LogEntry {
  kind: 'say' | 'narrate';
  who: string | null;
  key: string;
  narrate_style: NarrateStyle | null;
}

export interface SessionDeps {
  episode: Episode;
  contentVersion: string;
  platform: IPlatform;
  saves: SaveManager;
  ui: SessionUI;
  director: Director;
  warn?: (message: string) => void;
  /** Партия дошла до концовки и игрок закрыл экран финала. */
  onEnded?: (ending: Ending) => void;
  /** Ошибка контента/движка в цикле партии. Без обработчика исключение пробрасывается. */
  onError?: (error: unknown) => void;
}

/** Сколько реплик назад можно откатиться (docs/architecture/06 §7). */
export const ROLLBACK_LIMIT = 30;

class RunCancelled extends Error {
  constructor() {
    super('run cancelled');
    this.name = 'RunCancelled';
  }
}

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RunCancelled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new RunCancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

interface HistoryEntry {
  snap: Snapshot;
  logLength: number;
}

export class Session {
  readonly interp: Interpreter;
  readonly log: LogEntry[] = [];

  private readonly d: SessionDeps;
  private abort: AbortController | null = null;
  private runId = 0;
  private history: HistoryEntry[] = [];
  private restoreMg: { id: string; state: unknown } | null = null;
  private autoplaying = false;

  constructor(deps: SessionDeps) {
    this.d = deps;
    // Длина реплики на текущем языке — монтажёру для реакции слушающего на длинной реплике (core/editor.ts).
    this.interp = new Interpreter(deps.episode, { ...(deps.warn ? { warn: deps.warn } : {}), lineLength: (key) => t(key).length });
  }

  get episode(): Episode {
    return this.d.episode;
  }

  get running(): boolean {
    return this.abort !== null && !this.abort.signal.aborted;
  }

  get pending(): Pending | null {
    return this.interp.started ? this.interp.pending : null;
  }

  get canRollback(): boolean {
    return this.rollbackDepth >= 1;
  }

  private get instant(): boolean {
    return this.autoplaying || this.d.ui.fastForward;
  }

  // ───────────────────────────── запуск партии ─────────────────────────────

  /** Новая партия с начала эпизода. */
  newGame(): Promise<RunOutcome> {
    return this.launch(() => this.beginNew());
  }

  private beginNew(): void {
    this.log.length = 0;
    this.history = [];
    this.restoreMg = null;
    this.d.director.reset(null);
    // Сквозные переменные сезона переходят между эпизодами; первый эпизод всегда начинает с умолчаний.
    const carried = this.d.episode.order > 1 ? this.d.saves.profile.globals : {};
    this.interp.start(carried);
    this.d.platform.track('level_started', this.levelData());
  }

  /** Продолжить из сейва (автосейв, быстрый сейв, слот). */
  loadSave(file: SaveFile): Promise<RunOutcome> {
    const res = prepareLoad(file, this.d.episode, this.d.contentVersion);
    if (!res.ok) return Promise.resolve({ reason: 'rejected', detail: res.reason });
    for (const note of res.notes) this.d.warn?.(`сейв: ${note}`);
    return this.launch(() => {
      this.log.length = 0;
      this.history = [];
      this.restoreMg = res.mg;
      this.interp.restore(res.snapshot);
      this.d.director.reset(res.snapshot.view);
    });
  }

  /** Отладка: перейти в сцену (window.__vn.goto). */
  jumpTo(sceneId: string): Promise<RunOutcome> {
    return this.launch(() => {
      this.d.director.reset(null);
      this.interp.jumpTo(sceneId);
    });
  }

  /** На сколько реплик назад можно откатиться сейчас. */
  get rollbackDepth(): number {
    return Math.max(0, this.history.length - 1);
  }

  /** Откат на `steps` реплик назад (≤ ROLLBACK_LIMIT). null — столько истории нет. */
  rollback(steps = 1): Promise<RunOutcome> | null {
    if (!Number.isInteger(steps) || steps < 1 || steps > this.rollbackDepth) return null;
    this.history.pop(); // текущая реплика
    let target: HistoryEntry | undefined;
    for (let i = 0; i < steps; i++) target = this.history.pop();
    if (!target) return null;
    const snap = target.snap;
    const logLength = target.logLength;
    return this.launch(
      () => {
        this.log.length = logLength;
        this.restoreMg = null;
        this.interp.restore(snap);
        this.d.director.reset(snap.view);
      },
      { keepHistory: true },
    );
  }

  /** Остановить цикл и закрыть окна интерфейса. */
  cancel(): void {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.d.ui.reset();
  }

  private launch(init: () => void, opts: { keepHistory?: boolean } = {}): Promise<RunOutcome> {
    this.cancel();
    const id = ++this.runId;
    const ac = new AbortController();
    this.abort = ac;
    if (!opts.keepHistory) this.history = [];
    try {
      init();
    } catch (e) {
      this.abort = null;
      return this.fail(e);
    }
    return this.loop(id, ac.signal);
  }

  private fail(e: unknown): Promise<RunOutcome> {
    if (this.d.onError) {
      this.d.onError(e);
      return Promise.resolve({ reason: 'cancelled' });
    }
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }

  // ───────────────────────────── основной цикл ─────────────────────────────

  private async loop(runId: number, signal: AbortSignal): Promise<RunOutcome> {
    const alive = (): boolean => !signal.aborted && runId === this.runId;
    const cancelled: RunOutcome = { reason: 'cancelled' };
    const { director, ui, platform, saves } = this.d;
    const epId = this.d.episode.id;

    try {
      for (;;) {
        const result = this.interp.pump();
        await director.present(result, { instant: this.instant, cancelled: () => !alive() });
        if (!alive()) return cancelled;
        const p = result.pending;

        switch (p.kind) {
          case 'line': {
            this.pushHistory();
            this.log.push({ kind: p.style, who: p.who, key: p.key, narrate_style: p.narrate_style });
            await abortable(ui.showLine(p, { signal, read: saves.isRead(epId, p.key) }), signal);
            if (!alive()) return cancelled;
            saves.markRead(epId, p.key);
            this.interp.continue();
            break;
          }
          case 'hold': {
            await abortable(ui.hold(p, { signal, instant: this.instant }), signal);
            if (!alive()) return cancelled;
            this.interp.continue();
            break;
          }
          case 'document': {
            await abortable(ui.showDocument(p, { signal }), signal);
            if (!alive()) return cancelled;
            this.interp.continue();
            break;
          }
          case 'ad_break': {
            // Реклама — только здесь, на границе блока с ad_break_allowed. Экран уже погашен
            // Director'ом и удерживается чёрным; проявление — строго после continue().
            const shown = await abortable(platform.showInterstitial('block_break'), signal);
            if (!alive()) return cancelled;
            platform.track('ad_break', { block: p.block, shown });
            this.interp.continue();
            await director.release({ instant: this.instant, cancelled: () => !alive() });
            if (!alive()) return cancelled;
            break;
          }
          case 'choice': {
            const optionId = await abortable(ui.showChoice(p, { signal }), signal);
            if (!alive()) return cancelled;
            this.interp.choose(optionId);
            // Дедуктивная развилка: вердикт хода и число ошибок в ней (у неверного — с учётом этого хода).
            const verdict = p.deduction ? p.options.find((o) => o.id === optionId)?.verdict : null;
            platform.track('choice', {
              id: p.id,
              option: optionId,
              ...(verdict ? { verdict, fails: this.interp.state.deductions[p.id]?.fails ?? 0 } : {}),
            });
            break;
          }
          case 'minigame': {
            const def = p.def;
            const restore = this.restoreMg && this.restoreMg.id === def.id ? this.restoreMg.state : undefined;
            this.restoreMg = null;
            platform.track('minigame_start', { id: def.id, type: def.type });
            const outcome = await abortable(
              ui.runMinigame(p, { signal, restore, autosave: () => this.autosave('minigame_move') }),
              signal,
            );
            if (!alive()) return cancelled;
            const r = this.interp.finishMinigame(outcome);
            platform.track(outcome === 'skipped' ? 'minigame_skip' : 'minigame_finish', {
              id: def.id,
              type: def.type,
              result: outcome,
              counted: r.counted,
            });
            break;
          }
          case 'end': {
            this.finishEpisode(p);
            await abortable(ui.showEnding(p, this.interp.state, { signal }), signal);
            if (!alive()) return cancelled;
            this.d.onEnded?.(p.ending);
            return { reason: 'ended', ending: p.ending };
          }
        }
      }
    } catch (e) {
      if (e instanceof RunCancelled) return cancelled;
      if (!alive()) return cancelled;
      return this.fail(e);
    }
  }

  private levelData(): { world: string; level: string } {
    const ep = this.d.episode;
    return { world: `s${ep.season}`, level: ep.id.split('_')[0] ?? ep.id };
  }

  private finishEpisode(p: EndPending): void {
    const { saves, platform, episode } = this.d;
    const state = this.interp.state;
    saves.recordEnding(episode.id, p.ending.id);
    saves.setGlobals(state.globals);
    for (const item of state.archive) saves.unlockArchive(episode.id, item);
    saves.clearAutosave();
    void saves.flush();
    platform.track('level_completed', this.levelData());
    platform.track('ending_reached', { ending: p.ending.id, kind: p.ending.kind });
  }

  private pushHistory(): void {
    this.history.push({ snap: this.interp.snapshot(), logLength: this.log.length });
    if (this.history.length > ROLLBACK_LIMIT + 1) this.history.shift();
  }

  // ───────────────────────────── сейвы ─────────────────────────────

  makeSaveFile(): SaveFile {
    const snap = this.interp.snapshot();
    const mg = this.d.ui.minigameState();
    return {
      schema_version: SAVE_SCHEMA_VERSION,
      content_version: this.d.contentVersion,
      saved_at: new Date().toISOString(),
      state: snap.state,
      view: snap.view,
      ...(mg ? { mg } : {}),
    };
  }

  /** Автосейв: границы блоков, после выбора, внутри мини-игры, при паузе. */
  autosave(_reason: string): void {
    if (!this.interp.started || this.interp.isEnded || this.autoplaying) return;
    this.d.saves.writeAutosave(this.makeSaveFile());
  }

  quickSave(): void {
    if (!this.interp.started || this.interp.isEnded) return;
    this.d.saves.writeQuicksave(this.makeSaveFile());
  }

  /** Ручное сохранение в слот n (на платформе без слотов, как Playgama, это единственный слот 1). */
  async saveToSlot(n: number): Promise<void> {
    if (!this.interp.started || this.interp.isEnded) return;
    await this.d.saves.writeManual(n, this.makeSaveFile());
  }

  /** Пауза платформы/вкладки: останавливает таймеры интерфейса и сохраняет прогресс. */
  setPaused(paused: boolean): void {
    this.d.ui.setPaused(paused);
    if (paused) {
      this.autosave('pause');
      void this.d.saves.flush();
    }
  }

  // ───────────────────────────── автопилот ─────────────────────────────

  /**
   * Прогнать партию политикой до концовки (window.__vn.autoplay). Интерфейс не участвует:
   * интерпретатор ведёт автопилот, затем кадр и экран финала синхронизируются.
   */
  async autoplay(policy: AutoplayPolicy = 'first'): Promise<AutoplayReport> {
    this.cancel();
    this.autoplaying = true;
    try {
      if (!this.interp.started) this.beginNew();
      const report = runAutoplay(this.interp, policy, { onEvents: (evs) => this.harvest(evs) });
      this.d.director.reset(this.interp.view);
      return report;
    } finally {
      this.autoplaying = false;
      // Продолжить цикл с того места, где остановился автопилот (обычно — экран финала).
      void this.launch(() => undefined, { keepHistory: false }).catch(() => undefined);
    }
  }

  private harvest(events: readonly EngineEvent[]): void {
    for (const ev of events) {
      if (ev.t === 'archive') this.d.saves.unlockArchive(this.d.episode.id, ev.item);
    }
  }
}
