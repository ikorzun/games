import { beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { defaultProfile, memoryFor } from '../src/core/save';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import { BODY_RISE, Game, MIST, SONAR_EVERY, SONAR_REACH, SONAR_SPEED, STAGE_ALL, STEP, WIRE_STILL } from '../src/game';
import type { DreamEvent, FearEvent, StepEvents } from '../src/game';
import { DEFAULT_CONTROLLER } from '../src/player/controller';
import { emptyInput } from '../src/player/input';
import type { InputFrame } from '../src/player/input';
import type { FrameView, GameRenderer, ThingView } from '../src/render/renderer';
import { DEFAULT_CELL_LIGHTS } from '../src/systems/cell_lights';
import { GLIMPSE_WAIT } from '../src/systems/director';
import { nearestExit } from '../src/systems/pressure';
import type { PressureRoom } from '../src/systems/pressure';
import { DEFAULT_SESSION, OFFICE_CHAIN, SHELTER_CHAIN, YELLOW_CHAIN } from '../src/systems/session';
import type { SessionEvent } from '../src/systems/session';
import { DEFAULT_THINGS, looksAt, Things } from '../src/systems/things';
import type { Thing } from '../src/systems/things';
import { nodesInRange } from '../src/swarm/ai';
import { DEFAULT_JUMPS, Jumps } from '../src/systems/jumps';
import { ColliderSet } from '../src/world/colliders';
import type { FlatMark } from '../src/world/flat';
import type { BuiltLevel, ItemSpot } from '../src/world/level';
import type { LevelObject } from '../src/world/objects';
import { BODY_CAPS, bodyRolled, buildLevel, cellToWorld, grassRolled, tierFloor } from '../src/world/level_build';
import { ENV_BUNKER, ENV_OFFICE, ENV_YELLOW } from '../src/world/pockets';
import { ALL_PROPS } from '../src/world/props_all';
import { DOOR_IMAGE, DOOR_NAME, SCREEN_IMAGES } from '../src/world/screens';
import { setThingRegistry } from '../src/world/thing_mesh';
import { MEM_LIGHT_KIND, MEMORY_LIGHT } from '../src/world/memory_light';
import type { FlashlightConfig } from '../src/systems/flashlight';
import { PIECE_MAX_ROOMS } from '../src/world/piece';
import type { PieceMask } from '../src/world/piece';

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
  /** Тихий слой уровня: сколько точек по рёбрам отдано рендеру. */
  edges = 0;
  setEdges(e: { count: number } | null): void {
    this.edges = e ? e.count : 0;
  }
  setGlow(): void {}
  /** Свет памяти в последнем кадре (world/memory_light.ts): где, какого рода и насколько разгорелся; null — нет. */
  memLight: { pos: number[]; kind: number; strength: number } | null = null;
  bubble: { pos: number[]; radius: number; k: number } | null = null;
  setBubble(v: { pos: readonly [number, number, number]; radius: number; k: number } | null): void {
    this.bubble = v && v.k > 0.01 ? { pos: [...v.pos], radius: v.radius, k: v.k } : null;
  }
  setMemLight(v: { pos: readonly [number, number, number]; kind: number; strength: number } | null): void {
    this.memLight = v && v.strength > 0 ? { pos: [...v.pos], kind: v.kind, strength: v.strength } : null;
  }
  /** Осыпь в последнем кадре: плотность, середина тела и виден ли её контур сквозь стены (тёмный урок). */
  swarm = { alpha: 0, center: [0, 0, 0] as Vec3, through: false };
  setSwarm(heads: Float32Array, _dirs: Float32Array, _params: Float32Array, alpha: number, _time = 0, through = false): void {
    const c: Vec3 = [0, 0, 0];
    const n = heads.length / 3;
    for (let i = 0; i < n; i++) {
      c[0] += heads[i * 3]! / n;
      c[1] += heads[i * 3 + 1]! / n;
      c[2] += heads[i * 3 + 2]! / n;
    }
    this.swarm = { alpha, center: c, through };
  }
  setChunkVisible(): void {}
  /** Маска куска места (сцена — кусок места): последняя отданная; null — помнится всё. */
  piece: PieceMask | null = null;
  setPiece(m: PieceMask | null): void {
    this.piece = m;
  }
  /** Насколько растворён каждый объект уровня (0 — стоит, 1 — его нет). */
  readonly objects = new Map<number, number>();
  setObjectState(id: number, dis: number): void {
    this.objects.set(id, dis);
  }
  /** Объекты, от которых осталось кружево; тон объектов (выцвел, светится); стирание архитектуры в последнем кадре. */
  readonly lace = new Set<number>();
  readonly tones = new Map<number, [number, number]>();
  erase: [number, number, number] = [0, 0, 0];
  setObjectLace(id: number, on: boolean): void {
    if (on) this.lace.add(id);
    else this.lace.delete(id);
  }
  setObjectTone(id: number, dull: number, glow: number): void {
    this.tones.set(id, [dull, glow]);
  }
  setErase(ceiling: number, walls: number, floor: number): void {
    this.erase = [ceiling, walls, floor];
  }
  /** Птицы в последнем кадре: сколько их и их позы (по девять чисел). */
  birds = 0;
  birdData = new Float32Array(0);
  setBirds(data: Float32Array, count: number): void {
    this.birds = count;
    this.birdData = data.slice(0, count * 9);
  }
  /** Тени-пятна под обстановкой: последняя карта и сколько раз её пересобирали. */
  contact: { data: Uint8Array; size: number; origin: readonly [number, number]; span: number } | null = null;
  contactBakes = 0;
  setContact(map: { data: Uint8Array; size: number; origin: readonly [number, number]; span: number } | null): void {
    this.contact = map;
    this.contactBakes += 1;
  }
  /** Сколько гроздей грибов в последнем кадре. */
  spores = 0;
  setSpores(_data: Float32Array, count: number): void {
    this.spores = count;
  }
  /** Сколько головок цветов оранжереи в последнем кадре. */
  flowers = 0;
  setFlowers(_data: Float32Array, count: number): void {
    this.flowers = count;
  }
  /** Сколько плиток травы в последнем кадре и первая из них (x, y, z, поворот, размеры, форма). */
  grass = 0;
  grassFirst: number[] = [];
  setGrass(data: Float32Array, count: number): void {
    this.grass = count;
    this.grassFirst = count > 0 ? [...data.slice(0, 7)] : [];
  }
  /** Вытоптанные круги травы, отданные рендеру последними. */
  grassClear: (readonly [number, number, number, number])[] = [];
  setGrassClear(list: readonly (readonly [number, number, number, number])[]): void {
    this.grassClear = [...list];
  }
  /** След лежавшего в траве: есть ли он у рендера и насколько примята трава. */
  grassBody: { caps: number; press: number } | null = null;
  setGrassBody(caps: readonly (readonly number[])[] | null, _floor = 0, press = 0): void {
    this.grassBody = caps ? { caps: caps.length, press } : null;
  }
  /** Трава тянется к свету: карта поля, откуда свет, сила и сколько раз карта менялась. */
  grassLean: { map: unknown; from: number[] | null; strength: number } = { map: null, from: null, strength: 0 };
  grassLeanChanges = 0;
  setGrassLean(map: unknown, from: readonly number[] | null, strength: number, changed: boolean): void {
    this.grassLean = { map, from: from ? [...from] : null, strength };
    if (changed) this.grassLeanChanges += 1;
  }
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
    opts: { calm?: boolean; seed?: number; known?: ReadonlySet<string>; cfg?: typeof QUICK; light?: Partial<FlashlightConfig>; stage?: number; piece?: boolean } = {},
  ) {
    this.game = new Game(this.r as unknown as GameRenderer, mulberry32(opts.seed ?? 7), opts.light ?? {});
    this.game.calm = opts.calm ?? true;
    this.game.stage = opts.stage ?? STAGE_ALL;
    this.game.sessionCfg = opts.cfg ?? QUICK;
    this.game.loadLevel(level, { seed: opts.seed ?? 7, known: opts.known ?? new Set(), ...(opts.piece ? { piece: true } : {}) });
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
        // Встать можно только туда, где есть пол: за стеной уровня игрок падает.
        if (g.colliders.raycast(x + Math.cos(a) * r, floor + 1, z + Math.sin(a) * r, 0, -1, 0, 1.6) >= 1.6) continue;
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

/** Лежит ли точка на предмете — как в игре (Game.restsOn): над ним и в его границах. */
const restsOn = (p: readonly number[], o: LevelObject): boolean =>
  p[0]! > o.min[0] - 0.05 && p[0]! < o.max[0] + 0.05 && p[2]! > o.min[2] - 0.05 && p[2]! < o.max[2] + 0.05 && p[1]! > o.min[1] + 0.12 && p[1]! < o.max[1] + 0.15;

/** Вспышка — и вещь воспоминания переложена на место sp (сессия тоже считает, что она там); ждём, пока соберётся. */
function placeMemory(h: Harness, sp: ItemSpot): Thing {
  h.reveal();
  const t = h.game.things.list.find((x) => x.memory)!;
  h.game.session!.active!.spot = sp;
  t.pos = [sp.x, sp.y, sp.z];
  expect(h.until(() => t.state === 'idle', 3), 'вещь не собралась').toBe(true);
  return t;
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
    // Вещи места идут цепочкой, и каждый круг рассказывает одно и то же (story.md, §7а): следующая сессия
    // в том же месте — те же пять вещей в том же порядке, только место стёрто сильнее.
    expect(second.memories.map((m) => m.def.id)).toEqual(ids);
    // И она начинается сама: ещё через секунду-другую приходит первая вспышка.
    expect(h.until(() => second.active !== null, 5)).toBe(true);
    // Архив пережил смену сессий.
    expect(g.archive).toEqual(ids);
    expect(h.r.pocketShown).toBe(false);
  });

  it('сон из сцен: вспомнил вещь сцены — свет гаснет, и вокруг другое место со своей вещью цепочки; сцен больше нет — лимбо', () => {
    // Прототип (pressure.md, §4.6): в сцене одна вещь; следующую сцену приложение собирает заранее.
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    g.queueScene(office, { seed: 11, known: new Set(), chainAt: 2 });
    expect(g.sceneQueued).toBe(true);
    const first = g.session!;
    expect(first.memories.length).toBe(1);
    expect(h.until(() => first.active !== null, 4)).toBe(true);
    expect(h.standBefore(g.things.list.find((x) => x.memory)!.id)).toBe(true);
    expect(h.until(() => h.count('recall') > 0, 4)).toBe(true);
    expect(h.count('all-done')).toBe(1);
    // Не лимбо, а темнота — и другое место.
    expect(h.until(() => h.dreamCount('begin') > 0, 10)).toBe(true);
    expect(h.log.dream.filter((e) => e.type === 'begin')).toEqual([{ type: 'begin', scene: true, recalled: true }]);
    expect(h.log.dream.some((e) => e.type === 'jump' && e.phase === 'start' && e.plan.cause === 'end' && e.plan.style === 'blackout' && e.plan.to === 'scene')).toBe(true);
    expect(h.dreamCount('limbo')).toBe(0);
    expect(g.where).toBe('main');
    expect(g.level).toBe(office);
    expect(g.world).toBe('office');
    expect(g.sceneQueued).toBe(false);
    // Сцена офиса начинается с той вещи его цепочки, до которой дошли прошлые сцены (третьей).
    const second = g.session!;
    expect(second).not.toBe(first);
    expect(second.memories.map((m) => m.def.id)).toEqual([OFFICE_CHAIN[2]!.id]);
    // Следующей сцены нет — после неё лимбо.
    expect(h.until(() => second.active !== null, 4)).toBe(true);
    expect(h.standBefore(g.things.list.find((x) => x.memory)!.id)).toBe(true);
    expect(h.until(() => h.count('recall') > 1, 4)).toBe(true);
    expect(h.until(() => g.where === 'limbo', 10)).toBe(true);
    expect(h.dreamCount('begin')).toBe(1);
  });

  it('сцена — кусок места: помнится 3–6 комнат вокруг начала; вещь сцены — только в куске; рендеру отдана маска (квиз 17.11)', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 }, piece: true });
    const g = h.game;
    const p = g.piece!;
    expect(p).not.toBeNull();
    expect(p.count).toBeGreaterThanOrEqual(1);
    expect(p.count).toBeLessThanOrEqual(PIECE_MAX_ROOMS);
    expect(p.nodes.has(g.playerNodeAtSpawn())).toBe(true);
    expect(p.nodes.size).toBeLessThan(g.level!.nav.length);
    expect(h.r.piece).not.toBeNull();
    // Маска: клетка начала помнится, клетка за краем — нет.
    const m = h.r.piece!;
    const texel = (id: number): number[] => {
      const n = g.level!.nav[id]!;
      // Клетка cx — индекс cx + offX − 8 (pieceMask: i = cx − minX + 1, offX = 9 − minX).
      const k = ((n.tier * m.h + (n.cz + m.offZ - 8)) * m.w + (n.cx + m.offX - 8)) * 4;
      return [...m.data.subarray(k, k + 4)];
    };
    expect(Math.max(...texel(g.playerNodeAtSpawn()))).toBeGreaterThan(0);
    const out = g.level!.nav.find((n) => !p.nodes.has(n.id) && n.tier === 0)!;
    expect(texel(out.id)).toEqual([0, 0, 0, 0]);
    // Вещь сцены появляется в куске.
    const s = g.session!;
    s.rush();
    expect(h.until(() => s.active !== null, 3)).toBe(true);
    const spot = s.active!.spot!;
    const at = g.level!.nav.reduce((best, n) => (n.tier === spot.tier && Math.hypot(n.x - spot.x, n.z - spot.z) < Math.hypot(g.level!.nav[best]!.x - spot.x, g.level!.nav[best]!.z - spot.z) ? n.id : best), p.edge[0]!);
    expect(p.nodes.has(at)).toBe(true);
    // Кадр знает, что маска действует, пока игрок на месте.
    expect(h.r.frames.at(-1)!.piece).toBe(true);
    // Осыпь ходит и выходит только там, что помнится: не появляется в забытом и не идёт к игроку через него.
    const sw = g.swarm!;
    expect(sw.allowed).toBe(p.nodes);
    const home = g.playerNodeAtSpawn();
    for (let i = 0; i < 20; i++) {
      const n = sw.nodeAround(home, 2, 30);
      if (n >= 0) expect(p.nodes.has(n)).toBe(true);
    }
    const far = [...p.nodes].find((id) => sw.route(home, id).length > 4)!;
    expect(sw.route(home, far).every((id) => p.nodes.has(id))).toBe(true);
  });

  it('сцена — кусок места: шаг за край памяти обрывает сцену — уносит в следующую (другое место), вещь остаётся ждать в цепочке', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 }, piece: true });
    const g = h.game;
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    g.queueScene(office, { seed: 11, known: new Set(), chainAt: 2, piece: true });
    h.run(2);
    const p = g.piece!;
    // Узел за краем, соседний с краем куска (как будто игрок прошёл в проём).
    const nav = g.level!.nav;
    const edge = p.edge.find((e) => nav[e]!.links.some((l) => !p.nodes.has(l) && nav[l]!.tier === nav[e]!.tier && Math.abs(nav[l]!.y - nav[e]!.y) < 0.2))!;
    const beyond = nav[nav[edge]!.links.find((l) => !p.nodes.has(l) && nav[l]!.tier === nav[edge]!.tier)!]!;
    g.teleport(beyond.x, beyond.y, beyond.z);
    expect(h.until(() => h.log.dream.some((e) => e.type === 'jump' && e.phase === 'start' && e.plan.cause === 'edge'), 1)).toBe(true);
    expect(h.until(() => h.dreamCount('begin') > 0, 4)).toBe(true);
    expect(h.log.dream.filter((e) => e.type === 'begin')).toEqual([{ type: 'begin', scene: true, recalled: false }]);
    expect(g.level).toBe(office);
    // В новой сцене — свой кусок, вокруг её начала.
    expect(g.piece).not.toBeNull();
    expect(g.piece!.nodes.has(g.playerNodeAtSpawn())).toBe(true);
  });

  it('сцена — кусок места: следующей сцены нет — шаг за край возвращает в кусок; у края, глядя в обрыв, — событие edge, раз', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 }, piece: true });
    const g = h.game;
    h.run(2);
    const p = g.piece!;
    const nav = g.level!.nav;
    const edge = p.edge.find((e) => nav[e]!.links.some((l) => !p.nodes.has(l) && nav[l]!.tier === nav[e]!.tier && Math.abs(nav[l]!.y - nav[e]!.y) < 0.2))!;
    const e = nav[edge]!;
    const beyond = nav[e.links.find((l) => !p.nodes.has(l) && nav[l]!.tier === e.tier)!]!;
    // Встать на краю лицом к обрыву.
    g.teleport(e.x, e.y, e.z);
    g.aimAt(beyond.x, beyond.y + 1.2, beyond.z);
    h.run(0.3);
    expect(h.log.dream.filter((x) => x.type === 'edge')).toHaveLength(1);
    h.run(0.5);
    expect(h.log.dream.filter((x) => x.type === 'edge')).toHaveLength(1);
    g.teleport(beyond.x, beyond.y, beyond.z);
    expect(h.until(() => h.log.dream.some((x) => x.type === 'jump' && x.phase === 'start' && x.plan.cause === 'edge'), 1)).toBe(true);
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    expect(g.where).toBe('main');
    expect(g.level).toBe(levelOf(SEED));
    expect(p.nodes.has(g.playerNode())).toBe(true);
  });

  it('без куска (первый сон, проверки) и в зале ожидания помнится всё место', () => {
    const whole = new Harness(levelOf(SEED), { seed: 3 });
    expect(whole.game.piece).toBeNull();
    expect(whole.r.piece).toBeNull();
    whole.run(0.2);
    expect(whole.r.frames.at(-1)!.piece).toBe(false);
    const station = new Harness(buildLevel(generateLayout(SEED, 1, 'station'), { wear: 0 }), { seed: 3, piece: true });
    expect(station.game.piece).toBeNull();
  });

  it('сон из сцен: скачок «куда-нибудь» уносит в другое место — вещь сцены остаётся невспомненной, новая сцена начинается посреди места', () => {
    // Слова партнёра 16.11: «перемешивать пространства при каждом скачке» (pressure.md, §4.7).
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    g.queueScene(office, { seed: 11, known: new Set(), chainAt: 2 });
    const first = g.session!;
    // Немного стёртости в оставленной сцене: приложение запишет её в память убежища. Сперва место собирается вокруг (1,6 с).
    h.run(2);
    g.wearGain = 0.03;
    expect(g.beginJump({ cause: 'light', style: 'cut', to: 'elsewhere' }, [])).toBe(true);
    expect(h.until(() => h.dreamCount('begin') > 0, 4)).toBe(true);
    expect(h.log.dream.filter((e) => e.type === 'begin')).toEqual([{ type: 'begin', scene: true, recalled: false }]);
    // Событие скачка говорит, куда на самом деле унесло: в сцену, а не в другую точку того же места.
    expect(h.log.dream.some((e) => e.type === 'jump' && e.phase === 'switch' && e.plan.cause === 'light' && e.plan.to === 'scene')).toBe(true);
    expect(g.level).toBe(office);
    expect(g.world).toBe('office');
    expect(g.leftGain).toBeCloseTo(0.03, 5);
    expect(g.wearGain).toBe(0);
    expect(first.doneCount).toBe(0);
    expect(g.session).not.toBe(first);
    // Не у входа: сон уронил посреди плана — и туда же разбудит Осыпь.
    const at = g.snapshot() as { pos: Vec3 };
    expect(Math.hypot(at.pos[0] - office.spawn.pos[0], at.pos[2] - office.spawn.pos[2])).toBeGreaterThan(3);
    expect(g.playerNode()).toBeGreaterThanOrEqual(0);
    expect(g.playerNodeAtSpawn()).toBe(g.playerNode());
  });

  it('сон из сцен: часы Осыпи идут через сцены — вышедшая на охоту Осыпь выходит и в новом месте (противоречие 218)', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 }, calm: false });
    const g = h.game;
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    g.queueScene(office, { seed: 11, known: new Set(), chainAt: 0 });
    h.run(2);
    // Спуститься на самый нижний ярус: на полной ступени Осыпь выходит по глубине, не дожидаясь часов.
    const bottom = Math.max(...g.level!.nav.map((n) => n.tier));
    const deep = g.level!.nav.find((n) => n.tier === bottom && n.links.length > 1 && n.links.every((l) => Math.abs(g.level!.nav[l]!.y - n.y) < 0.2));
    expect(deep).toBeDefined();
    g.teleport(deep!.x, deep!.y, deep!.z);
    expect(h.until(() => (g.snapshot() as { director: { released: boolean } }).director.released, 6)).toBe(true);
    const before = (g.snapshot() as { director: { clock: number } }).director.clock;
    expect(g.beginJump({ cause: 'light', style: 'cut', to: 'elsewhere' }, [])).toBe(true);
    expect(h.until(() => h.dreamCount('begin') > 0, 4)).toBe(true);
    expect(g.level).toBe(office);
    const after = g.snapshot() as { director: { phase: number; released: boolean; clock: number }; swarm: { mode: string } };
    // Режиссёр тот же: охота уже была, часы сна не обнулились.
    expect(after.director.released).toBe(true);
    expect(after.director.phase).toBe(2);
    expect(after.director.clock).toBeGreaterThanOrEqual(before);
    // В новом месте Осыпь выходит не сразу, а через полминуты — и выходит.
    expect(g.swarm!.active).toBe(false);
    expect(h.until(() => g.swarm!.active, 30)).toBe(true);
  });

  it('поиск в темноте не уносит: пока искомая вещь видна сквозь стены, ни стояние в темноте, ни зажжённый свет скачка не дают', () => {
    // Подсказка игры: «без света то, что вы ищете, проступает сквозь стены». Во сне из сцен скачок уносит в другое место — и
    // следовать подсказке значило бы терять вещь (куратор, пачка 39).
    const setup = (late = false): Harness => {
      // late — искомая вещь не приходит вовсе (для сравнения: та же темнота без вещи).
      const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1, ...(late ? { firstDelay: 999, fallback: 999 } : {}) }, calm: false });
      h.run(2);
      // Скачок наверняка: сразу, по каждому зажжённому свету и через секунду темноты.
      h.game.jumps = new Jumps(mulberry32(5), { ...DEFAULT_JUMPS, firstAfter: 0, lightChance: 1, darkIdle: 1 });
      return h;
    };
    const darkThenLight = (h: Harness): void => {
      h.tick({ ...emptyInput(), light: true });
      h.run(2.5);
      h.tick({ ...emptyInput(), light: true });
      h.run(0.5);
    };
    // Без искомой вещи та же темнота уносит.
    const plain = setup(true);
    darkThenLight(plain);
    expect(plain.game.session!.active).toBeNull();
    expect(plain.dreamCount('jump', 'start')).toBeGreaterThan(0);
    // С искомой вещью рядом (сквозь стены видна) — нет.
    const h = setup();
    const g = h.game;
    const { id } = h.reveal();
    const t = g.things.list.find((x) => x.id === id)!;
    const nav = g.level!.nav;
    // Вещь парит над полом (до 1,05 м), узел пути — на полу: ищем узел того же яруса.
    const near = nav.filter((n) => Math.abs(n.y - t.pos[1]) < 2 && Math.hypot(n.x - t.pos[0], n.z - t.pos[2]) > 4 && Math.hypot(n.x - t.pos[0], n.z - t.pos[2]) < 12)[0]!;
    g.teleport(near.x, near.y, near.z);
    // Смотреть от вещи: её собственный свет не должен считаться светом.
    g.aimAt(near.x - (t.pos[0] - near.x), near.y + 1.5, near.z - (t.pos[2] - near.z));
    h.run(0.3);
    darkThenLight(h);
    expect(h.dreamCount('jump', 'start')).toBe(0);
    expect(g.light.state).toBe('on');
  });

  it('сон из сцен: проём, который обещал «назад», и Осыпь, которая будит в начале, места не меняют', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    const shelter = g.level;
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    g.queueScene(office, { seed: 11, known: new Set(), chainAt: 0 });
    h.run(2);
    expect(g.beginJump({ cause: 'faint', style: 'blackout', to: 'elsewhere', dest: 'start' }, [])).toBe(true);
    h.run(2.5);
    expect(g.level).toBe(shelter);
    expect(g.sceneQueued).toBe(true);
    expect(g.beginJump({ cause: 'gaze', style: 'cut', to: 'void' }, [])).toBe(true);
    expect(h.until(() => g.where === 'pocket', 3)).toBe(true);
    h.run(1);
    expect(g.beginJump({ cause: 'return', style: 'whiteout', to: 'elsewhere', dest: 'back' }, [])).toBe(true);
    expect(h.until(() => g.where === 'main' && !g.jumping, 4)).toBe(true);
    expect(g.level).toBe(shelter);
    expect(h.dreamCount('begin')).toBe(0);
    // А карман, отпустивший сам (без обещания), уносит в другое место.
    expect(g.beginJump({ cause: 'gaze', style: 'cut', to: 'meadow' }, [])).toBe(true);
    expect(h.until(() => g.where === 'pocket', 3)).toBe(true);
    h.run(1);
    expect(g.beginJump({ cause: 'return', style: 'dissolve', to: 'elsewhere' }, [])).toBe(true);
    expect(h.until(() => h.dreamCount('begin') > 0, 4)).toBe(true);
    expect(g.level).toBe(office);
    expect(g.where).toBe('main');
  });

  it('вошёл в оранжерею — объектив запотел и расчистился за несколько секунд; на пороге туда-обратно не потеет снова (MIST)', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    h.run(2);
    const green = g.level!.greenRoom;
    expect(green, 'в убежище есть оранжерея').toBeDefined();
    const mist = (): number => g.snapshot().mist as number;
    expect(mist()).toBe(0);
    const inside = g.level!.nav.find((q) => q.room === green)!;
    const outside = g.level!.nav.find((q) => q.room >= 0 && q.room !== green && Math.hypot(q.x - inside.x, q.z - inside.z) > 6)!;
    const go = (n: { x: number; y: number; z: number }): void => g.teleport(n.x, n.y, n.z, 0, 0);
    go(inside);
    h.run(0.2);
    expect(mist(), 'вошёл — запотел').toBeGreaterThan(0.9);
    h.run(MIST.clear);
    expect(mist(), 'расчистился').toBe(0);
    go(outside);
    h.run(1);
    go(inside);
    h.run(0.2);
    expect(mist(), 'вышел на миг и вернулся — сухой').toBe(0);
    go(outside);
    h.run(MIST.away + 0.5);
    go(inside);
    h.run(0.2);
    expect(mist(), 'побыл снаружи — запотел снова').toBeGreaterThan(0.9);
  });

  it('вернувшись из кармана в клетку, где лежит вещь, игрок встаёт рядом, а не в неё: вещь не растворяется (CI, «после двери луга»)', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    // Место собирается вокруг игрока 1,6 с — пока идёт этот переход, скачок не начинается.
    h.run(2);
    const id = g.playerNode();
    const n = g.level!.nav[id]!;
    // Игрок — в той же клетке, но в 1,2 м от её середины (клетка 3 м): вещь в середине он не задевает.
    const side = ([[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]] as const).find(([dx, dz]) => {
      g.teleport(n.x + dx, n.y, n.z + dz, 0, 0);
      h.run(0.1);
      return g.playerNode() === id && Math.hypot(g.body.x - n.x, g.body.z - n.z) > 1;
    });
    expect(side).toBeDefined();
    // Мелкая вещь без преграды — ровно в середине клетки, куда вернёт проём «назад».
    const t = g.addThing('kk_book_set', [n.x, n.y, n.z], 0, 'dust');
    h.run(0.2);
    expect(t.state).toBe('idle');
    expect(t.collider).toBeLessThan(0);
    expect(g.beginJump({ cause: 'gaze', style: 'cut', to: 'void' }, [])).toBe(true);
    expect(h.until(() => g.where === 'pocket', 3)).toBe(true);
    h.run(1);
    expect(g.beginJump({ cause: 'return', style: 'whiteout', to: 'elsewhere', dest: 'back' }, [])).toBe(true);
    expect(h.until(() => g.where === 'main' && !g.jumping, 4)).toBe(true);
    h.run(0.5);
    expect(g.playerNode()).toBe(id);
    expect(t.state, JSON.stringify(t.why ?? null)).toBe('idle');
    expect(Math.hypot(g.body.x - t.pos[0], g.body.z - t.pos[2])).toBeGreaterThan(0.5);
  });

  it('свет памяти: искомая вещь приносит свой свет, он разгорается у неё; вспомнил — гаснет вместе с вещью', () => {
    // Офис со второй вещи цепочки: кресло у начальника — свет окна (world/memory_light.ts).
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    g.loadLevel(office, { seed: 11, known: new Set(), chainAt: 1 });
    expect(g.session!.memories.map((m) => m.def.thing)).toEqual(['office_chair']);
    expect(h.until(() => g.session!.active !== null, 4)).toBe(true);
    const t = g.things.list.find((x) => x.memory)!;
    // Свет разгорается не сразу, а у самой вещи.
    expect(h.until(() => (h.r.memLight?.strength ?? 0) > MEMORY_LIGHT.office_chair!.strength * 0.95, 4)).toBe(true);
    expect(h.r.memLight!.kind).toBe(MEM_LIGHT_KIND.window);
    expect(h.r.memLight!.pos).toEqual([...t.pos]);
    // Издалека свет ровный; подошёл к вещи — она подсвечивается сильнее (партнёр 24.11).
    const far = h.r.memLight!.strength;
    expect(g.memNearK).toBeLessThan(0.05);
    expect(h.standBefore(t.id)).toBe(true);
    // Проба встаёт в шести метрах от вещи: подсветка уже заметна, в полную силу — с двух с половиной.
    h.run(0.8);
    expect(g.memNearK).toBeGreaterThan(0.3);
    expect(h.r.memLight!.strength).toBeGreaterThan(far * 1.3);
    // Вспомнил — свет уходит вместе с вещью, не мгновенно, но за пару секунд.
    expect(h.until(() => h.count('recall') > 0, 4)).toBe(true);
    expect(h.until(() => h.r.memLight === null, 3)).toBe(true);
  });

  it('свет памяти живёт во времени: у пульта мерцает экран, которого нет, — но не гаснет', () => {
    // Убежище с третьей вещи цепочки: пульт, свет — мерцание телевизора (mod 'tv').
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 1 } });
    const g = h.game;
    g.loadLevel(levelOf(SEED), { seed: 3, known: new Set(), chainAt: 2 });
    expect(g.session!.memories[0]!.def.thing).toBe('remote');
    expect(h.until(() => g.session!.active !== null, 4)).toBe(true);
    // Разгорелся (MEM_LIGHT_FADE.in) — дальше сила меняется от кадра к кадру в пределах жизни света.
    h.run(2);
    const seen = new Set<string>();
    for (let i = 0; i < Math.round(2 / STEP); i++) {
      h.tick();
      const s = h.r.memLight?.strength ?? 0;
      expect(s).toBeGreaterThan(MEMORY_LIGHT.remote!.strength * 0.3);
      expect(s).toBeLessThanOrEqual(MEMORY_LIGHT.remote!.strength + 1e-9);
      seen.add(s.toFixed(3));
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('принудительный отказ фонаря — один на игру: в следующей сессии или сцене его нет', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, light: { firstFailAt: 1, meanFailInterval: 1e9 } });
    const g = h.game;
    expect(h.until(() => g.light.state === 'dead', 4)).toBe(true);
    expect(g.light.taught).toBe(true);
    // Новая сессия (или сцена сна): фонарь новый, а научили уже — второго принудительного отказа нет.
    g.loadLevel(levelOf(SEED), { seed: 4, known: new Set() });
    let died = false;
    for (let i = 0; i < Math.round(4 / STEP); i++) {
      h.tick();
      if (g.light.state === 'dead') died = true;
    }
    expect(died).toBe(false);
  });

  it('сон из сцен: цепочка места начинается с заданной вещи и замыкается по кругу', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, count: 3 } });
    const office = buildLevel(generateLayout(SEED + 5, 1, 'office'), { wear: 0 });
    h.game.loadLevel(office, { seed: 5, known: new Set(), chainAt: 4 });
    expect(h.game.session!.memories.map((m) => m.def.id)).toEqual([OFFICE_CHAIN[4]!.id, OFFICE_CHAIN[0]!.id, OFFICE_CHAIN[1]!.id]);
    h.game.loadLevel(office, { seed: 5, known: new Set(), chainAt: 7 });
    expect(h.game.session!.memories[0]!.def.id).toBe(OFFICE_CHAIN[2]!.id);
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

describe('игра целиком: провал, газ и Осыпь не кончают сессию', () => {
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

  it('Осыпь возвращает в начало: затемнение, игрок снова там, где вылазка началась; сессия идёт дальше', () => {
    const { h, memoryId } = caught(6);
    const g = h.game;
    // Вещь не «забывается»: она остаётся, где была, — идти за ней придётся заново.
    expect(h.count('forgot')).toBe(0);
    expect(g.transition?.plan).toEqual({ cause: 'caught', style: 'blackout', to: 'elsewhere', dest: 'start' });
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    expect(g.where).toBe('main');
    expect(g.session!.over).toBe(false);
    expect(g.session!.active?.def.id).toBe(memoryId);
    const spawn = levelOf(SEED).spawn;
    const b = g.body;
    expect(Math.hypot(b.x - spawn.pos[0], b.z - spawn.pos[2])).toBeLessThan(0.3);
    expect(Math.abs(b.y - spawn.pos[1])).toBeLessThan(0.3);
    expect(h.count('all-done')).toBe(0);
    expect(h.dreamCount('limbo')).toBe(0);
    expect(h.dreamCount('jump', 'start')).toBe(1);
    expect(h.dreamCount('jump', 'switch')).toBe(1);
  });

  it('Осыпь возвращает в начало: искомая вещь остаётся на месте, и её можно дойти и вспомнить', () => {
    const { h, id, was } = caught(6);
    const g = h.game;
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    const spot = g.session!.active!.spot!;
    const now = g.things.list.find((t) => t.id === id)!;
    expect(now.pos).toEqual(was);
    expect(now.pos).toEqual([spot.x, spot.y, spot.z]);
    expect(h.standBefore(id)).toBe(true);
    expect(h.until(() => h.count('recall') > 0, 5)).toBe(true);
  });

  it('поймав, Осыпь затихает (потом — на 20 с) и выходит снова далеко от игрока, не зная, где он', () => {
    // Слова партнёра 16.11 23:41: «Монстр сильно часто нападает в первой сессии». Раньше она выходила
    // снова сразу и ловила игрока, едва тот отходил от начала.
    const near = caught(6);
    const g = near.h.game;
    expect(near.h.until(() => g.transition === null, 4)).toBe(true);
    const sw = g.swarm!;
    expect(sw.active).toBe(false);
    near.h.run(15);
    expect(sw.active).toBe(false);
    expect(near.h.until(() => sw.active, 8)).toBe(true);
    expect(sw.mode).toBe('roam');
    expect(sw.awareness).toBeLessThan(0.2);
    expect(sw.route(sw.node, g.playerNode()).length - 1).toBeGreaterThanOrEqual(7);
  });

  it('первая сессия игрока: поймав, Осыпь молчит минуту', () => {
    // Фонарь не глохнет и случайных скачков нет: в кармане время Осыпи не идёт, а проверяем только её.
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6, light: { meanFailInterval: 1e9 } });
    const g = h.game;
    g.gentle = true;
    g.jumps!.cooldown = 1e9;
    h.run(2);
    h.reveal();
    const sw = g.swarm!;
    const near = sw.nodeAround(g.playerNode(), 3, 4);
    sw.activate(near);
    sw.mode = 'hunt';
    sw.cohesion = 1;
    sw.awareness = 1;
    const b = g.body;
    g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
    expect(h.until(() => h.log.fear.some((e) => e.type === 'swarm' && e.what === 'caught'), 25), 'Осыпь не поймала').toBe(true);
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    h.run(45);
    expect(sw.active).toBe(false);
    expect(h.until(() => sw.active, 20)).toBe(true);
  });

  it('«проснулся» не от Осыпи (провал, край перрона) её не усыпляет и не будит: не выпущенная — так и молчит', () => {
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6, light: { meanFailInterval: 1e9 } });
    const g = h.game;
    g.gentle = true;
    g.loadLevel(levelOf(SEED), { seed: 6, known: new Set() });
    g.jumps!.cooldown = 1e9;
    h.run(2);
    expect(g.beginJump(g.jumps!.forced('caught'), [])).toBe(true);
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    // Режиссёр мягкого режима выпускает её только с пятой минуты; таймер пробуждения не должен её выпустить раньше.
    h.run(75);
    expect(g.swarm!.active).toBe(false);
  });

  it('пока батарейка села и отлёживается, стоять в темноте можно: скачка «темнота» нет', () => {
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6, light: { meanFailInterval: 1e9, drainSeconds: 2 } });
    const g = h.game;
    g.gentle = true;
    g.loadLevel(levelOf(SEED), { seed: 6, known: new Set() });
    g.jumps!.cooldown = 0;
    h.run(4);
    expect(g.light.exhausted).toBe(true);
    h.run(20);
    expect(h.log.dream.some((e) => e.type === 'jump' && e.phase === 'start' && e.plan.cause === 'dark')).toBe(false);
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
    // Вещь переезжает, только когда скачок закрыл кадр, — не в первый миг падения (аудит K-21, 17.11).
    expect(g.things.list.find((t) => t.id === id)!.pos).toEqual(was);
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
      // Вещи воспоминаний: все вспышки сессии (цепочка места — пять вещей, сколько бы ни просили).
      const s = g.session!;
      expect(s.memories.length, `сид ${seed}`).toBeGreaterThanOrEqual(5);
      for (let k = 0; k < s.memories.length; k++) {
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
      // Искомая вещь не приходит: темнота рядом с ней — поиск, а не повод для скачка (поиск в темноте не уносит).
      const h = new Harness(level, { calm, seed: 12, cfg: { ...QUICK, firstDelay: 999, fallback: 999 } });
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
      // Волна сонара — свойство места (вариант A), а не сессии: она идёт и в свободной прогулке.
      expect(ev.dream.filter((e) => e.type !== 'sonar')).toEqual([]);
    }
    expect(game.things.list.length).toBe(0);
  });
});

describe('тихий слой и сонар (вариант A)', () => {
  it('в месте: точки по рёбрам отданы рендеру; волна вскоре после прихода, бежит со своей скоростью, гаснет и приходит снова; в кармане её нет', () => {
    const h = new Harness(levelOf(SEED), { seed: 31 });
    const view = (): ReturnType<FakeRenderer['frames']['at']> => h.r.frames.at(-1);
    expect(h.r.edges).toBeGreaterThan(1000);
    h.run(0.5);
    // Сам тихий слой на первом круге выключен: точечные грани — только на поздних кругах, где стены стёрты (слова
    // партнёра 17.11; отдельный тест ниже). Точки по рёбрам при этом отданы рендеру — по ним бежит волна сонара.
    expect(view()!.quiet ?? 0).toBe(0);
    expect(h.until(() => (view()?.sonar ?? null) !== null, 4)).toBe(true);
    // Пошла волна — событие сна «sonar»: по нему звучит тихий пинг (слова партнёра: «Сонар тихий пинг»).
    const pings = (): number => h.log.dream.filter((e) => e.type === 'sonar').length;
    expect(pings()).toBe(1);
    const a = view()!.sonar!;
    h.run(1);
    const b = view()!.sonar!;
    expect(b[3] - a[3]).toBeCloseTo(SONAR_SPEED, 0);
    expect(b[4]).toBeGreaterThan(0);
    // Волна гаснет к концу пути, следующая приходит не позже чем через SONAR_EVERY[1] с.
    expect(h.until(() => (view()?.sonar ?? null) === null, SONAR_REACH / SONAR_SPEED + 1)).toBe(true);
    expect(h.until(() => (view()?.sonar ?? null) !== null, SONAR_EVERY[1] + 1)).toBe(true);
    // Одна волна — один пинг.
    expect(pings()).toBe(2);
    // Карман — не место: ни тихого слоя, ни волны.
    enter(h, 'meadow');
    h.run(1);
    expect(view()!.quiet).toBe(0);
    expect(view()!.sonar ?? null).toBeNull();
  });
});

describe('игра целиком: рендер получает разумный кадр', () => {
  it('кадры идут с конечными числами; вещи видны в мире, а в лимбо убежище скрыто пространством', () => {
    const h = new Harness(levelOf(SEED), { seed: 14 });
    h.run(2);
    const f = h.r.frames.at(-1)!;
    for (const v of [...f.camPos, f.camYaw, f.camPitch, f.gain, f.fade, f.lightScale]) expect(Number.isFinite(v)).toBe(true);
    // У рендера вещи — это вещи игры и части фигур партнёра (каждая часть растворяется сама).
    const pieces = h.game.figures.list.reduce((n, f) => n + f.pieces.length, 0);
    expect(h.r.things.size).toBe(h.game.things.list.length + pieces);
    expect(h.game.things.list.length).toBeGreaterThan(5);
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
  expect(h.standBefore(t.id), 'перед вещью не встать').toBe(true);
  const before = h.count('recall');
  expect(h.until(() => h.count('recall') > before, 5), 'вещь не вспомнилась').toBe(true);
}

describe('игра целиком: карманные пространства обретают смысл', () => {
  it('в светлом пространстве фонарь сам не глохнет; в темноте убежища — снова может', () => {
    // Передышка 6 с, дальше отказы почти сразу: в белое нигде входим, пока фонарь цел, и стоим там дольше передышки.
    const h = new Harness(levelOf(SEED), { seed: 21, cfg: NOTHING, light: { meanFailInterval: 0.5, graceAfterRevive: 6 } });
    const g = h.game;
    enter(h, 'void');
    expect(g.light.state).toBe('on');
    let died = false;
    for (let i = 0; i < Math.round(20 / STEP); i++) {
      h.tick();
      if (g.light.state === 'dead') died = true;
    }
    expect(died, 'отказ там, где его не видно').toBe(false);
    stepInto(h);
    expect(h.until(() => g.where === 'main' && g.transition === null, 5)).toBe(true);
    expect(h.until(() => g.light.state === 'dead', 5), 'в темноте фонарь снова глохнет').toBe(true);
  });

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

  it('лимбо: выхода нет, болванок нет; вспомненное — экспонаты: под взглядом не растёт, не рассыпается в точки и строку не повторяет', () => {
    const h = new Harness(levelOf(SEED), { seed: 29 });
    // Всё вспомнено: в архиве — пять воспоминаний сессии (debugFinish сам архив не пополняет).
    h.game.archive.push(...h.game.session!.memories.map((m) => m.def.id));
    h.game.debugFinish();
    expect(h.until(() => h.game.where === 'limbo', 8)).toBe(true);
    expect(h.game.pocket!.exit).toBeNull();
    h.run(1);
    expect(info(h).exit).toBeNull();
    expect(info(h).blanks).toEqual([]);
    // Противоречие 109 (ideas.md): вещь памяти проработана сильнее всего — в лимбо её разглядывают.
    const things = h.game.things.list;
    expect(things.length).toBe(5);
    expect(things.every((t) => t.still && !t.memory)).toBe(true);
    const shown = things[0]!;
    expect(h.standBefore(shown.id)).toBe(true);
    // Дольше, чем обычной вещи нужно, чтобы начать расти и вырасти (2,4 + 2,6 с).
    h.run(DEFAULT_THINGS.gazeTime + DEFAULT_THINGS.growTime + 1);
    expect(h.game.where).toBe('limbo');
    expect(shown.gaze).toBeGreaterThan(0.9);
    expect(shown.state).toBe('idle');
    expect(shown.scale).toBe(1);
    expect(Things.dots(shown)).toBe(0);
    expect(pocketEvents(h, 'replay')).toHaveLength(0);
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

  it('дверь луга не ставит игрока на искомую вещь: она цела, и он не в её клетке (нашла проверка CI 17.11)', () => {
    const level = levelOf(SEED);
    const bad: string[] = [];
    let tried = 0;
    for (let seed = 40; seed < 80; seed++) {
      const h = new Harness(level, { seed });
      const g = h.game;
      h.run(1);
      h.reveal();
      // Вещь идущего воспоминания — единственная вещь-цель на уровне (как её ищет и __vz.memory()).
      const thing = g.session!.active ? g.things.list.find((t) => t.memory) : undefined;
      if (!thing) continue;
      enter(h, 'meadow');
      stepInto(h);
      if (!h.until(() => g.where === 'main' && g.transition === null, 9)) continue;
      tried += 1;
      h.run(0.5);
      const d = Math.hypot(thing.pos[0] - g.body.x, thing.pos[2] - g.body.z);
      if (thing.state !== 'idle' || d < 1.2) bad.push(`сид ${seed}: вещь ${thing.state}, до неё ${d.toFixed(2)} м`);
    }
    expect(tried).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('скачок к вещи ставит тело на свободное место: оно не задевает мебель, и стол с искомой вещью цел (CI 17.11, другой уровень)', () => {
    const bad: string[] = [];
    let tried = 0;
    for (const lv of [SEED + 1, SEED + 2, SEED + 3]) {
      const level = levelOf(lv);
      for (let seed = 50; seed < 62; seed++) {
        const h = new Harness(level, { seed });
        const g = h.game;
        h.run(1);
        h.reveal();
        const thing = g.session!.active ? g.things.list.find((t) => t.memory) : undefined;
        if (!thing) continue;
        enter(h, 'meadow');
        stepInto(h);
        if (!h.until(() => g.where === 'main' && g.transition === null, 9)) continue;
        tried += 1;
        const R = DEFAULT_CONTROLLER.radius;
        const b = g.body;
        const hit = g.colliders.boxes.find((x) => !x.off && !x.gone && x.maxY > b.y + 0.08 && x.minY < b.y + DEFAULT_CONTROLLER.height && x.maxX > b.x - R && x.minX < b.x + R && x.maxZ > b.z - R && x.minZ < b.z + R);
        h.run(0.5);
        if (hit || thing.state !== 'idle') bad.push(`уровень ${lv}, сид ${seed}: ${hit ? 'тело в мебели' : ''} вещь ${thing.state}`);
      }
    }
    expect(tried).toBeGreaterThan(15);
    expect(bad).toEqual([]);
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

  /**
   * Встать так, чтобы рядом (ближе 14 м, на том же ярусе; DARK_SHIFT.range) было хотя бы три мелкие вещи. Встаём не «в шаге
   * от вещи» (шаг может прийтись на яму или за стену — тогда герой окажется двумя ярусами ниже, и вещи
   * наверху его уже не касаются), а на ближайший узел проходимой сетки того же яруса: там точно пол.
   */
  function standAmong(h: Harness): ReturnType<typeof smallOf> {
    const all = smallOf(h);
    const nav = h.game.level?.nav ?? [];
    // В опасной зоне стоять нельзя: в газу герой через несколько секунд теряет сознание и оказывается в
    // карманном пространстве — раньше, чем в темноте успеют сдвинуться детали; в яму он падает.
    const unsafe = (x: number, y: number, z: number): boolean => (h.game.level?.zones ?? []).some((g) => g.kind !== 'water' && x > g.minX - 0.5 && x < g.maxX + 0.5 && z > g.minZ - 0.5 && z < g.maxZ + 0.5 && y > g.minY - 0.5 && y < g.maxY + 0.5);
    for (const t of all) {
      // Узел — не дальше 4 м от вещи, а детали в темноте меняются в радиусе 14 м от героя (game.ts, DARK_SHIFT): 10 + 4.
      const near = all.filter((o) => Math.hypot(o.pos[0] - t.pos[0], o.pos[2] - t.pos[2]) < 10 && Math.abs(o.pos[1] - t.pos[1]) < 2);
      if (near.length < 3) continue;
      const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
      // И не на самой вещи: в центре клетки бывает место для вещи на полу, наступил — вещь растворяется и в темноте не меняется.
      const node = nav
        .filter((n) => Math.abs(n.y - floor) < 0.5 && !unsafe(n.x, n.y + 1, n.z) && !all.some((o) => Math.hypot(o.pos[0] - n.x, o.pos[2] - n.z) < 0.9))
        .sort((p, q) => Math.hypot(p.x - t.pos[0], p.z - t.pos[2]) - Math.hypot(q.x - t.pos[0], q.z - t.pos[2]))[0];
      if (!node || Math.hypot(node.x - t.pos[0], node.z - t.pos[2]) > 4) continue;
      h.game.teleport(node.x, node.y, node.z);
      // Проверяются детали места в темноте, а не скачки: стоящего в полной темноте скачок может унести
      // раньше, чем детали сдвинутся (когда именно — решает жребий паузы между скачками). Скачки отложены.
      if (h.game.jumps) h.game.jumps.cooldown = 1e6;
      h.run(0.2);
      // В темноте вещь меняется только вне кадра (K-21): герой отворачивается так, чтобы ни одной из трёх не было видно.
      const hidden = (): boolean => near.every((o) => !h.game.seen([o.pos[0], o.pos[1] + 0.1, o.pos[2]], 0.3));
      let away = hidden();
      for (let k = 0; k < 8 && !away; k++) {
        const a = (k * Math.PI) / 4;
        h.game.aimAt(node.x + Math.cos(a) * 3, node.y + 2.6, node.z + Math.sin(a) * 3);
        h.run(0.1);
        away = hidden();
      }
      if (!away) continue;
      return near;
    }
    throw new Error('на уровне нет трёх мелких вещей рядом');
  }

  /**
   * Игра, где три мелкие вещи лежат рядом, и герой среди них. Где лягут мелкие вещи, решает жребий сессии (вещи берут места
   * по порядку перетасованного списка), а не раскладка мебели: на одном жребии все девять могут оказаться порознь — тогда
   * следующий жребий.
   */
  function amongHarness(): { h: Harness; near: ReturnType<typeof smallOf> } {
    for (let seed = 7; seed < 40; seed++) {
      const h = new Harness(levelOf(SEED), { seed });
      try {
        return { h, near: standAmong(h) };
      } catch {
        continue;
      }
    }
    throw new Error('ни на одном жребии нет трёх мелких вещей рядом');
  }

  it('пока фонарь горит, вещи стоят где стояли', () => {
    const { h, near } = amongHarness();
    const before = places(near);
    const yaws = near.map((t) => t.yaw);
    h.run(12);
    expect(places(near)).toEqual(before);
    expect(near.map((t) => t.yaw)).toEqual(yaws);
    expect(dark(h).shifts).toBe(0);
    expect(dark(h).for).toBe(0);
  });

  it('фонарь выключен: семь секунд всё на месте, потом мелкие вещи меняются местами и поворачиваются', () => {
    const { h, near } = amongHarness();
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
    const { h } = amongHarness();
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
    const { h } = amongHarness();
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

describe('игра целиком: эхо и призрак из-за спины', () => {
  type Pulse = { kind: number; pos: number[]; radius: number; amp: number };
  const echoOf = (h: Harness) => (h.game.snapshot() as { echo: Pulse[] }).echo;
  const walk: InputFrame = { ...emptyInput(), moveZ: 1 };

  it('стоя на месте, игрок волн не пускает; шаг — волна у его ступней, и она уходит в кадр', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    h.run(1.5);
    expect(echoOf(h)).toHaveLength(0);
    expect(h.r.frames.at(-1)!.echo).toBeNull();
    h.run(1.2, walk);
    const steps = echoOf(h).filter((p) => p.kind === 0);
    expect(steps.length).toBeGreaterThan(0);
    // Волна родилась под ногами: не дальше двух шагов от того места, где игрок сейчас, на уровне пола.
    const b = g.body;
    for (const p of steps) {
      expect(Math.hypot(p.pos[0]! - b.x, p.pos[2]! - b.z)).toBeLessThan(3);
      expect(p.pos[1]! - b.y).toBeLessThan(0.2);
    }
    expect(h.r.frames.at(-1)!.echo).not.toBeNull();
    // Шагов живёт не больше трёх разом, сколько бы игрок ни шёл.
    h.run(3, walk);
    expect(echoOf(h).filter((p) => p.kind === 0).length).toBeLessThanOrEqual(3);
  });

  it('бег слышно дальше шага — когда фонарь выключен (при свете эхо молчит)', () => {
    const run = (running: boolean): Harness => {
      const h = new Harness(levelOf(SEED), { seed: 3 });
      // Выключаем фонарь и привыкаем к темноте.
      h.tick({ ...emptyInput(), light: true });
      h.run(2.5);
      h.run(1, { ...walk, run: running });
      return h;
    };
    const amp = (h: Harness) => Math.max(...echoOf(h).map((p) => p.amp));
    const quiet = run(false);
    const loud = run(true);
    expect(amp(quiet)).toBeGreaterThan(0);
    expect(amp(loud)).toBeGreaterThan(amp(quiet));
  });

  it('щелчок фонаря волну не пускает: эхо поднимают только шаги; к темноте оно привыкает', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    h.run(0.5);
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('off');
    // Ни сразу после щелчка, ни за секунду в темноте стоящий игрок волн не получает.
    expect(echoOf(h)).toHaveLength(0);
    h.run(1);
    expect(echoOf(h)).toHaveLength(0);
    expect(h.r.frames.at(-1)!.echo).toBeNull();
    // Пошёл сразу после щелчка — первый же шаг даёт волну, но глаза ещё не привыкли; через пару
    // секунд темноты такой же первый шаг виден заметно сильнее.
    const after = (wait: number): number => {
      const x = new Harness(levelOf(SEED), { seed: 3 });
      x.run(0.5);
      x.tick({ ...emptyInput(), light: true });
      x.run(wait);
      for (let i = 0; i < Math.round(2 / STEP); i++) {
        x.tick({ ...walk });
        const born = echoOf(x);
        if (born.length > 0) return born[0]!.amp;
      }
      return 0;
    };
    const early = after(0);
    const late = after(2.5);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early * 1.5);
  });

  it('эхо — только на ходу: замер в темноте — волны гаснут, и волн Осыпи тоже не видно; пошёл — видно', () => {
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6 });
    const g = h.game;
    h.run(1);
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('off');
    const sw = g.swarm!;
    sw.activate(sw.nodeAround(g.playerNode(), 5, 6));
    const hold = (seconds: number, input?: InputFrame): Pulse[] => {
      const seen: Pulse[] = [];
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        // Она бродит рядом и не охотится: проверяем только, видно ли её волны.
        sw.mode = 'roam';
        sw.cohesion = 0;
        h.tick(input);
        seen.push(...echoOf(h));
      }
      return seen;
    };
    // Стоим в темноте: волны от неё рождаются, но силы у них нет — стоящий слеп.
    hold(2.5);
    const still = hold(4);
    expect(still.filter((p) => p.kind === 1).length).toBeGreaterThan(0);
    expect(still.filter((p) => p.kind === 0)).toHaveLength(0);
    for (const p of still) expect(p.amp).toBeLessThan(0.02);
    const packed = h.r.frames.at(-1)!.echo;
    if (packed) for (let i = 0; i < packed.length; i += 8) expect(packed[i + 4]!).toBeLessThan(0.02);
    // Пошли: её волны проступают — и свои шаги тоже.
    const moving = hold(1.5, walk);
    expect(Math.max(...moving.filter((p) => p.kind === 1).map((p) => p.amp))).toBeGreaterThan(0.2);
    expect(Math.max(...moving.filter((p) => p.kind === 0).map((p) => p.amp))).toBeGreaterThan(0.2);
    // Замерли снова: за две секунды всё гаснет.
    hold(2);
    for (const p of hold(1)) expect(p.amp).toBeLessThan(0.02);
  });

  it('Осыпь слышно: пока она рядом, от неё расходятся волны; охотящуюся — чаще', () => {
    const count = (mode: 'roam' | 'hunt'): number => {
      const h = new Harness(levelOf(SEED), { calm: false, seed: 6 });
      const g = h.game;
      h.run(1);
      const sw = g.swarm!;
      sw.activate(sw.nodeAround(g.playerNode(), 5, 6));
      let born = 0;
      let last = 0;
      for (let i = 0; i < Math.round(6 / STEP); i++) {
        // Режим держим силой: считаем только частоту волн.
        sw.mode = mode;
        sw.cohesion = mode === 'hunt' ? 1 : 0;
        const b = g.body;
        // Спиной к ней, чтобы луч её не проявил.
        g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
        h.tick();
        if (h.log.fear.some((e) => e.type === 'swarm' && e.what === 'caught')) break;
        const drift = echoOf(h).filter((p) => p.kind === 1);
        const youngest = drift.length > 0 ? Math.min(...drift.map((p) => p.radius)) : Infinity;
        if (youngest < last - 1e-6 || (last === Infinity && youngest < Infinity)) born += 1;
        if (drift.length > 0 && born === 0) born = 1;
        last = youngest;
        // Источник волны — она сама.
        for (const p of drift) expect(p.radius).toBeGreaterThanOrEqual(0);
      }
      return born;
    };
    const roam = count('roam');
    const hunt = count('hunt');
    expect(roam).toBeGreaterThanOrEqual(2);
    expect(hunt).toBeGreaterThan(roam);
  });

  it('Осыпь за спиной — впереди проступает её призрак; повернулся к ней — призрака нет', () => {
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6 });
    const g = h.game;
    h.run(1);
    const sw = g.swarm!;
    // Фонарь выключен, чтобы луч её не проявил, пока игрок смотрит на неё. Она стоит на месте (явление).
    h.tick({ ...emptyInput(), light: true });
    sw.appear(sw.nodeAround(g.playerNode(), 2, 3), 30);
    const hold = (face: boolean, seconds: number): void => {
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        const b = g.body;
        if (face) g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        else g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
        h.tick();
      }
    };
    hold(false, 1.5);
    expect(g.ghost).toBeGreaterThan(0.2);
    expect(h.r.frames.at(-1)!.ghost).toBeGreaterThan(0.2);
    hold(true, 1.5);
    expect(g.ghost).toBeLessThan(0.02);
  });

  it('пока Осыпь спит, призрака нет; в карманном пространстве эха нет вовсе', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    h.run(1, walk);
    expect(g.ghost).toBe(0);
    expect(h.r.frames.at(-1)!.echo).not.toBeNull();
    // Переход начала сессии должен закончиться, прежде чем начнётся скачок.
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    expect(g.beginJump({ cause: 'gaze', style: 'cut', to: 'meadow' }, [])).toBe(true);
    expect(h.until(() => g.transition === null && g.where === 'pocket', 4)).toBe(true);
    h.run(1, walk);
    expect(h.r.frames.at(-1)!.echo).toBeNull();
  });
});

describe('игра целиком: Осыпь под лучом и её рост', () => {
  type SwarmState = { mode: string; growth: number; flow: number | null };
  const swarmOf = (h: Harness) => (h.game.snapshot() as { swarm: SwarmState }).swarm;

  /** Осыпь охотится в нескольких клетках, игрок держит на ней луч. true — её проявили (рассыпалась). */
  function expose(h: Harness): boolean {
    const g = h.game;
    const sw = g.swarm!;
    const here = g.playerNode();
    for (const node of nodesInRange(levelOf(SEED).nav, here, 2, 4)) {
      sw.activate(node);
      sw.mode = 'hunt';
      sw.cohesion = 1;
      sw.awareness = 1;
      h.log.fear.length = 0;
      for (let i = 0; i < Math.round(3 / STEP); i++) {
        g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        h.tick();
        if (h.log.fear.some((e) => e.type === 'swarm' && e.what === 'scattered')) return true;
        if (h.log.fear.some((e) => e.type === 'swarm' && e.what === 'caught')) return false;
      }
    }
    return false;
  }

  it('проявленная лучом, она рассыпается и три секунды течёт по пути к искомой вещи', () => {
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6 });
    const g = h.game;
    h.run(2);
    h.reveal();
    const spot = g.session!.active!.spot!;
    expect(expose(h), 'Осыпь не удалось проявить лучом').toBe(true);
    expect(swarmOf(h).mode).toBe('scatter');
    expect(swarmOf(h).flow).not.toBeNull();
    // Тело идёт вдоль пути: за две секунды его середина заметно ближе к искомой вещи (по прямой или по пути —
    // первый отрезок пути всегда приближает к следующему узлу).
    const start = [...h.r.swarm.center];
    const to = (c: number[]) => Math.hypot(c[0]! - spot.x, c[2]! - spot.z);
    h.run(2);
    const moved = Math.hypot(h.r.swarm.center[0] - start[0]!, h.r.swarm.center[2] - start[2]!);
    expect(moved).toBeGreaterThan(3);
    expect(h.r.swarm.alpha).toBeGreaterThan(0.5);
    expect(Number.isFinite(to(h.r.swarm.center))).toBe(true);
    // К концу третьей секунды редеет, потом течение кончается.
    h.run(0.8);
    expect(h.r.swarm.alpha).toBeLessThan(0.5);
    h.run(0.4);
    expect(swarmOf(h).flow).toBeNull();
  });

  it('когда искать нечего, проявленная Осыпь просто рассыпается: течь ей некуда', () => {
    // Первая вспышка воспоминания — нескоро: пока Осыпь проявляют, искать нечего.
    const h = new Harness(levelOf(SEED), { calm: false, seed: 6, cfg: { ...QUICK, firstDelay: 600 } });
    h.run(0.3);
    expect(expose(h), 'Осыпь не удалось проявить лучом').toBe(true);
    expect(h.game.session!.active).toBeNull();
    expect(swarmOf(h).flow).toBeNull();
  });

  it('фигура растёт с каждым вспомненным: четверть роста за воспоминание', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    expect(swarmOf(h).growth).toBe(0);
    for (let k = 1; k <= 2; k++) {
      expect(h.until(() => g.session!.active !== null, 4)).toBe(true);
      const thing = g.things.list.find((x) => x.memory)!;
      expect(h.standBefore(thing.id)).toBe(true);
      const before = h.count('recall');
      expect(h.until(() => h.count('recall') > before, 4)).toBe(true);
      expect(swarmOf(h).growth).toBeCloseTo(k / 4, 6);
    }
  });
});

describe('игра целиком: офис и жёлтые комнаты', () => {
  const office = buildLevel(generateLayout(SEED, 2, 'office'));
  const yellow = buildLevel(generateLayout(SEED, 2, 'yellow'));
  const walk: InputFrame = { ...emptyInput(), moveZ: 1 };

  it('в убежище света по клеткам нет: кадр его не несёт, а рассеянный свет везде один', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    h.run(1);
    expect(h.game.world).toBe('shelter');
    expect(h.game.env).toBe(ENV_BUNKER);
    expect(h.game.cellLights).toBeNull();
    expect(h.r.frames.at(-1)!.cells).toBeNull();
    expect(h.r.frames.at(-1)!.ambientLocal).toBe(1);
  });

  it('офис: окружение офиса, свет панелей идёт в кадр и горит вокруг игрока; вдали темно', () => {
    const h = new Harness(office, { seed: 3 });
    const g = h.game;
    expect(g.world).toBe('office');
    expect(g.env).toBe(ENV_OFFICE);
    h.run(1.5);
    const f = h.r.frames.at(-1)!;
    expect(f.cells).not.toBeNull();
    expect(f.cells!.size).toBe(16);
    expect(f.cells!.data.length).toBe(16 * 16 * 4);
    expect(f.ambientLocal).toBeGreaterThan(0.95);
    expect(f.ambient).toEqual(ENV_OFFICE.ambient);
    // Под игроком светло, в десяти клетках пути — темно.
    const here = g.playerNode();
    expect(g.cellLights!.at(here)).toBeGreaterThan(0.95);
    const far = nodesInRange(office.nav, here, 9, 30);
    expect(far.length).toBeGreaterThan(3);
    for (const id of far) expect(g.cellLights!.at(id)).toBe(0);
    // Чистота офиса: запущенность в кадре отрицательная, а не «по глубине», как в убежище.
    expect(f.decay).toBe(ENV_OFFICE.decay);
  });

  it('офис: свет идёт за игроком — где он прошёл, панели гаснут', () => {
    const h = new Harness(office, { seed: 3 });
    const g = h.game;
    h.run(1);
    const start = g.playerNode();
    h.run(8, walk);
    const now = g.playerNode();
    expect(now).not.toBe(start);
    expect(g.cellLights!.at(now)).toBeGreaterThan(0.9);
    // Ушёл дальше двух клеток пути и прошло больше полутора секунд — у лифта снова темно.
    if (!nodesInRange(office.nav, now, 0, 2).includes(start)) expect(g.cellLights!.at(start)).toBeLessThan(0.05);
  });

  it('офис: фонаря нет — кнопка ничего не меняет, фонарь разобран, а под горящей панелью не «темно»: детали не меняются', () => {
    const h = new Harness(office, { seed: 3 });
    const g = h.game;
    expect(g.hasLight).toBe(false);
    h.run(1);
    h.tick({ ...emptyInput(), light: true });
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('on');
    expect(g.light.suspended).toBe(true);
    expect(g.light.intensity).toBe(0);
    // Щелчка не было — волны от него тоже.
    expect((g.snapshot() as { echo: unknown[] }).echo).toHaveLength(0);
    // Идёт — панели горят, и «темноты» нет: счёт не идёт, деталей никто не меняет.
    h.run(8, walk);
    const snap = g.snapshot() as { dark: { for: number; shifts: number }; hasLight: boolean };
    expect(snap.hasLight).toBe(false);
    expect(snap.dark.for).toBe(0);
    expect(snap.dark.shifts).toBe(0);
    expect(g.where).toBe('main');
  });

  it('офис: Осыпь гасит панели вокруг себя; когда она рядом с игроком, у него темно', () => {
    const h = new Harness(office, { calm: false, seed: 6 });
    const g = h.game;
    h.run(1.5);
    expect(g.ambientLocal).toBeGreaterThan(0.95);
    const sw = g.swarm!;
    // Стоит в соседней клетке (явление: с места не сходит).
    const near = nodesInRange(office.nav, g.playerNode(), 1, 1);
    expect(near.length).toBeGreaterThan(0);
    sw.appear(near[0]!, 30);
    // Спиной к ней, чтобы луч её не проявил.
    for (let i = 0; i < Math.round(1 / STEP); i++) {
      const b = g.body;
      g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
      h.tick();
    }
    expect(g.cellLights!.at(sw.node)).toBeLessThan(0.02);
    expect(g.ambientLocal).toBeLessThan(0.05);
    expect(h.r.frames.at(-1)!.ambientLocal).toBeLessThan(0.05);
  });

  it('офис: вещи воспоминаний — из офисного набора; после карманного пространства окружение снова офисное', () => {
    const h = new Harness(office, { seed: 3 });
    const g = h.game;
    const ids = new Set(OFFICE_CHAIN.map((m) => m.id));
    for (const m of g.session!.memories) expect(ids.has(m.def.id)).toBe(true);
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    expect(g.beginJump({ cause: 'gaze', style: 'cut', to: 'meadow' }, [])).toBe(true);
    expect(h.until(() => g.transition === null && g.where === 'pocket', 4)).toBe(true);
    expect(g.env).not.toBe(ENV_OFFICE);
    expect(h.r.frames.at(-1)!.cells).toBeNull();
    expect(g.beginJump({ cause: 'return', style: 'cut', to: 'elsewhere' }, [])).toBe(true);
    expect(h.until(() => g.transition === null && g.where === 'main', 4)).toBe(true);
    expect(g.env).toBe(ENV_OFFICE);
    h.run(1);
    expect(h.r.frames.at(-1)!.cells).not.toBeNull();
  });

  it('офис: Осыпь возвращает к лифту — туда, где вылазка началась', () => {
    const h = new Harness(office, { calm: false, seed: 6 });
    const g = h.game;
    h.run(2);
    h.run(6, walk);
    const sw = g.swarm!;
    const near = sw.nodeAround(g.playerNode(), 3, 4);
    expect(near).toBeGreaterThanOrEqual(0);
    sw.activate(near);
    sw.mode = 'hunt';
    sw.cohesion = 1;
    sw.awareness = 1;
    const b = g.body;
    g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
    expect(h.until(() => h.log.fear.some((e) => e.type === 'swarm' && e.what === 'caught'), 25), 'Осыпь не поймала').toBe(true);
    expect(h.until(() => g.transition === null, 4)).toBe(true);
    expect(Math.hypot(g.body.x - office.spawn.pos[0], g.body.z - office.spawn.pos[2])).toBeLessThan(0.3);
    expect(g.env).toBe(ENV_OFFICE);
  });

  it('жёлтые комнаты: темно, как в убежище — света по клеткам нет, фонарь есть, поверхности простые; воспоминания — свои', () => {
    const h = new Harness(yellow, { seed: 3 });
    const g = h.game;
    expect(g.world).toBe('yellow');
    expect(g.env).toBe(ENV_YELLOW);
    expect(g.hasLight).toBe(true);
    expect(g.light.suspended).toBe(false);
    expect(g.cellLights).toBeNull();
    h.run(1);
    const f = h.r.frames.at(-1)!;
    expect(f.cells).toBeNull();
    expect(f.ambientLocal).toBe(1);
    expect(f.plain).toBe(true);
    expect((f.ambient[0] + f.ambient[1] + f.ambient[2]) / 3).toBeLessThan(0.01);
    const snap = g.snapshot() as { lights: unknown; hasLight: boolean };
    expect(snap.lights).toBeNull();
    expect(snap.hasLight).toBe(true);
    // Фонарь отзывается на кнопку, как в убежище.
    expect(g.light.state).toBe('on');
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('off');
    const ids = new Set(YELLOW_CHAIN.map((m) => m.id));
    for (const m of g.session!.memories) expect(ids.has(m.def.id)).toBe(true);
  });

  type Jump = Extract<DreamEvent, { type: 'jump' }>;
  const jumps = (h: Harness): Jump[] => h.log.dream.filter((e): e is Jump => e.type === 'jump');
  const screens = (l: BuiltLevel): FlatMark[] => (l.flats ?? []).filter((f) => f.kind === 'screen');
  const isDoor = (f: FlatMark): boolean => f.what === SCREEN_IMAGES[DOOR_IMAGE]!.id;
  /** Объект экрана по его отметке: тот display_*, в чьих габаритах лежит середина картинки. */
  const displayOf = (l: BuiltLevel, f: FlatMark): number =>
    l.objects!.find((o) => o.name.startsWith('display_') && f.at[0] > o.min[0] - 0.2 && f.at[0] < o.max[0] + 0.2 && f.at[2] > o.min[2] - 0.2 && f.at[2] < o.max[2] + 0.2 && f.at[1] > o.min[1] && f.at[1] < o.max[1])!.id;
  /** Встать в полутора метрах перед экраном лицом к нему и идти в него. */
  function walkInto(h: Harness, f: FlatMark, seconds = 2.5): void {
    const g = h.game;
    g.teleport(f.at[0] + f.n[0] * 1.5, f.floor, f.at[2] + f.n[2] * 1.5);
    h.tick();
    g.aimAt(f.at[0], f.floor + 1.4, f.at[2]);
    h.run(seconds, walk);
  }

  it('жёлтые комнаты: дальний экран — проём: вошёл в него — выбеливание и луг; экран при этом рассыпается, как всё, чего коснулись', () => {
    const h = new Harness(yellow, { seed: 3, cfg: NOTHING });
    const g = h.game;
    h.run(0.3);
    const door = screens(yellow).find(isDoor)!;
    expect(door, 'на этаже нет проёма').toBeDefined();
    const id = displayOf(yellow, door);
    expect(yellow.objects!.find((o) => o.id === id)!.name).toBe(DOOR_NAME);
    // Пока в него не вошли, он стоит, и никуда не уносит: просто смотреть на луг можно сколько угодно.
    g.teleport(door.at[0] + door.n[0] * 1.5, door.floor, door.at[2] + door.n[2] * 1.5);
    g.aimAt(door.at[0], door.floor + 1.4, door.at[2]);
    h.run(3);
    expect(jumps(h)).toHaveLength(0);
    expect(g.illusions!.get(id)!.state).toBe('here');
    walkInto(h, door, 1.2);
    expect(jumps(h)[0]?.plan).toMatchObject({ cause: 'door', style: 'whiteout', to: 'meadow' });
    expect(['going', 'gone']).toContain(g.illusions!.get(id)!.state);
    expect(h.until(() => g.where === 'pocket' && g.transition === null, 6), 'на луг не попали').toBe(true);
    expect(g.pocket!.kind).toBe('meadow');
    // Один вход — один скачок: пока идёт переход, второй не начинается.
    expect(jumps(h).filter((e) => e.phase === 'start')).toHaveLength(1);
  });

  it('жёлтые комнаты: с луга возвращает дверная рама — обратно к экрану, которого уже нет; после темноты он встаёт снова проёмом', () => {
    const h = new Harness(yellow, { seed: 3, cfg: NOTHING });
    const g = h.game;
    h.run(0.3);
    const door = screens(yellow).find(isDoor)!;
    const id = displayOf(yellow, door);
    expect(h.until(() => g.transition === null, 5)).toBe(true);
    walkInto(h, door, 1.2);
    expect(h.until(() => g.where === 'pocket' && g.transition === null, 6)).toBe(true);
    stepInto(h);
    expect(h.until(() => g.transition !== null, 3)).toBe(true);
    expect(g.transition!.plan).toMatchObject({ cause: 'return', style: 'whiteout', dest: 'back' });
    expect(h.until(() => g.where === 'main' && g.transition === null, 6)).toBe(true);
    // Вернулись туда, откуда вошли: рядом с местом экрана, а самого экрана нет.
    expect(Math.hypot(g.body.x - door.at[0], g.body.z - door.at[2])).toBeLessThan(4.5);
    expect(g.illusions!.get(id)!.state).toBe('gone');
    expect(jumps(h).filter((e) => e.phase === 'start' && e.plan.cause === 'door')).toHaveLength(1);
    // Отошли, выключили и включили фонарь: экран собирается на прежнем месте и остаётся проёмом.
    g.teleport(door.at[0] + door.n[0] * 3, door.floor, door.at[2] + door.n[2] * 3);
    h.tick({ ...emptyInput(), light: true });
    h.run(1);
    h.tick({ ...emptyInput(), light: true });
    h.run(2.5);
    expect(g.illusions!.get(id)!.state).toBe('here');
    expect(g.illusions!.get(id)!.obj.name).toBe(DOOR_NAME);
    walkInto(h, door, 1.2);
    expect(jumps(h).filter((e) => e.phase === 'start' && e.plan.cause === 'door')).toHaveLength(2);
  });

  it('жёлтые комнаты: вошёл в проём, пока шёл другой переход, — вход не теряется: проём ждёт конца перехода; ушёл из него раньше — не уносит', () => {
    const door = screens(yellow).find(isDoor)!;
    // Первые полторы секунды сессии идёт её собственный переход (begin): второй скачок начаться не может.
    const h = new Harness(yellow, { seed: 3, cfg: NOTHING });
    const g = h.game;
    h.tick();
    expect(g.transition?.plan.cause).toBe('begin');
    walkInto(h, door, 0.8);
    expect(g.transition?.plan.cause, 'переход начала ещё идёт').toBe('begin');
    expect(['going', 'gone']).toContain(g.illusions!.get(displayOf(yellow, door))!.state);
    expect(jumps(h).filter((e) => e.plan.cause === 'door')).toHaveLength(0);
    // Стоим в проёме: переход кончился — уносит.
    expect(h.until(() => jumps(h).some((e) => e.plan.cause === 'door'), 3), 'проём не дождался').toBe(true);
    expect(h.until(() => g.where === 'pocket' && g.transition === null, 6)).toBe(true);
    expect(g.pocket!.kind).toBe('meadow');

    // То же, но из проёма вышли до конца перехода: не вошёл — не унесло.
    const h2 = new Harness(yellow, { seed: 3, cfg: NOTHING });
    const g2 = h2.game;
    h2.tick();
    walkInto(h2, door, 0.8);
    expect(g2.transition?.plan.cause).toBe('begin');
    g2.teleport(door.at[0] + door.n[0] * 4, door.floor, door.at[2] + door.n[2] * 4);
    h2.run(4);
    expect(jumps(h2).filter((e) => e.plan.cause === 'door')).toHaveLength(0);
    expect(g2.where).toBe('main');
  });

  it('жёлтые комнаты: ближний экран — просто экран: вошёл в него — рассыпался, и никуда не унесло', () => {
    const h = new Harness(yellow, { seed: 3, cfg: NOTHING });
    const g = h.game;
    h.run(0.3);
    const plain = screens(yellow).find((f) => !isDoor(f))!;
    expect(plain).toBeDefined();
    const id = displayOf(yellow, plain);
    walkInto(h, plain, 2);
    expect(['going', 'gone']).toContain(g.illusions!.get(id)!.state);
    expect(jumps(h)).toHaveLength(0);
    expect(g.where).toBe('main');
  });

  it('офис: в экран входят так же, как в жёлтых комнатах, но проёма там нет — ни один экран никуда не уносит', () => {
    const h = new Harness(office, { seed: 3, cfg: NOTHING });
    const g = h.game;
    h.run(0.3);
    expect(screens(office).some(isDoor)).toBe(false);
    const f = screens(office)[0]!;
    walkInto(h, f, 2);
    expect(['going', 'gone']).toContain(g.illusions!.get(displayOf(office, f))!.state);
    expect(jumps(h)).toHaveLength(0);
    expect(g.where).toBe('main');
  });

  it('свободная прогулка по жёлтым комнатам (без сессии): проём рассыпается, но скачка нет', () => {
    const r = new FakeRenderer();
    const g = new Game(r as unknown as GameRenderer, mulberry32(7));
    g.loadLevel(yellow);
    const door = screens(yellow).find(isDoor)!;
    const id = displayOf(yellow, door);
    g.teleport(door.at[0] + door.n[0] * 1.5, door.floor, door.at[2] + door.n[2] * 1.5);
    g.step(STEP, emptyInput());
    g.aimAt(door.at[0], door.floor + 1.4, door.at[2]);
    let jumped = false;
    for (let i = 0; i < Math.round(2 / STEP); i++) jumped = g.step(STEP, { ...walk }).dream.some((e) => e.type === 'jump') || jumped;
    expect(['going', 'gone']).toContain(g.illusions!.get(id)!.state);
    expect(jumped).toBe(false);
    expect(g.where).toBe('main');
  });
});

describe('игра целиком: всё иллюзорно', () => {
  type Illu = { gone: number; back: number };
  const illu = (h: Harness): Illu => (h.game.snapshot() as unknown as { illusions: Illu }).illusions;
  const lights = (h: Harness): { lit: number; total: number } | null => (h.game.snapshot() as unknown as { lights: { lit: number; total: number } | null }).lights;
  const stillFor = (h: Harness): number => (h.game.snapshot() as unknown as { stillFor: number }).stillFor;
  const stateOf = (h: Harness, id: number): string => h.game.illusions!.get(id)!.state;
  /** Высота пола под предметом. */
  const floorOf = (o: { at: Vec3 }): number => o.at[1];
  /** Две секунды в «свете и темноте»: щелчок фонаря выкл, пауза, щелчок вкл. */
  function blink(h: Harness, dark = 1): void {
    h.tick({ ...emptyInput(), light: true });
    h.run(dark);
    h.tick({ ...emptyInput(), light: true });
  }

  /**
   * Подойти к предмету с преградой и упереться в него. Возвращает его номер и откуда шли (направление
   * вдоль оси) — или null, если ни к одному подойти не вышло. Подход берётся такой, где на пути и рядом нет других
   * предметов: иначе по дороге растворился бы ещё и сосед (шкафчик у нар — с 18.11 мебель убежища вся из предметов).
   */
  function bump(h: Harness): { id: number; dx: number; dz: number; face: number } | null {
    const g = h.game;
    const l = g.level!;
    const spawn = l.spawn.pos;
    const reach = DEFAULT_CONTROLLER.radius + 0.6;
    const lonely = (id: number, x0: number, z0: number, x1: number, z1: number): boolean =>
      !g.colliders.boxes.some(
        (b) => (b.owner ?? 0) !== 0 && b.owner !== id && !b.ghost && b.maxX > Math.min(x0, x1) - reach && b.minX < Math.max(x0, x1) + reach && b.maxZ > Math.min(z0, z1) - reach && b.minZ < Math.max(z0, z1) + reach,
      );
    const cands = l.objects!
      .filter((o) => o.solid && !o.flat && o.group === undefined && ALL_PROPS[o.name]?.mount === 'floor' && Math.abs(floorOf(o) - spawn[1]) < 0.1)
      .sort((a, b) => Math.hypot(a.at[0] - spawn[0], a.at[2] - spawn[2]) - Math.hypot(b.at[0] - spawn[0], b.at[2] - spawn[2]));
    for (const o of cands) {
      const box = g.colliders.boxes.find((b) => b.owner === o.id && !b.ghost);
      if (!box) continue;
      const cy = box.minX / 2 + box.maxX / 2;
      const cz = box.minZ / 2 + box.maxZ / 2;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        // Подходим с противоположной стороны: идём в направлении (dx, dz), встаём в метре от грани.
        const startX = dx === 0 ? cy : dx > 0 ? box.minX - 1 : box.maxX + 1;
        const startZ = dz === 0 ? cz : dz > 0 ? box.minZ - 1 : box.maxZ + 1;
        const faceX = dx === 0 ? cy : dx > 0 ? box.minX : box.maxX;
        const faceZ = dz === 0 ? cz : dz > 0 ? box.minZ : box.maxZ;
        if (!lonely(o.id, startX, startZ, faceX, faceZ)) continue;
        g.teleport(startX, floorOf(o), startZ);
        h.tick();
        if (stateOf(h, o.id) !== 'here') continue;
        g.aimAt(startX + dx * 5, floorOf(o) + 1.4, startZ + dz * 5);
        for (let i = 0; i < 90 && stateOf(h, o.id) === 'here'; i++) h.tick({ ...emptyInput(), moveZ: 1 });
        if (stateOf(h, o.id) !== 'here') return { id: o.id, dx, dz, face: dx !== 0 ? (dx > 0 ? box.minX : box.maxX) : dz > 0 ? box.minZ : box.maxZ };
      }
    }
    return null;
  }

  it('убежище: игрок упёрся в предмет — тот растворяется до конца, и сквозь него можно пройти', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const hit = bump(h)!;
    expect(hit, 'не вышло упереться ни в один предмет').not.toBeNull();
    const { id, dx, dz, face } = hit;
    expect(['going', 'gone']).toContain(stateOf(h, id));
    expect(illu(h).gone).toBeGreaterThanOrEqual(1);
    expect(h.dreamCount('touch')).toBeGreaterThanOrEqual(1);
    // Пока распад не дошёл до yield, предмет ещё держит: игрок не прошёл.
    const body = g.body;
    expect((body.x - face) * dx + (body.z - face) * dz).toBeLessThan(0);
    // Рендеру приходит растворение: от нуля к единице.
    h.run(1.5);
    expect(stateOf(h, id)).toBe('gone');
    expect(h.r.objects.get(id)).toBe(1);
    // Идём дальше в ту же сторону — теперь он пропускает.
    const dir = { ...emptyInput(), moveZ: 1 };
    g.aimAt(body.x + dx * 5, body.y + 1.4, body.z + dz * 5);
    h.run(1, dir);
    expect((g.body.x - face) * dx + (g.body.z - face) * dz).toBeGreaterThan(0.1);
  });

  it('убежище: при горящем фонаре растворённый предмет не возвращается; выключил и включил — вернулся картонкой, на ступень хуже', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const hit = bump(h)!;
    expect(hit).not.toBeNull();
    const { id } = hit;
    const name = g.level!.objects![id - 1]!.name;
    h.run(1.2);
    expect(stateOf(h, id)).toBe('gone');
    // Отошли от места предмета: он не должен быть заблокирован игроком.
    g.teleport(g.body.x - hit.dx * 3, g.body.y, g.body.z - hit.dz * 3);
    const things = g.things.list.length;
    h.run(5);
    expect(g.light.state).toBe('on');
    expect(stateOf(h, id)).toBe('gone');
    expect(illu(h).back).toBe(0);
    // Выключил, подождал, включил.
    blink(h, 1);
    h.run(0.2);
    // Из сетки помещения предмет ушёл насовсем: вместо него — отдельная вещь, его плоский снимок.
    expect(stateOf(h, id)).toBe('left');
    expect(illu(h).back).toBe(1);
    expect(h.log.dream.find((e) => e.type === 'touch' && e.what === 'back')).toMatchObject({ name, how: 'step', form: 1 });
    expect(g.things.list.length).toBe(things + 1);
    const card = g.things.list[g.things.list.length - 1]!;
    expect(card.kind).toBe(name);
    expect(card.form).toBe(1);
    // Картонка не держит: у неё только датчик касания, и сквозь прежнее место проходят.
    expect(g.colliders.boxes[card.collider]!.ghost).toBe(true);
    expect(g.illusions!.open(id)).toBe(true);
    h.run(1.5);
    expect(card.state).toBe('idle');
    expect(card.dissolve).toBe(0);
  });

  it('убежище: вещь стирается по ступеням — картонка, проекция, кружево — и с последней не возвращается', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const hit = bump(h)!;
    expect(hit).not.toBeNull();
    const name = g.level!.objects![hit.id - 1]!.name;
    h.run(1.2);
    const start: Vec3 = [g.body.x - hit.dx * 3, g.body.y, g.body.z - hit.dz * 3];
    const seen: number[] = [];
    for (const form of [1, 2, 3]) {
      g.teleport(start[0], start[1], start[2]);
      blink(h, 1);
      h.run(1.4);
      const t = g.things.list.find((x) => x.kind === name && x.form === form);
      expect(t, `ступень ${form} не появилась`).toBeDefined();
      seen.push(t!.form);
      expect(t!.state).toBe('idle');
      // Ни одна ступень, кроме настоящей, не держит.
      expect(g.colliders.boxes[t!.collider]!.ghost).toBe(true);
      // Вошли в неё: рассыпается, как всё, чего коснулись.
      g.teleport(t!.pos[0], t!.pos[1], t!.pos[2]);
      h.run(1.3);
      expect(t!.state).toBe('gone');
      expect(t!.touched).toBe(true);
    }
    expect(seen).toEqual([1, 2, 3]);
    // С кружева — в пустоту: вещь стёрта и не вернётся, сколько ни гаси свет.
    g.teleport(start[0], start[1], start[2]);
    blink(h, 1);
    h.run(1.4);
    expect(g.things.list.some((x) => x.kind === name && x.form > 0)).toBe(false);
    expect((illu(h) as Illu & { erased: number }).erased).toBe(1);
    expect(h.log.dream.filter((e) => e.type === 'touch' && e.what === 'erased')).toHaveLength(1);
    const back = illu(h).back;
    blink(h, 1);
    h.run(2);
    expect(illu(h).back).toBe(back);
  });

  it('стёртое место: в начале круга часть предметов — кружево, части нет вовсе; настоящих остаётся по кривой', () => {
    const layout = generateLayout(SEED, 2, 'shelter');
    const fresh = new Harness(buildLevel(layout), { seed: 3, cfg: NOTHING });
    expect(fresh.game.wear).toBe(0);
    expect(fresh.game.illusions!.list.every((i) => i.state === 'here' && (i.form === 0 || i.obj.flat))).toBe(true);
    expect(fresh.r.lace.size).toBe(0);
    for (const wear of [0.42, 0.7]) {
      const h = new Harness(buildLevel(layout, { wear }), { seed: 3, cfg: NOTHING });
      const g = h.game;
      expect(g.wear).toBe(wear);
      const d = g.decay;
      // Бумажные цветы, экраны и гора в счёт не идут: у них своя судьба.
      const list = g.illusions!.list.filter((i) => !i.obj.name.startsWith('paper_flower') && !i.obj.name.startsWith('display_') && i.obj.group === undefined);
      const lace = list.filter((i) => i.form === 3);
      const gone = list.filter((i) => i.form === 4);
      expect(Math.abs(gone.length / list.length - d.gone), `стёртость ${wear}: стёрто`).toBeLessThan(0.12);
      expect(Math.abs((lace.length + gone.length) / list.length - d.lace), `стёртость ${wear}: кружево`).toBeLessThan(0.12);
      for (const i of gone) {
        // Стёртого нет: его не видно, сквозь него проходят, и автомат его больше не решает.
        expect(i.state).toBe('left');
        expect(h.r.objects.get(i.obj.id)).toBe(1);
        expect(g.illusions!.open(i.obj.id)).toBe(true);
        for (const b of g.colliders.boxes.filter((x) => x.owner === i.obj.id)) expect(b.gone).toBe(true);
      }
      for (const i of lace) {
        // Кружево стоит, но не держит: у него только датчик касания.
        expect(i.state).toBe('here');
        expect(h.r.lace.has(i.obj.id)).toBe(true);
        const boxes = g.colliders.boxes.filter((x) => x.owner === i.obj.id);
        expect(boxes.length).toBeGreaterThan(0);
        for (const b of boxes) expect(b.ghost).toBe(true);
      }
      // Архитектура стирается теми же кривыми — рендер получает их в каждом кадре.
      h.run(0.1);
      expect(h.r.erase).toEqual([d.ceiling, d.walls, d.floor]);
    }
  });

  it('кружево из стёртого места: вошёл в него — рассыпалось; свет погас и зажёгся — его больше нет', () => {
    const h = new Harness(buildLevel(generateLayout(SEED, 2, 'shelter'), { wear: 0.55 }), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const spawn = g.level!.spawn.pos;
    const i = g.illusions!.list.filter((x) => x.form === 3 && x.state === 'here' && Math.abs(x.obj.at[1] - spawn[1]) < 0.1 && ALL_PROPS[x.obj.name]?.mount === 'floor').sort((a, b) => Math.hypot(a.obj.at[0] - spawn[0], a.obj.at[2] - spawn[2]) - Math.hypot(b.obj.at[0] - spawn[0], b.obj.at[2] - spawn[2]))[0]!;
    expect(i, 'нет кружевного предмета на ярусе начала').toBeDefined();
    const o = i.obj;
    const before = g.wear;
    g.teleport((o.min[0] + o.max[0]) / 2, o.at[1], (o.min[2] + o.max[2]) / 2);
    h.run(1.3);
    expect(i.state).toBe('gone');
    // Касание стирает место ещё немного.
    expect(g.wear).toBeGreaterThan(before);
    const things = g.things.list.length;
    g.teleport(spawn[0], spawn[1], spawn[2]);
    blink(h, 1);
    h.run(0.5);
    expect(i.state).toBe('left');
    expect(i.form).toBe(4);
    expect(g.things.list.length).toBe(things);
    expect((illu(h) as Illu & { erased: number }).erased).toBe(1);
  });

  it('бумажные цветы: тусклые, пока далеко; при подходе расцветают, рассыпаются — и возвращаются кружевом', () => {
    const h = new Harness(buildLevel(generateLayout(SEED, 2, 'shelter')), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const flowers = g.illusions!.list.filter((i) => i.obj.name.startsWith('paper_flower'));
    expect(flowers.length).toBeGreaterThanOrEqual(2);
    // Все тусклые: выцвели целиком, не светятся.
    for (const f of flowers) expect(h.r.tones.get(f.obj.id)).toEqual([1, 0]);
    // Любой цветок: на полу или подвесной (те висят под высоким потолком сада, к ним подходят снизу).
    const f = flowers.find((x) => x.obj.name !== 'paper_flower_hang') ?? flowers[0]!;
    const o = f.obj;
    const cx = (o.min[0] + o.max[0]) / 2;
    const cz = (o.min[2] + o.max[2]) / 2;
    // Пол яруса, на котором он стоит или над которым висит.
    const floor = Math.floor((o.min[1] + 0.3) / 4.5) * 4.5;
    // Подошли на два с половиной метра (не касаясь), фонарь горит.
    const node = g.level!.nav.filter((n) => Math.abs(n.y - floor) < 0.3).sort((a, b) => Math.abs(Math.hypot(a.x - cx, a.z - cz) - 2.4) - Math.abs(Math.hypot(b.x - cx, b.z - cz) - 2.4))[0]!;
    g.teleport(node.x, node.y, node.z);
    expect(Math.hypot(node.x - cx, node.z - cz)).toBeLessThan(3.4);
    h.run(0.8);
    const mid = h.r.tones.get(o.id)!;
    expect(mid[0]).toBeLessThan(0.8);
    expect(mid[1]).toBeGreaterThan(0.2);
    expect(f.state).toBe('here');
    h.run(1.0);
    // Расцвёл целиком: свой цвет и свет.
    expect(h.r.tones.get(o.id)).toEqual([0, 1]);
    h.run(2.2);
    expect(f.state).toBe('gone');
    expect(h.log.dream.some((e) => e.type === 'touch' && e.what === 'gone' && e.name === o.name)).toBe(true);
    // Остальные цветы, к которым не подходили, всё так же тусклы.
    const far = flowers.find((x) => x !== f && Math.hypot((x.obj.min[0] + x.obj.max[0]) / 2 - node.x, (x.obj.min[2] + x.obj.max[2]) / 2 - node.z) > 6);
    if (far) expect(h.r.tones.get(far.obj.id)).toEqual([1, 0]);
    // «В следующий раз они более тусклые, как кружева»: возвращается кружевом, минуя картонку.
    g.teleport(g.level!.spawn.pos[0], g.level!.spawn.pos[1], g.level!.spawn.pos[2]);
    blink(h, 1);
    h.run(1.5);
    expect(f.state).toBe('left');
    const back = g.things.list.find((t) => t.kind === o.name);
    expect(back).toBeDefined();
    expect(back!.form).toBe(3);
  });

  it('в стёртом месте мелочей меньше; гора у начала растёт с кругами и не растворяется', () => {
    const layout = generateLayout(SEED, 2, 'shelter');
    const small = (wear: number): number => {
      const h = new Harness(buildLevel(layout, { wear }), { seed: 3 });
      return h.game.things.list.filter((t) => !t.memory && t.collider < 0).length;
    };
    expect(small(0)).toBeGreaterThan(small(0.45));
    expect(small(0.45)).toBeGreaterThanOrEqual(small(0.8));
    expect(small(0.8)).toBe(0);
    // Гора — не объект: коснуться её нельзя, она стоит.
    const worn = buildLevel(layout, { wear: 0.5 });
    expect(worn.landmarks.filter((m) => m.id === 'mound')).toHaveLength(1);
    expect(worn.objects!.some((o) => o.name.startsWith('mound'))).toBe(false);
    expect(buildLevel(layout).landmarks.some((m) => m.id === 'mound')).toBe(false);
  });

  it('убежище: вернуться на место, где стоит игрок, предмет не может — он ждёт, пока тот выйдет', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const hit = bump(h)!;
    expect(hit).not.toBeNull();
    h.run(1.2);
    expect(stateOf(h, hit.id)).toBe('gone');
    // Игрок стоит у самого места предмета; фонарь гаснет и зажигается.
    blink(h, 1);
    h.run(2);
    expect(stateOf(h, hit.id)).toBe('gone');
    expect(illu(h).back).toBe(0);
    g.teleport(g.body.x - hit.dx * 4, g.body.y, g.body.z - hit.dz * 4);
    h.run(0.3);
    expect(illu(h).back).toBeGreaterThanOrEqual(1);
  });

  /** Мелкая вещь сна без преграды и не воспоминание, лежащая прямо на полу (не на столе и не в стене). */
  const littleOf = (h: Harness) =>
    h.game.things.list.find((t) => {
      if (t.memory || t.still || t.collider >= 0 || t.state !== 'idle') return false;
      const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
      if (Math.abs(t.pos[1] - floor) > 0.1) return false;
      const inside: Parameters<ColliderSet['query']>[4] = [];
      h.game.colliders.query(t.pos[0] - 0.33, t.pos[2] - 0.33, t.pos[0] + 0.33, t.pos[2] + 0.33, inside);
      // query отдаёт коробки по ячейкам сетки поиска (2 м): ближе 0,33 м — только те, что и правда заходят в квадрат.
      return !inside.some((b) => b.maxY > floor + 0.4 && b.minY < floor + 1.7 && b.minX < t.pos[0] + 0.33 && b.maxX > t.pos[0] - 0.33 && b.minZ < t.pos[2] + 0.33 && b.maxZ > t.pos[2] - 0.33);
    })!;

  it('мелкая вещь сна: наступил — растворилась и помечена touched; фонарь выкл/вкл — собралась заново', () => {
    let h = new Harness(levelOf(SEED), { seed: 3, cfg: NOTHING });
    // Не на каждом уровне есть вещь прямо на полу и не у стены: берём первый, где она нашлась.
    for (const seed of [5, 7, 42, 808]) {
      if (littleOf(h)) break;
      h = new Harness(levelOf(seed), { seed: 3, cfg: NOTHING });
    }
    const g = h.game;
    const t = littleOf(h);
    expect(t, 'на уровнях нет вещи на полу').toBeDefined();
    const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
    g.teleport(t.pos[0], floor, t.pos[2]);
    h.tick();
    h.tick();
    expect(t.state).toBe('changing');
    expect(t.touched).toBe(true);
    expect(h.log.dream.some((e) => e.type === 'touch' && e.what === 'gone' && e.name === t.kind)).toBe(true);
    h.run(DEFAULT_THINGS.touchTime + 0.3);
    expect(t.state).toBe('gone');
    // Свет горит — не возвращается.
    g.teleport(t.pos[0] + 3, floor, t.pos[2]);
    h.run(4);
    expect(t.state).toBe('gone');
    blink(h, 1);
    let seen = false;
    for (let i = 0; i < Math.round(3 / STEP) && !(t.state === 'idle' && !t.touched); i++) {
      h.tick();
      if (t.state === 'coming') seen = true;
    }
    expect(seen, 'вещь не собиралась').toBe(true);
    expect(t.state).toBe('idle');
    expect(t.touched).toBe(false);
    expect(t.dissolve).toBe(0);
    expect(illu(h).back).toBeGreaterThanOrEqual(1);
    // Такая вещь снова растворится от касания.
    g.teleport(t.pos[0], floor, t.pos[2]);
    h.tick();
    h.tick();
    expect(t.state).toBe('changing');
  });

  it('вещь, стоявшая на предмете, растворяется вместе с ним', () => {
    // Вещь на столе есть не на каждом уровне, и не к каждому такому предмету можно подойти (спиной к стене, за ним провал):
    // перебираем пары «предмет и вещь на нём» на нескольких уровнях, пока в предмет не упрёмся — каждая проба в своей игре.
    let found: { h: Harness; id: number; thing: number } | null = null;
    let pairs = 0;
    for (const seed of [5, 8, 15, 19, 22]) {
      const level = buildLevel(generateLayout(seed, 3, 'shelter'));
      const probe = new Harness(level, { seed: 3, cfg: NOTHING });
      const cands: { id: number; thing: number }[] = [];
      for (const t of probe.game.things.list) {
        // Не вещь воспоминания: её и её опору касание не трогает (партнёр 18.11, 16:02).
        if (t.still || t.memory || t.collider >= 0) continue;
        const o = level.objects!.find((q) => q.solid && !q.flat && q.group === undefined && t.pos[0] > q.min[0] - 0.05 && t.pos[0] < q.max[0] + 0.05 && t.pos[2] > q.min[2] - 0.05 && t.pos[2] < q.max[2] + 0.05 && t.pos[1] > q.min[1] + 0.12 && t.pos[1] < q.max[1] + 0.15);
        if (o) cands.push({ id: o.id, thing: t.id });
      }
      pairs += cands.length;
      for (const c of cands) {
        const h = new Harness(level, { seed: 3, cfg: NOTHING });
        if (h.game.things.list.find((x) => x.id === c.thing)?.state !== 'idle') continue;
        if (pushInto(h, c.id) && stateOf(h, c.id) !== 'here') {
          found = { h, ...c };
          break;
        }
      }
      if (found) break;
    }
    expect(pairs, 'на уровнях нет вещи, стоящей на предмете').toBeGreaterThan(0);
    expect(found, 'ни в один предмет с вещью на нём не упёрлись').not.toBeNull();
    if (!found) return;
    const { h, id } = found;
    const t = h.game.things.list.find((x) => x.id === found!.thing)!;
    expect(stateOf(h, id), 'в предмет не упёрлись').not.toBe('here');
    expect(['changing', 'gone']).toContain(t.state);
    expect(t.touched).toBe(true);
    h.run(1.5);
    expect(t.state).toBe('gone');
    expect(stateOf(h, id)).toBe('gone');
  });

  /**
   * Встать вплотную к коробке предмета с той стороны, где можно стоять, и идти на него по полторы секунды. true — тело
   * упёрлось в коробку (касание было), или предмет начал растворяться.
   */
  const pushInto = (h: Harness, id: number): boolean => {
    const g = h.game;
    const o = g.level!.objects![id - 1]!;
    const box = g.colliders.boxes.find((b) => b.owner === id && !b.ghost)!;
    const floor = floorOf(o);
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const R = DEFAULT_CONTROLLER.radius + 0.02;
    const sides: [number, number][] = [
      [box.minX - 0.4, cz],
      [box.maxX + 0.4, cz],
      [cx, box.minZ - 0.4],
      [cx, box.maxZ + 0.4],
    ];
    for (const [sx, sz] of sides) {
      if (g.colliders.raycast(sx, floor + 1, sz, 0, -1, 0, 1.2) >= 1.1) continue;
      const near: Parameters<ColliderSet['query']>[4] = [];
      g.colliders.query(sx - R, sz - R, sx + R, sz + R, near);
      if (near.some((b) => !b.ghost && b.maxY > floor + 0.4 && b.minY < floor + 1.7 && b.minX < sx + R && b.maxX > sx - R && b.minZ < sz + R && b.maxZ > sz - R)) continue;
      g.teleport(sx, floor, sz);
      g.aimAt(cx, floor + 1, cz);
      for (let i = 0; i < 90 && stateOf(h, id) === 'here'; i++) h.tick({ ...emptyInput(), moveZ: 1 });
      if (stateOf(h, id) !== 'here') return true;
      const dx = Math.max(box.minX - g.body.x, 0, g.body.x - box.maxX);
      const dz = Math.max(box.minZ - g.body.z, 0, g.body.z - box.maxZ);
      if (Math.hypot(dx, dz) - DEFAULT_CONTROLLER.radius < 0.05) return true;
    }
    return false;
  };

  it('вещь, которую ищут, касания не замечает: наступил — она на месте; уходит, только когда её вспомнили (партнёр 18.11, 16:02)', () => {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    const { id } = h.reveal();
    const t = g.things.list.find((x) => x.id === id)!;
    expect(h.until(() => t.state === 'idle', 3)).toBe(true);
    const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
    g.teleport(t.pos[0], floor, t.pos[2]);
    h.run(1);
    expect(t.state).toBe('idle');
    expect(t.touched).toBe(false);
    expect(h.log.dream.some((e) => e.type === 'touch' && e.what === 'gone' && e.name === t.kind)).toBe(false);
    // Вспомнил — и вот теперь она рассыпается.
    expect(h.standBefore(id)).toBe(true);
    expect(h.until(() => h.count('recall') > 0, 4)).toBe(true);
    expect(['changing', 'gone']).toContain(t.state);
  });

  it('крупная вещь, которую ищут, держит, как всё настоящее: сквозь неё не пройти; взгляд и свет её преграда пропускает (куратор, 258)', () => {
    // Офис: кулер (выше 0,5 м — крупная вещь; терминал с 24.11 мелочь и парит над столом).
    const office = buildLevel(generateLayout(SEED, 2, 'office'));
    const h = new Harness(office, { seed: 3, cfg: { ...QUICK, delay: 500 } });
    const g = h.game;
    g.loadLevel(office, { seed: 3, known: new Set(), chainAt: OFFICE_CHAIN.findIndex((m) => m.thing === 'water_cooler') });
    const { id } = h.reveal();
    const t = g.things.list.find((x) => x.id === id)!;
    expect(t.kind).toBe('water_cooler');
    expect((ALL_PROPS[t.kind]?.h ?? 0) > 0.5, t.kind).toBe(true);
    expect(t.collider).toBeGreaterThanOrEqual(0);
    const box = g.colliders.boxes[t.collider]!;
    expect(box.ghost).toBeFalsy();
    expect(box.clear).toBe(true);
    expect(box.owner).toBe(-t.id);
    // Луч сквозь её коробку не застревает; та же коробка без метки — остановила бы его у края.
    const cy = (box.minY + box.maxY) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const solo = new ColliderSet();
    solo.add({ ...box });
    expect(solo.raycast(box.minX - 1, cy, cz, 1, 0, 0, 3)).toBe(3);
    const plain = new ColliderSet();
    plain.add({ ...box, clear: false });
    expect(plain.raycast(box.minX - 1, cy, cz, 1, 0, 0, 3)).toBeCloseTo(1, 5);
    // Упёрся — стоит у коробки, а не в ней.
    const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
    const R = DEFAULT_CONTROLLER.radius;
    let pressed = false;
    for (const [sx, sz] of [[box.minX - 0.5, cz], [box.maxX + 0.5, cz], [(box.minX + box.maxX) / 2, box.minZ - 0.5], [(box.minX + box.maxX) / 2, box.maxZ + 0.5]] as [number, number][]) {
      if (g.colliders.raycast(sx, floor + 1, sz, 0, -1, 0, 1.2) >= 1.1) continue;
      const near: Parameters<ColliderSet['query']>[4] = [];
      g.colliders.query(sx - R, sz - R, sx + R, sz + R, near);
      if (near.some((b) => !b.ghost && !b.off && b.maxY > floor + 0.4 && b.minY < floor + 1.7 && b.minX < sx + R && b.maxX > sx - R && b.minZ < sz + R && b.maxZ > sz - R)) continue;
      g.teleport(sx, floor, sz);
      g.aimAt((box.minX + box.maxX) / 2, floor + 0.5, cz);
      h.run(1.5, { ...emptyInput(), moveZ: 1 });
      const dx = Math.max(box.minX - g.body.x, 0, g.body.x - box.maxX);
      const dz = Math.max(box.minZ - g.body.z, 0, g.body.z - box.maxZ);
      const gap = Math.hypot(dx, dz) - R;
      expect(gap, 'тело в коробке вещи').toBeGreaterThan(-0.05);
      if (gap < 0.05) {
        pressed = true;
        break;
      }
    }
    expect(pressed, 'к вещи не подойти ни с одной стороны').toBe(true);
    expect(t.state).toBe('idle');
    // «Забылась» — преграда переехала вместе с ней.
    const ev = g.session!.forget(g.playerNode())!;
    (g as unknown as { applySessionEvent(e: unknown, out: unknown[], dream: unknown[], node: number): void }).applySessionEvent(ev, [], [], g.playerNode());
    expect(box.off).toBe(true);
    const moved = g.colliders.boxes[t.collider]!;
    expect(moved).not.toBe(box);
    expect(moved.clear).toBe(true);
    expect((moved.minX + moved.maxX) / 2).toBeCloseTo(t.pos[0], 5);
    expect((moved.minZ + moved.maxZ) / 2).toBeCloseTo(t.pos[2], 5);
    // Вспомнил — держать нечего.
    expect(h.standBefore(t.id)).toBe(true);
    expect(h.until(() => h.count('recall') > 0, 4)).toBe(true);
    expect(moved.off).toBe(true);
  });

  it('предмет, на котором лежит вещь, которую ищут, держится: упёрся — ни он, ни она не растворились; вспомнил — он снова как всё', () => {
    // Место для вещи на предмете (стол, полка, тумба), к которому можно подойти и вещь на котором видно.
    for (const seed of [SEED, 5, 8, 15, 19, 22]) {
      const level = levelOf(seed);
      for (const sp of level.spots) {
        const o = level.objects!.find((q) => q.solid && !q.flat && q.group === undefined && restsOn([sp.x, sp.y, sp.z], q));
        if (!o || !level.colliders.boxes.some((b) => b.owner === o.id && !b.ghost)) continue;
        // Следующее воспоминание не торопится: после recall новой вещи нет, и опору ничто не держит.
        const h = new Harness(level, { seed: 3, cfg: { ...QUICK, delay: 500 } });
        const g = h.game;
        const t = placeMemory(h, sp);
        if (!pushInto(h, o.id)) continue;
        expect(stateOf(h, o.id), `сид ${seed}: опора вещи растворилась`).toBe('here');
        expect(t.state).toBe('idle');
        expect(t.touched).toBe(false);
        // Вспомнил — запрет снят: упёрся снова — растворился, как всё.
        if (!h.standBefore(t.id)) continue;
        expect(h.until(() => h.count('recall') > 0, 4)).toBe(true);
        h.run(1.5);
        expect(pushInto(h, o.id)).toBe(true);
        expect(h.until(() => stateOf(h, o.id) !== 'here', 1)).toBe(true);
        expect(g.session!.active).toBeNull();
        return;
      }
    }
    throw new Error('на уровнях нет места для вещи на предмете, к которому можно подойти');
  });

  it('место для вещи, которую ищут, не берётся на том, что растворилось или растворяется', () => {
    const h = new Harness(levelOf(SEED), { seed: 3, cfg: NOTHING });
    const g = h.game;
    const level = g.level!;
    const ill = g.illusions!;
    const under = level.objects!.filter((o) => o.group === undefined && level.spots.some((sp) => restsOn([sp.x, sp.y, sp.z], o)));
    expect(under.length).toBeGreaterThan(5);
    // Каждый второй тронут: растворяется сейчас, а через секунду его нет.
    const touched = under.filter((_, i) => i % 2 === 0);
    for (const o of touched) expect(ill.touch(o.id)).toBe(true);
    const on = (sp: ItemSpot): boolean => touched.some((o) => restsOn([sp.x, sp.y, sp.z], o));
    const ranker = (): ((s: ItemSpot) => number) => (g as unknown as { spotRanker(): (s: ItemSpot) => number }).spotRanker();
    for (const rank of [ranker(), (h.run(1.2), ranker())]) {
      for (const sp of level.spots) if (on(sp)) expect(rank(sp)).toBe(Infinity);
      // Целые опоры и пол годятся; «сеточные» помещения — только если других мест нет.
      for (const sp of level.spots) if (!on(sp)) expect(rank(sp)).toBe(g.wireRooms.has(sp.room) ? 1 : 0);
    }
    for (const o of touched) expect(stateOf(h, o.id)).toBe('gone');
    // Сама вспышка: вещь ложится не на растворённое. И когда «забывается» (провал, газ, рой), переезжает тоже не туда —
    // место каждый раз выбирает сессия, и ни разу из сорока не на тронутом.
    const s = g.session!;
    s.rush();
    expect(h.until(() => s.active !== null, 3)).toBe(true);
    const t = g.things.list.find((x) => x.memory)!;
    expect(touched.some((o) => restsOn(t.pos, o))).toBe(false);
    let moves = 0;
    for (let k = 0; k < 40 && s.forget(g.playerNode()); k++) {
      expect(on(s.active!.spot!), `перенос ${k}`).toBe(false);
      moves += 1;
    }
    expect(moves).toBeGreaterThan(10);
  });

  it('где лежит вещь, которую ищут, пол не уходит: в «сеточном» помещении рядом с ней можно стоять', () => {
    let tried = 0;
    for (const seed of [SEED, 101, 202, 303, 404, 505, 606, 707]) {
      const level = levelOf(seed);
      const h = new Harness(level, { seed, calm: false });
      const g = h.game;
      h.until(() => g.transition === null, 8);
      const entry = [...g.wireRooms][0];
      if (!entry) continue;
      const [id, room] = entry;
      const sp = level.spots.find((s) => s.room === id);
      if (!sp) continue;
      placeMemory(h, sp);
      tried += 1;
      g.teleport((room.minX + room.maxX) / 2, room.floorY, (room.minZ + room.maxZ) / 2);
      h.run(WIRE_STILL + 2);
      expect(g.pressure!.active?.room.id === id, `сид ${seed}: пол пошёл там, где лежит вещь`).toBe(false);
    }
    expect(tried).toBeGreaterThanOrEqual(1);
  });

  it('офис: фонаря нет, кнопка ничего не меняет — ни состояния, ни эха', () => {
    const h = new Harness(buildLevel(generateLayout(SEED, 2, 'office')), { seed: 3 });
    const g = h.game;
    expect(g.hasLight).toBe(false);
    h.run(1);
    const before = { state: g.light.state, intensity: g.light.intensity, echo: (g.snapshot() as unknown as { echo: unknown[] }).echo.length };
    h.tick({ ...emptyInput(), light: true });
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe(before.state);
    expect(g.light.intensity).toBe(before.intensity);
    expect(g.light.suspended).toBe(true);
    expect((g.snapshot() as unknown as { echo: unknown[] }).echo.length).toBe(before.echo);
    // Убежище и жёлтые комнаты — с фонарём.
    expect(new Harness(levelOf(SEED)).game.hasLight).toBe(true);
    expect(new Harness(buildLevel(generateLayout(SEED, 2, 'yellow'))).game.hasLight).toBe(true);
  });

  it('офис: игрок замер — через порог датчики его теряют и свет гаснет; пошевелился — горит снова', () => {
    const { sleep, sleepStagger, reach } = DEFAULT_CELL_LIGHTS;
    const h = new Harness(buildLevel(generateLayout(SEED, 2, 'office')), { seed: 3 });
    const g = h.game;
    h.run(1.5);
    expect(lights(h)!.lit).toBeGreaterThan(0);
    expect(g.cellLights!.at(g.playerNode())).toBeGreaterThan(0.95);
    // Стоит: до порога свет держится.
    h.run(sleep - 1.5 - 0.3);
    expect(g.cellLights!.at(g.playerNode())).toBeGreaterThan(0.95);
    expect(stillFor(h)).toBeGreaterThan(sleep - 1);
    // Порог, ещё reach × sleepStagger и запас на затухание — темно везде.
    h.run(0.3 + reach * sleepStagger + 1.2);
    expect(stillFor(h)).toBeGreaterThan(sleep + reach * sleepStagger);
    expect(lights(h)!.lit).toBe(0);
    expect(g.ambientLocal).toBeLessThan(0.05);
    // Пошевелился: повернул голову — счёт неподвижности обнулён, свет вернулся.
    h.run(0.5, { ...emptyInput(), lookYaw: 0.01 });
    expect(stillFor(h)).toBeLessThan(0.1);
    expect(lights(h)!.lit).toBeGreaterThan(0);
    expect(g.cellLights!.at(g.playerNode())).toBeGreaterThan(0.95);
    // И снова замер — снова погасло.
    h.run(sleep + reach * sleepStagger + 1.5);
    expect(lights(h)!.lit).toBe(0);
  });

  it('офис: растворённый предмет возвращается после цикла «замер — погасло — пошевелился — зажглось»', () => {
    const { sleep, sleepStagger, reach } = DEFAULT_CELL_LIGHTS;
    const h = new Harness(buildLevel(generateLayout(SEED, 2, 'office')), { seed: 3 });
    const g = h.game;
    const hit = bump(h);
    expect(hit, 'не вышло упереться ни в один предмет').not.toBeNull();
    const { id } = hit!;
    h.run(1.2);
    expect(stateOf(h, id)).toBe('gone');
    // Свет горит (игрок только что двигался) — предмет ждёт.
    g.teleport(g.body.x - hit!.dx * 2, g.body.y, g.body.z - hit!.dz * 2);
    h.run(1);
    expect(stateOf(h, id)).toBe('gone');
    expect(illu(h).back).toBe(0);
    // Замер: панели гаснут, предмет всё ещё не вернулся — свет на его месте не «зажёгся», а погас.
    h.run(sleep + reach * sleepStagger + 2.5);
    expect(lights(h)!.lit).toBe(0);
    expect(stateOf(h, id)).toBe('gone');
    expect(illu(h).back).toBe(0);
    // Пошевелился — зажглось, и вернулся.
    h.run(0.6, { ...emptyInput(), lookYaw: 0.01 });
    expect(illu(h).back).toBeGreaterThanOrEqual(1);
    h.run(1.5);
    expect(['here', 'left']).toContain(stateOf(h, id));
  });

  it('офис: берёза рассыпается от касания, как всё; после «замер — погасло — пошевелился» встаёт снова — собой и на своём месте', () => {
    const { sleep, sleepStagger, reach } = DEFAULT_CELL_LIGHTS;
    // Берёзы — «знак последних дней»: роща в полную силу стоит в месте, стёртом почти до конца.
    const level = buildLevel(generateLayout(SEED, 2, 'office'), { wear: 0.9 });
    const h = new Harness(level, { seed: 3, cfg: NOTHING });
    const g = h.game;
    h.run(0.3);
    const trees = level.objects!.filter((o) => o.name === 'birch');
    expect(trees.length).toBeGreaterThanOrEqual(5);
    // Сами берёзы стирание не трогает: они не вещь памяти, а то, что прорастает сквозь неё.
    for (const o of trees) expect(g.illusions!.get(o.id)).toMatchObject({ state: 'here', form: 0 });
    // Подойти к первой берёзе, к которой получится: с одной из четырёх сторон, с метра.
    let hit: { id: number; dx: number; dz: number } | null = null;
    for (const o of trees) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        g.teleport(o.at[0] - dx * 1.0, o.at[1], o.at[2] - dz * 1.0);
        h.tick();
        g.aimAt(o.at[0], o.at[1] + 1.4, o.at[2]);
        for (let i = 0; i < 90 && stateOf(h, o.id) === 'here'; i++) h.tick({ ...emptyInput(), moveZ: 1 });
        if (stateOf(h, o.id) !== 'here') {
          hit = { id: o.id, dx, dz };
          break;
        }
      }
      if (hit) break;
    }
    expect(hit, 'не вышло коснуться ни одной берёзы').not.toBeNull();
    const { id, dx, dz } = hit!;
    const tree = trees.find((o) => o.id === id)!;
    h.run(1.2);
    expect(stateOf(h, id)).toBe('gone');
    expect(g.illusions!.open(id), 'сквозь рассыпавшийся ствол проходят').toBe(true);
    const things = g.things.list.length;
    // Отошёл на пару шагов (стволы стоят не ближе двух метров от стен: это ещё отдел); свет горит — ствола нет.
    g.teleport(tree.at[0] - dx * 1.7, tree.at[1], tree.at[2] - dz * 1.7);
    h.run(1);
    expect(stateOf(h, id)).toBe('gone');
    // Замер: панели гаснут. Пошевелился: зажглось — и берёза собирается.
    h.run(sleep + reach * sleepStagger + 2.5);
    expect(lights(h)!.lit).toBe(0);
    expect(stateOf(h, id)).toBe('gone');
    h.run(0.6, { ...emptyInput(), lookYaw: 0.01 });
    h.run(2.5, { ...emptyInput(), lookYaw: 0.002 });
    // Дерево укоренено: не «ушло» вещью сна и не встало у другой стены.
    expect(stateOf(h, id)).toBe('here');
    expect(g.things.list.length).toBe(things);
    expect(g.illusions!.get(id)!.obj.at).toEqual(tree.at);
    expect(g.illusions!.open(id)).toBe(false);
  });

  it('эхо: шаг пускает волну и при фонаре, но сила её нулевая; фонарь выключен — больше нуля; включил — снова тишина', () => {
    for (const world of ['shelter', 'yellow'] as const) {
      const level = world === 'shelter' ? levelOf(SEED) : buildLevel(generateLayout(SEED, 2, 'yellow'));
      const h = new Harness(level, { seed: 3 });
      const g = h.game;
      const walk: InputFrame = { ...emptyInput(), moveZ: 1 };
      const echo = (): { kind: number; amp: number }[] => (g.snapshot() as unknown as { echo: { kind: number; amp: number }[] }).echo;
      const packed = (): number[] => {
        const e = h.r.frames.at(-1)!.echo;
        const out: number[] = [];
        if (e) for (let i = 0; i < e.length; i += 8) out.push(e[i + 4]!);
        return out;
      };
      expect(g.light.state).toBe('on');
      h.run(1.2, walk);
      const steps = echo().filter((p) => p.kind === 0);
      expect(steps.length, `${world}: волн шагов`).toBeGreaterThan(0);
      for (const p of echo()) expect(p.amp, `${world}: сила волны при свете`).toBe(0);
      for (const a of packed()) expect(a).toBe(0);
      // Выключил: ждём, пока привыкнут глаза, идём — волны слышны.
      h.tick({ ...emptyInput(), light: true });
      h.run(2.5);
      h.run(1, walk);
      expect(Math.max(...echo().map((p) => p.amp)), world).toBeGreaterThan(0.3);
      // Включил: сила уходит почти сразу.
      h.tick({ ...emptyInput(), light: true });
      h.run(0.6, walk);
      for (const p of echo()) expect(p.amp, `${world}: после включения`).toBeLessThan(0.05);
    }
  });

  it('вещь воспоминания, в которую игрок упёрся, на месте: не растворилась, не тронута, её по-прежнему ищут (партнёр 18.11, 16:02)', () => {
    // Раньше она рассыпалась и возвращалась собой после темноты; теперь касания не замечает вовсе.
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    const { id } = h.reveal();
    const t = g.things.list.find((x) => x.id === id)!;
    expect(h.until(() => t.state === 'idle', 3)).toBe(true);
    const pos = [...t.pos];
    const kind = t.kind;
    if (t.collider >= 0) {
      // Вещь с преградой: касаемся её, упёршись.
      const box = g.colliders.boxes[t.collider]!;
      expect(box.owner).toBe(-t.id);
    }
    const floor = Math.floor((t.pos[1] + 0.3) / 4.5) * 4.5;
    g.teleport(t.pos[0] - 0.4, floor, t.pos[2]);
    g.aimAt(t.pos[0], floor + 0.5, t.pos[2]);
    h.run(1, { ...emptyInput(), moveZ: 1 });
    expect(t.state).toBe('idle');
    expect(t.touched).toBe(false);
    expect(t.dissolve).toBe(0);
    // И свет выкл/вкл ничего не меняет: возвращать нечего.
    g.teleport(t.pos[0] - 4, floor, t.pos[2]);
    blink(h, 1);
    h.run(1);
    expect(t.state).toBe('idle');
    expect(t.kind).toBe(kind);
    expect(t.pos).toEqual(pos);
    expect(g.session!.active?.def.thing).toBe(kind);
  });
});

describe('зал ожидания: время идёт, только пока идёшь', () => {
  /** Зал ожидания; ждём, пока кончится переход начала сессии: до того ни падение, ни ночь не действуют. */
  const station = (seed = 7): Harness => {
    const h = new Harness(buildLevel(generateLayout(seed, 2, 'station')), { seed });
    h.until(() => h.game.transition === null, 8);
    return h;
  };
  const forward: InputFrame = { ...emptyInput(), moveZ: 1 };

  it('у места свой ход времени и нет фонаря; в остальных мирах время обычное', () => {
    const h = station();
    expect(h.game.world).toBe('station');
    expect(h.game.flow).not.toBeNull();
    expect(h.game.hasLight).toBe(false);
    expect(new Harness(buildLevel(generateLayout(7, 2, 'office'))).game.flow).toBeNull();
    expect(new Harness(buildLevel(generateLayout(7, 2))).game.flow).toBeNull();
  });

  it('стоя игрок видит снимок: время на нём стоит, под ним — идёт втрое медленнее; первый шаг рвёт снимок', () => {
    const h = station();
    const f = h.game.flow!;
    h.run(3);
    expect(f.frozen).toBe(true);
    const view = f.viewT;
    const t0 = f.t;
    h.run(4);
    expect(f.viewT).toBe(view);
    expect(f.t - t0).toBeGreaterThan(1);
    expect(f.t - t0).toBeLessThan(1.5);
    // Пошёл: снимок рвётся (кадр дёргается), время места идёт в полную силу.
    h.game.lastTear = 0;
    h.run(1.5, forward);
    expect(f.frozen).toBe(false);
    expect(h.game.lastTear).toBeGreaterThan(0.3);
    expect(f.viewT).toBeCloseTo(f.t, 6);
    // (Чуть меньше двух секунд: по дороге игрок задевает мебель и на миг сбавляет шаг.)
    const t1 = f.t;
    h.run(2, forward);
    expect(f.t - t1).toBeGreaterThan(1.5);
  });

  it('за краем перрона ничего нет: шагнул — проснулся в начале', () => {
    const h = station();
    const g = h.game;
    const pit = g.level!.zones.find((z) => z.kind === 'pit')!;
    g.teleport((pit.minX + pit.maxX) / 2, 0, (pit.minZ + pit.maxZ) / 2);
    expect(h.until(() => g.transition !== null, 4), 'падение не разбудило').toBe(true);
    expect(g.transition?.plan).toEqual({ cause: 'caught', style: 'blackout', to: 'elsewhere', dest: 'start' });
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    const spawn = g.level!.spawn.pos;
    expect(Math.hypot(g.body.x - spawn[0], g.body.z - spawn[2])).toBeLessThan(0.5);
    expect(g.where).toBe('main');
  });

  it('стемнело — зал закрывается: проснулся в начале, день начинается заново', () => {
    const h = station();
    const g = h.game;
    const f = g.flow!;
    f.t = f.cfg.day - 0.4;
    h.run(1.2, forward);
    expect(g.transition?.plan.cause).toBe('caught');
    expect(f.t).toBeLessThan(5);
    expect(f.night).toBe(false);
  });
});

describe('давление помимо Осыпи: пол рассыпается, потолок опускается', () => {
  const forward: InputFrame = { ...emptyInput(), moveZ: 1 };
  const yawTo = (fx: number, fz: number, tx: number, tz: number): number => Math.atan2(-(tx - fx), -(tz - fz));

  /**
   * Мир и игрок в помещении, годном для давления: в самой дальней от выходов точке или (near) метрах
   * в трёх-четырёх от выхода.
   */
  const inRoom = (world: 'shelter' | 'office' | 'yellow', near = false, seed = 7): { h: Harness; room: PressureRoom; exit: readonly [number, number] } => {
    const level = buildLevel(generateLayout(seed, 2, world));
    const h = new Harness(level, { seed });
    h.until(() => h.game.transition === null, 8);
    const g = h.game;
    let best: { room: PressureRoom; n: { x: number; y: number; z: number }; score: number } | null = null;
    for (const room of g.pressureRooms.values()) {
      for (const n of level.nav) {
        if (n.room !== room.id) continue;
        const d = nearestExit(room, n.x, n.z).dist;
        if (d < 2.6) continue;
        const score = near ? -Math.abs(d - 3.6) : d;
        if (!best || score > best.score) best = { room, n, score };
      }
    }
    expect(best, `в мире ${world} нет помещений для давления`).not.toBeNull();
    const { room, n } = best!;
    const exit = nearestExit(room, n.x, n.z).exit!;
    g.teleport(n.x, n.y, n.z, yawTo(n.x, n.z, exit[0], exit[1]), 0);
    h.tick();
    return { h, room, exit };
  };

  /** Идти к выходу и дальше за порог, пока не окажешься в метре с лишним снаружи; не дольше 14 секунд. */
  const walkOut = (h: Harness, room: PressureRoom, exit: readonly [number, number]): void => {
    const g = h.game;
    const out: [number, number] = [exit[0], exit[1]];
    if (Math.abs(exit[0] - room.minX) < 0.01) out[0] -= 2.2;
    else if (Math.abs(exit[0] - room.maxX) < 0.01) out[0] += 2.2;
    else if (Math.abs(exit[1] - room.minZ) < 0.01) out[1] -= 2.2;
    else out[1] += 2.2;
    let leg = 0;
    for (let i = 0; i < 60 * 14; i++) {
      const target = leg === 0 ? exit : out;
      if (leg === 0 && Math.hypot(exit[0] - g.body.x, exit[1] - g.body.z) < 0.5) leg = 1;
      // look — поворот на разницу: доворачиваем к цели.
      g.look(yawTo(g.body.x, g.body.z, target[0], target[1]) - g.aimYaw, 0);
      h.tick({ ...forward });
      if (g.transition) return;
      if (!(g.body.x > room.minX - 1.2 && g.body.x < room.maxX + 1.2 && g.body.z > room.minZ - 1.2 && g.body.z < room.maxZ + 1.2)) return;
    }
  };

  it('помещения для давления есть в убежище, офисе и жёлтых комнатах; в зале ожидания его нет', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      const g = new Harness(buildLevel(generateLayout(7, 2, world))).game;
      expect(g.pressure, world).not.toBeNull();
      expect(g.pressureRooms.size, world).toBeGreaterThan(0);
      for (const r of g.pressureRooms.values()) {
        expect(r.exits.length).toBeGreaterThan(0);
        expect(r.maxX - r.minX).toBeGreaterThanOrEqual(3);
        expect((r.maxX - r.minX) * (r.maxZ - r.minZ)).toBeGreaterThanOrEqual(18);
      }
    }
    expect(new Harness(buildLevel(generateLayout(7, 2, 'station'))).game.pressure).toBeNull();
  });

  it('«сеточное» помещение опасно, если стоять: простоял — пол пошёл, как при провале; идущий цел (квиз 17.11, ночь)', () => {
    let tried = 0;
    for (const seed of [SEED, 101, 202, 303, 404, 505, 606, 707]) {
      const level = levelOf(seed);
      const h = new Harness(level, { seed, calm: false });
      const g = h.game;
      h.until(() => g.transition === null, 8);
      const entry = [...g.wireRooms][0];
      if (!entry) continue;
      const [id, room] = entry;
      expect(g.roomFx.get(id)).toBe('wire');
      expect(g.pressureRooms.has(id)).toBe(false);
      tried += 1;
      g.teleport((room.minX + room.maxX) / 2, room.floorY, (room.minZ + room.maxZ) / 2);
      h.run(WIRE_STILL - 1);
      expect(g.pressure!.active, `сид ${seed}: рано`).toBeNull();
      expect(h.until(() => g.pressure!.active !== null, 2.5), `сид ${seed}: стоял, а пол не пошёл`).toBe(true);
      expect(g.pressure!.active!.kind).toBe('collapse');
      expect(g.pressure!.active!.room.id).toBe(id);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    // Идущему по помещению ничего не грозит: ходим по кругу дольше, чем можно стоять.
    for (const seed of [SEED, 101, 202, 303, 404, 505, 606, 707]) {
      const h = new Harness(levelOf(seed), { seed, calm: false });
      const g = h.game;
      h.until(() => g.transition === null, 8);
      const entry = [...g.wireRooms][0];
      if (!entry) continue;
      const room = entry[1];
      g.teleport((room.minX + room.maxX) / 2, room.floorY, (room.minZ + room.maxZ) / 2);
      for (let t = 0; t < (WIRE_STILL * 2) / STEP; t++) {
        g.look(0.02, 0);
        h.tick({ ...emptyInput(), moveZ: 1 });
      }
      expect(g.pressure!.active?.room.id === entry[0], `сид ${seed}: шёл, а пол пошёл`).toBe(false);
      break;
    }
  });

  it('провал: остался стоять — пол ушёл, упал, проснулся в начале; искомое остаётся искомым', () => {
    const { h } = inRoom('shelter');
    const g = h.game;
    const wear = g.wear;
    expect(g.startPressure('collapse')).toBe(true);
    expect(g.pressure!.active!.phase).toBe('warn');
    // Сетку и дыру в полу игра отдаёт рендеру.
    h.run(0.5);
    expect(h.r.frames.at(-1)!.press).not.toBeNull();
    expect(h.r.frames.at(-1)!.press!.grid).toBeGreaterThan(0);
    expect(h.until(() => g.pressure!.falling >= 0, 30), 'пол под стоящим не ушёл').toBe(true);
    // В падении камера летит вниз.
    h.run(0.3);
    expect(g.pressure!.camDrop([g.body.x, g.body.z])).toBeGreaterThan(0.2);
    expect(h.until(() => g.transition !== null, 3), 'падение не разбудило').toBe(true);
    expect(g.transition?.plan).toEqual({ cause: 'caught', style: 'blackout', to: 'elsewhere', dest: 'start' });
    const what = h.log.dream.filter((e) => e.type === 'pressure').map((e) => (e as { what: string }).what);
    expect(what).toEqual(['start', 'fall', 'woke']);
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    const spawn = g.level!.spawn.pos;
    expect(Math.hypot(g.body.x - spawn[0], g.body.z - spawn[2])).toBeLessThan(0.5);
    expect(g.pressure!.active).toBeNull();
    expect(g.wear).toBeGreaterThan(wear);
    expect(g.session!.over).toBe(false);
  });

  it('провал: пошёл к выходу из самого дальнего угла — успел; фронт забрал то, что стояло на полу', () => {
    for (const world of ['shelter', 'yellow'] as const) {
      const { h, room, exit } = inRoom(world);
      const g = h.game;
      const onFloor = (g.illusions?.list ?? []).filter((i) => {
        const x = (i.obj.min[0] + i.obj.max[0]) / 2;
        const z = (i.obj.min[2] + i.obj.max[2]) / 2;
        return x > room.minX && x < room.maxX && z > room.minZ && z < room.maxZ && Math.abs(i.obj.min[1] - room.floorY) < 0.3 && i.state === 'here';
      });
      expect(g.startPressure('collapse')).toBe(true);
      // Полсекунды на то, чтобы понять, — и к выходу.
      h.run(0.5);
      walkOut(h, room, exit);
      expect(g.pressure!.falling, world).toBeLessThan(0);
      expect(g.transition, world).toBeNull();
      // Пол досыпается без игрока, стоит пустым и собирается обратно.
      expect(h.until(() => g.pressure!.active === null, 40), world).toBe(true);
      expect(g.transition, world).toBeNull();
      expect(h.log.dream.filter((e) => e.type === 'pressure').map((e) => (e as { what: string }).what)).toEqual(['start']);
      if (onFloor.length > 0) expect(onFloor.some((i) => i.state !== 'here'), world).toBe(true);
    }
  });

  it('провал: фронт забирает то, что стоит на полу, — кроме опоры вещи, которую ищут (партнёр 18.11, 16:02)', () => {
    for (const world of ['shelter', 'yellow'] as const) {
      for (const seed of [7, 11, 23, 42]) {
        const level = buildLevel(generateLayout(seed, 2, world));
        const h = new Harness(level, { seed });
        h.until(() => h.game.transition === null, 8);
        const g = h.game;
        // Помещение для давления, где на полу стоит предмет с местом для вещи.
        let found: { room: PressureRoom; o: LevelObject; sp: ItemSpot } | null = null;
        for (const room of g.pressureRooms.values()) {
          for (const i of g.illusions!.list) {
            const o = i.obj;
            const x = (o.min[0] + o.max[0]) / 2;
            const z = (o.min[2] + o.max[2]) / 2;
            if (x < room.minX || x > room.maxX || z < room.minZ || z > room.maxZ || Math.abs(o.min[1] - room.floorY) > 0.3) continue;
            const sp = level.spots.find((s) => restsOn([s.x, s.y, s.z], o));
            if (sp) {
              found = { room, o, sp };
              break;
            }
          }
          if (found) break;
        }
        if (!found) continue;
        const { room, o, sp } = found;
        const t = placeMemory(h, sp);
        const others = g.illusions!.list.filter((i) => {
          const x = (i.obj.min[0] + i.obj.max[0]) / 2;
          const z = (i.obj.min[2] + i.obj.max[2]) / 2;
          return i.obj.id !== o.id && x > room.minX && x < room.maxX && z > room.minZ && z < room.maxZ && Math.abs(i.obj.min[1] - room.floorY) < 0.3 && i.state === 'here';
        });
        // Встать в трёх-четырёх метрах от выхода и запустить провал напрямую (отладочный вход правила «здесь вещь» не знает).
        const n = level.nav.filter((q) => q.room === room.id).sort((a, b) => Math.abs(nearestExit(room, a.x, a.z).dist - 3.6) - Math.abs(nearestExit(room, b.x, b.z).dist - 3.6))[0]!;
        const exit = nearestExit(room, n.x, n.z).exit!;
        g.teleport(n.x, n.y, n.z, yawTo(n.x, n.z, exit[0], exit[1]), 0);
        h.tick();
        expect(g.startPressure('collapse')).toBe(true);
        h.run(0.5);
        walkOut(h, room, exit);
        expect(h.until(() => g.pressure!.active === null, 40), `${world}, сид ${seed}`).toBe(true);
        expect(g.illusions!.get(o.id)!.state, `${world}, сид ${seed}: опора ушла с полом`).toBe('here');
        expect(t.state).toBe('idle');
        if (others.length > 0) expect(others.some((i) => i.state !== 'here'), `${world}, сид ${seed}: фронт не прошёл`).toBe(true);
        return;
      }
    }
    throw new Error('нет помещения для провала с местом для вещи на предмете');
  });

  it('сжатие: пошёл к выходу из самого дальнего угла — успел', () => {
    const { h, room, exit } = inRoom('office');
    const g = h.game;
    expect(g.startPressure('squeeze')).toBe(true);
    h.run(0.5);
    walkOut(h, room, exit);
    expect(g.transition).toBeNull();
    expect(h.until(() => g.pressure!.active === null, 30)).toBe(true);
  });

  it('сжатие: потолок провисает, камера пригибается; вышел — отпустило', () => {
    const { h, room, exit } = inRoom('office', true);
    const g = h.game;
    expect(g.startPressure('squeeze')).toBe(true);
    const span = g.pressure!.active!.span;
    h.run(span * 0.62);
    const v = h.r.frames.at(-1)!.press!;
    expect(v.drop).toBeGreaterThan(0.8);
    expect(v.grid).toBeGreaterThan(0.4);
    expect(g.pressure!.camDrop([g.body.x, g.body.z])).toBeGreaterThan(0.02);
    walkOut(h, room, exit);
    expect(g.transition).toBeNull();
    expect(g.pressure!.camDrop([g.body.x, g.body.z])).toBe(0);
    expect(h.until(() => g.pressure!.active === null, 30)).toBe(true);
  });

  it('сжатие: остался — потолок дошёл до метра, проснулся в начале', () => {
    const { h } = inRoom('office');
    const g = h.game;
    expect(g.startPressure('squeeze')).toBe(true);
    expect(h.until(() => g.transition !== null, 60), 'потолок не разбудил').toBe(true);
    expect(g.transition?.plan.cause).toBe('caught');
    expect(h.log.dream.filter((e) => e.type === 'pressure').map((e) => (e as { what: string }).what)).toEqual(['start', 'woke']);
  });

  it('режиссёр сам начинает событие, когда игрок задержался в помещении; в покое и с выключенным режиссёром — нет', () => {
    const quiet = inRoom('yellow');
    quiet.h.run(70);
    expect(quiet.h.game.pressure!.count).toBe(0);
    const off = inRoom('yellow');
    off.h.game.calm = false;
    off.h.game.pressureAuto = false;
    off.h.run(70);
    expect(off.h.game.pressure!.count).toBe(0);
    const { h } = inRoom('yellow');
    const g = h.game;
    g.calm = false;
    // Осыпь и случайные скачки этой проверке мешают: ждём только первого события давления.
    const started = h.until(() => g.pressure!.count > 0 || g.transition !== null, 70);
    expect(started).toBe(true);
    if (g.pressure!.count > 0) expect(g.pressure!.active!.kind).toBe('collapse');
  });
});

describe('собрано только там, куда смотрит герой; небо видно там, где нет потолка', () => {
  it('правило взгляда действует во всех мирах; в зале ожидания взгляд стоящего шире, чем идущего', () => {
    for (const world of ['shelter', 'office', 'yellow', 'station'] as const) {
      const h = new Harness(buildLevel(generateLayout(7, 2, world)));
      h.until(() => h.game.transition === null, 8);
      h.run(1);
      expect(h.r.frames.at(-1)!.gaze, world).toBe(1);
    }
    const h = new Harness(buildLevel(generateLayout(7, 2, 'station')));
    h.until(() => h.game.transition === null, 8);
    h.run(4);
    const still = h.r.frames.at(-1)!.gazeCone!;
    h.run(3, { ...emptyInput(), moveZ: 1 });
    const moving = h.r.frames.at(-1)!.gazeCone!;
    expect(still[1]).toBeGreaterThan(moving[1] + 5);
    expect(moving[1]).toBeLessThan(30);
    // В остальных мирах конус — как у луча фонаря (рендер берёт его по умолчанию).
    expect(new Harness(buildLevel(generateLayout(7, 2, 'office'))).r.frames.at(-1)?.gazeCone).toBeUndefined();
  });

  it('звёздное небо стоит над убежищем, офисом и жёлтыми комнатами; в зале ожидания проступает к вечеру', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      const level = buildLevel(generateLayout(20041113, 2, world));
      expect(level.skyRoom, world).toBeDefined();
      const h = new Harness(level);
      h.run(1);
      expect(h.r.frames.at(-1)!.stars, world).toBeGreaterThan(0.4);
      // Где неба не увидеть — потолок везде цел и комнаты под небом нет, — оно и не рисуется.
      const closed = new Harness({ ...level, skyRoom: undefined } as BuiltLevel);
      closed.run(1);
      expect(closed.r.frames.at(-1)!.stars, world).toBe(0);
    }
    const h = new Harness(buildLevel(generateLayout(7, 2, 'station')));
    h.until(() => h.game.transition === null, 8);
    h.run(1);
    expect(h.r.frames.at(-1)!.stars).toBe(0);
    h.game.flow!.seek(h.game.flow!.cfg.day * 0.96);
    h.run(0.5);
    expect(h.r.frames.at(-1)!.stars).toBeGreaterThan(0.4);
  });

  it('в комнате под небом небо видно целиком: несобранное его не режет; вышел — как было (партнёр 17.11)', () => {
    const level = buildLevel(generateLayout(20041113, 2, 'shelter'));
    const room = level.layout!.rooms[level.skyRoom!]!;
    const [cx, cz] = room.cells[0]!;
    const h = new Harness(level);
    h.until(() => h.game.transition === null, 8);
    h.run(0.5);
    expect(h.r.frames.at(-1)!.skyOpen ?? 0).toBeLessThan(0.05);
    h.game.teleport(cellToWorld(cx), tierFloor(room.tier), cellToWorld(cz), 0, 0.4);
    h.run(0.3);
    const opening = h.r.frames.at(-1)!.skyOpen ?? 0;
    expect(opening).toBeGreaterThan(0.2);
    expect(opening).toBeLessThan(0.95);
    h.run(2);
    expect(h.r.frames.at(-1)!.skyOpen ?? 0).toBeGreaterThan(0.95);
    const [sx, sy, sz] = level.spawn.pos;
    h.game.teleport(sx, sy, sz);
    h.run(3);
    expect(h.r.frames.at(-1)!.skyOpen ?? 0).toBeLessThan(0.05);
  });

  it('у каждой загрузки места своё небо: зерно неба меняется и при том же уровне (партнёр 17.11)', () => {
    const level = buildLevel(generateLayout(20041113, 2, 'shelter'));
    const h = new Harness(level);
    h.run(0.2);
    const first = h.r.frames.at(-1)!.skySeed;
    expect(first).toBeGreaterThan(0);
    h.game.loadLevel(level, { seed: 7, known: new Set() });
    h.run(0.2);
    const second = h.r.frames.at(-1)!.skySeed;
    expect(second).not.toBe(first);
    // Повторяемо: та же история загрузок — то же небо.
    const again = new Harness(level);
    again.run(0.2);
    expect(again.r.frames.at(-1)!.skySeed).toBe(first);
  });

  it('под небом первый взгляд вверх встречает падающую звезду — там, куда смотрит герой, и одну на вход', () => {
    // Аудит мест (16.11): небо и несобранный потолок выглядели одинаково — чёрное в белых точках.
    const level = buildLevel(generateLayout(20041113, 2, 'shelter'));
    const room = level.layout!.rooms[level.skyRoom!]!;
    const [cx, cz] = room.cells[0]!;
    const h = new Harness(level);
    h.until(() => h.game.transition === null, 8);
    // Под небом, но взгляд прямо — звезды нет.
    h.game.teleport(cellToWorld(cx), tierFloor(room.tier), cellToWorld(cz), 0, 0);
    h.run(0.5);
    expect(h.r.frames.at(-1)!.fall ?? null).toBeNull();
    // Поднял взгляд — летит: начинается чуть левее того, куда смотрит камера (рыскание 0 — это −z).
    h.game.teleport(cellToWorld(cx), tierFloor(room.tier), cellToWorld(cz), 0, 0.6);
    h.run(0.3);
    const f = h.r.frames.at(-1)!.fall;
    expect(f).toBeTruthy();
    expect(f![0]).toBeCloseTo(-Math.PI / 2 - 0.45, 1);
    expect(f![1]).toBeGreaterThan(0.6);
    // Второй раз подряд не бывает: звезда одна на вход под небо.
    h.run(2.5);
    expect(h.r.frames.at(-1)!.fall ?? null).toBeNull();
    h.game.teleport(cellToWorld(cx), tierFloor(room.tier), cellToWorld(cz), 1, 0.7);
    h.run(0.5);
    expect(h.r.frames.at(-1)!.fall ?? null).toBeNull();
  });

  it('при входе в помещение с красной сеткой игроку говорят, что это, — раз на помещение (партнёр 17.11)', () => {
    let seen = 0;
    for (const seed of [SEED, 101, 202, 303]) {
      const level = levelOf(seed);
      const h = new Harness(level, { seed });
      const g = h.game;
      h.until(() => g.transition === null, 8);
      const rooms = level.layout!.rooms;
      for (const fx of ['dark', 'wire'] as const) {
        const id = [...g.roomFx].find(([, f]) => f === fx)?.[0];
        if (id === undefined) continue;
        const room = rooms[id]!;
        const [cx, cz] = room.cells[0]!;
        const said = (): number => h.log.dream.filter((e) => e.type === 'room' && e.fx === fx).length;
        g.teleport(cellToWorld(cx), tierFloor(room.tier), cellToWorld(cz));
        h.run(0.3);
        expect(said(), `сид ${seed}: ${fx}`).toBe(1);
        // Вышел и вернулся — второй раз не говорят.
        const [sx, sy, sz] = level.spawn.pos;
        g.teleport(sx, sy, sz);
        h.run(0.3);
        g.teleport(cellToWorld(cx), tierFloor(room.tier), cellToWorld(cz));
        h.run(0.3);
        expect(said(), `сид ${seed}: ${fx}, второй вход`).toBe(1);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it('под звёздным небом ничего не давит и нет строба, темноты и сетки', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      for (const seed of [7, 20041113]) {
        const level = buildLevel(generateLayout(seed, 2, world));
        if (level.skyRoom === undefined) continue;
        const g = new Harness(level, { seed }).game;
        expect(g.pressureRooms.has(level.skyRoom), `${world}/${seed}`).toBe(false);
        expect(g.roomFx.has(level.skyRoom), `${world}/${seed}`).toBe(false);
      }
    }
  });

  it('где проросла трава, ничего не давит и нет строба, темноты и сетки; рендер получил вытоптанные круги места', () => {
    let seen = 0;
    for (const world of ['shelter', 'office'] as const) {
      for (const seed of [7, 11, 42, 20041113]) {
        const level = buildLevel(generateLayout(seed, 2, world), { wear: 0.8 });
        if (level.grassRoom === undefined) continue;
        seen += 1;
        const h = new Harness(level, { seed });
        const g = h.game;
        expect(g.pressureRooms.has(level.grassRoom), `${world}/${seed}`).toBe(false);
        expect(g.wireRooms.has(level.grassRoom), `${world}/${seed}`).toBe(false);
        expect(g.roomFx.has(level.grassRoom), `${world}/${seed}`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it('след лежавшего в траве: пока на него смотрят, трава поднимается; отвернулся — так и лежит', () => {
    let seen = 0;
    for (let seed = 1; seed < 80 && seen < 2; seed++) {
      if (!bodyRolled(seed) || !grassRolled(seed, 0.8)) continue;
      const level = buildLevel(generateLayout(seed, 2, 'shelter'), { wear: 0.8 });
      const body = level.grassBody;
      if (!body) continue;
      // Встать в своём помещении в паре метров от следа и посмотреть на него.
      const node = level.nav
        .filter((n) => n.room === level.grassRoom && Math.hypot(n.x - body.at[0], n.z - body.at[1]) >= 1.6)
        .sort((a, b) => Math.hypot(a.x - body.at[0], a.z - body.at[1]) - Math.hypot(b.x - body.at[0], b.z - body.at[1]))[0];
      if (!node) continue;
      seen += 1;
      const h = new Harness(level, { seed });
      const g = h.game;
      const face = Math.atan2(-(body.at[0] - node.x), -(body.at[1] - node.z));
      // Отвернувшись — не поднимается.
      g.teleport(node.x, node.y, node.z, face + Math.PI, -0.3);
      h.run(4);
      expect(g.bodyPress, `сид ${seed}: отвернулся`).toBe(1);
      expect(h.r.grassBody?.caps).toBe(BODY_CAPS);
      // Смотрит — поднимается медленно: за 4 с — на пятую часть, не больше.
      g.teleport(node.x, node.y, node.z, face, -0.45);
      h.run(4);
      expect(g.bodyPress, `сид ${seed}: смотрит`).toBeLessThan(0.95);
      expect(g.bodyPress).toBeGreaterThan(0.7);
      expect(h.r.grassBody?.press).toBeCloseTo(g.bodyPress, 5);
      h.run(BODY_RISE);
      expect(g.bodyPress).toBe(0);
    }
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it('трава тянется к фонарю: луч на траве — рендер получает карту, где трава тянется, и откуда свет; погас — карта медленно гаснет', () => {
    let seen = 0;
    for (let seed = 1; seed < 80 && seen < 1; seed++) {
      if (!grassRolled(seed, 0.8)) continue;
      const level = buildLevel(generateLayout(seed, 2, 'shelter'), { wear: 0.8 });
      if (level.grassRoom === undefined || !level.grass?.length) continue;
      const room = level.layout?.rooms.find((r) => r.id === level.grassRoom);
      const node = level.nav.find((n) => n.room === level.grassRoom);
      if (!room || !node) continue;
      seen += 1;
      const h = new Harness(level, { seed });
      const g = h.game;
      // Из другого помещения трава не отвечает: свет не знает стен, и луч в стену соседней комнаты шевелил бы траву за ней.
      const other = level.nav.find((n) => n.room !== level.grassRoom && n.tier === node.tier && Math.hypot(n.x - node.x, n.z - node.z) < 9);
      if (other) {
        g.teleport(other.x, other.y, other.z, Math.atan2(-(node.x - other.x), -(node.z - other.z)), -0.3);
        h.run(1);
        const map0 = h.r.grassLean.map as { data: Uint8Array } | null;
        expect(map0 ? map0.data.reduce((m, v) => Math.max(m, v), 0) : 0, `сид ${seed}: трава тянется к свету из соседнего помещения`).toBe(0);
        expect(g.grassRustle.gain).toBe(0);
      }
      // Встать в помещении с травой и светить под ноги, вперёд.
      g.teleport(node.x, node.y, node.z, 0, -0.6);
      // Луч лёг на траву — она шуршит (партнёр 20.11: «сделай шорох травы»), и шорох — из этого помещения.
      h.run(0.15);
      const burst = g.grassRustle.gain;
      expect(burst, `сид ${seed}: трава не шуршит`).toBeGreaterThan(0.25);
      expect(Math.hypot(g.grassRustle.at[0] - node.x, g.grassRustle.at[2] - node.z)).toBeLessThan(8);
      h.run(1.85);
      const lean = h.r.grassLean;
      expect(lean.strength, `сид ${seed}`).toBe(1);
      expect(lean.from).not.toBeNull();
      const map = lean.map as { data: Uint8Array } | null;
      expect(map, `сид ${seed}: карты нет`).not.toBeNull();
      const lit = map!.data.reduce((m, v) => Math.max(m, v), 0);
      expect(lit, `сид ${seed}: под лучом трава не тянется`).toBeGreaterThan(128);
      // Погасить фонарь: трава распрямляется, медленно, и шуршит тише, чем тянулась (в помещении её немного — почти молча).
      g.light.toggle();
      h.run(0.1);
      expect(g.grassRustle.gain).toBeLessThan(burst);
      h.run(0.4);
      const half = map!.data.reduce((m, v) => Math.max(m, v), 0);
      expect(half).toBeLessThan(lit);
      expect(half).toBeGreaterThan(lit * 0.5);
    }
    expect(seen).toBe(1);
  });

  it('трава примята там, где вещь лежит сейчас: вещь воспоминания на полу помещения с травой — круг вокруг неё; у дверей — круги всегда', () => {
    let seen = 0;
    for (const seed of [7, 11, 42, 20041113]) {
      const level = buildLevel(generateLayout(seed, 2, 'shelter'), { wear: 0.8 });
      if (level.grassRoom === undefined) continue;
      const room = level.layout!.rooms.find((r) => r.id === level.grassRoom)!;
      const y0 = tierFloor(room.tier);
      const sp = level.spots.find((q) => q.room === room.id && q.kind === 'floor');
      if (!sp) continue;
      seen += 1;
      const h = new Harness(level, { seed });
      const t = placeMemory(h, sp);
      h.run(0.2);
      const clear = h.r.grassClear;
      expect(clear.some((c) => Math.hypot(c[0] - t.pos[0], c[2] - t.pos[2]) < 1e-6 && Math.abs(c[1] - y0) < 0.05 && c[3] > 0.6), `сид ${seed}`).toBe(true);
      for (const d of level.grassClear ?? []) expect(clear.some((c) => c[0] === d[0] && c[2] === d[2]), `сид ${seed}: дверь`).toBe(true);
      // Вещь переложили на стол — круга у её прежнего места на полу больше нет.
      const table = level.spots.find((q) => q.room === room.id && q.y > y0 + 0.6);
      if (table) {
        const was = [...t.pos];
        t.pos = [table.x, table.y, table.z];
        h.run(0.2);
        expect(h.r.grassClear.some((c) => Math.hypot(c[0] - was[0]!, c[2] - was[2]!) < 1e-6), `сид ${seed}: круг остался`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(2);
  });
});

describe('птицы, Осыпь по полярности, эффекты кадра', () => {
  type World = 'shelter' | 'office' | 'yellow' | 'station';
  const worldLevel = (world: World, seed = 7, opts?: { wear?: number }): BuiltLevel => buildLevel(generateLayout(seed, 2, world), opts);
  const forward: InputFrame = { ...emptyInput(), moveZ: 1 };
  /** Зал ожидания; ждём, пока кончится переход начала сессии. */
  const station = (seed = 7, opts?: { wear?: number }): Harness => {
    const h = new Harness(worldLevel('station', seed, opts), { seed });
    h.until(() => h.game.transition === null, 8);
    return h;
  };
  /** Мир без перехода в начале. */
  const world = (w: World, seed = 7, opts?: { wear?: number }): Harness => {
    const h = new Harness(worldLevel(w, seed, opts), { seed });
    h.until(() => h.game.transition === null, 8);
    return h;
  };
  /** Идти секунду за секундой к точке, на каждом шаге повернувшись к ней: время места идёт, пока игрок идёт. */
  function walkTo(h: Harness, x: number, z: number, seconds: number): void {
    const g = h.game;
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      g.aimAt(x, g.body.y + 1.4, z);
      h.tick({ ...forward });
    }
  }
  /** Ближайший узел пути на том же ярусе, что и точка, но не дальше max от неё; null — нет. */
  const nodeNear = (level: BuiltLevel, p: Vec3, max: number) =>
    level.nav
      .filter((n) => Math.abs(n.y - p[1]) < 0.5 && Math.hypot(n.x - p[0], n.z - p[2]) < max)
      .sort((a, b) => Math.hypot(a.x - p[0], a.z - p[2]) - Math.hypot(b.x - p[0], b.z - p[2]))[0] ?? null;
  const birdEvents = (h: Harness, at: Vec3) => h.log.dream.filter((e) => e.type === 'bird' && e.what === 'takeoff' && e.at[0] === at[0] && e.at[1] === at[1] && e.at[2] === at[2]);
  const last = (h: Harness): FrameView => h.r.frames.at(-1)!;

  describe('зал ожидания: стая и голубь на полу', () => {
    it('после загрузки есть стая из шести птиц; рендер получает не меньше шести, у каждой по девять чисел', () => {
      const h = station();
      const f = h.game.flock;
      expect(f).not.toBeNull();
      expect(f!.count).toBe(6);
      h.run(0.5);
      expect(h.r.birds).toBeGreaterThanOrEqual(6);
      expect(h.r.birdData.length).toBe(h.r.birds * 9);
      for (const v of h.r.birdData) expect(Number.isFinite(v)).toBe(true);
    });

    it('стая знает четыре столба зала и за пять минут ни разу не пролетает сквозь них', () => {
      for (const seed of [7, 20041113, 31]) {
        const h = station(seed);
        const f = h.game.flock!;
        expect(f.blocks.length).toBe(4);
        for (let i = 0; i < f.count; i++) {
          for (let t = 0; t < 300; t += 0.05) {
            const p = f.pose(i, t);
            if (!p.flying) continue;
            for (const [x, z, r] of f.blocks) expect(Math.hypot(p.pos[0] - x, p.pos[2] - z)).toBeGreaterThan(r * 0.7);
          }
        }
      }
    });

    it('на полу зала сидит один голубь: он в зале, на уровне пола, и сидит', () => {
      const h = station();
      const g = h.game;
      expect(g.leavers).toHaveLength(1);
      const l = g.leavers[0]!;
      expect(l.state).toBe('sits');
      expect(l.to).not.toBeNull();
      const [x0, z0, x1, z1] = g.level!.roof!.box;
      expect(l.perch.pos[0]).toBeGreaterThan(x0);
      expect(l.perch.pos[0]).toBeLessThan(x1);
      expect(l.perch.pos[2]).toBeGreaterThan(z0);
      expect(l.perch.pos[2]).toBeLessThan(z1);
      expect(Math.abs(l.perch.pos[1])).toBeLessThan(0.5);
    });

    it('игрок подошёл ближе трёх метров — голубь срывается со звуком, через несколько секунд ходьбы он под крышей', () => {
      const h = station();
      const g = h.game;
      const l = g.leavers[0]!;
      const p = l.perch.pos;
      const n = nodeNear(g.level!, p, 3);
      expect(n, 'у голубя нет узла пути в трёх метрах').not.toBeNull();
      g.teleport(n!.x, n!.y, n!.z);
      // Сперва игрок стоит: голубь сидит на месте, пока не подойдёшь, а подойдя, срывается.
      h.tick();
      expect(Math.hypot(g.body.x - p[0], g.body.z - p[2])).toBeLessThan(3);
      walkTo(h, p[0], p[2], 0.3);
      expect(birdEvents(h, p).length).toBe(1);
      expect(l.state).toBe('leaves');
      // Дальше — ходьба по залу: время места идёт, пока идёшь; на месте стоять нельзя.
      const roof = g.level!.roof!.box;
      const spots: [number, number][] = [[roof[0] + 2, roof[1] + 3], [roof[2] - 2, roof[3] - 3], [roof[0] + 2, roof[3] - 3], [roof[2] - 2, roof[1] + 3]];
      for (let k = 0; k < 40 && l.state === 'leaves'; k++) walkTo(h, spots[k % 4]![0], spots[k % 4]![1], 1);
      expect(l.state).toBe('moved');
      expect(l.pose()!.pos).toEqual(l.to!.pos);
      // Сорвалась один раз.
      expect(birdEvents(h, p).length).toBe(1);
    });

    it('игрок стоит — позы стаи в двух кадрах подряд те же (снимок); идёт — позы меняются', () => {
      const h = station();
      h.run(3);
      expect(h.game.flow!.frozen).toBe(true);
      const a = Float32Array.from(h.r.birdData);
      h.tick();
      const b = Float32Array.from(h.r.birdData);
      expect(b).toEqual(a);
      h.run(2);
      expect(Float32Array.from(h.r.birdData)).toEqual(a);
      // Пошёл: за две секунды хода кто-нибудь из стаи успел перелететь или взмахнуть.
      const roof = h.game.level!.roof!.box;
      walkTo(h, (roof[0] + roof[2]) / 2, (roof[1] + roof[3]) / 2, 2);
      expect(h.game.flow!.frozen).toBe(false);
      expect(Float32Array.from(h.r.birdData)).not.toEqual(a);
    });

    it('в сильно стёртом месте стаи нет', () => {
      const h = station(7, { wear: 0.9 });
      const f = h.game.flock;
      expect(f === null || f.count === 0).toBe(true);
      expect(h.game.leavers).toHaveLength(0);
      h.run(0.5);
      expect(h.r.birds).toBe(0);
    });
  });

  describe('комната под небом: птица на кромке стены', () => {
    for (const w of ['shelter', 'office', 'yellow'] as const) {
      it(`${w}: один голубь на высоте потолка комнаты; подошёл ближе 2,6 м — срывается и улетает навсегда`, () => {
        const level = worldLevel(w, 20041113);
        expect(level.skyRoom, w).toBeDefined();
        const h = new Harness(level, { seed: 20041113 });
        h.until(() => h.game.transition === null, 8);
        const g = h.game;
        expect(g.flock).toBeNull();
        expect(g.leavers).toHaveLength(1);
        const l = g.leavers[0]!;
        expect(l.state).toBe('sits');
        expect(l.to).toBeNull();
        const room = level.layout!.rooms[level.skyRoom!]!;
        expect(l.perch.pos[1]).toBeCloseTo(-4.5 * room.tier + level.ceilings![level.skyRoom!]!, 6);
        h.run(0.3);
        expect(h.r.birds).toBe(1);
        // Подошёл: на ближайшем узле комнаты до птицы меньше 2,6 м.
        const n = nodeNear(level, [l.perch.pos[0], -4.5 * room.tier, l.perch.pos[2]], 2.5);
        expect(n, 'у птицы нет узла пути ближе 2,6 м').not.toBeNull();
        g.teleport(n!.x, n!.y, n!.z);
        h.tick();
        h.tick();
        expect(l.state).toBe('leaves');
        expect(birdEvents(h, l.perch.pos).length).toBe(1);
        // Через шесть секунд её нет совсем. (Мир обычный: время идёт и стоя.)
        h.run(6);
        expect(l.state).toBe('gone');
        expect(h.r.birds).toBe(0);
        h.run(10);
        expect(h.r.birds).toBe(0);
      });
    }

    it('в стёртом месте (0,9) её тоже нет', () => {
      const level = worldLevel('shelter', 20041113, { wear: 0.9 });
      const h = new Harness(level, { seed: 20041113 });
      expect(h.game.leavers).toHaveLength(0);
      h.run(0.3);
      expect(h.r.birds).toBe(0);
    });
  });

  describe('полярность Осыпи', () => {
    it('в светлых местах (зал ожидания, офис) к третьей секунде она темнота (> 0,9)', () => {
      for (const w of ['station', 'office'] as const) {
        const h = world(w);
        h.run(3);
        expect(last(h).polar, w).toBeGreaterThan(0.9);
      }
    });

    it('в тёмных (убежище, жёлтые комнаты) она свет (< 0,1)', () => {
      for (const w of ['shelter', 'yellow'] as const) {
        const h = world(w);
        h.run(3);
        expect(last(h).polar, w).toBeLessThan(0.1);
      }
    });
  });

  describe('Осыпь под взглядом, когда фонаря нет', () => {
    type Fear = { type: string; what?: string };
    /** Осыпь охотится в соседних клетках. Каждый шаг игрок смотрит на неё (on) или от неё (off). Что случилось первым: рассыпалась, поймала, ничего. */
    function watch(h: Harness, aim: 'on' | 'off', seconds = 3): { result: 'scattered' | 'caught' | 'none'; node: number } | null {
      const g = h.game;
      const sw = g.swarm!;
      for (const node of nodesInRange(g.level!.nav, g.playerNode(), 2, 4)) {
        sw.activate(node);
        sw.mode = 'hunt';
        sw.cohesion = 1;
        sw.awareness = 1;
        h.log.fear.length = 0;
        for (let i = 0; i < Math.round(seconds / STEP); i++) {
          const b = g.body;
          if (aim === 'on') g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
          else g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
          h.tick();
          const ev = h.log.fear as Fear[];
          if (ev.some((e) => e.type === 'swarm' && e.what === 'scattered')) return { result: 'scattered', node };
          if (ev.some((e) => e.type === 'swarm' && e.what === 'caught')) return { result: 'caught', node };
        }
        return { result: 'none', node };
      }
      return null;
    }

    it('офис: фонаря нет, но взгляд держит её, и через burnTime она рассыпается', () => {
      let scattered = 0;
      for (const seed of [SEED, 7, 42]) {
        const level = buildLevel(generateLayout(seed, 2, 'office'));
        const h = new Harness(level, { calm: false, seed: 6 });
        h.run(2);
        expect(h.game.light.intensity).toBe(0);
        const t0 = h.game.session!.time;
        const r = watch(h, 'on', 3);
        expect(r, `сид ${seed}: нет узлов для Осыпи`).not.toBeNull();
        if (r!.result === 'scattered') {
          scattered += 1;
          // Не раньше burnTime (1,5 с): рассыпалась под взглядом, а не сразу.
          expect(h.game.session!.time - t0).toBeGreaterThanOrEqual(1.4);
          expect((h.game.snapshot() as { swarm: { mode: string } }).swarm.mode).toBe('scatter');
        }
      }
      expect(scattered, 'ни разу не вышло проявить Осыпь взглядом').toBeGreaterThan(0);
    });

    it('офис: смотришь в сторону — она не рассыпается', () => {
      const level = buildLevel(generateLayout(SEED, 2, 'office'));
      const h = new Harness(level, { calm: false, seed: 6 });
      h.run(2);
      const r = watch(h, 'off', 3);
      expect(r).not.toBeNull();
      expect(r!.result).not.toBe('scattered');
    });

    it('зал ожидания: у стоящего игрока (снимок) взгляд её не держит; идущего — держит', () => {
      const h = station();
      const g = h.game;
      h.run(3);
      expect(g.flow!.frozen).toBe(true);
      const sw = g.swarm!;
      const beam = (): boolean => (g as unknown as { beamOnSwarm(): boolean }).beamOnSwarm();
      let held = 0;
      let heldWalking = 0;
      for (const node of nodesInRange(g.level!.nav, g.playerNode(), 2, 4)) {
        sw.activate(node);
        sw.mode = 'hunt';
        sw.cohesion = 1;
        sw.awareness = 1;
        // Стоя: взгляд на ней, но она «там, где была».
        g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        h.tick();
        h.tick();
        if (beam()) held += 1;
        // Тот же угол, но на ходу.
        g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        h.tick({ ...forward });
        g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        for (let i = 0; i < 30; i++) {
          h.tick({ ...forward });
          g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        }
        if (beam()) heldWalking += 1;
        h.run(3);
      }
      expect(held).toBe(0);
      expect(heldWalking, 'на ходу взгляд ни разу не удержал Осыпь').toBeGreaterThan(0);
    });
  });

  describe('разрыв кадра', () => {
    it('зал ожидания: постоял восемь секунд и шагнул — кадр рвётся; через секунду ходьбы разрыва нет', () => {
      const h = station();
      h.run(8);
      expect(last(h).mosh).toBe(0);
      let peak = 0;
      for (let i = 0; i < 5; i++) {
        h.tick({ ...forward });
        peak = Math.max(peak, last(h).mosh ?? 0);
      }
      expect(peak).toBeGreaterThan(0);
      h.run(1, forward);
      expect(last(h).mosh).toBe(0);
    });

    it('убежище: разрыва кадра нет никогда', () => {
      const h = world('shelter');
      for (let i = 0; i < 6; i++) {
        h.run(1.5, i % 2 === 0 ? undefined : forward);
        for (const f of h.r.frames) expect(f.mosh ?? 0).toBe(0);
      }
    });
  });

  describe('ветер', () => {
    it('в каждом мире кадр несёт ветер с ненулевым размахом', () => {
      for (const w of ['shelter', 'office', 'yellow', 'station'] as const) {
        const h = world(w);
        h.run(1);
        const wind = last(h).wind;
        expect(wind, w).toBeDefined();
        expect(wind!.amp, w).toBeGreaterThan(0);
        expect(Number.isFinite(wind!.t), w).toBe(true);
      }
    });

    it('зал ожидания: у стоящего игрока время ветра стоит, у идущего растёт', () => {
      const h = station();
      h.run(3);
      expect(h.game.flow!.frozen).toBe(true);
      const t0 = last(h).wind!.t;
      h.run(1.5);
      expect(last(h).wind!.t).toBe(t0);
      const roof = h.game.level!.roof!.box;
      walkTo(h, (roof[0] + roof[2]) / 2, (roof[1] + roof[3]) / 2, 0.5);
      const t1 = last(h).wind!.t;
      walkTo(h, (roof[0] + roof[2]) / 2, (roof[1] + roof[3]) / 2, 0.5);
      expect(t1).toBeGreaterThan(t0);
      expect(last(h).wind!.t).toBeGreaterThan(t1);
    });
  });

  describe('тени-пятна под обстановкой', () => {
    /** Значение канала tier карты в точке мира. */
    const mapAt = (m: NonNullable<FakeRenderer['contact']>, x: number, z: number, ch = 0): number => {
      const ix = Math.floor(((x - m.origin[0]) / m.span) * m.size);
      const iz = Math.floor(((z - m.origin[1]) / m.span) * m.size);
      return m.data[(iz * m.size + ix) * 4 + ch]!;
    };

    it('после загрузки уровня с мебелью карта теней есть; кадр просит рисовать пятна', () => {
      const h = new Harness(levelOf(SEED), { seed: 3 });
      h.run(0.2);
      expect(h.r.contact).not.toBeNull();
      expect(h.r.contactBakes).toBeGreaterThanOrEqual(1);
      expect(last(h).contact).toBe(true);
    });

    it('предмет рассыпался от касания — карту пересобрали, и под ним стало светлее', () => {
      const h = new Harness(levelOf(SEED), { seed: 3, cfg: { ...QUICK, firstDelay: 600 } });
      const g = h.game;
      h.run(0.3);
      // Высокий предмет на полу первого яруса, у которого пятно в центре тёмное.
      const o = g.level!.objects!.find((x) => x.solid && !x.flat && x.group === undefined && Math.abs(x.min[1]) < 0.1 && x.max[1] - x.min[1] > 0.5 && ALL_PROPS[x.name]?.mount === 'floor' && mapAt(h.r.contact!, (x.min[0] + x.max[0]) / 2, (x.min[2] + x.max[2]) / 2) > 20);
      expect(o, 'нет подходящего предмета').toBeDefined();
      const cx = (o!.min[0] + o!.max[0]) / 2;
      const cz = (o!.min[2] + o!.max[2]) / 2;
      const before = mapAt(h.r.contact!, cx, cz);
      const bakes = h.r.contactBakes;
      // Коснулись — то же, что делает игра, когда игрок упёрся в вещь.
      expect(g.illusions!.touch(o!.id)).toBe(true);
      h.run(2.5);
      expect(g.illusions!.get(o!.id)!.state).toBe('gone');
      expect(h.r.contactBakes).toBeGreaterThan(bakes);
      expect(mapAt(h.r.contact!, cx, cz)).toBeLessThan(before);
    });
  });
});

describe('телефон: тап — выключатель, палец на кнопке заряжает (слова партнёра 17.11 08:42, 09:23 и 10:04)', () => {
  it('тап — погас, второй тап — зажёгся; держит палец — заряжается, на полном вспышка, потом обычный свет', () => {
    const h = new Harness(levelOf(SEED), { light: { meanFailInterval: 1e9 } });
    const g = h.game;
    h.run(0.5);
    expect(g.light.state).toBe('on');
    expect(h.tick({ ...emptyInput(), light: true }).lightToggled).toBe(true);
    expect(g.light.state).toBe('off');
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('on');
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('off');
    // Палец на кнопке: заряд растёт, свет — только на полном, со вспышкой в луче. Вспышки мягкие (партнёр 19.11): луч не
    // прыгает, а набухает и спадает, в середине — в полтора раза ярче; кадр светлеет чуть-чуть.
    g.light.charge = 0.5;
    let charged = -1;
    let cranking = 0;
    for (let i = 0; i < Math.round(2 / STEP) && charged < 0; i++) {
      const ev = h.tick({ ...emptyInput(), crank: true });
      if (ev.crank >= 0) cranking += 1;
      if (ev.lightCharged) charged = i;
    }
    expect(charged).toBeGreaterThan(0);
    expect(cranking).toBeGreaterThan(Math.round(1 / STEP));
    expect(g.light.state).toBe('on');
    let peak = 0;
    let white = 0;
    let jump = 0;
    let prev = h.r.frames.at(-1)!.lightIntensity;
    for (let i = 0; i < Math.round(0.9 / STEP); i++) {
      h.tick({ ...emptyInput(), crank: true });
      const f = h.r.frames.at(-1)!;
      peak = Math.max(peak, f.lightIntensity);
      white = Math.max(white, f.flash);
      jump = Math.max(jump, f.lightIntensity - prev);
      prev = f.lightIntensity;
    }
    expect(peak).toBeGreaterThan(1.4);
    expect(peak).toBeLessThanOrEqual(1.61);
    expect(jump).toBeLessThan(0.05);
    expect(white).toBeGreaterThan(0.05);
    expect(white).toBeLessThanOrEqual(0.12);
    // Секунду спустя — обычный свет, кадр не выбелен.
    h.run(1.1, { ...emptyInput(), crank: true });
    const after = h.r.frames.at(-1)!;
    expect(after.lightIntensity).toBeLessThan(1.1);
    expect(after.flash).toBe(0);
  });

  it('заглохший фонарь тапом не оживить — только удержанием (тап — выключатель, а не тряска)', () => {
    const h = new Harness(levelOf(SEED), { light: { meanFailInterval: 1e9 } });
    const g = h.game;
    h.run(0.5);
    g.light.forceFail();
    h.tick();
    expect(g.light.state).toBe('dead');
    for (let i = 0; i < 6; i++) h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('dead');
    h.run(1.2, { ...emptyInput(), crank: true });
    expect(g.light.state).toBe('on');
  });

  it('вспышки всегда мягкие (партнёр 19.11): вспышка заряда набухает плавно, кадр светлеет чуть-чуть; «почти незаметные» — едва', () => {
    for (const [faint, cap, whiteCap] of [
      [false, 1.61, 0.12],
      [true, 1.16, 0],
    ] as const) {
      const h = new Harness(levelOf(SEED), { light: { meanFailInterval: 1e9 } });
      const g = h.game;
      g.faintFlash = faint;
      h.run(0.5);
      h.tick({ ...emptyInput(), light: true });
      let top = 0;
      let white = 0;
      let jump = 0;
      let prev = h.r.frames.at(-1)!.lightIntensity;
      for (let i = 0; i < Math.round(2.5 / STEP); i++) {
        h.tick({ ...emptyInput(), crank: true });
        const f = h.r.frames.at(-1)!;
        top = Math.max(top, f.lightIntensity);
        white = Math.max(white, f.flash);
        // Само включение (с нуля до света) — не вспышка: меряем, только пока свет горит.
        if (prev > 0.5) jump = Math.max(jump, f.lightIntensity - prev);
        prev = f.lightIntensity;
      }
      expect(g.light.state).toBe('on');
      expect(top).toBeLessThanOrEqual(cap);
      expect(white).toBeLessThanOrEqual(whiteCap);
      expect(jump).toBeLessThan(0.05);
    }
  });


});

describe('ступени погружения: каждая из первых сессий открывает одно правило (предложения 17.11; партнёр: «Далее делай…»)', () => {
  const coldOpenOf = (g: Game) => g.things.list.find((t) => t.fate === 'jump' && t.still);
  const releases = (h: Harness) => h.log.fear.filter((e) => e.type === 'swarm' && (e as { what?: string }).what === 'release').length;
  const glimpses = (h: Harness) => h.log.fear.filter((e) => e.type === 'swarm' && (e as { what?: string }).what === 'apparition').length;

  it('ступень 2 (скачки): впереди входа — вещь, ведущая на луг; первые секунды стоит, потом от взгляда уносит на луг, и луг отпускает быстро', () => {
    // Прежний «холодный старт» первой сессии (плейтест партнёра 19.11: необъяснённый перенос путал новичков) — теперь первый
    // скачок той ступени, что вводит скачки.
    const h = new Harness(levelOf(SEED), { stage: 2 });
    const g = h.game;
    const t = coldOpenOf(g);
    expect(t, 'вещи холодного старта нет').toBeTruthy();
    const [sx, , sz] = g.level!.spawn.pos;
    const d = Math.hypot(t!.pos[0] - sx, t!.pos[2] - sz);
    expect(d).toBeGreaterThanOrEqual(4.5);
    expect(d).toBeLessThanOrEqual(9);
    // Смотрим на неё с самого начала: первые секунды она только стоит — обычная жизнь.
    g.aimAt(t!.pos[0], t!.pos[1] + 0.8, t!.pos[2]);
    h.run(14);
    expect(t!.state).toBe('idle');
    expect(g.where).toBe('main');
    // Потом — растёт навстречу и уносит на луг.
    expect(h.until(() => g.where === 'pocket', 12), 'холодный старт не унёс').toBe(true);
    expect(g.pocket!.kind).toBe('meadow');
    // Луг после неё отпускает через ~20 с, а не через 46–60.
    expect(h.until(() => g.where === 'main' && g.transition === null, 26), 'луг не отпустил').toBe(true);
  });

  it('на ступенях 0, 1, 3 и 4 холодного старта нет', () => {
    for (const stage of [0, 1, 3, STAGE_ALL]) expect(coldOpenOf(new Harness(levelOf(SEED), { stage }).game), `ступень ${stage}`).toBeUndefined();
  });

  it('ступень 0: Осыпь видна в первые полминуты — силуэт впереди, на виду; не охотится, пока вещь не вспомнена; без скачков, давления и случайных отказов фонаря (сам он глохнет только в тёмном уроке)', () => {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false, light: { firstFailAt: 30, meanFailInterval: 20 } });
    const g = h.game;
    const [sx, sy, sz] = g.level!.spawn.pos;
    // Смотрим вдоль самой длинной видимой линии от входа: там есть где показаться (в тесной комнате явление ждёт).
    const eye: Vec3 = [sx, sy + 1.5, sz];
    const far = g.level!.nav
      .filter((n) => Math.abs(n.y - sy) < 1)
      .map((n) => ({ n, d: Math.hypot(n.x - sx, n.z - sz) }))
      .filter(({ n, d }) => d > 7 && g.colliders.raycast(eye[0], eye[1], eye[2], (n.x - sx) / d, (n.y + 1.3 - eye[1]) / d, (n.z - sz) / d, d) >= d - 0.5)
      .sort((a, b) => b.d - a.d)[0];
    expect(far, 'от входа не видно ничего дальше 7 м').toBeTruthy();
    g.aimAt(far!.n.x, sy + 1.4, far!.n.z);
    // Плейтест партнёра 19.11: «показать его в первые моменты, но не сталкивать с игроком».
    expect(h.until(() => glimpses(h) > 0, 30), 'Осыпь не показалась в первые полминуты').toBe(true);
    const sw = g.swarm!;
    expect(sw.mode).toBe('apparition');
    // Впереди: в конусе взгляда, не ближе 6 м, и тело нарисовано.
    h.tick();
    const f = h.r.frames.at(-1)!;
    const dx = sw.pos[0] - f.camPos[0];
    const dz = sw.pos[2] - f.camPos[2];
    expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(5);
    const ahead = (dx * -Math.sin(f.camYaw) + dz * -Math.cos(f.camYaw)) / Math.hypot(dx, dz);
    expect(ahead, 'явление не впереди').toBeGreaterThan(Math.cos(0.65));
    expect(h.r.swarm.alpha, 'тело явления не нарисовано').toBeGreaterThan(0);
    let dead = 0;
    for (let i = 0; i < 240; i++) {
      h.run(1);
      if (g.light.state === 'dead') dead += 1;
    }
    expect(dead).toBe(0);
    // И батарейка не садится: севший фонарь — правило, которое новичку ещё не показали (замечание куратора).
    expect(g.light.charge).toBeGreaterThan(0.99);
    // Вещь не вспомнена — охоты нет, сколько бы ни прошло; явления — изредка.
    expect(releases(h)).toBe(0);
    expect(glimpses(h)).toBeGreaterThan(1);
    expect(g.director!.cfg.traceAt).toBeUndefined();
    expect(h.dreamCount('jump', 'start')).toBe(0);
    expect(h.dreamCount('pressure')).toBe(0);
  });

  it('ступень 0: вспомнил первую вещь — Осыпь выходит на охоту (квиз 19.11: «после первой вещи»), но не раньше, чем показалась', () => {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false });
    const g = h.game;
    const s = g.session!;
    // Вещь — сразу, раньше первого явления: охота ждёт, пока Осыпь покажется.
    s.rush();
    h.until(() => s.active !== null, 3);
    recallActive(h);
    expect(glimpses(h)).toBe(0);
    h.run(1);
    expect(releases(h), 'охота раньше явления').toBe(0);
    // Охота — после явления; а если показать Осыпь негде (игрок стоит в тесной комнате у вещи), — не позже чем через
    // GLIMPSE_WAIT после начала явлений.
    expect(h.until(() => releases(h) > 0, 10 + 5 + GLIMPSE_WAIT + 5), 'охоты после первой вещи нет').toBe(true);
    const shownFirst = glimpses(h) > 0;
    const clock = (g as unknown as { sleepTime: number }).sleepTime;
    expect(shownFirst || g.director!.cfg.glimpseAt + GLIMPSE_WAIT <= clock + 0.5, 'охота началась раньше, чем Осыпь показалась').toBe(true);
  });

  it('ступени 0–1 без скачков, 2–3 — мягкие скачки; Осыпь на всех — с первой минуты, охота после первой вещи', () => {
    const at = (stage: number) => new Harness(levelOf(SEED), { stage }).game;
    expect(at(0).jumps!.cfg.maxPerSession).toBe(0);
    expect(at(1).jumps!.cfg.maxPerSession).toBe(0);
    expect(at(2).jumps!.cfg.maxPerSession).toBeGreaterThan(0);
    for (const stage of [0, 1, 2, 3]) {
      const c = at(stage).director!.cfg;
      expect(c.glimpseAt, `ступень ${stage}`).toBeLessThanOrEqual(35);
      expect(c.releaseAfterGoals, `ступень ${stage}`).toBe(1);
    }
    for (const stage of [0, 1, 2]) expect(at(stage).director!.cfg.releaseAt).toBe(Infinity);
    expect(at(3).director!.cfg.releaseAt).toBe(300);
    // Приметы — на 1 и 2 (на второй чаще), на 0 и 3 их нет.
    expect(at(0).director!.cfg.traceAt).toBeUndefined();
    expect(at(3).director!.cfg.traceAt).toBeUndefined();
    expect(at(2).director!.cfg.traceAt!).toBeLessThan(at(1).director!.cfg.traceAt!);
  });

  it('ступени 1–2: и приметы — Осыпь проходит вдали за стенами, в углах у её пути грибы; тела у приметы не видно; без вещи охоты нет', () => {
    for (const stage of [1, 2]) {
      const h = new Harness(levelOf(SEED), { stage, calm: false });
      const g = h.game;
      g.jumps!.cooldown = 1e6;
      expect(h.until(() => g.swarm!.mode === 'trace', 160), `ступень ${stage}: приметы нет`).toBe(true);
      const sw = g.swarm!;
      // Она вдали: не ближе четырёх узлов пути от игрока.
      expect(sw.route(sw.node, g.playerNode()).length - 1, `ступень ${stage}`).toBeGreaterThanOrEqual(4);
      let shown = 0;
      let body = 0;
      let near = 0;
      for (let i = 0; i < 30 * 60; i++) {
        h.tick();
        expect(['hunt', 'stalk', 'roam', 'cohere']).not.toContain(sw.mode);
        if (sw.mode !== 'trace') continue;
        shown += 1;
        if (h.r.swarm.alpha > 0) body += 1;
        if (g.swarmNear > 0) near += 1;
      }
      expect(shown).toBeGreaterThan(0);
      expect(body, `ступень ${stage}: у приметы нарисовано тело`).toBe(0);
      expect(near, `ступень ${stage}: примета близко`).toBe(0);
      expect(g.spores!.sites.some((q) => q.kind === 'corner' && q.grow > 0.1), `ступень ${stage}: грибов в углах нет`).toBe(true);
      expect(releases(h)).toBe(0);
    }
  });

  it('примета у начала не становится настоящей Осыпью, когда игрока возвращает в начало', () => {
    const h = new Harness(levelOf(SEED), { stage: 2 });
    const g = h.game;
    g.jumps!.cooldown = 1e6;
    h.until(() => g.transition === null, 6);
    h.run(1);
    const sw = g.swarm!;
    const home = g.playerNode();
    sw.trace(sw.nodeAround(home, 2, 4), 26);
    expect(sw.mode).toBe('trace');
    expect(g.beginJump({ cause: 'faint', style: 'blackout', to: 'elsewhere', dest: 'start' }, [])).toBe(true);
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    expect(sw.mode).toBe('dormant');
    h.run(5);
    expect(['dormant', 'trace']).toContain(sw.mode);
  });

  it('ступень 3: Осыпь сначала мелькает силуэтом (в первую минуту), охотится не раньше пятой минуты', () => {
    const h = new Harness(levelOf(SEED), { stage: 3, calm: false });
    // Скачки на этой ступени есть, но здесь проверяется Осыпь: в кармане режиссёр стоит, и стоящего игрока не уносим.
    h.game.jumps!.cooldown = 1e6;
    expect(h.until(() => glimpses(h) > 0, 75), 'силуэта нет').toBe(true);
    expect(releases(h)).toBe(0);
    h.run(Math.max(0, 295 - h.game.session!.time));
    expect(releases(h)).toBe(0);
    expect(h.until(() => releases(h) > 0, 30), 'охоты нет').toBe(true);
  });

  it('вспомнил — свет памяти вспыхивает на всю комнату (мягко) и гаснет вместе с вещью', () => {
    const h = new Harness(levelOf(SEED));
    const { id } = h.reveal();
    expect(h.standBefore(id)).toBe(true);
    const pos = [...h.game.things.list.find((x) => x.id === id)!.pos];
    let base = 0;
    while (h.count('recall') === 0 && h.game.session!.time < 60) {
      h.tick();
      if (h.count('recall') === 0) base = Math.max(base, h.r.memLight?.strength ?? 0);
    }
    expect(h.count('recall')).toBe(1);
    expect(base).toBeGreaterThan(0);
    let peak = 0;
    for (let i = 0; i < Math.round(1.5 / STEP); i++) {
      h.tick();
      peak = Math.max(peak, h.r.memLight?.strength ?? 0);
    }
    // Вспышки мягкие (партнёр 19.11): в пике свет памяти в полтора раза ярче, а не в три с половиной.
    expect(peak).toBeGreaterThan(base * 1.4);
    // Через несколько секунд вспышка прошла и свет у вспомненной вещи погас (у следующей искомой вещи он может гореть).
    h.run(6);
    const now = h.r.memLight;
    expect(now === null || Math.hypot(now.pos[0]! - pos[0]!, now.pos[2]! - pos[2]!) > 0.5).toBe(true);
  });

  it('телефон: луч чуть липнет к искомой вещи — у вещи палец ведёт его медленнее, вдали — как обычно', () => {
    const h = new Harness(levelOf(SEED));
    const g = h.game;
    const { id } = h.reveal();
    expect(h.standBefore(id)).toBe(true);
    h.tick();
    g.stickyAim = true;
    const y0 = g.aimYaw;
    g.look(0.01, 0);
    const near = g.aimYaw - y0;
    g.aimYaw += 1.4;
    h.tick();
    const y1 = g.aimYaw;
    g.look(0.01, 0);
    const far = g.aimYaw - y1;
    expect(near).toBeLessThan(0.01 * 0.75);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeCloseTo(0.01, 9);
    // За стеной не липнет: иначе палец нащупывал бы спрятанную вещь — компас, которого у мыши нет (замечание куратора).
    g.aimYaw -= 1.4;
    h.tick();
    const cam = (g as unknown as { lastRig: { camPos: number[] } }).lastRig.camPos;
    const tp = g.things.list.find((x) => x.id === id)!.pos;
    const mid = [0, 1, 2].map((k) => cam[k]! + (tp[k]! + (k === 1 ? 0.3 : 0) - cam[k]!) * 0.5);
    g.colliders.addBox(mid[0]! - 0.3, mid[1]! - 0.6, mid[2]! - 0.3, mid[0]! + 0.3, mid[1]! + 0.6, mid[2]! + 0.3);
    h.tick();
    const yw = g.aimYaw;
    g.look(0.01, 0);
    expect(g.aimYaw - yw).toBeCloseTo(0.01, 9);
    g.aimYaw += 1.4;
    // Без липкого луча (компьютер) — всегда как есть.
    g.stickyAim = false;
    g.aimYaw -= 1.4;
    h.tick();
    const y2 = g.aimYaw;
    g.look(0.01, 0);
    expect(g.aimYaw - y2).toBeCloseTo(0.01, 9);
  });
});


describe('кривая ощущений в игре (K-11): к концу сессии мир сжимается и плывёт, вспомнил — выдох', () => {
  it('к концу сессии луч и взгляд уже, края кадра темнее, цвета плывут; в кармане кадр её не знает', () => {
    const h = new Harness(levelOf(SEED));
    h.game.jumps!.cooldown = 1e6;
    h.run(2);
    const v0 = h.r.frames.at(-1)!;
    expect(v0.beamCone).toBeCloseTo(1, 2);
    expect(v0.drift ?? 0).toBe(0);
    // Поздняя сессия: прошло десять минут, четыре вещи из пяти вспомнены (счёт сессии игрока — у игры).
    const raw = h.game as unknown as { feelClock: number; feelDone: number };
    raw.feelClock = 600;
    raw.feelDone = 4;
    h.run(25);
    const v = h.r.frames.at(-1)!;
    expect(v.beamCone!).toBeLessThan(0.9);
    expect(v.gazeCone![0]).toBeLessThan(52 * 0.85);
    expect(v.tunnel).toBeGreaterThan(0.1);
    // Плывёт кадр, а не голова: строки кинескопа дрожат сильнее, камера сама не качается (укачивание −30 %, 17.11).
    expect(h.game.feelNow.drift).toBeGreaterThan(0.3);
    expect(v.crt).toBeGreaterThan(0.3);
    enter(h, 'meadow');
    h.run(1);
    const p = h.r.frames.at(-1)!;
    expect(p.beamCone).toBe(1);
    expect(p.drift ?? 0).toBe(0);
  });

  it('вспомнил вещь — выдох: на несколько секунд луч и взгляд шире обычного', () => {
    const h = new Harness(levelOf(SEED));
    const s = h.game.session!;
    const { id } = h.reveal();
    expect(h.standBefore(id)).toBe(true);
    let wide = 0;
    while (h.count('recall') === 0 && s.time < 660) h.tick();
    expect(h.count('recall')).toBe(1);
    for (let i = 0; i < Math.round(1 / STEP); i++) {
      h.tick();
      wide = Math.max(wide, h.r.frames.at(-1)!.beamCone ?? 1);
    }
    expect(wide).toBeGreaterThan(1.1);
  });

  it('новичку кривая мягче: на ступенях 0–1 сжатие вдвое слабее — ему и так трудно находить вещи (M-20)', () => {
    const at = (stage: number): number => {
      const h = new Harness(levelOf(SEED), { stage });
      const raw = h.game as unknown as { feelClock: number; feelDone: number };
      raw.feelClock = 600;
      raw.feelDone = 5;
      h.run(30);
      return 1 - h.game.feelNow.gaze;
    };
    const full = at(STAGE_ALL);
    expect(full).toBeGreaterThan(0.2);
    // Ступень 1: холодного старта нет — луг не уносит игрока посреди замера (на ступени 0 он здесь бы и случился).
    expect(at(1)).toBeCloseTo(full / 2, 2);
  });

  it('сон из сцен: кривая копится через все сцены сессии и сбрасывается только с новой сессией игрока (противоречие 196)', () => {
    const h = new Harness(levelOf(SEED));
    const g = h.game;
    const raw = g as unknown as { feelClock: number; feelDone: number; loadingScene: boolean };
    raw.feelClock = 200;
    raw.feelDone = 2;
    g.feel.level = 0.6;
    // Следующая сцена — та же сессия игрока.
    raw.loadingScene = true;
    g.loadLevel(levelOf(SEED + 1), { seed: SEED + 1, known: new Set() });
    raw.loadingScene = false;
    expect(g.feel.level).toBe(0.6);
    expect(raw.feelDone).toBe(2);
    // Новая сессия игрока — с чистого листа.
    g.loadLevel(levelOf(SEED + 2), { seed: SEED + 2, known: new Set() });
    expect(g.feel.level).toBe(0);
    expect(raw.feelClock).toBe(0);
    expect(raw.feelDone).toBe(0);
  });
});

describe('телефон: белая вспышка скачка короче (предложение 17.11, T-22)', () => {
  it('на телефоне выбеливание вдвое короче, на компьютере — как было', () => {
    const ready = (h: Harness): Harness => (expect(h.until(() => h.game.transition === null, 5)).toBe(true), h);
    const pc = ready(new Harness(levelOf(SEED)));
    expect(pc.game.beginJump({ cause: 'gaze', style: 'whiteout', to: 'meadow' }, [])).toBe(true);
    expect([pc.game.transition!.out, pc.game.transition!.back]).toEqual([0.4, 1.2]);
    const phone = ready(new Harness(levelOf(SEED)));
    phone.game.phone = true;
    expect(phone.game.beginJump({ cause: 'gaze', style: 'whiteout', to: 'meadow' }, [])).toBe(true);
    expect([phone.game.transition!.out, phone.game.transition!.back]).toEqual([0.3, 0.6]);
    // Остальные виды скачка на телефоне не меняются.
    const cut = ready(new Harness(levelOf(SEED)));
    cut.game.phone = true;
    expect(cut.game.beginJump({ cause: 'gaze', style: 'cut', to: 'meadow' }, [])).toBe(true);
    expect([cut.game.transition!.out, cut.game.transition!.back]).toEqual([0.18, 0.45]);
  });
});

describe('тихий слой точек по рёбрам — только на поздних кругах, где стены уже стёрты (слова партнёра 17.11)', () => {
  it('пока стены целы, точечных граней нет вовсе; когда петля стёрла стены — слой есть (где именно — решает маска стирания в шейдере)', () => {
    const fresh = new Harness(levelOf(SEED));
    fresh.run(2);
    expect(fresh.game.decay.walls).toBe(0);
    expect(fresh.r.frames.at(-1)!.quiet ?? 0).toBe(0);
    // Четвёртый круг: потолок уже выпадает, стены ещё целы — граней нет.
    const lap4 = new Harness(levelOf(SEED));
    lap4.game.wearBase = 0.42;
    lap4.run(2);
    expect(lap4.game.decay.walls).toBe(0);
    expect(lap4.r.frames.at(-1)!.quiet ?? 0).toBe(0);
    // Шестой круг: стены наполовину в кружево — точки проступают там, где стен уже нет.
    const lap6 = new Harness(levelOf(SEED));
    lap6.game.wearBase = 0.7;
    lap6.run(2);
    expect(lap6.game.decay.walls).toBeGreaterThan(0.1);
    expect(lap6.r.frames.at(-1)!.quiet!).toBeGreaterThan(0);
  });
});

describe('в темноте вещь меняется только вне кадра (K-21; уроки Frictional Games — следствие, а не событие; аудит 17.11)', () => {
  it('в темноте мелочи переставляются, но та, на которую смотрят, стоит как стояла', () => {
    const h = new Harness(levelOf(SEED));
    const g = h.game;
    g.jumps!.cooldown = 1e6;
    h.run(1);
    const small = g.things.list.filter((x) => !x.memory && !x.still && x.state === 'idle' && x.collider < 0);
    const target = small.find((x) => h.standBefore(x.id));
    expect(target, 'не нашлось мелочи, перед которой можно встать').toBeTruthy();
    const t = target!;
    expect(g.seen([t.pos[0], t.pos[1] + t.radius * 0.6, t.pos[2]], t.radius)).toBe(true);
    const before = new Map(g.things.list.map((x) => [x.id, { pos: [...x.pos], yaw: x.yaw }]));
    // Погасить фонарь и стоять в темноте: перестановки идут на 7-й и 16-й секунде.
    h.tick({ ...emptyInput(), light: true });
    expect(g.light.state).toBe('off');
    h.run(18);
    expect(t.pos).toEqual(before.get(t.id)!.pos);
    expect(t.yaw).toBe(before.get(t.id)!.yaw);
    // А вне кадра место за это время поменялось.
    const moved = g.things.list.filter((x) => x.id !== t.id && (x.yaw !== before.get(x.id)?.yaw || x.pos.some((v, i) => v !== before.get(x.id)?.pos[i])));
    expect(moved.length, 'вне кадра ничего не поменялось').toBeGreaterThan(0);
  });

  it('мигание фонаря — не «свет погас»: тронутая вещь не собирается от кадра темноты, а от настоящей темноты — собирается', () => {
    const h = new Harness(levelOf(SEED));
    const g = h.game;
    g.jumps!.cooldown = 1e6;
    h.run(1);
    const t = g.things.list.find((x) => !x.memory && !x.still && x.state === 'idle' && x.collider < 0 && h.standBefore(x.id))!;
    expect(t).toBeTruthy();
    g.things.touch(t);
    t.touched = true;
    h.until(() => t.state === 'gone', 4);
    expect(t.state).toBe('gone');
    // Кадр темноты (мигание) — вещь не вернулась.
    g.light.toggle();
    h.tick();
    g.light.toggle();
    h.run(1.5);
    expect(t.state).toBe('gone');
    // Темнота на полсекунды и свет — вернулась.
    g.light.toggle();
    h.run(0.6);
    g.light.toggle();
    expect(h.until(() => t.state !== 'gone', 2), 'после темноты вещь не вернулась').toBe(true);
  });
});

describe('выключатель по заглохшему фонарю (17.11 12:15)', () => {
  it('нажатие по заглохшему фонарю — стук: щелчка выключателя нет, фонарь не включается, тряска получила толчок', () => {
    const h = new Harness(levelOf(SEED));
    h.run(1);
    h.game.light.forceFail();
    expect(h.game.light.state).toBe('dead');
    const ev = h.game.step(STEP, { ...emptyInput(), light: true });
    expect(ev.lightToggled).toBe(false);
    expect(ev.lightKnock).toBe(true);
    expect(h.game.light.state).toBe('dead');
    // Горящий — обычный щелчок.
    const g = new Harness(levelOf(SEED));
    g.run(1);
    expect(g.game.light.state).toBe('on');
    const on = g.game.step(STEP, { ...emptyInput(), light: true });
    expect(on.lightToggled).toBe(true);
    expect(on.lightKnock).toBe(false);
    expect(g.game.light.state).toBe('off');
  });
});

describe('белая комната: задел цепь — камеру перекручивает, мир широкоугольный пять секунд (партнёр 21.11, 19:06)', () => {
  /** Сид убежища, где белая комната есть (жребий — whiteRolled). */
  const withWhite = (): BuiltLevel => {
    for (let s = 1000; s < 1400; s += 37) {
      const l = buildLevel(generateLayout(s, 2));
      if (l.whiteRoom) return l;
    }
    throw new Error('нет уровня с белой комнатой');
  };
  const level = withWhite();
  const w = level.whiteRoom!;
  const ahead = (d: number): [number, number] => [w.chain.at[0] + w.chain.face[0] * d, w.chain.at[2] + w.chain.face[1] * d];
  const yawTo = (fx: number, fz: number): number => Math.atan2(-fx, -fz);

  it('в комнате — даль белеет и место собирается взглядом; за дверью — нет', () => {
    const h = new Harness(level);
    const [x, z] = ahead(1.2);
    h.game.teleport(x, w.y[0] + 0.05, z, yawTo(-w.chain.face[0], -w.chain.face[1]), 0);
    h.run(2);
    expect(h.game.whiteness).toBeGreaterThan(0.95);
    const f = h.r.frames.at(-1)!;
    expect(f.white?.box).toEqual(w.box);
    expect(f.whiteIn).toBeGreaterThan(0.95);
    expect(f.fogColor[0]).toBeGreaterThan(0.7);
    // Никакого перекрута, пока цепи не касались.
    expect(f.fov ?? 1).toBe(1);
    expect(h.dreamCount('warp')).toBe(0);
  });

  it('шаг в цепь — перекрут: оборот камеры за 1,4 с, обзор шире полутора секунд до пятой, потом сходится', () => {
    const h = new Harness(level);
    const [x, z] = ahead(1.2);
    const yaw = yawTo(-w.chain.face[0], -w.chain.face[1]);
    // Переход начала сессии (1,6 с) должен кончиться: во время перехода цепь не срабатывает.
    h.run(2);
    h.game.teleport(x, w.y[0] + 0.05, z, yaw, 0);
    h.run(0.3);
    // Идти вперёд, пока не заденет.
    for (let i = 0; i < Math.round(6 / STEP) && h.dreamCount('warp') === 0; i++) h.tick({ ...emptyInput(), moveZ: 1 });
    expect(h.dreamCount('warp')).toBe(1);
    const f0 = h.game.warpNow();
    expect(f0.open).toBeLessThan(0.5);
    h.run(1.5);
    const f1 = h.game.warpNow();
    expect(Math.abs(Math.abs(f1.roll) - Math.PI * 2)).toBeLessThan(0.05);
    expect(f1.fov).toBeGreaterThan(1.45);
    expect(h.r.frames.at(-1)!.fov).toBeGreaterThan(1.45);
    h.run(2.5);
    expect(h.game.warpNow().fov).toBeGreaterThan(1.45);
    h.run(2.2);
    expect(h.game.warpNow().fov).toBe(1);
    // Перекрут был один, хоть герой и стоял в цепи.
    expect(h.dreamCount('warp')).toBe(1);
  });

  it('тихий режим (меньше движения): без оборота, обзор вполовину шире', () => {
    const h = new Harness(level);
    h.game.calmMotion = true;
    h.game.forceWarp();
    h.run(1);
    const f = h.game.warpNow();
    expect(Math.abs(f.roll)).toBeLessThan(0.13);
    expect(f.fov).toBeGreaterThan(1.2);
    expect(f.fov).toBeLessThan(1.3);
  });

  it('грибов Осыпи в белой комнате нет', () => {
    const h = new Harness(level);
    const inBox = (p: readonly number[]): boolean => p[0]! > w.box[0] && p[0]! < w.box[2] && p[2]! > w.box[1] && p[2]! < w.box[3] && p[1]! > w.y[0] - 0.5 && p[1]! < w.y[1];
    const sites = (h.game as unknown as { spores: { sites: { pos: number[] }[] } | null }).spores?.sites ?? [];
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.filter((s) => inBox(s.pos)).length).toBe(0);
  });
});

describe('песчаный зал: шаг в чёрный проём — стоишь в проёме огромного зала тем же шагом; обратно — так же (партнёр 21.11, 19:13)', () => {
  /** Уровень убежища с чёрным проёмом (жребий — dunesRolled). */
  const withDunes = (): BuiltLevel => {
    for (let s = 2000; s < 3600; s += 41) {
      const l = buildLevel(generateLayout(s, 2));
      if (l.duneDoor) return l;
    }
    throw new Error('нет уровня с чёрным проёмом');
  };
  const level = withDunes();
  const d = level.duneDoor!;
  const yawOf = (x: number, z: number): number => Math.atan2(-x, -z);
  const turn = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const walkIn = (h: Harness): void => {
    // Переход начала сессии должен кончиться: во время перехода шов не срабатывает.
    h.run(2);
    h.game.teleport(d.at[0] - d.n[0] * 1.6, d.y, d.at[1] - d.n[1] * 1.6, yawOf(d.n[0], d.n[1]), 0);
    h.run(0.2);
    for (let i = 0; i < Math.round(4 / STEP) && h.game.where === 'main'; i++) h.tick({ ...emptyInput(), moveZ: 1 });
  };

  it('вошёл — уже в зале: без перехода, вспышки и прыжка времени; смотрит в зал и шагает дальше', () => {
    const h = new Harness(level);
    walkIn(h);
    expect(h.game.where).toBe('pocket');
    expect(h.game.pocket?.kind).toBe('dunes');
    expect(h.game.transition).toBeNull();
    const jumps = h.log.dream.filter((e) => e.type === 'jump');
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps.every((e) => e.type === 'jump' && e.plan.style === 'seam')).toBe(true);
    // Проём зала смотрит в −z: взгляд — туда, тело — за плоскостью проёма, на песке порога.
    expect(Math.abs(turn(h.game.aimYaw))).toBeLessThan(0.06);
    const ex = h.game.pocket!.exit!;
    expect(h.game.body.z).toBeLessThan(ex[2] - 0.3);
    expect(h.game.body.y).toBeGreaterThan(ex[1] + 0.1);
    // Шаг не прервался: скорость сохранена и повёрнута в зал.
    const z0 = h.game.body.z;
    h.run(1, { ...emptyInput(), moveZ: 1 });
    expect(h.game.body.z).toBeLessThan(z0 - 0.8);
    expect(h.game.where).toBe('pocket');
  });

  it('обратно тем же проёмом — снаружи чёрного проёма, лицом от него, тоже без перехода', () => {
    const h = new Harness(level);
    walkIn(h);
    expect(h.game.pocket?.kind).toBe('dunes');
    const ex = h.game.pocket!.exit!;
    h.run(1);
    // Развернуться к проёму (+z) и шагнуть в черноту.
    h.game.teleport(ex[0], h.game.body.y, ex[2] - 1.4, Math.PI, 0);
    h.run(0.2);
    for (let i = 0; i < Math.round(4 / STEP) && h.game.where !== 'main'; i++) h.tick({ ...emptyInput(), moveZ: 1 });
    expect(h.game.where).toBe('main');
    expect(h.game.transition).toBeNull();
    const b = h.game.body;
    const depth = (b.x - d.at[0]) * d.n[0] + (b.z - d.at[1]) * d.n[1];
    expect(depth).toBeLessThan(-0.3);
    expect(depth).toBeGreaterThan(-1.2);
    // Лицом от проёма — наружу.
    expect(Math.abs(turn(h.game.aimYaw - yawOf(-d.n[0], -d.n[1])))).toBeLessThan(0.06);
    expect(h.log.dream.filter((e) => e.type === 'jump').every((e) => e.type === 'jump' && e.plan.style === 'seam')).toBe(true);
    // Рельеф зала ушёл вместе с ним: остался только язык песка у проёма.
    expect(h.game.colliders.fields.filter((f) => f.group?.startsWith('pocket')).length).toBe(0);
  });
});

describe('первые минуты страшнее (Z-19: пятёрка приёмов куратора, квиз «Да, всё»)', () => {
  const swarmEvents = (h: Harness, what: string) => h.log.fear.filter((e) => e.type === 'swarm' && (e as { what?: string }).what === what).length;
  const HUNTING = ['hunt', 'stalk', 'roam', 'cohere'];

  /** Ступень 0, первая вещь пришла; игрок — в 11–18 м от неё (тёмному уроку нужна даль). */
  function lessonSetup(): { h: Harness; item: Vec3 } {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false });
    const g = h.game;
    const s = g.session!;
    s.rush();
    expect(h.until(() => s.active !== null, 3)).toBe(true);
    h.tick();
    const t = g.things.list.find((x) => x.memory)!;
    const item: Vec3 = [t.pos[0], t.pos[1], t.pos[2]];
    const far = g.level!.nav
      .filter((n) => Math.abs(n.y - item[1]) < 1.5 && n.links.length > 0)
      .map((n) => ({ n, d: Math.hypot(n.x - item[0], n.z - item[2]) }))
      .filter(({ d }) => d > 11 && d < 18)
      .sort((a, b) => a.d - b.d)[0];
    expect(far, 'нет узла в 11–18 м от вещи').toBeTruthy();
    g.teleport(far!.n.x, far!.n.y, far!.n.z);
    return { h, item };
  }

  it('тёмный урок: пришла первая вещь — фонарь глохнет сам; между игроком и вещью её контур сквозь стены; ожил свет — пусто', () => {
    const { h, item } = lessonSetup();
    const g = h.game;
    expect(h.until(() => g.darkLesson?.phase === 'on', 4), 'урок не начался').toBe(true);
    expect(g.light.state).toBe('dead');
    const sw = g.swarm!;
    expect(sw.mode).toBe('apparition');
    // Между: дальше от игрока, чем в шаге, и не над самой вещью.
    const b = g.body;
    const toPlayer = Math.hypot(sw.pos[0] - b.x, sw.pos[2] - b.z);
    expect(toPlayer).toBeGreaterThan(6);
    expect(toPlayer).toBeLessThan(17);
    expect(Math.hypot(sw.pos[0] - item[0], sw.pos[2] - item[2])).toBeGreaterThan(2);
    h.tick();
    expect(h.r.swarm.through, 'контур не виден сквозь стены').toBe(true);
    expect(h.r.swarm.alpha).toBeGreaterThan(0);
    // Это не явление режиссёра: ни строки «оно не даёт проснуться», ни тишины.
    expect(swarmEvents(h, 'apparition')).toBe(0);
    // Не оживил сам — свет возвращается через несколько секунд; контура больше нет.
    const revivedBefore = h.log.all.filter((e) => e.lightRevived).length;
    expect(h.until(() => g.light.state === 'on', 14), 'фонарь не ожил').toBe(true);
    h.tick();
    expect(g.darkLesson!.phase).toBe('done');
    expect(sw.active).toBe(false);
    expect(h.r.swarm.through).toBe(false);
    expect(h.log.all.filter((e) => e.lightRevived).length).toBeGreaterThan(revivedBefore);
    // Урок — один: больше фонарь сам не глохнет.
    let dead = 0;
    for (let i = 0; i < 60; i++) {
      h.run(1);
      if (g.light.state === 'dead') dead += 1;
    }
    expect(dead).toBe(0);
  });

  it('тёмный урок не нужен, если вещь нашли сразу: рядом с ней фонарь не глохнет, вспомнил — урока нет', () => {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false });
    const g = h.game;
    const s = g.session!;
    s.rush();
    h.until(() => s.active !== null, 3);
    recallActive(h);
    h.run(3);
    expect(g.darkLesson!.phase).toBe('skip');
    expect(g.light.state).not.toBe('dead');
  });

  it('урок — только в первом сне (ступень 0)', () => {
    for (const stage of [1, 2, 3, STAGE_ALL]) expect(new Harness(levelOf(SEED), { stage }).game.darkLesson, `ступень ${stage}`).toBeNull();
    expect(new Harness(levelOf(SEED), { stage: 0 }).game.darkLesson?.phase).toBe('wait');
  });

  it('одна охота: луч рассыпал Осыпь — до конца сна только приметы, ни новой охоты, ни явлений', () => {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false });
    const g = h.game;
    const s = g.session!;
    s.rush();
    h.until(() => s.active !== null, 3);
    recallActive(h);
    expect(h.until(() => swarmEvents(h, 'release') > 0, 10 + 5 + GLIMPSE_WAIT + 5), 'охоты нет').toBe(true);
    // Охотится рядом; игрок держит на ней луч.
    const sw = g.swarm!;
    let scattered = false;
    for (const node of nodesInRange(g.level!.nav, g.playerNode(), 2, 4)) {
      sw.activate(node);
      sw.mode = 'hunt';
      sw.cohesion = 1;
      sw.awareness = 1;
      const before = swarmEvents(h, 'scattered');
      for (let i = 0; i < Math.round(3 / STEP) && !scattered; i++) {
        g.aimAt(sw.pos[0], sw.pos[1] + 1.1, sw.pos[2]);
        h.tick();
        scattered = swarmEvents(h, 'scattered') > before;
      }
      if (scattered) break;
    }
    expect(scattered, 'Осыпь не удалось рассыпать лучом').toBe(true);
    expect(g.director!.isSettled).toBe(true);
    h.run(2);
    expect(sw.active, 'рассыпанная не затихла').toBe(false);
    const glimpsed = swarmEvents(h, 'apparition');
    let traced = false;
    for (let i = 0; i < Math.round(150 / STEP); i++) {
      h.tick();
      expect(HUNTING).not.toContain(sw.mode);
      if (sw.mode === 'trace') traced = true;
    }
    expect(traced, 'приметы нет').toBe(true);
    expect(swarmEvents(h, 'release')).toBe(1);
    expect(swarmEvents(h, 'apparition')).toBe(glimpsed);
  });

  it('одна охота: поймала — после возврата в начало она не выходит снова', () => {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false });
    const g = h.game;
    const s = g.session!;
    s.rush();
    h.until(() => s.active !== null, 3);
    recallActive(h);
    expect(h.until(() => swarmEvents(h, 'release') > 0, 10 + 5 + GLIMPSE_WAIT + 5), 'охоты нет').toBe(true);
    const sw = g.swarm!;
    const b = g.body;
    sw.activate(sw.nodeAround(g.playerNode(), 3, 4));
    sw.mode = 'hunt';
    sw.cohesion = 1;
    sw.awareness = 1;
    g.aimAt(2 * b.x - sw.pos[0], b.y + 1.4, 2 * b.z - sw.pos[2]);
    expect(h.until(() => swarmEvents(h, 'caught') > 0, 25), 'Осыпь не поймала').toBe(true);
    expect(h.until(() => g.transition === null, 6)).toBe(true);
    expect(g.director!.isSettled).toBe(true);
    for (let i = 0; i < Math.round(80 / STEP); i++) {
      h.tick();
      expect(HUNTING).not.toContain(sw.mode);
    }
  });

  it('тишина как знак: за полторы-две секунды до первого явления звук места проседает почти в ноль, потом возвращается', () => {
    const h = new Harness(levelOf(SEED), { stage: 0, calm: false, cfg: { ...QUICK, firstDelay: 999, fallback: 999 } });
    const g = h.game;
    const [sx, sy, sz] = g.level!.spawn.pos;
    const eye: Vec3 = [sx, sy + 1.5, sz];
    const far = g.level!.nav
      .filter((n) => Math.abs(n.y - sy) < 1)
      .map((n) => ({ n, d: Math.hypot(n.x - sx, n.z - sz) }))
      .filter(({ n, d }) => d > 7 && g.colliders.raycast(eye[0], eye[1], eye[2], (n.x - sx) / d, (n.y + 1.3 - eye[1]) / d, (n.z - sz) / d, d) >= d - 0.5)
      .sort((a, b) => b.d - a.d)[0];
    expect(far).toBeTruthy();
    g.aimAt(far!.n.x, sy + 1.4, far!.n.z);
    const levels: number[] = [];
    let at = -1;
    for (let i = 0; i < Math.round(40 / STEP); i++) {
      h.tick();
      levels.push(g.hush);
      if (at < 0 && swarmEvents(h, 'apparition') > 0) at = i;
    }
    expect(at, 'явления не было').toBeGreaterThan(0);
    // Задолго до явления — звук как есть.
    expect(levels[Math.max(0, at - Math.round(4 / STEP))]).toBe(0);
    // К явлению — почти тишина.
    expect(levels[at - 1]!).toBeGreaterThan(0.85);
    // Через несколько секунд — звук вернулся.
    expect(levels[at + Math.round(7 / STEP)]!).toBeLessThan(0.05);
  });
});

describe('первый сон — один на всех (Z-19: «ставить руками, как уровень», тест-сторож)', () => {
  /** Первый сон новичка: сид из свежего профиля, ранг 1, убежище, без стирания — как его собирает приложение (app.ts, prepare). */
  function firstDream(): { h: Harness; seed: number } {
    const profile = defaultProfile(20041113);
    const mem = memoryFor(profile, 'shelter');
    const level = buildLevel(generateLayout(mem.seed, mem.rank, 'shelter'), { wear: mem.wear });
    const h = new Harness(level, { stage: 0, seed: mem.seed });
    return { h, seed: mem.seed };
  }

  it('сид и состав первого сна не меняются молча: особые помещения — на пути новичка, на верхнем ярусе', () => {
    const { h, seed } = firstDream();
    expect(seed).toBe(1621708126);
    const g = h.game;
    const level = g.level!;
    const layout = level.layout!;
    const fx = (g as unknown as { roomFx: Map<number, string> }).roomFx;
    const nav = level.nav;
    const top = nav[g.playerNodeAtSpawn()]!.tier;
    const sig = {
      rooms: layout.rooms.length,
      tiers: layout.tierCount,
      types: layout.rooms.map((r) => r.type).join(','),
      fx: [...fx.entries()].sort((a, b) => a[0] - b[0]).map(([room, f]) => `${layout.rooms[room]!.type}:${f}:${layout.rooms[room]!.tier}`),
      // Чудеса места — где (тип помещения и ярус) или нет.
      white: level.whiteRoom ? `${layout.rooms[level.whiteRoom.room]!.type}:${layout.rooms[level.whiteRoom.room]!.tier}` : null,
      dunes: level.duneDoor ? `${layout.rooms[level.duneDoor.room]!.type}:${layout.rooms[level.duneDoor.room]!.tier}` : null,
      sky: level.skyRoom !== undefined ? `${layout.rooms[level.skyRoom]!.type}:${layout.rooms[level.skyRoom]!.tier}` : null,
      green: level.greenRoom !== undefined ? `${layout.rooms[level.greenRoom]!.type}:${layout.rooms[level.greenRoom]!.tier}` : null,
      grass: level.grassRoom !== undefined ? `${layout.rooms[level.grassRoom]!.type}:${layout.rooms[level.grassRoom]!.tier}` : null,
    };
    // Правка генератора, раздачи или чудес меняет начало всем новичкам — пусть это будет решение, а не случайность: тогда
    // поправить и этот снимок (и пройти первый сон глазами).
    expect(sig).toEqual({
      rooms: 21,
      tiers: 2,
      types: 'entrance,airlock,corridor,stairwell,stairwell,dorm,living,command,kitchen,medical,hallway,washroom,storage,corridor,fvu,diesel,bedroom,tanks,bathroom,switchboard,storage',
      fx: ['command:dark:0', 'storage:strobe:0'],
      // 24.11: белая комната — только квадратная (партнёр), поэтому она переехала в дизельную, а песчаный зал — в щитовую.
      white: 'diesel:1',
      dunes: 'switchboard:1',
      sky: 'bedroom:1',
      green: 'fvu:1',
      grass: 'hallway:0',
    });
    // На пути: строб и «тёмное» — на верхнем ярусе; «тонких» (на ступени 0 они молчат) и «сеточных» (их «не стой» — давление,
    // а его до второй ступени нет) нет.
    for (const want of ['strobe', 'dark']) {
      expect([...fx.entries()].some(([room, f]) => f === want && layout.rooms[room]!.tier === top), want).toBe(true);
    }
    expect([...fx.values()]).not.toContain('thin');
    expect([...fx.values()]).not.toContain('wire');
  });
});

describe('метаслой: обрывок на экспонате в лимбо (партнёр 21.11, 19:09; квиз «Одна находка за сон»)', () => {
  /** Пройти сессию до лимбо: все пять вещей вспомнены. */
  function toLimbo(): Harness {
    const h = new Harness(levelOf(SEED), { seed: 3 });
    const g = h.game;
    for (let i = 0; i < 5; i++) {
      expect(h.until(() => g.session!.active !== null, 6)).toBe(true);
      recallActive(h);
    }
    expect(h.until(() => h.dreamCount('limbo') > 0, 14)).toBe(true);
    return h;
  }

  it('экспонат, на который посмотрели, вспоминает обрывок — один раз; пока обрывок на экране, лимбо не уходит в следующий сон', () => {
    const h = toLimbo();
    const g = h.game;
    g.metaWanted = true;
    g.queueSession(levelOf(SEED + 1, 2), { seed: 99, known: new Set(g.archive) });
    // Смотрим на ближний экспонат.
    const b = g.body;
    const ex = g.things.list.filter((t) => t.still).sort((p, q) => Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z) - Math.hypot(q.pos[0] - b.x, q.pos[2] - b.z))[0]!;
    expect(ex).toBeTruthy();
    expect(h.standBefore(ex.id)).toBe(true);
    expect(h.until(() => h.dreamCount('meta') > 0, 6), 'обрывка нет').toBe(true);
    expect(g.metaHold).toBe(true);
    // Обрывок на экране: лимбо держится и после своих секунд.
    h.run(14);
    expect(g.where).toBe('limbo');
    expect(h.dreamCount('begin')).toBe(0);
    // Обрывок ушёл — лимбо отпускает; второго обрывка в этом лимбо нет.
    g.metaHold = false;
    expect(h.until(() => h.dreamCount('begin') > 0, 6)).toBe(true);
    expect(h.dreamCount('meta')).toBe(1);
  });

  it('не хочет приложение — экспонаты молчат; не посмотрел — лимбо ждёт обрывка на несколько секунд дольше и уходит без него', () => {
    const h = toLimbo();
    const g = h.game;
    g.queueSession(levelOf(SEED + 1, 2), { seed: 99, known: new Set(g.archive) });
    // Часы игры с новой сессией идут заново — меряем шагами.
    const t0 = h.log.all.length;
    expect(h.until(() => h.dreamCount('begin') > 0, 16)).toBe(true);
    expect(h.dreamCount('meta')).toBe(0);
    const plain = (h.log.all.length - t0) * STEP;
    // Тот же лимбо, но обрывок ждёт взгляда, а игрок смотрит в пустоту.
    const h2 = toLimbo();
    const g2 = h2.game;
    g2.metaWanted = true;
    g2.queueSession(levelOf(SEED + 1, 2), { seed: 99, known: new Set(g2.archive) });
    const b = g2.body;
    g2.aimAt(b.x, b.y + 30, b.z + 0.01);
    const t1 = h2.log.all.length;
    expect(h2.until(() => h2.dreamCount('begin') > 0, 20)).toBe(true);
    expect(h2.dreamCount('meta')).toBe(0);
    expect((h2.log.all.length - t1) * STEP).toBeGreaterThan(plain + 2);
  });
});

describe('крупная искомая вещь не врастает в обстановку (партнёр 24.11: «проверить, что все вещи, которые стоит найти, не конфликтуют с другими предметами»)', () => {
  /** Задевает ли след вещи (круг по полу, от щиколотки до верха) чужую преграду — мебель, стену, другую вещь. */
  const hits = (g: Game, t: Thing): string[] => {
    const spec = ALL_PROPS[t.kind]!;
    // Вещь стоит по сторонам света (поворот — четверть оборота с поправкой меньше 0,05 рад): след — её прямоугольник.
    const turned = Math.abs(Math.sin(t.yaw)) > 0.5;
    const hx = (turned ? spec.d : spec.w) / 2;
    const hz = (turned ? spec.w : spec.d) / 2;
    const [x, y, z] = t.pos;
    const out: string[] = [];
    for (const b of g.colliders.boxes) {
      if (b.off || b.gone || b.owner === -t.id) continue;
      if (b.maxY <= y + 0.06 || b.minY >= y + spec.h) continue;
      if (b.maxX <= x - hx || b.minX >= x + hx || b.maxZ <= z - hz || b.minZ >= z + hz) continue;
      out.push(`[${b.minX.toFixed(2)},${b.minY.toFixed(2)},${b.minZ.toFixed(2)}..${b.maxX.toFixed(2)},${b.maxY.toFixed(2)},${b.maxZ.toFixed(2)}]`);
    }
    return out;
  };
  const cases: [string, 'office' | 'yellow', number][] = [];
  OFFICE_CHAIN.forEach((m, i) => {
    if ((ALL_PROPS[m.thing]?.h ?? 0) > 0.5) cases.push([m.thing, 'office', i]);
  });
  YELLOW_CHAIN.forEach((m, i) => {
    if ((ALL_PROPS[m.thing]?.h ?? 0) > 0.5) cases.push([m.thing, 'yellow', i]);
  });

  it('в цепочках офиса и жёлтых комнат крупные вещи есть (иначе проверять нечего)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it.each(cases)('%s (%s): на полу и мимо мебели и стен — на восьми сидах', (_thing, world, chainAt) => {
    const bad: string[] = [];
    for (const seed of [3, 5, 7, 11, 13, 17, 19, 23]) {
      const level = buildLevel(generateLayout(SEED + seed, 2, world), { wear: 0 });
      const h = new Harness(levelOf(SEED), { seed, cfg: QUICK });
      h.game.loadLevel(level, { seed, known: new Set(), chainAt });
      h.reveal();
      const t = h.game.things.list.find((x) => x.memory)!;
      const sp = h.game.session!.active!.spot!;
      if (sp.kind !== 'floor') bad.push(`сид ${seed}: место «${sp.kind}»`);
      const hit = hits(h.game, t);
      if (hit.length > 0) bad.push(`сид ${seed}: задевает ${hit.length}: ${hit.slice(0, 2).join(' ')}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('мелкая искомая вещь парит, но не в то, что над ней (разбор куратора, 426: навесной шкаф, следующая полка)', () => {
  const small: [string, 'office' | 'yellow' | 'shelter', number][] = [];
  SHELTER_CHAIN.forEach((m, i) => {
    if ((ALL_PROPS[m.thing]?.h ?? 0) <= 0.5) small.push([m.thing, 'shelter', i]);
  });
  OFFICE_CHAIN.forEach((m, i) => {
    if ((ALL_PROPS[m.thing]?.h ?? 0) <= 0.5) small.push([m.thing, 'office', i]);
  });
  YELLOW_CHAIN.forEach((m, i) => {
    if ((ALL_PROPS[m.thing]?.h ?? 0) <= 0.5) small.push([m.thing, 'yellow', i]);
  });

  it.each(small)('%s (%s): над вещью до первой преграды не меньше её высоты — на двенадцати сидах', (_thing, world, chainAt) => {
    const bad: string[] = [];
    for (const seed of [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41]) {
      const level = buildLevel(generateLayout(SEED + seed, 2, world), { wear: 0 });
      const h = new Harness(levelOf(SEED), { seed, cfg: QUICK });
      h.game.loadLevel(level, { seed, known: new Set(), chainAt });
      h.reveal();
      const t = h.game.things.list.find((x) => x.memory)!;
      const ht = ALL_PROPS[t.kind]?.h ?? 0.25;
      const [x, y, z] = t.pos;
      const up = h.game.colliders.raycast(x, y + 0.02, z, 0, 1, 0, 3);
      // Внутри мебели (полка в шкафу) луч упирается сразу: там вещь лишь чуть приподнята, это проверяет floatLift.
      if (up >= 0.01 && up < ht - 0.02) bad.push(`сид ${seed}: над вещью ${up.toFixed(2)} м при высоте ${ht.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });
});
