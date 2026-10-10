/**
 * Оболочка сцены (DOM): фильтры, letterbox, переходы и эффекты fx — это CSS-классы и CSS-анимации
 * на контейнере; сам кадр (плейсхолдеры фона, спрайтов и CG) рисует сменный рендерер
 * (PixiJS или DOM, см. renderer.ts). Реализует IStage — порт, через который работает Director.
 *
 * Переходы и рекламная пауза:
 *  - changeScene(): гашение → смена кадра → проявление (fade / slow_fade / dissolve / flash /
 *    wipe — «провал» через цветной слой, vhs_glitch — помехи на самой сцене).
 *  - fadeToBlackAndHold() / revealFromBlack(): две половины того же перехода, разнесённые
 *    во времени ради рекламы на границе блока. Между ними чёрный кадр ДЕРЖИТСЯ (слой
 *    `vn-stage__hold`), новая сцена выставляется под ним и проявляется только в revealFromBlack().
 *    Кто и когда их вызывает — правило в stage/director.ts.
 */
import type { ViolenceMode } from '../core/settings';
import type { FxKind, SpriteView, StageFilter, TransitionKind, ViewState } from '../core/types';
import { h, sleep } from '../ui/dom';
import { effectiveFilter, presetOf } from './presets';
import type { ISceneRenderer } from './renderer';
import type { IStage } from './types';

const FILTERS: readonly StageFilter[] = ['vhs', 'vhs_heavy', 'archive_photo', 'night', 'sepia', 'desaturated', 'noir'];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class Stage implements IStage {
  readonly el: HTMLElement;
  /** Сюда UI кладёт слой титров: он живёт внутри сцены, под текстовым окном. */
  readonly captionsEl: HTMLElement;
  readonly renderer: ISceneRenderer;

  private readonly sceneEl: HTMLElement;
  private readonly camEl: HTMLElement;
  private readonly hostEl: HTMLElement;
  private readonly blackEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly noiseEl: HTMLElement;
  private readonly bandEl: HTMLElement;
  private readonly trEl: HTMLElement;
  private readonly holdEl: HTMLElement;

  private view: ViewState | null = null;
  /** Счётчик «поколений»: setView() отменяет незавершённые переходы. */
  private gen = 0;
  private blackPersisted = false;
  private holding = false;

  constructor(renderer: ISceneRenderer) {
    this.renderer = renderer;
    this.hostEl = h('div', { class: 'vn-stage__host' });
    this.camEl = h('div', { class: 'vn-stage__cam' }, this.hostEl);
    this.sceneEl = h('div', { class: 'vn-stage__scene' }, this.camEl);
    this.captionsEl = h('div', { class: 'vn-stage__captions' });
    this.blackEl = h('div', { class: 'vn-stage__black' });
    this.flashEl = h('div', { class: 'vn-stage__flash' });
    this.noiseEl = h('div', { class: 'vn-stage__noise' });
    this.bandEl = h('div', { class: 'vn-stage__band' });
    this.trEl = h('div', { class: 'vn-stage__tr' });
    this.holdEl = h('div', { class: 'vn-stage__hold' });
    this.el = h(
      'div',
      { class: 'vn-stage', data: { presentation: 'title' } },
      this.sceneEl,
      h('div', { class: 'vn-stage__layer vn-stage__grain' }),
      h('div', { class: 'vn-stage__layer vn-stage__scan' }),
      h('div', { class: 'vn-stage__layer vn-stage__vignette' }),
      h('div', { class: 'vn-stage__layer vn-stage__tint' }),
      h('div', { class: 'vn-stage__layer vn-stage__weather' }),
      h('div', { class: 'vn-stage__letterbox vn-stage__letterbox--top' }),
      h('div', { class: 'vn-stage__letterbox vn-stage__letterbox--bottom' }),
      this.captionsEl,
      this.noiseEl,
      this.bandEl,
      this.flashEl,
      this.blackEl,
      this.trEl,
      this.holdEl,
    );
  }

  /** Вставить сцену в родителя и поднять рендерер. При ошибке рендерера вызывающий делает destroy(). */
  async mount(parent: HTMLElement): Promise<void> {
    parent.appendChild(this.el);
    await this.renderer.mount(this.hostEl);
  }

  destroy(): void {
    this.gen += 1;
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
    this.el.classList.toggle('is-minigame', active);
    this.renderer.setMinigameActive?.(active);
  }

  setViolenceMode(mode: ViolenceMode): void {
    this.renderer.setViolenceMode(mode);
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
    const swap = (): void => {
      this.applyFrame(view);
      this.renderer.setView(view);
      this.releasePersistedBlack();
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
    // Под непрозрачным чёрным слоем выставляем новую сцену…
    this.applyFrame(view);
    this.renderer.setView(view);
    this.releasePersistedBlack(true);
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
    const swap = (): void => {
      if (this.view) {
        this.view = { ...this.view, bg, filter, cg: null };
        this.setFilterClass(effectiveFilter(this.view));
      }
      this.renderer.setBackground(bg);
      this.renderer.setCg(null);
    };
    if (instant || transition === 'cut') swap();
    else await this.transition(transition, swap);
  }

  async showCg(cg: string, transition: TransitionKind, instant: boolean): Promise<void> {
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
    this.setFilterClass(effectiveFilter(view));
    const camera = presetOf(view.presentation).camera;
    this.camEl.classList.remove('camera-static', 'camera-ken_burns', 'fx-zoom');
    this.camEl.style.removeProperty('--fx-zoom');
    if (sceneChanged || !this.camEl.dataset.camera) void this.camEl.offsetWidth; // перезапуск Ken Burns
    this.camEl.classList.add(`camera-${camera}`);
    this.camEl.dataset.camera = camera;
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
        this.noiseEl.classList.add('is-on');
        const timer = setTimeout(doSwap, ms * 0.48);
        await this.cssAnim(this.sceneEl, 'tr-glitch', ms);
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
        this.camEl.style.setProperty('--fx-zoom', String(1 + 0.14 * k));
        this.camEl.style.setProperty('--fx-ms', '0ms');
        this.camEl.classList.add('fx-zoom');
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
        this.noiseEl.classList.add('is-on');
        await this.timedClass(this.sceneEl, 'fx-glitch', ms);
        this.noiseEl.classList.remove('is-on');
        break;
      case 'tracking_noise':
        this.bandEl.classList.add('is-on');
        await this.timedClass(this.bandEl, 'fx-sweep', ms);
        this.bandEl.classList.remove('is-on');
        break;
      case 'freeze_frame':
        await this.timedClass(this.el, 'fx-freeze', ms);
        break;
      case 'zoom_in':
        this.camEl.style.setProperty('--fx-zoom', String(1 + 0.14 * k));
        this.camEl.style.setProperty('--fx-ms', `${ms}ms`);
        this.camEl.classList.add('fx-zoom');
        await this.wait(ms);
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
