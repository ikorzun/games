/**
 * Генератор плана бункера: ярусы на сетке клеток 3 м, коридоры, помещения, лестницы между ярусами.
 *
 * Порядок: вход и шлюз → хребет-коридор → ответвления → лестница вниз (резерв клеток на обоих ярусах)
 * → явное замыкание циклов → помещения из квот яруса → проверка. Неудачная попытка перезапускается
 * с новым зерном от (seed, attempt). Только целочисленный ГСЧ и целые числа: сохранение хранит сид
 * и должно дать тот же уровень на любом устройстве. При изменении алгоритма поднимается GEN_VERSION.
 */
import { hash2, mulberry32 } from '../core/rng';
import type { Rng } from '../core/rng';

export const GEN_VERSION = 1;
/** Клеток по стороне яруса. */
export const GRID = 16;
/** Перепад между ярусами, м. */
export const TIER_DROP = 4.5;
/** Высота потолка, м. */
export const CEIL_H = 2.7;
/** Длина лестничного марша в клетках (30 ступеней по 0,15 × 0,30 м на 4,5 м высоты). */
export const STAIR_CELLS = 3;

/** Направления: 0 — +x, 1 — +z, 2 — −x, 3 — −z. */
export type Dir = 0 | 1 | 2 | 3;
export const DX: readonly number[] = [1, 0, -1, 0];
export const DZ: readonly number[] = [0, 1, 0, -1];
const opposite = (d: number): Dir => ((d + 2) % 4) as Dir;

export type RoomType =
  | 'corridor'
  | 'entrance'
  | 'airlock'
  | 'stairwell'
  | 'dorm'
  | 'command'
  | 'medical'
  | 'storage'
  | 'washroom'
  | 'fvu'
  | 'diesel'
  | 'tanks'
  | 'switchboard'
  | 'archive'
  | 'collapsed';

export interface GenRoom {
  id: number;
  type: RoomType;
  tier: number;
  cells: Array<[number, number]>;
}

export type EdgeKind = 'door' | 'hermo' | 'open';

/** Проход между клетками разных помещений. Ребро каноническое: dir — 0 (к +x) или 1 (к +z). */
export interface GenEdge {
  tier: number;
  cx: number;
  cz: number;
  dir: 0 | 1;
  kind: EdgeKind;
}

/**
 * Лестница вниз. (cx, cz) — верхняя площадка на ярусе upperTier; марш занимает клетки +1…+STAIR_CELLS
 * вдоль dir на обоих ярусах; нижняя площадка — клетка +STAIR_CELLS+1 на ярусе ниже.
 */
export interface GenStair {
  upperTier: number;
  cx: number;
  cz: number;
  dir: Dir;
}

export interface CellRef {
  tier: number;
  x: number;
  z: number;
}

/**
 * Опасности среды, заложенные в план. Провалы и вода меняют геометрию, поэтому решаются здесь,
 * а не при расстановке находок.
 */
export interface GenHazards {
  /** Провал в полу прямого участка коридора: по краям остаются узкие карнизы. */
  pits: CellRef[];
  /** Затопленные клетки коридора. */
  water: CellRef[];
  /** id помещений с карманом газа. */
  gasRooms: number[];
  /** Клетки, которые может засыпать обвал. Все лежат на циклах: проход вокруг остаётся. */
  collapses: CellRef[];
}

export interface GenLayout {
  seed: number;
  attempt: number;
  genVersion: number;
  rank: 1 | 2 | 3;
  tierCount: number;
  rooms: GenRoom[];
  edges: GenEdge[];
  stairs: GenStair[];
  /** id помещения с люком на поверхность: и старт, и выход. */
  entranceRoom: number;
  /** Сколько циклов замкнуто на каждом ярусе (петли коридоров и вторые двери помещений). */
  loops: number[];
  hazards: GenHazards;
}

/** Квоты помещений по ярусам: [тип, варианты размера в клетках (вдоль стены коридора × вглубь)]. */
type Quota = readonly [RoomType, readonly (readonly [number, number])[]];

const SIZES_BIG: readonly (readonly [number, number])[] = [
  [2, 2],
  [3, 2],
  [2, 3],
];
const SIZES_MID: readonly (readonly [number, number])[] = [
  [2, 2],
  [2, 1],
  [1, 2],
];
const SIZES_SMALL: readonly (readonly [number, number])[] = [
  [2, 1],
  [1, 2],
  [1, 1],
];

const QUOTAS: readonly (readonly Quota[])[] = [
  [
    ['dorm', SIZES_BIG],
    ['command', SIZES_MID],
    ['medical', SIZES_MID],
    ['washroom', SIZES_SMALL],
    ['storage', SIZES_MID],
    ['dorm', SIZES_BIG],
  ],
  [
    ['fvu', SIZES_BIG],
    ['diesel', SIZES_BIG],
    ['tanks', SIZES_BIG],
    ['switchboard', SIZES_SMALL],
    ['storage', SIZES_MID],
  ],
  [
    ['archive', SIZES_BIG],
    ['storage', SIZES_MID],
    ['dorm', SIZES_BIG],
    ['collapsed', [[1, 1]]],
    ['collapsed', [[1, 1]]],
    ['washroom', SIZES_SMALL],
  ],
];

/** Помещения за гермодверью. */
const HERMO: ReadonlySet<RoomType> = new Set<RoomType>(['airlock', 'fvu', 'diesel', 'tanks']);

class GenFail extends Error {}

/** Сетка одного яруса: id помещения в клетке или −1. */
export class TierGrid {
  readonly room = new Int16Array(GRID * GRID).fill(-1);

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < GRID && z < GRID;
  }

  get(x: number, z: number): number {
    return this.inside(x, z) ? this.room[z * GRID + x]! : -1;
  }

  set(x: number, z: number, id: number): void {
    this.room[z * GRID + x] = id;
  }

  empty(x: number, z: number): boolean {
    return this.inside(x, z) && this.room[z * GRID + x] === -1;
  }

  /** Клетка пуста и не касается занятых (кроме клетки from): коридоры остаются шириной в клетку, между ними — стены. */
  isolated(x: number, z: number, fromX: number, fromZ: number): boolean {
    if (!this.empty(x, z)) return false;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const nz = z + DZ[d]!;
      if (nx === fromX && nz === fromZ) continue;
      if (this.inside(nx, nz) && this.room[nz * GRID + nx] !== -1) return false;
    }
    return true;
  }
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = items[i]!;
    items[i] = items[j]!;
    items[j] = t;
  }
  return items;
}

interface Build {
  rng: Rng;
  grids: TierGrid[];
  rooms: GenRoom[];
  edges: GenEdge[];
  stairs: GenStair[];
  loops: number[];
  /** Клетки, которыми замкнуты петли коридоров: убрать такую клетку — связность сохранится. */
  loopCells: CellRef[];
}

function newRoom(b: Build, type: RoomType, tier: number): GenRoom {
  const room: GenRoom = { id: b.rooms.length, type, tier, cells: [] };
  b.rooms.push(room);
  return room;
}

function addCell(b: Build, room: GenRoom, x: number, z: number): void {
  b.grids[room.tier]!.set(x, z, room.id);
  room.cells.push([x, z]);
}

function addEdge(b: Build, tier: number, x: number, z: number, dir: number, kind: EdgeKind): void {
  if (dir === 2) b.edges.push({ tier, cx: x - 1, cz: z, dir: 0, kind });
  else if (dir === 3) b.edges.push({ tier, cx: x, cz: z - 1, dir: 1, kind });
  else b.edges.push({ tier, cx: x, cz: z, dir: dir as 0 | 1, kind });
}

/** Случайное блуждание коридора: от (x, z) в сторону dir, до len клеток. Возвращает добавленные клетки. */
function growCorridor(b: Build, room: GenRoom, x: number, z: number, dir: Dir, len: number, straight: number): Array<[number, number]> {
  const grid = b.grids[room.tier]!;
  const added: Array<[number, number]> = [];
  let cx = x;
  let cz = z;
  let d: Dir = dir;
  for (let i = 0; i < len; i++) {
    const turns: Dir[] = b.rng() < 0.5 ? [((d + 1) % 4) as Dir, ((d + 3) % 4) as Dir] : [((d + 3) % 4) as Dir, ((d + 1) % 4) as Dir];
    const order: Dir[] = b.rng() < straight ? [d, ...turns] : [...turns, d];
    let moved = false;
    for (const nd of order) {
      const nx = cx + DX[nd]!;
      const nz = cz + DZ[nd]!;
      // У края сетки оставляем полосу в клетку: там встанут помещения.
      if (nx < 1 || nz < 1 || nx > GRID - 2 || nz > GRID - 2) continue;
      if (!grid.isolated(nx, nz, cx, cz)) continue;
      addCell(b, room, nx, nz);
      added.push([nx, nz]);
      cx = nx;
      cz = nz;
      d = nd;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return added;
}

/** Расстояния по коридорным клеткам яруса от заданной клетки (в клетках); −1 — недостижимо. */
function corridorDistances(grid: TierGrid, corridorId: number, sx: number, sz: number): Int16Array {
  const dist = new Int16Array(GRID * GRID).fill(-1);
  const queue: number[] = [sz * GRID + sx];
  dist[sz * GRID + sx] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const x = cur % GRID;
    const z = (cur - x) / GRID;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const nz = z + DZ[d]!;
      if (grid.get(nx, nz) !== corridorId) continue;
      const k = nz * GRID + nx;
      if (dist[k] !== -1) continue;
      dist[k] = dist[cur]! + 1;
      queue.push(k);
    }
  }
  return dist;
}

/**
 * Замкнуть цикл: пустая клетка между двумя коридорными, далёкими друг от друга по коридору.
 * Короткие петли вокруг одного столба и слишком длинные обходы не годятся.
 */
function closeLoop(b: Build, corridor: GenRoom): boolean {
  const grid = b.grids[corridor.tier]!;
  const gaps: Array<[number, number]> = [];
  for (let z = 1; z < GRID - 1; z++) for (let x = 1; x < GRID - 1; x++) if (grid.empty(x, z)) gaps.push([x, z]);
  shuffle(b.rng, gaps);
  for (const [x, z] of gaps) {
    const near: Array<[number, number]> = [];
    let foreign = false;
    for (let d = 0; d < 4; d++) {
      const id = grid.get(x + DX[d]!, z + DZ[d]!);
      if (id === corridor.id) near.push([x + DX[d]!, z + DZ[d]!]);
      else if (id !== -1) foreign = true;
    }
    if (near.length !== 2 || foreign) continue;
    const dist = corridorDistances(grid, corridor.id, near[0]![0], near[0]![1]);
    const along = dist[near[1]![1] * GRID + near[1]![0]]!;
    if (along < 6 || along > 40) continue;
    addCell(b, corridor, x, z);
    b.loopCells.push({ tier: corridor.tier, x, z });
    return true;
  }
  return false;
}

/** Найти место лестницы вниз: коридорная клетка подальше от входа, от которой свободны клетки марша. */
function placeStairs(b: Build, corridor: GenRoom, entry: [number, number]): { stair: GenStair; landing: [number, number] } | null {
  const tier = corridor.tier;
  const grid = b.grids[tier]!;
  const dist = corridorDistances(grid, corridor.id, entry[0], entry[1]);
  let far = 0;
  for (const [x, z] of corridor.cells) far = Math.max(far, dist[z * GRID + x]!);
  const candidates: Array<{ x: number; z: number; d: Dir; score: number }> = [];
  for (const [x, z] of corridor.cells) {
    const dc = dist[z * GRID + x]!;
    if (dc < far * 0.5) continue;
    for (let d = 0; d < 4; d++) {
      let ok = true;
      for (let i = 1; i <= STAIR_CELLS && ok; i++) {
        const fx = x + DX[d]! * i;
        const fz = z + DZ[d]! * i;
        ok = grid.isolated(fx, fz, x + DX[d]! * (i - 1), fz - DZ[d]!);
        if (ok && i < STAIR_CELLS) ok = fx >= 1 && fz >= 1 && fx <= GRID - 2 && fz <= GRID - 2;
      }
      // Нижняя площадка и ещё две клетки за ней должны помещаться в сетку: оттуда пойдёт хребет нижнего яруса.
      const lx = x + DX[d]! * (STAIR_CELLS + 3);
      const lz = z + DZ[d]! * (STAIR_CELLS + 3);
      if (!ok || lx < 1 || lz < 1 || lx > GRID - 2 || lz > GRID - 2) continue;
      candidates.push({ x, z, d: d as Dir, score: dc });
    }
  }
  if (candidates.length === 0) return null;
  // Из самых дальних — случайная: спуск не должен быть у самого входа.
  candidates.sort((a, c) => c.score - a.score || a.z - c.z || a.x - c.x || a.d - c.d);
  const pick = candidates[Math.floor(b.rng() * Math.min(candidates.length, 4))]!;
  const stair: GenStair = { upperTier: tier, cx: pick.x, cz: pick.z, dir: pick.d };
  const well = newRoom(b, 'stairwell', tier);
  const wellLow = newRoom(b, 'stairwell', tier + 1);
  for (let i = 1; i <= STAIR_CELLS; i++) {
    const fx = pick.x + DX[pick.d]! * i;
    const fz = pick.z + DZ[pick.d]! * i;
    addCell(b, well, fx, fz);
    addCell(b, wellLow, fx, fz);
  }
  addEdge(b, tier, pick.x, pick.z, pick.d, 'open');
  b.stairs.push(stair);
  return { stair, landing: [pick.x + DX[pick.d]! * (STAIR_CELLS + 1), pick.z + DZ[pick.d]! * (STAIR_CELLS + 1)] };
}

/** Поставить помещение w×h клеток к коридору. Возвращает его или null, если места нет. */
function placeRoom(b: Build, corridor: GenRoom, type: RoomType, sizes: readonly (readonly [number, number])[]): GenRoom | null {
  const tier = corridor.tier;
  const grid = b.grids[tier]!;
  const cells = shuffle(b.rng, corridor.cells.slice());
  const sizeOrder = shuffle(b.rng, sizes.slice());
  for (const [w, h] of sizeOrder) {
    for (const [x, z] of cells) {
      for (const d of shuffle(b.rng, [0, 1, 2, 3])) {
        // Дверная клетка — сосед коридорной в сторону d; помещение уходит от коридора на h клеток
        // и тянется вдоль него на w клеток со случайным сдвигом.
        const px = (d + 1) % 4; // направление «вдоль стены»
        const off = Math.floor(b.rng() * w);
        const rect: Array<[number, number]> = [];
        let ok = true;
        for (let i = 0; i < w && ok; i++) {
          for (let j = 0; j < h && ok; j++) {
            const rx = x + DX[d]! * (1 + j) + DX[px]! * (i - off);
            const rz = z + DZ[d]! * (1 + j) + DZ[px]! * (i - off);
            if (!grid.empty(rx, rz)) ok = false;
            else rect.push([rx, rz]);
          }
        }
        if (!ok) continue;
        const room = newRoom(b, type, tier);
        for (const [rx, rz] of rect) addCell(b, room, rx, rz);
        addEdge(b, tier, x, z, d, HERMO.has(type) ? 'hermo' : 'door');
        return room;
      }
    }
  }
  return null;
}

/** Вторая дверь в помещение — к коридорной клетке, далёкой по коридору от первой двери: ещё один цикл. */
function secondDoor(b: Build, corridor: GenRoom, room: GenRoom): boolean {
  const grid = b.grids[room.tier]!;
  const first = b.edges.find((e) => e.tier === room.tier && (grid.get(e.cx, e.cz) === room.id || grid.get(e.cx + (e.dir === 0 ? 1 : 0), e.cz + (e.dir === 1 ? 1 : 0)) === room.id));
  if (!first) return false;
  const fa: [number, number] = grid.get(first.cx, first.cz) === corridor.id ? [first.cx, first.cz] : [first.cx + (first.dir === 0 ? 1 : 0), first.cz + (first.dir === 1 ? 1 : 0)];
  if (grid.get(fa[0], fa[1]) !== corridor.id) return false;
  const dist = corridorDistances(grid, corridor.id, fa[0], fa[1]);
  for (const [x, z] of shuffle(b.rng, room.cells.slice())) {
    for (const d of shuffle(b.rng, [0, 1, 2, 3])) {
      const nx = x + DX[d]!;
      const nz = z + DZ[d]!;
      if (grid.get(nx, nz) !== corridor.id) continue;
      if (dist[nz * GRID + nx]! < 5) continue;
      addEdge(b, room.tier, x, z, d, 'door');
      return true;
    }
  }
  return false;
}

function buildAttempt(seed: number, attempt: number, rank: 1 | 2 | 3): GenLayout {
  const tierCount = rank === 1 ? 2 : 3;
  const b: Build = { rng: mulberry32(hash2(seed, attempt, 0x51ed)), grids: [], rooms: [], edges: [], stairs: [], loops: [], loopCells: [] };
  for (let t = 0; t < tierCount; t++) b.grids.push(new TierGrid());

  // Вход: люк у южного края, за ним шлюз с двумя гермодверями, дальше — коридор на север.
  const ex = 3 + Math.floor(b.rng() * (GRID - 6));
  const entrance = newRoom(b, 'entrance', 0);
  addCell(b, entrance, ex, GRID - 1);
  const airlock = newRoom(b, 'airlock', 0);
  addCell(b, airlock, ex, GRID - 2);
  addEdge(b, 0, ex, GRID - 1, 3, 'hermo');

  let entry: [number, number] = [ex, GRID - 3];
  let heading: Dir = 3;
  for (let t = 0; t < tierCount; t++) {
    const corridor = newRoom(b, 'corridor', t);
    const grid = b.grids[t]!;
    if (!grid.empty(entry[0], entry[1])) throw new GenFail('entry');
    addCell(b, corridor, entry[0], entry[1]);
    if (t === 0) addEdge(b, 0, ex, GRID - 2, 3, 'hermo');
    else {
      // Низ марша открыт на нижнюю площадку.
      addEdge(b, t, entry[0], entry[1], opposite(heading), 'open');
    }

    // Хребет: первые клетки прямо от входа, чтобы марш или шлюз не упирались в поворот.
    const spineLen = 11 + Math.floor(b.rng() * 6) + (rank === 3 ? 3 : 0);
    const spine = growCorridor(b, corridor, entry[0], entry[1], heading, spineLen, 0.68);
    if (spine.length < 7) throw new GenFail('spine');

    // Ответвления от хребта.
    const branches = 3 + Math.floor(b.rng() * 3);
    const roots = shuffle(b.rng, spine.slice(1));
    let grown = 0;
    for (const [x, z] of roots) {
      if (grown >= branches) break;
      for (const d of shuffle(b.rng, [0, 1, 2, 3] as Dir[])) {
        const nx = x + DX[d]!;
        const nz = z + DZ[d]!;
        if (nx < 1 || nz < 1 || nx > GRID - 2 || nz > GRID - 2 || !grid.isolated(nx, nz, x, z)) continue;
        addCell(b, corridor, nx, nz);
        const more = growCorridor(b, corridor, nx, nz, d, 1 + Math.floor(b.rng() * 4), 0.6);
        if (more.length > 0) grown += 1;
        break;
      }
    }

    // Лестница вниз — до помещений, пока вокруг коридоров свободно.
    let next: { stair: GenStair; landing: [number, number] } | null = null;
    if (t < tierCount - 1) {
      next = placeStairs(b, corridor, entry);
      if (!next) throw new GenFail('stairs');
    }

    // Циклы: чтобы от преследования было куда уходить.
    let loops = 0;
    for (let i = 0; i < 2 + (rank === 3 ? 1 : 0); i++) if (closeLoop(b, corridor)) loops += 1;

    // Помещения по квоте яруса.
    let placed = 0;
    const quota = QUOTAS[Math.min(t, QUOTAS.length - 1)]!;
    for (const [type, sizes] of quota) {
      const room = placeRoom(b, corridor, type, sizes);
      if (!room) continue;
      placed += 1;
      if (room.cells.length >= 4 && b.rng() < 0.45 && secondDoor(b, corridor, room)) loops += 1;
    }
    if (placed < 4) throw new GenFail('rooms');
    if (loops < 1) throw new GenFail('loops');
    b.loops.push(loops);

    if (next) {
      entry = next.landing;
      heading = next.stair.dir;
    }
  }

  return { seed, attempt, genVersion: GEN_VERSION, rank, tierCount, rooms: b.rooms, edges: b.edges, stairs: b.stairs, entranceRoom: entrance.id, loops: b.loops, hazards: planHazards(b, rank) };
}

/** Помещения, где может стоять газ: закрытые, без выхода наверх. */
const GAS_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>(['storage', 'dorm', 'washroom', 'archive', 'switchboard']);

/**
 * Разложить опасности. Первый ярус безопасен; глубже — вода, с ранга II ещё провалы, газ и обвалы.
 * Опасности не ставятся на площадки лестниц и в клетки с дверями.
 */
function planHazards(b: Build, rank: 1 | 2 | 3): GenHazards {
  const hz: GenHazards = { pits: [], water: [], gasRooms: [], collapses: [] };
  const key = (t: number, x: number, z: number): string => `${t},${x},${z}`;
  const busy = new Set<string>();
  // Площадки лестниц и клетки по обе стороны каждого прохода.
  for (const s of b.stairs) {
    busy.add(key(s.upperTier, s.cx, s.cz));
    busy.add(key(s.upperTier + 1, s.cx + DX[s.dir]! * (STAIR_CELLS + 1), s.cz + DZ[s.dir]! * (STAIR_CELLS + 1)));
  }
  for (const e of b.edges) {
    busy.add(key(e.tier, e.cx, e.cz));
    busy.add(key(e.tier, e.cx + (e.dir === 0 ? 1 : 0), e.cz + (e.dir === 1 ? 1 : 0)));
  }
  for (let t = 1; t < b.grids.length; t++) {
    const grid = b.grids[t]!;
    const corridor = b.rooms.find((r) => r.tier === t && r.type === 'corridor')!;
    const isCorr = (x: number, z: number): boolean => grid.get(x, z) === corridor.id;
    // Прямые участки: ровно два коридорных соседа друг напротив друга.
    const straight = shuffle(
      b.rng,
      corridor.cells.filter(([x, z]) => {
        if (busy.has(key(t, x, z))) return false;
        const n = [0, 1, 2, 3].map((d) => isCorr(x + DX[d]!, z + DZ[d]!));
        return (n[0] && n[2] && !n[1] && !n[3]) || (n[1] && n[3] && !n[0] && !n[2]);
      }),
    );
    const take = (x: number, z: number): void => {
      busy.add(key(t, x, z));
    };

    // Обвал — на клетке, замкнувшей петлю: обойти можно всегда.
    if (rank >= 2) {
      const loop = b.loopCells.find((c) => c.tier === t && !busy.has(key(t, c.x, c.z)));
      if (loop) {
        hz.collapses.push(loop);
        take(loop.x, loop.z);
      }
    }
    // Провалы: не рядом друг с другом и не рядом с обвалом.
    const pits = rank === 1 ? 0 : t === 1 ? 1 : 2;
    for (const [x, z] of straight) {
      if (hz.pits.filter((p) => p.tier === t).length >= pits) break;
      if (busy.has(key(t, x, z)) || [0, 1, 2, 3].some((d) => busy.has(key(t, x + DX[d]!, z + DZ[d]!)))) continue;
      hz.pits.push({ tier: t, x, z });
      take(x, z);
      for (let d = 0; d < 4; d++) take(x + DX[d]!, z + DZ[d]!);
    }
    // Вода: один-два участка по 2–4 клетки подряд.
    const runs = 1 + (t === 2 ? 1 : 0);
    let made = 0;
    for (const [x, z] of straight) {
      if (made >= runs) break;
      if (busy.has(key(t, x, z))) continue;
      const along = isCorr(x + 1, z) ? 0 : 1;
      const len = 2 + Math.floor(b.rng() * 3);
      const cells: Array<[number, number]> = [[x, z]];
      for (const sign of [1, -1]) {
        for (let i = 1; cells.length < len; i++) {
          const nx = x + DX[along]! * i * sign;
          const nz = z + DZ[along]! * i * sign;
          if (!isCorr(nx, nz) || busy.has(key(t, nx, nz))) break;
          cells.push([nx, nz]);
        }
      }
      if (cells.length < 2) continue;
      for (const [cx, cz] of cells) {
        hz.water.push({ tier: t, x: cx, z: cz });
        take(cx, cz);
      }
      made += 1;
    }
    // Газ: одно закрытое помещение на ярусе (на втором — только с ранга III).
    if (rank >= 2 && (t === 2 || rank === 3)) {
      const rooms = shuffle(
        b.rng,
        b.rooms.filter((r) => r.tier === t && GAS_ROOMS.has(r.type)),
      );
      if (rooms[0]) hz.gasRooms.push(rooms[0].id);
    }
  }
  return hz;
}

/** Сгенерировать план по сиду и рангу объекта. Детерминирован: один сид — один уровень. */
export function generateLayout(seed: number, rank: 1 | 2 | 3 = 2): GenLayout {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return buildAttempt(seed, attempt, rank);
    } catch (e) {
      if (!(e instanceof GenFail)) throw e;
    }
  }
  throw new Error(`генератор не собрал уровень для сида ${seed}`);
}
