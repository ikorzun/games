/**
 * Где встают фигуры партнёра. Правило фигуры (world/figures.ts) — не точка, а «у чего, лицом куда, на
 * какой высоте»: план места строится из сида, и точка на одном плане ничего не значит на другом. Здесь
 * правило превращается в точки настоящих помещений уровня — так же, как конструктор (tools/constructor)
 * ставит фигуру в комнату-образец:
 * - угол: 0,38 м от обеих стен, «в комнату» — по диагонали от угла;
 * - стена: 0,3 м от глухой стены, «в комнату» — от стены;
 * - дверь: в самом проёме, «в комнату» — внутрь помещения;
 * - середина и потолок: середина клетки, «в комнату» — спиной к ближайшему проходу; под потолком фигура
 *   поднята не ниже 0,6 м и не упирается в потолок.
 * Сдвиг партнёра поворачивается вместе с краем: x — вдоль стены, z — от стены в комнату.
 * «Лицом куда»: в комнату, в стену (ближайшую), на дверь (ближайший проход), туда, откуда придёт игрок
 * (проход, ближайший к началу места).
 *
 * Фигура не врастает в мебель и стены (точки скелета проверяются по преградам уровня), не стоит над
 * провалом (если не висит в воздухе), не стоит у самого начала и не лезет вплотную к другой фигуре.
 * Помещения и края перебираются по сиду уровня и ключу фигуры: тот же сид — те же места; правка одной
 * фигуры не сдвигает остальные. Фигур, для которых места не нашлось, на уровне просто нет.
 *
 * Чистый TS: работает в сборке уровня (Worker) и в тестах.
 */
import { hash01, hash2 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { GRID } from '../gen/layout';
import type { GenLayout, GenRoom } from '../gen/layout';
import type { Aabb, ColliderSet } from './colliders';
import type { FigureAnchor, FigureFacing, FigureSpec } from './figures';
import { skeleton, skeletonPoints } from './props_people';
import { CELL, DIRS, WALL_T } from './shell';
import type { Shell } from './shell';

const HALF = GRID / 2;
const T = WALL_T / 2;
/** Отступы от стен, как в инструменте, м. */
const CORNER_OFF = 0.38;
const WALL_OFF = 0.3;
/** Не ближе к началу места и не ближе друг к другу, м. */
const SPAWN_CLEAR = 3.2;
const APART = 1.6;
/** Под потолком фигура висит не ниже этого, м (как в инструменте). */
const CEILING_LIFT = 0.6;

/** Где встала фигура: её ключ, номер экземпляра, точка (подошвы — y), поворот и помещение. */
export interface FigureSpot {
  id: string;
  k: number;
  at: Vec3;
  yaw: number;
  room: number;
  tier: number;
}

/** Край правила в настоящем помещении: точка на полу и направления «лицом куда» (рад; 0 — к +z). */
export interface AnchorSpot {
  anchor: FigureAnchor;
  x: number;
  z: number;
  floor: number;
  ceil: number;
  /** «В комнату»: внутренняя нормаль края. */
  phi: number;
  /** «В стену»: на ближайшую стену. */
  wall: number;
  /** «На дверь»: на ближайший проход помещения. */
  door: number;
  /** «Откуда придёт игрок»: на проход, ближайший к началу места. */
  entry: number;
  room: number;
  tier: number;
  /** Под точкой нет пола (провал). */
  pit: boolean;
}

/** Что расстановке нужно знать об уровне. */
export interface PlaceWorld {
  layout: GenLayout;
  shells: readonly Shell[];
  col: ColliderSet;
  /** Помещения, куда фигуры не ставятся (нижние части шахт, комната-аномалия). */
  skip: ReadonlySet<number>;
  /** Начало места: там фигур нет; к ближайшему от него проходу смотрят фигуры «лицом к игроку». */
  spawn: Vec3;
  spawnTier: number;
}

/** Помещения, где фигур не бывает вовсе: лестничные марши, лифт, пути под перроном. */
const NEVER: ReadonlySet<string> = new Set(['stairwell', 'lift', 'track']);

const angleOf = (x: number, z: number): number => Math.atan2(x, z);

interface Door {
  x: number;
  z: number;
}

/** Края правила во всём помещении (порядок постоянный: клетки по порядку, направления по порядку). */
export function anchorSpots(room: GenRoom, anchor: FigureAnchor, w: PlaceWorld): AnchorSpot[] {
  const sh = w.shells[room.tier]!;
  const out: AnchorSpot[] = [];
  const doors: Door[] = [];
  const walls: Door[] = [];
  const cells = room.cells.map(([x, z]) => ({ sx: x - HALF, sz: z - HALF }));
  for (const { sx, sz } of cells) {
    for (let d = 0; d < 4; d++) {
      const k = sh.edge(sx, sz, d);
      const nb = sh.get(sx + DIRS[d]![0], sz + DIRS[d]![1]);
      const px = sx * CELL + DIRS[d]![0] * (CELL / 2);
      const pz = sz * CELL + DIRS[d]![1] * (CELL / 2);
      if (k === 'door' || (k === 'open' && nb !== undefined && nb.room !== room.id)) doors.push({ x: px, z: pz });
      else if (k === 'wall') walls.push({ x: px, z: pz });
    }
  }
  const nearest = (list: readonly Door[], x: number, z: number): Door | null => {
    let best: Door | null = null;
    let bd = Infinity;
    for (const p of list) {
      const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (dd > 0.25 && dd < bd - 1e-6) {
        bd = dd;
        best = p;
      }
    }
    return best;
  };
  // Вход: проход, ближайший к началу места (на другом ярусе начало далеко — тогда просто ближайший по плану).
  const sx0 = w.spawn[0];
  const sz0 = w.spawn[2];
  const inStart = room.tier === w.spawnTier && cells.some(({ sx, sz }) => Math.abs(sx * CELL - sx0) <= CELL / 2 && Math.abs(sz * CELL - sz0) <= CELL / 2);
  const entryDoor = inStart ? { x: sx0, z: sz0 } : nearest(doors, sx0, sz0);
  const facing = (x: number, z: number, phi: number): Pick<AnchorSpot, 'wall' | 'door' | 'entry'> => {
    const wl = nearest(walls, x, z);
    const dr = nearest(doors, x, z);
    const en = entryDoor && (entryDoor.x - x) ** 2 + (entryDoor.z - z) ** 2 > 0.25 ? entryDoor : null;
    return {
      wall: wl ? angleOf(wl.x - x, wl.z - z) : phi + Math.PI,
      door: dr ? angleOf(dr.x - x, dr.z - z) : phi + Math.PI,
      entry: en ? angleOf(en.x - x, en.z - z) : phi + Math.PI,
    };
  };
  const solid = (sx: number, sz: number, d: number): boolean => {
    const k = sh.edge(sx, sz, d);
    return k === 'wall' || k === 'door';
  };
  for (const { sx, sz } of cells) {
    const cell = sh.get(sx, sz)!;
    const base = { floor: cell.floorY, ceil: cell.ceilY, room: room.id, tier: room.tier, pit: cell.noFloor === true, anchor };
    const cx = sx * CELL;
    const cz = sz * CELL;
    if (anchor === 'corner') {
      for (let d = 0; d < 4; d++) {
        const e = (d + 1) % 4;
        if (!solid(sx, sz, d) || !solid(sx, sz, e)) continue;
        const a = DIRS[d]!;
        const b = DIRS[e]!;
        const x = cx + (a[0] + b[0]) * (CELL / 2 - T - CORNER_OFF);
        const z = cz + (a[1] + b[1]) * (CELL / 2 - T - CORNER_OFF);
        const phi = angleOf(-(a[0] + b[0]), -(a[1] + b[1]));
        out.push({ ...base, x, z, phi, ...facing(x, z, phi), wall: phi + Math.PI });
      }
    } else if (anchor === 'wall') {
      for (let d = 0; d < 4; d++) {
        if (sh.edge(sx, sz, d) !== 'wall') continue;
        const a = DIRS[d]!;
        const x = cx + a[0] * (CELL / 2 - T - WALL_OFF);
        const z = cz + a[1] * (CELL / 2 - T - WALL_OFF);
        const phi = angleOf(-a[0], -a[1]);
        out.push({ ...base, x, z, phi, ...facing(x, z, phi), wall: phi + Math.PI });
      }
    } else if (anchor === 'door') {
      for (let d = 0; d < 4; d++) {
        const a = DIRS[d]!;
        const k = sh.edge(sx, sz, d);
        const nb = sh.get(sx + a[0], sz + a[1]);
        if (!(k === 'door' || (k === 'open' && nb !== undefined && nb.room !== room.id))) continue;
        const x = cx + a[0] * (CELL / 2);
        const z = cz + a[1] * (CELL / 2);
        const phi = angleOf(-a[0], -a[1]);
        // В проёме «на дверь» и «в стену» — одно: лицом наружу, в проход.
        out.push({ ...base, x, z, phi, ...facing(x, z, phi), wall: phi + Math.PI, door: phi + Math.PI });
      }
    } else {
      // Середина и потолок: «в комнату» — спиной к ближайшему проходу (нет прохода — спиной к ближайшей стене).
      const dr = nearest(doors, cx, cz) ?? nearest(walls, cx, cz);
      const phi = dr ? angleOf(cx - dr.x, cz - dr.z) : 0;
      out.push({ ...base, x: cx, z: cz, phi, ...facing(cx, cz, phi) });
    }
  }
  return out;
}

const yawFor = (a: AnchorSpot, f: FigureFacing): number => (f === 'room' ? a.phi : f === 'wall' ? a.wall : f === 'door' ? a.door : a.entry);

/** Ключ фигуры числом: от него — свой порядок перебора мест у каждой фигуры. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Точка фигуры по правилу: край + сдвиг, высота, поворот. Как в конструкторе (tools/constructor/main.ts). */
export function fitSpot(spec: FigureSpec, a: AnchorSpot, top: number): { at: Vec3; yaw: number } {
  const c = Math.cos(a.phi);
  const s = Math.sin(a.phi);
  const [ox, oz] = spec.offset;
  const x = a.x + ox * c + oz * s;
  const z = a.z - ox * s + oz * c;
  let lift = spec.rule.anchor === 'ceiling' ? Math.max(spec.rule.lift, CEILING_LIFT) : spec.rule.lift;
  // Выше потолка не поднимается: макушка (или поднятые руки) остаётся под ним.
  lift = Math.max(0, Math.min(lift, a.ceil - a.floor - 0.04 - top));
  return { at: [x, a.floor + lift, z], yaw: yawFor(a, spec.rule.facing) + (spec.yaw * Math.PI) / 180 };
}

/** Точки скелета фигуры в мире; первые пять — тело (проверяются с большим запасом). */
function worldPoints(local: readonly Vec3[], at: Vec3, yaw: number): Vec3[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return local.map((p) => [at[0] + p[0] * c + p[2] * s, at[1] + p[1], at[2] - p[0] * s + p[2] * c]);
}

const scratch: Aabb[] = [];

/**
 * Фигура в этой точке не врастает ни во что: ни одна точка скелета не задевает преграду. Плита пола
 * (верх не выше пола помещения) не в счёт: на ней фигура стоит.
 */
function clear(col: ColliderSet, pts: readonly Vec3[], core: number, floor: number): boolean {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const r = i < core ? 0.12 : 0.05;
    col.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, scratch);
    for (const b of scratch) {
      if (b.maxY <= floor + 0.02) continue;
      if (b.minX < p[0] + r && b.maxX > p[0] - r && b.minY < p[1] + r && b.maxY > p[1] - r && b.minZ < p[2] + r && b.maxZ > p[2] - r) return false;
    }
  }
  return true;
}

/**
 * Расставить фигуры по уровню. Фигура встаёт, только если её место в правиле (rule.worlds) и есть
 * помещение нужного типа; сколько — rule.count, по возможности в разных помещениях.
 */
/**
 * Где в помещении точка: доли его рамки по x и z (0…1). Так «у какой стены партнёр отпустил вещь или фигуру» переносится
 * на помещения другой формы и размера (PlacedSpec.near, FigureSpec.near).
 */
export function roomNear(room: GenRoom, x: number, z: number): [number, number] {
  const xs = room.cells.map((c) => (c[0] - HALF) * CELL);
  const zs = room.cells.map((c) => (c[1] - HALF) * CELL);
  const x0 = Math.min(...xs) - CELL / 2;
  const x1 = Math.max(...xs) + CELL / 2;
  const z0 = Math.min(...zs) - CELL / 2;
  const z1 = Math.max(...zs) + CELL / 2;
  const f = (v: number, a: number, b: number): number => Math.max(0, Math.min(1, (v - a) / (b - a)));
  return [Math.round(f(x, x0, x1) * 1000) / 1000, Math.round(f(z, z0, z1) * 1000) / 1000];
}

/** roomOk — пускает ли фигуру в помещение сверх её правила (вариант расстановки, world/variants.ts); нет — пускает. */
export function placeFigures(specs: readonly FigureSpec[], w: PlaceWorld, roomOk?: (spec: FigureSpec, room: GenRoom) => boolean): FigureSpot[] {
  const out: FigureSpot[] = [];
  const world = w.layout.world;
  for (const spec of specs) {
    if (!spec.rule.worlds.includes(world)) continue;
    const rooms = w.layout.rooms.filter((r) => !w.skip.has(r.id) && !NEVER.has(r.type) && (spec.rule.rooms.length === 0 || spec.rule.rooms.includes(r.type)) && (!roomOk || roomOk(spec, r)));
    if (rooms.length === 0) continue;
    // Тело — таз, поясница, грудь, основание шеи, макушка; остальное — руки и ноги.
    const sk = skeleton(spec.pose);
    const pts = skeletonPoints(sk);
    const local: Vec3[] = [sk.pelvis, sk.waist, sk.chestC, sk.neckBase, pts[17]!, ...pts.filter((_, i) => i !== 0 && i !== 1 && i !== 2 && i !== 3 && i !== 17)];
    const top = Math.max(...pts.map((p) => p[1]));
    const h = idHash(spec.id);
    const cands = rooms.flatMap((r) => anchorSpots(r, spec.rule.anchor, w).map((a) => ({ a, r })));
    const used = new Set<number>();
    // Сначала край, ближайший к тому, где фигуру поставили (near; в каждом помещении — у того же его края), потом — по жребию.
    const near = spec.near;
    const cost = (a: AnchorSpot, r: GenRoom): number => {
      if (!near) return 0;
      const [u, v] = roomNear(r, a.x, a.z);
      return Math.round(Math.hypot(u - near[0], v - near[1]) * 1000) / 1000;
    };
    for (let k = 0; k < spec.rule.count; k++) {
      const order = cands.map(({ a, r }, i) => ({ a, d: cost(a, r), r: hash01(i * 7 + 1, k * 131 + 17, hash2(w.layout.seed, h, 0x5f19)) })).sort((p, q) => p.d - q.d || p.r - q.r);
      let pick: FigureSpot | null = null;
      for (const pass of [0, 1]) {
        for (const { a } of order) {
          if (pass === 0 && used.has(a.room)) continue;
          if (a.pit && spec.rule.lift < 0.3) continue;
          const { at, yaw } = fitSpot(spec, a, top);
          if (a.tier === w.spawnTier && Math.hypot(at[0] - w.spawn[0], at[2] - w.spawn[2]) < SPAWN_CLEAR) continue;
          if (out.some((f) => f.tier === a.tier && Math.hypot(f.at[0] - at[0], f.at[2] - at[2]) < APART)) continue;
          if (!clear(w.col, worldPoints(local, at, yaw), 5, a.floor)) continue;
          pick = { id: spec.id, k, at, yaw, room: a.room, tier: a.tier };
          break;
        }
        if (pick) break;
      }
      if (!pick) break;
      used.add(pick.room);
      out.push(pick);
    }
  }
  return out;
}
