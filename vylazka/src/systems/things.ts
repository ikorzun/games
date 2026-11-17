/**
 * Вещи: отдельные предметы, которые меняются, если на них долго смотреть, — уменьшаются до ничего,
 * рассыпаются в пыль или вырастают в несколько раз. Одни из них — просто «неустойчивые» вещи сна,
 * другие — цели воспоминаний (их судьбу решает сессия). Чистая логика: рендер читает поля вещи.
 */
import type { Vec3 } from '../core/types';

/** Что случится с вещью под взглядом. jump — вырастает и утягивает игрока в другое пространство. */
export type Fate = 'shrink' | 'dust' | 'grow' | 'jump';

export interface Thing {
  id: number;
  /** Имя предмета в реестре реквизита. */
  kind: string;
  pos: Vec3;
  yaw: number;
  /** Радиус для проверки взгляда, м. */
  radius: number;
  fate: Fate;
  /**
   * idle — стоит; changing — меняется (выросшая и рассыпается в пыль — тоже changing); gone — её больше нет;
   * coming — собирается заново.
   */
  state: 'idle' | 'changing' | 'gone' | 'coming';
  /** Вещь — цель воспоминания: сама под взглядом не меняется, её судьбу решает сессия. */
  memory: boolean;
  /** Вещь-экспонат (вспомненное в белом нигде): под взглядом не меняется, игра только знает, что на неё смотрят. */
  still: boolean;
  /** Сколько на неё уже смотрят, 0..1. */
  gaze: number;
  /** Время с начала превращения, с. */
  t: number;
  scale: number;
  dissolve: number;
  /** Номер преграды вещи в наборе коллайдеров (−1 — нет). */
  collider: number;
  /**
   * Вещь растворилась от прикосновения (а не под взглядом и не потому, что её вспомнили): такая
   * возвращается, когда свет погас и зажёгся снова.
   */
  touched: boolean;
  /** После того как она растворилась, свет уже гас: зажжётся — вернётся. */
  dark: boolean;
  /** Сколько секунд подряд темно на её месте: «свет погас» — только если темнота продержалась (мигание фонаря не в счёт). */
  darkT: number;
  /**
   * Ступень доверия (systems/illusions.ts): 0 — настоящая, 1 — картонка, 2 — проекция, 3 — кружево.
   * Каждое касание стирает вещь на ступень: вернётся она хуже, чем была.
   */
  form: number;
}

export type ThingEvent =
  /** На вещь впервые посмотрели всерьёз (наблюдение — повод для воспоминания). */
  | { type: 'noticed'; thing: Thing }
  /** Вещь начала меняться. */
  | { type: 'changing'; thing: Thing }
  /** Вещь исчезла или выросла окончательно. */
  | { type: 'settled'; thing: Thing }
  /** Выросшая вещь накрыла игрока: пора в другое пространство. */
  | { type: 'engulf'; thing: Thing };

export interface Look {
  eye: Vec3;
  /** Направление луча (единичный вектор). */
  aim: Vec3;
  /** Насколько вещь видно: яркость фонаря или рассеянный свет, 0..1. */
  light: number;
}

export interface ThingsConfig {
  /** С какого расстояния взгляд считается, м. */
  range: number;
  /** Сколько смотреть, чтобы вещь начала меняться, с. */
  gazeTime: number;
  shrinkTime: number;
  dustTime: number;
  growTime: number;
  /** Во сколько раз вырастает вещь. */
  growScale: number;
  /**
   * Выросшая вещь рассыпается в пыль и растворяется частицами за столько секунд (слова партнёра 17.11 08:19:
   * «превращать ее после увеличения в пыль и пусть она полностью растворяется через частицы»).
   */
  giantDustTime: number;
  /** Сколько выросшая вещь стоит огромной, прежде чем рассыпаться, с: рост должен успеть прочитаться. */
  giantHold: number;
  /** За сколько растворяется вещь, которой коснулись, и за сколько она собирается заново, с. */
  touchTime: number;
  comeTime: number;
}

export const DEFAULT_THINGS: ThingsConfig = { range: 7, gazeTime: 2.4, shrinkTime: 1.1, dustTime: 1.5, growTime: 2.6, growScale: 7, giantDustTime: 2.4, giantHold: 0.6, touchTime: 0.9, comeTime: 0.9 };

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * Смотрит ли игрок на точку: она в луче, достаточно близко и ничем не заслонена.
 * los — расстояние по прямой до первой преграды в сторону точки.
 */
export function looksAt(look: Look, target: Vec3, radius: number, range: number, los: (from: Vec3, to: Vec3) => number): boolean {
  const dx = target[0] - look.eye[0];
  const dy = target[1] - look.eye[1];
  const dz = target[2] - look.eye[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > range || d < 0.25 || look.light < 0.3) return false;
  const dot = (dx * look.aim[0] + dy * look.aim[1] + dz * look.aim[2]) / d;
  // Крупное и близкое поймать проще: допуск растёт с угловым размером вещи.
  if (dot < 0.972 - Math.min(0.12, (radius / d) * 0.45)) return false;
  return los(look.eye, target) >= d - Math.max(0.6, radius * 1.5);
}

export class Things {
  readonly list: Thing[] = [];
  private nextId = 1;
  private readonly noticed = new Set<number>();

  constructor(readonly cfg: ThingsConfig = DEFAULT_THINGS) {}

  add(kind: string, pos: Vec3, yaw: number, fate: Fate, radius = 0.3, memory = false, still = false): Thing {
    const t: Thing = { id: this.nextId++, kind, pos, yaw, radius, fate, state: 'idle', memory, still, gaze: 0, t: 0, scale: 1, dissolve: 0, collider: -1, touched: false, dark: false, darkT: 0, form: 0 };
    this.list.push(t);
    return t;
  }

  remove(thing: Thing): void {
    const i = this.list.indexOf(thing);
    if (i >= 0) this.list.splice(i, 1);
  }

  clear(): void {
    this.list.length = 0;
    this.noticed.clear();
  }

  /** Начать превращение немедленно (воспоминание найдено — вещь рассыпается). */
  change(thing: Thing, fate: Fate = thing.fate): ThingEvent | null {
    if (thing.state !== 'idle') return null;
    thing.fate = fate;
    thing.state = 'changing';
    thing.t = 0;
    return { type: 'changing', thing };
  }

  /**
   * Игрок коснулся вещи: она растворяется (всё здесь иллюзорно) — и вернётся, когда свет погаснет
   * и зажжётся снова. Вещь, которая уже меняется, прикосновения не замечает.
   */
  touch(thing: Thing): ThingEvent | null {
    if (thing.state !== 'idle') return null;
    thing.fate = 'dust';
    thing.state = 'changing';
    thing.t = 0;
    thing.touched = true;
    thing.dark = false;
    thing.darkT = 0;
    return { type: 'changing', thing };
  }

  /** Вернуть растворённую вещь: она собирается из пыли на своём (уже, может быть, новом) месте. */
  comeBack(thing: Thing): void {
    thing.state = 'coming';
    thing.t = 0;
    thing.scale = 1;
    thing.dissolve = 1;
    thing.gaze = 0;
    thing.touched = false;
    thing.dark = false;
    thing.darkT = 0;
  }

  /** Самый «насмотренный» взгляд сейчас, 0..1 (для кинескопа и рамки). */
  get focus(): Thing | null {
    let best: Thing | null = null;
    for (const t of this.list) if (t.state === 'idle' && t.gaze > 0.02 && (!best || t.gaze > best.gaze)) best = t;
    return best;
  }

  update(dt: number, look: Look, feet: Vec3, los: (from: Vec3, to: Vec3) => number): ThingEvent[] {
    const ev: ThingEvent[] = [];
    const c = this.cfg;
    for (const t of this.list) {
      if (t.state === 'gone') continue;
      if (t.state === 'coming') {
        t.t += dt;
        const k = Math.min(1, t.t / c.comeTime);
        t.dissolve = 1 - k;
        if (k >= 1) this.settle(t, 'idle', ev);
        continue;
      }
      if (t.state === 'idle') {
        const centre: Vec3 = [t.pos[0], t.pos[1] + t.radius * 0.6, t.pos[2]];
        const seen = looksAt(look, centre, t.radius, c.range, los);
        if (t.memory || t.still) {
          // Цель воспоминания или экспонат: взгляд копит сессия (игра), здесь только отметка «на неё смотрят».
          t.gaze = seen ? Math.min(1, t.gaze + dt / 0.4) : Math.max(0, t.gaze - dt * 2);
          continue;
        }
        t.gaze = seen ? Math.min(1, t.gaze + dt / c.gazeTime) : Math.max(0, t.gaze - dt * 0.8);
        if (t.gaze > 0.3 && !this.noticed.has(t.id)) {
          this.noticed.add(t.id);
          ev.push({ type: 'noticed', thing: t });
        }
        if (t.gaze >= 1) {
          const e = this.change(t);
          if (e) ev.push(e);
        }
        continue;
      }
      // Превращение.
      t.t += dt;
      t.gaze = Math.max(0, t.gaze - dt);
      if (t.fate === 'shrink') {
        const k = Math.min(1, t.t / c.shrinkTime);
        t.scale = 1 - ease(k);
        if (k >= 1) this.settle(t, 'gone', ev);
      } else if (t.fate === 'dust') {
        const k = Math.min(1, t.t / (t.touched ? c.touchTime : c.dustTime));
        t.dissolve = k;
        if (k >= 1) this.settle(t, 'gone', ev);
      } else {
        const k = Math.min(1, t.t / c.growTime);
        t.scale = 1 + (c.growScale - 1) * ease(k);
        if (t.fate === 'jump') {
          // Вещь растёт навстречу: как только она дотянулась до игрока — накрывает.
          const reach = t.radius * t.scale;
          const d = Math.hypot(feet[0] - t.pos[0], feet[2] - t.pos[2]);
          if (d < reach + 0.4 || k >= 1) {
            ev.push({ type: 'engulf', thing: t });
            this.settle(t, 'gone', ev);
          }
        } else if (k >= 1) {
          // Выросла — миг стоит огромной и рассыпается: растворяется частицами и пропадает совсем.
          t.dissolve = Math.min(1, Math.max(0, t.t - c.growTime - c.giantHold) / c.giantDustTime);
          if (t.dissolve >= 1) this.settle(t, 'gone', ev);
        }
      }
    }
    return ev;
  }

  /**
   * Насколько вещь — облако точек, 0..1. Вещь, которая растёт под взглядом (fate 'grow'), по мере роста
   * рассыпается на точки: сквозь неё проходят, и это должно быть видно (слова партнёра); выросшая, она
   * растворяется частицами. Вещь, что растёт навстречу и накрывает ('jump'), остаётся плотной — она угроза.
   */
  static dots(t: Pick<Thing, 'fate' | 'state' | 'scale'>, cfg: ThingsConfig = DEFAULT_THINGS): number {
    if (t.fate !== 'grow' || t.state !== 'changing') return 0;
    const k = Math.max(0, Math.min(1, (t.scale - 1) / Math.max(1e-6, (cfg.growScale - 1) * 0.45)));
    return k * k * (3 - 2 * k);
  }

  private settle(t: Thing, state: 'gone' | 'idle', ev: ThingEvent[]): void {
    t.state = state;
    ev.push({ type: 'settled', thing: t });
  }
}
