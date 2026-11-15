/**
 * Давление помимо Осыпи (docs/vylazka/pressure.md, §2).
 *
 * Слова партнёра: «можно сделать сдавливающие пространства и нужно убежать, либо распад пол и падение.
 * Если не успел убежать или упал — сессия начинается с начала. Все как во сне, просыпаешься от
 * страшного внезапного опыта».
 *
 * Два события, одно на помещение:
 *
 * - провал: по полу бежит красная сетка, через две с половиной секунды пол начинает рассыпаться —
 *   кругом от дальнего угла к выходу. Фронт идёт медленнее шага: кто пошёл к выходу, успевает;
 *   кто остался стоять — падает и просыпается;
 * - сжатие: потолок провисает и опускается. Камера пригибается сама. Вышел — потолок отпускает;
 *   дошёл до метра — проснулся.
 *
 * Честность: событие начинается, только когда до выхода есть что идти, а времени хватает идущему
 * без остановки с запасом в четверть (cfg.margin). Чистый TS: числа считаются здесь и проверяются
 * тестами; рисует это шейдер мира (render/shaders.ts, uPress*), «проснулся» делает игра.
 */
import { mulberry32 } from '../core/rng';

export type PressureKind = 'collapse' | 'squeeze';
/** warn — сетка, пол ещё цел; run — фронт идёт (потолок опускается); hold — пола нет; release — возвращается. */
export type PressurePhase = 'warn' | 'run' | 'hold' | 'release';

/** Помещение, в котором событие возможно: прямоугольник в мире, пол, высота, выходы. */
export interface PressureRoom {
  id: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
  /** Высота потолка над полом, м. */
  height: number;
  /** Выходы: середины проёмов и дверей (x, z). */
  exits: readonly (readonly [number, number])[];
}

export interface PressureConfig {
  /** Скорость шага игрока, м/с, и запас времени идущему (1,25 — на четверть больше нужного). */
  walk: number;
  margin: number;
  /** Провал: сколько секунд предупреждение; с какой долей скорости шага идёт фронт. */
  warn: number;
  front: number;
  /** Провал: сколько секунд пола нет и за сколько он собирается обратно. */
  hold: number;
  back: number;
  /** Сжатие: до какой высоты опускается потолок; не быстрее чем за столько секунд; запас сверх дороги. */
  squeezeTo: number;
  squeezeMin: number;
  squeezeSlack: number;
  /** Сжатие: зазор между потолком и камерой; во сколько раз быстрее потолок поднимается обратно. */
  duck: number;
  release: number;
  /** Сколько длится падение до пробуждения, с. */
  fall: number;
  /** Режиссёр: не раньше стольких секунд сессии; пауза между событиями (от и до), с. */
  firstAfter: number;
  gap: readonly [number, number];
  /** Сколько игрок должен пробыть в помещении и не ближе скольких метров к выходу стоять. */
  dwell: number;
  away: number;
}

export const DEFAULT_PRESSURE: PressureConfig = { walk: 2.3, margin: 1.25, warn: 2.5, front: 0.62, hold: 5, back: 2.5, squeezeTo: 1.0, squeezeMin: 9, squeezeSlack: 4, duck: 0.28, release: 2.5, fall: 0.55, firstAfter: 50, gap: [60, 110], dwell: 1.5, away: 2.4 };

/** Высота камеры над полом (player/rig.ts, chestHeight): от неё считается, когда пора пригнуться. */
const CHEST = 1.42;
/** Кромка пола у стен и порога, которая держит игрока, когда остальной пол ушёл, м. */
const RIM = 0.3;

export interface PressureState {
  kind: PressureKind;
  room: PressureRoom;
  phase: PressurePhase;
  /** Секунд в нынешней фазе. */
  t: number;
  /** Провал: откуда идёт фронт, его радиус сейчас и радиус, на котором пола в помещении не остаётся. */
  origin: [number, number];
  radius: number;
  reach: number;
  /** Сжатие: высота потолка сейчас и за сколько секунд он опускается до предела. */
  ceil: number;
  span: number;
}

export interface PressureInput {
  /** Время сессии, с. */
  time: number;
  /** Где игрок (x, z). */
  pos: readonly [number, number];
  /** Помещение, в котором он стоит, если оно годится для события; иначе null. */
  room: PressureRoom | null;
  /** Сейчас нельзя: идёт скачок, охотится Осыпь, игра в покое. Идущее событие при этом продолжается. */
  quiet: boolean;
  /** Сколько событий можно за сессию и какие виды. */
  limit: number;
  kinds: readonly PressureKind[];
}

export type PressureOutcome = 'fell' | 'crushed' | null;

/** Что рисовать: шейдеру мира. */
export interface PressureView {
  box: [number, number, number, number];
  floorY: number;
  ceilY: number;
  origin: [number, number];
  /** Радиус рассыпавшегося пола, м (0 — пол цел). */
  radius: number;
  /** Красная сетка, 0..1: на полу (провал) или на потолке (сжатие). */
  grid: number;
  /** На сколько метров провис потолок. */
  drop: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

const inside = (r: PressureRoom, x: number, z: number, pad = 0): boolean => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;

/** До ближайшего выхода помещения: [расстояние, выход]. Выходов нет — бесконечность. */
export function nearestExit(r: PressureRoom, x: number, z: number): { dist: number; exit: readonly [number, number] | null } {
  let dist = Infinity;
  let exit: readonly [number, number] | null = null;
  for (const e of r.exits) {
    const d = Math.hypot(e[0] - x, e[1] - z);
    if (d < dist) {
      dist = d;
      exit = e;
    }
  }
  return { dist, exit };
}

export class Pressure {
  active: PressureState | null = null;
  /** Игрок падает: сколько секунд уже; меньше нуля — не падает. */
  falling = -1;
  /** Сколько событий уже было в этой сессии. */
  count = 0;
  private next: number;
  private dwell = 0;
  private lastRoom = -1;
  private readonly rng: () => number;

  constructor(
    seed: number,
    readonly cfg: PressureConfig = DEFAULT_PRESSURE,
  ) {
    this.rng = mulberry32((seed ^ 0x9e55a1) >>> 0);
    this.next = cfg.firstAfter;
  }

  /** Новая сессия: счёт событий с нуля, первое — не сразу. */
  reset(): void {
    this.active = null;
    this.falling = -1;
    this.count = 0;
    this.dwell = 0;
    this.lastRoom = -1;
    this.next = this.cfg.firstAfter;
  }

  /**
   * Начать событие сейчас (режиссёр, отладка, тесты). false — нельзя: событие уже идёт или у помещения
   * нет выхода.
   */
  start(kind: PressureKind, room: PressureRoom, pos: readonly [number, number]): boolean {
    if (this.active || this.falling >= 0) return false;
    const { dist, exit } = nearestExit(room, pos[0], pos[1]);
    if (!exit) return false;
    const c = this.cfg;
    // Фронт провала идёт от угла, дальнего от выхода: кто идёт к выходу, уходит от фронта.
    let origin: [number, number] = [room.minX, room.minZ];
    let far = -1;
    for (const x of [room.minX, room.maxX]) {
      for (const z of [room.minZ, room.maxZ]) {
        const d = Math.hypot(x - exit[0], z - exit[1]);
        if (d > far) {
          far = d;
          origin = [x, z];
        }
      }
    }
    let reach = 0;
    for (const x of [room.minX, room.maxX]) for (const z of [room.minZ, room.maxZ]) reach = Math.max(reach, Math.hypot(x - origin[0], z - origin[1]));
    const span = Math.max(c.squeezeMin, (dist / c.walk) * c.margin + c.squeezeSlack);
    this.active = { kind, room, phase: kind === 'collapse' ? 'warn' : 'run', t: 0, origin, radius: 0, reach: reach + 0.6, ceil: room.height, span };
    this.count += 1;
    return true;
  }

  /** Шаг: dt — время места. Возвращает, чем кончилось для игрока в этом шаге: упал, сдавило — или ничего. */
  update(dt: number, inp: PressureInput): PressureOutcome {
    const c = this.cfg;
    // Падение: полсекунды вниз — и проснулся. Событие на этом кончается: пол вернётся, пока темно.
    if (this.falling >= 0) {
      this.falling += dt;
      if (this.falling >= c.fall) {
        this.finish(inp.time);
        return 'fell';
      }
      return null;
    }
    const a = this.active;
    if (!a) {
      this.direct(dt, inp);
      return null;
    }
    a.t += dt;
    if (a.kind === 'collapse') {
      if (a.phase === 'warn') {
        if (a.t >= c.warn) this.phase(a, 'run');
      } else if (a.phase === 'run') {
        a.radius = Math.min(a.reach, a.radius + c.front * c.walk * dt);
        if (a.radius >= a.reach) this.phase(a, 'hold');
      } else if (a.phase === 'hold') {
        if (a.t >= c.hold) this.phase(a, 'release');
      } else {
        a.radius = Math.max(0, a.radius - (a.reach / c.back) * dt);
        if (a.radius <= 0) {
          this.finish(inp.time);
          return null;
        }
      }
      // Под ногами пола нет: игрок падает. Порог и узкая кромка у стен держат: шагнул в дверь — ушёл.
      if (inside(a.room, inp.pos[0], inp.pos[1], -RIM) && a.radius > 0 && Math.hypot(inp.pos[0] - a.origin[0], inp.pos[1] - a.origin[1]) < a.radius - 0.25) this.falling = 0;
      return null;
    }
    // Сжатие.
    const depth = a.room.height - c.squeezeTo;
    if (a.phase === 'run') {
      // Вышел — отпускает. Запас в 0,2 м: на пороге потолок ещё давит.
      if (!inside(a.room, inp.pos[0], inp.pos[1], 0.2)) this.phase(a, 'release');
      else {
        a.ceil = a.room.height - depth * ease(a.t / a.span);
        if (a.t >= a.span) {
          this.finish(inp.time);
          return 'crushed';
        }
      }
    } else {
      a.ceil = Math.min(a.room.height, a.ceil + (depth / a.span) * c.release * dt);
      if (a.ceil >= a.room.height) this.finish(inp.time);
    }
    return null;
  }

  private phase(a: PressureState, to: PressurePhase): void {
    a.phase = to;
    a.t = 0;
  }

  private finish(time: number): void {
    this.active = null;
    this.falling = -1;
    this.dwell = 0;
    const [g0, g1] = this.cfg.gap;
    this.next = time + g0 + (g1 - g0) * this.rng();
  }

  /** Режиссёр: когда и что начать. */
  private direct(dt: number, inp: PressureInput): void {
    const c = this.cfg;
    const r = inp.room;
    if (!r || r.id !== this.lastRoom) {
      this.dwell = 0;
      this.lastRoom = r ? r.id : -1;
    } else this.dwell += dt;
    if (!r || inp.quiet || inp.kinds.length === 0 || this.count >= inp.limit || inp.time < this.next || this.dwell < c.dwell) return;
    if (nearestExit(r, inp.pos[0], inp.pos[1]).dist < c.away) return;
    const kind = inp.kinds[Math.min(inp.kinds.length - 1, Math.floor(this.rng() * inp.kinds.length))]!;
    this.start(kind, r, inp.pos);
  }

  /** На сколько метров камера ниже обычного: пригибается под потолком, летит вниз в падении. */
  camDrop(pos: readonly [number, number]): number {
    if (this.falling >= 0) return 0.5 * 9.8 * this.falling * this.falling + 0.6 * this.falling;
    const a = this.active;
    if (!a || a.kind !== 'squeeze' || !inside(a.room, pos[0], pos[1], 0.2)) return 0;
    return Math.max(0, CHEST + this.cfg.duck - a.ceil);
  }

  /** Насколько событие близко к концу, 0..1: дрожь кадра, гул. */
  get strain(): number {
    if (this.falling >= 0) return 1;
    const a = this.active;
    if (!a) return 0;
    if (a.kind === 'squeeze') return a.phase === 'run' ? ease(a.t / a.span) : 0.3 * (1 - (a.ceil - this.cfg.squeezeTo) / Math.max(0.01, a.room.height - this.cfg.squeezeTo));
    if (a.phase === 'warn') return 0.25 + 0.25 * (a.t / this.cfg.warn);
    if (a.phase === 'run') return 0.5 + 0.5 * (a.radius / a.reach);
    return a.phase === 'hold' ? 0.4 : 0.2;
  }

  /** Что рисовать сейчас; null — ничего. */
  view(): PressureView | null {
    const a = this.active;
    if (!a) return null;
    const r = a.room;
    let grid = 0;
    if (a.kind === 'collapse') {
      // Предупреждение мигает всё чаще; дальше сетка горит только у кромки фронта (её рисует шейдер).
      if (a.phase === 'warn') grid = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(a.t * (5 + 6 * (a.t / this.cfg.warn))));
    } else grid = a.phase === 'run' ? 0.25 + 0.55 * ease(a.t / a.span) : 0.25 * clamp01((r.height - a.ceil) / Math.max(0.01, r.height - this.cfg.squeezeTo));
    return { box: [r.minX, r.minZ, r.maxX, r.maxZ], floorY: r.floorY, ceilY: r.floorY + r.height, origin: [a.origin[0], a.origin[1]], radius: a.kind === 'collapse' ? a.radius : 0, grid, drop: a.kind === 'squeeze' ? r.height - a.ceil : 0 };
  }
}
