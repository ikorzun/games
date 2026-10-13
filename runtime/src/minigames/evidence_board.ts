/**
 * Доска улик (evidence_board) — эпизод 1: mg_board, сцена s32.
 *
 * Игрок соединяет «нитками» узлы доски (квартиры, люди, имущество): тап по первому узлу, тап по
 * второму — связь. Повторный тап по связи (по нитке или по её значку) убирает её; тот же эффект —
 * ещё раз соединить ту же пару. Перетаскивания нет: тап — тап одинаково работает на тач, мыши и
 * клавиатуре (узлы и значки связей — настоящие кнопки).
 *
 * Правила (schemas/minigames/evidence_board.schema.json, docs/architecture/04-minigames.md):
 *  - Каждая новая связь проверяется сразу. Верная (пара из required_links) — красная нитка и значок ✓.
 *    Лишняя (decoy_links или любая другая пара) — серая пунктирная нитка и значок ✕, это ошибка.
 *    Ошибки считаются по уникальным парам и не возвращаются, когда нитку убирают.
 *  - Все required_links на доске → success (ошибок при этом не больше max_wrong_links, иначе партия
 *    закончилась бы раньше). Ошибок стало больше max_wrong_links или вышло время (def.time_limit_ms,
 *    если таймеры включены) → partial, если верных связей не меньше partial_threshold (по умолчанию 1),
 *    иначе fail.
 *  - «Пропустить» появляется по skip.allowed и skip.after_fails (после N ошибок); в режиме «только
 *    история» — сразу. Подсказка за rewarded-рекламу (skip.hint_rewarded_ad): подсвечивает пару узлов,
 *    которую стоит связать.
 *  - Конец партии не обрывает экран: итог показывается в нижней панели, onResult вызывается по кнопке
 *    «Далее» (ровно один раз). Пропуск отдаёт результат сразу.
 *
 * Состояние для автосейва (serialize/restore) — связи на доске, ошибки, выданные подсказки, остаток
 * времени и итог. ctx.autosave() вызывается после каждого «хода» (связь проведена или убрана,
 * подсказка выдана, партия закончена).
 *
 * Вёрстка: evidence_board.css. Если у узлов задан kind, люди стоят справа, всё остальное — слева
 * («слева квартиры, справа люди», s32); иначе — сетка в порядке конфига. Масштаб доски — кнопки,
 * Ctrl+колесо и щипок; при нехватке места доска прокручивается.
 */
import type { Container } from 'pixi.js';
import type { MinigameOutcomeKind, MinigameResult, Value } from '../core/types';
import { fill, h } from '../ui/dom';
import { GreyBoxMinigame } from './grey_box';
import { truthy } from './interrogation_press';
import { Countdown, formatTime } from './mg_timer';
import type { GameContext, IMinigame, MinigameConfig } from './types';
import './evidence_board.css';

export const TYPE = 'evidence_board' as const;

// ───────────────────────────── конфиг и чистая логика ─────────────────────────────

export type NodeKind = 'person' | 'flat' | 'property' | 'document';
const KINDS: readonly NodeKind[] = ['person', 'flat', 'property', 'document'];

export interface BoardNode {
  id: string;
  /** Ключ подписи узла; без него показывается id (заглушка для разработчика). */
  labelKey: string | null;
  kind: NodeKind | null;
}

export interface BoardSpec {
  nodes: BoardNode[];
  /** Верные связи: ключи пар (pairKey) в порядке конфига. */
  required: string[];
  /** Правдоподобные ложные связи (считаются ошибкой, как и любая другая лишняя пара). */
  decoys: ReadonlySet<string>;
  maxWrong: number;
  /** Сколько верных связей достаточно для partial (1…required.length). */
  partialAt: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Неориентированная пара узлов: «a|b», меньший id первым. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function splitKey(key: string): [string, string] {
  const i = key.indexOf('|');
  return [key.slice(0, i), key.slice(i + 1)];
}

/**
 * Читает config мини-игры; всё лишнее и битое (дубли, связи с неизвестными узлами) тихо отбрасывает. Узел с requires
 * стоит на доске, только если переменная эпизода истинна (на доске только найденное), а связи с ним без него не
 * считаются.
 */
export function parseBoard(cfg: MinigameConfig, vars: Readonly<Record<string, Value>> = {}): BoardSpec {
  const nodes: BoardNode[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(cfg.nodes) ? (cfg.nodes as unknown[]) : []) {
    let id: string | null = null;
    let labelKey: string | null = null;
    let kind: NodeKind | null = null;
    if (typeof raw === 'string') {
      id = raw;
    } else if (isRec(raw) && typeof raw.id === 'string') {
      id = raw.id;
      if (typeof raw.label_key === 'string' && raw.label_key !== '') labelKey = raw.label_key;
      if (typeof raw.kind === 'string' && (KINDS as readonly string[]).includes(raw.kind)) kind = raw.kind as NodeKind;
      if (typeof raw.requires === 'string' && !truthy(vars[raw.requires])) continue;
    }
    if (!id || id.includes('|') || ids.has(id)) continue;
    ids.add(id);
    nodes.push({ id, labelKey, kind });
  }

  const pairs = (v: unknown): string[] => {
    const out: string[] = [];
    for (const p of Array.isArray(v) ? (v as unknown[]) : []) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const [a, b] = p as unknown[];
      if (typeof a !== 'string' || typeof b !== 'string' || a === b || !ids.has(a) || !ids.has(b)) continue;
      const key = pairKey(a, b);
      if (!out.includes(key)) out.push(key);
    }
    return out;
  };
  const required = pairs(cfg.required_links);
  const decoys = new Set(pairs(cfg.decoy_links).filter((k) => !required.includes(k)));

  const int = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt);
  const maxWrong = Math.max(0, int(cfg.max_wrong_links, 3));
  const partialAt = Math.min(Math.max(1, int(cfg.partial_threshold, 1)), Math.max(1, required.length));
  return { nodes, required, decoys, maxWrong, partialAt };
}

/** Итог по числу верных связей (когда партия закончилась не победой: ошибки или время). */
export function boardOutcome(found: number, total: number, partialAt: number): MinigameOutcomeKind {
  if (total === 0 || found >= total) return 'success';
  return found >= partialAt ? 'partial' : 'fail';
}

export interface Cell {
  col: number;
  row: number;
}

/**
 * Раскладка по сторонам доски: люди — справа, всё остальное — слева (квартиры, затем имущество,
 * затем документы). Работает, только если у узлов есть kind и в нём есть и люди, и не-люди;
 * иначе (sided = false) узлы идут обычной сеткой в порядке конфига.
 */
export function layoutCells(nodes: readonly BoardNode[]): { sided: boolean; cells: Map<string, Cell> } {
  const cells = new Map<string, Cell>();
  const people = nodes.filter((n) => n.kind === 'person');
  const rest = nodes.filter((n) => n.kind !== 'person');
  const sided = people.length > 0 && rest.some((n) => n.kind !== null);
  if (!sided) return { sided, cells };
  const rank = (n: BoardNode): number => (n.kind === null ? KINDS.length : KINDS.indexOf(n.kind));
  const left = rest
    .map((n, i) => ({ n, i }))
    .sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i)
    .map((x) => x.n);
  left.forEach((n, row) => cells.set(n.id, { col: 0, row }));
  people.forEach((n, row) => cells.set(n.id, { col: 1, row }));
  return { sided, cells };
}

/** Точка на границе прямоугольника, в которую упирается луч из центра к точке (tx, ty). */
export function edgePoint(r: Rect, tx: number, ty: number): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

const rnd = (n: number): number => Math.round(n * 10) / 10;

export interface Thread {
  /** Путь SVG (квадратичная кривая). */
  d: string;
  /** Точка на нитке при параметре t ∈ [0, 1] (0.5 — середина). */
  at(t: number): Pt;
}

/** Провисающая нитка между двумя точками. */
export function threadPath(a: Pt, b: Pt): Thread {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const sag = Math.min(14, len * 0.07);
  const cx = (a.x + b.x) / 2 + nx * sag * 2;
  const cy = (a.y + b.y) / 2 + ny * sag * 2;
  const at = (t: number): Pt => {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
  };
  return { d: `M${rnd(a.x)} ${rnd(a.y)} Q${rnd(cx)} ${rnd(cy)} ${rnd(b.x)} ${rnd(b.y)}`, at };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Где повесить значки верно/неверно: у каждой нитки — середина; если значки двух ниток
 * налезают друг на друга (нитки перекрещиваются и середины совпадают), их по очереди
 * раздвигают вдоль собственных ниток, пока расстояние не станет не меньше minGap
 * (или пока нитки не кончатся: значок не уходит дальше 20–80 % длины).
 */
export function placeBadges(threads: readonly Thread[], minGap: number): Pt[] {
  const ts = threads.map(() => 0.5);
  const points = (): Pt[] => threads.map((th, i) => th.at(ts[i] ?? 0.5));
  for (let pass = 0; pass < 14; pass++) {
    const p = points();
    let moved = false;
    for (let i = 0; i < threads.length; i++) {
      const th = threads[i];
      const pi = p[i];
      if (!th || !pi) continue;
      for (let j = 0; j < threads.length; j++) {
        const pj = p[j];
        if (i === j || !pj) continue;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        if (Math.hypot(dx, dy) >= minGap) continue;
        // Двигаем вдоль касательной от соседа; совпавшие значки расходятся по номеру.
        const t0 = ts[i] ?? 0.5;
        const a = th.at(Math.max(0, t0 - 0.01));
        const b = th.at(Math.min(1, t0 + 0.01));
        const away = dx * (b.x - a.x) + dy * (b.y - a.y);
        const sign = Math.hypot(dx, dy) < 1e-6 ? (i < j ? -1 : 1) : away >= 0 ? 1 : -1;
        const next = clamp(t0 + sign * 0.05, 0.2, 0.8);
        if (next !== t0) {
          ts[i] = next;
          moved = true;
        }
        break;
      }
    }
    if (!moved) break;
  }
  return points();
}

const humanize = (id: string): string => {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ───────────────────────────── значки и SVG ─────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...kids: SVGElement[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

type IconName = NodeKind | 'ok' | 'bad' | 'minus' | 'plus' | 'fit';

/** Контуры 24×24. stroke — рисуется линией (иначе заливкой). */
const ICONS: Record<IconName, { d: string; stroke?: boolean }> = {
  person: { d: 'M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Zm0 2c-4.2 0-8 2.1-8 5.2V21h16v-1.8c0-3.1-3.8-5.2-8-5.2Z' },
  flat: { d: 'M12 3 2.5 11.2h2.7V21h5.2v-6h3.2v6h5.2v-9.8h2.7L12 3Z' },
  property: { d: 'M9 4a2 2 0 0 0-2 2v1H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3V6a2 2 0 0 0-2-2H9Zm0 2h6v1H9V6Z' },
  document: { d: 'M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5L13 3.5ZM8 12h8v1.6H8V12Zm0 3.4h8V17H8v-1.6Z' },
  ok: { d: 'M6.5 12.5l3.6 3.6 7.4-7.6', stroke: true },
  bad: { d: 'M8 8l8 8M16 8l-8 8', stroke: true },
  minus: { d: 'M6 12h12', stroke: true },
  plus: { d: 'M12 6v12M6 12h12', stroke: true },
  fit: { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', stroke: true },
};

function icon(name: IconName, cls: string): SVGSVGElement {
  const spec = ICONS[name];
  return svg(
    'svg',
    { viewBox: '0 0 24 24', class: spec.stroke ? `${cls} is-stroke` : cls, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: spec.d }),
  );
}

// ───────────────────────────── мини-игра ─────────────────────────────

type Status =
  | { k: 'idle' }
  | { k: 'first'; id: string }
  | { k: 'ok' | 'bad' | 'removed' | 'hint'; a: string; b: string };

/** Шаги масштаба доски (множитель шрифта листа). */
export const ZOOMS = [0.7, 0.85, 1, 1.2, 1.45] as const;
const ZOOM_HOME = 2;

interface Els {
  title: HTMLElement;
  intro: HTMLElement | null;
  brief: HTMLElement;
  howtoSummary: HTMLElement | null;
  progress: HTMLElement;
  zoomOut: HTMLButtonElement;
  zoomFit: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  viewport: HTMLElement;
  sheet: HTMLElement;
  grid: HTMLElement;
  threads: SVGSVGElement;
  badges: HTMLElement;
  time: HTMLElement | null;
  timeBar: HTMLElement | null;
  meter: HTMLElement;
  status: HTMLElement;
  actions: HTMLElement;
  result: HTMLElement;
}

class EvidenceBoard implements IMinigame {
  onResult: (result: MinigameResult) => void = () => undefined;

  private ctx!: GameContext;
  private spec: BoardSpec = { nodes: [], required: [], decoys: new Set(), maxWrong: 3, partialAt: 1 };
  /** Запасной grey-box: config непригоден для настоящей механики, эпизод остаётся проходимым. */
  private fallback: GreyBoxMinigame | null = null;
  private host: HTMLElement | null = null;
  private view: HTMLElement | null = null;
  private els: Els | null = null;
  private readonly nodeEls = new Map<string, HTMLButtonElement>();
  private cells = new Map<string, Cell>();
  private offLang: (() => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private timer: Countdown | null = null;
  private timeTotal = 0;

  // Состояние партии (то, что уходит в serialize).
  private links: string[] = [];
  private tried = new Set<string>();
  private hints: string[] = [];
  private outcome: MinigameOutcomeKind | null = null;
  /** Партия закончилась по времени (а не по ошибкам или победе). */
  private timedOut = false;
  // Временное состояние.
  private selected: string | null = null;
  private status: Status = { k: 'idle' };
  private lastAdded: string | null = null;
  private zoomIdx = ZOOM_HOME;
  private hintBusy = false;
  private paused = false;
  private delivered = false;
  private destroyed = false;

  // ───────────── IMinigame ─────────────

  mount(root: Container, dom: HTMLElement, cfg: MinigameConfig, ctx: GameContext): void {
    this.ctx = ctx;
    this.spec = parseBoard(cfg, ctx.vars());
    if (this.spec.nodes.length < 2 || this.spec.required.length === 0) {
      console.warn(`[minigame] ${ctx.def.id}: config непригоден для ${TYPE} — показан grey-box`);
      const gb = new GreyBoxMinigame(TYPE);
      gb.onResult = (r) => this.onResult(r);
      this.fallback = gb;
      gb.mount(root, dom, cfg, ctx);
      return;
    }
    this.cells = layoutCells(this.spec.nodes).cells;
    this.host = dom;
    dom.classList.add('mg-host-eb');
    // Таймер — только если он есть в данных, включён в настройках и это не режим «только история».
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
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.paintThreads());
    if (typeof document !== 'undefined' && 'fonts' in document) void document.fonts.ready.then(() => this.paintThreads());
  }

  pause(): void {
    if (this.fallback) return this.fallback.pause();
    this.paused = true;
    this.timer?.pause();
    this.view?.classList.add('is-paused');
  }

  resume(): void {
    if (this.fallback) return this.fallback.resume();
    this.paused = false;
    this.view?.classList.remove('is-paused');
    if (this.outcome === null) this.timer?.start();
  }

  serialize(): unknown {
    if (this.fallback) return this.fallback.serialize();
    return {
      v: 1,
      links: [...this.links],
      tried: [...this.tried],
      hints: [...this.hints],
      left: this.timer ? Math.round(this.timer.remainingMs) : null,
      result: this.outcome,
      timeout: this.timedOut,
    };
  }

  restore(state: unknown): void {
    if (this.fallback) return this.fallback.restore(state);
    if (this.destroyed || !isRec(state)) return;
    const known = (k: unknown): k is string => {
      if (typeof k !== 'string') return false;
      const [a, b] = splitKey(k);
      return a !== b && this.nodeEls.has(a) && this.nodeEls.has(b) && pairKey(a, b) === k;
    };
    const uniq = (xs: string[]): string[] => [...new Set(xs)];
    if (Array.isArray(state.links)) this.links = uniq((state.links as unknown[]).filter(known));
    if (Array.isArray(state.tried)) this.tried = new Set((state.tried as unknown[]).filter(known).filter((k) => !this.isRequired(k)));
    for (const k of this.links) if (!this.isRequired(k)) this.tried.add(k); // лишняя связь на доске всегда была ошибкой
    if (Array.isArray(state.hints)) {
      this.hints = uniq((state.hints as unknown[]).filter(known).filter((k) => this.isRequired(k) && !this.links.includes(k)));
    }
    if (typeof state.left === 'number' && Number.isFinite(state.left) && this.timer && !this.timer.done) {
      this.timer.setRemaining(state.left);
    }
    const r = state.result;
    if (r === 'success' || r === 'partial' || r === 'fail') {
      this.outcome = r;
      this.timedOut = state.timeout === true;
      this.timer?.stop();
    }
    this.selected = null;
    this.status = { k: 'idle' };
    this.render();
    if (this.outcome === null && this.timer && !this.timer.done && this.timer.remainingMs <= 0) this.onTimeUp();
  }

  destroy(): void {
    if (this.fallback) {
      this.fallback.destroy();
      return;
    }
    if (this.destroyed) return;
    this.destroyed = true;
    this.timer?.stop();
    this.offLang?.();
    this.offLang = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.view?.remove();
    this.view = null;
    this.host?.classList.remove('mg-host-eb');
    this.host = null;
    this.els = null;
    this.nodeEls.clear();
  }

  // ───────────── правила ─────────────

  private isRequired(key: string): boolean {
    return this.spec.required.includes(key);
  }

  private foundCount(): number {
    return this.spec.required.filter((k) => this.links.includes(k)).length;
  }

  /** Ошибок сделано (уникальных лишних пар). */
  private get mistakes(): number {
    return this.tried.size;
  }

  private canAct(): boolean {
    return !this.destroyed && !this.paused && !this.delivered && this.outcome === null;
  }

  private toggleLink(a: string, b: string): void {
    const key = pairKey(a, b);
    const at = this.links.indexOf(key);
    if (at >= 0) {
      this.links.splice(at, 1);
      this.status = { k: 'removed', a, b };
    } else {
      this.links.push(key);
      this.lastAdded = key;
      this.hints = this.hints.filter((k) => k !== key);
      if (this.isRequired(key)) {
        this.status = { k: 'ok', a, b };
      } else {
        this.tried.add(key);
        this.status = { k: 'bad', a, b };
      }
    }
    this.afterMove();
  }

  private removeLink(key: string): void {
    if (!this.canAct()) return;
    const at = this.links.indexOf(key);
    if (at < 0) return;
    const [a, b] = splitKey(key);
    this.links.splice(at, 1);
    this.status = { k: 'removed', a, b };
    this.afterMove();
  }

  /** Проверка конца партии, перерисовка и автосейв после каждого хода. */
  private afterMove(): void {
    const total = this.spec.required.length;
    const found = this.foundCount();
    if (found >= total) this.conclude('success');
    else if (this.mistakes > this.spec.maxWrong) this.conclude(boardOutcome(found, total, this.spec.partialAt));
    else this.render();
    this.ctx.autosave();
  }

  private onTimeUp(): void {
    if (this.destroyed || this.outcome !== null) return;
    this.timedOut = true;
    this.conclude(boardOutcome(this.foundCount(), this.spec.required.length, this.spec.partialAt));
    this.ctx.autosave();
  }

  private conclude(outcome: MinigameOutcomeKind): void {
    if (this.outcome !== null) return;
    this.outcome = outcome;
    this.selected = null;
    this.timer?.stop();
    this.render();
    this.els?.result.querySelector<HTMLElement>('[data-focus="done"]')?.focus({ preventScroll: true });
  }

  private deliver(result: MinigameResult): void {
    if (this.delivered || this.destroyed) return;
    this.delivered = true;
    this.timer?.stop();
    this.onResult(result);
  }

  private skipVisible(): boolean {
    const { def, settings } = this.ctx;
    if (!def.skip.allowed || this.outcome !== null) return false;
    return settings.storyOnly || this.mistakes >= (def.skip.after_fails ?? 0);
  }

  private nextHintKey(): string | null {
    return this.spec.required.find((k) => !this.links.includes(k) && !this.hints.includes(k)) ?? null;
  }

  private hintVisible(): boolean {
    return (
      this.ctx.def.skip.hint_rewarded_ad === true &&
      typeof this.ctx.showRewarded === 'function' &&
      this.outcome === null &&
      this.nextHintKey() !== null
    );
  }

  private async askHint(): Promise<void> {
    const show = this.ctx.showRewarded;
    if (!show || this.hintBusy || this.paused || !this.hintVisible()) return;
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
    const key = ok && this.outcome === null ? this.nextHintKey() : null;
    if (key !== null) {
      this.hints.push(key);
      const [a, b] = splitKey(key);
      this.status = { k: 'hint', a, b };
      this.ctx.autosave();
    }
    this.render();
  }

  // ───────────── DOM ─────────────

  private labelOf(id: string): string {
    const node = this.spec.nodes.find((n) => n.id === id);
    if (!node) return id;
    return node.labelKey ? this.ctx.t(node.labelKey) : humanize(id);
  }

  private build(): void {
    const { ctx } = this;
    const hasIntro = ctx.introKey !== null;
    const title = h('h2', { class: 'mg-eb__title' });
    const intro = hasIntro ? h('p', { class: 'mg-eb__intro' }) : null;
    const brief = h('p', { class: 'mg-eb__brief' });
    const howtoSummary = hasIntro ? h('summary', { class: 'mg-eb__howto-sum' }) : null;
    const howto = howtoSummary ? h('details', { class: 'mg-eb__howto' }, howtoSummary, brief) : null;
    const progress = h('p', { class: 'mg-eb__progress' });
    const head = h('header', { class: 'mg-eb__head' }, h('div', { class: 'mg-eb__bar' }, title, progress), intro, howto ?? brief);

    const zbtn = (name: 'minus' | 'fit' | 'plus', step: -1 | 0 | 1): HTMLButtonElement =>
      h('button', { class: 'mg-eb__zbtn', type: 'button', on: { click: () => this.zoomBy(step) } }, icon(name, 'mg-eb__zicon'));
    const zoomOut = zbtn('minus', -1);
    const zoomFit = zbtn('fit', 0);
    const zoomIn = zbtn('plus', 1);

    const { sided } = layoutCells(this.spec.nodes);
    for (const n of this.spec.nodes) {
      const cell = this.cells.get(n.id);
      const btn = h(
        'button',
        {
          class: `mg-eb__node${n.kind ? ` is-${n.kind}` : ''}`,
          type: 'button',
          data: { node: n.id },
          ...(cell ? { style: { 'grid-column': String(cell.col + 1), 'grid-row': String(cell.row + 1) } } : {}),
          on: { click: () => this.onNode(n.id) },
        },
        n.kind ? icon(n.kind, 'mg-eb__icon') : null,
        h('span', { class: 'mg-eb__label' }),
      );
      this.nodeEls.set(n.id, btn);
    }
    const grid = h('div', { class: `mg-eb__grid ${sided ? 'is-sided' : 'is-plain'}` }, ...this.nodeEls.values());
    const threads = svg('svg', { class: 'mg-eb__threads', 'aria-hidden': 'true', focusable: 'false' });
    threads.addEventListener('click', (e) => {
      const key = (e.target as Element | null)?.closest('[data-link]')?.getAttribute('data-link');
      if (key) this.removeLink(key);
    });
    const badges = h('div', { class: 'mg-eb__badges' });
    badges.addEventListener('click', (e) => {
      const key = (e.target as Element | null)?.closest('[data-link]')?.getAttribute('data-link');
      if (key) this.removeLink(key);
    });
    const sheet = h('div', { class: 'mg-eb__sheet', role: 'group' }, threads, grid, badges);
    const viewport = h('div', { class: 'mg-eb__viewport' }, sheet);
    this.bindZoomGestures(viewport);

    const meter = h('div', { class: 'mg-eb__meter' });
    const zoom = h('div', { class: 'mg-eb__zoom', role: 'group' }, zoomOut, zoomFit, zoomIn);
    const status = h('p', { class: 'mg-eb__status', role: 'status' });
    const actions = h('div', { class: 'mg-actions mg-eb__actions' });
    const result = h('div', { class: 'mg-eb__result', role: 'status', hidden: true });
    const foot = h('div', { class: 'mg-eb__foot' }, h('div', { class: 'mg-eb__row' }, meter, zoom), status, actions, result);

    const timeBar = h('span', { class: 'mg-eb__time-bar' });
    const time = this.timeTotal > 0 ? h('div', { class: 'mg-eb__time', role: 'progressbar' }, timeBar) : null;

    this.view = h('div', { class: 'mg-eb', role: 'group', tabindex: -1 }, time, head, viewport, foot);
    this.view.addEventListener('keydown', (e) => {
      // Esc снимает выбор узла и не доходит до глобального «открыть настройки».
      if (e.key === 'Escape' && this.selected !== null && this.canAct()) {
        e.stopPropagation();
        e.preventDefault();
        this.selected = null;
        this.status = { k: 'idle' };
        this.render();
      }
    });
    this.els = { title, intro, brief, howtoSummary, progress, zoomOut, zoomFit, zoomIn, viewport, sheet, grid, threads, badges, time, timeBar, meter, status, actions, result };

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.paintThreads());
      this.resizeObs.observe(viewport);
      this.resizeObs.observe(grid);
    }
  }

  private bindZoomGestures(viewport: HTMLElement): void {
    viewport.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );
    // Щипок двумя пальцами: шаг масштаба на каждые ~20 % изменения расстояния.
    let base: number | null = null;
    const dist = (t: TouchList): number => Math.hypot((t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0), (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0));
    viewport.addEventListener('touchstart', (e) => (base = e.touches.length === 2 ? dist(e.touches) : null), { passive: true });
    viewport.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 2 || base === null || base <= 0) return;
        const d = dist(e.touches);
        if (d / base > 1.22) {
          this.zoomBy(1);
          base = d;
        } else if (d / base < 0.82) {
          this.zoomBy(-1);
          base = d;
        }
      },
      { passive: true },
    );
    viewport.addEventListener('touchend', () => (base = null), { passive: true });
  }

  private onNode(id: string): void {
    if (!this.canAct()) return;
    const first = this.selected;
    if (first === null) {
      this.selected = id;
      this.status = { k: 'first', id };
    } else if (first === id) {
      this.selected = null;
      this.status = { k: 'idle' };
    } else {
      this.selected = null;
      this.toggleLink(first, id);
      return;
    }
    this.render();
  }

  /** step: −1 / +1 — на шаг; 0 — «вся доска» (самый крупный масштаб ≤ 100 %, при котором лист помещается). */
  private zoomBy(step: -1 | 0 | 1): void {
    const e = this.els;
    if (!e) return;
    if (step === 0) {
      let idx = ZOOM_HOME;
      for (; idx > 0; idx--) {
        e.sheet.style.setProperty('--mg-eb-zoom', String(ZOOMS[idx]));
        if (e.viewport.scrollHeight <= e.viewport.clientHeight + 1 && e.viewport.scrollWidth <= e.viewport.clientWidth + 1) break;
      }
      this.zoomIdx = idx;
    } else {
      this.zoomIdx = Math.min(ZOOMS.length - 1, Math.max(0, this.zoomIdx + step));
    }
    this.render();
  }

  private statusText(): string {
    const { t } = this.ctx;
    const s = this.status;
    switch (s.k) {
      case 'idle':
        return t('ui.minigame.board.pick_first');
      case 'first':
        return t('ui.minigame.board.body.pick_second', { name: this.labelOf(s.id) });
      case 'ok':
        return t('ui.minigame.board.link_ok', { a: this.labelOf(s.a), b: this.labelOf(s.b) });
      case 'bad':
        return t('ui.minigame.board.link_bad', { a: this.labelOf(s.a), b: this.labelOf(s.b) });
      case 'removed':
        return t('ui.minigame.board.link_removed', { a: this.labelOf(s.a), b: this.labelOf(s.b) });
      case 'hint':
        return t('ui.minigame.board.body.hint', { a: this.labelOf(s.a), b: this.labelOf(s.b) });
    }
  }

  private paintTime(left: number): void {
    const e = this.els;
    if (!e?.time || !e.timeBar || this.timeTotal <= 0) return;
    const text = this.ctx.t('ui.minigame.time_left', { time: formatTime(left) });
    if (e.time.getAttribute('aria-valuetext') !== text) {
      e.time.setAttribute('aria-valuemin', '0');
      e.time.setAttribute('aria-valuemax', String(this.timeTotal));
      e.time.setAttribute('aria-valuenow', String(Math.round(left)));
      e.time.setAttribute('aria-valuetext', text);
      e.time.setAttribute('aria-label', text);
    }
    e.timeBar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / this.timeTotal))})`;
  }

  /** Подписи, состояния узлов, нижняя панель; затем нитки. Вызывается после каждого изменения. */
  private render(): void {
    const e = this.els;
    if (!e || !this.view || this.destroyed) return;
    const { t, def } = this.ctx;
    const over = this.outcome !== null;
    const total = this.spec.required.length;

    this.view.setAttribute('aria-label', t(def.title_key));
    this.view.classList.toggle('is-over', over);
    e.title.textContent = t(def.title_key);
    if (e.intro && this.ctx.introKey) e.intro.textContent = t(this.ctx.introKey);
    e.brief.textContent = t(def.brief_key);
    if (e.howtoSummary) e.howtoSummary.textContent = t('ui.minigame.howto');
    e.progress.textContent = t('ui.minigame.board.progress', { n: this.foundCount(), total });
    e.sheet.setAttribute('aria-label', t('ui.minigame.board.label'));
    e.sheet.style.setProperty('--mg-eb-zoom', String(ZOOMS[this.zoomIdx]));

    const zoomLabels: Array<[HTMLButtonElement, string, boolean]> = [
      [e.zoomOut, 'ui.minigame.board.zoom_out', this.zoomIdx <= 0],
      [e.zoomFit, 'ui.minigame.board.zoom_fit', false],
      [e.zoomIn, 'ui.minigame.board.zoom_in', this.zoomIdx >= ZOOMS.length - 1],
    ];
    for (const [btn, key, off] of zoomLabels) {
      btn.setAttribute('aria-label', t(key));
      btn.title = t(key);
      btn.disabled = off;
    }

    const hinted = new Set(this.hints.flatMap((k) => splitKey(k)));
    for (const n of this.spec.nodes) {
      const el = this.nodeEls.get(n.id);
      if (!el) continue;
      const label = this.labelOf(n.id);
      const span = el.querySelector('.mg-eb__label');
      if (span && span.textContent !== label) span.textContent = label;
      el.setAttribute('aria-pressed', String(this.selected === n.id));
      el.setAttribute('aria-disabled', String(over));
      el.classList.toggle('is-selected', this.selected === n.id);
      el.classList.toggle('is-hint', hinted.has(n.id));
      el.classList.toggle('is-linked', this.links.some((k) => splitKey(k).includes(n.id)));
    }

    this.renderFoot();
    this.paintThreads();
  }

  private renderFoot(): void {
    const e = this.els;
    if (!e) return;
    const { t } = this.ctx;
    const over = this.outcome !== null;
    e.meter.hidden = over;
    e.status.hidden = over;
    e.actions.hidden = over;
    e.result.hidden = !over;

    // Ошибки: точки (если их немного) и подпись.
    const max = this.spec.maxWrong;
    const used = this.mistakes;
    const dots = max > 0 && max <= 8 ? Array.from({ length: max }, (_, i) => h('span', { class: `mg-eb__dot${i < used ? ' is-used' : ''}` })) : [];
    const mistakesText = t('ui.minigame.mistakes', { n: used, max });
    fill(
      e.meter,
      dots.length > 0 ? h('span', { class: 'mg-eb__dots', role: 'img', aria: { label: mistakesText } }, ...dots) : null,
      h('span', { class: 'mg-eb__mtext', text: mistakesText }),
    );
    const statusText = this.statusText();
    if (e.status.textContent !== statusText) e.status.textContent = statusText;

    const keepFocus = e.actions.contains(document.activeElement) ? document.activeElement?.getAttribute('data-focus') : null;
    fill(
      e.actions,
      this.hintVisible()
        ? h('button', {
            class: 'mg-btn is-hint',
            type: 'button',
            disabled: this.hintBusy,
            text: t('ui.minigame.hint_ad'),
            data: { focus: 'hint' },
            on: { click: () => void this.askHint() },
          })
        : null,
      this.skipVisible()
        ? h('button', {
            class: `mg-btn is-skip${this.ctx.settings.storyOnly ? ' is-primary' : ''}`,
            type: 'button',
            text: t('ui.minigame.skip'),
            data: { focus: 'skip' },
            on: { click: () => this.skip() },
          })
        : null,
    );
    if (keepFocus) e.actions.querySelector<HTMLElement>(`[data-focus="${keepFocus}"]`)?.focus({ preventScroll: true });

    if (over && this.outcome !== null) {
      const out = this.outcome;
      const heading = t(out === 'success' ? 'ui.minigame.success' : out === 'partial' ? 'ui.minigame.partial' : 'ui.minigame.fail');
      fill(
        e.result,
        h('h3', { class: `mg-eb__verdict is-${out}`, text: heading }),
        this.timedOut ? h('p', { class: 'mg-eb__why', text: t('ui.minigame.time_up') }) : null,
        h('p', {
          class: 'mg-eb__summary',
          text: t('ui.minigame.board.body.result', { n: this.foundCount(), total: this.spec.required.length, wrong: this.mistakes }),
        }),
        h(
          'div',
          { class: 'mg-actions' },
          h('button', {
            class: 'mg-btn is-primary',
            type: 'button',
            text: t('ui.common.next'),
            data: { focus: 'done' },
            on: { click: () => this.done() },
          }),
        ),
      );
    } else {
      fill(e.result);
    }
  }

  private done(): void {
    if (this.paused || this.outcome === null) return;
    this.deliver(this.outcome);
  }

  private skip(): void {
    if (!this.canAct() || !this.skipVisible()) return;
    this.deliver('skipped');
  }

  // ───────────── нитки ─────────────

  /** Прямоугольники узлов относительно листа; без раскладки (jsdom, скрытый экран) — условные. */
  private measure(): Map<string, Rect> {
    const e = this.els;
    const out = new Map<string, Rect>();
    if (!e) return out;
    const sr = e.sheet.getBoundingClientRect();
    let real = sr.width > 0 && sr.height > 0;
    if (real) {
      for (const [id, el] of this.nodeEls) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) {
          real = false;
          break;
        }
        out.set(id, { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height });
      }
    }
    if (real) return out;
    out.clear();
    this.spec.nodes.forEach((n, i) => {
      const c = this.cells.get(n.id) ?? { col: i % 3, row: Math.floor(i / 3) };
      out.set(n.id, { x: c.col * 160, y: c.row * 90, w: 120, h: 60 });
    });
    return out;
  }

  private paintThreads(): void {
    const e = this.els;
    if (!e || this.destroyed) return;
    const rects = this.measure();
    interface Item {
      key: string;
      a: string;
      b: string;
      pa: Pt;
      pb: Pt;
      thread: Thread;
    }
    const items: Item[] = [];
    for (const key of this.links) {
      const [a, b] = splitKey(key);
      const ra = rects.get(a);
      const rb = rects.get(b);
      if (!ra || !rb) continue;
      const pa = edgePoint(ra, rb.x + rb.w / 2, rb.y + rb.h / 2);
      const pb = edgePoint(rb, ra.x + ra.w / 2, ra.y + ra.h / 2);
      items.push({ key, a, b, pa, pb, thread: threadPath(pa, pb) });
    }
    // Значки не должны налезать друг на друга: расстояние — два шрифта листа (он уже учитывает масштаб).
    const fontPx = parseFloat(getComputedStyle(e.sheet).fontSize);
    const spots = placeBadges(
      items.map((i) => i.thread),
      (Number.isFinite(fontPx) && fontPx > 0 ? fontPx : 15) * 2,
    );
    const lines: SVGElement[] = [];
    const badges: HTMLElement[] = [];
    items.forEach((it, n) => {
      const mid = spots[n] ?? it.thread.at(0.5);
      const ok = this.isRequired(it.key);
      const fresh = this.lastAdded === it.key;
      lines.push(
        svg(
          'g',
          { class: `mg-eb__thread ${ok ? 'is-ok' : 'is-bad'}${fresh ? ' is-new' : ''}`, 'data-link': it.key },
          svg('path', { class: 'mg-eb__thread-hit', d: it.thread.d }),
          svg('path', { class: 'mg-eb__thread-line', d: it.thread.d }),
          svg('circle', { class: 'mg-eb__pin', cx: rnd(it.pa.x), cy: rnd(it.pa.y), r: 4 }),
          svg('circle', { class: 'mg-eb__pin', cx: rnd(it.pb.x), cy: rnd(it.pb.y), r: 4 }),
        ),
      );
      const label = this.ctx.t('ui.minigame.board.remove_link', { a: this.labelOf(it.a), b: this.labelOf(it.b) });
      badges.push(
        h(
          'button',
          {
            class: `mg-eb__badge ${ok ? 'is-ok' : 'is-bad'}${fresh ? ' is-new' : ''}`,
            type: 'button',
            title: label,
            aria: { label },
            data: { link: it.key },
            style: { left: `${rnd(mid.x)}px`, top: `${rnd(mid.y)}px` },
          },
          h('span', { class: 'mg-eb__bdot' }, icon(ok ? 'ok' : 'bad', 'mg-eb__bicon')),
        ),
      );
    });
    this.lastAdded = null;
    fill(e.threads, ...lines);
    fill(e.badges, ...badges);
  }
}

export function createEvidenceBoard(): IMinigame {
  return new EvidenceBoard();
}
