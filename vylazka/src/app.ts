/**
 * Приложение: заставка → сессии одна за другой через лимбо; пауза, ввод с устройств, профиль
 * и главный цикл. Игровая логика — в game.ts и systems/.
 */
import { allSoundFiles, AudioEngine } from './audio/engine';
import { GameAudio, LOAD_FIRST } from './audio/game_audio';
import { i18n, normalizeLang, t } from './core/i18n';
import { mulberry32 } from './core/rng';
import { loadSave, memoryFor, rankFor, writeProfile } from './core/save';
import type { PlaceMemory } from './core/save';
import { erased, WEAR } from './systems/decay';
import type { Level3, Profile } from './core/save';
import { LANGS } from './core/types';
import type { Lang } from './core/types';
import { Game, STEP } from './game';
import type { StepEvents } from './game';
import { generateLayout, WORLD_KINDS } from './gen/layout';
import type { WorldKind } from './gen/layout';
import { Lifecycle } from './lifecycle';
import { detectCoarsePointer } from './platform';
import type { IPlatform } from './platform';
import { emptyInput } from './player/input';
import type { InputFrame } from './player/input';
import { DesktopInput } from './player/input_desktop';
import { MotionSensor } from './player/motion';
import { GameRenderer } from './render/renderer';
import { loadSheets } from './render/poster_images';
import { drawScreens, loadScreens } from './render/screen_images';
import { drawSigns } from './render/signs_atlas';
import type { Sheets } from './render/signs_atlas';
import type { Quality } from './render/renderer';
import { ALL_MEMORIES } from './systems/session';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';
import type { Card, CardLine } from './ui/overlay';
import { TouchControls } from './ui/touch_controls';
import { ColliderSet } from './world/colliders';
import type { BuiltLevel } from './world/level';
import { buildLevel } from './world/level_build';
import { buildPocket } from './world/pockets';
import type { PocketKind } from './world/pockets';
import { ALL_PROPS } from './world/props_all';
import { buildShowcase } from './world/showcase';
import { buildTestLevel } from './world/test_level';
import { setThingRegistry } from './world/thing_mesh';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const isQuality = (v: string | null): v is Quality => v === 'low' || v === 'med' || v === 'high';
/** Множители обзора и яркости для уровней «ниже / средне / выше». */
const SENS = [0.6, 1, 1.6] as const;
const BRIGHT = [0.78, 1, 1.35] as const;

type Screen = 'boot' | 'title' | 'play';

/** «Испачкан» ли canvas чужой картинкой: с такого нельзя читать точки и нельзя снять текстуру. */
function tainted(canvas: HTMLCanvasElement): boolean {
  try {
    canvas.getContext('2d')?.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

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
  /** Место вылазки: убежище, офис или жёлтые комнаты. */
  world: WorldKind = 'shelter';

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
  private saving: Promise<void> = Promise.resolve();
  /** Какое воспоминание сейчас ищут и с какого момента (для подсказки «погаси свет»). */
  private seeking = '';
  private seekingSince = 0;
  /** Следующая сессия, собранная за время лимбо. */
  private next: { level: BuiltLevel; seed: number; rank: 1 | 2 | 3 } | null = null;
  /** Воспоминание, которое сейчас проходится по кругу (в этом месте). */
  private memory: PlaceMemory | null = null;
  /** Место закреплено адресом (?seed=): петля идёт по нему, в профиль ничего не пишется. */
  private pinned: PlaceMemory | null = null;
  /** Прошлый круг стёр место до конца: следующая сессия — уже в другом. */
  private wasErased = false;
  private lapTimer: ReturnType<typeof setTimeout> | undefined;
  /** Подсказки обучения, уже показанные в этой сессии. */
  private readonly taught = new Set<string>();
  /** Какие листы-картинки (плакаты, план убежища) уже загружены и стоят в атласе надписей. */
  sheetIds: string[] = [];
  /** Атлас надписей, как он сейчас нарисован (для проверок: что в клетке листа действительно картинка). */
  signsCanvas: HTMLCanvasElement | null = null;
  /** Какие картинки выставочных экранов загрузились (остальные экраны показывают «нет сигнала»). */
  screenIds: string[] = [];
  /** Подсказка из кукольного домика: в каком помещении лежит искомая вещь (до тех пор, пока её не вспомнили или не «забыли»). */
  private mapHint: { memory: string; room: string } | null = null;

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
    // Язык по умолчанию — английский (решение владельца); выбор игрока хранится в профиле.
    this.setLang(normalizeLang(p.get('lang') ?? 'en'), true);
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
      onNext: () => undefined,
      onFlash: () => this.setCalm(!this.profile.calm),
      onPlace: () => this.setPlace(WORLD_KINDS[(WORLD_KINDS.indexOf(this.world) + 1) % WORLD_KINDS.length]!),
      onLang: () => this.cycleLang(),
      onQuality: (q) => {
        this.qualityManual = true;
        this.setQuality(q);
        this.audio.ui('ui_click');
      },
      onMotion: () => void this.enableMotion(),
      onSound: () => this.setMuted(!this.profile.muted),
      onSens: () => this.setLevels(((this.profile.sens + 1) % 3) as Level3, this.profile.bright),
      onBright: () => this.setLevels(this.profile.sens, ((this.profile.bright + 1) % 3) as Level3),
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
    await Promise.race([document.fonts?.load?.('16px "JetBrains Mono"', 'Убежище Ag').catch(() => undefined) ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);

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
    // Надписи рисуются шрифтом игры, плакаты — картинки из файлов: и то и другое может прийти позже
    // первого кадра, тогда атлас перерисовывается.
    let sheets: Sheets = {};
    const redraw = (): void => {
      let canvas = drawSigns(sheets);
      // Страховка: если какой-то лист всё же «испачкал» canvas (сервер не разрешил читать картинку),
      // с такого canvas текстуру не снять — тогда атлас рисуется без листов, а надписи остаются целы.
      if (Object.keys(sheets).length > 0 && tainted(canvas)) {
        console.warn('[vylazka] плакаты не удалось взять в атлас: сервер не разрешает читать картинки');
        sheets = {};
        this.sheetIds = [];
        canvas = drawSigns();
      }
      this.signsCanvas = canvas;
      renderer.setSigns(canvas);
    };
    redraw();
    void document.fonts?.ready?.then(redraw);
    void loadSheets().then((loaded) => {
      sheets = loaded;
      this.sheetIds = Object.keys(loaded).sort();
      redraw();
    });
    // Картинки выставочных экранов — свой атлас. Пока файлы не пришли, на экранах «нет сигнала».
    let screens: Record<string, HTMLImageElement> = {};
    const redrawScreens = (): void => {
      let canvas = drawScreens(screens);
      if (Object.keys(screens).length > 0 && tainted(canvas)) {
        console.warn('[vylazka] картинки экранов не удалось взять в атлас: сервер не разрешает читать картинки');
        screens = {};
        this.screenIds = [];
        canvas = drawScreens();
      }
      renderer.setScreens(canvas);
    };
    redrawScreens();
    void loadScreens().then((loaded) => {
      screens = loaded;
      this.screenIds = Object.keys(loaded).sort();
      redrawScreens();
    });
    renderer.onContextLost = () => this.lifecycle.set('context', true);
    renderer.onContextRestored = () => {
      this.lifecycle.set('context', false);
      this.redraw();
    };
    this.overlay.setQuality(quality);

    // Сохранение читается одним пакетным вызовом до первого кадра.
    const baseSeed = Number(p.get('seed') ?? '') || 20041113;
    const save = await loadSave(this.platform, baseSeed);
    this.profile = save.profile;
    this.sound.setMuted(this.profile.muted);
    this.overlay.setSound(!this.profile.muted);
    this.overlay.setLevels(this.profile.sens, this.profile.bright);
    this.overlay.setFlash(this.profile.calm);
    // Место вылазки: из адреса (?world=office) или то, что игрок выбрал на заставке в прошлый раз.
    const asked = p.get('world');
    this.world = (WORLD_KINDS as readonly string[]).includes(asked ?? '') ? (asked as WorldKind) : this.profile.place;
    this.overlay.setPlace(this.world);
    if (p.get('lang') === null && this.profile.lang) this.setLang(normalizeLang(this.profile.lang), true);
    renderer.brightness = BRIGHT[this.profile.bright];
    setThingRegistry(ALL_PROPS);
    // level=test — коридор технического среза, level=show — витрина реквизита.
    this.testLevel = p.get('level') === 'test' || p.get('level') === 'show' || (p.get('level') ?? '').startsWith('pocket_');
    const failAt = Number(p.get('fail') ?? '');
    this.game = new Game(renderer, mulberry32(baseSeed), {
      // Первый отказ фонаря — принудительный и скорый: игрок должен сразу узнать, что фонарь надо трясти.
      firstFailAt: Number.isFinite(failAt) && p.get('fail') !== null ? failAt : this.testLevel ? 12 : 40,
      ...(this.testLevel ? { meanFailInterval: 30, graceAfterRevive: 10 } : {}),
    });
    this.game.calmFlash = this.profile.calm;
    // Режиссёр давления (провал, сжатие) сам событий не начинает там, где нужен ровный ход: адрес
    // с fail=0 — проверки. press=1 включает его и там, press=0 выключает везде.
    this.game.pressureAuto = (p.get('press') ?? (p.get('fail') === '0' ? '0' : '1')) !== '0';
    this.game.archive = [...this.profile.archive];
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

    // Первая сессия: воспоминание места (то, что уже проходится по кругу, или новое). Сид из адреса
    // (?seed=) закрепляет место на всё время страницы и в профиль не пишется.
    this.pinned = p.get('seed') !== null ? { seed: baseSeed >>> 0, rank: this.rankParam() ?? rankFor(this.profile), wear: 0, laps: 0 } : null;
    this.prepare();

    const resize = (): void => {
      renderer.resize(this.root.clientWidth, this.root.clientHeight);
      this.redraw();
    };
    new ResizeObserver(resize).observe(this.root);
    resize();
    // Круг сменили в адресе (#lap5), пока открыта заставка: место пересобирается на этом круге.
    window.addEventListener('hashchange', () => {
      if (this.screen !== 'title' || this.testLevel) return;
      this.prepare();
      this.redraw();
    });

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

  private rankParam(): 1 | 2 | 3 | null {
    const r = Math.round(Number(this.params.get('rank') ?? ''));
    return r >= 1 && r <= 3 ? (r as 1 | 2 | 3) : null;
  }

  /**
   * Круг из адреса после решётки (#lap5): посмотреть место на любом круге петли там, где у адреса нет
   * параметров, — на странице, встроенной по ссылке. Круги считаются с первого.
   */
  private lapParam(): number | null {
    const m = /^#lap-?([1-9])$/.exec(typeof location === 'undefined' ? '' : location.hash);
    return m ? Number(m[1]) : null;
  }

  /** Стёртость из адреса (?wear=0.6 или #lap5): посмотреть место на любом круге петли. */
  private wearParam(): number | null {
    const raw = this.params.get('wear');
    const w = Number(raw ?? '');
    if (raw !== null && Number.isFinite(w)) return Math.max(0, Math.min(1, w));
    const lap = this.lapParam();
    return lap === null ? null : Math.min(1, (lap - 1) * WEAR.lap);
  }

  /** Воспоминание, которое сейчас проходится: закреплённое адресом или записанное за местом в профиле. */
  private place(): PlaceMemory {
    const m = this.pinned ?? memoryFor(this.profile, this.world);
    const rank = this.rankParam();
    return rank && !this.pinned ? { ...m, rank } : m;
  }

  /** Собрать первую сессию и показать заставку. */
  private prepare(): void {
    const mem = this.place();
    this.memory = mem;
    this.seed = mem.seed >>> 0;
    this.rank = mem.rank;
    const wear = this.wearParam() ?? mem.wear;
    if (this.testLevel) {
      const name = this.params.get('level') ?? '';
      if (name.startsWith('pocket_')) {
        // Просмотр карманного пространства: ?level=pocket_void | pocket_meadow | pocket_dollhouse.
        const pocket = buildPocket(name.slice(7) as PocketKind, this.seed, [0, 0, 0]);
        const colliders = new ColliderSet();
        for (const b of pocket.colliders) colliders.add(b);
        this.level = { chunks: pocket.meshes.map((mesh) => ({ mesh, tierMin: 0, tierMax: 0 })), stairs: [], colliders, spawn: pocket.spawn, exit: pocket.spawn.pos, spots: [], landmarks: [], zones: [], collapses: [], variants: [], nav: [], sheets: [], layout: null };
        this.game.loadLevel(this.level, null);
        this.game.env = pocket.env;
        this.game.renderer.cullDistance = 400;
      } else {
        this.level = name === 'show' ? buildShowcase(this.params.get('props')?.split(',') ?? null, this.params.get('flat') === '1') : buildTestLevel();
        this.game.loadLevel(this.level, null);
      }
    } else {
      this.level = buildLevel(generateLayout(this.seed, this.rank, this.world), { wear });
      this.game.loadLevel(this.level, { seed: this.seed, known: new Set(this.profile.archive) });
    }
    this.screen = 'title';
    this.audio.setScene('menu');
    this.syncAudio();
    this.overlay.setCard(this.titleCard());
    this.updateHud();
  }

  /** Заставка: название, чем это объясняется, предупреждение о вспышках. */
  private titleCard(): Card {
    const lines: CardLine[] = [
      { text: t('title.how'), kind: 'plain' },
      { text: t('title.warn'), kind: 'dim' },
    ];
    if (this.profile.successes > 0) lines.push({ text: t('title.count', { n: this.profile.successes, k: this.profile.archive.length, total: ALL_MEMORIES.length }), kind: 'dim' });
    return { title: t('ui.title'), sub: t('ui.subtitle'), lines, prompt: t(`ui.start${this.touchMode ? '.touch' : ''}`) };
  }

  /** Номер сессии, как имя несохранённого файла. */
  private sessionNumber(): string {
    return String(Math.max(1, this.profile.sorties)).padStart(4, '0');
  }

  /** Начать (нажатие на заставке). */
  start(): void {
    if (!this.game || this.screen !== 'title') return;
    this.screen = 'play';
    this.sound.unlock();
    this.audio.setScene('play');
    this.audio.sortieStart(false, this.game.world);
    if (!this.testLevel) {
      this.profile.sorties += 1;
      // С этой минуты воспоминание проходится по кругу: место записано за ним.
      this.keepMemory();
      this.saveProfile();
      this.hud.toast(t('session.begin', { n: this.sessionNumber() }), 4200);
      this.sayLap();
    }
    this.platform.track('level_started', { world: 'session', level: this.testLevel ? 'test' : `seed_${this.seed}` });
    if (this.touchMode && !MotionSensor.needsPermission()) void this.enableMotion();
    this.resumePlay();
  }

  /**
   * Записать в воспоминание места то, что стёрто за этот круг (касания, встречи с Осыпью). lap — круг
   * пройден: стёртость растёт ещё и на него. Стёрлось совсем — места больше нет: следующая сессия
   * откроет другое. Возвращает true, если воспоминание стёрто.
   */
  private keepMemory(lap = false): boolean {
    const m = this.memory;
    if (!m || this.testLevel) return false;
    // Стёртость из адреса — только посмотреть: в воспоминание она не идёт.
    const gained = this.game.wearGain + (lap ? WEAR.lap : 0);
    m.wear = Math.min(1, m.wear + gained);
    this.game.wearBase += this.game.wearGain;
    this.game.wearGain = 0;
    if (lap) m.laps += 1;
    const gone = erased(m.wear);
    if (this.pinned) {
      if (gone) this.pinned = { ...this.pinned, wear: 0, laps: 0 };
    } else if (gone) delete this.profile.memories[this.world];
    else this.profile.memories[this.world] = { ...m };
    return gone;
  }

  /** Сессия кончилась, игрок в лимбо: записать итог и собрать следующую — то же место, круг спустя. */
  private onLimbo(): void {
    this.profile.successes += 1;
    this.wasErased = this.keepMemory(true);
    this.saveProfile();
    this.platform.track('level_completed', { world: 'session', level: `seed_${this.seed}` });
    // Сборку откладываем на полсекунды: лимбо уже на экране, и заминка не выглядит зависшим переходом.
    setTimeout(() => {
      const mem = this.place();
      this.memory = mem;
      const level = buildLevel(generateLayout(mem.seed, mem.rank, this.world), { wear: this.wearParam() ?? mem.wear });
      this.next = { level, seed: mem.seed, rank: mem.rank };
      this.game.queueSession(level, { seed: mem.seed, known: new Set(this.profile.archive) });
    }, 500);
  }

  /** Лимбо отпустило: началась следующая сессия. */
  private onBegin(): void {
    const n = this.next;
    if (n) {
      this.level = n.level;
      this.seed = n.seed;
      this.rank = n.rank;
      this.next = null;
    }
    this.profile.sorties += 1;
    this.mapHint = null;
    this.keepMemory();
    this.saveProfile();
    this.platform.track('level_started', { world: 'session', level: `seed_${this.seed}` });
    this.hud.toast(t('session.begin', { n: this.sessionNumber() }), 4200);
    // Прежнее место стёрлось до конца: это уже другое.
    if (this.wasErased) this.hud.flash(t('session.erased'), 6200);
    else this.sayLap();
    this.wasErased = false;
  }

  /**
   * Строка петли: в начале каждого круга, кроме первого, игра говорит одну фразу — по ней игрок
   * понимает, что место то же и что его становится меньше (docs/vylazka/story.md, §5).
   */
  private sayLap(): void {
    const lap = this.lapParam() ?? (this.memory?.laps ?? 0) + 1;
    // Зал ожидания на первом круге говорит свой закон — одной строкой, как всё здесь.
    const line = lap < 2 ? (this.world === 'station' ? 'station.law' : null) : `loop.lap.${Math.min(8, lap)}`;
    if (!line) return;
    // После названия сессии, а не поверх него: вспышка гасит прочие надписи.
    if (this.lapTimer !== undefined) clearTimeout(this.lapTimer);
    this.lapTimer = setTimeout(() => {
      this.lapTimer = undefined;
      if (this.screen === 'play') this.hud.flash(t(line), 6200);
    }, 4400);
  }

  /** Сменить место вылазки. На заставке уровень пересобирается сразу; выбор запоминается. */
  setPlace(world: WorldKind): void {
    this.world = world;
    this.profile.place = world;
    this.overlay.setPlace(world);
    this.audio.ui('ui_click');
    this.saveProfile();
    if (this.screen === 'title' && !this.testLevel) {
      this.prepare();
      this.redraw();
    }
  }

  /** Вспышки: полные или мягкие. */
  setCalm(calm: boolean): void {
    this.profile.calm = calm;
    this.game.calmFlash = calm;
    this.overlay.setFlash(calm);
    this.audio.ui('ui_click');
    this.saveProfile();
  }

  /** Следующий язык по кругу; выбор запоминается. */
  private cycleLang(): void {
    const lang = LANGS[(LANGS.indexOf(i18n.lang) + 1) % LANGS.length]!;
    this.profile.lang = lang;
    this.setLang(lang);
    this.audio.ui('ui_click');
    this.saveProfile();
  }

  /** Мышь на ПК не захватывается (песочница iframe): луч ведётся с зажатой кнопкой. */
  get dragMode(): boolean {
    return !this.touchMode && (this.desktop?.dragMode ?? false);
  }

  private resumePlay(): void {
    if (this.screen !== 'play') return;
    this.lifecycle.set('pointer', false);
    this.lifecycle.set('user', false);
    if (!this.touchMode) this.desktop?.capture();
  }

  private onPauseChange(paused: boolean): void {
    if (this.screen !== 'play') return;
    if (paused) {
      // Возврат в игру — всегда по нажатию: браузер не даст захватить мышь без жеста.
      this.lifecycle.set('user', true);
      this.desktop?.release();
      this.desktop?.uncapture();
      this.touch?.release();
      this.touch?.setVisible(false);
      this.game.shake.reset();
      this.overlay.show('paused');
      this.saveProfile();
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
   * сессию, но не заставку: там игра «стоит», а музыка играет.
   */
  private syncAudio(): void {
    const lc = this.lifecycle;
    const hard = lc.has('platform') || lc.has('hidden') || lc.has('ad') || lc.has('context');
    const menu = this.screen === 'title';
    this.sound.setPaused(hard || (lc.paused && !menu));
  }

  /** Чувствительность обзора и яркость картинки: кнопки в меню, выбор запоминается. */
  setLevels(sens: Level3, bright: Level3): void {
    this.profile.sens = sens;
    this.profile.bright = bright;
    this.overlay.setLevels(sens, bright);
    this.game.renderer.brightness = BRIGHT[bright];
    this.audio.ui('ui_click');
    this.saveProfile();
    this.redraw();
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
    if (this.screen === 'title') this.overlay.setCard(this.titleCard());
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
    if (this.screen === 'title') this.overlay.setCard(this.titleCard());
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
      pause: a.pause || b.pause,
    };
  }

  /** Реакция на события шага: вспышки воспоминаний, вибрация, профиль, смена сессий. */
  handleEvents(ev: StepEvents): void {
    this.audio.onStep(ev, this.game);
    const buzz = this.touchMode && typeof navigator.vibrate === 'function';
    if (buzz) {
      if (ev.lightRevived) navigator.vibrate(45);
      else if (ev.strokes > 0 && this.game.light.state === 'dead') navigator.vibrate(10);
    }
    for (const e of ev.session) {
      if (e.type === 'reveal') {
        this.hud.flash(t(`mem.${e.memory.def.id}.flash`));
        if (buzz) navigator.vibrate([30, 40, 30]);
      } else if (e.type === 'recall') {
        const id = e.memory.def.id;
        this.hud.flash(t(`mem.${id}.done`));
        if (!this.profile.archive.includes(id)) this.profile.archive.push(id);
        this.platform.track('goal_done', { type: 'memory', tier: e.memory.spot?.tier ?? 0 });
        this.saveProfile();
        if (buzz) navigator.vibrate(60);
        if (this.mapHint?.memory === id) this.mapHint = null;
      } else if (e.type === 'forgot') {
        // Вещь унесло в другое место: то, что показал макет, больше не верно.
        this.mapHint = null;
        this.hud.toast(t('toast.forgot'), 2600);
      }
      else if (e.type === 'gas-enter') this.hud.toast(t('toast.gas'), 3000);
    }
    for (const e of ev.fear) {
      if (e.type === 'swarm' && e.what === 'cohered') this.teach('swarm', t('teach.swarm'), 6000);
      if (buzz && (e.type === 'scare' || e.what === 'cohered')) navigator.vibrate(e.type === 'scare' ? 25 : [40, 60, 40]);
    }
    for (const e of ev.dream) {
      if (e.type === 'limbo') this.onLimbo();
      else if (e.type === 'begin') this.onBegin();
      else if (e.type === 'thing' && e.what === 'changing' && e.thing.fate !== 'dust') this.teach('thing', t('teach.thing'));
      else if (e.type === 'jump' && e.phase === 'switch') {
        // Осыпь вернула в начало: об этом говорит строка, иначе непонятно, почему место другое.
        if (e.plan.cause === 'caught') this.hud.toast(t('toast.caught'), 3400);
        if (buzz) navigator.vibrate(35);
      }
      else if (e.type === 'pocket') this.onPocket(e);
      // Первое касание: вещь рассыпалась — сказать, что это правило, и как её вернуть.
      else if (e.type === 'touch' && e.what === 'gone') this.teach('touch', t(this.game.flow ? 'teach.touch.station' : this.game.hasLight ? 'teach.touch' : 'teach.touch.still'), 7000);
    }
  }

  /** Карманное пространство говорит, зачем оно: строка при входе и строка, когда оно сделало своё дело. */
  private onPocket(e: Extract<StepEvents['dream'][number], { type: 'pocket' }>): void {
    const task = e.memory ? t(`mem.${e.memory}.task`) : '';
    if (e.what === 'enter') {
      // В кукольном домике и в белом нигде строка зависит от того, ищет ли игрок что-нибудь прямо сейчас.
      const idle = !e.memory && e.kind === 'dollhouse' ? '.idle' : '';
      this.hud.flash(t(`pocket.${e.kind}.enter${idle}`), 6200);
    } else if (e.what === 'map') {
      if (e.memory && e.room !== undefined) {
        this.mapHint = { memory: e.memory, room: e.room };
        this.hud.flash(t('pocket.dollhouse.map', { what: task, room: t(`room.${e.room}`), tier: t(`tier.${Math.min(2, e.tier ?? 0)}`) }), 6200);
      } else this.hud.flash(t('pocket.dollhouse.map.idle'));
    } else if (e.what === 'next') this.hud.flash(t('pocket.void.next'));
    else if (e.what === 'remind' && e.memory) this.hud.flash(t(`mem.${e.memory}.flash`));
    else if (e.what === 'replay' && e.memory) this.hud.flash(t(`mem.${e.memory}.done`));
    if (e.what !== 'enter' && this.touchMode && typeof navigator.vibrate === 'function') navigator.vibrate(30);
  }

  /** Записать профиль. Вызовы идут по очереди и только по событиям. */
  private saveProfile(): void {
    // Что стёрто за круг — в воспоминание места: закрыл вкладку посреди сессии — касания не пропали.
    if (this.screen === 'play' && this.game && this.game.wearGain > 0) this.keepMemory();
    const profile = { ...this.profile, archive: [...this.profile.archive], memories: { ...this.profile.memories } };
    this.saving = this.saving.then(() => writeProfile(this.platform, profile));
  }

  /** Подсказка обучения: показывается один раз за сессию. */
  private teach(id: string, text: string, ms = 5000): void {
    if (this.taught.has(id)) return;
    this.taught.add(id);
    this.hud.toast(text, ms);
  }

  updateHud(): void {
    const g = this.game;
    const s = g.session;
    const light = g.light;
    this.hud.setTime(g.time);
    const dead = light.state === 'dead';
    const kind = this.touchMode ? (this.motion?.state === 'active' ? 'motion' : 'touch') : 'desktop';
    // В светлом пространстве (луг, белое нигде, лимбо) фонарь не нужен: о том, что он заглох, молчим.
    // Светло — значит много рассеянного света или есть прямой (лампа кукольного домика светит на пастельные стены).
    const env = g.env.ambient;
    const key = g.env.key?.color ?? [0, 0, 0];
    const bright = (env[0] + env[1] + env[2]) / 3 + (key[0] + key[1] + key[2]) / 6 > 0.3;
    this.hud.setShakePrompt(dead && !bright ? t(`hint.shake.${kind}`) : '', light.reviveProgress);
    const base = this.touchMode ? 'touch' : 'desktop';
    let hint = '';
    if (!dead && this.screen === 'play' && g.where === 'main' && this.profile.successes === 0) {
      // Где фонаря нет (офис, зал ожидания), мышь ведёт взгляд, а не луч.
      const what = g.hasLight ? 'move' : 'look';
      if (g.time < 7) hint = t(this.dragMode ? `hint.${what}.desktop_drag` : `hint.${what}.${base}`);
      else if (g.time < 12 && g.hasLight) hint = t(`hint.light.${base}`);
      else if (g.time < 16 && !this.touchMode) hint = t('hint.pause.desktop');
    }
    // В карманном пространстве нижняя строка говорит, как выйти, а под конец — что место уходит само.
    // Заглохший фонарь её не прячет: в светлом пространстве о нём молчат, а строка нужна до самого конца.
    const info = g.where === 'pocket' ? g.pocketFade : 1;
    if ((!dead || bright) && this.screen === 'play' && g.where === 'pocket' && !g.jumping) hint = info < 0.75 ? t('pocket.hint.fading') : t('pocket.hint.exit');
    this.hud.setHint(hint);
    this.touch?.setShakePrompt(dead && !bright, light.reviveProgress);
    this.touch?.setLit(light.state === 'on');
    // Где фонаря нет (офис), нет и его кнопки.
    this.touch?.setLightHidden(!g.hasLight);
    this.hud.setBattery(1, 0, true);
    this.hud.setAction('', 0);
    // В светлом пространстве светлые надписи не видны: переключаем их на тёмные.
    this.hud.el.classList.toggle('is-bright', bright);

    if (s && g.where !== 'limbo') {
      // Воспоминания, которые уже пришли: что ищем и что вспомнили.
      const lines = s.memories
        .filter((m) => m.state !== 'hidden')
        .map((m) => ({ text: t(`mem.${m.def.id}.task`) + (m.state === 'active' && this.mapHint?.memory === m.def.id ? ` · ${t(`room.${this.mapHint.room}`)}` : ''), done: m.state === 'done' }));
      this.hud.setGoals('', lines, lines.length > 0);
      // Рамка — на том, во что игрок всматривается: искомая вещь или любая «неустойчивая».
      const act = s.active;
      const focus = g.things.focus;
      const at = focus ? ([focus.pos[0], focus.pos[1] + focus.radius * 0.6, focus.pos[2]] as const) : null;
      if (at) {
        const m = g.renderer.project(at);
        this.hud.setMarker(m.x, m.y, m.visible, s.hold > 0 || (focus?.gaze ?? 0) > 0.5);
      } else this.hud.setMarker(0, 0, false);
      // Обучение через игру: подсказка появляется, когда она впервые к месту.
      const id = act?.def.id ?? '';
      if (id !== this.seeking) {
        this.seeking = id;
        this.seekingSince = g.time;
      }
      if (act && s.hold > 0.05) this.teach('look', t('teach.look'));
      if (act && g.time - this.seekingSince > 25) this.teach('dark', t(g.flow ? 'teach.dark.station' : g.hasLight ? 'teach.dark' : 'teach.dark.still'), 7000);
      if (s.inWater) this.teach('water', t('teach.water'));
    } else {
      this.hud.setGoals('', [], false);
      this.hud.setMarker(0, 0, false);
    }
    // Лимбо: итог сессии и строка «от системы».
    if (g.where === 'limbo') {
      const k = s ? s.doneCount : 0;
      this.hud.setLimbo([t('limbo.done', { n: this.sessionNumber(), k }), t(`limbo.line.${(this.profile.successes + this.profile.archive.length) % 6}`), t('limbo.wait')]);
    } else this.hud.setLimbo([]);
    if (this.showFps) {
      const i = g.renderer.info();
      this.hud.setFps(`${this.fps.toFixed(0)} fps · ${i.width}×${i.height} · ${i.calls} dc · ${(i.triangles / 1000).toFixed(1)}k`);
    }
  }

  /** Один оборот игры: шаги симуляции, кадр, надписи. Отладочный API вызывает то же самое вручную. */
  advance(input: InputFrame, steps: number, alpha: number, dt: number, present = true): void {
    for (let i = 0; i < steps; i++) {
      this.handleEvents(this.game.step(STEP, input));
      input.light = false;
    }
    this.game.draw(alpha, dt, present);
    this.updateHud();
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
    const k = SENS[this.profile.sens];
    this.game.look(input.lookYaw * k, input.lookPitch * k);
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
