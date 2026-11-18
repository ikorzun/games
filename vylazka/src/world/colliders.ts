import type { WallCut } from './wall_gone';
/**
 * Коллайдеры мира: осевые параллелепипеды в пространственном хеше по XZ.
 * Чистый TS: используется контроллером игрока, лучами (дистанция луча фонаря, видимость) и тестами.
 */

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Группа: коробки одной группы включаются и выключаются разом (обстановка варианта комнаты). */
  group?: string;
  /** Коробка выключена: игрок и лучи её не замечают. */
  off?: boolean;
  /**
   * Чья это коробка: номер объекта уровня (world/objects.ts) — больше нуля; преграда отдельной вещи сна —
   * меньше нуля (минус её номер). Упёрся в такую коробку — коснулся предмета.
   */
  owner?: number;
  /** Предмет растворён: коробки нет, пока он не вернётся. Отдельно от off: группы вариантов комнат его не трогают. */
  gone?: boolean;
  /** Датчик касания, а не преграда: пройти не мешает, лучи не останавливает — только сообщает, что её задели. */
  ghost?: boolean;
  /** Стена между клетками, в которой на поздних кругах открываются прорехи (world/wall_gone.ts). */
  cut?: WallCut;
  /** Преграда вещи, которую поставил партнёр (замена вещи игры): проверка «не врастать» её не видит (world/clearance.ts). */
  partner?: boolean;
  /**
   * Лучи проходят насквозь, тело — нет: преграда вещи, которую ищут (партнёр 18.11, 16:02: она не растворяется — значит,
   * держит, как всё настоящее). Взгляд, свет и проверки видимости на ней не застревают: вспоминают её взглядом.
   */
  clear?: boolean;
}

/**
 * Тень вещи игры, которую партнёр убрал, передвинул или заменил (world/props_all.ts): игроку и лучам её нет, но проверка «не
 * врастать» (world/clearance.ts) видит её на прежнем месте — чтобы остальная обстановка вставала так же, как в конструкторе,
 * где этой записи ещё нет, и номера вещей в помещении не съезжали. Тенью же держится место, отведённое заранее под вещь,
 * которая встанет последним проходом (стена чемоданов, стена лиц; world/furnish_papers.ts).
 */
export interface Shadow {
  box: Aabb;
  name: string;
  /** Отведённое место (world/furnish_papers.ts): снимается перед тем, как на нём встанет сама вещь. */
  key?: string;
}

const CELL = 2;

export class ColliderSet {
  readonly boxes: Aabb[] = [];
  /** Кому достаются новые коробки (0 — никому): ставит и снимает world/objects.ts, пока собирается предмет. */
  owner = 0;
  /** Новые коробки — вещи партнёра (Aabb.partner): ставит и снимает world/objects.ts. */
  partner = false;
  /** Тени убранных, передвинутых и заменённых партнёром вещей игры (Shadow). */
  readonly shadows: Shadow[] = [];
  private readonly grid = new Map<number, number[]>();
  private stamp = 0;
  private readonly seen: number[] = [];

  private key(cx: number, cz: number): number {
    // Ячейки в пределах ±32768 — уровню с запасом.
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }

  add(box: Aabb): number {
    const id = this.boxes.length;
    if (this.owner !== 0 && box.owner === undefined) box.owner = this.owner;
    if (this.partner) box.partner = true;
    this.boxes.push(box);
    this.seen.push(0);
    const x0 = Math.floor(box.minX / CELL);
    const x1 = Math.floor(box.maxX / CELL);
    const z0 = Math.floor(box.minZ / CELL);
    const z1 = Math.floor(box.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(id);
      }
    }
    return id;
  }

  /**
   * Откатить к n коробкам (вещь, которая не встала, — world/objects.ts): добавленные после — прочь, и из сетки поиска. Номера
   * растут по порядку добавления, поэтому в списке каждой ячейки последней стоит самая поздняя коробка.
   */
  rewind(n: number): void {
    for (let id = this.boxes.length - 1; id >= n; id--) {
      const box = this.boxes[id]!;
      const x0 = Math.floor(box.minX / CELL);
      const x1 = Math.floor(box.maxX / CELL);
      const z0 = Math.floor(box.minZ / CELL);
      const z1 = Math.floor(box.maxZ / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const list = this.grid.get(this.key(cx, cz));
          if (list && list[list.length - 1] === id) list.pop();
        }
      }
    }
    if (this.boxes.length > n) {
      this.boxes.length = n;
      this.seen.length = n;
    }
  }

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
    return this.add({ minX, minY, minZ, maxX, maxY, maxZ });
  }

  /** Все коробки, чьи ячейки пересекают прямоугольник XZ (без повторов); результат — в out. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[] {
    out.length = 0;
    this.stamp += 1;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const id of list) {
          if (this.seen[id] === this.stamp) continue;
          this.seen[id] = this.stamp;
          const box = this.boxes[id]!;
          if (!box.off && !box.gone) out.push(box);
        }
      }
    }
    return out;
  }

  /** Включить или выключить все коробки группы. */
  setGroup(group: string, on: boolean): void {
    for (const b of this.boxes) if (b.group === group) b.off = !on;
  }

  /**
   * Луч до первой коробки: расстояние или maxDist, если ничего не задето.
   * Направление должно быть нормировано.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    const scratch = this.rayScratch;
    this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), scratch);
    let best = maxDist;
    for (const b of scratch) {
      if (b.ghost || b.clear) continue;
      const t = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  private readonly rayScratch: Aabb[] = [];
}

/** Пересечение луча с коробкой методом плит: расстояние входа (0, если начало внутри) или -1. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Aabb): number {
  let tMin = 0;
  let tMax = Infinity;
  const axis = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    return tMin <= tMax;
  };
  if (!axis(ox, dx, b.minX, b.maxX)) return -1;
  if (!axis(oy, dy, b.minY, b.maxY)) return -1;
  if (!axis(oz, dz, b.minZ, b.maxZ)) return -1;
  return tMin;
}
