/**
 * Общая оболочка «настоящих» мини-игр следствия: crime_scene_search, document_check, database_search.
 *
 * Оболочка берёт на себя всё, что у этих трёх игр одинаково и что легко сделать неправильно:
 *   - заголовок, бриф и вступление шага (intro_key), строка прогресса, счётчик неудач, таймер;
 *   - правила пропуска (skip.allowed / skip.after_fails / режим «только история») и подсказки
 *     за rewarded-рекламу (skip.hint_rewarded_ad + ctx.showRewarded);
 *   - пауза (реклама, вкладка в фоне): таймер замирает, ввод не принимается;
 *   - итог: `onResult` вызывается ровно один раз, только по кнопке «Далее» (или «Пропустить»),
 *     поэтому игрок успевает увидеть, чем всё закончилось;
 *   - serialize / restore (автосейв после каждого «хода»), смена языка на лету, destroy;
 *   - запасной вариант: config, непригодный для настоящей механики, превращает игру в grey-box,
 *     эпизод остаётся проходимым (в консоль уходит предупреждение).
 *
 * Конкретная игра наследует MinigameShell и описывает только свою механику (parse / build / paint /
 * ходы / итог). Стили оболочки — mg_shell.css, стили игры — <тип>.css.
 */
import type { Container } from 'pixi.js';
import type { Params } from '../core/i18n';
import type { MinigameOutcomeKind, MinigameResult } from '../core/types';
import { fill, h } from '../ui/dom';
import { icon } from '../ui/icons';
import { GreyBoxMinigame } from './grey_box';
import { Countdown, formatTime } from './mg_timer';
import type { GameContext, IMinigame, MinigameConfig } from './types';
import './mg_shell.css';

// ───────────────────────────── мелкие утилиты ─────────────────────────────

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Непустая строка или null. */
export function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Конечное число (целая часть) не меньше `min`, иначе null. */
export function asInt(v: unknown, min = Number.MIN_SAFE_INTEGER): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.floor(v) >= min ? Math.floor(v) : null;
}

/** FNV-1a, 32 бита: стабильное зерно из строки (id мини-игры). */
export function hashString(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x >>> 0;
}

/** Детерминированный генератор [0, 1): один и тот же seed — одна и та же колода/расклад на всех языках. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const warnedAssets = new Set<string>();

/** Нет файла картинки: одно предупреждение на файл (как AssetStore.warnMissing), игра продолжается с плейсхолдером. */
export function warnMissingAsset(url: string): void {
  if (warnedAssets.has(url)) return;
  warnedAssets.add(url);
  console.warn(`[assets] нет файла ${url} — мини-игра показывает плейсхолдер`);
}

/** Сказать «в живую область» и на экране: строка пересобирается при смене языка. */
export type StatusFn = () => string;

export type EndWhy = 'done' | 'limit' | 'time';

const OUTCOME_KEY: Readonly<Record<MinigameOutcomeKind, string>> = {
  success: 'ui.minigame.success',
  partial: 'ui.minigame.partial',
  fail: 'ui.minigame.fail',
};

const OUTCOMES: readonly MinigameOutcomeKind[] = ['success', 'partial', 'fail'];
const WHYS: readonly EndWhy[] = ['done', 'limit', 'time'];

/** Форма числа по правилам языка (Intl.PluralRules): one / few / many / other — суффикс ключа строки с числом. */
export function pluralForm(n: number, lang: string): string {
  try {
    return new Intl.PluralRules(lang).select(n);
  } catch {
    return 'other'; // очень старый браузер — общая форма
  }
}

/** Раскладка «сцена»: вступление поверх картинки, перетаскиваемый блок по ходу партии. */
interface StageChrome {
  intro: HTMLElement;
  heading: HTMLElement;
  attempts: HTMLElement;
  start: HTMLButtonElement;
  dock: HTMLElement;
  move: HTMLElement;
}

/** Ссылки на элементы оболочки. */
interface Chrome {
  root: HTMLElement;
  title: HTMLElement;
  brief: HTMLElement;
  intro: HTMLElement;
  progress: HTMLElement;
  fails: HTMLElement;
  failsText: HTMLElement;
  pips: HTMLElement;
  timer: HTMLElement;
  timerText: HTMLElement;
  timerBar: HTMLElement;
  status: HTMLElement;
  foot: HTMLElement;
  actions: HTMLElement;
  hint: HTMLButtonElement;
  skip: HTMLButtonElement;
  result: HTMLElement;
  resultTitle: HTMLElement;
  resultNote: HTMLElement;
  /** Подробности итога от игры (resultDetails); пусто — скрыто. */
  resultBody: HTMLElement;
  next: HTMLButtonElement;
  /** Только у раскладки 'stage'. */
  stage?: StageChrome;
}

/** Элементы оболочки без расстановки (её делает раскладка). */
type ChromeParts = Omit<Chrome, 'root' | 'foot' | 'stage'>;

export abstract class MinigameShell implements IMinigame {
  onResult: (result: MinigameResult) => void = () => undefined;

  /** Тип мини-игры (для grey-box при непригодном config). */
  protected abstract readonly type: string;
  /** Класс корневого элемента игры (CSS-префикс), например `mg-scene`. */
  protected abstract readonly cls: string;

  protected ctx!: GameContext;
  /** Сколько раз игрок получил подсказку. */
  protected hintsUsed = 0;
  /** Итог партии (игра окончена, ждём «Далее»). */
  protected over: MinigameOutcomeKind | null = null;
  protected overWhy: EndWhy | null = null;

  private ui: Chrome | null = null;
  private fallback: GreyBoxMinigame | null = null;
  private offLang: (() => void) | null = null;
  private countdown: Countdown | null = null;
  private limitMs = 0;
  private paused = false;
  private finished = false;
  private destroyed = false;
  private busyHint = false;
  private statusFn: StatusFn | null = null;
  /** Партия начата: в раскладке 'stage' — после «Начать» на вступлении, в карточке — сразу. */
  private started = true;

  // ───────────────────────────── что реализует игра ─────────────────────────────

  /** Разобрать и проверить config; false — config непригоден (оболочка покажет grey-box). */
  protected abstract parse(cfg: MinigameConfig, ctx: GameContext): boolean;
  /** Построить DOM игрового поля — один раз после parse. */
  protected abstract build(): HTMLElement;
  /** Привести DOM поля в соответствие с состоянием и языком (идемпотентно, вызывается часто). */
  protected abstract paint(): void;
  /** Неудачи (промахи / ошибки) и их лимит (0 — без лимита). */
  protected abstract fails(): number;
  protected abstract failLimit(): number;
  /** Ключ подписи счётчика неудач: `ui.minigame.misses` или `ui.minigame.mistakes`. */
  protected abstract failLabelKey(): string;
  /** Прогресс «n из total» для строки «Найдено». */
  protected abstract progress(): { n: number; total: number };
  /** Цель достигнута, партия закончена успехом. */
  protected abstract isComplete(): boolean;
  /** Итог по текущему прогрессу (вызывается один раз, когда партия закончилась). */
  protected abstract evaluate(): MinigameOutcomeKind;
  /** Есть ли что подсказывать. */
  protected abstract canHint(): boolean;
  /** Открыть следующую подсказку (изменить состояние). */
  protected abstract giveHint(): void;
  /** Состояние игры для автосейва (только JSON). */
  protected abstract saveState(): Record<string, unknown>;
  /** Восстановить состояние игры; мусор игнорировать. */
  protected abstract loadState(state: Record<string, unknown>): void;
  /** Лимит времени из config игры (если схема допускает), мс; def.time_limit_ms приоритетнее. */
  protected cfgTimeLimitMs(): number {
    return 0;
  }
  /** Бесплатная подсказка (без рекламы) уже доступна? По умолчанию бесплатных подсказок нет. */
  protected freeHintReady(): boolean {
    return false;
  }
  /** Свои кнопки игры в строке действий (перед подсказкой и пропуском); создаются в build(). */
  protected extraActions(): HTMLElement[] {
    return [];
  }
  /** Показывать ли строку действий ради собственных кнопок, даже если подсказки и пропуска нет. */
  protected extraActionsVisible(): boolean {
    return false;
  }
  /**
   * Раскладка: 'card' — карточка с заголовком, полем и подвалом (по умолчанию); 'stage' — поле во весь экран, вступление
   * и итог поверх него, по ходу партии — перетаскиваемый блок (макеты Figma «Claude» 2026-10-13, осмотр места).
   */
  protected layout(): 'card' | 'stage' {
    return 'card';
  }
  /** Раскладка 'stage': список игры для блока (под заголовком). */
  protected panelList(): HTMLElement | null {
    return null;
  }
  /** Раскладка 'stage': куда поставить фокус после «Начать». */
  protected focusField(): void {
    /* по умолчанию — никуда */
  }
  /** Подробности на экране итога (под «Найдено»): например, что найдено и что это меняет в деле. По умолчанию нет. */
  protected resultDetails(): HTMLElement[] {
    return [];
  }

  // ───────────────────────────── помощники для игры ─────────────────────────────

  protected t(key: string, params?: Params): string {
    return this.ctx.t(key, params);
  }

  /** Принимает ли игра ввод: не окончена, не на паузе, не уничтожена. */
  protected canAct(): boolean {
    return this.started && !this.over && !this.paused && !this.finished && !this.destroyed && this.fallback === null;
  }

  /** Сообщение игроку (в том числе для скринридера); null — очистить. */
  protected say(fn: StatusFn | null): void {
    this.statusFn = fn;
    this.paintStatus();
  }

  /**
   * Сообщить, что «ход» сделан и состояние изменилось: перерисовать, проверить конец партии,
   * попросить автосейв. Вызывать ПОСЛЕ изменения состояния (serialize() уже должен его отдавать).
   */
  protected moved(): void {
    if (this.over || this.destroyed) return;
    if (this.isComplete()) this.conclude('done');
    else if (this.failLimit() > 0 && this.fails() >= this.failLimit()) this.conclude('limit');
    else {
      this.render();
      this.ctx.autosave();
    }
  }

  /** Перерисовать оболочку и поле (смена языка, подсказка, «ход»). */
  protected render(): void {
    const u = this.ui;
    if (!u || this.destroyed) return;
    const { ctx } = this;
    const t = (k: string, p?: Params): string => ctx.t(k, p);

    u.title.textContent = t(ctx.def.title_key);
    u.brief.textContent = t(ctx.def.brief_key);
    u.intro.hidden = !ctx.introKey;
    u.intro.textContent = ctx.introKey ? t(ctx.introKey) : '';
    u.root.setAttribute('aria-label', u.title.textContent);

    const st = u.stage;
    if (st) {
      st.heading.textContent = u.title.textContent;
      st.intro.hidden = this.started;
      st.dock.hidden = !this.started || this.over !== null;
      st.start.textContent = t('ui.minigame.start_search');
      st.move.textContent = t('ui.minigame.move');
      const lim = this.failLimit();
      st.attempts.hidden = lim <= 0;
      st.attempts.textContent = lim > 0 ? t(`ui.minigame.body_attempts_${pluralForm(lim, ctx.lang)}`, { n: lim }) : '';
    }

    const p = this.progress();
    u.progress.textContent = t('ui.minigame.found', { n: p.n, total: p.total });

    const limit = this.failLimit();
    u.fails.hidden = limit <= 0;
    if (limit > 0) {
      u.failsText.textContent = t(this.failLabelKey(), { n: Math.min(this.fails(), limit), max: limit });
      this.paintPips(limit);
    }

    u.timer.hidden = this.countdown === null;
    this.paintTimer(this.countdown ? this.countdown.remainingMs : 0);

    // Конец партии: вместо кнопок — итог и «Далее».
    const over = this.over;
    u.result.hidden = over === null;
    u.root.classList.toggle('is-over', over !== null);
    if (over) {
      u.result.dataset.outcome = over;
      u.resultTitle.textContent = t(OUTCOME_KEY[over]);
      const note = t('ui.minigame.found', { n: p.n, total: p.total });
      u.resultNote.textContent = this.overWhy === 'time' ? `${t('ui.minigame.time_up')}. ${note}` : note;
      fill(u.resultBody, ...this.resultDetails());
      u.resultBody.hidden = u.resultBody.childElementCount === 0;
      u.next.textContent = t('ui.common.next');
    }

    const mode = this.hintMode();
    u.hint.hidden = mode === null;
    u.hint.textContent = t(mode === 'ad' ? 'ui.minigame.hint_ad' : 'ui.minigame.hint');
    u.hint.disabled = this.busyHint;
    u.skip.hidden = !this.skipVisible();
    u.skip.textContent = t('ui.minigame.skip');
    u.skip.classList.toggle('is-primary', ctx.settings.storyOnly);
    u.actions.hidden = over !== null || (u.hint.hidden && u.skip.hidden && !this.extraActionsVisible());
    // Пустой подвал не занимает места.
    u.foot.hidden = u.actions.hidden && u.result.hidden;
    u.root.classList.toggle('no-foot', u.foot.hidden);

    this.paintStatus();
    this.paint();
  }

  // ───────────────────────────── IMinigame ─────────────────────────────

  mount(_root: Container, dom: HTMLElement, cfg: MinigameConfig, ctx: GameContext): void {
    this.ctx = ctx;
    let ok = false;
    try {
      ok = this.parse(cfg, ctx);
    } catch (e) {
      console.warn(`[minigame] ${this.type}: ошибка разбора config`, e);
    }
    if (!ok) {
      console.warn(`[minigame] ${ctx.def.id}: config непригоден для ${this.type} — показан grey-box`);
      const gb = new GreyBoxMinigame(this.type);
      gb.onResult = (r) => this.onResult(r);
      this.fallback = gb;
      gb.mount(_root, dom, cfg, ctx);
      return;
    }

    const defLimit = ctx.def.time_limit_ms ?? 0;
    this.limitMs = defLimit > 0 ? defLimit : this.cfgTimeLimitMs();
    // Таймеры уважают настройки доступности: выключены — игра без ограничения по времени.
    if (this.limitMs > 0 && ctx.settings.timers && !ctx.settings.storyOnly) {
      this.countdown = new Countdown(
        this.limitMs,
        () => this.onTimeUp(),
        (left) => this.paintTimer(left),
      );
    }

    const stage = this.layout() === 'stage';
    this.started = !stage;
    this.ui = stage ? this.buildStageChrome(this.build()) : this.buildChrome(this.build());
    dom.appendChild(this.ui.root);
    this.render();
    this.offLang = ctx.onLanguageChange(() => this.render());
    if (this.started) this.countdown?.start();
  }

  pause(): void {
    if (this.fallback) return this.fallback.pause();
    if (this.paused) return;
    this.paused = true;
    this.countdown?.pause();
    this.ui?.root.classList.add('is-paused');
  }

  resume(): void {
    if (this.fallback) return this.fallback.resume();
    if (!this.paused) return;
    this.paused = false;
    this.ui?.root.classList.remove('is-paused');
    if (!this.over && !this.destroyed && this.started) this.countdown?.start();
  }

  serialize(): unknown {
    if (this.fallback) return this.fallback.serialize();
    return {
      v: 1,
      hints: this.hintsUsed,
      over: this.over,
      why: this.overWhy,
      left: this.countdown ? Math.round(this.countdown.remainingMs) : null,
      started: this.started,
      t: this.saveState(),
    };
  }

  restore(state: unknown): void {
    if (this.fallback) {
      this.fallback.restore(state);
      return;
    }
    if (!isRecord(state) || this.destroyed) return;
    const hints = asInt(state.hints, 0);
    if (hints !== null) this.hintsUsed = hints;
    const over = OUTCOMES.find((x) => x === state.over) ?? null;
    this.over = over;
    this.overWhy = over ? (WHYS.find((x) => x === state.why) ?? 'done') : null;
    // Вступление раскладки 'stage': в старых сейвах поля нет — партия уже шла.
    this.started = over !== null || state.started !== false;
    const left = asInt(state.left, 0);
    if (left !== null && this.countdown) this.countdown.setRemaining(left);
    if (isRecord(state.t)) this.loadState(state.t);
    if (this.over) this.countdown?.stop();
    else if (this.started && !this.paused) this.countdown?.start();
    this.render();
  }

  destroy(): void {
    if (this.fallback) {
      this.fallback.destroy();
      this.fallback = null;
      this.destroyed = true;
      return;
    }
    if (this.destroyed) return;
    this.destroyed = true;
    this.countdown?.stop();
    this.countdown = null;
    this.offLang?.();
    this.offLang = null;
    this.ui?.root.remove();
    this.ui = null;
  }

  // ───────────────────────────── итог, пропуск, подсказки ─────────────────────────────

  /** Партия закончилась: посчитать итог, показать его и ждать «Далее». */
  protected conclude(why: EndWhy): void {
    if (this.over || this.destroyed) return;
    this.countdown?.stop();
    this.over = this.evaluate();
    this.overWhy = why;
    this.render();
    this.ui?.next.focus({ preventScroll: true });
    this.ctx.autosave();
  }

  /** «Начать осмотр» (раскладка 'stage'): вступление уходит, идёт время, поле принимает ввод. */
  private begin(): void {
    if (this.started || this.paused || this.destroyed) return;
    this.started = true;
    this.countdown?.start();
    this.render();
    this.focusField();
  }

  private onTimeUp(): void {
    if (this.over || this.destroyed) return;
    this.conclude('time');
  }

  /** Единственная точка, где вызывается onResult. */
  private finish(result: MinigameResult): void {
    if (this.finished || this.paused || this.destroyed) return;
    this.finished = true;
    this.countdown?.stop();
    this.onResult(result);
  }

  private skipVisible(): boolean {
    const skip = this.ctx.def.skip;
    if (!skip.allowed || this.over) return false;
    // «Только история»: пропуск доступен сразу; иначе — после N неудач (after_fails).
    return this.ctx.settings.storyOnly || this.fails() >= (skip.after_fails ?? 0);
  }

  /** 'ad' — подсказка за rewarded-рекламу; 'free' — бесплатная (по правилам игры); null — подсказки нет. */
  private hintMode(): 'ad' | 'free' | null {
    if (this.over || !this.canHint()) return null;
    if (this.ctx.def.skip.hint_rewarded_ad === true) return this.ctx.showRewarded ? 'ad' : null;
    return this.freeHintReady() ? 'free' : null;
  }

  private async askHint(): Promise<void> {
    const mode = this.hintMode();
    if (mode === null || this.busyHint || this.paused || this.destroyed) return;
    const id = this.ctx.def.id;
    if (mode === 'free') {
      this.hintsUsed += 1;
      this.giveHint();
      this.ctx.track('minigame_hint', { id, rewarded: false, free: true });
      this.render();
      this.ctx.autosave();
      return;
    }
    this.busyHint = true;
    this.render();
    let rewarded = false;
    try {
      rewarded = (await this.ctx.showRewarded?.()) === true;
    } catch (e) {
      console.warn('[minigame] rewarded:', e);
    }
    this.busyHint = false;
    this.ctx.track('minigame_hint', { id, rewarded });
    if (this.destroyed) return;
    if (rewarded && !this.over && this.canHint()) {
      this.hintsUsed += 1;
      this.giveHint();
      this.render();
      this.ctx.autosave();
    } else {
      this.render();
    }
  }

  // ───────────────────────────── разметка оболочки ─────────────────────────────

  /** Элементы оболочки: заголовок, бриф, строка состояния, кнопки, итог — общие для обеих раскладок. */
  private chromeParts(): ChromeParts {
    const title = h('h2', { class: 'mg-shell__title' });
    const brief = h('p', { class: 'mg-shell__brief' });
    const intro = h('p', { class: 'mg-shell__intro', hidden: true });
    const progress = h('span', { class: 'mg-shell__progress' });
    const failsText = h('span', { class: 'mg-shell__fails-text' });
    const pips = h('span', { class: 'mg-shell__pips', aria: { hidden: true } });
    const fails = h('span', { class: 'mg-shell__fails' }, failsText, pips);
    const timerText = h('span', { class: 'mg-shell__timer-text' });
    const timerBar = h('span', { class: 'mg-shell__timer-bar' });
    const timer = h('span', { class: 'mg-shell__timer', role: 'timer', hidden: true }, timerText, h('span', { class: 'mg-shell__timer-track', aria: { hidden: true } }, timerBar));
    const status = h('p', { class: 'mg-shell__status', role: 'status', aria: { live: 'polite' } });

    const hint = h('button', {
      class: 'mg-btn mg-shell__btn is-hint',
      type: 'button',
      hidden: true,
      on: { click: () => void this.askHint() },
    });
    const skip = h('button', {
      class: 'mg-btn mg-shell__btn is-skip',
      type: 'button',
      hidden: true,
      on: {
        click: () => {
          // Правила пропуска действуют и тогда, когда кнопку нажали программно.
          if (this.skipVisible()) this.finish('skipped');
        },
      },
    });
    const actions = h('div', { class: 'mg-shell__actions' }, ...this.extraActions(), hint, skip);

    const resultTitle = h('strong', { class: 'mg-shell__result-title' });
    const resultNote = h('span', { class: 'mg-shell__result-note' });
    const resultBody = h('div', { class: 'mg-shell__result-body', hidden: true });
    const next = h('button', {
      class: 'mg-btn mg-shell__btn is-next is-primary',
      type: 'button',
      on: {
        click: () => {
          if (this.over) this.finish(this.over);
        },
      },
    });
    const result = h('div', { class: 'mg-shell__result', hidden: true }, h('div', { class: 'mg-shell__result-text' }, resultTitle, resultNote, resultBody), next);
    return { title, brief, intro, progress, fails, failsText, pips, timer, timerText, timerBar, status, actions, hint, skip, result, resultTitle, resultNote, resultBody, next };
  }

  private buildChrome(body: HTMLElement): Chrome {
    const p = this.chromeParts();
    const foot = h('footer', { class: 'mg-shell__foot' }, p.actions, p.result);

    // Заголовок на узких экранах сжат: бриф — две строки, по тапу раскрывается целиком.
    p.brief.addEventListener('click', () => p.brief.classList.toggle('is-open'));

    const root = h(
      'section',
      { class: `mg-shell ${this.cls}`, role: 'group' },
      h('header', { class: 'mg-shell__head' }, p.title, p.intro, p.brief),
      h('div', { class: 'mg-shell__hud' }, p.progress, p.fails, p.timer),
      // Сообщение о ходе — сразу под строкой состояния: на телефоне поле игры ниже, а ответ на тап нужен на виду.
      p.status,
      h('div', { class: 'mg-shell__body' }, body),
      foot,
    );
    return { root, foot, ...p };
  }

  /**
   * Раскладка «сцена» (макеты Figma «Claude» 2026-10-13: «Game-start», «Game-process»): поле во весь экран; вступление —
   * вопрос, бриф, сколько попыток, «Начать осмотр»; по ходу — блок справа внизу (ручка «Переместить», вопрос, список
   * игры, линия, «Найдено» и попытки кружками, подсказка и пропуск); итог — тем же слоем, что вступление.
   */
  private buildStageChrome(body: HTMLElement): Chrome {
    const p = this.chromeParts();
    const heading = h('h2', { class: 'mg-stage__heading' });
    const attempts = h('p', { class: 'mg-stage__attempts' });
    const start = h('button', { class: 'mg-btn mg-shell__btn is-start is-primary', type: 'button', on: { click: () => this.begin() } });
    const intro = h(
      'div',
      { class: 'mg-stage__layer' },
      h('div', { class: 'mg-stage__col' }, heading, p.intro, h('div', { class: 'mg-stage__text' }, p.brief, attempts), start),
    );
    // Итог — колонкой по центру, как вступление.
    const col = h('div', { class: 'mg-stage__col' });
    col.append(...Array.from(p.result.childNodes));
    p.result.append(col);

    const move = h('span', { class: 'mg-stage__move' });
    const handle = h('div', { class: 'mg-stage__handle', aria: { hidden: true } }, move, icon('move'));
    const foot = h('footer', { class: 'mg-shell__foot' }, p.actions);
    const panel = h(
      'div',
      { class: 'mg-stage__panel' },
      p.title,
      this.panelList(),
      h('hr', { class: 'mg-stage__rule' }),
      h('div', { class: 'mg-stage__sum' }, p.progress, p.timer, p.fails),
      foot,
      p.status,
    );
    const dock = h('div', { class: 'mg-stage__dock' }, handle, panel);
    const root = h('section', { class: `mg-shell mg-stage ${this.cls}`, role: 'group' }, h('div', { class: 'mg-shell__body' }, body), dock, intro, p.result);
    this.makeDraggable(dock, handle, root);
    return { root, foot, ...p, stage: { intro, heading, attempts, start, dock, move } };
  }

  /** Блок раскладки 'stage' двигается за ручку мышью и пальцем и не выходит за поле. */
  private makeDraggable(dock: HTMLElement, handle: HTMLElement, root: HTMLElement): void {
    let from: { x: number; y: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      const d = dock.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      from = { x: e.clientX, y: e.clientY, left: d.left - r.left, top: d.top - r.top };
      handle.setPointerCapture?.(e.pointerId);
      dock.classList.add('is-dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!from) return;
      const r = root.getBoundingClientRect();
      const left = Math.min(Math.max(0, from.left + e.clientX - from.x), Math.max(0, r.width - dock.offsetWidth));
      const top = Math.min(Math.max(0, from.top + e.clientY - from.y), Math.max(0, r.height - dock.offsetHeight));
      Object.assign(dock.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    });
    const stop = (): void => {
      from = null;
      dock.classList.remove('is-dragging');
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  private paintPips(limit: number): void {
    const u = this.ui;
    if (!u) return;
    if (limit > 12) {
      u.pips.replaceChildren();
      return;
    }
    if (u.pips.childElementCount !== limit) {
      u.pips.replaceChildren(...Array.from({ length: limit }, () => h('span', { class: 'mg-shell__pip' })));
    }
    const used = this.fails();
    Array.from(u.pips.children).forEach((el, i) => el.classList.toggle('is-used', i < used));
  }

  private paintTimer(leftMs: number): void {
    const u = this.ui;
    if (!u || !this.countdown) return;
    u.timerText.textContent = formatTime(leftMs);
    u.timer.setAttribute('aria-label', this.ctx.t('ui.minigame.time_left', { time: formatTime(leftMs) }));
    u.timerBar.style.width = `${Math.max(0, Math.min(100, (leftMs / this.limitMs) * 100))}%`;
    u.timer.classList.toggle('is-low', leftMs <= 10000);
  }

  private paintStatus(): void {
    if (this.ui) this.ui.status.textContent = this.statusFn ? this.statusFn() : '';
  }
}
