/**
 * Швы (docs/vylazka/pressure.md, §4.1): места, где два воспоминания сшиты. Первая пара — офис и его вторая, пустая версия:
 * жёлтые комнаты на том же плане (gen/layout.ts, twinLayout). Шов виден при свете — нитка по полу и стенам тем же рисунком, что
 * кружево (рендер держит её номер вершин кружевом, SEAM_OBJ). Свет погас рядом со швом и зажёгся — вокруг уже другая версия
 * места, а стены там же (game.ts).
 *
 * Сколько швов (seamCount): на первом круге — один; чем сильнее место стёрто, тем больше; к шестому кругу (стёртость 0,7) — в
 * каждом втором помещении, дальше не прибавляется. Помещение — не больше одного шва.
 *
 * Где (seamSites): швы считаются только по плану и стёртости, без жребия сборки, — у обеих версий места они одни и те же. Первый —
 * поперёк коридора, в нескольких клетках от лифта (с него начинается первая сцена в офисе); остальные — по помещению на шов,
 * порядок — жребий сида. Нитка идёт через середины клеток поперёк помещения, от стены до стены, и у стены поднимается до потолка.
 *
 * Чистый TS: сборка уровня, игра, тесты.
 */
import { hash01 } from '../core/rng';
import { DX, DZ, GRID, TIER_DROP } from '../gen/layout';
import type { GenLayout, GenRoom } from '../gen/layout';
import type { Vec3 } from '../core/types';
import type { MeshBuilder } from './kit';
import { MAT } from './materials';
import { SEAM_OBJ } from './objects';
import { CELL, WALL_T } from './shell';

export const SEAM = {
  /** Рядом со швом — ближе стольких метров к его нитке на полу (и на том же ярусе). */
  near: 1.6,
  /** Ширина нитки, м: полоса кружева, в которую попадает несколько стежков узора. */
  width: 0.11,
  /** Насколько нитка отстоит от стены и пола, м: две грани в одной плоскости рябят (tests/zfight.test.ts). */
  lift: 0.006,
  /** К какой стёртости швы — в каждом втором помещении (шестой круг: (6 − 1) × 0,14). */
  full: 0.7,
  /** Первый шов — в коридоре, столько клеток пути от входа в коридор: первая сцена в офисе начинается у лифта. */
  firstFrom: 3,
  firstTo: 8,
} as const;

/** Цвет нитки до кружева: тёмная, чтобы её было видно и на белой стене офиса, и на жёлтых обоях. */
const THREAD: Vec3 = [0.46, 0.32, 0.26];

/** Что на конце нитки: стена (по ней нитка поднимается), дверной проём или проход дальше. */
export type SeamEnd = 'wall' | 'door' | 'open';

export interface SeamSite {
  /** Помещение и ярус. */
  room: number;
  tier: number;
  /** Куда идёт нитка по полу: 0 — вдоль x, 1 — вдоль z. */
  axis: 0 | 1;
  /** Клетки плана, через середины которых она идёт. */
  cells: [number, number][];
  /** Концы нитки по полу в мире (x, z): от внутренней грани стены до внутренней грани. */
  a: [number, number];
  b: [number, number];
  /** Пол, м. */
  y: number;
  /** Что на концах a и b. */
  ends: [SeamEnd, SeamEnd];
}

const HALF = GRID / 2;
const toWorld = (c: number): number => (c - HALF) * CELL;

/**
 * Сколько швов на месте при стёртости wear, если помещений rooms: на первом круге один, к SEAM.full — половина помещений
 * (с округлением вверх), между ними — поровну на каждую долю стёртости.
 */
export function seamCount(wear: number, rooms: number): number {
  const half = Math.max(1, Math.ceil(rooms / 2));
  const k = Math.min(1, Math.max(0, wear) / SEAM.full);
  return Math.max(1, Math.min(half, 1 + Math.round((half - 1) * k)));
}

/** Помещения, где может быть шов: всё, кроме начала места (лифт и приёмная) и лестничных шахт. */
export function seamRooms(layout: GenLayout): GenRoom[] {
  const start = layout.rooms[layout.entranceRoom];
  return layout.rooms.filter((r) => r !== start && r.type !== 'reception' && r.type !== 'airlock' && r.type !== 'stairwell');
}

/** План как сетка: помещение в клетке и проходы между помещениями. */
function planOf(layout: GenLayout): { roomAt: (tier: number, x: number, z: number) => number; side: (tier: number, x: number, z: number, dir: number) => SeamEnd | 'same' } {
  const cells = new Map<string, number>();
  for (const r of layout.rooms) for (const [x, z] of r.cells) cells.set(`${r.tier},${x},${z}`, r.id);
  const edges = new Map<string, string>();
  for (const e of layout.edges) edges.set(`${e.tier},${e.cx},${e.cz},${e.dir}`, e.kind);
  const roomAt = (tier: number, x: number, z: number): number => cells.get(`${tier},${x},${z}`) ?? -1;
  const side = (tier: number, x: number, z: number, dir: number): SeamEnd | 'same' => {
    const me = roomAt(tier, x, z);
    const nx = x + DX[dir]!;
    const nz = z + DZ[dir]!;
    const other = roomAt(tier, nx, nz);
    if (other === me) return 'same';
    if (other < 0) return 'wall';
    const key = dir === 0 || dir === 1 ? `${tier},${x},${z},${dir}` : `${tier},${nx},${nz},${dir - 2}`;
    const kind = edges.get(key);
    return kind === undefined ? 'wall' : kind === 'open' ? 'open' : 'door';
  };
  return { roomAt, side };
}

/** Шов поперёк ряда клеток: ось, клетки ряда и что на концах. */
function siteOf(room: GenRoom, axis: 0 | 1, cells: [number, number][], ends: [SeamEnd, SeamEnd]): SeamSite {
  const T = WALL_T / 2;
  const first = cells[0]!;
  const last = cells[cells.length - 1]!;
  const reach = CELL / 2 - T;
  const a: [number, number] = axis === 0 ? [toWorld(first[0]) - reach, toWorld(first[1])] : [toWorld(first[0]), toWorld(first[1]) - reach];
  const b: [number, number] = axis === 0 ? [toWorld(last[0]) + reach, toWorld(last[1])] : [toWorld(last[0]), toWorld(last[1]) + reach];
  return { room: room.id, tier: room.tier, axis, cells, a, b, y: -TIER_DROP * room.tier, ends };
}

/** Шов коридора: прямой участок, по бокам глухие стены; ближе к входу в коридор — лучше (SEAM.firstFrom…firstTo). */
function corridorSite(layout: GenLayout, room: GenRoom, plan: ReturnType<typeof planOf>): SeamSite | null {
  const t = room.tier;
  const mine = new Set(room.cells.map(([x, z]) => `${x},${z}`));
  // Путь по коридору от клетки, которой он начинается у входа места (сосед помещения входа); нет такой — от первой клетки.
  const start = layout.rooms[layout.entranceRoom];
  const near = new Set<string>();
  for (const r of layout.rooms) if (r !== room && r.tier === t && (r === start || r.type === 'reception' || r.type === 'airlock')) for (const [x, z] of r.cells) for (let d = 0; d < 4; d++) near.add(`${x + DX[d]!},${z + DZ[d]!}`);
  const from = room.cells.find(([x, z]) => near.has(`${x},${z}`)) ?? room.cells[0]!;
  const dist = new Map<string, number>([[`${from[0]},${from[1]}`, 0]]);
  const queue: [number, number][] = [from];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i]!;
    for (let d = 0; d < 4; d++) {
      const k = `${x + DX[d]!},${z + DZ[d]!}`;
      if (!mine.has(k) || dist.has(k)) continue;
      dist.set(k, dist.get(`${x},${z}`)! + 1);
      queue.push([x + DX[d]!, z + DZ[d]!]);
    }
  }
  const cands: { cell: [number, number]; axis: 0 | 1; d: number }[] = [];
  for (const [x, z] of room.cells) {
    for (const axis of [0, 1] as const) {
      // Нитка идёт по оси axis: по бокам на этой оси — глухие стены, вдоль другой оси коридор продолжается в обе стороны.
      const across = axis === 0 ? [2, 0] : [3, 1];
      const along = axis === 0 ? [3, 1] : [2, 0];
      if (across.some((d) => plan.side(t, x, z, d) !== 'wall')) continue;
      if (along.some((d) => plan.side(t, x, z, d) !== 'same')) continue;
      cands.push({ cell: [x, z], axis, d: dist.get(`${x},${z}`) ?? 99 });
    }
  }
  if (cands.length === 0) return null;
  const ok = cands.filter((c) => c.d >= SEAM.firstFrom && c.d <= SEAM.firstTo);
  const far = cands.filter((c) => c.d >= SEAM.firstFrom).sort((p, q) => p.d - q.d);
  const pool = ok.length > 0 ? ok : far.length > 0 ? far.slice(0, 3) : cands;
  const pick = pool[Math.floor(hash01(room.id, 0x5ea, layout.seed ^ 0x5ea3) * pool.length)]!;
  return siteOf(room, pick.axis, [pick.cell], ['wall', 'wall']);
}

/** Шов помещения-прямоугольника: поперёк, по короткой стороне, через ряд клеток; концы — лучше глухие стены. */
function roomSite(layout: GenLayout, room: GenRoom, plan: ReturnType<typeof planOf>): SeamSite | null {
  const t = room.tier;
  const xs = room.cells.map((c) => c[0]);
  const zs = room.cells.map((c) => c[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const roll = hash01(room.id, 0x5eb, layout.seed ^ 0x5ea3);
  const w = x1 - x0 + 1;
  const h = z1 - z0 + 1;
  // По короткой стороне: нитка, пересекающая всё помещение, — шов, а не черта у стены.
  const axes: (0 | 1)[] = w < h ? [0, 1] : h < w ? [1, 0] : roll < 0.5 ? [0, 1] : [1, 0];
  const mine = new Set(room.cells.map(([x, z]) => `${x},${z}`));
  for (const axis of axes) {
    const rows = axis === 0 ? zs.filter((v, i, a) => a.indexOf(v) === i) : xs.filter((v, i, a) => a.indexOf(v) === i);
    const scored: { cells: [number, number][]; ends: [SeamEnd, SeamEnd]; score: number }[] = [];
    for (const r of rows) {
      const cells: [number, number][] = [];
      if (axis === 0) for (let x = x0; x <= x1; x++) cells.push([x, r]);
      else for (let z = z0; z <= z1; z++) cells.push([r, z]);
      if (!cells.every(([x, z]) => mine.has(`${x},${z}`))) continue;
      const [fa, fb] = axis === 0 ? [2, 0] : [3, 1];
      const ea = plan.side(t, cells[0]![0], cells[0]![1], fa);
      const eb = plan.side(t, cells[cells.length - 1]![0], cells[cells.length - 1]![1], fb);
      if (ea === 'same' || eb === 'same') continue;
      scored.push({ cells, ends: [ea, eb], score: (ea === 'wall' ? 1 : 0) + (eb === 'wall' ? 1 : 0) });
    }
    if (scored.length === 0) continue;
    const best = Math.max(...scored.map((s) => s.score));
    const pool = scored.filter((s) => s.score === best);
    const s = pool[Math.floor(roll * pool.length)]!;
    return siteOf(room, axis, s.cells, s.ends);
  }
  return null;
}

/**
 * Швы места при стёртости wear: первый — в коридоре, дальше — по помещению на шов в порядке жребия сида. Только по плану:
 * у офиса и его жёлтой версии (одни клетки, одни проходы) швы одни и те же.
 */
export function seamSites(layout: GenLayout, wear: number, skip: readonly number[] = []): SeamSite[] {
  const plan = planOf(layout);
  // Особые комнаты офиса (белая, странная, проём песчаного зала) — без швов: у двойника их нет, и переход менял бы комнату.
  const pool = seamRooms(layout).filter((r) => !skip.includes(r.id));
  const n = seamCount(wear, pool.length);
  const out: SeamSite[] = [];
  const corridor = pool.find((r) => r.type === 'corridor' && r.tier === 0);
  if (corridor) {
    const s = corridorSite(layout, corridor, plan);
    if (s) out.push(s);
  }
  const rest = pool.filter((r) => r !== corridor).sort((p, q) => hash01(p.id, 0x5ec, layout.seed ^ 0x5ea3) - hash01(q.id, 0x5ec, layout.seed ^ 0x5ea3) || p.id - q.id);
  for (const r of rest) {
    if (out.length >= n) break;
    const s = r.type === 'corridor' ? corridorSite(layout, r, plan) : roomSite(layout, r, plan);
    if (s) out.push(s);
  }
  return out.slice(0, n);
}

/** Расстояние в плане от точки (x, z) до нитки шва на полу. */
export function seamDistance(s: SeamSite, x: number, z: number): number {
  const [ax, az] = s.a;
  const [bx, bz] = s.b;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Шов, рядом с которым стоит точка (номер в списке), или −1. ok — какие швы считать (кусок места: за краем памяти шва нет). */
export function seamNear(sites: readonly SeamSite[], x: number, y: number, z: number, ok?: (s: SeamSite, i: number) => boolean): number {
  let best = -1;
  let bestD: number = SEAM.near;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    if (Math.abs(y - s.y) > 1.2) continue;
    const d = seamDistance(s, x, z);
    // Дальше лучшего — проверять «в куске ли» незачем.
    if (d < bestD && (!ok || ok(s, i))) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Нитка шва в сетке помещения: полоса по полу от конца до конца и у глухой стены — вверх до потолка (ceil — высота потолка над
 * полом). Вершины получают номер SEAM_OBJ: рендер рисует их кружевом, стирание стен их не берёт, коснуться их нельзя.
 */
export function buildSeam(mb: MeshBuilder, s: SeamSite, ceil: number): void {
  const keep = mb.obj;
  mb.obj = SEAM_OBJ;
  try {
    const W = SEAM.width / 2;
    const L = SEAM.lift;
    const y = s.y + L;
    const [ax, az] = s.a;
    const [bx, bz] = s.b;
    // Поперёк нитки: ось, перпендикулярная её ходу.
    const px = s.axis === 0 ? 0 : 1;
    const pz = s.axis === 0 ? 1 : 0;
    const ux = s.axis === 0 ? 1 : 0;
    const uz = s.axis === 0 ? 0 : 1;
    // Пол: от стены до стены, на волосок выше пола и чуть не доходя до стены (там нитка загибается вверх).
    const a0: Vec3 = [ax + ux * L - px * W, y, az + uz * L - pz * W];
    const a1: Vec3 = [ax + ux * L + px * W, y, az + uz * L + pz * W];
    const b0: Vec3 = [bx - ux * L - px * W, y, bz - uz * L - pz * W];
    const b1: Vec3 = [bx - ux * L + px * W, y, bz - uz * L + pz * W];
    mb.quadFacing(a0, a1, b1, b0, [0, 1, 0], MAT.canvas, THREAD);
    // Стены: у глухой стены нитка поднимается до потолка — по её грани, на волосок от неё.
    const up = (x: number, z: number, nx: number, nz: number): void => {
      const top = s.y + ceil - L;
      const q0: Vec3 = [x - px * W, y, z - pz * W];
      const q1: Vec3 = [x + px * W, y, z + pz * W];
      const q2: Vec3 = [x + px * W, top, z + pz * W];
      const q3: Vec3 = [x - px * W, top, z - pz * W];
      mb.quadFacing(q0, q1, q2, q3, [nx, 0, nz], MAT.canvas, THREAD);
    };
    if (s.ends[0] === 'wall') up(ax + ux * L, az + uz * L, ux, uz);
    if (s.ends[1] === 'wall') up(bx - ux * L, bz - uz * L, -ux, -uz);
  } finally {
    mb.obj = keep;
  }
}
