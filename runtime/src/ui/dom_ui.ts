/**
 * DomUI — реализация порта SessionUI на DOM: показывает реплики (typewriter, авто-режим,
 * Skip прочитанного), выборы с таймером, паузы титров и эффектов, документы, мини-игры и финал.
 * Весь вход игрока (клик/тап/Space/Enter, Ctrl, колесо, горячие клавиши) разбирается здесь.
 */
import type { Container } from 'pixi.js';
import { i18n, t } from '../core/i18n';
import { charsPerSecond } from '../core/settings';
import type { Settings } from '../core/settings';
import type {
  ChoicePending,
  DocumentPending,
  EndPending,
  Episode,
  GameState,
  HoldPending,
  LinePending,
  MinigamePending,
  MinigameResult,
  Value,
  ViewState,
} from '../core/types';
import { createMinigame } from '../minigames/registry';
import type { GameContext, IMinigame } from '../minigames/types';
import type { IPlatform } from '../platform/types';
import type { BaseContext, HoldContext, LineContext, MinigameContext, SessionUI } from '../session';
import type { VoicePlayback } from '../stage/audio';
import { presetOf } from '../stage/presets';
import type { Stage } from '../stage/stage';
import type { ILineVoice } from '../stage/voice';
import type { CaptionLayer } from './captions';
import type { UiKit } from './kit';
import type { QuickAction } from './quick_menu';
import { DocumentScreen, EndingScreen, MinigameScreen, nameOf, titleOf } from './screens';
import type { Screen } from './screen_host';
import type { LineView, TextLayout } from './textbox';

/** Пауза между репликами при Skip. */
const SKIP_DELAY_MS = 35;
/** Авто-режим с озвучкой: после конца клипа (и полного вывода текста) ждём ещё столько, потом листаем. */
export const AUTO_VOICE_TAIL_MS = 300;
/** Страховка авто-режима: клип завис (оборвалась сеть, play() не отвечает) — дольше этого реплику не держим. */
export const AUTO_VOICE_MAX_WAIT_MS = 120_000;

export interface DomUIDeps {
  episode: Episode;
  kit: UiKit;
  stage: Stage;
  captions: CaptionLayer;
  platform: IPlatform;
  settings: () => Settings;
  view: () => ViewState | null;
  env: () => Readonly<Record<string, Value>>;
  onOpenArchive: () => void;
  /** Изображение бланка документа (assets.documents): адрес сразу, если уже загружен, и промис на позже. */
  documentArt?: (docId: string) => { url: string | null; ready: Promise<string | null>; textInImage?: boolean };
  /** Портрет персонажа для окна реплики (cast.portrait); нет — null. */
  portraitArt?: (who: string) => string | null;
  /** Быстрое меню / горячие клавиши, которыми управляет App. */
  onAction: (action: QuickAction) => void;
  onRollback: () => void;
  /** Озвучка реплик (stage/voice.ts); без неё реплики немые. */
  voice?: ILineVoice;
}

interface Waiter {
  advance(): void;
  rearrange?(): void;
}

export class DomUI implements SessionUI {
  autoOn = false;
  skipOn = false;
  uiHidden = false;

  private ctrlSkip = false;
  private paused = false;
  private waiter: Waiter | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentLine: LinePending | null = null;
  private lineRead = false;
  /** Клип озвучки показанной реплики и отписка авто-режима от его конца. */
  private clip: VoicePlayback | null = null;
  private clipOff: (() => void) | null = null;
  private activeMg: { id: string; mg: IMinigame } | null = null;
  private readonly gameScreens = new Set<Screen>();
  private dummyRoot: unknown = null;
  private lastWheel = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly d: DomUIDeps) {
    this.disposers.push(d.kit.screens.onChange(() => this.onModalChange()));
    this.bindInput();
  }

  get fastForward(): boolean {
    return this.skipOn || this.ctrlSkip;
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
  }

  // ───────────────────────────── SessionUI ─────────────────────────────

  showLine(p: LinePending, ctx: LineContext): Promise<void> {
    const { kit } = this.d;
    const settings = this.d.settings();
    this.currentLine = p;
    this.lineRead = ctx.read;
    const mayFast = this.fastForward && (ctx.read || settings.skipUnread);
    // Skip «только прочитанное»: дошли до непрочитанной реплики — останавливаемся.
    if (this.skipOn && !mayFast) this.setSkip(false);
    // Озвучка: клип стартует вместе с показом реплики. При Skip прочитанного (реплика мелькает на 35 мс) тишина;
    // клипа нет в индексе, озвучка выключена или звука нет — реплика немая, всё как раньше.
    this.stopClip();
    if (!mayFast && !ctx.signal.aborted) this.clip = this.d.voice?.start(p) ?? null;
    kit.textbox.show(this.lineView(p), mayFast ? Number.POSITIVE_INFINITY : charsPerSecond(settings.textSpeed));

    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        this.clearTimer();
        off();
        this.waiter = null;
        this.stopClip(); // следующая реплика, Skip, откат — клип обрывается
        resolve();
      };
      const arrange = (): void => {
        this.clearTimer();
        if (finished || this.paused || kit.screens.count > 0) return;
        if (this.fastForward && (this.lineRead || this.d.settings().skipUnread)) {
          this.timer = setTimeout(finish, SKIP_DELAY_MS);
        } else if (this.autoOn) {
          this.armAuto(p, finish, arrange);
        }
      };
      const off = kit.textbox.onComplete(arrange);
      this.waiter = {
        advance: () => {
          if (kit.textbox.typing) kit.textbox.finishNow();
          else finish();
        },
        rearrange: arrange,
      };
      ctx.signal.addEventListener(
        'abort',
        () => {
          finished = true;
          this.clearTimer();
          off();
          this.waiter = null;
          this.stopClip(); // партию отменили (загрузка, откат, меню): клип не должен доигрывать
        },
        { once: true },
      );
      if (kit.textbox.complete) arrange();
    });
  }

  async showChoice(p: ChoicePending, ctx: BaseContext): Promise<string> {
    this.setSkip(false);
    this.clearTimer();
    const s = this.d.settings();
    // Таймеры выборов — только если включены в настройках и не режим «только история».
    return this.d.kit.choices.ask(p, { timers: s.timers && !s.storyOnly, signal: ctx.signal });
  }

  async hold(p: HoldPending, ctx: HoldContext): Promise<void> {
    this.clearTimer();
    this.d.kit.textbox.hide();
    if (p.reason === 'caption' && p.caption) {
      const close = this.d.captions.hold(p.caption.key, p.caption.style);
      try {
        await this.waitHold(p.ms, ctx);
      } finally {
        close();
      }
      return;
    }
    if (p.fx) {
      const visual = this.d.stage.playFx(p.fx.fx, p.ms, p.fx.intensity, ctx.instant);
      await Promise.race([visual, this.waitHold(p.ms, ctx)]);
    }
  }

  showDocument(p: DocumentPending, ctx: BaseContext): Promise<void> {
    this.setSkip(false);
    this.clearTimer();
    return new Promise<void>((resolve) => {
      const art = this.d.documentArt?.(p.doc);
      const screen = new DocumentScreen(
        this.d.episode,
        p.doc,
        p.text_key,
        p.adds_to_archive,
        () => {
          this.closeGameScreen(screen);
          resolve();
        },
        art?.url ?? null,
        art?.textInImage === true,
      );
      this.openGameScreen(screen);
      // Бланк мог ещё грузиться: покажем, как только придёт.
      void art?.ready.then((url) => {
        if (url && this.gameScreens.has(screen)) screen.setImage(url);
      });
      ctx.signal.addEventListener('abort', () => this.closeGameScreen(screen), { once: true });
    });
  }

  async runMinigame(p: MinigamePending, ctx: MinigameContext): Promise<MinigameResult> {
    const { kit, stage, platform, episode } = this.d;
    this.setSkip(false);
    this.clearTimer();
    kit.textbox.hide();
    const root = (await this.minigameRoot()) as Container;
    const screen = new MinigameScreen();
    // Поиск по списку (режим дела) — во весь экран: картинка крупно, список целей колонкой рядом.
    // осмотр места — во весь экран: картинку разглядывают (и в режиме дела со списком целей, и в осмотре новеллы)
    if (p.def.config.list === true || p.def.type === 'crime_scene_search') screen.el.classList.add('is-wide');
    this.openGameScreen(screen);
    stage.setMinigameActive(true);
    const mg = createMinigame(p.def.type);
    const settings = this.d.settings();
    const gctx: GameContext = {
      episode,
      def: p.def,
      get lang() {
        return i18n.lang;
      },
      t: (key, params) => t(key, params),
      vars: () => this.d.env(),
      settings: { timers: settings.timers && !settings.storyOnly, storyOnly: settings.storyOnly },
      introKey: p.intro_key,
      ...(platform.capabilities.rewarded ? { showRewarded: () => platform.showRewarded('minigame_hint') } : {}),
      track: (event, data) => platform.track(event, data),
      autosave: ctx.autosave,
      onLanguageChange: (cb) => i18n.onChange(() => cb()),
    };
    return new Promise<MinigameResult>((resolve) => {
      let done = false;
      const cleanup = (): void => {
        if (this.activeMg?.mg === mg) this.activeMg = null;
        try {
          mg.destroy();
        } catch (e) {
          console.warn('[minigame] destroy:', e);
        }
        this.closeGameScreen(screen);
        stage.setMinigameActive(false);
      };
      mg.onResult = (r) => {
        if (done) return;
        done = true;
        const state = ctx.final ? mg.serialize() : undefined;
        cleanup();
        ctx.final?.(state);
        resolve(r);
      };
      ctx.signal.addEventListener(
        'abort',
        () => {
          if (done) return;
          done = true;
          cleanup();
        },
        { once: true },
      );
      this.activeMg = { id: p.def.id, mg };
      mg.mount(root, screen.body, p.def.config, gctx);
      if (ctx.restore !== undefined) mg.restore(ctx.restore);
      if (this.paused) mg.pause();
    });
  }

  showEnding(p: EndPending, state: Readonly<GameState>, ctx: BaseContext): Promise<void> {
    this.setSkip(false);
    this.clearTimer();
    this.d.kit.textbox.hide();
    this.d.kit.choices.close();
    return new Promise<void>((resolve) => {
      const screen = new EndingScreen(p.ending, state, {
        onMenu: () => {
          this.closeGameScreen(screen);
          resolve();
        },
        onArchive: this.d.onOpenArchive,
      });
      this.openGameScreen(screen);
      ctx.signal.addEventListener('abort', () => this.closeGameScreen(screen), { once: true });
    });
  }

  minigameState(): { id: string; state: unknown } | null {
    return this.activeMg ? { id: this.activeMg.id, state: this.activeMg.mg.serialize() } : null;
  }

  reset(): void {
    this.clearTimer();
    this.waiter = null;
    this.currentLine = null;
    this.stopClip();
    this.d.voice?.stop();
    this.d.kit.textbox.hide();
    this.d.kit.choices.close();
    for (const s of [...this.gameScreens]) this.closeGameScreen(s);
    this.d.stage.setMinigameActive(false);
    this.setSkip(false);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.d.kit.root.classList.toggle('is-paused', paused);
    this.d.kit.textbox.setPaused(paused);
    this.d.kit.choices.setPaused(paused);
    if (this.activeMg) {
      if (paused) this.activeMg.mg.pause();
      else this.activeMg.mg.resume();
    }
    if (paused) this.clearTimer();
    else this.waiter?.rearrange?.();
  }

  // ───────────────────────────── режимы и ввод ─────────────────────────────

  toggleAuto(): void {
    this.autoOn = !this.autoOn;
    this.d.kit.quick.setState({ auto: this.autoOn });
    if (this.autoOn) this.waiter?.rearrange?.();
    else this.clearTimer();
  }

  toggleSkip(): void {
    if (!this.skipOn && this.currentLine && !(this.lineRead || this.d.settings().skipUnread)) {
      // Пропускать можно только прочитанное: объясняем подсказкой, иначе кнопка выглядит сломанной.
      this.d.kit.toasts.push(t('ui.skip.read_only'));
      return;
    }
    this.setSkip(!this.skipOn);
    if (this.skipOn) this.pokeSkip();
  }

  setSkip(on: boolean): void {
    if (this.skipOn === on) return;
    this.skipOn = on;
    this.d.kit.quick.setState({ skip: on });
  }

  toggleHidden(): void {
    this.setUiHidden(!this.uiHidden);
  }

  setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
    this.d.kit.setUiHidden(hidden);
  }

  /** Продвинуть сюжет: клик, тап, Space, Enter. */
  advance(): void {
    if (this.d.kit.screens.count > 0) return;
    if (this.uiHidden) {
      this.setUiHidden(false);
      return;
    }
    if (this.d.kit.choices.active) return;
    this.waiter?.advance();
  }

  /** Язык сменили: перерисовать всё, что показано на экране, не трогая сцену. */
  refreshLanguage(): void {
    const { kit, captions } = this.d;
    document.documentElement.lang = i18n.lang;
    kit.quick.refresh();
    kit.choices.refresh();
    captions.refresh();
    kit.screens.refresh();
    if (this.currentLine && kit.textbox.visible) kit.textbox.rerender(this.lineView(this.currentLine));
    // Клип прежнего языка обрывается; авто-режим считает паузу по тексту (отсчёт возобновится, когда закроют экран).
    if (this.clip) {
      this.stopClip();
      this.waiter?.rearrange?.();
    }
  }

  private pokeSkip(): void {
    if (!this.waiter) return;
    if (this.lineRead || this.d.settings().skipUnread) {
      this.d.kit.textbox.finishNow();
      this.waiter.rearrange?.();
    } else if (this.skipOn) {
      this.setSkip(false);
    }
  }

  private onModalChange(): void {
    if (this.d.kit.screens.count > 0) this.clearTimer();
    else this.waiter?.rearrange?.();
  }

  private bindInput(): void {
    const { root } = this.d.kit;
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target || e.button !== 0) return;
      if (target.closest('button, input, label, select, textarea, a, .vn-screens, .vn-quick, .vn-choices')) return;
      this.advance();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Control' && !this.ctrlSkip) {
        this.ctrlSkip = true;
        this.pokeSkip();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const inControl = !!target?.closest('button, input, select, textarea, a');
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.d.kit.screens.closeTop()) {
          if (this.uiHidden) this.setUiHidden(false);
          else this.d.onAction('settings');
        }
        return;
      }
      if (this.d.kit.screens.count > 0) return;
      // Номера 1..9 выбирают вариант.
      if (/^[1-9]$/.test(e.key) && this.d.kit.choices.active) {
        if (this.d.kit.choices.chooseByIndex(Number(e.key) - 1)) e.preventDefault();
        return;
      }
      if (inControl) return;
      switch (e.key) {
        case ' ':
        case 'Enter':
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          this.advance();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          this.d.onRollback();
          break;
        case 'a':
        case 'A':
          this.d.onAction('auto');
          break;
        case 's':
        case 'S':
          this.d.onAction('skip');
          break;
        case 'l':
        case 'L':
          this.d.onAction('log');
          break;
        case 'n':
        case 'N':
          this.d.onAction('notebook');
          break;
        case 'h':
        case 'H':
          this.d.onAction('hide');
          break;
        case 'm':
        case 'M':
          this.d.onAction('mute');
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') this.ctrlSkip = false;
    };
    const onWheel = (e: WheelEvent): void => {
      if (this.d.kit.screens.count > 0 || e.deltaY >= 0) return;
      const now = performance.now();
      if (now - this.lastWheel < 450) return;
      this.lastWheel = now;
      this.d.onRollback();
    };
    root.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    root.addEventListener('wheel', onWheel, { passive: true });
    this.disposers.push(
      () => root.removeEventListener('click', onClick),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => root.removeEventListener('wheel', onWheel),
    );
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private lineView(p: LinePending): LineView {
    const view = this.d.view();
    const preset = presetOf(view?.presentation ?? 'reconstruction');
    const layout: TextLayout = preset.text === 'window' ? 'window' : 'subtitle';
    const showName = p.style === 'say' && p.who !== null && (preset.speakerName || layout === 'subtitle');
    // Окно реплики (макет в Figma): полное имя, подпись под ним и портрет.
    return {
      name: showName ? nameOf(this.d.episode, p.who, false) : null,
      title: showName ? titleOf(this.d.episode, p.who) : null,
      portrait: showName && p.who ? (this.d.portraitArt?.(p.who) ?? null) : null,
      text: t(p.key),
      style: p.style === 'say' ? 'say' : (p.narrate_style ?? 'voiceover'),
      layout,
    };
  }

  private autoDelay(p: LinePending): number {
    const chars = Array.from(t(p.key)).length;
    return this.d.settings().autoDelayMs + Math.min(2500, chars * 20);
  }

  private clearTimer(): void {
    this.d.kit.autobar.stop();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.clipOff?.();
    this.clipOff = null;
  }

  /**
   * Авто-режим. С озвучкой реплика длится, пока играет клип: ждём его конец (и полный вывод текста — сюда попадаем
   * после него) плюс AUTO_VOICE_TAIL_MS. Клип сорвался (файл не читается, автозапуск запрещён) или его остановили
   * (озвучку выключили, сменили язык) — снова считаем паузу по длине текста, как для реплики без клипа.
   */
  private armAuto(p: LinePending, finish: () => void, rearm: () => void): void {
    const clip = this.clip;
    const bar = this.d.kit.autobar;
    if (clip?.state === 'playing') {
      // Длительность клипа заранее неизвестна: полоса отсчёта показывается только для паузы по тексту.
      bar.stop();
      this.timer = setTimeout(finish, AUTO_VOICE_MAX_WAIT_MS);
      this.clipOff = clip.onEnd((how) => {
        this.clipOff = null;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        if (how === 'ended') {
          this.timer = setTimeout(finish, AUTO_VOICE_TAIL_MS);
          bar.start(AUTO_VOICE_TAIL_MS);
        } else rearm();
      });
    } else if (clip?.state === 'ended') {
      this.timer = setTimeout(finish, AUTO_VOICE_TAIL_MS);
      bar.start(AUTO_VOICE_TAIL_MS);
    } else {
      const ms = this.autoDelay(p);
      this.timer = setTimeout(finish, ms);
      bar.start(ms);
    }
  }

  /** Оборвать клип озвучки показанной реплики и отписаться от его конца. */
  private stopClip(): void {
    const clip = this.clip;
    this.clip = null;
    this.clipOff?.();
    this.clipOff = null;
    clip?.stop();
  }

  /** Пауза сценария на ms (титры chapter/fact, эффекты fx): завершается по таймеру, клику или в режиме Skip. */
  private waitHold(ms: number, ctx: HoldContext): Promise<void> {
    return new Promise<void>((resolve) => {
      if (ctx.instant || this.fastForward) {
        resolve();
        return;
      }
      let finished = false;
      const done = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.waiter = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiter = { advance: done };
      ctx.signal.addEventListener('abort', done, { once: true });
    });
  }

  private openGameScreen(screen: Screen): void {
    this.gameScreens.add(screen);
    this.d.kit.screens.open(screen);
  }

  private closeGameScreen(screen: Screen): void {
    this.gameScreens.delete(screen);
    this.d.kit.screens.close(screen);
  }

  /** Контейнер PixiJS для мини-игр; без WebGL (DOM-рендерер) — отдельный Container без рендерера. */
  private async minigameRoot(): Promise<unknown> {
    const root = this.d.stage.minigameRoot;
    if (root) return root;
    if (!this.dummyRoot) {
      const { Container } = await import('pixi.js');
      this.dummyRoot = new Container();
    }
    return this.dummyRoot;
  }
}
