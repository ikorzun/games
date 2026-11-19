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
import type { ColliderSet } from './colliders';
import type { MeshBuilder, MeshMark } from './kit';
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

/**
 * Высоты граней tris (девять чисел на грань, MeshBuilder.upFaces) прямо над или под точкой (x, z) — между lo и hi: на что
 * ляжет вещь, опущенная сюда сверху.
 */
export function facesAt(tris: Float32Array, x: number, z: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = 0; k + 8 < tris.length; k += 9) {
    const ax = tris[k]!;
    const az = tris[k + 2]!;
    const bx = tris[k + 3]!;
    const bz = tris[k + 5]!;
    const cx = tris[k + 6]!;
    const cz = tris[k + 8]!;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const y = u * tris[k + 1]! + v * tris[k + 4]! + (1 - u - v) * tris[k + 7]!;
    if (y >= lo && y <= hi) out.push(y);
  }
  return out;
}

export class ObjectLog {
  readonly list: LevelObject[] = [];
  /** Номер объекта, который сейчас собирается (0 — никакой). */
  private open = 0;
  /**
   * Где сетка каждой вещи: отрезок треугольников её сборщика (пока идёт сборка) или уже только её верхние грани (после freeze и
   * после первого вопроса — сетка мебели к расстановке вещей партнёра готова). По ним — поверхности под точкой (surfaces).
   */
  private readonly spans = new Map<number, { mb: MeshBuilder; i0: number; i1: number } | Float32Array>();

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
   * его номером. Внутри другого объекта (или когда номера кончились) — просто собрать. guard — проверять ли, не врастает ли
   * предмет в уже стоящие (withGrowthGuard): врастает — собранное откатывается, объекта нет, ответ false.
   */
  wrap(xf: Xf, name: string, build: () => void, flat = false, guard = true, partner = false): boolean {
    if (this.open !== 0 || this.list.length >= MAX_OBJECTS) {
      build();
      return true;
    }
    const id = this.list.length + 1;
    const v0 = xf.mb.vertexCount;
    const s0 = xf.sl ? xf.sl.vertexCount : 0;
    const c0 = xf.col ? xf.col.boxes.length : 0;
    const m0 = xf.mb.mark();
    const ms = xf.sl ? xf.sl.mark() : null;
    this.open = id;
    xf.mb.obj = id;
    if (xf.sl) xf.sl.obj = id;
    if (xf.col) {
      xf.col.owner = id;
      xf.col.partner = partner;
    }
    try {
      build();
    } finally {
      this.open = 0;
      xf.mb.obj = 0;
      if (xf.sl) xf.sl.obj = 0;
      if (xf.col) {
        xf.col.owner = 0;
        xf.col.partner = false;
      }
    }
    // Не врастать в соседнюю мебель (партнёр 18.11): врастает — как не собирали.
    if (guard && growthGuard && xf.col && growthGuard(name, xf.col, c0, this.list)) {
      xf.mb.rewind(m0);
      if (xf.sl && ms) xf.sl.rewind(ms);
      xf.col.rewind(c0);
      return false;
    }
    const a = xf.mb.bounds(v0);
    const b = xf.sl ? xf.sl.bounds(s0) : null;
    // Предмет, от которого не осталось ни одной вершины, объектом не считается: его преграды — ничьи.
    if (!a && !b) {
      if (xf.col) for (let i = c0; i < xf.col.boxes.length; i++) if (xf.col.boxes[i]!.owner === id) delete xf.col.boxes[i]!.owner;
      return true;
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
    if (a) this.spans.set(id, { mb: xf.mb, i0: m0.i, i1: xf.mb.mark().i });
    return true;
  }

  /**
   * Высоты верхних граней вещи id над или под точкой (x, z) между lo и hi (столешница, сиденье, крышка тумбы, хлебница на
   * столе — что именно под точкой). undefined — сетка вещи не известна.
   */
  surfaces(id: number, x: number, z: number, lo: number, hi: number): number[] | undefined {
    let s = this.spans.get(id);
    if (!s) return undefined;
    if (!(s instanceof Float32Array)) {
      s = s.mb.upFaces(s.i0, s.i1);
      this.spans.set(id, s);
    }
    return facesAt(s, x, z, lo, hi);
  }

  /** После сборки: оставить от сеток только верхние грани (сборщики больше не держать). */
  freeze(): void {
    for (const [id, s] of this.spans) if (!(s instanceof Float32Array)) this.spans.set(id, s.mb.upFaces(s.i0, s.i1));
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

/**
 * Проверка «врастает ли вещь в соседнюю» (партнёр 18.11: «убери врастание мебели в соседнюю»; world/clearance.ts): по
 * преградам, которые вещь только что получила (с номера c0), и журналу стоящих. true — врастает, вещь не ставится. Ставит
 * сборка уровня на время обстановки (world/level_build.ts); вещам партнёра и фигурам — нет: их место проверено своё.
 */
export type GrowthGuard = (name: string, col: ColliderSet, c0: number, objects: readonly LevelObject[]) => boolean;
let growthGuard: GrowthGuard | null = null;

/** Выполнить body с проверкой «не врастать» (null — без неё). */
export function withGrowthGuard<T>(fn: GrowthGuard | null, body: () => T): T {
  const prev = growthGuard;
  growthGuard = fn;
  try {
    return body();
  } finally {
    growthGuard = prev;
  }
}

/** Отметка для отката группы вещей (стопка у стены): сетка, проекции, преграды и журнал объектов. */
export interface BuildMark {
  mb: MeshMark;
  sl: MeshMark | null;
  col: number;
  shadows: number;
  objects: number;
}

/** Отметка сборки в точке xf; null — у этой сетки нет журнала (вещь собирается не на уровне — откатывать нечего). */
export function markBuild(xf: Xf): BuildMark | null {
  const log = xf.mb.log;
  if (!log) return null;
  return { mb: xf.mb.mark(), sl: xf.sl ? xf.sl.mark() : null, col: xf.col ? xf.col.boxes.length : 0, shadows: xf.col ? xf.col.shadows.length : 0, objects: log.list.length };
}

/** Откатить всё, что собрано в сетку, проекции, преграды и журнал xf после отметки m (группа встала не целиком). */
export function rewindBuild(xf: Xf, m: BuildMark): void {
  xf.mb.rewind(m.mb);
  if (xf.sl && m.sl) xf.sl.rewind(m.sl);
  if (xf.col) {
    xf.col.rewind(m.col);
    xf.col.shadows.length = m.shadows;
  }
  if (xf.mb.log) xf.mb.log.list.length = m.objects;
}

/**
 * Собрать предмет как объект уровня, если у этой сетки есть журнал объектов; иначе — просто собрать. false — предмет не встал:
 * врастал в соседний (withGrowthGuard) или это картонка, которую партнёр убрал. guard = false — не проверять; partner — вещь
 * партнёра (замена): её преграды проверка «не врастать» не видит (world/clearance.ts).
 */
export function asObject(xf: Xf, name: string, build: () => void, flat = false, guard = true, partner = false): boolean {
  const log = xf.mb.log;
  if (flat && flatHook && log?.takes && flatHook(name, xf)) return false;
  if (log) return log.wrap(xf, name, build, flat, guard, partner);
  build();
  return true;
}
