/**
 * Приложение: цикл «задание → вылазка → отчёт», пауза, ввод с устройств, сохранения и главный цикл.
 * Игровая логика — в game.ts и systems/.
 */
import { allSoundFiles, AudioEngine } from './audio/engine';
import { GameAudio, LOAD_FIRST } from './audio/game_audio';
import { i18n, t } from './core/i18n';
import { mulberry32 } from './core/rng';
import { loadSave, objectNumber, rankFor, sortieSeed, writeProfile, writeSave } from './core/save';
import type { Profile, RunSave } from './core/save';
import type { Lang } from './core/types';
import { Game, STEP } from './game';
import type { StepEvents } from './game';
import { GEN_VERSION, generateLayout } from './gen/layout';
import { populate } from './gen/populate';
import type { Objective } from './gen/populate';
import { Lifecycle } from './lifecycle';
import { detectCoarsePointer } from './platform';
import type { IPlatform } from './platform';
import { emptyInput } from './player/input';
import type { InputFrame } from './player/input';
import { DesktopInput } from './player/input_desktop';
import { MotionSensor } from './player/motion';
import { GameRenderer } from './render/renderer';
import type { Quality } from './render/renderer';
import type { Outcome, Target } from './systems/sortie';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';
import type { CardLine } from './ui/overlay';
import { TouchControls } from './ui/touch_controls';
import type { BuiltLevel } from './world/level';
import { buildLevel } from './world/level_build';
import { buildShowcase } from './world/showcase';
import { buildTestLevel } from './world/test_level';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const isQuality = (v: string | null): v is Quality => v === 'low' || v === 'med' || v === 'high';
const ROMAN = ['I', 'II', 'III'];

type Screen = 'boot' | 'briefing' | 'play' | 'ending' | 'report';

export class App {
  readonly lifecycle = new Lifecycle();
  readonly i18n = i18n;
  /** Звук: движок и привязка звуков к событиям игры. */
  readonly sound: AudioEngine;
  readonly audio: GameAudio;
  game!: Game;
  /** Текущий уровень (геометрия уже отдана рендеру; здесь — игровые точки и граф). */
  level!: BuiltLevel;
  overlay!: Overlay;
  hud!: Hud;
  motion!: MotionSensor;
  profile!: Profile;
  /** Первый кадр показан, площадке отправлено game_ready. */
  ready = false;
  /** Автоматическая симуляция остановлена (ей управляет отладочный API). */
  frozen = false;
  fps = 0;
  touchMode = false;
  screen: Screen = 'boot';
  /** Сид и ранг текущего объекта. */
  seed = 0;
  rank: 1 | 2 | 3 = 1;

  private canvas!: HTMLCanvasElement;
  private desktop: DesktopInput | null = null;
  private touch: TouchControls | null = null;
  private last = 0;
  private acc = 0;
  private qualityManual = false;
  private playTime = 0;
  private slowTime = 0;
  private showFps = false;
  private testLevel = false;
  private goalsUntil = 0;
  private goalsHeld = false;
  private endingAt = 0;
  private lastSavedTier = 0;
  private saving: Promise<void> = Promise.resolve();
  /** Сохранённая вылазка, которую можно продолжить (до первого старта). */
  private resume: RunSave | null = null;
  /** Подсказки обучения, уже показанные в этой сессии. */
  private readonly taught = new Set<string>();

  constructor(
    readonly root: HTMLElement,
    readonly platform: IPlatform,
    readonly params: URLSearchParams,
  ) {
    // ?audio=<папка> — взять весь набор звуков из папки рядом с игрой (проверка новых клипов без пересборки).
    const dir = params.get('audio');
    const local = dir !== null && /^[a-z0-9_./-]+$/i.test(dir) && !dir.includes('//') ? dir.replace(/\/?$/, '/') : null;
    this.sound = local ? new AudioEngine(local, allSoundFiles()) : new AudioEngine();
    this.audio = new GameAudio(this.sound);
  }

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
      onResume: () => this.resumePlay(),
      onNext: () => void this.nextSortie(),
      onQuality: (q) => {
        this.qualityManual = true;
        this.setQuality(q);
        this.audio.ui('ui_click');
      },
      onMotion: () => void this.enableMotion(),
      onSound: () => this.setMuted(!this.profile.muted),
    });
    // Браузер даёт звук только после жеста: будим его первым же нажатием, где бы оно ни было.
    const wake = (): void => this.sound.unlock();
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const) window.addEventListener(type, wake, { capture: true, passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && this.profile) this.setMuted(!this.profile.muted);
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

    // Сохранение читается одним пакетным вызовом до первого кадра.
    const baseSeed = Number(p.get('seed') ?? '') || 20041113;
    const save = await loadSave(this.platform, baseSeed, GEN_VERSION);
    this.profile = save.profile;
    this.sound.setMuted(this.profile.muted);
    this.overlay.setSound(!this.profile.muted);
    this.testLevel = p.get('level') === 'test';
    const failAt = Number(p.get('fail') ?? '');
    this.game = new Game(renderer, mulberry32(baseSeed), {
      // Первый отказ фонаря — принудительный и скорый: игрок должен сразу узнать, что фонарь надо трясти.
      firstFailAt: Number.isFinite(failAt) && p.get('fail') !== null ? failAt : this.testLevel ? 12 : 40,
      ...(this.testLevel ? { meanFailInterval: 30, graceAfterRevive: 10 } : {}),
    });
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

    // Уровень: сохранённая вылазка, объект из адреса или следующий объект игрока.
    this.resume = !this.testLevel && p.get('seed') === null ? save.run : null;
    const rankParam = Math.round(Number(p.get('rank') ?? ''));
    const rank = rankParam >= 1 && rankParam <= 3 ? (rankParam as 1 | 2 | 3) : null;
    if (this.resume) this.prepare(this.resume.seed, this.resume.rank);
    else this.prepare(p.get('seed') !== null ? baseSeed : sortieSeed(this.profile), rank ?? rankFor(this.profile));

    const resize = (): void => {
      renderer.resize(this.root.clientWidth, this.root.clientHeight);
      this.redraw();
    };
    new ResizeObserver(resize).observe(this.root);
    resize();

    this.platform.onPause((paused) => this.lifecycle.set('platform', paused));
    this.platform.onAudio((enabled) => this.sound.setEnabled(enabled));
    document.addEventListener('visibilitychange', () => this.lifecycle.set('hidden', document.hidden));
    this.lifecycle.onChange((paused) => this.onPauseChange(paused));
    this.lifecycle.onReasons(() => this.syncAudio());

    await renderer.warmup();
    this.redraw();
    await nextFrame();

    this.lifecycle.set('user', true);
    this.lifecycle.set('boot', false);
    this.overlay.show('start');
    this.platform.ready();
    this.ready = true;
    // Звук грузится в фоне уже после первого кадра: игра его не ждёт.
    this.sound.preload(LOAD_FIRST);
    if (p.get('autostart') === '1') this.start();
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** Собрать объект и показать карточку задания. */
  private prepare(seed: number, rank: 1 | 2 | 3): void {
    this.seed = seed >>> 0;
    this.rank = rank;
    if (this.testLevel) {
      this.level = this.params.get('level') === 'show' ? buildShowcase(this.params.get('props')?.split(',') ?? null) : buildTestLevel();
      this.game.loadLevel(this.level, null);
    } else {
      this.level = buildLevel(generateLayout(this.seed, rank));
      this.game.loadLevel(this.level, populate(this.level, this.seed));
      const s = this.game.sortie!;
      if (this.resume) {
        s.restore(this.resume);
        this.game.light.charge = this.resume.charge;
        this.game.time = this.resume.time;
        this.game.refreshItems();
        this.game.applyCollapses();
        this.game.restoreAnomalies(this.resume.anomaly);
        this.game.director?.restore(this.resume.time, this.resume.released);
      }
    }
    this.screen = 'briefing';
    this.audio.setScene('menu');
    this.syncAudio();
    this.lastSavedTier = 0;
    this.endingAt = 0;
    this.overlay.setCard(this.briefingCard());
    this.updateHud();
  }

  private goalText(o: Objective): string {
    if (o.type === 'take') {
      const item = this.game.sortie!.pop.items[o.item!]!;
      return t('goal.take', { name: t(`find.${item.find}.name`) });
    }
    return t('goal.shoot', { name: t(`mark.${o.landmark!.id}`) });
  }

  private briefingCard(): { title: string; sub: string; lines: CardLine[]; prompt: string } | null {
    const s = this.game.sortie;
    if (!s) return null;
    const sfx = this.touchMode ? '.touch' : '';
    const lines: CardLine[] = [{ text: t('brief.goals'), kind: 'head' }];
    for (const o of s.objectives) lines.push({ text: this.goalText(o), kind: s.done.has(o.id) ? 'done' : 'todo' });
    lines.push({ text: t('brief.return'), kind: 'dim' });
    if (this.profile.archive.length > 0) lines.push({ text: t('brief.archive', { n: this.profile.archive.length, total: 16 }), kind: 'dim' });
    return {
      title: t('ui.title'),
      sub: t('brief.object', { n: objectNumber(this.seed), rank: ROMAN[this.rank - 1]!, tiers: this.level.layout?.tierCount ?? 1 }),
      lines,
      prompt: this.resume ? t(`brief.resume${sfx}`) : t(`ui.start${sfx}`),
    };
  }

  /** Начать вылазку (нажатие на карточке задания). */
  start(): void {
    if (!this.game || this.screen !== 'briefing') return;
    this.screen = 'play';
    this.sound.unlock();
    this.audio.setScene('play');
    this.audio.sortieStart(this.resume !== null);
    if (!this.resume && !this.testLevel) this.profile.sorties += 1;
    this.resume = null;
    this.platform.track('level_started', { world: 'bunker', level: this.testLevel ? 'test' : `seed_${this.seed}` });
    if (this.touchMode && !MotionSensor.needsPermission()) void this.enableMotion();
    this.goalsUntil = this.game.time + 7;
    this.saveRun();
    this.resumePlay();
  }

  private resumePlay(): void {
    if (this.screen !== 'play' && this.screen !== 'ending') return;
    this.lifecycle.set('pointer', false);
    this.lifecycle.set('user', false);
    if (!this.touchMode) this.desktop?.capture();
  }

  private onPauseChange(paused: boolean): void {
    if (this.screen !== 'play' && this.screen !== 'ending') return;
    if (paused) {
      // Возврат в игру — всегда по нажатию: браузер не даст захватить мышь без жеста.
      this.lifecycle.set('user', true);
      this.desktop?.release();
      this.desktop?.uncapture();
      this.touch?.release();
      this.touch?.setVisible(false);
      this.game.shake.reset();
      this.overlay.show('paused');
      this.saveRun();
    } else {
      this.overlay.show('hidden');
      this.hud.setVisible(true);
      this.touch?.setVisible(true);
      this.last = performance.now();
      this.acc = 0;
    }
  }

  /**
   * Когда звук молчит целиком. Площадка, реклама и скрытая вкладка глушат всё; пауза игрока глушит
   * вылазку, но не меню: на карточке задания и в отчёте игра «стоит», а музыка играет.
   */
  private syncAudio(): void {
    const lc = this.lifecycle;
    const hard = lc.has('platform') || lc.has('hidden') || lc.has('ad') || lc.has('context');
    const menu = this.screen === 'briefing' || this.screen === 'report';
    this.sound.setPaused(hard || (lc.paused && !menu));
  }

  /** Выключатель звука игрока: кнопка в меню и клавиша M. Выбор запоминается. */
  setMuted(muted: boolean): void {
    this.profile.muted = muted;
    this.sound.setMuted(muted);
    this.overlay.setSound(!muted);
    if (!muted) this.audio.ui('ui_click');
    this.saveProfile();
  }

  /** Включить тач-управление (при загрузке или по первому касанию экрана). */
  private enableTouch(): void {
    if (this.touch) return;
    this.touchMode = true;
    this.root.classList.add('is-touch');
    this.touch = new TouchControls(this.root, this.game.shake);
    this.touch.setVisible(this.screen === 'play' && !this.lifecycle.paused);
    this.overlay.setTouch(true);
    this.refreshMotionButton();
    if (this.screen === 'briefing') this.overlay.setCard(this.briefingCard());
    if (this.screen === 'play' && !MotionSensor.needsPermission()) void this.enableMotion();
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
    if (this.screen === 'briefing') this.overlay.setCard(this.briefingCard());
    else this.overlay.refresh();
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
    return {
      moveX: mx / len,
      moveZ: mz / len,
      run: a.run || b.run,
      lookYaw: a.lookYaw + b.lookYaw,
      lookPitch: a.lookPitch + b.lookPitch,
      light: a.light || b.light,
      action: a.action || b.action,
      actionPressed: a.actionPressed || b.actionPressed,
      swap: a.swap || b.swap,
      showGoals: a.showGoals || b.showGoals,
      pause: a.pause || b.pause,
    };
  }

  /** Реакция на события шага: сообщения, сохранение, вибрация, конец вылазки. */
  handleEvents(ev: StepEvents): void {
    this.audio.onStep(ev, this.game);
    if (this.touchMode && typeof navigator.vibrate === 'function') {
      if (ev.lightRevived) navigator.vibrate(45);
      else if (ev.strokes > 0 && this.game.light.state === 'dead') navigator.vibrate(10);
    }
    let save = false;
    for (const e of ev.sortie) {
      if (e.type === 'picked') {
        this.hud.toast(e.item.type === 'battery' ? t('toast.battery') : t('toast.find', { name: t(`find.${e.item.find}.name`) }));
        save = true;
      } else if (e.type === 'objective') {
        this.hud.toast(t('toast.goal', { text: this.goalText(e.objective) }));
        this.goalsUntil = this.game.time + 4;
        this.platform.track('goal_done', { type: e.objective.type, tier: e.objective.tier });
        save = true;
      } else if (e.type === 'all-done') {
        this.hud.toast(t('toast.alldone'), 5000);
        this.goalsUntil = this.game.time + 6;
      } else if (e.type === 'swap-start') this.hud.toast(t('toast.swap'), 1800);
      else if (e.type === 'gas-enter') this.hud.toast(t('toast.gas'), 3000);
      else if (e.type === 'collapse') save = true;
      else if (e.type === 'ended') {
        this.screen = 'ending';
        // Даём кадру погаснуть, потом — отчёт.
        this.endingAt = this.game.time + 1.6;
      }
    }
    for (const e of ev.fear) {
      if (e.type === 'swarm' && e.what === 'cohered') this.teach('swarm', t('teach.swarm'), 6000);
      else if (e.type === 'swarm' && e.what === 'release') save = true;
      if (this.touchMode && typeof navigator.vibrate === 'function' && (e.type === 'scare' || e.what === 'cohered')) navigator.vibrate(e.type === 'scare' ? 25 : [40, 60, 40]);
    }
    const tier = this.game.sortie?.maxTier ?? 0;
    if (tier !== this.lastSavedTier) {
      this.lastSavedTier = tier;
      save = true;
    }
    if (save) this.saveRun();
  }

  /** Записать профиль и текущую вылазку. Вызовы идут по очереди и только по событиям. */
  private saveRun(): void {
    const s = this.game.sortie;
    if (!s) {
      this.saveProfile();
      return;
    }
    const run: RunSave | null =
      this.screen === 'play' && !s.outcome
        ? { v: 1, genVersion: GEN_VERSION, seed: this.seed, rank: this.rank, taken: [...s.taken], done: [...s.done], finds: [...s.finds], spares: s.spares, charge: this.game.light.charge, time: this.game.time, maxTier: s.maxTier, collapsed: s.collapsed(), anomaly: this.game.anomalies?.state() ?? { loops: 0, alt: [] }, released: this.game.director?.wasReleased ?? false }
        : null;
    const profile = { ...this.profile, archive: [...this.profile.archive] };
    this.saving = this.saving.then(() => writeSave(this.platform, profile, run));
  }

  /** Записать только профиль (настройка звука): сохранённую вылазку не трогаем. */
  private saveProfile(): void {
    const profile = { ...this.profile, archive: [...this.profile.archive] };
    this.saving = this.saving.then(() => writeProfile(this.platform, profile));
  }

  /** Конец вылазки: счёт, архив, отчёт. */
  private finish(outcome: Outcome): void {
    const s = this.game.sortie!;
    this.screen = 'report';
    const escaped = outcome === 'escaped';
    const fresh: string[] = [];
    if (escaped) {
      this.profile.successes += 1;
      for (const f of s.finds) {
        if (!this.profile.archive.includes(f)) {
          this.profile.archive.push(f);
          fresh.push(f);
        }
      }
    }
    this.saveRun();
    this.platform.track(escaped ? 'level_completed' : 'level_failed', { world: 'bunker', level: `seed_${this.seed}` });

    const doneCount = s.objectives.filter((o) => s.done.has(o.id)).length;
    const minutes = Math.floor(s.time / 60);
    const seconds = Math.floor(s.time % 60);
    const lines: CardLine[] = [];
    for (const o of s.objectives) lines.push({ text: this.goalText(o), kind: s.done.has(o.id) ? 'done' : 'todo' });
    lines.push({ text: t('report.stats', { done: doneCount, total: s.objectives.length, time: `${minutes}:${String(seconds).padStart(2, '0')}`, tier: ROMAN[s.maxTier] ?? 'I' }), kind: 'dim' });
    if (s.finds.length > 0) {
      lines.push({ text: escaped ? t('report.finds') : t('report.lost'), kind: 'head' });
      for (const f of s.finds) lines.push({ text: `${t(`find.${f}.name`)}${fresh.includes(f) ? ` — ${t('report.new')}` : ''}`, kind: escaped ? 'plain' : 'dim' });
      if (escaped) for (const f of fresh.slice(0, 2)) lines.push({ text: t(`find.${f}.desc`), kind: 'dim' });
    }
    const sfx = this.touchMode ? '.touch' : '';
    this.overlay.setCard({ title: escaped ? t('report.escaped') : t('report.lostsignal'), sub: t(`report.cause.${outcome}`), lines, prompt: t(`report.next${sfx}`) });
    this.lifecycle.set('user', true);
    this.desktop?.release();
    this.desktop?.uncapture();
    this.touch?.release();
    this.touch?.setVisible(false);
    this.hud.setVisible(false);
    this.overlay.show('report');
    this.audio.setScene('menu');
    this.audio.ui('ui_report');
    this.syncAudio();
  }

  /** После отчёта: реклама между вылазками и следующий объект. */
  async nextSortie(): Promise<void> {
    if (this.screen !== 'report') return;
    this.audio.ui('ui_click');
    this.screen = 'boot';
    this.overlay.show('loading');
    this.lifecycle.set('ad', true);
    await this.platform.showInterstitial('between_sorties');
    this.lifecycle.set('ad', false);
    const rankParam = Math.round(Number(this.params.get('rank') ?? ''));
    this.prepare(sortieSeed(this.profile), rankParam >= 1 && rankParam <= 3 ? (rankParam as 1 | 2 | 3) : rankFor(this.profile));
    this.redraw();
    this.overlay.show('start');
  }

  private actionText(target: Target): string {
    const sfx = this.touchMode ? '.touch' : '';
    if (target.kind === 'item') return target.item.type === 'battery' ? t(`act.battery${sfx}`) : t(`act.take${sfx}`, { name: t(`find.${target.item.find}.name`) });
    if (target.kind === 'shoot') return t(`act.shoot${sfx}`, { name: t(`mark.${target.objective.landmark!.id}`) });
    return t(`act.exit${sfx}`);
  }

  /** Подсказка обучения: показывается один раз за сессию. */
  private teach(id: string, text: string, ms = 5000): void {
    if (this.taught.has(id)) return;
    this.taught.add(id);
    this.hud.toast(text, ms);
  }

  updateHud(): void {
    const g = this.game;
    const s = g.sortie;
    const light = g.light;
    this.hud.setTime(g.time);
    const dead = light.state === 'dead' && !light.empty;
    const kind = this.touchMode ? (this.motion?.state === 'active' ? 'motion' : 'touch') : 'desktop';
    const swapping = (s?.swapping ?? 0) > 0;
    this.hud.setShakePrompt(dead && !swapping ? t(`hint.shake.${kind}`) : swapping ? t('hint.swap') : light.empty && light.state === 'dead' ? t('hint.empty') : '', swapping ? 1 - s!.swapping / s!.cfg.swapTime : light.reviveProgress);
    const base = this.touchMode ? 'touch' : 'desktop';
    let hint = '';
    if (!dead && this.screen === 'play') {
      if (g.time < 7) hint = t(`hint.move.${base}`);
      else if (g.time < 12) hint = t(`hint.light.${base}`);
      else if (g.time < 16 && !this.touchMode) hint = t('hint.pause.desktop');
    }
    this.hud.setHint(hint);
    this.touch?.setShakePrompt(dead, light.reviveProgress);
    this.touch?.setLit(light.state === 'on');

    if (s) {
      const show = this.goalsHeld || g.time < this.goalsUntil;
      this.hud.setGoals(
        t('brief.goals'),
        s.objectives.map((o) => ({ text: this.goalText(o), done: s.done.has(o.id) })),
        show,
      );
      this.hud.setBattery(light.charge, s.spares);
      const target = s.outcome ? null : s.target;
      this.hud.setAction(target ? this.actionText(target) : '', s.hold);
      this.touch?.setAction(target !== null, s.hold);
      if (target && target.kind !== 'exit') {
        const p = target.kind === 'item' ? ([target.item.x, target.item.y + 0.05, target.item.z] as const) : ([target.objective.landmark!.x, target.objective.landmark!.y, target.objective.landmark!.z] as const);
        const m = g.renderer.project(p);
        this.hud.setMarker(m.x, m.y, m.visible, s.hold > 0);
      } else this.hud.setMarker(0, 0, false);
      // Обучение через игру: подсказка появляется, когда она впервые к месту.
      if (target?.kind === 'shoot') this.teach('shoot', t(`teach.shoot.${base}`));
      else if (target?.kind === 'item') this.teach('take', t(`teach.take.${base}`));
      if (light.charge < 0.25 && s.spares > 0 && !this.touchMode) this.teach('swap', t('teach.swap'));
      if (s.inWater) this.teach('water', t('teach.water'));
    } else {
      this.hud.setGoals('', [], false);
      this.hud.setBattery(light.charge, 0, true);
      this.hud.setAction('', 0);
      this.hud.setMarker(0, 0, false);
      this.touch?.setAction(false, 0);
    }
    if (this.showFps) {
      const i = g.renderer.info();
      this.hud.setFps(`${this.fps.toFixed(0)} fps · ${i.width}×${i.height} · ${i.calls} dc · ${(i.triangles / 1000).toFixed(1)}k`);
    }
  }

  /** Один оборот игры: шаги симуляции, кадр, надписи. Отладочный API вызывает то же самое вручную. */
  advance(input: InputFrame, steps: number, alpha: number, dt: number, present = true): void {
    this.goalsHeld = input.showGoals;
    for (let i = 0; i < steps; i++) {
      this.handleEvents(this.game.step(STEP, input));
      input.light = false;
      input.actionPressed = false;
      input.swap = false;
    }
    this.game.draw(alpha, dt, present);
    this.updateHud();
    const s = this.game.sortie;
    if (this.screen === 'ending' && s?.outcome && this.game.time >= this.endingAt) this.finish(s.outcome);
  }

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    // Звук считается и на паузе: в меню игра стоит, а музыка идёт.
    if (this.game) this.audio.frame(this.game, dt, !this.lifecycle.paused);
    if (this.frozen || this.lifecycle.paused) return;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;

    const input = this.pollInput();
    if (input.pause && this.screen === 'play') {
      this.lifecycle.set('user', true);
      return;
    }
    this.game.look(input.lookYaw, input.lookPitch);
    this.acc += dt;
    let steps = Math.floor(this.acc / STEP);
    if (steps > 5) {
      steps = 5;
      this.acc = 0;
    } else this.acc -= steps * STEP;
    this.advance(input, steps, this.acc / STEP, dt);
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
