/**
 * Допрос (interrogation_press) — эпизод 1: mg_interrogation, сцена s39.
 *
 * Диалоговая подача (Ace Attorney): сверху реплика подозреваемого, снизу крупные карточки улик.
 * Утверждения идут по очереди (config.statements). Для текущего утверждения игрок предъявляет улику:
 *  - верная (есть в contradicted_by) «ломает» утверждение — штамп «Опровергнуто»;
 *  - неверная — ошибка (точка в счётчике загорается), карточка для этого утверждения гаснет;
 *  - «Надавить» (если у утверждения есть press_key) — подозреваемый отвечает, ошибки нет;
 *  - «Оставить без ответа» — утверждение остаётся нетронутым, идём дальше.
 * Ошибок max_mistakes — допрос обрывается («он замолчал»). Итог по числу опровергнутых утверждений:
 * ≥ full_threshold — success, ≥ partial_threshold — partial, иначе fail. Как и у доски улик, итог
 * показывается в нижней панели, а onResult вызывается по кнопке «Далее» (ровно один раз);
 * пропуск отдаёт результат сразу.
 *
 * Улики — переменные эпизода: игроку показываются только доступные карточки (requires истинна в
 * ctx.vars()) и приманки (улики без requires: они ничего не опровергают). Откуда берётся requires:
 * у улики-объекта — из неё самой; у улики-строки — из утверждения (единственная улика в
 * contradicted_by или первая из тех, у кого условия ещё нет).
 *
 * Таймер (def.time_limit_ms) — на весь допрос, только при settings.timers и не в «только истории».
 * «Пропустить» — по skip.allowed и skip.after_fails (после N ошибок), в «только истории» сразу.
 * Подсказка (skip.hint_rewarded_ad + ctx.showRewarded): подсвечивает карточку, которая опровергает
 * текущее утверждение, либо сообщает, что подходящей улики нет. serialize/restore — прогресс допроса;
 * ctx.autosave() после каждого хода. Вёрстка: interrogation_press.css.
 */
import type { Container } from 'pixi.js';
import type { MinigameOutcomeKind, MinigameResult, Value } from '../core/types';
import { fill, h } from '../ui/dom';
import { Countdown } from './mg_timer';
import type { GameContext, IMinigame, MinigameConfig } from './types';
import './interrogation_press.css';

export const TYPE = 'interrogation_press' as const;

// ───────────────────────────── конфиг и чистая логика ─────────────────────────────

export interface Statement {
  id: string;
  textKey: string;
  /** Улики, любая из которых опровергает утверждение. */
  contradictedBy: string[];
  requires: string | null;
  pressKey: string | null;
}

export interface Evidence {
  id: string;
  labelKey: string | null;
  /** Переменная эпизода, без которой улики нет; null — улика есть всегда (приманка). */
  requires: string | null;
}

export interface InterrogationSpec {
  suspect: string | null;
  statements: Statement[];
  evidence: Evidence[];
  full: number;
  partial: number;
  maxMistakes: number;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt);

/** Читает config мини-игры; битое (дубли, пустые id, без текста) тихо отбрасывает. */
export function parseInterrogation(cfg: MinigameConfig): InterrogationSpec {
  const statements: Statement[] = [];
  const seenSt = new Set<string>();
  for (const raw of Array.isArray(cfg.statements) ? (cfg.statements as unknown[]) : []) {
    if (!isRec(raw)) continue;
    const id = str(raw.id);
    const textKey = str(raw.text_key);
    if (!id || !textKey || seenSt.has(id)) continue;
    const by = Array.isArray(raw.contradicted_by) ? (raw.contradicted_by as unknown[]) : [raw.contradicted_by];
    const contradictedBy = [...new Set(by.map(str).filter((x): x is string => x !== null))];
    seenSt.add(id);
    statements.push({ id, textKey, contradictedBy, requires: str(raw.requires), pressKey: str(raw.press_key) });
  }

  const evidence: Evidence[] = [];
  const asString = new Set<string>(); // улики, заданные строкой: условие берём из утверждений
  const seenEv = new Set<string>();
  for (const raw of Array.isArray(cfg.evidence) ? (cfg.evidence as unknown[]) : []) {
    const id = typeof raw === 'string' ? str(raw) : isRec(raw) ? str(raw.id) : null;
    if (!id || seenEv.has(id)) continue;
    seenEv.add(id);
    if (typeof raw === 'string') asString.add(id);
    evidence.push({ id, labelKey: isRec(raw) ? str(raw.label_key) : null, requires: isRec(raw) ? str(raw.requires) : null });
  }
  // Условие для строковых улик: сначала утверждения, где улика единственная, затем первая свободная в списке.
  const bound = new Set<string>();
  const bind = (evId: string, variable: string): void => {
    const ev = evidence.find((e) => e.id === evId);
    if (ev && asString.has(evId) && !bound.has(evId)) {
      ev.requires = variable;
      bound.add(evId);
    }
  };
  for (const st of statements) if (st.requires && st.contradictedBy.length === 1) bind(st.contradictedBy[0] as string, st.requires);
  for (const st of statements) {
    if (!st.requires || st.contradictedBy.length < 2) continue;
    const free = st.contradictedBy.find((id) => asString.has(id) && !bound.has(id));
    if (free) bind(free, st.requires);
  }

  const total = Math.max(1, statements.length);
  const full = Math.min(Math.max(1, int(cfg.full_threshold, total)), total);
  const partial = Math.min(Math.max(1, int(cfg.partial_threshold, 1)), full);
  return { suspect: str(cfg.suspect), statements, evidence, full, partial, maxMistakes: Math.max(1, int(cfg.max_mistakes, 3)) };
}

/** Истинность переменной эпизода для `requires` (bool; число — не 0; строка — не пустая и не none/false). */
export function truthy(v: Value | undefined): boolean {
  if (typeof v === 'string') return v !== '' && v !== 'none' && v !== 'false' && v !== '0';
  return Boolean(v);
}

/** Итог по числу опровергнутых утверждений. */
export function interrogationOutcome(broken: number, full: number, partial: number): MinigameOutcomeKind {
  if (broken >= full) return 'success';
  return broken >= partial ? 'partial' : 'fail';
}

const humanize = (id: string): string => {
  const s = id.replace(/^ev_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ───────────────────────────── значки ─────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(d: string, cls: string, stroke = false): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', stroke ? `${cls} is-stroke` : cls);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  el.appendChild(path);
  return el;
}

const DOC_ICON = 'M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5L13 3.5ZM8 12h8v1.6H8V12Zm0 3.4h8V17H8v-1.6Z';
const OK_ICON = 'M6.5 12.5l3.6 3.6 7.4-7.6';
const BAD_ICON = 'M8 8l8 8M16 8l-8 8';

// ───────────────────────────── мини-игра ─────────────────────────────

type Note =
  | { k: 'none' }
  | { k: 'wrong' | 'broken'; ev: string }
  | { k: 'hint'; ev: string | null }
  | { k: 'silenced' };

type StKind = 'open' | 'broken' | 'passed';

interface Els {
  kicker: HTMLElement;
  count: HTMLElement;
  lives: HTMLElement;
  intro: HTMLElement | null;
  brief: HTMLElement;
  howtoSummary: HTMLElement | null;
  pips: HTMLElement;
  speaker: HTMLElement;
  bubble: HTMLElement;
  bubbleBody: HTMLElement;
  feedback: HTMLElement;
  cardsTitle: HTMLElement;
  grid: HTMLElement;
  actions: HTMLElement;
  result: HTMLElement;
  time: HTMLElement | null;
  timeBar: HTMLElement | null;
}

class InterrogationPress implements IMinigame {
  onResult: (result: MinigameResult) => void = () => undefined;

  private ctx!: GameContext;
  private spec: InterrogationSpec = { suspect: null, statements: [], evidence: [], full: 1, partial: 1, maxMistakes: 3 };
  /** Карточки, доступные игроку (фиксируются при mount по переменным эпизода). */
  private cards: Evidence[] = [];
  private host: HTMLElement | null = null;
  private view: HTMLElement | null = null;
  private els: Els | null = null;
  private offLang: (() => void) | null = null;
  private timer: Countdown | null = null;
  private timeTotal = 0;

  // Состояние допроса (то, что уходит в serialize).
  private index = 0;
  private broken = new Map<string, string>(); // утверждение → улика, которой его опровергли
  private passed = new Set<string>();
  private wrong = new Set<string>(); // «утверждение|улика» — ошибочные предъявления
  private pressed = new Set<string>();
  private hinted = new Set<string>();
  private outcome: MinigameOutcomeKind | null = null;
  // Временное состояние.
  private note: Note = { k: 'none' };
  private fx: 'shake' | 'stamp' | null = null;
  private hintBusy = false;
  private paused = false;
  private delivered = false;
  private destroyed = false;

  // ───────────── IMinigame ─────────────

  mount(_root: Container, dom: HTMLElement, cfg: MinigameConfig, ctx: GameContext): void {
    this.ctx = ctx;
    this.spec = parseInterrogation(cfg);
    const vars = ctx.vars();
    this.cards = this.spec.evidence.filter((e) => e.requires === null || truthy(vars[e.requires]));
    this.host = dom;
    dom.classList.add('mg-host-ip');
    const limit = ctx.def.time_limit_ms ?? 0;
    this.timeTotal = limit > 0 && ctx.settings.timers && !ctx.settings.storyOnly ? limit : 0;
    this.build();
    dom.appendChild(this.view as HTMLElement);
    this.offLang = ctx.onLanguageChange(() => this.render());
    if (this.timeTotal > 0) {
      this.timer = new Countdown(
        this.timeTotal,
        () => this.onTimeUp(),
        (left) => this.paintTime(left),
      );
      this.paintTime(this.timeTotal);
      this.timer.start();
    }
    this.render();
    this.view?.focus({ preventScroll: true });
    if (this.spec.statements.length === 0) this.conclude(); // допрашивать нечего: не держим игрока
  }

  pause(): void {
    this.paused = true;
    this.timer?.pause();
    this.view?.classList.add('is-paused');
  }

  resume(): void {
    this.paused = false;
    this.view?.classList.remove('is-paused');
    if (this.outcome === null) this.timer?.start();
  }

  serialize(): unknown {
    return {
      v: 1,
      index: this.index,
      broken: [...this.broken.entries()],
      passed: [...this.passed],
      wrong: [...this.wrong],
      pressed: [...this.pressed],
      hinted: [...this.hinted],
      left: this.timer ? Math.round(this.timer.remainingMs) : null,
      result: this.outcome,
    };
  }

  restore(state: unknown): void {
    if (this.destroyed || !isRec(state)) return;
    const stIds = new Set(this.spec.statements.map((s) => s.id));
    const evIds = new Set(this.spec.evidence.map((e) => e.id));
    const strings = (v: unknown, ok: (s: string) => boolean): string[] =>
      Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === 'string' && ok(x)))] : [];
    const stIdsOf = (v: unknown): string[] => strings(v, (s) => stIds.has(s));

    if (Array.isArray(state.broken)) {
      this.broken = new Map();
      for (const pair of state.broken as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [st, ev] = pair as unknown[];
        if (typeof st === 'string' && typeof ev === 'string' && stIds.has(st) && evIds.has(ev)) this.broken.set(st, ev);
      }
    }
    if (Array.isArray(state.passed)) this.passed = new Set(stIdsOf(state.passed).filter((s) => !this.broken.has(s)));
    if (Array.isArray(state.wrong)) {
      this.wrong = new Set(
        strings(state.wrong, (s) => {
          const [st = '', ev = ''] = s.split('|');
          return stIds.has(st) && evIds.has(ev);
        }),
      );
    }
    if (Array.isArray(state.pressed)) this.pressed = new Set(stIdsOf(state.pressed));
    if (Array.isArray(state.hinted)) this.hinted = new Set(stIdsOf(state.hinted));
    if (typeof state.index === 'number' && Number.isFinite(state.index)) {
      this.index = Math.min(Math.max(0, Math.floor(state.index)), Math.max(0, this.spec.statements.length - 1));
    }
    if (typeof state.left === 'number' && Number.isFinite(state.left) && this.timer && !this.timer.done) {
      this.timer.setRemaining(state.left);
    }
    const r = state.result;
    if (r === 'success' || r === 'partial' || r === 'fail') {
      this.outcome = r;
      this.timer?.stop();
    }
    this.note = { k: 'none' };
    this.fx = null;
    this.render();
    if (this.outcome === null && this.timer && !this.timer.done && this.timer.remainingMs <= 0) this.onTimeUp();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timer?.stop();
    this.offLang?.();
    this.offLang = null;
    this.view?.remove();
    this.view = null;
    this.host?.classList.remove('mg-host-ip');
    this.host = null;
    this.els = null;
  }

  // ───────────── правила ─────────────

  private get mistakes(): number {
    return this.wrong.size;
  }

  private current(): Statement | undefined {
    return this.spec.statements[this.index];
  }

  private kindOf(st: Statement): StKind {
    return this.broken.has(st.id) ? 'broken' : this.passed.has(st.id) ? 'passed' : 'open';
  }

  private isLast(): boolean {
    return this.index >= this.spec.statements.length - 1;
  }

  private canAct(): boolean {
    return !this.destroyed && !this.paused && !this.delivered && this.outcome === null;
  }

  private present(evId: string): void {
    if (!this.canAct()) return;
    const st = this.current();
    if (!st || this.kindOf(st) !== 'open' || !this.cards.some((c) => c.id === evId)) return;
    const key = `${st.id}|${evId}`;
    if (this.wrong.has(key)) return;
    if (st.contradictedBy.includes(evId)) {
      this.broken.set(st.id, evId);
      this.fx = 'stamp';
      this.note = { k: 'broken', ev: evId };
      if (this.isLast()) this.conclude();
    } else {
      this.wrong.add(key);
      this.fx = 'shake';
      this.note = { k: 'wrong', ev: evId };
      if (this.mistakes >= this.spec.maxMistakes) {
        this.note = { k: 'silenced' };
        this.conclude();
      }
    }
    this.step();
  }

  private press(): void {
    const st = this.current();
    if (!this.canAct() || !st?.pressKey || this.kindOf(st) !== 'open') return;
    this.pressed.add(st.id);
    this.note = { k: 'none' };
    this.step();
  }

  /** «Далее» (утверждение закрыто) или «Оставить без ответа» (открыто). */
  private advance(): void {
    const st = this.current();
    if (!this.canAct() || !st) return;
    if (this.kindOf(st) === 'open') this.passed.add(st.id);
    this.note = { k: 'none' };
    if (this.isLast()) this.conclude();
    else this.index += 1;
    this.step();
  }

  private step(): void {
    this.render();
    this.ctx.autosave();
  }

  private brokenCount(): number {
    return this.broken.size;
  }

  private conclude(): void {
    if (this.outcome !== null) return;
    this.outcome = interrogationOutcome(this.brokenCount(), this.spec.full, this.spec.partial);
    this.timer?.stop();
    this.render();
    this.els?.result.querySelector<HTMLElement>('[data-focus="done"]')?.focus({ preventScroll: true });
  }

  private onTimeUp(): void {
    if (this.destroyed || this.outcome !== null) return;
    this.conclude();
    this.ctx.autosave();
  }

  private deliver(result: MinigameResult): void {
    if (this.delivered || this.destroyed) return;
    this.delivered = true;
    this.timer?.stop();
    this.onResult(result);
  }

  private done(): void {
    if (this.paused || this.outcome === null) return;
    this.deliver(this.outcome);
  }

  private skip(): void {
    if (!this.canAct() || !this.skipVisible()) return;
    this.deliver('skipped');
  }

  private skipVisible(): boolean {
    const { def, settings } = this.ctx;
    if (!def.skip.allowed || this.outcome !== null) return false;
    return settings.storyOnly || this.mistakes >= (def.skip.after_fails ?? 0);
  }

  /** Карточка, которая опровергает утверждение (из доступных игроку). */
  private answerFor(st: Statement): string | null {
    return st.contradictedBy.find((id) => this.cards.some((c) => c.id === id)) ?? null;
  }

  private hintVisible(): boolean {
    const st = this.current();
    return (
      this.ctx.def.skip.hint_rewarded_ad === true &&
      typeof this.ctx.showRewarded === 'function' &&
      this.outcome === null &&
      st !== undefined &&
      this.kindOf(st) === 'open' &&
      !this.hinted.has(st.id)
    );
  }

  private async askHint(): Promise<void> {
    const show = this.ctx.showRewarded;
    const st = this.current();
    if (!show || !st || this.hintBusy || this.paused || !this.hintVisible()) return;
    this.hintBusy = true;
    this.render();
    let ok = false;
    try {
      ok = await show();
    } catch {
      ok = false;
    }
    this.hintBusy = false;
    this.ctx.track('minigame_hint', { id: this.ctx.def.id, rewarded: ok });
    if (this.destroyed) return;
    if (ok && this.outcome === null && this.current() === st && this.kindOf(st) === 'open') {
      this.hinted.add(st.id);
      this.note = { k: 'hint', ev: this.answerFor(st) };
      this.ctx.autosave();
    }
    this.render();
  }

  // ───────────── DOM ─────────────

  private labelOf(ev: Evidence | string): string {
    const e = typeof ev === 'string' ? this.spec.evidence.find((x) => x.id === ev) : ev;
    if (!e) return typeof ev === 'string' ? ev : '';
    return e.labelKey ? this.ctx.t(e.labelKey) : humanize(e.id);
  }

  private suspectName(): { name: string; color: string | null } | null {
    const id = this.spec.suspect;
    if (!id) return null;
    const c = this.ctx.episode.cast.find((x) => x.id === id);
    return c ? { name: this.ctx.t(c.short_name_key ?? c.name_key), color: c.name_color ?? null } : null;
  }

  private build(): void {
    const { ctx } = this;
    const hasIntro = ctx.introKey !== null;
    const kicker = h('h2', { class: 'mg-ip__kicker' });
    const count = h('span', { class: 'mg-ip__count' });
    const lives = h('span', { class: 'mg-ip__lives' });
    const intro = hasIntro ? h('p', { class: 'mg-ip__intro' }) : null;
    const brief = h('p', { class: 'mg-ip__brief' });
    const howtoSummary = hasIntro ? h('summary', { class: 'mg-ip__howto-sum' }) : null;
    const howto = howtoSummary ? h('details', { class: 'mg-ip__howto' }, howtoSummary, brief) : null;
    const pips = h('ol', { class: 'mg-ip__pips' });
    const head = h(
      'header',
      { class: 'mg-ip__head' },
      h('div', { class: 'mg-ip__bar' }, kicker, count, lives),
      intro,
      howto ?? brief,
      pips,
    );

    const speaker = h('p', { class: 'mg-ip__speaker' });
    const bubbleBody = h('div', { class: 'mg-ip__bubble-body' });
    const bubble = h('blockquote', { class: 'mg-ip__bubble' }, bubbleBody);
    const feedback = h('p', { class: 'mg-ip__feedback', role: 'status' });
    const scene = h('section', { class: 'mg-ip__scene' }, speaker, bubble, feedback);

    const cardsTitle = h('h3', { class: 'mg-ip__cards-title' });
    const grid = h('div', { class: 'mg-ip__grid' });
    const cardsBox = h('section', { class: 'mg-ip__cards' }, cardsTitle, grid);
    const main = h('div', { class: 'mg-ip__main' }, scene, cardsBox);

    const actions = h('div', { class: 'mg-actions mg-ip__actions' });
    const result = h('div', { class: 'mg-ip__result', role: 'status', hidden: true });
    const foot = h('footer', { class: 'mg-ip__foot' }, actions, result);

    const timeBar = h('span', { class: 'mg-ip__time-bar' });
    const time = this.timeTotal > 0 ? h('div', { class: 'mg-ip__time', role: 'progressbar' }, timeBar) : null;

    this.view = h('div', { class: 'mg-ip', role: 'group', tabindex: -1 }, time, head, main, foot);
    this.view.addEventListener('keydown', (e) => {
      // Цифры 1…9 предъявляют соответствующую карточку.
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
      const card = this.visibleCards()[Number(e.key) - 1];
      if (!card) return;
      e.preventDefault();
      this.present(card.id);
    });
    this.els = { kicker, count, lives, intro, brief, howtoSummary, pips, speaker, bubble, bubbleBody, feedback, cardsTitle, grid, actions, result, time, timeBar };
  }

  private visibleCards(): Evidence[] {
    return this.cards;
  }

  private paintTime(left: number): void {
    const e = this.els;
    if (!e?.time || !e.timeBar || this.timeTotal <= 0) return;
    e.time.setAttribute('aria-valuemin', '0');
    e.time.setAttribute('aria-valuemax', String(this.timeTotal));
    e.time.setAttribute('aria-valuenow', String(Math.round(left)));
    e.time.setAttribute('aria-label', this.ctx.t('ui.minigame.time_left'));
    e.timeBar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / this.timeTotal))})`;
  }

  private noteText(): string {
    const { t } = this.ctx;
    const n = this.note;
    switch (n.k) {
      case 'none':
        return '';
      case 'wrong':
        return t('ui.minigame.interrogation.body.wrong');
      case 'broken':
        return `${t('ui.minigame.interrogation.broken')}: ${this.labelOf(n.ev)}`;
      case 'silenced':
        return t('ui.minigame.interrogation.body.silenced');
      case 'hint':
        return n.ev === null
          ? t('ui.minigame.interrogation.body.hint_none')
          : t('ui.minigame.interrogation.body.hint_card', { name: this.labelOf(n.ev) });
    }
  }

  private render(): void {
    const e = this.els;
    if (!e || !this.view || this.destroyed) return;
    const { t, def } = this.ctx;
    const st = this.current();
    const over = this.outcome !== null;
    const total = this.spec.statements.length;
    const kind: StKind = st ? this.kindOf(st) : 'passed';

    this.view.setAttribute('aria-label', t(def.title_key));
    this.view.classList.toggle('is-over', over);
    e.kicker.textContent = t(def.title_key);
    e.count.textContent = t('ui.minigame.interrogation.statement', { n: Math.min(this.index + 1, Math.max(1, total)), total });
    if (e.intro && this.ctx.introKey) e.intro.textContent = t(this.ctx.introKey);
    e.brief.textContent = t(def.brief_key);
    if (e.howtoSummary) e.howtoSummary.textContent = t('ui.minigame.howto');

    // Ошибки: точки по числу max_mistakes (если их немного), иначе число.
    const max = this.spec.maxMistakes;
    const used = this.mistakes;
    const mistakesText = t('ui.minigame.mistakes', { used, max });
    fill(
      e.lives,
      ...(max <= 8
        ? Array.from({ length: max }, (_, i) => h('span', { class: `mg-ip__dot${i < used ? ' is-used' : ''}` }))
        : [h('span', { class: 'mg-ip__mtext', text: mistakesText })]),
    );
    e.lives.setAttribute('role', 'img');
    e.lives.setAttribute('aria-label', mistakesText);
    e.lives.title = mistakesText;

    // Полоска утверждений: опровергнуто / без ответа / текущее / впереди.
    fill(
      e.pips,
      ...this.spec.statements.map((s, i) => {
        const k = this.kindOf(s);
        const stateName = k === 'broken' ? t('ui.minigame.interrogation.broken') : k === 'passed' ? t('ui.minigame.interrogation.passed') : '';
        const label = t('ui.minigame.interrogation.statement', { n: i + 1, total });
        return h('li', {
          class: `mg-ip__pip is-${k}${i === this.index ? ' is-current' : ''}`,
          aria: { label: stateName ? `${label}: ${stateName}` : label },
        });
      }),
    );

    // Реплика подозреваемого.
    const who = this.suspectName();
    e.speaker.hidden = who === null;
    e.speaker.textContent = who?.name ?? '';
    if (who?.color) e.speaker.style.setProperty('--ip-name', who.color);
    else e.speaker.style.removeProperty('--ip-name');
    e.bubble.dataset.state = kind;
    e.bubble.classList.toggle('is-broken', kind === 'broken');
    fill(
      e.bubbleBody,
      st ? h('p', { class: 'mg-ip__statement', text: t(st.textKey) }) : null,
      st && this.pressed.has(st.id) && st.pressKey ? h('p', { class: 'mg-ip__press', text: t(st.pressKey) }) : null,
      kind === 'broken'
        ? h('span', { class: `mg-ip__stamp${this.fx === 'stamp' ? ' is-fresh' : ''}`, text: t('ui.minigame.interrogation.broken') })
        : kind === 'passed' && !over
          ? h('span', { class: 'mg-ip__tag', text: t('ui.minigame.interrogation.passed') })
          : null,
    );
    if (this.fx === 'shake') {
      e.bubble.classList.remove('is-shake');
      void e.bubble.offsetWidth; // перезапустить анимацию
      e.bubble.classList.add('is-shake');
    } else {
      e.bubble.classList.remove('is-shake');
    }
    this.fx = null;
    e.feedback.textContent = this.noteText();

    this.renderCards(st, kind);
    this.renderFoot(st, kind);
  }

  private renderCards(st: Statement | undefined, kind: StKind): void {
    const e = this.els;
    if (!e) return;
    const { t } = this.ctx;
    e.cardsTitle.textContent = t('ui.minigame.interrogation.evidence');
    const over = this.outcome !== null;
    const hintCard = st && this.hinted.has(st.id) ? this.answerFor(st) : null;
    const usedCard = st ? this.broken.get(st.id) : undefined;
    const focusId = e.grid.contains(document.activeElement) ? document.activeElement?.getAttribute('data-focus') : null;

    if (this.cards.length === 0) {
      fill(e.grid, h('p', { class: 'mg-ip__empty', text: t('ui.minigame.interrogation.body.no_evidence') }));
      return;
    }
    fill(
      e.grid,
      ...this.cards.map((card, i) => {
        const name = this.labelOf(card);
        const tried = st ? this.wrong.has(`${st.id}|${card.id}`) : false;
        const isUsed = usedCard === card.id;
        const locked = over || kind !== 'open' || tried;
        const cls = ['mg-ip__card'];
        if (tried) cls.push('is-wrong');
        if (isUsed) cls.push('is-used');
        if (hintCard === card.id && kind === 'open') cls.push('is-hint');
        if (locked && !isUsed && !tried) cls.push('is-locked');
        return h(
          'button',
          {
            class: cls.join(' '),
            type: 'button',
            aria: {
              label: tried
                ? t('ui.minigame.interrogation.tried', { name })
                : t('ui.minigame.interrogation.present', { name }),
              disabled: locked,
            },
            data: { ev: card.id, focus: `card:${card.id}` },
            on: { click: () => this.present(card.id) },
          },
          svgIcon(DOC_ICON, 'mg-ip__icon'),
          h('span', { class: 'mg-ip__label', text: name }),
          h('span', { class: 'mg-ip__num', text: String(i + 1), aria: { hidden: true } }),
          tried ? svgIcon(BAD_ICON, 'mg-ip__mark', true) : isUsed ? svgIcon(OK_ICON, 'mg-ip__mark is-ok', true) : null,
        );
      }),
    );
    if (focusId) e.grid.querySelector<HTMLElement>(`[data-focus="${focusId}"]`)?.focus({ preventScroll: true });
  }

  private renderFoot(st: Statement | undefined, kind: StKind): void {
    const e = this.els;
    if (!e) return;
    const { t } = this.ctx;
    const over = this.outcome !== null;
    e.actions.hidden = over;
    e.result.hidden = !over;

    const focusId = e.actions.contains(document.activeElement) ? document.activeElement?.getAttribute('data-focus') : null;
    const btn = (cls: string, text: string, focus: string, onClick: () => void, disabled = false): HTMLButtonElement =>
      h('button', { class: `mg-btn ${cls}`, type: 'button', disabled, text, data: { focus }, on: { click: onClick } });
    fill(
      e.actions,
      st?.pressKey && kind === 'open' ? btn('is-press', t('ui.minigame.interrogation.press'), 'press', () => this.press()) : null,
      st
        ? kind === 'open'
          ? btn('is-pass', t('ui.minigame.interrogation.pass'), 'advance', () => this.advance())
          : btn('is-primary is-next', t('ui.common.next'), 'advance', () => this.advance())
        : null,
      this.hintVisible() ? btn('is-hint', t('ui.minigame.hint_ad'), 'hint', () => void this.askHint(), this.hintBusy) : null,
      this.skipVisible() ? btn(`is-skip${this.ctx.settings.storyOnly ? ' is-primary' : ''}`, t('ui.minigame.skip'), 'skip', () => this.skip()) : null,
    );
    if (focusId) e.actions.querySelector<HTMLElement>(`[data-focus="${focusId}"]`)?.focus({ preventScroll: true });

    if (over && this.outcome !== null) {
      const out = this.outcome;
      fill(
        e.result,
        h('h3', {
          class: `mg-ip__verdict is-${out}`,
          text: t(out === 'success' ? 'ui.minigame.success' : out === 'partial' ? 'ui.minigame.partial' : 'ui.minigame.fail'),
        }),
        h('p', {
          class: 'mg-ip__summary',
          text: t('ui.minigame.interrogation.body.result', {
            broken: this.brokenCount(),
            total: this.spec.statements.length,
            mistakes: this.mistakes,
          }),
        }),
        h(
          'div',
          { class: 'mg-actions' },
          btn('is-primary', t('ui.common.next'), 'done', () => this.done()),
        ),
      );
    } else {
      fill(e.result);
    }
  }
}

export function createInterrogationPress(): IMinigame {
  return new InterrogationPress();
}
