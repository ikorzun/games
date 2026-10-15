/**
 * Режим дела: папка следователя поверх нынешнего рантайма (docs/architecture/09-case-mode.md). Задача запускает то,
 * что уже есть: поиск — crime_scene_search в режиме списка, экспертиза — мини-игру эпизода, разговор — интерпретатор
 * над сценой дела (case_talk.ts), осмотр улики — PhotoScreen. Прогресс (★, задачи, папка) — в сейвах
 * (progress.cases[<эпизод>]), пишется после каждой задачи; брошенная на середине задача ничего не стоит.
 */
import { t } from '../core/i18n';
import type { SaveManager } from '../core/saves';
import type { Settings } from '../core/settings';
import type { Episode, MinigameDef, MinigameResult, ViewState } from '../core/types';
import type { IPlatform } from '../platform/types';
import type { Director } from '../stage/director';
import type { DomUI } from '../ui/dom_ui';
import type { UiKit } from '../ui/kit';
import type { Screen } from '../ui/screen_host';
import type { CaseDef, CaseScene, CaseTask } from './case_def';
import { searchDef, talkEpisode } from './case_def';
import { CaseScreen, PhotoScreen, SearchResultScreen } from './case_screen';
import type { SearchSummary } from './case_screen';
import type { CaseProgress, SearchRun, SearchStars } from './case_state';
import {
  chapterComplete,
  completeTask,
  currentChapter,
  emptyProgress,
  hasProgress,
  recordSearch,
  sanitizeProgress,
  searchStars,
  taskState,
} from './case_state';
import { playTalk } from './case_talk';

export interface CaseModeDeps {
  def: CaseDef;
  episode: Episode;
  kit: UiKit;
  ui: DomUI;
  /** Свой режиссёр разговоров: без предзагрузки по блокам (у сцен дела нет блоков эпизода). */
  director: Director;
  saves: SaveManager;
  platform: IPlatform;
  settings: () => Settings;
  /** Адрес файла ассета; null — нет. */
  url: (path: string) => string | null;
  /** Кадр разговора для текстового окна. */
  setTalkView: (view: (() => ViewState) | null) => void;
  /** Режим партии (текстовое окно и быстрое меню видны) — на время разговора. */
  setInGame: (on: boolean) => void;
  onMenu: () => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Итог захода по состоянию мини-игры (MinigameShell.serialize: over, left, t.misses). */
export function readRun(state: unknown, scene: CaseScene): SearchRun {
  const s = isRecord(state) ? state : {};
  const g = isRecord(s.t) ? s.t : {};
  const misses = typeof g.misses === 'number' && g.misses >= 0 ? g.misses : 0;
  const left = typeof s.left === 'number' ? s.left : null;
  return { complete: s.over === 'success', misses, elapsedMs: left === null ? null : Math.max(0, scene.time_limit_ms - left) };
}

/** Ожидание, которое при отмене завершается null (мини-игра и экраны сами по себе при отмене не резолвятся). */
function untilAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    const onAbort = (): void => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    void p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(null);
      },
    );
  });
}

const NO_STARS: SearchStars = { all: false, fast: false, accurate: false, stars: 0 };

export class CaseMode {
  private p: CaseProgress;
  private folder: CaseScreen | null = null;
  private abort: AbortController | null = null;
  private busy = false;

  constructor(private readonly d: CaseModeDeps) {
    this.p = sanitizeProgress(d.saves.caseProgress(d.def.episode), d.def);
  }

  get progress(): Readonly<CaseProgress> {
    return this.p;
  }

  /** Есть что продолжать (меню: клик по эпизоду — продолжение, под карточкой — «Начать заново»). */
  get started(): boolean {
    return hasProgress(this.p);
  }

  /** Открытые главы закрыты. */
  get completed(): boolean {
    return this.d.def.chapters.filter((c) => !c.locked).every((c) => chapterComplete(c, this.p));
  }

  private get storyOnly(): boolean {
    return this.d.settings().storyOnly;
  }

  /** Дело с нуля. */
  reset(): void {
    this.p = emptyProgress();
    this.save();
  }

  /** Войти в дело: при первом входе в главу — её вступление, потом папка. */
  async enter(): Promise<void> {
    this.stop();
    const ac = new AbortController();
    this.abort = ac;
    const ch = currentChapter(this.d.def, this.p);
    if (ch.intro && !this.p.intro.includes(ch.id)) {
      if (!this.started) this.d.platform.track('level_started', { world: `s${this.d.episode.season}`, level: this.d.def.episode });
      const ok = await this.talk(ch.intro, ac.signal);
      if (!ok) return;
      this.p = { ...this.p, intro: [...this.p.intro, ch.id] };
      this.save();
    }
    if (!ac.signal.aborted) this.showFolder();
  }

  /** Выход в меню: оборвать разговор или мини-игру, закрыть папку. */
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.busy = false;
    this.closeFolder();
  }

  // ───────────────────────────── задачи ─────────────────────────────

  private async run(task: CaseTask, replay: boolean): Promise<void> {
    const signal = this.abort?.signal;
    if (!signal || this.busy) return;
    if (!replay && taskState(this.p, task, this.storyOnly) !== 'open') return;
    this.busy = true;
    this.p = { ...this.p, fresh: [] };
    try {
      let ok = false;
      switch (task.kind) {
        case 'search':
          await this.search(task, replay, signal);
          break;
        case 'talk':
          ok = task.talk !== undefined && (await this.talk(task.talk, signal));
          break;
        case 'photo':
          ok = await this.photo(task, signal);
          break;
        case 'minigame':
          ok = await this.minigame(task, signal);
          break;
      }
      if (signal.aborted) return;
      if (ok) {
        this.p = completeTask(this.p, task, this.storyOnly);
        this.save();
      }
      await this.outro(signal);
      if (!signal.aborted) this.showFolder();
    } finally {
      this.busy = false;
    }
  }

  private async search(task: CaseTask, replay: boolean, signal: AbortSignal): Promise<void> {
    const sceneId = task.scene;
    const sc = sceneId ? this.d.def.scenes[sceneId] : undefined;
    if (!sceneId || !sc) return;
    const def = searchDef(this.d.def, sceneId, this.p.clues, this.p.plays[sceneId] ?? 0);
    // Телефон вертикально: картинка поиска слишком мелкая — подсказать повернуть.
    if (globalThis.matchMedia?.('(orientation: portrait) and (max-width: 600px)').matches) this.d.kit.toasts.push(t('ui.case.rotate'));
    let final: unknown = null;
    const result = await this.runMinigame(def, null, signal, (s) => (final = s));
    if (result === null) return;
    const st = result === 'skipped' ? NO_STARS : searchStars(sc, readRun(final, sc));
    this.p = recordSearch(this.p, sceneId, st.stars);
    // Первый заход, в котором всё найдено (или пропущен по правилам доступности), выполняет задачу и выдаёт улики.
    if (!replay && (st.all || result === 'skipped')) this.p = completeTask(this.p, task, this.storyOnly);
    this.save();
    await this.showResult(
      { titleKey: sc.title_key, result: st, starTimeMs: sc.star_time_ms, starMisses: sc.star_misses, best: this.p.best[sceneId] ?? 0 },
      signal,
    );
  }

  private async minigame(task: CaseTask, signal: AbortSignal): Promise<boolean> {
    const def = task.minigame ? this.d.episode.minigames?.[task.minigame] : undefined;
    if (!def) return true;
    // Вступление мини-игры — из шага эпизода, который её вызывает (там же, где у новеллы).
    let intro: string | null = null;
    for (const scene of Object.values(this.d.episode.scenes)) {
      for (const st of scene.steps) if (st.do === 'minigame' && st.minigame === def.id && st.intro_key) intro = st.intro_key;
    }
    return (await this.runMinigame(def, intro, signal)) !== null;
  }

  private async runMinigame(def: MinigameDef, intro: string | null, signal: AbortSignal, final?: (s: unknown) => void): Promise<MinigameResult | null> {
    this.closeFolder();
    this.d.platform.track('minigame_start', { id: def.id, type: def.type });
    const result = await untilAbort(
      this.d.ui.runMinigame({ kind: 'minigame', def, intro_key: intro }, { signal, restore: undefined, autosave: () => undefined, ...(final ? { final } : {}) }),
      signal,
    );
    if (result !== null) this.d.platform.track(result === 'skipped' ? 'minigame_skip' : 'minigame_finish', { id: def.id, type: def.type, result });
    return result;
  }

  private async talk(talkId: string, signal: AbortSignal): Promise<boolean> {
    this.closeFolder();
    this.d.setInGame(true);
    try {
      return await playTalk(talkEpisode(this.d.episode, this.d.def, talkId), {
        director: this.d.director,
        ui: this.d.ui,
        signal,
        setView: this.d.setTalkView,
        warn: (m) => console.warn(`[case] ${m}`),
      });
    } finally {
      this.d.ui.reset();
      this.d.setInGame(false);
    }
  }

  private async photo(task: CaseTask, signal: AbortSignal): Promise<boolean> {
    const sc = task.scene ? this.d.def.scenes[task.scene] : undefined;
    const item = sc?.items.find((x) => x.id === task.item);
    if (!sc || !item || !task.back_key) return true;
    const path = this.d.episode.assets?.backgrounds?.find((b) => b.id === sc.bg)?.path;
    const backKey = task.back_key;
    this.closeFolder();
    await this.modal(
      (done) => new PhotoScreen({ titleKey: task.title_key, bgUrl: path ? this.d.url(path) : null, item, backKey, onDone: done }),
      signal,
    );
    if (signal.aborted) return false;
    return task.talk ? this.talk(task.talk, signal) : true;
  }

  /** Итог главы: когда все задачи выполнены — заключительный разговор (один раз). */
  private async outro(signal: AbortSignal): Promise<void> {
    const ch = currentChapter(this.d.def, this.p);
    if (!chapterComplete(ch, this.p) || !ch.outro || this.p.outro.includes(ch.id)) return;
    if (!(await this.talk(ch.outro, signal))) return;
    this.p = { ...this.p, outro: [...this.p.outro, ch.id] };
    this.save();
    this.d.platform.track('level_completed', { world: `s${this.d.episode.season}`, level: this.d.def.episode });
  }

  // ───────────────────────────── экраны ─────────────────────────────

  private showResult(s: Omit<SearchSummary, 'onDone'>, signal: AbortSignal): Promise<void> {
    return this.modal((done) => new SearchResultScreen({ ...s, onDone: done }), signal);
  }

  /** Открыть экран и дождаться, пока его закроют (или отменят дело). */
  private modal(make: (done: () => void) => Screen, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const { screens } = this.d.kit;
      let screen: Screen | null = null;
      const done = (): void => {
        if (screen) screens.close(screen);
        signal.removeEventListener('abort', done);
        resolve();
      };
      screen = make(done);
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', done, { once: true });
      screens.open(screen);
    });
  }

  private showFolder(): void {
    if (this.folder && this.d.kit.screens.has(this.folder)) {
      this.folder.render();
      return;
    }
    this.folder = new CaseScreen({
      view: () => ({ def: this.d.def, episode: this.d.episode, progress: this.p, storyOnly: this.storyOnly, url: this.d.url }),
      onTask: (task) => void this.run(task, false),
      onReplay: (task) => void this.run(task, true),
      onMenu: () => this.d.onMenu(),
    });
    this.d.kit.screens.open(this.folder);
    // Фокус — на саму папку, не на первую кнопку («В меню»): пробел, которым листали разговор, не должен её нажать.
    this.folder.el.focus({ preventScroll: true });
  }

  private closeFolder(): void {
    if (this.folder) this.d.kit.screens.close(this.folder);
    this.folder = null;
  }

  private save(): void {
    this.d.saves.writeCase(this.d.def.episode, this.p);
  }
}
