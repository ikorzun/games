/**
 * Объекты уровня: предметы обстановки, у которых есть своё имя и свои границы, хотя лежат они в общей
 * сетке помещения. Нужны для правила «всё, к чему касается герой, растворяется»: чтобы растворить
 * шкаф, надо знать, какие вершины и какие преграды — шкаф.
 *
 * Пока предмет собирается, его номер стоит на сборщике сетки (каждая новая вершина получает его),
 * на сборщике проекций (картинка экрана растворяется вместе с панелью) и на наборе преград (каждая
 * новая коробка знает хозяина). Вложенный предмет — часть внешнего: остров столов — один объект, а
 * не четыре стола.
 *
 * Чистый TS: журнал заполняет сборка уровня, читает игра (systems/illusions.ts) и тесты.
 */
import type { Vec3 } from '../core/types';
import type { Xf } from './props';

export interface LevelObject {
  /** Номер, с единицы. Ноль — «не объект». */
  id: number;
  /** Имя в реестре реквизита; у картонки — имя предмета, которым она притворяется. */
  name: string;
  /** Начало координат предмета в мире и его поворот (четверти оборота): туда же можно поставить другой. */
  at: Vec3;
  rot: 0 | 1 | 2 | 3;
  /** Габариты его вершин в мире. */
  min: Vec3;
  max: Vec3;
  /** Есть ли у него преграды. Нет (картонка, коврик, плакат) — коснуться можно, упереться нельзя. */
  solid: boolean;
  /** Картонка: плоский снимок предмета (world/flat.ts). */
  flat: boolean;
  /** Группа преград варианта комнаты, в котором стоит предмет: пока вариант скрыт, коснуться его нельзя. */
  group?: string;
}

/** Свободный участок стены, оставшийся после обстановки: сюда вещь может вернуться «в другом месте». */
export interface FreeSlot {
  /** Середина участка у пола, вплотную к стене. */
  at: Vec3;
  /** Поворот: локальная ось +z смотрит от стены в помещение. */
  rot: 0 | 1 | 2 | 3;
  room: number;
  tier: number;
}

/** Сколько объектов помещается в текстуру состояний рендера (64 × 64): два последних номера — особые. */
export const MAX_OBJECTS = 4093;

/**
 * Номер вершин того, что висит у самого потолка: светильники, короба, вывески, ветки из дыры. Это не вещь
 * (её нет в журнале, коснуться её нельзя), а часть потолка: при стирании места она уходит целиком вместе
 * с потолком над собой (render/shaders.ts, archGone). Без этого её бока стирались как стены — позже
 * потолка, — и светильник висел в дыре (аудит мест, 16.11). Состояние номера в текстуре рендера никто
 * не трогает.
 */
export const HANG_OBJ = 4094;

/** Собрать то, что висит у потолка: все вершины, положенные build, получат номер HANG_OBJ. */
export function hanging<T>(xf: Xf, build: () => T): T {
  const keep = xf.mb.obj;
  xf.mb.obj = HANG_OBJ;
  try {
    return build();
  } finally {
    xf.mb.obj = keep;
  }
}

/**
 * Номер вершин своего стирания места (рубец, щит с коконами — world/wear_growth.ts): это не вещь — её
 * нет в журнале, коснуться её нельзя, — но и не архитектура: стены и потолок стираются по кругам
 * (render/shaders.ts, archGone), а то, что наросло на месте, держится до конца петли. Состояние этого
 * номера в текстуре рендера никто не трогает: он всегда «на месте».
 */
export const GROWTH_OBJ = 4095;

/** Номер вершин — не вещь журнала, а особая часть места (подвешенное к потолку, своё стирание). */
export const isSpecialObj = (id: number): boolean => id === HANG_OBJ || id === GROWTH_OBJ;

export class ObjectLog {
  readonly list: LevelObject[] = [];
  /** Номер объекта, который сейчас собирается (0 — никакой). */
  private open = 0;

  /**
   * Станет ли вещь, которую сейчас начнут собирать, своим объектом журнала: не внутри другого объекта (журнал не занят) и
   * номера не кончились. Только такие вещи видит хук сборки уровня (world/props_all.ts, withSwap): им соответствуют объекты
   * уровня, по ним партнёр в конструкторе считает номер вещи в помещении.
   */
  get takes(): boolean {
    return this.open === 0 && this.list.length < MAX_OBJECTS;
  }

  /**
   * Собрать предмет как объект: всё, что build положит в сетку, в проекции и в преграды, будет помечено
   * его номером. Внутри другого объекта (или когда номера кончились) — просто собрать.
   */
  wrap(xf: Xf, name: string, build: () => void, flat = false): void {
    if (this.open !== 0 || this.list.length >= MAX_OBJECTS) {
      build();
      return;
    }
    const id = this.list.length + 1;
    const v0 = xf.mb.vertexCount;
    const s0 = xf.sl ? xf.sl.vertexCount : 0;
    const c0 = xf.col ? xf.col.boxes.length : 0;
    this.open = id;
    xf.mb.obj = id;
    if (xf.sl) xf.sl.obj = id;
    if (xf.col) xf.col.owner = id;
    try {
      build();
    } finally {
      this.open = 0;
      xf.mb.obj = 0;
      if (xf.sl) xf.sl.obj = 0;
      if (xf.col) xf.col.owner = 0;
    }
    const a = xf.mb.bounds(v0);
    const b = xf.sl ? xf.sl.bounds(s0) : null;
    // Предмет, от которого не осталось ни одной вершины, объектом не считается: его преграды — ничьи.
    if (!a && !b) {
      if (xf.col) for (let i = c0; i < xf.col.boxes.length; i++) if (xf.col.boxes[i]!.owner === id) delete xf.col.boxes[i]!.owner;
      return;
    }
    const lo: Vec3 = a ? [...a[0]] : [...b![0]];
    const hi: Vec3 = a ? [...a[1]] : [...b![1]];
    if (a && b) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, b[0][k]!);
        hi[k] = Math.max(hi[k]!, b[1][k]!);
      }
    }
    this.list.push({ id, name, at: [xf.ox, xf.oy, xf.oz], rot: xf.rot, min: lo, max: hi, solid: xf.col ? xf.col.boxes.length > c0 : false, flat });
  }
}

/**
 * Хук сборки уровня для картонок: true — картонку не собирать. Картонка (world/furnish.ts) — снимок настоящей вещи, она
 * собирается в обход реестра и мимо хука замены (world/props_all.ts). Но для партнёра это та же вещь игры (её имя, её место):
 * убранная или передвинутая им вещь не должна возвращаться снимком на поздних кругах, а номера вещей в помещении — сбиваться
 * от того, сколько из них стоят картонками. Ставит хук withSwap (world/props_all.ts) на время сборки уровня.
 */
export type FlatHook = (name: string, xf: Xf) => boolean;
let flatHook: FlatHook | null = null;

/** Выполнить body с хуком картонок. */
export function withFlatHook<T>(fn: FlatHook | null, body: () => T): T {
  const prev = flatHook;
  flatHook = fn;
  try {
    return body();
  } finally {
    flatHook = prev;
  }
}

/** Собрать предмет как объект уровня, если у этой сетки есть журнал объектов; иначе — просто собрать. */
export function asObject(xf: Xf, name: string, build: () => void, flat = false): void {
  const log = xf.mb.log;
  if (flat && flatHook && log?.takes && flatHook(name, xf)) return;
  if (log) log.wrap(xf, name, build, flat);
  else build();
}
