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
import { h } from '../ui/dom';
import { GreyBoxMinigame } from './grey_box';
import { Countdown } from './mg_timer';
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

/** m:ss, секунды округляются вверх (0:01 — последняя секунда). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  actions: HTMLElement;
  hint: HTMLButtonElement;
  skip: HTMLButtonElement;
  result: HTMLElement;
  resultTitle: HTMLElement;
  resultNote: HTMLElement;
  next: HTMLButtonElement;
}

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

  // ───────────────────────────── помощники для игры ─────────────────────────────

  protected t(key: string, params?: Params): string {
    return this.ctx.t(key, params);
  }

  /** Принимает ли игра ввод: не окончена, не на паузе, не уничтожена. */
  protected canAct(): boolean {
    return !this.over && !this.paused && !this.finished && !this.destroyed && this.fallback === null;
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
    u.actions.hidden = over !== null;
    u.root.classList.toggle('is-over', over !== null);
    if (over) {
      u.result.dataset.outcome = over;
      u.resultTitle.textContent = t(OUTCOME_KEY[over]);
      const note = t('ui.minigame.found', { n: p.n, total: p.total });
      u.resultNote.textContent = this.overWhy === 'time' ? `${t('ui.minigame.time_up')}. ${note}` : note;
      u.next.textContent = t('ui.common.next');
    }

    const mode = this.hintMode();
    u.hint.hidden = mode === null;
    u.hint.textContent = t(mode === 'ad' ? 'ui.minigame.hint_ad' : 'ui.minigame.hint');
    u.hint.disabled = this.busyHint;
    const skipVisible = this.skipVisible();
    u.skip.hidden = !skipVisible;
    u.skip.textContent = t('ui.minigame.skip');
    u.skip.classList.toggle('is-primary', ctx.settings.storyOnly);

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

    this.ui = this.buildChrome(this.build());
    dom.appendChild(this.ui.root);
    this.render();
    this.offLang = ctx.onLanguageChange(() => this.render());
    this.countdown?.start();
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
    if (!this.over && !this.destroyed) this.countdown?.start();
  }

  serialize(): unknown {
    if (this.fallback) return this.fallback.serialize();
    return {
      v: 1,
      hints: this.hintsUsed,
      over: this.over,
      why: this.overWhy,
      left: this.countdown ? Math.round(this.countdown.remainingMs) : null,
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
    const left = asInt(state.left, 0);
    if (left !== null && this.countdown) this.countdown.setRemaining(left);
    if (isRecord(state.t)) this.loadState(state.t);
    if (this.over) this.countdown?.stop();
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

  private buildChrome(body: HTMLElement): Chrome {
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
    const actions = h('div', { class: 'mg-shell__actions' }, hint, skip);

    const resultTitle = h('strong', { class: 'mg-shell__result-title' });
    const resultNote = h('span', { class: 'mg-shell__result-note' });
    const next = h('button', {
      class: 'mg-btn mg-shell__btn is-next is-primary',
      type: 'button',
      on: {
        click: () => {
          if (this.over) this.finish(this.over);
        },
      },
    });
    const result = h('div', { class: 'mg-shell__result', hidden: true }, h('div', { class: 'mg-shell__result-text' }, resultTitle, resultNote), next);

    // Заголовок на узких экранах сжат: бриф — две строки, по тапу раскрывается целиком.
    brief.addEventListener('click', () => brief.classList.toggle('is-open'));

    const root = h(
      'section',
      { class: `mg-shell ${this.cls}`, role: 'group' },
      h('header', { class: 'mg-shell__head' }, title, intro, brief),
      h('div', { class: 'mg-shell__hud' }, progress, fails, timer),
      h('div', { class: 'mg-shell__body' }, body),
      status,
      h('footer', { class: 'mg-shell__foot' }, actions, result),
    );
    return { root, title, brief, intro, progress, fails, failsText, pips, timer, timerText, timerBar, status, actions, hint, skip, result, resultTitle, resultNote, next };
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
    u.timerText.textContent = formatClock(leftMs);
    u.timer.setAttribute('aria-label', this.ctx.t('ui.minigame.time_left', { time: formatClock(leftMs) }));
    u.timerBar.style.width = `${Math.max(0, Math.min(100, (leftMs / this.limitMs) * 100))}%`;
    u.timer.classList.toggle('is-low', leftMs <= 10000);
  }

  private paintStatus(): void {
    if (this.ui) this.ui.status.textContent = this.statusFn ? this.statusFn() : '';
  }
}
