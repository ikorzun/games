/**
 * Интерпретатор шагов эпизода (docs/architecture/06-engine-and-pipeline.md §5).
 *
 * Один `switch` по `step.do`; сцена исполняется до терминального шага; переходы между
 * сценами — только через jump / branch / choice / minigame.outcomes / end.
 * Условия `when` вычисляются грамматикой expr.ts (порт tools/vnexpr.py).
 *
 * Интерпретатор — «тянущий» и детерминированный, без таймеров, DOM и промисов:
 *
 *   const { events, pending } = interp.pump();   // выполнить неблокирующие шаги до ожидания
 *   … показать events, затем pending …
 *   interp.continue() | interp.choose(id) | interp.finishMinigame(result);
 *
 * Поэтому один и тот же код ведёт игру в браузере, автопилот `window.__vn.autoplay` и
 * тесты, которые обходят весь граф эпизода. Всё, что видно на сцене, хранится в `view`
 * (сериализуемый снимок), а не в графике: так работают сейвы и откат.
 */
import { EMPTY_CTX, LONG_LINE_CHARS, ShotIndex, afterHide, beatOf, choiceShot, entryShot, explicitShot, lineShot, listenerOf } from './editor';
import type { ShotPick } from './editor';
import { evalCondition } from './expr';
import { applyEffects, cloneJson, createInitialState, envOf, getVariable, setVariable } from './state';
import { STAGE_FILTERS } from './types';
import type {
  AdBreakPending,
  ArchiveItem,
  Block,
  CaptionStyle,
  Character,
  ChoiceOption,
  ChoiceOptionView,
  ChoicePending,
  ChoiceStep,
  DeductionMeter,
  DocumentPending,
  Effect,
  Ending,
  EngineEvent,
  Episode,
  FxKind,
  GameState,
  HoldPending,
  LinePending,
  MinigameDef,
  MinigameOutcomeKind,
  MinigameResult,
  NarrateStep,
  NarrateStyle,
  Outcome,
  Pending,
  PumpResult,
  SayStep,
  Scene,
  Snapshot,
  SpriteView,
  StageFilter,
  Step,
  TransitionKind,
  Value,
  ViewState,
} from './types';

function isOffscreenPos(position: SpriteView['position'] | undefined): boolean {
  return position === 'offscreen_left' || position === 'offscreen_right';
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Титры, которые висят поверх сцены и не останавливают сценарий. */
const OVERLAY_CAPTIONS: ReadonlySet<CaptionStyle> = new Set<CaptionStyle>(['date_stamp', 'location', 'lower_third']);

export const DEFAULT_CAPTION_HOLD_MS: Readonly<Record<CaptionStyle, number>> = {
  date_stamp: 3500,
  location: 3500,
  lower_third: 4500,
  chapter: 3500,
  fact: 4000,
};

export const DEFAULT_FX_MS: Readonly<Record<FxKind, number>> = {
  fade_out: 700,
  fade_in: 700,
  flash: 250,
  shake: 500,
  vhs_glitch: 500,
  tracking_noise: 900,
  freeze_frame: 1200,
  zoom_in: 1200,
  slow_motion: 1500,
  black_hold: 1000,
  static_tv: 800,
  rewind: 900,
};

/** Предохранитель от бесконечных неблокирующих циклов (например, jump сам в себя). */
const MAX_NONBLOCKING_STEPS = 5000;

/** Дедуктивная развилка: после стольких неверных ходов верные опции подсвечиваются (schema: hint_after). */
export const DEFAULT_HINT_AFTER = 2;

/**
 * Кадр сцены «с нуля»: фон/фильтр/letterbox из scene.stage, без спрайтов и CG, музыка и эмбиент
 * сцены (или блока). Нужен при загрузке сейва без снимка кадра и как база для входа в сцену.
 */
export function defaultViewFor(episode: Episode, sceneId: string): ViewState {
  const scene = episode.scenes[sceneId];
  if (!scene) throw new EngineError(`неизвестная сцена: ${sceneId}`);
  const block = episode.blocks.find((b) => b.id === scene.block);
  if (!block) throw new EngineError(`сцена ${sceneId}: неизвестный блок ${scene.block}`);
  const st = scene.stage;
  return {
    scene: scene.id,
    block: block.id,
    presentation: block.presentation,
    bg: st.bg,
    filter: st.filter ?? null,
    time_of_day: st.time_of_day ?? null,
    weather: st.weather ?? null,
    letterbox: st.letterbox ?? false,
    sprites: [],
    cg: null,
    cg_hide_after: true,
    coverage: scene.coverage ?? null,
    shot: null,
    shot_ctx: null,
    music: scene.music ?? block.music ?? null,
    ambient: scene.ambient ?? null,
    speaker: null,
  };
}

export interface InterpreterOptions {
  /** Глобальные переменные сезона, перенесённые из предыдущих эпизодов. */
  carriedGlobals?: Readonly<Record<string, Value>>;
  /** Приёмник некритичных замечаний о контенте (по умолчанию — console.warn). */
  warn?: (message: string) => void;
  /**
   * Длина текста реплики (знаков) на текущем языке — для правила «длинная реплика → реакция слушающего»
   * монтажёра (core/editor.ts). Без неё длинных реплик нет.
   */
  lineLength?: (key: string) => number;
}

export interface MinigameResolution {
  /** Что сообщила мини-игра. */
  result: MinigameResult;
  /** Во что результат превратился после skip_counts_as и запасных исходов. */
  counted: MinigameOutcomeKind;
  goto: string;
}

export class Interpreter {
  readonly episode: Episode;

  private readonly warn: (message: string) => void;
  private readonly carriedGlobals: Readonly<Record<string, Value>>;
  private readonly scenes: Readonly<Record<string, Scene>>;
  private readonly blocks = new Map<string, Block>();
  private readonly blockList: readonly Block[];
  private readonly cast = new Map<string, Character>();
  private readonly minigames: Readonly<Record<string, MinigameDef>>;
  private readonly endings = new Map<string, Ending>();
  private readonly archiveIds = new Set<string>();
  private readonly archiveItems = new Map<string, ArchiveItem>();
  /** Кадры покрытия и монтажёр (docs/architecture/08-shot-grammar.md). */
  private readonly shots: ShotIndex;
  private readonly pov: string | null;
  private readonly lineLength: (key: string) => number;
  private readonly sceneCasts = new Map<string, string[]>();

  private _state: GameState | null = null;
  private _view: ViewState | null = null;
  private queue: EngineEvent[] = [];
  private current: Pending | null = null;
  private adBlock: string | null = null;
  private ended = false;

  constructor(episode: Episode, options: InterpreterOptions = {}) {
    this.episode = episode;
    this.carriedGlobals = options.carriedGlobals ?? {};
    this.warn = options.warn ?? ((m) => console.warn(`[engine] ${m}`));
    this.scenes = episode.scenes;
    this.blockList = episode.blocks;
    for (const b of episode.blocks) this.blocks.set(b.id, b);
    for (const c of episode.cast) this.cast.set(c.id, c);
    this.minigames = episode.minigames ?? {};
    for (const e of episode.endings) this.endings.set(e.id, e);
    for (const a of episode.archive_items ?? []) {
      this.archiveIds.add(a.id);
      this.archiveItems.set(a.id, a);
    }
    this.shots = new ShotIndex(episode.assets?.shots ?? []);
    this.pov = episode.frame.player_character ?? null;
    this.lineLength = options.lineLength ?? (() => 0);
  }

  // ───────────────────────────── доступ к состоянию ─────────────────────────────

  get state(): GameState {
    if (!this._state) throw new EngineError('интерпретатор не запущен: вызовите start() или restore()');
    return this._state;
  }

  get view(): ViewState {
    if (!this._view) throw new EngineError('интерпретатор не запущен: вызовите start() или restore()');
    return this._view;
  }

  get started(): boolean {
    return this._state !== null;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  get pending(): Pending | null {
    return this.current;
  }

  character(id: string): Character | undefined {
    return this.cast.get(id);
  }

  scene(id: string): Scene | undefined {
    return this.scenes[id];
  }

  block(id: string): Block | undefined {
    return this.blocks.get(id);
  }

  /** Переменные эпизода + глобальные для вычисления условий (мини-игры, UI). */
  env(): Record<string, Value> {
    return envOf(this.state);
  }

  test(expr: string): boolean {
    return evalCondition(expr, envOf(this.state));
  }

  // ───────────────────────────── жизненный цикл ─────────────────────────────

  /**
   * Новая партия с первой сцены первого блока. `carried` — глобальные переменные сезона из
   * предыдущих эпизодов (иначе берутся из опций конструктора).
   */
  start(carried?: Readonly<Record<string, Value>>): void {
    const first = this.blockList[0];
    if (!first) throw new EngineError('в эпизоде нет блоков');
    this._state = createInitialState(this.episode, first.entry_scene, carried ?? this.carriedGlobals);
    this._view = null;
    this.queue = [];
    this.current = null;
    this.adBlock = null;
    this.ended = false;
    this.enterScene(first.entry_scene, { reason: 'start' });
  }

  snapshot(): Snapshot {
    return { state: cloneJson(this.state), view: cloneJson(this.view) };
  }

  /** Восстановить партию из снимка (загрузка сейва, откат). События и ожидания сбрасываются. */
  restore(snap: Snapshot): void {
    if (snap.state.episode_id !== this.episode.id) {
      throw new EngineError(`снимок от другого эпизода: ${snap.state.episode_id}`);
    }
    const scene = this.scenes[snap.state.scene_id];
    if (!scene) throw new EngineError(`в снимке неизвестная сцена: ${snap.state.scene_id}`);
    if (snap.state.step_index < 0 || snap.state.step_index >= scene.steps.length) {
      throw new EngineError(`в снимке шаг ${snap.state.step_index} вне сцены ${scene.id}`);
    }
    this._state = cloneJson(snap.state);
    this._view = cloneJson(snap.view);
    // Снимки до появления дедуктивных развилок: счётчиков нет — ни одна опция ещё не испробована.
    this._state.deductions ??= {};
    // Сейвы до появления покрытия: кадра нет, сцена идёт спрайтами до следующего входа в сцену.
    this._view.coverage ??= null;
    this._view.shot ??= null;
    this._view.shot_ctx ??= null;
    this.queue = [];
    this.current = null;
    this.adBlock = null;
    this.ended = false;
  }

  /** Отладка: принудительный переход в сцену без проверок блока, рекламы и автосейва. */
  jumpTo(sceneId: string): void {
    if (!this._state) this.start();
    this.current = null;
    this.adBlock = null;
    this.ended = false;
    this.enterScene(sceneId, { reason: 'debug' });
  }

  /** Отладка: записать переменную (с проверкой типа и границ). */
  setVar(name: string, value: Value): void {
    setVariable(this.state, this.episode, name, value);
  }

  // ───────────────────────────── основной цикл ─────────────────────────────

  /**
   * Выполнить неблокирующие шаги и вернуть накопленные события вместе с ожиданием, на которое
   * должен ответить интерфейс. Повторный вызов без ответа возвращает то же ожидание
   * (удобно для перерисовки после смены языка).
   */
  pump(): PumpResult {
    if (!this._state) throw new EngineError('интерпретатор не запущен: вызовите start() или restore()');
    if (this.current) return { events: this.flush(), pending: this.current };

    for (let guard = 0; guard < MAX_NONBLOCKING_STEPS; guard++) {
      if (this.adBlock !== null) {
        const ad: AdBreakPending = { kind: 'ad_break', block: this.adBlock };
        this.adBlock = null;
        return this.stop(ad);
      }
      const step = this.currentStep();
      if (step.when !== undefined && !this.testAt(step.when, step)) {
        this.state.step_index += 1;
        continue;
      }
      const pending = this.exec(step);
      if (pending) return this.stop(pending);
    }
    throw new EngineError(
      `сцена ${this.state.scene_id}: более ${MAX_NONBLOCKING_STEPS} неблокирующих шагов подряд — вероятно, бесконечный цикл`,
    );
  }

  /** Ответ на ожидания line / hold / document / ad_break. */
  continue(): void {
    const p = this.current;
    if (!p) throw new EngineError('continue(): нет ожидающего шага');
    switch (p.kind) {
      case 'line':
        this.state.step_index += 1;
        this.afterLine();
        break;
      case 'hold':
      case 'document':
        this.state.step_index += 1;
        break;
      case 'ad_break':
        break;
      default:
        throw new EngineError(`continue() неприменим к ожиданию «${p.kind}»`);
    }
    this.current = null;
  }

  /** Ответ на ожидание choice. */
  choose(optionId: string): void {
    const p = this.current;
    if (!p || p.kind !== 'choice') throw new EngineError('choose(): сейчас нет выбора');
    const shown = p.options.find((o) => o.id === optionId);
    if (!shown) throw new EngineError(`выбор ${p.id}: нет опции ${optionId}`);
    if (!shown.enabled) throw new EngineError(`выбор ${p.id}: опция ${optionId} недоступна`);
    const step = this.currentStep();
    if (step.do !== 'choice') throw new EngineError('choose(): текущий шаг не choice');
    const option = step.options.find((o) => o.id === optionId);
    if (!option) throw new EngineError(`выбор ${p.id}: нет опции ${optionId}`);

    const deduction = step.kind === 'deduction';
    if (deduction && option.verdict === 'wrong') {
      // Неверный ход: цена (penalty), затем эффекты опции; опция гаснет до конца развилки, в журнал не пишется.
      // Сцена-реакция по goto сама вернётся jump'ом к вопросу — особой логики переходов нет.
      applyEffects(this.state, this.episode, step.penalty);
      applyEffects(this.state, this.episode, option.effects);
      const rec = (this.state.deductions[step.id] ??= { fails: 0, tried: [] });
      rec.fails += 1;
      if (!rec.tried.includes(option.id)) rec.tried.push(option.id);
    } else {
      applyEffects(this.state, this.episode, option.effects);
      if (p.remember) {
        this.state.journal.push({
          choice: p.id,
          option: option.id,
          scene: this.state.scene_id,
          ...(step.kind ? { kind: step.kind } : {}),
          ...(step.prompt_key ? { prompt_key: step.prompt_key } : {}),
          key: option.key,
          ...(deduction ? { fails: this.state.deductions[step.id]?.fails ?? 0 } : {}),
        });
      }
    }
    this.current = null;
    this.enterScene(option.goto, { reason: 'goto' });
    this.queue.push({ t: 'checkpoint', reason: 'choice' });
  }

  /**
   * Ответ на ожидание minigame. `skipped` маппится в `skip.skip_counts_as` (по умолчанию partial).
   * `found` — что игрок нашёл в осмотре (id зон config.hotspots): каждая найденная зона применяет свои
   * archive_unlock и effects (что нашёл — то и узнал). Без списка (автопилот, тесты): успех — найдены все
   * обязательные зоны, иначе ничего; пропуск — ничего, даже со списком (не смотрел — не видел).
   */
  finishMinigame(result: MinigameResult, found?: readonly string[]): MinigameResolution {
    const p = this.current;
    if (!p || p.kind !== 'minigame') throw new EngineError('finishMinigame(): сейчас нет мини-игры');
    const def = p.def;
    if (result === 'skipped' && !def.skip.allowed) {
      throw new EngineError(`мини-игра ${def.id}: пропуск запрещён (skip.allowed=false)`);
    }
    const counted: MinigameOutcomeKind = result === 'skipped' ? (def.skip.skip_counts_as ?? 'partial') : result;
    // partial в outcomes необязателен; без него частичный результат считается неудачей.
    const outcome: Outcome = def.outcomes[counted] ?? def.outcomes.fail;
    applyEffects(this.state, this.episode, outcome.effects);
    if (outcome.archive_unlock) this.unlock(outcome.archive_unlock, true);
    this.applyFinds(def, counted, result === 'skipped' ? [] : found);
    this.current = null;
    this.enterScene(outcome.goto, { reason: 'goto' });
    this.queue.push({ t: 'checkpoint', reason: 'minigame' });
    return { result, counted, goto: outcome.goto };
  }

  /** Награды найденных зон осмотра (config.hotspots[].archive_unlock / effects). */
  private applyFinds(def: MinigameDef, counted: MinigameOutcomeKind, found: readonly string[] | undefined): void {
    const zones = Array.isArray(def.config.hotspots) ? (def.config.hotspots as unknown[]) : [];
    const isZone = (z: unknown): z is { id: string; required?: unknown; archive_unlock?: unknown; effects?: unknown } =>
      typeof z === 'object' && z !== null && typeof (z as { id?: unknown }).id === 'string';
    const list = zones.filter(isZone);
    const ids = found ?? (counted === 'success' ? list.filter((z) => z.required === true).map((z) => z.id) : []);
    for (const z of list) {
      if (!ids.includes(z.id)) continue;
      if (Array.isArray(z.effects)) applyEffects(this.state, this.episode, z.effects as Effect[]);
      if (typeof z.archive_unlock === 'string') this.unlock(z.archive_unlock, true);
    }
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private flush(): EngineEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  private stop(pending: Pending): PumpResult {
    this.current = pending;
    return { events: this.flush(), pending };
  }

  private currentScene(): Scene {
    const scene = this.scenes[this.state.scene_id];
    if (!scene) throw new EngineError(`неизвестная сцена: ${this.state.scene_id}`);
    return scene;
  }

  private currentStep(): Step {
    const scene = this.currentScene();
    const step = scene.steps[this.state.step_index];
    if (!step) {
      throw new EngineError(
        `сцена ${scene.id}: шаги закончились без перехода (шаг ${this.state.step_index}); сцена должна заканчиваться jump/branch/choice/minigame/end`,
      );
    }
    return step;
  }

  private testAt(expr: string, step: Step): boolean {
    try {
      return evalCondition(expr, envOf(this.state));
    } catch (e) {
      throw new EngineError(
        `сцена ${this.state.scene_id}, шаг ${this.state.step_index} (${step.do}): условие «${expr}»: ${(e as Error).message}`,
      );
    }
  }

  private emit(ev: EngineEvent): void {
    this.queue.push(ev);
  }

  private afterLine(): void {
    const view = this.view;
    if (view.cg !== null && view.cg_hide_after) {
      view.cg = null;
      this.emit({ t: 'cg_hide', transition: 'fade' });
    }
  }

  private nextEnabledBlock(after: Block): Block | undefined {
    const i = this.blockList.findIndex((b) => b.id === after.id);
    for (let k = i + 1; k < this.blockList.length; k++) {
      const b = this.blockList[k];
      if (b && (b.when === undefined || this.test(b.when))) return b;
    }
    return undefined;
  }

  private enterScene(
    sceneId: string,
    opts: { reason: 'start' | 'goto' | 'debug'; transition?: TransitionKind },
  ): void {
    const scene = this.scenes[sceneId];
    if (!scene) throw new EngineError(`переход на несуществующую сцену: ${sceneId}`);
    const block = this.blocks.get(scene.block);
    if (!block) throw new EngineError(`сцена ${sceneId}: неизвестный блок ${scene.block}`);
    const prev = this._view;
    const newBlock = prev === null || prev.block !== block.id;

    // Структурное ветвление: блок с `when` включается, только если условие истинно.
    // Проверяется при входе в его первую сцену из другого блока; выключенный блок пропускается.
    if (newBlock && opts.reason === 'goto' && sceneId === block.entry_scene && block.when !== undefined) {
      if (!this.test(block.when)) {
        const next = this.nextEnabledBlock(block);
        if (!next) throw new EngineError(`блок ${block.id} выключен условием «${block.when}», а следующего включённого блока нет`);
        this.warn(`блок ${block.id} пропущен (when: ${block.when}); продолжаем с блока ${next.id}`);
        this.enterScene(next.entry_scene, opts);
        return;
      }
    }

    const view: ViewState = {
      ...defaultViewFor(this.episode, sceneId),
      // CG переживает смену сцены внутри блока (кадр задержания держится поверх s16 → s16a/b),
      // но не выходит за границу блока.
      cg: prev && !newBlock ? prev.cg : null,
      cg_hide_after: prev && !newBlock ? prev.cg_hide_after : true,
      // Без явного указания музыка и эмбиент продолжают играть.
      music: prev?.music ?? null,
      ambient: prev?.ambient ?? null,
    };

    // Покрытие: вход в сцену — общий план сета с составом сцены (08 §4.1); кадров нет — спрайты.
    if (view.coverage !== null && this.shots.hasSet(view.coverage)) {
      view.shot = entryShot(this.shots, view.coverage, this.sceneCast(scene))?.id ?? null;
      view.shot_ctx = { ...EMPTY_CTX };
    } else {
      view.coverage = null;
    }

    if (prev?.cg && newBlock) this.emit({ t: 'cg_hide', transition: 'fade' });

    let transition: TransitionKind;
    if (opts.transition) transition = opts.transition;
    else if (prev === null || newBlock) transition = 'fade';
    else transition = prev.bg !== view.bg ? 'dissolve' : 'cut';
    if (prev && transition === 'cut' && prev.presentation !== view.presentation) transition = 'fade';

    // Музыка/эмбиент сцены (или блока при входе в него) включаются при входе; без указания — продолжают играть.
    const music = scene.music ?? (newBlock ? block.music : undefined);
    const startMusic = music !== undefined && music !== view.music ? music : null;
    if (startMusic !== null) view.music = startMusic;
    const startAmbient = scene.ambient !== undefined && scene.ambient !== view.ambient ? scene.ambient : null;
    if (startAmbient !== null) view.ambient = startAmbient;

    const state = this.state;
    state.scene_id = scene.id;
    state.step_index = 0;
    this._view = view;
    this.emit({ t: 'scene', view: cloneJson(view), transition, newBlock, first: prev === null });
    if (startMusic !== null) {
      this.emit({ t: 'audio', kind: 'music', id: startMusic, fade_ms: 800, loop: true, volume: 1 });
    }
    if (startAmbient !== null) {
      this.emit({ t: 'audio', kind: 'ambient', id: startAmbient, fade_ms: 800, loop: true, volume: 1 });
    }

    if (newBlock && opts.reason !== 'debug') {
      if (block.autosave !== false) this.emit({ t: 'checkpoint', reason: 'block' });
      // Реклама — только интерпретатором и только на блоках с ad_break_allowed; не перед первым блоком.
      if (block.ad_break_allowed && opts.reason !== 'start') this.adBlock = block.id;
    }
  }

  /** Отладка (?items=, __vn.unlock): выдать материал архива как по шагу unlock, без тоста. */
  unlockItem(item: string): void {
    this.unlock(item, false);
  }

  private unlock(item: string, toast: boolean): void {
    if (!this.archiveIds.has(item)) this.warn(`archive item ${item} не объявлен в archive_items`);
    const archive = this.state.archive;
    if (archive.includes(item)) return;
    archive.push(item);
    this.emit({ t: 'archive', item, toast });
  }

  private asFilter(value: string): StageFilter | undefined {
    if ((STAGE_FILTERS as readonly string[]).includes(value)) return value as StageFilter;
    this.warn(`неизвестный фильтр «${value}» в шаге bg — игнорируется`);
    return undefined;
  }

  private sprite(who: string): SpriteView | undefined {
    return this.view.sprites.find((s) => s.who === who);
  }

  // ───────────────────────────── кадры покрытия (монтажёр) ─────────────────────────────

  /** Кто сейчас на сцене (видимые спрайты) — состав для подбора кадра. */
  private stageCast(): string[] {
    return this.view.sprites.filter((s) => !isOffscreenPos(s.position)).map((s) => s.who);
  }

  /**
   * Состав на входе в сцену — для общего плана, когда спрайтов ещё нет: кто появился до первой реплики персонажа,
   * и сам первый говорящий. Кто приходит позже (дверь открылась после реплики), в общий план входа не попадает:
   * иначе кадр показывал человека, которого ещё нет, и на первой реплике тут же сменялся (s02: Лапин на полсекунды).
   */
  private sceneCast(scene: Scene): string[] {
    let cast = this.sceneCasts.get(scene.id);
    if (!cast) {
      const on = new Set<string>();
      const off = new Set<string>();
      const spoke = new Set<string>();
      let conditional = false; // show с when: состав зависит от партии — не кешируем
      for (const step of scene.steps) {
        if (step.do === 'show' && step.when !== undefined) {
          conditional = true;
          if (!this.test(step.when)) continue;
        }
        if (step.do === 'show') (isOffscreenPos(step.position) ? off : on).add(step.who);
        else if (step.do === 'say') {
          if (step.position !== undefined) (isOffscreenPos(step.position) ? off : on).add(step.who);
          else spoke.add(step.who);
          break; // первая реплика персонажа — конец входа
        }
      }
      for (const who of spoke) if (!off.has(who)) on.add(who);
      cast = [...on];
      if (!conditional) this.sceneCasts.set(scene.id, cast);
    }
    return cast;
  }

  private shotEvent(pick: ShotPick): EngineEvent | null {
    const view = this.view;
    view.shot_ctx = pick.ctx;
    if (pick.shot === view.shot) return null;
    view.shot = pick.shot;
    return { t: 'shot', shot: pick.shot, transition: 'cut' };
  }

  /** Кадр для реплики: явный `shot` сценариста или выбор монтажёра; null — кадр не меняется. */
  private lineShotEvent(step: SayStep | NarrateStep, who: string | null, expression: string | null, narrate: NarrateStyle | null): EngineEvent | null {
    const view = this.view;
    if (view.coverage === null) return null;
    const ctx = view.shot_ctx ?? { ...EMPTY_CTX };
    if (step.shot !== undefined) return this.explicitShotEvent(step.shot, who);
    return this.shotEvent(
      lineShot(this.shots, {
        set: view.coverage,
        who,
        expression,
        beat: beatOf(step.beat, expression),
        narrate,
        longLine: this.lineLength(step.key) > LONG_LINE_CHARS,
        cast: this.stageCast(),
        pov: this.pov,
        current: view.shot,
        ctx,
        seed: `${this.state.scene_id}:${this.state.step_index}`,
      }),
    );
  }

  private explicitShotEvent(id: string, who: string | null): EngineEvent | null {
    const view = this.view;
    if (view.coverage === null) return null;
    const shot = this.shots.get(id);
    if (!shot) {
      this.warn(`сцена ${this.state.scene_id}: кадр ${id} не объявлен в assets.shots — оставлен текущий`);
      return null;
    }
    if (shot.set !== view.coverage) this.warn(`сцена ${this.state.scene_id}: кадр ${id} из сета ${shot.set}, а сцена покрыта сетом ${view.coverage}`);
    return this.shotEvent(explicitShot(this.shots, id, view.shot, view.shot_ctx ?? { ...EMPTY_CTX }, who));
  }

  /** Выполнить один шаг. Возвращает ожидание для блокирующих шагов, иначе null. */
  private exec(step: Step): Pending | null {
    const state = this.state;
    const view = this.view;
    switch (step.do) {
      case 'say': {
        this.applySayToSprite(step.who, step.expression, step.pose, step.position);
        view.speaker = step.who;
        const expression = step.expression ?? this.sprite(step.who)?.expression ?? null;
        const shotEv = this.lineShotEvent(step, step.who, expression, null);
        if (shotEv) this.emit(shotEv);
        this.emit({ t: 'speaker', who: step.who });
        const p: LinePending = {
          kind: 'line',
          style: 'say',
          who: step.who,
          key: step.key,
          expression,
          narrate_style: null,
          voice: step.voice ?? null,
          scene: state.scene_id,
          index: state.step_index,
        };
        return p;
      }
      case 'narrate': {
        view.speaker = null;
        const shotEv = this.lineShotEvent(step, null, null, step.style ?? 'voiceover');
        if (shotEv) this.emit(shotEv);
        this.emit({ t: 'speaker', who: null });
        const p: LinePending = {
          kind: 'line',
          style: 'narrate',
          who: null,
          key: step.key,
          expression: null,
          narrate_style: step.style ?? 'voiceover',
          voice: step.voice ?? null,
          scene: state.scene_id,
          index: state.step_index,
        };
        return p;
      }
      case 'caption': {
        const hold = step.hold_ms ?? DEFAULT_CAPTION_HOLD_MS[step.style];
        if (OVERLAY_CAPTIONS.has(step.style)) {
          this.emit({ t: 'caption', key: step.key, style: step.style, hold_ms: hold });
          state.step_index += 1;
          return null;
        }
        // chapter / fact держат паузу: иначе следующий jump/end сразу перекроет титр.
        const p: HoldPending = { kind: 'hold', reason: 'caption', ms: hold, caption: { key: step.key, style: step.style } };
        return p;
      }
      case 'show': {
        const prev = this.sprite(step.who);
        const sprite: SpriteView = {
          who: step.who,
          expression: step.expression ?? prev?.expression ?? null,
          pose: step.pose ?? prev?.pose ?? null,
          position: step.position ?? prev?.position ?? 'center',
          silhouette: step.silhouette ?? false,
        };
        if (prev) view.sprites[view.sprites.indexOf(prev)] = sprite;
        else view.sprites.push(sprite);
        this.emit({ t: 'show', sprite: { ...sprite }, existing: prev !== undefined, transition: step.transition ?? 'dissolve' });
        if (step.shot !== undefined) {
          const shotEv = this.explicitShotEvent(step.shot, step.who);
          if (shotEv) this.emit(shotEv);
        }
        state.step_index += 1;
        return null;
      }
      case 'hide': {
        view.sprites = view.sprites.filter((s) => s.who !== step.who);
        if (view.speaker === step.who) view.speaker = null;
        if (view.coverage !== null) {
          // Кадр с ушедшим не годится: общий план оставшихся или спрайты (08 §4.9).
          const next = afterHide(this.shots, view.coverage, this.stageCast(), view.shot, step.who);
          if (next !== view.shot) {
            view.shot = next;
            this.emit({ t: 'shot', shot: next, transition: 'cut' });
          }
        }
        this.emit({ t: 'hide', who: step.who, transition: step.transition ?? 'dissolve' });
        state.step_index += 1;
        return null;
      }
      case 'bg': {
        if (view.cg !== null) {
          view.cg = null;
          this.emit({ t: 'cg_hide', transition: 'fade' });
        }
        if (view.coverage !== null && this.shots.set(view.coverage)[0]?.bg !== step.bg) {
          // Другая локация — кадры сета больше не про эту сцену: до следующей сцены идём спрайтами.
          view.coverage = null;
          view.shot_ctx = null;
          if (view.shot !== null) {
            view.shot = null;
            this.emit({ t: 'shot', shot: null, transition: 'cut' });
          }
        }
        view.bg = step.bg;
        if (step.filter !== undefined) {
          const f = this.asFilter(step.filter);
          if (f !== undefined) view.filter = f;
        }
        this.emit({ t: 'bg', bg: step.bg, filter: view.filter, transition: step.transition ?? 'fade' });
        state.step_index += 1;
        return null;
      }
      case 'cg': {
        view.cg = step.cg;
        view.cg_hide_after = step.hide_after ?? true;
        this.emit({ t: 'cg', cg: step.cg, transition: step.transition ?? 'fade' });
        state.step_index += 1;
        return null;
      }
      case 'document': {
        if (step.adds_to_archive) this.unlock(step.adds_to_archive, true);
        const p: DocumentPending = {
          kind: 'document',
          doc: step.doc,
          text_key: step.text_key ?? null,
          zoomable: step.zoomable ?? true,
          adds_to_archive: step.adds_to_archive ?? null,
        };
        return p;
      }
      case 'music':
      case 'ambient':
      case 'sfx': {
        if (!step.id) {
          this.warn(`сцена ${state.scene_id}: шаг ${step.do} без id — пропущен`);
        } else {
          if (step.do === 'music') view.music = step.id;
          if (step.do === 'ambient') view.ambient = step.id;
          this.emit({
            t: 'audio',
            kind: step.do,
            id: step.id,
            fade_ms: step.fade_ms ?? (step.do === 'sfx' ? 0 : 600),
            loop: step.loop ?? step.do !== 'sfx',
            volume: step.volume ?? 1,
          });
        }
        state.step_index += 1;
        return null;
      }
      case 'stop_music':
      case 'stop_ambient': {
        if (step.do === 'stop_music') view.music = null;
        else view.ambient = null;
        this.emit({ t: 'audio', kind: step.do, id: null, fade_ms: step.fade_ms ?? 600, loop: false, volume: 1 });
        state.step_index += 1;
        return null;
      }
      case 'fx': {
        const p: HoldPending = {
          kind: 'hold',
          reason: 'fx',
          ms: step.ms ?? DEFAULT_FX_MS[step.fx],
          fx: { fx: step.fx, intensity: step.intensity ?? 1 },
        };
        return p;
      }
      case 'choice': {
        if (view.coverage !== null) {
          // §4.6: medium с персонажем игрока или wide; выбор с таймером — крупный план оппонента.
          const ctx = view.shot_ctx ?? { ...EMPTY_CTX };
          const opponent = listenerOf(ctx, this.pov);
          const next = choiceShot(this.shots, view.coverage, this.stageCast(), this.pov, step.timer_ms !== undefined, opponent)?.id ?? view.shot;
          if (next !== view.shot) {
            view.shot = next;
            view.shot_ctx = { ...ctx, held: 1, closes: 0 };
            this.emit({ t: 'shot', shot: next, transition: 'cut' });
          }
        }
        return this.choicePending(step);
      }
      case 'set': {
        applyEffects(state, this.episode, step.effects);
        state.step_index += 1;
        return null;
      }
      case 'branch': {
        let target = step.default;
        for (const c of step.cases) {
          if (this.testAt(c.when, step)) {
            target = c.goto;
            break;
          }
        }
        this.enterScene(target, { reason: 'goto' });
        return null;
      }
      case 'jump': {
        this.enterScene(step.scene, { reason: 'goto', ...(step.transition ? { transition: step.transition } : {}) });
        return null;
      }
      case 'minigame': {
        const def = this.minigames[step.minigame];
        if (!def) throw new EngineError(`сцена ${state.scene_id}: мини-игра ${step.minigame} не объявлена`);
        return { kind: 'minigame', def, intro_key: step.intro_key ?? null };
      }
      case 'archive_unlock': {
        this.unlock(step.item, step.toast ?? true);
        state.step_index += 1;
        return null;
      }
      case 'end': {
        const ending = this.endings.get(step.ending);
        if (!ending) throw new EngineError(`сцена ${state.scene_id}: концовка ${step.ending} не объявлена`);
        for (const id of ending.unlocks ?? []) this.unlock(id, false);
        this.ended = true;
        return { kind: 'end', ending };
      }
    }
  }

  /**
   * Ожидание выбора: какие опции видны и доступны. Дедуктивная развилка (kind=deduction, 02-narrative-blocks §5a)
   * сверх того: опция-улика видна, только если материал уже в архиве (иначе она подсказала бы ответ); испробованная
   * неверно — видна, но погашена; после hint_after ошибок доступные верные опции подсвечены; шкала цены ошибок.
   */
  private choicePending(step: ChoiceStep): ChoicePending {
    const deduction = step.kind === 'deduction';
    const record = deduction ? this.state.deductions[step.id] : undefined;
    const fails = record?.fails ?? 0;
    const hintAfter = step.hint_after ?? DEFAULT_HINT_AFTER;
    const hintOn = deduction && fails >= hintAfter;
    const tried = new Set(record?.tried ?? []);

    let rows: Array<{ option: ChoiceOption; enabled: boolean; tried: boolean }> = [];
    for (const o of step.options) {
      if (deduction && o.item !== undefined && !this.state.archive.includes(o.item)) continue;
      const ok = o.when === undefined ? true : this.testAt(o.when, step);
      if (!ok && o.hidden_when_false === true) continue;
      const wasTried = deduction && tried.has(o.id);
      rows.push({ option: o, enabled: ok && !wasTried, tried: wasTried });
    }
    if (rows.length === 0 || rows.every((r) => !r.enabled)) {
      // Ни одной доступной опции — ошибка контента (у дедукции линтер требует всегда доступную верную);
      // не оставляем игрока в тупике.
      this.warn(`выбор ${step.id}: нет доступных опций — показываем все`);
      rows = step.options.map((o) => ({ option: o, enabled: true, tried: false }));
    }

    const options = rows.map(({ option: o, enabled, tried: wasTried }): ChoiceOptionView => {
      const verdict = deduction ? (o.verdict ?? 'right') : null;
      return {
        id: o.id,
        key: o.key,
        enabled,
        verdict,
        tried: wasTried,
        // Подсвечиваем только то, что можно выбрать: погашенная «верная» опция подсказкой не является.
        hinted: hintOn && enabled && verdict !== 'wrong',
        item: deduction && o.item !== undefined ? this.itemView(o.item, o.key) : null,
      };
    });
    return {
      kind: 'choice',
      id: step.id,
      prompt_key: step.prompt_key ?? null,
      choice_kind: step.kind ?? null,
      timer_ms: step.timer_ms ?? null,
      default_option: step.default_option ?? null,
      remember: step.remember ?? true,
      options,
      deduction: deduction ? { fails, hint_after: hintAfter, meter: this.deductionMeter(step) } : null,
    };
  }

  /** Материал архива для карточки «предъявить»; необъявленный (о нём уже предупредил unlock) — как документ. */
  private itemView(id: string, fallbackKey: string): NonNullable<ChoiceOptionView['item']> {
    const a = this.archiveItems.get(id);
    return a ? { id, kind: a.kind, title_key: a.title_key } : { id, kind: 'document', title_key: fallbackKey };
  }

  /** Шкала дедукции: переменная первого эффекта penalty, если это int-переменная эпизода с max. */
  private deductionMeter(step: ChoiceStep): DeductionMeter | null {
    const name = step.penalty?.[0]?.var;
    if (name === undefined) return null;
    const def = this.episode.variables[name];
    const value = getVariable(this.state, name);
    if (!def || def.type !== 'int' || def.max === undefined || typeof value !== 'number') return null;
    return { var: name, value, max: def.max };
  }

  /** `say` может заодно сменить выражение/позу/позицию спрайта говорящего. */
  private applySayToSprite(who: string, expression?: string, pose?: string, position?: SpriteView['position']): void {
    if (expression === undefined && pose === undefined && position === undefined) return;
    const view = this.view;
    const prev = this.sprite(who);
    if (!prev) {
      // Говорящего нет на сцене: показываем, только если сценарист явно указал позицию.
      if (position === undefined) return;
      const sprite: SpriteView = {
        who,
        expression: expression ?? null,
        pose: pose ?? null,
        position,
        silhouette: false,
      };
      view.sprites.push(sprite);
      this.emit({ t: 'show', sprite: { ...sprite }, existing: false, transition: 'dissolve' });
      return;
    }
    const next: SpriteView = {
      ...prev,
      expression: expression ?? prev.expression,
      pose: pose ?? prev.pose,
      position: position ?? prev.position,
    };
    if (next.expression === prev.expression && next.pose === prev.pose && next.position === prev.position) return;
    view.sprites[view.sprites.indexOf(prev)] = next;
    this.emit({ t: 'show', sprite: { ...next }, existing: true, transition: 'cut' });
  }
}
