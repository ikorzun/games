/**
 * Камкордер, DOM-часть: применяет кадры CameraScheduler (camcorder.ts) к странице.
 *  - дрожание и «поправки оператора» — ОДНА CSS-трансформация обёртки кадра (`.vn-stage__hand`);
 *    внутри обёртки только картинка (canvas рендерера или DOM-плейсхолдеры), текста и интерфейса там нет;
 *  - зерно и помехи — ОДИН canvas низкого разрешения (≈ 256 px по ширине), растянутый на кадр,
 *    12–15 кадров/с; под слоем титров, так что подписи остаются чистыми;
 *  - всё работает одинаково для Pixi- и DOM-рендерера (они лежат внутри обёртки);
 *  - requestAnimationFrame, пауза при скрытой вкладке и при паузе платформы; при уровне «выкл»
 *    (в том числе prefers-reduced-motion) цикл не запускается вообще.
 *
 * Время, ГСЧ, requestAnimationFrame и matchMedia приходят параметрами — слой проверяется
 * в jsdom без настоящих часов (tests/camcorder_layer.test.ts).
 */
import type { CameraFx } from '../core/settings';
import type { StageFilter } from '../core/types';
import { CameraScheduler, fillGrain, grainAlphaMax, levelProfile, mulberry32 } from './camcorder';
import type { BurstFrame, CamFrame, Rng, TearFrame } from './camcorder';
import { presetOf } from './presets';
import type { Presentation } from '../core/types';

/** Ширина canvas помех, px. Растягивается CSS на весь кадр. */
export const OVERLAY_WIDTH = 256;
/** Частота перерисовки зерна и помех, к/с (12–15). */
export const NOISE_FPS = 13;
/** Сколько заранее посчитанных кадров зерна чередуется. */
const GRAIN_FRAMES = 6;

/** Минимум 2D-контекста, который нужен оверлею (реальный CanvasRenderingContext2D подходит). */
export interface Overlay2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalCompositeOperation: GlobalCompositeOperation;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  putImageData(data: ImageData, x: number, y: number): void;
  createImageData(w: number, h: number): ImageData;
}

export interface CamcorderLayerOptions {
  /** `.vn-stage`: получает классы cam-on / cam-rec / cam-burst и CSS-переменные. */
  stage: HTMLElement;
  /** Обёртка кадра: единственный элемент, которому ставится transform. */
  hand: HTMLElement;
  canvas: HTMLCanvasElement;
  rng?: Rng;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
  /** prefers-reduced-motion. */
  reducedMotion?: () => boolean;
  /** Подписка на смену prefers-reduced-motion; возвращает отписку. */
  onReducedMotionChange?: (cb: () => void) => () => void;
  isHidden?: () => boolean;
  noiseFps?: number;
  /** Подмена 2D-контекста (тесты). */
  context?: Overlay2D | null;
}

function defaultReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class CamcorderLayer {
  readonly scheduler: CameraScheduler;

  private readonly o: CamcorderLayerOptions;
  private readonly rng: Rng;
  private readonly raf: (cb: (ts: number) => void) => number;
  private readonly caf: (id: number) => void;
  private readonly noiseInterval: number;
  private ctx: Overlay2D | null;
  private grain: ImageData[] = [];
  private grainIdx = 0;
  private setting: CameraFx = 'low';
  private presentation: Presentation = 'title';
  private active = false;
  private paused = false;
  private suspended = false;
  private rafId: number | null = null;
  private lastNoise = -1e9;
  private lastTransform = '';
  private burstOn = false;
  private cw = 0;
  private ch = 0;
  private observer: ResizeObserver | null = null;
  private disposers: Array<() => void> = [];
  /** Для отладки и тестов: последний применённый кадр. */
  lastFrame: CamFrame | null = null;

  constructor(opts: CamcorderLayerOptions) {
    this.o = opts;
    this.rng = opts.rng ?? mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    this.raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
    this.noiseInterval = 1000 / (opts.noiseFps ?? NOISE_FPS);
    this.scheduler = new CameraScheduler({ rng: this.rng, level: 'low' });
    this.ctx = opts.context !== undefined ? opts.context : this.openContext();
    this.sizeOverlay(OVERLAY_WIDTH, Math.round((OVERLAY_WIDTH * 9) / 16));

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(opts.stage);
      this.disposers.push(() => this.observer?.disconnect());
    }
    if (typeof document !== 'undefined') {
      const onVis = (): void => this.sync();
      document.addEventListener('visibilitychange', onVis);
      this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
    }
    this.disposers.push(opts.onReducedMotionChange?.(() => this.applyLevel()) ?? this.watchReducedMotion());
    this.applyLevel();
  }

  private openContext(): Overlay2D | null {
    try {
      return (this.o.canvas.getContext('2d') as Overlay2D | null) ?? null;
    } catch {
      return null;
    }
  }

  private watchReducedMotion(): () => void {
    try {
      if (typeof matchMedia !== 'function') return () => undefined;
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      const cb = (): void => this.applyLevel();
      mq.addEventListener?.('change', cb);
      return () => mq.removeEventListener?.('change', cb);
    } catch {
      return () => undefined;
    }
  }

  // ───────────────────────────── состояние ─────────────────────────────

  /** Выбор игрока (настройка «Эффекты камеры»). */
  setLevel(level: CameraFx): void {
    this.setting = level;
    this.applyLevel();
  }

  /** Уровень с учётом prefers-reduced-motion (он принудительно выключает эффекты). */
  get effectiveLevel(): CameraFx {
    const reduced = (this.o.reducedMotion ?? defaultReducedMotion)();
    return reduced ? 'off' : this.setting;
  }

  get running(): boolean {
    return this.rafId !== null;
  }

  /** Режим показа и фильтр новой сцены. */
  setContext(presentation: Presentation, filter: StageFilter): void {
    this.presentation = presentation;
    const preset = presetOf(presentation);
    this.scheduler.setContext({ handheld: preset.handheld, reframe: preset.reframe, filter });
    this.paintClasses(filter);
  }

  /** На сцене есть кадр (в меню камкордер стоит). */
  setActive(active: boolean): void {
    this.active = active;
    this.sync();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.sync();
  }

  /**
   * Приостановить камкордер целиком: цикл стоит, трансформации нет, оверлей чист. Нужно, пока открыта
   * мини-игра: она живёт в слое рендерера, а интерфейс трясти нельзя.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.sync();
  }

  /** Оператор поправляет кадр: вызывается при входе в сцену (не при загрузке и откате). */
  enterScene(): void {
    this.scheduler.enterScene();
  }

  /** true — разрыв кадра нарисует камкордер; false — вызывающему нужен запасной CSS-вариант. */
  glitch(ms: number): boolean {
    if (this.effectiveLevel === 'off' || !this.running) return false;
    this.scheduler.glitch(ms);
    return true;
  }

  freeze(on: boolean): void {
    this.scheduler.setFrozen(on);
  }

  destroy(): void {
    this.stop();
    for (const d of this.disposers.splice(0)) d();
    this.o.hand.style.transform = '';
  }

  // ───────────────────────────── цикл ─────────────────────────────

  private applyLevel(): void {
    const level = this.effectiveLevel;
    this.scheduler.setLevel(level);
    const on = level !== 'off';
    const { stage } = this.o;
    stage.classList.toggle('cam-on', on);
    stage.dataset.cam = level;
    const p = levelProfile(level);
    stage.style.setProperty('--cam-vignette', String(p ? p.vignette : 0));
    stage.style.setProperty('--cam-interlace', String(p ? p.interlace : 0));
    this.paintClasses(null);
    this.rebuildGrain();
    this.sync();
  }

  private paintClasses(filter: StageFilter | null): void {
    const on = this.effectiveLevel !== 'off';
    this.o.stage.classList.toggle('cam-rec', on && presetOf(this.presentation).recHud);
    if (filter !== null) this.o.stage.dataset.camFilter = filter;
  }

  private hidden(): boolean {
    return this.o.isHidden ? this.o.isHidden() : typeof document !== 'undefined' && document.hidden;
  }

  /** Запустить или остановить цикл по текущим условиям. */
  private sync(): void {
    const should = this.active && !this.paused && !this.suspended && !this.hidden() && this.effectiveLevel !== 'off';
    if (should) this.start();
    else this.stop();
  }

  private start(): void {
    if (this.rafId !== null) return;
    this.rafId = this.raf(this.tick);
  }

  private stop(): void {
    if (this.rafId !== null) {
      this.caf(this.rafId);
      this.rafId = null;
    }
    if (this.effectiveLevel === 'off' || !this.active || this.suspended) {
      this.setTransform('');
      this.setBurstClass(false);
      this.clearOverlay();
    }
  }

  private readonly tick = (ts: number): void => {
    this.rafId = this.raf(this.tick);
    const f = this.scheduler.step(ts);
    this.lastFrame = f;
    this.applyTransform(f);
    this.setBurstClass(f.burst !== null);
    if (ts - this.lastNoise >= this.noiseInterval) {
      this.lastNoise = ts;
      this.drawOverlay(f);
    }
  };

  /** Один шаг без rAF (тесты и отладка). */
  stepOnce(ts: number): CamFrame {
    const f = this.scheduler.step(ts);
    this.lastFrame = f;
    this.applyTransform(f);
    this.setBurstClass(f.burst !== null);
    this.drawOverlay(f);
    return f;
  }

  private applyTransform(f: CamFrame): void {
    if (!f.on) {
      this.setTransform('');
      return;
    }
    this.setTransform(`translate3d(${f.tx.toFixed(3)}%, ${f.ty.toFixed(3)}%, 0) rotate(${f.rot.toFixed(3)}deg) scale(${f.scale.toFixed(4)})`);
  }

  private setTransform(value: string): void {
    if (value === this.lastTransform) return;
    this.lastTransform = value;
    this.o.hand.style.transform = value;
  }

  private setBurstClass(on: boolean): void {
    if (on === this.burstOn) return;
    this.burstOn = on;
    this.o.stage.classList.toggle('cam-burst', on);
  }

  // ───────────────────────────── размер и оверлей ─────────────────────────────

  private measure(): void {
    const r = this.o.stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.scheduler.setAspect(r.width / r.height);
    const h = Math.max(96, Math.min(360, Math.round((OVERLAY_WIDTH * r.height) / r.width)));
    if (h !== this.ch) {
      this.sizeOverlay(OVERLAY_WIDTH, h);
      this.rebuildGrain();
    }
  }

  private sizeOverlay(w: number, h: number): void {
    this.cw = w;
    this.ch = h;
    this.o.canvas.width = w;
    this.o.canvas.height = h;
  }

  /** Заранее посчитанные кадры зерна: на каждом шаге оверлея берётся один из них. */
  private rebuildGrain(): void {
    this.grain = [];
    const max = grainAlphaMax(this.effectiveLevel);
    if (!this.ctx || max <= 0) return;
    for (let i = 0; i < GRAIN_FRAMES; i++) {
      const img = this.ctx.createImageData(this.cw, this.ch);
      fillGrain(img.data, this.rng, max);
      this.grain.push(img);
    }
  }

  private clearOverlay(): void {
    this.ctx?.clearRect(0, 0, this.cw, this.ch);
  }

  /** Зерно + помехи текущего кадра. Весь оверлей — один canvas; рисуется 12–15 раз в секунду. */
  drawOverlay(f: CamFrame): void {
    const ctx = this.ctx;
    if (!ctx || !f.on) return;
    const w = this.cw;
    const h = this.ch;
    ctx.globalCompositeOperation = 'source-over';
    if (this.grain.length > 0) {
      this.grainIdx = (this.grainIdx + 1 + Math.floor(this.rng() * (this.grain.length - 1))) % this.grain.length;
      ctx.putImageData(this.grain[this.grainIdx]!, 0, 0);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
    if (f.burst) this.drawBurst(ctx, f.burst, w, h);
    if (f.tear) this.drawTear(ctx, f.tear, w, h);
  }

  private drawBurst(ctx: Overlay2D, b: BurstFrame, w: number, h: number): void {
    const rng = this.rng;
    const e = b.envelope;
    // мерцание яркости
    if (Math.abs(b.flicker) > 0.02) {
      ctx.fillStyle = b.flicker > 0 ? `rgba(255,255,255,${(Math.abs(b.flicker) * 0.12).toFixed(3)})` : `rgba(0,0,0,${(Math.abs(b.flicker) * 0.2).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    // полоса трекинга
    const y = Math.round(b.bandY * h);
    const bh = Math.max(3, Math.round(b.bandH * h));
    ctx.fillStyle = `rgba(12,12,14,${(0.2 * e).toFixed(3)})`;
    ctx.fillRect(0, y, w, bh);
    ctx.fillStyle = `rgba(255,255,255,${(0.3 * e).toFixed(3)})`;
    ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = `rgba(0,0,0,${(0.4 * e).toFixed(3)})`;
    ctx.fillRect(0, y + bh - 1, w, 1);
    // «снег» в полосе
    const n = Math.floor(w * bh * 0.08 * b.snow);
    for (let i = 0; i < n; i++) {
      const light = rng() < 0.55;
      ctx.fillStyle = light ? `rgba(255,255,255,${(0.25 + rng() * 0.4).toFixed(2)})` : `rgba(0,0,0,${(0.3 + rng() * 0.4).toFixed(2)})`;
      ctx.fillRect(Math.floor(rng() * w), y + Math.floor(rng() * bh), 1 + Math.floor(rng() * 6), 1);
    }
    // хроматический сдвиг: красные и голубые штрихи, смещённые друг от друга
    const c = Math.max(1, Math.round(b.chroma * w));
    for (let i = 0; i < 5; i++) {
      const yy = y + Math.floor(rng() * bh);
      const x0 = Math.floor(rng() * w * 0.7);
      const len = Math.floor(w * (0.12 + rng() * 0.3));
      ctx.fillStyle = `rgba(255,40,70,${(0.32 * e).toFixed(3)})`;
      ctx.fillRect(x0 + c, yy, len, 1);
      ctx.fillStyle = `rgba(40,210,255,${(0.28 * e).toFixed(3)})`;
      ctx.fillRect(x0 - c, yy + 1, len, 1);
    }
  }

  /** «Разрыв кадра»: полосы шума на открывшемся крае и на шве. */
  private drawTear(ctx: Overlay2D, t: TearFrame, w: number, h: number): void {
    const rng = this.rng;
    const noisyBar = (y: number, bh: number, base: number): void => {
      if (bh <= 0) return;
      ctx.fillStyle = `rgba(0,0,0,${base})`;
      ctx.fillRect(0, y, w, bh);
      const n = Math.floor(w * bh * 0.16);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = rng() < 0.6 ? `rgba(255,255,255,${(0.2 + rng() * 0.5).toFixed(2)})` : `rgba(0,0,0,${(0.4 + rng() * 0.4).toFixed(2)})`;
        ctx.fillRect(Math.floor(rng() * w), y + Math.floor(rng() * bh), 1 + Math.floor(rng() * 8), 1);
      }
    };
    const edge = Math.ceil((Math.abs(t.dy) / 100) * h);
    if (t.dy > 0) noisyBar(0, edge, 0.85);
    else if (t.dy < 0) noisyBar(h - edge, edge, 0.85);
    noisyBar(Math.round(t.seamY * h), Math.max(2, Math.round(t.seamH * h)), 0.55);
    const side = Math.ceil((Math.abs(t.dx) / 100) * w);
    if (side > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(t.dx > 0 ? 0 : w - side, 0, side, h);
    }
  }
}
