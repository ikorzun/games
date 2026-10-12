/**
 * Осмотр места (crime_scene_search): игрок тапает по подозрительным местам картинки.
 *
 * Картинка — фон сцены (`config.scene_bg` → `episode.assets.backgrounds[].path`); если файла нет, показан
 * серый прямоугольник с подписями зон (серая коробка уровня). Зоны `config.hotspots[].rect` — невидимые
 * прямоугольники в долях картинки [x, y, w, h]; найденная зона подсвечивается и подписывается (label_key).
 *
 * Никакого пиксель-хантинга: зона для попадания не меньше MIN_HIT_PX с запасом SLOP_PX со всех сторон
 * (на телефоне это ≈ палец), ближайший центр побеждает; двойной тап по одному месту — один промах;
 * подсказка (по `hint_after_misses` или за rewarded-рекламу) подсвечивает следующую обязательную зону.
 * С клавиатуры — прицел: стрелки двигают, Enter осматривает.
 *
 * Итог: найдены все обязательные зоны → success; хотя бы одна → partial; ни одной → fail.
 * Игра заканчивается, когда найдено всё обязательное, промахов стало max_misses или вышло время.
 *
 * Режим списка (`list: true`, режим дела — docs/architecture/09-case-mode.md): все цели перечислены под картинкой
 * сразу, найденные зачёркиваются. Из пула зон за заход берётся `pick`: обязательные (required) — всегда, остальные —
 * случайно по зерну `seed` (номер захода), поэтому повтор сцены даёт новый список. Все выбранные — обязательные,
 * невыбранные зоны неактивны: тап по ним — промах.
 */
import type { MinigameOutcomeKind } from '../core/types';
import { fill, h } from '../ui/dom';
import { joinUrl } from '../stage/assets';
import { asInt, asStr, hashString, isRecord, MinigameShell, mulberry32, warnMissingAsset } from './mg_shell';
import type { GameContext, IMinigame, MinigameConfig } from './types';
import './crime_scene_search.css';

export const TYPE = 'crime_scene_search' as const;

/** [x, y, w, h] в долях картинки, начало — левый верхний угол. */
export type Rect = readonly [x: number, y: number, w: number, h: number];

export interface Hotspot {
  id: string;
  rect: Rect;
  labelKey: string | null;
  required: boolean;
}

export interface SceneConfig {
  sceneBg: string | null;
  hotspots: Hotspot[];
  maxMisses: number;
  timeLimitMs: number;
  hintAfterMisses: number;
  /** Режим списка: цели перечислены сразу (hotspots — уже выбранные на этот заход, в порядке списка). */
  list: boolean;
}

/** Наименьшая зона попадания, CSS-пикселей (≈ палец). */
export const MIN_HIT_PX = 56;
/** Запас вокруг зоны, CSS-пикселей. */
export const SLOP_PX = 6;
/** Повторный тап рядом с прошлым промахом быстрее этого — тот же промах (двойной тап). */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Перемешать копию массива (Фишер — Йетс) детерминированным генератором. */
function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Разобрать config; null — непригоден (оболочка покажет grey-box). `id` мини-игры — часть зерна режима списка. */
export function parseSceneConfig(cfg: MinigameConfig, id = ''): SceneConfig | null {
  const raw = cfg.hotspots;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  let hotspots: Hotspot[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const id = asStr(item.id);
    const r = item.rect;
    if (id === null || seen.has(id) || !Array.isArray(r) || r.length !== 4) return null;
    if (!r.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [x, y, w, hh] = (r as number[]).map(clamp01) as [number, number, number, number];
    if (w <= 0 || hh <= 0) return null;
    seen.add(id);
    hotspots.push({ id, rect: [x, y, w, hh], labelKey: asStr(item.label_key), required: item.required === true });
  }
  const list = cfg.list === true;
  if (list) {
    // Заход: обязательные + случайные из остальных до pick; порядок списка тоже случайный, но от того же зерна.
    const rnd = mulberry32(hashString(`${id}#${asInt(cfg.seed, 0) ?? 0}`));
    const pick = asInt(cfg.pick, 1) ?? hotspots.length;
    const forced = hotspots.filter((x) => x.required);
    const rest = shuffled(hotspots.filter((x) => !x.required), rnd).slice(0, Math.max(0, pick - forced.length));
    hotspots = shuffled([...forced, ...rest], rnd);
  }
  // Ни одной обязательной зоны — значит, обязательны все (иначе игра выиграна, не начавшись); в списке обязательно всё.
  if (list || !hotspots.some((x) => x.required)) hotspots.forEach((x) => (x.required = true));
  return {
    sceneBg: asStr(cfg.scene_bg),
    hotspots,
    maxMisses: asInt(cfg.max_misses, 1) ?? 6,
    timeLimitMs: asInt(cfg.time_limit_ms, 0) ?? 0,
    hintAfterMisses: asInt(cfg.hint_after_misses, 0) ?? 0,
    list,
  };
}

/**
 * Какая зона получила тап (u, v — доли картинки; widthPx × heightPx — её размер на экране).
 * Зона растягивается до MIN_HIT_PX и получает запас SLOP_PX; из подходящих выигрывает та,
 * чей центр ближе (в долях её размера). null — промах.
 */
export function hitTest(
  zones: ReadonlyArray<{ id: string; rect: Rect }>,
  u: number,
  v: number,
  widthPx: number,
  heightPx: number,
): string | null {
  const px = u * widthPx;
  const py = v * heightPx;
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const z of zones) {
    const [x, y, w, hh] = z.rect;
    const cx = (x + w / 2) * widthPx;
    const cy = (y + hh / 2) * heightPx;
    const halfW = Math.max(w * widthPx, MIN_HIT_PX) / 2 + SLOP_PX;
    const halfH = Math.max(hh * heightPx, MIN_HIT_PX) / 2 + SLOP_PX;
    const dx = Math.abs(px - cx) / halfW;
    const dy = Math.abs(py - cy) / halfH;
    if (dx > 1 || dy > 1) continue;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      best = z.id;
      bestScore = score;
    }
  }
  return best;
}

interface ZoneEls {
  el: HTMLElement;
  pin: HTMLElement;
  tag: HTMLElement;
}

let helpSeq = 0;

class CrimeSceneSearch extends MinigameShell {
  protected override readonly type = TYPE;
  protected override readonly cls = 'mg-scene';

  private cfg!: SceneConfig;
  private byId = new Map<string, Hotspot>();
  private requiredTotal = 0;

  // состояние партии
  private found: string[] = [];
  private misses = 0;
  private hinted: string[] = [];

  // не сохраняется
  private cursor = { u: 0.5, v: 0.5 };
  private lastMiss: { u: number; v: number; at: number } | null = null;
  private timeouts = new Set<ReturnType<typeof setTimeout>>();

  // DOM
  private viewport!: HTMLElement;
  private stage!: HTMLElement;
  private marks!: HTMLElement;
  private cross!: HTMLElement;
  private list!: HTMLElement;
  private help!: HTMLElement;
  private zoneEls = new Map<string, ZoneEls>();

  protected override parse(cfg: MinigameConfig, ctx: GameContext): boolean {
    const parsed = parseSceneConfig(cfg, ctx.def.id);
    if (!parsed) return false;
    this.cfg = parsed;
    this.byId = new Map(parsed.hotspots.map((x) => [x.id, x]));
    this.requiredTotal = parsed.hotspots.filter((x) => x.required).length;
    return true;
  }

  protected override cfgTimeLimitMs(): number {
    return this.cfg.timeLimitMs;
  }

  // ───────────────────────────── разметка ─────────────────────────────

  protected override build(): HTMLElement {
    const { cfg } = this;
    const helpId = `mg-scene-help-${++helpSeq}`;
    this.help = h('p', { class: 'mg-scene__help', id: helpId });
    this.marks = h('div', { class: 'mg-scene__marks' });
    this.cross = h('span', { class: 'mg-scene__cross', aria: { hidden: true } });
    this.stage = h('div', {
      class: 'mg-scene__stage is-loading',
      tabindex: 0,
      role: 'group',
      aria: { describedby: helpId },
      on: {
        click: (e) => this.onClick(e),
        keydown: (e) => this.onKey(e),
        blur: () => this.stage.classList.remove('has-cursor'),
      },
    });
    if (/[?&]debug=1\b/.test(globalThis.location?.search ?? '')) this.stage.classList.add('is-debug');

    this.zoneEls.clear();
    const zones = cfg.hotspots.map((hs) => {
      const [x, y, w, hh] = hs.rect;
      const cx = x + w / 2;
      const pin = h('span', { class: 'mg-scene__pin', aria: { hidden: true } });
      const tag = h('span', { class: 'mg-scene__tag' });
      const el = h(
        'div',
        {
          class: `mg-scene__zone${hs.required ? ' is-required' : ''}${cx > 0.7 ? ' is-right' : cx < 0.3 ? ' is-left' : ''}`,
          data: { id: hs.id },
          style: { left: `${cx * 100}%`, top: `${(y + hh / 2) * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%` },
        },
        pin,
        tag,
      );
      this.zoneEls.set(hs.id, { el, pin, tag });
      return el;
    });
    const caption = h('span', { class: 'mg-scene__ph', lang: 'en', text: cfg.sceneBg ?? '' });
    this.stage.append(caption, ...zones, this.marks, this.cross);

    const path = cfg.sceneBg ? this.ctx.episode.assets?.backgrounds?.find((b) => b.id === cfg.sceneBg)?.path : undefined;
    if (path) this.loadImage(path);
    else this.stage.classList.replace('is-loading', 'is-placeholder');

    this.viewport = h('div', { class: 'mg-scene__viewport' }, this.stage);
    this.list = h('ul', { class: 'mg-scene__list' });
    return h('div', { class: 'mg-scene__wrap' }, this.viewport, this.list, this.help);
  }

  private loadImage(path: string): void {
    const img = document.createElement('img');
    img.className = 'mg-scene__img';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('load', () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) this.stage.style.setProperty('--ar', `${img.naturalWidth} / ${img.naturalHeight}`);
      this.stage.classList.remove('is-loading', 'is-placeholder');
      this.stage.classList.add('has-image');
    });
    img.addEventListener('error', () => {
      img.remove();
      this.stage.classList.remove('is-loading', 'has-image');
      this.stage.classList.add('is-placeholder');
      warnMissingAsset(img.src);
    });
    img.src = joinUrl(import.meta.env.BASE_URL, path);
    this.stage.prepend(img);
  }

  protected override paint(): void {
    const { found, hinted } = this;
    this.stage.setAttribute('aria-label', this.t(this.ctx.def.title_key));
    this.help.textContent = this.t('ui.minigame.scene_help.body');
    for (const hs of this.cfg.hotspots) {
      const z = this.zoneEls.get(hs.id);
      if (!z) continue;
      const order = found.indexOf(hs.id);
      z.el.classList.toggle('is-found', order >= 0);
      z.el.classList.toggle('is-hinted', order < 0 && hinted.includes(hs.id));
      z.pin.textContent = order >= 0 ? String(order + 1) : '';
      z.tag.textContent = this.label(hs);
    }
    if (this.cfg.list) {
      // Список целей: найденные зачёркнуты, подсказанная подсвечена.
      this.list.classList.add('is-targets');
      fill(
        this.list,
        ...this.cfg.hotspots.map((hs) =>
          h('li', {
            class: `mg-scene__item${found.includes(hs.id) ? ' is-found' : hinted.includes(hs.id) ? ' is-hint' : ''}`,
            data: { id: hs.id },
            text: this.label(hs),
          }),
        ),
      );
      return;
    }
    fill(
      this.list,
      ...found.map((id, i) => {
        const hs = this.byId.get(id);
        return hs
          ? h(
              'li',
              { class: `mg-scene__item${hs.required ? '' : ' is-extra'}` },
              h('span', { class: 'mg-scene__num', text: String(i + 1) }),
              h('span', { class: 'mg-scene__name', text: this.label(hs) }),
            )
          : null;
      }),
      ...hinted.filter((id) => !found.includes(id)).map((id) => {
        const hs = this.byId.get(id);
        return hs
          ? h('li', { class: 'mg-scene__item is-hint' }, h('span', { class: 'mg-scene__name', text: `${this.t('ui.minigame.hint')}: ${this.label(hs)}` }))
          : null;
      }),
    );
  }

  private label(hs: Hotspot): string {
    return hs.labelKey ? this.t(hs.labelKey) : hs.id;
  }

  // ───────────────────────────── ввод ─────────────────────────────

  private onClick(e: MouseEvent): void {
    if (!this.canAct()) return;
    const r = this.stage.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.inspect((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.canAct() || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 0.01 : 0.05;
    const c = this.cursor;
    switch (e.key) {
      case 'ArrowLeft':
        c.u = clamp01(c.u - step);
        break;
      case 'ArrowRight':
        c.u = clamp01(c.u + step);
        break;
      case 'ArrowUp':
        c.v = clamp01(c.v - step);
        break;
      case 'ArrowDown':
        c.v = clamp01(c.v + step);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.stage.classList.add('has-cursor');
        this.inspect(c.u, c.v);
        return;
      default:
        return;
    }
    e.preventDefault();
    this.cross.style.left = `${c.u * 100}%`;
    this.cross.style.top = `${c.v * 100}%`;
    this.stage.classList.add('has-cursor');
  }

  /** Осмотреть точку (u, v — доли картинки): находка, повторная находка или промах. */
  private inspect(u: number, v: number): void {
    const r = this.stage.getBoundingClientRect();
    // Без раскладки (вкладка скрыта, тест без размеров) размер берём типовой, чтобы ввод не терялся.
    const w = r.width > 0 ? r.width : 640;
    const hh = r.height > 0 ? r.height : 360;
    const id = hitTest(this.cfg.hotspots, u, v, w, hh);
    if (id !== null) {
      const hs = this.byId.get(id);
      if (!hs) return;
      if (this.found.includes(id)) {
        this.say(() => this.label(hs));
        return;
      }
      this.found.push(id);
      this.hinted = this.hinted.filter((x) => x !== id);
      this.say(() => this.label(hs));
      this.moved();
      return;
    }
    const now = Date.now();
    const last = this.lastMiss;
    if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot((u - last.u) * w, (v - last.v) * hh) < DOUBLE_TAP_PX) return;
    this.lastMiss = { u, v, at: now };
    this.misses += 1;
    this.ripple(u, v);
    this.say(() => this.t('ui.minigame.nothing_here'));
    this.moved();
  }

  private ripple(u: number, v: number): void {
    const mark = h('span', { class: 'mg-scene__miss', style: { left: `${u * 100}%`, top: `${v * 100}%` } });
    this.marks.appendChild(mark);
    const timer = setTimeout(() => {
      this.timeouts.delete(timer);
      mark.remove();
    }, 800);
    this.timeouts.add(timer);
  }

  // ───────────────────────────── правила игры ─────────────────────────────

  private foundRequired(): number {
    return this.found.filter((id) => this.byId.get(id)?.required).length;
  }

  protected override fails(): number {
    return this.misses;
  }

  protected override failLimit(): number {
    return this.cfg.maxMisses;
  }

  protected override failLabelKey(): string {
    return 'ui.minigame.misses';
  }

  protected override progress(): { n: number; total: number } {
    return { n: this.foundRequired(), total: this.requiredTotal };
  }

  protected override isComplete(): boolean {
    return this.foundRequired() >= this.requiredTotal;
  }

  protected override evaluate(): MinigameOutcomeKind {
    const n = this.foundRequired();
    return n >= this.requiredTotal ? 'success' : n >= 1 ? 'partial' : 'fail';
  }

  /** Незамеченные обязательные зоны, о которых ещё не подсказывали. */
  private hintable(): Hotspot[] {
    return this.cfg.hotspots.filter((x) => x.required && !this.found.includes(x.id) && !this.hinted.includes(x.id));
  }

  protected override canHint(): boolean {
    return this.hintable().length > 0;
  }

  protected override freeHintReady(): boolean {
    return this.cfg.hintAfterMisses > 0 && this.misses >= this.cfg.hintAfterMisses;
  }

  protected override giveHint(): void {
    const next = this.hintable()[0];
    if (!next) return;
    this.hinted.push(next.id);
    this.say(() => `${this.t('ui.minigame.hint')}: ${this.label(next)}`);
  }

  // ───────────────────────────── сейв ─────────────────────────────

  protected override saveState(): Record<string, unknown> {
    return { found: [...this.found], misses: this.misses, hinted: [...this.hinted] };
  }

  protected override loadState(s: Record<string, unknown>): void {
    const ids = (v: unknown): string[] => [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && this.byId.has(x)) : [])];
    this.found = ids(s.found);
    this.hinted = ids(s.hinted).filter((id) => !this.found.includes(id));
    const m = asInt(s.misses, 0);
    this.misses = m === null ? 0 : Math.min(m, this.cfg.maxMisses);
  }

  override destroy(): void {
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts.clear();
    super.destroy();
  }
}

export function createCrimeSceneSearch(): IMinigame {
  return new CrimeSceneSearch();
}
