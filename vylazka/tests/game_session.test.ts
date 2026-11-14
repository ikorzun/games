import { beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import { Game, STEP } from '../src/game';
import type { DreamEvent, FearEvent, StepEvents } from '../src/game';
import { emptyInput } from '../src/player/input';
import type { InputFrame } from '../src/player/input';
import type { FrameView, GameRenderer, ThingView } from '../src/render/renderer';
import { DEFAULT_SESSION } from '../src/systems/session';
import type { SessionEvent } from '../src/systems/session';
import { looksAt } from '../src/systems/things';
import { nodesInRange } from '../src/swarm/ai';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { ALL_PROPS } from '../src/world/props_all';
import { setThingRegistry } from '../src/world/thing_mesh';

const SEED = 20041113;

/** Поддельный рендер: те методы GameRenderer, которые зовёт Game. Запоминает, что ему показали. */
class FakeRenderer {
  readonly things = new Map<number, ThingView | null>();
  frames: FrameView[] = [];
  pocketShown = false;
  worlds = 0;
  private next = 1;
  setWorld(): void {
    this.worlds += 1;
  }
  setGlow(): void {}
  setSwarm(): void {}
  setChunkVisible(): void {}
  setPocket(m: unknown): void {
    this.pocketShown = m !== null;
  }
  addThing(): number {
    const id = this.next++;
    this.things.set(id, null);
    return id;
  }
  setThing(id: number, v: ThingView): void {
    if (this.things.has(id)) this.things.set(id, v);
  }
  removeThing(id: number): void {
    this.things.delete(id);
  }
  render(v: FrameView): void {
    this.frames.push(v);
    if (this.frames.length > 8) this.frames.shift();
  }
}

const levels = new Map<string, BuiltLevel>();
function levelOf(seed: number, rank: 1 | 2 | 3 = 3): BuiltLevel {
  const k = `${seed}/${rank}`;
  let l = levels.get(k);
  if (!l) levels.set(k, (l = buildLevel(generateLayout(seed, rank))));
  return l;
}

/** Короткая сессия: вспышки через секунду после «вспомнил», без ожидания наблюдения. */
const QUICK = { ...DEFAULT_SESSION, firstDelay: 1, delay: 1, fallback: 0, minLength: 0 };

interface Log {
  session: SessionEvent[];
  dream: DreamEvent[];
  fear: FearEvent[];
  all: StepEvents[];
}

class Harness {
  readonly r = new FakeRenderer();
  readonly game: Game;
  readonly log: Log = { session: [], dream: [], fear: [], all: [] };

  constructor(
    level: BuiltLevel,
    opts: { calm?: boolean; seed?: number; known?: ReadonlySet<string>; cfg?: typeof QUICK } = {},
  ) {
    this.game = new Game(this.r as unknown as GameRenderer, mulberry32(opts.seed ?? 7));
    this.game.calm = opts.calm ?? true;
    this.game.sessionCfg = opts.cfg ?? QUICK;
    this.game.loadLevel(level, { seed: opts.seed ?? 7, known: opts.known ?? new Set() });
  }

  /** Один шаг симуляции и кадр, как оборот главного цикла приложения. */
  tick(input: InputFrame = emptyInput()): StepEvents {
    const ev = this.game.step(STEP, input);
    this.game.draw(1, STEP);
    this.log.session.push(...ev.session);
    this.log.dream.push(...ev.dream);
    this.log.fear.push(...ev.fear);
    this.log.all.push(ev);
    return ev;
  }

  run(seconds: number, input?: InputFrame): void {
    for (let i = 0; i < Math.round(seconds / STEP); i++) this.tick(input ? { ...input } : emptyInput());
  }

  /** Идти, пока не случится событие; false — не случилось за max секунд. */
  until(done: () => boolean, max: number): boolean {
    for (let i = 0; i < Math.round(max / STEP); i++) {
      if (done()) return true;
      this.tick();
    }
    return done();
  }

  count(type: string): number {
    return this.log.session.filter((e) => e.type === type).length;
  }

  dreamCount(type: string, phase?: string): number {
    return this.log.dream.filter((e) => e.type === type && (phase === undefined || (e as { phase?: string }).phase === phase)).length;
  }

  /** Встать перед вещью лицом к ней так, чтобы игра её «видела» (как gotoThing в отладочном API). */
  standBefore(id: number): boolean {
    const g = this.game;
    const t = g.things.list.find((x) => x.id === id);
    if (!t) return false;
    const [x, y, z] = t.pos;
    const aimY = y + Math.max(0.2, t.radius * 0.6);
    const floor = Math.floor((y + 0.3) / 4.5) * 4.5;
    const los = (from: Vec3, to: Vec3): number => {
      const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) || 1;
      return g.colliders.raycast(from[0], from[1], from[2], (to[0] - from[0]) / d, (to[1] - from[1]) / d, (to[2] - from[2]) / d, d);
    };
    for (const r of [1.1, 2.2, 1.7, 3]) {
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        g.teleport(x + Math.cos(a) * r, floor, z + Math.sin(a) * r);
        this.tick();
        this.tick();
        g.aimAt(x, aimY, z);
        this.tick();
        this.tick();
        const s = g.snapshot() as { eye: Vec3; lightDir: Vec3 };
        if (looksAt({ eye: s.eye, aim: s.lightDir, light: 1 }, [x, aimY, z], t.radius, 5.5, los)) return true;
      }
    }
    return false;
  }

  /** Дождаться вспышки (rush) и встать перед вещью воспоминания. */
  reveal(): { id: number; memoryId: string } {
    const s = this.game.session!;
    s.rush();
    expect(this.until(() => s.active !== null, 3), 'вспышка не пришла').toBe(true);
    const t = this.game.things.list.find((x) => x.memory)!;
    return { id: t.id, memoryId: s.active!.def.id };
  }
}

beforeAll(() => setThingRegistry(ALL_PROPS));

describe('игра целиком: цикл сессии', () => {
  it('вспышка → взгляд на вещь → recall → … → all-done → лимбо → queueSession → новая сессия сама', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    const first = g.session!;
    const ids: string[] = [];
    // Заданий на входе нет: первые полсекунды тихо.
    h.run(0.5);
    expect(first.active).toBeNull();
    expect(h.log.session).toEqual([]);

    for (let k = 0; k < first.memories.length; k++) {
      expect(h.until(() => first.active !== null || first.over, 4), `вспышка ${k}`).toBe(true);
      const m = first.active!;
      ids.push(m.def.id);
      const thing = g.things.list.find((x) => x.memory)!;
      expect(thing.kind).toBe(m.def.thing);
      expect(thing.pos).toEqual([m.spot!.x, m.spot!.y, m.spot!.z]);
      expect(h.standBefore(thing.id), `встать перед «${m.def.thing}»`).toBe(true);
      const before = h.count('recall');
      expect(h.until(() => h.count('recall') > before, 4), `вспомнить «${m.def.id}»`).toBe(true);
      expect(m.state).toBe('done');
      // Вещь рассыпается: идёт превращение, а потом её нет.
      expect(thing.state === 'changing' || thing.state === 'gone').toBe(true);
    }
    expect(h.count('reveal')).toBe(5);
    expect(h.count('recall')).toBe(5);
    expect(h.count('forgot')).toBe(0);
    expect(h.count('all-done')).toBe(1);
    expect(first.over).toBe(true);
    expect(g.archive).toEqual(ids);
    // Вещи воспоминаний рассыпались; сама сессия цела до самого конца — смерти нет.
    expect(g.things.list.filter((t) => t.memory).length).toBe(0);

    // Через несколько секунд место рассыпается, игрок в лимбо.
    expect(h.until(() => g.where === 'limbo', 8)).toBe(true);
    expect(h.log.dream.some((e) => e.type === 'jump' && e.plan.cause === 'end' && e.plan.style === 'dissolve' && e.plan.to === 'limbo' && e.phase === 'start')).toBe(true);
    // Событие limbo — когда переход закончился и можно просить следующую сессию.
    expect(h.until(() => h.dreamCount('limbo') > 0, 4)).toBe(true);
    h.run(0.5);
    expect(h.dreamCount('limbo')).toBe(1);
    expect(g.pocket?.kind).toBe('void');
    // В лимбо копятся вспомненные вещи.
    expect(g.things.list.map((t) => t.kind).length).toBe(5);
    expect(g.env.light).toBeLessThan(0.5);

    // Приложение собирает следующую сессию и отдаёт её игре: лимбо отпускает не раньше семи секунд.
    const next = levelOf(SEED + 1, 2);
    g.queueSession(next, { seed: 99, known: new Set(g.archive) });
    expect(g.where).toBe('limbo');
    h.run(4);
    expect(g.where).toBe('limbo');
    expect(h.dreamCount('begin')).toBe(0);
    expect(h.until(() => h.dreamCount('begin') > 0, 12)).toBe(true);
    expect(h.dreamCount('begin')).toBe(1);
    const second = g.session!;
    expect(second).not.toBe(first);
    expect(g.where).toBe('main');
    expect(g.level).toBe(next);
    expect(second.memories.length).toBe(5);
    // Новая сессия — другие воспоминания: уже вспомненное пошло бы в конец.
    expect(second.memories.some((m) => ids.includes(m.def.id))).toBe(false);
    // И она начинается сама: ещё через секунду-другую приходит первая вспышка.
    expect(h.until(() => second.active !== null, 5)).toBe(true);
    // Архив пережил смену сессий.
    expect(g.archive).toEqual(ids);
    expect(h.r.pocketShown).toBe(false);
  });

  it('до recall — вещь, на которую не смотрят, не засчитывается; цель «забывается» только от провала, газа и роя', () => {
    const h = new Harness(levelOf(SEED), { seed: 4 });
    const { id } = h.reveal();
    h.run(6);
    expect(h.count('recall')).toBe(0);
    expect(h.game.session!.hold).toBe(0);
    expect(h.game.things.list.find((t) => t.id === id)!.state).toBe('idle');
    expect(h.count('forgot')).toBe(0);
  });

  it('вещь воспоминания не меняется под взглядом сама, пока сессия её не вспомнила: взгляд < lookTime — вещь на месте', () => {
    const h = new Harness(levelOf(SEED), { seed: 5, cfg: { ...QUICK, lookTime: 60 } });
    const { id } = h.reveal();
    expect(h.standBefore(id)).toBe(true);
    h.run(8);
    const t = h.game.things.list.find((x) => x.id === id)!;
    expect(t.state).toBe('idle');
    expect(t.scale).toBe(1);
    expect(h.game.session!.hold).toBeGreaterThan(0.05);
    expect(h.count('recall')).toBe(0);
  });
});

describe('игра целиком: провал, газ и рой не кончают сессию', () => {
  /** Игрока ловит рой, пока ищут вещь: возвращает всё, что нужно для проверок. */
  function caught(seed: number): { h: Harness; id: number; memoryId: string; was: number[]; nodeBefore: number } {
    const h = new Harness(levelOf(SEED), { calm: false, seed });
    const g = h.game;
    h.run(2);
    const { id, memoryId } = h.reveal();
    const was = [...g.things.list.find((t) => t.id === id)!.pos];
    const nodeBefore = g.playerNode();
    // Рой собран и охотится в нескольких клетках от игрока.
    const sw = g.swarm!;
    const near = sw.nodeAround(nodeBefore, 3, 4);
    expect(near).toBeGreaterThanOrEqual(0);
    sw.activate(near);
    sw.mode = 'hunt';
    sw.cohesion = 1;
    sw.awareness = 1;
    // Спиной к рою: луч на него не ложится, иначе он развалится, не добежав.
    const b = g.body;
    g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
    expect(h.until(() => h.log.fear.some((e) => e.type === 'swarm' && e.what === 'caught'), 25), 'рой не поймал').toBe(true);
    return { h, id, memoryId, was, nodeBefore };
  }

  it('поимка роем: forgot и скачок в другое место убежища; сессия идёт дальше, цель остаётся искомой', () => {
    const { h, memoryId, nodeBefore } = caught(6);
    const g = h.game;
    expect(h.count('forgot')).toBe(1);
    const forgot = h.log.session.find((e) => e.type === 'forgot') as Extract<SessionEvent, { type: 'forgot' }>;
    expect(forgot.memory.def.id).toBe(memoryId);
    expect(g.transition?.plan).toMatchObject({ cause: 'caught', style: 'blackout', to: 'elsewhere' });
    // Скачок отработал: игрок в убежище, в другом месте, сессия не кончилась.
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    expect(g.where).toBe('main');
    expect(g.session!.over).toBe(false);
    expect(g.session!.active?.def.id).toBe(memoryId);
    expect(g.playerNode()).not.toBe(nodeBefore);
    expect(h.count('all-done')).toBe(0);
    expect(h.dreamCount('limbo')).toBe(0);
    expect(h.dreamCount('jump', 'start')).toBe(1);
    expect(h.dreamCount('jump', 'switch')).toBe(1);
  });

  it('поимка роем: искомая вещь переезжает на новое место сессии, и её можно найти и вспомнить там', () => {
    const { h, id, was } = caught(6);
    const g = h.game;
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    const spot = g.session!.active!.spot!;
    const now = g.things.list.find((t) => t.id === id)!;
    // Вещь в мире стоит там же, где сессия ждёт взгляда; со старого места она ушла.
    expect(now.pos).not.toEqual(was);
    expect(now.pos).toEqual([spot.x, spot.y, spot.z]);
    expect(h.standBefore(id)).toBe(true);
    expect(h.until(() => h.count('recall') > 0, 5)).toBe(true);
  });

  it('провал в яму: fall, forgot, карман; по краю пространства игру возвращает в убежище', () => {
    const level = levelOf(SEED);
    const h = new Harness(level, { seed: 8 });
    const g = h.game;
    h.run(2);
    const { id, memoryId } = h.reveal();
    const was = [...g.things.list.find((t) => t.id === id)!.pos];
    const pit = level.zones.find((z) => z.kind === 'pit')!;
    g.teleport((pit.minX + pit.maxX) / 2, pit.maxY - 0.3, (pit.minZ + pit.maxZ) / 2);
    h.tick();
    expect(h.count('fall')).toBe(1);
    expect(h.count('forgot')).toBe(1);
    expect(g.transition?.plan).toMatchObject({ cause: 'fall', style: 'whiteout' });
    expect(['void', 'meadow', 'dollhouse']).toContain(g.transition!.plan.to);
    expect(h.until(() => g.where === 'pocket', 4)).toBe(true);
    expect(g.pocket).not.toBeNull();
    expect(g.session!.over).toBe(false);
    expect(g.session!.active?.def.id).toBe(memoryId);
    expect(g.things.list.find((t) => t.id === id)!.pos).not.toEqual(was);
    // Уйти за край пространства — вернуться в убежище.
    h.run(0.5);
    const p = g.pocket!;
    g.teleport(p.center[0] + p.radius + 5, p.center[1], p.center[2]);
    expect(h.until(() => g.where === 'main', 6)).toBe(true);
    expect(g.pocket).toBeNull();
    expect(h.dreamCount('limbo')).toBe(0);
  });

  it('газ: gas-enter, кашель, faint после faintTime — скачок вместо смерти', () => {
    const level = levelOf(SEED);
    const h = new Harness(level, { seed: 9 });
    const g = h.game;
    h.run(2);
    h.reveal();
    const gas = level.zones.find((z) => z.kind === 'gas')!;
    g.teleport((gas.minX + gas.maxX) / 2, gas.minY + 0.2, (gas.minZ + gas.maxZ) / 2);
    expect(h.until(() => h.count('faint') > 0, 9)).toBe(true);
    expect(h.count('gas-enter')).toBe(1);
    expect(h.count('cough')).toBeGreaterThan(0);
    expect(h.count('forgot')).toBe(1);
    expect(g.transition?.plan).toMatchObject({ cause: 'faint', style: 'dissolve' });
    expect(h.until(() => g.where === 'pocket', 5)).toBe(true);
    expect(g.session!.over).toBe(false);
  });
});

describe('игра целиком: особенности помещений и спокойный режим', () => {
  it('в «тёмных» помещениях вещей нет: ни мелочи сна, ни вещей воспоминаний — на нескольких уровнях', () => {
    let withDark = 0;
    for (const seed of [SEED, 101, 202, 303, 404, 505]) {
      const level = levelOf(seed);
      const h = new Harness(level, { seed, cfg: { ...QUICK, count: 8 } });
      const g = h.game;
      const dark = new Set([...g.roomFx].filter(([, fx]) => fx === 'dark').map(([room]) => room));
      if (dark.size > 0) withDark += 1;
      const roomOf = (p: readonly number[]): number | undefined => level.spots.find((s) => s.x === p[0] && s.y === p[1] && s.z === p[2])?.room;
      // Вещи сна: всё, что стоит на «месте для вещей», стоит не в тёмном помещении.
      for (const t of g.things.list) {
        const room = roomOf(t.pos);
        if (room !== undefined) expect(dark.has(room), `сид ${seed}: ${t.kind} в тёмном помещении ${room}`).toBe(false);
      }
      // Вещи воспоминаний: все восемь вспышек.
      const s = g.session!;
      for (let k = 0; k < 8; k++) {
        s.rush();
        h.until(() => s.active !== null, 3);
        const m = s.active!;
        expect(m, `сид ${seed}: вспышка ${k}`).toBeTruthy();
        expect(dark.has(m.spot!.room), `сид ${seed}: воспоминание в тёмном помещении`).toBe(false);
        // Закрываем его, не ходя: сессия считает воспоминание вспомненным.
        m.state = 'done';
      }
    }
    // Проверка осмысленна, только если тёмные помещения вообще бывают.
    expect(withDark).toBeGreaterThanOrEqual(3);
  });

  it('calm = true выключает случайные скачки и рой; без него — тот же сценарий кончается скачком', () => {
    const level = levelOf(SEED);
    const scenario = (calm: boolean): Harness => {
      const h = new Harness(level, { calm, seed: 12 });
      h.run(2);
      // Игрок стоит в полной темноте: фонарь выключен. Паузу до первого случайного скачка снимаем.
      h.game.jumps!.cooldown = 0;
      h.tick({ ...emptyInput(), light: true });
      expect(h.game.light.state).toBe('off');
      h.run(14);
      return h;
    };
    const quiet = scenario(true);
    expect(quiet.dreamCount('jump')).toBe(0);
    expect(quiet.game.jumps!.count).toBe(0);
    expect(quiet.game.where).toBe('main');
    expect(quiet.game.swarm!.mode).toBe('dormant');

    const loud = scenario(false);
    const jumps = loud.log.dream.filter((e) => e.type === 'jump' && e.phase === 'start');
    expect(jumps.length).toBeGreaterThanOrEqual(1);
    expect(jumps[0]).toMatchObject({ plan: { cause: 'dark', style: 'blackout' } });
  });

  it('calm не мешает обязательному: провал в яму и в calm выбрасывает', () => {
    const level = levelOf(SEED);
    const h = new Harness(level, { calm: true, seed: 13 });
    h.run(2);
    const pit = level.zones.find((z) => z.kind === 'pit')!;
    h.game.teleport((pit.minX + pit.maxX) / 2, pit.maxY - 0.3, (pit.minZ + pit.maxZ) / 2);
    h.tick();
    expect(h.count('fall')).toBe(1);
    expect(h.game.transition?.plan.cause).toBe('fall');
  });

  it('свободная прогулка (без сессии): ни вспышек, ни скачков, ни вещей', () => {
    const r = new FakeRenderer();
    const game = new Game(r as unknown as GameRenderer, mulberry32(1));
    game.loadLevel(levelOf(SEED), null);
    expect(game.session).toBeNull();
    expect(game.jumps).toBeNull();
    for (let i = 0; i < 600; i++) {
      const ev = game.step(STEP, emptyInput());
      game.draw(1, STEP);
      expect(ev.session).toEqual([]);
      expect(ev.dream).toEqual([]);
    }
    expect(game.things.list.length).toBe(0);
  });
});

describe('игра целиком: рендер получает разумный кадр', () => {
  it('кадры идут с конечными числами; вещи видны в мире, а в лимбо убежище скрыто пространством', () => {
    const h = new Harness(levelOf(SEED), { seed: 14 });
    h.run(2);
    const f = h.r.frames.at(-1)!;
    for (const v of [...f.camPos, f.camYaw, f.camPitch, f.gain, f.fade, f.lightScale]) expect(Number.isFinite(v)).toBe(true);
    expect(h.r.things.size).toBe(h.game.things.list.length);
    expect(h.r.things.size).toBeGreaterThan(5);
    h.game.debugFinish();
    expect(h.until(() => h.game.where === 'limbo', 8)).toBe(true);
    h.run(1);
    expect(h.r.pocketShown).toBe(true);
    expect(h.r.frames.at(-1)!.fogColor[0]).toBeGreaterThan(0.5);
  });
});

/** Что игра рассказывает о карманном пространстве в снимке состояния (отладочный API читает то же самое). */
interface PocketInfo {
  age: number;
  stay: number;
  done: boolean;
  fade: number;
  exit: Vec3 | null;
  focus: Vec3 | null;
  blanks: number[];
}
/** Сессия, где воспоминание само не придёт: «искать нечего». */
const NOTHING = { ...QUICK, firstDelay: 500, delay: 500 };
const info = (h: Harness): PocketInfo => (h.game.snapshot() as unknown as { pocketInfo: PocketInfo | null }).pocketInfo!;
type PocketEvent = Extract<DreamEvent, { type: 'pocket' }>;
const pocketEvents = (h: Harness, what?: string): PocketEvent[] => h.log.dream.filter((e): e is PocketEvent => e.type === 'pocket' && (what === undefined || e.what === what));

/** Скачок в карманное пространство: ждём, пока скачок кончится. */
function enter(h: Harness, kind: 'void' | 'meadow' | 'dollhouse'): void {
  expect(h.until(() => h.game.transition === null, 5)).toBe(true);
  expect(h.game.beginJump({ cause: 'gaze', style: 'cut', to: kind }, [])).toBe(true);
  expect(h.until(() => h.game.where === 'pocket' && h.game.transition === null, 5), `вход в ${kind}`).toBe(true);
  expect(h.game.pocket!.kind).toBe(kind);
}

/** Встать на выход пространства: ровно в проём. */
function stepInto(h: Harness): void {
  const g = h.game;
  const e = g.pocket!.exit!;
  g.teleport(e[0], g.pocket!.spawn.pos[1], e[2]);
}

/** Встать перед выходом (по его оси) или перед макетом (со стороны точки появления) и посмотреть на него. */
function standAt(h: Harness, what: 'exit' | 'focus', distance = what === 'exit' ? 1.6 : 1.5): void {
  const g = h.game;
  const p = g.pocket!;
  const at = (what === 'exit' ? p.exit : p.focus)!;
  const dx = what === 'exit' ? 0 : p.spawn.pos[0] - at[0];
  const dz = what === 'exit' ? 1 : p.spawn.pos[2] - at[2];
  const d = Math.hypot(dx, dz) || 1;
  g.teleport(at[0] + (dx / d) * distance, p.spawn.pos[1], at[2] + (dz / d) * distance);
  h.tick();
  h.tick();
  g.aimAt(at[0], what === 'exit' ? at[1] + 1.2 : at[1], at[2]);
  h.tick();
  h.tick();
}

/** Вспомнить текущее воспоминание (встать перед вещью и подержать в луче). */
function recallActive(h: Harness): void {
  const t = h.game.things.list.find((x) => x.memory)!;
  expect(h.standBefore(t.id)).toBe(true);
  const before = h.count('recall');
  expect(h.until(() => h.count('recall') > before, 5)).toBe(true);
}

describe('игра целиком: карманные пространства обретают смысл', () => {
  it('вход в кукольный домик даёт событие enter: с искомым воспоминанием, если оно идёт, и без — если нет', () => {
    const idle = new Harness(levelOf(SEED), { seed: 21, cfg: NOTHING });
    idle.run(0.3);
    expect(idle.game.session!.active).toBeNull();
    enter(idle, 'dollhouse');
    const e0 = pocketEvents(idle, 'enter');
    expect(e0).toHaveLength(1);
    expect(e0[0]).toMatchObject({ kind: 'dollhouse', what: 'enter' });
    expect(e0[0]!.memory).toBeUndefined();

    const h = new Harness(levelOf(SEED), { seed: 22 });
    const { memoryId } = h.reveal();
    enter(h, 'dollhouse');
    const e1 = pocketEvents(h, 'enter');
    expect(e1).toHaveLength(1);
    expect(e1[0]).toMatchObject({ kind: 'dollhouse', what: 'enter', memory: memoryId });
    // Остальные виды тоже говорят о входе.
    for (const kind of ['void', 'meadow'] as const) {
      const k = new Harness(levelOf(SEED), { seed: 23 });
      enter(k, kind);
      expect(pocketEvents(k, 'enter')).toMatchObject([{ kind, what: 'enter' }]);
    }
  });

  it('взгляд на макет: map с помещением и ярусом искомой вещи; срок пребывания сокращается до «сейчас + 14 с»', () => {
    const level = levelOf(SEED);
    const h = new Harness(level, { seed: 24 });
    const { memoryId } = h.reveal();
    const spot = h.game.session!.active!.spot!;
    enter(h, 'dollhouse');
    expect(info(h).focus).not.toBeNull();
    expect(info(h).done).toBe(false);
    standAt(h, 'focus');
    expect(h.until(() => pocketEvents(h, 'map').length > 0, 4), 'макет не прочитан').toBe(true);
    const m = pocketEvents(h, 'map')[0]!;
    expect(m).toMatchObject({ kind: 'dollhouse', what: 'map', memory: memoryId });
    // Помещение — настоящее помещение уровня, ярус — ярус места, где лежит вещь.
    const room = level.layout!.rooms.find((r) => r.type === m.room);
    expect(room, `помещение ${m.room}`).toBeTruthy();
    expect(m.tier).toBe(Math.max(0, Math.round(-spot.y / 4.5)));
    const inf = info(h);
    expect(inf.done).toBe(true);
    expect(inf.stay).toBeLessThanOrEqual(inf.age + 14.01);
    // Один раз за заход.
    h.run(3);
    expect(pocketEvents(h, 'map')).toHaveLength(1);
  });

  it('макет, когда искать нечего: map без воспоминания', () => {
    const h = new Harness(levelOf(SEED), { seed: 25, cfg: NOTHING });
    h.run(0.3);
    expect(h.game.session!.active).toBeNull();
    enter(h, 'dollhouse');
    standAt(h, 'focus');
    expect(h.until(() => pocketEvents(h, 'map').length > 0, 4)).toBe(true);
    const m = pocketEvents(h, 'map')[0]!;
    expect(m.memory).toBeUndefined();
    expect(m.room).toBeUndefined();
  });

  it('в белом нигде перед игроком экспонаты: вспомненное — своей вещью, остальное — болванками; взгляд на вспомненное даёт replay', () => {
    const h = new Harness(levelOf(SEED), { seed: 26 });
    h.reveal();
    recallActive(h);
    const first = h.game.session!.memories.find((m) => m.state === 'done')!;
    // Вспомнили одно — сессия ещё идёт; пока следующее не пришло, уходим в белое нигде.
    expect(h.game.session!.active).toBeNull();
    enter(h, 'void');
    const g = h.game;
    const still = g.things.list.filter((t) => t.still);
    expect(still).toHaveLength(g.session!.memories.length);
    expect(still.filter((t) => t.kind === 'blank')).toHaveLength(g.session!.memories.length - 1);
    expect(info(h).blanks).toHaveLength(g.session!.memories.length - 1);
    const mine = still.find((t) => t.kind === first.def.thing)!;
    expect(mine).toBeTruthy();
    // Они стоят дугой перед игроком, на радиусе 3,4 м.
    const sp = g.pocket!.spawn.pos;
    for (const t of still) expect(Math.hypot(t.pos[0] - sp[0], t.pos[2] - sp[2])).toBeCloseTo(3.4, 1);
    expect(h.standBefore(mine.id)).toBe(true);
    expect(h.until(() => pocketEvents(h, 'replay').length > 0, 5)).toBe(true);
    expect(pocketEvents(h, 'replay')[0]).toMatchObject({ kind: 'void', what: 'replay', memory: first.def.id });
    // Экспонат не изменился, сессия ничего не вызвала.
    expect(mine.state).toBe('idle');
    expect(pocketEvents(h, 'next')).toHaveLength(0);
    expect(info(h).done).toBe(false);
  });

  it('болванка без идущего воспоминания: next, и следующее воспоминание приходит сразу после возврата (а без взгляда — нет)', () => {
    // Пауза между воспоминаниями огромна: само следующее не придёт ни в карманном пространстве, ни после него.
    const cfg = { ...QUICK, delay: 500 };
    const scenario = (look: boolean): Harness => {
      const h = new Harness(levelOf(SEED), { seed: 27, cfg });
      h.reveal();
      recallActive(h);
      const g = h.game;
      expect(g.session!.active).toBeNull();
      const back = g.playerNode();
      enter(h, 'void');
      if (look) {
        const blank = g.things.list.find((t) => t.still && t.kind === 'blank')!;
        expect(h.standBefore(blank.id)).toBe(true);
        expect(h.until(() => pocketEvents(h, 'next').length > 0, 5), 'болванка не сработала').toBe(true);
        expect(info(h).done).toBe(true);
        expect(info(h).stay).toBeLessThanOrEqual(info(h).age + 14.01);
      } else h.run(2);
      // Выходим через проём.
      stepInto(h);
      expect(h.until(() => g.where === 'main' && g.transition === null, 8)).toBe(true);
      expect(g.playerNode()).toBe(back);
      return h;
    };
    const asked = scenario(true);
    expect(asked.until(() => asked.game.session!.active !== null, 3), 'следующее воспоминание не пришло').toBe(true);
    const idle = scenario(false);
    idle.run(3);
    expect(idle.game.session!.active).toBeNull();
    expect(pocketEvents(idle, 'next')).toHaveLength(0);
  });

  it('болванка при идущем воспоминании: remind, воспоминание не торопят', () => {
    const h = new Harness(levelOf(SEED), { seed: 28 });
    const { memoryId } = h.reveal();
    enter(h, 'void');
    const blank = h.game.things.list.find((t) => t.still && t.kind === 'blank')!;
    expect(blank).toBeTruthy();
    expect(h.standBefore(blank.id)).toBe(true);
    expect(h.until(() => pocketEvents(h, 'remind').length > 0, 5)).toBe(true);
    expect(pocketEvents(h, 'remind')[0]).toMatchObject({ kind: 'void', what: 'remind', memory: memoryId });
    expect(pocketEvents(h, 'next')).toHaveLength(0);
    expect(h.game.session!.active?.def.id).toBe(memoryId);
  });

  it('лимбо: выхода нет, болванок нет, экспонатов нет', () => {
    const h = new Harness(levelOf(SEED), { seed: 29 });
    h.game.debugFinish();
    expect(h.until(() => h.game.where === 'limbo', 8)).toBe(true);
    expect(h.game.pocket!.exit).toBeNull();
    h.run(1);
    expect(info(h).exit).toBeNull();
    expect(info(h).blanks).toEqual([]);
    expect(h.game.things.list.some((t) => t.still)).toBe(false);
  });

  it.each(['void', 'dollhouse'] as const)('проход сквозь выход (%s) возвращает в убежище, в узел, откуда унесло; раньше 1,5 с он не действует', (kind) => {
    const h = new Harness(levelOf(SEED), { seed: 30 });
    const g = h.game;
    h.run(1);
    const back = g.playerNode();
    expect(back).toBeGreaterThanOrEqual(0);
    enter(h, kind);
    // Сразу после входа проём ещё «спит».
    stepInto(h);
    h.tick();
    h.tick();
    expect(g.transition).toBeNull();
    expect(info(h).age).toBeLessThan(1.5);
    expect(h.until(() => g.transition !== null, 2)).toBe(true);
    expect(g.transition!.plan).toMatchObject({ cause: 'return', style: 'whiteout', to: 'elsewhere', dest: 'back' });
    expect(h.until(() => g.where === 'main' && g.transition === null, 6)).toBe(true);
    expect(g.pocket).toBeNull();
    expect(g.playerNode()).toBe(back);
  });

  it('в стороне от проёма (дальше полуметра от его середины) выход не срабатывает', () => {
    const h = new Harness(levelOf(SEED), { seed: 31 });
    enter(h, 'void');
    const g = h.game;
    const e = g.pocket!.exit!;
    g.teleport(e[0] + 0.7, g.pocket!.spawn.pos[1], e[2]);
    h.run(3);
    expect(g.transition).toBeNull();
    expect(g.where).toBe('pocket');
  });

  it.each(['void', 'meadow', 'dollhouse'] as const)('взгляд на проём (%s) никуда не уносит: стоять перед ним и смотреть можно сколько угодно', (kind) => {
    const h = new Harness(levelOf(SEED), { seed: 32 });
    h.run(1);
    enter(h, kind);
    const g = h.game;
    // Встал в метре от проёма и смотрит прямо в него двадцать секунд.
    standAt(h, 'exit', 1);
    h.run(20);
    expect(g.transition).toBeNull();
    expect(g.where).toBe('pocket');
  });

  it.each(['void', 'meadow'] as const)('кто просто стоит там, где появился (%s), остаётся в пространстве до середины срока', (kind) => {
    const h = new Harness(levelOf(SEED), { seed: 33 });
    h.run(1);
    enter(h, kind);
    const g = h.game;
    // Появляется лицом к проёму: раньше взгляд на него сам выводил обратно на восьмой секунде.
    h.run(20);
    expect(g.transition).toBeNull();
    expect(g.where).toBe('pocket');
  });

  it('дверь луга при идущем воспоминании выводит не дальше 4 клеток пути от искомой вещи', () => {
    const level = levelOf(SEED);
    for (const seed of [33, 34, 35, 36]) {
      const h = new Harness(level, { seed });
      const g = h.game;
      h.run(1);
      h.reveal();
      const spot = g.session!.active!.spot!;
      // Узел вещи считаем так же, как игра: по клетке сетки и ярусу.
      const cx = Math.round(spot.x / 3) + 8;
      const cz = Math.round(spot.z / 3) + 8;
      const t = Math.max(0, Math.round(-spot.y / 4.5));
      const at = [t, t - 1, t + 1].map((tier) => level.nav.find((n) => n.tier === tier && n.cx === cx && n.cz === cz)).find((n) => n)!;
      expect(at).toBeTruthy();
      enter(h, 'meadow');
      stepInto(h);
      expect(h.until(() => g.transition !== null, 3)).toBe(true);
      expect(g.transition!.plan).toMatchObject({ cause: 'return', style: 'whiteout', dest: 'thing' });
      expect(h.until(() => g.where === 'main' && g.transition === null, 6)).toBe(true);
      expect(nodesInRange(level.nav, at.id, 0, 4), `сид ${seed}: вышли не рядом с вещью`).toContain(g.playerNode());
    }
  });

  it('дверь луга без идущего воспоминания возвращает обратно', () => {
    const h = new Harness(levelOf(SEED), { seed: 37, cfg: NOTHING });
    h.run(0.3);
    expect(h.game.session!.active).toBeNull();
    const back = h.game.playerNode();
    enter(h, 'meadow');
    stepInto(h);
    expect(h.until(() => h.game.transition !== null, 3)).toBe(true);
    expect(h.game.transition!.plan.dest).toBe('back');
    expect(h.until(() => h.game.where === 'main' && h.game.transition === null, 6)).toBe(true);
    expect(h.game.playerNode()).toBe(back);
  });

  it('на лугу паника падает быстрее обычного (около 0,22 в секунду), в белом нигде — как обычно', () => {
    const drop = (kind: 'meadow' | 'void'): number => {
      const h = new Harness(levelOf(SEED), { seed: 38 });
      enter(h, kind);
      const s = h.game.session!;
      s.panic = 0.9;
      h.run(2);
      return 0.9 - s.panic;
    };
    const meadow = drop('meadow');
    expect(meadow).toBeGreaterThanOrEqual(0.22 * 2 - 0.02);
    expect(drop('void')).toBeLessThan(meadow);
  });

  it('pocketFade: 1 в первой половине срока, к концу меньше 0,3; в убежище всегда 1', () => {
    const h = new Harness(levelOf(SEED), { seed: 39 });
    const g = h.game;
    expect(g.pocketFade).toBe(1);
    enter(h, 'void');
    const inf = info(h);
    // Белое нигде появляется лицом к экспонатам: отворачиваемся, иначе взгляд на болванку сократит срок.
    const sp = g.pocket!.spawn.pos;
    g.teleport(sp[0], sp[1], sp[2], Math.PI, 0);
    expect(inf.stay).toBeGreaterThanOrEqual(46);
    expect(inf.stay).toBeLessThanOrEqual(60);
    // До половины срока ничего не редеет.
    expect(h.until(() => info(h).age >= info(h).stay * 0.5 - 0.1, 40)).toBe(true);
    expect(g.pocketFade).toBe(1);
    // Потом падает монотонно и к концу меньше 0,3 (до 0,2).
    let prev = 1;
    while (info(h).age < info(h).stay - 1 && g.where === 'pocket') {
      h.run(1);
      if (g.where !== 'pocket') break;
      expect(g.pocketFade).toBeLessThanOrEqual(prev + 1e-9);
      prev = g.pocketFade;
    }
    expect(prev).toBeLessThan(0.3);
    expect(prev).toBeGreaterThanOrEqual(0.2 - 1e-6);
    // И само пространство отпускает после срока.
    expect(h.until(() => g.where === 'main', 6)).toBe(true);
    expect(g.pocketFade).toBe(1);
  });

  it('кадр получает scanFade и параметры света пространства', () => {
    const h = new Harness(levelOf(SEED), { seed: 40 });
    enter(h, 'meadow');
    h.run(0.2);
    const f = h.r.frames.at(-1)!;
    expect(f.scanFade).toBe(1);
    expect(f.keyColor[0] + f.keyColor[1] + f.keyColor[2]).toBeGreaterThan(0);
    expect(f.scanRange[1]).toBeGreaterThan(15);
  });
});

describe('игра целиком: без света место не обязано остаться прежним', () => {
  /** Мелкие вещи сна (не цели воспоминаний, без преграды) и их места. */
  const smallOf = (h: Harness) => h.game.things.list.filter((t) => !t.memory && !t.still && t.collider < 0 && t.state === 'idle');
  const places = (list: { pos: Vec3 }[]) => list.map((t) => t.pos.map((v) => v.toFixed(3)).join(','));
  const dark = (h: Harness) => (h.game.snapshot() as { dark: { for: number; shifts: number } }).dark;

  /** Встать так, чтобы рядом (ближе 14 м, на том же ярусе) было хотя бы три мелкие вещи. */
  function standAmong(h: Harness): ReturnType<typeof smallOf> {
    const all = smallOf(h);
    for (const t of all) {
      const near = all.filter((o) => Math.hypot(o.pos[0] - t.pos[0], o.pos[2] - t.pos[2]) < 9 && Math.abs(o.pos[1] - t.pos[1]) < 2);
      if (near.length < 3) continue;
      const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
      h.game.teleport(t.pos[0] + 0.8, floor, t.pos[2] + 0.8);
      h.run(0.2);
      return near;
    }
    throw new Error('на уровне нет трёх мелких вещей рядом');
  }

  it('пока фонарь горит, вещи стоят где стояли', () => {
    const h = new Harness(levelOf(SEED));
    const near = standAmong(h);
    const before = places(near);
    const yaws = near.map((t) => t.yaw);
    h.run(12);
    expect(places(near)).toEqual(before);
    expect(near.map((t) => t.yaw)).toEqual(yaws);
    expect(dark(h).shifts).toBe(0);
    expect(dark(h).for).toBe(0);
  });

  it('фонарь выключен: семь секунд всё на месте, потом мелкие вещи меняются местами и поворачиваются', () => {
    const h = new Harness(levelOf(SEED));
    const near = standAmong(h);
    const before = places(near);
    const yaws = near.map((t) => t.yaw);
    h.tick({ ...emptyInput(), light: true });
    h.run(6.5);
    // Место ещё держится в памяти: ничего не менялось.
    expect(places(near)).toEqual(before);
    expect(dark(h).shifts).toBe(0);
    h.run(1);
    const after = places(near);
    // Места те же самые, но вещи на них — другие: ни одна не осталась на своём.
    expect([...after].sort()).toEqual([...before].sort());
    expect(after.filter((p, i) => p === before[i]).length).toBe(0);
    expect(near.filter((t, i) => t.yaw !== yaws[i]).length).toBe(near.length);
    expect(dark(h).shifts).toBeGreaterThanOrEqual(near.length);
    // Свет вернулся — больше ничего не меняется, счёт темноты сброшен.
    h.tick({ ...emptyInput(), light: true });
    h.run(0.5);
    const settled = places(near);
    const count = dark(h).shifts;
    h.run(12);
    expect(places(near)).toEqual(settled);
    expect(dark(h).shifts).toBe(count);
    expect(dark(h).for).toBe(0);
  });

  it('темнота затянулась — детали меняются снова, каждые девять секунд', () => {
    const h = new Harness(levelOf(SEED));
    standAmong(h);
    h.tick({ ...emptyInput(), light: true });
    h.run(7.5);
    const first = dark(h).shifts;
    expect(first).toBeGreaterThan(0);
    h.run(8);
    expect(dark(h).shifts).toBe(first);
    h.run(1.5);
    expect(dark(h).shifts).toBeGreaterThan(first);
  });

  it('вещь воспоминания темнота не трогает; крупные вещи остаются на месте и с той же преградой', () => {
    const h = new Harness(levelOf(SEED));
    const { id } = h.reveal();
    const target = h.game.things.list.find((t) => t.id === id)!;
    const floor = Math.floor((target.pos[1] + 0.3) / 4.5) * 4.5;
    h.game.teleport(target.pos[0] + 1.2, floor, target.pos[2] + 1.2);
    h.run(0.2);
    const pos = [...target.pos];
    const yaw = target.yaw;
    const big = h.game.things.list.filter((t) => t.collider >= 0);
    const bigPlaces = places(big);
    const boxes = big.map((t) => ({ ...h.game.colliders.boxes[t.collider]! }));
    h.tick({ ...emptyInput(), light: true });
    h.run(17);
    expect(dark(h).for).toBeGreaterThan(16);
    expect(target.pos).toEqual(pos);
    expect(target.yaw).toBe(yaw);
    expect(places(big)).toEqual(bigPlaces);
    expect(big.map((t) => ({ ...h.game.colliders.boxes[t.collider]! }))).toEqual(boxes);
  });

  it('в карманном пространстве темноты нет: фонарь выключен, а вещи не меняются', () => {
    const h = new Harness(levelOf(SEED));
    standAmong(h);
    // Вещи убежища: у пространства появятся свои, они не в счёт.
    const mine = smallOf(h);
    const before = places(mine);
    enter(h, 'meadow');
    expect(h.game.where).toBe('pocket');
    h.tick({ ...emptyInput(), light: true });
    h.run(12);
    expect(dark(h).shifts).toBe(0);
    expect(dark(h).for).toBe(0);
    expect(places(mine)).toEqual(before);
  });
});
