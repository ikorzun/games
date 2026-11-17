/**
 * Где встают вещи партнёра (world/placed.ts). Правило вещи — то же, что у фигуры: край помещения (угол,
 * стена, проём, середина, потолок), сдвиг от него, «лицом куда», высота, сколько. Края считает тот же код,
 * что у фигур (world/figure_place.ts, anchorSpots), — поэтому инструмент (tools/constructor), где партнёр
 * ставит вещь руками в настоящее помещение, и игра, где та же вещь встаёт в другие помещения того же типа,
 * понимают правило одинаково.
 *
 * Что вещь обязана соблюдать (их же показывает инструмент):
 * - не перекрывать проход: перед каждым проёмом помещения остаётся «горло» 1,2 × 1 м, куда низкая вещь
 *   не встаёт (то, что висит выше 1,9 м, проходу не мешает); посреди коридора — тоже нельзя;
 * - не врастать в стены, мебель и друг в друга: коробка вещи не задевает преград уровня;
 * - помещаться под потолком и не стоять над провалом (если не висит в воздухе);
 * - не стоять у самого начала места: там игрок появляется;
 * - поворачиваться четвертями: коробки и преграды обстановки прямые (world/props.ts, Xf).
 * Где правило не выполнить — вещи на этом уровне просто нет, как у фигур.
 *
 * Помещения и края перебираются по сиду уровня и ключу расстановки: тот же сид — те же места; правка одной
 * расстановки не сдвигает остальные.
 *
 * Чистый TS: работает в сборке уровня (Worker), в инструменте и в тестах.
 */
import { hash01, hash2 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { GRID } from '../gen/layout';
import type { GenRoom } from '../gen/layout';
import type { Aabb } from './colliders';
import { anchorSpots } from './figure_place';
import type { AnchorSpot, PlaceWorld } from './figure_place';
import type { FigureFacing } from './figures';
import type { PlacedSpec } from './placed';
import type { PropSpec } from './props_more';
import { CELL, DIRS } from './shell';

const HALF = GRID / 2;
/** Горло проёма: ширина вдоль стены и глубина в помещение, м. */
export const THROAT_W = 1.2;
export const THROAT_D = 1.0;
/** Выше этого над полом вещь проходу не мешает, м. */
export const HEADROOM = 1.9;
/** Не ближе к началу места, м (как у фигур). */
const SPAWN_CLEAR = 3.2;
/** Зазор до преград, м: вещь может касаться стены спиной, но не входить в неё. */
const SKIN = 0.03;

/** Помещения, куда вещи не ставятся: лестничные марши, лифт, пути под перроном (как у фигур). */
const NEVER: ReadonlySet<string> = new Set(['stairwell', 'lift', 'track']);

export type Turn = 0 | 1 | 2 | 3;

/** Где встала вещь: ключ расстановки, номер экземпляра, какая вещь, точка (низ — y), поворот четвертями. */
export interface PlacedSpot {
  id: string;
  k: number;
  prop: string;
  at: Vec3;
  rot: Turn;
  room: number;
  tier: number;
}

/** Коробка в мире (без меток коллайдера). */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Поворот четвертями из угла «лицом куда» (рад; 0 — к +z, как у фигур). Тот же, что у Xf: 1 — лицом к +x. */
export const rotOf = (yaw: number): Turn => ((((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4) as Turn);

/** Коробка вещи в её координатах: у стены — спина в z = 0, посреди пола — середина в начале (world/props_real.ts). */
export function propBox(p: PropSpec): { min: Vec3; max: Vec3 } {
  const free = p.mount === 'free';
  return { min: [-p.w / 2, 0, free ? -p.d / 2 : 0], max: [p.w / 2, p.h, free ? p.d / 2 : p.d] };
}

/** Точка вещи в мире — тот же поворот, что у Xf.pt. */
function turnPt(x: number, z: number, rot: Turn): [number, number] {
  if (rot === 1) return [z, -x];
  if (rot === 2) return [-x, -z];
  if (rot === 3) return [-z, x];
  return [x, z];
}

/** Коробка вещи в мире: точка at (низ), поворот rot. */
export function worldBox(p: PropSpec, at: Vec3, rot: Turn): Box {
  const { min, max } = propBox(p);
  const [ax, az] = turnPt(min[0], min[2], rot);
  const [bx, bz] = turnPt(max[0], max[2], rot);
  return { minX: at[0] + Math.min(ax, bx), maxX: at[0] + Math.max(ax, bx), minY: at[1] + min[1], maxY: at[1] + max[1], minZ: at[2] + Math.min(az, bz), maxZ: at[2] + Math.max(az, bz) };
}

const overlap = (a: Box, b: Box, m = 0): boolean => a.minX < b.maxX - m && a.maxX > b.minX + m && a.minZ < b.maxZ - m && a.maxZ > b.minZ + m && a.minY < b.maxY - m && a.maxY > b.minY + m;

/** Проём помещения: точка посреди проёма и «внутрь» — нормаль в помещение. */
export interface DoorGap {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** Проёмы помещения (двери и открытые стыки с другими помещениями). */
export function roomDoors(room: GenRoom, w: Pick<PlaceWorld, 'shells'>): DoorGap[] {
  const sh = w.shells[room.tier]!;
  const out: DoorGap[] = [];
  for (const [gx, gz] of room.cells) {
    const sx = gx - HALF;
    const sz = gz - HALF;
    for (let d = 0; d < 4; d++) {
      const a = DIRS[d]!;
      const k = sh.edge(sx, sz, d);
      const nb = sh.get(sx + a[0], sz + a[1]);
      if (!(k === 'door' || (k === 'open' && nb !== undefined && nb.room !== room.id))) continue;
      out.push({ x: sx * CELL + a[0] * (CELL / 2), z: sz * CELL + a[1] * (CELL / 2), nx: -a[0], nz: -a[1] });
    }
  }
  return out;
}

/** Горло проёма: куда низкая вещь не встаёт. */
export function throatBox(d: DoorGap, floor: number): Box {
  const cx = d.x + d.nx * (THROAT_D / 2);
  const cz = d.z + d.nz * (THROAT_D / 2);
  const hx = d.nx !== 0 ? THROAT_D / 2 : THROAT_W / 2;
  const hz = d.nz !== 0 ? THROAT_D / 2 : THROAT_W / 2;
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, minY: floor, maxY: floor + HEADROOM };
}

const yawFor = (a: AnchorSpot, f: FigureFacing): number => (f === 'room' ? a.phi : f === 'wall' ? a.wall : f === 'door' ? a.door : a.entry);

/** Точка и поворот вещи по правилу у края a. Как в инструменте: край + сдвиг, повёрнутый по рамке края. */
export function fitThing(spec: Pick<PlacedSpec, 'rule' | 'turn' | 'offset'>, a: AnchorSpot, p: PropSpec): { at: Vec3; rot: Turn } {
  const c = Math.cos(a.phi);
  const s = Math.sin(a.phi);
  const [ox, oz] = spec.offset;
  const x = a.x + ox * c + oz * s;
  const z = a.z - ox * s + oz * c;
  // Под потолком — верхом под самый потолок; иначе — на заданной высоте, но не выше потолка.
  const top = a.ceil - 0.02 - p.h;
  const y = spec.rule.anchor === 'ceiling' ? Math.max(a.floor, top) : Math.max(a.floor, Math.min(a.floor + spec.rule.lift, top));
  return { at: [x, y, z], rot: (((rotOf(yawFor(a, spec.rule.facing)) + spec.turn) % 4) as Turn) };
}

/** Почему вещь не встанет в этой точке — по-русски; пусто — встанет. */
export interface SpotCheck {
  /** Коробка вещи в мире. */
  box: Box;
  problems: string[];
}

const scratch: Aabb[] = [];

/**
 * Проверка одной точки: те же правила, по которым игра ищет место (их же видит партнёр в инструменте).
 * others — коробки уже поставленных вещей.
 */
export function checkSpot(p: PropSpec, at: Vec3, rot: Turn, room: GenRoom, a: Pick<AnchorSpot, 'floor' | 'ceil' | 'pit' | 'tier'>, w: PlaceWorld, others: readonly Box[] = []): SpotCheck {
  const box = worldBox(p, at, rot);
  const problems: string[] = [];
  const lift = at[1] - a.floor;
  if (box.maxY > a.ceil - 0.01) problems.push('не помещается под потолком');
  if (a.pit && lift < 0.3) problems.push('под ней провал');
  if (room.type === 'corridor' && lift < HEADROOM && !nearWall(box, room, w)) problems.push('посреди коридора: перекроет путь');
  if (lift < HEADROOM) {
    for (const d of roomDoors(room, w)) {
      if (overlap(box, throatBox(d, a.floor))) {
        problems.push('перекрывает проход');
        break;
      }
    }
  }
  if (a.tier === w.spawnTier && Math.hypot((box.minX + box.maxX) / 2 - w.spawn[0], (box.minZ + box.maxZ) / 2 - w.spawn[2]) < SPAWN_CLEAR) problems.push('у самого начала места');
  w.col.query(box.minX + SKIN, box.minZ + SKIN, box.maxX - SKIN, box.maxZ - SKIN, scratch);
  for (const b of scratch) {
    if (b.off || b.gone) continue;
    // Плита пола (верх не выше пола) не в счёт: на ней вещь стоит.
    if (b.maxY <= a.floor + 0.02) continue;
    if (overlap(box, b, SKIN)) {
      problems.push('врастает в стену или мебель');
      break;
    }
  }
  if (others.some((o) => overlap(box, o, SKIN))) problems.push('задевает другую поставленную вещь');
  return { box, problems };
}

/** Вещь в коридоре стоит у стены: её коробка касается полосы 0,9 м у глухой стены клетки. */
function nearWall(box: Box, room: GenRoom, w: Pick<PlaceWorld, 'shells'>): boolean {
  const sh = w.shells[room.tier]!;
  for (const [gx, gz] of room.cells) {
    const sx = gx - HALF;
    const sz = gz - HALF;
    for (let d = 0; d < 4; d++) {
      if (sh.edge(sx, sz, d) !== 'wall') continue;
      const a = DIRS[d]!;
      // Полоса у стены внутри клетки: от стены на 0,9 м внутрь.
      const ex = sx * CELL + a[0] * (CELL / 2);
      const ez = sz * CELL + a[1] * (CELL / 2);
      const strip: Box = {
        minX: a[0] !== 0 ? Math.min(ex, ex - a[0] * 0.9) : sx * CELL - CELL / 2,
        maxX: a[0] !== 0 ? Math.max(ex, ex - a[0] * 0.9) : sx * CELL + CELL / 2,
        minZ: a[1] !== 0 ? Math.min(ez, ez - a[1] * 0.9) : sz * CELL - CELL / 2,
        maxZ: a[1] !== 0 ? Math.max(ez, ez - a[1] * 0.9) : sz * CELL + CELL / 2,
        minY: -1e9,
        maxY: 1e9,
      };
      // Вся вещь — в полосе (с допуском 5 см).
      if (box.minX >= strip.minX - 0.05 && box.maxX <= strip.maxX + 0.05 && box.minZ >= strip.minZ - 0.05 && box.maxZ <= strip.maxZ + 0.05) return true;
    }
  }
  return false;
}

/** Ключ расстановки числом: свой порядок перебора мест у каждой. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Помещения, куда правило вообще пускает вещь. */
export function roomsFor(spec: Pick<PlacedSpec, 'rule'>, w: PlaceWorld): GenRoom[] {
  if (!spec.rule.worlds.includes(w.layout.world)) return [];
  return w.layout.rooms.filter((r) => !w.skip.has(r.id) && !NEVER.has(r.type) && (spec.rule.rooms.length === 0 || spec.rule.rooms.includes(r.type)));
}

/**
 * Расставить вещи по уровню. Вещь встаёт, только если её место в правиле и есть помещение нужного типа;
 * сколько — rule.count, по возможности в разных помещениях. Вещи, которой нет в реестре, нет и на уровне.
 */
export function placeThings(specs: readonly PlacedSpec[], w: PlaceWorld, props: Readonly<Record<string, PropSpec>>): PlacedSpot[] {
  const out: PlacedSpot[] = [];
  const boxes: Box[] = [];
  for (const spec of specs) {
    // Замены ставит сама сборка уровня, на место вещи игры (world/props_all.ts, withSwap).
    if (spec.replaces) continue;
    const p = props[spec.prop];
    if (!p) continue;
    const rooms = roomsFor(spec, w);
    if (rooms.length === 0) continue;
    const h = idHash(spec.id);
    const cands = rooms.flatMap((r) => anchorSpots(r, spec.rule.anchor, w).map((a) => ({ a, r })));
    const used = new Set<number>();
    for (let k = 0; k < spec.rule.count; k++) {
      const order = cands.map((c, i) => ({ ...c, q: hash01(i * 7 + 1, k * 131 + 17, hash2(w.layout.seed, h, 0x7a11)) })).sort((x, y) => x.q - y.q);
      let pick: PlacedSpot | null = null;
      let pickBox: Box | null = null;
      for (const pass of [0, 1]) {
        for (const { a, r } of order) {
          if (pass === 0 && used.has(a.room)) continue;
          const { at, rot } = fitThing(spec, a, p);
          const { box, problems } = checkSpot(p, at, rot, r, a, w, boxes);
          if (problems.length > 0) continue;
          pick = { id: spec.id, k, prop: spec.prop, at, rot, room: a.room, tier: a.tier };
          pickBox = box;
          break;
        }
        if (pick) break;
      }
      if (!pick || !pickBox) break;
      used.add(pick.room);
      boxes.push(pickBox);
      out.push(pick);
    }
  }
  return out;
}
