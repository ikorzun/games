/**
 * Сессия: одна вылазка в подсознание. Заданий на входе нет — они приходят по ходу, как вспышки
 * воспоминаний («чайник. ты оставил его на плите»), по одному. Вещь из воспоминания появляется где-то
 * далеко; найти её и подержать в луче — значит вспомнить. Когда вспомнено всё, сессия кончается.
 *
 * Здесь же паника и опасности среды. Смерти нет: провал, газ и рой не обрывают сессию, а выбрасывают
 * игрока в другое место (это решает игра по событиям отсюда). Чистая логика без three.js и DOM.
 */
import { clamp01 } from '../core/math';
import { hash2, mulberry32 } from '../core/rng';
import type { Rng } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { BuiltLevel, CollapseSpec, ItemSpot, Zone } from '../world/level';
import { looksAt } from './things';

/** Воспоминание: id — ключ текстов в локалях (mem.<id>.flash / .task / .done), thing — вещь-образ. */
export interface MemoryDef {
  id: string;
  thing: string;
}

export const MEMORIES: readonly MemoryDef[] = [
  { id: 'kettle', thing: 'kettle' },
  { id: 'iron', thing: 'iron' },
  { id: 'phone', thing: 'phone' },
  { id: 'keys', thing: 'keys' },
  { id: 'teddy', thing: 'teddy' },
  { id: 'slippers', thing: 'slippers' },
  { id: 'alarm', thing: 'alarm_clock' },
  { id: 'mug', thing: 'mug' },
  { id: 'photo', thing: 'photo_frame' },
  { id: 'call', thing: 'rotary_phone' },
  { id: 'nightlight', thing: 'night_light' },
  { id: 'bag', thing: 'school_bag' },
  { id: 'cake', thing: 'birthday_cake' },
  { id: 'ball', thing: 'ball' },
  { id: 'fish', thing: 'goldfish_bowl' },
  { id: 'remote', thing: 'remote' },
];

export interface Memory {
  def: MemoryDef;
  index: number;
  /** hidden — ещё не пришло; active — надо найти; done — вспомнено. */
  state: 'hidden' | 'active' | 'done';
  /** Где лежит вещь (появляется вместе с воспоминанием). */
  spot: ItemSpot | null;
}

export interface SessionConfig {
  /** Сколько воспоминаний в сессии. */
  count: number;
  /** Через сколько секунд после начала может прийти первое. */
  firstDelay: number;
  /** Пауза между «вспомнил» и следующей вспышкой, с. */
  delay: number;
  /** Если повода (наблюдения) всё нет — воспоминание приходит само через столько секунд сверх паузы. */
  fallback: number;
  /** С какого расстояния вещь можно рассмотреть, м. */
  lookRange: number;
  /** Сколько держать её в луче, с. */
  lookTime: number;
  /** Вещь появляется не ближе и не дальше стольких клеток пути от игрока. */
  minCells: number;
  maxCells: number;
  /** Сколько секунд в газу до обморока. */
  faintTime: number;
}

/**
 * Пять воспоминаний с паузами 30 + 4 × 40 с — одно ожидание даёт больше трёх минут, а за каждой вещью
 * ещё надо дойти (не ближе семи клеток пути): сессия не бывает короче пяти минут даже у того, кто
 * идёт прямо к цели.
 */
export const DEFAULT_SESSION: SessionConfig = { count: 5, firstDelay: 30, delay: 40, fallback: 25, lookRange: 6, lookTime: 1.6, minCells: 7, maxCells: 16, faintTime: 5.5 };

export interface SessionInput {
  /** Ступни игрока. */
  pos: Vec3;
  /** Камера и направление луча (единичный вектор). */
  eye: Vec3;
  aim: Vec3;
  /** Яркость фонаря, 0..1. */
  light: number;
  /** Узел навигации под игроком (−1 — он вне убежища: в карманном пространстве). */
  node: number;
  /** Близость роя, 0..1. */
  swarm: number;
  /** В этом шаге случилось наблюдение: игрок всмотрелся в вещь или только что вернулся из скачка. */
  observed: boolean;
  /** Скорость удара о землю в этом шаге (0 — приземления не было). */
  landed: number;
}

export type SessionEvent =
  | { type: 'reveal'; memory: Memory }
  | { type: 'recall'; memory: Memory }
  | { type: 'forgot'; memory: Memory }
  | { type: 'all-done' }
  | { type: 'collapse'; spec: CollapseSpec }
  | { type: 'gas-enter' }
  | { type: 'cough' }
  /** Игрок шагнул в провал. */
  | { type: 'fall' }
  /** Надышался газом. */
  | { type: 'faint' };

const inZone = (z: Zone, p: Vec3): boolean => p[0] >= z.minX && p[0] <= z.maxX && p[2] >= z.minZ && p[2] <= z.maxZ && p[1] >= z.minY && p[1] <= z.maxY;

export class Session {
  readonly memories: Memory[];
  panic = 0;
  time = 0;
  /** Самый глубокий ярус, на который спустился игрок. */
  maxTier = 0;
  /** Прогресс взгляда на вещь воспоминания, 0..1. */
  hold = 0;
  inWater = false;
  inGas = false;
  /** Сессия закончена: всё вспомнено. */
  over = false;
  private gasTime = 0;
  private coughIn = 0;
  private fainted = false;
  /** Время с последнего события воспоминаний (начало, вспышка, «вспомнил»). */
  private since = 0;
  private readonly rng: Rng;
  private readonly usedSpots = new Set<ItemSpot>();
  /** Узел навигации, ближайший к каждому месту (−1 — места вне графа). */
  private readonly spotNode = new Map<ItemSpot, number>();
  private readonly collapseState = new Map<string, 'idle' | 'primed' | 'done'>();

  constructor(
    readonly level: BuiltLevel,
    seed: number,
    /** Что уже вспоминалось в прошлых сессиях: новое идёт первым. */
    known: ReadonlySet<string> = new Set(),
    readonly cfg: SessionConfig = DEFAULT_SESSION,
  ) {
    this.rng = mulberry32(hash2(seed, 0x5e55, 0x10ad));
    const pool = MEMORIES.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    pool.sort((a, b) => Number(known.has(a.id)) - Number(known.has(b.id)));
    this.memories = pool.slice(0, cfg.count).map((def, index) => ({ def, index, state: 'hidden', spot: null }));
    for (const c of level.collapses) this.collapseState.set(c.id, 'idle');
    for (const s of level.spots) {
      let best = -1;
      let bestD = Infinity;
      for (const n of level.nav) {
        if (n.tier !== s.tier) continue;
        const d = Math.hypot(n.x - s.x, n.z - s.z) + (n.room === s.room ? 0 : 6);
        if (d < bestD) {
          bestD = d;
          best = n.id;
        }
      }
      this.spotNode.set(s, best);
    }
  }

  get active(): Memory | null {
    return this.memories.find((m) => m.state === 'active') ?? null;
  }

  get doneCount(): number {
    return this.memories.filter((m) => m.state === 'done').length;
  }

  /** Обвалы, которые уже случились. */
  collapsed(): string[] {
    return [...this.collapseState].filter(([, s]) => s === 'done').map(([id]) => id);
  }

  /** Расстояния в клетках пути от узла до всех остальных (−1 — недостижим). */
  private distances(from: number): Int32Array {
    const nav = this.level.nav;
    const dist = new Int32Array(nav.length).fill(-1);
    if (from < 0 || from >= nav.length) return dist;
    const queue = [from];
    dist[from] = 0;
    for (let i = 0; i < queue.length; i++) {
      const n = nav[queue[i]!]!;
      for (const l of n.links) {
        if (dist[l] !== -1) continue;
        dist[l] = dist[n.id]! + 1;
        queue.push(l);
      }
    }
    return dist;
  }

  /** Место для вещи: в стольких клетках пути от игрока, чтобы за ней пришлось идти, но не через весь объект. */
  private pickSpot(from: number): ItemSpot | null {
    const dist = this.distances(from);
    const c = this.cfg;
    const free = this.level.spots.filter((s) => !this.usedSpots.has(s));
    const d = (s: ItemSpot): number => {
      const n = this.spotNode.get(s) ?? -1;
      return n >= 0 ? dist[n]! : -1;
    };
    let pool = free.filter((s) => d(s) >= c.minCells && d(s) <= c.maxCells);
    if (pool.length === 0) {
      // Объект маленький или игрок в углу: берём самое далёкое из достижимого.
      const reach = free.filter((s) => d(s) >= 0).sort((a, b) => d(b) - d(a));
      pool = reach.slice(0, Math.max(1, Math.ceil(reach.length / 4)));
    }
    if (pool.length === 0) return null;
    const s = pool[Math.floor(this.rng() * pool.length)]!;
    this.usedSpots.add(s);
    return s;
  }

  update(dt: number, inp: SessionInput, los: (from: Vec3, to: Vec3) => number): SessionEvent[] {
    const ev: SessionEvent[] = [];
    this.time += dt;
    this.since += dt;
    const inside = inp.node >= 0;
    const tier = Math.max(0, Math.round(-inp.pos[1] / 4.5));
    if (inside && tier > this.maxTier) this.maxTier = tier;

    // ── Зоны среды ──
    let water = false;
    let gas = false;
    if (inside) {
      for (const z of this.level.zones) {
        if (!inZone(z, inp.pos)) continue;
        if (z.kind === 'pit') {
          ev.push({ type: 'fall' });
          return ev;
        }
        if (z.kind === 'water') water = true;
        else gas = true;
      }
    }
    this.inWater = water;
    if (gas && !this.inGas) ev.push({ type: 'gas-enter' });
    this.inGas = gas;
    if (gas) {
      this.gasTime += dt;
      this.coughIn -= dt;
      if (this.gasTime > 2.5 && this.coughIn <= 0) {
        ev.push({ type: 'cough' });
        this.coughIn = 1.6;
      }
      if (this.gasTime > this.cfg.faintTime && !this.fainted) {
        this.fainted = true;
        ev.push({ type: 'faint' });
      }
    } else {
      this.gasTime = Math.max(0, this.gasTime - dt * 2);
      if (this.gasTime === 0) this.fainted = false;
    }
    if (inp.landed > 7.5) this.panic = clamp01(this.panic + 0.3);

    // ── Паника: растёт в темноте, в газу и рядом с роем; спадает на свету ──
    const dark = inp.light < 0.15;
    const rise = (dark ? 0.035 : 0) + (gas ? 0.08 : 0) + inp.swarm * 0.12;
    this.panic = clamp01(this.panic + (rise > 0 ? rise : -0.05) * dt);

    // ── Обвалы: клетка «взводится», когда игрок проходит по ней, и рушится за спиной ──
    if (inside) {
      for (const c of this.level.collapses) {
        const st = this.collapseState.get(c.id);
        if (st === 'done') continue;
        const d = Math.hypot(inp.pos[0] - c.center[0], inp.pos[2] - c.center[2]);
        const sameTier = Math.abs(inp.pos[1] - c.center[1]) < 1.5;
        if (st === 'idle' && sameTier && d < 1.3) this.collapseState.set(c.id, 'primed');
        else if (st === 'primed' && (d > 4.2 || !sameTier)) {
          this.collapseState.set(c.id, 'done');
          this.panic = clamp01(this.panic + 0.35);
          ev.push({ type: 'collapse', spec: c });
        }
      }
    }
    if (this.over) return ev;

    // ── Воспоминания ──
    const act = this.active;
    if (act && act.spot) {
      const s = act.spot;
      // Целимся в середину вещи, а не в её подошву: так её реже заслоняет край стола или стула.
      const seen = looksAt({ eye: inp.eye, aim: inp.aim, light: inp.light }, [s.x, s.y + 0.2, s.z], 0.3, this.cfg.lookRange, los);
      if (seen) {
        this.hold = Math.min(1, this.hold + dt / this.cfg.lookTime);
        if (this.hold >= 1) {
          this.hold = 0;
          act.state = 'done';
          this.since = 0;
          ev.push({ type: 'recall', memory: act });
          if (this.memories.every((m) => m.state === 'done')) {
            this.over = true;
            ev.push({ type: 'all-done' });
          }
        }
      } else this.hold = Math.max(0, this.hold - dt * 2);
    } else if (!act && inside) {
      const next = this.memories.find((m) => m.state === 'hidden');
      const wait = this.doneCount === 0 ? this.cfg.firstDelay : this.cfg.delay;
      if (next && this.since >= wait && (inp.observed || this.since >= wait + this.cfg.fallback)) {
        const spot = this.pickSpot(inp.node);
        if (spot) {
          next.state = 'active';
          next.spot = spot;
          this.since = 0;
          ev.push({ type: 'reveal', memory: next });
        }
      }
    }
    return ev;
  }

  /** Отладка: не ждать — следующее воспоминание придёт на ближайшем шаге. */
  rush(): void {
    this.since = 1e6;
  }

  /** Занять место: там уже лежит что-то другое, вещь воспоминания туда не попадёт. */
  reserve(spot: ItemSpot): void {
    this.usedSpots.add(spot);
  }

  /** Вещь «забылась»: её унесло в другое место (поймал рой, провалился). from — узел, откуда считать путь. */
  forget(from: number): SessionEvent | null {
    const act = this.active;
    if (!act) return null;
    const spot = this.pickSpot(from);
    if (!spot) return null;
    act.spot = spot;
    this.hold = 0;
    return { type: 'forgot', memory: act };
  }

  /** Внешний испуг (пугалка, рой): добавить панику. */
  scare(amount: number): void {
    this.panic = clamp01(this.panic + amount);
  }
}
