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

/** Сколько объектов помещается в текстуру состояний рендера (64 × 64). */
export const MAX_OBJECTS = 4095;

export class ObjectLog {
  readonly list: LevelObject[] = [];
  /** Номер объекта, который сейчас собирается (0 — никакой). */
  private open = 0;

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

/** Собрать предмет как объект уровня, если у этой сетки есть журнал объектов; иначе — просто собрать. */
export function asObject(xf: Xf, name: string, build: () => void, flat = false): void {
  const log = xf.mb.log;
  if (log) log.wrap(xf, name, build, flat);
  else build();
}
