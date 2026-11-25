/**
 * Проходы свободны (партнёр 19.11: «расставь логично, с учётом лучших практик создания игровых уровней»; плейтест 19.11:
 * игроки не понимают, куда идти). Мебель игры не встаёт перед проходом — полоса FRONT в глубину комнаты и на 0,1 м шире проёма
 * с каждой стороны, — не занимает дорожку от прохода до середины его клетки и саму середину (там узел навигационной сетки:
 * по узлам ходят Осыпь и вещи сна) и не режет комнату на части: из главного входа можно дойти до каждого прохода, а свободный пол, где
 * помещается человек, остаётся одним куском. Проверка — по сетке STEP: точка сетки занята, если до преграды ближе радиуса
 * игрока; преграды ниже ступени перешагиваются, выше головы — над ней.
 *
 * Правило ставит обстановка (world/furnish.ts, furnishRoom) на время своей комнаты — в убежище и офисе; проверяет его хук
 * «не врастать» (world/objects.ts, withGrowthGuard; сборка уровня, world/level_build.ts): вещь, которая перегородила бы
 * проход, откатывается, и раскладка берёт другое место. Вещей партнёра правило не касается: их место — его решение.
 */
import type { Aabb, ColliderSet } from './colliders';
import type { RoomCtx } from './furnish';
import { FACE, planOf } from './room_plan';
import type { Door } from './room_plan';

/** Шаг сетки, м. */
export const STEP = 0.25;
/** Радиус игрока (player/controller.ts), м. */
export const BODY = 0.3;
/** Ступень: ниже — перешагивается (player/controller.ts, stepHeight). */
const STEP_UP = 0.36;
/** Выше — над головой. */
const HEAD = 1.8;
/** Полоса перед проходом, м. */
export const FRONT = 1.0;
/**
 * Кусок пола меньше стольких точек сетки — закуток (щель у стены, угол за урной), его не считаем: отрезанным считается кусок,
 * где человек может стоять и поворачиваться, — от полуквадратного метра свободы для середины тела.
 */
const MIN_PIECE = 8;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export class RoomFlow {
  /** Номера объектов уровня, поставленных обстановкой под этим правилом: с from + 1 по to (для проверок; ставит furnish.ts). */
  from = 0;
  to = 0;
  readonly doors: Door[];
  readonly entry: Door | null;
  /** Полосы перед проходами. */
  readonly fronts: Rect[];
  /** Дорожки от прохода до середины его клетки (по ним ведёт навигационная сетка: Осыпь, вещи сна, проверки маршрута). */
  readonly lanes: Rect[];
  /** Середины клеток с проходами: там стоит узел навигационной сетки, его не занимают. */
  readonly centers: [number, number][];
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly floor: number;
  /** Точка сетки — пол помещения (не стена, не чужая клетка). */
  private readonly inside: Uint8Array;
  /** Точки, с которых начинается обход: у главного входа (или у каждого прохода, если входа нет). */
  private readonly starts: number[];
  /** Точки у проходов, до которых обязано дойти. */
  private readonly goals: number[];

  constructor(ctx: RoomCtx) {
    const plan = planOf(ctx);
    this.doors = plan.doors;
    this.entry = plan.entry;
    this.floor = ctx.cells[0]?.xf.oy ?? 0;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const c of ctx.cells) {
      x0 = Math.min(x0, c.xf.ox - FACE);
      z0 = Math.min(z0, c.xf.oz - FACE);
      x1 = Math.max(x1, c.xf.ox + FACE);
      z1 = Math.max(z1, c.xf.oz + FACE);
    }
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / STEP));
    this.nz = Math.max(1, Math.ceil((z1 - z0) / STEP));
    this.inside = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const [px, pz] = this.pt(i, j);
        this.inside[j * this.nx + i] = ctx.cells.some((c) => {
          const dx = px - c.xf.ox;
          const dz = pz - c.xf.oz;
          if (Math.abs(dx) > 1.5 || Math.abs(dz) > 1.5) return false;
          // У своей клетки по соседству стены нет: пол идёт насквозь; у остальных сторон — до внутренней грани.
          const s = c.sides;
          const lim = (d: number): number => (s?.[d] === 'inner' ? 1.5 : FACE);
          return dx <= lim(0) && dz <= lim(1) && -dx <= lim(2) && -dz <= lim(3);
        })
          ? 1
          : 0;
      }
    }
    this.fronts = this.doors.map((d) => front(d));
    this.lanes = this.doors.map((d) => lane(d));
    this.centers = this.doors.map((d): [number, number] => [d.x - dirX(d.dir) * FACE, d.z - dirZ(d.dir) * FACE]);
    const at = (d: Door): number => this.index(d.x - dirX(d.dir) * (BODY + STEP), d.z - dirZ(d.dir) * (BODY + STEP));
    this.goals = this.doors.map(at).filter((k) => k >= 0);
    this.starts = this.entry ? [at(this.entry)].filter((k) => k >= 0) : this.goals.slice(0, 1);
  }

  private pt(i: number, j: number): [number, number] {
    return [this.x0 + (i + 0.5) * STEP, this.z0 + (j + 0.5) * STEP];
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / STEP);
    const j = Math.floor((z - this.z0) / STEP);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** Мешает ли коробка ходить (выше ступени и ниже головы). */
  private stops(b: Aabb): boolean {
    return b.maxY > this.floor + STEP_UP && b.minY < this.floor + HEAD && !b.ghost && !b.off;
  }

  /** Преграды помещения, мешающие ходить (кроме skip). */
  private around(col: ColliderSet, skip: ReadonlySet<Aabb>): Aabb[] {
    const near: Aabb[] = [];
    const x1 = this.x0 + this.nx * STEP;
    const z1 = this.z0 + this.nz * STEP;
    return col.query(this.x0 - BODY, this.z0 - BODY, x1 + BODY, z1 + BODY, near).filter((b) => !skip.has(b) && this.stops(b));
  }

  /** Занять точки пола, до которых от преград boxes ближе радиуса игрока. */
  private fill(free: Uint8Array, boxes: readonly Aabb[]): void {
    for (const b of boxes) {
      const i0 = Math.max(0, Math.floor((b.minX - BODY - this.x0) / STEP));
      const i1 = Math.min(this.nx - 1, Math.floor((b.maxX + BODY - this.x0) / STEP));
      const j0 = Math.max(0, Math.floor((b.minZ - BODY - this.z0) / STEP));
      const j1 = Math.min(this.nz - 1, Math.floor((b.maxZ + BODY - this.z0) / STEP));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const [px, pz] = this.pt(i, j);
          const dx = Math.max(b.minX - px, 0, px - b.maxX);
          const dz = Math.max(b.minZ - pz, 0, pz - b.maxZ);
          if (dx * dx + dz * dz < BODY * BODY) free[j * this.nx + i] = 0;
        }
      }
    }
  }

  /** Куски свободного пола: сколько их (не меньше MIN_PIECE точек) и все ли проходы в куске главного входа. */
  private pieces(free: Uint8Array): { count: number; doorsOk: boolean } {
    const seen = new Int32Array(free.length).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let k = 0; k < free.length; k++) {
      if (!free[k] || seen[k]! >= 0) continue;
      const id = sizes.length;
      let n = 0;
      seen[k] = id;
      stack.push(k);
      while (stack.length) {
        const q = stack.pop()!;
        n += 1;
        const i = q % this.nx;
        const j = (q - i) / this.nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
          const r = b * this.nx + a;
          if (!free[r] || seen[r]! >= 0) continue;
          seen[r] = id;
          stack.push(r);
        }
      }
      sizes.push(n);
    }
    const count = sizes.filter((n) => n >= MIN_PIECE).length;
    const home = this.starts.map((k) => seen[k]!).find((id) => id >= 0);
    const doorsOk = home === undefined ? true : this.goals.every((k) => seen[k] === home || seen[k] === -1 || !this.inside[k]);
    return { count, doorsOk };
  }

  /**
   * Перегородит ли вещь, только что получившая преграды col.boxes[c0…], проход: встала в полосу перед ним, отрезала проход от
   * главного входа или разрезала свободный пол на большее число кусков, чем было без неё.
   */
  blocks(col: ColliderSet, c0: number): boolean {
    const mine: Aabb[] = [];
    for (let i = c0; i < col.boxes.length; i++) if (this.stops(col.boxes[i]!)) mine.push(col.boxes[i]!);
    if (mine.length === 0) return false;
    const hits = (b: Aabb, r: Rect): boolean => b.minX < r.x1 - 0.02 && b.maxX > r.x0 + 0.02 && b.minZ < r.z1 - 0.02 && b.maxZ > r.z0 + 0.02;
    for (const b of mine) {
      if (this.fronts.some((r) => hits(b, r)) || this.lanes.some((r) => hits(b, r))) return true;
      for (const [cx, cz] of this.centers) {
        const dx = Math.max(b.minX - cx, 0, cx - b.maxX);
        const dz = Math.max(b.minZ - cz, 0, cz - b.maxZ);
        if (dx * dx + dz * dz < BODY * BODY) return true;
      }
    }
    const before = this.inside.slice();
    // Тени вещей игры, которые партнёр убрал или передвинул (world/colliders.ts, Shadow): для остальной обстановки они стоят, где
    // стояли, — и для проходов тоже. Иначе на месте убранной вещи открывался «карман», и соседняя вещь будто отрезала его от
    // комнаты: убранная первая картотека роняла ряд у соседней стены из трёх до одной (placed.test.ts, 25.11).
    this.fill(before, [...this.around(col, new Set(col.boxes.slice(c0))), ...col.shadows.map((s) => s.box).filter((b) => this.stops(b))]);
    const was = this.pieces(before);
    const after = before.slice();
    this.fill(after, mine);
    const now = this.pieces(after);
    if (was.doorsOk && !now.doorsOk) return true;
    return now.count > was.count;
  }
}

const dirX = (d: number): number => (d === 0 ? 1 : d === 2 ? -1 : 0);
const dirZ = (d: number): number => (d === 1 ? 1 : d === 3 ? -1 : 0);

/** Полоса перед проходом: от внутренней грани стены FRONT в комнату, на 0,1 м шире проёма с каждой стороны (у открытого ребра — 1,3 м по середине). */
function front(d: Door): Rect {
  const half = (d.kind === 'door' ? d.w : 1.1) / 2 + 0.1;
  const ix = -dirX(d.dir);
  const iz = -dirZ(d.dir);
  const ax = d.x + ix * FRONT;
  const az = d.z + iz * FRONT;
  if (d.dir % 2 === 0) return { x0: Math.min(d.x, ax), x1: Math.max(d.x, ax), z0: d.z - half, z1: d.z + half };
  return { x0: d.x - half, x1: d.x + half, z0: Math.min(d.z, az), z1: Math.max(d.z, az) };
}

/** Дорожка от середины проёма до середины клетки, шириной в человека. */
function lane(d: Door): Rect {
  const cx = d.x - dirX(d.dir) * FACE;
  const cz = d.z - dirZ(d.dir) * FACE;
  if (d.dir % 2 === 0) return { x0: Math.min(d.x, cx), x1: Math.max(d.x, cx), z0: d.z - BODY, z1: d.z + BODY };
  return { x0: d.x - BODY, x1: d.x + BODY, z0: Math.min(d.z, cz), z1: Math.max(d.z, cz) };
}

let current: RoomFlow | null = null;
let watcher: ((f: RoomFlow) => void) | null = null;

/** Сообщать о каждом правиле проходов, под которым обставлено помещение (для проверок; null — не сообщать). */
export function watchFlows(fn: ((f: RoomFlow) => void) | null): void {
  watcher = fn;
}

/** Обставлено помещение под правилом f (зовёт furnish.ts). */
export function flowDone(f: RoomFlow): void {
  watcher?.(f);
}

/** Выполнить body с правилом проходов помещения (null — без него). */
export function withFlow<T>(flow: RoomFlow | null, body: () => T): T {
  const prev = current;
  current = flow;
  try {
    return body();
  } finally {
    current = prev;
  }
}

/** Держит ли помещение, которое сейчас обставляется, проходы свободными. */
export function flowActive(): boolean {
  return current !== null;
}

/** Перегородит ли проход вещь с преградами col.boxes[c0…] (правила нет — нет). Для хука «не врастать» (level_build.ts). */
export function flowBlocks(col: ColliderSet, c0: number): boolean {
  return current !== null && current.blocks(col, c0);
}
