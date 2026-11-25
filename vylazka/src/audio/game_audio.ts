/**
 * Что и когда звучит: привязка звуков к событиям и состоянию игры. Движок (engine.ts) про игру
 * ничего не знает; здесь — ни одного вызова WebAudio.
 *
 * Разовые звуки приходят из событий шага симуляции, петли (эмбиент, дыхание, сердце, рой, помехи)
 * пересчитываются каждый кадр из состояния игры. Громкость петли — это и есть «слышно ли».
 */
import { clamp01 } from '../core/math';
import type { Vec3 } from '../core/types';
import type { StepEvents } from '../game';
import type { PlayOptions } from './engine';

/** Куда уходит звук: движок WebAudio в игре, записывающая заглушка в тестах. */
export interface SoundSink {
  play(id: string, opts?: PlayOptions): void;
  loop(id: string, gain: number, pos?: Vec3): void;
  stopLoops(keep?: string): void;
  setListener(pos: Vec3, yaw: number): void;
  /** Весь звук глохнет, как под водой: 0 — как есть, 1 — глуше всего (аквариум странной комнаты). Нет метода — не глохнет. */
  muffle?(k: number): void;
}

/** Что звуку нужно знать об игре (Game подходит как есть). */
export interface AudioWorld {
  light: { state: string };
  /** Осыпь; mode 'trace' — примета без тела (ступени 1–2): её песок слышен издалека. */
  swarm: { pos: Vec3; active: boolean; cohesion: number; mode?: string } | null;
  session: { inWater: boolean; inGas: boolean; panic: number; hold: number } | null;
  /** Где игрок: в убежище, в карманном пространстве или в лимбо. */
  where: string;
  /** Мир вылазки: убежище, офис или жёлтые комнаты. Нет поля — убежище. */
  world?: string;
  /** Карманное пространство, в котором сейчас игрок: по его роду выбирается тон места. */
  pocket?: { kind: string } | null;
  /** Игрок в помещении, где сквозь пол проросла трава (design.md, §36): шаги — по траве. */
  onGrass?: boolean;
  /** Игрок в тёплой сырой оранжерее (game.inGreenhouse): капель чаще и ближе — полив и испарина. Нет поля — нет. */
  inGreenhouse?: boolean;
  /**
   * Шорох травы, что тянется к свету (systems/grass.ts, RUSTLE): gain 0..1 — сколько её сейчас движется, at — где. Нет поля
   * или gain 0 — тихо.
   */
  grassRustle?: { gain: number; at: Vec3 } | null;
  /** Стирание места (systems/decay.ts): насколько ещё слышны люди, 0..1. Нет поля — слышны как есть. */
  decay?: { voices: number };
  /**
   * Ход времени места (зал ожидания, systems/flow.ts): f — насколько оно идёт, strain — насколько снимок
   * разошёлся с местом, train — тень поезда, trains — сколько поездов прошло. Нет поля — время обычное.
   */
  flow?: { f: number; strain: number; train: number; trains: number } | null;
  body: { y: number; vx: number; vz: number };
  swarmNear: number;
  staticLevel: number;
  /** Кривая ощущений за сессию (systems/feel.ts): hum — насколько густеет гул места, 0..1. Нет поля — гул как есть. */
  feelNow?: { hum: number };
  /** Где искомая вещь, когда её зов слышен (game.ts, memoryCall); null или нет поля — зова нет. */
  memoryCall?: Vec3 | null;
  /** Вид искомой вещи, когда она зовёт: у знакомых вещей вместо ровного тона — свой звук (CALL_SOUND). */
  memoryCallKind?: string | null;
  /** Тишина перед Осыпью (systems/hush.ts): насколько звук места проседает, 0..1. Нет поля — не проседает. */
  hush?: number;
  /** Стерильность места (сюжет, game.sterileK): людей не слышно, капель нет — остаётся ровный гул. Нет поля — 0. */
  sterileK?: number;
  /** Есть ли здесь у игрока фонарь (game.hasLight): в светлых местах его нет — и звуков фонаря тоже. Нет поля — есть. */
  hasLight?: boolean;
  /** Сюжет: Смотритель пишет на бирке (game.penOn). Нет поля — не пишет. */
  penOn?: boolean;
  /**
   * Странная комната (systems/odd.ts): что сейчас звучит от касания её вещи — сердце, аккорд баяна, тихие помехи телевизора, тон
   * невесомости под шариком (0..1) и насколько глохнет весь звук. До касания вещь молчит. Нет поля — ничего.
   */
  oddSound?: { heart: number; chord: number; hum: number; float: number; muffle: number } | null;
  /** Шаги в такт (systems/follower.ts): где за спиной прозвучали шаги следом с прошлого вызова. Нет поля — никто не идёт. */
  consumeFollowSteps?(): readonly Vec3[];
  listener(): { pos: Vec3; yaw: number };
  consumeFootstep(): boolean;
}

/** Экран приложения с точки зрения звука. */
export type AudioScene = 'silent' | 'menu' | 'play';

const MUSIC = 'music_menu';
/**
 * Аккорд баяна странной комнаты (K-31) — пока тем же тёмным тоном заставки, тихо: своего клипа нет.
 * TODO(звук): клип `bayan_chord` (ElevenLabs Sound Effects): «old Russian bayan button accordion, a single sustained minor chord on
 * a slow bellows exhale, about 5 seconds, warm and close, recorded at full level, no melody, no room noise» — и играть его вместо
 * music_menu разово на касании.
 */
export const BAYAN_CHORD = 0.5;
/** Тихие помехи телевизора странной комнаты (K-32) — не рёв: громкость петли signal_static в полную силу дрожи. */
export const TV_HUM = 0.32;
/** Тон невесомости под шариком (K-33) — тот же, что в белом нигде, тише. */
export const FLOAT_TONE = 0.45;
/**
 * Громкость песка Осыпи, пока она — примета без тела (ступени 1–2, K-18): слышна только издалека — затихает и глохнет
 * с расстоянием (движок звука), поэтому чуть громче рассеянной Осыпи рядом, но не как охота.
 */
export const TRACE_SAND = 0.8;
/** Насколько ветер луга приседает под полным шорохом травы. */
export const RUSTLE_DUCK = 0.45;
/** Капель оранжереи: средняя пауза, с; на каком расстоянии в среднем, м (разброс ±1,25 — от 1,5 до 4); во сколько выше тон; громкость. */
export const GREEN_DRIP = { every: 2.4, near: 2.75, rate: 1.25, volume: 0.7 } as const;
/** Громкость зова искомой вещи (still_tone из её места; затухание по расстоянию — у движка). */
const MEMORY_CALL = 0.7;
/** Свой звук искомой вещи по её виду; вещь без знакомого звука (ключ, билет, шляпа) зовёт ровным тоном. */
export const CALL_SOUND: Readonly<Record<string, string>> = { kettle: 'call_kettle', alarm_clock: 'call_clock', office_clock: 'call_clock', water_cooler: 'call_cooler', office_terminal: 'call_terminal' };
const CALL_IDS: readonly string[] = [...new Set(Object.values(CALL_SOUND))];
/**
 * Телефон звонит один раз за поиск, дальше зовёт ровным тоном: канон KOMA (§8) запрещает повторяющийся звонок как подсказку
 * (разбор куратора, противоречие 419). Сколько секунд после звонка ровный тон ещё молчит — пока звучит сам звонок.
 */
export const CALL_ONCE: Readonly<Record<string, string>> = { desk_phone: 'call_phone' };
const CALL_ONCE_HUSH = 5.5;
/**
 * Тишина перед Осыпью (systems/hush.ts): насколько глубоко проседает гул места при полной тишине. Не до нуля: совсем пустой
 * звук читался бы поломкой (S-06); капли не проседают почти вовсе — их хвост и держит «это тишина, а не сбой».
 */
export const HUSH_DEPTH = 0.94;
/** Шаги в такт: тот же клип, что у игрока, — тише и ниже (тяжелее). */
export const FOLLOW_VOLUME = 0.42;
export const FOLLOW_RATE = 0.86;

/** Что грузить раньше остального: первые секунды вылазки и экран задания. */
export const LOAD_FIRST: readonly string[] = ['ui_click', 'ui_start', 'hatch', 'lift', 'amb_bunker', 'amb_office', 'amb_yellow', 'amb_station', 'still_tone', 'breath_calm', 'step_concrete', 'step_carpet', 'flash_click', 'flash_die', 'flash_rattle', 'flash_spark', 'music_menu'];

/** Гул места — звук, с которого место начинается. */
export const PLACE_TONE: Readonly<Record<string, string>> = { shelter: 'amb_bunker', office: 'amb_office', yellow: 'amb_yellow', station: 'amb_station' };

/**
 * Порядок загрузки для места: сначала то, что прозвучит в первую секунду именно здесь (нажатие «старт», гул места,
 * люк или лифт, шаги, дыхание, разговор за стеной), потом остальное из LOAD_FIRST. Гул чужого места раньше своего
 * (как было: убежище, офис, жёлтые, зал) задерживал звук на секунды там, где сеть медленная (партнёр 17.11:
 * «звук не срабатывает сразу»).
 */
export function loadFirst(world: string): string[] {
  const place = PLACE_TONE[world] ? world : 'shelter';
  const arrival = place === 'shelter' ? ['hatch'] : place === 'station' ? ['still_tone'] : ['lift'];
  const steps = place === 'shelter' ? 'step_concrete' : 'step_carpet';
  const head = ['ui_start', PLACE_TONE[place]!, ...arrival, 'ui_click', 'flash_click', 'breath_calm', steps, 'voices_murmur'];
  return [...head, ...LOAD_FIRST.filter((id) => !head.includes(id))];
}

/**
 * Следы людей (слова партнёра: «лёгкий фоновый шёпот, смех, тихий неразличимый разговор людей»).
 * Это не пугалки и не события: так звучит место, в котором кто-то жил. Что слышно — зависит от места:
 * в убежище — дом (смешок, напев), в офисе — работа (чужой телефон, оклик), в жёлтых комнатах никого —
 * только где-то звонит телефон; на лугу — смех издалека. В белом нигде, домике и лимбо людей нет.
 */
const VOICES: Readonly<Record<string, readonly string[]>> = {
  shelter: ['voices_giggle', 'voices_hum', 'voices_laugh', 'voices_call'],
  office: ['phone_far', 'voices_laugh', 'voices_call', 'voices_hum'],
  yellow: ['phone_far'],
  // Зал ожидания: кого-то окликают, где-то звонит таксофон.
  station: ['voices_call', 'phone_far', 'voices_hum'],
  meadow: ['voices_laugh', 'voices_giggle', 'voices_hum'],
};
/** Насколько слышен разговор за стеной: офис полон людей, жёлтые комнаты почти пусты. */
const MURMUR: Readonly<Record<string, number>> = { shelter: 0.55, office: 0.8, yellow: 0.3, station: 0.6 };

/**
 * Явь — записи партнёра («Добавь эти звуки в игру»): проходящий мотор и тихая улица с далёким напевом.
 * Это не звуки сна, а то, что доходит до спящего снаружи: изредка, издалека и глухо. Чем сильнее место
 * стёрто, тем чаще (сон истончается); в лимбо, на самой границе пробуждения, — каждый раз. По очереди.
 */
export const WAKING: readonly string[] = ['wake_street', 'wake_pass'];
/** Через сколько секунд вылазки явь слышна впервые и как часто потом (в целом месте; в стёртом — вдвое чаще). */
export const WAKE_FIRST = 95;
export const WAKE_EVERY = 170;

export class GameAudio {
  /** Сколько поездов уже слышали (зал ожидания). */
  private trains = 0;
  private scene: AudioScene = 'silent';
  private rattleAt = 0;
  private crankAt = 0;
  private dripAt = 6;
  private voiceAt = 18;
  private voiceAngle = 0;
  private wakeAt = WAKE_FIRST;
  private wakeN = 0;
  private count = 0;
  private clock = 0;
  private holding = false;
  /** Какой поиск уже отзвонил (вид вещи и её место) и когда. */
  private rang: string | null = null;
  private rangAt = -99;

  constructor(readonly engine: SoundSink) {}

  /** Небольшой разброс высоты тона, чтобы повторы не звучали одинаково. Свой счётчик, не Math.random. */
  private jitter(spread: number): number {
    this.count = (Math.imul(this.count, 1103515245) + 12345) >>> 0;
    return 1 + ((this.count >>> 8) / 16777216 - 0.5) * 2 * spread;
  }

  /** Звук интерфейса (нажатие в меню). */
  ui(id: 'ui_click' | 'ui_start' | 'ui_report'): void {
    this.engine.play(id);
  }

  /** Сменить экран: в меню играет музыка, в вылазке — только мир. */
  setScene(scene: AudioScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    if (scene !== 'play') this.engine.stopLoops(MUSIC);
  }

  /** Начало вылазки: в убежище над головой закрывается люк, в офисе и жёлтых комнатах привозит лифт; камера пишет. */
  sortieStart(resumed: boolean, world = 'shelter'): void {
    // Первое нажатие в игре — оно же старт: эти два звука готовы подождать свой файл.
    this.engine.play('ui_start', { late: 2 });
    // В зал ожидания входят с улицы: ни люка, ни лифта.
    if (!resumed && world !== 'station') this.engine.play(world === 'shelter' ? 'hatch' : 'lift', { volume: 0.9, late: 4 });
    this.dripAt = 5;
    this.voiceAt = 18;
    this.clock = 0;
  }

  /** Случайное целое 0…n−1 тем же счётчиком, что и разброс тона. */
  private pick(n: number): number {
    return Math.min(n - 1, Math.floor((this.jitter(0.5) - 0.5) * n));
  }

  /** Явь: следующая запись по очереди, на расстоянии r и чуть выше головы — глухо, будто из-за стены сна. */
  private wake(ears: { pos: Vec3; yaw: number }, r: number): void {
    const id = WAKING[this.wakeN % WAKING.length]!;
    this.wakeN += 1;
    const angle = this.jitter(0.5) * Math.PI * 4;
    this.engine.play(id, { pos: [ears.pos[0] + Math.cos(angle) * r, ears.pos[1] + 1.5, ears.pos[2] + Math.sin(angle) * r] });
  }

  /** События шага симуляции → разовые звуки. */
  onStep(ev: StepEvents, game: AudioWorld): void {
    const a = this.engine;
    // В светлом месте (офис, жёлтые комнаты днём, зал ожидания) фонаря нет: ни щелчка, ни тряски, ни треска (партнёр 24.11).
    if (game.hasLight !== false) {
      if (ev.lightToggled) a.play('flash_click', { rate: this.jitter(0.04) });
      // Нажатие по заглохшему фонарю — стук по корпусу (батарейки брякнули), не щелчок: свет от него не загорится.
      else if (ev.lightKnock) a.play('flash_rattle', { rate: this.jitter(0.08) * 0.7, volume: 0.8 });
      if (ev.lightFailed) a.play('flash_die');
      if (ev.lightRevived) a.play('flash_click', { rate: 1.12, volume: 1.1 });
      if (ev.spark) a.play('flash_spark', { rate: this.jitter(0.1) });
      // Зарядка удержанием (телефон): треск динамо всё выше, пока заряд растёт; полный — щелчок и искра вспышки.
      if (ev.crank >= 0 && this.clock >= this.crankAt) {
        this.crankAt = this.clock + 0.13;
        a.play('flash_rattle', { rate: 0.8 + 0.6 * ev.crank, volume: 0.55 });
      }
      if (ev.lightCharged) {
        a.play('flash_click', { rate: 0.92, volume: 1.2 });
        a.play('flash_spark', { rate: 0.75 });
      }
      // Тряска: батарейки гремят на каждый рывок, но не чаще восьми раз в секунду.
      if (ev.strokes > 0 && this.clock >= this.rattleAt) {
        this.rattleAt = this.clock + 0.12;
        a.play('flash_rattle', { rate: this.jitter(0.08), volume: game.light.state === 'dead' ? 1 : 0.6 });
      }
    }

    for (const e of ev.session) {
      // Вспышка воспоминания — нарастающий тон камеры; «вспомнил» — её писк.
      if (e.type === 'reveal') a.play('camera_hold');
      else if (e.type === 'recall') a.play('camera_beep');
      else if (e.type === 'collapse') a.play('collapse', { pos: e.spec.center });
      else if (e.type === 'cough') a.play('cough', { rate: this.jitter(0.05) });
      else if (e.type === 'fall') a.play('fall');
    }
    for (const e of ev.dream) {
      // Скачок: кадр выбеливается — нарастающий шум; рывок — искра в момент, когда место сменилось.
      // Новая сессия начинается, как первая: люком или лифтом.
      if (e.type === 'jump' && e.phase === 'start' && e.plan.style === 'whiteout') a.play('whiteout');
      // Шов песчаного зала — без следа: ни искры, ни щелчка; зал слышно сразу своим гулом.
      else if (e.type === 'jump' && e.phase === 'switch' && e.plan.style !== 'whiteout' && e.plan.style !== 'seam') a.play('flash_spark', { rate: 0.7, volume: 0.8 });
      else if (e.type === 'limbo') {
        a.play('ui_report');
        this.wake(game.listener(), 7);
      }
      else if (e.type === 'begin') a.play((game.world ?? 'shelter') === 'shelter' ? 'hatch' : 'lift', { volume: 0.8 });
      // Белая комната: задел цепь — звенья звякают и раскачиваются; мир уходит в широкий угол с тем же светлым шумом, что
      // выбеливание кадра, только тише и ниже.
      else if (e.type === 'warp') {
        a.play('chain_clink', { rate: this.jitter(0.06) });
        a.play('whiteout', { rate: 0.72, volume: 0.45 });
      }
      // Странная комната: тронул стекло аквариума — одна тяжёлая капля, низко; остальное (сердце, аккорд, помехи, тон, глухота) —
      // петлями по ходу ощущения (frame).
      else if (e.type === 'odd' && e.kind === 'aquarium') a.play('drip', { rate: 0.55, volume: 0.9 });
      // Волна сонара — тихий пинг от самого игрока (слова партнёра: «Сонар тихий пинг»).
      else if (e.type === 'sonar') a.play('sonar_ping', { rate: this.jitter(0.03) });
      // Экспонат в лимбо вспомнил обрывок (метаслой): тот же нарастающий тон камеры, что у вспышки воспоминания, ниже.
      else if (e.type === 'meta') a.play('camera_hold', { rate: 0.85, volume: 0.8 });
      // Всё иллюзорно: тронутая вещь рассыпается в пыль, после темноты собирается из неё.
      else if (e.type === 'touch') a.play(e.what === 'gone' ? 'dissolve' : 'assemble', { rate: this.jitter(0.1), volume: e.what === 'gone' ? 1 : 0.7 });
      // Фигура партнёра: тот же распад и сборка, что у вещей, но с её места; дым — ниже и тише.
      else if (e.type === 'figure') a.play(e.what === 'gone' ? 'dissolve' : 'assemble', { pos: e.at, rate: e.material === 'smoke' ? 0.78 : this.jitter(0.1), volume: e.material === 'smoke' ? 0.55 : e.what === 'gone' ? 0.9 : 0.6 });
      // Птица сорвалась с места — хлопки крыльев оттуда, где она сидела; воркование — редкое и тихое.
      else if (e.type === 'bird') a.play(e.what === 'takeoff' ? 'bird_wings' : 'bird_coo', { pos: e.at, rate: this.jitter(0.08) });
      // Давление: пол пошёл — гул обвала издалека; потолок двинулся — тот же гул ниже и глуше; падение.
      else if (e.type === 'pressure') {
        if (e.what === 'start') a.play('collapse', { pos: e.at, rate: e.kind === 'squeeze' ? 0.55 : 0.85, volume: e.kind === 'squeeze' ? 0.8 : 0.6 });
        else if (e.what === 'fall') a.play('fall');
      }
    }

    const swarmPos = game.swarm?.pos;
    for (const e of ev.fear) {
      if (e.type === 'scare') {
        // Мигание — искра в самом фонаре; у вспыхнувших надписей звука нет: тишина страшнее.
        if (e.id === 'flicker') a.play('flash_spark', { volume: 0.7 });
        else if (e.id !== 'signs') a.play(`scare_${e.id}`, e.pos ? { pos: e.pos, rate: this.jitter(0.06) } : {});
      } else if (e.what === 'cohered') a.play('swarm_cohere', swarmPos ? { pos: swarmPos } : {});
      else if (e.what === 'scattered') a.play('swarm_scatter', swarmPos ? { pos: swarmPos } : {});
      else if (e.what === 'caught') a.play('swarm_catch');
      else if (e.what === 'apparition') a.play('swarm_cohere', swarmPos ? { pos: swarmPos, volume: 0.45, rate: 0.85 } : { volume: 0.2 });
    }
  }

  /** Кадр: слушатель, шаги, петли. dt — реальное время кадра; active — идёт ли симуляция. */
  frame(game: AudioWorld, dt: number, active: boolean): void {
    const a = this.engine;
    if (this.scene === 'menu') {
      a.loop(MUSIC, 1);
      return;
    }
    // Баян странной комнаты тянет аккорд, пока комната выдыхает (BAYAN_CHORD).
    const odd = this.scene === 'play' && game.where === 'main' ? (game.oddSound ?? null) : null;
    a.loop(MUSIC, odd ? BAYAN_CHORD * odd.chord : 0);
    // Аквариум: весь звук глохнет, как под водой.
    a.muffle?.(odd ? odd.muffle : 0);
    if (this.scene !== 'play') return;

    const ears = game.listener();
    a.setListener(ears.pos, ears.yaw);
    const s = game.session;
    // В карманных пространствах и в лимбо убежища не слышно.
    const over = game.where !== 'main';
    const b = game.body;
    this.clock += dt;

    // Шаги — по тому, что под ногами: бетон убежища, вода, ковролин офиса и жёлтых комнат, трава луга и помещения, где она
    // проросла сквозь пол, песок песчаного зала. В белом нигде, в домике и в лимбо шагов не слышно.
    const place = game.world ?? 'shelter';
    const pocket = game.where === 'pocket' ? (game.pocket?.kind ?? '') : '';
    const stepId = !over ? (s?.inWater ? 'step_water' : game.onGrass ? 'step_grass' : place === 'shelter' ? 'step_concrete' : 'step_carpet') : pocket === 'meadow' || pocket === 'sunfield' ? 'step_grass' : pocket === 'dunes' ? 'step_sand' : null;
    const speed = Math.hypot(b.vx, b.vz);
    if (game.consumeFootstep() && active && stepId) a.play(stepId, { rate: this.jitter(0.07), volume: 0.55 + Math.min(0.45, speed / 9) });
    // Шаги в такт: за спиной, там, где игрок сам прошёл несколько шагов назад, — тот же шаг тише и ниже.
    const behind = game.consumeFollowSteps?.() ?? [];
    if (active && !over && stepId) for (const p of behind) a.play(stepId, { pos: p, rate: this.jitter(0.05) * FOLLOW_RATE, volume: FOLLOW_VOLUME * (0.55 + Math.min(0.45, speed / 9)) });

    // Игрок всматривается в искомую вещь: камера наводится.
    const holding = !over && (s?.hold ?? 0) > 0;
    if (holding && !this.holding) a.play('camera_hold');
    this.holding = holding;

    // Глубина 0…1: на нижних ярусах гул убежища сменяется давящим.
    const depth = clamp01(-b.y / 9);
    const panic = s?.panic ?? 0;
    const near = game.swarmNear;
    // Тишина перед Осыпью: гул места, зов вещи, разговор за стеной и шорох травы проседают почти в ноль; далёкие голоса и явь
    // ждут; капли — почти нет (хвост: это тишина, а не сбой звука). Дыхание и сердце — свои, они не стихают.
    const hush = over ? 0 : clamp01(game.hush ?? 0);
    const quiet = 1 - HUSH_DEPTH * hush;
    // Вне убежища его звуки стихают; помехи остаются.
    // Замершее место (сюжет): тон места проседает под мёртвым воздухом — живого в нём остаётся треть.
    const dead = over ? 0 : clamp01(game.sterileK ?? 0);
    const live = over ? 0 : quiet * (1 - 0.65 * dead);
    // Тон места: у каждого мира и у каждого пространства свой.
    // Кривая ощущений (K-11): к концу сессии гул места густеет — в убежище в него вплетается нижний, давящий.
    const hum = over ? 0 : (game.feelNow?.hum ?? 0);
    const deep = Math.max(depth, 0.6 * hum);
    a.loop('amb_bunker', place === 'shelter' ? live * (1 - deep * 0.7) : 0);
    a.loop('amb_deep', place === 'shelter' ? live * deep : 0);
    a.loop('amb_office', place === 'office' ? live * (1 + 0.4 * hum) : 0);
    a.loop('amb_yellow', place === 'yellow' ? live * (1 + 0.4 * hum) : 0);
    // Зал ожидания: на ходу — шум зала; встал — он уходит в один ровный тон (запись партнёра), а когда
    // снимок расходится с местом, тон начинает дрожать. Поезд слышно, когда он проходит за окнами.
    const fl = !over && place === 'station' ? (game.flow ?? null) : null;
    const moving = fl ? fl.f : 1;
    a.loop('amb_station', place === 'station' ? live * (0.2 + 0.8 * moving) : 0);
    // Искомая вещь зовёт (плейтест партнёра 19.11: «куда идти»; квиз — «Звук, свечение, цель»): тот же ровный тон (запись
    // партнёра) звучит из её места — издалека тихо и глухо, на подходе громче, с той стороны, где она. В зале ожидания тон
    // значит «стой», и там он — прежний, без места.
    const call = !over && !fl ? (game.memoryCall ?? null) : null;
    if (fl) a.loop('still_tone', live * (1 - moving) * (1 - 0.45 * fl.strain * (0.5 + 0.5 * Math.sin(this.clock * 21))));
    else {
      // Знакомая вещь зовёт своим звуком (партнёр 24.11: «если нужно найти чайник, пусть появится его звук посвистывания. Так и
      // с остальными главными предметами, которые могут издавать знакомые звуки»); у остальных — прежний ровный тон.
      const own = call ? (CALL_SOUND[game.memoryCallKind ?? ''] ?? null) : null;
      const once = call ? (CALL_ONCE[game.memoryCallKind ?? ''] ?? null) : null;
      if (call && once) {
        const key = `${game.memoryCallKind}:${call.map((v) => v.toFixed(1)).join(',')}`;
        if (this.rang !== key && live > 0) {
          a.play(once, { pos: call, volume: MEMORY_CALL });
          this.rang = key;
          this.rangAt = this.clock;
        }
      }
      const ringing = once !== null && this.clock - this.rangAt < CALL_ONCE_HUSH;
      a.loop('still_tone', call && !own && !ringing ? live * MEMORY_CALL : 0, call ?? undefined);
      for (const id of CALL_IDS) a.loop(id, call && own === id ? live * MEMORY_CALL : 0, call ?? undefined);
    }
    if (fl && fl.trains !== this.trains) {
      if (fl.trains > this.trains && active) a.play('train_pass', { volume: 0.9 });
      this.trains = fl.trains;
    }
    // Трава тянется к лучу (в светлом месте — к взгляду) и шуршит, пока движется: свет лёг — всплеск, стоит — стихает за три-четыре
    // секунды, ведут — шелест идёт за ним; распрямляется почти беззвучно. Звук — оттуда, где она движется (партнёр 20.11: «сделай
    // шорох травы»). Трава — у помещения места и на лугу. Шорох не спорит с песком Осыпи (разбор куратора 20.11): рядом с ней трава
    // замирает (game.ts, GRASS_HUSH), а в панике, когда дрожит рука с фонарём, шорох уходит — слушать надо её.
    const rustle = game.grassRustle;
    const grassHere = !over || pocket === 'meadow' || pocket === 'sunfield';
    const grassHush = clamp01(1 - near * 2) * (1 - 0.8 * clamp01((panic - 0.3) / 0.5));
    const heard = rustle && grassHere ? rustle.gain * grassHush * quiet : 0;
    a.loop('grass_rustle', heard, rustle?.at);
    // Ветер луга приседает под шорохом: трава отвечает свету, и мир на миг затихает (предложение куратора).
    a.loop('amb_meadow', pocket === 'meadow' || pocket === 'sunfield' ? 1 - RUSTLE_DUCK * heard : 0);
    // Песчаный зал: низкий полый ветер под высоким потолком — свой гул вместо тона белого нигде.
    a.loop('amb_dunes', pocket === 'dunes' ? 1 : 0);
    // Под шариком, пока невесомость, слышен тот же тон пустоты, что в белом нигде, — тише.
    a.loop('amb_void', over && pocket !== 'meadow' && pocket !== 'sunfield' && pocket !== 'dunes' ? 1 : odd ? FLOAT_TONE * odd.float : 0);
    const body = over ? 0 : 1;
    a.loop('breath_calm', body * clamp01(1 - panic * 2.2));
    a.loop('breath_panic', body * clamp01((panic - 0.3) / 0.45));
    a.loop('heartbeat', body * clamp01(Math.max((panic - 0.35) / 0.5, near * 1.2, odd ? odd.heart : 0)));
    a.loop('gas_hiss', s?.inGas ? body : 0);
    a.loop('signal_static', clamp01(Math.max(game.staticLevel * 1.4, odd ? TV_HUM * odd.hum : 0)));
    const sw = game.swarm;
    // Примета без тела — громче, чем рассеянная Осыпь рядом: её слышно только издалека (затухание по расстоянию даёт
    // звук), и это единственное, что от неё есть, кроме грибов в углах.
    if (sw?.active && !over) a.loop('swarm_loop', sw.mode === 'trace' ? TRACE_SAND : 0.55 + 0.45 * sw.cohesion, sw.pos);
    else a.loop('swarm_loop', 0);

    // Следы людей. Разговор за стеной слышен, пока спокойно; чем ближе Осыпь и чем сильнее паника,
    // тем он тише — и тем громче шёпот: тревога заглушает память о людях и говорит вместо неё.
    // Следы людей слышны в покое — и только пока место помнится: в стёртом месте никого не остаётся.
    const settled = clamp01(1 - panic * 1.5) * clamp01(1 - near * 2.5);
    const sterile = over ? 0 : clamp01(game.sterileK ?? 0);
    // Мёртвый воздух замершего места: ровный гул ламп, в котором ничего не меняется. Чем место стерильнее, тем он громче.
    a.loop('sterile_air', over ? 0 : quiet * sterile);
    a.loop('koma_pen', game.penOn ? 1 : 0);
    const calm = settled * (game.decay?.voices ?? 1) * (1 - sterile);
    this.voiceAngle += dt * 0.05;
    const behindWall: Vec3 = [ears.pos[0] + Math.cos(this.voiceAngle) * 7, ears.pos[1], ears.pos[2] + Math.sin(this.voiceAngle) * 7];
    a.loop('voices_murmur', live * (MURMUR[place] ?? 0.5) * calm, behindWall);
    a.loop('voices_whisper', body * clamp01(near * 1.6 + Math.max(0, panic - 0.45) * 1.2));
    // Смех, напев, оклик, чужой телефон: изредка и издалека, только пока спокойно.
    if (active && this.clock >= this.voiceAt) {
      const list = VOICES[over ? pocket : place] ?? [];
      const rare = place === 'yellow' && !over ? 1.8 : 1;
      this.voiceAt = this.clock + (22 + 20 * (this.jitter(0.5) - 1)) * rare;
      if (list.length > 0 && calm > 0.6 && hush < 0.2) {
        const angle = this.jitter(0.5) * Math.PI * 4;
        const r = 9.5 + 5 * (this.jitter(0.5) - 1);
        a.play(list[this.pick(list.length)]!, { pos: [ears.pos[0] + Math.cos(angle) * r, ears.pos[1], ears.pos[2] + Math.sin(angle) * r], rate: this.jitter(0.04) });
      }
    }

    // Явь сквозь сон: редко, издалека, только пока спокойно; в стёртом месте — чаще.
    if (active && !over && this.clock >= this.wakeAt) {
      const thin = 1 - clamp01(game.decay?.voices ?? 1);
      this.wakeAt = this.clock + (WAKE_EVERY + 80 * (this.jitter(0.5) - 1)) * (1 - 0.5 * thin);
      // Явь — не память места: стёртость её не глушит (людей нет, а улица слышна); глушат паника и Осыпь.
      if (settled > 0.6 && hush < 0.2) this.wake(ears, 11);
    }

    // Капли: в убежище — редкий одиночный звук откуда-то из темноты; глубже — чаще. В оранжерее (убежища и офиса) — капель
    // с листьев и стекла: втрое чаще и рядом, капли мельче (выше тоном).
    const wet = !over && game.inGreenhouse === true;
    if (active && !over && (place === 'shelter' || wet) && sterile < 0.5 && this.clock >= this.dripAt) {
      const k = this.jitter(0.5);
      this.dripAt = this.clock + (wet ? GREEN_DRIP.every * (0.6 + 0.8 * (k - 0.5)) : (5 + 9 * (k - 0.5)) * (1 - depth * 0.4));
      const angle = this.jitter(0.5) * Math.PI * 4;
      const r = wet ? GREEN_DRIP.near + 2.5 * (this.jitter(0.5) - 1) : 4 + 6 * (this.jitter(0.5) - 0.5);
      const pos: Vec3 = [ears.pos[0] + Math.cos(angle) * r, ears.pos[1] - 1.2, ears.pos[2] + Math.sin(angle) * r];
      a.play('drip', { pos, rate: this.jitter(0.12) * (wet ? GREEN_DRIP.rate : 1), volume: (1 - 0.35 * hush) * (wet ? GREEN_DRIP.volume : 1) });
    }
  }
}
