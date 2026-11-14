/**
 * Игра: симуляция фиксированным шагом и сборка кадра. Здесь сходятся контроллер, нагрудная камера,
 * фонарь, детектор тряски, сессия (воспоминания, среда, паника), вещи, меняющиеся под взглядом,
 * скачки между пространствами и рендер. Экраны, пауза и ввод — в app.ts.
 *
 * Игрок только ходит, смотрит и светит. Смерти нет: провал, газ и рой выбрасывают его в другое место.
 */
import { approach, clamp, lerp } from './core/math';
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
import type { FrameView, GameRenderer } from './render/renderer';
import { nodesInRange, SwarmAI } from './swarm/ai';
import { SwarmBody } from './swarm/body';
import { Anomalies } from './systems/anomalies';
import type { AnomalyEvent, AnomalyState } from './systems/anomalies';
import { Director } from './systems/director';
import type { ScareId } from './systems/director';
import { DEFAULT_FLASHLIGHT, Flashlight } from './systems/flashlight';
import type { FlashlightConfig } from './systems/flashlight';
import { Jumps } from './systems/jumps';
import type { JumpPlan, JumpStyle } from './systems/jumps';
import { DEFAULT_SESSION, MEMORIES, Session } from './systems/session';
import type { SessionConfig, SessionEvent } from './systems/session';
import { looksAt, Things } from './systems/things';
import type { Fate, Look, Thing } from './systems/things';
import { ColliderSet } from './world/colliders';
import type { BuiltLevel } from './world/level';
import { STAIR_RISE, STAIR_RUN, STAIR_STEPS } from './world/level_build';
import { buildPocket, ENV_BUNKER } from './world/pockets';
import type { Env, ModelCell, PocketContext, PocketKind, PocketSpace } from './world/pockets';
import { thingMesh } from './world/thing_mesh';

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
  | { type: 'thing'; thing: Thing; what: 'changing' | 'settled' }
  /**
   * Карманное пространство сделало своё дело: enter — игрок вошёл; map — прочёл макет в кукольном домике
   * (room и tier — где лежит искомое; без memory — искать пока нечего); next — в белом нигде вызвал следующее
   * воспоминание; remind — там же напомнил себе, что ищет; replay — перечитал вспомненное.
   */
  | { type: 'pocket'; kind: PocketKind; what: 'enter' | 'map' | 'next' | 'remind' | 'replay'; memory?: string; room?: string; tier?: number }
  /** Сессия кончилась, игрок в лимбо: пора готовить следующую (queueSession). */
  | { type: 'limbo' }
  /** Началась новая сессия. */
  | { type: 'begin' };

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
const SMALL_FATES: readonly Fate[] = ['shrink', 'dust', 'grow', 'dust', 'shrink', 'grow'];
const BIG_FATES: readonly Fate[] = ['jump', 'grow', 'dust', 'jump', 'shrink', 'grow'];
/** Воспоминание → вещь-образ. */
const MEMORY_THING: Record<string, string> = Object.fromEntries(MEMORIES.map((m) => [m.id, m.thing]));
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
  jumps: Jumps | null = null;
  where: Where = 'main';
  /** Карманное пространство, в котором сейчас игрок (или лимбо). */
  pocket: PocketSpace | null = null;
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
    this.colliders = level.colliders;
    this.spawn = level.spawn;
    this.renderer.setWorld(level.chunks, level.stairs);
    // Батарейка в сессии не садится: фонарь глохнет от контакта, а не от заряда.
    this.light = new Flashlight(this.rng, { ...DEFAULT_FLASHLIGHT, drainSeconds: Infinity, ...this.lightCfg });
    const rank = level.layout?.rank ?? 1;
    this.session = dream ? new Session(level, dream.seed, dream.known, this.sessionCfg) : null;
    this.nodeAt.clear();
    for (const n of level.nav) this.nodeAt.set(`${n.tier},${n.cx},${n.cz}`, n.id);
    const tiers = level.layout?.tierCount ?? 1;
    this.roomFx.clear();
    this.thinUsed.clear();
    if (dream) {
      this.dreamSeed = dream.seed;
      this.swarm = new SwarmAI(level.nav, this.rng);
      this.director = new Director(this.rng);
      this.jumps = new Jumps(this.rng);
      // Лестница на нижний ярус удлиняется дважды — только на объектах, где есть «неправильный» ярус.
      const stair = rank >= 2 && tiers >= 3 ? (level.stairs.find((st) => st.upperTier === tiers - 2) ?? null) : null;
      this.anomalies = new Anomalies(stair, { run: STAIR_RUN, rise: STAIR_RISE, steps: STAIR_STEPS }, level.variants, 2);
      this.assignRooms(dream.seed);
      this.placeThings(dream.seed);
      // Место собирается вокруг игрока из пыли.
      this.transition = { plan: { cause: 'begin', style: 'dissolve', to: 'session' }, t: 0, out: 0, back: 1.6, switched: true };
    } else {
      this.swarm = null;
      this.director = null;
      this.anomalies = null;
      this.jumps = null;
      this.transition = null;
    }
    this.where = 'main';
    this.env = ENV_BUNKER;
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
    this.glow = 1;
    this.glowTimer = 0;
    this.renderer.setGlow(1);
    this.time = 0;
    this.fade = 0;
    this.fadeTo = 1;
    this.glitch = 0;
    this.quake = 0;
    this.gasView = 0;
    this.shake.reset();
    this.respawn();
  }

  /** Раздать помещениям особенности: строб, темноту, сетку, «тонкие места». */
  private assignRooms(seed: number): void {
    const rooms = this.level?.layout?.rooms ?? [];
    const rng = mulberry32(hash2(seed, 0xf0, 0x0d));
    // В помещениях с газом особенностей нет: там игрок теряет сознание раньше, чем успеет их разглядеть.
    const gas = new Set(this.level?.layout?.hazards.gasRooms ?? []);
    const pool = rooms.filter((r) => r.type !== 'corridor' && r.type !== 'entrance' && r.type !== 'airlock' && r.type !== 'stairwell' && r.type !== 'collapsed' && !gas.has(r.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    // Стробу нужен простор: первое же помещение в две клетки и больше.
    const big = pool.findIndex((r) => r.cells.length >= 2);
    if (big > 0) [pool[0], pool[big]] = [pool[big]!, pool[0]!];
    const order: RoomFx[] = ['strobe', 'dark', 'thin', 'wire', 'thin', 'dark'];
    const n = Math.min(order.length, Math.ceil(pool.length * 0.45));
    for (let i = 0; i < n; i++) this.roomFx.set(pool[i]!.id, order[i]!);
    for (const r of rooms) if (r.type === 'collapsed') this.roomFx.set(r.id, 'wire');
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
    // Не больше трети мест: остальные нужны вещам-воспоминаниям.
    const small = Math.min(9, Math.floor(spots.length / 3));
    for (let i = 0; i < small; i++) {
      const sp = spots[i]!;
      s.reserve(sp);
      this.addThing(SMALL_THINGS[i % SMALL_THINGS.length]!, [sp.x, sp.y, sp.z], rng() * Math.PI * 2, SMALL_FATES[i % SMALL_FATES.length]!);
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
      const [kind, pocket] = BIG_THINGS[(chosen.length + Math.floor(rng() * 3)) % BIG_THINGS.length]!;
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
  addThing(kind: string, pos: Vec3, yaw: number, fate: Fate, memory = false, solid = false): Thing {
    const tm = thingMesh(kind, hash2(Math.round(pos[0] * 10), Math.round(pos[2] * 10), 0x71) >>> 0);
    const t = this.things.add(kind, pos, yaw, fate, tm.radius, memory);
    this.thingRender.set(t.id, this.renderer.addThing(tm.mesh, t.id));
    if (solid) {
      const turned = Math.abs(Math.sin(yaw)) > 0.5;
      const hx = (turned ? tm.d : tm.w) / 2;
      const hz = (turned ? tm.w : tm.d) / 2;
      t.collider = this.colliders.addBox(pos[0] - hx, pos[1], pos[2] - hz, pos[0] + hx, pos[1] + tm.h, pos[2] + hz);
    }
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
  }

  /** Следующая сессия готова: как только лимбо отпустит, игрок окажется в ней. */
  queueSession(level: BuiltLevel, dream: DreamSeed): void {
    this.pending = { level, dream };
  }

  /** Отладка: немедленно вернуться в убежище (карманное пространство и идущий скачок сбрасываются). */
  debugHome(): void {
    if (this.where === 'limbo') return;
    this.leavePocket();
    this.where = 'main';
    this.env = ENV_BUNKER;
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
    const kinds = limbo ? this.archive.map((id) => MEMORY_THING[id] ?? id) : [SMALL_THINGS[Math.floor(this.rng() * SMALL_THINGS.length)]!, SMALL_THINGS[Math.floor(this.rng() * SMALL_THINGS.length)]!];
    kinds.slice(0, p.spots.length).forEach((kind, i) => {
      const sp = p.spots[i]!;
      this.pocketThings.push(this.addThing(kind, sp, this.rng() * Math.PI * 2, limbo ? 'grow' : SMALL_FATES[i % SMALL_FATES.length]!));
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
    if (p.kind === 'void') {
      // Экспонат «звучит», когда на него посмотрели подольше; каждый — один раз за заход.
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
        this.loadLevel(next.level, next.dream);
        dream.push({ type: 'begin' });
      }
    } else if (to === 'limbo') {
      // Вещи убежища больше не нужны: сессия кончилась.
      this.clearThings();
      this.enterPocket('void', true);
    } else if (to === 'elsewhere') {
      const from = this.where === 'main' ? this.playerNode() : this.returnNode;
      this.leavePocket();
      this.where = 'main';
      this.env = ENV_BUNKER;
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
      // Рой, поймавший игрока, остаётся позади и ищет заново.
      if (plan.cause === 'caught' && this.swarm && id >= 0) {
        const away = this.swarm.nodeAround(id, 8, 14);
        this.swarm.activate(away >= 0 ? away : this.swarm.nodeAround(id, 4, 30));
        this.swarmBody.snap(this.swarm.pos, 0);
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
  private beamOnSwarm(): boolean {
    const sw = this.swarm;
    const rig = this.lastRig;
    if (!sw || !rig || this.light.intensity < 0.3) return false;
    const [lx, ly, lz] = rig.lightPos;
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
   * Откуда слышна пугалка. Удар и хлопок двери — из дальних помещений, стук — из соседнего,
   * шаги — из-за спины. Рация и мигание источника в мире не имеют.
   */
  private scareSource(id: ScareId, from: number): Vec3 | null {
    const b = this.body;
    if (id === 'steps') return [b.x + Math.sin(this.aimYaw) * 4.5, b.y + 0.1, b.z + Math.cos(this.aimYaw) * 4.5];
    const range = id === 'bang' ? ([7, 13] as const) : id === 'slam' ? ([4, 8] as const) : id === 'knock' ? ([2, 3] as const) : null;
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
    if (id === 'bang') {
      this.quake = Math.max(this.quake, 0.18);
      s?.scare(0.06);
    } else if (id === 'slam') {
      this.quake = Math.max(this.quake, 0.32);
      s?.scare(0.1);
    } else if (id === 'steps') s?.scare(0.05);
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
    const amb = (this.env.ambient[0] + this.env.ambient[1] + this.env.ambient[2]) / 3;
    return Math.max(this.light.intensity * this.env.light * this.fxLight, amb > 0.2 ? 1 : 0);
  }

  step(dt: number, input: InputFrame): StepEvents {
    this.time += dt;
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
    const res = stepPlayer(b, wishX, wishZ, speed, dt, this.colliders, DEFAULT_CONTROLLER);
    // Выпал из мира (ушёл за край пространства) — возвращаем на место появления.
    if (res.fellOut) {
      if (this.pocket) this.teleport(this.pocket.spawn.pos[0], this.pocket.spawn.pos[1], this.pocket.spawn.pos[2], this.aimYaw, 0);
      else this.respawn();
    }

    // Фонарь.
    const wasOff = this.light.state === 'off';
    const toggled = input.light;
    if (toggled) this.light.toggle();
    const level = this.shake.update(dt);
    const ev = this.light.update(dt, { panic: this.panic, wet: s?.inWater ? 1 : 0, swarm: this.swarmNear, shake: level });
    const strokes = this.shake.strokes - this.lastStrokes;
    this.lastStrokes = this.shake.strokes;

    // Темнота. Мир держится светом: пока фонарь не светит, место растворяется (это показывает рендер),
    // а когда растворилось — собираться прежним оно не обязано. Детали меняются: первый раз — когда
    // место успело исчезнуть, дальше — каждые несколько секунд, пока темно.
    if (this.where === 'main' && this.light.intensity * this.fxLight < 0.15) {
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

    // Вещи: под взглядом уменьшаются, рассыпаются, растут.
    for (const e of this.things.update(dt, look, [b.x, b.y, b.z], los)) {
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
      out.push(...s.update(dt, { pos: [b.x, b.y, b.z], eye, aim, light: look.light, node, swarm: this.swarmNear, observed: this.observed, landed: res.landed }, los));
      this.observed = false;
    }
    for (let i = 0; i < out.length; i++) this.applySessionEvent(out[i]!, out, dream, node);

    const quiet = this.where !== 'main' || this.transition !== null;
    if (s && !s.over && !this.calm && !quiet) this.stepFear(dt, input, level, fear, out, dream);
    else this.swarmNear = this.calm ? 0 : approach(this.swarmNear, 0, 0.5, dt);

    // Поводы для скачка: простые действия и наблюдения.
    const jumps = this.jumps;
    if (jumps && s && !s.over && !this.calm && !quiet) {
      jumps.update(dt);
      let plan: JumpPlan | null = null;
      if (toggled && wasOff && this.light.state === 'on') plan = jumps.onLightOn();
      if (!plan && ev.revived) plan = jumps.onRevive();
      if (!plan) plan = jumps.onDark(dt, look.light < 0.05, Math.hypot(b.vx, b.vz) < 0.3);
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
      if (this.endIn < 0) this.beginJump({ cause: 'end', style: 'dissolve', to: 'limbo' }, dream);
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
  private stepFear(dt: number, input: InputFrame, shakeLevel: number, fear: FearEvent[], out: SessionEvent[], dream: DreamEvent[]): void {
    const s = this.session!;
    const sw = this.swarm;
    const b = this.body;
    const node = this.playerNode();
    const pos: Vec3 = [b.x, b.y, b.z];
    const moving = Math.hypot(b.vx, b.vz);
    // Шум игрока: бег, тряска заглохшего фонаря, паническое дыхание, плеск воды.
    const noise = Math.max(input.run && moving > 3 ? 0.6 : moving > 1 ? 0.12 : 0, this.light.state === 'dead' ? shakeLevel * 0.9 : shakeLevel * 0.4, s.panic > 0.6 ? 0.35 : 0, s.inWater && moving > 0.5 ? 0.5 : 0);

    if (sw) {
      const res = sw.update(dt, { player: pos, playerNode: node, lightOn: this.light.intensity > 0.3, beamOnSwarm: this.beamOnSwarm(), noise });
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
        // Рой не убивает: он гасит всё и уносит в другое место; искомая вещь при этом «забывается».
        fear.push({ type: 'swarm', what: 'caught' });
        s.scare(0.4);
        const f = s.forget(node);
        if (f) {
          out.push(f);
          // События сессии этого шага уже применены: вещь переставляем сами.
          this.applySessionEvent(f, out, dream, node);
        }
        this.glitch = 1;
        this.beginJump(this.jumps.forced('caught'), dream);
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
    const rig = this.rig.update(
      { x, y, z, aimYaw: this.aimYaw, aimPitch: this.aimPitch, speed: Math.hypot(b.vx, b.vz), onGround: b.onGround, panic: this.panic, shake: Math.max(dead ? this.shake.level : this.shake.level * 0.35, this.quake) },
      dt,
    );
    this.lastRig = rig;
    if (rig.footstep) this.stepped = true;

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
    let fog = this.env.fog;
    if (tr) {
      const k = tr.switched ? 1 - clamp((tr.t - tr.out) / tr.back, 0, 1) : clamp(tr.t / Math.max(tr.out, 1e-3), 0, 1);
      const style = tr.plan.style;
      if (style === 'cut') this.glitch = Math.max(this.glitch, 0.9 * k);
      else if (style === 'dissolve') {
        dissolve = k;
        wire = Math.max(wire, 0.7 * Math.sin(k * Math.PI));
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
    // Яркость кадра для автоэкспозиции: центр луча и четыре луча по ореолу — берём самое светлое место.
    let lum = beamAtten(this.beamDist);
    const yaw = Math.atan2(-rig.lightDir[0], -rig.lightDir[2]);
    const pitch = Math.asin(clamp(rig.lightDir[1], -1, 1));
    for (const [dy, dp] of EXPOSURE_RAYS) {
      const d = dirFromAngles(yaw + dy, pitch + dp);
      lum = Math.max(lum, 0.3 * beamAtten(this.colliders.raycast(lx, ly, lz, d[0], d[1], d[2], 30)));
    }
    // В светлом пространстве камеру держит рассеянный свет, а не пятно фонаря. Вспышки строба
    // экспозицию не сбивают: камера за ними не успевает.
    const amb = (this.env.ambient[0] + this.env.ambient[1] + this.env.ambient[2]) / 3;
    const lit = this.light.intensity * lightScale;
    const gain = this.exposure.update(dt, Math.max(lum * lit, amb * 1.2), amb > 0.05 ? 1 : lit);
    this.gasView = approach(this.gasView, this.session?.inGas ? 1 : 0, 0.6, dt);
    this.glitch = Math.max(0, this.glitch - dt * 1.5);
    // Осыпь (рой): тело тянется за центром. Чем больше вспомнено, тем выше и определённее фигура.
    const sw = this.swarm;
    const flow = this.swarmFlow;
    if (flow && (!sw || this.where !== 'main')) this.swarmFlow = null;
    if (sw && sw.active && this.where === 'main') {
      const growth = Math.min(1, (this.session?.doneCount ?? 0) / SWARM_GROWN);
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
        this.swarmBody.update(dt, sw.pos, sw.cohesion, null, growth);
        this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0.88, this.time);
      }
    } else this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0, this.time);
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
      let w = t.state === 'changing' ? 0.8 : t.state === 'idle' ? t.gaze * (0.45 + 0.35 * Math.sin(this.time * 23)) : 0;
      let xray = false;
      if (t.memory) {
        memNear = Math.max(memNear, 1 - d / 8);
        if (lit < 0.15 && d < 45) {
          w = Math.max(w, 0.6);
          xray = true;
        }
      }
      this.renderer.setThing(id, { x: t.pos[0], y: t.pos[1], z: t.pos[2], yaw: t.yaw, scale: t.scale, dissolve: t.dissolve, wire: w, xray, visible: t.state !== 'gone' && (d < 40 || xray) });
    }
    // Кинескоп заметнее на ходу, под взглядом на вещь, рядом с искомым и в момент скачка.
    const speed = Math.hypot(b.vx, b.vz);
    const hold = this.session?.hold ?? 0;
    const crt = clamp(0.1 + 0.2 * (speed / RUN_SPEED) + 0.5 * Math.max(focus?.gaze ?? 0, hold) + 0.3 * Math.max(0, memNear) + (tr ? 0.45 : 0), 0, 1);

    // Глубина 0…1: от входа до нижнего яруса.
    const depth = clamp(-(rig.camPos[1] - 1.42) / 9, 0, 1);
    const bunker = this.env === ENV_BUNKER;
    const view: FrameView = {
      camPos: rig.camPos,
      camYaw: rig.camYaw,
      camPitch: rig.camPitch,
      camRoll: rig.camRoll,
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
      // Внизу воздух гуще: взвесь, пар от сырых стен; в газу луч упирается в муть.
      haze: bunker ? (0.008 + 0.004 * depth) * (1 + 9 * this.gasView) : this.env.haze,
      fade: this.fade * fadeMul,
      time: this.time,
      frame: this.frame,
      ambient: strobe > 0 ? [this.env.ambient[0] + 0.42 * strobe, this.env.ambient[1] + 0.45 * strobe, this.env.ambient[2] + 0.5 * strobe] : this.env.ambient,
      fogColor: fog,
      fogDensity: this.env.fogDensity,
      lightScale,
      scanFade: this.pocketFade,
      keyDir: this.env.key?.dir ?? [0, 1, 0],
      keyColor: this.env.key?.color ?? [0, 0, 0],
      scanRange: this.env.scan ?? [4, 15],
      // Тени прямого света — в квадрате вокруг игрока, сдвинутом вперёд по взгляду: позади они не нужны.
      keyBox:
        this.pocket && this.env.key?.reach
          ? {
              center: [rig.camPos[0] - Math.sin(rig.camYaw) * this.env.key.reach * 0.35, rig.camPos[1] - 1.42, rig.camPos[2] - Math.cos(rig.camYaw) * this.env.key.reach * 0.35],
              half: this.env.key.reach,
            }
          : null,
      dissolve,
      wire,
      crt,
      flash,
    };
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
      pocket: this.pocket?.kind ?? null,
      pocketInfo: this.pocket
        ? { age: this.pocketAge, stay: this.pocketStay, done: this.pocketDone, fade: this.pocketFade, exit: this.pocket.exit ?? null, focus: this.pocket.focus ?? null, blanks: this.blanks.map((t) => t.id) }
        : null,
      jump: tr ? { cause: tr.plan.cause, style: tr.plan.style, to: tr.plan.to, switched: tr.switched } : null,
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
