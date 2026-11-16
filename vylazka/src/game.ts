/**
 * Игра: симуляция фиксированным шагом и сборка кадра. Здесь сходятся контроллер, нагрудная камера,
 * фонарь, детектор тряски, сессия (воспоминания, среда, паника), вещи, меняющиеся под взглядом,
 * скачки между пространствами и рендер. Экраны, пауза и ввод — в app.ts.
 *
 * Игрок только ходит, смотрит и светит. Смерти нет: провал, газ и рой выбрасывают его в другое место.
 */
import { approach, clamp, lerp, smoothstep } from './core/math';
import { hash01, hash2, mulberry32 } from './core/rng';
import type { Rng } from './core/rng';
import type { Vec3 } from './core/types';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from './player/controller';
import type { PlayerBody } from './player/controller';
import type { InputFrame } from './player/input';
import { CameraRig, dirFromAngles } from './player/rig';
import type { RigOutput } from './player/rig';
import { ShakeMeter } from './player/shake';
import { AutoExposure, beamAtten } from './render/exposure';
import { GRADE_DEFAULT } from './render/grade';
import type { Grade } from './render/grade';
import type { FrameView, GameRenderer } from './render/renderer';
import { nodesInRange, SwarmAI } from './swarm/ai';
import { SwarmBody } from './swarm/body';
import { Anomalies } from './systems/anomalies';
import type { AnomalyEvent, AnomalyState } from './systems/anomalies';
import { CellLights } from './systems/cell_lights';
import { Director } from './systems/director';
import { behindness, Echo, ECHO_DRIFT, ECHO_STEP } from './systems/echo';
import type { ScareId } from './systems/director';
import { DEFAULT_FLASHLIGHT, Flashlight } from './systems/flashlight';
import type { FlashlightConfig } from './systems/flashlight';
import { Jumps } from './systems/jumps';
import type { JumpPlan, JumpStyle } from './systems/jumps';
import { DEFAULT_SESSION, MEMORY_THINGS, Session } from './systems/session';
import type { SessionConfig, SessionEvent } from './systems/session';
import { decayAt, keepsClutter, startForm, WEAR } from './systems/decay';
import type { Decay } from './systems/decay';
import { DEFAULT_ILLUSIONS, FORM_GONE, FORM_LACE, FORM_REAL, Illusions, worse } from './systems/illusions';
import { BIRD_STRIDE, BIRDS_MAX, DEFAULT_BIRDS, Flock, flockSize, Leaver, packBird } from './systems/birds';
import type { Perch } from './systems/birds';
import { Flow } from './systems/flow';
import { Pressure } from './systems/pressure';
import type { PressureKind, PressureRoom } from './systems/pressure';
import { Spores } from './systems/spores';
import type { Comeback, ComebackOptions, Form, Mount } from './systems/illusions';
import { Figures } from './systems/figures';
import type { FigureLive } from './systems/figures';
import { looksAt, Things } from './systems/things';
import type { Fate, Look, Thing } from './systems/things';
import { bakeContact } from './world/contact';
import { ColliderSet } from './world/colliders';
import type { Aabb } from './world/colliders';
import { DOOR_NAME } from './world/screens';
import type { LevelObject } from './world/objects';
import { ALL_PROPS } from './world/props_all';
import { CEIL_H, DX, DZ } from './gen/layout';
import type { WorldKind } from './gen/layout';
import type { BuiltLevel } from './world/level';
import { figureMesh } from './world/figure_mesh';
import type { FigureMaterial, FigureSpec } from './world/figures';
import { FIGURES } from './world/figures_data';
import { ceilTileOf, cellToWorld, STAIR_RISE, STAIR_RUN, STAIR_STEPS, tierFloor } from './world/level_build';
import { CELL } from './world/shell';
import { buildPocket, ENV_BUNKER, WORLD_ENV } from './world/pockets';
import type { Env, ModelCell, PocketContext, PocketKind, PocketSpace } from './world/pockets';
import { formMesh } from './world/forms';
import { thingMesh } from './world/thing_mesh';
import { MEM_LIGHT_KIND, memLightStep, memoryLightOf } from './world/memory_light';
import type { MemLightDef } from './world/memory_light';

export const STEP = 1 / 60;
const WALK_SPEED = 2.3;
const RUN_SPEED = 4.3;
/** В воде идут медленнее. */
const WATER_SPEED = 0.62;
const MAX_PITCH = 1.2;
/** Смещения лучей по ореолу фонаря для оценки яркости кадра: рыскание и тангаж, рад. */
const EXPOSURE_RAYS: readonly (readonly [number, number])[] = [
  [0.2, 0],
  [-0.2, 0],
  [0, 0.17],
  [0, -0.17],
];

/** События страха: для звука и интерфейса. */
/** pos у пугалки — откуда она слышна; без него звук идёт «из рации» или его нет вовсе. */
export type FearEvent = { type: 'scare'; id: ScareId; pos?: Vec3 } | { type: 'swarm'; what: 'apparition' | 'release' | 'cohered' | 'scattered' | 'caught' };

/** Где сейчас игрок: в убежище, в карманном пространстве или в лимбо между сессиями. */
export type Where = 'main' | 'pocket' | 'limbo';

/** Особенность помещения: стробоскоп, полная темнота, красная сетка, «тонкое место» (рассыпается под ногами). */
export type RoomFx = 'strobe' | 'dark' | 'wire' | 'thin';

/** События сна: скачки, превращения вещей, смена сессий. */
export type DreamEvent =
  | { type: 'jump'; plan: JumpPlan; phase: 'start' | 'switch' }
  /** Птица сорвалась с места (systems/birds.ts): хлопок крыльев там, где она сидела; coo — воркует сидящая. */
  | { type: 'bird'; what: 'takeoff' | 'coo'; at: Vec3 }
  | { type: 'thing'; thing: Thing; what: 'changing' | 'settled' }
  /**
   * Всё иллюзорно: gone — игрок коснулся вещи, и она растворяется (first — это первое касание за
   * вылазку); back — свет погас и зажёгся, и вещь вернулась: той же (same), другой (kind) или в
   * другом месте (place).
   */
  /**
   * Коснулись вещи (gone), она вернулась (back; form — на какой ступени: 1 — картонка, 2 — проекция,
   * 3 — кружево; moved — встала на другое место) или стёрта совсем и больше не вернётся (erased).
   */
  | { type: 'touch'; name: string; what: 'gone' | 'back' | 'erased'; first?: boolean; how?: Comeback['how']; form?: number; moved?: boolean }
  /**
   * Карманное пространство сделало своё дело: enter — игрок вошёл; map — прочёл макет в кукольном домике
   * (room и tier — где лежит искомое; без memory — искать пока нечего); next — в белом нигде вызвал следующее
   * воспоминание; remind — там же напомнил себе, что ищет; replay — перечитал вспомненное.
   */
  | { type: 'pocket'; kind: PocketKind; what: 'enter' | 'map' | 'next' | 'remind' | 'replay'; memory?: string; room?: string; tier?: number }
  /**
   * Давление помимо Осыпи (systems/pressure.ts): start — событие началось (пол пошёл сеткой, потолок
   * двинулся); fall — пол ушёл из-под ног; woke — не успел и проснулся в начале.
   */
  | { type: 'pressure'; kind: PressureKind; what: 'start' | 'fall' | 'woke'; at: Vec3 }
  /** Сессия кончилась, игрок в лимбо: пора готовить следующую (queueSession). */
  | { type: 'limbo' }
  /** От игрока пошла волна сонара (вариант A): звук — тихий пинг (слова партнёра: «Сонар тихий пинг»). */
  | { type: 'sonar' }
  /**
   * Фигура партнёра ушла (дымная рассеялась при подходе, волосатая растворилась от рук к телу, другая —
   * от касания) или вернулась (systems/figures.ts).
   */
  | { type: 'figure'; id: string; material: FigureMaterial; what: 'gone' | 'back'; at: Vec3 }
  /** Началась новая сессия; scene — не сессия, а следующая сцена того же сна (другое место). */
  | { type: 'begin'; scene?: boolean };

export interface StepEvents {
  lightFailed: boolean;
  lightRevived: boolean;
  /** Игрок щёлкнул выключателем фонаря. */
  lightToggled: boolean;
  spark: boolean;
  /** Засчитанных ходов тряски за шаг (для вибрации и звука дребезга). */
  strokes: number;
  fellOut: boolean;
  /** События сессии: воспоминания, обвалы, газ. */
  session: SessionEvent[];
  /** Пугалки и рой. */
  fear: FearEvent[];
  dream: DreamEvent[];
}

/** Что нужно, чтобы начать сессию на уровне: сид и то, что игрок уже вспоминал раньше. */
export interface DreamSeed {
  seed: number;
  known: ReadonlySet<string>;
  /** Сон из сцен: с какой вещи цепочки места начать (Session, start). */
  chainAt?: number;
}

interface Transition {
  plan: JumpPlan;
  t: number;
  /** Длительность ухода и прихода, с. */
  out: number;
  back: number;
  switched: boolean;
}

/** Сколько длится уход из места и приход в новое, с. */
/**
 * Смена деталей в темноте: через сколько секунд без света она случается первый раз (за это время
 * место успевает раствориться — см. SCAN.hold в рендере), как часто повторяется и как далеко достаёт, м.
 */
const DARK_SHIFT = { first: 7, every: 9, range: 14 } as const;
/** Сколько воспоминаний нужно, чтобы фигура Осыпи выросла в полный рост. */
const SWARM_GROWN = 4;
/** Сколько гроздей грибов показывается разом (ближайшие к игроку). */
const SPORES_SHOWN = 220;
/** Угол сетки уровня в мире (x, z): клетка 0 лежит в 8 клетках от начала координат, клетка — 3 м. */
const CELL_ORIGIN: [number, number] = [-25.5, -25.5];
/** С какого расстояния слышно Осыпь (от неё идут волны эха), м. */
const ECHO_HEAR = 24;
/** Сила эха при свете: без света оно видно в полную силу, со светом — лишь за краем луча. */
const ECHO_LIT = 0.35;
/**
 * Призрак Осыпи из-за спины: half — половина поля зрения, рад (дальше от оси — «за спиной»);
 * range — докуда он виден, м; open и hidden — плотность, когда между игроком и ней нет стены и когда есть.
 */
const GHOST = { half: 0.9, range: 16, open: 0.6, hidden: 0.3 } as const;
/** Течение Осыпи к искомой вещи после проявки: сколько секунд длится, с какой скоростью идёт и как далеко уходит, м. */
const SWARM_FLOW = { time: 3, speed: 3.2, reach: 8.5 } as const;

/** Точка на ломаной в s метрах от её начала (дальше конца — сам конец). */
function pointAlong(path: readonly Vec3[], s: number): Vec3 {
  let left = s;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (left <= d && d > 1e-6) {
      const k = left / d;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    left -= d;
  }
  return [...path[path.length - 1]!];
}

const TIMING: Record<JumpStyle, readonly [number, number]> = { cut: [0.18, 0.45], dissolve: [1.6, 1.2], blackout: [0.55, 0.9], whiteout: [0.4, 1.2] };
/** Где собираются карманные пространства: далеко в стороне от убежища. */
const POCKET_ORIGIN: Vec3 = [400, 0, 0];
/** Сколько самое меньшее длится лимбо, с. */
const LIMBO_MIN = 7;
/**
 * Тихий слой и сонар (вариант A; слова партнёра: «Тихий слой, это точки по ребрам и углам, иногда
 * пробегает сонар, чтобы игрок понимал хоть какой-то план»). Волна идёт от игрока со скоростью
 * SONAR_SPEED м/с до SONAR_REACH м; приходит раз в SONAR_EVERY с и вскоре после того, как игрок попал в место.
 */
export const SONAR_SPEED = 9;
export const SONAR_REACH = 24;
export const SONAR_EVERY: readonly [number, number] = [24, 40];
/** Сила тихого слоя: точки по рёбрам видны в темноте, но не спорят с тем, что собрал свет. */
export const QUIET = 0.3;
/** Мелочь, которой сон засоряет столы и полки, и крупные вещи посреди коридоров. */
const SMALL_THINGS = ['mug', 'slippers', 'ball', 'teddy', 'alarm_clock', 'remote', 'photo_frame', 'night_light', 'school_bag', 'goldfish_bowl', 'keys', 'phone'];
const BIG_THINGS: readonly (readonly [string, PocketKind | null])[] = [
  ['armchair', null],
  ['tv_stand', 'void'],
  ['floor_lamp', null],
  ['houseplant', 'meadow'],
  ['toy_heap', 'dollhouse'],
  ['washing_machine', null],
  ['fridge', null],
  ['crib', 'dollhouse'],
  ['christmas_tree', 'meadow'],
];
/**
 * Вещи сна в офисе и в жёлтых комнатах. В офисе — офисная мелочь и то, что стоит посреди коридора
 * без причины; в жёлтые комнаты просачивается дом: кровать, ёлка, кроватка посреди пустого зала.
 */
/**
 * Предметы, которые возвращаются собой, а не ступенью хуже: берёза (она не вещь памяти, а то, что
 * прорастает сквозь неё) и завал (укрытие: связки рассыпаются от касания, но место он держит).
 */
const KEEPS: ReadonlySet<string> = new Set(['birch', 'thicket']);

/** Бумажные цветы: у них своя лестница — расцвёл, рассыпался, вернулся кружевом. */
const isFlower = (name: string): boolean => name.startsWith('paper_flower');
/** С какого расстояния цветок расцветает, за сколько секунд и сколько стоит ярким, прежде чем рассыпаться. */
const FLOWER = { near: 3.4, bloom: 1.5, hold: 0.9 } as const;

/** Зал ожидания: сколько дневного света в помещениях каждого рода (зал — единица). */
/**
 * Какое давление бывает в каком мире (docs/vylazka/pressure.md, §2). В убежище — и провал, и сжатие;
 * в офисе давит потолок; в жёлтых комнатах уходит пол; у зала ожидания давление своё — время и край перрона.
 */
const PRESSURE_KINDS: Record<WorldKind, readonly PressureKind[]> = { shelter: ['collapse', 'squeeze'], office: ['squeeze'], yellow: ['collapse'], station: [] };

/**
 * Полярность Осыпи по мирам (слова партнёра: «Поглощает темнота в светлых воспоминаниях и в темных,
 * наоборот, это яркий свет, который тебя разъедает»): 1 — место светлое, и она в нём темнота; 0 — место
 * тёмное, и она в нём свет. Офис записан светлым — это решение основной модели, партнёр назвал только зал.
 */
const POLAR: Record<WorldKind, number> = { shelter: 0, yellow: 0, office: 1, station: 1 };

/**
 * Цвет «камеры» у мест (аудит мест, 16.11). Один на всех, он был подобран под убежище: снимал четверть
 * цвета и уводил тени в болотную зелень — жёлтых комнат не было видно жёлтыми, а светлый зал уходил в
 * серо-зелёную муть. Теперь: убежище — как было; офис — ровный холодный свет без зелени; жёлтые
 * комнаты — жёлтый держится и в свете, и в тени; зал ожидания — тёплые середины, тени без зелени.
 * Карманные пространства — как убежище.
 */
export const GRADE: Record<WorldKind, Grade> = {
  shelter: GRADE_DEFAULT,
  office: { lo: [0.94, 0.99, 1.02], hi: [1.0, 1.0, 0.97], sat: 0.8 },
  yellow: { lo: [1.0, 0.94, 0.78], hi: [1.06, 1.0, 0.76], sat: 1.0 },
  station: { lo: [0.97, 0.98, 1.02], hi: [1.04, 1.0, 0.93], sat: 0.92 },
};
/** Кольца отражателя вокруг пятна фонаря: в убежище — дешёвый фонарь, как был; на гладких стенах чистых мест — едва. */
export const RINGS: Record<WorldKind, number> = { shelter: 0.08, office: 0.025, yellow: 0.02, station: 0.02 };

/** Сколько голубей под крышей зала ожидания на первом круге; круг за кругом их меньше (systems/birds.ts, flockSize). */
const FLOCK_BASE = 6;

/**
 * Ветер по мирам: размах свободного конца висящего и растущего, м. В убежище — сквозняк из
 * вентиляции, в офисе — кондиционер, в жёлтых комнатах воздух почти стоит. У зала ожидания ветер свой
 * (и поезд), у луга — настоящий.
 */
const WIND: Record<WorldKind, number> = { shelter: 0.022, office: 0.014, yellow: 0.006, station: 0.035 };

const STATION_LIGHT: Partial<Record<string, number>> = { concourse: 1, platform: 0.92, track: 0.92, vestibule: 0.7, buffet: 0.6, tickets: 0.55, lockers: 0.5, washroom: 0.5, storage: 0.36, corridor: 0.3 };

const WORLD_THINGS: Record<WorldKind, { small: readonly string[]; big: readonly (readonly [string, PocketKind | null])[] }> = {
  shelter: { small: SMALL_THINGS, big: BIG_THINGS },
  // Зал ожидания: то, что оставляют на сиденьях и у стен те, кто ушёл.
  station: {
    small: ['mug', 'keys', 'phone', 'paper_stack', 'alarm_clock', 'book_stack'],
    big: [
      ['st_suitcase', null],
      ['armchair_visitor', 'void'],
      ['houseplant', 'meadow'],
      ['st_suitcase', null],
    ],
  },
  office: {
    small: ['mug', 'desk_phone', 'paper_stack', 'cactus_round', 'keys', 'lamp_desk', 'book_stack', 'trash_bin', 'phone', 'alarm_clock'],
    big: [
      ['office_chair', null],
      ['armchair_visitor', 'void'],
      ['houseplant', 'meadow'],
      ['filing_cabinet', null],
      ['toy_heap', 'dollhouse'],
      ['water_cooler', null],
      ['partition', null],
    ],
  },
  yellow: {
    small: ['mug', 'slippers', 'teddy', 'desk_phone', 'night_light', 'paper_stack', 'keys', 'ball', 'pillow'],
    big: [
      ['office_chair', null],
      ['sofa', 'void'],
      ['christmas_tree', 'meadow'],
      ['crib', 'dollhouse'],
      ['fridge', null],
      ['bed_home', 'dollhouse'],
      ['houseplant', 'meadow'],
    ],
  },
};
const SMALL_FATES: readonly Fate[] = ['shrink', 'dust', 'grow', 'dust', 'shrink', 'grow'];
const BIG_FATES: readonly Fate[] = ['jump', 'grow', 'dust', 'jump', 'shrink', 'grow'];
/** Воспоминание → вещь-образ. */
const MEMORY_THING: Readonly<Record<string, string>> = MEMORY_THINGS;
/** Цвет дали там, куда ведёт скачок: уходящее место растворяется в этот цвет. */
const DEST_FOG: Record<string, Vec3> = { void: [0.86, 0.86, 0.86], limbo: [0.86, 0.86, 0.86], meadow: [0.62, 0.74, 0.88], dollhouse: [0.03, 0.02, 0.03], elsewhere: [0, 0, 0], session: [0, 0, 0] };

export class Game {
  readonly shake = new ShakeMeter();
  light: Flashlight;
  readonly rig = new CameraRig();
  readonly exposure = new AutoExposure();
  colliders = new ColliderSet();
  level: BuiltLevel | null = null;
  /** Текущая сессия; null — свободная прогулка (тестовый коридор, витрина, просмотр пространства). */
  session: Session | null = null;
  readonly things = new Things();
  /** Фигуры партнёра на уровне (world/figure_place.ts) и номера их частей в рендере. */
  readonly figures = new Figures();
  private readonly figureRender = new Map<FigureLive, number[]>();
  /** Фигуры, поставленные отладкой (__vz.figure): их нет в списке игры, но уровень их знает. */
  private readonly figureExtra = new Map<string, FigureSpec>();
  jumps: Jumps | null = null;
  where: Where = 'main';
  /** Карманное пространство, в котором сейчас игрок (или лимбо). */
  pocket: PocketSpace | null = null;
  /** Предметы, которых сейчас нет (рассыпались): их теней-пятен нет тоже. */
  private readonly contactGone = new Set<number>();
  private contactDirty = false;
  /** 0..1: луч фонаря лежит на воде — по стенам вокруг идут блики ряби. */
  private caustic = 0;
  /**
   * Полярность Осыпи, 0..1: она — негатив места. В светлом воспоминании она темнота (1), в тёмном — свет (0).
   * Какое место какое — POLAR.
   */
  polar = 0;
  /** Нынешний переход начался с того, что поймала Осыпь (а не пол ушёл и не стемнело): кадр выгорает или тонет по её полярности. */
  private swarmCaught = false;
  /** 0..1: разрыв кадра после порванного снимка — какая доля кадра ещё не обновилась. Чем дольше стоял снимок, тем больше; гаснет за полсекунды. */
  private mosh = 0;
  /** Птицы (systems/birds.ts): стая под крышей зала ожидания и те, кого можно спугнуть. */
  flock: Flock | null = null;
  readonly leavers: Leaver[] = [];
  private readonly birdBuf = new Float32Array(BIRDS_MAX * BIRD_STRIDE);
  /** Кто из стаи был в воздухе в прошлом шаге и какое тогда было время места: по ним слышен взлёт. */
  private birdAir: boolean[] = [];
  private birdT = -1e9;
  private birdSound = 0;
  /** Через сколько секунд времени места кто-нибудь из сидящих заворкует, и который это раз. */
  private birdCoo = 6;
  private birdCooN = 0;
  /** Сколько секунд луч фонаря лежит на сидящей птице: секунда света её спугивает. */
  private birdLit = 0;
  /** Идущий скачок. */
  transition: Transition | null = null;
  /** Особенности помещений этой сессии: id помещения → что с ним не так. */
  readonly roomFx = new Map<number, RoomFx>();
  /** Правила сессии: сколько воспоминаний, паузы между ними (тесты подменяют на короткие). */
  sessionCfg: SessionConfig = DEFAULT_SESSION;
  /** Игрок просил поменьше вспышек: строб становится плавным, белые вспышки — затемнением. */
  calmFlash = false;
  /** Что игрок вспомнил за всё время (id воспоминаний): эти вещи копятся в лимбо. */
  archive: string[] = [];
  swarm: SwarmAI | null = null;
  readonly swarmBody = new SwarmBody();
  director: Director | null = null;
  anomalies: Anomalies | null = null;
  /** Близость роя 0..1 на прошлом шаге. */
  swarmNear = 0;
  /** Рой, режиссёр и аномалии выключены (отладка и тесты, проверяющие только цикл вылазки). */
  calm = false;
  body: PlayerBody = createBody(0, 0, 0);
  aimYaw = 0;
  aimPitch = 0;
  /** Игровое время вылазки, с. */
  time = 0;
  frame = 0;
  /** 0 — чёрный экран, 1 — картинка: плавное проявление на старте и затемнение в конце. */
  fade = 0;
  /** Куда стремится fade (0 — затемнить, 1 — проявить). */
  fadeTo = 1;
  glitch = 0;
  /** Толчок камеры (обвал, ушиб): затухает сам. */
  quake = 0;
  private gasView = 0;
  /** Яркость фосфорных надписей и таймер её события (вспышка, затем темнота). */
  private glow = 1;
  private glowTimer = 0;
  /** Сколько секунд подряд фонарь не светит; сколько раз за эту темноту детали уже менялись; сколько вещей изменилось всего. */
  /** Осыпь течёт к искомой вещи после того, как её проявили лучом: путь и сколько секунд она уже течёт. */
  private swarmFlow: { path: Vec3[]; t: number } | null = null;
  /** Мир вылазки и его окружение: убежище, офис или жёлтые комнаты. */
  world: WorldKind = 'shelter';
  /**
   * Падающая звезда по знаку: под небом, когда герой впервые поднимает взгляд, — там, куда он смотрит.
   * Взводится, когда он уходит из-под неба; чаще раза в 20 с не бывает.
   */
  private fallArmed = true;
  private fallT0 = -1e9;
  private fallAim: [number, number] = [0, 0];
  /** Цвет камеры сейчас: идёт к цвету места (GRADE). */
  private readonly grade: Grade = { lo: [...GRADE_DEFAULT.lo], hi: [...GRADE_DEFAULT.hi], sat: GRADE_DEFAULT.sat };
  private worldEnv: Env = ENV_BUNKER;
  /** Свет потолочных панелей по клеткам (офис, жёлтые комнаты); в убежище его нет. */
  cellLights: CellLights | null = null;
  /** Ход времени места: есть только в зале ожидания (systems/flow.ts). */
  flow: Flow | null = null;
  /**
   * Давление помимо Осыпи: пол рассыпается, потолок опускается (systems/pressure.ts,
   * docs/vylazka/pressure.md, §2). Нет — в этом мире его нет.
   */
  pressure: Pressure | null = null;
  /** Режиссёр давления сам начинает события. Выключают проверки, которым нужен ровный ход. */
  pressureAuto = true;
  /** Помещения, где событие возможно: прямоугольные, без своих странностей и опасностей. */
  readonly pressureRooms = new Map<number, PressureRoom>();
  /** Предметы помещения, в котором идёт провал: фронт забирает их по очереди. */
  private pressureObjects: { id: number; d: number }[] = [];
  /** Что случилось с давлением с прошлого шага: уходит в события сна (звук, подсказки). */
  private readonly pressureEvents: { kind: PressureKind; what: 'start' | 'fall' | 'woke'; at: Vec3 }[] = [];
  /** Сила последнего разрыва снимка (зал ожидания) — для звука и отладки. */
  lastTear = 0;
  /** Сколько рассеянного света там, где стоит игрок, 0..1 (без света по клеткам — 1). */
  ambientLocal = 1;
  /** Эхо: волны от шагов игрока и от Осыпи — второй способ видеть (только без фонаря и только на ходу). */
  readonly echo = new Echo();
  /** Сколько секунд до следующей волны от Осыпи. */
  private driftPulse = 0;
  /** 0..1: насколько глаза привыкли к темноте — без света эхо видно в полную силу. */
  private darkAdapt = 0;
  /** 0..1: эхо «открыто» — фонарь не светит. При свете фонаря эха нет. */
  private echoOpen = 0;
  /** 0..1: эхо «на ходу» — его поднимают шаги. Замер — волны гаснут: стоящий в темноте слеп. */
  private echoMove = 0;
  /** Сколько секунд игрок не идёт и не смотрит по сторонам: датчики движения офиса теряют неподвижного. */
  private stillFor = 0;
  /** 0..1: Осыпь за спиной — впереди виден её призрак. */
  ghost = 0;
  /** Сонар: когда пойдёт следующая волна, когда пошла нынешняя (−1 — волны нет), откуда, и сколько их было. */
  private sonarAt = 2.5;
  private sonarT0 = -1;
  private sonarPos: Vec3 = [0, 0, 0];
  private sonarN = 0;
  /** Волна только что пошла: событие уйдёт в события сна этого шага. */
  private sonarFresh = false;
  private darkFor = 0;
  private darkShifts = 0;
  private detailShifts = 0;
  /** Клетка «ярус,x,z» → узел навигации. */
  private readonly nodeAt = new Map<string, number>();
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private spawn: BuiltLevel['spawn'] = { pos: [0, 0, 0], yaw: 0 };
  private lastStrokes = 0;
  private lastRig: RigOutput | null = null;
  private beamDist = 30;
  private stepped = false;
  private scareCount = 0;
  /** Помехи сигнала в последнем кадре, 0..1 (для звука помех). */
  staticLevel = 0;
  /** Окружение места, где сейчас игрок: свет, туман, сила фонаря. */
  env: Env = ENV_BUNKER;
  /** Вещь → её номер в рендере и пространство, куда она утягивает. */
  private readonly thingRender = new Map<number, number>();
  private readonly thingPocket = new Map<number, PocketKind | null>();
  /** Вещи, живущие только в текущем карманном пространстве. */
  private pocketThings: Thing[] = [];
  private memoryThing: Thing | null = null;
  /**
   * Свет памяти (world/memory_light.ts): у какой вещи он горит и насколько разгорелся. Вещь вспомнили —
   * свет гаснет вместе с ней, поэтому он держится за вещь, а не за memoryThing (тот обнуляется сразу).
   */
  private memLit: { t: Thing; def: MemLightDef } | null = null;
  private memLitK = 0;
  /** Отладка: свет памяти у любой вещи (__vz.memLight), даже если её не ищут. */
  memLightDebug: Thing | null = null;
  /** Иллюзорные предметы обстановки: чего коснулся игрок, то растворяется (systems/illusions.ts). */
  illusions: Illusions | null = null;
  /** Хозяева преград и датчиков, которых игрок коснулся за шаг: объект уровня — плюс, вещь сна — минус. */
  private readonly touched = new Set<number>();
  /** Преграды и датчики каждого объекта уровня. */
  private readonly objBoxes = new Map<number, Aabb[]>();
  /** Узел навигации рядом с объектом: по нему — свет его клетки и его помещение. */
  private readonly objNode = new Map<number, number>();
  /** Чем может вернуться предмет с таким именем (подходящие по размеру отдельно стоящие вещи). */
  /** Свободные места у стен, уже занятые вернувшимися вещами. */
  private readonly slotTaken = new Set<number>();
  /** Сколько вещей растворилось от касания и сколько вернулось за вылазку. */
  touchCount = 0;
  returnCount = 0;
  /** Сколько вещей стёрто совсем: прошли все ступени и больше не вернутся. */
  erasedCount = 0;
  /**
   * Стёртость места (systems/decay.ts): с какой начат этот круг и сколько набрано за него — касаниями,
   * стёртыми вещами, встречами с Осыпью. Следующий круг начнётся с суммы (плюс сам круг).
   */
  wearBase = 0;
  wearGain = 0;
  /** Грибы: проросшее рядом с Осыпью и её следы в углах (systems/spores.ts). */
  spores: Spores | null = null;
  private readonly sporeBuf = new Float32Array(SPORES_SHOWN * 6);
  /** Бумажные цветы: насколько каждый расцвёл (0 — тусклый, 1 — яркий) и сколько уже держится расцветшим, с. */
  private readonly blooms = new Map<number, { k: number; hold: number }>();
  /** Номер экрана-проёма, в который вошли и который ещё не унёс (ждёт конца идущего перехода); 0 — нет. */
  private doorway = 0;
  private pocketGroup = 0;
  private pocketAge = 0;
  private pocketStay = 40;
  /** Пространство уже сделало своё дело (макет прочитан, воспоминание вызвано): дальше оно только отпускает. */
  private pocketDone = false;
  /** Сколько секунд игрок светит на главное в пространстве (макет) и на вещь-экспонат. */
  private focusGaze = 0;
  private holdThing: Thing | null = null;
  private holdT = 0;
  /** Экспонаты, которые уже «прозвучали» в этот заход. */
  private readonly heard = new Set<number>();
  /** Белые болванки в белом нигде: ещё не вспомненное. */
  private blanks: Thing[] = [];
  private limboTime = 0;
  private limboAsked = false;
  /** Следующая сессия, собранная за время лимбо. */
  private pending: { level: BuiltLevel; dream: DreamSeed } | null = null;
  /**
   * Сон из сцен (docs/vylazka/pressure.md, §4.6): следующая сцена уже собрана — другое место. Когда в
   * этой сцене вспомнено всё, свет гаснет, и игрок оказывается там, а не в лимбо.
   */
  private sceneNext: { level: BuiltLevel; dream: DreamSeed } | null = null;
  /** Идущий скачок ведёт в следующую сцену (а не в новую сессию): так и скажет событие begin. */
  private sceneSwitch = false;
  /** Через сколько секунд после «всё вспомнено» место рассыплется. */
  private endIn = -1;
  private readonly thinUsed = new Set<number>();
  private thinTime = 0;
  /** Откуда игрок ушёл в карманное пространство. */
  private returnNode = -1;
  /** В этом шаге случилось наблюдение (всмотрелся в вещь, вернулся из скачка). */
  private observed = false;
  /** Сглаженные особенности помещения: сила фонаря и красная сетка. */
  private fxLight = 1;
  private fxWire = 0;
  /** Сила вспышки стробоскопа в последнем кадре, 0..1 (для проверок). */
  private strobeNow = 0;
  private room = -1;
  private nextGlitch = 12;
  private dreamSeed = 0;

  constructor(
    readonly renderer: GameRenderer,
    private readonly rng: Rng,
    private readonly lightCfg: Partial<FlashlightConfig> = {},
  ) {
    this.light = new Flashlight(rng, { ...DEFAULT_FLASHLIGHT, ...lightCfg });
  }

  /** Загрузить уровень. dream — начать на нём сессию; без него — свободная прогулка. */
  loadLevel(level: BuiltLevel, dream: DreamSeed | null = null): void {
    this.leavePocket();
    this.clearThings();
    this.level = level;
    this.setupFigures(level);
    this.colliders = level.colliders;
    this.setupIllusions(level);
    this.contactGone.clear();
    this.bakeContact();
    this.spawn = level.spawn;
    this.renderer.setWorld(level.chunks, level.stairs);
    this.renderer.setEdges(level.edges ?? null);
    // В новом месте волна идёт вскоре: план виден сразу.
    this.sonarT0 = -1;
    this.sonarAt = this.time + 2.5;
    // Батарейка в сессии не садится: фонарь глохнет от контакта, а не от заряда.
    this.light = new Flashlight(this.rng, { ...DEFAULT_FLASHLIGHT, drainSeconds: Infinity, ...this.lightCfg });
    const rank = level.layout?.rank ?? 1;
    this.session = dream ? new Session(level, dream.seed, dream.known, this.sessionCfg, dream.chainAt ?? 0) : null;
    // Новая сцена или сессия: прежняя очередь сцен не в счёт — следующую поставит приложение.
    this.sceneNext = null;
    this.nodeAt.clear();
    for (const n of level.nav) this.nodeAt.set(`${n.tier},${n.cx},${n.cz}`, n.id);
    this.wearBase = Math.max(0, Math.min(1, level.wear ?? 0));
    this.wearGain = 0;
    this.applyWear(level);
    this.setupBirds(level, dream?.seed ?? level.layout?.seed ?? 1);
    const tiers = level.layout?.tierCount ?? 1;
    this.roomFx.clear();
    this.thinUsed.clear();
    if (dream) {
      this.dreamSeed = dream.seed;
      this.swarm = new SwarmAI(level.nav, this.rng);
      this.spores = new Spores(level.nav, dream.seed);
      this.director = new Director(this.rng);
      this.jumps = new Jumps(this.rng);
      // Лестница на нижний ярус удлиняется дважды — только на объектах, где есть «неправильный» ярус.
      const stair = rank >= 2 && tiers >= 3 ? (level.stairs.find((st) => st.upperTier === tiers - 2) ?? null) : null;
      this.anomalies = new Anomalies(stair, { run: STAIR_RUN, rise: STAIR_RISE, steps: STAIR_STEPS }, level.variants, 2);
      this.assignRooms(dream.seed);
      this.setupPressure(level);
      this.placeThings(dream.seed);
      // Место собирается вокруг игрока из пыли; светлое (офис, зал ожидания) проявляется из белого: клетки
      // распада с красной сеткой на светлом читались битой текстурой (аудит 16.11).
      const bright = POLAR[level.world ?? 'shelter'] > 0.5;
      this.transition = { plan: { cause: 'begin', style: bright ? 'whiteout' : 'dissolve', to: 'session' }, t: 0, out: 0, back: 1.6, switched: true };
    } else {
      this.swarm = null;
      this.spores = null;
      this.director = null;
      this.anomalies = null;
      this.jumps = null;
      this.transition = null;
    }
    this.where = 'main';
    this.world = level.world ?? 'shelter';
    this.worldEnv = WORLD_ENV[this.world];
    this.env = this.worldEnv;
    // Свет панелей: в офисе его включают датчики, в жёлтых комнатах он гудит сам. «Тёмные» помещения — без света.
    this.cellLights = this.worldEnv.cells ? new CellLights(level.nav, this.worldEnv.cells, level.layout?.seed ?? 0) : null;
    this.flow = this.world === 'station' ? new Flow(level.layout?.seed ?? 0) : null;
    this.lastTear = 0;
    if (this.cellLights) {
      for (const r of level.layout?.rooms ?? []) {
        if (r.type === 'corridor') this.cellLights.corridorRooms.add(r.id);
        if (this.roomFx.get(r.id) === 'dark') this.cellLights.offRooms.add(r.id);
        // Дневной свет зала ожидания: зал и перрон — под открытым небом, комнаты темнее, переходы темны.
        if (this.flow) this.cellLights.roomBase.set(r.id, STATION_LIGHT[r.type] ?? 0.55);
        // Пути в граф не входят (по ним не ходят), но свет им нужен: иначе за краем перрона ничего не видно.
        if (this.flow && r.type === 'track') for (const [cx, cz] of r.cells) this.cellLights.extra.push({ cx, cz, room: r.id });
      }
      this.cellLights.settle();
    }
    this.ambientLocal = 1;
    this.pending = null;
    this.endIn = -1;
    this.memoryThing = null;
    this.observed = false;
    this.fxLight = 1;
    this.fxWire = 0;
    this.room = -1;
    this.swarmNear = 0;
    this.darkFor = 0;
    this.darkShifts = 0;
    this.detailShifts = 0;
    this.swarmFlow = null;
    this.echo.clear();
    this.driftPulse = 0;
    this.darkAdapt = 0;
    this.echoOpen = 0;
    this.echoMove = 0;
    this.stillFor = 0;
    this.ghost = 0;
    this.glow = 1;
    this.glowTimer = 0;
    this.renderer.setGlow(1);
    this.time = 0;
    this.fade = 0;
    this.fadeTo = 1;
    this.glitch = 0;
    this.mosh = 0;
    this.quake = 0;
    this.gasView = 0;
    this.shake.reset();
    this.respawn();
  }

  /**
   * Подготовить иллюзорные предметы уровня: кому какие преграды принадлежат; у предмета без преград
   * (картонка, коврик, картина на стене) — датчик касания по его габаритам.
   */
  private setupIllusions(level: BuiltLevel): void {
    const objs = level.objects ?? [];
    this.illusions = objs.length > 0 ? new Illusions(objs, level.layout?.seed ?? 0) : null;
    this.objBoxes.clear();
    this.objNode.clear();
    this.slotTaken.clear();
    this.touched.clear();
    this.touchCount = 0;
    this.returnCount = 0;
    this.erasedCount = 0;
    this.blooms.clear();
    this.doorway = 0;
    if (objs.length === 0) return;
    const sensed = new Set<number>();
    for (const bx of this.colliders.boxes) {
      if (bx.owner === undefined || bx.owner <= 0) continue;
      bx.gone = false;
      if (bx.ghost) sensed.add(bx.owner);
      const list = this.objBoxes.get(bx.owner);
      if (list) list.push(bx);
      else this.objBoxes.set(bx.owner, [bx]);
    }
    for (const o of objs) {
      if (o.solid || sensed.has(o.id)) continue;
      const bx: Aabb = { minX: o.min[0] - 0.05, minY: o.min[1], minZ: o.min[2] - 0.05, maxX: o.max[0] + 0.05, maxY: Math.max(o.max[1], o.min[1] + 0.05), maxZ: o.max[2] + 0.05, owner: o.id, ghost: true };
      // Предмет скрытого варианта комнаты: пока вариант не показан, его нет.
      if (o.group) {
        bx.group = o.group;
        bx.off = o.group.endsWith(':b');
      }
      this.colliders.add(bx);
      this.objBoxes.set(o.id, [bx]);
    }
  }

  /**
   * Сожаление, 0..1: из него сделана Осыпь (слова партнёра: «Монстр это тревога внутри и сожаление
   * игрока»). Растёт от всего, что игрок стёр: от тронутого за этот круг, от стёртого совсем и от
   * того, насколько место стёрто с прошлых кругов.
   */
  get regret(): number {
    return Math.min(1, this.touchCount / 40 + this.erasedCount / 12 + this.wearBase * 0.6);
  }

  /** Стёртость места сейчас, 0..1. */
  get wear(): number {
    return Math.min(1, this.wearBase + this.wearGain);
  }

  /** Все кривые стирания для нынешней стёртости. */
  get decay(): Decay {
    return decayAt(this.wear);
  }

  /** Предмет, который стирание не трогает в начале круга: у него своя роль или своя лестница. */
  private wearProof(o: LevelObject): boolean {
    return ALL_PROPS[o.name] === undefined || o.group !== undefined || o.name.startsWith('display_') || KEEPS.has(o.name) || isFlower(o.name);
  }

  /**
   * Начало круга: что от места уже стёрто (systems/decay.ts). У каждого предмета своя «прочность»:
   * одни ещё настоящие, от других осталось кружево (сквозь него проходят; тронул — и его нет), третьих
   * нет вовсе. То, что лежало бы на стёртом предмете, лежит на полу под ним. Бумажные цветы тусклы,
   * пока к ним не подошли.
   */
  private applyWear(level: BuiltLevel): void {
    const ill = this.illusions;
    if (!ill) return;
    const seed = level.layout?.seed ?? 0;
    for (const i of ill.list) {
      const o = i.obj;
      if (isFlower(o.name)) {
        this.blooms.set(o.id, { k: 0, hold: 0 });
        this.renderer.setObjectTone(o.id, 1, 0);
        continue;
      }
      if (this.wearBase <= 0 || this.wearProof(o)) continue;
      const f = startForm(o.id, seed, this.wearBase);
      if (f === FORM_REAL) continue;
      const floor = this.floorUnder(o);
      for (const sp of level.spots) if (this.restsOn([sp.x, sp.y, sp.z], o)) sp.y = floor;
      if (f === FORM_GONE) {
        i.state = 'left';
        i.dis = 1;
        i.form = FORM_GONE;
        this.renderer.setObjectState(o.id, 1, true);
        for (const bx of this.objBoxes.get(o.id) ?? []) bx.gone = true;
      } else {
        i.form = FORM_LACE;
        this.renderer.setObjectLace(o.id, true);
        // Кружево не держит: сквозь него проходят, но касание оно чувствует.
        for (const bx of this.objBoxes.get(o.id) ?? []) bx.ghost = true;
      }
    }
  }

  /**
   * Бумажные цветы (слова партнёра: «Пусть при подходе к цветам, они становятся яркими и
   * разноцветными, а потом рассыпаются. В следующий раз, они более тусклые, как кружева»). Тусклый
   * цветок расцветает, когда игрок рядом и на цветке есть свет; расцвёл, постоял — и рассыпался, как
   * всё, чего коснулись. Вернётся он уже кружевом.
   */
  private stepFlowers(dt: number, dream: DreamEvent[]): void {
    const ill = this.illusions;
    if (!ill || this.blooms.size === 0) return;
    const b = this.body;
    for (const [id, f] of this.blooms) {
      const i = ill.get(id);
      if (!i || i.state !== 'here') continue;
      const o = i.obj;
      const cx = (o.min[0] + o.max[0]) / 2;
      const cz = (o.min[2] + o.max[2]) / 2;
      const near = Math.hypot(cx - b.x, cz - b.z) < FLOWER.near && Math.abs(o.at[1] - b.y) < 6 && this.lightAt(this.nodeOfObject(o)) > 0.4;
      if (!near && f.k <= 0) continue;
      // Начав расцветать, цветок доцветает, даже если игрок отошёл.
      f.k = Math.min(1, f.k + dt / FLOWER.bloom);
      if (f.k >= 1) f.hold += dt;
      this.renderer.setObjectTone(id, 1 - f.k, f.k);
      if (f.hold >= FLOWER.hold) this.touchObject(id, dream);
    }
  }

  /** Стоит ли игрок в этих габаритах (с запасом m): туда вещь вернуть нельзя — он окажется внутри. */
  private standsIn(min: Vec3, max: Vec3, m = 0.45): boolean {
    const b = this.body;
    return b.x > min[0] - m && b.x < max[0] + m && b.z > min[2] - m && b.z < max[2] + m && b.y < max[1] && b.y + DEFAULT_CONTROLLER.height > min[1];
  }

  /** Лежит ли точка на предмете: над ним и в его границах (на полу рядом — не считается). */
  private restsOn(p: Vec3, o: LevelObject): boolean {
    return p[0] > o.min[0] - 0.05 && p[0] < o.max[0] + 0.05 && p[2] > o.min[2] - 0.05 && p[2] < o.max[2] + 0.05 && p[1] > o.min[1] + 0.12 && p[1] < o.max[1] + 0.15;
  }

  private nodeOfObject(o: LevelObject): number {
    let n = this.objNode.get(o.id);
    if (n === undefined) {
      n = this.playerNodeAt([(o.min[0] + o.max[0]) / 2, o.at[1], (o.min[2] + o.max[2]) / 2]);
      this.objNode.set(o.id, n);
    }
    return n;
  }

  /** Сколько света на этом месте: фонарь игрока или потолочная панель клетки (в офисе свет даёт место). */
  private lightAt(node: number): number {
    const beam = this.light.intensity * this.fxLight * this.env.light >= 0.15 ? 1 : 0;
    return Math.max(beam, this.cellLights && node >= 0 ? this.cellLights.at(node) : 0);
  }

  /** Игрок коснулся предмета обстановки: тот растворяется, и всё, что на нём лежало, — вместе с ним. */
  private touchObject(id: number, dream: DreamEvent[]): void {
    const ill = this.illusions;
    if (!ill || !ill.touch(id)) return;
    const o = ill.get(id)!.obj;
    // Экран-проём: на нём не картинка, а другое место. Вошёл в него — оказался на лугу; сам экран при
    // этом рассыпается, как всё, чего коснулись, и после темноты встаёт снова.
    if (o.name === DOOR_NAME) this.doorway = id;
    this.touchCount += 1;
    this.wearGain += WEAR.touch;
    dream.push({ type: 'touch', name: o.name, what: 'gone', first: this.touchCount === 1 });
    for (const t of this.things.list) if (t.state === 'idle' && !t.still && this.restsOn(t.pos, o)) this.touchThing(t, dream);
  }

  /** Игрок коснулся вещи сна: она растворяется и вернётся, когда свет погаснет и зажжётся. */
  private touchThing(t: Thing, dream: DreamEvent[]): void {
    if (!this.things.touch(t)) return;
    this.touchCount += 1;
    this.wearGain += WEAR.touch;
    dream.push({ type: 'thing', thing: t, what: 'changing' });
    dream.push({ type: 'touch', name: t.kind, what: 'gone', first: this.touchCount === 1 });
  }

  /** Где стоит вещь с таким именем (от этого зависят её ступени). Мелочь без описания лежит где придётся. */
  private mountOf(kind: string): Mount {
    return ALL_PROPS[kind]?.mount ?? 'free';
  }

  /** Высота пола под предметом: туда ложится то, что стояло на нём, когда предмета нет. */
  private floorUnder(o: LevelObject): number {
    const node = this.nodeOfObject(o);
    return node >= 0 ? this.level!.nav[node]!.y : o.min[1];
  }

  /**
   * Из чего выбирать возвращение. Собой и на своё место возвращаются: экран и проём (у них своя роль),
   * предмет варианта комнаты, то, что растёт сквозь место (берёза), и то, на чём лежит вещь
   * воспоминания, — её ищут по строке, и исчезнуть из-под неё опора не должна. Остальное — на ступень хуже.
   */
  /** Возвращается ли предмет собой (а не на ступень хуже): у него своя роль или на нём лежит вещь воспоминания. */
  keepsItself(id: number): boolean {
    const o = this.illusions?.get(id)?.obj;
    return o ? this.comebackOptions(o).keep : false;
  }

  private comebackOptions(o: LevelObject): ComebackOptions {
    const spec = ALL_PROPS[o.name];
    // Цветок возвращается сразу кружевом («в следующий раз они более тусклые, как кружева») — как потолочное.
    const mount = isFlower(o.name) ? 'ceiling' : (spec?.mount ?? 'floor');
    const keep = !spec || o.group !== undefined || o.name.startsWith('display_') || KEEPS.has(o.name) || this.things.list.some((t) => t.memory && this.restsOn(t.pos, o));
    if (keep || mount !== 'floor' || spec!.w > 2.3) return { keep, mount, slots: [] };
    const node = this.nodeOfObject(o);
    const room = node >= 0 ? this.level!.nav[node]!.room : -1;
    const b = this.body;
    const slots: number[] = [];
    (this.level?.freeSlots ?? []).forEach((s, i) => {
      if (s.room !== room || this.slotTaken.has(i)) return;
      // Не там, где стоит игрок, и не на прежнем месте.
      if (Math.hypot(s.at[0] - b.x, s.at[2] - b.z) < 1.6 || Math.hypot(s.at[0] - o.at[0], s.at[2] - o.at[2]) < 1.2) return;
      slots.push(i);
    });
    return { keep, mount, slots };
  }

  /**
   * Поставить отдельную вещь туда, где стоял (или мог бы стоять) предмет обстановки: at и rot — начало
   * координат и поворот предмета у стены, form — на какой ступени она возвращается. Вещь собирается из пыли.
   */
  private standIn(kind: string, at: Vec3, rot: 0 | 1 | 2 | 3, form: Form = FORM_REAL, floorY = at[1]): Thing | null {
    const spec = ALL_PROPS[kind];
    if (!spec) return null;
    // У напольного предмета спина лежит на стене, а вещь сна собрана вокруг своей середины: сдвигаем
    // на полглубины вдоль его оси +z (куда она смотрит в мире — см. Xf.pt).
    const off = spec.mount === 'free' ? 0 : spec.d / 2;
    const fx = rot === 1 ? 1 : rot === 3 ? -1 : 0;
    const fz = rot === 0 ? 1 : rot === 2 ? -1 : 0;
    // Подвесное собрано от потолка вниз: его начало координат — точка подвеса.
    const y = spec.mount === 'ceiling' ? at[1] - spec.h : at[1];
    const t = this.addThing(kind, [at[0] + fx * off, y, at[2] + fz * off], rot * (Math.PI / 2), 'dust', false, spec.h > 0.4, form, at[1] - floorY);
    this.things.comeBack(t);
    return t;
  }

  /** Вещь стёрта совсем: прошла все ступени. Больше её нет нигде. */
  private eraseThing(t: Thing, dream: DreamEvent[]): void {
    this.erasedCount += 1;
    this.wearGain += WEAR.erased;
    dream.push({ type: 'touch', name: t.kind, what: 'erased' });
    this.dropThing(t);
  }

  /** Исполнить решение о возврате предмета обстановки. */
  private applyComeback(p: Comeback, dream: DreamEvent[]): void {
    const ill = this.illusions!;
    const o = ill.get(p.id)!.obj;
    if (p.how === 'same') {
      ill.comeBack(p.id);
      this.returnCount += 1;
      dream.push({ type: 'touch', name: o.name, what: 'back', how: p.how, form: ill.get(p.id)!.form });
      return;
    }
    // То, что лежало на предмете и растворилось вместе с ним, без него не вернётся: снимку стола
    // чашку не удержать.
    for (const t of [...this.things.list]) if (!t.memory && t.touched && t.state === 'gone' && this.restsOn(t.pos, o)) this.eraseThing(t, dream);
    if (p.form === FORM_GONE) {
      ill.leave(p.id, FORM_GONE);
      this.erasedCount += 1;
      this.wearGain += WEAR.erased;
      dream.push({ type: 'touch', name: o.name, what: 'erased' });
      return;
    }
    const slot = p.slot !== undefined ? this.level!.freeSlots![p.slot]! : null;
    if (slot && p.slot !== undefined) this.slotTaken.add(p.slot);
    if (this.standIn(o.name, slot ? slot.at : o.at, slot ? slot.rot : o.rot, p.form, slot ? slot.at[1] : this.floorUnder(o))) ill.leave(p.id, p.form);
    else ill.comeBack(p.id);
    this.returnCount += 1;
    dream.push({ type: 'touch', name: o.name, what: 'back', how: p.how, form: p.form, moved: slot !== null });
  }

  /** Перевести вещь сна на другую ступень: другая сетка, без преграды — только датчик касания. */
  private reform(t: Thing, form: Form): void {
    const fm = formMesh(t.kind, form, hash2(Math.round(t.pos[0] * 10), Math.round(t.pos[2] * 10), 0x71) >>> 0);
    const old = this.thingRender.get(t.id);
    if (old !== undefined) this.renderer.removeThing(old);
    this.thingRender.set(t.id, this.renderer.addThing(fm.mesh, t.id, fm.look));
    t.form = form;
    if (t.collider >= 0) this.colliders.boxes[t.collider]!.off = true;
    t.collider = this.thingBox(t, fm.w, fm.d, fm.h, true);
  }

  /** Преграда вещи сна: коробка по её габаритам; хозяин — минус номер вещи (коснулся преграды — коснулся вещи). */
  private thingBox(t: Thing, w: number, d: number, h: number, sensor = false): number {
    const turned = Math.abs(Math.sin(t.yaw)) > 0.5;
    const hx = (turned ? d : w) / 2;
    const hz = (turned ? w : d) / 2;
    const id = this.colliders.addBox(t.pos[0] - hx, t.pos[1], t.pos[2] - hz, t.pos[0] + hx, t.pos[1] + h, t.pos[2] + hz);
    this.colliders.boxes[id]!.owner = -t.id;
    // Картонка, проекция и кружево не держат: сквозь них проходят, но касание они чувствуют.
    if (sensor) this.colliders.boxes[id]!.ghost = true;
    return id;
  }

  /**
   * Вернуть вещь сна, растворённую касанием. Вещь воспоминания возвращается собой и на своё место
   * (её ищут по строке). Остальные — на ступень хуже: настоящая → картонка → проекция → кружево;
   * с последней ступени вещь не возвращается. Мелочь без преграды при этом может оказаться в другом месте.
   */
  private returnThing(t: Thing, dream: DreamEvent[]): void {
    let moved = false;
    if (!t.memory) {
      const next = worse(t.form as Form, this.mountOf(t.kind));
      if (next === FORM_GONE) {
        this.eraseThing(t, dream);
        return;
      }
      const small = t.collider < 0;
      const r = hash01(t.id * 37 + 5, this.returnCount * 13 + 1, this.dreamSeed ^ 0x7e7);
      if (r >= 0.75 && small) {
        // Другое место: свободное место для вещей неподалёку, где ничего не лежит.
        const pick = hash01(t.id * 11 + 3, this.returnCount * 7 + 2, this.dreamSeed ^ 0x51c);
        const spots = (this.level?.spots ?? []).filter((sp) => Math.abs(sp.y - t.pos[1]) < 1.6 && Math.hypot(sp.x - t.pos[0], sp.z - t.pos[2]) < 10 && Math.hypot(sp.x - this.body.x, sp.z - this.body.z) > 1.2 && !this.things.list.some((o) => o.state !== 'gone' && Math.hypot(o.pos[0] - sp.x, o.pos[2] - sp.z) < 0.5));
        const sp = spots[Math.floor(pick * spots.length)];
        if (sp) {
          t.pos = [sp.x, sp.y, sp.z];
          this.session?.reserve(sp);
          moved = true;
        }
      }
      this.reform(t, next);
      // У мелочи датчик касания не нужен: на неё наступают (stepIllusions).
      if (small && t.collider >= 0) {
        this.colliders.boxes[t.collider]!.off = true;
        t.collider = -1;
      }
    }
    this.things.comeBack(t);
    if (t.collider >= 0) this.colliders.boxes[t.collider]!.gone = false;
    this.returnCount += 1;
    dream.push({ type: 'touch', name: t.kind, what: 'back', how: t.memory ? 'same' : 'step', form: t.form, moved });
  }

  /**
   * Шаг правила «всё иллюзорно»: чего игрок коснулся — растворяется; что растворилось — ждёт, пока
   * свет на его месте погаснет и зажжётся, и возвращается.
   */
  private stepIllusions(dt: number, dream: DreamEvent[]): void {
    const b = this.body;
    for (const id of this.touched) {
      if (id > 0) this.touchObject(id, dream);
      else {
        const t = this.things.list.find((x) => x.id === -id);
        if (t && !t.still) this.touchThing(t, dream);
      }
    }
    // В проём вошли: уносит на луг. Если в этот миг идёт другой переход, вход не теряется — проём ждёт
    // его конца; но только пока игрок стоит в проёме: ушёл (или его унесло) — значит, не вошёл.
    if (this.doorway > 0 && !this.transition) {
      const o = this.illusions?.get(this.doorway)?.obj;
      this.doorway = 0;
      if (o && this.where === 'main' && this.session && !this.session.over && this.standsIn(o.min, o.max, 0.9)) this.beginJump({ cause: 'door', style: 'whiteout', to: 'meadow' }, dream);
    }
    // Мелкая вещь без преграды: коснулся — значит наступил или задел ногой.
    for (const t of this.things.list) {
      if (t.state !== 'idle' || t.collider >= 0 || t.still) continue;
      const reach = Math.min(0.5, t.radius * 0.6) + DEFAULT_CONTROLLER.radius;
      if (Math.hypot(t.pos[0] - b.x, t.pos[2] - b.z) < reach && t.pos[1] < b.y + DEFAULT_CONTROLLER.height && t.pos[1] + t.radius * 1.4 > b.y - 0.05) this.touchThing(t, dream);
    }
    this.stepFlowers(dt, dream);
    const ill = this.illusions;
    if (ill) {
      const plans = ill.update(
        dt,
        (o) => this.lightAt(this.nodeOfObject(o)),
        (o) => this.standsIn(o.min, o.max),
        (o) => this.comebackOptions(o),
      );
      for (const p of plans) this.applyComeback(p, dream);
      for (const id of ill.changed()) {
        this.renderer.setObjectState(id, ill.get(id)!.dis);
        // Преграды держат, пока вещь не рассыпалась достаточно (и сразу — когда она собирается).
        const open = ill.open(id);
        for (const bx of this.objBoxes.get(id) ?? []) bx.gone = open;
        // Тень-пятно уходит и возвращается вместе с вещью.
        if (open !== this.contactGone.has(id)) {
          if (open) this.contactGone.add(id);
          else this.contactGone.delete(id);
          this.contactDirty = true;
        }
      }
      if (this.contactDirty) this.bakeContact();
    }
    for (const t of this.things.list) {
      // Вещь, которой коснулись, держит так же недолго, как и мебель.
      if (t.touched && t.state === 'changing' && t.collider >= 0) this.colliders.boxes[t.collider]!.gone = t.dissolve >= DEFAULT_ILLUSIONS.yield;
      if (t.state !== 'gone' || !t.touched) continue;
      const l = this.lightAt(this.playerNodeAt(t.pos));
      if (l < 0.08) t.dark = true;
      else if (t.dark && l > 0.45) {
        const r = t.radius + 0.35;
        if (!this.standsIn([t.pos[0] - r, t.pos[1], t.pos[2] - r], [t.pos[0] + r, t.pos[1] + 2, t.pos[2] + r], 0)) this.returnThing(t, dream);
      }
    }
  }

  /** Раздать помещениям особенности: строб, темноту, сетку, «тонкие места». */
  /**
   * Где возможны провал и сжатие: помещение-прямоугольник в две клетки и больше, с выходом, без своих
   * особенностей (строб, темнота, «тонкое») и без опасностей среды; не то, где вылазка началась.
   */
  private setupPressure(level: BuiltLevel): void {
    this.pressureRooms.clear();
    this.pressureObjects = [];
    this.pressure = null;
    const layout = level.layout;
    // Мир берём из уровня: поле this.world к этому мигу ещё от прошлого места.
    if (!layout || PRESSURE_KINDS[level.world ?? 'shelter'].length === 0) return;
    const skip: readonly string[] = ['corridor', 'stairwell', 'lift', 'entrance', 'airlock', 'collapsed'];
    const gas = new Set(layout.hazards.gasRooms);
    let startRoom = -1;
    let best = Infinity;
    for (const n of level.nav) {
      const d = Math.hypot(n.x - level.spawn.pos[0], n.y - level.spawn.pos[1], n.z - level.spawn.pos[2]);
      if (d < best) {
        best = d;
        startRoom = n.room;
      }
    }
    const H = CELL / 2;
    for (const r of layout.rooms) {
      // Под звёздным небом ничего не давит: потолка там нет, и место это тихое.
      if (skip.includes(r.type) || r.cells.length < 2 || r.id === startRoom || r.id === level.skyRoom || gas.has(r.id) || this.roomFx.has(r.id)) continue;
      const xs = r.cells.map((c) => c[0]);
      const zs = r.cells.map((c) => c[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const z0 = Math.min(...zs);
      const z1 = Math.max(...zs);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) !== r.cells.length) continue;
      const height = level.ceilings?.[r.id] ?? CEIL_H;
      if (height > 3.2) continue;
      const room: PressureRoom = { id: r.id, minX: cellToWorld(x0) - H, maxX: cellToWorld(x1) + H, minZ: cellToWorld(z0) - H, maxZ: cellToWorld(z1) + H, floorY: tierFloor(r.tier), height, exits: [] };
      // Ямы, вода и завалы в помещении: там и так есть чего бояться.
      if (level.zones.some((z) => z.maxX > room.minX && z.minX < room.maxX && z.maxZ > room.minZ && z.minZ < room.maxZ && Math.abs(z.maxY - room.floorY) < 3)) continue;
      if (level.collapses.some((c) => c.center[0] > room.minX - 1 && c.center[0] < room.maxX + 1 && c.center[2] > room.minZ - 1 && c.center[2] < room.maxZ + 1 && Math.abs(c.center[1] - room.floorY) < 3)) continue;
      const mine = new Set(r.cells.map((c) => `${c[0]},${c[1]}`));
      const exits: [number, number][] = [];
      for (const e of layout.edges) {
        if (e.tier !== r.tier) continue;
        const a = mine.has(`${e.cx},${e.cz}`);
        const b = mine.has(`${e.cx + (e.dir === 0 ? 1 : 0)},${e.cz + (e.dir === 1 ? 1 : 0)}`);
        if (a !== b) exits.push([cellToWorld(e.cx) + (e.dir === 0 ? H : 0), cellToWorld(e.cz) + (e.dir === 1 ? H : 0)]);
      }
      if (exits.length === 0) continue;
      room.exits = exits;
      this.pressureRooms.set(r.id, room);
    }
    this.pressure = new Pressure(layout.seed);
  }

  /** Есть ли на уровне, откуда увидеть небо: комната без потолка, крыша зала ожидания, стёртый потолок. */
  /**
   * Птицы уровня. В зале ожидания — стая на затяжках крыши (чем сильнее место стёрто, тем их меньше) и
   * один голубь на полу: подойдёшь — взлетит под крышу и там останется. В остальных мирах — одна птица
   * на кромке стены комнаты под небом: спугнёшь — улетит вверх и не вернётся.
   */
  private setupBirds(level: BuiltLevel, seed: number): void {
    this.flock = null;
    this.leavers.length = 0;
    this.birdAir = [];
    this.birdT = -1e9;
    this.birdLit = 0;
    const objs = level.objects ?? [];
    const perches = level.perches ?? [];
    if (perches.length >= 2) {
      const n = flockSize(FLOCK_BASE, this.wearBase);
      const box = level.roof?.box;
      // Столбы зала объектами уровня не числятся (они держат место на себе и не рассыпаются), поэтому
      // ищем их среди преград: высокие узкие коробки под крышей. Сквозь них стая не летает.
      const cols = box
        ? this.colliders.boxes
            .filter((c) => c.maxY - c.minY > 4 && c.maxX - c.minX < 1.4 && c.maxZ - c.minZ < 1.4 && c.minX > box[0] && c.maxX < box[2] && c.minZ > box[1] && c.maxZ < box[3])
            .map((c) => [(c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2, Math.hypot(c.maxX - c.minX, c.maxZ - c.minZ) / 2] as const)
        : [];
      if (n > 0) this.flock = new Flock(perches, n, seed, DEFAULT_BIRDS, cols);
      if (n >= 2 && box) {
        // Место на полу: в зале, подальше от входа, не в мебели.
        const free = (x: number, z: number, y: number): boolean => !objs.some((o) => o.min[1] < y + 1 && o.max[1] > y - 0.1 && x > o.min[0] - 0.5 && x < o.max[0] + 0.5 && z > o.min[2] - 0.5 && z < o.max[2] + 0.5);
        const spots = level.nav
          .filter((nd) => nd.x > box[0] && nd.x < box[2] && nd.z > box[1] && nd.z < box[3])
          .map((nd, i) => ({ x: nd.x + (hash01(i, 1, seed) - 0.5) * 1.6, y: nd.y, z: nd.z + (hash01(i, 2, seed) - 0.5) * 1.6, far: Math.hypot(nd.x - level.spawn.pos[0], nd.z - level.spawn.pos[2]) }))
          .filter((q) => q.far > 7 && free(q.x, q.z, q.y))
          .sort((a, b) => a.far - b.far);
        const q = spots[Math.floor(hash01(3, 4, seed) * Math.min(4, spots.length))];
        const to = perches[Math.floor(hash01(5, 6, seed) * perches.length)]!;
        if (q) this.leavers.push(new Leaver({ pos: [q.x, q.y, q.z], yaw: hash01(7, 8, seed) * Math.PI * 2 }, to, seed ^ 0x9e37));
      }
    }
    const sky = level.skyRoom;
    if (sky !== undefined && this.wearBase < 0.6) {
      const perch = this.skyPerch(level, sky, seed);
      if (perch) this.leavers.push(new Leaver(perch, null, seed ^ 0x51ed, { ...DEFAULT_BIRDS, scare: 2.6 }));
    }
  }

  /** Где сидит птица комнаты под небом: на кромке глухой стены, подальше от входа, лицом в комнату. */
  private skyPerch(level: BuiltLevel, roomId: number, seed: number): Perch | null {
    const layout = level.layout;
    const room = layout?.rooms[roomId];
    if (!layout || !room) return null;
    const cells = new Set(room.cells.map(([x, z]) => `${x},${z}`));
    const edges = layout.edges.filter((e) => e.tier === room.tier);
    // Проём между клетками записан у западной или северной из них (gen/layout.ts).
    const open = (x: number, z: number, dir: number): boolean => {
      const [ex, ez, ed] = dir === 0 ? [x, z, 0] : dir === 1 ? [x, z, 1] : dir === 2 ? [x - 1, z, 0] : [x, z - 1, 1];
      return edges.some((e) => e.cx === ex && e.cz === ez && e.dir === ed);
    };
    const y = tierFloor(room.tier) + (level.ceilings?.[roomId] ?? CEIL_H);
    const walls: Perch[] = [];
    const doors: [number, number][] = [];
    for (const [x, z] of room.cells) {
      for (let dir = 0; dir < 4; dir++) {
        const dx = DX[dir]!;
        const dz = DZ[dir]!;
        if (cells.has(`${x + dx},${z + dz}`)) continue;
        if (open(x, z, dir)) doors.push([cellToWorld(x) + (dx * CELL) / 2, cellToWorld(z) + (dz * CELL) / 2]);
        else walls.push({ pos: [cellToWorld(x) + dx * (CELL / 2 - 0.12), y, cellToWorld(z) + dz * (CELL / 2 - 0.12)], yaw: Math.atan2(-dx, -dz) });
      }
    }
    if (walls.length === 0) return null;
    const away = (w: Perch): number => Math.min(...doors.map(([dx, dz]) => Math.hypot(w.pos[0] - dx, w.pos[2] - dz)), 99) + hash01(Math.round(w.pos[0] * 7), Math.round(w.pos[2] * 7), seed) * 0.5;
    return walls.sort((a, b) => away(b) - away(a))[0]!;
  }

  /**
   * Шаг птиц. Те, кого можно спугнуть, живут по времени места (в снимке зала они стоят вместе со всем);
   * срываются, когда игрок подошёл — или когда на них секунду светит фонарь. Взлёт слышен.
   */
  private stepBirds(wdt: number, dream: DreamEvent[]): void {
    const b = this.body;
    for (const l of this.leavers) {
      if (l.state === 'gone' || l.state === 'moved') continue;
      const d = l.state === 'sits' ? (this.birdLit >= 1 ? 0 : Math.hypot(l.perch.pos[0] - b.x, l.perch.pos[2] - b.z)) : 99;
      if (l.update(wdt, d)) {
        this.birdLit = 0;
        dream.push({ type: 'bird', what: 'takeoff', at: [l.perch.pos[0], l.perch.pos[1], l.perch.pos[2]] });
      }
    }
    const f = this.flock;
    const fl = this.flow;
    if (!f || !fl) return;
    // Стая — функция времени места. Взлёт слышен, только когда время шло само, а не прыгнуло (разрыв снимка).
    const t = fl.viewT;
    const steady = Math.abs(t - this.birdT) < 0.5;
    this.birdT = t;
    this.birdSound = Math.max(0, this.birdSound - wdt);
    for (let i = 0; i < f.count; i++) {
      const p = f.pose(i, t);
      if (steady && p.flying && this.birdAir[i] === false && this.birdSound <= 0) {
        dream.push({ type: 'bird', what: 'takeoff', at: p.pos });
        this.birdSound = 0.8;
      }
      this.birdAir[i] = p.flying;
    }
    // Воркование: изредка, пока время идёт, — от одной из сидящих.
    this.birdCoo -= wdt;
    if (this.birdCoo <= 0 && f.count > 0) {
      this.birdCooN += 1;
      this.birdCoo = 9 + 12 * hash01(this.birdCooN, 9, f.seed);
      const who = Math.floor(hash01(this.birdCooN, 11, f.seed) * f.count) % f.count;
      const p = f.pose(who, t);
      if (!p.flying) dream.push({ type: 'bird', what: 'coo', at: p.pos });
    }
  }

  /** Пересобрать тени-пятна под обстановкой (world/contact.ts): при загрузке уровня и когда вещь рассыпалась или вернулась. */
  private bakeContact(): void {
    this.contactDirty = false;
    const level = this.level;
    const objs = level?.objects ?? [];
    this.renderer.setContact(objs.length > 0 ? bakeContact(objs, tierFloor, level?.layout?.tierCount ?? 1, this.contactGone) : null);
  }

  /** Ветер места для кадра: время, размах свободного конца (м), направление. */
  private windView(fl: Flow | null): NonNullable<FrameView['wind']> {
    const t = fl ? 100 + fl.viewT : this.time;
    if (this.where !== 'main') return { t, amp: this.pocket?.kind === 'meadow' ? 0.085 : 0.02, dir: [0.8, 0.6] };
    if (fl) return { t, amp: 0.035 * (1 + 2.2 * fl.train), dir: [0.3, 0.954] };
    return { t, amp: WIND[this.world], dir: [0.8, 0.6] };
  }

  private get openSky(): boolean {
    return this.level?.skyRoom !== undefined || this.flow !== null || this.decay.ceiling > 0;
  }

  /** Годится ли для давления помещение, где сейчас стоит игрок. */
  pressureHere(): boolean {
    return this.pressureRooms.has(this.room);
  }

  /** Начать давление в помещении, где стоит игрок (отладка, проверки). false — помещение не годится. */
  startPressure(kind: PressureKind): boolean {
    const room = this.pressureRooms.get(this.room);
    return !!this.pressure && !!room && this.beginPressure(kind, room);
  }

  private beginPressure(kind: PressureKind, room: PressureRoom): boolean {
    const pr = this.pressure!;
    if (!pr.start(kind, room, [this.body.x, this.body.z])) return false;
    this.onPressureStart();
    return true;
  }

  /** Событие началось: запомнить предметы помещения — фронт провала забирает их по очереди, от своего угла. */
  private onPressureStart(): void {
    const a = this.pressure?.active;
    this.pressureObjects = [];
    if (!a) return;
    if (a.kind === 'collapse') {
      const r = a.room;
      for (const i of this.illusions?.list ?? []) {
        const o = i.obj;
        const x = (o.min[0] + o.max[0]) / 2;
        const z = (o.min[2] + o.max[2]) / 2;
        // Только то, что стоит на этом полу: висящее на стенах и потолке остаётся.
        if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ || Math.abs(o.min[1] - r.floorY) > 0.3) continue;
        this.pressureObjects.push({ id: o.id, d: Math.hypot(x - a.origin[0], z - a.origin[1]) });
      }
      this.pressureObjects.sort((p, q) => p.d - q.d);
    }
    this.pressureEvents.push({ kind: a.kind, what: 'start', at: [(a.room.minX + a.room.maxX) / 2, a.room.floorY + 1, (a.room.minZ + a.room.maxZ) / 2] });
  }

  /** Шаг давления: режиссёр, фронт, пробуждение. */
  private stepPressure(dt: number, quiet: boolean, dream: DreamEvent[]): void {
    const pr = this.pressure;
    const s = this.session;
    if (!pr || this.where !== 'main' || !s || s.over) return;
    const b = this.body;
    const lap = 1 + Math.floor(this.wearBase / WEAR.lap + 1e-6);
    const all = PRESSURE_KINDS[this.world];
    // Первые два круга — не больше одного события за сессию и только провал (он учит знаку красной сетки).
    const early = lap <= 2;
    const kinds = !this.pressureAuto ? [] : early && all.includes('collapse') ? (['collapse'] as const) : all;
    const was = pr.active;
    const out = pr.update(dt, { time: this.time, pos: [b.x, b.z], room: this.transition ? null : (this.pressureRooms.get(this.room) ?? null), quiet: quiet || this.calm || this.swarmNear > 0.25, limit: early ? 1 : 3, kinds });
    if (!was && pr.active) this.onPressureStart();
    const a = pr.active;
    if (a && a.kind === 'collapse' && a.radius > 0) {
      // Фронт дошёл до предмета — пол под ним ушёл, и предмет рассыпается (как от касания, но место не стирается).
      while (this.pressureObjects.length > 0 && this.pressureObjects[0]!.d < a.radius) {
        const id = this.pressureObjects.shift()!.id;
        if (this.illusions?.touch(id)) dream.push({ type: 'touch', name: this.illusions.get(id)!.obj.name, what: 'gone' });
      }
    }
    if (pr.falling === 0) this.pressureEvents.push({ kind: 'collapse', what: 'fall', at: [b.x, b.y, b.z] });
    // Кадр дрожит тем сильнее, чем ближе конец.
    if (a || pr.falling >= 0) this.quake = Math.max(this.quake, 0.25 * pr.strain);
    if (out && this.jumps && !this.transition) {
      // Проснулся: снова там, где начал; искомая вещь остаётся на месте (как после встречи с Осыпью).
      this.wearGain += WEAR.caught;
      this.glitch = 1;
      this.pressureEvents.push({ kind: out === 'fell' ? 'collapse' : 'squeeze', what: 'woke', at: [b.x, b.y, b.z] });
      this.beginJump(this.jumps.forced('caught'), dream);
    }
    for (const e of this.pressureEvents) dream.push({ type: 'pressure', ...e });
    this.pressureEvents.length = 0;
  }

  private assignRooms(seed: number): void {
    const rooms = this.level?.layout?.rooms ?? [];
    const rng = mulberry32(hash2(seed, 0xf0, 0x0d));
    // В помещениях с газом особенностей нет: там игрок теряет сознание раньше, чем успеет их разглядеть.
    const gas = new Set(this.level?.layout?.hazards.gasRooms ?? []);
    // Начало вылазки и отдел остаются как есть: первое должно быть узнаваемым, второе — главное место офиса.
    const plain: readonly string[] = ['corridor', 'entrance', 'airlock', 'stairwell', 'collapsed', 'lift', 'reception', 'department'];
    const pool = rooms.filter((r) => !plain.includes(r.type) && !gas.has(r.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    // Стробу нужен простор: первое же помещение в две клетки и больше.
    const big = pool.findIndex((r) => r.cells.length >= 2);
    if (big > 0) [pool[0], pool[big]] = [pool[big]!, pool[0]!];
    const order: RoomFx[] = ['strobe', 'dark', 'thin', 'wire', 'thin', 'dark'];
    // В офисе особенных помещений меньше: его странность — в одинаковости.
    // В зале ожидания особенных помещений нет: его странность — время, а не комнаты.
    const share = this.level?.world === 'station' ? 0 : this.level?.world === 'office' ? 0.3 : 0.45;
    const n = Math.min(order.length, Math.ceil(pool.length * share));
    for (let i = 0; i < n; i++) this.roomFx.set(pool[i]!.id, order[i]!);
    for (const r of rooms) if (r.type === 'collapsed') this.roomFx.set(r.id, 'wire');
    // Комната под звёздным небом — тихое место: ни строба, ни темноты, ни сетки. (Снимается после
    // раздачи, а не до неё: остальным помещениям достаётся то же, что и раньше.)
    if (this.level?.skyRoom !== undefined) this.roomFx.delete(this.level.skyRoom);
  }

  /** Расставить вещи сна: мелочь по столам и полкам, крупное — посреди коридоров. */
  private placeThings(seed: number): void {
    const level = this.level;
    const s = this.session;
    if (!level || !s) return;
    const rng = mulberry32(hash2(seed, 0x7417, 0x65));
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)]!;
    const spots = level.spots.slice();
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j]!, spots[i]!];
    }
    // В «тёмных» помещениях фонарь не светит — рассмотреть там ничего нельзя: вещам там не место.
    const lit = spots.filter((sp) => this.roomFx.get(sp.room) !== 'dark');
    for (const sp of spots) if (this.roomFx.get(sp.room) === 'dark') s.reserve(sp);
    spots.length = 0;
    spots.push(...lit);
    const kinds = WORLD_THINGS[level.world ?? 'shelter'];
    // Не больше трети мест: остальные нужны вещам-воспоминаниям.
    const small = Math.min(9, Math.floor(spots.length / 3));
    for (let i = 0; i < small; i++) {
      const sp = spots[i]!;
      s.reserve(sp);
      const yaw = rng() * Math.PI * 2;
      // Чем сильнее стёрто место, тем меньше в нём мелочей (место при этом остаётся занятым: воспоминания ложатся как прежде).
      if (!keepsClutter(i, seed, this.wearBase)) continue;
      this.addThing(kinds.small[i % kinds.small.length]!, [sp.x, sp.y, sp.z], yaw, SMALL_FATES[i % SMALL_FATES.length]!);
    }
    // Крупные — в клетках коридора, где нет ни ям, ни воды, ни лестниц, поодаль друг от друга и от входа.
    const type = new Map((level.layout?.rooms ?? []).map((r) => [r.id, r.type]));
    const [sx, , sz] = level.spawn.pos;
    const chosen: Vec3[] = [];
    const nodes = level.nav.filter((n) => {
      if (type.get(n.room) !== 'corridor' || n.links.length < 2) return false;
      if (Math.hypot(n.x - sx, n.z - sz) < 7.5) return false;
      if (n.links.some((l) => Math.abs(level.nav[l]!.y - n.y) > 0.2)) return false;
      if (level.zones.some((z) => n.x >= z.minX - 1.5 && n.x <= z.maxX + 1.5 && n.z >= z.minZ - 1.5 && n.z <= z.maxZ + 1.5 && Math.abs(n.y - z.minY) < 3)) return false;
      return !level.collapses.some((c) => Math.hypot(c.center[0] - n.x, c.center[2] - n.z) < 4 && Math.abs(c.center[1] - n.y) < 1.5);
    });
    const want = 4 + (level.layout?.rank ?? 1);
    for (let k = 0; k < 60 && chosen.length < want && nodes.length > 0; k++) {
      const n = pick(nodes);
      if (chosen.some((c) => Math.hypot(c[0] - n.x, c[2] - n.z) < 10 && Math.abs(c[1] - n.y) < 1)) continue;
      const pos: Vec3 = [n.x, n.y, n.z];
      chosen.push(pos);
      const [kind, pocket] = kinds.big[(chosen.length + Math.floor(rng() * 3)) % kinds.big.length]!;
      const fate = BIG_FATES[chosen.length % BIG_FATES.length]!;
      const t = this.addThing(kind, pos, Math.floor(rng() * 4) * (Math.PI / 2), fate, false, true);
      this.thingPocket.set(t.id, pocket);
    }
  }

  /**
   * Сменить детали места, пока его не видно: мелкие вещи меняются местами и поворачиваются, крупные
   * встают задом наперёд (место и преграда у них те же), комната-аномалия неподалёку меняет
   * обстановку. Вещи воспоминаний и то, что уже меняется, не трогаются. Возвращает, сколько вещей изменилось.
   */
  private shiftDetails(): number {
    const b = this.body;
    const dist = (t: Thing): number => Math.hypot(t.pos[0] - b.x, t.pos[2] - b.z);
    const near = this.things.list.filter((t) => t.state === 'idle' && !t.memory && !t.still && dist(t) < DARK_SHIFT.range && Math.abs(t.pos[1] - b.y) < 3);
    const small = near.filter((t) => t.collider < 0);
    let changed = 0;
    if (small.length >= 2) {
      // По кругу: каждая встаёт на место другой.
      const by = 1 + Math.floor(this.rng() * (small.length - 1));
      const places = small.map((t) => t.pos);
      small.forEach((t, i) => {
        const p = places[(i + by) % small.length]!;
        t.pos = [p[0], p[1], p[2]];
      });
    }
    for (const t of small) {
      t.yaw = this.rng() * Math.PI * 2;
      changed += 1;
    }
    // Рядом с игроком крупное не трогаем: оно на виду даже в темноте — в него упираются.
    for (const t of near) {
      if (t.collider < 0 || dist(t) < 1.5 || this.rng() < 0.35) continue;
      t.yaw += Math.PI;
      changed += 1;
    }
    if (this.anomalies) {
      const node = this.playerNode();
      this.applyAnomalies(this.anomalies.flipInDark([b.x, b.y, b.z], node >= 0 ? this.level!.nav[node]!.room : -1));
    }
    return changed;
  }

  /** Поставить вещь в мир. solid — она мешает пройти, пока не начала меняться. */
  /**
   * Поставить вещь в мир. solid — она мешает пройти, пока не начала меняться. form — на какой она
   * ступени (0 — настоящая; картонка, проекция и кружево не держат, у них только датчик касания);
   * lift — высота её начала координат над полом (для снимка настенной вещи).
   */
  addThing(kind: string, pos: Vec3, yaw: number, fate: Fate, memory = false, solid = false, form: Form = FORM_REAL, lift = 0): Thing {
    const tm = formMesh(kind, form, hash2(Math.round(pos[0] * 10), Math.round(pos[2] * 10), 0x71) >>> 0, lift);
    const t = this.things.add(kind, pos, yaw, fate, tm.radius, memory);
    t.form = form;
    this.thingRender.set(t.id, this.renderer.addThing(tm.mesh, t.id, tm.look));
    if (solid) t.collider = this.thingBox(t, tm.w, tm.d, tm.h, form !== FORM_REAL);
    return t;
  }

  private dropThing(t: Thing): void {
    const id = this.thingRender.get(t.id);
    if (id !== undefined) this.renderer.removeThing(id);
    this.thingRender.delete(t.id);
    this.thingPocket.delete(t.id);
    if (t.collider >= 0) this.colliders.boxes[t.collider]!.off = true;
    this.things.remove(t);
  }

  private clearThings(): void {
    for (const t of [...this.things.list]) this.dropThing(t);
    this.things.clear();
    this.pocketThings = [];
    this.memoryThing = null;
    // Свет памяти уходит с вещами: в новом месте он не догорает.
    this.memLit = null;
    this.memLitK = 0;
    this.memLightDebug = null;
  }

  /** Фигура по ключу: из списка игры или поставленная отладкой. */
  figureSpec(id: string): FigureSpec | undefined {
    return this.figureExtra.get(id) ?? FIGURES.find((f) => f.id === id);
  }

  /** Убрать фигуры прошлого уровня и поставить фигуры этого (точки решила сборка уровня). */
  private setupFigures(level: BuiltLevel): void {
    for (const ids of this.figureRender.values()) for (const id of ids) this.renderer.removeThing(id);
    this.figureRender.clear();
    this.figures.clear();
    for (const spot of level.figures ?? []) {
      const spec = this.figureSpec(spot.id);
      if (spec) this.addFigure(spec, spot.at, spot.yaw, spot.k);
    }
  }

  /** Поставить фигуру: части — отдельными вещами рендера (у волосатой — части тела, у остальных — целиком). */
  addFigure(spec: FigureSpec, at: Vec3, yaw: number, k = 0): FigureLive {
    const seed = hash2(spec.id.length * 131 + k, Math.round(at[0] * 10) ^ Math.round(at[2] * 10), 0x6f16) >>> 0;
    const fm = figureMesh(spec.pose, spec.material, seed);
    const f = this.figures.add(spec.id, k, spec.material, at, yaw, fm.core, fm.pieces, fm.dots);
    this.figureRender.set(
      f,
      fm.pieces.map((p, i) => this.renderer.addThing(p.data, (seed + i * 17) % 9973, 'matter')),
    );
    return f;
  }

  /** Отладка: поставить фигуру, которой нет в списке игры (__vz.figure). */
  addDebugFigure(spec: FigureSpec, at: Vec3, yaw: number): FigureLive {
    this.figureExtra.set(spec.id, spec);
    return this.addFigure(spec, at, yaw, this.figures.list.filter((f) => f.id === spec.id).length);
  }

  /** Шаг фигур: подошёл — ушли; отошёл (дым) или свет погас и зажёгся (остальные) — вернулись. */
  private stepFigures(dt: number, eye: Vec3, dream: DreamEvent[]): void {
    if (this.figures.list.length === 0) return;
    const ev = this.figures.update(dt, eye, this.time, (f) => this.lightAt(this.playerNodeAt(f.at)));
    for (const e of ev) dream.push({ type: 'figure', id: e.figure.id, material: e.figure.material, what: e.what, at: e.figure.core });
  }

  /** Следующая сессия готова: как только лимбо отпустит, игрок окажется в ней. */
  queueSession(level: BuiltLevel, dream: DreamSeed): void {
    this.pending = { level, dream };
  }

  /**
   * Сон из сцен: следующая сцена готова (другое место). Когда в этой сцене вспомнено всё, игрок уйдёт
   * туда, а не в лимбо. null — сцен больше нет: дальше лимбо.
   */
  queueScene(level: BuiltLevel | null, dream: DreamSeed | null = null): void {
    this.sceneNext = level && dream ? { level, dream } : null;
  }

  /** Есть ли готовая следующая сцена (для проверок). */
  get sceneQueued(): boolean {
    return this.sceneNext !== null;
  }

  /** Сонар: изредка волна от игрока проходит по тихому слою и на миг показывает план — и сквозь стены. */
  private stepSonar(): void {
    if (this.sonarT0 >= 0 && (this.time - this.sonarT0) * SONAR_SPEED > SONAR_REACH) this.sonarT0 = -1;
    if (this.where !== 'main' || this.transition || !this.level?.edges) return;
    if (this.sonarT0 < 0 && this.time >= this.sonarAt) {
      const b = this.body;
      this.sonarPos = [b.x, b.y + 1.2, b.z];
      this.sonarT0 = this.time;
      this.sonarN += 1;
      this.sonarFresh = true;
      // Свой счёт, не общий генератор игры: волна не сдвигает ни вещей, ни Осыпи.
      const k = hash01(this.sonarN, 0x50a7, this.dreamSeed ^ 0x5011a2);
      this.sonarAt = this.time + SONAR_EVERY[0] + k * (SONAR_EVERY[1] - SONAR_EVERY[0]);
    }
  }

  /** Волна для рендера: откуда, радиус и сила; null — волны нет. */
  private sonarView(): readonly [number, number, number, number, number] | null {
    if (this.sonarT0 < 0 || this.where !== 'main') return null;
    const r = (this.time - this.sonarT0) * SONAR_SPEED;
    if (r > SONAR_REACH) return null;
    return [this.sonarPos[0], this.sonarPos[1], this.sonarPos[2], r, 1 - smoothstep(SONAR_REACH * 0.6, SONAR_REACH, r)];
  }

  /** Отладка и проверки: пустить волну сонара на ближайшем шаге. */
  pingSonar(): void {
    this.sonarT0 = -1;
    this.sonarAt = this.time;
  }

  /** Отладка: немедленно вернуться в убежище (карманное пространство и идущий скачок сбрасываются). */
  debugHome(): void {
    if (this.where === 'limbo') return;
    this.leavePocket();
    this.where = 'main';
    this.env = this.worldEnv;
    this.transition = null;
  }

  /** Отладка: считать всё вспомненным — через полсекунды место рассыплется. */
  debugFinish(): void {
    const s = this.session;
    if (!s || s.over) return;
    for (const m of s.memories) m.state = 'done';
    s.over = true;
    if (this.memoryThing) {
      this.memoryThing.memory = false;
      this.things.change(this.memoryThing, 'dust');
      this.memoryThing = null;
    }
    this.endIn = 0.5;
  }

  /** Начать скачок. Если один уже идёт — этот не начинается. */
  beginJump(plan: JumpPlan, dream: DreamEvent[]): boolean {
    if (this.transition) return false;
    this.swarmCaught = false;
    const [out, back] = TIMING[plan.style];
    this.transition = { plan, t: 0, out, back, switched: false };
    dream.push({ type: 'jump', plan, phase: 'start' });
    return true;
  }

  /** Узел убежища подальше от from (−1 — от входа): туда возвращает скачок. */
  private farNode(from: number): number {
    const nav = this.level?.nav ?? [];
    if (nav.length === 0) return -1;
    const start = from >= 0 ? from : this.playerNodeAt(this.spawn.pos);
    const far = start >= 0 ? nodesInRange(nav, start, 6, 40) : [];
    const pool = (far.length > 0 ? far : nav.map((n) => n.id)).filter((id) => {
      const n = nav[id]!;
      // Не на лестничный марш и не в яму.
      if (n.links.some((l) => Math.abs(nav[l]!.y - n.y) > 0.2)) return false;
      return !this.level!.zones.some((z) => z.kind === 'pit' && n.x >= z.minX - 1 && n.x <= z.maxX + 1 && n.z >= z.minZ - 1 && n.z <= z.maxZ + 1 && Math.abs(n.y - z.minY) < 3);
    });
    return pool.length > 0 ? pool[Math.floor(this.rng() * pool.length)]! : start;
  }

  /** Рассеянный свет там, где стоит игрок: в убежище — почти ноль, в офисе — свет панели над ним. */
  get ambientHere(): number {
    const a = this.env.ambient;
    return ((a[0] + a[1] + a[2]) / 3) * this.ambientLocal;
  }

  /** Есть ли здесь у игрока фонарь: в офисе его нет — свет даёт само место. */
  get hasLight(): boolean {
    return this.env.light > 0;
  }

  /** Узел, в клетке которого вылазка началась (−1 — вне графа). */
  playerNodeAtSpawn(): number {
    return this.playerNodeAt(this.spawn.pos);
  }

  private playerNodeAt(p: Vec3): number {
    const cx = Math.round(p[0] / 3) + 8;
    const cz = Math.round(p[2] / 3) + 8;
    const t = Math.max(0, Math.round(-p[1] / 4.5));
    for (const tier of [t, t - 1, t + 1]) {
      const id = this.nodeAt.get(`${tier},${cx},${cz}`);
      if (id !== undefined) return id;
    }
    return -1;
  }

  /** Убрать карманное пространство: его геометрию, преграды и вещи. */
  private leavePocket(): void {
    if (!this.pocket) return;
    this.colliders.setGroup(`pocket${this.pocketGroup}`, false);
    this.renderer.setPocket(null);
    for (const t of this.pocketThings) this.dropThing(t);
    this.pocketThings = [];
    this.pocket = null;
  }

  /** Что пространству надо знать об игре: план убежища, где лежит искомая вещь и откуда игрока унесло. */
  private pocketContext(limbo: boolean): PocketContext {
    const nav = this.level?.nav ?? [];
    const cells: ModelCell[] = [];
    for (const r of this.level?.layout?.rooms ?? []) for (const [x, z] of r.cells) cells.push({ x, z, tier: r.tier, type: r.type, room: r.id });
    const cellOf = (id: number): { x: number; z: number; tier: number } | null => {
      const n = nav[id];
      return n ? { x: n.cx, z: n.cz, tier: n.tier } : null;
    };
    const spot = this.session?.active?.spot;
    return { cells, target: spot ? cellOf(this.playerNodeAt([spot.x, spot.y, spot.z])) : null, here: cellOf(this.returnNode), limbo };
  }

  /** Узел в двух-четырёх клетках пути от искомой вещи: туда выводит дверь на лугу. −1 — искать нечего. */
  private nodeNearThing(): number {
    const spot = this.session?.active?.spot;
    const nav = this.level?.nav ?? [];
    if (!spot) return -1;
    const at = this.playerNodeAt([spot.x, spot.y, spot.z]);
    if (at < 0) return -1;
    const gas = new Set(this.level?.layout?.hazards.gasRooms ?? []);
    const pool = nodesInRange(nav, at, 2, 4).filter((id) => {
      const n = nav[id]!;
      return !gas.has(n.room) && !this.roomFx.has(n.room) && !this.level!.zones.some((z) => n.x >= z.minX - 1.2 && n.x <= z.maxX + 1.2 && n.z >= z.minZ - 1.2 && n.z <= z.maxZ + 1.2 && Math.abs(n.y - z.minY) < 3);
    });
    return pool.length > 0 ? pool[Math.floor(this.rng() * pool.length)]! : at;
  }

  private enterPocket(kind: PocketKind, limbo: boolean): void {
    this.leavePocket();
    const p = buildPocket(kind, (this.dreamSeed + this.pocketGroup * 7919) >>> 0, POCKET_ORIGIN, this.pocketContext(limbo));
    this.pocket = p;
    this.pocketGroup += 1;
    const group = `pocket${this.pocketGroup}`;
    for (const b of p.colliders) this.colliders.add({ ...b, group });
    this.renderer.setPocket(p.meshes);
    this.where = limbo ? 'limbo' : 'pocket';
    this.env = p.env;
    this.pocketAge = 0;
    this.pocketStay = 46 + this.rng() * 14;
    this.pocketDone = false;
    this.focusGaze = 0;
    this.holdThing = null;
    this.holdT = 0;
    this.heard.clear();
    this.blanks = [];
    this.limboTime = 0;
    this.limboAsked = false;
    this.teleport(p.spawn.pos[0], p.spawn.pos[1], p.spawn.pos[2], p.spawn.yaw, p.spawn.pitch ?? 0);
    if (kind === 'void' && !limbo) {
      // Белое нигде посреди сессии: перед игроком дугой лежит то, что он уже вспомнил, а на месте
      // остального стоят белые болванки. Экспонаты под взглядом не меняются.
      const mem = this.session?.memories ?? [];
      const [sx, sy, sz] = p.spawn.pos;
      mem.forEach((m, i) => {
        const a = ((i - (mem.length - 1) / 2) * 24 * Math.PI) / 180;
        const at: Vec3 = [sx + Math.sin(a) * 3.4, sy, sz - Math.cos(a) * 3.4];
        const done = m.state === 'done';
        const tm = thingMesh(done ? m.def.thing : 'blank', 7);
        const t = this.things.add(done ? m.def.thing : 'blank', at, done ? a + 0.4 : 0, 'dust', tm.radius, false, true);
        this.thingRender.set(t.id, this.renderer.addThing(tm.mesh, t.id));
        this.pocketThings.push(t);
        if (!done) this.blanks.push(t);
      });
      return;
    }
    // Вещи: в лимбо — всё, что игрок вспомнил раньше; на лугу и в домике — пара случайных мелочей.
    // Вспомненное в лимбо — экспонаты: под взглядом не растёт и не рассыпается в точки. Вещь памяти —
    // та, что проработана сильнее всего (ideas.md, V-33); её разглядывают, а не проходят насквозь
    // (противоречие 109). Строку она не повторяет: вспышка легла бы на строки лимбо.
    const kinds = limbo ? this.archive.map((id) => MEMORY_THING[id] ?? id) : [SMALL_THINGS[Math.floor(this.rng() * SMALL_THINGS.length)]!, SMALL_THINGS[Math.floor(this.rng() * SMALL_THINGS.length)]!];
    kinds.slice(0, p.spots.length).forEach((kind, i) => {
      const sp = p.spots[i]!;
      const t = this.addThing(kind, sp, this.rng() * Math.PI * 2, limbo ? 'dust' : SMALL_FATES[i % SMALL_FATES.length]!);
      t.still = limbo;
      this.pocketThings.push(t);
    });
  }

  /**
   * Смысл пространства. Кукольный домик — макет убежища: посветил на него — узнал, где лежит искомое.
   * Белое нигде — то, что сохранено: взгляд на вспомненную вещь повторяет её строку, взгляд на болванку
   * вызывает следующее воспоминание (или напоминает, что ищешь сейчас). Луг — передышка: паника уходит,
   * а дверь выводит поближе к искомому (это решает выход, не здесь).
   */
  private pocketPurpose(dt: number, look: Look, los: (from: Vec3, to: Vec3) => number, dream: DreamEvent[]): void {
    const p = this.pocket;
    const s = this.session;
    if (!p) return;
    if (p.kind === 'meadow' && s) s.panic = Math.max(0, s.panic - dt * 0.22);
    if (p.focus && !this.pocketDone) {
      this.focusGaze = looksAt(look, p.focus, 0.45, 4.5, los) ? this.focusGaze + dt : Math.max(0, this.focusGaze - dt * 2);
      if (this.focusGaze > 1.3) {
        this.pocketDone = true;
        const act = s?.active;
        const node = act?.spot ? this.level?.nav[this.playerNodeAt([act.spot.x, act.spot.y, act.spot.z])] : undefined;
        const room = node ? this.level?.layout?.rooms.find((r) => r.id === node.room)?.type : undefined;
        dream.push(act && node ? { type: 'pocket', kind: p.kind, what: 'map', memory: act.def.id, room: room ?? 'corridor', tier: node.tier } : { type: 'pocket', kind: p.kind, what: 'map' });
        this.pocketStay = Math.min(this.pocketStay, this.pocketAge + 14);
      }
    }
    if (p.kind === 'void' && this.where !== 'limbo') {
      // Экспонат «звучит», когда на него посмотрели подольше; каждый — один раз за заход. В лимбо — нет.
      const seen = this.pocketThings.find((t) => t.still && t.gaze >= 1 && !this.heard.has(t.id)) ?? null;
      if (seen !== this.holdThing) {
        this.holdThing = seen;
        this.holdT = 0;
      } else if (seen) {
        this.holdT += dt;
        if (this.holdT > 0.9) {
          this.heard.add(seen.id);
          this.holdThing = null;
          if (!this.blanks.includes(seen)) {
            const m = s?.memories.find((x) => x.def.thing === seen.kind && x.state === 'done');
            if (m) dream.push({ type: 'pocket', kind: 'void', what: 'replay', memory: m.def.id });
          } else if (!this.pocketDone) {
            this.pocketDone = true;
            for (const b of this.blanks) this.heard.add(b.id);
            const act = s?.active;
            if (act) dream.push({ type: 'pocket', kind: 'void', what: 'remind', memory: act.def.id });
            else if (s?.hurry()) dream.push({ type: 'pocket', kind: 'void', what: 'next' });
            this.pocketStay = Math.min(this.pocketStay, this.pocketAge + 14);
          }
        }
      }
    }
  }

  /** Исполнить скачок: переставить игрока и сменить место. */
  private switchPlace(plan: JumpPlan, dream: DreamEvent[]): void {
    const to = plan.to;
    if (to === 'session') {
      const next = this.pending;
      if (next) {
        const scene = this.sceneSwitch;
        this.sceneSwitch = false;
        this.loadLevel(next.level, next.dream);
        dream.push(scene ? { type: 'begin', scene: true } : { type: 'begin' });
      }
    } else if (to === 'limbo') {
      // Вещи убежища больше не нужны: сессия кончилась.
      this.clearThings();
      this.enterPocket('void', true);
    } else if (to === 'elsewhere') {
      const from = this.where === 'main' ? this.playerNode() : this.returnNode;
      this.leavePocket();
      this.where = 'main';
      this.env = this.worldEnv;
      // После скачка план показывает волна: где я теперь.
      this.sonarAt = Math.min(this.sonarAt, this.time + 1.2);
      if (plan.dest === 'start') {
        // Осыпь возвращает в начало: игрок снова там, где вылазка началась, лицом туда же. Искомая вещь
        // остаётся, где была, — до неё надо дойти заново. Сама Осыпь остаётся там, где дотянулась, и
        // теряет игрока; если это было ближе шести клеток пути от начала — отходит, чтобы не поймать тут же снова.
        this.respawn();
        const sw = this.swarm;
        const home = this.playerNodeAtSpawn();
        if (sw && home >= 0) {
          const hops = sw.node >= 0 ? sw.route(sw.node, home).length - 1 : -1;
          const away = hops >= 0 && hops < 6 ? sw.nodeAround(home, 8, 14) : sw.node;
          sw.activate(away >= 0 ? away : sw.nodeAround(home, 4, 30));
          this.swarmBody.snap(sw.pos, 0);
        }
      } else {
        // Проём выводит туда, куда обещал (обратно или к искомой вещи); если пространство отпустило само —
        // иногда туда же, откуда унесло, чаще в другое место.
        const near = plan.dest === 'thing' ? this.nodeNearThing() : -1;
        const back = plan.dest === 'back' || (plan.dest === undefined && plan.cause === 'return' && this.rng() < 0.3);
        const id = near >= 0 ? near : back && this.returnNode >= 0 ? this.returnNode : this.farNode(from);
        const n = this.level?.nav[id];
        if (n) {
          const l = this.level!.nav[n.links[Math.floor(this.rng() * n.links.length)] ?? n.id]!;
          this.teleport(n.x, n.y, n.z, l === n ? this.aimYaw : Math.atan2(-(l.x - n.x), -(l.z - n.z)), 0);
        } else this.respawn();
      }
    } else {
      if (this.where === 'main') this.returnNode = this.playerNode();
      this.enterPocket(to, false);
      dream.push({ type: 'pocket', kind: to, what: 'enter', ...(this.session?.active ? { memory: this.session.active.def.id } : {}) });
    }
    this.observed = true;
    dream.push({ type: 'jump', plan, phase: 'switch' });
  }

  /** Узел навигации, в клетке которого стоит игрок (−1 — вне графа). */
  playerNode(): number {
    const b = this.body;
    const cx = Math.round(b.x / 3) + 8;
    const cz = Math.round(b.z / 3) + 8;
    const t = Math.max(0, Math.round(-b.y / 4.5));
    // На лестнице высота между ярусами: узлы марша числятся за верхним ярусом.
    for (const tier of [t, t - 1, t + 1]) {
      const id = this.nodeAt.get(`${tier},${cx},${cz}`);
      if (id !== undefined) return id;
    }
    return -1;
  }

  /** Сдвинуть игрока, не дёрнув камеру (аномалия лестницы). */
  shiftPlayer(dx: number, dy: number, dz: number): void {
    const b = this.body;
    b.x += dx;
    b.y += dy;
    b.z += dz;
    this.prevX += dx;
    this.prevY += dy;
    this.prevZ += dz;
    this.rig.shift(dy);
  }

  /** Применить события аномалий к миру. */
  applyAnomalies(events: readonly AnomalyEvent[]): void {
    for (const e of events) {
      if (e.type === 'shift') this.shiftPlayer(e.dx, e.dy, e.dz);
      else {
        this.renderer.setChunkVisible(e.variant.chunkA, !e.alt);
        this.renderer.setChunkVisible(e.variant.chunkB, e.alt);
        this.colliders.setGroup(e.variant.groupA, !e.alt);
        this.colliders.setGroup(e.variant.groupB, e.alt);
      }
    }
  }

  /** Восстановить аномалии из сохранения. */
  restoreAnomalies(state: AnomalyState): void {
    if (this.anomalies) this.applyAnomalies(this.anomalies.restore(state));
  }

  /** Луч фонаря лежит на рое: в конусе, близко и без преград. */
  /**
   * Держит ли игрок Осыпь. В тёмном месте её держит луч фонаря: он пересвечивает её, и она выгорает.
   * В светлом (офис, зал ожидания) фонаря нет — её держит взгляд: пока она в середине взгляда, она стоит,
   * а продержишь — рассыплется. В зале ожидания взгляд стоящего не считается: он смотрит на снимок, то
   * есть на то, где она была, — держать её можно только на ходу.
   */
  private beamOnSwarm(): boolean {
    const sw = this.swarm;
    const rig = this.lastRig;
    if (!sw || !rig) return false;
    const byGaze = this.env.light <= 0;
    if (byGaze ? this.flow?.frozen === true : this.light.intensity < 0.3) return false;
    const [lx, ly, lz] = byGaze ? rig.camPos : rig.lightPos;
    const tx = sw.pos[0] - lx;
    const ty = sw.pos[1] + 0.2 + sw.cohesion * 0.9 - ly;
    const tz = sw.pos[2] - lz;
    const d = Math.hypot(tx, ty, tz);
    if (d > 16 || d < 0.2) return false;
    const dot = (tx * rig.lightDir[0] + ty * rig.lightDir[1] + tz * rig.lightDir[2]) / d;
    // Широкий допуск вблизи: рой крупный, а луч у самой фигуры узкий.
    if (dot < (d < 4 ? 0.9 : 0.975)) return false;
    return this.colliders.raycast(lx, ly, lz, tx / d, ty / d, tz / d, d) >= d - 0.4;
  }

  /**
   * Куда потечёт рассыпавшаяся Осыпь: ломаная от её места по узлам пути к искомой вещи.
   * null — искать нечего или пути нет.
   */
  private flowToMemory(): { path: Vec3[]; t: number } | null {
    const sw = this.swarm;
    const spot = this.session?.active?.spot;
    if (!sw || !spot || !this.level || sw.node < 0) return null;
    const goal = this.playerNodeAt([spot.x, spot.y, spot.z]);
    const route = goal >= 0 ? sw.route(sw.node, goal) : [];
    if (route.length < 2) return null;
    const path: Vec3[] = [[sw.pos[0], sw.pos[1], sw.pos[2]]];
    for (const id of route.slice(1)) {
      const n = this.level.nav[id]!;
      path.push([n.x, n.y, n.z]);
    }
    return { path, t: 0 };
  }

  /** Узел для явления роя: в 3–5 клетках, на виду у игрока. −1 — подходящего нет. */
  private apparitionNode(from: number): number {
    const sw = this.swarm;
    const rig = this.lastRig;
    if (!sw || !rig || from < 0 || !this.level) return -1;
    for (let i = 0; i < 8; i++) {
      const n = sw.nodeAround(from, 3, 5);
      const node = this.level.nav[n];
      if (!node) continue;
      const dx = node.x - rig.camPos[0];
      const dy = node.y + 1.3 - rig.camPos[1];
      const dz = node.z - rig.camPos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 6 || this.colliders.raycast(rig.camPos[0], rig.camPos[1], rig.camPos[2], dx / d, dy / d, dz / d, d) < d - 0.5) continue;
      return n;
    }
    return -1;
  }

  /**
   * Откуда слышна пугалка. Стук — из соседнего помещения, шаги — из-за спины. Рация и мигание
   * источника в мире не имеют.
   */
  private scareSource(id: ScareId, from: number): Vec3 | null {
    const b = this.body;
    if (id === 'steps') return [b.x + Math.sin(this.aimYaw) * 4.5, b.y + 0.1, b.z + Math.cos(this.aimYaw) * 4.5];
    const range = id === 'knock' ? ([2, 3] as const) : null;
    if (!range || !this.level) return null;
    const near = nodesInRange(this.level.nav, from, range[0], range[1]);
    this.scareCount += 1;
    const n = this.level.nav[near[hash2(this.scareCount, from, 77) % Math.max(1, near.length)] ?? -1];
    // Некуда поместить (тупик, игрок вне графа) — звук приходит просто издалека, из-за спины.
    return n ? [n.x, n.y + 1.2, n.z] : [b.x + Math.sin(this.aimYaw) * 9, b.y + 1, b.z + Math.cos(this.aimYaw) * 9];
  }

  /** Ложное событие: толчок, помехи, мигание — без урона. Звук подключается по id. */
  private applyScare(id: ScareId): void {
    const s = this.session;
    if (id === 'steps') s?.scare(0.05);
    else if (id === 'knock') s?.scare(0.08);
    else if (id === 'radio') {
      this.glitch = Math.max(this.glitch, 0.55);
      s?.scare(0.05);
    } else if (id === 'flicker') {
      this.light.stutter(0.7);
      s?.scare(0.05);
    } else {
      // Надписи вспыхивают и гаснут.
      this.glowTimer = 14;
      s?.scare(0.07);
    }
  }

  respawn(): void {
    const [x, y, z] = this.spawn.pos;
    this.teleport(x, y, z, this.spawn.yaw, 0);
  }

  teleport(x: number, y: number, z: number, yaw = this.aimYaw, pitch = this.aimPitch): void {
    this.body = createBody(x, y, z);
    this.prevX = x;
    this.prevY = y;
    this.prevZ = z;
    this.aimYaw = yaw;
    this.aimPitch = pitch;
    this.rig.snap({ x, y, z, aimYaw: yaw, aimPitch: pitch, speed: 0, onGround: true, panic: this.panic, shake: 0 });
  }

  get panic(): number {
    return this.session?.panic ?? 0;
  }

  /** Навести луч и камеру на точку мира с того места, где игрок стоит сейчас. */
  aimAt(x: number, y: number, z: number): void {
    const b = this.body;
    const dx = x - b.x;
    const dz = z - b.z;
    this.teleport(b.x, b.y, b.z, Math.atan2(-dx, -dz), clamp(Math.atan2(y - (b.y + 1.42), Math.hypot(dx, dz)), -MAX_PITCH, MAX_PITCH));
  }

  /** Поворот луча: применяется сразу, без ожидания шага симуляции. */
  look(yaw: number, pitch: number): void {
    this.aimYaw += yaw;
    this.aimPitch = clamp(this.aimPitch + pitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Идёт скачок: кадр рвётся или растворяется, игроку не до подсказок. */
  get jumping(): boolean {
    return this.transition !== null;
  }

  /**
   * Насколько карманное пространство ещё держится, 1..0,2: с середины срока оно редеет (точек всё
   * меньше) — так видно, что время здесь кончается. В убежище и в лимбо — всегда 1.
   */
  get pocketFade(): number {
    if (this.where !== 'pocket' || !this.pocket) return 1;
    const k = clamp((this.pocketAge / this.pocketStay - 0.5) / 0.5, 0, 1);
    return 1 - 0.8 * k * k * (3 - 2 * k);
  }

  /** Насколько сейчас видно вокруг: свет фонаря в этом месте или рассеянный свет. */
  private get seeing(): number {
    // Рассеянный свет — тот, что есть здесь на самом деле: под погасшей панелью офиса его нет.
    const amb = ((this.env.ambient[0] + this.env.ambient[1] + this.env.ambient[2]) / 3) * this.ambientLocal;
    return Math.max(this.light.intensity * this.env.light * this.fxLight, amb > 0.2 ? 1 : 0);
  }

  step(dt: number, input: InputFrame): StepEvents {
    this.time += dt;
    this.stepSonar();
    this.fade = approach(this.fade, this.fadeTo, this.fadeTo > this.fade ? 0.5 : 0.25, dt);
    this.quake = Math.max(0, this.quake - dt * 1.4);
    const s = this.session;
    const b = this.body;
    this.prevX = b.x;
    this.prevY = b.y;
    this.prevZ = b.z;

    // Движение — в осях луча: «вперёд» туда, куда светишь.
    const sin = Math.sin(this.aimYaw);
    const cos = Math.cos(this.aimYaw);
    const wishX = cos * input.moveX - sin * input.moveZ;
    const wishZ = -sin * input.moveX - cos * input.moveZ;
    const speed = (input.run ? RUN_SPEED : WALK_SPEED) * (s?.inWater ? WATER_SPEED : 1);
    this.touched.clear();
    const res = stepPlayer(b, wishX, wishZ, speed, dt, this.colliders, DEFAULT_CONTROLLER, this.touched);
    // Выпал из мира (ушёл за край пространства) — возвращаем на место появления.
    if (res.fellOut) {
      if (this.pocket) this.teleport(this.pocket.spawn.pos[0], this.pocket.spawn.pos[1], this.pocket.spawn.pos[2], this.aimYaw, 0);
      else this.respawn();
    }

    // Неподвижность: не идёт и не водит взглядом.
    if (Math.hypot(b.vx, b.vz) > 0.25 || input.lookYaw !== 0 || input.lookPitch !== 0) this.stillFor = 0;
    else this.stillFor += dt;

    // Зал ожидания: время места идёт вместе с игроком. Стоя он видит снимок; первый шаг (или слишком
    // долгая неподвижность) рвёт его — кадр дёргается, всё встаёт туда, где оно есть на самом деле.
    // wdt — время места за этот шаг: на нём живёт всё, что в зале меняется. В остальных мирах wdt = dt.
    let wdt = dt;
    const fl = this.where === 'main' ? this.flow : null;
    if (fl) {
      const r = fl.update(dt, Math.hypot(b.vx, b.vz));
      wdt = r.wdt;
      if (r.tore > 0) {
        this.lastTear = r.tore;
        // Снимок порвался: помеха — и прошлый кадр ещё секунду тянется поверх нового (разрыв кадра).
        this.glitch = Math.max(this.glitch, 0.2 + 0.4 * r.tore);
        this.mosh = Math.max(this.mosh, 0.8 * r.tore);
      }
    }

    // Фонарь. Там, где его нет (офис: свет даёт место), кнопка ничего не делает и глохнуть нечему.
    this.light.suspended = !this.hasLight;
    const wasOff = this.light.state === 'off';
    const toggled = input.light && this.hasLight;
    // Щелчок фонаря волну эха не пускает (решение партнёра: эхо — только без фонаря и на ходу).
    if (toggled) this.light.toggle();
    const level = this.shake.update(dt);
    const ev = this.light.update(dt, { panic: this.panic, wet: s?.inWater ? 1 : 0, swarm: this.swarmNear, shake: level });
    const strokes = this.shake.strokes - this.lastStrokes;
    this.lastStrokes = this.shake.strokes;

    // Темнота. Мир держится светом: пока фонарь не светит, место растворяется (это показывает рендер),
    // а когда растворилось — собираться прежним оно не обязано. Детали меняются: первый раз — когда
    // место успело исчезнуть, дальше — каждые несколько секунд, пока темно.
    if (this.where === 'main' && this.light.intensity * this.fxLight < 0.15 && this.ambientHere < 0.08) {
      this.darkFor += dt;
      if (this.darkFor >= DARK_SHIFT.first + this.darkShifts * DARK_SHIFT.every) {
        this.darkShifts += 1;
        this.detailShifts += this.shiftDetails();
      }
    } else {
      this.darkFor = 0;
      this.darkShifts = 0;
    }

    const out: SessionEvent[] = [];
    const fear: FearEvent[] = [];
    const dream: DreamEvent[] = [];
    if (this.sonarFresh) {
      this.sonarFresh = false;
      dream.push({ type: 'sonar' });
    }
    const eye: Vec3 = this.lastRig ? this.lastRig.camPos : [b.x, b.y + 1.42, b.z];
    const aim: Vec3 = this.lastRig ? this.lastRig.lightDir : dirFromAngles(this.aimYaw, this.aimPitch);
    const los = (from: Vec3, to: Vec3): number => {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const dz = to[2] - from[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      return this.colliders.raycast(from[0], from[1], from[2], dx / d, dy / d, dz / d, d);
    };
    const look: Look = { eye, aim, light: this.seeing };
    const node = this.where === 'main' ? this.playerNode() : -1;
    this.room = node >= 0 ? this.level!.nav[node]!.room : -1;

    // Всё иллюзорно: чего коснулся — растворяется; что растворилось — вернётся, когда свет погаснет и зажжётся.
    if (this.where === 'main') this.stepIllusions(wdt, dream);

    // Вещи: под взглядом уменьшаются, рассыпаются, растут.
    for (const e of this.things.update(wdt, look, [b.x, b.y, b.z], los)) {
      const t = e.thing;
      if (e.type === 'noticed') this.observed = true;
      else if (e.type === 'changing') {
        if (t.collider >= 0) this.colliders.boxes[t.collider]!.off = true;
        dream.push({ type: 'thing', thing: t, what: 'changing' });
      } else if (e.type === 'settled') dream.push({ type: 'thing', thing: t, what: 'settled' });
      else if (this.jumps && s && !s.over) this.beginJump(this.jumps.onEngulf(this.thingPocket.get(t.id) ?? null), dream);
    }

    // Сессия: воспоминания и среда.
    if (s && this.where !== 'limbo') {
      // В зале ожидания вспомнить можно только стоя, на снимке: взгляд держит вещь настоящее время, пока игрок стоит.
      const hold = fl ? { holdDt: fl.frozen ? dt : 0 } : {};
      out.push(...s.update(wdt, { pos: [b.x, b.y, b.z], eye, aim, light: look.light, node, swarm: this.swarmNear, observed: this.observed, landed: res.landed, hidden: this.memoryThing !== null && this.memoryThing.state !== 'idle', ...hold }, los));
      this.observed = false;
    }
    for (let i = 0; i < out.length; i++) this.applySessionEvent(out[i]!, out, dream, node);

    const quiet = this.where !== 'main' || this.transition !== null;
    if (s && !s.over && !this.calm && !quiet) this.stepFear(wdt, input, level, fear, dream);
    else this.swarmNear = this.calm ? 0 : approach(this.swarmNear, 0, 0.5, dt);

    // Давление помимо Осыпи: пол рассыпается, потолок опускается; не успел — проснулся в начале.
    this.stepPressure(wdt, quiet, dream);
    if (this.where === 'main') this.stepBirds(wdt, dream);
    if (this.where === 'main' && !this.transition) this.stepFigures(dt, eye, dream);

    // Зал ожидания: за краем перрона ничего нет. Шагнул — проснулся в начале; искомая вещь остаётся на
    // месте. (Зоны падения сессии здесь не годятся: над путями нет узлов графа, и она их не проверяет.)
    if (fl && b.y < -0.8 && this.jumps && s && !s.over && !this.transition) {
      this.wearGain += WEAR.caught;
      this.glitch = 1;
      this.beginJump(this.jumps.forced('caught'), dream);
    }
    // Зал ожидания: стемнело — зал закрывается. Проснулся в начале, день начинается заново.
    if (fl && fl.night && this.jumps && s && !s.over && !this.transition) {
      this.wearGain += WEAR.caught;
      this.glitch = 1;
      fl.restart();
      this.beginJump(this.jumps.forced('caught'), dream);
    }

    // Поводы для скачка: простые действия и наблюдения.
    const jumps = this.jumps;
    if (jumps && s && !s.over && !this.calm && !quiet) {
      jumps.update(wdt);
      let plan: JumpPlan | null = null;
      if (toggled && wasOff && this.light.state === 'on') plan = jumps.onLightOn();
      if (!plan && ev.revived) plan = jumps.onRevive();
      if (!plan) plan = jumps.onDark(dt, look.light < 0.05 && this.ambientHere < 0.05, Math.hypot(b.vx, b.vz) < 0.3);
      if (!plan) {
        // «Тонкое» помещение: постоял в нём — оно рассыпается.
        const thin = this.roomFx.get(this.room) === 'thin' && !this.thinUsed.has(this.room);
        this.thinTime = thin ? this.thinTime + dt : 0;
        if (thin && this.thinTime > 2.5) {
          plan = jumps.onThin();
          if (plan) this.thinUsed.add(this.room);
        }
      }
      if (plan) this.beginJump(plan, dream);
    }

    // Всё вспомнено: чуть погодя место рассыпается, игрок попадает в лимбо.
    if (this.endIn >= 0 && !this.transition) {
      this.endIn -= dt;
      if (this.endIn < 0) {
        // Сон из сцен: следующая сцена готова — свет гаснет, и вокруг уже другое место. Иначе — лимбо.
        const next = this.sceneNext;
        if (next) {
          this.pending = next;
          this.sceneNext = null;
          this.sceneSwitch = true;
          this.beginJump({ cause: 'end', style: 'blackout', to: 'session' }, dream);
        } else this.beginJump({ cause: 'end', style: 'dissolve', to: 'limbo' }, dream);
      }
    }

    // Карманное пространство отпускает: вошёл в красный проём, ушёл за край или просто вышло время.
    const p = this.pocket;
    if (p && this.where === 'pocket' && !this.transition) {
      this.pocketAge += dt;
      const far = Math.hypot(b.x - p.center[0], b.z - p.center[2]) > p.radius;
      // Выход — проём, обведённый красным: войти в него. Смотреть на проём можно сколько угодно —
      // взгляд никуда не уносит, иначе игрока выбрасывало бы, пока он просто стоит и осматривается.
      // Первые полторы секунды проём не действует.
      const through = !!p.exit && this.pocketAge > 1.5 && Math.abs(b.x - p.exit[0]) < 0.5 && Math.abs(b.z - p.exit[2]) < 0.4 && Math.abs(b.y - p.exit[1]) < 1;
      this.pocketPurpose(dt, look, los, dream);
      // Дверь на лугу выводит поближе к искомой вещи; остальные проёмы — туда, откуда унесло.
      const door = p.kind === 'meadow' && this.session?.active ? 'thing' : 'back';
      if (through) this.beginJump({ cause: 'return', style: 'whiteout', to: 'elsewhere', dest: door }, dream);
      else if (far) this.beginJump({ cause: 'return', style: 'cut', to: 'elsewhere' }, dream);
      else if (this.pocketAge > this.pocketStay) this.beginJump({ cause: 'return', style: 'dissolve', to: 'elsewhere' }, dream);
    }

    // Лимбо: просим следующую сессию и ждём, пока её соберут.
    if (this.where === 'limbo' && !this.transition) {
      this.limboTime += dt;
      if (!this.limboAsked) {
        this.limboAsked = true;
        dream.push({ type: 'limbo' });
      }
      if (this.pending && this.limboTime > LIMBO_MIN) this.beginJump({ cause: 'begin', style: 'dissolve', to: 'session' }, dream);
    }

    // Идущий скачок.
    const tr = this.transition;
    if (tr) {
      tr.t += dt;
      if (!tr.switched && tr.t >= tr.out) {
        tr.switched = true;
        this.switchPlace(tr.plan, dream);
      }
      // switchPlace может начать новую сессию со своим переходом: тогда этот уже не наш.
      if (this.transition === tr && tr.t >= tr.out + tr.back) this.transition = null;
    }

    // Камера изредка сбоит сама по себе — едва заметно.
    this.nextGlitch -= dt;
    if (this.nextGlitch <= 0) {
      this.nextGlitch = 9 + this.rng() * 14;
      this.glitch = Math.max(this.glitch, 0.16);
    }

    this.stepGlow(dt);
    return { lightFailed: ev.failed, lightRevived: ev.revived, lightToggled: toggled, spark: ev.spark, strokes, fellOut: res.fellOut, session: out, fear, dream };
  }

  /** Рой, режиссёр и аномалии за шаг. */
  private stepFear(dt: number, input: InputFrame, shakeLevel: number, fear: FearEvent[], dream: DreamEvent[]): void {
    const s = this.session!;
    const sw = this.swarm;
    const b = this.body;
    const node = this.playerNode();
    const pos: Vec3 = [b.x, b.y, b.z];
    const moving = Math.hypot(b.vx, b.vz);
    // Шум игрока: бег, тряска заглохшего фонаря, паническое дыхание, плеск воды.
    const noise = Math.max(input.run && moving > 3 ? 0.6 : moving > 1 ? 0.12 : 0, this.light.state === 'dead' ? shakeLevel * 0.9 : shakeLevel * 0.4, s.panic > 0.6 ? 0.35 : 0, s.inWater && moving > 0.5 ? 0.5 : 0);

    if (sw) {
      const res = sw.update(dt, { player: pos, playerNode: node, lightOn: this.light.intensity > 0.3 || this.ambientHere > 0.1, beamOnSwarm: this.beamOnSwarm(), noise });
      if (res.cohered) {
        s.scare(0.2);
        fear.push({ type: 'swarm', what: 'cohered' });
      }
      if (res.scattered) {
        fear.push({ type: 'swarm', what: 'scattered' });
        // Проявленная до конца, Осыпь рассыпается и несколько секунд течёт в сторону искомой вещи:
        // она знает, где лежит то, что ещё не вспомнили.
        this.swarmFlow = this.flowToMemory();
      }
      if (res.caught && this.jumps) {
        // Осыпь не убивает: она гасит всё и возвращает в начало — туда, где вылазка началась. Искомая
        // вещь остаётся на месте: идти за ней придётся заново.
        fear.push({ type: 'swarm', what: 'caught' });
        this.wearGain += WEAR.caught;
        s.scare(0.4);
        this.glitch = 1;
        if (this.beginJump(this.jumps.forced('caught'), dream)) this.swarmCaught = true;
      }
      this.swarmNear = sw.proximity(pos);
    }

    const dir = this.director;
    if (dir) {
      const tiers = this.level?.layout?.tierCount ?? 1;
      for (const e of dir.update({ time: s.time, tier: Math.max(0, Math.round(-b.y / 4.5)), goalsDone: s.doneCount, swarmBusy: sw?.active ?? true, tiers })) {
        if (e.type === 'scare') {
          this.applyScare(e.id);
          const src = this.scareSource(e.id, node);
          fear.push(src ? { type: 'scare', id: e.id, pos: src } : { type: 'scare', id: e.id });
        } else if (e.type === 'apparition' && sw) {
          const n = this.apparitionNode(node);
          if (n >= 0) {
            sw.appear(n, 6);
            this.swarmBody.snap(sw.pos, sw.cohesion);
            fear.push({ type: 'swarm', what: 'apparition' });
          }
        } else if (e.type === 'release' && sw) {
          // Рой выходит подальше от игрока и сам его ищет.
          const n = sw.nodeAround(node, 8, 14);
          sw.activate(n >= 0 ? n : sw.nodeAround(node, 4, 30));
          this.swarmBody.snap(sw.pos, 0);
          fear.push({ type: 'swarm', what: 'release' });
        }
      }
    }

    if (this.anomalies) this.applyAnomalies(this.anomalies.update(pos, node >= 0 ? this.level!.nav[node]!.room : -1, this.swarmNear > 0.2));
  }

  /**
   * Свет памяти: искомая вещь приносит свет, в котором её запомнили (world/memory_light.ts). Разгорается,
   * когда вещь появилась, гаснет, когда её вспомнили (вместе с её распадом); в карманах и лимбо его нет —
   * вещь осталась в месте.
   */
  private stepMemLight(dt: number): void {
    const want = this.memLightDebug ?? this.memoryThing;
    const def = want ? memoryLightOf(want.kind) : undefined;
    if (want && def && this.memLit?.t !== want) {
      this.memLit = { t: want, def };
      this.memLitK = 0;
    }
    const lit = this.memLit;
    const on = lit !== null && lit.t === want && this.where === 'main' && lit.t.state !== 'gone';
    this.memLitK = memLightStep(this.memLitK, on ? 1 - lit.t.dissolve : 0, dt);
    if (!lit || this.memLitK <= 1e-3) {
      if (!on) this.memLit = null;
      this.renderer.setMemLight(null);
      return;
    }
    const t = lit.t;
    const s = t.scale;
    this.renderer.setMemLight({ pos: t.pos, yaw: t.yaw, kind: MEM_LIGHT_KIND[lit.def.kind], color: lit.def.color, strength: lit.def.strength * this.memLitK, height: lit.def.height * s, radius: lit.def.radius * Math.max(1, s) });
  }

  /** Фосфорные надписи: вспышка и темнота по событию; рядом с охотящимся роем гаснут. */
  private stepGlow(dt: number): void {
    let target = this.swarm?.mode === 'hunt' ? 0 : 1;
    if (this.glowTimer > 0) {
      this.glowTimer -= dt;
      target = this.glowTimer > 13.6 ? 7 : this.glowTimer > 1.5 ? 0 : 1;
    }
    const next = approach(this.glow, target, target > this.glow ? 0.05 : 0.25, dt);
    if (Math.abs(next - this.glow) > 1e-3) {
      this.glow = next;
      this.renderer.setGlow(next);
    }
  }

  /** Последствия события сессии для мира и камеры. out — список событий шага: сюда же дописываются следствия. */
  private applySessionEvent(e: SessionEvent, out: SessionEvent[], dream: DreamEvent[], node: number): void {
    const s = this.session!;
    if (e.type === 'reveal') {
      const sp = e.memory.spot!;
      this.memoryThing = this.addThing(e.memory.def.thing, [sp.x, sp.y, sp.z], this.rng() * Math.PI * 2, 'dust', true);
      // Вспышка воспоминания: кадр на миг рвётся.
      this.glitch = Math.max(this.glitch, 0.5);
    } else if (e.type === 'recall') {
      const t = this.memoryThing;
      this.memoryThing = null;
      if (t) {
        t.memory = false;
        if (this.things.change(t, 'dust')) dream.push({ type: 'thing', thing: t, what: 'changing' });
      }
      if (!this.archive.includes(e.memory.def.id)) this.archive.push(e.memory.def.id);
    } else if (e.type === 'forgot') {
      const sp = e.memory.spot!;
      if (this.memoryThing) this.memoryThing.pos = [sp.x, sp.y, sp.z];
    } else if (e.type === 'all-done') this.endIn = 3.5;
    else if (e.type === 'collapse') {
      for (const bx of e.spec.boxes) this.colliders.add(bx);
      this.renderer.setChunkVisible(e.spec.id, true);
      this.quake = 1;
    } else if (e.type === 'fall' && this.flow && this.jumps) {
      // Зал ожидания: за краем перрона ничего нет. Шагнул — проснулся в начале; искомая вещь остаётся на месте.
      this.wearGain += WEAR.caught;
      this.glitch = 1;
      this.beginJump(this.jumps.forced('caught'), dream);
    } else if ((e.type === 'fall' || e.type === 'faint') && this.jumps) {
      // Провал и газ не убивают: выбрасывают в другое пространство, а искомая вещь «забывается».
      if (this.beginJump(this.jumps.forced(e.type), dream)) {
        const f = s.forget(node);
        if (f) out.push(f);
      }
    }
  }

  /**
   * Нарисовать кадр. alpha — доля шага между прошлым и текущим состоянием, dt — реальное время кадра.
   * present = false — посчитать камеру, луч и экспозицию, но видеокарту не трогать (пошаговая отладка:
   * из сотни шагов подряд показать нужно только последний).
   */
  draw(alpha: number, dt: number, present = true): void {
    const b = this.body;
    const x = lerp(this.prevX, b.x, alpha);
    const y = lerp(this.prevY, b.y, alpha);
    const z = lerp(this.prevZ, b.z, alpha);
    const dead = this.light.state === 'dead';
    // Под опускающимся потолком камера пригибается сама; в падении летит вниз.
    const sink = this.where === 'main' && this.pressure ? this.pressure.camDrop([x, z]) : 0;
    const rig = this.rig.update(
      { x, y: y - sink, z, aimYaw: this.aimYaw, aimPitch: this.aimPitch, speed: Math.hypot(b.vx, b.vz), onGround: b.onGround, panic: this.panic, shake: Math.max(dead ? this.shake.level : this.shake.level * 0.35, this.quake) },
      dt,
    );
    this.lastRig = rig;
    if (rig.footstep) {
      this.stepped = true;
      // Шаг слышен: от ступней расходится волна эха, от бега — сильнее.
      if (this.where === 'main') this.echo.emit([x, y + 0.05, z], ECHO_STEP, clamp(Math.hypot(b.vx, b.vz) / RUN_SPEED, 0.35, 1));
    }

    // Особенности помещения: в «тёмном» фонарь не проходит и проступает сетка; в «сеточном» — только сетка.
    const fx = this.where === 'main' ? this.roomFx.get(this.room) : undefined;
    this.fxLight = approach(this.fxLight, fx === 'dark' ? 0 : 1, 0.3, dt);
    this.fxWire = approach(this.fxWire, fx === 'dark' ? 0.85 : fx === 'wire' ? 0.5 : 0, 0.5, dt);
    let lightScale = this.env.light * this.fxLight;
    let wire = this.fxWire;
    // Стробоскоп: короткие вспышки не чаще трёх в секунду (вразнобой, часть пропущена). По просьбе
    // игрока «поменьше вспышек» — ровное медленное мерцание.
    let strobe = 0;
    this.strobeNow = 0;
    if (fx === 'strobe') {
      const beat = this.time * 2.6;
      const k = Math.floor(beat);
      strobe = this.calmFlash ? 0.06 + 0.04 * Math.sin(this.time * 2.2) : hash01(k, 3, this.dreamSeed) < 0.8 && beat - k < 0.17 ? 1 : 0;
      this.strobeNow = strobe;
    }

    // Скачок: уходящее место рвётся, рассыпается, гаснет или выбеливается; новое — проступает обратно.
    const tr = this.transition;
    let dissolve = 0;
    let flash = 0;
    let fadeMul = 1;
    // Зал ожидания: свет, тени и небо — те, что на снимке (пока игрок стоит, они не меняются).
    const fl = this.where === 'main' ? this.flow : null;
    const sun = fl ? fl.sun() : null;
    // Даль зала — светлое небо; в тёмном переходе даль тёмная: множитель — свет клетки, где стоит игрок.
    const sky = sun ? sun.ambient * (0.18 + 0.82 * this.ambientLocal) : 1;
    let fog = sun ? ([this.env.fog[0] * sky, this.env.fog[1] * sky, this.env.fog[2] * sky] as Vec3) : this.env.fog;
    if (tr) {
      const k = tr.switched ? 1 - clamp((tr.t - tr.out) / tr.back, 0, 1) : clamp(tr.t / Math.max(tr.out, 1e-3), 0, 1);
      const style = tr.plan.style;
      // Поймала: в тёмном месте кадр выгорает добела — свет разъел; в светлом тонет в черноте — поглотила.
      if (tr.plan.cause === 'caught' && this.swarmCaught) {
        if (this.polar > 0.5 || this.calmFlash) fadeMul = Math.min(fadeMul, 1 - k);
        else flash = Math.max(flash, k);
      }
      if (style === 'cut') this.glitch = Math.max(this.glitch, 0.9 * k);
      else if (style === 'dissolve') {
        dissolve = k;
        // В светлом месте красная сетка старта читалась битой текстурой (аудит 16.11): там она тише.
        wire = Math.max(wire, lerp(0.7, 0.18, this.polar) * Math.sin(k * Math.PI));
        // Уходящее место растворяется в цвет того, куда ведёт скачок.
        if (!tr.switched) {
          const to = DEST_FOG[tr.plan.to] ?? this.env.fog;
          fog = [lerp(fog[0], to[0], k), lerp(fog[1], to[1], k), lerp(fog[2], to[2], k)];
        }
      } else if (style === 'blackout') {
        lightScale *= 1 - k;
        fadeMul = 1 - k;
      } else if (this.calmFlash) fadeMul = 1 - k;
      else flash = k;
    }

    const [lx, ly, lz] = rig.lightPos;
    this.beamDist = this.colliders.raycast(lx, ly, lz, rig.lightDir[0], rig.lightDir[1], rig.lightDir[2], 30);
    // Луч упёрся в воду — от неё по стенам идут зайчики (блики ряби). Разгораются и гаснут за полсекунды.
    const hx = lx + rig.lightDir[0] * this.beamDist;
    const hy = ly + rig.lightDir[1] * this.beamDist;
    const hz = lz + rig.lightDir[2] * this.beamDist;
    const onWater = this.where === 'main' && this.light.intensity > 0.3 && this.beamDist < 30 && (this.level?.zones ?? []).some((z) => z.kind === 'water' && hx > z.minX && hx < z.maxX && hz > z.minZ && hz < z.maxZ && hy > z.minY - 0.1 && hy < z.minY + 0.5);
    this.caustic = clamp(this.caustic + (onWater ? 1 : -1) * dt * 2.2, 0, 1);
    this.mosh = Math.max(0, this.mosh - dt * 1.6);
    // Полярность Осыпи — свойство места, а не света там, где она сейчас: она сама гасит свет вокруг себя
    // и мигала бы на каждом пороге.
    this.polar += ((this.where === 'main' ? POLAR[this.world] : 0) - this.polar) * Math.min(1, dt * 1.5);
    // Падающая звезда по знаку (аудит мест: небо и несобранный потолок выглядели одинаково — чёрное в
    // белых точках). Под небом — в комнате без потолка — первый взгляд вверх встречает падающую звезду.
    const underSky = this.where === 'main' && this.level?.skyRoom !== undefined && this.room === this.level.skyRoom;
    if (!underSky) this.fallArmed = true;
    else if (this.fallArmed && rig.camPitch > 0.3 && this.time - this.fallT0 > 20) {
      this.fallArmed = false;
      this.fallT0 = this.time;
      // Азимут неба (от +x к +z) — тот, куда смотрит камера, чуть левее: звезда пролетит через кадр слева направо.
      this.fallAim = [Math.atan2(-Math.cos(rig.camYaw), -Math.sin(rig.camYaw)) - 0.45, clamp(rig.camPitch + 0.22, 0.55, 1.3)];
    }
    // Цвет камеры переходит к цвету места за пару секунд: смену прячет переход, но не обрывает её.
    const gT = this.where === 'main' ? GRADE[this.world] : GRADE_DEFAULT;
    const gk = Math.min(1, dt * 1.5);
    const g0 = this.grade;
    for (let i = 0; i < 3; i++) {
      g0.lo[i] = g0.lo[i]! + (gT.lo[i]! - g0.lo[i]!) * gk;
      g0.hi[i] = g0.hi[i]! + (gT.hi[i]! - g0.hi[i]!) * gk;
    }
    g0.sat += (gT.sat - g0.sat) * gk;
    // Яркость кадра для автоэкспозиции: центр луча и четыре луча по ореолу — берём самое светлое место.
    let lum = beamAtten(this.beamDist);
    const yaw = Math.atan2(-rig.lightDir[0], -rig.lightDir[2]);
    const pitch = Math.asin(clamp(rig.lightDir[1], -1, 1));
    for (const [dy, dp] of EXPOSURE_RAYS) {
      const d = dirFromAngles(yaw + dy, pitch + dp);
      lum = Math.max(lum, 0.3 * beamAtten(this.colliders.raycast(lx, ly, lz, d[0], d[1], d[2], 30)));
    }
    // Свет потолочных панелей: в офисе он идёт за игроком и гаснет там, где Осыпь.
    const cl = this.where === 'main' ? this.cellLights : null;
    if (cl) {
      const drift = this.swarm && this.swarm.active && this.swarm.mode !== 'scatter' ? this.swarm.node : -1;
      cl.update(dt, { playerNode: this.playerNode(), driftNode: drift, time: this.time, idle: this.stillFor, ...(sun ? { dim: sun.ambient } : {}) });
      this.ambientLocal = cl.at(this.playerNode());
    } else this.ambientLocal = 1;
    // В светлом пространстве камеру держит рассеянный свет, а не пятно фонаря. Вспышки строба
    // экспозицию не сбивают: камера за ними не успевает.
    const amb = ((this.env.ambient[0] + this.env.ambient[1] + this.env.ambient[2]) / 3) * this.ambientLocal;
    const lit = this.light.intensity * lightScale;
    const gain = this.exposure.update(dt, Math.max(lum * lit, amb * 1.2), amb > 0.05 ? 1 : lit);
    this.gasView = approach(this.gasView, this.session?.inGas ? 1 : 0, 0.6, dt);
    this.glitch = Math.max(0, this.glitch - dt * 1.5);
    // Осыпь (рой): тело тянется за центром. Чем больше вспомнено, тем выше и определённее фигура.
    const sw = this.swarm;
    const flow = this.swarmFlow;
    if (flow && (!sw || this.where !== 'main')) this.swarmFlow = null;
    // Грибы: вокруг собранной Осыпи прорастает всё; в углах — знак, что она рядом или была здесь.
    // Птицы: стая — по времени места, которое видит игрок (на снимке зала она застыла в воздухе).
    let nb = 0;
    let onBird = false;
    if (this.where === 'main') {
      const f = this.flock;
      if (f && fl) for (let i = 0; i < f.count && nb < BIRDS_MAX; i++) packBird(this.birdBuf, nb++, f.pose(i, fl.viewT), 1.2 + 0.16 * (hash01(i, 5, f.seed) - 0.5));
      for (const l of this.leavers) {
        const p = l.pose();
        if (!p || nb >= BIRDS_MAX) continue;
        packBird(this.birdBuf, nb++, p, 1.25);
        if (l.state !== 'sits' || this.light.intensity < 0.3) continue;
        // Луч лежит на сидящей птице: она в узком конусе луча, ближе девяти метров и не за стеной.
        const [lx0, ly0, lz0] = rig.lightPos;
        const tx = p.pos[0] - lx0;
        const ty = p.pos[1] + 0.1 - ly0;
        const tz = p.pos[2] - lz0;
        const dl = Math.hypot(tx, ty, tz);
        if (dl < 9 && dl > 0.2 && (tx * rig.lightDir[0] + ty * rig.lightDir[1] + tz * rig.lightDir[2]) / dl > 0.985 && this.colliders.raycast(lx0, ly0, lz0, tx / dl, ty / dl, tz / dl, dl) >= dl - 0.35) onBird = true;
      }
    }
    this.birdLit = onBird ? this.birdLit + dt : Math.max(0, this.birdLit - dt * 2);
    this.renderer.setBirds(this.birdBuf, nb);
    if (this.spores) {
      const live = this.where === 'main';
      if (live) this.spores.update(fl?.frozen ? 0 : dt, sw ? { pos: sw.pos, active: sw.active && sw.mode !== 'scatter', cohesion: sw.cohesion, hunting: sw.mode === 'hunt' || sw.mode === 'cohere' } : null, this.regret);
      this.renderer.setSpores(this.sporeBuf, live ? this.spores.visible([x, y, z], SPORES_SHOWN, this.sporeBuf) : 0);
    } else this.renderer.setSpores(this.sporeBuf, 0);
    if (sw && sw.active && this.where === 'main') {
      // Чем больше вспомнено и чем больше стёрто, тем выше и определённее фигура: она растёт из тронутого.
      const growth = Math.min(1, (this.session?.doneCount ?? 0) / SWARM_GROWN + this.regret * 0.6);
      if (flow) {
        // Течёт по полу вдоль пути к искомой вещи; под конец редеет, потом тело возвращается к центру.
        flow.t += dt;
        const at = pointAlong(flow.path, Math.min(flow.t * SWARM_FLOW.speed, SWARM_FLOW.reach));
        this.swarmBody.update(dt, at, 0, null, growth);
        const fade = 1 - Math.max(0, (flow.t - (SWARM_FLOW.time - 0.8)) / 0.8);
        this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0.88 * Math.max(0, fade), this.time);
        if (flow.t >= SWARM_FLOW.time) {
          this.swarmFlow = null;
          this.swarmBody.snap(sw.pos, sw.cohesion);
        }
      } else {
        // На снимке (зал ожидания, игрок стоит) Осыпь видна там, где была: тело за ней не тянется.
        if (!fl?.frozen) this.swarmBody.update(dt, sw.pos, sw.cohesion, null, growth);
        this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0.88, this.time);
      }
    } else this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0, this.time);
    // Эхо. Осыпь слышно: пока она рядом, от неё расходятся волны — чаще, когда она тянется к игроку.
    // Если она за спиной, впереди проступает её призрак — отражение из-за спины.
    let ghostTo = 0;
    if (sw && sw.active && this.where === 'main' && sw.mode !== 'scatter' && !flow) {
      const dist = Math.hypot(sw.pos[0] - x, sw.pos[1] - y, sw.pos[2] - z);
      this.driftPulse -= dt;
      if (this.driftPulse <= 0 && dist < ECHO_HEAR) {
        const loud = sw.mode === 'hunt' || sw.mode === 'cohere' ? 1 : sw.mode === 'stalk' ? 0.7 : 0.45;
        this.driftPulse = sw.mode === 'hunt' || sw.mode === 'cohere' ? 0.9 : sw.mode === 'stalk' ? 1.5 : 2.6;
        this.echo.emit([sw.pos[0], sw.pos[1] + 0.6, sw.pos[2]], ECHO_DRIFT, loud);
      }
      const behind = behindness(rig.camPos, rig.camYaw, sw.pos, GHOST.half);
      if (behind > 0 && dist < GHOST.range) {
        const eye: Vec3 = [rig.camPos[0], rig.camPos[1], rig.camPos[2]];
        const to: Vec3 = [sw.pos[0] - eye[0], sw.pos[1] + 1 - eye[1], sw.pos[2] - eye[2]];
        const len = Math.hypot(to[0], to[1], to[2]);
        const open = len < 0.5 || this.colliders.raycast(eye[0], eye[1], eye[2], to[0] / len, to[1] / len, to[2] / len, len) >= len - 0.3;
        ghostTo = behind * (1 - smoothstep(GHOST.range * 0.7, GHOST.range, dist)) * (open ? GHOST.open : GHOST.hidden);
      }
    } else this.driftPulse = 0;
    // Призрак проступает за треть секунды и так же быстро уходит, когда к ней повернулись.
    this.ghost = approach(this.ghost, ghostTo, 0.3, dt);
    if (this.ghost < 0.004) this.ghost = 0;
    const unlit = this.where === 'main' && this.light.intensity * lightScale < 0.15 && amb < 0.08;
    // К темноте привыкают около секунды; свет возвращает «дневную» силу эха сразу.
    this.darkAdapt = approach(this.darkAdapt, unlit ? 1 : 0, unlit ? 0.9 : 0.25, dt);
    // Пока фонарь светит, эха нет вовсе (решение партнёра: иначе в нём нет смысла — эхо это способ
    // видеть без света). Гаснет оно за десятую секунды, возвращается за треть.
    const beam = this.light.intensity * lightScale >= 0.15;
    this.echoOpen = approach(this.echoOpen, beam ? 0 : 1, beam ? 0.1 : 0.3, dt);
    // …и только на ходу (решение партнёра): эхо поднимают шаги. Замер — волны гаснут чуть дольше
    // секунды, последняя успевает разойтись. Стоящий в темноте не видит ничего — и волн Осыпи тоже.
    const walking = Math.hypot(b.vx, b.vz) > 0.25;
    this.echoMove = approach(this.echoMove, walking ? 1 : 0, walking ? 0.12 : 0.45, dt);
    this.echo.update(dt, (ECHO_LIT + (1 - ECHO_LIT) * this.darkAdapt) * this.echoOpen * this.echoMove);

    // Рядом с роем сигнал камеры рвётся.
    const hunting = sw?.mode === 'hunt' || sw?.mode === 'cohere';
    const static_ = hunting ? this.swarmNear * this.swarmNear * 0.42 : this.swarmNear * 0.1;
    this.frame += 1;

    // Вещи: положение, рост, распад и красная сетка. Цель воспоминания в темноте светится сеткой сквозь стены.
    const focus = this.things.focus;
    let memNear = 0;
    for (const t of this.things.list) {
      const id = this.thingRender.get(t.id);
      if (id === undefined) continue;
      const d = Math.hypot(t.pos[0] - rig.camPos[0], t.pos[1] - rig.camPos[1], t.pos[2] - rig.camPos[2]);
      // Красная сетка — знак системы: она на вещи, которую «измеряет» взгляд. Тронутая вещь уходит и
      // возвращается без неё — одними точками («память — пыль»).
      let w = t.state === 'changing' && !t.touched ? 0.8 : t.state === 'idle' ? t.gaze * (0.45 + 0.35 * Math.sin(this.time * 23)) : 0;
      let xray = false;
      if (t.memory) {
        memNear = Math.max(memNear, 1 - d / 8);
        // Без света — значит темно на самом деле: под горящей панелью офиса сетки сквозь стены нет.
        if (lit < 0.15 && amb < 0.08 && d < 45) {
          w = Math.max(w, 0.6);
          xray = true;
        }
      }
      this.renderer.setThing(id, { x: t.pos[0], y: t.pos[1], z: t.pos[2], yaw: t.yaw, scale: t.scale, dissolve: t.dissolve, wire: w, xray, visible: t.state !== 'gone' && (d < 40 || xray), dots: Things.dots(t) });
    }
    this.stepMemLight(dt);
    // Фигуры партнёра: части растворяются каждая в свой черёд; дымная из редких точек и медленно ходит вверх-вниз.
    for (const [f, ids] of this.figureRender) {
      const d = Math.hypot(f.core[0] - rig.camPos[0], f.core[1] - rig.camPos[1], f.core[2] - rig.camPos[2]);
      const show = this.where === 'main' && f.state !== 'gone' && d < 40;
      for (let i = 0; i < ids.length; i++) {
        const p = f.pieces[i]!;
        this.renderer.setThing(ids[i]!, { x: f.at[0], y: f.at[1] + f.bob, z: f.at[2], yaw: f.yaw, scale: 1, dissolve: p.dissolve, wire: 0, xray: false, visible: show && p.dissolve < 0.999, dots: f.dots > 0 ? f.dots + (1 - f.dots) * p.dissolve : 0 });
      }
    }
    // Кинескоп заметнее на ходу, под взглядом на вещь, рядом с искомым и в момент скачка.
    const speed = Math.hypot(b.vx, b.vz);
    const hold = this.session?.hold ?? 0;
    const crt = clamp(0.1 + 0.2 * (speed / RUN_SPEED) + 0.5 * Math.max(focus?.gaze ?? 0, hold) + 0.3 * Math.max(0, memNear) + (tr ? 0.45 : 0), 0, 1);

    // Глубина 0…1: от входа до нижнего яруса.
    const depth = clamp(-(rig.camPos[1] - 1.42) / 9, 0, 1);
    const bunker = this.where === 'main' && this.world === 'shelter';
    // Зал ожидания: дрожь кадра (на ходу — от хода времени, стоя — от разошедшегося снимка) и линза:
    // в просторном месте на ходу кадр растянут по краям, в тесном переходе — сжат.
    const rattle = fl ? fl.rattle() : 0;
    const tight = fl !== null && this.room >= 0 && this.level?.layout?.rooms[this.room]?.type === 'corridor';
    // Искажение кадра (слова партнёра: «замедление и искажение пространства… только там, где это будет
    // уместно»). В зале ожидания — от хода времени. Под давлением кадр сжимается вместе с потолком и
    // растягивается в падении. В миг пробуждения, от чего бы оно ни случилось, — короткий рывок.
    let lens = fl ? 1 + (fl.fov(tight) - 1) * 6 : 1;
    const pr = this.where === 'main' ? this.pressure : null;
    if (pr && pr.falling >= 0) lens += 3.5 * Math.min(1, pr.falling / pr.cfg.fall);
    else if (pr && pr.active?.kind === 'squeeze' && sink > 0) lens -= 2.4 * Math.min(1, sink / 0.7);
    const wake = this.transition;
    if (wake && wake.plan.cause === 'caught' && !wake.switched) lens += 2.2 * (1 - Math.min(1, wake.t / Math.max(1e-3, wake.out)));
    const view: FrameView = {
      camPos: rig.camPos,
      camYaw: rig.camYaw + rattle * Math.sin(this.time * 71.3) * Math.sin(this.time * 13.7 + 1.1),
      camPitch: rig.camPitch + rattle * 0.7 * Math.sin(this.time * 57.9 + 0.6),
      camRoll: rig.camRoll + rattle * 0.5 * Math.sin(this.time * 43.1 + 2.2),
      lightPos: rig.lightPos,
      lightDir: rig.lightDir,
      lightIntensity: this.light.intensity,
      lightWarmth: 0,
      beamDist: this.beamDist,
      gain,
      noise: this.exposure.noise(),
      glitch: (this.staticLevel = Math.max(this.glitch, static_)),
      tunnel: clamp(this.panic * 0.6, 0, 0.95),
      gas: this.gasView,
      decay: bunker ? 0.25 + 0.6 * depth : this.env.decay,
      plain: this.env.plain === true,
      // Внизу воздух гуще: взвесь, пар от сырых стен; в газу луч упирается в муть.
      haze: bunker ? (0.008 + 0.004 * depth) * (1 + 9 * this.gasView) : this.env.haze,
      fade: this.fade * fadeMul,
      // На снимке время стоит: точки не дрожат, взвесь висит.
      time: fl ? 100 + fl.viewT : this.time,
      frame: this.frame,
      ambient: strobe > 0 ? [this.env.ambient[0] + 0.42 * strobe, this.env.ambient[1] + 0.45 * strobe, this.env.ambient[2] + 0.5 * strobe] : this.env.ambient,
      fogColor: fog,
      fogDensity: this.env.fogDensity,
      lightScale,
      scanFade: this.pocketFade,
      keyDir: sun ? sun.dir : (this.env.key?.dir ?? [0, 1, 0]),
      keyColor: sun ? sun.color : (this.env.key?.color ?? [0, 0, 0]),
      keyCells: sun ? Math.max(0.05, sun.ambient) : 0,
      press: this.where === 'main' ? (this.pressure?.view() ?? null) : null,
      // Ветер: сквозняк убежища, вентиляция офиса, ветер зала; идущий поезд гонит воздух — всё висящее
      // качается втрое сильнее. Время ветра — время кадра: на снимке зала оно стоит.
      wind: this.windView(fl),
      roof: this.where === 'main' ? (this.level?.roof ?? null) : null,
      contact: this.where === 'main',
      caustic: this.caustic,
      mosh: this.where === 'main' ? this.mosh : 0,
      polar: this.polar,
      // Звёздное небо стоит над уровнем; видно его там, где нет потолка. В зале ожидания оно проступает
      // к вечеру, в карманных пространствах его нет.
      // Яркость делится на усиление камеры: и в тёмном убежище, и в светлом офисе звёзды видны одинаково.
      // Где неба не увидеть (потолок везде цел и комнаты под небом нет), оно и не рисуется.
      stars: (this.where !== 'main' || !this.openSky ? 0 : fl ? smoothstep(0.7, 0.97, clamp(fl.viewT / fl.cfg.day, 0, 1)) : 1) * clamp(3.2 / gain, 0.5, 4),
      // Собрано только там, куда смотрит герой, — в светлых местах тоже. Вспышка строба показывает всё.
      gaze: 1 - clamp(strobe, 0, 1),
      // В зале ожидания взгляд стоящего раскрывается, идущего — узок, как луч.
      ...(fl ? { gazeCone: fl.gaze() } : {}),
      lens,
      scanRange: fl ? fl.scan() : (this.env.scan ?? [4, 15]),
      // Тени прямого света — в квадрате вокруг игрока, сдвинутом вперёд по взгляду: позади они не нужны.
      keyBox:
        (this.pocket || fl) && this.env.key?.reach
          ? {
              center: [rig.camPos[0] - Math.sin(rig.camYaw) * this.env.key.reach * 0.35, rig.camPos[1] - 1.42, rig.camPos[2] - Math.cos(rig.camYaw) * this.env.key.reach * 0.35],
              half: this.env.key.reach,
            }
          : null,
      dissolve,
      wire,
      crt,
      flash,
      echo: this.where === 'main' && this.echo.count > 0 ? this.echo.data : null,
      ghost: this.ghost,
      sonar: this.sonarView(),
      burnTint: [lerp(0.9, 0.86, this.polar), lerp(0.07, 0.82, this.polar), lerp(0.03, 0.74, this.polar)],
      grade: this.grade,
      fall: this.time - this.fallT0 < 2 ? [this.fallAim[0], this.fallAim[1], this.time - this.fallT0] : null,
      rings: this.where === 'main' ? RINGS[this.world] : RINGS.shelter,
      memHold: tr !== null && tr.plan.style === 'dissolve',
      // План держится, но и он к концу петли редеет: на последнем круге он не целее самого места.
      quiet: this.where === 'main' && this.level?.edges ? QUIET * (1 - 0.35 * clamp(this.wear, 0, 1)) : 0,
      cells: cl ? { data: cl.data, origin: CELL_ORIGIN, step: 3, size: cl.size } : null,
      ambientLocal: this.ambientLocal,
    };
    // Стирание места: потолок выпадает, стены и пол редеют до кружева. В карманных пространствах его нет.
    const d = this.where === 'main' && this.level?.layout ? this.decay : null;
    this.renderer.setErase(d ? d.ceiling : 0, d ? d.walls : 0, d ? d.floor : 0, d ? this.wear : 0, d ? ceilTileOf(this.world) : 0);
    if (present) this.renderer.render(view);
  }

  /** Был ли шаг с прошлого вызова (для звука шагов). */
  consumeFootstep(): boolean {
    const s = this.stepped;
    this.stepped = false;
    return s;
  }

  /** Где и куда смотрит камера: «уши» игрока. */
  listener(): { pos: Vec3; yaw: number } {
    const r = this.lastRig;
    return r ? { pos: r.camPos, yaw: r.camYaw } : { pos: [this.body.x, this.body.y + 1.42, this.body.z], yaw: this.aimYaw };
  }

  /** Снимок состояния для отладки и смоука. */
  snapshot(): Record<string, unknown> {
    const b = this.body;
    const s = this.session;
    const tr = this.transition;
    return {
      pos: [b.x, b.y, b.z],
      vel: [b.vx, b.vy, b.vz],
      onGround: b.onGround,
      aim: [this.aimYaw, this.aimPitch],
      cam: this.lastRig ? [this.lastRig.camYaw, this.lastRig.camPitch] : null,
      eye: this.lastRig ? [...this.lastRig.camPos] : [b.x, b.y + 1.42, b.z],
      lightDir: this.lastRig ? [...this.lastRig.lightDir] : [0, 0, -1],
      light: { state: this.light.state, charge: this.light.charge, intensity: this.light.intensity, revive: this.light.reviveProgress },
      shake: this.shake.level,
      beamDist: this.beamDist,
      gain: this.exposure.gain,
      time: this.time,
      frame: this.frame,
      fade: this.fade,
      where: this.where,
      dark: { for: this.darkFor, shifts: this.detailShifts },
      illusions: { gone: this.touchCount, back: this.returnCount, erased: this.erasedCount },
      wear: this.wear,
      regret: this.regret,
      spores: this.spores ? this.spores.sites.filter((q) => q.grow > 0.03).length : 0,
      hasLight: this.hasLight,
      stillFor: this.stillFor,
      pocket: this.pocket?.kind ?? null,
      pocketInfo: this.pocket
        ? { age: this.pocketAge, stay: this.pocketStay, done: this.pocketDone, fade: this.pocketFade, exit: this.pocket.exit ?? null, focus: this.pocket.focus ?? null, blanks: this.blanks.map((t) => t.id) }
        : null,
      jump: tr ? { cause: tr.plan.cause, style: tr.plan.style, to: tr.plan.to, dest: tr.plan.dest ?? null, switched: tr.switched } : null,
      echo: this.echo.snapshot(),
      ghost: this.ghost,
      world: this.world,
      ambientLocal: this.ambientLocal,
      lights: this.cellLights ? { lit: [...this.cellLights.level].filter((v) => v > 0.5).length, total: this.cellLights.level.length } : null,
      room: this.room,
      roomFx: this.roomFx.get(this.room) ?? null,
      fx: { light: this.fxLight, wire: this.fxWire, strobe: this.strobeNow },
      session: s
        ? {
            memories: s.memories.map((m) => ({ id: m.def.id, thing: m.def.thing, state: m.state, spot: m.spot ? [m.spot.x, m.spot.y, m.spot.z] : null })),
            done: s.doneCount,
            over: s.over,
            hold: s.hold,
            panic: s.panic,
            time: s.time,
            inWater: s.inWater,
            inGas: s.inGas,
            maxTier: s.maxTier,
            collapsed: s.collapsed(),
          }
        : null,
      things: this.things.list.map((t) => ({ id: t.id, kind: t.kind, state: t.state, fate: t.fate, memory: t.memory, gaze: t.gaze, scale: t.scale, dissolve: t.dissolve, pos: t.pos })),
      jumps: this.jumps ? { count: this.jumps.count, cooldown: this.jumps.cooldown } : null,
      archive: [...this.archive],
      swarm: this.swarm ? { mode: this.swarm.mode, pos: [...this.swarm.pos], node: this.swarm.node, cohesion: this.swarm.cohesion, awareness: this.swarm.awareness, aggravation: this.swarm.aggravation, near: this.swarmNear, growth: Math.min(1, (this.session?.doneCount ?? 0) / SWARM_GROWN), flow: this.swarmFlow ? this.swarmFlow.t : null } : null,
      director: this.director ? { phase: this.director.phase } : null,
      anomalies: this.anomalies ? this.anomalies.state() : null,
      node: this.playerNode(),
    };
  }
}
