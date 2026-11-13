/**
 * Приложение: экраны, пауза, ввод с устройств и главный цикл. Игровая логика — в game.ts.
 */
import { i18n, t } from './core/i18n';
import { mulberry32 } from './core/rng';
import type { Lang } from './core/types';
import { Game, STEP } from './game';
import type { StepEvents } from './game';
import { Lifecycle } from './lifecycle';
import { detectCoarsePointer } from './platform';
import type { IPlatform } from './platform';
import { emptyInput } from './player/input';
import type { InputFrame } from './player/input';
import { DesktopInput } from './player/input_desktop';
import { MotionSensor } from './player/motion';
import { GameRenderer } from './render/renderer';
import type { Quality } from './render/renderer';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';
import { TouchControls } from './ui/touch_controls';
import { generateLayout } from './gen/layout';
import type { BuiltLevel } from './world/level';
import { buildLevel } from './world/level_build';
import { buildTestLevel } from './world/test_level';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const isQuality = (v: string | null): v is Quality => v === 'low' || v === 'med' || v === 'high';

export class App {
  readonly lifecycle = new Lifecycle();
  readonly i18n = i18n;
  game!: Game;
  /** Текущий уровень (геометрия уже отдана рендеру; здесь — игровые точки и граф). */
  level!: BuiltLevel;
  overlay!: Overlay;
  hud!: Hud;
  motion!: MotionSensor;
  /** Первый кадр показан, площадке отправлено game_ready. */
  ready = false;
  /** Автоматическая симуляция остановлена (ей управляет отладочный API). */
  frozen = false;
  fps = 0;
  touchMode = false;

  private canvas!: HTMLCanvasElement;
  private desktop: DesktopInput | null = null;
  private touch: TouchControls | null = null;
  private started = false;
  private last = 0;
  private acc = 0;
  private qualityManual = false;
  private playTime = 0;
  private slowTime = 0;
  private showFps = false;

  constructor(
    readonly root: HTMLElement,
    readonly platform: IPlatform,
    readonly params: URLSearchParams,
  ) {}

  async init(): Promise<void> {
    const p = this.params;
    this.setLang(p.get('lang') ? (p.get('lang') as Lang) : this.platform.language(), true);
    if (p.get('pseudo') === '1') i18n.setPseudo(true);
    this.showFps = p.get('fps') === '1';

    const device = this.platform.deviceType();
    // Площадка может ошибиться с типом устройства, поэтому смотрим и на сам указатель;
    // а если по экрану всё-таки коснулись пальцем — тач-управление включается на лету.
    this.touchMode = p.get('touch') === '1' || (p.get('touch') !== '0' && (device === 'mobile' || device === 'tablet' || detectCoarsePointer()));
    this.root.classList.toggle('is-touch', this.touchMode);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vz-canvas';
    this.root.append(this.canvas);
    this.hud = new Hud(this.root);
    this.hud.setVisible(false);
    this.overlay = new Overlay(this.root, {
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onQuality: (q) => {
        this.qualityManual = true;
        this.setQuality(q);
      },
      onMotion: () => void this.enableMotion(),
    });
    this.overlay.setTouch(this.touchMode);
    this.overlay.show('loading');
    this.lifecycle.set('boot', true);

    // Шрифт интерфейса: ждём недолго, чтобы первый экран не мигнул системным.
    await Promise.race([document.fonts?.load?.('16px "JetBrains Mono"').catch(() => undefined) ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);

    const qParam = p.get('q');
    const quality: Quality = isQuality(qParam) ? qParam : this.touchMode ? 'med' : 'high';
    this.qualityManual = isQuality(qParam);
    let renderer: GameRenderer;
    try {
      renderer = new GameRenderer(this.canvas, quality);
    } catch (e) {
      console.error('[vylazka] WebGL2 недоступен:', e);
      this.overlay.show('error', t('ui.error.webgl'));
      this.platform.ready();
      return;
    }
    renderer.onContextLost = () => this.lifecycle.set('context', true);
    renderer.onContextRestored = () => {
      this.lifecycle.set('context', false);
      this.redraw();
    };
    this.overlay.setQuality(quality);

    const seed = Number(p.get('seed') ?? '') || 20041113;
    const failAt = Number(p.get('fail') ?? '');
    const testLevel = p.get('level') === 'test';
    const rank = Math.max(1, Math.min(3, Math.round(Number(p.get('rank') ?? '') || 2))) as 1 | 2 | 3;
    this.game = new Game(renderer, mulberry32(seed), {
      // Первый отказ фонаря — принудительный и скорый: игрок должен сразу узнать, что фонарь надо трясти.
      firstFailAt: Number.isFinite(failAt) && p.get('fail') !== null ? failAt : testLevel ? 12 : 40,
      ...(testLevel ? { meanFailInterval: 30, graceAfterRevive: 10 } : {}),
    });
    // Уровень: по умолчанию — бункер из генератора по сиду; ?level=test — коридор технического среза.
    this.level = testLevel ? buildTestLevel() : buildLevel(generateLayout(seed, rank));
    this.game.loadLevel(this.level);

    this.motion = new MotionSensor(this.game.shake);
    this.desktop = new DesktopInput(this.canvas, this.game.shake, this.lifecycle);
    if (this.touchMode) this.enableTouch();
    else if (p.get('touch') !== '0') {
      const onFirstTouch = (e: PointerEvent): void => {
        if (e.pointerType !== 'touch') return;
        this.root.removeEventListener('pointerdown', onFirstTouch, true);
        this.enableTouch();
      };
      this.root.addEventListener('pointerdown', onFirstTouch, true);
    }
    this.refreshMotionButton();

    const resize = (): void => {
      renderer.resize(this.root.clientWidth, this.root.clientHeight);
      this.redraw();
    };
    new ResizeObserver(resize).observe(this.root);
    resize();

    this.platform.onPause((paused) => this.lifecycle.set('platform', paused));
    document.addEventListener('visibilitychange', () => this.lifecycle.set('hidden', document.hidden));
    this.lifecycle.onChange((paused) => this.onPauseChange(paused));

    await renderer.warmup();
    this.game.fade = 0;
    this.redraw();
    await nextFrame();

    this.lifecycle.set('user', true);
    this.lifecycle.set('boot', false);
    this.overlay.show('start');
    this.platform.ready();
    this.ready = true;
    if (p.get('autostart') === '1') this.start();
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** Включить тач-управление (при загрузке или по первому касанию экрана). */
  private enableTouch(): void {
    if (this.touch) return;
    this.touchMode = true;
    this.root.classList.add('is-touch');
    this.touch = new TouchControls(this.root, this.game.shake);
    this.touch.setVisible(this.started && !this.lifecycle.paused);
    this.overlay.setTouch(true);
    this.refreshMotionButton();
    if (this.started && !MotionSensor.needsPermission()) void this.enableMotion();
  }

  /** Начать вылазку (нажатие на стартовом экране). */
  start(): void {
    if (!this.game || this.started) return;
    this.started = true;
    this.platform.track('level_started', { world: 'bunker', level: this.level.layout ? `seed_${this.level.layout.seed}` : 'test' });
    if (this.touchMode && !MotionSensor.needsPermission()) void this.enableMotion();
    this.resume();
  }

  resume(): void {
    if (!this.started) return;
    this.lifecycle.set('pointer', false);
    this.lifecycle.set('user', false);
    if (!this.touchMode) this.desktop?.capture();
  }

  private onPauseChange(paused: boolean): void {
    if (!this.started) return;
    if (paused) {
      // Возврат в игру — всегда по нажатию: браузер не даст захватить мышь без жеста.
      this.lifecycle.set('user', true);
      this.desktop?.release();
      this.desktop?.uncapture();
      this.touch?.release();
      this.touch?.setVisible(false);
      this.game.shake.reset();
      this.overlay.show('paused');
    } else {
      this.overlay.show('hidden');
      this.hud.setVisible(true);
      this.touch?.setVisible(true);
      this.last = performance.now();
      this.acc = 0;
    }
  }

  private async enableMotion(): Promise<void> {
    await this.motion.enable();
    this.refreshMotionButton();
  }

  private refreshMotionButton(): void {
    const need = this.touchMode && MotionSensor.needsPermission() && this.motion.state !== 'waiting' && this.motion.state !== 'active';
    this.overlay.setMotionButton(need ? t('touch.motion') : null);
  }

  setQuality(q: Quality): void {
    this.game.renderer.setQuality(q);
    this.overlay.setQuality(q);
    this.redraw();
  }

  setLang(lang: Lang, initial = false): void {
    i18n.setLang(lang);
    document.documentElement.lang = i18n.lang;
    if (initial) return;
    this.hud.relabel();
    this.touch?.relabel();
    this.overlay.refresh();
    this.refreshMotionButton();
    this.updateHud();
  }

  private redraw(): void {
    if (!this.game) return;
    this.game.draw(1, 0);
  }

  /** Собрать ввод со всех устройств за кадр. */
  pollInput(): InputFrame {
    const a = this.desktop?.poll() ?? emptyInput();
    const b = this.touch?.poll();
    if (!b) return a;
    const mx = a.moveX + b.moveX;
    const mz = a.moveZ + b.moveZ;
    const len = Math.max(1, Math.hypot(mx, mz));
    return { moveX: mx / len, moveZ: mz / len, run: a.run || b.run, lookYaw: a.lookYaw + b.lookYaw, lookPitch: a.lookPitch + b.lookPitch, light: a.light || b.light, action: a.action || b.action, pause: a.pause || b.pause };
  }

  /** Реакция на события шага: вибрация (где есть) — отдача тряски и момент оживления. */
  handleEvents(ev: StepEvents): void {
    if (!this.touchMode || typeof navigator.vibrate !== 'function') return;
    if (ev.lightRevived) navigator.vibrate(45);
    else if (ev.strokes > 0 && this.game.light.state === 'dead') navigator.vibrate(10);
  }

  updateHud(): void {
    const g = this.game;
    this.hud.setTime(g.time);
    const dead = g.light.state === 'dead';
    const kind = this.touchMode ? (this.motion.state === 'active' ? 'motion' : 'touch') : 'desktop';
    this.hud.setShakePrompt(dead ? t(`hint.shake.${kind}`) : '', g.light.reviveProgress);
    const base = this.touchMode ? 'touch' : 'desktop';
    let hint = '';
    if (!dead) {
      if (g.time < 7) hint = t(`hint.move.${base}`);
      else if (g.time < 12) hint = t(`hint.light.${base}`);
      else if (g.time < 16 && !this.touchMode) hint = t('hint.pause.desktop');
    }
    this.hud.setHint(hint);
    this.touch?.setShakePrompt(dead, g.light.reviveProgress);
    this.touch?.setLit(g.light.state === 'on');
    if (this.showFps) {
      const i = g.renderer.info();
      this.hud.setFps(`${this.fps.toFixed(0)} fps · ${i.width}×${i.height} · ${i.calls} dc · ${(i.triangles / 1000).toFixed(1)}k`);
    }
  }

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.frozen || this.lifecycle.paused) return;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;

    const input = this.pollInput();
    if (input.pause) {
      this.lifecycle.set('user', true);
      return;
    }
    this.game.look(input.lookYaw, input.lookPitch);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.handleEvents(this.game.step(STEP, input));
      input.light = false;
      this.acc -= STEP;
      steps += 1;
    }
    if (steps === 5) this.acc = 0;
    this.game.draw(this.acc / STEP, dt);
    this.updateHud();
    this.autoQuality(dt);
  };

  /** Автопонижение качества: не раньше 10 с игры и только если кадров стабильно мало. */
  private autoQuality(dt: number): void {
    if (this.qualityManual) return;
    this.playTime += dt;
    if (this.playTime < 10) return;
    this.slowTime = this.fps < 27 ? this.slowTime + dt : Math.max(0, this.slowTime - dt * 2);
    if (this.slowTime < 4) return;
    this.slowTime = 0;
    this.playTime = 4;
    const q = this.game.renderer.quality;
    if (q === 'high') this.setQuality('med');
    else if (q === 'med') this.setQuality('low');
  }
}
