/**
 * Приложение: заставка → сессии одна за другой через лимбо; пауза, ввод с устройств, профиль
 * и главный цикл. Игровая логика — в game.ts и systems/.
 */
import { LETHE_STATUE_CREDIT, letheStatue, loadLetheStatue } from './world/lethe_statue';
import { Analytics } from './analytics/events';
import type { PlayContext } from './analytics/events';
import { allSoundFiles, AudioEngine } from './audio/engine';
import { GameAudio, loadFirst } from './audio/game_audio';
import { i18n, normalizeLang, t } from './core/i18n';
import { mulberry32 } from './core/rng';
import { loadSave, memoryFor, rankFor, writeProfile } from './core/save';
import type { PlaceMemory } from './core/save';
import { erased, WEAR } from './systems/decay';
import type { FlashLevel, Level3, Profile } from './core/save';
import type { Lang } from './core/types';
import { Game, STAGE_ALL, STEP } from './game';
import type { StepEvents } from './game';
import { generateLayout, WORLD_KINDS } from './gen/layout';
import type { WorldKind } from './gen/layout';
import { Lifecycle } from './lifecycle';
import { detectCoarsePointer } from './platform';
import type { IPlatform } from './platform';
import { emptyInput, PressCarry } from './player/input';
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
import { EVENT_ORDER, Narrative } from './systems/koma';
import { DECK, metaAllowed, nextFragment } from './systems/meta';
import { KomaFlow } from './ui/koma_flow';
import type { Fragment } from './systems/meta';
import { ALL_MEMORIES, DEFAULT_SESSION, WORLD_MEMORIES } from './systems/session';
import type { SessionConfig } from './systems/session';
import { wornLine } from './systems/worn_text';
import { Hud } from './ui/hud';
import { buildMetaCard } from './ui/meta_card';
import { FrameMeter, MEASURE } from './ui/measure';
import type { MeasureResult } from './ui/measure';
import { Overlay } from './ui/overlay';
import type { CardLine } from './ui/overlay';
import { TouchControls } from './ui/touch_controls';
import { ColliderSet } from './world/colliders';
import type { BuiltLevel } from './world/level';
import { buildLevel } from './world/level_build';
import type { BuildOptions } from './world/level_build';
import { ODD_KINDS } from './systems/odd';
import type { OddKind } from './systems/odd';
import { buildPocket } from './world/pockets';
import type { PocketKind } from './world/pockets';
import { ALL_PROPS } from './world/props_all';
import { buildShowcase } from './world/showcase';
import { buildTestLevel } from './world/test_level';
import { setThingRegistry } from './world/thing_mesh';
import { setThingHq } from './world/thing_hq';
import { THING_HQ } from './world/thing_hq_meta';
import { loadSand3d, sand3dCredits } from './world/sand3d';
import { guardTouch, RESIZE_SETTLE_MS, ScreenAwake } from './platform/mobile_guard';
import { AdBreaks } from './platform/ads';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const isQuality = (v: string | null): v is Quality => v === 'low' || v === 'med' || v === 'high' || v === 'ultra';

/**
 * Замер видеокарты при запуске (App.probeQuality). frameMs — кадр первого экрана должен рисоваться быстрее этого, чтобы
 * качество осталось высоким (иначе — среднее, и так же — низкое): шестьдесят кадров в секунду — это 16,7 мс на кадр, а в
 * местах тяжелее первого экрана кадр вдвое дороже — тогда как раз тридцать. settleMs — сколько самое большее ждать досева
 * точек перед замером (пока облако редкое, кадр легче настоящего). minMs — быстрее кадр не рисуется ни на чём: такой ответ
 * значит, что замер не удался (видеокарту не дождались), и ему не верим — остаётся высокое. fpsFloor, slowFor — если на
 * «ультра» (её включает только игрок) кадров стало меньше fpsFloor и так держится slowFor секунд, зерно становится на ступень
 * крупнее. Числа выбраны расчётом и на настоящих видеокартах не проверены. Они нарочно не строгие: ошибку «оставили высокое
 * зря» ловит игра (качество понизится само через десять секунд игры), а ошибку «понизили зря» не ловит никто.
 */
const PROBE = { frameMs: 16, minMs: 0.3, settleMs: 700, fpsFloor: 45, slowFor: 2.5 } as const;
/** Сколько самое большее ждать перехода, чтобы понизить качество, решённое игрой, с. */
const DROP_WAIT = 20;
/** Множители обзора и яркости для уровней «ниже / средне / выше». */
const SENS = [0.6, 1, 1.6] as const;
/**
 * Сон из сцен: сколько вещей вспомнить за сон (сессию). Каждая — в своей сцене; сцен бывает и больше: любой скачок
 * «куда-нибудь» уносит в другое место, не дав вспомнить вещь (docs/vylazka/pressure.md, §4.7).
 */
const SCENES = 3;
/**
 * Прошедшее место (pressure.md, §4.6 п. 4): стёртое до конца воспоминание изредка всплывает в чужом сне одной комнатой. chance —
 * доля следующих сцен, которые оно забирает (если такое место есть и сцена не сама такая); wear — насколько та комната стёрта.
 */
export const FADED_SCENE = { chance: 0.25, wear: 0.8 } as const;
/**
 * Шов офис ↔ жёлтые (world/seams.ts): через сколько миллисекунд после начала сцены в офисе собирать его жёлтую версию заранее.
 * Позже следующей сцены (она собирается через 0,7 с): две сборки подряд — одна заминка вдвое дольше. На телефоне посреди игры
 * заранее не собираем: там версия собирается в темноте у шва, где заминки не видно (game.ts, stepSeam).
 */
const TWIN_AFTER_MS = 2500;
/** Через сколько секунд поисков без вещи в луче игрок считается застрявшим: тогда — одна подсказка, как искать. */
const STUCK_AFTER = 45;
/** На сколько секунд позже начинается запись стёртого почти до конца места: 23:41:07 + 16:00 = 23:57:07. */
const CLOCK_SPAN = 960;
/** Миг: сколько длится обрыв записи, мс (чернота, часы на 00:00:00, тишина). */
const MOMENT_MS = 3200;
/**
 * Сцена короче сессии: одна вещь вместо пяти. Вспышка — секунд через десять: место успевает показаться.
 * Правило «последнее воспоминание не раньше пятой минуты» (minLength) здесь не годится: вещь сцены — она
 * же последняя, и правило держало бы вспышку до конца срока, а сцена стояла бы пустой.
 */
const SCENE_SESSION: SessionConfig = { ...DEFAULT_SESSION, count: 1, firstDelay: 10, fallback: 18, minLength: 0 };
/**
 * Первый сон начинается с завязки (квиз 19.11, «Выбираемся из сна»): одна строка посреди кадра — цель, на этой секунде от начала
 * игры. Строка «ты спишь…» повторяла заставку, и её больше нет (Z-19, приём 1: страху нужно пустое место — восемь строк за двадцать
 * секунд делали из первого явления подпись к тексту). Потом показывается Осыпь (game.ts, ONBOARD_DIRECTOR, ~12 с), потом приходит
 * первая вещь (FIRST_ITEM_AT); её вспышка ждёт, пока догорит строка Осыпи (ui/hud.ts, flash с очередью).
 */
const INTRO_AT = 1;
const INTRO_MS = 4400;
/**
 * Когда в первом сне приходит первая вещь, с: после завязки и Осыпи. Следующая — через несколько секунд после «вспомнил»
 * (раньше — через 40 с: игрок стоял без цели и не понимал, что делать, — плейтест партнёра 19.11).
 */
const FIRST_ITEM_AT = 16;
/**
 * Первый сон игрока — одна сцена убежища с тремя вещами (pressure.md, §4.6, п. 1, и §4.7): убежище учит закону, и место не
 * меняется. Три сцены одного места подряд пришлось бы собирать заново из устаревшей копии памяти места — та же вещь трижды.
 */
const FIRST_SLEEP: SessionConfig = { ...SCENE_SESSION, count: SCENES, firstDelay: FIRST_ITEM_AT, delay: 6, fallback: 3 };
const BRIGHT = [0.78, 1, 1.35] as const;
/**
 * Запись для метаслоя (systems/meta.ts, «Видео — с камеры героя»): после мига — вспомнил или она показалась — игра снимает с
 * кадра frames кадров по every мс шириной w px: несколько секунд нагрудной камеры самого игрока. Своя у каждого прохождения;
 * не копится — следующий такой же миг сна заменяет прежний.
 */
const REEL = { frames: 12, every: 170, w: 200 } as const;

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
  /** Аналитика площадки (analytics/events.ts) и крючок рекламы в лимбо (platform/ads.ts; рекламы сейчас нет). */
  readonly analytics: Analytics;
  private readonly ads: AdBreaks;
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
  /** Время на камере сбито скачками в этой сессии, с: каждый скачок сдвигает его вперёд. */
  private clockSkew = 0;
  private last = 0;
  private acc = 0;
  /** Щелчок фонаря, пришедший в кадр без шага игры, — до следующего кадра (player/input.ts, PressCarry). */
  private readonly lightPress = new PressCarry();
  private qualityManual = false;
  /**
   * Качество, на которое игра решила спуститься сама: применяется на ближайшем переходе (скачок, лимбо, новая сессия), где
   * пересев точек и пересборка стопки бумаги не видны, — но не позже DROP_WAIT секунд (куратор, пачка 51, 323).
   */
  private dropTo: Quality | null = null;
  private dropWait = 0;
  /** Время кадра высокого качества в замере при запуске, мс (−1 — замера не было). */
  private probeMs = -1;
  private playTime = 0;
  private slowTime = 0;
  private showFps = false;
  /**
   * Замер 30 с из настроек (ui/measure.ts; телефон партнёра: адрес #fps до игры не доходит): счётчик, итог прошлого замера строкой
   * и до какого времени (performance.now) строка итога стоит в углу HUD. Итог помнится до перезагрузки и никуда не пишется.
   */
  private readonly meter = new FrameMeter(MEASURE.span);
  private measureLine = '';
  private measureUntil = 0;
  private measureLoadAt = 0;
  /** Пробная сборка для телефона (страница с __vzVariant): 'probe' — строка проверки включена с самого начала. */
  private variant = '';
  /** Проверка на устройстве (#diag): строка с видеокартой и тем, что в кадре на полу, и кнопка «сплошь». */
  private diagText: HTMLElement | null = null;
  private diagAt = 0;
  private testLevel = false;
  /** Сюжет «Невостребованное» (systems/koma.ts, ui/koma_flow.ts): заводится при первом обращении, когда есть игра и профиль. */
  private komaFlow: KomaFlow | null = null;
  /** Над какой точкой мира висит бирка-ярлык (место вспомненной вещи, экспонат лимбо); null — бирка не у вещи. */
  private tagAnchor: [number, number, number] | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** Какое воспоминание сейчас ищут и с какого момента (для подсказки «погаси свет»). */
  private seeking = '';
  private seekingSince = 0;
  /** Строка завязки первого сна уже показана (INTRO_AT). */
  private introShown = false;
  /** Первый сон: игрок уже гасил фонарь при искомой вещи — обязательный момент «погаси фонарь» пройден. */
  private darkTaught = false;
  /** Следующая сессия, собранная за время лимбо. */
  private next: { level: BuiltLevel; seed: number; rank: 1 | 2 | 3 } | null = null;
  /**
   * Сон из сцен — сама игра (docs/vylazka/pressure.md, §4.6–4.7; слова партнёра 16.11: «перемешивать пространства при
   * каждом скачке… игрок не может выбирать локацию»; 17.11, вечер: «Делай перемешивание пространств»). Сессия — сон:
   * три вещи, каждая в своей сцене; сцена — одно место, в ней одна вещь цепочки этого места. Вспомнил — свет гаснет, и
   * вокруг другое место; скачок «куда-нибудь» уносит в другое место раньше, чем вещь вспомнена. Первая сессия игрока —
   * вся в убежище: оно учит закону. Прежняя петля одного места (пять вещей) — для проверок: ?loop=1, #loop, знак #place
   * (смотреть места руками, с кнопкой «Место»), закреплённый сид (?seed=) и уровни-витрины.
   */
  private scenes = true;
  /** Какая по счёту сцена идёт в этой сессии (0 — первая). */
  private sceneIndex = 0;
  /** Сколько вещей сна уже вспомнено в этой сессии: сон кончается на SCENES. */
  private sceneDone = 0;
  /** Кнопка «Место» на заставке: только для проверок (знак #place, ?place=1 или петля одного места). */
  private placePick = false;
  /** Следующая сцена, уже собранная: место, уровень и его воспоминание. */
  private sceneNext: { world: WorldKind; level: BuiltLevel; memory: PlaceMemory; faded?: boolean } | null = null;
  private sceneTimer: ReturnType<typeof setTimeout> | undefined;
  /** Таймер заранее собираемой жёлтой версии офиса (TWIN_AFTER_MS). */
  private twinTimer: ReturnType<typeof setTimeout> | undefined;
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
  /** О каких помещениях с красной сеткой уже сказали за этот сон (строка — раз за сон на каждый вид). */
  private readonly roomSaid = new Set<string>();
  /** Запись этого сна для метаслоя: кадры мига, когда вспомнил, и мига, когда она показалась. */
  private reel: { recall: HTMLCanvasElement[]; apparition: HTMLCanvasElement[] } = { recall: [], apparition: [] };
  /** Идущая запись: какой миг, сколько кадров осталось, когда следующий (performance.now). */
  private reelTake: { kind: 'recall' | 'apparition'; left: number; next: number } | null = null;
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
    this.analytics = new Analytics(platform, this.lifecycle, () => this.playContext());
    this.ads = new AdBreaks(platform);
  }

  /** Сон из сцен для проверок: идёт ли, какая сцена, сколько вещей сна вспомнено, готова ли следующая сцена и где она. */
  get dreamView(): { on: boolean; scene: number; done: number; queued: boolean; next: WorldKind | null; world: WorldKind } {
    return { on: this.scenes, scene: this.sceneIndex, done: this.sceneDone, queued: this.game?.sceneQueued ?? false, next: this.sceneNext?.world ?? null, world: this.world };
  }

  /** Что аналитика знает об игре сейчас: место, круг, ступень, номер сессии, качество, настройки игрока. */
  private playContext(): PlayContext {
    const p = this.profile;
    return {
      world: this.world,
      laps: this.memory?.laps ?? 0,
      stage: this.game?.stage ?? 0,
      n: p?.sorties ?? 0,
      scenes: this.scenes,
      test: this.testLevel,
      quality: this.game?.renderer.quality ?? '',
      probeMs: this.probeMs,
      settings: p ? { sound: !p.muted, lang: p.lang ?? 'auto', sens: p.sens, bright: p.bright, flash: p.flash, place: p.place } : {},
      lang: i18n.lang,
    };
  }

  async init(): Promise<void> {
    const p = this.params;
    // Язык по умолчанию — английский (решение партнёра); выбор игрока хранится в профиле. На Playgama — язык площадки,
    // если игра его знает (обязательный шаг 3 Bridge, пункт 3.4.2: язык берётся только из bridge.platform.language).
    this.setLang(normalizeLang(p.get('lang') ?? (this.platform.id === 'playgama' ? this.platform.language() : 'en')), true);
    if (p.get('pseudo') === '1') i18n.setPseudo(true);
    // Счётчик кадров: ?fps=1 или #fps — на странице по ссылке параметров адреса нет, проходит только #имя.
    this.showFps = p.get('fps') === '1' || (typeof location !== 'undefined' && location.hash === '#fps');
    // Пробная сборка для телефона (страница с __vzVariant): «probe» ничего не меняет в игре, только включает
    // строку проверки с самого начала — нужен один снимок экрана.
    this.variant = String((globalThis as { __vzVariant?: unknown }).__vzVariant ?? '');
    // Помнить строку проверки между запусками — только вне Playgama: там мимо Bridge игра ничего не хранит (пункт 3.2.1).
    if (this.variant === 'probe' || p.get('diag') === '1' || (typeof location !== 'undefined' && location.hash === '#diag') || (this.platform.id !== 'playgama' && App.diagSaved())) this.makeDiag();
    const hash = typeof location === 'undefined' ? '' : location.hash;
    this.placePick = p.get('place') === '1' || hash === '#place';
    this.scenes = !(this.placePick || p.get('loop') === '1' || p.get('scenes') === '0' || hash === '#loop');

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
      onFlash: (level) => this.setFlash(level),
      onPlace: () => this.setPlace(WORLD_KINDS[(WORLD_KINDS.indexOf(this.world) + 1) % WORLD_KINDS.length]!),
      onRestartPlace: () => this.restartPlace(),
      onMeasure: () => this.startMeasure(),
      onLang: (lang) => this.pickLang(lang),
      onDiag: () => this.toggleDiag(),
      onQuality: (q) => {
        this.qualityManual = true;
        this.dropTo = null;
        // «Ультра», выбранная рукой, начинает с самой мелкой ступени, что даёт экран (дальше игра подстроит её сама).
        if (q === 'ultra') this.game.renderer.setFineCap(2);
        this.setQuality(q);
        // Выбор помнится между запусками (куратор, пачка 51, 324).
        this.profile.quality = q;
        this.saveProfile();
        this.audio.ui('ui_click');
      },
      onMotion: () => void this.enableMotion(),
      onSound: (on) => this.setMuted(!on),
      onSens: (level) => this.setLevels(level, this.profile.bright),
      onBright: (level) => this.setLevels(this.profile.sens, level),
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

    // Модели полки Sand3D — отдельный кусок сборки: из них вся мебель (world/furniture.ts). Качаются сразу, пока ждём
    // шрифт и сохранение; первая сборка места их дожидается, но не дольше 12 с: на медленной сети лучше войти в место
    // с серыми коробками габарита мебели, чем висеть на загрузке; следующее место соберётся уже с моделями.
    // Титры — когда бы кусок ни пришёл.
    const furniture = loadSand3d().then((ok) => {
      // В титрах — и авторы подробных вещей памяти (world/thing_hq_meta.ts): у вещей Sand3D подпись обязательна (CC BY 4.0).
      if (ok) this.overlay.setCredits({ furniture: sand3dCredits(), things: [...Object.values(THING_HQ).map((m) => m.credit), LETHE_STATUE_CREDIT] });
      return ok;
    });
    // Шрифты интерфейса и названия: ждём недолго, чтобы первый экран не мигнул системным.
    const font = (spec: string, text: string): Promise<unknown> => document.fonts?.load?.(spec, text).catch(() => undefined) ?? Promise.resolve();
    await Promise.race([Promise.all([font('16px "JetBrains Mono"', 'Убежище Ag'), font('200 16px "JetBrains Mono"', 'Ты спишь Ag'), font('200 40px "Geologica"', 'DEPRIVATIO'), font('300 16px "Geologica"', 'бюро находок')]), new Promise((r) => setTimeout(r, 1500))]);

    const qParam = p.get('q');
    // По умолчанию — высокое, и на телефоне тоже (партнёр 19.11: «графика по умолчанию Высокая, если это позволяет устройство»):
    // потянет ли, решает замер под заставкой (probeQuality).
    const quality: Quality = isQuality(qParam) ? qParam : 'high';
    this.qualityManual = isQuality(qParam);
    let renderer: GameRenderer;
    try {
      renderer = new GameRenderer(this.canvas, quality);
    } catch (e) {
      console.error('[vylazka] WebGL2 недоступен:', e);
      this.analytics.webgl('unavailable');
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
    renderer.onContextLost = () => {
      this.lifecycle.set('context', true);
      this.analytics.webgl('lost');
    };
    renderer.onContextRestored = () => {
      this.lifecycle.set('context', false);
      this.analytics.webgl('restored');
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
    this.overlay.setFlash(this.profile.flash);
    // Место вылазки: из адреса (?world=office); в сне из сцен — первая сессия в убежище, дальше то, куда сон ушёл в прошлый
    // раз (onLimbo); в петле одного места — то, что выбрано кнопкой «Место».
    const asked = p.get('world');
    // Закреплённый сид (?seed=) — петля одного места (сна из сцен там нет, см. ниже): там место — то, что выбрано кнопкой.
    const first: WorldKind = this.scenes && p.get('seed') === null && this.profile.successes === 0 ? 'shelter' : this.profile.place;
    this.world = (WORLD_KINDS as readonly string[]).includes(asked ?? '') ? (asked as WorldKind) : first;
    this.overlay.setPlace(this.world);
    // Звук грузится с этой минуты, пока строится место: сеть свободна, файлы разбираются вне главного потока, а гул
    // места должен звучать с первого шага (раньше загрузка начиналась только после первого кадра).
    this.sound.preload(loadFirst(this.world));
    if (p.get('lang') === null && this.profile.lang) this.setLang(normalizeLang(this.profile.lang), true);
    renderer.brightness = BRIGHT[this.profile.bright];
    // Проба «свет приносит точки» (квиз 17.11, ночь): ?build=1, #build или страница пробы (__vzVariant = 'build').
    renderer.beamBuild = p.get('build') === '1' || (typeof location !== 'undefined' && location.hash === '#build') || this.variant === 'build';
    // Пробная сборка: одна часть сборки места отключена, чтобы на телефоне найти, какая ломает пол.
    setThingRegistry(ALL_PROPS);
    // ?hq=0 — без подробных вещей памяти (кадры «до» и замеры): стоят прежние болванки.
    if (p.get('hq') === '0') setThingHq(false);
    // level=test — коридор технического среза, level=show — витрина реквизита.
    this.testLevel = p.get('level') === 'test' || p.get('level') === 'show' || (p.get('level') ?? '').startsWith('pocket_') || this.showParam() !== null;
    const failAt = Number(p.get('fail') ?? '');
    // Скан статуи красной комнаты забвения качается сразу, в фоне: к первому карману он уже будет (world/lethe_statue.ts).
    void loadLetheStatue();
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
    this.game.faintFlash = this.profile.flash === 'faint';
    // Меньше движения (системная настройка): перекрут белой комнаты — без оборота камеры (systems/warp.ts).
    this.game.calmMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Режиссёр давления (провал, сжатие) сам событий не начинает там, где нужен ровный ход: адрес
    // с fail=0 — проверки. press=1 включает его и там, press=0 выключает везде.
    this.game.pressureAuto = (p.get('press') ?? (p.get('fail') === '0' ? '0' : '1')) !== '0';
    this.game.archive = [...this.profile.archive];
    // Швы офис ↔ жёлтые (world/seams.ts): в игре — всегда; ?seams=0 — без них (проверки, которым переход мешает).
    this.game.seams = !this.testLevel && p.get('seams') !== '0';
    // Вещь по ту сторону шва (game.ts, SEAM_AWAY): ?away=1 — в каждой сцене, где это возможно; ?away=0 — никогда (проверки).
    const away = p.get('away');
    this.game.seamAway = away === '1' ? 1 : away === '0' ? 0 : null;
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
    if (this.pinned || this.testLevel) this.scenes = false;
    // Место игрок не выбирает (решение партнёра 16.11): кнопка «Место» — только в петле одного места, для проверок.
    this.overlay.setPlacePick(!this.scenes);
    await Promise.race([furniture, new Promise((r) => setTimeout(r, 12000))]);
    this.prepare();

    const resize = (): void => {
      renderer.resize(this.root.clientWidth, this.root.clientHeight);
      // Ступень «ультра» в кнопке качества — везде, где экран даёт зерно мельче хотя бы на четверть, и на телефоне тоже.
      // Включает её только игрок (партнёр 19.11: «Ультра может включить только игрок»); ступень мелкости игра потом
      // подстраивает под машину сама (autoQuality).
      this.overlay.setFineStep(renderer.fineFor('ultra') >= 1.25);
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
    this.platform.onAd((open) => this.lifecycle.set('ad', open));
    document.addEventListener('visibilitychange', () => {
      this.lifecycle.set('hidden', document.hidden);
      if (!document.hidden) this.awake.visible();
    });
    this.lifecycle.onChange((paused) => this.onPauseChange(paused));
    this.lifecycle.onReasons(() => this.syncAudio());

    await renderer.warmup();
    this.redraw();
    this.pickQuality();
    await nextFrame();

    this.lifecycle.set('user', true);
    this.lifecycle.set('boot', false);
    this.overlay.show('start');
    this.platform.ready();
    this.analytics.ready();
    this.ready = true;
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
        for (const f of pocket.fields ?? []) colliders.addField(f);
        // Трава кармана — тоже (луг): просмотр показывает пространство таким, каким его видит игрок, и с него снят кадр
        // экрана-проёма (assets/screens/meadow.webp).
        this.level = { chunks: pocket.meshes.map((mesh) => ({ mesh, tierMin: 0, tierMax: 0 })), stairs: [], colliders, spawn: pocket.spawn, exit: pocket.spawn.pos, spots: [], landmarks: [], zones: [], collapses: [], variants: [], nav: [], sheets: [], layout: null, ...(pocket.grass?.length ? { grass: pocket.grass } : {}) };
        this.game.loadLevel(this.level, null);
        this.game.env = pocket.env;
        this.game.renderer.cullDistance = 400;
        // Красная комната: скан статуи приходит после запуска — пришёл, когда просмотр уже собран, — собрать ещё раз.
        if (name === 'pocket_dollhouse' && !letheStatue()) void loadLetheStatue().then((m) => m && this.prepare());
      } else {
        this.level = name === 'show' ? buildShowcase(shown !== null ? [shown] : (this.params.get('props')?.split(',') ?? null), this.params.get('flat') === '1') : buildTestLevel();
        this.game.loadLevel(this.level, null);
      }
    } else {
      this.level = buildLevel(generateLayout(this.seed, this.rank, this.world), { wear, ...this.oddOpt() });
      if (this.scenes) {
        this.game.sessionCfg = this.firstSleep ? FIRST_SLEEP : SCENE_SESSION;
        if (this.komaOn) this.koma.onDream(this.firstSleep);
        // Кривая ощущений идёт через все сцены сессии: три вещи, около трёх минут.
        this.game.sessionThings = SCENES;
        this.game.sessionSpan = SCENES * 70;
      }
      // Мягкий режим Осыпи: первая сессия игрока (ни одной законченной; слова партнёра 16.11 23:41) и ступень 3. Во сне из сцен
      // он больше не включён всегда: его довод «сцена короче минуты» ушёл вместе с часами сцены — часы Осыпи теперь часы сна
      // (куратор, пачка 39, 218). Ступень погружения — по числу законченных сессий (game.ts, STAGE_ALL).
      this.game.stage = this.stageFor();
      this.game.gentle = this.profile.successes === 0 || this.game.stage === 3;
      this.clockSkew = 0;
      this.game.loadLevel(this.level, { seed: this.seed, known: new Set(this.profile.archive), ...(this.scenes ? { chainAt: mem.chain ?? 0, piece: this.pieces } : {}) });
      // Заставка — свободная минута и на телефоне: жёлтая версия офиса собирается сразу, пока ничего не движется.
      this.queueTwin(true);
      if (this.scenes) {
        // Сон начинается с места заставки.
        for (const w of WORLD_KINDS) delete this.dreamt[w];
        this.dreamtCount = 0;
        this.sceneIndex = 0;
        this.sceneDone = 0;
        this.markDreamt(this.world);
        this.queueNextScene();
      }
    }
    this.screen = 'title';
    this.audio.setScene('menu');
    this.syncAudio();
    this.titleScreen();
    this.updateHud();
  }

  /**
   * Заставка (слова партнёра 19.11: «Оставляем название и сразу под ним про сон и начать играть»): название, строка про сон и
   * «начать». Предупреждение о вспышках — тихой строкой у нижнего края, счёт сессий — внизу списка под шестерёнкой.
   */
  private titleScreen(): void {
    this.overlay.setNote(t('title.warn'));
    this.overlay.setInfo(this.profile.successes > 0 ? [t('title.count', { n: this.profile.successes, k: this.profile.archive.filter((id) => ALL_MEMORIES.some((m) => m.id === id)).length, total: ALL_MEMORIES.length })] : []);
    const lines: CardLine[] = [{ text: t('title.how'), kind: 'plain' }];
    this.overlay.setCard({ title: t('ui.title'), sub: '', lines, prompt: t(`ui.start${this.touchMode ? '.touch' : ''}`) });
  }

  /** Номер сессии, как имя несохранённого файла. */
  private sessionNumber(): string {
    return String(Math.max(1, this.profile.sorties)).padStart(4, '0');
  }

  /** Начать (нажатие на заставке). */
  start(): void {
    if (!this.game || this.screen !== 'title') return;
    this.screen = 'play';
    // Завязка — с начала сна; продолжение сохранённого посреди сна её не повторяет.
    this.introShown = this.game.time > 3;
    this.darkTaught = false;
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
      this.hud.setCamera(this.world, this.scenes);
    }
    this.analytics.sessionStarted();
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
  private keepMemory(lap = false, share = 1, newLap = lap, gain?: number): boolean {
    const m = this.memory;
    if (!m || this.testLevel) return false;
    // Стёртость из адреса — только посмотреть: в воспоминание она не идёт. gain — стёртость, набранная в сцене, которую сон
    // уже оставил (game.leftGain): игра к этому мигу живёт новой сценой, и её счёт не трогаем.
    let g = gain;
    if (g === undefined) {
      g = this.game.wearGain;
      this.game.wearBase += g;
      this.game.wearGain = 0;
    }
    const gained = g + (lap ? WEAR.lap * share : 0);
    m.wear = Math.min(1, m.wear + gained);
    if (newLap) m.laps += 1;
    const gone = erased(m.wear);
    if (this.pinned) {
      if (gone) this.pinned = { ...this.pinned, wear: 0, laps: 0 };
    } else if (gone) {
      // Стёрлось до конца — место откроется другим воспоминанием, а это остаётся прошедшим: изредка снится одной комнатой.
      this.profile.faded[this.world] = { seed: m.seed, rank: m.rank };
      delete this.profile.memories[this.world];
    }
    else this.profile.memories[this.world] = { ...m };
    return gone;
  }

  /** Сессия кончилась, игрок в лимбо: записать итог и собрать следующую — то же место, круг спустя. */
  private onLimbo(): void {
    this.roomSaid.clear();
    this.profile.successes += 1;
    // Метаслой: раз за сон, не в первом, экспонат в лимбо вспомнит обрывок — если ему есть что вспомнить (systems/meta.ts).
    // Сюжет: экспонату, на который посмотрят, Смотритель допишет владельца (ui/koma_flow.ts) — тогда лимбо тоже ждёт взгляда.
    const koma = this.komaOn && this.koma.onLimbo();
    this.game.metaWanted = koma || this.deckReady();
    // Сон из сцен: вещь последней сцены вспомнена — цепочка её места шагнула; круг места — пять его вещей. В первом сне
    // сцена одна, и вещей в ней три.
    this.wasErased = this.scenes ? this.keepSceneMemory(undefined, Math.max(1, this.game.session?.doneCount ?? 1)) : this.keepMemory(true);
    // Первый сон кончился: дальше — сцены по одной вещи.
    if (this.scenes) this.game.sessionCfg = SCENE_SESSION;
    // Место стёрто до конца — миг: запись обрывается.
    if (this.wasErased) this.moment();
    this.saveProfile();
    this.analytics.sessionCompleted();
    // Лимбо — естественная пауза между сессиями, место для рекламы (platform/ads.ts). Сейчас рекламы нет по решению
    // партнёра: ad — null, и всё идёт как раньше. Если её включат, следующая сессия встанет в очередь только после
    // ответа на просьбу о рекламе, а миг стёртого места реклама не перебьёт.
    const ad = this.ads.limbo(this.wasErased ? MOMENT_MS : 0);
    // Сон из сцен: следующая сессия начнётся в месте, которое давно не снилось (не в том, где кончилась); и после
    // перезагрузки страницы — тоже там.
    if (this.scenes && !this.testLevel) {
      this.world = this.sceneWorld();
      this.hearPlace(this.world);
      this.profile.place = this.world;
      this.saveProfile();
    }
    // Сборку откладываем на полсекунды: лимбо уже на экране, и заминка не выглядит зависшим переходом.
    setTimeout(() => {
      const mem = this.place();
      this.memory = mem;
      const level = buildLevel(generateLayout(mem.seed, mem.rank, this.world), { wear: this.wearParam() ?? mem.wear, ...this.oddOpt() });
      this.next = { level, seed: mem.seed, rank: mem.rank };
      this.game.stage = this.stageFor();
      this.game.gentle = this.profile.successes === 0 || this.game.stage === 3;
      const queue = (): void => this.game.queueSession(level, { seed: mem.seed, known: new Set(this.profile.archive), ...(this.scenes ? { chainAt: mem.chain ?? 0, piece: this.pieces } : {}) });
      if (ad) void ad.then(queue);
      else queue();
    }, 500);
  }

  /**
   * Сон из сцен: вещь сцены вспомнена — следующая сцена этого места начнётся со следующей вещи цепочки.
   * Круг места — пять его вещей, хоть и вспомненных в разных снах: вещь прибавляет пятую часть стёртости
   * круга, а номер круга шагает, когда цепочка замкнулась. Возвращает: место стёрто до конца.
   */
  private keepSceneMemory(gain?: number, steps = 1): boolean {
    const m = this.memory;
    const len = WORLD_MEMORIES[this.world].length;
    const was = m?.chain ?? 0;
    if (m) m.chain = was + steps;
    // Круг шагает, когда цепочка перешла через своё начало (первый сон вспоминает три вещи за одну сцену).
    const wrapped = m !== null && Math.floor((was + steps) / len) > Math.floor(was / len);
    return this.keepMemory(true, steps / len, wrapped, gain);
  }

  /** Сюжет идёт в основном режиме игры — во сне из сцен; на пробных уровнях и в прежней петле (?loop=1) его нет. */
  private get komaOn(): boolean {
    return this.scenes && !this.testLevel;
  }

  private get koma(): KomaFlow {
    this.komaFlow ??= new KomaFlow(
      {
        hud: this.hud,
        game: this.game,
        save: () => this.saveProfile(),
        deck: () => {
          if (!this.deckReady()) return false;
          this.showMeta();
          return true;
        },
        hint: (id) => this.analytics.hint(id),
        sound: (id) => this.sound.play(id),
        press: (done) => {
          const once = (): void => {
            window.removeEventListener('pointerdown', once);
            window.removeEventListener('keydown', once);
            done();
          };
          window.addEventListener('pointerdown', once);
          window.addEventListener('keydown', once);
        },
      },
      new Narrative(this.profile.koma),
    );
    return this.komaFlow;
  }

  /** Состояние сюжета (отладка, проверки). */
  komaState(): unknown {
    return this.profile.koma;
  }

  /**
   * Проверки: довести сюжет до сцены upTo включительно, по порядку канона, как если бы её сыграли (в игре до актов IV–V —
   * несколько снов). Нынешнему сну сразу говорится, оставлять ли вспомненную вещь на месте.
   */
  komaSkip(upTo: string, leave = 0): unknown {
    const story = new Narrative(this.profile.koma);
    // leave — сколько вещей считать уже оставленными (финал открывают три).
    for (const art of ['LP01', 'LP02', 'LP04'].slice(0, leave)) {
      story.discover(art);
      story.release(art);
    }
    for (const id of EVENT_ORDER) {
      story.play(id);
      if (id === upTo) break;
    }
    this.saveProfile();
    if (this.komaOn) this.game.keepRecalled = story.has('STORY_CARETAKER_REFLECTION') && !story.has('STORY_UNFINISHED_RECORD');
    return this.profile.koma;
  }

  /** Обрывок метаслоя положен: не в первом сне, не на пробном уровне, и колода не кончилась. */
  private deckReady(): boolean {
    return metaAllowed(this.profile.successes, this.testLevel) && nextFragment(this.profile.meta, this.reels()) !== null;
  }

  /**
   * Странная и белая комнаты (world/furnish_odd.ts): адрес ?odd=bayan | aquarium | tv | balloon ставит нужную мимо жребия (отладка
   * и кадры); в первом сне игрока — ни одной (куратор 25.11: чудо — не в первом сне). Сид, закреплённый адресом, — как есть.
   */
  private oddOpt(): Pick<BuildOptions, 'odd'> {
    const q = this.params.get('odd');
    if (q && (ODD_KINDS as readonly string[]).includes(q)) return { odd: q as OddKind };
    return this.firstSleep && !this.pinned ? { odd: 'none' } : {};
  }

  /** Первый сон игрока: одна сцена убежища с тремя вещами, без смены мест. */
  private get firstSleep(): boolean {
    return this.scenes && !this.testLevel && this.profile.successes === 0;
  }

  /**
   * Сцена — кусок места (квиз 17.11, поздний вечер: «Сцена — кусок места (советую)»; world/piece.ts): со второго сна каждая
   * сцена помнит 3–6 комнат вокруг того места, куда уронил сон, дальше память обрывается. Первый сон учит закону во всём
   * убежище; зал ожидания — сцена целиком (game.ts, setupPiece).
   */
  private get pieces(): boolean {
    // ?piece=1 или #piece в конце ссылки — кусок и в первом сне: посмотреть край памяти, не проходя первый сон (проверки, партнёр).
    const asked = this.params.get('piece') === '1' || (typeof location !== 'undefined' && location.hash === '#piece');
    return this.scenes && !this.testLevel && (asked || !this.firstSleep);
  }

  /**
   * Прошедшее место для следующей сцены — или null. Только со второго сна (первый — одна сцена убежища), не подряд, не то место,
   * где стоишь, и не зал ожидания (он — сцена целиком, своим законом). Жребий — из сида сна и номера сцены: повторяем.
   */
  private fadedWorld(): WorldKind | null {
    if (this.game.fadedScene || this.firstSleep) return null;
    const pool = WORLD_KINDS.filter((w) => w !== this.world && w !== 'station' && this.profile.faded[w] !== undefined);
    if (pool.length === 0) return null;
    const rnd = mulberry32((this.seed ^ Math.imul(this.sceneIndex + 7, 0x2c1b3c6d) ^ 0xfade) >>> 0);
    if (rnd() >= FADED_SCENE.chance) return null;
    return pool[Math.floor(rnd() * pool.length)] ?? null;
  }

  /** Сон из сцен: отметить, что место снилось сейчас. */
  private markDreamt(world: WorldKind): void {
    this.dreamtCount += 1;
    this.dreamt[world] = this.dreamtCount;
  }

  /**
   * Сон из сцен: место следующей сцены — не нынешнее, и из остальных то, что снилось давнее всех
   * (ещё не снившееся — первым). При равенстве решает сид сна: от сессии к сессии порядок разный.
   * Первый сон игрока сюда не попадает: он — одна сцена убежища (FIRST_SLEEP).
   */
  private sceneWorld(): WorldKind {
    const pool = WORLD_KINDS.filter((w) => w !== this.world);
    // Давность: сколько сцен назад место снилось; не снившееся — давнее всех. Жребий с весом давности, а не строго самое
    // давнее: строгий порядок шёл по кругу, и его угадывали (куратор, противоречие 157).
    const age = (w: WorldKind): number => (this.dreamt[w] === undefined ? this.dreamtCount + 4 : this.dreamtCount - this.dreamt[w]!);
    const weight = pool.map((w) => age(w) * age(w));
    const sum = weight.reduce((a, b) => a + b, 0);
    let r = mulberry32((this.seed ^ Math.imul(this.sceneIndex + 1, 0x9e3779b1) ^ Math.imul(this.profile.sorties + 1, 0x85ebca6b)) >>> 0)() * sum;
    for (let i = 0; i < pool.length; i++) {
      r -= weight[i]!;
      if (r < 0) return pool[i]!;
    }
    return pool[pool.length - 1]!;
  }

  /**
   * Сон из сцен: собрать следующую сцену заранее (другое место), пока идёт эта: туда унесёт скачок или «вспомнил».
   * Когда вспомнена последняя вещь сна, следующей нет: после неё — лимбо.
   */
  /** Звук места, в которое сон вот-вот унесёт: его гул и звук прихода — вперёд очереди загрузки. */
  private hearPlace(world: WorldKind): void {
    this.sound.want(loadFirst(world).slice(0, 4));
  }

  private queueNextScene(): void {
    if (this.sceneTimer !== undefined) clearTimeout(this.sceneTimer);
    this.sceneTimer = undefined;
    this.sceneNext = null;
    if (!this.scenes || this.testLevel || this.sceneDone >= SCENES || this.firstSleep) {
      this.game.queueScene(null);
      return;
    }
    const faded = this.fadedWorld();
    const world = faded ?? this.sceneWorld();
    this.hearPlace(world);
    // Сборка — с паузой: сцена уже идёт, и игрок не заметит, что следующая собирается.
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = undefined;
      if (this.sceneDone >= SCENES) return;
      const past = faded ? this.profile.faded[faded] : undefined;
      if (faded && past) {
        // Прошедшее место: тот же план, что был у стёртого воспоминания, стёртый почти до конца; в профиль ничего не пишется.
        const memory: PlaceMemory = { seed: past.seed, rank: past.rank, wear: FADED_SCENE.wear, laps: 0 };
        const level = buildLevel(generateLayout(past.seed, past.rank, faded), { wear: FADED_SCENE.wear });
        this.sceneNext = { world: faded, level, memory, faded: true };
        this.game.queueScene(level, { seed: past.seed, known: new Set(this.profile.archive), piece: true, faded: true });
        return;
      }
      const memory = memoryFor(this.profile, world);
      const level = buildLevel(generateLayout(memory.seed, memory.rank, world), { wear: this.wearParam() ?? memory.wear });
      this.sceneNext = { world, level, memory };
      this.game.queueScene(level, { seed: memory.seed, known: new Set(this.profile.archive), chainAt: memory.chain ?? 0, piece: this.pieces });
    }, 700);
  }

  /**
   * Сон из сцен: свет погас, и вокруг другое место. Прежнее: его вещь вспомнена (recalled) — цепочка шагнула, круг
   * засчитан долей; унесло скачком — вещь осталась ждать в его цепочке, записано только стёртое касаниями. Нынешнее
   * становится местом игры: его стёртость, его круг на экране. Объявлений нет — как во сне.
   */
  private onScene(recalled: boolean): void {
    const gain = this.game.leftGain;
    const gone = recalled ? this.keepSceneMemory(gain) : this.keepMemory(false, 1, false, gain);
    if (gone) this.moment();
    const n = this.sceneNext;
    if (n) {
      this.world = n.world;
      this.level = n.level;
      this.seed = n.memory.seed >>> 0;
      this.rank = n.memory.rank;
      // Прошедшее место в профиль не пишется: его воспоминания больше нет, оно только снится.
      this.memory = n.faded ? null : n.memory;
      this.sceneNext = null;
    }
    this.sceneIndex += 1;
    this.markDreamt(this.world);
    this.mapHint = null;
    this.saveProfile();
    // Прежнее место стёрто до конца — об этом строка, как после лимбо; иначе — номер круга нового места. Строка круга —
    // только когда сцену сменило «вспомнил»: скачки уносят часто, и фраза на каждый была бы болтовнёй; номер — всегда.
    if (gone) this.hud.flash(t('session.erased'), 6200);
    else if (n?.faded) this.hud.flash(t('scene.faded'), 6200);
    else this.sayLap(!recalled);
    // Камера переключилась (куратор, связка 39): у каждого места свой номер камеры, и несколько секунд рядом с ним — имя места.
    // Не заголовок уровня (места — не уровни, Z-12), а подпись записи: где ты, видно, а сон переход не объявляет.
    this.hud.setCamera(this.world, true);
    this.queueNextScene();
    this.queueTwin();
  }

  /**
   * Шов офис ↔ жёлтые (world/seams.ts): собрать жёлтую версию офиса заранее, в свободную секунду после начала сцены, — чтобы
   * переход в темноте у шва не ждал сборки. idle — сейчас ничего не движется (заставка): собрать сразу и на телефоне. Посреди игры
   * на телефоне заранее не собираем: там игра соберёт её сама в темноте у шва, где заминки не видно. Время сборки — в журнал
   * консоли ([seam]) и в __vz.seam().
   */
  private queueTwin(idle = false): void {
    if (this.twinTimer !== undefined) clearTimeout(this.twinTimer);
    this.twinTimer = undefined;
    if (!this.game.seams || !this.game.hasTwin || this.game.twinReady) return;
    const build = (): void => {
      this.twinTimer = undefined;
      if (!this.game.hasTwin || this.game.twinReady || !this.game.prepareTwin()) return;
      console.info(`[seam] жёлтая версия офиса собрана за ${Math.round(this.game.twinBuildMs)} мс`);
    };
    if (idle) build();
    else if (!this.game.phone) this.twinTimer = setTimeout(build, TWIN_AFTER_MS);
  }

  /** Лимбо отпустило: началась следующая сессия (scene — нет: следующая сцена того же сна). */
  /**
   * Ступень погружения (game.ts, STAGE_ALL): по числу законченных сессий — каждая из первых открывает одно правило сна.
   * Проверки (в адресе fail=, level=, seed=) — всё сразу; сон из сцен, раз он теперь сама игра, идёт по ступеням, как шла
   * петля (17.11, вечер). #stage0…#stage4 в конце ссылки или ?stage= —
   * посмотреть ступень руками (партнёру: свои сессии он уже прошёл, и первых ступеней иначе не увидит).
   */
  private stageFor(): number {
    const m = /^#stage([0-4])$/.exec(typeof location === 'undefined' ? '' : location.hash);
    const raw = m ? m[1]! : this.params.get('stage');
    const asked = raw === null ? NaN : Number(raw);
    if (Number.isInteger(asked) && asked >= 0 && asked <= STAGE_ALL) return asked;
    if (this.testLevel || this.pinned || this.params.get('fail') !== null) return STAGE_ALL;
    return Math.min(this.profile.successes, STAGE_ALL);
  }

  /**
   * Время на камере идёт по стёртости места: первый круг нового места начинается в 23:41, каждый следующий — позже, последний
   * — почти у полуночи (решение основной модели 17.11 по критике куратора: раньше время шло по числу сессий и после
   * четырнадцатой навсегда вставало у полуночи, а у каждого нового места своего пути к мигу не было). Последние две
   * минуты до полуночи часы тянутся всё медленнее и сами её не достигают (hud.ts, towardMidnight); миг наступает, когда
   * место стёрто до конца (moment), — и новое место снова начинается в 23:41.
   */
  private clockStart(): number {
    const wear = Math.max(0, Math.min(1, this.wearParam() ?? this.memory?.wear ?? 0));
    return Math.round(wear * CLOCK_SPAN);
  }

  /**
   * Миг (ответ партнёра в квизе 17.11: «Запись обрывается» — миг приходит вместе с полным стиранием места: кадр гаснет,
   * REC пропадает; словами ничего не объясняем). Часы встают на 00:00:00, кадр и звук обрываются разом.
   */
  moment(): void {
    this.hud.cut(MOMENT_MS);
    this.sound.cut(MOMENT_MS / 1000);
    this.analytics.placeErased();
  }

  private onBegin(scene = false, recalled = false): void {
    this.clockSkew = 0;
    if (scene) {
      this.onScene(recalled);
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
    if (this.komaOn) this.koma.onDream(this.firstSleep);
    // Новый сон — новая запись: в лимбо экспонат вспоминает миги этого сна.
    this.reel = { recall: [], apparition: [] };
    this.reelTake = null;
    this.keepMemory();
    this.saveProfile();
    this.analytics.sessionStarted();
    this.hud.toast(t('session.begin', { n: this.sessionNumber() }), 4200);
    // Прежнее место стёрлось до конца: это уже другое.
    if (this.wasErased) this.hud.flash(t('session.erased'), 6200);
    else this.sayLap();
    this.wasErased = false;
    this.hud.setCamera(this.world, this.scenes);
    // Сон из сцен: новая сессия — снова первая сцена; следующую собираем заранее.
    if (this.scenes) {
      this.sceneIndex = 0;
      this.sceneDone = 0;
      this.markDreamt(this.world);
      this.queueNextScene();
    }
    this.queueTwin();
  }

  /**
   * Строка петли: в начале каждого круга, кроме первого, игра говорит одну фразу — по ней игрок
   * понимает, что место то же и что его становится меньше (docs/vylazka/story.md, §5).
   */
  private sayLap(quiet = false): void {
    const lap = this.lapParam() ?? (this.memory?.laps ?? 0) + 1;
    this.hud.setLap(lap);
    if (quiet) return;
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
    this.hearPlace(world);
    this.profile.place = world;
    this.overlay.setPlace(world);
    this.audio.ui('ui_click');
    this.saveProfile();
    if (this.screen === 'title' && !this.testLevel) {
      this.prepare();
      this.redraw();
    }
  }

  /** Вспышки: мягкие или почти незаметные (полных нет — слова партнёра 19.11). */
  setFlash(level: FlashLevel): void {
    this.profile.flash = level;
    this.game.faintFlash = level === 'faint';
    this.overlay.setFlash(level);
    this.audio.ui('ui_click');
    this.saveProfile();
  }

  /** Язык из списка настроек; выбор запоминается. */
  private pickLang(lang: Lang): void {
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
    // Сюжет ждёт вместе с игрой: реплики, карточки и запись не проходят мимо, пока игрок их не видит.
    this.hud.hold(paused);
    this.komaFlow?.hold(paused);
    if (this.screen !== 'play') return;
    if (paused) {
      // Возврат в игру — всегда по нажатию: браузер не даст захватить мышь без жеста.
      this.lifecycle.set('user', true);
      this.desktop?.release();
      this.desktop?.uncapture();
      this.touch?.release();
      this.touch?.setVisible(false);
      this.game.shake.reset();
      this.overlay.setInfo([t('title.warn')]);
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
    // Пальцем удержать вещь в луче труднее, чем мышью: луч чуть «липнет» к искомой вещи.
    this.game.stickyAim = true;
    // Белые вспышки скачков на телефоне короче: экран близко к глазам, часто в тёмной комнате.
    this.game.phone = true;
    this.root.classList.add('is-touch');
    // Свайп от края экрана (Safari «назад») и щипок игре не нужны (слова партнёра 17.11: «Защита от свайпа нужна»).
    guardTouch();
    this.touch = new TouchControls(this.root);
    this.touch.setVisible(this.screen === 'play' && !this.lifecycle.paused);
    this.overlay.setTouch(true);
    this.refreshMotionButton();
    if (this.screen === 'title') this.titleScreen();
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
    this.analytics.qualityChanged(q, !this.qualityManual);
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
    // Телефону полный размер ни к чему и на высоком: 34 МБ в видеокарте против 19 (куратор, пачка 51, 323).
    const scale = q === 'low' ? 0.5 : q === 'med' || this.touchMode ? 0.75 : 1;
    if (!this.paperImages || scale === this.paperScale) return;
    this.paperScale = scale;
    this.game.renderer.setPapers(drawPapers(this.paperImages, scale));
  }

  /**
   * Качество при запуске. Выбранное игроком рукой помнится (профиль, Profile.quality) и берётся как есть: «ультра» — если экран
   * даёт зерно мельче, иначе высокое. Не выбирал — по умолчанию высокое, если устройство его тянет (партнёр 19.11: «графика по
   * умолчанию Высокая, если это позволяет устройства. Ультра может включить только игрок»). «Тянет» — измеренное, а не
   * угаданное по названию видеокарты или по тому, телефон ли это: кадр первого экрана рисуется быстрее PROBE.frameMs. Нет —
   * среднее, и с ним так же; не тянет и среднего — низкое. Замер идёт под заставкой загрузки и занимает доли секунды; слабая
   * машина отсеивается на первых кадрах (замер обрывается). «Ультра» игра сама не включает никогда — раньше сильный компьютер
   * получал её сам (слова партнёра о мелком зерне «на десктопе при хорошем железе»), теперь это выбор игрока. Качество из адреса
   * не трогается. Время кадра замера уходит в сводку кадров (performance_sample, probe_ms): так видно, что показывают
   * настоящие телефоны.
   */
  private pickQuality(): void {
    const r = this.game.renderer;
    if (this.qualityManual) return;
    const pick = this.profile.quality;
    if (pick) {
      this.qualityManual = true;
      const q = pick === 'ultra' && r.fineFor('ultra') < 1.25 ? 'high' : pick;
      if (q === 'ultra') r.setFineCap(2);
      if (r.quality !== q) this.setQuality(q);
      return;
    }
    const draw = (): void => this.redraw();
    for (const q of ['high', 'med'] as const) {
      if (r.quality !== q) this.setQuality(q);
      // Досев точек: пока облако редкое, кадр легче настоящего, и замер обманул бы. Ждём, пока досеется.
      const t0 = performance.now();
      do r.measure(draw, 1, PROBE.settleMs);
      while (r.sowing && performance.now() - t0 < PROBE.settleMs);
      const ms = r.measure(draw, 3, PROBE.frameMs * 4);
      if (q === 'high') this.probeMs = ms;
      // Не дождались видеокарты — замеру не верим и оставляем, что есть: ошибку «оставили зря» поправит игра.
      if (ms < PROBE.minMs || ms <= PROBE.frameMs) return;
    }
    this.setQuality('low');
  }

  setLang(lang: Lang, initial = false): void {
    i18n.setLang(lang);
    document.documentElement.lang = i18n.lang;
    if (initial) return;
    this.hud.relabel();
    this.touch?.relabel();
    if (this.screen === 'title') this.titleScreen();
    else {
      if (this.screen === 'play') this.overlay.setInfo([t('title.warn')]);
      this.overlay.refresh();
    }
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
    this.analytics.onStep(ev);
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
        // Вещь пришла — её строка ждёт, пока догорит горящая (строка Осыпи, «вспомнил» прошлой вещи): свет и звук вещи — сразу.
        this.hud.flash(wornLine(t(`mem.${e.memory.def.id}.flash`), this.game.wearBase), undefined, true);
        if (buzz) navigator.vibrate([30, 40, 30]);
      } else if (e.type === 'recall') {
        const id = e.memory.def.id;
        // Бирка повиснет ярлыком над местом вещи (квиз 24.11, ночь): сама вещь сейчас рассыплется, место останется.
        const sp = e.memory.spot;
        this.tagAnchor = sp ? [sp.x, sp.y + 0.35, sp.z] : null;
        // Миг, когда вспомнил, — в запись для метаслоя (REEL).
        this.startReel('recall');
        // Сюжет: на вещь заводится бирка; в первом сне о ней говорят Смотритель и чужие голоса — тогда строки «вспомнил» нет.
        const told = this.komaOn && this.koma.onRecall(id, this.firstSleep);
        if (!told) this.hud.flash(wornLine(t(`mem.${id}.done`), this.game.wearBase));
        if (!this.profile.archive.includes(id)) this.profile.archive.push(id);
        this.saveProfile();
        // Сон из сцен: последняя вещь сна вспомнена — следующей сцены нет, после этой — лимбо.
        if (this.scenes && !this.testLevel) {
          this.sceneDone += 1;
          if (this.sceneDone >= SCENES) this.queueNextScene();
        }
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
      // Чем её держат, зависит от места: в тёмном — лучом, в светлом — взглядом (в зале ожидания — только на ходу). Про взгляд
      // говорим: без фонаря это не догадаться. Про луч молчим (аудит объяснений 17.11: светить на то, что пугает, игрок станет и сам;
      // куратор, пачка 48: сказанное «держи в луче» за одну встречу выучит «посветил — рассыпалась», и страха не останется) — в
      // начале охоты одна строка, что она знает, где ты.
      if (e.type === 'swarm' && e.what === 'cohered' && !this.game.hasLight) this.teach('swarm', t(this.game.flow ? 'teach.swarm.walk' : 'teach.swarm.gaze'), 6000);
      // Первый сон: Осыпь показалась — одна строка, что это (посреди кадра, как завязка); вышла на охоту — как от неё держаться
      // (плейтест партнёра 19.11: «не понимают… почему»; правило «понятный враг» — луч держит её, и это теперь сказано).
      // Миг, когда она показалась, — в запись для метаслоя (REEL).
      if (e.type === 'swarm' && e.what === 'apparition') this.startReel('apparition');
      if (e.type === 'swarm' && e.what === 'apparition' && this.firstSleep && !this.taught.has('glimpse')) {
        this.taught.add('glimpse');
        this.analytics.hint('glimpse');
        this.hud.flash(t('swarm.first'), 4800);
      }
      if (e.type === 'swarm' && e.what === 'release' && this.game.hasLight) this.teach('hunt', t('swarm.hunt'), 6000);
      if (buzz && (e.type === 'scare' || e.what === 'cohered')) navigator.vibrate(e.type === 'scare' ? 25 : [40, 60, 40]);
    }
    for (const e of ev.dream) {
      // Понижение качества, решённое игрой, — на переходе: пересев точек и пересборка стопки бумаги прячутся в нём.
      if (this.dropTo && (e.type === 'limbo' || e.type === 'begin' || (e.type === 'jump' && e.phase === 'switch'))) this.applyDrop();
      if (e.type === 'limbo') this.onLimbo();
      else if (e.type === 'meta') {
        // Экспонат лимбо, на который смотрят: бирка сюжета повиснет над ним (экспонаты парят — выше их места).
        const ex = this.game.things.focus ?? this.game.things.list.find((x) => x.still && x.kind === e.thing);
        this.tagAnchor = ex ? [ex.pos[0], ex.pos[1] + 0.95, ex.pos[2]] : null;
        if (this.komaOn && this.koma.onMeta(e.thing)) {
          // Бирка или запись сюжета заняли это лимбо.
        } else if (this.deckReady()) this.showMeta();
        else this.game.metaHold = false;
      }
      else if (e.type === 'begin') this.onBegin(e.scene === true, e.recalled === true);
      // «Вещи не любят, когда на них долго смотрят» спорит с главным делом первого сна — вспомнить вещь взглядом (куратор, пачка 48):
      // в первом сне её нет.
      else if (e.type === 'thing' && e.what === 'changing' && e.thing.fate !== 'dust' && !this.firstSleep) this.teach('thing', t('teach.thing'));
      else if (e.type === 'jump' && e.phase === 'switch' && e.plan.style === 'seam') {
        // Шов — без следа: ни дрожи, ни прыжка времени на камере; шагнул (песчаный зал) или свет вернулся (офис ↔ жёлтые) — и уже
        // там. У шва офиса камера та же запись, только другая версия места: номер меняется молча, без имени места (КАМ-12 ↔ КАМ-12Б).
        if (e.plan.to === 'twin' && this.game.level) {
          this.level = this.game.level;
          this.hud.setCamera(this.game.world, false);
        }
      } else if (e.type === 'jump' && e.phase === 'switch') {
        // Осыпь вернула в начало: об этом говорит строка, иначе непонятно, почему место другое.
        if (e.plan.cause === 'caught') this.hud.toast(t('toast.caught'), 3400);
        if (buzz) navigator.vibrate(35);
        // Скачок сбивает время на камере: оно прыгает вперёд — «меня перенесло» видно и без строки.
        this.clockSkew += 4 + Math.random() * 37;
      }
      else if (e.type === 'pocket') this.onPocket(e);
      // Красная сетка: в тёмном помещении свет не сохранился — только линии; в «сеточном» комната перестала притворяться.
      // Раз за сон на каждый вид: во сне из сцен уровень новый каждую минуту, и строка звучала бы в каждой сцене (куратор, 229).
      else if (e.type === 'room' && !this.roomSaid.has(e.fx)) {
        this.roomSaid.add(e.fx);
        this.hud.toast(t(`toast.room.${e.fx}`), 4200);
      }
      // Сцена — кусок места: игрок у края, глядит туда, где память обрывается, — раз за сон; дальше край объясняет себя сам.
      else if (e.type === 'edge' && !this.roomSaid.has('edge')) {
        this.roomSaid.add('edge');
        this.hud.toast(t('toast.edge'), 4200);
      }
      // Искомая вещь по ту сторону шва: на её месте один кружевной след (SEAM_AWAY) — раз за сон.
      else if (e.type === 'away' && !this.roomSaid.has('away')) {
        this.roomSaid.add('away');
        this.hud.toast(t('toast.seam.away'), 4800);
      }
      // Первое касание: вещь рассыпалась — сказать, что это правило, и как её вернуть. Только после настоящего касания:
      // обвал пола и бумажный цветок рассыпают вещи сами, и строка «здесь ничего нельзя потрогать» там лишняя (аудит 17.11).
      else if (e.type === 'touch' && e.what === 'gone' && e.first !== undefined && !e.self) this.teach('touch', t(this.game.flow ? 'teach.touch.station' : this.game.hasLight ? 'teach.touch' : 'teach.touch.still'), 7000);
    }
  }

  /** Карманное пространство говорит, зачем оно: строка при входе и строка, когда оно сделало своё дело. */
  private onPocket(e: Extract<StepEvents['dream'][number], { type: 'pocket' }>): void {
    const task = e.memory ? t(`mem.${e.memory}.task`) : '';
    if (e.what === 'enter' && e.kind === 'dunes') {
      // Песчаный зал: одна тихая строка за сон — с первого раза; дальше зал говорит сам.
      if (!this.roomSaid.has('dunes')) {
        this.roomSaid.add('dunes');
        this.hud.toast(t('pocket.dunes.enter'), 4600);
      }
    } else if (e.what === 'enter') {
      // В кукольном домике и на лугу строка зависит от того, ищет ли игрок что-нибудь прямо сейчас: дверь луга ведёт
      // к искомой вещи, а когда искать нечего (холодный старт) — обратно.
      const idle = !e.memory && (e.kind === 'dollhouse' || e.kind === 'meadow') ? '.idle' : '';
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
    this.analytics.saved();
  }

  /** Подсказка обучения: показывается один раз за сессию. */
  private teach(id: string, text: string, ms = 5000): void {
    if (this.taught.has(id)) return;
    this.taught.add(id);
    this.analytics.hint(id);
    this.hud.toast(text, ms);
  }

  updateHud(): void {
    const g = this.game;
    const s = g.session;
    const light = g.light;
    // Первый сон начинается с завязки: строка посреди кадра, потом — Осыпь и первая вещь (квиз 19.11).
    if (this.firstSleep && this.screen === 'play' && g.where === 'main' && !this.introShown && g.time >= INTRO_AT) {
      this.hud.flash(t('intro.goal'), INTRO_MS);
      this.introShown = true;
    }
    this.hud.setTime(g.time + this.clockStart() + this.clockSkew);
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
      // Про паузу — не в первом сне: его первые секунды — тише (Z-19, приём 1); пауза находится и сама — Esc отпускает мышь.
      else if (g.time < 16 && !this.touchMode && !this.firstSleep) hint = t('hint.pause.desktop');
    }
    // Первый сон: искомая вещь в луче — как её вспомнить: подержать в луче (плейтест 19.11; куратор, пачка 48: это нигде не
    // сказано). Только до первой вспомненной вещи.
    const focus0 = g.things.focus;
    if (this.firstSleep && this.screen === 'play' && g.where === 'main' && s?.active && s.doneCount === 0 && focus0?.memory && !dead && hint === '') hint = t('teach.hold');
    // Первый сон: как искать — обязательный момент (квиз 19.11, «Звук, свечение, цель»): пока игрок ни разу не погасил фонарь
    // при искомой вещи, внизу — «погасите фонарь: в темноте искомое видно сквозь стены»; погасил — «вот она».
    if (this.firstSleep && this.screen === 'play' && g.where === 'main' && g.hasLight && s?.active && !this.darkTaught) {
      const lesson = g.darkLesson;
      if (lesson && lesson.phase !== 'skip') {
        // Тёмный урок учит событием (Z-19, приём 4): фонарь глохнет сам, и искомое проступает сквозь стены — строки «погасите
        // фонарь» больше нет; внизу — только подсказка оживить фонарь.
        if (lesson.phase === 'on' || lesson.phase === 'done') {
          this.darkTaught = true;
          this.analytics.hint('dark.lesson');
        }
      } else if (light.state === 'off') {
        this.darkTaught = true;
        this.analytics.hint('dark.first');
        this.hud.toast(t('teach.dark.seen'), 5200);
      } else if (!dead && hint === '' && g.time >= FIRST_ITEM_AT) hint = t(`teach.dark.first.${base}`);
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
      // Цель — полной фразой («Найди: будильник»), над ней — счёт по всему сну (квиз 19.11, «Звук, свечение, цель»): раньше
      // в углу стояло одно слово, и игрок не понимал, что с ним делать (плейтест партнёра 19.11).
      const lines = s.memories
        .filter((m) => m.state !== 'hidden')
        .map((m) => {
          const what = t(`mem.${m.def.id}.task`) + (m.state === 'active' && this.mapHint?.memory === m.def.id ? ` · ${t(`room.${this.mapHint.room}`)}` : '');
          return { text: m.state === 'active' ? t('goal.find', { what }) : what, done: m.state === 'done' };
        });
      const whole = this.scenes && !this.testLevel;
      const total = whole ? SCENES : s.memories.length;
      const done = Math.min(total, whole ? this.sceneDone : s.doneCount);
      this.hud.setGoals(lines.length > 0 ? t('goal.count', { n: done, total }) : '', lines, lines.length > 0);
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
      // Подсказка, как искать, — только застрявшему: 45 секунд поисков, и вещи в луче нет (аудит объяснений 17.11; строку
      // оставляем — партнёру трудно находить вещи, M-20). «Держите в луче» и «в воде медленнее» убраны: первую видел тот,
      // кто уже держит, вторая объясняет то, что видно и так.
      if (act && g.time - this.seekingSince > STUCK_AFTER && s.hold <= 0.05) this.teach('dark', t(g.flow ? 'teach.dark.station' : g.hasLight ? 'teach.dark' : 'teach.dark.still'), 7000);
    } else {
      this.hud.setGoals('', [], false);
      this.hud.setMarker(0, 0, false);
    }
    // Лимбо: итог сессии и строка «от системы».
    if (g.where === 'limbo') {
      const k = s ? s.doneCount : 0;
      this.hud.setLimbo([t('limbo.done', { n: this.sessionNumber(), k }), t(`limbo.line.${(this.profile.successes + this.profile.archive.length) % 6}`), t('limbo.wait')]);
    } else this.hud.setLimbo([]);
    // Бирка — ярлык у вещи: следует за точкой в кадре; бирки нет — привязка забыта (следующая бирка без вещи — посреди кадра).
    if (!this.hud.tagOn) this.tagAnchor = null;
    this.hud.tagAt(this.tagAnchor ? g.renderer.project(this.tagAnchor) : null);
    if (this.diagText) this.probeTick();
    if (this.diagText && performance.now() - this.diagAt > 500) {
      this.diagAt = performance.now();
      this.diagText.textContent = this.diagLines();
      this.placeDiagMarks();
    }
    // Угол HUD: идёт замер — сколько осталось; кончился — итог ~20 с; иначе — счётчик кадров (#fps) или ничего.
    const measure = this.measureText();
    if (measure) this.hud.setFps(measure);
    else if (this.showFps) {
      const i = g.renderer.info();
      this.hud.setFps(`${this.fps.toFixed(0)} fps · ${i.quality}${i.quality === 'ultra' ? ` ${i.fine}` : ''} · ${i.width}×${i.height} · ${i.calls} dc · ${(i.triangles / 1000).toFixed(1)}k · грибы ${i.spores.shown}`);
    } else this.hud.setFps('');
  }

  /** Замер 30 с (пункт настроек): начать заново и пустить игру — с заставки или из паузы. */
  private startMeasure(): void {
    this.meter.start();
    this.measureUntil = 0;
    this.measureLoadAt = 0;
    this.audio.ui('ui_click');
    if (this.screen === 'title') this.start();
    else this.resumePlay();
  }

  /** Кадр игры длиной ms для замера; раз в полсекунды — нагрузка кадра. Кончился — итог в угол HUD, в консоль и под пункт. */
  private measureTick(ms: number): void {
    const now = performance.now();
    if (now - this.measureLoadAt > 500) {
      this.measureLoadAt = now;
      const i = this.game.renderer.info();
      this.meter.load(i.calls, i.triangles);
    }
    const r = this.meter.frame(ms);
    if (r) this.measureDone(r);
  }

  /** Итог замера строкой: качество и кадр — какие сейчас, частоты и нагрузка — за 30 с замера. */
  private measureDone(r: MeasureResult): void {
    const i = this.game.renderer.info();
    const quality = `${t(`ui.quality.${i.quality}`)}${i.quality === 'ultra' ? ` ${i.fine}` : ''}`;
    // Меньше десяти кадров в секунду — с десятой: «0 fps» читалось бы поломкой замера.
    const fps = (x: number): string => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
    this.measureLine = t('ui.measure.line', { fps: fps(r.avg), low: fps(r.low1), quality, size: `${i.width}×${i.height}`, dc: Math.round(r.calls), tri: Math.round(r.triangles / 1000) });
    this.measureUntil = performance.now() + MEASURE.show * 1000;
    this.overlay.setMeasure(this.measureLine);
    console.info(`[vylazka] ${this.measureLine}`, { ...r, quality: i.quality, fine: i.fine, width: i.width, height: i.height, world: this.game.world, touch: this.touchMode });
  }

  /** Строка замера для угла HUD: идёт — сколько секунд осталось; кончился недавно — итог; иначе пусто. */
  private measureText(): string {
    if (this.meter.running) return t('ui.measure.run', { s: Math.ceil(this.meter.left) });
    return this.measureLine && performance.now() < this.measureUntil ? this.measureLine : '';
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
      // На Playgama — только до перезагрузки: мимо Bridge игра ничего не пишет (пункт 3.2.1).
      const store = this.platform.id === 'playgama' ? null : globalThis.localStorage;
      if (on) store?.setItem('vylazka:diag', '1');
      else store?.removeItem('vylazka:diag');
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
      `${g.world ?? '?'} · q ${i.quality}${i.quality === 'ultra' ? ` ${i.fine}` : ''} ${i.width}×${i.height} · ${this.fps.toFixed(0)} fps · ${i.calls} dc · ${(i.triangles / 1000).toFixed(0)}k · грибы ${i.spores.shown} (дальн. ${i.spores.far}, вне кадра ${i.spores.culled})${this.probeMs >= 0 ? ` · замер ${this.probeMs.toFixed(1)} мс` : ''} · усиление ${g.exposure.gain.toFixed(2)} · яркость ${r.brightness} · солнце ${r.keyShadowByFormula ? 'формулой' : 'картой'}`,
      `ошибки WebGL: ${this.diagGl.count ? `${this.diagGl.count} раз, последняя ${this.diagGl.last}` : 'нет'}${this.diagErr ? ` · страница: ${this.diagErr}` : ''}`,
      `цп: скан ${u.scan.map((x) => x.toFixed(2)).join('/')} · угас ${u.fade.toFixed(2)} · даль ${u.range.map((x) => x.toFixed(0)).join('–')} · конус ${u.cone.map((x) => x.toFixed(0)).join('/')}° ×${u.tall.toFixed(2)} · солн.клетки ${u.keyCells.toFixed(2)} · сетка ${u.grid.map((x) => x.toFixed(1)).join(',')} · рассеян ${u.ambient.map((x) => x.toFixed(2)).join(',')}`,
      ...App.PROBE_PTS.map((_, k) => row(k)),
    ].join('\n');
  }

  /** Один оборот игры: шаги симуляции, кадр, надписи. Отладочный API вызывает то же самое вручную. */
  advance(input: InputFrame, steps: number, alpha: number, dt: number, present = true): void {
    // Щелчок фонаря ждёт ближайшего шага игры, а не пропадает в кадре без шага (экран 120 Гц).
    input.light = this.lightPress.take(input.light, steps);
    for (let i = 0; i < steps; i++) {
      this.handleEvents(this.game.step(STEP, input));
      input.light = false;
    }
    this.game.draw(alpha, dt, present);
    if (present) this.takeReel();
    this.updateHud();
  }

  /** Какие кадры записи есть в этом сне. */
  private reels(): { recall: boolean; apparition: boolean } {
    return { recall: this.reel.recall.length > 0, apparition: this.reel.apparition.length > 0 };
  }

  /** Начать запись мига (REEL). Идущую не перебивает: миг уже снимается. */
  private startReel(kind: 'recall' | 'apparition'): void {
    if (this.reelTake || this.testLevel) return;
    this.reelTake = { kind, left: REEL.frames, next: 0 };
  }

  /** Снять кадр записи с только что нарисованного кадра игры (тот же кадр, что на экране). */
  private takeReel(): void {
    const c = this.reelTake;
    if (!c) return;
    const now = performance.now();
    if (now < c.next) return;
    c.next = now + REEL.every;
    const src = this.canvas;
    if (src.width < 2 || src.height < 2) return;
    const fr = document.createElement('canvas');
    fr.width = REEL.w;
    fr.height = Math.max(2, Math.round((REEL.w * src.height) / src.width));
    const ctx = fr.getContext('2d');
    try {
      if (!ctx) throw new Error('2d');
      ctx.drawImage(src, 0, 0, fr.width, fr.height);
    } catch {
      this.reelTake = null;
      return;
    }
    const list = this.reel[c.kind];
    // Новый такой же миг заменяет прежний.
    if (c.left === REEL.frames) list.length = 0;
    list.push(fr);
    c.left -= 1;
    if (c.left <= 0) this.reelTake = null;
  }

  /** Отладка: показать обрывок по id (или следующий) сразу; reel — сперва начать запись мига «вспомнил». */
  debugMeta(id?: string, reel = false): string | null {
    if (reel) this.startReel('recall');
    const f = id ? (DECK.find((x) => x.id === id) ?? null) : nextFragment(this.profile.meta, this.reels());
    if (!f) return null;
    this.showMeta(f, false);
    return f.id;
  }

  /**
   * Экспонат в лимбо вспомнил: показать следующий обрывок колоды (или данный); когда он уйдёт — отпустить лимбо. keep — записать
   * обрывок в профиль как увиденный.
   */
  private showMeta(given?: Fragment, keep = true): void {
    const f: Fragment | null = given ?? nextFragment(this.profile.meta, this.reels());
    if (!f) {
      this.game.metaHold = false;
      return;
    }
    const r = this.reel;
    const frames = f.kind !== 'video' ? [] : f.moment === 'apparition' && r.apparition.length > 0 ? r.apparition : r.recall.length > 0 ? r.recall : r.apparition;
    const { card, stop } = buildMetaCard(f, frames, () => this.hud.clockText());
    if (keep) {
      this.profile.meta.push(f.id);
      this.saveProfile();
      this.analytics.hint(`meta.${f.id}`);
    }
    this.hud.meta(card, f.hold * 1000, stop, () => {
      this.game.metaHold = false;
    });
  }

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const prev = this.last;
    const dt = Math.min(0.1, Math.max(0, (now - prev) / 1000));
    this.last = now;
    // Звук считается и на паузе: в меню игра стоит, а музыка идёт.
    if (this.game) this.audio.frame(this.game, dt, !this.lifecycle.paused);
    // Сюжет: в лимбо Смотритель пишет, пока на вещь смотрят (настоящее время: при отладочной заморозке — тоже).
    if (this.komaFlow && this.screen === 'play' && !this.lifecycle.paused) this.komaFlow.frame(dt);
    // Пока идёт игра, экран не гаснет: игрок может долго стоять в темноте и слушать.
    this.awake.want(this.screen === 'play' && !this.lifecycle.paused);
    if (this.frozen || this.lifecycle.paused) return;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;
    // Замер — по настоящему времени кадра (dt выше обрезан до 0,1 с): пауза сюда не доходит, остановку страницы отсекает счётчик.
    if (this.meter.running && this.screen === 'play') this.measureTick(now - prev);

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
   * Автопонижение качества: не раньше 10 с игры и только если кадров стабильно мало. Повышать игра не повышает, и «ультра»
   * сама не включает (её выбирает только игрок). Мелкое зерно «ультра» держится строже остальных: оно — роскошь, и ради него
   * игра не должна идти рывками — ступень мелкости становится крупнее, а качество остаётся тем, что выбрал игрок. Если и на
   * самой крупной ступени (1,25) кадров так мало, как не бывает и на высоком (меньше 27 четыре секунды подряд), — высокое, с
   * тихой строкой почему, а выбор игрока снимается: качеством снова распоряжается игра (куратор, пачка 51, 325). Само решённое
   * понижение ждёт ближайшего перехода (dropTo).
   */
  private autoQuality(dt: number): void {
    const r = this.game.renderer;
    const q = r.quality;
    const fine = q === 'ultra';
    // Выбор игрока не трогаем — кроме «ультра»: её ступени игра подстраивает, а совсем не успевающую — снимает.
    if (this.qualityManual && !fine) return;
    if (this.dropTo) {
      this.dropWait += dt;
      if (this.dropWait >= DROP_WAIT) this.applyDrop();
      return;
    }
    this.playTime += dt;
    if (this.playTime < 10) return;
    const steps = fine && r.fine > 1.25 + 1e-6;
    this.slowTime = this.fps < (steps ? PROBE.fpsFloor : 27) ? this.slowTime + dt : Math.max(0, this.slowTime - dt * 2);
    if (this.slowTime < (steps ? PROBE.slowFor : 4)) return;
    this.slowTime = 0;
    this.playTime = 4;
    if (steps) {
      r.setFineCap(r.fine - 0.25);
      this.redraw();
      return;
    }
    if (fine) {
      // Выбор игрока снят: дальше качеством снова распоряжается игра (замер при следующем запуске, понижение, если и высокое
      // не успевает); включить «ультру» снова можно рукой.
      r.setFineCap(2);
      this.qualityManual = false;
      this.profile.quality = null;
      this.saveProfile();
      this.setQuality('high');
      this.hud.toast(t('toast.ultra'), 4200);
      return;
    }
    const next = q === 'high' ? 'med' : q === 'med' ? 'low' : null;
    if (!next) return;
    this.dropTo = next;
    this.dropWait = 0;
  }

  /** Понижение, решённое игрой, — сейчас (на переходе или когда ждать дольше нельзя). */
  private applyDrop(): void {
    const q = this.dropTo;
    if (!q) return;
    this.dropTo = null;
    this.dropWait = 0;
    this.slowTime = 0;
    this.playTime = 4;
    this.setQuality(q);
  }
}
