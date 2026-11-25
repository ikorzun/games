/**
 * Сцена — кусок места (квиз 17.11, поздний вечер: «Сцена — кусок места (советую)»: сцена — 3–6 комнат постоянного
 * плана места, дальше память обрывается; docs/vylazka/pressure.md, §4.6 п. 2 и §4.8).
 *
 * Место строится целиком, по своему постоянному плану: та же комната в разных снах — та же, «я здесь уже был» держится.
 * Кусок — то, что из него помнится в этой сцене: шар памяти вокруг точки, куда уронил сон. Комнаты входят целиком —
 * ближние по пути, пока их не наберётся 3–6 (сколько — по жребию сцены); проходы (коридоры, лестницы, тамбуры) — клетками,
 * докуда дотянулась память. За краем куска мир не собирается, и шаг туда обрывает сцену (game.ts).
 *
 * Чистый TS: игра, рендер (маска), тесты.
 */
import { hash2 } from '../core/rng';
import type { GenLayout, RoomType } from '../gen/layout';
import type { NavNode } from './level';

/** Проходы: в кусок они входят не целиком, а клетками, и комнатами не считаются. */
export const PASSAGES: readonly RoomType[] = ['corridor', 'stairwell', 'entrance', 'airlock', 'lift', 'vestibule'];

/** Сколько комнат помнит сцена: от и до (сколько именно — по жребию сцены). */
export const PIECE_MIN_ROOMS = 3;
export const PIECE_MAX_ROOMS = 6;
/** Дальше этого (клеток пути от начала сцены) память не тянется, сколько бы комнат ни набралось. */
export const PIECE_REACH = 12;
/**
 * Проходы помнятся хотя бы на столько клеток пути: там, где комнаты теснятся у начала, кусок иначе сжимался до четырёх клеток,
 * и за вещью некуда было бы идти.
 */
export const PIECE_MIN_REACH = 5;

export interface ScenePiece {
  /** Узлы навигации (клетки), которые помнятся. */
  nodes: Set<number>;
  /** Помещения, у которых в куске есть хоть одна клетка. */
  rooms: Set<number>;
  /** Сколько в куске комнат (без проходов). */
  count: number;
  /** Узлы куска, из которых есть ход наружу: край памяти. */
  edge: number[];
}

/** Ключ клетки плана — как у узлов навигации (ярус, клетка). */
export const cellKey = (tier: number, cx: number, cz: number): string => `${tier},${cx},${cz}`;

/** Расстояния в переходах от узла from до всех (−1 — недостижим). */
function distances(nav: readonly NavNode[], from: number): Int32Array {
  const dist = new Int32Array(nav.length).fill(-1);
  if (from < 0 || from >= nav.length) return dist;
  const q = [from];
  dist[from] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h]!;
    for (const n of nav[cur]!.links) {
      if (dist[n] !== -1) continue;
      dist[n] = dist[cur]! + 1;
      q.push(n);
    }
  }
  return dist;
}

/**
 * Кусок места вокруг узла start. Комнаты берутся по порядку того, как близко до них идти (первая клетка), пока их меньше
 * задуманного и пока до них не дальше PIECE_REACH; комната — целиком. Проходы — клетками не дальше, чем самая дальняя
 * взятая комната (и на клетку дальше: коридор перед последней дверью тоже помнится). Комнаты на пути к взятой ближе неё,
 * поэтому взяты раньше: кусок связен.
 */
export function scenePiece(nav: readonly NavNode[], layout: Pick<GenLayout, 'rooms'>, start: number, seed: number, roomCount?: number): ScenePiece {
  const dist = distances(nav, start);
  const passage = (room: number): boolean => PASSAGES.includes(layout.rooms[room]?.type as RoomType);
  // roomCount — сколько комнат помнить, если не по жребию: прошедшее место всплывает одной комнатой (pressure.md, §4.6 п. 4).
  const target = roomCount ?? PIECE_MIN_ROOMS + ((hash2(seed >>> 0, start, 0x9e1) >>> 0) % (PIECE_MAX_ROOMS - PIECE_MIN_ROOMS + 1));
  // Как близко до каждой комнаты: первая её клетка по пути.
  const first = new Map<number, number>();
  for (const n of nav) {
    const d = dist[n.id]!;
    if (d < 0 || passage(n.room)) continue;
    const was = first.get(n.room);
    if (was === undefined || d < was) first.set(n.room, d);
  }
  const order = [...first].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const taken = new Set<number>();
  const home = nav[start];
  if (home && !passage(home.room)) taken.add(home.room);
  // Одна комната — без своего запаса проходов: помнится только она и клетка коридора у её двери.
  let reach = roomCount === 1 ? 0 : PIECE_MIN_REACH;
  for (const [room, d] of order) {
    if (taken.size >= target || d > PIECE_REACH) break;
    taken.add(room);
    reach = Math.max(reach, d);
  }
  const near = new Set<number>();
  for (const n of nav) {
    const d = dist[n.id]!;
    if (d >= 0 && (passage(n.room) ? d <= reach + 1 : taken.has(n.room))) near.add(n.id);
  }
  // Только то, до чего можно дойти от начала, не выходя из памяти: коридор за чужой комнатой близок по пути, но дорога к нему
  // идёт через то, что не помнится.
  const nodes = new Set<number>([start]);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    for (const l of nav[q[h]!]!.links) {
      if (!near.has(l) || nodes.has(l)) continue;
      nodes.add(l);
      q.push(l);
    }
  }
  const rooms = new Set<number>([...nodes].map((id) => nav[id]!.room));
  const edge = [...nodes].filter((id) => nav[id]!.links.some((l) => !nodes.has(l)));
  return { nodes, rooms, count: [...taken].filter((r) => rooms.has(r)).length, edge };
}

/** Клетки куска — ключами cellKey (для маски рендера и проверки «где игрок»). */
export function pieceCells(nav: readonly NavNode[], piece: Pick<ScenePiece, 'nodes'>): Set<string> {
  const out = new Set<string>();
  for (const id of piece.nodes) {
    const n = nav[id];
    if (n) out.add(cellKey(n.tier, n.cx, n.cz));
  }
  return out;
}

/** Сторона клетки куска в маске: закрыта (стена или своё), дверь в забытое (рвётся только проём), проход в забытое (вся сторона). */
export const SIDE_CLOSED = 128;
export const SIDE_DOOR = 192;
export const SIDE_OPEN = 255;

/**
 * Маска куска для рендера: по клетке на тексель, ярусы друг под другом, RGBA — стороны клетки (−x, +x, −z, +z); 0 во всех
 * каналах — клетка не помнится. Клетка мира — x / 3 + offX (так же по z; клетка уровня cx — центр в x = (cx − 8) · 3).
 * Марш лестницы опускается в ярус ниже: клетки лестницы помнятся и там.
 */
export interface PieceMask {
  offX: number;
  offZ: number;
  w: number;
  h: number;
  tiers: number;
  data: Uint8Array;
}

export function pieceMask(nav: readonly NavNode[], layout: Pick<GenLayout, 'rooms' | 'tierCount'>, piece: Pick<ScenePiece, 'nodes'>): PieceMask {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const n of nav) {
    minX = Math.min(minX, n.cx);
    minZ = Math.min(minZ, n.cz);
    maxX = Math.max(maxX, n.cx);
    maxZ = Math.max(maxZ, n.cz);
  }
  if (!Number.isFinite(minX)) minX = minZ = maxX = maxZ = 0;
  // Клетка запаса с каждой стороны: за краем плана — «не помнится».
  const w = maxX - minX + 3;
  const h = maxZ - minZ + 3;
  const tiers = Math.max(1, layout.tierCount);
  const data = new Uint8Array(w * h * tiers * 4);
  const at = (tier: number, cx: number, cz: number): number => {
    const i = cx - minX + 1;
    const j = cz - minZ + 1;
    return tier < 0 || tier >= tiers || i < 0 || j < 0 || i >= w || j >= h ? -1 : ((tier * h + j) * w + i) * 4;
  };
  const mark = (tier: number, cx: number, cz: number): number => {
    const k = at(tier, cx, cz);
    if (k >= 0 && data[k] === 0) data.fill(SIDE_CLOSED, k, k + 4);
    return k;
  };
  for (const id of piece.nodes) {
    const n = nav[id]!;
    const k = mark(n.tier, n.cx, n.cz);
    if (layout.rooms[n.room]?.type === 'stairwell') mark(n.tier + 1, n.cx, n.cz);
    if (k < 0) continue;
    for (const l of n.links) {
      if (piece.nodes.has(l)) continue;
      const o = nav[l]!;
      if (o.tier !== n.tier) continue;
      const dx = o.cx - n.cx;
      const dz = o.cz - n.cz;
      if (Math.abs(dx) + Math.abs(dz) !== 1) continue;
      const side = dx < 0 ? 0 : dx > 0 ? 1 : dz < 0 ? 2 : 3;
      data[k + side] = Math.max(data[k + side]!, o.room === n.room ? SIDE_OPEN : SIDE_DOOR);
    }
  }
  return { offX: 9 - minX, offZ: 9 - minZ, w, h, tiers, data };
}
