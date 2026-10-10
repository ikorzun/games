/**
 * Оболочка сцены (DOM): фильтры, letterbox, переходы и эффекты fx — это CSS-классы и CSS-анимации
 * на контейнере; сам кадр (картинки фона, спрайтов и CG или плейсхолдеры) рисует сменный рендерер
 * (PixiJS или DOM, см. renderer.ts). Реализует IStage — порт, через который работает Director.
 *
 * Слои кадра (изнутри наружу): host (canvas рендерера) → cam (Ken Burns, моторный зум) →
 * grade (цветокоррекция stage.filter) → hand (дрожание камкордера, одна CSS-трансформация) →
 * scene (эффекты shake / glitch). Текст и интерфейс в эти слои НЕ входят: титры лежат рядом со
 * сценой, окно текста — в слое UI, поэтому дрожание и помехи их не касаются.
 *
 * Камкордер (camcorder.ts + camcorder_layer.ts): ручная камера, «оператор поправил кадр» при входе
 * в сцену, редкие помехи, зерно, HUD записи (только reconstruction). fx zoom_in — моторный зум
 * с перелётом и «поиском фокуса», freeze_frame — стоп-кадр с затемнением, vhs_glitch — разрыв кадра.
 *
 * Переходы и рекламная пауза:
 *  - changeScene(): гашение → смена кадра → проявление (fade / slow_fade / dissolve / flash /
 *    wipe — «провал» через цветной слой, vhs_glitch — разрыв кадра). Перед гашением ждём картинки
 *    сцены (prepareView): смена кадра не показывает пустоту.
 *  - fadeToBlackAndHold() / revealFromBlack(): две половины того же перехода, разнесённые
 *    во времени ради рекламы на границе блока. Между ними чёрный кадр ДЕРЖИТСЯ (слой
 *    `vn-stage__hold`), новая сцена выставляется под ним и проявляется только в revealFromBlack().
 *    Кто и когда их вызывает — правило в stage/director.ts.
 */
import type { CameraFx, ViolenceMode } from '../core/settings';
import type { FxKind, SpriteView, StageFilter, TransitionKind, ViewState } from '../core/types';
import { h, sleep } from '../ui/dom';
import { NO_ASSETS, prepareView } from './assets';
import type { SceneAssets } from './assets';
import { ZOOM_AMOUNT, zoomKeyframes } from './camcorder';
import { CamcorderLayer } from './camcorder_layer';
import type { CamcorderLayerOptions } from './camcorder_layer';
import { effectiveFilter, presetOf } from './presets';
import type { ISceneRenderer } from './renderer';
import type { IStage } from './types';

const FILTERS: readonly StageFilter[] = ['vhs', 'vhs_heavy', 'archive_photo', 'night', 'sepia', 'desaturated', 'noir'];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export interface StageOptions {
  /** Картинки эпизода для prepareView (должны быть теми же, что у рендерера). */
  assets?: SceneAssets;
  /** Подмены для тестов камкордера (ГСЧ, rAF, prefers-reduced-motion, контекст canvas). */
  camcorder?: Omit<Partial<CamcorderLayerOptions>, 'stage' | 'hand' | 'canvas'>;
}

export class Stage implements IStage {
  readonly el: HTMLElement;
  /** Сюда UI кладёт слой титров: он живёт внутри сцены, под текстовым окном. */
  readonly captionsEl: HTMLElement;
  readonly renderer: ISceneRenderer;
  readonly camcorder: CamcorderLayer;

  private readonly sceneEl: HTMLElement;
  private readonly handEl: HTMLElement;
  private readonly gradeEl: HTMLElement;
  private readonly camEl: HTMLElement;
  private readonly hostEl: HTMLElement;
  private readonly blackEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly noiseEl: HTMLElement;
  private readonly bandEl: HTMLElement;
  private readonly trEl: HTMLElement;
  private readonly holdEl: HTMLElement;
  private readonly assets: SceneAssets;

  private view: ViewState | null = null;
  /** Счётчик «поколений»: setView() отменяет незавершённые переходы. */
  private gen = 0;
  private blackPersisted = false;
  private holding = false;
  private zoomAnim: Animation | null = null;
  private platformPaused = false;
  private minigameActive = false;

  constructor(renderer: ISceneRenderer, opts: StageOptions = {}) {
    this.renderer = renderer;
    this.assets = opts.assets ?? NO_ASSETS;
    this.hostEl = h('div', { class: 'vn-stage__host' });
    this.camEl = h('div', { class: 'vn-stage__cam' }, this.hostEl);
    this.gradeEl = h('div', { class: 'vn-stage__grade' }, this.camEl);
    this.handEl = h('div', { class: 'vn-stage__hand' }, this.gradeEl);
    this.sceneEl = h('div', { class: 'vn-stage__scene' }, this.handEl);
    this.captionsEl = h('div', { class: 'vn-stage__captions' });
    this.blackEl = h('div', { class: 'vn-stage__black' });
    this.flashEl = h('div', { class: 'vn-stage__flash' });
    this.noiseEl = h('div', { class: 'vn-stage__noise' });
    this.bandEl = h('div', { class: 'vn-stage__band' });
    this.trEl = h('div', { class: 'vn-stage__tr' });
    this.holdEl = h('div', { class: 'vn-stage__hold' });
    const fxCanvas = h('canvas', { class: 'vn-stage__camfx', aria: { hidden: true } });
    this.el = h(
      'div',
      { class: 'vn-stage', data: { presentation: 'title' } },
      this.sceneEl,
      fxCanvas,
      h('div', { class: 'vn-stage__layer vn-stage__scan' }),
      h('div', { class: 'vn-stage__layer vn-stage__vignette' }),
      h('div', { class: 'vn-stage__layer vn-stage__tint' }),
      h('div', { class: 'vn-stage__layer vn-stage__weather' }),
      h('div', { class: 'vn-stage__letterbox vn-stage__letterbox--top' }),
      h('div', { class: 'vn-stage__letterbox vn-stage__letterbox--bottom' }),
      // HUD записи: поверх картинки, но не внутри дрожащей обёртки (экранная индикация не трясётся)
      h('div', { class: 'vn-stage__hud', aria: { hidden: true } }, h('span', { class: 'vn-rec' }, h('i', { class: 'vn-rec__dot' }), h('b', { class: 'vn-rec__text', text: 'REC' }))),
      this.captionsEl,
      this.noiseEl,
      this.bandEl,
      this.flashEl,
      this.blackEl,
      this.trEl,
      this.holdEl,
    );
    this.camcorder = new CamcorderLayer({ ...opts.camcorder, stage: this.el, hand: this.handEl, canvas: fxCanvas });
  }

  /** Вставить сцену в родителя и поднять рендерер. При ошибке рендерера вызывающий делает destroy(). */
  async mount(parent: HTMLElement): Promise<void> {
    parent.appendChild(this.el);
    await this.renderer.mount(this.hostEl);
  }

  destroy(): void {
    this.gen += 1;
    this.camcorder.destroy();
    try {
      this.renderer.destroy();
    } catch {
      /* рендерер мог не успеть подняться */
    }
    this.el.remove();
  }

  /** Корневой контейнер PixiJS для мини-игр (null — DOM-рендерер). */
  get minigameRoot(): unknown {
    return this.renderer.minigameRoot ?? null;
  }

  setMinigameActive(active: boolean): void {
    this.minigameActive = active;
    this.el.classList.toggle('is-minigame', active);
    this.renderer.setMinigameActive?.(active);
    // Мини-игра живёт в слое рендерера: пока она открыта, камкордер стоит и кадр без трансформации.
    this.camcorder.setSuspended(active);
  }

  setViolenceMode(mode: ViolenceMode): void {
    this.renderer.setViolenceMode(mode);
  }

  /** Настройка «Эффекты камеры» (prefers-reduced-motion выключает их независимо от выбора). */
  setCameraFx(level: CameraFx, retry = false): void {
    this.camcorder.setLevel(level, retry);
  }

  /** Пауза платформы / вкладки в фоне: камкордер останавливает цикл. */
  setPaused(paused: boolean): void {
    this.platformPaused = paused;
    this.camcorder.setPaused(paused);
  }

  get paused(): boolean {
    return this.platformPaused;
  }

  get minigameOpen(): boolean {
    return this.minigameActive;
  }

  get currentView(): ViewState | null {
    return this.view;
  }

  // ───────────────────────────── IStage: сцена ─────────────────────────────

  setView(view: ViewState): void {
    this.gen += 1;
    this.resetTransient();
    this.applyFrame(view);
    this.renderer.setView(view);
  }

  async changeScene(view: ViewState, transition: TransitionKind, instant: boolean): Promise<void> {
    const gen = this.gen;
    await prepareView(this.assets, view);
    if (gen !== this.gen) return;
    const swap = (): void => {
      this.applyFrame(view);
      this.renderer.setView(view);
      this.releasePersistedBlack();
      if (!instant) this.camcorder.enterScene();
    };
    if (this.view === null && !instant) {
      // Первая сцена партии: проявление из чёрного.
      this.blackEl.style.transition = 'none';
      this.blackEl.style.opacity = '1';
      swap();
      await this.wait(60);
      await this.fadeBlack(0, 520);
      return;
    }
    if (instant || transition === 'cut') {
      swap();
      return;
    }
    await this.transition(transition, swap);
  }

  async fadeToBlackAndHold(transition: TransitionKind, instant: boolean): Promise<void> {
    const gen = this.gen;
    this.holding = true;
    const ms = instant ? 0 : transition === 'slow_fade' ? 700 : 320;
    this.holdEl.style.transition = ms > 0 ? `opacity ${ms}ms ease-in` : 'none';
    this.holdEl.style.opacity = '1';
    if (ms > 0) await this.wait(ms);
    if (gen !== this.gen) return;
  }

  async revealFromBlack(view: ViewState, transition: TransitionKind, instant: boolean): Promise<void> {
    const gen = this.gen;
    // Под непрозрачным чёрным слоем выставляем новую сцену (картинки к этому моменту уже ждём)…
    await prepareView(this.assets, view);
    if (gen !== this.gen) return;
    this.applyFrame(view);
    this.renderer.setView(view);
    this.releasePersistedBlack(true);
    if (!instant) this.camcorder.enterScene();
    // …и только теперь проявляем её.
    const ms = instant ? 0 : transition === 'slow_fade' ? 800 : 420;
    this.holdEl.style.transition = ms > 0 ? `opacity ${ms}ms ease-out` : 'none';
    this.holdEl.style.opacity = '0';
    this.holding = false;
    if (ms > 0) await this.wait(ms);
    if (gen !== this.gen) return;
  }

  /** true, пока чёрный кадр удерживается перед/во время рекламы. */
  get holdingBlack(): boolean {
    return this.holding;
  }

  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind, instant: boolean): void {
    if (this.view) {
      const rest = this.view.sprites.filter((s) => s.who !== sprite.who);
      this.view = { ...this.view, sprites: [...rest, sprite] };
    }
    this.renderer.showSprite(sprite, existing, instant ? 'cut' : transition);
  }

  hideSprite(who: string, transition: TransitionKind, instant: boolean): void {
    if (this.view) this.view = { ...this.view, sprites: this.view.sprites.filter((s) => s.who !== who) };
    this.renderer.hideSprite(who, instant ? 'cut' : transition);
  }

  async changeBackground(bg: string, filter: StageFilter | null, transition: TransitionKind, instant: boolean): Promise<void> {
    const gen = this.gen;
    await prepareView(this.assets, { bg, cg: null, sprites: [] });
    if (gen !== this.gen) return;
    const swap = (): void => {
      if (this.view) {
        this.view = { ...this.view, bg, filter, cg: null };
        const f = effectiveFilter(this.view);
        this.setFilterClass(f);
        this.camcorder.setContext(this.view.presentation, f);
      }
      this.renderer.setBackground(bg);
      this.renderer.setCg(null);
    };
    if (instant || transition === 'cut') swap();
    else await this.transition(transition, swap);
  }

  async showCg(cg: string, transition: TransitionKind, instant: boolean): Promise<void> {
    const gen = this.gen;
    await prepareView(this.assets, { bg: '', cg, sprites: [] });
    if (gen !== this.gen) return;
    const swap = (): void => {
      if (this.view) this.view = { ...this.view, cg };
      this.renderer.setCg(cg);
    };
    if (instant || transition === 'cut') swap();
    else await this.transition(transition, swap);
  }

  async hideCg(transition: TransitionKind, instant: boolean): Promise<void> {
    const swap = (): void => {
      if (this.view) this.view = { ...this.view, cg: null };
      this.renderer.setCg(null);
    };
    // CG уходит после реплики — достаточно короткого «провала», а не полного перехода.
    if (instant || transition === 'cut') swap();
    else await this.transition('dissolve', swap);
  }

  setSpeaker(who: string | null): void {
    if (this.view) this.view = { ...this.view, speaker: who };
    this.renderer.setSpeaker(who);
  }

  // ───────────────────────────── кадр и фильтры ─────────────────────────────

  private applyFrame(view: ViewState): void {
    const sceneChanged = this.view?.scene !== view.scene;
    this.view = view;
    this.el.dataset.presentation = view.presentation;
    this.el.dataset.tod = view.time_of_day ?? '';
    this.el.dataset.weather = view.weather ?? '';
    this.el.classList.toggle('has-letterbox', view.letterbox);
    const filter = effectiveFilter(view);
    this.setFilterClass(filter);
    const camera = presetOf(view.presentation).camera;
    this.cancelZoom(true);
    this.camEl.classList.remove('camera-static', 'camera-ken_burns');
    if (sceneChanged || !this.camEl.dataset.camera) void this.camEl.offsetWidth; // перезапуск Ken Burns
    this.camEl.classList.add(`camera-${camera}`);
    this.camEl.dataset.camera = camera;
    this.camcorder.setContext(view.presentation, filter);
    this.camcorder.setActive(true);
  }

  private setFilterClass(filter: StageFilter): void {
    for (const f of FILTERS) this.el.classList.remove(`filter-${f}`);
    if (filter !== 'none') this.el.classList.add(`filter-${filter}`);
    this.el.dataset.filter = filter;
  }

  // ───────────────────────────── переходы ─────────────────────────────

  private wait(ms: number): Promise<void> {
    return sleep(ms);
  }

  /** Запустить CSS-анимацию классом и дождаться её конца (или таймаута на случай отключённых анимаций). */
  private cssAnim(el: HTMLElement, cls: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const done = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        el.removeEventListener('animationend', onEnd);
        resolve();
      };
      const onEnd = (e: Event): void => {
        if (e.target === el) done();
      };
      el.style.setProperty('--tr-ms', `${ms}ms`);
      el.classList.remove(cls);
      void el.offsetWidth; // перезапуск анимации
      el.classList.add(cls);
      el.addEventListener('animationend', onEnd);
      const timer = setTimeout(done, ms + 120);
    });
  }

  private async transition(kind: TransitionKind, swap: () => void): Promise<void> {
    const gen = this.gen;
    const tr = this.trEl;
    const dip = async (color: string, outMs: number, inMs: number, peak: number, inCls = 'tr-in', outCls = 'tr-out'): Promise<void> => {
      tr.style.setProperty('--tr-color', color);
      tr.style.setProperty('--tr-peak', String(peak));
      tr.classList.remove('tr-in', 'tr-out', 'tr-wipe-in', 'tr-wipe-out');
      await this.cssAnim(tr, inCls, outMs);
      if (gen !== this.gen) return;
      swap();
      await this.cssAnim(tr, outCls, inMs);
      tr.classList.remove(inCls, outCls);
    };
    switch (kind) {
      case 'slow_fade':
        await dip('#000', 650, 750, 1);
        break;
      case 'dissolve':
        await dip('#000', 200, 260, 0.62);
        break;
      case 'flash':
        await dip('#fff', 90, 300, 1);
        break;
      case 'wipe':
        await dip('#000', 280, 280, 1, 'tr-wipe-in', 'tr-wipe-out');
        break;
      case 'vhs_glitch': {
        const ms = 460;
        let swapped = false;
        const doSwap = (): void => {
          if (swapped || gen !== this.gen) return;
          swapped = true;
          swap();
        };
        // Камкордер рисует разрыв кадра сам; при выключенных эффектах — запасной вариант на CSS.
        const native = this.camcorder.glitch(ms);
        if (!native) this.noiseEl.classList.add('is-on');
        const timer = setTimeout(doSwap, ms * 0.48);
        if (native) await this.wait(ms);
        else await this.cssAnim(this.sceneEl, 'tr-glitch', ms);
        clearTimeout(timer);
        doSwap(); // если таймер задержала фоновая вкладка
        this.sceneEl.classList.remove('tr-glitch');
        this.noiseEl.classList.remove('is-on');
        break;
      }
      case 'fade':
      default:
        await dip('#000', 240, 280, 1);
        break;
    }
  }

  // ───────────────────────────── чёрный кадр ─────────────────────────────

  private fadeBlack(to: 0 | 1, ms: number): Promise<void> {
    this.blackEl.style.transition = ms > 0 ? `opacity ${ms}ms linear` : 'none';
    this.blackEl.style.opacity = String(to);
    return ms > 0 ? this.wait(ms) : Promise.resolve();
  }

  private releasePersistedBlack(immediate = false): void {
    if (!this.blackPersisted) return;
    this.blackPersisted = false;
    void this.fadeBlack(0, immediate ? 0 : 350);
  }

  private resetTransient(): void {
    this.trEl.className = 'vn-stage__tr';
    this.sceneEl.classList.remove('tr-glitch', 'fx-shake', 'fx-glitch');
    this.el.classList.remove('fx-freeze', 'fx-slowmo');
    this.camcorder.freeze(false);
    this.noiseEl.className = 'vn-stage__noise';
    this.bandEl.className = 'vn-stage__band';
    this.blackEl.style.transition = 'none';
    this.blackEl.style.opacity = '0';
    this.blackPersisted = false;
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = '0';
    this.holdEl.style.transition = 'none';
    this.holdEl.style.opacity = '0';
    this.holding = false;
  }

  // ───────────────────────────── эффекты fx ─────────────────────────────

  private async timedClass(el: HTMLElement, cls: string, ms: number, vars: Record<string, string> = {}): Promise<void> {
    const gen = this.gen;
    el.style.setProperty('--fx-ms', `${ms}ms`);
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    await this.wait(ms);
    if (gen !== this.gen) return;
    el.classList.remove(cls);
    for (const k of Object.keys(vars)) el.style.removeProperty(k);
  }

  /** Сбросить моторный зум (и устойчивое состояние «наезда»). */
  private cancelZoom(clearStyle: boolean): void {
    if (this.zoomAnim) {
      try {
        this.zoomAnim.cancel();
      } catch {
        /* анимация уже снята */
      }
      this.zoomAnim = null;
    }
    if (clearStyle) {
      this.camEl.style.transform = '';
      this.camEl.style.filter = '';
      this.camEl.style.transition = '';
    }
  }

  /**
   * Моторный зум камкордера: 1,00 → 1,12 за ms с небольшим перелётом и коротким «поиском фокуса»
   * (размытие 0 → 1 px → 0). После окончания «наезд» остаётся до конца сцены. При выключенных
   * эффектах камеры — гладкий зум без перелёта и размытия.
   */
  private async zoomMotor(ms: number, k: number, instant: boolean): Promise<void> {
    const gen = this.gen;
    const target = 1 + ZOOM_AMOUNT * k;
    const el = this.camEl;
    el.classList.remove('camera-ken_burns'); // иначе анимация Ken Burns перебила бы transform
    this.cancelZoom(true);
    if (instant || ms <= 0) {
      el.style.transform = `scale(${target.toFixed(4)})`;
      return;
    }
    const fancy = this.camcorder.effectiveLevel !== 'off';
    if (typeof el.animate === 'function') {
      const anim = el.animate(
        zoomKeyframes(target, fancy).map((f) => ({ offset: f.offset, transform: f.transform, filter: f.filter })),
        { duration: ms, easing: 'linear', fill: 'forwards' },
      );
      this.zoomAnim = anim;
      await Promise.race([anim.finished.then(() => undefined, () => undefined), this.wait(ms + 120)]);
      if (gen !== this.gen) return;
      el.style.transform = `scale(${target.toFixed(4)})`;
      this.cancelZoom(false);
      return;
    }
    el.style.transition = `transform ${ms}ms ease-out`;
    el.style.transform = `scale(${target.toFixed(4)})`;
    await this.wait(ms);
  }

  async playFx(fx: FxKind, ms: number, intensity: number, instant: boolean): Promise<void> {
    const k = clamp01(intensity);
    if (instant) {
      // Без анимации сохраняем только устойчивые состояния: чёрный экран и наезд.
      if (fx === 'fade_out') {
        this.blackPersisted = true;
        await this.fadeBlack(1, 0);
      } else if (fx === 'fade_in') {
        this.blackPersisted = false;
        await this.fadeBlack(0, 0);
      } else if (fx === 'zoom_in') {
        await this.zoomMotor(0, k, true);
      }
      return;
    }
    const gen = this.gen;
    switch (fx) {
      case 'black_hold':
        await this.fadeBlack(1, Math.min(140, ms / 4));
        await this.wait(Math.max(0, ms - 140));
        if (gen !== this.gen) return;
        void this.fadeBlack(0, Math.min(280, ms / 3));
        break;
      case 'fade_out':
        this.blackPersisted = true;
        await this.fadeBlack(1, ms);
        break;
      case 'fade_in':
        this.blackPersisted = false;
        await this.fadeBlack(0, ms);
        break;
      case 'flash':
        this.flashEl.style.transition = 'none';
        this.flashEl.style.opacity = String(0.55 + 0.45 * k);
        void this.flashEl.offsetWidth;
        this.flashEl.style.transition = `opacity ${ms}ms ease-out`;
        this.flashEl.style.opacity = '0';
        await this.wait(ms);
        break;
      case 'shake':
        await this.timedClass(this.sceneEl, 'fx-shake', ms, { '--fx-amp': `${(5 + 12 * k).toFixed(1)}px` });
        break;
      case 'vhs_glitch':
        if (this.camcorder.glitch(ms)) {
          await this.wait(ms);
        } else {
          this.noiseEl.classList.add('is-on');
          await this.timedClass(this.sceneEl, 'fx-glitch', ms);
          this.noiseEl.classList.remove('is-on');
        }
        break;
      case 'tracking_noise':
        this.bandEl.classList.add('is-on');
        await this.timedClass(this.bandEl, 'fx-sweep', ms);
        this.bandEl.classList.remove('is-on');
        break;
      case 'freeze_frame':
        // Стоп-кадр: дрожание замирает, кадр слегка темнеет.
        this.camcorder.freeze(true);
        await this.timedClass(this.el, 'fx-freeze', ms);
        if (gen === this.gen) this.camcorder.freeze(false);
        break;
      case 'zoom_in':
        await this.zoomMotor(ms, k, false);
        break;
      case 'slow_motion':
        await this.timedClass(this.el, 'fx-slowmo', ms);
        break;
      case 'static_tv':
        this.noiseEl.classList.add('is-on', 'is-strong');
        await this.wait(ms);
        this.noiseEl.classList.remove('is-on', 'is-strong');
        break;
      case 'rewind':
        this.bandEl.classList.add('is-on', 'is-rewind');
        await this.timedClass(this.bandEl, 'fx-sweep', ms);
        this.bandEl.classList.remove('is-on', 'is-rewind');
        break;
    }
  }
}
