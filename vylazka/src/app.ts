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
import { drawPapers, loadPapers } from './render/paper_images';
import { loadSheets } from './render/poster_images';
import { drawScreens, loadScreens } from './render/screen_images';
import { drawSigns } from './render/signs_atlas';
import type { Sheets } from './render/signs_atlas';
import type { Quality } from './render/renderer';
import { ALL_MEMORIES, DEFAULT_SESSION, WORLD_MEMORIES } from './systems/session';
import type { SessionConfig } from './systems/session';
import { wornLine } from './systems/worn_text';
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
import { guardTouch, RESIZE_SETTLE_MS, ScreenAwake } from './platform/mobile_guard';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const isQuality = (v: string | null): v is Quality => v === 'low' || v === 'med' || v === 'high' || v === 'ultra';

/**
 * Замер видеокарты при запуске (App.probeFine). highMs — кадр обычного высокого качества должен
 * рисоваться быстрее этого, иначе мелкое зерно и пробовать незачем: оно вчетверо тяжелее. fineMs — кадр
 * мелкого качества на первом экране должен уложиться в это время: шестьдесят кадров в секунду — это 16,7 мс
 * на кадр, остальное — запас на места тяжелее первого. settleMs — сколько самое большее ждать досева
 * точек перед замером (пока облако редкое, кадр легче настоящего). minMs — быстрее кадр не рисуется ни на чём: такой ответ
 * значит, что замер не удался (видеокарту не дождались), и ему не верим. fpsFloor, slowFor — если в игре кадров стало меньше
 * fpsFloor и так держится slowFor секунд, качество возвращается на обычное высокое.
 * Числа выбраны расчётом и на настоящих видеокартах не проверены. Они нарочно не строгие: ошибку в
 * сторону «включили зря» ловит игра (качество вернётся само), а ошибку «не включили» не ловит никто.
 */
const PROBE = { highMs: 5, fineMs: 11, minMs: 0.3, settleMs: 700, fpsFloor: 45, slowFor: 2.5 } as const;
/** Множители обзора и яркости для уровней «ниже / средне / выше». */
const SENS = [0.6, 1, 1.6] as const;
/** Сон из сцен: сцен в сессии (каждая — другое место). */
const SCENES = 3;
/**
 * Сцена короче сессии: одна вещь вместо пяти. Вспышка — секунд через десять: место успевает показаться.
 * Правило «последнее воспоминание не раньше пятой минуты» (minLength) здесь не годится: вещь сцены — она
 * же последняя, и правило держало бы вспышку до конца срока, а сцена стояла бы пустой.
 */
const SCENE_SESSION: SessionConfig = { ...DEFAULT_SESSION, count: 1, firstDelay: 10, fallback: 18, minLength: 0 };
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
  /** Когда телефон последний раз дрогнул под пальцем, заряжающим фонарь, мс. */
  private crankBuzz = 0;
  /** Экран не гаснет, пока идёт игра (platform/mobile_guard.ts). */
  private readonly awake = new ScreenAwake();
  private last = 0;
  private acc = 0;
  private qualityManual = false;
  private playTime = 0;
  private slowTime = 0;
  private showFps = false;
  /** Пробная сборка для телефона (страница с __vzVariant): 'probe' — строка проверки включена с самого начала. */
  private variant = '';
  /** Проверка на устройстве (#diag): строка с видеокартой и тем, что в кадре на полу, и кнопка «сплошь». */
  private diagText: HTMLElement | null = null;
  private diagAt = 0;
  private testLevel = false;
  private saving: Promise<void> = Promise.resolve();
  /** Какое воспоминание сейчас ищут и с какого момента (для подсказки «погаси свет»). */
  private seeking = '';
  private seekingSince = 0;
  /** Следующая сессия, собранная за время лимбо. */
  private next: { level: BuiltLevel; seed: number; rank: 1 | 2 | 3 } | null = null;
  /**
   * Сон из сцен — прототип (docs/vylazka/pressure.md, §4.6): знак #scenes в конце ссылки, ?scenes=1 или
   * проба __vzVariant = 'scenes'. Сессия — три сцены из разных мест, в каждой одна вещь цепочки этого
   * места; вспомнил — свет гаснет, и вокруг уже другое место; после третьей — лимбо. Без знака игра
   * прежняя: сессия — пять вещей одного места.
   */
  private scenes = false;
  /** Какая по счёту сцена идёт в этой сессии (0 — первая). */
  private sceneIndex = 0;
  /** Следующая сцена, уже собранная: место, уровень и его воспоминание. */
  private sceneNext: { world: WorldKind; level: BuiltLevel; memory: PlaceMemory } | null = null;
  private sceneTimer: ReturnType<typeof setTimeout> | undefined;
  /** Когда место снилось в последний раз (номер сцены сна): сон тянет то, что давно не снилось. */
  private readonly dreamt: Partial<Record<WorldKind, number>> = {};
  private dreamtCount = 0;
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
  /** Какие листы бумаги (world/papers.ts) загрузились: остальные висят чистыми листами. */
  paperIds: string[] = [];
  /** Загруженные слои бумаги и размер, в котором из них собрана стопка (0 — ещё не собрана). */
  private paperImages: Record<string, HTMLImageElement> | null = null;
  private paperScale = 0;
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
    // Язык по умолчанию — английский (решение партнёра); выбор игрока хранится в профиле.
    this.setLang(normalizeLang(p.get('lang') ?? 'en'), true);
    if (p.get('pseudo') === '1') i18n.setPseudo(true);
    // Счётчик кадров: ?fps=1 или #fps — на странице по ссылке параметров адреса нет, проходит только #имя.
    this.showFps = p.get('fps') === '1' || (typeof location !== 'undefined' && location.hash === '#fps');
    // Пробная сборка для телефона (страница с __vzVariant): «probe» ничего не меняет в игре, только включает
    // строку проверки с самого начала — нужен один снимок экрана.
    this.variant = String((globalThis as { __vzVariant?: unknown }).__vzVariant ?? '');
    if (this.variant === 'probe' || p.get('diag') === '1' || (typeof location !== 'undefined' && location.hash === '#diag') || App.diagSaved()) this.makeDiag();
    this.scenes = this.variant === 'scenes' || p.get('scenes') === '1' || (typeof location !== 'undefined' && location.hash === '#scenes');

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
      onRestartPlace: () => this.restartPlace(),
      onLang: () => this.cycleLang(),
      onDiag: () => this.toggleDiag(),
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
    // Листы бумаги — своя стопка слоёв (drawPaperStack). Пока файлы не пришли, на щитах и в рамах чистая бумага.
    void loadPapers().then((loaded) => {
      this.paperIds = Object.keys(loaded).sort();
      this.paperImages = loaded;
      this.drawPaperStack(this.game.renderer.quality);
      this.redraw();
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
    // Пробная сборка: одна часть сборки места отключена, чтобы на телефоне найти, какая ломает пол.
    setThingRegistry(ALL_PROPS);
    // level=test — коридор технического среза, level=show — витрина реквизита.
    this.testLevel = p.get('level') === 'test' || p.get('level') === 'show' || (p.get('level') ?? '').startsWith('pocket_') || this.showParam() !== null;
    const failAt = Number(p.get('fail') ?? '');
    this.game = new Game(renderer, mulberry32(baseSeed), {
      // Первый отказ фонаря — принудительный и скорый: игрок должен сразу узнать, что фонарь надо трясти.
      firstFailAt: Number.isFinite(failAt) && p.get('fail') !== null ? failAt : this.testLevel ? 12 : 40,
      ...(this.testLevel ? { meanFailInterval: 30, graceAfterRevive: 10 } : {}),
      // fail=0 — режим проверок: фонарь глохнет только по команде проверки (__vz.fail). Принудительного отказа
      // нет, случайных тоже, и батарейка не садится. Случайный отказ в долгом сценарии погасил бы луч перед вещью,
      // которую проверка собирается вспомнить, а когда он придёт, решают реальные кадры до заморозки — то есть
      // скорость машины.
      ...(p.get('fail') === '0' ? { drainSeconds: Infinity, meanFailInterval: Infinity } : {}),
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
    // Место закреплено адресом — снится только оно: сна из сцен нет (иначе закреплённая память уехала бы в другое место).
    if (this.pinned) this.scenes = false;
    this.prepare();

    const resize = (): void => {
      renderer.resize(this.root.clientWidth, this.root.clientHeight);
      // Ступень «ультра» в кнопке качества — только на компьютере и только там, где экран даёт зерно мельче.
      this.overlay.setFineStep(!this.touchMode && renderer.fineFor('ultra') >= 1.25);
      this.redraw();
    };
    // На телефоне адресная строка Safari прячется и выезжает плавно — размер меняется десятки раз подряд, а
    // пересоздавать буферы кадра на каждый шаг — известный путь к потере контекста на iOS (исследование
    // mobile_controls.md, §7). Там новый размер берётся, когда он успокоится; на компьютере — сразу.
    let settle = 0;
    new ResizeObserver(() => {
      if (!this.touchMode) return resize();
      window.clearTimeout(settle);
      settle = window.setTimeout(resize, RESIZE_SETTLE_MS);
    }).observe(this.root);
    resize();
    // Круг сменили в адресе (#lap5), пока открыта заставка: место пересобирается на этом круге.
    window.addEventListener('hashchange', () => {
      if (this.screen !== 'title' || this.testLevel) return;
      this.prepare();
      this.redraw();
    });

    this.platform.onPause((paused) => this.lifecycle.set('platform', paused));
    this.platform.onAudio((enabled) => this.sound.setEnabled(enabled));
    document.addEventListener('visibilitychange', () => {
      this.lifecycle.set('hidden', document.hidden);
      if (!document.hidden) this.awake.visible();
    });
    this.lifecycle.onChange((paused) => this.onPauseChange(paused));
    this.lifecycle.onReasons(() => this.syncAudio());

    await renderer.warmup();
    this.redraw();
    this.probeFine();
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
   * Вещь из адреса после решётки (#show-chair-bent): витрина с одной этой вещью под фонарём. Так
   * каталог мебели открывает вещь «в игре» на странице по ссылке, где у адреса нет параметров, а
   * проходит только #имя из букв, цифр и дефисов (подчёркивания имени — дефисами).
   */
  private showParam(): string | null {
    const m = /^#show-([a-z0-9-]+)$/.exec(typeof location === 'undefined' ? '' : location.hash);
    if (!m) return null;
    const want = m[1]!;
    return Object.keys(ALL_PROPS).find((n) => n.replace(/_/g, '-') === want) ?? null;
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
    this.overlay.setRestart(!this.testLevel && (mem.laps > 0 || mem.wear > 0));
    this.seed = mem.seed >>> 0;
    this.rank = mem.rank;
    const wear = this.wearParam() ?? mem.wear;
    if (this.testLevel) {
      const shown = this.showParam();
      const name = shown !== null ? 'show' : (this.params.get('level') ?? '');
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
        this.level = name === 'show' ? buildShowcase(shown !== null ? [shown] : (this.params.get('props')?.split(',') ?? null), this.params.get('flat') === '1') : buildTestLevel();
        this.game.loadLevel(this.level, null);
      }
    } else {
      this.level = buildLevel(generateLayout(this.seed, this.rank, this.world), { wear });
      if (this.scenes) this.game.sessionCfg = SCENE_SESSION;
      // Мягкий режим Осыпи: первая сессия игрока (ни одной законченной) и сон из сцен (слова партнёра 16.11 23:41).
      this.game.gentle = this.profile.successes === 0 || this.scenes;
      this.game.loadLevel(this.level, { seed: this.seed, known: new Set(this.profile.archive), ...(this.scenes ? { chainAt: mem.chain ?? 0 } : {}) });
      if (this.scenes) {
        // Сон начинается с места заставки; места, пролистанные кнопкой «Место», не «снились».
        for (const w of WORLD_KINDS) delete this.dreamt[w];
        this.dreamtCount = 0;
        this.sceneIndex = 0;
        this.markDreamt(this.world);
        this.queueNextScene();
      }
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
    if (this.profile.successes > 0) lines.push({ text: t('title.count', { n: this.profile.successes, k: this.profile.archive.filter((id) => ALL_MEMORIES.some((m) => m.id === id)).length, total: ALL_MEMORIES.length }), kind: 'dim' });
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
  /**
   * Записать память места. lap — круг пройден: стёртость прибавляет круг (share — его долю: в сне из сцен
   * одна вспомненная вещь — пятая часть круга её места); newLap — счётчик кругов шагает (в сне из сцен —
   * только когда цепочка места замкнулась).
   */
  private keepMemory(lap = false, share = 1, newLap = lap): boolean {
    const m = this.memory;
    if (!m || this.testLevel) return false;
    // Стёртость из адреса — только посмотреть: в воспоминание она не идёт.
    const gained = this.game.wearGain + (lap ? WEAR.lap * share : 0);
    m.wear = Math.min(1, m.wear + gained);
    this.game.wearBase += this.game.wearGain;
    this.game.wearGain = 0;
    if (newLap) m.laps += 1;
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
    // Сон из сцен: вещь последней сцены вспомнена — цепочка её места шагнула; круг места — пять его вещей.
    this.wasErased = this.scenes ? this.keepSceneMemory() : this.keepMemory(true);
    this.saveProfile();
    this.platform.track('level_completed', { world: 'session', level: `seed_${this.seed}` });
    // Сон из сцен: следующая сессия начнётся в месте, которое давно не снилось (не в том, где кончилась).
    if (this.scenes && !this.testLevel) this.world = this.sceneWorld();
    // Сборку откладываем на полсекунды: лимбо уже на экране, и заминка не выглядит зависшим переходом.
    setTimeout(() => {
      const mem = this.place();
      this.memory = mem;
      const level = buildLevel(generateLayout(mem.seed, mem.rank, this.world), { wear: this.wearParam() ?? mem.wear });
      this.next = { level, seed: mem.seed, rank: mem.rank };
      this.game.gentle = this.profile.successes === 0 || this.scenes;
      this.game.queueSession(level, { seed: mem.seed, known: new Set(this.profile.archive), ...(this.scenes ? { chainAt: mem.chain ?? 0 } : {}) });
    }, 500);
  }

  /**
   * Сон из сцен: вещь сцены вспомнена — следующая сцена этого места начнётся со следующей вещи цепочки.
   * Круг места — пять его вещей, хоть и вспомненных в разных снах: вещь прибавляет пятую часть стёртости
   * круга, а номер круга шагает, когда цепочка замкнулась. Возвращает: место стёрто до конца.
   */
  private keepSceneMemory(): boolean {
    const m = this.memory;
    const len = WORLD_MEMORIES[this.world].length;
    if (m) m.chain = (m.chain ?? 0) + 1;
    const wrapped = m !== null && (m.chain ?? 0) % len === 0;
    return this.keepMemory(true, 1 / len, wrapped);
  }

  /** Сон из сцен: отметить, что место снилось сейчас. */
  private markDreamt(world: WorldKind): void {
    this.dreamtCount += 1;
    this.dreamt[world] = this.dreamtCount;
  }

  /**
   * Сон из сцен: место следующей сцены — не нынешнее, и из остальных то, что снилось давнее всех
   * (ещё не снившееся — первым). При равенстве решает сид сна: от сессии к сессии порядок разный.
   */
  private sceneWorld(): WorldKind {
    const pool = WORLD_KINDS.filter((w) => w !== this.world);
    const age = (w: WorldKind): number => this.dreamt[w] ?? -1;
    const oldest = Math.min(...pool.map(age));
    const cands = pool.filter((w) => age(w) === oldest);
    return cands[(this.seed + this.sceneIndex * 7 + this.profile.sorties) % cands.length]!;
  }

  /**
   * Сон из сцен: собрать следующую сцену заранее (другое место), пока идёт эта. Последняя сцена сессии
   * следующей не имеет: после неё — лимбо.
   */
  private queueNextScene(): void {
    if (this.sceneTimer !== undefined) clearTimeout(this.sceneTimer);
    this.sceneTimer = undefined;
    this.sceneNext = null;
    if (!this.scenes || this.testLevel || this.sceneIndex >= SCENES - 1) {
      this.game.queueScene(null);
      return;
    }
    const world = this.sceneWorld();
    // Сборка — с паузой: сцена уже идёт, и игрок не заметит, что следующая собирается.
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = undefined;
      const memory = memoryFor(this.profile, world);
      const level = buildLevel(generateLayout(memory.seed, memory.rank, world), { wear: this.wearParam() ?? memory.wear });
      this.sceneNext = { world, level, memory };
      this.game.queueScene(level, { seed: memory.seed, known: new Set(this.profile.archive), chainAt: memory.chain ?? 0 });
    }, 700);
  }

  /**
   * Сон из сцен: свет погас, и вокруг другое место. Прежнее: его вещь вспомнена — цепочка шагнула, круг
   * засчитан. Нынешнее становится местом игры: его стёртость, его круг на экране. Объявлений нет — как во сне.
   */
  private onScene(): void {
    const gone = this.keepSceneMemory();
    const n = this.sceneNext;
    if (n) {
      this.world = n.world;
      this.level = n.level;
      this.seed = n.memory.seed >>> 0;
      this.rank = n.memory.rank;
      this.memory = n.memory;
      this.sceneNext = null;
    }
    this.sceneIndex += 1;
    this.markDreamt(this.world);
    this.mapHint = null;
    this.saveProfile();
    // Прежнее место стёрто до конца — об этом строка, как после лимбо; иначе — номер круга нового места.
    if (gone) this.hud.flash(t('session.erased'), 6200);
    else this.sayLap();
    this.queueNextScene();
  }

  /** Лимбо отпустило: началась следующая сессия (scene — нет: следующая сцена того же сна). */
  private onBegin(scene = false): void {
    if (scene) {
      this.onScene();
      return;
    }
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
    // Сон из сцен: новая сессия — снова первая сцена; следующую собираем заранее.
    if (this.scenes) {
      this.sceneIndex = 0;
      this.markDreamt(this.world);
      this.queueNextScene();
    }
  }

  /**
   * Строка петли: в начале каждого круга, кроме первого, игра говорит одну фразу — по ней игрок
   * понимает, что место то же и что его становится меньше (docs/vylazka/story.md, §5).
   */
  private sayLap(): void {
    const lap = this.lapParam() ?? (this.memory?.laps ?? 0) + 1;
    this.hud.setLap(lap);
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

  /**
   * Начать место заново (вариант A; партнёр: «Да и да» — номер круга на экране и «начать место заново»
   * в настройках): стёртость и круги — с нуля, план тот же (тот же сид). Только на заставке.
   */
  restartPlace(): void {
    if (this.screen !== 'title' || this.testLevel) return;
    const m = this.memory;
    if (this.pinned) this.pinned = { ...this.pinned, wear: 0, laps: 0 };
    else if (m) {
      // Цепочка вещей — тоже с начала.
      const { chain: _chain, ...rest } = m;
      this.profile.memories[this.world] = { ...rest, wear: 0, laps: 0 };
    }
    this.audio.ui('ui_click');
    this.saveProfile();
    this.prepare();
    this.redraw();
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
    // Свайп от края экрана (Safari «назад») и щипок игре не нужны (слова партнёра 17.11: «Защита от свайпа нужна»).
    guardTouch();
    this.touch = new TouchControls(this.root);
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
    this.drawPaperStack(q);
    this.redraw();
  }

  /**
   * Стопка листов бумаги под нынешнее качество. Телефону полный размер слоя ни к чему: на среднем
   * качестве слой на четверть меньше, на низком — вдвое. Качество упало само — стопка пересобирается
   * меньшей, иначе на слабом устройстве остались бы лежать 34 МБ текстуры полного размера.
   */
  private drawPaperStack(q: Quality): void {
    const scale = q === 'low' ? 0.5 : q === 'med' ? 0.75 : 1;
    if (!this.paperImages || scale === this.paperScale) return;
    this.paperScale = scale;
    this.game.renderer.setPapers(drawPapers(this.paperImages, scale));
  }

  /**
   * Сильный компьютер получает высокое качество «вдвое мельче» сам (слова партнёра: «на десктопе при
   * хорошем железе на уровне hight нужно сделать зерно в 2 раза меньше, как и все растворяемые частицы»).
   * «Сильный» здесь — измеренное, а не угаданное по названию видеокарты: кадр обычного высокого качества
   * рисуется с большим запасом, а потом и кадр мелкого — быстрее, чем нужно для шестидесяти в секунду.
   * Замер идёт под заставкой загрузки и на сильной машине занимает доли секунды; слабая отсеивается на
   * первых двух кадрах. Телефон и качество, заданное в адресе, не трогаются; экран, где зерно вышло бы
   * мельче меньше чем в полтора раза, — тоже.
   */
  private probeFine(): void {
    const r = this.game.renderer;
    if (this.qualityManual || this.touchMode || r.quality !== 'high' || r.fineFor('ultra') < 1.5) return;
    const draw = (): void => this.redraw();
    const ok = (ms: number, max: number): boolean => ms >= PROBE.minMs && ms <= max;
    if (!ok(r.measure(draw, 2, PROBE.highMs * 4), PROBE.highMs)) return;
    this.setQuality('ultra');
    // Досев точек: пока облако редкое, кадр легче настоящего, и замер обманул бы. Ждём, пока досеется.
    const t0 = performance.now();
    do r.measure(draw, 1, PROBE.settleMs);
    while (r.sowing && performance.now() - t0 < PROBE.settleMs);
    if (!ok(r.measure(draw, 4, PROBE.fineMs * 6), PROBE.fineMs)) this.setQuality('high');
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
      crank: a.crank || b.crank,
      pause: a.pause || b.pause,
    };
  }

  /** Реакция на события шага: вспышки воспоминаний, вибрация, профиль, смена сессий. */
  handleEvents(ev: StepEvents): void {
    this.audio.onStep(ev, this.game);
    const buzz = this.touchMode && typeof navigator.vibrate === 'function';
    if (buzz) {
      // Полный заряд — толчок подлиннее, как щелчок, которым загорается свет; пока заряжают — мелкая дрожь.
      const now = performance.now();
      if (ev.lightCharged) navigator.vibrate(60);
      else if (ev.lightRevived) navigator.vibrate(45);
      else if (ev.strokes > 0 && this.game.light.state === 'dead') navigator.vibrate(10);
      else if (ev.crank >= 0 && now - this.crankBuzz > 160) {
        this.crankBuzz = now;
        navigator.vibrate(6);
      }
    }
    for (const e of ev.session) {
      if (e.type === 'reveal') {
        this.hud.flash(wornLine(t(`mem.${e.memory.def.id}.flash`), this.game.wearBase));
        if (buzz) navigator.vibrate([30, 40, 30]);
      } else if (e.type === 'recall') {
        const id = e.memory.def.id;
        this.hud.flash(wornLine(t(`mem.${id}.done`), this.game.wearBase));
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
      // Чем её держат, зависит от места: в тёмном — лучом, в светлом — взглядом (в зале ожидания — только на ходу).
      if (e.type === 'swarm' && e.what === 'cohered') this.teach('swarm', t(this.game.hasLight ? 'teach.swarm' : this.game.flow ? 'teach.swarm.walk' : 'teach.swarm.gaze'), 6000);
      if (buzz && (e.type === 'scare' || e.what === 'cohered')) navigator.vibrate(e.type === 'scare' ? 25 : [40, 60, 40]);
    }
    for (const e of ev.dream) {
      if (e.type === 'limbo') this.onLimbo();
      else if (e.type === 'begin') this.onBegin(e.scene === true);
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
    // Строки вещей с каждым кругом короче (systems/worn_text.ts); список заданий — целиком.
    else if (e.what === 'remind' && e.memory) this.hud.flash(wornLine(t(`mem.${e.memory}.flash`), this.game.wearBase));
    else if (e.what === 'replay' && e.memory) this.hud.flash(wornLine(t(`mem.${e.memory}.done`), this.game.wearBase));
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
    // Батарейка села до нуля: трясти бесполезно и даже вредно (ей надо отлежаться) — подсказка говорит об этом. На
    // телефоне фонарь заряжают пальцем, и севшая батарейка тоже заряжается: там подсказка одна — держать кнопку.
    this.hud.setShakePrompt(dead && !bright ? t(light.exhausted && !this.touchMode ? 'hint.battery' : `hint.shake.${kind}`) : '', this.touchMode ? 0 : light.reviveProgress);
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
    // Заглохший фонарь зовёт к кнопке, пока её не держат: под пальцем он уже заряжается.
    this.touch?.setShakePrompt(dead && !bright && !light.cranking);
    this.touch?.setCrank(light.cranking, light.flash);
    this.touch?.setLit(light.state === 'on');
    this.touch?.setCharge(light.charge);
    // Где фонаря нет (офис), нет и его кнопки.
    this.touch?.setLightHidden(!g.hasLight);
    // Заряд батарейки фонаря — там, где фонарь есть: трясти его можно, пока батарейка не села совсем.
    this.hud.setBattery(light.charge, 0, !g.hasLight || g.where !== 'main' || this.screen !== 'play');
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
    if (this.diagText) this.probeTick();
    if (this.diagText && performance.now() - this.diagAt > 500) {
      this.diagAt = performance.now();
      this.diagText.textContent = this.diagLines();
      this.placeDiagMarks();
    }
    if (this.showFps) {
      const i = g.renderer.info();
      this.hud.setFps(`${this.fps.toFixed(0)} fps · ${i.width}×${i.height} · ${i.calls} dc · ${(i.triangles / 1000).toFixed(1)}k`);
    }
  }

  /**
   * Проверка на устройстве (#diag в адресе страницы): партнёр присылает снимок экрана — по нему видно,
   * что на его видеокарте не так. Строки: видеокарта, качество и свет, а в двух точках пола (низ кадра) и
   * в середине — цвет поверхности и её «собранность» (α кадра мира, 0–255) и память света.
   */
  /** Строка проверки была включена в прошлый раз (долгим нажатием на «качество»). */
  private static diagSaved(): boolean {
    try {
      return globalThis.localStorage?.getItem('vylazka:diag') === '1';
    } catch {
      return false;
    }
  }

  /** Строка проверки вкл/выкл (долгое нажатие на кнопку качества в паузе); помнится до следующего раза. */
  private toggleDiag(): void {
    const on = !this.diagText;
    try {
      if (on) globalThis.localStorage?.setItem('vylazka:diag', '1');
      else globalThis.localStorage?.removeItem('vylazka:diag');
    } catch {
      // без хранилища — только до перезагрузки
    }
    if (on) this.makeDiag();
    else {
      this.diagText?.parentElement?.remove();
      this.diagText = null;
      for (const m of this.diagMarks) m.remove();
      this.diagMarks = [];
      const r = this.game?.renderer;
      if (r) {
        r.debugView = 0;
        if (!r.scanOn) r.debugScan(true);
      }
    }
  }

  private makeDiag(): void {
    const el = document.createElement('div');
    el.className = 'vz-diag';
    el.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 64px);z-index:60;font:11px/1.35 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.62);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-word';
    const text = document.createElement('div');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'pointer-events:auto;margin-top:6px;font:12px ui-monospace,Menlo,monospace;padding:6px 10px;border-radius:6px;border:1px solid #fff8;background:#222;color:#fff';
    // Игры при сборке страницы ещё нет: кнопка спрашивает её только при нажатии.
    btn.textContent = 'сплошь: выкл';
    const toggle = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      const r = this.game?.renderer;
      if (!r) return;
      r.debugScan(!r.scanOn);
      btn.textContent = r.scanOn ? 'сплошь: выкл' : 'сплошь: ВКЛ';
    };
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    btn.addEventListener('click', toggle);
    el.append(text, btn);
    this.root.append(el);
    this.diagText = text;
    // Последняя ошибка страницы — в строку проверки: на телефоне консоли не видно. Перехват ставится
    // один раз, даже если строку включали и выключали.
    if (!this.diagHooked) {
      this.diagHooked = true;
      const keep = (m: unknown): void => {
        this.diagErr = String(m instanceof Error ? m.message : m).slice(0, 160);
      };
      globalThis.addEventListener?.('error', (e) => keep((e as ErrorEvent).message || 'error'));
      globalThis.addEventListener?.('unhandledrejection', (e) => keep((e as PromiseRejectionEvent).reason));
      const orig = console.error.bind(console);
      console.error = (...a: unknown[]): void => {
        keep(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
        orig(...a);
      };
    }
    // Метки точек проверки: на снимке экрана видно, куда смотрела каждая строка.
    this.diagMarks = App.PROBE_PTS.map(() => {
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;width:9px;height:9px;margin:-5px 0 0 -5px;border:1px solid #ff2a6d;border-radius:50%;z-index:60;pointer-events:none';
      this.root.append(m);
      return m;
    });
  }

  private diagMarks: HTMLElement[] = [];
  /** Ошибки для строки проверки: коды WebGL (сколько раз и последний) и последняя ошибка страницы. */
  private diagGl = { count: 0, last: 0 };
  private diagErr = '';
  private diagHooked = false;

  /** Метки точек проверки — на свои места поверх кадра (кадр может быть вписан в окно с полями). */
  private placeDiagMarks(): void {
    const c = this.canvas?.getBoundingClientRect();
    if (!c) return;
    this.diagMarks.forEach((m, k) => {
      const [u, v] = App.PROBE_PTS[k]!;
      m.style.left = `${c.left + u * c.width}px`;
      m.style.top = `${c.top + v * c.height}px`;
    });
  }

  /** Точки проверки (доли кадра, y — сверху вниз): середина, пол по центру ниже и ниже, пол слева и справа. */
  private static readonly PROBE_PTS: readonly (readonly [number, number])[] = [
    [0.5, 0.5],
    [0.5, 0.62],
    [0.5, 0.75],
    [0.5, 0.88],
    [0.2, 0.8],
    [0.8, 0.8],
  ];
  /** Пиксели по точкам проверки: [обычный кадр, служебные 1, 2, 3]. */
  private probeRes: ({ scene: number[]; mem: number[] }[] | null)[] = [null, null, null, null];
  private probeAt = 0;

  /**
   * Раз в полторы секунды — три служебных кадра подряд (render: debugView 1, 2, 3): после каждого кадра
   * читаем его пиксели по точкам проверки и ставим следующий. Между циклами кадр обычный.
   */
  private probeTick(): void {
    const r = this.game?.renderer;
    if (!r || this.screen !== 'play') return;
    const v = r.debugView;
    if (v > 0) {
      this.probeRes[v] = r.diag(App.PROBE_PTS).probes;
      r.debugView = v < 3 ? v + 1 : 0;
      return;
    }
    if (performance.now() - this.probeAt < 1500) return;
    this.probeAt = performance.now();
    this.probeRes[0] = r.diag(App.PROBE_PTS).probes;
    r.debugView = 1;
  }

  private diagLines(): string {
    const g = this.game;
    if (!g) return '';
    const r = g.renderer;
    const i = r.info();
    const d = r.diag([]);
    const u = r.diagUniforms();
    const ge = r.glError();
    if (ge !== 0) this.diagGl = { count: this.diagGl.count + 1, last: ge };
    // Цвет служебных кадров лежит в кадре мира в sRGB: обратно в доли 0..1, потом в проценты.
    const lin = (b: number): number => {
      const c = b / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const pc = (x: number): string => String(Math.round(x * 100)).padStart(3);
    const res = this.probeRes;
    const row = (k: number): string => {
      const n = res[0]?.[k];
      const a = res[1]?.[k]?.scene;
      const b = res[2]?.[k]?.scene;
      const c = res[3]?.[k]?.scene;
      const [px, py] = App.PROBE_PTS[k]!;
      const head = `${Math.round(px * 100)}/${Math.round(py * 100)}`.padEnd(6);
      const base = n ? `α${pc(n.scene[3]! / 255)} пам${pc(n.mem[3]! / 255)}` : 'α  ? пам  ?';
      const f1 = a ? `взг${pc(lin(a[0]!))} свет${pc(lin(a[1]!))} дал${pc(lin(a[2]!))} итог${pc(a[3]! / 255)}` : '';
      const f2 = b ? `клет${pc(lin(b[0]!))} отд${pc(lin(b[1]!) * 2)} фон${pc(lin(b[2]!))} гасн${pc(b[3]! / 255)}` : '';
      let f3 = '';
      if (c) {
        const mark = lin(c[0]!);
        const cells = u.grid[3]! > 0.5 ? u.grid[3]! : 16;
        const cx = Math.round(lin(c[1]!) * cells - 0.5);
        const cz = Math.round(lin(c[2]!) * cells - 0.5);
        const cpu = u.texel(cx, cz);
        f3 = `${mark < 0.25 ? 'НЕТ поверхности' : mark > 0.75 ? 'NaN!' : 'есть'} кл${cx},${cz}=цп${cpu[0]}/${cpu[1]} окр${pc(c[3]! / 255)}`;
      }
      return `${head} ${base} | ${f1} | ${f2} | ${f3}`;
    };
    return [
      `${d.gpu} · ${d.webgl2 ? 'WebGL2' : 'WebGL1'} · highp ${d.highp}${this.variant ? ` · проба ${this.variant}` : ''}`,
      `${g.world ?? '?'} · q ${i.quality} ${i.width}×${i.height} · ${this.fps.toFixed(0)} fps · усиление ${g.exposure.gain.toFixed(2)} · яркость ${r.brightness} · солнце ${r.keyShadowByFormula ? 'формулой' : 'картой'}`,
      `ошибки WebGL: ${this.diagGl.count ? `${this.diagGl.count} раз, последняя ${this.diagGl.last}` : 'нет'}${this.diagErr ? ` · страница: ${this.diagErr}` : ''}`,
      `цп: скан ${u.scan.map((x) => x.toFixed(2)).join('/')} · угас ${u.fade.toFixed(2)} · даль ${u.range.map((x) => x.toFixed(0)).join('–')} · конус ${u.cone.map((x) => x.toFixed(0)).join('/')}° ×${u.tall.toFixed(2)} · солн.клетки ${u.keyCells.toFixed(2)} · сетка ${u.grid.map((x) => x.toFixed(1)).join(',')} · рассеян ${u.ambient.map((x) => x.toFixed(2)).join(',')}`,
      ...App.PROBE_PTS.map((_, k) => row(k)),
    ].join('\n');
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
    // Пока идёт игра, экран не гаснет: игрок может долго стоять в темноте и слушать.
    this.awake.want(this.screen === 'play' && !this.lifecycle.paused);
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

  /**
   * Автопонижение качества: не раньше 10 с игры и только если кадров стабильно мало. Мелкое зерно
   * держится строже остальных: оно — роскошь, и ради него игра не должна идти рывками.
   */
  private autoQuality(dt: number): void {
    if (this.qualityManual) return;
    this.playTime += dt;
    if (this.playTime < 10) return;
    const q = this.game.renderer.quality;
    const fine = q === 'ultra';
    this.slowTime = this.fps < (fine ? PROBE.fpsFloor : 27) ? this.slowTime + dt : Math.max(0, this.slowTime - dt * 2);
    if (this.slowTime < (fine ? PROBE.slowFor : 4)) return;
    this.slowTime = 0;
    this.playTime = 4;
    if (fine) this.setQuality('high');
    else if (q === 'high') this.setQuality('med');
    else if (q === 'med') this.setQuality('low');
  }
}
